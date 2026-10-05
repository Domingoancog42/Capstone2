<?php
declare(strict_types=1);

/*
 * The math captcha.
 *
 * It used to live entirely in the browser: login.jsx dealt the sum, login.jsx knew the answer, and
 * login.jsx decided whether the answer was right. login.php was never told a captcha existed at all,
 * so anything that skipped the form -- curl, a script, a replayed request -- signed in without ever
 * meeting one. A check the client both sets and marks is not a check.
 *
 * So the challenge is dealt here and the answer never leaves the server. What the browser receives is
 * an identifier and two pictures of digits; what it sends back is that identifier and whatever the
 * user typed. The endpoint being guarded asks this file whether the pair matches before it does any
 * work, and one challenge answers exactly one attempt.
 *
 * Four things have to be true for that to be worth anything, and each is handled below:
 *
 *   the answer is not in the response      only a salted hash of it is kept, and only in the session
 *   a challenge cannot be reused           it is destroyed the moment it is answered correctly
 *   a challenge cannot be sat on           CAPTCHA_TTL_SECONDS, checked against the server clock
 *   an answer cannot be counted through    CAPTCHA_MAX_ATTEMPTS, after which it is destroyed
 *
 * What it is still not: proof of a human. A math captcha is arithmetic, and anything that can read
 * the digits can do the arithmetic. The digits are drawn into an image rather than sent as text so
 * that reading them costs an attacker OCR instead of a JSON field, but the guard that actually bounds a
 * scripted attack is throttle_login() sitting in front of the sign-in, plus the per-account lockout
 * behind it. This raises the price of an automated attempt; the rate limiter is what caps how many
 * of them can be bought.
 *
 * PURPOSES
 *
 * Three flows use this, and each keeps its own challenge in its own session slot. They have to: an
 * approver with a payroll dialog open has no login challenge in flight, and dealing one for either
 * flow must not quietly spend the other's. The purpose also travels into the answer hash, so a
 * challenge dealt for one flow cannot be presented to the other.
 *
 *   login              the sign-in form. Public -- there is no session yet -- and switchable off by
 *                      an administrator through login_captcha_enabled().
 *   payroll_workflow   the one-way steps a payroll batch takes: submitting it for approval,
 *                      approving it, and the Cashier marking it paid. Not switchable: it is not
 *                      there to stop a robot signing in, it is there so the most consequential and
 *                      least reversible actions in the system cannot be fired by a stray click, a
 *                      double-submit or a replayed request. See payroll.php.
 *   approval_workflow  an approver signing off a request: a leave request, a leave monetization, a
 *                      compensatory time off request, or a travel order. Like the payroll one it is
 *                      a deliberateness gate rather than an anti-robot measure, so it is not
 *                      switchable either. The four flows share a purpose because they share a shape
 *                      -- one approver, one dialog, one signature -- and only one of those dialogs
 *                      can be open at a time, so they cannot spend each other's challenge. What
 *                      they must not share is payroll's: releasing money is a different decision
 *                      from endorsing a day off, and a sum answered for one is not consent to the
 *                      other. Refusals and cancellations are deliberately NOT gated, for the same
 *                      reason payroll leaves returning a batch for correction ungated: they are the
 *                      moves that can be walked back, and slowing the safe move down is backwards.
 */

const CAPTCHA_SESSION_KEY = 'captcha_challenges';
const CAPTCHA_APPROVAL_BATCH_SESSION_KEY = 'captcha_approval_batches';

const CAPTCHA_PURPOSE_LOGIN = 'login';
const CAPTCHA_PURPOSE_PAYROLL_WORKFLOW = 'payroll_workflow';
const CAPTCHA_PURPOSE_APPROVAL_WORKFLOW = 'approval_workflow';

/** Anything not on this list is refused rather than given a slot of its own. */
const CAPTCHA_PURPOSES = [
    CAPTCHA_PURPOSE_LOGIN,
    CAPTCHA_PURPOSE_PAYROLL_WORKFLOW,
    CAPTCHA_PURPOSE_APPROVAL_WORKFLOW,
];

/** How long a dealt challenge stays answerable. Long enough to type, short enough not to be farmed. */
const CAPTCHA_TTL_SECONDS = 120;

/**
 * Wrong answers allowed before the challenge is thrown away. Every answer is one digit so the login
 * field can ask the server for a verdict as soon as that digit is typed; three tries prevents that
 * small answer space from simply being counted through.
 * generous for a typo and useless as a search.
 */
