<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

require_method('POST');
hris_ensure_user_security_columns($pdo);

$sessionUser = require_session_user();
$userId = (int)($sessionUser['id'] ?? 0);
$body = read_json_body();
$currentPassword = (string)($body['currentPassword'] ?? '');
$password = (string)($body['password'] ?? '');
$confirmPassword = (string)($body['confirmPassword'] ?? '');

if ($userId <= 0) {
    json_response([
        'success' => false,
        'message' => 'Your session is no longer valid. Please sign in again.',
    ], 401);
}

if ($currentPassword === '') {
    json_response([
        'success' => false,
        'message' => 'Current password is required.',
    ], 422);
}

if ($password !== $confirmPassword) {
    json_response([
        'success' => false,
        'message' => 'Passwords do not match.',
    ], 422);
}

$maximumPasswordLength = (int)(hris_security_settings($pdo)['maximumPasswordLength'] ?? 64);
$minimumPasswordLength = min(8, max(6, $maximumPasswordLength));
$passwordLengthError = hris_password_length_error($pdo, $password, $minimumPasswordLength);

if ($passwordLengthError !== null) {
    json_response([
        'success' => false,
        'message' => $passwordLengthError,
    ], 422);
}

if (!preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password) || !preg_match('/[^A-Za-z0-9]/', $password)) {
    json_response([
        'success' => false,
        'message' => 'Password must include letters, numbers, and symbols.',
    ], 422);
}

$statement = $pdo->prepare(
    'SELECT id, username, email, password_hash, must_change_password
     FROM users
     WHERE id = :id
       AND is_archived = 0
     LIMIT 1'
);
$statement->execute([':id' => $userId]);
$account = $statement->fetch();

if (!$account) {
    hris_destroy_session();
    json_response([
        'success' => false,
        'message' => 'Your session is no longer valid. Please sign in again.',
    ], 401);
}

$passwordHash = (string)($account['password_hash'] ?? '');

if ($passwordHash === '' || !password_verify($currentPassword, $passwordHash)) {
    json_response([
        'success' => false,
        'message' => 'Current password is incorrect.',
    ], 422);
}

if (password_verify($password, $passwordHash)) {
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
    ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
    ':id' => $userId,
]);

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

write_auth_audit($pdo, $formattedUser, 'password.force_change_completed', 'A required password change was completed.', [
    'username' => $formattedUser['username'] ?? null,
]);

json_response([
    'success' => true,
    'message' => 'Password changed successfully.',
    'user' => $formattedUser,
]);
