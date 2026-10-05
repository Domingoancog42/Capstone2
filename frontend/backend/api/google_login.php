<?php
declare(strict_types=1);

// Signing in must not depend on a CSRF token from a possibly expired anonymous browser session.
define('HRIS_CSRF_EXEMPT', true);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/two_factor.php';
require_once __DIR__ . '/login-utils.php';

require_method('POST');

/*
 * "Sign in with Google", server half.
 *
 * The browser's Google button hands back a credential: an ID token, signed by Google, naming the
 * Google account that was just signed into and the OAuth client it was issued to. It is not a
 * password and it is not proof of anything until Google has been asked about it, which is what
 * google_verify_credential() below does. What comes back is a verified e-mail address, and the
 * address is the whole of what this endpoint learns.
 *
 * It then signs in the `users` row with that address, and only that. Google sign-in never creates
 * an account: an address Google vouches for that HR has not registered is turned away with the
 * same answer as an archived or deactivated one, because from the outside those three are the same
 * fact -- "this Google account does not sign into this system" -- and telling them apart would let
 * anyone with a Gmail address test which of their colleagues have HRIS accounts.
 *
 * Everything after the lookup is login.php's own sequence, minus the parts that only make sense
 * for a password. There is no captcha and no sign-in throttle -- those exist to slow down guessing,
 * and nothing here can be guessed -- and no failed-attempt count for the same reason. There is no
 * password-expiry check either: an expired password is a fact about a credential that was not used.
 * The lock is honoured, though. A lock is a statement about the account, not about the password
 * that earned it, and a locked account must not have a second door.
 */

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_ACCEPTED_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** The one message for every account that Google vouches for but that does not sign in here. */
const GOOGLE_NO_ACCOUNT_MESSAGE = 'No HRIS account is linked to this Google account. Contact HR.';

/**
 * Asks Google whether the credential is one of its own and, if so, returns the claims it carries.
 *
 * tokeninfo is Google's own validation endpoint. It checks the signature against the current keys,
 * that the token has not expired and that it is well-formed, and answers 400 for anything it will
 * not vouch for. Verifying locally instead would mean fetching and caching Google's signing keys and
 * carrying a JWT library, for a check that runs once per sign-in; one HTTPS round trip is the
 * smaller dependency. What tokeninfo cannot judge is left to the caller: whether the token was
 * issued to this application and whether the address in it is one Google has verified.
 *
 * Returns null when Google rejected the credential. Throws when Google could not be consulted at
 * all, because those are different answers: the first is a bad credential, the second is a bad
 * network, and the user should be told which.
 */
function google_verify_credential(string $credential): ?array
{
    // Three base64url segments, or it is not a JWT and not worth a round trip.
    if (!preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $credential)) {
        return null;
    }

    if (!function_exists('curl_init')) {
        throw new RuntimeException('The cURL extension is not available.');
    }

    $curl = curl_init(GOOGLE_TOKENINFO_URL . '?id_token=' . rawurlencode($credential));

    if ($curl === false) {
        throw new RuntimeException('cURL could not be initialised.');
    }

    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_USERAGENT => 'HRIS Google Sign-In',
        // Both are cURL's defaults. Stated because this request is the credential check itself, and
        // whoever next reads this should not have to go and confirm that the answer cannot be spoofed.
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $response = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    if (!is_string($response)) {
        throw new RuntimeException('Google could not be reached: ' . ($error !== '' ? $error : 'no response'));
    }

    // 400 is Google's answer for an invalid, expired or malformed token. Anything else that is not
    // a 200 -- a 5xx, a 429 -- is Google being unavailable rather than the token being wrong.
    if ($status === 400) {
        return null;
    }

    if ($status !== 200) {
        throw new RuntimeException('Google answered HTTP ' . $status . ' to the token check.');
    }

    $claims = json_decode($response, true);

    return is_array($claims) ? $claims : null;
}

