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
         FROM allowance
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
 * The fallback signatory, for a paid row that carries no release stamp (see
 * payslip_release_signatory() below): whoever currently holds the HR Head role, so the name is read
 * from the account list instead of being fixed in code. `users` is joined back to `employees` on
 * email, the same link the other signatory lookups use.
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

/**
 * The person who released a payslip, read from the `released_by` stamp the Cashier's Mark as Paid
 * leaves on the payroll row (payroll_transition_status() in payroll.php). A released payslip is
 * signed by them: their e-signature above the line, their name on it, and their role under it.
 *
 * Looked up rather than copied onto the row, the way the register's certification reads its
 * signers. An archived account still resolves, because the slip records who released it at the
 * time. The signature image is read only for the requests that draw a slip (`$withSignature`), so
 * a month's roster does not carry one copy of it per row.
 */
function payslip_release_signatory(PDO $pdo, int $userId, bool $withSignature): ?array
{
    static $cache = [];

    if ($userId <= 0) {
        return null;
    }

    $cacheKey = $userId . ($withSignature ? ':signed' : '');
    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $statement = $pdo->prepare(
        'SELECT
            u.username,
            r.name AS role_name,
            e.first_name,
            e.middle_name,
            e.last_name,
            ' . ($withSignature ? 'e.e_signature' : 'NULL') . ' AS signature_data_url
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
         WHERE u.id = :user_id
         ORDER BY e.is_archived ASC, e.id ASC
         LIMIT 1'
    );
    $statement->execute([':user_id' => $userId]);
    $row = $statement->fetch();

    if ($row === false) {
        return $cache[$cacheKey] = null;
    }

    $roleName = payslip_text($row['role_name'] ?? '');
    $signature = payslip_text($row['signature_data_url'] ?? '');

    return $cache[$cacheKey] = [
        'userId' => $userId,
        // An account with no employee record (the built-in admin) signs with its username.
        'name' => full_name_from_row($row) ?: payslip_text($row['username'] ?? ''),
        // Built-in roles print the label the rest of the app shows ("HR Head"); a custom role prints its own name.
        'role' => builtin_permission_roles()[role_key_from_name($roleName)]['label'] ?? $roleName,
        // employee_signature.php only ever stores an image data URL; anything else is left off the slip.
        'signatureDataUrl' => preg_match('/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i', $signature) === 1 ? $signature : '',
    ];
}

