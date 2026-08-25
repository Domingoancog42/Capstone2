<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';
require_once __DIR__ . '/date-selection-utils.php';
require_once __DIR__ . '/captcha-utils.php';

$sessionUser = require_session_user();

function travel_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function travel_date_or_null(mixed $value): ?string
{
    $text = travel_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function ensure_travel_order_rejected_note_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'rejected_note'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN rejected_note TEXT NULL AFTER remarks');
}

function ensure_travel_order_approved_by_employee_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'approved_by_employee_id'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN approved_by_employee_id INT UNSIGNED NULL AFTER rejected_note');
}

function ensure_travel_order_recommended_by_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'recommended_by_employee_id'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN recommended_by_employee_id INT UNSIGNED NULL AFTER approved_by_employee_id');
}

function ensure_travel_order_employee_authorized_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'employee_authorized_at'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN employee_authorized_at DATETIME NULL AFTER recommended_by_employee_id');
}

/**
 * `reviewed` is the Planning Officer's recommendation resting between the desk that filed the order
 * and the Regional Director's final approval, so it has to exist before any row can carry it.
 */
function ensure_travel_order_reviewed_status(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'status'");
    $column = $statement !== false ? $statement->fetch() : false;

    if ($column === false || stripos((string)($column['Type'] ?? ''), "'reviewed'") !== false) {
        return;
    }

    $pdo->exec(
        "ALTER TABLE travel_orders
         MODIFY COLUMN status ENUM('pending','reviewed','approved','rejected','cancelled')
         NOT NULL DEFAULT 'pending'"
    );
}

/**
 * Who filed the order, which is not who is travelling and no longer who recommends it.
 *
 * A chief files for the employees of their division and may still call the trip off, so the filer
 * has to be recorded separately now that the "Recommended by" line belongs to the Planning Officer.
 */
function ensure_travel_order_filed_by_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'filed_by_employee_id'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN filed_by_employee_id INT UNSIGNED NULL AFTER recommended_by_employee_id');
}

/**
 * When the recommendation was signed.
 *
 * The form prints a timestamp under each signature, and the Planning Officer recommends well after
 * the order was filed -- so dating that line from `created_at`, as it did while the chief filing
 * was also the recommender, would print a signing time that never happened.
 */
function ensure_travel_order_recommended_at_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'recommended_at'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE travel_orders ADD COLUMN recommended_at DATETIME NULL AFTER filed_by_employee_id');
    // Orders recommended before this column existed were recommended as they were filed.
    $pdo->exec('UPDATE travel_orders SET recommended_at = created_at WHERE recommended_by_employee_id IS NOT NULL');
}

function travel_role_key(array $user): string
{
    return user_role_key($user);
}

/*
 * Who may move a travel order into the archive and back. The Planning Officer is included even
 * though they neither file nor give the final approval: the order passes their desk to be
 * authorized for dispatch, so clearing settled ones out of their list is theirs to do.
 *
 * Mirrors the `travel` entry of ARCHIVE_MANAGER_ROLES in frontend/src/utils/archiveActions.js,
 * which only decides whether the button is drawn -- this is what actually refuses the request.
 */
function travel_can_archive(array $user): bool
{
    $roleKey = travel_role_key($user);
    return in_array($roleKey, ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'planningofficer'], true);
}

/*
 * A travel order is signed in two desks. The Planning Officer recommends a filed order, which is
 * what fills the "Recommended by" line on the printed form and moves the row to `reviewed`; the
 * Regional Director then gives the final approval. Neither desk may act out of turn -- a pending
 * order has no recommendation for the Director to approve, and a reviewed one is past the Planning
 * Officer. An admin sits in both so a stuck order always has a way through.
 */

/** The Planning Officer's desk: recommends a filed order up to the Regional Director. */
function travel_can_recommend(array $user): bool
{
    return in_array(travel_role_key($user), ['admin', 'planningofficer'], true);
}

/** The Regional Director's desk: the only one whose approval finishes a travel order. */
function travel_can_give_final_approval(array $user): bool
{
    return in_array(travel_role_key($user), ['admin', 'regionaldirector'], true);
}

