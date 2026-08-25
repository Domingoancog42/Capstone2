<?php
declare(strict_types=1);

/**
 * Philippine holidays for the calendar.
 *
 * The `holidays` table has existed since the first schema and attendance.php already excludes its
 * dates when it counts workdays -- but nothing ever wrote to it, so the table sat empty and the
 * calendar had no holidays at all. This endpoint is the missing half.
 *
 * Two sources are merged into one list:
 *
 *  - The national holidays fixed in law (RA 9492 and the Administrative Code), generated in PHP for
 *    whatever year is asked for. Generating beats seeding rows because the movable ones -- Maundy
 *    Thursday, Good Friday, Black Saturday, National Heroes Day -- land on a different date every
 *    year, and a seeded 2026 row would quietly be wrong the moment somebody paged to 2027.
 *  - Rows stored in `holidays`, which cover everything a formula cannot know: the yearly Eid'l Fitr
 *    and Eid'l Adha proclamations, Chinese New Year, the additional special days a proclamation adds
 *    (Nov 2 and Dec 24 in most recent years), and local Region X holidays.
 *
 * A stored row on the same date wins, so an office can override a generated entry -- naming a
 * regular holiday differently, or marking one as a special working day -- without the generator
 * fighting it back.
 *
 * Reading is open to every signed-in user: the calendar shows holidays to all roles. Writing is
 * limited to the roles that manage the calendar, matching announcement.php.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

const HOLIDAY_MANAGER_ROLES = ['admin', 'hrhead', 'hrstaff'];

/** Mirrors the `type` enum on the table. */
const HOLIDAY_TYPES = ['regular', 'special_non_working', 'special_working'];

const HOLIDAY_TYPE_LABELS = [
    'regular' => 'Regular Holiday',
    'special_non_working' => 'Special (Non-Working) Day',
    'special_working' => 'Special (Working) Day',
];

/**
 * How far either side of the requested year the default range reaches.
 *
 * The calendar pages by month without refetching, so a caller that asks for nothing still gets last
 * year and next year -- enough that paging off the ends of the current year keeps showing holidays.
 */
const HOLIDAY_DEFAULT_YEAR_PADDING = 1;

/** Generating a decade at a time is cheap; generating a century because of a typo is not. */
const HOLIDAY_MAX_YEARS = 12;

function holiday_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

/**
 * `updated_at` is not in the original schema, and the change feed needs a column that moves when a
 * row is edited -- `created_at` only marks when it first appeared. Added on first request the way
 * the rest of the codebase handles schema drift (see ensure_archive_columns).
 */
function ensure_holidays_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $ensured = true;

    // Provisioned outside any transaction, for the reason spelled out in ensure_audit_logs_table().
    ensure_audit_logs_table($pdo);

    try {
        if (!database_table_exists($pdo, 'holidays')) {
            $pdo->exec(
                'CREATE TABLE `holidays` (
                    `holidays_id` INT(11) NOT NULL AUTO_INCREMENT,
                    `name` VARCHAR(150) NOT NULL,
                    `holiday_date` DATE NOT NULL,
                    `type` ENUM("regular","special_non_working","special_working") NOT NULL DEFAULT "regular",
                    `is_recurring` TINYINT(1) NOT NULL DEFAULT 0,
                    `created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
                    PRIMARY KEY (`holidays_id`),
                    UNIQUE KEY `holiday_date` (`holiday_date`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );
        }

        if (!database_column_exists($pdo, 'holidays', 'description')) {
            $pdo->exec('ALTER TABLE `holidays` ADD COLUMN `description` TEXT NULL DEFAULT NULL AFTER `name`');
        }

        if (!database_column_exists($pdo, 'holidays', 'updated_at')) {
            $pdo->exec(
                'ALTER TABLE `holidays`
                 ADD COLUMN `updated_at` TIMESTAMP NOT NULL
                 DEFAULT current_timestamp() ON UPDATE current_timestamp()'
            );
        }

        if (!database_column_exists($pdo, 'holidays', 'created_by_user_id')) {
            $pdo->exec('ALTER TABLE `holidays` ADD COLUMN `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL');
        }
    } catch (Throwable $exception) {
        // A parallel request that won the race has already applied this. Losing here is fine.
        error_log('Holiday table setup skipped: ' . $exception->getMessage());
    }
}