const CAPTCHA_MAX_ATTEMPTS = 3;

/** Matches the pale fill of the operand boxes, so the image sits inside its border seamlessly. */
const CAPTCHA_BACKGROUND = [248, 250, 252];

/*
 * Twice the 70x56 box the field draws it in, so the digit stays sharp on a high-density screen rather
 * than being upscaled by the browser on top of the upscale it already went through.
 */
const CAPTCHA_IMAGE_WIDTH = 140;
const CAPTCHA_IMAGE_HEIGHT = 112;
const CAPTCHA_GLYPH_WIDTH = 58;
const CAPTCHA_GLYPH_HEIGHT = 84;

/** Only the login challenge is switchable; see the purposes note above. */
function login_captcha_enabled(PDO $pdo): bool
{
    return get_boolean_application_setting($pdo, 'login_captcha_enabled', true);
}

function captcha_purpose_valid(string $purpose): bool
{
    return in_array($purpose, CAPTCHA_PURPOSES, true);
}

/**
 * Re-acquires the session so a challenge can be stored or spent.
 *
 * require_session_user() closes the session as soon as it has finished with it, because PHP's file
 * handler holds a per-browser lock for the rest of the script and that lock is what serialises a
 * dashboard's parallel requests (see the note over its session_write_close()). Reading $_SESSION
 * still works afterwards; writing does not. So the two operations that write -- dealing a challenge
 * and spending one -- reopen it here, and only they pay the lock. A GET list or a preview never
 * touches this and keeps running alongside its neighbours.
 */
function captcha_session_reopen(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
}

/**
 * Whether this installation can draw the digits.
 *
 * GD ships with XAMPP but may not be loaded by the Apache process even when the CLI has it. The core
 * PHP raster renderer below is therefore the fallback; this check only decides which PNG renderer is
 * used.
 */
function captcha_images_available(): bool
{
    return function_exists('imagecreatetruecolor')
        && function_exists('imagestring')
        && function_exists('imagescale')
        && function_exists('imagerotate')
        && function_exists('imagepng');
}

/** Hand-drawn polylines for the portable raster renderer. No operand is placed in response text. */
function captcha_raster_digit_strokes(int $digit): array
{
    $strokes = [
        1 => [
            [[43, 34], [51, 30], [61, 20], [61, 97]],
            [[44, 97], [80, 97]],
        ],
        2 => [[
            [31, 35], [36, 25], [47, 19], [63, 18], [77, 22], [84, 31], [82, 43],
            [73, 55], [61, 66], [47, 78], [31, 94], [50, 92], [69, 92], [88, 93],
        ]],
        3 => [[
            [32, 22], [48, 17], [64, 18], [76, 22], [83, 29], [82, 37], [75, 45],
            [61, 53], [72, 54], [82, 59], [86, 68], [84, 78], [77, 87], [66, 93],
            [51, 95], [34, 92],
        ]],
        4 => [
            [[78, 99], [78, 20]],
            [[78, 21], [30, 72], [92, 71]],
        ],
        5 => [[
            [84, 20], [36, 20], [32, 51], [47, 47], [61, 49], [73, 56], [82, 66],
            [82, 77], [76, 88], [65, 95], [51, 96], [39, 92], [31, 87],
        ]],
        6 => [[
            [80, 23], [69, 18], [55, 18], [44, 24], [36, 34], [31, 47], [29, 60],
            [30, 75], [36, 88], [47, 96], [59, 98], [72, 94], [80, 85], [84, 74],
            [82, 62], [76, 54], [66, 50], [55, 50], [44, 54], [36, 62], [31, 71],
        ]],
        7 => [[
            [29, 20], [91, 20], [82, 31], [72, 45], [64, 58], [58, 72], [52, 88], [50, 99],
        ]],
        8 => [[
            [59, 55], [46, 51], [38, 44], [35, 35], [37, 26], [44, 20], [54, 17],
            [65, 18], [74, 23], [80, 31], [80, 39], [76, 47], [68, 53], [59, 55],
            [47, 57], [38, 62], [33, 70], [32, 80], [36, 90], [45, 97], [57, 100],
            [69, 97], [79, 91], [84, 82], [84, 73], [80, 64], [72, 58], [59, 55],
        ]],
        9 => [[
            [82, 63], [81, 48], [77, 33], [68, 22], [56, 18], [44, 19], [34, 25],
            [29, 35], [28, 45], [31, 57], [39, 66], [50, 69], [61, 68], [72, 61],
            [80, 50], [82, 64], [80, 78], [73, 90], [65, 97], [57, 100],
        ]],
    ];

    return $strokes[$digit] ?? $strokes[1];
}

