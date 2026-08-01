<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

const CASH_ADVANCE_STATUSES = ['Pending', 'Approved', 'Rejected'];

function cash_advance_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function cash_advance_decimal(mixed $value): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return 0.0;
    }

    return round((float)$value, 2);
}

function cash_advance_date_or_null(mixed $value): ?string
{
    $text = cash_advance_text($value);

    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);

    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function cash_advance_status(mixed $value): string
{
    $status = cash_advance_text($value);

    foreach (CASH_ADVANCE_STATUSES as $allowedStatus) {
        if (strcasecmp($status, $allowedStatus) === 0) {
            return $allowedStatus;
        }
    }

    return 'Pending';
}

function cash_advance_role_key(array $user): string
{
    return hris_user_role_key($user);
}

function cash_advance_can_manage(array $user): bool
{
    return in_array(cash_advance_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function cash_advance_can_view_all(array $user): bool
{
    return cash_advance_role_key($user) !== 'employee';
}

function cash_advance_employee_scope_id(PDO $pdo, array $sessionUser): ?int
{
    if (cash_advance_can_view_all($sessionUser)) {
        return null;
    }

    $employeeId = hris_session_employee_record_id($pdo, $sessionUser);

    if ($employeeId !== null) {
        return $employeeId;
    }

    json_response([
        'success' => false,
        'message' => 'Signed-in employee record was not found.',
    ], 422);
}

function ensure_cash_advance_table(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS cash_advance_requests (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_id INT UNSIGNED NOT NULL,
            cash_advance_amount DECIMAL(12,2) NOT NULL,
            request_date DATE NOT NULL,
            purpose VARCHAR(255) NULL,
            deduction_notes TEXT NULL,
            status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
            is_archived TINYINT(1) NOT NULL DEFAULT 0,
            approved_by_user_id INT UNSIGNED NULL,
            approved_at DATETIME NULL,
            rejected_by_user_id INT UNSIGNED NULL,
            rejected_at DATETIME NULL,
            created_by_user_id INT UNSIGNED NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_cash_advance_employee_id (employee_id),
            KEY idx_cash_advance_status (status),
            KEY idx_cash_advance_request_date (request_date),
            KEY idx_cash_advance_archived (is_archived),
            KEY idx_cash_advance_created_by (created_by_user_id),
            CONSTRAINT fk_cash_advance_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function resolve_cash_advance_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!cash_advance_can_view_all($sessionUser)) {
        $employeeId = hris_session_employee_record_id($pdo, $sessionUser);

        if ($employeeId !== null) {
            return $employeeId;
        }

        json_response([
            'success' => false,
            'message' => 'Signed-in employee record was not found.',
        ], 422);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employee_id'] ?? 0);
    $employeeCode = cash_advance_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = cash_advance_text($body['employeeName'] ?? '');

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
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) COLLATE utf8mb4_unicode_ci = :employee_name
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

function cash_advance_base_select(): string
{
    return 'SELECT
            ca.id,
            ca.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS division,
            des.name AS designation,
            ca.cash_advance_amount AS amount,
            ca.request_date AS requestDate,
            DATE_FORMAT(ca.request_date, "%M %e, %Y") AS requestDateDisplay,
            ca.purpose,
            ca.deduction_notes AS deductionNotes,
            ca.status,
            ca.is_archived AS isArchived,
            ca.approved_by_user_id AS approvedByUserId,
            ca.approved_at AS approvedAt,
            approved_user.username AS approvedBy,
            ca.rejected_by_user_id AS rejectedByUserId,
            ca.rejected_at AS rejectedAt,
            rejected_user.username AS rejectedBy,
            ca.created_by_user_id AS createdByUserId,
            creator.username AS createdBy,
            ca.created_at AS createdAt,
            ca.updated_at AS updatedAt
         FROM cash_advance_requests ca
         INNER JOIN employees e ON e.id = ca.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN users approved_user ON approved_user.id = ca.approved_by_user_id
         LEFT JOIN users rejected_user ON rejected_user.id = ca.rejected_by_user_id
         LEFT JOIN users creator ON creator.id = ca.created_by_user_id';
}

function cash_advance_normalize_record(array $record): array
{
    $record['id'] = (int)$record['id'];
    $record['employeeRecordId'] = (int)$record['employeeRecordId'];
    $record['amount'] = cash_advance_decimal($record['amount'] ?? 0);
    $record['isArchived'] = (bool)($record['isArchived'] ?? false);
    $record['approvedByUserId'] = $record['approvedByUserId'] !== null ? (int)$record['approvedByUserId'] : null;
    $record['rejectedByUserId'] = $record['rejectedByUserId'] !== null ? (int)$record['rejectedByUserId'] : null;
    $record['createdByUserId'] = $record['createdByUserId'] !== null ? (int)$record['createdByUserId'] : null;

    return $record;
}

function fetch_cash_advance(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = cash_advance_base_select() . ' WHERE ca.id = :id';
    $params = [':id' => $id];

    if ($employeeScopeId !== null) {
        $sql .= ' AND ca.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $record = $statement->fetch();

    return $record ? cash_advance_normalize_record($record) : null;
}

function list_cash_advances(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = cash_advance_employee_scope_id($pdo, $sessionUser);
    $includeArchived = filter_var($_GET['archived'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $approvedOnly = filter_var($_GET['approved'] ?? false, FILTER_VALIDATE_BOOLEAN);

    $conditions = [];
    $params = [];

    if (!$includeArchived) {
        $conditions[] = 'ca.is_archived = 0';
    }

    if ($approvedOnly) {
        $conditions[] = 'ca.status = "Approved"';
    }

    if ($employeeScopeId !== null) {
        $conditions[] = 'ca.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql = cash_advance_base_select();
    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }
    $sql .= ' ORDER BY ca.request_date DESC, ca.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $records = array_map(
        static fn (array $record): array => cash_advance_normalize_record($record),
        $statement->fetchAll()
    );

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

function validate_cash_advance_payload(float $amount, ?string $requestDate): void
{
    $errors = [];

    if ($amount <= 0) {
        $errors[] = 'Cash advance amount must be greater than 0.';
    }

    if ($requestDate === null) {
        $errors[] = 'Request date is required.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }
}

function create_cash_advance(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_cash_advance_employee_id($pdo, $body, $sessionUser);
    $amount = cash_advance_decimal($body['amount'] ?? $body['cashAdvanceAmount'] ?? 0);
    $requestDate = cash_advance_date_or_null($body['requestDate'] ?? $body['request_date'] ?? null);
    $purpose = cash_advance_text($body['purpose'] ?? '');
    $deductionNotes = cash_advance_text($body['deductionNotes'] ?? $body['deduction_notes'] ?? '');

    validate_cash_advance_payload($amount, $requestDate);

    $statement = $pdo->prepare(
        'INSERT INTO cash_advance_requests
            (employee_id, cash_advance_amount, request_date, purpose, deduction_notes, status, created_by_user_id)
         VALUES
            (:employee_id, :cash_advance_amount, :request_date, :purpose, :deduction_notes, "Pending", :created_by_user_id)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':cash_advance_amount' => number_format($amount, 2, '.', ''),
        ':request_date' => $requestDate,
        ':purpose' => $purpose !== '' ? $purpose : null,
        ':deduction_notes' => $deductionNotes !== '' ? $deductionNotes : null,
        ':created_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
    ]);

    $recordId = (int)$pdo->lastInsertId();
    $scopeId = cash_advance_employee_scope_id($pdo, $sessionUser);

    json_response([
        'success' => true,
        'message' => 'Cash advance request submitted successfully.',
        'record' => fetch_cash_advance($pdo, $recordId, $scopeId),
    ], 201);
}

function update_cash_advance(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Cash advance request is required.',
        ], 422);
    }

    $scopeId = cash_advance_employee_scope_id($pdo, $sessionUser);
    $existing = fetch_cash_advance($pdo, $id, $scopeId);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Cash advance request not found.',
        ], 404);
    }

    if (!cash_advance_can_manage($sessionUser) && $existing['status'] !== 'Pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending cash advance requests can be edited.',
        ], 403);
    }

    $employeeId = cash_advance_can_manage($sessionUser)
        ? resolve_cash_advance_employee_id($pdo, [
            'employeeRecordId' => $body['employeeRecordId'] ?? $existing['employeeRecordId'],
        ], $sessionUser)
        : (int)$existing['employeeRecordId'];
    $amount = cash_advance_decimal($body['amount'] ?? $body['cashAdvanceAmount'] ?? $existing['amount']);
    $requestDate = cash_advance_date_or_null($body['requestDate'] ?? $existing['requestDate']);
    $purpose = cash_advance_text($body['purpose'] ?? $existing['purpose']);
    $deductionNotes = cash_advance_text($body['deductionNotes'] ?? $existing['deductionNotes']);

    validate_cash_advance_payload($amount, $requestDate);

    $statement = $pdo->prepare(
        'UPDATE cash_advance_requests
         SET employee_id = :employee_id,
             cash_advance_amount = :cash_advance_amount,
             request_date = :request_date,
             purpose = :purpose,
             deduction_notes = :deduction_notes
         WHERE id = :id'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':cash_advance_amount' => number_format($amount, 2, '.', ''),
        ':request_date' => $requestDate,
        ':purpose' => $purpose !== '' ? $purpose : null,
        ':deduction_notes' => $deductionNotes !== '' ? $deductionNotes : null,
        ':id' => $id,
    ]);

    json_response([
        'success' => true,
        'message' => 'Cash advance request updated successfully.',
        'record' => fetch_cash_advance($pdo, $id, $scopeId),
    ]);
}

