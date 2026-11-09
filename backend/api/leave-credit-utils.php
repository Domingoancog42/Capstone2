<?php
declare(strict_types=1);

/*
 * Each entry is a credit balance an employee holds. 'chargedBy' lists the other leave types that
 * draw from that same balance instead of carrying one of their own: mandatory/forced leave is the
 * required annual use of vacation credits, not a separate entitlement, so filing it spends
 * vacation days.
 */
function leave_credit_default_definitions(): array
{
    return [
        'VL' => [
            'code' => 'VL',
            'name' => 'Vacation Leave',
            'total' => 15.0,
            'chargedBy' => [
                ['name' => 'Forced Leave', 'code' => 'FL'],
                ['name' => 'Mandatory/Forced Leave', 'code' => 'MFL'],
            ],
        ],
        'SL' => [
            'code' => 'SL',
            'name' => 'Sick Leave',
            'total' => 15.0,
        ],
        'SPL' => [
            'code' => 'SPL',
            'name' => 'Special Privilege Leave',
            'total' => 3.0,
        ],
        'SOPL' => [
            'code' => 'SOPL',
            'name' => 'Solo Parent Leave',
            'total' => 7.0,
        ],
        'STL' => [
            'code' => 'STL',
            'name' => 'Study Leave',
            'total' => 0.0,
        ],
        'ML' => [
            'code' => 'ML',
            'name' => 'Maternity Leave',
            'total' => 105.0,
        ],
        'PL' => [
            'code' => 'PL',
            'name' => 'Paternity Leave',
            'total' => 7.0,
        ],
    ];
}

/*
 * A request may run past the employee's remaining credits, in which case only the covered part is
 * charged to the balance and the rest is filed as Leave Without Pay. The split is stored per
 * request so credit usage, approval checks, and CSC Form No. 6 (7.C) all read the same numbers.
 */
function ensure_leave_request_pay_split_columns(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $paidDaysStatement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'paid_days'");
    if ($paidDaysStatement !== false && $paidDaysStatement->fetch() === false) {
        $pdo->exec('ALTER TABLE leave_requests ADD COLUMN paid_days DECIMAL(5,2) NULL AFTER total_days');
    }

    $unpaidDaysStatement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'unpaid_days'");
    if ($unpaidDaysStatement !== false && $unpaidDaysStatement->fetch() === false) {
        $pdo->exec('ALTER TABLE leave_requests ADD COLUMN unpaid_days DECIMAL(5,2) NULL AFTER paid_days');
    }

    $ensured = true;
}

function leave_credit_resolve_year(?int $year = null): int
{
    $resolvedYear = (int)($year ?? date('Y'));
    return $resolvedYear > 0 ? $resolvedYear : (int)date('Y');
}

function leave_credit_format_days(float $value): string
{
    $formatted = number_format($value, 2, '.', '');
    $formatted = rtrim(rtrim($formatted, '0'), '.');

    return $formatted === '' ? '0' : $formatted;
}

function leave_credit_round(float $value): float
{
    return round($value, 2);
}

/*
 * Leave is only ever availed in whole days or half days, so a fractional balance such as 1.25 can
 * only pay for 1 day. Rounding the payable part down to the nearest half keeps the quarter-day
 * remainder on the balance instead of printing an unavailable duration in 7.C Approved For.
 */
function leave_credit_floor_half_day(float $value): float
{
    if ($value <= 0) {
        return 0.0;
    }

    return leave_credit_round(floor(leave_credit_round($value) * 2) / 2);
}

/*
 * Resolves each credit balance to the leave_types rows that spend it. 'leave_type_id' is the row
 * the balance itself is stored against, while 'charged_leave_type_ids' also covers the leave types
 * listed under 'chargedBy', so usage is summed across all of them.
 */
function leave_credit_type_rows(PDO $pdo): array
{
    $definitions = leave_credit_default_definitions();
    $lookup = [];
    $names = [];
    $codes = [];

    foreach ($definitions as $definitionCode => $definition) {
        $chargingTypes = array_merge(
            [['name' => $definition['name'], 'code' => $definition['code'], 'canonical' => true]],
            array_map(
                static fn (array $alias): array => $alias + ['canonical' => false],
                $definition['chargedBy'] ?? []
            )
        );

        foreach ($chargingTypes as $chargingType) {
            $names[] = (string)$chargingType['name'];
            $codes[] = (string)$chargingType['code'];
            $lookup['name:' . strtolower((string)$chargingType['name'])] = [$definitionCode, (bool)$chargingType['canonical']];
            $lookup['code:' . strtoupper((string)$chargingType['code'])] = [$definitionCode, (bool)$chargingType['canonical']];
        }
    }

    $namePlaceholders = implode(', ', array_fill(0, count($names), '?'));
    $codePlaceholders = implode(', ', array_fill(0, count($codes), '?'));
    $statement = $pdo->prepare(
        'SELECT leave_type_id, name, code
         FROM leave_types
         WHERE is_active = 1
           AND (name IN (' . $namePlaceholders . ') OR code IN (' . $codePlaceholders . '))'
    );
    $statement->execute([...$names, ...$codes]);

    $trackedTypes = [];
    foreach ($statement->fetchAll() as $row) {
        $rowName = strtolower(trim((string)($row['name'] ?? '')));
        $rowCode = strtoupper(trim((string)($row['code'] ?? '')));
        $match = $lookup['code:' . $rowCode] ?? $lookup['name:' . $rowName] ?? null;

        if ($match === null) {
            continue;
        }

        [$definitionCode, $isCanonical] = $match;
        $definition = $definitions[$definitionCode];
        $leaveTypeId = (int)$row['leave_type_id'];

        if (!isset($trackedTypes[$definitionCode])) {
            $trackedTypes[$definitionCode] = [
                'leave_type_id' => 0,
                'code' => (string)$definition['code'],
                'name' => (string)$definition['name'],
                'total' => (float)$definition['total'],
                'charged_leave_type_ids' => [],
            ];
        }

        $trackedTypes[$definitionCode]['charged_leave_type_ids'][] = $leaveTypeId;

        if ($isCanonical) {
            $trackedTypes[$definitionCode]['leave_type_id'] = $leaveTypeId;
        }
    }

    /* A balance with no row to store against cannot be tracked at all. */
    return array_filter(
        $trackedTypes,
        static fn (array $trackedType): bool => (int)$trackedType['leave_type_id'] > 0
    );
}

function leave_credit_charged_leave_type_ids(array $trackedTypes): array
{
    $leaveTypeIds = [];

    foreach ($trackedTypes as $trackedType) {
        foreach ($trackedType['charged_leave_type_ids'] ?? [(int)$trackedType['leave_type_id']] as $leaveTypeId) {
            $leaveTypeIds[] = (int)$leaveTypeId;
        }
    }

    return array_values(array_unique($leaveTypeIds));
}

