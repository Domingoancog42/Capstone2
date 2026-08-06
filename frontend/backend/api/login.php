<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/two-factor-utils.php';

require_method('POST');

$body = read_json_body();
$identifier = trim((string)($body['username'] ?? ''));
$password = (string)($body['password'] ?? '');

if ($identifier === '' || $password === '') {
    json_response([
        'success' => false,
        'message' => 'Username and password are required.',
    ], 422);
}

hris_ensure_user_security_columns($pdo);
hris_ensure_two_factor_schema($pdo);
hris_ensure_email_verification_columns($pdo);

function login_locked_until_message(mixed $lockedUntil): string
{
    $timestamp = hris_datetime_timestamp($lockedUntil);

    if ($timestamp === null) {
        return 'This account is temporarily locked due to repeated failed sign-in attempts.';
    }

    return 'This account is locked until ' . date('M j, Y g:i A', $timestamp) . ' due to repeated failed sign-in attempts.';
}

function login_record_failed_attempt(PDO $pdo, array $user): void
{
    $settings = hris_security_settings($pdo);
    $userId = (int)($user['id'] ?? 0);
    $currentAttempts = max(0, (int)($user['failed_login_attempts'] ?? 0));
    $nextAttempts = $currentAttempts + 1;

    if ($userId <= 0) {
        return;
    }

    if ($nextAttempts >= $settings['lockoutFailedAttempts']) {
        $lockedUntil = date('Y-m-d H:i:s', time() + ($settings['lockoutDurationMinutes'] * 60));
        $statement = $pdo->prepare(
            'UPDATE users
             SET failed_login_attempts = :failed_login_attempts,
                 locked_until = :locked_until
             WHERE id = :id'
        );
        $statement->execute([
            ':failed_login_attempts' => $nextAttempts,
            ':locked_until' => $lockedUntil,
            ':id' => $userId,
        ]);

        write_auth_audit($pdo, $user, 'login.locked', 'An account was temporarily locked after too many failed login attempts.', [
            'username' => $user['username'] ?? null,
            'email' => $user['email'] ?? null,
            'failedLoginAttempts' => $nextAttempts,
            'lockedUntil' => $lockedUntil,
        ]);

        try {
            hris_notify_roles(
                $pdo,
                ['admin'],
                'Account Locked',
                sprintf(
                    '%s was temporarily locked after %d failed login attempts.',
                    (string)($user['username'] ?? $user['email'] ?? 'An account'),
                    $nextAttempts
                ),
                'account_locked',
                (string)$userId
            );
        } catch (Throwable $exception) {
            error_log('Account lock notification error: ' . $exception->getMessage());
        }

        return;
    }

    $statement = $pdo->prepare(
        'UPDATE users
         SET failed_login_attempts = :failed_login_attempts,
             locked_until = NULL
         WHERE id = :id'
    );
    $statement->execute([
        ':failed_login_attempts' => $nextAttempts,
        ':id' => $userId,
    ]);
}

function login_clear_failed_attempts(PDO $pdo, int $userId): void
{
    if ($userId <= 0) {
        return;
    }

    $statement = $pdo->prepare(
        'UPDATE users
         SET failed_login_attempts = 0,
             locked_until = NULL
         WHERE id = :id'
    );
    $statement->execute([':id' => $userId]);
}

$statement = $pdo->prepare(
    'SELECT
        u.id,
        u.username,
        u.email,
        u.email_verified_at,
        u.email_updated_at,
        u.password_hash,
        u.must_change_password,
        u.password_changed_at,
        u.failed_login_attempts,
        u.locked_until,
        u.two_factor_enabled,
        u.is_archived,
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
     WHERE (u.username = :username_identifier OR u.email = :email_identifier)
     LIMIT 1'
);
$statement->execute([
    ':username_identifier' => $identifier,
    ':email_identifier' => $identifier,
]);
$user = $statement->fetch();

if ($user) {
    $user = hris_enrich_user_with_employee($pdo, $user);
}

if (!$user) {
    write_auth_audit($pdo, null, 'login.failed', 'A login attempt failed for an unknown account.', [
        'identifier' => $identifier,
    ]);

    json_response([
        'success' => false,
        'message' => 'Invalid username or password.',
    ], 401);
}

$lockedUntilTimestamp = hris_datetime_timestamp($user['locked_until'] ?? null);

if ($lockedUntilTimestamp !== null && $lockedUntilTimestamp > time()) {
    write_auth_audit($pdo, $user, 'login.locked', 'A login attempt was blocked because the account is locked.', [
        'username' => $user['username'],
        'locked_until' => $user['locked_until'],
    ]);

    json_response([
        'success' => false,
        'message' => login_locked_until_message($user['locked_until']),
    ], 423);
}

