<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/xlsx-reader.php';
require_once __DIR__ . '/payroll-export.php';

date_default_timezone_set('Asia/Manila');

$sessionUser = require_session_user();

function attendance_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function attendance_allowed_daily_statuses(): array
{
    return ['Present', 'Late', 'Incomplete', 'Absent', 'Leave with Pay', 'Leave Without Pay'];
}

function attendance_normalize_daily_status(mixed $value): ?string
{
    $text = attendance_text($value);
    foreach (attendance_allowed_daily_statuses() as $status) {
        if (strcasecmp($text, $status) === 0) {
            return $status;
        }
    }

    return null;
}

function attendance_role_key(array $user): string
{
    return user_role_key($user);
}

/*
 * The desks whose attendance records and DTRs are confined to their own division. The
 * Chief and Planning Officer read theirs, while HR desks work organization-wide. Mirrors
 * DIVISION_SCOPED_ATTENDANCE_ROLE_KEYS in AttendanceManagementWorkspace.jsx. Importing the DAT
 * file is not scoped: the biometric log covers the whole office.
 */
const ATTENDANCE_DIVISION_SCOPED_ROLES = ['chief', 'planningofficer'];

/** Importing the biometric DAT file is HR Staff's job; the other HR roles review what it produced. */
function attendance_can_import(array $user): bool
{
    return attendance_role_key($user) === 'hrstaff';
}