function leave_credit_tracked_type_by_id(PDO $pdo, int $leaveTypeId): ?array
{
    foreach (leave_credit_type_rows($pdo) as $trackedType) {
        if (in_array($leaveTypeId, $trackedType['charged_leave_type_ids'] ?? [], true)) {
            return $trackedType;
        }
    }

    return null;
}

function leave_credit_tracked_type_by_code(PDO $pdo, string $leaveTypeCode): ?array
{
    $normalizedCode = strtoupper(trim($leaveTypeCode));
    if ($normalizedCode === '') {
        return null;
    }

    foreach (leave_credit_type_rows($pdo) as $trackedType) {
        if (strtoupper((string)($trackedType['code'] ?? '')) === $normalizedCode) {
            return $trackedType;
        }
    }

    return null;
}

/*
 * A newly added employee has not earned any vacation or sick leave yet, so those balances open at 0
 * and grow with the monthly accrual from the month after the hire date. Every other leave type
 * keeps its default entitlement, and existing employees opening a new year are not affected.
 */
function leave_credit_new_employee_opening_totals(): array
{
    return [
        'VL' => 0.0,
        'SL' => 0.0,
    ];
}

/** The balance a tracked leave type opens at: its default, or the new-employee figure. */
function leave_credit_opening_total(string $definitionCode, array $trackedType, bool $isNewEmployee): float
{
    if ($isNewEmployee && array_key_exists($definitionCode, leave_credit_new_employee_opening_totals())) {
        return (float)leave_credit_new_employee_opening_totals()[$definitionCode];
    }

    return (float)$trackedType['total'];
}

function ensure_employee_default_leave_credits(PDO $pdo, int $employeeId, ?int $year = null, bool $isNewEmployee = false): void
{
    if ($employeeId <= 0) {
        return;
    }

    $year = leave_credit_resolve_year($year);
    $trackedTypes = leave_credit_type_rows($pdo);

    if ($trackedTypes === []) {
        return;
    }

    $statement = $pdo->prepare(
        'INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits)
         VALUES (:employee_id, :leave_type_id, :year, :total_credits, 0.00)
         ON DUPLICATE KEY UPDATE total_credits = total_credits'
    );

    foreach ($trackedTypes as $definitionCode => $trackedType) {
        $statement->execute([
            ':employee_id' => $employeeId,
            ':leave_type_id' => (int)$trackedType['leave_type_id'],
            ':year' => $year,
            ':total_credits' => leave_credit_opening_total((string)$definitionCode, $trackedType, $isNewEmployee),
        ]);
    }
}

function recalculate_employee_leave_credit_usage(PDO $pdo, int $employeeId, ?int $year = null): void
{
    if ($employeeId <= 0) {
        return;
    }

    $year = leave_credit_resolve_year($year);
    $trackedTypes = leave_credit_type_rows($pdo);

    if ($trackedTypes === []) {
        return;
    }

    ensure_leave_request_pay_split_columns($pdo);
    ensure_employee_default_leave_credits($pdo, $employeeId, $year);

    $leaveTypeIds = leave_credit_charged_leave_type_ids($trackedTypes);
    $placeholders = implode(', ', array_fill(0, count($leaveTypeIds), '?'));

    $usageStatement = $pdo->prepare(
        'SELECT leave_type_id, COALESCE(SUM(COALESCE(paid_days, total_days)), 0) AS used_credits
         FROM leave_requests
         WHERE employee_id = ?
           AND LOWER(status) = "approved"
           AND YEAR(start_date) = ?
           AND leave_type_id IN (' . $placeholders . ')
         GROUP BY leave_type_id'
    );
    $usageStatement->execute([$employeeId, $year, ...$leaveTypeIds]);

    $usageMap = [];
    foreach ($usageStatement->fetchAll() as $row) {
        $usageMap[(int)$row['leave_type_id']] = leave_credit_round((float)($row['used_credits'] ?? 0));
    }

    $updateStatement = $pdo->prepare(
        'UPDATE leave_credits
         SET used_credits = :used_credits
         WHERE employee_id = :employee_id
           AND leave_type_id = :leave_type_id
           AND year = :year'
    );

    foreach ($trackedTypes as $trackedType) {
        /* Every leave type charging this balance adds to the one stored usage figure. */
        $usedCredits = 0.0;
        foreach ($trackedType['charged_leave_type_ids'] as $chargedLeaveTypeId) {
            $usedCredits += $usageMap[(int)$chargedLeaveTypeId] ?? 0;
        }

        $updateStatement->execute([
            ':used_credits' => leave_credit_round($usedCredits),
            ':employee_id' => $employeeId,
            ':leave_type_id' => (int)$trackedType['leave_type_id'],
            ':year' => $year,
        ]);
    }
}

/*
 * Maternity and Paternity are the two entitlements an employee can never both hold, so the screens
 * that show someone their own balances need to know which one applies. The balances themselves stay
 * complete — HR still manages both from the Leave Balances grid, and the before/after values an
 * adjustment audits have to be the stored ones — so the gender travels with the snapshot instead and
 * the rule is applied where the employee's own credits are displayed.
 */
function leave_credit_employee_gender(PDO $pdo, int $employeeId): string
{
    if ($employeeId <= 0) {
        return '';
    }

    $statement = $pdo->prepare('SELECT gender FROM employees WHERE id = :id LIMIT 1');
    $statement->execute([':id' => $employeeId]);

    return trim((string)($statement->fetchColumn() ?: ''));
}

