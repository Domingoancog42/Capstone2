<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/deduction-catalog.php';

$sessionUser = require_session_user();
$roleKey = hris_user_role_key($sessionUser);

if (!in_array($roleKey, ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'employee'], true)) {
    json_response([
        'success' => false,
        'message' => 'You are not allowed to access payroll records.',
    ], 403);
}

if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

const PAYROLL_ALLOWED_PERIODS = ['1st Half', '2nd Half', 'Monthly'];
const PAYROLL_APPROVAL_ROLES = ['admin', 'hrhead', 'regionaldirector'];
const PAYROLL_STAFF_ROLES = ['admin', 'hrhead', 'hrstaff', 'regionaldirector'];
const PAYROLL_EDITABLE_STATUSES = ['Draft', 'Rejected'];
const PAYROLL_ACTIVE_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Paid'];
const PAYROLL_ALL_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Paid', 'Archived'];
const PAYROLL_META_PREFIX = 'payroll_meta:';
const PAYROLL_DEFAULT_PERA_AMOUNT = 2000.0;
/*
 * DBM Budget Circular No. 004-03: the daily wage rate of a government position is its authorised
 * monthly salary divided by 22 days, and the hourly rate is that over 8 hours. Late, undertime and
 * absence deductions all fall out of these two numbers.
 */
const PAYROLL_WORKING_DAYS_PER_MONTH = 22.0;
const PAYROLL_WORKING_HOURS_PER_DAY = 8.0;

/**
 * BIR Revised Withholding Tax Table, TRAIN Law (RA 10963) second phase, effective 1 January 2023
 * and unchanged for 2026. Each bracket charges `base_tax` plus `rate`% of the amount above
 * `excess_over`. Used only when the catalog has no bracket table of its own.
 */
const PAYROLL_WITHHOLDING_TAX_BRACKETS = [
    ['up_to' => 20833, 'base_tax' => 0, 'rate' => 0, 'excess_over' => 0],
    ['up_to' => 33332, 'base_tax' => 0, 'rate' => 15, 'excess_over' => 20833],
    ['up_to' => 66666, 'base_tax' => 1875, 'rate' => 20, 'excess_over' => 33333],
    ['up_to' => 166666, 'base_tax' => 8541.80, 'rate' => 25, 'excess_over' => 66667],
    ['up_to' => 666666, 'base_tax' => 33541.80, 'rate' => 30, 'excess_over' => 166667],
    ['up_to' => null, 'base_tax' => 183541.80, 'rate' => 35, 'excess_over' => 666667],
];
const PAYROLL_REGULAR_OVERTIME_MULTIPLIER = 1.25;

const PAYROLL_ALLOWANCE_FIELD_MAP = [
    'Overtime Pay' => 'overtimePay',
    'PERA' => 'pera',
    'Travel Allowance' => 'travelAllowance',
    'Salary Adjustment' => 'salaryAdjustment',
    'Other Allowances' => 'otherAllowances',
    'Bonus Amount' => 'bonusAmount',
];

const PAYROLL_DEDUCTION_FIELD_MAP = [
    'Late Deduction' => 'lateDeduction',
    'Absence Deduction' => 'absenceDeduction',
    'Undertime Deduction' => 'undertimeDeduction',
    'Withholding Tax' => 'withholdingTax',
    'SSS' => 'sss',
    'GSIS' => 'gsis',
    'HDMF' => 'hdmf',
    'Pag-IBIG' => 'hdmf',
    'PHIC' => 'phic',
    'PhilHealth' => 'phic',
    'Manual Cash Advance Adjustment' => 'manualCashAdvanceAdjustment',
    'Laptop Loan' => 'laptopLoan',
    'Other Deductions' => 'otherDeductions',
];

/*
 * The category names here decide which family table a deduction is looked up in, so they have to be
 * the family labels in DEDUCTION_FAMILIES. They previously read "Government Contributions" and
 * "Loan Deductions" — names no family matches — so every deduction saved through this map resolved
 * to `other` and a duplicate GSIS / HDMF / PHIC was created there instead of charging the real row.
 */
const PAYROLL_DEDUCTION_CATEGORY_MAP = [
    'Late Deduction' => 'Attendance Deductions',
    'Absence Deduction' => 'Attendance Deductions',
    'Undertime Deduction' => 'Attendance Deductions',
    'Withholding Tax' => 'Withholding Tax',
    'SSS' => 'Other Deductions',
    'GSIS' => 'GSIS',
    'HDMF' => 'Pag-IBIG',
    'Pag-IBIG' => 'Pag-IBIG',
    'PHIC' => 'PHIC',
    'PhilHealth' => 'PHIC',
    'Manual Cash Advance Adjustment' => 'Other Deductions',
    'Laptop Loan' => 'Other Deductions',
    'Other Deductions' => 'Other Deductions',
];

const PAYROLL_DEDUCTION_FIELD_ALIASES = [
    'withholdingtax' => 'withholdingTax',
    'tax' => 'withholdingTax',
    'sss' => 'sss',
    'gsis' => 'gsis',
    'hdmf' => 'hdmf',
    'pagibig' => 'hdmf',
    'pagibigfund' => 'hdmf',
    'phic' => 'phic',
    'philhealth' => 'phic',
    'manualcashadvanceadjustment' => 'manualCashAdvanceAdjustment',
    'cashadvance' => 'manualCashAdvanceAdjustment',
    'laptoploan' => 'laptopLoan',
    'otherdeductions' => 'otherDeductions',
];

function payroll_setting_key(int $payrollId): string
{
    return PAYROLL_META_PREFIX . $payrollId;
}

function payroll_normalize_status(mixed $value): string
{
    $text = trim((string)($value ?? ''));
    $token = preg_replace('/[^a-z]/', '', strtolower($text)) ?? '';

    return match ($token) {
        'pending', 'pendingapproval' => 'Pending Approval',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'paid' => 'Paid',
        'archived' => 'Archived',
        'draft' => 'Draft',
        default => $text !== '' ? $text : 'Draft',
    };
}

function payroll_is_staff_role(string $roleKey): bool
{
    return in_array($roleKey, PAYROLL_STAFF_ROLES, true);
}

function payroll_is_approval_role(string $roleKey): bool
{
    return in_array($roleKey, PAYROLL_APPROVAL_ROLES, true);
}

function payroll_require_staff_role(string $roleKey): void
{
    if (!payroll_is_staff_role($roleKey)) {
        json_response([
            'success' => false,
            'message' => 'Only administrators, HR Head, and HR Staff can manage payroll records.',
        ], 403);
    }
}

function payroll_require_approval_role(string $roleKey): void
{
    if (!payroll_is_approval_role($roleKey)) {
        json_response([
            'success' => false,
            'message' => 'Only administrators and HR Head can approve, reject, or pay payroll records.',
        ], 403);
    }
}

function payroll_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function payroll_nullable_text(mixed $value): ?string
{
    $trimmed = payroll_text($value);
    return $trimmed === '' ? null : $trimmed;
}

function payroll_decimal(mixed $value): float
{
    if ($value === null || $value === '') {
        return 0.0;
    }

    if (!is_numeric($value)) {
        return 0.0;
    }

    return round((float)$value, 2);
}

function payroll_decimal_string(float $value): string
{
    return number_format($value, 2, '.', '');
}

function payroll_database_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );
    $statement->execute([':table_name' => $table]);

    return (int)$statement->fetchColumn() > 0;
}

function payroll_log_deduction_debug(string $message, array $context = []): void
{
    $encodedContext = $context !== []
        ? ' ' . json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        : '';

    error_log('[Payroll Deductions] ' . $message . $encodedContext);
}

function payroll_normalize_deduction_key(string $name): string
{
    return preg_replace('/[^a-z0-9]/', '', strtolower($name)) ?? '';
}

function payroll_deduction_field_for_name(string $name): ?string
{
    $key = payroll_normalize_deduction_key($name);
    return PAYROLL_DEDUCTION_FIELD_ALIASES[$key] ?? PAYROLL_DEDUCTION_FIELD_MAP[$name] ?? null;
}

function payroll_category_id_from_name(string $categoryName): int
{
    $normalized = payroll_normalize_deduction_key($categoryName);
    return (int)(sprintf('%u', crc32($normalized !== '' ? $normalized : 'otherdeductions')) % 2147483646) + 1;
}

/**
 * GSIS, PHIC, HDMF and other deductions used to live in four structurally identical tables, one per
 * category, created here on every request. They are now rows in `deduction_types` under a
 * `deduction_categories` row, so provisioning is a single shared step.
 *
 * @see backend/database/normalize_deductions.sql
 */
function payroll_ensure_deduction_definition_tables(PDO $pdo): void
{
    deduction_catalog_ensure_schema($pdo);
}