/** The import trail is a management record, so every role that manages attendance may read it. */
function attendance_can_view_import_history(array $user): bool
{
    return in_array(attendance_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

/**
 * One row per import run, written in the same transaction as the punches it describes. The
 * importer's name is snapshotted because the user row can be deleted (the FK nulls out) and the
 * trail must still say who ran the import. Created lazily like payroll's tracking tables; note
 * MySQL commits implicitly on DDL, so this must run before any transaction is opened.
 */
function attendance_ensure_import_history_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS attendance_imports (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            file_name VARCHAR(255) NOT NULL,
            pay_period VARCHAR(20) NULL,
            date_from DATE NULL,
            date_to DATE NULL,
            total_rows INT UNSIGNED NOT NULL DEFAULT 0,
            total_imported INT UNSIGNED NOT NULL DEFAULT 0,
            duplicates_skipped INT UNSIGNED NOT NULL DEFAULT 0,
            invalid_rows INT UNSIGNED NOT NULL DEFAULT 0,
            outside_cutoff_rows INT UNSIGNED NOT NULL DEFAULT 0,
            successful_records INT UNSIGNED NOT NULL DEFAULT 0,
            absent_records_created INT UNSIGNED NOT NULL DEFAULT 0,
            leave_records_created INT UNSIGNED NOT NULL DEFAULT 0,
            imported_by_user_id INT UNSIGNED NULL,
            imported_by_name VARCHAR(180) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_attendance_imports_created_at (created_at),
            KEY idx_attendance_imports_period (date_from, date_to),
            CONSTRAINT fk_attendance_imports_user FOREIGN KEY (imported_by_user_id) REFERENCES users(id)
                ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $ensured = true;
}

/**
 * The cut-off an import is fenced to, from the multipart fields the importer sends alongside the
 * file. Null when none was sent; a 422 when one was sent but does not describe a usable range.
 *
 * @return array{payPeriod: string, dateFrom: string, dateTo: string}|null
 */
function attendance_import_cutoff_from_request(): ?array
{
    $dateFromText = attendance_text($_POST['dateFrom'] ?? '');
    $dateToText = attendance_text($_POST['dateTo'] ?? '');

    if ($dateFromText === '' && $dateToText === '') {
        return null;
    }

    $dateFrom = attendance_date_or_null($dateFromText);
    $dateTo = attendance_date_or_null($dateToText);

    if ($dateFrom === null || $dateTo === null || $dateFrom > $dateTo) {
        json_response([
            'success' => false,
            'message' => 'Choose a valid cut-off range to import.',
        ], 422);
    }

    $payPeriod = attendance_text($_POST['payPeriod'] ?? '');

    return [
        'payPeriod' => in_array($payPeriod, ['1st Half', '2nd Half', 'Monthly'], true) ? $payPeriod : '',
        'dateFrom' => $dateFrom,
        'dateTo' => $dateTo,
    ];
}

/** "September 2026 · 1st Half" for a cut-off inside one month, else the bare date range. */
function attendance_import_cutoff_label(array $cutoff): string
{
    $start = DateTimeImmutable::createFromFormat('Y-m-d', $cutoff['dateFrom']);
    $sameMonth = $start !== false && substr($cutoff['dateFrom'], 0, 7) === substr($cutoff['dateTo'], 0, 7);

    if ($sameMonth && $cutoff['payPeriod'] !== '') {
        return $start->format('F Y') . ' · ' . $cutoff['payPeriod'];
    }

    return $cutoff['dateFrom'] . ' to ' . $cutoff['dateTo'];
}

function attendance_can_edit(array $user): bool
{
    return in_array(attendance_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

/**
 * The shared attendance workspace is also used by every role's "My Attendance" screen.
 * The visual mode is a client-side concern, so that screen sends an explicit personal scope and
 * the API resolves the employee from the authenticated session instead of trusting an employee ID.
 */
function attendance_personal_scope_requested(): bool
{
    return strtolower(attendance_text($_GET['scope'] ?? '')) === 'personal';
}

function attendance_date_or_null(mixed $value): ?string
{
    $text = attendance_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function attendance_month_or_current(mixed $value): string
{
    $text = attendance_text($value);
    if (preg_match('/^\d{4}-\d{2}$/', $text) === 1) {
        return $text;
    }

    return date('Y-m');
}

function attendance_database_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );
    $statement->execute([':table_name' => $table]);

    return (int)$statement->fetchColumn() > 0;
}

function attendance_parse_datetime(mixed $value): ?DateTimeImmutable
{
    $text = attendance_text($value);
    if ($text === '') {
        return null;
    }

    $timezone = new DateTimeZone('Asia/Manila');

    /* XLSX stores real date/time cells as days since 1899-12-30. The lightweight workbook reader
       returns that raw number, so translate it before trying the usual text formats. */
    if (preg_match('/^\d{1,7}(?:\.\d+)?$/', $text) === 1) {
        $serial = (float)$text;
        if ($serial >= 1 && $serial <= 2_958_465) {
            $wholeDays = (int)floor($serial);
            $seconds = (int)round(($serial - $wholeDays) * 86_400);
            return (new DateTimeImmutable('1899-12-30 00:00:00', $timezone))
                ->modify('+' . $wholeDays . ' days')
                ->modify('+' . $seconds . ' seconds');
        }
    }

    $formats = [
        'Y-m-d H:i:s',
        'Y-m-d H:i',
        'Y-m-d\TH:i:s',
        'Y-m-d\TH:i',
        'm/d/Y H:i:s',
        'm/d/Y H:i',
        'm/d/y H:i:s',
        'm/d/y H:i',
        'm/d/Y h:i:s A',
        'm/d/Y h:i A',
        'm/d/y h:i:s A',
        'm/d/y h:i A',
        'd/m/Y H:i:s',
        'd/m/Y H:i',
        'd/m/Y h:i:s A',
        'd/m/Y h:i A',
        'M d Y h:i A',
        'F d Y h:i A',
    ];

    foreach ($formats as $format) {
        $date = DateTimeImmutable::createFromFormat($format, $text, $timezone);
        $errors = DateTimeImmutable::getLastErrors();

        if ($date instanceof DateTimeImmutable && ($errors === false || (($errors['warning_count'] ?? 0) === 0 && ($errors['error_count'] ?? 0) === 0))) {
            return $date;
        }
    }

    $timestamp = strtotime($text);
    if ($timestamp === false) {
        return null;
    }

    return (new DateTimeImmutable('@' . $timestamp))->setTimezone($timezone);
}

function attendance_datetime_for_date(?string $value, string $date): ?string
{
    $text = attendance_text($value);
    if ($text === '') {
        return null;
    }

    if (preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $text) === 1) {
        $text = $date . ' ' . $text;
    }

    $dateTime = attendance_parse_datetime($text);
    return $dateTime ? $dateTime->format('Y-m-d H:i:s') : null;
}

function attendance_normalize_punch_state(array $row): string
{
    $stateColumns = array_slice($row, 2, 4);
    $joinedState = trim(implode(' ', array_map(static fn ($value): string => attendance_text($value), $stateColumns)));

    if ($joinedState === '' && isset($row[2])) {
        $joinedState = attendance_text($row[2]);
    }

    $binaryOnly = preg_replace('/[^01]/', '', $joinedState);
    if (is_string($binaryOnly) && strlen($binaryOnly) === 4) {
        return implode(' ', str_split($binaryOnly));
    }

    $tokens = preg_split('/[\s,;|]+/', $joinedState);
    $tokens = array_values(array_filter(
        array_map(static fn ($value): string => attendance_text($value), $tokens ?: []),
        static fn (string $value): bool => $value === '0' || $value === '1'
    ));

    return count($tokens) >= 4 ? implode(' ', array_slice($tokens, 0, 4)) : '';
}

function attendance_punch_type_from_state(string $state): ?string
{
    return match ($state) {
        '1 0 1 0' => 'time_in',
        '1 1 1 0' => 'time_out',
        default => null,
    };
}

function attendance_client_punch_type(string $type): string
{
    return $type === 'time_out' ? 'TIME OUT' : 'TIME IN';
}

function attendance_mysql_datetime(?DateTimeImmutable $value): ?string
{
    return $value ? $value->format('Y-m-d H:i:s') : null;
}

function attendance_minutes_between(DateTimeImmutable $start, DateTimeImmutable $end): int
{
    return max(0, (int)floor(($end->getTimestamp() - $start->getTimestamp()) / 60));
}

function attendance_empty_daily_punches(): array
{
    return [
        'amTimeIn' => null,
        'amTimeOut' => null,
        'pmTimeIn' => null,
        'pmTimeOut' => null,
        'hasMiddlePunches' => false,
    ];
}

function attendance_classify_daily_punches(array $logs): array
{
    $punches = attendance_empty_daily_punches();
    $timeIns = [];
    $timeOuts = [];

    foreach ($logs as $log) {
        $punchAt = attendance_text($log['punchAt'] ?? $log['punch_at'] ?? '');
        if ($punchAt === '') {
            continue;
        }

        if (($log['punchType'] ?? $log['punch_type'] ?? '') === 'time_in') {
            $timeIns[] = $punchAt;
        } elseif (($log['punchType'] ?? $log['punch_type'] ?? '') === 'time_out') {
            $timeOuts[] = $punchAt;
        }
    }

    sort($timeIns);
    sort($timeOuts);

    $punches['amTimeIn'] = $timeIns[0] ?? null;
    $punches['pmTimeOut'] = $timeOuts ? $timeOuts[count($timeOuts) - 1] : null;
    $punches['hasMiddlePunches'] = count($timeIns) >= 2 || count($timeOuts) >= 2;

    if (!$punches['hasMiddlePunches']) {
        return $punches;
    }

    foreach ($timeOuts as $timeOut) {
        if ($punches['amTimeIn'] === null || $timeOut > $punches['amTimeIn']) {
            $punches['amTimeOut'] = $timeOut;
            break;
        }
    }

    foreach ($timeIns as $timeIn) {
        if ($punches['amTimeOut'] === null || $timeIn > $punches['amTimeOut']) {
            if ($timeIn !== $punches['amTimeIn']) {
                $punches['pmTimeIn'] = $timeIn;
                break;
            }
        }
    }

    if ($punches['pmTimeIn'] !== null) {
        foreach ($timeOuts as $timeOut) {
            if ($timeOut > $punches['pmTimeIn']) {
                $punches['pmTimeOut'] = $timeOut;
            }
        }
    }

    return $punches;
}

function attendance_session_minutes(?DateTimeImmutable $start, ?DateTimeImmutable $end): int
{
    if (!$start || !$end || $end <= $start) {
        return 0;
    }

    return attendance_minutes_between($start, $end);
}

function attendance_calculate_daily_metrics(string $date, ?string $timeIn, ?string $timeOut, ?array $dailyPunches = null): array
{
    $timezone = new DateTimeZone('Asia/Manila');
    $dailyPunches ??= attendance_empty_daily_punches();
    $timeIn = $timeIn ?: ($dailyPunches['amTimeIn'] ?? null);
    $timeOut = $timeOut ?: ($dailyPunches['pmTimeOut'] ?? null);
    $timeInDate = $timeIn ? attendance_parse_datetime($timeIn) : null;
    $timeOutDate = $timeOut ? attendance_parse_datetime($timeOut) : null;
    $amTimeInDate = attendance_parse_datetime($dailyPunches['amTimeIn'] ?? $timeIn);
    $amTimeOutDate = attendance_parse_datetime($dailyPunches['amTimeOut'] ?? null);
    $pmTimeInDate = attendance_parse_datetime($dailyPunches['pmTimeIn'] ?? null);
    $pmTimeOutDate = attendance_parse_datetime($dailyPunches['pmTimeOut'] ?? $timeOut);
    $officialStart = new DateTimeImmutable($date . ' 08:00:00', $timezone);
    $officialLunchEnd = new DateTimeImmutable($date . ' 13:00:00', $timezone);
    $hasMiddlePunches = (bool)($dailyPunches['hasMiddlePunches'] ?? false);

    $totalMinutes = 0;
    $lateMinutes = 0;

    if ($hasMiddlePunches) {
        $totalMinutes += attendance_session_minutes($amTimeInDate, $amTimeOutDate);
        $totalMinutes += attendance_session_minutes($pmTimeInDate, $pmTimeOutDate);
    } elseif ($timeInDate instanceof DateTimeImmutable && $timeOutDate instanceof DateTimeImmutable && $timeOutDate > $timeInDate) {
        $totalMinutes = attendance_minutes_between($timeInDate, $timeOutDate);
        if ($totalMinutes > 300) {
            $totalMinutes -= 60;
        }
    }

    if ($amTimeInDate instanceof DateTimeImmutable && $amTimeInDate > $officialStart) {
        $lateMinutes += attendance_minutes_between($officialStart, $amTimeInDate);
    }

    if ($hasMiddlePunches && $pmTimeInDate instanceof DateTimeImmutable && $pmTimeInDate > $officialLunchEnd) {
        $lateMinutes += attendance_minutes_between($officialLunchEnd, $pmTimeInDate);
    }

    $isIncomplete = !$timeInDate || !$timeOutDate;
    if ($hasMiddlePunches) {
        $isIncomplete = !$amTimeInDate || !$amTimeOutDate || !$pmTimeInDate || !$pmTimeOutDate;
    }

    if ($isIncomplete) {
        $status = 'Incomplete';
    } elseif ($lateMinutes > 0) {
        $status = 'Late';
    } else {
        $status = 'Present';
    }

    return [
        'timeIn' => $timeInDate ? $timeInDate->format('Y-m-d H:i:s') : null,
        'timeOut' => $timeOutDate ? $timeOutDate->format('Y-m-d H:i:s') : null,
        'totalMinutes' => $totalMinutes,
        'lateMinutes' => $lateMinutes,
        // Undertime is not tracked: only late arrivals and absences count against attendance. The
        // column stays at 0 so payroll's undertime deduction does too.
        'undertimeMinutes' => 0,
        'status' => $status,
    ];
}

function attendance_non_working_holiday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    if (!attendance_database_table_exists($pdo, 'holidays')) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT holiday_date AS holidayDate, type, is_recurring AS isRecurring
         FROM holidays
         WHERE type <> "special_working"
           AND (holiday_date BETWEEN :start_date AND :end_date OR is_recurring = 1)'
    );
    $statement->execute([
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $holidays = [];
    $year = substr($startDate, 0, 4);

    foreach ($statement->fetchAll() as $row) {
        $holidayDate = attendance_date_or_null($row['holidayDate'] ?? null);

        if ($holidayDate === null) {
            continue;
        }

        if ((int)($row['isRecurring'] ?? 0) === 1) {
            $holidayDate = $year . substr($holidayDate, 4);
        }

        if ($holidayDate >= $startDate && $holidayDate <= $endDate) {
            $holidays[$holidayDate] = true;
        }
    }

    return $holidays;
}

function attendance_workday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    $holidays = attendance_non_working_holiday_dates($pdo, $startDate, $endDate);
    $workdays = [];
    $current = new DateTimeImmutable($startDate);
    $end = new DateTimeImmutable($endDate);

    while ($current <= $end) {
        $dateKey = $current->format('Y-m-d');
        $dayOfWeek = (int)$current->format('N');

        if ($dayOfWeek <= 5 && !isset($holidays[$dateKey])) {
            $workdays[$dateKey] = true;
        }

        $current = $current->modify('+1 day');
    }

    return $workdays;
}

function attendance_approved_leave_dates(PDO $pdo, int $employeeRecordId, string $startDate, string $endDate, array $workdayDates): array
{
    if (!attendance_database_table_exists($pdo, 'leave_requests')) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT
            lr.start_date AS startDate,
            lr.end_date AS endDate,
            lt.name AS leaveType,
            lt.code AS leaveCode,
            lt.is_with_pay AS isWithPay
         FROM leave_requests lr
         LEFT JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
         WHERE lr.employee_id = :employee_id
           AND lr.status = "approved"
           AND lr.start_date <= :end_date
           AND lr.end_date >= :start_date'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $leaveDates = [];

    foreach ($statement->fetchAll() as $row) {
        $requestStart = attendance_date_or_null($row['startDate'] ?? null);
        $requestEnd = attendance_date_or_null($row['endDate'] ?? null);

        if ($requestStart === null || $requestEnd === null) {
            continue;
        }

        $rangeStart = max($requestStart, $startDate);
        $rangeEnd = min($requestEnd, $endDate);
        $current = new DateTimeImmutable($rangeStart);
        $end = new DateTimeImmutable($rangeEnd);

        while ($current <= $end) {
            $dateKey = $current->format('Y-m-d');

            if (isset($workdayDates[$dateKey])) {
                $isLeaveWithoutPay =
                    (int)($row['isWithPay'] ?? 1) === 0
                    || strcasecmp(attendance_text($row['leaveCode'] ?? ''), 'LWOP') === 0
                    || stripos(attendance_text($row['leaveType'] ?? ''), 'without pay') !== false;

                $leaveDates[$dateKey] = $isLeaveWithoutPay ? 'LWOP' : ($leaveDates[$dateKey] ?? 'LWP');
            }

            $current = $current->modify('+1 day');
        }
    }

    return $leaveDates;
}

function attendance_approved_overtime_hours(PDO $pdo, int $employeeRecordId, string $startDate, string $endDate): float
{
    if (!attendance_database_table_exists($pdo, 'overtime')) {
        return 0.0;
    }

    $dateColumn = database_column_exists($pdo, 'overtime', 'work_date')
        ? 'work_date'
        : (database_column_exists($pdo, 'overtime', 'overtime_date') ? 'overtime_date' : '');

    if ($dateColumn === '') {
        return 0.0;
    }

    $hourColumns = array_values(array_filter(
        ['hour_requested', 'duration', 'overtime_hours', 'hours_worked'],
        static fn (string $column): bool => database_column_exists($pdo, 'overtime', $column)
    ));

    if ($hourColumns === []) {
        return 0.0;
    }

    $hoursExpression = 'COALESCE(' . implode(', ', $hourColumns) . ', 0)';
    $statusFilter = database_column_exists($pdo, 'overtime', 'status')
        ? 'AND LOWER(status) = "approved"'
        : '';

    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM({$hoursExpression}), 0)
         FROM overtime
         WHERE employee_id = :employee_id
           AND {$dateColumn} BETWEEN :start_date AND :end_date
           {$statusFilter}"
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return round((float)$statement->fetchColumn(), 2);
}

