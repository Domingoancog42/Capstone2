<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/performance-export.php';

$sessionUser = require_session_user();

/*
 * A MOV's id is its KPI's assignment id times this, plus its number within the KPI, so the id alone
 * says which KPI row's list holds it. Caps a KPI at 999 MOVs.
 */
const OPCR_MOV_ID_FACTOR = 1000;

function opcr_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function opcr_role_key(array $user): string
{
    return user_role_key($user);
}

function opcr_can_view(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'hrhead', 'hrstaff', 'chief', 'planningofficer', 'regionaldirector'], true);
}

function opcr_can_manage(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

/**
 * Filing a commitment is wider than managing one: a division chief bulk-assigns OPCR KPIs for
 * their own division alongside HR (see opcr_create_records()), while rewriting or archiving an
 * assignment already on the register stays with opcr_can_manage().
 */
function opcr_can_assign(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'hrhead', 'hrstaff', 'chief'], true);
}

function opcr_is_chief(array $user): bool
{
    return opcr_role_key($user) === 'chief';
}

/**
 * The division a chief's OPCR desk is confined to, by name -- the name every assignment row carries
 * (see opcr_create_records()). Read from the chief's own employee record, falling back to the
 * division on the session; '' when neither resolves.
 */
function opcr_session_division(PDO $pdo, array $user): string
{
    $employeeRecordId = session_employee_record_id($pdo, $user);
    if ($employeeRecordId !== null) {
        $statement = $pdo->prepare(
            'SELECT d.name
             FROM employees e
             INNER JOIN divisions d ON d.id = e.division_id
             WHERE e.id = :employee_id
               AND e.is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_id' => $employeeRecordId]);
        $division = opcr_text($statement->fetchColumn());
        if ($division !== '') {
            return $division;
        }
    }

    return opcr_text($user['division'] ?? '');
}

/**
 * Which assignment rows a caller may read. HR and the other viewers read every division's. A chief
 * reads the forms assigned to their own division -- whoever assigned them, since the chief records
 * and rates them -- so a KPI the HR Head assigns to several divisions lands on each one's chief.
 * False when a chief's division cannot be resolved, which callers turn into an empty list rather
 * than everybody's.
 */
function opcr_apply_read_scope(PDO $pdo, array $user, array &$where, array &$params): bool
{
    if (!opcr_is_chief($user)) {
        return true;
    }

    $division = opcr_session_division($pdo, $user);
    if ($division === '') {
        return false;
    }

    $where[] = 'LOWER(TRIM(doa.division)) = :scope_division';
    $params[':scope_division'] = mb_strtolower($division);

    return true;
}

/*
 * The OPCR workflow, one KPI (assignment row) at a time:
 *
 *   Assigned   HR assigned it to a division; the division chief has not submitted it yet
 *   Submitted  the chief wrote the actual accomplishment and attached MOVs, and sent it on to the
 *              Regional Director
 *   Returned   the Regional Director sent it back with a note; the chief fixes it and submits again
 *   Rated      the Regional Director validated the MOVs and set the rating; locked from here
 *
 * "Rated" stays the stored name for a validated KPI because the reports, the analytics, and the
 * form export already read it that way.
 */

/** Submitting a division's accomplishments is the chief's; the read scope keeps them to their own. */
function opcr_can_submit(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'chief'], true);
}

/** Validating a submission and setting its rating is the Regional Director's final signature. */
function opcr_can_validate(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'regionaldirector'], true);
}

function opcr_status_of(array $record): string
{
    return strtolower(opcr_text($record['assignmentStatus'] ?? $record['status'] ?? 'Assigned'));
}

function opcr_is_validated(array $record): bool
{
    return opcr_status_of($record) === 'rated';
}

/** How a KPI is named in an error message, so a batch says which of its KPIs was refused. */
function opcr_kpi_label(array $record): string
{
    $output = opcr_text($record['output'] ?? '');

    return $output !== '' ? '"' . $output . '"' : 'OPCR record #' . (int)($record['assignmentId'] ?? 0);
}

/** The rows of a batch payload, or the payload itself read as a one-row batch. */
function opcr_payload_rows(array $body, string $listKey): array
{
    $rows = $body[$listKey] ?? null;

    return is_array($rows) && $rows !== [] ? array_values(array_filter($rows, 'is_array')) : [$body];
}

function opcr_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );
    $statement->execute([':table_name' => $table]);

    return (int)$statement->fetchColumn() > 0;
}

function opcr_column_exists(PDO $pdo, string $table, string $column): bool
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

function ensure_opcr_tables(PDO $pdo): void
{
    // The printed form has two success-indicator columns per row: the fiscal-year target and the
    // semester target beside it. The semester target is optional; NULL prints as "NO TARGET FOR ...".
    $templateColumns = [
        'semester_indicator' => 'ALTER TABLE opcr_templates ADD COLUMN semester_indicator TEXT NULL AFTER success_indicator',
        // The sub-heading the printed form carries under the OO/Program band and above the output
        // rows -- "Mining Investment Promotion" under the enforcement program. Optional.
        'sub_category' => 'ALTER TABLE opcr_templates ADD COLUMN sub_category VARCHAR(255) NULL AFTER category',
    ];

    foreach ($templateColumns as $column => $sql) {
        if (!opcr_column_exists($pdo, 'opcr_templates', $column)) {
            $pdo->exec($sql);
        }
    }

    $columns = [
        'employee_id' => 'ALTER TABLE division_opcr_assignments ADD COLUMN employee_id INT UNSIGNED NULL AFTER template_id',
        'actual_accomplishment' => 'ALTER TABLE division_opcr_assignments ADD COLUMN actual_accomplishment TEXT NULL AFTER remarks',
        'approved_by' => 'ALTER TABLE division_opcr_assignments ADD COLUMN approved_by VARCHAR(150) NULL AFTER assignment_status',
        'q1_rating' => 'ALTER TABLE division_opcr_assignments ADD COLUMN q1_rating DECIMAL(5,2) NULL AFTER final_rating',
        'e2_rating' => 'ALTER TABLE division_opcr_assignments ADD COLUMN e2_rating DECIMAL(5,2) NULL AFTER q1_rating',
        't3_rating' => 'ALTER TABLE division_opcr_assignments ADD COLUMN t3_rating DECIMAL(5,2) NULL AFTER e2_rating',
        'a4_rating' => 'ALTER TABLE division_opcr_assignments ADD COLUMN a4_rating DECIMAL(5,2) NULL AFTER t3_rating',
        'mode_of_verification_name' => 'ALTER TABLE division_opcr_assignments ADD COLUMN mode_of_verification_name VARCHAR(255) NULL AFTER a4_rating',
        'mode_of_verification_path' => 'ALTER TABLE division_opcr_assignments ADD COLUMN mode_of_verification_path VARCHAR(500) NULL AFTER mode_of_verification_name',
        'mode_of_verification_size' => 'ALTER TABLE division_opcr_assignments ADD COLUMN mode_of_verification_size INT UNSIGNED NULL AFTER mode_of_verification_path',
        'submitted_at' => 'ALTER TABLE division_opcr_assignments ADD COLUMN submitted_at DATETIME NULL AFTER mode_of_verification_size',
        // Who sent the accomplishment on, and the Regional Director's decision on it (see opcr_validate_records()).
        'submitted_by_user_id' => 'ALTER TABLE division_opcr_assignments ADD COLUMN submitted_by_user_id INT UNSIGNED NULL AFTER submitted_at',
        'reviewed_by_user_id' => 'ALTER TABLE division_opcr_assignments ADD COLUMN reviewed_by_user_id INT UNSIGNED NULL AFTER submitted_by_user_id',
        'reviewed_at' => 'ALTER TABLE division_opcr_assignments ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by_user_id',
        // The note a returned KPI carries back to the chief.
        'approval_remarks' => 'ALTER TABLE division_opcr_assignments ADD COLUMN approval_remarks TEXT NULL AFTER reviewed_at',
        'created_at' => 'ALTER TABLE division_opcr_assignments ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER is_archived',
        'updated_at' => 'ALTER TABLE division_opcr_assignments ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    ];

    foreach ($columns as $column => $sql) {
        if (!opcr_column_exists($pdo, 'division_opcr_assignments', $column)) {
            $pdo->exec($sql);
        }
    }

    /*
     * A KPI's MOVs, any number of them, live on the KPI row as a JSON list. The single-file
     * mode_of_verification_* columns stay, pointed at the newest file (opcr_store_verifications()),
     * so older readers keep working.
     */
    if (!opcr_column_exists($pdo, 'division_opcr_assignments', 'verification_files_json')) {
        $pdo->exec('ALTER TABLE division_opcr_assignments ADD COLUMN verification_files_json LONGTEXT NULL AFTER mode_of_verification_size');
        opcr_migrate_verification_files($pdo);
    }
}

/**
 * Fills the new MOV lists once: from the retired opcr_verification_files table when an install still
 * has it, otherwise from the single-file columns. The retired table itself is left for an
 * administrator to drop once the move is checked.
 */
function opcr_migrate_verification_files(PDO $pdo): void
{
    $lists = [];

    if (opcr_table_exists($pdo, 'opcr_verification_files')) {
        $rows = $pdo->query(
            'SELECT assignment_id, original_name, stored_path, file_size, mime_type, uploaded_by_user_id, created_at
             FROM opcr_verification_files
             ORDER BY assignment_id ASC, created_at ASC, id ASC'
        )->fetchAll();
    } else {
        $rows = $pdo->query(
            'SELECT assignment_id,
                    COALESCE(NULLIF(mode_of_verification_name, ""), "verification-file") AS original_name,
                    mode_of_verification_path AS stored_path,
                    COALESCE(mode_of_verification_size, 0) AS file_size,
                    NULL AS mime_type,
                    NULL AS uploaded_by_user_id,
                    COALESCE(submitted_at, updated_at) AS created_at
             FROM division_opcr_assignments
             WHERE mode_of_verification_path IS NOT NULL
               AND mode_of_verification_path <> ""'
        )->fetchAll();
    }

    foreach ($rows as $row) {
        $assignmentId = (int)$row['assignment_id'];
        $lists[$assignmentId][] = [
            'id' => $assignmentId * OPCR_MOV_ID_FACTOR + count($lists[$assignmentId] ?? []) + 1,
            'originalName' => (string)$row['original_name'],
            'storedPath' => (string)$row['stored_path'],
            'fileSize' => (int)$row['file_size'],
            'mimeType' => $row['mime_type'] !== null ? (string)$row['mime_type'] : null,
            'uploadedByUserId' => $row['uploaded_by_user_id'] !== null ? (int)$row['uploaded_by_user_id'] : null,
            'createdAt' => $row['created_at'] !== null ? (string)$row['created_at'] : null,
        ];
    }

    foreach ($lists as $assignmentId => $files) {
        opcr_store_verifications($pdo, $assignmentId, $files);
    }
}

/** A KPI's MOV list as stored on its row, oldest first. */
function opcr_decode_verifications(mixed $json): array
{
    if (!is_string($json) || trim($json) === '') {
        return [];
    }

    $files = json_decode($json, true);

    return is_array($files) ? array_values(array_filter($files, 'is_array')) : [];
}

/** Reads a KPI's MOV list under a row lock, for a change the caller makes in its transaction. */
function opcr_lock_verifications(PDO $pdo, int $assignmentId): array
{
    $statement = $pdo->prepare(
        'SELECT verification_files_json FROM division_opcr_assignments WHERE assignment_id = :assignment_id FOR UPDATE'
    );
    $statement->execute([':assignment_id' => $assignmentId]);

    return opcr_decode_verifications($statement->fetchColumn());
}

/** Saves a KPI's MOV list and points its single-file columns at the newest file, or clears them. */
function opcr_store_verifications(PDO $pdo, int $assignmentId, array $files): void
{
    $files = array_values($files);
    $latest = $files === [] ? null : $files[count($files) - 1];

    $statement = $pdo->prepare(
        'UPDATE division_opcr_assignments
         SET verification_files_json = :files,
             mode_of_verification_name = :name,
             mode_of_verification_path = :path,
             mode_of_verification_size = :size
         WHERE assignment_id = :assignment_id'
    );
    $statement->execute([
        ':files' => $files === [] ? null : json_encode($files, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ':name' => $latest['originalName'] ?? null,
        ':path' => $latest['storedPath'] ?? null,
        ':size' => isset($latest['fileSize']) ? (int)$latest['fileSize'] : null,
        ':assignment_id' => $assignmentId,
    ]);
}

function opcr_request_body(): array
{
    if (!empty($_POST)) {
        return $_POST;
    }

    return read_json_body();
}

function opcr_decimal_or_null(mixed $value): ?float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return null;
    }

    return round((float)$value, 2);
}

