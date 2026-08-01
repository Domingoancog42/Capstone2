<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

$sessionUser = require_session_user();

function travel_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function travel_date_or_null(mixed $value): ?string
{
    $text = travel_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function ensure_travel_order_rejected_note_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'rejected_note'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN rejected_note TEXT NULL AFTER remarks');
}

function ensure_travel_order_approved_by_employee_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'approved_by_employee_id'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN approved_by_employee_id INT UNSIGNED NULL AFTER rejected_note');
}

function travel_role_key(array $user): string
{
    return hris_user_role_key($user);
}

function travel_can_manage(array $user): bool
{
    $roleKey = travel_role_key($user);
    return in_array($roleKey, ['admin', 'hrhead', 'hrstaff', 'regionaldirector'], true);
}

function travel_can_view_all(array $user): bool
{
    return travel_role_key($user) !== 'employee';
}

function travel_status_to_client(string $status): string
{
    return match (strtolower($status)) {
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled' => 'Cancelled',
        default => 'Pending',
    };
}

function travel_status_to_database(mixed $status): string
{
    return match (strtolower(travel_text($status))) {
        'approved' => 'approved',
        'rejected' => 'rejected',
        'cancelled', 'canceled' => 'cancelled',
        default => 'pending',
    };
}

function travel_default_signatory_for_role(PDO $pdo, string $roleKey): ?array
{
    static $cache = [];

    if (array_key_exists($roleKey, $cache)) {
        return $cache[$roleKey];
    }

    $statement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN status s ON s.id = u.status_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE u.is_archived = 0
           AND LOWER(REPLACE(r.name, " ", "")) = :role_key
           AND LOWER(s.name) = "active"
         ORDER BY u.id ASC
         LIMIT 1'
    );
    $statement->execute([
        ':role_key' => strtolower($roleKey),
    ]);
    $signatory = $statement->fetch();

    if (!$signatory) {
        $cache[$roleKey] = null;
        return null;
    }

    $cache[$roleKey] = [
        'employeeRecordId' => (int)($signatory['employeeRecordId'] ?? 0),
        'employeeName' => travel_text($signatory['employeeName'] ?? ''),
    ];

    return $cache[$roleKey];
}

function travel_apply_signatory_fallbacks(PDO $pdo, array $request): array
{
    $statusKey = travel_status_to_database($request['status'] ?? '');

    if (
        ($request['approvedByEmployeeRecordId'] ?? null) === null
        && $statusKey === 'approved'
    ) {
        $fallbackRegionalDirector = travel_default_signatory_for_role($pdo, 'regionaldirector');
        if ($fallbackRegionalDirector !== null && ($fallbackRegionalDirector['employeeRecordId'] ?? 0) > 0) {
            $request['approvedByEmployeeRecordId'] = (int)$fallbackRegionalDirector['employeeRecordId'];
            $request['approvedBy'] = travel_text($fallbackRegionalDirector['employeeName'] ?? '');
        }
    }

    return $request;
}

