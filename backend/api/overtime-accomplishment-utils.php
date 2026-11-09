<?php
declare(strict_types=1);

/*
 * Accomplishment reports for rendered overtime.
 *
 * Once the Regional Director has approved an overtime request and the hours have been rendered,
 * the employee files the office's memorandum "Accomplishment Report of Task Rendered During
 * Overtime" -- what the time was spent on and what it produced -- and the division chief notes it.
 * That memo is what supports a later CTO/CDO application, so it hangs off the overtime row it
 * accounts for: one report per filing, revised in place when the chief returns it.
 *
 * overtime.php routes the actions here rather than a separate endpoint so the screen keeps
 * refreshing on the one `overtime` topic it already subscribes to.
 */

function ensure_overtime_accomplishment_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    /* Checked first: CREATE TABLE is DDL, and DDL inside a caller's transaction would commit it. */
    if (!database_table_exists($pdo, 'overtime_accomplishment_reports')) {
        $pdo->exec(
            'CREATE TABLE overtime_accomplishment_reports (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                overtime_id INT UNSIGNED NOT NULL,
                employee_id INT UNSIGNED NOT NULL,
                report_date DATE NOT NULL,
                time_start TIME NOT NULL,
                time_end TIME NOT NULL,
                location VARCHAR(120) NOT NULL DEFAULT "Office",
                tasks_performed TEXT NOT NULL,
                outputs_delivered TEXT NOT NULL,
                status ENUM("Pending", "Approved", "Rejected") NOT NULL DEFAULT "Pending",
                remarks VARCHAR(500) NULL DEFAULT NULL,
                noted_by INT UNSIGNED NULL DEFAULT NULL,
                noted_at DATETIME NULL DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_overtime_accomplishment_overtime (overtime_id),
                KEY idx_overtime_accomplishment_employee (employee_id),
                KEY idx_overtime_accomplishment_status (status),
                CONSTRAINT fk_overtime_accomplishment_overtime FOREIGN KEY (overtime_id) REFERENCES overtime (overtime_id) ON DELETE CASCADE,
                CONSTRAINT fk_overtime_accomplishment_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
                CONSTRAINT fk_overtime_accomplishment_noted_by FOREIGN KEY (noted_by) REFERENCES employees (id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    $ensured = true;
}

/** The desk that notes a report: the division chief, with the administrator able to stand in. */
function overtime_accomplishment_can_note(array $user): bool
{
    return in_array(user_role_key($user), ['chief', 'admin'], true);
}

function overtime_accomplishment_status_to_database(mixed $status): string
{
    return match (strtolower(trim((string)($status ?? '')))) {
        'approved', 'noted' => 'Approved',
        'rejected', 'returned' => 'Rejected',
        default => 'Pending',
    };
}

/** 'H:i' from a time input, or 'H:i:s' from the database, to the stored 'H:i:s'. */
function overtime_accomplishment_time_or_null(mixed $value): ?string
{
    $text = trim((string)($value ?? ''));
    if ($text === '') {
        return null;
    }

    foreach (['H:i', 'H:i:s'] as $format) {
        $time = DateTime::createFromFormat($format, $text);
        if ($time && $time->format($format) === $text) {
            return $time->format('H:i:s');
        }
    }

    return null;
}

/**
 * The tasks arrive either as a list or as one text with a task per line; either way each task is
 * stored as its own line, with any bullet the writer typed themselves taken off so the memo does not
 * print two.
 */
function overtime_accomplishment_lines(mixed $value): array
{
    $items = is_array($value) ? $value : (preg_split('/\R/u', (string)($value ?? '')) ?: []);
    $lines = [];

    foreach ($items as $item) {
        $line = trim(preg_replace('/^[\s\x{2022}\-\*\x{2013}\x{2014}]+/u', '', (string)$item) ?? '');
        if ($line !== '') {
            $lines[] = $line;
        }
    }

    return $lines;
}

/**
 * The memo's details as the overtime request carries them -- the window, location, tasks (the
 * request's reason, a task per line) and expected output -- or null when the request lacks any of
 * them: filed before they were asked for, or edited by a client that did not send them.
 * AccomplishmentReportMemo.jsx draws the memo read-only on exactly the same test.
 */
function overtime_accomplishment_values_from_filing(array $overtime): ?array
{
    $timeStart = overtime_accomplishment_time_or_null($overtime['timeStart'] ?? null);
    $timeEnd = overtime_accomplishment_time_or_null($overtime['timeEnd'] ?? null);
    $tasks = overtime_accomplishment_lines($overtime['reason'] ?? '');
    $outputs = trim((string)($overtime['expectedOutputs'] ?? ''));

    if ($timeStart === null || $timeEnd === null || $timeEnd <= $timeStart || $tasks === [] || $outputs === '') {
        return null;
    }

    return [
        'timeStart' => $timeStart,
        'timeEnd' => $timeEnd,
        'location' => trim((string)($overtime['location'] ?? '')),
        'tasks' => $tasks,
        'outputs' => $outputs,
    ];
}

function overtime_accomplishment_row_to_record(array $row): array
{
    $row['id'] = (int)$row['id'];
    $row['overtimeId'] = (int)$row['overtimeId'];
    $row['employeeRecordId'] = (int)$row['employeeRecordId'];
    $row['hourRequested'] = (float)$row['hourRequested'];
    $row['notedByEmployeeRecordId'] = $row['notedByEmployeeRecordId'] !== null ? (int)$row['notedByEmployeeRecordId'] : null;
    $row['tasks'] = overtime_accomplishment_lines($row['tasksPerformed'] ?? '');
    $row['remarks'] = trim((string)($row['remarks'] ?? ''));

    return $row;
}

function overtime_accomplishment_select_sql(): string
{
    return 'SELECT
                r.id,
                r.overtime_id AS overtimeId,
                r.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                ' . employee_role_name_subselect() . ' AS employeeRole,
                o.work_date AS workDate,
                o.hour_requested AS hourRequested,
                o.reason,
                o.status AS overtimeStatus,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS overtimeApprovedBy,
                o.approved_at AS overtimeApprovedAt,
                r.report_date AS reportDate,
                r.time_start AS timeStart,
                r.time_end AS timeEnd,
                r.location,
                r.tasks_performed AS tasksPerformed,
                r.outputs_delivered AS outputsDelivered,
                r.status,
                r.remarks,
                r.noted_by AS notedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(noted_employee.first_name, " ", COALESCE(noted_employee.middle_name, ""), " ", noted_employee.last_name)), ""), "") AS notedBy,
                r.noted_at AS notedAt,
                r.created_at AS createdAt,
                r.updated_at AS updatedAt
            FROM overtime_accomplishment_reports r
            INNER JOIN overtime o ON o.overtime_id = r.overtime_id
            INNER JOIN employees e ON e.id = r.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN employees approved_employee ON approved_employee.id = o.approved_by
            LEFT JOIN employees noted_employee ON noted_employee.id = r.noted_by';
}