function opcr_user_display_name(array $user): string
{
    foreach (['full_name', 'fullName', 'username', 'email'] as $key) {
        $value = opcr_text($user[$key] ?? '');
        if ($value !== '') {
            return $value;
        }
    }

    return 'HRIS User';
}

function opcr_employee_record(PDO $pdo, int $employeeId): ?array
{
    if ($employeeId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeCode,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS employeeName,
            d.name AS division,
            des.name AS position
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :employee_id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':employee_id' => $employeeId]);
    $record = $statement->fetch();

    return $record ?: null;
}

function opcr_accountable_items_from_payload(PDO $pdo, array $body): array
{
    $rawItems = $body['accountable_items'] ?? $body['accountableItems'] ?? [];
    $items = [];

    if (is_array($rawItems)) {
        foreach ($rawItems as $item) {
            if (!is_array($item)) {
                $name = opcr_text($item);
                if ($name !== '') {
                    $items[] = [
                        'type' => 'division',
                        'employeeId' => null,
                        'name' => $name,
                        'division' => $name,
                    ];
                }
                continue;
            }

            $employeeId = (int)($item['employee_id'] ?? $item['employeeId'] ?? 0);
            $type = strtolower(opcr_text($item['type'] ?? ($employeeId > 0 ? 'individual' : 'division')));

            if ($employeeId > 0 || $type === 'individual' || $type === 'employee') {
                $employee = opcr_employee_record($pdo, $employeeId);
                if ($employee !== null) {
                    $items[] = [
                        'type' => 'individual',
                        'employeeId' => (int)$employee['id'],
                        'name' => opcr_text($employee['employeeName'] ?? ''),
                        'division' => opcr_text($employee['division'] ?? ''),
                    ];
                }
                continue;
            }

            $name = opcr_text($item['name'] ?? $item['division'] ?? '');
            if ($name !== '') {
                $items[] = [
                    'type' => 'division',
                    'employeeId' => null,
                    'name' => $name,
                    'division' => $name,
                ];
            }
        }
    }

    $divisionNames = $body['division_names'] ?? $body['divisionNames'] ?? [];
    if (!is_array($divisionNames) && opcr_text($divisionNames) !== '') {
        $divisionNames = [$divisionNames];
    }
    if (is_array($divisionNames)) {
        foreach ($divisionNames as $divisionName) {
            $name = opcr_text($divisionName);
            if ($name !== '') {
                $items[] = [
                    'type' => 'division',
                    'employeeId' => null,
                    'name' => $name,
                    'division' => $name,
                ];
            }
        }
    }

    $employeeIds = $body['employee_ids'] ?? $body['employeeIds'] ?? [];
    if (!is_array($employeeIds) && (int)$employeeIds > 0) {
        $employeeIds = [$employeeIds];
    }
    if (is_array($employeeIds)) {
        foreach ($employeeIds as $employeeId) {
            $employee = opcr_employee_record($pdo, (int)$employeeId);
            if ($employee !== null) {
                $items[] = [
                    'type' => 'individual',
                    'employeeId' => (int)$employee['id'],
                    'name' => opcr_text($employee['employeeName'] ?? ''),
                    'division' => opcr_text($employee['division'] ?? ''),
                ];
            }
        }
    }

    $unique = [];
    foreach ($items as $item) {
        $key = $item['employeeId'] ? 'employee:' . $item['employeeId'] : 'division:' . strtolower($item['division']);
        $unique[$key] = $item;
    }

    return array_values($unique);
}

function opcr_generate_no(PDO $pdo): string
{
    for ($attempt = 0; $attempt < 20; $attempt++) {
        $opcrNo = sprintf('OPCR-%s-%04d', date('Ymd'), random_int(1, 9999));
        $statement = $pdo->prepare('SELECT COUNT(*) FROM division_opcr_assignments WHERE opcr_no = :opcr_no');
        $statement->execute([':opcr_no' => $opcrNo]);
        if ((int)$statement->fetchColumn() === 0) {
            return $opcrNo;
        }
    }

    return sprintf('OPCR-%s-%s', date('YmdHis'), bin2hex(random_bytes(3)));
}

/**
 * The display name of the account behind a user-id column: the linked employee's name, or the
 * username for an account with no employee record (an administrator, typically).
 */
function opcr_user_name_sql(string $column): string
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

