<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/pass-slip-utils.php';

$publicPassSlipScan = defined('HRIS_PUBLIC_PASS_SLIP_SCAN')
    && constant('HRIS_PUBLIC_PASS_SLIP_SCAN') === true;
$sessionUser = $publicPassSlipScan ? null : require_session_user();

function pass_slip_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function pass_slip_date_or_null(mixed $value): ?string
{
    $text = pass_slip_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function pass_slip_role_key(array $user): string
{
    return user_role_key($user);
}

function pass_slip_can_manage(array $user): bool
{
    return in_array(pass_slip_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector'], true);
}

function pass_slip_can_view_all(array $user): bool
{
    return !in_array(pass_slip_role_key($user), ['employee', 'cashier'], true);
}

/*
 * The desk confined to its own division. A Chief reads and archives the pass slips of their
 * division's staff; HR Staff, the HR Head, and the Regional Director work organization-wide.
 * Mirrors DIVISION_SCOPED_PASS_SLIP_ROLE_KEYS in PassSlipWorkspace.jsx.
 */
const PASS_SLIP_DIVISION_SCOPED_ROLES = ['chief'];

/**
 * The division a caller's pass slip view is confined to: null for an organization-wide desk, the
 * division id for a scoped one, and 0 when the scoped desk has no division on its employee record,
 * which the queries turn into an empty list rather than everybody's.
 */
function pass_slip_division_scope_id(PDO $pdo, array $user): ?int
{
    if (!in_array(pass_slip_role_key($user), PASS_SLIP_DIVISION_SCOPED_ROLES, true)) {
        return null;
    }

    $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
    $statement->execute([':id' => resolve_pass_slip_session_employee_id($pdo, $user)]);
    $divisionId = (int)$statement->fetchColumn();

    return $divisionId > 0 ? $divisionId : 0;
}

/** The employee and division a caller's reads, archives and filings are confined to. */
function pass_slip_read_scopes(PDO $pdo, array $user): array
{
    return [
        'employeeId' => pass_slip_can_view_all($user) ? null : resolve_pass_slip_session_employee_id($pdo, $user),
        'divisionId' => pass_slip_division_scope_id($pdo, $user),
    ];
}

/** Appends the scope conditions to a query on `pass_slip ps` joined to `employees e`. */
function pass_slip_apply_scopes(string $sql, array $params, array $scopes): array
{
    if ($scopes['employeeId'] !== null) {
        $sql .= ' AND ps.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $scopes['employeeId'];
    }

    if ($scopes['divisionId'] !== null) {
        if ($scopes['divisionId'] > 0) {
            $sql .= ' AND e.division_id = :division_scope_id';
            $params[':division_scope_id'] = $scopes['divisionId'];
        } else {
            $sql .= ' AND 1 = 0';
        }
    }

    return [$sql, $params];
}

function resolve_pass_slip_session_employee_id(PDO $pdo, array $user): int
{
    $employeeCode = pass_slip_text($user['employee_id'] ?? '');
    $employeeName = pass_slip_text($user['full_name'] ?? '');

    if ($employeeCode !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $employeeCode]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    if ($employeeName !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $employeeName]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

    json_response([
        'success' => false,
        'message' => 'Signed-in employee record was not found.',
    ], 422);
}

function resolve_pass_slip_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!pass_slip_can_view_all($sessionUser)) {
        return resolve_pass_slip_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = pass_slip_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = pass_slip_text($body['employeeName'] ?? '');
    $id = 0;

    if ($employeeRecordId > 0) {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
        $statement->execute([':id' => $employeeRecordId]);
        $id = (int)$statement->fetchColumn();
    }

    if ($id <= 0 && $employeeCode !== '') {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE employee_id = :employee_id AND is_archived = 0 LIMIT 1');
        $statement->execute([':employee_id' => $employeeCode]);
        $id = (int)$statement->fetchColumn();
    }

    if ($id <= 0 && $employeeName !== '') {
        $statement = $pdo->prepare(
            'SELECT id
             FROM employees
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) = :employee_name
               AND is_archived = 0
             LIMIT 1'
        );
        $statement->execute([':employee_name' => $employeeName]);
        $id = (int)$statement->fetchColumn();
    }

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Selected employee was not found.',
        ], 422);
    }

    /* A division desk files only for its own division's staff. */
    $divisionScopeId = pass_slip_division_scope_id($pdo, $sessionUser);
    if ($divisionScopeId !== null) {
        $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id LIMIT 1');
        $statement->execute([':id' => $id]);

        if ($divisionScopeId <= 0 || (int)$statement->fetchColumn() !== $divisionScopeId) {
            json_response([
                'success' => false,
                'message' => 'You can only file pass slips for employees in your division.',
            ], 403);
        }
    }

    return $id;
}