function payroll_ensure_deduction_engine_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    payroll_ensure_deduction_definition_tables($pdo);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS PayrollDeduction (
            payroll_deduction_id INT PRIMARY KEY AUTO_INCREMENT,
            payroll_id INT NOT NULL,
            deduction_type_id INT UNSIGNED NOT NULL,
            amount DECIMAL(10,2) NULL,
            FOREIGN KEY (payroll_id)
                REFERENCES Payroll(payroll_id),
            /*
             * No foreign key on deduction_type_id: the catalog is split across six family tables
             * and a single column cannot reference all of them. Ids are kept unique across those
             * tables by their AUTO_INCREMENT bands, and deduction_catalog_union_sql() resolves them.
             */
            KEY idx_payrolldeduction_type (deduction_type_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    if (!hris_database_column_exists($pdo, 'PayrollDeduction', 'amount')) {
        $pdo->exec('ALTER TABLE PayrollDeduction ADD COLUMN amount DECIMAL(10,2) NULL AFTER deduction_type_id');
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS EmployeeDeduction (
            employee_deduction_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_id INT UNSIGNED NOT NULL,
            deduction_type_id INT UNSIGNED NOT NULL,
            amount DECIMAL(12,2) NULL,
            rate DECIMAL(9,4) NULL,
            calculation_type VARCHAR(20) NOT NULL DEFAULT "fixed",
            basis VARCHAR(40) NOT NULL DEFAULT "basic_salary",
            frequency VARCHAR(30) NOT NULL DEFAULT "monthly",
            effective_start DATE NULL,
            effective_end DATE NULL,
            is_recurring TINYINT(1) NOT NULL DEFAULT 1,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            remarks TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (employee_deduction_id),
            KEY idx_employee_deductions_employee (employee_id),
            KEY idx_employee_deductions_type (deduction_type_id),
            KEY idx_employee_deductions_active (is_active, is_recurring),
            CONSTRAINT fk_employee_deductions_employee
                FOREIGN KEY (employee_id) REFERENCES employees(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $employeeDeductionColumns = [
        'amount' => 'DECIMAL(12,2) NULL AFTER deduction_type_id',
        'rate' => 'DECIMAL(9,4) NULL AFTER amount',
        'calculation_type' => 'VARCHAR(20) NOT NULL DEFAULT "fixed" AFTER rate',
        'basis' => 'VARCHAR(40) NOT NULL DEFAULT "basic_salary" AFTER calculation_type',
        'frequency' => 'VARCHAR(30) NOT NULL DEFAULT "monthly" AFTER basis',
        'effective_start' => 'DATE NULL AFTER frequency',
        'effective_end' => 'DATE NULL AFTER effective_start',
        'is_recurring' => 'TINYINT(1) NOT NULL DEFAULT 1 AFTER effective_end',
        'is_active' => 'TINYINT(1) NOT NULL DEFAULT 1 AFTER is_recurring',
        'remarks' => 'TEXT NULL AFTER is_active',
    ];

    foreach ($employeeDeductionColumns as $column => $definition) {
        if (!hris_database_column_exists($pdo, 'EmployeeDeduction', $column)) {
            $pdo->exec("ALTER TABLE EmployeeDeduction ADD COLUMN {$column} {$definition}");
        }
    }

    payroll_seed_deduction_engine_defaults($pdo);
    $ensured = true;
}

function payroll_seed_deduction_engine_defaults(PDO $pdo): void
{
    /*
     * The category decides which family table the row is looked up in, so these must name real
     * families. They previously read "Government Contributions" / "Loan Deductions", which match no
     * family and therefore all fell through to `other` — the seeder then created a second GSIS, HDMF,
     * PHIC, PhilHealth, Pag-IBIG and Withholding Tax there and configured those copies instead of
     * the rows payroll actually charges.
     */
    $defaults = [
        ['Withholding Tax', 'Withholding Tax', 'percentage', 0.00, 0.0000, 'taxable_income', 0, 1],
        ['Other Deductions', 'SSS', 'percentage', 0.00, 4.5000, 'basic_salary', 1, 0],
        ['GSIS', 'GSIS', 'percentage', 0.00, 9.0000, 'basic_salary', 1, 1],
        ['Pag-IBIG', 'HDMF', 'fixed', 200.00, 0.0000, 'basic_salary', 1, 1],
        ['Pag-IBIG', 'Pag-IBIG', 'fixed', 200.00, 0.0000, 'basic_salary', 1, 0],
        ['PHIC', 'PHIC', 'percentage', 0.00, 2.5000, 'basic_salary', 1, 1],
        ['PHIC', 'PhilHealth', 'percentage', 0.00, 2.5000, 'basic_salary', 1, 0],
        ['Attendance Deductions', 'Late Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Attendance Deductions', 'Absence Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Attendance Deductions', 'Undertime Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Other Deductions', 'Manual Cash Advance Adjustment', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Other Deductions', 'Laptop Loan', 'fixed', 0.00, 0.0000, 'basic_salary', 1, 1],
        ['Other Deductions', 'Other Deductions', 'fixed', 0.00, 0.0000, 'basic_salary', 1, 1],
        ['Other Deductions', 'Custom Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
    ];

    /*
     * Seeds only fill gaps. A rate an administrator has since changed in Settings must survive a
     * redeploy, so each CASE writes the default only where the column is still at its zero value —
     * these rows are now the same rows Settings edits, not a private copy.
     */
    // Prepared per family table, because the seed rows are spread across all six.
    $statements = [];
    $statementFor = static function (string $table) use ($pdo, &$statements): PDOStatement {
        return $statements[$table] ??= $pdo->prepare(
            "UPDATE `{$table}`
             SET default_amount = CASE
                     WHEN COALESCE(default_amount, 0.00) = 0.00 THEN :default_amount
                     ELSE default_amount
                 END,
                 calculation_type = CASE
                     WHEN calculation_type = \"fixed\" THEN :calculation_type
                     ELSE calculation_type
                 END,
                 default_rate = CASE
                     WHEN COALESCE(default_rate, 0.0000) = 0.0000 THEN :default_rate
                     ELSE default_rate
                 END,
                 basis = CASE
                     WHEN basis IS NULL OR basis = \"\" OR basis = \"basic_salary\" THEN :basis
                     ELSE basis
                 END,
                 is_recurring = :is_recurring,
                 is_active = :is_active
             WHERE id = :deduction_type_id"
        );
    };

    foreach ($defaults as [$categoryName, $deductionName, $calculationType, $amount, $rate, $basis, $isRecurring, $isActive]) {
        $deductionTypeId = payroll_resolve_deduction_type($pdo, $categoryName, $deductionName);
        $table = deduction_catalog_table_for_id($pdo, $deductionTypeId);

        if ($table === null) {
            continue;
        }

        $statementFor($table)->execute([
            ':default_amount' => payroll_decimal_string((float)$amount),
            ':calculation_type' => $calculationType,
            ':default_rate' => number_format((float)$rate, 4, '.', ''),
            ':basis' => $basis,
            ':is_recurring' => (int)$isRecurring,
            ':is_active' => (int)$isActive,
            ':deduction_type_id' => $deductionTypeId,
        ]);
    }
}

function payroll_monthly_hourly_rate(float $monthlySalary): float
{
    if ($monthlySalary <= 0) {
        return 0.0;
    }

    return $monthlySalary / PAYROLL_WORKING_DAYS_PER_MONTH / PAYROLL_WORKING_HOURS_PER_DAY;
}

/**
 * The per-day and per-hour money a salary is worth, for charging absence, tardiness and undertime.
 *
 * Read from `attendance_deductions` rather than recomputed here, so the rates an administrator can
 * see and edit in Settings are the rates payroll charges. Those rows carry a percentage of monthly
 * salary — 4.5455% a day, 0.5682% an hour — which is DBM Budget Circular 004-03's monthly / 22 / 8
 * expressed as a rate. Falls back to the constants when a row is missing or has no rate, so a
 * half-seeded database still charges the right amount.
 */
function payroll_attendance_rates(PDO $pdo, float $basicSalary): array
{
    static $rates = null;

    if ($basicSalary <= 0) {
        return ['daily' => 0.0, 'hourly' => 0.0];
    }

    if ($rates === null) {
        $rates = ['per_day' => null, 'per_hour' => null];

        foreach (deduction_catalog_types($pdo, ['categoryCode' => 'attendance']) as $type) {
            $basis = $type['basis'];

            if (array_key_exists($basis, $rates) && $rates[$basis] === null && $type['defaultRate'] > 0) {
                $rates[$basis] = $type['defaultRate'];
            }
        }
    }

    $daily = $rates['per_day'] !== null
        ? $basicSalary * ($rates['per_day'] / 100)
        : $basicSalary / PAYROLL_WORKING_DAYS_PER_MONTH;

    $hourly = $rates['per_hour'] !== null
        ? $basicSalary * ($rates['per_hour'] / 100)
        : payroll_monthly_hourly_rate($basicSalary);

    return ['daily' => $daily, 'hourly' => $hourly];
}

/**
 * BIR monthly withholding tax on compensation.
 *
 * The brackets come from the `Withholding Tax` row in the catalog, so the table an administrator
 * sees in Settings is the table payroll charges. PAYROLL_WITHHOLDING_TAX_BRACKETS below is the
 * fallback for a database that has not been seeded yet.
 *
 * These are the TRAIN Law (RA 10963) second-phase rates, in force since 1 January 2023. The
 * hard-coded table this replaced still held the 2018-2022 first-phase rates — 20/25/30/32% against
 * the correct 15/20/25/30%, with base amounts to match — so every employee above the exemption was
 * over-withheld. On a ₱43,000 taxable month that was ₱4,916.75 charged against ₱3,808.40 due.
 */
function payroll_calculate_withholding_tax(float $monthlyTaxableIncome, ?PDO $pdo = null): float
{
    if ($monthlyTaxableIncome <= 0) {
        return 0.0;
    }

    $rules = $pdo !== null ? payroll_withholding_tax_brackets($pdo) : null;

    return round(deduction_catalog_compute_tiered(
        [
            'thresholdRules' => $rules ?? PAYROLL_WITHHOLDING_TAX_BRACKETS,
            'defaultAmount' => 0,
        ],
        $monthlyTaxableIncome
    ), 2);
}

/** The catalog's bracket table, or null when it carries none. */
function payroll_withholding_tax_brackets(PDO $pdo): ?array
{
    static $cached = false;
    static $rules = null;

    if ($cached) {
        return $rules;
    }

    $cached = true;

    foreach (deduction_catalog_types($pdo, ['categoryCode' => 'tax']) as $type) {
        if ($type['name'] === 'Withholding Tax' && is_array($type['thresholdRules']) && $type['thresholdRules'] !== []) {
            $rules = $type['thresholdRules'];
            break;
        }
    }

    return $rules;
}

function payroll_approved_overtime_hours(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate): float
{
    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'overtime')
    ) {
        return 0.0;
    }

    $dateColumn = hris_database_column_exists($pdo, 'overtime', 'work_date')
        ? 'work_date'
        : (hris_database_column_exists($pdo, 'overtime', 'overtime_date') ? 'overtime_date' : '');
    if ($dateColumn === '') {
        return 0.0;
    }

    $hoursColumn = '';
    foreach (['hour_requested', 'overtime_hours', 'hours_worked', 'duration'] as $column) {
        if (hris_database_column_exists($pdo, 'overtime', $column)) {
            $hoursColumn = $column;
            break;
        }
    }

    if ($hoursColumn === '') {
        return 0.0;
    }

    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM({$hoursColumn}), 0)
         FROM overtime
         WHERE employee_id = :employee_id
           AND LOWER(status) = 'approved'
           AND {$dateColumn} BETWEEN :start_date AND :end_date"
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return payroll_decimal($statement->fetchColumn());
}

function payroll_approved_pass_slip_hours(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate): float
{
    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'pass_slip')
        || !hris_database_column_exists($pdo, 'pass_slip', 'pass_date')
        || !hris_database_column_exists($pdo, 'pass_slip', 'departure_time')
        || !hris_database_column_exists($pdo, 'pass_slip', 'time_returned')
    ) {
        return 0.0;
    }

    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM(GREATEST(TIME_TO_SEC(TIMEDIFF(time_returned, departure_time)), 0) / 3600), 0)
         FROM pass_slip
         WHERE employee_id = :employee_id
           AND LOWER(status) = 'approved'
           AND pass_date BETWEEN :start_date AND :end_date"
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return payroll_decimal($statement->fetchColumn());
}

function payroll_deduction_frequency_factor(string $frequency, string $payPeriod): float
{
    $frequency = strtolower(trim($frequency));

    return match ($frequency) {
        'monthly' => $payPeriod === 'Monthly' ? 1.0 : 0.5,
        'first_half', '1st_half', 'first half' => $payPeriod === '1st Half' ? 1.0 : 0.0,
        'second_half', '2nd_half', 'second half' => $payPeriod === '2nd Half' ? 1.0 : 0.0,
        'one_time', 'once', 'per_payroll', 'payroll' => 1.0,
        default => 1.0,
    };
}

function payroll_deduction_basis_amount(string $basis, float $basicSalary, float $grossPay, float $taxableIncome): float
{
    return match (strtolower(trim($basis))) {
        'gross', 'gross_pay' => $grossPay,
        'taxable', 'taxable_income' => $taxableIncome,
        default => $basicSalary,
    };
}

function payroll_calculated_deduction_amount(
    array $row,
    float $basicSalary,
    float $grossPay,
    float $taxableIncome,
    string $payPeriod
): float {
    $name = payroll_text($row['deductionName'] ?? $row['deduction_name'] ?? '');
    $calculationType = strtolower(payroll_text($row['calculationType'] ?? $row['calculation_type'] ?? 'fixed'));
    $basis = payroll_text($row['basis'] ?? 'basic_salary') ?: 'basic_salary';
    $frequency = payroll_text($row['frequency'] ?? 'monthly') ?: 'monthly';
    $factor = payroll_deduction_frequency_factor($frequency, $payPeriod);

    if ($factor <= 0) {
        return 0.0;
    }

    $base = payroll_deduction_basis_amount($basis, $basicSalary, $grossPay, $taxableIncome);

    /*
     * The salary a rate applies to is clamped before the rate is applied. This is what makes a
     * contribution like "2.5% of salary, but never on more than ₱100,000" express itself, and it was
     * missing: base_floor and base_cap were stored but never read, so PhilHealth charged 2.5% of the
     * full salary and a ₱123,123 earner was billed ₱3,078.08 against the ₱2,500 statutory maximum.
     */
    $floor = (float)($row['baseFloor'] ?? $row['base_floor'] ?? 0);
    $cap = $row['baseCap'] ?? $row['base_cap'] ?? null;

    if ($floor > 0) {
        $base = max($base, $floor);
    }

    if ($cap !== null && $cap !== '' && (float)$cap > 0) {
        $base = min($base, (float)$cap);
    }

    if ($calculationType === 'percentage') {
        $rate = $row['rate'] ?? $row['defaultRate'] ?? $row['default_rate'] ?? null;

        if ($rate === null || $rate === '' || !is_numeric($rate)) {
            payroll_log_deduction_debug('Percentage deduction skipped because rate is missing or invalid.', [
                'deduction' => $name,
                'rate' => $rate,
            ]);
            return 0.0;
        }

        return round(($base * ((float)$rate / 100)) * $factor, 2);
    }

    // Bracket tables (the withholding schedule, Pag-IBIG's 1%/2% split) charge per band.
    if ($calculationType === 'tiered' || $calculationType === 'bracket') {
        $rules = $row['thresholdRules'] ?? $row['threshold_rules'] ?? null;

        if (is_string($rules)) {
            $rules = json_decode($rules, true);
        }

        if (is_array($rules) && $rules !== []) {
            return round(deduction_catalog_compute_tiered([
                'thresholdRules' => $rules,
                'defaultAmount' => $row['amount'] ?? $row['defaultAmount'] ?? $row['default_amount'] ?? 0,
            ], $base) * $factor, 2);
        }
    }

    $amount = $row['amount'] ?? $row['defaultAmount'] ?? $row['default_amount'] ?? null;
    if ($amount === null || $amount === '' || !is_numeric($amount)) {
        payroll_log_deduction_debug('Fixed deduction skipped because amount is missing or invalid.', [
            'deduction' => $name,
            'amount' => $amount,
        ]);
        return 0.0;
    }

    return round(((float)$amount) * $factor, 2);
}

function payroll_fetch_employee_deduction_rows(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate): array
{
    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'EmployeeDeduction')
    ) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT
            ed.employee_deduction_id AS employeeDeductionId,
            ed.employee_id AS employeeRecordId,
            ed.deduction_type_id AS deductionTypeId,
            dt.deduction_name AS deductionName,
            dt.category_name AS categoryName,
            COALESCE(ed.amount, dt.default_amount) AS amount,
            COALESCE(ed.rate, dt.default_rate) AS rate,
            COALESCE(NULLIF(ed.calculation_type, ""), dt.calculation_type, "fixed") AS calculationType,
            COALESCE(NULLIF(ed.basis, ""), dt.basis, "basic_salary") AS basis,
            dt.base_floor AS baseFloor,
            dt.base_cap AS baseCap,
            dt.threshold_rules AS thresholdRules,
            COALESCE(NULLIF(ed.frequency, ""), "monthly") AS frequency,
            ed.effective_start AS effectiveStart,
            ed.effective_end AS effectiveEnd,
            "employee" AS source
         FROM EmployeeDeduction ed
         INNER JOIN ' . deduction_catalog_type_union_sql() . ' dt
                 ON dt.deduction_type_id = ed.deduction_type_id
         WHERE ed.employee_id = :employee_id
           AND ed.is_active = 1
           AND ed.is_recurring = 1
           AND COALESCE(dt.is_active, 1) = 1
           AND (ed.effective_start IS NULL OR ed.effective_start <= :end_date)
           AND (ed.effective_end IS NULL OR ed.effective_end >= :start_date)
         ORDER BY ed.employee_deduction_id ASC'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return $statement->fetchAll();
}

function payroll_fetch_global_recurring_deduction_rows(PDO $pdo, array $excludedKeys = []): array
{
    $statement = $pdo->query(
        'SELECT
            dt.deduction_type_id AS deductionTypeId,
            dt.deduction_name AS deductionName,
            dt.category_name AS categoryName,
            dt.default_amount AS amount,
            dt.default_rate AS rate,
            dt.calculation_type AS calculationType,
            dt.basis AS basis,
            dt.base_floor AS baseFloor,
            dt.base_cap AS baseCap,
            dt.threshold_rules AS thresholdRules,
            "monthly" AS frequency,
            "global" AS source
         FROM ' . deduction_catalog_type_union_sql() . ' dt
         WHERE COALESCE(dt.is_active, 1) = 1
           AND COALESCE(dt.is_recurring, 0) = 1
         ORDER BY dt.deduction_type_id ASC'
    );

    $rows = [];
    foreach ($statement->fetchAll() as $row) {
        $key = payroll_normalize_deduction_key((string)($row['deductionName'] ?? ''));
        if (isset($excludedKeys[$key])) {
            continue;
        }
        $rows[] = $row;
    }

    return $rows;
}

function payroll_extract_repayment_months(string $repaymentTerms): ?int
{
    if (preg_match('/(\d+)\s*(month|months|mos|mo|installment|installments)/i', $repaymentTerms, $matches) === 1) {
        return max(1, (int)$matches[1]);
    }

    if (preg_match('/(\d+)/', $repaymentTerms, $matches) === 1) {
        return max(1, (int)$matches[1]);
    }

    return null;
}

