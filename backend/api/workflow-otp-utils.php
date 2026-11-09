<?php
declare(strict_types=1);

/*
 * The second step of the payroll step-up check: a one-time code emailed to the acting user.
 *
 * The math captcha in captcha-utils.php answers "is someone deliberately doing this?". It cannot
 * answer "is it the person whose session this is?" -- anything holding the session cookie can read
 * the sum and type it. Submitting, approving, and releasing payslips are the transitions where that
 * distinction is worth paying for, so they ask for something the session alone does not carry: a
 * code that only reaches the account's registered mailbox.
 *
 * The two checks are chained rather than offered side by side, and the order is what makes the pair
 * worth having:
 *
 *   step 1   the captcha is spent to REQUEST a code. A mailbox cannot be flooded by a script
 *            hammering the request endpoint, because every send costs a freshly dealt sum.
 *   step 2   the code is spent to PERFORM the transition, and it is verified inside payroll.php
 *            the way the captcha was -- so a request that never opened the dialog still meets it.
 *
 * A ticket therefore proves both things at once: a sum was solved, and the mailbox was read.
 *
 * WHAT IT IS NOT
 *
 * This is a step-up check on an authenticated session, not a login. It never decides who the user
 * is -- payroll.php has already done that, and the role gate for the transition runs before a code
 * is ever issued. It raises the cost of acting through a session someone else left open, or one
 * taken over from a machine that is already signed in.
 *
 * WHY THE SESSION AND NOT A TABLE
 *
 * Same reasoning as the login OTP in two_factor.php: this is single-browser, single-transition
 * state that dies with the session anyway, so a table bought nothing. The hash, the expiry, the
 * attempt counter and the send counter below are the whole record. The durable consequence -- who
 * approved what -- is written by payroll.php into its own audit trail, as it always was.
 *
 * WHAT IS DELIBERATELY NOT GATED
 *
 * Returning a batch for correction. It is the move that can be walked back, so it stays the quick
 * one. Marking a payroll paid publishes its payslips and is deliberately covered by this OTP gate.
 */

require_once __DIR__ . '/captcha-utils.php';
/*
 * For two_factor_generate_code() and two_factor_mask_email(). Including it is safe despite the
 * router at its foot: two_factor_is_direct_request() returns before any of it runs when the file is
 * required rather than requested, which is the same door email_verification.php and
 * password_change.php already come through. Sharing those two helpers rather than copying them is
 * what keeps one masking rule and one code generator across every OTP in the system.
 */
require_once __DIR__ . '/two_factor.php';

/**
 * Thrown when a request cannot be served and there is no longer a ticket to serve it against, so
 * the only way forward is a fresh sum. Separate from a plain refusal because the two mean different
 * things to the dialog: one is a sentence to show above the code box the user is still looking at,
 * this one is "that box is dead, go back to step one".
 */
if (!class_exists('PayrollWorkflowOtpRestartException')) {
    class PayrollWorkflowOtpRestartException extends RuntimeException
    {
    }
}

const PAYROLL_WORKFLOW_OTP_SESSION_KEY = 'payroll_workflow_otp';

/**
 * The transitions a ticket can be minted for. A code is bound to exactly one of these, so a code
 * mailed out to submit a batch cannot be turned around and spent approving one -- two different
 * decisions, two different desks, and the mailbox only consented to the one it was told about.
 */
const PAYROLL_WORKFLOW_OTP_ACTIONS = ['submit', 'approve', 'paid'];

/**
 * How long a code stays answerable. Longer than the captcha's two minutes because this step asks
 * the user to leave the screen and go and read their mail; short enough that a code left in an
 * inbox is not a standing authorisation to release a payroll.
 */
const PAYROLL_WORKFLOW_OTP_TTL_SECONDS = 600;

/**
 * Wrong codes allowed before the ticket is destroyed. Six digits is a million-wide space, so this
 * is not what stops a search -- the TTL is. It is here so a ticket cannot be left being ground
 * against indefinitely by something that already holds the session.
 */
