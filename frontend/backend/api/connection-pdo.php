<?php
declare(strict_types=1);

function hris_configure_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin !== '' && preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin) === 1) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Vary: Origin');
    }

    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CSRF-Token, X-Client-Platform, X-Client-Platform-Version');
    header('Access-Control-Expose-Headers: Content-Disposition');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Accept-CH: Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version');
    header('Content-Type: application/json; charset=utf-8');
}

hris_configure_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

session_name('HRISSESSID');

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

require_once __DIR__ . '/smtp-config.php';

$servername = '127.0.0.1';
$dbusername = 'root';
$dbpassword = '';
$dbname = 'hris';

try {
    $pdo = new PDO(
        "mysql:host={$servername};charset=utf8mb4",
        $dbusername,
        $dbpassword,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
    $pdo->exec(
        "CREATE DATABASE IF NOT EXISTS `{$dbname}`
         CHARACTER SET utf8mb4
         COLLATE utf8mb4_unicode_ci"
    );
    $pdo->exec("USE `{$dbname}`");
    $conn = $pdo;
} catch (PDOException $exception) {
    error_log('Database connection failed: ' . $exception->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Database connection failed.',
    ]);
    exit;
}

require_once __DIR__ . '/app_settings.php';

function json_response(array $payload, int $status = 200): void
{
    /*
     * A single malformed byte anywhere in the payload — a name imported from a latin1 source, say —
     * used to make json_encode() return false, and `echo false` sends an empty body with a 200
     * status. The client then sees a successful request whose `success` flag is missing and reports
     * a generic failure with nothing to debug. Substituting invalid UTF-8 keeps the response usable;
     * anything else that fails to encode becomes a real 500 that says so.
     */
    $json = json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE);

    if ($json === false) {
        error_log('json_response() could not encode the payload: ' . json_last_error_msg());
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'The server could not encode its response.',
        ]);
        exit;
    }

    http_response_code($status);
    echo $json;
    exit;
}

function read_json_body(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $data = json_decode($rawBody, true);

    return is_array($data) ? $data : [];
}

function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== strtoupper($method)) {
        json_response([
            'success' => false,
            'message' => 'Method not allowed.',
        ], 405);
    }
}

function hris_csrf_token(): string
{
    if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token']) || $_SESSION['csrf_token'] === '') {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function hris_verify_csrf_token(): void
{
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        hris_csrf_token();
        return;
    }

    $providedToken = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    $sessionToken = hris_csrf_token();

    if ($providedToken === '' || !hash_equals($sessionToken, $providedToken)) {
        json_response([
            'success' => false,
            'message' => 'Security token expired. Refresh the page and try again.',
        ], 419);
    }
}

hris_verify_csrf_token();

function session_user(): ?array
{
    return isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null;
}

function hris_destroy_session(): void
{
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'] ?? '/',
            $params['domain'] ?? '',
            (bool)($params['secure'] ?? false),
            (bool)($params['httponly'] ?? true)
        );
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
}

function hris_trimmed_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function hris_full_name_from_row(array $row): string
{
    $firstName = hris_trimmed_text($row['first_name'] ?? '');
    $middleName = hris_trimmed_text($row['middle_name'] ?? '');
    $lastName = hris_trimmed_text($row['last_name'] ?? '');
    $fullName = trim(implode(' ', array_filter([$firstName, $middleName, $lastName])));

    if ($fullName !== '') {
        return $fullName;
    }

    return hris_trimmed_text($row['full_name'] ?? '');
}

