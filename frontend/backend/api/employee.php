<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/employee-id-utils.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/leave-credit-utils.php';
require_once __DIR__ . '/password-reset-utils.php';
require_once __DIR__ . '/profile-edit-request-utils.php';
require_once __DIR__ . '/xlsx-reader.php';

$sessionUser = require_session_user();
ensure_organization_structure_columns($pdo);
ensure_user_security_columns($pdo);
ensure_email_verification_columns($pdo);
ensure_employee_suffix_column($pdo);
ensure_employee_assignment_optional($pdo);
migrate_legacy_employee_ids($pdo);

/**
 * Who may write to the employee master list.
 *
 * These are the roles granted the `employees` module by default_role_permission_access() in
 * settings.php. Until now the file's only check was require_session_user(), which meant any
 * signed-in account could create an employee together with a linked user account carrying an
 * arbitrary roleId -- the same privilege escalation user.php had, by another door -- or archive
 * anyone on the roster.
 *
 * Reads stay open to every signed-in role on purpose: ProfilePage, the Chief and Regional Director
 * dashboards, RoleAnalyticsOverview and the loan filing screen all call getEmployees() regardless of
 * role, so gating GET here would blank those pages. That leaves the roster's salary and government-ID
 * columns readable by any account, which is a real exposure and wants a field-level filter on
 * list_employees() -- a separate change, since it needs each caller checked for what it actually reads.
 */
function employees_can_manage(array $sessionUser): bool
{
    return can_manage_employee_records($sessionUser);
}

function employees_require_manager(array $sessionUser): void
{
    if (employees_can_manage($sessionUser)) {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'You are not allowed to manage employee records.',
    ], 403);
}

/**
 * The profile page lets any role edit its own personal, address, government-ID and employment
 * sections, and it saves them through PUT /employee.php. So an edit is allowed when the caller
 * manages employees *or* the row being written is the caller's own linked record.
 */
function employees_require_manager_or_self(PDO $pdo, array $sessionUser, int $employeeId): void
{
    if (employees_can_manage($sessionUser)) {
        return;
    }

    $ownRecordId = session_employee_record_id($pdo, $sessionUser);

    if ($ownRecordId !== null && $ownRecordId === $employeeId && $employeeId > 0) {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'You can only edit your own employee record.',
    ], 403);
}

/** Personal fields protected by the Admin / HR Head edit-approval workflow. */
function employee_personal_details_changed(array $existingEmployee, array $employee): bool
{
    $fieldMap = [
        'firstName' => 'first_name',
        'middleName' => 'middle_name',
        'lastName' => 'last_name',
        'suffix' => 'suffix',
        'dateOfBirth' => 'date_of_birth',
        'gender' => 'gender',
        'phone' => 'phone',
        'civilStatus' => 'civil_status',
    ];

    foreach ($fieldMap as $existingKey => $payloadKey) {
        $before = trim((string)($existingEmployee[$existingKey] ?? ''));
        $after = trim((string)($employee[$payloadKey] ?? ''));

        if ($before !== $after) {
            return true;
        }
    }

    return false;
}

function employee_null_if_empty(mixed $value): mixed
{
    if ($value === null) {
        return null;
    }

    $trimmed = trim((string)$value);
    return $trimmed === '' ? null : $trimmed;
}

function employee_decimal_or_null(mixed $value): ?string
{
    $value = employee_null_if_empty($value);

    if ($value === null) {
        return null;
    }

    return is_numeric($value) ? (string)$value : null;
}

function employee_date_or_null(mixed $value): ?string
{
    $value = employee_null_if_empty($value);

    if ($value === null) {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', (string)$value);
    return $date && $date->format('Y-m-d') === $value ? (string)$value : null;
}

/** Longest designation the column takes. */
const EMPLOYEE_DESIGNATION_MAX_LENGTH = 150;

/** "  OIC,   Finance Section " -> "OIC, Finance Section"; blank becomes null (no designation). */
function employee_designation_text(mixed $value): ?string
{
    $text = trim(preg_replace('/\s+/u', ' ', (string)($value ?? '')) ?? '');

    return $text === '' ? null : $text;
}

function employee_bool(mixed $value): bool
{
    if (is_bool($value)) {
        return $value;
    }

    $text = strtolower(trim((string)($value ?? '')));

    return in_array($text, ['1', 'true', 'yes', 'on'], true);
}

function employee_payload(array $body): array
{
    return [
        'employee_id' => normalize_employee_id($body['employeeId'] ?? ''),
        'first_name' => trim((string)($body['firstName'] ?? '')),
        'middle_name' => employee_null_if_empty($body['middleName'] ?? null),
        'last_name' => trim((string)($body['lastName'] ?? '')),
        'suffix' => employee_null_if_empty($body['suffix'] ?? null),
        'date_of_birth' => employee_date_or_null($body['dateOfBirth'] ?? null),
        'address' => employee_null_if_empty($body['address'] ?? null),
        'city' => employee_null_if_empty($body['city'] ?? null),
        'province' => employee_null_if_empty($body['province'] ?? null),
        'zip_code' => employee_null_if_empty($body['zipCode'] ?? null),
        'gender' => employee_null_if_empty($body['gender'] ?? null),
        'email' => trim((string)($body['email'] ?? '')),
        'phone' => employee_null_if_empty($body['phone'] ?? null),
        'division_id' => (int)($body['divisionId'] ?? 0),
        // designationId is the position; `designation` is the optional assignment on top of it.
        'designation_id' => (int)($body['designationId'] ?? 0),
        'designation' => employee_designation_text($body['designation'] ?? null),
        'basic_salary' => employee_decimal_or_null($body['basicSalary'] ?? null),
        'salary_rate' => employee_null_if_empty($body['salaryRate'] ?? null),
        'date_hired' => employee_date_or_null($body['dateHired'] ?? null),
        'status' => employee_null_if_empty($body['status'] ?? 'Active') ?? 'Active',
        'employment_status' => employee_null_if_empty($body['employmentStatus'] ?? null),
        'pwd' => (int)(($body['pwd'] ?? '0') === '1' || ($body['pwd'] ?? false) === true),
        'civil_status' => employee_null_if_empty($body['civilStatus'] ?? null),
        'height' => employee_decimal_or_null($body['height'] ?? null),
        'weight' => employee_decimal_or_null($body['weight'] ?? null),
        'blood_type' => employee_null_if_empty($body['bloodType'] ?? null),
        'emp_gsis_id_no' => employee_null_if_empty($body['gsisIdNo'] ?? null),
        'emp_pagibig_id_no' => employee_null_if_empty($body['pagibigIdNo'] ?? null),
        'emp_philhealth_id_no' => employee_null_if_empty($body['philhealthIdNo'] ?? null),
        'tin_no' => employee_null_if_empty($body['tinNo'] ?? null),
    ];
}

function employee_payload_errors(PDO $pdo, array $employee): array
{
    $errors = [];

    if ($employee['employee_id'] === '') {
        $errors[] = 'Employee ID is required.';
    }
    if ($employee['first_name'] === '') {
        $errors[] = 'First name is required.';
    }
    if ($employee['last_name'] === '') {
        $errors[] = 'Last name is required.';
    }
    if ($employee['date_of_birth'] === null) {
        $errors[] = 'Date of birth is required.';
    } else {
        $age = employee_age_on_date($employee['date_of_birth'], date('Y-m-d'));

        if ($age === null || $age < EMPLOYEE_MINIMUM_AGE || $age > EMPLOYEE_MAXIMUM_AGE) {
            $errors[] = sprintf(
                'Employee age must be between %d and %d years old.',
                EMPLOYEE_MINIMUM_AGE,
                EMPLOYEE_MAXIMUM_AGE
            );
        }
    }
    if ($employee['email'] === '' || filter_var($employee['email'], FILTER_VALIDATE_EMAIL) === false) {
        $errors[] = 'Valid email is required.';
    } else {
        $emailPolicyViolation = email_domain_policy_violation($pdo, $employee['email']);
        if ($emailPolicyViolation !== null) {
            $errors[] = $emailPolicyViolation;
        }
    }
    if ($employee['phone'] === null) {
        $errors[] = 'Phone is required.';
    }
    if ($employee['division_id'] <= 0) {
        $errors[] = 'Division is required.';
    }
    if ($employee['designation_id'] <= 0) {
        $errors[] = 'Position is required.';
    }

    if ($employee['division_id'] > 0 && $employee['designation_id'] > 0) {
        $statement = $pdo->prepare(
            'SELECT COUNT(*) FROM designations
             WHERE id = :designation_id
               AND division_id = :division_id
               AND is_archived = 0'
        );
        $statement->execute([
            ':designation_id' => $employee['designation_id'],
            ':division_id' => $employee['division_id'],
        ]);

        if ((int)$statement->fetchColumn() === 0) {
            $errors[] = 'Selected position does not belong to the selected division.';
        }
    }

    if (mb_strlen((string)($employee['designation'] ?? '')) > EMPLOYEE_DESIGNATION_MAX_LENGTH) {
        $errors[] = sprintf('Designation must be %d characters or fewer.', EMPLOYEE_DESIGNATION_MAX_LENGTH);
    }

    return $errors;
}

function validate_employee_payload(PDO $pdo, array $employee): void
{
    $errors = employee_payload_errors($pdo, $employee);

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }
}

function generate_employee_id(PDO $pdo): string
{
    return next_employee_id($pdo);
}

function employee_role_exists(PDO $pdo, int $roleId): bool
{
    if ($roleId <= 0) {
        return false;
    }

    static $cache = [];
    $cacheKey = spl_object_id($pdo) . ':' . $roleId;

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $statement = $pdo->prepare('SELECT COUNT(*) FROM roles WHERE id = :id');
    $statement->execute([':id' => $roleId]);

    $cache[$cacheKey] = (int)$statement->fetchColumn() > 0;
    return $cache[$cacheKey];
}

/** The login role assigned automatically whenever a single employee record is created. */
function employee_default_role_id(PDO $pdo): int
{
    $statement = $pdo->query(
        'SELECT id
         FROM roles
         WHERE LOWER(REPLACE(name, " ", "")) = "employee"
         ORDER BY id
         LIMIT 1'
    );

    return $statement !== false ? (int)$statement->fetchColumn() : 0;
}

/*
 * employee_status_exists() and employee_active_status_id() used to sit here, both of them queries
 * against the `status` lookup table -- one to check an id was real, one to find the id that meant
 * "active" and fail the request if the table was empty. `users.status` is an ENUM now, so the value
 * is HRIS_USER_STATUS_ACTIVE and there is nothing left to look up or to fail on.
 */

function validate_employee_account_payload(PDO $pdo, int $roleId): void
{
    if ($roleId <= 0) {
        return;
    }

    if (!employee_role_exists($pdo, $roleId)) {
        json_response([
            'success' => false,
            'message' => 'Selected account role is not available.',
        ], 422);
    }
}