const PAYROLL_WORKFLOW_OTP_MAX_ATTEMPTS = 5;

/**
 * Sends allowed against one ticket, the first included. Resending is ordinary -- mail is slow and
 * codes get lost -- but each resend is an email this server sends on a click, so the count is
 * bounded rather than trusted.
 */
const PAYROLL_WORKFLOW_OTP_MAX_SENDS = 3;

/**
 * The floor between two sends on one ticket.
 *
 * Deliberately NOT read from the two-factor `resendDelaySeconds` setting: that one defaults to 0
 * and an administrator can legitimately set it there for the login screen, where a captcha and the
 * login throttle already sit in front of it. Here a zero would mean a held ticket could post a
 * mail per click, so the floor is fixed in code where a settings change cannot remove it.
 */
const PAYROLL_WORKFLOW_OTP_RESEND_DELAY_SECONDS = 30;

/** The administrator-controlled switch for the emailed step; payroll math verification is separate. */
function payroll_workflow_otp_enabled(PDO $pdo): bool
{
    return get_boolean_application_setting($pdo, 'payroll_workflow_otp_enabled', true);
}

/**
 * Re-acquires the session so a ticket can be stored or spent.
 *
 * payroll.php calls session_write_close() immediately after resolving the user, because PHP's file
 * handler holds a per-browser lock for the rest of the script and that lock is what serialises a
 * dashboard's parallel requests. Reading $_SESSION still works afterwards; writing does not. So the
 * operations that write reopen it here and only they pay the lock, exactly as captcha-utils.php
 * does for the same reason.
 */
function payroll_workflow_otp_session_reopen(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
}

function payroll_workflow_otp_action_valid(string $action): bool
{
    return in_array($action, PAYROLL_WORKFLOW_OTP_ACTIONS, true);
}

/** Drops the open ticket. Writes, so callers must already have reopened the session. */
function payroll_workflow_otp_forget(): void
{
    unset($_SESSION[PAYROLL_WORKFLOW_OTP_SESSION_KEY]);
}

function payroll_workflow_otp_open_ticket(): ?array
{
    $ticket = $_SESSION[PAYROLL_WORKFLOW_OTP_SESSION_KEY] ?? null;

    return is_array($ticket) && ($ticket['codeHash'] ?? '') !== '' ? $ticket : null;
}

/**
 * Whether `$ticketId` is the open ticket for `$action`.
 *
 * This is what lets a resend skip the captcha. Holding a live ticket already proves a sum was
 * solved to mint it -- that is the only way one comes into existence -- so charging another sum per
 * resend would be making the user pay twice for the same fact. What bounds a resend instead is the
 * pair of limits the ticket carries with it: the delay floor between sends and the cap on how many
 * a single ticket allows, after which it is destroyed and step one comes back around.
 *
 * Read-only, so no session reopen: a caller that goes on to write has to reopen anyway.
 */
function payroll_workflow_otp_ticket_matches(string $action, string $ticketId): bool
{
    $ticket = payroll_workflow_otp_open_ticket();

    return $ticket !== null
        && $ticketId !== ''
        && ($ticket['action'] ?? '') === $action
        && hash_equals((string)$ticket['ticket'], $ticketId);
}

/**
 * The masked address a code was sent to, for the dialog to show.
 *
 * The full address is never returned to the browser by this flow. The user knows their own mailbox
 * and only needs enough of it to tell which one to open; echoing it in full would hand back in
 * plain text something an onlooker at the same screen has no business reading.
 */
function payroll_workflow_otp_mask_email(string $email): string
{
    // two_factor.php already had to solve this, and one masking rule across the system means a
    // support call about "the address it showed me" has one answer rather than two.
    return two_factor_mask_email($email);
}

/**
 * What the browser is allowed to know about the open ticket. Never the code.
 */
