<?php
declare(strict_types=1);

/**
 * The proxies whose forwarding headers this application believes.
 *
 * Only the loopback addresses, because the only proxy in this deployment is the React dev server's
 * setupProxy.js, which runs on this machine. Put a real reverse proxy in front of Apache one day and
 * its address belongs here -- and nowhere else, so that this stays the single place that decides what
 * "trusted" means.
 *
 * This lived in audit_logs_helper.php until the HTTPS work needed it. The session cookie is
 * configured a few lines below, long before that file is loaded (it arrives with settings.php, which
 * is required further down), and request_is_https() cannot decide whether to mark the cookie Secure
 * without knowing which proxies may be believed. It moved here rather than being copied, because two
 * lists of trusted proxies is exactly one list too many.
 */
function hris_env_flag_enabled(string $name): bool
{
    $value = strtolower(trim((string)(getenv($name) ?: '')));

    return in_array($value, ['1', 'true', 'on', 'yes'], true);
}

function trusted_proxy_addresses(): array
{
    $addresses = ['127.0.0.1', '::1'];

    /*
     * Railway terminates TLS before forwarding a request to this container. Its proxy address is
     * not stable enough to hard-code, so production opts in explicitly and trusts only the direct
     * peer for that request. The public container is reached through Railway's proxy; local XAMPP
     * keeps the safer loopback-only default because this flag is absent there.
     */
    if (hris_env_flag_enabled('HRIS_TRUST_PROXY_HEADERS')) {
        $remoteAddress = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));

        if ($remoteAddress !== '' && filter_var($remoteAddress, FILTER_VALIDATE_IP) !== false) {
            $addresses[] = $remoteAddress;
        }
    }

    return array_values(array_unique($addresses));
}

/**
 * Whether this request actually reached us over TLS.
 *
 * Three ways to arrive at yes, in descending order of how directly they are known:
 *
 *   1. $_SERVER['HTTPS'] -- set by Apache itself when mod_ssl terminated the connection. This is the
 *      answer whenever Apache is the TLS endpoint, and it cannot be influenced by the client.
 *
 *   2. SERVER_PORT 443 -- the same fact from the other side, kept as a fallback because a handful of
 *      SAPI/vhost combinations leave HTTPS unset.
 *
 *   3. X-Forwarded-Proto -- and only from a trusted proxy, on the same rule client_ip_address()
 *      applies to X-Forwarded-For: a header naming the scheme is written by whoever sent the
 *      request, so straight from a browser it is worth nothing.
 *
 * The third case is not hypothetical here. The reset-link builder in password-reset-utils.php has a
 * devtunnels.ms address in it, and a tunnel terminates TLS at its own edge and forwards plain HTTP to
 * Apache: HTTPS is unset and SERVER_PORT is 80 even though the user is unambiguously on https://.
 * Without this branch every such request would be judged insecure, the session cookie would go out
 * without Secure, and -- once enforcement is on -- enforce_https() would redirect to a URL that
 * resolves straight back to itself.
 */
function request_is_https(): bool
{
    $https = strtolower(trim((string)($_SERVER['HTTPS'] ?? '')));

    if ($https !== '' && $https !== 'off') {
        return true;
    }

    if ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }

    $remoteAddress = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));

    if ($remoteAddress === '' || !in_array($remoteAddress, trusted_proxy_addresses(), true)) {
        return false;
    }

    /*
     * A chain of proxies appends to this header the way it appends to X-Forwarded-For, so the entry
     * that describes the hop the *client* made is the first one. Unlike X-Forwarded-For, that is the
     * entry worth reading: what matters is whether the user's own leg of the journey was encrypted,
     * not whether the trusted proxy behind it spoke plaintext to Apache -- which it always does.
     */
    $forwardedProto = (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '');

    if ($forwardedProto !== '') {
        $first = strtolower(trim((string)(explode(',', $forwardedProto)[0] ?? '')));

        if ($first !== '') {
            return $first === 'https';
        }
    }

    // Some tunnels and load balancers send this instead of, or as well as, X-Forwarded-Proto.
    $forwardedSsl = strtolower(trim((string)($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '')));

    return $forwardedSsl === 'on';
}

/**
 * The scheme this request came in on, for anywhere that has to build an absolute URL back to us.
 */
function request_scheme(): string
{
    return request_is_https() ? 'https' : 'http';
}

/**
 * Whether plaintext HTTP should be turned away rather than merely tolerated.
 *
 * Off unless HRIS_FORCE_HTTPS says otherwise, and deliberately so. This application's normal home is
 * XAMPP on http://localhost, which is how it is developed and how the capstone is demonstrated;
 * defaulting this to on would mean a checkout that redirects every request to an https:// port
 * nothing is listening on, which looks exactly like the server being down.
 *
 * The Secure cookie flag below is *not* gated on this, because it needs no decision: it is set from
 * what the connection actually is, so it protects an HTTPS deployment without touching an HTTP one.
 * This switch is only for the two things that would break a plaintext dev box -- the redirect and
 * HSTS -- and it is what turns the pair on together when there is a certificate to turn them on for.
 */
function https_is_enforced(): bool
{
    $flag = strtolower(trim((string)(getenv('HRIS_FORCE_HTTPS') ?: '')));

    return in_array($flag, ['1', 'true', 'on', 'yes'], true);
}

/**
 * How long a browser should refuse to speak plaintext to this host, in seconds. Zero disables HSTS
 * while leaving the redirect in place, which is the right setting while a certificate is still being
 * sorted out -- a redirect is undone by fixing the server, an HSTS header is not.
 */
function hsts_max_age(): int
{
    $raw = getenv('HRIS_HSTS_MAX_AGE');

    if ($raw === false || trim((string)$raw) === '') {
        return 31536000; // One year, the value the preload list expects.
    }

    return max(0, (int)$raw);
}

/**
 * Send plaintext callers to the encrypted address, and tell browsers not to come back plaintext.
 *
 * Ordered so that the redirect happens before the session cookie is issued: a Set-Cookie on a 308 is
 * a session identifier that has already travelled in the clear, and the whole point of the exercise
 * is that it never does.
 *
 * 308 rather than 301. A 301 is defined to let the client retry a POST as a GET, which turns a
 * mistyped http:// on a payroll submission into a silently discarded request; 308 preserves the
 * method and the body. It is worth being clear-eyed about what that costs: the body has *already*
 * crossed the network unencrypted by the time PHP sees it, so this redirect salvages the request, not
 * the secret in it. The header below is the part that actually fixes the problem, by making the
 * browser refuse to send the plaintext request a second time.
 *
 * HSTS is withheld from loopback hostnames on purpose. XAMPP serves every project in htdocs from the
 * same origin, so a max-age on `localhost` is not scoped to this application -- it would force every
 * other site on the developer's machine to https for a year, and the only way back is a manual purge
 * in chrome://net-internals/#hsts. A real hostname does not have that problem because it is not
 * shared.
 */
function enforce_https(): void
{
    if (!https_is_enforced()) {
        return;
    }

    $host = (string)($_SERVER['HTTP_HOST'] ?? '');
    $hostName = strtolower(trim((string)(parse_url('http://' . $host, PHP_URL_HOST) ?: '')));
    $isLoopbackHost = in_array($hostName, ['localhost', '127.0.0.1', '::1', '[::1]'], true);

    if (!request_is_https()) {
        if ($host === '') {
            return;
        }

        $target = 'https://' . $host . (string)($_SERVER['REQUEST_URI'] ?? '/');

        header('Location: ' . $target, true, 308);
        header('Content-Type: text/plain; charset=utf-8');
        exit('This service requires HTTPS.');
    }

    $maxAge = hsts_max_age();

    if ($maxAge > 0 && !$isLoopbackHost) {
        header('Strict-Transport-Security: max-age=' . $maxAge . '; includeSubDomains');
    }
}

function configure_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedOrigins = [];
    $configuredOrigins = (string)(getenv('HRIS_ALLOWED_ORIGINS') ?: '');

    foreach (preg_split('/\s*,\s*/', $configuredOrigins, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $candidate) {
        $candidate = rtrim(trim((string)$candidate), '/');
        $scheme = strtolower((string)(parse_url($candidate, PHP_URL_SCHEME) ?: ''));
        $host = (string)(parse_url($candidate, PHP_URL_HOST) ?: '');

        if (in_array($scheme, ['http', 'https'], true) && $host !== '') {
            $allowedOrigins[] = $candidate;
        }
    }

    $isLocalOrigin = $origin !== ''
        && preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin) === 1;
    $isConfiguredOrigin = $origin !== ''
        && in_array(rtrim($origin, '/'), array_unique($allowedOrigins), true);

    if ($isLocalOrigin || $isConfiguredOrigin) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Vary: Origin');
    }

    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CSRF-Token, X-Client-Platform, X-Client-Platform-Version');
    header('Access-Control-Expose-Headers: Content-Disposition');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Accept-CH: Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version');
    header('Content-Type: application/json; charset=utf-8');
}

configure_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/*
 * After the preflight short-circuit above, and before the session below.
 *
 * After, because a browser does not follow a redirect on a preflight -- it treats one as a failed
 * CORS check. Redirecting OPTIONS would replace a legible "this service requires HTTPS" with a
 * generic CORS error in the console, which hides the actual problem. A preflight carries no cookie
 * and no body, so letting one complete over plaintext gives nothing away.
 *
 * Before, because the next thing this file does is hand out a session cookie.
 */
enforce_https();

session_name('HRISSESSID');

if (session_status() === PHP_SESSION_NONE) {
    /*
     * `secure` follows the connection rather than a setting. Hard-coding it true would be correct in
     * production and catastrophic on the XAMPP box this is developed on -- a browser withholds a
     * Secure cookie from a plaintext origin entirely, so every request would arrive without a
     * session and sign-in would appear to succeed and then immediately fail. Reading it from
     * request_is_https() means the flag is set exactly when it can be honoured, with no configuration
     * to get wrong and no way for the two to disagree.
     *
     * SameSite defaults to Lax because the React app normally reaches this API through a same-origin
     * proxy. HRIS_SESSION_SAMESITE may opt a deployment into None when it intentionally serves the
     * API from another site; such a deployment must also be HTTPS so browsers accept the cookie.
     */
    $configuredSameSite = ucfirst(strtolower(trim((string)(getenv('HRIS_SESSION_SAMESITE') ?: 'Lax'))));
    $sameSite = in_array($configuredSameSite, ['Lax', 'Strict', 'None'], true)
        ? $configuredSameSite
        : 'Lax';

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => request_is_https(),
        'httponly' => true,
        'samesite' => $sameSite,
    ]);
    session_start();
}