function travel_can_view_all(array $user): bool
{
    return travel_role_key($user) !== 'employee';
}

/** The statuses a travel order can still be acted on from. */
function travel_status_is_open(string $status): bool
{
    return in_array($status, ['pending', 'reviewed'], true);
}

function travel_status_to_client(string $status): string
{
    return match (strtolower($status)) {
        'reviewed' => 'Reviewed',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled' => 'Cancelled',
        default => 'Pending',
    };
}

function travel_status_to_database(mixed $status): string
{
    return match (strtolower(travel_text($status))) {
        'reviewed' => 'reviewed',
        'approved' => 'approved',
        'rejected' => 'rejected',
        'cancelled', 'canceled' => 'cancelled',
        default => 'pending',
    };
}

function travel_default_signatory_for_role(PDO $pdo, string $roleKey): ?array
{
    static $cache = [];

    if (array_key_exists($roleKey, $cache)) {
        return $cache[$roleKey];
    }

    $statement = $pdo->prepare(
        'SELECT
            e.id AS employeeRecordId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE u.is_archived = 0
           AND LOWER(REPLACE(r.name, " ", "")) = :role_key
           AND LOWER(u.status) = "active"
         ORDER BY u.id ASC
         LIMIT 1'
    );
    $statement->execute([
        ':role_key' => strtolower($roleKey),
    ]);
    $signatory = $statement->fetch();

    if (!$signatory) {
        $cache[$roleKey] = null;
        return null;
    }

    $cache[$roleKey] = [
        'employeeRecordId' => (int)($signatory['employeeRecordId'] ?? 0),
        'employeeName' => travel_text($signatory['employeeName'] ?? ''),
    ];

    return $cache[$roleKey];
}

function travel_apply_signatory_fallbacks(PDO $pdo, array $request): array
{
    $statusKey = travel_status_to_database($request['status'] ?? '');

    if (
        ($request['approvedByEmployeeRecordId'] ?? null) === null
        && $statusKey === 'approved'
    ) {
        $fallbackRegionalDirector = travel_default_signatory_for_role($pdo, 'regionaldirector');
        if ($fallbackRegionalDirector !== null && ($fallbackRegionalDirector['employeeRecordId'] ?? 0) > 0) {
            $request['approvedByEmployeeRecordId'] = (int)$fallbackRegionalDirector['employeeRecordId'];
            $request['approvedBy'] = travel_text($fallbackRegionalDirector['employeeName'] ?? '');
        }
    }

    return $request;
}

function resolve_session_employee_id(PDO $pdo, array $user): int
{
    $employeeCode = travel_text($user['employee_id'] ?? '');
    $employeeName = travel_text($user['full_name'] ?? '');

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

function resolve_travel_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!travel_can_view_all($sessionUser)) {
        return resolve_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = travel_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = travel_text($body['employeeName'] ?? '');

    if ($employeeRecordId > 0) {
        $statement = $pdo->prepare('SELECT id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
        $statement->execute([':id' => $employeeRecordId]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) {
            return $id;
        }
    }

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
        'message' => 'Selected employee was not found.',
    ], 422);
}

/**
 * The recommendation on a newly filed order.
 *
 * Recommending is the Planning Officer's step, so a planning officer filing for their division has
 * already made it and the order goes straight to the Regional Director. Every other filer -- a
 * division chief, an admin, or an employee filing for themselves -- leaves this null and waits for
 * the Planning Officer to recommend, which is what fills the "Recommended by" line on the form.
 */
function resolve_travel_recommender_id(PDO $pdo, array $sessionUser, int $travellerEmployeeId): ?int
{
    if (travel_role_key($sessionUser) !== 'planningofficer') {
        return null;
    }

    $recommenderId = session_employee_record_id($pdo, $sessionUser);

    if ($recommenderId === null || $recommenderId <= 0 || $recommenderId === $travellerEmployeeId) {
        return null;
    }

    return $recommenderId;
}

/**
 * The single shaping step for a travel order row on its way to the client. Both the single-record
 * read and the list read go through here on purpose: they select the same columns, and keeping two
 * copies of this in sync is how the list endpoint ended up silently missing fields the detail
 * endpoint returned.
 */