function payroll_workflow_otp_payload(array $ticket, string $email): array
{
    $sentAt = (int)($ticket['sentAtTimestamp'] ?? 0);
    $sends = max(1, (int)($ticket['sends'] ?? 1));

    return [
        'otpTicket' => (string)($ticket['ticket'] ?? ''),
        'action' => (string)($ticket['action'] ?? ''),
        'maskedEmail' => payroll_workflow_otp_mask_email($email),
        'expiresInSeconds' => max(0, (int)($ticket['expiresAtTimestamp'] ?? 0) - time()),
        'attemptsRemaining' => max(0, PAYROLL_WORKFLOW_OTP_MAX_ATTEMPTS - (int)($ticket['attempts'] ?? 0)),
        'resendAvailableInSeconds' => max(0, ($sentAt + PAYROLL_WORKFLOW_OTP_RESEND_DELAY_SECONDS) - time()),
        'resendsRemaining' => max(0, PAYROLL_WORKFLOW_OTP_MAX_SENDS - $sends),
    ];
}

function payroll_workflow_otp_action_label(string $action): string
{
    return match ($action) {
        'submit' => 'submit a payroll batch for approval',
        'paid' => 'release the payslips and mark a payroll batch as paid',
        default => 'approve a payroll batch',
    };
}

function payroll_workflow_otp_html_body(string $code, string $action, ?string $logoContentId = null): string
{
    $intent = payroll_workflow_otp_action_label($action);

    return mail_document([
        'title' => 'Payroll Authorization Code',
        'preheader' => 'Use your 6-digit code to authorize a payroll action in the MGB HRIS Portal.',
        'eyebrow' => 'Payroll Authorization',
        'subtitle' => 'Region X Mines and Geosciences Bureau payroll workflow',
        'logoContentId' => $logoContentId,
        'intro' => 'Someone signed in to your HRIS account is trying to ' . mail_escape($intent) . '. Your authorization code is:',
        'blocks' => [
            mail_code_block(
                'Authorization Code',
                $code,
                'This code expires in <strong>' . mail_escape(mail_minutes_label((int)round(PAYROLL_WORKFLOW_OTP_TTL_SECONDS / 60))) . '</strong>.'
            ),
        ],
        // The point of the second step is that this sentence reaches a place the session cannot.
        'closing' => 'If this was not you, do not share this code. Sign out of any shared computer and contact the HRIS administrator immediately.',
        'footerNote' => 'This is an automated security message from the HRIS payroll workflow.',
    ]);
}

function payroll_workflow_otp_text_body(string $code, string $action): string
{
    $minutes = (int)round(PAYROLL_WORKFLOW_OTP_TTL_SECONDS / 60);

    return 'Someone signed in to your HRIS account is trying to ' . payroll_workflow_otp_action_label($action) . ".\n\n"
        . "Your authorization code is:\n\n"
        . "{$code}\n\n"
        . "This code expires in {$minutes} minute" . ($minutes === 1 ? '' : 's') . ".\n\n"
        . 'If this was not you, do not share this code. Sign out of any shared computer and contact the HRIS administrator immediately.';
}

function payroll_workflow_otp_send_email(string $recipientEmail, string $code, string $action): void
{
    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = 'Payroll Authorization Code';
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = payroll_workflow_otp_html_body($code, $action, $logoContentId);
    $mail->AltBody = payroll_workflow_otp_text_body($code, $action);
    send_configured_mail($mail);
}

/**
 * Mints or refreshes the ticket for `$action` and emails the code.
 *
 * A resend keeps the ticket id and replaces the code, so the dialog the user is looking at stays
 * valid and does not have to be re-plumbed mid-flow. Everything else about the ticket -- attempts,
 * expiry -- restarts with the new code, because it is a new secret.
 *
 * `$isResend` is the caller's answer, not something re-derived here, and it is what the send limits
 * hang off. The distinction is not "does a ticket already exist" but "was this paid for": a caller
 * arriving with a freshly solved sum has bought a new ticket and gets one, even if an old ticket for
 * the same action is still lying in the session. Deriving it from the session instead would mean a
 * user who fumbled a code and answered a new sum to try again was turned away by the resend floor --
 * charged for the retry twice, once in arithmetic and once in waiting.
 *
 * Returns the payload for the browser, or throws. The caller decides how a failure is reported;
 * this never half-succeeds: if the mail cannot be sent the ticket is destroyed, so a user is never
 * left staring at a code entry box for a code that was never posted.
 */
