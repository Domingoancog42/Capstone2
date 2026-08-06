<?php
declare(strict_types=1);

/**
 * Self-service password change guarded by an emailed one-time passcode.
 *
 * Mirrors the email-verification flow: the pending code lives in the session, is hashed at rest,
 * expires, throttles resends, and locks the user out after too many wrong attempts.
 *
 *   GET                     -> current status payload
 *   POST { action: request } -> verify current password, email a code
 *   POST { action: resend }  -> reissue the code for the open request
 *   POST { action: verify }  -> check the code, then apply the new password
 *   POST { action: cancel }  -> discard the open request
 */

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/two-factor-utils.php';

$sessionUser = require_session_user();
$userId = (int)($sessionUser['id'] ?? 0);

hris_ensure_user_security_columns($pdo);

const PASSWORD_CHANGE_LOCK_SECONDS = 15 * 60;

function password_change_settings(PDO $pdo): array
{
    $twoFactorSettings = hris_two_factor_settings($pdo);

    return [
        'otpExpiryMinutes' => max(5, min(15, (int)($twoFactorSettings['otpExpiryMinutes'] ?? 5))),
        'maxAttempts' => 5,
        'resendDelaySeconds' => max(0, min(60, (int)($twoFactorSettings['resendDelaySeconds'] ?? 0))),
        'lockSeconds' => PASSWORD_CHANGE_LOCK_SECONDS,
    ];
}

function password_change_account(PDO $pdo, int $userId): ?array
{
    $statement = $pdo->prepare(
        'SELECT id, username, email, password_hash, password_changed_at AS passwordChangedAt
         FROM users
         WHERE id = :id
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $userId]);
    $account = $statement->fetch();

    return $account ?: null;
}

function password_change_display_name(array $sessionUser, array $account): string
{
    $name = trim((string)($sessionUser['full_name'] ?? ''));

    if ($name !== '') {
        return $name;
    }

    $username = trim((string)($account['username'] ?? $sessionUser['username'] ?? ''));

    return $username !== '' ? $username : 'User';
}

function password_change_mask_email(string $email): string
{
    return hris_two_factor_mask_email($email);
}

function password_change_clear_pending(int $userId): void
{
    $pending = $_SESSION['password_change_pending'] ?? null;

    if (is_array($pending) && (int)($pending['userId'] ?? 0) === $userId) {
        unset($_SESSION['password_change_pending']);
    }
}

function password_change_store_pending(int $userId, string $otpHash, int $expiresInMinutes): void
{
    $createdAtTimestamp = time();

    $_SESSION['password_change_pending'] = [
        'userId' => $userId,
        'otpHash' => $otpHash,
        'expiresAtTimestamp' => $createdAtTimestamp + ($expiresInMinutes * 60),
        'attempts' => 0,
        'createdAtTimestamp' => $createdAtTimestamp,
    ];
}

/**
 * Returns the open request, discarding it first if it has already expired.
 */
function password_change_pending(int $userId): ?array
{
    $pending = $_SESSION['password_change_pending'] ?? null;

    if (!is_array($pending) || (int)($pending['userId'] ?? 0) !== $userId) {
        return null;
    }

    if ((int)($pending['expiresAtTimestamp'] ?? 0) <= time()) {
        password_change_clear_pending($userId);
        return null;
    }

    return $pending;
}

function password_change_lock_remaining(int $userId): int
{
    $lock = $_SESSION['password_change_lock'] ?? null;

    if (!is_array($lock) || (int)($lock['userId'] ?? 0) !== $userId) {
        return 0;
    }

    $remaining = (int)($lock['until'] ?? 0) - time();

    if ($remaining <= 0) {
        unset($_SESSION['password_change_lock']);
        return 0;
    }

    return $remaining;
}

function password_change_assert_unlocked(int $userId): void
{
    $remaining = password_change_lock_remaining($userId);

    if ($remaining > 0) {
        json_response([
            'success' => false,
            'message' => 'Too many incorrect codes. Try again later.',
            'lockedForSeconds' => $remaining,
        ], 423);
    }
}

function password_change_lock(int $userId, int $lockSeconds): void
{
    $_SESSION['password_change_lock'] = [
        'userId' => $userId,
        'until' => time() + $lockSeconds,
    ];
    password_change_clear_pending($userId);
}

