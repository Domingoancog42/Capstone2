<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/deduction-catalog.php';
// The Deduction Distribution chart lists the payslip's own deduction lines, so it reads the roster
// the payslip prints from rather than keeping a second idea of what a deduction is called.
require_once __DIR__ . '/payslip-deductions.php';

$sessionUser = require_session_user();
$roleKey = user_role_key($sessionUser);

// HR Head and HR Staff run the same reports workspace as Admin. They already hold organisation-wide
// read access to the underlying records (see employee.php and attendance.php), so the reports built
// on top of those records follow the same boundary.
if (!in_array($roleKey, ['admin', 'administrator', 'hrhead', 'hrstaff'], true)) {
    json_response([
        'success' => false,
        'message' => 'You do not have permission to access reports.',
    ], 403);
}

date_default_timezone_set('Asia/Manila');
ensure_payroll_embedded_detail_columns($pdo);

/**
 * Reports the signed-in role may not run.
 *
 * HR Head and HR Staff work from the individual employee reports — active, newly hired, separated,
 * by division — rather than pulling the whole roster out in one sheet, so the master list is theirs
 * to see a record at a time and not to take wholesale.
 *
 * Applied at the catalog and again at the data endpoint. Dropping it from the picker only stops it
 * being picked; the report key travels in the query string, so the endpoint has to refuse it too or
 * the restriction is decoration.
 */
function reports_blocked_report_keys(string $roleKey): array
{
    return in_array($roleKey, ['hrhead', 'hrstaff'], true) ? ['employee-list'] : [];
}

/**
 * Report categories the signed-in role may not open at all.
 *
 * The audit trail is the record of who did what across the system -- sign-ins, exports, deletions --
 * and reading it is an oversight function, not a clerical one. HR Staff run the operational reports;
 * the Audit tab belongs to the HR Head and Admin.
 *
 * Applied at the catalog and again at the data endpoint, for the same reason as the blocked keys.
 * Mirrors HR_STAFF_HIDDEN_REPORT_CATEGORIES in Hrstaffdashboard.jsx, which leaves the tab out of the
 * sidebar.
 */
function reports_blocked_category_keys(string $roleKey): array
{
    return $roleKey === 'hrstaff' ? ['audit'] : [];
}

/*
 * Reserved support for a future division-scoped reporting desk. HR Staff currently work every
 * operational report organization-wide. If a role is added here, every definition in a scoped
 * category must carry a `divisionId` filter or the endpoint safely returns no rows.
 */
const REPORTS_DIVISION_SCOPED_ROLES = [];
const REPORTS_DIVISION_SCOPED_CATEGORIES = ['employee', 'payroll', 'leave', 'attendance', 'travel', 'cto', 'performance'];

/**
 * The division the signed-in desk's scoped reports count within: null for a desk that reads the
 * whole organization, the division id for a scoped desk, and 0 for a scoped desk with no division
 * on its employee record -- which leaves it nothing to list rather than everyone.
 */
function reports_scope_division_id(PDO $pdo, array $user, string $roleKey): ?int
{
    if (!in_array($roleKey, REPORTS_DIVISION_SCOPED_ROLES, true)) {
        return null;
    }

    $division = trimmed_text($user['division'] ?? '');

    if ($division === '') {
        return 0;
    }

    // One placeholder per marker: native prepares are on, so a reused name throws HY093.
    $statement = $pdo->prepare(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
           AND (name COLLATE utf8mb4_unicode_ci = :division_name OR code COLLATE utf8mb4_unicode_ci = :division_code)
         LIMIT 1'
    );
    $statement->execute([
        ':division_name' => $division,
        ':division_code' => $division,
    ]);
    $divisionId = (int)$statement->fetchColumn();

    return $divisionId > 0 ? $divisionId : 0;
}

function reports_category_is_division_scoped(string $categoryKey): bool
{
    return in_array($categoryKey, REPORTS_DIVISION_SCOPED_CATEGORIES, true);
}

function reports_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function reports_date_or_null(mixed $value): ?string
{
    $value = reports_text($value);

    if ($value === '') {
        return null;
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $value);
    return $date && $date->format('Y-m-d') === $value ? $value : null;
}

function reports_date_window(string $range, ?string $customStart, ?string $customEnd): array
{
    $today = new DateTimeImmutable('today');
    $range = strtolower($range);

    $start = $today->modify('-29 days');
    $end = $today;
    $label = 'Last 30 Days';

    if ($range === 'today') {
        $start = $today;
        $end = $today;
        $label = 'Today';
    } elseif ($range === 'last7') {
        $start = $today->modify('-6 days');
        $label = 'Last 7 Days';
    } elseif ($range === 'last90') {
        $start = $today->modify('-89 days');
        $label = 'Last 90 Days';
    } elseif ($range === 'thismonth') {
        // Calendar periods run to the end of the period, not to today. Records
        // dated at a period boundary (payroll on the 31st, for example) belong
        // to "This Month" even when that date has not arrived yet.
        $start = $today->modify('first day of this month');
        $end = $today->modify('last day of this month');
        $label = 'This Month';
    } elseif ($range === 'lastmonth') {
        $start = $today->modify('first day of last month');
        $end = $today->modify('last day of last month');
        $label = 'Last Month';
    } elseif ($range === 'thisyear') {
        $start = $today->setDate((int)$today->format('Y'), 1, 1);
        $end = $today->setDate((int)$today->format('Y'), 12, 31);
        $label = 'This Year';
    } elseif ($range === 'lastyear') {
        $year = (int)$today->format('Y') - 1;
        $start = $today->setDate($year, 1, 1);
        $end = $today->setDate($year, 12, 31);
        $label = 'Last Year';
    } elseif ($range === 'alltime') {
        $start = $today->setDate(1970, 1, 1);
        $end = $today->modify('+5 years');
        $label = 'All Time';
    } elseif ($range === 'custom') {
        $startValue = reports_date_or_null($customStart);
        $endValue = reports_date_or_null($customEnd);

        if ($startValue === null || $endValue === null) {
            json_response([
                'success' => false,
                'message' => 'Please provide a valid custom start and end date.',
            ], 422);
        }

        $start = new DateTimeImmutable($startValue);
        $end = new DateTimeImmutable($endValue);
        $label = 'Custom Range';
    }

    if ($start > $end) {
        json_response([
            'success' => false,
            'message' => 'Start date must be before or equal to end date.',
        ], 422);
    }

    return [
        'key' => $range,
        'label' => $label,
        'start' => $start->format('Y-m-d'),
        'end' => $end->format('Y-m-d'),
    ];
}

function reports_columns(array $pairs): array
{
    return array_map(
        static fn (array $pair): array => ['key' => $pair[0], 'label' => $pair[1]],
        $pairs
    );
}

function reports_employee_name_expression(): string
{
    return 'TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name))';
}

/*
 * What "released" means to every payroll report and KPI in this file, in one place. The registry
 * only ever writes `Paid` (see PAYROLL_ALL_STATUSES in payroll.php); the other spellings cover
 * imported rows. Anything not released and not settled by cancelling or archiving is pending.
 */
function reports_payroll_released_condition(string $alias = 'p'): string
{
    return 'LOWER(COALESCE(' . $alias . '.status, "")) IN ("released", "paid", "posted", "completed")';
}

function reports_payroll_pending_condition(string $alias = 'p'): string
{
    return 'LOWER(COALESCE(' . $alias . '.status, ""))
        NOT IN ("released", "paid", "posted", "completed", "cancelled", "archived")';
}

/**
 * The day a batch was released: the stamp the Cashier's Paid transition writes, or the payroll date
 * for a row released before the stamp existed and left unstamped by the backfill.
 */
function reports_payroll_release_date_sql(string $alias = 'p'): string
{
    return 'COALESCE(' . $alias . '.released_at, ' . $alias . '.payroll_date)';
}

/**
 * The pay period the batch covered, as the registry labels it ("1st Half (2026-09-01 to
 * 2026-09-15)"), read from the row's meta. JSON_VALUE yields NULL for a legacy row whose meta is not
 * JSON, so the column falls back to the payroll date rather than failing the report.
 */
function reports_payroll_period_sql(string $alias = 'p'): string
{
    $meta = $alias . '.meta_json';
    $payPeriod = 'NULLIF(JSON_VALUE(' . $meta . ', "$.payPeriod"), "")';

    // Mirrors the periodLabel payroll.php builds for the registry.
    return 'CASE
        WHEN ' . $payPeriod . ' IS NULL THEN ' . $alias . '.payroll_date
        ELSE CONCAT(
            ' . $payPeriod . ', " (",
            COALESCE(NULLIF(JSON_VALUE(' . $meta . ', "$.startDate"), ""), "N/A"), " to ",
            COALESCE(NULLIF(JSON_VALUE(' . $meta . ', "$.endDate"), ""), ' . $alias . '.payroll_date, "N/A"), ")"
        )
    END';
}

/**
 * The desk that released the batch, by the employee name behind the user account (as the payroll
 * approval trail resolves it) or the username for an account with no employee record.
 */
function reports_payroll_released_by_sql(string $alias = 'p'): string
{
    return '(SELECT COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(re.first_name, ""), " ", COALESCE(re.last_name, ""))), ""),
                ru.username
            )
            FROM users ru
            LEFT JOIN employees re
                ON re.email COLLATE utf8mb4_unicode_ci = ru.email COLLATE utf8mb4_unicode_ci
               AND re.is_archived = 0
            WHERE ru.id = ' . $alias . '.released_by
            ORDER BY re.id ASC
            LIMIT 1)';
}

/**
 * Shared employee projection. Every employee-flavoured report selects the same
 * superset of columns and only varies the visible column list plus an extra
 * WHERE fragment, so there is a single place to maintain the joins.
 */
function reports_employee_base_sql(string $extraWhere = ''): string
{
    $name = reports_employee_name_expression();

    return 'SELECT
            e.id,
            e.employee_id AS employeeId,
            ' . $name . ' AS employeeName,
            d.name AS division,
            des.name AS position,
            e.designation,
            e.employment_status AS employmentStatus,
            e.gender,
            e.email,
            e.phone,
            e.status,
            e.date_hired AS dateHired,
            e.date_of_birth AS dateOfBirth,
            TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) AS age,
            TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) AS yearsOfService,
            e.basic_salary AS basicSalary,
            CASE WHEN e.pwd = 1 THEN "Yes" ELSE "No" END AS pwd,
            e.emp_gsis_id_no AS gsisNo,
            e.emp_pagibig_id_no AS pagibigNo,
            e.emp_philhealth_id_no AS philhealthNo,
            e.tin_no AS tinNo
        FROM employees e
        LEFT JOIN divisions d ON d.id = e.division_id
        LEFT JOIN designations des ON des.id = e.designation_id
        WHERE e.is_archived = 0' . ($extraWhere !== '' ? ' AND ' . $extraWhere : '');
}

/**
 * Job Order is legacy seed data — the employee form only ever creates Regular or Contract of
 * Service appointments — so employee reports leave it out of the Employment Status filter and chart
 * rather than offering a category the office no longer appoints under. Both spellings are covered
 * because imported rows carry either one.
 */
function reports_excluded_employment_status_sql(string $column): string
{
    return ' AND LOWER(COALESCE(TRIM(' . $column . '), "")) NOT IN ("job order", "jo")';
}

/**
 * "Contractual" and "COS" are what rows saved before the Contract of Service rename still hold, so
 * every report reads the column through this expression — the breakdown counts one row per
 * appointment instead of three, and the filter dropdown offers a single option that still matches
 * the legacy spellings. Analytics repeats it in `analytics_employment_status_label_sql()`; the two
 * files never include each other.
 */
function reports_employment_status_label_sql(string $column, string $fallback = 'Unspecified'): string
{
    return 'CASE
                WHEN LOWER(COALESCE(TRIM(' . $column . '), "")) IN ("contractual", "contract of service", "cos")
                    THEN "Contract of Service"
                ELSE COALESCE(NULLIF(TRIM(' . $column . '), ""), "' . $fallback . '")
            END';
}

function reports_employee_filters(): array
{
    return [
        'divisionId' => 'e.division_id',
        'designationId' => 'e.designation_id',
        'employmentStatus' => reports_employment_status_label_sql('e.employment_status'),
        'gender' => 'e.gender',
        'status' => 'e.status',
    ];
}

function reports_employee_definition(array $options): array
{
    $name = reports_employee_name_expression();
    $columns = $options['columns'] ?? [
        ['employeeId', 'Employee ID'],
        ['employeeName', 'Employee Name'],
        ['division', 'Division'],
        ['position', 'Position'],
        ['designation', 'Designation'],
        ['employmentStatus', 'Employment Status'],
        ['status', 'Status'],
        ['dateHired', 'Date Hired'],
    ];

    return [
        'label' => $options['label'],
        'description' => $options['description'],
        'category' => 'employee',
        'requiredTables' => ['employees', 'divisions', 'designations'],
        'dateExpression' => array_key_exists('dateExpression', $options)
            ? $options['dateExpression']
            : 'COALESCE(e.date_hired, DATE(e.created_at))',
        'searchExpressions' => ['e.employee_id', $name, 'd.name', 'des.name', 'e.designation', 'e.email', 'e.status', 'e.employment_status'],
        'columns' => reports_columns($columns),
        'sql' => reports_employee_base_sql($options['where'] ?? ''),
        'orderBy' => $options['orderBy'] ?? 'employeeName ASC',
        'filters' => reports_employee_filters(),
    ];
}

/**
 * Aggregate (GROUP BY) definitions need their filters injected before the
 * GROUP BY clause, which the `filterBefore` hint below takes care of.
 */
function reports_employee_aggregate_definition(array $options): array
{
    return [
        'label' => $options['label'],
        'description' => $options['description'],
        'category' => 'employee',
        'requiredTables' => $options['requiredTables'] ?? ['employees', 'divisions'],
        'dateExpression' => $options['dateExpression'] ?? null,
        'searchExpressions' => $options['searchExpressions'] ?? [],
        'columns' => reports_columns($options['columns']),
        'sql' => $options['sql'],
        'orderBy' => $options['orderBy'],
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => $options['filters'] ?? reports_employee_filters(),
    ];
}

