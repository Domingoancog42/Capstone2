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
        /* Legacy rows are presented as the balance-verification stage. */
        'submitted' => 'Pending',
        'endorsed' => 'Endorsed',
        'reviewed' => 'Reviewed',
        'chief_reviewed' => 'Chief Reviewed',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled', 'withdrawn' => 'Cancelled',
        default => 'Pending',
    };
}

function leave_status_to_database(mixed $status): string
{
    return match (strtolower(leave_text($status))) {
        'submitted' => 'submitted',
        'pending', 'pending leave balance verification' => 'pending',
        'endorsed', 'pending hr head approval' => 'endorsed',
        'reviewed', 'pending chief admin review' => 'reviewed',
        'chief_reviewed', 'chief reviewed', 'chiefreviewed', 'pending regional director approval' => 'chief_reviewed',
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

/** The Leave Management action an administrator ticked for the role under Settings > Roles. */
function leave_role_has_action(array $user, string $action): bool
{
    return user_has_permission($user, 'leave', $action);
}

/*
 * A division desk on the leave request register: the Chief by role, and a Planning Officer once an
 * administrator grants Leave Management approve or reject in RBAC. The Planning Officer works the
 * same division desk a Chief does, so the grant seats them at the Chief's stage for their own
 * division; without it their Leave page stays a self-service filing page. Mirrors
 * isLeaveDivisionDesk() in frontend/src/utils/leaveHelpers.js.
 */
function leave_is_division_desk(array $user): bool
{
    $roleKey = leave_role_key($user);

    return $roleKey === 'chief'
        || ($roleKey === 'planningofficer'
            && (leave_role_has_action($user, 'approve') || leave_role_has_action($user, 'reject')));
}

function leave_can_manage(array $user): bool
{
    return in_array(leave_role_key($user), ['admin', 'chief', 'hrhead', 'hrstaff', 'regionaldirector'], true)
        || leave_is_division_desk($user);
}

/** Personal leave roles may archive and restore only their own completed requests. */
function leave_is_self_service_role(array $user): bool
{
    return in_array(leave_role_key($user), ['employee', 'planningofficer', 'cashier'], true);
}

function leave_can_archive(array $user): bool
{
    return leave_can_manage($user) || leave_is_self_service_role($user);
}

function leave_can_select_employee(array $user): bool
{
    return leave_role_key($user) === 'admin';
}

function leave_is_chief(array $user): bool
{
    return leave_role_key($user) === 'chief';
}

function leave_is_hr_reviewer(array $user): bool
{
    return in_array(leave_role_key($user), ['hrhead', 'hrstaff'], true);
}

function leave_is_regional_director(array $user): bool
{
    return leave_role_key($user) === 'regionaldirector';
}

/*
 * Each open status identifies the desk that owns the request. Admin can stand in at an open desk,
 * but every other role must wait for the preceding approval instead of signing out of sequence.
 * A Chief's first-stage authority covers their own division only (see leave_read_scopes()).
 */
const LEAVE_APPROVAL_CHAIN = [
    /* Legacy submitted rows skip the removed start-verification stage. */
    'submitted' => ['roles' => ['hrstaff'], 'next' => 'endorsed'],
    'pending' => ['roles' => ['hrstaff'], 'next' => 'endorsed'],
    'endorsed' => ['roles' => ['hrhead'], 'next' => 'reviewed'],
    'reviewed' => ['roles' => ['chief'], 'next' => 'chief_reviewed'],
    'chief_reviewed' => ['roles' => ['regionaldirector'], 'next' => 'approved'],
];

function leave_stage_roles(string $status): array
{
    return LEAVE_APPROVAL_CHAIN[strtolower($status)]['roles'] ?? [];
}

function leave_stage_next_status(string $status): ?string
{
    return LEAVE_APPROVAL_CHAIN[strtolower($status)]['next'] ?? null;
}

/*
 * Whether the caller may take `$action` ('approve' or 'reject') on a request at `$status`. The chain
 * decides which desk the request is waiting on; the Leave Management approve/reject checkboxes an
 * administrator ticked for the role in RBAC decide whether that desk may act. A Planning Officer
 * seated as a division desk stands at the Chief's stage.
 */
function leave_can_act_on(array $user, string $status, string $action): bool
{
    $stageRoles = leave_stage_roles($status);
    if ($stageRoles === []) {
        return false;
    }

    if (!leave_role_has_action($user, $action)) {
        return false;
    }

    $roleKey = leave_role_key($user);
    if ($roleKey === 'planningofficer' && leave_is_division_desk($user)) {
        $roleKey = 'chief';
    }

    return $roleKey === 'admin' || in_array($roleKey, $stageRoles, true);
}

function leave_stage_role_label(string $status): string
{
    return match (strtolower($status)) {
        'submitted' => 'HR Staff for leave balance verification',
        'pending' => 'HR Staff for leave balance verification',
        'endorsed' => 'HR Head',
        'reviewed' => 'Chief Admin',
        'chief_reviewed' => 'Regional Director',
        default => 'an authorized approver',
    };
}

/** Only the Chief assigned to the applicant's division receives the initial notification. */
function leave_chief_user_ids_for_employee(PDO $pdo, int $employeeId): array
{
    ensure_role_columns($pdo);
    $statement = $pdo->prepare(
        'SELECT DISTINCT chief_user.id
         FROM employees applicant
         INNER JOIN employees chief_employee
            ON chief_employee.division_id = applicant.division_id
           AND chief_employee.is_archived = 0
         INNER JOIN users chief_user
            ON chief_user.email COLLATE utf8mb4_unicode_ci = chief_employee.email COLLATE utf8mb4_unicode_ci
           AND chief_user.is_archived = 0
         INNER JOIN roles chief_role ON chief_role.id = chief_user.role_id
         WHERE applicant.id = :employee_id
           AND applicant.is_archived = 0
           AND (
                LOWER(REPLACE(chief_role.name, " ", "")) = "chief"
                OR LOWER(REPLACE(COALESCE(chief_role.base_role, ""), " ", "")) = "chief"
           )'
    );
    $statement->execute([':employee_id' => $employeeId]);

    return array_map('intval', array_column($statement->fetchAll(), 'id'));
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
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            COALESCE(des.name, "") AS position,
            e.designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN designations des ON des.id = e.designation_id
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
        // The caption under the signature: their designation, or their position without one.
        'title' => employee_signatory_title($signatory['position'] ?? '', $signatory['designation'] ?? ''),
    ];

    return $cache[$roleKey];
}

/** Whether this employee signs in as an HR Head -- the only desk that signs 7.A of the form. */
function leave_employee_is_hr_head(PDO $pdo, int $employeeRecordId): bool
{
    static $cache = [];

    if (array_key_exists($employeeRecordId, $cache)) {
        return $cache[$employeeRecordId];
    }

    ensure_role_columns($pdo);
    $statement = $pdo->prepare(
        'SELECT 1
         FROM employees e
         INNER JOIN users u
            ON u.email COLLATE utf8mb4_unicode_ci = e.email COLLATE utf8mb4_unicode_ci
           AND u.is_archived = 0
         INNER JOIN roles r ON r.id = u.role_id
         WHERE e.id = :employee_id
           AND (
                LOWER(REPLACE(r.name, " ", "")) = "hrhead"
                OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) = "hrhead"
           )
         LIMIT 1'
    );
    $statement->execute([':employee_id' => $employeeRecordId]);
    $cache[$employeeRecordId] = (bool)$statement->fetchColumn();

    return $cache[$employeeRecordId];
}