/** Every MOV of the given KPIs, newest first: `[assignmentId => [file, ...]]`. */
function opcr_files_for_records(PDO $pdo, array $assignmentIds): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $assignmentIds))));
    if ($ids === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT assignment_id, verification_files_json
         FROM division_opcr_assignments
         WHERE assignment_id IN ({$placeholders})"
    );
    $statement->execute($ids);

    $grouped = [];
    foreach ($statement->fetchAll() as $row) {
        $assignmentId = (int)$row['assignment_id'];

        // Stored oldest first; the screens list newest first.
        foreach (array_reverse(opcr_decode_verifications($row['verification_files_json'])) as $file) {
            $grouped[$assignmentId][] = [
                'id' => (int)($file['id'] ?? 0),
                'assignmentId' => $assignmentId,
                'originalName' => (string)($file['originalName'] ?? ''),
                'storedPath' => (string)($file['storedPath'] ?? ''),
                'fileSize' => (int)($file['fileSize'] ?? 0),
                'mimeType' => $file['mimeType'] ?? null,
                'createdAt' => $file['createdAt'] ?? null,
            ];
        }
    }

    return $grouped;
}

/** Formats rows with their MOVs attached, in one files query for the whole list. */
function opcr_format_rows(PDO $pdo, array $rows): array
{
    $files = opcr_files_for_records($pdo, array_column($rows, 'assignmentId'));

    return opcr_attach_signatories(
        $pdo,
        array_map(static fn (array $row): array => opcr_format_record($row, $files), $rows)
    );
}

/*
 * Who signs the printed form, read from whoever holds the role today rather than typed onto it: the
 * division's chief commits to the targets and assesses them, the HR Head who assigned them signs
 * beside, and the Regional Director gives the final rating. Each is `['name' => ..., 'position' => ...]`, with an empty name when nobody holds
 * the role, so the form prints a blank signature line instead of somebody else's name.
 */
function opcr_signatory_select(): string
{
    return 'SELECT
            e.first_name,
            e.middle_name,
            e.last_name,
            e.suffix,
            COALESCE(des.name, "") AS position,
            e.designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN designations des ON des.id = e.designation_id';
}

function opcr_signatory_from_row(mixed $row): array
{
    if (!is_array($row)) {
        return ['name' => '', 'position' => ''];
    }

    $name = full_name_from_row($row);
    $suffix = opcr_text($row['suffix'] ?? '');

    return [
        'name' => $name !== '' && $suffix !== '' ? $name . ', ' . $suffix : $name,
        'position' => employee_signatory_title($row['position'] ?? '', $row['designation'] ?? ''),
    ];
}

/**
 * The chief of a division, by the division name its assignment rows carry -- the same accounts
 * opcr_chief_user_ids() notifies. A plain Chief is preferred over a role built on it (Chief Admin),
 * so a division with both is signed by its chief.
 */
function opcr_division_chief(PDO $pdo, string $division): array
{
    static $cache = [];

    $key = mb_strtolower(opcr_text($division));
    if ($key === '') {
        return opcr_signatory_from_row(null);
    }
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }

    ensure_role_columns($pdo);
    ensure_employee_suffix_column($pdo);
    $statement = $pdo->prepare(
        opcr_signatory_select() . '
         INNER JOIN divisions d ON d.id = e.division_id AND d.is_archived = 0
         WHERE u.is_archived = 0
           AND LOWER(u.status) = "active"
           AND LOWER(TRIM(d.name)) = :division
           AND (
                LOWER(REPLACE(r.name, " ", "")) = "chief"
                OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) = "chief"
           )
         ORDER BY LOWER(REPLACE(r.name, " ", "")) = "chief" DESC, u.id ASC
         LIMIT 1'
    );
    $statement->execute([':division' => $key]);
    $cache[$key] = opcr_signatory_from_row($statement->fetch());

    return $cache[$key];
}

/**
 * The office-wide holder of a role (`regionaldirector`, `hrhead`): the account with that exact role
 * first, then one whose role is built on it, oldest account first.
 */
function opcr_role_signatory(PDO $pdo, string $roleKey): array
{
    static $cache = [];

    if (array_key_exists($roleKey, $cache)) {
        return $cache[$roleKey];
    }

    ensure_role_columns($pdo);
    ensure_employee_suffix_column($pdo);
    $statement = $pdo->prepare(
        opcr_signatory_select() . '
         WHERE u.is_archived = 0
           AND LOWER(u.status) = "active"
           AND (
                LOWER(REPLACE(r.name, " ", "")) = :role_key
                OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) = :base_role_key
           )
         ORDER BY LOWER(REPLACE(r.name, " ", "")) = :exact_role_key DESC, u.id ASC
         LIMIT 1'
    );
    $statement->execute([':role_key' => $roleKey, ':base_role_key' => $roleKey, ':exact_role_key' => $roleKey]);
    $cache[$roleKey] = opcr_signatory_from_row($statement->fetch());

    return $cache[$roleKey];
}

/**
 * Every record carries its form's signatories, so the preview and the export print the same names
 * and a record the screen keeps in its cache still has them.
 */
function opcr_attach_signatories(PDO $pdo, array $records): array
{
    $hrHead = opcr_role_signatory($pdo, 'hrhead');
    $director = opcr_role_signatory($pdo, 'regionaldirector');

    return array_map(static function (array $record) use ($pdo, $hrHead, $director): array {
        $chief = opcr_division_chief($pdo, (string)($record['division'] ?? ''));
        $record['divisionChiefName'] = $chief['name'];
        $record['divisionChiefPosition'] = $chief['position'];
        $record['hrHeadName'] = $hrHead['name'];
        $record['hrHeadPosition'] = $hrHead['position'];
        $record['regionalDirectorName'] = $director['name'];
        $record['regionalDirectorPosition'] = $director['position'];

        return $record;
    }, $records);
}

function opcr_records_by_ids(PDO $pdo, array $ids): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
    if ($ids === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(opcr_base_select() . " WHERE doa.assignment_id IN ({$placeholders}) ORDER BY doa.assignment_id ASC");
    $statement->execute($ids);

    return opcr_format_rows($pdo, $statement->fetchAll());
}

function opcr_base_select(): string
{
    return 'SELECT
            doa.assignment_id AS assignmentId,
            doa.opcr_no AS opcrNo,
            doa.template_id AS templateId,
            doa.employee_id AS employeeRecordId,
            e.employee_id AS employeeCode,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS employeeName,
            COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))), ""), doa.division) AS accountableName,
            doa.division,
            des.name AS position,
            doa.period,
            doa.semester,
            doa.prepared_by AS preparedBy,
            doa.approved_by AS approvedBy,
            doa.budget,
            doa.remarks,
            doa.actual_accomplishment AS actualAccomplishment,
            doa.assignment_status AS assignmentStatus,
            doa.final_rating AS finalRating,
            doa.q1_rating AS q1Rating,
            doa.e2_rating AS e2Rating,
            doa.t3_rating AS t3Rating,
            doa.a4_rating AS a4Rating,
            doa.mode_of_verification_name AS modeOfVerificationName,
            doa.mode_of_verification_path AS modeOfVerificationPath,
            doa.mode_of_verification_size AS modeOfVerificationSize,
            doa.submitted_at AS submittedAt,
            doa.submitted_by_user_id AS submittedByUserId,
            ' . opcr_user_name_sql('doa.submitted_by_user_id') . ' AS submittedByName,
            doa.reviewed_by_user_id AS reviewedByUserId,
            ' . opcr_user_name_sql('doa.reviewed_by_user_id') . ' AS reviewedByName,
            doa.reviewed_at AS reviewedAt,
            doa.approval_remarks AS approvalRemarks,
            doa.created_at AS createdAt,
            doa.updated_at AS updatedAt,
            ot.template_name AS templateName,
            ot.category,
            ot.sub_category AS subCategory,
            ot.output,
            ot.success_indicator AS successIndicator,
            ot.semester_indicator AS semesterIndicator,
            (SELECT GROUP_CONCAT(DISTINCT CONCAT(TRIM(sibling.division), "\t", COALESCE(dv.code, ""))
                                 ORDER BY sibling.division SEPARATOR "\n")
               FROM division_opcr_assignments sibling
               LEFT JOIN divisions dv
                 ON LOWER(TRIM(dv.name)) = LOWER(TRIM(sibling.division))
                AND dv.is_archived = 0
              WHERE sibling.template_id = doa.template_id
                AND sibling.is_archived = 0
                AND sibling.employee_id IS NULL) AS accountableDivisionList
        FROM division_opcr_assignments doa
        INNER JOIN opcr_templates ot ON ot.template_id = doa.template_id
        LEFT JOIN employees e ON e.id = doa.employee_id
        LEFT JOIN designations des ON des.id = e.designation_id';
}

/*
 * One KPI is one template, assigned to every division ticked for it (see opcr_create_records()),
 * so the divisions accountable for a KPI are that template's live division assignments. The base
 * select gathers them as "name<TAB>code" lines; this turns them into the printed form's cell --
 * "Geosciences Division (GD), Mine Management Division (MMD) & Mine Safety ... (MSESDD)" -- with
 * the acronym taken from the division's code in Settings. An individual's assignment keeps their
 * name; a row whose siblings cannot be read falls back to its own division.
 */
