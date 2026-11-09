<?php
declare(strict_types=1);

// Logging in must not depend on a CSRF token from a possibly expired anonymous browser session.
define('HRIS_CSRF_EXEMPT', true);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/captcha-utils.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/two_factor.php';
// The account query, the lock helpers and the counter reset, shared with google_login.php.
require_once __DIR__ . '/login-utils.php';

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

// Counted before the password is looked at, so a refusal costs nothing and reveals nothing. See
// throttle_login() for how it divides the work with the per-account lockout further down.
throttle_login($pdo, $identifier);

/*
 * The captcha, checked here because here is the only place a check counts. The browser is told the
 * problem and nothing else -- captcha-utils.php keeps the answer in the session -- so an attempt that
 * arrives without a solved challenge is refused no matter what sent it. Skipping the form no longer
 * skips the captcha.
 *
 * It sits between the rate limiter and the account lookup deliberately. After the limiter, so that
 * grinding at the captcha spends the same sign-in budget as grinding at the password. Before the
 * lookup, so a wrong sum never touches `failed_login_attempts` -- a user fumbling the arithmetic must
 * not be able to lock their own account out, and a stranger must not be able to lock theirs.
 *
 * `captchaFailed` is what tells login.jsx to swap in a fresh challenge and put the message under the
 * captcha rather than under the password box: this attempt says nothing about the credentials, and it
 * must not be reported as though it did.
 */
if (login_captcha_enabled($pdo)) {
    $captchaResult = captcha_verify(
        CAPTCHA_PURPOSE_LOGIN,
        (string)($body['captchaId'] ?? ''),
        (string)($body['captchaAnswer'] ?? '')
    );

    if (!$captchaResult['ok']) {
        json_response([
            'success' => false,
            'message' => $captchaResult['message'],
            'captchaFailed' => true,
        ], 422);
    }
}

ensure_user_security_columns($pdo);
ensure_two_factor_schema($pdo);
ensure_email_verification_columns($pdo);

/**
 * The lockout is the only moment an administrator is told that someone is grinding at an account, so
 * the notification has to carry enough to act on without going and opening the audit log: which
 * account was targeted and where the attempts came from.
 *
 * The address comes from audit_request_context(), the same call the audit row is built from, so the
 * two records can never disagree about who was knocking. Its geolocation lookups are memoised for the
 * life of the request, and write_auth_audit() has already made the call by the time this runs, so
 * asking a second time costs nothing.
 *
 * The first line is written to stand alone: the bell trims the message to a snippet, and the name and
 * the IP are the two things that have to survive that trim. Everything else follows underneath for
 * whoever opens the notification.
 */
function login_notify_admins_of_lockout(PDO $pdo, array $user, int $attempts, int $lockedUntilTimestamp): void
{
    $context = audit_request_context();
    $ipAddress = trim((string)($context['ipAddress'] ?? ''));
    $displayName = audit_user_display_name($user) ?? 'An account';
    $username = trim((string)($user['username'] ?? ''));
    $email = trim((string)($user['email'] ?? ''));

    /*
     * Kept under the 120 characters the bell trims a message to, which is why the username is left
     * out of it: an IPv6 address is 39 characters on its own, and the name and the address are the
     * two things that have to be readable without opening anything. The username follows below.
     */
    $summary = sprintf(
        '%s locked out after %d failed sign-in attempts from %s.',
        $displayName,
        $attempts,
        $ipAddress !== '' ? 'IP ' . $ipAddress : 'an unrecorded IP address'
    );

    $device = implode(' - ', array_filter([
        trim((string)($context['device'] ?? '')),
        trim((string)($context['browser'] ?? '')),
        trim((string)($context['os'] ?? '')),
    ]));

    $lines = [
        'Name: ' . $displayName,
        'Username: ' . ($username !== '' ? $username : 'Not recorded'),
    ];

    // Most accounts here sign in with their address, and repeating it as its own line says nothing.
    if ($email !== '' && $email !== $username) {
        $lines[] = 'Email: ' . $email;
    }

    $lines = array_merge($lines, [
        'IP address: ' . ($ipAddress !== '' ? $ipAddress : 'Not recorded'),
        'Location: ' . (trim((string)($context['location'] ?? '')) ?: 'Unknown'),
        'Device: ' . ($device !== '' ? $device : 'Unknown'),
        'Failed attempts: ' . $attempts,
        'Locked until: ' . date('M j, Y g:i A', $lockedUntilTimestamp),
    ]);

    notify_roles(
        $pdo,
        ['admin'],
        'Suspicious Login Activity',
        $summary . "\n\n" . implode("\n", $lines),
        'suspicious_login',
        (string)(int)($user['id'] ?? 0)
    );
}

/**
 * Returns the moment the lock lifts when this attempt was the one that tripped it, or null while the
 * account is still merely accumulating failures. The caller needs the timestamp itself, not just the
 * fact of the lock: the response has to carry it to the browser, which counts down against it.
 */
