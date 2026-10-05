<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();
$roleKey = user_role_key($sessionUser);
$allowedRoles = ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'chief', 'planningofficer', 'cashier'];

if (!in_array($roleKey, $allowedRoles, true)) {
    json_response([
        'success' => false,
        'message' => 'Unauthorized access to analytics.',
    ], 403);
}

function analytics_table_exists(PDO $pdo, string $table): bool
{
    return function_exists('database_table_exists') && database_table_exists($pdo, $table);
}

/**
 * The division every figure on the dashboard is counted within, or null for a role that reads the
 * whole organization. A chief and a planning officer answer for one division, so theirs narrows to
 * it. HR Staff, the Regional Director, Admin, and the HR Head use organization-wide dashboard
 * figures, matching the "All Divisions / Organization-wide access" shown in their welcome card.
 *
 * Mirrors ANALYTICS_DIVISION_SCOPED_ROLE_KEYS in RoleAnalyticsOverview.jsx, which narrows the
 * client-side lists the same panel draws from.
 */
const ANALYTICS_DIVISION_SCOPED_ROLES = ['chief', 'planningofficer'];

function analytics_scope_division_id(PDO $pdo, array $user, string $roleKey): ?int
{
    if (!in_array($roleKey, ANALYTICS_DIVISION_SCOPED_ROLES, true)) {
        return null;
    }

    $division = trimmed_text($user['division'] ?? '');

    if ($division === '') {
        return 0;
    }

    // Native prepares are on (ATTR_EMULATE_PREPARES => false), so a named placeholder cannot be
    // reused across two markers — each one needs its own name or PDO throws "Invalid parameter
    // number" and the whole endpoint dies before it can emit JSON.
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

function analytics_employee_scope_condition(?int $divisionId, string $alias = '', string $parameterName = 'division_id'): string
{
    if ($divisionId === null) {
        return '';
    }

    $prefix = $alias !== '' ? $alias . '.' : '';

    return " AND {$prefix}division_id = :{$parameterName}";
}

function analytics_empty_for_missing_tables(PDO $pdo, array $tables, mixed $empty): mixed
{
    foreach ($tables as $table) {
        if (!analytics_table_exists($pdo, $table)) {
            return $empty;
        }
    }

    return null;
}

function get_role_distribution(PDO $pdo, ?int $divisionId): array
{
    if (($empty = analytics_empty_for_missing_tables($pdo, ['users', 'roles'], [])) !== null) {
        return $empty;
    }

    $params = [];

    if ($divisionId !== null) {
        if ($divisionId <= 0) {
            return [];
        }

        $sql = 'SELECT
                    r.name AS role_name,
                    COUNT(u.id) AS count,
                    ROUND(COUNT(u.id) * 100.0 / NULLIF(t.total_count, 0), 2) AS percentage
                FROM users u
                INNER JOIN roles r ON u.role_id = r.id
                INNER JOIN employees e ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
                CROSS JOIN (
                    SELECT COUNT(u2.id) AS total_count
                    FROM users u2
                    INNER JOIN employees e2 ON e2.email COLLATE utf8mb4_unicode_ci = u2.email COLLATE utf8mb4_unicode_ci
                    WHERE u2.is_archived = 0
                      AND e2.is_archived = 0
                      AND e2.division_id = :total_division_id
                ) t
                WHERE u.is_archived = 0
                  AND e.is_archived = 0
                  AND e.division_id = :division_id
                GROUP BY r.id, r.name, t.total_count
                ORDER BY count DESC';
        $params = [
            ':division_id' => $divisionId,
            ':total_division_id' => $divisionId,
        ];
    } else {
        $sql = 'SELECT
                    r.name AS role_name,
                    COUNT(u.id) AS count,
                    ROUND(COUNT(u.id) * 100.0 / NULLIF(t.total_count, 0), 2) AS percentage
                FROM users u
                INNER JOIN roles r ON u.role_id = r.id
                CROSS JOIN (
                    SELECT COUNT(id) AS total_count
                    FROM users
                    WHERE is_archived = 0
                ) t
                WHERE u.is_archived = 0
                GROUP BY r.id, r.name, t.total_count
                ORDER BY count DESC';
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return $statement->fetchAll();
}

/**
 * Job Order is legacy seed data — the employee form only ever creates Regular or Contract of
 * Service appointments — so the Employment Status card leaves it out rather than charting a
 * category the office no longer appoints under. Reports carry the same rule in
 * `reports_excluded_employment_status_sql()`; the two files never include each other, so the
 * condition is stated in both.
 */
function analytics_excluded_employment_status_sql(): string
{
    return ' AND LOWER(COALESCE(TRIM(employment_status), "")) NOT IN ("job order", "jo")';
}

/**
 * "Contractual" and "COS" are what rows saved before the Contract of Service rename still hold, so
 * the card folds them into the current label instead of charting the same appointment three times.
 * Reports repeat this in `reports_employment_status_label_sql()`.
 */
function analytics_employment_status_label_sql(string $column): string
{
    return 'CASE
                WHEN LOWER(COALESCE(TRIM(' . $column . '), "")) IN ("contractual", "contract of service", "cos")
                    THEN "Contract of Service"
                ELSE COALESCE(NULLIF(TRIM(' . $column . '), ""), "Not Specified")
            END';
}

function get_employment_status_distribution(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $rowScope = analytics_employee_scope_condition($divisionId, '', 'division_id');
    $totalScope = analytics_employee_scope_condition($divisionId, '', 'total_division_id');
    // The excluded rows leave the denominator too, so the slice percentages still add up to 100
    // against the headcount the card actually shows.
    $excluded = analytics_excluded_employment_status_sql();
    $label = analytics_employment_status_label_sql('employment_status');
    $sql = 'SELECT
                ' . $label . ' AS employment_status,
                COUNT(id) AS count,
                ROUND(COUNT(id) * 100.0 / NULLIF(t.total_count, 0), 2) AS percentage
            FROM employees
            CROSS JOIN (
                SELECT COUNT(id) AS total_count
                FROM employees
                WHERE is_archived = 0' . $totalScope . $excluded . '
            ) t
            WHERE is_archived = 0' . $rowScope . $excluded . '
            GROUP BY ' . $label . ', t.total_count
            ORDER BY count DESC';

    $statement = $pdo->prepare($sql);
    $params = $divisionId !== null ? [
        ':division_id' => $divisionId,
        ':total_division_id' => $divisionId,
    ] : [];
    $statement->execute($params);

    return $statement->fetchAll();
}

function get_attendance_trend(PDO $pdo, ?int $divisionId, int $days = 30): array
{
    if (($empty = analytics_empty_for_missing_tables($pdo, ['attendance_daily_records'], [])) !== null) {
        return $empty;
    }

    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $days = min(365, max(1, $days));
    $params = [':days' => $days];
    $scopeForRows = '';
    $scopeForTotal = '';

    if ($divisionId !== null) {
        $scopeForRows = ' AND e.division_id = :division_id';
        $scopeForTotal = ' AND e2.division_id = :total_division_id';
        $params[':division_id'] = $divisionId;
        $params[':total_division_id'] = $divisionId;
    }

    /*
     * Present / absent / late are counted with the same expressions the Attendance Trend report
     * uses (see $charts['attendanceTrend'] in reports.php) so the dashboard card and the report
     * plot identical numbers. The `time_in IS NOT NULL` filter this query used to carry is gone on
     * purpose: it would have excluded every non-attending record and pinned absences to zero.
     */
    $statement = $pdo->prepare(
        'SELECT
            adr.attendance_date,
            SUM(CASE WHEN LOWER(adr.status) = "present" THEN 1 ELSE 0 END) AS present_count,
            SUM(CASE WHEN LOWER(adr.status) = "absent" THEN 1 ELSE 0 END) AS absent_count,
            SUM(CASE WHEN adr.late_minutes > 0 THEN 1 ELSE 0 END) AS late_count,
            t.total_employees,
            ROUND(SUM(CASE WHEN LOWER(adr.status) = "present" THEN 1 ELSE 0 END) * 100.0 / NULLIF(t.total_employees, 0), 2) AS attendance_rate
         FROM attendance_daily_records adr
         INNER JOIN employees e ON e.id = adr.employee_id
         CROSS JOIN (
            SELECT COUNT(e2.id) AS total_employees
            FROM employees e2
            WHERE e2.is_archived = 0
              AND LOWER(e2.status) = "active"' . $scopeForTotal . '
         ) t
         WHERE adr.attendance_date >= DATE_SUB(CURDATE(), INTERVAL :days DAY)
           AND e.is_archived = 0' . $scopeForRows . '
         GROUP BY adr.attendance_date, t.total_employees
         ORDER BY adr.attendance_date DESC'
    );
    $statement->execute($params);

    return $statement->fetchAll();
}

function get_pwd_distribution(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $params = [];
    $scope = '';

    if ($divisionId !== null) {
        $scope = ' AND d.id = :division_id';
        $params[':division_id'] = $divisionId;
    }

    $statement = $pdo->prepare(
        'SELECT
            d.name AS division_name,
            COUNT(CASE WHEN e.pwd = 1 THEN 1 END) AS pwd_count,
            COUNT(e.id) AS total_employees,
            ROUND(COUNT(CASE WHEN e.pwd = 1 THEN 1 END) * 100.0 / NULLIF(COUNT(e.id), 0), 2) AS pwd_percentage
         FROM divisions d
         LEFT JOIN employees e ON e.division_id = d.id AND e.is_archived = 0
         WHERE d.is_archived = 0' . $scope . '
         GROUP BY d.id, d.name
         ORDER BY pwd_count DESC, d.name ASC'
    );
    $statement->execute($params);

    return $statement->fetchAll();
}

function get_pwd_summary(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return ['pwd_count' => 0, 'total_employees' => 0, 'pwd_percentage' => 0];
    }

    $scope = analytics_employee_scope_condition($divisionId);
    $statement = $pdo->prepare(
        'SELECT
            COUNT(CASE WHEN pwd = 1 THEN 1 END) AS pwd_count,
            COUNT(id) AS total_employees,
            ROUND(COUNT(CASE WHEN pwd = 1 THEN 1 END) * 100.0 / NULLIF(COUNT(id), 0), 2) AS pwd_percentage
         FROM employees
         WHERE is_archived = 0' . $scope
    );
    $statement->execute($divisionId !== null ? [':division_id' => $divisionId] : []);

    return $statement->fetch() ?: ['pwd_count' => 0, 'total_employees' => 0, 'pwd_percentage' => 0];
}

function get_gender_distribution(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $rowScope = analytics_employee_scope_condition($divisionId, '', 'division_id');
    $totalScope = analytics_employee_scope_condition($divisionId, '', 'total_division_id');
    $sql = 'SELECT
                COALESCE(NULLIF(TRIM(gender), ""), "Not Specified") AS gender,
                COUNT(id) AS count,
                ROUND(COUNT(id) * 100.0 / NULLIF(t.total_count, 0), 2) AS percentage
            FROM employees
            CROSS JOIN (
                SELECT COUNT(id) AS total_count
                FROM employees
                WHERE is_archived = 0' . $totalScope . '
            ) t
            WHERE is_archived = 0' . $rowScope . '
            GROUP BY gender, t.total_count
            ORDER BY count DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($divisionId !== null ? [
        ':division_id' => $divisionId,
        ':total_division_id' => $divisionId,
    ] : []);

    return $statement->fetchAll();
}

function get_gender_distribution_by_division(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $params = [];
    $scope = '';

    if ($divisionId !== null) {
        $scope = ' WHERE d.id = :division_id';
        $params[':division_id'] = $divisionId;
    }

    $statement = $pdo->prepare(
        'SELECT
            d.id AS division_id,
            d.name AS division_name,
            COUNT(e.id) AS total_employees,
            SUM(CASE WHEN LOWER(TRIM(COALESCE(e.gender, ""))) = "male" THEN 1 ELSE 0 END) AS male_count,
            SUM(CASE WHEN LOWER(TRIM(COALESCE(e.gender, ""))) = "female" THEN 1 ELSE 0 END) AS female_count,
            SUM(CASE
                WHEN e.id IS NOT NULL
                 AND LOWER(TRIM(COALESCE(e.gender, ""))) NOT IN ("", "male", "female")
                THEN 1 ELSE 0
            END) AS other_count,
            SUM(CASE
                WHEN e.id IS NOT NULL
                 AND LOWER(TRIM(COALESCE(e.gender, ""))) = ""
                THEN 1 ELSE 0
            END) AS not_specified_count
         FROM divisions d
         LEFT JOIN employees e ON e.division_id = d.id AND e.is_archived = 0' . $scope . '
         GROUP BY d.id, d.name
         ORDER BY d.name ASC'
    );
    $statement->execute($params);

    return array_values(array_filter($statement->fetchAll(), static function (array $row): bool {
        return (int)($row['total_employees'] ?? 0) > 0;
    }));
}

function get_senior_citizen_distribution(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return ['senior_count' => 0, 'total_employees' => 0, 'senior_percentage' => 0, 'upcoming_retirement' => 0];
    }

    $scope = analytics_employee_scope_condition($divisionId);
    $statement = $pdo->prepare(
        'SELECT
            COUNT(CASE WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) >= 60 THEN 1 END) AS senior_count,
            COUNT(id) AS total_employees,
            ROUND(COUNT(CASE WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) >= 60 THEN 1 END) * 100.0 / NULLIF(COUNT(id), 0), 2) AS senior_percentage,
            COUNT(CASE WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) BETWEEN 59 AND 60 THEN 1 END) AS upcoming_retirement
         FROM employees
         WHERE is_archived = 0
           AND date_of_birth IS NOT NULL' . $scope
    );
    $statement->execute($divisionId !== null ? [':division_id' => $divisionId] : []);

    return $statement->fetch() ?: ['senior_count' => 0, 'total_employees' => 0, 'senior_percentage' => 0, 'upcoming_retirement' => 0];
}

