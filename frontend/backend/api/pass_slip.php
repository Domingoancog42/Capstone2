<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

function pass_slip_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function pass_slip_date_or_null(mixed $value): ?string
{
    $text = pass_slip_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function pass_slip_time_or_null(mixed $value): ?string
{
    $text = pass_slip_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('H:i', $text);
    return $date && $date->format('H:i') === $text ? $text . ':00' : null;
}

function pass_slip_role_key(array $user): string
{
    return hris_user_role_key($user);
}

function pass_slip_can_manage(array $user): bool
{
    return in_array(pass_slip_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector'], true);
}

function pass_slip_can_view_all(array $user): bool
{
    return pass_slip_role_key($user) !== 'employee';
}

function pass_slip_status_to_database(mixed $status): string
{
    return match (strtolower(pass_slip_text($status))) {
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'returned' => 'Returned',
        default => 'Pending',
    };
}

function resolve_pass_slip_session_employee_id(PDO $pdo, array $user): int
{
    $employeeCode = pass_slip_text($user['employee_id'] ?? '');
    $employeeName = pass_slip_text($user['full_name'] ?? '');

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

function resolve_pass_slip_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!pass_slip_can_view_all($sessionUser)) {
        return resolve_pass_slip_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = pass_slip_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = pass_slip_text($body['employeeName'] ?? '');

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

function fetch_pass_slip(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = 'SELECT
                ps.id,
                ps.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                ps.pass_date AS passDate,
                TIME_FORMAT(ps.departure_time, "%h:%i %p") AS departureTimeDisplay,
                TIME_FORMAT(ps.time_returned, "%h:%i %p") AS timeReturnedDisplay,
                TIME_FORMAT(ps.departure_time, "%H:%i") AS departureTime,
                TIME_FORMAT(ps.time_returned, "%H:%i") AS timeReturned,
                ps.destination,
                ps.purpose,
                ps.status,
                ps.approved_by AS approvedBy,
                approver.username AS approvedByUsername,
                DATE(ps.created_at) AS dateFiled
            FROM pass_slip ps
            INNER JOIN employees e ON e.id = ps.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN users approver ON approver.id = ps.approved_by
            WHERE ps.id = :id';

    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $sql .= ' AND ps.employee_id = :employee_scope_id';
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
    $record['approvedBy'] = $record['approvedBy'] !== null ? (int)$record['approvedBy'] : null;

    return $record;
}

function list_pass_slips(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = pass_slip_can_view_all($sessionUser) ? null : resolve_pass_slip_session_employee_id($pdo, $sessionUser);

    $sql = 'SELECT
                ps.id,
                ps.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                ps.pass_date AS passDate,
                TIME_FORMAT(ps.departure_time, "%h:%i %p") AS departureTimeDisplay,
                TIME_FORMAT(ps.time_returned, "%h:%i %p") AS timeReturnedDisplay,
                TIME_FORMAT(ps.departure_time, "%H:%i") AS departureTime,
                TIME_FORMAT(ps.time_returned, "%H:%i") AS timeReturned,
                ps.destination,
                ps.purpose,
                ps.status,
                ps.approved_by AS approvedBy,
                approver.username AS approvedByUsername,
                DATE(ps.created_at) AS dateFiled
            FROM pass_slip ps
            INNER JOIN employees e ON e.id = ps.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN users approver ON approver.id = ps.approved_by';

    $params = [];
    if ($employeeScopeId !== null) {
        $sql .= ' WHERE ps.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    $sql .= ' ORDER BY ps.created_at DESC, ps.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $records = $statement->fetchAll();

    foreach ($records as &$record) {
        $record['id'] = (int)$record['id'];
        $record['employeeRecordId'] = (int)$record['employeeRecordId'];
        $record['approvedBy'] = $record['approvedBy'] !== null ? (int)$record['approvedBy'] : null;
    }
    unset($record);

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

function create_pass_slip(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_pass_slip_employee_id($pdo, $body, $sessionUser);
    $passDate = pass_slip_date_or_null($body['passDate'] ?? null);
    $departureTime = pass_slip_time_or_null($body['departureTime'] ?? null);
    $timeReturned = pass_slip_time_or_null($body['timeReturned'] ?? null);
    $destination = pass_slip_text($body['destination'] ?? '');
    $purpose = pass_slip_text($body['purpose'] ?? '');

    $errors = [];
    if ($passDate === null) {
        $errors[] = 'Pass date is required.';
    }
    if ($departureTime === null) {
        $errors[] = 'Departure time is required.';
    }
    if ($timeReturned === null) {
        $errors[] = 'Time returned is required.';
    }
    if ($destination === '') {
        $errors[] = 'Destination is required.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $statement = $pdo->prepare(
        'INSERT INTO pass_slip
            (employee_id, pass_date, departure_time, time_returned, destination, purpose, status, approved_by)
         VALUES
            (:employee_id, :pass_date, :departure_time, :time_returned, :destination, :purpose, "Pending", NULL)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':pass_date' => $passDate,
        ':departure_time' => $departureTime,
        ':time_returned' => $timeReturned,
        ':destination' => $destination,
        ':purpose' => $purpose !== '' ? $purpose : null,
    ]);

    $recordId = (int)$pdo->lastInsertId();
    $scopeId = pass_slip_can_view_all($sessionUser) ? null : resolve_pass_slip_session_employee_id($pdo, $sessionUser);
    json_response([
        'success' => true,
        'record' => fetch_pass_slip($pdo, $recordId, $scopeId),
    ], 201);
}

function update_pass_slip(PDO $pdo, array $body, array $sessionUser): void
{
    if (!pass_slip_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to update pass slips.',
        ], 403);
    }

    $id = (int)($body['id'] ?? $body['recordId'] ?? 0);
    $status = pass_slip_status_to_database($body['status'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Pass slip is required.',
        ], 422);
    }

    $currentRecordStatement = $pdo->prepare(
        'SELECT employee_id FROM pass_slip WHERE id = :id LIMIT 1'
    );
    $currentRecordStatement->execute([':id' => $id]);
    $currentRecord = $currentRecordStatement->fetch();

    if (!$currentRecord) {
        json_response([
            'success' => false,
            'message' => 'Pass slip not found.',
        ], 404);
    }

    $sessionEmployeeId = hris_session_employee_record_id($pdo, $sessionUser);
    if ($sessionEmployeeId !== null && (int)($currentRecord['employee_id'] ?? 0) === $sessionEmployeeId) {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own pass slip. Please ask another authorized user to review it.',
        ], 403);
    }

    $statement = $pdo->prepare(
        'UPDATE pass_slip
         SET status = :status,
             approved_by = :approved_by
         WHERE id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':approved_by' => (int)($sessionUser['id'] ?? 0) ?: null,
        ':id' => $id,
    ]);

    if ($statement->rowCount() === 0) {
        $exists = $pdo->prepare('SELECT COUNT(*) FROM pass_slip WHERE id = :id');
        $exists->execute([':id' => $id]);
        if ((int)$exists->fetchColumn() === 0) {
            json_response([
                'success' => false,
                'message' => 'Pass slip not found.',
            ], 404);
        }
    }

    json_response([
        'success' => true,
        'record' => fetch_pass_slip($pdo, $id),
    ]);
}

function delete_pass_slip(PDO $pdo, array $body, array $sessionUser): void
{
    if (!pass_slip_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to delete pass slips.',
        ], 403);
    }

    $id = (int)($body['id'] ?? $body['recordId'] ?? 0);
    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Pass slip is required.',
        ], 422);
    }

    $statement = $pdo->prepare('DELETE FROM pass_slip WHERE id = :id');
    $statement->execute([':id' => $id]);

    if ($statement->rowCount() === 0) {
        json_response([
            'success' => false,
            'message' => 'Pass slip not found.',
        ], 404);
    }

    json_response([
        'success' => true,
        'message' => 'Pass slip deleted successfully.',
    ]);
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        list_pass_slips($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_pass_slip($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        update_pass_slip($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'DELETE') {
        delete_pass_slip($pdo, read_json_body(), $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Pass slip API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process pass slip request.',
    ], 500);
}
