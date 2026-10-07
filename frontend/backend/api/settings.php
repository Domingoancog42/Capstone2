<?php
declare(strict_types=1);

/*
 * Settings: the application-settings library and the Settings endpoint, in one file.
 *
 * Two files used to sit beside this one and have been folded in here:
 *
 *   app_settings.php     the library below -- the settings key/value store, the permission engine,
 *                        the security and two-factor settings, and the runtime migrations.
 *   public_settings.php  the few values the login screen needs before a session exists, now served
 *                        by `?section=public`.
 *
 * That makes this file two things at once, and it has to behave as both:
 *
 *   Included.   connection-pdo.php requires this file, so it loads on essentially every request.
 *               Everything above the guard near the bottom is declarations only. Nothing runs there,
 *               and nothing may be added that runs, because connection-pdo.php is still only
 *               half-loaded at that moment -- it requires this file part-way through its own
 *               definitions, so the ones below its line 92 do not exist yet.
 *   Requested.  Only a request for settings.php itself gets past settings_is_direct_request(), and
 *               only then does the endpoint at the bottom execute.
 *
 * The require below is what supplies json_response(), require_session_user() and $pdo. It is
 * circular with connection-pdo.php's require of this file, deliberately: whichever of the two is
 * entered first finishes loading the other, and require_once makes the second attempt a no-op.
 */

require_once __DIR__ . '/connection-pdo.php';

/* =========================================================================================
 * Application settings library -- formerly app_settings.php.
 * Definitions only: see the note above on why nothing here may execute at load time.
 * ========================================================================================= */

function ensure_application_settings_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (
        app_settings_table_exists($pdo, 'application_settings')
        && !app_settings_table_exists($pdo, 'settings')
    ) {
        $pdo->exec('RENAME TABLE application_settings TO settings');
    }

    if (app_settings_table_exists($pdo, 'application_settings')) {
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

function ensure_audit_logs_table(PDO $pdo): void
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
            . 'Call ensure_audit_logs_table() before beginTransaction().'
        );
    }

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
        if (!database_column_exists($pdo, 'audit_logs', $column)) {
            $pdo->exec("ALTER TABLE audit_logs ADD COLUMN {$column} {$definition}");
        }
    }

    $ensured = true;
}