/*
 * server-config.local.php is for hosts that cannot set environment variables -- InfinityFree and
 * shared hosting generally. It may define HRIS_DB_HOST/NAME/USER/PASSWORD, GOOGLE_CLIENT_ID and
 * HRIS_LOGIN_URL as constants; server-config.example.php shows the shape. It is gitignored
 * (*.local.php) and absent on XAMPP and Docker, which therefore read exactly what they read before.
 * Loaded ahead of google-config.php so a GOOGLE_CLIENT_ID defined here is the one that wins.
 */
$hrisServerConfig = __DIR__ . '/server-config.local.php';

if (is_file($hrisServerConfig)) {
    require_once $hrisServerConfig;
}

unset($hrisServerConfig);

/*
 * smtp-config.php holds a live Gmail app password and is gitignored, so it is absent
 * on a fresh clone. Every SMTP_* constant is read through a defined() check where it
 * is used, which means a missing file costs outgoing mail and nothing else -- whereas
 * a bare require_once here would take down every endpoint in the API, since they all
 * come through this file.
 */
$hrisSmtpConfig = __DIR__ . '/smtp-config.php';

if (is_file($hrisSmtpConfig)) {
    require_once $hrisSmtpConfig;
}

unset($hrisSmtpConfig);

/*
 * Container hosts inject SMTP settings as environment variables instead of shipping a credential
 * file in the image. A local smtp-config.php keeps precedence so existing XAMPP installations are
 * unchanged; every missing value can be supplied independently by Railway.
 */
$hrisSmtpEnvironment = [
    'SMTP_HOST' => getenv('SMTP_HOST'),
    'SMTP_PORT' => getenv('SMTP_PORT'),
    'SMTP_USERNAME' => getenv('SMTP_USERNAME'),
    'SMTP_PASSWORD' => getenv('SMTP_PASSWORD'),
    'SMTP_FROM_EMAIL' => getenv('SMTP_FROM_EMAIL'),
    'SMTP_FROM_NAME' => getenv('SMTP_FROM_NAME'),
    'SMTP_ENCRYPTION' => getenv('SMTP_ENCRYPTION'),
    'EMAIL_SUBJECT' => getenv('EMAIL_SUBJECT'),
    'CODE_EXPIRY_MINUTES' => getenv('CODE_EXPIRY_MINUTES'),
];

foreach ($hrisSmtpEnvironment as $constantName => $value) {
    if (!defined($constantName) && $value !== false && trim((string)$value) !== '') {
        define($constantName, $constantName === 'SMTP_PORT' || $constantName === 'CODE_EXPIRY_MINUTES'
            ? (int)$value
            : (string)$value);
    }
}

unset($hrisSmtpEnvironment, $constantName, $value);

/*
 * google-config.php resolves the OAuth client id behind "Sign in with Google", and is included
 * the same way for the same reason: its two readers (google_login.php and the public slice of
 * settings.php) both go through defined('GOOGLE_CLIENT_ID'), so a checkout without the file has
 * no Google button and loses nothing else.
 */
$hrisGoogleConfig = __DIR__ . '/google-config.php';

if (is_file($hrisGoogleConfig)) {
    require_once $hrisGoogleConfig;
}

unset($hrisGoogleConfig);

/*
 * The office runs on Philippine time and so does MySQL, whose SYSTEM zone follows the host clock,
 * but PHP was still on the XAMPP default of Europe/Berlin. Everything the API stamped with date()
 * therefore sat six hours behind everything MySQL stamped with NOW(): account lockouts written by
 * login.php quoted a wall-clock time nobody here recognised, and the NOW() comparison that lists
 * locked accounts in settings.php read every one of those locks as long expired. Both clocks are
 * pinned here, in the one file every endpoint requires, instead of being left to php.ini and to the
 * database host's OS. Manila has no DST, so the fixed offset is exact all year -- and it has to be
 * an offset rather than the zone name, because MySQL cannot resolve named zones unless its optional
 * time-zone tables have been loaded.
 */
const HRIS_TIMEZONE = 'Asia/Manila';
const HRIS_TIMEZONE_OFFSET = '+08:00';

date_default_timezone_set(HRIS_TIMEZONE);

/*
 * Whether an account may sign in. This used to be a `status` lookup table joined in through
 * `users.status_id` -- two rows, Active and Inactive, that never grew and that every user query in
 * the project had to join to read one word. It is now `users.status`, an ENUM of those same two
 * values, so the word travels with the row.
 *
 * Comparisons stay case-insensitive (LOWER(u.status) = "active") because that is how the old
 * s.name comparisons were written and how rows imported before the change may read.
 */
const HRIS_USER_STATUS_ACTIVE = 'Active';
const HRIS_USER_STATUS_INACTIVE = 'Inactive';

/** Anything that is not recognisably Inactive is Active — the same default the lookup table had. */
function normalize_user_status(mixed $value): string
{
    return strtolower(trim((string)$value)) === 'inactive'
        ? HRIS_USER_STATUS_INACTIVE
        : HRIS_USER_STATUS_ACTIVE;
}

/*
 * XAMPP's defaults, which is what a checkout on a developer machine gets and what
 * every one of these literals still means on its own. The environment overrides
 * exist for the Docker stack in docker-compose.yml, where MariaDB is a separate
 * container answering to the hostname `db` and root has a password -- Apache
 * inherits the container's environment, so getenv() sees them there and sees
 * nothing here.
 *
 * getenv() returns false when a name is unset, which is why the password is
 * handled separately: `?:` would also discard a deliberately empty one, and an
 * empty password is the normal case rather than a mistake.
 *
 * Between the two sits server-config.local.php (loaded above): a host without
 * environment variables defines the same names as constants. With no such file
 * hris_configured_value() just returns the XAMPP literal it was handed.
 */
function hris_configured_value(string $name, string $default): string
{
    return defined($name) ? (string)constant($name) : $default;
}

$servername = getenv('HRIS_DB_HOST') ?: hris_configured_value('HRIS_DB_HOST', '127.0.0.1');
$dbusername = getenv('HRIS_DB_USER') ?: hris_configured_value('HRIS_DB_USER', 'root');
$dbpassword = getenv('HRIS_DB_PASSWORD');
$dbpassword = $dbpassword === false ? hris_configured_value('HRIS_DB_PASSWORD', '') : $dbpassword;
$dbname = getenv('HRIS_DB_NAME') ?: hris_configured_value('HRIS_DB_NAME', 'hris');
$dbport = trim((string)(getenv('HRIS_DB_PORT') ?: hris_configured_value('HRIS_DB_PORT', '')));

if ($dbport !== '' && (!ctype_digit($dbport) || (int)$dbport < 1 || (int)$dbport > 65535)) {
    $dbport = '';
}

$pdoOptions = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
];

$databaseServerDsn = "mysql:host={$servername}" . ($dbport !== '' ? ";port={$dbport}" : '');

if (hris_env_flag_enabled('HRIS_DB_SSL')) {
    $sslCa = trim((string)(getenv('HRIS_DB_SSL_CA') ?: '/etc/ssl/certs/ca-certificates.crt'));

    if ($sslCa !== '') {
        $pdoOptions[PDO::MYSQL_ATTR_SSL_CA] = $sslCa;
        $pdoOptions[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
    }
}

$dsn = "{$databaseServerDsn};dbname={$dbname};charset=utf8mb4";

/*
 * The database is named in the DSN, so an ordinary request opens its connection and does nothing
 * else. It used to be created on the spot instead -- CREATE DATABASE IF NOT EXISTS, then USE, on
 * every single request.
 *
 * Both of those are DDL, and DDL needs the schema metadata lock. Anything else already holding that
 * lock therefore stalled not one endpoint but all of them: importing database/hris.sql holds it for
 * the length of the import, and while one was wedged, every request in the project piled up behind
 * CREATE DATABASE until all 150 of Apache's worker threads were consumed. Apache then stopped
 * accepting connections altogether and the dev server's proxy reported ECONNREFUSED for the whole
 * site -- a stuck import in one table taking down every page.
 *
 * A fresh checkout still gets its database made for it, but only on the one request that finds it
 * missing, which is the case the convenience was for.
 */
try {
    try {
        $pdo = new PDO($dsn, $dbusername, $dbpassword, $pdoOptions);
    } catch (PDOException $exception) {
        /*
         * 1049 is "Unknown database": nobody has set this checkout up yet. Every other failure --
         * the server being down, credentials being wrong -- is real and must not be answered by
         * quietly creating an empty database, so it rethrows to the handler below.
         *
         * errorInfo is not always populated on a failed connect, hence the second test.
         */
        $unknownDatabase = (int)($exception->errorInfo[1] ?? 0) === 1049
            || str_contains($exception->getMessage(), '[1049]');

        if (!$unknownDatabase) {
            throw $exception;
        }

        $bootstrap = new PDO("{$databaseServerDsn};charset=utf8mb4", $dbusername, $dbpassword, $pdoOptions);
        $bootstrap->exec(
            "CREATE DATABASE IF NOT EXISTS `{$dbname}`
             CHARACTER SET utf8mb4
             COLLATE utf8mb4_unicode_ci"
        );
        $bootstrap = null;

        $pdo = new PDO($dsn, $dbusername, $dbpassword, $pdoOptions);
    }

    $pdo->exec("SET time_zone = '" . HRIS_TIMEZONE_OFFSET . "'");
    $conn = $pdo;
} catch (PDOException $exception) {
    error_log('Database connection failed: ' . $exception->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Database connection failed.',
    ]);
    exit;
}

/*
 * The application-settings library -- the settings store, the permission engine, the security and
 * two-factor settings. It shares a file with the Settings endpoint, which is why this require sits
 * here rather than at the top: settings.php requires this file straight back, and by this line the
 * connection and the session it needs already exist. Its endpoint half checks whether settings.php
 * was the requested script and does nothing when it was not, so including it costs only the parse.
 */
