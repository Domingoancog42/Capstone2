<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/two-factor-utils.php';

require_method('POST');

// Resending a code is unthrottled so a user whose first email never arrives is not locked
// out; the twoFactor group still guards code entry on two_factor_verify.php.

$pending = hris_two_factor_pending_login();
$userId = (int)($pending['user_id'] ?? 0);

if ($pending === null || $userId <= 0) {
    json_response([
        'success' => false,
        'message' => 'Your verification session expired. Please sign in again.',
    ], 401);
}

$user = session_user_record($pdo, $userId);

if (!$user || strtolower((string)($user['status'] ?? '')) !== 'active') {
    hris_two_factor_clear_pending_login();
    hris_two_factor_log($pdo, $userId, 'otp_resend', 'invalid_session');
    json_response([
        'success' => false,
        'message' => 'Your account is no longer available for verification.',
    ], 403);
}

$emailPolicyViolation = hris_email_domain_policy_violation($pdo, (string)($user['email'] ?? ''));
if ($emailPolicyViolation !== null) {
    hris_two_factor_clear_pending_login();
    hris_two_factor_log($pdo, $userId, 'otp_resend', 'email_domain_blocked');
    write_auth_audit($pdo, $user, 'login.email_domain_blocked', 'A 2FA resend was blocked by the email domain policy.', [
        'username' => $user['username'] ?? null,
        'email' => $user['email'] ?? null,
    ]);

    json_response([
        'success' => false,
        'message' => $emailPolicyViolation,
    ], 403);
}

try {
    $challenge = hris_two_factor_issue_code($pdo, $user, true);
} catch (TwoFactorRateLimitException $exception) {
    $codeRow = hris_two_factor_latest_open_code($pdo, $userId);

    json_response([
        'success' => false,
        'message' => $exception->getMessage(),
        'resendAvailableInSeconds' => $exception->secondsRemaining,
        'twoFactor' => $codeRow ? hris_two_factor_code_payload($pdo, $user, $codeRow) : null,
    ], 429);
} catch (Throwable $exception) {
    json_response([
        'success' => false,
        'message' => 'Unable to send verification code. Check SMTP settings and try again.',
        'error' => $exception->getMessage(),
    ], 500);
}

write_auth_audit($pdo, $user, 'two_factor.otp_resent', 'A 2FA verification code was resent.', [
    'username' => $user['username'] ?? null,
]);

json_response([
    'success' => true,
    'message' => 'A new verification code was sent.',
    'twoFactor' => $challenge,
]);