function get_application_setting(PDO $pdo, string $key, string $default = ''): string
{
    ensure_application_settings_table($pdo);

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

function get_boolean_application_setting(PDO $pdo, string $key, bool $default = false): bool
{
    $value = strtolower(trim(get_application_setting($pdo, $key, $default ? '1' : '0')));

    return in_array($value, ['1', 'true', 'yes', 'on'], true);
}

function get_integer_application_setting(PDO $pdo, string $key, int $default, int $minimum, int $maximum): int
{
    $value = get_application_setting($pdo, $key, (string)$default);
    $number = filter_var($value, FILTER_VALIDATE_INT);

    if ($number === false) {
        return $default;
    }

    return max($minimum, min($maximum, (int)$number));
}

function store_boolean_application_setting(PDO $pdo, string $key, mixed $value): void
{
    ensure_application_settings_table($pdo);

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

function store_application_setting(PDO $pdo, string $key, string $value): void
{
    ensure_application_settings_table($pdo);

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
 * Fallbacks for the branding fields of the System Configuration tab, used until an
 * administrator saves one. settings_default_system_configuration() builds its own
 * defaults on top of these so the two never drift apart.
 */
function system_branding_defaults(): array
{
    return [
        'companyName' => 'Human Resources Information System',
        'companyAddress' => 'Mines Geosciences Bureau, DENR Region X',
    ];
}

/**
 * The company name and address an administrator saved under System Configuration.
 *
 * This lives here rather than beside the rest of the system configuration in settings.php
 * because the login screen needs it: settings.php calls require_session_user() at the top
 * of the file, so nothing in it can be reached before sign-in. A blank field falls back to
 * the default instead of rendering an empty heading.
 */
function system_branding(PDO $pdo): array
{
    $configuration = json_decode(get_application_setting($pdo, 'system_configuration', ''), true);
    $branding = [];

    foreach (system_branding_defaults() as $key => $default) {
        $value = is_array($configuration) ? trim((string)($configuration[$key] ?? '')) : '';
        $branding[$key] = $value !== '' ? $value : $default;
    }

    return $branding;
}

/**
 * The roles that ship with the system. Each one owns a dashboard component and a
 * route prefix on the client, which is why the list is fixed: a role here cannot be
 * renamed or deleted without breaking routing.
 */
function builtin_permission_roles(): array
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
        'chiefadmin' => [
            'label' => 'Chief Admin',
            'description' => 'Uses the Division Chief workspace for administrative division oversight.',
            'baseRole' => 'chief',
        ],
        'planningofficer' => [
            'label' => 'Planning Officer',
            'description' => 'Monitors division plans, performance records, and workforce requests.',
        ],
        'cashier' => [
            'label' => 'Cashier',
            'description' => 'Releases approved payroll and monitors disbursement records.',
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
function role_key_from_name(string $name): string
{
    return strtolower((string)preg_replace('/[^a-z]/i', '', $name));
}

/**
 * Custom roles add `base_role` and `description` to the roles table. Chief Admin is the one
 * built-in alias with a base role: it owns a route/page but deliberately inherits Chief authority.
 */
function ensure_role_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (!database_column_exists($pdo, 'roles', 'base_role')) {
        $pdo->exec('ALTER TABLE roles ADD COLUMN base_role VARCHAR(40) NULL DEFAULT NULL AFTER name');
    }

    if (!database_column_exists($pdo, 'roles', 'description')) {
        $pdo->exec('ALTER TABLE roles ADD COLUMN description VARCHAR(255) NULL DEFAULT NULL AFTER base_role');
    }

    /* Existing installations receive the new built-in role without requiring a full SQL re-import. */
    $pdo->exec(
        'INSERT INTO roles (name, base_role, description)
         SELECT "ChiefAdmin", "chief", "Uses the Division Chief workspace for administrative division oversight."
         WHERE NOT EXISTS (
            SELECT 1 FROM roles WHERE LOWER(REPLACE(name, " ", "")) = "chiefadmin"
         )'
    );
    $pdo->exec(
        'UPDATE roles
         SET base_role = "chief",
             description = COALESCE(NULLIF(description, ""), "Uses the Division Chief workspace for administrative division oversight.")
         WHERE LOWER(REPLACE(name, " ", "")) = "chiefadmin"'
    );

    $ensured = true;
}

/**
 * Admin-created roles, keyed like the built-ins. `baseRole` names the built-in role
 * whose dashboard and routes the custom role reuses — without one there would be no
 * page for its users to land on.
 */
function custom_permission_roles(PDO $pdo): array
{
    try {
        ensure_role_columns($pdo);

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

    $builtin = builtin_permission_roles();
    $roles = [];

    foreach ($statement->fetchAll() as $row) {
        $key = role_key_from_name((string)($row['name'] ?? ''));
        $baseRole = role_key_from_name((string)($row['base_role'] ?? ''));

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
function permission_roles(?PDO $pdo = null): array
{
    $roles = builtin_permission_roles();

    if (!$pdo instanceof PDO) {
        return $roles;
    }

    return $roles + custom_permission_roles($pdo);
}

/**
 * The built-in capability role used by access checks. Chief Admin has a distinct page/route but
 * maps to Chief here; ordinary built-ins map to themselves and custom roles map to their base.
 */
function role_base_key(PDO $pdo, string $roleKey): string
{
    $normalized = normalize_role($roleKey);
    $builtin = builtin_permission_roles();

    if (isset($builtin[$normalized])) {
        return (string)($builtin[$normalized]['baseRole'] ?? $normalized);
    }

    $baseRole = custom_permission_roles($pdo)[$normalized]['baseRole'] ?? '';

    return (string)($builtin[$baseRole]['baseRole'] ?? $baseRole);
}

function permission_available_actions(): array
{
    return [
        'dashboard' => ['view'],
        'profile' => ['view', 'edit', 'submit', 'upload', 'download', 'print'],
        'serviceRecord' => ['view', 'create', 'edit', 'import', 'export', 'print', 'download', 'submit', 'upload'],
        'users' => ['view', 'create', 'edit', 'archive', 'restore'],
        'permissions' => ['view', 'create', 'edit', 'approve', 'reject'],
        'settings' => ['view', 'create', 'edit', 'archive', 'restore', 'import', 'export', 'download', 'upload', 'backup', 'unlock'],
        'auditLogs' => ['view'],
        'calendar' => ['view', 'create', 'edit'],
        'employees' => ['view', 'create', 'edit', 'approve', 'reject', 'archive', 'restore', 'import', 'export', 'print', 'download', 'upload'],
        'rewardsRecognition' => ['view', 'create', 'edit', 'archive', 'restore', 'print', 'download', 'export', 'upload', 'generate', 'nominate', 'close', 'reopen'],
        'promotions' => ['view', 'create', 'edit', 'approve', 'reject', 'cancel', 'archive', 'restore', 'export', 'print'],
        'attendance' => ['view', 'create', 'edit', 'approve', 'reject', 'submit', 'cancel', 'archive', 'restore', 'import', 'export', 'print', 'download'],
        'leave' => ['view', 'create', 'edit', 'approve', 'reject', 'submit', 'cancel', 'accept', 'archive', 'restore', 'export', 'print', 'download', 'upload'],
        'leaveBalance' => ['view', 'create', 'edit', 'import', 'export'],
        'payroll' => ['view', 'create', 'edit', 'approve', 'reject', 'return', 'submit', 'archive', 'restore', 'export', 'print', 'download', 'upload', 'generate', 'release'],
        'reports' => ['view', 'create', 'edit', 'assign', 'rate', 'submit', 'archive', 'restore', 'upload', 'export', 'print', 'download', 'generate'],
        'payslip' => ['view', 'generate', 'export', 'print', 'download'],
    ];
}

function permission_items(): array
{
    $items = [
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
            'defaultActions' => ['view', 'create', 'edit'],
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
            'defaultActions' => ['view', 'create', 'edit'],
        ],
        [
            // Awards used to be gated by the `employees` resource, which conflated "may edit
            // employee records" with "may issue a certificate in the Regional Director's name".
            'key' => 'rewardsRecognition',
            'defaultActions' => ['view', 'create', 'edit'],
        ],
        [
            // Moving somebody up the designation hierarchy rewrites their appointment and salary, so
            // it is its own resource rather than a right that comes bundled with `employees`.
            'key' => 'promotions',
            'defaultActions' => ['view', 'create', 'edit', 'approve', 'reject'],
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

    $catalog = permission_available_actions();
    foreach ($items as &$item) {
        $item['availableActions'] = $catalog[$item['key']];
    }
    unset($item);

    return $items;
}

function default_role_permission_access(): array
{
    return [
        'admin' => 'all',
        'hrhead' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'payslip',
            'users',
            'permissions',
            'auditLogs',
            'calendar',
            'employees',
            'rewardsRecognition',
            'promotions',
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
            'payslip',
            'calendar',
            'employees',
            'rewardsRecognition',
            'promotions',
            'attendance',
            'leave',
            'leaveBalance',
            'reports',
        ],
        'chief' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'payslip',
            'calendar',
            'rewardsRecognition',
            // Prepares promotions for the Regular employees of their division; the HR Head
            // recommends and the Regional Director signs.
            'promotions',
            'attendance',
            'leave',
            // Runtime access is limited to the Chief assigned to FAD/FAM.
            'payroll',
            'reports',
        ],
        // Chief Admin no longer participates in payroll; the FAD Division Chief owns that stage.
        'chiefadmin' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'payslip',
            'calendar',
            'rewardsRecognition',
            'promotions',
            'attendance',
            'leave',
            'reports',
        ],
        // A planning officer works the same division-scoped desk a chief does, but never inherits
        // the FAD Chief's organization-wide payroll approval desk.
        'planningofficer' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'payslip',
            'calendar',
            'attendance',
            'leave',
            'reports',
        ],
        // The payout desk. `payroll` opens the register and `payslip` the released slips; `leave`
        // opens a self-only filing page. Approving stays with the leave chain, so this grants no
        // access to another employee's leave record and no leave approval right.
        'cashier' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'calendar',
            'payroll',
            'payslip',
            'leave',
        ],
        'regionaldirector' => [
            'dashboard',
            'profile',
            'serviceRecord',
            'payslip',
            'calendar',
            'leave',
            'reports',
            'rewardsRecognition',
            // The final signature on a promotion; preparing one stays with HR.
            'promotions',
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
            // My Promotion: the employee's own approved promotions, read-only (promotion.php scopes it).
            'promotions',
        ],
    ];
}

/*
 * Where a role's default actions in a module are narrower than the module's own defaults. An
 * employee's Promotions is My Promotion, a read-only page of their own approved promotions. The
 * FAD Chief approves or returns payroll but never prepares it; runtime division checks keep every
 * other Chief out. Mirrors rolePermissionActionOverrides in frontend/src/page/settings/permission.jsx.
 */
function default_role_permission_action_overrides(): array
{
    return [
        'employee' => [
            'promotions' => ['view', 'print'],
        ],
        'chief' => [
            'promotions' => ['view', 'create', 'edit', 'cancel', 'archive', 'restore', 'export', 'print'],
            'payroll' => ['view', 'approve', 'return', 'archive', 'restore'],
        ],
        'chiefadmin' => [
            'promotions' => ['view', 'create', 'edit', 'cancel', 'archive', 'restore', 'export', 'print'],
        ],
    ];
}

function default_permission_templates(?PDO $pdo = null): array
{
    $accessByRole = default_role_permission_access();
    $actionOverrides = default_role_permission_action_overrides();
    $templates = [];

    foreach (permission_roles($pdo) as $roleKey => $role) {
        // A custom role starts life with its base role's access; the admin narrows it
        // from there with the module checklist.
        $baseRoleKey = (string)($role['baseRole'] ?? '');
        $access = $accessByRole[$roleKey] ?? ($accessByRole[$baseRoleKey] ?? []);
        $overrides = $actionOverrides[$roleKey] ?? ($actionOverrides[$baseRoleKey] ?? []);
        $modules = [];

        foreach (permission_items() as $item) {
            $moduleKey = $item['key'];
            $enabled = $access === 'all' || in_array($moduleKey, $access, true);

            $modules[$moduleKey] = [
                'enabled' => $enabled,
                'actions' => $enabled ? ($overrides[$moduleKey] ?? $item['defaultActions']) : [],
            ];
        }

        $templates[$roleKey] = [
            'enabled' => true,
            'modules' => $modules,
        ];
    }

    return $templates;
}

function normalize_permission_templates(array $templates, ?PDO $pdo = null): array
{
    $defaults = default_permission_templates($pdo);
    $items = permission_items();
    $normalized = [];

    foreach (permission_roles($pdo) as $roleKey => $role) {
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
            $allowedActions = array_flip($item['availableActions']);
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

/**
 * Existing installations already have a complete role template stored in `settings`, so changing
 * the built-in default alone would leave Chief's new Nomination page disabled. Promote that one
 * resource once, then leave later RBAC edits untouched.
 */
function migrate_chief_nomination_permission(PDO $pdo, array $templates): array
{
    $migrationKey = 'permission_migration_chief_nomination_v1';

    if (get_boolean_application_setting($pdo, $migrationKey, false)) {
        return $templates;
    }

    if (isset($templates['chief']) && is_array($templates['chief'])) {
        $modules = isset($templates['chief']['modules']) && is_array($templates['chief']['modules'])
            ? $templates['chief']['modules']
            : [];
        $modules['rewardsRecognition'] = [
            'enabled' => true,
            'actions' => ['view', 'create', 'edit'],
        ];
        $templates['chief']['modules'] = $modules;

        $encodedTemplates = json_encode($templates, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encodedTemplates === false) {
            throw new RuntimeException('Unable to migrate the Chief nomination permission.');
        }

        store_application_setting($pdo, 'role_permissions', $encodedTemplates);
    }

    store_boolean_application_setting($pdo, $migrationKey, true);

    return $templates;
}

/*
 * My Promotion arrived after templates were first saved, so a stored Employee template still has
 * Promotions switched off. Switch it on once, read-only, unless an administrator has already set it.
 */
function migrate_employee_promotions_permission(PDO $pdo, array $templates): array
{
    $migrationKey = 'permission_migration_employee_promotions_v1';

    if (get_boolean_application_setting($pdo, $migrationKey, false)) {
        return $templates;
    }

    if (isset($templates['employee']) && is_array($templates['employee'])) {
        $modules = isset($templates['employee']['modules']) && is_array($templates['employee']['modules'])
            ? $templates['employee']['modules']
            : [];

        if (($modules['promotions']['enabled'] ?? false) !== true) {
            $modules['promotions'] = [
                'enabled' => true,
                'actions' => default_role_permission_action_overrides()['employee']['promotions'],
            ];
            $templates['employee']['modules'] = $modules;

            $encodedTemplates = json_encode($templates, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($encodedTemplates === false) {
                throw new RuntimeException('Unable to migrate the Employee promotions permission.');
            }

            store_application_setting($pdo, 'role_permissions', $encodedTemplates);
        }
    }

    store_boolean_application_setting($pdo, $migrationKey, true);

    return $templates;
}

/*
 * The Chief's Promotions desk arrived after templates were first saved, so a stored Chief template
 * still has Promotions switched off. Switch it on once with the preparer's actions, unless an
 * administrator has already enabled it.
 */
function migrate_chief_promotions_permission(PDO $pdo, array $templates): array
{
    $migrationKey = 'permission_migration_chief_promotions_v1';

    if (get_boolean_application_setting($pdo, $migrationKey, false)) {
        return $templates;
    }

    if (isset($templates['chief']) && is_array($templates['chief'])) {
        $modules = isset($templates['chief']['modules']) && is_array($templates['chief']['modules'])
            ? $templates['chief']['modules']
            : [];

        if (($modules['promotions']['enabled'] ?? false) !== true) {
            $modules['promotions'] = [
                'enabled' => true,
                'actions' => default_role_permission_action_overrides()['chief']['promotions'],
            ];
            $templates['chief']['modules'] = $modules;

            $encodedTemplates = json_encode($templates, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($encodedTemplates === false) {
                throw new RuntimeException('Unable to migrate the Chief promotions permission.');
            }

            store_application_setting($pdo, 'role_permissions', $encodedTemplates);
        }
    }

    store_boolean_application_setting($pdo, $migrationKey, true);

    return $templates;
}

/*
 * The shared My Records navigation already gives every non-admin role a My Payslip page, but
 * installations with saved permission templates hide that entry unless the separate `payslip`
 * resource is enabled. Grant the self-scoped page once for every current non-admin role. The API
 * pins `scope=self` to the signed-in employee, so this does not grant access to anybody else's
 * payslip or to the payroll register.
 */
function migrate_non_admin_payslip_permission(PDO $pdo, array $templates): array
{
    $migrationKey = 'permission_migration_non_admin_payslip_v1';

    if (get_boolean_application_setting($pdo, $migrationKey, false)) {
        return $templates;
    }

    $changed = false;

    foreach (permission_roles($pdo) as $roleKey => $role) {
        if ($roleKey === 'admin' || !isset($templates[$roleKey]) || !is_array($templates[$roleKey])) {
            continue;
        }

        $modules = isset($templates[$roleKey]['modules']) && is_array($templates[$roleKey]['modules'])
            ? $templates[$roleKey]['modules']
            : [];
        $payslip = isset($modules['payslip']) && is_array($modules['payslip'])
            ? $modules['payslip']
            : [];
        $actions = isset($payslip['actions']) && is_array($payslip['actions'])
            ? $payslip['actions']
            : [];

        if (!in_array('view', $actions, true)) {
            array_unshift($actions, 'view');
        }

        if (($payslip['enabled'] ?? false) !== true || $actions !== ($payslip['actions'] ?? [])) {
            $modules['payslip'] = [
                'enabled' => true,
                'actions' => array_values(array_unique($actions)),
            ];
            $templates[$roleKey]['modules'] = $modules;
            $changed = true;
        }
    }

    if ($changed) {
        $encodedTemplates = json_encode($templates, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encodedTemplates === false) {
            throw new RuntimeException('Unable to migrate the non-admin My Payslip permission.');
        }

        store_application_setting($pdo, 'role_permissions', $encodedTemplates);
    }

    store_boolean_application_setting($pdo, $migrationKey, true);

    return $templates;
}

/*
 * Payroll's second approval now belongs to the FAD/FAM Division Chief. Existing installations may
 * still carry the preceding migration's Chief Admin grant, so move that module back to the Chief
 * template once. Runtime payroll checks and ChiefDashboard then limit the shared Chief template to
 * the one account assigned to FAD/FAM; all other Division Chiefs remain without a payroll surface.
 */
function migrate_fad_chief_payroll_permission(PDO $pdo, array $templates): array
{
    $migrationKey = 'permission_migration_fad_chief_payroll_v1';

    if (get_boolean_application_setting($pdo, $migrationKey, false)) {
        return $templates;
    }

    $changed = false;
    if (isset($templates['chief']) && is_array($templates['chief'])) {
        $modules = isset($templates['chief']['modules']) && is_array($templates['chief']['modules'])
            ? $templates['chief']['modules']
            : [];
        $modules['payroll'] = [
            'enabled' => true,
            'actions' => default_role_permission_action_overrides()['chief']['payroll'],
        ];
        $templates['chief']['modules'] = $modules;
        $changed = true;
    }

    if (isset($templates['chiefadmin']) && is_array($templates['chiefadmin'])) {
        $modules = isset($templates['chiefadmin']['modules']) && is_array($templates['chiefadmin']['modules'])
            ? $templates['chiefadmin']['modules']
            : [];
        $modules['payroll'] = [
            'enabled' => false,
            'actions' => [],
        ];
        $templates['chiefadmin']['modules'] = $modules;
        $changed = true;
    }

    if ($changed) {
        $encodedTemplates = json_encode($templates, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encodedTemplates === false) {
            throw new RuntimeException('Unable to migrate the FAD Division Chief payroll permission.');
        }

        store_application_setting($pdo, 'role_permissions', $encodedTemplates);
    }

    store_boolean_application_setting($pdo, $migrationKey, true);

    return $templates;
}

function permission_templates(PDO $pdo): array
{
    $rawPermissions = get_application_setting($pdo, 'role_permissions', '{}');
    $permissions = json_decode($rawPermissions, true);

    if (!is_array($permissions) || $permissions === []) {
        return default_permission_templates($pdo);
    }

    $permissions = migrate_chief_nomination_permission($pdo, $permissions);
    $permissions = migrate_employee_promotions_permission($pdo, $permissions);
    $permissions = migrate_chief_promotions_permission($pdo, $permissions);
    $permissions = migrate_non_admin_payslip_permission($pdo, $permissions);
    $permissions = migrate_fad_chief_payroll_permission($pdo, $permissions);

    return normalize_permission_templates($permissions, $pdo);
}

function store_permission_templates(PDO $pdo, array $templates): array
{
    $normalized = normalize_permission_templates($templates, $pdo);
    $encodedPermissions = json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encodedPermissions === false) {
        throw new RuntimeException('Unable to encode permission templates.');
    }

    store_application_setting($pdo, 'role_permissions', $encodedPermissions);

    return $normalized;
}

function permissions_for_role_key(PDO $pdo, string $roleKey): array
{
    $normalizedRoleKey = normalize_role($roleKey);
    $templates = permission_templates($pdo);
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
function normalize_single_permission_template(array $template): array
{
    $items = permission_items();
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
        $allowedActions = array_flip($item['availableActions']);
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
function user_permission_overrides(PDO $pdo): array
{
    $raw = get_application_setting($pdo, 'user_permissions', '{}');
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

        $overrides[$id] = normalize_single_permission_template($template);
    }

    return $overrides;
}

function store_user_permission_overrides(PDO $pdo, array $overrides): array
{
    $normalized = [];

    foreach ($overrides as $userId => $template) {
        $id = (int)$userId;

        if ($id <= 0 || !is_array($template)) {
            continue;
        }

        $normalized[$id] = normalize_single_permission_template($template);
    }

    $encoded = json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encoded === false) {
        throw new RuntimeException('Unable to encode user permission overrides.');
    }

    store_application_setting($pdo, 'user_permissions', $encoded);

    return $normalized;
}

/**
 * Canonical form of a template for equality checks: module order comes from
 * permission_items() and actions are sorted, so two templates that grant the
 * same access always compare equal regardless of how the client ordered them.
 */
function permission_template_signature(array $template): array
{
    $normalized = normalize_single_permission_template($template);

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
function sync_user_permission_override(PDO $pdo, int $userId, mixed $template, string $roleKey): bool
{
    if ($userId <= 0 || !is_array($template)) {
        return false;
    }

    $roleTemplate = permission_templates($pdo)[normalize_role($roleKey)] ?? null;
    $matchesRole = is_array($roleTemplate)
        && permission_template_signature($template) === permission_template_signature($roleTemplate);

    $overrides = user_permission_overrides($pdo);

    if ($matchesRole) {
        unset($overrides[$userId]);
    } else {
        $overrides[$userId] = $template;
    }

    store_user_permission_overrides($pdo, $overrides);

    return !$matchesRole;
}

/**
 * Flatten a normalized template ({enabled, modules}) into the compact
 * "module => [actions]" shape the app uses for access checks.
 */
function flatten_permission_template(array $template): array
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
function permissions_for_user(PDO $pdo, int $userId, string $roleKey): array
{
    if ($userId > 0) {
        $overrides = user_permission_overrides($pdo);

        if (isset($overrides[$userId])) {
            return flatten_permission_template($overrides[$userId]);
        }
    }

    return permissions_for_role_key($pdo, $roleKey);
}

function store_integer_application_setting(PDO $pdo, string $key, int $value): void
{
    store_application_setting($pdo, $key, (string)$value);
}

function latest_settings_updated_at(PDO $pdo, array $keys): ?string
{
    ensure_application_settings_table($pdo);

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

function security_setting_definitions(): array
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

function security_settings(PDO $pdo): array
{
    $settings = [];

    foreach (security_setting_definitions() as $name => $definition) {
        $settings[$name] = get_integer_application_setting(
            $pdo,
            $definition['key'],
            $definition['default'],
            $definition['min'],
            $definition['max']
        );
    }

    return $settings;
}

function normalize_security_settings_payload(array $body): array
{
    $settings = [];
    $errors = [];

    foreach (security_setting_definitions() as $name => $definition) {
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

function store_security_settings(PDO $pdo, array $settings): void
{
    $definitions = security_setting_definitions();

    foreach ($settings as $name => $value) {
        if (!isset($definitions[$name])) {
            continue;
        }

        store_integer_application_setting($pdo, $definitions[$name]['key'], (int)$value);
    }
}

function two_factor_default_settings(): array
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

function two_factor_setting_definitions(): array
{
    $defaults = two_factor_default_settings();

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

function boolean_value(mixed $value, bool $default = false): bool
{
    if ($value === null || $value === '') {
        return $default;
    }

    $normalized = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

    return $normalized === null ? $default : $normalized;
}

function seed_two_factor_settings(PDO $pdo): void
{
    ensure_application_settings_table($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO settings (setting_key, setting_value)
         VALUES (:setting_key, :setting_value)
         ON DUPLICATE KEY UPDATE setting_value = setting_value'
    );

    foreach (two_factor_setting_definitions() as $definition) {
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

function migrate_two_factor_settings_to_settings(PDO $pdo): void
{
    if (!app_settings_table_exists($pdo, 'two_factor_settings')) {
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

    foreach (two_factor_setting_definitions() as $name => $definition) {
        if (!array_key_exists($name, $values) || $values[$name] === null) {
            continue;
        }

        if ($definition['type'] === 'bool') {
            store_boolean_application_setting($pdo, $definition['key'], $values[$name]);
        } else {
            store_integer_application_setting($pdo, $definition['key'], (int)$values[$name]);
        }
    }

    $pdo->exec('DROP TABLE IF EXISTS two_factor_settings');
}

/**
 * Provisions the two-factor schema: the per-user opt-in column and the settings rows.
 *
 * The one-time passcode itself lives in the PHP session (see two_factor.php) and every 2FA
 * event is written to audit_logs, so `user_two_factor_codes` and `two_factor_logs` are retired
 * here the same way `two_factor_settings` was.
 */
function ensure_two_factor_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (security_schema_is_current($pdo)) {
        $ensured = true;

        return;
    }

    ensure_user_security_columns($pdo);

    if (!database_column_exists($pdo, 'users', 'two_factor_enabled')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0
             AFTER locked_until'
        );
    }

    $pdo->exec('UPDATE users SET two_factor_enabled = 0 WHERE two_factor_enabled IS NULL');

    ensure_application_settings_table($pdo);
    migrate_two_factor_settings_to_settings($pdo);
    seed_two_factor_settings($pdo);

    $pdo->exec('DROP TABLE IF EXISTS user_two_factor_codes');
    $pdo->exec('DROP TABLE IF EXISTS two_factor_logs');

    $ensured = true;
}

function ensure_email_verification_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (security_schema_is_current($pdo)) {
        $ensured = true;

        return;
    }

    if (!database_column_exists($pdo, 'users', 'email_verified_at')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN email_verified_at DATETIME NULL DEFAULT NULL
             AFTER email'
        );
    }

    if (!database_column_exists($pdo, 'users', 'email_updated_at')) {
        $afterColumn = database_column_exists($pdo, 'users', 'email_verified_at')
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

function ensure_email_verification_tables(PDO $pdo): void
{
    // Legacy wrapper: email verification tables are no longer auto-created at runtime.
    ensure_email_verification_columns($pdo);
}

function two_factor_settings(PDO $pdo): array
{
    ensure_two_factor_schema($pdo);

    $defaults = two_factor_default_settings();
    $definitions = two_factor_setting_definitions();

    return [
        'enabled' => get_boolean_application_setting($pdo, $definitions['enabled']['key'], $defaults['enabled']),
        'requireAdmins' => get_boolean_application_setting($pdo, $definitions['requireAdmins']['key'], $defaults['requireAdmins']),
        'requireHr' => get_boolean_application_setting($pdo, $definitions['requireHr']['key'], $defaults['requireHr']),
        'requireManagers' => get_boolean_application_setting($pdo, $definitions['requireManagers']['key'], $defaults['requireManagers']),
        'requireAllUsers' => get_boolean_application_setting($pdo, $definitions['requireAllUsers']['key'], $defaults['requireAllUsers']),
        'otpExpiryMinutes' => get_integer_application_setting(
            $pdo,
            $definitions['otpExpiryMinutes']['key'],
            $defaults['otpExpiryMinutes'],
            $definitions['otpExpiryMinutes']['min'],
            $definitions['otpExpiryMinutes']['max']
        ),
        'maxAttempts' => get_integer_application_setting(
            $pdo,
            $definitions['maxAttempts']['key'],
            $defaults['maxAttempts'],
            $definitions['maxAttempts']['min'],
            $definitions['maxAttempts']['max']
        ),
        'resendDelaySeconds' => get_integer_application_setting(
            $pdo,
            $definitions['resendDelaySeconds']['key'],
            $defaults['resendDelaySeconds'],
            $definitions['resendDelaySeconds']['min'],
            $definitions['resendDelaySeconds']['max']
        ),
        'updatedAt' => latest_settings_updated_at(
            $pdo,
            array_map(static fn (array $definition): string => $definition['key'], $definitions)
        ) ?? $defaults['updatedAt'],
    ];
}

function two_factor_payload_integer(
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

function normalize_two_factor_settings_payload(array $body): array
{
    $current = two_factor_default_settings();
    $errors = [];

    return [
        'settings' => [
            'enabled' => boolean_value($body['enabled'] ?? null, $current['enabled']),
            'requireAdmins' => boolean_value($body['requireAdmins'] ?? ($body['require_admins'] ?? null), $current['requireAdmins']),
            'requireHr' => boolean_value($body['requireHr'] ?? ($body['require_hr'] ?? null), $current['requireHr']),
            'requireManagers' => boolean_value($body['requireManagers'] ?? ($body['require_managers'] ?? null), $current['requireManagers']),
            'requireAllUsers' => boolean_value($body['requireAllUsers'] ?? ($body['require_all_users'] ?? null), $current['requireAllUsers']),
            'otpExpiryMinutes' => two_factor_payload_integer(
                $body,
                ['otpExpiryMinutes', 'otp_expiry_minutes'],
                'OTP expiry',
                $current['otpExpiryMinutes'],
                5,
                15,
                $errors
            ),
            'maxAttempts' => two_factor_payload_integer(
                $body,
                ['maxAttempts', 'max_attempts'],
                'Maximum verification attempts',
                $current['maxAttempts'],
                3,
                10,
                $errors
            ),
            'resendDelaySeconds' => two_factor_payload_integer(
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

function store_two_factor_settings(PDO $pdo, array $settings): void
{
    ensure_two_factor_schema($pdo);

    foreach (two_factor_setting_definitions() as $name => $definition) {
        if (!array_key_exists($name, $settings)) {
            continue;
        }

        if ($definition['type'] === 'bool') {
            store_boolean_application_setting($pdo, $definition['key'], $settings[$name]);
        } else {
            store_integer_application_setting($pdo, $definition['key'], (int)$settings[$name]);
        }
    }
}

function two_factor_personal_enabled(PDO $pdo, int $userId): bool
{
    ensure_two_factor_schema($pdo);

    if ($userId <= 0) {
        return false;
    }

    $statement = $pdo->prepare('SELECT two_factor_enabled FROM users WHERE id = :id AND is_archived = 0 LIMIT 1');
    $statement->execute([':id' => $userId]);

    return (bool)((int)$statement->fetchColumn());
}

function two_factor_required(PDO $pdo, array $user): bool
{
    $settings = two_factor_settings($pdo);

    if (!$settings['enabled']) {
        return false;
    }

    $roleKey = normalize_role($user['roleKey'] ?? $user['role'] ?? '');

    if ($settings['requireAllUsers']) {
        return true;
    }

    if ($settings['requireAdmins'] && $roleKey === 'admin') {
        return true;
    }

    if ($settings['requireHr'] && in_array($roleKey, ['hrhead', 'hrstaff'], true)) {
        return true;
    }

    if ($settings['requireManagers'] && in_array($roleKey, ['chief', 'planningofficer', 'regionaldirector', 'manager'], true)) {
        return true;
    }

    if (array_key_exists('two_factor_enabled', $user)) {
        return (bool)$user['two_factor_enabled'];
    }

    return two_factor_personal_enabled($pdo, (int)($user['id'] ?? 0));
}

function password_length_error(PDO $pdo, string $password, int $minimumLength = 6): ?string
{
    $maximumLength = security_settings($pdo)['maximumPasswordLength'];
    $length = strlen($password);

    if ($length < $minimumLength) {
        return 'Password must be at least ' . $minimumLength . ' characters.';
    }

    if ($length > $maximumLength) {
        return 'Password must not exceed ' . $maximumLength . ' characters.';
    }

    return null;
}

function app_settings_table_exists(PDO $pdo, string $table): bool
{
    if (function_exists('database_table_exists')) {
        return database_table_exists($pdo, $table);
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

/**
 * True when the schema is already in the state the three security/2FA migrations below would leave
 * it in, so all of them can be skipped.
 *
 * They used to run in full on every authenticated request — `session_user_record()` calls two of
 * them, and `static $ensured` only ever suppressed repeats within a single request. That was around
 * twenty queries each time, and not cheap ones: two blanket UPDATEs over `users`, eight seed
 * INSERTs, and three DROP TABLE statements. The DDL is the worst of it, because it takes table
 * metadata locks that serialize across connections, so a dashboard firing eight requests at once
 * had them queue inside MySQL on top of everything else.
 *
 * Two indexed reads answer the same question. Deriving the answer from the live schema rather than
 * a stored "already migrated" marker is deliberate: restoring one of the older dumps in
 * `backups/` puts the columns back in their pre-migration state, and this notices and lets the
 * migrations run again.
 */
function security_schema_is_current(PDO $pdo): bool
{
    static $isCurrent = null;

    if ($isCurrent !== null) {
        return $isCurrent;
    }

    $columns = $pdo->query(
        "SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'
           AND COLUMN_NAME IN (
               'password_changed_at', 'failed_login_attempts', 'locked_until',
               'two_factor_enabled', 'email_verified_at', 'email_updated_at'
           )"
    )->fetchColumn();

    if ((int)$columns !== 6) {
        return $isCurrent = false;
    }

    $tables = array_map(
        'strtolower',
        $pdo->query(
            "SELECT TABLE_NAME
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN (
                   'settings', 'user_two_factor_codes', 'two_factor_logs', 'two_factor_settings'
               )"
        )->fetchAll(PDO::FETCH_COLUMN)
    );

    // The settings store has to be there, and the three retired tables gone.
    $retired = ['user_two_factor_codes', 'two_factor_logs', 'two_factor_settings'];

    return $isCurrent = in_array('settings', $tables, true)
        && array_intersect($retired, $tables) === [];
}

// database_column_exists() now lives in connection-pdo.php, alongside the table-exists probe
// and the shared archive-column setup that several modules need.

function ensure_organization_structure_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (!database_column_exists($pdo, 'divisions', 'description')) {
        $pdo->exec(
            'ALTER TABLE divisions
             ADD COLUMN description TEXT NULL AFTER name'
        );
    }

    if (!database_column_exists($pdo, 'divisions', 'is_archived')) {
        $pdo->exec(
            'ALTER TABLE divisions
             ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER description'
        );
    }

    if (!database_column_exists($pdo, 'designations', 'is_archived')) {
        $pdo->exec(
            'ALTER TABLE designations
             ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER name'
        );
    }

    $pdo->exec('UPDATE divisions SET is_archived = 0 WHERE is_archived IS NULL');
    $pdo->exec('UPDATE designations SET is_archived = 0 WHERE is_archived IS NULL');

    ensure_designation_hierarchy_columns($pdo);

    $ensured = true;
}

/**
 * The rank a designation holds in the office hierarchy, and the salary grade it is paid at.
 *
 * `designations` used to be a flat list of names, so nothing could say that Administrative
 * Assistant II sits above Administrative Assistant I or that a Division Chief outranks a Unit Head.
 * The promotion module needs exactly that answer: a promotion is a move to a designation whose
 * level is strictly higher, and anything else is a transfer. Level 1 is the lowest rung.
 *
 * Installations that predate the column get their levels seeded once from the designation names
 * (DESIGNATION_LEVEL_SEEDS below), which is what hris.sql ships for the stock catalog; the
 * Designations settings page is where an administrator corrects them afterwards.
 */
const DESIGNATION_DEFAULT_LEVEL = 1;
const DESIGNATION_MAX_LEVEL = 20;

/**
 * Name fragments to level. Each seed UPDATE only touches rows still at the default, so the first
 * fragment a name matches is the one that sticks -- which is why the longer, more specific title
 * is always listed before the fragment it contains ("assistant regional director" before "regional
 * director", "engineer v" before "engineer"). Anything unmatched stays at the default.
 */
const DESIGNATION_LEVEL_SEEDS = [
    ['assistant regional director', 8],
    ['regional director', 9],
    ['division chief', 7],
    ['chief administrative officer', 7],
    ['supervisor', 6],
    ['unit head', 6],
    ['engineer v', 6],
    ['accountant', 5],
    ['hr officer', 5],
    ['system administrator', 5],
    ['administrative assistant iii', 4],
    ['engineer', 4],
    ['specialist', 4],
    ['administrative assistant ii', 3],
    ['cartographer', 3],
    ['administrative assistant', 2],
    ['clerk', 2],
    ['hr staff', 2],
    ['aide', 1],
    ['support staff', 1],
    ['field staff', 1],
];

function ensure_designation_hierarchy_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $seedLevels = false;

    if (!database_column_exists($pdo, 'designations', 'hierarchy_level')) {
        $pdo->exec(
            'ALTER TABLE designations
             ADD COLUMN hierarchy_level TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER name'
        );
        $seedLevels = true;
    }

    if (!database_column_exists($pdo, 'designations', 'salary_grade')) {
        $pdo->exec(
            'ALTER TABLE designations
             ADD COLUMN salary_grade VARCHAR(20) NULL AFTER hierarchy_level'
        );
    }

    if ($seedLevels) {
        $statement = $pdo->prepare(
            'UPDATE designations
             SET hierarchy_level = :level
             WHERE hierarchy_level = 1
               AND LOWER(name) LIKE :pattern'
        );

        foreach (DESIGNATION_LEVEL_SEEDS as [$fragment, $level]) {
            if ($level === DESIGNATION_DEFAULT_LEVEL) {
                continue;
            }

            $statement->execute([
                ':level' => $level,
                ':pattern' => '%' . $fragment . '%',
            ]);
        }
    }

    $ensured = true;
}

/** The level a request carries, clamped to the allowed band; null when it is absent or not a number. */
function settings_designation_level_from_body(array $body): ?int
{
    if (!array_key_exists('hierarchyLevel', $body)) {
        return null;
    }

    $raw = settings_text($body['hierarchyLevel'] ?? '');

    if ($raw === '' || !is_numeric($raw)) {
        return null;
    }

    return max(DESIGNATION_DEFAULT_LEVEL, min(DESIGNATION_MAX_LEVEL, (int)$raw));
}

/** "SG-11", "11" and " sg 11 " all become "11"; anything that is not a 1-33 grade becomes "". */
function settings_designation_salary_grade_from_body(array $body): string
{
    $raw = strtolower(settings_text($body['salaryGrade'] ?? ''));
    $digits = preg_replace('/[^0-9]/', '', $raw) ?? '';

    if ($digits === '') {
        return '';
    }

    $grade = (int)$digits;

    return $grade >= 1 && $grade <= 33 ? (string)$grade : '';
}

/**
 * The catalog holds positions only. A name like "Engineer IV / Chief, Mineral Land Survey Section"
 * folds a designation into it, which is what employee_designation_split_combined_titles() took apart,
 * so it is turned away with a pointer to where the designation goes instead.
 */
function settings_reject_combined_position_title(string $name): void
{
    $parts = employee_designation_split_title($name);

    if ($parts === null) {
        return;
    }

    json_response([
        'success' => false,
        'message' => sprintf(
            'Enter only the position here ("%s"). "%s" is a designation: set it on the employee record instead.',
            $parts[0],
            $parts[1]
        ),
    ], 422);
}

function ensure_user_security_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (security_schema_is_current($pdo)) {
        $ensured = true;

        return;
    }

    if (!database_column_exists($pdo, 'users', 'password_changed_at')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN password_changed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
             AFTER must_change_password'
        );
    }

    if (!database_column_exists($pdo, 'users', 'failed_login_attempts')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0
             AFTER password_changed_at'
        );
    }

    if (!database_column_exists($pdo, 'users', 'locked_until')) {
        $pdo->exec(
            'ALTER TABLE users
             ADD COLUMN locked_until DATETIME NULL DEFAULT NULL
             AFTER failed_login_attempts'
        );
    }

    $pdo->exec('UPDATE users SET password_changed_at = CURRENT_TIMESTAMP WHERE password_changed_at IS NULL');

    $ensured = true;
}

function datetime_timestamp(mixed $value): ?int
{
    $text = trim((string)($value ?? ''));

    if ($text === '') {
        return null;
    }

    $timestamp = strtotime($text);

    return $timestamp === false ? null : $timestamp;
}

function password_validity_days(): int
{
    return 60;
}

function password_has_expired(PDO $pdo, mixed $passwordChangedAt): bool
{
    $expiryDays = password_validity_days();

    if ($expiryDays <= 0) {
        return false;
    }

    $changedAt = datetime_timestamp($passwordChangedAt);

    if ($changedAt === null) {
        return false;
    }

    return $changedAt + ($expiryDays * 86400) < time();
}

require_once __DIR__ . '/audit_logs_helper.php';

/* =========================================================================================
 * The Settings endpoint itself.
 * ========================================================================================= */

function settings_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function division_code(string $name): string
{
    $code = strtoupper((string)preg_replace('/[^A-Za-z0-9]+/', '_', $name));
    $code = trim($code, '_');

    return substr($code !== '' ? $code : 'DIVISION', 0, 20);
}

function settings_organization_record_is_archived(array $row): bool
{
    return (int)($row['is_archived'] ?? $row['isArchived'] ?? 0) === 1;
}

function settings_division_record(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            id,
            name,
            description,
            code,
            is_archived
         FROM divisions
         WHERE id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $record = $statement->fetch();

    return $record ?: null;
}

function settings_designation_record(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            id,
            division_id,
            name,
            hierarchy_level,
            salary_grade,
            is_archived
         FROM designations
         WHERE id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $record = $statement->fetch();

    return $record ?: null;
}

function settings_designation_duplicate_exists(PDO $pdo, int $divisionId, string $name, int $excludeId = 0): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM designations
         WHERE division_id = :division_id
           AND LOWER(name) = LOWER(:name)
           AND id <> :exclude_id'
    );
    $statement->execute([
        ':division_id' => $divisionId,
        ':name' => $name,
        ':exclude_id' => $excludeId,
    ]);

    return (int)$statement->fetchColumn() > 0;
}

function settings_leave_type_code_base(string $value): string
{
    $code = strtoupper((string)preg_replace('/[^A-Za-z0-9]+/', '', $value));

    if ($code !== '') {
        return substr($code, 0, 20);
    }

    $words = preg_split('/\s+/', $value) ?: [];
    $code = strtoupper((string)preg_replace('/[^A-Za-z0-9]+/', '', implode('', array_map(
        static fn (string $word): string => substr($word, 0, 1),
        $words
    ))));

    return substr($code !== '' ? $code : 'LT', 0, 20);
}

function settings_unique_leave_type_code(PDO $pdo, string $name): string
{
    $baseCode = settings_leave_type_code_base($name);
    $code = $baseCode;
    $suffix = 1;

    while (true) {
        $statement = $pdo->prepare('SELECT COUNT(*) FROM leave_types WHERE code = :code');
        $statement->execute([':code' => $code]);

        if ((int)$statement->fetchColumn() === 0) {
            return $code;
        }

        $code = substr($baseCode, 0, 16) . $suffix;
        $suffix++;
    }
}

function settings_role_key(mixed $value): string
{
    $token = strtolower((string)preg_replace('/[^a-z]/i', '', (string)($value ?? '')));

    return match ($token) {
        'regionaldirector', 'regionaldir' => 'regionaldirector',
        'hrhead' => 'hrhead',
        'hrstaff' => 'hrstaff',
        'administrator', 'superadmin' => 'admin',
        default => $token,
    };
}

function settings_permission_templates(PDO $pdo): array
{
    return permission_templates($pdo);
}

/** Everyone who could be named on a payroll certification: active, unarchived employees. */
function settings_signatory_employee_options(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT
            e.id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS name,
            des.name AS position,
            e.designation,
            d.name AS division
         FROM employees e
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE e.is_archived = 0
         ORDER BY e.last_name, e.first_name'
    );

    return array_map(
        static fn (array $row): array => [
            'employeeRecordId' => (int)$row['id'],
            'name' => settings_text($row['name'] ?? ''),
            'position' => settings_text($row['position'] ?? ''),
            'designation' => settings_text($row['designation'] ?? ''),
            'division' => settings_text($row['division'] ?? ''),
        ],
        $statement->fetchAll()
    );
}

function settings_require_admin(array $sessionUser): void
{
    if (user_role_key($sessionUser) === 'admin') {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'Only administrators can update permission settings.',
    ], 403);
}

function settings_leave_types(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT
            leave_type_id AS id,
            name,
            code,
            description,
            max_days_per_year AS maxDaysPerYear,
            is_with_pay AS isWithPay,
            requires_approval AS requiresApproval,
            requires_attachment AS requiresAttachment,
            is_active AS isActive,
            created_at AS createdAt
         FROM leave_types
         ORDER BY is_active DESC, name'
    );

    return $statement->fetchAll();
}

function settings_default_system_configuration(): array
{
    // The two branding fields are shared with the login screen, which reads them through
    // system_branding() without a session; keeping one source stops the defaults drifting.
    $branding = system_branding_defaults();

    return [
        'companyName' => $branding['companyName'],
        'companyAddress' => $branding['companyAddress'],
        'uiThemeColor' => '#D61E1E',
        'systemProfile' => 'Production',
        'developedBy' => '',
        'workWeek' => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        'totalWorkHoursPerDay' => 12,
        'overtimeRules' => [
            'regularOvertimePercent' => 125,
            'restDayOvertimePercent' => 130,
            'specialHolidayOvertimePercent' => 150,
            'regularHolidayOvertimePercent' => 200,
        ],
        'undertimeRules' => [
            'enabled' => true,
            'gracePeriodMinutes' => 0,
            'deductionPerHour' => 100.00,
        ],
    ];
}

function settings_normalized_number(
    mixed $value,
    string $label,
    float|int $default,
    float|int $minimum,
    float|int $maximum,
    bool $integer,
    bool $strict,
    array &$errors
): float|int {
    if ($value === null || (is_string($value) && trim($value) === '')) {
        if ($strict) {
            $errors[] = "{$label} is required.";
        }

        return $default;
    }

    $number = $integer
        ? filter_var($value, FILTER_VALIDATE_INT)
        : filter_var($value, FILTER_VALIDATE_FLOAT);

    if ($number === false) {
        if ($strict) {
            $errors[] = "{$label} must be a valid number.";
        }

        return $default;
    }

    if ($number < $minimum || $number > $maximum) {
        if ($strict) {
            $errors[] = "{$label} must be between {$minimum} and {$maximum}.";
        }

        return $default;
    }

    return $integer ? (int)$number : round((float)$number, 2);
}

function settings_normalize_system_configuration(array $payload, bool $strict = true): array
{
    $defaults = settings_default_system_configuration();
    $errors = [];
    $allowedProfiles = ['Production', 'Staging', 'Development'];
    $allowedWorkDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    $companyName = settings_text($payload['companyName'] ?? $defaults['companyName']);
    $companyAddress = settings_text($payload['companyAddress'] ?? $defaults['companyAddress']);
    $systemProfile = settings_text($payload['systemProfile'] ?? $defaults['systemProfile']);
    $developedBy = settings_text($payload['developedBy'] ?? $defaults['developedBy']);
    $uiThemeColor = strtoupper(settings_text($payload['uiThemeColor'] ?? $defaults['uiThemeColor']));

    if (!preg_match('/^#[0-9A-F]{6}$/', $uiThemeColor)) {
        if ($strict && $uiThemeColor !== '') {
            $errors[] = 'Interface color must be a six-digit hexadecimal color.';
        }

        $uiThemeColor = $defaults['uiThemeColor'];
    }

    if ($companyName === '') {
        $errors[] = 'Company name is required.';
        $companyName = $defaults['companyName'];
    }

    if ($companyAddress === '') {
        $errors[] = 'Company address is required.';
        $companyAddress = $defaults['companyAddress'];
    }

    if (strlen($companyName) > 150) {
        $errors[] = 'Company name must be 150 characters or fewer.';
        $companyName = substr($companyName, 0, 150);
    }

    if (strlen($companyAddress) > 255) {
        $errors[] = 'Company address must be 255 characters or fewer.';
        $companyAddress = substr($companyAddress, 0, 255);
    }

    if (strlen($developedBy) > 150) {
        $errors[] = 'Developed By must be 150 characters or fewer.';
        $developedBy = substr($developedBy, 0, 150);
    }

    if (!in_array($systemProfile, $allowedProfiles, true)) {
        if ($strict) {
            $errors[] = 'System profile is invalid.';
        }

        $systemProfile = $defaults['systemProfile'];
    }

    $workWeekSource = $payload['workWeek'] ?? $defaults['workWeek'];
    $workWeek = [];

    if (is_array($workWeekSource)) {
        foreach ($workWeekSource as $day) {
            $day = settings_text($day);

            if (in_array($day, $allowedWorkDays, true) && !in_array($day, $workWeek, true)) {
                $workWeek[] = $day;
            }
        }
    } elseif ($strict) {
        $errors[] = 'Work week must be a list of weekdays.';
    }

    if ($workWeek === []) {
        if ($strict) {
            $errors[] = 'Select at least one work day.';
        }

        $workWeek = $defaults['workWeek'];
    }

    $overtimeSource = is_array($payload['overtimeRules'] ?? null)
        ? $payload['overtimeRules']
        : [];
    $undertimeSource = is_array($payload['undertimeRules'] ?? null)
        ? $payload['undertimeRules']
        : [];
    $enabled = filter_var(
        $undertimeSource['enabled'] ?? $defaults['undertimeRules']['enabled'],
        FILTER_VALIDATE_BOOLEAN,
        FILTER_NULL_ON_FAILURE
    );

    if ($enabled === null) {
        $enabled = $defaults['undertimeRules']['enabled'];
    }

    return [
        'settings' => [
            'companyName' => $companyName,
            'companyAddress' => $companyAddress,
            'uiThemeColor' => $uiThemeColor,
            'systemProfile' => $systemProfile,
            'developedBy' => $developedBy,
            'workWeek' => $workWeek,
            'totalWorkHoursPerDay' => settings_normalized_number(
                $payload['totalWorkHoursPerDay'] ?? $defaults['totalWorkHoursPerDay'],
                'Total work hours per day',
                $defaults['totalWorkHoursPerDay'],
                1,
                24,
                false,
                $strict,
                $errors
            ),
            'overtimeRules' => [
                'regularOvertimePercent' => settings_normalized_number(
                    $overtimeSource['regularOvertimePercent'] ?? $defaults['overtimeRules']['regularOvertimePercent'],
                    'Regular overtime percentage',
                    $defaults['overtimeRules']['regularOvertimePercent'],
                    0,
                    500,
                    false,
                    $strict,
                    $errors
                ),
                'restDayOvertimePercent' => settings_normalized_number(
                    $overtimeSource['restDayOvertimePercent'] ?? $defaults['overtimeRules']['restDayOvertimePercent'],
                    'Rest day overtime percentage',
                    $defaults['overtimeRules']['restDayOvertimePercent'],
                    0,
                    500,
                    false,
                    $strict,
                    $errors
                ),
                'specialHolidayOvertimePercent' => settings_normalized_number(
                    $overtimeSource['specialHolidayOvertimePercent'] ?? $defaults['overtimeRules']['specialHolidayOvertimePercent'],
                    'Special holiday overtime percentage',
                    $defaults['overtimeRules']['specialHolidayOvertimePercent'],
                    0,
                    500,
                    false,
                    $strict,
                    $errors
                ),
                'regularHolidayOvertimePercent' => settings_normalized_number(
                    $overtimeSource['regularHolidayOvertimePercent'] ?? $defaults['overtimeRules']['regularHolidayOvertimePercent'],
                    'Regular holiday overtime percentage',
                    $defaults['overtimeRules']['regularHolidayOvertimePercent'],
                    0,
                    500,
                    false,
                    $strict,
                    $errors
                ),
            ],
            'undertimeRules' => [
                'enabled' => (bool)$enabled,
                'gracePeriodMinutes' => settings_normalized_number(
                    $undertimeSource['gracePeriodMinutes'] ?? $defaults['undertimeRules']['gracePeriodMinutes'],
                    'Undertime grace period',
                    $defaults['undertimeRules']['gracePeriodMinutes'],
                    0,
                    240,
                    true,
                    $strict,
                    $errors
                ),
                'deductionPerHour' => settings_normalized_number(
                    $undertimeSource['deductionPerHour'] ?? $defaults['undertimeRules']['deductionPerHour'],
                    'Undertime deduction per hour',
                    $defaults['undertimeRules']['deductionPerHour'],
                    0,
                    999999,
                    false,
                    $strict,
                    $errors
                ),
            ],
        ],
        'errors' => $strict ? $errors : [],
    ];
}

function settings_system_configuration(PDO $pdo): array
{
    $rawConfiguration = get_application_setting($pdo, 'system_configuration', '');
    $configuration = json_decode($rawConfiguration, true);

    if (!is_array($configuration)) {
        return settings_default_system_configuration();
    }

    return settings_normalize_system_configuration($configuration, false)['settings'];
}

function settings_active_user_counts_by_role(PDO $pdo): array
{
    $counts = [];
    $statement = $pdo->query(
        'SELECT
            r.name AS role_name,
            SUM(CASE WHEN LOWER(u.status) = "active" AND COALESCE(u.is_archived, 0) = 0 THEN 1 ELSE 0 END) AS active_users
         FROM roles r
         LEFT JOIN users u ON u.role_id = r.id
         GROUP BY r.id, r.name'
    );

    foreach ($statement->fetchAll() as $row) {
        $roleKey = settings_role_key($row['role_name'] ?? '');

        if ($roleKey !== '') {
            $counts[$roleKey] = (int)($row['active_users'] ?? 0);
        }
    }

    return $counts;
}

function settings_user_permission_overrides(PDO $pdo): array
{
    $overrides = user_permission_overrides($pdo);
    $result = [];

    foreach ($overrides as $userId => $template) {
        $result[(string)$userId] = $template;
    }

    return $result;
}

function settings_permission_users(PDO $pdo): array
{
    $overrides = user_permission_overrides($pdo);

    $statement = $pdo->query(
        'SELECT
            u.id,
            u.username,
            u.email,
            e.profile_image AS profile_image,
            r.name AS role,
            u.status,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS full_name,
            d.name AS division,
            des.name AS position,
            e.designation
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE COALESCE(u.is_archived, 0) = 0
         ORDER BY r.name, full_name, u.username'
    );

    $users = [];

    foreach ($statement->fetchAll() as $row) {
        $id = (int)($row['id'] ?? 0);

        if ($id <= 0) {
            continue;
        }

        $roleKey = settings_role_key($row['role'] ?? '');
        $fullName = settings_text($row['full_name'] ?? '');

        $users[] = [
            'id' => $id,
            'username' => settings_text($row['username'] ?? ''),
            'email' => settings_text($row['email'] ?? ''),
            'fullName' => $fullName !== '' ? $fullName : settings_text($row['username'] ?? ''),
            'role' => settings_text($row['role'] ?? ''),
            'roleKey' => $roleKey,
            'status' => settings_text($row['status'] ?? ''),
            'division' => settings_text($row['division'] ?? ''),
            'position' => settings_text($row['position'] ?? ''),
            'designation' => settings_text($row['designation'] ?? ''),
            'profileImage' => settings_text($row['profile_image'] ?? ''),
            'hasOverride' => isset($overrides[$id]),
        ];
    }

    return $users;
}

function settings_audit_logs(PDO $pdo): array
{
    return fetch_audit_logs($pdo);
}

function settings_locked_account_row(array $row): array
{
    $lockedUntil = settings_text($row['lockedUntil'] ?? '');
    $lockedUntilTimestamp = datetime_timestamp($lockedUntil);

    return [
        'id' => (int)($row['id'] ?? 0),
        'username' => settings_text($row['username'] ?? ''),
        'email' => settings_text($row['email'] ?? ''),
        'role' => settings_text($row['role'] ?? ''),
        'status' => settings_text($row['status'] ?? ''),
        'employeeId' => settings_text($row['employeeId'] ?? ''),
        'employeeName' => settings_text($row['employeeName'] ?? ''),
        'division' => settings_text($row['division'] ?? ''),
        'position' => settings_text($row['position'] ?? ''),
        'failedLoginAttempts' => max(0, (int)($row['failedLoginAttempts'] ?? 0)),
        'lockedUntil' => $lockedUntil,
        'secondsRemaining' => $lockedUntilTimestamp === null ? 0 : max(0, $lockedUntilTimestamp - time()),
    ];
}

function settings_locked_accounts(PDO $pdo): array
{
    ensure_user_security_columns($pdo);

    $statement = $pdo->query(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.failed_login_attempts AS failedLoginAttempts,
            u.locked_until AS lockedUntil,
            TIMESTAMPDIFF(SECOND, NOW(), u.locked_until) AS secondsRemaining,
            r.name AS role,
            u.status AS status,
            e.employee_id AS employeeId,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS employeeName,
            d.name AS division,
            des.name AS position
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.is_archived = 0
           AND u.failed_login_attempts > 0
           AND u.locked_until IS NOT NULL
         ORDER BY u.locked_until ASC, u.failed_login_attempts DESC, u.id DESC'
    );

    return array_values(array_filter(
        array_map('settings_locked_account_row', $statement->fetchAll()),
        static fn (array $account): bool => (int)($account['secondsRemaining'] ?? 0) > 0
    ));
}

function settings_account_security_record(PDO $pdo, int $id): ?array
{
    ensure_user_security_columns($pdo);

    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.failed_login_attempts AS failedLoginAttempts,
            u.locked_until AS lockedUntil,
            0 AS secondsRemaining,
            r.name AS role,
            u.status AS status,
            e.employee_id AS employeeId,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS employeeName,
            d.name AS division,
            des.name AS position
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.id = :id
           AND u.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $record = $statement->fetch();

    return $record ? settings_locked_account_row($record) : null;
}

function settings_write_account_unlock_audit(PDO $pdo, array $sessionUser, array $targetUser): void
{
    try {
        ensure_audit_logs_table($pdo);

        $context = audit_request_context();
        $actorId = (int)($sessionUser['id'] ?? 0);
        $targetId = (int)($targetUser['id'] ?? 0);
        $actorName = settings_text($sessionUser['username'] ?? ($sessionUser['full_name'] ?? ''));
        $actorRole = settings_text($sessionUser['role'] ?? '');

        $details = [
            'targetUsername' => settings_text($targetUser['username'] ?? ''),
            'targetEmail' => settings_text($targetUser['email'] ?? ''),
            'failedLoginAttempts' => (int)($targetUser['failedLoginAttempts'] ?? 0),
            'previousLockedUntil' => settings_text($targetUser['lockedUntil'] ?? ''),
        ];

        $statement = $pdo->prepare(
            'INSERT INTO audit_logs
                (user_id, action, ip_address, location, device, browser, os, actor_id, actor_name, actor_role, category, entity_type, entity_id, summary, details_json, user_agent)
             VALUES
                (:user_id, :action, :ip_address, :location, :device, :browser, :os, :actor_id, :actor_name, :actor_role, :category, :entity_type, :entity_id, :summary, :details_json, :user_agent)'
        );

        $statement->execute([
            ':user_id' => $targetId > 0 ? $targetId : null,
            ':action' => 'account.unlocked',
            ':ip_address' => $context['ipAddress'],
            ':location' => $context['location'],
            ':device' => $context['device'],
            ':browser' => $context['browser'],
            ':os' => $context['os'],
            ':actor_id' => $actorId > 0 ? $actorId : null,
            ':actor_name' => $actorName !== '' ? $actorName : null,
            ':actor_role' => $actorRole !== '' ? $actorRole : null,
            ':category' => 'auth',
            ':entity_type' => 'user',
            ':entity_id' => $targetId > 0 ? (string)$targetId : null,
            ':summary' => 'A locked account was manually unlocked.',
            ':details_json' => audit_details_json($details, $context),
            ':user_agent' => $context['userAgent'],
        ]);
        audit_mark_entry_written();
    } catch (Throwable $exception) {
        error_log('Account unlock audit error: ' . $exception->getMessage());
    }
}

function settings_unlock_account(PDO $pdo, array $sessionUser, int $id): void
{
    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Account is required.',
        ], 422);
    }

    $targetUser = settings_account_security_record($pdo, $id);

    if ($targetUser === null) {
        json_response([
            'success' => false,
            'message' => 'Account was not found.',
        ], 404);
    }

    $statement = $pdo->prepare(
        'UPDATE users
         SET failed_login_attempts = 0,
             locked_until = NULL
         WHERE id = :id
           AND is_archived = 0'
    );
    $statement->execute([':id' => $id]);

    settings_write_account_unlock_audit($pdo, $sessionUser, $targetUser);

    list_settings($pdo);
}

/**
 * The locked-account list on its own.
 *
 * The security screen re-reads this whenever the change feed reports a lock, which can be every minute
 * or two on a busy morning. Serving it through the full settings payload would run the division,
 * designation, permission, audit and system-configuration queries every time to deliver one small
 * table, so this is the door that refresh comes through.
 */
function list_locked_accounts(PDO $pdo): void
{
    ensure_user_security_columns($pdo);

    json_response([
        'success' => true,
        'lockedAccounts' => settings_locked_accounts($pdo),
    ]);
}

function list_settings(PDO $pdo): void
{
    ensure_user_security_columns($pdo);
    ensure_two_factor_schema($pdo);
    ensure_audit_logs_table($pdo);
    ensure_organization_structure_columns($pdo);

    $loginCaptchaEnabled = get_boolean_application_setting($pdo, 'login_captcha_enabled', true);
    $payrollWorkflowOtpEnabled = get_boolean_application_setting($pdo, 'payroll_workflow_otp_enabled', true);
    $securitySettings = security_settings($pdo);
    $twoFactorSettings = two_factor_settings($pdo);

    $divisions = $pdo->query(
        'SELECT
            d.id,
            d.name,
            d.description,
            d.code,
            d.is_archived
         FROM divisions d
         ORDER BY d.is_archived ASC, d.name'
    )->fetchAll();

    $designations = $pdo->query(
        'SELECT
            des.id,
            des.name,
            des.division_id,
            des.hierarchy_level,
            des.salary_grade,
            des.is_archived,
            d.name AS division_name,
            d.is_archived AS division_is_archived
         FROM designations des
         INNER JOIN divisions d ON d.id = des.division_id
         ORDER BY d.is_archived ASC, d.name, des.is_archived ASC, des.hierarchy_level DESC, des.name'
    )->fetchAll();

    json_response([
        'success' => true,
        'divisions' => $divisions,
        'designations' => $designations,
        /*
         * array_merge() rather than [...$securitySettings]: unpacking an array with string keys is
         * PHP 8.1 and up, and this deployment runs 8.0, where it is a fatal error rather than a
         * warning. The key order is the same either way -- the captcha flag first, then the stored
         * security settings, then two-factor.
         */
        'security' => array_merge(
            [
                'loginCaptchaEnabled' => $loginCaptchaEnabled,
                'payrollWorkflowOtpEnabled' => $payrollWorkflowOtpEnabled,
            ],
            $securitySettings,
            ['twoFactor' => $twoFactorSettings]
        ),
        'permissions' => [
            'templates' => settings_permission_templates($pdo),
            'activeUserCounts' => settings_active_user_counts_by_role($pdo),
            'users' => settings_permission_users($pdo),
            'userOverrides' => settings_user_permission_overrides($pdo),
        ],
        'leaveTypes' => settings_leave_types($pdo),
        'systemConfiguration' => settings_system_configuration($pdo),
        'emailDomainPolicy' => email_domain_policy($pdo),
        'lockedAccounts' => settings_locked_accounts($pdo),
        'auditLogs' => settings_audit_logs($pdo),
        'rateLimit' => settings_rate_limit_payload($pdo),
        // Who signs the payroll register, and the employees available to fill those slots.
        'payrollSignatories' => [
            'slots' => payroll_signatories($pdo),
            'employees' => settings_signatory_employee_options($pdo),
        ],
    ]);
}

/**
 * The rate limiting section: the configuration, and the metadata the screen labels it with.
 *
 * This used to carry the live counters as well, for administrators only -- they name IP addresses
 * and the usernames people typed at the login screen, which every other signed-in user has no
 * business reading. The Active Limits panel that displayed them has been removed, so the payload is
 * now configuration alone and is harmless to everyone the section renders for.
 */
function settings_rate_limit_payload(PDO $pdo): array
{
    $fields = rate_limit_field_definitions();
    $rules = [];

    /*
     * Each rule carries the range its own fields accept rather than the client keeping a second copy
     * of them. The `api` group has a higher floor than the rest, and a form that did not know that
     * would let an administrator type a number the server then rejects.
     */
    foreach (rate_limit_rule_definitions() as $ruleKey => $definition) {
        $limits = [];

        foreach ($fields as $field => $fieldDefinition) {
            $limits[$field] = [
                'min' => rate_limit_rule_field_minimum($ruleKey, $field),
                'max' => $fieldDefinition['max'],
                'label' => $fieldDefinition['label'],
            ];
        }

        $rules[] = ['key' => $ruleKey] + $definition + ['limits' => $limits];
    }

    return [
        'settings' => rate_limit_settings($pdo, true),
        'rules' => $rules,
    ];
}

/**
 * The values the login screen needs before anyone has signed in -- whether to show the captcha, the
 * password and session limits its own validation mirrors, and the company name and address it titles
 * itself with. Formerly public_settings.php.
 *
 * Reached through `?section=public`, which the dispatcher answers ahead of require_session_user():
 * the entire point of the branch is that there is no session yet. It reads a couple of settings rows
 * and hands back the session's existing CSRF token -- it mints nothing and rotates nothing -- so the
 * login screen can poll it on a timer without disturbing a sign-in already in flight.
 */
function list_public_settings(PDO $pdo): void
{
    require_method('GET');

    $securitySettings = security_settings($pdo);

    json_response([
        'success' => true,
        'csrfToken' => csrf_token(),
        'loginCaptchaEnabled' => get_boolean_application_setting($pdo, 'login_captcha_enabled', true),
        // Company name and address from Settings > System Configuration, so the login screen can
        // title itself with whatever the administrator saved.
        'branding' => system_branding($pdo),
        'uiThemeColor' => settings_system_configuration($pdo)['uiThemeColor'],
        // The OAuth client the "Sign in with Google" button is drawn for. Empty when google-config.php
        // is absent or resolves nothing, which is what tells the login screen to draw no button at all.
        'googleClientId' => defined('GOOGLE_CLIENT_ID') ? GOOGLE_CLIENT_ID : '',
        'security' => [
            'maximumPasswordLength' => $securitySettings['maximumPasswordLength'],
            'sessionTimeoutMinutes' => $securitySettings['sessionTimeoutMinutes'],
        ],
    ]);
}

/**
 * True only when this file is the script the web server was actually asked for.
 *
 * Every other request arrives here through connection-pdo.php's require and must get the library
 * above without the endpoint below ever running.
 */
function settings_is_direct_request(): bool
{
    static $isDirect = null;

    if ($isDirect !== null) {
        return $isDirect;
    }

    $requested = realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? ''));
    $self = realpath(__FILE__);

    if ($requested === false || $self === false) {
        // Nothing to compare against -- CLI, or a server that does not set SCRIPT_FILENAME. Treat it
        // as an include, which is the answer that cannot emit a response where none was wanted.
        return $isDirect = false;
    }

    // Apache and realpath() disagree about separators and letter case on Windows, so comparing the
    // two paths as given would report a direct request as an include.
    $normalize = static function (string $path): string {
        $path = str_replace('\\', '/', $path);

        return DIRECTORY_SEPARATOR === '\\' ? strtolower($path) : $path;
    };

    return $isDirect = $normalize($requested) === $normalize($self);
}

if (!settings_is_direct_request()) {
    return;
}

require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/two_factor.php';
require_once __DIR__ . '/payroll-signatories.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$section = settings_text($_GET['section'] ?? '');

// Ahead of require_session_user(), because the login screen has no session to present.
if ($section === 'public') {
    list_public_settings($pdo);
}

$sessionUser = require_session_user();
ensure_organization_structure_columns($pdo);

if ($method === 'GET') {
    // Unrecognised sections fall through to the full payload, so an older client is never broken by this.
    if ($section === 'lockedAccounts') {
        list_locked_accounts($pdo);
    }

    list_settings($pdo);
}

$body = read_json_body();
$type = settings_text($body['type'] ?? '');

if ($method === 'POST' && $type === 'division') {
    $name = settings_text($body['name'] ?? '');
    $description = settings_text($body['description'] ?? '');
    $description = $description !== '' ? $description : null;

    if ($name === '') {
        json_response([
            'success' => false,
            'message' => 'Division name is required.',
        ], 422);
    }

    try {
        $statement = $pdo->prepare(
            'INSERT INTO divisions (name, description, code, is_archived)
             VALUES (:name, :description, :code, 0)'
        );
        $statement->execute([
            ':name' => $name,
            ':description' => $description,
            ':code' => division_code($name),
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Division already exists.',
            ], 409);
        }

        throw $exception;
    }

    list_settings($pdo);
}

if ($method === 'POST' && $type === 'designation') {
    $name = settings_text($body['name'] ?? '');
    $divisionId = (int)($body['divisionId'] ?? 0);

    if ($name === '' || $divisionId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Position title and division are required.',
        ], 422);
    }

    settings_reject_combined_position_title($name);

    $division = settings_division_record($pdo, $divisionId);

    if ($division === null) {
        json_response([
            'success' => false,
            'message' => 'Selected division was not found.',
        ], 404);
    }

    if (settings_organization_record_is_archived($division)) {
        json_response([
            'success' => false,
            'message' => 'Positions cannot be assigned to an archived division.',
        ], 409);
    }

    if (settings_designation_duplicate_exists($pdo, $divisionId, $name)) {
        json_response([
            'success' => false,
            'message' => 'Position already exists in this division.',
        ], 409);
    }

    try {
        $statement = $pdo->prepare(
            'INSERT INTO designations (division_id, name, hierarchy_level, salary_grade, is_archived)
             VALUES (:division_id, :name, :hierarchy_level, :salary_grade, 0)'
        );
        $statement->execute([
            ':division_id' => $divisionId,
            ':name' => $name,
            ':hierarchy_level' => settings_designation_level_from_body($body) ?? DESIGNATION_DEFAULT_LEVEL,
            ':salary_grade' => settings_designation_salary_grade_from_body($body) ?: null,
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Unable to create position. Check the selected division.',
            ], 409);
        }

        throw $exception;
    }

    list_settings($pdo);
}

