<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/performance-export.php';

$sessionUser = require_session_user();

function ipcr_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function ipcr_role_key(array $user): string
{
    return user_role_key($user);
}

function ipcr_can_view_all(array $user): bool
{
    return in_array(ipcr_role_key($user), ['admin', 'hrhead', 'hrstaff', 'chief', 'planningofficer', 'regionaldirector'], true);
}

function ipcr_can_manage(array $user): bool
{
    return in_array(ipcr_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

/** IPCR creation belongs exclusively to the HR Head and becomes active immediately. */
function ipcr_can_create(array $user): bool
{
    return ipcr_role_key($user) === 'hrhead';
}

function ipcr_is_chief(array $user): bool
{
    return ipcr_role_key($user) === 'chief';
}

/**
 * The division a chief's IPCR desk is confined to, taken from their own employee record and falling
 * back to the division name on the session. 0 when none resolves, which the scope turns into an
 * empty list rather than everybody's.
 */
function ipcr_session_division_id(PDO $pdo, array $user): int
{
    $employeeRecordId = session_employee_record_id($pdo, $user);
    if ($employeeRecordId !== null) {
        $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
        $statement->execute([':id' => $employeeRecordId]);
        $divisionId = (int)$statement->fetchColumn();
        if ($divisionId > 0) {
            return $divisionId;
        }
    }

    $division = ipcr_text($user['division'] ?? '');
    if ($division === '') {
        return 0;
    }

    // Native prepares are on, so a placeholder cannot be reused across two markers.
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

    return (int)$statement->fetchColumn();
}

function ipcr_column_exists(PDO $pdo, string $table, string $column): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name
           AND COLUMN_NAME = :column_name'
    );
    $statement->execute([
        ':table_name' => $table,
        ':column_name' => $column,
    ]);

    return (int)$statement->fetchColumn() > 0;
}

function ensure_ipcr_tables(PDO $pdo): void
{
    $columns = [
        'kpi_category' => "ALTER TABLE ipcr ADD COLUMN kpi_category VARCHAR(40) NOT NULL DEFAULT 'Program' AFTER success_indicator",
        /*
         * The printed form sets two target columns beside each output -- "...submitted within 45
         * working days after fieldwork" and "...within 42 working days after fieldwork". The second
         * is optional; a row saved without one prints only the first.
         */
        'second_indicator' => 'ALTER TABLE ipcr ADD COLUMN second_indicator TEXT NULL AFTER success_indicator',
        /*
         * The organizational outcome and program band the form prints above the category -- "OO3:
         * ADAPTIVE CAPACITIES ... - PROGRAM 1: GEOLOGICAL RISK REDUCTION AND RESILIENCY PROGRAM"
         * over "GROUNDWATER RESOURCE ASSESSMENT". Optional: a KPI without one prints its category
         * band alone, the way every record filed before this column existed does.
         */
        'program' => 'ALTER TABLE ipcr ADD COLUMN program VARCHAR(255) NULL AFTER kpi_category',
        /*
         * The employee's own scores, kept apart from q1/e2/t3, which only the rater writes when they
         * validate the KPI. The rater may adjust what the employee claimed, and the self-rating stays
         * on record beside the final one.
         */
        'self_q1_rating' => 'ALTER TABLE ipcr ADD COLUMN self_q1_rating DECIMAL(5,2) NULL AFTER a4_rating',
        'self_e2_rating' => 'ALTER TABLE ipcr ADD COLUMN self_e2_rating DECIMAL(5,2) NULL AFTER self_q1_rating',
        'self_t3_rating' => 'ALTER TABLE ipcr ADD COLUMN self_t3_rating DECIMAL(5,2) NULL AFTER self_e2_rating',
        'status' =>"ALTER TABLE ipcr ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'draft' AFTER submitted_at",
        // Legacy reviewer columns remain for compatibility with existing databases and audit exports.
        'assigned_by_user_id' => 'ALTER TABLE ipcr ADD COLUMN assigned_by_user_id INT UNSIGNED NULL AFTER status',
        'reviewed_by_user_id' => 'ALTER TABLE ipcr ADD COLUMN reviewed_by_user_id INT UNSIGNED NULL AFTER assigned_by_user_id',
        'reviewed_at' => 'ALTER TABLE ipcr ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by_user_id',
        'approval_remarks' => 'ALTER TABLE ipcr ADD COLUMN approval_remarks TEXT NULL AFTER reviewed_at',
        'created_at' => 'ALTER TABLE ipcr ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER is_archived',
        'updated_at' => 'ALTER TABLE ipcr ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    ];

    foreach ($columns as $column => $sql) {
        if (!ipcr_column_exists($pdo, 'ipcr', $column)) {
            $pdo->exec($sql);
        }
    }

    /* Release records left in the removed approval workflow so employees can use them immediately. */
    $pdo->exec(
        "UPDATE ipcr
         SET status = 'draft',
             reviewed_by_user_id = NULL,
             reviewed_at = NULL,
             approval_remarks = NULL
         WHERE status IN ('pending_approval', 'returned')"
    );
}

function ipcr_date_or_default(mixed $value, string $fallback): string
{
    $text = ipcr_text($value);
    if ($text === '') {
        return $fallback;
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : $fallback;
}

function ipcr_decimal_or_null(mixed $value): ?float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return null;
    }

    return round((float)$value, 2);
}

function ipcr_request_body(): array
{
    if (!empty($_POST)) {
        return $_POST;
    }

    return read_json_body();
}

function ipcr_files_for_records(PDO $pdo, array $recordIds): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $recordIds))));
    if ($ids === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT
            id,
            ipcr_id AS ipcrId,
            output_id AS outputId,
            original_name AS originalName,
            stored_path AS storedPath,
            file_size AS fileSize,
            mime_type AS mimeType,
            created_at AS createdAt
         FROM ipcr_verification_files
         WHERE ipcr_id IN ({$placeholders})
         ORDER BY created_at DESC, id DESC"
    );
    $statement->execute($ids);

    $grouped = [];
    foreach ($statement->fetchAll() as $file) {
        $grouped[(int)$file['ipcrId']][] = $file;
    }

    return $grouped;
}