require_once __DIR__ . '/settings.php';

/*
 * Request rate limiting. Required here rather than by each endpoint because its `api` group applies
 * to all of them; the guard itself runs at the foot of this file, once the session and the settings
 * store it reads are both available.
 *
 * throttle.php is the policy layer over that engine -- which throttle applies where, and who a
 * request counts as. auth.php carries the permission and role guards.
 */
require_once __DIR__ . '/rate-limit.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/throttle.php';

/*
 * Work that follows from a request but that the caller has no reason to wait for — sending a
 * notification e-mail, most of all. Signing in used to hold the browser open for the whole SMTP
 * conversation with Gmail: connect, STARTTLS, authenticate, send, quit, seconds of it, after the
 * password had already been accepted and the session already existed. Nothing in the response
 * depended on any of that.
 *
 * Anything queued here runs after the response has been handed to the client, so the cost stops
 * being something the user sits through. A deferred task cannot change the response — it has
 * already been sent — and it cannot touch $_SESSION, which is closed by then; queue only work
 * whose failure the caller does not need to report.
 */
function deferred_task_queue(?callable $task = null, bool $drain = false): array
{
    static $tasks = [];

    if ($task !== null) {
        $tasks[] = $task;

        return [];
    }

    if (!$drain) {
        return $tasks;
    }

    $queued = $tasks;
    $tasks = [];

    return $queued;
}

function defer(callable $task): void
{
    deferred_task_queue($task);
}

function run_deferred_tasks(): void
{
    foreach (deferred_task_queue(null, true) as $task) {
        try {
            $task();
        } catch (Throwable $exception) {
            error_log('Deferred task failed: ' . $exception->getMessage());
        }
    }
}

// A script that exits without json_response() still owes its deferred work. Draining empties the
// queue, so the normal path having already run it makes this a no-op.
register_shutdown_function('run_deferred_tasks');

/**
 * Releases the finished response to the client, then runs whatever was deferred.
 *
 * $contentLength is the body just echoed. The browser only treats a response as complete once it
 * has counted that many bytes, so declaring it is what ends the request for the user while this
 * process keeps working — mod_php, unlike php-fpm, has no fastcgi_finish_request() to call.
 */
function finish_request(?int $contentLength = null): void
{
    $deferred = deferred_task_queue() !== [];

    // Shared hosts may list it in disable_functions, and PHP 8 fatals on a disabled function.
    if (function_exists('ignore_user_abort')) {
        ignore_user_abort(true);
    }

    /*
     * The session lock matters as much as the flush here. PHP holds the session file for the whole
     * script, and every other request from the same browser queues behind it — so a login that sat
     * on an SMTP socket also stalled the dashboard calls firing right after it.
     */
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        if (!headers_sent()) {
            // The buffer is the better source when there is one: it counts any stray output that
            // was echoed ahead of the body. Without buffering, nothing could precede it unbuffered
            // without sending the headers, which is the branch we are already inside.
            $buffered = ob_get_level() > 0 ? ob_get_length() : false;
            $length = $buffered === false ? $contentLength : $buffered;

            if ($length !== null) {
                header('Content-Length: ' . $length);

                /*
                 * Only worth closing when something is still to run: Apache cannot serve another
                 * request over a kept-alive connection while this handler is busy, so a request
                 * with deferred work would block the next one on that socket. With nothing queued
                 * the handler returns immediately and keep-alive is the cheaper choice.
                 */
                if ($deferred) {
                    header('Connection: close');
                }
            }
        }

        while (ob_get_level() > 0) {
            ob_end_flush();
        }

        flush();
    }

    run_deferred_tasks();
}

/** @return never */
function json_response(array $payload, int $status = 200): void
{
    global $pdo;

    /*
     * A single malformed byte anywhere in the payload — a name imported from a latin1 source, say —
     * used to make json_encode() return false, and `echo false` sends an empty body with a 200
     * status. The client then sees a successful request whose `success` flag is missing and reports
     * a generic failure with nothing to debug. Substituting invalid UTF-8 keeps the response usable;
     * anything else that fails to encode becomes a real 500 that says so.
     */
    $json = json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE);

    if ($json === false) {
        error_log('json_response() could not encode the payload: ' . json_last_error_msg());
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'The server could not encode its response.',
        ]);
        exit;
    }

    /*
     * Detailed module logs are still preferred, but a state-changing endpoint must not disappear
     * from the administrator's trail just because that endpoint forgot to write one. Queueing the
     * fallback here gives every successful authenticated mutation the same safety net and lets the
     * response reach the browser before the optional location lookup and INSERT run.
     */
    if ($pdo instanceof PDO) {
        queue_automatic_activity_audit($pdo, $payload, $status);
    }

    http_response_code($status);
    echo $json;
    finish_request(strlen($json));
    exit;
}

function read_json_body(): array
{
    if (array_key_exists('hris_json_request_body', $GLOBALS)) {
        return is_array($GLOBALS['hris_json_request_body']) ? $GLOBALS['hris_json_request_body'] : [];
    }

    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        $GLOBALS['hris_json_request_body'] = [];
        return [];
    }

    $data = json_decode($rawBody, true);

    $GLOBALS['hris_json_request_body'] = is_array($data) ? $data : [];

    return $GLOBALS['hris_json_request_body'];
}

function contains_disallowed_request_text(string $value): bool
{
    return preg_match(
        '~<[^>]*>'
        . '|(?:<|&lt;|&#0*60;|&#x0*3c;)\s*/?\s*(?:script|iframe|object|embed|svg|math|style|link|meta)\b'
        . '|<[^>]*\bon[a-z]+\s*='
        . '|\b(?:javascript|vbscript)\s*:~iu',
        $value
    ) === 1;
}

function collect_disallowed_request_fields(mixed $value, string $fieldName = 'input'): array
{
    if (is_string($value)) {
        if (stripos($fieldName, 'password') !== false || !contains_disallowed_request_text($value)) {
            return [];
        }

        return [$fieldName => 'This text cannot be used.'];
    }

    if (!is_array($value)) {
        return [];
    }

    $errors = [];

    foreach ($value as $key => $item) {
        $nextFieldName = is_string($key) && $key !== '' ? $key : $fieldName;

        if (stripos($nextFieldName, 'password') !== false) {
            continue;
        }

        foreach (collect_disallowed_request_fields($item, $nextFieldName) as $errorField => $message) {
            $errors[$errorField] = $message;
        }
    }

    return $errors;
}

function validate_request_text_input(): void
{
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }

    $payload = $_POST !== [] ? $_POST : read_json_body();
    $errors = collect_disallowed_request_fields($payload);

    if ($errors === []) {
        return;
    }

    json_response([
        'success' => false,
        'reason' => 'unsafe_input',
        'message' => 'This text cannot be used.',
        'errors' => $errors,
    ], 422);
}

function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== strtoupper($method)) {
        json_response([
            'success' => false,
            'message' => 'Method not allowed.',
        ], 405);
    }
}

function csrf_token(): string
{
    if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token']) || $_SESSION['csrf_token'] === '') {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function verify_csrf_token(): void
{
    global $pdo;

    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        csrf_token();
        return;
    }

    /*
     * Sign-in and its anonymous captcha check explicitly opt out. They do not act with an
     * authenticated user's authority, and requiring an anonymous-session token here can strand the
     * login form after that session changes. Authenticated writes never define this constant and
     * continue through the token comparison below.
     */
    if (defined('HRIS_CSRF_EXEMPT') && constant('HRIS_CSRF_EXEMPT') === true) {
        return;
    }

    /*
     * Every remaining write is checked. There used to be another exemption here for a request that
     * authenticated with a bearer token rather than a cookie -- forgery rides on the cookie the
     * browser attaches by itself, and cannot set an Authorization header -- but bearer authentication
     * has been removed, so authenticated callers all have ambient cookie authority to protect.
     */
    $providedToken = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    $sessionToken = csrf_token();

    if ($providedToken === '' || !hash_equals($sessionToken, $providedToken)) {
        json_response([
            'success' => false,
            'message' => 'Security token expired. Refresh the page and try again.',
        ], 419);
    }
}

verify_csrf_token();
validate_request_text_input();

/*
 * The general request ceiling, counted before any endpoint gets to run. It sits after the CSRF check
 * so that a flood of tokenless requests is turned away by the cheaper test first, and it reads
 * $_SESSION directly rather than calling session_user() because a request that is over the limit is
 * refused whether or not the session behind it is still valid.
 */
throttle_request($pdo);

function session_user(): ?array
{
    if (!isset($_SESSION['user']) || !is_array($_SESSION['user'])) {
        return null;
    }

    return $_SESSION['user'];
}

function destroy_session(): void
{
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'] ?? '/',
            $params['domain'] ?? '',
            (bool)($params['secure'] ?? false),
            (bool)($params['httponly'] ?? true)
        );
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
}

function trimmed_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function full_name_from_row(array $row): string
{
    $firstName = trimmed_text($row['first_name'] ?? '');
    $middleName = trimmed_text($row['middle_name'] ?? '');
    $lastName = trimmed_text($row['last_name'] ?? '');
    $fullName = trim(implode(' ', array_filter([$firstName, $middleName, $lastName])));

    if ($fullName !== '') {
        return $fullName;
    }

    return trimmed_text($row['full_name'] ?? '');
}