if ($method === 'POST' && $type === 'leave_type') {
    $name = settings_text($body['name'] ?? '');
    $requestedCode = settings_text($body['code'] ?? '');

    if ($name === '') {
        json_response([
            'success' => false,
            'message' => 'Leave type name is required.',
        ], 422);
    }

    if (strlen($name) > 100) {
        json_response([
            'success' => false,
            'message' => 'Leave type name must be 100 characters or fewer.',
        ], 422);
    }

    $duplicateName = $pdo->prepare(
        'SELECT COUNT(*) FROM leave_types WHERE LOWER(name) = LOWER(:name)'
    );
    $duplicateName->execute([':name' => $name]);

    if ((int)$duplicateName->fetchColumn() > 0) {
        json_response([
            'success' => false,
            'message' => 'Leave type already exists.',
        ], 409);
    }

    if ($requestedCode !== '') {
        $code = settings_leave_type_code_base($requestedCode);
        $duplicateCode = $pdo->prepare('SELECT COUNT(*) FROM leave_types WHERE code = :code');
        $duplicateCode->execute([':code' => $code]);

        if ((int)$duplicateCode->fetchColumn() > 0) {
            json_response([
                'success' => false,
                'message' => 'Leave type code already exists.',
            ], 409);
        }
    } else {
        $code = settings_unique_leave_type_code($pdo, $name);
    }

    $statement = $pdo->prepare(
        'INSERT INTO leave_types
            (name, code, is_with_pay, requires_approval, requires_attachment, is_active)
         VALUES
            (:name, :code, 1, 1, 0, 1)'
    );
    $statement->execute([
        ':name' => $name,
        ':code' => $code,
    ]);

    list_settings($pdo);
}

