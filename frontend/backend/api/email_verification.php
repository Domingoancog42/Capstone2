<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/two-factor-utils.php';

$sessionUser = require_session_user();
$userId = (int)($sessionUser['id'] ?? 0);

hris_ensure_email_verification_columns($pdo);

function email_verification_settings(PDO $pdo): array
{
    $twoFactorSettings = hris_two_factor_settings($pdo);

    return [
        'otpExpiryMinutes' => max(5, min(15, (int)($twoFactorSettings['otpExpiryMinutes'] ?? 5))),
        'maxAttempts' => 5,
        'resendDelaySeconds' => max(0, min(60, (int)($twoFactorSettings['resendDelaySeconds'] ?? 0))),
        'lockSeconds' => 15 * 60,
    ];
}

function email_verification_normalize_email(mixed $value): string
{
    return strtolower(trim((string)($value ?? '')));
}

function email_verification_clean_code(mixed $value): string
{
    return preg_replace('/\D+/', '', (string)($value ?? '')) ?? '';
}

function email_verification_clear_lock(int $userId): void
{
    $lock = $_SESSION['email_verification_lock'] ?? null;

    if (is_array($lock) && (int)($lock['userId'] ?? 0) === $userId) {
        unset($_SESSION['email_verification_lock']);
    }
}

function email_verification_clear_pending(int $userId): void
{
    $pending = $_SESSION['email_verification_pending'] ?? null;

    if (is_array($pending) && (int)($pending['userId'] ?? 0) === $userId) {
        unset($_SESSION['email_verification_pending']);
    }
}

function email_verification_store_pending(int $userId, string $targetEmail, string $otpHash, string $expiresAt): void
{
    $createdAtTimestamp = time();

    $_SESSION['email_verification_pending'] = [
        'userId' => $userId,
        'newEmail' => $targetEmail,
        'otpHash' => $otpHash,
        'expiresAt' => $expiresAt,
        'attempts' => 0,
        'createdAt' => date('Y-m-d H:i:s', $createdAtTimestamp),
        'createdAtTimestamp' => $createdAtTimestamp,
    ];
}

function email_verification_update_attempts(int $userId, int $attempts): void
{
    $pending = $_SESSION['email_verification_pending'] ?? null;

    if (is_array($pending) && (int)($pending['userId'] ?? 0) === $userId) {
        $_SESSION['email_verification_pending']['attempts'] = max(0, $attempts);
    }
}

function email_verification_user(PDO $pdo, int $userId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            id,
            username,
            email,
            email_verified_at AS emailVerifiedAt,
            email_updated_at AS emailUpdatedAt,
            created_at AS createdAt
         FROM users
         WHERE id = :id
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $userId]);
    $user = $statement->fetch();

    return $user ?: null;
}

function email_verification_display_name(array $sessionUser, array $userRow): string
{
    $name = trim((string)($sessionUser['full_name'] ?? ''));

    if ($name !== '') {
        return $name;
    }

    $username = trim((string)($userRow['username'] ?? $sessionUser['username'] ?? ''));

    return $username !== '' ? $username : 'User';
}

function email_verification_latest_open(PDO $pdo, int $userId): ?array
{
    unset($pdo);

    $pending = $_SESSION['email_verification_pending'] ?? null;

    if (!is_array($pending) || (int)($pending['userId'] ?? 0) !== $userId) {
        return null;
    }

    $targetEmail = email_verification_normalize_email($pending['newEmail'] ?? '');
    $otpHash = (string)($pending['otpHash'] ?? '');
    $expiresAt = (string)($pending['expiresAt'] ?? '');
    $createdAtTimestamp = (int)($pending['createdAtTimestamp'] ?? 0);

    if ($targetEmail === '' || $otpHash === '' || $expiresAt === '') {
        email_verification_clear_pending($userId);
        return null;
    }

    if ($createdAtTimestamp <= 0) {
        $createdAtTimestamp = time();
    }

    return [
        'id' => 0,
        'userId' => $userId,
        'newEmail' => $targetEmail,
        'otp_hash' => $otpHash,
        'expiresAt' => $expiresAt,
        'attempts' => max(0, (int)($pending['attempts'] ?? 0)),
        'verified' => 0,
        'createdAt' => (string)($pending['createdAt'] ?? date('Y-m-d H:i:s', $createdAtTimestamp)),
        'createdAtTimestamp' => $createdAtTimestamp,
    ];
}