function reports_definitions(): array
{
    $employeeName = reports_employee_name_expression();
    $definitions = [];

    // ---------------------------------------------------------------
    // Employee reports
    // ---------------------------------------------------------------
    $employeeVariants = [
        'employee-list' => [
            'label' => 'Employee List',
            'description' => 'Complete list of all non-archived employees.',
            'where' => '',
            // A roster is a current snapshot, not a hiring activity report. Applying the default
            // Last 30 Days window here reduced the table to only recently added employees.
            'dateExpression' => null,
        ],
        // Both are headcount snapshots of the whole roster, so they opt out of the hire-date window
        // the other employee reports use. Left on it, "Total Active Employees" on the default Last
        // 30 Days range answered "employees hired in the last 30 days who are active" — two rows out
        // of three hundred — rather than the total it is named for.
        'employee-active' => [
            'label' => 'Total Active Employees',
            'description' => 'Employees currently flagged as active in the master list.',
            'where' => 'LOWER(e.status) = "active"',
            'dateExpression' => null,
        ],
        'employee-inactive' => [
            'label' => 'Total Inactive Employees',
            'description' => 'Employees whose record status is anything other than active.',
            'where' => 'LOWER(e.status) <> "active"',
            'dateExpression' => null,
        ],
        'employee-male' => [
            'label' => 'Male Employees',
            'description' => 'Employees recorded with a male gender.',
            'where' => 'LOWER(e.gender) = "male"',
            'dateExpression' => null,
        ],
        'employee-female' => [
            'label' => 'Female Employees',
            'description' => 'Employees recorded with a female gender.',
            'where' => 'LOWER(e.gender) = "female"',
            'dateExpression' => null,
        ],
        'employee-pwd' => [
            'label' => 'PWD Employees',
            'description' => 'Employees registered as persons with disability.',
            'where' => 'e.pwd = 1',
            'dateExpression' => null,
            'columns' => [
                ['employeeId', 'Employee ID'],
                ['employeeName', 'Employee Name'],
                ['division', 'Division'],
                ['position', 'Position'],
                ['pwd', 'PWD'],
                ['status', 'Status'],
                ['dateHired', 'Date Hired'],
            ],
        ],
        'employee-senior' => [
            'label' => 'Senior Citizen Employees',
            'description' => 'Employees aged 60 years old and above.',
            'where' => 'e.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) >= 60',
            'dateExpression' => null,
            'columns' => [
                ['employeeId', 'Employee ID'],
                ['employeeName', 'Employee Name'],
                ['division', 'Division'],
                ['dateOfBirth', 'Date of Birth'],
                ['age', 'Age'],
                ['status', 'Status'],
            ],
            'orderBy' => 'age DESC',
        ],
        'employee-permanent' => [
            'label' => 'Permanent Employees',
            'description' => 'Employees under a permanent or regular appointment.',
            'where' => 'LOWER(COALESCE(e.employment_status, "")) IN ("permanent", "regular")',
            'dateExpression' => null,
        ],
        'employee-cos' => [
            'label' => 'Contract of Service Employees',
            'description' => 'Employees engaged through contract of service or contractual appointments.',
            'where' => 'LOWER(COALESCE(e.employment_status, "")) IN ("contractual", "contract of service", "cos")',
            'dateExpression' => null,
        ],
        'employee-newly-hired' => [
            'label' => 'Newly Hired Employees',
            'description' => 'Employees hired within the selected date range.',
            'where' => 'e.date_hired IS NOT NULL',
            'dateExpression' => 'e.date_hired',
            'orderBy' => 'e.date_hired DESC',
        ],
        'employee-separated' => [
            'label' => 'Separated Employees',
            'description' => 'Employees marked as resigned, separated, or terminated.',
            'where' => 'LOWER(COALESCE(e.status, "")) IN ("resigned", "separated", "terminated", "inactive")',
            'dateExpression' => null,
        ],
        'employee-retired' => [
            'label' => 'Retired Employees',
            'description' => 'Employees whose record status is retired.',
            'where' => 'LOWER(COALESCE(e.status, "")) = "retired"',
            'dateExpression' => null,
        ],
        'employee-birthdays' => [
            'label' => 'Employees with Birthday this Month',
            'description' => 'Employees celebrating a birthday within the current calendar month.',
            'where' => 'e.date_of_birth IS NOT NULL AND MONTH(e.date_of_birth) = MONTH(CURDATE())',
            'dateExpression' => null,
            'columns' => [
                ['employeeId', 'Employee ID'],
                ['employeeName', 'Employee Name'],
                ['division', 'Division'],
                ['dateOfBirth', 'Date of Birth'],
                ['age', 'Age'],
                ['email', 'Email'],
            ],
            'orderBy' => 'DAY(e.date_of_birth) ASC',
        ],
        'employee-near-retirement' => [
            'label' => 'Employees Near Retirement',
            'description' => 'Active employees aged 58 and above, approaching the mandatory retirement age.',
            'where' => 'e.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) >= 58 AND LOWER(e.status) = "active"',
            'dateExpression' => null,
            'columns' => [
                ['employeeId', 'Employee ID'],
                ['employeeName', 'Employee Name'],
                ['division', 'Division'],
                ['position', 'Position'],
                ['age', 'Age'],
                ['yearsOfService', 'Years of Service'],
            ],
            'orderBy' => 'age DESC',
        ],
    ];

    foreach ($employeeVariants as $key => $options) {
        $definitions[$key] = reports_employee_definition($options);
    }

    $definitions['employees-by-division'] = reports_employee_aggregate_definition([
        'label' => 'Employees by Division',
        'description' => 'Headcount, active roster, and average tenure grouped per division.',
        'searchExpressions' => ['d.name', 'd.code'],
        'columns' => [
            ['division', 'Division'],
            ['code', 'Code'],
            ['employees', 'Employees'],
            ['activeEmployees', 'Active'],
            ['inactiveEmployees', 'Inactive'],
            ['averageTenure', 'Avg. Years of Service'],
        ],
        'sql' => 'SELECT
                d.id,
                d.name AS division,
                d.code,
                COUNT(e.id) AS employees,
                SUM(CASE WHEN LOWER(e.status) = "active" THEN 1 ELSE 0 END) AS activeEmployees,
                SUM(CASE WHEN LOWER(e.status) <> "active" THEN 1 ELSE 0 END) AS inactiveEmployees,
                ROUND(AVG(TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE())), 1) AS averageTenure
            FROM divisions d
            LEFT JOIN employees e ON e.division_id = d.id AND e.is_archived = 0
            WHERE d.is_archived = 0
            GROUP BY d.id, d.name, d.code',
        'orderBy' => 'employees DESC, d.name ASC',
    ]);

    $definitions['employees-by-designation'] = reports_employee_aggregate_definition([
        'label' => 'Employees by Position',
        'description' => 'Employee headcount grouped by position.',
        'requiredTables' => ['employees', 'designations', 'divisions'],
        'searchExpressions' => ['des.name', 'd.name'],
        'columns' => [
            ['position', 'Position'],
            ['division', 'Division'],
            ['employees', 'Employees'],
            ['activeEmployees', 'Active'],
        ],
        'sql' => 'SELECT
                des.id,
                des.name AS position,
                d.name AS division,
                COUNT(e.id) AS employees,
                SUM(CASE WHEN LOWER(e.status) = "active" THEN 1 ELSE 0 END) AS activeEmployees
            FROM designations des
            LEFT JOIN divisions d ON d.id = des.division_id
            LEFT JOIN employees e ON e.designation_id = des.id AND e.is_archived = 0
            WHERE des.is_archived = 0
            GROUP BY des.id, des.name, d.name',
        'orderBy' => 'employees DESC, des.name ASC',
    ]);

    $definitions['employees-by-employment-status'] = reports_employee_aggregate_definition([
        'label' => 'Employees by Employment Status',
        'description' => 'Distribution of the workforce across every appointment type.',
        'searchExpressions' => ['e.employment_status'],
        'columns' => [
            ['employmentStatus', 'Employment Status'],
            ['employees', 'Employees'],
            ['activeEmployees', 'Active'],
            ['averageSalary', 'Avg. Basic Salary'],
        ],
        'sql' => 'SELECT
                ' . reports_employment_status_label_sql('e.employment_status') . ' AS employmentStatus,
                COUNT(e.id) AS employees,
                SUM(CASE WHEN LOWER(e.status) = "active" THEN 1 ELSE 0 END) AS activeEmployees,
                ROUND(AVG(e.basic_salary), 2) AS averageSalary
            FROM employees e
            WHERE e.is_archived = 0
            GROUP BY ' . reports_employment_status_label_sql('e.employment_status'),
        'orderBy' => 'employees DESC',
    ]);

    $definitions['employees-by-salary-grade'] = reports_employee_aggregate_definition([
        'label' => 'Employees by Salary Bracket',
        'description' => 'Employees grouped into monthly basic salary brackets.',
        'searchExpressions' => [],
        'columns' => [
            ['bracket', 'Salary Bracket'],
            ['employees', 'Employees'],
            ['averageSalary', 'Avg. Basic Salary'],
            ['totalSalary', 'Total Basic Salary'],
        ],
        'sql' => 'SELECT
                CASE
                    WHEN e.basic_salary IS NULL THEN "Unspecified"
                    WHEN e.basic_salary < 20000 THEN "Below 20,000"
                    WHEN e.basic_salary < 30000 THEN "20,000 - 29,999"
                    WHEN e.basic_salary < 40000 THEN "30,000 - 39,999"
                    WHEN e.basic_salary < 60000 THEN "40,000 - 59,999"
                    WHEN e.basic_salary < 80000 THEN "60,000 - 79,999"
                    ELSE "80,000 and above"
                END AS bracket,
                COUNT(e.id) AS employees,
                ROUND(AVG(e.basic_salary), 2) AS averageSalary,
                ROUND(SUM(e.basic_salary), 2) AS totalSalary
            FROM employees e
            WHERE e.is_archived = 0
            GROUP BY bracket',
        'orderBy' => 'employees DESC',
    ]);

    $definitions['employees-by-age'] = reports_employee_aggregate_definition([
        'label' => 'Employees by Age Group',
        'description' => 'Age distribution of the active workforce.',
        'searchExpressions' => [],
        'columns' => [
            ['ageGroup', 'Age Group'],
            ['employees', 'Employees'],
            ['averageAge', 'Average Age'],
        ],
        'sql' => 'SELECT
                CASE
                    WHEN e.date_of_birth IS NULL THEN "Unspecified"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 26 THEN "20-25"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 31 THEN "26-30"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 36 THEN "31-35"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 41 THEN "36-40"
                    ELSE "41+"
                END AS ageGroup,
                COUNT(e.id) AS employees,
                ROUND(AVG(TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE())), 1) AS averageAge
            FROM employees e
            WHERE e.is_archived = 0
            GROUP BY ageGroup',
        'orderBy' => 'ageGroup ASC',
    ]);

    $definitions['employees-by-years-of-service'] = reports_employee_aggregate_definition([
        'label' => 'Employees by Years of Service',
        'description' => 'Tenure distribution measured from the recorded hiring date.',
        'searchExpressions' => [],
        'columns' => [
            ['serviceBracket', 'Years of Service'],
            ['employees', 'Employees'],
            ['averageYears', 'Average Years'],
        ],
        'sql' => 'SELECT
                CASE
                    WHEN e.date_hired IS NULL THEN "Unspecified"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 1 THEN "Under 1 year"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 3 THEN "1-2 years"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 6 THEN "3-5 years"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 11 THEN "6-10 years"
                    WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 21 THEN "11-20 years"
                    ELSE "21+ years"
                END AS serviceBracket,
                COUNT(e.id) AS employees,
                ROUND(AVG(TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE())), 1) AS averageYears
            FROM employees e
            WHERE e.is_archived = 0
            GROUP BY serviceBracket',
        'orderBy' => 'employees DESC',
    ]);

    // ---------------------------------------------------------------
    // Payroll reports
    // ---------------------------------------------------------------
    $payrollFilters = [
        'divisionId' => 'e.division_id',
        'employmentStatus' => reports_employment_status_label_sql('e.employment_status'),
        'payrollYear' => 'YEAR(p.payroll_date)',
        'payrollMonth' => 'MONTH(p.payroll_date)',
        'status' => 'p.status',
    ];
    $payrollJoins = 'FROM payroll p
            LEFT JOIN employees e ON e.id = p.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id';

    /*
     * First in the category, so it is the table the Payroll Reports tab opens on: a batch reaches
     * this list the moment the Cashier releases it from the payroll registry, and not before. The
     * date window runs on the release stamp (falling back to the payroll date for rows released
     * before the stamp existed), so a batch released today is in "Today" and "Last 30 Days" whatever
     * pay period it covered; the Payroll Year / Month filters still narrow by the period itself.
     */
    $definitions['payroll-released'] = [
        'label' => 'Released Payroll',
        'description' => 'Payroll the Cashier has released from the payroll registry, listed by release date.',
        'category' => 'payroll',
        'requiredTables' => ['payroll', 'employees', 'divisions'],
        'dateExpression' => reports_payroll_release_date_sql(),
        'searchExpressions' => [$employeeName, 'd.name', 'p.status', 'p.payroll_date'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['period', 'Pay Period'],
            ['grossPay', 'Gross Pay'],
            ['totalAllowance', 'Allowances'],
            ['totalDeduction', 'Deductions'],
            ['netPay', 'Net Pay'],
            ['releasedOn', 'Released On'],
            ['releasedBy', 'Released By'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                p.payroll_id AS id,
                ' . $employeeName . ' AS employeeName,
                d.name AS division,
                ' . reports_payroll_period_sql() . ' AS period,
                p.gross_pay AS grossPay,
                p.total_allowance AS totalAllowance,
                p.total_deduction AS totalDeduction,
                p.net_pay AS netPay,
                DATE(p.released_at) AS releasedOn,
                ' . reports_payroll_released_by_sql() . ' AS releasedBy,
                p.status
            ' . $payrollJoins . '
            WHERE ' . reports_payroll_released_condition(),
        'orderBy' => reports_payroll_release_date_sql() . ' DESC, p.payroll_date DESC, employeeName ASC',
        'filters' => $payrollFilters,
    ];

    $definitions['payroll-report'] = [
        'label' => 'Payroll Register',
        'description' => 'Payroll summaries including gross pay, allowances, deductions, net pay, and status.',
        'category' => 'payroll',
        'requiredTables' => ['payroll', 'employees', 'divisions'],
        'dateExpression' => 'p.payroll_date',
        'searchExpressions' => [$employeeName, 'd.name', 'p.status', 'p.payroll_date'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['payrollDate', 'Payroll Date'],
            ['grossPay', 'Gross Pay'],
            ['totalAllowance', 'Allowances'],
            ['totalDeduction', 'Deductions'],
            ['netPay', 'Net Pay'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                p.payroll_id AS id,
                ' . $employeeName . ' AS employeeName,
                d.name AS division,
                p.payroll_date AS payrollDate,
                p.gross_pay AS grossPay,
                p.total_allowance AS totalAllowance,
                p.total_deduction AS totalDeduction,
                p.net_pay AS netPay,
                p.status
            ' . $payrollJoins,
        'orderBy' => 'p.payroll_date DESC, employeeName ASC',
        'filters' => $payrollFilters,
    ];

    $definitions['payroll-pending'] = [
        'label' => 'Pending Payroll',
        'description' => 'Payroll runs still awaiting review, approval, or release.',
        'category' => 'payroll',
        'requiredTables' => ['payroll', 'employees', 'divisions'],
        'dateExpression' => 'p.payroll_date',
        'searchExpressions' => [$employeeName, 'd.name', 'p.status'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['payrollDate', 'Payroll Date'],
            ['grossPay', 'Gross Pay'],
            ['netPay', 'Net Pay'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                p.payroll_id AS id,
                ' . $employeeName . ' AS employeeName,
                d.name AS division,
                p.payroll_date AS payrollDate,
                p.gross_pay AS grossPay,
                p.net_pay AS netPay,
                p.status
            ' . $payrollJoins . '
            WHERE ' . reports_payroll_pending_condition(),
        'orderBy' => 'p.payroll_date DESC, employeeName ASC',
        'filters' => $payrollFilters,
    ];

    $definitions['payroll-by-division'] = [
        'label' => 'Payroll by Division',
        'description' => 'Total payroll expense aggregated per division.',
        'category' => 'payroll',
        'requiredTables' => ['payroll', 'employees', 'divisions'],
        'dateExpression' => 'p.payroll_date',
        'searchExpressions' => ['d.name'],
        'columns' => reports_columns([
            ['division', 'Division'],
            ['employees', 'Employees'],
            ['payrollRuns', 'Payroll Runs'],
            ['grossPay', 'Gross Pay'],
            ['totalDeduction', 'Deductions'],
            ['netPay', 'Net Pay'],
        ]),
        'sql' => 'SELECT
                COALESCE(d.name, "Unassigned") AS division,
                COUNT(DISTINCT p.employee_id) AS employees,
                COUNT(p.payroll_id) AS payrollRuns,
                ROUND(SUM(p.gross_pay), 2) AS grossPay,
                ROUND(SUM(p.total_deduction), 2) AS totalDeduction,
                ROUND(SUM(p.net_pay), 2) AS netPay
            ' . $payrollJoins . '
            GROUP BY COALESCE(d.name, "Unassigned")',
        'orderBy' => 'netPay DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => $payrollFilters,
    ];

    $definitions['payroll-by-employee'] = [
        'label' => 'Payroll by Employee',
        'description' => 'Year-to-date payroll totals summarised per employee.',
        'category' => 'payroll',
        'requiredTables' => ['payroll', 'employees', 'divisions'],
        'dateExpression' => 'p.payroll_date',
        'searchExpressions' => [$employeeName, 'd.name'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['payrollRuns', 'Payroll Runs'],
            ['grossPay', 'Gross Pay'],
            ['totalDeduction', 'Deductions'],
            ['netPay', 'Net Pay'],
        ]),
        'sql' => 'SELECT
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                COUNT(p.payroll_id) AS payrollRuns,
                ROUND(SUM(p.gross_pay), 2) AS grossPay,
                ROUND(SUM(p.total_deduction), 2) AS totalDeduction,
                ROUND(SUM(p.net_pay), 2) AS netPay
            ' . $payrollJoins . '
            GROUP BY p.employee_id, employeeName, division',
        'orderBy' => 'netPay DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => $payrollFilters,
    ];

    $definitions['payroll-summary'] = [
        'label' => 'Payroll Summary (Monthly)',
        'description' => 'Month-by-month payroll totals across the selected period.',
        'category' => 'payroll',
        'requiredTables' => ['payroll'],
        'dateExpression' => 'p.payroll_date',
        'searchExpressions' => [],
        'columns' => reports_columns([
            ['period', 'Period'],
            ['payrollRuns', 'Payroll Runs'],
            ['employees', 'Employees'],
            ['grossPay', 'Gross Pay'],
            ['totalAllowance', 'Allowances'],
            ['totalDeduction', 'Deductions'],
            ['netPay', 'Net Pay'],
        ]),
        // The employee join carries the division, so a division-scoped desk's monthly totals
        // cover its own people only.
        'sql' => 'SELECT
                DATE_FORMAT(p.payroll_date, "%Y-%m") AS period,
                COUNT(p.payroll_id) AS payrollRuns,
                COUNT(DISTINCT p.employee_id) AS employees,
                ROUND(SUM(p.gross_pay), 2) AS grossPay,
                ROUND(SUM(p.total_allowance), 2) AS totalAllowance,
                ROUND(SUM(p.total_deduction), 2) AS totalDeduction,
                ROUND(SUM(p.net_pay), 2) AS netPay
            FROM payroll p
            LEFT JOIN employees e ON e.id = p.employee_id
            GROUP BY DATE_FORMAT(p.payroll_date, "%Y-%m")',
        'orderBy' => 'period DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => ['divisionId' => 'e.division_id'],
    ];

    $definitions['payroll-deductions'] = [
        'label' => 'Payroll Deductions',
        'description' => 'Itemised deductions applied to payroll runs, grouped by deduction type.',
        'category' => 'payroll',
        'requiredTables' => ['payroll'],
        'dateExpression' => null,
        'searchExpressions' => [],
        'columns' => reports_columns([
            ['deductionName', 'Deduction'],
            ['category', 'Category'],
            ['records', 'Records'],
            ['totalAmount', 'Total Amount'],
        ]),
        'sql' => '',
        'fetchRows' => 'reports_fetch_payroll_deduction_rows',
        'isAggregate' => true,
        // Honoured inside the fetcher rather than by SQL injection like the others.
        'filters' => ['divisionId' => 'e.division_id'],
    ];

    $definitions['payroll-net-pay-summary'] = [
        'label' => 'Net Pay Summary',
        'description' => 'Net pay totals per payroll status for the selected period.',
        'category' => 'payroll',
        'requiredTables' => ['payroll'],
        'dateExpression' => 'p.payroll_date',
        'searchExpressions' => ['p.status'],
        'columns' => reports_columns([
            ['status', 'Payroll Status'],
            ['payrollRuns', 'Payroll Runs'],
            ['grossPay', 'Gross Pay'],
            ['totalDeduction', 'Deductions'],
            ['netPay', 'Net Pay'],
        ]),
        'sql' => 'SELECT
                COALESCE(NULLIF(TRIM(p.status), ""), "Unspecified") AS status,
                COUNT(p.payroll_id) AS payrollRuns,
                ROUND(SUM(p.gross_pay), 2) AS grossPay,
                ROUND(SUM(p.total_deduction), 2) AS totalDeduction,
                ROUND(SUM(p.net_pay), 2) AS netPay
            FROM payroll p
            LEFT JOIN employees e ON e.id = p.employee_id
            GROUP BY COALESCE(NULLIF(TRIM(p.status), ""), "Unspecified")',
        'orderBy' => 'netPay DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => ['divisionId' => 'e.division_id'],
    ];

    // ---------------------------------------------------------------
    // Leave reports
    // ---------------------------------------------------------------
    $leaveFilters = [
        'employeeId' => 'e.id',
        'divisionId' => 'e.division_id',
        'leaveTypeId' => 'lr.leave_type_id',
        // A reviewed filing is still pending final action, so the reporting filter deliberately
        // presents both workflow states as one public-facing Pending status.
        'status' => 'CASE WHEN LOWER(lr.status) IN ("pending", "endorsed", "reviewed") THEN "pending" ELSE LOWER(lr.status) END',
    ];
    $leaveJoins = 'FROM leave_requests lr
            INNER JOIN employees e ON e.id = lr.employee_id
            INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
            LEFT JOIN divisions d ON d.id = e.division_id';
    $leaveStatus = 'CASE
                WHEN LOWER(lr.status) IN ("pending", "endorsed", "reviewed") THEN "Pending"
                ELSE CONCAT(UPPER(LEFT(lr.status, 1)), LOWER(SUBSTRING(lr.status, 2)))
            END';
    $paidDays = 'COALESCE(lr.paid_days, CASE WHEN lt.is_with_pay = 1 THEN lr.total_days ELSE 0 END)';
    $unpaidDays = 'COALESCE(lr.unpaid_days, CASE WHEN lt.is_with_pay = 1 THEN 0 ELSE lr.total_days END)';

    /*
     * leave_credits.remaining_credits is the current authority. To show the balance that surrounded
     * an older application, add back approved usage and monetization that happened at or after that
     * filing. This reconstructs history from the records the leave workflow already owns and avoids
     * creating a duplicate balance ledger just for reporting.
     */
    $leaveBalanceBefore = 'ROUND(COALESCE(lc.remaining_credits, 0)
                + COALESCE((
                    SELECT SUM(COALESCE(lr_future.paid_days, lr_future.total_days))
                    FROM leave_requests lr_future
                    WHERE lr_future.employee_id = lr.employee_id
                      AND lr_future.leave_type_id = lr.leave_type_id
                      AND YEAR(lr_future.start_date) = YEAR(lr.start_date)
                      AND LOWER(lr_future.status) = "approved"
                      AND (lr_future.requested_at > lr.requested_at
                           OR (lr_future.requested_at = lr.requested_at
                               AND lr_future.leave_request_id >= lr.leave_request_id))
                ), 0)
                + COALESCE((
                    SELECT SUM(lm_future.number_of_days)
                    FROM leave_monetization_requests lm_future
                    WHERE lm_future.employee_id = lr.employee_id
                      AND lm_future.leave_type_id = lr.leave_type_id
                      AND YEAR(lm_future.date_filed) = YEAR(lr.start_date)
                      AND LOWER(lm_future.status) = "approved"
                      AND lm_future.date_filed >= DATE(lr.requested_at)
                ), 0), 2)';
    $leaveBalanceAfter = 'ROUND((' . $leaveBalanceBefore . ')
                - CASE WHEN LOWER(lr.status) = "approved" THEN ' . $paidDays . ' ELSE 0 END, 2)';
    $leaveSelect = 'SELECT
                lr.leave_request_id AS id,
                e.employee_id AS employeeNo,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                lt.name AS leaveType,
                DATE(lr.requested_at) AS dateFiled,
                CONCAT(DATE_FORMAT(lr.start_date, "%b %e, %Y"), " - ", DATE_FORMAT(lr.end_date, "%b %e, %Y")) AS leavePeriod,
                ' . $paidDays . ' AS withPay,
                ' . $unpaidDays . ' AS withoutPay,
                lr.total_days AS totalDays,
                ' . $leaveBalanceBefore . ' AS balanceBefore,
                ' . $leaveBalanceAfter . ' AS balanceAfter,
                ' . $leaveStatus . ' AS status,
                lr.start_date AS startDateRaw,
                lr.end_date AS endDateRaw,
                DATE(lr.updated_at) AS approvalDateRaw
            ' . $leaveJoins;

    $definitions['leave-applications'] = [
        'label' => 'Leave Applications',
        'description' => 'Filed, approved, pending, rejected, and cancelled leave applications in one report.',
        'category' => 'leave',
        'requiredTables' => ['leave_requests', 'leave_types', 'employees', 'leave_credits', 'leave_monetization_requests', 'divisions'],
        'dateExpression' => 'lr.requested_at',
        'searchExpressions' => ['e.employee_id', $employeeName, 'lt.name', 'lr.status', 'lr.reason', 'd.name'],
        'columns' => reports_columns([
            ['rowNumber', '#'],
            ['employeeNo', 'Employee No.'],
            ['employeeName', 'Employee Name'],
            ['division', 'Division/Department'],
            ['leaveType', 'Leave Type'],
            ['dateFiled', 'Date Filed'],
            ['leavePeriod', 'Leave Period'],
            ['withPay', 'With Pay'],
            ['withoutPay', 'Without Pay'],
            ['totalDays', 'Total Days'],
            ['balanceBefore', 'Balance Before'],
            ['balanceAfter', 'Balance After'],
            ['status', 'Status'],
        ]),
        'sql' => $leaveSelect . '
            LEFT JOIN leave_credits lc
              ON lc.employee_id = lr.employee_id
             AND lc.leave_type_id = lr.leave_type_id
             AND lc.year = YEAR(lr.start_date)',
        'orderBy' => 'lr.requested_at DESC, employeeName ASC',
        'filters' => $leaveFilters,
        'includeRowNumber' => true,
    ];

    $definitions['leave-monetization'] = [
        'label' => 'Leave Monetization',
        'description' => 'All leave monetization requests, their approval results, and computed amounts.',
        'category' => 'leave',
        'requiredTables' => ['leave_monetization_requests', 'employees', 'leave_types', 'divisions'],
        'dateExpression' => 'lm.date_filed',
        'searchExpressions' => ['e.employee_id', $employeeName, 'lt.name', 'lm.status', 'd.name'],
        'columns' => reports_columns([
            ['rowNumber', '#'],
            ['employeeNo', 'Employee No.'],
            ['employeeName', 'Employee Name'],
            ['division', 'Division/Department'],
            ['leaveType', 'Leave Type'],
            ['dateRequested', 'Date Requested'],
            ['availableLeaveBalance', 'Available Leave Balance'],
            ['daysRequested', 'Days Requested for Monetization'],
            ['daysApproved', 'Days Approved'],
            ['rateBasis', 'Rate / Basis'],
            ['computedAmount', 'Computed Amount'],
            ['approvalDate', 'Approval Date'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                lm.id,
                e.employee_id AS employeeNo,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                lt.name AS leaveType,
                lm.date_filed AS dateRequested,
                lm.credits_before AS availableLeaveBalance,
                lm.number_of_days AS daysRequested,
                CASE WHEN LOWER(lm.status) = "approved" THEN lm.number_of_days ELSE 0 END AS daysApproved,
                lm.daily_rate AS rateBasis,
                lm.estimated_amount AS computedAmount,
                lm.approved_at AS approvalDate,
                CASE
                    WHEN LOWER(lm.status) IN ("pending", "reviewed") THEN "Pending"
                    ELSE CONCAT(UPPER(LEFT(lm.status, 1)), LOWER(SUBSTRING(lm.status, 2)))
                END AS status
            FROM leave_monetization_requests lm
            INNER JOIN employees e ON e.id = lm.employee_id
            LEFT JOIN leave_types lt ON lt.leave_type_id = lm.leave_type_id
            LEFT JOIN divisions d ON d.id = e.division_id',
        'orderBy' => 'lm.date_filed DESC, employeeName ASC',
        'filters' => [
            'employeeId' => 'e.id',
            'divisionId' => 'e.division_id',
            'status' => 'CASE WHEN LOWER(lm.status) IN ("pending", "reviewed") THEN "pending" ELSE LOWER(lm.status) END',
        ],
        'includeRowNumber' => true,
    ];

    $definitions['leave-balance'] = [
        'label' => 'Leave Balance',
        'description' => 'Current employee leave credits, usage, monetization, and remaining balances.',
        'category' => 'leave',
        'requiredTables' => ['leave_credits', 'leave_types', 'employees', 'leave_monetization_requests', 'divisions'],
        'dateExpression' => null,
        'searchExpressions' => ['e.employee_id', $employeeName, 'lt.name', 'd.name'],
        'columns' => reports_columns([
            ['rowNumber', '#'],
            ['employeeNo', 'Employee No.'],
            ['employeeName', 'Employee Name'],
            ['division', 'Division/Department'],
            ['leaveType', 'Leave Type'],
            ['beginningBalance', 'Beginning Balance'],
            ['earnedCredits', 'Earned Credits'],
            ['usedCredits', 'Used Credits'],
            ['monetizedCredits', 'Monetized Credits'],
            ['adjustments', 'Adjustments'],
            ['remainingBalance', 'Remaining Balance'],
            ['asOfDate', 'As of Date'],
        ]),
        'sql' => 'SELECT
                lc.leave_credits_id AS id,
                e.employee_id AS employeeNo,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                lt.name AS leaveType,
                lc.year,
                ROUND(lc.total_credits + COALESCE((
                    SELECT SUM(lm.number_of_days)
                    FROM leave_monetization_requests lm
                    WHERE lm.employee_id = lc.employee_id
                      AND lm.leave_type_id = lc.leave_type_id
                      AND YEAR(lm.date_filed) = lc.year
                      AND LOWER(lm.status) = "approved"
                ), 0), 2) AS beginningBalance,
                0.00 AS earnedCredits,
                lc.used_credits AS usedCredits,
                COALESCE((
                    SELECT SUM(lm.number_of_days)
                    FROM leave_monetization_requests lm
                    WHERE lm.employee_id = lc.employee_id
                      AND lm.leave_type_id = lc.leave_type_id
                      AND YEAR(lm.date_filed) = lc.year
                      AND LOWER(lm.status) = "approved"
                ), 0) AS monetizedCredits,
                0.00 AS adjustments,
                lc.remaining_credits AS remainingBalance,
                DATE(lc.updated_at) AS asOfDate
            FROM leave_credits lc
            INNER JOIN employees e ON e.id = lc.employee_id
            INNER JOIN leave_types lt ON lt.leave_type_id = lc.leave_type_id
            LEFT JOIN divisions d ON d.id = e.division_id
            WHERE e.is_archived = 0',
        'orderBy' => 'employeeName ASC, lt.name ASC',
        'filters' => [
            'employeeId' => 'e.id',
            'divisionId' => 'e.division_id',
            'leaveTypeId' => 'lc.leave_type_id',
            'year' => 'lc.year',
        ],
        'includeRowNumber' => true,
    ];

    $definitions['leave-utilization'] = [
        'label' => 'Leave Utilization',
        'description' => 'Approved leave days actually consumed, including paid and unpaid portions.',
        'category' => 'leave',
        'requiredTables' => ['leave_requests', 'leave_types', 'employees', 'leave_credits', 'leave_monetization_requests', 'divisions'],
        'dateExpression' => 'lr.start_date',
        'searchExpressions' => ['e.employee_id', $employeeName, 'lt.name', 'd.name'],
        'columns' => reports_columns([
            ['rowNumber', '#'],
            ['employeeNo', 'Employee No.'],
            ['employeeName', 'Employee Name'],
            ['division', 'Division/Department'],
            ['leaveType', 'Leave Type'],
            ['leavePeriod', 'Leave Period'],
            ['dateApproved', 'Date Approved'],
            ['withPay', 'With Pay'],
            ['withoutPay', 'Without Pay'],
            ['totalDaysUsed', 'Total Days Used'],
            ['balanceBefore', 'Balance Before'],
            ['balanceAfter', 'Balance After'],
        ]),
        'sql' => 'SELECT
                lr.leave_request_id AS id,
                e.employee_id AS employeeNo,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                lt.name AS leaveType,
                CONCAT(DATE_FORMAT(lr.start_date, "%b %e, %Y"), " - ", DATE_FORMAT(lr.end_date, "%b %e, %Y")) AS leavePeriod,
                DATE(lr.updated_at) AS dateApproved,
                ' . $paidDays . ' AS withPay,
                ' . $unpaidDays . ' AS withoutPay,
                lr.total_days AS totalDaysUsed,
                ' . $leaveBalanceBefore . ' AS balanceBefore,
                ' . $leaveBalanceAfter . ' AS balanceAfter,
                lr.start_date AS startDateRaw
            ' . $leaveJoins . '
            LEFT JOIN leave_credits lc
              ON lc.employee_id = lr.employee_id
             AND lc.leave_type_id = lr.leave_type_id
             AND lc.year = YEAR(lr.start_date)
            WHERE LOWER(lr.status) = "approved"',
        'orderBy' => 'lr.start_date DESC, employeeName ASC',
        'filters' => [
            'employeeId' => 'e.id',
            'divisionId' => 'e.division_id',
            'leaveTypeId' => 'lr.leave_type_id',
        ],
        'includeRowNumber' => true,
    ];

    // ---------------------------------------------------------------
    // Attendance reports
    // ---------------------------------------------------------------
    $attendanceFilters = [
        'divisionId' => 'e.division_id',
        'employmentStatus' => reports_employment_status_label_sql('e.employment_status'),
        'status' => 'adr.status',
    ];
    $attendanceJoins = 'FROM attendance_daily_records adr
            INNER JOIN employees e ON e.id = adr.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id';
    $attendanceColumns = [
        ['employeeName', 'Employee Name'],
        ['division', 'Division'],
        ['date', 'Date'],
        ['timeIn', 'Time In'],
        ['timeOut', 'Time Out'],
        ['totalHours', 'Total Hours'],
        ['lateMinutes', 'Late (min)'],
        ['undertimeMinutes', 'Undertime (min)'],
        ['status', 'Status'],
    ];
    $attendanceSelect = 'SELECT
                adr.id,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                adr.attendance_date AS date,
                IFNULL(DATE_FORMAT(adr.time_in, "%l:%i %p"), "N/A") AS timeIn,
                IFNULL(DATE_FORMAT(adr.time_out, "%l:%i %p"), "N/A") AS timeOut,
                ROUND(adr.total_minutes / 60, 2) AS totalHours,
                adr.late_minutes AS lateMinutes,
                adr.undertime_minutes AS undertimeMinutes,
                adr.status
            ' . $attendanceJoins;

    $attendanceVariants = [
        'attendance-report' => ['label' => 'Daily Attendance Report', 'description' => 'Daily attendance with time in, time out, total hours, and attendance status.', 'where' => ''],
        'attendance-absences' => ['label' => 'Absences', 'description' => 'Attendance records flagged as absent.', 'where' => 'LOWER(adr.status) = "absent"'],
        'attendance-late' => ['label' => 'Late Employees', 'description' => 'Attendance records with recorded tardiness.', 'where' => 'adr.late_minutes > 0'],
        'attendance-undertime' => ['label' => 'Undertime', 'description' => 'Attendance records with recorded undertime.', 'where' => 'adr.undertime_minutes > 0'],
    ];

    foreach ($attendanceVariants as $key => $options) {
        $definitions[$key] = [
            'label' => $options['label'],
            'description' => $options['description'],
            'category' => 'attendance',
            'requiredTables' => ['attendance_daily_records', 'employees', 'divisions'],
            'dateExpression' => 'adr.attendance_date',
            'searchExpressions' => [$employeeName, 'd.name', 'adr.status'],
            'columns' => reports_columns($attendanceColumns),
            'sql' => $attendanceSelect . ($options['where'] !== '' ? ' WHERE ' . $options['where'] : ''),
            'orderBy' => 'adr.attendance_date DESC, employeeName ASC',
            'filters' => $attendanceFilters,
        ];
    }

    $definitions['attendance-monthly'] = [
        'label' => 'Monthly Attendance Summary',
        'description' => 'Attendance totals per employee across the selected period.',
        'category' => 'attendance',
        'requiredTables' => ['attendance_daily_records', 'employees'],
        'dateExpression' => 'adr.attendance_date',
        'searchExpressions' => [$employeeName, 'd.name'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['daysLogged', 'Days Logged'],
            ['presentDays', 'Present'],
            ['absentDays', 'Absent'],
            ['totalHours', 'Total Hours'],
            ['lateMinutes', 'Late (min)'],
            ['undertimeMinutes', 'Undertime (min)'],
        ]),
        'sql' => 'SELECT
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                COUNT(adr.id) AS daysLogged,
                SUM(CASE WHEN LOWER(adr.status) = "present" THEN 1 ELSE 0 END) AS presentDays,
                SUM(CASE WHEN LOWER(adr.status) = "absent" THEN 1 ELSE 0 END) AS absentDays,
                ROUND(SUM(adr.total_minutes) / 60, 2) AS totalHours,
                SUM(adr.late_minutes) AS lateMinutes,
                SUM(adr.undertime_minutes) AS undertimeMinutes
            ' . $attendanceJoins . '
            GROUP BY adr.employee_id, employeeName, division',
        'orderBy' => 'employeeName ASC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => $attendanceFilters,
    ];

    $definitions['overtime-report'] = [
        'label' => 'Overtime Report',
        'description' => 'Filed overtime requests with division, overtime date, requested hours, and approval status.',
        'category' => 'attendance',
        'requiredTables' => ['overtime', 'employees', 'divisions'],
        'dateExpression' => 'o.work_date',
        'searchExpressions' => [$employeeName, 'd.name', 'o.reason', 'o.status'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['overtimeDate', 'Overtime Date'],
            ['hours', 'Hours'],
            ['approvalStatus', 'Approval Status'],
        ]),
        'sql' => 'SELECT
                o.overtime_id AS id,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                o.work_date AS overtimeDate,
                o.hour_requested AS hours,
                o.status AS approvalStatus
            FROM overtime o
            INNER JOIN employees e ON e.id = o.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id',
        'orderBy' => 'o.work_date DESC, employeeName ASC',
        'filters' => [
            'divisionId' => 'e.division_id',
            'status' => 'o.status',
        ],
    ];

    $definitions['cto-report'] = [
        'label' => 'Compensatory Time Off (CTO) Report',
        'description' => 'Compensatory time off requests with covered dates, applied hours, and status.',
        'category' => 'attendance',
        'requiredTables' => ['compensatory', 'employees', 'divisions'],
        'dateExpression' => 'c.start_date',
        'searchExpressions' => [$employeeName, 'd.name', 'c.status', 'c.remarks'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['startDate', 'Start Date'],
            ['endDate', 'End Date'],
            ['hours', 'Hours'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                c.id,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                c.start_date AS startDate,
                c.end_date AS endDate,
                c.hours_applied AS hours,
                c.status
            FROM compensatory c
            INNER JOIN employees e ON e.id = c.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id',
        'orderBy' => 'c.start_date DESC, employeeName ASC',
        'filters' => [
            'divisionId' => 'e.division_id',
            'status' => 'c.status',
        ],
    ];

    // ---------------------------------------------------------------
    // Travel order reports
    // ---------------------------------------------------------------
    /*
     * One public status per filing, the way the leave reports read: a travel order the Planning
     * Officer has recommended ("reviewed") or the Division Chief has approved ("chief_reviewed") is
     * still waiting on the next desk, so every open stage reports as Pending. The raw stage stays on
     * the row for the analytics.
     */
    $travelStatus = 'CASE LOWER(t.status)
                WHEN "approved" THEN "Approved"
                WHEN "rejected" THEN "Rejected"
                WHEN "cancelled" THEN "Cancelled"
                ELSE "Pending"
            END';
    $definitions['travel-orders'] = [
        'label' => 'Travel Orders',
        'description' => 'Every travel order with destination, purpose, travel dates, days away, and status. The date range follows the travel start date.',
        'category' => 'travel',
        'requiredTables' => ['travel_orders', 'employees', 'divisions'],
        'dateExpression' => 't.start_date',
        'searchExpressions' => ['e.employee_id', $employeeName, 'd.name', 't.destination', 't.purpose', 't.status'],
        'columns' => reports_columns([
            ['rowNumber', '#'],
            ['employeeNo', 'Employee No.'],
            ['employeeName', 'Employee Name'],
            ['division', 'Division/Department'],
            ['destination', 'Destination'],
            ['purpose', 'Purpose'],
            ['dateFiled', 'Date Filed'],
            ['travelPeriod', 'Travel Period'],
            ['travelDays', 'Days'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                t.travel_order_id AS id,
                e.employee_id AS employeeNo,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                t.destination,
                t.purpose,
                DATE(t.created_at) AS dateFiled,
                CONCAT(DATE_FORMAT(t.start_date, "%b %e, %Y"), " - ", DATE_FORMAT(COALESCE(t.end_date, t.start_date), "%b %e, %Y")) AS travelPeriod,
                DATEDIFF(COALESCE(t.end_date, t.start_date), t.start_date) + 1 AS travelDays,
                ' . $travelStatus . ' AS status,
                LOWER(t.status) AS workflowStage,
                t.start_date AS startDateRaw
            FROM travel_orders t
            INNER JOIN employees e ON e.id = t.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id',
        'orderBy' => 't.start_date DESC, employeeName ASC',
        'filters' => [
            'employeeId' => 'e.id',
            'divisionId' => 'e.division_id',
            'status' => 'CASE WHEN LOWER(t.status) IN ("pending", "reviewed", "chief_reviewed") THEN "pending" ELSE LOWER(t.status) END',
        ],
        'includeRowNumber' => true,
    ];

    // ---------------------------------------------------------------
    // Compensatory time off reports
    // ---------------------------------------------------------------
    /* Pending, Endorsed and Reviewed are the three open signatures of one filing: all Pending here. */
    $ctoStatus = 'CASE c.status
                WHEN "Approved" THEN "Approved"
                WHEN "Rejected" THEN "Rejected"
                WHEN "Cancelled" THEN "Cancelled"
                ELSE "Pending"
            END';
    $definitions['cto-requests'] = [
        'label' => 'Compensatory Time Off Requests',
        'description' => 'CTO filings with covered dates, hours applied, credit balance at filing, unpaid hours, and status. The date range follows the CTO start date.',
        'category' => 'cto',
        'requiredTables' => ['compensatory', 'employees', 'divisions'],
        'dateExpression' => 'c.start_date',
        'searchExpressions' => ['e.employee_id', $employeeName, 'd.name', 'c.status', 'c.remarks'],
        'columns' => reports_columns([
            ['rowNumber', '#'],
            ['employeeNo', 'Employee No.'],
            ['employeeName', 'Employee Name'],
            ['division', 'Division/Department'],
            ['dateFiled', 'Date Filed'],
            ['ctoPeriod', 'CTO Period'],
            ['hoursApplied', 'Hours Applied'],
            ['cocBalanceHours', 'Credit Balance at Filing'],
            ['unpaidHours', 'Unpaid Hours'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                c.id,
                e.employee_id AS employeeNo,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                DATE(c.created_at) AS dateFiled,
                CONCAT(DATE_FORMAT(c.start_date, "%b %e, %Y"), " - ", DATE_FORMAT(COALESCE(c.end_date, c.start_date), "%b %e, %Y")) AS ctoPeriod,
                c.hours_applied AS hoursApplied,
                COALESCE(c.coc_balance_hours, 0) AS cocBalanceHours,
                COALESCE(c.unpaid_hours, 0) AS unpaidHours,
                ' . $ctoStatus . ' AS status,
                c.status AS workflowStage,
                c.start_date AS startDateRaw
            FROM compensatory c
            INNER JOIN employees e ON e.id = c.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id',
        'orderBy' => 'c.start_date DESC, employeeName ASC',
        'filters' => [
            'employeeId' => 'e.id',
            'divisionId' => 'e.division_id',
            'status' => 'CASE WHEN c.status IN ("Pending", "Endorsed", "Reviewed") THEN "pending" ELSE LOWER(c.status) END',
        ],
        'includeRowNumber' => true,
    ];

    // ---------------------------------------------------------------
    // Performance reports
    // ---------------------------------------------------------------
    $definitions['ipcr-report'] = [
        'label' => 'IPCR Summary',
        'description' => 'Employee IPCR records, review period, submission date, remarks, and final rating.',
        'category' => 'performance',
        'requiredTables' => ['ipcr', 'employees', 'divisions'],
        'dateExpression' => 'COALESCE(DATE(i.submitted_at), i.period_to)',
        'searchExpressions' => [$employeeName, 'd.name', 'i.output', 'i.remarks'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['periodFrom', 'Period From'],
            ['periodTo', 'Period To'],
            ['submittedAt', 'Submitted At'],
            ['finalRating', 'Final Rating'],
            ['remarks', 'Remarks'],
        ]),
        'sql' => 'SELECT
                i.ipcr_id AS id,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                i.period_from AS periodFrom,
                i.period_to AS periodTo,
                i.submitted_at AS submittedAt,
                i.final_rating AS finalRating,
                i.remarks
            FROM ipcr i
            INNER JOIN employees e ON e.id = i.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            WHERE i.is_archived = 0',
        'orderBy' => 'COALESCE(i.submitted_at, i.period_to) DESC, employeeName ASC',
        'filters' => ['divisionId' => 'e.division_id'],
    ];

    $definitions['performance-evaluation-report'] = [
        'label' => 'OPCR Summary',
        'description' => 'Division performance evaluation assignments and final ratings.',
        'category' => 'performance',
        'requiredTables' => ['division_opcr_assignments'],
        'dateExpression' => 'doa.created_at',
        'searchExpressions' => ['doa.opcr_no', 'doa.division', 'doa.period', 'doa.assignment_status', 'doa.prepared_by'],
        'columns' => reports_columns([
            ['opcrNo', 'OPCR No.'],
            ['division', 'Division'],
            ['period', 'Period'],
            ['semester', 'Semester'],
            ['preparedBy', 'Prepared By'],
            ['status', 'Status'],
            ['finalRating', 'Final Rating'],
        ]),
        /*
         * An OPCR assignment records its division by name, not id, so the division filter is
         * resolved through a name join -- the same pairing reports_performance_by_division() makes
         * for the dashboard. Both columns are utf8mb4_unicode_ci, so the join needs no COLLATE.
         */
        'sql' => 'SELECT
                doa.assignment_id AS id,
                doa.opcr_no AS opcrNo,
                doa.division,
                doa.period,
                doa.semester,
                doa.prepared_by AS preparedBy,
                doa.assignment_status AS status,
                doa.final_rating AS finalRating
            FROM division_opcr_assignments doa
            LEFT JOIN divisions dv ON LOWER(TRIM(dv.name)) = LOWER(TRIM(doa.division)) AND dv.is_archived = 0
            WHERE doa.is_archived = 0',
        'orderBy' => 'doa.created_at DESC, doa.assignment_id DESC',
        'filters' => ['divisionId' => 'dv.id'],
    ];

    $definitions['performance-top-performers'] = [
        'label' => 'Top Performers',
        'description' => 'Employees with the highest average IPCR rating for the selected period.',
        'category' => 'performance',
        'requiredTables' => ['ipcr', 'employees'],
        'dateExpression' => 'COALESCE(DATE(i.submitted_at), i.period_to)',
        'searchExpressions' => [$employeeName, 'd.name'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['evaluations', 'Evaluations'],
            ['averageRating', 'Average Rating'],
            ['highestRating', 'Highest Rating'],
        ]),
        'sql' => 'SELECT
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                COUNT(i.ipcr_id) AS evaluations,
                ROUND(AVG(i.final_rating), 3) AS averageRating,
                ROUND(MAX(i.final_rating), 3) AS highestRating
            FROM ipcr i
            INNER JOIN employees e ON e.id = i.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            WHERE i.is_archived = 0 AND i.final_rating IS NOT NULL
            GROUP BY i.employee_id, employeeName, division',
        'orderBy' => 'averageRating DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => ['divisionId' => 'e.division_id'],
    ];

    $definitions['performance-division-ratings'] = [
        'label' => 'Division Ratings',
        'description' => 'Average IPCR rating aggregated per division.',
        'category' => 'performance',
        'requiredTables' => ['ipcr', 'employees', 'divisions'],
        'dateExpression' => 'COALESCE(DATE(i.submitted_at), i.period_to)',
        'searchExpressions' => ['d.name'],
        'columns' => reports_columns([
            ['division', 'Division'],
            ['evaluations', 'Evaluations'],
            ['employees', 'Employees Rated'],
            ['averageRating', 'Average Rating'],
        ]),
        'sql' => 'SELECT
                COALESCE(d.name, "Unassigned") AS division,
                COUNT(i.ipcr_id) AS evaluations,
                COUNT(DISTINCT i.employee_id) AS employees,
                ROUND(AVG(i.final_rating), 3) AS averageRating
            FROM ipcr i
            INNER JOIN employees e ON e.id = i.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            WHERE i.is_archived = 0 AND i.final_rating IS NOT NULL
            GROUP BY COALESCE(d.name, "Unassigned")',
        'orderBy' => 'averageRating DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => ['divisionId' => 'e.division_id'],
    ];

    // ---------------------------------------------------------------
    // Audit reports
    // ---------------------------------------------------------------
    $auditColumns = [
        ['createdAt', 'Timestamp'],
        ['actorName', 'User'],
        ['actorRole', 'Role'],
        ['action', 'Action'],
        ['summary', 'Summary'],
        ['ipAddress', 'IP Address'],
        ['browser', 'Browser'],
        ['device', 'Device'],
    ];
    $auditSelect = 'SELECT
                al.id,
                DATE_FORMAT(al.created_at, "%Y-%m-%d %H:%i:%s") AS createdAt,
                COALESCE(al.actor_name, u.username, "System") AS actorName,
                COALESCE(al.actor_role, "N/A") AS actorRole,
                al.action,
                al.summary,
                al.ip_address AS ipAddress,
                al.browser,
                al.device
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id';

    $auditVariants = [
        'audit-activity-logs' => ['label' => 'Activity Logs', 'description' => 'Full system activity trail for the selected period.', 'where' => ''],
        'audit-login-history' => ['label' => 'Login History', 'description' => 'Authentication events including sign-in, sign-out, and failed attempts.', 'where' => 'LOWER(COALESCE(al.category, "")) = "auth"'],
        'audit-report-actions' => ['label' => 'Report Actions', 'description' => 'Report generation, export, print, and delete activity.', 'where' => 'LOWER(COALESCE(al.category, "")) = "reports"'],
    ];

    foreach ($auditVariants as $key => $options) {
        $definitions[$key] = [
            'label' => $options['label'],
            'description' => $options['description'],
            'category' => 'audit',
            'requiredTables' => ['audit_logs'],
            'dateExpression' => 'al.created_at',
            'searchExpressions' => ['al.action', 'al.summary', 'al.actor_name', 'al.ip_address', 'al.browser'],
            'columns' => reports_columns($auditColumns),
            'sql' => $auditSelect . ($options['where'] !== '' ? ' WHERE ' . $options['where'] : ''),
            'orderBy' => 'al.created_at DESC',
        ];
    }

    $definitions['department-division-report'] = [
        'label' => 'Department/Division Report',
        'description' => 'Division-level employee counts and active roster coverage.',
        'category' => 'employee',
        'requiredTables' => ['divisions', 'employees', 'designations'],
        'dateExpression' => null,
        'searchExpressions' => ['d.name', 'd.code'],
        'columns' => reports_columns([
            ['division', 'Division'],
            ['code', 'Code'],
            ['employees', 'Employees'],
            ['activeEmployees', 'Active Employees'],
            ['positions', 'Positions'],
        ]),
        'sql' => 'SELECT
                d.id,
                d.name AS division,
                d.code,
                COUNT(DISTINCT e.id) AS employees,
                SUM(CASE WHEN e.status = "Active" THEN 1 ELSE 0 END) AS activeEmployees,
                COUNT(DISTINCT des.id) AS positions
            FROM divisions d
            LEFT JOIN employees e ON e.division_id = d.id AND e.is_archived = 0
            LEFT JOIN designations des ON des.division_id = d.id AND des.is_archived = 0
            GROUP BY d.id, d.name, d.code',
        'orderBy' => 'd.name ASC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
    ];

    $definitions['training-seminars-report'] = [
        'label' => 'Training & Seminars Report',
        'description' => 'Training and seminar records will appear here when the training database table is added.',
        'category' => 'training',
        'requiredTables' => ['training_seminars'],
        'dateExpression' => 'ts.start_date',
        'searchExpressions' => ['ts.employee_name', 'ts.title', 'ts.provider', 'ts.status'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['trainingTitle', 'Training/Seminar'],
            ['provider', 'Provider'],
            ['startDate', 'Start Date'],
            ['endDate', 'End Date'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT ts.id, ts.employee_name AS employeeName, ts.title AS trainingTitle, ts.provider, ts.start_date AS startDate, ts.end_date AS endDate, ts.status FROM training_seminars ts',
        'orderBy' => 'ts.start_date DESC',
    ];

    return $definitions;
}

function reports_category_labels(): array
{
    return [
        'employee' => 'Employee Reports',
        'payroll' => 'Payroll Reports',
        'leave' => 'Leave Reports',
        'attendance' => 'Attendance Reports',
        'travel' => 'Travel Order Reports',
        'cto' => 'Compensatory Time Off Reports',
        'performance' => 'Performance Reports',
        'training' => 'Training Reports',
        'audit' => 'Audit Reports',
    ];
}

function reports_table_exists(PDO $pdo, string $tableName): bool
{
    static $cache = [];

    if (array_key_exists($tableName, $cache)) {
        return $cache[$tableName];
    }

    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );
    $statement->execute([':table_name' => $tableName]);

    return $cache[$tableName] = (int)$statement->fetchColumn() > 0;
}

function reports_required_tables_exist(PDO $pdo, array $definition): bool
{
    foreach ($definition['requiredTables'] ?? [] as $tableName) {
        if (!reports_table_exists($pdo, (string)$tableName)) {
            return false;
        }
    }

    return true;
}

/**
 * Turns the incoming query string into the subset of dynamic filters the
 * selected report definition actually understands.
 */
function reports_active_filters(array $definition, array $query): array
{
    $supported = $definition['filters'] ?? [];
    $active = [];

    foreach ($supported as $name => $expression) {
        $value = reports_text($query[$name] ?? '');

        if ($value === '' || strtolower($value) === 'all') {
            continue;
        }

        $active[$name] = [
            'expression' => $expression,
            'value' => $value,
        ];
    }

    return $active;
}

function reports_add_filters(array $definition, array $dateWindow, string $search, array $activeFilters = []): array
{
    $sql = $definition['sql'];
    $params = [];
    $whereClauses = [];

    if (!empty($definition['dateExpression'])) {
        $whereClauses[] = 'DATE(' . $definition['dateExpression'] . ') BETWEEN :start_date AND :end_date';
        $params[':start_date'] = $dateWindow['start'];
        $params[':end_date'] = $dateWindow['end'];
    }

    $filterIndex = 0;
    foreach ($activeFilters as $filter) {
        $placeholder = ':filter_' . $filterIndex;
        $whereClauses[] = 'LOWER(CAST(' . $filter['expression'] . ' AS CHAR)) = ' . $placeholder;
        $params[$placeholder] = strtolower($filter['value']);
        $filterIndex += 1;
    }

    if ($search !== '') {
        $searchClauses = [];
        foreach ($definition['searchExpressions'] ?? [] as $index => $expression) {
            $placeholder = ':search_' . $index;
            $searchClauses[] = 'LOWER(CAST(' . $expression . ' AS CHAR)) LIKE ' . $placeholder;
            $params[$placeholder] = '%' . strtolower($search) . '%';
        }

        if ($searchClauses !== []) {
            $whereClauses[] = '(' . implode(' OR ', $searchClauses) . ')';
        }
    }

    if ($whereClauses !== []) {
        // NOTE: the marker must not be trimmed. Trimming it drops the space in
        // front of "GROUP BY", which glues the last placeholder to the keyword
        // (":filter_0GROUP BY ...") and produces a syntax error. The explicit
        // spaces below keep the injected clause separated either way.
        $filterBefore = (string)($definition['filterBefore'] ?? '');
        $markerAt = $filterBefore !== '' ? stripos($sql, $filterBefore) : false;

        if ($markerAt !== false) {
            $before = substr($sql, 0, $markerAt);
            $after = substr($sql, $markerAt);
            $before .= reports_sql_has_outer_where($before) ? ' AND ' : ' WHERE ';
            $sql = $before . implode(' AND ', $whereClauses) . ' ' . $after;
        } else {
            $sql .= reports_sql_has_outer_where($sql) ? ' AND ' : ' WHERE ';
            $sql .= implode(' AND ', $whereClauses);
        }
    }

    if (!empty($definition['orderBy'])) {
        $sql .= ' ORDER BY ' . $definition['orderBy'];
    }

    return [$sql, $params];
}

/**
 * Whether the statement's outermost SELECT already has a WHERE clause.
 *
 * A plain stripos() for " WHERE " is not enough: the leave reports carry correlated subqueries in
 * their select lists, each with a WHERE of its own, and that match used to make this file append
 * its filters with " AND " -- onto the end of the last LEFT JOIN's ON condition. The join went
 * quietly unmatched and the date window, status, and division filters never reached the rows.
 * Only a WHERE at parenthesis depth zero counts; string literals are skipped so a quoted "where"
 * cannot count either.
 */
function reports_sql_has_outer_where(string $sql): bool
{
    $depth = 0;
    $quote = '';
    $length = strlen($sql);

    for ($index = 0; $index < $length; $index++) {
        $character = $sql[$index];

        if ($quote !== '') {
            if ($character === $quote) {
                $quote = '';
            }

            continue;
        }

        if ($character === '"' || $character === "'") {
            $quote = $character;
            continue;
        }

        if ($character === '(') {
            $depth++;
            continue;
        }

        if ($character === ')') {
            $depth = max(0, $depth - 1);
            continue;
        }

        if (
            $depth === 0
            && ($character === 'w' || $character === 'W')
            && strcasecmp(substr($sql, $index, 5), 'where') === 0
            && ($index === 0 || ctype_space($sql[$index - 1]))
            && ($index + 5 >= $length || ctype_space($sql[$index + 5]))
        ) {
            return true;
        }
    }

    return false;
}

/** Aggregate itemised deduction JSON without requiring a child table. */
function reports_fetch_payroll_deduction_rows(
    PDO $pdo,
    array $dateWindow,
    string $search,
    array $activeFilters = []
): array {
    // The only filter this report takes; the rest of the machinery never sees its rows.
    $divisionId = (int)($activeFilters['divisionId']['value'] ?? 0);
    $params = [
        ':start_date' => $dateWindow['start'],
        ':end_date' => $dateWindow['end'],
    ];
    $divisionScope = '';

    if ($divisionId > 0) {
        $divisionScope = ' AND p.employee_id IN (SELECT e.id FROM employees e WHERE e.division_id = :division_id)';
        $params[':division_id'] = $divisionId;
    }

    $statement = $pdo->prepare(
        'SELECT p.payroll_id, p.deduction_items_json
         FROM payroll p
         WHERE DATE(p.payroll_date) BETWEEN :start_date AND :end_date
           AND p.deduction_items_json IS NOT NULL
           AND TRIM(p.deduction_items_json) <> ""' . $divisionScope
    );
    $statement->execute($params);

    $types = deduction_catalog_type_map($pdo);
    $groups = [];

    foreach ($statement as $payroll) {
        $payrollId = (int)($payroll['payroll_id'] ?? 0);
        $items = deduction_catalog_normalize_payroll_items(
            $pdo,
            payroll_decode_embedded_json_list($payroll['deduction_items_json'] ?? null),
            $payrollId,
            $types
        );

        foreach ($items as $item) {
            $name = reports_text($item['name'] ?? '');
            $category = reports_text($item['category'] ?? '');
            if ($name === '') {
                continue;
            }

            if ($search !== '' && !str_contains(strtolower($name . ' ' . $category), strtolower($search))) {
                continue;
            }

            $key = strtolower($name . "\0" . $category);
            $groups[$key] ??= [
                'deductionName' => $name,
                'category' => $category,
                'records' => 0,
                'totalAmount' => 0.0,
            ];
            $groups[$key]['records'] += 1;
            $groups[$key]['totalAmount'] = round(
                (float)$groups[$key]['totalAmount'] + (float)($item['amount'] ?? 0),
                2
            );
        }
    }

    $rows = array_values($groups);
    usort($rows, static fn (array $left, array $right): int =>
        ((float)$right['totalAmount'] <=> (float)$left['totalAmount'])
        ?: strcmp((string)$left['deductionName'], (string)$right['deductionName'])
    );

    return $rows;
}

function reports_fetch_rows(PDO $pdo, array $definition, array $dateWindow, string $search, array $activeFilters = []): array
{
    if (!reports_required_tables_exist($pdo, $definition)) {
        return [];
    }

    if (isset($definition['fetchRows']) && is_callable($definition['fetchRows'])) {
        return $definition['fetchRows']($pdo, $dateWindow, $search, $activeFilters);
    }

    [$sql, $params] = reports_add_filters($definition, $dateWindow, $search, $activeFilters);
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    $rows = array_map(static function (array $row): array {
        foreach ($row as $key => $value) {
            if ($value === null) {
                $row[$key] = 'N/A';
            }
        }

        return $row;
    }, $statement->fetchAll());

    if (!empty($definition['includeRowNumber'])) {
        foreach ($rows as $index => $row) {
            $rows[$index]['rowNumber'] = $index + 1;
        }
    }

    return $rows;
}

function reports_numeric_sum(array $rows, array $keys): ?float
{
    $total = 0.0;
    $found = false;

    foreach ($rows as $row) {
        foreach ($keys as $key) {
            if (isset($row[$key]) && is_numeric($row[$key])) {
                $total += (float)$row[$key];
                $found = true;
                break;
            }
        }
    }

    return $found ? round($total, 2) : null;
}

function reports_distinct_count(array $rows, array $keys): int
{
    $values = [];

    foreach ($rows as $row) {
        foreach ($keys as $key) {
            $value = reports_text($row[$key] ?? '');
            if ($value !== '' && $value !== 'N/A') {
                $values[strtolower($value)] = true;
                break;
            }
        }
    }

    return count($values);
}

function reports_distribution(array $rows): array
{
    $key = null;
    foreach (['status', 'approvalStatus', 'division', 'employmentStatus', 'leaveType'] as $candidate) {
        foreach ($rows as $row) {
            if (isset($row[$candidate]) && reports_text($row[$candidate]) !== '') {
                $key = $candidate;
                break 2;
            }
        }
    }

    if ($key === null) {
        return [];
    }

    $counts = [];
    foreach ($rows as $row) {
        $label = reports_text($row[$key] ?? 'Unspecified');
        $label = $label === '' ? 'Unspecified' : $label;
        $counts[$label] = ($counts[$label] ?? 0) + 1;
    }

    arsort($counts);
    $distribution = [];
    foreach (array_slice($counts, 0, 8, true) as $label => $value) {
        $distribution[] = [
            'label' => $label,
            'value' => $value,
        ];
    }

    return $distribution;
}

function reports_summary(array $definition, array $rows, array $dateWindow): array
{
    $totalRecords = count($rows);
    $keyStatistics = [];
    $label = (string)($definition['label'] ?? '');

    if ($label === 'Leave Applications') {
        $statusCounts = ['Approved' => 0, 'Pending' => 0, 'Rejected' => 0, 'Cancelled' => 0];
        foreach ($rows as $row) {
            $status = ucfirst(strtolower(reports_text($row['status'] ?? '')));
            if (array_key_exists($status, $statusCounts)) {
                $statusCounts[$status] += 1;
            }
        }
        $totalDays = reports_numeric_sum($rows, ['totalDays']) ?? 0.0;
        $keyStatistics = [
            ['label' => 'Total Applications', 'value' => number_format($totalRecords)],
            ['label' => 'Approved', 'value' => number_format($statusCounts['Approved'])],
            ['label' => 'Pending', 'value' => number_format($statusCounts['Pending'])],
            ['label' => 'Rejected', 'value' => number_format($statusCounts['Rejected'])],
            ['label' => 'Cancelled', 'value' => number_format($statusCounts['Cancelled'])],
            ['label' => 'Total Leave Days', 'value' => number_format($totalDays, 2)],
        ];
    } elseif ($label === 'Leave Monetization') {
        $statusCounts = ['Approved' => 0, 'Pending' => 0, 'Rejected' => 0];
        $approvedDays = 0.0;
        $approvedAmount = 0.0;
        foreach ($rows as $row) {
            $status = ucfirst(strtolower(reports_text($row['status'] ?? '')));
            if (array_key_exists($status, $statusCounts)) {
                $statusCounts[$status] += 1;
            }
            if ($status === 'Approved') {
                $approvedDays += (float)($row['daysApproved'] ?? 0);
                $approvedAmount += (float)($row['computedAmount'] ?? 0);
            }
        }
        $keyStatistics = [
            ['label' => 'Total Requests', 'value' => number_format($totalRecords)],
            ['label' => 'Approved Requests', 'value' => number_format($statusCounts['Approved'])],
            ['label' => 'Pending Requests', 'value' => number_format($statusCounts['Pending'])],
            ['label' => 'Rejected Requests', 'value' => number_format($statusCounts['Rejected'])],
            ['label' => 'Total Days Monetized', 'value' => number_format($approvedDays, 2)],
            ['label' => 'Total Monetized Amount', 'value' => 'PHP ' . number_format($approvedAmount, 2)],
        ];
    } elseif ($label === 'Leave Balance') {
        $keyStatistics = [
            ['label' => 'Total Employees', 'value' => number_format(reports_distinct_count($rows, ['employeeNo']))],
            ['label' => 'Total Available Credits', 'value' => number_format(reports_numeric_sum($rows, ['remainingBalance']) ?? 0, 2)],
        ];
    } elseif ($label === 'Leave Utilization') {
        $keyStatistics = [
            ['label' => 'Total Leave Days Used', 'value' => number_format(reports_numeric_sum($rows, ['totalDaysUsed']) ?? 0, 2)],
            ['label' => 'Employees Who Used Leave', 'value' => number_format(reports_distinct_count($rows, ['employeeNo']))],
            ['label' => 'With Pay Days', 'value' => number_format(reports_numeric_sum($rows, ['withPay']) ?? 0, 2)],
            ['label' => 'Without Pay Days', 'value' => number_format(reports_numeric_sum($rows, ['withoutPay']) ?? 0, 2)],
        ];
    }

    if ($keyStatistics !== []) {
        return [
            'totalRecords' => $totalRecords,
            'keyStatistics' => $keyStatistics,
            'description' => $definition['description'],
            'distribution' => reports_distribution($rows),
            'dateRange' => $dateWindow,
        ];
    }

    $uniqueEmployees = reports_distinct_count($rows, ['employeeId', 'employeeName']);
    if ($uniqueEmployees > 0) {
        $keyStatistics[] = ['label' => 'Unique Employees', 'value' => number_format($uniqueEmployees)];
    }

    $totalHours = reports_numeric_sum($rows, ['totalHours', 'hours']);
    if ($totalHours !== null) {
        $keyStatistics[] = ['label' => 'Total Hours', 'value' => number_format($totalHours, 2)];
    }

    $totalDays = reports_numeric_sum($rows, ['days', 'totalDays', 'numberOfDays']);
    if ($totalDays !== null) {
        $keyStatistics[] = ['label' => 'Total Days', 'value' => number_format($totalDays, 2)];
    }

    $grossPay = reports_numeric_sum($rows, ['grossPay']);
    if ($grossPay !== null) {
        $keyStatistics[] = ['label' => 'Gross Pay Total', 'value' => 'PHP ' . number_format($grossPay, 2)];
    }

    $netPay = reports_numeric_sum($rows, ['netPay', 'amount']);
    if ($netPay !== null) {
        $keyStatistics[] = ['label' => 'Net Pay Total', 'value' => 'PHP ' . number_format($netPay, 2)];
    }

    $distribution = [];
    if (($definition['label'] ?? '') === 'Department/Division Report') {
        foreach ($rows as $row) {
            $distribution[] = [
                'label' => $row['division'] ?? 'Unspecified',
                'value' => (int)($row['employees'] ?? 0),
            ];
        }
        usort($distribution, static fn (array $a, array $b): int => $b['value'] <=> $a['value']);
    } else {
        $distribution = reports_distribution($rows);
    }

    return [
        'totalRecords' => $totalRecords,
        'keyStatistics' => $keyStatistics,
        'description' => $definition['description'],
        'distribution' => $distribution,
        'dateRange' => $dateWindow,
    ];
}

// ===================================================================
// Audit trail
// ===================================================================

function reports_write_audit(PDO $pdo, array $user, string $action, string $summary, array $details = []): void
{
    try {
        if (!reports_table_exists($pdo, 'audit_logs')) {
            return;
        }

        $context = function_exists('audit_request_context')
            ? audit_request_context()
            : ['ipAddress' => null, 'location' => null, 'device' => null, 'browser' => null, 'os' => null, 'userAgent' => null];

        $userId = isset($user['id']) ? (int)$user['id'] : null;
        $detailsJson = function_exists('audit_details_json')
            ? audit_details_json($details, $context)
            : (string)json_encode($details);

        $statement = $pdo->prepare(
            'INSERT INTO audit_logs
                (user_id, action, ip_address, location, device, browser, os, actor_id, actor_name, actor_role, category, entity_type, entity_id, summary, details_json, user_agent)
             VALUES
                (:user_id, :action, :ip_address, :location, :device, :browser, :os, :actor_id, :actor_name, :actor_role, :category, :entity_type, :entity_id, :summary, :details_json, :user_agent)'
        );

        $statement->execute([
            ':user_id' => $userId,
            ':action' => $action,
            ':ip_address' => $context['ipAddress'] ?? null,
            ':location' => $context['location'] ?? null,
            ':device' => $context['device'] ?? null,
            ':browser' => $context['browser'] ?? null,
            ':os' => $context['os'] ?? null,
            ':actor_id' => $userId,
            ':actor_name' => $user['full_name'] ?? $user['username'] ?? null,
            ':actor_role' => $user['role'] ?? null,
            ':category' => 'reports',
            ':entity_type' => 'report',
            ':entity_id' => $details['reportType'] ?? null,
            ':summary' => $summary,
            ':details_json' => $detailsJson,
            ':user_agent' => $context['userAgent'] ?? null,
        ]);
        audit_mark_entry_written();
    } catch (Throwable $exception) {
        // Reporting must never fail because the optional audit write failed.
    }
}

/**
 * "Recent Generated Reports" is derived from the audit trail rather than a
 * separate table, so every generation/export is listed exactly once.
 */
function reports_recent_activity(PDO $pdo, int $limit = 50): array
{
    if (!reports_table_exists($pdo, 'audit_logs')) {
        return [];
    }

    $limit = max(1, min($limit, 200));
    $statement = $pdo->prepare(
        'SELECT
            al.id,
            al.action,
            al.summary,
            al.entity_id AS reportType,
            al.details_json AS detailsJson,
            COALESCE(al.actor_name, u.username, "System") AS generatedBy,
            COALESCE(al.actor_role, "N/A") AS generatedByRole,
            al.ip_address AS ipAddress,
            al.browser,
            al.device,
            DATE_FORMAT(al.created_at, "%Y-%m-%d %H:%i:%s") AS generatedAt
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.category = "reports"
         ORDER BY al.created_at DESC
         LIMIT ' . $limit
    );
    $statement->execute();

    $definitions = reports_definitions();
    $categories = reports_category_labels();

    return array_map(static function (array $row) use ($definitions, $categories): array {
        $details = json_decode((string)($row['detailsJson'] ?? ''), true);
        $details = is_array($details) ? $details : [];
        $reportKey = (string)($row['reportType'] ?? '');
        $definition = $definitions[$reportKey] ?? null;
        $categoryKey = $definition['category'] ?? 'employee';

        return [
            'id' => (int)$row['id'],
            'reportKey' => $reportKey,
            'reportName' => $definition['label'] ?? ($details['reportLabel'] ?? 'Report'),
            'category' => $categories[$categoryKey] ?? 'Report',
            'categoryKey' => $categoryKey,
            'action' => (string)$row['action'],
            'format' => strtoupper((string)($details['format'] ?? 'VIEW')),
            'records' => isset($details['records']) ? (int)$details['records'] : null,
            'division' => $details['division'] ?? 'All Divisions',
            'dateRange' => $details['dateRangeLabel'] ?? null,
            'generatedBy' => (string)$row['generatedBy'],
            'generatedByRole' => (string)$row['generatedByRole'],
            'generatedAt' => (string)$row['generatedAt'],
            'ipAddress' => $row['ipAddress'] ?? null,
            'browser' => $row['browser'] ?? null,
            'device' => $row['device'] ?? null,
            'status' => str_contains((string)$row['action'], 'failed') ? 'Failed' : 'Completed',
            'summary' => (string)($row['summary'] ?? ''),
        ];
    }, $statement->fetchAll());
}

function reports_delete_activity(PDO $pdo, array $ids): int
{
    $ids = array_values(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0));

    if ($ids === [] || !reports_table_exists($pdo, 'audit_logs')) {
        return 0;
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'DELETE FROM audit_logs WHERE category = "reports" AND id IN (' . $placeholders . ')'
    );
    $statement->execute($ids);

    return $statement->rowCount();
}

// ===================================================================
// Dashboard analytics
// ===================================================================

/**
 * Dashboard widgets degrade to an empty state rather than failing the whole
 * request, but the underlying error is always logged so a broken panel is
 * diagnosable instead of silently blank.
 */
function reports_scalar(PDO $pdo, string $sql, array $params = []): float
{
    try {
        $statement = $pdo->prepare($sql);
        $statement->execute($params);
        $value = $statement->fetchColumn();

        return $value === false || $value === null ? 0.0 : (float)$value;
    } catch (Throwable $exception) {
        error_log('Reports scalar query failed: ' . $exception->getMessage() . ' | SQL: ' . $sql);

        return 0.0;
    }
}

function reports_rows(PDO $pdo, string $sql, array $params = []): array
{
    try {
        $statement = $pdo->prepare($sql);
        $statement->execute($params);

        return $statement->fetchAll();
    } catch (Throwable $exception) {
        error_log('Reports rows query failed: ' . $exception->getMessage() . ' | SQL: ' . $sql);

        return [];
    }
}

function reports_division_scope(?int $divisionId, string $alias = 'e'): array
{
    if ($divisionId === null || $divisionId <= 0) {
        return ['', []];
    }

    return [' AND ' . $alias . '.division_id = :scope_division_id', [':scope_division_id' => $divisionId]];
}

function reports_kpi(string $key, string $label, string $group, string $icon, float $value, ?float $previous = null, string $format = 'number', string $hint = ''): array
{
    return [
        'key' => $key,
        'label' => $label,
        'group' => $group,
        'icon' => $icon,
        'value' => round($value, 2),
        'previous' => $previous === null ? null : round($previous, 2),
        'format' => $format,
        'hint' => $hint,
    ];
}

function reports_employee_kpis(PDO $pdo, ?int $divisionId, string $previousMonthEnd): array
{
    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $base = 'FROM employees e WHERE e.is_archived = 0' . $scope;
    $asOf = ' AND (e.date_hired IS NULL OR e.date_hired <= :as_of)';
    $asOfParams = array_merge($scopeParams, [':as_of' => $previousMonthEnd]);

    $count = static fn (string $extra, array $params = []): float => reports_scalar(
        $pdo,
        'SELECT COUNT(e.id) ' . $extra,
        $params
    );

    $metric = static function (string $condition, string $icon, string $label, string $key) use ($count, $base, $asOf, $scopeParams, $asOfParams): array {
        $where = $condition === '' ? '' : ' AND ' . $condition;

        return reports_kpi(
            $key,
            $label,
            'employee',
            $icon,
            $count($base . $where, $scopeParams),
            $count($base . $where . $asOf, $asOfParams),
            'number'
        );
    };

    $kpis = [
        $metric('', 'users', 'Total Employees', 'totalEmployees'),
        $metric('LOWER(e.status) = "active"', 'user-check', 'Active Employees', 'activeEmployees'),
        $metric('LOWER(e.status) <> "active"', 'user-x', 'Inactive Employees', 'inactiveEmployees'),
        $metric('LOWER(e.gender) = "male"', 'user', 'Male Employees', 'maleEmployees'),
        $metric('LOWER(e.gender) = "female"', 'user', 'Female Employees', 'femaleEmployees'),
        $metric('e.pwd = 1', 'accessibility', 'PWD Employees', 'pwdEmployees'),
        $metric('e.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) >= 60', 'heart', 'Senior Citizen Employees', 'seniorEmployees'),
        $metric('LOWER(COALESCE(e.employment_status, "")) IN ("permanent", "regular")', 'badge-check', 'Permanent Employees', 'permanentEmployees'),
        $metric('LOWER(COALESCE(e.employment_status, "")) IN ("contractual", "contract of service", "cos")', 'file-signature', 'Contract of Service', 'cosEmployees'),
        $metric('LOWER(COALESCE(e.employment_status, "")) = "casual"', 'briefcase', 'Casual Employees', 'casualEmployees'),
        $metric('LOWER(COALESCE(e.status, "")) IN ("resigned", "separated", "terminated")', 'log-out', 'Resigned Employees', 'resignedEmployees'),
        $metric('LOWER(COALESCE(e.status, "")) = "retired"', 'sunset', 'Retired Employees', 'retiredEmployees'),
    ];

    $newHiresThisMonth = reports_scalar(
        $pdo,
        'SELECT COUNT(e.id) ' . $base . ' AND e.date_hired >= DATE_FORMAT(CURDATE(), "%Y-%m-01")',
        $scopeParams
    );
    $newHiresLastMonth = reports_scalar(
        $pdo,
        'SELECT COUNT(e.id) ' . $base . '
            AND e.date_hired >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, "%Y-%m-01")
            AND e.date_hired < DATE_FORMAT(CURDATE(), "%Y-%m-01")',
        $scopeParams
    );
    $kpis[] = reports_kpi('newlyHired', 'Newly Hired (This Month)', 'employee', 'user-plus', $newHiresThisMonth, $newHiresLastMonth);

    $averageAge = reports_scalar(
        $pdo,
        'SELECT ROUND(AVG(TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE())), 1) ' . $base . ' AND e.date_of_birth IS NOT NULL',
        $scopeParams
    );
    $kpis[] = reports_kpi('averageAge', 'Average Employee Age', 'employee', 'cake', $averageAge, null, 'decimal', 'years');

    $averageTenure = reports_scalar(
        $pdo,
        'SELECT ROUND(AVG(TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE())), 1) ' . $base . ' AND e.date_hired IS NOT NULL',
        $scopeParams
    );
    $kpis[] = reports_kpi('averageTenure', 'Average Years of Service', 'employee', 'award', $averageTenure, null, 'decimal', 'years');

    return $kpis;
}

function reports_payroll_kpis(PDO $pdo, ?int $divisionId): array
{
    if (!reports_table_exists($pdo, 'payroll')) {
        return [];
    }

    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $join = 'FROM payroll p LEFT JOIN employees e ON e.id = p.employee_id WHERE 1 = 1' . $scope;
    $released = ' AND ' . reports_payroll_released_condition();
    // Counted by the day the Cashier released the batch, the way the Released Payroll table lists it.
    $releasedOn = reports_payroll_release_date_sql();

    $thisMonth = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . '
            AND ' . $releasedOn . ' >= DATE_FORMAT(CURDATE(), "%Y-%m-01")',
        $scopeParams
    );
    $lastMonth = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . '
            AND ' . $releasedOn . ' >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, "%Y-%m-01")
            AND ' . $releasedOn . ' < DATE_FORMAT(CURDATE(), "%Y-%m-01")',
        $scopeParams
    );
    $thisYear = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . ' AND YEAR(' . $releasedOn . ') = YEAR(CURDATE())',
        $scopeParams
    );
    $lastYear = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . ' AND YEAR(' . $releasedOn . ') = YEAR(CURDATE()) - 1',
        $scopeParams
    );
    $pending = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . ' AND ' . reports_payroll_pending_condition(),
        $scopeParams
    );
    $pendingCount = reports_scalar(
        $pdo,
        'SELECT COUNT(p.payroll_id) ' . $join . ' AND ' . reports_payroll_pending_condition(),
        $scopeParams
    );

    return [
        reports_kpi('payrollThisMonth', 'Payroll Released (This Month)', 'payroll', 'wallet', $thisMonth, $lastMonth, 'currency'),
        reports_kpi('payrollThisYear', 'Payroll Released (This Year)', 'payroll', 'banknote', $thisYear, $lastYear, 'currency'),
        reports_kpi('payrollPending', 'Pending Payroll', 'payroll', 'hourglass', $pending, null, 'currency', $pendingCount > 0 ? (int)$pendingCount . ' run(s)' : ''),
    ];
}

function reports_leave_kpis(PDO $pdo, ?int $divisionId): array
{
    if (!reports_table_exists($pdo, 'leave_requests')) {
        return [];
    }

    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $join = 'FROM leave_requests lr INNER JOIN employees e ON e.id = lr.employee_id WHERE 1 = 1' . $scope;

    $inMonth = ' AND lr.start_date >= DATE_FORMAT(CURDATE(), "%Y-%m-01")';
    $inPrevMonth = ' AND lr.start_date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, "%Y-%m-01")
        AND lr.start_date < DATE_FORMAT(CURDATE(), "%Y-%m-01")';

    $statusKpi = static function (string $key, string $label, string $icon, string $condition) use ($pdo, $join, $inMonth, $inPrevMonth, $scopeParams): array {
        return reports_kpi(
            $key,
            $label,
            'leave',
            $icon,
            reports_scalar($pdo, 'SELECT COUNT(lr.leave_request_id) ' . $join . ' AND ' . $condition . $inMonth, $scopeParams),
            reports_scalar($pdo, 'SELECT COUNT(lr.leave_request_id) ' . $join . ' AND ' . $condition . $inPrevMonth, $scopeParams)
        );
    };

    $kpis = [
        $statusKpi('approvedLeaves', 'Approved Leaves', 'calendar-check', 'LOWER(lr.status) = "approved"'),
        $statusKpi('pendingLeaves', 'Pending Leaves', 'calendar-clock', 'LOWER(lr.status) IN ("pending", "endorsed", "reviewed")'),
        $statusKpi('rejectedLeaves', 'Rejected Leaves', 'calendar-x', 'LOWER(lr.status) = "rejected"'),
    ];

    if (reports_table_exists($pdo, 'leave_monetization_requests')) {
        $monetizedJoin = 'FROM leave_monetization_requests lm INNER JOIN employees e ON e.id = lm.employee_id WHERE 1 = 1' . $scope;
        $kpis[] = reports_kpi(
            'monetizedLeaves',
            'Monetized Leaves',
            'leave',
            'coins',
            reports_scalar($pdo, 'SELECT COUNT(lm.id) ' . $monetizedJoin . ' AND LOWER(lm.status) = "approved" AND lm.date_filed >= DATE_FORMAT(CURDATE(), "%Y-%m-01")', $scopeParams),
            reports_scalar($pdo, 'SELECT COUNT(lm.id) ' . $monetizedJoin . ' AND LOWER(lm.status) = "approved" AND lm.date_filed >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, "%Y-%m-01") AND lm.date_filed < DATE_FORMAT(CURDATE(), "%Y-%m-01")', $scopeParams)
        );
    }

    return $kpis;
}

function reports_month_series(int $months = 12): array
{
    $series = [];
    $cursor = (new DateTimeImmutable('first day of this month'))->modify('-' . ($months - 1) . ' months');

    for ($index = 0; $index < $months; $index += 1) {
        $series[$cursor->format('Y-m')] = [
            'month' => $cursor->format('Y-m'),
            'label' => $cursor->format('M Y'),
            'shortLabel' => $cursor->format('M'),
        ];
        $cursor = $cursor->modify('+1 month');
    }

    return $series;
}

/** Longest window still bucketed a day at a time; past this the buckets become months. */
const REPORTS_TREND_DAILY_MAX_DAYS = 92;

/** And past this, years. Three years of monthly points is about as much as one axis carries. */
const REPORTS_TREND_MONTHLY_MAX_DAYS = 1100;

/**
 * The buckets the workforce trend is drawn on, spanning the window the user actually picked.
 *
 * A fixed twelve months was the wrong shape twice over: it ignored the date range control sitting
 * directly above the chart, and on a roster whose hiring predates the window it drew the same
 * number twelve times, which reads as a hardcoded line rather than a flat one.
 *
 * Granularity follows the span because any single choice is wrong at one end. Monthly buckets over
 * "Last 7 Days" collapse the range to a single point; daily buckets over "All Time" — which opens in
 * 1970 — would ask for twenty thousand of them.
 *
 * Each bucket carries the date it closes on. That, not the bucket's start, is what a headcount is
 * counted at: "how many did we have in March" means at the end of March. The last bucket closes on
 * the window's own end rather than the period's, so the final point is the roster as it stands
 * rather than a projection to the end of a month that has not happened yet.
 */
function reports_trend_buckets(string $startDate, string $endDate): array
{
    $start = new DateTimeImmutable($startDate);
    $end = new DateTimeImmutable($endDate);

    if ($end < $start) {
        $end = $start;
    }

    $span = (int)$start->diff($end)->days;
    $buckets = [];

    if ($span <= REPORTS_TREND_DAILY_MAX_DAYS) {
        for ($cursor = $start; $cursor <= $end; $cursor = $cursor->modify('+1 day')) {
            $buckets[$cursor->format('Y-m-d')] = [
                'period' => $cursor->format('Y-m-d'),
                'label' => $cursor->format('M j, Y'),
                'shortLabel' => $cursor->format('M j'),
                'end' => $cursor->format('Y-m-d'),
            ];
        }

        return ['granularity' => 'day', 'format' => '%Y-%m-%d', 'buckets' => $buckets];
    }

    if ($span <= REPORTS_TREND_MONTHLY_MAX_DAYS) {
        $cursor = $start->modify('first day of this month');

        while ($cursor <= $end) {
            $periodEnd = $cursor->modify('last day of this month');
            $buckets[$cursor->format('Y-m')] = [
                'period' => $cursor->format('Y-m'),
                'label' => $cursor->format('M Y'),
                'shortLabel' => $cursor->format('M Y'),
                'end' => ($periodEnd > $end ? $end : $periodEnd)->format('Y-m-d'),
            ];
            $cursor = $cursor->modify('+1 month');
        }

        return ['granularity' => 'month', 'format' => '%Y-%m', 'buckets' => $buckets];
    }

    $cursor = $start->setDate((int)$start->format('Y'), 1, 1);

    while ($cursor <= $end) {
        $periodEnd = $cursor->setDate((int)$cursor->format('Y'), 12, 31);
        $buckets[$cursor->format('Y')] = [
            'period' => $cursor->format('Y'),
            'label' => $cursor->format('Y'),
            'shortLabel' => $cursor->format('Y'),
            'end' => ($periodEnd > $end ? $end : $periodEnd)->format('Y-m-d'),
        ];
        $cursor = $cursor->modify('+1 year');
    }

    return ['granularity' => 'year', 'format' => '%Y', 'buckets' => $buckets];
}

/**
 * Hires, separations, and the resulting headcount across the selected window.
 *
 * Headcount used to be a `COUNT(*)` of everyone hired on or before each month end, which could only
 * ever climb — nobody ever left it. It is now carried forward from a baseline: the roster as it
 * stood the day before the window opened, plus each bucket's hires, less each bucket's separations.
 * That makes it a genuine trend, and it costs three queries instead of one per bucket, which is what
 * makes daily buckets affordable at all.
 *
 * Separations still have no date column of their own, so the record's last update stands in for when
 * the status changed — the same proxy the separations series has always used.
 */
function reports_employee_growth(PDO $pdo, ?int $divisionId, array $dateWindow): array
{
    [$scope, $scopeParams] = reports_division_scope($divisionId);

    $today = (new DateTimeImmutable('today'))->format('Y-m-d');
    $windowStart = (string)$dateWindow['start'];
    $windowEnd = (string)$dateWindow['end'];

    /*
     * "All Time" opens on 1970-01-01 and runs five years past today, and the calendar ranges end on
     * the last day of a month or year that has not arrived. Charted literally that is decades of
     * empty buckets on one side and a flat forecast on the other, so the trend is clamped to the
     * ground the data actually covers: no earlier than the first hire on record, and no later than
     * today, because a headcount counts who is here and does not predict who will be.
     */
    $earliestHire = reports_rows(
        $pdo,
        'SELECT MIN(e.date_hired) AS earliest FROM employees e WHERE e.is_archived = 0' . $scope,
        $scopeParams
    );
    $earliest = (string)($earliestHire[0]['earliest'] ?? '');

    if ($earliest !== '' && $windowStart < $earliest) {
        $windowStart = $earliest;
    }

    if ($windowEnd > $today) {
        $windowEnd = max($windowStart, $today);
    }

    [
        'format' => $bucketExpression,
        'granularity' => $granularity,
        'buckets' => $buckets,
    ] = reports_trend_buckets($windowStart, $windowEnd);

    if ($buckets === []) {
        return [];
    }

    $beforeWindow = (new DateTimeImmutable($windowStart))->modify('-1 day')->format('Y-m-d');

    foreach ($buckets as $key => $entry) {
        // Carried on every row so the card can title its period column without having to guess the
        // granularity back out of the label text.
        $buckets[$key]['granularity'] = $granularity;
        $buckets[$key]['hires'] = 0;
        $buckets[$key]['separations'] = 0;
        $buckets[$key]['headcount'] = 0;
    }

    $separatedStatuses = 'LOWER(COALESCE(e.status, "")) IN ("resigned", "separated", "terminated", "retired")';

    /*
     * The roster the window opens with. An employee with no recorded hire date is counted here
     * rather than dropped: the record exists, only the date it started is missing, and leaving them
     * out would make the baseline smaller than the roster the KPI tiles report beside this chart.
     */
    $baseline = (int)reports_scalar(
        $pdo,
        'SELECT COUNT(e.id) FROM employees e
         WHERE e.is_archived = 0
           AND (e.date_hired IS NULL OR e.date_hired <= :before_window)' . $scope,
        array_merge($scopeParams, [':before_window' => $beforeWindow])
    ) - (int)reports_scalar(
        $pdo,
        'SELECT COUNT(e.id) FROM employees e
         WHERE e.is_archived = 0
           AND ' . $separatedStatuses . '
           AND DATE(e.updated_at) <= :before_window' . $scope,
        array_merge($scopeParams, [':before_window' => $beforeWindow])
    );

    $hires = reports_rows(
        $pdo,
        'SELECT DATE_FORMAT(e.date_hired, "' . $bucketExpression . '") AS bucket, COUNT(e.id) AS total
         FROM employees e
         WHERE e.is_archived = 0
           AND e.date_hired BETWEEN :window_start AND :window_end' . $scope . '
         GROUP BY bucket',
        array_merge($scopeParams, [':window_start' => $windowStart, ':window_end' => $windowEnd])
    );

    foreach ($hires as $row) {
        $bucket = (string)$row['bucket'];
        if (isset($buckets[$bucket])) {
            $buckets[$bucket]['hires'] = (int)$row['total'];
        }
    }

    $separations = reports_rows(
        $pdo,
        'SELECT DATE_FORMAT(e.updated_at, "' . $bucketExpression . '") AS bucket, COUNT(e.id) AS total
         FROM employees e
         WHERE e.is_archived = 0
           AND ' . $separatedStatuses . '
           AND DATE(e.updated_at) BETWEEN :window_start AND :window_end' . $scope . '
         GROUP BY bucket',
        array_merge($scopeParams, [':window_start' => $windowStart, ':window_end' => $windowEnd])
    );

    foreach ($separations as $row) {
        $bucket = (string)$row['bucket'];
        if (isset($buckets[$bucket])) {
            $buckets[$bucket]['separations'] = (int)$row['total'];
        }
    }

    $running = $baseline;

    foreach ($buckets as $key => $entry) {
        $running += $entry['hires'] - $entry['separations'];
        // A roster cannot go negative. It only could here if a separation's updated_at fell in the
        // window while the hire that matched it fell outside, which the baseline cannot see.
        $buckets[$key]['headcount'] = max(0, $running);
    }

    return array_values($buckets);
}

/**
 * Twelve calendar-month hire counts for the year containing the report window's closing date.
 * Unlike employeeGrowth, this series deliberately covers the full year even when the report uses
 * Last 7/30/90 Days: every point answers the same question from employees.date_hired, and missing
 * months are genuine zeroes rather than months the query never inspected.
 */
function reports_monthly_headcount_growth(PDO $pdo, ?int $divisionId, array $dateWindow): array
{
    [$scope, $scopeParams] = reports_division_scope($divisionId);

    $today = new DateTimeImmutable('today');
    $windowEnd = new DateTimeImmutable((string)$dateWindow['end']);
    if ($windowEnd > $today) {
        $windowEnd = $today;
    }

    $year = (int)$windowEnd->format('Y');
    $yearStart = sprintf('%04d-01-01', $year);
    $nextYearStart = sprintf('%04d-01-01', $year + 1);
    $series = [];

    for ($month = 1; $month <= 12; $month++) {
        $period = sprintf('%04d-%02d', $year, $month);
        $series[$period] = [
            'period' => $period,
            'label' => (new DateTimeImmutable($period . '-01'))->format('M Y'),
            'shortLabel' => (new DateTimeImmutable($period . '-01'))->format('M'),
            'granularity' => 'month',
            'hires' => 0,
        ];
    }

    $rows = reports_rows(
        $pdo,
        'SELECT DATE_FORMAT(e.date_hired, "%Y-%m") AS period, COUNT(e.id) AS hires
         FROM employees e
         WHERE e.is_archived = 0
           AND e.date_hired >= :year_start
           AND e.date_hired < :next_year_start' . $scope . '
         GROUP BY period
         ORDER BY period',
        array_merge($scopeParams, [
            ':year_start' => $yearStart,
            ':next_year_start' => $nextYearStart,
        ])
    );

    foreach ($rows as $row) {
        $period = (string)($row['period'] ?? '');
        if (isset($series[$period])) {
            $series[$period]['hires'] = (int)($row['hires'] ?? 0);
        }
    }

    return array_values($series);
}

/**
 * Every deduction line a payslip prints, with the total payroll has withheld against it.
 *
 * This used to chart the ten largest catalog deductions, which left the rest of the payslip
 * unaccounted for — a deduction an employee could read on their own payslip was missing from the
 * report. It now runs the itemised totals through payslip_deduction_lines(), so the chart carries
 * the payslip's full schedule: aliases folded into the line that prints them ("HDMF" into "PAG-IBIG
 * Premium"), lines nothing was charged to still listed at 0.00, and anything charged outside the
 * roster appended after.
 *
 * Ordered by amount so the bars rank, with the roster's own order breaking ties — that puts what was
 * actually withheld on top and leaves the untouched lines in payslip sequence below.
 *
 * An empty return means no deduction has ever been charged; the card then shows its empty state
 * rather than a column of zeroes.
 */
function reports_deduction_distribution(PDO $pdo): array
{
    $types = deduction_catalog_type_map($pdo);
    $totals = [];
    $statement = $pdo->query(
        'SELECT payroll_id, deduction_items_json
         FROM payroll
         WHERE deduction_items_json IS NOT NULL AND TRIM(deduction_items_json) <> ""'
    );

    foreach ($statement as $payroll) {
        $items = deduction_catalog_normalize_payroll_items(
            $pdo,
            payroll_decode_embedded_json_list($payroll['deduction_items_json'] ?? null),
            (int)($payroll['payroll_id'] ?? 0),
            $types
        );

        foreach ($items as $item) {
            $name = reports_text($item['name'] ?? '');
            if ($name !== '') {
                $totals[$name] = round(($totals[$name] ?? 0.0) + (float)($item['amount'] ?? 0), 2);
            }
        }
    }

    $rows = [];
    foreach ($totals as $name => $amount) {
        $rows[] = ['name' => $name, 'amount' => $amount];
    }

    if ($rows === []) {
        return [];
    }

    $lines = payslip_deduction_lines($rows);

    // usort is stable in PHP 8, so equal amounts keep the payslip order they came in with.
    usort($lines, static fn (array $left, array $right): int => $right['value'] <=> $left['value']);

    return array_map(
        static fn (array $line): array => ['label' => $line['label'], 'value' => (float)$line['value']],
        $lines
    );
}

function reports_dashboard_charts(PDO $pdo, ?int $divisionId, array $dateWindow): array
{
    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $charts = [];

    $charts['employeeGrowth'] = reports_employee_growth($pdo, $divisionId, $dateWindow);
    $charts['monthlyHeadcountGrowth'] = reports_monthly_headcount_growth($pdo, $divisionId, $dateWindow);

    // Active against everything else, which is what the active and inactive employee reports ask.
    // Each slice keeps the individual record statuses that rolled into it so the card's table view
    // can name them — "Inactive" on its own never says whether they resigned or retired.
    $statusRows = reports_rows(
        $pdo,
        'SELECT COALESCE(NULLIF(TRIM(e.status), ""), "Unspecified") AS label, COUNT(e.id) AS value
         FROM employees e WHERE e.is_archived = 0' . $scope . '
         GROUP BY label ORDER BY value DESC',
        $scopeParams
    );

    $recordStatus = [
        ['label' => 'Active', 'value' => 0, 'detail' => []],
        ['label' => 'Inactive', 'value' => 0, 'detail' => []],
    ];

    foreach ($statusRows as $row) {
        $label = (string)$row['label'];
        $value = (int)$row['value'];
        $bucket = strtolower($label) === 'active' ? 0 : 1;

        $recordStatus[$bucket]['value'] += $value;
        $recordStatus[$bucket]['detail'][] = ['label' => $label, 'value' => $value];
    }

    $charts['recordStatus'] = $recordStatus;

    $charts['genderDistribution'] = array_map(
        static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value']],
        reports_rows(
            $pdo,
            'SELECT COALESCE(NULLIF(TRIM(e.gender), ""), "Unspecified") AS label, COUNT(e.id) AS value
             FROM employees e WHERE e.is_archived = 0' . $scope . '
             GROUP BY label ORDER BY value DESC',
            $scopeParams
        )
    );

    $charts['inclusionDistribution'] = [
        [
            'label' => 'PWD',
            'value' => (int)reports_scalar($pdo, 'SELECT COUNT(e.id) FROM employees e WHERE e.is_archived = 0 AND e.pwd = 1' . $scope, $scopeParams),
        ],
        [
            'label' => 'Senior Citizen',
            'value' => (int)reports_scalar($pdo, 'SELECT COUNT(e.id) FROM employees e WHERE e.is_archived = 0 AND e.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) >= 60' . $scope, $scopeParams),
        ],
        [
            'label' => 'General Workforce',
            'value' => (int)reports_scalar($pdo, 'SELECT COUNT(e.id) FROM employees e WHERE e.is_archived = 0 AND e.pwd = 0 AND (e.date_of_birth IS NULL OR TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 60)' . $scope, $scopeParams),
        ],
    ];

    $charts['employmentStatus'] = array_map(
        static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value']],
        reports_rows(
            $pdo,
            'SELECT ' . reports_employment_status_label_sql('e.employment_status') . ' AS label, COUNT(e.id) AS value
             FROM employees e WHERE e.is_archived = 0' . $scope
                . reports_excluded_employment_status_sql('e.employment_status') . '
             GROUP BY label ORDER BY value DESC',
            $scopeParams
        )
    );

    $charts['divisionDistribution'] = array_map(
        static fn (array $row): array => [
            'label' => (string)$row['label'],
            'active' => (int)$row['active'],
            'inactive' => (int)$row['inactive'],
            'value' => (int)$row['active'] + (int)$row['inactive'],
        ],
        reports_rows(
            $pdo,
            'SELECT d.name AS label,
                    SUM(CASE WHEN LOWER(e.status) = "active" THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN e.id IS NOT NULL AND LOWER(e.status) <> "active" THEN 1 ELSE 0 END) AS inactive,
                    COUNT(e.id) AS total
             FROM divisions d
             LEFT JOIN employees e ON e.division_id = d.id AND e.is_archived = 0
             WHERE d.is_archived = 0' . ($divisionId !== null && $divisionId > 0 ? ' AND d.id = :scope_division_id' : '') . '
             GROUP BY d.id, d.name
             ORDER BY total DESC
             LIMIT 15',
            $divisionId !== null && $divisionId > 0 ? [':scope_division_id' => $divisionId] : []
        )
    );

    $charts['designationDistribution'] = array_map(
        static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value']],
        reports_rows(
            $pdo,
            'SELECT des.name AS label, COUNT(e.id) AS value
             FROM designations des
             INNER JOIN employees e ON e.designation_id = des.id AND e.is_archived = 0
             WHERE des.is_archived = 0' . $scope . '
             GROUP BY des.id, des.name
             HAVING value > 0
             ORDER BY value DESC
             LIMIT 18',
            $scopeParams
        )
    );

    $charts['ageDistribution'] = array_map(
        static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value']],
        reports_rows(
            $pdo,
            'SELECT CASE
                        WHEN e.date_of_birth IS NULL THEN "Unspecified"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 26 THEN "20-25"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 31 THEN "26-30"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 36 THEN "31-35"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, CURDATE()) < 41 THEN "36-40"
                        ELSE "41+"
                    END AS label,
                    COUNT(e.id) AS value
             FROM employees e WHERE e.is_archived = 0' . $scope . '
             GROUP BY label ORDER BY label ASC',
            $scopeParams
        )
    );

    $charts['yearsOfService'] = array_map(
        static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value']],
        reports_rows(
            $pdo,
            'SELECT CASE
                        WHEN e.date_hired IS NULL THEN "Unspecified"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 1 THEN "<1 yr"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 3 THEN "1-2 yrs"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 6 THEN "3-5 yrs"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 11 THEN "6-10 yrs"
                        WHEN TIMESTAMPDIFF(YEAR, e.date_hired, CURDATE()) < 21 THEN "11-20 yrs"
                        ELSE "21+ yrs"
                    END AS label,
                    COUNT(e.id) AS value
             FROM employees e WHERE e.is_archived = 0' . $scope . '
             GROUP BY label',
            $scopeParams
        )
    );

    $charts['salaryDistribution'] = array_map(
        static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value']],
        reports_rows(
            $pdo,
            'SELECT CASE
                        WHEN e.basic_salary IS NULL THEN "Unspecified"
                        WHEN e.basic_salary < 20000 THEN "<20K"
                        WHEN e.basic_salary < 30000 THEN "20-30K"
                        WHEN e.basic_salary < 40000 THEN "30-40K"
                        WHEN e.basic_salary < 60000 THEN "40-60K"
                        WHEN e.basic_salary < 80000 THEN "60-80K"
                        ELSE "80K+"
                    END AS label,
                    COUNT(e.id) AS value
             FROM employees e WHERE e.is_archived = 0' . $scope . '
             GROUP BY label',
            $scopeParams
        )
    );

    // --- Payroll ---
    if (reports_table_exists($pdo, 'payroll')) {
        $payrollSeries = reports_month_series(12);
        foreach ($payrollSeries as $key => $entry) {
            $payrollSeries[$key]['gross'] = 0.0;
            $payrollSeries[$key]['deductions'] = 0.0;
            $payrollSeries[$key]['net'] = 0.0;
        }

        $payrollRows = reports_rows(
            $pdo,
            'SELECT DATE_FORMAT(p.payroll_date, "%Y-%m") AS month,
                    ROUND(SUM(p.gross_pay), 2) AS gross,
                    ROUND(SUM(p.total_deduction), 2) AS deductions,
                    ROUND(SUM(p.net_pay), 2) AS net
             FROM payroll p
             LEFT JOIN employees e ON e.id = p.employee_id
             WHERE p.payroll_date >= :window_start' . $scope . '
             GROUP BY DATE_FORMAT(p.payroll_date, "%Y-%m")',
            array_merge($scopeParams, [':window_start' => array_key_first($payrollSeries) . '-01'])
        );

        foreach ($payrollRows as $row) {
            $month = (string)$row['month'];
            if (isset($payrollSeries[$month])) {
                $payrollSeries[$month]['gross'] = (float)$row['gross'];
                $payrollSeries[$month]['deductions'] = (float)$row['deductions'];
                $payrollSeries[$month]['net'] = (float)$row['net'];
            }
        }

        $charts['payrollTrend'] = array_values($payrollSeries);

        $charts['payrollByDivision'] = array_map(
            static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (float)$row['value']],
            reports_rows(
                $pdo,
                'SELECT COALESCE(d.name, "Unassigned") AS label, ROUND(SUM(p.net_pay), 2) AS value
                 FROM payroll p
                 LEFT JOIN employees e ON e.id = p.employee_id
                 LEFT JOIN divisions d ON d.id = e.division_id
                 WHERE DATE(p.payroll_date) BETWEEN :start_date AND :end_date' . $scope . '
                 GROUP BY label
                 ORDER BY value DESC
                 LIMIT 12',
                array_merge($scopeParams, [':start_date' => $dateWindow['start'], ':end_date' => $dateWindow['end']])
            )
        );

        $charts['payrollStatus'] = array_map(
            static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value'], 'amount' => (float)$row['amount']],
            reports_rows(
                $pdo,
                'SELECT COALESCE(NULLIF(TRIM(p.status), ""), "Unspecified") AS label,
                        COUNT(p.payroll_id) AS value,
                        ROUND(SUM(p.net_pay), 2) AS amount
                 FROM payroll p
                 LEFT JOIN employees e ON e.id = p.employee_id
                 WHERE DATE(p.payroll_date) BETWEEN :start_date AND :end_date' . $scope . '
                 GROUP BY label
                 ORDER BY value DESC',
                array_merge($scopeParams, [':start_date' => $dateWindow['start'], ':end_date' => $dateWindow['end']])
            )
        );
    } else {
        $charts['payrollTrend'] = [];
        $charts['payrollByDivision'] = [];
        $charts['payrollStatus'] = [];
    }

    if (reports_table_exists($pdo, 'payroll') && reports_table_exists($pdo, 'other_deductions')) {
        $charts['deductionDistribution'] = reports_deduction_distribution($pdo);
    } else {
        $charts['deductionDistribution'] = [];
    }

    // --- Leave ---
    if (reports_table_exists($pdo, 'leave_requests')) {
        $leaveJoin = 'FROM leave_requests lr INNER JOIN employees e ON e.id = lr.employee_id';
        $leaveWindow = ' WHERE DATE(lr.start_date) BETWEEN :start_date AND :end_date' . $scope;
        $leaveParams = array_merge($scopeParams, [':start_date' => $dateWindow['start'], ':end_date' => $dateWindow['end']]);

        $charts['leaveStatus'] = array_map(
            static fn (array $row): array => ['label' => ucfirst((string)$row['label']), 'value' => (int)$row['value'], 'days' => (float)$row['days']],
            reports_rows(
                $pdo,
                'SELECT COALESCE(NULLIF(TRIM(lr.status), ""), "unspecified") AS label,
                        COUNT(lr.leave_request_id) AS value,
                        ROUND(SUM(lr.total_days), 2) AS days
                 ' . $leaveJoin . $leaveWindow . '
                 GROUP BY label ORDER BY value DESC',
                $leaveParams
            )
        );

        $charts['leaveTypeDistribution'] = array_map(
            static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value'], 'days' => (float)$row['days']],
            reports_rows(
                $pdo,
                'SELECT lt.name AS label, COUNT(lr.leave_request_id) AS value, ROUND(SUM(lr.total_days), 2) AS days
                 ' . $leaveJoin . '
                 INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id' . $leaveWindow . '
                 GROUP BY lt.leave_type_id, lt.name
                 ORDER BY value DESC
                 LIMIT 10',
                $leaveParams
            )
        );

        $leaveSeries = reports_month_series(12);
        foreach ($leaveSeries as $key => $entry) {
            $leaveSeries[$key]['filed'] = 0;
            $leaveSeries[$key]['approved'] = 0;
            $leaveSeries[$key]['rejected'] = 0;
        }

        $leaveTrend = reports_rows(
            $pdo,
            'SELECT DATE_FORMAT(lr.start_date, "%Y-%m") AS month,
                    COUNT(lr.leave_request_id) AS filed,
                    SUM(CASE WHEN LOWER(lr.status) = "approved" THEN 1 ELSE 0 END) AS approved,
                    SUM(CASE WHEN LOWER(lr.status) = "rejected" THEN 1 ELSE 0 END) AS rejected
             ' . $leaveJoin . '
             WHERE lr.start_date >= :window_start' . $scope . '
             GROUP BY DATE_FORMAT(lr.start_date, "%Y-%m")',
            array_merge($scopeParams, [':window_start' => array_key_first($leaveSeries) . '-01'])
        );

        foreach ($leaveTrend as $row) {
            $month = (string)$row['month'];
            if (isset($leaveSeries[$month])) {
                $leaveSeries[$month]['filed'] = (int)$row['filed'];
                $leaveSeries[$month]['approved'] = (int)$row['approved'];
                $leaveSeries[$month]['rejected'] = (int)$row['rejected'];
            }
        }

        $charts['leaveTrend'] = array_values($leaveSeries);
    } else {
        $charts['leaveStatus'] = [];
        $charts['leaveTypeDistribution'] = [];
        $charts['leaveTrend'] = [];
    }

    // --- Attendance ---
    if (reports_table_exists($pdo, 'attendance_daily_records')) {
        $attendanceParams = array_merge($scopeParams, [':start_date' => $dateWindow['start'], ':end_date' => $dateWindow['end']]);

        $charts['attendanceSummary'] = array_map(
            static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (int)$row['value']],
            reports_rows(
                $pdo,
                'SELECT COALESCE(NULLIF(TRIM(adr.status), ""), "Unspecified") AS label, COUNT(adr.id) AS value
                 FROM attendance_daily_records adr
                 INNER JOIN employees e ON e.id = adr.employee_id
                 WHERE adr.attendance_date BETWEEN :start_date AND :end_date' . $scope . '
                 GROUP BY label ORDER BY value DESC',
                $attendanceParams
            )
        );

        $charts['attendanceExceptions'] = [
            [
                'label' => 'Late',
                'value' => (int)reports_scalar($pdo, 'SELECT COUNT(adr.id) FROM attendance_daily_records adr INNER JOIN employees e ON e.id = adr.employee_id WHERE adr.late_minutes > 0 AND adr.attendance_date BETWEEN :start_date AND :end_date' . $scope, $attendanceParams),
            ],
            [
                'label' => 'Undertime',
                'value' => (int)reports_scalar($pdo, 'SELECT COUNT(adr.id) FROM attendance_daily_records adr INNER JOIN employees e ON e.id = adr.employee_id WHERE adr.undertime_minutes > 0 AND adr.attendance_date BETWEEN :start_date AND :end_date' . $scope, $attendanceParams),
            ],
            [
                'label' => 'Overtime',
                'value' => reports_table_exists($pdo, 'overtime')
                    ? (int)reports_scalar($pdo, 'SELECT COUNT(o.overtime_id) FROM overtime o INNER JOIN employees e ON e.id = o.employee_id WHERE o.work_date BETWEEN :start_date AND :end_date' . $scope, $attendanceParams)
                    : 0,
            ],
        ];

        $charts['attendanceTrend'] = array_map(
            static fn (array $row): array => [
                'label' => (string)$row['label'],
                'present' => (int)$row['present'],
                'absent' => (int)$row['absent'],
                'late' => (int)$row['late'],
            ],
            reports_rows(
                $pdo,
                'SELECT DATE_FORMAT(adr.attendance_date, "%Y-%m-%d") AS label,
                        SUM(CASE WHEN LOWER(adr.status) = "present" THEN 1 ELSE 0 END) AS present,
                        SUM(CASE WHEN LOWER(adr.status) = "absent" THEN 1 ELSE 0 END) AS absent,
                        SUM(CASE WHEN adr.late_minutes > 0 THEN 1 ELSE 0 END) AS late
                 FROM attendance_daily_records adr
                 INNER JOIN employees e ON e.id = adr.employee_id
                 WHERE adr.attendance_date BETWEEN :start_date AND :end_date' . $scope . '
                 GROUP BY adr.attendance_date
                 ORDER BY adr.attendance_date ASC
                 LIMIT 90',
                $attendanceParams
            )
        );
    } else {
        $charts['attendanceSummary'] = [];
        $charts['attendanceExceptions'] = [];
        $charts['attendanceTrend'] = [];
    }

    // --- Performance ---
    $charts['performanceByDivision'] = reports_performance_by_division($pdo, $divisionId);

    return $charts;
}