if ($method === 'PUT' && $type === 'division') {
    $id = (int)($body['id'] ?? 0);
    $action = settings_text($body['action'] ?? '');
    $name = settings_text($body['name'] ?? '');
    $description = settings_text($body['description'] ?? '');
    $description = $description !== '' ? $description : null;

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Division is required.',
        ], 422);
    }

    if ($action === 'archive') {
        $division = settings_division_record($pdo, $id);

        if ($division === null) {
            json_response([
                'success' => false,
                'message' => 'Division was not found.',
            ], 404);
        }

        $statement = $pdo->prepare('UPDATE divisions SET is_archived = 1 WHERE id = :id');
        $statement->execute([':id' => $id]);

        $statement = $pdo->prepare('UPDATE designations SET is_archived = 1 WHERE division_id = :division_id');
        $statement->execute([':division_id' => $id]);

        list_settings($pdo);
    }

    if ($action === 'restore') {
        $division = settings_division_record($pdo, $id);

        if ($division === null) {
            json_response([
                'success' => false,
                'message' => 'Division was not found.',
            ], 404);
        }

        $statement = $pdo->prepare('UPDATE divisions SET is_archived = 0 WHERE id = :id');
        $statement->execute([':id' => $id]);

        list_settings($pdo);
    }

    if ($name === '') {
        json_response([
            'success' => false,
            'message' => 'Division name is required.',
        ], 422);
    }

    try {
        $statement = $pdo->prepare(
            'UPDATE divisions
             SET name = :name,
                 description = :description,
                 code = :code
             WHERE id = :id'
        );
        $statement->execute([
            ':name' => $name,
            ':description' => $description,
            ':code' => division_code($name),
            ':id' => $id,
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Division already exists.',
            ], 409);
        }

        throw $exception;
    }

    list_settings($pdo);
}