function get_age_group_distribution(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $rowScope = analytics_employee_scope_condition($divisionId, '', 'division_id');
    $totalScope = analytics_employee_scope_condition($divisionId, '', 'total_division_id');
    $statement = $pdo->prepare(
        'SELECT
            age_group,
            COUNT(*) AS count,
            ROUND(COUNT(*) * 100.0 / NULLIF(t.total_count, 0), 2) AS percentage
         FROM (
            SELECT
                CASE
                    WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) BETWEEN 18 AND 25 THEN "18-25"
                    WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) BETWEEN 26 AND 35 THEN "26-35"
                    WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) BETWEEN 36 AND 45 THEN "36-45"
                    WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) BETWEEN 46 AND 55 THEN "46-55"
                    WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) BETWEEN 56 AND 65 THEN "56-65"
                    WHEN TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) > 65 THEN "65+"
                    ELSE "Unknown"
                END AS age_group
            FROM employees
            WHERE is_archived = 0
              AND date_of_birth IS NOT NULL' . $rowScope . '
         ) grouped
         CROSS JOIN (
            SELECT COUNT(id) AS total_count
            FROM employees
            WHERE is_archived = 0
              AND date_of_birth IS NOT NULL' . $totalScope . '
         ) t
         GROUP BY age_group, t.total_count
         ORDER BY
            CASE age_group
                WHEN "18-25" THEN 1
                WHEN "26-35" THEN 2
                WHEN "36-45" THEN 3
                WHEN "46-55" THEN 4
                WHEN "56-65" THEN 5
                WHEN "65+" THEN 6
                ELSE 7
            END'
    );
    $statement->execute($divisionId !== null ? [
        ':division_id' => $divisionId,
        ':total_division_id' => $divisionId,
    ] : []);

    return $statement->fetchAll();
}

