<?php
declare(strict_types=1);

function hris_ensure_application_settings_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (
        hris_app_settings_table_exists($pdo, 'application_settings')
        && !hris_app_settings_table_exists($pdo, 'settings')
    ) {
        $pdo->exec('RENAME TABLE application_settings TO settings');
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS settings (
            setting_key VARCHAR(100) NOT NULL,
            setting_value TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    if (hris_app_settings_table_exists($pdo, 'application_settings')) {
        $pdo->exec(
            'INSERT INTO settings (setting_key, setting_value, created_at, updated_at)
             SELECT setting_key, setting_value, created_at, updated_at
             FROM application_settings
             ON DUPLICATE KEY UPDATE
                setting_value = VALUES(setting_value),
                updated_at = VALUES(updated_at)'
        );
    }

    $ensured = true;
}

function hris_ensure_audit_logs_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    /*
     * MySQL implicitly commits an open transaction the moment it sees DDL. Provisioning from here
     * would therefore end the caller's transaction behind its back: their later commit() throws
     * "There is no active transaction", and the rows written before this point are already durable
     * and beyond rollback. Callers that audit from inside a transaction must provision before they
     * open it. Refusing is what turns forgetting that into one missing audit row — `write_auth_audit()`
     * already treats an audit failure as non-fatal — rather than a half-committed transaction.
     */
    if ($pdo->inTransaction()) {
        throw new RuntimeException(
            'audit_logs is not provisioned and cannot be created inside a transaction. '
            . 'Call hris_ensure_audit_logs_table() before beginTransaction().'
        );
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS audit_logs (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NULL,
            action VARCHAR(150) NOT NULL,
            ip_address VARCHAR(45) NULL,
            location VARCHAR(255) NULL,
            device VARCHAR(120) NULL,
            browser VARCHAR(120) NULL,
            os VARCHAR(120) NULL,
            actor_id INT UNSIGNED NULL,
            actor_name VARCHAR(255) NULL,
            actor_role VARCHAR(100) NULL,
            category VARCHAR(80) NULL,
            entity_type VARCHAR(100) NULL,
            entity_id VARCHAR(100) NULL,
            summary TEXT NULL,
            details_json LONGTEXT NULL,
            user_agent TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_audit_logs_user_id (user_id),
            KEY idx_audit_logs_action (action),
            KEY idx_audit_logs_category (category),
            KEY idx_audit_logs_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $columns = [
        'user_id' => 'INT UNSIGNED NULL AFTER id',
        'action' => 'VARCHAR(150) NOT NULL DEFAULT "" AFTER user_id',
        'ip_address' => 'VARCHAR(45) NULL AFTER action',
        'location' => 'VARCHAR(255) NULL AFTER ip_address',
        'device' => 'VARCHAR(120) NULL AFTER location',
        'browser' => 'VARCHAR(120) NULL AFTER device',
        'os' => 'VARCHAR(120) NULL AFTER browser',
        'actor_id' => 'INT UNSIGNED NULL AFTER os',
        'actor_name' => 'VARCHAR(255) NULL AFTER actor_id',
        'actor_role' => 'VARCHAR(100) NULL AFTER actor_name',
        'category' => 'VARCHAR(80) NULL AFTER actor_role',
        'entity_type' => 'VARCHAR(100) NULL AFTER category',
        'entity_id' => 'VARCHAR(100) NULL AFTER entity_type',
        'summary' => 'TEXT NULL AFTER entity_id',
        'details_json' => 'LONGTEXT NULL AFTER summary',
        'user_agent' => 'TEXT NULL AFTER details_json',
        'created_at' => 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER user_agent',
    ];

    foreach ($columns as $column => $definition) {
        if (!hris_database_column_exists($pdo, 'audit_logs', $column)) {
            $pdo->exec("ALTER TABLE audit_logs ADD COLUMN {$column} {$definition}");
        }
    }

    $ensured = true;
}

function hris_get_application_setting(PDO $pdo, string $key, string $default = ''): string
{
    hris_ensure_application_settings_table($pdo);

    $statement = $pdo->prepare(
        'SELECT setting_value
         FROM settings
         WHERE setting_key = :setting_key
         LIMIT 1'
    );
    $statement->execute([
        ':setting_key' => $key,
    ]);

    $value = $statement->fetchColumn();

    return $value === false ? $default : (string)$value;
}

function hris_get_boolean_application_setting(PDO $pdo, string $key, bool $default = false): bool
{
    $value = strtolower(trim(hris_get_application_setting($pdo, $key, $default ? '1' : '0')));

    return in_array($value, ['1', 'true', 'yes', 'on'], true);
}

function hris_get_integer_application_setting(PDO $pdo, string $key, int $default, int $minimum, int $maximum): int
{
    $value = hris_get_application_setting($pdo, $key, (string)$default);
    $number = filter_var($value, FILTER_VALIDATE_INT);

    if ($number === false) {
        return $default;
    }

    return max($minimum, min($maximum, (int)$number));
}

function hris_store_boolean_application_setting(PDO $pdo, string $key, mixed $value): void
{
    hris_ensure_application_settings_table($pdo);

    $normalized = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    $settingValue = $normalized === null ? '0' : ($normalized ? '1' : '0');

    $statement = $pdo->prepare(
        'INSERT INTO settings (setting_key, setting_value)
         VALUES (:setting_key, :setting_value)
         ON DUPLICATE KEY UPDATE
            setting_value = VALUES(setting_value),
            updated_at = CURRENT_TIMESTAMP'
    );
    $statement->execute([
        ':setting_key' => $key,
        ':setting_value' => $settingValue,
    ]);
}

function hris_store_application_setting(PDO $pdo, string $key, string $value): void
{
    hris_ensure_application_settings_table($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO settings (setting_key, setting_value)
         VALUES (:setting_key, :setting_value)
         ON DUPLICATE KEY UPDATE
            setting_value = VALUES(setting_value),
            updated_at = CURRENT_TIMESTAMP'
    );
    $statement->execute([
        ':setting_key' => $key,
        ':setting_value' => $value,
    ]);
}

/**
 * The roles that ship with the system. Each one owns a dashboard component and a
 * route prefix on the client, which is why the list is fixed: a role here cannot be
 * renamed or deleted without breaking routing.
 */
function hris_builtin_permission_roles(): array
{
    return [
        'admin' => [
            'label' => 'Admin',
            'description' => 'Full access across the system.',
        ],
        'hrhead' => [
            'label' => 'HR Head',
            'description' => 'Oversees HR operations and approvals.',
        ],
        'hrstaff' => [
            'label' => 'HR Staff',
            'description' => 'Handles employee records, leave, and reports.',
        ],
        'chief' => [
            'label' => 'Chief',
            'description' => 'Manages division-level requests and team visibility.',
        ],
        'regionaldirector' => [
            'label' => 'Regional Director',
            'description' => 'Approves regional actions and reviews analytics.',
        ],
        'employee' => [
            'label' => 'Employee',
            'description' => 'Uses self-service requests, records, and profile tools.',
        ],
    ];
}

/**
 * Turn a role name into the key used everywhere else ("HR Head" -> "hrhead").
 * Mirrors normalizeRole() on the client.
 */
function hris_role_key_from_name(string $name): string
{
    return strtolower((string)preg_replace('/[^a-z]/i', '', $name));
}

/**
 * Custom roles add `base_role` and `description` to the roles table. Built-in roles
 * leave base_role NULL, which is what distinguishes the two.
 */
function hris_ensure_role_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (!hris_database_column_exists($pdo, 'roles', 'base_role')) {
        $pdo->exec('ALTER TABLE roles ADD COLUMN base_role VARCHAR(40) NULL DEFAULT NULL AFTER name');
    }

    if (!hris_database_column_exists($pdo, 'roles', 'description')) {
        $pdo->exec('ALTER TABLE roles ADD COLUMN description VARCHAR(255) NULL DEFAULT NULL AFTER base_role');
    }

    $ensured = true;
}

/**
 * Admin-created roles, keyed like the built-ins. `baseRole` names the built-in role
 * whose dashboard and routes the custom role reuses — without one there would be no
 * page for its users to land on.
 */
function hris_custom_permission_roles(PDO $pdo): array
{
    try {
        hris_ensure_role_columns($pdo);

        $statement = $pdo->query(
            'SELECT id, name, base_role, description
             FROM roles
             WHERE base_role IS NOT NULL AND base_role <> ""
             ORDER BY name'
        );
    } catch (Throwable $exception) {
        error_log('Custom role lookup failed: ' . $exception->getMessage());
        return [];
    }

    $builtin = hris_builtin_permission_roles();
    $roles = [];

    foreach ($statement->fetchAll() as $row) {
        $key = hris_role_key_from_name((string)($row['name'] ?? ''));
        $baseRole = hris_role_key_from_name((string)($row['base_role'] ?? ''));

        // A custom role that collides with a built-in key, or points at a base that no
        // longer exists, would resolve to an unroutable dashboard. Skip it.
        if ($key === '' || isset($builtin[$key]) || !isset($builtin[$baseRole]) || $baseRole === 'admin') {
            continue;
        }

        $roles[$key] = [
            'id' => (int)($row['id'] ?? 0),
            'label' => (string)($row['name'] ?? ''),
            'description' => (string)($row['description'] ?? ''),
            'baseRole' => $baseRole,
            'isCustom' => true,
        ];
    }

    return $roles;
}

/**
 * Every role that can hold a permission template: the built-ins plus any custom roles.
 * Passing $pdo is what makes custom roles visible; callers that only need the fixed
 * set may omit it.
 */
function hris_permission_roles(?PDO $pdo = null): array
{
    $roles = hris_builtin_permission_roles();

    if (!$pdo instanceof PDO) {
        return $roles;
    }

    return $roles + hris_custom_permission_roles($pdo);
}

/**
 * The built-in role whose dashboard and routes a role uses. Built-ins map to
 * themselves; a custom role maps to whatever it was based on.
 */
function hris_role_base_key(PDO $pdo, string $roleKey): string
{
    $normalized = hris_normalize_role($roleKey);
    $builtin = hris_builtin_permission_roles();

    if (isset($builtin[$normalized])) {
        return $normalized;
    }

    return hris_custom_permission_roles($pdo)[$normalized]['baseRole'] ?? '';
}

function hris_permission_items(): array
{
    return [
        [
            'key' => 'dashboard',
            'defaultActions' => ['view'],
        ],
        [
            'key' => 'profile',
            'defaultActions' => ['view', 'edit'],
        ],
        [
            'key' => 'serviceRecord',
            'defaultActions' => ['view', 'edit'],
        ],
        [
            'key' => 'users',
            'defaultActions' => ['view', 'create', 'edit', 'delete'],
        ],
        [
            'key' => 'permissions',
            'defaultActions' => ['view', 'edit'],
        ],
        [
            'key' => 'settings',
            'defaultActions' => ['view', 'edit'],
        ],
        [
            'key' => 'auditLogs',
            'defaultActions' => ['view'],
        ],
        [
            'key' => 'calendar',
            'defaultActions' => ['view'],
        ],
        [
            'key' => 'employees',
            'defaultActions' => ['view', 'create', 'edit', 'delete'],
        ],
        [
            // Awards used to be gated by the `employees` resource, which conflated "may edit
            // employee records" with "may issue a certificate in the Regional Director's name".
            'key' => 'rewardsRecognition',
            'defaultActions' => ['view', 'create', 'edit'],
        ],
        [
            'key' => 'attendance',
            'defaultActions' => ['view', 'create', 'edit', 'approve', 'reject', 'export'],
        ],
        [
            'key' => 'leave',
            'defaultActions' => ['view', 'create', 'edit', 'approve', 'reject', 'export'],
        ],
        [
            'key' => 'leaveBalance',
            'defaultActions' => ['view', 'edit'],
        ],
        [
            'key' => 'payroll',
            'defaultActions' => ['view', 'create', 'edit', 'export'],
        ],
        [
            'key' => 'reports',
            'defaultActions' => ['view', 'export'],
        ],
        [
            'key' => 'payslip',
            'defaultActions' => ['view'],
        ],
    ];
}

function hris_default_role_permission_access(): array
{
    return [
        'admin' => 'all',
        'hrhead' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'users',
            'permissions',
            'auditLogs',
            'calendar',
            'employees',
            'rewardsRecognition',
            'attendance',
            'leave',
            'leaveBalance',
            'payroll',
            'reports',
        ],
        'hrstaff' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'calendar',
            'employees',
            'rewardsRecognition',
            'attendance',
            'leave',
            'leaveBalance',
            'reports',
        ],
        'chief' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'calendar',
            'attendance',
            'leave',
            'reports',
        ],
        'regionaldirector' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'calendar',
            'leave',
            'reports',
            'rewardsRecognition',
            'auditLogs',
        ],
        'employee' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'calendar',
            'attendance',
            'leave',
            'payslip',
        ],
    ];
}

