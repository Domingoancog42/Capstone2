<?php
declare(strict_types=1);

/**
 * The deduction lines a payslip prints, and how catalog deductions fold onto them.
 *
 * Two places read this: the payslip itself, and the Deduction Distribution chart in Reports &
 * Analytics. The chart lists the same lines the payslip does, so a deduction an employee can see on
 * their payslip is never missing from the report.
 *
 * `aliases` exist because the catalog names a deduction the way Settings does — "GSIS", "HDMF",
 * "PHIC" — while the payslip prints the government's wording: "GSIS Premium", "PAG-IBIG Premium",
 * "PhilHealth Premium". Every alias folds into the line that prints it.
 *
 * The on-screen preview keeps a mirror of this roster in src/module/payroll/PayslipWorkspace.jsx;
 * the two have to stay in step.
 */

const PAYSLIP_DEDUCTION_ROWS = [
    ['label' => 'GSIS Premium', 'aliases' => ['GSIS', 'GSIS Premium']],
    ['label' => 'PAG-IBIG Premium', 'aliases' => ['HDMF', 'Pag-IBIG', 'PAG-IBIG', 'PAG-IBIG Premium']],
    ['label' => 'PAG-IBIG MP2', 'aliases' => ['PAG-IBIG MP2', 'Pag-IBIG MP2', 'MP2']],
    ['label' => 'PhilHealth Premium', 'aliases' => ['PHIC', 'PhilHealth', 'PHILHEALTH', 'PhilHealth Premium']],
    ['label' => 'Deduction from Previous Payroll', 'aliases' => ['Deduction from Previous Payroll', 'DEDUCTION PREVIOUS PAYROLL']],
    ['label' => 'Withholding Tax', 'aliases' => ['Withholding Tax', 'W-TAX', 'Tax']],
    ['label' => 'Additional Withholding Tax (PBB 2020)', 'aliases' => ['Additional Withholding Tax (PBB 2020)']],
    ['label' => 'Leave Without Pay (LWOP)', 'aliases' => ['Leave Without Pay (LWOP)', 'LWOP', 'Absence Deduction']],
    ['label' => 'GSIS Consolidated Loan', 'aliases' => ['GSIS CONSO LOAN', 'GSIS Consolidated Loan', 'Conso Loan']],
    ['label' => 'GSIS Policy Loan', 'aliases' => ['GSIS POLICY LOAN', 'GSIS Policy Loan', 'Policy Loan']],
    ['label' => 'GSIS Emergency Loan', 'aliases' => ['GSIS EMERGENCY LOAN', 'GSIS Emergency Loan', 'Emergency Loan']],
    ['label' => 'GSIS UOLI 1', 'aliases' => ['GSIS UOLI (1)', 'GSIS UOLI 1', 'UOLI 1']],
    ['label' => 'GSIS UOLI 2', 'aliases' => ['GSIS UOLI (2)', 'GSIS UOLI 2', 'UOLI 2']],
    ['label' => 'GSIS UOLI 1 Loan', 'aliases' => ['GSIS UOLI LOAN (1)', 'GSIS UOLI 1 Loan', 'UOLI Loan 1']],
    ['label' => 'GSIS UOLI 2 Loan', 'aliases' => ['GSIS UOLI LOAN (2)', 'GSIS UOLI 2 Loan', 'UOLI Loan 2']],
    ['label' => 'GSIS Housing Loan', 'aliases' => ['GSIS HOUSING LOAN', 'GSIS Housing Loan', 'Housing Loan']],
    ['label' => 'GSIS Educational Loan', 'aliases' => ['GSIS EDUCATIONAL LOAN', 'GSIS Educational Loan', 'Educational Loan']],
    ['label' => 'GSIS GFAL', 'aliases' => ['GSIS GFAL', 'GFAL']],
    ['label' => 'GSIS Computer Loan', 'aliases' => ['GSIS Computer Loan', 'Computer Loan']],
    ['label' => 'GSIS MPL', 'aliases' => ['GSIS MPL', 'MPL']],
    ['label' => 'GSIS MPL Lite', 'aliases' => ['GSIS MPL Lite', 'MPL Lite']],
    ['label' => 'PAG-IBIG Housing Loan', 'aliases' => ['PAG-IBIG HOUSING LOAN', 'Pag-IBIG Housing Loan']],
    ['label' => 'PAG-IBIG MPL', 'aliases' => ['PAG-IBIG MPL', 'Pag-IBIG MPL']],
    ['label' => 'PAG-IBIG Home Equity Appreciation Loan (HEAL)', 'aliases' => ['PAG-IBIG Home Equity Appreciation Loan (HEAL)', 'HEAL']],
    ['label' => 'LBP Loan', 'aliases' => ['LBP Loan', 'LBP Salary Loan', 'Landbank Salary Loan']],
    ['label' => 'Disallowance (COLA)', 'aliases' => ['Disallowance (COLA)', 'COLA DISALLOWANCE']],
    ['label' => 'Disallowance (PRAISE)', 'aliases' => ['Disallowance (PRAISE)', 'PRAISE DISALLOWANCE']],
    ['label' => 'Disallowance (Maternity Leave)', 'aliases' => ['Disallowance (Maternity Leave)', 'MATERNITY LEAVE DISALLOWANCE']],
    ['label' => 'ENRP MOWEL', 'aliases' => ['ENRP MOWEL']],
    ['label' => 'DBP Salary Loan', 'aliases' => ['DBP Salary Loan', 'DBP SALARY LOAN']],
    ['label' => 'UCPB Salary Loan', 'aliases' => ['UCPB Salary Loan', 'UCPB SALARY LOAN']],
    ['label' => 'MGBEA-X', 'aliases' => ['MGBEA-X', 'MGBBEA- X', 'MG BEA - 10', 'MG BEA', 'MGBEA']],
    ['label' => 'Family Support (w/ Court Order)', 'aliases' => ['Family Support (w/ Court Order)', 'FAMILY SUPPORT(W/ COURT ORDER)']],
];