function leave_apply_signatory_fallbacks(PDO $pdo, array $request): array
{
    $statusKey = leave_status_to_database($request['status'] ?? '');

    /*
     * 7.A is the HR Head's signature. Older filings saved the applicant as its reviewer, which put
     * an HR Staff member's name, signature, and position on the HR Head's line; a saved reviewer who
     * is not an HR Head is treated as no signature at all, so the line below falls back as usual.
     */
    if (
        ($request['reviewedByEmployeeRecordId'] ?? null) !== null
        && !leave_employee_is_hr_head($pdo, (int)$request['reviewedByEmployeeRecordId'])
    ) {
        $request['reviewedByEmployeeRecordId'] = null;
        $request['reviewedByName'] = '';
        $request['reviewedByPosition'] = '';
        $request['reviewedAt'] = null;
    }
    $isSelfApprovedRequest = $statusKey === 'approved'
        && (int)($request['employeeRecordId'] ?? 0) > 0
        && (int)($request['approvedByEmployeeRecordId'] ?? 0) > 0
        && (int)$request['employeeRecordId'] === (int)$request['approvedByEmployeeRecordId'];

    if (
        !$isSelfApprovedRequest
        && ($request['reviewedByEmployeeRecordId'] ?? null) === null
        && ($request['reviewedAt'] ?? null) === null
        && in_array($statusKey, ['reviewed', 'chief_reviewed', 'approved'], true)
    ) {
        $fallbackHrHead = leave_default_signatory_for_role($pdo, 'hrhead');
        if ($fallbackHrHead !== null && ($fallbackHrHead['employeeRecordId'] ?? 0) > 0) {
            $request['reviewedByEmployeeRecordId'] = (int)$fallbackHrHead['employeeRecordId'];
            $request['reviewedByName'] = leave_text($fallbackHrHead['employeeName'] ?? '');
            $request['reviewedByPosition'] = leave_text($fallbackHrHead['title'] ?? '');
        }
    }

    /*
     * 7.A is signed by the HR Head, and the form captions that signature with the signer's own
     * designation (or position, if they have none) rather than a fixed title. Until someone has
     * signed, the blank line names the title of whoever holds the HR Head desk now.
     */
    $currentHrHead = leave_default_signatory_for_role($pdo, 'hrhead');
    $request['hrHeadPosition'] = $currentHrHead !== null
        ? leave_text($currentHrHead['title'] ?? '')
        : '';

    if (
        ($request['approvedByEmployeeRecordId'] ?? null) === null
        && ($request['approvedAt'] ?? null) === null
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

/* Long statutory leaves can span 105 calendar days; one year remains a conservative metadata cap. */
const LEAVE_MAX_DAYS = 366;

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
 * Ordinary leave skips Saturdays and Sundays inside an inclusive range.
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
    if ($statement === false || $statement->fetch() === false) {
        $pdo->exec('ALTER TABLE leave_requests ADD COLUMN rejected_note TEXT NULL AFTER reason');
    }

    $roleStatement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'rejected_by_role'");
    if ($roleStatement === false || $roleStatement->fetch() === false) {
        $pdo->exec('ALTER TABLE leave_requests ADD COLUMN rejected_by_role VARCHAR(80) NULL AFTER rejected_note');
    }
}

function ensure_leave_request_workflow_statuses(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'status'");
    $column = $statement !== false ? $statement->fetch() : false;
    $columnType = strtolower((string)($column['Type'] ?? $column['type'] ?? ''));
    $hadSubmittedStatus = $columnType !== '' && strpos($columnType, "'submitted'") !== false;
    $hadChiefReviewedStatus = $columnType !== '' && strpos($columnType, "'chief_reviewed'") !== false;

    if ($hadSubmittedStatus || !$hadChiefReviewedStatus) {
        $pdo->exec("ALTER TABLE leave_requests MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'pending'");
        $pdo->exec("UPDATE leave_requests SET status = 'cancelled' WHERE status = 'withdrawn'");
        /* Existing reviewed requests had already cleared HR and were waiting for the Director. */
        if (!$hadChiefReviewedStatus && $columnType !== '' && strpos($columnType, "'reviewed'") !== false) {
            $pdo->exec(
                "UPDATE leave_requests
                 SET status = 'chief_reviewed'
                 WHERE status = 'reviewed'"
            );
        }
        /* The separate submitted stage was removed; old filings now wait directly on verification. */
        $pdo->exec("UPDATE leave_requests SET status = 'pending' WHERE status = 'submitted'");
        $pdo->exec(
            "ALTER TABLE leave_requests
             MODIFY COLUMN status ENUM('pending', 'endorsed', 'reviewed', 'chief_reviewed', 'approved', 'rejected', 'cancelled')
             NOT NULL DEFAULT 'pending'"
        );
    }

    /* Keep the legacy level column aligned for reports or integrations that still read it. */
    $pdo->exec(
        "UPDATE leave_requests
         SET current_level = CASE
            WHEN status = 'pending' THEN 1
            WHEN status = 'endorsed' THEN 2
            WHEN status = 'reviewed' THEN 3
            WHEN status = 'chief_reviewed' THEN 4
            WHEN status = 'approved' THEN 5
            ELSE current_level
         END
         WHERE status IN ('pending', 'endorsed', 'reviewed', 'chief_reviewed', 'approved')
           AND current_level <> CASE
              WHEN status = 'pending' THEN 1
              WHEN status = 'endorsed' THEN 2
              WHEN status = 'reviewed' THEN 3
              WHEN status = 'chief_reviewed' THEN 4
              WHEN status = 'approved' THEN 5
              ELSE current_level
           END"
    );
}

function ensure_leave_request_action_actor_columns(PDO $pdo): void
{
    $endorsedByStatement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'endorsed_by_employee_id'");
    if ($endorsedByStatement !== false && $endorsedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE leave_requests
             ADD COLUMN endorsed_by_employee_id INT UNSIGNED NULL AFTER rejected_note'
        );
    }

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

    $chiefReviewedByStatement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'chief_reviewed_by_employee_id'");
    if ($chiefReviewedByStatement !== false && $chiefReviewedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE leave_requests
             ADD COLUMN chief_reviewed_by_employee_id INT UNSIGNED NULL AFTER reviewed_by_employee_id'
        );
    }

    $chiefReviewedIndexStatement = $pdo->query("SHOW INDEX FROM leave_requests WHERE Key_name = 'fk_req_chief_reviewed_by_employee'");
    if ($chiefReviewedIndexStatement !== false && $chiefReviewedIndexStatement->fetch() === false) {
        $pdo->exec('ALTER TABLE leave_requests ADD KEY fk_req_chief_reviewed_by_employee (chief_reviewed_by_employee_id)');
    }

    $chiefReviewedConstraintStatement = $pdo->prepare(
        'SELECT CONSTRAINT_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "leave_requests"
           AND COLUMN_NAME = "chief_reviewed_by_employee_id"
           AND REFERENCED_TABLE_NAME = "employees"
         LIMIT 1'
    );
    $chiefReviewedConstraintStatement->execute();
    if ($chiefReviewedConstraintStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE leave_requests
             ADD CONSTRAINT fk_req_chief_reviewed_by_employee
             FOREIGN KEY (chief_reviewed_by_employee_id) REFERENCES employees (id)'
        );
    }

    $endorsedIndexStatement = $pdo->query("SHOW INDEX FROM leave_requests WHERE Key_name = 'fk_req_endorsed_by_employee'");
    if ($endorsedIndexStatement !== false && $endorsedIndexStatement->fetch() === false) {
        $pdo->exec('ALTER TABLE leave_requests ADD KEY fk_req_endorsed_by_employee (endorsed_by_employee_id)');
    }

    $endorsedConstraintStatement = $pdo->prepare(
        'SELECT CONSTRAINT_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "leave_requests"
           AND COLUMN_NAME = "endorsed_by_employee_id"
           AND REFERENCED_TABLE_NAME = "employees"
         LIMIT 1'
    );
    $endorsedConstraintStatement->execute();
    if ($endorsedConstraintStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE leave_requests
             ADD CONSTRAINT fk_req_endorsed_by_employee
             FOREIGN KEY (endorsed_by_employee_id) REFERENCES employees (id)'
        );
    }
}