function hris_default_permission_templates(?PDO $pdo = null): array
{
    $accessByRole = hris_default_role_permission_access();
    $templates = [];

    foreach (hris_permission_roles($pdo) as $roleKey => $role) {
        // A custom role starts life with its base role's access; the admin narrows it
        // from there with the module checklist.
        $access = $accessByRole[$roleKey] ?? ($accessByRole[$role['baseRole'] ?? ''] ?? []);
        $modules = [];

        foreach (hris_permission_items() as $item) {
            $moduleKey = $item['key'];
            $enabled = $access === 'all' || in_array($moduleKey, $access, true);

            $modules[$moduleKey] = [
                'enabled' => $enabled,
                'actions' => $enabled ? $item['defaultActions'] : [],
            ];
        }

        $templates[$roleKey] = [
            'enabled' => true,
            'modules' => $modules,
        ];
    }

    return $templates;
}

function hris_normalize_permission_templates(array $templates, ?PDO $pdo = null): array
{
    $defaults = hris_default_permission_templates($pdo);
    $items = hris_permission_items();
    $normalized = [];

    foreach (hris_permission_roles($pdo) as $roleKey => $role) {
        $sourceRole = isset($templates[$roleKey]) && is_array($templates[$roleKey])
            ? $templates[$roleKey]
            : [];

        // A custom role with nothing stored yet inherits its base role's *current*
        // access, which is what the Roles page shows when seeding the checklist.
        // Reading from $templates keeps this out of the stored-template lookup that
        // calls this function, so there is no recursion.
        if ($sourceRole === [] && ($role['baseRole'] ?? '') !== '') {
            $baseSource = $templates[$role['baseRole']] ?? null;

            if (is_array($baseSource)) {
                $sourceRole = $baseSource;
            }
        }

        $sourceModules = isset($sourceRole['modules']) && is_array($sourceRole['modules'])
            ? $sourceRole['modules']
            : [];
        $modules = [];

        foreach ($items as $item) {
            $moduleKey = $item['key'];
            $defaultModule = $defaults[$roleKey]['modules'][$moduleKey];
            $sourceModule = isset($sourceModules[$moduleKey]) && is_array($sourceModules[$moduleKey])
                ? $sourceModules[$moduleKey]
                : [];
            $sourceActions = isset($sourceModule['actions']) && is_array($sourceModule['actions'])
                ? $sourceModule['actions']
                : $defaultModule['actions'];
            $allowedActions = array_flip($item['defaultActions']);
            $actions = [];

            foreach ($sourceActions as $action) {
                $actionKey = trim((string)$action);

                if ($actionKey !== '' && isset($allowedActions[$actionKey]) && !in_array($actionKey, $actions, true)) {
                    $actions[] = $actionKey;
                }
            }

            $modules[$moduleKey] = [
                'enabled' => array_key_exists('enabled', $sourceModule)
                    ? (bool)$sourceModule['enabled']
                    : (bool)$defaultModule['enabled'],
                'actions' => $actions,
            ];
        }

        $normalized[$roleKey] = [
            'enabled' => array_key_exists('enabled', $sourceRole)
                ? (bool)$sourceRole['enabled']
                : true,
            'modules' => $modules,
        ];
    }

    return $normalized;
}