function payroll_fetch_approved_loan_deduction_items(PDO $pdo, int $employeeRecordId, ?string $endDate, string $payPeriod): array
{
    if (
        $employeeRecordId <= 0
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'loan_requests')
    ) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT id, loan_type AS loanType, loan_amount AS loanAmount, repayment_terms AS repaymentTerms, date_filed AS dateFiled
         FROM loan_requests
         WHERE employee_id = :employee_id
           AND status = "Approved"
           AND is_archived = 0
           AND date_filed <= :end_date
         ORDER BY date_filed ASC, id ASC'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':end_date' => $endDate,
    ]);

    $items = [];
    foreach ($statement->fetchAll() as $loan) {
        $months = payroll_extract_repayment_months((string)($loan['repaymentTerms'] ?? ''));
        if ($months === null) {
            payroll_log_deduction_debug('Approved loan skipped because repayment terms do not contain a month count.', [
                'loanRequestId' => (int)($loan['id'] ?? 0),
                'employeeRecordId' => $employeeRecordId,
                'repaymentTerms' => $loan['repaymentTerms'] ?? null,
            ]);
            continue;
        }

        $monthlyAmount = payroll_decimal($loan['loanAmount'] ?? 0) / $months;
        $amount = round($monthlyAmount * payroll_deduction_frequency_factor('monthly', $payPeriod), 2);
        if ($amount <= 0) {
            continue;
        }

        $items[] = [
            'name' => payroll_text($loan['loanType'] ?? 'Loan Deduction') ?: 'Loan Deduction',
            // Loans live in the `other_deductions` family; "Loan Deductions" matches none.
            'category' => 'Other Deductions',
            'amount' => $amount,
            'source' => 'approved_loan',
            'referenceId' => (int)($loan['id'] ?? 0),
        ];
    }

    return $items;
}

function payroll_apply_resolved_deduction_items(array $payload, array $items): array
{
    $fieldTotals = [];
    $additionalItems = [];

    foreach ($items as $item) {
        $name = payroll_text($item['name'] ?? $item['deductionName'] ?? '');
        $amount = payroll_decimal($item['amount'] ?? 0);

        if ($name === '' || $amount <= 0) {
            continue;
        }

        $field = payroll_deduction_field_for_name($name);
        if ($field !== null && $field !== 'withholdingTax') {
            $fieldTotals[$field] = ($fieldTotals[$field] ?? 0.0) + $amount;
            continue;
        }

        if ($field === 'withholdingTax') {
            payroll_log_deduction_debug('Configured withholding tax deduction ignored because payroll tax is calculated separately.', [
                'deduction' => $name,
                'amount' => $amount,
            ]);
            continue;
        }

        $additionalItems[] = [
            'name' => $name,
            'category' => payroll_text($item['category'] ?? $item['categoryName'] ?? '') ?: 'Other Deductions',
            'amount' => $amount,
        ];
    }

    foreach ($fieldTotals as $field => $amount) {
        if ($amount > 0) {
            $payload[$field] = payroll_decimal($amount);
        }
    }

    $payload['additionalDeductionItems'] = $additionalItems;
    $payload['additionalDeductionsTotal'] = round(array_reduce(
        $additionalItems,
        static fn (float $sum, array $item): float => $sum + payroll_decimal($item['amount'] ?? 0),
        0.0
    ), 2);

    return $payload;
}

function payroll_apply_recurring_deductions(PDO $pdo, array $payload, array $employee, float $basicSalary): array
{
    payroll_ensure_deduction_engine_schema($pdo);

    $employeeRecordId = (int)($employee['id'] ?? $payload['employeeRecordId'] ?? 0);
    $grossPreview = round(
        $basicSalary
        + $payload['overtimePay']
        + $payload['pera']
        + $payload['travelAllowance']
        + $payload['salaryAdjustment']
        + $payload['otherAllowances']
        + $payload['bonusAmount'],
        2
    );
    $taxableIncome = payroll_decimal($payload['withholdingTaxBase'] ?? $basicSalary);
    $employeeRows = payroll_fetch_employee_deduction_rows($pdo, $employeeRecordId, $payload['startDate'], $payload['endDate']);
    $employeeKeys = [];
    foreach ($employeeRows as $row) {
        $employeeKeys[payroll_normalize_deduction_key((string)($row['deductionName'] ?? ''))] = true;
    }

    $globalRows = payroll_fetch_global_recurring_deduction_rows($pdo, $employeeKeys);
    $resolvedItems = [];
    $diagnostics = [];

    foreach ([...$employeeRows, ...$globalRows] as $row) {
        $amount = payroll_calculated_deduction_amount(
            $row,
            $basicSalary,
            $grossPreview,
            $taxableIncome,
            $payload['payPeriod']
        );

        if ($amount <= 0) {
            $diagnostics[] = [
                'deduction' => payroll_text($row['deductionName'] ?? ''),
                'source' => payroll_text($row['source'] ?? ''),
                'message' => 'No amount was applied. Check fixed amount or percentage rate.',
            ];
            continue;
        }

        $resolvedItems[] = [
            'name' => payroll_text($row['deductionName'] ?? ''),
            'category' => payroll_text($row['categoryName'] ?? 'Deductions') ?: 'Deductions',
            'amount' => $amount,
            'source' => payroll_text($row['source'] ?? ''),
        ];
    }

    $loanItems = payroll_fetch_approved_loan_deduction_items(
        $pdo,
        $employeeRecordId,
        $payload['endDate'],
        $payload['payPeriod']
    );
    $resolvedItems = [...$resolvedItems, ...$loanItems];

    if ($employeeRows === []) {
        $diagnostics[] = [
            'employeeRecordId' => $employeeRecordId,
            'message' => 'No employee-specific recurring deductions were found; global recurring defaults were used where available.',
        ];
    }

    $payload = payroll_apply_resolved_deduction_items($payload, $resolvedItems);
    $payload['deductionDiagnostics'] = $diagnostics;

    foreach ($diagnostics as $diagnostic) {
        payroll_log_deduction_debug('Deduction diagnostic.', $diagnostic);
    }

    return $payload;
}

function payroll_system_workday_numbers(PDO $pdo): array
{
    $configuration = json_decode(hris_get_application_setting($pdo, 'system_configuration', '{}'), true);
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

function payroll_non_working_holiday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    if (!payroll_database_table_exists($pdo, 'holidays')) {
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
    $year = substr($startDate, 0, 4);

    foreach ($statement->fetchAll() as $row) {
        $holidayDate = payroll_date_or_null($row['holidayDate'] ?? null);

        if ($holidayDate === null) {
            continue;
        }

        if ((int)($row['isRecurring'] ?? 0) === 1) {
            $holidayDate = $year . substr($holidayDate, 4);
        }

        if ($holidayDate >= $startDate && $holidayDate <= $endDate) {
            $holidays[$holidayDate] = true;
        }
    }

    return $holidays;
}

function payroll_workday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    $holidays = payroll_non_working_holiday_dates($pdo, $startDate, $endDate);
    $workdayNumbers = array_flip(payroll_system_workday_numbers($pdo));
    $workdays = [];
    $current = new DateTimeImmutable($startDate);
    $end = new DateTimeImmutable($endDate);

    while ($current <= $end) {
        $dateKey = $current->format('Y-m-d');
        $dayOfWeek = (int)$current->format('N');

        if (isset($workdayNumbers[$dayOfWeek]) && !isset($holidays[$dateKey])) {
            $workdays[$dateKey] = true;
        }

        $current = $current->modify('+1 day');
    }

    return $workdays;
}

function payroll_approved_leave_dates(PDO $pdo, int $employeeRecordId, string $startDate, string $endDate, array $workdayDates): array
{
    if (!payroll_database_table_exists($pdo, 'leave_requests')) {
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
        $requestStart = payroll_date_or_null($row['startDate'] ?? null);
        $requestEnd = payroll_date_or_null($row['endDate'] ?? null);

        if ($requestStart === null || $requestEnd === null) {
            continue;
        }

        $rangeStart = max($requestStart, $startDate);
        $rangeEnd = min($requestEnd, $endDate);
        $current = new DateTimeImmutable($rangeStart);
        $end = new DateTimeImmutable($rangeEnd);

        while ($current <= $end) {
            $dateKey = $current->format('Y-m-d');

            if (isset($workdayDates[$dateKey])) {
                $leaveDates[$dateKey] = true;
            }

            $current = $current->modify('+1 day');
        }
    }

    return $leaveDates;
}

function payroll_attendance_deductions(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate, float $basicSalary): array
{
    $empty = [
        'renderedMinutes' => 0,
        'lateMinutes' => 0,
        'undertimeMinutes' => 0,
        'lateHours' => 0.0,
        'undertimeHours' => 0.0,
        'absentDays' => 0,
        'leaveDays' => 0,
        'expectedWorkdays' => 0,
        'lateDeduction' => 0.0,
        'absenceDeduction' => 0.0,
        'undertimeDeduction' => 0.0,
        'hasAttendanceCoverage' => false,
    ];

    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || $startDate > $endDate
        || !payroll_database_table_exists($pdo, 'attendance_daily_records')
    ) {
        return $empty;
    }

    $coverageStatement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM attendance_daily_records
         WHERE attendance_date BETWEEN :start_date AND :end_date'
    );
    $coverageStatement->execute([
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    if ((int)$coverageStatement->fetchColumn() === 0) {
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
    $totals = $empty;
    $datesWithEntries = [];

    foreach ($records as $record) {
        $recordDate = payroll_date_or_null($record['attendanceDate'] ?? null);
        $totalMinutes = (int)($record['totalMinutes'] ?? 0);

        $totals['renderedMinutes'] += $totalMinutes;
        $totals['lateMinutes'] += (int)($record['lateMinutes'] ?? 0);
        $totals['undertimeMinutes'] += (int)($record['undertimeMinutes'] ?? 0);

        if (
            $recordDate !== null
            && (
                payroll_text($record['timeIn'] ?? '') !== ''
                || payroll_text($record['timeOut'] ?? '') !== ''
                || $totalMinutes > 0
            )
        ) {
            $datesWithEntries[$recordDate] = true;
        }
    }

    $workdayDates = payroll_workday_dates($pdo, $startDate, $endDate);
    $leaveDates = payroll_approved_leave_dates($pdo, $employeeRecordId, $startDate, $endDate, $workdayDates);
    $absentDays = 0;

    foreach ($workdayDates as $date => $_) {
        if (!isset($datesWithEntries[$date]) && !isset($leaveDates[$date])) {
            $absentDays++;
        }
    }

    $rates = payroll_attendance_rates($pdo, $basicSalary);
    $hourlyRate = $rates['hourly'];
    $dailyRate = $rates['daily'];
    $lateHours = $totals['lateMinutes'] / 60;
    $undertimeHours = $totals['undertimeMinutes'] / 60;

    return [
        ...$totals,
        'lateHours' => payroll_decimal($lateHours),
        'undertimeHours' => payroll_decimal($undertimeHours),
        'absentDays' => $absentDays,
        'leaveDays' => count($leaveDates),
        'expectedWorkdays' => count($workdayDates),
        'lateDeduction' => round($lateHours * $hourlyRate, 2),
        'absenceDeduction' => round($absentDays * $dailyRate, 2),
        'undertimeDeduction' => round($undertimeHours * $hourlyRate, 2),
        'hasAttendanceCoverage' => true,
    ];
}

function payroll_date_or_null(mixed $value): ?string
{
    $value = payroll_nullable_text($value);

    if ($value === null) {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $value);
    return $date && $date->format('Y-m-d') === $value ? $value : null;
}

function payroll_lookup_allowance_amount(PDO $pdo, string $allowanceName, float $fallback = 0.0): float
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
        return $fallback;
    }

    return payroll_decimal($amount);
}

function payroll_default_settings(PDO $pdo): array
{
    return [
        'pera' => payroll_lookup_allowance_amount($pdo, 'PERA', PAYROLL_DEFAULT_PERA_AMOUNT),
        /*
         * The register's deduction columns. These were 34 names typed into the payroll workspace,
         * so a deduction added in Settings never got a column and one removed left a dead one.
         * `show_in_payroll` on each catalog row decides now, and the order follows the catalog's
         * category and type sort order.
         */
        'deductionColumns' => array_map(
            static fn (array $type): array => [
                'code' => $type['code'],
                'name' => $type['name'],
                'category' => $type['categoryName'],
                'categoryCode' => $type['categoryCode'],
            ],
            deduction_catalog_types($pdo, ['activeOnly' => true, 'payrollOnly' => true])
        ),
    ];
}

function payroll_payload(PDO $pdo, array $body): array
{
    $overtimeHours = payroll_decimal($body['overtimeHours'] ?? 0);
    $overtimeRate = payroll_decimal($body['overtimeRate'] ?? 0);
    $overtimePay = round($overtimeHours * $overtimeRate, 2);

    return [
        'employeeRecordId' => (int)($body['employeeRecordId'] ?? 0),
        'payPeriod' => payroll_text($body['payPeriod'] ?? ''),
        'startDate' => payroll_date_or_null($body['startDate'] ?? null),
        'endDate' => payroll_date_or_null($body['endDate'] ?? null),
        'overtimeHours' => $overtimeHours,
        'overtimeRate' => $overtimeRate,
        'overtimePay' => $overtimePay,
        'pera' => payroll_lookup_allowance_amount($pdo, 'PERA', PAYROLL_DEFAULT_PERA_AMOUNT),
        'travelAllowance' => payroll_decimal($body['travelAllowance'] ?? 0),
        'salaryAdjustment' => payroll_decimal($body['salaryAdjustment'] ?? 0),
        'otherAllowances' => payroll_decimal($body['otherAllowances'] ?? 0),
        'bonusAmount' => payroll_decimal($body['bonusAmount'] ?? 0),
        'lateDeduction' => payroll_decimal($body['lateDeduction'] ?? 0),
        'absenceDeduction' => payroll_decimal($body['absenceDeduction'] ?? 0),
        'undertimeDeduction' => payroll_decimal($body['undertimeDeduction'] ?? 0),
        'withholdingTax' => payroll_decimal($body['withholdingTax'] ?? 0),
        'sss' => payroll_decimal($body['sss'] ?? 0),
        'gsis' => payroll_decimal($body['gsis'] ?? 0),
        'hdmf' => payroll_decimal($body['hdmf'] ?? 0),
        'phic' => payroll_decimal($body['phic'] ?? 0),
        'manualCashAdvanceAdjustment' => payroll_decimal($body['manualCashAdvanceAdjustment'] ?? 0),
        'laptopLoan' => payroll_decimal($body['laptopLoan'] ?? 0),
        'otherDeductions' => payroll_decimal($body['otherDeductions'] ?? 0),
        'additionalDeductionItems' => [],
        'additionalDeductionsTotal' => 0.0,
        'deductionDiagnostics' => [],
        'status' => payroll_text($body['status'] ?? 'Draft'),
        'notes' => payroll_nullable_text($body['notes'] ?? null),
    ];
}