function find_employee_for_user(PDO $pdo, array $user): ?array
{
    ensure_employee_designation_column($pdo);

    $username = trimmed_text($user['username'] ?? '');
    $email = trimmed_text($user['email'] ?? '');
    $employeeId = trimmed_text($user['employee_id'] ?? '');
    $fullName = full_name_from_row($user);

    $candidates = [];
    $addCandidate = static function (string $type, string $value) use (&$candidates): void {
        $value = trim($value);
        if ($value === '') {
            return;
        }

        $key = $type . '|' . strtolower($value);
        if (isset($candidates[$key])) {
            return;
        }

        $candidates[$key] = [
            'type' => $type,
            'value' => $value,
        ];
    };

    $addCandidate('email', $email);
    if ($username !== '' && filter_var($username, FILTER_VALIDATE_EMAIL) !== false) {
        $addCandidate('email', $username);
    }

    $addCandidate('employee_id', $employeeId);
    $addCandidate('employee_id', $username);
    $addCandidate('full_name', $fullName);
    $addCandidate('full_name', $username);

    foreach ($candidates as $candidate) {
        $field = $candidate['type'];
        $value = $candidate['value'];

        $statement = match ($field) {
            'email' => $pdo->prepare(
                'SELECT
                    e.id AS linked_employee_record_id,
                    e.employee_id,
                    e.first_name,
                    e.middle_name,
                    e.last_name,
                    e.gender,
                    e.profile_image,
                    d.name AS division,
                    des.name AS position,
                    e.designation
                 FROM employees e
                 LEFT JOIN divisions d ON d.id = e.division_id
                 LEFT JOIN designations des ON des.id = e.designation_id
                 WHERE e.email COLLATE utf8mb4_unicode_ci = :value
                   AND e.is_archived = 0
                 LIMIT 1'
            ),
            'employee_id' => $pdo->prepare(
                'SELECT
                    e.id AS linked_employee_record_id,
                    e.employee_id,
                    e.first_name,
                    e.middle_name,
                    e.last_name,
                    e.gender,
                    e.profile_image,
                    d.name AS division,
                    des.name AS position,
                    e.designation
                 FROM employees e
                 LEFT JOIN divisions d ON d.id = e.division_id
                 LEFT JOIN designations des ON des.id = e.designation_id
                 WHERE e.employee_id COLLATE utf8mb4_unicode_ci = :value
                   AND e.is_archived = 0
                 LIMIT 1'
            ),
            default => $pdo->prepare(
                'SELECT
                    e.id AS linked_employee_record_id,
                    e.employee_id,
                    e.first_name,
                    e.middle_name,
                    e.last_name,
                    e.gender,
                    e.profile_image,
                    d.name AS division,
                    des.name AS position,
                    e.designation
                 FROM employees e
                 LEFT JOIN divisions d ON d.id = e.division_id
                 LEFT JOIN designations des ON des.id = e.designation_id
                 WHERE TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) COLLATE utf8mb4_unicode_ci = :value
                   AND e.is_archived = 0
                 LIMIT 1'
            ),
        };

        $statement->execute([':value' => $value]);
        $employee = $statement->fetch();

        if ($employee) {
            return $employee;
        }
    }

    return null;
}

function enrich_user_with_employee(PDO $pdo, array $user): array
{
    $employee = find_employee_for_user($pdo, $user);

    if ($employee === null) {
        return $user;
    }

    return array_merge($user, [
        'linked_employee_record_id' => (int)($employee['linked_employee_record_id'] ?? 0),
        'employee_id' => $employee['employee_id'] ?? ($user['employee_id'] ?? null),
        'first_name' => $employee['first_name'] ?? ($user['first_name'] ?? null),
        'middle_name' => $employee['middle_name'] ?? ($user['middle_name'] ?? null),
        'last_name' => $employee['last_name'] ?? ($user['last_name'] ?? null),
        'gender' => $employee['gender'] ?? ($user['gender'] ?? null),
        'profile_image' => $employee['profile_image'] ?? ($user['profile_image'] ?? null),
        'division' => $employee['division'] ?? ($user['division'] ?? null),
        'position' => $employee['position'] ?? ($user['position'] ?? null),
        'designation' => $employee['designation'] ?? ($user['designation'] ?? null),
    ]);
}

function session_user_record(PDO $pdo, int $id): ?array
{
    ensure_two_factor_schema($pdo);
    ensure_email_verification_columns($pdo);
    ensure_employee_designation_column($pdo);

    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.email_verified_at,
            u.email_updated_at,
            u.must_change_password,
            u.two_factor_enabled,
            r.name AS role,
            u.status,
            e.employee_id,
            e.first_name,
            e.middle_name,
            e.last_name,
            e.gender,
            e.profile_image,
            d.name AS division,
            des.name AS position,
            e.designation
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.id = :id
           AND u.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $user = $statement->fetch();

    if (!$user) {
        return null;
    }

    return enrich_user_with_employee($pdo, $user);
}

function refresh_session_user(array $user): ?array
{
    global $pdo;

    $userId = (int)($user['id'] ?? 0);
    if ($userId <= 0 || !($pdo instanceof PDO)) {
        return $user;
    }

    $freshUser = session_user_record($pdo, $userId);
    if ($freshUser === null) {
        return null;
    }

    return format_user($freshUser);
}

/*
 * The `user_presence` table and the three functions that maintained it used to live here. They
 * existed for one thing: the green dot beside an avatar in Communications. Every authenticated
 * request stamped the caller's row, a stamp inside a 90-second window read as online, and logout
 * deleted it.
 *
 * The table is gone and so is the dot. Note that it was created on demand by a
 * CREATE TABLE IF NOT EXISTS on every chat load, so dropping the table alone would have brought it
 * straight back — the code had to go with it.
 */

/**
 * `$extendSession` exists for endpoints the client polls on a timer. Those requests are the browser
 * talking, not the user, so counting them as activity would keep every session alive indefinitely.
 * The expiry check itself always runs — an idle session still expires and still 401s.
 *
 * Session extension is opt-in. Notification, chat, badge, and data-refresh pollers call most of the
 * same endpoints as visible user actions, so counting every authenticated request as activity would
 * keep an unattended dashboard signed in indefinitely. App.jsx sends a deliberate heartbeat to
 * session.php after real browser activity, and that endpoint opts in to extension.
 *
 * `$keepSessionOpen` is for the handful of endpoints that write to $_SESSION themselves; see the
 * note over the session_write_close() below for why every other endpoint wants the default.
 *
 * `$allowAnonymous` is reserved for session.php's identity probe. It performs the same expiry,
 * database, and account-status checks but returns null instead of emitting a 401, allowing that one
 * endpoint to describe both authenticated and anonymous states with a stable JSON response.
 */
function require_session_user(
    bool $extendSession = false,
    bool $keepSessionOpen = false,
    bool $allowAnonymous = false
): ?array
{
    global $pdo;

    $user = session_user();

    /*
     * A session or nothing. There used to be a bearer-token fallback here for callers that are not a
     * browser; it was removed along with the rest of that path, so the session cookie is the only way
     * in and an Authorization header means nothing to this API any more.
     */
    if ($user === null) {
        if ($allowAnonymous) {
            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }

            return null;
        }

        json_response([
            'success' => false,
            'message' => 'You need to sign in first.',
        ], 401);
    }

    $timeoutMinutes = security_settings($pdo)['sessionTimeoutMinutes'] ?? 30;
    $timeoutSeconds = max(1, (int)$timeoutMinutes) * 60;
    $lastActivityAt = (int)($_SESSION['last_activity_at'] ?? 0);

    if ($lastActivityAt > 0 && (time() - $lastActivityAt) > $timeoutSeconds) {
        destroy_session();

        if ($allowAnonymous) {
            return null;
        }

        json_response([
            'success' => false,
            'reason' => 'session_timeout',
            'message' => 'Your session expired due to inactivity. Please sign in again.',
        ], 401);
    }

    if ($extendSession) {
        $_SESSION['last_activity_at'] = time();
    }

    $refreshedUser = refresh_session_user($user);

    if ($refreshedUser === null) {
        destroy_session();

        if ($allowAnonymous) {
            return null;
        }

        json_response([
            'success' => false,
            'message' => 'Your session is no longer valid. Please sign in again.',
        ], 401);
    }

    /*
     * An account switched to Inactive loses the session it is already holding, not just the next one
     * it tries to open.
     *
     * login.php turns an inactive account away at the door, but that only ever ran at sign-in: an
     * employee sitting on a dashboard when an administrator deactivated them kept working until they
     * signed out on their own. The status is re-read from the database by refresh_session_user()
     * above on every single request, so checking it here ends that session on the very next call the
     * browser makes -- which is at most seconds, given how much the dashboards poll.
     *
     * `reason` is what lets the client tell this apart from an ordinary idle timeout and name the
     * cause. Destroying the session first means the requests still in flight behind this one fall
     * through to the plain "sign in first" 401 instead of each announcing the same thing.
     */
    if (strcasecmp((string)($refreshedUser['status'] ?? ''), 'Active') !== 0) {
        destroy_session();

        if ($allowAnonymous) {
            return null;
        }

        json_response([
            'success' => false,
            'reason' => 'account_inactive',
            'message' => 'Your account has been set to inactive. Please contact your administrator.',
        ], 401);
    }

    $_SESSION['user'] = $refreshedUser;
    audit_monitor_authenticated_user($refreshedUser);

    /*
     * Every write this request owed the session has now happened, so the lock on it can go.
     *
     * PHP's file session handler holds that lock for the whole script, and it is per browser, not
     * per request — so a page firing eight requests at once had them run one after another, each
     * waiting out the one before it. The dashboards do exactly that. Releasing here is what lets
     * them genuinely overlap; measured on this machine, four concurrent requests went from 6s to
     * 1.5s, and the dashboards issue twice that many.
     *
     * $_SESSION stays readable afterwards — only further writes would be silently dropped, which is
     * why the endpoints that still write to it pass keepSessionOpen: true.
     */
    if (!$keepSessionOpen) {
        session_write_close();
    }

    return $refreshedUser;
}

function normalize_token(mixed $value): string
{
    return preg_replace('/[^a-z]/', '', strtolower((string)($value ?? '')));
}

function normalize_role(mixed $value): string
{
    $token = normalize_token($value);

    return match ($token) {
        'admin', 'administrator', 'superadmin' => 'admin',
        'regionaldirector', 'regionaldir' => 'regionaldirector',
        'hrhead' => 'hrhead',
        'hrstaff' => 'hrstaff',
        'chief' => 'chief',
        'planningofficer', 'planning' => 'planningofficer',
        'cashier' => 'cashier',
        'employee' => 'employee',
        default => $token,
    };
}

/**
 * The role a user actually *is*, custom names included. Use this only where the identity
 * of the role matters — looking its permission template up, for instance. For deciding
 * whether a request is allowed, use user_role_key() instead.
 */