function password_change_pending_payload(PDO $pdo, array $pending, string $email): array
{
    $settings = password_change_settings($pdo);
    $createdAt = (int)($pending['createdAtTimestamp'] ?? 0);
    $resendAvailableAt = $createdAt > 0 ? $createdAt + $settings['resendDelaySeconds'] : time();

    return [
        'maskedEmail' => password_change_mask_email($email),
        'expiresInSeconds' => max(0, (int)($pending['expiresAtTimestamp'] ?? 0) - time()),
        'attemptsRemaining' => max(0, $settings['maxAttempts'] - (int)($pending['attempts'] ?? 0)),
        'maxAttempts' => $settings['maxAttempts'],
        'resendDelaySeconds' => $settings['resendDelaySeconds'],
        'resendAvailableInSeconds' => max(0, $resendAvailableAt - time()),
    ];
}

function password_change_status_payload(PDO $pdo, array $sessionUser): array
{
    $userId = (int)($sessionUser['id'] ?? 0);
    $account = password_change_account($pdo, $userId);
    $settings = password_change_settings($pdo);
    $email = (string)($account['email'] ?? '');
    $pending = password_change_pending($userId);

    return [
        'success' => true,
        'passwordChange' => [
            'email' => $email,
            'maskedEmail' => password_change_mask_email($email),
            'passwordChangedAt' => $account['passwordChangedAt'] ?? null,
            'lockedForSeconds' => password_change_lock_remaining($userId),
            'otpExpiryMinutes' => $settings['otpExpiryMinutes'],
            'resendDelaySeconds' => $settings['resendDelaySeconds'],
            'maxAttempts' => $settings['maxAttempts'],
            'pending' => $pending !== null ? password_change_pending_payload($pdo, $pending, $email) : null,
        ],
    ];
}

function password_change_html_body(string $displayName, string $code, int $expiresInMinutes, ?string $logoContentId = null): string
{
    return hris_mail_document([
        'title' => 'Password Change Verification Code',
        'preheader' => 'Use your 6-digit code to confirm the password change on your MGB HRIS account.',
        'eyebrow' => 'Password Change',
        'subtitle' => 'Region X Mines and Geosciences Bureau account security',
        'logoContentId' => $logoContentId,
        'greetingName' => $displayName,
        'intro' => 'We received a request to change the password on your HRIS account.',
        'blocks' => [
            hris_mail_code_block(
                'Verification Code',
                $code,
                'This code expires in <strong>' . hris_mail_escape(hris_mail_minutes_label($expiresInMinutes)) . '</strong>.'
            ),
            hris_mail_note_block('Enter this code in the <strong>Security</strong> tab of your HRIS profile to finish setting your new password.'),
        ],
        'closing' => 'If you did not request a password change, ignore this email and contact the HRIS administrator — your password has not been changed.',
        'footerNote' => 'This is an automated security message from the HRIS account service.',
    ]);
}

function password_change_text_body(string $displayName, string $code, int $expiresInMinutes): string
{
    return "MGB HRIS Portal - Password Change\n"
        . "Hello {$displayName},\n\n"
        . "We received a request to change the password on your HRIS account.\n\n"
        . "Verification code: {$code}\n"
        . 'This code expires in ' . hris_mail_minutes_label($expiresInMinutes) . ".\n\n"
        . "Enter this code in the Security tab of your HRIS profile to finish setting your new password.\n\n"
        . "If you did not request a password change, ignore this email and contact the HRIS administrator.";
}

function password_change_send_email(string $recipientEmail, string $displayName, string $code, int $expiresInMinutes): void
{
    $mail = hris_configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = hris_email_base_label() . ' | Password Change Verification Code';
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = password_change_html_body($displayName, $code, $expiresInMinutes, $logoContentId);
    $mail->AltBody = password_change_text_body($displayName, $code, $expiresInMinutes);
    $mail->send();
}

/**
 * Issues (or reissues) a code for the signed-in user and emails it.
 */
