<?php
declare(strict_types=1);

/**
 * Personal details edit requests.
 *
 * An employee's legal identity — name, birth date, civil status — is the part of the record HR
 * certifies on official forms, so the profile page shows it read-only and asks instead of editing.
 * The request carries a reason, goes to every HR Head and Admin as a notification, and approving it
 * unlocks the section in the browser the requester is already sitting in front of.
 *
 * One approval covers one save. `mark_used` closes the request as the section saves, so a second
 * correction needs a second request and every unlock granted leaves a row behind.
 *
 * Modelled on service_record_print.php, which solves the same shape of problem for printing.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

/** Who may approve an edit request. */
const PROFILE_EDIT_APPROVER_ROLES = ['admin', 'hrhead'];

/**
 * Roles that maintain employee master records from Employee Management. They already edit personal
 * details there, so they never queue a request.
 */
const PROFILE_EDIT_MANAGER_ROLES = ['admin', 'hrhead', 'hrstaff'];

const PROFILE_EDIT_REQUEST_NOTIFICATION = 'profile_edit_request';
const PROFILE_EDIT_DECIDED_NOTIFICATION = 'profile_edit_approved';

/** The only section behind this gate today; stored so a second one can be added without a migration. */
const PROFILE_EDIT_SECTION = 'personal';

const PROFILE_EDIT_REASON_MIN = 10;
const PROFILE_EDIT_REASON_MAX = 500;

function profile_edit_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function profile_edit_can_approve(array $user): bool
{
    return in_array(user_role_key($user), PROFILE_EDIT_APPROVER_ROLES, true);
}

function profile_edit_can_edit_directly(array $user): bool
{
    return in_array(user_role_key($user), PROFILE_EDIT_MANAGER_ROLES, true);
}

/**
 * Creates the table on first use.
 *
 * Unlike the print requests, this feature ships after the database dump was cut, so an already
 * installed HRIS has no such table and no migration step to run one. The DDL is idempotent and the
 * call sits outside any transaction — MySQL commits implicitly when it sees DDL, and running it
 * inside one would end that transaction early.
 *
 * The foreign keys in database/hris.sql are left off here on purpose: a lazily created table cannot
 * assume the existing install matches on engine or collation, and a rejected constraint would take
 * the whole table with it.
 */
function ensure_profile_edit_request_table(PDO $pdo): void
{
    ensure_audit_logs_table($pdo);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS profile_edit_requests (
            id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_record_id INT(10) UNSIGNED NOT NULL,
            requested_by_user_id INT(10) UNSIGNED NOT NULL,
            section VARCHAR(40) NOT NULL DEFAULT "personal",
            reason VARCHAR(500) NOT NULL,
            status ENUM("pending","approved","declined","used") NOT NULL DEFAULT "pending",
            decided_by_user_id INT(10) UNSIGNED DEFAULT NULL,
            decision_note VARCHAR(500) DEFAULT NULL,
            decided_at DATETIME DEFAULT NULL,
            used_at DATETIME DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_profile_edit_requests_open (employee_record_id, section, status),
            KEY idx_profile_edit_requests_user (requested_by_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/** One request, with the requester and whoever decided it. */
function profile_edit_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT r.id, r.employee_record_id, r.requested_by_user_id, r.section, r.reason, r.status,
                r.decision_note, r.decided_at, r.used_at, r.created_at,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS requester_name,
                e.employee_id AS employee_code,
                d.name AS designation_title,
                role.name AS role_name,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(de.first_name, ""), " ", COALESCE(de.last_name, ""))), ""), du.username) AS decided_by_name
         FROM profile_edit_requests r
         INNER JOIN users u ON u.id = r.requested_by_user_id
         LEFT JOIN roles role ON role.id = u.role_id
         LEFT JOIN employees e ON e.id = r.employee_record_id
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN users du ON du.id = r.decided_by_user_id
         LEFT JOIN employees de
            ON de.email COLLATE utf8mb4_unicode_ci = du.email COLLATE utf8mb4_unicode_ci
           AND de.is_archived = 0
         WHERE r.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : $row;
}