function travel_normalize_request(PDO $pdo, array $request): array
{
    $request['id'] = (int)$request['id'];
    $request['employeeRecordId'] = (int)$request['employeeRecordId'];
    $request['rejectedNote'] = travel_text($request['rejectedNote'] ?? '');
    $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
        ? (int)$request['approvedByEmployeeRecordId']
        : null;
    $request['approvedBy'] = travel_text($request['approvedBy'] ?? '');
    $request['recommendedByEmployeeRecordId'] = $request['recommendedByEmployeeRecordId'] !== null
        ? (int)$request['recommendedByEmployeeRecordId']
        : null;
    $request['recommendedBy'] = travel_text($request['recommendedBy'] ?? '');
    $request['recommendedAt'] = travel_text($request['recommendedAt'] ?? '');
    $request['filedByEmployeeRecordId'] = ($request['filedByEmployeeRecordId'] ?? null) !== null
        ? (int)$request['filedByEmployeeRecordId']
        : null;
    $request['filedByEmployeeId'] = travel_text($request['filedByEmployeeId'] ?? '');
    $request['filedBy'] = travel_text($request['filedBy'] ?? '');
    $request['employeeAuthorizedAt'] = travel_text($request['employeeAuthorizedAt'] ?? '');
    $statusKey = travel_status_to_database($request['status'] ?? '');
    $request['status'] = travel_status_to_client((string)$request['status']);
    /*
     * A Regional Director approval parks the order instead of approving it outright: the row keeps
     * its open status until the employee accepts the COA liquidation authorization on the form. An
     * open row that already carries an approver is therefore waiting on the employee, not on a
     * signatory. Legacy rows were parked at `pending`, current ones at `reviewed`.
     */
    $request['awaitingAuthorization'] = travel_status_is_open($statusKey)
        && $request['approvedByEmployeeRecordId'] !== null;

    return travel_apply_signatory_fallbacks($pdo, $request);
}

function fetch_travel_order(PDO $pdo, int $id, ?int $employeeScopeId = null): ?array
{
    $sql = 'SELECT
                t.travel_order_id AS id,
                t.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                des.name AS position,
                des.name AS designation,
                t.destination,
                t.purpose,
                t.start_date AS startDate,
                t.end_date AS endDate,
                t.assistance_labor AS assistanceLabor,
                t.appropriations,
                t.remarks,
                COALESCE(t.rejected_note, "") AS rejectedNote,
                t.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                t.employee_authorized_at AS employeeAuthorizedAt,
                t.recommended_by_employee_id AS recommendedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(recommended_employee.first_name, " ", COALESCE(recommended_employee.middle_name, ""), " ", recommended_employee.last_name)), ""), "") AS recommendedBy,
                t.recommended_at AS recommendedAt,
                t.filed_by_employee_id AS filedByEmployeeRecordId,
                COALESCE(filed_employee.employee_id, "") AS filedByEmployeeId,
                COALESCE(NULLIF(TRIM(CONCAT(filed_employee.first_name, " ", COALESCE(filed_employee.middle_name, ""), " ", filed_employee.last_name)), ""), "") AS filedBy,
                t.status,
                DATE(t.created_at) AS dateFiled,
                t.created_at AS createdAt,
                t.updated_at AS updatedAt
            FROM travel_orders t
            INNER JOIN employees e ON e.id = t.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN designations des ON des.id = e.designation_id
            LEFT JOIN employees approved_employee ON approved_employee.id = t.approved_by_employee_id
            LEFT JOIN employees recommended_employee ON recommended_employee.id = t.recommended_by_employee_id
            LEFT JOIN employees filed_employee ON filed_employee.id = t.filed_by_employee_id
            WHERE t.travel_order_id = :id';

    if ($employeeScopeId !== null) {
        $sql .= ' AND t.employee_id = :employee_scope_id';
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    $statement->execute($params);
    $request = $statement->fetch();

    if (!$request) {
        return null;
    }

    return travel_normalize_request($pdo, $request);
}