function fetch_employee_leave_credit_snapshot(PDO $pdo, int $employeeId, ?int $year = null): array
{
    $year = leave_credit_resolve_year($year);
    $definitions = leave_credit_default_definitions();
    $trackedTypes = leave_credit_type_rows($pdo);

    if ($employeeId > 0) {
        ensure_employee_default_leave_credits($pdo, $employeeId, $year);
        apply_due_leave_credit_accruals($pdo, $year, $employeeId);
        recalculate_employee_leave_credit_usage($pdo, $employeeId, $year);
    }

    $nextAccrualDate = '';

    if ($employeeId > 0 && $year === (int)date('Y')) {
        $accrualStatement = $pdo->prepare(
            'SELECT e.date_hired, e.status,
                    (SELECT MIN(lc.created_at) FROM leave_credits lc WHERE lc.employee_id = e.id) AS tracked_since
             FROM employees e
             WHERE e.id = :employee_id
             LIMIT 1'
        );
        $accrualStatement->execute([':employee_id' => $employeeId]);
        $accrualRow = $accrualStatement->fetch() ?: [];
        $accrualStart = leave_credit_accrual_start_month(
            (string)($accrualRow['date_hired'] ?? ''),
            (string)($accrualRow['tracked_since'] ?? '')
        );

        if ($accrualStart !== null && strcasecmp((string)($accrualRow['status'] ?? ''), 'Active') === 0) {
            $nextAccrualDate = leave_credit_next_accrual_date($accrualStart);
        }
    }

    $recordsByCode = [];
    if ($employeeId > 0 && $trackedTypes !== []) {
        $leaveTypeIds = array_map(
            static fn (array $trackedType): int => (int)$trackedType['leave_type_id'],
            array_values($trackedTypes)
        );
        $placeholders = implode(', ', array_fill(0, count($leaveTypeIds), '?'));
        $statement = $pdo->prepare(
            'SELECT
                lc.leave_type_id,
                lc.total_credits,
                lc.used_credits,
                lc.remaining_credits,
                lt.name,
                lt.code
             FROM leave_credits lc
             INNER JOIN leave_types lt ON lt.leave_type_id = lc.leave_type_id
             WHERE lc.employee_id = ?
               AND lc.year = ?
               AND lc.leave_type_id IN (' . $placeholders . ')'
        );
        $statement->execute([$employeeId, $year, ...$leaveTypeIds]);

        foreach ($statement->fetchAll() as $row) {
            $rowCode = strtoupper(trim((string)($row['code'] ?? '')));
            if ($rowCode === '') {
                $rowName = strtolower(trim((string)($row['name'] ?? '')));
                foreach ($definitions as $definition) {
                    if ($rowName === strtolower((string)$definition['name'])) {
                        $rowCode = strtoupper((string)$definition['code']);
                        break;
                    }
                }
            }

            if ($rowCode === '') {
                continue;
            }

            $recordsByCode[$rowCode] = [
                'total' => leave_credit_round((float)($row['total_credits'] ?? 0)),
                'used' => leave_credit_round((float)($row['used_credits'] ?? 0)),
                'remaining' => leave_credit_round((float)($row['remaining_credits'] ?? 0)),
            ];
        }
    }

    $balances = [];
    $balanceMap = [];

    foreach ($definitions as $definitionCode => $definition) {
        $record = $recordsByCode[$definitionCode] ?? null;
        $monthlyAccrual = $record !== null && $nextAccrualDate !== ''
            ? leave_credit_monthly_accrual($definitionCode)
            : 0.0;
        $balance = [
            'code' => (string)$definition['code'],
            'type' => (string)$definition['name'],
            'total' => $record['total'] ?? leave_credit_round((float)$definition['total']),
            'used' => $record['used'] ?? 0.0,
            'remaining' => $record['remaining'] ?? leave_credit_round((float)$definition['total']),
            'monthlyAccrual' => $monthlyAccrual,
            'nextAccrualDate' => $monthlyAccrual > 0 ? $nextAccrualDate : '',
        ];
        $balances[] = $balance;
        $balanceMap[$balance['type']] = $balance;
    }

    return [
        'year' => $year,
        'creditsAsOf' => date('Y-m-d'),
        'gender' => leave_credit_employee_gender($pdo, $employeeId),
        'balances' => $balances,
        'balanceMap' => $balanceMap,
        'entitlements' => leave_credit_entitlements($pdo, $trackedTypes, $balances),
    ];
}

/*
 * Every active leave type, one entry each, for the employee's balance card wall. A type that spends
 * a tracked credit carries that balance -- its own (Vacation, Sick, ...) or the one it is charged to
 * (Mandatory/Forced Leave draws on Vacation Leave). The rest carry only the yearly entitlement the
 * leave_types row records, or none at all for a leave granted as approved (Study, Terminal, Leave
 * Without Pay). `balances` stays the request form's list of tracked credits; this is the wider view.
 */
function leave_credit_entitlements(PDO $pdo, array $trackedTypes, array $balances): array
{
    $balancesByCode = [];
    foreach ($balances as $balance) {
        $balancesByCode[strtoupper((string)$balance['code'])] = $balance;
    }

    /* Which tracked balance each leave_types row spends, whether it is the canonical row or an alias. */
    $balanceCodeByLeaveTypeId = [];
    foreach ($trackedTypes as $definitionCode => $trackedType) {
        foreach ($trackedType['charged_leave_type_ids'] ?? [(int)$trackedType['leave_type_id']] as $leaveTypeId) {
            $balanceCodeByLeaveTypeId[(int)$leaveTypeId] = strtoupper((string)$definitionCode);
        }
    }

    $statement = $pdo->query(
        'SELECT leave_type_id, name, code, max_days_per_year, is_with_pay
         FROM leave_types
         WHERE is_active = 1
         ORDER BY leave_type_id ASC'
    );

    $entitlements = [];
    foreach ($statement->fetchAll() as $row) {
        $leaveTypeId = (int)$row['leave_type_id'];
        $name = trim((string)($row['name'] ?? ''));
        $balanceCode = $balanceCodeByLeaveTypeId[$leaveTypeId] ?? null;
        $balance = $balanceCode !== null ? ($balancesByCode[$balanceCode] ?? null) : null;
        $balanceType = $balance !== null ? (string)$balance['type'] : null;

        $entitlements[] = [
            'leaveTypeId' => $leaveTypeId,
            'name' => $name,
            'code' => strtoupper(trim((string)($row['code'] ?? ''))),
            'maxDaysPerYear' => $row['max_days_per_year'] !== null
                ? leave_credit_round((float)$row['max_days_per_year'])
                : null,
            'isWithPay' => (int)($row['is_with_pay'] ?? 0) === 1,
            'balanceCode' => $balanceCode,
            'balanceType' => $balanceType,
            'chargedTo' => $balanceType !== null && strcasecmp($balanceType, $name) !== 0 ? $balanceType : null,
            'total' => $balance['total'] ?? null,
            'used' => $balance['used'] ?? null,
            'remaining' => $balance['remaining'] ?? null,
            'monthlyAccrual' => $balance['monthlyAccrual'] ?? 0.0,
            'nextAccrualDate' => $balance['nextAccrualDate'] ?? '',
        ];
    }

    return $entitlements;
}

/*
 * Splits a request into the days its credit balance can cover and the days that fall through to
 * Leave Without Pay. Leave types without a tracked balance are always fully with pay.
 */