function profile_edit_format(array $row): array
{
    return [
        'id' => (int)($row['id'] ?? 0),
        'employeeRecordId' => (int)($row['employee_record_id'] ?? 0),
        'requestedByUserId' => (int)($row['requested_by_user_id'] ?? 0),
        'section' => profile_edit_text($row['section'] ?? PROFILE_EDIT_SECTION),
        'reason' => profile_edit_text($row['reason'] ?? ''),
        'status' => profile_edit_text($row['status'] ?? ''),
        'requesterName' => profile_edit_text($row['requester_name'] ?? ''),
        'requesterRole' => profile_edit_text($row['role_name'] ?? ''),
        'employeeCode' => profile_edit_text($row['employee_code'] ?? ''),
        'designationTitle' => profile_edit_text($row['designation_title'] ?? ''),
        'decidedByName' => profile_edit_text($row['decided_by_name'] ?? ''),
        'decisionNote' => profile_edit_text($row['decision_note'] ?? ''),
        'createdAt' => (string)($row['created_at'] ?? ''),
        'decidedAt' => (string)($row['decided_at'] ?? ''),
        'usedAt' => (string)($row['used_at'] ?? ''),
    ];
}

/**
 * The request that still bears on the section: one waiting for HR, or one approved and not yet
 * spent. Used and declined requests are history and deliberately fall out of this.
 */
function profile_edit_active(PDO $pdo, int $employeeRecordId, string $section): ?array
{
    if ($employeeRecordId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM profile_edit_requests
         WHERE employee_record_id = :employee_record_id
           AND section = :section
           AND status IN ("pending", "approved")
         ORDER BY id DESC
         LIMIT 1'
    );
    $statement->execute([
        ':employee_record_id' => $employeeRecordId,
        ':section' => $section,
    ]);
    $id = (int)$statement->fetchColumn();

    return $id > 0 ? profile_edit_row($pdo, $id) : null;
}

/**
 * The most recent request of any status, so a requester is told their last one was declined rather
 * than being shown a bare button again. An active request always wins, so sending a new one clears
 * the declined notice.
 */
function profile_edit_latest(PDO $pdo, int $employeeRecordId, string $section): ?array
{
    if ($employeeRecordId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM profile_edit_requests
         WHERE employee_record_id = :employee_record_id
           AND section = :section
         ORDER BY id DESC
         LIMIT 1'
    );
    $statement->execute([
        ':employee_record_id' => $employeeRecordId,
        ':section' => $section,
    ]);
    $id = (int)$statement->fetchColumn();

    return $id > 0 ? profile_edit_row($pdo, $id) : null;
}

function profile_edit_status(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? 0);

    // A single request by id: what the notification detail view reads.
    if ($id > 0) {
        $row = profile_edit_row($pdo, $id);

        if ($row === null) {
            json_response([
                'success' => false,
                'message' => 'Edit request was not found.',
            ], 404);
        }

        // Requesters may read their own; everything else is for the approvers.
        if (
            !profile_edit_can_approve($sessionUser)
            && (int)$row['requested_by_user_id'] !== (int)($sessionUser['id'] ?? 0)
        ) {
            json_response([
                'success' => false,
                'message' => 'You can only view your own edit requests.',
            ], 403);
        }

        json_response([
            'success' => true,
            'request' => profile_edit_format($row),
        ]);
    }

    $employeeRecordId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);
    $section = profile_edit_text($_GET['section'] ?? '') ?: PROFILE_EDIT_SECTION;
    $row = profile_edit_active($pdo, $employeeRecordId, $section)
        ?? profile_edit_latest($pdo, $employeeRecordId, $section);

    json_response([
        'success' => true,
        'canApprove' => profile_edit_can_approve($sessionUser),
        'canEditDirectly' => profile_edit_can_edit_directly($sessionUser),
        'request' => $row === null ? null : profile_edit_format($row),
    ]);
}