/*
 * The one SELECT list behind every read of a slip.
 *
 * Everything an employee would otherwise retype -- name, employee number, position, division -- is
 * read straight off the `employees` row, so the form never asks for it and a later change to the
 * profile is reflected on the slip rather than frozen into a copy of it.
 *
 * `departureTime`/`timeReturned` are kept as aliases of the actual stamps. Nothing types those two
 * any more, but the printed form, the register and the archived rows all still read them by those
 * names, and the columns behind them now hold the time the scan landed.
 */
function pass_slip_select_sql(): string
{
    return 'SELECT
                ps.id,
                ps.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                des.name AS position,
                e.employment_status AS employmentStatus,
                e.profile_image AS profileImage,
                ' . employee_role_name_subselect() . ' AS employeeRole,
                ps.pass_date AS passDate,
                ps.status,
                ps.pass_type AS passType,
                ps.expected_minutes AS expectedMinutes,
                ps.time_out_at AS timeOutAt,
                ps.time_in_at AS timeInAt,
                DATE(ps.time_out_at) AS timeOutDate,
                DATE_FORMAT(ps.time_out_at, "%h:%i %p") AS timeOutDisplay,
                DATE_FORMAT(ps.time_in_at, "%h:%i %p") AS timeInDisplay,
                ps.duration_minutes AS durationMinutes,
                TIME_FORMAT(ps.departure_time, "%h:%i %p") AS departureTimeDisplay,
                TIME_FORMAT(ps.time_returned, "%h:%i %p") AS timeReturnedDisplay,
                TIME_FORMAT(ps.departure_time, "%H:%i") AS departureTime,
                TIME_FORMAT(ps.time_returned, "%H:%i") AS timeReturned,
                ps.destination,
                ps.purpose,
                ps.qr_token AS qrToken,
                ps.approved_by AS approvedBy,
                approver.username AS approvedByUsername,
                ps.decided_at AS decidedAt,
                ps.decision_note AS decisionNote,
                ps.is_archived AS isArchived,
                (SELECT COUNT(*) FROM pass_slip_scans sc WHERE sc.pass_slip_id = ps.id) AS scanCount,
                ps.created_at AS createdAt,
                DATE(ps.created_at) AS dateFiled
            FROM pass_slip ps
            INNER JOIN employees e ON e.id = ps.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN designations des ON des.id = e.designation_id
            LEFT JOIN users approver ON approver.id = ps.approved_by';
}

/**
 * Turn one raw row into the record the client reads.
 *
 * The QR value and the printed reference are derived here rather than stored: both are a pure
 * function of the token and the id, and computing them in one place keeps the scanner, the preview
 * and the printed sheet from ever disagreeing about what a slip's code says.
 */
function pass_slip_shape_record(array $record): array
{
    $record['id'] = (int)$record['id'];
    $record['employeeRecordId'] = (int)$record['employeeRecordId'];
    $record['approvedBy'] = $record['approvedBy'] !== null ? (int)$record['approvedBy'] : null;
    $record['expectedMinutes'] = (int)($record['expectedMinutes'] ?? 0);
    $record['durationMinutes'] = $record['durationMinutes'] !== null ? (int)$record['durationMinutes'] : null;
    $record['scanCount'] = (int)($record['scanCount'] ?? 0);
    $record['isArchived'] = (int)($record['isArchived'] ?? 0) === 1;
    $record['status'] = pass_slip_normalize_status($record['status'] ?? null);

    $token = pass_slip_text($record['qrToken'] ?? '');
    $record['qrToken'] = $token !== '' ? $token : null;
    $record['qrValue'] = pass_slip_qr_value($token);
    $record['qrActive'] = $token !== ''
        && !$record['isArchived']
        && in_array($record['status'], PASS_SLIP_SCANNABLE_STATUSES, true);
    $record['reference'] = pass_slip_reference($record['id'], $record['passDate'] ?? null);

    return $record;
}