/** Matching is on letters and digits alone, so "PAG-IBIG MP2" and "Pag-Ibig MP2" are the same line. */
function payslip_deduction_normalize_key(mixed $value): string
{
    return preg_replace('/[^a-z0-9]/', '', strtolower((string)($value ?? ''))) ?? '';
}

function payslip_deduction_amount(mixed $value): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return 0.0;
    }

    return round((float)$value, 2);
}

/** Normalised alias => the payslip line it prints on. Built once per request. */
function payslip_deduction_alias_index(): array
{
    static $index = null;

    if ($index === null) {
        $index = [];

        foreach (PAYSLIP_DEDUCTION_ROWS as $row) {
            foreach ($row['aliases'] as $alias) {
                $index[payslip_deduction_normalize_key($alias)] = $row['label'];
            }
        }
    }

    return $index;
}

/**
 * Folds itemised deductions onto the payslip's lines.
 *
 * Every line on the roster comes back in payslip order, at 0.00 when nothing was charged to it —
 * a payslip lists its full deduction schedule whether or not a given run touched each entry.
 * Deductions the roster has no line for are appended after, and only once something is charged to
 * them, so the catalog's unused entries do not pad the list.
 *
 * Items sharing a line are summed, which is also how two catalog families carrying the same
 * deduction name ("MPL" under both GSIS and Pag-IBIG) end up as one line rather than two identical
 * ones.
 *
 * @param array<int, array{name?: mixed, amount?: mixed}> $items
 * @return array<int, array{label: string, value: float}>
 */
function payslip_deduction_lines(array $items): array
{
    $aliasIndex = payslip_deduction_alias_index();
    $lines = [];

    foreach (PAYSLIP_DEDUCTION_ROWS as $row) {
        $lines[$row['label']] = 0.0;
    }

    foreach ($items as $item) {
        $name = trim((string)($item['name'] ?? ''));
        $amount = payslip_deduction_amount($item['amount'] ?? 0);
        $label = $aliasIndex[payslip_deduction_normalize_key($name)] ?? null;

        if ($label === null) {
            if ($amount <= 0) {
                continue;
            }

            $label = $name !== '' ? $name : 'Other Deduction';
        }

        $lines[$label] = ($lines[$label] ?? 0.0) + $amount;
    }

    $rows = [];
    foreach ($lines as $label => $value) {
        // Labels are array keys above, and PHP casts a numeric-string key to int — cast back.
        $rows[] = ['label' => (string)$label, 'value' => round($value, 2)];
    }

    return $rows;
}
