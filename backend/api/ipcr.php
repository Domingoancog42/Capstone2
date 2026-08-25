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
        'status' => "ALTER TABLE ipcr ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'draft' AFTER submitted_at",
        'created_at' => 'ALTER TABLE ipcr ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER is_archived',
        'updated_at' => 'ALTER TABLE ipcr ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    ];

    foreach ($columns as $column => $sql) {
        if (!ipcr_column_exists($pdo, 'ipcr', $column)) {
            $pdo->exec($sql);
        }
    }

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
        'category' => $row['kpiCategory'] ?? 'Program',
        'kpiCategory' => $row['kpiCategory'] ?? 'Program',
        'actualAccomplishment' => $row['actualAccomplishment'] ?? null,
        'remarks' => $row['remarks'] ?? null,
        'finalRating' => $row['finalRating'] !== null ? (float)$row['finalRating'] : null,
        'q1Rating' => $row['q1Rating'] !== null ? (float)$row['q1Rating'] : null,
        'e2Rating' => $row['e2Rating'] !== null ? (float)$row['e2Rating'] : null,
        't3Rating' => $row['t3Rating'] !== null ? (float)$row['t3Rating'] : null,
        'a4Rating' => $row['a4Rating'] !== null ? (float)$row['a4Rating'] : null,
        'modeOfVerificationName' => $row['modeOfVerificationName'] ?? null,
        'modeOfVerificationPath' => $row['modeOfVerificationPath'] ?? null,
        'modeOfVerificationSize' => $row['modeOfVerificationSize'] !== null ? (int)$row['modeOfVerificationSize'] : null,
        'submittedAt' => $row['submittedAt'] ?? null,
        'status' => $row['status'] ?? 'draft',
        'createdAt' => $row['createdAt'] ?? null,
        'updatedAt' => $row['updatedAt'] ?? null,
        'verificationFiles' => $files[$recordId] ?? [],
    ];
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
            i.kpi_category AS kpiCategory,
            i.actual_accomplishment AS actualAccomplishment,
            i.remarks,
            i.final_rating AS finalRating,
            i.q1_rating AS q1Rating,
            i.e2_rating AS e2Rating,
            i.t3_rating AS t3Rating,
            i.a4_rating AS a4Rating,
            i.mode_of_verification_name AS modeOfVerificationName,
            i.mode_of_verification_path AS modeOfVerificationPath,
            i.mode_of_verification_size AS modeOfVerificationSize,
            i.submitted_at AS submittedAt,
            i.status,
            i.created_at AS createdAt,
            i.updated_at AS updatedAt
        FROM ipcr i
        INNER JOIN employees e ON e.id = i.employee_id
        LEFT JOIN divisions d ON d.id = e.division_id
        LEFT JOIN designations des ON des.id = e.designation_id';
}

