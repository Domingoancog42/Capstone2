<?php
declare(strict_types=1);

/*
 * Personal Details edit approval.
 *
 * No feature-specific table is created here. Requests are stored in the existing
 * module_access_requests table using the keys declared in profile-edit-request-utils.php.
 */
require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/profile-edit-request-utils.php';

$sessionUser = require_session_user();

const PROFILE_EDIT_REQUEST_NOTIFICATION = 'profile_edit_request';
const PROFILE_EDIT_DECISION_NOTIFICATION = 'profile_edit_approved';

function profile_edit_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function profile_edit_status_from_row(array $row): string
{
    $key = (string)($row['module_key'] ?? '');

    if ($key === PROFILE_EDIT_REQUEST_USED_KEY) {
        return 'used';
    }

    if ($key === PROFILE_EDIT_REQUEST_DECLINED_KEY) {
        return 'declined';
    }

    return ($row['status'] ?? '') === 'granted' ? 'approved' : 'pending';
}

function profile_edit_format(array $row): array
{
    return [
        'id' => (int)($row['id'] ?? 0),
        'employeeRecordId' => (int)($row['employee_record_id'] ?? 0),
        'requestedByUserId' => (int)($row['user_id'] ?? 0),
        'section' => 'personal',
        'status' => profile_edit_status_from_row($row),
        'requesterName' => profile_edit_text($row['requester_name'] ?? ''),
        'requesterRole' => profile_edit_text($row['role_name'] ?? ''),
        'employeeCode' => profile_edit_text($row['employee_code'] ?? ''),
        'designationTitle' => profile_edit_text($row['designation_title'] ?? ''),
        'decidedByName' => profile_edit_text($row['decided_by_name'] ?? ''),
        'createdAt' => (string)($row['created_at'] ?? ''),
        'decidedAt' => (string)($row['decided_at'] ?? ''),
    ];
}

function profile_edit_status(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? 0);

    if ($id > 0) {
        $row = profile_edit_request_row_by_id($pdo, $id);

        if ($row === null) {
            json_response(['success' => false, 'message' => 'Edit request was not found.'], 404);
        }

        if (
            !profile_edit_can_approve($sessionUser)
            && (int)$row['user_id'] !== (int)($sessionUser['id'] ?? 0)
        ) {
            json_response(['success' => false, 'message' => 'You can only view your own edit requests.'], 403);
        }

        json_response(['success' => true, 'request' => profile_edit_format($row)]);
    }

    $userId = (int)($sessionUser['id'] ?? 0);
    $row = profile_edit_request_active_for_user($pdo, $userId)
        ?? profile_edit_request_latest_for_user($pdo, $userId);

    json_response([
        'success' => true,
        'canApprove' => profile_edit_can_approve($sessionUser),
        'canEditDirectly' => profile_edit_can_edit_directly($sessionUser),
        'request' => $row === null ? null : profile_edit_format($row),
    ]);
}

function profile_edit_create(PDO $pdo, array $sessionUser): void
{
    if (profile_edit_can_edit_directly($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You can already edit personal details directly.',
        ], 422);
    }

    $userId = (int)($sessionUser['id'] ?? 0);
    $employeeRecordId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);

    if ($employeeRecordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'No employee record is linked to this account.',
        ], 422);
    }

    $existing = profile_edit_request_active_for_user($pdo, $userId);

    if ($existing !== null) {
        $status = profile_edit_status_from_row($existing);
        json_response([
            'success' => true,
            'alreadyRequested' => true,
            'message' => $status === 'approved'
                ? 'Your edit request has already been approved.'
                : 'Your request is already waiting for Admin or HR Head approval.',
            'request' => profile_edit_format($existing),
        ]);
    }

    $insert = $pdo->prepare(
        'INSERT INTO module_access_requests (user_id, module_key, module_label)
         VALUES (:user_id, :module_key, :module_label)'
    );
    $insert->execute([
        ':user_id' => $userId,
        ':module_key' => PROFILE_EDIT_REQUEST_KEY,
        ':module_label' => PROFILE_EDIT_REQUEST_LABEL,
    ]);

    $requestId = (int)$pdo->lastInsertId();
    $row = profile_edit_request_row_by_id($pdo, $requestId);
    $requesterName = profile_edit_text($row['requester_name'] ?? ($sessionUser['username'] ?? 'An employee'));
    $employeeCode = profile_edit_text($row['employee_code'] ?? '');

    notify_roles(
        $pdo,
        PROFILE_EDIT_APPROVER_ROLES,
        'Personal details edit requested',
        sprintf(
            '%s%s is asking for permission to edit their personal details.',
            $requesterName,
            $employeeCode !== '' ? ' (' . $employeeCode . ')' : ''
        ),
        PROFILE_EDIT_REQUEST_NOTIFICATION,
        (string)$requestId
    );

    write_auth_audit($pdo, $sessionUser, 'profile_edit.requested', 'A personal details edit request was submitted.', [
        'module' => 'profile',
        'requestId' => $requestId,
        'employeeRecordId' => $employeeRecordId,
    ]);

    json_response([
        'success' => true,
        'message' => 'Your request has been sent to Admin and HR Head.',
        'request' => profile_edit_format($row ?? []),
    ], 201);
}