function ipcr_format_record(array $row, array $files = []): array
{
    $recordId = (int)($row['ipcrId'] ?? $row['ipcr_id'] ?? 0);
    $selfScores = array_map(
        static fn (string $column): ?float => isset($row[$column]) && $row[$column] !== null ? (float)$row[$column] : null,
        ['selfQ1Rating', 'selfE2Rating', 'selfT3Rating']
    );

    return [
        'id' => $recordId,
        'ipcrId' => $recordId,
        'employeeRecordId' => (int)($row['employeeRecordId'] ?? $row['employee_id'] ?? 0),
        'employeeId' => $row['employeeCode'] ?? $row['employee_id_number'] ?? null,
        'employeeCode' => $row['employeeCode'] ?? $row['employee_id_number'] ?? null,
        'employeeName' => $row['employeeName'] ?? null,
        'division' => $row['division'] ?? null,
        'position' => $row['position'] ?? null,
        'periodFrom' => $row['periodFrom'] ?? null,
        'periodTo' => $row['periodTo'] ?? null,
        'output' => $row['output'] ?? null,
        'kpiTitle' => $row['output'] ?? null,
        'successIndicator' => $row['successIndicator'] ?? null,
        'secondIndicator' => $row['secondIndicator'] ?? null,
        'program' => $row['program'] ?? null,
        'category' => $row['kpiCategory'] ?? 'Program',
        'kpiCategory' => $row['kpiCategory'] ?? 'Program',
        'actualAccomplishment' => $row['actualAccomplishment'] ?? null,
        'remarks' => $row['remarks'] ?? null,
        'finalRating' => $row['finalRating'] !== null ? (float)$row['finalRating'] : null,
        'q1Rating' => $row['q1Rating'] !== null ? (float)$row['q1Rating'] : null,
        'e2Rating' => $row['e2Rating'] !== null ? (float)$row['e2Rating'] : null,
        't3Rating' => $row['t3Rating'] !== null ? (float)$row['t3Rating'] : null,
        'a4Rating' => $row['a4Rating'] !== null ? (float)$row['a4Rating'] : null,
        'selfQ1Rating' => $selfScores[0],
        'selfE2Rating' => $selfScores[1],
        'selfT3Rating' => $selfScores[2],
        'selfAverage' => in_array(null, $selfScores, true) ? null : round(array_sum($selfScores) / 3, 2),
        'modeOfVerificationName' => $row['modeOfVerificationName'] ?? null,
        'modeOfVerificationPath' => $row['modeOfVerificationPath'] ?? null,
        'modeOfVerificationSize' => $row['modeOfVerificationSize'] !== null ? (int)$row['modeOfVerificationSize'] : null,
        'submittedAt' => $row['submittedAt'] ?? null,
        'status' => $row['status'] ?? 'draft',
        'assignedByUserId' => isset($row['assignedByUserId']) && $row['assignedByUserId'] !== null ? (int)$row['assignedByUserId'] : null,
        'assignedByName' => $row['assignedByName'] ?? null,
        'reviewedByUserId' => isset($row['reviewedByUserId']) && $row['reviewedByUserId'] !== null ? (int)$row['reviewedByUserId'] : null,
        'reviewedByName' => $row['reviewedByName'] ?? null,
        'reviewedAt' => $row['reviewedAt'] ?? null,
        'approvalRemarks' => $row['approvalRemarks'] ?? null,
        'createdAt' => $row['createdAt'] ?? null,
        'updatedAt' => $row['updatedAt'] ?? null,
        'verificationFiles' => $files[$recordId] ?? [],
    ];
}

/**
 * The display name of the account behind a user-id column: the linked employee's name, or the
 * username for an account with no employee record (an administrator, typically).
 */
function ipcr_user_name_sql(string $column): string
{
    return 'COALESCE(
                (SELECT TRIM(CONCAT(ue.first_name, " ", COALESCE(ue.middle_name, ""), " ", ue.last_name))
                 FROM users uu
                 INNER JOIN employees ue
                    ON ue.email COLLATE utf8mb4_unicode_ci = uu.email COLLATE utf8mb4_unicode_ci
                   AND ue.is_archived = 0
                 WHERE uu.id = ' . $column . '
                 ORDER BY ue.id ASC
                 LIMIT 1),
                (SELECT uu2.username FROM users uu2 WHERE uu2.id = ' . $column . ' LIMIT 1)
            )';
}

function ipcr_base_select(): string
{
    return 'SELECT
            i.ipcr_id AS ipcrId,
            i.employee_id AS employeeRecordId,
            e.employee_id AS employeeCode,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS division,
            des.name AS position,
            i.period_from AS periodFrom,
            i.period_to AS periodTo,
            i.output,
            i.success_indicator AS successIndicator,
            i.second_indicator AS secondIndicator,
            i.program,
            i.kpi_category AS kpiCategory,
            i.actual_accomplishment AS actualAccomplishment,
            i.remarks,
            i.final_rating AS finalRating,
            i.q1_rating AS q1Rating,
            i.e2_rating AS e2Rating,
            i.t3_rating AS t3Rating,
            i.a4_rating AS a4Rating,
            i.self_q1_rating AS selfQ1Rating,
            i.self_e2_rating AS selfE2Rating,
            i.self_t3_rating AS selfT3Rating,
            i.mode_of_verification_name AS modeOfVerificationName,
            i.mode_of_verification_path AS modeOfVerificationPath,
            i.mode_of_verification_size AS modeOfVerificationSize,
            i.submitted_at AS submittedAt,
            i.status,
            i.assigned_by_user_id AS assignedByUserId,
            ' . ipcr_user_name_sql('i.assigned_by_user_id') . ' AS assignedByName,
            i.reviewed_by_user_id AS reviewedByUserId,
            ' . ipcr_user_name_sql('i.reviewed_by_user_id') . ' AS reviewedByName,
            i.reviewed_at AS reviewedAt,
            i.approval_remarks AS approvalRemarks,
            i.created_at AS createdAt,
            i.updated_at AS updatedAt
        FROM ipcr i
        INNER JOIN employees e ON e.id = i.employee_id
        LEFT JOIN divisions d ON d.id = e.division_id
        LEFT JOIN designations des ON des.id = e.designation_id';
}

/** SQL for the caller's own records -- what My IPCR shows, whatever the role. */
function ipcr_own_records_scope(PDO $pdo, array $user, array &$where, array &$params): bool
{
    $employeeRecordId = session_employee_record_id($pdo, $user);
    if ($employeeRecordId === null) {
        return false;
    }

    $where[] = 'i.employee_id = :employee_id';
    $params[':employee_id'] = $employeeRecordId;

    return true;
}

/**
 * Which records a caller may read.
 *
 * HR, planning, and the Regional Director read organization-wide. A chief reads their own division
 * -- every record in it, whoever assigned it, since the chief also reviews and rates them. Everyone
 * else reads their own records only. `scope=own` asks for that same personal view from
 * any role, which is what My IPCR passes so a chief's or HR Head's own page never fills up with
 * everybody else's records.
 *
 * `$excludeSelf` drops the chief's own record from the division list: the management desk lists the
 * division's staff, and the chief's own IPCR belongs on My IPCR.
 */
function ipcr_apply_read_scope(PDO $pdo, array $user, array &$where, array &$params, bool $excludeSelf = false): bool
{
    $ownScope = ipcr_text($_GET['scope'] ?? '') === 'own';

    if ($ownScope || !ipcr_can_view_all($user)) {
        return ipcr_own_records_scope($pdo, $user, $where, $params);
    }

    if (ipcr_is_chief($user)) {
        $divisionId = ipcr_session_division_id($pdo, $user);
        if ($divisionId <= 0) {
            return false;
        }

        $where[] = 'e.division_id = :scope_division_id';
        $params[':scope_division_id'] = $divisionId;

        $selfRecordId = session_employee_record_id($pdo, $user);
        if ($excludeSelf && $selfRecordId !== null) {
            $where[] = 'i.employee_id <> :scope_self_employee_id';
            $params[':scope_self_employee_id'] = $selfRecordId;
        }
    }

    return true;
}

