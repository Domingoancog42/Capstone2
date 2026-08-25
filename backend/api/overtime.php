<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';
require_once __DIR__ . '/captcha-utils.php';

$sessionUser = require_session_user();

function overtime_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function overtime_date_or_null(mixed $value): ?string
{
    $text = overtime_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function overtime_datetime_or_null(mixed $value): ?string
{
    $text = overtime_text($value);
    if ($text === '') {
        return null;
    }

    foreach (['Y-m-d H:i:s', 'Y-m-d\TH:i:s'] as $format) {
        $date = DateTime::createFromFormat($format, $text);

        if ($date && $date->format($format) === $text) {
            return $date->format('Y-m-d H:i:s');
        }
    }

    $timestamp = strtotime($text);

    return $timestamp !== false ? date('Y-m-d H:i:s', $timestamp) : null;
}

function overtime_time_or_null(mixed $value): ?string
{
    $text = overtime_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('H:i', $text);
    return $date && $date->format('H:i') === $text ? $text . ':00' : null;
}

function overtime_decimal_or_null(mixed $value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }

    return is_numeric($value) ? (float)$value : null;
}

function overtime_role_key(array $user): string
{
    return user_role_key($user);
}

function overtime_can_manage(array $user): bool
{
    return in_array(overtime_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'chief', 'planningofficer'], true);
}

function overtime_can_view_all(array $user): bool
{
    return overtime_role_key($user) !== 'employee';
}

/*
 * Overtime is authorized in two desks, the same chain leave already uses. A chief files for the
 * employees of the division and may still correct or withdraw the filing, but signs off on nothing;
 * HR marks it Reviewed; the Regional Director gives the final Approved. Only that last signature
 * turns the filing into a compensatory overtime credit, which is why the credit page counts
 * Approved rows and ignores Reviewed ones.
 *
 * A planning officer works the same division desk, so it files the same way -- neither role adds a
 * signature to the chain.
 */
function overtime_is_chief(array $user): bool
{
    return in_array(overtime_role_key($user), ['chief', 'planningofficer'], true);
}

