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

function two_factor_mask_email(string $email): string
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

function two_factor_generate_code(): string
{
    return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

/*
 * The login OTP lives in the PHP session, not the database. It is single-browser, single-login
 * state that dies with the session anyway, so a table bought nothing: the hash, expiry and attempt
 * counter below are the whole record. Only the durable consequences still touch the database —
 * the lockout on `users` and the audit trail in `audit_logs`. This mirrors password_change.php.
 */

function two_factor_pending_login(): ?array
{
    return isset($_SESSION['pending_two_factor']) && is_array($_SESSION['pending_two_factor'])
        ? $_SESSION['pending_two_factor']
        : null;
}

/**
 * Records who is midway through verification, keeping any code already issued to the same user.
 */
function two_factor_set_pending_login(array $user): void
{
    $userId = (int)($user['id'] ?? 0);
    $pending = two_factor_pending_login();
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

function two_factor_clear_pending_login(): void
{
    unset($_SESSION['pending_two_factor']);
}

/**
 * Returns the open (unverified) code for the user, expired or not — callers distinguish an expired
 * code from a missing one so the user gets the right message.
 */
function two_factor_latest_open_code(int $userId): ?array
{
    $pending = two_factor_pending_login();

    if ($pending === null || (int)($pending['user_id'] ?? 0) !== $userId) {
        return null;
    }

    $code = $pending['code'] ?? null;

    return is_array($code) && ($code['otpHash'] ?? '') !== '' ? $code : null;
}

function two_factor_store_code(int $userId, string $otpHash, int $expiresInMinutes): void
{
    $pending = two_factor_pending_login();

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

function two_factor_invalidate_open_codes(int $userId): void
{
    $pending = two_factor_pending_login();

    if ($pending !== null && (int)($pending['user_id'] ?? 0) === $userId) {
        $_SESSION['pending_two_factor']['code'] = null;
    }
}

/**
 * Counts one wrong code against the open challenge and returns the new attempt total.
 */
function two_factor_record_failed_attempt(int $userId): int
{
    $code = two_factor_latest_open_code($userId);

    if ($code === null) {
        return 0;
    }

    $attempts = max(0, (int)($code['attempts'] ?? 0)) + 1;
    $_SESSION['pending_two_factor']['code']['attempts'] = $attempts;

    return $attempts;
}

function two_factor_code_payload(PDO $pdo, array $user, array $code): array
{
    $settings = two_factor_settings($pdo);
    $createdAt = (int)($code['createdAtTimestamp'] ?? 0);
    $resendAvailableAt = $createdAt > 0 ? $createdAt + $settings['resendDelaySeconds'] : time();
    $expiresAtTimestamp = (int)($code['expiresAtTimestamp'] ?? 0) ?: time();
    $attempts = max(0, (int)($code['attempts'] ?? 0));

    return [
        'maskedEmail' => two_factor_mask_email((string)($user['email'] ?? '')),
        'expiresInSeconds' => max(0, $expiresAtTimestamp - time()),
        'expiresAt' => date('Y-m-d H:i:s', $expiresAtTimestamp),
        'attemptsRemaining' => max(0, $settings['maxAttempts'] - $attempts),
        'maxAttempts' => $settings['maxAttempts'],
        'resendDelaySeconds' => $settings['resendDelaySeconds'],
        'resendAvailableInSeconds' => max(0, $resendAvailableAt - time()),
    ];
}

function two_factor_html_body(string $code, int $expiresInMinutes, ?string $logoContentId = null): string
{
    return mail_document([
        'title' => 'Security Verification Code',
        'preheader' => 'Use your 6-digit verification code to finish signing in to the MGB HRIS Portal.',
        'eyebrow' => 'Security Verification',
        'subtitle' => 'Region X Mines and Geosciences Bureau login verification',
        'logoContentId' => $logoContentId,
        'intro' => 'Your verification code is:',
        'blocks' => [
            mail_code_block(
                'Verification Code',
                $code,
                'This code expires in <strong>' . mail_escape(mail_minutes_label($expiresInMinutes)) . '</strong>.'
            ),
        ],
        'closing' => 'If you did not request this login, please ignore this email.',
        'footerNote' => 'This is an automated security message from the HRIS login verification service.',
    ]);
}

function two_factor_text_body(string $code, int $expiresInMinutes): string
{
    return "Your verification code is:\n\n"
        . "{$code}\n\n"
        . "This code expires in {$expiresInMinutes} minute" . ($expiresInMinutes === 1 ? '' : 's') . ".\n\n"
        . "If you did not request this login, please ignore this email.";
}

function two_factor_send_otp_email(string $recipientEmail, string $code, int $expiresInMinutes): void
{
    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = 'Security Verification Code';
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = two_factor_html_body($code, $expiresInMinutes, $logoContentId);
    $mail->AltBody = two_factor_text_body($code, $expiresInMinutes);
    send_configured_mail($mail);
}

/**
 * Sends a short account-activity notice using the shared branded shell.
 *
 * $tone picks the badge colour (success/danger/warning/info); $recipientName personalises the
 * greeting when the caller knows it.
 */
function two_factor_send_alert_email(
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

    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = $subject;
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = mail_notification_document($subject, $message, $tone, $logoContentId, $recipientName);
    $mail->AltBody = mail_notification_text($subject, $message);
    send_configured_mail($mail);
}

function two_factor_safe_alert_email(
    string $recipientEmail,
    string $subject,
    string $message,
    string $tone = 'info',
    string $recipientName = ''
): void {
    try {
        two_factor_send_alert_email($recipientEmail, $subject, $message, $tone, $recipientName);
    } catch (Throwable $exception) {
        error_log('2FA alert email error: ' . $exception->getMessage());
    }
}

function two_factor_notify_user(PDO $pdo, int $userId, string $title, string $message, string $type): void
{
    if ($userId <= 0 || !function_exists('notification_insert')) {
        return;
    }

    try {
        notification_insert($pdo, $userId, $title, $message, $type);
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
function two_factor_notify_admins_of_login(PDO $pdo, array $sessionUser, bool $withTwoFactor = false): void
{
    if (!function_exists('notify_users') || !function_exists('user_ids_for_role_keys')) {
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
            user_ids_for_role_keys($pdo, ['admin']),
            static fn (int $userId): bool => $userId !== $actorId
        ));

        if ($recipients === []) {
            return;
        }

        notify_users(
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

function two_factor_issue_code(PDO $pdo, array $user, bool $enforceResendDelay = false): array
{
    ensure_two_factor_schema($pdo);

    $userId = (int)($user['id'] ?? 0);
    $email = trim((string)($user['email'] ?? ''));

    if ($userId <= 0 || $email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        write_auth_audit($pdo, $user, 'two_factor.otp_missing_email', 'A 2FA code could not be issued because the account has no valid email address.', [
            'username' => $user['username'] ?? null,
        ]);

        throw new RuntimeException('A valid registered email address is required for 2FA.');
    }

    $settings = two_factor_settings($pdo);
    $latestCode = two_factor_latest_open_code($userId);

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

    // The resend delay controls cadence; the administrator's Two-factor codes rule controls the
    // total allowed inside its configured window. It has its own bucket, so these requests do not
    // consume the user's separate OTP-submission allowance.
    if ($enforceResendDelay) {
        throttle_two_factor_resend($pdo);
    }

    $code = two_factor_generate_code();

    // The identity has to be in the session before the code, because the code hangs off it.
    two_factor_set_pending_login($user);
    two_factor_store_code($userId, password_hash($code, PASSWORD_DEFAULT), $settings['otpExpiryMinutes']);

    try {
        two_factor_send_otp_email($email, $code, $settings['otpExpiryMinutes']);
    } catch (Throwable $exception) {
        two_factor_invalidate_open_codes($userId);
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
    two_factor_notify_user(
        $pdo,
        $userId,
        'Security verification code sent',
        'A login verification code was sent to your registered email address.',
        'two_factor_otp'
    );

    $freshCode = two_factor_latest_open_code($userId);

    return $freshCode ? two_factor_code_payload($pdo, $user, $freshCode) : [];
}

function two_factor_lock_account(PDO $pdo, int $userId): void
{
    if ($userId <= 0) {
        return;
    }

    ensure_user_security_columns($pdo);
    $settings = security_settings($pdo);
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

function two_factor_notify_settings_changed(PDO $pdo, array $actor, array $settings): void
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

    notify_roles($pdo, ['admin'], '2FA settings changed', $summary, 'two_factor_settings');

    $statement = $pdo->query(
        'SELECT u.id, u.email
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE u.is_archived = 0
           AND LOWER(u.status) = "active"
           AND LOWER(REPLACE(r.name, " ", "")) IN ("admin", "administrator", "superadmin")'
    );

    foreach ($statement->fetchAll() as $admin) {
        two_factor_safe_alert_email(
            (string)($admin['email'] ?? ''),
            '2FA Settings Changed',
            $message
        );
    }
}

/*
 * ---------------------------------------------------------------------------
 * Endpoint
 * ---------------------------------------------------------------------------
 *
 * Everything above is the library half, require_once'd by login.php, settings.php,
 * password_change.php and email_verification.php. Everything below answers the three
 * requests the front end makes, split by ?action=:
 *
 *   POST ?action=verify   the OTP submitted at the login step (no session yet)
 *   POST ?action=resend   a fresh OTP for the same pending login (no session yet)
 *   GET / PUT / POST      the Security tab's personal 2FA setting (session required)
 *
 * The same shape settings.php uses, and for the same reason: a file that is both an
 * include and an endpoint must not run its router when it is being included. This
 * folds two_factor_verify.php, two_factor_resend.php and two_factor_profile.php into
 * one file the way app_settings.php was folded into settings.php.
 */

/**
 * True only when this file is the script the web server was actually asked for.
 *
 * Every other request arrives here through a require_once and must get the library
 * above without the endpoint below ever running.
 */
function two_factor_is_direct_request(): bool
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

if (!two_factor_is_direct_request()) {
    return;
}

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/email-domain-policy.php';

function two_factor_profile_payload(PDO $pdo, array $sessionUser): array
{
    $userId = (int)($sessionUser['id'] ?? 0);
    ensure_two_factor_schema($pdo);
    ensure_audit_logs_table($pdo);

    $statement = $pdo->prepare(
        'SELECT two_factor_enabled
         FROM users
         WHERE id = :id
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $userId]);
    $personalEnabled = (bool)((int)$statement->fetchColumn());

    // The 2FA trail lives in audit_logs, which already carries richer request context
    // (location, device, browser) than the retired two_factor_logs table ever did.
    $lastVerificationStatement = $pdo->prepare(
        'SELECT created_at
         FROM audit_logs
         WHERE user_id = :user_id
           AND action = "two_factor.verify_success"
         ORDER BY created_at DESC, id DESC
         LIMIT 1'
    );
    $lastVerificationStatement->execute([':user_id' => $userId]);

    $activityStatement = $pdo->prepare(
        'SELECT
            action,
            summary,
            ip_address AS ipAddress,
            device,
            browser,
            created_at AS createdAt
         FROM audit_logs
         WHERE user_id = :user_id
           AND category = "auth"
         ORDER BY created_at DESC, id DESC
         LIMIT 12'
    );
    $activityStatement->execute([':user_id' => $userId]);

    return [
        'success' => true,
        'user' => $sessionUser,
        'twoFactor' => [
            'personalEnabled' => $personalEnabled,
            'systemSettings' => two_factor_settings($pdo),
            'requiredForCurrentUser' => two_factor_required($pdo, array_merge($sessionUser, [
                'two_factor_enabled' => $personalEnabled,
            ])),
            'lastVerificationAt' => $lastVerificationStatement->fetchColumn() ?: null,
            'loginActivity' => $activityStatement->fetchAll(),
        ],
    ];
}

/**
 * GET returns the Security tab payload; PUT/POST flips the personal 2FA switch.
 */
function two_factor_handle_profile(PDO $pdo): void
{
    // Keeps the session open: toggling 2FA rewrites $_SESSION['user'].
    $sessionUser = require_session_user(keepSessionOpen: true);
    $userId = (int)($sessionUser['id'] ?? 0);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        json_response(two_factor_profile_payload($pdo, $sessionUser));
    }

    if ($method === 'PUT' || $method === 'POST') {
        $body = read_json_body();
        $enabled = boolean_value($body['personalEnabled'] ?? ($body['enabled'] ?? null), false);

        $statement = $pdo->prepare(
            'UPDATE users
             SET two_factor_enabled = :enabled
             WHERE id = :id
               AND is_archived = 0'
        );
        $statement->execute([
            ':enabled' => $enabled ? 1 : 0,
            ':id' => $userId,
        ]);

        write_auth_audit($pdo, $sessionUser, 'two_factor.personal_setting_updated', 'A user updated their personal 2FA setting.', [
            'enabled' => $enabled,
        ]);
        two_factor_notify_user(
            $pdo,
            $userId,
            '2FA preference updated',
            $enabled ? 'Personal two-factor authentication was enabled.' : 'Personal two-factor authentication was disabled.',
            'two_factor_profile'
        );
        two_factor_safe_alert_email(
            (string)($sessionUser['email'] ?? ''),
            '2FA Preference Updated',
            $enabled
                ? 'Personal two-factor authentication was enabled for your MGB HRIS account.'
                : 'Personal two-factor authentication was disabled for your MGB HRIS account.'
        );

        $freshUser = refresh_session_user($sessionUser) ?? $sessionUser;
        $_SESSION['user'] = $freshUser;

        json_response(two_factor_profile_payload($pdo, $freshUser));
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
}

/**
 * Issues a replacement OTP for the login already pending in the session.
 */
function two_factor_handle_resend(PDO $pdo): void
{
    require_method('POST');

    $pending = two_factor_pending_login();
    $userId = (int)($pending['user_id'] ?? 0);

    if ($pending === null || $userId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Your verification session expired. Please sign in again.',
        ], 401);
    }

    $user = session_user_record($pdo, $userId);

    if (!$user || strtolower((string)($user['status'] ?? '')) !== 'active') {
        two_factor_clear_pending_login();
        write_auth_audit($pdo, ['id' => $userId], 'two_factor.resend_invalid_session', 'A 2FA resend was rejected because the account is no longer available.');
        json_response([
            'success' => false,
            'message' => 'Your account is no longer available for verification.',
        ], 403);
    }

    $emailPolicyViolation = email_domain_policy_violation($pdo, (string)($user['email'] ?? ''));
    if ($emailPolicyViolation !== null) {
        two_factor_clear_pending_login();
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
        $challenge = two_factor_issue_code($pdo, $user, true);
    } catch (TwoFactorRateLimitException $exception) {
        $codeRow = two_factor_latest_open_code($userId);

        json_response([
            'success' => false,
            'message' => $exception->getMessage(),
            'resendAvailableInSeconds' => $exception->secondsRemaining,
            'twoFactor' => $codeRow ? two_factor_code_payload($pdo, $user, $codeRow) : null,
        ], 429);
    } catch (Throwable $exception) {
        json_response([
            'success' => false,
            'message' => 'Unable to send verification code. Check SMTP settings and try again.',
            'error' => $exception->getMessage(),
        ], 500);
    }

    json_response([
        'success' => true,
        'message' => 'A new verification code was sent.',
        'twoFactor' => $challenge,
    ]);
}

/**
 * Checks the submitted OTP and, on success, promotes the pending login to a real session.
 */
function two_factor_handle_verify(PDO $pdo): void
{
    require_method('POST');

    $body = read_json_body();
    $code = preg_replace('/\D+/', '', (string)($body['code'] ?? $body['otp'] ?? '')) ?? '';

    if (!preg_match('/^\d{6}$/', $code)) {
        json_response([
            'success' => false,
            'message' => 'Enter the 6-digit verification code.',
        ], 422);
    }

    throttle_two_factor($pdo);

    $pending = two_factor_pending_login();
    $userId = (int)($pending['user_id'] ?? 0);

    if ($pending === null || $userId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Your verification session expired. Please sign in again.',
        ], 401);
    }

    ensure_two_factor_schema($pdo);

    $user = session_user_record($pdo, $userId);

    if (!$user || strtolower((string)($user['status'] ?? '')) !== 'active') {
        two_factor_clear_pending_login();
        write_auth_audit($pdo, ['id' => $userId], 'two_factor.verify_invalid_session', 'A 2FA verification was rejected because the account is no longer available.');
        json_response([
            'success' => false,
            'message' => 'Your account is no longer available for verification.',
        ], 403);
    }

    $emailPolicyViolation = email_domain_policy_violation($pdo, (string)($user['email'] ?? ''));
    if ($emailPolicyViolation !== null) {
        two_factor_clear_pending_login();
        write_auth_audit($pdo, $user, 'login.email_domain_blocked', 'A 2FA verification was blocked by the email domain policy.', [
            'username' => $user['username'] ?? null,
            'email' => $user['email'] ?? null,
        ]);

        json_response([
            'success' => false,
            'message' => $emailPolicyViolation,
        ], 403);
    }

    $settings = two_factor_settings($pdo);
    $codeRow = two_factor_latest_open_code($userId);

    if (!$codeRow) {
        write_auth_audit($pdo, $user, 'two_factor.verify_missing_code', 'A 2FA code was submitted with no active challenge.', [
            'username' => $user['username'] ?? null,
        ]);

        json_response([
            'success' => false,
            'message' => 'No active verification code was found. Request a new code.',
        ], 410);
    }

    $expiresAt = (int)($codeRow['expiresAtTimestamp'] ?? 0);

    if ($expiresAt <= 0 || $expiresAt < time()) {
        two_factor_invalidate_open_codes($userId);
        write_auth_audit($pdo, $user, 'two_factor.verify_expired', 'An expired 2FA code was submitted.', [
            'username' => $user['username'] ?? null,
        ]);

        json_response([
            'success' => false,
            'message' => 'This verification code has expired. Request a new code.',
            'expired' => true,
            'twoFactor' => two_factor_code_payload($pdo, $user, $codeRow),
        ], 410);
    }

    $attempts = max(0, (int)($codeRow['attempts'] ?? 0));

    if ($attempts >= $settings['maxAttempts']) {
        two_factor_lock_account($pdo, $userId);
        two_factor_invalidate_open_codes($userId);
        two_factor_clear_pending_login();
        write_auth_audit($pdo, $user, 'two_factor.verify_locked', 'An account was locked after too many 2FA attempts.', [
            'username' => $user['username'] ?? null,
            'attempts' => $attempts,
        ]);

        json_response([
            'success' => false,
            'message' => 'Too many verification attempts. This account is temporarily locked.',
        ], 423);
    }

    $matches = password_verify($code, (string)($codeRow['otpHash'] ?? ''));

    if (!$matches) {
        $nextAttempts = two_factor_record_failed_attempt($userId);
        $remainingAttempts = max(0, $settings['maxAttempts'] - $nextAttempts);
        write_auth_audit($pdo, $user, 'two_factor.verify_failed', 'A 2FA verification attempt failed.', [
            'username' => $user['username'] ?? null,
            'attempts' => $nextAttempts,
        ]);

        if ($nextAttempts >= 2) {
            // Deferred for the same reason as the success path: whoever mistyped the code should be
            // told so immediately, not after an SMTP round trip they are not waiting on.
            $alertEmail = (string)($user['email'] ?? '');
            defer(static function () use ($alertEmail): void {
                two_factor_safe_alert_email(
                    $alertEmail,
                    'Multiple Failed Verification Attempts',
                    'Multiple failed 2FA verification attempts were detected on your MGB HRIS account. If this was not you, contact the HRIS administrator immediately.'
                );
            });
            two_factor_notify_user(
                $pdo,
                $userId,
                'Failed 2FA attempts detected',
                'Multiple failed verification attempts were detected on your account.',
                'two_factor_failed'
            );
        }

        if ($remainingAttempts <= 0) {
            two_factor_lock_account($pdo, $userId);
            two_factor_invalidate_open_codes($userId);
            two_factor_clear_pending_login();
            write_auth_audit($pdo, $user, 'two_factor.verify_locked', 'An account was locked after too many 2FA attempts.', [
                'username' => $user['username'] ?? null,
                'attempts' => $nextAttempts,
            ]);

            json_response([
                'success' => false,
                'message' => 'Too many verification attempts. This account is temporarily locked.',
                'attemptsRemaining' => 0,
            ], 423);
        }

        $freshCode = two_factor_latest_open_code($userId);

        json_response([
            'success' => false,
            'message' => 'Invalid verification code.',
            'attemptsRemaining' => $remainingAttempts,
            'twoFactor' => $freshCode ? two_factor_code_payload($pdo, $user, $freshCode) : null,
        ], 401);
    }

    two_factor_invalidate_open_codes($userId);

    $sessionUser = format_user($user);
    session_regenerate_id(true);
    $_SESSION['user'] = $sessionUser;
    $_SESSION['last_activity_at'] = time();
    $_SESSION['two_factor_verified_at'] = time();
    two_factor_clear_pending_login();

    // Recorded as its own action so the profile Security tab can find the last successful verification.
    write_auth_audit($pdo, $sessionUser, 'two_factor.verify_success', 'A 2FA verification code was accepted.', [
        'username' => $sessionUser['username'],
    ]);
    write_auth_audit($pdo, $sessionUser, 'login.success', 'A user signed in successfully after 2FA verification.', [
        'username' => $sessionUser['username'],
        'two_factor' => true,
    ]);
    two_factor_notify_admins_of_login($pdo, $sessionUser, true);

    // Sent after the response, for the reason spelled out in login.php.
    $loginAlertEmail = (string)($sessionUser['email'] ?? '');
    defer(static function () use ($loginAlertEmail): void {
        two_factor_safe_alert_email(
            $loginAlertEmail,
            'New Login Detected',
            'A successful login to your MGB HRIS account was completed with two-factor verification. If this was not you, contact the HRIS administrator immediately.'
        );
    });

    // The second of the two places a session is created, and so the second place that used to mint a
    // bearer-token pair. That path has been removed; see the note over the same spot in login.php.
    json_response([
        'success' => true,
        'message' => 'Verification successful.',
        'user' => $sessionUser,
    ]);
}

$action = strtolower(trim((string)($_GET['action'] ?? '')));

// Verify and resend run for a caller who is midway through signing in and has no session user
// yet, so they are dispatched ahead of the profile handler's require_session_user().
if ($action === 'verify') {
    two_factor_handle_verify($pdo);
}

if ($action === 'resend') {
    two_factor_handle_resend($pdo);
}

// No action, or one this build does not know: the personal-setting endpoint, which is what an
// older client calling this file without a query string means.
two_factor_handle_profile($pdo);