function leave_credit_pay_split(PDO $pdo, int $employeeId, int $leaveTypeId, float $numberOfDays, ?string $startDate = null): array
{
    $requestedDays = leave_credit_round(max(0.0, $numberOfDays));
    $trackedType = leave_credit_tracked_type_by_id($pdo, $leaveTypeId);

    if ($trackedType === null) {
        return [
            'tracked' => false,
            'leaveTypeName' => '',
            'requestedDays' => $requestedDays,
            'remaining' => 0.0,
            'paidDays' => $requestedDays,
            'unpaidDays' => 0.0,
        ];
    }

    $year = null;
    if (is_string($startDate) && preg_match('/^\d{4}/', $startDate) === 1) {
        $year = (int)substr($startDate, 0, 4);
    }

    $snapshot = fetch_employee_leave_credit_snapshot($pdo, $employeeId, $year);
    $balance = $snapshot['balanceMap'][$trackedType['name']] ?? null;
    $remaining = leave_credit_round(max(0.0, (float)($balance['remaining'] ?? 0)));
    $payableCredits = leave_credit_floor_half_day($remaining);
    $paidDays = leave_credit_round(min($requestedDays, $payableCredits));

    return [
        'tracked' => true,
        'leaveTypeName' => (string)$trackedType['name'],
        'requestedDays' => $requestedDays,
        'remaining' => $remaining,
        'paidDays' => $paidDays,
        'unpaidDays' => leave_credit_round($requestedDays - $paidDays),
    ];
}

/*
 * $chargeableDays is the part of the request charged to leave credits, which is smaller than the
 * total days whenever the request also carries Leave Without Pay days.
 */
function validate_leave_credit_approval(PDO $pdo, int $employeeId, int $leaveTypeId, float $chargeableDays, ?string $startDate = null): void
{
    $trackedType = leave_credit_tracked_type_by_id($pdo, $leaveTypeId);

    if ($trackedType === null) {
        return;
    }

    $year = null;
    if (is_string($startDate) && preg_match('/^\d{4}/', $startDate) === 1) {
        $year = (int)substr($startDate, 0, 4);
    }

    $snapshot = fetch_employee_leave_credit_snapshot($pdo, $employeeId, $year);
    $balance = $snapshot['balanceMap'][$trackedType['name']] ?? null;
    $remaining = leave_credit_round((float)($balance['remaining'] ?? 0));

    if ($chargeableDays > $remaining) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'Insufficient %s credits. Remaining balance is %s day(s).',
                $trackedType['name'],
                leave_credit_format_days($remaining)
            ),
        ], 422);
    }
}

function leave_credit_audit_table_exists(PDO $pdo): bool
{
    static $exists = null;

    if ($exists !== null) {
        return $exists;
    }

    try {
        ensure_audit_logs_table($pdo);
        $exists = true;
    } catch (Throwable $exception) {
        $exists = false;
    }

    return $exists;
}

function leave_credit_current_used_credits(PDO $pdo, int $employeeId, int $leaveTypeId, int $year): float
{
    ensure_leave_request_pay_split_columns($pdo);

    /* Usage covers every leave type that spends this balance, not just the one it is stored under. */
    $trackedType = leave_credit_tracked_type_by_id($pdo, $leaveTypeId);
    $leaveTypeIds = $trackedType !== null
        ? leave_credit_charged_leave_type_ids([$trackedType])
        : [$leaveTypeId];
    $placeholders = implode(', ', array_fill(0, count($leaveTypeIds), '?'));

    $statement = $pdo->prepare(
        'SELECT COALESCE(SUM(COALESCE(paid_days, total_days)), 0)
         FROM leave_requests
         WHERE employee_id = ?
           AND LOWER(status) = "approved"
           AND YEAR(start_date) = ?
           AND leave_type_id IN (' . $placeholders . ')'
    );
    $statement->execute([$employeeId, $year, ...$leaveTypeIds]);

    return leave_credit_round((float)$statement->fetchColumn());
}

function leave_credit_actor_name(array $user): string
{
    $fullName = trim((string)($user['full_name'] ?? ''));
    $username = trim((string)($user['username'] ?? ''));

    return $fullName !== '' ? $fullName : $username;
}

function write_leave_credit_audit_log(
    PDO $pdo,
    array $sessionUser,
    string $action,
    int $employeeId,
    string $summary,
    array $details = []
): void {
    if (!leave_credit_audit_table_exists($pdo)) {
        return;
    }

    try {
        $context = audit_request_context();
        $userId = isset($sessionUser['id']) ? (int)$sessionUser['id'] : null;

        $statement = $pdo->prepare(
            'INSERT INTO audit_logs
                (user_id, action, ip_address, location, device, browser, os, actor_id, actor_name, actor_role, category, entity_type, entity_id, summary, details_json, user_agent)
             VALUES
                (:user_id, :action, :ip_address, :location, :device, :browser, :os, :actor_id, :actor_name, :actor_role, :category, :entity_type, :entity_id, :summary, :details_json, :user_agent)'
        );

        $statement->execute([
            ':user_id' => $userId,
            ':action' => $action,
            ':ip_address' => $context['ipAddress'],
            ':location' => $context['location'],
            ':device' => $context['device'],
            ':browser' => $context['browser'],
            ':os' => $context['os'],
            ':actor_id' => $userId,
            ':actor_name' => leave_credit_actor_name($sessionUser),
            ':actor_role' => $sessionUser['role'] ?? null,
            ':category' => 'leave_credit',
            ':entity_type' => 'employee',
            ':entity_id' => $employeeId,
            ':summary' => $summary,
            ':details_json' => audit_details_json($details, $context),
            ':user_agent' => $context['userAgent'],
        ]);
        audit_mark_entry_written();
    } catch (Throwable $exception) {
        // Leave balance updates should not fail only because optional audit logging is unavailable.
    }
}