function profile_edit_create(PDO $pdo, array $sessionUser, array $body): void
{
    if (profile_edit_can_edit_directly($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You can already edit personal details from Employee Management.',
        ], 422);
    }

    $employeeRecordId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);

    if ($employeeRecordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'No employee record is linked to this account.',
        ], 422);
    }

    $reason = profile_edit_text($body['reason'] ?? '');

    /*
     * The reason is the point of the request — it is what the approver decides on and what the
     * audit trail keeps once the correction is made. An empty or one-word box gives them nothing to
     * judge, so it is refused here rather than forwarded.
     */
    if (mb_strlen($reason) < PROFILE_EDIT_REASON_MIN) {
        json_response([
            'success' => false,
            'message' => 'Tell HR why the correction is needed, in at least a short sentence.',
            'errors' => [
                'reason' => 'Please describe the correction in at least ' . PROFILE_EDIT_REASON_MIN . ' characters.',
            ],
        ], 422);
    }

    if (mb_strlen($reason) > PROFILE_EDIT_REASON_MAX) {
        json_response([
            'success' => false,
            'message' => 'That reason is too long.',
            'errors' => [
                'reason' => 'Please keep the reason under ' . PROFILE_EDIT_REASON_MAX . ' characters.',
            ],
        ], 422);
    }

    $section = profile_edit_text($body['section'] ?? '') ?: PROFILE_EDIT_SECTION;

    // One open request at a time: pressing the button twice must not bury HR in duplicates.
    $existing = profile_edit_active($pdo, $employeeRecordId, $section);

    if ($existing !== null) {
        json_response([
            'success' => true,
            'alreadyRequested' => true,
            'message' => $existing['status'] === 'approved'
                ? 'Your edit request has already been approved.'
                : 'Your request is already waiting for HR Head or Admin approval.',
            'request' => profile_edit_format($existing),
        ]);
    }

    $insert = $pdo->prepare(
        'INSERT INTO profile_edit_requests (employee_record_id, requested_by_user_id, section, reason)
         VALUES (:employee_record_id, :user_id, :section, :reason)'
    );
    $insert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':user_id' => (int)($sessionUser['id'] ?? 0),
        ':section' => $section,
        ':reason' => $reason,
    ]);

    $requestId = (int)$pdo->lastInsertId();
    $row = profile_edit_row($pdo, $requestId);
    $requesterName = profile_edit_text($row['requester_name'] ?? ($sessionUser['username'] ?? 'An employee'));
    $employeeCode = profile_edit_text($row['employee_code'] ?? '');

    notify_roles(
        $pdo,
        PROFILE_EDIT_APPROVER_ROLES,
        'Personal details edit requested',
        sprintf(
            '%s%s is asking to correct their personal details. Reason: %s',
            $requesterName,
            $employeeCode !== '' ? ' (' . $employeeCode . ')' : '',
            $reason
        ),
        PROFILE_EDIT_REQUEST_NOTIFICATION,
        (string)$requestId
    );

    write_auth_audit(
        $pdo,
        $sessionUser,
        'profile_edit.requested',
        'A personal details edit request was submitted.',
        [
            'module' => 'profile',
            'requestId' => $requestId,
            'employeeRecordId' => $employeeRecordId,
            'section' => $section,
        ]
    );

    json_response([
        'success' => true,
        'message' => 'Your request has been sent to HR Head and Admin.',
        'request' => profile_edit_format($row ?? []),
    ], 201);
}