function get_department_headcount(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $params = [];
    $scope = '';

    if ($divisionId !== null) {
        $scope = ' AND d.id = :division_id';
        $params[':division_id'] = $divisionId;
        $params[':total_division_id'] = $divisionId;
    }

    $statement = $pdo->prepare(
        'SELECT
            d.name AS division_name,
            d.code AS division_code,
            COUNT(e.id) AS employee_count,
            ROUND(COUNT(e.id) * 100.0 / NULLIF(t.total_count, 0), 2) AS percentage
         FROM divisions d
         LEFT JOIN employees e ON d.id = e.division_id AND e.is_archived = 0
         CROSS JOIN (
            SELECT COUNT(id) AS total_count
            FROM employees
            WHERE is_archived = 0' . analytics_employee_scope_condition($divisionId, '', 'total_division_id') . '
         ) t
         WHERE d.is_archived = 0' . $scope . '
         GROUP BY d.id, d.name, d.code, t.total_count
         ORDER BY employee_count DESC, d.name ASC'
    );
    $statement->execute($params);

    return $statement->fetchAll();
}

function get_leave_utilization(PDO $pdo, ?int $divisionId): array
{
    if (($empty = analytics_empty_for_missing_tables($pdo, ['leave_requests', 'leave_types'], [])) !== null) {
        return $empty;
    }

    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $scope = $divisionId !== null ? ' AND e.division_id = :division_id' : '';
    $statement = $pdo->prepare(
        'SELECT
            lt.name AS leave_type_name,
            COUNT(lr.leave_request_id) AS request_count,
            COALESCE(SUM(lr.total_days), 0) AS total_days,
            ROUND(AVG(lr.total_days), 2) AS avg_days_per_request
         FROM leave_requests lr
         INNER JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
         INNER JOIN employees e ON e.id = lr.employee_id
         WHERE LOWER(lr.status) = "approved"
           AND lr.start_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
           AND e.is_archived = 0' . $scope . '
         GROUP BY lt.leave_type_id, lt.name
         ORDER BY total_days DESC
         LIMIT 5'
    );
    $statement->execute($divisionId !== null ? [':division_id' => $divisionId] : []);

    return $statement->fetchAll();
}

function get_payroll_summary(PDO $pdo, ?int $divisionId): array
{
    if (($empty = analytics_empty_for_missing_tables($pdo, ['payroll'], [])) !== null) {
        return $empty;
    }

    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $scope = $divisionId !== null ? ' AND e.division_id = :division_id' : '';
    $statement = $pdo->prepare(
        'SELECT
            COUNT(DISTINCT p.employee_id) AS employee_count,
            ROUND(COALESCE(SUM(p.gross_pay), 0), 2) AS total_gross,
            ROUND(COALESCE(SUM(p.total_deduction), 0), 2) AS total_deductions,
            ROUND(COALESCE(SUM(p.net_pay), 0), 2) AS total_net_pay,
            DATE_FORMAT(p.payroll_date, "%M %Y") AS period
         FROM payroll p
         LEFT JOIN employees e ON e.id = p.employee_id
         WHERE YEAR(p.payroll_date) = YEAR(CURDATE())
           AND MONTH(p.payroll_date) = MONTH(CURDATE())
           AND COALESCE(p.status, "") <> "Archived"' . $scope . '
         GROUP BY YEAR(p.payroll_date), MONTH(p.payroll_date)
         ORDER BY p.payroll_date DESC
         LIMIT 1'
    );
    $statement->execute($divisionId !== null ? [':division_id' => $divisionId] : []);

    return $statement->fetch() ?: [];
}