function password_change_issue_code(PDO $pdo, array $sessionUser, bool $enforceResendDelay): array
{
    $userId = (int)($sessionUser['id'] ?? 0);
    $account = password_change_account($pdo, $userId);

    if ($account === null) {
        json_response([
            'success' => false,
            'message' => 'Your account could not be found.',
        ], 404);
    }

    $email = trim((string)($account['email'] ?? ''));

    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        json_response([
            'success' => false,
            'message' => 'Your account has no valid email address on file. Contact the HRIS administrator.',
        ], 422);
    }

    password_change_assert_unlocked($userId);

    $settings = password_change_settings($pdo);
    $pending = password_change_pending($userId);

    if ($enforceResendDelay && $pending !== null) {
        $createdAt = (int)($pending['createdAtTimestamp'] ?? 0);
        $remaining = $createdAt > 0 ? ($createdAt + $settings['resendDelaySeconds']) - time() : 0;

        if ($remaining > 0) {
            json_response([
                'success' => false,
                'message' => 'Please wait before requesting another verification code.',
                'resendAvailableInSeconds' => $remaining,
            ], 429);
        }
    }

    $code = hris_two_factor_generate_code();
    password_change_store_pending($userId, password_hash($code, PASSWORD_DEFAULT), $settings['otpExpiryMinutes']);

    try {
        password_change_send_email(
            $email,
            password_change_display_name($sessionUser, $account),
            $code,
            $settings['otpExpiryMinutes']
        );
    } catch (Throwable $exception) {
        password_change_clear_pending($userId);
        write_auth_audit($pdo, $sessionUser, 'password.change_otp_email_failed', 'A password change code could not be emailed.', [
            'error' => $exception->getMessage(),
        ]);
        throw $exception;
    }

    write_auth_audit($pdo, $sessionUser, 'password.change_otp_sent', 'A password change verification code was emailed.');
    hris_two_factor_notify_user(
        $pdo,
        $userId,
        'Password change code sent',
        'A verification code was sent to your email address to confirm your password change.',
        'password_change'
    );

    $freshPending = password_change_pending($userId);

    return $freshPending !== null ? password_change_pending_payload($pdo, $freshPending, $email) : [];
}

/**
 * Validates the submitted code and applies the new password.
 */