function ipcr_fetch_records(PDO $pdo, array $user): void
{
    $params = [':is_archived' => archived_view_requested() ? 1 : 0];
    $where = ['i.is_archived = :is_archived'];

    if (!ipcr_apply_read_scope($pdo, $user, $where, $params, true)) {
        json_response(['success' => true, 'records' => []]);
    }

    $status = ipcr_text($_GET['status'] ?? '');
    if ($status !== '') {
        $where[] = 'i.status = :status';
        $params[':status'] = $status;
    }

    $sql = ipcr_base_select() . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY i.created_at DESC, i.ipcr_id DESC';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $rows = $statement->fetchAll();

    $files = ipcr_files_for_records($pdo, array_column($rows, 'ipcrId'));
    $records = array_map(static fn (array $row): array => ipcr_format_record($row, $files), $rows);

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

function ipcr_fetch_record(PDO $pdo, array $user, int $ipcrId, bool $archived = false): array
{
    if ($ipcrId <= 0) {
        json_response(['success' => false, 'message' => 'IPCR record is required.'], 422);
    }

    $params = [':ipcr_id' => $ipcrId, ':is_archived' => $archived ? 1 : 0];
    $where = ['i.ipcr_id = :ipcr_id', 'i.is_archived = :is_archived'];

    if (!ipcr_apply_read_scope($pdo, $user, $where, $params)) {
        json_response(['success' => false, 'message' => 'IPCR record not found.'], 404);
    }

    $statement = $pdo->prepare(ipcr_base_select() . ' WHERE ' . implode(' AND ', $where) . ' LIMIT 1');
    $statement->execute($params);
    $row = $statement->fetch();

    if (!$row) {
        json_response(['success' => false, 'message' => 'IPCR record not found.'], 404);
    }

    $files = ipcr_files_for_records($pdo, [(int)$row['ipcrId']]);
    return ipcr_format_record($row, $files);
}

function ipcr_view_record(PDO $pdo, array $user): void
{
    $record = ipcr_fetch_record($pdo, $user, (int)($_GET['ipcr_id'] ?? 0));
    json_response([
        'success' => true,
        'record' => $record,
    ]);
}

function ipcr_employee_ids_from_payload(array $body): array
{
    $rawIds = $body['employee_ids'] ?? $body['employeeIds'] ?? $body['employee_id'] ?? $body['employeeId'] ?? [];

    if (!is_array($rawIds)) {
        $rawIds = [$rawIds];
    }

    return array_values(array_unique(array_filter(array_map('intval', $rawIds), static fn (int $id): bool => $id > 0)));
}

/**
 * One bulk assignment can carry several KPIs, so the payload may hold a `kpis` array. A payload
 * that still names a single KPI at the top level is read as a one-row list.
 */
function ipcr_kpi_rows_from_payload(array $body, string $periodFrom, string $periodTo): array
{
    $rawRows = $body['kpis'] ?? $body['kpi_rows'] ?? null;
    if (!is_array($rawRows) || $rawRows === []) {
        $rawRows = [$body];
    }

    $rows = [];
    foreach ($rawRows as $rawRow) {
        if (!is_array($rawRow)) {
            continue;
        }

        $output = ipcr_text($rawRow['output'] ?? $rawRow['kpiTitle'] ?? $rawRow['kpi_title'] ?? '');
        $successIndicator = ipcr_text($rawRow['success_indicator'] ?? $rawRow['successIndicator'] ?? '');
        if ($output === '' || $successIndicator === '') {
            continue;
        }

        $category = ipcr_text($rawRow['kpi_category'] ?? $rawRow['kpiCategory'] ?? $rawRow['category'] ?? 'Program');
        if ($category === '') {
            $category = 'Program';
        }

        $rows[] = [
            'output' => $output,
            'successIndicator' => $successIndicator,
            'secondIndicator' => ipcr_text($rawRow['second_indicator'] ?? $rawRow['secondIndicator'] ?? '') ?: null,
            'program' => ipcr_text($rawRow['program'] ?? '') ?: null,
            'category' => $category,
            'periodFrom' => ipcr_date_or_default($rawRow['period_from'] ?? $rawRow['periodFrom'] ?? null, $periodFrom),
            'periodTo' => ipcr_date_or_default($rawRow['period_to'] ?? $rawRow['periodTo'] ?? null, $periodTo),
        ];
    }

    return $rows;
}

/** Every distinct employee behind a set of records, keyed by record id: `[employeeRecordId => employeeName]`. */
function ipcr_employees_for_records(array $records): array
{
    $employees = [];
    foreach ($records as $record) {
        $employeeId = (int)($record['employeeRecordId'] ?? 0);
        if ($employeeId > 0 && !isset($employees[$employeeId])) {
            $employees[$employeeId] = ipcr_text($record['employeeName'] ?? '') ?: 'an employee';
        }
    }

    return $employees;
}

function ipcr_period_label(array $record): string
{
    $from = ipcr_text($record['periodFrom'] ?? '');
    $to = ipcr_text($record['periodTo'] ?? '');

    return trim($from . ($to !== '' ? ' to ' . $to : ''));
}

/** Tell each employee their KPIs are live -- the moment a record first shows up under My IPCR. */
function ipcr_notify_employees_assigned(PDO $pdo, array $records): void
{
    $byEmployee = [];
    foreach ($records as $record) {
        $byEmployee[(int)($record['employeeRecordId'] ?? 0)][] = $record;
    }

    foreach ($byEmployee as $employeeRecordId => $employeeRecords) {
        if ($employeeRecordId <= 0) {
            continue;
        }

        $count = count($employeeRecords);
        notify_employee(
            $pdo,
            $employeeRecordId,
            'IPCR KPI Assigned',
            sprintf(
                '%d IPCR KPI%s for %s %s been assigned to you. Open My IPCR to review your targets and submit accomplishments.',
                $count,
                $count === 1 ? '' : 's',
                ipcr_period_label($employeeRecords[0]),
                $count === 1 ? 'has' : 'have'
            ),
            'ipcr_assigned',
            (string)($employeeRecords[0]['ipcrId'] ?? '')
        );
    }
}

function ipcr_records_by_ids(PDO $pdo, array $ids, string $order = 'ORDER BY i.ipcr_id DESC'): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0)));
    if ($ids === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(ipcr_base_select() . " WHERE i.ipcr_id IN ({$placeholders}) {$order}");
    $statement->execute($ids);
    $rows = $statement->fetchAll();
    $files = ipcr_files_for_records($pdo, $ids);

    return array_map(static fn (array $row): array => ipcr_format_record($row, $files), $rows);
}