function attendance_permissions(array $user): array
{
    return [
        'canImport' => attendance_can_import($user),
        'canViewImportHistory' => attendance_can_view_import_history($user),
        'canEdit' => attendance_can_edit($user),
        'isPersonal' => attendance_role_key($user) === 'employee' || attendance_personal_scope_requested(),
    ];
}

function attendance_scope_sql(PDO $pdo, array $user, string $employeeAlias = 'e'): array
{
    $role = attendance_role_key($user);
    $conditions = ["{$employeeAlias}.is_archived = 0"];
    $params = [];

    if ($role === 'employee' || attendance_personal_scope_requested()) {
        $employeeId = session_employee_record_id($pdo, $user);
        if ($employeeId === null) {
            $conditions[] = '1 = 0';
        } else {
            $conditions[] = "{$employeeAlias}.id = :scope_employee_id";
            $params[':scope_employee_id'] = $employeeId;
        }
    } elseif (in_array($role, ATTENDANCE_DIVISION_SCOPED_ROLES, true)) {
        $division = attendance_text($user['division'] ?? '');
        if ($division !== '') {
            $conditions[] = 'd.name = :scope_division';
            $params[':scope_division'] = $division;
        }
    }

    return [$conditions, $params];
}

/**
 * Every division the caller is allowed to filter by.
 *
 * Read from the employee roster rather than from the filtered records. Deriving it from `$records`
 * meant the list was rebuilt out of whatever the current filters had already narrowed things to, so
 * choosing a division collapsed the dropdown to that one option with no way back to "All divisions"
 * or across to another. It also hid any division that simply had no attendance rows inside the
 * chosen date range, which made the filter look broken on a quiet month.
 *
 * Scoped exactly like the records are, so a Chief still only ever sees their own division.
 */
function attendance_filter_departments(PDO $pdo, array $user): array
{
    $role = attendance_role_key($user);
    $isScoped = $role === 'employee'
        || attendance_personal_scope_requested()
        || in_array($role, ATTENDANCE_DIVISION_SCOPED_ROLES, true);

    /*
     * An organization-wide desk filters by the division table itself -- every active division, the
     * same list every other module's filter offers -- rather than only the divisions with staff.
     */
    if (!$isScoped) {
        return array_values(array_filter(array_map(
            static fn (array $row): string => attendance_text($row['name'] ?? ''),
            $pdo->query(
                'SELECT name
                 FROM divisions
                 WHERE is_archived = 0
                   AND TRIM(COALESCE(name, "")) <> ""
                 ORDER BY name ASC'
            )->fetchAll()
        )));
    }

    [$conditions, $params] = attendance_scope_sql($pdo, $user, 'e');

    $statement = $pdo->prepare(
        'SELECT DISTINCT d.name AS department
         FROM employees e
         INNER JOIN divisions d ON d.id = e.division_id
         WHERE ' . implode(' AND ', $conditions) . '
           AND TRIM(COALESCE(d.name, "")) <> ""
         ORDER BY d.name ASC'
    );
    $statement->execute($params);

    return array_values(array_filter(array_map(
        static fn (array $row): string => attendance_text($row['department'] ?? ''),
        $statement->fetchAll()
    )));
}

function attendance_fetch_employees(PDO $pdo, array $user): array
{
    [$conditions, $params] = attendance_scope_sql($pdo, $user, 'e');

    $statement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS department,
            des.name AS position
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE ' . implode(' AND ', $conditions) . '
         ORDER BY employeeName ASC'
    );
    $statement->execute($params);

    return array_map(static function (array $employee): array {
        return array_merge($employee, [
            'employeeRecordId' => (int)$employee['employeeRecordId'],
        ]);
    }, $statement->fetchAll());
}

function attendance_format_daily_record(array $record): array
{
    return [
        'id' => (int)$record['id'],
        'employeeRecordId' => (int)$record['employeeRecordId'],
        'employeeId' => $record['employeeId'] ?? '',
        'employeeName' => $record['employeeName'] ?? '',
        'department' => $record['department'] ?? '',
        'position' => $record['position'] ?? '',
        'date' => $record['date'] ?? '',
        'timeIn' => $record['timeIn'] ?? null,
        'timeOut' => $record['timeOut'] ?? null,
        'amTimeIn' => $record['amTimeIn'] ?? null,
        'amTimeOut' => $record['amTimeOut'] ?? null,
        'pmTimeIn' => $record['pmTimeIn'] ?? null,
        'pmTimeOut' => $record['pmTimeOut'] ?? null,
        'totalMinutes' => (int)($record['totalMinutes'] ?? 0),
        'lateMinutes' => (int)($record['lateMinutes'] ?? 0),
        'undertimeMinutes' => (int)($record['undertimeMinutes'] ?? 0),
        'status' => $record['status'] ?? 'Incomplete',
        'source' => $record['source'] ?? 'import',
        'updatedAt' => $record['updatedAt'] ?? null,
    ];
}

function attendance_daily_punch_key(int $employeeId, string $date): string
{
    return $employeeId . '|' . $date;
}

function attendance_hydrate_daily_punches(PDO $pdo, array $records): array
{
    if ($records === []) {
        return [];
    }

    $employeeIds = [];
    $dates = [];

    foreach ($records as $record) {
        $employeeId = (int)($record['employeeRecordId'] ?? 0);
        $date = attendance_date_or_null($record['date'] ?? null);

        if ($employeeId > 0 && $date !== null) {
            $employeeIds[$employeeId] = $employeeId;
            $dates[] = $date;
        }
    }

    if ($employeeIds === [] || $dates === []) {
        return $records;
    }

    sort($dates);
    $employeePlaceholders = [];
    $params = [
        ':start_date' => $dates[0],
        ':end_date' => $dates[count($dates) - 1],
    ];

    foreach (array_values($employeeIds) as $index => $employeeId) {
        $placeholder = ':employee_' . $index;
        $employeePlaceholders[] = $placeholder;
        $params[$placeholder] = $employeeId;
    }

    $statement = $pdo->prepare(
        'SELECT
            employee_id AS employeeRecordId,
            DATE(punch_at) AS punchDate,
            punch_at AS punchAt,
            punch_type AS punchType
         FROM attendance_logs
         WHERE employee_id IN (' . implode(', ', $employeePlaceholders) . ')
           AND DATE(punch_at) BETWEEN :start_date AND :end_date
         ORDER BY employee_id ASC, punchDate ASC, punch_at ASC, id ASC'
    );
    $statement->execute($params);

    $logsByRecord = [];
    foreach ($statement->fetchAll() as $log) {
        $key = attendance_daily_punch_key((int)$log['employeeRecordId'], (string)$log['punchDate']);
        $logsByRecord[$key][] = $log;
    }

    return array_map(static function (array $record) use ($logsByRecord): array {
        $key = attendance_daily_punch_key((int)($record['employeeRecordId'] ?? 0), (string)($record['date'] ?? ''));
        $punches = attendance_classify_daily_punches($logsByRecord[$key] ?? []);

        return array_merge($record, [
            'amTimeIn' => $punches['amTimeIn'],
            'amTimeOut' => $punches['amTimeOut'],
            'pmTimeIn' => $punches['pmTimeIn'],
            'pmTimeOut' => $punches['pmTimeOut'],
        ]);
    }, $records);
}

function attendance_list_records(PDO $pdo, array $user): void
{
    [$conditions, $params] = attendance_scope_sql($pdo, $user, 'e');
    $conditions[] = 'adr.is_archived = :is_archived';
    $params[':is_archived'] = archived_view_requested() ? 1 : 0;

    $dateFrom = attendance_date_or_null($_GET['dateFrom'] ?? null);
    $dateTo = attendance_date_or_null($_GET['dateTo'] ?? null);
    $department = attendance_text($_GET['department'] ?? '');
    $status = attendance_text($_GET['status'] ?? '');
    $search = attendance_text($_GET['search'] ?? '');

    if ($dateFrom !== null) {
        $conditions[] = 'adr.attendance_date >= :date_from';
        $params[':date_from'] = $dateFrom;
    }

    if ($dateTo !== null) {
        $conditions[] = 'adr.attendance_date <= :date_to';
        $params[':date_to'] = $dateTo;
    }

    if ($department !== '') {
        $conditions[] = 'd.name = :department';
        $params[':department'] = $department;
    }

    if ($status !== '') {
        $conditions[] = 'adr.status = :status';
        $params[':status'] = $status;
    }

    if ($search !== '') {
        $conditions[] = '(e.employee_id LIKE :search_employee_id OR TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) LIKE :search_employee_name)';
        $params[':search_employee_id'] = '%' . $search . '%';
        $params[':search_employee_name'] = '%' . $search . '%';
    }

    $statement = $pdo->prepare(
        'SELECT
            adr.id,
            adr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS department,
            des.name AS position,
            adr.attendance_date AS date,
            adr.time_in AS timeIn,
            adr.time_out AS timeOut,
            adr.total_minutes AS totalMinutes,
            adr.late_minutes AS lateMinutes,
            adr.undertime_minutes AS undertimeMinutes,
            adr.status,
            adr.source,
            adr.updated_at AS updatedAt
         FROM attendance_daily_records adr
         INNER JOIN employees e ON e.id = adr.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE ' . implode(' AND ', $conditions) . '
         ORDER BY adr.attendance_date DESC, employeeName ASC
         LIMIT 1200'
    );
    $statement->execute($params);
    $records = attendance_hydrate_daily_punches($pdo, array_map('attendance_format_daily_record', $statement->fetchAll()));

    $summary = [
        'totalRecords' => count($records),
        'present' => 0,
        'late' => 0,
        'incomplete' => 0,
        'missingTimeLogs' => 0,
        'totalRenderedMinutes' => 0,
        'totalLateMinutes' => 0,
    ];

    foreach ($records as $record) {
        $recordStatus = strtolower((string)$record['status']);
        if ($recordStatus === 'present') {
            $summary['present']++;
        }
        if (str_contains($recordStatus, 'late')) {
            $summary['late']++;
        }
        if ($recordStatus === 'incomplete') {
            $summary['incomplete']++;
            $summary['missingTimeLogs']++;
        }

        $summary['totalRenderedMinutes'] += (int)$record['totalMinutes'];
        $summary['totalLateMinutes'] += (int)$record['lateMinutes'];
    }

    json_response([
        'success' => true,
        'records' => $records,
        'summary' => $summary,
        // Independent of the filters above -- see attendance_filter_departments().
        'departments' => attendance_filter_departments($pdo, $user),
        'employees' => attendance_fetch_employees($pdo, $user),
        'permissions' => attendance_permissions($user),
    ]);
}