function fetch_leave_credit_management_rows(PDO $pdo, ?int $year = null, bool $archived = false): array
{
    $resolvedYear = leave_credit_resolve_year($year);
    $definitions = leave_credit_default_definitions();
    $trackedTypes = leave_credit_type_rows($pdo);
    ensure_leave_request_pay_split_columns($pdo);
    ensure_archive_columns($pdo, 'leave_credits');
    apply_due_leave_credit_accruals($pdo, $resolvedYear);

    $employeeStatement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS division,
            des.name AS position,
            e.gender,
            e.status,
            e.employment_status AS employmentStatus,
            e.date_hired AS dateHired,
            (SELECT MIN(lc.created_at) FROM leave_credits lc WHERE lc.employee_id = e.id) AS trackedSince
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.is_archived = 0
         ORDER BY employeeName ASC, e.id ASC'
    );
    $employeeStatement->execute();
    $employees = $employeeStatement->fetchAll();

    if ($employees === []) {
        return [];
    }

    $employeeIds = array_map(
        static fn (array $employee): int => (int)$employee['employeeRecordId'],
        $employees
    );

    $balanceRowsByEmployee = [];
    $usageRowsByEmployee = [];
    $updatedAtByEmployee = [];
    $archiveStatesByEmployee = [];

    if ($trackedTypes !== []) {
        $leaveTypeIds = array_map(
            static fn (array $trackedType): int => (int)$trackedType['leave_type_id'],
            array_values($trackedTypes)
        );

        /* Balances are stored per pool, but usage comes from every leave type spending that pool. */
        $chargedLeaveTypeIds = leave_credit_charged_leave_type_ids($trackedTypes);

        $employeePlaceholders = implode(', ', array_fill(0, count($employeeIds), '?'));
        $leaveTypePlaceholders = implode(', ', array_fill(0, count($leaveTypeIds), '?'));
        $chargedLeaveTypePlaceholders = implode(', ', array_fill(0, count($chargedLeaveTypeIds), '?'));

        $balanceStatement = $pdo->prepare(
            'SELECT employee_id, leave_type_id, total_credits, updated_at, is_archived
             FROM leave_credits
             WHERE year = ?
               AND employee_id IN (' . $employeePlaceholders . ')
               AND leave_type_id IN (' . $leaveTypePlaceholders . ')'
        );
        $balanceStatement->execute([$resolvedYear, ...$employeeIds, ...$leaveTypeIds]);

        foreach ($balanceStatement->fetchAll() as $row) {
            $employeeId = (int)$row['employee_id'];
            $leaveTypeId = (int)$row['leave_type_id'];
            $rowIsArchived = (int)($row['is_archived'] ?? 0) === 1;
            $archiveStatesByEmployee[$employeeId][$rowIsArchived ? 1 : 0] = true;

            if ($rowIsArchived !== $archived) {
                continue;
            }

            $balanceRowsByEmployee[$employeeId][$leaveTypeId] = [
                'total' => leave_credit_round((float)($row['total_credits'] ?? 0)),
                'updatedAt' => (string)($row['updated_at'] ?? ''),
            ];

            $updatedAt = (string)($row['updated_at'] ?? '');
            if ($updatedAt !== '' && (!isset($updatedAtByEmployee[$employeeId]) || $updatedAt > $updatedAtByEmployee[$employeeId])) {
                $updatedAtByEmployee[$employeeId] = $updatedAt;
            }
        }

        $usageStatement = $pdo->prepare(
            'SELECT employee_id, leave_type_id, COALESCE(SUM(COALESCE(paid_days, total_days)), 0) AS used_credits
             FROM leave_requests
             WHERE LOWER(status) = "approved"
               AND YEAR(start_date) = ?
               AND employee_id IN (' . $employeePlaceholders . ')
               AND leave_type_id IN (' . $chargedLeaveTypePlaceholders . ')
             GROUP BY employee_id, leave_type_id'
        );
        $usageStatement->execute([$resolvedYear, ...$employeeIds, ...$chargedLeaveTypeIds]);

        foreach ($usageStatement->fetchAll() as $row) {
            $usageRowsByEmployee[(int)$row['employee_id']][(int)$row['leave_type_id']] = leave_credit_round((float)($row['used_credits'] ?? 0));
        }
    }

    $rows = [];

    foreach ($employees as $employee) {
        $employeeId = (int)$employee['employeeRecordId'];

        /*
         * A row here is an employee, and the balances behind it are their leave_credits rows. In the
         * normal view an employee with no stored row still belongs on screen — they fall back to the
         * default yearly entitlement below. In the archive view they do not: nothing of theirs was
         * archived, so listing them would fill the archive with every employee on default balances.
         */
        $hasMatchingBalanceRows = !empty($balanceRowsByEmployee[$employeeId]);
        $hasArchivedBalanceRows = !empty($archiveStatesByEmployee[$employeeId][1]);

        if ($archived && !$hasMatchingBalanceRows) {
            continue;
        }

        /*
         * The active registry still includes a new employee whose yearly credits have never been
         * materialized, because their default entitlement is useful there. Once that employee has
         * archived credit rows, however, treating the missing active rows as defaults would put the
         * employee straight back into the active table after a successful archive.
         */
        if (!$archived && !$hasMatchingBalanceRows && $hasArchivedBalanceRows) {
            continue;
        }

        $balanceMap = [];
        /*
         * The coming posting, shown against each accruing pool so the registry says what the
         * balance is about to become. Only a materialised, active balance earns credits (see
         * apply_due_leave_credit_accruals()), and only while the viewed year is the current one.
         */
        $accrualStart = leave_credit_accrual_start_month(
            (string)($employee['dateHired'] ?? ''),
            (string)($employee['trackedSince'] ?? '')
        );
        $accruesThisYear = !$archived
            && strcasecmp((string)($employee['status'] ?? ''), 'Active') === 0
            && $resolvedYear === (int)date('Y')
            && $accrualStart !== null;
        $nextAccrualDate = $accruesThisYear ? leave_credit_next_accrual_date($accrualStart) : '';

        foreach ($definitions as $definitionCode => $definition) {
            $trackedType = $trackedTypes[$definitionCode] ?? null;
            $leaveTypeId = (int)($trackedType['leave_type_id'] ?? 0);
            $storedRow = $leaveTypeId > 0 ? ($balanceRowsByEmployee[$employeeId][$leaveTypeId] ?? null) : null;

            $usedCredits = 0.0;
            foreach ($trackedType['charged_leave_type_ids'] ?? [] as $chargedLeaveTypeId) {
                $usedCredits += (float)($usageRowsByEmployee[$employeeId][(int)$chargedLeaveTypeId] ?? 0);
            }

            $totalCredits = $storedRow['total'] ?? leave_credit_round((float)$definition['total']);
            $remainingCredits = leave_credit_round($totalCredits - $usedCredits);
            $monthlyAccrual = $storedRow !== null && $nextAccrualDate !== ''
                ? leave_credit_monthly_accrual($definitionCode)
                : 0.0;

            $balanceMap[$definitionCode] = [
                'code' => (string)$definition['code'],
                'type' => (string)$definition['name'],
                'total' => leave_credit_round((float)$totalCredits),
                'used' => leave_credit_round($usedCredits),
                'remaining' => $remainingCredits,
                'monthlyAccrual' => $monthlyAccrual,
                'nextAccrualDate' => $monthlyAccrual > 0 ? $nextAccrualDate : '',
            ];
        }

        $rows[] = [
            'employeeRecordId' => $employeeId,
            'employeeId' => (string)($employee['employeeId'] ?? ''),
            'employeeName' => (string)($employee['employeeName'] ?? ''),
            'division' => (string)($employee['division'] ?? ''),
            'position' => (string)($employee['position'] ?? ''),
            'gender' => (string)($employee['gender'] ?? ''),
            'status' => (string)($employee['status'] ?? ''),
            'employmentStatus' => (string)($employee['employmentStatus'] ?? ''),
            'year' => $resolvedYear,
            'lastUpdated' => $updatedAtByEmployee[$employeeId] ?? '',
            'balanceMap' => $balanceMap,
        ];
    }

    return $rows;
}