function hris_find_employee_for_user(PDO $pdo, array $user): ?array
{
    $username = hris_trimmed_text($user['username'] ?? '');
    $email = hris_trimmed_text($user['email'] ?? '');
    $employeeId = hris_trimmed_text($user['employee_id'] ?? '');
    $fullName = hris_full_name_from_row($user);

    $candidates = [];
    $addCandidate = static function (string $type, string $value) use (&$candidates): void {
        $value = trim($value);
        if ($value === '') {
            return;
        }

        $key = $type . '|' . strtolower($value);
        if (isset($candidates[$key])) {
            return;
        }

        $candidates[$key] = [
            'type' => $type,
            'value' => $value,
        ];
    };

    $addCandidate('email', $email);
    if ($username !== '' && filter_var($username, FILTER_VALIDATE_EMAIL) !== false) {
        $addCandidate('email', $username);
    }

    $addCandidate('employee_id', $employeeId);
    $addCandidate('employee_id', $username);
    $addCandidate('full_name', $fullName);
    $addCandidate('full_name', $username);

    foreach ($candidates as $candidate) {
        $field = $candidate['type'];
        $value = $candidate['value'];

        $statement = match ($field) {
            'email' => $pdo->prepare(
                'SELECT
                    e.id AS linked_employee_record_id,
                    e.employee_id,
                    e.first_name,
                    e.middle_name,
                    e.last_name,
                    e.profile_image,
                    d.name AS division,
                    des.name AS designation
                 FROM employees e
                 LEFT JOIN divisions d ON d.id = e.division_id
                 LEFT JOIN designations des ON des.id = e.designation_id
                 WHERE e.email COLLATE utf8mb4_unicode_ci = :value
                   AND e.is_archived = 0
                 LIMIT 1'
            ),
            'employee_id' => $pdo->prepare(
                'SELECT
                    e.id AS linked_employee_record_id,
                    e.employee_id,
                    e.first_name,
                    e.middle_name,
                    e.last_name,
                    e.profile_image,
                    d.name AS division,
                    des.name AS designation
                 FROM employees e
                 LEFT JOIN divisions d ON d.id = e.division_id
                 LEFT JOIN designations des ON des.id = e.designation_id
                 WHERE e.employee_id COLLATE utf8mb4_unicode_ci = :value
                   AND e.is_archived = 0
                 LIMIT 1'
            ),
            default => $pdo->prepare(
                'SELECT
                    e.id AS linked_employee_record_id,
                    e.employee_id,
                    e.first_name,
                    e.middle_name,
                    e.last_name,
                    e.profile_image,
                    d.name AS division,
                    des.name AS designation
                 FROM employees e
                 LEFT JOIN divisions d ON d.id = e.division_id
                 LEFT JOIN designations des ON des.id = e.designation_id
                 WHERE TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) COLLATE utf8mb4_unicode_ci = :value
                   AND e.is_archived = 0
                 LIMIT 1'
            ),
        };

        $statement->execute([':value' => $value]);
        $employee = $statement->fetch();

        if ($employee) {
            return $employee;
        }
    }

    return null;
}

function hris_enrich_user_with_employee(PDO $pdo, array $user): array
{
    $employee = hris_find_employee_for_user($pdo, $user);

    if ($employee === null) {
        return $user;
    }

    return array_merge($user, [
        'linked_employee_record_id' => (int)($employee['linked_employee_record_id'] ?? 0),
        'employee_id' => $employee['employee_id'] ?? ($user['employee_id'] ?? null),
        'first_name' => $employee['first_name'] ?? ($user['first_name'] ?? null),
        'middle_name' => $employee['middle_name'] ?? ($user['middle_name'] ?? null),
        'last_name' => $employee['last_name'] ?? ($user['last_name'] ?? null),
        'profile_image' => $employee['profile_image'] ?? ($user['profile_image'] ?? null),
        'division' => $employee['division'] ?? ($user['division'] ?? null),
        'designation' => $employee['designation'] ?? ($user['designation'] ?? null),
    ]);
}

function session_user_record(PDO $pdo, int $id): ?array
{
    hris_ensure_two_factor_tables($pdo);
    hris_ensure_email_verification_columns($pdo);

    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.email_verified_at,
            u.email_updated_at,
            u.must_change_password,
            u.two_factor_enabled,
            r.name AS role,
            s.name AS status,
            e.employee_id,
            e.first_name,
            e.middle_name,
            e.last_name,
            e.profile_image,
            d.name AS division,
            des.name AS designation
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN status s ON s.id = u.status_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.id = :id
           AND u.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $user = $statement->fetch();

    if (!$user) {
        return null;
    }

    return hris_enrich_user_with_employee($pdo, $user);
}

function refresh_session_user(array $user): ?array
{
    global $pdo;

    $userId = (int)($user['id'] ?? 0);
    if ($userId <= 0 || !($pdo instanceof PDO)) {
        return $user;
    }

    $freshUser = session_user_record($pdo, $userId);
    if ($freshUser === null) {
        return null;
    }

    return format_user($freshUser);
}

/**
 * `$extendSession` exists for endpoints the client polls on a timer. Those requests are the browser
 * talking, not the user, so counting them as activity would keep every session alive indefinitely.
 * The expiry check itself always runs — an idle session still expires and still 401s.
 */
