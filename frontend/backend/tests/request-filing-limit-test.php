<?php
declare(strict_types=1);

// Real filing handlers and limiter, with connection-local temporary tables only. Authentication,
// employee lookups, balances, QR delivery and response formatting are outside this fixture.
date_default_timezone_set('Asia/Manila');

function filing_test_load(string $file, ?array $names = null): void
{
    $source = file_get_contents(__DIR__ . '/../api/' . $file);
    preg_match_all('/^function ([a-zA-Z0-9_]+)\(/m', $source, $matches, PREG_OFFSET_CAPTURE);
    foreach ($matches[1] as [$name, $offset]) {
        if (function_exists($name) || ($names !== null && !in_array($name, $names, true))) continue;
        $start = strrpos(substr($source, 0, $offset), 'function ');
        $code = ''; $depth = 0; $opened = false;
        foreach (array_slice(token_get_all('<?php ' . substr($source, $start)), 1) as $token) {
            $code .= is_array($token) ? $token[1] : $token;
            if (is_array($token) && in_array($token[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true)) $depth++;
            if ($token === '{') { $depth++; $opened = true; }
            if ($token === '}') { $depth--; if ($opened && $depth === 0) break; }
        }
        eval($code);
    }
    if ($names === null) {
        preg_match_all('/^const [A-Z0-9_]+\s*=.*?;/ms', $source, $constants);
        foreach ($constants[0] as $constant) eval($constant);
    }
}

class FilingTestResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status)
    {
        parent::__construct($body['message'] ?? '');
    }
}
function json_response(array $body, int $status = 200): void { throw new FilingTestResponse($body, $status); }
function filing_response(callable $handler): FilingTestResponse
{
    try { $handler(); } catch (FilingTestResponse $response) { return $response; }
    throw new RuntimeException('Expected API response.');
}
function filing_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
    $GLOBALS['filingChecks'] = ($GLOBALS['filingChecks'] ?? 0) + 1;
}
function get_application_setting(PDO $pdo, string $key, string $fallback = ''): string
{
    return json_encode($GLOBALS['filingSettings']);
}
function user_role_key(array $user): string { return $user['role'] ?? 'employee'; }
function session_employee_record_id(PDO $pdo, array $user): ?int { return $user['employeeRecordId'] ?? 100; }
function resolve_employee_id(PDO $pdo, array $body, array $user): int { return $body['employeeRecordId'] ?? 100; }
function resolve_leave_type_id(PDO $pdo, string $type): int { return 1; }
function leave_duplicate_filing_dates(...$args): array { return []; }
function leave_credit_pay_split(...$args): array { return ['unpaidDays' => 0]; }
function resolve_travel_employee_id(PDO $pdo, array $body, array $user): int { return $body['employeeRecordId'] ?? 100; }
function assert_travel_employee_in_chief_division(...$args): void {}
function resolve_travel_recommender_id(...$args): ?int { return null; }
function travel_read_scopes(...$args): array { return ['employeeId' => null, 'divisionId' => null, 'filedByEmployeeId' => null]; }
function fetch_travel_order(PDO $pdo, int $id, ...$args): array { return ['id' => $id]; }
function resolve_compensatory_employee_id(PDO $pdo, array $body, array $user): int { return $body['employeeRecordId'] ?? 100; }
function assert_compensatory_employee_in_chief_division(...$args): void {}
function compensatory_approval_route_for_employee(...$args): string { return 'standard'; }
function compensatory_credit_balance(...$args): array { return ['available' => 40]; }
function resolve_pass_slip_employee_id(PDO $pdo, array $body, array $user): int { return $body['employeeRecordId'] ?? 100; }
function pass_slip_assign_token(...$args): void {}
function pass_slip_read_scopes(...$args): array { return []; }
function fetch_pass_slip(PDO $pdo, int $id, ...$args): array { return ['id' => $id]; }
function resolve_overtime_employee_ids(...$args): array { return [100]; }
function overtime_table_columns(...$args): array { return []; }
function resolve_overtime_session_employee_id(...$args): int { return 100; }
function resolve_loan_employee_id(PDO $pdo, array $body, array $user): int { return $body['employeeRecordId'] ?? 100; }
function loan_request_types(...$args): array { return ['MGB COOP LOAN']; }
function resolve_monetization_employee_id(PDO $pdo, array $body, array $user): int { return $body['employeeRecordId'] ?? 100; }
function resolve_monetization_leave_type(...$args): array { return ['name' => 'Vacation Leave', 'leave_type_id' => 1]; }
function monetization_available_credits(...$args): array { return ['available' => 40, 'remaining' => 40, 'pending' => 0]; }
function monetization_year_to_date_days(...$args): float { return 0; }
function fetch_monetization_employee(...$args): array { return ['basicSalary' => 30000, 'salaryRate' => 'Monthly']; }