function email_verification_pending_payload(PDO $pdo, array $row): array
{
    $settings = email_verification_settings($pdo);
    $createdAt = (int)($row['createdAtTimestamp'] ?? 0);
    $expiresAt = hris_datetime_timestamp($row['expiresAt'] ?? null) ?? time();
    $attempts = max(0, (int)($row['attempts'] ?? 0));
    $resendAvailableAt = $createdAt > 0 ? $createdAt + $settings['resendDelaySeconds'] : time();

    return [
        'maskedEmail' => hris_two_factor_mask_email((string)($row['newEmail'] ?? '')),
        'expiresInSeconds' => max(0, $expiresAt - time()),
        'expiresAt' => $row['expiresAt'] ?? null,
        'attemptsRemaining' => max(0, $settings['maxAttempts'] - $attempts),
        'maxAttempts' => $settings['maxAttempts'],
        'resendDelaySeconds' => $settings['resendDelaySeconds'],
        'resendAvailableInSeconds' => max(0, $resendAvailableAt - time()),
    ];
}

function email_verification_profile_payload(PDO $pdo, array $sessionUser): array
{
    $userId = (int)($sessionUser['id'] ?? 0);
    $userRow = email_verification_user($pdo, $userId);

    if ($userRow === null) {
        json_response([
            'success' => false,
            'message' => 'Your account could not be found.',
        ], 404);
    }

    $latestOpen = email_verification_latest_open($pdo, $userId);
    $emailVerifiedAt = trim((string)($userRow['emailVerifiedAt'] ?? ''));
    $emailUpdatedAt = trim((string)($userRow['emailUpdatedAt'] ?? ''));
    $createdAt = trim((string)($userRow['createdAt'] ?? ''));

    return [
        'success' => true,
        'user' => $sessionUser,
        'emailVerification' => [
            'currentEmail' => (string)($userRow['email'] ?? ''),
            'isVerified' => $emailVerifiedAt !== '',
            'status' => $emailVerifiedAt !== '' ? 'verified' : 'pending',
            'statusLabel' => $emailVerifiedAt !== '' ? 'Verified' : 'Pending Verification',
            'emailVerifiedAt' => $emailVerifiedAt !== '' ? $emailVerifiedAt : null,
            'emailUpdatedAt' => $emailUpdatedAt !== '' ? $emailUpdatedAt : ($createdAt !== '' ? $createdAt : null),
            'pending' => $latestOpen ? email_verification_pending_payload($pdo, $latestOpen) : null,
        ],
    ];
}

function email_verification_log(PDO $pdo, int $userId, string $action, string $previousEmail, string $newEmail, string $status): void
{
    unset($pdo, $previousEmail, $newEmail, $status);

    if ($action === 'locked') {
        $_SESSION['email_verification_lock'] = [
            'userId' => $userId,
            'createdAtTimestamp' => time(),
        ];
        return;
    }

    if ($action === 'verified' || $action === 'email_updated') {
        email_verification_clear_lock($userId);
    }
}

function email_verification_lock_remaining(PDO $pdo, int $userId): int
{
    $settings = email_verification_settings($pdo);
    $lock = $_SESSION['email_verification_lock'] ?? null;

    if (!is_array($lock) || (int)($lock['userId'] ?? 0) !== $userId) {
        return 0;
    }

    $lockedAt = (int)($lock['createdAtTimestamp'] ?? 0);

    if ($lockedAt <= 0) {
        email_verification_clear_lock($userId);
        return 0;
    }

    $remaining = max(0, ($lockedAt + $settings['lockSeconds']) - time());

    if ($remaining <= 0) {
        email_verification_clear_lock($userId);
    }

    return $remaining;
}

function email_verification_assert_unlocked(PDO $pdo, int $userId): void
{
    $remaining = email_verification_lock_remaining($pdo, $userId);

    if ($remaining > 0) {
        json_response([
            'success' => false,
            'message' => 'Too many failed attempts. Please try again in 15 minutes.',
            'lockExpiresInSeconds' => $remaining,
        ], 423);
    }
}

function email_verification_employee_record_id(PDO $pdo, array $sessionUser): ?int
{
    $employeeId = hris_session_employee_record_id($pdo, $sessionUser);

    return $employeeId !== null && $employeeId > 0 ? $employeeId : null;
}