function fetch_employee(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            e.first_name AS firstName,
            e.middle_name AS middleName,
            e.last_name AS lastName,
            e.suffix,
            CONCAT_WS(" ", NULLIF(e.first_name, ""), NULLIF(e.middle_name, ""), NULLIF(e.last_name, ""), NULLIF(e.suffix, "")) AS fullName,
            e.date_of_birth AS dateOfBirth,
            e.address,
            e.city,
            e.province,
            e.zip_code AS zipCode,
            e.gender,
            e.email,
            e.phone,
            e.division_id AS divisionId,
            d.name AS department,
            e.designation_id AS designationId,
            des.name AS position,
            e.designation,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            e.date_hired AS dateHired,
            e.status,
            e.employment_status AS employmentStatus,
            e.profile_image AS profileImage,
            CAST(e.pwd AS CHAR) AS pwd,
            e.civil_status AS civilStatus,
            e.height,
            e.weight,
            e.blood_type AS bloodType,
            e.emp_gsis_id_no AS gsisIdNo,
            e.emp_pagibig_id_no AS pagibigIdNo,
            e.emp_philhealth_id_no AS philhealthIdNo,
            e.tin_no AS tinNo
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

/**
 * Appends a service record entry when an edit changes the employee's appointment.
 *
 * `employees` keeps only current state, so without this a promotion silently overwrites the previous
 * position and salary and the history is gone. Only the four fields that appear on CS Form No. 1
 * are watched — editing a phone number is not an appointment change, and neither is a designation.
 *
 * The effective date is NOT the date of the edit. HR records promotions late and corrects typos, so
 * the client sends `serviceEffectiveDate` (what the appointment document says) and
 * `serviceChangeMode`. A "correction" amends the row currently in force instead of opening a new
 * one, which is what keeps typo fixes from appearing as fictitious promotions.
 *
 * Runs inside the caller's transaction: if the employee update rolls back, so does this.
 */
function employee_append_service_record(
    PDO $pdo,
    int $employeeRecordId,
    array $previous,
    array $current,
    array $body,
    ?int $createdBy
): void {
    if (!database_table_exists($pdo, 'service_records') || !$current) {
        return;
    }

    $watched = [
        'designationId' => 'position',
        'basicSalary' => 'salary',
        'employmentStatus' => 'employment status',
        'divisionId' => 'division',
    ];
    $changed = [];

    foreach ($watched as $key => $label) {
        $before = trim((string)($previous[$key] ?? ''));
        $after = trim((string)($current[$key] ?? ''));

        // Salary is decimal text ("25000.00" vs "25000"), so compare numerically where possible.
        if (is_numeric($before) && is_numeric($after)) {
            if (abs((float)$before - (float)$after) > 0.001) {
                $changed[] = $label;
            }

            continue;
        }

        if ($before !== $after) {
            $changed[] = $label;
        }
    }

    if (!$changed) {
        return;
    }

    $effectiveDate = trim((string)($body['serviceEffectiveDate'] ?? ''));
    $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $effectiveDate);

    if (!$parsedDate || $parsedDate->format('Y-m-d') !== $effectiveDate) {
        $effectiveDate = (new DateTimeImmutable('today'))->format('Y-m-d');
    }

    $isCorrection = strtolower(trim((string)($body['serviceChangeMode'] ?? 'change'))) === 'correction';
    $remarks = trim((string)($body['serviceChangeRemarks'] ?? ''));

    if ($remarks === '') {
        $remarks = ucfirst(implode(', ', $changed)) . ' updated.';
    }

    $designationTitle = trim((string)($current['position'] ?? ''));
    $station = trim((string)($current['department'] ?? ''));
    $employmentStatus = trim((string)($current['employmentStatus'] ?? '')) ?: trim((string)($current['status'] ?? ''));

    if ($designationTitle === '' || $station === '' || $employmentStatus === '') {
        return;
    }

    if ($isCorrection) {
        $update = $pdo->prepare(
            'UPDATE service_records
             SET designation_title = :designation_title,
                 employment_status = :employment_status,
                 monthly_salary = :monthly_salary,
                 station = :station,
                 designation_id = :designation_id,
                 division_id = :division_id,
                 remarks = :remarks
             WHERE employee_record_id = :employee_record_id
               AND is_archived = 0
               AND service_to IS NULL
             ORDER BY service_from DESC
             LIMIT 1'
        );
        $update->execute([
            ':designation_title' => $designationTitle,
            ':employment_status' => $employmentStatus,
            ':monthly_salary' => $current['basicSalary'] ?? null,
            ':station' => $station,
            ':designation_id' => $current['designationId'] ?? null,
            ':division_id' => $current['divisionId'] ?? null,
            ':remarks' => $remarks,
            ':employee_record_id' => $employeeRecordId,
        ]);

        if ($update->rowCount() > 0) {
            return;
        }
        // Nothing open to amend — fall through and record it as a new period instead.
    }

    $closesOn = (new DateTimeImmutable($effectiveDate))->modify('-1 day')->format('Y-m-d');
    $close = $pdo->prepare(
        'UPDATE service_records
         SET service_to = :closes_on
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
           AND service_to IS NULL
           AND service_from <= :effective_date'
    );
    $close->execute([
        ':closes_on' => $closesOn,
        ':employee_record_id' => $employeeRecordId,
        ':effective_date' => $effectiveDate,
    ]);

    $insert = $pdo->prepare(
        'INSERT INTO service_records
            (employee_record_id, service_from, designation_title, employment_status, monthly_salary,
             station, designation_id, division_id, source, remarks, created_by)
         VALUES
            (:employee_record_id, :service_from, :designation_title, :employment_status, :monthly_salary,
             :station, :designation_id, :division_id, "system", :remarks, :created_by)'
    );
    $insert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':service_from' => $effectiveDate,
        ':designation_title' => $designationTitle,
        ':employment_status' => $employmentStatus,
        ':monthly_salary' => $current['basicSalary'] ?? null,
        ':station' => $station,
        ':designation_id' => $current['designationId'] ?? null,
        ':division_id' => $current['divisionId'] ?? null,
        ':remarks' => $remarks,
        ':created_by' => $createdBy,
    ]);
}

/**
 * The two ways an employee leaves, and the status each one parks them in.
 *
 * `employees.status` is free text rather than an enum, so these values need no migration — but they
 * are the only two the Loyalty screen writes, and the Employee Management status list carries them
 * as well so an edit form never shows a value it cannot offer back.
 */
const EMPLOYEE_SEPARATION_TYPES = [
    'retirement' => ['status' => 'Retired', 'cause' => 'Retirement', 'verb' => 'retired'],
    'resignation' => ['status' => 'Resigned', 'cause' => 'Resignation', 'verb' => 'resigned'],
];

/** GSIS optional retirement age (RA 8291), matching RETIREMENT_ELIGIBLE_AGE on the client. */
const EMPLOYEE_RETIREMENT_AGE = 60;

/** Shared first-login credential for employee accounts created by CSV import. */
const EMPLOYEE_CSV_IMPORT_TEMPORARY_PASSWORD = '123';

/**
 * Age bounds a birth date has to fall inside. The floor is the minimum age for government
 * employment; the ceiling only exists to reject a mistyped year such as 1902. The Add Employee form
 * clamps its date picker to the same window, so this is the server-side half of that rule.
 */
const EMPLOYEE_MINIMUM_AGE = 18;
const EMPLOYEE_MAXIMUM_AGE = 100;

/** Whole years between two "YYYY-MM-DD" dates, or null when the birth date is missing or unparseable. */
function employee_age_on_date(mixed $dateOfBirth, string $onDate): ?int
{
    $birth = employee_date_or_null($dateOfBirth);

    if ($birth === null) {
        return null;
    }

    $birthDate = new DateTimeImmutable($birth);
    $target = new DateTimeImmutable($onDate);

    if ($birthDate > $target) {
        return null;
    }

    return (int)$birthDate->diff($target)->y;
}

/**
 * The employment status to carry onto a synthesised separation row.
 *
 * `service_records.employment_status` is NOT NULL and the column is a real one on CS Form No. 1, so
 * it falls back through the employee's current status to whatever their last recorded appointment
 * said before settling on Regular — the default the employee form offers, so a synthesised row
 * cannot introduce a status the Add Entry list would not offer back.
 */
function employee_separation_employment_status(PDO $pdo, array $employee): string
{
    $employmentStatus = trim((string)($employee['employmentStatus'] ?? ''));

    if ($employmentStatus !== '') {
        return $employmentStatus;
    }

    $previous = $pdo->prepare(
        'SELECT employment_status
         FROM service_records
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
         ORDER BY service_from DESC, id DESC
         LIMIT 1'
    );
    $previous->execute([':employee_record_id' => (int)$employee['id']]);

    return trim((string)($previous->fetchColumn() ?: '')) ?: 'Regular';
}

/**
 * Puts the separation on the employee's service record, so it lists on their CS Form No. 1.
 *
 * Closing the appointment still in force is the normal path. When nothing is open — an employee
 * whose history was never captured, which is most of them until HR fills it in — a period is
 * synthesised from their current appointment instead, because a retirement that leaves no line on
 * the form is a retirement the form does not know about.
 *
 * Returns 'closed', 'created', or 'skipped' when the table is not installed.
 */
function employee_separation_record(
    PDO $pdo,
    array $employee,
    string $effectiveDate,
    string $cause,
    ?int $createdBy
): string {
    if (!database_table_exists($pdo, 'service_records')) {
        return 'skipped';
    }

    $employeeRecordId = (int)$employee['id'];

    $close = $pdo->prepare(
        'UPDATE service_records
         SET service_to = :service_to,
             separation_date = :separation_date,
             separation_cause = :separation_cause
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
           AND service_to IS NULL
         ORDER BY service_from DESC
         LIMIT 1'
    );
    $close->execute([
        ':service_to' => $effectiveDate,
        ':separation_date' => $effectiveDate,
        ':separation_cause' => $cause,
        ':employee_record_id' => $employeeRecordId,
    ]);

    if ($close->rowCount() > 0) {
        return 'closed';
    }

    // Nothing open: the synthesised period picks up where the last one ended, or at the hire date.
    $latest = $pdo->prepare(
        'SELECT MAX(service_to)
         FROM service_records
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0'
    );
    $latest->execute([':employee_record_id' => $employeeRecordId]);
    $lastServiceTo = employee_date_or_null($latest->fetchColumn());

    $serviceFrom = $lastServiceTo !== null
        ? (new DateTimeImmutable($lastServiceTo))->modify('+1 day')->format('Y-m-d')
        : (employee_date_or_null($employee['dateHired'] ?? null) ?? $effectiveDate);

    // A period cannot start after it ends. Back-dating a separation before the last closed period
    // collapses the new row onto the separation date rather than writing a backwards one.
    if ($serviceFrom > $effectiveDate) {
        $serviceFrom = $effectiveDate;
    }

    // `branch` is left to its column default, the same one the service record screen fills in.
    $insert = $pdo->prepare(
        'INSERT INTO service_records
            (employee_record_id, service_from, service_to, designation_title, employment_status,
             monthly_salary, station, separation_date, separation_cause, designation_id,
             division_id, source, created_by)
         VALUES
            (:employee_record_id, :service_from, :service_to, :designation_title, :employment_status,
             :monthly_salary, :station, :separation_date, :separation_cause, :designation_id,
             :division_id, "system", :created_by)'
    );
    $insert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':service_from' => $serviceFrom,
        ':service_to' => $effectiveDate,
        ':designation_title' => trim((string)($employee['position'] ?? '')),
        ':employment_status' => employee_separation_employment_status($pdo, $employee),
        ':monthly_salary' => $employee['basicSalary'] ?? null,
        ':station' => trim((string)($employee['department'] ?? '')),
        ':separation_date' => $effectiveDate,
        ':separation_cause' => $cause,
        ':designation_id' => $employee['designationId'] ?? null,
        ':division_id' => $employee['divisionId'] ?? null,
        ':created_by' => $createdBy,
    ]);

    return 'created';
}

/**
 * Records a retirement or resignation.
 *
 * The employee record and the service record move together or not at all — a status saying "Retired"
 * against a service record that never ends is the inconsistency this transaction exists to prevent.
 * The linked user account is deliberately left alone: revoking sign-in is what archiving is for, and
 * a retiree often still needs to reach their own payslips and service record.
 */