function fetch_pass_slip(PDO $pdo, int $id, array $scopes = ['employeeId' => null, 'divisionId' => null]): ?array
{
    $sql = pass_slip_select_sql() . ' WHERE ps.id = :id';

    [$sql, $params] = pass_slip_apply_scopes($sql, [':id' => $id], $scopes);
    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $record = $statement->fetch();

    return is_array($record) ? pass_slip_shape_record($record) : null;
}

function list_pass_slips(PDO $pdo, array $sessionUser): void
{
    $scopes = pass_slip_read_scopes($pdo, $sessionUser);

    $sql = pass_slip_select_sql() . ' WHERE ps.is_archived = :is_archived';

    [$sql, $params] = pass_slip_apply_scopes($sql, [':is_archived' => archived_view_requested() ? 1 : 0], $scopes);
    $sql .= ' ORDER BY ps.created_at DESC, ps.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    json_response([
        'success' => true,
        'records' => array_map('pass_slip_shape_record', $statement->fetchAll() ?: []),
    ]);
}

/** The scan trail of one slip, for the history panel. Scoped like any other read of that slip. */
function list_pass_slip_scans(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? 0);
    $record = $id > 0 ? fetch_pass_slip($pdo, $id, pass_slip_read_scopes($pdo, $sessionUser)) : null;

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Pass slip not found.',
        ], 404);
    }

    json_response([
        'success' => true,
        'record' => $record,
        'scans' => pass_slip_fetch_scans($pdo, $id),
    ]);
}

/*
 * The scan station's history, read from `pass_slip_scans` so every device that opens the station
 * sees the same list -- not just the scans that happened to be made on it.
 */
const PASS_SLIP_SCAN_HISTORY_DAYS = 30;
const PASS_SLIP_SCAN_HISTORY_LIMIT = 500;

/** What a history card draws. The public station never gets more than its own scan response does. */
function pass_slip_history_record(array $record, bool $isPublic): array
{
    $shaped = pass_slip_public_scan_record($record);

    if (!$isPublic) {
        $shaped['employeeId'] = $record['employeeId'] ?? '';
        $shaped['division'] = $record['division'] ?? '';
        $shaped['employeeRole'] = $record['employeeRole'] ?? '';
    }

    return $shaped;
}

/**
 * One entry per pass slip, from its latest accepted scan: the departure and the return share a card,
 * which carries whichever of the two came last. A refused scan is an entry of its own. Newest first.
 */