function email_verification_email_in_use(PDO $pdo, string $email, int $exceptUserId, ?int $exceptEmployeeId = null): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM users
         WHERE email COLLATE utf8mb4_unicode_ci = :email
           AND id <> :user_id
         LIMIT 1'
    );
    $statement->execute([
        ':email' => $email,
        ':user_id' => $exceptUserId,
    ]);

    if ((int)$statement->fetchColumn() > 0) {
        return true;
    }

    $employeeSql = 'SELECT COUNT(*)
         FROM employees
         WHERE email COLLATE utf8mb4_unicode_ci = :email
           AND is_archived = 0';
    $params = [':email' => $email];

    if ($exceptEmployeeId !== null && $exceptEmployeeId > 0) {
        $employeeSql .= ' AND id <> :employee_id';
        $params[':employee_id'] = $exceptEmployeeId;
    }

    $statement = $pdo->prepare($employeeSql);
    $statement->execute($params);

    return (int)$statement->fetchColumn() > 0;
}

function email_verification_invalidate_open(PDO $pdo, int $userId): void
{
    unset($pdo);
    email_verification_clear_pending($userId);
}

function email_verification_html_body(string $displayName, string $code, int $expiresInMinutes, ?string $logoContentId = null): string
{
    return hris_mail_document([
        'title' => 'Verify Your New Email Address',
        'preheader' => 'Use your 6-digit code to confirm your new MGB HRIS email address.',
        'eyebrow' => 'Email Verification',
        'subtitle' => 'Region X Mines and Geosciences Bureau email verification',
        'logoContentId' => $logoContentId,
        'greetingName' => $displayName,
        'intro' => 'We received a request to change your email address.',
        'blocks' => [
            hris_mail_code_block(
                'Verification Code',
                $code,
                'This code will expire in <strong>' . hris_mail_escape(hris_mail_minutes_label($expiresInMinutes)) . '</strong>.'
            ),
        ],
        'closing' => 'If you did not request this change, you can safely ignore this email.',
        'footerNote' => 'This is an automated security message from the HRIS email verification service.',
    ]);
}

function email_verification_text_body(string $displayName, string $code, int $expiresInMinutes): string
{
    return "Hello {$displayName},\n\n"
        . "We received a request to change your email address.\n\n"
        . "Verification Code:\n\n"
        . "{$code}\n\n"
        . "This code will expire in {$expiresInMinutes} minute" . ($expiresInMinutes === 1 ? '' : 's') . ".\n\n"
        . "If you did not request this change, you can safely ignore this email.";
}

function email_verification_send_email(string $recipientEmail, string $displayName, string $code, int $expiresInMinutes): void
{
    $mail = hris_configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = 'Verify Your New Email Address';
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = email_verification_html_body($displayName, $code, $expiresInMinutes, $logoContentId);
    $mail->AltBody = email_verification_text_body($displayName, $code, $expiresInMinutes);
    $mail->send();
}

function email_verification_issue_code(PDO $pdo, array $sessionUser, string $targetEmail, bool $allowCurrentEmail, bool $enforceResendDelay): array
{
    $userId = (int)($sessionUser['id'] ?? 0);
    $targetEmail = email_verification_normalize_email($targetEmail);
    $userRow = email_verification_user($pdo, $userId);

    if ($userRow === null) {
        json_response([
            'success' => false,
            'message' => 'Your account could not be found.',
        ], 404);
    }

    $currentEmail = email_verification_normalize_email($userRow['email'] ?? '');
    $employeeRecordId = email_verification_employee_record_id($pdo, $sessionUser);

    email_verification_assert_unlocked($pdo, $userId);

    if ($targetEmail === '' || filter_var($targetEmail, FILTER_VALIDATE_EMAIL) === false) {
        json_response([
            'success' => false,
            'message' => 'Enter a valid email address.',
        ], 422);
    }

    if (!$allowCurrentEmail && $targetEmail === $currentEmail) {
        json_response([
            'success' => false,
            'message' => 'New email cannot match your current email.',
        ], 422);
    }

    if (email_verification_email_in_use($pdo, $targetEmail, $userId, $employeeRecordId)) {
        json_response([
            'success' => false,
            'message' => 'This email address is already used in the system.',
        ], 409);
    }

    $settings = email_verification_settings($pdo);
    $latestOpen = email_verification_latest_open($pdo, $userId);

    if ($enforceResendDelay && $latestOpen !== null) {
        $createdAt = (int)($latestOpen['createdAtTimestamp'] ?? 0);
        $remaining = $createdAt > 0
            ? ($createdAt + $settings['resendDelaySeconds']) - time()
            : 0;

        if ($remaining > 0) {
            email_verification_log($pdo, $userId, 'rate_limited', $currentEmail, $targetEmail, 'cooldown');
            json_response([
                'success' => false,
                'message' => 'Please wait before requesting another verification code.',
                'resendAvailableInSeconds' => $remaining,
                'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
            ], 429);
        }
    }

    $code = hris_two_factor_generate_code();
    $expiresAt = date('Y-m-d H:i:s', time() + ($settings['otpExpiryMinutes'] * 60));

    email_verification_invalidate_open($pdo, $userId);
    email_verification_store_pending($userId, $targetEmail, password_hash($code, PASSWORD_DEFAULT), $expiresAt);

    try {
        email_verification_send_email(
            $targetEmail,
            email_verification_display_name($sessionUser, $userRow),
            $code,
            $settings['otpExpiryMinutes']
        );
    } catch (Throwable $exception) {
        email_verification_invalidate_open($pdo, $userId);
        email_verification_log($pdo, $userId, 'otp_email_failed', $currentEmail, $targetEmail, 'failed');
        throw $exception;
    }

    email_verification_log($pdo, $userId, 'otp_sent', $currentEmail, $targetEmail, 'sent');
    hris_two_factor_notify_user(
        $pdo,
        $userId,
        'Email verification code sent',
        'A verification code was sent to your email address.',
        'email_verification'
    );

    $freshOpen = email_verification_latest_open($pdo, $userId);

    return $freshOpen ? email_verification_pending_payload($pdo, $freshOpen) : [];
}