function attendance_fetch_record(PDO $pdo, int $recordId, array $user): ?array
{
    [$conditions, $params] = attendance_scope_sql($pdo, $user, 'e');
    $conditions[] = 'adr.id = :record_id';
    $params[':record_id'] = $recordId;

    $statement = $pdo->prepare(
        'SELECT
            adr.id,
            adr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS department,
            des.name AS position,
            adr.attendance_date AS date,
            adr.time_in AS timeIn,
            adr.time_out AS timeOut,
            adr.total_minutes AS totalMinutes,
            adr.late_minutes AS lateMinutes,
            adr.undertime_minutes AS undertimeMinutes,
            adr.status,
            adr.source,
            adr.updated_at AS updatedAt
         FROM attendance_daily_records adr
         INNER JOIN employees e ON e.id = adr.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE ' . implode(' AND ', $conditions) . '
         LIMIT 1'
    );
    $statement->execute($params);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $records = attendance_hydrate_daily_punches($pdo, [attendance_format_daily_record($record)]);
    return $records[0] ?? null;
}

function attendance_logs_for_record(PDO $pdo, array $record): array
{
    $statement = $pdo->prepare(
        'SELECT
            id,
            punch_at AS punchAt,
            punch_type AS punchType,
            raw_state AS rawState,
            source,
            created_at AS createdAt
         FROM attendance_logs
         WHERE employee_id = :employee_id
           AND DATE(punch_at) = :attendance_date
         ORDER BY punch_at ASC, id ASC'
    );
    $statement->execute([
        ':employee_id' => (int)$record['employeeRecordId'],
        ':attendance_date' => $record['date'],
    ]);

    return array_map(static function (array $log): array {
        return array_merge($log, [
            'id' => (int)$log['id'],
            'punchTypeLabel' => attendance_client_punch_type((string)$log['punchType']),
        ]);
    }, $statement->fetchAll());
}

function attendance_get_logs(PDO $pdo, array $user): void
{
    $recordId = (int)($_GET['recordId'] ?? $_GET['id'] ?? 0);
    if ($recordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Attendance record is required.',
        ], 422);
    }

    $record = attendance_fetch_record($pdo, $recordId, $user);
    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Attendance record was not found.',
        ], 404);
    }

    json_response([
        'success' => true,
        'record' => $record,
        'logs' => attendance_logs_for_record($pdo, $record),
    ]);
}

function attendance_upsert_daily_record(PDO $pdo, int $employeeId, string $date, ?string $timeIn, ?string $timeOut, string $source, ?int $updatedByUserId, ?array $dailyPunches = null): array
{
    $metrics = attendance_calculate_daily_metrics($date, $timeIn, $timeOut, $dailyPunches);

    $statement = $pdo->prepare(
        'INSERT INTO attendance_daily_records
            (employee_id, attendance_date, time_in, time_out, total_minutes, late_minutes, undertime_minutes, status, source, updated_by_user_id)
         VALUES
            (:employee_id, :attendance_date, :time_in, :time_out, :total_minutes, :late_minutes, :undertime_minutes, :status, :source, :updated_by_user_id)
         ON DUPLICATE KEY UPDATE
            time_in = VALUES(time_in),
            time_out = VALUES(time_out),
            total_minutes = VALUES(total_minutes),
            late_minutes = VALUES(late_minutes),
            undertime_minutes = VALUES(undertime_minutes),
            status = VALUES(status),
            source = VALUES(source),
            updated_by_user_id = VALUES(updated_by_user_id),
            updated_at = CURRENT_TIMESTAMP'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':attendance_date' => $date,
        ':time_in' => $metrics['timeIn'],
        ':time_out' => $metrics['timeOut'],
        ':total_minutes' => $metrics['totalMinutes'],
        ':late_minutes' => $metrics['lateMinutes'],
        ':undertime_minutes' => $metrics['undertimeMinutes'],
        ':status' => $metrics['status'],
        ':source' => $source,
        ':updated_by_user_id' => $updatedByUserId,
    ]);

    $recordIdStatement = $pdo->prepare(
        'SELECT id FROM attendance_daily_records WHERE employee_id = :employee_id AND attendance_date = :attendance_date LIMIT 1'
    );
    $recordIdStatement->execute([
        ':employee_id' => $employeeId,
        ':attendance_date' => $date,
    ]);

    return array_merge(['id' => (int)$recordIdStatement->fetchColumn()], $metrics);
}

function attendance_rollup_daily_from_logs(PDO $pdo, int $employeeId, string $date, ?int $updatedByUserId): void
{
    $statement = $pdo->prepare(
        'SELECT punch_at AS punchAt, punch_type AS punchType
         FROM attendance_logs
         WHERE employee_id = :employee_id
           AND DATE(punch_at) = :attendance_date
         ORDER BY punch_at ASC, id ASC'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':attendance_date' => $date,
    ]);

    $logs = $statement->fetchAll();
    $dailyPunches = attendance_classify_daily_punches($logs);
    $timeIn = $dailyPunches['amTimeIn'] ?? null;
    $timeOut = $dailyPunches['pmTimeOut'] ?? null;

    attendance_upsert_daily_record($pdo, $employeeId, $date, $timeIn, $timeOut, 'import', $updatedByUserId, $dailyPunches);
}

function attendance_employee_map(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT id, employee_id
         FROM employees
         WHERE is_archived = 0'
    );

    $map = [];
    foreach ($statement->fetchAll() as $employee) {
        $employeeId = (int)$employee['id'];
        $employeeCode = attendance_text($employee['employee_id'] ?? '');
        $normalizedCode = strtolower($employeeCode);

        if ($normalizedCode === '') {
            continue;
        }

        $map[$normalizedCode] = $employeeId;

        if (preg_match('/^emp\d{4}-(\d+)$/i', $employeeCode, $matches) === 1) {
            $numericCode = (string)((int)$matches[1]);
            $map[$numericCode] = $map[$numericCode] ?? $employeeId;
            $map[str_pad($numericCode, 4, '0', STR_PAD_LEFT)] = $map[str_pad($numericCode, 4, '0', STR_PAD_LEFT)] ?? $employeeId;
        }
    }

    return $map;
}

function attendance_employee_lookup_keys(string $employeeCode): array
{
    $normalizedCode = strtolower(attendance_text($employeeCode));
    if ($normalizedCode === '') {
        return [];
    }

    $keys = [$normalizedCode];

    if (preg_match('/^\d+$/', $normalizedCode) === 1) {
        $numericCode = (string)((int)$normalizedCode);
        $keys[] = $numericCode;
        $keys[] = str_pad($numericCode, 4, '0', STR_PAD_LEFT);
        $keys[] = 'emp2026-' . str_pad($numericCode, 4, '0', STR_PAD_LEFT);
    } elseif (preg_match('/^emp\d{4}-(\d+)$/', $normalizedCode, $matches) === 1) {
        $numericCode = (string)((int)$matches[1]);
        $keys[] = $numericCode;
        $keys[] = str_pad($numericCode, 4, '0', STR_PAD_LEFT);
    }

    return array_values(array_unique($keys));
}

function attendance_find_employee_id(array $employeeMap, string $employeeCode): int
{
    foreach (attendance_employee_lookup_keys($employeeCode) as $lookupKey) {
        if (isset($employeeMap[$lookupKey])) {
            return (int)$employeeMap[$lookupKey];
        }
    }

    return 0;
}

/**
 * Give every active employee a daily record for each workday represented by an import.
 *
 * A biometric file naturally contains punches only for people who used the device. Previously that
 * meant everybody without a punch had no row at all, even though attendance reports already treat
 * `Absent` as a real daily status. Existing punch rollups and manual/adjusted records win because
 * this insert only fills a missing employee/date pair.
 */
function attendance_fill_missing_import_records(PDO $pdo, array $importDates, ?int $updatedByUserId): array
{
    $dates = array_values(array_unique(array_filter(
        array_map(static fn ($date): ?string => attendance_date_or_null($date), $importDates)
    )));

    if ($dates === []) {
        return ['absentRecordsCreated' => 0, 'leaveRecordsCreated' => 0];
    }

    sort($dates);
    $startDate = $dates[0];
    $endDate = $dates[count($dates) - 1];
    $workdayDates = attendance_workday_dates($pdo, $startDate, $endDate);
    $importWorkdays = array_values(array_filter(
        $dates,
        static fn (string $date): bool => isset($workdayDates[$date])
    ));

    if ($importWorkdays === []) {
        return ['absentRecordsCreated' => 0, 'leaveRecordsCreated' => 0];
    }

    $employees = $pdo->query(
        'SELECT id
         FROM employees
         WHERE is_archived = 0
           AND LOWER(status) = "active"'
    )->fetchAll();
    $insertStatement = $pdo->prepare(
        'INSERT IGNORE INTO attendance_daily_records
            (employee_id, attendance_date, time_in, time_out, total_minutes, late_minutes, undertime_minutes, status, source, updated_by_user_id)
         VALUES
            (:employee_id, :attendance_date, NULL, NULL, 0, 0, 0, :status, "import", :updated_by_user_id)'
    );
    $counts = ['absentRecordsCreated' => 0, 'leaveRecordsCreated' => 0];

    foreach ($employees as $employee) {
        $employeeId = (int)($employee['id'] ?? 0);
        if ($employeeId <= 0) {
            continue;
        }

        $leaveDates = attendance_approved_leave_dates($pdo, $employeeId, $startDate, $endDate, $workdayDates);

        foreach ($importWorkdays as $date) {
            $leaveCode = $leaveDates[$date] ?? '';
            $status = $leaveCode === 'LWOP'
                ? 'Leave Without Pay'
                : ($leaveCode === 'LWP' ? 'Leave with Pay' : 'Absent');

            $insertStatement->execute([
                ':employee_id' => $employeeId,
                ':attendance_date' => $date,
                ':status' => $status,
                ':updated_by_user_id' => $updatedByUserId,
            ]);

            if ($insertStatement->rowCount() > 0) {
                $countKey = $leaveCode === '' ? 'absentRecordsCreated' : 'leaveRecordsCreated';
                $counts[$countKey]++;
            }
        }
    }

    return $counts;
}

