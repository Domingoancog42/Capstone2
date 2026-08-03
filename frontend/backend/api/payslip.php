<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/deduction-catalog.php';

$sessionUser = require_session_user();
$roleKey = hris_user_role_key($sessionUser);

if (!in_array($roleKey, ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'employee'], true)) {
    json_response([
        'success' => false,
        'message' => 'You are not allowed to view payslip data.',
    ], 403);
}

require_method('GET');

const PAYSLIP_DEFAULT_PERA_AMOUNT = 2000.0;
const PAYSLIP_OFFICE = 'Mines and Geosciences Bureau, Regional Office No. X';
const PAYSLIP_SIGNATORY_NAME = 'DULCE A. GUALBERTO';
const PAYSLIP_SIGNATORY_TITLE = 'Administrative Officer IV/OIC, Finance Section';

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

function payslip_decimal_string(mixed $value): string
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return '0.00';
    }

    return number_format((float)$value, 2, '.', '');
}

function payslip_lookup_allowance_amount(PDO $pdo, string $allowanceName, float $fallback = 0.0): string
{
    $statement = $pdo->prepare(
        'SELECT amount
         FROM Allowance
         WHERE allowance_name = :allowance_name
         ORDER BY allowance_id DESC
         LIMIT 1'
    );
    $statement->execute([':allowance_name' => $allowanceName]);
    $amount = $statement->fetchColumn();

    if ($amount === false || !is_numeric($amount)) {
        return payslip_decimal_string($fallback);
    }

    return payslip_decimal_string($amount);
}

function payslip_decode_meta(mixed $value): array
{
    if (!is_string($value) || trim($value) === '') {
        return [];
    }

    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : [];
}

function payslip_amount(mixed $value): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return 0.0;
    }

    return round((float)$value, 2);
}

function payslip_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function payslip_fetch_allowances(PDO $pdo, int $payrollId, array $meta = []): array
{
    if (isset($meta['allowanceItems']) && is_array($meta['allowanceItems'])) {
        return array_values(array_filter(
            array_map(
                static fn (array $item): array => [
                    'name' => payslip_text($item['name'] ?? ''),
                    'amount' => payslip_amount($item['amount'] ?? 0),
                ],
                $meta['allowanceItems']
            ),
            static fn (array $item): bool => $item['name'] !== ''
        ));
    }

    if (
        $payrollId <= 0
        || !hris_database_table_exists($pdo, 'PayrollAllowance')
        || !hris_database_table_exists($pdo, 'Allowance')
    ) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT a.allowance_name AS name, a.amount
         FROM PayrollAllowance pa
         INNER JOIN Allowance a ON a.allowance_id = pa.allowance_id
         WHERE pa.payroll_id = :payroll_id
         ORDER BY pa.payroll_allowance_id ASC'
    );
    $statement->execute([':payroll_id' => $payrollId]);

    return array_map(
        static fn (array $item): array => [
            'name' => payslip_text($item['name'] ?? ''),
            'amount' => payslip_amount($item['amount'] ?? 0),
        ],
        $statement->fetchAll()
    );
}

function payslip_fetch_deductions(PDO $pdo, int $payrollId): array
{
    if ($payrollId <= 0 || !hris_database_table_exists($pdo, 'PayrollDeduction')) {
        return [];
    }

    // The catalog is six family tables joined as one; deduction_catalog_type_union_sql() presents
    // them under the column names this query was written against.
    $amountExpression = hris_database_column_exists($pdo, 'PayrollDeduction', 'amount')
        ? 'COALESCE(pd.amount, dt.default_amount, 0.00)'
        : 'dt.default_amount';
    $typeUnion = deduction_catalog_type_union_sql();
    $statement = $pdo->prepare(
        "SELECT dt.deduction_name AS name, dt.category_name AS category, {$amountExpression} AS amount
         FROM PayrollDeduction pd
         INNER JOIN {$typeUnion} dt ON dt.deduction_type_id = pd.deduction_type_id
         WHERE pd.payroll_id = :payroll_id
         ORDER BY pd.payroll_deduction_id ASC"
    );
    $statement->execute([':payroll_id' => $payrollId]);

    return array_map(
        static fn (array $item): array => [
            'name' => payslip_text($item['name'] ?? ''),
            'category' => payslip_text($item['category'] ?? ''),
            'amount' => payslip_amount($item['amount'] ?? 0),
        ],
        $statement->fetchAll()
    );
}

