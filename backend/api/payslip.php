<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/deduction-catalog.php';
// PAYSLIP_DEDUCTION_ROWS and payslip_deduction_lines() live here because Reports & Analytics builds
// its Deduction Distribution chart from the same roster.
require_once __DIR__ . '/payslip-deductions.php';

$sessionUser = require_session_user();
$roleKey = user_role_key($sessionUser);

/** Whether the caller is asking for their own payslip rather than the roster. */
function payslip_scope_is_self(): bool
{
    return strtolower(trim((string)($_GET['scope'] ?? ''))) === 'self';
}

/*
 * Two different reads share this endpoint. The roster-wide one belongs to the payroll desks listed
 * below; the self-scoped one returns a single payslip -- the caller's own -- so every signed-in
 * account may ask for it. A Chief and a Planning Officer carry "My Payslip" on their sidebar like
 * every other staff role, and gating the endpoint on the roster list alone answered that page with
 * a 403 for both of them.
 *
 * The parameter is not taken on trust: payslip_fetch_employees() pins a self-scoped query to the
 * signed-in user's own employee record, so asking for `scope=self` can only ever narrow the result.
 */
if (!payslip_scope_is_self()
    && !in_array($roleKey, ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'employee', 'cashier'], true)
) {
    json_response([
        'success' => false,
        'message' => 'You are not allowed to view payslip data.',
    ], 403);
}

require_method('GET');