function fetch_overtime_accomplishment(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = overtime_accomplishment_select_sql() . ' WHERE r.id = :id';
    $params = [':id' => $id];

    if ($employeeScopeId !== null) {
        $sql .= ' AND r.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $statement = $pdo->prepare($sql . ' LIMIT 1');
    $statement->execute($params);
    $row = $statement->fetch();

    return $row ? overtime_accomplishment_row_to_record($row) : null;
}

/**
 * Employees see their own reports; every other role sees them all. The chief's desk is
 * organization-wide here for the same reason it is on overtime and CTO filings -- not every division
 * has a chief account, and a report must always reach somebody who can note it.
 */
function list_overtime_accomplishments(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = overtime_can_view_all($sessionUser) ? null : resolve_overtime_session_employee_id($pdo, $sessionUser);

    $sql = overtime_accomplishment_select_sql() . ' WHERE o.is_archived = 0';
    $params = [];

    if ($employeeScopeId !== null) {
        $sql .= ' AND r.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $statement = $pdo->prepare($sql . ' ORDER BY r.created_at DESC, r.id DESC');
    $statement->execute($params);

    json_response([
        'success' => true,
        'records' => array_map('overtime_accomplishment_row_to_record', $statement->fetchAll()),
    ]);
}

/**
 * Puts a short `accomplishmentReport` on each overtime row (null when none has been filed), so the
 * request table can offer the Submit action on the rows that still need one and show the state of
 * the rest without a second request.
 */
function attach_overtime_accomplishment_summaries(PDO $pdo, array &$records): void
{
    $ids = [];
    foreach ($records as $record) {
        $id = (int)($record['id'] ?? 0);
        if ($id > 0) {
            $ids[] = $id;
        }
    }

    foreach ($records as &$record) {
        $record['accomplishmentReport'] = null;
    }
    unset($record);

    if ($ids === []) {
        return;
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'SELECT id, overtime_id, status, remarks, noted_at, created_at, updated_at
         FROM overtime_accomplishment_reports
         WHERE overtime_id IN (' . $placeholders . ')'
    );
    $statement->execute($ids);

    $summaries = [];
    foreach ($statement->fetchAll() as $row) {
        $summaries[(int)$row['overtime_id']] = [
            'id' => (int)$row['id'],
            'status' => (string)$row['status'],
            'remarks' => trim((string)($row['remarks'] ?? '')),
            'notedAt' => $row['noted_at'],
            'submittedAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
        ];
    }

    foreach ($records as &$record) {
        $record['accomplishmentReport'] = $summaries[(int)($record['id'] ?? 0)] ?? null;
    }
    unset($record);
}

function submit_overtime_accomplishment(PDO $pdo, array $body, array $sessionUser): void
{
    $overtimeId = (int)($body['overtimeId'] ?? $body['overtime_id'] ?? 0);
    $timeStart = overtime_accomplishment_time_or_null($body['timeStart'] ?? $body['time_start'] ?? null);
    $timeEnd = overtime_accomplishment_time_or_null($body['timeEnd'] ?? $body['time_end'] ?? null);
    $location = trim((string)($body['location'] ?? ''));
    $tasks = overtime_accomplishment_lines($body['tasks'] ?? $body['tasksPerformed'] ?? $body['tasks_performed'] ?? '');
    $outputs = trim((string)($body['outputs'] ?? $body['outputsDelivered'] ?? $body['outputs_delivered'] ?? ''));

    if ($overtimeId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Overtime request is required.',
        ], 422);
    }

    /* The report is the employee's own account of the hours, so only the employee it was rendered by files it. */
    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    if ($sessionEmployeeId === null) {
        json_response([
            'success' => false,
            'message' => 'Signed-in employee record was not found.',
        ], 422);
    }

    $overtime = fetch_overtime($pdo, $overtimeId);
    if ($overtime === null || (int)$overtime['employeeRecordId'] !== $sessionEmployeeId) {
        json_response([
            'success' => false,
            'message' => 'Overtime request was not found.',
        ], 404);
    }

    if (strtolower((string)$overtime['status']) !== 'approved' || strtolower((string)$overtime['source']) === 'manual_coc') {
        json_response([
            'success' => false,
            'message' => 'An accomplishment report can only be submitted for an approved overtime request.',
        ], 422);
    }

    /* Overtime is authorized before it is rendered; the report of what was done comes after. */
    if ((string)$overtime['workDate'] > date('Y-m-d')) {
        json_response([
            'success' => false,
            'message' => 'The overtime has not been rendered yet. Submit the report on or after the work date.',
        ], 422);
    }

    $existingStatement = $pdo->prepare(
        'SELECT id, status FROM overtime_accomplishment_reports WHERE overtime_id = :overtime_id LIMIT 1'
    );
    $existingStatement->execute([':overtime_id' => $overtimeId]);
    $existing = $existingStatement->fetch();

    if ($existing && strtolower((string)$existing['status']) !== 'rejected') {
        json_response([
            'success' => false,
            'message' => strtolower((string)$existing['status']) === 'approved'
                ? 'This overtime already has an accomplishment report noted by the chief.'
                : 'An accomplishment report for this overtime is already waiting for the chief.',
        ], 422);
    }

    /*
     * A first report on a request that carries the memo's details is made of those details: the
     * memo is shown to the employee to review, not to rewrite, so whatever the form sent is not
     * consulted. A memo the chief returned is revised by hand, as is one for a request filed before
     * the details were asked for.
     */
    $fromFiling = $existing ? null : overtime_accomplishment_values_from_filing($overtime);
    if ($fromFiling !== null) {
        $timeStart = $fromFiling['timeStart'];
        $timeEnd = $fromFiling['timeEnd'];
        $location = $fromFiling['location'];
        $tasks = $fromFiling['tasks'];
        $outputs = $fromFiling['outputs'];
    }

    $errors = [];
    if ($timeStart === null || $timeEnd === null) {
        $errors[] = 'Enter the time the overtime started and ended.';
    } elseif ($timeEnd <= $timeStart) {
        $errors[] = 'The end time must be later than the start time.';
    }
    if (mb_strlen($location) > 120) {
        $errors[] = 'Location must be 120 characters or fewer.';
    }
    if ($tasks === []) {
        $errors[] = 'List at least one task performed.';
    }
    if ($outputs === '') {
        $errors[] = 'Describe the output delivered.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $params = [
        ':report_date' => date('Y-m-d'),
        ':time_start' => $timeStart,
        ':time_end' => $timeEnd,
        ':location' => $location !== '' ? $location : 'Office',
        ':tasks_performed' => implode("\n", $tasks),
        ':outputs_delivered' => $outputs,
    ];

    if ($existing) {
        /* A returned report is revised in place: back to the chief's desk, the return remarks cleared. */
        $statement = $pdo->prepare(
            'UPDATE overtime_accomplishment_reports
             SET report_date = :report_date,
                 time_start = :time_start,
                 time_end = :time_end,
                 location = :location,
                 tasks_performed = :tasks_performed,
                 outputs_delivered = :outputs_delivered,
                 status = "Pending",
                 remarks = NULL,
                 noted_by = NULL,
                 noted_at = NULL
             WHERE id = :id'
        );
        $statement->execute($params + [':id' => (int)$existing['id']]);
        $reportId = (int)$existing['id'];
    } else {
        $statement = $pdo->prepare(
            'INSERT INTO overtime_accomplishment_reports
                (overtime_id, employee_id, report_date, time_start, time_end, location, tasks_performed, outputs_delivered, status)
             VALUES
                (:overtime_id, :employee_id, :report_date, :time_start, :time_end, :location, :tasks_performed, :outputs_delivered, "Pending")'
        );
        $statement->execute($params + [
            ':overtime_id' => $overtimeId,
            ':employee_id' => $sessionEmployeeId,
        ]);
        $reportId = (int)$pdo->lastInsertId();
    }

    $record = fetch_overtime_accomplishment($pdo, $reportId);

    notify_roles(
        $pdo,
        ['chief'],
        $existing ? 'Accomplishment Report Resubmitted' : 'Accomplishment Report Submitted',
        sprintf(
            '%s submitted an accomplishment report for overtime rendered on %s. It is waiting to be noted.',
            (string)($record['employeeName'] ?? 'An employee'),
            date('F j, Y', strtotime((string)$record['workDate']))
        ),
        'overtime_accomplishment_submitted',
        'overtime_accomplishment:' . $reportId
    );

    json_response([
        'success' => true,
        'message' => $existing
            ? 'Accomplishment report resubmitted to the division chief.'
            : 'Accomplishment report submitted to the division chief.',
        'record' => $record,
    ], $existing ? 200 : 201);
}

