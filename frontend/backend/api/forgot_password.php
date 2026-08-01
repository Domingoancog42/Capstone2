<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

require_method('POST');

// Requesting a reset code is deliberately unthrottled: a user who never receives the
// first email must be able to ask again immediately. Guessing the code is still limited
// by the passwordReset group guard on reset_password.php.

$body = read_json_body();
$identifier = trim((string)($body['identifier'] ?? ($body['email'] ?? '')));

if ($identifier === '') {
    json_response([
        'success' => false,
        'message' => 'Username or email is required.',
    ], 422);
}

$account = find_user_by_reset_identifier($pdo, $identifier);

if (!$account) {
    json_response([
        'success' => false,
        'message' => 'This email is not registered.',
    ], 404);
}

if (trim((string)($account['email'] ?? '')) === '') {
    json_response([
        'success' => false,
        'message' => 'No email on file for this account. Contact your administrator.',
    ], 404);
}

$resetCode = generate_password_reset_code();
store_password_reset_code((int)$account['id'], $resetCode);

try {
    send_password_reset_email((string)$account['email'], (string)$account['username'], $resetCode);
} catch (Throwable $exception) {
    if (
        defined('ALLOW_LOCAL_RESET_CODE_FALLBACK')
        && ALLOW_LOCAL_RESET_CODE_FALLBACK === true
        && is_local_password_reset_environment()
    ) {
        json_response([
            'success' => true,
            'message' => 'SMTP is not configured on this local server. Use the reset code below to continue.',
            'devResetCode' => $resetCode,
            'delivery' => 'local',
        ]);
    }

    delete_password_reset_code((int)$account['id']);

    json_response([
        'success' => false,
        'message' => 'Unable to send reset email. Check SMTP settings.',
        'error' => $exception->getMessage(),
    ], 500);
}

json_response([
    'success' => true,
    'message' => 'Code sent. Check your inbox and spam folder.',
]);