function payslip_meta_number(array $meta, string $key): float
{
    return payslip_amount($meta[$key] ?? 0);
}

function payslip_meta_integer(array $meta, string $key): int
{
    $value = $meta[$key] ?? 0;
    return is_numeric($value) ? (int)$value : 0;
}

function payslip_normalize_employment_type(mixed $value): string
{
    $normalized = strtolower(payslip_text($value));

    if ($normalized === 'contractual') {
        return 'Contractual';
    }

    if ($normalized === 'regular') {
        return 'Regular';
    }

    return payslip_text($value);
}

function payslip_parse_id_list(mixed $value): array
{
    if (!is_string($value) || trim($value) === '') {
        return [];
    }

    $ids = [];
    foreach (explode(',', $value) as $item) {
        $id = (int)trim($item);
        if ($id > 0) {
            $ids[$id] = true;
        }
    }

    return array_keys($ids);
}

function payslip_date_key(mixed $value): string
{
    $text = payslip_text($value);
    if ($text === '') {
        return '';
    }

    if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $text, $matches) === 1) {
        return $matches[1];
    }

    $timestamp = strtotime($text);
    return $timestamp === false ? '' : date('Y-m-d', $timestamp);
}

function payslip_matches_filters(array $employee, array $filters): bool
{
    $employeeIds = $filters['employeeIds'] ?? [];
    if ($employeeIds !== [] && !in_array((int)($employee['id'] ?? 0), $employeeIds, true)) {
        return false;
    }

    $employeeId = strtolower(payslip_text($filters['employeeId'] ?? ''));
    if ($employeeId !== '') {
        $recordId = strtolower((string)($employee['id'] ?? ''));
        $employeeCode = strtolower(payslip_text($employee['employeeId'] ?? ''));
        if ($recordId !== $employeeId && $employeeCode !== $employeeId) {
            return false;
        }
    }

    $department = strtolower(payslip_text($filters['department'] ?? ''));
    if ($department !== '' && strtolower(payslip_text($employee['department'] ?? '')) !== $department) {
        return false;
    }

    $employmentType = payslip_normalize_employment_type($filters['employmentType'] ?? '');
    if ($employmentType !== '' && payslip_normalize_employment_type($employee['employmentStatus'] ?? '') !== $employmentType) {
        return false;
    }

    $payPeriod = strtolower(payslip_text($filters['payPeriod'] ?? ''));
    if ($payPeriod !== '' && strtolower(payslip_text($employee['payPeriod'] ?? '')) !== $payPeriod) {
        return false;
    }

    $startDate = payslip_date_key($filters['startDate'] ?? '');
    $endDate = payslip_date_key($filters['endDate'] ?? '');
    $employeeStart = payslip_date_key($employee['startDate'] ?? '');
    $employeeEnd = payslip_date_key($employee['endDate'] ?? ($employee['paidPayrollDate'] ?? ''));

    if ($startDate !== '' && $employeeEnd !== '' && $employeeEnd < $startDate) {
        return false;
    }

    if ($endDate !== '' && $employeeStart !== '' && $employeeStart > $endDate) {
        return false;
    }

    return true;
}

function payslip_read_filters(): array
{
    return [
        'employeeId' => $_GET['employee_id'] ?? '',
        'employeeIds' => payslip_parse_id_list($_GET['employee_ids'] ?? ''),
        'department' => $_GET['department'] ?? '',
        'employmentType' => $_GET['employment_type'] ?? '',
        'payPeriod' => $_GET['pay_period'] ?? '',
        'startDate' => $_GET['start_date'] ?? '',
        'endDate' => $_GET['end_date'] ?? '',
    ];
}