function opcr_accountable_divisions(array $row): array
{
    $divisions = [];
    foreach (explode("\n", (string)($row['accountableDivisionList'] ?? '')) as $line) {
        [$name, $code] = array_pad(explode("\t", $line, 2), 2, '');
        $name = trim($name);
        if ($name === '') {
            continue;
        }
        $divisions[] = ['name' => $name, 'code' => trim($code)];
    }

    return $divisions;
}

function opcr_accountable_label(array $row, array $divisions): string
{
    $ownName = trim((string)($row['accountableName'] ?? $row['division'] ?? ''));
    if ($row['employeeRecordId'] !== null || $divisions === []) {
        return $ownName;
    }

    $labels = array_map(
        static fn (array $division): string => $division['code'] !== ''
            ? $division['name'] . ' (' . $division['code'] . ')'
            : $division['name'],
        $divisions
    );
    $last = array_pop($labels);

    return $labels === [] ? $last : implode(', ', $labels) . ' & ' . $last;
}

function opcr_format_record(array $row, array $files = []): array
{
    $assignmentId = (int)($row['assignmentId'] ?? $row['assignment_id'] ?? 0);
    $employeeRecordId = $row['employeeRecordId'] !== null ? (int)$row['employeeRecordId'] : null;
    $accountableDivisions = opcr_accountable_divisions($row);

    return [
        'id' => $assignmentId,
        'assignmentId' => $assignmentId,
        'opcrNo' => $row['opcrNo'] ?? null,
        'templateId' => (int)($row['templateId'] ?? 0),
        'employeeRecordId' => $employeeRecordId,
        'employeeId' => $row['employeeCode'] ?? null,
        'employeeCode' => $row['employeeCode'] ?? null,
        'employeeName' => $row['employeeName'] ?? null,
        'accountableName' => $row['accountableName'] ?? ($row['division'] ?? null),
        // Every division sharing this KPI, and the printed form's cell for them (see opcr_accountable_label()).
        'accountableDivisions' => $accountableDivisions,
        'accountableLabel' => opcr_accountable_label($row, $accountableDivisions),
        'division' => $row['division'] ?? null,
        'position' => $row['position'] ?? null,
        'period' => $row['period'] ?? null,
        'semester' => $row['semester'] ?? null,
        'preparedBy' => $row['preparedBy'] ?? null,
        'approvedBy' => $row['approvedBy'] ?? null,
        'budget' => $row['budget'] !== null ? (float)$row['budget'] : null,
        'remarks' => $row['remarks'] ?? null,
        'actualAccomplishment' => $row['actualAccomplishment'] ?? null,
        'status' => $row['assignmentStatus'] ?? 'Assigned',
        'assignmentStatus' => $row['assignmentStatus'] ?? 'Assigned',
        'finalRating' => $row['finalRating'] !== null ? (float)$row['finalRating'] : null,
        'q1Rating' => $row['q1Rating'] !== null ? (float)$row['q1Rating'] : null,
        'e2Rating' => $row['e2Rating'] !== null ? (float)$row['e2Rating'] : null,
        't3Rating' => $row['t3Rating'] !== null ? (float)$row['t3Rating'] : null,
        'a4Rating' => $row['a4Rating'] !== null ? (float)$row['a4Rating'] : null,
        'modeOfVerificationName' => $row['modeOfVerificationName'] ?? null,
        'modeOfVerificationPath' => $row['modeOfVerificationPath'] ?? null,
        'modeOfVerificationSize' => $row['modeOfVerificationSize'] !== null ? (int)$row['modeOfVerificationSize'] : null,
        'submittedAt' => $row['submittedAt'] ?? null,
        'submittedByName' => $row['submittedByName'] ?? null,
        'reviewedByUserId' => isset($row['reviewedByUserId']) ? (int)$row['reviewedByUserId'] : null,
        'reviewedByName' => $row['reviewedByName'] ?? null,
        'reviewedAt' => $row['reviewedAt'] ?? null,
        'approvalRemarks' => $row['approvalRemarks'] ?? null,
        'verificationFiles' => $files[$assignmentId] ?? [],
        'templateName' => $row['templateName'] ?? null,
        'category' => $row['category'] ?? 'Program',
        'subCategory' => $row['subCategory'] ?? null,
        'output' => $row['output'] ?? null,
        'kpiTitle' => $row['output'] ?? null,
        'successIndicator' => $row['successIndicator'] ?? null,
        'semesterIndicator' => $row['semesterIndicator'] ?? null,
        'createdAt' => $row['createdAt'] ?? null,
        'updatedAt' => $row['updatedAt'] ?? null,
    ];
}

