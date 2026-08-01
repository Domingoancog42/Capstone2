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

function hris_two_factor_request_ip(): ?string
{
    if (function_exists('hris_audit_request_context')) {
        $context = hris_audit_request_context();
        return $context['ipAddress'] ?? null;
    }

    $ipAddress = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));

    return $ipAddress !== '' ? $ipAddress : null;
}

function hris_two_factor_log(PDO $pdo, ?int $userId, string $action, string $status): void
{
    try {
        hris_ensure_two_factor_tables($pdo);

        $statement = $pdo->prepare(
            'INSERT INTO two_factor_logs (user_id, ip_address, action, status)
             VALUES (:user_id, :ip_address, :action, :status)'
        );
        $statement->execute([
            ':user_id' => $userId && $userId > 0 ? $userId : null,
            ':ip_address' => hris_two_factor_request_ip(),
            ':action' => substr($action, 0, 80),
            ':status' => substr($status, 0, 40),
        ]);
    } catch (Throwable $exception) {
        error_log('2FA log error: ' . $exception->getMessage());
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

function hris_two_factor_pending_login(): ?array
{
    return isset($_SESSION['pending_two_factor']) && is_array($_SESSION['pending_two_factor'])
        ? $_SESSION['pending_two_factor']
        : null;
}

function hris_two_factor_set_pending_login(array $user): void
{
    $_SESSION['pending_two_factor'] = [
        'user_id' => (int)($user['id'] ?? 0),
        'username' => (string)($user['username'] ?? ''),
        'email' => (string)($user['email'] ?? ''),
        'started_at' => time(),
    ];
}

function hris_two_factor_clear_pending_login(): void
{
    unset($_SESSION['pending_two_factor']);
}

function hris_two_factor_latest_open_code(PDO $pdo, int $userId): ?array
{
    hris_ensure_two_factor_tables($pdo);

    $statement = $pdo->prepare(
        'SELECT
            id,
            otp_hash,
            expires_at,
            attempts,
            verified,
            created_at,
            UNIX_TIMESTAMP(created_at) AS created_at_timestamp
         FROM user_two_factor_codes
         WHERE user_id = :user_id
           AND verified = 0
         ORDER BY id DESC
         LIMIT 1'
    );
    $statement->execute([':user_id' => $userId]);
    $code = $statement->fetch();

    return $code ?: null;
}

function hris_two_factor_invalidate_open_codes(PDO $pdo, int $userId): void
{
    $statement = $pdo->prepare(
        'UPDATE user_two_factor_codes
         SET verified = 1
         WHERE user_id = :user_id
           AND verified = 0'
    );
    $statement->execute([':user_id' => $userId]);
}

function hris_two_factor_code_payload(PDO $pdo, array $user, array $codeRow): array
{
    $settings = hris_two_factor_settings($pdo);
    $createdAt = (int)($codeRow['created_at_timestamp'] ?? 0);
    $resendAvailableAt = $createdAt > 0 ? $createdAt + $settings['resendDelaySeconds'] : time();
    $expiresAtTimestamp = hris_datetime_timestamp($codeRow['expires_at'] ?? null) ?? time();
    $attempts = max(0, (int)($codeRow['attempts'] ?? 0));

    return [
        'maskedEmail' => hris_two_factor_mask_email((string)($user['email'] ?? '')),
        'expiresInSeconds' => max(0, $expiresAtTimestamp - time()),
        'expiresAt' => $codeRow['expires_at'] ?? null,
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

function hris_two_factor_issue_code(PDO $pdo, array $user, bool $enforceResendDelay = false): array
{
    hris_ensure_two_factor_tables($pdo);

    $userId = (int)($user['id'] ?? 0);
    $email = trim((string)($user['email'] ?? ''));

    if ($userId <= 0 || $email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        hris_two_factor_log($pdo, $userId > 0 ? $userId : null, 'otp_requested', 'missing_email');
        throw new RuntimeException('A valid registered email address is required for 2FA.');
    }

    $settings = hris_two_factor_settings($pdo);
    $latestCode = hris_two_factor_latest_open_code($pdo, $userId);

    if ($enforceResendDelay && $latestCode) {
        $createdAt = (int)($latestCode['created_at_timestamp'] ?? 0);
        $secondsRemaining = $createdAt > 0
            ? ($createdAt + $settings['resendDelaySeconds']) - time()
            : 0;

        if ($secondsRemaining > 0) {
            hris_two_factor_log($pdo, $userId, 'otp_resend', 'rate_limited');
            throw new TwoFactorRateLimitException('Please wait before requesting another verification code.', $secondsRemaining);
        }
    }

    $code = hris_two_factor_generate_code();
    $expiresAt = date('Y-m-d H:i:s', time() + ($settings['otpExpiryMinutes'] * 60));

    hris_two_factor_invalidate_open_codes($pdo, $userId);

    $statement = $pdo->prepare(
        'INSERT INTO user_two_factor_codes (user_id, otp_hash, expires_at, attempts, verified)
         VALUES (:user_id, :otp_hash, :expires_at, 0, 0)'
    );
    $statement->execute([
        ':user_id' => $userId,
        ':otp_hash' => password_hash($code, PASSWORD_DEFAULT),
        ':expires_at' => $expiresAt,
    ]);

    try {
        hris_two_factor_send_otp_email($email, $code, $settings['otpExpiryMinutes']);
    } catch (Throwable $exception) {
        hris_two_factor_invalidate_open_codes($pdo, $userId);
        hris_two_factor_log($pdo, $userId, 'otp_requested', 'email_failed');
        throw $exception;
    }

    hris_two_factor_set_pending_login($user);
    hris_two_factor_log($pdo, $userId, $enforceResendDelay ? 'otp_resend' : 'otp_requested', 'sent');
    hris_two_factor_notify_user(
        $pdo,
        $userId,
        'Security verification code sent',
        'A login verification code was sent to your registered email address.',
        'two_factor_otp'
    );

    $freshCode = hris_two_factor_latest_open_code($pdo, $userId);

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