/** The HR desk: may mark a pending filing Reviewed, never give the final approval. */
function overtime_can_review(array $user): bool
{
    return in_array(overtime_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

/** The Regional Director's desk: the only one whose approval creates the credit. */
function overtime_can_give_final_approval(array $user): bool
{
    return in_array(overtime_role_key($user), ['admin', 'regionaldirector'], true);
}

function overtime_status_to_database(mixed $status): string
{
    return match (strtolower(overtime_text($status))) {
        'reviewed' => 'Reviewed',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled' => 'Cancelled',
        default => 'Pending',
    };
}

function ensure_overtime_table(PDO $pdo): void
{
    if (!database_column_exists($pdo, 'overtime', 'work_date')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN work_date DATE NULL AFTER employee_id');

        if (database_column_exists($pdo, 'overtime', 'overtime_date')) {
            $pdo->exec('UPDATE overtime SET work_date = overtime_date WHERE work_date IS NULL');
        }

        $pdo->exec('UPDATE overtime SET work_date = CURDATE() WHERE work_date IS NULL');
    }

    if (!database_column_exists($pdo, 'overtime', 'hour_requested')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN hour_requested DECIMAL(5,2) NULL AFTER work_date');

        if (database_column_exists($pdo, 'overtime', 'overtime_hours')) {
            $pdo->exec('UPDATE overtime SET hour_requested = overtime_hours WHERE hour_requested IS NULL');
        } elseif (database_column_exists($pdo, 'overtime', 'hours_worked')) {
            $pdo->exec('UPDATE overtime SET hour_requested = hours_worked WHERE hour_requested IS NULL');
        }

        $pdo->exec('UPDATE overtime SET hour_requested = 0 WHERE hour_requested IS NULL');
    }

    if (!database_column_exists($pdo, 'overtime', 'duration')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN duration DECIMAL(5,2) NULL AFTER status');
        $pdo->exec('UPDATE overtime SET duration = hour_requested WHERE duration IS NULL');
    }

    if (!database_column_exists($pdo, 'overtime', 'request_date')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN request_date DATETIME NULL AFTER hour_requested');
        $pdo->exec('UPDATE overtime SET request_date = created_at WHERE request_date IS NULL');
        $pdo->exec('UPDATE overtime SET request_date = NOW() WHERE request_date IS NULL');
    }

    $pdo->exec('ALTER TABLE overtime MODIFY request_date DATETIME NOT NULL');

    if (!database_column_exists($pdo, 'overtime', 'approved_at')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL AFTER approved_by');
    }

    /* Who signed the HR stage, kept apart from approved_by so both signatures survive on the row. */
    if (!database_column_exists($pdo, 'overtime', 'reviewed_by')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN reviewed_by INT UNSIGNED NULL AFTER source');
    }

    if (!database_column_exists($pdo, 'overtime', 'reviewed_at')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL AFTER reviewed_by');
    }

    if (!database_column_exists($pdo, 'overtime', 'created_by')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN created_by INT UNSIGNED NULL AFTER approved_at');
    }

    if (!database_column_exists($pdo, 'overtime', 'source')) {
        $pdo->exec("ALTER TABLE overtime ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'request' AFTER duration");
    }

    $pdo->exec(
        "ALTER TABLE overtime
         MODIFY status ENUM('Pending', 'Reviewed', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending'"
    );
}

function overtime_table_columns(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "overtime"'
    );

    $columns = [];
    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $column) {
        $columns[(string)$column] = true;
    }

    return $columns;
}

function overtime_hours_to_time(float $hours): string
{
    $totalMinutes = max(0, (int)round($hours * 60));
    $hour = intdiv($totalMinutes, 60) % 24;
    $minute = $totalMinutes % 60;

    return sprintf('%02d:%02d:00', $hour, $minute);
}

function resolve_overtime_session_employee_id(PDO $pdo, array $user): int
{
    $employeeCode = overtime_text($user['employee_id'] ?? '');
    $employeeName = overtime_text($user['full_name'] ?? '');

    if ($employeeCode !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $employeeCode]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($employeeName !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $employeeName]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    json_response([
        'success' => false,
        'message' => 'Signed-in employee record was not found.',
    ], 422);
}

function resolve_overtime_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!overtime_can_view_all($sessionUser)) {
        return resolve_overtime_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = overtime_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = overtime_text($body['employeeName'] ?? '');

    if ($employeeRecordId > 0) {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
        $statement->execute([':id' => $employeeRecordId]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($employeeCode !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $employeeCode]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($employeeName !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $employeeName]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    json_response([
        'success' => false,
        'message' => 'Selected employee was not found.',
    ], 422);
}

/**
 * Every employee the filing covers, as employee record ids.
 *
 * A chief authorizes overtime for a set of people at once, so the form posts `employeeRecordIds`
 * and one row is written per employee — each then carries its own status through the approval
 * chain. A single `employeeRecordId` still works, which is what every other role's form sends.
 */
function resolve_overtime_employee_ids(PDO $pdo, array $body, array $sessionUser): array
{
    if (!overtime_can_view_all($sessionUser)) {
        return [resolve_overtime_session_employee_id($pdo, $sessionUser)];
    }

    $selection = $body['employeeRecordIds'] ?? $body['employeeIds'] ?? null;

    if (!is_array($selection)) {
        return [resolve_overtime_employee_id($pdo, $body, $sessionUser)];
    }

    $employeeIds = [];
    foreach ($selection as $value) {
        $employeeId = (int)$value;
        if ($employeeId > 0) {
            $employeeIds[$employeeId] = true;
        }
    }

    if ($employeeIds === []) {
        return [resolve_overtime_employee_id($pdo, $body, $sessionUser)];
    }

    $employeeIds = array_keys($employeeIds);
    $placeholders = implode(', ', array_fill(0, count($employeeIds), '?'));
    $statement = $pdo->prepare(
        'SELECT id FROM employees WHERE id IN (' . $placeholders . ') AND is_archived = 0'
    );
    $statement->execute($employeeIds);
    $foundIds = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));

    if (count($foundIds) !== count($employeeIds)) {
        json_response([
            'success' => false,
            'message' => 'One or more selected employees were not found.',
        ], 422);
    }

    return $foundIds;
}

function calculate_hours_worked(?string $timeIn, ?string $timeOut): ?float
{
    if ($timeIn === null || $timeOut === null) {
        return null;
    }

    $start = strtotime('2000-01-01 ' . $timeIn);
    $end = strtotime('2000-01-01 ' . $timeOut);

    if ($start === false || $end === false) {
        return null;
    }

    if ($end <= $start) {
        $end += 24 * 60 * 60;
    }

    return round(($end - $start) / 3600, 2);
}