function hris_permission_templates(PDO $pdo): array
{
    $rawPermissions = hris_get_application_setting($pdo, 'role_permissions', '{}');
    $permissions = json_decode($rawPermissions, true);

    if (!is_array($permissions) || $permissions === []) {
        return hris_default_permission_templates($pdo);
    }

    return hris_normalize_permission_templates($permissions, $pdo);
}

function hris_store_permission_templates(PDO $pdo, array $templates): array
{
    $normalized = hris_normalize_permission_templates($templates, $pdo);
    $encodedPermissions = json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encodedPermissions === false) {
        throw new RuntimeException('Unable to encode permission templates.');
    }

    hris_store_application_setting($pdo, 'role_permissions', $encodedPermissions);

    return $normalized;
}

function hris_permissions_for_role_key(PDO $pdo, string $roleKey): array
{
    $normalizedRoleKey = hris_normalize_role($roleKey);
    $templates = hris_permission_templates($pdo);
    $template = $templates[$normalizedRoleKey] ?? null;

    if (!is_array($template) || ($template['enabled'] ?? true) === false) {
        return [];
    }

    $permissions = [];
    $modules = isset($template['modules']) && is_array($template['modules'])
        ? $template['modules']
        : [];

    foreach ($modules as $moduleKey => $modulePermission) {
        if (!is_array($modulePermission) || ($modulePermission['enabled'] ?? false) !== true) {
            continue;
        }

        $actions = isset($modulePermission['actions']) && is_array($modulePermission['actions'])
            ? array_values(array_unique(array_filter(array_map('strval', $modulePermission['actions']))))
            : [];

        if ($actions !== []) {
            $permissions[$moduleKey] = $actions;
        }
    }

    return $permissions;
}