/** The signatory one payslip prints: whoever released it, or the fallback above for an unstamped row. */
function payslip_signatory_for_employee(array $employee, array $fallbackSignatory): array
{
    $releasedBy = is_array($employee['releasedBy'] ?? null) ? $employee['releasedBy'] : [];

    if (payslip_text($releasedBy['name'] ?? '') === '') {
        return $fallbackSignatory;
    }

    return [
        'name' => payslip_text($releasedBy['name']),
        'title' => payslip_text($releasedBy['role'] ?? ''),
        'signatureDataUrl' => payslip_text($releasedBy['signatureDataUrl'] ?? ''),
    ];
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
        || !database_table_exists($pdo, 'allowance')
    ) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT a.allowance_name AS name, a.amount
         FROM PayrollAllowance pa
         INNER JOIN allowance a ON a.allowance_id = pa.allowance_id
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
    if ($payrollId <= 0) {
        return [];
    }

    return array_map(
        static fn (array $item): array => [
            'name' => payslip_text($item['name'] ?? ''),
            'category' => payslip_text($item['category'] ?? ''),
            'amount' => payslip_amount($item['amount'] ?? 0),
        ],
        deduction_catalog_payroll_items($pdo, $payrollId)
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

function payslip_empty_attendance_summary(): array
{
    return [
        'daysWorked' => 0,
        'renderedMinutes' => 0,
        'lateMinutes' => 0,
        'undertimeMinutes' => 0,
        'absentDays' => 0,
        'leaveDays' => 0,
        'expectedWorkdays' => 0,
        'hasAttendanceCoverage' => false,
    ];
}

/** Work-week setting used by both the DTR and payroll screens. */
function payslip_system_workday_numbers(PDO $pdo): array
{
    $configuration = json_decode(get_application_setting($pdo, 'system_configuration', '{}'), true);
    $workWeek = is_array($configuration) && is_array($configuration['workWeek'] ?? null)
        ? $configuration['workWeek']
        : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    $dayMap = [
        'mon' => 1,
        'monday' => 1,
        'tue' => 2,
        'tuesday' => 2,
        'wed' => 3,
        'wednesday' => 3,
        'thu' => 4,
        'thursday' => 4,
        'fri' => 5,
        'friday' => 5,
        'sat' => 6,
        'saturday' => 6,
        'sun' => 7,
        'sunday' => 7,
    ];
    $days = [];

    foreach ($workWeek as $day) {
        $key = strtolower(trim((string)$day));
        if (isset($dayMap[$key])) {
            $days[$dayMap[$key]] = true;
        }
    }

    if ($days === []) {
        return [1, 2, 3, 4, 5];
    }

    $numbers = array_keys($days);
    sort($numbers);

    return $numbers;
}

function payslip_non_working_holiday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    if (!database_table_exists($pdo, 'holidays')) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT holiday_date AS holidayDate, type, is_recurring AS isRecurring
         FROM holidays
         WHERE type <> "special_working"
           AND (holiday_date BETWEEN :start_date AND :end_date OR is_recurring = 1)'
    );
    $statement->execute([
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $holidays = [];
    $startYear = (int)substr($startDate, 0, 4);
    $endYear = (int)substr($endDate, 0, 4);

    foreach ($statement->fetchAll() as $row) {
        $holidayDate = payslip_date_key($row['holidayDate'] ?? null);
        if ($holidayDate === '') {
            continue;
        }

        if ((int)($row['isRecurring'] ?? 0) === 1) {
            for ($year = $startYear; $year <= $endYear; $year++) {
                $recurringDate = sprintf('%04d%s', $year, substr($holidayDate, 4));
                if ($recurringDate >= $startDate && $recurringDate <= $endDate) {
                    $holidays[$recurringDate] = true;
                }
            }
            continue;
        }

        if ($holidayDate >= $startDate && $holidayDate <= $endDate) {
            $holidays[$holidayDate] = true;
        }
    }

    return $holidays;
}

function payslip_workday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    $holidays = payslip_non_working_holiday_dates($pdo, $startDate, $endDate);
    $workdayNumbers = array_flip(payslip_system_workday_numbers($pdo));
    $workdays = [];
    $current = new DateTimeImmutable($startDate);
    $end = new DateTimeImmutable($endDate);

    while ($current <= $end) {
        $dateKey = $current->format('Y-m-d');
        if (isset($workdayNumbers[(int)$current->format('N')]) && !isset($holidays[$dateKey])) {
            $workdays[$dateKey] = true;
        }

        $current = $current->modify('+1 day');
    }

    return $workdays;
}

function payslip_approved_leave_dates(
    PDO $pdo,
    int $employeeRecordId,
    string $startDate,
    string $endDate,
    array $workdayDates
): array {
    if (!database_table_exists($pdo, 'leave_requests')) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT start_date AS startDate, end_date AS endDate
         FROM leave_requests
         WHERE employee_id = :employee_id
           AND LOWER(status) = "approved"
           AND start_date <= :end_date
           AND end_date >= :start_date'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $leaveDates = [];
    foreach ($statement->fetchAll() as $row) {
        $requestStart = payslip_date_key($row['startDate'] ?? null);
        $requestEnd = payslip_date_key($row['endDate'] ?? null);
        if ($requestStart === '' || $requestEnd === '') {
            continue;
        }

        $current = new DateTimeImmutable(max($requestStart, $startDate));
        $rangeEnd = new DateTimeImmutable(min($requestEnd, $endDate));
        while ($current <= $rangeEnd) {
            $dateKey = $current->format('Y-m-d');
            if (isset($workdayDates[$dateKey])) {
                $leaveDates[$dateKey] = true;
            }

            $current = $current->modify('+1 day');
        }
    }

    return $leaveDates;
}

/**
 * Count the pass slips an employee filed inside a payroll period.
 *
 * Every filed slip counts, the same way payroll_filed_pass_slip_hours() treats them: nothing in the
 * app sets an approval status on pass_slip rows, so filing is the only event there is to count.
 */