/** Sets one palette index, clipping noisy strokes at the edge of the tile. */
function captcha_raster_set_pixel(array &$rows, int $x, int $y, int $paletteIndex): void
{
    if ($x < 0 || $x >= CAPTCHA_IMAGE_WIDTH || $y < 0 || $y >= CAPTCHA_IMAGE_HEIGHT) {
        return;
    }

    $rows[$y][$x] = chr($paletteIndex);
}

/** Draws a rounded, thick line into the tiny indexed-colour canvas. */
function captcha_raster_draw_line(
    array &$rows,
    int $x1,
    int $y1,
    int $x2,
    int $y2,
    int $paletteIndex,
    int $thickness
): void {
    $deltaX = $x2 - $x1;
    $deltaY = $y2 - $y1;
    $steps = max(abs($deltaX), abs($deltaY), 1);
    $radius = max(0, intdiv($thickness, 2));

    for ($step = 0; $step <= $steps; $step++) {
        $x = (int)round($x1 + ($deltaX * $step / $steps));
        $y = (int)round($y1 + ($deltaY * $step / $steps));

        for ($offsetY = -$radius; $offsetY <= $radius; $offsetY++) {
            for ($offsetX = -$radius; $offsetX <= $radius; $offsetX++) {
                if (($offsetX * $offsetX) + ($offsetY * $offsetY) <= ($radius * $radius)) {
                    captcha_raster_set_pixel($rows, $x + $offsetX, $y + $offsetY, $paletteIndex);
                }
            }
        }
    }
}

/** Affine distortion keeps the same digit from producing a reusable pixel template. */
function captcha_raster_transform_point(array $point, array $distortion): array
{
    [$x, $y] = $point;
    $x = 70 + (($x - 70) * $distortion['scale_x'] / 100);
    $y = 56 + (($y - 56) * $distortion['scale_y'] / 100);
    $x += (($y - 56) * $distortion['skew'] / 100);

    $radians = deg2rad($distortion['rotation']);
    $relativeX = $x - 70;
    $relativeY = $y - 56;

    return [
        (int)round(70 + ($relativeX * cos($radians)) - ($relativeY * sin($radians)) + $distortion['shift_x']),
        (int)round(56 + ($relativeX * sin($radians)) + ($relativeY * cos($radians)) + $distortion['shift_y']),
    ];
}

/** Encodes a PNG chunk with its length and checksum. */
function captcha_png_chunk(string $type, string $data): string
{
    return pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
}

/**
 * Draws and encodes a noisy indexed-colour PNG using only core PHP and zlib.
 *
 * This path is used when Apache has not loaded GD. The browser receives the same kind of raster tile
 * as it does from GD: the number is present only as pixels, never as a JSON digit or an SVG path.
 */
