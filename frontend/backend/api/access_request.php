<?php
declare(strict_types=1);

/**
 * Module access requests.
 *
 * When somebody lands on Access Denied they can ask for the module instead of just backing out.
 * The request goes to every admin as a notification; an admin granting it writes a per-user
 * permission override and notifies the requester back. The change feed then pushes the new
 * permissions into the requester's open session, so the page they were blocked on unblocks itself.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

function access_request_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function access_request_is_admin(array $sessionUser): bool
{
    return hris_user_role_key($sessionUser) === 'admin';
}

function ensure_access_request_tables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS module_access_requests (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            module_key VARCHAR(80) NOT NULL,
            module_label VARCHAR(120) NOT NULL,
            status ENUM('pending', 'granted') NOT NULL DEFAULT 'pending',
            decided_by_user_id INT UNSIGNED NULL,
            decided_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_access_requests_user (user_id),
            KEY idx_access_requests_status (status),
            CONSTRAINT fk_access_requests_user FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    hris_ensure_notifications_table($pdo);

    /*
     * Provisioned here, outside any transaction, for the same reason loan_request.php does it: MySQL
     * implicitly commits when it sees DDL, so letting write_auth_audit() create this table lazily
     * from inside a transaction would end that transaction early.
     */
    hris_ensure_audit_logs_table($pdo);
}

/** The permission resource this request is for, or null when it is not a real module. */
function access_request_module(string $moduleKey): ?array
{
    foreach (hris_permission_items() as $item) {
        if ($item['key'] === $moduleKey) {
            return $item;
        }
    }

    return null;
}

function access_request_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT r.id, r.user_id, r.module_key, r.module_label, r.status, r.created_at, r.decided_at,
                u.username, u.email,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS requester_name,
                role.name AS role_name
         FROM module_access_requests r
         INNER JOIN users u ON u.id = r.user_id
         LEFT JOIN roles role ON role.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE r.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $row = $statement->fetch();

    return $row === false ? null : $row;
}

function access_request_format(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'userId' => (int)$row['user_id'],
        'moduleKey' => (string)$row['module_key'],
        'moduleLabel' => (string)$row['module_label'],
        'status' => (string)$row['status'],
        'requesterName' => access_request_text($row['requester_name'] ?? ''),
        'requesterRole' => access_request_text($row['role_name'] ?? ''),
        'createdAt' => (string)($row['created_at'] ?? ''),
        'decidedAt' => (string)($row['decided_at'] ?? ''),
    ];
}

/** Whether the user can already reach the module, so a pointless request is refused up front. */
function access_request_already_allowed(PDO $pdo, int $userId, string $roleKey, string $moduleKey): bool
{
    if ($roleKey === 'admin') {
        return true;
    }

    $permissions = hris_permissions_for_user($pdo, $userId, $roleKey);
    $actions = $permissions[$moduleKey] ?? [];

    return is_array($actions) && $actions !== [];
}

function access_request_create(PDO $pdo, array $sessionUser, array $body): void
{
    $userId = (int)($sessionUser['id'] ?? 0);
    $roleKey = hris_user_role_key($sessionUser);
    $moduleKey = access_request_text($body['moduleKey'] ?? '');
    $module = access_request_module($moduleKey);

    if ($module === null) {
        json_response([
            'success' => false,
            'message' => 'That module does not exist.',
        ], 422);
    }

    if (access_request_already_allowed($pdo, $userId, $roleKey, $moduleKey)) {
        json_response([
            'success' => false,
            'message' => 'You already have access to this module.',
        ], 422);
    }

    $moduleLabel = access_request_text($body['moduleLabel'] ?? '') ?: $moduleKey;

    // One open request per module: spamming the button must not bury admins in duplicates.
    $existing = $pdo->prepare(
        'SELECT id FROM module_access_requests
         WHERE user_id = :user_id AND module_key = :module_key AND status = "pending"
         LIMIT 1'
    );
    $existing->execute([':user_id' => $userId, ':module_key' => $moduleKey]);
    $existingId = $existing->fetchColumn();

    if ($existingId !== false) {
        json_response([
            'success' => true,
            'alreadyRequested' => true,
            'message' => 'Your request is already waiting for an administrator.',
            'request' => access_request_format(access_request_row($pdo, (int)$existingId) ?? []),
        ]);
    }

    $insert = $pdo->prepare(
        'INSERT INTO module_access_requests (user_id, module_key, module_label)
         VALUES (:user_id, :module_key, :module_label)'
    );
    $insert->execute([
        ':user_id' => $userId,
        ':module_key' => $moduleKey,
        ':module_label' => $moduleLabel,
    ]);

    $requestId = (int)$pdo->lastInsertId();
    $row = access_request_row($pdo, $requestId);
    $requesterName = access_request_text($row['requester_name'] ?? ($sessionUser['username'] ?? 'A user'));
    $requesterRole = access_request_text($row['role_name'] ?? '');

    hris_notify_roles(
        $pdo,
        ['admin'],
        'Module access requested',
        sprintf(
            '%s%s is requesting access to %s.',
            $requesterName,
            $requesterRole !== '' ? ' (' . $requesterRole . ')' : '',
            $moduleLabel
        ),
        'access_request',
        (string)$requestId
    );

    write_auth_audit($pdo, $sessionUser, 'access_request.created', 'A module access request was submitted.', [
        'module' => 'permissions',
        'requestId' => $requestId,
        'moduleKey' => $moduleKey,
    ]);

    json_response([
        'success' => true,
        'message' => 'Your request has been sent to the administrator.',
        'request' => access_request_format($row ?? []),
    ], 201);
}