function attendance_import_csv(PDO $pdo, array $user): void
{
    if (!attendance_can_import($user)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to import attendance.',
        ], 403);
    }

    if (!isset($_FILES['attendanceFile']) || !is_array($_FILES['attendanceFile'])) {
        json_response([
            'success' => false,
            'message' => 'Choose a CSV or XLSX attendance file to import.',
        ], 422);
    }

    $file = $_FILES['attendanceFile'];
    if ((int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response([
            'success' => false,
            'message' => 'Unable to upload the attendance file.',
        ], 422);
    }

    $path = (string)($file['tmp_name'] ?? '');
    $fileName = attendance_text($file['name'] ?? '');
    $fileType = strtolower(attendance_text($file['type'] ?? ''));
    $isXlsxFile = preg_match('/\.xlsx$/i', $fileName) === 1
        || $fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    $isCsvFile = preg_match('/\.csv$/i', $fileName) === 1
        || in_array($fileType, ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'], true);

    if (!$isCsvFile && !$isXlsxFile) {
        json_response([
            'success' => false,
            'message' => 'Choose a valid CSV or XLSX attendance file.',
        ], 422);
    }

    if ($isXlsxFile) {
        try {
            $workbookRows = employee_xlsx_read_rows($path);
        } catch (Throwable $exception) {
            json_response([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        }

        $handle = fopen('php://temp/maxmemory:5242880', 'w+b');
        if ($handle !== false) {
            foreach ($workbookRows as $workbookRow) {
                fputcsv($handle, $workbookRow);
            }
            rewind($handle);
        }
    } else {
        $handle = fopen($path, 'rb');
    }

    if ($handle === false) {
        json_response([
            'success' => false,
            'message' => 'Unable to read the attendance file.',
        ], 422);
    }

    /*
     * An import covers one payroll cut-off (1st half, 2nd half, or the month). The client already
     * trims the file to it, but the range is enforced here too so a stray punch outside the period
     * can never land in the wrong cut-off. Older callers that send no range still import as-is.
     */
    $cutoff = attendance_import_cutoff_from_request();
    /* DDL commits implicitly, so the history table must exist before the transaction below opens. */
    attendance_ensure_import_history_schema($pdo);
    $importFileName = mb_substr(basename(str_replace('\\', '/', $fileName)), 0, 255);
    $importSource = $isXlsxFile ? 'xlsx' : 'csv';

    $employeeMap = attendance_employee_map($pdo);
    $summary = [
        'totalRows' => 0,
        'totalImported' => 0,
        'duplicatesSkipped' => 0,
        'invalidRows' => 0,
        'outsideCutoffRows' => 0,
        'successfulRecords' => 0,
        'absentRecordsCreated' => 0,
        'leaveRecordsCreated' => 0,
        'cutoff' => $cutoff,
    ];
    $invalidSamples = [];
    $affectedDates = [];
    $importDates = [];
    $createdBy = (int)($user['id'] ?? 0) ?: null;

    $duplicateStatement = $pdo->prepare(
        'SELECT id
         FROM attendance_logs
         WHERE employee_id = :employee_id
           AND punch_at = :punch_at
           AND punch_type = :punch_type
         LIMIT 1'
    );
    $insertStatement = $pdo->prepare(
        'INSERT INTO attendance_logs
            (employee_id, punch_at, punch_type, raw_state, source, created_by_user_id)
         VALUES
            (:employee_id, :punch_at, :punch_type, :raw_state, :source, :created_by_user_id)'
    );

    $pdo->beginTransaction();

    try {
        $lineNumber = 0;
        while (($row = fgetcsv($handle)) !== false) {
            $lineNumber++;
            $employeeCode = attendance_text($row[0] ?? '');
            $dateTimeText = attendance_text($row[1] ?? '');

            if ($lineNumber === 1 && preg_match('/employee/i', $employeeCode) === 1 && preg_match('/date|time/i', $dateTimeText) === 1) {
                continue;
            }

            if ($employeeCode === '' && $dateTimeText === '' && count(array_filter($row, static fn ($value): bool => attendance_text($value) !== '')) === 0) {
                continue;
            }

            $summary['totalRows']++;

            $state = attendance_normalize_punch_state($row);
            $punchType = attendance_punch_type_from_state($state);
            $dateTime = attendance_parse_datetime($dateTimeText);
            $employeeId = attendance_find_employee_id($employeeMap, $employeeCode);

            if ($employeeId <= 0 || !$dateTime || $punchType === null) {
                $summary['invalidRows']++;
                if (count($invalidSamples) < 8) {
                    $invalidSamples[] = [
                        'line' => $lineNumber,
                        'employeeId' => $employeeCode,
                        'dateTime' => $dateTimeText,
                        'punchState' => $state !== '' ? $state : attendance_text($row[2] ?? ''),
                        'reason' => $employeeId <= 0
                            ? 'Employee ID was not found.'
                            : (!$dateTime ? 'Date and time is invalid.' : 'Punch state is not supported.'),
                    ];
                }
                continue;
            }

            $punchAt = $dateTime->format('Y-m-d H:i:s');
            $attendanceDate = $dateTime->format('Y-m-d');

            if ($cutoff !== null && ($attendanceDate < $cutoff['dateFrom'] || $attendanceDate > $cutoff['dateTo'])) {
                $summary['outsideCutoffRows']++;
                continue;
            }

            $importDates[$attendanceDate] = true;
            // Include duplicate punches too. Re-importing a file must be able to rebuild a missing
            // daily rollup without inserting the same raw log again.
            $affectedDates[$employeeId . '|' . $attendanceDate] = [
                'employeeId' => $employeeId,
                'date' => $attendanceDate,
            ];
            $duplicateStatement->execute([
                ':employee_id' => $employeeId,
                ':punch_at' => $punchAt,
                ':punch_type' => $punchType,
            ]);

            if ($duplicateStatement->fetch()) {
                $summary['duplicatesSkipped']++;
                continue;
            }

            $insertStatement->execute([
                ':employee_id' => $employeeId,
                ':punch_at' => $punchAt,
                ':punch_type' => $punchType,
                ':raw_state' => $state,
                ':source' => $importSource,
                ':created_by_user_id' => $createdBy,
            ]);
            $summary['totalImported']++;
        }

        fclose($handle);

        foreach ($affectedDates as $affected) {
            attendance_rollup_daily_from_logs($pdo, (int)$affected['employeeId'], (string)$affected['date'], $createdBy);
            $summary['successfulRecords']++;
        }

        $coverageCounts = attendance_fill_missing_import_records($pdo, array_keys($importDates), $createdBy);
        $summary = array_merge($summary, $coverageCounts);

        // The range the list should open on afterwards: the whole cut-off when one was chosen, so a
        // half with no punches on its last days still shows as that half; otherwise the file's span.
        if ($cutoff !== null) {
            $summary['dateFrom'] = $cutoff['dateFrom'];
            $summary['dateTo'] = $cutoff['dateTo'];
        } elseif ($importDates !== []) {
            $sortedImportDates = array_keys($importDates);
            sort($sortedImportDates);
            $summary['dateFrom'] = $sortedImportDates[0];
            $summary['dateTo'] = $sortedImportDates[count($sortedImportDates) - 1];
        }

        $historyStatement = $pdo->prepare(
            'INSERT INTO attendance_imports
                (file_name, pay_period, date_from, date_to, total_rows, total_imported, duplicates_skipped,
                 invalid_rows, outside_cutoff_rows, successful_records, absent_records_created,
                 leave_records_created, imported_by_user_id, imported_by_name)
             VALUES
                (:file_name, :pay_period, :date_from, :date_to, :total_rows, :total_imported, :duplicates_skipped,
                 :invalid_rows, :outside_cutoff_rows, :successful_records, :absent_records_created,
                 :leave_records_created, :imported_by_user_id, :imported_by_name)'
        );
        $historyStatement->execute([
            ':file_name' => $importFileName !== '' ? $importFileName : 'attendance.csv',
            ':pay_period' => $cutoff !== null && $cutoff['payPeriod'] !== '' ? $cutoff['payPeriod'] : null,
            ':date_from' => $summary['dateFrom'] ?? null,
            ':date_to' => $summary['dateTo'] ?? null,
            ':total_rows' => (int)$summary['totalRows'],
            ':total_imported' => (int)$summary['totalImported'],
            ':duplicates_skipped' => (int)$summary['duplicatesSkipped'],
            ':invalid_rows' => (int)$summary['invalidRows'],
            ':outside_cutoff_rows' => (int)$summary['outsideCutoffRows'],
            ':successful_records' => (int)$summary['successfulRecords'],
            ':absent_records_created' => (int)($summary['absentRecordsCreated'] ?? 0),
            ':leave_records_created' => (int)($summary['leaveRecordsCreated'] ?? 0),
            ':imported_by_user_id' => $createdBy,
            ':imported_by_name' => mb_substr(attendance_text($user['full_name'] ?? '') ?: attendance_text($user['username'] ?? ''), 0, 180) ?: null,
        ]);
        $summary['importId'] = (int)$pdo->lastInsertId();

        $pdo->commit();
    } catch (Throwable $exception) {
        if (is_resource($handle)) {
            fclose($handle);
        }

        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        if ((int)($summary['totalImported'] ?? 0) > 0) {
            $notificationCount = (int)($summary['totalImported'] ?? 0);
            $notificationTitle = 'Attendance Import Completed';
            $notificationMessage = sprintf(
                'Attendance import%s completed with %d new record%s.',
                $cutoff !== null ? ' for ' . attendance_import_cutoff_label($cutoff) : '',
                $notificationCount,
                $notificationCount === 1 ? '' : 's'
            );
            $notificationReference = isset($summary['dateFrom'], $summary['dateTo'])
                ? $summary['dateFrom'] . ':' . $summary['dateTo']
                : 'attendance-import';

            notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                $notificationTitle,
                $notificationMessage,
                'attendance_updated',
                $notificationReference
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Attendance import notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Attendance import completed.',
        'summary' => $summary,
        'invalidSamples' => $invalidSamples,
    ], 201);
}

/** Newest import first, one page at a time. The username is a fallback for rows imported before the name snapshot existed. */
function attendance_list_import_history(PDO $pdo, array $user): void
{
    if (!attendance_can_view_import_history($user)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to view the attendance import history.',
        ], 403);
    }

    attendance_ensure_import_history_schema($pdo);

    $page = max(1, (int)($_GET['page'] ?? 1));
    $pageSize = min(100, max(1, (int)($_GET['pageSize'] ?? 20)));
    $total = (int)$pdo->query('SELECT COUNT(*) FROM attendance_imports')->fetchColumn();

    $statement = $pdo->prepare(
        'SELECT
            ai.id,
            ai.file_name AS fileName,
            ai.pay_period AS payPeriod,
            ai.date_from AS dateFrom,
            ai.date_to AS dateTo,
            ai.total_rows AS totalRows,
            ai.total_imported AS totalImported,
            ai.duplicates_skipped AS duplicatesSkipped,
            ai.invalid_rows AS invalidRows,
            ai.outside_cutoff_rows AS outsideCutoffRows,
            ai.successful_records AS successfulRecords,
            ai.absent_records_created AS absentRecordsCreated,
            ai.leave_records_created AS leaveRecordsCreated,
            COALESCE(NULLIF(ai.imported_by_name, ""), u.username) AS importedBy,
            ai.created_at AS importedAt
         FROM attendance_imports ai
         LEFT JOIN users u ON u.id = ai.imported_by_user_id
         ORDER BY ai.created_at DESC, ai.id DESC
         LIMIT :limit OFFSET :offset'
    );
    $statement->bindValue(':limit', $pageSize, PDO::PARAM_INT);
    $statement->bindValue(':offset', ($page - 1) * $pageSize, PDO::PARAM_INT);
    $statement->execute();

    $imports = array_map(static function (array $row): array {
        $counts = [
            'totalRows', 'totalImported', 'duplicatesSkipped', 'invalidRows', 'outsideCutoffRows',
            'successfulRecords', 'absentRecordsCreated', 'leaveRecordsCreated',
        ];
        foreach ($counts as $key) {
            $row[$key] = (int)$row[$key];
        }

        $row['id'] = (int)$row['id'];
        $row['payPeriod'] = (string)($row['payPeriod'] ?? '');
        $row['cutoffLabel'] = $row['dateFrom'] !== null && $row['dateTo'] !== null
            ? attendance_import_cutoff_label([
                'payPeriod' => $row['payPeriod'],
                'dateFrom' => (string)$row['dateFrom'],
                'dateTo' => (string)$row['dateTo'],
            ])
            : '';

        return $row;
    }, $statement->fetchAll());

    json_response([
        'success' => true,
        'imports' => $imports,
        'total' => $total,
        'page' => $page,
        'pageSize' => $pageSize,
    ]);
}

function attendance_archive_record(PDO $pdo, array $body, array $user, bool $archived): void
{
    if (!attendance_can_edit($user)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive attendance records.',
        ], 403);
    }

    $recordId = (int)($body['id'] ?? $body['recordId'] ?? 0);

    if ($recordId <= 0 || attendance_fetch_record($pdo, $recordId, $user) === null) {
        json_response([
            'success' => false,
            'message' => 'Attendance record was not found.',
        ], 404);
    }

    set_record_archived(
        $pdo,
        'attendance_daily_records',
        'id',
        $recordId,
        $archived,
        $user,
        'Attendance Record'
    );

    json_response([
        'success' => true,
        'message' => $archived ? 'Attendance record archived.' : 'Attendance record restored.',
    ]);
}