function captcha_render_portable_png_digit(int $digit): ?string
{
    if (!function_exists('gzcompress')) {
        return null;
    }

    $rows = array_fill(0, CAPTCHA_IMAGE_HEIGHT, str_repeat(chr(0), CAPTCHA_IMAGE_WIDTH));
    $distortion = [
        'rotation' => random_int(-14, 14),
        'skew' => random_int(-9, 9),
        'scale_x' => random_int(92, 106),
        'scale_y' => random_int(94, 105),
        'shift_x' => random_int(-4, 4),
        'shift_y' => random_int(-2, 2),
    ];
    $strokeWidth = random_int(7, 9);

    foreach (captcha_raster_digit_strokes($digit) as $stroke) {
        $points = array_map(
            static fn(array $point): array => captcha_raster_transform_point($point, $distortion),
            $stroke
        );

        for ($point = 1, $count = count($points); $point < $count; $point++) {
            [$x1, $y1] = $points[$point - 1];
            [$x2, $y2] = $points[$point];

            // A pale, offset edge softens the otherwise perfectly digital outline.
            captcha_raster_draw_line($rows, $x1 + 2, $y1 + 2, $x2 + 2, $y2 + 2, 2, $strokeWidth + 3);
            captcha_raster_draw_line($rows, $x1, $y1, $x2, $y2, 3, $strokeWidth);
        }
    }

    // Cross the glyph as well as the background so the texture cannot simply be colour-masked away.
    for ($line = 0; $line < 4; $line++) {
        captcha_raster_draw_line(
            $rows,
            random_int(0, CAPTCHA_IMAGE_WIDTH - 1),
            random_int(0, CAPTCHA_IMAGE_HEIGHT - 1),
            random_int(0, CAPTCHA_IMAGE_WIDTH - 1),
            random_int(0, CAPTCHA_IMAGE_HEIGHT - 1),
            1,
            random_int(1, 2)
        );
    }

    for ($dot = 0; $dot < 180; $dot++) {
        captcha_raster_set_pixel(
            $rows,
            random_int(0, CAPTCHA_IMAGE_WIDTH - 1),
            random_int(0, CAPTCHA_IMAGE_HEIGHT - 1),
            1
        );
    }

    [$backgroundRed, $backgroundGreen, $backgroundBlue] = CAPTCHA_BACKGROUND;
    $palette = chr($backgroundRed) . chr($backgroundGreen) . chr($backgroundBlue)
        . chr(143) . chr(163) . chr(189)
        . chr(100) . chr(116) . chr(139)
        . chr(random_int(20, 48)) . chr(random_int(27, 55)) . chr(random_int(38, 68));
    $scanlines = '';

    foreach ($rows as $row) {
        $scanlines .= chr(0) . $row;
    }

    $compressed = gzcompress($scanlines, 9);

    if (!is_string($compressed) || $compressed === '') {
        return null;
    }

    $png = "\x89PNG\r\n\x1a\n"
        . captcha_png_chunk('IHDR', pack('NNCCCCC', CAPTCHA_IMAGE_WIDTH, CAPTCHA_IMAGE_HEIGHT, 8, 3, 0, 0, 0))
        . captcha_png_chunk('PLTE', $palette)
        . captcha_png_chunk('IDAT', $compressed)
        . captcha_png_chunk('IEND', '');

    return 'data:image/png;base64,' . base64_encode($png);
}

/**
 * The answer as it is stored. Keyed by the challenge id and the purpose, so the hash of "7" for one
 * challenge is not the hash of "7" for the next -- two sessions holding the same answer do not hold
 * the same string, and a session file read off disk yields neither the answer nor a table to look it
 * up in. Folding the purpose in is what stops a challenge dealt for the login form being replayed
 * against a payroll approval.
 */
function captcha_answer_hash(string $purpose, string $challengeId, string $answer): string
{
    return hash_hmac('sha256', trim($answer), $purpose . ':' . $challengeId);
}

/**
 * Drops a purpose's challenge. Writes, so the caller must already have reopened the session --
 * captcha_issue() and captcha_verify() both do.
 */
function captcha_forget(string $purpose): void
{
    unset($_SESSION[CAPTCHA_SESSION_KEY][$purpose]);
}

/**
 * Deals a challenge, stores its answer, and returns what the browser is allowed to see.
 *
 * Both operands are always a single digit, and subtraction is ordered so the answer is never zero or
 * negative. That is a rendering decision as much as an arithmetic one: one digit per box means the
 * renderer centres a single glyph rather than laying out a string, which is what keeps two rotated
 * characters from overlapping each other.
 */
function captcha_issue(string $purpose): array
{
    if (random_int(0, 1) === 1) {
        $left = random_int(3, 9);
        $right = random_int(1, $left - 1);
        $operator = '-';
        $answer = $left - $right;
    } else {
        // Keep the result to one digit. This lets the login field know when the answer is complete
        // without disclosing its length separately or rejecting the first digit of a two-digit sum.
        $left = random_int(1, 8);
        $right = random_int(1, 9 - $left);
        $operator = '+';
        $answer = $left + $right;
    }

    $challengeId = bin2hex(random_bytes(16));

    captcha_session_reopen();
    $_SESSION[CAPTCHA_SESSION_KEY][$purpose] = [
        'id' => $challengeId,
        'answer' => captcha_answer_hash($purpose, $challengeId, (string)$answer),
        'expires_at' => time() + CAPTCHA_TTL_SECONDS,
        'attempts' => 0,
    ];

    $leftImage = captcha_render_digit($left);
    $rightImage = captcha_render_digit($right);
    $drawn = $leftImage !== null && $rightImage !== null;

    /*
     * The operator travels as text. It is not the secret -- there are two of them and the shape of the
     * problem is public -- and the login screen renders it as the plain "+" between the two boxes that
     * the design calls for.
     */
    return [
        'captchaId' => $challengeId,
        'purpose' => $purpose,
        'operator' => $operator,
        'expiresIn' => CAPTCHA_TTL_SECONDS,
        'mode' => $drawn ? 'image' : 'text',
        'left' => $drawn ? $leftImage : (string)$left,
        'right' => $drawn ? $rightImage : (string)$right,
    ];
}