function payslip_fetch_employees(PDO $pdo, string $roleKey, array $sessionUser): array
{
    $params = [];
    $employeeScopeSql = '';
    $payrollJoinSql = 'LEFT JOIN (
            SELECT p.*
            FROM Payroll p
            INNER JOIN (
                SELECT employee_id, MAX(payroll_id) AS payroll_id
                FROM Payroll
                WHERE status = "Paid"
                GROUP BY employee_id
            ) latest_paid ON latest_paid.payroll_id = p.payroll_id
         ) paid ON paid.employee_id = e.id';
    $orderBySql = 'ORDER BY e.last_name ASC, e.first_name ASC, e.id ASC';

    /*
     * `scope=self` lets any authenticated user retrieve only their own payslip, regardless of their
     * management role. The "My Payslip" self-service page sends this so HR Heads, Regional Directors
     * and other staff roles see only their own record — not every employee's.
     */
    $scopeSelf = strtolower(trim((string)($_GET['scope'] ?? ''))) === 'self';

    if ($roleKey === 'employee' || $scopeSelf) {
        $employeeRecordId = hris_session_employee_record_id($pdo, $sessionUser);

        if ($employeeRecordId === null) {
            json_response([
                'success' => false,
                'message' => 'Signed-in employee record was not found.',
            ], 422);
        }

        $employeeScopeSql = ' AND e.id = :employee_id';
        $params[':employee_id'] = $employeeRecordId;
        $payrollJoinSql = 'INNER JOIN Payroll paid ON paid.employee_id = e.id AND paid.status = "Paid"';
        $orderBySql = 'ORDER BY paid.payroll_date DESC, paid.payroll_id DESC';
    }

    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS fullName,
            d.name AS department,
            des.name AS position,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            e.employment_status AS employmentStatus,
            paid.payroll_id AS paidPayrollId,
            paid.payroll_date AS paidPayrollDate,
            paid.status AS paidPayrollStatus,
            paid.gross_pay AS paidGrossPay,
            paid.total_allowance AS paidTotalAllowance,
            paid.total_deduction AS paidTotalDeduction,
            paid.net_pay AS paidNetPay,
            payroll_meta.setting_value AS paidPayrollMeta
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         ' . $payrollJoinSql . '
         LEFT JOIN settings payroll_meta ON payroll_meta.setting_key = CONCAT("payroll_meta:", paid.payroll_id)
         WHERE e.is_archived = 0' . $employeeScopeSql . '
         ' . $orderBySql
    );
    $statement->execute($params);
    $employees = [];

    foreach ($statement->fetchAll() as $row) {
        $payrollId = (int)($row['paidPayrollId'] ?? 0);
        $meta = payslip_decode_meta($row['paidPayrollMeta'] ?? null);
        unset($row['paidPayrollMeta']);

        $row['salaryRate'] = payslip_text($meta['salaryRate'] ?? $row['salaryRate'] ?? '');
        $row['employmentStatus'] = payslip_normalize_employment_type($meta['employmentType'] ?? $row['employmentStatus'] ?? '');
        $row['paidBasicSalary'] = payslip_amount($meta['basicSalary'] ?? $row['basicSalary'] ?? 0);
        $row['payPeriod'] = payslip_text($meta['payPeriod'] ?? '');
        $row['startDate'] = payslip_text($meta['startDate'] ?? '');
        $row['endDate'] = payslip_text($meta['endDate'] ?? $row['paidPayrollDate'] ?? '');
        $row['periodLabel'] = $row['payPeriod'] !== ''
            ? sprintf('%s (%s to %s)', $row['payPeriod'], $row['startDate'] ?: 'N/A', $row['endDate'] ?: 'N/A')
            : ($row['endDate'] ?: '');
        $row['overtimeHours'] = payslip_meta_number($meta, 'overtimeHours');
        $row['overtimeRate'] = payslip_meta_number($meta, 'overtimeRate');
        $row['hourlyRate'] = payslip_meta_number($meta, 'hourlyRate');
        $row['passSlipHours'] = payslip_meta_number($meta, 'passSlipHours');
        $row['undertimeHours'] = payslip_meta_number($meta, 'undertimeHours');
        $row['lateHours'] = payslip_meta_number($meta, 'lateHours');
        $row['absenceDays'] = payslip_meta_integer($meta, 'absenceDays');
        $row['attendanceRenderedMinutes'] = payslip_meta_integer($meta, 'attendanceRenderedMinutes');
        $row['attendanceLateMinutes'] = payslip_meta_integer($meta, 'attendanceLateMinutes');
        $row['attendanceUndertimeMinutes'] = payslip_meta_integer($meta, 'attendanceUndertimeMinutes');
        $row['attendanceExpectedWorkdays'] = payslip_meta_integer(
            $meta,
            array_key_exists('attendanceExpectedWorkdays', $meta) ? 'attendanceExpectedWorkdays' : 'expectedWorkdays'
        );
        $row['attendanceLeaveDays'] = payslip_meta_integer($meta, 'attendanceLeaveDays');
        $row['hasAttendanceCoverage'] = (bool)($meta['hasAttendanceCoverage'] ?? false);
        $row['withholdingTaxBase'] = payslip_amount($meta['withholdingTaxBase'] ?? $row['paidBasicSalary'] ?? 0);
        $row['overtimePay'] = payslip_amount($meta['overtimePay'] ?? 0);
        $row['sss'] = payslip_amount($meta['sss'] ?? 0);
        $row['allowanceItems'] = payslip_fetch_allowances($pdo, $payrollId, $meta);
        $row['deductionItems'] = payslip_fetch_deductions($pdo, $payrollId);
        $row['isPaid'] = $payrollId > 0 || strtolower(payslip_text($row['paidPayrollStatus'] ?? '')) === 'paid';

        $employees[] = $row;
    }

    return $employees;
}