function get_total_employees(PDO $pdo, ?int $divisionId): int
{
    if ($divisionId !== null && $divisionId <= 0) {
        return 0;
    }

    $scope = analytics_employee_scope_condition($divisionId);
    $statement = $pdo->prepare('SELECT COUNT(id) FROM employees WHERE is_archived = 0' . $scope);
    $statement->execute($divisionId !== null ? [':division_id' => $divisionId] : []);

    return (int)$statement->fetchColumn();
}

function get_total_active_users(PDO $pdo, ?int $divisionId): int
{
    if (($empty = analytics_empty_for_missing_tables($pdo, ['users', 'roles', 'status'], 0)) !== null) {
        return $empty;
    }

    $params = [];
    $join = '';
    $scope = '';

    if ($divisionId !== null) {
        if ($divisionId <= 0) {
            return 0;
        }

        $join = ' INNER JOIN employees e ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci';
        $scope = ' AND e.is_archived = 0 AND e.division_id = :division_id';
        $params[':division_id'] = $divisionId;
    }

    $statement = $pdo->prepare(
        'SELECT COUNT(u.id)
         FROM users u' . $join . '
         WHERE u.is_archived = 0
           AND LOWER(u.status) = "active"' . $scope
    );
    $statement->execute($params);

    return (int)$statement->fetchColumn();
}

function get_average_age(PDO $pdo, ?int $divisionId): float
{
    if ($divisionId !== null && $divisionId <= 0) {
        return 0.0;
    }

    $scope = analytics_employee_scope_condition($divisionId);
    $statement = $pdo->prepare(
        'SELECT ROUND(AVG(TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE())), 1)
         FROM employees
         WHERE is_archived = 0
           AND date_of_birth IS NOT NULL' . $scope
    );
    $statement->execute($divisionId !== null ? [':division_id' => $divisionId] : []);

    return (float)$statement->fetchColumn();
}

/**
 * Monthly final-rating averages for the two Performance Management forms.
 *
 * IPCR belongs to an explicit review period, so its month is the period end. OPCR's free-text
 * period cannot be grouped safely, so its month is the date the rating was submitted (falling back
 * to its last saved date for legacy rows). Missing months stay null rather than becoming invented
 * zero ratings, and division-scoped dashboard roles see only their own division's records.
 */
function get_performance_management_analytics(
    PDO $pdo,
    ?int $divisionId,
    int $year,
    bool $allowLatestYearFallback = true
): array
{
    $points = [];

    for ($month = 1; $month <= 12; $month++) {
        $points[$month] = [
            'label' => date('M', mktime(0, 0, 0, $month, 1, $year)),
            'month' => $month,
            'ipcr' => null,
            'opcr' => null,
            'ipcr_evaluations' => 0,
            'opcr_evaluations' => 0,
        ];
    }

    $ipcrEvaluations = 0;
    $opcrEvaluations = 0;

    if ($divisionId !== null && $divisionId <= 0) {
        return [
            'year' => $year,
            'points' => array_values($points),
            'ipcr_evaluations' => 0,
            'opcr_evaluations' => 0,
        ];
    }

    $applyMonthlyRatings = static function (array &$target, string $series, array $rows): int {
        $total = 0;

        foreach ($rows as $row) {
            $month = (int)($row['month_number'] ?? 0);
            if (!isset($target[$month])) {
                continue;
            }

            $target[$month][$series] = $row['average_rating'] === null
                ? null
                : (float)$row['average_rating'];
            $evaluations = (int)($row['evaluations'] ?? 0);
            $target[$month][$series . '_evaluations'] = $evaluations;
            $total += $evaluations;
        }

        return $total;
    };

    $yearStart = sprintf('%d-01-01', $year);
    $nextYearStart = sprintf('%d-01-01', $year + 1);

    if (analytics_table_exists($pdo, 'ipcr') && analytics_table_exists($pdo, 'employees')) {
        $scope = $divisionId !== null ? ' AND e.division_id = :division_id' : '';
        $statement = $pdo->prepare(
            'SELECT
                MONTH(i.period_to) AS month_number,
                ROUND(AVG(COALESCE(NULLIF(i.a4_rating, 0), NULLIF(i.final_rating, 0))), 2) AS average_rating,
                COUNT(i.ipcr_id) AS evaluations
             FROM ipcr i
             INNER JOIN employees e ON e.id = i.employee_id
             WHERE i.is_archived = 0
               AND e.is_archived = 0
               AND i.period_to >= :year_start
               AND i.period_to < :next_year_start
               AND COALESCE(NULLIF(i.a4_rating, 0), NULLIF(i.final_rating, 0)) IS NOT NULL' . $scope . '
             GROUP BY MONTH(i.period_to)
             ORDER BY month_number ASC'
        );
        $params = [
            ':year_start' => $yearStart,
            ':next_year_start' => $nextYearStart,
        ];
        if ($divisionId !== null) {
            $params[':division_id'] = $divisionId;
        }
        $statement->execute($params);
        $ipcrEvaluations = $applyMonthlyRatings($points, 'ipcr', $statement->fetchAll());
    }

    if (
        analytics_table_exists($pdo, 'division_opcr_assignments')
        && ($divisionId === null || analytics_table_exists($pdo, 'divisions'))
    ) {
        $join = '';
        $scope = '';
        $params = [
            ':year_start' => $yearStart,
            ':next_year_start' => $nextYearStart,
        ];

        if ($divisionId !== null) {
            $join = ' INNER JOIN divisions d
                ON LOWER(TRIM(d.name)) = LOWER(TRIM(doa.division))
                OR LOWER(TRIM(d.code)) = LOWER(TRIM(doa.division))';
            $scope = ' AND d.is_archived = 0 AND d.id = :division_id';
            $params[':division_id'] = $divisionId;
        }

        $statement = $pdo->prepare(
            'SELECT
                MONTH(COALESCE(doa.submitted_at, doa.updated_at, doa.created_at)) AS month_number,
                ROUND(AVG(COALESCE(NULLIF(doa.a4_rating, 0), NULLIF(doa.final_rating, 0))), 2) AS average_rating,
                COUNT(doa.assignment_id) AS evaluations
             FROM division_opcr_assignments doa' . $join . '
             WHERE doa.is_archived = 0
               AND COALESCE(doa.submitted_at, doa.updated_at, doa.created_at) >= :year_start
               AND COALESCE(doa.submitted_at, doa.updated_at, doa.created_at) < :next_year_start
               AND COALESCE(NULLIF(doa.a4_rating, 0), NULLIF(doa.final_rating, 0)) IS NOT NULL' . $scope . '
             GROUP BY MONTH(COALESCE(doa.submitted_at, doa.updated_at, doa.created_at))
             ORDER BY month_number ASC'
        );
        $statement->execute($params);
        $opcrEvaluations = $applyMonthlyRatings($points, 'opcr', $statement->fetchAll());
    }

    // The dashboard year selector normally follows the current year. Historical source forms may
    // not have a rating in that year, so show the latest real performance period instead of an
    // empty chart. An explicitly selected year that contains ratings is always kept.
    if ($allowLatestYearFallback && $ipcrEvaluations === 0 && $opcrEvaluations === 0) {
        $availableYears = [];

        if (analytics_table_exists($pdo, 'ipcr') && analytics_table_exists($pdo, 'employees')) {
            $scope = $divisionId !== null ? ' AND e.division_id = :division_id' : '';
            $statement = $pdo->prepare(
                'SELECT MAX(YEAR(i.period_to))
                 FROM ipcr i
                 INNER JOIN employees e ON e.id = i.employee_id
                 WHERE i.is_archived = 0
                   AND e.is_archived = 0
                   AND COALESCE(NULLIF(i.a4_rating, 0), NULLIF(i.final_rating, 0)) IS NOT NULL' . $scope
            );
            $statement->execute($divisionId !== null ? [':division_id' => $divisionId] : []);
            $latestIpcrYear = (int)$statement->fetchColumn();
            if ($latestIpcrYear > 0) {
                $availableYears[] = $latestIpcrYear;
            }
        }

        if (
            analytics_table_exists($pdo, 'division_opcr_assignments')
            && ($divisionId === null || analytics_table_exists($pdo, 'divisions'))
        ) {
            $join = '';
            $scope = '';
            $params = [];
            if ($divisionId !== null) {
                $join = ' INNER JOIN divisions d
                    ON LOWER(TRIM(d.name)) = LOWER(TRIM(doa.division))
                    OR LOWER(TRIM(d.code)) = LOWER(TRIM(doa.division))';
                $scope = ' AND d.is_archived = 0 AND d.id = :division_id';
                $params[':division_id'] = $divisionId;
            }

            $statement = $pdo->prepare(
                'SELECT MAX(YEAR(COALESCE(doa.submitted_at, doa.updated_at, doa.created_at)))
                 FROM division_opcr_assignments doa' . $join . '
                 WHERE doa.is_archived = 0
                   AND COALESCE(NULLIF(doa.a4_rating, 0), NULLIF(doa.final_rating, 0)) IS NOT NULL' . $scope
            );
            $statement->execute($params);
            $latestOpcrYear = (int)$statement->fetchColumn();
            if ($latestOpcrYear > 0) {
                $availableYears[] = $latestOpcrYear;
            }
        }

        $latestYear = $availableYears === [] ? 0 : max($availableYears);
        if ($latestYear > 0 && $latestYear !== $year) {
            return get_performance_management_analytics($pdo, $divisionId, $latestYear, false);
        }
    }

    return [
        'year' => $year,
        'points' => array_values($points),
        'ipcr_evaluations' => $ipcrEvaluations,
        'opcr_evaluations' => $opcrEvaluations,
    ];
}

