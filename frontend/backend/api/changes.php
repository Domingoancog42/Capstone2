<?php
declare(strict_types=1);

/**
 * Change feed for live status refresh.
 *
 * Clients poll this and compare each topic's revision against the one they last saw. A changed
 * revision means "something in that topic moved" — the client then republishes its existing
 * auto-refresh event for the topic and every screen already listening reloads itself.
 *
 * This exists because the browser-side sync (BroadcastChannel + localStorage) only reaches other
 * tabs of the *same* browser. When HR approves a leave on their machine, the employee's browser has
 * no way to learn about it without asking the server. This is that ask, kept deliberately cheap so
 * it can run on a short interval.
 */

require_once __DIR__ . '/connection-pdo.php';

/*
 * `false` keeps this poll from touching `last_activity_at`. Every open tab hits this endpoint every
 * few seconds, so counting it as activity would hold every session open forever and quietly disable
 * the configured inactivity timeout. An idle session still expires here — it just 401s, and the
 * client treats that the same as any other expired request.
 */
require_session_user(false);

/*
 * Nothing below writes to the session, and PHP's file session handler holds an exclusive lock for
 * the life of the request. Releasing it now stops this poll from serialising against the user's
 * real requests — without this, a poll in flight can stall the page they are actually using.
 */
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

/**
 * Topic => the tables that back it. Topic keys match the ones the client already derives from API
 * filenames, so the existing topic-to-event mapping keeps working unchanged.
 *
 * A topic lists every table a change could land in, because a screen goes stale either way: an IPCR
 * submission writes `ipcr`, but retiring the template it was built from writes `ipcr_templates`, and
 * the screen shows both. Two tables may appear under two topics (payroll and payslip both read
 * `payroll`) — topics are what the client subscribes to, not a partition of the schema.
 *
 * `status` is included in the fingerprint on purpose: `overtime`, `payroll` and `notifications` have
 * no ON UPDATE timestamp, so an approval or a read-receipt there changes no timestamp and adds no
 * row. Summing a checksum of (pk, status) catches those transitions; the timestamp and row count
 * catch everything else.
 */
const CHANGE_FEED_TOPICS = [
    'leave_request' => [
        ['table' => 'leave_requests', 'pk' => 'leave_request_id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'leave_approvals', 'pk' => 'leave_approvals_id', 'stamp' => 'acted_at', 'status' => 'status'],
    ],
    'travel_order' => [
        ['table' => 'travel_orders', 'pk' => 'travel_order_id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'pass_slip' => [
        ['table' => 'pass_slip', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'compensatory' => [
        ['table' => 'compensatory', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'overtime' => [
        ['table' => 'overtime', 'pk' => 'overtime_id', 'stamp' => 'created_at', 'status' => 'status'],
    ],
    'leave_credit' => [
        ['table' => 'leave_credits', 'pk' => 'leave_credits_id', 'stamp' => 'updated_at', 'status' => null],
    ],
    'leave_monetization' => [
        ['table' => 'leave_monetization_requests', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'loan_request' => [
        ['table' => 'loan_requests', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'loan_request_audit_trail', 'pk' => 'id', 'stamp' => 'created_at', 'status' => 'new_status'],
    ],
    'cash_advance' => [
        ['table' => 'cash_advance_requests', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
    'attendance' => [
        ['table' => 'attendance_daily_records', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'attendance_adjustments', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'attendance_logs', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'raw_state'],
    ],
    'ipcr' => [
        ['table' => 'ipcr', 'pk' => 'ipcr_id', 'stamp' => 'updated_at', 'status' => 'status'],
        ['table' => 'ipcr_templates', 'pk' => 'template_id', 'stamp' => 'updated_at', 'status' => 'is_archived'],
    ],
    'opcr' => [
        ['table' => 'opcr_templates', 'pk' => 'template_id', 'stamp' => 'updated_at', 'status' => 'template_status'],
        ['table' => 'division_opcr_assignments', 'pk' => 'assignment_id', 'stamp' => 'updated_at', 'status' => 'assignment_status'],
    ],
    'service_record' => [
        ['table' => 'service_records', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'employment_status'],
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
    'access_request' => [
        ['table' => 'module_access_requests', 'pk' => 'id', 'stamp' => 'updated_at', 'status' => 'status'],
    ],
];

function changes_table_exists(PDO $pdo, string $table): bool
{
    static $cache = [];

    if (array_key_exists($table, $cache)) {
        return $cache[$table];
    }

    $statement = $pdo->prepare('SHOW TABLES LIKE :table');
    $statement->execute([':table' => $table]);
    $cache[$table] = $statement->fetchColumn() !== false;

    return $cache[$table];
}

/**
 * One scan per table returning a short opaque string. Callers only ever compare it for equality —
 * the parts are never parsed, so the exact shape is free to change.
 */
function changes_table_revision(PDO $pdo, array $config): string
{
    // Topics overlap (payroll and payslip read the same table), so scan each table at most once.
    static $cache = [];
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

/** A topic moves when any of its tables moves, so its revision is just theirs joined together. */
function changes_revision(PDO $pdo, array $tableConfigs): string
{
    $parts = [];

    foreach ($tableConfigs as $config) {
        $parts[] = changes_table_revision($pdo, $config);
    }

    return implode('~', $parts);
}

$revisions = [];
foreach (CHANGE_FEED_TOPICS as $topic => $tableConfigs) {
    $revisions[$topic] = changes_revision($pdo, $tableConfigs);
}

json_response([
    'success' => true,
    'revisions' => $revisions,
    'at' => gmdate('c'),
]);
