<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/leave-credit-utils.php';
require_once __DIR__ . '/captcha-utils.php';

$sessionUser = require_session_user();

/**
 * Civil Service constant factor used to convert a monthly salary into the
 * daily rate applied when leave credits are monetized.
 */
const LEAVE_MONETIZATION_DAILY_RATE_FACTOR = 0.0481170;

/**
 * Only vacation and sick leave credits may be monetized.
 */
const LEAVE_MONETIZATION_LEAVE_TYPE_CODES = ['VL', 'SL'];

/*
 * CSC Omnibus Rules on Leave, Rule XVI, Sec. 22 (as amended by CSC MC No. 41, s. 1998):
 * an employee who has accumulated fifteen (15) days of leave credits may monetize a
 * minimum of ten (10) days, provided at least five (5) days is retained afterwards and
 * no more than thirty (30) days is monetized in a given year.
 *
 * The three numbers are deliberately consistent: an employee sitting on exactly the 15-day
 * floor can file exactly the 10-day minimum and still keep the 5 days that must remain.
 */
const LEAVE_MONETIZATION_MINIMUM_ACCUMULATED_DAYS = 15.0;
const LEAVE_MONETIZATION_MINIMUM_REQUEST_DAYS = 10.0;
const LEAVE_MONETIZATION_RETAINED_DAYS = 5.0;

/* The annual ceiling is per employee, not per leave type — VL and SL count against one cap. */
const LEAVE_MONETIZATION_ANNUAL_CAP_DAYS = 30.0;

/*
 * Sec. 23: monetizing half or more of the accumulated credits is allowed only for a valid
 * and justifiable reason, so at that point the purpose stops being optional.
 */
const LEAVE_MONETIZATION_JUSTIFICATION_RATIO = 0.5;

function monetization_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function monetization_days(mixed $value): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return 0.0;
    }

    return round((float)$value, 2);
}

function monetization_date_or_null(mixed $value): ?string
{
    $text = monetization_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);

    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function monetization_status_to_client(string $status): string
{
    return match (strtolower($status)) {
        'reviewed' => 'Reviewed',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled' => 'Cancelled',
        default => 'Pending',
    };
}

function monetization_status_to_database(mixed $status): string
{
    return match (strtolower(monetization_text($status))) {
        'reviewed' => 'reviewed',
        'approved' => 'approved',
        'rejected' => 'rejected',
        'cancelled', 'canceled' => 'cancelled',
        default => 'pending',
    };
}

function monetization_role_key(array $user): string
{
    return user_role_key($user);
}

