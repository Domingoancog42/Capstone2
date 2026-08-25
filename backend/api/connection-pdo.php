<?php
declare(strict_types=1);

function configure_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin !== '' && preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin) === 1) {
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

session_name('HRISSESSID');

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

require_once __DIR__ . '/smtp-config.php';

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
 */
$servername = getenv('HRIS_DB_HOST') ?: '127.0.0.1';
$dbusername = getenv('HRIS_DB_USER') ?: 'root';
$dbpassword = getenv('HRIS_DB_PASSWORD');
$dbpassword = $dbpassword === false ? '' : $dbpassword;
$dbname = getenv('HRIS_DB_NAME') ?: 'hris';

$pdoOptions = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
];

$dsn = "mysql:host={$servername};dbname={$dbname};charset=utf8mb4";

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

        $bootstrap = new PDO("mysql:host={$servername};charset=utf8mb4", $dbusername, $dbpassword, $pdoOptions);
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

    ignore_user_abort(true);

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

function json_response(array $payload, int $status = 200): void
{
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

    http_response_code($status);
    echo $json;
    finish_request(strlen($json));
    exit;
}

function read_json_body(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $data = json_decode($rawBody, true);

    return is_array($data) ? $data : [];
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
     * Every write is checked. There used to be an exemption here for a request that authenticated
     * with a bearer token rather than a cookie -- forgery rides on the cookie the browser attaches by
     * itself, and cannot set an Authorization header -- but bearer authentication has been removed,
     * so the only callers left are cookie ones and all of them have ambient authority to forge.
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

/*
 * The general request ceiling, counted before any endpoint gets to run. It sits after the CSRF check
 * so that a flood of tokenless requests is turned away by the cheaper test first, and it reads
 * $_SESSION directly rather than calling session_user() because a request that is over the limit is
 * refused whether or not the session behind it is still valid.
 */
throttle_request($pdo);

const HRIS_ACCOUNT_USE_SESSION_KEY = 'admin_account_use';

/**
 * Server-owned context for an administrator temporarily viewing the application as another user.
 *
 * This deliberately lives beside (not inside) the effective `user` session value. The effective user
 * is refreshed from the database on every request, while the original administrator identity must
 * survive those refreshes so the browser can always return without asking for another password.
 */
function session_account_use(): ?array
{
    $context = $_SESSION[HRIS_ACCOUNT_USE_SESSION_KEY] ?? null;

    if (!is_array($context) || (int)($context['admin_user_id'] ?? 0) <= 0) {
        return null;
    }

    return $context;
}

/** Add only the safe, displayable part of the server session context to a user response. */
function session_user_with_account_use(array $user): array
{
    $context = session_account_use();

    if ($context === null) {
        unset($user['accountUse']);
        return $user;
    }

    $user['accountUse'] = [
        'active' => true,
        'startedAt' => $context['started_at'] ?? null,
        'targetUserId' => (int)($context['target_user_id'] ?? ($user['id'] ?? 0)),
        'admin' => [
            'id' => (int)$context['admin_user_id'],
            'username' => $context['admin_username'] ?? null,
            'fullName' => $context['admin_full_name'] ?? null,
            'role' => $context['admin_role'] ?? 'Admin',
        ],
    ];

    return $user;
}

function account_use_lock_token_hash(string $token): string
{
    return hash('sha256', $token);
}

function account_use_lock_ttl_seconds(PDO $pdo): int
{
    $timeoutMinutes = (int)(security_settings($pdo)['sessionTimeoutMinutes'] ?? 30);
    return max(1, $timeoutMinutes) * 60;
}

/**
 * Store temporary-account locks outside MySQL so this feature requires no database table or migration.
 * The installation path and configured database name keep separate HRIS checkouts from sharing locks.
 */
function account_use_lock_store_path(): string
{
    $databaseName = getenv('HRIS_DB_NAME') ?: 'hris';
    $namespace = substr(hash('sha256', __DIR__ . '|' . $databaseName), 0, 20);

    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR
        . "hris-account-use-{$namespace}.json";
}

/** Remove malformed and expired entries while the store's exclusive file lock is held. */
function prune_expired_account_use_lock_entries(array &$locks, int $now): void
{
    foreach ($locks as $targetUserId => $lock) {
        if (
            !is_array($lock)
            || (int)($lock['target_user_id'] ?? 0) <= 0
            || (int)($lock['admin_user_id'] ?? 0) <= 0
            || (int)($lock['expires_at'] ?? 0) <= $now
        ) {
            unset($locks[$targetUserId]);
        }
    }
}

/**
 * Read and update the shared lock registry under one OS-level exclusive lock.
 * A single locked read-modify-write operation gives concurrent Apache workers the same race safety
 * that the former database primary key supplied, without adding application state to the schema.
 */
function with_account_use_lock_store(callable $callback): mixed
{
    $path = account_use_lock_store_path();
    $wasCreated = !is_file($path);
    $handle = @fopen($path, 'c+b');

    if ($handle === false) {
        throw new RuntimeException('Unable to open the temporary account lock store.');
    }

    if ($wasCreated) {
        @chmod($path, 0600);
    }

    try {
        if (!flock($handle, LOCK_EX)) {
            throw new RuntimeException('Unable to lock the temporary account lock store.');
        }

        rewind($handle);
        $contents = stream_get_contents($handle);

        if ($contents === false) {
            throw new RuntimeException('Unable to read the temporary account lock store.');
        }

        if (trim($contents) === '') {
            $locks = [];
        } else {
            $locks = json_decode($contents, true);

            if (!is_array($locks)) {
                throw new RuntimeException('The temporary account lock store is invalid.');
            }
        }

        prune_expired_account_use_lock_entries($locks, time());
        $result = $callback($locks);
        $encoded = json_encode($locks, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        rewind($handle);

        if (!ftruncate($handle, 0)) {
            throw new RuntimeException('Unable to clear the temporary account lock store.');
        }

        $remaining = $encoded;

        while ($remaining !== '') {
            $written = fwrite($handle, $remaining);

            if ($written === false || $written === 0) {
                throw new RuntimeException('Unable to write the temporary account lock store.');
            }

            $remaining = substr($remaining, $written);
        }

        if (!fflush($handle)) {
            throw new RuntimeException('Unable to flush the temporary account lock store.');
        }

        return $result;
    } finally {
        @flock($handle, LOCK_UN);
        fclose($handle);
    }
}

/** Return a live lock for a target account. */
function active_account_use_lock(PDO $pdo, int $targetUserId): ?array
{
    if ($targetUserId <= 0) {
        return null;
    }

    return with_account_use_lock_store(
        static fn (array &$locks): ?array => $locks[(string)$targetUserId] ?? null
    );
}

/**
 * Atomically reserve an account. The file lock makes two Admin clicks race safely: exactly one
 * write wins and the other caller is told the account is already in use.
 */
function acquire_account_use_lock(PDO $pdo, int $adminUserId, int $targetUserId): ?array
{
    if ($adminUserId <= 0 || $targetUserId <= 0) {
        return null;
    }

    $token = bin2hex(random_bytes(32));
    $now = time();
    $expiresAt = $now + account_use_lock_ttl_seconds($pdo);

    $acquired = with_account_use_lock_store(
        static function (array &$locks) use ($adminUserId, $targetUserId, $token, $now, $expiresAt): bool {
            $key = (string)$targetUserId;

            if (isset($locks[$key])) {
                return false;
            }

            $locks[$key] = [
                'target_user_id' => $targetUserId,
                'admin_user_id' => $adminUserId,
                'lock_token_hash' => account_use_lock_token_hash($token),
                'started_at' => date('c', $now),
                'last_seen_at' => date('c', $now),
                'expires_at' => $expiresAt,
            ];

            return true;
        }
    );

    if (!$acquired) {
        return null;
    }

    return [
        'target_user_id' => $targetUserId,
        'admin_user_id' => $adminUserId,
        'lock_token' => $token,
        'started_at' => date('c', $now),
        'lock_renewed_at' => $now,
    ];
}

function touch_account_use_lock(PDO $pdo, array $context): bool
{
    $targetUserId = (int)($context['target_user_id'] ?? 0);
    $adminUserId = (int)($context['admin_user_id'] ?? 0);
    $token = (string)($context['lock_token'] ?? '');

    if ($targetUserId <= 0 || $adminUserId <= 0 || $token === '') {
        return false;
    }

    $now = time();

    return with_account_use_lock_store(
        static function (array &$locks) use ($pdo, $targetUserId, $adminUserId, $token, $now): bool {
            $key = (string)$targetUserId;
            $lock = $locks[$key] ?? null;

            if (
                !is_array($lock)
                || (int)($lock['admin_user_id'] ?? 0) !== $adminUserId
                || !hash_equals(
                    (string)($lock['lock_token_hash'] ?? ''),
                    account_use_lock_token_hash($token)
                )
            ) {
                return false;
            }

            $locks[$key]['last_seen_at'] = date('c', $now);
            $locks[$key]['expires_at'] = $now + account_use_lock_ttl_seconds($pdo);

            return true;
        }
    );
}

function release_account_use_lock(PDO $pdo, ?array $context = null): void
{
    $context ??= session_account_use();

    if ($context === null) {
        return;
    }

    $targetUserId = (int)($context['target_user_id'] ?? 0);
    $adminUserId = (int)($context['admin_user_id'] ?? 0);
    $token = (string)($context['lock_token'] ?? '');

    if ($targetUserId <= 0 || $adminUserId <= 0 || $token === '') {
        return;
    }

    with_account_use_lock_store(
        static function (array &$locks) use ($targetUserId, $adminUserId, $token): void {
            $key = (string)$targetUserId;
            $lock = $locks[$key] ?? null;

            if (
                is_array($lock)
                && (int)($lock['admin_user_id'] ?? 0) === $adminUserId
                && hash_equals(
                    (string)($lock['lock_token_hash'] ?? ''),
                    account_use_lock_token_hash($token)
                )
            ) {
                unset($locks[$key]);
            }
        }
    );
}

function session_user(): ?array
{
    if (!isset($_SESSION['user']) || !is_array($_SESSION['user'])) {
        return null;
    }

    return session_user_with_account_use($_SESSION['user']);
}

function destroy_session(): void
{
    global $pdo;

    if ($pdo instanceof PDO) {
        try {
            release_account_use_lock($pdo);
        } catch (Throwable $exception) {
            error_log('Unable to release temporary account lock: ' . $exception->getMessage());
        }
    }

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
                    e.profile_image,
                    d.name AS division,
                    des.name AS designation
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
                    e.profile_image,
                    d.name AS division,
                    des.name AS designation
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
                    e.profile_image,
                    d.name AS division,
                    des.name AS designation
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
        'profile_image' => $employee['profile_image'] ?? ($user['profile_image'] ?? null),
        'division' => $employee['division'] ?? ($user['division'] ?? null),
        'designation' => $employee['designation'] ?? ($user['designation'] ?? null),
    ]);
}

