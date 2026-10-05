<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();
ensure_employee_suffix_column($pdo);

/*
 * Service Record (CSC Form No. 1).
 *
 * `employees` holds only current state, so this endpoint reads and writes `service_records`, the
 * append-only history that the certified document is produced from. See sql/service_records.sql for
 * why the designation and station are stored as text rather than resolved through their FKs.
 */

const SERVICE_RECORD_TABLE = 'service_records';

/**
 * Statuses that appear in the "Record of Appointment" column.
 *
 * The two this agency actually appoints under, matching the list the employee form offers — a
 * service record entry should never be able to claim a status an employee could not be hired into.
 */
const SERVICE_RECORD_EMPLOYMENT_STATUSES = [
    'Regular',
    'Contract of Service',
];

/**
 * Whether the appointment is a science and technology position under the Magna Carta for S&T
 * personnel (RA 8439). It is kept per entry because a promotion can move someone from one to the
 * other.
 */
const SERVICE_RECORD_ST_CLASSIFICATIONS = [
    'S&T',
    'Non-S&T',
];

function service_record_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

/** The listed spelling of an S&T classification, or '' for a blank or unlisted value. */
function service_record_st_classification(mixed $value): string
{
    $value = service_record_text($value);

    foreach (SERVICE_RECORD_ST_CLASSIFICATIONS as $classification) {
        if (strcasecmp($value, $classification) === 0) {
            return $classification;
        }
    }

    return '';
}

function service_record_role_key(array $user): string
{
    return user_role_key($user);
}