function upsert_employee_leave_credit_balance(
    PDO $pdo,
    int $employeeId,
    int $leaveTypeId,
    int $year,
    float $remainingCredits
): array {
    $usedCredits = leave_credit_current_used_credits($pdo, $employeeId, $leaveTypeId, $year);
    $totalCredits = leave_credit_round($remainingCredits + $usedCredits);

    $statement = $pdo->prepare(
        'INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits)
         VALUES (:employee_id, :leave_type_id, :year, :total_credits, :used_credits)
         ON DUPLICATE KEY UPDATE
            total_credits = VALUES(total_credits),
            used_credits = VALUES(used_credits)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':leave_type_id' => $leaveTypeId,
        ':year' => $year,
        ':total_credits' => $totalCredits,
        ':used_credits' => $usedCredits,
    ]);

    $fetchStatement = $pdo->prepare(
        'SELECT total_credits, used_credits, remaining_credits, updated_at
         FROM leave_credits
         WHERE employee_id = :employee_id
           AND leave_type_id = :leave_type_id
           AND year = :year
         LIMIT 1'
    );
    $fetchStatement->execute([
        ':employee_id' => $employeeId,
        ':leave_type_id' => $leaveTypeId,
        ':year' => $year,
    ]);
    $record = $fetchStatement->fetch();

    return [
        'total' => leave_credit_round((float)($record['total_credits'] ?? $totalCredits)),
        'used' => leave_credit_round((float)($record['used_credits'] ?? $usedCredits)),
        'remaining' => leave_credit_round((float)($record['remaining_credits'] ?? $remainingCredits)),
        'updatedAt' => (string)($record['updated_at'] ?? ''),
    ];
}

function add_employee_leave_credit_amount(
    PDO $pdo,
    int $employeeId,
    int $leaveTypeId,
    int $year,
    float $amount
): array {
    ensure_employee_default_leave_credits($pdo, $employeeId, $year);

    $usedCredits = leave_credit_current_used_credits($pdo, $employeeId, $leaveTypeId, $year);

    $statement = $pdo->prepare(
        'INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits)
         VALUES (:employee_id, :leave_type_id, :year, :amount, :used_credits)
         ON DUPLICATE KEY UPDATE
            total_credits = total_credits + VALUES(total_credits),
            used_credits = VALUES(used_credits)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':leave_type_id' => $leaveTypeId,
        ':year' => $year,
        ':amount' => leave_credit_round($amount),
        ':used_credits' => $usedCredits,
    ]);

    $fetchStatement = $pdo->prepare(
        'SELECT total_credits, used_credits, remaining_credits, updated_at
         FROM leave_credits
         WHERE employee_id = :employee_id
           AND leave_type_id = :leave_type_id
           AND year = :year
         LIMIT 1'
    );
    $fetchStatement->execute([
        ':employee_id' => $employeeId,
        ':leave_type_id' => $leaveTypeId,
        ':year' => $year,
    ]);
    $record = $fetchStatement->fetch();

    return [
        'total' => leave_credit_round((float)($record['total_credits'] ?? 0)),
        'used' => leave_credit_round((float)($record['used_credits'] ?? $usedCredits)),
        'remaining' => leave_credit_round((float)($record['remaining_credits'] ?? 0)),
        'updatedAt' => (string)($record['updated_at'] ?? ''),
    ];
}

function reset_employee_leave_credit_balances(PDO $pdo, int $employeeId, int $year): array
{
    $definitions = leave_credit_default_definitions();
    $trackedTypes = leave_credit_type_rows($pdo);
    $results = [];

    foreach ($definitions as $definitionCode => $definition) {
        $trackedType = $trackedTypes[$definitionCode] ?? null;
        if ($trackedType === null) {
            continue;
        }

        $results[$definitionCode] = upsert_employee_leave_credit_balance(
            $pdo,
            $employeeId,
            (int)$trackedType['leave_type_id'],
            $year,
            leave_credit_round((float)$definition['total'])
        );
    }

    return $results;
}

/*
 * Vacation and sick leave are not granted in one lump. On the first day of every month each pool
 * earns a fixed number of credits on top of the yearly opening balance in
 * leave_credit_default_definitions(), with no ceiling: unused credits keep accumulating, as the CSC
 * rules allow for vacation and sick leave. The rate is the CSC Omnibus Rules' 1.25 days a month
 * (15 a year) and lives here so that changing it is one edit.
 */
function leave_credit_monthly_accrual_rates(): array
{
    return [
        'VL' => 1.25,
        'SL' => 1.25,
    ];
}

/** What one monthly posting adds to a pool; 0 for a pool that does not accrue. */
function leave_credit_monthly_accrual(string $code): float
{
    return leave_credit_round((float)(leave_credit_monthly_accrual_rates()[$code] ?? 0));
}

/*
 * Every posted accrual is written down once, keyed by employee, pool and month. That is what makes
 * posting safe to repeat on every read of the registry -- a month already on the ledger is skipped,
 * and the unique key means two requests racing on the same month post it once between them.
 */