/**
 * Average IPCR and OPCR rating side by side, one row per division.
 *
 * The two live in unrelated tables and are keyed differently — IPCR hangs off an employee and
 * reaches its division through `employees.division_id`, while an OPCR assignment names its division
 * as free text — so they are read separately and merged here on the division name. Names are matched
 * case-insensitively and trimmed, because one side is a `divisions` row and the other is whatever
 * was typed on the assignment.
 *
 * A division that has one and not the other still gets a row, with the missing side left null so the
 * line breaks over it rather than dropping to zero and inventing a bad rating.
 */
function reports_performance_by_division(PDO $pdo, ?int $divisionId): array
{
    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $divisions = [];

    if (reports_table_exists($pdo, 'ipcr')) {
        foreach (reports_rows(
            $pdo,
            'SELECT COALESCE(NULLIF(TRIM(d.name), ""), "Unassigned") AS label,
                    ROUND(AVG(i.final_rating), 3) AS rating,
                    COUNT(i.ipcr_id) AS evaluations
             FROM ipcr i
             INNER JOIN employees e ON e.id = i.employee_id
             LEFT JOIN divisions d ON d.id = e.division_id
             WHERE i.is_archived = 0 AND i.final_rating IS NOT NULL' . $scope . '
             GROUP BY label',
            $scopeParams
        ) as $row) {
            $label = (string)$row['label'];
            $divisions[strtolower($label)] = [
                'label' => $label,
                'ipcr' => (float)$row['rating'],
                'ipcrEvaluations' => (int)$row['evaluations'],
                'opcr' => null,
                'opcrAssignments' => 0,
            ];
        }
    }

    if (reports_table_exists($pdo, 'division_opcr_assignments')) {
        /*
         * The division filter has no `division_id` to bite on here, so it is resolved to the name
         * the assignments carry. An unknown id matches nothing, which is the correct empty result
         * rather than the whole table unfiltered.
         */
        $opcrScope = '';
        $opcrParams = [];

        if ($divisionId !== null && $divisionId > 0) {
            $divisionRows = reports_rows(
                $pdo,
                'SELECT name FROM divisions WHERE id = :division_id LIMIT 1',
                [':division_id' => $divisionId]
            );
            $divisionName = (string)($divisionRows[0]['name'] ?? '');
            $opcrScope = ' AND LOWER(TRIM(doa.division)) = :scope_division_name';
            $opcrParams[':scope_division_name'] = strtolower(trim($divisionName));
        }

        foreach (reports_rows(
            $pdo,
            'SELECT COALESCE(NULLIF(TRIM(doa.division), ""), "Unassigned") AS label,
                    ROUND(AVG(doa.final_rating), 3) AS rating,
                    COUNT(doa.assignment_id) AS assignments
             FROM division_opcr_assignments doa
             WHERE doa.is_archived = 0 AND doa.final_rating IS NOT NULL' . $opcrScope . '
             GROUP BY label',
            $opcrParams
        ) as $row) {
            $label = (string)$row['label'];
            $key = strtolower($label);

            if (!isset($divisions[$key])) {
                $divisions[$key] = [
                    'label' => $label,
                    'ipcr' => null,
                    'ipcrEvaluations' => 0,
                    'opcr' => null,
                    'opcrAssignments' => 0,
                ];
            }

            $divisions[$key]['opcr'] = (float)$row['rating'];
            $divisions[$key]['opcrAssignments'] = (int)$row['assignments'];
        }
    }

    /*
     * Ordered by IPCR, which is the series with a point for nearly every division — ordering by a
     * mix of the two would reshuffle the axis whenever an OPCR was filed. Divisions carrying only an
     * OPCR sort to the end rather than to the front on a null.
     */
    $rows = array_values($divisions);
    usort($rows, static function (array $left, array $right): int {
        $leftRating = $left['ipcr'] ?? $left['opcr'] ?? -1;
        $rightRating = $right['ipcr'] ?? $right['opcr'] ?? -1;

        return $rightRating <=> $leftRating ?: strcasecmp($left['label'], $right['label']);
    });

    return array_slice($rows, 0, 12);
}

