<?php
declare(strict_types=1);
require __DIR__ . '/../api/deduction-catalog.php';
require __DIR__ . '/../api/payslip-deductions.php';
require __DIR__ . '/../api/report-payroll-deductions.php';

if (count(REPORT_PAYROLL_DEDUCTIONS) !== 41) throw new RuntimeException('Expected all 41 deduction columns.');
$row = report_payroll_deduction_totals([
    ['name' => 'MPL', 'category' => 'GSIS', 'amount' => 110],
    ['name' => 'MPL', 'category' => 'Pag-IBIG', 'amount' => 220],
    ['name' => 'PAG-IBIG MPL', 'category' => 'Pag-IBIG', 'amount' => 330],
    ['name' => 'PHIC', 'category' => 'PHIC', 'amount' => 440],
    ['name' => 'PhilHealth', 'category' => 'PHIC', 'amount' => 50],
    ['name' => 'PhilHealth Differential', 'category' => 'PHIC', 'amount' => 60],
    ['name' => 'Modified Pag-IBIG II (MP2)', 'category' => 'Pag-IBIG', 'amount' => 70],
    ['name' => 'MP2', 'category' => 'Pag-IBIG', 'amount' => 80],
    ['name' => 'Pass Slip', 'category' => 'Attendance Deductions', 'amount' => 90],
]);
foreach (['mpl' => 110, 'pagibig_loans_mpl' => 220, 'pag_ibig_mpl' => 330, 'phic' => 490,
    'philhealth_differential' => 60, 'modified_pag_ibig_ii_mp2' => 70, 'mp2' => 80, 'pass_slip' => 90,
    'pension_loan' => 0] as $code => $expected) {
    if ($row['amount_' . $code] !== (float)$expected) throw new RuntimeException('Incorrect total for ' . $code);
}
if ($row['totalAmount'] !== 1450.0) throw new RuntimeException('Total was duplicated or dropped.');
echo "PASS: All 41 ordered columns, separate MPL and MP2 totals, aliases, pass slips, zero amounts, and aggregate total.\n";