function analytics_payload(PDO $pdo, ?int $divisionId, int $year): array
{
    return [
        'role_distribution' => get_role_distribution($pdo, $divisionId),
        'employment_status' => get_employment_status_distribution($pdo, $divisionId),
        'attendance_trend' => get_attendance_trend($pdo, $divisionId, 30),
        'pwd_distribution' => get_pwd_distribution($pdo, $divisionId),
        'pwd_summary' => get_pwd_summary($pdo, $divisionId),
        'gender_distribution' => get_gender_distribution($pdo, $divisionId),
        'gender_by_division' => get_gender_distribution_by_division($pdo, $divisionId),
        'performance_management' => get_performance_management_analytics($pdo, $divisionId, $year),
        'senior_citizen' => get_senior_citizen_distribution($pdo, $divisionId),
        'age_group' => get_age_group_distribution($pdo, $divisionId),
        'department_headcount' => get_department_headcount($pdo, $divisionId),
        'leave_utilization' => get_leave_utilization($pdo, $divisionId),
        'payroll_summary' => get_payroll_summary($pdo, $divisionId),
        'total_employees' => get_total_employees($pdo, $divisionId),
        'total_active_users' => get_total_active_users($pdo, $divisionId),
        'average_age' => get_average_age($pdo, $divisionId),
    ];
}

/**
 * The dashboard must be ready before a user needs the full attendance, payroll and request
 * registries.  Keeping this deliberately to aggregate/card data prevents the dashboard from
 * downloading every historical row simply to display a handful of totals and charts.
 */
function analytics_dashboard_cards_payload(PDO $pdo, ?int $divisionId, int $year): array
{
    return [
        'role_distribution' => get_role_distribution($pdo, $divisionId),
        'employment_status' => get_employment_status_distribution($pdo, $divisionId),
        'attendance_trend' => get_attendance_trend($pdo, $divisionId, 30),
        'pwd_distribution' => get_pwd_distribution($pdo, $divisionId),
        'pwd_summary' => get_pwd_summary($pdo, $divisionId),
        'gender_distribution' => get_gender_distribution($pdo, $divisionId),
        'gender_by_division' => get_gender_distribution_by_division($pdo, $divisionId),
        'performance_management' => get_performance_management_analytics($pdo, $divisionId, $year),
        'senior_citizen' => get_senior_citizen_distribution($pdo, $divisionId),
        'age_group' => get_age_group_distribution($pdo, $divisionId),
        'total_employees' => get_total_employees($pdo, $divisionId),
        'total_active_users' => get_total_active_users($pdo, $divisionId),
        'average_age' => get_average_age($pdo, $divisionId),
    ];
}