function update_overtime_accomplishment_status(PDO $pdo, array $body, array $sessionUser): void
{
    if (!overtime_accomplishment_can_note($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only the division chief can note accomplishment reports.',
        ], 403);
    }

    $id = (int)($body['reportId'] ?? $body['id'] ?? 0);
    $status = overtime_accomplishment_status_to_database($body['status'] ?? '');
    $remarks = trim((string)($body['remarks'] ?? ''));

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Accomplishment report is required.',
        ], 422);
    }

    if ($status === 'Pending') {
        json_response([
            'success' => false,
            'message' => 'Choose whether to note or return the accomplishment report.',
        ], 422);
    }

    if ($status === 'Rejected' && $remarks === '') {
        json_response([
            'success' => false,
            'message' => 'Tell the employee what to revise before returning the report.',
        ], 422);
    }

    if (mb_strlen($remarks) > 500) {
        json_response([
            'success' => false,
            'message' => 'Remarks must be 500 characters or fewer.',
        ], 422);
    }

    $current = fetch_overtime_accomplishment($pdo, $id);
    if ($current === null) {
        json_response([
            'success' => false,
            'message' => 'Accomplishment report was not found.',
        ], 404);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    if ($sessionEmployeeId !== null && $sessionEmployeeId === (int)$current['employeeRecordId']) {
        json_response([
            'success' => false,
            'message' => 'You cannot note your own accomplishment report.',
        ], 403);
    }

    if (strtolower((string)$current['status']) !== 'pending') {
        json_response([
            'success' => false,
            'message' => 'This accomplishment report has already been acted on.',
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE overtime_accomplishment_reports
         SET status = :status,
             remarks = :remarks,
             noted_by = :noted_by,
             noted_at = :noted_at
         WHERE id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':remarks' => $remarks !== '' ? $remarks : null,
        ':noted_by' => $sessionEmployeeId,
        ':noted_at' => date('Y-m-d H:i:s'),
        ':id' => $id,
    ]);

    $record = fetch_overtime_accomplishment($pdo, $id);
    $workDateLabel = date('F j, Y', strtotime((string)$record['workDate']));

    notify_employee(
        $pdo,
        (int)$record['employeeRecordId'],
        $status === 'Approved' ? 'Accomplishment Report Noted' : 'Accomplishment Report Returned',
        $status === 'Approved'
            ? sprintf('Your accomplishment report for overtime rendered on %s was noted by the division chief.', $workDateLabel)
            : sprintf('Your accomplishment report for overtime rendered on %s was returned: %s', $workDateLabel, $remarks),
        $status === 'Approved' ? 'overtime_accomplishment_noted' : 'overtime_accomplishment_returned',
        'overtime_accomplishment:' . $id
    );

    json_response([
        'success' => true,
        'message' => $status === 'Approved'
            ? 'Accomplishment report noted.'
            : 'Accomplishment report returned to the employee for revision.',
        'record' => $record,
    ]);
}