function fetch_travel_order_notification_context(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            t.travel_order_id AS id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.email AS employeeEmail,
            d.name AS division,
            t.destination,
            COALESCE(t.purpose, "") AS purpose,
            t.start_date AS startDate,
            t.end_date AS endDate,
            COALESCE(t.assistance_labor, "") AS assistanceLabor,
            COALESCE(t.appropriations, "") AS appropriations,
            COALESCE(t.remarks, "") AS remarks,
            COALESCE(t.rejected_note, "") AS rejectedNote
         FROM travel_orders t
         INNER JOIN employees e ON e.id = t.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE t.travel_order_id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $request = $statement->fetch();

    if (!$request) {
        return null;
    }

    $request['employeeName'] = travel_text($request['employeeName'] ?? '');
    $request['employeeEmail'] = travel_text($request['employeeEmail'] ?? '');
    $request['division'] = travel_text($request['division'] ?? '');
    $request['destination'] = travel_text($request['destination'] ?? '');
    $request['purpose'] = travel_text($request['purpose'] ?? '');
    $request['startDate'] = travel_text($request['startDate'] ?? '');
    $request['endDate'] = travel_text($request['endDate'] ?? '');
    $request['assistanceLabor'] = travel_text($request['assistanceLabor'] ?? '');
    $request['appropriations'] = travel_text($request['appropriations'] ?? '');
    $request['remarks'] = travel_text($request['remarks'] ?? '');
    $request['rejectedNote'] = travel_text($request['rejectedNote'] ?? '');

    return $request;
}

function send_travel_rejection_notification(PDO $pdo, int $id): ?string
{
    $request = fetch_travel_order_notification_context($pdo, $id);

    if ($request === null) {
        return 'Travel order rejected, but employee details could not be loaded for email notification.';
    }

    $employeeEmail = travel_text($request['employeeEmail'] ?? '');

    if ($employeeEmail === '' || filter_var($employeeEmail, FILTER_VALIDATE_EMAIL) === false) {
        return 'Travel order rejected, but no valid employee email address is available.';
    }

    /*
     * The picked days ride in the remarks column, so the typed remarks are separated out here and
     * the exact dates are reported on their own line. Empty for an order filed as a plain range,
     * which the email then reports as a start and end.
     */
    $unpackedRemarks = unpack_selected_dates($request['remarks'] ?? '');

    try {
        send_travel_order_rejection_email(
            $employeeEmail,
            (string)$request['employeeName'],
            (string)$request['division'],
            (string)$request['destination'],
            (string)$request['purpose'],
            (string)$request['startDate'],
            (string)$request['endDate'],
            (string)$request['assistanceLabor'],
            (string)$request['appropriations'],
            $unpackedRemarks['note'],
            (string)$request['rejectedNote'],
            selected_dates_summary($unpackedRemarks['dates'])
        );
    } catch (Throwable $exception) {
        error_log('Travel rejection email error: ' . $exception->getMessage());
        return 'Travel order rejected, but the rejection email could not be sent.';
    }

    return null;
}

function list_travel_orders(PDO $pdo, array $sessionUser): void
{
    $employeeScopeId = travel_can_view_all($sessionUser) ? null : resolve_session_employee_id($pdo, $sessionUser);

    $sql = 'SELECT
                t.travel_order_id AS id,
                t.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                des.name AS position,
                des.name AS designation,
                t.destination,
                t.purpose,
                t.start_date AS startDate,
                t.end_date AS endDate,
                t.assistance_labor AS assistanceLabor,
                t.appropriations,
                t.remarks,
                COALESCE(t.rejected_note, "") AS rejectedNote,
                t.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                t.employee_authorized_at AS employeeAuthorizedAt,
                t.recommended_by_employee_id AS recommendedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(recommended_employee.first_name, " ", COALESCE(recommended_employee.middle_name, ""), " ", recommended_employee.last_name)), ""), "") AS recommendedBy,
                t.recommended_at AS recommendedAt,
                t.filed_by_employee_id AS filedByEmployeeRecordId,
                COALESCE(filed_employee.employee_id, "") AS filedByEmployeeId,
                COALESCE(NULLIF(TRIM(CONCAT(filed_employee.first_name, " ", COALESCE(filed_employee.middle_name, ""), " ", filed_employee.last_name)), ""), "") AS filedBy,
                t.status,
                DATE(t.created_at) AS dateFiled,
                t.created_at AS createdAt,
                t.updated_at AS updatedAt
            FROM travel_orders t
            INNER JOIN employees e ON e.id = t.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN designations des ON des.id = e.designation_id
            LEFT JOIN employees approved_employee ON approved_employee.id = t.approved_by_employee_id
            LEFT JOIN employees recommended_employee ON recommended_employee.id = t.recommended_by_employee_id
            LEFT JOIN employees filed_employee ON filed_employee.id = t.filed_by_employee_id
            WHERE t.is_archived = :is_archived';

    $params = [':is_archived' => archived_view_requested() ? 1 : 0];
    if ($employeeScopeId !== null) {
        $sql .= ' AND t.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' ORDER BY t.created_at DESC, t.travel_order_id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $requests = $statement->fetchAll();

    foreach ($requests as &$request) {
        $request = travel_normalize_request($pdo, $request);
    }
    unset($request);

    json_response([
        'success' => true,
        'requests' => $requests,
    ]);
}