function list_pass_slip_scan_history(PDO $pdo, ?array $sessionUser): void
{
    $isPublic = $sessionUser === null;
    $scopes = $isPublic
        ? ['employeeId' => null, 'divisionId' => null]
        : pass_slip_read_scopes($pdo, $sessionUser);

    /* UNIX_TIMESTAMP in the database, whose clock and time zone are the ones NOW() stamped with. */
    $sql = 'SELECT
                s.id,
                s.pass_slip_id AS passSlipId,
                s.scan_type AS scanType,
                s.accepted,
                s.message,
                UNIX_TIMESTAMP(s.scanned_at) AS scannedAtEpoch
            FROM pass_slip_scans s
            INNER JOIN pass_slip ps ON ps.id = s.pass_slip_id
            INNER JOIN employees e ON e.id = ps.employee_id
            WHERE s.scanned_at >= NOW() - INTERVAL ' . PASS_SLIP_SCAN_HISTORY_DAYS . ' DAY';

    [$sql, $params] = pass_slip_apply_scopes($sql, [], $scopes);
    $sql .= ' ORDER BY s.scanned_at DESC, s.id DESC LIMIT ' . (PASS_SLIP_SCAN_HISTORY_LIMIT * 3);

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    $entries = [];
    $slipsWithCard = [];

    foreach ($statement->fetchAll() ?: [] as $row) {
        $passSlipId = (int)$row['passSlipId'];
        $accepted = (int)$row['accepted'] === 1;

        if ($accepted) {
            /* Rows arrive newest first, so the first accepted scan of a slip is the one its card shows. */
            if (isset($slipsWithCard[$passSlipId])) {
                continue;
            }
            $slipsWithCard[$passSlipId] = true;
        }

        $entries[] = [
            'id' => $accepted ? 'slip-' . $passSlipId : 'scan-' . (int)$row['id'],
            'ok' => $accepted,
            'action' => $accepted ? (string)$row['scanType'] : PASS_SLIP_SCAN_DENIED,
            'message' => (string)($row['message'] ?? ''),
            'passSlipId' => $passSlipId,
            'at' => (int)$row['scannedAtEpoch'] * 1000,
        ];

        if (count($entries) >= PASS_SLIP_SCAN_HISTORY_LIMIT) {
            break;
        }
    }

    $records = [];
    $slipIds = array_values(array_unique(array_column($entries, 'passSlipId')));

    if ($slipIds !== []) {
        /* Already confined by the scope on the scan query above; this only fills in the cards. */
        $placeholders = implode(', ', array_fill(0, count($slipIds), '?'));
        $slips = $pdo->prepare(pass_slip_select_sql() . ' WHERE ps.id IN (' . $placeholders . ')');
        $slips->execute($slipIds);

        foreach ($slips->fetchAll() ?: [] as $row) {
            $record = pass_slip_shape_record($row);
            $records[$record['id']] = pass_slip_history_record($record, $isPublic);
        }
    }

    foreach ($entries as &$entry) {
        $entry['record'] = $records[$entry['passSlipId']] ?? null;
        unset($entry['passSlipId']);
    }
    unset($entry);

    json_response([
        'success' => true,
        'entries' => $entries,
    ]);
}

function create_pass_slip(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_pass_slip_employee_id($pdo, $body, $sessionUser);
    $passDate = pass_slip_date_or_null($body['passDate'] ?? null);
    $destination = pass_slip_text($body['destination'] ?? '');
    $purpose = pass_slip_text($body['purpose'] ?? '');
    $passType = pass_slip_text($body['passType'] ?? '') ?: 'Official Business';
    $expectedMinutes = (int)($body['expectedMinutes'] ?? PASS_SLIP_MIN_MINUTES);

    $errors = [];
    if ($passDate === null) {
        $errors[] = 'Pass date is required.';
    }
    /*
     * The form's calendar already starts at today, but that only constrains the picker -- a crafted
     * request still reaches here, so the rule is enforced again rather than trusted. Applies to every
     * role: no account may back-date a filing. Compared as 'Y-m-d' text, which both sides guarantee.
     */
    if ($passDate !== null && $passDate < date('Y-m-d')) {
        $errors[] = 'Pass date cannot be in the past. Choose today or a later date.';
    }
    if ($destination === '') {
        $errors[] = 'Destination is required.';
    }
    if (!in_array($passType, ['Official Business', 'Personal'], true)) {
        $errors[] = 'Pass slip type must be Official Business or Personal.';
    }
    /*
     * The expected span, not the actual one. The actual is whatever the two scans say and is never
     * refused -- an employee already out of the office cannot be told their return is invalid -- so
     * the 1-to-3-hour rule lives here, on what is being asked for.
     */
    if ($expectedMinutes < PASS_SLIP_MIN_MINUTES || $expectedMinutes > PASS_SLIP_MAX_MINUTES) {
        $errors[] = 'A pass slip covers between 1 and 3 hours; anything longer needs a leave request.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    /*
     * Filed is live. There is no approval step, so a slip goes straight to ACTIVE and its QR code
     * works from this moment -- `approved_by` stays NULL, which is what leaves the "Approved by"
     * line on the printed form blank for a wet signature the way the paper slip has always worked.
     */
    $statement = $pdo->prepare(
        'INSERT INTO pass_slip
            (employee_id, pass_date, departure_time, time_returned, destination, pass_type,
             expected_minutes, purpose, status, approved_by, decided_at)
         VALUES
            (:employee_id, :pass_date, NULL, NULL, :destination, :pass_type,
             :expected_minutes, :purpose, :status, NULL, NULL)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':pass_date' => $passDate,
        ':destination' => $destination,
        ':pass_type' => $passType,
        ':expected_minutes' => $expectedMinutes,
        ':purpose' => $purpose !== '' ? $purpose : null,
        ':status' => PASS_SLIP_STATUS_ACTIVE,
    ]);

    $recordId = (int)$pdo->lastInsertId();

    /* The token is minted with the row, so a slip never exists without the code that identifies it. */
    pass_slip_assign_token($pdo, $recordId);

    $record = fetch_pass_slip($pdo, $recordId, pass_slip_read_scopes($pdo, $sessionUser));

    /*
     * Only when somebody else filed it. A slip an employee filed for themselves needs no telling --
     * they are looking at its QR code -- and with no approval to wait for there is nothing to notify
     * a desk about either.
     */
    if ($employeeId !== session_employee_record_id($pdo, $sessionUser)) {
        notify_employee(
            $pdo,
            $employeeId,
            'Pass Slip Created',
            sprintf('A pass slip to %s on %s was filed for you. Scan its QR code on the way out.', $destination, (string)$passDate),
            'pass_slip_created',
            (string)$recordId
        );
    }

    json_response([
        'success' => true,
        'record' => $record,
    ], 201);
}