function employee_separate(PDO $pdo, array $sessionUser, int $id, array $body): void
{
    $type = strtolower(trim((string)($body['separationType'] ?? '')));

    if (!isset(EMPLOYEE_SEPARATION_TYPES[$type])) {
        json_response([
            'success' => false,
            'message' => 'Choose either retirement or resignation.',
        ], 422);
    }

    $employee = fetch_employee($pdo, $id);

    if ($employee === null) {
        json_response([
            'success' => false,
            'message' => 'Employee record not found.',
        ], 404);
    }

    $currentStatus = strtolower(trim((string)($employee['status'] ?? '')));

    if (in_array($currentStatus, ['retired', 'resigned'], true)) {
        json_response([
            'success' => false,
            'message' => sprintf('This employee is already recorded as %s.', $currentStatus),
        ], 422);
    }

    $definition = EMPLOYEE_SEPARATION_TYPES[$type];
    $effectiveDate = employee_date_or_null($body['effectiveDate'] ?? null)
        ?? (new DateTimeImmutable('today'))->format('Y-m-d');

    /*
     * Enforced here as well as in the UI. The button being greyed out is a courtesy; this is the
     * rule, and it is checked against the effective date rather than today so a retirement dated
     * next month is judged on the age the employee will actually be.
     */
    if ($type === 'retirement') {
        $age = employee_age_on_date($employee['dateOfBirth'] ?? null, $effectiveDate);

        if ($age === null) {
            json_response([
                'success' => false,
                'message' => 'This employee has no date of birth on record, so retirement eligibility cannot be confirmed.',
            ], 422);
        }

        if ($age < EMPLOYEE_RETIREMENT_AGE) {
            json_response([
                'success' => false,
                'message' => sprintf(
                    'This employee is %d on %s and is not yet eligible to retire (age %d).',
                    $age,
                    $effectiveDate,
                    EMPLOYEE_RETIREMENT_AGE
                ),
            ], 422);
        }
    }

    $remarks = trim((string)($body['remarks'] ?? ''));
    $cause = $remarks !== '' ? $definition['cause'] . ' - ' . $remarks : $definition['cause'];
    $cause = mb_substr($cause, 0, 255);
    $serviceRecordOutcome = 'skipped';

    try {
        $pdo->beginTransaction();

        $statusUpdate = $pdo->prepare(
            'UPDATE employees SET status = :status WHERE id = :id AND is_archived = 0'
        );
        $statusUpdate->execute([':status' => $definition['status'], ':id' => $id]);

        $serviceRecordOutcome = employee_separation_record(
            $pdo,
            $employee,
            $effectiveDate,
            $cause,
            (int)($sessionUser['id'] ?? 0) ?: null
        );

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        error_log('Employee separation failed: ' . $error->getMessage());
        json_response([
            'success' => false,
            'message' => 'Unable to record the separation.',
        ], 500);
    }

    $employeeName = trim((string)($employee['fullName'] ?? '')) ?: 'An employee';
    $employeeLabel = (string)($employee['employeeId'] ?? ('#' . $id));

    try {
        notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            $type === 'retirement' ? 'Employee Retired' : 'Employee Resigned',
            sprintf(
                '%s (%s) has been recorded as %s effective %s.',
                $employeeName,
                $employeeLabel,
                $definition['verb'],
                $effectiveDate
            ),
            'system_alert',
            (string)$id
        );
    } catch (Throwable $notificationException) {
        error_log('Employee separation notification error: ' . $notificationException->getMessage());
    }

    write_auth_audit(
        $pdo,
        $sessionUser,
        'employee.' . $type,
        sprintf('An employee was recorded as %s.', $definition['verb']),
        [
            'module' => 'rewardsLoyalty',
            'employeeRecordId' => $id,
            'effectiveDate' => $effectiveDate,
            'separationCause' => $cause,
            'serviceRecord' => $serviceRecordOutcome,
        ]
    );

    json_response([
        'success' => true,
        'message' => sprintf('%s has been recorded as %s.', $employeeName, $definition['verb']),
        'serviceRecord' => $serviceRecordOutcome,
        'employee' => fetch_employee($pdo, $id),
    ]);
}

function fetch_employee_linked_user(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.role_id AS roleId,
            r.name AS role,
            u.status,
            u.must_change_password AS mustChangePassword,
            e.employee_id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS full_name,
            d.name AS division,
            des.name AS position,
            e.designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.id = :id
           AND u.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $user = $statement->fetch();

    return $user ?: null;
}

function find_employee_user_by_email(PDO $pdo, string $email): ?array
{
    $email = trim($email);

    if ($email === '') {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id, username, email, role_id AS roleId, status,
                must_change_password AS mustChangePassword, is_archived AS isArchived
         FROM users
         WHERE email COLLATE utf8mb4_unicode_ci = :email
         ORDER BY is_archived ASC, id DESC
         LIMIT 1'
    );
    $statement->execute([':email' => $email]);
    $user = $statement->fetch();

    return $user ?: null;
}

function find_employee_user_for_emails(PDO $pdo, array $emails): ?array
{
    $seenEmails = [];

    foreach ($emails as $email) {
        $email = trim((string)$email);
        $emailKey = strtolower($email);

        if ($email === '' || isset($seenEmails[$emailKey])) {
            continue;
        }

        $seenEmails[$emailKey] = true;
        $user = find_employee_user_by_email($pdo, $email);

        if ($user !== null) {
            return $user;
        }
    }

    return null;
}