filing_test_load('settings.php', ['boolean_value', 'datetime_timestamp']);
filing_test_load('leave-credit-utils.php', ['leave_credit_round']);
filing_test_load('date-selection-utils.php');
filing_test_load('overtime-accomplishment-utils.php', ['overtime_accomplishment_time_or_null']);
filing_test_load('pass-slip-utils.php');
foreach (['leave_request.php', 'travel_order.php', 'compensatory.php', 'pass_slip.php', 'overtime.php', 'loan_request.php', 'leave_monetization.php'] as $file) {
    filing_test_load($file);
}
require __DIR__ . '/../api/rate-limit.php';
require __DIR__ . '/../api/throttle.php';

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
);
$pdo->exec('CREATE TEMPORARY TABLE rate_limits (
    bucket_key VARCHAR(120) PRIMARY KEY, rule_key VARCHAR(40), identifier VARCHAR(190), hit_count INT,
    window_started_at DATETIME, blocked_until DATETIME NULL, blocked_count INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE travel_orders (
    travel_order_id INT PRIMARY KEY AUTO_INCREMENT, employee_id INT, destination TEXT, purpose TEXT,
    start_date DATE, end_date DATE, assistance_labor TEXT, appropriations TEXT, remarks TEXT,
    recommended_by_employee_id INT NULL, recommended_at DATETIME NULL, filed_by_employee_id INT NULL, status VARCHAR(30)
) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE pass_slip (
    id INT PRIMARY KEY AUTO_INCREMENT, employee_id INT, pass_date DATE, departure_time TIME NULL, time_returned TIME NULL,
    destination TEXT, pass_type VARCHAR(30), expected_minutes INT, purpose TEXT, status VARCHAR(30),
    approved_by INT NULL, decided_at DATETIME NULL
) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE overtime (
    overtime_id INT PRIMARY KEY AUTO_INCREMENT, employee_id INT, work_date DATE, hour_requested DECIMAL(5,2),
    request_date DATETIME, reason TEXT, status VARCHAR(30), duration DECIMAL(5,2), source VARCHAR(30),
    reviewed_by INT NULL, reviewed_at DATETIME NULL, approved_by INT NULL, approved_at DATETIME NULL,
    created_by INT, time_start TIME NULL, time_end TIME NULL, location TEXT, expected_outputs TEXT
) ENGINE=InnoDB');
// Shadow every other table a creation handler could write, even if a regression skips the quota.
foreach (['leave_requests', 'leave_attachments', 'compensatory', 'loan_records', 'leave_monetization_requests'] as $table) {
    $pdo->exec('CREATE TEMPORARY TABLE `' . $table . '` (id INT PRIMARY KEY AUTO_INCREMENT) ENGINE=InnoDB');
}
$_SERVER['REMOTE_ADDR'] = '192.0.2.10';
$GLOBALS['filingSettings'] = rate_limit_default_settings();
$GLOBALS['filingSettings']['auditBlocked'] = false;
$GLOBALS['filingSettings']['rules']['leaveRequest'] = [
    'enabled' => true, 'maxRequests' => 2, 'windowSeconds' => 3600, 'blockSeconds' => 0,
];
rate_limit_settings($pdo, true);
$user = ['id' => 7001, 'role' => 'employee', 'employeeRecordId' => 100];
// The signed-in actor is deliberately different: the helper must use the supplied authenticated user.
$_SESSION['user'] = ['id' => 9999];
$day = new DateTimeImmutable('tomorrow');
while ((int)$day->format('N') > 5) $day = $day->modify('+1 day');
$date = $day->format('Y-m-d');
$cases = [
    'leave' => ['create_leave_request', ['leaveType' => 'Vacation Leave', 'startDate' => $date, 'endDate' => $date, 'reason' => 'Test'], ['leaveType' => '']],
    'travel' => ['create_travel_order', ['destination' => 'Regional Office', 'startDate' => $date, 'endDate' => $date], ['destination' => '']],
    'CTO' => ['create_compensatory', ['hoursApplied' => 8, 'startDate' => $date, 'endDate' => $date], ['hoursApplied' => 0]],
    'pass slip' => ['create_pass_slip', ['passDate' => $date, 'destination' => 'Regional Office'], ['destination' => '']],
    'overtime' => ['create_overtime', ['workDate' => date('Y-m-d'), 'hoursRequested' => 2, 'reason' => 'Test'], ['hoursRequested' => 0]],
    'loan' => ['create_loan_request', ['loanType' => 'MGB COOP LOAN', 'loanAmount' => 1000, 'repaymentTerms' => '12 months'], ['loanAmount' => 0]],
    'monetization' => ['create_leave_monetization', ['numberOfDays' => 10, 'reason' => 'Test'], ['numberOfDays' => 0]],
];

foreach ($cases as $module => [$handler, $body, $invalid]) {
    $response = filing_response(fn () => $handler($pdo, array_replace($body, $invalid), $user));
    filing_expect($response->status === 422, "$module validates before counting");
}
filing_expect((int)$pdo->query('SELECT COUNT(*) FROM rate_limits')->fetchColumn() === 0, 'invalid forms do not spend the allowance');

// Two different modules must spend the same allowance. Filing for somebody else spends the actor's.
foreach (['travel', 'pass slip'] as $module) {
    [$handler, $body] = $cases[$module];
    $response = filing_response(fn () => $handler($pdo, $body, $user));
    filing_expect($response->status === 201, "$module can file within the allowance");
}
$bucket = $pdo->query('SELECT rule_key, identifier, hit_count FROM rate_limits')->fetch();
filing_expect($bucket === ['rule_key' => 'leaveRequest', 'identifier' => 'user:7001', 'hit_count' => 2], 'different modules share the existing account bucket');

foreach ($cases as $module => [$handler, $body]) {
    $response = filing_response(fn () => $handler($pdo, $body + ['employeeRecordId' => 200], $user));
    filing_expect($response->status === 429 && $response->body['reason'] === 'rate_limited', "$module refuses a filing when the combined allowance is spent");
    filing_expect($response->body['retryAfter'] > 0 && $response->body['retryAfter'] <= 3600, "$module reports when the shared allowance resets");
    filing_expect(str_contains($response->getMessage(), 'shared request filing limit'), "$module explains the shared limit");
    filing_expect(!$pdo->inTransaction(), "$module checks before starting a transaction");
}
filing_expect((int)$pdo->query('SELECT COUNT(*) FROM travel_orders')->fetchColumn() === 1, 'refused travel filings are not saved');
filing_expect((int)$pdo->query('SELECT COUNT(*) FROM pass_slip')->fetchColumn() === 1, 'refused pass slips are not saved');
foreach (['leave_requests', 'leave_attachments', 'compensatory', 'overtime', 'loan_records', 'leave_monetization_requests'] as $table) {
    filing_expect((int)$pdo->query('SELECT COUNT(*) FROM `' . $table . '`')->fetchColumn() === 0, "$table has no refused filings");
}

throttle_filing_request($pdo, ['id' => 7002]);
filing_expect((int)$pdo->query('SELECT COUNT(*) FROM rate_limits')->fetchColumn() === 2, 'another account on the same IP has its own allowance');
$GLOBALS['filingSettings']['trustedIps'] = [$_SERVER['REMOTE_ADDR']];
rate_limit_settings($pdo, true);
throttle_filing_request($pdo, $user);
$GLOBALS['filingSettings']['trustedIps'] = [];
$GLOBALS['filingSettings']['rules']['leaveRequest']['enabled'] = false;
rate_limit_settings($pdo, true);
throttle_filing_request($pdo, $user);
$GLOBALS['filingSettings']['rules']['leaveRequest']['enabled'] = true;
$GLOBALS['filingSettings']['enabled'] = false;
rate_limit_settings($pdo, true);
throttle_filing_request($pdo, $user);
filing_expect(true, 'trusted IP, rule switch and master switch bypass the filing limit');
$GLOBALS['filingSettings']['enabled'] = true;
rate_limit_settings($pdo, true);

$pdo->exec("UPDATE rate_limits SET window_started_at = DATE_SUB(NOW(), INTERVAL 2 HOUR), blocked_until = NULL WHERE identifier = 'user:7001'");
throttle_filing_request($pdo, $user);
filing_expect((int)$pdo->query("SELECT hit_count FROM rate_limits WHERE identifier = 'user:7001'")->fetchColumn() === 1, 'the allowance resets after the configured period');
$normalized = rate_limit_normalize_payload($GLOBALS['filingSettings']);
filing_expect($normalized['errors'] === [] && $normalized['settings']['rules']['leaveRequest'] === $GLOBALS['filingSettings']['rules']['leaveRequest'], 'existing saved limit and reset period are preserved');
filing_expect(rate_limit_rule_definitions()['leaveRequest']['label'] === 'Request Filing Limit', 'admin settings show the generalized label');

echo $GLOBALS['filingChecks'] . " checks passed: shared allowance, all seven filing handlers, validation, account isolation, resets and settings. Temporary tables only.\n";
