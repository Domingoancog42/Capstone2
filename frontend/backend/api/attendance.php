<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

date_default_timezone_set('Asia/Manila');

$sessionUser = require_session_user();

function attendance_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function attendance_allowed_daily_statuses(): array
{
    return ['Present', 'Late', 'Undertime', 'Late / Undertime', 'Incomplete', 'Leave with Pay', 'Leave Without Pay'];
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
    return hris_user_role_key($user);
}

function attendance_can_import(array $user): bool
{
    return in_array(attendance_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function attendance_can_edit(array $user): bool
{
    return in_array(attendance_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function attendance_can_approve_adjustments(array $user): bool
{
    return in_array(attendance_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function attendance_can_request_adjustment(array $user): bool
{
    return attendance_role_key($user) === 'employee';
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
    $officialLunchStart = new DateTimeImmutable($date . ' 12:00:00', $timezone);
    $officialLunchEnd = new DateTimeImmutable($date . ' 13:00:00', $timezone);
    $officialEnd = new DateTimeImmutable($date . ' 17:00:00', $timezone);
    $hasMiddlePunches = (bool)($dailyPunches['hasMiddlePunches'] ?? false);

    $totalMinutes = 0;
    $lateMinutes = 0;
    $undertimeMinutes = 0;

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

    if ($hasMiddlePunches && $amTimeOutDate instanceof DateTimeImmutable && $amTimeOutDate < $officialLunchStart) {
        $undertimeMinutes += attendance_minutes_between($amTimeOutDate, $officialLunchStart);
    }

    if ($pmTimeOutDate instanceof DateTimeImmutable && $pmTimeOutDate < $officialEnd) {
        $undertimeMinutes += attendance_minutes_between($pmTimeOutDate, $officialEnd);
    }

    $isIncomplete = !$timeInDate || !$timeOutDate;
    if ($hasMiddlePunches) {
        $isIncomplete = !$amTimeInDate || !$amTimeOutDate || !$pmTimeInDate || !$pmTimeOutDate;
    }

    if ($isIncomplete) {
        $status = 'Incomplete';
    } elseif ($lateMinutes > 0 && $undertimeMinutes > 0) {
        $status = 'Late / Undertime';
    } elseif ($lateMinutes > 0) {
        $status = 'Late';
    } elseif ($undertimeMinutes > 0) {
        $status = 'Undertime';
    } else {
        $status = 'Present';
    }

    return [
        'timeIn' => $timeInDate ? $timeInDate->format('Y-m-d H:i:s') : null,
        'timeOut' => $timeOutDate ? $timeOutDate->format('Y-m-d H:i:s') : null,
        'totalMinutes' => $totalMinutes,
        'lateMinutes' => $lateMinutes,
        'undertimeMinutes' => $undertimeMinutes,
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

    $dateColumn = hris_database_column_exists($pdo, 'overtime', 'work_date')
        ? 'work_date'
        : (hris_database_column_exists($pdo, 'overtime', 'overtime_date') ? 'overtime_date' : '');

    if ($dateColumn === '') {
        return 0.0;
    }

    $hourColumns = array_values(array_filter(
        ['hour_requested', 'duration', 'overtime_hours', 'hours_worked'],
        static fn (string $column): bool => hris_database_column_exists($pdo, 'overtime', $column)
    ));

    if ($hourColumns === []) {
        return 0.0;
    }

    $hoursExpression = 'COALESCE(' . implode(', ', $hourColumns) . ', 0)';
    $statusFilter = hris_database_column_exists($pdo, 'overtime', 'status')
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
        'canEdit' => attendance_can_edit($user),
        'canApproveAdjustments' => attendance_can_approve_adjustments($user),
        'canRequestAdjustment' => attendance_can_request_adjustment($user),
        'isPersonal' => attendance_role_key($user) === 'employee',
    ];
}

function attendance_scope_sql(PDO $pdo, array $user, string $employeeAlias = 'e'): array
{
    $role = attendance_role_key($user);
    $conditions = ["{$employeeAlias}.is_archived = 0"];
    $params = [];

    if ($role === 'employee') {
        $employeeId = hris_session_employee_record_id($pdo, $user);
        if ($employeeId === null) {
            $conditions[] = '1 = 0';
        } else {
            $conditions[] = "{$employeeAlias}.id = :scope_employee_id";
            $params[':scope_employee_id'] = $employeeId;
        }
    } elseif ($role === 'chief') {
        $division = attendance_text($user['division'] ?? '');
        if ($division !== '') {
            $conditions[] = 'd.name = :scope_division';
            $params[':scope_division'] = $division;
        }
    }

    return [$conditions, $params];
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
        return [
            ...$employee,
            'employeeRecordId' => (int)$employee['employeeRecordId'],
        ];
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

        return [
            ...$record,
            'amTimeIn' => $punches['amTimeIn'],
            'amTimeOut' => $punches['amTimeOut'],
            'pmTimeIn' => $punches['pmTimeIn'],
            'pmTimeOut' => $punches['pmTimeOut'],
        ];
    }, $records);
}

function attendance_list_records(PDO $pdo, array $user): void
{
    [$conditions, $params] = attendance_scope_sql($pdo, $user, 'e');

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

    $departments = array_values(array_unique(array_filter(array_map(
        static fn (array $record): string => attendance_text($record['department'] ?? ''),
        $records
    ))));
    sort($departments);

    $summary = [
        'totalRecords' => count($records),
        'present' => 0,
        'late' => 0,
        'undertime' => 0,
        'incomplete' => 0,
        'missingTimeLogs' => 0,
        'totalRenderedMinutes' => 0,
        'totalLateMinutes' => 0,
        'totalUndertimeMinutes' => 0,
    ];

    foreach ($records as $record) {
        $recordStatus = strtolower((string)$record['status']);
        if ($recordStatus === 'present') {
            $summary['present']++;
        }
        if (str_contains($recordStatus, 'late')) {
            $summary['late']++;
        }
        if (str_contains($recordStatus, 'undertime')) {
            $summary['undertime']++;
        }
        if ($recordStatus === 'incomplete') {
            $summary['incomplete']++;
            $summary['missingTimeLogs']++;
        }

        $summary['totalRenderedMinutes'] += (int)$record['totalMinutes'];
        $summary['totalLateMinutes'] += (int)$record['lateMinutes'];
        $summary['totalUndertimeMinutes'] += (int)$record['undertimeMinutes'];
    }

    json_response([
        'success' => true,
        'records' => $records,
        'summary' => $summary,
        'departments' => $departments,
        'employees' => attendance_fetch_employees($pdo, $user),
        'adjustments' => attendance_fetch_adjustments($pdo, $user, false),
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
        return [
            ...$log,
            'id' => (int)$log['id'],
            'punchTypeLabel' => attendance_client_punch_type((string)$log['punchType']),
        ];
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

    return [
        'id' => (int)$recordIdStatement->fetchColumn(),
        ...$metrics,
    ];
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

        if (preg_match('/^emp2026-(\d{4})$/i', $employeeCode, $matches) === 1) {
            $numericCode = (string)((int)$matches[1]);
            $map[$numericCode] = $map[$numericCode] ?? $employeeId;
            $map[$matches[1]] = $map[$matches[1]] ?? $employeeId;
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
            'message' => 'Choose a CSV file to import.',
        ], 422);
    }

    $file = $_FILES['attendanceFile'];
    if ((int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response([
            'success' => false,
            'message' => 'Unable to upload the CSV file.',
        ], 422);
    }

    $path = (string)($file['tmp_name'] ?? '');
    $handle = fopen($path, 'rb');
    if ($handle === false) {
        json_response([
            'success' => false,
            'message' => 'Unable to read the CSV file.',
        ], 422);
    }

    $employeeMap = attendance_employee_map($pdo);
    $summary = [
        'totalRows' => 0,
        'totalImported' => 0,
        'duplicatesSkipped' => 0,
        'invalidRows' => 0,
        'successfulRecords' => 0,
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
            (:employee_id, :punch_at, :punch_type, :raw_state, "csv", :created_by_user_id)'
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
            $importDates[$dateTime->format('Y-m-d')] = true;
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
                ':created_by_user_id' => $createdBy,
            ]);
            $summary['totalImported']++;
            $affectedDates[$employeeId . '|' . $dateTime->format('Y-m-d')] = [
                'employeeId' => $employeeId,
                'date' => $dateTime->format('Y-m-d'),
            ];
        }

        fclose($handle);

        foreach ($affectedDates as $affected) {
            attendance_rollup_daily_from_logs($pdo, (int)$affected['employeeId'], (string)$affected['date'], $createdBy);
            $summary['successfulRecords']++;
        }

        if ($importDates !== []) {
            $sortedImportDates = array_keys($importDates);
            sort($sortedImportDates);
            $summary['dateFrom'] = $sortedImportDates[0];
            $summary['dateTo'] = $sortedImportDates[count($sortedImportDates) - 1];
        }

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
                'Attendance import completed with %d new record%s.',
                $notificationCount,
                $notificationCount === 1 ? '' : 's'
            );
            $notificationReference = isset($summary['dateFrom'], $summary['dateTo'])
                ? $summary['dateFrom'] . ':' . $summary['dateTo']
                : 'attendance-import';

            hris_notify_roles(
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

        $adjustmentStatement = $pdo->prepare(
            'INSERT INTO attendance_adjustments
                (attendance_daily_record_id, employee_id, attendance_date, requested_time_in, requested_time_out, reason, status, requested_by_user_id, reviewed_by_user_id, reviewed_at, remarks)
             VALUES
                (:attendance_daily_record_id, :employee_id, :attendance_date, :requested_time_in, :requested_time_out, :reason, "approved", :requested_by_user_id, :reviewed_by_user_id, NOW(), :remarks)'
        );
        $adjustmentStatement->execute([
            ':attendance_daily_record_id' => (int)$result['id'],
            ':employee_id' => (int)$record['employeeRecordId'],
            ':attendance_date' => $record['date'],
            ':requested_time_in' => $timeIn,
            ':requested_time_out' => $timeOut,
            ':reason' => attendance_text($body['reason'] ?? 'Manual attendance update'),
            ':requested_by_user_id' => $updatedBy,
            ':reviewed_by_user_id' => $updatedBy,
            ':remarks' => 'Direct edit by authorized user.',
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $employeeName = trim((string)($record['employeeName'] ?? '')) !== ''
            ? trim((string)($record['employeeName'] ?? ''))
            : 'the employee';
        $recordDateLabel = (new DateTimeImmutable((string)$record['date']))->format('M j, Y');

        hris_notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Attendance Record Updated',
            sprintf('Attendance record for %s on %s was updated.', $employeeName, $recordDateLabel),
            'attendance_updated',
            (string)$recordId
        );

        hris_notify_employee(
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

function attendance_request_adjustment(PDO $pdo, array $body, array $user): void
{
    if (!attendance_can_request_adjustment($user)) {
        json_response([
            'success' => false,
            'message' => 'Only employee accounts can request attendance adjustments.',
        ], 403);
    }

    $recordId = (int)($body['recordId'] ?? $body['id'] ?? 0);
    $record = attendance_fetch_record($pdo, $recordId, $user);
    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Attendance record was not found.',
        ], 404);
    }

    $reason = attendance_text($body['reason'] ?? '');
    if ($reason === '') {
        json_response([
            'success' => false,
            'message' => 'Reason for adjustment is required.',
        ], 422);
    }

    $timeIn = attendance_datetime_for_date($body['timeIn'] ?? null, $record['date']);
    $timeOut = attendance_datetime_for_date($body['timeOut'] ?? null, $record['date']);

    $statement = $pdo->prepare(
        'INSERT INTO attendance_adjustments
            (attendance_daily_record_id, employee_id, attendance_date, requested_time_in, requested_time_out, reason, status, requested_by_user_id)
         VALUES
            (:attendance_daily_record_id, :employee_id, :attendance_date, :requested_time_in, :requested_time_out, :reason, "pending", :requested_by_user_id)'
    );
    $statement->execute([
        ':attendance_daily_record_id' => $recordId,
        ':employee_id' => (int)$record['employeeRecordId'],
        ':attendance_date' => $record['date'],
        ':requested_time_in' => $timeIn,
        ':requested_time_out' => $timeOut,
        ':reason' => $reason,
        ':requested_by_user_id' => (int)($user['id'] ?? 0) ?: null,
    ]);

    $adjustmentId = (int)$pdo->lastInsertId();

    try {
        $employeeName = trim((string)($record['employeeName'] ?? '')) !== ''
            ? trim((string)($record['employeeName'] ?? ''))
            : 'an employee';
        $recordDateLabel = (new DateTimeImmutable((string)$record['date']))->format('M j, Y');

        hris_notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Attendance Adjustment Requested',
            sprintf('%s requested an attendance adjustment for %s.', $employeeName, $recordDateLabel),
            'attendance_updated',
            $adjustmentId > 0 ? (string)$adjustmentId : (string)$recordId
        );
    } catch (Throwable $notificationException) {
        error_log('Attendance adjustment request notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Attendance adjustment request submitted.',
    ], 201);
}

function attendance_fetch_adjustments(PDO $pdo, array $user, bool $sendResponse): array
{
    [$conditions, $params] = attendance_scope_sql($pdo, $user, 'e');

    if (!attendance_can_approve_adjustments($user) && attendance_role_key($user) !== 'employee') {
        $conditions[] = '1 = 0';
    }

    $statement = $pdo->prepare(
        'SELECT
            aa.id,
            aa.attendance_daily_record_id AS recordId,
            aa.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS department,
            aa.attendance_date AS date,
            aa.requested_time_in AS requestedTimeIn,
            aa.requested_time_out AS requestedTimeOut,
            aa.reason,
            aa.status,
            aa.remarks,
            aa.created_at AS requestedAt,
            aa.reviewed_at AS reviewedAt,
            requester.username AS requestedBy,
            reviewer.username AS reviewedBy
         FROM attendance_adjustments aa
         INNER JOIN employees e ON e.id = aa.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN users requester ON requester.id = aa.requested_by_user_id
         LEFT JOIN users reviewer ON reviewer.id = aa.reviewed_by_user_id
         WHERE ' . implode(' AND ', $conditions) . '
         ORDER BY FIELD(aa.status, "pending", "approved", "rejected"), aa.created_at DESC
         LIMIT 200'
    );
    $statement->execute($params);

    $adjustments = array_map(static function (array $adjustment): array {
        return [
            ...$adjustment,
            'id' => (int)$adjustment['id'],
            'recordId' => $adjustment['recordId'] !== null ? (int)$adjustment['recordId'] : null,
            'employeeRecordId' => (int)$adjustment['employeeRecordId'],
        ];
    }, $statement->fetchAll());

    if ($sendResponse) {
        json_response([
            'success' => true,
            'adjustments' => $adjustments,
            'permissions' => attendance_permissions($user),
        ]);
    }

    return $adjustments;
}

function attendance_update_adjustment_status(PDO $pdo, array $body, array $user): void
{
    if (!attendance_can_approve_adjustments($user)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to approve attendance adjustments.',
        ], 403);
    }

    $adjustmentId = (int)($body['adjustmentId'] ?? $body['id'] ?? 0);
    $status = strtolower(attendance_text($body['status'] ?? ''));
    if (!in_array($status, ['approved', 'rejected'], true)) {
        json_response([
            'success' => false,
            'message' => 'Adjustment status must be approved or rejected.',
        ], 422);
    }

    $statement = $pdo->prepare(
        'SELECT
            aa.*,
            e.is_archived,
            d.name AS department
         FROM attendance_adjustments aa
         INNER JOIN employees e ON e.id = aa.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE aa.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $adjustmentId]);
    $adjustment = $statement->fetch();

    if (!$adjustment || (int)($adjustment['is_archived'] ?? 1) === 1) {
        json_response([
            'success' => false,
            'message' => 'Attendance adjustment was not found.',
        ], 404);
    }

    $reviewedBy = (int)($user['id'] ?? 0) ?: null;

    $pdo->beginTransaction();
    try {
        $updateStatement = $pdo->prepare(
            'UPDATE attendance_adjustments
             SET status = :status,
                 reviewed_by_user_id = :reviewed_by_user_id,
                 reviewed_at = NOW(),
                 remarks = :remarks
             WHERE id = :id'
        );
        $updateStatement->execute([
            ':status' => $status,
            ':reviewed_by_user_id' => $reviewedBy,
            ':remarks' => attendance_text($body['remarks'] ?? ''),
            ':id' => $adjustmentId,
        ]);

        if ($status === 'approved') {
            attendance_upsert_daily_record(
                $pdo,
                (int)$adjustment['employee_id'],
                (string)$adjustment['attendance_date'],
                $adjustment['requested_time_in'] !== null ? (string)$adjustment['requested_time_in'] : null,
                $adjustment['requested_time_out'] !== null ? (string)$adjustment['requested_time_out'] : null,
                'adjusted',
                $reviewedBy
            );
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $recordDateLabel = (new DateTimeImmutable((string)$adjustment['attendance_date']))->format('M j, Y');
        $notificationTitle = $status === 'approved'
            ? 'Attendance Adjustment Approved'
            : 'Attendance Adjustment Rejected';
        $notificationMessage = sprintf(
            'Your attendance adjustment for %s was %s.',
            $recordDateLabel,
            $status
        );

        hris_notify_employee(
            $pdo,
            (int)$adjustment['employee_id'],
            $notificationTitle,
            $notificationMessage,
            'attendance_updated',
            (string)$adjustmentId
        );
    } catch (Throwable $notificationException) {
        error_log('Attendance adjustment status notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => $status === 'approved' ? 'Attendance adjustment approved.' : 'Attendance adjustment rejected.',
    ]);
}