function monetization_can_manage(array $user): bool
{
    return in_array(monetization_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector'], true);
}

/** Personal leave roles may archive and restore only their own completed monetization requests. */
function monetization_is_self_service_role(array $user): bool
{
    return in_array(monetization_role_key($user), ['employee', 'planningofficer', 'cashier'], true);
}

function monetization_can_archive(array $user): bool
{
    return monetization_can_manage($user) || monetization_is_self_service_role($user);
}

function monetization_can_view_all(array $user): bool
{
    return !monetization_is_self_service_role($user);
}

function monetization_can_select_employee(array $user): bool
{
    return in_array(monetization_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function monetization_can_mark_reviewed(array $user): bool
{
    return monetization_role_key($user) === 'hrhead';
}

function monetization_is_regional_director(array $user): bool
{
    return monetization_role_key($user) === 'regionaldirector';
}

function monetization_monetizable_types(PDO $pdo): array
{
    $trackedTypes = leave_credit_type_rows($pdo);
    $monetizable = [];

    foreach (LEAVE_MONETIZATION_LEAVE_TYPE_CODES as $code) {
        if (isset($trackedTypes[$code])) {
            $monetizable[$code] = $trackedTypes[$code];
        }
    }

    return $monetizable;
}

function monetization_daily_rate(?float $basicSalary, string $salaryRate): float
{
    $salary = (float)($basicSalary ?? 0);

    if ($salary <= 0) {
        return 0.0;
    }

    // Employees paid on a daily basis already store the daily amount.
    if (stripos($salaryRate, 'daily') !== false || stripos($salaryRate, 'day') !== false) {
        return round($salary, 2);
    }

    return round($salary * LEAVE_MONETIZATION_DAILY_RATE_FACTOR, 2);
}

function monetization_base_select(): string
{
    return 'SELECT
            lm.id,
            lm.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.profile_image AS profileImage,
            e.basic_salary AS basicSalary,
            COALESCE(e.salary_rate, "") AS salaryRate,
            COALESCE(d.name, "") AS division,
            COALESCE(' . employee_role_name_subselect() . ', "") AS employeeRole,
            COALESCE(des.name, "") AS position,
            lm.leave_type_id AS leaveTypeId,
            lt.name AS leaveType,
            COALESCE(lt.code, "") AS leaveTypeCode,
            lm.number_of_days AS numberOfDays,
            lm.date_filed AS dateFiled,
            COALESCE(lm.reason, "") AS reason,
            lm.daily_rate AS dailyRate,
            lm.estimated_amount AS estimatedAmount,
            lm.credits_before AS creditsBefore,
            lm.status,
            COALESCE(lm.rejected_note, "") AS rejectedNote,
            lm.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
            COALESCE(NULLIF(TRIM(reviewed_employee.designation), ""), reviewed_designation.name, "") AS reviewedByPosition,
            lm.reviewed_at AS reviewedAt,
            lm.approved_by_employee_id AS approvedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
            lm.approved_at AS approvedAt,
            lm.archived_by_user_id AS archivedByUserId,
            lm.created_at AS createdAt,
            lm.updated_at AS updatedAt
         FROM leave_monetization_requests lm
         INNER JOIN employees e ON e.id = lm.employee_id
         INNER JOIN leave_types lt ON lt.leave_type_id = lm.leave_type_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN employees reviewed_employee ON reviewed_employee.id = lm.reviewed_by_employee_id
         LEFT JOIN designations reviewed_designation ON reviewed_designation.id = reviewed_employee.designation_id
         LEFT JOIN employees approved_employee ON approved_employee.id = lm.approved_by_employee_id';
}

function monetization_normalize_record(array $record): array
{
    $record['id'] = (int)$record['id'];
    $record['employeeRecordId'] = (int)$record['employeeRecordId'];
    $record['leaveTypeId'] = (int)$record['leaveTypeId'];
    $record['numberOfDays'] = (float)$record['numberOfDays'];
    $record['basicSalary'] = $record['basicSalary'] !== null ? (float)$record['basicSalary'] : null;
    $record['dailyRate'] = (float)($record['dailyRate'] ?? 0);
    $record['estimatedAmount'] = (float)($record['estimatedAmount'] ?? 0);
    $record['creditsBefore'] = (float)($record['creditsBefore'] ?? 0);
    $record['rejectedNote'] = monetization_text($record['rejectedNote'] ?? '');
    $record['reviewedByEmployeeRecordId'] = $record['reviewedByEmployeeRecordId'] !== null
        ? (int)$record['reviewedByEmployeeRecordId']
        : null;
    $record['reviewedByName'] = monetization_text($record['reviewedByName'] ?? '');
    $record['reviewedByPosition'] = monetization_text($record['reviewedByPosition'] ?? '');
    $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
        ? (int)$record['approvedByEmployeeRecordId']
        : null;
    $record['approvedByName'] = monetization_text($record['approvedByName'] ?? '');
    $record['archivedByUserId'] = $record['archivedByUserId'] !== null
        ? (int)$record['archivedByUserId']
        : null;
    $record['status'] = monetization_status_to_client((string)$record['status']);

    return $record;
}

function fetch_leave_monetization(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = monetization_base_select() . ' WHERE lm.id = :id';
    $params = [':id' => $id];

    if ($employeeScopeId !== null) {
        $sql .= ' AND lm.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $record = monetization_normalize_record($record);
    $record['hrHeadPosition'] = monetization_current_hr_head_title($pdo);

    return $record;
}

/*
 * The form captions 7.A with the signing HR Head's designation (reviewedByPosition), as the leave
 * request form does; until someone signs, the blank line names the title of whoever holds the HR
 * Head desk now. This is the lookup leave_request.php makes for its own form's blank line.
 */
function monetization_current_hr_head_title(PDO $pdo): string
{
    static $title = null;

    if ($title !== null) {
        return $title;
    }

    $statement = $pdo->query(
        'SELECT
            COALESCE(des.name, "") AS position,
            e.designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.is_archived = 0
           AND LOWER(REPLACE(r.name, " ", "")) = "hrhead"
           AND LOWER(u.status) = "active"
         ORDER BY u.id ASC
         LIMIT 1'
    );
    $holder = $statement->fetch();
    $title = $holder
        ? monetization_text(employee_signatory_title($holder['position'] ?? '', $holder['designation'] ?? ''))
        : '';

    return $title;
}

function resolve_monetization_session_employee_id(PDO $pdo, array $sessionUser): int
{
    $employeeId = session_employee_record_id($pdo, $sessionUser);

    if ($employeeId !== null) {
        return $employeeId;
    }

    json_response([
        'success' => false,
        'message' => 'Signed-in employee record was not found.',
    ], 422);
}

function monetization_employee_scope_id(PDO $pdo, array $sessionUser): ?int
{
    return monetization_can_view_all($sessionUser)
        ? null
        : resolve_monetization_session_employee_id($pdo, $sessionUser);
}

function resolve_monetization_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!monetization_can_select_employee($sessionUser)) {
        return resolve_monetization_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? 0);

    if ($employeeRecordId > 0) {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
        $statement->execute([':id' => $employeeRecordId]);
        $id = (int)$statement->fetchColumn();

        if ($id > 0) {
            return $id;
        }

        json_response([
            'success' => false,
            'message' => 'Selected employee was not found.',
        ], 422);
    }

    return resolve_monetization_session_employee_id($pdo, $sessionUser);
}

function fetch_monetization_employee(PDO $pdo, int $employeeId): array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.basic_salary AS basicSalary,
            COALESCE(e.salary_rate, "") AS salaryRate,
            COALESCE(d.name, "") AS division,
            COALESCE(des.name, "") AS position
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeId]);
    $employee = $statement->fetch();

    if (!$employee) {
        json_response([
            'success' => false,
            'message' => 'Selected employee was not found.',
        ], 404);
    }

    return $employee;
}