function require_session_user(bool $extendSession = true): array
{
    global $pdo;

    $user = session_user();

    if ($user === null) {
        json_response([
            'success' => false,
            'message' => 'You need to sign in first.',
        ], 401);
    }

    // Optional global throttle for signed-in traffic. The guard exempts settings.php and
    // rate_limit.php so an administrator can always switch it back off.
    require_once __DIR__ . '/rate-limit-utils.php';
    hris_rate_limit_guard($pdo, 'api');

    $timeoutMinutes = hris_security_settings($pdo)['sessionTimeoutMinutes'] ?? 30;
    $timeoutSeconds = max(1, (int)$timeoutMinutes) * 60;
    $lastActivityAt = (int)($_SESSION['last_activity_at'] ?? 0);

    if ($lastActivityAt > 0 && (time() - $lastActivityAt) > $timeoutSeconds) {
        hris_destroy_session();
        json_response([
            'success' => false,
            'message' => 'Your session expired due to inactivity. Please sign in again.',
        ], 401);
    }

    if ($extendSession) {
        $_SESSION['last_activity_at'] = time();
    }

    $refreshedUser = refresh_session_user($user);

    if ($refreshedUser === null) {
        hris_destroy_session();
        json_response([
            'success' => false,
            'message' => 'Your session is no longer valid. Please sign in again.',
        ], 401);
    }

    $_SESSION['user'] = $refreshedUser;

    return $refreshedUser;
}

function hris_normalize_token(mixed $value): string
{
    return preg_replace('/[^a-z]/', '', strtolower((string)($value ?? '')));
}

function hris_normalize_role(mixed $value): string
{
    $token = hris_normalize_token($value);

    return match ($token) {
        'admin', 'administrator', 'superadmin' => 'admin',
        'regionaldirector', 'regionaldir' => 'regionaldirector',
        'hrhead' => 'hrhead',
        'hrstaff' => 'hrstaff',
        'chief' => 'chief',
        'employee' => 'employee',
        default => $token,
    };
}

function hris_user_role_key(array $user): string
{
    return hris_normalize_role($user['roleKey'] ?? $user['role'] ?? '');
}

function hris_session_employee_record_id(PDO $pdo, array $user): ?int
{
    $linkedEmployeeId = (int)($user['linked_employee_record_id'] ?? 0);
    if ($linkedEmployeeId > 0) {
        return $linkedEmployeeId;
    }

    $employeeCode = hris_trimmed_text($user['employee_id'] ?? '');
    $employeeName = hris_trimmed_text($user['full_name'] ?? '');
    $username = hris_trimmed_text($user['username'] ?? '');
    $email = hris_trimmed_text($user['email'] ?? '');

    if ($employeeCode !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $employeeCode]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($email !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE email COLLATE utf8mb4_unicode_ci = :email AND is_archived = 0 LIMIT 1');
        $statement->execute([':email' => $email]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($username !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id COLLATE utf8mb4_unicode_ci = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $username]);
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

    if ($username !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) COLLATE utf8mb4_unicode_ci = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $username]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    return null;
}

