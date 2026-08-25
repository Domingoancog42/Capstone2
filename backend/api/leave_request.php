<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';
require_once __DIR__ . '/leave-credit-utils.php';
require_once __DIR__ . '/captcha-utils.php';

$sessionUser = require_session_user();

const LEAVE_REQUEST_META_PREFIX = '[HRIS_LEAVE_META]';

const LEAVE_VACATION_SCOPE_LABELS = [
    'within_philippines' => 'Within the Philippines',
    'abroad' => 'Abroad',
];

const LEAVE_SICK_MODE_LABELS = [
    'in_hospital' => 'In Hospital',
    'out_patient' => 'Out Patient',
];

const LEAVE_STUDY_PURPOSE_LABELS = [
    'masters' => "Completion of Master's Degree",
    'bar_review' => 'BAR/Board Examination Review',
];

function leave_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function leave_truthy(mixed $value): bool
{
    return in_array(strtolower(leave_text($value)), ['1', 'true', 'yes', 'on'], true);
}

function leave_date_or_null(mixed $value): ?string
{
    $text = leave_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function leave_status_to_client(string $status): string
{
    return match (strtolower($status)) {
        'reviewed' => 'Reviewed',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled', 'withdrawn' => 'Cancelled',
        default => 'Pending',
    };
}

function leave_status_to_database(mixed $status): string
{
    return match (strtolower(leave_text($status))) {
        'reviewed' => 'reviewed',
        'approved' => 'approved',
        'rejected' => 'rejected',
        'cancelled', 'canceled', 'withdrawn' => 'cancelled',
        default => 'pending',
    };
}

function leave_role_key(array $user): string
{
    return user_role_key($user);
}

function leave_can_manage(array $user): bool
{
    return in_array(leave_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector'], true);
}

function leave_can_view_all(array $user): bool
{
    return leave_role_key($user) !== 'employee';
}

function leave_can_select_employee(array $user): bool
{
    return leave_role_key($user) === 'admin';
}

function leave_can_mark_reviewed(array $user): bool
{
    return leave_role_key($user) === 'hrhead';
}

function leave_is_regional_director(array $user): bool
{
    return leave_role_key($user) === 'regionaldirector';
}

function leave_default_signatory_for_role(PDO $pdo, string $roleKey): ?array
{
    static $cache = [];

    if (array_key_exists($roleKey, $cache)) {
        return $cache[$roleKey];
    }

    $statement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE u.is_archived = 0
           AND LOWER(REPLACE(r.name, " ", "")) = :role_key
           AND LOWER(u.status) = "active"
         ORDER BY u.id ASC
         LIMIT 1'
    );
    $statement->execute([
        ':role_key' => strtolower($roleKey),
    ]);
    $signatory = $statement->fetch();

    if (!$signatory) {
        $cache[$roleKey] = null;
        return null;
    }

    $cache[$roleKey] = [
        'employeeRecordId' => (int)($signatory['employeeRecordId'] ?? 0),
        'employeeName' => leave_text($signatory['employeeName'] ?? ''),
    ];

    return $cache[$roleKey];
}

function leave_roles_have_base_role_column(PDO $pdo): bool
{
    static $hasBaseRoleColumn = null;

    if ($hasBaseRoleColumn !== null) {
        return $hasBaseRoleColumn;
    }

    $statement = $pdo->query("SHOW COLUMNS FROM roles LIKE 'base_role'");
    $hasBaseRoleColumn = $statement !== false && $statement->fetch() !== false;

    return $hasBaseRoleColumn;
}

function leave_employee_has_role(PDO $pdo, int $employeeRecordId, string $roleKey): bool
{
    static $cache = [];

    if ($employeeRecordId <= 0) {
        return false;
    }

    $normalizedRoleKey = strtolower($roleKey);
    $cacheKey = $employeeRecordId . ':' . $normalizedRoleKey;

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $hasBaseRoleColumn = leave_roles_have_base_role_column($pdo);
    $baseRoleCondition = $hasBaseRoleColumn
        ? 'OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) = :base_role_key'
        : '';
    $statement = $pdo->prepare(
        'SELECT 1
         FROM employees e
         INNER JOIN users u
            ON u.email COLLATE utf8mb4_unicode_ci = e.email COLLATE utf8mb4_unicode_ci
           AND u.is_archived = 0
           AND LOWER(u.status) = "active"
         INNER JOIN roles r ON r.id = u.role_id
         WHERE e.id = :employee_record_id
           AND e.is_archived = 0
           AND (
                LOWER(REPLACE(r.name, " ", "")) = :role_key
                ' . $baseRoleCondition . '
           )
         LIMIT 1'
    );
    $params = [
        ':employee_record_id' => $employeeRecordId,
        ':role_key' => $normalizedRoleKey,
    ];

    if ($hasBaseRoleColumn) {
        $params[':base_role_key'] = $normalizedRoleKey;
    }

    $statement->execute($params);

    $cache[$cacheKey] = $statement->fetchColumn() !== false;

    return $cache[$cacheKey];
}

function leave_apply_signatory_fallbacks(PDO $pdo, array $request): array
{
    $statusKey = leave_status_to_database($request['status'] ?? '');
    $employeeRecordId = (int)($request['employeeRecordId'] ?? 0);
    $isHrHeadRequest = leave_employee_has_role($pdo, $employeeRecordId, 'hrhead');
    $isSelfApprovedRequest = $statusKey === 'approved'
        && $employeeRecordId > 0
        && (int)($request['approvedByEmployeeRecordId'] ?? 0) > 0
        && $employeeRecordId === (int)$request['approvedByEmployeeRecordId'];

    if (
        $isHrHeadRequest
        && ($request['reviewedByEmployeeRecordId'] ?? null) === null
    ) {
        $request['reviewedByEmployeeRecordId'] = $employeeRecordId;
        $request['reviewedByName'] = leave_text($request['employeeName'] ?? '');
    }

    if (
        !$isSelfApprovedRequest
        && ($request['reviewedByEmployeeRecordId'] ?? null) === null
        && in_array($statusKey, ['reviewed', 'approved'], true)
    ) {
        $fallbackHrHead = leave_default_signatory_for_role($pdo, 'hrhead');
        if ($fallbackHrHead !== null && ($fallbackHrHead['employeeRecordId'] ?? 0) > 0) {
            $request['reviewedByEmployeeRecordId'] = (int)$fallbackHrHead['employeeRecordId'];
            $request['reviewedByName'] = leave_text($fallbackHrHead['employeeName'] ?? '');
        }
    }

    if (
        ($request['approvedByEmployeeRecordId'] ?? null) === null
        && $statusKey === 'approved'
    ) {
        $fallbackRegionalDirector = leave_default_signatory_for_role($pdo, 'regionaldirector');
        if ($fallbackRegionalDirector !== null && ($fallbackRegionalDirector['employeeRecordId'] ?? 0) > 0) {
            $request['approvedByEmployeeRecordId'] = (int)$fallbackRegionalDirector['employeeRecordId'];
            $request['approvedByName'] = leave_text($fallbackRegionalDirector['employeeName'] ?? '');
        }
    }

    return $request;
}

function leave_is_weekend(string $date): bool
{
    /* ISO weekday: 6 is Saturday and 7 is Sunday. */
    return (int)(new DateTimeImmutable($date))->format('N') >= 6;
}

/*
 * A filing names the exact days it covers rather than a start and an end, so June 1 and June 5 can
 * be taken without spending the working days in between. Each day is taken whole or as one half,
 * which is what the AM/PM choice means. Mirrors frontend/src/utils/leaveRequestDetails.js.
 */
const LEAVE_DAY_PORTION_VALUES = [
    'whole' => 1.0,
    'am' => 0.5,
    'pm' => 0.5,
];

const LEAVE_DAY_PORTION_SHORT_LABELS = [
    'whole' => 'Whole',
    'am' => 'AM',
    'pm' => 'PM',
];

/* The selection travels inside the reason column, so it is capped to keep that text manageable. */
const LEAVE_MAX_DAYS = 60;

/**
 * The day selection as this API will trust it: valid dates only, one entry per date, in date order.
 * Returns an empty list for a request filed without one, which the caller reads as a plain range.
 */
function leave_normalize_days(mixed $value): array
{
    if (!is_array($value)) {
        return [];
    }

    $days = [];
    foreach ($value as $entry) {
        $date = leave_date_or_null(is_array($entry) ? ($entry['date'] ?? null) : $entry);
        if ($date === null) {
            continue;
        }

        $portion = strtolower(leave_text(is_array($entry) ? ($entry['portion'] ?? '') : ''));
        $days[$date] = [
            'date' => $date,
            'portion' => array_key_exists($portion, LEAVE_DAY_PORTION_VALUES) ? $portion : 'whole',
        ];
    }

    ksort($days);

    return array_slice(array_values($days), 0, LEAVE_MAX_DAYS);
}

/** Days applied for, counting a morning or an afternoon as half a day. */
function leave_days_total(array $leaveDays): float
{
    $total = 0.0;
    foreach ($leaveDays as $day) {
        $total += LEAVE_DAY_PORTION_VALUES[$day['portion'] ?? 'whole'] ?? 0.0;
    }

    return $total;
}

/** The dates as CSC Form No. 6 asks for them, with half days marked: "Jun 01, 2026 (AM)". */
function leave_days_summary(array $leaveDays): string
{
    $parts = [];
    foreach ($leaveDays as $day) {
        $label = (new DateTimeImmutable($day['date']))->format('M d, Y');
        $portion = $day['portion'] ?? 'whole';
        $parts[] = $portion === 'whole'
            ? $label
            : $label . ' (' . (LEAVE_DAY_PORTION_SHORT_LABELS[$portion] ?? strtoupper($portion)) . ')';
    }

    return implode(', ', $parts);
}

/*
 * CSC Form No. 6 asks for working days, so weekends inside the range are skipped: a leave from
 * Wednesday to the following Monday is four working days, not six.
 */
function leave_days(string $startDate, string $endDate): float
{
    $start = new DateTimeImmutable($startDate);
    $end = new DateTimeImmutable($endDate);

    if ($end < $start) {
        return 0.0;
    }

    $workingDays = 0;
    for ($cursor = $start; $cursor <= $end; $cursor = $cursor->modify('+1 day')) {
        if ((int)$cursor->format('N') < 6) {
            $workingDays++;
        }
    }

    return (float)$workingDays;
}

function leave_request_body(): array
{
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));

    if (strpos($contentType, 'multipart/form-data') === 0) {
        return $_POST;
    }

    return read_json_body();
}

