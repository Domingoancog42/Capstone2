<?php
declare(strict_types=1);

// Run with PHP CLI against the configured local database. All record writes use
// a connection-local temporary payroll table, never the application's payroll.
function archive_test_load_functions(string $file): void
{
    $source = file_get_contents($file);
    preg_match_all('/^function\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/m', $source, $matches, PREG_OFFSET_CAPTURE);
    foreach ($matches[0] as [$signature, $start]) {
        $end = strpos($source, "\n}", $start);
        eval(substr($source, $start, $end + 2 - $start));
    }
}

archive_test_load_functions(__DIR__ . '/../api/connection-pdo.php');
require __DIR__ . '/../api/deduction-catalog.php';
require __DIR__ . '/../api/payslip-deductions.php';
archive_test_load_functions(__DIR__ . '/../api/payslip.php');
$pdo = new PDO('mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4', 'root', '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);
$pdo->exec('CREATE TEMPORARY TABLE payslip_archive_test LIKE payroll');
$pdo->exec('INSERT INTO payslip_archive_test SELECT * FROM payroll');
$pdo->exec('ALTER TABLE payslip_archive_test RENAME TO payroll');
$pdo->exec("UPDATE payroll SET payslip_is_archived = 0, released_by = NULL, payroll_date = '2099-01-15'");
$ids = $pdo->query("SELECT payroll_id FROM payroll WHERE status = 'Paid' ORDER BY payroll_id LIMIT 2")->fetchAll(PDO::FETCH_COLUMN);
if (count($ids) !== 2) throw new RuntimeException('Two paid records are required for this integration test.');
$before = $pdo->query('SELECT payroll_id,status,gross_pay,total_deduction,net_pay FROM payroll ORDER BY payroll_id')->fetchAll();
$_GET = [];
$active = payslip_fetch_employees($pdo, 'hrstaff', [], false, 0, '2099-01');
if (count($active) < 2) throw new RuntimeException('Active list missing paid records.');
payslip_set_archived($pdo, $ids, true);
foreach (payslip_fetch_employees($pdo, 'hrstaff', [], false, 0, '2099-01') as $row) {
    if (in_array($row['paidPayrollId'], $ids)) throw new RuntimeException('Archived row stayed active.');
}
$_GET = ['archived' => '1'];
$archived = payslip_fetch_employees($pdo, 'hrstaff', [], false, 0, '2099-01');
foreach ($ids as $id) {
    if (!in_array($id, array_column($archived, 'paidPayrollId'))) throw new RuntimeException('Archived list missing record.');
}
if (payslip_fetch_periods($pdo, 'hrstaff', []) === []) throw new RuntimeException('Archived months missing.');
if (count(payslip_fetch_employees($pdo, 'hrstaff', [], false, (int)$ids[0])) !== 1) throw new RuntimeException('Archived detail unreadable.');
try {
    payslip_set_archived($pdo, [$ids[0], 2147483647], false);
    throw new RuntimeException('Invalid batch accepted.');
} catch (InvalidArgumentException $expected) {
}
if ((int)$pdo->query('SELECT payslip_is_archived FROM payroll WHERE payroll_id = ' . (int)$ids[0])->fetchColumn() !== 1) {
    throw new RuntimeException('Invalid batch partially restored.');
}
payslip_set_archived($pdo, [$ids[0]], false);
payslip_set_archived($pdo, [$ids[1]], false);
if ($before !== $pdo->query('SELECT payroll_id,status,gross_pay,total_deduction,net_pay FROM payroll ORDER BY payroll_id')->fetchAll()) {
    throw new RuntimeException('Payroll status or amounts changed.');
}
if (payslip_can_archive('employee') || payslip_can_archive('chief')) throw new RuntimeException('Unauthorized archive allowed.');
$_GET = ['scope' => 'self', 'archived' => '1'];
if (payslip_archive_view() !== 0 || payslip_can_archive('hrstaff')) throw new RuntimeException('Self-service gate failed.');
echo "PASS: Bulk archive, list filters, archived months/detail, single restore, invalid-batch rollback, and role gates.\n";
echo "PASS: Payroll status and amounts preserved. All test mutations used a temporary table.\n";