function payroll_fetch_employee_snapshot(PDO $pdo, int $employeeRecordId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            des.name AS designation,
            d.name AS division,
            e.employment_status AS employmentType,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            e.profile_image AS profileImage
         FROM employees e
         INNER JOIN divisions d ON d.id = e.division_id
         INNER JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeRecordId]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

function payroll_validate_payload(PDO $pdo, array $payload, bool $allowArchivedStatus = false): array
{
    $errors = [];

    if ($payload['employeeRecordId'] <= 0) {
        $errors[] = 'Employee is required.';
    }

    if (!in_array($payload['payPeriod'], PAYROLL_ALLOWED_PERIODS, true)) {
        $errors[] = 'Pay period is required.';
    }

    if ($payload['startDate'] === null) {
        $errors[] = 'Start date is required.';
    }

    if ($payload['endDate'] === null) {
        $errors[] = 'End date is required.';
    }

    if ($payload['startDate'] !== null && $payload['endDate'] !== null && $payload['startDate'] > $payload['endDate']) {
        $errors[] = 'End date must be on or after the start date.';
    }

    $allowedStatuses = $allowArchivedStatus
        ? PAYROLL_ALL_STATUSES
        : PAYROLL_ACTIVE_STATUSES;
    if (!in_array(payroll_normalize_status($payload['status']), $allowedStatuses, true)) {
        $errors[] = 'Selected payroll status is invalid.';
    }

    $employee = $payload['employeeRecordId'] > 0
        ? payroll_fetch_employee_snapshot($pdo, $payload['employeeRecordId'])
        : null;

    if ($payload['employeeRecordId'] > 0 && $employee === null) {
        $errors[] = 'Selected employee record is unavailable.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    return $employee;
}

function payroll_calculate_totals(array $payload, array $employee): array
{
    $basicSalary = payroll_decimal($employee['basicSalary'] ?? 0);
    $totalAllowance = round(
        $payload['overtimePay']
        + $payload['pera']
        + $payload['travelAllowance']
        + $payload['salaryAdjustment']
        + $payload['otherAllowances']
        + $payload['bonusAmount'],
        2
    );
    $grossPay = round($basicSalary + $totalAllowance, 2);
    $totalDeduction = round(
        $payload['lateDeduction']
        + $payload['absenceDeduction']
        + $payload['undertimeDeduction']
        + $payload['withholdingTax']
        + ($payload['sss'] ?? 0)
        + $payload['gsis']
        + $payload['hdmf']
        + $payload['phic']
        + $payload['manualCashAdvanceAdjustment']
        + $payload['laptopLoan']
        + $payload['otherDeductions']
        + ($payload['additionalDeductionsTotal'] ?? 0),
        2
    );
    $netPay = round($grossPay - $totalDeduction, 2);

    return [
        'basicSalary' => $basicSalary,
        'totalAllowance' => $totalAllowance,
        'grossPay' => $grossPay,
        'totalDeduction' => $totalDeduction,
        'netPay' => $netPay,
    ];
}

function payroll_apply_automatic_calculations(PDO $pdo, array $payload, array $employee): array
{
    $basicSalary = payroll_decimal($employee['basicSalary'] ?? 0);
    $employeeRecordId = (int)($employee['id'] ?? $payload['employeeRecordId'] ?? 0);
    $hourlyRate = payroll_monthly_hourly_rate($basicSalary);
    $overtimeHours = payroll_approved_overtime_hours(
        $pdo,
        $employeeRecordId,
        $payload['startDate'],
        $payload['endDate']
    );
    $overtimeRate = $hourlyRate * PAYROLL_REGULAR_OVERTIME_MULTIPLIER;
    $passSlipHours = payroll_approved_pass_slip_hours(
        $pdo,
        $employeeRecordId,
        $payload['startDate'],
        $payload['endDate']
    );
    $attendanceDeductions = payroll_attendance_deductions(
        $pdo,
        $employeeRecordId,
        $payload['startDate'],
        $payload['endDate'],
        $basicSalary
    );

    $payload['hourlyRate'] = payroll_decimal($hourlyRate);
    $payload['overtimeHours'] = $overtimeHours;
    $payload['overtimeRate'] = payroll_decimal($overtimeRate);
    $payload['overtimePay'] = round($overtimeHours * $overtimeRate, 2);
    $payload['passSlipHours'] = $passSlipHours;
    $payload['attendanceRenderedMinutes'] = $attendanceDeductions['renderedMinutes'];
    $payload['attendanceLateMinutes'] = $attendanceDeductions['lateMinutes'];
    $payload['attendanceUndertimeMinutes'] = $attendanceDeductions['undertimeMinutes'];
    $payload['attendanceExpectedWorkdays'] = $attendanceDeductions['expectedWorkdays'];
    $payload['attendanceLeaveDays'] = $attendanceDeductions['leaveDays'];
    $payload['absenceDays'] = $attendanceDeductions['absentDays'];
    $payload['hasAttendanceCoverage'] = (bool)($attendanceDeductions['hasAttendanceCoverage'] ?? false);

    if ($payload['hasAttendanceCoverage']) {
        $payload['lateHours'] = $attendanceDeductions['lateHours'];
        $payload['undertimeHours'] = $attendanceDeductions['undertimeHours'];
        $payload['lateDeduction'] = $attendanceDeductions['lateDeduction'];
        $payload['absenceDeduction'] = $attendanceDeductions['absenceDeduction'];
        $payload['undertimeDeduction'] = $attendanceDeductions['undertimeDeduction'];
    } else {
        $payload['lateHours'] = 0;
        $payload['undertimeHours'] = $passSlipHours;
        $payload['undertimeDeduction'] = round($passSlipHours * $hourlyRate, 2);
    }

    $payload['withholdingTaxBase'] = $basicSalary;
    $payload['withholdingTax'] = payroll_calculate_withholding_tax($basicSalary, $pdo);
    $payload = payroll_apply_recurring_deductions($pdo, $payload, $employee, $basicSalary);

    return $payload;
}

function payroll_with_legacy_fk_bypass(PDO $pdo, callable $callback): mixed
{
    $pdo->exec('SET FOREIGN_KEY_CHECKS=0');

    try {
        return $callback();
    } finally {
        $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
    }
}

function payroll_store_meta(PDO $pdo, int $payrollId, array $meta): void
{
    $statement = $pdo->prepare(
        'INSERT INTO settings (setting_key, setting_value)
         VALUES (:setting_key, :setting_value)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
    );
    $statement->execute([
        ':setting_key' => payroll_setting_key($payrollId),
        ':setting_value' => json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
}

function payroll_fetch_meta(PDO $pdo, int $payrollId): array
{
    $statement = $pdo->prepare(
        'SELECT setting_value
         FROM settings
         WHERE setting_key = :setting_key
         LIMIT 1'
    );
    $statement->execute([':setting_key' => payroll_setting_key($payrollId)]);
    $value = $statement->fetchColumn();

    if (!is_string($value) || trim($value) === '') {
        return [];
    }

    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : [];
}

function payroll_ensure_approval_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS PayrollApproval (
            approval_id INT PRIMARY KEY AUTO_INCREMENT,
            payroll_id INT NOT NULL,
            approver_user_id INT UNSIGNED NOT NULL,
            action VARCHAR(20) NOT NULL,
            action_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            comments TEXT NULL,
            KEY idx_payroll_approval_payroll (payroll_id),
            KEY idx_payroll_approval_user (approver_user_id),
            KEY idx_payroll_approval_action_date (action_date),
            CONSTRAINT fk_payroll_approval_payroll
                FOREIGN KEY (payroll_id) REFERENCES Payroll(payroll_id)
                ON DELETE CASCADE,
            CONSTRAINT fk_payroll_approval_user
                FOREIGN KEY (approver_user_id) REFERENCES users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $ensured = true;
}

function payroll_actor_display_name(array $user): string
{
    $name = payroll_text($user['fullName'] ?? $user['full_name'] ?? '');

    if ($name !== '') {
        return $name;
    }

    $firstName = payroll_text($user['first_name'] ?? '');
    $middleName = payroll_text($user['middle_name'] ?? '');
    $lastName = payroll_text($user['last_name'] ?? '');
    $name = trim($firstName . ' ' . $middleName . ' ' . $lastName);

    if ($name !== '') {
        return preg_replace('/\s+/', ' ', $name) ?? $name;
    }

    return payroll_text($user['username'] ?? '') ?: 'System User';
}

function payroll_record_approval_action(
    PDO $pdo,
    int $payrollId,
    array $actorUser,
    string $action,
    ?string $comments = null
): void {
    payroll_ensure_approval_schema($pdo);

    $userId = (int)($actorUser['id'] ?? 0);
    if ($payrollId <= 0 || $userId <= 0 || payroll_text($action) === '') {
        return;
    }

    $statement = $pdo->prepare(
        'INSERT INTO PayrollApproval
            (payroll_id, approver_user_id, action, comments)
         VALUES
            (:payroll_id, :approver_user_id, :action, :comments)'
    );
    $statement->execute([
        ':payroll_id' => $payrollId,
        ':approver_user_id' => $userId,
        ':action' => payroll_text($action),
        ':comments' => payroll_nullable_text($comments),
    ]);
}

function payroll_fetch_approval_history(PDO $pdo, int $payrollId): array
{
    if ($payrollId <= 0) {
        return [];
    }

    payroll_ensure_approval_schema($pdo);

    $statement = $pdo->prepare(
        'SELECT
            pa.approval_id AS id,
            pa.payroll_id AS payrollId,
            pa.approver_user_id AS approverUserId,
            pa.action,
            pa.action_date AS actionDate,
            pa.comments,
            u.username,
            r.name AS approverRole,
            COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))), ""),
                u.username,
                "System User"
            ) AS approverName
         FROM PayrollApproval pa
         LEFT JOIN users u ON u.id = pa.approver_user_id
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE pa.payroll_id = :payroll_id
         ORDER BY pa.action_date ASC, pa.approval_id ASC'
    );
    $statement->execute([':payroll_id' => $payrollId]);

    return array_map(
        static fn (array $row): array => [
            'id' => (int)($row['id'] ?? 0),
            'payrollId' => (int)($row['payrollId'] ?? 0),
            'approverUserId' => (int)($row['approverUserId'] ?? 0),
            'approverName' => payroll_text($row['approverName'] ?? $row['username'] ?? 'System User'),
            'approverRole' => payroll_text($row['approverRole'] ?? ''),
            'action' => payroll_text($row['action'] ?? ''),
            'actionDate' => $row['actionDate'] ?? null,
            'comments' => payroll_nullable_text($row['comments'] ?? null),
        ],
        $statement->fetchAll()
    );
}

function payroll_allowance_items(array $payload): array
{
    return [
        ['name' => 'Overtime Pay', 'amount' => $payload['overtimePay']],
        ['name' => 'PERA', 'amount' => $payload['pera']],
        ['name' => 'Travel Allowance', 'amount' => $payload['travelAllowance']],
        ['name' => 'Salary Adjustment', 'amount' => $payload['salaryAdjustment']],
        ['name' => 'Other Allowances', 'amount' => $payload['otherAllowances']],
        ['name' => 'Bonus Amount', 'amount' => $payload['bonusAmount']],
    ];
}

function payroll_deduction_items(array $payload): array
{
    return [
        ['name' => 'Late Deduction', 'amount' => $payload['lateDeduction']],
        ['name' => 'Absence Deduction', 'amount' => $payload['absenceDeduction']],
        ['name' => 'Undertime Deduction', 'amount' => $payload['undertimeDeduction']],
        ['name' => 'Withholding Tax', 'amount' => $payload['withholdingTax']],
        ['name' => 'SSS', 'amount' => $payload['sss'] ?? 0],
        ['name' => 'GSIS', 'amount' => $payload['gsis']],
        ['name' => 'HDMF', 'amount' => $payload['hdmf']],
        ['name' => 'PHIC', 'amount' => $payload['phic']],
        ['name' => 'Manual Cash Advance Adjustment', 'amount' => $payload['manualCashAdvanceAdjustment']],
        ['name' => 'Laptop Loan', 'amount' => $payload['laptopLoan']],
        ['name' => 'Other Deductions', 'amount' => $payload['otherDeductions']],
        ...($payload['additionalDeductionItems'] ?? []),
    ];
}

function payroll_resolve_allowance_snapshot(PDO $pdo, string $name, float $amount): int
{
    $statement = $pdo->prepare(
        'SELECT allowance_id
         FROM Allowance
         WHERE allowance_name = :allowance_name
           AND amount = :amount
         ORDER BY allowance_id DESC
         LIMIT 1'
    );
    $statement->execute([
        ':allowance_name' => $name,
        ':amount' => payroll_decimal_string($amount),
    ]);
    $existingId = (int)$statement->fetchColumn();

    if ($existingId > 0) {
        return $existingId;
    }

    $insert = $pdo->prepare(
        'INSERT INTO Allowance (allowance_name, amount)
         VALUES (:allowance_name, :amount)'
    );
    $insert->execute([
        ':allowance_name' => $name,
        ':amount' => payroll_decimal_string($amount),
    ]);

    return (int)$pdo->lastInsertId();
}

function payroll_resolve_deduction_category(PDO $pdo, string $categoryName): int
{
    return payroll_category_id_from_name($categoryName);
}

/**
 * `deduction_types` always carries `default_amount`, so this is now constant. Kept because the
 * payslip-style query below still branches on it, and its old job — probing a schema that may or
 * may not have been migrated — no longer exists.
 */
function payroll_deduction_type_has_default_amount(PDO $pdo): bool
{
    return true;
}

function payroll_deduction_has_amount(PDO $pdo): bool
{
    static $hasColumn = null;

    if ($hasColumn === null) {
        $hasColumn = hris_database_column_exists($pdo, 'PayrollDeduction', 'amount');
    }

    return $hasColumn;
}

/**
 * Resolves a deduction to its catalog id, creating the type if the payroll run names a new one.
 *
 * The lookup and insert now go through `deduction_types`. `deductiontype` still exists as a
 * read-only compatibility view for the report and payslip queries, so writing here would fail.
 */
function payroll_resolve_deduction_type(PDO $pdo, string $categoryName, string $deductionName): int
{
    return deduction_catalog_resolve_type($pdo, $categoryName, $deductionName);
}

function payroll_sync_allowances(PDO $pdo, int $payrollId, array $items): void
{
    foreach ($items as $item) {
        $amount = payroll_decimal($item['amount'] ?? 0);
        if ($amount <= 0) {
            continue;
        }

        payroll_resolve_allowance_snapshot($pdo, (string)$item['name'], $amount);
    }
}