/**
 * Checks a login answer while the user is typing, but does not spend a correct challenge yet.
 *
 * A correct result is marked in the server-side session. login.php later consumes that mark through
 * captcha_verify(), so the browser can show a trustworthy green border without receiving the answer,
 * and the solved challenge still authorizes only one sign-in attempt. Wrong checks retain the normal
 * attempt cap; `refresh` tells the browser when that challenge no longer exists.
 */
function captcha_preverify(string $purpose, string $challengeId, string $answer): array
{
    captcha_session_reopen();

    $stored = $_SESSION[CAPTCHA_SESSION_KEY][$purpose] ?? null;
    $answer = trim($answer);

    if (!is_array($stored) || !isset($stored['id'], $stored['answer'], $stored['expires_at'])) {
        return [
            'ok' => false,
            'refresh' => true,
            'message' => 'Your security check has expired. Answer the new one and try again.',
        ];
    }

    if ($challengeId === '' || !hash_equals((string)$stored['id'], $challengeId)) {
        captcha_forget($purpose);

        return [
            'ok' => false,
            'refresh' => true,
            'message' => 'Your security check is no longer valid. Answer the new one and try again.',
        ];
    }

    if (time() > (int)$stored['expires_at']) {
        captcha_forget($purpose);

        return [
            'ok' => false,
            'refresh' => true,
            'message' => 'Your security check has expired. Answer the new one and try again.',
        ];
    }

    if (!empty($stored['solved_at'])) {
        return ['ok' => true, 'refresh' => false, 'message' => ''];
    }

    if ($answer === '') {
        return [
            'ok' => false,
            'refresh' => false,
            'message' => 'Answer the security check before continuing.',
        ];
    }

    if (hash_equals((string)$stored['answer'], captcha_answer_hash($purpose, (string)$stored['id'], $answer))) {
        $_SESSION[CAPTCHA_SESSION_KEY][$purpose]['solved_at'] = time();

        return ['ok' => true, 'refresh' => false, 'message' => ''];
    }

    $attempts = (int)($stored['attempts'] ?? 0) + 1;

    if ($attempts >= CAPTCHA_MAX_ATTEMPTS) {
        captcha_forget($purpose);

        return [
            'ok' => false,
            'refresh' => true,
            'message' => 'That answer was wrong too many times. Answer the new security check and try again.',
        ];
    }

    $_SESSION[CAPTCHA_SESSION_KEY][$purpose]['attempts'] = $attempts;

    return [
        'ok' => false,
        'refresh' => false,
        'message' => 'That is not the right answer to the security check.',
    ];
}

/**
 * Checks an answer against the dealt challenge and consumes it.
 *
 * Returns ['ok' => bool, 'message' => string]. Every refusal says the same kind of thing on purpose:
 * the caller cannot tell an expired challenge from a mismatched one closely enough to learn anything,
 * and in all of these cases what the user has to do next is identical -- answer the new one.
 */