function resolve_session_employee_id(PDO $pdo, array $user): int
{
    $employeeCode = travel_text($user['employee_id'] ?? '');
    $employeeName = travel_text($user['full_name'] ?? '');

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

function resolve_travel_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!travel_can_view_all($sessionUser)) {
        return resolve_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = travel_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = travel_text($body['employeeName'] ?? '');

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

function fetch_travel_order(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = 'SELECT
                t.travel_order_id AS id,
                t.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                des.name AS position,
                des.name AS designation,
                t.destination,
                t.purpose,
                t.start_date AS startDate,
                t.end_date AS endDate,
                t.assistance_labor AS assistanceLabor,
                t.appropriations,
                t.remarks,
                COALESCE(t.rejected_note, "") AS rejectedNote,
                t.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                t.status,
                DATE(t.created_at) AS dateFiled,
                t.created_at AS createdAt,
                t.updated_at AS updatedAt
            FROM travel_orders t
            INNER JOIN employees e ON e.id = t.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN designations des ON des.id = e.designation_id
            LEFT JOIN employees approved_employee ON approved_employee.id = t.approved_by_employee_id
            WHERE t.travel_order_id = :id';

    if ($employeeScopeId !== null) {
        $sql .= ' AND t.employee_id = :employee_scope_id';
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    $statement->execute($params);
    $request = $statement->fetch();

    if (!$request) {
        return null;
    }

    $request['id'] = (int)$request['id'];
    $request['employeeRecordId'] = (int)$request['employeeRecordId'];
    $request['rejectedNote'] = travel_text($request['rejectedNote'] ?? '');
    $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
        ? (int)$request['approvedByEmployeeRecordId']
        : null;
    $request['approvedBy'] = travel_text($request['approvedBy'] ?? '');
    $request['status'] = travel_status_to_client((string)$request['status']);
    $request = travel_apply_signatory_fallbacks($pdo, $request);

    return $request;
}

function fetch_travel_order_notification_context(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            t.travel_order_id AS id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.email AS employeeEmail,
            d.name AS division,
            t.destination,
            COALESCE(t.purpose, "") AS purpose,
            t.start_date AS startDate,
            t.end_date AS endDate,
            COALESCE(t.assistance_labor, "") AS assistanceLabor,
            COALESCE(t.appropriations, "") AS appropriations,
            COALESCE(t.remarks, "") AS remarks,
            COALESCE(t.rejected_note, "") AS rejectedNote
         FROM travel_orders t
         INNER JOIN employees e ON e.id = t.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE t.travel_order_id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $request = $statement->fetch();

    if (!$request) {
        return null;
    }

    $request['employeeName'] = travel_text($request['employeeName'] ?? '');
    $request['employeeEmail'] = travel_text($request['employeeEmail'] ?? '');
    $request['division'] = travel_text($request['division'] ?? '');
    $request['destination'] = travel_text($request['destination'] ?? '');
    $request['purpose'] = travel_text($request['purpose'] ?? '');
    $request['startDate'] = travel_text($request['startDate'] ?? '');
    $request['endDate'] = travel_text($request['endDate'] ?? '');
    $request['assistanceLabor'] = travel_text($request['assistanceLabor'] ?? '');
    $request['appropriations'] = travel_text($request['appropriations'] ?? '');
    $request['remarks'] = travel_text($request['remarks'] ?? '');
    $request['rejectedNote'] = travel_text($request['rejectedNote'] ?? '');

    return $request;
}

function send_travel_rejection_notification(PDO $pdo, int $id): ?string
{
    $request = fetch_travel_order_notification_context($pdo, $id);

    if ($request === null) {
        return 'Travel order rejected, but employee details could not be loaded for email notification.';
    }

    $employeeEmail = travel_text($request['employeeEmail'] ?? '');

    if ($employeeEmail === '' || filter_var($employeeEmail, FILTER_VALIDATE_EMAIL) === false) {
        return 'Travel order rejected, but no valid employee email address is available.';
    }

    try {
        send_travel_order_rejection_email(
            $employeeEmail,
            (string)$request['employeeName'],
            (string)$request['division'],
            (string)$request['destination'],
            (string)$request['purpose'],
            (string)$request['startDate'],
            (string)$request['endDate'],
            (string)$request['assistanceLabor'],
            (string)$request['appropriations'],
            (string)$request['remarks'],
            (string)$request['rejectedNote']
        );
    } catch (Throwable $exception) {
        error_log('Travel rejection email error: ' . $exception->getMessage());
        return 'Travel order rejected, but the rejection email could not be sent.';
    }

    return null;
}

function list_travel_orders(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = travel_can_view_all($sessionUser) ? null : resolve_session_employee_id($pdo, $sessionUser);

    $sql = 'SELECT
                t.travel_order_id AS id,
                t.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                des.name AS position,
                des.name AS designation,
                t.destination,
                t.purpose,
                t.start_date AS startDate,
                t.end_date AS endDate,
                t.assistance_labor AS assistanceLabor,
                t.appropriations,
                t.remarks,
                COALESCE(t.rejected_note, "") AS rejectedNote,
                t.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                t.status,
                DATE(t.created_at) AS dateFiled,
                t.created_at AS createdAt,
                t.updated_at AS updatedAt
            FROM travel_orders t
            INNER JOIN employees e ON e.id = t.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN designations des ON des.id = e.designation_id
            LEFT JOIN employees approved_employee ON approved_employee.id = t.approved_by_employee_id';

    $params = [];
    if ($employeeScopeId !== null) {
        $sql .= ' WHERE t.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' ORDER BY t.created_at DESC, t.travel_order_id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $requests = $statement->fetchAll();

    foreach ($requests as &$request) {
        $request['id'] = (int)$request['id'];
        $request['employeeRecordId'] = (int)$request['employeeRecordId'];
        $request['rejectedNote'] = travel_text($request['rejectedNote'] ?? '');
        $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
            ? (int)$request['approvedByEmployeeRecordId']
            : null;
        $request['approvedBy'] = travel_text($request['approvedBy'] ?? '');
        $request['status'] = travel_status_to_client((string)$request['status']);
        $request = travel_apply_signatory_fallbacks($pdo, $request);
    }
    unset($request);

    json_response([
        'success' => true,
        'requests' => $requests,
    ]);
}

function create_travel_order(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_travel_employee_id($pdo, $body, $sessionUser);
    $destination = travel_text($body['destination'] ?? '');
    $purpose = travel_text($body['purpose'] ?? '');
    $startDate = travel_date_or_null($body['startDate'] ?? null);
    $endDate = travel_date_or_null($body['endDate'] ?? null);
    $assistanceLabor = travel_text($body['assistanceLabor'] ?? $body['assistance_labor'] ?? '');
    $appropriations = travel_text($body['appropriations'] ?? '');
    $remarks = travel_text($body['remarks'] ?? '');

    $errors = [];
    if ($destination === '') {
        $errors[] = 'Destination is required.';
    }
    if ($startDate === null) {
        $errors[] = 'Start date is required.';
    }
    if ($endDate === null) {
        $errors[] = 'End date is required.';
    }
    if ($startDate !== null && $endDate !== null && $endDate < $startDate) {
        $errors[] = 'End date must not be earlier than start date.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $statement = $pdo->prepare(
        'INSERT INTO travel_orders
            (employee_id, destination, purpose, start_date, end_date, assistance_labor, appropriations, remarks, status)
         VALUES
            (:employee_id, :destination, :purpose, :start_date, :end_date, :assistance_labor, :appropriations, :remarks, "pending")'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':destination' => $destination,
        ':purpose' => $purpose !== '' ? $purpose : null,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
        ':assistance_labor' => $assistanceLabor !== '' ? $assistanceLabor : null,
        ':appropriations' => $appropriations !== '' ? $appropriations : null,
        ':remarks' => $remarks !== '' ? $remarks : null,
    ]);

    $requestId = (int)$pdo->lastInsertId();
    $employeeScopeId = travel_can_view_all($sessionUser) ? null : resolve_session_employee_id($pdo, $sessionUser);
    json_response([
        'success' => true,
        'request' => fetch_travel_order($pdo, $requestId, $employeeScopeId),
    ], 201);
}

function update_travel_order_status(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? $body['requestId'] ?? 0);
    $status = travel_status_to_database($body['status'] ?? '');
    $rejectedNote = travel_text($body['rejectedNote'] ?? $body['rejected_note'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Travel order is required.',
        ], 422);
    }

    if ($status === 'rejected' && $rejectedNote === '') {
        json_response([
            'success' => false,
            'message' => 'Rejected note is required.',
        ], 422);
    }

    $currentRequestStatement = $pdo->prepare(
        'SELECT employee_id, approved_by_employee_id, status
         FROM travel_orders
         WHERE travel_order_id = :id
         LIMIT 1'
    );
    $currentRequestStatement->execute([':id' => $id]);
    $currentRequest = $currentRequestStatement->fetch();

    if (!$currentRequest) {
        json_response([
            'success' => false,
            'message' => 'Travel order not found.',
        ], 404);
    }

    $sessionEmployeeId = hris_session_employee_record_id($pdo, $sessionUser);
    $currentStatus = (string)($currentRequest['status'] ?? '');
    $isOwnRequest = $sessionEmployeeId !== null && (int)($currentRequest['employee_id'] ?? 0) === $sessionEmployeeId;
    $isOwnCancellation = $isOwnRequest && $status === 'cancelled';

    if (!travel_can_manage($sessionUser) && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to update travel order status.',
        ], 403);
    }

    if ($isOwnRequest && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own travel order. Please ask another authorized user to review it.',
        ], 403);
    }

    if ($isOwnCancellation && $currentStatus !== 'pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending travel orders can be cancelled.',
        ], 422);
    }

    $nextApprovedByEmployeeId = $status === 'approved'
        ? ($sessionEmployeeId !== null && $sessionEmployeeId > 0 ? $sessionEmployeeId : null)
        : null;

    $statement = $pdo->prepare(
        'UPDATE travel_orders
         SET status = :status,
             rejected_note = :rejected_note,
             approved_by_employee_id = :approved_by_employee_id
         WHERE travel_order_id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':rejected_note' => $status === 'rejected' ? $rejectedNote : null,
        ':approved_by_employee_id' => $nextApprovedByEmployeeId,
        ':id' => $id,
    ]);

    if ($statement->rowCount() === 0) {
        $existsStatement = $pdo->prepare('SELECT COUNT(*) FROM travel_orders WHERE travel_order_id = :id');
        $existsStatement->execute([':id' => $id]);
        if ((int)$existsStatement->fetchColumn() === 0) {
            json_response([
                'success' => false,
                'message' => 'Travel order not found.',
            ], 404);
        }
    }

    $notificationWarning = null;

    if ($status === 'rejected') {
        $notificationWarning = send_travel_rejection_notification($pdo, $id);
    }

    json_response([
        'success' => true,
        'request' => fetch_travel_order($pdo, $id),
        'emailNotification' => $status === 'rejected'
            ? ($notificationWarning === null ? 'sent' : 'warning')
            : 'not_applicable',
        'message' => $status === 'rejected'
            ? ($notificationWarning ?? 'Travel order rejected and the employee was notified by email.')
            : ($status === 'cancelled' ? 'Travel order cancelled.' : 'Travel order updated.'),
    ]);
}

try {
    ensure_travel_order_rejected_note_column($pdo);
    ensure_travel_order_approved_by_employee_column($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        list_travel_orders($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_travel_order($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        update_travel_order_status($pdo, read_json_body(), $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Travel order API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process travel order request.',
    ], 500);
}
