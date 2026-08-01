<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/two-factor-utils.php';
require_once __DIR__ . '/rate-limit-utils.php';

require_method('POST');

hris_rate_limit_guard($pdo, 'twoFactor');

$body = read_json_body();
$code = preg_replace('/\D+/', '', (string)($body['code'] ?? $body['otp'] ?? '')) ?? '';

if (!preg_match('/^\d{6}$/', $code)) {
    json_response([
        'success' => false,
        'message' => 'Enter the 6-digit verification code.',
    ], 422);
}

$pending = hris_two_factor_pending_login();
$userId = (int)($pending['user_id'] ?? 0);

if ($pending === null || $userId <= 0) {
    json_response([
        'success' => false,
        'message' => 'Your verification session expired. Please sign in again.',
    ], 401);
}

hris_ensure_two_factor_tables($pdo);

$user = session_user_record($pdo, $userId);

if (!$user || strtolower((string)($user['status'] ?? '')) !== 'active') {
    hris_two_factor_clear_pending_login();
    hris_two_factor_log($pdo, $userId, 'verify', 'invalid_session');
    json_response([
        'success' => false,
        'message' => 'Your account is no longer available for verification.',
    ], 403);
}

$emailPolicyViolation = hris_email_domain_policy_violation($pdo, (string)($user['email'] ?? ''));
if ($emailPolicyViolation !== null) {
    hris_two_factor_clear_pending_login();
    hris_two_factor_log($pdo, $userId, 'verify', 'email_domain_blocked');
    write_auth_audit($pdo, $user, 'login.email_domain_blocked', 'A 2FA verification was blocked by the email domain policy.', [
        'username' => $user['username'] ?? null,
        'email' => $user['email'] ?? null,
    ]);

    json_response([
        'success' => false,
        'message' => $emailPolicyViolation,
    ], 403);
}

$settings = hris_two_factor_settings($pdo);
$codeRow = hris_two_factor_latest_open_code($pdo, $userId);

if (!$codeRow) {
    hris_two_factor_log($pdo, $userId, 'verify', 'missing_code');
    json_response([
        'success' => false,
        'message' => 'No active verification code was found. Request a new code.',
    ], 410);
}

$expiresAt = hris_datetime_timestamp($codeRow['expires_at'] ?? null);

if ($expiresAt === null || $expiresAt < time()) {
    hris_two_factor_invalidate_open_codes($pdo, $userId);
    hris_two_factor_log($pdo, $userId, 'verify', 'expired');
    write_auth_audit($pdo, $user, 'two_factor.verify_expired', 'An expired 2FA code was submitted.', [
        'username' => $user['username'] ?? null,
    ]);

    json_response([
        'success' => false,
        'message' => 'This verification code has expired. Request a new code.',
        'expired' => true,
        'twoFactor' => hris_two_factor_code_payload($pdo, $user, $codeRow),
    ], 410);
}

$attempts = max(0, (int)($codeRow['attempts'] ?? 0));

if ($attempts >= $settings['maxAttempts']) {
    hris_two_factor_lock_account($pdo, $userId);
    hris_two_factor_invalidate_open_codes($pdo, $userId);
    hris_two_factor_clear_pending_login();
    hris_two_factor_log($pdo, $userId, 'verify', 'locked');

    json_response([
        'success' => false,
        'message' => 'Too many verification attempts. This account is temporarily locked.',
    ], 423);
}

$matches = password_verify($code, (string)($codeRow['otp_hash'] ?? ''));

if (!$matches) {
    $nextAttempts = $attempts + 1;
    $statement = $pdo->prepare(
        'UPDATE user_two_factor_codes
         SET attempts = :attempts
         WHERE id = :id
           AND user_id = :user_id'
    );
    $statement->execute([
        ':attempts' => $nextAttempts,
        ':id' => (int)$codeRow['id'],
        ':user_id' => $userId,
    ]);

    $remainingAttempts = max(0, $settings['maxAttempts'] - $nextAttempts);
    hris_two_factor_log($pdo, $userId, 'verify', 'failed');
    write_auth_audit($pdo, $user, 'two_factor.verify_failed', 'A 2FA verification attempt failed.', [
        'username' => $user['username'] ?? null,
        'attempts' => $nextAttempts,
    ]);

    if ($nextAttempts >= 2) {
        hris_two_factor_safe_alert_email(
            (string)($user['email'] ?? ''),
            'Multiple Failed Verification Attempts',
            'Multiple failed 2FA verification attempts were detected on your MGB HRIS account. If this was not you, contact the HRIS administrator immediately.'
        );
        hris_two_factor_notify_user(
            $pdo,
            $userId,
            'Failed 2FA attempts detected',
            'Multiple failed verification attempts were detected on your account.',
            'two_factor_failed'
        );
    }

    if ($remainingAttempts <= 0) {
        hris_two_factor_lock_account($pdo, $userId);
        hris_two_factor_invalidate_open_codes($pdo, $userId);
        hris_two_factor_clear_pending_login();
        hris_two_factor_log($pdo, $userId, 'verify', 'locked');

        json_response([
            'success' => false,
            'message' => 'Too many verification attempts. This account is temporarily locked.',
            'attemptsRemaining' => 0,
        ], 423);
    }

    $freshCode = hris_two_factor_latest_open_code($pdo, $userId);

    json_response([
        'success' => false,
        'message' => 'Invalid verification code.',
        'attemptsRemaining' => $remainingAttempts,
        'twoFactor' => $freshCode ? hris_two_factor_code_payload($pdo, $user, $freshCode) : null,
    ], 401);
}

$statement = $pdo->prepare(
    'UPDATE user_two_factor_codes
     SET verified = 1
     WHERE id = :id
       AND user_id = :user_id
       AND verified = 0'
);
$statement->execute([
    ':id' => (int)$codeRow['id'],
    ':user_id' => $userId,
]);

$sessionUser = format_user($user);
session_regenerate_id(true);
$_SESSION['user'] = $sessionUser;
$_SESSION['last_activity_at'] = time();
$_SESSION['two_factor_verified_at'] = time();
hris_two_factor_clear_pending_login();

hris_two_factor_log($pdo, $userId, 'verify', 'success');
write_auth_audit($pdo, $sessionUser, 'login.success', 'A user signed in successfully after 2FA verification.', [
    'username' => $sessionUser['username'],
    'two_factor' => true,
]);
hris_two_factor_notify_user($pdo, $userId, 'New login detected', 'Your account signed in successfully with 2FA verification.', 'login_detected');
hris_two_factor_safe_alert_email(
    (string)($sessionUser['email'] ?? ''),
    'New Login Detected',
    'A successful login to your MGB HRIS account was completed with two-factor verification. If this was not you, contact the HRIS administrator immediately.'
);

json_response([
    'success' => true,
    'message' => 'Verification successful.',
    'user' => $sessionUser,
]);
