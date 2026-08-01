<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/deduction-catalog.php';

$sessionUser = require_session_user();
$roleKey = hris_user_role_key($sessionUser);

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

function reports_employee_filters(): array
{
    return [
        'divisionId' => 'e.division_id',
        'designationId' => 'e.designation_id',
        'employmentStatus' => 'e.employment_status',
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
        'searchExpressions' => ['e.employee_id', $name, 'd.name', 'des.name', 'e.email', 'e.status', 'e.employment_status'],
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
            'label' => 'Employee Master List',
            'description' => 'Complete employee master list filtered by hiring or creation date.',
            'where' => '',
        ],
        'employee-active' => [
            'label' => 'Total Active Employees',
            'description' => 'Employees currently flagged as active in the master list.',
            'where' => 'LOWER(e.status) = "active"',
        ],
        'employee-inactive' => [
            'label' => 'Total Inactive Employees',
            'description' => 'Employees whose record status is anything other than active.',
            'where' => 'LOWER(e.status) <> "active"',
        ],
        'employee-male' => [
            'label' => 'Male Employees',
            'description' => 'Employees recorded with a male gender.',
            'where' => 'LOWER(e.gender) = "male"',
        ],
        'employee-female' => [
            'label' => 'Female Employees',
            'description' => 'Employees recorded with a female gender.',
            'where' => 'LOWER(e.gender) = "female"',
        ],
        'employee-pwd' => [
            'label' => 'PWD Employees',
            'description' => 'Employees registered as persons with disability.',
            'where' => 'e.pwd = 1',
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
        ],
        'employee-cos' => [
            'label' => 'Contract of Service Employees',
            'description' => 'Employees engaged through contract of service or contractual appointments.',
            'where' => 'LOWER(COALESCE(e.employment_status, "")) IN ("contractual", "contract of service", "cos")',
        ],
        'employee-casual' => [
            'label' => 'Casual Employees',
            'description' => 'Employees under a casual appointment.',
            'where' => 'LOWER(COALESCE(e.employment_status, "")) = "casual"',
        ],
        'employee-job-order' => [
            'label' => 'Job Order Employees',
            'description' => 'Employees engaged through job order arrangements.',
            'where' => 'LOWER(COALESCE(e.employment_status, "")) IN ("job order", "jo")',
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
        ],
        'employee-retired' => [
            'label' => 'Retired Employees',
            'description' => 'Employees whose record status is retired.',
            'where' => 'LOWER(COALESCE(e.status, "")) = "retired"',
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
        'employee-without-email' => [
            'label' => 'Employees without Email',
            'description' => 'Employees missing a usable e-mail address on their profile.',
            'where' => '(e.email IS NULL OR TRIM(e.email) = "")',
            'dateExpression' => null,
            'columns' => [
                ['employeeId', 'Employee ID'],
                ['employeeName', 'Employee Name'],
                ['division', 'Division'],
                ['phone', 'Phone'],
                ['status', 'Status'],
            ],
        ],
        'employee-without-government-ids' => [
            'label' => 'Employees without Government IDs',
            'description' => 'Employees missing one or more of their GSIS, Pag-IBIG, PhilHealth, or TIN numbers.',
            'where' => '(COALESCE(TRIM(e.emp_gsis_id_no), "") = ""
                OR COALESCE(TRIM(e.emp_pagibig_id_no), "") = ""
                OR COALESCE(TRIM(e.emp_philhealth_id_no), "") = ""
                OR COALESCE(TRIM(e.tin_no), "") = "")',
            'dateExpression' => null,
            'columns' => [
                ['employeeId', 'Employee ID'],
                ['employeeName', 'Employee Name'],
                ['division', 'Division'],
                ['gsisNo', 'GSIS No.'],
                ['pagibigNo', 'Pag-IBIG No.'],
                ['philhealthNo', 'PhilHealth No.'],
                ['tinNo', 'TIN'],
            ],
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
        'label' => 'Employees by Designation',
        'description' => 'Employee headcount grouped by position or designation.',
        'requiredTables' => ['employees', 'designations', 'divisions'],
        'searchExpressions' => ['des.name', 'd.name'],
        'columns' => [
            ['position', 'Designation'],
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
                COALESCE(NULLIF(TRIM(e.employment_status), ""), "Unspecified") AS employmentStatus,
                COUNT(e.id) AS employees,
                SUM(CASE WHEN LOWER(e.status) = "active" THEN 1 ELSE 0 END) AS activeEmployees,
                ROUND(AVG(e.basic_salary), 2) AS averageSalary
            FROM employees e
            WHERE e.is_archived = 0
            GROUP BY COALESCE(NULLIF(TRIM(e.employment_status), ""), "Unspecified")',
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
        'employmentStatus' => 'e.employment_status',
        'payrollYear' => 'YEAR(p.payroll_date)',
        'payrollMonth' => 'MONTH(p.payroll_date)',
        'status' => 'p.status',
    ];
    $payrollJoins = 'FROM Payroll p
            LEFT JOIN employees e ON e.id = p.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id';

    $definitions['payroll-report'] = [
        'label' => 'Payroll Register',
        'description' => 'Payroll summaries including gross pay, allowances, deductions, net pay, and status.',
        'category' => 'payroll',
        'requiredTables' => ['Payroll', 'employees', 'divisions'],
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

    $definitions['payroll-released'] = [
        'label' => 'Released Payroll',
        'description' => 'Payroll runs already released, paid, or posted within the selected period.',
        'category' => 'payroll',
        'requiredTables' => ['Payroll', 'employees', 'divisions'],
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
            WHERE LOWER(COALESCE(p.status, "")) IN ("released", "paid", "posted", "completed")',
        'orderBy' => 'p.payroll_date DESC, employeeName ASC',
        'filters' => $payrollFilters,
    ];

    $definitions['payroll-pending'] = [
        'label' => 'Pending Payroll',
        'description' => 'Payroll runs still awaiting review, approval, or release.',
        'category' => 'payroll',
        'requiredTables' => ['Payroll', 'employees', 'divisions'],
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
            WHERE LOWER(COALESCE(p.status, "")) NOT IN ("released", "paid", "posted", "completed", "cancelled", "archived")',
        'orderBy' => 'p.payroll_date DESC, employeeName ASC',
        'filters' => $payrollFilters,
    ];

    $definitions['payroll-by-division'] = [
        'label' => 'Payroll by Division',
        'description' => 'Total payroll expense aggregated per division.',
        'category' => 'payroll',
        'requiredTables' => ['Payroll', 'employees', 'divisions'],
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
        'requiredTables' => ['Payroll', 'employees', 'divisions'],
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
        'requiredTables' => ['Payroll'],
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
        'sql' => 'SELECT
                DATE_FORMAT(p.payroll_date, "%Y-%m") AS period,
                COUNT(p.payroll_id) AS payrollRuns,
                COUNT(DISTINCT p.employee_id) AS employees,
                ROUND(SUM(p.gross_pay), 2) AS grossPay,
                ROUND(SUM(p.total_allowance), 2) AS totalAllowance,
                ROUND(SUM(p.total_deduction), 2) AS totalDeduction,
                ROUND(SUM(p.net_pay), 2) AS netPay
            FROM Payroll p
            GROUP BY DATE_FORMAT(p.payroll_date, "%Y-%m")',
        'orderBy' => 'period DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
    ];

    $definitions['payroll-deductions'] = [
        'label' => 'Payroll Deductions',
        'description' => 'Itemised deductions applied to payroll runs, grouped by deduction type.',
        'category' => 'payroll',
        // The catalog is one table per deduction family; the query unions them under the column
        // names it was written against.
        'requiredTables' => array_merge(
            ['PayrollDeduction', 'Payroll'],
            array_column(DEDUCTION_FAMILIES, 'table')
        ),
        'dateExpression' => 'p.payroll_date',
        'searchExpressions' => ['dt.deduction_name', 'dt.category_name'],
        'columns' => reports_columns([
            ['deductionName', 'Deduction'],
            ['category', 'Category'],
            ['records', 'Records'],
            ['totalAmount', 'Total Amount'],
        ]),
        'sql' => 'SELECT
                dt.deduction_name AS deductionName,
                dt.category_name AS category,
                COUNT(pd.payroll_id) AS records,
                ROUND(SUM(pd.amount), 2) AS totalAmount
            FROM PayrollDeduction pd
            INNER JOIN ' . deduction_catalog_type_union_sql() . ' dt
                    ON dt.deduction_type_id = pd.deduction_type_id
            INNER JOIN Payroll p ON p.payroll_id = pd.payroll_id
            GROUP BY dt.deduction_type_id, dt.deduction_name, dt.category_name',
        'orderBy' => 'totalAmount DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
    ];

    $definitions['payroll-net-pay-summary'] = [
        'label' => 'Net Pay Summary',
        'description' => 'Net pay totals per payroll status for the selected period.',
        'category' => 'payroll',
        'requiredTables' => ['Payroll'],
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
            FROM Payroll p
            GROUP BY COALESCE(NULLIF(TRIM(p.status), ""), "Unspecified")',
        'orderBy' => 'netPay DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
    ];

    // ---------------------------------------------------------------
    // Leave reports
    // ---------------------------------------------------------------
    $leaveFilters = [
        'divisionId' => 'e.division_id',
        'employmentStatus' => 'e.employment_status',
        'leaveTypeId' => 'lr.leave_type_id',
        'status' => 'lr.status',
    ];
    $leaveJoins = 'FROM leave_requests lr
            INNER JOIN employees e ON e.id = lr.employee_id
            INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
            LEFT JOIN divisions d ON d.id = e.division_id';
    $leaveColumns = [
        ['employeeName', 'Employee Name'],
        ['division', 'Division'],
        ['leaveType', 'Leave Type'],
        ['startDate', 'Start Date'],
        ['endDate', 'End Date'],
        ['days', 'Days'],
        ['status', 'Status'],
    ];
    $leaveSelect = 'SELECT
                lr.leave_request_id AS id,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                lt.name AS leaveType,
                lr.start_date AS startDate,
                lr.end_date AS endDate,
                lr.total_days AS days,
                lr.status
            ' . $leaveJoins;

    $leaveVariants = [
        'leave-report' => ['label' => 'Leave Report', 'description' => 'All leave applications with covered dates, total days, and approval status.', 'where' => ''],
        'leave-filed' => ['label' => 'Filed Leave', 'description' => 'Every leave application filed within the selected period.', 'where' => ''],
        'leave-approved' => ['label' => 'Approved Leave', 'description' => 'Leave applications that completed the approval workflow.', 'where' => 'LOWER(lr.status) = "approved"'],
        'leave-rejected' => ['label' => 'Rejected Leave', 'description' => 'Leave applications declined by an approver.', 'where' => 'LOWER(lr.status) = "rejected"'],
        'leave-pending' => ['label' => 'Pending Leave', 'description' => 'Leave applications still awaiting review or approval.', 'where' => 'LOWER(lr.status) IN ("pending", "reviewed")'],
        'leave-cancelled' => ['label' => 'Cancelled Leave', 'description' => 'Leave applications cancelled before or after approval.', 'where' => 'LOWER(lr.status) = "cancelled"'],
    ];

    foreach ($leaveVariants as $key => $options) {
        $definitions[$key] = [
            'label' => $options['label'],
            'description' => $options['description'],
            'category' => 'leave',
            'requiredTables' => ['leave_requests', 'leave_types', 'employees'],
            'dateExpression' => 'lr.start_date',
            'searchExpressions' => [$employeeName, 'lt.name', 'lr.status', 'lr.reason', 'd.name'],
            'columns' => reports_columns($leaveColumns),
            'sql' => $leaveSelect . ($options['where'] !== '' ? ' WHERE ' . $options['where'] : ''),
            'orderBy' => 'lr.start_date DESC, employeeName ASC',
            'filters' => $leaveFilters,
        ];
    }

    $definitions['leave-monetized'] = [
        'label' => 'Monetized Leave',
        'description' => 'Leave monetization requests with computed amounts and approval status.',
        'category' => 'leave',
        'requiredTables' => ['leave_monetization_requests', 'employees', 'leave_types'],
        'dateExpression' => 'lm.date_filed',
        'searchExpressions' => [$employeeName, 'lt.name', 'lm.status'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['leaveType', 'Leave Type'],
            ['dateFiled', 'Date Filed'],
            ['numberOfDays', 'Days'],
            ['dailyRate', 'Daily Rate'],
            ['amount', 'Estimated Amount'],
            ['status', 'Status'],
        ]),
        'sql' => 'SELECT
                lm.id,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                lt.name AS leaveType,
                lm.date_filed AS dateFiled,
                lm.number_of_days AS numberOfDays,
                lm.daily_rate AS dailyRate,
                lm.estimated_amount AS amount,
                lm.status
            FROM leave_monetization_requests lm
            INNER JOIN employees e ON e.id = lm.employee_id
            LEFT JOIN leave_types lt ON lt.leave_type_id = lm.leave_type_id
            LEFT JOIN divisions d ON d.id = e.division_id',
        'orderBy' => 'lm.date_filed DESC, employeeName ASC',
        'filters' => [
            'divisionId' => 'e.division_id',
            'status' => 'lm.status',
        ],
    ];

    $definitions['leave-balance'] = [
        'label' => 'Leave Balance',
        'description' => 'Remaining leave credits per employee and leave type for the current year.',
        'category' => 'leave',
        'requiredTables' => ['leave_credits', 'leave_types', 'employees'],
        'dateExpression' => null,
        'searchExpressions' => [$employeeName, 'lt.name'],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['leaveType', 'Leave Type'],
            ['year', 'Year'],
            ['totalCredits', 'Total Credits'],
            ['usedCredits', 'Used'],
            ['remainingCredits', 'Remaining'],
        ]),
        'sql' => 'SELECT
                lc.leave_credits_id AS id,
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                lt.name AS leaveType,
                lc.year,
                lc.total_credits AS totalCredits,
                lc.used_credits AS usedCredits,
                lc.remaining_credits AS remainingCredits
            FROM leave_credits lc
            INNER JOIN employees e ON e.id = lc.employee_id
            INNER JOIN leave_types lt ON lt.leave_type_id = lc.leave_type_id
            LEFT JOIN divisions d ON d.id = e.division_id
            WHERE e.is_archived = 0',
        'orderBy' => 'employeeName ASC, lt.name ASC',
        'filters' => [
            'divisionId' => 'e.division_id',
            'leaveTypeId' => 'lc.leave_type_id',
        ],
    ];

    $definitions['leave-utilization'] = [
        'label' => 'Leave Utilization',
        'description' => 'Approved leave days consumed per leave type.',
        'category' => 'leave',
        'requiredTables' => ['leave_requests', 'leave_types', 'employees'],
        'dateExpression' => 'lr.start_date',
        'searchExpressions' => ['lt.name'],
        'columns' => reports_columns([
            ['leaveType', 'Leave Type'],
            ['requests', 'Requests'],
            ['employees', 'Employees'],
            ['totalDays', 'Total Days'],
            ['averageDays', 'Avg. Days / Request'],
        ]),
        'sql' => 'SELECT
                lt.name AS leaveType,
                COUNT(lr.leave_request_id) AS requests,
                COUNT(DISTINCT lr.employee_id) AS employees,
                ROUND(SUM(lr.total_days), 2) AS totalDays,
                ROUND(AVG(lr.total_days), 2) AS averageDays
            ' . $leaveJoins . '
            WHERE LOWER(lr.status) = "approved"
            GROUP BY lt.leave_type_id, lt.name',
        'orderBy' => 'totalDays DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => $leaveFilters,
    ];

    $definitions['leave-by-division'] = [
        'label' => 'Leave by Division',
        'description' => 'Leave volume and approval outcomes grouped per division.',
        'category' => 'leave',
        'requiredTables' => ['leave_requests', 'leave_types', 'employees', 'divisions'],
        'dateExpression' => 'lr.start_date',
        'searchExpressions' => ['d.name'],
        'columns' => reports_columns([
            ['division', 'Division'],
            ['requests', 'Requests'],
            ['approved', 'Approved'],
            ['pending', 'Pending'],
            ['rejected', 'Rejected'],
            ['totalDays', 'Total Days'],
        ]),
        'sql' => 'SELECT
                COALESCE(d.name, "Unassigned") AS division,
                COUNT(lr.leave_request_id) AS requests,
                SUM(CASE WHEN LOWER(lr.status) = "approved" THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN LOWER(lr.status) IN ("pending", "reviewed") THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN LOWER(lr.status) = "rejected" THEN 1 ELSE 0 END) AS rejected,
                ROUND(SUM(lr.total_days), 2) AS totalDays
            ' . $leaveJoins . '
            GROUP BY COALESCE(d.name, "Unassigned")',
        'orderBy' => 'requests DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => $leaveFilters,
    ];

    $definitions['leave-by-employee'] = [
        'label' => 'Leave by Employee',
        'description' => 'Leave requests and days consumed summarised per employee.',
        'category' => 'leave',
        'requiredTables' => ['leave_requests', 'leave_types', 'employees'],
        'dateExpression' => 'lr.start_date',
        'searchExpressions' => [$employeeName],
        'columns' => reports_columns([
            ['employeeName', 'Employee Name'],
            ['division', 'Division'],
            ['requests', 'Requests'],
            ['approved', 'Approved'],
            ['totalDays', 'Total Days'],
        ]),
        'sql' => 'SELECT
                ' . $employeeName . ' AS employeeName,
                COALESCE(d.name, "Unassigned") AS division,
                COUNT(lr.leave_request_id) AS requests,
                SUM(CASE WHEN LOWER(lr.status) = "approved" THEN 1 ELSE 0 END) AS approved,
                ROUND(SUM(lr.total_days), 2) AS totalDays
            ' . $leaveJoins . '
            GROUP BY lr.employee_id, employeeName, division',
        'orderBy' => 'totalDays DESC',
        'isAggregate' => true,
        'filterBefore' => ' GROUP BY ',
        'filters' => $leaveFilters,
    ];

    // ---------------------------------------------------------------
    // Attendance reports
    // ---------------------------------------------------------------
    $attendanceFilters = [
        'divisionId' => 'e.division_id',
        'employmentStatus' => 'e.employment_status',
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
            WHERE doa.is_archived = 0',
        'orderBy' => 'doa.created_at DESC, doa.assignment_id DESC',
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
            $before .= stripos($before, ' WHERE ') === false ? ' WHERE ' : ' AND ';
            $sql = $before . implode(' AND ', $whereClauses) . ' ' . $after;
        } else {
            $sql .= stripos($sql, ' WHERE ') === false ? ' WHERE ' : ' AND ';
            $sql .= implode(' AND ', $whereClauses);
        }
    }

    if (!empty($definition['orderBy'])) {
        $sql .= ' ORDER BY ' . $definition['orderBy'];
    }

    return [$sql, $params];
}