function attendance_update_record(PDO $pdo, array $body, array $user): void
{
    if (!attendance_can_edit($user)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to edit attendance records.',
        ], 403);
    }

    $recordId = (int)($body['id'] ?? $body['recordId'] ?? 0);
    $record = attendance_fetch_record($pdo, $recordId, $user);
    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Attendance record was not found.',
        ], 404);
    }

    $timeIn = attendance_datetime_for_date($body['timeIn'] ?? null, $record['date']);
    $timeOut = attendance_datetime_for_date($body['timeOut'] ?? null, $record['date']);
    $status = array_key_exists('status', $body)
        ? attendance_normalize_daily_status($body['status'])
        : null;
    if (array_key_exists('status', $body) && $status === null) {
        json_response([
            'success' => false,
            'message' => 'Attendance status is invalid.',
        ], 422);
    }

    $updatedBy = (int)($user['id'] ?? 0) ?: null;

    $pdo->beginTransaction();
    try {
        $result = attendance_upsert_daily_record(
            $pdo,
            (int)$record['employeeRecordId'],
            $record['date'],
            $timeIn,
            $timeOut,
            'manual',
            $updatedBy
        );

        if ($status !== null) {
            $statusStatement = $pdo->prepare(
                'UPDATE attendance_daily_records
                 SET status = :status,
                     updated_by_user_id = :updated_by_user_id,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id'
            );
            $statusStatement->execute([
                ':status' => $status,
                ':updated_by_user_id' => $updatedBy,
                ':id' => (int)$result['id'],
            ]);
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    // The audit trail is the record of a manual edit: who changed which day, from what, and why.
    write_auth_audit($pdo, $user, 'attendance.record_updated', 'An attendance record was edited.', [
        'module' => 'attendance',
        'recordId' => $recordId,
        'employeeRecordId' => (int)$record['employeeRecordId'],
        'date' => $record['date'],
        'previousTimeIn' => $record['timeIn'] ?? null,
        'previousTimeOut' => $record['timeOut'] ?? null,
        'previousStatus' => $record['status'] ?? null,
        'timeIn' => $timeIn,
        'timeOut' => $timeOut,
        'status' => $status ?? ($record['status'] ?? null),
        'reason' => attendance_text($body['reason'] ?? '') ?: 'Manual attendance update',
    ]);

    try {
        $employeeName = trim((string)($record['employeeName'] ?? '')) !== ''
            ? trim((string)($record['employeeName'] ?? ''))
            : 'the employee';
        $recordDateLabel = (new DateTimeImmutable((string)$record['date']))->format('M j, Y');

        notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Attendance Record Updated',
            sprintf('Attendance record for %s on %s was updated.', $employeeName, $recordDateLabel),
            'attendance_updated',
            (string)$recordId
        );

        notify_employee(
            $pdo,
            (int)$record['employeeRecordId'],
            'Attendance Record Updated',
            sprintf('Your attendance record for %s was updated.', $recordDateLabel),
            'attendance_updated',
            (string)$recordId
        );
    } catch (Throwable $notificationException) {
        error_log('Attendance update notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Attendance record updated.',
        'record' => attendance_fetch_record($pdo, $recordId, $user),
    ]);
}

function attendance_build_dtr(PDO $pdo, array $user): array
{
    $recordId = (int)($_GET['recordId'] ?? 0);
    $employeeRecordId = (int)($_GET['employeeRecordId'] ?? 0);
    $month = attendance_month_or_current($_GET['month'] ?? null);

    if ($recordId > 0) {
        $record = attendance_fetch_record($pdo, $recordId, $user);
        if ($record === null) {
            json_response([
                'success' => false,
                'message' => 'Attendance record was not found.',
            ], 404);
        }
        $employeeRecordId = (int)$record['employeeRecordId'];
        $month = substr((string)$record['date'], 0, 7);
    } elseif (attendance_role_key($user) === 'employee' || attendance_personal_scope_requested()) {
        $employeeRecordId = (int)(session_employee_record_id($pdo, $user) ?? 0);
    }

    if ($employeeRecordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    $startDate = $month . '-01';
    $endDate = (new DateTimeImmutable($startDate))->modify('last day of this month')->format('Y-m-d');

    [$conditions, $params] = attendance_scope_sql($pdo, $user, 'e');
    $conditions[] = 'e.id = :employee_record_id';
    $params[':employee_record_id'] = $employeeRecordId;

    $employeeStatement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS department,
            des.name AS position
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE ' . implode(' AND ', $conditions) . '
         LIMIT 1'
    );
    $employeeStatement->execute($params);
    $employee = $employeeStatement->fetch();

    if (!$employee) {
        json_response([
            'success' => false,
            'message' => 'Employee record was not found.',
        ], 404);
    }

    $recordsStatement = $pdo->prepare(
        'SELECT
            adr.id,
            adr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS department,
            des.name AS position,
            adr.attendance_date AS date,
            adr.time_in AS timeIn,
            adr.time_out AS timeOut,
            adr.total_minutes AS totalMinutes,
            adr.late_minutes AS lateMinutes,
            adr.undertime_minutes AS undertimeMinutes,
            adr.status,
            adr.source,
            adr.updated_at AS updatedAt
         FROM attendance_daily_records adr
         INNER JOIN employees e ON e.id = adr.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE adr.employee_id = :employee_id
           AND adr.attendance_date BETWEEN :start_date AND :end_date
         ORDER BY adr.attendance_date ASC'
    );
    $recordsStatement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);
    $records = attendance_hydrate_daily_punches($pdo, array_map('attendance_format_daily_record', $recordsStatement->fetchAll()));

    $totals = [
        'renderedMinutes' => 0,
        'lateMinutes' => 0,
        'undertimeMinutes' => 0,
    ];

    foreach ($records as $record) {
        $totals['renderedMinutes'] += (int)$record['totalMinutes'];
        $totals['lateMinutes'] += (int)$record['lateMinutes'];
        $totals['undertimeMinutes'] += (int)$record['undertimeMinutes'];
    }

    $workdayDates = attendance_workday_dates($pdo, $startDate, $endDate);
    $leaveDates = attendance_approved_leave_dates($pdo, $employeeRecordId, $startDate, $endDate, $workdayDates);
    $workedDates = [];
    $dtrDatesWithEntries = [];

    foreach ($records as $record) {
        $recordDate = attendance_date_or_null($record['date'] ?? null);

        if (
            $recordDate !== null
            && (
                attendance_text($record['timeIn'] ?? '') !== ''
                || attendance_text($record['timeOut'] ?? '') !== ''
                || attendance_text($record['amTimeIn'] ?? '') !== ''
                || attendance_text($record['amTimeOut'] ?? '') !== ''
                || attendance_text($record['pmTimeIn'] ?? '') !== ''
                || attendance_text($record['pmTimeOut'] ?? '') !== ''
                || (int)($record['totalMinutes'] ?? 0) > 0
            )
        ) {
            $dtrDatesWithEntries[$recordDate] = true;
        }

        if ($recordDate !== null && (int)($record['totalMinutes'] ?? 0) > 0) {
            $workedDates[$recordDate] = true;
        }
    }

    $absentDays = 0;
    foreach ($workdayDates as $date => $_) {
        $dayOfWeek = (int)(new DateTimeImmutable($date))->format('N');

        if ($dayOfWeek <= 4 && !isset($dtrDatesWithEntries[$date]) && !isset($leaveDates[$date])) {
            $absentDays++;
        }
    }

    $totals['daysWorked'] = count($workedDates);
    $totals['overtimeHours'] = attendance_approved_overtime_hours($pdo, $employeeRecordId, $startDate, $endDate);
    $totals['absentDays'] = $absentDays;
    $totals['leaveDays'] = count($leaveDates);
    $totals['expectedWorkdays'] = count($workdayDates);

    return [
        'success' => true,
        'employee' => array_merge($employee, [
            'employeeRecordId' => (int)$employee['employeeRecordId'],
        ]),
        'month' => $month,
        'startDate' => $startDate,
        'endDate' => $endDate,
        'records' => $records,
        'leaveDates' => $leaveDates,
        'totals' => $totals,
        'permissions' => attendance_permissions($user),
    ];
}