function employee_username_is_available(PDO $pdo, string $username, ?int $exceptUserId = null): bool
{
    $sql = 'SELECT COUNT(*) FROM users WHERE username = :username';
    $params = [':username' => $username];

    if ($exceptUserId !== null && $exceptUserId > 0) {
        $sql .= ' AND id <> :id';
        $params[':id'] = $exceptUserId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (int)$statement->fetchColumn() === 0;
}

function employee_limited_username(string $baseUsername, string $suffix = ''): string
{
    $baseUsername = preg_replace('/\s+/', ' ', trim($baseUsername)) ?? '';
    $suffix = preg_replace('/\s+/', ' ', trim($suffix)) ?? '';
    $maxLength = 100;

    if ($suffix === '') {
        return substr($baseUsername, 0, $maxLength);
    }

    $suffix = substr($suffix, 0, $maxLength);
    $baseLimit = max(0, $maxLength - strlen($suffix) - 1);
    $base = trim(substr($baseUsername, 0, $baseLimit));

    return trim($base . ' ' . $suffix);
}

function employee_unique_username(PDO $pdo, string $baseUsername, string $employeeCode, ?int $exceptUserId = null): string
{
    $baseUsername = trim($baseUsername) !== '' ? trim($baseUsername) : $employeeCode;
    $baseUsername = trim($baseUsername) !== '' ? trim($baseUsername) : 'Employee';
    $employeeCode = trim($employeeCode);

    $candidates = [
        employee_limited_username($baseUsername),
    ];

    if ($employeeCode !== '') {
        $candidates[] = employee_limited_username($baseUsername, $employeeCode);
    }

    for ($index = 2; $index <= 50; $index++) {
        $suffix = $employeeCode !== '' ? $employeeCode . ' ' . $index : (string)$index;
        $candidates[] = employee_limited_username($baseUsername, $suffix);
    }

    foreach ($candidates as $candidate) {
        if ($candidate !== '' && employee_username_is_available($pdo, $candidate, $exceptUserId)) {
            return $candidate;
        }
    }

    return employee_limited_username($baseUsername, bin2hex(random_bytes(4)));
}

/*
 * Resolving the length reads the security settings, which is a query per call. The CSV import
 * issues one password per row, so it resolves the length once and generates from it.
 */
function employee_temporary_password_length(PDO $pdo): int
{
    $maximumLength = security_settings($pdo)['maximumPasswordLength'];

    return max(6, min(12, $maximumLength));
}

function employee_generate_temporary_password(int $targetLength): string
{
    $randomLength = max(2, $targetLength - 4);
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $randomText = '';

    for ($index = 0; $index < $randomLength; $index++) {
        $randomText .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }

    return substr('Tmp' . $randomText . '!', 0, $targetLength);
}

function employee_temporary_password(PDO $pdo): string
{
    return employee_generate_temporary_password(employee_temporary_password_length($pdo));
}

function employee_account_activation_details(array $employee, array $user): array
{
    return [
        'employeeName' => trim((string)($employee['fullName'] ?? $user['username'] ?? '')),
        'employeeId' => trim((string)($employee['employeeId'] ?? '')),
        'employeeEmail' => trim((string)($employee['email'] ?? $user['email'] ?? '')),
        'position' => trim((string)($employee['position'] ?? '')),
        'division' => trim((string)($employee['department'] ?? '')),
        'accessRole' => trim((string)($user['role'] ?? 'Employee')),
    ];
}

function upsert_employee_linked_user(
    PDO $pdo,
    array $employee,
    int $roleId,
    ?string $previousEmail = null,
    bool $issueTemporaryPassword = false
): ?array {
    if ($roleId <= 0) {
        return null;
    }

    $email = trim((string)($employee['email'] ?? ''));

    if ($email === '') {
        throw new RuntimeException('Employee email is required to create a linked user account.');
    }

    $employeeCode = trim((string)($employee['employeeId'] ?? ''));
    $baseUsername = trim((string)($employee['fullName'] ?? ''));
    $existingUser = find_employee_user_for_emails($pdo, [$email, (string)$previousEmail]);
    $existingUserId = $existingUser !== null ? (int)$existingUser['id'] : null;
    /*
     * An account that already exists keeps whatever it is set to -- re-saving an employee must not
     * quietly reactivate someone HR deactivated. A new one starts Active.
     */
    $status = $existingUser !== null
        ? normalize_user_status($existingUser['status'] ?? null)
        : HRIS_USER_STATUS_ACTIVE;
    $username = employee_unique_username($pdo, $baseUsername !== '' ? $baseUsername : $email, $employeeCode, $existingUserId);

    if ($existingUser !== null) {
        $temporaryPassword = '';
        $mustChangePassword = (int)(
            ($existingUser['mustChangePassword'] ?? false) === true
            || (string)($existingUser['mustChangePassword'] ?? '0') === '1'
        );

        if ($issueTemporaryPassword) {
            $temporaryPassword = employee_temporary_password($pdo);
            $passwordLengthError = password_length_error($pdo, $temporaryPassword, 6);

            if ($passwordLengthError !== null) {
                throw new RuntimeException($passwordLengthError);
            }

            // Handing out a fresh temporary password is a deliberate reactivation of the account.
            $status = HRIS_USER_STATUS_ACTIVE;
            $mustChangePassword = 1;
        }

        $emailChanged = strcasecmp(trim((string)($existingUser['email'] ?? '')), $email) !== 0;
        $query = 'UPDATE users
             SET username = :username,
                 email = :email,
                 role_id = :role_id,
                 status = :status,
                 must_change_password = :must_change_password,
                 is_archived = 0';

        if ($emailChanged) {
            $query .= ',
                 email_verified_at = NULL,
                 email_updated_at = CURRENT_TIMESTAMP';
        }

        if ($temporaryPassword !== '') {
            $query .= ',
                 password_hash = :password_hash,
                 password_changed_at = CURRENT_TIMESTAMP,
                 failed_login_attempts = 0,
                 locked_until = NULL';
        }

        $query .= '
             WHERE id = :id';

        $params = [
            ':username' => $username,
            ':email' => $email,
            ':role_id' => $roleId,
            ':status' => $status,
            ':must_change_password' => $mustChangePassword,
            ':id' => $existingUserId,
        ];

        if ($temporaryPassword !== '') {
            $params[':password_hash'] = password_hash($temporaryPassword, PASSWORD_DEFAULT);
        }

        $statement = $pdo->prepare($query);
        $statement->execute($params);

        return [
            'created' => false,
            'temporaryPassword' => $temporaryPassword,
            'user' => fetch_employee_linked_user($pdo, $existingUserId),
            'message' => $temporaryPassword !== ''
                ? 'Linked account updated with a new temporary password.'
                : 'Linked account role updated.',
        ];
    }

    $temporaryPassword = employee_temporary_password($pdo);
    $passwordLengthError = password_length_error($pdo, $temporaryPassword, 6);

    if ($passwordLengthError !== null) {
        throw new RuntimeException($passwordLengthError);
    }

    $statement = $pdo->prepare(
        'INSERT INTO users
            (username, email, password_hash, role_id, status, must_change_password, password_changed_at)
         VALUES
            (:username, :email, :password_hash, :role_id, :status, 1, CURRENT_TIMESTAMP)'
    );
    $statement->execute([
        ':username' => $username,
        ':email' => $email,
        ':password_hash' => password_hash($temporaryPassword, PASSWORD_DEFAULT),
        ':role_id' => $roleId,
        ':status' => $status,
    ]);

    $userId = (int)$pdo->lastInsertId();

    return [
        'created' => true,
        'temporaryPassword' => $temporaryPassword,
        'user' => fetch_employee_linked_user($pdo, $userId),
        'message' => 'Linked account created.',
    ];
}

/*
 * An employee edit that carries no role never reaches upsert_employee_linked_user(), so the address
 * would land in `employees` only. `users.email` is what the profile Security tab, login, and every
 * OTP mail read, and the two tables are joined by email, so leaving it behind orphans the account
 * and keeps the old address working as a sign-in name. This syncs the address and nothing else --
 * role, status and password are untouched, unlike the upsert path.
 */
function sync_employee_linked_user_email(PDO $pdo, array $employee, string $previousEmail): ?array
{
    $email = trim((string)($employee['email'] ?? ''));
    $previousEmail = trim($previousEmail);

    if ($email === '' || strcasecmp($email, $previousEmail) === 0) {
        return null;
    }

    $existingUser = find_employee_user_for_emails($pdo, [$previousEmail, $email]);

    if ($existingUser === null) {
        return null;
    }

    $userId = (int)$existingUser['id'];
    $currentUsername = trim((string)($existingUser['username'] ?? ''));
    /*
     * Accounts seeded from the directory use the address as the username, and login accepts either
     * one, so an untouched username would let the old address sign in. A username HR set by hand is
     * left alone, and so is one the new address would collide with.
     */
    $username = $currentUsername;

    if (
        strcasecmp($currentUsername, $previousEmail) === 0
        && employee_username_is_available($pdo, $email, $userId)
    ) {
        $username = $email;
    }

    $statement = $pdo->prepare(
        'UPDATE users
         SET username = :username,
             email = :email,
             email_verified_at = NULL,
             email_updated_at = CURRENT_TIMESTAMP
         WHERE id = :id'
    );
    $statement->execute([
        ':username' => $username,
        ':email' => $email,
        ':id' => $userId,
    ]);

    return [
        'created' => false,
        'temporaryPassword' => '',
        'user' => fetch_employee_linked_user($pdo, $userId),
        'message' => 'Linked account email updated.',
    ];
}

function employee_linked_account_response(?array $linkedAccount, array $employee, bool $sendActivationEmail): array
{
    if ($linkedAccount === null) {
        return [
            'linkedUser' => null,
            'accountMessage' => '',
            'accountWarning' => '',
            'emailNotification' => null,
            'emailMessage' => '',
            'temporaryPassword' => '',
        ];
    }

    $linkedUser = $linkedAccount['user'] ?? null;
    $temporaryPassword = (string)($linkedAccount['temporaryPassword'] ?? '');
    $accountMessage = (string)($linkedAccount['message'] ?? '');
    $emailNotification = null;
    $emailMessage = '';

    if (($linkedAccount['created'] ?? false) === true || $temporaryPassword !== '') {
        if ($sendActivationEmail && is_array($linkedUser) && $temporaryPassword !== '') {
            try {
                send_employee_account_activation_email(
                    trim((string)($linkedUser['email'] ?? $employee['email'] ?? '')),
                    employee_account_activation_details($employee, $linkedUser),
                    $temporaryPassword
                );
                $emailNotification = 'sent';
                $emailMessage = 'Activation email sent to the employee.';
                $accountMessage = ($linkedAccount['created'] ?? false) === true
                    ? 'Linked account created and activation email sent.'
                    : 'Linked account updated and activation email sent.';
            } catch (Throwable $exception) {
                error_log('Employee activation email failed: ' . $exception->getMessage());
                $emailNotification = 'warning';
                $emailMessage = 'Activation email could not be sent. ' . $exception->getMessage();
                $accountMessage = ($linkedAccount['created'] ?? false) === true
                    ? 'Linked account created.'
                    : 'Linked account updated with a new temporary password.';
            }
        } elseif ($temporaryPassword !== '') {
            $accountMessage = ($linkedAccount['created'] ?? false) === true
                ? 'Linked account created.'
                : 'Linked account updated with a new temporary password.';
        }
    }

    return [
        'linkedUser' => $linkedUser,
        'accountMessage' => $accountMessage,
        'accountWarning' => '',
        'emailNotification' => $emailNotification,
        'emailMessage' => $emailMessage,
        'temporaryPassword' => $temporaryPassword,
    ];
}

function insert_employee_record(PDO $pdo, array $employee, bool $initializeLeaveCredits = true): int
{
    $statement = $pdo->prepare(
        'INSERT INTO employees
            (employee_id, first_name, middle_name, last_name, suffix, date_of_birth, address, city,
             province, zip_code, gender, email, phone, division_id, designation_id, designation,
             basic_salary, salary_rate, date_hired, status, employment_status, pwd,
             civil_status, height, weight, blood_type, emp_gsis_id_no, emp_pagibig_id_no,
             emp_philhealth_id_no, tin_no)
         VALUES
            (:employee_id, :first_name, :middle_name, :last_name, :suffix, :date_of_birth, :address, :city,
             :province, :zip_code, :gender, :email, :phone, :division_id, :designation_id, :designation,
             :basic_salary, :salary_rate, :date_hired, :status, :employment_status, :pwd,
             :civil_status, :height, :weight, :blood_type, :emp_gsis_id_no, :emp_pagibig_id_no,
             :emp_philhealth_id_no, :tin_no)'
    );
    $statement->execute(array_combine(
        array_map(fn (string $key): string => ':' . $key, array_keys($employee)),
        array_values($employee)
    ));

    $employeeId = (int)$pdo->lastInsertId();

    if ($initializeLeaveCredits) {
        ensure_employee_default_leave_credits($pdo, $employeeId, null, true);
        recalculate_employee_leave_credit_usage($pdo, $employeeId);
    }

    return $employeeId;
}

/**
 * New imports cannot have leave requests yet, so their opening balances are known to have zero
 * usage. Insert all of those balances in a few bulk statements instead of running the full
 * leave-credit recalculation (and its lookup queries) for every row. They are new employees, so
 * vacation and sick leave open at 0 (leave_credit_new_employee_opening_totals()).
 */
function initialize_imported_employee_leave_credits(PDO $pdo, array $employeeIds): void
{
    $employeeIds = array_values(array_unique(array_filter(
        array_map('intval', $employeeIds),
        static fn (int $employeeId): bool => $employeeId > 0
    )));

    if ($employeeIds === []) {
        return;
    }

    $trackedTypes = leave_credit_type_rows($pdo);
    if ($trackedTypes === []) {
        return;
    }

    $year = leave_credit_resolve_year();

    foreach (array_chunk($employeeIds, 100) as $employeeIdChunk) {
        $valueSql = [];
        $params = [];

        foreach ($employeeIdChunk as $employeeId) {
            foreach ($trackedTypes as $definitionCode => $trackedType) {
                $valueSql[] = '(?, ?, ?, ?, 0.00)';
                $params[] = $employeeId;
                $params[] = (int)$trackedType['leave_type_id'];
                $params[] = $year;
                $params[] = leave_credit_opening_total((string)$definitionCode, $trackedType, true);
            }
        }

        $statement = $pdo->prepare(
            'INSERT INTO leave_credits
                (employee_id, leave_type_id, year, total_credits, used_credits)
             VALUES ' . implode(', ', $valueSql) . '
             ON DUPLICATE KEY UPDATE total_credits = total_credits'
        );
        $statement->execute($params);
    }
}

function employee_csv_header_key(mixed $value): string
{
    $text = preg_replace('/^\xEF\xBB\xBF/', '', (string)($value ?? '')) ?? '';
    return strtolower(preg_replace('/[^a-z0-9]+/i', '', $text) ?? '');
}

function employee_csv_canonical_key(mixed $value): string
{
    $key = employee_csv_header_key($value);
    $aliases = [
        'employeeid' => 'employeeId',
        'firstname' => 'firstName',
        'middlename' => 'middleName',
        'lastname' => 'lastName',
        'suffix' => 'suffix',
        'nameextension' => 'suffix',
        'extensionname' => 'suffix',
        'dateofbirth' => 'dateOfBirth',
        'birthdate' => 'dateOfBirth',
        'dob' => 'dateOfBirth',
        'address' => 'address',
        'barangay' => 'address',
        'city' => 'city',
        'municipality' => 'city',
        'province' => 'province',
        'zipcode' => 'zipCode',
        'gender' => 'gender',
        'email' => 'email',
        'emailaddress' => 'email',
        'phone' => 'phone',
        'phonenumber' => 'phone',
        'contactnumber' => 'phone',
        'roleid' => 'roleId',
        'accountroleid' => 'roleId',
        'userroleid' => 'roleId',
        'role' => 'roleName',
        'rolename' => 'roleName',
        'accountrole' => 'roleName',
        'userrole' => 'roleName',
        'accessrole' => 'roleName',
        'divisionid' => 'divisionId',
        'departmentid' => 'divisionId',
        'division' => 'divisionName',
        'department' => 'divisionName',
        'divisionname' => 'divisionName',
        'departmentname' => 'divisionName',
        // designationId / designationName are the position (see employee_payload()).
        'designationid' => 'designationId',
        'positionid' => 'designationId',
        'position' => 'designationName',
        'positiontitle' => 'designationName',
        'jobtitle' => 'designationName',
        'designationname' => 'designationName',
        'positionname' => 'designationName',
        'designation' => 'designation',
        'basicsalary' => 'basicSalary',
        'salaryrate' => 'salaryRate',
        'datehired' => 'dateHired',
        'hiredate' => 'dateHired',
        'status' => 'status',
        'employmentstatus' => 'employmentStatus',
        'pwd' => 'pwd',
        'civilstatus' => 'civilStatus',
        'height' => 'height',
        'weight' => 'weight',
        'bloodtype' => 'bloodType',
        'empgsisidno' => 'gsisIdNo',
        'gsisidno' => 'gsisIdNo',
        'gsis' => 'gsisIdNo',
        'emppagibigidno' => 'pagibigIdNo',
        'pagibigidno' => 'pagibigIdNo',
        'pagibig' => 'pagibigIdNo',
        'empphilhealthidno' => 'philhealthIdNo',
        'philhealthidno' => 'philhealthIdNo',
        'philhealth' => 'philhealthIdNo',
        'tinno' => 'tinNo',
        'tin' => 'tinNo',
    ];

    return $aliases[$key] ?? '';
}

/**
 * Files exported before positions and designations were separate carry the position in a column
 * headed "Designation". A file with no position column of its own is one of those, so its
 * "Designation" column is read as the position rather than dropped.
 */
function employee_csv_legacy_position_header(array $headers): array
{
    if (in_array('designationName', $headers, true) || in_array('designationId', $headers, true)) {
        return $headers;
    }

    $legacyIndex = array_search('designation', $headers, true);

    if ($legacyIndex !== false) {
        $headers[$legacyIndex] = 'designationName';
    }

    return $headers;
}

function employee_csv_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function employee_csv_truthy(mixed $value): string
{
    return employee_bool($value) ? '1' : '0';
}

function employee_csv_date(mixed $value): string
{
    $text = employee_csv_text($value);

    if ($text === '') {
        return '';
    }

    /*
     * XLSX stores normal date cells as a day count from Excel's 1900 epoch.  The workbook reader
     * intentionally returns raw cell values, so convert plausible serial dates here where the
     * column is known to be date_of_birth or date_hired.  The lower bound avoids interpreting a
     * four-digit year such as "2026" as a date in 1905.
     */
    if (is_numeric($text)) {
        $serial = (float)$text;
        if ($serial >= 10_000 && $serial <= 100_000) {
            $days = (int)floor($serial);
            $excelEpoch = new DateTimeImmutable('1899-12-30', new DateTimeZone('UTC'));

            return $excelEpoch->modify("+{$days} days")->format('Y-m-d');
        }
    }

    $formats = ['Y-m-d', 'm/d/Y', 'n/j/Y', 'd/m/Y', 'j/n/Y', 'm-d-Y', 'n-j-Y'];
    foreach ($formats as $format) {
        $date = DateTimeImmutable::createFromFormat('!' . $format, $text);
        $errors = DateTimeImmutable::getLastErrors();
        $isValid = $errors === false
            || ((int)$errors['warning_count'] === 0 && (int)$errors['error_count'] === 0);

        if ($date instanceof DateTimeImmutable && $isValid) {
            return $date->format('Y-m-d');
        }
    }

    $timestamp = strtotime($text);
    return $timestamp === false ? $text : date('Y-m-d', $timestamp);
}

function employee_csv_find_division_id(PDO $pdo, string $value): int
{
    $text = employee_csv_text($value);
    if ($text === '') {
        return 0;
    }

    if (ctype_digit($text)) {
        return (int)$text;
    }

    static $cache = [];
    $cacheKey = spl_object_id($pdo) . ':' . strtolower($text);

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    // Native prepares are on, so the same placeholder cannot fill two markers — bind one per marker.
    $statement = $pdo->prepare(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
           AND (name COLLATE utf8mb4_unicode_ci = :name_value
                OR code COLLATE utf8mb4_unicode_ci = :code_value)
         ORDER BY id
         LIMIT 1'
    );
    $statement->execute([
        ':name_value' => $text,
        ':code_value' => $text,
    ]);

    $cache[$cacheKey] = (int)$statement->fetchColumn();
    return $cache[$cacheKey];
}

function employee_csv_find_designation_id(PDO $pdo, string $value, int $divisionId): int
{
    $text = employee_csv_text($value);
    if ($text === '') {
        return 0;
    }

    if (ctype_digit($text)) {
        return (int)$text;
    }

    static $cache = [];
    $cacheKey = spl_object_id($pdo) . ':' . $divisionId . ':' . strtolower($text);

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $sql = 'SELECT id
            FROM designations
            WHERE is_archived = 0
              AND name COLLATE utf8mb4_unicode_ci = :value';
    $params = [':value' => $text];

    if ($divisionId > 0) {
        $sql .= ' AND division_id = :division_id';
        $params[':division_id'] = $divisionId;
    }

    $sql .= ' ORDER BY id LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    $cache[$cacheKey] = (int)$statement->fetchColumn();
    return $cache[$cacheKey];
}

function employee_csv_designation_belongs_to_division(PDO $pdo, int $designationId, int $divisionId): bool
{
    if ($designationId <= 0 || $divisionId <= 0) {
        return false;
    }

    static $cache = [];
    $cacheKey = spl_object_id($pdo) . ':' . $designationId . ':' . $divisionId;

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM designations
         WHERE id = :designation_id
           AND division_id = :division_id
           AND is_archived = 0'
    );
    $statement->execute([
        ':designation_id' => $designationId,
        ':division_id' => $divisionId,
    ]);

    $cache[$cacheKey] = (int)$statement->fetchColumn() > 0;
    return $cache[$cacheKey];
}