if ($lockedUntilTimestamp !== null) {
    login_clear_failed_attempts($pdo, (int)$user['id']);
    $user['failed_login_attempts'] = 0;
    $user['locked_until'] = null;
}

$passwordHash = (string)($user['password_hash'] ?? '');
$passwordMatches = $passwordHash !== '' && password_verify($password, $passwordHash);

if (!$passwordMatches) {
    login_record_failed_attempt($pdo, $user);

    write_auth_audit($pdo, $user, 'login.failed', 'A login attempt failed.', [
        'username' => $user['username'],
    ]);

    $settings = hris_security_settings($pdo);
    $nextAttempts = max(0, (int)($user['failed_login_attempts'] ?? 0)) + 1;

    if ($nextAttempts >= $settings['lockoutFailedAttempts']) {
        json_response([
            'success' => false,
            'message' => 'Too many failed attempts. This account is locked for '
                . $settings['lockoutDurationMinutes']
                . ' minute'
                . ($settings['lockoutDurationMinutes'] === 1 ? '' : 's')
                . '.',
        ], 423);
    }

    json_response([
        'success' => false,
        'message' => 'Invalid username or password.',
    ], 401);
}

if ((int)($user['is_archived'] ?? 0) === 1) {
    write_auth_audit($pdo, $user, 'login.archived', 'A login attempt was blocked because the account has been archived.', [
        'username' => $user['username'],
    ]);

    json_response([
        'success' => false,
        'message' => 'This account is inactive. You cannot log in.',
    ], 403);
}

if (strtolower((string)$user['status']) !== 'active') {
    json_response([
        'success' => false,
        'message' => 'This user is inactive.',
    ], 403);
}

$emailPolicyViolation = hris_email_domain_policy_violation($pdo, (string)($user['email'] ?? ''));
if ($emailPolicyViolation !== null) {
    write_auth_audit($pdo, $user, 'login.email_domain_blocked', 'A login attempt was blocked by the email domain policy.', [
        'username' => $user['username'] ?? null,
        'email' => $user['email'] ?? null,
    ]);

    json_response([
        'success' => false,
        'message' => $emailPolicyViolation,
    ], 403);
}

login_clear_failed_attempts($pdo, (int)$user['id']);

if (hris_password_has_expired($pdo, $user['password_changed_at'] ?? null)) {
    $statement = $pdo->prepare(
        'UPDATE users
         SET must_change_password = 1
         WHERE id = :id'
    );
    $statement->execute([':id' => (int)$user['id']]);

    write_auth_audit($pdo, $user, 'login.password_expired', 'A login attempt was blocked because the password expired.', [
        'username' => $user['username'],
    ]);

    json_response([
        'success' => false,
        'message' => 'Your password has expired. Use Forgot Password to set a new password before signing in.',
    ], 403);
}

if (hris_two_factor_required($pdo, $user)) {
    try {
        $twoFactorChallenge = hris_two_factor_issue_code($pdo, $user);
    } catch (Throwable $exception) {
        write_auth_audit($pdo, $user, 'login.two_factor_email_failed', 'A login attempt was blocked because the 2FA email could not be sent.', [
            'username' => $user['username'],
            'error' => $exception->getMessage(),
        ]);

        json_response([
            'success' => false,
            'message' => 'Unable to send verification code. Check SMTP settings and try again.',
            'error' => $exception->getMessage(),
        ], 500);
    }

    unset($_SESSION['user']);
    $_SESSION['last_activity_at'] = time();

    write_auth_audit($pdo, $user, 'login.two_factor_required', 'A user passed password verification and was sent a 2FA code.', [
        'username' => $user['username'],
    ]);

    json_response([
        'success' => true,
        'requiresTwoFactor' => true,
        'message' => 'Verification code sent.',
        'twoFactor' => $twoFactorChallenge,
    ]);
}

$sessionUser = format_user($user);
session_regenerate_id(true);
$_SESSION['user'] = $sessionUser;
$_SESSION['last_activity_at'] = time();

write_auth_audit($pdo, $sessionUser, 'login.success', 'A user signed in successfully.', [
    'username' => $sessionUser['username'],
    'two_factor' => false,
]);
hris_two_factor_notify_admins_of_login($pdo, $sessionUser);
hris_two_factor_safe_alert_email(
    (string)($sessionUser['email'] ?? ''),
    'New Login Detected',
    'A successful login to your MGB HRIS account was detected. If this was not you, contact the HRIS administrator immediately.'
);

json_response([
    'success' => true,
    'message' => 'Login successful.',
    'user' => $sessionUser,
]);