function leave_attachment_upload(): ?array
{
    if (!isset($_FILES['attachment']) || !is_array($_FILES['attachment'])) {
        return null;
    }

    $file = $_FILES['attachment'];
    $error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);

    if ($error === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    return $file;
}

function ensure_leave_request_rejected_note_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'rejected_note'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE leave_requests ADD COLUMN rejected_note TEXT NULL AFTER reason');
}

function ensure_leave_request_reviewed_status(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'status'");
    $column = $statement !== false ? $statement->fetch() : false;
    $columnType = strtolower((string)($column['Type'] ?? $column['type'] ?? ''));

    if ($columnType !== '' && strpos($columnType, "'reviewed'") !== false) {
        return;
    }

    $pdo->exec("UPDATE leave_requests SET status = 'cancelled' WHERE status = 'withdrawn'");
    $pdo->exec(
        "ALTER TABLE leave_requests
         MODIFY COLUMN status ENUM('pending', 'reviewed', 'approved', 'rejected', 'cancelled')
         NOT NULL DEFAULT 'pending'"
    );
}

function ensure_leave_request_action_actor_columns(PDO $pdo): void
{
    $reviewedByStatement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'reviewed_by_employee_id'");
    if ($reviewedByStatement !== false && $reviewedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE leave_requests
             ADD COLUMN reviewed_by_employee_id INT UNSIGNED NULL AFTER rejected_note'
        );
    }

    $approvedByStatement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'approved_by_employee_id'");
    if ($approvedByStatement !== false && $approvedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE leave_requests
             ADD COLUMN approved_by_employee_id INT UNSIGNED NULL AFTER reviewed_by_employee_id'
        );
    }
}