function format_user(array $user): array
{
    global $pdo;

    $firstName = trim((string)($user['first_name'] ?? ''));
    $middleName = trim((string)($user['middle_name'] ?? ''));
    $lastName = trim((string)($user['last_name'] ?? ''));
    $fullName = trim(implode(' ', array_filter([$firstName, $middleName, $lastName])));
    $role = $user['role'] ?? 'User';
    $roleKey = hris_normalize_role($role);
    // A custom role has no dashboard of its own, so the client routes it by the
    // built-in role it was based on. Built-in roles resolve to themselves.
    $baseRoleKey = $roleKey;
    $permissions = [];

    if ($pdo instanceof PDO && function_exists('hris_role_base_key')) {
        try {
            $baseRoleKey = hris_role_base_key($pdo, $roleKey) ?: $roleKey;
        } catch (Throwable $exception) {
            error_log('Unable to resolve base role: ' . $exception->getMessage());
        }
    }

    if ($pdo instanceof PDO && function_exists('hris_permissions_for_user')) {
        try {
            $permissions = hris_permissions_for_user($pdo, (int)($user['id'] ?? 0), $roleKey);
        } catch (Throwable $exception) {
            error_log('Unable to load user permissions: ' . $exception->getMessage());
        }
    } elseif ($pdo instanceof PDO && function_exists('hris_permissions_for_role_key')) {
        try {
            $permissions = hris_permissions_for_role_key($pdo, $roleKey);
        } catch (Throwable $exception) {
            error_log('Unable to load user permissions: ' . $exception->getMessage());
        }
    }

    return [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'email_verified_at' => $user['email_verified_at'] ?? null,
        'emailVerifiedAt' => $user['email_verified_at'] ?? null,
        'email_updated_at' => $user['email_updated_at'] ?? null,
        'emailUpdatedAt' => $user['email_updated_at'] ?? null,
        'isEmailVerified' => !empty($user['email_verified_at']),
        'role' => $role,
        'roleKey' => $roleKey,
        'baseRoleKey' => $baseRoleKey,
        'status' => $user['status'] ?? 'Unknown',
        'permissions' => $permissions,
        'employee_id' => $user['employee_id'] ?? null,
        'full_name' => $fullName !== '' ? $fullName : null,
        'division' => $user['division'] ?? null,
        'designation' => $user['designation'] ?? null,
        'profile_image' => $user['profile_image'] ?? null,
        'must_change_password' => (bool)($user['must_change_password'] ?? false),
        'two_factor_enabled' => (bool)($user['two_factor_enabled'] ?? false),
        'twoFactorEnabled' => (bool)($user['two_factor_enabled'] ?? false),
    ];
}

function write_auth_audit(PDO $pdo, ?array $user, string $action, string $summary, array $details = []): void
{
    try {
        hris_ensure_audit_logs_table($pdo);

        $context = hris_audit_request_context();
        $userId = isset($user['id']) ? (int)$user['id'] : null;

        $statement = $pdo->prepare(
            'INSERT INTO audit_logs
                (user_id, action, ip_address, location, device, browser, os, actor_id, actor_name, actor_role, category, entity_type, entity_id, summary, details_json, user_agent)
             VALUES
                (:user_id, :action, :ip_address, :location, :device, :browser, :os, :actor_id, :actor_name, :actor_role, :category, :entity_type, :entity_id, :summary, :details_json, :user_agent)'
        );

        $statement->execute([
            ':user_id' => $userId,
            ':actor_name' => $user['username'] ?? null,
            ':actor_role' => $user['role'] ?? null,
            ':actor_id' => $userId,
            ':category' => 'auth',
            ':action' => $action,
            ':entity_type' => $user ? 'user' : 'login_identifier',
            ':entity_id' => $user['id'] ?? ($details['identifier'] ?? null),
            ':summary' => $summary,
            ':details_json' => hris_audit_details_json($details, $context),
            ':ip_address' => $context['ipAddress'],
            ':location' => $context['location'],
            ':device' => $context['device'],
            ':browser' => $context['browser'],
            ':os' => $context['os'],
            ':user_agent' => $context['userAgent'],
        ]);
    } catch (Throwable $exception) {
        // Login should not fail just because the optional audit write failed.
    }
}

function hris_database_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );
    $statement->execute([':table_name' => $table]);

    return (int)$statement->fetchColumn() > 0;
}

function hris_normalize_notification_type(string $type): string
{
    $normalized = preg_replace('/[^a-z0-9]+/i', '_', strtolower(trim($type))) ?? '';
    return trim($normalized, '_');
}

function hris_notification_type_label(string $type): string
{
    return match (hris_normalize_notification_type($type)) {
        'user_created' => 'User Created',
        'employee_added' => 'Employee Added',
        'leave_request_submitted' => 'Leave Request Submitted',
        'leave_request_approved' => 'Leave Request Approved',
        'leave_request_rejected' => 'Leave Request Rejected',
        'payroll_generated' => 'Payroll Generated',
        'attendance_updated' => 'Attendance Updated',
        'account_activated' => 'Account Activated',
        'account_deactivated' => 'Account Deactivated',
        'role_updated' => 'Role Updated',
        'permission_updated' => 'Permission Updated',
        'access_request' => 'Access Requested',
        'access_granted' => 'Access Granted',
        'system_alert' => 'System Alert',
        'custom' => 'Custom Notification',
        default => ucwords(str_replace('_', ' ', hris_normalize_notification_type($type))),
    };
}