function email_verification_verify_code(PDO $pdo, array $sessionUser, string $code): void
{
    $userId = (int)($sessionUser['id'] ?? 0);

    if (!preg_match('/^\d{6}$/', $code)) {
        json_response([
            'success' => false,
            'message' => 'Enter the 6-digit verification code.',
        ], 422);
    }

    email_verification_assert_unlocked($pdo, $userId);

    $userRow = email_verification_user($pdo, $userId);
    $codeRow = email_verification_latest_open($pdo, $userId);

    if ($userRow === null || $codeRow === null) {
        json_response([
            'success' => false,
            'message' => 'No active verification code was found. Request a new code.',
        ], 410);
    }

    $settings = email_verification_settings($pdo);
    $currentEmail = email_verification_normalize_email($userRow['email'] ?? '');
    $targetEmail = email_verification_normalize_email($codeRow['newEmail'] ?? '');
    $expiresAt = hris_datetime_timestamp($codeRow['expiresAt'] ?? null);

    if ($expiresAt === null || $expiresAt < time()) {
        email_verification_invalidate_open($pdo, $userId);
        email_verification_log($pdo, $userId, 'expired', $currentEmail, $targetEmail, 'expired');
        write_auth_audit($pdo, $sessionUser, 'email_verification.expired', 'An expired email verification code was submitted.', [
            'previous_email' => $currentEmail,
            'new_email' => $targetEmail,
        ]);
        hris_two_factor_notify_user(
            $pdo,
            $userId,
            'Email verification expired',
            'Your email verification code expired. Request a new code to continue.',
            'email_verification_expired'
        );

        json_response([
            'success' => false,
            'message' => 'Verification code has expired. Please request a new code.',
            'expired' => true,
            'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
        ], 410);
    }

    $attempts = max(0, (int)($codeRow['attempts'] ?? 0));

    if ($attempts >= $settings['maxAttempts']) {
        email_verification_invalidate_open($pdo, $userId);
        email_verification_log($pdo, $userId, 'locked', $currentEmail, $targetEmail, 'locked');
        json_response([
            'success' => false,
            'message' => 'Too many failed attempts. Please try again in 15 minutes.',
            'attemptsRemaining' => 0,
            'lockExpiresInSeconds' => $settings['lockSeconds'],
        ], 423);
    }

    if (!password_verify($code, (string)($codeRow['otp_hash'] ?? ''))) {
        $nextAttempts = $attempts + 1;
        $remainingAttempts = max(0, $settings['maxAttempts'] - $nextAttempts);

        email_verification_update_attempts($userId, $nextAttempts);

        email_verification_log($pdo, $userId, 'verify_failed', $currentEmail, $targetEmail, 'failed');
        write_auth_audit($pdo, $sessionUser, 'email_verification.verify_failed', 'An email verification attempt failed.', [
            'previous_email' => $currentEmail,
            'new_email' => $targetEmail,
            'attempts' => $nextAttempts,
        ]);

        if ($nextAttempts >= 2) {
            hris_two_factor_notify_user(
                $pdo,
                $userId,
                'Failed email verification attempts',
                'Multiple failed email verification attempts were detected on your account.',
                'email_verification_failed'
            );
        }

        if ($remainingAttempts <= 0) {
            email_verification_invalidate_open($pdo, $userId);
            email_verification_log($pdo, $userId, 'locked', $currentEmail, $targetEmail, 'locked');

            json_response([
                'success' => false,
                'message' => 'Too many failed attempts. Please try again in 15 minutes.',
                'attemptsRemaining' => 0,
                'lockExpiresInSeconds' => $settings['lockSeconds'],
            ], 423);
        }

        $freshOpen = email_verification_latest_open($pdo, $userId);

        json_response([
            'success' => false,
            'message' => 'Invalid verification code.',
            'attemptsRemaining' => $remainingAttempts,
            'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
            'pending' => $freshOpen ? email_verification_pending_payload($pdo, $freshOpen) : null,
        ], 401);
    }

    $employeeRecordId = email_verification_employee_record_id($pdo, $sessionUser);

    if (email_verification_email_in_use($pdo, $targetEmail, $userId, $employeeRecordId)) {
        email_verification_log($pdo, $userId, 'verify_conflict', $currentEmail, $targetEmail, 'conflict');
        json_response([
            'success' => false,
            'message' => 'This email address is already used in the system.',
        ], 409);
    }

    try {
        $pdo->beginTransaction();

        if ($targetEmail !== $currentEmail) {
            $statement = $pdo->prepare(
                'UPDATE users
                 SET email = :email,
                     email_verified_at = CURRENT_TIMESTAMP,
                     email_updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id
                   AND is_archived = 0'
            );
            $statement->execute([
                ':email' => $targetEmail,
                ':id' => $userId,
            ]);

            if ($employeeRecordId !== null) {
                $statement = $pdo->prepare(
                    'UPDATE employees
                     SET email = :email
                     WHERE id = :id
                       AND email COLLATE utf8mb4_unicode_ci = :previous_email
                       AND is_archived = 0'
                );
                $statement->execute([
                    ':email' => $targetEmail,
                    ':id' => $employeeRecordId,
                    ':previous_email' => $currentEmail,
                ]);
            }
        } else {
            $statement = $pdo->prepare(
                'UPDATE users
                 SET email_verified_at = CURRENT_TIMESTAMP,
                     email_updated_at = COALESCE(email_updated_at, created_at, CURRENT_TIMESTAMP)
                 WHERE id = :id
                   AND is_archived = 0'
            );
            $statement->execute([':id' => $userId]);
        }

        $pdo->commit();
        email_verification_invalidate_open($pdo, $userId);
        email_verification_clear_lock($userId);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $freshUser = refresh_session_user($sessionUser) ?? $sessionUser;
    $_SESSION['user'] = $freshUser;
    $_SESSION['last_activity_at'] = time();

    email_verification_log($pdo, $userId, 'verified', $currentEmail, $targetEmail, 'success');
    if ($targetEmail !== $currentEmail) {
        email_verification_log($pdo, $userId, 'email_updated', $currentEmail, $targetEmail, 'success');
    }

    write_auth_audit($pdo, $freshUser, 'email_verification.verified', 'A user verified an email address.', [
        'previous_email' => $currentEmail,
        'new_email' => $targetEmail,
        'email_changed' => $targetEmail !== $currentEmail,
    ]);
    hris_two_factor_notify_user(
        $pdo,
        $userId,
        $targetEmail !== $currentEmail ? 'Email updated successfully' : 'Email verified successfully',
        $targetEmail !== $currentEmail
            ? 'Your account email was changed successfully.'
            : 'Your account email was verified successfully.',
        'email_verification_success'
    );
    hris_two_factor_safe_alert_email(
        $targetEmail,
        $targetEmail !== $currentEmail ? 'Email Updated Successfully' : 'Email Verified Successfully',
        $targetEmail !== $currentEmail
            ? 'Your MGB HRIS account is now using ' . $targetEmail . '.'
            : 'Your MGB HRIS email address has been verified successfully.'
    );

    if ($targetEmail !== $currentEmail) {
        hris_two_factor_safe_alert_email(
            $currentEmail,
            'MGB HRIS Email Address Changed',
            'Your MGB HRIS account email address was changed to ' . $targetEmail . '. If you did not request this change, contact the HRIS administrator immediately.'
        );
    }

    json_response([
        'success' => true,
        'message' => $targetEmail !== $currentEmail ? 'Email updated successfully.' : 'Email verified successfully.',
        'user' => $freshUser,
        'emailVerification' => email_verification_profile_payload($pdo, $freshUser)['emailVerification'],
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    json_response(email_verification_profile_payload($pdo, $sessionUser));
}

if ($method === 'POST') {
    $body = read_json_body();
    $action = hris_normalize_notification_type((string)($body['action'] ?? ''));

    try {
        if ($action === 'request_change') {
            $newEmail = email_verification_normalize_email($body['newEmail'] ?? $body['new_email'] ?? '');
            $confirmEmail = email_verification_normalize_email($body['confirmNewEmail'] ?? $body['confirm_new_email'] ?? '');

            if ($newEmail === '' || $confirmEmail === '') {
                json_response([
                    'success' => false,
                    'message' => 'New email and confirmation are required.',
                ], 422);
            }

            if ($newEmail !== $confirmEmail) {
                json_response([
                    'success' => false,
                    'message' => 'New email and confirmation must match.',
                ], 422);
            }

            $pending = email_verification_issue_code($pdo, $sessionUser, $newEmail, false, true);
            $current = email_verification_user($pdo, $userId);
            email_verification_log($pdo, $userId, 'change_requested', email_verification_normalize_email($current['email'] ?? ''), $newEmail, 'pending');
            write_auth_audit($pdo, $sessionUser, 'email_verification.change_requested', 'A user requested an email address change.', [
                'new_email' => $newEmail,
            ]);

            json_response([
                'success' => true,
                'message' => 'Verification code sent.',
                'pending' => $pending,
                'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
            ]);
        }

        if ($action === 'request_current') {
            $current = email_verification_user($pdo, $userId);
            $currentEmail = email_verification_normalize_email($current['email'] ?? '');

            if (!empty($current['emailVerifiedAt'])) {
                json_response([
                    'success' => true,
                    'message' => 'Your email address is already verified.',
                    'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
                ]);
            }

            $pending = email_verification_issue_code($pdo, $sessionUser, $currentEmail, true, true);
            write_auth_audit($pdo, $sessionUser, 'email_verification.current_requested', 'A user requested email verification for their current address.', [
                'email' => $currentEmail,
            ]);

            json_response([
                'success' => true,
                'message' => 'Verification code sent.',
                'pending' => $pending,
                'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
            ]);
        }

        if ($action === 'resend') {
            $latestOpen = email_verification_latest_open($pdo, $userId);

            if ($latestOpen === null) {
                json_response([
                    'success' => false,
                    'message' => 'No active verification code was found. Request a new code.',
                ], 410);
            }

            $targetEmail = email_verification_normalize_email($latestOpen['newEmail'] ?? '');
            $current = email_verification_user($pdo, $userId);
            $allowCurrent = $targetEmail === email_verification_normalize_email($current['email'] ?? '');
            $pending = email_verification_issue_code($pdo, $sessionUser, $targetEmail, $allowCurrent, true);
            write_auth_audit($pdo, $sessionUser, 'email_verification.otp_resent', 'An email verification code was resent.', [
                'target_email' => $targetEmail,
            ]);

            json_response([
                'success' => true,
                'message' => 'A new verification code was sent.',
                'pending' => $pending,
                'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
            ]);
        }

        if ($action === 'verify') {
            email_verification_verify_code($pdo, $sessionUser, email_verification_clean_code($body['code'] ?? $body['otp'] ?? ''));
        }

        if ($action === 'cancel') {
            $current = email_verification_user($pdo, $userId);
            $latestOpen = email_verification_latest_open($pdo, $userId);
            email_verification_invalidate_open($pdo, $userId);
            email_verification_log(
                $pdo,
                $userId,
                'cancelled',
                email_verification_normalize_email($current['email'] ?? ''),
                email_verification_normalize_email($latestOpen['newEmail'] ?? ''),
                'cancelled'
            );

            json_response([
                'success' => true,
                'message' => 'Email verification cancelled.',
                'emailVerification' => email_verification_profile_payload($pdo, $sessionUser)['emailVerification'],
            ]);
        }
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'This email address is already used in the system.',
            ], 409);
        }

        throw $exception;
    } catch (Throwable $exception) {
        error_log('Email verification API error: ' . $exception->getMessage());
        json_response([
            'success' => false,
            'message' => 'Unable to send or verify the email code. Check SMTP settings and try again.',
            'error' => $exception->getMessage(),
        ], 500);
    }
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