if ($method === 'PUT' && $type === 'designation') {
    $id = (int)($body['id'] ?? 0);
    $action = settings_text($body['action'] ?? '');
    $name = settings_text($body['name'] ?? '');
    $divisionId = (int)($body['divisionId'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Position is required.',
        ], 422);
    }

    if ($action === 'archive') {
        $designation = settings_designation_record($pdo, $id);

        if ($designation === null) {
            json_response([
                'success' => false,
                'message' => 'Position was not found.',
            ], 404);
        }

        $statement = $pdo->prepare(
            'UPDATE designations
             SET is_archived = 1
             WHERE id = :id'
        );
        $statement->execute([':id' => $id]);

        list_settings($pdo);
    }

    if ($action === 'restore') {
        $designation = settings_designation_record($pdo, $id);

        if ($designation === null) {
            json_response([
                'success' => false,
                'message' => 'Position was not found.',
            ], 404);
        }

        $division = settings_division_record($pdo, (int)($designation['division_id'] ?? 0));

        if ($division === null || settings_organization_record_is_archived($division)) {
            json_response([
                'success' => false,
                'message' => 'Restore the assigned division before restoring this position.',
            ], 409);
        }

        if (settings_designation_duplicate_exists(
            $pdo,
            (int)($designation['division_id'] ?? 0),
            (string)($designation['name'] ?? ''),
            $id
        )) {
            json_response([
                'success' => false,
                'message' => 'Position already exists in this division.',
            ], 409);
        }

        $statement = $pdo->prepare(
            'UPDATE designations
             SET is_archived = 0
             WHERE id = :id'
        );
        $statement->execute([':id' => $id]);

        list_settings($pdo);
    }

    if ($name === '' || $divisionId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Position title and division are required.',
        ], 422);
    }

    settings_reject_combined_position_title($name);

    $division = settings_division_record($pdo, $divisionId);

    if ($division === null) {
        json_response([
            'success' => false,
            'message' => 'Selected division was not found.',
        ], 404);
    }

    if (settings_organization_record_is_archived($division)) {
        json_response([
            'success' => false,
            'message' => 'Positions cannot be assigned to an archived division.',
        ], 409);
    }

    if (settings_designation_duplicate_exists($pdo, $divisionId, $name, $id)) {
        json_response([
            'success' => false,
            'message' => 'Position already exists in this division.',
        ], 409);
    }

    $currentDesignation = settings_designation_record($pdo, $id);
    $hierarchyLevel = settings_designation_level_from_body($body)
        ?? (int)($currentDesignation['hierarchy_level'] ?? DESIGNATION_DEFAULT_LEVEL);
    $salaryGrade = array_key_exists('salaryGrade', $body)
        ? settings_designation_salary_grade_from_body($body)
        : settings_text($currentDesignation['salary_grade'] ?? '');

    $statement = $pdo->prepare(
        'UPDATE designations
         SET name = :name,
             division_id = :division_id,
             hierarchy_level = :hierarchy_level,
             salary_grade = :salary_grade
         WHERE id = :id'
    );
    $statement->execute([
        ':name' => $name,
        ':division_id' => $divisionId,
        ':hierarchy_level' => $hierarchyLevel,
        ':salary_grade' => $salaryGrade !== '' ? $salaryGrade : null,
        ':id' => $id,
    ]);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'security') {
    if (array_key_exists('loginCaptchaEnabled', $body)) {
        store_boolean_application_setting(
            $pdo,
            'login_captcha_enabled',
            $body['loginCaptchaEnabled']
        );
    }

    if (array_key_exists('payrollWorkflowOtpEnabled', $body)) {
        store_boolean_application_setting(
            $pdo,
            'payroll_workflow_otp_enabled',
            $body['payrollWorkflowOtpEnabled']
        );
    }

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'security_policy') {
    $normalized = normalize_security_settings_payload($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    store_security_settings($pdo, $normalized['settings']);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'two_factor') {
    $normalized = normalize_two_factor_settings_payload($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    store_two_factor_settings($pdo, $normalized['settings']);

    write_auth_audit($pdo, $sessionUser, 'two_factor.settings_updated', 'Two-factor authentication settings were updated.', [
        'settings' => $normalized['settings'],
    ]);
    two_factor_notify_settings_changed($pdo, $sessionUser, $normalized['settings']);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'email_domain_policy') {
    settings_require_admin($sessionUser);

    $normalized = normalize_email_domain_policy_payload($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    store_email_domain_policy($pdo, $normalized['settings']);

    write_auth_audit($pdo, $sessionUser, 'email_domain_policy.updated', 'Email domain policy was updated.', [
        'settings' => $normalized['settings'],
    ]);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'rate_limit') {
    settings_require_admin($sessionUser);

    $normalized = rate_limit_normalize_payload($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    try {
        store_rate_limit_settings($pdo, $normalized['settings']);
    } catch (Throwable $exception) {
        error_log('Unable to save rate limit settings: ' . $exception->getMessage());

        json_response([
            'success' => false,
            'message' => 'Unable to save rate limiting settings.',
        ], 500);
    }

    write_auth_audit($pdo, $sessionUser, 'rate_limit.settings_updated', 'Rate limiting settings were updated.', [
        'settings' => $normalized['settings'],
    ]);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'unlock_account') {
    settings_unlock_account($pdo, $sessionUser, (int)($body['id'] ?? 0));
}

if (($method === 'POST' || $method === 'PUT') && $type === 'permissions') {
    settings_require_admin($sessionUser);

    $permissions = $body['permissions'] ?? null;

    if (!is_array($permissions)) {
        json_response([
            'success' => false,
            'message' => 'Permission templates are required.',
        ], 422);
    }

    try {
        store_permission_templates($pdo, $permissions);
    } catch (Throwable $exception) {
        json_response([
            'success' => false,
            'message' => 'Unable to save permission templates.',
        ], 500);
    }

    write_auth_audit($pdo, $sessionUser, 'permissions.updated', 'Permission templates were updated.', [
        'roles' => array_keys($permissions),
    ]);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'user_permissions') {
    settings_require_admin($sessionUser);

    $userId = (int)($body['userId'] ?? 0);
    $reset = !empty($body['reset']);
    $template = $body['permissions'] ?? null;

    if ($userId <= 0) {
        json_response([
            'success' => false,
            'message' => 'A valid user is required.',
        ], 422);
    }

    // Confirm the target user exists and is not archived.
    $userStatement = $pdo->prepare(
        'SELECT id FROM users WHERE id = :id AND COALESCE(is_archived, 0) = 0 LIMIT 1'
    );
    $userStatement->execute([':id' => $userId]);

    if ((int)$userStatement->fetchColumn() <= 0) {
        json_response([
            'success' => false,
            'message' => 'User was not found.',
        ], 404);
    }

    if (!$reset && !is_array($template)) {
        json_response([
            'success' => false,
            'message' => 'Permissions are required.',
        ], 422);
    }

    try {
        $overrides = user_permission_overrides($pdo);

        if ($reset) {
            unset($overrides[$userId]);
        } else {
            $overrides[$userId] = $template;
        }

        store_user_permission_overrides($pdo, $overrides);
    } catch (Throwable $exception) {
        json_response([
            'success' => false,
            'message' => 'Unable to save user permissions.',
        ], 500);
    }

    write_auth_audit(
        $pdo,
        $sessionUser,
        'permissions.user_updated',
        $reset
            ? 'User permissions were reset to the role default.'
            : 'Individual user permissions were updated.',
        ['userId' => $userId, 'reset' => $reset]
    );

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'system_configuration') {
    $normalized = settings_normalize_system_configuration($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    $encodedConfiguration = json_encode($normalized['settings'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encodedConfiguration === false) {
        json_response([
            'success' => false,
            'message' => 'Unable to encode system configuration.',
        ], 422);
    }

    store_application_setting($pdo, 'system_configuration', $encodedConfiguration);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'payroll_signatories') {
    settings_require_admin($sessionUser);

    $submitted = is_array($body['signatories'] ?? null) ? $body['signatories'] : [];
    $selection = [];

    foreach (array_keys(payroll_signatory_slots()) as $slotKey) {
        $employeeRecordId = (int)($submitted[$slotKey] ?? 0);

        // A slot may be left empty on purpose -- the office might be vacant. Only a value that
        // names an employee who is not there is worth refusing.
        if ($employeeRecordId > 0 && payroll_signatory_employee($pdo, $employeeRecordId) === null) {
            json_response([
                'success' => false,
                'message' => 'One of the selected signatories is no longer an active employee.',
            ], 422);
        }

        $selection[$slotKey] = $employeeRecordId;
    }

    payroll_signatory_store_selection($pdo, $selection);

    write_auth_audit(
        $pdo,
        $sessionUser,
        'settings.payroll_signatories_updated',
        'Payroll register signatories were updated.',
        ['signatories' => $selection]
    );

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'ui_preference') {
    settings_require_admin($sessionUser);

    $uiThemeColor = strtoupper(settings_text($body['uiThemeColor'] ?? ''));

    if (!preg_match('/^#[0-9A-F]{6}$/', $uiThemeColor)) {
        json_response([
            'success' => false,
            'message' => 'Choose a valid six-digit hexadecimal color.',
        ], 422);
    }

    $configuration = settings_system_configuration($pdo);
    $configuration['uiThemeColor'] = $uiThemeColor;
    $encodedConfiguration = json_encode($configuration, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encodedConfiguration === false) {
        json_response([
            'success' => false,
            'message' => 'Unable to save the interface preference.',
        ], 422);
    }

    store_application_setting($pdo, 'system_configuration', $encodedConfiguration);

    list_settings($pdo);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