function user_exact_role_key(array $user): string
{
    return normalize_role($user['roleKey'] ?? $user['role'] ?? '');
}

/**
 * The role key an access check should test against.
 *
 * A custom role owns no gates of its own: it is admitted wherever the built-in role it was
 * based on is admitted, and the module checklist saved with it is what narrows it from
 * there. Returning the raw custom key here matched none of the role lists the endpoints
 * keep -- ['admin', 'hrhead', 'hrstaff'] and friends -- so every endpoint refused a custom
 * role outright, whatever its checklist granted. Checking a module in Settings > Roles
 * therefore appeared to do nothing at all.
 *
 * `baseRoleKey` is already on every session user (see format_user); the database lookup is
 * only for callers holding a plain user row.
 */
function user_role_key(array $user): string
{
    global $pdo;

    $roleKey = user_exact_role_key($user);
    $baseRoleKey = normalize_role($user['baseRoleKey'] ?? '');

    if ($baseRoleKey !== '') {
        return $baseRoleKey;
    }

    if ($roleKey !== '' && $pdo instanceof PDO && function_exists('role_base_key')) {
        try {
            return role_base_key($pdo, $roleKey) ?: $roleKey;
        } catch (Throwable $exception) {
            error_log('Unable to resolve base role for access check: ' . $exception->getMessage());
        }
    }

    return $roleKey;
}

/**
 * SQL for the role name of the user account linked to an employee row, for a SELECT list.
 *
 * A correlated subquery rather than a JOIN so a row is never duplicated when more than one
 * account shares the employee's e-mail; the lowest user id wins, as login_user_query() does.
 * Yields NULL for an employee with no active account.
 */
function employee_role_name_subselect(string $employeeAlias = 'e'): string
{
    /* Aliases no outer query uses, so the subquery never shadows a caller's `u` or `r`. */
    return '(SELECT role_row.name
             FROM users role_user
             INNER JOIN roles role_row ON role_row.id = role_user.role_id
             WHERE role_user.email COLLATE utf8mb4_unicode_ci = ' . $employeeAlias . '.email COLLATE utf8mb4_unicode_ci
               AND role_user.is_archived = 0
             ORDER BY role_user.id ASC
             LIMIT 1)';
}

function session_employee_record_id(PDO $pdo, array $user): ?int
{
    $linkedEmployeeId = (int)($user['linked_employee_record_id'] ?? 0);
    if ($linkedEmployeeId > 0) {
        return $linkedEmployeeId;
    }

    $employeeCode = trimmed_text($user['employee_id'] ?? '');
    $employeeName = trimmed_text($user['full_name'] ?? '');
    $username = trimmed_text($user['username'] ?? '');
    $email = trimmed_text($user['email'] ?? '');

    if ($employeeCode !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $employeeCode]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($email !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE email COLLATE utf8mb4_unicode_ci = :email AND is_archived = 0 LIMIT 1');
        $statement->execute([':email' => $email]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($username !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id COLLATE utf8mb4_unicode_ci = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $username]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($employeeName !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $employeeName]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($username !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) COLLATE utf8mb4_unicode_ci = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $username]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    return null;
}

/**
 * The roles that may write to somebody else's employee record -- the master list, the profile photo,
 * the e-signature. It matches the `employees` module in default_role_permission_access().
 *
 * It lives here rather than in employee.php because three endpoints need the same answer and they do
 * not include one another. Keeping one definition is what stops employee.php from being tightened
 * while employee_signature.php quietly keeps its own looser copy.
 */
function can_manage_employee_records(array $user): bool
{
    return in_array(user_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

/**
 * Allow the write when the caller manages employee records, or when the row being written is the
 * caller's own. Anything else is a 403.
 */
function require_employee_record_access(PDO $pdo, array $user, int $employeeId, string $message): void
{
    if (can_manage_employee_records($user)) {
        return;
    }

    $ownRecordId = session_employee_record_id($pdo, $user);

    if ($employeeId > 0 && $ownRecordId !== null && $ownRecordId === $employeeId) {
        return;
    }

    json_response([
        'success' => false,
        'message' => $message,
    ], 403);
}

function format_user(array $user): array
{
    global $pdo;

    $firstName = trim((string)($user['first_name'] ?? ''));
    $middleName = trim((string)($user['middle_name'] ?? ''));
    $lastName = trim((string)($user['last_name'] ?? ''));
    $fullName = trim(implode(' ', array_filter([$firstName, $middleName, $lastName])));
    $role = $user['role'] ?? 'User';
    $roleKey = normalize_role($role);
    // A custom role has no dashboard of its own, so the client routes it by the
    // built-in role it was based on. Built-in roles resolve to themselves.
    $baseRoleKey = $roleKey;
    $permissions = [];

    if ($pdo instanceof PDO && function_exists('role_base_key')) {
        try {
            $baseRoleKey = role_base_key($pdo, $roleKey) ?: $roleKey;
        } catch (Throwable $exception) {
            error_log('Unable to resolve base role: ' . $exception->getMessage());
        }
    }

    if ($pdo instanceof PDO && function_exists('permissions_for_user')) {
        try {
            $permissions = permissions_for_user($pdo, (int)($user['id'] ?? 0), $roleKey);
        } catch (Throwable $exception) {
            error_log('Unable to load user permissions: ' . $exception->getMessage());
        }
    } elseif ($pdo instanceof PDO && function_exists('permissions_for_role_key')) {
        try {
            $permissions = permissions_for_role_key($pdo, $roleKey);
        } catch (Throwable $exception) {
            error_log('Unable to load user permissions: ' . $exception->getMessage());
        }
    }

    return [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'email_verified_at' => $user['email_verified_at'] ?? null,
        'emailVerifiedAt' => $user['email_verified_at'] ?? null,
        'email_updated_at' => $user['email_updated_at'] ?? null,
        'emailUpdatedAt' => $user['email_updated_at'] ?? null,
        'isEmailVerified' => !empty($user['email_verified_at']),
        'role' => $role,
        'roleKey' => $roleKey,
        'baseRoleKey' => $baseRoleKey,
        'status' => $user['status'] ?? 'Unknown',
        'permissions' => $permissions,
        'employee_id' => $user['employee_id'] ?? null,
        'full_name' => $fullName !== '' ? $fullName : null,
        /*
         * The parts as well as the whole. Splitting a surname back out of full_name is guesswork the
         * moment a name has a middle name or a surname of two words -- "Dela Cruz" and "San Juan" are
         * ordinary here -- so the pieces the query already returned are passed through intact and the
         * client never has to take the name apart itself.
         */
        'first_name' => $firstName !== '' ? $firstName : null,
        'middle_name' => $middleName !== '' ? $middleName : null,
        'last_name' => $lastName !== '' ? $lastName : null,
        'gender' => $user['gender'] ?? null,
        'division' => $user['division'] ?? null,
        'position' => $user['position'] ?? null,
        'designation' => $user['designation'] ?? null,
        'profile_image' => $user['profile_image'] ?? null,
        'must_change_password' => (bool)($user['must_change_password'] ?? false),
        'two_factor_enabled' => (bool)($user['two_factor_enabled'] ?? false),
        'twoFactorEnabled' => (bool)($user['two_factor_enabled'] ?? false),
    ];
}

/** Remember the signed-in actor so json_response() can cover endpoints without a detailed log. */
function audit_monitor_authenticated_user(array $user): void
{
    $GLOBALS['hris_audit_request_user'] = $user;
}

/** Mark this request as already represented by a detailed audit row. */
function audit_mark_entry_written(): void
{
    $GLOBALS['hris_audit_entry_written'] = true;
}

function audit_request_has_entry(): bool
{
    return ($GLOBALS['hris_audit_entry_written'] ?? false) === true;
}

function automatic_audit_token(mixed $value, string $fallback): string
{
    $token = strtolower(trim((string)($value ?? '')));
    $token = trim((string)preg_replace('/[^a-z0-9]+/', '_', $token), '_');

    return $token !== '' ? $token : $fallback;
}

function automatic_audit_endpoint(): string
{
    $script = basename((string)($_SERVER['SCRIPT_NAME'] ?? $_SERVER['SCRIPT_FILENAME'] ?? 'activity.php'));
    $endpoint = pathinfo($script, PATHINFO_FILENAME);

    return automatic_audit_token($endpoint, 'activity');
}

function automatic_audit_request_action(string $method): string
{
    $body = isset($GLOBALS['hris_json_request_body']) && is_array($GLOBALS['hris_json_request_body'])
        ? $GLOBALS['hris_json_request_body']
        : [];
    $requestedAction = $_GET['action'] ?? $_POST['action'] ?? ($body['action'] ?? '');
    $requestedAction = automatic_audit_token($requestedAction, '');

    if ($requestedAction !== '') {
        return $requestedAction;
    }

    $endpointDefaults = [
        'messages:POST' => 'message_sent',
        'employee_documents:POST' => 'uploaded',
        'employee_documents:DELETE' => 'deleted',
        'employee_profile_image:POST' => 'updated',
        'employee_signature:PUT' => 'updated',
    ];
    $default = $endpointDefaults[automatic_audit_endpoint() . ':' . $method] ?? null;

    if ($default !== null) {
        return $default;
    }

    return match ($method) {
        'PUT', 'PATCH' => 'updated',
        'DELETE' => 'deleted',
        default => 'submitted',
    };
}

/**
 * Add one generic row for a successful authenticated mutation that did not write a detailed row.
 * Request bodies are deliberately excluded: password, OTP, signature and document data must never
 * be copied into an audit record. Only routing metadata and the HTTP result are retained.
 */
function write_automatic_activity_audit(
    PDO $pdo,
    array $user,
    string $method,
    string $endpoint,
    string $operation,
    string $responseMessage,
    int $status
): void {
    try {
        ensure_audit_logs_table($pdo);

        $context = audit_request_context();
        $userId = (int)($user['id'] ?? 0) ?: null;
        $actorName = audit_user_display_name($user) ?? ($user['username'] ?? null);
        $actorRole = $user['role'] ?? null;
        $action = substr($endpoint . '.' . $operation, 0, 150);
        $endpointLabel = ucwords(str_replace('_', ' ', $endpoint));
        $operationLabel = strtolower(str_replace('_', ' ', $operation));
        $summary = trim($responseMessage);

        if ($summary === '') {
            $summary = sprintf('%s completed %s in %s.', $actorName ?? 'A user', $operationLabel, $endpointLabel);
        }

        $statement = $pdo->prepare(
            'INSERT INTO audit_logs
                (user_id, action, ip_address, location, device, browser, os, actor_id, actor_name, actor_role, category, entity_type, entity_id, summary, details_json, user_agent)
             VALUES
                (:user_id, :action, :ip_address, :location, :device, :browser, :os, :actor_id, :actor_name, :actor_role, :category, :entity_type, :entity_id, :summary, :details_json, :user_agent)'
        );
        $statement->execute([
            ':user_id' => $userId,
            ':action' => $action,
            ':ip_address' => $context['ipAddress'],
            ':location' => $context['location'],
            ':device' => $context['device'],
            ':browser' => $context['browser'],
            ':os' => $context['os'],
            ':actor_id' => $userId,
            ':actor_name' => $actorName,
            ':actor_role' => $actorRole,
            ':category' => 'activity',
            ':entity_type' => $endpoint,
            ':entity_id' => null,
            ':summary' => $summary,
            ':details_json' => audit_details_json([
                'endpoint' => $endpoint . '.php',
                'method' => $method,
                'operation' => $operation,
                'httpStatus' => $status,
                'automatic' => true,
            ], $context),
            ':user_agent' => $context['userAgent'],
        ]);
        audit_mark_entry_written();
    } catch (Throwable $exception) {
        // A completed user action must not be reported as failed only because its optional log failed.
    }
}

function queue_automatic_activity_audit(PDO $pdo, array $payload, int $status): void
{
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $user = $GLOBALS['hris_audit_request_user'] ?? null;

    if (
        !in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
        || !is_array($user)
        || audit_request_has_entry()
        || $status < 200
        || $status >= 400
        || (($payload['success'] ?? true) === false)
    ) {
        return;
    }

    $endpoint = automatic_audit_endpoint();
    $operation = automatic_audit_request_action($method);
    $responseMessage = is_string($payload['message'] ?? null) ? trim($payload['message']) : '';

    defer(static function () use ($pdo, $user, $method, $endpoint, $operation, $responseMessage, $status): void {
        write_automatic_activity_audit(
            $pdo,
            $user,
            $method,
            $endpoint,
            $operation,
            $responseMessage,
            $status
        );
    });
}

function write_auth_audit(PDO $pdo, ?array $user, string $action, string $summary, array $details = []): void
{
    try {
        ensure_audit_logs_table($pdo);

        $context = audit_request_context();
        $userId = isset($user['id']) ? (int)$user['id'] : null;
        $actorId = $userId;
        $actorName = $user['username'] ?? null;
        $actorRole = $user['role'] ?? null;

        $statement = $pdo->prepare(
            'INSERT INTO audit_logs
                (user_id, action, ip_address, location, device, browser, os, actor_id, actor_name, actor_role, category, entity_type, entity_id, summary, details_json, user_agent)
             VALUES
                (:user_id, :action, :ip_address, :location, :device, :browser, :os, :actor_id, :actor_name, :actor_role, :category, :entity_type, :entity_id, :summary, :details_json, :user_agent)'
        );

        $statement->execute([
            ':user_id' => $userId,
            ':actor_name' => $actorName,
            ':actor_role' => $actorRole,
            ':actor_id' => $actorId,
            ':category' => 'auth',
            ':action' => $action,
            ':entity_type' => $user ? 'user' : 'login_identifier',
            ':entity_id' => $user['id'] ?? ($details['identifier'] ?? null),
            ':summary' => $summary,
            ':details_json' => audit_details_json($details, $context),
            ':ip_address' => $context['ipAddress'],
            ':location' => $context['location'],
            ':device' => $context['device'],
            ':browser' => $context['browser'],
            ':os' => $context['os'],
            ':user_agent' => $context['userAgent'],
        ]);
        audit_mark_entry_written();
    } catch (Throwable $exception) {
        // Login should not fail just because the optional audit write failed.
    }
}

function database_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );
    $statement->execute([':table_name' => $table]);

    return (int)$statement->fetchColumn() > 0;
}

function database_column_exists(PDO $pdo, string $table, string $column): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name
           AND COLUMN_NAME = :column_name'
    );
    $statement->execute([
        ':table_name' => $table,
        ':column_name' => $column,
    ]);

    return (int)$statement->fetchColumn() > 0;
}

