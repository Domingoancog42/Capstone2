<?php
declare(strict_types=1);

/** Ordered report columns. Family distinguishes the two catalog deductions named MPL. */
const REPORT_PAYROLL_DEDUCTIONS = [
    ['modified_pag_ibig_ii_mp2', 'Modified Pag-IBIG II (MP2)', 'pagibig', []],
    ['philhealth_differential', 'PhilHealth Differential', 'phic', []],
    ['mgb_coop_loan', 'MGB Coop Loan', 'other', ['MGB Cooperative Loan']],
    ['phic', 'PHIC', 'phic', ['PhilHealth', 'PhilHealth Premium']],
    ['l_r', 'L&R', 'gsis', []],
    ['emergency_loan', 'Emergency Loan', 'gsis', ['GSIS Emergency Loan']],
    ['policy_loan', 'Policy Loan', 'gsis', ['GSIS Policy Loan']],
    ['gfal', 'GFAL', 'gsis', ['GSIS GFAL']],
    ['mpl', 'MPL', 'gsis', ['GSIS MPL']],
    ['mpl_lite', 'MPL Lite', 'gsis', ['GSIS MPL Lite']],
    ['cpl', 'CPL', 'gsis', []],
    ['premium', 'Premium', 'pagibig', ['PAG-IBIG Premium']],
    ['pagibig_loans_mpl', 'MPL', 'pagibig', ['Pag-IBIG Loans MPL']],
    ['calamity_loan', 'Calamity Loan', 'pagibig', ['PAG-IBIG Calamity Loan']],
    ['housing_loan', 'Housing Loan', 'pagibig', ['PAG-IBIG Housing Loan']],
    ['mp2', 'MP2', 'pagibig', ['PAG-IBIG MP2']],
    ['pag_ibig_mpl', 'PAG-IBIG MPL', 'pagibig', []],
    ['pag_ibig_home_equity_appreciation_loan_heal', 'PAG-IBIG Home Equity Appreciation Loan (HEAL)', 'pagibig', ['HEAL']],
    ['lbp_loan', 'LBP Loan', 'other', ['LBP Salary Loan']],
    ['disallowance_cola', 'Disallowance (COLA)', 'other', []],
    ['disallowance_praise', 'Disallowance (PRAISE)', 'other', []],
    ['disallowance_maternity_leave', 'Disallowance (Maternity Leave)', 'other', []],
    ['enrp_mowel', 'ENRP MOWEL', 'other', []],
    ['dbp_salary_loan', 'DBP Salary Loan', 'other', []],
    ['ucpb_salary_loan', 'UCPB Salary Loan', 'other', []],
    ['mgbea_x', 'MGBEA-X', 'other', []],
    ['family_support_w_court_order', 'Family Support (w/ Court Order)', 'other', []],
    ['withholding_tax', 'Withholding Tax', 'tax', ['W-TAX', 'Tax']],
    ['gsis', 'GSIS', 'gsis', ['GSIS Premium']],
    ['hdmf', 'HDMF', 'pagibig', ['Pag-IBIG']],
    ['late_deduction', 'Late Deduction', 'attendance', ['Late/UT']],
    ['absence_deduction', 'Absence Deduction', 'attendance', ['Leave Without Pay (LWOP)', 'LWOP']],
    ['undertime_deduction', 'Undertime Deduction', 'attendance', []],
    ['pass_slip', 'Pass Slip', 'attendance', ['Pass Slip Deduction']],
    ['manual_cash_advance_adjustment', 'Manual Cash Advance Adjustment', 'other', []],
    ['laptop_loan', 'Laptop Loan', 'other', []],
    ['other_deductions', 'Other Deductions', 'other', []],
    ['custom_deduction', 'Custom Deduction', 'other', []],
    ['consolidated_loan', 'Consolidated Loan', 'other', []],
    ['salary_loan', 'Salary Loan', 'other', []],
    ['pension_loan', 'Pension Loan', 'other', []],
];

function report_payroll_deduction_key(array $item): ?string
{
    $name = payslip_deduction_normalize_key($item['name'] ?? '');
    $family = deduction_family_key_for_name((string)($item['category'] ?? ''));
    foreach (REPORT_PAYROLL_DEDUCTIONS as [$code, $label, $rowFamily, $aliases]) {
        // Only the duplicate MPL label needs a family constraint. Historical category
        // labels for other deductions may differ from today's catalog.
        if ($name === 'mpl' && $rowFamily !== $family) continue;
        foreach (array_merge([$label], $aliases) as $alias) {
            if ($name === payslip_deduction_normalize_key($alias)) return 'amount_' . $code;
        }
    }
    return null;
}

function report_payroll_deduction_totals(array $items): array
{
    $row = ['id' => 'deduction-totals', 'summaryLabel' => 'Total', 'records' => 0, 'totalAmount' => 0.0];
    foreach (REPORT_PAYROLL_DEDUCTIONS as [$code]) $row['amount_' . $code] = 0.0;
    foreach ($items as $item) {
        $key = report_payroll_deduction_key($item);
        if ($key === null) continue;
        $amount = round((float)($item['amount'] ?? 0), 2);
        $row[$key] = round($row[$key] + $amount, 2);
        $row['totalAmount'] = round($row['totalAmount'] + $amount, 2);
        $row['records']++;
    }
    return $row;
}