function password_change_apply(PDO $pdo, array $sessionUser, string $code, string $newPassword, string $confirmPassword): void
{
    $userId = (int)($sessionUser['id'] ?? 0);

    if (!preg_match('/^\d{6}$/', $code)) {
        json_response([
            'success' => false,
            'message' => 'Enter the 6-digit verification code.',
        ], 422);
    }

    if ($newPassword !== $confirmPassword) {
        json_response([
            'success' => false,
            'message' => 'Passwords do not match.',
        ], 422);
    }

    password_change_assert_unlocked($userId);

    $account = password_change_account($pdo, $userId);
    $pending = password_change_pending($userId);

    if ($account === null || $pending === null) {
        json_response([
            'success' => false,
            'message' => 'No active verification code was found. Request a new code.',
        ], 410);
    }

    $settings = password_change_settings($pdo);

    if (!password_verify($code, (string)($pending['otpHash'] ?? ''))) {
        $attempts = (int)($pending['attempts'] ?? 0) + 1;
        $_SESSION['password_change_pending']['attempts'] = $attempts;
        write_auth_audit($pdo, $sessionUser, 'password.change_otp_failed', 'A password change verification attempt failed.', [
            'attempts' => $attempts,
        ]);

        if ($attempts >= $settings['maxAttempts']) {
            password_change_lock($userId, $settings['lockSeconds']);
            json_response([
                'success' => false,
                'message' => 'Too many incorrect codes. Try again later.',
                'lockedForSeconds' => $settings['lockSeconds'],
            ], 423);
        }

        json_response([
            'success' => false,
            'message' => 'The verification code is incorrect.',
            'attemptsRemaining' => max(0, $settings['maxAttempts'] - $attempts),
        ], 422);
    }

    // The code is valid; from here on any failure is a password-policy problem, so keep the
    // pending request alive and let the user retry with a different password.
    $maximumPasswordLength = (int)(hris_security_settings($pdo)['maximumPasswordLength'] ?? 64);
    $minimumPasswordLength = min(8, max(6, $maximumPasswordLength));
    $passwordLengthError = hris_password_length_error($pdo, $newPassword, $minimumPasswordLength);

    if ($passwordLengthError !== null) {
        json_response([
            'success' => false,
            'message' => $passwordLengthError,
        ], 422);
    }

    if (
        !preg_match('/[A-Za-z]/', $newPassword)
        || !preg_match('/\d/', $newPassword)
        || !preg_match('/[^A-Za-z0-9]/', $newPassword)
    ) {
        json_response([
            'success' => false,
            'message' => 'Password must include letters, numbers, and symbols.',
        ], 422);
    }

    $passwordHash = (string)($account['password_hash'] ?? '');

    if ($passwordHash !== '' && password_verify($newPassword, $passwordHash)) {
        json_response([
            'success' => false,
            'message' => 'Choose a new password that is different from your current password.',
        ], 422);
    }

    $update = $pdo->prepare(
        'UPDATE users
         SET password_hash = :password_hash,
             must_change_password = 0,
             password_changed_at = CURRENT_TIMESTAMP,
             failed_login_attempts = 0,
             locked_until = NULL
         WHERE id = :id'
    );
    $update->execute([
        ':password_hash' => password_hash($newPassword, PASSWORD_DEFAULT),
        ':id' => $userId,
    ]);

    password_change_clear_pending($userId);

    $freshUser = session_user_record($pdo, $userId);

    if ($freshUser === null) {
        hris_destroy_session();
        json_response([
            'success' => false,
            'message' => 'Your session is no longer valid. Please sign in again.',
        ], 401);
    }

    $formattedUser = format_user($freshUser);
    $_SESSION['user'] = $formattedUser;
    $_SESSION['last_activity_at'] = time();

    write_auth_audit($pdo, $formattedUser, 'password.change_completed', 'A user changed their password from the profile page.', [
        'username' => $formattedUser['username'] ?? null,
    ]);
    hris_two_factor_notify_user(
        $pdo,
        $userId,
        'Password changed successfully',
        'Your HRIS account password was changed successfully.',
        'password_change'
    );
    hris_two_factor_safe_alert_email(
        (string)($account['email'] ?? ''),
        'Password Changed Successfully',
        'Your MGB HRIS account password was changed successfully. If this was not you, contact the HRIS administrator immediately and reset your password.',
        'success',
        password_change_display_name($sessionUser, $account)
    );

    json_response([
        'success' => true,
        'message' => 'Password changed successfully.',
        'user' => $formattedUser,
        'passwordChange' => password_change_status_payload($pdo, $formattedUser)['passwordChange'],
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    json_response(password_change_status_payload($pdo, $sessionUser));
}

require_method('POST');

$body = read_json_body();
$action = strtolower(trim((string)($body['action'] ?? '')));

if ($action === 'request') {
    $currentPassword = (string)($body['currentPassword'] ?? '');

    if ($currentPassword === '') {
        json_response([
            'success' => false,
            'message' => 'Current password is required.',
        ], 422);
    }

    password_change_assert_unlocked($userId);

    $account = password_change_account($pdo, $userId);

    if ($account === null) {
        hris_destroy_session();
        json_response([
            'success' => false,
            'message' => 'Your session is no longer valid. Please sign in again.',
        ], 401);
    }

    $passwordHash = (string)($account['password_hash'] ?? '');

    if ($passwordHash === '' || !password_verify($currentPassword, $passwordHash)) {
        write_auth_audit($pdo, $sessionUser, 'password.change_current_password_failed', 'A password change request failed the current-password check.');
        json_response([
            'success' => false,
            'message' => 'Current password is incorrect.',
        ], 422);
    }

    $pending = password_change_issue_code($pdo, $sessionUser, true);
    write_auth_audit($pdo, $sessionUser, 'password.change_requested', 'A user requested a password change verification code.');

    json_response([
        'success' => true,
        'message' => 'Verification code sent.',
        'pending' => $pending,
        'passwordChange' => password_change_status_payload($pdo, $sessionUser)['passwordChange'],
    ]);
}

if ($action === 'resend') {
    if (password_change_pending($userId) === null) {
        json_response([
            'success' => false,
            'message' => 'No active verification code was found. Request a new code.',
        ], 410);
    }

    $pending = password_change_issue_code($pdo, $sessionUser, true);
    write_auth_audit($pdo, $sessionUser, 'password.change_otp_resent', 'A password change verification code was resent.');

    json_response([
        'success' => true,
        'message' => 'A new verification code was sent.',
        'pending' => $pending,
        'passwordChange' => password_change_status_payload($pdo, $sessionUser)['passwordChange'],
    ]);
}

if ($action === 'verify') {
    password_change_apply(
        $pdo,
        $sessionUser,
        preg_replace('/\D+/', '', (string)($body['code'] ?? $body['otp'] ?? '')) ?? '',
        (string)($body['newPassword'] ?? ''),
        (string)($body['confirmPassword'] ?? '')
    );
}

if ($action === 'cancel') {
    password_change_clear_pending($userId);
    write_auth_audit($pdo, $sessionUser, 'password.change_cancelled', 'A user cancelled a pending password change.');

    json_response([
        'success' => true,
        'message' => 'Password change cancelled.',
        'passwordChange' => password_change_status_payload($pdo, $sessionUser)['passwordChange'],
    ]);
}

json_response([
    'success' => false,
    'message' => 'Unsupported action.',
], 400);