/**
 * Writes the itemised `PayrollDeduction` rows, then mirrors them into the deduction columns on
 * `payroll`.
 *
 * The columns are the register's storage — one per deduction, the way the schema lays out
 * `sss_contribution` and friends — but the itemised rows remain the record of truth. Both are
 * written here so they cannot drift; payroll_rebuild_deduction_columns() reconstructs the columns
 * from the rows if they ever do.
 */
function payroll_sync_deductions(PDO $pdo, int $payrollId, array $items): void
{
    $delete = $pdo->prepare('DELETE FROM PayrollDeduction WHERE payroll_id = :payroll_id');
    $delete->execute([':payroll_id' => $payrollId]);

    $hasAmountColumn = payroll_deduction_has_amount($pdo);
    $insert = $hasAmountColumn
        ? $pdo->prepare(
            'INSERT INTO PayrollDeduction (payroll_id, deduction_type_id, amount)
             VALUES (:payroll_id, :deduction_type_id, :amount)'
        )
        : $pdo->prepare(
            'INSERT INTO PayrollDeduction (payroll_id, deduction_type_id)
             VALUES (:payroll_id, :deduction_type_id)'
        );

    foreach ($items as $item) {
        $amount = payroll_decimal($item['amount'] ?? 0);
        if ($amount <= 0) {
            continue;
        }

        $name = (string)$item['name'];
        $categoryName = payroll_text($item['category'] ?? '') ?: (PAYROLL_DEDUCTION_CATEGORY_MAP[$name] ?? 'Other Deductions');
        $deductionTypeId = payroll_resolve_deduction_type($pdo, $categoryName, $name);

        $params = [
            ':payroll_id' => $payrollId,
            ':deduction_type_id' => $deductionTypeId,
        ];

        if ($hasAmountColumn) {
            $params[':amount'] = payroll_decimal_string($amount);
        }

        $insert->execute($params);
    }

    payroll_rebuild_deduction_columns($pdo, $payrollId);
}

/**
 * Reloads every deduction column on a payroll row from its `PayrollDeduction` items.
 *
 * Deductions the run did not charge are written back to 0.00 rather than left alone, so a deduction
 * removed from a payroll run clears its column instead of keeping the previous run's figure.
 */
function payroll_rebuild_deduction_columns(PDO $pdo, int $payrollId): void
{
    if ($payrollId <= 0) {
        return;
    }

    $columns = payroll_deduction_column_map($pdo);

    if ($columns === []) {
        return;
    }

    $statement = $pdo->prepare(
        'SELECT pd.deduction_type_id AS id, SUM(pd.amount) AS amount
         FROM PayrollDeduction pd
         WHERE pd.payroll_id = :payroll_id
         GROUP BY pd.deduction_type_id'
    );
    $statement->execute([':payroll_id' => $payrollId]);

    $amounts = [];
    foreach ($statement->fetchAll() as $row) {
        $amounts[(int)$row['id']] = payroll_decimal($row['amount'] ?? 0);
    }

    $assignments = [];
    $params = [':payroll_id' => $payrollId];

    foreach ($columns as $column => $deductionId) {
        $placeholder = ':amount_' . $deductionId;
        $assignments[] = sprintf('`%s` = %s', $column, $placeholder);
        $params[$placeholder] = payroll_decimal_string($amounts[$deductionId] ?? 0.0);
    }

    $update = $pdo->prepare(
        'UPDATE `payroll` SET ' . implode(', ', $assignments) . ' WHERE payroll_id = :payroll_id'
    );
    $update->execute($params);
}

/**
 * Creates any deduction type the run names that the catalog does not have yet, and gives it its
 * column on `payroll`.
 *
 * Must be called before the caller opens its transaction. Both steps are DDL-adjacent — a new type
 * means an ALTER on `payroll` — and DDL is an implicit commit in MySQL, so doing this inside the
 * transaction would end it early and leave the new deduction without a column to be written to.
 */
function payroll_prepare_deduction_types(PDO $pdo, array $items): void
{
    foreach ($items as $item) {
        $name = payroll_text($item['name'] ?? '');

        if ($name === '' || payroll_decimal($item['amount'] ?? 0) <= 0) {
            continue;
        }

        $categoryName = payroll_text($item['category'] ?? '')
            ?: (PAYROLL_DEDUCTION_CATEGORY_MAP[$name] ?? 'Other Deductions');
        payroll_resolve_deduction_type($pdo, $categoryName, $name);
    }

    deduction_catalog_sync_payroll_columns($pdo);
    payroll_deduction_column_map($pdo, true);
}

/** column name => deduction id, for the deductions that have a column on `payroll`. */
function payroll_deduction_column_map(PDO $pdo, bool $refresh = false): array
{
    static $map = null;

    if ($map !== null && !$refresh) {
        return $map;
    }

    $existing = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `payroll`') as $row) {
        $existing[strtolower((string)$row['Field'])] = true;
    }

    $map = [];
    foreach (deduction_catalog_types($pdo, ['activeOnly' => true, 'payrollOnly' => true]) as $type) {
        $column = $type['payrollColumn'];

        if ($column !== '' && isset($existing[$column])) {
            $map[$column] = $type['id'];
        }
    }

    return $map;
}

function payroll_base_query(): string
{
    return 'SELECT
            p.payroll_id AS id,
            p.employee_id AS employeeRecordId,
            p.payroll_date AS payrollDate,
            p.status,
            p.gross_pay AS grossPay,
            p.total_allowance AS totalAllowance,
            p.total_deduction AS totalDeduction,
            p.net_pay AS netPay,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            des.name AS designation,
            d.name AS division,
            e.employment_status AS currentEmploymentType,
            e.basic_salary AS currentBasicSalary,
            e.profile_image AS profileImage
         FROM Payroll p
         LEFT JOIN employees e ON e.id = p.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id';
}

function payroll_fetch_allowances(PDO $pdo, int $payrollId, array $meta = []): array
{
    if (isset($meta['allowanceItems']) && is_array($meta['allowanceItems'])) {
        return array_values(array_filter(
            array_map(
                static fn (array $item): array => [
                    'name' => payroll_text($item['name'] ?? ''),
                    'amount' => payroll_decimal($item['amount'] ?? 0),
                ],
                $meta['allowanceItems']
            ),
            static fn (array $item): bool => $item['name'] !== ''
        ));
    }

    if (!payroll_database_table_exists($pdo, 'PayrollAllowance')) {
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

    return $statement->fetchAll();
}

function payroll_fetch_deductions(PDO $pdo, int $payrollId): array
{
    $amountExpression = payroll_deduction_has_amount($pdo)
        ? 'COALESCE(pd.amount, dt.default_amount, 0.00)'
        : (payroll_deduction_type_has_default_amount($pdo) ? 'dt.default_amount' : '0.00');
    $typeUnion = deduction_catalog_type_union_sql();
    $statement = $pdo->prepare(
        "SELECT dt.deduction_name AS name, dt.category_name AS category, {$amountExpression} AS amount
         FROM PayrollDeduction pd
         INNER JOIN {$typeUnion} dt ON dt.deduction_type_id = pd.deduction_type_id
         WHERE pd.payroll_id = :payroll_id
         ORDER BY pd.payroll_deduction_id ASC"
    );
    $statement->execute([':payroll_id' => $payrollId]);

    return $statement->fetchAll();
}

function payroll_expand_record(PDO $pdo, array $baseRow): array
{
    $payrollId = (int)($baseRow['id'] ?? 0);
    $meta = payroll_fetch_meta($pdo, $payrollId);
    $allowances = payroll_fetch_allowances($pdo, $payrollId, $meta);
    $deductions = payroll_fetch_deductions($pdo, $payrollId);

    $allowanceFieldValues = array_fill_keys(array_values(PAYROLL_ALLOWANCE_FIELD_MAP), 0.0);
    foreach ($allowances as $allowance) {
        $name = (string)($allowance['name'] ?? '');
        $field = PAYROLL_ALLOWANCE_FIELD_MAP[$name] ?? null;
        if ($field !== null) {
            $allowanceFieldValues[$field] = payroll_decimal($allowance['amount'] ?? 0);
        }
    }

    $deductionFieldValues = array_fill_keys(array_values(PAYROLL_DEDUCTION_FIELD_MAP), 0.0);
    foreach ($deductions as $deduction) {
        $name = (string)($deduction['name'] ?? '');
        $field = PAYROLL_DEDUCTION_FIELD_MAP[$name] ?? null;
        if ($field !== null) {
            $deductionFieldValues[$field] = payroll_decimal($deduction['amount'] ?? 0);
        }
    }

    $employeeId = payroll_text($meta['employeeId'] ?? $baseRow['employeeId'] ?? '');
    $employeeName = payroll_text($meta['employeeName'] ?? $baseRow['employeeName'] ?? '');
    $designation = payroll_text($meta['designation'] ?? $baseRow['designation'] ?? '');
    $division = payroll_text($meta['division'] ?? $baseRow['division'] ?? '');
    $employmentType = payroll_text($meta['employmentType'] ?? $baseRow['currentEmploymentType'] ?? '');
    $profileImage = payroll_text($meta['profileImage'] ?? $baseRow['profileImage'] ?? '');
    $payPeriod = payroll_text($meta['payPeriod'] ?? '');
    $startDate = payroll_nullable_text($meta['startDate'] ?? null);
    $endDate = payroll_nullable_text($meta['endDate'] ?? $baseRow['payrollDate'] ?? null);
    $periodLabel = $payPeriod !== ''
        ? sprintf('%s (%s to %s)', $payPeriod, $startDate ?? 'N/A', $endDate ?? 'N/A')
        : ($endDate ?? 'Unspecified period');
    $basicSalary = payroll_decimal($meta['basicSalary'] ?? $baseRow['currentBasicSalary'] ?? 0);
    $hourlyRate = payroll_decimal($meta['hourlyRate'] ?? 0);
    if ($hourlyRate <= 0 && $basicSalary > 0) {
        $hourlyRate = payroll_decimal(payroll_monthly_hourly_rate($basicSalary));
    }
    $attendanceDeductions = payroll_attendance_deductions(
        $pdo,
        (int)($baseRow['employeeRecordId'] ?? 0),
        $startDate,
        $endDate,
        $basicSalary
    );
    $hasAttendanceCoverage = (bool)($attendanceDeductions['hasAttendanceCoverage'] ?? false);

    if ($hasAttendanceCoverage) {
        $deductionFieldValues['lateDeduction'] = payroll_decimal($attendanceDeductions['lateDeduction'] ?? 0);
        $deductionFieldValues['absenceDeduction'] = payroll_decimal($attendanceDeductions['absenceDeduction'] ?? 0);
        $deductionFieldValues['undertimeDeduction'] = payroll_decimal($attendanceDeductions['undertimeDeduction'] ?? 0);
    }

    $grossPay = payroll_decimal($baseRow['grossPay'] ?? 0);
    $totalAllowance = payroll_decimal($baseRow['totalAllowance'] ?? 0);
    $additionalDeductionTotal = 0.0;
    foreach ($deductions as $deduction) {
        $name = (string)($deduction['name'] ?? '');
        if (!isset(PAYROLL_DEDUCTION_FIELD_MAP[$name]) && payroll_deduction_field_for_name($name) === null) {
            $additionalDeductionTotal += payroll_decimal($deduction['amount'] ?? 0);
        }
    }
    $additionalDeductionTotal = round($additionalDeductionTotal, 2);
    $computedTotalDeduction = round(
        $deductionFieldValues['lateDeduction']
        + $deductionFieldValues['absenceDeduction']
        + $deductionFieldValues['undertimeDeduction']
        + $deductionFieldValues['withholdingTax']
        + ($deductionFieldValues['sss'] ?? 0)
        + $deductionFieldValues['gsis']
        + $deductionFieldValues['hdmf']
        + $deductionFieldValues['phic']
        + $deductionFieldValues['manualCashAdvanceAdjustment']
        + $deductionFieldValues['laptopLoan']
        + $deductionFieldValues['otherDeductions']
        + $additionalDeductionTotal,
        2
    );
    $totalDeduction = $hasAttendanceCoverage
        ? $computedTotalDeduction
        : payroll_decimal($baseRow['totalDeduction'] ?? $computedTotalDeduction);
    $netPay = $hasAttendanceCoverage
        ? round($grossPay - $totalDeduction, 2)
        : payroll_decimal($baseRow['netPay'] ?? ($grossPay - $totalDeduction));
    $deductionItems = array_map(
        static fn (array $item): array => [
            'name' => $item['name'],
            'category' => $item['category'],
            'amount' => payroll_decimal($item['amount'] ?? 0),
        ],
        $deductions
    );
    $status = payroll_normalize_status($baseRow['status'] ?? 'Draft');

    if ($hasAttendanceCoverage) {
        $attendanceDeductionNames = [
            'Late Deduction' => $deductionFieldValues['lateDeduction'],
            'Absence Deduction' => $deductionFieldValues['absenceDeduction'],
            'Undertime Deduction' => $deductionFieldValues['undertimeDeduction'],
        ];

        foreach ($attendanceDeductionNames as $deductionName => $amount) {
            $found = false;
            foreach ($deductionItems as &$deductionItem) {
                if (($deductionItem['name'] ?? '') === $deductionName) {
                    $deductionItem['amount'] = payroll_decimal($amount);
                    $found = true;
                    break;
                }
            }
            unset($deductionItem);

            if (!$found && payroll_decimal($amount) > 0) {
                $deductionItems[] = [
                    'name' => $deductionName,
                    'category' => PAYROLL_DEDUCTION_CATEGORY_MAP[$deductionName] ?? 'Attendance Deductions',
                    'amount' => payroll_decimal($amount),
                ];
            }
        }
    }

    return [
        'id' => $payrollId,
        'employeeRecordId' => (int)($baseRow['employeeRecordId'] ?? 0),
        'employeeId' => $employeeId,
        'employeeName' => $employeeName,
        'designation' => $designation,
        'division' => $division,
        'employmentType' => $employmentType,
        'profileImage' => $profileImage,
        'basicSalary' => $basicSalary,
        'payPeriod' => $payPeriod,
        'startDate' => $startDate,
        'endDate' => $endDate,
        'periodLabel' => $periodLabel,
        'payrollDate' => $baseRow['payrollDate'] ?? null,
        'status' => $status,
        'notes' => payroll_nullable_text($meta['notes'] ?? null),
        'overtimeHours' => payroll_decimal($meta['overtimeHours'] ?? 0),
        'overtimeRate' => payroll_decimal($meta['overtimeRate'] ?? 0),
        'hourlyRate' => $hourlyRate,
        'passSlipHours' => payroll_decimal($meta['passSlipHours'] ?? 0),
        'undertimeHours' => $hasAttendanceCoverage
            ? payroll_decimal($attendanceDeductions['undertimeHours'] ?? 0)
            : payroll_decimal($meta['undertimeHours'] ?? 0),
        'lateHours' => $hasAttendanceCoverage
            ? payroll_decimal($attendanceDeductions['lateHours'] ?? 0)
            : payroll_decimal($meta['lateHours'] ?? 0),
        'absenceDays' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['absentDays'] ?? 0)
            : (int)($meta['absenceDays'] ?? 0),
        'attendanceRenderedMinutes' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['renderedMinutes'] ?? 0)
            : (int)($meta['attendanceRenderedMinutes'] ?? 0),
        'attendanceLateMinutes' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['lateMinutes'] ?? 0)
            : (int)($meta['attendanceLateMinutes'] ?? 0),
        'attendanceUndertimeMinutes' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['undertimeMinutes'] ?? 0)
            : (int)($meta['attendanceUndertimeMinutes'] ?? 0),
        'attendanceExpectedWorkdays' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['expectedWorkdays'] ?? 0)
            : (int)($meta['attendanceExpectedWorkdays'] ?? 0),
        'attendanceLeaveDays' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['leaveDays'] ?? 0)
            : (int)($meta['attendanceLeaveDays'] ?? 0),
        'hasAttendanceCoverage' => $hasAttendanceCoverage,
        'withholdingTaxBase' => payroll_decimal($meta['withholdingTaxBase'] ?? $meta['basicSalary'] ?? 0),
        'overtimePay' => payroll_decimal($meta['overtimePay'] ?? $allowanceFieldValues['overtimePay'] ?? 0),
        'pera' => $allowanceFieldValues['pera'] ?? 0.0,
        'travelAllowance' => $allowanceFieldValues['travelAllowance'] ?? 0.0,
        'salaryAdjustment' => $allowanceFieldValues['salaryAdjustment'] ?? 0.0,
        'otherAllowances' => $allowanceFieldValues['otherAllowances'] ?? 0.0,
        'bonusAmount' => $allowanceFieldValues['bonusAmount'] ?? 0.0,
        'lateDeduction' => $deductionFieldValues['lateDeduction'] ?? 0.0,
        'absenceDeduction' => $deductionFieldValues['absenceDeduction'] ?? 0.0,
        'undertimeDeduction' => $deductionFieldValues['undertimeDeduction'] ?? 0.0,
        'withholdingTax' => $deductionFieldValues['withholdingTax'] ?? 0.0,
        'sss' => $deductionFieldValues['sss'] ?? 0.0,
        'gsis' => $deductionFieldValues['gsis'] ?? 0.0,
        'hdmf' => $deductionFieldValues['hdmf'] ?? 0.0,
        'phic' => $deductionFieldValues['phic'] ?? 0.0,
        'manualCashAdvanceAdjustment' => $deductionFieldValues['manualCashAdvanceAdjustment'] ?? 0.0,
        'laptopLoan' => $deductionFieldValues['laptopLoan'] ?? 0.0,
        'otherDeductions' => $deductionFieldValues['otherDeductions'] ?? 0.0,
        'additionalDeductionsTotal' => $additionalDeductionTotal,
        'deductionDiagnostics' => is_array($meta['deductionDiagnostics'] ?? null) ? $meta['deductionDiagnostics'] : [],
        'grossPay' => $grossPay,
        'totalAllowance' => $totalAllowance,
        'totalDeduction' => $totalDeduction,
        'netPay' => $netPay,
        'allowanceItems' => array_map(
            static fn (array $item): array => [
                'name' => $item['name'],
                'amount' => payroll_decimal($item['amount'] ?? 0),
            ],
            $allowances
        ),
        'deductionItems' => $deductionItems,
        'approvalHistory' => payroll_fetch_approval_history($pdo, $payrollId),
        'isArchived' => $status === 'Archived',
        'isEditable' => in_array($status, PAYROLL_EDITABLE_STATUSES, true),
    ];
}