function create_travel_order(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_travel_employee_id($pdo, $body, $sessionUser);
    $destination = travel_text($body['destination'] ?? '');
    $purpose = travel_text($body['purpose'] ?? '');
    $startDate = travel_date_or_null($body['startDate'] ?? null);
    $endDate = travel_date_or_null($body['endDate'] ?? null);
    $assistanceLabor = travel_text($body['assistanceLabor'] ?? $body['assistance_labor'] ?? '');
    $appropriations = travel_text($body['appropriations'] ?? '');
    $remarks = travel_text($body['remarks'] ?? '');

    $errors = [];
    if ($destination === '') {
        $errors[] = 'Destination is required.';
    }
    if ($startDate === null) {
        $errors[] = 'Start date is required.';
    }
    if ($endDate === null) {
        $errors[] = 'End date is required.';
    }
    /*
     * The form's calendar already starts at today, but that only constrains the picker -- a crafted
     * request still reaches here, so the rule is enforced again rather than trusted. Applies to every
     * role: no account may back-date a filing. Compared as 'Y-m-d' text, which both sides guarantee.
     */
    $today = date('Y-m-d');
    if ($startDate !== null && $startDate < $today) {
        $errors[] = 'Start date cannot be in the past. Choose today or a later date.';
    }
    if ($endDate !== null && $endDate < $today) {
        $errors[] = 'End date cannot be in the past. Choose today or a later date.';
    }
    if ($startDate !== null && $endDate !== null && $endDate < $startDate) {
        $errors[] = 'End date must not be earlier than start date.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $recommendedByEmployeeId = resolve_travel_recommender_id($pdo, $sessionUser, $employeeId);
    $filedByEmployeeId = session_employee_record_id($pdo, $sessionUser);
    /*
     * A planning officer filing has already made the recommendation, so their order starts at
     * `reviewed` and goes straight to the Regional Director. Everyone else's starts at `pending`
     * and waits for the Planning Officer.
     */
    $initialStatus = $recommendedByEmployeeId !== null ? 'reviewed' : 'pending';

    $statement = $pdo->prepare(
        'INSERT INTO travel_orders
            (employee_id, destination, purpose, start_date, end_date, assistance_labor, appropriations, remarks, recommended_by_employee_id, recommended_at, filed_by_employee_id, status)
         VALUES
            (:employee_id, :destination, :purpose, :start_date, :end_date, :assistance_labor, :appropriations, :remarks, :recommended_by_employee_id, :recommended_at, :filed_by_employee_id, :status)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':destination' => $destination,
        ':purpose' => $purpose !== '' ? $purpose : null,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
        ':assistance_labor' => $assistanceLabor !== '' ? $assistanceLabor : null,
        ':appropriations' => $appropriations !== '' ? $appropriations : null,
        ':remarks' => $remarks !== '' ? $remarks : null,
        ':recommended_by_employee_id' => $recommendedByEmployeeId,
        ':recommended_at' => $recommendedByEmployeeId !== null ? date('Y-m-d H:i:s') : null,
        ':filed_by_employee_id' => ($filedByEmployeeId !== null && $filedByEmployeeId > 0) ? $filedByEmployeeId : null,
        ':status' => $initialStatus,
    ]);

    $requestId = (int)$pdo->lastInsertId();
    $employeeScopeId = travel_can_view_all($sessionUser) ? null : resolve_session_employee_id($pdo, $sessionUser);
    json_response([
        'success' => true,
        'request' => fetch_travel_order($pdo, $requestId, $employeeScopeId),
    ], 201);
}