/**
 * Retire a slip that is not going to be used.
 *
 * The only status a person writes. It exists because the QR code has to be able to go dead before
 * it is ever scanned -- a slip filed by mistake, or a trip called off -- and with no approval step
 * there is no rejection to do that job.
 *
 * Everything else about a slip is written by a scan: the two times, the duration, the move to OUT
 * and then to COMPLETED. None of it can be typed through this endpoint.
 */
function cancel_pass_slip(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? $body['recordId'] ?? 0);
    $scopes = pass_slip_read_scopes($pdo, $sessionUser);
    $record = $id > 0 ? fetch_pass_slip($pdo, $id, $scopes) : null;

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Pass slip not found.',
        ], 404);
    }

    $note = mb_substr(pass_slip_text($body['note'] ?? $body['reason'] ?? ''), 0, 255);
    $status = $record['status'];
    $isOwnRecord = (int)$record['employeeRecordId'] === session_employee_record_id($pdo, $sessionUser);

    /*
     * The employee's own slip, or one on a desk that can already see it -- the read scopes above are
     * what confine a Chief to their division, so anything that got this far is in
     * range. An employee may only ever reach their own.
     */
    if (!$isOwnRecord && !pass_slip_can_view_all($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to cancel this pass slip.',
        ], 403);
    }

    /*
     * Only before the trip starts. Once Time Out is stamped the person is out of the building, and
     * the only thing that closes the slip is the return scan -- cancelling it there would strand
     * them with a dead code and no way to record that they came back.
     */
    if ($status !== PASS_SLIP_STATUS_ACTIVE) {
        json_response([
            'success' => false,
            'message' => $status === PASS_SLIP_STATUS_OUT
                ? 'This pass slip is already in use. Scan the QR code to record the return instead.'
                : 'This pass slip can no longer be cancelled.',
        ], 409);
    }

    $statement = $pdo->prepare(
        'UPDATE pass_slip
            SET status = :status,
                decided_at = NOW(),
                decision_note = :note
          WHERE id = :id'
    );
    $statement->execute([
        ':status' => PASS_SLIP_STATUS_CANCELLED,
        ':note' => $note !== '' ? $note : null,
        ':id' => $id,
    ]);

    if (!$isOwnRecord) {
        notify_employee(
            $pdo,
            (int)$record['employeeRecordId'],
            'Pass Slip Cancelled',
            sprintf(
                'Your pass slip to %s on %s was cancelled%s',
                (string)($record['destination'] ?? ''),
                (string)($record['passDate'] ?? ''),
                $note !== '' ? ' (' . $note . ').' : '.'
            ),
            'pass_slip_cancelled',
            (string)$id
        );
    }

    json_response([
        'success' => true,
        'message' => 'Pass slip cancelled. Its QR code is no longer active.',
        'record' => fetch_pass_slip($pdo, $id, $scopes),
    ]);
}

