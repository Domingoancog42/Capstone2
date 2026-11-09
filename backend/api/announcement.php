<?php
declare(strict_types=1);

/**
 * Calendar announcements and scheduled events.
 *
 * These used to live in the publisher's `localStorage`, which meant an announcement was only ever
 * visible in the browser that created it — every other role, including Employee, saw an empty
 * calendar. Storing them here is what makes a published announcement reach everyone; the change
 * feed (see the `announcement` topic in changes.php) is what makes it arrive without a reload.
 *
 * Announcements remain office-wide notices. Events can target all users or one role group, and the
 * GET response is filtered for the signed-in viewer. Writing is limited to the roles whose calendar
 * offers the "Create Event/Announcement" button.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

const ANNOUNCEMENT_MANAGER_ROLES = ['admin', 'hrhead', 'hrstaff'];

const CALENDAR_ENTRY_TYPES = ['announcement', 'event'];

const CALENDAR_AUDIENCE_LABELS = [
    'all' => 'All Users',
    'employees' => 'Employees',
    'admin' => 'Administrators',
    'hr' => 'HR Head and HR Staff',
    'chief' => 'Division Chiefs',
    'planningofficer' => 'Planning Officers',
    'regionaldirector' => 'Regional Director',
    'cashier' => 'Cashiers',
];

function announcement_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function ensure_announcements_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $ensured = true;

    // Provisioned outside any transaction, for the reason spelled out in ensure_audit_logs_table().
    ensure_audit_logs_table($pdo);

    try {
        if (!database_table_exists($pdo, 'announcements')) {
            $pdo->exec(
                'CREATE TABLE `announcements` (
                    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    `title` VARCHAR(200) NOT NULL,
                    `entry_type` VARCHAR(20) NOT NULL DEFAULT "announcement",
                    `start_date` DATE NOT NULL,
                    `start_time` TIME NULL DEFAULT NULL,
                    `end_date` DATE NOT NULL,
                    `end_time` TIME NULL DEFAULT NULL,
                    `audience` VARCHAR(40) NOT NULL DEFAULT "all",
                    `location` VARCHAR(255) NULL DEFAULT NULL,
                    `description` TEXT NULL DEFAULT NULL,
                    `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
                    `updated_at` TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                    PRIMARY KEY (`id`),
                    KEY `idx_announcements_start_date` (`start_date`),
                    KEY `idx_announcements_end_date` (`end_date`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );
        }

        $columns = [
            'entry_type' => 'VARCHAR(20) NOT NULL DEFAULT "announcement" AFTER `title`',
            'start_time' => 'TIME NULL DEFAULT NULL AFTER `start_date`',
            'end_time' => 'TIME NULL DEFAULT NULL AFTER `end_date`',
            'audience' => 'VARCHAR(40) NOT NULL DEFAULT "all" AFTER `end_time`',
            'location' => 'VARCHAR(255) NULL DEFAULT NULL AFTER `audience`',
        ];

        foreach ($columns as $column => $definition) {
            if (!database_column_exists($pdo, 'announcements', $column)) {
                $pdo->exec("ALTER TABLE `announcements` ADD COLUMN `{$column}` {$definition}");
            }
        }
    } catch (Throwable $exception) {
        // Another request may have won the schema migration race.
        error_log('Calendar entry table setup skipped: ' . $exception->getMessage());
    }
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
    $entryType = in_array(($row['entry_type'] ?? ''), CALENDAR_ENTRY_TYPES, true)
        ? (string)$row['entry_type']
        : 'announcement';
    $audience = array_key_exists((string)($row['audience'] ?? ''), CALENDAR_AUDIENCE_LABELS)
        ? (string)$row['audience']
        : 'all';

    return [
        'id' => (int)$row['id'],
        'entryType' => $entryType,
        'title' => (string)$row['title'],
        'startDate' => (string)$row['start_date'],
        'startTime' => substr((string)($row['start_time'] ?? ''), 0, 5),
        'endDate' => (string)$row['end_date'],
        'endTime' => substr((string)($row['end_time'] ?? ''), 0, 5),
        'audience' => $audience,
        'audienceLabel' => CALENDAR_AUDIENCE_LABELS[$audience],
        'location' => announcement_text($row['location'] ?? ''),
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

/** Returns an HTML time input value (`HH:MM`) or an empty string when invalid. */
function announcement_time(mixed $value): string
{
    $text = announcement_text($value);

    if (preg_match('/^(\d{2}):(\d{2})(?::\d{2})?$/', $text, $matches) !== 1) {
        return '';
    }

    $hour = (int)$matches[1];
    $minute = (int)$matches[2];

    return $hour <= 23 && $minute <= 59
        ? sprintf('%02d:%02d', $hour, $minute)
        : '';
}

