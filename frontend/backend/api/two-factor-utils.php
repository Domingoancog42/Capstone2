<?php
declare(strict_types=1);

require_once __DIR__ . '/password-reset-utils.php';

if (!class_exists('TwoFactorRateLimitException')) {
    class TwoFactorRateLimitException extends RuntimeException
    {
        public int $secondsRemaining;

        public function __construct(string $message, int $secondsRemaining)
        {
            parent::__construct($message);
            $this->secondsRemaining = max(0, $secondsRemaining);
        }
    }
}

function hris_two_factor_mask_email(string $email): string
{
    $email = trim($email);
    $parts = explode('@', $email, 2);

    if (count($parts) !== 2) {
        return $email;
    }

    [$localPart, $domain] = $parts;
    $visible = max(2, min(3, strlen($localPart)));
    $maskedLocal = substr($localPart, 0, $visible) . str_repeat('*', max(3, strlen($localPart) - $visible));

    return $maskedLocal . '@' . $domain;
}

function hris_two_factor_generate_code(): string
{
    return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

/*
 * The login OTP lives in the PHP session, not the database. It is single-browser, single-login
 * state that dies with the session anyway, so a table bought nothing: the hash, expiry and attempt
 * counter below are the whole record. Only the durable consequences still touch the database —
 * the lockout on `users` and the audit trail in `audit_logs`. This mirrors password_change.php.
 */

function hris_two_factor_pending_login(): ?array
{
    return isset($_SESSION['pending_two_factor']) && is_array($_SESSION['pending_two_factor'])
        ? $_SESSION['pending_two_factor']
        : null;
}

/**
 * Records who is midway through verification, keeping any code already issued to the same user.
 */
function hris_two_factor_set_pending_login(array $user): void
{
    $userId = (int)($user['id'] ?? 0);
    $pending = hris_two_factor_pending_login();
    $existingCode = $pending !== null && (int)($pending['user_id'] ?? 0) === $userId
        ? ($pending['code'] ?? null)
        : null;

    $_SESSION['pending_two_factor'] = [
        'user_id' => $userId,
        'username' => (string)($user['username'] ?? ''),
        'email' => (string)($user['email'] ?? ''),
        'started_at' => time(),
        'code' => is_array($existingCode) ? $existingCode : null,
    ];
}

function hris_two_factor_clear_pending_login(): void
{
    unset($_SESSION['pending_two_factor']);
}

/**
 * Returns the open (unverified) code for the user, expired or not — callers distinguish an expired
 * code from a missing one so the user gets the right message.
 */
function hris_two_factor_latest_open_code(int $userId): ?array
{
    $pending = hris_two_factor_pending_login();

    if ($pending === null || (int)($pending['user_id'] ?? 0) !== $userId) {
        return null;
    }

    $code = $pending['code'] ?? null;

    return is_array($code) && ($code['otpHash'] ?? '') !== '' ? $code : null;
}

function hris_two_factor_store_code(int $userId, string $otpHash, int $expiresInMinutes): void
{
    $pending = hris_two_factor_pending_login();

    if ($pending === null || (int)($pending['user_id'] ?? 0) !== $userId) {
        return;
    }

    $createdAtTimestamp = time();

    $_SESSION['pending_two_factor']['code'] = [
        'otpHash' => $otpHash,
        'createdAtTimestamp' => $createdAtTimestamp,
        'expiresAtTimestamp' => $createdAtTimestamp + ($expiresInMinutes * 60),
        'attempts' => 0,
    ];
}

function hris_two_factor_invalidate_open_codes(int $userId): void
{
    $pending = hris_two_factor_pending_login();

    if ($pending !== null && (int)($pending['user_id'] ?? 0) === $userId) {
        $_SESSION['pending_two_factor']['code'] = null;
    }
}

/**
 * Counts one wrong code against the open challenge and returns the new attempt total.
 */
function hris_two_factor_record_failed_attempt(int $userId): int
{
    $code = hris_two_factor_latest_open_code($userId);

    if ($code === null) {
        return 0;
    }

    $attempts = max(0, (int)($code['attempts'] ?? 0)) + 1;
    $_SESSION['pending_two_factor']['code']['attempts'] = $attempts;

    return $attempts;
}

function hris_two_factor_code_payload(PDO $pdo, array $user, array $code): array
{
    $settings = hris_two_factor_settings($pdo);
    $createdAt = (int)($code['createdAtTimestamp'] ?? 0);
    $resendAvailableAt = $createdAt > 0 ? $createdAt + $settings['resendDelaySeconds'] : time();
    $expiresAtTimestamp = (int)($code['expiresAtTimestamp'] ?? 0) ?: time();
    $attempts = max(0, (int)($code['attempts'] ?? 0));

    return [
        'maskedEmail' => hris_two_factor_mask_email((string)($user['email'] ?? '')),
        'expiresInSeconds' => max(0, $expiresAtTimestamp - time()),
        'expiresAt' => date('Y-m-d H:i:s', $expiresAtTimestamp),
        'attemptsRemaining' => max(0, $settings['maxAttempts'] - $attempts),
        'maxAttempts' => $settings['maxAttempts'],
        'resendDelaySeconds' => $settings['resendDelaySeconds'],
        'resendAvailableInSeconds' => max(0, $resendAvailableAt - time()),
    ];
}

function hris_two_factor_html_body(string $code, int $expiresInMinutes, ?string $logoContentId = null): string
{
    return hris_mail_document([
        'title' => 'Security Verification Code',
        'preheader' => 'Use your 6-digit verification code to finish signing in to the MGB HRIS Portal.',
        'eyebrow' => 'Security Verification',
        'subtitle' => 'Region X Mines and Geosciences Bureau login verification',
        'logoContentId' => $logoContentId,
        'intro' => 'Your verification code is:',
        'blocks' => [
            hris_mail_code_block(
                'Verification Code',
                $code,
                'This code expires in <strong>' . hris_mail_escape(hris_mail_minutes_label($expiresInMinutes)) . '</strong>.'
            ),
        ],
        'closing' => 'If you did not request this login, please ignore this email.',
        'footerNote' => 'This is an automated security message from the HRIS login verification service.',
    ]);
}

function hris_two_factor_text_body(string $code, int $expiresInMinutes): string
{
    return "Your verification code is:\n\n"
        . "{$code}\n\n"
        . "This code expires in {$expiresInMinutes} minute" . ($expiresInMinutes === 1 ? '' : 's') . ".\n\n"
        . "If you did not request this login, please ignore this email.";
}

function hris_two_factor_send_otp_email(string $recipientEmail, string $code, int $expiresInMinutes): void
{
    $mail = hris_configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = 'Security Verification Code';
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = hris_two_factor_html_body($code, $expiresInMinutes, $logoContentId);
    $mail->AltBody = hris_two_factor_text_body($code, $expiresInMinutes);
    $mail->send();
}

/**
 * Sends a short account-activity notice using the shared branded shell.
 *
 * $tone picks the badge colour (success/danger/warning/info); $recipientName personalises the
 * greeting when the caller knows it.
 */
function hris_two_factor_send_alert_email(
    string $recipientEmail,
    string $subject,
    string $message,
    string $tone = 'info',
    string $recipientName = ''
): void {
    $recipientEmail = trim($recipientEmail);

    if ($recipientEmail === '') {
        return;
    }

    $mail = hris_configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = $subject;
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = hris_mail_notification_document($subject, $message, $tone, $logoContentId, $recipientName);
    $mail->AltBody = hris_mail_notification_text($subject, $message);
    $mail->send();
}

function hris_two_factor_safe_alert_email(
    string $recipientEmail,
    string $subject,
    string $message,
    string $tone = 'info',
    string $recipientName = ''
): void {
    try {
        hris_two_factor_send_alert_email($recipientEmail, $subject, $message, $tone, $recipientName);
    } catch (Throwable $exception) {
        error_log('2FA alert email error: ' . $exception->getMessage());
    }
}

function hris_two_factor_notify_user(PDO $pdo, int $userId, string $title, string $message, string $type): void
{
    if ($userId <= 0 || !function_exists('hris_notification_insert')) {
        return;
    }

    try {
        hris_notification_insert($pdo, $userId, $title, $message, $type);
    } catch (Throwable $exception) {
        error_log('2FA notification error: ' . $exception->getMessage());
    }
}

/**
 * A successful sign-in is an administrative security event, not personal news for the account
 * holder — whoever just signed in already knows they did. It goes to the administrators instead,
 * naming who signed in, and the actor is dropped from the recipients so nobody is ever notified
 * about their own login. The account holder still gets the "was this you?" e-mail separately.
 */
function hris_two_factor_notify_admins_of_login(PDO $pdo, array $sessionUser, bool $withTwoFactor = false): void
{
    if (!function_exists('hris_notify_users') || !function_exists('hris_user_ids_for_role_keys')) {
        return;
    }

    $actorId = (int)($sessionUser['id'] ?? 0);
    $username = trim((string)($sessionUser['username'] ?? ''));
    $fullName = trim((string)($sessionUser['full_name'] ?? ''));
    $role = trim((string)($sessionUser['role'] ?? ''));

    // Name the account first, then qualify it — without repeating the username when it is the name.
    $displayName = $fullName !== '' ? $fullName : ($username !== '' ? $username : 'A user');
    $qualifiers = array_filter([$fullName !== '' ? $username : '', $role]);
    $qualifier = $qualifiers !== [] ? sprintf(' (%s)', implode(', ', $qualifiers)) : '';

    try {
        $recipients = array_values(array_filter(
            hris_user_ids_for_role_keys($pdo, ['admin']),
            static fn (int $userId): bool => $userId !== $actorId
        ));

        if ($recipients === []) {
            return;
        }

        hris_notify_users(
            $pdo,
            $recipients,
            'New login detected',
            sprintf(
                '%s%s signed in%s.',
                $displayName,
                $qualifier,
                $withTwoFactor ? ' with 2FA verification' : ''
            ),
            'login_detected',
            $actorId > 0 ? (string)$actorId : null
        );
    } catch (Throwable $exception) {
        error_log('Login notification error: ' . $exception->getMessage());
    }
}

function hris_two_factor_issue_code(PDO $pdo, array $user, bool $enforceResendDelay = false): array
{
    hris_ensure_two_factor_schema($pdo);

    $userId = (int)($user['id'] ?? 0);
    $email = trim((string)($user['email'] ?? ''));

    if ($userId <= 0 || $email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        write_auth_audit($pdo, $user, 'two_factor.otp_missing_email', 'A 2FA code could not be issued because the account has no valid email address.', [
            'username' => $user['username'] ?? null,
        ]);

        throw new RuntimeException('A valid registered email address is required for 2FA.');
    }

    $settings = hris_two_factor_settings($pdo);
    $latestCode = hris_two_factor_latest_open_code($userId);

    if ($enforceResendDelay && $latestCode) {
        $createdAt = (int)($latestCode['createdAtTimestamp'] ?? 0);
        $secondsRemaining = $createdAt > 0
            ? ($createdAt + $settings['resendDelaySeconds']) - time()
            : 0;

        if ($secondsRemaining > 0) {
            write_auth_audit($pdo, $user, 'two_factor.otp_rate_limited', 'A 2FA resend was throttled by the resend delay.', [
                'username' => $user['username'] ?? null,
                'secondsRemaining' => $secondsRemaining,
            ]);

            throw new TwoFactorRateLimitException('Please wait before requesting another verification code.', $secondsRemaining);
        }
    }

    $code = hris_two_factor_generate_code();

    // The identity has to be in the session before the code, because the code hangs off it.
    hris_two_factor_set_pending_login($user);
    hris_two_factor_store_code($userId, password_hash($code, PASSWORD_DEFAULT), $settings['otpExpiryMinutes']);

    try {
        hris_two_factor_send_otp_email($email, $code, $settings['otpExpiryMinutes']);
    } catch (Throwable $exception) {
        hris_two_factor_invalidate_open_codes($userId);
        write_auth_audit($pdo, $user, 'two_factor.otp_email_failed', 'A 2FA verification code could not be emailed.', [
            'username' => $user['username'] ?? null,
            'error' => $exception->getMessage(),
        ]);

        throw $exception;
    }

    write_auth_audit(
        $pdo,
        $user,
        $enforceResendDelay ? 'two_factor.otp_resent' : 'two_factor.otp_sent',
        $enforceResendDelay
            ? 'A 2FA verification code was resent.'
            : 'A 2FA verification code was emailed.',
        ['username' => $user['username'] ?? null]
    );
    hris_two_factor_notify_user(
        $pdo,
        $userId,
        'Security verification code sent',
        'A login verification code was sent to your registered email address.',
        'two_factor_otp'
    );

    $freshCode = hris_two_factor_latest_open_code($userId);

    return $freshCode ? hris_two_factor_code_payload($pdo, $user, $freshCode) : [];
}

function hris_two_factor_lock_account(PDO $pdo, int $userId): void
{
    if ($userId <= 0) {
        return;
    }

    hris_ensure_user_security_columns($pdo);
    $settings = hris_security_settings($pdo);
    $lockedUntil = date('Y-m-d H:i:s', time() + ($settings['lockoutDurationMinutes'] * 60));
    $statement = $pdo->prepare(
        'UPDATE users
         SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = :locked_until
         WHERE id = :id'
    );
    $statement->execute([
        ':locked_until' => $lockedUntil,
        ':id' => $userId,
    ]);
}

function hris_two_factor_notify_settings_changed(PDO $pdo, array $actor, array $settings): void
{
    $actorName = trim((string)($actor['username'] ?? $actor['full_name'] ?? 'An administrator'));
    $summary = 'Two-factor authentication settings were updated by ' . $actorName . '.';
    $roleSummary = [];

    if (!empty($settings['requireAdmins'])) {
        $roleSummary[] = 'Administrators';
    }
    if (!empty($settings['requireHr'])) {
        $roleSummary[] = 'HR';
    }
    if (!empty($settings['requireManagers'])) {
        $roleSummary[] = 'Managers';
    }
    if (!empty($settings['requireAllUsers'])) {
        $roleSummary[] = 'All users';
    }

    $message = $summary . "\n\n"
        . 'System 2FA: ' . (!empty($settings['enabled']) ? 'Enabled' : 'Disabled') . "\n"
        . 'Required for: ' . ($roleSummary === [] ? 'Personal opt-in users only' : implode(', ', $roleSummary)) . "\n"
        . 'OTP expiry: ' . (int)($settings['otpExpiryMinutes'] ?? 5) . " minutes\n"
        . 'Max attempts: ' . (int)($settings['maxAttempts'] ?? 3) . "\n"
        . 'Resend delay: ' . (int)($settings['resendDelaySeconds'] ?? 30) . ' seconds';

    hris_notify_roles($pdo, ['admin'], '2FA settings changed', $summary, 'two_factor_settings');

    $statement = $pdo->query(
        'SELECT u.id, u.email
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN status s ON s.id = u.status_id
         WHERE u.is_archived = 0
           AND LOWER(s.name) = "active"
           AND LOWER(REPLACE(r.name, " ", "")) IN ("admin", "administrator", "superadmin")'
    );

    foreach ($statement->fetchAll() as $admin) {
        hris_two_factor_safe_alert_email(
            (string)($admin['email'] ?? ''),
            '2FA Settings Changed',
            $message
        );
    }
}
