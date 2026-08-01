<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/leave-credit-utils.php';

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
    return hris_user_role_key($user);
}

function monetization_can_manage(array $user): bool
{
    return in_array(monetization_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector'], true);
}

function monetization_can_view_all(array $user): bool
{
    return monetization_role_key($user) !== 'employee';
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

function ensure_leave_monetization_table(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS leave_monetization_requests (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_id INT UNSIGNED NOT NULL,
            leave_type_id INT NOT NULL,
            number_of_days DECIMAL(6,2) NOT NULL,
            date_filed DATE NOT NULL,
            reason TEXT NULL,
            daily_rate DECIMAL(12,2) NOT NULL DEFAULT 0.00,
            estimated_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
            credits_before DECIMAL(6,2) NOT NULL DEFAULT 0.00,
            status ENUM('pending', 'reviewed', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
            rejected_note TEXT NULL,
            reviewed_by_employee_id INT UNSIGNED NULL,
            reviewed_at DATETIME NULL,
            approved_by_employee_id INT UNSIGNED NULL,
            approved_at DATETIME NULL,
            created_by_user_id INT UNSIGNED NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_leave_monetization_employee (employee_id),
            KEY idx_leave_monetization_status (status),
            KEY idx_leave_monetization_date_filed (date_filed),
            CONSTRAINT fk_leave_monetization_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
            CONSTRAINT fk_leave_monetization_leave_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(leave_type_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
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
            lm.reviewed_at AS reviewedAt,
            lm.approved_by_employee_id AS approvedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
            lm.approved_at AS approvedAt,
            lm.created_at AS createdAt,
            lm.updated_at AS updatedAt
         FROM leave_monetization_requests lm
         INNER JOIN employees e ON e.id = lm.employee_id
         INNER JOIN leave_types lt ON lt.leave_type_id = lm.leave_type_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN employees reviewed_employee ON reviewed_employee.id = lm.reviewed_by_employee_id
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
    $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
        ? (int)$record['approvedByEmployeeRecordId']
        : null;
    $record['approvedByName'] = monetization_text($record['approvedByName'] ?? '');
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

    return $record ? monetization_normalize_record($record) : null;
}

function resolve_monetization_session_employee_id(PDO $pdo, array $sessionUser): int
{
    $employeeId = hris_session_employee_record_id($pdo, $sessionUser);

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

    $sql = monetization_base_select();
    $params = [];

    if ($employeeScopeId !== null) {
        $sql .= ' WHERE lm.employee_id = :employee_scope_id';
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

    $options = [];
    foreach (monetization_monetizable_types($pdo) as $code => $trackedType) {
        $balance = $snapshot['balanceMap'][$trackedType['name']] ?? null;
        $pending = monetization_pending_days($pdo, $employeeId, (int)$trackedType['leave_type_id']);
        $remaining = leave_credit_round((float)($balance['remaining'] ?? 0));

        $options[] = [
            'code' => $code,
            'leaveTypeId' => (int)$trackedType['leave_type_id'],
            'leaveType' => (string)$trackedType['name'],
            'total' => leave_credit_round((float)($balance['total'] ?? 0)),
            'used' => leave_credit_round((float)($balance['used'] ?? 0)),
            'remaining' => $remaining,
            'pendingMonetization' => $pending,
            'available' => leave_credit_round(max(0, $remaining - $pending)),
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

    $employee = fetch_monetization_employee($pdo, $employeeId);
    $dailyRate = monetization_daily_rate(
        $employee['basicSalary'] !== null ? (float)$employee['basicSalary'] : null,
        (string)$employee['salaryRate']
    );
    $estimatedAmount = round($dailyRate * $numberOfDays, 2);

    $sessionEmployeeId = hris_session_employee_record_id($pdo, $sessionUser);
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

        hris_notify_roles($pdo, $targetRoles, $title, $message, 'leave_monetization_submitted', (string)$recordId);
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

    $sessionEmployeeId = hris_session_employee_record_id($pdo, $sessionUser);
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

        hris_notify_employee($pdo, $employeeId, $notificationTitle, $notificationMessage, $notificationType, (string)$id);

        if ($status === 'reviewed') {
            hris_notify_roles(
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

try {
    ensure_leave_monetization_table($pdo);

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
        update_leave_monetization_status($pdo, read_json_body(), $sessionUser);
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