function payroll_fetch_record(PDO $pdo, int $payrollId): ?array
{
    $statement = $pdo->prepare(payroll_base_query() . ' WHERE p.payroll_id = :payroll_id LIMIT 1');
    $statement->execute([':payroll_id' => $payrollId]);
    $row = $statement->fetch();

    return $row ? payroll_expand_record($pdo, $row) : null;
}

function payroll_list_records(PDO $pdo, ?int $employeeRecordId = null): void
{
    if ($employeeRecordId !== null && $employeeRecordId > 0) {
        $statement = $pdo->prepare(payroll_base_query() . ' WHERE p.employee_id = :employee_id ORDER BY p.payroll_date DESC, p.payroll_id DESC');
        $statement->execute([':employee_id' => $employeeRecordId]);
    } else {
        $statement = $pdo->query(payroll_base_query() . ' ORDER BY p.payroll_date DESC, p.payroll_id DESC');
    }

    $records = [];

    foreach ($statement->fetchAll() as $row) {
        $records[] = payroll_expand_record($pdo, $row);
    }

    json_response([
        'success' => true,
        'records' => $records,
        'defaults' => payroll_default_settings($pdo),
    ]);
}

function payroll_meta_payload(array $payload, array $employee, array $totals): array
{
    return [
        'employeeId' => $employee['employeeId'] ?? null,
        'employeeName' => $employee['employeeName'] ?? null,
        'designation' => $employee['designation'] ?? null,
        'division' => $employee['division'] ?? null,
        'employmentType' => $employee['employmentType'] ?? null,
        'profileImage' => $employee['profileImage'] ?? null,
        'basicSalary' => payroll_decimal($employee['basicSalary'] ?? 0),
        'salaryRate' => $employee['salaryRate'] ?? null,
        'payPeriod' => $payload['payPeriod'],
        'startDate' => $payload['startDate'],
        'endDate' => $payload['endDate'],
        'overtimeHours' => $payload['overtimeHours'],
        'overtimeRate' => $payload['overtimeRate'],
        'hourlyRate' => $payload['hourlyRate'] ?? 0,
        'passSlipHours' => $payload['passSlipHours'] ?? 0,
        'undertimeHours' => $payload['undertimeHours'] ?? 0,
        'lateHours' => $payload['lateHours'] ?? 0,
        'absenceDays' => $payload['absenceDays'] ?? 0,
        'attendanceRenderedMinutes' => $payload['attendanceRenderedMinutes'] ?? 0,
        'attendanceLateMinutes' => $payload['attendanceLateMinutes'] ?? 0,
        'attendanceUndertimeMinutes' => $payload['attendanceUndertimeMinutes'] ?? 0,
        'attendanceExpectedWorkdays' => $payload['attendanceExpectedWorkdays'] ?? 0,
        'attendanceLeaveDays' => $payload['attendanceLeaveDays'] ?? 0,
        'hasAttendanceCoverage' => (bool)($payload['hasAttendanceCoverage'] ?? false),
        'withholdingTaxBase' => $payload['withholdingTaxBase'] ?? payroll_decimal($employee['basicSalary'] ?? 0),
        'overtimePay' => $payload['overtimePay'],
        'allowanceItems' => array_values(array_filter(
            array_map(
                static fn (array $item): array => [
                    'name' => (string)$item['name'],
                    'amount' => payroll_decimal($item['amount'] ?? 0),
                ],
                payroll_allowance_items($payload)
            ),
            static fn (array $item): bool => payroll_decimal($item['amount'] ?? 0) > 0
        )),
        'sss' => $payload['sss'] ?? 0,
        'additionalDeductionsTotal' => $payload['additionalDeductionsTotal'] ?? 0,
        'deductionDiagnostics' => $payload['deductionDiagnostics'] ?? [],
        'notes' => $payload['notes'],
        'totals' => $totals,
    ];
}

function payroll_action_record_id(array $body): int
{
    return (int)($body['id'] ?? $body['payrollId'] ?? 0);
}

function payroll_action_ids(array $body): array
{
    $ids = $body['payrollIds'] ?? $body['ids'] ?? [];

    if (!is_array($ids)) {
        return [];
    }

    return array_values(array_unique(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0)));
}

function payroll_period_text(array $record): string
{
    $payPeriod = payroll_text($record['payPeriod'] ?? '');
    $startDate = payroll_text($record['startDate'] ?? '');
    $endDate = payroll_text($record['endDate'] ?? $record['payrollDate'] ?? '');

    if ($payPeriod !== '') {
        return $payPeriod . ($startDate !== '' || $endDate !== '' ? ' (' . ($startDate !== '' ? $startDate : 'N/A') . ' to ' . ($endDate !== '' ? $endDate : 'N/A') . ')' : '');
    }

    return trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
}

function payroll_notify_status_change(PDO $pdo, array $record, string $action, ?string $comments = null, bool $notifyRoles = true): void
{
    try {
        $payrollId = (int)($record['id'] ?? 0);
        $employeeRecordId = (int)($record['employeeRecordId'] ?? 0);
        $employeeName = payroll_text($record['employeeName'] ?? 'the employee') ?: 'the employee';
        $periodText = payroll_period_text($record);
        $periodSuffix = $periodText !== '' ? ' for ' . $periodText : '';
        $commentSuffix = payroll_nullable_text($comments) !== null ? ' Comment: ' . payroll_text($comments) : '';

        $title = match ($action) {
            'Submitted' => 'Payroll Submitted for Approval',
            'Approved' => 'Payroll Approved',
            'Rejected' => 'Payroll Rejected',
            'Paid' => 'Payroll Paid',
            'Archived' => 'Payroll Archived',
            default => 'Payroll Updated',
        };

        $message = match ($action) {
            'Submitted' => "Payroll for {$employeeName}{$periodSuffix} is awaiting approval.",
            'Approved' => "Payroll for {$employeeName}{$periodSuffix} has been approved.",
            'Rejected' => "Payroll for {$employeeName}{$periodSuffix} was rejected and sent back for correction.{$commentSuffix}",
            'Paid' => "Payroll for {$employeeName}{$periodSuffix} has been marked as paid.",
            'Archived' => "Payroll for {$employeeName}{$periodSuffix} has been archived.",
            default => "Payroll for {$employeeName}{$periodSuffix} was updated.",
        };

        $type = match ($action) {
            'Submitted' => 'payroll_submitted',
            'Approved' => 'payroll_approved',
            'Rejected' => 'payroll_rejected',
            'Paid' => 'payroll_paid',
            default => 'system_alert',
        };

        if ($notifyRoles) {
            if ($action === 'Submitted') {
                hris_notify_roles($pdo, ['admin', 'hrhead'], $title, $message, $type, (string)$payrollId);
                hris_notify_roles($pdo, ['hrstaff'], $title, $message, $type, (string)$payrollId);
            } else {
                hris_notify_roles($pdo, ['admin', 'hrhead', 'hrstaff'], $title, $message, $type, (string)$payrollId);
            }
        }

        hris_notify_employee($pdo, $employeeRecordId, $title, $message, $type, (string)$payrollId);
    } catch (Throwable $notificationException) {
        error_log('Payroll status notification error: ' . $notificationException->getMessage());
    }
}

/**
 * Emit a single aggregated staff notification for a batch of payroll records that
 * transitioned together (approve / mark paid / submit / archive on a registry),
 * instead of one notification per employee. The message carries the employee list
 * and totals so the notification "View" shows the full registry breakdown.
 */
