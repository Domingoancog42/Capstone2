<?php
declare(strict_types=1);

// Exercise the actual API handler without changing the application's database.
$source = file_get_contents(__DIR__ . '/../api/leave_monetization.php');
function load_api_function(string $source, string $name): void {
    $start = strpos($source, 'function ' . $name . '(');
    if ($start === false) throw new RuntimeException('Missing function: ' . $name);
    $tokens = token_get_all('<?php ' . substr($source, $start));
    $code = ''; $depth = 0; $opened = false;
    foreach (array_slice($tokens, 1) as $token) {
        $text = is_array($token) ? $token[1] : $token;
        $code .= $text;
        if ($token === '{') { $depth++; $opened = true; }
        if ($token === '}' && --$depth === 0 && $opened) break;
    }
    eval($code);
}
foreach (['monetization_text', 'monetization_status_to_database', 'monetization_role_key',
    'monetization_can_manage', 'monetization_is_regional_director', 'update_leave_monetization_status'] as $name) {
    load_api_function($source, $name);
}
require __DIR__ . '/../api/monetization-workflow.php';

class ApiResponse extends RuntimeException {
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
class TestPDO extends PDO {
    public array $current = []; public array $writes = []; public int $deductions = 0;
    public bool $transaction = false; public bool $conflict = false;
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false { return new TestStatement($this, $query); }
    public function beginTransaction(): bool { return $this->transaction = true; }
    public function commit(): bool { $this->transaction = false; return true; }
    public function rollBack(): bool { $this->transaction = false; return true; }
    public function inTransaction(): bool { return $this->transaction; }
}
class TestStatement extends PDOStatement {
    public array $params = [];
    public function __construct(private TestPDO $db, private string $sql) {}
    public function execute(?array $params = null): bool {
        $this->params = $params ?? [];
        if (str_starts_with($this->sql, 'UPDATE')) $this->db->writes = $this->params;
        return true;
    }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed { return $this->db->current; }
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array { return [['id' => 99]]; }
    public function fetchColumn(int $column = 0): mixed {
        if (isset($this->params[':role_name'])) return ($GLOBALS['applicantRole'] ?? '') === $this->params[':role_name'];
        return $GLOBALS['sameDivision'] ?? true;
    }
    public function rowCount(): int { return $this->db->conflict ? 0 : 1; }
}
function user_role_key(array $user): string { return $user['role']; }
function user_has_permission(array $user, string $module, string $action): bool { return $user['permission'] ?? true; }
function session_employee_record_id(PDO $pdo, array $user): ?int { return $user['employee_id'] ?? 20; }
function ensure_role_columns(PDO $pdo): void {}
function json_response(array $body, int $status = 200): void { throw new ApiResponse($body, $status); }
function leave_credit_tracked_type_by_id(PDO $pdo, int $id): array { return ['leave_type_id' => 1, 'code' => 'VL', 'name' => 'Vacation Leave']; }
function monetization_available_credits(PDO $pdo, int $id, array $type, ?int $exclude = null): array { return ['remaining' => $GLOBALS['balance'] ?? 30]; }
function leave_credit_format_days(float $days): string { return (string)$days; }
function require_approval_captcha(array $body, string $module, int $id): void { if (!($body['captcha'] ?? false)) json_response(['message' => 'Captcha required'], 422); }
function deduct_monetized_leave_credits(PDO $pdo, mixed ...$args): void { $pdo->deductions++; }
function notify_employee(mixed ...$args): void {}
function notify_roles(mixed ...$args): void {}
function notify_users(mixed ...$args): void {}
function fetch_leave_monetization(PDO $pdo, int $id, ?int $scope = null): array { return $pdo->writes; }

function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function run_case(string $stage, string $role, string $action = 'Approved', array $userExtra = [], bool $captcha = true, bool $conflict = false): array {
    $db = new TestPDO();
    $db->current = ['employee_id' => 10, 'leave_type_id' => 1, 'number_of_days' => 10, 'date_filed' => '2026-10-08', 'status' => $stage];
    $db->conflict = $conflict;
    try {
        update_leave_monetization_status($db, ['id' => 1, 'status' => $action, 'rejectedNote' => 'Reason', 'captcha' => $captcha], array_merge(['role' => $role], $userExtra));
    } catch (ApiResponse $response) { return [$db, $response->status]; }
    catch (RuntimeException $exception) { if (!$conflict) throw $exception; return [$db, 409]; }
    throw new RuntimeException('Missing response');
}
$roles = ['hrstaff', 'hrhead', 'chief', 'regionaldirector'];
foreach (MONETIZATION_APPROVAL_CHAIN as $stage => $desk) {
    foreach ($roles as $role) {
        [$db, $code] = run_case($stage, $role);
        check($code === ($role === $desk['role'] ? 200 : 403), "$role at $stage");
        if ($code === 200) {
            check($db->writes[':status'] === $desk['next'], 'Cannot skip approval stages');
            check($db->deductions === ($desk['next'] === 'approved' ? 1 : 0), 'Deduct only at final approval');
        }
    }
    [$db, $code] = run_case($stage, $desk['role'], 'Rejected');
    check($code === 200 && $db->deductions === 0, 'Stage rejection');
    [$db, $code] = run_case($stage, $desk['role'], 'Approved', ['employee_id' => 10]);
    check($code === 403 && $db->writes === [], 'Prevent own approval');
    [$db, $code] = run_case($stage, $desk['role'], 'Approved', [], false);
    check($code === 422 && $db->writes === [], 'Require captcha before writing');
}
$applicantRole = 'hrhead'; [$db, $code] = run_case('pending', 'hrstaff');
check($db->writes[':status'] === 'reviewed' && $db->writes[':reviewed_by_employee_id'] === null, 'HR Head applicant skips own desk');
$applicantRole = 'chief'; [$db, $code] = run_case('endorsed', 'hrhead');
check($db->writes[':status'] === 'chief_reviewed', 'Chief applicant skips own desk');
$applicantRole = ''; $sameDivision = false; [$db, $code] = run_case('reviewed', 'chief');
check($code === 404 && $db->writes === [], 'Chief division restriction');
$sameDivision = true; $balance = 5; [$db, $code] = run_case('chief_reviewed', 'regionaldirector');
check($code === 422 && $db->deductions === 0, 'Insufficient credits');
$balance = 30; [$db, $code] = run_case('chief_reviewed', 'regionaldirector', 'Approved', [], true, true);
check($code === 409 && $db->deductions === 0 && !$db->inTransaction(), 'Concurrent update rolls back');
foreach (['approved', 'rejected', 'cancelled'] as $stage) {
    [$db, $code] = run_case($stage, 'admin');
    check($code !== 200 && $db->writes === [], 'Completed requests cannot be reopened');
}
echo "Monetization API workflow checks passed.\n";
