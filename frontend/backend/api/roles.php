<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function roles_require_admin(array $sessionUser): void
{
    if (hris_user_role_key($sessionUser) === 'admin') {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'Only administrators can manage roles.',
    ], 403);
}

function roles_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

/**
 * Every role in the system with the metadata the settings page needs: which ones are
 * built in (and therefore not deletable), what a custom role is based on, and how many
 * active users hold it.
 */
function roles_list(PDO $pdo): array
{
    hris_ensure_role_columns($pdo);

    $builtin = hris_builtin_permission_roles();
    $custom = hris_custom_permission_roles($pdo);
    $templates = hris_permission_templates($pdo);

    $countStatement = $pdo->query(
        'SELECT r.name AS role_name, COUNT(u.id) AS user_count
         FROM roles r
         LEFT JOIN users u
           ON u.role_id = r.id
          AND COALESCE(u.is_archived, 0) = 0
         GROUP BY r.id, r.name'
    );

    $counts = [];
    $roleIds = [];

    foreach ($countStatement->fetchAll() as $row) {
        $counts[hris_role_key_from_name((string)($row['role_name'] ?? ''))] = (int)($row['user_count'] ?? 0);
    }

    foreach ($pdo->query('SELECT id, name FROM roles')->fetchAll() as $row) {
        $roleIds[hris_role_key_from_name((string)($row['name'] ?? ''))] = (int)($row['id'] ?? 0);
    }

    $roles = [];

    foreach ($builtin as $key => $definition) {
        $roles[] = [
            'key' => $key,
            'id' => $roleIds[$key] ?? null,
            'label' => $definition['label'],
            'description' => $definition['description'],
            'baseRole' => $key,
            'isCustom' => false,
            'userCount' => $counts[$key] ?? 0,
            'moduleCount' => roles_enabled_module_count($templates[$key] ?? null),
        ];
    }

    foreach ($custom as $key => $definition) {
        $roles[] = [
            'key' => $key,
            'id' => $definition['id'],
            'label' => $definition['label'],
            'description' => $definition['description'],
            'baseRole' => $definition['baseRole'],
            'baseRoleLabel' => $builtin[$definition['baseRole']]['label'] ?? '',
            'isCustom' => true,
            'userCount' => $counts[$key] ?? 0,
            'moduleCount' => roles_enabled_module_count($templates[$key] ?? null),
        ];
    }

    return $roles;
}

function roles_enabled_module_count(?array $template): int
{
    if (!is_array($template) || ($template['enabled'] ?? true) === false) {
        return 0;
    }

    $modules = is_array($template['modules'] ?? null) ? $template['modules'] : [];

    return count(array_filter(
        $modules,
        static fn (mixed $module): bool => is_array($module) && ($module['enabled'] ?? false) === true
    ));
}

function roles_response(PDO $pdo, string $message = ''): void
{
    $payload = [
        'success' => true,
        'roles' => roles_list($pdo),
        'baseRoles' => array_values(array_map(
            static fn (string $key, array $definition): array => [
                'key' => $key,
                'label' => $definition['label'],
                'description' => $definition['description'],
            ],
            array_keys(hris_assignable_base_roles()),
            hris_assignable_base_roles()
        )),
        'templates' => hris_permission_templates($pdo),
    ];

    if ($message !== '') {
        $payload['message'] = $message;
    }

    json_response($payload);
}

/**
 * Roles a custom role may be based on. Admin is excluded: basing a custom role on it
 * would hand out the admin dashboard, and the module checklist cannot take that back.
 */
function hris_assignable_base_roles(): array
{
    $roles = hris_builtin_permission_roles();
    unset($roles['admin']);

    return $roles;
}

/**
 * Validate an incoming custom role. $currentId lets an edit keep its own name.
 */
function roles_validate(PDO $pdo, array $body, ?int $currentId = null): array
{
    $label = roles_text($body['label'] ?? ($body['name'] ?? ''));
    $baseRole = hris_role_key_from_name(roles_text($body['baseRole'] ?? ''));
    $description = roles_text($body['description'] ?? '');
    $key = hris_role_key_from_name($label);
    $errors = [];

    if ($label === '') {
        $errors[] = 'Role name is required.';
    } elseif (mb_strlen($label) > 100) {
        $errors[] = 'Role name must not exceed 100 characters.';
    } elseif ($key === '') {
        $errors[] = 'Role name must contain at least one letter.';
    } elseif (isset(hris_builtin_permission_roles()[$key])) {
        $errors[] = 'That name matches a built-in role. Choose a different name.';
    }

    if (!isset(hris_assignable_base_roles()[$baseRole])) {
        $errors[] = 'Choose which existing role this one is based on.';
    }

    if (mb_strlen($description) > 255) {
        $errors[] = 'Description must not exceed 255 characters.';
    }

    // Two role names that normalize to the same key would collide in the permission
    // templates, so compare on the key rather than the raw name.
    if ($key !== '' && $errors === []) {
        $statement = $pdo->query('SELECT id, name FROM roles');

        foreach ($statement->fetchAll() as $row) {
            if ((int)($row['id'] ?? 0) === $currentId) {
                continue;
            }

            if (hris_role_key_from_name((string)($row['name'] ?? '')) === $key) {
                $errors[] = 'A role with that name already exists.';
                break;
            }
        }
    }

    return [
        'errors' => $errors,
        'label' => $label,
        'key' => $key,
        'baseRole' => $baseRole,
        'description' => $description,
    ];
}