function ensure_leave_request_action_timestamp_columns(PDO $pdo): void
{
    foreach (['endorsed_at', 'reviewed_at', 'chief_reviewed_at', 'approved_at'] as $column) {
        $statement = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE '" . $column . "'");
        if ($statement !== false && $statement->fetch() === false) {
            $pdo->exec('ALTER TABLE leave_requests ADD COLUMN ' . $column . ' TIMESTAMP NULL DEFAULT NULL');
        }
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

function fetch_leave_request(
    PDO $pdo,
    int $id,
    ?int $employeeScopeId = null,
    ?int $divisionScopeId = null
): ?array
{
    $sql = 'SELECT
            lr.leave_request_id AS id,
            lr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.profile_image AS profileImage,
            lt.name AS leaveType,
            d.name AS division,
            ' . employee_role_name_subselect() . ' AS employeeRole,
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
            COALESCE(lr.rejected_by_role, "") AS rejectedByRole,
            lr.endorsed_by_employee_id AS endorsedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(endorsed_employee.first_name, " ", COALESCE(endorsed_employee.middle_name, ""), " ", endorsed_employee.last_name)), ""), "") AS endorsedByName,
            lr.endorsed_at AS endorsedAt,
            lr.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
            COALESCE(NULLIF(TRIM(reviewed_employee.designation), ""), reviewed_designation.name, "") AS reviewedByPosition,
            lr.reviewed_at AS reviewedAt,
            lr.chief_reviewed_by_employee_id AS chiefReviewedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(chief_reviewed_employee.first_name, " ", COALESCE(chief_reviewed_employee.middle_name, ""), " ", chief_reviewed_employee.last_name)), ""), "") AS chiefReviewedByName,
            COALESCE(NULLIF(TRIM(chief_reviewed_employee.designation), ""), chief_reviewed_designation.name, "") AS chiefReviewedByPosition,
            COALESCE(chief_reviewed_division.code, "") AS chiefReviewedByDivisionCode,
            lr.chief_reviewed_at AS chiefReviewedAt,
            lr.approved_by_employee_id AS approvedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
            lr.approved_at AS approvedAt,
            lr.status,
            lr.archived_by_user_id AS archivedByUserId,
            DATE(lr.requested_at) AS dateFiled,
            lr.requested_at AS requestedAt,
            lr.updated_at AS updatedAt,
            COALESCE(la.file_name, "") AS attachmentName,
            COALESCE(la.file_path, "") AS attachmentPath
         FROM leave_requests lr
         INNER JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN employees endorsed_employee ON endorsed_employee.id = lr.endorsed_by_employee_id
         LEFT JOIN employees reviewed_employee ON reviewed_employee.id = lr.reviewed_by_employee_id
         LEFT JOIN designations reviewed_designation ON reviewed_designation.id = reviewed_employee.designation_id
         LEFT JOIN employees chief_reviewed_employee ON chief_reviewed_employee.id = lr.chief_reviewed_by_employee_id
         LEFT JOIN designations chief_reviewed_designation ON chief_reviewed_designation.id = chief_reviewed_employee.designation_id
         LEFT JOIN divisions chief_reviewed_division ON chief_reviewed_division.id = chief_reviewed_employee.division_id
         LEFT JOIN employees approved_employee ON approved_employee.id = lr.approved_by_employee_id
         LEFT JOIN leave_attachments la ON la.leave_request_id = lr.leave_request_id
         WHERE lr.leave_request_id = :id';

    if ($employeeScopeId !== null) {
        $sql .= ' AND lr.employee_id = :employee_scope_id';
    }

    if ($divisionScopeId !== null) {
        $sql .= ' AND e.division_id = :division_scope_id';
    }

    $sql .= ' ORDER BY la.leave_attachments_id DESC
         LIMIT 1';

    $statement = $pdo->prepare($sql);
    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    if ($divisionScopeId !== null) {
        $params[':division_scope_id'] = $divisionScopeId;
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
    $request['employeeRole'] = leave_text($request['employeeRole'] ?? '');
    $request['salaryRate'] = leave_text($request['salaryRate'] ?? '');
    $request['rejectedNote'] = leave_text($request['rejectedNote'] ?? '');
    $request['rejectedByRole'] = leave_text($request['rejectedByRole'] ?? '');
    $request['endorsedByEmployeeRecordId'] = $request['endorsedByEmployeeRecordId'] !== null
        ? (int)$request['endorsedByEmployeeRecordId']
        : null;
    $request['endorsedByName'] = leave_text($request['endorsedByName'] ?? '');
    $request['reviewedByEmployeeRecordId'] = $request['reviewedByEmployeeRecordId'] !== null
        ? (int)$request['reviewedByEmployeeRecordId']
        : null;
    $request['reviewedByName'] = leave_text($request['reviewedByName'] ?? '');
    $request['reviewedByPosition'] = leave_text($request['reviewedByPosition'] ?? '');
    $request['chiefReviewedByEmployeeRecordId'] = $request['chiefReviewedByEmployeeRecordId'] !== null
        ? (int)$request['chiefReviewedByEmployeeRecordId']
        : null;
    $request['chiefReviewedByName'] = leave_text($request['chiefReviewedByName'] ?? '');
    $request['chiefReviewedByPosition'] = leave_text($request['chiefReviewedByPosition'] ?? '');
    $request['chiefReviewedByDivisionCode'] = leave_text($request['chiefReviewedByDivisionCode'] ?? '');
    $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
        ? (int)$request['approvedByEmployeeRecordId']
        : null;
    $request['approvedByName'] = leave_text($request['approvedByName'] ?? '');
    $request['archivedByUserId'] = $request['archivedByUserId'] !== null
        ? (int)$request['archivedByUserId']
        : null;
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
 * Return the dates in a new filing that are already covered by one of the employee's live leave
 * requests. Rejected and cancelled requests no longer reserve their dates, but archiving a record
 * is only a records-management action and therefore does not make an approved date available again.
 *
 * Newer requests carry their exact selected dates in the reason metadata. Older callers may only
 * have stored a start/end range, so all four exact-date/range combinations are handled here rather
 * than relying on a broad SQL range overlap alone.
 */
function leave_duplicate_filing_dates(
    PDO $pdo,
    int $employeeId,
    string $startDate,
    string $endDate,
    array $leaveDays
): array {
    $statement = $pdo->prepare(
        'SELECT leave_request_id, start_date, end_date, reason
         FROM leave_requests
         WHERE employee_id = :employee_id
           AND status NOT IN ("rejected", "cancelled")
           AND start_date <= :end_date
           AND end_date >= :start_date'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $candidateDates = array_column($leaveDays, 'date');
    $duplicates = [];

    foreach ($statement->fetchAll() as $existingRequest) {
        $existingStart = leave_text($existingRequest['start_date'] ?? '');
        $existingEnd = leave_text($existingRequest['end_date'] ?? '');
        $existingReason = leave_unpack_reason($existingRequest['reason'] ?? '');
        $existingDates = array_column(
            leave_normalize_days($existingReason['details']['leaveDays'] ?? null),
            'date'
        );

        if ($candidateDates !== [] && $existingDates !== []) {
            $duplicates = array_merge($duplicates, array_intersect($candidateDates, $existingDates));
            continue;
        }

        if ($candidateDates !== []) {
            foreach ($candidateDates as $date) {
                if ($date >= $existingStart && $date <= $existingEnd) {
                    $duplicates[] = $date;
                }
            }
            continue;
        }

        if ($existingDates !== []) {
            foreach ($existingDates as $date) {
                if ($date >= $startDate && $date <= $endDate) {
                    $duplicates[] = $date;
                }
            }
            continue;
        }

        /* Both filings are legacy ranges. Find the first working day in their shared span. */
        $overlapStart = max($startDate, $existingStart);
        $overlapEnd = min($endDate, $existingEnd);
        for (
            $cursor = new DateTimeImmutable($overlapStart);
            $cursor->format('Y-m-d') <= $overlapEnd;
            $cursor = $cursor->modify('+1 day')
        ) {
            if (!leave_is_weekend($cursor->format('Y-m-d'))) {
                $duplicates[] = $cursor->format('Y-m-d');
                break;
            }
        }
    }

    $duplicates = array_values(array_unique($duplicates));
    sort($duplicates);

    return $duplicates;
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
            COALESCE(lr.rejected_note, "") AS rejectedNote,
            COALESCE(lr.rejected_by_role, "") AS rejectedByRole
         FROM leave_requests lr
         INNER JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
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
    $request['rejectedByRole'] = leave_text($request['rejectedByRole'] ?? '');

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
        return 'Leave request disapproved, but employee details could not be loaded for email notification.';
    }

    $employeeEmail = leave_text($request['employeeEmail'] ?? '');

    if ($employeeEmail === '' || filter_var($employeeEmail, FILTER_VALIDATE_EMAIL) === false) {
        return 'Leave request disapproved, but no valid employee email address is available.';
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
        return 'Leave request disapproved, but the disapproval email could not be sent.';
    }

    return null;
}

function leave_read_scopes(PDO $pdo, array $sessionUser): array
{
    // A Chief is the first-stage desk for their own division only: the list, single fetch, review,
    // approval, rejection and archive actions all stay inside that division. A Planning Officer
    // granted approve/reject in RBAC works that same desk (leave_is_division_desk()).
    if (leave_is_division_desk($sessionUser)) {
        return [
            'employeeId' => null,
            'divisionId' => leave_session_division_id($pdo, $sessionUser),
        ];
    }

    return match (leave_role_key($sessionUser)) {
        // Planning Officers and Cashiers use Leave Management for their own filings. Their role
        // work in other modules does not grant access to another employee's personal leave record.
        'employee', 'planningofficer', 'cashier' => [
            'employeeId' => resolve_leave_session_employee_id($pdo, $sessionUser),
            'divisionId' => null,
        ],
        // HR and the Regional Director are organization-wide approval desks.
        default => ['employeeId' => null, 'divisionId' => null],
    };
}

/** The division of the signed-in user's employee record, for division-scoped desks. */
function leave_session_division_id(PDO $pdo, array $sessionUser): int
{
    $employeeId = resolve_leave_session_employee_id($pdo, $sessionUser);
    $statement = $pdo->prepare(
        'SELECT division_id
         FROM employees
         WHERE id = :id
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeId]);
    $divisionId = (int)$statement->fetchColumn();

    if ($divisionId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Your employee record is not assigned to a division.',
        ], 422);
    }

    return $divisionId;
}