/**
 * `$scopeDivisionId` is the signed-in desk's own division when the category being summarised is a
 * scoped one (see reports_scope_division_id()); it overrides whatever division the picker sent, so
 * the charts count the same people the table lists. 0 -- a scoped desk with no division -- draws
 * nothing rather than everyone.
 */
function reports_dashboard(PDO $pdo, array $query, ?int $scopeDivisionId = null): array
{
    $dateWindow = reports_date_window(
        reports_text($query['dateRange'] ?? 'last30'),
        $query['customStart'] ?? null,
        $query['customEnd'] ?? null
    );
    $availability = [
        'payroll' => reports_table_exists($pdo, 'payroll'),
        'leave' => reports_table_exists($pdo, 'leave_requests'),
        'attendance' => reports_table_exists($pdo, 'attendance_daily_records'),
        // Either instrument is enough to draw the performance card, which plots both.
        'performance' => reports_table_exists($pdo, 'ipcr')
            || reports_table_exists($pdo, 'division_opcr_assignments'),
        'training' => reports_table_exists($pdo, 'training_seminars'),
        'recruitment' => reports_table_exists($pdo, 'applicants'),
    ];

    if ($scopeDivisionId === 0) {
        return [
            'generatedAt' => date('Y-m-d H:i:s'),
            'dateRange' => $dateWindow,
            'kpis' => [],
            'charts' => [],
            'availability' => $availability,
        ];
    }

    $divisionId = $scopeDivisionId ?? (int)reports_text($query['divisionId'] ?? '0');
    $divisionId = $divisionId > 0 ? $divisionId : null;

    $previousMonthEnd = (new DateTimeImmutable('first day of this month'))->modify('-1 day')->format('Y-m-d');

    $kpis = array_merge(
        reports_employee_kpis($pdo, $divisionId, $previousMonthEnd),
        reports_payroll_kpis($pdo, $divisionId),
        reports_leave_kpis($pdo, $divisionId)
    );

    return [
        'generatedAt' => date('Y-m-d H:i:s'),
        'dateRange' => $dateWindow,
        'kpis' => $kpis,
        'charts' => reports_dashboard_charts($pdo, $divisionId, $dateWindow),
        'availability' => $availability,
    ];
}