/*
 * A deployment with no client id has no Google button, so nothing legitimate ever reaches this
 * line. 503 rather than 404 because the file is there and working; it is the configuration that
 * is absent, and that is a state somebody may be in the middle of fixing.
 */
if (!defined('GOOGLE_CLIENT_ID') || GOOGLE_CLIENT_ID === '') {
    json_response([
        'success' => false,
        'message' => 'Google sign-in is not configured on this server.',
    ], 503);
}

$body = read_json_body();
$credential = trim((string)($body['credential'] ?? ''));

if ($credential === '') {
    json_response([
        'success' => false,
        'message' => 'A Google credential is required.',
    ], 422);
}

try {
    $claims = google_verify_credential($credential);
} catch (Throwable $exception) {
    write_auth_audit($pdo, null, 'login.google_unavailable', 'A Google sign-in could not be verified because Google could not be reached.', [
        'error' => $exception->getMessage(),
    ]);

    json_response([
        'success' => false,
        'message' => 'Google sign-in is temporarily unavailable. Try again, or sign in with your password.',
    ], 503);
}

/*
 * The three claims only this application can judge. tokeninfo has already vouched for the
 * signature and the expiry; `exp` is checked again anyway because it is one integer comparison and
 * it makes this block the complete statement of what is accepted.
 *
 *   iss             the token really came from Google's account service, under either spelling
 *                   Google has used for it.
 *   aud             it was minted for THIS client id. A perfectly valid Google token issued to some
 *                   other website is exactly what an attacker who runs some other website has.
 *   email_verified  Google has confirmed the address belongs to the account. It arrives as the
 *                   string "true" from tokeninfo and as a boolean from other decoders, so the
 *                   filter takes either.
 */
