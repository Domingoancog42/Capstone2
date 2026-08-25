<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function permissions_current_user_is_admin(array $sessionUser): bool
{
    return user_role_key($sessionUser) === 'admin';
}

function permissions_require_admin(array $sessionUser): void
{
    if (permissions_current_user_is_admin($sessionUser)) {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'Only administrators can manage permissions.',
    ], 403);
}

function permissions_role_key_by_role_id(PDO $pdo, int $roleId): ?string
{
    if ($roleId <= 0) {
        return null;
    }

    $statement = $pdo->prepare('SELECT name FROM roles WHERE id = :id LIMIT 1');
    $statement->execute([':id' => $roleId]);
    $roleName = $statement->fetchColumn();

    return $roleName === false ? null : normalize_role($roleName);
}

function permissions_role_key_by_user_id(PDO $pdo, int $userId): ?string
{
    if ($userId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT r.name
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE u.id = :id
           AND u.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $userId]);
    $roleName = $statement->fetchColumn();

    return $roleName === false ? null : normalize_role($roleName);
}

function permissions_template_from_permissions(PDO $pdo, string $roleKey, array $permissions, bool $enabled): array
{
    $roleKey = normalize_role($roleKey);
    $defaults = default_permission_templates($pdo);

    if (!isset($defaults[$roleKey])) {
        json_response([
            'success' => false,
            'message' => 'Role was not found.',
        ], 404);
    }

    $template = $defaults[$roleKey];
    $template['enabled'] = $enabled;

    foreach ($template['modules'] as $moduleKey => $modulePermission) {
        $sourceActions = isset($permissions[$moduleKey]) && is_array($permissions[$moduleKey])
            ? $permissions[$moduleKey]
            : [];
        $allowedActions = array_flip($modulePermission['actions']);
        $actions = [];

        foreach ($sourceActions as $action) {
            $actionKey = trim((string)$action);

            if ($actionKey !== '' && isset($allowedActions[$actionKey]) && !in_array($actionKey, $actions, true)) {
                $actions[] = $actionKey;
            }
        }

        $template['modules'][$moduleKey] = [
            'enabled' => $enabled && $actions !== [],
            'actions' => $actions,
        ];
    }

    return $template;
}

if ($method === 'GET') {
    $isAdmin = permissions_current_user_is_admin($sessionUser);

    if (isset($_GET['templates']) && (string)$_GET['templates'] === '1') {
        permissions_require_admin($sessionUser);

        json_response([
            'success' => true,
            'templates' => permission_templates($pdo),
        ]);
    }

    $targetUserId = isset($_GET['userId']) ? (int)$_GET['userId'] : 0;
    $targetRoleId = isset($_GET['roleId']) ? (int)$_GET['roleId'] : 0;
    $targetRoleKey = normalize_role($_GET['roleKey'] ?? ($_GET['role'] ?? ''));

    if ($targetUserId > 0) {
        if (!$isAdmin && $targetUserId !== (int)($sessionUser['id'] ?? 0)) {
            json_response([
                'success' => false,
                'message' => 'You can only view your own permissions.',
            ], 403);
        }

        $targetRoleKey = permissions_role_key_by_user_id($pdo, $targetUserId) ?? '';
    } elseif ($targetRoleId > 0) {
        permissions_require_admin($sessionUser);
        $targetRoleKey = permissions_role_key_by_role_id($pdo, $targetRoleId) ?? '';
    // The caller's own role, custom name and all -- a custom role holds a template of its
    // own, so resolving it to its base role here would answer with the wrong permissions.
    } elseif ($targetRoleKey !== '' && !$isAdmin && $targetRoleKey !== user_exact_role_key($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You can only view your own permissions.',
        ], 403);
    } elseif ($targetRoleKey === '') {
        $targetRoleKey = user_exact_role_key($sessionUser);
    }

    if ($targetRoleKey === '') {
        json_response([
            'success' => false,
            'message' => 'Role was not found.',
        ], 404);
    }

    json_response([
        'success' => true,
        'roleKey' => $targetRoleKey,
        'permissions' => permissions_for_role_key($pdo, $targetRoleKey),
    ]);
}

if ($method === 'POST' || $method === 'PUT') {
    permissions_require_admin($sessionUser);

    $body = read_json_body();

    if (isset($body['templates']) && is_array($body['templates'])) {
        $templates = store_permission_templates($pdo, $body['templates']);

        write_auth_audit($pdo, $sessionUser, 'permissions.updated', 'Permission templates were updated.', [
            'roles' => array_keys($templates),
            'source' => 'permissions_api',
        ]);

        json_response([
            'success' => true,
            'message' => 'Permission templates saved successfully.',
            'templates' => $templates,
        ]);
    }

    $roleKey = normalize_role($body['roleKey'] ?? ($body['role'] ?? ''));
    $roleId = (int)($body['roleId'] ?? 0);

    if ($roleKey === '' && $roleId > 0) {
        $roleKey = permissions_role_key_by_role_id($pdo, $roleId) ?? '';
    }

    $permissions = $body['permissions'] ?? null;

    if ($roleKey === '' || !is_array($permissions)) {
        json_response([
            'success' => false,
            'message' => 'Role and permissions are required.',
        ], 422);
    }

    $templates = permission_templates($pdo);
    $templates[$roleKey] = permissions_template_from_permissions(
        $pdo,
        $roleKey,
        $permissions,
        !array_key_exists('enabled', $body) || (bool)$body['enabled']
    );
    $templates = store_permission_templates($pdo, $templates);

    write_auth_audit($pdo, $sessionUser, 'permissions.updated', 'Permissions were updated for one role.', [
        'roleKey' => $roleKey,
        'source' => 'permissions_api',
    ]);

    json_response([
        'success' => true,
        'message' => 'Permissions saved successfully.',
        'roleKey' => $roleKey,
        'permissions' => permissions_for_role_key($pdo, $roleKey),
        'templates' => $templates,
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