function store_leave_attachment(array $attachmentUpload): array
{
    $error = (int)($attachmentUpload['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($error !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Unable to upload the attachment.');
    }

    $originalName = leave_text($attachmentUpload['name'] ?? '');
    $temporaryFile = (string)($attachmentUpload['tmp_name'] ?? '');
    $fileSize = (int)($attachmentUpload['size'] ?? 0);
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

    if ($originalName === '' || $temporaryFile === '') {
        throw new RuntimeException('Uploaded attachment is invalid.');
    }

    if ($extension === '' || !in_array($extension, $allowedExtensions, true)) {
        throw new RuntimeException('Unsupported attachment file type. Please upload PDF or image files only.');
    }

    if ($fileSize <= 0) {
        throw new RuntimeException('Uploaded attachment is empty.');
    }

    if ($fileSize > 10 * 1024 * 1024) {
        throw new RuntimeException('Attachment must be 10 MB or smaller.');
    }

    $uploadDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'leave-attachments';
    if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true) && !is_dir($uploadDirectory)) {
        throw new RuntimeException('Unable to prepare the leave attachment folder.');
    }

    $storedFileName = 'leave_' . date('Ymd_His') . '_' . bin2hex(random_bytes(8)) . '.' . $extension;
    $absolutePath = $uploadDirectory . DIRECTORY_SEPARATOR . $storedFileName;

    if (!move_uploaded_file($temporaryFile, $absolutePath)) {
        throw new RuntimeException('Unable to save the uploaded attachment.');
    }

    $publicPath = 'uploads/leave-attachments/' . rawurlencode($storedFileName);

    return [
        'fileName' => $originalName,
        'filePath' => $publicPath,
        'fileSize' => $fileSize,
        'absolutePath' => $absolutePath,
    ];
}

function fetch_leave_request(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = 'SELECT
            lr.leave_request_id AS id,
            lr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.profile_image AS profileImage,
            lt.name AS leaveType,
            d.name AS division,
            des.name AS position,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            lr.start_date AS startDate,
            lr.end_date AS endDate,
            lr.total_days AS numberOfDays,
            lr.paid_days AS paidDays,
            lr.unpaid_days AS unpaidDays,
            lr.reason,
            COALESCE(lr.rejected_note, "") AS rejectedNote,
            lr.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
            lr.approved_by_employee_id AS approvedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
            lr.status,
            DATE(lr.requested_at) AS dateFiled,
            lr.requested_at AS requestedAt,
            lr.updated_at AS updatedAt,
            COALESCE(la.file_name, "") AS attachmentName,
            COALESCE(la.file_path, "") AS attachmentPath
         FROM leave_requests lr
         INNER JOIN employees e ON e.id = lr.employee_id
         INNER JOIN divisions d ON d.id = e.division_id
         INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN employees reviewed_employee ON reviewed_employee.id = lr.reviewed_by_employee_id
         LEFT JOIN employees approved_employee ON approved_employee.id = lr.approved_by_employee_id
         LEFT JOIN leave_attachments la ON la.leave_request_id = lr.leave_request_id
         WHERE lr.leave_request_id = :id';

    if ($employeeScopeId !== null) {
        $sql .= ' AND lr.employee_id = :employee_scope_id';
    }

    $sql .= ' ORDER BY la.leave_attachments_id DESC
         LIMIT 1';

    $statement = $pdo->prepare($sql);
    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    $statement->execute($params);
    $request = $statement->fetch();

    if (!$request) {
        return null;
    }

    $request['id'] = (int)$request['id'];
    $request['employeeRecordId'] = (int)$request['employeeRecordId'];
    $request['numberOfDays'] = (float)$request['numberOfDays'];
    /* Requests filed before the pay split was tracked were fully charged to leave credits. */
    $request['paidDays'] = $request['paidDays'] !== null
        ? (float)$request['paidDays']
        : $request['numberOfDays'];
    $request['unpaidDays'] = $request['unpaidDays'] !== null ? (float)$request['unpaidDays'] : 0.0;
    $request['position'] = leave_text($request['position'] ?? '');
    $request['salaryRate'] = leave_text($request['salaryRate'] ?? '');
    $request['rejectedNote'] = leave_text($request['rejectedNote'] ?? '');
    $request['reviewedByEmployeeRecordId'] = $request['reviewedByEmployeeRecordId'] !== null
        ? (int)$request['reviewedByEmployeeRecordId']
        : null;
    $request['reviewedByName'] = leave_text($request['reviewedByName'] ?? '');
    $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
        ? (int)$request['approvedByEmployeeRecordId']
        : null;
    $request['approvedByName'] = leave_text($request['approvedByName'] ?? '');
    $request['status'] = leave_status_to_client((string)$request['status']);
    $request = leave_apply_signatory_fallbacks($pdo, $request);

    return $request;
}

/**
 * The reason column stores the typed reason followed by a metadata marker holding the
 * structured leave-type answers. Mirrors frontend/src/utils/leaveRequestDetails.js so
 * notifications never expose the raw JSON payload.
 */
function leave_unpack_reason(mixed $reason): array
{
    $rawReason = (string)($reason ?? '');
    $markerIndex = strrpos($rawReason, LEAVE_REQUEST_META_PREFIX);

    if ($markerIndex === false) {
        return ['visibleReason' => trim($rawReason), 'details' => []];
    }

    $detailsText = trim(substr($rawReason, $markerIndex + strlen(LEAVE_REQUEST_META_PREFIX)));
    $details = json_decode($detailsText, true);

    /* Unreadable metadata is dropped rather than echoed back, so email never shows raw JSON. */
    return [
        'visibleReason' => trim(substr($rawReason, 0, $markerIndex)),
        'details' => is_array($details) ? $details : [],
    ];
}

/**
 * Human readable summary of the structured answers for the leave type that was filed,
 * matching the rows shown in the leave review modal.
 */
function leave_details_summary(array $details, string $leaveType): string
{
    $normalizedType = strtolower(leave_text($leaveType));
    $vacationScope = leave_text($details['vacationScope'] ?? '');
    $sickLeaveMode = leave_text($details['sickLeaveMode'] ?? '');
    $studyLeavePurpose = leave_text($details['studyLeavePurpose'] ?? '');
    $parts = [];

    if (in_array($normalizedType, ['vacation leave', 'special privilege leave'], true) && $vacationScope !== '') {
        $parts[] = LEAVE_VACATION_SCOPE_LABELS[$vacationScope] ?? $vacationScope;

        $vacationNote = leave_text($details['vacationNote'] ?? '');
        if ($vacationScope === 'abroad' && $vacationNote !== '') {
            $parts[] = $vacationNote;
        }
    }

    if ($normalizedType === 'sick leave' && $sickLeaveMode !== '') {
        $parts[] = LEAVE_SICK_MODE_LABELS[$sickLeaveMode] ?? $sickLeaveMode;

        $sickLeaveIllness = leave_text($details['sickLeaveIllness'] ?? '');
        if ($sickLeaveIllness !== '') {
            $parts[] = $sickLeaveIllness;
        }
    }

    if ($normalizedType === 'study leave' && $studyLeavePurpose !== '') {
        $parts[] = LEAVE_STUDY_PURPOSE_LABELS[$studyLeavePurpose] ?? $studyLeavePurpose;
    }

    return implode(' - ', $parts);
}