function opcr_fetch_record(PDO $pdo, array $user, int $assignmentId, bool $archived = false): array
{
    if ($assignmentId <= 0) {
        json_response(['success' => false, 'message' => 'OPCR assignment is required.'], 422);
    }

    if (!opcr_can_view($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to view OPCR records.'], 403);
    }

    $params = [':assignment_id' => $assignmentId, ':is_archived' => $archived ? 1 : 0];
    $where = ['doa.assignment_id = :assignment_id', 'doa.is_archived = :is_archived'];

    if (!opcr_apply_read_scope($pdo, $user, $where, $params)) {
        json_response(['success' => false, 'message' => 'OPCR assignment not found.'], 404);
    }

    $statement = $pdo->prepare(opcr_base_select() . ' WHERE ' . implode(' AND ', $where) . ' LIMIT 1');
    $statement->execute($params);
    $row = $statement->fetch();

    if (!$row) {
        json_response(['success' => false, 'message' => 'OPCR assignment not found.'], 404);
    }

    return opcr_format_rows($pdo, [$row])[0];
}

function opcr_fetch_records(PDO $pdo, array $user): void
{
    if (!opcr_can_view($user)) {
        json_response(['success' => true, 'records' => []]);
    }

    $params = [':is_archived' => archived_view_requested() ? 1 : 0];
    $where = ['doa.is_archived = :is_archived'];

    if (!opcr_apply_read_scope($pdo, $user, $where, $params)) {
        json_response(['success' => true, 'records' => []]);
    }

    $status = opcr_text($_GET['status'] ?? '');

    if ($status !== '') {
        $where[] = 'doa.assignment_status = :status';
        $params[':status'] = $status;
    }

    $statement = $pdo->prepare(opcr_base_select() . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY doa.created_at DESC, doa.assignment_id DESC');
    $statement->execute($params);
    $records = opcr_format_rows($pdo, $statement->fetchAll());

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

/**
 * One assignment can carry several KPIs, so the payload may hold a `kpis` array. A payload that
 * still names a single KPI at the top level is read as a one-row list. Category and budget belong
 * to the KPI itself; the period and semester stay shared across the whole assignment.
 */
function opcr_kpi_rows_from_payload(array $body): array
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

        $output = opcr_text($rawRow['output'] ?? $rawRow['kpiTitle'] ?? $rawRow['kpi_title'] ?? '');
        $successIndicator = opcr_text($rawRow['success_indicator'] ?? $rawRow['successIndicator'] ?? '');
        if ($output === '' || $successIndicator === '') {
            continue;
        }

        $category = opcr_text($rawRow['category'] ?? $rawRow['kpi_category'] ?? $rawRow['kpiCategory'] ?? 'Program');
        if ($category === '') {
            $category = 'Program';
        }

        $semesterIndicator = opcr_text($rawRow['semester_indicator'] ?? $rawRow['semesterIndicator'] ?? '');
        $subCategory = opcr_text($rawRow['sub_category'] ?? $rawRow['subCategory'] ?? '');

        $rows[] = [
            'output' => $output,
            'successIndicator' => $successIndicator,
            'semesterIndicator' => $semesterIndicator !== '' ? $semesterIndicator : null,
            'category' => $category,
            'subCategory' => $subCategory !== '' ? $subCategory : null,
            'budget' => opcr_decimal_or_null($rawRow['budget'] ?? null),
        ];
    }

    return $rows;
}

function opcr_create_records(PDO $pdo, array $user): void
{
    if (!opcr_can_assign($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to assign OPCR KPIs.'], 403);
    }

    $body = opcr_request_body();
    $items = opcr_accountable_items_from_payload($pdo, $body);
    $kpis = opcr_kpi_rows_from_payload($body);
    $period = opcr_text($body['period'] ?? ('FY ' . date('Y')));
    $semester = opcr_text($body['semester'] ?? '1st Semester');
    $preparedBy = opcr_user_display_name($user);

    if ($items === [] || $kpis === [] || $period === '' || $semester === '') {
        json_response(['success' => false, 'message' => 'Accountable items, KPI title, success indicator, period, and semester are required.'], 422);
    }

    // A chief files commitments for their own division only, the one their desk lists.
    if (opcr_is_chief($user)) {
        $ownDivision = mb_strtolower(opcr_session_division($pdo, $user));
        foreach ($items as $item) {
            if ($ownDivision === '' || mb_strtolower($item['division']) !== $ownDivision) {
                json_response(['success' => false, 'message' => 'You can assign OPCR KPIs to your own division only.'], 403);
            }
        }
    }

    $officeDivision = implode(', ', array_map(static fn (array $item): string => $item['name'], $items));
    $yearSemester = trim($period . ' - ' . $semester);

    $pdo->beginTransaction();
    try {
        $template = $pdo->prepare(
            'INSERT INTO opcr_templates
                (template_name, category, sub_category, office_division, year_semester, template_status, output, success_indicator, semester_indicator, budget)
             VALUES
                (:template_name, :category, :sub_category, :office_division, :year_semester, :template_status, :output, :success_indicator, :semester_indicator, :budget)'
        );

        $insert = $pdo->prepare(
            'INSERT INTO division_opcr_assignments
                (opcr_no, template_id, employee_id, division, period, semester, prepared_by, budget, assignment_status)
             VALUES
                (:opcr_no, :template_id, :employee_id, :division, :period, :semester, :prepared_by, :budget, :assignment_status)'
        );

        // Every KPI gets its own template, then one assignment row per accountable item under it.
        $createdIds = [];
        foreach ($kpis as $kpi) {
            $template->execute([
                ':template_name' => $kpi['output'],
                ':category' => $kpi['category'],
                ':sub_category' => $kpi['subCategory'],
                ':office_division' => $officeDivision,
                ':year_semester' => $yearSemester,
                ':template_status' => 'Active',
                ':output' => $kpi['output'],
                ':success_indicator' => $kpi['successIndicator'],
                ':semester_indicator' => $kpi['semesterIndicator'],
                ':budget' => $kpi['budget'],
            ]);
            $templateId = (int)$pdo->lastInsertId();

            foreach ($items as $item) {
                $insert->execute([
                    ':opcr_no' => opcr_generate_no($pdo),
                    ':template_id' => $templateId,
                    ':employee_id' => $item['employeeId'] ?: null,
                    ':division' => $item['employeeId'] ? ($item['division'] ?: $item['name']) : $item['division'],
                    ':period' => $period,
                    ':semester' => $semester,
                    ':prepared_by' => $preparedBy,
                    ':budget' => $kpi['budget'],
                    ':assignment_status' => 'Assigned',
                ]);
                $createdIds[] = (int)$pdo->lastInsertId();
            }
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $placeholders = implode(',', array_fill(0, count($createdIds), '?'));
    $statement = $pdo->prepare(opcr_base_select() . " WHERE doa.assignment_id IN ({$placeholders}) ORDER BY doa.assignment_id DESC");
    $statement->execute($createdIds);
    $records = opcr_format_rows($pdo, $statement->fetchAll());

    write_auth_audit($pdo, $user, 'opcr.kpi_assigned', 'OPCR KPI records were assigned.', [
        'createdIds' => $createdIds,
        'kpiCount' => count($kpis),
        'categories' => array_values(array_unique(array_column($kpis, 'category'))),
        'period' => $period,
        'semester' => $semester,
    ]);

    // Each division's chief is told the KPIs are on their desk, unless they filed them themselves.
    $assignerUserId = (int)($user['id'] ?? 0);
    foreach (opcr_records_by_division($records) as $divisionRecords) {
        $division = opcr_text($divisionRecords[0]['division'] ?? '');
        notify_users(
            $pdo,
            array_filter(opcr_chief_user_ids($pdo, $division), static fn (int $userId): bool => $userId !== $assignerUserId),
            'OPCR Assigned',
            sprintf(
                '%s for %s %s assigned to %s. Open the OPCR desk to record the accomplishments, attach the MOVs, and submit them to the Regional Director.',
                opcr_kpi_count_label(count($divisionRecords)),
                opcr_period_label($divisionRecords[0]),
                count($divisionRecords) === 1 ? 'was' : 'were',
                $division
            ),
            'opcr_assigned',
            (string)($divisionRecords[0]['assignmentId'] ?? '')
        );
    }

    json_response([
        'success' => true,
        'message' => 'OPCR KPI assigned successfully.',
        'records' => $records,
    ], 201);
}

function opcr_update_record(PDO $pdo, array $user): void
{
    if (!opcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to edit OPCR records.'], 403);
    }

    $body = opcr_request_body();
    $assignmentId = (int)($body['assignment_id'] ?? $body['assignmentId'] ?? 0);
    $record = opcr_fetch_record($pdo, $user, $assignmentId);
    $templateId = (int)($record['templateId'] ?? 0);

    $period = opcr_text($body['period'] ?? '');
    $semester = opcr_text($body['semester'] ?? '');
    $output = opcr_text($body['output'] ?? $body['kpiTitle'] ?? '');
    $successIndicator = opcr_text($body['success_indicator'] ?? $body['successIndicator'] ?? '');
    $semesterIndicator = opcr_text($body['semester_indicator'] ?? $body['semesterIndicator'] ?? '');
    $category = opcr_text($body['category'] ?? $body['kpi_category'] ?? $body['kpiCategory'] ?? 'Program');
    $subCategory = opcr_text($body['sub_category'] ?? $body['subCategory'] ?? '');
    $budgetInput = $body['budget'] ?? null;
    $budget = opcr_decimal_or_null($budgetInput);

    if ($period === '' || $semester === '' || $output === '' || $successIndicator === '' || $category === '') {
        json_response(['success' => false, 'message' => 'Period, semester, output, success indicator, and category are required.'], 422);
    }

    if ($budgetInput !== null && $budgetInput !== '' && ($budget === null || $budget < 0)) {
        json_response(['success' => false, 'message' => 'Budget must be a valid non-negative amount.'], 422);
    }

    $yearSemester = trim($period . ' - ' . $semester);

    $pdo->beginTransaction();
    try {
        $template = $pdo->prepare(
            'UPDATE opcr_templates
             SET template_name = :template_name,
                 category = :category,
                 sub_category = :sub_category,
                 year_semester = :year_semester,
                 output = :output,
                 success_indicator = :success_indicator,
                 semester_indicator = :semester_indicator,
                 budget = :budget
             WHERE template_id = :template_id
               AND is_archived = 0'
        );
        $template->execute([
            ':template_name' => $output,
            ':category' => $category,
            ':sub_category' => $subCategory !== '' ? $subCategory : null,
            ':year_semester' => $yearSemester,
            ':output' => $output,
            ':success_indicator' => $successIndicator,
            ':semester_indicator' => $semesterIndicator !== '' ? $semesterIndicator : null,
            ':budget' => $budget,
            ':template_id' => $templateId,
        ]);

        // One template can be assigned to several accountable divisions, so form-level edits stay
        // consistent across every active row belonging to that template.
        $assignments = $pdo->prepare(
            'UPDATE division_opcr_assignments
             SET period = :period,
                 semester = :semester,
                 budget = :budget
             WHERE template_id = :template_id
               AND is_archived = 0'
        );
        $assignments->execute([
            ':period' => $period,
            ':semester' => $semester,
            ':budget' => $budget,
            ':template_id' => $templateId,
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $statement = $pdo->prepare(
        opcr_base_select()
        . ' WHERE doa.template_id = :template_id AND doa.is_archived = 0'
        . ' ORDER BY doa.assignment_id DESC'
    );
    $statement->execute([':template_id' => $templateId]);
    $records = opcr_format_rows($pdo, $statement->fetchAll());

    write_auth_audit($pdo, $user, 'opcr.updated', 'An OPCR form was updated.', [
        'assignmentId' => $assignmentId,
        'templateId' => $templateId,
        'opcrNo' => $record['opcrNo'] ?? null,
    ]);

    json_response([
        'success' => true,
        'message' => 'OPCR form updated.',
        'record' => opcr_fetch_record($pdo, $user, $assignmentId),
        'records' => $records,
    ]);
}

function opcr_archive_record(PDO $pdo, array $user): void
{
    if (!opcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to archive OPCR records.'], 403);
    }

    $body = opcr_request_body();
    $assignmentId = (int)($body['assignment_id'] ?? $body['assignmentId'] ?? 0);
    $record = opcr_fetch_record($pdo, $user, $assignmentId);
    $templateId = (int)($record['templateId'] ?? 0);

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'UPDATE division_opcr_assignments SET is_archived = 1 WHERE assignment_id = :assignment_id'
        );
        $statement->execute([':assignment_id' => $assignmentId]);

        $activeCount = $pdo->prepare(
            'SELECT COUNT(*) FROM division_opcr_assignments WHERE template_id = :template_id AND is_archived = 0'
        );
        $activeCount->execute([':template_id' => $templateId]);
        if ((int)$activeCount->fetchColumn() === 0) {
            $archiveTemplate = $pdo->prepare(
                'UPDATE opcr_templates SET is_archived = 1, template_status = :status WHERE template_id = :template_id'
            );
            $archiveTemplate->execute([
                ':status' => 'Archived',
                ':template_id' => $templateId,
            ]);
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    write_auth_audit($pdo, $user, 'opcr.archived', 'An OPCR record was archived.', [
        'assignmentId' => $assignmentId,
        'templateId' => $templateId,
        'opcrNo' => $record['opcrNo'] ?? null,
    ]);

    json_response([
        'success' => true,
        'message' => 'OPCR record archived.',
    ]);
}

function opcr_restore_record(PDO $pdo, array $user): void
{
    if (!opcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to restore OPCR records.'], 403);
    }

    $body = opcr_request_body();
    $assignmentId = (int)($body['assignment_id'] ?? $body['assignmentId'] ?? 0);
    $record = opcr_fetch_record($pdo, $user, $assignmentId, true);
    $templateId = (int)($record['templateId'] ?? 0);

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'UPDATE division_opcr_assignments SET is_archived = 0 WHERE assignment_id = :assignment_id'
        );
        $statement->execute([':assignment_id' => $assignmentId]);

        $restoreTemplate = $pdo->prepare(
            'UPDATE opcr_templates SET is_archived = 0, template_status = :status WHERE template_id = :template_id'
        );
        $restoreTemplate->execute([
            ':status' => 'Active',
            ':template_id' => $templateId,
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    write_auth_audit($pdo, $user, 'opcr.restored', 'An OPCR record was restored.', [
        'assignmentId' => $assignmentId,
        'templateId' => $templateId,
        'opcrNo' => $record['opcrNo'] ?? null,
    ]);

    json_response([
        'success' => true,
        'message' => 'OPCR record restored.',
        'record' => opcr_fetch_record($pdo, $user, $assignmentId),
    ]);
}

/** Groups records by accountable division: `[lowercased division => [record, ...]]`. */
function opcr_records_by_division(array $records): array
{
    $grouped = [];
    foreach ($records as $record) {
        $division = opcr_text($record['division'] ?? '');
        if ($division !== '') {
            $grouped[mb_strtolower($division)][] = $record;
        }
    }

    return $grouped;
}

function opcr_kpi_count_label(int $count): string
{
    return sprintf('%d OPCR KPI%s', $count, $count === 1 ? '' : 's');
}

function opcr_period_label(array $record): string
{
    return trim(implode(' - ', array_filter([
        opcr_text($record['period'] ?? ''),
        opcr_text($record['semester'] ?? ''),
    ]))) ?: 'the current period';
}

/**
 * The chiefs of a division, by its name -- the name every assignment row carries. A Chief Admin
 * works from the chief's desk, so a role based on Chief counts too.
 */
function opcr_chief_user_ids(PDO $pdo, string $division): array
{
    if (opcr_text($division) === '') {
        return [];
    }

    ensure_role_columns($pdo);
    $statement = $pdo->prepare(
        'SELECT DISTINCT chief_user.id
         FROM divisions d
         INNER JOIN employees chief_employee
            ON chief_employee.division_id = d.id
           AND chief_employee.is_archived = 0
         INNER JOIN users chief_user
            ON chief_user.email COLLATE utf8mb4_unicode_ci = chief_employee.email COLLATE utf8mb4_unicode_ci
           AND chief_user.is_archived = 0
         INNER JOIN roles chief_role ON chief_role.id = chief_user.role_id
         WHERE d.is_archived = 0
           AND LOWER(TRIM(d.name)) = :division
           AND (
                LOWER(REPLACE(chief_role.name, " ", "")) = "chief"
                OR LOWER(REPLACE(COALESCE(chief_role.base_role, ""), " ", "")) = "chief"
           )'
    );
    $statement->execute([':division' => mb_strtolower(opcr_text($division))]);

    return array_map('intval', array_column($statement->fetchAll(), 'id'));
}

function opcr_verification_count(PDO $pdo, int $assignmentId): int
{
    $statement = $pdo->prepare('SELECT verification_files_json FROM division_opcr_assignments WHERE assignment_id = :assignment_id');
    $statement->execute([':assignment_id' => $assignmentId]);

    return count(opcr_decode_verifications($statement->fetchColumn()));
}

/**
 * Quantity, efficiency, and timeliness from a payload row, each from 1 to 5. A score the row leaves
 * out falls back to `$fallback`; one still missing after that answers 422 naming the KPI.
 */
function opcr_scores_or_fail(array $row, array $record, array $fallback = [null, null, null]): array
{
    $scores = [
        opcr_decimal_or_null($row['q1_rating'] ?? $row['q1Rating'] ?? null) ?? $fallback[0],
        opcr_decimal_or_null($row['e2_rating'] ?? $row['e2Rating'] ?? null) ?? $fallback[1],
        opcr_decimal_or_null($row['t3_rating'] ?? $row['t3Rating'] ?? null) ?? $fallback[2],
    ];

    if (in_array(null, $scores, true)) {
        json_response([
            'success' => false,
            'message' => sprintf('Quantity, efficiency, and timeliness ratings are required for %s.', opcr_kpi_label($record)),
        ], 422);
    }

    foreach ($scores as $score) {
        if ($score < 1 || $score > 5) {
            json_response(['success' => false, 'message' => 'Ratings must be from 1 to 5.'], 422);
        }
    }

    return $scores;
}

/**
 * The division chief submits one or more KPIs to the Regional Director. Each needs the actual
 * accomplishment and at least one MOV, which upload_verification attaches first. Every KPI in the
 * batch is checked before anything is written, so one incomplete KPI submits none of them. A
 * validated KPI stays locked.
 */
function opcr_submit_accomplishment(PDO $pdo, array $user): void
{
    if (!opcr_can_submit($user)) {
        json_response(['success' => false, 'message' => 'Only the division chief can submit OPCR accomplishments.'], 403);
    }

    $body = opcr_request_body();
    $submissions = [];

    foreach (opcr_payload_rows($body, 'kpis') as $row) {
        $assignmentId = (int)($row['assignment_id'] ?? $row['assignmentId'] ?? 0);
        $record = opcr_fetch_record($pdo, $user, $assignmentId);
        $label = opcr_kpi_label($record);

        if (opcr_is_validated($record)) {
            json_response([
                'success' => false,
                'message' => sprintf('%s is already validated by the Regional Director, so it is locked.', $label),
            ], 422);
        }

        $actualAccomplishment = opcr_text($row['actual_accomplishment'] ?? $row['actualAccomplishment'] ?? '');
        if ($actualAccomplishment === '') {
            json_response(['success' => false, 'message' => sprintf('Write the actual accomplishment for %s.', $label)], 422);
        }

        if (opcr_verification_count($pdo, $assignmentId) === 0) {
            json_response(['success' => false, 'message' => sprintf('Attach at least one MOV for %s before submitting it.', $label)], 422);
        }

        $submissions[$assignmentId] = $actualAccomplishment;
    }

    $submitterUserId = (int)($user['id'] ?? 0) ?: null;

    $pdo->beginTransaction();
    try {
        // The status guard keeps a KPI validated between the checks above and this write locked.
        $statement = $pdo->prepare(
            'UPDATE division_opcr_assignments
             SET actual_accomplishment = :actual_accomplishment,
                 assignment_status = "Submitted",
                 submitted_at = NOW(),
                 submitted_by_user_id = :submitted_by_user_id
             WHERE assignment_id = :assignment_id
               AND assignment_status <> "Rated"'
        );
        foreach ($submissions as $assignmentId => $actualAccomplishment) {
            $statement->execute([
                ':actual_accomplishment' => $actualAccomplishment,
                ':submitted_by_user_id' => $submitterUserId,
                ':assignment_id' => $assignmentId,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $assignmentIds = array_keys($submissions);
    $records = opcr_records_by_ids($pdo, $assignmentIds);

    write_auth_audit($pdo, $user, 'opcr.accomplishment_submitted', 'OPCR accomplishments were submitted for validation.', [
        'assignmentIds' => $assignmentIds,
        'divisions' => array_values(array_unique(array_column($records, 'division'))),
    ]);

    $recipients = array_filter(
        user_ids_for_role_keys($pdo, ['regionaldirector']),
        static fn (int $userId): bool => $userId !== (int)$submitterUserId
    );
    foreach (opcr_records_by_division($records) as $divisionRecords) {
        notify_users(
            $pdo,
            $recipients,
            'OPCR For Validation',
            sprintf(
                '%s submitted %s for %s with MOVs. Open the OPCR desk to validate them.',
                opcr_text($divisionRecords[0]['division'] ?? '') ?: 'A division',
                opcr_kpi_count_label(count($divisionRecords)),
                opcr_period_label($divisionRecords[0])
            ),
            'opcr_submitted',
            (string)($divisionRecords[0]['assignmentId'] ?? '')
        );
    }

    json_response([
        'success' => true,
        'message' => count($records) === 1
            ? 'OPCR KPI submitted to the Regional Director.'
            : sprintf('%s submitted to the Regional Director.', opcr_kpi_count_label(count($records))),
        'record' => $records[0] ?? null,
        'records' => $records,
    ]);
}

/**
 * The Regional Director's decision on submitted KPIs, any number per call:
 *
 *   validate  the MOVs support the accomplishment; the scores sent become the KPI's rating. Needs
 *             at least one MOV on the KPI.
 *   return    sent back to the division chief with a required note, and any rating is cleared, so
 *             the chief can fix the accomplishment or the MOVs and submit again.
 *
 * Every decision is checked before any is written. `submit_rating` routes here too, as a validate
 * with the scores it carries.
 */
function opcr_validate_records(PDO $pdo, array $user): void
{
    if (!opcr_can_validate($user)) {
        json_response(['success' => false, 'message' => 'Only the Regional Director can validate OPCR accomplishments.'], 403);
    }

    $body = opcr_request_body();
    $decisions = [];

    foreach (opcr_payload_rows($body, 'decisions') as $row) {
        $assignmentId = (int)($row['assignment_id'] ?? $row['assignmentId'] ?? 0);
        $record = opcr_fetch_record($pdo, $user, $assignmentId);
        $label = opcr_kpi_label($record);

        $status = opcr_status_of($record);
        if ($status === 'returned') {
            json_response([
                'success' => false,
                'message' => sprintf('%s was returned and is waiting for the division chief to submit it again.', $label),
            ], 422);
        }
        if (!in_array($status, ['submitted', 'rated'], true)) {
            json_response(['success' => false, 'message' => sprintf('%s has not been submitted by the division chief yet.', $label)], 422);
        }

        $decision = strtolower(opcr_text($row['decision'] ?? 'validate'));
        $remarks = opcr_text($row['remarks'] ?? '');

        if ($decision === 'return') {
            if ($remarks === '') {
                json_response(['success' => false, 'message' => sprintf('Tell the division chief what to fix in %s before returning it.', $label)], 422);
            }
            $decisions[$assignmentId] = ['decision' => 'return', 'remarks' => $remarks];
            continue;
        }

        if ($decision !== 'validate') {
            json_response(['success' => false, 'message' => sprintf('Choose Validate or Return for %s.', $label)], 422);
        }

        if (opcr_verification_count($pdo, $assignmentId) === 0) {
            json_response([
                'success' => false,
                'message' => sprintf('%s has no MOV to validate. Return it to the division chief instead.', $label),
            ], 422);
        }

        // Re-saving a validated KPI may leave a score out to keep it as it is.
        $scores = opcr_scores_or_fail($row, $record, $status === 'rated'
            ? [$record['q1Rating'] ?? null, $record['e2Rating'] ?? null, $record['t3Rating'] ?? null]
            : [null, null, null]);
        $decisions[$assignmentId] = [
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
            'UPDATE division_opcr_assignments
             SET q1_rating = :q1_rating,
                 e2_rating = :e2_rating,
                 t3_rating = :t3_rating,
                 a4_rating = :a4_rating,
                 final_rating = :final_rating,
                 remarks = :remarks,
                 assignment_status = "Rated",
                 reviewed_by_user_id = :reviewed_by_user_id,
                 reviewed_at = NOW(),
                 approval_remarks = NULL
             WHERE assignment_id = :assignment_id'
        );
        $return = $pdo->prepare(
            'UPDATE division_opcr_assignments
             SET q1_rating = NULL,
                 e2_rating = NULL,
                 t3_rating = NULL,
                 a4_rating = NULL,
                 final_rating = NULL,
                 assignment_status = "Returned",
                 reviewed_by_user_id = :reviewed_by_user_id,
                 reviewed_at = NOW(),
                 approval_remarks = :approval_remarks
             WHERE assignment_id = :assignment_id'
        );

        foreach ($decisions as $assignmentId => $decision) {
            if ($decision['decision'] === 'return') {
                $return->execute([
                    ':reviewed_by_user_id' => $reviewerId,
                    ':approval_remarks' => $decision['remarks'],
                    ':assignment_id' => $assignmentId,
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
                ':assignment_id' => $assignmentId,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $records = opcr_records_by_ids($pdo, array_keys($decisions));
    $returnedIds = array_keys(array_filter($decisions, static fn (array $decision): bool => $decision['decision'] === 'return'));
    $validatedIds = array_values(array_diff(array_keys($decisions), $returnedIds));

    write_auth_audit($pdo, $user, 'opcr.validated', 'OPCR KPIs were validated or returned.', [
        'validatedIds' => $validatedIds,
        'returnedIds' => $returnedIds,
        'divisions' => array_values(array_unique(array_column($records, 'division'))),
    ]);

    foreach (opcr_records_by_division($records) as $divisionRecords) {
        $division = opcr_text($divisionRecords[0]['division'] ?? '');
        $chiefs = opcr_chief_user_ids($pdo, $division);
        $validated = array_values(array_filter($divisionRecords, static fn (array $record): bool => in_array((int)$record['assignmentId'], $validatedIds, true)));
        $returned = array_values(array_filter($divisionRecords, static fn (array $record): bool => in_array((int)$record['assignmentId'], $returnedIds, true)));

        if ($validated !== []) {
            notify_users(
                $pdo,
                $chiefs,
                'OPCR Validated',
                sprintf(
                    '%s of %s for %s %s validated by the Regional Director. Open the OPCR desk to see the rating.',
                    opcr_kpi_count_label(count($validated)),
                    $division,
                    opcr_period_label($validated[0]),
                    count($validated) === 1 ? 'was' : 'were'
                ),
                'opcr_validated',
                (string)$validated[0]['assignmentId']
            );
        }

        if ($returned !== []) {
            notify_users(
                $pdo,
                $chiefs,
                'OPCR Returned',
                sprintf(
                    '%s of %s for %s %s returned by the Regional Director. Open the OPCR desk to read the note, fix the accomplishment or MOVs, and submit again.',
                    opcr_kpi_count_label(count($returned)),
                    $division,
                    opcr_period_label($returned[0]),
                    count($returned) === 1 ? 'was' : 'were'
                ),
                'opcr_returned',
                (string)$returned[0]['assignmentId']
            );
        }
    }

    $message = match (true) {
        $returnedIds === [] => count($validatedIds) === 1 ? 'OPCR KPI validated.' : sprintf('%s validated.', opcr_kpi_count_label(count($validatedIds))),
        $validatedIds === [] => count($returnedIds) === 1 ? 'OPCR KPI returned to the division chief.' : sprintf('%s returned to the division chief.', opcr_kpi_count_label(count($returnedIds))),
        default => sprintf('%d validated, %d returned to the division chief.', count($validatedIds), count($returnedIds)),
    };

    json_response([
        'success' => true,
        'message' => $message,
        'record' => $records[0] ?? null,
        'records' => $records,
    ]);
}

/**
 * Attaches one MOV to a KPI the chief has not had validated yet. Attaching does not submit it:
 * the chief uploads the files first, then submit_accomplishment sends the KPI on.
 */
function opcr_upload_verification(PDO $pdo, array $user): void
{
    if (!opcr_can_submit($user)) {
        json_response(['success' => false, 'message' => 'Only the division chief can attach OPCR MOVs.'], 403);
    }

    $assignmentId = (int)($_POST['assignment_id'] ?? $_POST['assignmentId'] ?? 0);
    $record = opcr_fetch_record($pdo, $user, $assignmentId);

    if (opcr_is_validated($record)) {
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

    $uploadDir = dirname(__DIR__) . '/uploads/opcr-verifications';
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0775, true) && !is_dir($uploadDir)) {
        json_response(['success' => false, 'message' => 'Unable to prepare upload directory.'], 500);
    }

    $storedName = sprintf('opcr_%s_%s.%s', date('Ymd_His'), bin2hex(random_bytes(8)), $extension);
    $targetPath = $uploadDir . '/' . $storedName;
    if (!move_uploaded_file((string)$file['tmp_name'], $targetPath)) {
        json_response(['success' => false, 'message' => 'Unable to save verification file.'], 500);
    }

    $movFile = [
        'originalName' => $originalName,
        'storedPath' => 'uploads/opcr-verifications/' . $storedName,
        'fileSize' => (int)($file['size'] ?? filesize($targetPath)),
        'mimeType' => mime_content_type($targetPath) ?: null,
        'uploadedByUserId' => (int)($user['id'] ?? 0) ?: null,
        'createdAt' => date('Y-m-d H:i:s'),
    ];
    $full = false;

    // The row lock keeps two uploads to the same KPI from each saving a list without the other's file.
    $pdo->beginTransaction();
    try {
        $files = opcr_lock_verifications($pdo, $assignmentId);
        $number = 1;
        foreach ($files as $existing) {
            $number = max($number, ((int)($existing['id'] ?? 0) % OPCR_MOV_ID_FACTOR) + 1);
        }

        if ($number >= OPCR_MOV_ID_FACTOR) {
            $full = true;
            $pdo->rollBack();
        } else {
            $files[] = ['id' => $assignmentId * OPCR_MOV_ID_FACTOR + $number] + $movFile;
            opcr_store_verifications($pdo, $assignmentId, $files);
            $pdo->commit();
        }
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        @unlink($targetPath);

        throw $exception;
    }

    if ($full) {
        @unlink($targetPath);
        json_response(['success' => false, 'message' => 'This KPI already holds the most MOVs it can. Remove one first.'], 422);
    }

    json_response([
        'success' => true,
        'message' => 'OPCR verification file uploaded.',
        'record' => opcr_fetch_record($pdo, $user, $assignmentId),
    ], 201);
}

/**
 * Removes one MOV, file and all, while its KPI is still the chief's to change. A KPI waiting on
 * the Regional Director must keep at least one, so the replacement is attached before the last
 * one goes.
 */
function opcr_delete_verification(PDO $pdo, array $user): void
{
    if (!opcr_can_submit($user)) {
        json_response(['success' => false, 'message' => 'Only the division chief can remove OPCR MOVs.'], 403);
    }

    $body = opcr_request_body();
    $fileId = (int)($body['file_id'] ?? $body['fileId'] ?? $_GET['file_id'] ?? 0);
    if ($fileId <= 0) {
        json_response(['success' => false, 'message' => 'Choose the MOV to remove.'], 422);
    }

    // The id names the KPI whose list holds the MOV (see OPCR_MOV_ID_FACTOR).
    $assignmentId = intdiv($fileId, OPCR_MOV_ID_FACTOR);
    $file = null;
    foreach (opcr_files_for_records($pdo, [$assignmentId])[$assignmentId] ?? [] as $candidate) {
        if ($candidate['id'] === $fileId) {
            $file = $candidate;
            break;
        }
    }
    if ($file === null) {
        json_response(['success' => false, 'message' => 'MOV not found.'], 404);
    }

    // The read scope keeps a chief to their own division's MOVs.
    $record = opcr_fetch_record($pdo, $user, $assignmentId);

    if (opcr_is_validated($record)) {
        json_response(['success' => false, 'message' => 'This KPI is already validated, so its MOVs are locked.'], 422);
    }

    $refused = false;
    $pdo->beginTransaction();
    try {
        $remaining = array_values(array_filter(
            opcr_lock_verifications($pdo, $assignmentId),
            static fn (array $item): bool => (int)($item['id'] ?? 0) !== $fileId
        ));

        if (opcr_status_of($record) === 'submitted' && $remaining === []) {
            $refused = true;
            $pdo->rollBack();
        } else {
            opcr_store_verifications($pdo, $assignmentId, $remaining);
            $pdo->commit();
        }
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    if ($refused) {
        json_response([
            'success' => false,
            'message' => 'A submitted KPI needs at least one MOV. Attach the replacement before removing this one.',
        ], 422);
    }

    // Only ever a file under the OPCR upload folder, whatever the stored path says.
    $uploadDir = realpath(dirname(__DIR__) . '/uploads/opcr-verifications');
    $storedPath = realpath(dirname(__DIR__) . '/' . ltrim((string)$file['storedPath'], '/\\'));
    if ($uploadDir !== false && $storedPath !== false && str_starts_with($storedPath, $uploadDir . DIRECTORY_SEPARATOR)) {
        @unlink($storedPath);
    }

    write_auth_audit($pdo, $user, 'opcr.verification_removed', 'An OPCR MOV was removed.', [
        'assignmentId' => $assignmentId,
        'fileId' => $fileId,
        'originalName' => $file['originalName'],
    ]);

    json_response([
        'success' => true,
        'message' => 'MOV removed.',
        'record' => opcr_fetch_record($pdo, $user, $assignmentId),
    ]);
}

/**
 * Stream one OPCR form as an .xlsx laid out like the form itself.
 *
 * Assignment-based exports contain every KPI for the same accountable unit and rating period,
 * matching the grouped form in the management workspace. Template-only links remain supported.
 */
function opcr_export_form(PDO $pdo, array $user): void
{
    if (!opcr_can_view($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to view OPCR records.'], 403);
    }

    $templateId = (int)($_GET['template_id'] ?? $_GET['templateId'] ?? 0);
    $assignmentId = (int)($_GET['assignment_id'] ?? $_GET['assignmentId'] ?? 0);

    if ($templateId <= 0 && $assignmentId <= 0) {
        json_response(['success' => false, 'message' => 'An OPCR form is required.'], 422);
    }

    if ($assignmentId > 0) {
        $anchor = opcr_fetch_record($pdo, $user, $assignmentId);
        $where = ['doa.is_archived = 0', 'doa.period = :period', 'doa.semester = :semester'];
        $parameters = [':period' => $anchor['period'], ':semester' => $anchor['semester']];
        if (!empty($anchor['employeeRecordId'])) {
            $where[] = 'doa.employee_id = :employee_id';
            $parameters[':employee_id'] = $anchor['employeeRecordId'];
        } else {
            $where[] = 'doa.employee_id IS NULL AND LOWER(TRIM(doa.division)) = :division';
            $parameters[':division'] = mb_strtolower(trim((string)$anchor['division']));
        }
    } else {
        $where = ['doa.template_id = :template_id', 'doa.is_archived = 0'];
        $parameters = [':template_id' => $templateId];
    }

    // A template is shared by every division assigned it, so a chief's export keeps to their own.
    if (!opcr_apply_read_scope($pdo, $user, $where, $parameters)) {
        json_response(['success' => false, 'message' => 'OPCR form not found.'], 404);
    }

    $statement = $pdo->prepare(opcr_base_select() . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY ot.category ASC, ot.sub_category ASC, doa.assignment_id ASC');
    $statement->execute($parameters);
    $records = opcr_attach_signatories(
        $pdo,
        array_map(static fn (array $row): array => opcr_format_record($row), $statement->fetchAll())
    );

    if ($records === []) {
        json_response(['success' => false, 'message' => 'OPCR form not found.'], 404);
    }

    $label = trim(implode(' ', array_filter([
        opcr_text($records[0]['period'] ?? ''),
        opcr_text($records[0]['semester'] ?? ''),
    ])));

    perf_export_stream(
        perf_opcr_form_sheet($records),
        'OPCR Form',
        trim('OPCR Form ' . $label),
        perf_export_filename('opcr-form', $label)
    );
}

try {
    ensure_opcr_tables($pdo);

    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $action = opcr_text($_GET['action'] ?? $_POST['action'] ?? 'list');

    if ($method === 'GET' && $action === 'list') {
        opcr_fetch_records($pdo, $sessionUser);
    }

    if ($method === 'GET' && $action === 'view') {
        $record = opcr_fetch_record($pdo, $sessionUser, (int)($_GET['assignment_id'] ?? $_GET['assignmentId'] ?? 0));
        json_response(['success' => true, 'record' => $record]);
    }

    if ($method === 'GET' && $action === 'export_form') {
        opcr_export_form($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'create') {
        opcr_create_records($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'update') {
        opcr_update_record($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'upload_verification') {
        opcr_upload_verification($pdo, $sessionUser);
    }

    if ($method === 'DELETE' && $action === 'delete_verification') {
        opcr_delete_verification($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'submit_accomplishment') {
        opcr_submit_accomplishment($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && in_array($action, ['validate', 'submit_rating'], true)) {
        opcr_validate_records($pdo, $sessionUser);
    }

    if ($method === 'DELETE' && $action === 'archive') {
        opcr_archive_record($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'restore') {
        opcr_restore_record($pdo, $sessionUser);
    }

    json_response(['success' => false, 'message' => 'Unsupported OPCR action.'], 405);
} catch (Throwable $exception) {
    error_log('OPCR API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process OPCR request.',
    ], 500);
}
