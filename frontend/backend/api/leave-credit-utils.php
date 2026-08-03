<?php
declare(strict_types=1);

function leave_credit_default_definitions(): array
{
    return [
        'VL' => [
            'code' => 'VL',
            'name' => 'Vacation Leave',
            'total' => 15.0,
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
        'FL' => [
            'code' => 'FL',
            'name' => 'Forced Leave',
            'total' => 5.0,
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

function leave_credit_type_rows(PDO $pdo): array
{
    $definitions = leave_credit_default_definitions();
    $names = array_map(
        static fn (array $definition): string => (string)$definition['name'],
        array_values($definitions)
    );
    $codes = array_map(
        static fn (array $definition): string => (string)$definition['code'],
        array_values($definitions)
    );

    $placeholders = implode(', ', array_fill(0, count($definitions), '?'));
    $statement = $pdo->prepare(
        'SELECT leave_type_id, name, code
         FROM leave_types
         WHERE is_active = 1
           AND (name IN (' . $placeholders . ') OR code IN (' . $placeholders . '))'
    );
    $statement->execute([...$names, ...$codes]);

    $trackedTypes = [];
    foreach ($statement->fetchAll() as $row) {
        $rowName = strtolower(trim((string)($row['name'] ?? '')));
        $rowCode = strtoupper(trim((string)($row['code'] ?? '')));

        foreach ($definitions as $definitionCode => $definition) {
            if (
                $rowCode === strtoupper((string)$definition['code'])
                || $rowName === strtolower((string)$definition['name'])
            ) {
                $trackedTypes[$definitionCode] = [
                    'leave_type_id' => (int)$row['leave_type_id'],
                    'code' => (string)$definition['code'],
                    'name' => (string)$definition['name'],
                    'total' => (float)$definition['total'],
                ];
            }
        }
    }

    return $trackedTypes;
}

function leave_credit_tracked_type_by_id(PDO $pdo, int $leaveTypeId): ?array
{
    foreach (leave_credit_type_rows($pdo) as $trackedType) {
        if ((int)$trackedType['leave_type_id'] === $leaveTypeId) {
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

    ensure_employee_default_leave_credits($pdo, $employeeId, $year);

    $leaveTypeIds = array_map(
        static fn (array $trackedType): int => (int)$trackedType['leave_type_id'],
        array_values($trackedTypes)
    );
    $placeholders = implode(', ', array_fill(0, count($leaveTypeIds), '?'));

    $usageStatement = $pdo->prepare(
        'SELECT leave_type_id, COALESCE(SUM(total_days), 0) AS used_credits
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
        $leaveTypeId = (int)$trackedType['leave_type_id'];
        $updateStatement->execute([
            ':used_credits' => $usageMap[$leaveTypeId] ?? 0,
            ':employee_id' => $employeeId,
            ':leave_type_id' => $leaveTypeId,
            ':year' => $year,
        ]);
    }
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
        'balances' => $balances,
        'balanceMap' => $balanceMap,
    ];
}

function validate_leave_credit_approval(PDO $pdo, int $employeeId, int $leaveTypeId, float $numberOfDays, ?string $startDate = null): void
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

    if ($numberOfDays > $remaining) {
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
        hris_ensure_audit_logs_table($pdo);
        $exists = true;
    } catch (Throwable $exception) {
        $exists = false;
    }

    return $exists;
}

function leave_credit_current_used_credits(PDO $pdo, int $employeeId, int $leaveTypeId, int $year): float
{
    $statement = $pdo->prepare(
        'SELECT COALESCE(SUM(total_days), 0)
         FROM leave_requests
         WHERE employee_id = :employee_id
           AND leave_type_id = :leave_type_id
           AND LOWER(status) = "approved"
           AND YEAR(start_date) = :year'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':leave_type_id' => $leaveTypeId,
        ':year' => $year,
    ]);

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
        $context = hris_audit_request_context();
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
            ':details_json' => hris_audit_details_json($details, $context),
            ':user_agent' => $context['userAgent'],
        ]);
    } catch (Throwable $exception) {
        // Leave balance updates should not fail only because optional audit logging is unavailable.
    }
}

function fetch_leave_credit_management_rows(PDO $pdo, ?int $year = null): array
{
    $resolvedYear = leave_credit_resolve_year($year);
    $definitions = leave_credit_default_definitions();
    $trackedTypes = leave_credit_type_rows($pdo);

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

        $employeePlaceholders = implode(', ', array_fill(0, count($employeeIds), '?'));
        $leaveTypePlaceholders = implode(', ', array_fill(0, count($leaveTypeIds), '?'));

        $balanceStatement = $pdo->prepare(
            'SELECT employee_id, leave_type_id, total_credits, updated_at
             FROM leave_credits
             WHERE year = ?
               AND employee_id IN (' . $employeePlaceholders . ')
               AND leave_type_id IN (' . $leaveTypePlaceholders . ')'
        );
        $balanceStatement->execute([$resolvedYear, ...$employeeIds, ...$leaveTypeIds]);

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
            'SELECT employee_id, leave_type_id, COALESCE(SUM(total_days), 0) AS used_credits
             FROM leave_requests
             WHERE LOWER(status) = "approved"
               AND YEAR(start_date) = ?
               AND employee_id IN (' . $employeePlaceholders . ')
               AND leave_type_id IN (' . $leaveTypePlaceholders . ')
             GROUP BY employee_id, leave_type_id'
        );
        $usageStatement->execute([$resolvedYear, ...$employeeIds, ...$leaveTypeIds]);

        foreach ($usageStatement->fetchAll() as $row) {
            $usageRowsByEmployee[(int)$row['employee_id']][(int)$row['leave_type_id']] = leave_credit_round((float)($row['used_credits'] ?? 0));
        }
    }

    $rows = [];

    foreach ($employees as $employee) {
        $employeeId = (int)$employee['employeeRecordId'];
        $balanceMap = [];

        foreach ($definitions as $definitionCode => $definition) {
            $trackedType = $trackedTypes[$definitionCode] ?? null;
            $leaveTypeId = (int)($trackedType['leave_type_id'] ?? 0);
            $storedRow = $leaveTypeId > 0 ? ($balanceRowsByEmployee[$employeeId][$leaveTypeId] ?? null) : null;
            $usedCredits = $leaveTypeId > 0 ? (float)($usageRowsByEmployee[$employeeId][$leaveTypeId] ?? 0) : 0.0;
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