function fetch_leave_request_notification_context(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            lr.leave_request_id AS id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.email AS employeeEmail,
            lt.name AS leaveType,
            d.name AS division,
            lr.start_date AS startDate,
            lr.end_date AS endDate,
            lr.total_days AS numberOfDays,
            COALESCE(lr.reason, "") AS reason,
            COALESCE(lr.rejected_note, "") AS rejectedNote
         FROM leave_requests lr
         INNER JOIN employees e ON e.id = lr.employee_id
         INNER JOIN divisions d ON d.id = e.division_id
         INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         WHERE lr.leave_request_id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $request = $statement->fetch();

    if (!$request) {
        return null;
    }

    $request['employeeName'] = leave_text($request['employeeName'] ?? '');
    $request['employeeEmail'] = leave_text($request['employeeEmail'] ?? '');
    $request['leaveType'] = leave_text($request['leaveType'] ?? '');
    $request['division'] = leave_text($request['division'] ?? '');
    $request['startDate'] = leave_text($request['startDate'] ?? '');
    $request['endDate'] = leave_text($request['endDate'] ?? '');
    $request['numberOfDays'] = rtrim(rtrim(number_format((float)($request['numberOfDays'] ?? 0), 2, '.', ''), '0'), '.');
    $request['rejectedNote'] = leave_text($request['rejectedNote'] ?? '');

    $unpackedReason = leave_unpack_reason($request['reason'] ?? '');
    $request['reason'] = $unpackedReason['visibleReason'];
    $request['leaveDetails'] = leave_details_summary($unpackedReason['details'], (string)$request['leaveType']);
    /* Empty for a request filed as a plain range, which the email then reports as a start and end. */
    $request['leaveDates'] = leave_days_summary(
        leave_normalize_days($unpackedReason['details']['leaveDays'] ?? null)
    );

    return $request;
}

function send_leave_rejection_notification(PDO $pdo, int $id): ?string
{
    $request = fetch_leave_request_notification_context($pdo, $id);

    if ($request === null) {
        return 'Leave request rejected, but employee details could not be loaded for email notification.';
    }

    $employeeEmail = leave_text($request['employeeEmail'] ?? '');

    if ($employeeEmail === '' || filter_var($employeeEmail, FILTER_VALIDATE_EMAIL) === false) {
        return 'Leave request rejected, but no valid employee email address is available.';
    }

    try {
        send_leave_request_rejection_email(
            $employeeEmail,
            (string)$request['employeeName'],
            (string)$request['leaveType'],
            (string)$request['leaveDetails'],
            (string)$request['division'],
            (string)$request['startDate'],
            (string)$request['endDate'],
            (string)$request['numberOfDays'],
            (string)$request['reason'],
            (string)$request['rejectedNote'],
            (string)$request['leaveDates']
        );
    } catch (Throwable $exception) {
        error_log('Leave rejection email error: ' . $exception->getMessage());
        return 'Leave request rejected, but the rejection email could not be sent.';
    }

    return null;
}

function list_leave_requests(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = leave_can_view_all($sessionUser) ? null : resolve_leave_session_employee_id($pdo, $sessionUser);

    $sql = 'SELECT
            lr.leave_request_id AS id,
            lr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.profile_image AS profileImage,
            lt.name AS leaveType,
            d.name AS division,
            des.name AS position,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            lr.start_date AS startDate,
            lr.end_date AS endDate,
            lr.total_days AS numberOfDays,
            lr.paid_days AS paidDays,
            lr.unpaid_days AS unpaidDays,
            lr.reason,
            COALESCE(lr.rejected_note, "") AS rejectedNote,
            lr.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
            lr.approved_by_employee_id AS approvedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
            lr.status,
            DATE(lr.requested_at) AS dateFiled,
            lr.requested_at AS requestedAt,
            lr.updated_at AS updatedAt,
            COALESCE(attachments.file_name, "") AS attachmentName,
            COALESCE(attachments.file_path, "") AS attachmentPath
         FROM leave_requests lr
         INNER JOIN employees e ON e.id = lr.employee_id
         INNER JOIN divisions d ON d.id = e.division_id
         INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN employees reviewed_employee ON reviewed_employee.id = lr.reviewed_by_employee_id
         LEFT JOIN employees approved_employee ON approved_employee.id = lr.approved_by_employee_id
         LEFT JOIN (
            SELECT la1.leave_request_id, la1.file_name, la1.file_path
            FROM leave_attachments la1
            INNER JOIN (
                SELECT leave_request_id, MAX(leave_attachments_id) AS latest_id
                FROM leave_attachments
                GROUP BY leave_request_id
            ) latest ON latest.latest_id = la1.leave_attachments_id
         ) attachments ON attachments.leave_request_id = lr.leave_request_id
         WHERE lr.is_archived = :is_archived';

    $params = [':is_archived' => archived_view_requested() ? 1 : 0];
    if ($employeeScopeId !== null) {
        $sql .= ' AND lr.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' ORDER BY lr.requested_at DESC, lr.leave_request_id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $requests = $statement->fetchAll();

    foreach ($requests as &$request) {
        $request['id'] = (int)$request['id'];
        $request['employeeRecordId'] = (int)$request['employeeRecordId'];
        $request['numberOfDays'] = (float)$request['numberOfDays'];
        /* Requests filed before the pay split was tracked were fully charged to leave credits. */
        $request['paidDays'] = $request['paidDays'] !== null
            ? (float)$request['paidDays']
            : $request['numberOfDays'];
        $request['unpaidDays'] = $request['unpaidDays'] !== null ? (float)$request['unpaidDays'] : 0.0;
        $request['position'] = leave_text($request['position'] ?? '');
        $request['salaryRate'] = leave_text($request['salaryRate'] ?? '');
        $request['rejectedNote'] = leave_text($request['rejectedNote'] ?? '');
        $request['reviewedByEmployeeRecordId'] = $request['reviewedByEmployeeRecordId'] !== null
            ? (int)$request['reviewedByEmployeeRecordId']
            : null;
        $request['reviewedByName'] = leave_text($request['reviewedByName'] ?? '');
        $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
            ? (int)$request['approvedByEmployeeRecordId']
            : null;
        $request['approvedByName'] = leave_text($request['approvedByName'] ?? '');
        $request['status'] = leave_status_to_client((string)$request['status']);
        $request = leave_apply_signatory_fallbacks($pdo, $request);
    }
    unset($request);

    json_response([
        'success' => true,
        'requests' => $requests,
    ]);
}

function list_leave_types(PDO $pdo): void
{
    $leaveTypes = $pdo->query(
        'SELECT
            leave_type_id AS id,
            name,
            code
         FROM leave_types
         WHERE is_active = 1
         ORDER BY leave_type_id ASC'
    )->fetchAll();

    foreach ($leaveTypes as &$leaveType) {
        $leaveType['id'] = (int)$leaveType['id'];
        $leaveType['name'] = leave_text($leaveType['name'] ?? '');
        $leaveType['code'] = leave_text($leaveType['code'] ?? '');
    }
    unset($leaveType);

    json_response([
        'success' => true,
        'leaveTypes' => $leaveTypes,
    ]);
}

function get_leave_request(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? $_GET['requestId'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Leave request is required.',
        ], 422);
    }

    $employeeScopeId = leave_can_view_all($sessionUser) ? null : resolve_leave_session_employee_id($pdo, $sessionUser);
    $request = fetch_leave_request($pdo, $id, $employeeScopeId);

    if ($request === null) {
        json_response([
            'success' => false,
            'message' => 'Leave request not found.',
        ], 404);
    }

    json_response([
        'success' => true,
        'request' => $request,
    ]);
}