function login_record_failed_attempt(PDO $pdo, array $user): ?int
{
    $settings = security_settings($pdo);
    $userId = (int)($user['id'] ?? 0);
    $currentAttempts = max(0, (int)($user['failed_login_attempts'] ?? 0));
    $nextAttempts = $currentAttempts + 1;

    if ($userId <= 0) {
        return null;
    }

    if ($nextAttempts >= $settings['lockoutFailedAttempts']) {
        $lockedUntilTimestamp = time() + ($settings['lockoutDurationMinutes'] * 60);
        $lockedUntil = date('Y-m-d H:i:s', $lockedUntilTimestamp);
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
            login_notify_admins_of_lockout($pdo, $user, $nextAttempts, $lockedUntilTimestamp);
        } catch (Throwable $exception) {
            error_log('Account lock notification error: ' . $exception->getMessage());
        }

        return $lockedUntilTimestamp;
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

    return null;
}

$user = login_find_user_by_identifier($pdo, $identifier);

if (!$user) {
    write_auth_audit($pdo, null, 'login.failed', 'A login attempt failed for an unknown account.', [
        'identifier' => $identifier,
    ]);

    json_response([
        'success' => false,
        'message' => 'Invalid username or password.',
    ], 401);
}

$lockedUntilTimestamp = datetime_timestamp($user['locked_until'] ?? null);

if ($lockedUntilTimestamp !== null && $lockedUntilTimestamp > time()) {
    write_auth_audit($pdo, $user, 'login.locked', 'A login attempt was blocked because the account is locked.', [
        'username' => $user['username'],
        'locked_until' => $user['locked_until'],
    ]);

    json_response(array_merge([
        'success' => false,
        'message' => login_locked_until_message($user['locked_until']),
    ], login_lock_payload($lockedUntilTimestamp, false)), 423);
}

if ($lockedUntilTimestamp !== null) {
    login_clear_failed_attempts($pdo, (int)$user['id']);
    $user['failed_login_attempts'] = 0;
    $user['locked_until'] = null;
}

$passwordHash = (string)($user['password_hash'] ?? '');
$passwordMatches = $passwordHash !== '' && password_verify($password, $passwordHash);

if (!$passwordMatches) {
    $lockedUntilTimestamp = login_record_failed_attempt($pdo, $user);

    write_auth_audit($pdo, $user, 'login.failed', 'A login attempt failed.', [
        'username' => $user['username'],
    ]);

    if ($lockedUntilTimestamp !== null) {
        $settings = security_settings($pdo);

        json_response(array_merge([
            'success' => false,
            'message' => 'Too many failed attempts. This account is locked for '
                . $settings['lockoutDurationMinutes']
                . ' minute'
                . ($settings['lockoutDurationMinutes'] === 1 ? '' : 's')
                . '.',
        ], login_lock_payload($lockedUntilTimestamp, true)), 423);
    }

    json_response([
        'success' => false,
        'message' => 'Invalid username or password.',
    ], 401);
}

/*
 * An archived or deactivated account is turned away with the same 401 and the same wording as a
 * wrong password. Naming the account state would confirm to whoever is at the form that the
 * credentials they just typed are real, which is the one thing this response must not do — and the
 * password has already been verified by the time either check runs, so anyone reaching here typed a
 * working pair. The audit log below keeps the real reason where administrators can still read it.
 */
if ((int)($user['is_archived'] ?? 0) === 1) {
    write_auth_audit($pdo, $user, 'login.archived', 'A login attempt was blocked because the account has been archived.', [
        'username' => $user['username'],
    ]);

    json_response([
        'success' => false,
        'message' => 'Invalid username or password.',
    ], 401);
}

if (strtolower((string)$user['status']) !== 'active') {
    write_auth_audit($pdo, $user, 'login.inactive', 'A login attempt was blocked because the account is inactive.', [
        'username' => $user['username'],
        'status' => $user['status'],
    ]);

    json_response([
        'success' => false,
        'message' => 'Invalid username or password.',
    ], 401);
}

$emailPolicyViolation = email_domain_policy_violation($pdo, (string)($user['email'] ?? ''));
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

if (password_has_expired($pdo, $user['password_changed_at'] ?? null)) {
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

if (two_factor_required($pdo, $user)) {
    try {
        $twoFactorChallenge = two_factor_issue_code($pdo, $user);
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
two_factor_notify_admins_of_login($pdo, $sessionUser);

/*
 * The "was this you?" e-mail is a consequence of the sign-in, not a condition of it: the password
 * has been accepted and the session exists whether or not Gmail is reachable, and the caller is
 * never told the outcome either way. Sending it inline meant every user waited out a full SMTP
 * conversation before the dashboard would open, so it goes out after the response does.
 */
$loginAlertEmail = (string)($sessionUser['email'] ?? '');
defer(static function () use ($loginAlertEmail): void {
    two_factor_safe_alert_email(
        $loginAlertEmail,
        'New Login Detected',
        'A successful login to your MGB HRIS account was detected. If this was not you, contact the HRIS administrator immediately.'
    );
});

/*
 * A sign-in used to be able to mint a bearer-token pair alongside the session for a caller that
 * asked with `"issueTokens": true`. Bearer authentication has been removed, so the session cookie
 * set above is the whole result and the response no longer carries a `tokens` field.
 */
json_response([
    'success' => true,
    'message' => 'Login successful.',
    'user' => $sessionUser,
]);