function employee_csv_default_designation_id(PDO $pdo, int $divisionId): int
{
    if ($divisionId <= 0) {
        return 0;
    }

    static $cache = [];
    $cacheKey = spl_object_id($pdo) . ':' . $divisionId;

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM designations
         WHERE division_id = :division_id
           AND is_archived = 0
         ORDER BY id
         LIMIT 1'
    );
    $statement->execute([':division_id' => $divisionId]);

    $cache[$cacheKey] = (int)$statement->fetchColumn();
    return $cache[$cacheKey];
}

function employee_csv_default_division_id(PDO $pdo): int
{
    static $cache = [];
    $cacheKey = spl_object_id($pdo);

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $statement = $pdo->query(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
         ORDER BY id
         LIMIT 1'
    );

    $cache[$cacheKey] = $statement !== false ? (int)$statement->fetchColumn() : 0;
    return $cache[$cacheKey];
}

function employee_csv_find_role_id(PDO $pdo, string $value): int
{
    $text = employee_csv_text($value);
    if ($text === '') {
        return 0;
    }

    if (ctype_digit($text)) {
        return (int)$text;
    }

    $roleKey = strtolower(preg_replace('/[^a-z0-9]+/i', '', $text) ?? '');
    if ($roleKey === '') {
        return 0;
    }

    static $cache = [];
    $cacheKey = spl_object_id($pdo) . ':' . $roleKey;

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM roles
         WHERE LOWER(REPLACE(name, " ", "")) = :role_key
         ORDER BY id
         LIMIT 1'
    );
    $statement->execute([':role_key' => $roleKey]);

    $cache[$cacheKey] = (int)$statement->fetchColumn();
    return $cache[$cacheKey];
}

function employee_csv_body(PDO $pdo, array $headers, array $row): array
{
    $body = [];

    foreach ($headers as $index => $key) {
        if ($key === '') {
            continue;
        }

        $body[$key] = employee_csv_text($row[$index] ?? '');
    }

    if (isset($body['dateOfBirth'])) {
        $body['dateOfBirth'] = employee_csv_date($body['dateOfBirth']);
    }

    if (isset($body['dateHired'])) {
        $body['dateHired'] = employee_csv_date($body['dateHired']);
    }

    if (isset($body['pwd'])) {
        $body['pwd'] = employee_csv_truthy($body['pwd']);
    }

    $divisionId = (int)($body['divisionId'] ?? 0);
    if ($divisionId <= 0) {
        $divisionId = employee_csv_find_division_id($pdo, (string)($body['divisionName'] ?? ''));
    }

    $designationId = (int)($body['designationId'] ?? 0);
    if ($designationId <= 0) {
        $designationId = employee_csv_find_designation_id($pdo, (string)($body['designationName'] ?? ''), $divisionId);
    }

    if (
        $designationId > 0
        && $divisionId > 0
        && !employee_csv_designation_belongs_to_division($pdo, $designationId, $divisionId)
    ) {
        $designationId = employee_csv_default_designation_id($pdo, $divisionId);
    }

    $body['divisionId'] = $divisionId;
    $body['designationId'] = $designationId;

    return $body;
}

function employee_duplicate_exists(PDO $pdo, array $employee): bool
{
    $statement = $pdo->prepare(
        'SELECT id
         FROM employees
         WHERE employee_id COLLATE utf8mb4_unicode_ci = :employee_id
            OR email COLLATE utf8mb4_unicode_ci = :email
         LIMIT 1'
    );
    $statement->execute([
        ':employee_id' => (string)($employee['employee_id'] ?? ''),
        ':email' => (string)($employee['email'] ?? ''),
    ]);

    return (bool)$statement->fetchColumn();
}

function employee_import_employee_role_id(PDO $pdo): int
{
    $statement = $pdo->query(
        'SELECT id
         FROM roles
         WHERE LOWER(REPLACE(name, " ", "")) = "employee"
         ORDER BY id
         LIMIT 1'
    );

    return $statement !== false ? (int)$statement->fetchColumn() : 0;
}

/**
 * Read the existing unique values once for the whole file. The database constraints remain the
 * final protection against concurrent imports, while this index avoids up to three SELECTs for
 * every ordinary row and also catches duplicates within the uploaded file.
 */
function employee_import_duplicate_index(PDO $pdo): array
{
    $index = [
        'employeeIds' => [],
        'employeeEmails' => [],
        'userEmails' => [],
        'usernames' => [],
    ];

    $employeeStatement = $pdo->query('SELECT employee_id, email FROM employees');
    if ($employeeStatement !== false) {
        foreach ($employeeStatement->fetchAll() as $row) {
            $employeeId = strtolower(trim((string)($row['employee_id'] ?? '')));
            $email = strtolower(trim((string)($row['email'] ?? '')));

            if ($employeeId !== '') {
                $index['employeeIds'][$employeeId] = true;
            }
            if ($email !== '') {
                $index['employeeEmails'][$email] = true;
            }
        }
    }

    $userStatement = $pdo->query('SELECT email, username FROM users');
    if ($userStatement !== false) {
        foreach ($userStatement->fetchAll() as $row) {
            $email = strtolower(trim((string)($row['email'] ?? '')));
            $username = strtolower(trim((string)($row['username'] ?? '')));

            if ($email !== '') {
                $index['userEmails'][$email] = true;
            }
            if ($username !== '') {
                $index['usernames'][$username] = true;
            }
        }
    }

    return $index;
}

function employee_import_duplicate_reason(PDO $pdo, array $employee, ?array &$duplicateIndex = null): ?string
{
    $employeeId = trim((string)($employee['employee_id'] ?? ''));
    $email = trim((string)($employee['email'] ?? ''));

    if ($duplicateIndex !== null) {
        $employeeIdKey = strtolower($employeeId);
        $emailKey = strtolower($email);

        if ($employeeIdKey !== '' && isset($duplicateIndex['employeeIds'][$employeeIdKey])) {
            return "Employee ID {$employeeId} already exists.";
        }

        if ($emailKey !== '' && isset($duplicateIndex['employeeEmails'][$emailKey])) {
            return "Employee email {$email} already exists.";
        }

        if (
            $emailKey !== ''
            && (isset($duplicateIndex['userEmails'][$emailKey]) || isset($duplicateIndex['usernames'][$emailKey]))
        ) {
            return "User account for {$email} already exists.";
        }

        if ($employeeIdKey !== '') {
            $duplicateIndex['employeeIds'][$employeeIdKey] = true;
        }
        if ($emailKey !== '') {
            $duplicateIndex['employeeEmails'][$emailKey] = true;
            $duplicateIndex['userEmails'][$emailKey] = true;
            $duplicateIndex['usernames'][$emailKey] = true;
        }

        return null;
    }

    if ($employeeId !== '') {
        $statement = $pdo->prepare(
            'SELECT COUNT(*)
             FROM employees
             WHERE employee_id COLLATE utf8mb4_unicode_ci = :employee_id'
        );
        $statement->execute([':employee_id' => $employeeId]);

        if ((int)$statement->fetchColumn() > 0) {
            return "Employee ID {$employeeId} already exists.";
        }
    }

    if ($email !== '') {
        $statement = $pdo->prepare(
            'SELECT COUNT(*)
             FROM employees
             WHERE email COLLATE utf8mb4_unicode_ci = :email'
        );
        $statement->execute([':email' => $email]);

        if ((int)$statement->fetchColumn() > 0) {
            return "Employee email {$email} already exists.";
        }

        $statement = $pdo->prepare(
            'SELECT COUNT(*)
             FROM users
             WHERE email COLLATE utf8mb4_unicode_ci = :email
                OR username COLLATE utf8mb4_unicode_ci = :username'
        );
        $statement->execute([
            ':email' => $email,
            ':username' => $email,
        ]);

        if ((int)$statement->fetchColumn() > 0) {
            return "User account for {$email} already exists.";
        }
    }

    return null;
}

function employee_import_name_piece(string $value, string $fallback): string
{
    $text = preg_replace('/[^a-z0-9]+/i', ' ', $value) ?? '';
    $text = trim(preg_replace('/\s+/', ' ', $text) ?? '');

    return $text === '' ? $fallback : ucwords(strtolower($text));
}

function employee_import_apply_defaults(PDO $pdo, array $employee): array
{
    $email = trim((string)($employee['email'] ?? ''));
    $emailLocalPart = $email !== '' ? strstr($email, '@', true) : false;
    $nameSeed = $emailLocalPart !== false && $emailLocalPart !== ''
        ? $emailLocalPart
        : trim((string)($employee['employee_id'] ?? ''));
    $nameParts = preg_split('/[^a-z0-9]+/i', $nameSeed, -1, PREG_SPLIT_NO_EMPTY) ?: [];

    if (trim((string)($employee['first_name'] ?? '')) === '') {
        $employee['first_name'] = employee_import_name_piece((string)($nameParts[0] ?? ''), 'Imported');
    }

    if (trim((string)($employee['last_name'] ?? '')) === '') {
        $lastNamePart = count($nameParts) > 1 ? (string)end($nameParts) : '';
        $employee['last_name'] = employee_import_name_piece($lastNamePart, 'Employee');
    }

    if ((int)($employee['division_id'] ?? 0) <= 0) {
        $employee['division_id'] = employee_csv_default_division_id($pdo);
    }

    if ((int)($employee['designation_id'] ?? 0) <= 0 && (int)($employee['division_id'] ?? 0) > 0) {
        $employee['designation_id'] = employee_csv_default_designation_id($pdo, (int)$employee['division_id']);
    }

    if (
        (int)($employee['designation_id'] ?? 0) > 0
        && (int)($employee['division_id'] ?? 0) > 0
        && !employee_csv_designation_belongs_to_division(
            $pdo,
            (int)$employee['designation_id'],
            (int)$employee['division_id']
        )
    ) {
        $employee['designation_id'] = employee_csv_default_designation_id($pdo, (int)$employee['division_id']);
    }

    return $employee;
}