/**
 * Flip one record's archive flag.
 *
 * Each module owns its own `action=archive` / `action=restore` branch, because each one has its own
 * role rules and its own idea of what a record is. What none of them needs its own copy of is this:
 * the same three-column UPDATE, written once here so the stamp stays consistent.
 *
 * `$table` and `$primaryKey` are interpolated, so they must be literals from the calling module,
 * never request input — the pattern check below is a backstop, not the guarantee.
 *
 * Returns the number of rows changed, so a caller can tell "already in that state" from "not found".
 */
function set_record_archived(
    PDO $pdo,
    string $table,
    string $primaryKey,
    int $recordId,
    bool $archived,
    ?array $actor = null,
    string $label = 'record'
): int {
    if (!preg_match('/^[A-Za-z0-9_]+$/', $table) || !preg_match('/^[A-Za-z0-9_]+$/', $primaryKey)) {
        throw new InvalidArgumentException('Invalid archive target.');
    }

    $actorUserId = (int)($actor['id'] ?? 0) ?: null;

    ensure_archive_columns($pdo, $table);

    $statement = $pdo->prepare(
        sprintf(
            'UPDATE `%s`
             SET is_archived = :is_archived,
                 archived_at = :archived_at,
                 archived_by_user_id = :archived_by_user_id
             WHERE `%s` = :id
               AND is_archived = :current_state',
            $table,
            $primaryKey
        )
    );
    $statement->execute([
        ':is_archived' => $archived ? 1 : 0,
        ':archived_at' => $archived ? date('Y-m-d H:i:s') : null,
        ':archived_by_user_id' => $archived ? ($actorUserId ?: null) : null,
        ':id' => $recordId,
        // Only touch a row on the other side of the flag, so a repeat click cannot restamp
        // archived_at and the row count stays an honest "did anything change".
        ':current_state' => $archived ? 0 : 1,
    ]);

    $affected = $statement->rowCount();

    /*
     * Archiving hides a record from everyone, so who did it and when has to survive the act. Logged
     * here rather than in each module so no module can quietly skip it — and only when a row really
     * changed, so a repeat click does not pad the trail.
     */
    if ($affected > 0) {
        write_auth_audit(
            $pdo,
            $actor,
            $archived ? 'record_archived' : 'record_restored',
            sprintf(
                '%s %s %s #%d',
                $actor['username'] ?? 'A user',
                $archived ? 'archived' : 'restored',
                $label,
                $recordId
            ),
            ['table' => $table, 'recordId' => $recordId]
        );
    }

    return $affected;
}

/**
 * Whether the caller asked for the archived view of a list (`?archived=1`).
 *
 * Every module list is one or the other, never both: the archive view is a separate screen behind
 * the module's Archive button, the same way the employee directory works. So this picks the value
 * `is_archived` is compared against rather than adding or dropping a filter.
 */
function archived_view_requested(): bool
{
    return filter_var($_GET['archived'] ?? false, FILTER_VALIDATE_BOOLEAN);
}

/**
 * The three columns every archivable record carries. `is_archived` is what every list query filters
 * on; the other two are only ever read back on the Archive page, so a caller that just wants rows
 * hidden never has to join anything.
 *
 * Adding them here rather than in a migration script keeps an existing install repairing itself on
 * the first request that touches the module, which is how the rest of this codebase handles schema
 * drift (see ensure_payroll_meta_column). The static cache means the INFORMATION_SCHEMA lookups
 * happen at most once per table per request.
 */
function ensure_archive_columns(PDO $pdo, string $table): void
{
    static $ensured = [];

    if (isset($ensured[$table])) {
        return;
    }

    $ensured[$table] = true;

    if (!database_table_exists($pdo, $table)) {
        return;
    }

    // Backtick-quoted below, but the table name only ever comes from the archive registry — never
    // from a request — and this keeps it that way even if a caller gets careless.
    if (!preg_match('/^[A-Za-z0-9_]+$/', $table)) {
        return;
    }

    try {
        if (!database_column_exists($pdo, $table, 'is_archived')) {
            $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `is_archived` TINYINT(1) NOT NULL DEFAULT 0");
            $pdo->exec("ALTER TABLE `{$table}` ADD INDEX `idx_{$table}_is_archived` (`is_archived`)");
        }

        if (!database_column_exists($pdo, $table, 'archived_at')) {
            $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `archived_at` DATETIME NULL DEFAULT NULL");
        }

        if (!database_column_exists($pdo, $table, 'archived_by_user_id')) {
            $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `archived_by_user_id` INT UNSIGNED NULL DEFAULT NULL");
        }
    } catch (Throwable $exception) {
        // A parallel request that won the race has already added the column. Losing here is fine —
        // the next database_column_exists call sees it.
        error_log("Archive column setup skipped for {$table}: " . $exception->getMessage());
    }
}

/**
 * The name extension ("Jr.", "III", …), kept in its own column rather than tacked onto the last
 * name so a CS form can print it in its own box and a surname stays sortable.
 *
 * It lives here rather than in employee.php because more than one endpoint selects it back —
 * employee.php and employee_profile_image.php both return the assembled `fullName` — and an
 * endpoint that reads the column has to be sure it exists. Added on first request the way the rest
 * of the codebase handles schema drift (see ensure_archive_columns), so an existing install repairs
 * itself instead of needing a migration run by hand.
 */
function ensure_employee_suffix_column(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $ensured = true;

    if (!database_table_exists($pdo, 'employees') || database_column_exists($pdo, 'employees', 'suffix')) {
        return;
    }

    try {
        $pdo->exec('ALTER TABLE employees ADD COLUMN suffix VARCHAR(20) NULL DEFAULT NULL AFTER last_name');
    } catch (Throwable $exception) {
        // A parallel request that won the race already added it; the next column check sees it.
        error_log('Employee suffix column setup skipped: ' . $exception->getMessage());
    }
}

