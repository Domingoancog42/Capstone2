<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

require_method('POST');

hris_ensure_user_security_columns($pdo);

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

$passwordLengthError = hris_password_length_error($pdo, $password, 6);

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

$matchingCode = find_matching_password_reset_code((int)$account['id'], $code);

if (!$matchingCode) {
    json_response([
        'success' => false,
        'message' => 'Invalid or expired code.',
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