/**
 * Save the module checklist chosen for a role alongside the role itself.
 */
function roles_store_template(PDO $pdo, string $roleKey, mixed $permissions): void
{
    if (!is_array($permissions)) {
        return;
    }

    $templates = hris_permission_templates($pdo);
    $templates[$roleKey] = hris_normalize_single_permission_template($permissions);
    hris_store_permission_templates($pdo, $templates);
}

function roles_custom_role_by_id(PDO $pdo, int $id): ?array
{
    hris_ensure_role_columns($pdo);

    $statement = $pdo->prepare(
        'SELECT id, name, base_role, description FROM roles WHERE id = :id LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $row = $statement->fetch();

    if (!$row) {
        return null;
    }

    $key = hris_role_key_from_name((string)($row['name'] ?? ''));

    if (isset(hris_builtin_permission_roles()[$key]) || roles_text($row['base_role'] ?? '') === '') {
        json_response([
            'success' => false,
            'message' => 'Built-in roles cannot be edited or removed.',
        ], 422);
    }

    return $row;
}

if ($method === 'GET') {
    roles_require_admin($sessionUser);
    roles_response($pdo);
}

$body = read_json_body();

if ($method === 'POST') {
    roles_require_admin($sessionUser);

    $validated = roles_validate($pdo, $body);

    if ($validated['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => $validated['errors'][0],
            'errors' => $validated['errors'],
        ], 422);
    }

    hris_ensure_role_columns($pdo);

    try {
        $statement = $pdo->prepare(
            'INSERT INTO roles (name, base_role, description) VALUES (:name, :base_role, :description)'
        );
        $statement->execute([
            ':name' => $validated['label'],
            ':base_role' => $validated['baseRole'],
            ':description' => $validated['description'] !== '' ? $validated['description'] : null,
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'A role with that name already exists.',
            ], 409);
        }

        throw $exception;
    }

    roles_store_template($pdo, $validated['key'], $body['permissions'] ?? null);

    write_auth_audit($pdo, $sessionUser, 'roles.created', 'A custom role was created.', [
        'role' => $validated['label'],
        'baseRole' => $validated['baseRole'],
    ]);

    roles_response($pdo, 'Role created successfully.');
}

if ($method === 'PUT') {
    roles_require_admin($sessionUser);

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Role is required.',
        ], 422);
    }

    $existing = roles_custom_role_by_id($pdo, $id);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Role was not found.',
        ], 404);
    }

    $validated = roles_validate($pdo, $body, $id);

    if ($validated['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => $validated['errors'][0],
            'errors' => $validated['errors'],
        ], 422);
    }

    $previousKey = hris_role_key_from_name((string)($existing['name'] ?? ''));

    try {
        $statement = $pdo->prepare(
            'UPDATE roles
             SET name = :name, base_role = :base_role, description = :description
             WHERE id = :id'
        );
        $statement->execute([
            ':name' => $validated['label'],
            ':base_role' => $validated['baseRole'],
            ':description' => $validated['description'] !== '' ? $validated['description'] : null,
            ':id' => $id,
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'A role with that name already exists.',
            ], 409);
        }

        throw $exception;
    }

    // A rename changes the key the permission template is filed under, so carry the
    // template across or it would silently fall back to the base role's access.
    if ($previousKey !== $validated['key']) {
        $templates = hris_permission_templates($pdo);

        if (isset($templates[$previousKey])) {
            $templates[$validated['key']] = $templates[$previousKey];
            unset($templates[$previousKey]);
            hris_store_permission_templates($pdo, $templates);
        }
    }

    roles_store_template($pdo, $validated['key'], $body['permissions'] ?? null);

    write_auth_audit($pdo, $sessionUser, 'roles.updated', 'A custom role was updated.', [
        'role' => $validated['label'],
        'baseRole' => $validated['baseRole'],
    ]);

    roles_response($pdo, 'Role updated successfully.');
}

if ($method === 'DELETE') {
    roles_require_admin($sessionUser);

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Role is required.',
        ], 422);
    }

    $existing = roles_custom_role_by_id($pdo, $id);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Role was not found.',
        ], 404);
    }

    // Deleting a role that still has holders would leave those accounts pointing at a
    // missing role and unable to sign in.
    $countStatement = $pdo->prepare(
        'SELECT COUNT(*) FROM users WHERE role_id = :id AND COALESCE(is_archived, 0) = 0'
    );
    $countStatement->execute([':id' => $id]);
    $userCount = (int)$countStatement->fetchColumn();

    if ($userCount > 0) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'This role is assigned to %d %s. Move them to another role first.',
                $userCount,
                $userCount === 1 ? 'user' : 'users'
            ),
        ], 409);
    }

    $roleKey = hris_role_key_from_name((string)($existing['name'] ?? ''));

    $statement = $pdo->prepare('DELETE FROM roles WHERE id = :id');
    $statement->execute([':id' => $id]);

    $templates = hris_permission_templates($pdo);
    unset($templates[$roleKey]);
    hris_store_permission_templates($pdo, $templates);

    write_auth_audit($pdo, $sessionUser, 'roles.deleted', 'A custom role was removed.', [
        'role' => (string)($existing['name'] ?? ''),
    ]);

    roles_response($pdo, 'Role deleted successfully.');
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