function payroll_notify_bulk_status_change(PDO $pdo, array $records, string $action, ?string $comments = null): void
{
    try {
        $records = array_values(array_filter($records, static fn ($record): bool => is_array($record)));
        $count = count($records);

        if ($count === 0) {
            return;
        }

        $title = match ($action) {
            'Submitted' => 'Payroll Submitted for Approval',
            'Approved' => 'Payroll Approved',
            'Rejected' => 'Payroll Rejected',
            'Paid' => 'Payroll Paid',
            'Archived' => 'Payroll Archived',
            default => 'Payroll Updated',
        };

        $type = match ($action) {
            'Submitted' => 'payroll_submitted',
            'Approved' => 'payroll_approved',
            'Rejected' => 'payroll_rejected',
            'Paid' => 'payroll_paid',
            default => 'system_alert',
        };

        $actionText = match ($action) {
            'Submitted' => 'submitted for approval',
            'Approved' => 'approved',
            'Rejected' => 'rejected and returned for correction',
            'Paid' => 'marked as paid',
            'Archived' => 'archived',
            default => 'updated',
        };

        $payrollIds = [];
        $divisions = [];
        $totalNet = 0.0;

        foreach ($records as $record) {
            $id = (int)($record['id'] ?? 0);
            if ($id > 0) {
                $payrollIds[] = $id;
            }

            $division = payroll_text($record['division'] ?? '');
            if ($division !== '') {
                $divisions[$division] = true;
            }

            $totalNet += payroll_decimal($record['netPay'] ?? 0);
        }

        sort($payrollIds);
        $firstId = $payrollIds[0] ?? 0;
        $lastId = $payrollIds !== [] ? $payrollIds[count($payrollIds) - 1] : 0;
        $registryId = '';
        if ($firstId > 0) {
            $registryId = $firstId === $lastId
                ? 'PR-' . str_pad((string)$firstId, 4, '0', STR_PAD_LEFT)
                : 'PR-' . str_pad((string)$firstId, 4, '0', STR_PAD_LEFT) . '-' . str_pad((string)$lastId, 4, '0', STR_PAD_LEFT);
        }

        $divisionText = count($divisions) === 1 ? (string)array_key_first($divisions) : (count($divisions) . ' divisions');
        $periodText = payroll_period_text($records[0]);
        $commentSuffix = payroll_nullable_text($comments) !== null ? "\nComment: " . payroll_text($comments) : '';

        $header = sprintf(
            '%s%s%s has been %s. %d employee%s, total net pay PHP %s.',
            $registryId !== '' ? 'Registry ' . $registryId . ' — ' : '',
            $divisionText !== '' ? $divisionText : 'Payroll',
            $periodText !== '' ? ' (' . $periodText . ')' : '',
            $actionText,
            $count,
            $count === 1 ? '' : 's',
            number_format($totalNet, 2)
        );

        $limit = 40;
        $lines = [];
        foreach (array_slice($records, 0, $limit) as $index => $record) {
            $lines[] = sprintf(
                '%d. %s — PHP %s',
                $index + 1,
                payroll_text($record['employeeName'] ?? 'Employee') ?: 'Employee',
                number_format(payroll_decimal($record['netPay'] ?? 0), 2)
            );
        }

        if ($count > $limit) {
            $lines[] = sprintf('...and %d more.', $count - $limit);
        }

        $message = $header . "\n\nEmployees:\n" . implode("\n", $lines) . $commentSuffix;

        if ($action === 'Submitted') {
            hris_notify_roles($pdo, ['admin', 'hrhead'], $title, $message, $type, $registryId);
            hris_notify_roles($pdo, ['hrstaff'], $title, $message, $type, $registryId);
        } else {
            hris_notify_roles($pdo, ['admin', 'hrhead', 'hrstaff'], $title, $message, $type, $registryId);
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll bulk status notification error: ' . $notificationException->getMessage());
    }
}

function payroll_transition_status(
    PDO $pdo,
    int $payrollId,
    array $actorUser,
    string $targetStatus,
    string $action,
    array $allowedCurrentStatuses,
    ?string $comments = null,
    bool $notifyRoles = true
): array {
    if ($payrollId <= 0) {
        return [
            'success' => false,
            'statusCode' => 422,
            'message' => 'Payroll record is required.',
        ];
    }

    $record = payroll_fetch_record($pdo, $payrollId);

    if ($record === null) {
        return [
            'success' => false,
            'statusCode' => 404,
            'message' => 'Payroll record not found.',
        ];
    }

    $currentStatus = payroll_normalize_status($record['status'] ?? '');
    $allowedStatuses = array_map('payroll_normalize_status', $allowedCurrentStatuses);

    if (!in_array($currentStatus, $allowedStatuses, true)) {
        return [
            'success' => false,
            'statusCode' => 422,
            'message' => sprintf(
                'Payroll must be %s before it can be %s.',
                implode(' or ', $allowedStatuses),
                strtolower($action)
            ),
        ];
    }

    $targetStatus = payroll_normalize_status($targetStatus);

    try {
        $pdo->beginTransaction();

        $statement = $pdo->prepare(
            'UPDATE Payroll
             SET status = :status
             WHERE payroll_id = :payroll_id'
        );
        $statement->execute([
            ':status' => $targetStatus,
            ':payroll_id' => $payrollId,
        ]);

        payroll_record_approval_action($pdo, $payrollId, $actorUser, $action, $comments);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $updatedRecord = payroll_fetch_record($pdo, $payrollId);
    if ($updatedRecord !== null) {
        payroll_notify_status_change($pdo, $updatedRecord, $action, $comments, $notifyRoles);
    }

    return [
        'success' => true,
        'message' => match ($action) {
            'Submitted' => 'Payroll submitted for approval.',
            'Approved' => 'Payroll approved successfully.',
            'Rejected' => 'Payroll rejected and returned for correction.',
            'Paid' => 'Payroll marked as paid.',
            'Archived' => 'Payroll archived successfully.',
            default => 'Payroll status updated.',
        },
        'record' => $updatedRecord,
    ];
}

function payroll_transition_json_response(array $result): void
{
    if (!($result['success'] ?? false)) {
        json_response([
            'success' => false,
            'message' => $result['message'] ?? 'Unable to update payroll status.',
        ], (int)($result['statusCode'] ?? 422));
    }

    json_response([
        'success' => true,
        'message' => $result['message'] ?? 'Payroll status updated.',
        'record' => $result['record'] ?? null,
    ]);
}

function payroll_submit_for_approval(PDO $pdo, array $body, array $actorUser): void
{
    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        'Pending Approval',
        'Submitted',
        ['Draft', 'Rejected'],
        payroll_nullable_text($body['comments'] ?? null)
    ));
}

function payroll_approve(PDO $pdo, array $body, array $actorUser): void
{
    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        'Approved',
        'Approved',
        ['Pending Approval'],
        payroll_nullable_text($body['comments'] ?? null)
    ));
}

function payroll_reject(PDO $pdo, array $body, array $actorUser): void
{
    $comments = payroll_nullable_text($body['comments'] ?? $body['reason'] ?? null);

    if ($comments === null) {
        json_response([
            'success' => false,
            'message' => 'Rejection comments are required.',
        ], 422);
    }

    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        'Rejected',
        'Rejected',
        ['Pending Approval'],
        $comments
    ));
}

function payroll_mark_paid_action(PDO $pdo, array $body, array $actorUser): void
{
    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        'Paid',
        'Paid',
        ['Approved'],
        payroll_nullable_text($body['comments'] ?? null)
    ));
}

function payroll_bulk_transition(
    PDO $pdo,
    array $body,
    array $actorUser,
    string $targetStatus,
    string $action,
    array $allowedCurrentStatuses,
    bool $commentsRequired = false
): void {
    $ids = payroll_action_ids($body);

    if ($ids === []) {
        json_response([
            'success' => false,
            'message' => 'Select at least one payroll record.',
        ], 422);
    }

    $comments = payroll_nullable_text($body['comments'] ?? $body['reason'] ?? null);
    if ($commentsRequired && $comments === null) {
        json_response([
            'success' => false,
            'message' => 'Rejection comments are required.',
        ], 422);
    }

    $records = [];
    $failed = [];

    foreach ($ids as $payrollId) {
        $result = payroll_transition_status(
            $pdo,
            $payrollId,
            $actorUser,
            $targetStatus,
            $action,
            $allowedCurrentStatuses,
            $comments,
            false
        );

        if ($result['success'] ?? false) {
            if (isset($result['record'])) {
                $records[] = $result['record'];
            }
            continue;
        }

        $failed[] = [
            'id' => $payrollId,
            'message' => $result['message'] ?? 'Unable to update payroll.',
        ];
    }

    $successCount = count($records);
    $failedCount = count($failed);

    // Send a single aggregated staff notification for the whole batch instead of
    // one per employee (which previously flooded the notification center).
    if ($successCount > 0) {
        payroll_notify_bulk_status_change($pdo, $records, $action, $comments);
    }

    json_response([
        'success' => true,
        'message' => sprintf(
            '%d %s, %d failed.',
            $successCount,
            match ($action) {
                'Submitted' => $successCount === 1 ? 'submitted' : 'submitted',
                'Approved' => $successCount === 1 ? 'approved' : 'approved',
                'Rejected' => $successCount === 1 ? 'rejected' : 'rejected',
                'Paid' => $successCount === 1 ? 'marked paid' : 'marked paid',
                'Archived' => $successCount === 1 ? 'archived' : 'archived',
                default => $successCount === 1 ? 'updated' : 'updated',
            },
            $failedCount
        ),
        'successCount' => $successCount,
        'failedCount' => $failedCount,
        'failed' => $failed,
        'records' => $records,
    ]);
}

function payroll_create(PDO $pdo, array $body): void
{
    $payload = payroll_payload($pdo, $body);
    $payload['status'] = 'Draft';
    $employee = payroll_validate_payload($pdo, $payload);
    $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
    $totals = payroll_calculate_totals($payload, $employee);
    // Outside the transaction: a deduction this run names for the first time needs a catalog row
    // and a column on `payroll`, and that ALTER would implicitly commit the transaction below.
    payroll_prepare_deduction_types($pdo, payroll_deduction_items($payload));

    try {
        $pdo->beginTransaction();

        $payrollId = payroll_with_legacy_fk_bypass($pdo, static function () use ($pdo, $payload, $employee, $totals): int {
            $statement = $pdo->prepare(
                'INSERT INTO Payroll
                    (employee_id, payroll_date, status, gross_pay, total_allowance, total_deduction, net_pay)
                 VALUES
                    (:employee_id, :payroll_date, :status, :gross_pay, :total_allowance, :total_deduction, :net_pay)'
            );
            $statement->execute([
                ':employee_id' => (int)$employee['id'],
                ':payroll_date' => $payload['endDate'],
                ':status' => $payload['status'],
                ':gross_pay' => payroll_decimal_string($totals['grossPay']),
                ':total_allowance' => payroll_decimal_string($totals['totalAllowance']),
                ':total_deduction' => payroll_decimal_string($totals['totalDeduction']),
                ':net_pay' => payroll_decimal_string($totals['netPay']),
            ]);

            return (int)$pdo->lastInsertId();
        });

        payroll_sync_allowances($pdo, $payrollId, payroll_allowance_items($payload));
        payroll_sync_deductions($pdo, $payrollId, payroll_deduction_items($payload));
        payroll_store_meta($pdo, $payrollId, payroll_meta_payload($payload, $employee, $totals));

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $record = payroll_fetch_record($pdo, $payrollId);
        if ($record !== null) {
            $payPeriod = (string)($record['payPeriod'] ?? '');
            if ($payPeriod === '') {
                $startDate = (string)($record['startDate'] ?? '');
                $endDate = (string)($record['endDate'] ?? '');
                $payPeriod = trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
            }

            $notificationMessage = sprintf(
                'Payroll for %s is ready%s.',
                (string)($record['employeeName'] ?? 'the employee'),
                $payPeriod !== '' ? ' (' . $payPeriod . ')' : ''
            );

            // Payroll is generated one employee at a time, so notify staff roles with a
            // generic message keyed to the pay period. The 5-minute de-duplication in
            // hris_notification_insert() collapses the whole batch into a single staff
            // notification instead of one per employee. Employees still get their own.
            $rolePeriodLabel = $payPeriod !== '' ? $payPeriod : 'the current pay period';
            hris_notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Payroll Generated',
                sprintf('New payroll records for %s have been generated and are ready for review.', $rolePeriodLabel),
                'payroll_generated',
                'generated:' . $rolePeriodLabel
            );

            hris_notify_employee(
                $pdo,
                (int)($record['employeeRecordId'] ?? 0),
                'Payroll Generated',
                $notificationMessage,
                'payroll_generated',
                (string)$payrollId
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll creation notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Payroll created successfully.',
        'record' => payroll_fetch_record($pdo, $payrollId),
    ], 201);
}

function payroll_update(PDO $pdo, array $body): void
{
    $payrollId = (int)($body['id'] ?? 0);

    if ($payrollId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Payroll record is required.',
        ], 422);
    }

    $existing = payroll_fetch_record($pdo, $payrollId);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll record not found.',
        ], 404);
    }

    $existingStatus = payroll_normalize_status($existing['status'] ?? '');
    if (!in_array($existingStatus, PAYROLL_EDITABLE_STATUSES, true)) {
        json_response([
            'success' => false,
            'message' => 'Only draft or rejected payroll records can be edited.',
        ], 422);
    }

    $payload = payroll_payload($pdo, $body);
    $payload['status'] = payroll_normalize_status($payload['status']);
    $payload['status'] = $existingStatus === 'Rejected'
        ? 'Draft'
        : (in_array($payload['status'], PAYROLL_EDITABLE_STATUSES, true) ? $payload['status'] : $existingStatus);
    $employee = payroll_validate_payload($pdo, $payload);
    $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
    $totals = payroll_calculate_totals($payload, $employee);
    // Outside the transaction: a deduction this run names for the first time needs a catalog row
    // and a column on `payroll`, and that ALTER would implicitly commit the transaction below.
    payroll_prepare_deduction_types($pdo, payroll_deduction_items($payload));

    try {
        $pdo->beginTransaction();

        payroll_with_legacy_fk_bypass($pdo, static function () use ($pdo, $payrollId, $payload, $employee, $totals): void {
            $statement = $pdo->prepare(
                'UPDATE Payroll
                 SET employee_id = :employee_id,
                     payroll_date = :payroll_date,
                     status = :status,
                     gross_pay = :gross_pay,
                     total_allowance = :total_allowance,
                     total_deduction = :total_deduction,
                     net_pay = :net_pay
                 WHERE payroll_id = :payroll_id'
            );
            $statement->execute([
                ':employee_id' => (int)$employee['id'],
                ':payroll_date' => $payload['endDate'],
                ':status' => $payload['status'],
                ':gross_pay' => payroll_decimal_string($totals['grossPay']),
                ':total_allowance' => payroll_decimal_string($totals['totalAllowance']),
                ':total_deduction' => payroll_decimal_string($totals['totalDeduction']),
                ':net_pay' => payroll_decimal_string($totals['netPay']),
                ':payroll_id' => $payrollId,
            ]);
        });

        payroll_sync_allowances($pdo, $payrollId, payroll_allowance_items($payload));
        payroll_sync_deductions($pdo, $payrollId, payroll_deduction_items($payload));
        payroll_store_meta($pdo, $payrollId, payroll_meta_payload($payload, $employee, $totals));

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $record = payroll_fetch_record($pdo, $payrollId);
        if ($record !== null) {
            $payPeriod = (string)($record['payPeriod'] ?? '');
            if ($payPeriod === '') {
                $startDate = (string)($record['startDate'] ?? '');
                $endDate = (string)($record['endDate'] ?? '');
                $payPeriod = trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
            }

            $notificationMessage = sprintf(
                'Payroll record for %s was updated%s.',
                (string)($record['employeeName'] ?? 'the employee'),
                $payPeriod !== '' ? ' (' . $payPeriod . ')' : ''
            );

            hris_notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Payroll Updated',
                $notificationMessage,
                'system_alert',
                (string)$payrollId
            );

            hris_notify_employee(
                $pdo,
                (int)($record['employeeRecordId'] ?? 0),
                'Payroll Updated',
                $notificationMessage,
                'system_alert',
                (string)$payrollId
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll update notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Payroll updated successfully.',
        'record' => payroll_fetch_record($pdo, $payrollId),
    ]);
}

