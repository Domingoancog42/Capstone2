<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

function opcr_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function opcr_role_key(array $user): string
{
    return hris_user_role_key($user);
}

function opcr_can_view(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'hrhead', 'hrstaff', 'chief', 'regionaldirector'], true);
}

function opcr_can_manage(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function opcr_can_rate(array $user): bool
{
    return in_array(opcr_role_key($user), ['admin', 'hrhead', 'hrstaff', 'chief', 'regionaldirector'], true);
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
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS opcr_templates (
            template_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            template_name VARCHAR(150) NOT NULL,
            category VARCHAR(150) NOT NULL,
            office_division TEXT NOT NULL,
            year_semester VARCHAR(100) NOT NULL DEFAULT '',
            template_status VARCHAR(50) NOT NULL DEFAULT 'Active',
            output TEXT NOT NULL,
            success_indicator TEXT NOT NULL,
            budget DECIMAL(12,2) NULL,
            is_archived TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (template_id),
            KEY idx_opcr_templates_name (template_name),
            KEY idx_opcr_templates_category (category),
            KEY idx_opcr_templates_is_archived (is_archived)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS division_opcr_assignments (
            assignment_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            opcr_no VARCHAR(50) NOT NULL,
            template_id INT UNSIGNED NOT NULL,
            employee_id INT UNSIGNED NULL,
            division VARCHAR(150) NOT NULL,
            period VARCHAR(100) NOT NULL,
            semester VARCHAR(50) NOT NULL,
            prepared_by VARCHAR(150) NOT NULL,
            budget DECIMAL(12,2) NULL,
            remarks TEXT NULL,
            actual_accomplishment TEXT NULL,
            assignment_status VARCHAR(50) NOT NULL DEFAULT 'Assigned',
            approved_by VARCHAR(150) NULL,
            final_rating DECIMAL(5,2) NULL,
            q1_rating DECIMAL(5,2) NULL,
            e2_rating DECIMAL(5,2) NULL,
            t3_rating DECIMAL(5,2) NULL,
            a4_rating DECIMAL(5,2) NULL,
            mode_of_verification_name VARCHAR(255) NULL,
            mode_of_verification_path VARCHAR(500) NULL,
            mode_of_verification_size INT UNSIGNED NULL,
            submitted_at DATETIME NULL,
            is_archived TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (assignment_id),
            UNIQUE KEY uq_division_opcr_no (opcr_no),
            KEY idx_division_opcr_template (template_id),
            KEY idx_division_opcr_employee (employee_id),
            KEY idx_division_opcr_division (division),
            KEY idx_division_opcr_status (assignment_status),
            KEY idx_division_opcr_archived (is_archived)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

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
        'created_at' => 'ALTER TABLE division_opcr_assignments ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER is_archived',
        'updated_at' => 'ALTER TABLE division_opcr_assignments ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    ];

    foreach ($columns as $column => $sql) {
        if (!opcr_column_exists($pdo, 'division_opcr_assignments', $column)) {
            $pdo->exec($sql);
        }
    }
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
            doa.created_at AS createdAt,
            doa.updated_at AS updatedAt,
            ot.template_name AS templateName,
            ot.category,
            ot.output,
            ot.success_indicator AS successIndicator
        FROM division_opcr_assignments doa
        INNER JOIN opcr_templates ot ON ot.template_id = doa.template_id
        LEFT JOIN employees e ON e.id = doa.employee_id
        LEFT JOIN designations des ON des.id = e.designation_id';
}

function opcr_format_record(array $row): array
{
    $assignmentId = (int)($row['assignmentId'] ?? $row['assignment_id'] ?? 0);
    $employeeRecordId = $row['employeeRecordId'] !== null ? (int)$row['employeeRecordId'] : null;

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
        'templateName' => $row['templateName'] ?? null,
        'category' => $row['category'] ?? 'Program',
        'output' => $row['output'] ?? null,
        'kpiTitle' => $row['output'] ?? null,
        'successIndicator' => $row['successIndicator'] ?? null,
        'createdAt' => $row['createdAt'] ?? null,
        'updatedAt' => $row['updatedAt'] ?? null,
    ];
}

function opcr_fetch_record(PDO $pdo, array $user, int $assignmentId): array
{
    if ($assignmentId <= 0) {
        json_response(['success' => false, 'message' => 'OPCR assignment is required.'], 422);
    }

    if (!opcr_can_view($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to view OPCR records.'], 403);
    }

    $statement = $pdo->prepare(opcr_base_select() . ' WHERE doa.assignment_id = :assignment_id AND doa.is_archived = 0 LIMIT 1');
    $statement->execute([':assignment_id' => $assignmentId]);
    $row = $statement->fetch();

    if (!$row) {
        json_response(['success' => false, 'message' => 'OPCR assignment not found.'], 404);
    }

    return opcr_format_record($row);
}

function opcr_fetch_records(PDO $pdo, array $user): void
{
    if (!opcr_can_view($user)) {
        json_response(['success' => true, 'records' => []]);
    }

    $params = [];
    $where = ['doa.is_archived = 0'];
    $status = opcr_text($_GET['status'] ?? '');

    if ($status !== '') {
        $where[] = 'doa.assignment_status = :status';
        $params[':status'] = $status;
    }

    $statement = $pdo->prepare(opcr_base_select() . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY doa.created_at DESC, doa.assignment_id DESC');
    $statement->execute($params);
    $records = array_map(static fn (array $row): array => opcr_format_record($row), $statement->fetchAll());

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

function opcr_create_records(PDO $pdo, array $user): void
{
    if (!opcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to assign OPCR KPIs.'], 403);
    }

    $body = opcr_request_body();
    $items = opcr_accountable_items_from_payload($pdo, $body);
    $output = opcr_text($body['output'] ?? $body['kpiTitle'] ?? '');
    $successIndicator = opcr_text($body['success_indicator'] ?? $body['successIndicator'] ?? '');
    $category = opcr_text($body['category'] ?? $body['kpi_category'] ?? $body['kpiCategory'] ?? 'Program');
    $category = strcasecmp($category, 'Operations') === 0 ? 'Operations' : 'Program';
    $period = opcr_text($body['period'] ?? ('FY ' . date('Y')));
    $semester = opcr_text($body['semester'] ?? '1st Semester');
    $budget = opcr_decimal_or_null($body['budget'] ?? null);
    $preparedBy = opcr_user_display_name($user);

    if ($items === [] || $output === '' || $successIndicator === '' || $period === '' || $semester === '') {
        json_response(['success' => false, 'message' => 'Accountable items, KPI title, success indicator, period, and semester are required.'], 422);
    }

    $officeDivision = implode(', ', array_map(static fn (array $item): string => $item['name'], $items));
    $yearSemester = trim($period . ' - ' . $semester);

    $pdo->beginTransaction();
    try {
        $template = $pdo->prepare(
            'INSERT INTO opcr_templates
                (template_name, category, office_division, year_semester, template_status, output, success_indicator, budget)
             VALUES
                (:template_name, :category, :office_division, :year_semester, :template_status, :output, :success_indicator, :budget)'
        );
        $template->execute([
            ':template_name' => $output,
            ':category' => $category,
            ':office_division' => $officeDivision,
            ':year_semester' => $yearSemester,
            ':template_status' => 'Active',
            ':output' => $output,
            ':success_indicator' => $successIndicator,
            ':budget' => $budget,
        ]);
        $templateId = (int)$pdo->lastInsertId();

        $insert = $pdo->prepare(
            'INSERT INTO division_opcr_assignments
                (opcr_no, template_id, employee_id, division, period, semester, prepared_by, budget, assignment_status)
             VALUES
                (:opcr_no, :template_id, :employee_id, :division, :period, :semester, :prepared_by, :budget, :assignment_status)'
        );

        $createdIds = [];
        foreach ($items as $item) {
            $insert->execute([
                ':opcr_no' => opcr_generate_no($pdo),
                ':template_id' => $templateId,
                ':employee_id' => $item['employeeId'] ?: null,
                ':division' => $item['employeeId'] ? ($item['division'] ?: $item['name']) : $item['division'],
                ':period' => $period,
                ':semester' => $semester,
                ':prepared_by' => $preparedBy,
                ':budget' => $budget,
                ':assignment_status' => 'Assigned',
            ]);
            $createdIds[] = (int)$pdo->lastInsertId();
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $placeholders = implode(',', array_fill(0, count($createdIds), '?'));
    $statement = $pdo->prepare(opcr_base_select() . " WHERE doa.assignment_id IN ({$placeholders}) ORDER BY doa.assignment_id DESC");
    $statement->execute($createdIds);
    $records = array_map(static fn (array $row): array => opcr_format_record($row), $statement->fetchAll());

    write_auth_audit($pdo, $user, 'opcr.kpi_assigned', 'OPCR KPI records were assigned.', [
        'createdIds' => $createdIds,
        'category' => $category,
        'period' => $period,
        'semester' => $semester,
    ]);

    json_response([
        'success' => true,
        'message' => 'OPCR KPI assigned successfully.',
        'records' => $records,
    ], 201);
}

function opcr_submit_rating(PDO $pdo, array $user): void
{
    if (!opcr_can_rate($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to rate OPCR records.'], 403);
    }

    $body = opcr_request_body();
    $assignmentId = (int)($body['assignment_id'] ?? $body['assignmentId'] ?? 0);
    $record = opcr_fetch_record($pdo, $user, $assignmentId);

    $q1 = opcr_decimal_or_null($body['q1_rating'] ?? $body['q1Rating'] ?? null);
    $e2 = opcr_decimal_or_null($body['e2_rating'] ?? $body['e2Rating'] ?? null);
    $t3 = opcr_decimal_or_null($body['t3_rating'] ?? $body['t3Rating'] ?? null);
    $a4 = opcr_decimal_or_null($body['a4_rating'] ?? $body['a4Rating'] ?? null);
    $remarks = opcr_text($body['remarks'] ?? '');
    $actualAccomplishment = opcr_text($body['actual_accomplishment'] ?? $body['actualAccomplishment'] ?? '');

    if ($q1 === null || $e2 === null || $t3 === null) {
        json_response(['success' => false, 'message' => 'Quantity, efficiency, and timeliness ratings are required.'], 422);
    }

    foreach ([$q1, $e2, $t3] as $rating) {
        if ($rating < 1 || $rating > 5) {
            json_response(['success' => false, 'message' => 'Ratings must be from 1 to 5.'], 422);
        }
    }

    $average = $a4 ?? round(($q1 + $e2 + $t3) / 3, 2);

    $statement = $pdo->prepare(
        'UPDATE division_opcr_assignments
         SET actual_accomplishment = :actual_accomplishment,
             remarks = :remarks,
             q1_rating = :q1_rating,
             e2_rating = :e2_rating,
             t3_rating = :t3_rating,
             a4_rating = :a4_rating,
             final_rating = :final_rating,
             assignment_status = :assignment_status,
             submitted_at = COALESCE(submitted_at, NOW())
         WHERE assignment_id = :assignment_id'
    );
    $statement->execute([
        ':actual_accomplishment' => $actualAccomplishment !== '' ? $actualAccomplishment : null,
        ':remarks' => $remarks !== '' ? $remarks : null,
        ':q1_rating' => $q1,
        ':e2_rating' => $e2,
        ':t3_rating' => $t3,
        ':a4_rating' => $average,
        ':final_rating' => $average,
        ':assignment_status' => 'Rated',
        ':assignment_id' => $assignmentId,
    ]);

    write_auth_audit($pdo, $user, 'opcr.rated', 'An OPCR record was rated.', [
        'assignmentId' => $assignmentId,
        'opcrNo' => $record['opcrNo'] ?? null,
        'average' => $average,
    ]);

    json_response([
        'success' => true,
        'message' => 'OPCR rating saved.',
        'record' => opcr_fetch_record($pdo, $user, $assignmentId),
    ]);
}

function opcr_upload_verification(PDO $pdo, array $user): void
{
    if (!opcr_can_rate($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to upload OPCR verification files.'], 403);
    }

    $assignmentId = (int)($_POST['assignment_id'] ?? $_POST['assignmentId'] ?? 0);
    opcr_fetch_record($pdo, $user, $assignmentId);

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

    $relativePath = 'uploads/opcr-verifications/' . $storedName;
    $fileSize = (int)($file['size'] ?? filesize($targetPath));

    $statement = $pdo->prepare(
        'UPDATE division_opcr_assignments
         SET mode_of_verification_name = :name,
             mode_of_verification_path = :path,
             mode_of_verification_size = :size,
             assignment_status = CASE WHEN assignment_status = "Assigned" THEN "Submitted" ELSE assignment_status END,
             submitted_at = COALESCE(submitted_at, NOW())
         WHERE assignment_id = :assignment_id'
    );
    $statement->execute([
        ':name' => $originalName,
        ':path' => $relativePath,
        ':size' => $fileSize,
        ':assignment_id' => $assignmentId,
    ]);

    json_response([
        'success' => true,
        'message' => 'OPCR verification file uploaded.',
        'record' => opcr_fetch_record($pdo, $user, $assignmentId),
    ], 201);
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

    if ($method === 'POST' && $action === 'create') {
        opcr_create_records($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'upload_verification') {
        opcr_upload_verification($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'submit_rating') {
        opcr_submit_rating($pdo, $sessionUser);
    }

    json_response(['success' => false, 'message' => 'Unsupported OPCR action.'], 405);
} catch (Throwable $exception) {
    error_log('OPCR API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process OPCR request.',
    ], 500);
}
