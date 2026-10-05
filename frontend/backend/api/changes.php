<?php
declare(strict_types=1);

/**
 * Long-polled change feed for cross-machine live refresh.
 *
 * The browser already syncs itself: a mutation publishes an auto-refresh event and BroadcastChannel
 * relays it to the other tabs. That never leaves the machine, so when HR approves a leave on their
 * computer the employee's browser has no way to learn anything happened.
 *
 * This is that missing link. The client sends the cursor it last saw and the request is *held open*
 * until a revision actually moves — up to `hold` seconds — instead of answering "nothing changed"
 * straight away and being asked again a few seconds later. An approval therefore reaches the other
 * machine within one inner tick rather than within one client poll interval, and an idle system
 * exchanges one request per hold window instead of one every few seconds.
 *
 * Two things make holding a PHP request safe here, and both are load-bearing:
 *   - the session lock is released below, or this request would block every other request the same
 *     user makes for as long as it is held;
 *   - the hold is bounded and the inner tick widens as it goes, so a parked connection stays cheap
 *     and always terminates on its own.
 *
 * The real ceiling on this design is that each held request occupies one Apache worker thread for
 * its whole life. The client keeps that to one connection per browser (not per tab) by electing a
 * leader tab; see liveUpdatesService.js.
 */

require_once __DIR__ . '/connection-pdo.php';

/*
 * `false` keeps this from touching `last_activity_at`. Every signed-in browser parks a request here
 * continuously, so counting it as activity would hold every session open forever and quietly disable
 * the configured inactivity timeout. An idle session still expires here — it just 401s, and the
 * client treats that the same as any other expired request.
 */
require_session_user(false);

/*
 * Nothing below writes to the session, and PHP's file session handler holds an exclusive lock for
 * the life of the request. Releasing it now is what makes a held request survivable: without this,
 * a poll parked for 25 seconds stalls every other request the same user makes for those 25 seconds,
 * and the page they are actually using appears to freeze.
 */
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

/**
 * Topic => the tables that back it. Topic keys match the ones the client already derives from API
 * filenames, so the existing topic-to-event mapping keeps working unchanged.
 *
 * A topic lists every table a change could land in, because a screen goes stale either way: an OPCR
 * assignment writes `division_opcr_assignments`, but retiring the template it was built from writes
 * `opcr_templates`, and the screen shows both. Two tables may appear under two topics (payroll and
 * payslip both read `payroll`) — topics are what the client subscribes to, not a partition of the
 * schema.
 *
 * `status` is included in the fingerprint on purpose: `overtime`, `payroll` and `notifications` have
 * no ON UPDATE timestamp, so an approval or a read-receipt there changes no timestamp and adds no
 * row. Summing a checksum of (pk, status) catches those transitions; the timestamp and row count
 * catch everything else.
 */