function update_travel_order_status(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? $body['requestId'] ?? 0);
    $status = travel_status_to_database($body['status'] ?? '');
    $rejectedNote = travel_text($body['rejectedNote'] ?? $body['rejected_note'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Travel order is required.',
        ], 422);
    }

    if ($status === 'rejected' && $rejectedNote === '') {
        json_response([
            'success' => false,
            'message' => 'Rejected note is required.',
        ], 422);
    }

    $currentRequestStatement = $pdo->prepare(
        'SELECT employee_id, filed_by_employee_id, recommended_by_employee_id, approved_by_employee_id, status
         FROM travel_orders
         WHERE travel_order_id = :id
         LIMIT 1'
    );
    $currentRequestStatement->execute([':id' => $id]);
    $currentRequest = $currentRequestStatement->fetch();

    if (!$currentRequest) {
        json_response([
            'success' => false,
            'message' => 'Travel order not found.',
        ], 404);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $currentStatus = travel_status_to_database($currentRequest['status'] ?? '');
    $isOwnRequest = $sessionEmployeeId !== null && (int)($currentRequest['employee_id'] ?? 0) === $sessionEmployeeId;
    /* The desk that filed the order -- a division chief, normally -- may still call the trip off. */
    $isFiler = $sessionEmployeeId !== null
        && ($currentRequest['filed_by_employee_id'] ?? null) !== null
        && (int)$currentRequest['filed_by_employee_id'] === $sessionEmployeeId;
    $alreadyFinallyApproved = ($currentRequest['approved_by_employee_id'] ?? null) !== null;

    /*
     * Which desk the order is sitting on decides who may act. A pending order is the Planning
     * Officer's to recommend or reject; a reviewed one is the Regional Director's to approve or
     * reject. Cancelling is the way out for whoever owns the trip -- the traveller or the filer --
     * for as long as the Director has not signed.
     */
    $canRecommendNow = $currentStatus === 'pending' && travel_can_recommend($sessionUser);
    $canFinallyApproveNow = $currentStatus === 'reviewed' && travel_can_give_final_approval($sessionUser);
    $isOwnCancellation = $status === 'cancelled'
        && ($isOwnRequest || $isFiler)
        && travel_status_is_open($currentStatus)
        && !$alreadyFinallyApproved;

    if (!$canRecommendNow && !$canFinallyApproveNow && !$isOwnCancellation) {
        // Say which desk the order is waiting on rather than a flat "not allowed".
        json_response([
            'success' => false,
            'message' => match (true) {
                !travel_status_is_open($currentStatus) => 'This travel order has already been ' . $currentStatus . '.',
                $currentStatus === 'pending' && travel_can_give_final_approval($sessionUser) =>
                    'This travel order is still waiting for the Planning Officer to recommend it.',
                $currentStatus === 'reviewed' && travel_can_recommend($sessionUser) =>
                    'This travel order has already been recommended and is waiting for the Regional Director.',
                default => 'You are not allowed to update travel order status.',
            },
        ], 403);
    }

    if ($isOwnRequest && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own travel order. Please ask another authorized user to review it.',
        ], 403);
    }

    $isRecommendation = $status === 'approved' && $canRecommendNow;
    $isFinalApproval = $status === 'approved' && $canFinallyApproveNow;

    if ($status === 'approved' && !$isRecommendation && !$isFinalApproval) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to approve this travel order at its current stage.',
        ], 403);
    }

    if (($isRecommendation || $isFinalApproval) && ($sessionEmployeeId === null || $sessionEmployeeId <= 0)) {
        json_response([
            'success' => false,
            'message' => 'Your account is not linked to an employee record, so the decision cannot be recorded.',
        ], 422);
    }

    /*
     * Both signatures on the order carry a solved captcha: the Planning Officer's recommendation,
     * which authorizes the trip for dispatch, and the Regional Director's approval. Rejecting and
     * cancelling do not; see the approval_workflow entry in captcha-utils.php.
     */
    if ($isRecommendation || $isFinalApproval) {
        require_approval_captcha($body);
    }

    /*
     * A Regional Director approval does not finish the travel order. The employee still has to
     * accept the COA liquidation authorization printed on the form, so the row is held at its
     * current stage with the approver recorded, and authorize_travel_order() below moves it to
     * approved.
     */
    $nextStatus = match (true) {
        $isRecommendation => 'reviewed',
        $isFinalApproval => $currentStatus,
        default => $status,
    };

    $nextRecommendedByEmployeeId = $isRecommendation
        ? $sessionEmployeeId
        : (($currentRequest['recommended_by_employee_id'] ?? null) !== null
            ? (int)$currentRequest['recommended_by_employee_id']
            : null);

    /* A rejection records who signed it too, so the form prints "Disapproved by" with a name. */
    $isDeskRejection = $status === 'rejected' && $canFinallyApproveNow;
    $nextApprovedByEmployeeId = ($isFinalApproval || $isDeskRejection) ? $sessionEmployeeId : null;

    $statement = $pdo->prepare(
        'UPDATE travel_orders
         SET status = :status,
             rejected_note = :rejected_note,
             recommended_by_employee_id = :recommended_by_employee_id,
             /* Only a fresh recommendation moves this; every other update leaves it standing. */
             recommended_at = COALESCE(:recommended_at, recommended_at),
             approved_by_employee_id = :approved_by_employee_id,
             employee_authorized_at = NULL
         WHERE travel_order_id = :id'
    );
    $statement->execute([
        ':status' => $nextStatus,
        ':rejected_note' => $status === 'rejected' ? $rejectedNote : null,
        ':recommended_by_employee_id' => $nextRecommendedByEmployeeId,
        ':recommended_at' => $isRecommendation ? date('Y-m-d H:i:s') : null,
        ':approved_by_employee_id' => $nextApprovedByEmployeeId,
        ':id' => $id,
    ]);

    if ($statement->rowCount() === 0) {
        $existsStatement = $pdo->prepare('SELECT COUNT(*) FROM travel_orders WHERE travel_order_id = :id');
        $existsStatement->execute([':id' => $id]);
        if ((int)$existsStatement->fetchColumn() === 0) {
            json_response([
                'success' => false,
                'message' => 'Travel order not found.',
            ], 404);
        }
    }

    $notificationWarning = null;

    if ($status === 'rejected') {
        $notificationWarning = send_travel_rejection_notification($pdo, $id);
    }

    $updatedRequest = fetch_travel_order($pdo, $id);

    /*
     * The Director's approval is the employee's cue to act: the order is not finished until they
     * accept the COA liquidation clause on it, so the notification says whose signature landed and
     * what is still owed. Never let a notification failure undo an approval that is already stored.
     */
    if ($isFinalApproval && $updatedRequest !== null) {
        try {
            notify_employee(
                $pdo,
                (int)($currentRequest['employee_id'] ?? 0),
                'Travel Order Approved',
                sprintf(
                    'Your travel order to %s (%s to %s) was approved by the Regional Director. Open it and accept the travel authorization to finish it.',
                    (string)($updatedRequest['destination'] ?? 'your destination'),
                    (string)($updatedRequest['startDate'] ?? ''),
                    (string)($updatedRequest['endDate'] ?? '')
                ),
                'travel_order_approved',
                (string)$id
            );
        } catch (Throwable $notificationException) {
            error_log('Travel order approval notification error: ' . $notificationException->getMessage());
        }
    }

    json_response([
        'success' => true,
        'request' => $updatedRequest,
        'emailNotification' => $status === 'rejected'
            ? ($notificationWarning === null ? 'sent' : 'warning')
            : 'not_applicable',
        'message' => match (true) {
            $status === 'rejected' => $notificationWarning ?? 'Travel order rejected and the employee was notified by email.',
            $status === 'cancelled' => 'Travel order cancelled.',
            $isRecommendation => 'Travel order authorized for dispatch. It now goes to the Regional Director for final approval.',
            $isFinalApproval => 'Travel order approved. It now waits for the employee to accept the travel authorization.',
            default => 'Travel order updated.',
        },
    ]);
}