function resolve_leave_session_employee_id(PDO $pdo, array $sessionUser): int
{
    $employeeId = session_employee_record_id($pdo, $sessionUser);
    if ($employeeId !== null) {
        return $employeeId;
    }

    json_response([
        'success' => false,
        'message' => 'Signed-in employee record was not found.',
    ], 422);
}

function resolve_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!leave_can_select_employee($sessionUser)) {
        return resolve_leave_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = leave_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = leave_text($body['employeeName'] ?? '');

    if ($employeeRecordId > 0) {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
        $statement->execute([':id' => $employeeRecordId]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($employeeCode !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $employeeCode]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($employeeName !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $employeeName]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    json_response([
        'success' => false,
        'message' => 'Selected employee was not found.',
    ], 422);
}

function resolve_leave_type_id(PDO $pdo, string $leaveType): int
{
    $statement = $pdo->prepare(
        'SELECT leave_type_id FROM leave_types WHERE name = :name AND is_active = 1 LIMIT 1'
    );
    $statement->execute([':name' => $leaveType]);
    $id = (int)$statement->fetchColumn();

    if ($id <= 0) {
        $baseCode = strtoupper(preg_replace('/[^A-Z0-9]/', '', implode('', array_map(
            static fn (string $word): string => $word[0] ?? '',
            preg_split('/\s+/', $leaveType) ?: []
        ))));
        $baseCode = $baseCode !== '' ? substr($baseCode, 0, 12) : 'LT';
        $code = $baseCode;
        $suffix = 1;

        while (true) {
            $codeCheck = $pdo->prepare('SELECT COUNT(*) FROM leave_types WHERE code = :code');
            $codeCheck->execute([':code' => $code]);
            if ((int)$codeCheck->fetchColumn() === 0) {
                break;
            }
            $code = substr($baseCode, 0, 10) . $suffix;
            $suffix++;
        }

        $insert = $pdo->prepare(
            'INSERT INTO leave_types (name, code, is_with_pay, requires_approval, requires_attachment, is_active)
             VALUES (:name, :code, 1, 1, 0, 1)'
        );
        $insert->execute([
            ':name' => $leaveType,
            ':code' => $code,
        ]);

        return (int)$pdo->lastInsertId();
    }

    return $id;
}

/**
 * The bucket a filing is counted against for the `leaveRequest` limit: the account doing the filing,
 * or the caller's address in the impossible case of a session without a user id. Keyed by account
 * rather than by the employee named on the form, because the quota exists to cap what one signed-in
 * person can push into the approval queue.
 */
function leave_rate_limit_identifier(array $sessionUser): string
{
    $userId = (int)($sessionUser['id'] ?? 0);

    return $userId > 0 ? 'user:' . $userId : 'ip:' . rate_limit_client_ip();
}

function create_leave_request(PDO $pdo, array $body, array $sessionUser, ?array $attachmentUpload = null): void
{
    $employeeId = resolve_employee_id($pdo, $body, $sessionUser);
    $leaveType = leave_text($body['leaveType'] ?? '');
    $startDate = leave_date_or_null($body['startDate'] ?? null);
    $endDate = leave_date_or_null($body['endDate'] ?? null);
    $reason = leave_text($body['reason'] ?? '');
    /*
     * The picked days travel in the reason metadata the form already sends, so the span and the days
     * applied for are derived from that list here rather than taken from the client. A request filed
     * without one -- an older client, or any other caller -- still books a plain start-to-end range.
     */
    $leaveDays = leave_normalize_days(leave_unpack_reason($reason)['details']['leaveDays'] ?? null);

    if ($leaveDays !== []) {
        $startDate = $leaveDays[0]['date'];
        $endDate = $leaveDays[count($leaveDays) - 1]['date'];
    }

    /*
     * The form's calendar already refuses these days, but that only constrains the picker -- a
     * crafted request still reaches here, so the rules are enforced again rather than trusted. They
     * apply to every role: no account may back-date a filing, and leave is counted in working days.
     * Compared as 'Y-m-d' text, which both sides guarantee.
     */
    $today = date('Y-m-d');
    $errors = [];
    if ($leaveType === '') {
        $errors[] = 'Leave type is required.';
    }

    if ($leaveDays !== []) {
        $pastDates = array_filter($leaveDays, static fn (array $day): bool => $day['date'] < $today);
        if ($pastDates !== []) {
            $errors[] = 'Leave dates cannot be in the past. Choose today or a later date.';
        }

        $weekendDates = array_filter($leaveDays, static fn (array $day): bool => leave_is_weekend($day['date']));
        if ($weekendDates !== []) {
            $errors[] = 'Leave dates must be working days (Monday to Friday).';
        }
    } else {
        if ($startDate === null) {
            $errors[] = 'Start date is required.';
        }
        if ($endDate === null) {
            $errors[] = 'End date is required.';
        }
        if ($startDate !== null && $startDate < $today) {
            $errors[] = 'Start date cannot be in the past. Choose today or a later date.';
        }
        if ($endDate !== null && $endDate < $today) {
            $errors[] = 'End date cannot be in the past. Choose today or a later date.';
        }
        if ($startDate !== null && leave_is_weekend($startDate)) {
            $errors[] = 'Start date must be a working day (Monday to Friday).';
        }
        if ($endDate !== null && leave_is_weekend($endDate)) {
            $errors[] = 'End date must be a working day (Monday to Friday).';
        }
        if ($errors === [] && $startDate !== null && $endDate !== null && leave_days($startDate, $endDate) <= 0) {
            $errors[] = 'End date must not be earlier than start date.';
        }
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $leaveTypeId = resolve_leave_type_id($pdo, $leaveType);
    /*
     * Counted here rather than taken from the request, so the stored days always match the days that
     * were actually picked -- half days included -- and never the raw length of the span.
     */
    $numberOfDays = $leaveDays !== []
        ? leave_days_total($leaveDays)
        : leave_days((string)$startDate, (string)$endDate);

    /*
     * Filing is allowed to exceed the remaining credits, but only once the applicant has been told
     * that the excess becomes Leave Without Pay. The split is recalculated here rather than trusted
     * from the client so the stored days always match the balance at filing time.
     */
    $paySplit = leave_credit_pay_split($pdo, $employeeId, $leaveTypeId, $numberOfDays, $startDate);

    if ($paySplit['unpaidDays'] > 0 && !leave_truthy($body['acknowledgeLeaveWithoutPay'] ?? null)) {
        json_response([
            'success' => false,
            'code' => 'leave_without_pay_confirmation_required',
            'message' => sprintf(
                'Insufficient %s credits. Only %s day(s) remain, so %s day(s) will be filed as Leave Without Pay.',
                $paySplit['leaveTypeName'],
                leave_credit_format_days((float)$paySplit['remaining']),
                leave_credit_format_days((float)$paySplit['unpaidDays'])
            ),
            'leaveWithoutPay' => [
                'leaveType' => $paySplit['leaveTypeName'],
                'requestedDays' => (float)$paySplit['requestedDays'],
                'remainingCredits' => (float)$paySplit['remaining'],
                'paidDays' => (float)$paySplit['paidDays'],
                'unpaidDays' => (float)$paySplit['unpaidDays'],
            ],
        ], 422);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $isRegionalDirectorOwnLeave = leave_is_regional_director($sessionUser)
        && $sessionEmployeeId !== null
        && $employeeId === $sessionEmployeeId;
    $isHrHeadOwnLeave = leave_can_mark_reviewed($sessionUser)
        && $sessionEmployeeId !== null
        && $employeeId === $sessionEmployeeId;
    $initialStatus = $isRegionalDirectorOwnLeave
        ? 'approved'
        : ($isHrHeadOwnLeave ? 'reviewed' : 'pending');
    $reviewedByEmployeeId = $isHrHeadOwnLeave ? $sessionEmployeeId : null;
    $approvedByEmployeeId = $isRegionalDirectorOwnLeave ? $sessionEmployeeId : null;

    if ($isRegionalDirectorOwnLeave) {
        validate_leave_credit_approval($pdo, $employeeId, $leaveTypeId, (float)$paySplit['paidDays'], $startDate);
    }

    /*
     * The filing quota from Settings > Rate Limiting, counted here rather than at the top of the POST
     * branch so that only a submission which survived validation spends it. A form the employee got
     * wrong -- a past date, a weekend, a leave-without-pay prompt they have not confirmed yet -- has
     * already been answered above and never reaches this line.
     *
     * It also sits before the attachment is written to disk, so a refused filing leaves no orphan
     * upload behind, and before the transaction opens, because the limiter declines to count anything
     * while one is in progress.
     */
    throttle_leave_request($pdo, $sessionUser, leave_rate_limit_identifier($sessionUser));

    $attachmentName = leave_text($body['attachmentName'] ?? '');
    $attachmentPath = leave_text($body['attachmentPath'] ?? $attachmentName);
    $attachmentSize = isset($body['attachmentSize']) ? (int)$body['attachmentSize'] : null;
    $storedAttachmentAbsolutePath = null;

    if ($attachmentUpload !== null) {
        try {
            $storedAttachment = store_leave_attachment($attachmentUpload);
            $attachmentName = $storedAttachment['fileName'];
            $attachmentPath = $storedAttachment['filePath'];
            $attachmentSize = $storedAttachment['fileSize'];
            $storedAttachmentAbsolutePath = $storedAttachment['absolutePath'];
        } catch (RuntimeException $exception) {
            json_response([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'INSERT INTO leave_requests
                (employee_id, leave_type_id, start_date, end_date, total_days, paid_days, unpaid_days, reason, status, reviewed_by_employee_id, approved_by_employee_id)
             VALUES
                (:employee_id, :leave_type_id, :start_date, :end_date, :total_days, :paid_days, :unpaid_days, :reason, :status, :reviewed_by_employee_id, :approved_by_employee_id)'
        );
        $statement->execute([
            ':employee_id' => $employeeId,
            ':leave_type_id' => $leaveTypeId,
            ':start_date' => $startDate,
            ':end_date' => $endDate,
            ':total_days' => $numberOfDays,
            ':paid_days' => $paySplit['paidDays'],
            ':unpaid_days' => $paySplit['unpaidDays'],
            ':reason' => $reason,
            ':status' => $initialStatus,
            ':reviewed_by_employee_id' => $reviewedByEmployeeId,
            ':approved_by_employee_id' => $approvedByEmployeeId,
        ]);

        $requestId = (int)$pdo->lastInsertId();

        if ($attachmentName !== '') {
            $attachment = $pdo->prepare(
                'INSERT INTO leave_attachments (leave_request_id, file_name, file_path, file_size)
                 VALUES (:leave_request_id, :file_name, :file_path, :file_size)'
            );
            $attachment->execute([
                ':leave_request_id' => $requestId,
                ':file_name' => $attachmentName,
                ':file_path' => $attachmentPath,
                ':file_size' => $attachmentSize,
            ]);
        }

        if ($isRegionalDirectorOwnLeave) {
            recalculate_employee_leave_credit_usage(
                $pdo,
                $employeeId,
                $startDate !== null ? (int)substr($startDate, 0, 4) : null
            );
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        if ($storedAttachmentAbsolutePath !== null && is_file($storedAttachmentAbsolutePath)) {
            @unlink($storedAttachmentAbsolutePath);
        }
        throw $exception;
    }

    try {
        $notificationRequest = fetch_leave_request($pdo, $requestId, null);
        $notificationType = $isRegionalDirectorOwnLeave ? 'leave_request_approved' : 'leave_request_submitted';
        $notificationTitle = $isRegionalDirectorOwnLeave ? 'Leave Request Approved' : 'Leave Request Submitted';
        $notificationMessage = $isRegionalDirectorOwnLeave
            ? sprintf(
                '%s self-approved a leave request for %s to %s.',
                (string)($notificationRequest['employeeName'] ?? 'A Regional Director'),
                (string)($notificationRequest['startDate'] ?? $startDate ?? ''),
                (string)($notificationRequest['endDate'] ?? $endDate ?? '')
            )
            : sprintf(
                '%s submitted a leave request for %s to %s.',
                (string)($notificationRequest['employeeName'] ?? 'An employee'),
                (string)($notificationRequest['startDate'] ?? $startDate ?? ''),
                (string)($notificationRequest['endDate'] ?? $endDate ?? '')
            );
        $targetRoles = $isRegionalDirectorOwnLeave
            ? ['admin', 'hrhead', 'hrstaff']
            : ['admin', 'hrhead', 'hrstaff', 'regionaldirector'];

        notify_roles($pdo, $targetRoles, $notificationTitle, $notificationMessage, $notificationType, (string)$requestId);
    } catch (Throwable $notificationException) {
        error_log('Leave creation notification error: ' . $notificationException->getMessage());
    }

    $employeeScopeId = leave_can_view_all($sessionUser) ? null : $employeeId;
    json_response([
        'success' => true,
        'request' => fetch_leave_request($pdo, $requestId, $employeeScopeId),
        'message' => $isRegionalDirectorOwnLeave
            ? 'Regional Director leave request filed and approved.'
            : 'Leave request submitted successfully.',
    ], 201);
}

function update_leave_request_status(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? $body['requestId'] ?? 0);
    $status = leave_status_to_database($body['status'] ?? '');
    $rejectedNote = leave_text($body['rejectedNote'] ?? $body['rejected_note'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Leave request is required.',
        ], 422);
    }

    $currentStatusStatement = $pdo->prepare(
        'SELECT employee_id, leave_type_id, start_date, total_days, paid_days, status,
                reviewed_by_employee_id, approved_by_employee_id
         FROM leave_requests
         WHERE leave_request_id = :id
         LIMIT 1'
    );
    $currentStatusStatement->execute([':id' => $id]);
    $currentRequest = $currentStatusStatement->fetch();

    if (!$currentRequest) {
        json_response([
            'success' => false,
            'message' => 'Leave request not found.',
        ], 404);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $currentStatus = (string)($currentRequest['status'] ?? '');
    $isOwnRequest = $sessionEmployeeId !== null && (int)($currentRequest['employee_id'] ?? 0) === $sessionEmployeeId;
    $isOwnCancellation = $isOwnRequest && $status === 'cancelled';

    if (!leave_can_manage($sessionUser) && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to update leave requests.',
        ], 403);
    }

    if ($isOwnRequest && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own leave request. Please ask another authorized user to review it.',
        ], 403);
    }

    $currentReviewedByEmployeeId = (int)($currentRequest['reviewed_by_employee_id'] ?? 0);
    $currentApprovedByEmployeeId = (int)($currentRequest['approved_by_employee_id'] ?? 0);

    if ($isOwnCancellation && $currentStatus !== 'pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending leave requests can be cancelled.',
        ], 422);
    }

    if ((string)$currentStatus === 'approved' && $status === 'cancelled') {
        json_response([
            'success' => false,
            'message' => 'Approved leave requests cannot be cancelled.',
        ], 422);
    }

    if ($status === 'rejected' && $rejectedNote === '') {
        json_response([
            'success' => false,
            'message' => 'Rejected note is required.',
        ], 422);
    }

    if ($status === 'reviewed' && !leave_can_mark_reviewed($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only HR Head can mark leave requests as reviewed.',
        ], 403);
    }

    if ($status === 'reviewed' && $currentStatus !== 'pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending leave requests can be marked as reviewed.',
        ], 422);
    }

    if (leave_can_mark_reviewed($sessionUser) && $status === 'approved') {
        json_response([
            'success' => false,
            'message' => 'HR Head approval marks the leave request as reviewed. Regional Director must give the final approval.',
        ], 422);
    }

    /*
     * The Regional Director may act on a request that is still pending as well as one HR Head has
     * reviewed, so a request is never stuck waiting on a review that may never come. What stays
     * barred is acting on a request that has already been settled.
     */
    if (
        !$isOwnCancellation
        && leave_is_regional_director($sessionUser)
        && in_array($status, ['approved', 'rejected', 'cancelled'], true)
        && !in_array($currentStatus, ['pending', 'reviewed'], true)
    ) {
        json_response([
            'success' => false,
            'message' => 'Only pending or reviewed leave requests can be acted on.',
        ], 422);
    }

    if ($status === 'approved' && $currentStatus !== 'approved') {
        /* Only the with pay portion is charged to credits; the rest was filed as Leave Without Pay. */
        $chargeableDays = ($currentRequest['paid_days'] ?? null) !== null
            ? (float)$currentRequest['paid_days']
            : (float)($currentRequest['total_days'] ?? 0);

        validate_leave_credit_approval(
            $pdo,
            (int)($currentRequest['employee_id'] ?? 0),
            (int)($currentRequest['leave_type_id'] ?? 0),
            $chargeableDays,
            (string)($currentRequest['start_date'] ?? '')
        );
    }

    /*
     * Signing off a leave request -- HR Head reviewing it or the Regional Director approving it --
     * carries a solved captcha. Rejecting and cancelling do not: see the approval_workflow entry in
     * captcha-utils.php for why only the one-way half of the workflow is gated.
     *
     * Last of the gates on purpose. Every permission and stage check above has already run, so a
     * caller who was never allowed to approve this request is turned away without being handed a
     * sum to solve, and the credit check has passed too, so a challenge is never spent on an
     * approval that was going to be refused for want of credits anyway.
     */
    if (in_array($status, ['reviewed', 'approved'], true)) {
        require_approval_captcha($body);
    }

    $nextReviewedByEmployeeId = $currentReviewedByEmployeeId > 0 ? $currentReviewedByEmployeeId : null;
    $nextApprovedByEmployeeId = $currentApprovedByEmployeeId > 0 ? $currentApprovedByEmployeeId : null;

    if ($status === 'reviewed') {
        $nextReviewedByEmployeeId = $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
        $nextApprovedByEmployeeId = null;
    }

    if ($status === 'approved') {
        $nextApprovedByEmployeeId = $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
    }

    if ($status === 'rejected' && leave_is_regional_director($sessionUser)) {
        $nextApprovedByEmployeeId = $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'UPDATE leave_requests
             SET status = :status,
                 rejected_note = :rejected_note,
                 reviewed_by_employee_id = :reviewed_by_employee_id,
                 approved_by_employee_id = :approved_by_employee_id
             WHERE leave_request_id = :id'
        );
        $statement->execute([
            ':status' => $status,
            ':rejected_note' => $status === 'rejected' ? $rejectedNote : null,
            ':reviewed_by_employee_id' => $nextReviewedByEmployeeId,
            ':approved_by_employee_id' => $nextApprovedByEmployeeId,
            ':id' => $id,
        ]);

        if ($statement->rowCount() === 0) {
            $existsStatement = $pdo->prepare('SELECT COUNT(*) FROM leave_requests WHERE leave_request_id = :id');
            $existsStatement->execute([':id' => $id]);
            if ((int)$existsStatement->fetchColumn() === 0) {
                json_response([
                    'success' => false,
                    'message' => 'Leave request not found.',
                ], 404);
            }
        }

        recalculate_employee_leave_credit_usage(
            $pdo,
            (int)($currentRequest['employee_id'] ?? 0),
            isset($currentRequest['start_date']) ? (int)substr((string)$currentRequest['start_date'], 0, 4) : null
        );

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $notificationRequest = fetch_leave_request($pdo, $id, null);
        if ($notificationRequest !== null) {
            $notificationType = match ($status) {
                'approved' => 'leave_request_approved',
                'rejected' => 'leave_request_rejected',
                default => 'system_alert',
            };
            $notificationTitle = match ($status) {
                'approved' => 'Leave Request Approved',
                'rejected' => 'Leave Request Rejected',
                'reviewed' => 'Leave Request Reviewed',
                default => 'Leave Request Updated',
            };
            $notificationMessage = match ($status) {
                'approved' => sprintf(
                    'Your %s leave request for %s to %s has been approved.',
                    (string)($notificationRequest['leaveType'] ?? 'leave'),
                    (string)($notificationRequest['startDate'] ?? ''),
                    (string)($notificationRequest['endDate'] ?? '')
                ),
                'rejected' => sprintf(
                    'Your %s leave request for %s to %s was rejected. %s',
                    (string)($notificationRequest['leaveType'] ?? 'leave'),
                    (string)($notificationRequest['startDate'] ?? ''),
                    (string)($notificationRequest['endDate'] ?? ''),
                    $rejectedNote !== '' ? $rejectedNote : 'Please review the rejection details.'
                ),
                'reviewed' => sprintf(
                    'Your %s leave request for %s to %s was reviewed and forwarded for final approval.',
                    (string)($notificationRequest['leaveType'] ?? 'leave'),
                    (string)($notificationRequest['startDate'] ?? ''),
                    (string)($notificationRequest['endDate'] ?? '')
                ),
                default => sprintf(
                    'Your %s leave request for %s to %s has been updated.',
                    (string)($notificationRequest['leaveType'] ?? 'leave'),
                    (string)($notificationRequest['startDate'] ?? ''),
                    (string)($notificationRequest['endDate'] ?? '')
                ),
            };

            notify_employee($pdo, (int)($currentRequest['employee_id'] ?? 0), $notificationTitle, $notificationMessage, $notificationType, (string)$id);
        }
    } catch (Throwable $notificationException) {
        error_log('Leave update notification error: ' . $notificationException->getMessage());
    }

    $notificationWarning = null;

    if ($status === 'rejected') {
        $notificationWarning = send_leave_rejection_notification($pdo, $id);
    }

    json_response([
        'success' => true,
        'request' => fetch_leave_request($pdo, $id),
        'emailNotification' => $status === 'rejected'
            ? ($notificationWarning === null ? 'sent' : 'warning')
            : 'not_applicable',
        'message' => $status === 'rejected'
            ? ($notificationWarning ?? 'Leave request rejected and the employee was notified by email.')
            : ($status === 'reviewed'
                ? 'Leave request reviewed and forwarded to Regional Director for final approval.'
                : ($status === 'approved'
                    ? 'Leave request approved.'
                    : ($status === 'cancelled'
                        ? 'Leave request cancelled.'
                        : 'Leave request updated.'))),
    ]);
}