function profile_edit_decide(PDO $pdo, array $sessionUser, array $body, bool $approve): void
{
    if (!profile_edit_can_approve($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only HR Head and Admin can decide edit requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $row = $id > 0 ? profile_edit_row($pdo, $id) : null;

    if ($row === null) {
        json_response([
            'success' => false,
            'message' => 'Edit request was not found.',
        ], 404);
    }

    if ($row['status'] === 'used') {
        json_response([
            'success' => false,
            'message' => 'That approval has already been used.',
            'request' => profile_edit_format($row),
        ], 422);
    }

    if ($row['status'] !== 'pending') {
        json_response([
            'success' => true,
            'message' => $row['status'] === 'approved'
                ? 'This request was already approved.'
                : 'This request was already declined.',
            'request' => profile_edit_format($row),
        ]);
    }

    $note = profile_edit_text($body['note'] ?? '');
    $status = $approve ? 'approved' : 'declined';

    $update = $pdo->prepare(
        'UPDATE profile_edit_requests
         SET status = :status,
             decided_by_user_id = :decider_id,
             decision_note = :note,
             decided_at = NOW()
         WHERE id = :id
           AND status = "pending"'
    );
    $update->execute([
        ':status' => $status,
        ':decider_id' => (int)($sessionUser['id'] ?? 0),
        ':note' => $note !== '' ? mb_substr($note, 0, PROFILE_EDIT_REASON_MAX) : null,
        ':id' => $id,
    ]);

    notify_users(
        $pdo,
        [(int)$row['requested_by_user_id']],
        $approve ? 'Personal details unlocked' : 'Personal details edit declined',
        $approve
            ? 'Your personal details are unlocked for editing. Open your Profile, make the correction '
                . 'and save — this approval covers one save.'
            : 'HR did not approve your request to edit your personal details.'
                . ($note !== '' ? ' Note: ' . $note : ''),
        PROFILE_EDIT_DECIDED_NOTIFICATION,
        (string)$id
    );

    write_auth_audit(
        $pdo,
        $sessionUser,
        $approve ? 'profile_edit.approved' : 'profile_edit.declined',
        $approve
            ? 'A personal details edit request was approved.'
            : 'A personal details edit request was declined.',
        [
            'module' => 'profile',
            'requestId' => $id,
            'employeeRecordId' => (int)$row['employee_record_id'],
            'decidedForUserId' => (int)$row['requested_by_user_id'],
            'reason' => profile_edit_text($row['reason'] ?? ''),
        ]
    );

    $requesterName = profile_edit_text($row['requester_name'] ?? '') ?: 'The requester';

    json_response([
        'success' => true,
        'message' => $approve
            ? $requesterName . ' can now edit their personal details.'
            : $requesterName . '\'s request was declined.',
        'request' => profile_edit_format(profile_edit_row($pdo, $id) ?? $row),
    ]);
}

/**
 * Spends the approval. Called by the requester once the section has saved, which is the only moment
 * the client can be sure the correction was actually written.
 */
function profile_edit_mark_used(PDO $pdo, array $sessionUser, array $body): void
{
    $id = (int)($body['id'] ?? 0);
    $row = $id > 0 ? profile_edit_row($pdo, $id) : null;

    if ($row === null) {
        json_response([
            'success' => false,
            'message' => 'Edit request was not found.',
        ], 404);
    }

    if ((int)$row['requested_by_user_id'] !== (int)($sessionUser['id'] ?? 0)) {
        json_response([
            'success' => false,
            'message' => 'You can only close your own edit request.',
        ], 403);
    }

    if ($row['status'] !== 'approved') {
        json_response([
            'success' => false,
            'message' => 'Only an approved edit request can be closed.',
            'request' => profile_edit_format($row),
        ], 422);
    }

    $update = $pdo->prepare(
        'UPDATE profile_edit_requests
         SET status = "used", used_at = NOW()
         WHERE id = :id
           AND status = "approved"'
    );
    $update->execute([':id' => $id]);

    write_auth_audit(
        $pdo,
        $sessionUser,
        'profile_edit.used',
        'An approved personal details edit was saved.',
        [
            'module' => 'profile',
            'requestId' => $id,
            'employeeRecordId' => (int)$row['employee_record_id'],
        ]
    );

    json_response([
        'success' => true,
        'message' => 'Personal details saved.',
        'request' => profile_edit_format(profile_edit_row($pdo, $id) ?? $row),
    ]);
}

try {
    ensure_profile_edit_request_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        profile_edit_status($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        $body = read_json_body();
        $action = profile_edit_text($body['action'] ?? '');

        if ($action === 'request') {
            profile_edit_create($pdo, $sessionUser, $body);
        }

        if ($action === 'approve') {
            profile_edit_decide($pdo, $sessionUser, $body, true);
        }

        if ($action === 'decline') {
            profile_edit_decide($pdo, $sessionUser, $body, false);
        }

        if ($action === 'mark_used') {
            profile_edit_mark_used($pdo, $sessionUser, $body);
        }

        json_response([
            'success' => false,
            'message' => 'Unknown action.',
        ], 422);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Profile edit request API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the edit request.',
    ], 500);
}