function attendance_get_dtr(PDO $pdo, array $user): void
{
    json_response(attendance_build_dtr($pdo, $user));
}

function attendance_dtr_excel_time(mixed $value): string
{
    $text = attendance_text($value);
    if ($text === '') {
        return '--';
    }

    try {
        return (new DateTimeImmutable($text))->format('g:i a');
    } catch (Throwable) {
        return '--';
    }
}

const ATTENDANCE_DTR_XLSX_STYLE_DEFAULT = 0;
const ATTENDANCE_DTR_XLSX_STYLE_FORM_NOTE = 1;
const ATTENDANCE_DTR_XLSX_STYLE_COPY = 2;
const ATTENDANCE_DTR_XLSX_STYLE_OFFICE = 3;
const ATTENDANCE_DTR_XLSX_STYLE_TITLE = 4;
const ATTENDANCE_DTR_XLSX_STYLE_NAME = 5;
const ATTENDANCE_DTR_XLSX_STYLE_LABEL = 6;
const ATTENDANCE_DTR_XLSX_STYLE_VALUE_LINE = 7;
const ATTENDANCE_DTR_XLSX_STYLE_OFFICIAL = 8;
const ATTENDANCE_DTR_XLSX_STYLE_OFFICIAL_RIGHT = 9;
const ATTENDANCE_DTR_XLSX_STYLE_HEADER = 10;
const ATTENDANCE_DTR_XLSX_STYLE_CELL = 11;
const ATTENDANCE_DTR_XLSX_STYLE_DAY = 12;
const ATTENDANCE_DTR_XLSX_STYLE_CERTIFICATION = 13;
const ATTENDANCE_DTR_XLSX_STYLE_SIGNATURE_LINE = 14;
const ATTENDANCE_DTR_XLSX_STYLE_CAPTION = 15;
const ATTENDANCE_DTR_XLSX_STYLE_VERIFIED = 16;
const ATTENDANCE_DTR_XLSX_STYLE_IN_CHARGE = 17;
const ATTENDANCE_DTR_XLSX_STYLE_TIMESTAMP = 18;
const ATTENDANCE_DTR_XLSX_STYLE_DOTS = 19;

function attendance_dtr_xlsx_styles_xml(): string
{
    $fonts = [
        '<font><sz val="9"/><name val="Times New Roman"/></font>',
        '<font><i/><sz val="8"/><name val="Times New Roman"/></font>',
        '<font><b/><sz val="10"/><name val="Times New Roman"/></font>',
        '<font><b/><sz val="12"/><name val="Times New Roman"/></font>',
        '<font><b/><sz val="9"/><name val="Times New Roman"/></font>',
        '<font><i/><sz val="9"/><name val="Times New Roman"/></font>',
        '<font><sz val="8"/><name val="Times New Roman"/></font>',
    ];
    $allSides = '<left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right>'
        . '<top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom>';
    $borders = [
        '<border><left/><right/><top/><bottom/><diagonal/></border>',
        '<border>' . $allSides . '<diagonal/></border>',
        '<border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>',
    ];
    $center = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
    $left = '<alignment horizontal="left" vertical="center" wrapText="1"/>';
    $right = '<alignment horizontal="right" vertical="center" wrapText="1"/>';
    $xfs = [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $right . '</xf>',
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $right . '</xf>',
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $center . '</xf>',
        '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $center . '</xf>',
    ];

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<fonts count="' . count($fonts) . '">' . implode('', $fonts) . '</fonts>'
        . '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        . '<borders count="' . count($borders) . '">' . implode('', $borders) . '</borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="' . count($xfs) . '">' . implode('', $xfs) . '</cellXfs>'
        . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        . '</styleSheet>';
}

function attendance_dtr_xlsx_put(array &$rows, int $row, int $column, array $cell): void
{
    $rows[$row] ??= [];
    $rows[$row][$column] = $cell;
}

function attendance_dtr_xlsx_image(string $path, int $fromColumn, int $fromRow, int $toColumn, int $toRow, string $name): ?array
{
    $bytes = is_file($path) ? file_get_contents($path) : false;
    if ($bytes === false || $bytes === '') {
        return null;
    }

    return [
        'bytes' => $bytes,
        'extension' => 'png',
        'contentType' => 'image/png',
        'name' => $name,
        'fromCol' => $fromColumn,
        'fromRow' => $fromRow,
        'toCol' => $toColumn,
        'toRow' => $toRow,
        'fromColOff' => 30000,
        'fromRowOff' => 20000,
        'toColOff' => 30000,
        'toRowOff' => 0,
        'lockAspect' => false,
    ];
}