function analytics_dashboard_months(int $year, string $valueKey): array
{
    $months = [];

    for ($month = 1; $month <= 12; $month++) {
        $months[$month] = [
            'label' => date('M', mktime(0, 0, 0, $month, 1, $year)),
            $valueKey => 0,
        ];
    }

    return $months;
}

function get_dashboard_division_summary(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $params = [];
    $scope = '';

    if ($divisionId !== null) {
        $scope = ' AND d.id = :division_id';
        $params[':division_id'] = $divisionId;
    }

    $statement = $pdo->prepare(
        'SELECT
            d.id,
            d.name,
            d.code,
            COUNT(DISTINCT e.id) AS employee_count,
            COUNT(DISTINCT des.id) AS total_designations
         FROM divisions d
         LEFT JOIN employees e ON e.division_id = d.id AND e.is_archived = 0
         LEFT JOIN designations des ON des.division_id = d.id AND des.is_archived = 0
         WHERE d.is_archived = 0' . $scope . '
         GROUP BY d.id, d.name, d.code
         ORDER BY d.name ASC'
    );
    $statement->execute($params);

    return $statement->fetchAll();
}

function get_dashboard_headcount_growth(PDO $pdo, ?int $divisionId, int $year): array
{
    $months = analytics_dashboard_months($year, 'headcount');

    if ($divisionId !== null && $divisionId <= 0) {
        return array_values($months);
    }

    $scope = analytics_employee_scope_condition($divisionId);
    $statement = $pdo->prepare(
        'SELECT MONTH(date_hired) AS month_number, COUNT(id) AS headcount
         FROM employees
         WHERE is_archived = 0
           AND date_hired >= :year_start
           AND date_hired < :next_year_start' . $scope . '
         GROUP BY MONTH(date_hired)'
    );
    $params = [
        ':year_start' => sprintf('%d-01-01', $year),
        ':next_year_start' => sprintf('%d-01-01', $year + 1),
    ];
    if ($divisionId !== null) {
        $params[':division_id'] = $divisionId;
    }
    $statement->execute($params);

    foreach ($statement->fetchAll() as $row) {
        $month = (int)($row['month_number'] ?? 0);
        if (isset($months[$month])) {
            $months[$month]['headcount'] = (int)($row['headcount'] ?? 0);
        }
    }

    return array_values($months);
}

function get_dashboard_payroll_expense_trend(PDO $pdo, ?int $divisionId, int $year): array
{
    $months = analytics_dashboard_months($year, 'expense');

    if (!analytics_table_exists($pdo, 'payroll') || ($divisionId !== null && $divisionId <= 0)) {
        return array_values($months);
    }

    $scope = $divisionId !== null ? ' AND e.division_id = :division_id' : '';
    $statement = $pdo->prepare(
        'SELECT MONTH(p.payroll_date) AS month_number,
                ROUND(COALESCE(SUM(COALESCE(p.net_pay, p.gross_pay, 0)), 0), 2) AS expense
         FROM payroll p
         INNER JOIN employees e ON e.id = p.employee_id
         WHERE p.payroll_date >= :year_start
           AND p.payroll_date < :next_year_start
           AND COALESCE(p.status, "") <> "Archived"
           AND e.is_archived = 0' . $scope . '
         GROUP BY MONTH(p.payroll_date)'
    );
    $params = [
        ':year_start' => sprintf('%d-01-01', $year),
        ':next_year_start' => sprintf('%d-01-01', $year + 1),
    ];
    if ($divisionId !== null) {
        $params[':division_id'] = $divisionId;
    }
    $statement->execute($params);

    foreach ($statement->fetchAll() as $row) {
        $month = (int)($row['month_number'] ?? 0);
        if (isset($months[$month])) {
            $months[$month]['expense'] = (float)($row['expense'] ?? 0);
        }
    }

    return array_values($months);
}

function analytics_dashboard_request_bucket(): array
{
    return [
        'leave' => 0,
        'travel' => 0,
        'compensatory' => 0,
        'total' => 0,
        'items' => [],
    ];
}

/**
 * The pending/approved dialogs need only the rows they display, not every field (and attachment)
 * from the management endpoints.  One union keeps the dashboard responsive while retaining the
 * same request details in those dialogs.
 */