function list_leave_requests(PDO $pdo, array $sessionUser): void
{
    $scopes = leave_read_scopes($pdo, $sessionUser);
    $employeeScopeId = $scopes['employeeId'];
    $divisionScopeId = $scopes['divisionId'];

    $sql = 'SELECT
            lr.leave_request_id AS id,
            lr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.profile_image AS profileImage,
            lt.name AS leaveType,
            d.name AS division,
            ' . employee_role_name_subselect() . ' AS employeeRole,
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
            COALESCE(lr.rejected_by_role, "") AS rejectedByRole,
            lr.endorsed_by_employee_id AS endorsedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(endorsed_employee.first_name, " ", COALESCE(endorsed_employee.middle_name, ""), " ", endorsed_employee.last_name)), ""), "") AS endorsedByName,
            lr.endorsed_at AS endorsedAt,
            lr.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
            COALESCE(NULLIF(TRIM(reviewed_employee.designation), ""), reviewed_designation.name, "") AS reviewedByPosition,
            lr.reviewed_at AS reviewedAt,
            lr.chief_reviewed_by_employee_id AS chiefReviewedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(chief_reviewed_employee.first_name, " ", COALESCE(chief_reviewed_employee.middle_name, ""), " ", chief_reviewed_employee.last_name)), ""), "") AS chiefReviewedByName,
            COALESCE(NULLIF(TRIM(chief_reviewed_employee.designation), ""), chief_reviewed_designation.name, "") AS chiefReviewedByPosition,
            COALESCE(chief_reviewed_division.code, "") AS chiefReviewedByDivisionCode,
            lr.chief_reviewed_at AS chiefReviewedAt,
            lr.approved_by_employee_id AS approvedByEmployeeRecordId,
            COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
            lr.approved_at AS approvedAt,
            lr.status,
            lr.archived_by_user_id AS archivedByUserId,
            DATE(lr.requested_at) AS dateFiled,
            lr.requested_at AS requestedAt,
            lr.updated_at AS updatedAt,
            COALESCE(attachments.file_name, "") AS attachmentName,
            COALESCE(attachments.file_path, "") AS attachmentPath
         FROM leave_requests lr
         INNER JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN employees endorsed_employee ON endorsed_employee.id = lr.endorsed_by_employee_id
         LEFT JOIN employees reviewed_employee ON reviewed_employee.id = lr.reviewed_by_employee_id
         LEFT JOIN designations reviewed_designation ON reviewed_designation.id = reviewed_employee.designation_id
         LEFT JOIN employees chief_reviewed_employee ON chief_reviewed_employee.id = lr.chief_reviewed_by_employee_id
         LEFT JOIN designations chief_reviewed_designation ON chief_reviewed_designation.id = chief_reviewed_employee.designation_id
         LEFT JOIN divisions chief_reviewed_division ON chief_reviewed_division.id = chief_reviewed_employee.division_id
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
    if ($divisionScopeId !== null) {
        $sql .= ' AND e.division_id = :division_scope_id';
        $params[':division_scope_id'] = $divisionScopeId;
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
        $request['employeeRole'] = leave_text($request['employeeRole'] ?? '');
        $request['salaryRate'] = leave_text($request['salaryRate'] ?? '');
        $request['rejectedNote'] = leave_text($request['rejectedNote'] ?? '');
        $request['rejectedByRole'] = leave_text($request['rejectedByRole'] ?? '');
        $request['endorsedByEmployeeRecordId'] = $request['endorsedByEmployeeRecordId'] !== null
            ? (int)$request['endorsedByEmployeeRecordId']
            : null;
        $request['endorsedByName'] = leave_text($request['endorsedByName'] ?? '');
        $request['reviewedByEmployeeRecordId'] = $request['reviewedByEmployeeRecordId'] !== null
            ? (int)$request['reviewedByEmployeeRecordId']
            : null;
        $request['reviewedByName'] = leave_text($request['reviewedByName'] ?? '');
        $request['reviewedByPosition'] = leave_text($request['reviewedByPosition'] ?? '');
        $request['chiefReviewedByEmployeeRecordId'] = $request['chiefReviewedByEmployeeRecordId'] !== null
            ? (int)$request['chiefReviewedByEmployeeRecordId']
            : null;
        $request['chiefReviewedByName'] = leave_text($request['chiefReviewedByName'] ?? '');
        $request['chiefReviewedByPosition'] = leave_text($request['chiefReviewedByPosition'] ?? '');
        $request['chiefReviewedByDivisionCode'] = leave_text($request['chiefReviewedByDivisionCode'] ?? '');
        $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
            ? (int)$request['approvedByEmployeeRecordId']
            : null;
        $request['approvedByName'] = leave_text($request['approvedByName'] ?? '');
        $request['archivedByUserId'] = $request['archivedByUserId'] !== null
            ? (int)$request['archivedByUserId']
            : null;
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

    $scopes = leave_read_scopes($pdo, $sessionUser);
    $request = fetch_leave_request($pdo, $id, $scopes['employeeId'], $scopes['divisionId']);

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
    $isMaternityLeave = strtolower(trim($leaveType)) === 'maternity leave';
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
     * apply to every role: no account may back-date a filing. Ordinary leave is counted in working
     * working days, while maternity leave keeps its statutory calendar-day span.
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
        if (!$isMaternityLeave && $weekendDates !== []) {
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
        if (!$isMaternityLeave && $startDate !== null && leave_is_weekend($startDate)) {
            $errors[] = 'Start date must be a working day (Monday to Friday).';
        }
        if (!$isMaternityLeave && $endDate !== null && leave_is_weekend($endDate)) {
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

    $duplicateDates = leave_duplicate_filing_dates(
        $pdo,
        $employeeId,
        (string)$startDate,
        (string)$endDate,
        $leaveDays
    );

    if ($duplicateDates !== []) {
        $firstDuplicateDate = (new DateTimeImmutable($duplicateDates[0]))->format('F j, Y');
        json_response([
            'success' => false,
            'code' => 'duplicate_leave_date',
            'message' => count($duplicateDates) === 1
                ? sprintf("You can't file leave again for %s.", $firstDuplicateDate)
                : sprintf(
                    "You can't file leave again because %s and %d other selected date(s) are already covered by an existing leave request.",
                    $firstDuplicateDate,
                    count($duplicateDates) - 1
                ),
            'duplicateDates' => $duplicateDates,
        ], 409);
    }

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

    /* Every filing enters the same auditable sequence, regardless of the applicant's role. */
    $initialStatus = 'pending';
    $initialCurrentLevel = 1;
    $initialEndorsedByEmployeeId = null;
    $initialEndorsedAt = null;
    $initialReviewedByEmployeeId = null;
    $initialReviewedAt = null;
    $initialChiefReviewedByEmployeeId = null;
    $initialChiefReviewedAt = null;
    $initialApprovedByEmployeeId = null;
    $initialApprovedAt = null;

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
                (employee_id, leave_type_id, start_date, end_date, total_days, paid_days, unpaid_days, reason,
                 status, current_level, endorsed_by_employee_id, endorsed_at,
                 reviewed_by_employee_id, reviewed_at, chief_reviewed_by_employee_id, chief_reviewed_at,
                 approved_by_employee_id, approved_at)
             VALUES
                (:employee_id, :leave_type_id, :start_date, :end_date, :total_days, :paid_days, :unpaid_days, :reason,
                 :status, :current_level, :endorsed_by_employee_id, :endorsed_at,
                 :reviewed_by_employee_id, :reviewed_at, :chief_reviewed_by_employee_id, :chief_reviewed_at,
                 :approved_by_employee_id, :approved_at)'
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
            ':current_level' => $initialCurrentLevel,
            ':endorsed_by_employee_id' => $initialEndorsedByEmployeeId,
            ':endorsed_at' => $initialEndorsedAt,
            ':reviewed_by_employee_id' => $initialReviewedByEmployeeId,
            ':reviewed_at' => $initialReviewedAt,
            ':chief_reviewed_by_employee_id' => $initialChiefReviewedByEmployeeId,
            ':chief_reviewed_at' => $initialChiefReviewedAt,
            ':approved_by_employee_id' => $initialApprovedByEmployeeId,
            ':approved_at' => $initialApprovedAt,
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
        $notificationTitle = 'Leave Request Submitted';
        $notificationMessage = sprintf(
            '%s submitted a leave request for %s to %s. It is pending leave balance verification.',
            (string)($notificationRequest['employeeName'] ?? 'An employee'),
            (string)($notificationRequest['startDate'] ?? $startDate ?? ''),
            (string)($notificationRequest['endDate'] ?? $endDate ?? '')
        );

        notify_roles(
            $pdo,
            ['admin', 'hrstaff'],
            $notificationTitle,
            $notificationMessage,
            'leave_request_submitted',
            (string)$requestId
        );
    } catch (Throwable $notificationException) {
        error_log('Leave creation notification error: ' . $notificationException->getMessage());
    }

    $scopes = leave_read_scopes($pdo, $sessionUser);
    json_response([
        'success' => true,
        'request' => fetch_leave_request($pdo, $requestId, $scopes['employeeId'], $scopes['divisionId']),
        'message' => 'Leave request submitted and sent for leave balance verification.',
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
        'SELECT lr.employee_id, lr.leave_type_id, lr.start_date, lr.total_days,
                lr.paid_days, lr.status,
                lr.endorsed_by_employee_id, lr.endorsed_at,
                lr.reviewed_by_employee_id, lr.reviewed_at,
                lr.chief_reviewed_by_employee_id, lr.chief_reviewed_at,
                lr.approved_by_employee_id, lr.approved_at
         FROM leave_requests lr
         WHERE lr.leave_request_id = :id
           AND lr.is_archived = 0
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

    /* A division desk acts only on its own division's requests; anything else is invisible to it. */
    if (
        leave_is_division_desk($sessionUser)
        && fetch_leave_request($pdo, $id, null, leave_session_division_id($pdo, $sessionUser)) === null
    ) {
        json_response([
            'success' => false,
            'message' => 'Leave request not found.',
        ], 404);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $isAdmin = leave_role_key($sessionUser) === 'admin';
    $currentStatus = leave_status_to_database($currentRequest['status'] ?? '');
    $isOwnRequest = $sessionEmployeeId !== null && (int)($currentRequest['employee_id'] ?? 0) === $sessionEmployeeId;
    $isOwnCancellation = $isOwnRequest && $status === 'cancelled';
    $isApproval = in_array($status, ['pending', 'endorsed', 'reviewed', 'chief_reviewed', 'approved'], true);

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

    $currentEndorsedByEmployeeId = (int)($currentRequest['endorsed_by_employee_id'] ?? 0);
    $currentReviewedByEmployeeId = (int)($currentRequest['reviewed_by_employee_id'] ?? 0);
    $currentChiefReviewedByEmployeeId = (int)($currentRequest['chief_reviewed_by_employee_id'] ?? 0);
    $currentApprovedByEmployeeId = (int)($currentRequest['approved_by_employee_id'] ?? 0);
    $currentEndorsedAt = $currentRequest['endorsed_at'] ?? null;
    $currentReviewedAt = $currentRequest['reviewed_at'] ?? null;
    $currentChiefReviewedAt = $currentRequest['chief_reviewed_at'] ?? null;
    $currentApprovedAt = $currentRequest['approved_at'] ?? null;

    if (
        $isOwnCancellation
        && !in_array($currentStatus, ['submitted', 'pending'], true)
    ) {
        json_response([
            'success' => false,
            'message' => 'This leave request can no longer be cancelled.',
        ], 422);
    }

    if ($status === 'rejected' && $rejectedNote === '') {
        json_response([
            'success' => false,
            'message' => 'Disapproval note is required.',
        ], 422);
    }

    /*
     * A manager can reject the request at their assigned stage or approve it exactly one stage. The
     * requested approval status is deliberately ignored in favour of the stage's next status, so a
     * crafted client cannot jump from Chief review straight to final approval.
     */
    $isManagerCancellation = !$isOwnCancellation
        && $status === 'cancelled'
        && leave_role_key($sessionUser) === 'admin';
    $isAdminApprovalOverride = false;
    if (!$isOwnCancellation && !$isManagerCancellation && !$isApproval && $status !== 'rejected') {
        json_response([
            'success' => false,
            'message' => 'Leave requests may only be approved or rejected by an approver.',
        ], 422);
    }

    if (!$isOwnCancellation) {
        $chainAction = $status === 'rejected' ? 'reject' : 'approve';
        /* Admin may cancel on the applicant's behalf at any open desk; every other move is a chain decision. */
        $allowed = $isManagerCancellation
            ? leave_stage_roles($currentStatus) !== []
            : leave_can_act_on($sessionUser, $currentStatus, $chainAction);

        if (!$allowed) {
            json_response([
                'success' => false,
                'message' => leave_stage_roles($currentStatus) === []
                    ? 'This leave request has already been ' . $currentStatus . '.'
                    : (leave_role_has_action($sessionUser, $chainAction)
                        ? 'This leave request is waiting on ' . leave_stage_role_label($currentStatus) . '.'
                        : 'Your role is not allowed to ' . $chainAction . ' leave requests.'),
            ], 403);
        }
    }

    if ($isApproval) {
        $status = leave_stage_next_status($currentStatus) ?? $status;
        $isAdminApprovalOverride = $isAdmin
            && ($sessionEmployeeId === null || $sessionEmployeeId <= 0);

        /*
         * Admin is explicitly allowed to stand in at any open desk. An Admin account is commonly
         * system-only and therefore has no employee record or employee signature. Let that account
         * advance the workflow as an unsigned administrative override; role-holder approvals still
         * require the linked employee record used for their CSC form signature.
         */
        if (($sessionEmployeeId === null || $sessionEmployeeId <= 0) && !$isAdmin) {
            json_response([
                'success' => false,
                'message' => 'Your account is not linked to an employee record, so your approval cannot be signed.',
            ], 422);
        }
    }

    if ($status === 'approved') {
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
     * Each one-way approval -- Chief, HR, and Regional Director -- carries a solved captcha.
     * Rejecting and cancelling do not.
     *
     * Last of the gates on purpose. Every permission and stage check above has already run, so a
     * caller who was never allowed to approve this request is turned away without being handed a
     * sum to solve, and the credit check has passed too, so a challenge is never spent on an
     * approval that was going to be refused for want of credits anyway.
     */
    if (in_array($status, ['endorsed', 'reviewed', 'chief_reviewed', 'approved'], true)) {
        require_approval_captcha($body, 'leave', $id);
    }

    $signerEmployeeId = $sessionEmployeeId !== null && $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
    $signedAt = date('Y-m-d H:i:s');
    $nextEndorsedByEmployeeId = $currentEndorsedByEmployeeId > 0 ? $currentEndorsedByEmployeeId : null;
    $nextReviewedByEmployeeId = $currentReviewedByEmployeeId > 0 ? $currentReviewedByEmployeeId : null;
    $nextChiefReviewedByEmployeeId = $currentChiefReviewedByEmployeeId > 0 ? $currentChiefReviewedByEmployeeId : null;
    $nextApprovedByEmployeeId = $currentApprovedByEmployeeId > 0 ? $currentApprovedByEmployeeId : null;
    $nextEndorsedAt = $nextEndorsedByEmployeeId !== null ? $currentEndorsedAt : null;
    $nextReviewedAt = $nextReviewedByEmployeeId !== null ? $currentReviewedAt : null;
    $nextChiefReviewedAt = $nextChiefReviewedByEmployeeId !== null ? $currentChiefReviewedAt : null;
    $nextApprovedAt = $nextApprovedByEmployeeId !== null ? $currentApprovedAt : null;

    if ($isApproval && in_array($currentStatus, ['submitted', 'pending'], true)) {
        $nextEndorsedByEmployeeId = $signerEmployeeId;
        $nextEndorsedAt = $signedAt;
        $nextReviewedByEmployeeId = null;
        $nextReviewedAt = null;
        $nextChiefReviewedByEmployeeId = null;
        $nextChiefReviewedAt = null;
        $nextApprovedByEmployeeId = null;
        $nextApprovedAt = null;
    } elseif ($isApproval && $currentStatus === 'endorsed') {
        $nextReviewedByEmployeeId = $signerEmployeeId;
        $nextReviewedAt = $signedAt;
        $nextChiefReviewedByEmployeeId = null;
        $nextChiefReviewedAt = null;
        $nextApprovedByEmployeeId = null;
        $nextApprovedAt = null;
    } elseif ($isApproval && $currentStatus === 'reviewed') {
        $nextChiefReviewedByEmployeeId = $signerEmployeeId;
        $nextChiefReviewedAt = $signedAt;
        $nextApprovedByEmployeeId = null;
        $nextApprovedAt = null;
    } elseif ($isApproval && $currentStatus === 'chief_reviewed') {
        $nextApprovedByEmployeeId = $signerEmployeeId;
        $nextApprovedAt = $signedAt;
    }

    if ($status === 'rejected' && $signerEmployeeId !== null) {
        if ($currentStatus === 'pending') {
            $nextEndorsedByEmployeeId = $signerEmployeeId;
            $nextEndorsedAt = $signedAt;
        } elseif ($currentStatus === 'endorsed') {
            $nextReviewedByEmployeeId = $signerEmployeeId;
            $nextReviewedAt = $signedAt;
        } elseif ($currentStatus === 'reviewed') {
            $nextChiefReviewedByEmployeeId = $signerEmployeeId;
            $nextChiefReviewedAt = $signedAt;
        } elseif ($currentStatus === 'chief_reviewed') {
            $nextApprovedByEmployeeId = $signerEmployeeId;
            $nextApprovedAt = $signedAt;
        }
    }

    $currentLevel = match ($status) {
        'pending' => 1,
        'endorsed' => 2,
        'reviewed' => 3,
        'chief_reviewed' => 4,
        'approved' => 5,
        default => max(1, (int)array_search($currentStatus, ['pending', 'endorsed', 'reviewed', 'chief_reviewed'], true) + 1),
    };

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'UPDATE leave_requests
             SET status = :status,
                 current_level = :current_level,
                 rejected_note = :rejected_note,
                 rejected_by_role = :rejected_by_role,
                 endorsed_by_employee_id = :endorsed_by_employee_id,
                 endorsed_at = :endorsed_at,
                 reviewed_by_employee_id = :reviewed_by_employee_id,
                 reviewed_at = :reviewed_at,
                 chief_reviewed_by_employee_id = :chief_reviewed_by_employee_id,
                 chief_reviewed_at = :chief_reviewed_at,
                 approved_by_employee_id = :approved_by_employee_id,
                 approved_at = :approved_at
             WHERE leave_request_id = :id
               AND status = :current_status
               AND is_archived = 0'
        );
        $statement->execute([
            ':status' => $status,
            ':current_level' => $currentLevel,
            ':rejected_note' => $status === 'rejected' ? $rejectedNote : null,
            ':rejected_by_role' => $status === 'rejected' ? leave_role_key($sessionUser) : null,
            ':endorsed_by_employee_id' => $nextEndorsedByEmployeeId,
            ':endorsed_at' => $nextEndorsedAt,
            ':reviewed_by_employee_id' => $nextReviewedByEmployeeId,
            ':reviewed_at' => $nextReviewedAt,
            ':chief_reviewed_by_employee_id' => $nextChiefReviewedByEmployeeId,
            ':chief_reviewed_at' => $nextChiefReviewedAt,
            ':approved_by_employee_id' => $nextApprovedByEmployeeId,
            ':approved_at' => $nextApprovedAt,
            ':id' => $id,
            ':current_status' => $currentStatus,
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

            $pdo->rollBack();
            json_response([
                'success' => false,
                'message' => 'This leave request was updated by another approver. Refresh the list before acting again.',
            ], 409);
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
        $notificationRequest = fetch_leave_request($pdo, $id, null, null);
        if ($notificationRequest !== null) {
            $notificationType = match ($status) {
                'approved' => 'leave_request_approved',
                'rejected' => 'leave_request_rejected',
                'pending', 'endorsed', 'reviewed', 'chief_reviewed' => 'leave_request_submitted',
                default => 'system_alert',
            };
            $notificationTitle = match ($status) {
                'pending' => 'Leave Balance Verification Started',
                'endorsed' => 'Leave Balance Verified',
                'reviewed' => 'Leave Request Approved by HR Head',
                'chief_reviewed' => 'Leave Request Reviewed by Chief Admin',
                'approved' => 'Leave Request Approved',
                'rejected' => 'Leave Request Rejected',
                default => 'Leave Request Updated',
            };
            $notificationMessage = match ($status) {
                'pending' => sprintf('Your %s leave request is pending leave balance verification.', (string)($notificationRequest['leaveType'] ?? 'leave')),
                'endorsed' => sprintf('Your %s leave balance was verified. The request is pending HR Head approval.', (string)($notificationRequest['leaveType'] ?? 'leave')),
                'reviewed' => sprintf('Your %s leave request was approved by the HR Head and is pending Chief Admin review.', (string)($notificationRequest['leaveType'] ?? 'leave')),
                'chief_reviewed' => sprintf('Your %s leave request was reviewed by the Chief Admin and is pending Regional Director approval.', (string)($notificationRequest['leaveType'] ?? 'leave')),
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
                default => sprintf('Your %s leave request has been updated.', (string)($notificationRequest['leaveType'] ?? 'leave')),
            };

            notify_employee($pdo, (int)($currentRequest['employee_id'] ?? 0), $notificationTitle, $notificationMessage, $notificationType, (string)$id);

            if ($status === 'endorsed') {
                notify_roles(
                    $pdo,
                    ['admin', 'hrhead'],
                    'Leave Request Pending HR Head Approval',
                    (string)($notificationRequest['employeeName'] ?? 'An employee') . ' has a leave request with a verified balance pending HR Head approval.',
                    'leave_request_submitted',
                    (string)$id
                );
            } elseif ($status === 'reviewed') {
                notify_roles($pdo, ['admin'], 'Leave Request Pending Chief Admin Review', (string)($notificationRequest['employeeName'] ?? 'An employee') . ' has an HR Head-approved leave request pending Chief Admin review.', 'leave_request_submitted', (string)$id);
                notify_users($pdo, leave_chief_user_ids_for_employee($pdo, (int)($currentRequest['employee_id'] ?? 0)), 'Leave Request Pending Chief Admin Review', (string)($notificationRequest['employeeName'] ?? 'An employee') . ' has an HR Head-approved leave request pending Chief Admin review.', 'leave_request_submitted', (string)$id);
            } elseif ($status === 'chief_reviewed') {
                notify_roles(
                    $pdo,
                    ['admin', 'regionaldirector'],
                    'Leave Request Pending Regional Director Approval',
                    (string)($notificationRequest['employeeName'] ?? 'An employee') . ' has a Chief Admin-reviewed leave request pending Regional Director approval.',
                    'leave_request_submitted',
                    (string)$id
                );
            }
        }
    } catch (Throwable $notificationException) {
        error_log('Leave update notification error: ' . $notificationException->getMessage());
    }

    $notificationWarning = null;

    if ($status === 'rejected') {
        $notificationWarning = send_leave_rejection_notification($pdo, $id);
    }

    $responseScopes = leave_read_scopes($pdo, $sessionUser);
    json_response([
        'success' => true,
        'request' => fetch_leave_request($pdo, $id, $responseScopes['employeeId'], $responseScopes['divisionId']),
        'emailNotification' => $status === 'rejected'
            ? ($notificationWarning === null ? 'sent' : 'warning')
            : 'not_applicable',
        'message' => $status === 'rejected'
            ? ($notificationWarning ?? 'Leave request disapproved and the employee was notified by email.')
            : match ($status) {
                'pending' => 'Leave request moved to leave balance verification.',
                'endorsed' => 'Leave balance verified. The request is pending HR Head approval.',
                'reviewed' => 'Leave request approved by the HR Head and sent for Chief Admin review.',
                'chief_reviewed' => 'Leave request reviewed by the Chief Admin and sent to the Regional Director.',
                'approved' => $isAdminApprovalOverride
                    ? 'Leave request received final approval through an Admin override.'
                    : 'Leave request received final approval from the Regional Director.',
                'cancelled' => 'Leave request cancelled.',
                default => 'Leave request updated.',
            },
    ]);
}

/**
 * Archiving is a records-management action, not a decision on the request, so it deliberately does
 * not apply the "you cannot act on your own request" rule that the status changes enforce. The
 * permission is the module's own — whoever may manage leave may archive it.
 */
function archive_leave_request(PDO $pdo, array $body, array $sessionUser, bool $archived): void
{
    if (!leave_can_archive($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive leave requests.',
        ], 403);
    }

    if (leave_is_chief($sessionUser) && !$archived) {
        json_response([
            'success' => false,
            'message' => 'Chief accounts may archive leave requests but may not restore them.',
        ], 403);
    }

    $id = (int)($body['id'] ?? $body['requestId'] ?? 0);
    $scopes = leave_read_scopes($pdo, $sessionUser);
    $actionDivisionScopeId = $scopes['divisionId'];
    $request = $id > 0
        ? fetch_leave_request($pdo, $id, $scopes['employeeId'], $actionDivisionScopeId)
        : null;

    if ($request === null) {
        json_response([
            'success' => false,
            'message' => 'Leave request not found.',
        ], 404);
    }

    if (
        $archived
        && leave_is_self_service_role($sessionUser)
        && !in_array(strtolower((string)($request['status'] ?? '')), ['approved', 'rejected', 'cancelled'], true)
    ) {
        json_response([
            'success' => false,
            'message' => 'Only approved, rejected, or cancelled leave requests can be archived.',
        ], 422);
    }

    if (
        !$archived
        && leave_is_self_service_role($sessionUser)
        && (int)($request['archivedByUserId'] ?? 0) !== (int)($sessionUser['id'] ?? 0)
    ) {
        json_response([
            'success' => false,
            'message' => 'You may restore only leave requests that you archived yourself.',
        ], 403);
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
        'request' => fetch_leave_request($pdo, $id, $scopes['employeeId'], $scopes['divisionId']),
    ]);
}

try {
    ensure_leave_request_rejected_note_column($pdo);
    ensure_leave_request_pay_split_columns($pdo);
    ensure_leave_request_workflow_statuses($pdo);
    ensure_leave_request_action_actor_columns($pdo);
    ensure_leave_request_action_timestamp_columns($pdo);
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