const PAYSLIP_DEFAULT_PERA_AMOUNT = 2000.0;
const PAYSLIP_OFFICE = 'Mines and Geosciences Bureau, Regional Office No. X';
const PAYSLIP_SIGNATORY_TITLE = 'Administrative Officer IV/OIC, Finance Section';
const PAYSLIP_WORKING_DAYS_PER_MONTH = 22.0;
const PAYSLIP_WORKING_HOURS_PER_DAY = 8.0;
const PAYSLIP_CONTRACT_SERVICE_TYPE = 'Contract of Service';
const PAYSLIP_CONTRACT_SERVICE_PREMIUM_RATE = 20.0;
const PAYSLIP_CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES = ['Premium', 'Premium Pay', 'Premium Percentage'];
const PAYSLIP_CONTRACT_SERVICE_HIDDEN_ALLOWANCE_NAMES = ['PERA', 'Premium', 'Premium Pay', 'Premium Percentage'];
const PAYSLIP_CONTRACT_SERVICE_DEDUCTION_ROWS = [
    ['label' => 'Overpayment', 'aliases' => ['Overpayment', 'Deduction from Previous Payroll', 'DEDUCTION PREVIOUS PAYROLL']],
    ['label' => 'Late/UT', 'aliases' => ['Late Deduction', 'Tardy/Undertime', 'Tardy/ Undertime', 'Late/UT']],
    ['label' => 'Pass Slip', 'aliases' => ['Pass Slip', 'Pass Slip Deduction']],
    ['label' => 'Tax', 'aliases' => ['Withholding Tax', 'W-TAX', 'Tax']],
    ['label' => 'PhilHealth', 'aliases' => ['PHIC', 'PhilHealth', 'PHILHEALTH', 'PhilHealth Premium']],
    ['label' => 'PhilHealth Differential', 'aliases' => ['PhilHealth Differential', 'PHILHEALTH DIFFERENTIAL']],
    ['label' => 'Pag-IBIG', 'aliases' => ['HDMF', 'Pag-IBIG', 'PAG-IBIG', 'PAG-IBIG Premium']],
    ['label' => 'MP2', 'aliases' => ['MP2', 'PAG-IBIG MP2', 'Pag-IBIG MP2', 'Modified Pag-IBIG II (MP2)']],
    ['label' => 'Pag-IBIG MPL', 'aliases' => ['PAG-IBIG MPL', 'Pag-IBIG MPL']],
    ['label' => 'MGB Coop Loan', 'aliases' => ['MGB Coop Loan', 'MGB COOP LOAN', 'MGB Cooperative Loan']],
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

/**
 * The payslip is signed by whoever currently holds the HR Head role, so the name is read from the
 * account list instead of being fixed in code — a change of HR Head shows up on the next payslip.
 * `users` is joined back to `employees` on email, the same link the other signatory lookups use.
 *
 * The title under the line stays constant: it is the capacity the payslip is certified in, not the
 * signer's own designation.
 */
function payslip_signatory(PDO $pdo): array
{
    $signatory = ['name' => '', 'title' => PAYSLIP_SIGNATORY_TITLE];

    $statement = $pdo->query(
        'SELECT
            e.first_name,
            e.middle_name,
            e.last_name
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE u.is_archived = 0
           AND LOWER(REPLACE(r.name, " ", "")) = "hrhead"
           AND LOWER(u.status) = "active"
         ORDER BY u.id ASC
         LIMIT 1'
    );
    $row = $statement->fetch();

    if ($row) {
        $signatory['name'] = full_name_from_row($row);
    }

    return $signatory;
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
        || !database_table_exists($pdo, 'PayrollAllowance')
        || !database_table_exists($pdo, 'Allowance')
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
    if ($payrollId <= 0 || !database_table_exists($pdo, 'PayrollDeduction')) {
        return [];
    }

    // The catalog is six family tables joined as one; deduction_catalog_type_union_sql() presents
    // them under the column names this query was written against.
    $amountExpression = database_column_exists($pdo, 'PayrollDeduction', 'amount')
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

    // "Contractual" and "COS" are the older spellings of the same appointment.
    if (in_array($normalized, ['contract of service', 'contractual', 'cos'], true)) {
        return 'Contract of Service';
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
    // The join below reads it, and a payslip can be opened before any payroll request has run.
    ensure_payroll_meta_table($pdo);

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
     * and other staff roles see only their own record — not every employee's. It is the same check
     * the access gate at the top of this file reads, which is why both go through one function.
     */
    $scopeSelf = payslip_scope_is_self();

    if ($roleKey === 'employee' || $scopeSelf) {
        $employeeRecordId = session_employee_record_id($pdo, $sessionUser);

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
            payroll_meta.meta_json AS paidPayrollMeta
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         ' . $payrollJoinSql . '
         LEFT JOIN PayrollMeta payroll_meta ON payroll_meta.payroll_id = paid.payroll_id
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
    return payslip_deduction_lines($employee['deductionItems'] ?? []);
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

function payslip_has_amount_value(mixed $value): bool
{
    return $value !== null && trim((string)$value) !== '';
}

function payslip_is_contract_service(array $employee): bool
{
    return payslip_normalize_employment_type($employee['employmentStatus'] ?? ($employee['employmentType'] ?? '')) === PAYSLIP_CONTRACT_SERVICE_TYPE;
}

function payslip_date_object(mixed $value): ?DateTimeImmutable
{
    $dateKey = payslip_date_key($value);

    if ($dateKey === '') {
        return null;
    }

    try {
        return new DateTimeImmutable($dateKey);
    } catch (Throwable $exception) {
        return null;
    }
}

function payslip_contract_employee_name(array $employee): string
{
    $fullName = preg_replace('/\s+/', ' ', payslip_text($employee['fullName'] ?? ($employee['employeeName'] ?? 'Selected Employee'))) ?? '';
    $fullName = trim($fullName);

    if ($fullName === '' || strpos($fullName, ',') !== false) {
        return $fullName !== '' ? $fullName : 'Selected Employee';
    }

    $parts = preg_split('/\s+/', $fullName) ?: [];
    if (count($parts) < 2) {
        return $fullName;
    }

    $lastName = array_pop($parts);
    return $lastName . ', ' . implode(' ', $parts);
}

function payslip_contract_period_range(array $employee): string
{
    $start = payslip_date_object($employee['startDate'] ?? null);
    $end = payslip_date_object($employee['endDate'] ?? ($employee['paidPayrollDate'] ?? null));

    if ($start !== null && $end !== null) {
        if ($start->format('Y') === $end->format('Y') && $start->format('m') === $end->format('m')) {
            if ($start->format('j') === $end->format('j')) {
                return strtoupper($start->format('F')) . ' ' . $start->format('j') . ', ' . $end->format('Y');
            }

            return strtoupper($start->format('F')) . ' ' . $start->format('j') . '-' . $end->format('j') . ', ' . $end->format('Y');
        }

        return strtoupper($start->format('F')) . ' ' . $start->format('j') . ', ' . $start->format('Y')
            . ' - '
            . strtoupper($end->format('F')) . ' ' . $end->format('j') . ', ' . $end->format('Y');
    }

    $payrollDate = payslip_date_object($employee['paidPayrollDate'] ?? null);
    return $payrollDate !== null
        ? strtoupper($payrollDate->format('F')) . ' ' . $payrollDate->format('j') . ', ' . $payrollDate->format('Y')
        : '';
}

function payslip_contract_period_day_count(array $employee): float
{
    $start = payslip_date_object($employee['startDate'] ?? null);
    $end = payslip_date_object($employee['endDate'] ?? ($employee['paidPayrollDate'] ?? null));

    if ($start === null || $end === null || $start > $end) {
        return 0.0;
    }

    $count = 0;
    $current = $start;

    while ($current <= $end) {
        if ((int)$current->format('w') !== 0) {
            $count++;
        }

        $current = $current->modify('+1 day');
    }

    return (float)$count;
}

function payslip_contract_days_rendered(array $employee): float
{
    $renderedMinutes = payslip_amount($employee['attendanceRenderedMinutes'] ?? 0);

    if ($renderedMinutes > 0) {
        return payslip_amount($renderedMinutes / (PAYSLIP_WORKING_HOURS_PER_DAY * 60));
    }

    $expectedWorkdays = payslip_amount($employee['attendanceExpectedWorkdays'] ?? 0);
    if ($expectedWorkdays > 0) {
        return max(payslip_amount($expectedWorkdays - payslip_amount($employee['absenceDays'] ?? 0)), 0.0);
    }

    $periodDays = payslip_contract_period_day_count($employee);
    return $periodDays > 0 ? max(payslip_amount($periodDays - payslip_amount($employee['absenceDays'] ?? 0)), 0.0) : 0.0;
}

function payslip_contract_daily_rate(array $employee, float $daysRendered, float $salaryAmount): float
{
    if ($daysRendered > 0 && $salaryAmount > 0) {
        return payslip_amount($salaryAmount / $daysRendered);
    }

    $hourlyRate = payslip_amount($employee['hourlyRate'] ?? 0);
    if ($hourlyRate > 0) {
        return payslip_amount($hourlyRate * PAYSLIP_WORKING_HOURS_PER_DAY);
    }

    $basicSalary = payslip_amount($employee['paidBasicSalary'] ?? ($employee['basicSalary'] ?? 0));
    return $basicSalary > 0 ? payslip_amount($basicSalary / PAYSLIP_WORKING_DAYS_PER_MONTH) : 0.0;
}

function payslip_contract_deduction_rows(array $employee): array
{
    $undertimeDeduction = payslip_line_item_amount($employee['deductionItems'] ?? [], ['Undertime Deduction']);
    $explicitPassSlipDeduction = payslip_line_item_amount($employee['deductionItems'] ?? [], ['Pass Slip', 'Pass Slip Deduction']);
    $passSlipDeduction = $explicitPassSlipDeduction > 0
        ? $explicitPassSlipDeduction
        : (!($employee['hasAttendanceCoverage'] ?? false) && $undertimeDeduction > 0 ? $undertimeDeduction : 0.0);
    $rows = [];

    foreach (PAYSLIP_CONTRACT_SERVICE_DEDUCTION_ROWS as $row) {
        $value = payslip_line_item_amount($employee['deductionItems'] ?? [], $row['aliases']);

        if ($row['label'] === 'Late/UT' && ($employee['hasAttendanceCoverage'] ?? false)) {
            $value += $undertimeDeduction;
        }

        if ($row['label'] === 'Pass Slip') {
            $value = $passSlipDeduction;
        }

        $rows[] = [
            'label' => $row['label'],
            'value' => payslip_amount($value),
        ];
    }

    return $rows;
}

function payslip_contract_additional_salary(array $employee): float
{
    $hiddenKeys = array_map('payslip_normalize_key', PAYSLIP_CONTRACT_SERVICE_HIDDEN_ALLOWANCE_NAMES);
    $total = 0.0;

    foreach ($employee['allowanceItems'] ?? [] as $item) {
        if (in_array(payslip_normalize_key($item['name'] ?? ''), $hiddenKeys, true)) {
            continue;
        }

        $total += payslip_amount($item['amount'] ?? 0);
    }

    return payslip_amount($total);
}

function payslip_contract_money(mixed $value, bool $dash = false): string
{
    if (!payslip_has_amount_value($value)) {
        return $dash ? '-' : '';
    }

    $amount = payslip_amount($value);
    if ($amount == 0.0) {
        return $dash ? '-' : '';
    }

    return payslip_money($amount);
}

function payslip_contract_days(mixed $value): string
{
    $amount = payslip_amount($value);
    if ($amount == 0.0) {
        return '';
    }

    return floor($amount) == $amount ? number_format($amount, 0) : number_format($amount, 2);
}

function payslip_contract_data(array $employee, array $signatory): array
{
    $salaryAmount = payslip_amount($employee['paidBasicSalary'] ?? ($employee['basicSalary'] ?? 0));
    $daysRendered = payslip_contract_days_rendered($employee);
    $dailyRate = payslip_contract_daily_rate($employee, $daysRendered, $salaryAmount);
    $periodSalary = $daysRendered > 0 && $dailyRate > 0
        ? payslip_amount($daysRendered * $dailyRate)
        : $salaryAmount;
    $premiumUnit = payslip_amount($dailyRate * (PAYSLIP_CONTRACT_SERVICE_PREMIUM_RATE / 100));
    $storedPremiumTotal = payslip_line_item_amount($employee['allowanceItems'] ?? [], PAYSLIP_CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES);
    $premiumTotal = $storedPremiumTotal > 0
        ? $storedPremiumTotal
        : payslip_amount($premiumUnit * $daysRendered);
    $additionalSalary = payslip_contract_additional_salary($employee);
    $grossPay = payslip_amount($periodSalary + $premiumTotal + $additionalSalary);
    $deductions = payslip_contract_deduction_rows($employee);
    $totalDeductions = array_reduce(
        $deductions,
        static fn (float $total, array $item): float => $total + payslip_amount($item['value'] ?? 0),
        0.0
    );
    $totalDeductions = payslip_amount($totalDeductions);
    $netPay = payslip_amount($grossPay - $totalDeductions);
    $periodRange = payslip_contract_period_range($employee);

    return [
        'officeLines' => ['MINES AND GEOSCIENCES BUREAU', 'Regional Office No. X'],
        'title' => 'SALARY OF CONTRACT OF SERVICE FOR THE' . ($periodRange !== '' ? ' PERIOD ' . $periodRange : ' PERIOD'),
        'employee' => payslip_contract_employee_name($employee),
        'daysRendered' => $daysRendered,
        'dailyRate' => $dailyRate,
        'periodSalary' => $periodSalary,
        'premiumRate' => PAYSLIP_CONTRACT_SERVICE_PREMIUM_RATE,
        'premiumUnit' => $premiumUnit,
        'premiumTotal' => $premiumTotal,
        'additionalSalary' => $additionalSalary,
        'grossPay' => $grossPay,
        'deductions' => $deductions,
        'totalDeductions' => $totalDeductions,
        'netPay' => $netPay,
        'signatoryName' => payslip_text($signatory['name'] ?? ''),
        'signatoryTitle' => payslip_text($signatory['title'] ?? PAYSLIP_SIGNATORY_TITLE),
    ];
}

function payslip_render_contract_service_download_html(array $employee, array $signatory): string
{
    $data = payslip_contract_data($employee, $signatory);
    $titleHtml = str_replace(' FOR THE PERIOD ', ' FOR THE<br />PERIOD ', payslip_escape($data['title']));
    $officeHtml = '';
    foreach ($data['officeLines'] as $line) {
        $officeHtml .= '<div>' . payslip_escape($line) . '</div>';
    }

    $deductionsHtml = '';
    foreach ($data['deductions'] as $deduction) {
        $deductionsHtml .= '<div class="deduction-row"><span class="deduction-label">'
            . payslip_escape($deduction['label'])
            . '</span><span class="deduction-value">'
            . payslip_escape(payslip_contract_money($deduction['value']))
            . '</span></div>';
    }

    return '<!doctype html><html><head><meta charset="utf-8" /><title>Payslip</title><style>'
        . '*{box-sizing:border-box}body{margin:0;background:#fff;color:#000;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:430px;min-height:620px;background:#fff;padding:38px 28px 28px;font-size:12px;line-height:1.2}.office{text-align:center;font-weight:700}.title{margin-top:14px;text-align:center;font-size:14px;line-height:1.35}.employee{margin-top:14px;font-weight:700}.pay-row{display:grid;grid-template-columns:132px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.pay-row .days{text-align:center}.pay-row .amount{text-align:right}.add-row{display:grid;grid-template-columns:42px 108px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.add-row .amount{text-align:right}.gross-line{border-top:1px solid #000;font-weight:700}.deductions{margin-top:1px}.deduction-title{line-height:1.25}.deduction-row{display:grid;grid-template-columns:118px 1fr;line-height:1.35}.deduction-label{padding-left:70px;white-space:nowrap}.deduction-value{text-align:right}.total-deductions{display:grid;grid-template-columns:1fr 44px 96px;align-items:end;margin-top:2px;line-height:1.25}.total-deductions .label{font-style:italic;text-align:center}.total-deductions .dash{text-align:center}.net-row{display:grid;grid-template-columns:1fr 96px;column-gap:8px;margin-top:18px;align-items:end}.net-row .label{font-size:14px;font-style:italic;font-weight:700;text-align:center}.net-row .value{border-top:1px solid #000;font-size:15px;font-style:italic;font-weight:700;text-align:right}.certify{margin-top:30px;text-align:center;font-size:11px}.signature{margin-top:30px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{font-size:11px}@media print{.page{padding:0}.slip{width:100%;min-height:auto}}'
        . '</style></head><body><main class="page"><section class="slip">'
        . '<div class="office">' . $officeHtml . '</div>'
        . '<div class="title">' . $titleHtml . '</div>'
        . '<div class="employee">' . payslip_escape($data['employee']) . '</div>'
        . '<div class="pay-row"><span class="days">' . payslip_escape(payslip_contract_days($data['daysRendered'])) . '</span><span>x</span><span class="amount">' . payslip_escape(payslip_contract_money($data['dailyRate'])) . '</span><span>=</span><span class="amount">' . payslip_escape(payslip_contract_money($data['periodSalary'])) . '</span></div>'
        . '<div class="add-row"><span>Add:</span><span>Premium (' . payslip_escape(payslip_contract_days($data['premiumRate'])) . '%)</span><span>+</span><span class="amount">' . payslip_escape(payslip_contract_money($data['premiumUnit'])) . '</span><span>=</span><span class="amount">' . payslip_escape(payslip_contract_money($data['premiumTotal'])) . '</span></div>'
        . '<div class="add-row"><span></span><span>Additional Salary</span><span>+</span><span class="amount">' . payslip_escape(payslip_contract_money($data['additionalSalary'])) . '</span><span>=</span><span class="amount gross-line">' . payslip_escape(payslip_contract_money($data['additionalSalary'])) . '</span></div>'
        . '<div class="pay-row"><span></span><span></span><span></span><span></span><span class="amount">' . payslip_escape(payslip_contract_money($data['grossPay'])) . '</span></div>'
        . '<div class="deductions"><div class="deduction-title">Deductions:</div>' . $deductionsHtml . '</div>'
        . '<div class="total-deductions"><span class="label">Total Deduction</span><span class="dash">-</span><span class="deduction-value">' . payslip_escape(payslip_contract_money($data['totalDeductions'], true)) . '</span></div>'
        . '<div class="net-row"><span class="label">Total</span><span class="value">' . payslip_escape(payslip_contract_money($data['netPay'], true)) . '</span></div>'
        . '<div class="certify">CERTIFIED TRUE AND CORRECT</div>'
        . '<div class="signature"><div class="signature-name">' . payslip_escape($data['signatoryName']) . '</div><div class="signature-title">' . payslip_escape($data['signatoryTitle']) . '</div></div>'
        . '</section></main></body></html>';
}

function payslip_render_download_html(array $employee, float $peraAmount, array $signatory): string
{
    if (payslip_is_contract_service($employee)) {
        return payslip_render_contract_service_download_html($employee, $signatory);
    }

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
        . '<div class="signature"><div class="signature-name">' . payslip_escape($signatory['name'] ?? '') . '</div><div class="signature-title">' . payslip_escape($signatory['title'] ?? PAYSLIP_SIGNATORY_TITLE) . '</div></div>'
        . '</section></main></body></html>';
}

function payslip_download_zip(array $employees, float $peraAmount, array $signatory): void
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

        $zip->addFromString($filename, payslip_render_download_html($employee, $peraAmount, $signatory));
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

ensure_application_settings_table($pdo);

$filters = payslip_read_filters();
$employees = array_values(array_filter(
    payslip_fetch_employees($pdo, $roleKey, $sessionUser),
    static fn (array $employee): bool => (bool)($employee['isPaid'] ?? false) && payslip_matches_filters($employee, $filters)
));
$peraAmount = (float)payslip_lookup_allowance_amount($pdo, 'PERA', PAYSLIP_DEFAULT_PERA_AMOUNT);
$signatory = payslip_signatory($pdo);
$action = strtolower(payslip_text($_GET['action'] ?? ''));

if ($action === 'summary') {
    json_response([
        'success' => true,
        'summary' => payslip_summary($employees),
    ]);
}

if ($action === 'bulk_zip') {
    payslip_download_zip($employees, $peraAmount, $signatory);
}

json_response([
    'success' => true,
    'employees' => $employees,
    'summary' => payslip_summary($employees),
    'defaults' => [
        'pera' => payslip_decimal_string($peraAmount),
        'signatory' => $signatory,
    ],
]);