function payslip_pass_slip_count(
    PDO $pdo,
    int $employeeRecordId,
    mixed $startDateValue,
    mixed $endDateValue
): int {
    $startDate = payslip_date_key($startDateValue);
    $endDate = payslip_date_key($endDateValue);

    if (
        $employeeRecordId <= 0
        || $startDate === ''
        || $endDate === ''
        || $startDate > $endDate
        || !database_table_exists($pdo, 'pass_slip')
    ) {
        return 0;
    }

    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM pass_slip
         WHERE employee_id = :employee_id
           AND pass_date BETWEEN :start_date AND :end_date'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return (int)$statement->fetchColumn();
}

/**
 * Read the current DTR totals for the exact period printed on a paid payslip.
 *
 * The payroll snapshot remains the accounting record, but attendance is operational data that may
 * be imported after a registry was prepared. Opening a payslip therefore refreshes this summary
 * from attendance_daily_records. Most importantly, no employee row means zero days worked; it must
 * never be replaced with the number of calendar days in the payroll period.
 */
function payslip_attendance_summary(
    PDO $pdo,
    int $employeeRecordId,
    mixed $startDateValue,
    mixed $endDateValue
): array {
    $empty = payslip_empty_attendance_summary();
    $startDate = payslip_date_key($startDateValue);
    $endDate = payslip_date_key($endDateValue);

    if (
        $employeeRecordId <= 0
        || $startDate === ''
        || $endDate === ''
        || $startDate > $endDate
        || !database_table_exists($pdo, 'attendance_daily_records')
    ) {
        return $empty;
    }

    $statement = $pdo->prepare(
        'SELECT
            attendance_date AS attendanceDate,
            time_in AS timeIn,
            time_out AS timeOut,
            total_minutes AS totalMinutes,
            late_minutes AS lateMinutes,
            undertime_minutes AS undertimeMinutes
         FROM attendance_daily_records
         WHERE employee_id = :employee_id
           AND attendance_date BETWEEN :start_date AND :end_date
         ORDER BY attendance_date ASC'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $records = $statement->fetchAll();
    $summary = $empty;
    $datesWithEntries = [];
    $workedDates = [];

    foreach ($records as $record) {
        $recordDate = payslip_date_key($record['attendanceDate'] ?? null);
        $totalMinutes = max((int)($record['totalMinutes'] ?? 0), 0);
        $summary['renderedMinutes'] += $totalMinutes;
        $summary['lateMinutes'] += max((int)($record['lateMinutes'] ?? 0), 0);
        $summary['undertimeMinutes'] += max((int)($record['undertimeMinutes'] ?? 0), 0);

        if ($recordDate === '') {
            continue;
        }

        if (
            payslip_text($record['timeIn'] ?? '') !== ''
            || payslip_text($record['timeOut'] ?? '') !== ''
            || $totalMinutes > 0
        ) {
            $datesWithEntries[$recordDate] = true;
        }

        if ($totalMinutes > 0) {
            $workedDates[$recordDate] = true;
        }
    }

    $workdayDates = payslip_workday_dates($pdo, $startDate, $endDate);
    $leaveDates = payslip_approved_leave_dates(
        $pdo,
        $employeeRecordId,
        $startDate,
        $endDate,
        $workdayDates
    );

    foreach ($workdayDates as $date => $_) {
        if (!isset($datesWithEntries[$date]) && !isset($leaveDates[$date])) {
            $summary['absentDays']++;
        }
    }

    $summary['daysWorked'] = count($workedDates);
    $summary['leaveDays'] = count($leaveDates);
    $summary['expectedWorkdays'] = count($workdayDates);
    $summary['hasAttendanceCoverage'] = $records !== [];

    return $summary;
}

function payslip_matches_filters(array $employee, array $filters): bool
{
    $payrollId = (int)($filters['payrollId'] ?? 0);
    if ($payrollId > 0 && (int)($employee['paidPayrollId'] ?? 0) !== $payrollId) {
        return false;
    }

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

/**
 * The `month` filter (YYYY-MM) picks one payroll month on the Payslip Records page. An empty value
 * keeps the roster's default of each employee's latest paid payslip; anything else is rejected
 * rather than silently falling back to that default, which would show the wrong month's slips.
 */
function payslip_read_month(): string
{
    $month = trim((string)($_GET['month'] ?? ''));

    if ($month === '') {
        return '';
    }

    if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month) !== 1) {
        json_response([
            'success' => false,
            'message' => 'Payslip month must use the YYYY-MM format.',
        ], 422);
    }

    return $month;
}

