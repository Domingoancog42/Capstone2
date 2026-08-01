<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/leave-credit-utils.php';

$sessionUser = require_session_user();

function leave_credit_can_view_all(array $user): bool
{
    return hris_user_role_key($user) !== 'employee';
}

function leave_credit_can_manage(array $user): bool
{
    return in_array(hris_user_role_key($user), ['admin', 'hrhead'], true);
}

function leave_credit_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function leave_credit_date_or_null(mixed $value): ?string
{
    $text = leave_credit_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function leave_credit_decimal_or_null(mixed $value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }

    if (!is_numeric($value)) {
        return null;
    }

    return leave_credit_round((float)$value);
}

function fetch_leave_credit_employee_summary(PDO $pdo, int $employeeId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName
         FROM employees e
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeId]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

function require_leave_credit_employee_summary(PDO $pdo, int $employeeId): array
{
    if ($employeeId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    $employee = fetch_leave_credit_employee_summary($pdo, $employeeId);
    if ($employee === null) {
        json_response([
            'success' => false,
            'message' => 'Selected employee was not found.',
        ], 404);
    }

    return $employee;
}

function resolve_leave_credit_employee_id(PDO $pdo, array $sessionUser): int
{
    if (!leave_credit_can_view_all($sessionUser)) {
        $employeeId = hris_session_employee_record_id($pdo, $sessionUser);
        if ($employeeId !== null) {
            return $employeeId;
        }

        json_response([
            'success' => false,
            'message' => 'Signed-in employee record was not found.',
        ], 422);
    }

    $requestedEmployeeId = (int)($_GET['employeeRecordId'] ?? $_GET['employeeId'] ?? 0);
    if ($requestedEmployeeId > 0) {
        require_leave_credit_employee_summary($pdo, $requestedEmployeeId);
        return $requestedEmployeeId;
    }

    $employeeId = hris_session_employee_record_id($pdo, $sessionUser);
    if ($employeeId !== null) {
        return $employeeId;
    }

    json_response([
        'success' => false,
        'message' => 'Employee record is required.',
    ], 422);
}

function list_leave_credit_rows(PDO $pdo): void
{
    $year = (int)($_GET['year'] ?? date('Y'));

    json_response([
        'success' => true,
        'year' => leave_credit_resolve_year($year),
        'rows' => fetch_leave_credit_management_rows($pdo, $year),
    ]);
}

function show_leave_credit_history(PDO $pdo): void
{
    $employeeId = (int)($_GET['employeeRecordId'] ?? $_GET['employeeId'] ?? 0);
    $year = (int)($_GET['year'] ?? date('Y'));
    $leaveTypeCode = leave_credit_text($_GET['leaveTypeCode'] ?? '');

    require_leave_credit_employee_summary($pdo, $employeeId);

    json_response([
        'success' => true,
        'employeeId' => $employeeId,
        'history' => fetch_employee_leave_credit_history($pdo, $employeeId, $year, $leaveTypeCode),
    ]);
}

function show_leave_credit_snapshot(PDO $pdo, array $sessionUser): void
{
    $employeeId = resolve_leave_credit_employee_id($pdo, $sessionUser);
    $year = (int)($_GET['year'] ?? date('Y'));

    json_response([
        'success' => true,
        'employeeId' => $employeeId,
        'credits' => fetch_employee_leave_credit_snapshot($pdo, $employeeId, $year),
    ]);
}

function update_leave_credit_balance(PDO $pdo, array $body, array $sessionUser): void
{
    if (!leave_credit_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to manage leave balances.',
        ], 403);
    }

    $action = strtolower(leave_credit_text($body['action'] ?? 'update'));
    $employeeId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $year = leave_credit_resolve_year((int)($body['year'] ?? date('Y')));
    $effectiveDate = leave_credit_date_or_null($body['effectiveDate'] ?? null);
    $remarks = leave_credit_text($body['remarks'] ?? '');

    $employee = require_leave_credit_employee_summary($pdo, $employeeId);

    if ($action === 'reset') {
        $pdo->beginTransaction();

        try {
            $results = reset_employee_leave_credit_balances($pdo, $employeeId, $year);
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        write_leave_credit_audit_log(
            $pdo,
            $sessionUser,
            'leave_credit.reset',
            $employeeId,
            sprintf('Reset leave credits for %s.', leave_credit_text($employee['employeeName'] ?? 'Employee')),
            [
                'employeeId' => $employee['employeeId'] ?? '',
                'employeeName' => $employee['employeeName'] ?? '',
                'year' => $year,
                'effectiveDate' => $effectiveDate,
                'remarks' => $remarks,
                'resetBalances' => $results,
            ]
        );

        json_response([
            'success' => true,
            'message' => 'Leave credits reset successfully.',
            'rows' => fetch_leave_credit_management_rows($pdo, $year),
            'history' => fetch_employee_leave_credit_history($pdo, $employeeId, $year),
        ]);
    }

    $leaveTypeCode = strtoupper(leave_credit_text($body['leaveTypeCode'] ?? ''));
    $newBalance = leave_credit_decimal_or_null($body['newBalance'] ?? null);

    if ($leaveTypeCode === '') {
        json_response([
            'success' => false,
            'message' => 'Leave type is required.',
        ], 422);
    }

    if ($newBalance === null || $newBalance < 0) {
        json_response([
            'success' => false,
            'message' => 'New balance must be a valid non-negative number.',
        ], 422);
    }

    $trackedType = leave_credit_tracked_type_by_code($pdo, $leaveTypeCode);
    if ($trackedType === null) {
        json_response([
            'success' => false,
            'message' => 'Selected leave type is not configured for balance management.',
        ], 422);
    }

    $beforeSnapshot = fetch_employee_leave_credit_snapshot($pdo, $employeeId, $year);
    $beforeBalance = $beforeSnapshot['balances'] ?? [];
    $currentBalance = 0.0;

    foreach ($beforeBalance as $balance) {
        if (strtoupper((string)($balance['code'] ?? '')) === $leaveTypeCode) {
            $currentBalance = leave_credit_round((float)($balance['remaining'] ?? 0));
            break;
        }
    }

    $pdo->beginTransaction();

    try {
        $updatedBalance = upsert_employee_leave_credit_balance(
            $pdo,
            $employeeId,
            (int)$trackedType['leave_type_id'],
            $year,
            $newBalance
        );
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    write_leave_credit_audit_log(
        $pdo,
        $sessionUser,
        $action === 'set' ? 'leave_credit.set' : 'leave_credit.update',
        $employeeId,
        sprintf(
            '%s %s balance for %s.',
            $action === 'set' ? 'Set' : 'Updated',
            leave_credit_text($trackedType['name'] ?? $leaveTypeCode),
            leave_credit_text($employee['employeeName'] ?? 'Employee')
        ),
        [
            'employeeId' => $employee['employeeId'] ?? '',
            'employeeName' => $employee['employeeName'] ?? '',
            'leaveTypeCode' => $leaveTypeCode,
            'leaveTypeName' => $trackedType['name'] ?? '',
            'year' => $year,
            'effectiveDate' => $effectiveDate,
            'remarks' => $remarks,
            'previousRemaining' => $currentBalance,
            'newRemaining' => $updatedBalance['remaining'],
            'usedCredits' => $updatedBalance['used'],
            'totalCredits' => $updatedBalance['total'],
        ]
    );

    json_response([
        'success' => true,
        'message' => 'Leave balance saved successfully.',
        'rows' => fetch_leave_credit_management_rows($pdo, $year),
        'history' => fetch_employee_leave_credit_history($pdo, $employeeId, $year, $leaveTypeCode),
    ]);
}

function bulk_add_leave_credits(PDO $pdo, array $body, array $sessionUser): void
{
    if (!leave_credit_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to manage leave balances.',
        ], 403);
    }

    $leaveTypeCode = strtoupper(leave_credit_text($body['leaveTypeCode'] ?? ''));
    $amount = leave_credit_decimal_or_null($body['amount'] ?? null);
    $year = leave_credit_resolve_year((int)($body['year'] ?? date('Y')));
    $effectiveDate = leave_credit_date_or_null($body['effectiveDate'] ?? null);
    $remarks = leave_credit_text($body['remarks'] ?? '');
    $employmentStatusFilter = leave_credit_text($body['employmentStatus'] ?? '');

    $rawIds = $body['employeeRecordIds'] ?? [];
    if (!is_array($rawIds)) {
        $rawIds = [];
    }

    $employeeIds = [];
    foreach ($rawIds as $rawId) {
        $id = (int)$rawId;
        if ($id > 0) {
            $employeeIds[$id] = $id;
        }
    }
    $employeeIds = array_values($employeeIds);

    if ($leaveTypeCode === '') {
        json_response([
            'success' => false,
            'message' => 'Leave type is required.',
        ], 422);
    }

    if ($amount === null || $amount <= 0) {
        json_response([
            'success' => false,
            'message' => 'Credit amount must be a positive number.',
        ], 422);
    }

    if ($employeeIds === []) {
        json_response([
            'success' => false,
            'message' => 'Select at least one employee for the bulk update.',
        ], 422);
    }

    $trackedType = leave_credit_tracked_type_by_code($pdo, $leaveTypeCode);
    if ($trackedType === null) {
        json_response([
            'success' => false,
            'message' => 'Selected leave type is not configured for balance management.',
        ], 422);
    }

    $placeholders = implode(', ', array_fill(0, count($employeeIds), '?'));
    $statement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.employment_status AS employmentStatus
         FROM employees e
         WHERE e.is_archived = 0
           AND e.id IN (' . $placeholders . ')'
    );
    $statement->execute($employeeIds);

    $employeesById = [];
    foreach ($statement->fetchAll() as $employee) {
        $employeesById[(int)$employee['employeeRecordId']] = $employee;
    }

    $missing = array_values(array_filter(
        $employeeIds,
        static fn (int $id): bool => !isset($employeesById[$id])
    ));
    if ($missing !== []) {
        json_response([
            'success' => false,
            'message' => 'One or more selected employees are no longer available. Refresh and try again.',
        ], 422);
    }

    if ($employmentStatusFilter !== '') {
        foreach ($employeesById as $employee) {
            if (strcasecmp(trim((string)($employee['employmentStatus'] ?? '')), $employmentStatusFilter) !== 0) {
                json_response([
                    'success' => false,
                    'message' => 'Selected employees no longer match the chosen employment status. Refresh and try again.',
                ], 422);
            }
        }
    }

    $leaveTypeId = (int)$trackedType['leave_type_id'];
    $leaveTypeName = leave_credit_text($trackedType['name'] ?? $leaveTypeCode);
    $results = [];

    $pdo->beginTransaction();

    try {
        foreach ($employeeIds as $employeeId) {
            $results[$employeeId] = add_employee_leave_credit_amount($pdo, $employeeId, $leaveTypeId, $year, $amount);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    foreach ($employeeIds as $employeeId) {
        $employee = $employeesById[$employeeId];
        $result = $results[$employeeId] ?? [];

        write_leave_credit_audit_log(
            $pdo,
            $sessionUser,
            'leave_credit.bulk_add',
            $employeeId,
            sprintf(
                'Added %s %s credit(s) for %s.',
                leave_credit_format_days($amount),
                $leaveTypeName,
                leave_credit_text($employee['employeeName'] ?? 'Employee')
            ),
            [
                'employeeId' => $employee['employeeId'] ?? '',
                'employeeName' => $employee['employeeName'] ?? '',
                'leaveTypeCode' => $leaveTypeCode,
                'leaveTypeName' => $trackedType['name'] ?? '',
                'year' => $year,
                'effectiveDate' => $effectiveDate,
                'remarks' => $remarks,
                'creditsAdded' => $amount,
                'newRemaining' => $result['remaining'] ?? null,
                'totalCredits' => $result['total'] ?? null,
                'usedCredits' => $result['used'] ?? null,
                'bulk' => true,
            ]
        );

        try {
            hris_notify_employee(
                $pdo,
                $employeeId,
                'Leave credits updated',
                sprintf(
                    '%s day(s) of %s were added to your %d leave balance.',
                    leave_credit_format_days($amount),
                    $leaveTypeName,
                    $year
                ),
                'leave_credit_added',
                'leave_credit:' . $employeeId
            );
        } catch (Throwable $exception) {
            // Notifications are best-effort and must not fail the bulk update.
        }
    }

    json_response([
        'success' => true,
        'message' => sprintf(
            'Added %s %s credit(s) to %d employee(s).',
            leave_credit_format_days($amount),
            $leaveTypeName,
            count($employeeIds)
        ),
        'affectedCount' => count($employeeIds),
        'rows' => fetch_leave_credit_management_rows($pdo, $year),
    ]);
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (isset($_GET['list'])) {
            list_leave_credit_rows($pdo);
        }

        if (isset($_GET['history'])) {
            show_leave_credit_history($pdo);
        }

        show_leave_credit_snapshot($pdo, $sessionUser);
    }

    if ($method === 'PUT') {
        $body = read_json_body();

        if (strtolower(leave_credit_text($body['action'] ?? '')) === 'bulk_add') {
            bulk_add_leave_credits($pdo, $body, $sessionUser);
        }

        update_leave_credit_balance($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Leave credit API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process leave credit request.',
    ], 500);
}