function payslip_summary(array $employees): array
{
    $summary = [
        'total_employees' => count($employees),
        'total_gross_pay' => 0.0,
        'total_deductions' => 0.0,
        'total_net_pay' => 0.0,
        'average_net_pay' => 0.0,
        'by_employment_type' => [],
    ];

    foreach ($employees as $employee) {
        $type = payslip_normalize_employment_type($employee['employmentStatus'] ?? '') ?: 'Unspecified';
        $grossPay = payslip_amount($employee['paidGrossPay'] ?? 0);
        $deductions = payslip_amount($employee['paidTotalDeduction'] ?? 0);
        $netPay = payslip_amount($employee['paidNetPay'] ?? 0);

        $summary['total_gross_pay'] += $grossPay;
        $summary['total_deductions'] += $deductions;
        $summary['total_net_pay'] += $netPay;

        if (!isset($summary['by_employment_type'][$type])) {
            $summary['by_employment_type'][$type] = [
                'count' => 0,
                'gross_pay' => 0.0,
                'deductions' => 0.0,
                'net_pay' => 0.0,
            ];
        }

        $summary['by_employment_type'][$type]['count']++;
        $summary['by_employment_type'][$type]['gross_pay'] += $grossPay;
        $summary['by_employment_type'][$type]['deductions'] += $deductions;
        $summary['by_employment_type'][$type]['net_pay'] += $netPay;
    }

    if ($summary['total_employees'] > 0) {
        $summary['average_net_pay'] = round($summary['total_net_pay'] / $summary['total_employees'], 2);
    }

    return $summary;
}

function payslip_normalize_key(mixed $value): string
{
    return preg_replace('/[^a-z0-9]/', '', strtolower((string)($value ?? ''))) ?? '';
}

function payslip_line_item_amount(array $items, array $aliases): float
{
    $keys = array_map('payslip_normalize_key', $aliases);
    $total = 0.0;

    foreach ($items as $item) {
        if (in_array(payslip_normalize_key($item['name'] ?? ''), $keys, true)) {
            $total += payslip_amount($item['amount'] ?? 0);
        }
    }

    return $total;
}

function payslip_build_deduction_rows(array $employee): array
{
    $standardKeys = [];
    foreach (PAYSLIP_DEDUCTION_ROWS as $row) {
        foreach ($row['aliases'] as $alias) {
            $standardKeys[payslip_normalize_key($alias)] = true;
        }
    }

    $rows = array_map(
        static fn (array $row): array => [
            'label' => $row['label'],
            'value' => payslip_line_item_amount($employee['deductionItems'] ?? [], $row['aliases']),
        ],
        PAYSLIP_DEDUCTION_ROWS
    );

    foreach (($employee['deductionItems'] ?? []) as $item) {
        $key = payslip_normalize_key($item['name'] ?? '');
        $amount = payslip_amount($item['amount'] ?? 0);

        if (!isset($standardKeys[$key]) && $amount > 0) {
            $rows[] = [
                'label' => payslip_text($item['name'] ?? 'Other Deduction'),
                'value' => $amount,
            ];
        }
    }

    return $rows;
}

function payslip_money(mixed $value): string
{
    return number_format(payslip_amount($value), 2);
}