function payroll_workflow_otp_issue(PDO $pdo, array $sessionUser, string $action, bool $isResend = false): array
{
    $email = trim((string)($sessionUser['email'] ?? ''));

    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new RuntimeException(
            'Your account has no valid email address on file, so an authorization code cannot be sent. Ask an administrator to set one before continuing with payroll.'
        );
    }

    payroll_workflow_otp_session_reopen();

    $existing = payroll_workflow_otp_open_ticket();

    // A resend the caller could not actually be holding a ticket for is a first send, whatever it
    // asked for. Belt and braces: the handler has already matched the ticket id.
    $isResend = $isResend && $existing !== null && ($existing['action'] ?? '') === $action;

    if ($isResend) {
        $sends = (int)($existing['sends'] ?? 1);
        $sentAt = (int)($existing['sentAtTimestamp'] ?? 0);
        $waitRemaining = ($sentAt + PAYROLL_WORKFLOW_OTP_RESEND_DELAY_SECONDS) - time();

        if ($waitRemaining > 0) {
            throw new RuntimeException(
                'Please wait ' . $waitRemaining . ' more second' . ($waitRemaining === 1 ? '' : 's') . ' before requesting another code.'
            );
        }

        if ($sends >= PAYROLL_WORKFLOW_OTP_MAX_SENDS) {
            // The ticket goes rather than being left to be resent from forever. Starting over means
            // answering a fresh sum, which is the cost this whole flow is built on.
            payroll_workflow_otp_forget();

            throw new PayrollWorkflowOtpRestartException('Too many codes were requested. Start the security check again.');
        }
    }

    $code = two_factor_generate_code();
    $ticketId = $isResend ? (string)$existing['ticket'] : bin2hex(random_bytes(16));

    $_SESSION[PAYROLL_WORKFLOW_OTP_SESSION_KEY] = [
        'ticket' => $ticketId,
        'action' => $action,
        'userId' => (int)($sessionUser['id'] ?? 0),
        'codeHash' => password_hash($code, PASSWORD_DEFAULT),
        'expiresAtTimestamp' => time() + PAYROLL_WORKFLOW_OTP_TTL_SECONDS,
        'sentAtTimestamp' => time(),
        'attempts' => 0,
        'sends' => $isResend ? (int)($existing['sends'] ?? 1) + 1 : 1,
    ];

    try {
        payroll_workflow_otp_send_email($email, $code, $action);
    } catch (Throwable $exception) {
        payroll_workflow_otp_forget();
        error_log('Payroll workflow OTP email error: ' . $exception->getMessage());

        throw new RuntimeException(
            'The authorization code could not be emailed, so no payroll action was completed. Try again in a moment.'
        );
    }

    if (function_exists('write_auth_audit')) {
        write_auth_audit(
            $pdo,
            $sessionUser,
            $isResend ? 'payroll.otp_resent' : 'payroll.otp_sent',
            $isResend
                ? 'A payroll authorization code was resent.'
                : 'A payroll authorization code was emailed.',
            ['action' => $action]
        );
    }

    return payroll_workflow_otp_payload($_SESSION[PAYROLL_WORKFLOW_OTP_SESSION_KEY], $email);
}

/**
 * Checks a ticket and code against the open one and consumes it.
 *
 * Returns ['ok' => bool, 'message' => string]. Refusals say the same kind of thing on purpose: the
 * caller cannot tell an expired ticket from a mismatched code closely enough to learn anything, and
 * in every one of these cases what the user has to do next is identical -- start the check again.
 */