/**
 * Whether this user may manage holidays. Custom roles resolve through their base role, so a role
 * built on HR Staff can and one built on Employee cannot.
 */
function holiday_can_manage(PDO $pdo, array $sessionUser): bool
{
    $roleKey = user_role_key($sessionUser);

    if (in_array($roleKey, HOLIDAY_MANAGER_ROLES, true)) {
        return true;
    }

    return in_array(role_base_key($pdo, $roleKey), HOLIDAY_MANAGER_ROLES, true);
}

/** A calendar date is only ever `YYYY-MM-DD`; anything else is rejected rather than coerced. */
function holiday_date(mixed $value): string
{
    $text = holiday_text($value);

    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $text) !== 1) {
        return '';
    }

    [$year, $month, $day] = array_map('intval', explode('-', $text));

    return checkdate($month, $day, $year) ? $text : '';
}

function holiday_type(mixed $value): string
{
    $text = strtolower(holiday_text($value));

    return in_array($text, HOLIDAY_TYPES, true) ? $text : 'regular';
}

/**
 * Easter Sunday in the Gregorian calendar.
 *
 * Written out rather than using PHP's easter_date(): that lives in the ext/calendar extension, which
 * is not guaranteed to be enabled, and it returns a timestamp that would need the server timezone to
 * be right to land on the correct day.
 */
function holiday_easter_sunday(int $year): string
{
    $a = $year % 19;
    $b = intdiv($year, 100);
    $c = $year % 100;
    $d = intdiv($b, 4);
    $e = $b % 4;
    $f = intdiv($b + 8, 25);
    $g = intdiv($b - $f + 1, 3);
    $h = (19 * $a + $b - $d - $g + 15) % 30;
    $i = intdiv($c, 4);
    $k = $c % 4;
    $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
    $m = intdiv($a + 11 * $h + 22 * $l, 451);
    $month = intdiv($h + $l - 7 * $m + 114, 31);
    $day = (($h + $l - 7 * $m + 114) % 31) + 1;

    return sprintf('%04d-%02d-%02d', $year, $month, $day);
}

function holiday_shift_date(string $date, int $days): string
{
    $direction = $days >= 0 ? '+' : '-';

    return (new DateTimeImmutable($date))->modify($direction . abs($days) . ' days')->format('Y-m-d');
}

/**
 * The national holidays a formula can pin down for a given year.
 *
 * Eid'l Fitr and Eid'l Adha are deliberately absent: both follow the Islamic lunar calendar and are
 * fixed each year by a separate proclamation once the moon is sighted, so no formula gets them right
 * far enough ahead to be worth printing on a calendar. They are added as stored rows instead.
 */
function holiday_national_list(int $year): array
{
    $easter = holiday_easter_sunday($year);
    $lastMondayOfAugust = (new DateTimeImmutable(sprintf('%04d-08-01', $year)))
        ->modify('last monday of this month')
        ->format('Y-m-d');

    $entries = [
        // Regular holidays -- Republic Act 9492, as amended.
        [sprintf('%04d-01-01', $year), "New Year's Day", 'regular'],
        [holiday_shift_date($easter, -3), 'Maundy Thursday', 'regular'],
        [holiday_shift_date($easter, -2), 'Good Friday', 'regular'],
        [sprintf('%04d-04-09', $year), 'Araw ng Kagitingan', 'regular'],
        [sprintf('%04d-05-01', $year), 'Labor Day', 'regular'],
        [sprintf('%04d-06-12', $year), 'Independence Day', 'regular'],
        [$lastMondayOfAugust, 'National Heroes Day', 'regular'],
        [sprintf('%04d-11-30', $year), 'Bonifacio Day', 'regular'],
        [sprintf('%04d-12-25', $year), 'Christmas Day', 'regular'],
        [sprintf('%04d-12-30', $year), 'Rizal Day', 'regular'],

        // Special (non-working) days.
        [sprintf('%04d-02-25', $year), 'EDSA People Power Revolution Anniversary', 'special_non_working'],
        [holiday_shift_date($easter, -1), 'Black Saturday', 'special_non_working'],
        [sprintf('%04d-08-21', $year), 'Ninoy Aquino Day', 'special_non_working'],
        [sprintf('%04d-11-01', $year), "All Saints' Day", 'special_non_working'],
        [sprintf('%04d-12-08', $year), 'Feast of the Immaculate Conception of Mary', 'special_non_working'],
        [sprintf('%04d-12-31', $year), 'Last Day of the Year', 'special_non_working'],
    ];

    return array_map(static function (array $entry): array {
        return [
            // Stable across requests so React can key on it, and prefixed so it never collides with
            // a stored row's numeric id.
            'id' => 'national-' . $entry[0],
            'key' => 'national-' . $entry[0],
            'name' => $entry[1],
            'date' => $entry[0],
            'type' => $entry[2],
            'typeLabel' => HOLIDAY_TYPE_LABELS[$entry[2]],
            'description' => '',
            'isRecurring' => true,
            'source' => 'national',
            'editable' => false,
            'createdBy' => '',
            'createdAt' => '',
            'updatedAt' => '',
        ];
    }, $entries);
}