function service_record_can_manage(array $user): bool
{
    return in_array(service_record_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function service_record_can_view_others(array $user): bool
{
    return in_array(
        service_record_role_key($user),
        ['admin', 'hrhead', 'hrstaff', 'chief', 'planningofficer', 'regionaldirector'],
        true
    );
}

function service_record_date_or_null(mixed $value): ?string
{
    $value = service_record_text($value);

    if ($value === '') {
        return null;
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $value);

    return $date && $date->format('Y-m-d') === $value ? $value : null;
}

function service_record_decimal_or_null(mixed $value): ?string
{
    $value = service_record_text($value);

    if ($value === '' || !is_numeric($value)) {
        return null;
    }

    return number_format((float)$value, 2, '.', '');
}

function service_record_require_table(PDO $pdo): void
{
    if (!database_table_exists($pdo, SERVICE_RECORD_TABLE)) {
        json_response([
            'success' => false,
            'message' => 'The service record table has not been created in this installation. Run backend/sql/service_records.sql.',
        ], 503);
    }
}

/**
 * Adds the S&T classification column to installations created before it existed. It is nullable
 * because the employee, promotion, and import paths also write entries, and none of them know it.
 */
function ensure_service_record_st_classification_column(PDO $pdo): void
{
    if (database_column_exists($pdo, SERVICE_RECORD_TABLE, 'st_classification')) {
        return;
    }

    try {
        $pdo->exec(
            'ALTER TABLE service_records
             ADD COLUMN st_classification VARCHAR(20) NULL DEFAULT NULL AFTER employment_status'
        );
    } catch (Throwable $exception) {
        // A parallel request that won the race already added it; the next column check sees it.
        error_log('Service record S&T classification column setup skipped: ' . $exception->getMessage());
    }
}

function service_record_fetch_employee(PDO $pdo, int $employeeRecordId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeCode,
            e.first_name,
            e.middle_name,
            e.last_name,
            e.suffix,
            e.date_of_birth AS dateOfBirth,
            e.address,
            e.city,
            e.province,
            e.date_hired AS dateHired,
            e.division_id AS divisionId,
            e.designation_id AS designationId,
            e.employment_status AS employmentStatus,
            e.status,
            e.basic_salary AS basicSalary,
            d.name AS designationTitle,
            dv.name AS station
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN divisions dv ON dv.id = e.division_id
         WHERE e.id = :employee_record_id
         LIMIT 1'
    );
    $statement->execute([':employee_record_id' => $employeeRecordId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        return null;
    }

    return [
        'id' => (int)$row['id'],
        'employeeCode' => service_record_text($row['employeeCode']),
        'fullName' => full_name_from_row($row),
        'firstName' => service_record_text($row['first_name']),
        'middleName' => service_record_text($row['middle_name']),
        'lastName' => service_record_text($row['last_name']),
        'suffix' => service_record_text($row['suffix']),
        'dateOfBirth' => $row['dateOfBirth'],
        'placeOfBirth' => trim(implode(', ', array_filter([
            service_record_text($row['city']),
            service_record_text($row['province']),
        ]))),
        'dateHired' => $row['dateHired'],
        'divisionId' => $row['divisionId'] === null ? null : (int)$row['divisionId'],
        'designationId' => $row['designationId'] === null ? null : (int)$row['designationId'],
        'employmentStatus' => service_record_text($row['employmentStatus']) ?: service_record_text($row['status']),
        'basicSalary' => $row['basicSalary'],
        'designationTitle' => service_record_text($row['designationTitle']),
        'station' => service_record_text($row['station']),
    ];
}

/*
 * The desks limited to their own division's employees. Mirrors DIVISION_SCOPED_SERVICE_RECORD_ROLE_KEYS
 * in ServiceRecordWorkspace.jsx, which confines the employee directory the same way.
 */
const SERVICE_RECORD_DIVISION_SCOPED_ROLES = ['chief', 'planningofficer', 'regionaldirector'];

/**
 * The employee ids the signed-in user may look at.
 *
 * Returning null means "no restriction". HR Staff work organization-wide; Chiefs, Planning
 * Officers, and Regional Directors remain limited to their divisions, mirroring analytics.
 */
function service_record_visible_division_id(PDO $pdo, array $user): ?int
{
    if (!in_array(service_record_role_key($user), SERVICE_RECORD_DIVISION_SCOPED_ROLES, true)) {
        return null;
    }

    $division = trimmed_text($user['division'] ?? '');

    if ($division === '') {
        return 0;
    }

    // One placeholder per marker: native prepares are on, so a reused name throws HY093.
    $statement = $pdo->prepare(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
           AND (name COLLATE utf8mb4_unicode_ci = :division_name
                OR code COLLATE utf8mb4_unicode_ci = :division_code)
         LIMIT 1'
    );
    $statement->execute([
        ':division_name' => $division,
        ':division_code' => $division,
    ]);
    $divisionId = (int)$statement->fetchColumn();

    return $divisionId > 0 ? $divisionId : 0;
}

function service_record_assert_can_view(PDO $pdo, array $user, array $employee): void
{
    $ownRecordId = session_employee_record_id($pdo, $user);

    if ($ownRecordId !== null && $ownRecordId === $employee['id']) {
        return;
    }

    if (!service_record_can_view_others($user)) {
        json_response([
            'success' => false,
            'message' => 'You can only view your own service record.',
        ], 403);
    }

    service_record_assert_in_division($pdo, $user, $employee);
}

function service_record_assert_in_division(PDO $pdo, array $user, array $employee): void
{
    $scopedDivisionId = service_record_visible_division_id($pdo, $user);

    if ($scopedDivisionId !== null && $employee['divisionId'] !== $scopedDivisionId) {
        json_response([
            'success' => false,
            'message' => 'This employee is outside your division.',
        ], 403);
    }
}

/**
 * The officer issuing the document.
 *
 * Their signature is what belongs on the certification line — not the subject employee's — so it is
 * resolved from the session here rather than guessed from session key names on the client.
 */
function service_record_certifier(PDO $pdo, array $user): array
{
    $recordId = session_employee_record_id($pdo, $user);
    $signature = '';

    if ($recordId !== null) {
        $statement = $pdo->prepare('SELECT e_signature FROM employees WHERE id = :employee_record_id LIMIT 1');
        $statement->execute([':employee_record_id' => $recordId]);
        $signature = service_record_text($statement->fetchColumn());
    }

    return [
        'name' => trimmed_text($user['full_name'] ?? '') ?: trimmed_text($user['username'] ?? ''),
        'signatureDataUrl' => $signature,
    ];
}

/*
 * Writes are confined the same way reads are. HR Staff can maintain any employee; a scoped desk can
 * only change an employee in its own division.
 */
function service_record_assert_can_manage(PDO $pdo, array $user, array $employee): void
{
    if (!service_record_can_manage($user)) {
        json_response([
            'success' => false,
            'message' => 'You do not have permission to change service records.',
        ], 403);
    }

    service_record_assert_in_division($pdo, $user, $employee);
}

/**
 * Approved leave-without-pay days per service period.
 *
 * Derived rather than hand-entered so the column cannot drift from the leave module. A leave that
 * straddles two appointments is counted against the period it starts in, which is how the days were
 * charged at the time.
 */
function service_record_lwop_days(PDO $pdo, int $employeeRecordId): array
{
    if (!database_table_exists($pdo, 'leave_requests') || !database_table_exists($pdo, 'leave_types')) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT lr.start_date AS startDate, lr.total_days AS totalDays
         FROM leave_requests lr
         INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         WHERE lr.employee_id = :employee_record_id
           AND lr.status = "approved"
           AND lt.code COLLATE utf8mb4_unicode_ci = "LWOP"'
    );
    $statement->execute([':employee_record_id' => $employeeRecordId]);

    return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function service_record_lwop_for_period(array $lwopRows, ?string $from, ?string $to): float
{
    $total = 0.0;

    foreach ($lwopRows as $row) {
        $startDate = service_record_text($row['startDate']);

        if ($startDate === '' || ($from !== null && $startDate < $from)) {
            continue;
        }

        if ($to !== null && $startDate > $to) {
            continue;
        }

        $total += (float)($row['totalDays'] ?? 0);
    }

    return round($total, 2);
}

function service_record_format_row(array $row, array $lwopRows): array
{
    return [
        'id' => (int)$row['id'],
        'employeeRecordId' => (int)$row['employee_record_id'],
        'serviceFrom' => $row['service_from'],
        'serviceTo' => $row['service_to'],
        'designationTitle' => service_record_text($row['designation_title']),
        'employmentStatus' => service_record_text($row['employment_status']),
        'stClassification' => service_record_text($row['st_classification'] ?? ''),
        'monthlySalary' => $row['monthly_salary'],
        'salaryGrade' => service_record_text($row['salary_grade']),
        'stepIncrement' => service_record_text($row['step_increment']),
        'station' => service_record_text($row['station']),
        'branch' => service_record_text($row['branch']),
        'separationDate' => $row['separation_date'],
        'separationCause' => service_record_text($row['separation_cause']),
        'remarks' => service_record_text($row['remarks']),
        'source' => service_record_text($row['source']) ?: 'manual',
        'isCurrent' => $row['service_to'] === null && $row['separation_date'] === null,
        'lwopDays' => service_record_lwop_for_period($lwopRows, $row['service_from'], $row['service_to']),
    ];
}

function service_record_list(PDO $pdo, int $employeeRecordId): array
{
    $statement = $pdo->prepare(
        'SELECT *
         FROM service_records
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
         ORDER BY service_from ASC, id ASC'
    );
    $statement->execute([':employee_record_id' => $employeeRecordId]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $lwopRows = service_record_lwop_days($pdo, $employeeRecordId);

    return array_map(static fn (array $row): array => service_record_format_row($row, $lwopRows), $rows);
}

function service_record_payload_from_body(array $body): array
{
    return [
        'serviceFrom' => service_record_date_or_null($body['serviceFrom'] ?? null),
        'serviceTo' => service_record_date_or_null($body['serviceTo'] ?? null),
        'designationTitle' => service_record_text($body['designationTitle'] ?? ''),
        'employmentStatus' => service_record_text($body['employmentStatus'] ?? ''),
        'stClassification' => service_record_st_classification($body['stClassification'] ?? ''),
        'monthlySalary' => service_record_decimal_or_null($body['monthlySalary'] ?? null),
        'salaryGrade' => service_record_text($body['salaryGrade'] ?? ''),
        'stepIncrement' => service_record_text($body['stepIncrement'] ?? ''),
        'station' => service_record_text($body['station'] ?? ''),
        'branch' => service_record_text($body['branch'] ?? '') ?: 'Mines and Geosciences Bureau',
        'separationDate' => service_record_date_or_null($body['separationDate'] ?? null),
        'separationCause' => service_record_text($body['separationCause'] ?? ''),
        'remarks' => service_record_text($body['remarks'] ?? ''),
    ];
}

function service_record_validate(array $payload): void
{
    $errors = [];

    if ($payload['serviceFrom'] === null) {
        $errors['serviceFrom'] = 'A valid start date is required.';
    }

    if ($payload['designationTitle'] === '') {
        $errors['designationTitle'] = 'Designation is required.';
    }

    if ($payload['employmentStatus'] === '') {
        $errors['employmentStatus'] = 'Employment status is required.';
    }

    if ($payload['station'] === '') {
        $errors['station'] = 'Station or place of assignment is required.';
    }

    if (
        $payload['serviceFrom'] !== null
        && $payload['serviceTo'] !== null
        && $payload['serviceTo'] < $payload['serviceFrom']
    ) {
        $errors['serviceTo'] = 'The end date cannot be earlier than the start date.';
    }

    if (
        $payload['separationDate'] !== null
        && $payload['serviceFrom'] !== null
        && $payload['separationDate'] < $payload['serviceFrom']
    ) {
        $errors['separationDate'] = 'The separation date cannot be earlier than the start date.';
    }

    if ($errors) {
        json_response([
            'success' => false,
            'message' => 'Please correct the highlighted fields.',
            'errors' => $errors,
        ], 422);
    }
}

/**
 * Closes whichever appointment is still open, so a new entry cannot leave two rows both claiming to
 * be the current one. The previous period ends the day before the new one starts.
 */
function service_record_close_open_periods(
    PDO $pdo,
    int $employeeRecordId,
    string $newServiceFrom,
    ?int $excludeId = null
): void {
    $closesOn = (new DateTimeImmutable($newServiceFrom))->modify('-1 day')->format('Y-m-d');

    $sql = 'UPDATE service_records
            SET service_to = :closes_on
            WHERE employee_record_id = :employee_record_id
              AND is_archived = 0
              AND service_to IS NULL
              AND service_from < :new_service_from';

    $parameters = [
        ':closes_on' => $closesOn,
        ':employee_record_id' => $employeeRecordId,
        ':new_service_from' => $newServiceFrom,
    ];

    if ($excludeId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $parameters[':exclude_id'] = $excludeId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($parameters);
}

function service_record_insert(
    PDO $pdo,
    int $employeeRecordId,
    array $payload,
    string $source,
    ?int $createdBy,
    ?int $designationId = null,
    ?int $divisionId = null
): int {
    $statement = $pdo->prepare(
        'INSERT INTO service_records
            (employee_record_id, service_from, service_to, designation_title, employment_status,
             st_classification, monthly_salary, salary_grade, step_increment, station, branch,
             separation_date, separation_cause, remarks, designation_id, division_id, source, created_by)
         VALUES
            (:employee_record_id, :service_from, :service_to, :designation_title, :employment_status,
             :st_classification, :monthly_salary, :salary_grade, :step_increment, :station, :branch,
             :separation_date, :separation_cause, :remarks, :designation_id, :division_id, :source, :created_by)'
    );
    $statement->execute([
        ':employee_record_id' => $employeeRecordId,
        ':service_from' => $payload['serviceFrom'],
        ':service_to' => $payload['serviceTo'],
        ':designation_title' => $payload['designationTitle'],
        ':employment_status' => $payload['employmentStatus'],
        ':st_classification' => $payload['stClassification'] ?: null,
        ':monthly_salary' => $payload['monthlySalary'],
        ':salary_grade' => $payload['salaryGrade'] ?: null,
        ':step_increment' => $payload['stepIncrement'] ?: null,
        ':station' => $payload['station'],
        ':branch' => $payload['branch'],
        ':separation_date' => $payload['separationDate'],
        ':separation_cause' => $payload['separationCause'] ?: null,
        ':remarks' => $payload['remarks'] ?: null,
        ':designation_id' => $designationId,
        ':division_id' => $divisionId,
        ':source' => $source,
        ':created_by' => $createdBy,
    ]);

    return (int)$pdo->lastInsertId();
}

/**
 * What makes an imported entry a duplicate of one already on file. The S&T classification is left
 * out: no import source carries it, so an entry HR has classified since would otherwise stop matching
 * its own line in a re-uploaded form and be imported a second time.
 */
function service_record_import_key(array $payload): string
{
    unset($payload['stClassification']);

    return json_encode($payload);
}

/**
 * Every employee's step as their service record has it today, with the date that step took effect:
 * the start of the newest run of entries at the same salary grade and step. Salary adjustments add
 * entries without changing either, so they do not restart the three-year count toward the next step
 * increment; a step increment or a promotion does. Entries dated after today are not in force yet.
 *
 * `$divisionId` follows service_record_visible_division_id(): null for everyone, 0 for no one.
 */
function service_record_current_steps(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId === 0) {
        return [];
    }

    $sql = 'SELECT sr.employee_record_id, sr.service_from, sr.employment_status, sr.salary_grade, sr.step_increment
            FROM service_records sr
            INNER JOIN employees e ON e.id = sr.employee_record_id
            WHERE sr.is_archived = 0
              AND e.is_archived = 0
              AND sr.service_from <= CURDATE()';
    $parameters = [];

    if ($divisionId !== null) {
        $sql .= ' AND e.division_id = :division_id';
        $parameters[':division_id'] = $divisionId;
    }

    $statement = $pdo->prepare($sql . ' ORDER BY sr.employee_record_id ASC, sr.service_from DESC, sr.id DESC');
    $statement->execute($parameters);

    $steps = [];
    $runEnded = [];

    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $employeeRecordId = (int)$row['employee_record_id'];
        $grade = service_record_text($row['salary_grade']);
        $step = service_record_text($row['step_increment']);

        // Rows arrive newest first, so the first one per employee is the entry in force.
        if (!isset($steps[$employeeRecordId])) {
            $steps[$employeeRecordId] = [
                'employeeRecordId' => $employeeRecordId,
                'employmentStatus' => service_record_text($row['employment_status']),
                'salaryGrade' => $grade,
                'step' => $step,
                'stepSince' => $row['service_from'],
            ];
            continue;
        }

        if (isset($runEnded[$employeeRecordId])) {
            continue;
        }

        if ($grade === $steps[$employeeRecordId]['salaryGrade'] && $step === $steps[$employeeRecordId]['step']) {
            $steps[$employeeRecordId]['stepSince'] = $row['service_from'];
        } else {
            $runEnded[$employeeRecordId] = true;
        }
    }

    return array_values(array_map(static function (array $entry): array {
        $step = ctype_digit($entry['step']) ? (int)$entry['step'] : 0;
        $entry['step'] = $step >= 1 && $step <= 8 ? $step : null;

        return $entry;
    }, $steps));
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$action = strtolower(service_record_text($_GET['action'] ?? ''));
$body = [];

if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    $body = $action === 'preview-import' ? $_POST : read_json_body();
}

service_record_require_table($pdo);
ensure_service_record_st_classification_column($pdo);

/*
 * The Loyalty screen's step column needs every employee's current step at once rather than one
 * service record per request, so this is answered before a single employee is resolved below.
 */
if ($method === 'GET' && $action === 'steps') {
    if (!service_record_can_view_others($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You do not have permission to view other employees\' service records.',
        ], 403);
    }

    json_response([
        'success' => true,
        'steps' => service_record_current_steps($pdo, service_record_visible_division_id($pdo, $sessionUser)),
    ]);
}

$requestedEmployeeId = (int)($_GET['employeeId'] ?? $body['employeeRecordId'] ?? 0);

if ($requestedEmployeeId <= 0) {
    // No employee named: fall back to the signed-in user's own record, which is what the
    // self-service screen wants.
    $requestedEmployeeId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);
}