function payslip_escape(mixed $value): string
{
    return htmlspecialchars((string)($value ?? ''), ENT_QUOTES, 'UTF-8');
}

function payslip_safe_filename(string $value): string
{
    $filename = strtolower(trim($value));
    $filename = preg_replace('/[^a-z0-9]+/', '-', $filename) ?? '';
    $filename = trim($filename, '-');

    return $filename !== '' ? $filename : 'employee';
}

function payslip_render_download_html(array $employee, float $peraAmount): string
{
    $allowances = $employee['allowanceItems'] ?? [];
    $hasAllowances = count($allowances) > 0;
    $pera = payslip_line_item_amount($allowances, ['PERA']);
    if ($pera <= 0 && !$hasAllowances) {
        $pera = $peraAmount;
    }

    $extraEarnings = [];
    foreach ($allowances as $allowance) {
        if (payslip_normalize_key($allowance['name'] ?? '') === 'pera') {
            continue;
        }

        $amount = payslip_amount($allowance['amount'] ?? 0);
        if ($amount > 0) {
            $extraEarnings[] = [
                'label' => strtoupper(payslip_text($allowance['name'] ?? 'Additional Earnings')),
                'value' => $amount,
            ];
        }
    }

    $extraEarningsTotal = array_reduce(
        $extraEarnings,
        static fn (float $total, array $item): float => $total + payslip_amount($item['value'] ?? 0),
        0.0
    );
    $allowanceTotal = $pera + $extraEarningsTotal;
    $salary = payslip_amount($employee['paidBasicSalary'] ?? ($employee['basicSalary'] ?? 0));
    $grossPay = payslip_amount($employee['paidGrossPay'] ?? 0);
    $salaryAmount = $grossPay > $allowanceTotal ? $grossPay - $allowanceTotal : $salary;
    $earnings = array_merge(
        [
            ['label' => 'MONTHLY SALARY', 'value' => $salaryAmount],
            ['label' => 'ACA/PERA', 'value' => $pera],
        ],
        $extraEarnings
    );
    $earningsTotal = array_reduce(
        $earnings,
        static fn (float $total, array $item): float => $total + payslip_amount($item['value'] ?? 0),
        0.0
    );

    $rowHtml = static function (string $label, mixed $value, bool $bold = false): string {
        $className = $bold ? 'row bold' : 'row';
        return '<div class="' . $className . '"><span class="label">'
            . payslip_escape($label)
            . '</span><span class="value">'
            . payslip_escape(payslip_money($value))
            . '</span></div>';
    };

    $earningsHtml = '';
    foreach ($earnings as $earning) {
        $earningsHtml .= $rowHtml($earning['label'], $earning['value']);
    }

    $deductionsHtml = '';
    foreach (payslip_build_deduction_rows($employee) as $deduction) {
        $deductionsHtml .= $rowHtml($deduction['label'], $deduction['value']);
    }

    $employeeLabel = trim(implode(' ', array_filter([
        payslip_text($employee['employeeId'] ?? ''),
        payslip_text($employee['fullName'] ?? 'Selected Employee'),
    ])));
    $period = payslip_text($employee['periodLabel'] ?? '') ?: payslip_text($employee['paidPayrollDate'] ?? '');

    return '<!doctype html><html><head><meta charset="utf-8" /><title>Payslip</title><style>'
        . '*{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#262626;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:280px;border:1px solid #d4d4d4;background:#fafafa;padding:16px;font-size:11px}.header{margin-bottom:8px;border-bottom:2px solid #d4d4d4;padding-bottom:8px;text-align:center}.title{margin:2px 0;font-size:13px;font-weight:700}.period{font-style:italic}.employee{font-weight:700}.section{margin-top:10px}.row{display:flex;justify-content:space-between;line-height:1.35}.label{width:60%}.value{width:40%;text-align:right}.bold{font-weight:700}.topline{margin-top:2px;border-top:1px solid #262626;padding-top:2px}.deduction-title{margin:10px 0 4px;font-weight:700}.total{margin-top:10px;border-top:1px solid #262626;padding-top:6px}.net{margin-top:10px;border-top:1px solid #262626;padding-top:6px;font-size:13px}.certify{margin-top:20px;text-align:center;font-size:10px;letter-spacing:.04em;text-transform:uppercase}.signature{margin-top:16px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{margin-top:2px}@media print{body{background:#fff}.page{padding:0}}'
        . '</style></head><body><main class="page"><section class="slip">'
        . '<div class="header"><div>' . payslip_escape(PAYSLIP_OFFICE) . '</div><div class="title">PAYSLIP</div><div class="period">For the period ' . payslip_escape($period) . '</div></div>'
        . '<div class="employee">' . payslip_escape($employeeLabel) . '</div>'
        . '<div class="section">' . $earningsHtml . '<div class="row bold topline"><span class="label"></span><span class="value">' . payslip_escape(payslip_money($earningsTotal)) . '</span></div></div>'
        . '<div class="section"><div class="deduction-title">DEDUCTIONS:</div>' . $deductionsHtml . '</div>'
        . '<div class="row bold total"><span class="label">TOTAL DEDUCTIONS</span><span class="value">' . payslip_escape(payslip_money($employee['paidTotalDeduction'] ?? 0)) . '</span></div>'
        . '<div class="row bold net"><span class="label">NET TAKE HOME PAY</span><span class="value">' . payslip_escape(payslip_money($employee['paidNetPay'] ?? 0)) . '</span></div>'
        . '<div class="certify">Certified true and correct</div>'
        . '<div class="signature"><div class="signature-name">' . payslip_escape(PAYSLIP_SIGNATORY_NAME) . '</div><div class="signature-title">' . payslip_escape(PAYSLIP_SIGNATORY_TITLE) . '</div></div>'
        . '</section></main></body></html>';
}

