<?php
declare(strict_types=1);

/*
 * Personal-detail edit approvals reuse module_access_requests. The table already represents a
 * user asking an authorized role to unlock a capability, so this workflow needs no new schema.
 * Terminal rows get a different module key because the existing status enum only contains
 * `pending` and `granted`; that preserves the history while allowing a later request.
 */
const PROFILE_EDIT_REQUEST_KEY = 'profile_personal_details_edit';
const PROFILE_EDIT_REQUEST_USED_KEY = 'profile_personal_details_edit_used';
const PROFILE_EDIT_REQUEST_DECLINED_KEY = 'profile_personal_details_edit_declined';
const PROFILE_EDIT_REQUEST_LABEL = 'Personal Details';
const PROFILE_EDIT_APPROVER_ROLES = ['admin', 'hrhead'];
const PROFILE_EDIT_DIRECT_ROLES = ['admin'];

function profile_edit_request_keys(): array
{
    return [
        PROFILE_EDIT_REQUEST_KEY,
        PROFILE_EDIT_REQUEST_USED_KEY,
        PROFILE_EDIT_REQUEST_DECLINED_KEY,
    ];
}

function profile_edit_can_approve(array $user): bool
{
    return in_array(user_role_key($user), PROFILE_EDIT_APPROVER_ROLES, true);
}

function profile_edit_can_edit_directly(array $user): bool
{
    return in_array(user_role_key($user), PROFILE_EDIT_DIRECT_ROLES, true);
}

function profile_edit_request_row_by_id(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT r.id, r.user_id, r.module_key, r.module_label, r.status,
                r.decided_by_user_id, r.decided_at, r.created_at,
                u.username, u.email,
                COALESCE(
                    NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""),
                    u.username
                ) AS requester_name,
                e.id AS employee_record_id,
                e.employee_id AS employee_code,
                d.name AS designation_title,
                role.name AS role_name,
                COALESCE(
                    NULLIF(TRIM(CONCAT(COALESCE(de.first_name, ""), " ", COALESCE(de.last_name, ""))), ""),
                    du.username
                ) AS decided_by_name
         FROM module_access_requests r
         INNER JOIN users u ON u.id = r.user_id
         LEFT JOIN roles role ON role.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN users du ON du.id = r.decided_by_user_id
         LEFT JOIN employees de
            ON de.email COLLATE utf8mb4_unicode_ci = du.email COLLATE utf8mb4_unicode_ci
           AND de.is_archived = 0
         WHERE r.id = :id
           AND r.module_key IN (:active_key, :used_key, :declined_key)
         LIMIT 1'
    );
    $statement->execute([
        ':id' => $id,
        ':active_key' => PROFILE_EDIT_REQUEST_KEY,
        ':used_key' => PROFILE_EDIT_REQUEST_USED_KEY,
        ':declined_key' => PROFILE_EDIT_REQUEST_DECLINED_KEY,
    ]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : $row;
}

function profile_edit_request_active_for_user(PDO $pdo, int $userId): ?array
{
    if ($userId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM module_access_requests
         WHERE user_id = :user_id
           AND module_key = :module_key
           AND status IN ("pending", "granted")
         ORDER BY id DESC
         LIMIT 1'
    );
    $statement->execute([
        ':user_id' => $userId,
        ':module_key' => PROFILE_EDIT_REQUEST_KEY,
    ]);
    $id = (int)$statement->fetchColumn();

    return $id > 0 ? profile_edit_request_row_by_id($pdo, $id) : null;
}

function profile_edit_request_latest_for_user(PDO $pdo, int $userId): ?array
{
    if ($userId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM module_access_requests
         WHERE user_id = :user_id
           AND module_key IN (:active_key, :used_key, :declined_key)
         ORDER BY id DESC
         LIMIT 1'
    );
    $statement->execute([
        ':user_id' => $userId,
        ':active_key' => PROFILE_EDIT_REQUEST_KEY,
        ':used_key' => PROFILE_EDIT_REQUEST_USED_KEY,
        ':declined_key' => PROFILE_EDIT_REQUEST_DECLINED_KEY,
    ]);
    $id = (int)$statement->fetchColumn();

    return $id > 0 ? profile_edit_request_row_by_id($pdo, $id) : null;
}

/** Returns and locks the current approval when called inside an employee-update transaction. */
function profile_edit_request_approved_for_user(PDO $pdo, int $userId, bool $lock = false): ?array
{
    if ($userId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM module_access_requests
         WHERE user_id = :user_id
           AND module_key = :module_key
           AND status = "granted"
         ORDER BY id DESC
         LIMIT 1'
        . ($lock ? ' FOR UPDATE' : '')
    );
    $statement->execute([
        ':user_id' => $userId,
        ':module_key' => PROFILE_EDIT_REQUEST_KEY,
    ]);
    $id = (int)$statement->fetchColumn();

    return $id > 0 ? profile_edit_request_row_by_id($pdo, $id) : null;
}

function profile_edit_request_mark_used(PDO $pdo, int $id): bool
{
    $statement = $pdo->prepare(
        'UPDATE module_access_requests
         SET module_key = :used_key
         WHERE id = :id
           AND module_key = :active_key
           AND status = "granted"'
    );
    $statement->execute([
        ':used_key' => PROFILE_EDIT_REQUEST_USED_KEY,
        ':id' => $id,
        ':active_key' => PROFILE_EDIT_REQUEST_KEY,
    ]);

    return $statement->rowCount() === 1;
}