if ($requestedEmployeeId <= 0) {
    json_response([
        'success' => false,
        'message' => 'No employee record is linked to this account.',
    ], 422);
}

$employee = service_record_fetch_employee($pdo, $requestedEmployeeId);

if ($employee === null) {
    json_response([
        'success' => false,
        'message' => 'Employee record not found.',
    ], 404);
}

if ($method === 'GET') {
    service_record_assert_can_view($pdo, $sessionUser, $employee);

    json_response([
        'success' => true,
        'employee' => $employee,
        'records' => service_record_list($pdo, $employee['id']),
        'employmentStatuses' => SERVICE_RECORD_EMPLOYMENT_STATUSES,
        'stClassifications' => SERVICE_RECORD_ST_CLASSIFICATIONS,
        'canManage' => service_record_can_manage($sessionUser),
        'certifier' => service_record_certifier($pdo, $sessionUser),
    ]);
}

if ($method === 'POST' && in_array($action, ['preview-import', 'preview-pdf', 'import'], true)) {
    service_record_assert_can_manage($pdo, $sessionUser, $employee);
    require_once __DIR__ . '/service-record-import.php';

    try {
        if ($action === 'preview-pdf') {
            $rows = $body['rows'] ?? null;
            if (!is_array($rows) || count($rows) < 2 || count($rows) > 501) {
                throw new InvalidArgumentException('Import between 1 and 500 service record entries.');
            }
            foreach ($rows as $row) {
                if (!is_array($row) || count($row) !== 11) throw new InvalidArgumentException('Invalid PDF table.');
                foreach ($row as $cell) {
                    if (!is_string($cell) || strlen($cell) > 4000) throw new InvalidArgumentException('Invalid PDF cell.');
                }
            }
            json_response(['success' => true, 'entries' => service_import_rows($rows)]);
        }
        if ($action === 'preview-import') {
            $file = $_FILES['file'] ?? [];
            if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                throw new InvalidArgumentException('Choose a service record form within the server upload limit.');
            }
            if (strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION)) !== 'xlsx') {
                throw new InvalidArgumentException('Choose an Excel (.xlsx) SERVICE RECORD form.');
            }
            if (!is_uploaded_file($file['tmp_name'] ?? '')) throw new InvalidArgumentException('Invalid uploaded file.');
            $entries = service_import_rows(employee_xlsx_read_rows($file['tmp_name']));
            json_response(['success' => true, 'entries' => $entries]);
        }

        $entries = $body['entries'] ?? null;
        if (!is_array($entries) || count($entries) < 1 || count($entries) > 500) {
            throw new InvalidArgumentException('Import between 1 and 500 service record entries.');
        }
        $payloads = [];
        foreach ($entries as $index => $entry) {
            if (!is_array($entry)) throw new InvalidArgumentException('Invalid service record entry.');
            try {
                $payloads[] = service_record_payload_from_body(service_import_validate_record($entry));
            } catch (InvalidArgumentException $error) {
                throw new InvalidArgumentException('Entry ' . ($index + 1) . ': ' . $error->getMessage());
            }
        }
    } catch (Throwable $error) {
        json_response(['success' => false, 'message' => $error->getMessage()], 422);
    }

    try {
        $pdo->beginTransaction();
        // Serialize imports for this employee, including retries of the same upload.
        $lock = $pdo->prepare('SELECT id FROM employees WHERE id = ? FOR UPDATE');
        $lock->execute([$employee['id']]);
        $existing = service_record_list($pdo, $employee['id']);
        $keys = [];
        foreach ($existing as $entry) $keys[service_record_import_key(service_record_payload_from_body($entry))] = true;
        $imported = 0;
        foreach ($payloads as $payload) {
            $key = service_record_import_key($payload);
            if (isset($keys[$key])) continue;
            service_record_insert($pdo, $employee['id'], $payload, 'import', (int)($sessionUser['id'] ?? 0) ?: null);
            $keys[$key] = true;
            $imported++;
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('service_record import failed: ' . $error->getMessage());
        json_response(['success' => false, 'message' => 'Unable to import the service record. No entries were saved.'], 500);
    }
    $skipped = count($payloads) - $imported;
    json_response([
        'success' => true,
        'message' => "Imported {$imported} service record entries. Skipped {$skipped} duplicates.",
        'imported' => $imported,
        'skipped' => $skipped,
        'records' => service_record_list($pdo, $employee['id']),
    ]);
}