const CHANGE_FEED_TOPICS = [
    'leave_request' => [
        ['table' => 'leave_requests', 'pk' => 'leave_request_id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'travel_order' => [
        ['table' => 'travel_orders', 'pk' => 'travel_order_id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    // A pass slip moves through approval and then through two QR scans, and the scans are made at a
    // different machine from the one watching the slip -- the guard's reader, not the employee's
    // browser. `status` is fingerprinted so that transition reaches the other screen even though the
    // scan writes no new row, and `pass_slip_scans` so the scan-history panel follows it.
    'pass_slip' => [
        ['table' => 'pass_slip', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'pass_slip_scans', 'pk' => 'id', 'stamp' => 'scanned_at', 'status' => null],
    ],
    'compensatory' => [
        ['table' => 'compensatory', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'overtime' => [
        ['table' => 'overtime', 'pk' => 'overtime_id', 'stamp' => 'created_at', 'status' => 'status'],
        // The memo an employee files for rendered overtime; noting it changes only its status.
        ['table' => 'overtime_accomplishment_reports', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'leave_credit' => [
        ['table' => 'leave_credits', 'pk' => 'leave_credits_id', 'stamp' => 'updated_at', 'status' => null],
    ],
    'leave_monetization' => [
        ['table' => 'leave_monetization_requests', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'loan_request' => [
        ['table' => 'loan_records', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'attendance' => [
        ['table' => 'attendance_daily_records', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'attendance_logs', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'raw_state'],
    ],
    'ipcr' => [
        ['table' => 'ipcr', 'pk' => 'ipcr_id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'opcr' => [
        ['table' => 'opcr_templates', 'pk' => 'template_id', 'stamp' => 'updated_at', 'status' => 'template_status'],
        ['table' => 'division_opcr_assignments', 'pk' => 'assignment_id', 'stamp' => 'updated_at', 'status' => 'assignment_status'],
    ],
    'service_record' => [
        ['table' => 'service_records', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'employment_status'],
    ],
    'promotion' => [
        ['table' => 'promotions', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'employee' => [
        ['table' => 'employees', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'payroll' => [
        ['table' => 'payroll', 'pk' => 'payroll_id', 'stamp' => 'payroll_date', 'status' => 'status'],
    ],
    'payslip' => [
        ['table' => 'payroll', 'pk' => 'payroll_id', 'stamp' => 'payroll_date', 'status' => 'status'],
    ],
    'notifications' => [
        ['table' => 'notifications', 'pk' => 'id', 'stamp' => 'created_at', 'status' => 'is_read'],
    ],
    /*
     * Award cycles and the votes cast in them. Nominations are the reason this topic exists: a
     * leaderboard that only moved when you reloaded would show a stale tally to everyone watching.
     */
    'rewards' => [
        ['table' => 'reward_cycles', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'reward_cycle_votes', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => null],
        // The employees' ballots, so the HR Head's live results move as the votes come in.
        ['table' => 'reward_employee_votes', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => null],
        // Certificates are minted by closing a cycle, so My Awards fills in without a reload.
        ['table' => 'reward_certificates', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => null],
    ],
    /*
     * Both permission sources are rows in the key/value `settings` table, so this topic is filtered
     * down to just those two keys. Without the filter every unrelated settings write — SMTP, rate
     * limits, backup schedule — would tell every signed-in browser its permissions had changed.
     */
    'permissions' => [
        [
            'table' => 'settings',
            'pk' => 'setting_key',
            'stamp' => 'updated_at',
            'status' => 'setting_value',
            'where' => 'setting_key IN ("role_permissions", "user_permissions")',
        ],
    ],
    /*
     * The interface color lives inside system_configuration.  Keeping it separate from the broader
     * Settings topics lets App update the visual tokens in open dashboards without refetching or
     * disturbing any workspace data.
     */
    'ui_preference' => [
        [
            'table' => 'settings',
            'pk' => 'setting_key',
            'stamp' => 'updated_at',
            'status' => 'setting_value',
            'where' => 'setting_key = "system_configuration"',
        ],
    ],
    /*
     * A shorter inactivity timeout must reach dashboards that were already open when an
     * administrator saved it. Keeping this to the timeout row avoids waking every browser for an
     * unrelated Settings change while still carrying the policy across machines.
     */
    'security_policy' => [
        [
            'table' => 'settings',
            'pk' => 'setting_key',
            'stamp' => 'updated_at',
            'status' => 'setting_value',
            'where' => 'setting_key = "security_session_timeout_minutes"',
        ],
    ],
    'access_request' => [
        ['table' => 'module_access_requests', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    /*
     * Sign-in trouble, for the admin sitting on Settings > Security.
     *
     * These two are the clearest case the feed exists for: a lock is written by login.php on behalf of
     * someone who is not signed in at all, from a machine that shares nothing with the admin's browser,
     * so no amount of tab-to-tab relaying can carry the news. Without a topic here the panel only ever
     * caught up when the admin reloaded or pressed Refresh.
     *
     * `locked_accounts` is filtered to the same rows the panel lists. Watching `users` unfiltered would
     * fire on every failed attempt including the harmless first one, and on password changes and role
     * edits besides; filtered, the revision moves when an account actually locks, gets unlocked, or has
     * its attempt count moved while locked — which is exactly when the list changes.
     */
    'locked_accounts' => [
        [
            'table' => 'users',
            'pk' => 'id',
            'stamp' => 'locked_until',
            'status' => 'failed_login_attempts',
            'where' => 'is_archived = 0 AND failed_login_attempts > 0 AND locked_until IS NOT NULL',
        ],
    ],
    /*
     * Individual sign-in events, which is what the Audit Logs tab shows. Restricted to the `auth`
     * category on purpose: `audit_logs` takes a row for nearly every mutation in the system, and an
     * unfiltered topic here would end every parked request on the estate each time anybody did
     * anything — the feed would never get to hold. Auth rows are written only on sign-in, sign-out and
     * lockout, so this stays quiet until someone is actually at a login form.
     */
    'auth_activity' => [
        [
            'table' => 'audit_logs',
            'pk' => 'id',
            'stamp' => 'created_at',
            'status' => null,
            'where' => 'category = "auth"',
        ],
    ],
    /*
     * The administrator's Audit Logs screen monitors the full trail, including the automatic
     * safety-net rows written for modules that do not have a more specific audit event.
     */
    'audit_activity' => [
        [
            'table' => 'audit_logs',
            'pk' => 'id',
            'stamp' => 'created_at',
            'status' => null,
        ],
    ],
    /*
     * Calendar announcements. Everyone's calendar shows them, so a notice published by HR has to
     * reach the machines already sitting on the calendar rather than waiting for their next reload.
     */
    'announcement' => [
        ['table' => 'announcements', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => null],
    ],
    /*
     * Holidays, for the same reason. Only the stored rows are watched: the national list holiday.php
     * generates is a pure function of the year, so it cannot change under a screen that is already
     * open, and there is nothing for a feed to report about it.
     *
     * `updated_at` is not in the shipped schema; ensure_holidays_table() adds it on the first request
     * to holiday.php. Until that happens the scan below throws on the missing column and is caught
     * into a constant "error" revision, which is stable -- so an install that has never loaded a
     * calendar simply reports no holiday changes rather than taking the feed down.
     */
    'holiday' => [
        ['table' => 'holidays', 'pk' => 'holidays_id', 'stamp' => 'updated_at', 'status' => null],
    ],
];

/**
 * How long one request may be parked.
 *
 * 25s is chosen against the things that cut a held connection from the outside: PHP's default
 * `max_execution_time` of 30s, and the 30–60s idle timeouts common to proxies and antivirus web
 * shields. Raising it lengthens the quiet period between requests but makes an unexpected mid-flight
 * cut more likely, and every extra second is a second an Apache worker thread stays occupied.
 *
 * The floor is 0 so a client can ask for no hold at all: one snapshot, answered at once. That is
 * what the shared-hosting build does (REACT_APP_LIVE_UPDATES_POLL_SECONDS), because a host such as
 * InfinityFree caps concurrent PHP processes and CPU time, and a parked request spends both. The
 * default long-poll client still asks for 25 and is unaffected.
 */
const CHANGE_FEED_MIN_HOLD_SECONDS = 0;
const CHANGE_FEED_MAX_HOLD_SECONDS = 25;
const CHANGE_FEED_DEFAULT_HOLD_SECONDS = 25;

/**
 * The inner tick starts tight and widens.
 *
 * A change that lands right after the client reconnects is the common case — somebody clicks Approve
 * while the other person is watching the list — so the first few seconds are worth scanning often.
 * A connection still parked twenty seconds in is watching an idle system, and checking it every
 * second buys latency nobody is waiting on while re-running an aggregate over every listed table.
 */
const CHANGE_FEED_MIN_TICK_US = 1000000;
const CHANGE_FEED_MAX_TICK_US = 3000000;
const CHANGE_FEED_TICK_STEP_US = 500000;

function changes_table_exists(PDO $pdo, string $table): bool
{
    // Safe to hold across ticks: a table does not appear or vanish inside one request.
    static $cache = [];

    if (array_key_exists($table, $cache)) {
        return $cache[$table];
    }

    /*
     * INFORMATION_SCHEMA rather than `SHOW TABLES LIKE :table`: MariaDB's prepared-statement protocol
     * rejects a placeholder there, and this connection runs with EMULATE_PREPARES off, so the SHOW
     * form threw on the first table scanned and took the whole feed down with it.
     */
    $cache[$table] = database_table_exists($pdo, $table);

    return $cache[$table];
}

/**
 * One scan per table returning a short opaque string. Callers only ever compare it for equality —
 * the parts are never parsed, so the exact shape is free to change.
 *
 * `$cache` is passed in rather than held static because this now runs once per tick: a static cache
 * would pin the first tick's answer for the life of the request and the hold could never end.
 */
function changes_table_revision(PDO $pdo, array $config, array &$cache): string
{
    // Topics overlap (payroll and payslip read the same table), so scan each table at most once per tick.
    $cacheKey = implode('|', [
        $config['table'],
        $config['pk'],
        $config['stamp'],
        $config['status'] ?? '',
        $config['where'] ?? '',
    ]);

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $table = $config['table'];

    if (!changes_table_exists($pdo, $table)) {
        return $cache[$cacheKey] = 'absent';
    }

    $pk = $config['pk'];
    $stamp = $config['stamp'];
    $status = $config['status'];

    $statusExpression = $status === null
        ? '0'
        : sprintf('COALESCE(SUM(CRC32(CONCAT_WS("|", `%s`, COALESCE(`%s`, "")))), 0)', $pk, $status);

    // `where` is a literal from CHANGE_FEED_TOPICS above, never anything a request can influence.
    $whereClause = isset($config['where']) ? ' WHERE ' . $config['where'] : '';

    $sql = sprintf(
        'SELECT CONCAT_WS(":", COUNT(*), COALESCE(MAX(`%s`), 0), COALESCE(MAX(`%s`), ""), %s) FROM `%s`%s',
        $pk,
        $stamp,
        $statusExpression,
        $table,
        $whereClause
    );

    try {
        return $cache[$cacheKey] = (string)$pdo->query($sql)->fetchColumn();
    } catch (Throwable $error) {
        // A malformed table must not take the whole feed down with it.
        return $cache[$cacheKey] = 'error';
    }
}

/**
 * One tick: every topic's revision, read fresh.
 *
 * The per-tick cache is local, so each call re-reads the database. Every statement runs in its own
 * implicit transaction under autocommit, which is what lets a later tick see a row another
 * connection committed after this request started — under an open transaction, REPEATABLE READ would
 * keep handing back the snapshot from the first tick and the hold would never end.
 */
function changes_snapshot(PDO $pdo): array
{
    $cache = [];
    $revisions = [];

    foreach (CHANGE_FEED_TOPICS as $topic => $tableConfigs) {
        $parts = [];

        foreach ($tableConfigs as $config) {
            $parts[] = changes_table_revision($pdo, $config, $cache);
        }

        // A topic moves when any of its tables moves, so its revision is just theirs joined together.
        $revisions[$topic] = implode('~', $parts);
    }

    return $revisions;
}

/**
 * The whole snapshot reduced to one comparable token.
 *
 * The client sends this back instead of the full revision map, so a parked request carries a few
 * dozen bytes rather than every topic's fingerprint. Which topics actually moved is worked out on
 * the client by diffing the returned map against the one it already had.
 */
function changes_cursor(array $revisions): string
{
    return md5((string)json_encode($revisions));
}

function changes_respond(array $revisions, string $cursor, bool $timedOut): void
{
    header('Cache-Control: no-store, no-cache, must-revalidate');
    // Tells any reverse proxy in front of Apache not to sit on the response waiting for more.
    header('X-Accel-Buffering: no');

    json_response([
        'success' => true,
        'revisions' => $revisions,
        'cursor' => $cursor,
        'timedOut' => $timedOut,
        'at' => gmdate('c'),
    ]);
}

$requestedHold = isset($_GET['hold']) ? (int)$_GET['hold'] : CHANGE_FEED_DEFAULT_HOLD_SECONDS;
$holdSeconds = max(CHANGE_FEED_MIN_HOLD_SECONDS, min(CHANGE_FEED_MAX_HOLD_SECONDS, $requestedHold));
$clientCursor = trim((string)($_GET['cursor'] ?? ''));

// The default 30s cap would kill a full hold mid-flight; the margin covers the final tick's queries.
// Guarded because shared hosts may disable it, and PHP 8 fatals on a disabled function.
if (function_exists('set_time_limit')) {
    set_time_limit($holdSeconds + 15);
}

$revisions = changes_snapshot($pdo);
$cursor = changes_cursor($revisions);

/*
 * A client with no cursor is asking for a baseline, not waiting for news — answer at once so the
 * first load is not parked for the full hold before it learns where it stands. A cursor that already
 * disagrees means something moved while the client was away, so that answers immediately too.
 */
if ($clientCursor === '' || $clientCursor !== $cursor) {
    changes_respond($revisions, $cursor, false);
}

$deadline = microtime(true) + $holdSeconds;
$tickUs = CHANGE_FEED_MIN_TICK_US;

while (true) {
    $remainingSeconds = $deadline - microtime(true);

    if ($remainingSeconds <= 0) {
        break;
    }

    usleep((int)min($tickUs, $remainingSeconds * 1000000));

    /*
     * Best effort only: PHP learns a client has gone away when it next writes output, and this
     * endpoint writes nothing until it answers. A request whose reader has left therefore usually
     * runs out its hold — which is bounded, and the reason it is bounded.
     */
    if (connection_aborted() !== 0) {
        exit;
    }

    $revisions = changes_snapshot($pdo);
    $cursor = changes_cursor($revisions);

    if ($cursor !== $clientCursor) {
        changes_respond($revisions, $cursor, false);
    }

    $tickUs = min($tickUs + CHANGE_FEED_TICK_STEP_US, CHANGE_FEED_MAX_TICK_US);
}

/*
 * Nothing moved. The revisions still ship so a client that somehow drifted can resynchronise, and
 * `timedOut` tells it this was the quiet path — it reconnects without treating it as a change.
 */
changes_respond($revisions, $cursor, true);
