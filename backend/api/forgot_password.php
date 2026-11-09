<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

require_method('POST');

$body = read_json_body();
$identifier = trim((string)($body['identifier'] ?? ($body['email'] ?? '')));

if ($identifier === '') {
    json_response([
        'success' => false,
        'message' => 'Email is required.',
    ], 422);
}

if (filter_var($identifier, FILTER_VALIDATE_EMAIL) === false) {
    json_response([
        'success' => false,
        'message' => 'Enter a valid email address.',
    ], 422);
}

/* Each mailbox has its own resend budget, even when employees share an office IP address. */
throttle_password_reset_request($pdo, $identifier);

function password_reset_success_response(): void
{
    json_response([
        'success' => true,
        'message' => 'A reset code has been sent. Check your inbox and spam folder.',
    ]);
}

$account = find_user_by_reset_identifier($pdo, $identifier);

if (!$account || trim((string)($account['email'] ?? '')) === '') {
    if ($account) {
        write_auth_audit(
            $pdo,
            null,
            'password_reset.no_email',
            sprintf(
                'A password reset was requested for %s, which has no email address on file. No code was sent.',
                (string)$account['username']
            ),
            ['userId' => (int)$account['id']]
        );
    }

    json_response([
        'success' => false,
        'message' => 'This email is not registered in this system.',
    ], 404);
}

$resetCode = generate_password_reset_code();
store_password_reset_code((int)$account['id'], $resetCode);

try {
    send_password_reset_email((string)$account['email'], (string)$account['username'], $resetCode);
} catch (Throwable $exception) {
    /*
     * The offline convenience: on this machine, with the flag deliberately turned on, the code comes
     * back in the response so the flow can be exercised without a mail server. See
     * is_local_password_reset_environment() for why "local" there refuses a forwarded request.
     */
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

    /*
     * A failed send used to answer 500 with $exception->getMessage() in the body. That gave away two
     * things at once: that the account exists (an unknown one never reaches the mailer, so it can
     * never produce this reply), and the mail server's own diagnostics, which name the SMTP host and
     * the account it authenticates as.
     *
     * The reply is therefore the same success as every other branch, and the detail goes where an
     * administrator can still read it. This is a real trade -- with SMTP broken, users are told a code
     * was sent that was not -- so it is deliberately loud on the inside: the PHP error log for the
     * developer, and an audit row that surfaces on the Audit Logs screen.
     */
    error_log('Password reset email failed for user ' . (int)$account['id'] . ': ' . $exception->getMessage());

    write_auth_audit(
        $pdo,
        null,
        'password_reset.delivery_failed',
        sprintf(
            'A password reset code for %s could not be delivered. Check the SMTP settings.',
            (string)$account['username']
        ),
        [
            'userId' => (int)$account['id'],
            'error' => $exception->getMessage(),
        ]
    );

    password_reset_success_response();
}

password_reset_success_response();