function list_leave_monetizations(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = monetization_employee_scope_id($pdo, $sessionUser);

    $sql = monetization_base_select() . ' WHERE lm.is_archived = :is_archived';
    $params = [':is_archived' => archived_view_requested() ? 1 : 0];

    if ($employeeScopeId !== null) {
        $sql .= ' AND lm.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' ORDER BY lm.date_filed DESC, lm.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    json_response([
        'success' => true,
        'records' => array_map(
            static fn (array $record): array => monetization_normalize_record($record),
            $statement->fetchAll()
        ),
    ]);
}

function get_leave_monetization(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Leave monetization request is required.',
        ], 422);
    }

    $record = fetch_leave_monetization($pdo, $id, monetization_employee_scope_id($pdo, $sessionUser));

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Leave monetization request not found.',
        ], 404);
    }

    json_response([
        'success' => true,
        'record' => $record,
    ]);
}

function get_monetizable_leave_credits(PDO $pdo, array $sessionUser): void
{
    $employeeId = monetization_can_select_employee($sessionUser)
        ? (int)($_GET['employeeRecordId'] ?? 0)
        : resolve_monetization_session_employee_id($pdo, $sessionUser);

    if ($employeeId <= 0) {
        $employeeId = resolve_monetization_session_employee_id($pdo, $sessionUser);
    }

    $employee = fetch_monetization_employee($pdo, $employeeId);
    $year = (int)($_GET['year'] ?? date('Y'));
    $snapshot = fetch_employee_leave_credit_snapshot($pdo, $employeeId, $year);
    $dailyRate = monetization_daily_rate(
        $employee['basicSalary'] !== null ? (float)$employee['basicSalary'] : null,
        (string)$employee['salaryRate']
    );

    $yearToDateDays = monetization_year_to_date_days($pdo, $employeeId, $year);
    $annualRemaining = leave_credit_round(max(0.0, LEAVE_MONETIZATION_ANNUAL_CAP_DAYS - $yearToDateDays));

    $options = [];
    foreach (monetization_monetizable_types($pdo) as $code => $trackedType) {
        $balance = $snapshot['balanceMap'][$trackedType['name']] ?? null;
        $pending = monetization_pending_days($pdo, $employeeId, (int)$trackedType['leave_type_id']);
        $remaining = leave_credit_round((float)($balance['remaining'] ?? 0));
        $available = leave_credit_round(max(0, $remaining - $pending));
        $meetsAccumulated = $remaining >= LEAVE_MONETIZATION_MINIMUM_ACCUMULATED_DAYS;
        $maxRequestable = monetization_max_requestable($available, $yearToDateDays);

        $options[] = [
            'code' => $code,
            'leaveTypeId' => (int)$trackedType['leave_type_id'],
            'leaveType' => (string)$trackedType['name'],
            'total' => leave_credit_round((float)($balance['total'] ?? 0)),
            'used' => leave_credit_round((float)($balance['used'] ?? 0)),
            'remaining' => $remaining,
            'pendingMonetization' => $pending,
            'available' => $available,
            // What the CSC rules leave room for, so the form can grey out what cannot be filed.
            'meetsAccumulatedMinimum' => $meetsAccumulated,
            'maxRequestable' => $maxRequestable,
            'eligible' => $meetsAccumulated && $maxRequestable >= LEAVE_MONETIZATION_MINIMUM_REQUEST_DAYS,
            'justificationThreshold' => leave_credit_round($remaining * LEAVE_MONETIZATION_JUSTIFICATION_RATIO),
        ];
    }

    json_response([
        'success' => true,
        'employee' => [
            'employeeRecordId' => (int)$employee['employeeRecordId'],
            'employeeId' => (string)$employee['employeeId'],
            'employeeName' => (string)$employee['employeeName'],
            'division' => (string)$employee['division'],
            'position' => (string)$employee['position'],
            'basicSalary' => $employee['basicSalary'] !== null ? (float)$employee['basicSalary'] : null,
            'salaryRate' => (string)$employee['salaryRate'],
        ],
        'year' => $snapshot['year'],
        'creditsAsOf' => $snapshot['creditsAsOf'],
        'dailyRate' => $dailyRate,
        'dailyRateFactor' => LEAVE_MONETIZATION_DAILY_RATE_FACTOR,
        'options' => $options,
        'yearToDateMonetized' => $yearToDateDays,
        'annualRemaining' => $annualRemaining,
        'rules' => [
            'minimumAccumulatedDays' => LEAVE_MONETIZATION_MINIMUM_ACCUMULATED_DAYS,
            'minimumRequestDays' => LEAVE_MONETIZATION_MINIMUM_REQUEST_DAYS,
            'retainedDays' => LEAVE_MONETIZATION_RETAINED_DAYS,
            'annualCapDays' => LEAVE_MONETIZATION_ANNUAL_CAP_DAYS,
            'justificationRatio' => LEAVE_MONETIZATION_JUSTIFICATION_RATIO,
        ],
    ]);
}

