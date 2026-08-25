<?php
declare(strict_types=1);

/*
 * Throttling policy.
 *
 * This is not a second rate limiter. The counting -- the buckets, the fixed windows, the cool-downs,
 * the administrator's settings screen -- is all in rate-limit.php and stays there. What was missing
 * was the layer above it: every endpoint that wanted throttling had to name a rule key as a string,
 * build the identifier to count against by hand, and write its own refusal message. Three call sites
 * spelling out `rate_limit_client_ip()` is three chances to key a limit by the wrong thing, and the
 * one place it really matters is who a request counts *as*.
 *
 * So: rate-limit.php is the engine, and this file is the policy. Each throttle a caller might want is
 * one named function here, with the identity and the wording decided once.
 *
 *     throttle_login()                   sign-in attempts
 *     throttle_password_reset()          reset-code submissions
 *     throttle_password_reset_request()  reset-code requests, on its own budget
 *     throttle_two_factor()              one-time passcode submissions
 *     throttle_leave_request()           the daily filing quota
 *     throttle_request()                 the general ceiling, on every request
 *
 * Adding a throttle to an endpoint means calling one of these. Adding a *kind* of throttle means a
 * new rule in rate_limit_rule_definitions() -- which is also what puts it on the Rate Limiting
 * screen, since that screen renders from the definitions rather than from a list of its own.
 */

/**
 * Who this request counts as.
 *
 * A single identity for the general ceiling, in descending order of how specific it is:
 *
 *   user:<id>   a browser session. Two people in the same office share an address but not a counter.
 *   ip:<addr>   nobody has signed in yet, and the address is all there is to count.
 *
 * There was a third, `token:<id>`, keyed off the verified claims of a bearer token so that an API
 * client did not share a bucket with every other caller behind the same office address. It went with
 * the rest of bearer authentication.
 */
function throttle_identity(): string
{
    $sessionUser = isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null;
    $userId = (int)($sessionUser['id'] ?? 0);

    if ($userId > 0) {
        return 'user:' . $userId;
    }

    return 'ip:' . rate_limit_client_ip();
}

/** The caller as the audit trail should record it, which is only known for a session. */
function throttle_actor(): ?array
{
    return isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null;
}

/**
 * The one call into the engine. Everything below is a named policy on top of this, and nothing else
 * in the project should be reaching for rate_limit_enforce() directly.
 */
function throttle(PDO $pdo, string $ruleKey, string $identifier, ?array $user = null, string $message = ''): void
{
    rate_limit_enforce($pdo, $ruleKey, $identifier, $user, $message);
}

/**
 * Sign-in attempts, keyed by address *and* the username typed.
 *
 * The per-account lockout in login.php is a different guard for a different attack: it counts
 * failures against one user row, which does not notice a client walking a password list across a
 * hundred usernames. This counts the client. Both parts are in the key so that one user fumbling
 * their own password cannot lock out everyone else behind the same office address.
 */
function throttle_login(PDO $pdo, string $identifier): void
{
    throttle(
        $pdo,
        'login',
        rate_limit_client_ip() . '|' . strtolower(trim($identifier)),
        null,
        'Too many sign-in attempts.'
    );
}

/**
 * Reset-code submissions, keyed by address rather than by account -- otherwise a client starts its
 * budget over simply by naming a different user.
 */
function throttle_password_reset(PDO $pdo): void
{
    throttle(
        $pdo,
        'passwordReset',
        rate_limit_client_ip(),
        null,
        'Too many password reset attempts.'
    );
}

/**
 * Asking for a reset code, which is a different budget from spending one.
 *
 * Requesting used to be deliberately unthrottled, on the reasoning that somebody who never received
 * the first email has to be able to ask again. That holds for the second and third try; it does not
 * hold for the five-hundredth, and unthrottled it is two other things as well -- a way to put
 * arbitrarily many mails in a colleague's inbox, and the refill that makes the per-code attempt cap
 * in password-reset-utils.php cheap to walk around.
 *
 * Kept separate from throttle_password_reset() rather than sharing its bucket so the two cannot rob
 * each other: mistyping the code should not consume the ability to request a new one.
 */
function throttle_password_reset_request(PDO $pdo): void
{
    throttle(
        $pdo,
        'passwordResetRequest',
        rate_limit_client_ip(),
        null,
        'Too many password reset requests.'
    );
}

/**
 * One-time passcode submissions. The per-session attempt counter in two_factor.php resets every
 * time a fresh code is sent, so on its own it caps guesses per code rather than guesses per attacker;
 * this one survives both a resend and a new sign-in.
 */
function throttle_two_factor(PDO $pdo): void
{
    throttle(
        $pdo,
        'twoFactor',
        rate_limit_client_ip(),
        null,
        'Too many verification attempts.'
    );
}

/**
 * The daily leave-filing allowance. A quota rather than an abuse guard, which is why it is keyed by
 * the account doing the filing: somebody filing on behalf of others spends their own allowance.
 */
function throttle_leave_request(PDO $pdo, array $user, string $identifier): void
{
    throttle(
        $pdo,
        'leaveRequest',
        $identifier,
        $user,
        'You have reached the limit for leave requests filed from this account.'
    );
}

/**
 * The endpoints the general ceiling never counts.
 *
 * Settings is the way back: an administrator who sets the limit too low has to be able to reach the
 * screen that raises it again. Logout is here so a throttled caller can still sign out cleanly, and
 * csrf.php because the client fetches a token before it can send anything at all.
 */
function throttle_exempt_scripts(): array
{
    return ['settings.php', 'logout.php', 'csrf.php'];
}

/**
 * The general ceiling, applied to every request from connection-pdo.php.
 */
function throttle_request(PDO $pdo): void
{
    $script = strtolower(basename((string)($_SERVER['SCRIPT_FILENAME'] ?? '')));

    if (in_array($script, throttle_exempt_scripts(), true)) {
        return;
    }

    throttle(
        $pdo,
        'api',
        throttle_identity(),
        throttle_actor(),
        'Too many requests from this account.'
    );
}