function captcha_verify(string $purpose, string $challengeId, string $answer): array
{
    // Every branch below either spends the challenge or counts an attempt against it, so the session
    // has to be writable before the first of them can run.
    captcha_session_reopen();

    $stored = $_SESSION[CAPTCHA_SESSION_KEY][$purpose] ?? null;
    $answer = trim($answer);

    if (!is_array($stored) || !isset($stored['id'], $stored['answer'], $stored['expires_at'])) {
        return [
            'ok' => false,
            'message' => 'Your security check has expired. Answer the new one and try again.',
        ];
    }

    /*
     * An id that does not match the one on file is not a typo -- the browser sends back the id it was
     * given -- so the challenge goes, rather than letting a caller probe with ids of its own choosing
     * while the real one waits intact.
     */
    if ($challengeId === '' || !hash_equals((string)$stored['id'], $challengeId)) {
        captcha_forget($purpose);

        return [
            'ok' => false,
            'message' => 'Your security check is no longer valid. Answer the new one and try again.',
        ];
    }

    // The server's clock, not the browser's. A client that simply never counts down cannot hold a
    // challenge open, and one whose clock is wrong is not punished for it.
    if (time() > (int)$stored['expires_at']) {
        captcha_forget($purpose);

        return [
            'ok' => false,
            'message' => 'Your security check has expired. Answer the new one and try again.',
        ];
    }

    /*
     * A correct live check is proof held in this session, not a claim from the browser. Spend it now,
     * before credentials are inspected, exactly as a correct answer submitted directly is spent.
     */
    if (!empty($stored['solved_at'])) {
        captcha_forget($purpose);

        return ['ok' => true, 'message' => ''];
    }

    // An empty box is the user not having answered yet rather than a guess, so it does not spend one
    // of the three attempts. The form asks for the same thing again and nothing is thrown away.
    if ($answer === '') {
        return [
            'ok' => false,
            'message' => 'Answer the security check before continuing.',
        ];
    }

    if (hash_equals((string)$stored['answer'], captcha_answer_hash($purpose, (string)$stored['id'], $answer))) {
        // Single use. The correct answer is spent here whether or not the action behind it succeeds, so a
        // captcha solved once cannot be attached to a run of password guesses or a run of approvals.
        captcha_forget($purpose);

        return ['ok' => true, 'message' => ''];
    }

    $attempts = (int)($stored['attempts'] ?? 0) + 1;

    if ($attempts >= CAPTCHA_MAX_ATTEMPTS) {
        captcha_forget($purpose);

        return [
            'ok' => false,
            'message' => 'That answer was wrong too many times. Answer the new security check and try again.',
        ];
    }

    $_SESSION[CAPTCHA_SESSION_KEY][$purpose]['attempts'] = $attempts;

    return [
        'ok' => false,
        'message' => 'That is not the right answer to the security check.',
    ];
}

/** A field of the decoded request body as a trimmed string, or '' when it is not one. */
function captcha_body_text(array $body, string $key): string
{
    $value = $body[$key] ?? '';

    // Bodies arrive as decoded JSON, so a field can be an array or an object. Either is a malformed
    // request rather than a value worth casting, and casting one would be a fatal instead of a refusal.
    return is_scalar($value) ? trim((string)$value) : '';
}

/**
 * The gate an endpoint puts in front of a guarded action.
 *
 * Verifies the pair the request carried and answers on the endpoint's behalf when it does not check
 * out, so the work behind it is never reached. Callers therefore treat a return as permission and do
 * not test anything themselves -- there is no path past this that a missing or forged pair survives.
 *
 * `captchaFailed` is how the browser tells a refused check apart from a failed action: nothing was
 * written, the record is untouched, and what the user has to do is answer a fresh sum. Reporting it
 * as an update failure would be a lie about the record.
 */
function captcha_require(string $purpose, array $body): void
{
    $result = captcha_verify(
        $purpose,
        captcha_body_text($body, 'captchaId'),
        captcha_body_text($body, 'captchaAnswer')
    );

    if ($result['ok']) {
        return;
    }

    json_response([
        'success' => false,
        'message' => $result['message'],
        'captchaFailed' => true,
    ], 422);
}

/**
 * The gate in front of an approval, wherever it is signed.
 *
 * Leave, leave monetization, compensatory time off and travel orders each call this from their own
 * update handler, so the four cannot drift apart on what a valid check is. See the approval_workflow
 * entry in the purposes note above for which transitions are gated and which are deliberately not.
 */
function approval_captcha_batch_targets(array $body): array
{
    if (!array_key_exists('captchaBatchTargets', $body)) {
        return [];
    }

    $rawTargets = $body['captchaBatchTargets'];

    if (!is_array($rawTargets) || count($rawTargets) < 2 || count($rawTargets) > 50) {
        json_response([
            'success' => false,
            'message' => 'The bulk approval selection is invalid. Select the requests again and retry.',
            'captchaFailed' => true,
        ], 422);
    }

    $targets = [];

    foreach ($rawTargets as $rawTarget) {
        $target = is_scalar($rawTarget) ? strtolower(trim((string)$rawTarget)) : '';

        if ($target === '' || preg_match('/^[a-z_]+:[1-9][0-9]*$/', $target) !== 1) {
            json_response([
                'success' => false,
                'message' => 'The bulk approval selection is invalid. Select the requests again and retry.',
                'captchaFailed' => true,
            ], 422);
        }

        $targets[$target] = true;
    }

    return array_keys($targets);
}