function get_dashboard_request_summary(PDO $pdo, ?int $divisionId): array
{
    $result = [
        'pending' => analytics_dashboard_request_bucket(),
        'approved' => analytics_dashboard_request_bucket(),
    ];

    if (
        analytics_empty_for_missing_tables($pdo, ['leave_requests', 'leave_types', 'travel_orders', 'compensatory'], false) !== null
        || ($divisionId !== null && $divisionId <= 0)
    ) {
        return $result;
    }

    ensure_archive_columns($pdo, 'leave_requests');
    ensure_archive_columns($pdo, 'travel_orders');
    ensure_archive_columns($pdo, 'compensatory');

    $leaveScope = $divisionId !== null ? ' AND leave_employee.division_id = :leave_division_id' : '';
    $travelScope = $divisionId !== null ? ' AND travel_employee.division_id = :travel_division_id' : '';
    $compensatoryScope = $divisionId !== null ? ' AND compensatory_employee.division_id = :compensatory_division_id' : '';
    $sql = 'SELECT * FROM (
        SELECT
            "leave" AS request_type,
            lr.leave_request_id AS id,
            TRIM(CONCAT(leave_employee.first_name, " ", COALESCE(leave_employee.middle_name, ""), " ", leave_employee.last_name)) AS employee_name,
            leave_division.name AS division_name,
            lr.status COLLATE utf8mb4_unicode_ci AS status,
            lr.requested_at AS event_at,
            lt.name AS leave_type,
            lr.reason,
            "" AS destination,
            "" AS purpose,
            0 AS hours_applied,
            "" AS remarks
         FROM leave_requests lr
         INNER JOIN employees leave_employee ON leave_employee.id = lr.employee_id
         LEFT JOIN divisions leave_division ON leave_division.id = leave_employee.division_id
         LEFT JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         WHERE lr.is_archived = 0
           AND leave_employee.is_archived = 0
           AND LOWER(lr.status) IN ("pending", "endorsed", "reviewed", "approved")' . $leaveScope . '
        UNION ALL
        SELECT
            "travel" AS request_type,
            t.travel_order_id AS id,
            TRIM(CONCAT(travel_employee.first_name, " ", COALESCE(travel_employee.middle_name, ""), " ", travel_employee.last_name)) AS employee_name,
            travel_division.name AS division_name,
            t.status COLLATE utf8mb4_unicode_ci AS status,
            t.created_at AS event_at,
            "" AS leave_type,
            "" AS reason,
            t.destination,
            COALESCE(t.purpose, "") AS purpose,
            0 AS hours_applied,
            "" AS remarks
         FROM travel_orders t
         INNER JOIN employees travel_employee ON travel_employee.id = t.employee_id
         LEFT JOIN divisions travel_division ON travel_division.id = travel_employee.division_id
         WHERE t.is_archived = 0
           AND travel_employee.is_archived = 0
           AND LOWER(t.status) IN ("pending", "reviewed", "chief_reviewed", "approved")' . $travelScope . '
        UNION ALL
        SELECT
            "compensatory" AS request_type,
            c.id,
            TRIM(CONCAT(compensatory_employee.first_name, " ", COALESCE(compensatory_employee.middle_name, ""), " ", compensatory_employee.last_name)) AS employee_name,
            compensatory_division.name AS division_name,
            c.status COLLATE utf8mb4_unicode_ci AS status,
            c.created_at AS event_at,
            "" AS leave_type,
            "" AS reason,
            "" AS destination,
            "" AS purpose,
            c.hours_applied,
            COALESCE(c.remarks, "") AS remarks
         FROM compensatory c
         INNER JOIN employees compensatory_employee ON compensatory_employee.id = c.employee_id
         LEFT JOIN divisions compensatory_division ON compensatory_division.id = compensatory_employee.division_id
         WHERE c.is_archived = 0
           AND compensatory_employee.is_archived = 0
           AND LOWER(c.status) IN ("pending", "endorsed", "reviewed", "approved")' . $compensatoryScope . '
    ) dashboard_requests
    ORDER BY event_at DESC, id DESC';
    $statement = $pdo->prepare($sql);
    $params = [];
    if ($divisionId !== null) {
        $params = [
            ':leave_division_id' => $divisionId,
            ':travel_division_id' => $divisionId,
            ':compensatory_division_id' => $divisionId,
        ];
    }
    $statement->execute($params);

    foreach ($statement->fetchAll() as $row) {
        $bucket = strtolower(trim((string)($row['status'] ?? ''))) === 'approved' ? 'approved' : 'pending';
        $type = (string)($row['request_type'] ?? 'leave');
        if (!array_key_exists($type, $result[$bucket])) {
            continue;
        }

        $result[$bucket][$type]++;
        $result[$bucket]['total']++;
        $result[$bucket]['items'][] = [
            'id' => (int)($row['id'] ?? 0),
            'type' => $type,
            'employeeName' => trim((string)($row['employee_name'] ?? '')),
            'division' => trim((string)($row['division_name'] ?? '')),
            'status' => (string)($row['status'] ?? ''),
            'dateFiled' => $row['event_at'] ?? null,
            'requestedAt' => $row['event_at'] ?? null,
            'createdAt' => $row['event_at'] ?? null,
            'leaveType' => trim((string)($row['leave_type'] ?? '')),
            'reason' => (string)($row['reason'] ?? ''),
            'destination' => trim((string)($row['destination'] ?? '')),
            'purpose' => trim((string)($row['purpose'] ?? '')),
            'hoursApplied' => (float)($row['hours_applied'] ?? 0),
            'remarks' => trim((string)($row['remarks'] ?? '')),
        ];
    }

    return $result;
}

