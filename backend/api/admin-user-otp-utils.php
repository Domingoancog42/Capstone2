<?php
declare(strict_types=1);

// The acting account approves creation; the new account's email is only the target binding.
function admin_user_otp_issue(array $actor, string $email): array
{
    $recipientEmail = trim((string)($actor['email'] ?? ''));
    if (!filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Your signed-in account needs a valid email address to receive the verification code.');
    }
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    $now = time();
    $budget = $_SESSION['admin_user_otp_sends'] ?? [];
    if ((int)($budget['until'] ?? 0) <= $now) {
        $budget = ['until' => $now + 600, 'count' => 0, 'last' => 0];
    }
    if ($budget['count'] >= 3 || $now - $budget['last'] < 30) {
        throw new RuntimeException('Please wait before sending another code. Up to three codes can be sent every 10 minutes.');
    }
    $budget['count']++;
    $budget['last'] = $now;
    $_SESSION['admin_user_otp_sends'] = $budget;
    unset($_SESSION['admin_user_otp']);

    $code = (string)random_int(100000, 999999);
    try {
        $mail = configured_mailer();
        $mail->addAddress($recipientEmail);
        $mail->Subject = 'Verify New Admin Account';
        $mail->Body = mail_document([
            'title' => 'Verify New Admin Account',
            'heading' => 'Admin Account Verification',
            'logoContentId' => password_reset_embed_logo($mail),
            'intro' => 'Use this code in Add User to approve creating an Admin account for ' . $email . '.',
            'blocks' => [mail_code_block('Verification code', $code, 'Expires in 10 minutes. Do not share this code outside the account creation process.')],
        ]);
        $mail->AltBody = "Your verification code to approve creating an Admin account for {$email} is {$code}. It expires in 10 minutes.";
        send_configured_mail($mail);
    } catch (Throwable $exception) {
        error_log('Admin account OTP email failed: ' . $exception->getMessage());
        throw new RuntimeException('The verification email could not be sent. Check SMTP settings and try again.');
    }
    $_SESSION['admin_user_otp'] = [
        'actorId' => (int)$actor['id'],
        'recipientEmail' => strtolower($recipientEmail),
        'email' => strtolower(trim($email)),
        'hash' => password_hash($code, PASSWORD_DEFAULT),
        'expires' => $now + 600,
        'attempts' => 0,
    ];
    return ['success' => true, 'message' => 'Verification code sent to your signed-in account email. Check your inbox to approve creating the Admin account.', 'resendAfterSeconds' => 30];
}

function admin_user_otp_consume(array $actor, string $email, string $code): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    $ticket = $_SESSION['admin_user_otp'] ?? null;
    if (!$ticket
        || $ticket['actorId'] !== (int)$actor['id']
        || ($ticket['recipientEmail'] ?? '') !== strtolower(trim((string)($actor['email'] ?? '')))
        || $ticket['email'] !== strtolower(trim($email))) {
        throw new RuntimeException('Send a verification code to your signed-in account email for this new Admin account first.');
    }
    if ($ticket['expires'] <= time()) {
        unset($_SESSION['admin_user_otp']);
        throw new RuntimeException('The verification code has expired. Send a new code.');
    }
    $_SESSION['admin_user_otp']['attempts']++;
    if (!preg_match('/^\d{6}$/', $code) || !password_verify($code, $ticket['hash'])) {
        if ($_SESSION['admin_user_otp']['attempts'] >= 5) {
            unset($_SESSION['admin_user_otp']);
            throw new RuntimeException('Too many incorrect codes. Send a new verification code.');
        }
        throw new RuntimeException('Incorrect verification code. Please try again.');
    }
    unset($_SESSION['admin_user_otp']);
}