function ensure_leave_credit_accrual_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $ensured = true;

    // Checked first because even a no-op CREATE is DDL and would commit a caller's open transaction.
    if (database_table_exists($pdo, 'leave_credit_accruals')) {
        return;
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS leave_credit_accruals (
            accrual_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_id INT UNSIGNED NOT NULL,
            leave_type_id INT NOT NULL,
            accrual_month DATE NOT NULL,
            amount DECIMAL(6,2) NOT NULL,
            remaining_before DECIMAL(6,2) NOT NULL DEFAULT 0.00,
            remaining_after DECIMAL(6,2) NOT NULL DEFAULT 0.00,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (accrual_id),
            UNIQUE KEY uq_leave_credit_accrual (employee_id, leave_type_id, accrual_month),
            KEY idx_leave_credit_accruals_month (accrual_month),
            CONSTRAINT fk_leave_credit_accruals_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
            CONSTRAINT fk_leave_credit_accruals_leave_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (leave_type_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/**
 * The first month an employee earns credits: the month after they were hired, or after their
 * balances started being tracked here, whichever is later.
 *
 * Counting from the tracking date rather than the hire date is deliberate. The opening balance
 * already stands in for the months before the registry existed, so posting those months again
 * would count them twice -- and it keeps the day this rule was switched on from handing every
 * long-serving employee a year of back credits at once.
 */
function leave_credit_accrual_start_month(?string $dateHired, ?string $trackedSince): ?DateTimeImmutable
{
    $latest = null;

    foreach ([$dateHired, $trackedSince] as $value) {
        $text = trim((string)$value);
        if ($text === '' || str_starts_with($text, '0000')) {
            continue;
        }

        try {
            $date = new DateTimeImmutable($text);
        } catch (Throwable $exception) {
            continue;
        }

        if ($latest === null || $date > $latest) {
            $latest = $date;
        }
    }

    return $latest?->modify('first day of next month')->setTime(0, 0);
}

/** The first of the month that will be posted next: always the coming month, never today's. */
function leave_credit_next_accrual_date(?DateTimeImmutable $startMonth = null): string
{
    $next = (new DateTimeImmutable('today'))->modify('first day of next month');

    if ($startMonth !== null && $startMonth > $next) {
        $next = $startMonth;
    }

    return $next->format('Y-m-d');
}

/**
 * Posts every monthly accrual that has come due for the year and is not yet on the ledger, and
 * returns how many it posted.
 *
 * It runs on every read of the registry and of an employee's own balances, which is what makes a
 * month's credits appear on its first day on a XAMPP box with no scheduler. Only balances that
 * already exist and are not archived earn credits: an employee whose year was never materialised
 * is still on the default entitlement, and an archived balance must not be quietly re-opened by a
 * system posting. Nothing is posted for a future year or a month that has not started.
 */
function apply_due_leave_credit_accruals(PDO $pdo, ?int $year = null, ?int $employeeId = null): int
{
    $trackedTypes = leave_credit_type_rows($pdo);
    $accruingTypes = [];

    foreach (leave_credit_monthly_accrual_rates() as $code => $amount) {
        $leaveTypeId = (int)($trackedTypes[$code]['leave_type_id'] ?? 0);
        if ($leaveTypeId > 0 && (float)$amount > 0) {
            $accruingTypes[$leaveTypeId] = $code;
        }
    }

    if ($accruingTypes === []) {
        return 0;
    }

    $year = leave_credit_resolve_year($year);
    $today = new DateTimeImmutable('today');
    $lastDueMonth = min(
        $today->modify('first day of this month')->setTime(0, 0),
        new DateTimeImmutable(sprintf('%04d-12-01', $year))
    );

    if ((int)$today->format('Y') < $year) {
        return 0;
    }

    // DDL commits any open transaction, so the ledger is made sure of before one is opened below.
    ensure_leave_credit_accrual_table($pdo);
    ensure_archive_columns($pdo, 'leave_credits');

    $leaveTypePlaceholders = implode(', ', array_fill(0, count($accruingTypes), '?'));
    $params = [$year, ...array_keys($accruingTypes)];
    $employeeCondition = '';

    if ($employeeId !== null) {
        $employeeCondition = ' AND lc.employee_id = ?';
        $params[] = $employeeId;
    }

    $statement = $pdo->prepare(
        'SELECT
            lc.employee_id,
            lc.leave_type_id,
            e.date_hired,
            (SELECT MIN(first.created_at) FROM leave_credits first WHERE first.employee_id = lc.employee_id) AS tracked_since,
            (SELECT MAX(posted.accrual_month)
               FROM leave_credit_accruals posted
              WHERE posted.employee_id = lc.employee_id
                AND posted.leave_type_id = lc.leave_type_id
                AND YEAR(posted.accrual_month) = lc.year) AS last_posted_month
         FROM leave_credits lc
         INNER JOIN employees e ON e.id = lc.employee_id
         WHERE lc.year = ?
           AND lc.is_archived = 0
           AND e.is_archived = 0
           AND LOWER(e.status) = "active"
           AND lc.leave_type_id IN (' . $leaveTypePlaceholders . ')' . $employeeCondition
    );
    $statement->execute($params);

    $due = [];
    foreach ($statement->fetchAll() as $row) {
        $startMonth = leave_credit_accrual_start_month((string)($row['date_hired'] ?? ''), (string)($row['tracked_since'] ?? ''));
        if ($startMonth === null) {
            continue;
        }

        $lastPosted = trim((string)($row['last_posted_month'] ?? ''));
        $month = $lastPosted !== ''
            ? (new DateTimeImmutable($lastPosted))->modify('first day of next month')
            : $startMonth;
        $month = max($month, new DateTimeImmutable(sprintf('%04d-01-01', $year)));

        while ($month <= $lastDueMonth) {
            $due[] = [(int)$row['employee_id'], (int)$row['leave_type_id'], $month->format('Y-m-d')];
            $month = $month->modify('first day of next month');
        }
    }

    if ($due === []) {
        return 0;
    }

    $ledgerStatement = $pdo->prepare(
        'INSERT IGNORE INTO leave_credit_accruals
            (employee_id, leave_type_id, accrual_month, amount, remaining_before, remaining_after)
         VALUES (:employee_id, :leave_type_id, :accrual_month, :amount, :remaining_before, :remaining_after)'
    );
    $balanceStatement = $pdo->prepare(
        'SELECT remaining_credits
         FROM leave_credits
         WHERE employee_id = :employee_id AND leave_type_id = :leave_type_id AND year = :year
         FOR UPDATE'
    );
    $creditStatement = $pdo->prepare(
        'UPDATE leave_credits
         SET total_credits = total_credits + :amount
         WHERE employee_id = :employee_id AND leave_type_id = :leave_type_id AND year = :year'
    );

    $ownsTransaction = !$pdo->inTransaction();
    if ($ownsTransaction) {
        $pdo->beginTransaction();
    }

    $posted = 0;

    try {
        foreach ($due as [$dueEmployeeId, $leaveTypeId, $accrualMonth]) {
            $balanceStatement->execute([
                ':employee_id' => $dueEmployeeId,
                ':leave_type_id' => $leaveTypeId,
                ':year' => $year,
            ]);
            $remainingBefore = leave_credit_round((float)$balanceStatement->fetchColumn());
            $amount = leave_credit_monthly_accrual($accruingTypes[$leaveTypeId]);

            $ledgerStatement->execute([
                ':employee_id' => $dueEmployeeId,
                ':leave_type_id' => $leaveTypeId,
                ':accrual_month' => $accrualMonth,
                ':amount' => $amount,
                ':remaining_before' => $remainingBefore,
                ':remaining_after' => leave_credit_round($remainingBefore + $amount),
            ]);

            // Zero rows means another request posted this month first; its credit stands.
            if ($ledgerStatement->rowCount() === 0 || $amount <= 0) {
                continue;
            }

            $creditStatement->execute([
                ':amount' => $amount,
                ':employee_id' => $dueEmployeeId,
                ':leave_type_id' => $leaveTypeId,
                ':year' => $year,
            ]);
            $posted++;
        }

        if ($ownsTransaction) {
            $pdo->commit();
        }
    } catch (Throwable $exception) {
        if ($ownsTransaction && $pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return $posted;
}

/**
 * The accrual entries for one employee's history, in the same shape as the audit log entries the
 * History dialog already renders, so a posting reads like any other balance change there.
 */
function fetch_employee_leave_credit_accrual_history(PDO $pdo, int $employeeId, int $year, string $leaveTypeCode = ''): array
{
    ensure_leave_credit_accrual_table($pdo);

    $statement = $pdo->prepare(
        'SELECT a.leave_type_id, a.accrual_month, a.amount, a.remaining_before, a.remaining_after, a.applied_at,
                lt.name AS leave_type_name, lt.code AS leave_type_code
         FROM leave_credit_accruals a
         INNER JOIN leave_types lt ON lt.leave_type_id = a.leave_type_id
         WHERE a.employee_id = :employee_id
           AND YEAR(a.accrual_month) = :year
         ORDER BY a.accrual_month DESC, a.leave_type_id ASC'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':year' => $year,
    ]);

    $entries = [];
    $normalizedCode = strtoupper(trim($leaveTypeCode));

    foreach ($statement->fetchAll() as $row) {
        $code = strtoupper(trim((string)($row['leave_type_code'] ?? '')));
        if ($normalizedCode !== '' && $code !== $normalizedCode) {
            continue;
        }

        $amount = leave_credit_round((float)($row['amount'] ?? 0));
        $monthLabel = (new DateTimeImmutable((string)$row['accrual_month']))->format('F Y');

        $entries[] = [
            'actorName' => 'System',
            'actorRole' => 'Monthly accrual',
            'action' => 'leave_credit.accrual',
            'summary' => $amount > 0
                ? sprintf(
                    'Monthly accrual: +%s %s credit(s) for %s.',
                    leave_credit_format_days($amount),
                    (string)$row['leave_type_name'],
                    $monthLabel
                )
                : sprintf(
                    'Monthly accrual: no %s credits added for %s.',
                    (string)$row['leave_type_name'],
                    $monthLabel
                ),
            'details' => [
                'year' => $year,
                'leaveTypeCode' => $code,
                'leaveTypeName' => (string)$row['leave_type_name'],
                'operation' => 'add',
                'amount' => $amount,
                'accrualMonth' => (string)$row['accrual_month'],
                'effectiveDate' => (string)$row['accrual_month'],
                'previousRemaining' => leave_credit_round((float)($row['remaining_before'] ?? 0)),
                'newRemaining' => leave_credit_round((float)($row['remaining_after'] ?? 0)),
            ],
            'createdAt' => (string)($row['applied_at'] ?? ''),
        ];
    }

    return $entries;
}

function fetch_employee_leave_credit_history(PDO $pdo, int $employeeId, ?int $year = null, string $leaveTypeCode = ''): array
{
    $resolvedYear = leave_credit_resolve_year($year);
    $normalizedCode = strtoupper(trim($leaveTypeCode));
    $historyLogs = [];

    if (leave_credit_audit_table_exists($pdo)) {
        try {
            $statement = $pdo->prepare(
                'SELECT actor_name, actor_role, action, summary, details_json, created_at
                 FROM audit_logs
                 WHERE category = :category
                   AND entity_type = :entity_type
                   AND entity_id = :entity_id
                 ORDER BY created_at DESC
                 LIMIT 100'
            );
            $statement->execute([
                ':category' => 'leave_credit',
                ':entity_type' => 'employee',
                ':entity_id' => $employeeId,
            ]);

            foreach ($statement->fetchAll() as $row) {
                $details = json_decode((string)($row['details_json'] ?? ''), true);
                if (!is_array($details)) {
                    $details = [];
                }

                $detailYear = (int)($details['year'] ?? 0);
                $detailCode = strtoupper(trim((string)($details['leaveTypeCode'] ?? '')));

                if ($detailYear > 0 && $detailYear !== $resolvedYear) {
                    continue;
                }
                if ($normalizedCode !== '' && $detailCode !== '' && $detailCode !== $normalizedCode) {
                    continue;
                }

                $historyLogs[] = [
                    'actorName' => (string)($row['actor_name'] ?? ''),
                    'actorRole' => (string)($row['actor_role'] ?? ''),
                    'action' => (string)($row['action'] ?? ''),
                    'summary' => (string)($row['summary'] ?? ''),
                    'details' => $details,
                    'createdAt' => (string)($row['created_at'] ?? ''),
                ];
            }
        } catch (Throwable $exception) {
            $historyLogs = [];
        }
    }

    /* Postings sit in the trail alongside HR's own changes, newest first like the rest. */
    $historyLogs = array_merge(
        $historyLogs,
        fetch_employee_leave_credit_accrual_history($pdo, $employeeId, $resolvedYear, $normalizedCode)
    );
    usort(
        $historyLogs,
        static fn (array $left, array $right): int => strcmp((string)$right['createdAt'], (string)$left['createdAt'])
    );

    $managementRows = fetch_leave_credit_management_rows($pdo, $resolvedYear);
    $matchedRow = null;
    foreach ($managementRows as $row) {
        if ((int)($row['employeeRecordId'] ?? 0) === $employeeId) {
            $matchedRow = $row;
            break;
        }
    }

    $snapshot = [];
    if (is_array($matchedRow['balanceMap'] ?? null)) {
        foreach ($matchedRow['balanceMap'] as $balanceCode => $balance) {
            $upperCode = strtoupper(trim((string)$balanceCode));
            if ($normalizedCode !== '' && $upperCode !== $normalizedCode) {
                continue;
            }

            $snapshot[] = [
                'code' => (string)($balance['code'] ?? $upperCode),
                'type' => (string)($balance['type'] ?? ''),
                'total' => leave_credit_round((float)($balance['total'] ?? 0)),
                'used' => leave_credit_round((float)($balance['used'] ?? 0)),
                'remaining' => leave_credit_round((float)($balance['remaining'] ?? 0)),
                'updatedAt' => (string)($matchedRow['lastUpdated'] ?? ''),
            ];
        }
    }

    return [
        'year' => $resolvedYear,
        'logs' => $historyLogs,
        'snapshot' => $snapshot,
    ];
}