function fetch_overtime(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = 'SELECT
                o.overtime_id AS id,
                o.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                o.work_date AS workDate,
                o.work_date AS overtimeDate,
                o.hour_requested AS hourRequested,
                o.hour_requested AS hoursWorked,
                o.hour_requested AS overtimeHours,
                o.request_date AS requestDate,
                DATE_FORMAT(o.request_date, "%c/%e/%Y, %l:%i:%s %p") AS requestDateDisplay,
                o.duration,
                o.reason,
                o.status,
                COALESCE(NULLIF(o.source, ""), "request") AS source,
                o.reviewed_by AS reviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedBy,
                o.reviewed_at AS reviewedAt,
                o.approved_by AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                o.approved_at AS approvedAt,
                o.created_by AS createdBy,
                o.request_date AS dateFiled,
                o.created_at AS createdAt
            FROM overtime o
            INNER JOIN employees e ON e.id = o.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN employees approved_employee ON approved_employee.id = o.approved_by
            LEFT JOIN employees reviewed_employee ON reviewed_employee.id = o.reviewed_by
            WHERE o.overtime_id = :id';

    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $sql .= ' AND o.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $record['id'] = (int)$record['id'];
    $record['employeeRecordId'] = (int)$record['employeeRecordId'];
    $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
        ? (int)$record['approvedByEmployeeRecordId']
        : null;
    $record['reviewedByEmployeeRecordId'] = $record['reviewedByEmployeeRecordId'] !== null
        ? (int)$record['reviewedByEmployeeRecordId']
        : null;
    $record['hourRequested'] = (float)$record['hourRequested'];
    $record['hoursWorked'] = (float)$record['hoursWorked'];
    $record['overtimeHours'] = (float)$record['overtimeHours'];
    $record['duration'] = (float)$record['duration'];
    $record['reason'] = overtime_text($record['reason'] ?? '');
    $record['source'] = overtime_text($record['source'] ?? 'request') ?: 'request';

    return $record;
}