/**
 * Days already committed to monetization requests that are still moving through
 * the approval chain. They are not deducted from the balance yet, but they must
 * not be offered twice.
 */
function monetization_pending_days(PDO $pdo, int $employeeId, int $leaveTypeId, int $excludeId = 0): float
{
    $sql = 'SELECT COALESCE(SUM(number_of_days), 0)
            FROM leave_monetization_requests
            WHERE employee_id = :employee_id
              AND leave_type_id = :leave_type_id
              AND status IN ("pending", "reviewed")';
    $params = [
        ':employee_id' => $employeeId,
        ':leave_type_id' => $leaveTypeId,
    ];

    if ($excludeId > 0) {
        $sql .= ' AND id <> :exclude_id';
        $params[':exclude_id'] = $excludeId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return leave_credit_round((float)$statement->fetchColumn());
}

/**
 * Days the employee has already committed to monetization this calendar year, across every
 * leave type, counted against the 30-day annual ceiling.
 *
 * Approved days are spent and pending/reviewed days are spoken for, so both count. Rejected
 * and cancelled filings free their days back up again.
 */
function monetization_year_to_date_days(PDO $pdo, int $employeeId, int $year, int $excludeId = 0): float
{
    $sql = 'SELECT COALESCE(SUM(number_of_days), 0)
            FROM leave_monetization_requests
            WHERE employee_id = :employee_id
              AND YEAR(date_filed) = :year
              AND status IN ("pending", "reviewed", "approved")';
    $params = [
        ':employee_id' => $employeeId,
        ':year' => $year,
    ];

    if ($excludeId > 0) {
        $sql .= ' AND id <> :exclude_id';
        $params[':exclude_id'] = $excludeId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return leave_credit_round((float)$statement->fetchColumn());
}

/**
 * The largest filing the CSC rules still allow for this leave type, as whole days.
 *
 * Three ceilings apply at once and the tightest one wins: the credits actually free, the
 * five days that must survive the filing, and whatever is left of the 30-day annual cap.
 * Returns 0 when the employee cannot file at all.
 */
function monetization_max_requestable(float $available, float $yearToDateDays): float
{
    return leave_credit_round(max(0.0, min(
        $available - LEAVE_MONETIZATION_RETAINED_DAYS,
        LEAVE_MONETIZATION_ANNUAL_CAP_DAYS - $yearToDateDays
    )));
}

function monetization_available_credits(PDO $pdo, int $employeeId, array $trackedType, int $excludeId = 0): array
{
    $snapshot = fetch_employee_leave_credit_snapshot($pdo, $employeeId, (int)date('Y'));
    $balance = $snapshot['balanceMap'][$trackedType['name']] ?? null;
    $remaining = leave_credit_round((float)($balance['remaining'] ?? 0));
    $pending = monetization_pending_days($pdo, $employeeId, (int)$trackedType['leave_type_id'], $excludeId);

    return [
        'remaining' => $remaining,
        'pending' => $pending,
        'available' => leave_credit_round(max(0, $remaining - $pending)),
    ];
}

function resolve_monetization_leave_type(PDO $pdo, array $body): array
{
    $requestedCode = strtoupper(monetization_text($body['leaveTypeCode'] ?? ''));
    $requestedId = (int)($body['leaveTypeId'] ?? 0);
    $monetizableTypes = monetization_monetizable_types($pdo);

    if ($monetizableTypes === []) {
        json_response([
            'success' => false,
            'message' => 'Vacation and sick leave types are not configured yet.',
        ], 422);
    }

    if ($requestedCode !== '' && isset($monetizableTypes[$requestedCode])) {
        return $monetizableTypes[$requestedCode];
    }

    if ($requestedId > 0) {
        foreach ($monetizableTypes as $trackedType) {
            if ((int)$trackedType['leave_type_id'] === $requestedId) {
                return $trackedType;
            }
        }
    }

    json_response([
        'success' => false,
        'message' => 'Only vacation leave and sick leave credits can be monetized.',
    ], 422);
}

function create_leave_monetization(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_monetization_employee_id($pdo, $body, $sessionUser);
    $trackedType = resolve_monetization_leave_type($pdo, $body);
    $numberOfDays = monetization_days($body['numberOfDays'] ?? 0);
    $dateFiled = monetization_date_or_null($body['dateFiled'] ?? null) ?? date('Y-m-d');
    $reason = monetization_text($body['reason'] ?? '');

    if ($numberOfDays <= 0) {
        json_response([
            'success' => false,
            'message' => 'Number of leave credits to monetize must be greater than 0.',
        ], 422);
    }

    $credits = monetization_available_credits($pdo, $employeeId, $trackedType);

    if ($numberOfDays > $credits['available']) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'Insufficient %s credits. Only %s day(s) can still be monetized%s.',
                $trackedType['name'],
                leave_credit_format_days($credits['available']),
                $credits['pending'] > 0
                    ? sprintf(' (%s day(s) already awaiting approval)', leave_credit_format_days($credits['pending']))
                    : ''
            ),
        ], 422);
    }

    /*
     * The CSC ceilings, checked from the widest gate inwards so the message names the rule the
     * filing actually broke. The client blocks all of these too; this is the copy that counts,
     * since the balance can move between loading the form and submitting it.
     */
    if ($credits['remaining'] < LEAVE_MONETIZATION_MINIMUM_ACCUMULATED_DAYS) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'At least %s accumulated %s credit(s) are required before any can be monetized. This employee has %s.',
                leave_credit_format_days(LEAVE_MONETIZATION_MINIMUM_ACCUMULATED_DAYS),
                $trackedType['name'],
                leave_credit_format_days($credits['remaining'])
            ),
        ], 422);
    }

    if ($numberOfDays < LEAVE_MONETIZATION_MINIMUM_REQUEST_DAYS) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'A monetization must cover at least %s day(s).',
                leave_credit_format_days(LEAVE_MONETIZATION_MINIMUM_REQUEST_DAYS)
            ),
        ], 422);
    }

    if ($credits['available'] - $numberOfDays < LEAVE_MONETIZATION_RETAINED_DAYS) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'At least %s %s credit(s) must remain after monetization, so at most %s day(s) can be monetized now.',
                leave_credit_format_days(LEAVE_MONETIZATION_RETAINED_DAYS),
                $trackedType['name'],
                leave_credit_format_days(max(0.0, $credits['available'] - LEAVE_MONETIZATION_RETAINED_DAYS))
            ),
        ], 422);
    }

    $filingYear = (int)substr($dateFiled, 0, 4);
    $yearToDateDays = monetization_year_to_date_days($pdo, $employeeId, $filingYear);

    if ($yearToDateDays + $numberOfDays > LEAVE_MONETIZATION_ANNUAL_CAP_DAYS) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'Only %s day(s) may be monetized in %d. %s day(s) are already monetized or awaiting approval, leaving %s.',
                leave_credit_format_days(LEAVE_MONETIZATION_ANNUAL_CAP_DAYS),
                $filingYear,
                leave_credit_format_days($yearToDateDays),
                leave_credit_format_days(max(0.0, LEAVE_MONETIZATION_ANNUAL_CAP_DAYS - $yearToDateDays))
            ),
        ], 422);
    }

    /*
     * Half or more of the accumulated credits is the "50% or more" filing, which the rules only
     * permit for a stated reason — so the purpose that is optional elsewhere becomes mandatory.
     */
    $justificationThreshold = leave_credit_round($credits['remaining'] * LEAVE_MONETIZATION_JUSTIFICATION_RATIO);

    if ($numberOfDays >= $justificationThreshold && $reason === '') {
        json_response([
            'success' => false,
            'message' => sprintf(
                'Monetizing %s day(s) is 50%% or more of the %s accumulated credit(s), which is allowed only for a valid and justifiable reason. State the purpose of the monetization.',
                leave_credit_format_days($numberOfDays),
                leave_credit_format_days($credits['remaining'])
            ),
        ], 422);
    }

    $employee = fetch_monetization_employee($pdo, $employeeId);
    $dailyRate = monetization_daily_rate(
        $employee['basicSalary'] !== null ? (float)$employee['basicSalary'] : null,
        (string)$employee['salaryRate']
    );
    $estimatedAmount = round($dailyRate * $numberOfDays, 2);

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $isRegionalDirectorOwnRequest = monetization_is_regional_director($sessionUser)
        && $sessionEmployeeId !== null
        && $employeeId === $sessionEmployeeId;
    $initialStatus = $isRegionalDirectorOwnRequest ? 'approved' : 'pending';

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'INSERT INTO leave_monetization_requests
                (employee_id, leave_type_id, number_of_days, date_filed, reason, daily_rate, estimated_amount,
                 credits_before, status, approved_by_employee_id, approved_at, created_by_user_id)
             VALUES
                (:employee_id, :leave_type_id, :number_of_days, :date_filed, :reason, :daily_rate, :estimated_amount,
                 :credits_before, :status, :approved_by_employee_id, :approved_at, :created_by_user_id)'
        );
        $statement->execute([
            ':employee_id' => $employeeId,
            ':leave_type_id' => (int)$trackedType['leave_type_id'],
            ':number_of_days' => $numberOfDays,
            ':date_filed' => $dateFiled,
            ':reason' => $reason !== '' ? $reason : null,
            ':daily_rate' => $dailyRate,
            ':estimated_amount' => $estimatedAmount,
            ':credits_before' => $credits['remaining'],
            ':status' => $initialStatus,
            ':approved_by_employee_id' => $isRegionalDirectorOwnRequest ? $sessionEmployeeId : null,
            ':approved_at' => $isRegionalDirectorOwnRequest ? date('Y-m-d H:i:s') : null,
            ':created_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
        ]);

        $recordId = (int)$pdo->lastInsertId();

        if ($isRegionalDirectorOwnRequest) {
            deduct_monetized_leave_credits(
                $pdo,
                $sessionUser,
                $employeeId,
                (int)$trackedType['leave_type_id'],
                (string)$trackedType['code'],
                (string)$trackedType['name'],
                $numberOfDays,
                $dateFiled,
                $recordId
            );
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $title = $isRegionalDirectorOwnRequest ? 'Leave Monetization Approved' : 'Leave Monetization Filed';
        $message = sprintf(
            '%s %s %s day(s) of %s credits for monetization.',
            (string)$employee['employeeName'],
            $isRegionalDirectorOwnRequest ? 'self-approved' : 'filed',
            leave_credit_format_days($numberOfDays),
            (string)$trackedType['name']
        );
        $targetRoles = $isRegionalDirectorOwnRequest
            ? ['admin', 'hrhead', 'hrstaff']
            : ['admin', 'hrhead', 'hrstaff', 'regionaldirector'];

        notify_roles($pdo, $targetRoles, $title, $message, 'leave_monetization_submitted', (string)$recordId);
    } catch (Throwable $notificationException) {
        error_log('Leave monetization notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => $isRegionalDirectorOwnRequest
            ? 'Leave monetization request filed and approved.'
            : 'Leave monetization request submitted successfully.',
        'record' => fetch_leave_monetization($pdo, $recordId, monetization_employee_scope_id($pdo, $sessionUser)),
    ], 201);
}

