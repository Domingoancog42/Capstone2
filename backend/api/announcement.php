<?php
declare(strict_types=1);

/**
 * Calendar announcements.
 *
 * These used to live in the publisher's `localStorage`, which meant an announcement was only ever
 * visible in the browser that created it — every other role, including Employee, saw an empty
 * calendar. Storing them here is what makes a published announcement reach everyone; the change
 * feed (see the `announcement` topic in changes.php) is what makes it arrive without a reload.
 *
 * Reading is open to every signed-in user: an announcement is an office-wide notice and the
 * calendar shows it to all roles. Writing is limited to the roles whose calendar offers the
 * "Add Announcement" button.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

const ANNOUNCEMENT_MANAGER_ROLES = ['admin', 'hrhead', 'hrstaff'];

function announcement_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function ensure_announcements_table(PDO $pdo): void
{
    // Provisioned outside any transaction, for the reason spelled out in ensure_audit_logs_table().
    ensure_audit_logs_table($pdo);
}

/**
 * Whether this user may publish. Custom roles resolve through their base role, so a role built on
 * HR Staff can publish and one built on Employee cannot.
 */
function announcement_can_manage(PDO $pdo, array $sessionUser): bool
{
    $roleKey = user_role_key($sessionUser);

    if (in_array($roleKey, ANNOUNCEMENT_MANAGER_ROLES, true)) {
        return true;
    }

    return in_array(role_base_key($pdo, $roleKey), ANNOUNCEMENT_MANAGER_ROLES, true);
}

function announcement_format(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'title' => (string)$row['title'],
        'startDate' => (string)$row['start_date'],
        'endDate' => (string)$row['end_date'],
        'description' => (string)($row['description'] ?? ''),
        'createdBy' => announcement_text($row['created_by_name'] ?? ''),
        'createdAt' => (string)($row['created_at'] ?? ''),
        'updatedAt' => (string)($row['updated_at'] ?? ''),
    ];
}

/** A calendar date is only ever `YYYY-MM-DD`; anything else is rejected rather than coerced. */
function announcement_date(mixed $value): string
{
    $text = announcement_text($value);

    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $text) !== 1) {
        return '';
    }

    [$year, $month, $day] = array_map('intval', explode('-', $text));

    return checkdate($month, $day, $year) ? $text : '';
}

function announcement_validate(array $body): array
{
    $title = announcement_text($body['title'] ?? '');
    $startDate = announcement_date($body['startDate'] ?? '');
    $endDate = announcement_date($body['endDate'] ?? '');
    $errors = [];

    if ($title === '') {
        $errors[] = 'Announcement title is required.';
    } elseif (mb_strlen($title) > 200) {
        $errors[] = 'Announcement title must not exceed 200 characters.';
    }

    if ($startDate === '') {
        $errors[] = 'A valid start date is required.';
    }

    if ($endDate === '') {
        $errors[] = 'A valid end date is required.';
    }

    if ($startDate !== '' && $endDate !== '' && $endDate < $startDate) {
        $errors[] = 'End date must be on or after the start date.';
    }

    return [
        'announcement' => [
            'title' => $title,
            'startDate' => $startDate,
            'endDate' => $endDate,
            'description' => announcement_text($body['description'] ?? ''),
        ],
        'errors' => $errors,
    ];
}

function announcement_rows(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT a.id, a.title, a.start_date, a.end_date, a.description, a.created_at, a.updated_at,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS created_by_name
         FROM announcements a
         LEFT JOIN users u ON u.id = a.created_by_user_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         ORDER BY a.start_date DESC, a.id DESC
         LIMIT 500'
    );

    return array_map('announcement_format', $statement->fetchAll());
}

function announcement_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT a.id, a.title, a.start_date, a.end_date, a.description, a.created_at, a.updated_at,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS created_by_name
         FROM announcements a
         LEFT JOIN users u ON u.id = a.created_by_user_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE a.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $row = $statement->fetch();

    return $row === false ? null : announcement_format($row);
}

