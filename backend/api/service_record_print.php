<?php
declare(strict_types=1);

/**
 * Service record print requests.
 *
 * A certified CS Form No. 1 is issued by HR, not taken by the subject of it, so the self-service
 * screen asks instead of printing. The request goes to every HR Head and Admin as a notification;
 * approving it turns the requester's button into a real Print, and the change feed pushes that into
 * the browser they are already sitting in front of.
 *
 * One approval covers one copy. `mark_printed` closes the request as the print window opens, so a
 * second copy needs a second approval and every copy released leaves a row behind.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

/** Who may approve a print request. */
const SERVICE_RECORD_PRINT_APPROVER_ROLES = ['admin', 'hrhead'];

/**
 * Roles that maintain service records and issue the form from Employee Records. They print directly
 * and never queue a request — the list matches service_record_can_manage() in service_record.php.
 */
const SERVICE_RECORD_PRINT_MANAGER_ROLES = ['admin', 'hrhead', 'hrstaff'];

const SERVICE_RECORD_PRINT_REQUEST_NOTIFICATION = 'service_record_print_request';
const SERVICE_RECORD_PRINT_APPROVED_NOTIFICATION = 'service_record_print_approved';

function service_record_print_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function service_record_print_can_approve(array $user): bool
{
    return in_array(user_role_key($user), SERVICE_RECORD_PRINT_APPROVER_ROLES, true);
}

function service_record_print_can_print_directly(array $user): bool
{
    return in_array(user_role_key($user), SERVICE_RECORD_PRINT_MANAGER_ROLES, true);
}

function ensure_service_record_print_table(PDO $pdo): void
{
    /*
     * Called here, outside any transaction, for the same reason access_request.php does it:
     * MySQL commits implicitly when it sees DDL, so letting write_auth_audit() reach the
     * audit_logs column migration from inside a transaction would end that transaction early.
     */
    ensure_audit_logs_table($pdo);
}

/**
 * One request, with both people on it.
 *
 * The approver is joined in because they are the certifying officer on the copy that gets printed.
 * The employee pressing Print is the subject of the document, not its issuer — a CS Form No. 1
 * signed by the person it describes certifies nothing.
 */
function service_record_print_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT r.id, r.employee_record_id, r.requested_by_user_id, r.status,
                r.approved_at, r.printed_at, r.created_at,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS requester_name,
                e.employee_id AS employee_code,
                d.name AS designation_title,
                role.name AS role_name,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(ae.first_name, ""), " ", COALESCE(ae.last_name, ""))), ""), au.username) AS approver_name,
                ae.e_signature AS approver_signature
         FROM service_record_print_requests r
         INNER JOIN users u ON u.id = r.requested_by_user_id
         LEFT JOIN roles role ON role.id = u.role_id
         LEFT JOIN employees e ON e.id = r.employee_record_id
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN users au ON au.id = r.approved_by_user_id
         LEFT JOIN employees ae
            ON ae.email COLLATE utf8mb4_unicode_ci = au.email COLLATE utf8mb4_unicode_ci
           AND ae.is_archived = 0
         WHERE r.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : $row;
}

function service_record_print_format(array $row): array
{
    $status = (string)($row['status'] ?? '');

    return [
        'id' => (int)($row['id'] ?? 0),
        'employeeRecordId' => (int)($row['employee_record_id'] ?? 0),
        'requestedByUserId' => (int)($row['requested_by_user_id'] ?? 0),
        'status' => $status,
        'requesterName' => service_record_print_text($row['requester_name'] ?? ''),
        'requesterRole' => service_record_print_text($row['role_name'] ?? ''),
        'employeeCode' => service_record_print_text($row['employee_code'] ?? ''),
        'designationTitle' => service_record_print_text($row['designation_title'] ?? ''),
        'approverName' => service_record_print_text($row['approver_name'] ?? ''),
        /*
         * Only while the approval is live. The signature is a data URL of real size and it has no
         * business travelling with a request that is still pending or already spent.
         */
        'approverSignatureDataUrl' => $status === 'approved'
            ? service_record_print_text($row['approver_signature'] ?? '')
            : '',
        'createdAt' => (string)($row['created_at'] ?? ''),
        'approvedAt' => (string)($row['approved_at'] ?? ''),
        'printedAt' => (string)($row['printed_at'] ?? ''),
    ];
}