/**
 * Approved monetization permanently consumes leave credits. Usage is recomputed
 * from approved leave requests, so the monetized days are removed from the
 * earned total instead of the used column.
 */
function deduct_monetized_leave_credits(
    PDO $pdo,
    array $sessionUser,
    int $employeeId,
    int $leaveTypeId,
    string $leaveTypeCode,
    string $leaveTypeName,
    float $numberOfDays,
    string $dateFiled,
    int $recordId
): void {
    $year = preg_match('/^\d{4}/', $dateFiled) === 1 ? (int)substr($dateFiled, 0, 4) : (int)date('Y');
    $balance = add_employee_leave_credit_amount($pdo, $employeeId, $leaveTypeId, $year, -1 * $numberOfDays);

    write_leave_credit_audit_log(
        $pdo,
        $sessionUser,
        'leave_credit.monetized',
        $employeeId,
        sprintf(
            'Monetized %s day(s) of %s credits.',
            leave_credit_format_days($numberOfDays),
            $leaveTypeName
        ),
        [
            'year' => $year,
            'leaveTypeCode' => $leaveTypeCode,
            'leaveTypeName' => $leaveTypeName,
            'monetizedDays' => $numberOfDays,
            'monetizationRequestId' => $recordId,
            'totalAfter' => $balance['total'],
            'remainingAfter' => $balance['remaining'],
        ]
    );
}

