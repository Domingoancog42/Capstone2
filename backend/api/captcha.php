<?php
declare(strict_types=1);

// POST on this endpoint only pre-verifies the anonymous login captcha (see the method branch below).
if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'POST') {
    define('HRIS_CSRF_EXEMPT', true);
}

/*
 * Deals a captcha challenge.
 *
 * `purpose` picks which flow is asking; it defaults to the login screen, which is the caller that
 * existed first. See the purposes note in captcha-utils.php for what each one is for.
 *
 * The login purpose runs before authentication but still uses the anonymous browser session that
 * holds its challenge. GET deals the image; POST checks a completed one-digit answer for the login
 * field. Both methods count against the general API rate limit; the anonymous POST is intentionally
 * CSRF-exempt so an expired pre-login session cannot block the form before credentials are submitted.
 *
 * Every other purpose guards an action only a signed-in user can reach, so it asks for a session
 * first -- a challenge dealt to nobody is a challenge nobody can spend, and dealing them to anonymous
 * callers would let one client churn through the rate limit on an account's behalf.
 *
 * The answer is not in the response. See captcha-utils.php for what is kept and where.
 */

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/captcha-utils.php';

// A challenge is dealt fresh on every call and answers exactly one attempt, so a cached copy is a
// challenge whose answer the server has already thrown away.
header('Cache-Control: no-store, max-age=0');

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$body = $method === 'POST' ? read_json_body() : [];
$purpose = trim((string)($body['purpose'] ?? $_GET['purpose'] ?? CAPTCHA_PURPOSE_LOGIN));

if ($purpose === '') {
    $purpose = CAPTCHA_PURPOSE_LOGIN;
}

if (!captcha_purpose_valid($purpose)) {
    json_response([
        'success' => false,
        'message' => 'Unknown security check.',
    ], 422);
}

if ($method === 'POST') {
    if (trim((string)($_GET['action'] ?? '')) !== 'verify' || $purpose !== CAPTCHA_PURPOSE_LOGIN) {
        json_response([
            'success' => false,
            'message' => 'Unknown security check action.',
        ], 422);
    }

    if (!login_captcha_enabled($pdo)) {
        captcha_session_reopen();
        captcha_forget(CAPTCHA_PURPOSE_LOGIN);

        json_response([
            'success' => true,
            'enabled' => false,
            'correct' => false,
            'refresh' => false,
        ]);
    }

    $result = captcha_preverify(
        CAPTCHA_PURPOSE_LOGIN,
        captcha_body_text($body, 'captchaId'),
        captcha_body_text($body, 'captchaAnswer')
    );

    json_response([
        'success' => true,
        'enabled' => true,
        'correct' => $result['ok'],
        'refresh' => $result['refresh'],
        'message' => $result['message'],
    ]);
}

require_method('GET');

if ($purpose !== CAPTCHA_PURPOSE_LOGIN) {
    require_session_user();

    json_response(array_merge(
        ['success' => true, 'enabled' => true],
        captcha_issue($purpose)
    ));
}

/*
 * Nothing is dealt while the administrator has the login captcha switched off, and any challenge
 * already sitting in the session is dropped rather than left to expire on its own. login.php reads
 * the same setting, so the two cannot disagree about whether an answer is expected.
 *
 * This switch is deliberately login-only: payroll and approval challenges are deliberateness gates
 * on consequential actions, so the Captcha settings screen cannot turn those checks off.
 */
if (!login_captcha_enabled($pdo)) {
    captcha_session_reopen();
    captcha_forget(CAPTCHA_PURPOSE_LOGIN);

    json_response([
        'success' => true,
        'enabled' => false,
    ]);
}

json_response(array_merge(
    ['success' => true, 'enabled' => true],
    captcha_issue(CAPTCHA_PURPOSE_LOGIN)
));