function payslip_download_zip(array $employees, float $peraAmount): void
{
    if (count($employees) === 0) {
        json_response([
            'success' => false,
            'message' => 'Select at least one paid employee to download.',
        ], 422);
    }

    if (!class_exists('ZipArchive')) {
        json_response([
            'success' => false,
            'message' => 'Bulk ZIP export requires the PHP ZipArchive extension.',
        ], 501);
    }

    $temporaryPath = tempnam(sys_get_temp_dir(), 'payslips_');
    if ($temporaryPath === false) {
        json_response([
            'success' => false,
            'message' => 'Unable to create the ZIP file.',
        ], 500);
    }

    $zip = new ZipArchive();
    if ($zip->open($temporaryPath, ZipArchive::OVERWRITE) !== true) {
        @unlink($temporaryPath);
        json_response([
            'success' => false,
            'message' => 'Unable to open the ZIP file.',
        ], 500);
    }

    foreach ($employees as $employee) {
        $safeName = payslip_safe_filename(payslip_text($employee['fullName'] ?? ($employee['employeeId'] ?? 'employee')));
        $date = preg_replace('/[^0-9-]/', '', payslip_text($employee['paidPayrollDate'] ?? '')) ?: payslip_text($employee['paidPayrollId'] ?? 'record');
        $filename = 'payslip-' . $safeName . '-' . $date . '.html';

        $zip->addFromString($filename, payslip_render_download_html($employee, $peraAmount));
    }

    $zip->close();

    $filename = 'payslips-' . date('Y-m-d') . '.zip';
    header_remove('Content-Type');
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . (string)filesize($temporaryPath));
    readfile($temporaryPath);
    @unlink($temporaryPath);
    exit;
}

hris_ensure_application_settings_table($pdo);

$filters = payslip_read_filters();
$employees = array_values(array_filter(
    payslip_fetch_employees($pdo, $roleKey, $sessionUser),
    static fn (array $employee): bool => (bool)($employee['isPaid'] ?? false) && payslip_matches_filters($employee, $filters)
));
$peraAmount = (float)payslip_lookup_allowance_amount($pdo, 'PERA', PAYSLIP_DEFAULT_PERA_AMOUNT);
$action = strtolower(payslip_text($_GET['action'] ?? ''));

if ($action === 'summary') {
    json_response([
        'success' => true,
        'summary' => payslip_summary($employees),
    ]);
}

if ($action === 'bulk_zip') {
    payslip_download_zip($employees, $peraAmount);
}

json_response([
    'success' => true,
    'employees' => $employees,
    'summary' => payslip_summary($employees),
    'defaults' => [
        'pera' => payslip_decimal_string($peraAmount),
    ],
]);