function employee_import_payload_errors(PDO $pdo, array $employee, ?array $emailDomainPolicy = null): array
{
    $errors = [];

    if (trim((string)($employee['employee_id'] ?? '')) === '') {
        $errors[] = 'Employee ID is required.';
    }

    if (trim((string)($employee['first_name'] ?? '')) === '') {
        $errors[] = 'First name is required.';
    }

    if (trim((string)($employee['last_name'] ?? '')) === '') {
        $errors[] = 'Last name is required.';
    }

    if (
        trim((string)($employee['email'] ?? '')) === ''
        || filter_var($employee['email'], FILTER_VALIDATE_EMAIL) === false
    ) {
        $errors[] = 'Valid email is required.';
    } else {
        $emailPolicyViolation = email_domain_policy_violation(
            $pdo,
            (string)$employee['email'],
            $emailDomainPolicy
        );
        if ($emailPolicyViolation !== null) {
            $errors[] = $emailPolicyViolation;
        }
    }

    if ((int)($employee['division_id'] ?? 0) <= 0) {
        $errors[] = 'Division is required or no active default division is available.';
    }

    if ((int)($employee['designation_id'] ?? 0) <= 0) {
        $errors[] = 'Position is required or no active default position is available.';
    }

    if ((int)($employee['division_id'] ?? 0) > 0 && (int)($employee['designation_id'] ?? 0) > 0) {
        if (!employee_csv_designation_belongs_to_division(
            $pdo,
            (int)$employee['designation_id'],
            (int)$employee['division_id']
        )) {
            $errors[] = 'Selected position does not belong to the selected division.';
        }
    }

    if (mb_strlen((string)($employee['designation'] ?? '')) > EMPLOYEE_DESIGNATION_MAX_LENGTH) {
        $errors[] = sprintf('Designation must be %d characters or fewer.', EMPLOYEE_DESIGNATION_MAX_LENGTH);
    }

    return $errors;
}

function employee_import_role_id(PDO $pdo, array $body, int $defaultRoleId): int
{
    $roleId = (int)($body['roleId'] ?? 0);
    if ($roleId <= 0) {
        $roleId = employee_csv_find_role_id($pdo, (string)($body['roleName'] ?? ''));
    }

    if ($roleId <= 0) {
        return $defaultRoleId;
    }

    return employee_role_exists($pdo, $roleId) ? $roleId : 0;
}

/**
 * The activation email is the only place an imported account's temporary password appears, so the
 * caller gets it back here to hand to send_employee_account_activation_emails() after the commit.
 *
 * @return array{id: int, temporaryPassword: string}
 */
function create_imported_employee_user(PDO $pdo, array $employee, int $roleId, string $temporaryPassword): array
{
    $email = trim((string)($employee['email'] ?? ''));

    if ($email === '') {
        throw new RuntimeException('Employee email is required to create the imported user account.');
    }

    if ($roleId <= 0) {
        throw new RuntimeException('Default Employee role is not available.');
    }

    $statement = $pdo->prepare(
        'INSERT INTO users
            (username, email, password_hash, role_id, status, must_change_password,
             password_changed_at, failed_login_attempts, locked_until, is_archived)
         VALUES
            (:username, :email, :password_hash, :role_id, :status, 1,
             CURRENT_TIMESTAMP, 0, NULL, 0)'
    );
    $statement->execute([
        ':username' => $email,
        ':email' => $email,
        ':password_hash' => password_hash($temporaryPassword, PASSWORD_DEFAULT),
        ':role_id' => $roleId,
        ':status' => HRIS_USER_STATUS_ACTIVE,
    ]);

    return [
        'id' => (int)$pdo->lastInsertId(),
        'temporaryPassword' => $temporaryPassword,
    ];
}

/**
 * Account details for the activation email, read back from the row fetch_employee_linked_user()
 * returns so the division, position and role names match what was actually saved.
 */
function employee_import_activation_details(array $user): array
{
    return [
        'employeeName' => trim((string)($user['full_name'] ?? $user['username'] ?? '')),
        'employeeId' => trim((string)($user['employee_id'] ?? '')),
        'employeeEmail' => trim((string)($user['email'] ?? '')),
        'position' => trim((string)($user['position'] ?? '')),
        'division' => trim((string)($user['division'] ?? '')),
        'accessRole' => trim((string)($user['role'] ?? 'Employee')),
    ];
}

/**
 * Finish the parts of an import that do not affect whether its rows were saved. defer() runs this
 * only after json_response() has delivered the result and released the session lock, so SMTP and
 * notification delivery no longer keep the Import button spinning.
 */
function complete_employee_import_delivery(
    PDO $pdo,
    array $createdAccounts,
    array $createdUserIds,
    ?array $actor
): void {
    // Shared hosts may disable it; `@` does not stop PHP 8's fatal for a disabled function.
    if (function_exists('set_time_limit')) {
        @set_time_limit(0);
    }

    try {
        if ($createdUserIds !== []) {
            notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Employees Imported',
                sprintf(
                    '%d employee record%s imported from CSV/XLSX.',
                    count($createdUserIds),
                    count($createdUserIds) === 1 ? '' : 's'
                ),
                'employee_added',
                'employee-import'
            );

        }
    } catch (Throwable $notificationException) {
        error_log('Employee import notification error: ' . $notificationException->getMessage());
    }

    if ($createdAccounts === []) {
        return;
    }

    $recipients = [];

    foreach ($createdAccounts as $index => $account) {
        $linkedUser = fetch_employee_linked_user($pdo, (int)$account['userId']);
        $recipients[$index] = [
            'email' => $linkedUser !== null
                ? trim((string)($linkedUser['email'] ?? $account['email']))
                : (string)$account['email'],
            'employee' => $linkedUser !== null
                ? employee_import_activation_details($linkedUser)
                : ['employeeEmail' => (string)$account['email']],
            'temporaryPassword' => (string)$account['temporaryPassword'],
        ];
    }

    try {
        $failures = send_employee_account_activation_emails($recipients);
    } catch (Throwable $exception) {
        error_log('Employee import activation email error: ' . $exception->getMessage());
        $failures = array_fill_keys(array_keys($recipients), $exception->getMessage());
    }

    foreach ($failures as $index => $reason) {
        $account = $createdAccounts[$index] ?? [];
        error_log(sprintf(
            'Employee import line %d activation email to %s failed: %s',
            (int)($account['line'] ?? 0),
            (string)($account['email'] ?? ''),
            (string)$reason
        ));
    }

    $sentCount = count($recipients) - count($failures);
    $failedCount = count($failures);

    if ($failedCount > 0) {
        try {
            notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Activation Emails Need Attention',
                sprintf(
                    '%d employee activation email%s could not be sent. Reissue credentials from the employee record.',
                    $failedCount,
                    $failedCount === 1 ? '' : 's'
                ),
                'user_created',
                'employee-import-email-failed'
            );
        } catch (Throwable $notificationException) {
            error_log('Employee import email-failure notification error: ' . $notificationException->getMessage());
        }
    }

    write_auth_audit(
        $pdo,
        $actor,
        'employee.import.activation_emails',
        sprintf(
            '%d employee activation email%s sent; %d failed.',
            $sentCount,
            $sentCount === 1 ? '' : 's',
            $failedCount
        ),
        [
            'queued' => count($recipients),
            'sent' => $sentCount,
            'failed' => $failedCount,
        ]
    );
}

