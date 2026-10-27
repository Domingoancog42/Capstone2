<?php
declare(strict_types=1);

// Run the production SQL against an isolated in-memory database by default.
// With a MySQL test DSN, the temporary table shadows the application table.
function load_leave_type_test_function(string $path, string $name): void
{
    $source = file_get_contents($path);
    $start = strpos($source, 'function ' . $name . '(');
    if ($start === false) throw new RuntimeException('Missing function: ' . $name);
    $code = ''; $depth = 0; $opened = false;
    foreach (array_slice(token_get_all('<?php ' . substr($source, $start)), 1) as $token) {
        $code .= is_array($token) ? $token[1] : $token;
        if ($token === '{') { $depth++; $opened = true; }
        if ($token === '}' && --$depth === 0 && $opened) break;
    }
    eval($code);
}

class LeaveTypeTestResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
function json_response(array $body, int $status = 200): void { throw new LeaveTypeTestResponse($body, $status); }
function list_settings(PDO $pdo): void { json_response(['success' => true, 'leaveTypes' => settings_leave_types($pdo)]); }
function leave_type_test_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
}
function leave_type_test_response(callable $handler): LeaveTypeTestResponse
{
    try { $handler(); } catch (LeaveTypeTestResponse $response) { return $response; }
    throw new RuntimeException('Handler returned without a response.');
}

foreach (['normalize_token', 'normalize_role', 'user_exact_role_key', 'user_role_key'] as $name) {
    load_leave_type_test_function(__DIR__ . '/../api/connection-pdo.php', $name);
}
foreach (['settings_require_admin', 'settings_leave_types', 'settings_update_leave_type_status'] as $name) {
    load_leave_type_test_function(__DIR__ . '/../api/settings.php', $name);
}
foreach (['leave_text', 'list_leave_types', 'resolve_leave_type_id'] as $name) {
    load_leave_type_test_function(__DIR__ . '/../api/leave_request.php', $name);
}

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'sqlite::memory:',
    getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
$pdo->exec('CREATE TEMPORARY TABLE leave_types (
    leave_type_id INT PRIMARY KEY, name VARCHAR(100), code VARCHAR(20), description TEXT,
    max_days_per_year DECIMAL(5,2), is_with_pay TINYINT DEFAULT 1, requires_approval TINYINT DEFAULT 1,
    requires_attachment TINYINT DEFAULT 0, is_active TINYINT DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)');
$pdo->exec("INSERT INTO leave_types (leave_type_id, name, code) VALUES
    (1, 'Vacation Leave', 'VL'), (2, 'Sick Leave', 'SL'), (3, 'Wellness Leave', 'WL')");
$admin = ['role' => 'Admin'];

foreach ([1 => 'Vacation Leave', 3 => 'Wellness Leave'] as $id => $name) {
    $response = leave_type_test_response(fn() => settings_update_leave_type_status($pdo, $admin, ['id' => $id, 'isActive' => 0]));
    leave_type_test_expect($response->status === 200 && count($response->body['leaveTypes']) === 3, 'settings retains inactive rows for reactivation');
    $listed = leave_type_test_response(fn() => list_leave_types($pdo));
    leave_type_test_expect(!in_array($name, array_column($listed->body['leaveTypes'], 'name'), true), 'inactive type is hidden from forms');
    $rejected = leave_type_test_response(fn() => resolve_leave_type_id($pdo, $name));
    leave_type_test_expect($rejected->status === 422, 'a stale filing cannot use or recreate an inactive type');
    leave_type_test_expect((int)$pdo->query('SELECT COUNT(*) FROM leave_types')->fetchColumn() === 3, 'rejected filing never inserts a duplicate type');

    $response = leave_type_test_response(fn() => settings_update_leave_type_status($pdo, $admin, ['id' => $id, 'isActive' => 1]));
    $listed = leave_type_test_response(fn() => list_leave_types($pdo));
    leave_type_test_expect($response->status === 200 && in_array($name, array_column($listed->body['leaveTypes'], 'name'), true), 'reactivated type returns to forms');
    leave_type_test_expect(resolve_leave_type_id($pdo, $name) === $id, 'active filing uses the original row');
}

$response = leave_type_test_response(fn() => settings_update_leave_type_status($pdo, ['role' => 'Employee'], ['id' => 1, 'isActive' => 0]));
leave_type_test_expect($response->status === 403 && resolve_leave_type_id($pdo, 'Vacation Leave') === 1, 'non-admin cannot change the status');
foreach ([['id' => 1], ['isActive' => 0], ['id' => -1, 'isActive' => 0], ['id' => 1, 'isActive' => 'invalid']] as $body) {
    $response = leave_type_test_response(fn() => settings_update_leave_type_status($pdo, $admin, $body));
    leave_type_test_expect($response->status === 422, 'malformed update is rejected');
}
$response = leave_type_test_response(fn() => settings_update_leave_type_status($pdo, $admin, ['id' => 99, 'isActive' => 0]));
leave_type_test_expect($response->status === 404, 'missing type is rejected');
$response = leave_type_test_response(fn() => resolve_leave_type_id($pdo, 'Unconfigured Leave'));
leave_type_test_expect($response->status === 422 && count(settings_leave_types($pdo)) === 3, 'filers cannot create unconfigured types');

echo "Leave type status: deactivate/reactivate, active choices, stale filing rejection, and validation passed.\n";
