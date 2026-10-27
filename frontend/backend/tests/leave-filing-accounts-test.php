<?php
declare(strict_types=1);

// Run the real filing handler and credit calculations against temporary copies of leave tables.
// Account/employee lookups are read-only. Notifications and rate-limit counters are disabled.
date_default_timezone_set('Asia/Manila');
function load_leave_test_functions(string $path, ?array $names = null): void
{
    $source = file_get_contents($path);
    preg_match_all('/^function ([a-zA-Z0-9_]+)\(/m', $source, $matches, PREG_OFFSET_CAPTURE);
    foreach ($matches[1] as [$name, $offset]) {
        if (function_exists($name) || ($names !== null && !in_array($name, $names, true))) continue;
        $start = strrpos(substr($source, 0, $offset), 'function ');
        $tokens = token_get_all('<?php ' . substr($source, $start));
        $code = ''; $depth = 0; $opened = false;
        foreach (array_slice($tokens, 1) as $token) {
            $code .= is_array($token) ? $token[1] : $token;
            if ($token === '{') { $depth++; $opened = true; }
            if ($token === '}' && --$depth === 0 && $opened) break;
        }
        eval($code);
    }
    preg_match_all('/^const [A-Z0-9_]+\s*=.*?;/ms', $source, $constants);
    foreach ($constants[0] as $constant) eval($constant);
}
class LeaveTestResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
function json_response(array $body, int $status = 200): void { throw new LeaveTestResponse($body, $status); }
function notify_employee(mixed ...$args): void {}
function notify_roles(mixed ...$args): void {}
function throttle_filing_request(mixed ...$args): void {}
function ensure_role_columns(PDO $pdo): void {}
function ensure_archive_columns(PDO $pdo, string $table): void {}
function database_table_exists(PDO $pdo, string $table): bool
{
    $pdo->query('SHOW COLUMNS FROM `' . $table . '`');
    return true;
}
load_leave_test_functions(__DIR__ . '/../api/connection-pdo.php', [
    'trimmed_text', 'normalize_token', 'normalize_role', 'user_exact_role_key', 'user_role_key',
    'session_employee_record_id', 'employee_role_name_subselect', 'employee_signatory_title',
]);
require __DIR__ . '/../api/leave-credit-utils.php';
load_leave_test_functions(__DIR__ . '/../api/leave_request.php');

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
$users = $pdo->query('SELECT u.id, u.username, u.email, u.status, r.name AS role, r.base_role AS baseRoleKey FROM users u JOIN roles r ON r.id=u.role_id WHERE u.is_archived=0 AND u.status="Active" ORDER BY u.id')->fetchAll();
$tables = ['leave_requests', 'leave_attachments', 'leave_types', 'leave_credits', 'leave_credit_accruals'];
foreach ($tables as $table) {
    $columns = $pdo->query('SHOW COLUMNS FROM `' . $table . '`')->fetchAll();
    $writable = array_column(array_filter($columns, static fn(array $column): bool => !str_contains($column['Extra'], 'GENERATED')), 'Field');
    $list = implode(', ', array_map(static fn(string $column): string => '`' . $column . '`', $writable));
    $rows = $pdo->query("SELECT $list FROM `$table`")->fetchAll(PDO::FETCH_NUM);
    $schema = $pdo->query("SHOW CREATE TABLE `$table`")->fetch()['Create Table'];
    $schema = preg_replace('/^CREATE TABLE /', 'CREATE TEMPORARY TABLE ', $schema);
    // Temporary tables cannot have foreign key constraints; keep all columns and indexes.
    $schema = preg_replace('/^\s*CONSTRAINT .*$/m', '', $schema);
    $schema = preg_replace('/,\s*\) ENGINE/', "\n) ENGINE", $schema);
    $pdo->exec($schema);
    if ($rows !== []) {
        $insert = $pdo->prepare("INSERT INTO `$table` ($list) VALUES (" . implode(',', array_fill(0, count($writable), '?')) . ')');
        $mode = (string)$pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn();
        $pdo->exec('SET SESSION sql_mode = ' . $pdo->quote($mode . ',NO_AUTO_VALUE_ON_ZERO'));
        foreach ($rows as $row) $insert->execute($row);
        $pdo->exec('SET SESSION sql_mode = ' . $pdo->quote($mode));
    }
}
ensure_leave_request_ids($pdo);
$firstEmployee = (int)$pdo->query('SELECT id FROM employees WHERE is_archived=0 ORDER BY id LIMIT 1')->fetchColumn();
$day = new DateTimeImmutable('tomorrow');
while ((int)$day->format('N') > 5) $day = $day->modify('+1 day');
$results = []; $failed = 0;
foreach ($users as $user) {
    // Distinct future working days also avoid overlap if two accounts share an employee.
    do { $day = $day->modify('+1 day'); } while ((int)$day->format('N') > 5);
    $employeeId = user_role_key($user) === 'admin' ? $firstEmployee : session_employee_record_id($pdo, $user);
    if (!$employeeId) { $failed++; echo 'FAIL account ' . $user['id'] . ': no employee record' . PHP_EOL; continue; }
    $body = [
        'employeeRecordId' => $employeeId, 'leaveType' => 'Vacation Leave',
        'startDate' => $day->format('Y-m-d'), 'endDate' => $day->format('Y-m-d'),
        'reason' => 'Isolated filing verification', 'acknowledgeLeaveWithoutPay' => '1',
        'attachmentName' => 'test.pdf', 'attachmentPath' => 'test-only/test.pdf', 'attachmentSize' => 1,
    ];
    try {
        create_leave_request($pdo, $body, $user);
        throw new RuntimeException('Handler returned without a response');
    } catch (LeaveTestResponse $response) {
        $request = $response->body['request'] ?? null;
        if ($response->status !== 201 || !$request || (int)$request['employeeRecordId'] !== $employeeId || (int)$request['id'] <= 0) {
            $failed++; echo 'FAIL account ' . $user['id'] . ': HTTP ' . $response->status . ' ' . $response->getMessage() . PHP_EOL; continue;
        }
        $role = user_role_key($user);
        $status = $pdo->query('SELECT status FROM leave_requests WHERE leave_request_id=' . (int)$request['id'])->fetchColumn();
        $expected = $role === 'regionaldirector' ? 'approved' : ($role === 'hrstaff' ? 'endorsed' : 'pending');
        if ($status !== $expected) throw new RuntimeException('Unexpected initial workflow for ' . $role);
        $results[$user['role']] = ($results[$user['role']] ?? 0) + 1;
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $failed++; echo 'FAIL account ' . $user['id'] . ': ' . $exception->getMessage() . PHP_EOL;
    }
}
foreach ($results as $role => $count) echo "$role: $count account(s) filed successfully" . PHP_EOL;
echo count($users) . ' active accounts checked; ' . $failed . ' failures. Temporary tables only.' . PHP_EOL;
exit($failed > 0 ? 1 : 0);