function attendance_get_dtr(PDO $pdo, array $user): void
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
    } elseif (attendance_role_key($user) === 'employee') {
        $employeeRecordId = (int)(hris_session_employee_record_id($pdo, $user) ?? 0);
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

    json_response([
        'success' => true,
        'employee' => [
            ...$employee,
            'employeeRecordId' => (int)$employee['employeeRecordId'],
        ],
        'month' => $month,
        'startDate' => $startDate,
        'endDate' => $endDate,
        'records' => $records,
        'leaveDates' => $leaveDates,
        'totals' => $totals,
        'permissions' => attendance_permissions($user),
    ]);
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $action = attendance_text($_GET['action'] ?? $_POST['action'] ?? '');

    if ($method === 'GET') {
        if ($action === 'logs') {
            attendance_get_logs($pdo, $sessionUser);
        }

        if ($action === 'dtr') {
            attendance_get_dtr($pdo, $sessionUser);
        }

        if ($action === 'adjustments') {
            attendance_fetch_adjustments($pdo, $sessionUser, true);
        }

        attendance_list_records($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        if ($action === 'import') {
            attendance_import_csv($pdo, $sessionUser);
        }

        if ($action === 'requestAdjustment') {
            attendance_request_adjustment($pdo, read_json_body(), $sessionUser);
        }
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        if (attendance_text($body['action'] ?? '') === 'adjustmentStatus') {
            attendance_update_adjustment_status($pdo, $body, $sessionUser);
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