/**
 * One scan of one QR code.
 *
 * The scanner sends nothing but whatever the reader produced. What happens next is decided entirely
 * from the slip the token resolves to, which is what makes the two required properties hold: a code
 * can only ever move its own slip, and the same code does a different thing each time because the
 * slip's status -- not the scanner -- says which step is next.
 *
 * The row is locked for the whole decision. Two readers pointed at the same code, or one reader
 * firing twice, would otherwise both read ACTIVE and both stamp a Time Out.
 */
/** Keep the anonymous scanner response useful without exposing the full pass-slip record. */
function pass_slip_public_scan_record(array $record): array
{
    return [
        'employeeName' => $record['employeeName'] ?? '',
        'reference' => $record['reference'] ?? '',
        'status' => $record['status'] ?? '',
        'timeOutDisplay' => $record['timeOutDisplay'] ?? null,
        'timeInDisplay' => $record['timeInDisplay'] ?? null,
        'durationMinutes' => $record['durationMinutes'] ?? null,
    ];
}

function scan_pass_slip(PDO $pdo, array $body, ?array $sessionUser): void
{
    $token = pass_slip_extract_token($body['token'] ?? $body['code'] ?? $body['value'] ?? '');

    if ($token === '') {
        json_response([
            'success' => false,
            'action' => 'INVALID',
            'message' => 'That is not a pass slip QR code.',
        ], 422);
    }

    /*
     * Resolved before the transaction opens, not inside it. Working out the caller's scope can fail
     * with a 422 for a session whose employee record has gone, and json_response() ends the request
     * where it stands -- doing that with a row locked would leave the transaction to be rolled back
     * by the connection teardown rather than by this code.
     */
    $isPublicScanner = $sessionUser === null;
    $scanActor = $sessionUser ?? [
        'full_name' => 'Public QR Scanner',
        'role' => 'Public Scanner',
    ];
    $scopes = $isPublicScanner
        ? ['employeeId' => null, 'divisionId' => null]
        : pass_slip_read_scopes($pdo, $sessionUser);

    $pdo->beginTransaction();

    try {
        $locked = $pdo->prepare('SELECT id, employee_id, status, time_out_at, pass_date, is_archived FROM pass_slip WHERE qr_token = :token LIMIT 1 FOR UPDATE');
        $locked->execute([':token' => $token]);
        $row = $locked->fetch();

        if (!is_array($row)) {
            $pdo->rollBack();
            json_response([
                'success' => false,
                'action' => 'INVALID',
                'message' => 'This QR code does not match any pass slip.',
            ], 404);
        }

        $passSlipId = (int)$row['id'];
        $statusBefore = pass_slip_normalize_status($row['status']);

        /*
         * Signed-in callers keep their ordinary read scope. The dedicated public gate endpoint is
         * instead authorized by possession of the slip's unguessable QR token and can resolve that
         * one matching record only.
         */
        $visible = fetch_pass_slip($pdo, $passSlipId, $scopes);
        $decision = null;

        if ($visible === null) {
            $decision = ['ok' => false, 'status' => 403, 'action' => PASS_SLIP_SCAN_DENIED, 'message' => 'You are not allowed to scan this pass slip.'];
        } elseif ((int)$row['is_archived'] === 1) {
            $decision = ['ok' => false, 'status' => 409, 'action' => PASS_SLIP_SCAN_DENIED, 'message' => 'This pass slip has been archived. Its QR code is no longer active.'];
        } else {
            $decision = pass_slip_scan_decision($statusBefore, $row);
        }

        if (!$decision['ok']) {
            $pdo->commit();

            /*
             * A refused scan is still a scan. Logging it is the point of the trail: it is how a
             * second attempt on a completed slip, or a code presented at the wrong desk, is
             * accounted for afterwards.
             */
            pass_slip_record_scan(
                $pdo,
                $passSlipId,
                PASS_SLIP_SCAN_DENIED,
                false,
                $scanActor,
                $statusBefore,
                $statusBefore,
                $decision['message']
            );

            json_response([
                'success' => false,
                'action' => PASS_SLIP_SCAN_DENIED,
                'message' => $decision['message'],
                /* Null for an out-of-scope scan, so a refusal never becomes a way to read a record. */
                'record' => $isPublicScanner && is_array($visible)
                    ? pass_slip_public_scan_record($visible)
                    : $visible,
            ], $decision['status']);
        }

        if ($decision['action'] === PASS_SLIP_SCAN_TIME_OUT) {
            $update = $pdo->prepare(
                'UPDATE pass_slip
                    SET status = :status,
                        time_out_at = NOW(),
                        departure_time = TIME(NOW())
                  WHERE id = :id'
            );
            $update->execute([':status' => PASS_SLIP_STATUS_OUT, ':id' => $passSlipId]);
            $statusAfter = PASS_SLIP_STATUS_OUT;
        } else {
            /*
             * The duration is computed from the two stamps by the database in the same statement
             * that writes the second one, so it can never disagree with them -- there is no window
             * in which a later reader could recompute it from a half-written pair.
             */
            $update = $pdo->prepare(
                'UPDATE pass_slip
                    SET status = :status,
                        time_in_at = NOW(),
                        time_returned = TIME(NOW()),
                        duration_minutes = TIMESTAMPDIFF(MINUTE, time_out_at, NOW())
                  WHERE id = :id'
            );
            $update->execute([':status' => PASS_SLIP_STATUS_COMPLETED, ':id' => $passSlipId]);
            $statusAfter = PASS_SLIP_STATUS_COMPLETED;
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    $record = fetch_pass_slip($pdo, $passSlipId, $scopes);
    $record = is_array($record) ? $record : [];
    $message = $statusAfter === PASS_SLIP_STATUS_OUT
        ? sprintf(
            'Time Out recorded at %s. %s is now on pass slip.',
            (string)($record['timeOutDisplay'] ?? ''),
            pass_slip_text($record['employeeName'] ?? '') ?: 'The employee'
        )
        : sprintf(
            'Time Returned recorded at %s. Total time out: %s.',
            (string)($record['timeInDisplay'] ?? ''),
            pass_slip_format_duration($record['durationMinutes'] ?? null)
        );

    $scan = pass_slip_record_scan(
        $pdo,
        $passSlipId,
        $decision['action'],
        true,
        $scanActor,
        $statusBefore,
        $statusAfter,
        $message
    );

    notify_employee(
        $pdo,
        (int)$row['employee_id'],
        $statusAfter === PASS_SLIP_STATUS_OUT ? 'Pass Slip Time Out Recorded' : 'Pass Slip Completed',
        $message,
        $statusAfter === PASS_SLIP_STATUS_OUT ? 'pass_slip_time_out' : 'pass_slip_completed',
        (string)$passSlipId
    );

    json_response([
        'success' => true,
        'action' => $decision['action'],
        'message' => $message,
        'record' => $isPublicScanner ? pass_slip_public_scan_record($record) : $record,
        'scan' => $isPublicScanner ? null : $scan,
    ]);
}

function delete_pass_slip(PDO $pdo, array $body, array $sessionUser): void
{
    if (!pass_slip_can_manage($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to delete pass slips.',
        ], 403);
    }

    $id = (int)($body['id'] ?? $body['recordId'] ?? 0);
    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Pass slip is required.',
        ], 422);
    }

    /* The scan trail goes with it: ON DELETE CASCADE on `pass_slip_scans` takes care of that. */
    $statement = $pdo->prepare('DELETE FROM pass_slip WHERE id = :id');
    $statement->execute([':id' => $id]);

    if ($statement->rowCount() === 0) {
        json_response([
            'success' => false,
            'message' => 'Pass slip not found.',
        ], 404);
    }

    json_response([
        'success' => true,
        'message' => 'Pass slip deleted successfully.',
    ]);
}