function import_employees_csv(PDO $pdo): void
{
    $file = $_FILES['employeeFile'] ?? $_FILES['file'] ?? null;

    if (!is_array($file)) {
        json_response([
            'success' => false,
            'message' => 'Choose a CSV or Excel workbook to import.',
        ], 422);
    }

    if ((int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response([
            'success' => false,
            'message' => 'Unable to upload the employee import file.',
        ], 422);
    }

    $fileName = trim((string)($file['name'] ?? ''));
    $fileType = strtolower(trim((string)($file['type'] ?? '')));
    $isCsvFile = preg_match('/\.csv$/i', $fileName) === 1
        || in_array($fileType, ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'], true);
    $isXlsxFile = preg_match('/\.xlsx$/i', $fileName) === 1
        || $fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!$isCsvFile && !$isXlsxFile) {
        json_response([
            'success' => false,
            'message' => 'Choose a valid CSV or XLSX file.',
        ], 422);
    }

    if ($isXlsxFile) {
        try {
            $workbookRows = employee_xlsx_read_rows((string)($file['tmp_name'] ?? ''));
        } catch (Throwable $exception) {
            json_response([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        }

        $handle = fopen('php://temp/maxmemory:5242880', 'w+b');
        if ($handle !== false) {
            foreach ($workbookRows as $workbookRow) {
                fputcsv($handle, $workbookRow);
            }
            rewind($handle);
        }
    } else {
        $handle = fopen((string)($file['tmp_name'] ?? ''), 'rb');
    }

    if ($handle === false) {
        json_response([
            'success' => false,
            'message' => 'Unable to read the employee import file.',
        ], 422);
    }

    $rawHeaders = fgetcsv($handle);
    if ($rawHeaders === false) {
        fclose($handle);
        json_response([
            'success' => false,
            'message' => 'The employee import file is empty.',
        ], 422);
    }

    $headers = employee_csv_legacy_position_header(array_map('employee_csv_canonical_key', $rawHeaders));
    if (!in_array('employeeId', $headers, true) || !in_array('email', $headers, true)) {
        fclose($handle);
        json_response([
            'success' => false,
            'message' => 'The import header must include employee_id and email columns.',
        ], 422);
    }

    $defaultRoleId = employee_import_employee_role_id($pdo);
    if ($defaultRoleId <= 0) {
        fclose($handle);
        json_response([
            'success' => false,
            'message' => 'Default Employee role is not available.',
        ], 422);
    }

    /*
     * CSV imports use the shared temporary password requested for bulk onboarding. XLSX imports
     * retain the existing generated-password behavior. Both paths store only a password hash and
     * imported users must replace the temporary password on their first sign-in.
     */
    $temporaryPassword = EMPLOYEE_CSV_IMPORT_TEMPORARY_PASSWORD;

    if (!$isCsvFile) {
        $temporaryPasswordLength = employee_temporary_password_length($pdo);
        $temporaryPassword = employee_generate_temporary_password($temporaryPasswordLength);
        $temporaryPasswordError = password_length_error($pdo, $temporaryPassword, 6);

        if ($temporaryPasswordError !== null) {
            fclose($handle);
            json_response([
                'success' => false,
                'message' => 'Temporary passwords cannot be generated. ' . $temporaryPasswordError,
            ], 422);
        }
    }

    $emailDomainPolicy = email_domain_policy($pdo);
    $duplicateIndex = employee_import_duplicate_index($pdo);

    $summary = [
        'totalRows' => 0,
        'created' => 0,
        'userAccountsCreated' => 0,
        'duplicatesSkipped' => 0,
        'invalidRows' => 0,
        'activationEmailsQueued' => 0,
        'activationEmailsSent' => 0,
        'activationEmailsFailed' => 0,
    ];
    $invalidSamples = [];
    $importErrors = [];
    $createdIds = [];
    $createdUserIds = [];
    $createdAccounts = [];

    $pdo->beginTransaction();

    try {
        $lineNumber = 1;
        while (($row = fgetcsv($handle)) !== false) {
            $lineNumber++;
            $hasContent = count(array_filter($row, static fn ($value): bool => employee_csv_text($value) !== '')) > 0;
            if (!$hasContent) {
                continue;
            }

            $summary['totalRows']++;
            $body = employee_csv_body($pdo, $headers, $row);
            $rowRoleId = employee_import_role_id($pdo, $body, $defaultRoleId);
            $employee = employee_import_apply_defaults($pdo, employee_payload($body));

            if ($employee['employee_id'] === '') {
                $employee['employee_id'] = generate_employee_id($pdo);
            }

            $validationErrors = employee_import_payload_errors($pdo, $employee, $emailDomainPolicy);
            if ($rowRoleId <= 0) {
                $validationErrors[] = 'Selected account role is not available.';
            }
            if ($validationErrors !== []) {
                $summary['invalidRows']++;
                if (count($invalidSamples) < 10) {
                    $invalidSamples[] = [
                        'line' => $lineNumber,
                        'employeeId' => $employee['employee_id'],
                        'email' => $employee['email'],
                        'reason' => implode(' ', $validationErrors),
                    ];
                }
                if (count($importErrors) < 50) {
                    $importErrors[] = "Line {$lineNumber}: " . implode(' ', $validationErrors);
                }
                continue;
            }

            $duplicateReason = employee_import_duplicate_reason($pdo, $employee, $duplicateIndex);
            if ($duplicateReason !== null) {
                $summary['duplicatesSkipped']++;
                if (count($importErrors) < 50) {
                    $importErrors[] = "Line {$lineNumber}: {$duplicateReason}";
                }
                continue;
            }

            $rowSavepointStarted = false;

            try {
                $pdo->exec('SAVEPOINT employee_import_row');
                $rowSavepointStarted = true;

                $employeeRecordId = insert_employee_record($pdo, $employee, false);
                $createdUser = create_imported_employee_user(
                    $pdo,
                    $employee,
                    $rowRoleId,
                    $temporaryPassword
                );

                $pdo->exec('RELEASE SAVEPOINT employee_import_row');

                $createdIds[] = $employeeRecordId;
                $createdUserIds[] = $createdUser['id'];
                $createdAccounts[] = [
                    'userId' => $createdUser['id'],
                    'email' => (string)$employee['email'],
                    'temporaryPassword' => $createdUser['temporaryPassword'],
                    'line' => $lineNumber,
                ];
                $summary['created']++;
                $summary['userAccountsCreated']++;
            } catch (PDOException $exception) {
                if ($rowSavepointStarted) {
                    $pdo->exec('ROLLBACK TO SAVEPOINT employee_import_row');
                    $pdo->exec('RELEASE SAVEPOINT employee_import_row');
                }

                if ($exception->getCode() === '23000') {
                    $summary['duplicatesSkipped']++;
                    if (count($importErrors) < 50) {
                        $importErrors[] = "Line {$lineNumber}: Employee ID, email, or user account already exists.";
                    }
                    continue;
                }

                throw $exception;
            } catch (Throwable $exception) {
                if ($rowSavepointStarted) {
                    $pdo->exec('ROLLBACK TO SAVEPOINT employee_import_row');
                    $pdo->exec('RELEASE SAVEPOINT employee_import_row');
                }
                throw $exception;
            }
        }

        initialize_imported_employee_leave_credits($pdo, $createdIds);

        fclose($handle);
        $pdo->commit();
    } catch (Throwable $exception) {
        if (is_resource($handle)) {
            fclose($handle);
        }

        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $summary['activationEmailsQueued'] = count($createdAccounts);
    $importActor = session_user();

    write_auth_audit($pdo, $importActor, 'employee.imported', 'Employees were imported from CSV/XLSX.', [
        'summary' => $summary,
        'createdIds' => $createdIds,
        'createdUserIds' => $createdUserIds,
    ]);

    defer(static function () use ($pdo, $createdAccounts, $createdUserIds, $importActor): void {
        complete_employee_import_delivery($pdo, $createdAccounts, $createdUserIds, $importActor);
    });

    $message = sprintf(
        'Employee import completed. %d employee%s and %d user account%s created, %d duplicate%s skipped, %d invalid row%s. %d activation email%s queued for delivery.',
        (int)$summary['created'],
        (int)$summary['created'] === 1 ? '' : 's',
        (int)$summary['userAccountsCreated'],
        (int)$summary['userAccountsCreated'] === 1 ? '' : 's',
        (int)$summary['duplicatesSkipped'],
        (int)$summary['duplicatesSkipped'] === 1 ? '' : 's',
        (int)$summary['invalidRows'],
        (int)$summary['invalidRows'] === 1 ? '' : 's',
        (int)$summary['activationEmailsQueued'],
        (int)$summary['activationEmailsQueued'] === 1 ? '' : 's'
    );

    json_response([
        'success' => true,
        'imported' => (int)$summary['created'],
        'failed' => (int)$summary['duplicatesSkipped'] + (int)$summary['invalidRows'],
        'userAccountsCreated' => (int)$summary['userAccountsCreated'],
        'userAccounts' => [
            'created' => (int)$summary['userAccountsCreated'],
        ],
        'activationEmails' => [
            'queued' => (int)$summary['activationEmailsQueued'],
            'sent' => (int)$summary['activationEmailsSent'],
            'failed' => (int)$summary['activationEmailsFailed'],
            'errors' => [],
        ],
        'message' => $message,
        'summary' => $summary,
        'invalidSamples' => $invalidSamples,
        'errors' => $importErrors,
        'createdIds' => $createdIds,
    ], 201);
}

function list_employees(PDO $pdo, bool $archived = false): void
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            e.first_name AS firstName,
            e.middle_name AS middleName,
            e.last_name AS lastName,
            e.suffix,
            CONCAT_WS(" ", NULLIF(e.first_name, ""), NULLIF(e.middle_name, ""), NULLIF(e.last_name, ""), NULLIF(e.suffix, "")) AS fullName,
            e.date_of_birth AS dateOfBirth,
            e.address,
            e.city,
            e.province,
            e.zip_code AS zipCode,
            e.gender,
            e.email,
            e.phone,
            e.division_id AS divisionId,
            d.name AS department,
            e.designation_id AS designationId,
            des.name AS position,
            e.designation,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            e.date_hired AS dateHired,
            e.status,
            e.employment_status AS employmentStatus,
            e.profile_image AS profileImage,
            CAST(e.pwd AS CHAR) AS pwd,
            e.civil_status AS civilStatus,
            e.height,
            e.weight,
            e.blood_type AS bloodType,
            e.emp_gsis_id_no AS gsisIdNo,
            e.emp_pagibig_id_no AS pagibigIdNo,
            e.emp_philhealth_id_no AS philhealthIdNo,
            e.tin_no AS tinNo
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.is_archived = :is_archived
         ORDER BY e.created_at DESC, e.id DESC'
    );
    $statement->execute([
        ':is_archived' => $archived ? 1 : 0,
    ]);

    json_response([
        'success' => true,
        'employees' => $statement->fetchAll(),
    ]);
}

/**
 * The designations the employee form offers to pick from, so the same assignment is spelled the same
 * way on every record (typing a new one is still allowed). Designations are free text with no catalog
 * behind them, so the list is what is already in use, plus the designation halves of the old combined
 * catalog names ("Engineer IV / Chief, Mineral Land Survey Section"), which
 * employee_designation_split_combined_titles() archived.
 *
 * Each carries the division it was seen in, so the form can list the employee's own division first.
 * A designation used in two divisions is listed under both.
 *
 * @return list<array{name: string, division: string}>
 */
function employee_designation_suggestions(PDO $pdo): array
{
    $suggestions = [];
    $add = static function (string $name, string $division) use (&$suggestions): void {
        $name = trim($name);

        if ($name !== '') {
            $suggestions[strtolower($division . "\n" . $name)] ??= ['name' => $name, 'division' => trim($division)];
        }
    };

    foreach ($pdo->query(
        'SELECT DISTINCT TRIM(e.designation) AS name, COALESCE(d.name, "") AS division
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE e.is_archived = 0
           AND TRIM(COALESCE(e.designation, "")) <> ""'
    )->fetchAll() as $row) {
        $add((string)$row['name'], (string)$row['division']);
    }

    foreach ($pdo->query(
        'SELECT des.name, COALESCE(d.name, "") AS division
         FROM designations des
         LEFT JOIN divisions d ON d.id = des.division_id
         WHERE des.is_archived = 1
           AND des.name LIKE "% / %"'
    )->fetchAll() as $row) {
        $parts = employee_designation_split_title((string)$row['name']);

        if ($parts !== null) {
            $add($parts[1], (string)$row['division']);
        }
    }

    $suggestions = array_values($suggestions);
    usort(
        $suggestions,
        static fn (array $a, array $b): int => strnatcasecmp($a['division'], $b['division'])
            ?: strnatcasecmp($a['name'], $b['name'])
    );

    return $suggestions;
}

function list_options(PDO $pdo): void
{
    $divisions = $pdo->query(
        'SELECT id, name, description, code
         FROM divisions
         WHERE is_archived = 0
         ORDER BY name'
    )->fetchAll();

    $designations = $pdo->query(
        'SELECT des.id, des.division_id, des.name
         FROM designations des
         INNER JOIN divisions d ON d.id = des.division_id
         WHERE des.is_archived = 0
           AND d.is_archived = 0
         ORDER BY d.name, des.name'
    )->fetchAll();

    /*
     * Employment status is free text on the employee row with no lookup table behind it, so the
     * statuses on active employees are the database's own list of them. Filters read this instead
     * of collecting the values off whatever rows a screen happens to have loaded.
     */
    $employmentStatuses = array_values(array_filter(array_map(
        static fn (array $row): string => trim((string)($row['employment_status'] ?? '')),
        $pdo->query(
            'SELECT DISTINCT TRIM(employment_status) AS employment_status
             FROM employees
             WHERE is_archived = 0
               AND TRIM(COALESCE(employment_status, "")) <> ""
             ORDER BY employment_status'
        )->fetchAll()
    )));

    json_response([
        'success' => true,
        'divisions' => $divisions,
        'designations' => $designations,
        'designationSuggestions' => employee_designation_suggestions($pdo),
        'employmentStatuses' => $employmentStatuses,
        // The values users.status accepts -- the same pair user.php reports to User Management.
        'accountStatuses' => [HRIS_USER_STATUS_ACTIVE, HRIS_USER_STATUS_INACTIVE],
        'emailDomainPolicy' => email_domain_policy($pdo),
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && isset($_GET['self'])) {
    $employeeRecordId = session_employee_record_id($pdo, $sessionUser);
    $employee = $employeeRecordId !== null ? fetch_employee($pdo, $employeeRecordId) : null;

    json_response([
        'success' => true,
        'employee' => $employee,
    ]);
}

if ($method === 'GET' && isset($_GET['options'])) {
    list_options($pdo);
}

if ($method === 'GET') {
    list_employees($pdo, (string)($_GET['archived'] ?? '') === '1');
}

$employeeAction = (string)($_POST['action'] ?? $_GET['action'] ?? '');
if ($method === 'POST' && in_array($employeeAction, ['importEmployeesCsv', 'import'], true)) {
    employees_require_manager($sessionUser);
    import_employees_csv($pdo);
}

$body = read_json_body();

if ($method === 'POST') {
    employees_require_manager($sessionUser);
    $employee = employee_payload($body);
    if ($employee['employee_id'] === '') {
        $employee['employee_id'] = generate_employee_id($pdo);
    }
    // Creating a roster entry always creates a standard Employee login account. Role changes, when
    // needed later, continue through the existing Edit Employee flow.
    $roleId = employee_default_role_id($pdo);
    if ($roleId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Default Employee role is not available.',
        ], 422);
    }
    $sendActivationEmail = employee_bool($body['sendActivationEmail'] ?? false);
    validate_employee_payload($pdo, $employee);
    validate_employee_account_payload($pdo, $roleId);

    $savedEmployee = null;
    $linkedAccount = null;

    try {
        $pdo->beginTransaction();

        $employeeId = insert_employee_record($pdo, $employee);
        $savedEmployee = fetch_employee($pdo, $employeeId);

        if ($savedEmployee !== null && $roleId > 0) {
            $linkedAccount = upsert_employee_linked_user(
                $pdo,
                $savedEmployee,
                $roleId,
                null,
                $sendActivationEmail
            );
        }

        $pdo->commit();
    } catch (PDOException $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Employee ID, email, or linked user account already exists.',
            ], 409);
        }

        throw $exception;
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $accountResponse = employee_linked_account_response($linkedAccount, $savedEmployee ?? [], $sendActivationEmail);

    try {
        if ($linkedAccount !== null && !empty($linkedAccount['user']['id'])) {
            $linkedUserId = (int)$linkedAccount['user']['id'];
            $accountCreated = (bool)($linkedAccount['created'] ?? false);

            if (!$accountCreated) {
                notify_users(
                    $pdo,
                    [$linkedUserId],
                    'Account Updated',
                    'Your linked account role has been updated to match your employee record.',
                    'role_updated',
                    (string)$employeeId
                );
            }
        }
    } catch (Throwable $notificationException) {
        error_log('Employee creation notification error: ' . $notificationException->getMessage());
    }

    json_response(array_merge([
        'success' => true,
        'message' => 'Employee created successfully.',
        'employee' => $savedEmployee,
    ], $accountResponse), 201);
}