/**
 * Normalize a single permission template (enabled flag + per-module actions)
 * against the known permission items so stored data can never grant unknown
 * modules or actions.
 */
function hris_normalize_single_permission_template(array $template): array
{
    $items = hris_permission_items();
    $sourceModules = isset($template['modules']) && is_array($template['modules'])
        ? $template['modules']
        : [];
    $modules = [];

    foreach ($items as $item) {
        $moduleKey = $item['key'];
        $sourceModule = isset($sourceModules[$moduleKey]) && is_array($sourceModules[$moduleKey])
            ? $sourceModules[$moduleKey]
            : [];
        $sourceActions = isset($sourceModule['actions']) && is_array($sourceModule['actions'])
            ? $sourceModule['actions']
            : [];
        $allowedActions = array_flip($item['defaultActions']);
        $actions = [];

        foreach ($sourceActions as $action) {
            $actionKey = trim((string)$action);

            if ($actionKey !== '' && isset($allowedActions[$actionKey]) && !in_array($actionKey, $actions, true)) {
                $actions[] = $actionKey;
            }
        }

        $modules[$moduleKey] = [
            'enabled' => array_key_exists('enabled', $sourceModule)
                ? (bool)$sourceModule['enabled']
                : false,
            'actions' => $actions,
        ];
    }

    return [
        'enabled' => array_key_exists('enabled', $template) ? (bool)$template['enabled'] : true,
        'modules' => $modules,
    ];
}

/**
 * All stored per-user permission overrides, keyed by numeric user id.
 * A user id present here means that user's access is fully defined by the
 * override and no longer inherits the role template.
 */
function hris_user_permission_overrides(PDO $pdo): array
{
    $raw = hris_get_application_setting($pdo, 'user_permissions', '{}');
    $decoded = json_decode($raw, true);

    if (!is_array($decoded)) {
        return [];
    }

    $overrides = [];

    foreach ($decoded as $userId => $template) {
        $id = (int)$userId;

        if ($id <= 0 || !is_array($template)) {
            continue;
        }

        $overrides[$id] = hris_normalize_single_permission_template($template);
    }

    return $overrides;
}

function hris_store_user_permission_overrides(PDO $pdo, array $overrides): array
{
    $normalized = [];

    foreach ($overrides as $userId => $template) {
        $id = (int)$userId;

        if ($id <= 0 || !is_array($template)) {
            continue;
        }

        $normalized[$id] = hris_normalize_single_permission_template($template);
    }

    $encoded = json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encoded === false) {
        throw new RuntimeException('Unable to encode user permission overrides.');
    }

    hris_store_application_setting($pdo, 'user_permissions', $encoded);

    return $normalized;
}

/**
 * Canonical form of a template for equality checks: module order comes from
 * hris_permission_items() and actions are sorted, so two templates that grant the
 * same access always compare equal regardless of how the client ordered them.
 */
function hris_permission_template_signature(array $template): array
{
    $normalized = hris_normalize_single_permission_template($template);

    foreach ($normalized['modules'] as $moduleKey => $modulePermission) {
        $actions = $modulePermission['actions'];
        sort($actions);
        $normalized['modules'][$moduleKey]['actions'] = $actions;
    }

    return $normalized;
}

/**
 * Store a per-user permission override, or clear it when the requested access is
 * identical to the role template. Leaving "same as role" users override-free is what
 * keeps later edits to a role template reaching them.
 *
 * Returns true when the user ended up with an override of their own.
 */
