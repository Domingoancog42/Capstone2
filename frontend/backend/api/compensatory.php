<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

$sessionUser = require_session_user();

function compensatory_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function compensatory_date_or_null(mixed $value): ?string
{
    $text = compensatory_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function ensure_compensatory_rejected_note_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'rejected_note'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE compensatory ADD COLUMN rejected_note TEXT NULL AFTER remarks');
}

function compensatory_number_or_null(mixed $value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }

    if (!is_numeric($value)) {
        return null;
    }

    return (float)$value;
}

function compensatory_role_key(array $user): string
{
    return hris_user_role_key($user);
}

function compensatory_can_manage(array $user): bool
{
    return in_array(compensatory_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'chief'], true);
}

function compensatory_can_view_all(array $user): bool
{
    return compensatory_role_key($user) !== 'employee';
}

function compensatory_status_to_database(mixed $status): string
{
    return match (strtolower(compensatory_text($status))) {
        'reviewed' => 'Reviewed',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled' => 'Cancelled',
        default => 'Pending',
    };
}

function compensatory_can_mark_reviewed(array $user): bool
{
    return compensatory_role_key($user) === 'hrhead';
}

function compensatory_is_regional_director(array $user): bool
{
    return compensatory_role_key($user) === 'regionaldirector';
}

function ensure_compensatory_reviewed_status(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'status'");
    $column = $statement !== false ? $statement->fetch() : false;
    $columnType = strtolower((string)($column['Type'] ?? $column['type'] ?? ''));

    if ($columnType !== '' && strpos($columnType, "'reviewed'") !== false) {
        return;
    }

    $pdo->exec(
        "ALTER TABLE compensatory
         MODIFY COLUMN status ENUM('Pending', 'Reviewed', 'Approved', 'Rejected', 'Cancelled')
         NOT NULL DEFAULT 'Pending'"
    );
}

function ensure_compensatory_action_actor_columns(PDO $pdo): void
{
    $reviewedByStatement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'reviewed_by_employee_id'");
    if ($reviewedByStatement !== false && $reviewedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE compensatory
             ADD COLUMN reviewed_by_employee_id INT UNSIGNED NULL AFTER rejected_note'
        );
    }

    $approvedByStatement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'approved_by_employee_id'");
    if ($approvedByStatement !== false && $approvedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE compensatory
             ADD COLUMN approved_by_employee_id INT UNSIGNED NULL AFTER reviewed_by_employee_id'
        );
    }
}