function ipcr_fetch_records(PDO $pdo, array $user): void
{
    $params = [];
    $where = ['i.is_archived = 0'];

    if (!ipcr_can_view_all($user)) {
        $employeeRecordId = session_employee_record_id($pdo, $user);
        if ($employeeRecordId === null) {
            json_response(['success' => true, 'records' => []]);
        }
        $where[] = 'i.employee_id = :employee_id';
        $params[':employee_id'] = $employeeRecordId;
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

function ipcr_fetch_record(PDO $pdo, array $user, int $ipcrId): array
{
    if ($ipcrId <= 0) {
        json_response(['success' => false, 'message' => 'IPCR record is required.'], 422);
    }

    $params = [':ipcr_id' => $ipcrId];
    $where = ['i.ipcr_id = :ipcr_id', 'i.is_archived = 0'];

    if (!ipcr_can_view_all($user)) {
        $employeeRecordId = session_employee_record_id($pdo, $user);
        if ($employeeRecordId === null) {
            json_response(['success' => false, 'message' => 'IPCR record not found.'], 404);
        }
        $where[] = 'i.employee_id = :employee_id';
        $params[':employee_id'] = $employeeRecordId;
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
            'category' => $category,
            'periodFrom' => ipcr_date_or_default($rawRow['period_from'] ?? $rawRow['periodFrom'] ?? null, $periodFrom),
            'periodTo' => ipcr_date_or_default($rawRow['period_to'] ?? $rawRow['periodTo'] ?? null, $periodTo),
        ];
    }

    return $rows;
}

function ipcr_create_records(PDO $pdo, array $user): void
{
    if (!ipcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to assign IPCR KPIs.'], 403);
    }

    $body = ipcr_request_body();
    $employeeIds = ipcr_employee_ids_from_payload($body);
    $periodFrom = ipcr_date_or_default($body['period_from'] ?? $body['periodFrom'] ?? null, date('Y-01-01'));
    $periodTo = ipcr_date_or_default($body['period_to'] ?? $body['periodTo'] ?? null, date('Y-06-30'));
    $kpis = ipcr_kpi_rows_from_payload($body, $periodFrom, $periodTo);

    if ($employeeIds === [] || $kpis === []) {
        json_response(['success' => false, 'message' => 'Employee, KPI title, and success indicator are required.'], 422);
    }

    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare(
            'INSERT INTO ipcr
                (employee_id, period_from, period_to, output, success_indicator, kpi_category, status)
             VALUES
                (:employee_id, :period_from, :period_to, :output, :success_indicator, :kpi_category, :status)'
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
                    ':kpi_category' => $kpi['category'],
                    ':status' => 'draft',
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
    $statement = $pdo->prepare(ipcr_base_select() . " WHERE i.ipcr_id IN ({$placeholders}) ORDER BY i.ipcr_id DESC");
    $statement->execute($createdIds);
    $rows = $statement->fetchAll();
    $files = ipcr_files_for_records($pdo, $createdIds);
    $records = array_map(static fn (array $row): array => ipcr_format_record($row, $files), $rows);

    write_auth_audit($pdo, $user, 'ipcr.kpi_assigned', 'IPCR KPI records were assigned.', [
        'employeeIds' => $employeeIds,
        'createdIds' => $createdIds,
        'kpiCount' => count($kpis),
        'categories' => array_values(array_unique(array_column($kpis, 'category'))),
    ]);

    json_response([
        'success' => true,
        'message' => 'KPI assigned successfully.',
        'records' => $records,
    ], 201);
}

function ipcr_submit_rating(PDO $pdo, array $user): void
{
    if (!ipcr_can_manage($user) && !in_array(ipcr_role_key($user), ['chief', 'planningofficer'], true)) {
        json_response(['success' => false, 'message' => 'You are not allowed to rate IPCR records.'], 403);
    }

    $body = ipcr_request_body();
    $ipcrId = (int)($body['ipcr_id'] ?? $body['ipcrId'] ?? 0);
    $record = ipcr_fetch_record($pdo, $user, $ipcrId);

    $q1 = ipcr_decimal_or_null($body['q1_rating'] ?? $body['q1Rating'] ?? null);
    $e2 = ipcr_decimal_or_null($body['e2_rating'] ?? $body['e2Rating'] ?? null);
    $t3 = ipcr_decimal_or_null($body['t3_rating'] ?? $body['t3Rating'] ?? null);
    $a4 = ipcr_decimal_or_null($body['a4_rating'] ?? $body['a4Rating'] ?? null);
    $remarks = ipcr_text($body['remarks'] ?? '');

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
        'UPDATE ipcr
         SET remarks = :remarks,
             q1_rating = :q1_rating,
             e2_rating = :e2_rating,
             t3_rating = :t3_rating,
             a4_rating = :a4_rating,
             final_rating = :final_rating,
             status = :status,
             submitted_at = COALESCE(submitted_at, NOW())
         WHERE ipcr_id = :ipcr_id'
    );
    $statement->execute([
        ':remarks' => $remarks !== '' ? $remarks : null,
        ':q1_rating' => $q1,
        ':e2_rating' => $e2,
        ':t3_rating' => $t3,
        ':a4_rating' => $average,
        ':final_rating' => $average,
        ':status' => 'rated',
        ':ipcr_id' => $ipcrId,
    ]);

    write_auth_audit($pdo, $user, 'ipcr.rated', 'An IPCR record was rated.', [
        'ipcrId' => $ipcrId,
        'employeeRecordId' => $record['employeeRecordId'] ?? null,
        'average' => $average,
    ]);

    json_response([
        'success' => true,
        'message' => 'IPCR rating saved.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
    ]);
}

function ipcr_submit_accomplishment(PDO $pdo, array $user): void
{
    $body = ipcr_request_body();
    $ipcrId = (int)($body['ipcr_id'] ?? $body['ipcrId'] ?? 0);
    $record = ipcr_fetch_record($pdo, $user, $ipcrId);

    $sessionEmployeeId = session_employee_record_id($pdo, $user);
    $isOwner = $sessionEmployeeId !== null
        && (int)($record['employeeRecordId'] ?? 0) === (int)$sessionEmployeeId;

    if (!$isOwner && !ipcr_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to submit this IPCR accomplishment.'], 403);
    }

    $actualAccomplishment = ipcr_text($body['actual_accomplishment'] ?? $body['actualAccomplishment'] ?? '');
    $q1 = ipcr_decimal_or_null($body['q1_rating'] ?? $body['q1Rating'] ?? null);
    $e2 = ipcr_decimal_or_null($body['e2_rating'] ?? $body['e2Rating'] ?? null);
    $t3 = ipcr_decimal_or_null($body['t3_rating'] ?? $body['t3Rating'] ?? null);

    if ($actualAccomplishment === '') {
        json_response(['success' => false, 'message' => 'Actual accomplishment is required.'], 422);
    }

    if ($q1 === null || $e2 === null || $t3 === null) {
        json_response(['success' => false, 'message' => 'Quantity, efficiency, and timeliness ratings are required.'], 422);
    }

    foreach ([$q1, $e2, $t3] as $rating) {
        if ($rating < 1 || $rating > 5) {
            json_response(['success' => false, 'message' => 'Ratings must be from 1 to 5.'], 422);
        }
    }

    $average = round(($q1 + $e2 + $t3) / 3, 2);

    $statement = $pdo->prepare(
        'UPDATE ipcr
         SET actual_accomplishment = :actual_accomplishment,
             q1_rating = :q1_rating,
             e2_rating = :e2_rating,
             t3_rating = :t3_rating,
             a4_rating = :a4_rating,
             final_rating = :final_rating,
             status = CASE WHEN status = "rated" THEN status ELSE "submitted" END,
             submitted_at = COALESCE(submitted_at, NOW())
         WHERE ipcr_id = :ipcr_id'
    );
    $statement->execute([
        ':actual_accomplishment' => $actualAccomplishment,
        ':q1_rating' => $q1,
        ':e2_rating' => $e2,
        ':t3_rating' => $t3,
        ':a4_rating' => $average,
        ':final_rating' => $average,
        ':ipcr_id' => $ipcrId,
    ]);

    write_auth_audit($pdo, $user, 'ipcr.accomplishment_submitted', 'An IPCR accomplishment was submitted.', [
        'ipcrId' => $ipcrId,
        'employeeRecordId' => $record['employeeRecordId'] ?? null,
        'average' => $average,
    ]);

    json_response([
        'success' => true,
        'message' => 'IPCR accomplishment submitted.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
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

function ipcr_upload_verification(PDO $pdo, array $user): void
{
    $ipcrId = (int)($_POST['ipcr_id'] ?? $_POST['ipcrId'] ?? 0);
    $record = ipcr_fetch_record($pdo, $user, $ipcrId);

    $sessionEmployeeId = session_employee_record_id($pdo, $user);
    $canUpload = ipcr_can_manage($user) || (int)($record['employeeRecordId'] ?? 0) === (int)$sessionEmployeeId;
    if (!$canUpload) {
        json_response(['success' => false, 'message' => 'You are not allowed to upload verification files for this IPCR.'], 403);
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

    $update = $pdo->prepare(
        'UPDATE ipcr
         SET mode_of_verification_name = :name,
             mode_of_verification_path = :path,
             mode_of_verification_size = :size,
             status = CASE WHEN status = "draft" THEN "submitted" ELSE status END,
             submitted_at = COALESCE(submitted_at, NOW())
         WHERE ipcr_id = :ipcr_id'
    );
    $update->execute([
        ':name' => $originalName,
        ':path' => $relativePath,
        ':size' => $fileSize,
        ':ipcr_id' => $ipcrId,
    ]);

    json_response([
        'success' => true,
        'message' => 'Verification file uploaded.',
        'record' => ipcr_fetch_record($pdo, $user, $ipcrId),
    ], 201);
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

    if ($method === 'POST' && $action === 'upload_verification') {
        ipcr_upload_verification($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'submit_rating') {
        ipcr_submit_rating($pdo, $sessionUser);
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

    json_response(['success' => false, 'message' => 'Unsupported IPCR action.'], 405);
} catch (Throwable $exception) {
    error_log('IPCR API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process IPCR request.',
    ], 500);
}