function hris_sync_user_permission_override(PDO $pdo, int $userId, mixed $template, string $roleKey): bool
{
    if ($userId <= 0 || !is_array($template)) {
        return false;
    }

    $roleTemplate = hris_permission_templates($pdo)[hris_normalize_role($roleKey)] ?? null;
    $matchesRole = is_array($roleTemplate)
        && hris_permission_template_signature($template) === hris_permission_template_signature($roleTemplate);

    $overrides = hris_user_permission_overrides($pdo);

    if ($matchesRole) {
        unset($overrides[$userId]);
    } else {
        $overrides[$userId] = $template;
    }

    hris_store_user_permission_overrides($pdo, $overrides);

    return !$matchesRole;
}

/**
 * Flatten a normalized template ({enabled, modules}) into the compact
 * "module => [actions]" shape the app uses for access checks.
 */
function hris_flatten_permission_template(array $template): array
{
    if (($template['enabled'] ?? true) === false) {
        return [];
    }

    $permissions = [];
    $modules = isset($template['modules']) && is_array($template['modules'])
        ? $template['modules']
        : [];

    foreach ($modules as $moduleKey => $modulePermission) {
        if (!is_array($modulePermission) || ($modulePermission['enabled'] ?? false) !== true) {
            continue;
        }

        $actions = isset($modulePermission['actions']) && is_array($modulePermission['actions'])
            ? array_values(array_unique(array_filter(array_map('strval', $modulePermission['actions']))))
            : [];

        if ($actions !== []) {
            $permissions[$moduleKey] = $actions;
        }
    }

    return $permissions;
}

/**
 * Resolve the effective permissions for a single user. A stored per-user
 * override fully replaces the role template; otherwise the role template
 * applies.
 */
function hris_permissions_for_user(PDO $pdo, int $userId, string $roleKey): array
{
    if ($userId > 0) {
        $overrides = hris_user_permission_overrides($pdo);

        if (isset($overrides[$userId])) {
            return hris_flatten_permission_template($overrides[$userId]);
        }
    }

    return hris_permissions_for_role_key($pdo, $roleKey);
}

function hris_store_integer_application_setting(PDO $pdo, string $key, int $value): void
{
    hris_store_application_setting($pdo, $key, (string)$value);
}

function hris_latest_settings_updated_at(PDO $pdo, array $keys): ?string
{
    hris_ensure_application_settings_table($pdo);

    $keys = array_values(array_filter(array_unique($keys), static fn (mixed $key): bool => is_string($key) && $key !== ''));

    if ($keys === []) {
        return null;
    }

    $placeholders = implode(', ', array_fill(0, count($keys), '?'));
    $statement = $pdo->prepare("SELECT MAX(updated_at) FROM settings WHERE setting_key IN ({$placeholders})");
    $statement->execute($keys);

    $value = $statement->fetchColumn();

    return is_string($value) && trim($value) !== '' ? $value : null;
}

function hris_security_setting_definitions(): array
{
    return [
        'maximumPasswordLength' => [
            'key' => 'security_maximum_password_length',
            'default' => 64,
            'min' => 6,
            'max' => 256,
            'label' => 'Maximum password length',
        ],
        'passwordExpiryDays' => [
            'key' => 'security_password_expiry_days',
            'default' => 60,
            'min' => 0,
            'max' => 3650,
            'label' => 'Password expiry days',
        ],
        'sessionTimeoutMinutes' => [
            'key' => 'security_session_timeout_minutes',
            'default' => 30,
            'min' => 1,
            'max' => 1440,
            'label' => 'Session timeout minutes',
        ],
        'lockoutFailedAttempts' => [
            'key' => 'security_lockout_failed_attempts',
            'default' => 5,
            'min' => 1,
            'max' => 20,
            'label' => 'Lockout failed attempts',
        ],
        'lockoutDurationMinutes' => [
            'key' => 'security_lockout_duration_minutes',
            'default' => 15,
            'min' => 1,
            'max' => 1440,
            'label' => 'Lockout duration minutes',
        ],
    ];
}

function hris_security_settings(PDO $pdo): array
{
    $settings = [];

    foreach (hris_security_setting_definitions() as $name => $definition) {
        $settings[$name] = hris_get_integer_application_setting(
            $pdo,
            $definition['key'],
            $definition['default'],
            $definition['min'],
            $definition['max']
        );
    }

    return $settings;
}

function hris_normalize_security_settings_payload(array $body): array
{
    $settings = [];
    $errors = [];

    foreach (hris_security_setting_definitions() as $name => $definition) {
        $rawValue = $body[$name] ?? $definition['default'];
        $number = filter_var($rawValue, FILTER_VALIDATE_INT);

        if ($number === false) {
            $errors[] = $definition['label'] . ' must be a whole number.';
            continue;
        }

        $number = (int)$number;

        if ($number < $definition['min'] || $number > $definition['max']) {
            $errors[] = sprintf(
                '%s must be between %d and %d.',
                $definition['label'],
                $definition['min'],
                $definition['max']
            );
            continue;
        }

        $settings[$name] = $number;
    }

    return [
        'settings' => $settings,
        'errors' => $errors,
    ];
}

function hris_store_security_settings(PDO $pdo, array $settings): void
{
    $definitions = hris_security_setting_definitions();

    foreach ($settings as $name => $value) {
        if (!isset($definitions[$name])) {
            continue;
        }

        hris_store_integer_application_setting($pdo, $definitions[$name]['key'], (int)$value);
    }
}

