<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

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
    return hris_user_role_key($user);
}

function overtime_can_manage(array $user): bool
{
    return in_array(overtime_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'chief'], true);
}

function overtime_can_view_all(array $user): bool
{
    return overtime_role_key($user) !== 'employee';
}

function overtime_status_to_database(mixed $status): string
{
    return match (strtolower(overtime_text($status))) {
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled' => 'Cancelled',
        default => 'Pending',
    };
}

function ensure_overtime_table(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS overtime (
            overtime_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_id INT UNSIGNED NOT NULL,
            work_date DATE NOT NULL,
            hour_requested DECIMAL(5,2) NOT NULL,
            request_date DATETIME NOT NULL,
            reason VARCHAR(255) NULL,
            status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending',
            duration DECIMAL(5,2) NOT NULL,
            approved_by INT UNSIGNED NULL,
            approved_at TIMESTAMP NULL DEFAULT NULL,
            created_by INT UNSIGNED NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (overtime_id),
            KEY idx_overtime_employee_id (employee_id),
            KEY idx_overtime_status (status),
            KEY idx_overtime_work_date (work_date),
            KEY idx_overtime_approved_by (approved_by),
            KEY idx_overtime_created_by (created_by),
            CONSTRAINT fk_overtime_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    if (!hris_database_column_exists($pdo, 'overtime', 'work_date')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN work_date DATE NULL AFTER employee_id');

        if (hris_database_column_exists($pdo, 'overtime', 'overtime_date')) {
            $pdo->exec('UPDATE overtime SET work_date = overtime_date WHERE work_date IS NULL');
        }

        $pdo->exec('UPDATE overtime SET work_date = CURDATE() WHERE work_date IS NULL');
    }

    if (!hris_database_column_exists($pdo, 'overtime', 'hour_requested')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN hour_requested DECIMAL(5,2) NULL AFTER work_date');

        if (hris_database_column_exists($pdo, 'overtime', 'overtime_hours')) {
            $pdo->exec('UPDATE overtime SET hour_requested = overtime_hours WHERE hour_requested IS NULL');
        } elseif (hris_database_column_exists($pdo, 'overtime', 'hours_worked')) {
            $pdo->exec('UPDATE overtime SET hour_requested = hours_worked WHERE hour_requested IS NULL');
        }

        $pdo->exec('UPDATE overtime SET hour_requested = 0 WHERE hour_requested IS NULL');
    }

    if (!hris_database_column_exists($pdo, 'overtime', 'duration')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN duration DECIMAL(5,2) NULL AFTER status');
        $pdo->exec('UPDATE overtime SET duration = hour_requested WHERE duration IS NULL');
    }

    if (!hris_database_column_exists($pdo, 'overtime', 'request_date')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN request_date DATETIME NULL AFTER hour_requested');
        $pdo->exec('UPDATE overtime SET request_date = created_at WHERE request_date IS NULL');
        $pdo->exec('UPDATE overtime SET request_date = NOW() WHERE request_date IS NULL');
    }

    $pdo->exec('ALTER TABLE overtime MODIFY request_date DATETIME NOT NULL');

    if (!hris_database_column_exists($pdo, 'overtime', 'approved_at')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL AFTER approved_by');
    }

    if (!hris_database_column_exists($pdo, 'overtime', 'created_by')) {
        $pdo->exec('ALTER TABLE overtime ADD COLUMN created_by INT UNSIGNED NULL AFTER approved_at');
    }

    $pdo->exec(
        "ALTER TABLE overtime
         MODIFY status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending'"
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
    $record['hourRequested'] = (float)$record['hourRequested'];
    $record['hoursWorked'] = (float)$record['hoursWorked'];
    $record['overtimeHours'] = (float)$record['overtimeHours'];
    $record['duration'] = (float)$record['duration'];
    $record['reason'] = overtime_text($record['reason'] ?? '');

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
                o.approved_by AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                o.approved_at AS approvedAt,
                o.created_by AS createdBy,
                o.request_date AS dateFiled,
                o.created_at AS createdAt
            FROM overtime o
            INNER JOIN employees e ON e.id = o.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN employees approved_employee ON approved_employee.id = o.approved_by';

    $params = [];
    if ($employeeScopeId !== null) {
        $sql .= ' WHERE o.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
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
    }
    unset($record);

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

function create_overtime(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_overtime_employee_id($pdo, $body, $sessionUser);
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
        'employee_id' => $employeeId,
        'work_date' => $workDate,
        'hour_requested' => number_format((float)$hourRequested, 2, '.', ''),
        'request_date' => $requestDate,
        'reason' => $reason !== '' ? $reason : null,
        'status' => 'Pending',
        'duration' => number_format((float)$duration, 2, '.', ''),
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
    $params = [];

    foreach ($insert as $column => $value) {
        $params[':' . $column] = $value;
    }

    $statement = $pdo->prepare(
        'INSERT INTO overtime (' . implode(', ', $columnNames) . ')
         VALUES (' . implode(', ', $placeholders) . ')'
    );
    $statement->execute($params);

    $recordId = (int)$pdo->lastInsertId();
    $scopeId = overtime_can_view_all($sessionUser) ? null : resolve_overtime_session_employee_id($pdo, $sessionUser);
    json_response([
        'success' => true,
        'record' => fetch_overtime($pdo, $recordId, $scopeId),
    ], 201);
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

    $currentRecordStatement = $pdo->prepare('SELECT employee_id FROM overtime WHERE overtime_id = :id LIMIT 1');
    $currentRecordStatement->execute([':id' => $id]);
    $currentRecord = $currentRecordStatement->fetch();

    if (!$currentRecord) {
        json_response([
            'success' => false,
            'message' => 'Overtime request was not found.',
        ], 404);
    }

    $sessionEmployeeId = hris_session_employee_record_id($pdo, $sessionUser);
    if ($sessionEmployeeId !== null && (int)($currentRecord['employee_id'] ?? 0) === $sessionEmployeeId) {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own overtime request. Please ask another authorized user to review it.',
        ], 403);
    }

    $statement = $pdo->prepare(
        'UPDATE overtime
         SET status = :status,
             approved_by = :approved_by,
             approved_at = :approved_at
         WHERE overtime_id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':approved_by' => $status === 'Approved' ? $sessionEmployeeId : null,
        ':approved_at' => $status === 'Approved' ? date('Y-m-d H:i:s') : null,
        ':id' => $id,
    ]);

    json_response([
        'success' => true,
        'record' => fetch_overtime($pdo, $id),
        'message' => 'Overtime request updated.',
    ]);
}

try {
    ensure_overtime_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        list_overtime($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_overtime($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        update_overtime_status($pdo, read_json_body(), $sessionUser);
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