function list_overtime(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = overtime_can_view_all($sessionUser) ? null : resolve_overtime_session_employee_id($pdo, $sessionUser);

    $sql = 'SELECT
                o.overtime_id AS id,
                o.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                o.work_date AS workDate,
                o.work_date AS overtimeDate,
                o.hour_requested AS hourRequested,
                o.hour_requested AS hoursWorked,
                o.hour_requested AS overtimeHours,
                o.request_date AS requestDate,
                DATE_FORMAT(o.request_date, "%c/%e/%Y, %l:%i:%s %p") AS requestDateDisplay,
                o.duration,
                o.reason,
                o.status,
                COALESCE(NULLIF(o.source, ""), "request") AS source,
                o.reviewed_by AS reviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedBy,
                o.reviewed_at AS reviewedAt,
                o.approved_by AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                o.approved_at AS approvedAt,
                o.created_by AS createdBy,
                o.request_date AS dateFiled,
                o.created_at AS createdAt
            FROM overtime o
            INNER JOIN employees e ON e.id = o.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN employees approved_employee ON approved_employee.id = o.approved_by
            LEFT JOIN employees reviewed_employee ON reviewed_employee.id = o.reviewed_by
            WHERE o.is_archived = :is_archived';

    $params = [':is_archived' => archived_view_requested() ? 1 : 0];
    if ($employeeScopeId !== null) {
        $sql .= ' AND o.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    /*
     * A manual COC credit is stored as an already-approved overtime row so it counts towards the
     * employee's credits, but it was never filed, reviewed or approved by anyone -- it belongs on
     * the compensatory credits page, not in the list of overtime requests. Screens that show one or
     * the other ask for the source they mean; callers that want the credit total ask for neither.
     */
    $sourceFilter = strtolower(overtime_text($_GET['source'] ?? ''));
    if ($sourceFilter === 'request' || $sourceFilter === 'manual_coc') {
        $sql .= $sourceFilter === 'manual_coc'
            ? ' AND COALESCE(NULLIF(o.source, ""), "request") = "manual_coc"'
            : ' AND COALESCE(NULLIF(o.source, ""), "request") <> "manual_coc"';
    }

    $sql .= ' ORDER BY o.created_at DESC, o.overtime_id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $records = $statement->fetchAll();

    foreach ($records as &$record) {
        $record['id'] = (int)$record['id'];
        $record['employeeRecordId'] = (int)$record['employeeRecordId'];
        $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
            ? (int)$record['approvedByEmployeeRecordId']
            : null;
        $record['hourRequested'] = (float)$record['hourRequested'];
        $record['hoursWorked'] = (float)$record['hoursWorked'];
        $record['overtimeHours'] = (float)$record['overtimeHours'];
        $record['duration'] = (float)$record['duration'];
        $record['reason'] = overtime_text($record['reason'] ?? '');
        $record['source'] = overtime_text($record['source'] ?? 'request') ?: 'request';
    }
    unset($record);

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

function create_overtime(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeIds = resolve_overtime_employee_ids($pdo, $body, $sessionUser);
    $workDate = overtime_date_or_null($body['workDate'] ?? $body['work_date'] ?? $body['overtimeDate'] ?? $body['overtime_date'] ?? null);
    $requestDate = overtime_datetime_or_null($body['requestDate'] ?? $body['request_date'] ?? null) ?? date('Y-m-d H:i:s');
    $hourRequested = overtime_decimal_or_null(
        $body['hourRequested']
        ?? $body['hour_requested']
        ?? $body['hoursRequested']
        ?? $body['hoursWorked']
        ?? $body['overtimeHours']
        ?? null
    );
    $duration = overtime_decimal_or_null($body['duration'] ?? null);
    $reason = overtime_text($body['reason'] ?? '');

    $duration = $duration ?? $hourRequested;

    $errors = [];
    if ($workDate === null) {
        $errors[] = 'Work date is required.';
    }
    /*
     * The form's calendar already starts at today, but that only constrains the picker -- a crafted
     * request still reaches here, so the rule is enforced again rather than trusted. Applies to every
     * role: no account may back-date a filing. Compared as 'Y-m-d' text, which both sides guarantee.
     */
    if ($workDate !== null && $workDate < date('Y-m-d')) {
        $errors[] = 'Work date cannot be in the past. Choose today or a later date.';
    }
    if ($hourRequested === null || $hourRequested <= 0) {
        $errors[] = 'Hours requested must be greater than 0.';
    }
    if ($duration === null || $duration <= 0) {
        $errors[] = 'Duration must be greater than 0.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $columns = overtime_table_columns($pdo);
    $insert = [
        'employee_id' => 0,
        'work_date' => $workDate,
        'hour_requested' => number_format((float)$hourRequested, 2, '.', ''),
        'request_date' => $requestDate,
        'reason' => $reason !== '' ? $reason : null,
        'status' => 'Pending',
        'duration' => number_format((float)$duration, 2, '.', ''),
        'source' => 'request',
        'reviewed_by' => null,
        'reviewed_at' => null,
        'approved_by' => null,
        'approved_at' => null,
        'created_by' => (int)($sessionUser['id'] ?? 0) ?: null,
    ];

    if (isset($columns['overtime_date'])) {
        $insert['overtime_date'] = $workDate;
    }
    if (isset($columns['time_in'])) {
        $insert['time_in'] = '00:00:00';
    }
    if (isset($columns['time_out'])) {
        $insert['time_out'] = overtime_hours_to_time((float)$duration);
    }
    if (isset($columns['hours_worked'])) {
        $insert['hours_worked'] = number_format((float)$duration, 2, '.', '');
    }
    if (isset($columns['overtime_hours'])) {
        $insert['overtime_hours'] = number_format((float)$hourRequested, 2, '.', '');
    }
    if (isset($columns['rate_per_hour'])) {
        $insert['rate_per_hour'] = '0.00';
    }

    $columnNames = array_keys($insert);
    $placeholders = array_map(static fn (string $column): string => ':' . $column, $columnNames);

    $statement = $pdo->prepare(
        'INSERT INTO overtime (' . implode(', ', $columnNames) . ')
         VALUES (' . implode(', ', $placeholders) . ')'
    );

    $scopeId = overtime_can_view_all($sessionUser) ? null : resolve_overtime_session_employee_id($pdo, $sessionUser);
    $records = [];

    /* One filing, one row per employee — all of them land or none do. */
    $pdo->beginTransaction();

    try {
        foreach ($employeeIds as $employeeId) {
            $insert['employee_id'] = $employeeId;
            $params = [];

            foreach ($insert as $column => $value) {
                $params[':' . $column] = $value;
            }

            $statement->execute($params);
            $records[] = fetch_overtime($pdo, (int)$pdo->lastInsertId(), $scopeId);
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $employeeCount = count($records);
    json_response([
        'success' => true,
        'message' => $employeeCount > 1
            ? sprintf('Overtime request submitted for %d employees.', $employeeCount)
            : 'Overtime request submitted successfully.',
        'record' => $records[0] ?? null,
        'records' => $records,
    ], 201);
}

/**
 * The COC credits standing to an employee's name.
 *
 * Same sum the compensatory screens report: every approved overtime row, rendered and hand-posted
 * alike. It is what a deduction is checked against so credits can never be taken below zero.
 */
function overtime_approved_credit_total(PDO $pdo, int $employeeId): float
{
    $statement = $pdo->prepare(
        'SELECT COALESCE(SUM(hour_requested), 0)
         FROM overtime
         WHERE employee_id = :employee_id
           AND LOWER(status) = "approved"
           AND is_archived = 0'
    );
    $statement->execute([':employee_id' => $employeeId]);

    return round((float)$statement->fetchColumn(), 2);
}

/**
 * Store one hand-posted COC movement as an already-approved overtime row.
 *
 * `$hours` may be negative: a deduction is the same row with the sign flipped, which keeps the
 * credit total a plain SUM over approved rows instead of needing a ledger of its own.
 */
function insert_manual_coc_row(
    PDO $pdo,
    int $employeeId,
    string $workDate,
    float $hours,
    string $reason,
    string $requestDate,
    array $sessionUser
): int {
    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $columns = overtime_table_columns($pdo);
    $amount = number_format($hours, 2, '.', '');

    $insert = [
        'employee_id' => $employeeId,
        'work_date' => $workDate,
        'hour_requested' => $amount,
        'request_date' => $requestDate,
        'reason' => $reason !== '' ? $reason : 'Manual compensatory overtime credit',
        'status' => 'Approved',
        'duration' => $amount,
        'source' => 'manual_coc',
        'approved_by' => $sessionEmployeeId,
        'approved_at' => date('Y-m-d H:i:s'),
        'created_by' => (int)($sessionUser['id'] ?? 0) ?: null,
    ];

    if (isset($columns['overtime_date'])) {
        $insert['overtime_date'] = $workDate;
    }
    if (isset($columns['time_in'])) {
        $insert['time_in'] = '00:00:00';
    }
    if (isset($columns['time_out'])) {
        // A clock time cannot run backwards, so a deduction records its magnitude here.
        $insert['time_out'] = overtime_hours_to_time(abs($hours));
    }
    if (isset($columns['hours_worked'])) {
        $insert['hours_worked'] = $amount;
    }
    if (isset($columns['overtime_hours'])) {
        $insert['overtime_hours'] = $amount;
    }
    if (isset($columns['rate_per_hour'])) {
        $insert['rate_per_hour'] = '0.00';
    }

    $columnNames = array_keys($insert);
    $placeholders = array_map(static fn (string $column): string => ':' . $column, $columnNames);
    $params = [];

    foreach ($insert as $column => $value) {
        $params[':' . $column] = $value;
    }

    $statement = $pdo->prepare(
        'INSERT INTO overtime (' . implode(', ', $columnNames) . ')
         VALUES (' . implode(', ', $placeholders) . ')'
    );
    $statement->execute($params);

    return (int)$pdo->lastInsertId();
}

function create_manual_coc_credit(PDO $pdo, array $body, array $sessionUser): void
{
    if (!in_array(overtime_role_key($sessionUser), ['admin', 'hrhead', 'hrstaff'], true)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to add compensatory overtime credits.',
        ], 403);
    }

    $employeeId = resolve_overtime_employee_id($pdo, $body, $sessionUser);
    $workDate = overtime_date_or_null($body['workDate'] ?? $body['work_date'] ?? $body['overtimeDate'] ?? $body['overtime_date'] ?? null);
    $requestDate = overtime_datetime_or_null($body['requestDate'] ?? $body['request_date'] ?? null) ?? date('Y-m-d H:i:s');
    $hours = overtime_decimal_or_null(
        $body['hourRequested']
        ?? $body['hour_requested']
        ?? $body['hours']
        ?? $body['hoursWorked']
        ?? $body['overtimeHours']
        ?? null
    );
    $reason = overtime_text($body['reason'] ?? $body['remarks'] ?? '');

    $errors = [];
    if ($workDate === null) {
        $errors[] = 'Rendered overtime date is required.';
    }
    if ($hours === null || $hours <= 0) {
        $errors[] = 'Compensatory overtime credits must be greater than 0.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $recordId = insert_manual_coc_row($pdo, $employeeId, $workDate, (float)$hours, $reason, $requestDate, $sessionUser);

    json_response([
        'success' => true,
        'message' => 'Compensatory overtime credits added.',
        'record' => fetch_overtime($pdo, $recordId),
    ], 201);
}

/**
 * Apply the pending +/- COC movements from the Set Balances screen.
 *
 * Every employee on that screen can be stepped before saving, so the whole sheet lands in one
 * transaction: if any deduction would take somebody below zero credits the entire save is rejected
 * rather than leaving half of it applied. Employees are resolved up front, before the transaction
 * opens, because an unknown one answers 422 and never returns.
 */
function adjust_manual_coc_credits(PDO $pdo, array $body, array $sessionUser): void
{
    if (!in_array(overtime_role_key($sessionUser), ['admin', 'hrhead', 'hrstaff'], true)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to adjust compensatory overtime credits.',
        ], 403);
    }

    $adjustments = $body['adjustments'] ?? null;

    if (!is_array($adjustments) || $adjustments === []) {
        json_response([
            'success' => false,
            'message' => 'There are no compensatory overtime credit changes to save.',
        ], 422);
    }

    $workDate = overtime_date_or_null($body['effectiveDate'] ?? $body['workDate'] ?? null) ?? date('Y-m-d');
    $sharedReason = overtime_text($body['reason'] ?? $body['remarks'] ?? '');
    $requestDate = date('Y-m-d H:i:s');

    $pending = [];
    $errors = [];

    foreach ($adjustments as $adjustment) {
        if (!is_array($adjustment)) {
            continue;
        }

        $hours = overtime_decimal_or_null($adjustment['hours'] ?? $adjustment['amount'] ?? null);

        if ($hours === null || round($hours, 2) === 0.0) {
            continue;
        }

        $employeeId = resolve_overtime_employee_id($pdo, $adjustment, $sessionUser);
        $hours = round($hours, 2);
        $currentTotal = overtime_approved_credit_total($pdo, $employeeId);

        if ($currentTotal + $hours < 0) {
            $employeeName = overtime_text($adjustment['employeeName'] ?? '') ?: 'this employee';
            $errors[] = sprintf(
                '%s only has %s credit(s) left, so %s cannot be deducted.',
                $employeeName,
                number_format($currentTotal, 2, '.', ''),
                number_format(abs($hours), 2, '.', '')
            );
            continue;
        }

        $reason = overtime_text($adjustment['reason'] ?? $adjustment['remarks'] ?? '') ?: $sharedReason;
        $pending[] = [
            'employeeId' => $employeeId,
            'hours' => $hours,
            'reason' => $reason !== ''
                ? $reason
                : ($hours > 0 ? 'Compensatory overtime credits added by HR.' : 'Compensatory overtime credits deducted by HR.'),
            'workDate' => overtime_date_or_null($adjustment['workDate'] ?? $adjustment['effectiveDate'] ?? null) ?? $workDate,
        ];
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    if ($pending === []) {
        json_response([
            'success' => false,
            'message' => 'There are no compensatory overtime credit changes to save.',
        ], 422);
    }

    $pdo->beginTransaction();

    try {
        foreach ($pending as $change) {
            insert_manual_coc_row(
                $pdo,
                $change['employeeId'],
                $change['workDate'],
                $change['hours'],
                $change['reason'],
                $requestDate,
                $sessionUser
            );
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    json_response([
        'success' => true,
        'message' => sprintf(
            'Compensatory overtime credits updated for %d employee%s.',
            count($pending),
            count($pending) === 1 ? '' : 's'
        ),
        'affectedCount' => count($pending),
    ], 201);
}

/**
 * Correct a filing that has not been signed yet.
 *
 * Only the details a chief could have mistyped move — the employee the row belongs to does not,
 * since a filing for the wrong person is withdrawn and filed again rather than reassigned. The
 * window closes the moment HR reviews it, so nobody edits hours out from under a signature.
 */
function update_overtime_request(PDO $pdo, array $body, array $sessionUser): void
{
    if (!overtime_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to edit overtime requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? $body['recordId'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Overtime request is required.',
        ], 422);
    }

    $currentRecordStatement = $pdo->prepare(
        'SELECT status, source FROM overtime WHERE overtime_id = :id LIMIT 1'
    );
    $currentRecordStatement->execute([':id' => $id]);
    $currentRecord = $currentRecordStatement->fetch();

    if (!$currentRecord) {
        json_response([
            'success' => false,
            'message' => 'Overtime request was not found.',
        ], 404);
    }

    if (strtolower(overtime_text($currentRecord['source'] ?? '')) === 'manual_coc') {
        json_response([
            'success' => false,
            'message' => 'Manually added compensatory overtime credits cannot be edited.',
        ], 422);
    }

    if (strtolower(overtime_text($currentRecord['status'] ?? '')) !== 'pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending overtime requests can be edited.',
        ], 422);
    }

    $workDate = overtime_date_or_null($body['workDate'] ?? $body['work_date'] ?? $body['overtimeDate'] ?? null);
    $hourRequested = overtime_decimal_or_null(
        $body['hourRequested']
        ?? $body['hour_requested']
        ?? $body['hoursRequested']
        ?? $body['hoursWorked']
        ?? $body['overtimeHours']
        ?? null
    );
    $duration = overtime_decimal_or_null($body['duration'] ?? null) ?? $hourRequested;
    $reason = overtime_text($body['reason'] ?? '');

    $errors = [];
    if ($workDate === null) {
        $errors[] = 'Work date is required.';
    }
    if ($workDate !== null && $workDate < date('Y-m-d')) {
        $errors[] = 'Work date cannot be in the past. Choose today or a later date.';
    }
    if ($hourRequested === null || $hourRequested <= 0) {
        $errors[] = 'Hours requested must be greater than 0.';
    }
    if ($duration === null || $duration <= 0) {
        $errors[] = 'Duration must be greater than 0.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $columns = overtime_table_columns($pdo);
    $update = [
        'work_date' => $workDate,
        'hour_requested' => number_format((float)$hourRequested, 2, '.', ''),
        'duration' => number_format((float)$duration, 2, '.', ''),
        'reason' => $reason !== '' ? $reason : null,
    ];

    if (isset($columns['overtime_date'])) {
        $update['overtime_date'] = $workDate;
    }
    if (isset($columns['time_out'])) {
        $update['time_out'] = overtime_hours_to_time((float)$duration);
    }
    if (isset($columns['hours_worked'])) {
        $update['hours_worked'] = number_format((float)$duration, 2, '.', '');
    }
    if (isset($columns['overtime_hours'])) {
        $update['overtime_hours'] = number_format((float)$hourRequested, 2, '.', '');
    }

    $assignments = array_map(static fn (string $column): string => $column . ' = :' . $column, array_keys($update));
    $params = [':id' => $id];

    foreach ($update as $column => $value) {
        $params[':' . $column] = $value;
    }

    $statement = $pdo->prepare(
        'UPDATE overtime SET ' . implode(', ', $assignments) . ' WHERE overtime_id = :id'
    );
    $statement->execute($params);

    json_response([
        'success' => true,
        'message' => 'Overtime request updated.',
        'record' => fetch_overtime($pdo, $id),
    ]);
}

function update_overtime_status(PDO $pdo, array $body, array $sessionUser): void
{
    if (!overtime_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to update overtime requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? $body['recordId'] ?? 0);
    $status = overtime_status_to_database($body['status'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Overtime request is required.',
        ], 422);
    }

    $currentRecordStatement = $pdo->prepare(
        'SELECT employee_id, status, reviewed_by, reviewed_at FROM overtime WHERE overtime_id = :id LIMIT 1'
    );
    $currentRecordStatement->execute([':id' => $id]);
    $currentRecord = $currentRecordStatement->fetch();

    if (!$currentRecord) {
        json_response([
            'success' => false,
            'message' => 'Overtime request was not found.',
        ], 404);
    }

    $currentStatus = strtolower(overtime_text($currentRecord['status'] ?? ''));
    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $isOwnRecord = $sessionEmployeeId !== null
        && (int)($currentRecord['employee_id'] ?? 0) === $sessionEmployeeId;

    /* Withdrawing your own filing is allowed; signing it is not. */
    if ($isOwnRecord && $status !== 'Cancelled') {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own overtime request. Please ask another authorized user to review it.',
        ], 403);
    }

    if (!in_array($currentStatus, ['pending', 'reviewed'], true)) {
        json_response([
            'success' => false,
            'message' => 'Only pending or reviewed overtime requests can be acted on.',
        ], 422);
    }

    if ($status === 'Reviewed') {
        if (!overtime_can_review($sessionUser)) {
            json_response([
                'success' => false,
                'message' => 'Only HR can review overtime requests.',
            ], 403);
        }

        if ($currentStatus !== 'pending') {
            json_response([
                'success' => false,
                'message' => 'Only pending overtime requests can be reviewed.',
            ], 422);
        }
    }

    if ($status === 'Approved') {
        /*
         * HR's sign-off stops at Reviewed. Letting it write Approved here would mint the
         * compensatory credit a stage early, before the Regional Director ever sees the filing.
         */
        if (overtime_can_review($sessionUser) && !overtime_can_give_final_approval($sessionUser)) {
            json_response([
                'success' => false,
                'message' => 'HR approval marks the overtime request as reviewed. The Regional Director gives the final approval.',
            ], 422);
        }

        if (!overtime_can_give_final_approval($sessionUser)) {
            json_response([
                'success' => false,
                'message' => 'Only the Regional Director can give the final approval on overtime requests.',
            ], 403);
        }

        /* The chain is HR first: an admin may still act on either stage. */
        if ($currentStatus !== 'reviewed' && overtime_role_key($sessionUser) !== 'admin') {
            json_response([
                'success' => false,
                'message' => 'This overtime request is still waiting for HR review.',
            ], 422);
        }
    }

    if (in_array($status, ['Reviewed', 'Approved', 'Rejected'], true) && overtime_is_chief($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'A chief may file, edit, or cancel overtime requests, but approval rests with HR and the Regional Director.',
        ], 403);
    }

    if ($status === 'Pending') {
        json_response([
            'success' => false,
            'message' => 'An overtime request cannot be sent back to pending.',
        ], 422);
    }

    /*
     * Both signatures on an overtime filing carry a solved captcha: HR's review and the Regional
     * Director's final approval. Rejecting and cancelling do not — see the approval_workflow entry
     * in captcha-utils.php for why the reversible moves are deliberately left ungated.
     *
     * Read last, after every role and stage check above has passed, so a caller who was never
     * allowed to sign this request is turned away on that ground rather than being handed a
     * challenge first and burning one of its three attempts on an approval that could not happen.
     */
    if (in_array($status, ['Reviewed', 'Approved'], true)) {
        require_approval_captcha($body);
    }

    /*
     * The HR signature stays on the row once written — a later approval, rejection or cancellation
     * records its own outcome without erasing who reviewed it.
     */
    $now = date('Y-m-d H:i:s');
    $isReview = $status === 'Reviewed';
    $reviewedByEmployeeId = $currentRecord['reviewed_by'] !== null ? (int)$currentRecord['reviewed_by'] : null;
    $reviewedAt = $currentRecord['reviewed_at'] ?? null;

    $statement = $pdo->prepare(
        'UPDATE overtime
         SET status = :status,
             reviewed_by = :reviewed_by,
             reviewed_at = :reviewed_at,
             approved_by = :approved_by,
             approved_at = :approved_at
         WHERE overtime_id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':reviewed_by' => $isReview ? $sessionEmployeeId : $reviewedByEmployeeId,
        ':reviewed_at' => $isReview ? $now : $reviewedAt,
        ':approved_by' => $status === 'Approved' ? $sessionEmployeeId : null,
        ':approved_at' => $status === 'Approved' ? $now : null,
        ':id' => $id,
    ]);

    $messages = [
        'Reviewed' => 'Overtime request reviewed. It now awaits the Regional Director\'s final approval.',
        'Approved' => 'Overtime request approved. The rendered overtime credits were posted to the employee.',
        'Rejected' => 'Overtime request rejected.',
        'Cancelled' => 'Overtime request cancelled.',
    ];

    json_response([
        'success' => true,
        'record' => fetch_overtime($pdo, $id),
        'message' => $messages[$status] ?? 'Overtime request updated.',
    ]);
}