/**
 * A user created from User Management gets its linked employee row before anyone has decided where
 * that person sits, so division and designation have to be allowed to stay empty until the record is
 * completed from Employee Management. Both columns shipped NOT NULL, which is what used to force a
 * placeholder "Unassigned" division and designation into existence on every such account.
 */
function ensure_employee_assignment_optional(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $ensured = true;

    if (!database_table_exists($pdo, 'employees')) {
        return;
    }

    $statement = $pdo->prepare(
        'SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "employees"
           AND COLUMN_NAME IN ("division_id", "designation_id")
           AND IS_NULLABLE = "NO"'
    );
    $statement->execute();

    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $column) {
        try {
            $pdo->exec("ALTER TABLE employees MODIFY {$column} INT(10) UNSIGNED NULL DEFAULT NULL");
        } catch (Throwable $exception) {
            // A parallel request that won the race already relaxed it; the next check sees it.
            error_log("Employee {$column} nullability setup skipped: " . $exception->getMessage());
        }
    }
}

/**
 * An employee's designation: the assignment given on top of their position, such as "OIC, Finance
 * Section" or "Chief, Administrative Section". Optional free text on the employee row.
 *
 * `employees.designation_id` is older than this column and, despite its name, points at the
 * employee's *position*. The `designations` table is the position catalog (title, hierarchy level,
 * salary grade), and changing an employee's entry there is an appointment change: it opens a service
 * record and counts toward promotions. A designation is neither, so it lives here and nothing is
 * keyed on it.
 *
 * Nearly every endpoint prints an employee's title, so this runs where the session user is loaded --
 * which every signed-in request does -- instead of module by module. One INFORMATION_SCHEMA read
 * answers both "is there an employees table" and "does it have the column yet".
 */
function ensure_employee_designation_column(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $ensured = true;

    $present = (int)$pdo->query(
        "SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'employees'
           AND COLUMN_NAME IN ('designation_id', 'designation')"
    )->fetchColumn();

    // 0: no employees table yet (a fresh, empty database). 2: already migrated.
    if ($present !== 1) {
        return;
    }

    try {
        $pdo->exec('ALTER TABLE employees ADD COLUMN designation VARCHAR(150) NULL DEFAULT NULL AFTER designation_id');
    } catch (Throwable $exception) {
        // A parallel request that won the race added it, and runs the split below itself.
        error_log('Employee designation column setup skipped: ' . $exception->getMessage());

        return;
    }

    employee_designation_split_combined_titles($pdo);
}

/**
 * "Engineer IV / Chief, Mineral Land Survey Section" -> ["Engineer IV", "Chief, Mineral Land Survey
 * Section"]. Null unless the part after " / " reads as a designation, so "Driver / Mechanic" -- one
 * position title -- is left whole.
 */
function employee_designation_split_title(string $name): ?array
{
    if (!preg_match('~^(.+?)\s+/\s+((?:chief|oic|officer[\s-]+in[\s-]+charge)\b.*)$~i', trim($name), $match)) {
        return null;
    }

    return [trim($match[1]), trim($match[2])];
}

/**
 * Before positions and designations were separate, a catalog entry could carry both in one name.
 * This runs once, when the designation column is first added, and takes them apart:
 *
 *  - the part before " / " is the position. It is matched case-insensitively against the division's
 *    other active entries, and added to the catalog (at the combined entry's level) when there is none;
 *  - anyone holding the combined entry moves to that position and gets the part after " / " as their
 *    designation. This is a direct update, so no service record is opened: the appointment is the same;
 *  - the combined entry is archived rather than deleted. Service records and promotions may still
 *    point at it, and the archive keeps its full name on file.
 */
function employee_designation_split_combined_titles(PDO $pdo): void
{
    if (!database_table_exists($pdo, 'designations')) {
        return;
    }

    ensure_organization_structure_columns($pdo);

    $combined = [];

    foreach ($pdo->query(
        'SELECT id, division_id, name, hierarchy_level, salary_grade
         FROM designations
         WHERE is_archived = 0
           AND name LIKE "% / %"
         ORDER BY hierarchy_level, id'
    )->fetchAll() as $row) {
        $parts = employee_designation_split_title((string)$row['name']);

        if ($parts !== null) {
            $combined[] = $row + ['position' => $parts[0], 'designation' => $parts[1]];
        }
    }

    if ($combined === []) {
        return;
    }

    $findPosition = $pdo->prepare(
        'SELECT id
         FROM designations
         WHERE division_id = :division_id
           AND is_archived = 0
           AND LOWER(TRIM(name)) = LOWER(:name)
         ORDER BY id
         LIMIT 1'
    );
    $addPosition = $pdo->prepare(
        'INSERT INTO designations (division_id, name, hierarchy_level, salary_grade, is_archived)
         VALUES (:division_id, :name, :hierarchy_level, :salary_grade, 0)'
    );
    $moveHolders = $pdo->prepare(
        'UPDATE employees
         SET designation_id = :position_id,
             designation = COALESCE(NULLIF(TRIM(designation), ""), :designation)
         WHERE designation_id = :combined_id'
    );
    $archive = $pdo->prepare('UPDATE designations SET is_archived = 1 WHERE id = :id');

    try {
        $pdo->beginTransaction();

        foreach ($combined as $row) {
            $findPosition->execute([
                ':division_id' => (int)$row['division_id'],
                ':name' => $row['position'],
            ]);
            $positionId = (int)$findPosition->fetchColumn();
            $findPosition->closeCursor();

            if ($positionId <= 0) {
                $addPosition->execute([
                    ':division_id' => (int)$row['division_id'],
                    ':name' => $row['position'],
                    ':hierarchy_level' => (int)($row['hierarchy_level'] ?? 1) ?: 1,
                    ':salary_grade' => $row['salary_grade'] ?? null,
                ]);
                $positionId = (int)$pdo->lastInsertId();
            }

            $moveHolders->execute([
                ':position_id' => $positionId,
                ':designation' => $row['designation'],
                ':combined_id' => (int)$row['id'],
            ]);
            $archive->execute([':id' => (int)$row['id']]);
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        error_log('Combined position titles were not split: ' . $exception->getMessage());
    }
}

/**
 * The title printed under someone's signature: their designation when they have one, since that is
 * the capacity they sign in ("Chief, Administrative Section"), otherwise their position.
 */
function employee_signatory_title(mixed $position, mixed $designation): string
{
    $designation = trim((string)($designation ?? ''));

    return $designation !== '' ? $designation : trim((string)($position ?? ''));
}

/**
 * Payroll computation snapshots — the JSON a payslip is rebuilt from — live on their parent
 * `payroll` row. Keeping the snapshot there removes the one-to-one `payrollmeta` table without
 * losing historical inputs, and deleting a payroll row cannot leave snapshot data behind.
 *
 * Very old installations stored snapshots in `settings` under `payroll_meta:<payroll_id>`. Carry
 * those values across on the first payroll request, but delete a settings value only after an exact
 * copy is present on its payroll row.
 */
function ensure_payroll_meta_column(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    // A fresh, empty database may not have been imported yet.
    if (!database_table_exists($pdo, 'Payroll')) {
        return;
    }

    if (!database_column_exists($pdo, 'Payroll', 'meta_json')) {
        try {
            $pdo->exec('ALTER TABLE Payroll ADD COLUMN meta_json LONGTEXT NULL AFTER net_pay');
        } catch (Throwable $exception) {
            // Another request may have completed the same idempotent schema repair first.
            if (!database_column_exists($pdo, 'Payroll', 'meta_json')) {
                throw $exception;
            }
        }
    }

    if (database_table_exists($pdo, 'settings')) {
        /*
         * `payroll_meta:` is 13 characters, so the id starts at 14. The join drops orphans — rows
         * whose payroll run is already gone — rather than attaching them to an unrelated run.
         */
        $pdo->exec(
            'UPDATE Payroll p
             INNER JOIN settings s
                ON p.payroll_id = CAST(SUBSTRING(s.setting_key, 14) AS UNSIGNED)
               AND s.setting_key LIKE "payroll_meta:%"
             SET p.meta_json = s.setting_value
             WHERE p.meta_json IS NULL OR TRIM(p.meta_json) = ""'
        );
        $pdo->exec(
            'DELETE s
             FROM settings s
             INNER JOIN Payroll p
                ON p.payroll_id = CAST(SUBSTRING(s.setting_key, 14) AS UNSIGNED)
               AND s.setting_key LIKE "payroll_meta:%"
             WHERE BINARY p.meta_json = BINARY s.setting_value'
        );
    }

    $ensured = true;
}

/**
 * Ensure the parent payroll row can carry its approval trail, itemised deductions, and the moment
 * the payout desk released it.
 *
 * `released_at` / `released_by` are stamped on the row when the Cashier marks it Paid (see
 * payroll_transition_status() in payroll.php), so the Released Payroll report can list a batch by
 * the day the money went out rather than by the pay period it covered. A row released before these
 * columns existed carries the same fact in its approval trail, which is what the backfill reads.
 */
function ensure_payroll_embedded_detail_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    ensure_payroll_meta_column($pdo);

    if (!database_table_exists($pdo, 'Payroll')) {
        return;
    }

    $columns = [
        'approval_history_json' => 'LONGTEXT NULL AFTER meta_json',
        'deduction_items_json' => 'LONGTEXT NULL AFTER approval_history_json',
        'released_at' => 'DATETIME NULL AFTER deduction_items_json',
        'released_by' => 'INT UNSIGNED NULL AFTER released_at',
    ];
    $added = [];

    foreach ($columns as $column => $definition) {
        if (database_column_exists($pdo, 'Payroll', $column)) {
            continue;
        }

        try {
            $pdo->exec("ALTER TABLE Payroll ADD COLUMN {$column} {$definition}");
            $added[] = $column;
        } catch (Throwable $exception) {
            // A parallel request may have completed the same idempotent repair first.
            if (!database_column_exists($pdo, 'Payroll', $column)) {
                throw $exception;
            }
        }
    }

    if (in_array('released_at', $added, true)) {
        backfill_payroll_release_columns($pdo);
    }

    $ensured = true;
}

