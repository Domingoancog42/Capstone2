<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';

require_method('POST');

/*
 * Asking for a reset code.
 *
 * The one rule this endpoint has to keep is that its answer must not depend on whether the account
 * exists. It used to: an unknown address got 404 "This email is not registered." and a known one got
 * 200 "Code sent.", which turns the form into a free membership oracle -- feed it a staff directory
 * and it sorts the list into who has an HRIS account and who does not. Paired with a guessable code
 * that is the first half of an account takeover, and on its own it is still a disclosure: this is a
 * government payroll system, so "does this person work here" is not public information to give away.
 *
 * So every path below ends at the same 200 and the same sentence. The account not existing, the
 * account having no email on file, the mail server refusing the message -- all of them look identical
 * from outside. What differs is only what gets written to the log and the audit trail.
 */
throttle_password_reset_request($pdo);

$body = read_json_body();
$identifier = trim((string)($body['identifier'] ?? ($body['email'] ?? '')));

// Refusing an empty form is not an oracle -- it says nothing about any account -- so it stays a
// distinct, useful error.
if ($identifier === '') {
    json_response([
        'success' => false,
        'message' => 'Username or email is required.',
    ], 422);
}

/**
 * The one answer this endpoint gives. Worded so that it is honest whichever branch reached it:
 * it promises that *if* the account exists a code is on its way, and promises nothing otherwise.
 */
function password_reset_uniform_response(): never
{
    json_response([
        'success' => true,
        'message' => 'If that account exists, a reset code has been sent. Check your inbox and spam folder.',
    ]);
}

$account = find_user_by_reset_identifier($pdo, $identifier);

if (!$account || trim((string)($account['email'] ?? '')) === '') {
    /*
     * No account, or an account with nowhere to send to. Nothing is sent and nothing is stored, but
     * the caller cannot tell that from the reply.
     *
     * An account that exists with no email on file is a real operational problem -- that user cannot
     * self-serve a reset at all -- so it goes to the audit trail, where an administrator will see it.
     * A simply unknown identifier is not worth a row; it is what a typo looks like.
     */
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

    password_reset_uniform_response();
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

    password_reset_uniform_response();
}

password_reset_uniform_response();