function payroll_mark_paid(PDO $pdo, int $payrollId): void
{
    $record = payroll_fetch_record($pdo, $payrollId);

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll record not found.',
        ], 404);
    }

    if ($record['status'] === 'Archived') {
        json_response([
            'success' => false,
            'message' => 'Archived payroll records cannot be marked as paid.',
        ], 422);
    }

    $endDate = payroll_date_or_null($record['endDate'] ?? $record['payrollDate'] ?? null);
    $startDate = payroll_date_or_null($record['startDate'] ?? null);
    if ($startDate === null && $endDate !== null) {
        $startDate = substr($endDate, 0, 8) . '01';
    }

    $payload = [
        'employeeRecordId' => (int)($record['employeeRecordId'] ?? 0),
        'payPeriod' => payroll_text($record['payPeriod'] ?? '') ?: 'Monthly',
        'startDate' => $startDate,
        'endDate' => $endDate,
        'overtimeHours' => payroll_decimal($record['overtimeHours'] ?? 0),
        'overtimeRate' => payroll_decimal($record['overtimeRate'] ?? 0),
        'overtimePay' => payroll_decimal($record['overtimePay'] ?? 0),
        'pera' => payroll_decimal($record['pera'] ?? 0),
        'travelAllowance' => payroll_decimal($record['travelAllowance'] ?? 0),
        'salaryAdjustment' => payroll_decimal($record['salaryAdjustment'] ?? 0),
        'otherAllowances' => payroll_decimal($record['otherAllowances'] ?? 0),
        'bonusAmount' => payroll_decimal($record['bonusAmount'] ?? 0),
        'lateDeduction' => payroll_decimal($record['lateDeduction'] ?? 0),
        'absenceDeduction' => payroll_decimal($record['absenceDeduction'] ?? 0),
        'undertimeDeduction' => payroll_decimal($record['undertimeDeduction'] ?? 0),
        'withholdingTax' => payroll_decimal($record['withholdingTax'] ?? 0),
        'sss' => payroll_decimal($record['sss'] ?? 0),
        'gsis' => payroll_decimal($record['gsis'] ?? 0),
        'hdmf' => payroll_decimal($record['hdmf'] ?? 0),
        'phic' => payroll_decimal($record['phic'] ?? 0),
        'manualCashAdvanceAdjustment' => payroll_decimal($record['manualCashAdvanceAdjustment'] ?? 0),
        'laptopLoan' => payroll_decimal($record['laptopLoan'] ?? 0),
        'otherDeductions' => payroll_decimal($record['otherDeductions'] ?? 0),
        'status' => 'Paid',
        'notes' => payroll_nullable_text($record['notes'] ?? null),
    ];
    $employee = payroll_validate_payload($pdo, $payload);
    $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
    $totals = payroll_calculate_totals($payload, $employee);
    // Outside the transaction: a deduction this run names for the first time needs a catalog row
    // and a column on `payroll`, and that ALTER would implicitly commit the transaction below.
    payroll_prepare_deduction_types($pdo, payroll_deduction_items($payload));

    try {
        $pdo->beginTransaction();

        payroll_with_legacy_fk_bypass($pdo, static function () use ($pdo, $payrollId, $payload, $employee, $totals): void {
            $statement = $pdo->prepare(
                'UPDATE Payroll
                 SET employee_id = :employee_id,
                     payroll_date = :payroll_date,
                     status = :status,
                     gross_pay = :gross_pay,
                     total_allowance = :total_allowance,
                     total_deduction = :total_deduction,
                     net_pay = :net_pay
                 WHERE payroll_id = :payroll_id'
            );
            $statement->execute([
                ':employee_id' => (int)$employee['id'],
                ':payroll_date' => $payload['endDate'],
                ':status' => 'Paid',
                ':gross_pay' => payroll_decimal_string($totals['grossPay']),
                ':total_allowance' => payroll_decimal_string($totals['totalAllowance']),
                ':total_deduction' => payroll_decimal_string($totals['totalDeduction']),
                ':net_pay' => payroll_decimal_string($totals['netPay']),
                ':payroll_id' => $payrollId,
            ]);
        });

        payroll_sync_allowances($pdo, $payrollId, payroll_allowance_items($payload));
        payroll_sync_deductions($pdo, $payrollId, payroll_deduction_items($payload));
        payroll_store_meta($pdo, $payrollId, payroll_meta_payload($payload, $employee, $totals));

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $record = payroll_fetch_record($pdo, $payrollId);
        if ($record !== null) {
            $payPeriod = (string)($record['payPeriod'] ?? '');
            if ($payPeriod === '') {
                $startDate = (string)($record['startDate'] ?? '');
                $endDate = (string)($record['endDate'] ?? '');
                $payPeriod = trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
            }

            $notificationMessage = sprintf(
                'Payroll for %s has been marked as paid%s.',
                (string)($record['employeeName'] ?? 'the employee'),
                $payPeriod !== '' ? ' (' . $payPeriod . ')' : ''
            );

            hris_notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Payroll Paid',
                $notificationMessage,
                'system_alert',
                (string)$payrollId
            );

            hris_notify_employee(
                $pdo,
                (int)($record['employeeRecordId'] ?? 0),
                'Payroll Paid',
                $notificationMessage,
                'system_alert',
                (string)$payrollId
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll paid notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Payroll marked as paid.',
        'record' => payroll_fetch_record($pdo, $payrollId),
    ]);
}

function payroll_archive(PDO $pdo, int $payrollId): void
{
    $record = payroll_fetch_record($pdo, $payrollId);

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll record not found.',
        ], 404);
    }

    $statement = $pdo->prepare(
        'UPDATE Payroll
         SET status = :status
         WHERE payroll_id = :payroll_id'
    );
    $statement->execute([
        ':status' => 'Archived',
        ':payroll_id' => $payrollId,
    ]);

    try {
        $record = payroll_fetch_record($pdo, $payrollId);
        if ($record !== null) {
            $payPeriod = (string)($record['payPeriod'] ?? '');
            if ($payPeriod === '') {
                $startDate = (string)($record['startDate'] ?? '');
                $endDate = (string)($record['endDate'] ?? '');
                $payPeriod = trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
            }

            $notificationMessage = sprintf(
                'Payroll for %s has been archived%s.',
                (string)($record['employeeName'] ?? 'the employee'),
                $payPeriod !== '' ? ' (' . $payPeriod . ')' : ''
            );

            hris_notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Payroll Archived',
                $notificationMessage,
                'system_alert',
                (string)$payrollId
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll archive notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Payroll archived successfully.',
        'record' => payroll_fetch_record($pdo, $payrollId),
    ]);
}

function payroll_approved_cash_advance_amount(PDO $pdo, int $employeeRecordId): float
{
    if ($employeeRecordId <= 0 || !payroll_database_table_exists($pdo, 'cash_advance_requests')) {
        return 0.0;
    }

    $statement = $pdo->prepare(
        'SELECT COALESCE(SUM(cash_advance_amount), 0.00)
         FROM cash_advance_requests
         WHERE employee_id = :employee_id
           AND status = "Approved"
           AND is_archived = 0'
    );
    $statement->execute([':employee_id' => $employeeRecordId]);

    return payroll_decimal($statement->fetchColumn());
}

function payroll_preview(PDO $pdo, array $body): void
{
    $employeeIds = $body['employeeIds'] ?? $body['employeeRecordIds'] ?? [];
    if (!is_array($employeeIds)) {
        $employeeIds = [];
    }

    $payPeriod = payroll_text($body['payPeriod'] ?? '');
    $startDate = payroll_date_or_null($body['startDate'] ?? null);
    $endDate = payroll_date_or_null($body['endDate'] ?? null);
    $records = [];
    $errors = [];

    foreach (array_values(array_unique(array_map('intval', $employeeIds))) as $employeeRecordId) {
        if ($employeeRecordId <= 0) {
            continue;
        }

        $payload = [
            'employeeRecordId' => $employeeRecordId,
            'payPeriod' => $payPeriod,
            'startDate' => $startDate,
            'endDate' => $endDate,
            'overtimeHours' => 0.0,
            'overtimeRate' => 0.0,
            'overtimePay' => 0.0,
            'pera' => payroll_lookup_allowance_amount($pdo, 'PERA', PAYROLL_DEFAULT_PERA_AMOUNT),
            'travelAllowance' => 0.0,
            'salaryAdjustment' => 0.0,
            'otherAllowances' => 0.0,
            'bonusAmount' => 0.0,
            'lateDeduction' => 0.0,
            'absenceDeduction' => 0.0,
            'undertimeDeduction' => 0.0,
            'withholdingTax' => 0.0,
            'sss' => 0.0,
            'gsis' => 0.0,
            'hdmf' => 0.0,
            'phic' => 0.0,
            'manualCashAdvanceAdjustment' => payroll_approved_cash_advance_amount($pdo, $employeeRecordId),
            'laptopLoan' => 0.0,
            'otherDeductions' => 0.0,
            'additionalDeductionItems' => [],
            'additionalDeductionsTotal' => 0.0,
            'deductionDiagnostics' => [],
            'status' => 'Draft',
            'notes' => null,
        ];

        try {
            $employee = payroll_validate_payload($pdo, $payload);
            $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
            $totals = payroll_calculate_totals($payload, $employee);
            $deductionItems = payroll_deduction_items($payload);

            $records[] = [
                'employeeRecordId' => (int)$employee['id'],
                'employeeId' => $employee['employeeId'] ?? null,
                'employeeName' => $employee['employeeName'] ?? null,
                'designation' => $employee['designation'] ?? null,
                'division' => $employee['division'] ?? null,
                'basicSalary' => payroll_decimal($employee['basicSalary'] ?? 0),
                'grossPay' => $totals['grossPay'],
                'totalDeduction' => $totals['totalDeduction'],
                'netPay' => $totals['netPay'],
                'lateDeduction' => $payload['lateDeduction'],
                'absenceDeduction' => $payload['absenceDeduction'],
                'undertimeDeduction' => $payload['undertimeDeduction'],
                'withholdingTax' => $payload['withholdingTax'],
                'sss' => $payload['sss'] ?? 0,
                'gsis' => $payload['gsis'],
                'hdmf' => $payload['hdmf'],
                'phic' => $payload['phic'],
                'manualCashAdvanceAdjustment' => $payload['manualCashAdvanceAdjustment'],
                'laptopLoan' => $payload['laptopLoan'],
                'otherDeductions' => $payload['otherDeductions'],
                'additionalDeductionsTotal' => $payload['additionalDeductionsTotal'] ?? 0,
                'deductionItems' => array_values(array_filter(
                    array_map(
                        static fn (array $item): array => [
                            'name' => $item['name'] ?? '',
                            'category' => $item['category'] ?? (PAYROLL_DEDUCTION_CATEGORY_MAP[$item['name'] ?? ''] ?? 'Deductions'),
                            'amount' => payroll_decimal($item['amount'] ?? 0),
                        ],
                        $deductionItems
                    ),
                    static fn (array $item): bool => payroll_decimal($item['amount'] ?? 0) > 0
                )),
                'deductionDiagnostics' => $payload['deductionDiagnostics'] ?? [],
            ];
        } catch (Throwable $exception) {
            $errors[] = [
                'employeeRecordId' => $employeeRecordId,
                'message' => $exception->getMessage(),
            ];
            payroll_log_deduction_debug('Preview calculation failed.', [
                'employeeRecordId' => $employeeRecordId,
                'error' => $exception->getMessage(),
            ]);
        }
    }

    json_response([
        'success' => true,
        'records' => $records,
        'errors' => $errors,
    ]);
}

payroll_ensure_deduction_engine_schema($pdo);
payroll_ensure_approval_schema($pdo);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $payrollId = (int)($_GET['id'] ?? 0);
    $employeeRecordId = null;

    if ($roleKey === 'employee') {
        $employeeRecordId = hris_session_employee_record_id($pdo, $sessionUser);

        if ($employeeRecordId === null || $employeeRecordId <= 0) {
            json_response([
                'success' => false,
                'message' => 'Your account is not linked to an employee payroll profile.',
            ], 403);
        }
    }

    if ($payrollId > 0) {
        $record = payroll_fetch_record($pdo, $payrollId);

        if ($record === null) {
            json_response([
                'success' => false,
                'message' => 'Payroll record not found.',
            ], 404);
        }

        if ($roleKey === 'employee' && (int)($record['employeeRecordId'] ?? 0) !== (int)$employeeRecordId) {
            json_response([
                'success' => false,
                'message' => 'You can only view your own payroll records.',
            ], 403);
        }

        json_response([
            'success' => true,
            'record' => $record,
            'defaults' => payroll_default_settings($pdo),
        ]);
    }

    payroll_list_records($pdo, $employeeRecordId);
}

$body = read_json_body();
$action = payroll_text($_GET['action'] ?? $body['action'] ?? '');

if ($method === 'POST') {
    if ($action === 'preview') {
        payroll_require_staff_role($roleKey);
        payroll_preview($pdo, $body);
    }

    if ($action === 'submit_for_approval') {
        payroll_require_staff_role($roleKey);
        payroll_submit_for_approval($pdo, $body, $sessionUser);
    }

    if ($action === 'approve') {
        payroll_require_approval_role($roleKey);
        payroll_approve($pdo, $body, $sessionUser);
    }

    if ($action === 'reject') {
        payroll_require_approval_role($roleKey);
        payroll_reject($pdo, $body, $sessionUser);
    }

    if ($action === 'mark_paid') {
        payroll_require_approval_role($roleKey);
        payroll_mark_paid_action($pdo, $body, $sessionUser);
    }

    if ($action === 'bulk_submit') {
        payroll_require_staff_role($roleKey);
        payroll_bulk_transition($pdo, $body, $sessionUser, 'Pending Approval', 'Submitted', ['Draft', 'Rejected']);
    }

    if ($action === 'bulk_approve') {
        payroll_require_approval_role($roleKey);
        payroll_bulk_transition($pdo, $body, $sessionUser, 'Approved', 'Approved', ['Pending Approval']);
    }

    if ($action === 'bulk_reject') {
        payroll_require_approval_role($roleKey);
        payroll_bulk_transition($pdo, $body, $sessionUser, 'Rejected', 'Rejected', ['Pending Approval'], true);
    }

    if ($action === 'bulk_mark_paid') {
        payroll_require_approval_role($roleKey);
        payroll_bulk_transition($pdo, $body, $sessionUser, 'Paid', 'Paid', ['Approved']);
    }

    if ($action === 'bulk_archive') {
        payroll_require_approval_role($roleKey);
        payroll_bulk_transition($pdo, $body, $sessionUser, 'Archived', 'Archived', PAYROLL_ACTIVE_STATUSES);
    }

    payroll_require_staff_role($roleKey);
    payroll_create($pdo, $body);
}

if ($method === 'PUT') {
    $action = $action !== '' ? $action : 'update';
    $payrollId = (int)($body['id'] ?? 0);

    if ($action === 'mark_paid') {
        payroll_require_approval_role($roleKey);
        payroll_mark_paid_action($pdo, $body, $sessionUser);
    }

    if ($action === 'archive') {
        payroll_require_approval_role($roleKey);
        payroll_archive($pdo, $payrollId);
    }

    payroll_require_staff_role($roleKey);
    payroll_update($pdo, $body);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