function reports_fetch_rows(PDO $pdo, array $definition, array $dateWindow, string $search, array $activeFilters = []): array
{
    if (!reports_required_tables_exist($pdo, $definition)) {
        return [];
    }

    [$sql, $params] = reports_add_filters($definition, $dateWindow, $search, $activeFilters);
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return array_map(static function (array $row): array {
        foreach ($row as $key => $value) {
            if ($value === null) {
                $row[$key] = 'N/A';
            }
        }

        return $row;
    }, $statement->fetchAll());
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

        $context = function_exists('hris_audit_request_context')
            ? hris_audit_request_context()
            : ['ipAddress' => null, 'location' => null, 'device' => null, 'browser' => null, 'os' => null, 'userAgent' => null];

        $userId = isset($user['id']) ? (int)$user['id'] : null;
        $detailsJson = function_exists('hris_audit_details_json')
            ? hris_audit_details_json($details, $context)
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
        $metric('LOWER(COALESCE(e.employment_status, "")) IN ("job order", "jo")', 'clipboard-list', 'Job Order Employees', 'jobOrderEmployees'),
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
    if (!reports_table_exists($pdo, 'Payroll')) {
        return [];
    }

    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $join = 'FROM Payroll p LEFT JOIN employees e ON e.id = p.employee_id WHERE 1 = 1' . $scope;
    $released = ' AND LOWER(COALESCE(p.status, "")) IN ("released", "paid", "posted", "completed")';

    $thisMonth = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . '
            AND p.payroll_date >= DATE_FORMAT(CURDATE(), "%Y-%m-01")',
        $scopeParams
    );
    $lastMonth = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . '
            AND p.payroll_date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, "%Y-%m-01")
            AND p.payroll_date < DATE_FORMAT(CURDATE(), "%Y-%m-01")',
        $scopeParams
    );
    $thisYear = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . ' AND YEAR(p.payroll_date) = YEAR(CURDATE())',
        $scopeParams
    );
    $lastYear = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . $released . ' AND YEAR(p.payroll_date) = YEAR(CURDATE()) - 1',
        $scopeParams
    );
    $pending = reports_scalar(
        $pdo,
        'SELECT COALESCE(SUM(p.net_pay), 0) ' . $join . '
            AND LOWER(COALESCE(p.status, "")) NOT IN ("released", "paid", "posted", "completed", "cancelled", "archived")',
        $scopeParams
    );
    $pendingCount = reports_scalar(
        $pdo,
        'SELECT COUNT(p.payroll_id) ' . $join . '
            AND LOWER(COALESCE(p.status, "")) NOT IN ("released", "paid", "posted", "completed", "cancelled", "archived")',
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
        $statusKpi('pendingLeaves', 'Pending Leaves', 'calendar-clock', 'LOWER(lr.status) IN ("pending", "reviewed")'),
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

function reports_employee_growth(PDO $pdo, ?int $divisionId): array
{
    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $series = reports_month_series(12);
    $firstMonth = array_key_first($series);
    $windowStart = $firstMonth . '-01';

    foreach ($series as $key => $entry) {
        $series[$key]['hires'] = 0;
        $series[$key]['separations'] = 0;
        $series[$key]['headcount'] = 0;
    }

    $hires = reports_rows(
        $pdo,
        'SELECT DATE_FORMAT(e.date_hired, "%Y-%m") AS month, COUNT(e.id) AS total
         FROM employees e
         WHERE e.is_archived = 0 AND e.date_hired >= :window_start' . $scope . '
         GROUP BY DATE_FORMAT(e.date_hired, "%Y-%m")',
        array_merge($scopeParams, [':window_start' => $windowStart])
    );

    foreach ($hires as $row) {
        $month = (string)$row['month'];
        if (isset($series[$month])) {
            $series[$month]['hires'] = (int)$row['total'];
        }
    }

    // Separations have no dedicated date column, so the record's last update is
    // used as the best available proxy for when the status changed.
    $separations = reports_rows(
        $pdo,
        'SELECT DATE_FORMAT(e.updated_at, "%Y-%m") AS month, COUNT(e.id) AS total
         FROM employees e
         WHERE e.is_archived = 0
           AND LOWER(COALESCE(e.status, "")) IN ("resigned", "separated", "terminated", "retired")
           AND e.updated_at >= :window_start' . $scope . '
         GROUP BY DATE_FORMAT(e.updated_at, "%Y-%m")',
        array_merge($scopeParams, [':window_start' => $windowStart])
    );

    foreach ($separations as $row) {
        $month = (string)$row['month'];
        if (isset($series[$month])) {
            $series[$month]['separations'] = (int)$row['total'];
        }
    }

    foreach ($series as $key => $entry) {
        $monthEnd = (new DateTimeImmutable($key . '-01'))->modify('last day of this month')->format('Y-m-d');
        $series[$key]['headcount'] = (int)reports_scalar(
            $pdo,
            'SELECT COUNT(e.id) FROM employees e
             WHERE e.is_archived = 0 AND (e.date_hired IS NULL OR e.date_hired <= :month_end)' . $scope,
            array_merge($scopeParams, [':month_end' => $monthEnd])
        );
    }

    return array_values($series);
}

function reports_dashboard_charts(PDO $pdo, ?int $divisionId, array $dateWindow): array
{
    [$scope, $scopeParams] = reports_division_scope($divisionId);
    $charts = [];

    $charts['employeeGrowth'] = reports_employee_growth($pdo, $divisionId);

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
            'SELECT COALESCE(NULLIF(TRIM(e.employment_status), ""), "Unspecified") AS label, COUNT(e.id) AS value
             FROM employees e WHERE e.is_archived = 0' . $scope . '
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
    if (reports_table_exists($pdo, 'Payroll')) {
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
             FROM Payroll p
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
                 FROM Payroll p
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
                 FROM Payroll p
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

    if (reports_table_exists($pdo, 'PayrollDeduction') && reports_table_exists($pdo, 'other_deductions')) {
        $charts['deductionDistribution'] = array_map(
            static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (float)$row['value']],
            reports_rows(
                $pdo,
                'SELECT dt.deduction_name AS label, ROUND(SUM(pd.amount), 2) AS value
                 FROM PayrollDeduction pd
                 INNER JOIN ' . deduction_catalog_type_union_sql() . ' dt
                         ON dt.deduction_type_id = pd.deduction_type_id
                 GROUP BY dt.deduction_type_id, dt.deduction_name
                 ORDER BY value DESC
                 LIMIT 10'
            )
        );
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
    if (reports_table_exists($pdo, 'ipcr')) {
        $charts['performanceByDivision'] = array_map(
            static fn (array $row): array => ['label' => (string)$row['label'], 'value' => (float)$row['value'], 'evaluations' => (int)$row['evaluations']],
            reports_rows(
                $pdo,
                'SELECT COALESCE(d.name, "Unassigned") AS label,
                        ROUND(AVG(i.final_rating), 3) AS value,
                        COUNT(i.ipcr_id) AS evaluations
                 FROM ipcr i
                 INNER JOIN employees e ON e.id = i.employee_id
                 LEFT JOIN divisions d ON d.id = e.division_id
                 WHERE i.is_archived = 0 AND i.final_rating IS NOT NULL' . $scope . '
                 GROUP BY label
                 ORDER BY value DESC
                 LIMIT 12',
                $scopeParams
            )
        );
    } else {
        $charts['performanceByDivision'] = [];
    }

    return $charts;
}

function reports_dashboard(PDO $pdo, array $query): array
{
    $divisionId = (int)reports_text($query['divisionId'] ?? '0');
    $divisionId = $divisionId > 0 ? $divisionId : null;
    $dateWindow = reports_date_window(
        reports_text($query['dateRange'] ?? 'last30'),
        $query['customStart'] ?? null,
        $query['customEnd'] ?? null
    );

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
        'availability' => [
            'payroll' => reports_table_exists($pdo, 'Payroll'),
            'leave' => reports_table_exists($pdo, 'leave_requests'),
            'attendance' => reports_table_exists($pdo, 'attendance_daily_records'),
            'performance' => reports_table_exists($pdo, 'ipcr'),
            'training' => reports_table_exists($pdo, 'training_seminars'),
            'recruitment' => reports_table_exists($pdo, 'applicants'),
        ],
    ];
}

// ===================================================================
// Filter options + catalog
// ===================================================================

function reports_filter_options(PDO $pdo): array
{
    $divisions = reports_rows($pdo, 'SELECT id, name, code FROM divisions WHERE is_archived = 0 ORDER BY name ASC');
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
        'SELECT DISTINCT TRIM(employment_status) AS value
         FROM employees
         WHERE is_archived = 0 AND COALESCE(TRIM(employment_status), "") <> ""
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
    $payrollYears = reports_table_exists($pdo, 'Payroll')
        ? reports_rows($pdo, 'SELECT DISTINCT YEAR(payroll_date) AS value FROM Payroll WHERE payroll_date IS NOT NULL ORDER BY value DESC')
        : [];

    return [
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

function reports_catalog(PDO $pdo): array
{
    $definitions = reports_definitions();
    $categoryLabels = reports_category_labels();
    $catalog = [];

    foreach ($definitions as $key => $definition) {
        $categoryKey = $definition['category'] ?? 'employee';

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

// ===================================================================
// Scheduled reports
// ===================================================================

function reports_ensure_schedule_table(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS report_schedules (
            id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
            name            VARCHAR(150)    NOT NULL,
            report_type     VARCHAR(100)    NOT NULL,
            frequency       ENUM("daily", "weekly", "monthly", "quarterly", "annually") NOT NULL DEFAULT "monthly",
            export_format   ENUM("pdf", "xlsx", "csv") NOT NULL DEFAULT "pdf",
            date_range      VARCHAR(40)     NOT NULL DEFAULT "lastMonth",
            recipients      TEXT            NULL,
            filters_json    TEXT            NULL,
            is_active       TINYINT(1)      NOT NULL DEFAULT 1,
            last_run_at     DATETIME        NULL,
            next_run_at     DATETIME        NULL,
            created_by      INT UNSIGNED    NULL,
            created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_report_schedules_active (is_active),
            KEY idx_report_schedules_next_run (next_run_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function reports_next_run_at(string $frequency): string
{
    $now = new DateTimeImmutable('tomorrow 07:00');

    return match ($frequency) {
        'daily' => $now->format('Y-m-d H:i:s'),
        'weekly' => (new DateTimeImmutable('next monday 07:00'))->format('Y-m-d H:i:s'),
        'quarterly' => (new DateTimeImmutable('first day of this month 07:00'))->modify('+3 months')->format('Y-m-d H:i:s'),
        'annually' => (new DateTimeImmutable('first day of january next year 07:00'))->format('Y-m-d H:i:s'),
        default => (new DateTimeImmutable('first day of next month 07:00'))->format('Y-m-d H:i:s'),
    };
}

function reports_schedule_row(array $row): array
{
    $filters = json_decode((string)($row['filters_json'] ?? ''), true);

    return [
        'id' => (int)$row['id'],
        'name' => (string)$row['name'],
        'reportType' => (string)$row['report_type'],
        'frequency' => (string)$row['frequency'],
        'exportFormat' => (string)$row['export_format'],
        'dateRange' => (string)$row['date_range'],
        'recipients' => array_values(array_filter(array_map('trim', explode(',', (string)($row['recipients'] ?? ''))))),
        'filters' => is_array($filters) ? $filters : [],
        'isActive' => (bool)$row['is_active'],
        'lastRunAt' => $row['last_run_at'] ?? null,
        'nextRunAt' => $row['next_run_at'] ?? null,
        'createdAt' => $row['created_at'] ?? null,
    ];
}

function reports_list_schedules(PDO $pdo): array
{
    reports_ensure_schedule_table($pdo);
    $definitions = reports_definitions();

    return array_map(static function (array $row) use ($definitions): array {
        $schedule = reports_schedule_row($row);
        $schedule['reportLabel'] = $definitions[$schedule['reportType']]['label'] ?? $schedule['reportType'];

        return $schedule;
    }, reports_rows($pdo, 'SELECT * FROM report_schedules ORDER BY is_active DESC, next_run_at ASC, id DESC'));
}

function reports_validate_schedule(array $body, array $definitions): array
{
    $name = substr(reports_text($body['name'] ?? ''), 0, 150);
    $reportType = reports_text($body['reportType'] ?? '');
    $frequency = strtolower(reports_text($body['frequency'] ?? 'monthly'));
    $exportFormat = strtolower(reports_text($body['exportFormat'] ?? 'pdf'));
    $dateRange = reports_text($body['dateRange'] ?? 'lastMonth');
    $recipients = $body['recipients'] ?? [];

    if ($name === '') {
        json_response(['success' => false, 'message' => 'Schedule name is required.'], 422);
    }

    if (!isset($definitions[$reportType])) {
        json_response(['success' => false, 'message' => 'Selected report type is invalid.'], 422);
    }

    if (!in_array($frequency, ['daily', 'weekly', 'monthly', 'quarterly', 'annually'], true)) {
        json_response(['success' => false, 'message' => 'Selected frequency is invalid.'], 422);
    }

    if (!in_array($exportFormat, ['pdf', 'xlsx', 'csv'], true)) {
        json_response(['success' => false, 'message' => 'Selected export format is invalid.'], 422);
    }

    if (is_string($recipients)) {
        $recipients = explode(',', $recipients);
    }

    $recipients = array_values(array_filter(
        array_map(static fn ($email): string => trim((string)$email), (array)$recipients),
        static fn (string $email): bool => $email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) !== false
    ));

    return [
        'name' => $name,
        'reportType' => $reportType,
        'frequency' => $frequency,
        'exportFormat' => $exportFormat,
        'dateRange' => $dateRange,
        'recipients' => implode(',', $recipients),
        'filters' => (string)json_encode(is_array($body['filters'] ?? null) ? $body['filters'] : []),
        'isActive' => !empty($body['isActive'] ?? true) ? 1 : 0,
    ];
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

    if (is_float($value)) {
        return number_format($value, 2, '.', '');
    }

    return (string)$value;
}

function reports_stream_csv(array $definition, array $rows): void
{
    $filename = reports_export_filename($definition['label'], 'csv');
    header_remove('Content-Type');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');

    $output = fopen('php://output', 'w');
    fputcsv($output, array_column($definition['columns'], 'label'));

    foreach ($rows as $row) {
        fputcsv($output, array_map(
            static fn (array $column): string => reports_cell_value($row, $column['key']),
            $definition['columns']
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

function reports_worksheet_xml(array $definition, array $rows, array $dateWindow): string
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
    $writeRow(['Records', (string)count($rows)]);
    $writeRow([]);
    $writeRow(array_column($definition['columns'], 'label'));

    foreach ($rows as $row) {
        $writeRow(array_map(
            static fn (array $column): string => reports_cell_value($row, $column['key']),
            $definition['columns']
        ));
    }

    $xml .= '</sheetData></worksheet>';

    return $xml;
}

function reports_stream_xlsx(array $definition, array $rows, array $dateWindow): void
{
    if (!class_exists(ZipArchive::class)) {
        reports_stream_csv($definition, $rows);
    }

    $filename = reports_export_filename($definition['label'], 'xlsx');
    $tempFile = tempnam(sys_get_temp_dir(), 'hris-report-');
    $zip = new ZipArchive();

    if ($tempFile === false || $zip->open($tempFile, ZipArchive::OVERWRITE) !== true) {
        reports_stream_csv($definition, $rows);
    }

    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>');
    $zip->addFromString('xl/worksheets/sheet1.xml', reports_worksheet_xml($definition, $rows, $dateWindow));
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

function reports_pdf_lines(array $definition, array $rows, array $dateWindow, array $summary): array
{
    $lines = [
        $definition['label'],
        'Generated: ' . date('Y-m-d H:i:s'),
        'Date Range: ' . $dateWindow['label'] . ' (' . $dateWindow['start'] . ' to ' . $dateWindow['end'] . ')',
        'Records: ' . count($rows),
    ];

    foreach ($summary['keyStatistics'] ?? [] as $statistic) {
        $lines[] = $statistic['label'] . ': ' . $statistic['value'];
    }

    $lines[] = '';
    $lines[] = implode(' | ', array_column($definition['columns'], 'label'));
    $lines[] = str_repeat('-', 132);

    foreach ($rows as $row) {
        $values = array_map(
            static fn (array $column): string => reports_cell_value($row, $column['key']),
            $definition['columns']
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

function reports_stream_pdf(array $definition, array $rows, array $dateWindow, array $summary): void
{
    $filename = reports_export_filename($definition['label'], 'pdf');
    $pdf = reports_build_pdf(reports_pdf_lines($definition, $rows, $dateWindow, $summary));

    header_remove('Content-Type');
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($pdf));
    echo $pdf;
    exit;
}

function reports_stream_export(string $format, array $definition, array $rows, array $dateWindow, array $summary): void
{
    if ($format === 'pdf') {
        reports_stream_pdf($definition, $rows, $dateWindow, $summary);
    }

    if ($format === 'xlsx') {
        reports_stream_xlsx($definition, $rows, $dateWindow);
    }

    reports_stream_csv($definition, $rows);
}

// ===================================================================
// Router
// ===================================================================

$requestMethod = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$action = strtolower(reports_text($_GET['action'] ?? ''));
$definitions = reports_definitions();

if ($action === 'schedules') {
    reports_ensure_schedule_table($pdo);

    if ($requestMethod === 'GET') {
        json_response([
            'success' => true,
            'schedules' => reports_list_schedules($pdo),
        ]);
    }

    if ($requestMethod === 'POST' || $requestMethod === 'PUT') {
        $body = read_json_body();
        $payload = reports_validate_schedule($body, $definitions);
        $scheduleId = (int)($body['id'] ?? $_GET['id'] ?? 0);

        if ($requestMethod === 'PUT' && $scheduleId > 0) {
            $statement = $pdo->prepare(
                'UPDATE report_schedules
                    SET name = :name,
                        report_type = :report_type,
                        frequency = :frequency,
                        export_format = :export_format,
                        date_range = :date_range,
                        recipients = :recipients,
                        filters_json = :filters_json,
                        is_active = :is_active,
                        next_run_at = :next_run_at
                  WHERE id = :id'
            );
            $statement->execute([
                ':name' => $payload['name'],
                ':report_type' => $payload['reportType'],
                ':frequency' => $payload['frequency'],
                ':export_format' => $payload['exportFormat'],
                ':date_range' => $payload['dateRange'],
                ':recipients' => $payload['recipients'],
                ':filters_json' => $payload['filters'],
                ':is_active' => $payload['isActive'],
                ':next_run_at' => reports_next_run_at($payload['frequency']),
                ':id' => $scheduleId,
            ]);

            reports_write_audit($pdo, $sessionUser, 'report.schedule_updated', 'Updated scheduled report "' . $payload['name'] . '".', [
                'reportType' => $payload['reportType'],
                'scheduleId' => $scheduleId,
            ]);
        } else {
            $statement = $pdo->prepare(
                'INSERT INTO report_schedules
                    (name, report_type, frequency, export_format, date_range, recipients, filters_json, is_active, next_run_at, created_by)
                 VALUES
                    (:name, :report_type, :frequency, :export_format, :date_range, :recipients, :filters_json, :is_active, :next_run_at, :created_by)'
            );
            $statement->execute([
                ':name' => $payload['name'],
                ':report_type' => $payload['reportType'],
                ':frequency' => $payload['frequency'],
                ':export_format' => $payload['exportFormat'],
                ':date_range' => $payload['dateRange'],
                ':recipients' => $payload['recipients'],
                ':filters_json' => $payload['filters'],
                ':is_active' => $payload['isActive'],
                ':next_run_at' => reports_next_run_at($payload['frequency']),
                ':created_by' => isset($sessionUser['id']) ? (int)$sessionUser['id'] : null,
            ]);
            $scheduleId = (int)$pdo->lastInsertId();

            reports_write_audit($pdo, $sessionUser, 'report.schedule_created', 'Created scheduled report "' . $payload['name'] . '".', [
                'reportType' => $payload['reportType'],
                'scheduleId' => $scheduleId,
                'frequency' => $payload['frequency'],
            ]);
        }

        json_response([
            'success' => true,
            'message' => 'Scheduled report saved.',
            'schedules' => reports_list_schedules($pdo),
        ]);
    }

    if ($requestMethod === 'DELETE') {
        $scheduleId = (int)($_GET['id'] ?? 0);

        if ($scheduleId <= 0) {
            json_response(['success' => false, 'message' => 'A schedule id is required.'], 422);
        }

        $statement = $pdo->prepare('DELETE FROM report_schedules WHERE id = :id');
        $statement->execute([':id' => $scheduleId]);

        reports_write_audit($pdo, $sessionUser, 'report.schedule_deleted', 'Deleted scheduled report #' . $scheduleId . '.', [
            'scheduleId' => $scheduleId,
        ]);

        json_response([
            'success' => true,
            'message' => 'Scheduled report deleted.',
            'schedules' => reports_list_schedules($pdo),
        ]);
    }

    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
}

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

if ($action === 'catalog') {
    json_response([
        'success' => true,
        'categories' => reports_catalog($pdo),
    ]);
}

if ($action === 'filters') {
    json_response([
        'success' => true,
        'filters' => reports_filter_options($pdo),
    ]);
}

if ($action === 'dashboard') {
    json_response([
        'success' => true,
        'dashboard' => reports_dashboard($pdo, $_GET),
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

if ($exportFormat !== '' && !in_array($exportFormat, ['pdf', 'xlsx', 'csv'], true)) {
    json_response([
        'success' => false,
        'message' => 'Selected export format is invalid.',
    ], 422);
}

$definition = $definitions[$reportType];
$dateWindow = reports_date_window($dateRange, $_GET['customStart'] ?? null, $_GET['customEnd'] ?? null);
$activeFilters = reports_active_filters($definition, $_GET);
$rows = reports_fetch_rows($pdo, $definition, $dateWindow, $search, $activeFilters);
$summary = reports_summary($definition, $rows, $dateWindow);
$tablesReady = reports_required_tables_exist($pdo, $definition);

if ($exportFormat !== '') {
    reports_write_audit($pdo, $sessionUser, 'report.exported', 'Exported "' . $definition['label'] . '" as ' . strtoupper($exportFormat) . '.', [
        'reportType' => $reportType,
        'reportLabel' => $definition['label'],
        'format' => $exportFormat,
        'records' => count($rows),
        'dateRangeLabel' => $dateWindow['label'],
        'filters' => array_map(static fn (array $filter): string => $filter['value'], $activeFilters),
    ]);

    reports_stream_export($exportFormat, $definition, $rows, $dateWindow, $summary);
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
        'rows' => $rows,
        'summary' => $summary,
        'dateRange' => $dateWindow,
        'available' => $tablesReady,
        'supportedFilters' => array_keys($definition['filters'] ?? []),
    ],
]);