function approval_captcha_failure(string $message): void
{
    json_response([
        'success' => false,
        'message' => $message,
        'captchaFailed' => true,
    ], 422);
}

/**
 * The approval gate also understands an explicit, short-lived list of bulk targets.
 *
 * The first selected request spends the solved challenge and stores only the remaining target keys
 * in this authenticated session. Every later request must present the same challenge id and match
 * one of those exact keys; a key is removed before its update runs and cannot be replayed. This lets
 * one deliberate confirmation sign a selected batch without turning the captcha into a general
 * approval token.
 */
function require_approval_captcha(array $body, string $resourceType = '', int $resourceId = 0): void
{
    $batchTargets = approval_captcha_batch_targets($body);

    if ($batchTargets === []) {
        captcha_require(CAPTCHA_PURPOSE_APPROVAL_WORKFLOW, $body);
        return;
    }

    $resourceType = strtolower(trim($resourceType));
    $currentTarget = $resourceType !== '' && $resourceId > 0
        ? $resourceType . ':' . $resourceId
        : '';
    $captchaId = captcha_body_text($body, 'captchaId');

    if ($currentTarget === '' || !in_array($currentTarget, $batchTargets, true) || $captchaId === '') {
        approval_captcha_failure('The bulk approval selection no longer matches this request. Select the requests again and retry.');
    }

    captcha_session_reopen();
    $storedBatch = $_SESSION[CAPTCHA_APPROVAL_BATCH_SESSION_KEY][$captchaId] ?? null;

    if (is_array($storedBatch)) {
        if (time() > (int)($storedBatch['expires_at'] ?? 0)) {
            unset($_SESSION[CAPTCHA_APPROVAL_BATCH_SESSION_KEY][$captchaId]);
            approval_captcha_failure('Your bulk approval security check has expired. Select the requests and try again.');
        }

        $remainingTargets = is_array($storedBatch['targets'] ?? null) ? $storedBatch['targets'] : [];

        if (!isset($remainingTargets[$currentTarget])) {
            approval_captcha_failure('This request was not included in the confirmed bulk approval selection.');
        }

        // Consume before the endpoint writes, just like captcha_verify() consumes a single approval.
        unset($_SESSION[CAPTCHA_APPROVAL_BATCH_SESSION_KEY][$captchaId]['targets'][$currentTarget]);

        if ($_SESSION[CAPTCHA_APPROVAL_BATCH_SESSION_KEY][$captchaId]['targets'] === []) {
            unset($_SESSION[CAPTCHA_APPROVAL_BATCH_SESSION_KEY][$captchaId]);
        }

        return;
    }

    $result = captcha_verify(
        CAPTCHA_PURPOSE_APPROVAL_WORKFLOW,
        $captchaId,
        captcha_body_text($body, 'captchaAnswer')
    );

    if (!$result['ok']) {
        approval_captcha_failure($result['message']);
    }

    $remainingTargets = array_fill_keys($batchTargets, true);
    unset($remainingTargets[$currentTarget]);

    if ($remainingTargets !== []) {
        $_SESSION[CAPTCHA_APPROVAL_BATCH_SESSION_KEY][$captchaId] = [
            'targets' => $remainingTargets,
            'expires_at' => time() + CAPTCHA_TTL_SECONDS,
        ];
    }
}

/**
 * One digit, drawn.
 *
 * GD has no font of its own beyond five built-in bitmap faces, the largest of which is nine pixels by
 * fifteen -- far too small to put in front of anyone. Rather than depend on a TTF file that a fresh
 * checkout has no reason to contain, the glyph is drawn at that size and then scaled up: the bilinear
 * resample that enlarges it is also what softens its edges, which is the blur an OCR pass has to work
 * through. Rotation, a wandering ink colour, three stray lines and a scatter of dots are laid on top.
 *
 * The result is returned as a data URI rather than served from a second endpoint. An <img> pointing at
 * a URL is a separate request that would have to find the same session -- across origins in the dev
 * setup, where the React server and Apache are on different ports -- and would have to be kept out of
 * the browser cache by hand. Inlining it makes the picture part of the answer it belongs to.
 *
 * When GD is absent or drawing fails, the portable PNG renderer keeps the challenge visual
 * instead of exposing plain digits.
 */