function hris_two_factor_default_settings(): array
{
    return [
        'enabled' => false,
        'requireAdmins' => false,
        'requireHr' => false,
        'requireManagers' => false,
        'requireAllUsers' => false,
        'otpExpiryMinutes' => 5,
        'maxAttempts' => 3,
        'resendDelaySeconds' => 0,
        'updatedAt' => null,
    ];
}

function hris_two_factor_setting_definitions(): array
{
    $defaults = hris_two_factor_default_settings();

    return [
        'enabled' => [
            'key' => 'two_factor_enabled',
            'default' => $defaults['enabled'],
            'type' => 'bool',
        ],
        'requireAdmins' => [
            'key' => 'two_factor_require_admins',
            'default' => $defaults['requireAdmins'],
            'type' => 'bool',
        ],
        'requireHr' => [
            'key' => 'two_factor_require_hr',
            'default' => $defaults['requireHr'],
            'type' => 'bool',
        ],
        'requireManagers' => [
            'key' => 'two_factor_require_managers',
            'default' => $defaults['requireManagers'],
            'type' => 'bool',
        ],
        'requireAllUsers' => [
            'key' => 'two_factor_require_all_users',
            'default' => $defaults['requireAllUsers'],
            'type' => 'bool',
        ],
        'otpExpiryMinutes' => [
            'key' => 'two_factor_otp_expiry_minutes',
            'default' => $defaults['otpExpiryMinutes'],
            'min' => 5,
            'max' => 15,
            'type' => 'int',
        ],
        'maxAttempts' => [
            'key' => 'two_factor_max_attempts',
            'default' => $defaults['maxAttempts'],
            'min' => 3,
            'max' => 10,
            'type' => 'int',
        ],
        'resendDelaySeconds' => [
            'key' => 'two_factor_resend_delay_seconds',
            'default' => $defaults['resendDelaySeconds'],
            // 0 is allowed so an administrator can let users request a new code immediately.
            'min' => 0,
            'max' => 60,
            'type' => 'int',
        ],
    ];
}

function hris_boolean_value(mixed $value, bool $default = false): bool
{
    if ($value === null || $value === '') {
        return $default;
    }

    $normalized = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

    return $normalized === null ? $default : $normalized;
}

function hris_seed_two_factor_settings(PDO $pdo): void
{
    hris_ensure_application_settings_table($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO settings (setting_key, setting_value)
         VALUES (:setting_key, :setting_value)
         ON DUPLICATE KEY UPDATE setting_value = setting_value'
    );

    foreach (hris_two_factor_setting_definitions() as $definition) {
        $value = $definition['default'];
        $settingValue = $definition['type'] === 'bool'
            ? (!empty($value) ? '1' : '0')
            : (string)$value;

        $statement->execute([
            ':setting_key' => $definition['key'],
            ':setting_value' => $settingValue,
        ]);
    }
}

function hris_migrate_two_factor_settings_to_settings(PDO $pdo): void
{
    if (!hris_app_settings_table_exists($pdo, 'two_factor_settings')) {
        return;
    }

    $statement = $pdo->query('SELECT * FROM two_factor_settings WHERE id = 1 LIMIT 1');
    $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

    $values = [
        'enabled' => $row['enabled'] ?? null,
        'requireAdmins' => $row['require_admins'] ?? null,
        'requireHr' => $row['require_hr'] ?? null,
        'requireManagers' => $row['require_managers'] ?? null,
        'requireAllUsers' => $row['require_all_users'] ?? null,
        'otpExpiryMinutes' => $row['otp_expiry_minutes'] ?? null,
        'maxAttempts' => $row['max_attempts'] ?? null,
        'resendDelaySeconds' => $row['resend_delay'] ?? ($row['resend_delay_seconds'] ?? null),
    ];

    foreach (hris_two_factor_setting_definitions() as $name => $definition) {
        if (!array_key_exists($name, $values) || $values[$name] === null) {
            continue;
        }

        if ($definition['type'] === 'bool') {
            hris_store_boolean_application_setting($pdo, $definition['key'], $values[$name]);
        } else {
            hris_store_integer_application_setting($pdo, $definition['key'], (int)$values[$name]);
        }
    }

    $pdo->exec('DROP TABLE IF EXISTS two_factor_settings');
}

function hris_ensure_two_factor_tables(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    hris_ensure_user_security_columns($pdo);

    if (!hris_database_column_exists($pdo, 'users', 'two_factor_enabled')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0
             AFTER locked_until'
        );
    }

    $pdo->exec('UPDATE users SET two_factor_enabled = 0 WHERE two_factor_enabled IS NULL');

    hris_ensure_application_settings_table($pdo);
    hris_migrate_two_factor_settings_to_settings($pdo);
    hris_seed_two_factor_settings($pdo);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS user_two_factor_codes (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            otp_hash VARCHAR(255) NOT NULL,
            expires_at DATETIME NOT NULL,
            attempts INT UNSIGNED NOT NULL DEFAULT 0,
            verified TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_user_two_factor_codes_user_id (user_id),
            KEY idx_user_two_factor_codes_lookup (user_id, verified, expires_at),
            KEY idx_user_two_factor_codes_created_at (created_at),
            CONSTRAINT fk_user_two_factor_codes_user_id
                FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS two_factor_logs (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NULL,
            ip_address VARCHAR(45) NULL,
            action VARCHAR(80) NOT NULL,
            status VARCHAR(40) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_two_factor_logs_user_id (user_id),
            KEY idx_two_factor_logs_action (action),
            KEY idx_two_factor_logs_status (status),
            KEY idx_two_factor_logs_created_at (created_at),
            CONSTRAINT fk_two_factor_logs_user_id
                FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $ensured = true;
}

function hris_ensure_email_verification_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (!hris_database_column_exists($pdo, 'users', 'email_verified_at')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN email_verified_at DATETIME NULL DEFAULT NULL
             AFTER email'
        );
    }

    if (!hris_database_column_exists($pdo, 'users', 'email_updated_at')) {
        $afterColumn = hris_database_column_exists($pdo, 'users', 'email_verified_at')
            ? 'email_verified_at'
            : 'email';
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN email_updated_at DATETIME NULL DEFAULT NULL
             AFTER ' . $afterColumn
        );
    }

    $ensured = true;
}