/**
 * A stored row, projected onto one year.
 *
 * A row flagged recurring keeps its month and day and takes the year it is being shown in, which is
 * the same rule attendance.php applies when it decides which days are not workdays.
 */
function holiday_format(array $row, ?int $year = null): array
{
    $type = holiday_type($row['type'] ?? 'regular');
    $date = (string)$row['holiday_date'];
    $isRecurring = (int)($row['is_recurring'] ?? 0) === 1;

    if ($isRecurring && $year !== null) {
        $date = sprintf('%04d', $year) . substr($date, 4);
    }

    $id = (int)$row['holidays_id'];

    return [
        'id' => $id,
        // A recurring row shows once per year, so its id repeats across the range. The date is what
        // keeps the React key unique.
        'key' => 'holiday-' . $id . '-' . $date,
        'name' => (string)$row['name'],
        'date' => $date,
        'type' => $type,
        'typeLabel' => HOLIDAY_TYPE_LABELS[$type],
        'description' => holiday_text($row['description'] ?? ''),
        'isRecurring' => $isRecurring,
        'source' => 'custom',
        'editable' => true,
        'createdBy' => holiday_text($row['created_by_name'] ?? ''),
        'createdAt' => (string)($row['created_at'] ?? ''),
        'updatedAt' => (string)($row['updated_at'] ?? ''),
    ];
}

function holiday_select_sql(string $where): string
{
    return
        'SELECT h.holidays_id, h.name, h.holiday_date, h.type, h.is_recurring, h.description,
                h.created_at, h.updated_at,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.last_name, ""))), ""), u.username) AS created_by_name
         FROM holidays h
         LEFT JOIN users u ON u.id = h.created_by_user_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         ' . $where;
}

function holiday_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(holiday_select_sql('WHERE h.holidays_id = :id LIMIT 1'));
    $statement->execute([':id' => $id]);
    $row = $statement->fetch();

    return $row === false ? null : holiday_format($row);
}