/**
 * The request that still has a bearing on the button: one waiting for HR, or one approved and not
 * yet spent. Used requests are history and deliberately fall out of this.
 */
function service_record_print_active(PDO $pdo, int $employeeRecordId): ?array
{
    if ($employeeRecordId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM service_record_print_requests
         WHERE employee_record_id = :employee_record_id
           AND status IN ("pending", "approved")
         ORDER BY id DESC
         LIMIT 1'
    );
    $statement->execute([':employee_record_id' => $employeeRecordId]);
    $id = (int)$statement->fetchColumn();

    return $id > 0 ? service_record_print_row($pdo, $id) : null;
}

function service_record_print_status(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? 0);
    $ownRecordId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);

    // A single request by id: what the notification detail view reads.
    if ($id > 0) {
        $row = service_record_print_row($pdo, $id);

        if ($row === null) {
            json_response([
                'success' => false,
                'message' => 'Print request was not found.',
            ], 404);
        }

        // Requesters may read their own; everything else is for the approvers.
        if (
            !service_record_print_can_approve($sessionUser)
            && (int)$row['requested_by_user_id'] !== (int)($sessionUser['id'] ?? 0)
        ) {
            json_response([
                'success' => false,
                'message' => 'You can only view your own print requests.',
            ], 403);
        }

        json_response([
            'success' => true,
            'request' => service_record_print_format($row),
        ]);
    }

    $employeeRecordId = (int)($_GET['employeeId'] ?? 0) ?: $ownRecordId;

    if ($employeeRecordId !== $ownRecordId && !service_record_print_can_approve($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You can only view your own print requests.',
        ], 403);
    }

    $row = service_record_print_active($pdo, $employeeRecordId);

    json_response([
        'success' => true,
        'canApprove' => service_record_print_can_approve($sessionUser),
        'canPrintDirectly' => service_record_print_can_print_directly($sessionUser),
        'request' => $row === null ? null : service_record_print_format($row),
    ]);
}

function service_record_print_create(PDO $pdo, array $sessionUser): void
{
    if (service_record_print_can_print_directly($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You can already print service records from Employee Records.',
        ], 422);
    }

    $employeeRecordId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);

    if ($employeeRecordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'No employee record is linked to this account.',
        ], 422);
    }

    // One open request at a time: pressing the button twice must not bury HR in duplicates.
    $existing = service_record_print_active($pdo, $employeeRecordId);

    if ($existing !== null) {
        json_response([
            'success' => true,
            'alreadyRequested' => true,
            'message' => $existing['status'] === 'approved'
                ? 'Your print request has already been approved.'
                : 'Your request is already waiting for HR Head or Admin approval.',
            'request' => service_record_print_format($existing),
        ]);
    }

    $insert = $pdo->prepare(
        'INSERT INTO service_record_print_requests (employee_record_id, requested_by_user_id)
         VALUES (:employee_record_id, :user_id)'
    );
    $insert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':user_id' => (int)($sessionUser['id'] ?? 0),
    ]);

    $requestId = (int)$pdo->lastInsertId();
    $row = service_record_print_row($pdo, $requestId);
    $requesterName = service_record_print_text($row['requester_name'] ?? ($sessionUser['username'] ?? 'An employee'));
    $employeeCode = service_record_print_text($row['employee_code'] ?? '');

    notify_roles(
        $pdo,
        SERVICE_RECORD_PRINT_APPROVER_ROLES,
        'Service record print requested',
        sprintf(
            '%s%s is asking for approval to print their service record (CS Form No. 1).',
            $requesterName,
            $employeeCode !== '' ? ' (' . $employeeCode . ')' : ''
        ),
        SERVICE_RECORD_PRINT_REQUEST_NOTIFICATION,
        (string)$requestId
    );

    write_auth_audit(
        $pdo,
        $sessionUser,
        'service_record_print.requested',
        'A service record print request was submitted.',
        [
            'module' => 'serviceRecord',
            'requestId' => $requestId,
            'employeeRecordId' => $employeeRecordId,
        ]
    );

    json_response([
        'success' => true,
        'message' => 'Your print request has been sent to HR Head and Admin.',
        'request' => service_record_print_format($row ?? []),
    ], 201);
}