// ===================================================================
// Filter options + catalog
// ===================================================================

/**
 * `$scopeDivisionId` narrows the people-shaped pickers -- Division and Employee -- to the signed-in
 * desk's own division (see reports_scope_division_id()), so a scoped desk is not offered names its
 * reports will never return. 0 leaves both pickers empty. Everything else (leave types, payroll
 * periods, statuses) is office-wide vocabulary and stays as it is.
 */
function reports_filter_options(PDO $pdo, ?int $scopeDivisionId = null): array
{
    $divisionScope = '';
    $employeeScope = '';
    $scopeParams = [];

    if ($scopeDivisionId !== null) {
        if ($scopeDivisionId > 0) {
            $divisionScope = ' AND id = :division_id';
            $employeeScope = ' AND e.division_id = :division_id';
            $scopeParams = [':division_id' => $scopeDivisionId];
        } else {
            $divisionScope = ' AND 1 = 0';
            $employeeScope = ' AND 1 = 0';
        }
    }

    $divisions = reports_rows(
        $pdo,
        'SELECT id, name, code FROM divisions WHERE is_archived = 0' . $divisionScope . ' ORDER BY name ASC',
        $scopeParams
    );
    $employees = reports_rows(
        $pdo,
        'SELECT e.id, e.employee_id, ' . reports_employee_name_expression() . ' AS employeeName
         FROM employees e
         WHERE e.is_archived = 0' . $employeeScope . '
         ORDER BY employeeName ASC',
        $scopeParams
    );
    $designations = reports_rows(
        $pdo,
        'SELECT des.id, des.name, d.name AS division
         FROM designations des
         LEFT JOIN divisions d ON d.id = des.division_id
         WHERE des.is_archived = 0
         ORDER BY des.name ASC'
    );
    $employmentStatuses = reports_rows(
        $pdo,
        'SELECT DISTINCT ' . reports_employment_status_label_sql('employment_status') . ' AS value
         FROM employees
         WHERE is_archived = 0 AND COALESCE(TRIM(employment_status), "") <> ""'
            . reports_excluded_employment_status_sql('employment_status') . '
         ORDER BY value ASC'
    );
    $statuses = reports_rows(
        $pdo,
        'SELECT DISTINCT TRIM(status) AS value
         FROM employees
         WHERE is_archived = 0 AND COALESCE(TRIM(status), "") <> ""
         ORDER BY value ASC'
    );
    $genders = reports_rows(
        $pdo,
        'SELECT DISTINCT TRIM(gender) AS value
         FROM employees
         WHERE is_archived = 0 AND COALESCE(TRIM(gender), "") <> ""
         ORDER BY value ASC'
    );
    $leaveTypes = reports_table_exists($pdo, 'leave_types')
        ? reports_rows($pdo, 'SELECT leave_type_id AS id, name, code FROM leave_types WHERE is_active = 1 ORDER BY name ASC')
        : [];
    $payrollYears = reports_table_exists($pdo, 'payroll')
        ? reports_rows($pdo, 'SELECT DISTINCT YEAR(payroll_date) AS value FROM payroll WHERE payroll_date IS NOT NULL ORDER BY value DESC')
        : [];
    $leaveYears = reports_table_exists($pdo, 'leave_credits')
        ? reports_rows($pdo, 'SELECT DISTINCT year AS value FROM leave_credits ORDER BY year DESC')
        : [];

    return [
        'employees' => array_map(
            static fn (array $row): array => [
                'value' => (string)$row['id'],
                'label' => (string)$row['employeeName'],
                'employeeNo' => (string)$row['employee_id'],
            ],
            $employees
        ),
        'divisions' => array_map(
            static fn (array $row): array => ['value' => (string)$row['id'], 'label' => (string)$row['name'], 'code' => (string)($row['code'] ?? '')],
            $divisions
        ),
        'designations' => array_map(
            static fn (array $row): array => ['value' => (string)$row['id'], 'label' => (string)$row['name'], 'group' => (string)($row['division'] ?? '')],
            $designations
        ),
        'employmentStatuses' => array_map(
            static fn (array $row): array => ['value' => (string)$row['value'], 'label' => (string)$row['value']],
            $employmentStatuses
        ),
        'statuses' => array_map(
            static fn (array $row): array => ['value' => (string)$row['value'], 'label' => (string)$row['value']],
            $statuses
        ),
        'genders' => array_map(
            static fn (array $row): array => ['value' => (string)$row['value'], 'label' => (string)$row['value']],
            $genders
        ),
        'leaveTypes' => array_map(
            static fn (array $row): array => ['value' => (string)$row['id'], 'label' => (string)$row['name']],
            $leaveTypes
        ),
        'leaveStatuses' => array_map(
            static fn (string $status): array => ['value' => strtolower($status), 'label' => $status],
            ['Approved', 'Pending', 'Rejected', 'Cancelled']
        ),
        'leaveYears' => array_map(
            static fn (array $row): array => ['value' => (string)$row['value'], 'label' => (string)$row['value']],
            $leaveYears
        ),
        'payrollYears' => array_map(
            static fn (array $row): array => ['value' => (string)$row['value'], 'label' => (string)$row['value']],
            $payrollYears
        ),
        'payrollMonths' => array_map(
            static fn (int $month): array => ['value' => (string)$month, 'label' => date('F', mktime(0, 0, 0, $month, 1))],
            range(1, 12)
        ),
    ];
}