function archive_pass_slip(PDO $pdo, array $body, array $sessionUser, bool $archived): void
{
    $id = (int)($body['id'] ?? 0);
    // Every signed-in role may keep its pass-slip list tidy. Employee accounts remain scoped to
    // their own record and a Chief to their division, so knowing another slip id cannot be used to
    // archive someone else's form.
    $scopes = pass_slip_read_scopes($pdo, $sessionUser);
    $record = $id > 0 ? fetch_pass_slip($pdo, $id, $scopes) : null;

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Pass slip not found.',
        ], 404);
    }

    /*
     * An employee who is out of the office has an open slip and a live code; archiving it would
     * retire the code they still have to scan to get back in, and strand the record half-finished.
     */
    if ($archived && $record['status'] === PASS_SLIP_STATUS_OUT) {
        json_response([
            'success' => false,
            'message' => 'This pass slip is still in use. Record the return scan before archiving it.',
        ], 409);
    }

    set_record_archived($pdo, 'pass_slip', 'id', $id, $archived, $sessionUser, 'Pass Slip');

    json_response([
        'success' => true,
        'message' => $archived ? 'Pass slip archived.' : 'Pass slip restored.',
        'record' => fetch_pass_slip($pdo, $id, $scopes),
    ]);
}

try {
    ensure_archive_columns($pdo, 'pass_slip');
    ensure_pass_slip_qr_schema($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($publicPassSlipScan) {
        /* The station's shared history, so every device at the desk lists the same scans. */
        if ($method === 'GET' && strtolower(pass_slip_text($_GET['action'] ?? '')) === 'scan_history') {
            list_pass_slip_scan_history($pdo, null);
        }

        if ($method !== 'POST') {
            json_response([
                'success' => false,
                'message' => 'Method not allowed.',
            ], 405);
        }

        $body = read_json_body();
        if (strtolower(pass_slip_text($body['action'] ?? '')) !== 'scan') {
            json_response([
                'success' => false,
                'message' => 'Only pass-slip QR scans are accepted here.',
            ], 422);
        }

        scan_pass_slip($pdo, $body, null);
    }

    if ($method === 'GET') {
        if (strtolower(pass_slip_text($_GET['action'] ?? '')) === 'scans') {
            list_pass_slip_scans($pdo, $sessionUser);
        }

        if (strtolower(pass_slip_text($_GET['action'] ?? '')) === 'scan_history') {
            list_pass_slip_scan_history($pdo, $sessionUser);
        }

        list_pass_slips($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        $body = read_json_body();

        /*
         * The scan rides on POST rather than a file of its own so that the live-update feed keeps
         * seeing one topic for this module: changes.php maps topics to API filenames, and a scan
         * has to refresh exactly the screens a filing does.
         */
        if (strtolower(pass_slip_text($body['action'] ?? '')) === 'scan') {
            scan_pass_slip($pdo, $body, $sessionUser);
        }

        create_pass_slip($pdo, $body, $sessionUser);
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $action = strtolower(pass_slip_text($body['action'] ?? ''));

        if ($action === 'archive' || $action === 'restore') {
            archive_pass_slip($pdo, $body, $sessionUser, $action === 'archive');
        }

        if ($action === 'cancel') {
            cancel_pass_slip($pdo, $body, $sessionUser);
        }

        // Cancelling and archiving are the only edits a filed slip accepts. The times on it are
        // stamped by scanning its QR code and cannot be typed through this endpoint at all, and
        // there is no approval to record -- a slip is live from the moment it is filed.
        json_response([
            'success' => false,
            'message' => 'A pass slip cannot be edited once it is filed. Its times are recorded by scanning its QR code.',
        ], 422);
    }

    if ($method === 'DELETE') {
        delete_pass_slip($pdo, read_json_body(), $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Pass slip API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process pass slip request.',
    ], 500);
}