$email = strtolower(trim((string)($claims['email'] ?? '')));
$issuer = (string)($claims['iss'] ?? '');
$audience = (string)($claims['aud'] ?? '');
$emailVerified = filter_var($claims['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN);
$expiresAt = (int)($claims['exp'] ?? 0);

$rejection = null;

if ($claims === null) {
    $rejection = 'rejected_by_google';
} elseif (!in_array($issuer, GOOGLE_ACCEPTED_ISSUERS, true)) {
    $rejection = 'issuer';
} elseif ($audience !== GOOGLE_CLIENT_ID) {
    $rejection = 'audience';
} elseif ($expiresAt <= time()) {
    $rejection = 'expired';
} elseif (!$emailVerified) {
    $rejection = 'email_unverified';
} elseif ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    $rejection = 'email_missing';
}

if ($rejection !== null) {
    write_auth_audit($pdo, null, 'login.google_failed', 'A Google sign-in was rejected because the credential could not be verified.', [
        'identifier' => $email !== '' ? $email : null,
        'reason' => $rejection,
    ]);

    json_response([
        'success' => false,
        'message' => 'Google sign-in could not be verified. Please try again.',
    ], 401);
}

ensure_user_security_columns($pdo);
ensure_two_factor_schema($pdo);
ensure_email_verification_columns($pdo);

$user = login_find_user_by_email($pdo, $email);

if (!$user) {
    write_auth_audit($pdo, null, 'login.google_failed', 'A Google sign-in was refused because no account has that email address.', [
        'identifier' => $email,
        'reason' => 'no_account',
    ]);

    json_response([
        'success' => false,
        'message' => GOOGLE_NO_ACCOUNT_MESSAGE,
    ], 401);
}

$lockedUntilTimestamp = datetime_timestamp($user['locked_until'] ?? null);

if ($lockedUntilTimestamp !== null && $lockedUntilTimestamp > time()) {
    write_auth_audit($pdo, $user, 'login.locked', 'A Google sign-in was blocked because the account is locked.', [
        'username' => $user['username'],
        'locked_until' => $user['locked_until'],
        'method' => 'google',
    ]);

    json_response(array_merge([
        'success' => false,
        'message' => login_locked_until_message($user['locked_until']),
    ], login_lock_payload($lockedUntilTimestamp, false)), 423);
}

if ($lockedUntilTimestamp !== null) {
    login_clear_failed_attempts($pdo, (int)$user['id']);
    $user['failed_login_attempts'] = 0;
    $user['locked_until'] = null;
}

/*
 * The same generic refusal as an unknown address, for the reason given at the top of the file. The
 * audit log keeps the real reason where administrators can read it, as login.php's does.
 */
if ((int)($user['is_archived'] ?? 0) === 1) {
    write_auth_audit($pdo, $user, 'login.archived', 'A Google sign-in was blocked because the account has been archived.', [
        'username' => $user['username'],
        'method' => 'google',
    ]);

    json_response([
        'success' => false,
        'message' => GOOGLE_NO_ACCOUNT_MESSAGE,
    ], 401);
}

if (strtolower((string)$user['status']) !== 'active') {
    write_auth_audit($pdo, $user, 'login.inactive', 'A Google sign-in was blocked because the account is inactive.', [
        'username' => $user['username'],
        'status' => $user['status'],
        'method' => 'google',
    ]);

    json_response([
        'success' => false,
        'message' => GOOGLE_NO_ACCOUNT_MESSAGE,
    ], 401);
}

$emailPolicyViolation = email_domain_policy_violation($pdo, (string)($user['email'] ?? ''));
if ($emailPolicyViolation !== null) {
    write_auth_audit($pdo, $user, 'login.email_domain_blocked', 'A Google sign-in was blocked by the email domain policy.', [
        'username' => $user['username'] ?? null,
        'email' => $user['email'] ?? null,
        'method' => 'google',
    ]);

    json_response([
        'success' => false,
        'message' => $emailPolicyViolation,
    ], 403);
}

// Google has just proven who this is, which is the same thing a correct password proves.
login_clear_failed_attempts($pdo, (int)$user['id']);

if (two_factor_required($pdo, $user)) {
    try {
        $twoFactorChallenge = two_factor_issue_code($pdo, $user);
    } catch (Throwable $exception) {
        write_auth_audit($pdo, $user, 'login.two_factor_email_failed', 'A Google sign-in was blocked because the 2FA email could not be sent.', [
            'username' => $user['username'],
            'method' => 'google',
            'error' => $exception->getMessage(),
        ]);

        json_response([
            'success' => false,
            'message' => 'Unable to send verification code. Check SMTP settings and try again.',
            'error' => $exception->getMessage(),
        ], 500);
    }

    unset($_SESSION['user']);
    $_SESSION['last_activity_at'] = time();

    write_auth_audit($pdo, $user, 'login.two_factor_required', 'A user passed Google verification and was sent a 2FA code.', [
        'username' => $user['username'],
        'method' => 'google',
    ]);

    json_response([
        'success' => true,
        'requiresTwoFactor' => true,
        'message' => 'Verification code sent.',
        'twoFactor' => $twoFactorChallenge,
    ]);
}

$sessionUser = format_user($user);
session_regenerate_id(true);
$_SESSION['user'] = $sessionUser;
$_SESSION['last_activity_at'] = time();

write_auth_audit($pdo, $sessionUser, 'login.success', 'A user signed in successfully with Google.', [
    'username' => $sessionUser['username'],
    'method' => 'google',
    'two_factor' => false,
]);
two_factor_notify_admins_of_login($pdo, $sessionUser);

// Sent after the response for the reason login.php gives: the session exists whether or not Gmail answers.
$loginAlertEmail = (string)($sessionUser['email'] ?? '');
defer(static function () use ($loginAlertEmail): void {
    two_factor_safe_alert_email(
        $loginAlertEmail,
        'New Login Detected',
        'A successful login to your MGB HRIS account using Google sign-in was detected. If this was not you, contact the HRIS administrator immediately.'
    );
});

json_response([
    'success' => true,
    'message' => 'Login successful.',
    'user' => $sessionUser,
]);
