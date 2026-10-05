<?php
declare(strict_types=1);

/** Return the sequence carried by either the current numeric ID or the legacy EMPYYYY-NNNN ID. */
function employee_id_sequence_number(mixed $value): ?int
{
    $employeeId = trim((string)($value ?? ''));
    if ($employeeId === '') {
        return null;
    }

    if (preg_match('/^\d+$/', $employeeId) === 1) {
        $number = (int)$employeeId;
        return $number > 0 ? $number : null;
    }

    if (preg_match('/^EMP\d{4}-(\d+)$/i', $employeeId, $matches) === 1) {
        $number = (int)$matches[1];
        return $number > 0 ? $number : null;
    }

    return null;
}

function employee_id_is_legacy(mixed $value): bool
{
    return preg_match('/^EMP\d{4}-\d+$/i', trim((string)($value ?? ''))) === 1;
}

function format_employee_id(int $number): string
{
    return str_pad((string)max(1, $number), 4, '0', STR_PAD_LEFT);
}

function normalize_employee_id(mixed $value): string
{
    $employeeId = trim((string)($value ?? ''));
    $number = employee_id_sequence_number($employeeId);

    return $number === null ? $employeeId : format_employee_id($number);
}

/** Generate one organization-wide numeric employee ID, without the old EMP/year prefix. */
function next_employee_id(PDO $pdo): string
{
    $statement = $pdo->query('SELECT employee_id FROM employees');
    $maxNumber = 0;

    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $employeeId) {
        $number = employee_id_sequence_number($employeeId);
        if ($number !== null) {
            $maxNumber = max($maxNumber, $number);
        }
    }

    return format_employee_id($maxNumber + 1);
}

/**
 * Convert saved EMPYYYY-NNNN values to NNNN once. Internal relationships use employees.id, so the
 * public employee code can change without rewriting leave, attendance, payroll, or other records.
 * If two legacy years reused the same suffix, the later record receives the next free number.
 */
function migrate_legacy_employee_ids(PDO $pdo): void
{
    $migrationKey = 'employee_id_compact_numeric_v1';

    if (!database_table_exists($pdo, 'employees')
        || get_boolean_application_setting($pdo, $migrationKey, false)
    ) {
        return;
    }

    $pdo->beginTransaction();

    try {
        $rows = $pdo->query(
            'SELECT id, employee_id
             FROM employees
             ORDER BY id ASC
             FOR UPDATE'
        )->fetchAll();
        $usedIds = [];
        $legacyRows = [];
        $maxNumber = 0;

        foreach ($rows as $row) {
            $employeeId = trim((string)($row['employee_id'] ?? ''));
            $number = employee_id_sequence_number($employeeId);
            if ($number !== null) {
                $maxNumber = max($maxNumber, $number);
            }

            if (employee_id_is_legacy($employeeId)) {
                $legacyRows[] = $row;
            } elseif ($employeeId !== '') {
                $usedIds[strtolower($employeeId)] = true;
            }
        }

        $update = $pdo->prepare('UPDATE employees SET employee_id = :employee_id WHERE id = :id');

        foreach ($legacyRows as $row) {
            $number = employee_id_sequence_number($row['employee_id'] ?? '') ?? ($maxNumber + 1);
            $candidate = format_employee_id($number);

            while (isset($usedIds[strtolower($candidate)])) {
                $maxNumber++;
                $candidate = format_employee_id($maxNumber);
            }

            $maxNumber = max($maxNumber, $number);
            $usedIds[strtolower($candidate)] = true;
            $update->execute([
                ':employee_id' => $candidate,
                ':id' => (int)$row['id'],
            ]);
        }

        // Certificates keep a display snapshot of the code in addition to the numeric employee FK.
        if ($legacyRows !== [] && database_table_exists($pdo, 'reward_certificates')) {
            $pdo->exec(
                'UPDATE reward_certificates certificate
                 INNER JOIN employees employee ON employee.id = certificate.employee_record_id
                 SET certificate.employee_code = employee.employee_id
                 WHERE certificate.employee_code REGEXP "^EMP[0-9]{4}-[0-9]+$"'
            );
        }

        store_boolean_application_setting($pdo, $migrationKey, true);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }
}