/** Every stored row that can fall inside the range, recurring ones included whatever year they carry. */
function holiday_stored_rows(PDO $pdo, string $startDate, string $endDate): array
{
    $statement = $pdo->prepare(holiday_select_sql(
        'WHERE h.holiday_date BETWEEN :start_date AND :end_date OR h.is_recurring = 1
         ORDER BY h.holiday_date ASC, h.holidays_id ASC
         LIMIT 1000'
    ));
    $statement->execute([
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return $statement->fetchAll();
}

/**
 * The merged list for a range: generated national holidays for every year it touches, with stored
 * rows laid over the top so a same-date override replaces rather than duplicates.
 */
function holiday_list(PDO $pdo, int $startYear, int $endYear, string $startDate, string $endDate): array
{
    $byDate = [];

    for ($year = $startYear; $year <= $endYear; $year++) {
        foreach (holiday_national_list($year) as $holiday) {
            $byDate[$holiday['date']] = $holiday;
        }
    }

    foreach (holiday_stored_rows($pdo, $startDate, $endDate) as $row) {
        $years = (int)($row['is_recurring'] ?? 0) === 1 ? range($startYear, $endYear) : [null];

        foreach ($years as $year) {
            $holiday = holiday_format($row, $year);
            $byDate[$holiday['date']] = $holiday;
        }
    }

    $holidays = array_values(array_filter(
        $byDate,
        static function (array $holiday) use ($startDate, $endDate): bool {
            return $holiday['date'] >= $startDate && $holiday['date'] <= $endDate;
        }
    ));

    usort($holidays, static function (array $left, array $right): int {
        return strcmp($left['date'], $right['date']);
    });

    return $holidays;
}

/**
 * The window a GET asks for: an explicit `start`/`end`, or a `year` (defaulting to today's) padded
 * on both sides. Anything unparseable falls back to the default rather than erroring, because a bad
 * query string should still leave the calendar with holidays on it.
 */
function holiday_requested_range(array $query): array
{
    $startDate = holiday_date($query['start'] ?? '');
    $endDate = holiday_date($query['end'] ?? '');

    if ($startDate !== '' && $endDate !== '' && $endDate >= $startDate) {
        $startYear = (int)substr($startDate, 0, 4);
        $endYear = (int)substr($endDate, 0, 4);

        if ($endYear - $startYear + 1 > HOLIDAY_MAX_YEARS) {
            $endYear = $startYear + HOLIDAY_MAX_YEARS - 1;
            $endDate = sprintf('%04d-12-31', $endYear);
        }

        return [$startYear, $endYear, $startDate, $endDate];
    }

    $year = (int)holiday_text($query['year'] ?? '');

    if ($year < 1900 || $year > 2999) {
        $year = (int)date('Y');
    }

    $startYear = $year - HOLIDAY_DEFAULT_YEAR_PADDING;
    $endYear = $year + HOLIDAY_DEFAULT_YEAR_PADDING;

    return [$startYear, $endYear, sprintf('%04d-01-01', $startYear), sprintf('%04d-12-31', $endYear)];
}

function holiday_validate(array $body): array
{
    $name = holiday_text($body['name'] ?? ($body['title'] ?? ''));
    $date = holiday_date($body['date'] ?? ($body['holidayDate'] ?? ''));
    $errors = [];

    if ($name === '') {
        $errors[] = 'Holiday name is required.';
    } elseif (mb_strlen($name) > 150) {
        $errors[] = 'Holiday name must not exceed 150 characters.';
    }

    if ($date === '') {
        $errors[] = 'A valid holiday date is required.';
    }

    return [
        'holiday' => [
            'name' => $name,
            'date' => $date,
            'type' => holiday_type($body['type'] ?? 'regular'),
            'description' => holiday_text($body['description'] ?? ''),
            'isRecurring' => empty($body['isRecurring']) ? 0 : 1,
        ],
        'errors' => $errors,
    ];
}

function holiday_require_manager(PDO $pdo, array $sessionUser): void
{
    if (holiday_can_manage($pdo, $sessionUser)) {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'You are not allowed to manage holidays.',
    ], 403);
}

/** The table keeps `holiday_date` unique, so a clash is a duplicate and not a server fault. */
function holiday_reject_duplicate_date(PDO $pdo, string $date, int $ignoreId = 0): void
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*) FROM holidays WHERE holiday_date = :holiday_date AND holidays_id <> :ignore_id'
    );
    $statement->execute([
        ':holiday_date' => $date,
        ':ignore_id' => $ignoreId,
    ]);

    if ((int)$statement->fetchColumn() > 0) {
        json_response([
            'success' => false,
            'message' => 'A holiday is already recorded on that date.',
        ], 409);
    }
}