function session_user_record(PDO $pdo, int $id): ?array
{
    ensure_two_factor_schema($pdo);
    ensure_email_verification_columns($pdo);

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
            e.profile_image,
            d.name AS division,
            des.name AS designation
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

    return session_user_with_account_use(format_user($freshUser));
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
 * `$keepSessionOpen` is for the handful of endpoints that write to $_SESSION themselves; see the
 * note over the session_write_close() below for why every other endpoint wants the default.
 */
function require_session_user(bool $extendSession = true, bool $keepSessionOpen = false): array
{
    global $pdo;

    $user = session_user();

    /*
     * A session or nothing. There used to be a bearer-token fallback here for callers that are not a
     * browser; it was removed along with the rest of that path, so the session cookie is the only way
     * in and an Authorization header means nothing to this API any more.
     */
    if ($user === null) {
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
        json_response([
            'success' => false,
            'message' => 'Your session expired due to inactivity. Please sign in again.',
        ], 401);
    }

    if ($extendSession) {
        $_SESSION['last_activity_at'] = time();

        $accountUse = session_account_use();
        $lastRenewedAt = (int)($accountUse['lock_renewed_at'] ?? 0);

        // A one-minute renewal cadence keeps the shared lock file aligned with the PHP session
        // without rewriting it on every dashboard request.
        if ($accountUse !== null && (time() - $lastRenewedAt) >= 60) {
            if (!touch_account_use_lock($pdo, $accountUse)) {
                destroy_session();
                json_response([
                    'success' => false,
                    'reason' => 'account_use_expired',
                    'message' => 'Temporary account access expired. Please sign in again.',
                ], 401);
            }

            $_SESSION[HRIS_ACCOUNT_USE_SESSION_KEY]['lock_renewed_at'] = time();
        }
    }

    $refreshedUser = refresh_session_user($user);

    if ($refreshedUser === null) {
        destroy_session();
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
        json_response([
            'success' => false,
            'reason' => 'account_inactive',
            'message' => 'Your account has been set to inactive. Please contact your administrator.',
        ], 401);
    }

    /*
     * A user who was already signed in when an Admin reserved their account is ended on the next
     * authenticated request. The Admin's effective session carries account-use context and is the
     * only session allowed through the matching lock.
     */
    if (session_account_use() === null) {
        $lastAccountUseCheckAt = (int)($_SESSION['account_use_check_at'] ?? 0);

        // One lookup per browser every ten seconds is enough to end an already-open employee
        // session promptly without adding a query to every polling request on every dashboard.
        if ((time() - $lastAccountUseCheckAt) >= 10) {
            $_SESSION['account_use_check_at'] = time();

            if (active_account_use_lock($pdo, (int)($refreshedUser['id'] ?? 0)) !== null) {
                destroy_session();
                json_response([
                    'success' => false,
                    'reason' => 'account_in_use_by_admin',
                    'message' => 'This account is currently being used by an administrator. Please try again later.',
                ], 401);
            }
        }
    }

    $_SESSION['user'] = $refreshedUser;

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
        'division' => $user['division'] ?? null,
        'designation' => $user['designation'] ?? null,
        'profile_image' => $user['profile_image'] ?? null,
        'must_change_password' => (bool)($user['must_change_password'] ?? false),
        'two_factor_enabled' => (bool)($user['two_factor_enabled'] ?? false),
        'twoFactorEnabled' => (bool)($user['two_factor_enabled'] ?? false),
    ];
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
        $accountUse = session_account_use();

        /*
         * The effective account stays in user_id/entity_id so the audit says which account was used,
         * while actor_* names the administrator who actually clicked. This prevents temporary use
         * from making an admin's changes indistinguishable from the employee's own actions.
         */
        if ($accountUse !== null) {
            $actorId = (int)$accountUse['admin_user_id'];
            $actorName = $accountUse['admin_username'] ?? $actorName;
            $actorRole = $accountUse['admin_role'] ?? 'Admin';
            $details['accountUse'] = [
                'adminUserId' => $actorId,
                'effectiveUserId' => $userId,
                'startedAt' => $accountUse['started_at'] ?? null,
            ];
        }

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
 * drift (see ensure_payroll_meta_table). The static cache means the INFORMATION_SCHEMA lookups
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
 * Payroll computation snapshots — the JSON a payslip is rebuilt from — used to live in `settings`
 * under a `payroll_meta:<payroll_id>` key. That left the application settings store mostly full of
 * payroll data, and orphaned a row every time a payroll run was deleted, because a key/value table
 * has no foreign key to cascade through.
 *
 * They have their own table now. This creates it and carries anything still sitting in `settings`
 * across on the first request that touches payroll, so an existing install repairs itself instead of
 * needing a migration run by hand.
 */
function ensure_payroll_meta_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    // The foreign key needs its parent; on a database without payroll there is nothing to move yet.
    if (!database_table_exists($pdo, 'Payroll')) {
        return;
    }

    if (database_table_exists($pdo, 'settings')) {
        /*
         * `payroll_meta:` is 13 characters, so the id starts at 14. The join drops orphans — rows
         * whose payroll run is already gone — rather than migrating them: the foreign key would
         * reject them anyway, and they describe a run nobody can open.
         */
        $pdo->exec(
            'INSERT IGNORE INTO PayrollMeta (payroll_id, meta_json)
             SELECT CAST(SUBSTRING(s.setting_key, 14) AS UNSIGNED), s.setting_value
             FROM settings s
             INNER JOIN Payroll p ON p.payroll_id = CAST(SUBSTRING(s.setting_key, 14) AS UNSIGNED)
             WHERE s.setting_key LIKE "payroll_meta:%"'
        );
        $pdo->exec('DELETE FROM settings WHERE setting_key LIKE "payroll_meta:%"');
    }

    $ensured = true;
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
        'service_record_print_request' => 'Service Record Print Requested',
        'service_record_print_approved' => 'Service Record Print Approved',
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