/*
 * The employee accepting the authorization clause on their own travel order. This is the one
 * carve-out to the "you cannot update your own travel order" rule enforced above, and it is kept
 * as narrow as the workflow needs: the caller must be the traveller, the order must still be
 * pending, and a Regional Director must already have approved it. The only reachable outcome is
 * approved, so an employee still cannot approve a travel order nobody signed off on.
 */
function authorize_travel_order(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? $body['requestId'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Travel order is required.',
        ], 422);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);

    if ($sessionEmployeeId === null || $sessionEmployeeId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Your account is not linked to an employee record.',
        ], 403);
    }

    $statement = $pdo->prepare(
        'SELECT employee_id, approved_by_employee_id, status
         FROM travel_orders
         WHERE travel_order_id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $request = $statement->fetch();

    if (!$request) {
        json_response([
            'success' => false,
            'message' => 'Travel order not found.',
        ], 404);
    }

    if ((int)($request['employee_id'] ?? 0) !== $sessionEmployeeId) {
        json_response([
            'success' => false,
            'message' => 'You can only authorize your own travel order.',
        ], 403);
    }

    if (!travel_status_is_open(travel_status_to_database($request['status'] ?? ''))) {
        json_response([
            'success' => false,
            'message' => 'This travel order is no longer waiting for your authorization.',
        ], 422);
    }

    if (($request['approved_by_employee_id'] ?? null) === null) {
        json_response([
            'success' => false,
            'message' => 'This travel order has not been approved by the Regional Director yet.',
        ], 422);
    }

    $updateStatement = $pdo->prepare(
        'UPDATE travel_orders
         SET status = "approved",
             employee_authorized_at = NOW()
         WHERE travel_order_id = :id
           AND status IN ("pending", "reviewed")
           AND approved_by_employee_id IS NOT NULL'
    );
    $updateStatement->execute([':id' => $id]);

    json_response([
        'success' => true,
        'request' => fetch_travel_order($pdo, $id),
        'emailNotification' => 'not_applicable',
        'message' => 'Travel authorization accepted. Your travel order is now approved.',
    ]);
}

