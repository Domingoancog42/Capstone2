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

function ensure_employee_default_leave_credits(PDO $pdo, int $employeeId, ?int $year = null): void
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

    foreach ($trackedTypes as $trackedType) {
        $statement->execute([
            ':employee_id' => $employeeId,
            ':leave_type_id' => (int)$trackedType['leave_type_id'],
            ':year' => $year,
            ':total_credits' => (float)$trackedType['total'],
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
        recalculate_employee_leave_credit_usage($pdo, $employeeId, $year);
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
        $balance = [
            'code' => (string)$definition['code'],
            'type' => (string)$definition['name'],
            'total' => $record['total'] ?? leave_credit_round((float)$definition['total']),
            'used' => $record['used'] ?? 0.0,
            'remaining' => $record['remaining'] ?? leave_credit_round((float)$definition['total']),
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
    ];
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

    $employees = $pdo->query(
        'SELECT
            e.id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS division,
            des.name AS position,
            e.gender,
            e.status,
            e.employment_status AS employmentStatus
         FROM employees e
         INNER JOIN divisions d ON d.id = e.division_id
         INNER JOIN designations des ON des.id = e.designation_id
         WHERE e.is_archived = 0
         ORDER BY employeeName ASC, e.id ASC'
    )->fetchAll();

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
            'SELECT employee_id, leave_type_id, total_credits, updated_at
             FROM leave_credits
             WHERE year = ?
               AND is_archived = ?
               AND employee_id IN (' . $employeePlaceholders . ')
               AND leave_type_id IN (' . $leaveTypePlaceholders . ')'
        );
        $balanceStatement->execute([$resolvedYear, $archived ? 1 : 0, ...$employeeIds, ...$leaveTypeIds]);

        foreach ($balanceStatement->fetchAll() as $row) {
            $employeeId = (int)$row['employee_id'];
            $leaveTypeId = (int)$row['leave_type_id'];
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
        if ($archived && empty($balanceRowsByEmployee[$employeeId])) {
            continue;
        }

        $balanceMap = [];

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

            $balanceMap[$definitionCode] = [
                'code' => (string)$definition['code'],
                'type' => (string)$definition['name'],
                'total' => leave_credit_round((float)$totalCredits),
                'used' => leave_credit_round($usedCredits),
                'remaining' => $remainingCredits,
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