function service_record_print_approve(PDO $pdo, array $sessionUser, array $body): void
{
    if (!service_record_print_can_approve($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only HR Head and Admin can approve print requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $row = $id > 0 ? service_record_print_row($pdo, $id) : null;

    if ($row === null) {
        json_response([
            'success' => false,
            'message' => 'Print request was not found.',
        ], 404);
    }

    if ($row['status'] === 'used') {
        json_response([
            'success' => false,
            'message' => 'That approval has already been used to print a copy.',
            'request' => service_record_print_format($row),
        ], 422);
    }

    if ($row['status'] === 'approved') {
        json_response([
            'success' => true,
            'message' => 'This request was already approved.',
            'request' => service_record_print_format($row),
        ]);
    }

    $update = $pdo->prepare(
        'UPDATE service_record_print_requests
         SET status = "approved", approved_by_user_id = :approver_id, approved_at = NOW()
         WHERE id = :id
           AND status = "pending"'
    );
    $update->execute([
        ':approver_id' => (int)($sessionUser['id'] ?? 0),
        ':id' => $id,
    ]);

    notify_users(
        $pdo,
        [(int)$row['requested_by_user_id']],
        'Service record print approved',
        'Your service record is ready to print. Open My Service Record and use the Print button — '
            . 'this approval covers one copy.',
        SERVICE_RECORD_PRINT_APPROVED_NOTIFICATION,
        (string)$id
    );

    write_auth_audit(
        $pdo,
        $sessionUser,
        'service_record_print.approved',
        'A service record print request was approved.',
        [
            'module' => 'serviceRecord',
            'requestId' => $id,
            'employeeRecordId' => (int)$row['employee_record_id'],
            'approvedForUserId' => (int)$row['requested_by_user_id'],
        ]
    );

    json_response([
        'success' => true,
        'message' => sprintf(
            '%s can now print their service record.',
            service_record_print_text($row['requester_name'] ?? '') ?: 'The requester'
        ),
        'request' => service_record_print_format(service_record_print_row($pdo, $id) ?? $row),
    ]);
}

/**
 * Spends the approval. Called by the requester as the print window opens, which is the only moment
 * the client can be sure a copy was actually produced.
 */
function service_record_print_mark_printed(PDO $pdo, array $sessionUser, array $body): void
{
    $id = (int)($body['id'] ?? 0);
    $row = $id > 0 ? service_record_print_row($pdo, $id) : null;

    if ($row === null) {
        json_response([
            'success' => false,
            'message' => 'Print request was not found.',
        ], 404);
    }

    if ((int)$row['requested_by_user_id'] !== (int)($sessionUser['id'] ?? 0)) {
        json_response([
            'success' => false,
            'message' => 'You can only close your own print request.',
        ], 403);
    }

    if ($row['status'] !== 'approved') {
        json_response([
            'success' => false,
            'message' => 'Only an approved print request can be marked as printed.',
            'request' => service_record_print_format($row),
        ], 422);
    }

    $update = $pdo->prepare(
        'UPDATE service_record_print_requests
         SET status = "used", printed_at = NOW()
         WHERE id = :id
           AND status = "approved"'
    );
    $update->execute([':id' => $id]);

    write_auth_audit(
        $pdo,
        $sessionUser,
        'service_record_print.printed',
        'An approved service record copy was printed.',
        [
            'module' => 'serviceRecord',
            'requestId' => $id,
            'employeeRecordId' => (int)$row['employee_record_id'],
        ]
    );

    json_response([
        'success' => true,
        'message' => 'Service record printed.',
        'request' => service_record_print_format(service_record_print_row($pdo, $id) ?? $row),
    ]);
}

try {
    ensure_service_record_print_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        service_record_print_status($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        $body = read_json_body();
        $action = service_record_print_text($body['action'] ?? '');

        if ($action === 'request') {
            service_record_print_create($pdo, $sessionUser);
        }

        if ($action === 'approve') {
            service_record_print_approve($pdo, $sessionUser, $body);
        }

        if ($action === 'mark_printed') {
            service_record_print_mark_printed($pdo, $sessionUser, $body);
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
    error_log('Service record print request API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the print request.',
    ], 500);
}