function hris_ensure_notifications_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS notifications (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            title VARCHAR(180) NOT NULL,
            message TEXT NOT NULL,
            type VARCHAR(80) NOT NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            reference_id VARCHAR(120) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_notifications_user_id (user_id),
            KEY idx_notifications_user_read (user_id, is_read),
            KEY idx_notifications_type (type),
            KEY idx_notifications_created_at (created_at),
            CONSTRAINT fk_notifications_user_id
                FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $ensured = true;
}

function hris_user_ids_for_role_keys(PDO $pdo, array $roleKeys): array
{
    $normalizedRoleKeys = array_values(array_unique(array_filter(array_map(static fn ($roleKey): string => hris_normalize_role($roleKey), $roleKeys))));

    if ($normalizedRoleKeys === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($normalizedRoleKeys), '?'));
    $statement = $pdo->prepare(
        'SELECT DISTINCT u.id
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE u.is_archived = 0
           AND LOWER(REPLACE(r.name, " ", "")) IN (' . $placeholders . ')
         ORDER BY u.id ASC'
    );
    $statement->execute($normalizedRoleKeys);

    return array_map('intval', array_column($statement->fetchAll(), 'id'));
}

function hris_user_id_for_employee_record(PDO $pdo, int $employeeRecordId): ?int
{
    if ($employeeRecordId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT u.id
         FROM users u
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE e.id = :employee_id
           AND u.is_archived = 0
         ORDER BY u.id DESC
         LIMIT 1'
    );
    $statement->execute([':employee_id' => $employeeRecordId]);

    $userId = (int)$statement->fetchColumn();

    return $userId > 0 ? $userId : null;
}

function hris_notification_insert(PDO $pdo, int $userId, string $title, string $message, string $type, ?string $referenceId = null): ?int
{
    hris_ensure_notifications_table($pdo);

    $userId = (int)$userId;
    $title = trim($title);
    $message = trim($message);
    $type = hris_normalize_notification_type($type);
    $referenceId = trim((string)($referenceId ?? ''));

    if ($userId <= 0 || $title === '' || $message === '' || $type === '') {
        return null;
    }

    $duplicateStatement = $pdo->prepare(
        'SELECT id
         FROM notifications
         WHERE user_id = :user_id
           AND type = :type
           AND title = :title
           AND message = :message
           AND COALESCE(reference_id, "") = :reference_id
           AND created_at >= (NOW() - INTERVAL 5 MINUTE)
         ORDER BY id DESC
         LIMIT 1'
    );
    $duplicateStatement->execute([
        ':user_id' => $userId,
        ':type' => $type,
        ':title' => $title,
        ':message' => $message,
        ':reference_id' => $referenceId,
    ]);

    $existingId = (int)$duplicateStatement->fetchColumn();
    if ($existingId > 0) {
        return $existingId;
    }

    $statement = $pdo->prepare(
        'INSERT INTO notifications
            (user_id, title, message, type, is_read, reference_id)
         VALUES
            (:user_id, :title, :message, :type, 0, :reference_id)'
    );
    $statement->execute([
        ':user_id' => $userId,
        ':title' => $title,
        ':message' => $message,
        ':type' => $type,
        ':reference_id' => $referenceId !== '' ? $referenceId : null,
    ]);

    return (int)$pdo->lastInsertId();
}

function hris_notify_users(PDO $pdo, array $userIds, string $title, string $message, string $type, ?string $referenceId = null): int
{
    $uniqueUserIds = [];

    foreach ($userIds as $userId) {
        $userId = (int)$userId;
        if ($userId > 0) {
            $uniqueUserIds[$userId] = true;
        }
    }

    $createdCount = 0;

    foreach (array_keys($uniqueUserIds) as $userId) {
        if (hris_notification_insert($pdo, $userId, $title, $message, $type, $referenceId) !== null) {
            $createdCount++;
        }
    }

    return $createdCount;
}

function hris_notify_roles(PDO $pdo, array $roleKeys, string $title, string $message, string $type, ?string $referenceId = null): int
{
    return hris_notify_users(
        $pdo,
        hris_user_ids_for_role_keys($pdo, $roleKeys),
        $title,
        $message,
        $type,
        $referenceId
    );
}

function hris_notify_employee(PDO $pdo, int $employeeRecordId, string $title, string $message, string $type, ?string $referenceId = null): int
{
    $userId = hris_user_id_for_employee_record($pdo, $employeeRecordId);

    if ($userId === null) {
        return 0;
    }

    return hris_notify_users($pdo, [$userId], $title, $message, $type, $referenceId);
}