function hris_ensure_email_verification_tables(PDO $pdo): void
{
    // Legacy wrapper: email verification tables are no longer auto-created at runtime.
    hris_ensure_email_verification_columns($pdo);
}

function hris_two_factor_settings(PDO $pdo): array
{
    hris_ensure_two_factor_tables($pdo);

    $defaults = hris_two_factor_default_settings();
    $definitions = hris_two_factor_setting_definitions();

    return [
        'enabled' => hris_get_boolean_application_setting($pdo, $definitions['enabled']['key'], $defaults['enabled']),
        'requireAdmins' => hris_get_boolean_application_setting($pdo, $definitions['requireAdmins']['key'], $defaults['requireAdmins']),
        'requireHr' => hris_get_boolean_application_setting($pdo, $definitions['requireHr']['key'], $defaults['requireHr']),
        'requireManagers' => hris_get_boolean_application_setting($pdo, $definitions['requireManagers']['key'], $defaults['requireManagers']),
        'requireAllUsers' => hris_get_boolean_application_setting($pdo, $definitions['requireAllUsers']['key'], $defaults['requireAllUsers']),
        'otpExpiryMinutes' => hris_get_integer_application_setting(
            $pdo,
            $definitions['otpExpiryMinutes']['key'],
            $defaults['otpExpiryMinutes'],
            $definitions['otpExpiryMinutes']['min'],
            $definitions['otpExpiryMinutes']['max']
        ),
        'maxAttempts' => hris_get_integer_application_setting(
            $pdo,
            $definitions['maxAttempts']['key'],
            $defaults['maxAttempts'],
            $definitions['maxAttempts']['min'],
            $definitions['maxAttempts']['max']
        ),
        'resendDelaySeconds' => hris_get_integer_application_setting(
            $pdo,
            $definitions['resendDelaySeconds']['key'],
            $defaults['resendDelaySeconds'],
            $definitions['resendDelaySeconds']['min'],
            $definitions['resendDelaySeconds']['max']
        ),
        'updatedAt' => hris_latest_settings_updated_at(
            $pdo,
            array_map(static fn (array $definition): string => $definition['key'], $definitions)
        ) ?? $defaults['updatedAt'],
    ];
}

function hris_two_factor_payload_integer(
    array $body,
    array $keys,
    string $label,
    int $default,
    int $minimum,
    int $maximum,
    array &$errors
): int {
    $rawValue = null;

    foreach ($keys as $key) {
        if (array_key_exists($key, $body)) {
            $rawValue = $body[$key];
            break;
        }
    }

    if ($rawValue === null || (is_string($rawValue) && trim($rawValue) === '')) {
        return $default;
    }

    $number = filter_var($rawValue, FILTER_VALIDATE_INT);

    if ($number === false) {
        $errors[] = "{$label} must be a whole number.";
        return $default;
    }

    $number = (int)$number;

    if ($number < $minimum || $number > $maximum) {
        $errors[] = "{$label} must be between {$minimum} and {$maximum}.";
        return $default;
    }

    return $number;
}

function hris_normalize_two_factor_settings_payload(array $body): array
{
    $current = hris_two_factor_default_settings();
    $errors = [];

    return [
        'settings' => [
            'enabled' => hris_boolean_value($body['enabled'] ?? null, $current['enabled']),
            'requireAdmins' => hris_boolean_value($body['requireAdmins'] ?? ($body['require_admins'] ?? null), $current['requireAdmins']),
            'requireHr' => hris_boolean_value($body['requireHr'] ?? ($body['require_hr'] ?? null), $current['requireHr']),
            'requireManagers' => hris_boolean_value($body['requireManagers'] ?? ($body['require_managers'] ?? null), $current['requireManagers']),
            'requireAllUsers' => hris_boolean_value($body['requireAllUsers'] ?? ($body['require_all_users'] ?? null), $current['requireAllUsers']),
            'otpExpiryMinutes' => hris_two_factor_payload_integer(
                $body,
                ['otpExpiryMinutes', 'otp_expiry_minutes'],
                'OTP expiry',
                $current['otpExpiryMinutes'],
                5,
                15,
                $errors
            ),
            'maxAttempts' => hris_two_factor_payload_integer(
                $body,
                ['maxAttempts', 'max_attempts'],
                'Maximum verification attempts',
                $current['maxAttempts'],
                3,
                10,
                $errors
            ),
            'resendDelaySeconds' => hris_two_factor_payload_integer(
                $body,
                ['resendDelaySeconds', 'resend_delay', 'resend_delay_seconds', 'resendDelay'],
                'Resend delay',
                $current['resendDelaySeconds'],
                0,
                60,
                $errors
            ),
        ],
        'errors' => $errors,
    ];
}