function reports_catalog(PDO $pdo, string $roleKey = ''): array
{
    $definitions = reports_definitions();
    $categoryLabels = reports_category_labels();
    $blocked = reports_blocked_report_keys($roleKey);
    $blockedCategories = reports_blocked_category_keys($roleKey);
    $catalog = [];

    foreach ($definitions as $key => $definition) {
        if (in_array($key, $blocked, true)) {
            continue;
        }

        $categoryKey = $definition['category'] ?? 'employee';

        if (in_array($categoryKey, $blockedCategories, true)) {
            continue;
        }

        if (!isset($catalog[$categoryKey])) {
            $catalog[$categoryKey] = [
                'key' => $categoryKey,
                'label' => $categoryLabels[$categoryKey] ?? ucfirst($categoryKey),
                'reports' => [],
            ];
        }

        $catalog[$categoryKey]['reports'][] = [
            'key' => $key,
            'label' => $definition['label'],
            'description' => $definition['description'],
            'category' => $categoryKey,
            'categoryLabel' => $categoryLabels[$categoryKey] ?? ucfirst($categoryKey),
            'available' => reports_required_tables_exist($pdo, $definition),
            'filters' => array_keys($definition['filters'] ?? []),
            'supportsDateRange' => !empty($definition['dateExpression']),
        ];
    }

    $ordered = [];
    foreach (array_keys($categoryLabels) as $categoryKey) {
        if (isset($catalog[$categoryKey])) {
            $ordered[] = $catalog[$categoryKey];
        }
    }

    return $ordered;
}