function archive_travel_order(PDO $pdo, array $body, array $sessionUser, bool $archived): void
{
    if (!travel_can_archive($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive travel orders.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0 || fetch_travel_order($pdo, $id) === null) {
        json_response([
            'success' => false,
            'message' => 'Travel order not found.',
        ], 404);
    }

    set_record_archived(
        $pdo,
        'travel_orders',
        'travel_order_id',
        $id,
        $archived,
        $sessionUser,
        'Travel Order'
    );

    json_response([
        'success' => true,
        'message' => $archived ? 'Travel order archived.' : 'Travel order restored.',
        'request' => fetch_travel_order($pdo, $id),
    ]);
}

try {
    ensure_travel_order_rejected_note_column($pdo);
    ensure_travel_order_approved_by_employee_column($pdo);
    ensure_travel_order_recommended_by_column($pdo);
    ensure_travel_order_filed_by_column($pdo);
    ensure_travel_order_recommended_at_column($pdo);
    ensure_travel_order_employee_authorized_column($pdo);
    ensure_travel_order_reviewed_status($pdo);
    ensure_archive_columns($pdo, 'travel_orders');

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        list_travel_orders($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_travel_order($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        $body = read_json_body();

        $action = strtolower(travel_text($body['action'] ?? ''));

        if ($action === 'authorize') {
            authorize_travel_order($pdo, $body, $sessionUser);
        }

        if ($action === 'archive' || $action === 'restore') {
            archive_travel_order($pdo, $body, $sessionUser, $action === 'archive');
        }

        update_travel_order_status($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Travel order API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process travel order request.',
    ], 500);
}