/**
 * Archiving is a records-management action, not a decision on the request, so it deliberately does
 * not apply the "you cannot act on your own request" rule that the status changes enforce. The
 * permission is the module's own — whoever may manage leave may archive it.
 */
function archive_leave_request(PDO $pdo, array $body, array $sessionUser, bool $archived): void
{
    if (!leave_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive leave requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? $body['requestId'] ?? 0);

    if ($id <= 0 || fetch_leave_request($pdo, $id) === null) {
        json_response([
            'success' => false,
            'message' => 'Leave request not found.',
        ], 404);
    }

    set_record_archived(
        $pdo,
        'leave_requests',
        'leave_request_id',
        $id,
        $archived,
        $sessionUser,
        'Leave Request'
    );

    json_response([
        'success' => true,
        'message' => $archived ? 'Leave request archived.' : 'Leave request restored.',
        'request' => fetch_leave_request($pdo, $id),
    ]);
}

try {
    ensure_leave_request_rejected_note_column($pdo);
    ensure_leave_request_pay_split_columns($pdo);
    ensure_leave_request_reviewed_status($pdo);
    ensure_leave_request_action_actor_columns($pdo);
    ensure_archive_columns($pdo, 'leave_requests');

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (leave_text($_GET['resource'] ?? '') === 'leave_types') {
            list_leave_types($pdo);
        }

        if (isset($_GET['id']) || isset($_GET['requestId'])) {
            get_leave_request($pdo, $sessionUser);
        }

        list_leave_requests($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_leave_request($pdo, leave_request_body(), $sessionUser, leave_attachment_upload());
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $action = strtolower(leave_text($body['action'] ?? ''));

        if ($action === 'archive' || $action === 'restore') {
            archive_leave_request($pdo, $body, $sessionUser, $action === 'archive');
        }

        update_leave_request_status($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Leave request API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process leave request.',
    ], 500);
}
