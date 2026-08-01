<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();
$roleKey = hris_user_role_key($sessionUser);
$allowedRoles = ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'chief'];

if (!in_array($roleKey, $allowedRoles, true)) {
    json_response([
        'success' => false,
        'message' => 'Unauthorized access to analytics.',
    ], 403);
}

function analytics_table_exists(PDO $pdo, string $table): bool
{
    return function_exists('hris_database_table_exists') && hris_database_table_exists($pdo, $table);
}

function analytics_scope_division_id(PDO $pdo, array $user, string $roleKey): ?int
{
    if (!in_array($roleKey, ['regionaldirector', 'chief'], true)) {
        return null;
    }

    $division = hris_trimmed_text($user['division'] ?? '');

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

function get_employment_status_distribution(PDO $pdo, ?int $divisionId): array
{
    if ($divisionId !== null && $divisionId <= 0) {
        return [];
    }

    $rowScope = analytics_employee_scope_condition($divisionId, '', 'division_id');
    $totalScope = analytics_employee_scope_condition($divisionId, '', 'total_division_id');
    $sql = 'SELECT
                COALESCE(NULLIF(TRIM(employment_status), ""), "Not Specified") AS employment_status,
                COUNT(id) AS count,
                ROUND(COUNT(id) * 100.0 / NULLIF(t.total_count, 0), 2) AS percentage
            FROM employees
            CROSS JOIN (
                SELECT COUNT(id) AS total_count
                FROM employees
                WHERE is_archived = 0' . $totalScope . '
            ) t
            WHERE is_archived = 0' . $rowScope . '
            GROUP BY employment_status, t.total_count
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
    if (($empty = analytics_empty_for_missing_tables($pdo, ['Payroll'], [])) !== null) {
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
         FROM Payroll p
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
         FROM users u
         INNER JOIN status s ON u.status_id = s.id' . $join . '
         WHERE u.is_archived = 0
           AND LOWER(s.name) = "active"' . $scope
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

function analytics_payload(PDO $pdo, ?int $divisionId): array
{
    return [
        'role_distribution' => get_role_distribution($pdo, $divisionId),
        'employment_status' => get_employment_status_distribution($pdo, $divisionId),
        'attendance_trend' => get_attendance_trend($pdo, $divisionId, 30),
        'pwd_distribution' => get_pwd_distribution($pdo, $divisionId),
        'pwd_summary' => get_pwd_summary($pdo, $divisionId),
        'gender_distribution' => get_gender_distribution($pdo, $divisionId),
        'gender_by_division' => get_gender_distribution_by_division($pdo, $divisionId),
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

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    json_response([
        'success' => false,
        'message' => 'Only GET requests are allowed for analytics.',
    ], 405);
}

$divisionId = analytics_scope_division_id($pdo, $sessionUser, $roleKey);
$analyticsType = (string)($_GET['type'] ?? 'all');

try {
    $response = match ($analyticsType) {
        'role_distribution' => ['data' => get_role_distribution($pdo, $divisionId)],
        'employment_status' => ['data' => get_employment_status_distribution($pdo, $divisionId)],
        'attendance_trend' => ['data' => get_attendance_trend($pdo, $divisionId, (int)($_GET['days'] ?? 30))],
        'pwd_distribution' => ['data' => get_pwd_distribution($pdo, $divisionId), 'summary' => get_pwd_summary($pdo, $divisionId)],
        'gender_distribution' => ['data' => get_gender_distribution($pdo, $divisionId)],
        'senior_citizen' => ['data' => get_senior_citizen_distribution($pdo, $divisionId)],
        'age_group' => ['data' => get_age_group_distribution($pdo, $divisionId)],
        'department_headcount' => ['data' => get_department_headcount($pdo, $divisionId)],
        'leave_utilization' => ['data' => get_leave_utilization($pdo, $divisionId)],
        'payroll_summary' => ['data' => get_payroll_summary($pdo, $divisionId)],
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
            'data' => analytics_payload($pdo, $divisionId),
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