if ($method === 'POST' && $action === 'create') {
    service_record_assert_can_manage($pdo, $sessionUser, $employee);

    $payload = service_record_payload_from_body($body);
    service_record_validate($payload);

    $closePrevious = (bool)($body['closePreviousPeriod'] ?? true);

    try {
        $pdo->beginTransaction();

        if ($closePrevious) {
            service_record_close_open_periods($pdo, $employee['id'], $payload['serviceFrom']);
        }

        service_record_insert(
            $pdo,
            $employee['id'],
            $payload,
            'manual',
            (int)($sessionUser['id'] ?? 0) ?: null
        );

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        error_log('service_record create failed: ' . $error->getMessage());
        json_response([
            'success' => false,
            'message' => 'Unable to save the service record entry.',
        ], 500);
    }

    json_response([
        'success' => true,
        'message' => 'Service record entry added.',
        'employee' => $employee,
        'records' => service_record_list($pdo, $employee['id']),
    ]);
}

if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'update') {
    service_record_assert_can_manage($pdo, $sessionUser, $employee);

    $recordId = (int)($body['id'] ?? 0);

    if ($recordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Service record entry is required.',
        ], 422);
    }

    $payload = service_record_payload_from_body($body);
    service_record_validate($payload);

    $statement = $pdo->prepare(
        'UPDATE service_records
         SET service_from = :service_from,
             service_to = :service_to,
             designation_title = :designation_title,
             employment_status = :employment_status,
             st_classification = :st_classification,
             monthly_salary = :monthly_salary,
             salary_grade = :salary_grade,
             step_increment = :step_increment,
             station = :station,
             branch = :branch,
             separation_date = :separation_date,
             separation_cause = :separation_cause,
             remarks = :remarks
         WHERE id = :id
           AND employee_record_id = :employee_record_id
           AND is_archived = 0'
    );
    $statement->execute([
        ':service_from' => $payload['serviceFrom'],
        ':service_to' => $payload['serviceTo'],
        ':designation_title' => $payload['designationTitle'],
        ':employment_status' => $payload['employmentStatus'],
        ':st_classification' => $payload['stClassification'] ?: null,
        ':monthly_salary' => $payload['monthlySalary'],
        ':salary_grade' => $payload['salaryGrade'] ?: null,
        ':step_increment' => $payload['stepIncrement'] ?: null,
        ':station' => $payload['station'],
        ':branch' => $payload['branch'],
        ':separation_date' => $payload['separationDate'],
        ':separation_cause' => $payload['separationCause'] ?: null,
        ':remarks' => $payload['remarks'] ?: null,
        ':id' => $recordId,
        ':employee_record_id' => $employee['id'],
    ]);

    if ($statement->rowCount() === 0) {
        // MySQL reports 0 changed rows for a no-op update too, so confirm the row actually exists
        // before calling this a failure.
        $check = $pdo->prepare(
            'SELECT COUNT(*) FROM service_records
             WHERE id = :id AND employee_record_id = :employee_record_id AND is_archived = 0'
        );
        $check->execute([':id' => $recordId, ':employee_record_id' => $employee['id']]);

        if ((int)$check->fetchColumn() === 0) {
            json_response([
                'success' => false,
                'message' => 'Service record entry not found.',
            ], 404);
        }
    }

    json_response([
        'success' => true,
        'message' => 'Service record entry updated.',
        'employee' => $employee,
        'records' => service_record_list($pdo, $employee['id']),
    ]);
}

if ($method === 'DELETE' && $action === 'archive') {
    service_record_assert_can_manage($pdo, $sessionUser, $employee);

    $recordId = (int)($body['id'] ?? $_GET['id'] ?? 0);

    if ($recordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Service record entry is required.',
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE service_records
         SET is_archived = 1
         WHERE id = :id AND employee_record_id = :employee_record_id'
    );
    $statement->execute([
        ':id' => $recordId,
        ':employee_record_id' => $employee['id'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Service record entry removed.',
        'employee' => $employee,
        'records' => service_record_list($pdo, $employee['id']),
    ]);
}

json_response([
    'success' => false,
    'message' => 'Unsupported service record action.',
], 400);