/** Stream an Excel rendering of the same two CS Form No. 48 copies displayed in View DTR. */
function attendance_export_dtr_xlsx(PDO $pdo, array $user): void
{
    $dtr = attendance_build_dtr($pdo, $user);
    $recordsByDate = [];

    foreach (($dtr['records'] ?? []) as $record) {
        $date = attendance_text($record['date'] ?? '');
        if ($date !== '') {
            $recordsByDate[$date] = $record;
        }
    }

    $leaveDates = is_array($dtr['leaveDates'] ?? null) ? $dtr['leaveDates'] : [];
    $employee = is_array($dtr['employee'] ?? null) ? $dtr['employee'] : [];
    $month = attendance_text($dtr['month'] ?? '');
    $monthStart = DateTimeImmutable::createFromFormat('!Y-m-d', $month . '-01');

    if (!$monthStart) {
        json_response(['success' => false, 'message' => 'The DTR month is invalid.'], 422);
    }

    $dtrRows = [];
    $daysInMonth = (int)$monthStart->format('t');
    for ($day = 1; $day <= $daysInMonth; $day++) {
        $date = $monthStart->setDate((int)$monthStart->format('Y'), (int)$monthStart->format('m'), $day);
        $dateKey = $date->format('Y-m-d');
        $record = $recordsByDate[$dateKey] ?? [];
        $leaveCode = strtoupper(attendance_text($leaveDates[$dateKey] ?? ''));
        $status = strtolower(attendance_text($record['status'] ?? ''));
        if ($leaveCode === '' && $status === 'leave with pay') {
            $leaveCode = 'LWP';
        } elseif ($leaveCode === '' && $status === 'leave without pay') {
            $leaveCode = 'LWOP';
        }

        $dtrRows[] = $leaveCode !== ''
            ? [$day . ' ' . $date->format('D'), $leaveCode, $leaveCode, $leaveCode, $leaveCode, '--', '--']
            : [
                $day . ' ' . $date->format('D'),
                attendance_dtr_excel_time($record['amTimeIn'] ?? $record['timeIn'] ?? null),
                attendance_dtr_excel_time($record['amTimeOut'] ?? null),
                attendance_dtr_excel_time($record['pmTimeIn'] ?? null),
                attendance_dtr_excel_time($record['pmTimeOut'] ?? $record['timeOut'] ?? null),
                array_key_exists('lateMinutes', $record) ? (string)(int)$record['lateMinutes'] : '--',
                array_key_exists('undertimeMinutes', $record) ? (string)(int)$record['undertimeMinutes'] : '--',
            ];
    }

    $rows = [];
    $rowHeights = [0 => 11, 1 => 12, 2 => 17, 3 => 18, 4 => 19, 5 => 5, 6 => 17, 7 => 14, 8 => 14, 9 => 27, 10 => 18];
    $images = [];
    $tableBodyStart = 11;
    foreach ($dtrRows as $index => $_) {
        $rowHeights[$tableBodyStart + $index] = 13;
    }
    $certificationRow = $tableBodyStart + count($dtrRows) + 1;
    $rowHeights[$certificationRow] = 42;
    $rowHeights[$certificationRow + 1] = 17;
    $rowHeights[$certificationRow + 2] = 17;
    $rowHeights[$certificationRow + 7] = 17;
    $rowHeights[$certificationRow + 8] = 17;
    $timestamp = date('n/j/y, h:i A');
    $certification = "I certify on my honor that the above is a true and correct report of the\nhours work performed, record of which was daily at the time of arrival\nand departure from office.";

    $signatureStatement = $pdo->prepare('SELECT e_signature FROM employees WHERE id = :employee_id LIMIT 1');
    $signatureStatement->execute([':employee_id' => (int)($employee['employeeRecordId'] ?? 0)]);
    $signatureImage = payroll_xlsx_image_from_data_url($signatureStatement->fetchColumn());
    $logoPath = dirname(__DIR__, 2) . '/public/mgb.png';

    foreach ([0 => 'ORIGINAL COPY', 8 => 'DUPLICATE COPY'] as $offset => $copyLabel) {
        attendance_dtr_xlsx_put($rows, 0, $offset, payroll_xlsx_text($timestamp, ATTENDANCE_DTR_XLSX_STYLE_TIMESTAMP, 6));
        attendance_dtr_xlsx_put($rows, 1, $offset, payroll_xlsx_text('Civil Service Form No. 48', ATTENDANCE_DTR_XLSX_STYLE_FORM_NOTE, 3));
        attendance_dtr_xlsx_put($rows, 1, $offset + 4, payroll_xlsx_text('>>> ' . $copyLabel, ATTENDANCE_DTR_XLSX_STYLE_COPY, 2));
        attendance_dtr_xlsx_put($rows, 2, $offset + 1, payroll_xlsx_text('Mines and Geosciences Bureau - 10', ATTENDANCE_DTR_XLSX_STYLE_OFFICE, 5));
        attendance_dtr_xlsx_put($rows, 3, $offset + 1, payroll_xlsx_text('DAILY TIME RECORD', ATTENDANCE_DTR_XLSX_STYLE_TITLE, 5));
        attendance_dtr_xlsx_put($rows, 4, $offset + 1, payroll_xlsx_text(strtoupper(attendance_text($employee['employeeName'] ?? 'Employee')), ATTENDANCE_DTR_XLSX_STYLE_NAME, 5));
        attendance_dtr_xlsx_put($rows, 6, $offset, payroll_xlsx_text('For the month of', ATTENDANCE_DTR_XLSX_STYLE_LABEL, 1));
        attendance_dtr_xlsx_put($rows, 6, $offset + 2, payroll_xlsx_text($monthStart->format('F Y'), ATTENDANCE_DTR_XLSX_STYLE_VALUE_LINE, 4));
        attendance_dtr_xlsx_put($rows, 7, $offset, payroll_xlsx_text('Official hours for arrival and departure', ATTENDANCE_DTR_XLSX_STYLE_OFFICIAL, 3));
        attendance_dtr_xlsx_put($rows, 7, $offset + 4, payroll_xlsx_text('Regular days     8.00', ATTENDANCE_DTR_XLSX_STYLE_OFFICIAL_RIGHT, 2));
        attendance_dtr_xlsx_put($rows, 8, $offset + 4, payroll_xlsx_text('Saturdays          0.00', ATTENDANCE_DTR_XLSX_STYLE_OFFICIAL_RIGHT, 2));

        attendance_dtr_xlsx_put($rows, 9, $offset, payroll_xlsx_text('Day', ATTENDANCE_DTR_XLSX_STYLE_HEADER, 0, 1));
        attendance_dtr_xlsx_put($rows, 9, $offset + 1, payroll_xlsx_text('A M', ATTENDANCE_DTR_XLSX_STYLE_HEADER, 1));
        attendance_dtr_xlsx_put($rows, 9, $offset + 3, payroll_xlsx_text('P M', ATTENDANCE_DTR_XLSX_STYLE_HEADER, 1));
        attendance_dtr_xlsx_put($rows, 9, $offset + 5, payroll_xlsx_text("REMARKS\nIN MINUTES", ATTENDANCE_DTR_XLSX_STYLE_HEADER, 1));
        foreach (['Arrival', 'Departure', 'Arrival', 'Departure', 'T', 'U'] as $index => $heading) {
            attendance_dtr_xlsx_put($rows, 10, $offset + 1 + $index, payroll_xlsx_text($heading, ATTENDANCE_DTR_XLSX_STYLE_HEADER));
        }

        foreach ($dtrRows as $rowIndex => $values) {
            $sheetRow = $tableBodyStart + $rowIndex;
            foreach ($values as $column => $value) {
                attendance_dtr_xlsx_put(
                    $rows,
                    $sheetRow,
                    $offset + $column,
                    payroll_xlsx_text($value, $column === 0 ? ATTENDANCE_DTR_XLSX_STYLE_DAY : ATTENDANCE_DTR_XLSX_STYLE_CELL)
                );
            }
        }

        attendance_dtr_xlsx_put($rows, $certificationRow, $offset, payroll_xlsx_text($certification, ATTENDANCE_DTR_XLSX_STYLE_CERTIFICATION, 6));
        attendance_dtr_xlsx_put($rows, $certificationRow + 3, $offset + 1, payroll_xlsx_text('', ATTENDANCE_DTR_XLSX_STYLE_SIGNATURE_LINE, 4));
        attendance_dtr_xlsx_put($rows, $certificationRow + 4, $offset + 1, payroll_xlsx_text('Signature', ATTENDANCE_DTR_XLSX_STYLE_CAPTION, 4));
        attendance_dtr_xlsx_put($rows, $certificationRow + 5, $offset, payroll_xlsx_text('---------------------------------------------------------', ATTENDANCE_DTR_XLSX_STYLE_DOTS, 6));
        attendance_dtr_xlsx_put($rows, $certificationRow + 6, $offset, payroll_xlsx_text('VERIFIED as to the prescribed office hours', ATTENDANCE_DTR_XLSX_STYLE_VERIFIED, 6));
        attendance_dtr_xlsx_put($rows, $certificationRow + 9, $offset + 1, payroll_xlsx_text('', ATTENDANCE_DTR_XLSX_STYLE_SIGNATURE_LINE, 4));
        attendance_dtr_xlsx_put($rows, $certificationRow + 10, $offset + 1, payroll_xlsx_text('In Charge', ATTENDANCE_DTR_XLSX_STYLE_IN_CHARGE, 4));

        $logo = attendance_dtr_xlsx_image($logoPath, $offset, 2, $offset + 1, 6, 'MGB Logo - ' . $copyLabel);
        if ($logo !== null) {
            $images[] = $logo;
        }

        if ($signatureImage !== null) {
            $images[] = array_merge($signatureImage, [
                'name' => 'Employee Signature - ' . $copyLabel,
                'fromCol' => $offset + 2,
                'fromRow' => $certificationRow + 1,
                'toCol' => $offset + 5,
                'toRow' => $certificationRow + 3,
                'fromColOff' => 100000,
                'fromRowOff' => 20000,
                'toColOff' => 100000,
                'toRowOff' => 0,
                'lockAspect' => true,
            ]);
        }
    }

    foreach ($rows as &$row) {
        ksort($row);
    }
    unset($row);
    ksort($rows);

    $sheet = [
        'rows' => $rows,
        'cols' => [9, 9.5, 9.5, 9.5, 9.5, 6, 6, 2.5, 9, 9.5, 9.5, 9.5, 9.5, 6, 6],
        'freeze' => 0,
        'images' => $images,
        'rowHeights' => $rowHeights,
        'stylesXml' => attendance_dtr_xlsx_styles_xml(),
        'showGridLines' => false,
        'zoomScale' => 65,
        'page' => [
            'paperSize' => 9,
            'orientation' => 'portrait',
            'fitToWidth' => 1,
            'fitToHeight' => 1,
            'left' => 0.2,
            'right' => 0.2,
            'top' => 0.2,
            'bottom' => 0.2,
            'header' => 0.1,
            'footer' => 0.1,
        ],
    ];
    $employeeCode = preg_replace('/[^A-Za-z0-9-]+/', '-', attendance_text($employee['employeeId'] ?? 'employee')) ?: 'employee';
    $filename = 'DTR-CS-Form-48-' . $employeeCode . '-' . $month . '.xlsx';
    $workbook = payroll_xlsx_package($sheet, 'Daily Time Record', 'Daily Time Record - ' . $employeeCode . ' - ' . $month);

    if ($workbook === null) {
        json_response(['success' => false, 'message' => 'Unable to generate the DTR Excel file.'], 503);
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    header_remove('Content-Type');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($workbook));
    echo $workbook;
    exit;
}

try {
    ensure_archive_columns($pdo, 'attendance_daily_records');

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $action = attendance_text($_GET['action'] ?? $_POST['action'] ?? '');

    if ($method === 'GET') {
        if ($action === 'export_dtr_xlsx') {
            attendance_export_dtr_xlsx($pdo, $sessionUser);
        }

        if ($action === 'logs') {
            attendance_get_logs($pdo, $sessionUser);
        }

        if ($action === 'dtr') {
            attendance_get_dtr($pdo, $sessionUser);
        }

        if ($action === 'imports') {
            attendance_list_import_history($pdo, $sessionUser);
        }

        attendance_list_records($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        if ($action === 'import') {
            attendance_import_csv($pdo, $sessionUser);
        }
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $bodyAction = strtolower(attendance_text($body['action'] ?? ''));

        if ($bodyAction === 'archive' || $bodyAction === 'restore') {
            attendance_archive_record($pdo, $body, $sessionUser, $bodyAction === 'archive');
        }

        attendance_update_record($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (PDOException $exception) {
    error_log('Attendance API database error: ' . $exception->getMessage());
    $message = str_starts_with((string)$exception->getCode(), '42')
        ? 'Attendance database tables are not installed yet. Please import the attendance section from backend/database/hris.sql.'
        : 'Unable to process attendance data.';

    json_response([
        'success' => false,
        'message' => $message,
    ], 500);
} catch (Throwable $exception) {
    error_log('Attendance API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process attendance data.',
    ], 500);
}