function payslip_read_filters(): array
{
    return [
        'month' => payslip_read_month(),
        'payrollId' => (int)($_GET['payroll_id'] ?? 0),
        'employeeId' => $_GET['employee_id'] ?? '',
        'employeeIds' => payslip_parse_id_list($_GET['employee_ids'] ?? ''),
        'department' => $_GET['department'] ?? '',
        'employmentType' => $_GET['employment_type'] ?? '',
        'payPeriod' => $_GET['pay_period'] ?? '',
        'startDate' => $_GET['start_date'] ?? '',
        'endDate' => $_GET['end_date'] ?? '',
    ];
}

function payslip_fetch_employees(
    PDO $pdo,
    string $roleKey,
    array $sessionUser,
    bool $refreshAttendance = false,
    int $requestedPayrollId = 0,
    string $month = '',
    bool $withSignatures = false
): array
{
    // The query below reads it, and a payslip can be opened before any payroll request has run.
    ensure_payroll_embedded_detail_columns($pdo);

    $params = [];
    $employeeScopeSql = '';
    $payrollJoinSql = 'LEFT JOIN (
            SELECT p.*
            FROM payroll p
            INNER JOIN (
                SELECT employee_id, MAX(payroll_id) AS payroll_id
                FROM payroll
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
        $payrollJoinSql = 'INNER JOIN payroll paid ON paid.employee_id = e.id AND paid.status = "Paid"';
        $orderBySql = 'ORDER BY paid.payroll_date DESC, paid.payroll_id DESC';
    }

    /*
     * A picked month lists every paid payslip dated in it, not only each employee's latest, so past
     * months stay browsable after newer payrolls are released. payroll_date is always written from
     * the pay period's end date, so it places a 1st Half and a 2nd Half in the month they cover.
     * Skipped for a single-record read: its join below would drop these placeholders, and native
     * prepares fail on a bound parameter the SQL never uses.
     */
    if ($month !== '' && $requestedPayrollId <= 0) {
        $monthStart = new DateTimeImmutable($month . '-01');
        $payrollJoinSql = 'INNER JOIN payroll paid
            ON paid.employee_id = e.id
           AND paid.status = "Paid"
           AND paid.payroll_date >= :month_start
           AND paid.payroll_date < :month_end';
        $params[':month_start'] = $monthStart->format('Y-m-d');
        $params[':month_end'] = $monthStart->modify('+1 month')->format('Y-m-d');

        if ($employeeScopeSql === '') {
            $orderBySql = 'ORDER BY e.last_name ASC, e.first_name ASC, e.id ASC, paid.payroll_date DESC, paid.payroll_id DESC';
        }
    }

    if ($requestedPayrollId > 0) {
        $payrollJoinSql = 'INNER JOIN payroll paid
            ON paid.employee_id = e.id
           AND paid.status = "Paid"
           AND paid.payroll_id = :requested_payroll_id';
        $params[':requested_payroll_id'] = $requestedPayrollId;
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
            paid.released_by AS releasedByUserId,
            paid.meta_json AS paidPayrollSnapshot
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         ' . $payrollJoinSql . '
         WHERE e.is_archived = 0' . $employeeScopeSql . '
         ' . $orderBySql
    );
    $statement->execute($params);
    $employees = [];

    foreach ($statement->fetchAll() as $row) {
        $payrollId = (int)($row['paidPayrollId'] ?? 0);
        $meta = payslip_decode_meta($row['paidPayrollSnapshot'] ?? null);
        unset($row['paidPayrollSnapshot']);

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
        $row['passSlipCount'] = payslip_meta_integer($meta, 'passSlipCount');
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
        $row['releasedBy'] = payslip_release_signatory($pdo, (int)($row['releasedByUserId'] ?? 0), $withSignatures);
        unset($row['releasedByUserId']);
        $row['isPaid'] = $payrollId > 0 || strtolower(payslip_text($row['paidPayrollStatus'] ?? '')) === 'paid';

        if ($refreshAttendance && $row['isPaid']) {
            $attendance = payslip_attendance_summary(
                $pdo,
                (int)($row['id'] ?? 0),
                $row['startDate'] ?? '',
                $row['endDate'] ?? ''
            );
            $row['attendanceDaysWorked'] = (int)$attendance['daysWorked'];
            $row['attendanceRenderedMinutes'] = (int)$attendance['renderedMinutes'];
            $row['attendanceLateMinutes'] = (int)$attendance['lateMinutes'];
            $row['attendanceUndertimeMinutes'] = (int)$attendance['undertimeMinutes'];
            $row['attendanceExpectedWorkdays'] = (int)$attendance['expectedWorkdays'];
            $row['attendanceLeaveDays'] = (int)$attendance['leaveDays'];
            $row['absenceDays'] = (int)$attendance['absentDays'];
            $row['hasAttendanceCoverage'] = (bool)$attendance['hasAttendanceCoverage'];
            $row['passSlipCount'] = payslip_pass_slip_count(
                $pdo,
                (int)($row['id'] ?? 0),
                $row['startDate'] ?? '',
                $row['endDate'] ?? ''
            );
            $row['attendanceSummarySource'] = 'attendance';
        }

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

/**
 * One row per payroll month for the Payslip Records cards, newest first. employeeCount counts the
 * employees with a paid payslip that month -- what the month's table lists -- while payrollCount
 * and paidCount let the page tell a fully released month from one still in progress. Archived
 * payroll is left out (it no longer counts toward the month), and so are archived employees, whom
 * the payslip roster never lists either. Reads only the Payroll columns, so it stays cheap for
 * years of history where loading every payslip's line items would not.
 */
function payslip_fetch_periods(PDO $pdo, string $roleKey, array $sessionUser): array
{
    $params = [];
    $employeeScopeSql = '';

    if ($roleKey === 'employee' || payslip_scope_is_self()) {
        $employeeRecordId = session_employee_record_id($pdo, $sessionUser);

        if ($employeeRecordId === null) {
            return [];
        }

        $employeeScopeSql = ' AND p.employee_id = :employee_id';
        $params[':employee_id'] = $employeeRecordId;
    }

    $statement = $pdo->prepare(
        'SELECT
            DATE_FORMAT(p.payroll_date, "%Y-%m") AS month,
            COUNT(*) AS payrollCount,
            SUM(p.status = "Paid") AS paidCount,
            COUNT(DISTINCT CASE WHEN p.status = "Paid" THEN p.employee_id END) AS employeeCount,
            MAX(CASE WHEN p.status = "Paid" THEN COALESCE(p.released_at, p.payroll_date) END) AS generatedAt
         FROM payroll p
         INNER JOIN employees e ON e.id = p.employee_id AND e.is_archived = 0
         WHERE p.payroll_date IS NOT NULL
           AND p.status <> "Archived"' . $employeeScopeSql . '
         GROUP BY month
         ORDER BY month DESC'
    );
    $statement->execute($params);

    return array_map(static fn (array $row): array => [
        'month' => (string)$row['month'],
        'payrollCount' => (int)$row['payrollCount'],
        'paidCount' => (int)$row['paidCount'],
        'employeeCount' => (int)$row['employeeCount'],
        'generatedAt' => $row['generatedAt'] !== null ? (string)$row['generatedAt'] : '',
    ], $statement->fetchAll());
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

/**
 * Without attendance coverage the payroll charges pass-slip hours as "Undertime Deduction" (see
 * payroll_apply_automatic_calculations). The slip prints that amount on its Pass Slip line instead,
 * the same way the Contract-of-Service layout does, unless an explicit pass-slip item exists.
 */
function payslip_relabel_pass_slip_items(array $employee): array
{
    $items = $employee['deductionItems'] ?? [];
    $hasExplicitPassSlip = payslip_line_item_amount($items, ['Pass Slip', 'Pass Slip Deduction']) > 0;

    if (($employee['hasAttendanceCoverage'] ?? false) || $hasExplicitPassSlip) {
        return $items;
    }

    $undertimeKey = payslip_normalize_key('Undertime Deduction');

    return array_map(
        static fn (array $item): array => payslip_normalize_key($item['name'] ?? '') === $undertimeKey
            ? array_merge($item, ['name' => 'Pass Slip'])
            : $item,
        $items
    );
}

function payslip_build_deduction_rows(array $employee): array
{
    return payslip_deduction_lines(payslip_relabel_pass_slip_items($employee));
}

function payslip_money(mixed $value): string
{
    return number_format(payslip_amount($value), 2);
}

function payslip_escape(mixed $value): string
{
    return htmlspecialchars((string)($value ?? ''), ENT_QUOTES, 'UTF-8');
}

/**
 * The block under "Certified true and correct": the e-signature when the signer has one, their
 * name on the line, and the title or role under it. `signed` lets each layout pull the block up
 * into the space a handwritten signature would otherwise take.
 */
function payslip_signature_html(mixed $name, mixed $title, mixed $signatureDataUrl): string
{
    $signatureDataUrl = payslip_text($signatureDataUrl);

    return '<div class="signature' . ($signatureDataUrl !== '' ? ' signed' : '') . '">'
        . ($signatureDataUrl !== '' ? '<img class="signature-image" src="' . payslip_escape($signatureDataUrl) . '" alt="" />' : '')
        . '<div class="signature-name">' . payslip_escape($name) . '</div>'
        . '<div class="signature-title">' . payslip_escape($title) . '</div>'
        . '</div>';
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

function payslip_contract_days_rendered(array $employee): float
{
    if (payslip_text($employee['attendanceSummarySource'] ?? '') === 'attendance') {
        return max(payslip_amount($employee['attendanceDaysWorked'] ?? 0), 0.0);
    }

    $renderedMinutes = payslip_amount($employee['attendanceRenderedMinutes'] ?? 0);

    if ($renderedMinutes > 0) {
        return payslip_amount($renderedMinutes / (PAYSLIP_WORKING_HOURS_PER_DAY * 60));
    }

    return 0.0;
}

/**
 * True only when the refreshed DTR summary says the employee rendered no days in the period.
 * Such a payslip carries no deductions and no take-home pay. Rows not refreshed from attendance
 * simply lack the figure, so they are never treated as zero. Mirrors hasNoDaysWorked() in the UI.
 */
function payslip_has_no_days_worked(array $employee): bool
{
    return payslip_text($employee['attendanceSummarySource'] ?? '') === 'attendance'
        && payslip_amount($employee['attendanceDaysWorked'] ?? 0) <= 0.0;
}

function payslip_contract_daily_rate(array $employee): float
{
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
    $daysRendered = payslip_contract_days_rendered($employee);
    $dailyRate = payslip_contract_daily_rate($employee);
    $periodSalary = $daysRendered > 0 && $dailyRate > 0
        ? payslip_amount($daysRendered * $dailyRate)
        : 0.0;
    $premiumUnit = payslip_amount($dailyRate * (PAYSLIP_CONTRACT_SERVICE_PREMIUM_RATE / 100));
    $storedPremiumTotal = payslip_line_item_amount($employee['allowanceItems'] ?? [], PAYSLIP_CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES);
    $premiumTotal = $daysRendered > 0
        ? ($storedPremiumTotal > 0 ? $storedPremiumTotal : payslip_amount($premiumUnit * $daysRendered))
        : 0.0;
    $additionalSalary = payslip_contract_additional_salary($employee);
    $grossPay = payslip_amount($periodSalary + $premiumTotal + $additionalSalary);
    $noDaysWorked = payslip_has_no_days_worked($employee);
    $deductions = $noDaysWorked
        ? array_map(
            static fn (array $row): array => ['label' => $row['label'], 'value' => 0.0],
            PAYSLIP_CONTRACT_SERVICE_DEDUCTION_ROWS
        )
        : payslip_contract_deduction_rows($employee);
    $totalDeductions = $noDaysWorked ? 0.0 : payslip_amount(array_reduce(
        $deductions,
        static fn (float $total, array $item): float => $total + payslip_amount($item['value'] ?? 0),
        0.0
    ));
    $netPay = $noDaysWorked ? 0.0 : payslip_amount($grossPay - $totalDeductions);
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
        'signatureDataUrl' => payslip_text($signatory['signatureDataUrl'] ?? ''),
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
        . '*{box-sizing:border-box}body{margin:0;background:#fff;color:#000;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:430px;min-height:620px;background:#fff;padding:38px 28px 28px;font-size:12px;line-height:1.2}.office{text-align:center;font-weight:700}.title{margin-top:14px;text-align:center;font-size:14px;line-height:1.35}.employee{margin-top:14px;font-weight:700}.pay-row{display:grid;grid-template-columns:132px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.pay-row .days{text-align:center}.pay-row .amount{text-align:right}.add-row{display:grid;grid-template-columns:42px 108px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.add-row .amount{text-align:right}.gross-line{border-top:1px solid #000;font-weight:700}.deductions{margin-top:1px}.deduction-title{line-height:1.25}.deduction-row{display:grid;grid-template-columns:118px 1fr;line-height:1.35}.deduction-label{padding-left:70px;white-space:nowrap}.deduction-value{text-align:right}.total-deductions{display:grid;grid-template-columns:1fr 44px 96px;align-items:end;margin-top:2px;line-height:1.25}.total-deductions .label{font-style:italic;text-align:center}.total-deductions .dash{text-align:center}.net-row{display:grid;grid-template-columns:1fr 96px;column-gap:8px;margin-top:18px;align-items:end}.net-row .label{font-size:14px;font-style:italic;font-weight:700;text-align:center}.net-row .value{border-top:1px solid #000;font-size:15px;font-style:italic;font-weight:700;text-align:right}.certify{margin-top:30px;text-align:center;font-size:11px}.signature{margin-top:30px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{font-size:11px}.signature.signed{margin-top:8px}.signature-image{display:block;max-width:170px;max-height:56px;margin:0 auto -6px}@media print{.page{padding:0}.slip{width:100%;min-height:auto}}'
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
        . payslip_signature_html($data['signatoryName'], $data['signatoryTitle'], $data['signatureDataUrl'])
        . '</section></main></body></html>';
}

function payslip_render_download_html(array $employee, float $peraAmount, array $signatory): string
{
    $signatory = payslip_signatory_for_employee($employee, $signatory);

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

    // With no days worked the deduction lines stay on the slip, each printed as 0.00.
    $noDaysWorked = payslip_has_no_days_worked($employee);
    $deductionRows = $noDaysWorked
        ? array_map(
            static fn (array $row): array => ['label' => $row['label'], 'value' => 0.0],
            PAYSLIP_DEDUCTION_ROWS
        )
        : payslip_build_deduction_rows($employee);
    $totalDeductions = $noDaysWorked ? 0.0 : payslip_amount($employee['paidTotalDeduction'] ?? 0);
    $netPay = $noDaysWorked ? 0.0 : payslip_amount($employee['paidNetPay'] ?? 0);

    $deductionsHtml = '';
    foreach ($deductionRows as $deduction) {
        $deductionsHtml .= $rowHtml($deduction['label'], $deduction['value']);
    }

    $employeeLabel = trim(implode(' ', array_filter([
        payslip_text($employee['employeeId'] ?? ''),
        payslip_text($employee['fullName'] ?? 'Selected Employee'),
    ])));
    $period = payslip_text($employee['periodLabel'] ?? '') ?: payslip_text($employee['paidPayrollDate'] ?? '');

    return '<!doctype html><html><head><meta charset="utf-8" /><title>Payslip</title><style>'
        . '*{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#262626;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:280px;border:1px solid #d4d4d4;background:#fafafa;padding:16px;font-size:11px}.header{margin-bottom:8px;border-bottom:2px solid #d4d4d4;padding-bottom:8px;text-align:center}.title{margin:2px 0;font-size:13px;font-weight:700}.period{font-style:italic}.employee{font-weight:700}.section{margin-top:10px}.row{display:flex;justify-content:space-between;line-height:1.35}.label{width:60%}.value{width:40%;text-align:right}.bold{font-weight:700}.topline{margin-top:2px;border-top:1px solid #262626;padding-top:2px}.deduction-title{margin:10px 0 4px;font-weight:700}.total{margin-top:10px;border-top:1px solid #262626;padding-top:6px}.net{margin-top:10px;border-top:1px solid #262626;padding-top:6px;font-size:13px}.certify{margin-top:20px;text-align:center;font-size:10px;letter-spacing:.04em;text-transform:uppercase}.signature{margin-top:16px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{margin-top:2px}.signature.signed{margin-top:8px}.signature-image{display:block;max-width:150px;max-height:48px;margin:0 auto -4px}@media print{body{background:#fff}.page{padding:0}}'
        . '</style></head><body><main class="page"><section class="slip">'
        . '<div class="header"><div>' . payslip_escape(PAYSLIP_OFFICE) . '</div><div class="title">PAYSLIP</div><div class="period">For the period ' . payslip_escape($period) . '</div></div>'
        . '<div class="employee">' . payslip_escape($employeeLabel) . '</div>'
        . '<div class="section">' . $earningsHtml . '<div class="row bold topline"><span class="label"></span><span class="value">' . payslip_escape(payslip_money($earningsTotal)) . '</span></div></div>'
        . '<div class="section"><div class="deduction-title">DEDUCTIONS:</div>' . $deductionsHtml . '</div>'
        . '<div class="row bold total"><span class="label">TOTAL DEDUCTIONS</span><span class="value">' . payslip_escape(payslip_money($totalDeductions)) . '</span></div>'
        . '<div class="row bold net"><span class="label">NET TAKE HOME PAY</span><span class="value">' . payslip_escape(payslip_money($netPay)) . '</span></div>'
        . '<div class="certify">Certified true and correct</div>'
        . payslip_signature_html($signatory['name'] ?? '', $signatory['title'] ?? PAYSLIP_SIGNATORY_TITLE, $signatory['signatureDataUrl'] ?? '')
        . '</section></main></body></html>';
}

function payslip_download_zip(
    PDO $pdo,
    array $sessionUser,
    array $employees,
    float $peraAmount,
    array $signatory
): void
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
    write_auth_audit($pdo, $sessionUser, 'payslip.bulk_downloaded', 'A bulk payslip ZIP was downloaded.', [
        'recordCount' => count($employees),
    ]);
    header_remove('Content-Type');
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . (string)filesize($temporaryPath));
    readfile($temporaryPath);
    @unlink($temporaryPath);
    exit;
}

ensure_application_settings_table($pdo);

$action = strtolower(payslip_text($_GET['action'] ?? ''));
$filters = payslip_read_filters();

if ($action === 'detail' && (int)($filters['payrollId'] ?? 0) <= 0) {
    json_response([
        'success' => false,
        'message' => 'Paid payroll record is required.',
    ], 422);
}

// Answered before the roster load below, which reads every payslip's line items.
if ($action === 'periods') {
    json_response([
        'success' => true,
        'periods' => payslip_fetch_periods($pdo, $roleKey, $sessionUser),
        // The API pins Asia/Manila, so this is the office's month rather than the browser's.
        'currentMonth' => date('Y-m'),
    ]);
}

// The two reads that draw a slip: they refresh its attendance figures and carry the signer's e-signature.
$drawsSlip = in_array($action, ['detail', 'bulk_zip'], true);
$employees = array_values(array_filter(
    payslip_fetch_employees(
        $pdo,
        $roleKey,
        $sessionUser,
        $drawsSlip,
        (int)($filters['payrollId'] ?? 0),
        $filters['month'],
        $drawsSlip
    ),
    static fn (array $employee): bool => (bool)($employee['isPaid'] ?? false) && payslip_matches_filters($employee, $filters)
));
$peraAmount = (float)payslip_lookup_allowance_amount($pdo, 'PERA', PAYSLIP_DEFAULT_PERA_AMOUNT);
$signatory = payslip_signatory($pdo);

if ($action === 'detail' && $employees === []) {
    json_response([
        'success' => false,
        'message' => 'Paid payslip record was not found.',
    ], 404);
}

if ($action === 'summary') {
    json_response([
        'success' => true,
        'summary' => payslip_summary($employees),
    ]);
}

if ($action === 'bulk_zip') {
    payslip_download_zip($pdo, $sessionUser, $employees, $peraAmount, $signatory);
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