function payroll_workflow_otp_verify(string $action, string $ticketId, string $code): array
{
    // Every branch below either spends the ticket or counts an attempt against it, so the session
    // has to be writable before the first of them runs.
    payroll_workflow_otp_session_reopen();

    $ticket = payroll_workflow_otp_open_ticket();
    $code = trim($code);

    if ($ticket === null) {
        return [
            'ok' => false,
            'message' => 'Your authorization code has expired. Start the security check again.',
        ];
    }

    /*
     * A ticket id that does not match is not a typo -- the browser sends back the id it was given --
     * so the ticket goes, rather than letting a caller probe with ids of its own choosing while the
     * real one waits intact.
     */
    if ($ticketId === '' || !hash_equals((string)$ticket['ticket'], $ticketId)) {
        payroll_workflow_otp_forget();

        return [
            'ok' => false,
            'message' => 'Your authorization code is no longer valid. Start the security check again.',
        ];
    }

    /*
     * The code was mailed out naming one transition, and that sentence in the email is the whole
     * consent. Spending it on a different one would make the notice a lie.
     */
    if (($ticket['action'] ?? '') !== $action) {
        payroll_workflow_otp_forget();

        return [
            'ok' => false,
            'message' => 'That authorization code was sent for a different payroll action. Start the security check again.',
        ];
    }

    // The server's clock, not the browser's.
    if (time() > (int)($ticket['expiresAtTimestamp'] ?? 0)) {
        payroll_workflow_otp_forget();

        return [
            'ok' => false,
            'message' => 'Your authorization code has expired. Start the security check again.',
        ];
    }

    // An empty box is the user not having answered yet rather than a guess, so it does not spend one
    // of the attempts.
    if ($code === '') {
        return [
            'ok' => false,
            'message' => 'Enter the 6-digit authorization code that was emailed to you.',
        ];
    }

    if (password_verify($code, (string)$ticket['codeHash'])) {
        // Single use. The code is spent here whether or not the transition behind it succeeds, so one
        // code cannot be attached to a run of approvals.
        payroll_workflow_otp_forget();

        return ['ok' => true, 'message' => ''];
    }

    $attempts = (int)($ticket['attempts'] ?? 0) + 1;

    if ($attempts >= PAYROLL_WORKFLOW_OTP_MAX_ATTEMPTS) {
        payroll_workflow_otp_forget();

        return [
            'ok' => false,
            'message' => 'That code was wrong too many times. Start the security check again.',
        ];
    }

    $_SESSION[PAYROLL_WORKFLOW_OTP_SESSION_KEY]['attempts'] = $attempts;
    $remaining = PAYROLL_WORKFLOW_OTP_MAX_ATTEMPTS - $attempts;

    return [
        'ok' => false,
        'message' => 'That code is not correct. ' . $remaining . ' attempt' . ($remaining === 1 ? '' : 's') . ' remaining.',
    ];
}

/**
 * The gate an endpoint puts in front of a step-up-protected transition.
 *
 * Answers on the endpoint's behalf when the pair does not check out, so the work behind it is never
 * reached and callers treat a return as permission. There is no path past this that a missing or
 * forged ticket survives -- which is the point: the stepper dialog is a convenience, not the check.
 *
 * `otpFailed` is how the browser tells a refused code apart from a failed transition: nothing was
 * written and the batch is untouched. `captchaFailed` rides along with it so the existing client
 * handling, which already knows a security refusal is not an update failure, keeps working.
 */
function payroll_require_workflow_otp(PDO $pdo, array $body, string $action): void
{
    if (!payroll_workflow_otp_enabled($pdo)) {
        return;
    }

    $result = payroll_workflow_otp_verify(
        $action,
        captcha_body_text($body, 'otpTicket'),
        captcha_body_text($body, 'otpCode')
    );

    if ($result['ok']) {
        return;
    }

    json_response([
        'success' => false,
        'message' => $result['message'],
        'otpFailed' => true,
        'captchaFailed' => true,
    ], 422);
}