if ($method === 'PUT') {
    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    employees_require_manager_or_self($pdo, $sessionUser, $id);
    $profileSection = strtolower(trim((string)($body['profileSection'] ?? '')));
    $ownRecordId = session_employee_record_id($pdo, $sessionUser);
    $isOwnEmployeeRecord = $ownRecordId !== null && $ownRecordId === $id;
    $isManagerEdit = employees_can_manage($sessionUser);
    $isOwnProtectedProfileEdit = $isOwnEmployeeRecord
        && !profile_edit_can_edit_directly($sessionUser)
        && in_array($profileSection, ['personal', 'address', 'government'], true);
    $isSelfServiceEdit = !$isManagerEdit || $isOwnProtectedProfileEdit;

    $employee = employee_payload($body);
    $roleId = (int)($body['roleId'] ?? 0);
    $sendActivationEmail = employee_bool($body['sendActivationEmail'] ?? false);

    /*
     * A self-service edit is the profile page saving its own personal / address / government
     * sections. buildEmployeePayload() in profileUtils.js ships the whole row every time, though,
     * including pay and posting, and the read-only flags that hide those inputs are client-side only.
     * So the columns the employee does not own are put back from the stored row before the write, and
     * the linked-account role is dropped entirely -- without that, PUT {"id": <own id>, "roleId": 1}
     * promotes the caller to Admin through upsert_employee_linked_user() below.
     *
     * Email is preserved too: it is the join between employees and users, and changing it has its own
     * verified flow in email_verification.php.
     */
    if ($isSelfServiceEdit) {
        $roleId = 0;
        $sendActivationEmail = false;

        $protectedStatement = $pdo->prepare(
            'SELECT employee_id, email, division_id, designation_id, designation, basic_salary,
                    salary_rate, date_hired, status, employment_status
             FROM employees
             WHERE id = :id
             LIMIT 1'
        );
        $protectedStatement->execute([':id' => $id]);
        $protectedColumns = $protectedStatement->fetch();

        if (!$protectedColumns) {
            json_response([
                'success' => false,
                'message' => 'Employee record not found.',
            ], 404);
        }

        foreach ($protectedColumns as $column => $value) {
            $employee[$column] = $value;
        }
    }

    $existingEmployee = fetch_employee($pdo, $id);

    if ($existingEmployee === null) {
        json_response([
            'success' => false,
            'message' => 'Employee record not found.',
        ], 404);
    }

    // The designation is newer than most of the screens that save this row. One that does not send
    // it is not clearing it, so an absent key keeps what is stored.
    if (!array_key_exists('designation', $body)) {
        $employee['designation'] = employee_designation_text($existingEmployee['designation'] ?? null);
    }

    validate_employee_payload($pdo, $employee);
    validate_employee_account_payload($pdo, $roleId);

    $requiresPersonalEditApproval = $isOwnEmployeeRecord
        && !profile_edit_can_edit_directly($sessionUser)
        && (
            $profileSection === 'personal'
            || employee_personal_details_changed($existingEmployee, $employee)
        );

    $savedEmployee = null;
    $linkedAccount = null;
    $personalEditApproval = null;

    try {
        $pdo->beginTransaction();

        if ($requiresPersonalEditApproval) {
            $personalEditApproval = profile_edit_request_approved_for_user(
                $pdo,
                (int)($sessionUser['id'] ?? 0),
                true
            );

            if ($personalEditApproval === null) {
                $pdo->rollBack();
                json_response([
                    'success' => false,
                    'message' => 'Admin or HR Head approval is required before editing Personal Details.',
                ], 403);
            }
        }

        $statement = $pdo->prepare(
            'UPDATE employees
             SET employee_id = :employee_id,
                 first_name = :first_name,
                 middle_name = :middle_name,
                 last_name = :last_name,
                 suffix = :suffix,
                 date_of_birth = :date_of_birth,
                 address = :address,
                 city = :city,
                 province = :province,
                 zip_code = :zip_code,
                 gender = :gender,
                 email = :email,
                 phone = :phone,
                 division_id = :division_id,
                 designation_id = :designation_id,
                 designation = :designation,
                 basic_salary = :basic_salary,
                 salary_rate = :salary_rate,
                 date_hired = :date_hired,
                 status = :status,
                 employment_status = :employment_status,
                 pwd = :pwd,
                 civil_status = :civil_status,
                 height = :height,
                 weight = :weight,
                 blood_type = :blood_type,
                 emp_gsis_id_no = :emp_gsis_id_no,
                 emp_pagibig_id_no = :emp_pagibig_id_no,
                 emp_philhealth_id_no = :emp_philhealth_id_no,
                 tin_no = :tin_no
             WHERE id = :id
               AND is_archived = 0'
        );
        $statement->execute(array_merge(
            array_combine(
                array_map(fn (string $key): string => ':' . $key, array_keys($employee)),
                array_values($employee)
            ),
            [':id' => $id]
        ));

        $savedEmployee = fetch_employee($pdo, $id);

        employee_append_service_record(
            $pdo,
            $id,
            $existingEmployee,
            $savedEmployee ?? [],
            $body,
            (int)($sessionUser['id'] ?? 0) ?: null
        );

        if ($savedEmployee !== null && $roleId > 0) {
            $linkedAccount = upsert_employee_linked_user(
                $pdo,
                $savedEmployee,
                $roleId,
                (string)($existingEmployee['email'] ?? ''),
                $sendActivationEmail
            );
        } elseif ($savedEmployee !== null) {
            /*
             * The HR directory edit form only sends a role when one is picked, so an email change
             * saved from there has to carry itself over to the linked account on its own.
             */
            $linkedAccount = sync_employee_linked_user_email(
                $pdo,
                $savedEmployee,
                (string)($existingEmployee['email'] ?? '')
            );
        }

        if (
            $personalEditApproval !== null
            && !profile_edit_request_mark_used($pdo, (int)$personalEditApproval['id'])
        ) {
            throw new RuntimeException('The Personal Details edit approval is no longer available.');
        }

        $pdo->commit();
    } catch (PDOException $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Employee ID, email, or linked user account already exists.',
            ], 409);
        }

        throw $exception;
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $accountResponse = employee_linked_account_response($linkedAccount, $savedEmployee ?? [], $sendActivationEmail);

    try {
        $employeeName = (string)($savedEmployee['fullName'] ?? trim((string)($savedEmployee['firstName'] ?? '')) . ' ' . trim((string)($savedEmployee['lastName'] ?? '')));
        $employeeName = trim($employeeName);
        $employeeLabel = (string)($savedEmployee['employeeId'] ?? ('#' . $id));
        $divisionName = (string)($savedEmployee['division'] ?? 'the division');

        notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Employee Updated',
            sprintf('%s (%s) was updated in %s.', $employeeName !== '' ? $employeeName : 'An employee', $employeeLabel, $divisionName),
            'system_alert',
            (string)$id
        );

        if ($linkedAccount !== null && !empty($linkedAccount['user']['id'])) {
            $linkedUserId = (int)$linkedAccount['user']['id'];
            $accountCreated = (bool)($linkedAccount['created'] ?? false);

            if (!$accountCreated) {
                notify_users(
                    $pdo,
                    [$linkedUserId],
                    'Account Updated',
                    'Your linked account role has been updated to match your employee record.',
                    'role_updated',
                    (string)$id
                );
            }
        }
    } catch (Throwable $notificationException) {
        error_log('Employee update notification error: ' . $notificationException->getMessage());
    }

    json_response(array_merge([
        'success' => true,
        'message' => 'Employee updated successfully.',
        'employee' => $savedEmployee,
    ], $accountResponse));
}

if ($method === 'PATCH') {
    employees_require_manager($sessionUser);
    $id = (int)($body['id'] ?? 0);
    $restore = (string)($body['restore'] ?? '') === '1';
    $patchAction = strtolower(trim((string)($body['action'] ?? '')));

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    if ($patchAction === 'separate') {
        employee_separate($pdo, $sessionUser, $id, $body);
    }

    if (!$restore) {
        json_response([
            'success' => false,
            'message' => 'Unsupported employee update action.',
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE employees SET is_archived = 0 WHERE id = :id AND is_archived = 1'
    );
    $statement->execute([':id' => $id]);

    $restoredEmployee = fetch_employee($pdo, $id);

    $linkedUser = $restoredEmployee !== null
        ? find_employee_user_for_emails($pdo, [(string)($restoredEmployee['email'] ?? '')])
        : null;

    if ($linkedUser !== null) {
        $pdo->prepare('UPDATE users SET is_archived = 0 WHERE id = :id')
            ->execute([':id' => (int)$linkedUser['id']]);
    }

    try {
        $employeeName = (string)($restoredEmployee['fullName'] ?? trim((string)($restoredEmployee['firstName'] ?? '')) . ' ' . trim((string)($restoredEmployee['lastName'] ?? '')));
        $employeeName = trim($employeeName);
        $employeeLabel = (string)($restoredEmployee['employeeId'] ?? ('#' . $id));

        notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Account Activated',
            sprintf('%s (%s) has been restored.', $employeeName !== '' ? $employeeName : 'An employee', $employeeLabel),
            'account_activated',
            (string)$id
        );

        if ($linkedUser !== null) {
            notify_users(
                $pdo,
                [(int)$linkedUser['id']],
                'Account Activated',
                'Your employee profile has been restored and your account is active again.',
                'account_activated',
                (string)$id
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Employee restore notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Employee restored successfully.',
        'employee' => $restoredEmployee,
    ]);
}

if ($method === 'DELETE') {
    employees_require_manager($sessionUser);
    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    $archivedEmployee = fetch_employee($pdo, $id);

    $statement = $pdo->prepare(
        'UPDATE employees SET is_archived = 1 WHERE id = :id'
    );
    $statement->execute([':id' => $id]);

    $linkedUser = $archivedEmployee !== null
        ? find_employee_user_for_emails($pdo, [(string)($archivedEmployee['email'] ?? '')])
        : null;

    if ($linkedUser !== null) {
        $pdo->prepare('UPDATE users SET is_archived = 1 WHERE id = :id')
            ->execute([':id' => (int)$linkedUser['id']]);
    }

    try {
        $employeeName = (string)($archivedEmployee['fullName'] ?? trim((string)($archivedEmployee['firstName'] ?? '')) . ' ' . trim((string)($archivedEmployee['lastName'] ?? '')));
        $employeeName = trim($employeeName);
        $employeeLabel = (string)($archivedEmployee['employeeId'] ?? ('#' . $id));

        notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Employee Archived',
            sprintf('%s (%s) has been archived.', $employeeName !== '' ? $employeeName : 'An employee', $employeeLabel),
            'system_alert',
            (string)$id
        );

        if ($linkedUser !== null) {
            notify_users(
                $pdo,
                [(int)$linkedUser['id']],
                'Account Deactivated',
                'Your employee profile has been archived and your account can no longer be used to sign in.',
                'account_deactivated',
                (string)$id
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Employee archive notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Employee archived successfully.',
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