function update_cash_advance_status(PDO $pdo, array $body, array $sessionUser): void
{
    if (!cash_advance_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to approve or reject cash advance requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $status = cash_advance_status($body['status'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Cash advance request is required.',
        ], 422);
    }

    if (fetch_cash_advance($pdo, $id) === null) {
        json_response([
            'success' => false,
            'message' => 'Cash advance request not found.',
        ], 404);
    }

    $approvedBy = $status === 'Approved' ? ((int)($sessionUser['id'] ?? 0) ?: null) : null;
    $approvedAt = $status === 'Approved' ? date('Y-m-d H:i:s') : null;
    $rejectedBy = $status === 'Rejected' ? ((int)($sessionUser['id'] ?? 0) ?: null) : null;
    $rejectedAt = $status === 'Rejected' ? date('Y-m-d H:i:s') : null;

    $statement = $pdo->prepare(
        'UPDATE cash_advance_requests
         SET status = :status,
             approved_by_user_id = :approved_by_user_id,
             approved_at = :approved_at,
             rejected_by_user_id = :rejected_by_user_id,
             rejected_at = :rejected_at
         WHERE id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':approved_by_user_id' => $approvedBy,
        ':approved_at' => $approvedAt,
        ':rejected_by_user_id' => $rejectedBy,
        ':rejected_at' => $rejectedAt,
        ':id' => $id,
    ]);

    json_response([
        'success' => true,
        'message' => 'Cash advance request status updated successfully.',
        'record' => fetch_cash_advance($pdo, $id),
    ]);
}

function archive_cash_advance(PDO $pdo, array $body, array $sessionUser): void
{
    if (!cash_advance_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive cash advance requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0 || fetch_cash_advance($pdo, $id) === null) {
        json_response([
            'success' => false,
            'message' => 'Cash advance request not found.',
        ], 404);
    }

    $statement = $pdo->prepare(
        'UPDATE cash_advance_requests
         SET is_archived = 1
         WHERE id = :id'
    );
    $statement->execute([':id' => $id]);

    json_response([
        'success' => true,
        'message' => 'Cash advance request archived successfully.',
        'record' => fetch_cash_advance($pdo, $id),
    ]);
}

try {
    ensure_cash_advance_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        list_cash_advances($pdo, $sessionUser);
    }

    $body = read_json_body();

    if ($method === 'POST') {
        create_cash_advance($pdo, $body, $sessionUser);
    }

    if ($method === 'PUT') {
        $action = cash_advance_text($body['action'] ?? 'update');

        if ($action === 'status') {
            update_cash_advance_status($pdo, $body, $sessionUser);
        }

        if ($action === 'archive') {
            archive_cash_advance($pdo, $body, $sessionUser);
        }

        update_cash_advance($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Cash advance API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process cash advance request.',
    ], 500);
}