function announcement_require_manager(PDO $pdo, array $sessionUser): void
{
    if (announcement_can_manage($pdo, $sessionUser)) {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'You are not allowed to manage calendar announcements.',
    ], 403);
}

function announcement_create(PDO $pdo, array $sessionUser, array $body): void
{
    announcement_require_manager($pdo, $sessionUser);

    ['announcement' => $announcement, 'errors' => $errors] = announcement_validate($body);

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => $errors[0],
            'errors' => $errors,
        ], 422);
    }

    $userId = (int)($sessionUser['id'] ?? 0);
    $insert = $pdo->prepare(
        'INSERT INTO announcements (title, start_date, end_date, description, created_by_user_id)
         VALUES (:title, :start_date, :end_date, :description, :created_by_user_id)'
    );
    $insert->execute([
        ':title' => $announcement['title'],
        ':start_date' => $announcement['startDate'],
        ':end_date' => $announcement['endDate'],
        ':description' => $announcement['description'],
        ':created_by_user_id' => $userId > 0 ? $userId : null,
    ]);

    $id = (int)$pdo->lastInsertId();

    write_auth_audit($pdo, $sessionUser, 'announcement.created', 'A calendar announcement was published.', [
        'module' => 'calendar',
        'announcementId' => $id,
        'title' => $announcement['title'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Announcement published.',
        'announcement' => announcement_row($pdo, $id),
    ], 201);
}

function announcement_update(PDO $pdo, array $sessionUser, array $body): void
{
    announcement_require_manager($pdo, $sessionUser);

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0 || announcement_row($pdo, $id) === null) {
        json_response([
            'success' => false,
            'message' => 'Announcement was not found.',
        ], 404);
    }

    ['announcement' => $announcement, 'errors' => $errors] = announcement_validate($body);

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => $errors[0],
            'errors' => $errors,
        ], 422);
    }

    $update = $pdo->prepare(
        'UPDATE announcements
         SET title = :title,
             start_date = :start_date,
             end_date = :end_date,
             description = :description
         WHERE id = :id'
    );
    $update->execute([
        ':title' => $announcement['title'],
        ':start_date' => $announcement['startDate'],
        ':end_date' => $announcement['endDate'],
        ':description' => $announcement['description'],
        ':id' => $id,
    ]);

    write_auth_audit($pdo, $sessionUser, 'announcement.updated', 'A calendar announcement was updated.', [
        'module' => 'calendar',
        'announcementId' => $id,
        'title' => $announcement['title'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Announcement updated.',
        'announcement' => announcement_row($pdo, $id),
    ]);
}

function announcement_delete(PDO $pdo, array $sessionUser, array $body): void
{
    announcement_require_manager($pdo, $sessionUser);

    $id = (int)($body['id'] ?? ($_GET['id'] ?? 0));
    $existing = $id > 0 ? announcement_row($pdo, $id) : null;

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Announcement was not found.',
        ], 404);
    }

    $delete = $pdo->prepare('DELETE FROM announcements WHERE id = :id');
    $delete->execute([':id' => $id]);

    write_auth_audit($pdo, $sessionUser, 'announcement.deleted', 'A calendar announcement was removed.', [
        'module' => 'calendar',
        'announcementId' => $id,
        'title' => $existing['title'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Announcement removed.',
    ]);
}

try {
    ensure_announcements_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        json_response([
            'success' => true,
            'canManage' => announcement_can_manage($pdo, $sessionUser),
            'announcements' => announcement_rows($pdo),
        ]);
    }

    if ($method === 'POST') {
        announcement_create($pdo, $sessionUser, read_json_body());
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        announcement_update($pdo, $sessionUser, read_json_body());
    }

    if ($method === 'DELETE') {
        announcement_delete($pdo, $sessionUser, read_json_body());
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Announcement API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the announcement request.',
    ], 500);
}