function captcha_render_digit(int $digit): ?string
{
    if (!captcha_images_available()) {
        return captcha_render_portable_png_digit($digit);
    }

    [$backgroundRed, $backgroundGreen, $backgroundBlue] = CAPTCHA_BACKGROUND;

    try {
        $canvas = imagecreatetruecolor(CAPTCHA_IMAGE_WIDTH, CAPTCHA_IMAGE_HEIGHT);

        if ($canvas === false) {
            return null;
        }

        imagefilledrectangle(
            $canvas,
            0,
            0,
            CAPTCHA_IMAGE_WIDTH,
            CAPTCHA_IMAGE_HEIGHT,
            imagecolorallocate($canvas, $backgroundRed, $backgroundGreen, $backgroundBlue)
        );

        $font = 5;
        $cell = imagecreatetruecolor(imagefontwidth($font), imagefontheight($font));

        if ($cell === false) {
            return null;
        }

        imagefilledrectangle(
            $cell,
            0,
            0,
            imagefontwidth($font),
            imagefontheight($font),
            imagecolorallocate($cell, $backgroundRed, $backgroundGreen, $backgroundBlue)
        );
        // Slate-ish but never twice the same, so two boxes on one screen are not two copies of one
        // template that a matcher could subtract away.
        imagestring($cell, $font, 0, 0, (string)$digit, imagecolorallocate(
            $cell,
            random_int(15, 62),
            random_int(20, 50),
            random_int(35, 78)
        ));

        $scaled = imagescale($cell, CAPTCHA_GLYPH_WIDTH, CAPTCHA_GLYPH_HEIGHT);

        if ($scaled === false) {
            return null;
        }

        /*
         * Rotation fills the corners it opens up with this colour. It is the background colour, so the
         * enlarged canvas that imagerotate() hands back is indistinguishable from the one it is about
         * to be copied onto -- no seam, and no transparency to preserve through the resample.
         */
        $rotated = imagerotate($scaled, (float)random_int(-16, 16), imagecolorallocate(
            $scaled,
            $backgroundRed,
            $backgroundGreen,
            $backgroundBlue
        ));

        if ($rotated === false) {
            return null;
        }

        $rotatedWidth = imagesx($rotated);
        $rotatedHeight = imagesy($rotated);
        imagecopy(
            $canvas,
            $rotated,
            (int)round((CAPTCHA_IMAGE_WIDTH - $rotatedWidth) / 2) + random_int(-3, 3),
            (int)round((CAPTCHA_IMAGE_HEIGHT - $rotatedHeight) / 2) + random_int(-3, 3),
            0,
            0,
            $rotatedWidth,
            $rotatedHeight
        );

        // Laid over the glyph rather than under it: noise the digit sits on top of is noise that can be
        // masked off by colour. Kept to slate-400 so it reads as texture next to near-black ink and
        // never competes with the digit for the eye.
        $noise = imagecolorallocate($canvas, 148, 163, 184);
        imagesetthickness($canvas, 2);

        for ($line = 0; $line < 3; $line++) {
            imageline(
                $canvas,
                random_int(0, CAPTCHA_IMAGE_WIDTH),
                random_int(0, CAPTCHA_IMAGE_HEIGHT),
                random_int(0, CAPTCHA_IMAGE_WIDTH),
                random_int(0, CAPTCHA_IMAGE_HEIGHT),
                $noise
            );
        }

        for ($dot = 0; $dot < 220; $dot++) {
            imagesetpixel(
                $canvas,
                random_int(0, CAPTCHA_IMAGE_WIDTH - 1),
                random_int(0, CAPTCHA_IMAGE_HEIGHT - 1),
                $noise
            );
        }

        /*
         * Every challenge inlines two of these into a JSON response, so the byte count is paid on the
         * wire each time one is dealt. The picture is a dark glyph on a light ground and needs nowhere
         * near sixteen million colours; quantising first roughly halves the PNG.
         */
        imagetruecolortopalette($canvas, false, 32);

        ob_start();
        imagepng($canvas, null, 9);
        $png = (string)ob_get_clean();

        if ($png === '') {
            return null;
        }

        return 'data:image/png;base64,' . base64_encode($png);
    } catch (Throwable $exception) {
        error_log('Captcha image could not be drawn: ' . $exception->getMessage());

        return captcha_render_portable_png_digit($digit);
    }
}