function get_dashboard_recent_activity(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $sections = [];
    $params = [];
    $scopeFor = static function (string $prefix, string $employeeAlias) use ($divisionId, &$params): string {
        if ($divisionId === null) {
            return '';
        }

        $parameter = ':' . $prefix . '_division_id';
        $params[$parameter] = $divisionId;
        return " AND {$employeeAlias}.division_id = {$parameter}";
    };

    if (analytics_table_exists($pdo, 'attendance_daily_records')) {
        ensure_archive_columns($pdo, 'attendance_daily_records');
        $sections[] = 'SELECT
            "Attendance" AS source,
            CONCAT("attendance-", adr.id) AS event_id,
            TRIM(CONCAT(attendance_employee.first_name, " ", COALESCE(attendance_employee.middle_name, ""), " ", attendance_employee.last_name)) AS employee_name,
            adr.status,
            COALESCE(adr.updated_at, adr.attendance_date) AS event_at,
            COALESCE(attendance_division.name, "") AS detail,
            0 AS amount
         FROM attendance_daily_records adr
         INNER JOIN employees attendance_employee ON attendance_employee.id = adr.employee_id
         LEFT JOIN divisions attendance_division ON attendance_division.id = attendance_employee.division_id
         WHERE adr.is_archived = 0
           AND attendance_employee.is_archived = 0' . $scopeFor('attendance', 'attendance_employee');
    }

    if (analytics_table_exists($pdo, 'leave_requests')) {
        ensure_archive_columns($pdo, 'leave_requests');
        $sections[] = 'SELECT
            "Leave" AS source,
            CONCAT("leave-", lr.leave_request_id) AS event_id,
            TRIM(CONCAT(leave_employee.first_name, " ", COALESCE(leave_employee.middle_name, ""), " ", leave_employee.last_name)) AS employee_name,
            lr.status,
            lr.updated_at AS event_at,
            COALESCE(leave_division.name, lt.name, "") AS detail,
            0 AS amount
         FROM leave_requests lr
         INNER JOIN employees leave_employee ON leave_employee.id = lr.employee_id
         LEFT JOIN divisions leave_division ON leave_division.id = leave_employee.division_id
         LEFT JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         WHERE lr.is_archived = 0
           AND leave_employee.is_archived = 0' . $scopeFor('leave', 'leave_employee');
    }

    if (analytics_table_exists($pdo, 'payroll')) {
        $sections[] = 'SELECT
            "Payroll" AS source,
            CONCAT("payroll-", p.payroll_id) AS event_id,
            TRIM(CONCAT(payroll_employee.first_name, " ", COALESCE(payroll_employee.middle_name, ""), " ", payroll_employee.last_name)) AS employee_name,
            COALESCE(p.status, "") AS status,
            p.payroll_date AS event_at,
            COALESCE(payroll_division.name, "") AS detail,
            COALESCE(p.net_pay, 0) AS amount
         FROM payroll p
         INNER JOIN employees payroll_employee ON payroll_employee.id = p.employee_id
         LEFT JOIN divisions payroll_division ON payroll_division.id = payroll_employee.division_id
         WHERE COALESCE(p.status, "") <> "Archived"
           AND payroll_employee.is_archived = 0' . $scopeFor('payroll', 'payroll_employee');
    }

    if (analytics_table_exists($pdo, 'travel_orders')) {
        ensure_archive_columns($pdo, 'travel_orders');
        $sections[] = 'SELECT
            "Travel Order" AS source,
            CONCAT("travel-", t.travel_order_id) AS event_id,
            TRIM(CONCAT(travel_employee.first_name, " ", COALESCE(travel_employee.middle_name, ""), " ", travel_employee.last_name)) AS employee_name,
            t.status,
            t.updated_at AS event_at,
            COALESCE(travel_division.name, t.destination, "") AS detail,
            0 AS amount
         FROM travel_orders t
         INNER JOIN employees travel_employee ON travel_employee.id = t.employee_id
         LEFT JOIN divisions travel_division ON travel_division.id = travel_employee.division_id
         WHERE t.is_archived = 0
           AND travel_employee.is_archived = 0' . $scopeFor('travel', 'travel_employee');
    }

    if (analytics_table_exists($pdo, 'pass_slip')) {
        ensure_archive_columns($pdo, 'pass_slip');
        /*
         * Blank until the QR workflow gave a pass slip a status worth reporting here. Read through a
         * column check rather than assumed, because this file never runs the pass slip migration --
         * a dashboard opened before anyone touched the module would otherwise query a column that
         * pass_slip.php has not created yet.
         */
        $passSlipStatus = database_column_exists($pdo, 'pass_slip', 'status')
            ? 'COALESCE(ps.status, "")'
            : '""';
        $sections[] = 'SELECT
            "Pass Slip" AS source,
            CONCAT("pass-slip-", ps.id) AS event_id,
            TRIM(CONCAT(pass_employee.first_name, " ", COALESCE(pass_employee.middle_name, ""), " ", pass_employee.last_name)) AS employee_name,
            ' . $passSlipStatus . ' AS status,
            ps.updated_at AS event_at,
            COALESCE(pass_division.name, ps.destination, "") AS detail,
            0 AS amount
         FROM pass_slip ps
         INNER JOIN employees pass_employee ON pass_employee.id = ps.employee_id
         LEFT JOIN divisions pass_division ON pass_division.id = pass_employee.division_id
         WHERE ps.is_archived = 0
           AND pass_employee.is_archived = 0' . $scopeFor('pass_slip', 'pass_employee');
    }

    if ($sections === []) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT * FROM (' . implode(' UNION ALL ', $sections) . ') dashboard_activity
         WHERE event_at IS NOT NULL
         ORDER BY event_at DESC, event_id DESC
         LIMIT 18'
    );
    $statement->execute($params);

    return array_map(static function (array $row): array {
        return [
            'id' => (string)($row['event_id'] ?? ''),
            'source' => (string)($row['source'] ?? 'Activity'),
            'employeeName' => trim((string)($row['employee_name'] ?? '')),
            'status' => trim((string)($row['status'] ?? '')),
            'occurredAt' => $row['event_at'] ?? null,
            'detail' => trim((string)($row['detail'] ?? '')),
            'amount' => (float)($row['amount'] ?? 0),
        ];
    }, $statement->fetchAll());
}

function analytics_dashboard_payload(PDO $pdo, ?int $divisionId, int $year): array
{
    return [
        'analytics' => analytics_dashboard_cards_payload($pdo, $divisionId, $year),
        'overview' => [
            'divisions' => get_dashboard_division_summary($pdo, $divisionId),
            'headcount_growth' => get_dashboard_headcount_growth($pdo, $divisionId, $year),
            'payroll_expense_trend' => get_dashboard_payroll_expense_trend($pdo, $divisionId, $year),
            'requests' => get_dashboard_request_summary($pdo, $divisionId),
            'recent_activity' => get_dashboard_recent_activity($pdo, $divisionId),
        ],
    ];
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    json_response([
        'success' => false,
        'message' => 'Only GET requests are allowed for analytics.',
    ], 405);
}

$divisionId = analytics_scope_division_id($pdo, $sessionUser, $roleKey);
$analyticsType = (string)($_GET['type'] ?? 'all');
$dashboardYear = min(2100, max(1990, (int)($_GET['year'] ?? date('Y'))));

try {
    $response = match ($analyticsType) {
        'role_distribution' => ['data' => get_role_distribution($pdo, $divisionId)],
        'employment_status' => ['data' => get_employment_status_distribution($pdo, $divisionId)],
        'attendance_trend' => ['data' => get_attendance_trend($pdo, $divisionId, (int)($_GET['days'] ?? 30))],
        'pwd_distribution' => ['data' => get_pwd_distribution($pdo, $divisionId), 'summary' => get_pwd_summary($pdo, $divisionId)],
        'gender_distribution' => ['data' => get_gender_distribution($pdo, $divisionId)],
        'performance_management' => ['data' => get_performance_management_analytics($pdo, $divisionId, $dashboardYear)],
        'senior_citizen' => ['data' => get_senior_citizen_distribution($pdo, $divisionId)],
        'age_group' => ['data' => get_age_group_distribution($pdo, $divisionId)],
        'department_headcount' => ['data' => get_department_headcount($pdo, $divisionId)],
        'leave_utilization' => ['data' => get_leave_utilization($pdo, $divisionId)],
        'payroll_summary' => ['data' => get_payroll_summary($pdo, $divisionId)],
        'dashboard' => [
            'data' => analytics_dashboard_payload($pdo, $divisionId, $dashboardYear),
            'timestamp' => date('Y-m-d H:i:s'),
        ],
        'summary' => [
            'data' => [
                'total_employees' => get_total_employees($pdo, $divisionId),
                'total_active_users' => get_total_active_users($pdo, $divisionId),
                'average_age' => get_average_age($pdo, $divisionId),
                'pwd_summary' => get_pwd_summary($pdo, $divisionId),
                'senior_citizen_summary' => get_senior_citizen_distribution($pdo, $divisionId),
            ],
        ],
        default => [
            'data' => analytics_payload($pdo, $divisionId, $dashboardYear),
            'timestamp' => date('Y-m-d H:i:s'),
        ],
    };

    json_response(array_merge([
        'success' => true,
    ], $response));
} catch (Throwable $exception) {
    error_log('Analytics error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'An error occurred while fetching analytics data.',
    ], 500);
}