function announcement_validate(array $body): array
{
    $entryType = strtolower(announcement_text($body['entryType'] ?? 'announcement'));
    $title = announcement_text($body['title'] ?? '');
    $startDate = announcement_date($body['startDate'] ?? '');
    $endDate = announcement_date($body['endDate'] ?? '');
    $startTime = announcement_time($body['startTime'] ?? '');
    $endTime = announcement_time($body['endTime'] ?? '');
    $audience = strtolower(announcement_text($body['audience'] ?? 'all'));
    $location = announcement_text($body['location'] ?? '');
    $errors = [];

    if (!in_array($entryType, CALENDAR_ENTRY_TYPES, true)) {
        $errors[] = 'Calendar entry type must be an announcement or event.';
        $entryType = 'announcement';
    }

    $entryLabel = $entryType === 'event' ? 'Event' : 'Announcement';

    if ($entryType === 'announcement') {
        $endDate = $startDate;
        $startTime = '';
        $endTime = '';
        $audience = 'all';
        $location = '';
    }

    if ($title === '') {
        $errors[] = $entryLabel . ' title is required.';
    } elseif (mb_strlen($title) > 200) {
        $errors[] = $entryLabel . ' title must not exceed 200 characters.';
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

    if ($entryType === 'event') {
        if ($startTime === '') {
            $errors[] = 'A valid start time is required.';
        }

        if ($endTime === '') {
            $errors[] = 'A valid end time is required.';
        }

        if (
            $startDate !== ''
            && $endDate !== ''
            && $startTime !== ''
            && $endTime !== ''
            && ($endDate . ' ' . $endTime) <= ($startDate . ' ' . $startTime)
        ) {
            $errors[] = 'Event end must be after its start.';
        }

        if (!array_key_exists($audience, CALENDAR_AUDIENCE_LABELS)) {
            $errors[] = 'Select a valid event audience.';
        }

        if ($location === '') {
            $errors[] = 'Event location is required.';
        } elseif (mb_strlen($location) > 255) {
            $errors[] = 'Event location must not exceed 255 characters.';
        }
    }

    return [
        'announcement' => [
            'entryType' => $entryType,
            'title' => $title,
            'startDate' => $startDate,
            'startTime' => $startTime,
            'endDate' => $endDate,
            'endTime' => $endTime,
            'audience' => $audience,
            'location' => $location,
            'description' => announcement_text($body['description'] ?? ''),
        ],
        'errors' => $errors,
    ];
}

function announcement_visible_to_user(array $row, array $sessionUser): bool
{
    $entryType = (string)($row['entry_type'] ?? 'announcement');
    $audience = (string)($row['audience'] ?? 'all');
    $viewerId = (int)($sessionUser['id'] ?? 0);

    // Announcements are office-wide, and publishers retain access to events they created.
    if (
        $entryType !== 'event'
        || $audience === 'all'
        || ($viewerId > 0 && $viewerId === (int)($row['created_by_user_id'] ?? 0))
    ) {
        return true;
    }

    $roleKey = user_role_key($sessionUser);

    return match ($audience) {
        'employees' => $roleKey === 'employee',
        'admin' => $roleKey === 'admin',
        'hr' => in_array($roleKey, ['hrhead', 'hrstaff'], true),
        'chief' => $roleKey === 'chief',
        'planningofficer' => $roleKey === 'planningofficer',
        'regionaldirector' => $roleKey === 'regionaldirector',
        'cashier' => $roleKey === 'cashier',
        default => false,
    };
}

function announcement_rows(PDO $pdo, array $sessionUser): array
{
    $statement = $pdo->query(
        'SELECT a.id, a.entry_type, a.title, a.start_date, a.start_time, a.end_date, a.end_time,
                a.audience, a.location, a.description, a.created_by_user_id, a.created_at, a.updated_at,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS created_by_name
         FROM announcements a
         LEFT JOIN users u ON u.id = a.created_by_user_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         ORDER BY a.start_date DESC, a.id DESC
         LIMIT 500'
    );

    return array_values(array_map(
        'announcement_format',
        array_filter(
            $statement->fetchAll(),
            static fn (array $row): bool => announcement_visible_to_user($row, $sessionUser)
        )
    ));
}

function announcement_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT a.id, a.entry_type, a.title, a.start_date, a.start_time, a.end_date, a.end_time,
                a.audience, a.location, a.description, a.created_by_user_id, a.created_at, a.updated_at,
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
        'INSERT INTO announcements
            (entry_type, title, start_date, start_time, end_date, end_time, audience, location, description, created_by_user_id)
         VALUES
            (:entry_type, :title, :start_date, :start_time, :end_date, :end_time, :audience, :location, :description, :created_by_user_id)'
    );
    $insert->execute([
        ':entry_type' => $announcement['entryType'],
        ':title' => $announcement['title'],
        ':start_date' => $announcement['startDate'],
        ':start_time' => $announcement['startTime'] !== '' ? $announcement['startTime'] : null,
        ':end_date' => $announcement['endDate'],
        ':end_time' => $announcement['endTime'] !== '' ? $announcement['endTime'] : null,
        ':audience' => $announcement['audience'],
        ':location' => $announcement['location'] !== '' ? $announcement['location'] : null,
        ':description' => $announcement['description'],
        ':created_by_user_id' => $userId > 0 ? $userId : null,
    ]);

    $id = (int)$pdo->lastInsertId();

    $entryLabel = $announcement['entryType'] === 'event' ? 'event' : 'announcement';

    write_auth_audit($pdo, $sessionUser, 'announcement.created', 'A calendar ' . $entryLabel . ' was created.', [
        'module' => 'calendar',
        'announcementId' => $id,
        'entryType' => $announcement['entryType'],
        'title' => $announcement['title'],
        'audience' => $announcement['audience'],
    ]);

    json_response([
        'success' => true,
        'message' => $announcement['entryType'] === 'event' ? 'Event created.' : 'Announcement published.',
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
         SET entry_type = :entry_type,
             title = :title,
             start_date = :start_date,
             start_time = :start_time,
             end_date = :end_date,
             end_time = :end_time,
             audience = :audience,
             location = :location,
             description = :description
         WHERE id = :id'
    );
    $update->execute([
        ':entry_type' => $announcement['entryType'],
        ':title' => $announcement['title'],
        ':start_date' => $announcement['startDate'],
        ':start_time' => $announcement['startTime'] !== '' ? $announcement['startTime'] : null,
        ':end_date' => $announcement['endDate'],
        ':end_time' => $announcement['endTime'] !== '' ? $announcement['endTime'] : null,
        ':audience' => $announcement['audience'],
        ':location' => $announcement['location'] !== '' ? $announcement['location'] : null,
        ':description' => $announcement['description'],
        ':id' => $id,
    ]);

    write_auth_audit($pdo, $sessionUser, 'announcement.updated', 'A calendar entry was updated.', [
        'module' => 'calendar',
        'announcementId' => $id,
        'entryType' => $announcement['entryType'],
        'title' => $announcement['title'],
    ]);

    json_response([
        'success' => true,
        'message' => $announcement['entryType'] === 'event' ? 'Event updated.' : 'Announcement updated.',
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

    write_auth_audit($pdo, $sessionUser, 'announcement.deleted', 'A calendar entry was removed.', [
        'module' => 'calendar',
        'announcementId' => $id,
        'title' => $existing['title'],
    ]);

    json_response([
        'success' => true,
        'message' => ($existing['entryType'] ?? 'announcement') === 'event' ? 'Event removed.' : 'Announcement removed.',
    ]);
}

try {
    ensure_announcements_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        json_response([
            'success' => true,
            'canManage' => announcement_can_manage($pdo, $sessionUser),
            'announcements' => announcement_rows($pdo, $sessionUser),
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