/** Human-readable filter labels for exported and printed report metadata. */
function reports_describe_active_filters(PDO $pdo, array $activeFilters): array
{
    if ($activeFilters === []) {
        return [];
    }

    $labels = [
        'employeeId' => ['Employee', 'employees'],
        'divisionId' => ['Division/Department', 'divisions'],
        'designationId' => ['Position', 'designations'],
        'employmentStatus' => ['Employment Status', 'employmentStatuses'],
        'gender' => ['Gender', 'genders'],
        'status' => ['Status', 'leaveStatuses'],
        'leaveTypeId' => ['Leave Type', 'leaveTypes'],
        'year' => ['Year', null],
        'payrollYear' => ['Payroll Year', 'payrollYears'],
        'payrollMonth' => ['Payroll Month', 'payrollMonths'],
    ];
    $options = reports_filter_options($pdo);
    $described = [];

    foreach ($activeFilters as $key => $filter) {
        [$label, $optionsKey] = $labels[$key] ?? [ucwords(preg_replace('/(?<!^)[A-Z]/', ' $0', (string)$key)), null];
        $rawValue = reports_text($filter['value'] ?? '');
        $displayValue = $rawValue;

        if ($optionsKey !== null) {
            foreach ($options[$optionsKey] ?? [] as $option) {
                if ((string)($option['value'] ?? '') === $rawValue) {
                    $displayValue = (string)($option['label'] ?? $rawValue);
                    break;
                }
            }
        }

        $described[] = ['key' => (string)$key, 'label' => $label, 'value' => $displayValue];
    }

    return $described;
}