function profile_edit_decide(PDO $pdo, array $sessionUser, array $body, bool $approve): void
{
    if (!profile_edit_can_approve($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only Admin and HR Head can decide edit requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $row = $id > 0 ? profile_edit_request_row_by_id($pdo, $id) : null;

    if ($row === null) {
        json_response(['success' => false, 'message' => 'Edit request was not found.'], 404);
    }

    if ((int)$row['user_id'] === (int)($sessionUser['id'] ?? 0)) {
        json_response([
            'success' => false,
            'message' => 'Another Admin or HR Head must decide your own edit request.',
        ], 403);
    }

    $currentStatus = profile_edit_status_from_row($row);
    if ($currentStatus !== 'pending') {
        json_response([
            'success' => true,
            'message' => $currentStatus === 'approved'
                ? 'This request was already approved.'
                : 'This request has already been decided.',
            'request' => profile_edit_format($row),
        ]);
    }

    if ($approve) {
        $update = $pdo->prepare(
            'UPDATE module_access_requests
             SET status = "granted", decided_by_user_id = :decider_id, decided_at = NOW()
             WHERE id = :id AND module_key = :module_key AND status = "pending"'
        );
        $update->execute([
            ':decider_id' => (int)($sessionUser['id'] ?? 0),
            ':id' => $id,
            ':module_key' => PROFILE_EDIT_REQUEST_KEY,
        ]);
    } else {
        $update = $pdo->prepare(
            'UPDATE module_access_requests
             SET module_key = :declined_key, decided_by_user_id = :decider_id, decided_at = NOW()
             WHERE id = :id AND module_key = :active_key AND status = "pending"'
        );
        $update->execute([
            ':declined_key' => PROFILE_EDIT_REQUEST_DECLINED_KEY,
            ':decider_id' => (int)($sessionUser['id'] ?? 0),
            ':id' => $id,
            ':active_key' => PROFILE_EDIT_REQUEST_KEY,
        ]);
    }

    // Another approver may have decided the same notification moments earlier.
    if ($update->rowCount() !== 1) {
        $current = profile_edit_request_row_by_id($pdo, $id) ?? $row;
        json_response([
            'success' => true,
            'message' => 'This request has already been decided.',
            'request' => profile_edit_format($current),
        ]);
    }

    notify_users(
        $pdo,
        [(int)$row['user_id']],
        $approve ? 'Personal details editing approved' : 'Personal details edit declined',
        $approve
            ? 'Admin or HR Head approved your request. Open Personal Details, make the correction, and save it.'
            : 'Admin or HR Head declined your request to edit Personal Details.',
        PROFILE_EDIT_DECISION_NOTIFICATION,
        (string)$id
    );

    write_auth_audit(
        $pdo,
        $sessionUser,
        $approve ? 'profile_edit.approved' : 'profile_edit.declined',
        $approve ? 'A personal details edit request was approved.' : 'A personal details edit request was declined.',
        [
            'module' => 'profile',
            'requestId' => $id,
            'employeeRecordId' => (int)($row['employee_record_id'] ?? 0),
            'decidedForUserId' => (int)$row['user_id'],
        ]
    );

    $updated = profile_edit_request_row_by_id($pdo, $id) ?? $row;
    json_response([
        'success' => true,
        'message' => $approve
            ? ($row['requester_name'] ?? 'The requester') . ' can now edit Personal Details.'
            : 'The edit request was declined.',
        'request' => profile_edit_format($updated),
    ]);
}

try {
    // This only maintains the pre-existing audit table used throughout the application.
    ensure_audit_logs_table($pdo);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        profile_edit_status($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        $body = read_json_body();
        $action = profile_edit_text($body['action'] ?? '');

        if ($action === 'request') {
            profile_edit_create($pdo, $sessionUser);
        }

        if ($action === 'approve') {
            profile_edit_decide($pdo, $sessionUser, $body, true);
        }

        if ($action === 'decline') {
            profile_edit_decide($pdo, $sessionUser, $body, false);
        }

        json_response(['success' => false, 'message' => 'Unknown action.'], 422);
    }

    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
} catch (Throwable $exception) {
    error_log('Profile edit request API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the edit request.',
    ], 500);
}