function ipcr_create_records(PDO $pdo, array $user): void
{
    if (!ipcr_can_create($user)) {
        json_response(['success' => false, 'message' => 'Only the HR Head can create IPCR records.'], 403);
    }

    $body = ipcr_request_body();
    $employeeIds = ipcr_employee_ids_from_payload($body);
    $periodFrom = ipcr_date_or_default($body['period_from'] ?? $body['periodFrom'] ?? null, date('Y-01-01'));
    $periodTo = ipcr_date_or_default($body['period_to'] ?? $body['periodTo'] ?? null, date('Y-06-30'));
    $kpis = ipcr_kpi_rows_from_payload($body, $periodFrom, $periodTo);

    if ($employeeIds === [] || $kpis === []) {
        json_response(['success' => false, 'message' => 'Employee, KPI title, and success indicator are required.'], 422);
    }

    $userId = (int)($user['id'] ?? 0) ?: null;

    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare(
            'INSERT INTO ipcr
                (employee_id, period_from, period_to, output, success_indicator, second_indicator,
                 program, kpi_category, status,
                 assigned_by_user_id)
             VALUES
                (:employee_id, :period_from, :period_to, :output, :success_indicator, :second_indicator,
                 :program, :kpi_category, :status,
                 :assigned_by_user_id)'
        );

        $createdIds = [];
        foreach ($employeeIds as $employeeId) {
            foreach ($kpis as $kpi) {
                $insert->execute([
                    ':employee_id' => $employeeId,
                    ':period_from' => $kpi['periodFrom'],
                    ':period_to' => $kpi['periodTo'],
                    ':output' => $kpi['output'],
                    ':success_indicator' => $kpi['successIndicator'],
                    ':second_indicator' => $kpi['secondIndicator'],
                    ':program' => $kpi['program'],
                    ':kpi_category' => $kpi['category'],
                    ':status' => 'draft',
                    ':assigned_by_user_id' => $userId,
                ]);
                $createdIds[] = (int)$pdo->lastInsertId();
            }
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $records = ipcr_records_by_ids($pdo, $createdIds);

    write_auth_audit($pdo, $user, 'ipcr.kpi_assigned', 'IPCR KPI records were assigned by the HR Head.', [
        'employeeIds' => $employeeIds,
        'createdIds' => $createdIds,
        'kpiCount' => count($kpis),
        'categories' => array_values(array_unique(array_column($kpis, 'category'))),
    ]);

    ipcr_notify_employees_assigned($pdo, $records);

    json_response([
        'success' => true,
        'message' => 'KPI assigned successfully.',
        'records' => $records,
    ], 201);
}

function ipcr_update_record(PDO $pdo, array $user): void
{
    if (!ipcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to edit IPCR records.'], 403);
    }

    $body = ipcr_request_body();
    $ipcrId = (int)($body['ipcr_id'] ?? $body['ipcrId'] ?? 0);
    $record = ipcr_fetch_record($pdo, $user, $ipcrId);

    $periodFrom = ipcr_text($body['period_from'] ?? $body['periodFrom'] ?? '');
    $periodTo = ipcr_text($body['period_to'] ?? $body['periodTo'] ?? '');
    $output = ipcr_text($body['output'] ?? $body['kpiTitle'] ?? '');
    $successIndicator = ipcr_text($body['success_indicator'] ?? $body['successIndicator'] ?? '');
    // Both optional: the form prints an output with neither directly under its category band.
    $secondIndicator = ipcr_text($body['second_indicator'] ?? $body['secondIndicator'] ?? '');
    $program = ipcr_text($body['program'] ?? '');
    $category = ipcr_text($body['kpi_category'] ?? $body['kpiCategory'] ?? $body['category'] ?? 'Program');

    $fromDate = DateTimeImmutable::createFromFormat('Y-m-d', $periodFrom);
    $toDate = DateTimeImmutable::createFromFormat('Y-m-d', $periodTo);
    $validFrom = $fromDate && $fromDate->format('Y-m-d') === $periodFrom;
    $validTo = $toDate && $toDate->format('Y-m-d') === $periodTo;

    if (!$validFrom || !$validTo || $output === '' || $successIndicator === '' || $category === '') {
        json_response(['success' => false, 'message' => 'Period, output, success indicator, and category are required.'], 422);
    }

    if ($periodFrom > $periodTo) {
        json_response(['success' => false, 'message' => 'Period To must be on or after Period From.'], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE ipcr
         SET period_from = :period_from,
             period_to = :period_to,
             output = :output,
             success_indicator = :success_indicator,
             second_indicator = :second_indicator,
             program = :program,
             kpi_category = :kpi_category
         WHERE ipcr_id = :ipcr_id'
    );
    $statement->execute([
        ':period_from' => $periodFrom,
        ':period_to' => $periodTo,
        ':output' => $output,
        ':success_indicator' => $successIndicator,
        ':second_indicator' => $secondIndicator !== '' ? $secondIndicator : null,
        ':program' => $program !== '' ? $program : null,
        ':kpi_category' => $category,
        ':ipcr_id' => $ipcrId,
    ]);

    write_auth_audit($pdo, $user, 'ipcr.updated', 'An IPCR record was updated.', [
        'ipcrId' => $ipcrId,
        'employeeRecordId' => $record['employeeRecordId'] ?? null,
    ]);

    json_response([
        'success' => true,
        'message' => 'IPCR record updated.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
    ]);
}

/*
 * The IPCR workflow, one KPI at a time:
 *
 *   draft           assigned; the employee has not submitted it yet
 *   submitted       the employee wrote the accomplishment, self-rated it, and attached MOVs
 *   needs_revision  the rater returned it with a note; the employee fixes it and submits again
 *   rated           the rater validated the MOVs and the final rating is set; locked from here
 *
 * "rated" is kept as the stored name for a validated KPI because the summary, the analytics, and
 * the form export all read it that way. "returned" is not reused for a sent-back KPI: the cleanup
 * in ensure_ipcr_tables() resets that status to draft on every request.
 */

function ipcr_is_owner(PDO $pdo, array $user, array $record): bool
{
    $sessionEmployeeId = session_employee_record_id($pdo, $user);

    return $sessionEmployeeId !== null
        && (int)($record['employeeRecordId'] ?? 0) === (int)$sessionEmployeeId;
}

function ipcr_status_of(array $record): string
{
    return strtolower(ipcr_text($record['status'] ?? 'draft'));
}

function ipcr_is_validated(array $record): bool
{
    return ipcr_status_of($record) === 'rated';
}

/** How a KPI is named in an error message, so a batch says which of its KPIs was refused. */
function ipcr_kpi_label(array $record): string
{
    $output = ipcr_text($record['output'] ?? '');

    return $output !== '' ? '"' . $output . '"' : 'IPCR record #' . (int)($record['ipcrId'] ?? 0);
}

/** The rows of a batch payload, or the payload itself read as a one-row batch. */
function ipcr_payload_rows(array $body, string $listKey): array
{
    $rows = $body[$listKey] ?? null;

    return is_array($rows) && $rows !== [] ? array_values(array_filter($rows, 'is_array')) : [$body];
}

/**
 * Quantity, efficiency, and timeliness from a payload row, each from 1 to 5. A score the row leaves
 * out falls back to `$fallback`; one still missing after that answers 422 naming the KPI.
 */
function ipcr_scores_or_fail(array $row, array $record, array $fallback = [null, null, null]): array
{
    $scores = [
        ipcr_decimal_or_null($row['q1_rating'] ?? $row['q1Rating'] ?? null) ?? $fallback[0],
        ipcr_decimal_or_null($row['e2_rating'] ?? $row['e2Rating'] ?? null) ?? $fallback[1],
        ipcr_decimal_or_null($row['t3_rating'] ?? $row['t3Rating'] ?? null) ?? $fallback[2],
    ];

    if (in_array(null, $scores, true)) {
        json_response([
            'success' => false,
            'message' => sprintf('Quantity, efficiency, and timeliness ratings are required for %s.', ipcr_kpi_label($record)),
        ], 422);
    }

    foreach ($scores as $score) {
        if ($score < 1 || $score > 5) {
            json_response(['success' => false, 'message' => 'Ratings must be from 1 to 5.'], 422);
        }
    }

    return $scores;
}

function ipcr_verification_count(PDO $pdo, int $ipcrId): int
{
    $statement = $pdo->prepare('SELECT COUNT(*) FROM ipcr_verification_files WHERE ipcr_id = :ipcr_id');
    $statement->execute([':ipcr_id' => $ipcrId]);

    return (int)$statement->fetchColumn();
}

/** Points the record's single-file MOV columns at its newest remaining file, or clears them. */
function ipcr_sync_latest_verification(PDO $pdo, int $ipcrId): void
{
    $statement = $pdo->prepare(
        'SELECT original_name, stored_path, file_size
         FROM ipcr_verification_files
         WHERE ipcr_id = :ipcr_id
         ORDER BY created_at DESC, id DESC
         LIMIT 1'
    );
    $statement->execute([':ipcr_id' => $ipcrId]);
    $latest = $statement->fetch() ?: null;

    $update = $pdo->prepare(
        'UPDATE ipcr
         SET mode_of_verification_name = :name,
             mode_of_verification_path = :path,
             mode_of_verification_size = :size
         WHERE ipcr_id = :ipcr_id'
    );
    $update->execute([
        ':name' => $latest['original_name'] ?? null,
        ':path' => $latest['stored_path'] ?? null,
        ':size' => isset($latest['file_size']) ? (int)$latest['file_size'] : null,
        ':ipcr_id' => $ipcrId,
    ]);
}

/**
 * Who validates an employee's IPCR: the chief of the employee's division (the same lookup as
 * leave_chief_user_ids_for_employee() in leave_request.php). A chief cannot validate their own, so
 * when the employee is the division's only chief -- or the division has none -- the HR Head is told.
 */
function ipcr_validator_user_ids(PDO $pdo, int $employeeRecordId): array
{
    ensure_role_columns($pdo);
    $statement = $pdo->prepare(
        'SELECT DISTINCT chief_user.id
         FROM employees owner
         INNER JOIN employees chief_employee
            ON chief_employee.division_id = owner.division_id
           AND chief_employee.is_archived = 0
         INNER JOIN users chief_user
            ON chief_user.email COLLATE utf8mb4_unicode_ci = chief_employee.email COLLATE utf8mb4_unicode_ci
           AND chief_user.is_archived = 0
         INNER JOIN roles chief_role ON chief_role.id = chief_user.role_id
         WHERE owner.id = :employee_id
           AND chief_employee.id <> owner.id
           AND (
                LOWER(REPLACE(chief_role.name, " ", "")) = "chief"
                OR LOWER(REPLACE(COALESCE(chief_role.base_role, ""), " ", "")) = "chief"
           )'
    );
    $statement->execute([':employee_id' => $employeeRecordId]);
    $userIds = array_map('intval', array_column($statement->fetchAll(), 'id'));

    return $userIds !== [] ? $userIds : user_ids_for_role_keys($pdo, ['hrhead']);
}

/** Groups records by employee: `[employeeRecordId => [record, ...]]`. */
function ipcr_records_by_employee(array $records): array
{
    $grouped = [];
    foreach ($records as $record) {
        $employeeRecordId = (int)($record['employeeRecordId'] ?? 0);
        if ($employeeRecordId > 0) {
            $grouped[$employeeRecordId][] = $record;
        }
    }

    return $grouped;
}

function ipcr_kpi_count_label(int $count): string
{
    return sprintf('%d IPCR KPI%s', $count, $count === 1 ? '' : 's');
}

/**
 * The employee submits one or more KPIs for validation. Each needs the actual accomplishment, a
 * self-rating on all three criteria, and at least one MOV, which upload_verification attaches
 * first. Every KPI in the batch is checked before anything is written, so one incomplete KPI
 * submits none of them. A validated KPI stays locked until its rater returns it.
 */
function ipcr_submit_accomplishment(PDO $pdo, array $user): void
{
    $body = ipcr_request_body();
    $submissions = [];

    foreach (ipcr_payload_rows($body, 'kpis') as $row) {
        $ipcrId = (int)($row['ipcr_id'] ?? $row['ipcrId'] ?? 0);
        $record = ipcr_fetch_record($pdo, $user, $ipcrId);
        $label = ipcr_kpi_label($record);

        if (!ipcr_is_owner($pdo, $user, $record) && !ipcr_can_manage($user)) {
            json_response(['success' => false, 'message' => 'You are not allowed to submit this IPCR accomplishment.'], 403);
        }

        if (ipcr_is_validated($record)) {
            json_response([
                'success' => false,
                'message' => sprintf('%s is already validated. Ask your division chief to return it before changing it.', $label),
            ], 422);
        }

        $actualAccomplishment = ipcr_text($row['actual_accomplishment'] ?? $row['actualAccomplishment'] ?? '');
        if ($actualAccomplishment === '') {
            json_response(['success' => false, 'message' => sprintf('Write the actual accomplishment for %s.', $label)], 422);
        }

        $scores = ipcr_scores_or_fail($row, $record);

        if (ipcr_verification_count($pdo, $ipcrId) === 0) {
            json_response(['success' => false, 'message' => sprintf('Attach at least one MOV for %s before submitting it.', $label)], 422);
        }

        $submissions[$ipcrId] = [
            'record' => $record,
            'actualAccomplishment' => $actualAccomplishment,
            'scores' => $scores,
        ];
    }

    $pdo->beginTransaction();
    try {
        // The status guard keeps a KPI validated between the checks above and this write locked.
        $statement = $pdo->prepare(
            'UPDATE ipcr
             SET actual_accomplishment = :actual_accomplishment,
                 self_q1_rating = :self_q1_rating,
                 self_e2_rating = :self_e2_rating,
                 self_t3_rating = :self_t3_rating,
                 status = "submitted",
                 submitted_at = NOW()
             WHERE ipcr_id = :ipcr_id
               AND status <> "rated"'
        );
        foreach ($submissions as $ipcrId => $submission) {
            $statement->execute([
                ':actual_accomplishment' => $submission['actualAccomplishment'],
                ':self_q1_rating' => $submission['scores'][0],
                ':self_e2_rating' => $submission['scores'][1],
                ':self_t3_rating' => $submission['scores'][2],
                ':ipcr_id' => $ipcrId,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $ipcrIds = array_keys($submissions);
    $records = ipcr_records_by_ids($pdo, $ipcrIds, 'ORDER BY i.ipcr_id ASC');

    write_auth_audit($pdo, $user, 'ipcr.accomplishment_submitted', 'IPCR accomplishments were submitted for validation.', [
        'ipcrIds' => $ipcrIds,
        'employeeRecordIds' => array_keys(ipcr_records_by_employee($records)),
    ]);

    $submitterUserId = (int)($user['id'] ?? 0);
    foreach (ipcr_records_by_employee($records) as $employeeRecordId => $employeeRecords) {
        $recipients = array_filter(
            ipcr_validator_user_ids($pdo, $employeeRecordId),
            static fn (int $userId): bool => $userId !== $submitterUserId
        );
        notify_users(
            $pdo,
            $recipients,
            'IPCR For Validation',
            sprintf(
                '%s submitted %s for %s with a self-rating and MOVs. Open the IPCR desk to validate them.',
                ipcr_text($employeeRecords[0]['employeeName'] ?? '') ?: 'An employee',
                ipcr_kpi_count_label(count($employeeRecords)),
                ipcr_period_label($employeeRecords[0])
            ),
            'ipcr_submitted',
            (string)($employeeRecords[0]['ipcrId'] ?? '')
        );
    }

    json_response([
        'success' => true,
        'message' => count($records) === 1 ? 'IPCR KPI submitted for validation.' : sprintf('%s submitted for validation.', ipcr_kpi_count_label(count($records))),
        'record' => $records[0] ?? null,
        'records' => $records,
    ]);
}

/**
 * The rater's decision on submitted KPIs, any number per call:
 *
 *   validate  the MOVs support the claim. The final rating is the employee's self-rating, or the
 *             scores the rater sends when they adjust it. Needs at least one MOV on the KPI.
 *   return    sent back to the employee with a required note, and any final rating is cleared, so
 *             the employee can fix the MOVs or the self-rating and submit again.
 *
 * A chief decides for their own division (the read scope confines them to it), HR and planning
 * for anybody -- but nobody for their own IPCR. Every decision is checked before any is written.
 * `submit_rating` routes here too, as a validate with the scores it carries.
 */
function ipcr_validate_records(PDO $pdo, array $user): void
{
    if (!ipcr_can_manage($user) && !in_array(ipcr_role_key($user), ['chief', 'planningofficer'], true)) {
        json_response(['success' => false, 'message' => 'You are not allowed to validate IPCR records.'], 403);
    }

    $body = ipcr_request_body();
    $decisions = [];

    foreach (ipcr_payload_rows($body, 'decisions') as $row) {
        $ipcrId = (int)($row['ipcr_id'] ?? $row['ipcrId'] ?? 0);
        $record = ipcr_fetch_record($pdo, $user, $ipcrId);
        $label = ipcr_kpi_label($record);

        if (ipcr_is_owner($pdo, $user, $record)) {
            json_response(['success' => false, 'message' => 'You cannot validate your own IPCR.'], 403);
        }

        $status = ipcr_status_of($record);
        if ($status === 'needs_revision') {
            json_response([
                'success' => false,
                'message' => sprintf('%s was returned and is waiting for the employee to submit it again.', $label),
            ], 422);
        }
        if (!in_array($status, ['submitted', 'rated'], true)) {
            json_response(['success' => false, 'message' => sprintf('%s has not been submitted for validation yet.', $label)], 422);
        }

        $decision = strtolower(ipcr_text($row['decision'] ?? 'validate'));
        $remarks = ipcr_text($row['remarks'] ?? '');

        if ($decision === 'return') {
            if ($remarks === '') {
                json_response(['success' => false, 'message' => sprintf('Tell the employee what to fix in %s before returning it.', $label)], 422);
            }
            $decisions[$ipcrId] = ['decision' => 'return', 'remarks' => $remarks];
            continue;
        }

        if ($decision !== 'validate') {
            json_response(['success' => false, 'message' => sprintf('Choose Validate or Return for %s.', $label)], 422);
        }

        if (ipcr_verification_count($pdo, $ipcrId) === 0) {
            json_response([
                'success' => false,
                'message' => sprintf('%s has no MOV to validate. Return it to the employee instead.', $label),
            ], 422);
        }

        $scores = ipcr_scores_or_fail($row, $record, [
            $record['selfQ1Rating'] ?? null,
            $record['selfE2Rating'] ?? null,
            $record['selfT3Rating'] ?? null,
        ]);
        $decisions[$ipcrId] = [
            'decision' => 'validate',
            'remarks' => $remarks,
            'scores' => $scores,
            'average' => round(array_sum($scores) / 3, 2),
        ];
    }

    $reviewerId = (int)($user['id'] ?? 0) ?: null;

    $pdo->beginTransaction();
    try {
        $validate = $pdo->prepare(
            'UPDATE ipcr
             SET q1_rating = :q1_rating,
                 e2_rating = :e2_rating,
                 t3_rating = :t3_rating,
                 a4_rating = :a4_rating,
                 final_rating = :final_rating,
                 remarks = :remarks,
                 status = "rated",
                 reviewed_by_user_id = :reviewed_by_user_id,
                 reviewed_at = NOW(),
                 approval_remarks = NULL
             WHERE ipcr_id = :ipcr_id'
        );
        $return = $pdo->prepare(
            'UPDATE ipcr
             SET q1_rating = NULL,
                 e2_rating = NULL,
                 t3_rating = NULL,
                 a4_rating = NULL,
                 final_rating = NULL,
                 status = "needs_revision",
                 reviewed_by_user_id = :reviewed_by_user_id,
                 reviewed_at = NOW(),
                 approval_remarks = :approval_remarks
             WHERE ipcr_id = :ipcr_id'
        );

        foreach ($decisions as $ipcrId => $decision) {
            if ($decision['decision'] === 'return') {
                $return->execute([
                    ':reviewed_by_user_id' => $reviewerId,
                    ':approval_remarks' => $decision['remarks'],
                    ':ipcr_id' => $ipcrId,
                ]);
                continue;
            }

            $validate->execute([
                ':q1_rating' => $decision['scores'][0],
                ':e2_rating' => $decision['scores'][1],
                ':t3_rating' => $decision['scores'][2],
                ':a4_rating' => $decision['average'],
                ':final_rating' => $decision['average'],
                ':remarks' => $decision['remarks'] !== '' ? $decision['remarks'] : null,
                ':reviewed_by_user_id' => $reviewerId,
                ':ipcr_id' => $ipcrId,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $records = ipcr_records_by_ids($pdo, array_keys($decisions), 'ORDER BY i.ipcr_id ASC');
    $returnedIds = array_keys(array_filter($decisions, static fn (array $decision): bool => $decision['decision'] === 'return'));
    $validatedIds = array_values(array_diff(array_keys($decisions), $returnedIds));

    write_auth_audit($pdo, $user, 'ipcr.validated', 'IPCR KPIs were validated or returned.', [
        'validatedIds' => $validatedIds,
        'returnedIds' => $returnedIds,
        'employeeRecordIds' => array_keys(ipcr_records_by_employee($records)),
    ]);

    foreach (ipcr_records_by_employee($records) as $employeeRecordId => $employeeRecords) {
        $validated = array_values(array_filter($employeeRecords, static fn (array $record): bool => in_array((int)$record['ipcrId'], $validatedIds, true)));
        $returned = array_values(array_filter($employeeRecords, static fn (array $record): bool => in_array((int)$record['ipcrId'], $returnedIds, true)));

        if ($validated !== []) {
            notify_employee(
                $pdo,
                $employeeRecordId,
                'IPCR Validated',
                sprintf(
                    '%s for %s %s validated. Open My IPCR to see the final rating.',
                    ipcr_kpi_count_label(count($validated)),
                    ipcr_period_label($validated[0]),
                    count($validated) === 1 ? 'was' : 'were'
                ),
                'ipcr_validated',
                (string)$validated[0]['ipcrId']
            );
        }

        if ($returned !== []) {
            notify_employee(
                $pdo,
                $employeeRecordId,
                'IPCR Returned',
                sprintf(
                    '%s for %s %s returned for revision. Open My IPCR to read the note, fix the MOVs or self-rating, and submit again.',
                    ipcr_kpi_count_label(count($returned)),
                    ipcr_period_label($returned[0]),
                    count($returned) === 1 ? 'was' : 'were'
                ),
                'ipcr_returned',
                (string)$returned[0]['ipcrId']
            );
        }
    }

    $message = match (true) {
        $returnedIds === [] => count($validatedIds) === 1 ? 'IPCR KPI validated.' : sprintf('%s validated.', ipcr_kpi_count_label(count($validatedIds))),
        $validatedIds === [] => count($returnedIds) === 1 ? 'IPCR KPI returned to the employee.' : sprintf('%s returned to the employee.', ipcr_kpi_count_label(count($returnedIds))),
        default => sprintf('%d validated, %d returned to the employee.', count($validatedIds), count($returnedIds)),
    };

    json_response([
        'success' => true,
        'message' => $message,
        'record' => $records[0] ?? null,
        'records' => $records,
    ]);
}

function ipcr_update_status(PDO $pdo, array $user): void
{
    if (!ipcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to update IPCR status.'], 403);
    }

    $body = ipcr_request_body();
    $ipcrId = (int)($body['ipcr_id'] ?? $body['ipcrId'] ?? 0);
    $status = ipcr_text($body['status'] ?? '');
    if ($ipcrId <= 0 || $status === '') {
        json_response(['success' => false, 'message' => 'IPCR record and status are required.'], 422);
    }

    ipcr_fetch_record($pdo, $user, $ipcrId);
    $statement = $pdo->prepare('UPDATE ipcr SET status = :status WHERE ipcr_id = :ipcr_id');
    $statement->execute([
        ':status' => $status,
        ':ipcr_id' => $ipcrId,
    ]);

    json_response([
        'success' => true,
        'message' => 'IPCR status updated.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
    ]);
}

function ipcr_archive_record(PDO $pdo, array $user): void
{
    if (!ipcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to archive IPCR records.'], 403);
    }

    $body = ipcr_request_body();
    $ipcrId = (int)($body['ipcr_id'] ?? $body['ipcrId'] ?? 0);
    ipcr_fetch_record($pdo, $user, $ipcrId);

    $statement = $pdo->prepare('UPDATE ipcr SET is_archived = 1 WHERE ipcr_id = :ipcr_id');
    $statement->execute([':ipcr_id' => $ipcrId]);

    json_response([
        'success' => true,
        'message' => 'IPCR record archived.',
    ]);
}

function ipcr_restore_record(PDO $pdo, array $user): void
{
    if (!ipcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to restore IPCR records.'], 403);
    }

    $body = ipcr_request_body();
    $ipcrId = (int)($body['ipcr_id'] ?? $body['ipcrId'] ?? 0);
    $record = ipcr_fetch_record($pdo, $user, $ipcrId, true);

    $statement = $pdo->prepare('UPDATE ipcr SET is_archived = 0 WHERE ipcr_id = :ipcr_id');
    $statement->execute([':ipcr_id' => $ipcrId]);

    write_auth_audit($pdo, $user, 'ipcr.restored', 'An IPCR record was restored.', [
        'ipcrId' => $ipcrId,
        'employeeRecordId' => $record['employeeRecordId'] ?? null,
    ]);

    json_response([
        'success' => true,
        'message' => 'IPCR record restored.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
    ]);
}

function ipcr_upload_verification(PDO $pdo, array $user): void
{
    $ipcrId = (int)($_POST['ipcr_id'] ?? $_POST['ipcrId'] ?? 0);
    $record = ipcr_fetch_record($pdo, $user, $ipcrId);

    if (!ipcr_can_manage($user) && !ipcr_is_owner($pdo, $user, $record)) {
        json_response(['success' => false, 'message' => 'You are not allowed to upload verification files for this IPCR.'], 403);
    }

    if (ipcr_is_validated($record)) {
        json_response(['success' => false, 'message' => 'This KPI is already validated, so its MOVs are locked.'], 422);
    }

    $file = $_FILES['verification_file'] ?? null;
    if (!is_array($file) || (int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response(['success' => false, 'message' => 'Please choose a verification file.'], 422);
    }

    $originalName = basename((string)($file['name'] ?? 'verification-file'));
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx'];
    if (!in_array($extension, $allowedExtensions, true)) {
        json_response(['success' => false, 'message' => 'Unsupported verification file type.'], 422);
    }

    $uploadDir = dirname(__DIR__) . '/uploads/ipcr-verifications';
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0775, true) && !is_dir($uploadDir)) {
        json_response(['success' => false, 'message' => 'Unable to prepare upload directory.'], 500);
    }

    $storedName = sprintf('ipcr_%s_%s.%s', date('Ymd_His'), bin2hex(random_bytes(8)), $extension);
    $targetPath = $uploadDir . '/' . $storedName;
    if (!move_uploaded_file((string)$file['tmp_name'], $targetPath)) {
        json_response(['success' => false, 'message' => 'Unable to save verification file.'], 500);
    }

    $relativePath = 'uploads/ipcr-verifications/' . $storedName;
    $mimeType = mime_content_type($targetPath) ?: null;
    $fileSize = (int)($file['size'] ?? filesize($targetPath));

    $statement = $pdo->prepare(
        'INSERT INTO ipcr_verification_files
            (ipcr_id, output_id, original_name, stored_path, file_size, mime_type, uploaded_by_user_id)
         VALUES
            (:ipcr_id, :output_id, :original_name, :stored_path, :file_size, :mime_type, :uploaded_by_user_id)'
    );
    $statement->execute([
        ':ipcr_id' => $ipcrId,
        ':output_id' => ipcr_text($_POST['output_id'] ?? $_POST['outputId'] ?? '') ?: null,
        ':original_name' => $originalName,
        ':stored_path' => $relativePath,
        ':file_size' => $fileSize,
        ':mime_type' => $mimeType,
        ':uploaded_by_user_id' => (int)($user['id'] ?? 0) ?: null,
    ]);

    /*
     * Attaching a MOV does not submit the KPI: My IPCR uploads the files first and then submits the
     * accomplishment and self-rating, which is what moves it on to the rater.
     */
    ipcr_sync_latest_verification($pdo, $ipcrId);

    json_response([
        'success' => true,
        'message' => 'Verification file uploaded.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
    ], 201);
}

/**
 * Removes one MOV, file and all, while its KPI is still the employee's to change. A KPI waiting on
 * its rater must keep at least one, so the replacement is attached before the last one goes.
 */
function ipcr_delete_verification(PDO $pdo, array $user): void
{
    $body = ipcr_request_body();
    $fileId = (int)($body['file_id'] ?? $body['fileId'] ?? $_GET['file_id'] ?? 0);
    if ($fileId <= 0) {
        json_response(['success' => false, 'message' => 'Choose the MOV to remove.'], 422);
    }

    $statement = $pdo->prepare('SELECT id, ipcr_id, original_name, stored_path FROM ipcr_verification_files WHERE id = :id LIMIT 1');
    $statement->execute([':id' => $fileId]);
    $file = $statement->fetch();
    if (!$file) {
        json_response(['success' => false, 'message' => 'MOV not found.'], 404);
    }

    $ipcrId = (int)$file['ipcr_id'];
    $record = ipcr_fetch_record($pdo, $user, $ipcrId);

    if (!ipcr_can_manage($user) && !ipcr_is_owner($pdo, $user, $record)) {
        json_response(['success' => false, 'message' => 'You are not allowed to remove MOVs from this IPCR.'], 403);
    }

    if (ipcr_is_validated($record)) {
        json_response(['success' => false, 'message' => 'This KPI is already validated, so its MOVs are locked.'], 422);
    }

    if (ipcr_status_of($record) === 'submitted' && ipcr_verification_count($pdo, $ipcrId) <= 1) {
        json_response([
            'success' => false,
            'message' => 'A submitted KPI needs at least one MOV. Attach the replacement before removing this one.',
        ], 422);
    }

    $pdo->prepare('DELETE FROM ipcr_verification_files WHERE id = :id')->execute([':id' => $fileId]);
    ipcr_sync_latest_verification($pdo, $ipcrId);

    // Only ever a file under the IPCR upload folder, whatever the stored path says.
    $uploadDir = realpath(dirname(__DIR__) . '/uploads/ipcr-verifications');
    $storedPath = realpath(dirname(__DIR__) . '/' . ltrim((string)$file['stored_path'], '/\\'));
    if ($uploadDir !== false && $storedPath !== false && str_starts_with($storedPath, $uploadDir . DIRECTORY_SEPARATOR)) {
        @unlink($storedPath);
    }

    write_auth_audit($pdo, $user, 'ipcr.verification_removed', 'An IPCR MOV was removed.', [
        'ipcrId' => $ipcrId,
        'fileId' => $fileId,
        'originalName' => $file['original_name'],
    ]);

    json_response([
        'success' => true,
        'message' => 'MOV removed.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
    ]);
}

/**
 * Stream one IPCR form as an .xlsx laid out like the form itself.
 *
 * One IPCR form is every output an employee committed to for a rating period, which is how
 * sameIpcrForm() groups the rows behind the on-screen preview. Scoping is inherited from the anchor
 * fetch: an employee who may only read their own IPCR can only ever anchor on their own record, and
 * the export then stays on that employee.
 */
function ipcr_export_form(PDO $pdo, array $user): void
{
    $anchor = ipcr_fetch_record($pdo, $user, (int)($_GET['ipcr_id'] ?? $_GET['ipcrId'] ?? 0));

    $statement = $pdo->prepare(
        ipcr_base_select()
        . ' WHERE i.is_archived = 0 AND i.employee_id = :employee_id'
        . ' AND i.period_from = :period_from AND i.period_to = :period_to'
        . ' ORDER BY i.kpi_category ASC, i.ipcr_id ASC'
    );
    $statement->execute([
        ':employee_id' => $anchor['employeeRecordId'],
        ':period_from' => $anchor['periodFrom'],
        ':period_to' => $anchor['periodTo'],
    ]);
    $records = array_map(static fn (array $row): array => ipcr_format_record($row), $statement->fetchAll());

    if ($records === []) {
        json_response(['success' => false, 'message' => 'IPCR form not found.'], 404);
    }

    $label = trim(implode(' ', array_filter([
        ipcr_text($anchor['employeeName'] ?? ''),
        ipcr_text($anchor['periodFrom'] ?? ''),
        ipcr_text($anchor['periodTo'] ?? ''),
    ])));

    perf_export_stream(
        perf_ipcr_form_sheet($records),
        'IPCR Form',
        trim('IPCR Form ' . $label),
        perf_export_filename('ipcr-form', $label)
    );
}

try {
    ensure_ipcr_tables($pdo);

    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $action = ipcr_text($_GET['action'] ?? $_POST['action'] ?? 'list');

    if ($method === 'GET' && $action === 'list') {
        ipcr_fetch_records($pdo, $sessionUser);
    }

    if ($method === 'GET' && $action === 'view') {
        ipcr_view_record($pdo, $sessionUser);
    }

    if ($method === 'GET' && $action === 'export_form') {
        ipcr_export_form($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'create') {
        ipcr_create_records($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'update') {
        ipcr_update_record($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'upload_verification') {
        ipcr_upload_verification($pdo, $sessionUser);
    }

    if ($method === 'DELETE' && $action === 'delete_verification') {
        ipcr_delete_verification($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && in_array($action, ['validate', 'submit_rating'], true)) {
        ipcr_validate_records($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'submit_accomplishment') {
        ipcr_submit_accomplishment($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'status') {
        ipcr_update_status($pdo, $sessionUser);
    }

    if ($method === 'DELETE' && $action === 'archive') {
        ipcr_archive_record($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'restore') {
        ipcr_restore_record($pdo, $sessionUser);
    }

    json_response(['success' => false, 'message' => 'Unsupported IPCR action.'], 405);
} catch (Throwable $exception) {
    error_log('IPCR API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process IPCR request.',
    ], 500);
}