function update_leave_monetization_status(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? 0);
    $status = monetization_status_to_database($body['status'] ?? '');
    $rejectedNote = monetization_text($body['rejectedNote'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Leave monetization request is required.',
        ], 422);
    }

    $currentStatement = $pdo->prepare(
        'SELECT employee_id, leave_type_id, number_of_days, date_filed, status,
                reviewed_by_employee_id, approved_by_employee_id
         FROM leave_monetization_requests
         WHERE id = :id
         LIMIT 1'
    );
    $currentStatement->execute([':id' => $id]);
    $current = $currentStatement->fetch();

    if (!$current) {
        json_response([
            'success' => false,
            'message' => 'Leave monetization request not found.',
        ], 404);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $currentStatus = (string)($current['status'] ?? '');
    $employeeId = (int)($current['employee_id'] ?? 0);
    $isOwnRequest = $sessionEmployeeId !== null && $employeeId === $sessionEmployeeId;
    $isOwnCancellation = $isOwnRequest && $status === 'cancelled';

    if (!monetization_can_manage($sessionUser) && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to update leave monetization requests.',
        ], 403);
    }

    if ($isOwnRequest && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You cannot act on your own leave monetization request. Please ask another authorized user to review it.',
        ], 403);
    }

    if ($isOwnCancellation && $currentStatus !== 'pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending leave monetization requests can be cancelled.',
        ], 422);
    }

    if ($currentStatus === 'approved') {
        json_response([
            'success' => false,
            'message' => 'Approved leave monetization requests can no longer be updated.',
        ], 422);
    }

    if ($status === 'rejected' && $rejectedNote === '') {
        json_response([
            'success' => false,
            'message' => 'Rejected note is required.',
        ], 422);
    }

    if ($status === 'reviewed' && !monetization_can_mark_reviewed($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only HR Head can mark leave monetization requests as reviewed.',
        ], 403);
    }

    if ($status === 'reviewed' && $currentStatus !== 'pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending leave monetization requests can be marked as reviewed.',
        ], 422);
    }

    if (monetization_can_mark_reviewed($sessionUser) && $status === 'approved') {
        json_response([
            'success' => false,
            'message' => 'HR Head review forwards the request. Regional Director must give the final approval.',
        ], 422);
    }

    if (
        !$isOwnCancellation
        && monetization_is_regional_director($sessionUser)
        && in_array($status, ['approved', 'rejected', 'cancelled'], true)
        && $currentStatus !== 'reviewed'
    ) {
        json_response([
            'success' => false,
            'message' => 'Regional Director can only take final action after HR Head has reviewed the request.',
        ], 422);
    }

    $trackedType = leave_credit_tracked_type_by_id($pdo, (int)($current['leave_type_id'] ?? 0));
    $numberOfDays = (float)($current['number_of_days'] ?? 0);
    $dateFiled = (string)($current['date_filed'] ?? '');

    if ($status === 'approved') {
        if ($trackedType === null) {
            json_response([
                'success' => false,
                'message' => 'The monetized leave type is no longer available.',
            ], 422);
        }

        $credits = monetization_available_credits($pdo, $employeeId, $trackedType, $id);

        if ($numberOfDays > $credits['remaining']) {
            json_response([
                'success' => false,
                'message' => sprintf(
                    'Insufficient %s credits. Remaining balance is %s day(s).',
                    $trackedType['name'],
                    leave_credit_format_days($credits['remaining'])
                ),
            ], 422);
        }
    }

    /*
     * HR Head reviewing the request and the Regional Director approving it both carry a solved
     * captcha; refusing and cancelling do not. Placed after the credit check above so a challenge
     * is not spent on an approval that insufficient credits were going to refuse regardless.
     * See the approval_workflow entry in captcha-utils.php.
     */
    if (in_array($status, ['reviewed', 'approved'], true)) {
        require_approval_captcha($body, 'leavemonetization', $id);
    }

    $nextReviewedByEmployeeId = (int)($current['reviewed_by_employee_id'] ?? 0) ?: null;
    $nextApprovedByEmployeeId = (int)($current['approved_by_employee_id'] ?? 0) ?: null;
    $reviewedAt = $status === 'reviewed' ? date('Y-m-d H:i:s') : null;
    $approvedAt = $status === 'approved' ? date('Y-m-d H:i:s') : null;

    if ($status === 'reviewed') {
        $nextReviewedByEmployeeId = $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
        $nextApprovedByEmployeeId = null;
    }

    if ($status === 'approved') {
        $nextApprovedByEmployeeId = $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
    }

    /*
     * A refusal is an action on the application too, and 7.D of CSC Form No. 6 is signed by whoever
     * made it. The Director's slot therefore records the rejection the same way it records an
     * approval -- who acted and when -- so the printed form carries the signature and date beside
     * the disapproval reason instead of an empty line. Mirrors leave_request.php.
     */
    if ($status === 'rejected' && monetization_is_regional_director($sessionUser)) {
        $nextApprovedByEmployeeId = $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
        $approvedAt = date('Y-m-d H:i:s');
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'UPDATE leave_monetization_requests
             SET status = :status,
                 rejected_note = :rejected_note,
                 reviewed_by_employee_id = :reviewed_by_employee_id,
                 reviewed_at = COALESCE(:reviewed_at, reviewed_at),
                 approved_by_employee_id = :approved_by_employee_id,
                 approved_at = :approved_at
             WHERE id = :id'
        );
        $statement->execute([
            ':status' => $status,
            ':rejected_note' => $status === 'rejected' ? $rejectedNote : null,
            ':reviewed_by_employee_id' => $nextReviewedByEmployeeId,
            ':reviewed_at' => $reviewedAt,
            ':approved_by_employee_id' => $nextApprovedByEmployeeId,
            ':approved_at' => $approvedAt,
            ':id' => $id,
        ]);

        if ($status === 'approved' && $trackedType !== null) {
            deduct_monetized_leave_credits(
                $pdo,
                $sessionUser,
                $employeeId,
                (int)$trackedType['leave_type_id'],
                (string)$trackedType['code'],
                (string)$trackedType['name'],
                $numberOfDays,
                $dateFiled,
                $id
            );
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $leaveTypeName = $trackedType['name'] ?? 'leave';
        $notificationTitle = match ($status) {
            'approved' => 'Leave Monetization Approved',
            'rejected' => 'Leave Monetization Rejected',
            'reviewed' => 'Leave Monetization Reviewed',
            default => 'Leave Monetization Updated',
        };
        $notificationMessage = match ($status) {
            'approved' => sprintf(
                'Your monetization of %s day(s) of %s credits has been approved.',
                leave_credit_format_days($numberOfDays),
                $leaveTypeName
            ),
            'rejected' => sprintf(
                'Your monetization of %s day(s) of %s credits was rejected. %s',
                leave_credit_format_days($numberOfDays),
                $leaveTypeName,
                $rejectedNote !== '' ? $rejectedNote : 'Please review the rejection details.'
            ),
            'reviewed' => sprintf(
                'Your monetization of %s day(s) of %s credits was reviewed and forwarded for final approval.',
                leave_credit_format_days($numberOfDays),
                $leaveTypeName
            ),
            default => sprintf(
                'Your monetization of %s day(s) of %s credits has been updated.',
                leave_credit_format_days($numberOfDays),
                $leaveTypeName
            ),
        };
        $notificationType = match ($status) {
            'approved' => 'leave_monetization_approved',
            'rejected' => 'leave_monetization_rejected',
            default => 'leave_monetization_updated',
        };

        notify_employee($pdo, $employeeId, $notificationTitle, $notificationMessage, $notificationType, (string)$id);

        if ($status === 'reviewed') {
            notify_roles(
                $pdo,
                ['regionaldirector'],
                'Leave Monetization For Approval',
                sprintf(
                    'A leave monetization request of %s day(s) of %s credits is awaiting your final approval.',
                    leave_credit_format_days($numberOfDays),
                    $leaveTypeName
                ),
                'leave_monetization_updated',
                (string)$id
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Leave monetization notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => match ($status) {
            'reviewed' => 'Leave monetization reviewed and forwarded to the Regional Director for final approval.',
            'approved' => 'Leave monetization approved and the leave credits were deducted.',
            'rejected' => 'Leave monetization request rejected.',
            'cancelled' => 'Leave monetization request cancelled.',
            default => 'Leave monetization request updated.',
        },
        'record' => fetch_leave_monetization($pdo, $id),
    ]);
}

