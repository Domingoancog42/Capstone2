<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

require_method('POST');

ensure_user_security_columns($pdo);

$body = read_json_body();
$identifier = trim((string)($body['identifier'] ?? ''));
$code = preg_replace('/\D+/', '', (string)($body['code'] ?? '')) ?? '';
$password = (string)($body['password'] ?? '');
$confirmPassword = (string)($body['confirmPassword'] ?? '');

if ($identifier === '') {
    json_response([
        'success' => false,
        'message' => 'Username or email is required.',
    ], 422);
}

if (strlen($code) !== 6) {
    json_response([
        'success' => false,
        'message' => 'Enter the 6-digit reset code.',
    ], 422);
}

/*
 * A reset code is six digits and lives for minutes, which is short enough to matter and not short
 * enough to be safe: a million guesses is a few seconds of scripted requests. Counted per IP address
 * rather than per account so that a client cannot start over by naming a different user, and only
 * once the submission is well-formed, so a typo in the form is never what spends the budget.
 */
throttle_password_reset($pdo);

$passwordLengthError = password_length_error($pdo, $password, 6);

if ($passwordLengthError !== null) {
    json_response([
        'success' => false,
        'message' => $passwordLengthError,
    ], 422);
}

if ($password !== $confirmPassword) {
    json_response([
        'success' => false,
        'message' => 'Passwords do not match.',
    ], 422);
}

$account = find_user_by_reset_identifier($pdo, $identifier);

if (!$account) {
    json_response([
        'success' => false,
        'message' => 'Invalid or expired code.',
    ], 422);
}

/*
 * The guess itself, which is also where the per-code budget is spent. See PASSWORD_RESET_MAX_ATTEMPTS
 * in password-reset-utils.php for why a per-IP throttle alone was not enough to sit in front of a
 * six-digit number.
 *
 * The refusal stays a single flat message either way -- naming the account, or distinguishing "wrong
 * code" from "no code outstanding for this user", would put back the enumeration oracle that
 * forgot_password.php was just closed against.
 */
$attempt = verify_password_reset_code((int)$account['id'], $code);

if (!$attempt['ok']) {
    if ($attempt['exhausted']) {
        write_auth_audit(
            $pdo,
            null,
            'password_reset.code_exhausted',
            sprintf(
                'A password reset code for %s was destroyed after %d incorrect attempts from client address %s.',
                (string)$account['username'],
                PASSWORD_RESET_MAX_ATTEMPTS,
                (string)(client_ip_address() ?? 'unknown')
            ),
            ['userId' => (int)$account['id']]
        );

        json_response([
            'success' => false,
            'message' => 'Too many incorrect codes. Request a new reset code and try again.',
            'codeExhausted' => true,
        ], 422);
    }

    json_response([
        'success' => false,
        'message' => 'Invalid or expired code.',
    ], 422);
}

/*
 * A reset that accepts the password already on the account is not a reset. The two signed-in change
 * flows have refused this for a while; the recovery flow was the one way to set a password to itself,
 * which is exactly the case someone who has forgotten theirs is likeliest to stumble into.
 *
 * It has to be tested here, below the code check, and not a line earlier: answering "that is your
 * current password" to anyone who can name an account would turn this endpoint into a free oracle for
 * guessing passwords. Behind a valid reset code, the caller has already proven they hold the mailbox.
 *
 * The code deliberately survives this rejection -- it is spent only inside the transaction below -- so
 * the user simply picks a different password and submits the same code again.
 */
$currentPasswordHash = (string)($account['password_hash'] ?? '');

if ($currentPasswordHash !== '' && password_verify($password, $currentPasswordHash)) {
    json_response([
        'success' => false,
        'message' => 'This password is currently in use. Please choose a new password.',
        'field' => 'password',
    ], 422);
}

try {
    $pdo->beginTransaction();

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
        ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ':id' => (int)$account['id'],
    ]);

    consume_password_reset_code((int)$account['id']);

    $pdo->commit();
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    throw $exception;
}

json_response([
    'success' => true,
    'message' => 'Password reset successful. You can sign in with your new password.',
]);
