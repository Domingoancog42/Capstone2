<?php
declare(strict_types=1);

// Load the calculation functions without executing the authenticated API router.
$source = file_get_contents(__DIR__ . '/../api/payroll.php');
foreach (['PAYROLL_TYPE_SALARY', 'PAYROLL_ALLOWED_TYPES'] as $name) {
    preg_match('/const ' . $name . ' = .*?;/s', $source, $match);
    eval($match[0]);
}
foreach (['payroll_text', 'payroll_normalize_type', 'payroll_decimal', 'payroll_pera_amount', 'payroll_period_basic_salary', 'payroll_calculate_totals'] as $name) {
    preg_match('/function ' . $name . '\(.*?\n\}/s', $source, $match);
    eval($match[0]);
}

$payload = array_fill_keys([
    'overtimePay', 'pera', 'travelAllowance', 'salaryAdjustment', 'otherAllowances', 'bonusAmount',
    'lateDeduction', 'absenceDeduction', 'undertimeDeduction', 'withholdingTax', 'gsis', 'hdmf',
    'phic', 'manualCashAdvanceAdjustment', 'laptopLoan', 'otherDeductions',
], 0.0);
$payload['payrollType'] = 'Salary';
$payload['travelAllowance'] = 100.0;
$payload['laptopLoan'] = 50.0;
foreach (['1st Half' => 15000.01, '2nd Half' => 15000.0, 'Monthly' => 30000.01] as $period => $expected) {
    $totals = payroll_calculate_totals($payload + ['payPeriod' => $period], ['basicSalary' => 30000.01]);
    if ($totals['basicSalary'] !== $expected || $totals['grossPay'] !== round($expected + 100, 2)
        || $totals['netPay'] !== round($expected + 50, 2)) {
        throw new RuntimeException('Incorrect salary, gross or net for ' . $period);
    }
}
if (payroll_period_basic_salary(30000.01, '1st Half', 'Mid-Year Bonus') !== 30000.01) {
    throw new RuntimeException('Bonus salary basis changed.');
}
echo "Payroll salary periods, gross/net totals and cent reconciliation passed.\n";