/**
 * Stamp the release onto payroll rows the Cashier marked Paid before `released_at` existed, reading
 * it back out of the approval trail the transition wrote at the time. Runs once, when the column is
 * first added. Only the `Paid` action counts: restoring an archived batch lands on the Paid status
 * too, but through a `Restored` entry, and that is not when the money went out.
 */
function backfill_payroll_release_columns(PDO $pdo): void
{
    $statement = $pdo->query(
        'SELECT payroll_id, approval_history_json
         FROM Payroll
         WHERE released_at IS NULL
           AND COALESCE(approval_history_json, "") <> ""'
    );
    $update = $pdo->prepare(
        'UPDATE Payroll
         SET released_at = :released_at, released_by = :released_by
         WHERE payroll_id = :payroll_id'
    );

    foreach ($statement as $row) {
        $release = null;

        foreach (payroll_decode_embedded_json_list($row['approval_history_json'] ?? null) as $entry) {
            if (is_array($entry) && strcasecmp(trim((string)($entry['action'] ?? '')), 'Paid') === 0) {
                $release = $entry;
            }
        }

        $releasedAt = $release !== null ? strtotime((string)($release['actionDate'] ?? '')) : false;

        if ($releasedAt === false) {
            continue;
        }

        $releasedBy = (int)($release['approverUserId'] ?? 0);
        $update->execute([
            ':released_at' => date('Y-m-d H:i:s', $releasedAt),
            ':released_by' => $releasedBy > 0 ? $releasedBy : null,
            ':payroll_id' => (int)$row['payroll_id'],
        ]);
    }
}

function payroll_embedded_json_column_is_allowed(string $column): bool
{
    return in_array($column, ['approval_history_json', 'deduction_items_json'], true);
}

/** Decode an embedded payroll list; malformed legacy data is treated as an empty list. */
function payroll_decode_embedded_json_list(mixed $value): array
{
    if (!is_string($value) || trim($value) === '') {
        return [];
    }

    $decoded = json_decode($value, true);

    $isList = is_array($decoded)
        && ($decoded === [] || array_keys($decoded) === range(0, count($decoded) - 1));

    return $isList ? $decoded : [];
}

function payroll_read_embedded_json_list(PDO $pdo, int $payrollId, string $column): array
{
    if ($payrollId <= 0 || !payroll_embedded_json_column_is_allowed($column)) {
        return [];
    }

    $statement = $pdo->prepare("SELECT `{$column}` FROM Payroll WHERE payroll_id = :payroll_id LIMIT 1");
    $statement->execute([':payroll_id' => $payrollId]);

    return payroll_decode_embedded_json_list($statement->fetchColumn());
}

function payroll_write_embedded_json_list(PDO $pdo, int $payrollId, string $column, array $items): void
{
    if ($payrollId <= 0 || !payroll_embedded_json_column_is_allowed($column)) {
        throw new InvalidArgumentException('Invalid embedded payroll list target.');
    }

    $statement = $pdo->prepare(
        "UPDATE Payroll SET `{$column}` = :payload WHERE payroll_id = :payroll_id"
    );
    $statement->execute([
        ':payload' => json_encode(
            array_values($items),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        ),
        ':payroll_id' => $payrollId,
    ]);
}

/** Allocate ids that remain unique across all embedded lists of the requested kind. */
function payroll_next_embedded_item_id(PDO $pdo, string $column, string $idKey = 'id'): int
{
    if (!payroll_embedded_json_column_is_allowed($column)) {
        throw new InvalidArgumentException('Invalid embedded payroll list target.');
    }

    $maximum = 0;
    foreach ($pdo->query("SELECT `{$column}` FROM Payroll WHERE `{$column}` IS NOT NULL") as $row) {
        foreach (payroll_decode_embedded_json_list($row[$column] ?? null) as $item) {
            if (is_array($item)) {
                $maximum = max($maximum, (int)($item[$idKey] ?? 0));
            }
        }
    }

    return $maximum + 1;
}

function normalize_notification_type(string $type): string
{
    $normalized = preg_replace('/[^a-z0-9]+/i', '_', strtolower(trim($type))) ?? '';
    return trim($normalized, '_');
}

function notification_type_label(string $type): string
{
    return match (normalize_notification_type($type)) {
        'user_created' => 'User Created',
        'employee_added' => 'Employee Added',
        'leave_request_submitted' => 'Leave Request Submitted',
        'leave_request_approved' => 'Leave Request Approved',
        'leave_request_rejected' => 'Leave Request Rejected',
        'payroll_generated' => 'Payroll Generated',
        'attendance_updated' => 'Attendance Updated',
        'account_activated' => 'Account Activated',
        'account_deactivated' => 'Account Deactivated',
        'suspicious_login' => 'Suspicious Login',
        // Lockouts raised before the alert was reworked; kept so old rows still label themselves.
        'account_locked' => 'Account Locked',
        'role_updated' => 'Role Updated',
        'permission_updated' => 'Permission Updated',
        'access_request' => 'Access Requested',
        'access_granted' => 'Access Granted',
        'promotion_submitted' => 'Promotion Submitted',
        'promotion_recommended' => 'Promotion Recommended',
        'promotion_approved' => 'Promotion Approved',
        'promotion_rejected' => 'Promotion Rejected',
        'ipcr_for_approval' => 'IPCR For Approval',
        'ipcr_approved' => 'IPCR Approved',
        'ipcr_returned' => 'IPCR Returned',
        'ipcr_assigned' => 'IPCR Assigned',
        'ipcr_submitted' => 'IPCR For Validation',
        'ipcr_validated' => 'IPCR Validated',
        'system_alert' => 'System Alert',
        'custom' => 'Custom Notification',
        default => ucwords(str_replace('_', ' ', normalize_notification_type($type))),
    };
}

function user_ids_for_role_keys(PDO $pdo, array $roleKeys): array
{
    $normalizedRoleKeys = array_values(array_unique(array_filter(array_map(static fn ($roleKey): string => normalize_role($roleKey), $roleKeys))));

    if ($normalizedRoleKeys === []) {
        return [];
    }

    // The query below reads roles.base_role, which is added on demand.
    ensure_role_columns($pdo);

    $placeholders = implode(',', array_fill(0, count($normalizedRoleKeys), '?'));
    /*
     * `base_role` is matched as well as the name so that a custom role reaches the same people
     * its base role does. A role based on HR Head does the HR Head's work -- it approves the
     * same requests -- so it has to be told when one is waiting, or its holders would only ever
     * find out by going and looking.
     */
    $statement = $pdo->prepare(
        'SELECT DISTINCT u.id
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE u.is_archived = 0
           AND (
             LOWER(REPLACE(r.name, " ", "")) IN (' . $placeholders . ')
             OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) IN (' . $placeholders . ')
           )
         ORDER BY u.id ASC'
    );
    $statement->execute(array_merge($normalizedRoleKeys, $normalizedRoleKeys));

    return array_map('intval', array_column($statement->fetchAll(), 'id'));
}

function user_id_for_employee_record(PDO $pdo, int $employeeRecordId): ?int
{
    if ($employeeRecordId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT u.id
         FROM users u
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE e.id = :employee_id
           AND u.is_archived = 0
         ORDER BY u.id DESC
         LIMIT 1'
    );
    $statement->execute([':employee_id' => $employeeRecordId]);

    $userId = (int)$statement->fetchColumn();

    return $userId > 0 ? $userId : null;
}

function notification_insert(PDO $pdo, int $userId, string $title, string $message, string $type, ?string $referenceId = null): ?int
{
    $userId = (int)$userId;
    $title = trim($title);
    $message = trim($message);
    $type = normalize_notification_type($type);
    $referenceId = trim((string)($referenceId ?? ''));

    if ($userId <= 0 || $title === '' || $message === '' || $type === '') {
        return null;
    }

    $duplicateStatement = $pdo->prepare(
        'SELECT id
         FROM notifications
         WHERE user_id = :user_id
           AND type = :type
           AND title = :title
           AND message = :message
           AND COALESCE(reference_id, "") = :reference_id
           AND created_at >= (NOW() - INTERVAL 5 MINUTE)
         ORDER BY id DESC
         LIMIT 1'
    );
    $duplicateStatement->execute([
        ':user_id' => $userId,
        ':type' => $type,
        ':title' => $title,
        ':message' => $message,
        ':reference_id' => $referenceId,
    ]);

    $existingId = (int)$duplicateStatement->fetchColumn();
    if ($existingId > 0) {
        return $existingId;
    }

    $statement = $pdo->prepare(
        'INSERT INTO notifications
            (user_id, title, message, type, is_read, reference_id)
         VALUES
            (:user_id, :title, :message, :type, 0, :reference_id)'
    );
    $statement->execute([
        ':user_id' => $userId,
        ':title' => $title,
        ':message' => $message,
        ':type' => $type,
        ':reference_id' => $referenceId !== '' ? $referenceId : null,
    ]);

    return (int)$pdo->lastInsertId();
}

function notify_users(PDO $pdo, array $userIds, string $title, string $message, string $type, ?string $referenceId = null): int
{
    $uniqueUserIds = [];

    foreach ($userIds as $userId) {
        $userId = (int)$userId;
        if ($userId > 0) {
            $uniqueUserIds[$userId] = true;
        }
    }

    $createdCount = 0;

    foreach (array_keys($uniqueUserIds) as $userId) {
        if (notification_insert($pdo, $userId, $title, $message, $type, $referenceId) !== null) {
            $createdCount++;
        }
    }

    return $createdCount;
}

function notify_roles(PDO $pdo, array $roleKeys, string $title, string $message, string $type, ?string $referenceId = null): int
{
    return notify_users(
        $pdo,
        user_ids_for_role_keys($pdo, $roleKeys),
        $title,
        $message,
        $type,
        $referenceId
    );
}

function notify_employee(PDO $pdo, int $employeeRecordId, string $title, string $message, string $type, ?string $referenceId = null): int
{
    $userId = user_id_for_employee_record($pdo, $employeeRecordId);

    if ($userId === null) {
        return 0;
    }

    return notify_users($pdo, [$userId], $title, $message, $type, $referenceId);
}
