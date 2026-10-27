<?php
declare(strict_types=1);

// Exercise real loan CRUD and payroll calculations against temporary tables only.
require __DIR__ . '/../database/remove_legacy_loan_columns.php';
function loan_fields_load(string $file, array $names): void
{
    $source = file_get_contents($file);
    foreach ($names as $name) {
        if (!preg_match('/function ' . $name . '\(.*?\n\}/s', $source, $match)) throw new RuntimeException('Missing function: ' . $name);
        eval($match[0]);
    }
}
class LoanFieldsResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
function json_response(array $body, int $status = 200): void { throw new LoanFieldsResponse($body, $status); }
function loan_fields_response(callable $handler): LoanFieldsResponse
{
    try { $handler(); } catch (LoanFieldsResponse $response) { return $response; }
    throw new RuntimeException('Expected API response.');
}
function loan_fields_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
    $GLOBALS['checks'] = ($GLOBALS['checks'] ?? 0) + 1;
}
// Authentication, audit delivery and unrelated catalog provisioning are outside this fixture.
function resolve_loan_employee_id(PDO $pdo, array $body, array $user): int { return $GLOBALS['fixtureEmployeeId']; }
function loan_request_types(PDO $pdo): array { return ['MGB COOP LOAN']; }
function loan_session_employee_scope_id(PDO $pdo, array $user): ?int { return null; }
function loan_can_manage_records(array $user): bool { return true; }
function loan_can_file_for_others(array $user): bool { return true; }
function write_loan_audit(...$args): void {}
function throttle_filing_request(mixed ...$args): void {}
function payroll_ensure_loan_tracking_schema(PDO $pdo): void {}
function payroll_database_table_exists(PDO $pdo, string $table): bool { return $table === 'loan_records'; }
function deduction_catalog_category_for_name(PDO $pdo, string $name): ?string { return 'Other Deductions'; }

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
);
// Directory tables are read only. Temporary loans and payments contain all test writes.
$employeeId = (int)$pdo->query('SELECT id FROM employees ORDER BY id LIMIT 1')->fetchColumn();
if ($employeeId <= 0) throw new RuntimeException('This integration test needs one existing employee.');
$GLOBALS['fixtureEmployeeId'] = $employeeId;
$createSql = $pdo->query('SHOW CREATE TABLE loan_records')->fetch(PDO::FETCH_NUM)[1];
$createSql = preg_replace('/^CREATE TABLE /', 'CREATE TEMPORARY TABLE ', $createSql);
// MySQL temporary tables do not support foreign keys.
$createSql = preg_replace('/,\n\s*CONSTRAINT [^\n]+/', '', $createSql);
$pdo->exec($createSql);
$migration = remove_legacy_loan_columns($pdo, __DIR__ . '/../backups');
try {
    $pdo->exec('CREATE TEMPORARY TABLE loan_payments (
        id INT PRIMARY KEY AUTO_INCREMENT, loan_record_id INT, installment_number INT, amount DECIMAL(12,2), paid_at DATE,
        payment_reference VARCHAR(180) NULL, notes VARCHAR(500) NULL, source VARCHAR(30) DEFAULT "manual", payroll_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )');
    loan_fields_load(__DIR__ . '/../api/loan_request.php', [
        'loan_text', 'loan_decimal', 'loan_term_months', 'loan_monthly_amortization', 'loan_total_payable',
        'loan_date_or_null', 'loan_type', 'loan_type_from_allowed', 'loan_amount_map', 'loan_primary_type', 'loan_total_amount',
        'loan_amount_map_from_record', 'loan_user_display_sql', 'loan_base_select', 'loan_normalize_record',
        'fetch_loan_payments', 'fetch_loan_request', 'validate_loan_payload', 'create_loan_request', 'update_loan_request',
    ]);
    $created = loan_fields_response(fn () => create_loan_request($pdo, [
        'loanType' => 'MGB COOP LOAN', 'loanAmount' => 2000, 'repaymentTerms' => '12 months',
        'annualInterestRate' => 0, 'purpose' => 'Test loan', 'dateFiled' => '2026-10-01',
        'interestMethod' => 'diminishing', 'governmentReferenceNumber' => 'Obsolete client field',
    ], ['id' => 1]));
    loan_fields_expect($created->status === 201, 'new loans save without the removed columns');
    $record = $created->body['record'];
    $id = $record['id'];
    loan_fields_expect($record['monthlyAmortization'] === 166.67 && $record['totalPayable'] === 2000.0, 'existing interest-free calculations stay the same');
    loan_fields_expect(!array_key_exists('interestMethod', $record) && !array_key_exists('governmentReferenceNumber', $record), 'removed fields are absent from API records');
    $updated = loan_fields_response(fn () => update_loan_request($pdo, [
        'id' => $id, 'loanAmount' => 2400, 'loanAmounts' => ['MGB COOP LOAN' => 2400],
        'annualInterestRate' => 12, 'repaymentTerms' => '12 months',
    ], ['id' => 1]));
    loan_fields_expect($updated->status === 200 && $updated->body['record']['monthlyAmortization'] === 224.0, 'edits use the flat-rate formula without a method column');
    loan_fields_expect($updated->body['record']['totalPayable'] === 2688.0, 'annual interest and loan total remain correct');

    loan_fields_load(__DIR__ . '/../api/payroll.php', [
        'payroll_text', 'payroll_decimal', 'payroll_loan_monthly_amount', 'payroll_normalize_deduction_key',
        'payroll_is_regular_employment_status', 'payroll_extract_repayment_months', 'payroll_deduction_frequency_factor',
        'payroll_log_deduction_debug', 'payroll_fetch_approved_loan_deduction_items',
    ]);
    $pdo->exec("UPDATE loan_records SET status = 'Approved', disbursed_at = '2026-10-01' WHERE id = " . $id);
    $monthly = payroll_fetch_approved_loan_deduction_items($pdo, $employeeId, '2026-10-31', 'Monthly', 'Regular');
    loan_fields_expect(count($monthly) === 1 && $monthly[0]['amount'] === 224.0, 'payroll collects the same monthly amount as the loan API');
    $half = payroll_fetch_approved_loan_deduction_items($pdo, $employeeId, '2026-10-31', '1st Half', 'Regular');
    loan_fields_expect($half[0]['amount'] === 112.0, 'half-month payroll still splits the deduction');
    $insert = $pdo->prepare("INSERT INTO loan_payments (loan_record_id, installment_number, amount, paid_at) VALUES (:id, 1, 2678, '2026-10-15')");
    $insert->execute([':id' => $id]);
    $capped = payroll_fetch_approved_loan_deduction_items($pdo, $employeeId, '2026-10-31', 'Monthly', 'Regular');
    loan_fields_expect($capped[0]['amount'] === 10.0, 'final deduction is capped at the outstanding balance');
    loan_fields_expect(fetch_loan_request($pdo, $id, null, true)['outstandingAmount'] === 10.0, 'loan details still read payment records');
    echo 'PASS: ' . $GLOBALS['checks'] . ' loan API and payroll checks. Temporary tables only.' . PHP_EOL;
} finally {
    if (isset($migration['backupPath'])) unlink($migration['backupPath']);
}