function holiday_create(PDO $pdo, array $sessionUser, array $body): void
{
    holiday_require_manager($pdo, $sessionUser);

    ['holiday' => $holiday, 'errors' => $errors] = holiday_validate($body);

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => $errors[0],
            'errors' => $errors,
        ], 422);
    }

    holiday_reject_duplicate_date($pdo, $holiday['date']);

    $userId = (int)($sessionUser['id'] ?? 0);
    $insert = $pdo->prepare(
        'INSERT INTO holidays (name, description, holiday_date, type, is_recurring, created_by_user_id)
         VALUES (:name, :description, :holiday_date, :type, :is_recurring, :created_by_user_id)'
    );
    $insert->execute([
        ':name' => $holiday['name'],
        ':description' => $holiday['description'],
        ':holiday_date' => $holiday['date'],
        ':type' => $holiday['type'],
        ':is_recurring' => $holiday['isRecurring'],
        ':created_by_user_id' => $userId > 0 ? $userId : null,
    ]);

    $id = (int)$pdo->lastInsertId();

    write_auth_audit($pdo, $sessionUser, 'holiday.created', 'A holiday was added to the calendar.', [
        'module' => 'calendar',
        'holidayId' => $id,
        'name' => $holiday['name'],
        'date' => $holiday['date'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Holiday added.',
        'holiday' => holiday_row($pdo, $id),
    ], 201);
}

function holiday_update(PDO $pdo, array $sessionUser, array $body): void
{
    holiday_require_manager($pdo, $sessionUser);

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0 || holiday_row($pdo, $id) === null) {
        json_response([
            'success' => false,
            'message' => 'Holiday was not found.',
        ], 404);
    }

    ['holiday' => $holiday, 'errors' => $errors] = holiday_validate($body);

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => $errors[0],
            'errors' => $errors,
        ], 422);
    }

    holiday_reject_duplicate_date($pdo, $holiday['date'], $id);

    $update = $pdo->prepare(
        'UPDATE holidays
         SET name = :name,
             description = :description,
             holiday_date = :holiday_date,
             type = :type,
             is_recurring = :is_recurring
         WHERE holidays_id = :id'
    );
    $update->execute([
        ':name' => $holiday['name'],
        ':description' => $holiday['description'],
        ':holiday_date' => $holiday['date'],
        ':type' => $holiday['type'],
        ':is_recurring' => $holiday['isRecurring'],
        ':id' => $id,
    ]);

    write_auth_audit($pdo, $sessionUser, 'holiday.updated', 'A holiday was updated.', [
        'module' => 'calendar',
        'holidayId' => $id,
        'name' => $holiday['name'],
        'date' => $holiday['date'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Holiday updated.',
        'holiday' => holiday_row($pdo, $id),
    ]);
}

function holiday_delete(PDO $pdo, array $sessionUser, array $body): void
{
    holiday_require_manager($pdo, $sessionUser);

    $id = (int)($body['id'] ?? ($_GET['id'] ?? 0));
    $existing = $id > 0 ? holiday_row($pdo, $id) : null;

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Holiday was not found.',
        ], 404);
    }

    $delete = $pdo->prepare('DELETE FROM holidays WHERE holidays_id = :id');
    $delete->execute([':id' => $id]);

    write_auth_audit($pdo, $sessionUser, 'holiday.deleted', 'A holiday was removed from the calendar.', [
        'module' => 'calendar',
        'holidayId' => $id,
        'name' => $existing['name'],
        'date' => $existing['date'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Holiday removed.',
    ]);
}

try {
    ensure_holidays_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        [$startYear, $endYear, $startDate, $endDate] = holiday_requested_range($_GET);

        json_response([
            'success' => true,
            'canManage' => holiday_can_manage($pdo, $sessionUser),
            'range' => [
                'start' => $startDate,
                'end' => $endDate,
            ],
            'types' => array_map(static function (string $type): array {
                return ['value' => $type, 'label' => HOLIDAY_TYPE_LABELS[$type]];
            }, HOLIDAY_TYPES),
            'holidays' => holiday_list($pdo, $startYear, $endYear, $startDate, $endDate),
        ]);
    }

    if ($method === 'POST') {
        holiday_create($pdo, $sessionUser, read_json_body());
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        holiday_update($pdo, $sessionUser, read_json_body());
    }

    if ($method === 'DELETE') {
        holiday_delete($pdo, $sessionUser, read_json_body());
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Holiday API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the holiday request.',
    ], 500);
}