// ===================================================================
// Export writers
// ===================================================================

function reports_export_filename(string $label, string $extension): string
{
    $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $label));
    $slug = trim((string)$slug, '-');

    return ($slug !== '' ? $slug : 'report') . '-' . date('Y-m-d-His') . '.' . $extension;
}

function reports_cell_value(array $row, string $key): string
{
    $value = $row[$key] ?? '';

    if (in_array($key, ['computedAmount', 'rateBasis'], true) && is_numeric($value)) {
        return '₱' . number_format((float)$value, 2, '.', ',');
    }

    if (in_array($key, [
        'withPay', 'withoutPay', 'totalDays', 'balanceBefore', 'balanceAfter',
        'availableLeaveBalance', 'daysRequested', 'daysApproved', 'beginningBalance',
        'earnedCredits', 'usedCredits', 'monetizedCredits', 'adjustments',
        'remainingBalance', 'totalDaysUsed',
    ], true) && is_numeric($value)) {
        return number_format((float)$value, 2, '.', ',');
    }

    if (in_array($key, ['dateFiled', 'dateRequested', 'approvalDate', 'asOfDate', 'dateApproved'], true)
        && reports_text($value) !== '' && reports_text($value) !== 'N/A') {
        try {
            return (new DateTimeImmutable((string)$value))->format('M j, Y');
        } catch (Throwable) {
            // Keep the database value when an imported record carries a non-standard date.
        }
    }

    if (is_float($value)) {
        return number_format($value, 2, '.', '');
    }

    return (string)$value;
}

/**
 * The columns an exported file carries, which is the on-screen list minus Status.
 *
 * A report is filtered to a status before it is exported -- "Approved Leave", "Pending Payroll",
 * "Active Employees" -- so the column repeats the same word down every row of the file and costs a
 * column of width in the CSV, the sheet and the fixed 132-character PDF line. The screen keeps it:
 * there the list is being read and re-filtered, and the value is worth seeing per row.
 *
 * Only the `status` key goes. `employmentStatus` (Permanent, Contractual) and `approvalStatus` are
 * different facts that happen to be spelled with the same word, and they stay.
 *
 * An aggregate is the exception. Net Pay Summary groups BY status, so the column is not a repeated
 * label there -- it is what names the row, and dropping it would leave a file of totals with nothing
 * saying which status each total belongs to.
 */
function reports_export_columns(array $definition): array
{
    $columns = $definition['columns'] ?? [];

    if (!empty($definition['isAggregate']) || !empty($definition['keepStatus'])) {
        return $columns;
    }

    return array_values(array_filter(
        $columns,
        static fn (array $column): bool => ($column['key'] ?? '') !== 'status'
    ));
}

function reports_stream_csv(array $definition, array $rows): void
{
    $filename = reports_export_filename($definition['label'], 'csv');
    header_remove('Content-Type');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');

    $columns = reports_export_columns($definition);
    $output = fopen('php://output', 'w');
    fputcsv($output, array_column($columns, 'label'));

    foreach ($rows as $row) {
        fputcsv($output, array_map(
            static fn (array $column): string => reports_cell_value($row, $column['key']),
            $columns
        ));
    }

    fclose($output);
    exit;
}

function reports_xml(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

function reports_excel_column(int $index): string
{
    $name = '';

    while ($index >= 0) {
        $name = chr(($index % 26) + 65) . $name;
        $index = intdiv($index, 26) - 1;
    }

    return $name;
}

function reports_worksheet_xml(
    array $definition,
    array $rows,
    array $dateWindow,
    array $summary = [],
    array $appliedFilters = []
): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $xml .= '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    $xml .= '<sheetData>';
    $rowNumber = 1;

    $writeRow = static function (array $values) use (&$xml, &$rowNumber): void {
        $xml .= '<row r="' . $rowNumber . '">';
        foreach (array_values($values) as $index => $value) {
            $cell = reports_excel_column($index) . $rowNumber;
            $xml .= '<c r="' . $cell . '" t="inlineStr"><is><t>' . reports_xml($value) . '</t></is></c>';
        }
        $xml .= '</row>';
        $rowNumber += 1;
    };

    $writeRow([$definition['label']]);
    $writeRow(['Generated', date('Y-m-d H:i:s')]);
    $writeRow(['Date Range', $dateWindow['label'] . ' (' . $dateWindow['start'] . ' to ' . $dateWindow['end'] . ')']);
    $writeRow([
        'Applied Filters',
        $appliedFilters === []
            ? 'None'
            : implode('; ', array_map(
                static fn (array $filter): string => $filter['label'] . ': ' . $filter['value'],
                $appliedFilters
            )),
    ]);
    $writeRow(['Records', (string)count($rows)]);
    foreach ($summary['keyStatistics'] ?? [] as $statistic) {
        $writeRow([(string)$statistic['label'], (string)$statistic['value']]);
    }
    $writeRow([]);

    $columns = reports_export_columns($definition);
    $writeRow(array_column($columns, 'label'));

    foreach ($rows as $row) {
        $writeRow(array_map(
            static fn (array $column): string => reports_cell_value($row, $column['key']),
            $columns
        ));
    }

    $xml .= '</sheetData></worksheet>';

    return $xml;
}

/** Excel-compatible XML fallback for XAMPP installations without PHP's Zip extension. */
function reports_stream_excel_xml(
    array $definition,
    array $rows,
    array $dateWindow,
    array $summary = [],
    array $appliedFilters = []
): void {
    $filename = reports_export_filename($definition['label'], 'xls');
    $xml = '<?xml version="1.0" encoding="UTF-8"?>';
    $xml .= '<?mso-application progid="Excel.Sheet"?>';
    $xml .= '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
        . 'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
    $xml .= '<Worksheet ss:Name="Report"><Table>';

    $writeRow = static function (array $values) use (&$xml): void {
        $xml .= '<Row>';
        foreach ($values as $value) {
            $xml .= '<Cell><Data ss:Type="String">' . reports_xml($value) . '</Data></Cell>';
        }
        $xml .= '</Row>';
    };

    $writeRow([$definition['label']]);
    $writeRow(['Generated', date('Y-m-d H:i:s')]);
    $writeRow(['Date Range', $dateWindow['label'] . ' (' . $dateWindow['start'] . ' to ' . $dateWindow['end'] . ')']);
    $writeRow([
        'Applied Filters',
        $appliedFilters === []
            ? 'None'
            : implode('; ', array_map(
                static fn (array $filter): string => $filter['label'] . ': ' . $filter['value'],
                $appliedFilters
            )),
    ]);
    $writeRow(['Records', (string)count($rows)]);
    foreach ($summary['keyStatistics'] ?? [] as $statistic) {
        $writeRow([(string)$statistic['label'], (string)$statistic['value']]);
    }
    $writeRow([]);

    $columns = reports_export_columns($definition);
    $writeRow(array_column($columns, 'label'));
    foreach ($rows as $row) {
        $writeRow(array_map(
            static fn (array $column): string => reports_cell_value($row, $column['key']),
            $columns
        ));
    }

    $xml .= '</Table></Worksheet></Workbook>';

    header_remove('Content-Type');
    header('Content-Type: application/vnd.ms-excel; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($xml));
    echo $xml;
    exit;
}

function reports_stream_xlsx(
    array $definition,
    array $rows,
    array $dateWindow,
    array $summary = [],
    array $appliedFilters = []
): void
{
    if (!class_exists(ZipArchive::class)) {
        reports_stream_excel_xml($definition, $rows, $dateWindow, $summary, $appliedFilters);
    }

    $filename = reports_export_filename($definition['label'], 'xlsx');
    $tempFile = tempnam(sys_get_temp_dir(), 'hris-report-');
    $zip = new ZipArchive();

    if ($tempFile === false || $zip->open($tempFile, ZipArchive::OVERWRITE) !== true) {
        reports_stream_excel_xml($definition, $rows, $dateWindow, $summary, $appliedFilters);
    }

    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>');
    $zip->addFromString(
        'xl/worksheets/sheet1.xml',
        reports_worksheet_xml($definition, $rows, $dateWindow, $summary, $appliedFilters)
    );
    $zip->addFromString('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' . reports_xml($definition['label']) . '</dc:title><dc:creator>HRIS</dc:creator></cp:coreProperties>');
    $zip->addFromString('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>HRIS</Application></Properties>');
    $zip->close();

    header_remove('Content-Type');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . filesize($tempFile));
    readfile($tempFile);
    unlink($tempFile);
    exit;
}

function reports_pdf_escape(string $value): string
{
    $value = str_replace(["\r", "\n"], ' ', $value);
    return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $value);
}

function reports_pdf_lines(
    array $definition,
    array $rows,
    array $dateWindow,
    array $summary,
    array $appliedFilters = []
): array
{
    $lines = [
        $definition['label'],
        'Generated: ' . date('Y-m-d H:i:s'),
        'Date Range: ' . $dateWindow['label'] . ' (' . $dateWindow['start'] . ' to ' . $dateWindow['end'] . ')',
        'Applied Filters: ' . ($appliedFilters === []
            ? 'None'
            : implode('; ', array_map(
                static fn (array $filter): string => $filter['label'] . ': ' . $filter['value'],
                $appliedFilters
            ))),
        'Records: ' . count($rows),
    ];

    foreach ($summary['keyStatistics'] ?? [] as $statistic) {
        $lines[] = $statistic['label'] . ': ' . $statistic['value'];
    }

    $columns = reports_export_columns($definition);

    $lines[] = '';
    $lines[] = implode(' | ', array_column($columns, 'label'));
    $lines[] = str_repeat('-', 132);

    foreach ($rows as $row) {
        $values = array_map(
            static fn (array $column): string => reports_cell_value($row, $column['key']),
            $columns
        );
        $lines[] = substr(implode(' | ', $values), 0, 132);
    }

    if ($rows === []) {
        $lines[] = 'No records found for the selected filters.';
    }

    return $lines;
}

function reports_build_pdf(array $lines): string
{
    $lineChunks = array_chunk($lines, 46);
    $objects = [];
    $objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    $objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';
    $pageIds = [];
    $nextId = 4;

    foreach ($lineChunks as $chunk) {
        $contentId = $nextId++;
        $pageId = $nextId++;
        $pageIds[] = $pageId;
        $stream = "BT\n/F1 8 Tf\n40 560 Td\n10 TL\n";

        foreach ($chunk as $line) {
            $stream .= '(' . reports_pdf_escape((string)$line) . ") Tj\nT*\n";
        }

        $stream .= "ET\n";
        $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "endstream";
        $objects[$pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ' . $contentId . ' 0 R >>';
    }

    $objects[2] = '<< /Type /Pages /Count ' . count($pageIds) . ' /Kids [' . implode(' ', array_map(static fn (int $id): string => $id . ' 0 R', $pageIds)) . '] >>';
    ksort($objects);

    $pdf = "%PDF-1.4\n";
    $offsets = [0 => 0];
    foreach ($objects as $id => $body) {
        $offsets[$id] = strlen($pdf);
        $pdf .= $id . " 0 obj\n" . $body . "\nendobj\n";
    }

    $xrefOffset = strlen($pdf);
    $maxId = max(array_keys($objects));
    $pdf .= "xref\n0 " . ($maxId + 1) . "\n";
    $pdf .= "0000000000 65535 f \n";

    for ($id = 1; $id <= $maxId; $id += 1) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$id] ?? 0);
    }

    $pdf .= "trailer\n<< /Size " . ($maxId + 1) . " /Root 1 0 R >>\nstartxref\n" . $xrefOffset . "\n%%EOF";

    return $pdf;
}

function reports_stream_pdf(
    array $definition,
    array $rows,
    array $dateWindow,
    array $summary,
    array $appliedFilters = []
): void
{
    $filename = reports_export_filename($definition['label'], 'pdf');
    $pdf = reports_build_pdf(reports_pdf_lines($definition, $rows, $dateWindow, $summary, $appliedFilters));

    header_remove('Content-Type');
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($pdf));
    echo $pdf;
    exit;
}

function reports_stream_export(
    string $format,
    array $definition,
    array $rows,
    array $dateWindow,
    array $summary,
    array $appliedFilters = []
): void
{
    if ($format === 'pdf') {
        reports_stream_pdf($definition, $rows, $dateWindow, $summary, $appliedFilters);
    }

    if ($format === 'xlsx') {
        reports_stream_xlsx($definition, $rows, $dateWindow, $summary, $appliedFilters);
    }

    reports_stream_csv($definition, $rows);
}

// ===================================================================
// Router
// ===================================================================

$requestMethod = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$action = strtolower(reports_text($_GET['action'] ?? ''));
$definitions = reports_definitions();

if ($action === 'activity') {
    if ($requestMethod === 'DELETE') {
        $ids = array_filter(explode(',', reports_text($_GET['ids'] ?? '')));
        $deleted = reports_delete_activity($pdo, $ids);

        reports_write_audit($pdo, $sessionUser, 'report.deleted', 'Deleted ' . $deleted . ' report activity record(s).', [
            'deleted' => $deleted,
        ]);

        json_response([
            'success' => true,
            'message' => $deleted . ' record(s) removed.',
            'activity' => reports_recent_activity($pdo, (int)($_GET['limit'] ?? 50)),
        ]);
    }

    require_method('GET');

    json_response([
        'success' => true,
        'activity' => reports_recent_activity($pdo, (int)($_GET['limit'] ?? 50)),
    ]);
}

if ($action === 'log') {
    require_method('POST');
    $body = read_json_body();
    $reportType = reports_text($body['reportType'] ?? '');
    $definition = $definitions[$reportType] ?? null;

    reports_write_audit(
        $pdo,
        $sessionUser,
        'report.' . (reports_text($body['action'] ?? 'printed') ?: 'printed'),
        reports_text($body['summary'] ?? '') !== ''
            ? reports_text($body['summary'])
            : 'Printed report "' . ($definition['label'] ?? $reportType) . '".',
        [
            'reportType' => $reportType,
            'reportLabel' => $definition['label'] ?? $reportType,
            'format' => reports_text($body['format'] ?? 'print'),
            'records' => (int)($body['records'] ?? 0),
            'division' => reports_text($body['division'] ?? '') ?: 'All Divisions',
            'dateRangeLabel' => reports_text($body['dateRangeLabel'] ?? ''),
        ]
    );

    json_response(['success' => true]);
}

require_method('GET');

$scopeDivisionId = reports_scope_division_id($pdo, $sessionUser, $roleKey);

if ($action === 'catalog') {
    json_response([
        'success' => true,
        'categories' => reports_catalog($pdo, $roleKey),
    ]);
}

if ($action === 'filters') {
    json_response([
        'success' => true,
        'filters' => reports_filter_options($pdo, $scopeDivisionId),
    ]);
}

if ($action === 'dashboard') {
    // The client names the category it is summarising so a scoped desk's employee charts count the
    // same division its employee tables list. Other categories, and unscoped desks, are unaffected.
    $dashboardCategory = reports_text($_GET['category'] ?? '');
    $dashboardScope = $scopeDivisionId !== null && reports_category_is_division_scoped($dashboardCategory)
        ? $scopeDivisionId
        : null;

    json_response([
        'success' => true,
        'dashboard' => reports_dashboard($pdo, $_GET, $dashboardScope),
    ]);
}

$reportType = reports_text($_GET['reportType'] ?? 'employee-list');
$dateRange = reports_text($_GET['dateRange'] ?? 'last30');
$search = substr(reports_text($_GET['search'] ?? ''), 0, 120);
$exportFormat = strtolower(reports_text($_GET['exportAs'] ?? $_GET['export'] ?? ''));

if (!isset($definitions[$reportType])) {
    json_response([
        'success' => false,
        'message' => 'Selected report type is invalid.',
    ], 422);
}

// Covers the export path as much as the read path — both arrive through here, and a report this role
// cannot open is not one it can download either.
if (in_array($reportType, reports_blocked_report_keys($roleKey), true)) {
    json_response([
        'success' => false,
        'message' => 'You do not have permission to run this report.',
    ], 403);
}

$definition = $definitions[$reportType];
$reportCategory = $definition['category'] ?? 'employee';

if (in_array($reportCategory, reports_blocked_category_keys($roleKey), true)) {
    json_response([
        'success' => false,
        'message' => 'You do not have permission to run this report.',
    ], 403);
}

if ($exportFormat !== '' && !in_array($exportFormat, ['pdf', 'xlsx', 'csv'], true)) {
    json_response([
        'success' => false,
        'message' => 'Selected export format is invalid.',
    ], 422);
}

/*
 * A scoped desk's employee reports list its own division whatever the query string asked for: the
 * division is written over the request here so the same filter machinery narrows the rows, names
 * the division in the export's applied-filter metadata, and covers the download path as much as the
 * read path. A scoped desk with no division has nothing to list -- and so does a scoped report that
 * carries no division filter to narrow by, rather than falling open to everyone.
 */
$reportIsDivisionScoped = $scopeDivisionId !== null && reports_category_is_division_scoped($reportCategory);
$reportCanNarrow = $scopeDivisionId > 0 && isset($definition['filters']['divisionId']);

if ($reportIsDivisionScoped) {
    // The desk's own division, or none at all -- never the one the query string asked for, which
    // would otherwise be printed on an empty export as if it had been applied.
    if ($reportCanNarrow) {
        $_GET['divisionId'] = (string)$scopeDivisionId;
    } else {
        unset($_GET['divisionId']);
    }
}

$dateWindow = reports_date_window($dateRange, $_GET['customStart'] ?? null, $_GET['customEnd'] ?? null);
$activeFilters = reports_active_filters($definition, $_GET);
$rows = $reportIsDivisionScoped && !$reportCanNarrow
    ? []
    : reports_fetch_rows($pdo, $definition, $dateWindow, $search, $activeFilters);
$summary = reports_summary($definition, $rows, $dateWindow);
$tablesReady = reports_required_tables_exist($pdo, $definition);
$appliedFilterLabels = reports_describe_active_filters($pdo, $activeFilters);

if ($exportFormat !== '') {
    reports_write_audit($pdo, $sessionUser, 'report.exported', 'Exported "' . $definition['label'] . '" as ' . strtoupper($exportFormat) . '.', [
        'reportType' => $reportType,
        'reportLabel' => $definition['label'],
        'format' => $exportFormat,
        'records' => count($rows),
        'dateRangeLabel' => $dateWindow['label'],
        'filters' => array_map(static fn (array $filter): string => $filter['value'], $activeFilters),
    ]);

    reports_stream_export($exportFormat, $definition, $rows, $dateWindow, $summary, $appliedFilterLabels);
}

// Reading a report is not audited here — the browser refetches on every filter
// change, which would bury the real entries. Deliberate acts (preview, print)
// are logged by the client through `action=log`; exports are logged above.
json_response([
    'success' => true,
    'reportType' => $reportType,
    'report' => [
        'key' => $reportType,
        'label' => $definition['label'],
        'description' => $definition['description'],
        'category' => $definition['category'] ?? 'employee',
        'categoryLabel' => reports_category_labels()[$definition['category'] ?? 'employee'] ?? 'Report',
        'columns' => $definition['columns'],
        /*
         * Sent so the preview drawer can apply the same Status rule the export writers do — see
         * reports_export_columns(). An aggregate's Status column names its rows, so it survives on
         * paper; a detail report's repeats the filter and does not.
         */
        'isAggregate' => !empty($definition['isAggregate']),
        'keepStatus' => !empty($definition['keepStatus']),
        'rows' => $rows,
        'summary' => $summary,
        'dateRange' => $dateWindow,
        'available' => $tablesReady,
        'supportedFilters' => array_keys($definition['filters'] ?? []),
        'appliedFilters' => $appliedFilterLabels,
    ],
]);