function archive_leave_monetization(PDO $pdo, array $body, array $sessionUser, bool $archived): void
{
    if (!monetization_can_archive($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive leave monetization requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $employeeScopeId = monetization_employee_scope_id($pdo, $sessionUser);
    $record = $id > 0 ? fetch_leave_monetization($pdo, $id, $employeeScopeId) : null;

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Leave monetization request not found.',
        ], 404);
    }

    if (
        $archived
        && monetization_is_self_service_role($sessionUser)
        && !in_array(strtolower((string)($record['status'] ?? '')), ['approved', 'rejected', 'cancelled'], true)
    ) {
        json_response([
            'success' => false,
            'message' => 'Only approved, rejected, or cancelled leave monetization requests can be archived.',
        ], 422);
    }

    if (
        !$archived
        && monetization_is_self_service_role($sessionUser)
        && (int)($record['archivedByUserId'] ?? 0) !== (int)($sessionUser['id'] ?? 0)
    ) {
        json_response([
            'success' => false,
            'message' => 'You may restore only leave monetization requests that you archived yourself.',
        ], 403);
    }

    set_record_archived(
        $pdo,
        'leave_monetization_requests',
        'id',
        $id,
        $archived,
        $sessionUser,
        'Leave Monetization Request'
    );

    json_response([
        'success' => true,
        'message' => $archived
            ? 'Leave monetization request archived.'
            : 'Leave monetization request restored.',
        'record' => fetch_leave_monetization($pdo, $id, $employeeScopeId),
    ]);
}

try {
    ensure_archive_columns($pdo, 'leave_monetization_requests');

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (isset($_GET['credits'])) {
            get_monetizable_leave_credits($pdo, $sessionUser);
        }

        if (isset($_GET['id'])) {
            get_leave_monetization($pdo, $sessionUser);
        }

        list_leave_monetizations($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_leave_monetization($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $action = strtolower(monetization_text($body['action'] ?? ''));

        if ($action === 'archive' || $action === 'restore') {
            archive_leave_monetization($pdo, $body, $sessionUser, $action === 'archive');
        }

        update_leave_monetization_status($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Leave monetization API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process leave monetization request.',
    ], 500);
}
