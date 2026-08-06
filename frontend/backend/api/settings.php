<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/app_settings.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/two-factor-utils.php';

$sessionUser = require_session_user();
hris_ensure_organization_structure_columns($pdo);

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
    return hris_permission_templates($pdo);
}

function settings_require_admin(array $sessionUser): void
{
    if (hris_user_role_key($sessionUser) === 'admin') {
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
    return [
        'companyName' => 'Human Resources Information System',
        'companyAddress' => 'Mines Geosciences Bureau, DENR Region X',
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
    $rawConfiguration = hris_get_application_setting($pdo, 'system_configuration', '');
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
            SUM(CASE WHEN LOWER(s.name) = "active" AND COALESCE(u.is_archived, 0) = 0 THEN 1 ELSE 0 END) AS active_users
         FROM roles r
         LEFT JOIN users u ON u.role_id = r.id
         LEFT JOIN status s ON s.id = u.status_id
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
    $overrides = hris_user_permission_overrides($pdo);
    $result = [];

    foreach ($overrides as $userId => $template) {
        $result[(string)$userId] = $template;
    }

    return $result;
}

function settings_permission_users(PDO $pdo): array
{
    $overrides = hris_user_permission_overrides($pdo);

    $statement = $pdo->query(
        'SELECT
            u.id,
            u.username,
            u.email,
            e.profile_image AS profile_image,
            r.name AS role,
            s.name AS status,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS full_name,
            d.name AS division,
            des.name AS designation
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN status s ON s.id = u.status_id
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
            'designation' => settings_text($row['designation'] ?? ''),
            'profileImage' => settings_text($row['profile_image'] ?? ''),
            'hasOverride' => isset($overrides[$id]),
        ];
    }

    return $users;
}

function settings_audit_logs(PDO $pdo): array
{
    return hris_fetch_audit_logs($pdo);
}

function settings_locked_account_row(array $row): array
{
    $lockedUntil = settings_text($row['lockedUntil'] ?? '');
    $lockedUntilTimestamp = hris_datetime_timestamp($lockedUntil);

    return [
        'id' => (int)($row['id'] ?? 0),
        'username' => settings_text($row['username'] ?? ''),
        'email' => settings_text($row['email'] ?? ''),
        'role' => settings_text($row['role'] ?? ''),
        'status' => settings_text($row['status'] ?? ''),
        'employeeId' => settings_text($row['employeeId'] ?? ''),
        'employeeName' => settings_text($row['employeeName'] ?? ''),
        'division' => settings_text($row['division'] ?? ''),
        'designation' => settings_text($row['designation'] ?? ''),
        'failedLoginAttempts' => max(0, (int)($row['failedLoginAttempts'] ?? 0)),
        'lockedUntil' => $lockedUntil,
        'secondsRemaining' => $lockedUntilTimestamp === null ? 0 : max(0, $lockedUntilTimestamp - time()),
    ];
}

function settings_locked_accounts(PDO $pdo): array
{
    hris_ensure_user_security_columns($pdo);

    $statement = $pdo->query(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.failed_login_attempts AS failedLoginAttempts,
            u.locked_until AS lockedUntil,
            TIMESTAMPDIFF(SECOND, NOW(), u.locked_until) AS secondsRemaining,
            r.name AS role,
            s.name AS status,
            e.employee_id AS employeeId,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS employeeName,
            d.name AS division,
            des.name AS designation
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN status s ON s.id = u.status_id
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
    hris_ensure_user_security_columns($pdo);

    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.failed_login_attempts AS failedLoginAttempts,
            u.locked_until AS lockedUntil,
            0 AS secondsRemaining,
            r.name AS role,
            s.name AS status,
            e.employee_id AS employeeId,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS employeeName,
            d.name AS division,
            des.name AS designation
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN status s ON s.id = u.status_id
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
        hris_ensure_audit_logs_table($pdo);

        $context = hris_audit_request_context();
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
            ':details_json' => hris_audit_details_json($details, $context),
            ':user_agent' => $context['userAgent'],
        ]);
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

function list_settings(PDO $pdo): void
{
    hris_ensure_user_security_columns($pdo);
    hris_ensure_two_factor_schema($pdo);
    hris_ensure_audit_logs_table($pdo);
    hris_ensure_organization_structure_columns($pdo);

    $loginCaptchaEnabled = hris_get_boolean_application_setting($pdo, 'login_captcha_enabled', true);
    $securitySettings = hris_security_settings($pdo);
    $twoFactorSettings = hris_two_factor_settings($pdo);

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
            des.is_archived,
            d.name AS division_name,
            d.is_archived AS division_is_archived
         FROM designations des
         INNER JOIN divisions d ON d.id = des.division_id
         ORDER BY d.is_archived ASC, d.name, des.is_archived ASC, des.name'
    )->fetchAll();

    json_response([
        'success' => true,
        'divisions' => $divisions,
        'designations' => $designations,
        'security' => [
            'loginCaptchaEnabled' => $loginCaptchaEnabled,
            ...$securitySettings,
            'twoFactor' => $twoFactorSettings,
        ],
        'permissions' => [
            'templates' => settings_permission_templates($pdo),
            'activeUserCounts' => settings_active_user_counts_by_role($pdo),
            'users' => settings_permission_users($pdo),
            'userOverrides' => settings_user_permission_overrides($pdo),
        ],
        'leaveTypes' => settings_leave_types($pdo),
        'systemConfiguration' => settings_system_configuration($pdo),
        'emailDomainPolicy' => hris_email_domain_policy($pdo),
        'lockedAccounts' => settings_locked_accounts($pdo),
        'auditLogs' => settings_audit_logs($pdo),
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
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
            'message' => 'Designation name and division are required.',
        ], 422);
    }

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
            'message' => 'Designations cannot be assigned to an archived division.',
        ], 409);
    }

    if (settings_designation_duplicate_exists($pdo, $divisionId, $name)) {
        json_response([
            'success' => false,
            'message' => 'Designation already exists in this division.',
        ], 409);
    }

    try {
        $statement = $pdo->prepare(
            'INSERT INTO designations (division_id, name, is_archived)
             VALUES (:division_id, :name, 0)'
        );
        $statement->execute([
            ':division_id' => $divisionId,
            ':name' => $name,
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Unable to create designation. Check the selected division.',
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
            'message' => 'Designation is required.',
        ], 422);
    }

    if ($action === 'archive') {
        $designation = settings_designation_record($pdo, $id);

        if ($designation === null) {
            json_response([
                'success' => false,
                'message' => 'Designation was not found.',
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
                'message' => 'Designation was not found.',
            ], 404);
        }

        $division = settings_division_record($pdo, (int)($designation['division_id'] ?? 0));

        if ($division === null || settings_organization_record_is_archived($division)) {
            json_response([
                'success' => false,
                'message' => 'Restore the assigned division before restoring this designation.',
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
                'message' => 'Designation already exists in this division.',
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
            'message' => 'Designation name and division are required.',
        ], 422);
    }

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
            'message' => 'Designations cannot be assigned to an archived division.',
        ], 409);
    }

    if (settings_designation_duplicate_exists($pdo, $divisionId, $name, $id)) {
        json_response([
            'success' => false,
            'message' => 'Designation already exists in this division.',
        ], 409);
    }

    $statement = $pdo->prepare(
        'UPDATE designations
         SET name = :name, division_id = :division_id
         WHERE id = :id'
    );
    $statement->execute([
        ':name' => $name,
        ':division_id' => $divisionId,
        ':id' => $id,
    ]);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'security') {
    hris_store_boolean_application_setting(
        $pdo,
        'login_captcha_enabled',
        $body['loginCaptchaEnabled'] ?? true
    );

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'security_policy') {
    $normalized = hris_normalize_security_settings_payload($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    hris_store_security_settings($pdo, $normalized['settings']);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'two_factor') {
    $normalized = hris_normalize_two_factor_settings_payload($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    hris_store_two_factor_settings($pdo, $normalized['settings']);

    write_auth_audit($pdo, $sessionUser, 'two_factor.settings_updated', 'Two-factor authentication settings were updated.', [
        'settings' => $normalized['settings'],
    ]);
    hris_two_factor_notify_settings_changed($pdo, $sessionUser, $normalized['settings']);

    list_settings($pdo);
}

if (($method === 'POST' || $method === 'PUT') && $type === 'email_domain_policy') {
    settings_require_admin($sessionUser);

    $normalized = hris_normalize_email_domain_policy_payload($body);

    if ($normalized['errors'] !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $normalized['errors']),
        ], 422);
    }

    hris_store_email_domain_policy($pdo, $normalized['settings']);

    write_auth_audit($pdo, $sessionUser, 'email_domain_policy.updated', 'Email domain policy was updated.', [
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
        hris_store_permission_templates($pdo, $permissions);
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
        $overrides = hris_user_permission_overrides($pdo);

        if ($reset) {
            unset($overrides[$userId]);
        } else {
            $overrides[$userId] = $template;
        }

        hris_store_user_permission_overrides($pdo, $overrides);
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

    hris_store_application_setting($pdo, 'system_configuration', $encodedConfiguration);

    list_settings($pdo);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