function hris_store_two_factor_settings(PDO $pdo, array $settings): void
{
    hris_ensure_two_factor_tables($pdo);

    foreach (hris_two_factor_setting_definitions() as $name => $definition) {
        if (!array_key_exists($name, $settings)) {
            continue;
        }

        if ($definition['type'] === 'bool') {
            hris_store_boolean_application_setting($pdo, $definition['key'], $settings[$name]);
        } else {
            hris_store_integer_application_setting($pdo, $definition['key'], (int)$settings[$name]);
        }
    }
}

function hris_two_factor_personal_enabled(PDO $pdo, int $userId): bool
{
    hris_ensure_two_factor_tables($pdo);

    if ($userId <= 0) {
        return false;
    }

    $statement = $pdo->prepare('SELECT two_factor_enabled FROM users WHERE id = :id AND is_archived = 0 LIMIT 1');
    $statement->execute([':id' => $userId]);

    return (bool)((int)$statement->fetchColumn());
}

function hris_two_factor_required(PDO $pdo, array $user): bool
{
    $settings = hris_two_factor_settings($pdo);

    if (!$settings['enabled']) {
        return false;
    }

    $roleKey = hris_normalize_role($user['roleKey'] ?? $user['role'] ?? '');

    if ($settings['requireAllUsers']) {
        return true;
    }

    if ($settings['requireAdmins'] && $roleKey === 'admin') {
        return true;
    }

    if ($settings['requireHr'] && in_array($roleKey, ['hrhead', 'hrstaff'], true)) {
        return true;
    }

    if ($settings['requireManagers'] && in_array($roleKey, ['chief', 'regionaldirector', 'manager'], true)) {
        return true;
    }

    if (array_key_exists('two_factor_enabled', $user)) {
        return (bool)$user['two_factor_enabled'];
    }

    return hris_two_factor_personal_enabled($pdo, (int)($user['id'] ?? 0));
}

function hris_password_length_error(PDO $pdo, string $password, int $minimumLength = 6): ?string
{
    $maximumLength = hris_security_settings($pdo)['maximumPasswordLength'];
    $length = strlen($password);

    if ($length < $minimumLength) {
        return 'Password must be at least ' . $minimumLength . ' characters.';
    }

    if ($length > $maximumLength) {
        return 'Password must not exceed ' . $maximumLength . ' characters.';
    }

    return null;
}

function hris_app_settings_table_exists(PDO $pdo, string $table): bool
{
    if (function_exists('hris_database_table_exists')) {
        return hris_database_table_exists($pdo, $table);
    }

    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );
    $statement->execute([':table_name' => $table]);

    return (int)$statement->fetchColumn() > 0;
}

function hris_database_column_exists(PDO $pdo, string $table, string $column): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name
           AND COLUMN_NAME = :column_name'
    );
    $statement->execute([
        ':table_name' => $table,
        ':column_name' => $column,
    ]);

    return (int)$statement->fetchColumn() > 0;
}

function hris_ensure_organization_structure_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (!hris_database_column_exists($pdo, 'divisions', 'description')) {
        $pdo->exec(
            'ALTER TABLE divisions
             ADD COLUMN description TEXT NULL AFTER name'
        );
    }

    if (!hris_database_column_exists($pdo, 'divisions', 'is_archived')) {
        $pdo->exec(
            'ALTER TABLE divisions
             ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER description'
        );
    }

    if (!hris_database_column_exists($pdo, 'designations', 'is_archived')) {
        $pdo->exec(
            'ALTER TABLE designations
             ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER name'
        );
    }

    $pdo->exec('UPDATE divisions SET is_archived = 0 WHERE is_archived IS NULL');
    $pdo->exec('UPDATE designations SET is_archived = 0 WHERE is_archived IS NULL');

    $ensured = true;
}

function hris_ensure_user_security_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (!hris_database_column_exists($pdo, 'users', 'password_changed_at')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN password_changed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
             AFTER must_change_password'
        );
    }

    if (!hris_database_column_exists($pdo, 'users', 'failed_login_attempts')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0
             AFTER password_changed_at'
        );
    }

    if (!hris_database_column_exists($pdo, 'users', 'locked_until')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN locked_until DATETIME NULL DEFAULT NULL
             AFTER failed_login_attempts'
        );
    }

    $pdo->exec('UPDATE users SET password_changed_at = CURRENT_TIMESTAMP WHERE password_changed_at IS NULL');

    $ensured = true;
}

function hris_datetime_timestamp(mixed $value): ?int
{
    $text = trim((string)($value ?? ''));

    if ($text === '') {
        return null;
    }

    $timestamp = strtotime($text);

    return $timestamp === false ? null : $timestamp;
}

function hris_password_validity_days(): int
{
    return 60;
}

function hris_password_has_expired(PDO $pdo, mixed $passwordChangedAt): bool
{
    $expiryDays = hris_password_validity_days();

    if ($expiryDays <= 0) {
        return false;
    }

    $changedAt = hris_datetime_timestamp($passwordChangedAt);

    if ($changedAt === null) {
        return false;
    }

    return $changedAt + ($expiryDays * 86400) < time();
}

require_once __DIR__ . '/audit_logs_helper.php';
