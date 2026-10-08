<?php
declare(strict_types=1);

const MONETIZATION_APPROVAL_CHAIN = [
    'pending' => ['role' => 'hrstaff', 'next' => 'endorsed'],
    'endorsed' => ['role' => 'hrhead', 'next' => 'reviewed'],
    'reviewed' => ['role' => 'chief', 'next' => 'chief_reviewed'],
    'chief_reviewed' => ['role' => 'regionaldirector', 'next' => 'approved'],
];

function ensure_monetization_workflow(PDO $pdo): void
{
    $columns = $pdo->query('SHOW COLUMNS FROM leave_monetization_requests')->fetchAll(PDO::FETCH_ASSOC);
    $columnTypes = array_column($columns, 'Type', 'Field');
    if (strpos($columnTypes['status'] ?? '', "'endorsed'") === false
        || strpos($columnTypes['status'] ?? '', "'chief_reviewed'") === false) {
        $pdo->exec("ALTER TABLE leave_monetization_requests MODIFY status ENUM('pending','endorsed','reviewed','chief_reviewed','approved','rejected','cancelled') NOT NULL DEFAULT 'pending'");
    }
    foreach ([
        'endorsed_by_employee_id' => 'INT UNSIGNED NULL',
        'endorsed_at' => 'DATETIME NULL',
        'chief_reviewed_by_employee_id' => 'INT UNSIGNED NULL',
        'chief_reviewed_at' => 'DATETIME NULL',
    ] as $column => $type) {
        if (!isset($columnTypes[$column])) {
            $pdo->exec("ALTER TABLE leave_monetization_requests ADD COLUMN $column $type");
        }
    }
}

function monetization_is_division_desk(array $user): bool
{
    return user_role_key($user) === 'chief'
        || (user_role_key($user) === 'planningofficer'
            && (user_has_permission($user, 'leave', 'approve') || user_has_permission($user, 'leave', 'reject')));
}

function monetization_employee_has_role(PDO $pdo, int $employeeId, string $role): bool
{
    ensure_role_columns($pdo);
    $statement = $pdo->prepare('SELECT 1 FROM employees e
        INNER JOIN users u ON u.email COLLATE utf8mb4_unicode_ci = e.email COLLATE utf8mb4_unicode_ci AND u.is_archived = 0
        INNER JOIN roles r ON r.id = u.role_id
        WHERE e.id = :employee_id AND LOWER(REPLACE(r.name, " ", "")) <> "chiefadmin"
        AND (LOWER(REPLACE(r.name, " ", "")) = :role_name
          OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) = :base_role) LIMIT 1');
    $statement->execute([':employee_id' => $employeeId, ':role_name' => $role, ':base_role' => $role]);
    return (bool)$statement->fetchColumn();
}

function monetization_division_matches(PDO $pdo, int $employeeId, array $user): bool
{
    $viewerId = session_employee_record_id($pdo, $user);
    $statement = $pdo->prepare('SELECT 1 FROM employees applicant INNER JOIN employees viewer
        ON viewer.division_id = applicant.division_id
        WHERE applicant.id = :employee_id AND viewer.id = :viewer_id AND applicant.division_id IS NOT NULL');
    $statement->execute([':employee_id' => $employeeId, ':viewer_id' => $viewerId]);
    return (bool)$statement->fetchColumn();
}

function monetization_notify_next_desk(PDO $pdo, string $status, int $employeeId, int $id): void
{
    $role = MONETIZATION_APPROVAL_CHAIN[$status]['role'] ?? null;
    if ($role === null) return;
    $title = 'Leave Monetization Awaiting ' . match ($role) {
        'hrstaff' => 'Leave Credit Verification',
        'hrhead' => 'HR Head Approval',
        'chief' => 'Division Chief Review',
        default => 'Regional Director Approval',
    };
    $message = 'A leave monetization request is awaiting your action.';
    if ($role === 'chief') {
        ensure_role_columns($pdo);
        $statement = $pdo->prepare('SELECT DISTINCT u.id FROM employees applicant
            INNER JOIN employees chief ON chief.division_id = applicant.division_id AND chief.is_archived = 0
            INNER JOIN users u ON u.email COLLATE utf8mb4_unicode_ci = chief.email COLLATE utf8mb4_unicode_ci AND u.is_archived = 0
            INNER JOIN roles r ON r.id = u.role_id WHERE applicant.id = :employee_id
            AND LOWER(REPLACE(r.name, " ", "")) <> "chiefadmin"
            AND (LOWER(REPLACE(r.name, " ", "")) = "chief"
              OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) = "chief")');
        $statement->execute([':employee_id' => $employeeId]);
        notify_users($pdo, array_map('intval', array_column($statement->fetchAll(), 'id')), $title, $message, 'leave_monetization_submitted', (string)$id);
    } else {
        notify_roles($pdo, [$role], $title, $message, 'leave_monetization_submitted', (string)$id);
    }
}