function archive_overtime(PDO $pdo, array $body, array $sessionUser, bool $archived): void
{
    if (!overtime_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive overtime requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0 || fetch_overtime($pdo, $id) === null) {
        json_response([
            'success' => false,
            'message' => 'Overtime request not found.',
        ], 404);
    }

    set_record_archived($pdo, 'overtime', 'overtime_id', $id, $archived, $sessionUser, 'Overtime Request');

    json_response([
        'success' => true,
        'message' => $archived ? 'Overtime request archived.' : 'Overtime request restored.',
        'record' => fetch_overtime($pdo, $id),
    ]);
}

try {
    ensure_overtime_table($pdo);
    ensure_archive_columns($pdo, 'overtime');

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        list_overtime($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        $body = read_json_body();
        $action = strtolower(overtime_text($body['action'] ?? ''));

        if ($action === 'manual_coc_credit') {
            create_manual_coc_credit($pdo, $body, $sessionUser);
        }

        if ($action === 'manual_coc_adjust') {
            adjust_manual_coc_credits($pdo, $body, $sessionUser);
        }

        create_overtime($pdo, $body, $sessionUser);
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $action = strtolower(overtime_text($body['action'] ?? ''));

        if ($action === 'archive' || $action === 'restore') {
            archive_overtime($pdo, $body, $sessionUser, $action === 'archive');
        }

        if ($action === 'update') {
            update_overtime_request($pdo, $body, $sessionUser);
        }

        update_overtime_status($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Overtime API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process overtime request.',
    ], 500);
}