/**
 * Turns the module on for one person without touching their role. The override starts from whatever
 * they can already do — their existing override, or their role's template — so granting one module
 * never silently removes the rest.
 */
function access_request_apply_permission(PDO $pdo, int $userId, string $roleKey, array $module): void
{
    $overrides = hris_user_permission_overrides($pdo);

    if (isset($overrides[$userId])) {
        $template = $overrides[$userId];
    } else {
        $roleTemplates = hris_permission_templates($pdo);
        $template = $roleTemplates[$roleKey] ?? ['enabled' => true, 'modules' => []];
    }

    $template['enabled'] = true;
    $template['modules'][$module['key']] = [
        'enabled' => true,
        'actions' => $module['defaultActions'],
    ];

    $overrides[$userId] = $template;
    hris_store_user_permission_overrides($pdo, $overrides);
}

function access_request_grant(PDO $pdo, array $sessionUser, array $body): void
{
    if (!access_request_is_admin($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only administrators can grant module access.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $row = $id > 0 ? access_request_row($pdo, $id) : null;

    if ($row === null) {
        json_response([
            'success' => false,
            'message' => 'Access request was not found.',
        ], 404);
    }

    if ($row['status'] === 'granted') {
        json_response([
            'success' => true,
            'message' => 'This request was already granted.',
            'request' => access_request_format($row),
        ]);
    }

    $module = access_request_module((string)$row['module_key']);

    if ($module === null) {
        json_response([
            'success' => false,
            'message' => 'That module no longer exists.',
        ], 422);
    }

    $requesterId = (int)$row['user_id'];
    $requesterRoleKey = hris_normalize_role((string)($row['role_name'] ?? ''));

    access_request_apply_permission($pdo, $requesterId, $requesterRoleKey, $module);

    $update = $pdo->prepare(
        'UPDATE module_access_requests
         SET status = "granted", decided_by_user_id = :admin_id, decided_at = NOW()
         WHERE id = :id'
    );
    $update->execute([':admin_id' => (int)($sessionUser['id'] ?? 0), ':id' => $id]);

    hris_notify_users(
        $pdo,
        [$requesterId],
        'Access granted',
        sprintf('You now have access to %s.', $row['module_label']),
        'access_granted',
        (string)$id
    );

    write_auth_audit($pdo, $sessionUser, 'access_request.granted', 'A module access request was granted.', [
        'module' => 'permissions',
        'requestId' => $id,
        'moduleKey' => $row['module_key'],
        'grantedToUserId' => $requesterId,
    ]);

    json_response([
        'success' => true,
        'message' => sprintf('%s can now access %s.', $row['requester_name'], $row['module_label']),
        'request' => access_request_format(access_request_row($pdo, $id) ?? $row),
    ]);
}

function access_request_list(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? 0);

    if ($id > 0) {
        $row = access_request_row($pdo, $id);

        if ($row === null) {
            json_response([
                'success' => false,
                'message' => 'Access request was not found.',
            ], 404);
        }

        // Requesters may read their own; everything else is admin-only.
        if (!access_request_is_admin($sessionUser) && (int)$row['user_id'] !== (int)($sessionUser['id'] ?? 0)) {
            json_response([
                'success' => false,
                'message' => 'You can only view your own access requests.',
            ], 403);
        }

        json_response([
            'success' => true,
            'request' => access_request_format($row),
        ]);
    }

    $isAdmin = access_request_is_admin($sessionUser);
    $conditions = $isAdmin ? [] : ['r.user_id = :user_id'];
    $params = $isAdmin ? [] : [':user_id' => (int)($sessionUser['id'] ?? 0)];
    $status = strtolower(access_request_text($_GET['status'] ?? ''));

    if (in_array($status, ['pending', 'granted'], true)) {
        $conditions[] = 'r.status = :status';
        $params[':status'] = $status;
    }

    $whereSql = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

    $statement = $pdo->prepare(
        'SELECT r.id, r.user_id, r.module_key, r.module_label, r.status, r.created_at, r.decided_at,
                u.username, u.email,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS requester_name,
                role.name AS role_name
         FROM module_access_requests r
         INNER JOIN users u ON u.id = r.user_id
         LEFT JOIN roles role ON role.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0'
        . $whereSql .
        ' ORDER BY r.created_at DESC, r.id DESC
         LIMIT 100'
    );
    $statement->execute($params);

    json_response([
        'success' => true,
        'requests' => array_map('access_request_format', $statement->fetchAll()),
    ]);
}

try {
    ensure_access_request_tables($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        access_request_list($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        $body = read_json_body();
        $action = access_request_text($body['action'] ?? '');

        if ($action === 'create') {
            access_request_create($pdo, $sessionUser, $body);
        }

        if ($action === 'grant') {
            access_request_grant($pdo, $sessionUser, $body);
        }

        json_response([
            'success' => false,
            'message' => 'Unknown action.',
        ], 422);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Access request API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the access request.',
    ], 500);
}