function resolve_compensatory_session_employee_id(PDO $pdo, array $user): int
{
    $employeeCode = compensatory_text($user['employee_id'] ?? '');
    $employeeName = compensatory_text($user['full_name'] ?? '');

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

function resolve_compensatory_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!compensatory_can_view_all($sessionUser)) {
        return resolve_compensatory_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = compensatory_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = compensatory_text($body['employeeName'] ?? '');

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

function fetch_compensatory(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = 'SELECT
                c.id,
                c.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                c.hours_applied AS hoursApplied,
                c.start_date AS startDate,
                c.end_date AS endDate,
                c.status,
                c.approved_by AS approvedBy,
                approver.username AS approvedByUsername,
                c.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
                c.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
                c.remarks,
                COALESCE(c.rejected_note, "") AS rejectedNote,
                DATE(c.created_at) AS dateFiled,
                c.created_at AS createdAt,
                c.updated_at AS updatedAt
            FROM compensatory c
            INNER JOIN employees e ON e.id = c.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN users approver ON approver.id = c.approved_by
            LEFT JOIN employees reviewed_employee ON reviewed_employee.id = c.reviewed_by_employee_id
            LEFT JOIN employees approved_employee ON approved_employee.id = c.approved_by_employee_id
            WHERE c.id = :id';

    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $sql .= ' AND c.employee_id = :employee_scope_id';
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
    $record['reviewedByEmployeeRecordId'] = $record['reviewedByEmployeeRecordId'] !== null
        ? (int)$record['reviewedByEmployeeRecordId']
        : null;
    $record['reviewedByName'] = compensatory_text($record['reviewedByName'] ?? '');
    $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
        ? (int)$record['approvedByEmployeeRecordId']
        : null;
    $record['approvedByName'] = compensatory_text($record['approvedByName'] ?? '');
    $record['status'] = compensatory_status_to_database($record['status'] ?? '');
    $record['hoursApplied'] = (float)$record['hoursApplied'];
    $record['rejectedNote'] = compensatory_text($record['rejectedNote'] ?? '');

    return $record;
}

function fetch_compensatory_notification_context(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            c.id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.email AS employeeEmail,
            d.name AS division,
            c.hours_applied AS hoursApplied,
            c.start_date AS startDate,
            c.end_date AS endDate,
            COALESCE(c.remarks, "") AS remarks,
            COALESCE(c.rejected_note, "") AS rejectedNote
         FROM compensatory c
         INNER JOIN employees e ON e.id = c.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE c.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $record['employeeName'] = compensatory_text($record['employeeName'] ?? '');
    $record['employeeEmail'] = compensatory_text($record['employeeEmail'] ?? '');
    $record['division'] = compensatory_text($record['division'] ?? '');
    $record['hoursApplied'] = rtrim(rtrim(number_format((float)($record['hoursApplied'] ?? 0), 2, '.', ''), '0'), '.');
    if ((string)$record['hoursApplied'] !== '') {
        $record['hoursApplied'] .= ' hours';
    }
    $record['startDate'] = compensatory_text($record['startDate'] ?? '');
    $record['endDate'] = compensatory_text($record['endDate'] ?? '');
    $record['remarks'] = compensatory_text($record['remarks'] ?? '');
    $record['rejectedNote'] = compensatory_text($record['rejectedNote'] ?? '');

    return $record;
}

function send_compensatory_rejection_notification(PDO $pdo, int $id): ?string
{
    $record = fetch_compensatory_notification_context($pdo, $id);

    if ($record === null) {
        return 'Compensatory request rejected, but employee details could not be loaded for email notification.';
    }

    $employeeEmail = compensatory_text($record['employeeEmail'] ?? '');

    if ($employeeEmail === '' || filter_var($employeeEmail, FILTER_VALIDATE_EMAIL) === false) {
        return 'Compensatory request rejected, but no valid employee email address is available.';
    }

    try {
        send_compensatory_rejection_email(
            $employeeEmail,
            (string)$record['employeeName'],
            (string)$record['division'],
            (string)$record['hoursApplied'],
            (string)$record['startDate'],
            (string)$record['endDate'],
            (string)$record['remarks'],
            (string)$record['rejectedNote']
        );
    } catch (Throwable $exception) {
        error_log('Compensatory rejection email error: ' . $exception->getMessage());
        return 'Compensatory request rejected, but the rejection email could not be sent.';
    }

    return null;
}

function list_compensatory(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = compensatory_can_view_all($sessionUser) ? null : resolve_compensatory_session_employee_id($pdo, $sessionUser);

    $sql = 'SELECT
                c.id,
                c.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                c.hours_applied AS hoursApplied,
                c.start_date AS startDate,
                c.end_date AS endDate,
                c.status,
                c.approved_by AS approvedBy,
                approver.username AS approvedByUsername,
                c.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
                c.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
                c.remarks,
                COALESCE(c.rejected_note, "") AS rejectedNote,
                DATE(c.created_at) AS dateFiled,
                c.created_at AS createdAt,
                c.updated_at AS updatedAt
            FROM compensatory c
            INNER JOIN employees e ON e.id = c.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN users approver ON approver.id = c.approved_by
            LEFT JOIN employees reviewed_employee ON reviewed_employee.id = c.reviewed_by_employee_id
            LEFT JOIN employees approved_employee ON approved_employee.id = c.approved_by_employee_id';

    $params = [];
    if ($employeeScopeId !== null) {
        $sql .= ' WHERE c.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    $sql .= ' ORDER BY c.created_at DESC, c.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $records = $statement->fetchAll();

    foreach ($records as &$record) {
        $record['id'] = (int)$record['id'];
        $record['employeeRecordId'] = (int)$record['employeeRecordId'];
        $record['approvedBy'] = $record['approvedBy'] !== null ? (int)$record['approvedBy'] : null;
        $record['reviewedByEmployeeRecordId'] = $record['reviewedByEmployeeRecordId'] !== null
            ? (int)$record['reviewedByEmployeeRecordId']
            : null;
        $record['reviewedByName'] = compensatory_text($record['reviewedByName'] ?? '');
        $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
            ? (int)$record['approvedByEmployeeRecordId']
            : null;
        $record['approvedByName'] = compensatory_text($record['approvedByName'] ?? '');
        $record['status'] = compensatory_status_to_database($record['status'] ?? '');
        $record['hoursApplied'] = (float)$record['hoursApplied'];
        $record['rejectedNote'] = compensatory_text($record['rejectedNote'] ?? '');
    }
    unset($record);

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

function create_compensatory(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_compensatory_employee_id($pdo, $body, $sessionUser);
    $hoursApplied = compensatory_number_or_null($body['hoursApplied'] ?? $body['hours_applied'] ?? null);
    $startDate = compensatory_date_or_null($body['startDate'] ?? $body['start_date'] ?? null);
    $endDate = compensatory_date_or_null($body['endDate'] ?? $body['end_date'] ?? null);
    $remarks = compensatory_text($body['remarks'] ?? '');

    $errors = [];
    if ($hoursApplied === null) {
        $errors[] = 'Number of hours applied for is required.';
    } elseif ($hoursApplied < 4) {
        $errors[] = 'Number of hours applied for must be at least 4 hours.';
    }
    if ($startDate === null) {
        $errors[] = 'Inclusive start date is required.';
    }
    if ($endDate === null) {
        $errors[] = 'Inclusive end date is required.';
    }
    if ($startDate !== null && $endDate !== null && $endDate < $startDate) {
        $errors[] = 'Inclusive end date must not be earlier than the start date.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $statement = $pdo->prepare(
        'INSERT INTO compensatory
            (employee_id, hours_applied, start_date, end_date, status, remarks)
         VALUES
            (:employee_id, :hours_applied, :start_date, :end_date, "Pending", :remarks)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':hours_applied' => number_format((float)$hoursApplied, 2, '.', ''),
        ':start_date' => $startDate,
        ':end_date' => $endDate,
        ':remarks' => $remarks !== '' ? $remarks : null,
    ]);

    $recordId = (int)$pdo->lastInsertId();
    $scopeId = compensatory_can_view_all($sessionUser) ? null : resolve_compensatory_session_employee_id($pdo, $sessionUser);
    json_response([
        'success' => true,
        'record' => fetch_compensatory($pdo, $recordId, $scopeId),
    ], 201);
}

function update_compensatory(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? 0);
    $status = compensatory_status_to_database($body['status'] ?? '');
    $rejectedNote = compensatory_text($body['rejectedNote'] ?? $body['rejected_note'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Compensatory request is required.',
        ], 422);
    }

    if ($status === 'Rejected' && $rejectedNote === '') {
        json_response([
            'success' => false,
            'message' => 'Rejected note is required.',
        ], 422);
    }

    $currentRecordStatement = $pdo->prepare(
        'SELECT employee_id, status, reviewed_by_employee_id, approved_by_employee_id
         FROM compensatory
         WHERE id = :id
         LIMIT 1'
    );
    $currentRecordStatement->execute([':id' => $id]);
    $currentRecord = $currentRecordStatement->fetch();

    if (!$currentRecord) {
        json_response([
            'success' => false,
            'message' => 'Compensatory request was not found.',
        ], 404);
    }

    $sessionEmployeeId = hris_session_employee_record_id($pdo, $sessionUser);
    $currentStatus = (string)($currentRecord['status'] ?? '');
    $currentReviewedByEmployeeId = (int)($currentRecord['reviewed_by_employee_id'] ?? 0);
    $currentApprovedByEmployeeId = (int)($currentRecord['approved_by_employee_id'] ?? 0);
    $isOwnRecord = $sessionEmployeeId !== null && (int)($currentRecord['employee_id'] ?? 0) === $sessionEmployeeId;
    $isOwnCancellation = $isOwnRecord && $status === 'Cancelled';

    if (!compensatory_can_manage($sessionUser) && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to update compensatory time off requests.',
        ], 403);
    }

    if ($isOwnRecord && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own compensatory time off request. Please ask another authorized user to review it.',
        ], 403);
    }

    if ($isOwnCancellation && $currentStatus !== 'Pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending compensatory time off requests can be cancelled.',
        ], 422);
    }

    if ($status === 'Reviewed' && !compensatory_can_mark_reviewed($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only HR Head can approve and forward compensatory time off requests.',
        ], 403);
    }

    if ($status === 'Reviewed' && $currentStatus !== 'Pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending compensatory time off requests can be approved by HR Head.',
        ], 422);
    }

    if ($status === 'Reviewed' && ($sessionEmployeeId === null || $sessionEmployeeId <= 0)) {
        json_response([
            'success' => false,
            'message' => 'Your account is not linked to an employee record, so your name and signature cannot be placed on the CTO form.',
        ], 422);
    }

    if (compensatory_can_mark_reviewed($sessionUser) && $status === 'Approved') {
        json_response([
            'success' => false,
            'message' => 'HR Head approval forwards the compensatory time off request to Regional Director for final approval.',
        ], 422);
    }

    if (!$isOwnCancellation && compensatory_is_regional_director($sessionUser) && in_array($status, ['Approved', 'Rejected', 'Cancelled'], true) && $currentStatus !== 'Reviewed') {
        json_response([
            'success' => false,
            'message' => 'Regional Director can only take final action after HR Head approval.',
        ], 422);
    }

    if ($status === 'Approved' && ($sessionEmployeeId === null || $sessionEmployeeId <= 0)) {
        json_response([
            'success' => false,
            'message' => 'Your account is not linked to an employee record, so your name and signature cannot be placed on the CTO form.',
        ], 422);
    }

    $nextReviewedByEmployeeId = $currentReviewedByEmployeeId > 0 ? $currentReviewedByEmployeeId : null;
    $nextApprovedByEmployeeId = $currentApprovedByEmployeeId > 0 ? $currentApprovedByEmployeeId : null;

    if ($status === 'Reviewed') {
        $nextReviewedByEmployeeId = $sessionEmployeeId !== null && $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
        $nextApprovedByEmployeeId = null;
    }

    if ($status === 'Approved') {
        $nextApprovedByEmployeeId = $sessionEmployeeId !== null && $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
    }

    if (in_array($status, ['Rejected', 'Cancelled'], true)) {
        $nextApprovedByEmployeeId = null;
    }

    $statement = $pdo->prepare(
        'UPDATE compensatory
         SET status = :status,
             approved_by = :approved_by,
             rejected_note = :rejected_note,
             reviewed_by_employee_id = :reviewed_by_employee_id,
             approved_by_employee_id = :approved_by_employee_id
         WHERE id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':approved_by' => $isOwnCancellation ? null : ((int)($sessionUser['id'] ?? 0) ?: null),
        ':rejected_note' => $status === 'Rejected' ? $rejectedNote : null,
        ':reviewed_by_employee_id' => $nextReviewedByEmployeeId,
        ':approved_by_employee_id' => $nextApprovedByEmployeeId,
        ':id' => $id,
    ]);

    if ($statement->rowCount() === 0) {
        $exists = $pdo->prepare('SELECT COUNT(*) FROM compensatory WHERE id = :id');
        $exists->execute([':id' => $id]);
        if ((int)$exists->fetchColumn() === 0) {
            json_response([
                'success' => false,
                'message' => 'Compensatory request was not found.',
            ], 404);
        }
    }

    $notificationWarning = null;

    if ($status === 'Rejected') {
        $notificationWarning = send_compensatory_rejection_notification($pdo, $id);
    }

    json_response([
        'success' => true,
        'record' => fetch_compensatory($pdo, $id),
        'emailNotification' => $status === 'Rejected'
            ? ($notificationWarning === null ? 'sent' : 'warning')
            : 'not_applicable',
        'message' => $status === 'Rejected'
            ? ($notificationWarning ?? 'Compensatory request rejected and the employee was notified by email.')
            : ($status === 'Reviewed'
                ? 'Compensatory request approved by HR Head and forwarded to Regional Director for final approval.'
                : ($status === 'Approved'
                    ? 'Compensatory request approved by Regional Director.'
                    : ($status === 'Cancelled' ? 'Compensatory request cancelled.' : 'Compensatory request updated.'))),
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    ensure_compensatory_rejected_note_column($pdo);
    ensure_compensatory_reviewed_status($pdo);
    ensure_compensatory_action_actor_columns($pdo);

    if ($method === 'GET') {
        list_compensatory($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_compensatory($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        update_compensatory($pdo, read_json_body(), $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Compensatory API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process compensatory request.',
    ], 500);
}
