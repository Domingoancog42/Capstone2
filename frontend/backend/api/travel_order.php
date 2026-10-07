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
    if ($statement === false || $statement->fetch() === false) {
        $pdo->exec('ALTER TABLE travel_orders ADD COLUMN rejected_note TEXT NULL AFTER remarks');
    }

    $roleStatement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'rejected_by_role'");
    if ($roleStatement === false || $roleStatement->fetch() === false) {
        $pdo->exec('ALTER TABLE travel_orders ADD COLUMN rejected_by_role VARCHAR(80) NULL AFTER rejected_note');
    }
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
 * `reviewed` is the Planning Officer's recommendation waiting on the Division Chief, and
 * `chief_reviewed` is the Chief's approval waiting on the Regional Director, so both have to exist
 * before any row can carry them.
 */
function ensure_travel_order_workflow_statuses(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'status'");
    $column = $statement !== false ? $statement->fetch() : false;
    $columnType = $column !== false ? (string)($column['Type'] ?? '') : '';

    if ($column === false || stripos($columnType, "'chief_reviewed'") !== false) {
        return;
    }

    $hadReviewedStatus = stripos($columnType, "'reviewed'") !== false;

    $pdo->exec(
        "ALTER TABLE travel_orders
         MODIFY COLUMN status ENUM('pending','reviewed','chief_reviewed','approved','rejected','cancelled')
         NOT NULL DEFAULT 'pending'"
    );

    /*
     * Before the Chief stage existed, `reviewed` meant the order was already on the Regional
     * Director's desk. Those orders keep their place rather than being sent back to a Chief.
     */
    if ($hadReviewedStatus) {
        $pdo->exec("UPDATE travel_orders SET status = 'chief_reviewed' WHERE status = 'reviewed'");
    }
}

/** Who approved the order at the Division Chief's desk, and when, like the recommendation columns. */
function ensure_travel_order_chief_reviewed_columns(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'chief_reviewed_by_employee_id'");
    if ($statement === false || $statement->fetch() === false) {
        $pdo->exec('ALTER TABLE travel_orders ADD COLUMN chief_reviewed_by_employee_id INT UNSIGNED NULL AFTER recommended_at');
    }

    $statement = $pdo->query("SHOW COLUMNS FROM travel_orders LIKE 'chief_reviewed_at'");
    if ($statement === false || $statement->fetch() === false) {
        $pdo->exec('ALTER TABLE travel_orders ADD COLUMN chief_reviewed_at DATETIME NULL AFTER chief_reviewed_by_employee_id');
    }
}

/**
 * Who filed the order, which is not who is travelling and no longer who recommends it.
 *
 * A chief may file for employees in any division and may still call the trip off, so the filer has
 * to be recorded separately now that the "Recommended by" line belongs to the Planning Officer.
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
    return in_array($roleKey, ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'planningofficer'], true)
        || user_exact_role_key($user) === 'chiefadmin'
        || travel_is_self_service_role($user);
}

/*
 * The roles that only ever see their own orders. They may tidy those into the archive as well --
 * archiving is not a decision -- but only once an order is settled, so one still moving through the
 * desks cannot be hidden from them.
 */
function travel_is_self_service_role(array $user): bool
{
    return in_array(travel_role_key($user), ['employee', 'cashier'], true);
}

/*
 * A travel order is signed in three desks. The Planning Officer recommends a filed order, which is
 * what fills the "Recommended by" line on the printed form and moves the row to `reviewed`; the
 * Division Chief of the traveller's division approves it next (`chief_reviewed`); the Regional
 * Director then gives the final approval. No desk may act out of turn -- a pending order has no
 * recommendation for the Chief to approve, and a reviewed one is past the Planning Officer. An
 * admin sits in all three so a stuck order always has a way through.
 */

/** The Planning Officer's desk: recommends a filed order up to the Division Chief. */
function travel_can_recommend(array $user): bool
{
    return in_array(travel_role_key($user), ['admin', 'planningofficer'], true);
}

/**
 * The Division Chief's desk. A Chief approves only for their own division, which the read scope
 * alone does not guarantee (it also carries orders a Chief filed), so the traveller's division is
 * checked against the Chief's here.
 */
function travel_can_chief_review(PDO $pdo, array $user, int $travellerEmployeeId): bool
{
    $roleKey = travel_role_key($user);

    if ($roleKey === 'admin') {
        return true;
    }

    if ($roleKey !== 'chief') {
        return false;
    }

    $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id LIMIT 1');
    $statement->execute([':id' => $travellerEmployeeId]);

    return (int)$statement->fetchColumn() === travel_session_division_id($pdo, $user);
}

/** The Regional Director's desk: the only one whose approval finishes a travel order. */
function travel_can_give_final_approval(array $user): bool
{
    return in_array(travel_role_key($user), ['admin', 'regionaldirector'], true);
}

/**
 * Whether the traveller's division has a Chief who can sign the Chief stage: an active Chief (or a
 * role built on Chief, such as Chief Admin) in that division other than the traveller. A division
 * without one -- the Office of the Regional Director, say, or a Chief travelling with no second
 * Chief beside them -- would otherwise leave the order on a desk nobody sits at.
 */
function travel_division_has_chief_reviewer(PDO $pdo, int $travellerEmployeeId): bool
{
    ensure_role_columns($pdo);
    $statement = $pdo->prepare(
        'SELECT 1
         FROM employees traveller
         INNER JOIN employees chief_employee
            ON chief_employee.division_id = traveller.division_id
           AND chief_employee.is_archived = 0
           AND chief_employee.id <> traveller.id
         INNER JOIN users chief_user
            ON chief_user.email COLLATE utf8mb4_unicode_ci = chief_employee.email COLLATE utf8mb4_unicode_ci
           AND chief_user.is_archived = 0
           AND LOWER(chief_user.status) = "active"
         INNER JOIN roles chief_role ON chief_role.id = chief_user.role_id
         WHERE traveller.id = :employee_id
           AND (
                LOWER(REPLACE(chief_role.name, " ", "")) = "chief"
                OR LOWER(REPLACE(COALESCE(chief_role.base_role, ""), " ", "")) = "chief"
           )
         LIMIT 1'
    );
    $statement->execute([':employee_id' => $travellerEmployeeId]);

    return $statement->fetchColumn() !== false;
}

/** Where a recommended order goes next: the Chief's desk, or straight on when there is no Chief. */
function travel_status_after_recommendation(PDO $pdo, int $travellerEmployeeId): string
{
    return travel_division_has_chief_reviewer($pdo, $travellerEmployeeId) ? 'reviewed' : 'chief_reviewed';
}

function travel_can_view_all(array $user): bool
{
    return !in_array(travel_role_key($user), ['employee', 'cashier'], true);
}

/** The statuses a travel order can still be acted on from. */
function travel_status_is_open(string $status): bool
{
    return in_array($status, ['pending', 'reviewed', 'chief_reviewed'], true);
}

function travel_status_to_client(string $status): string
{
    return match (strtolower($status)) {
        'reviewed' => 'Reviewed',
        'chief_reviewed' => 'Chief Reviewed',
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
        'chief_reviewed', 'chief reviewed', 'chiefreviewed' => 'chief_reviewed',
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

function travel_session_division_id(PDO $pdo, array $user): int
{
    $employeeId = resolve_session_employee_id($pdo, $user);
    $statement = $pdo->prepare(
        'SELECT division_id
         FROM employees
         WHERE id = :id
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeId]);
    $divisionId = (int)$statement->fetchColumn();

    if ($divisionId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Your employee record is not assigned to a division.',
        ], 422);
    }

    return $divisionId;
}

/**
 * Employees and Cashiers receive only their own orders. The Planning Officer and Regional Director are the
 * organization-wide dispatch and final-approval desks, so routed orders reach both roles regardless
 * of division. HR Head uses Travel Order as a personal record screen and therefore receives only
 * their own orders. HR Staff work organization-wide. The Chief is division-scoped and additionally
 * keeps access to orders they personally filed, so cross-division orders filed before filing was restricted to
 * the Chief's own division (see assert_travel_employee_in_chief_division()) stay visible to them.
 * Administrators retain organization-wide oversight.
 */
function travel_read_scopes(PDO $pdo, array $sessionUser): array
{
    return match (travel_role_key($sessionUser)) {
        'employee', 'cashier', 'hrhead' => [
            'employeeId' => resolve_session_employee_id($pdo, $sessionUser),
            'divisionId' => null,
            'filedByEmployeeId' => null,
        ],
        'chief' => [
            'employeeId' => null,
            'divisionId' => travel_session_division_id($pdo, $sessionUser),
            'filedByEmployeeId' => resolve_session_employee_id($pdo, $sessionUser),
        ],
        'planningofficer', 'regionaldirector' => [
            'employeeId' => null,
            'divisionId' => null,
            'filedByEmployeeId' => null,
        ],
        'hrstaff' => [
            'employeeId' => null,
            'divisionId' => null,
            'filedByEmployeeId' => null,
        ],
        default => ['employeeId' => null, 'divisionId' => null, 'filedByEmployeeId' => null],
    };
}

/**
 * The recommendation on a newly filed order.
 *
 * Recommending is the Planning Officer's step, so a planning officer filing for their division has
 * already made it and the order goes straight to the Division Chief. Every other filer -- a
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
    $request['rejectedByRole'] = travel_text($request['rejectedByRole'] ?? '');
    $request['approvedByEmployeeRecordId'] = $request['approvedByEmployeeRecordId'] !== null
        ? (int)$request['approvedByEmployeeRecordId']
        : null;
    $request['approvedBy'] = travel_text($request['approvedBy'] ?? '');
    $request['recommendedByEmployeeRecordId'] = $request['recommendedByEmployeeRecordId'] !== null
        ? (int)$request['recommendedByEmployeeRecordId']
        : null;
    $request['recommendedBy'] = travel_text($request['recommendedBy'] ?? '');
    $request['recommendedAt'] = travel_text($request['recommendedAt'] ?? '');
    $request['chiefReviewedByEmployeeRecordId'] = ($request['chiefReviewedByEmployeeRecordId'] ?? null) !== null
        ? (int)$request['chiefReviewedByEmployeeRecordId']
        : null;
    $request['chiefReviewedBy'] = travel_text($request['chiefReviewedBy'] ?? '');
    $request['chiefReviewedAt'] = travel_text($request['chiefReviewedAt'] ?? '');
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
     * signatory. Legacy rows were parked at `pending`, current ones at `chief_reviewed`.
     */
    $request['awaitingAuthorization'] = travel_status_is_open($statusKey)
        && $request['approvedByEmployeeRecordId'] !== null;

    return travel_apply_signatory_fallbacks($pdo, $request);
}

function fetch_travel_order(
    PDO $pdo,
    int $id,
    ?int $employeeScopeId = null,
    ?int $divisionScopeId = null,
    ?int $filedByEmployeeScopeId = null
): ?array
{
    $sql = 'SELECT
                t.travel_order_id AS id,
                t.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                ' . employee_role_name_subselect() . ' AS employeeRole,
                des.name AS position,
                e.designation,
                t.destination,
                t.purpose,
                t.start_date AS startDate,
                t.end_date AS endDate,
                t.assistance_labor AS assistanceLabor,
                t.appropriations,
                t.remarks,
                COALESCE(t.rejected_note, "") AS rejectedNote,
                COALESCE(t.rejected_by_role, "") AS rejectedByRole,
                t.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                t.employee_authorized_at AS employeeAuthorizedAt,
                t.recommended_by_employee_id AS recommendedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(recommended_employee.first_name, " ", COALESCE(recommended_employee.middle_name, ""), " ", recommended_employee.last_name)), ""), "") AS recommendedBy,
                t.recommended_at AS recommendedAt,
                t.chief_reviewed_by_employee_id AS chiefReviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(chief_reviewed_employee.first_name, " ", COALESCE(chief_reviewed_employee.middle_name, ""), " ", chief_reviewed_employee.last_name)), ""), "") AS chiefReviewedBy,
                t.chief_reviewed_at AS chiefReviewedAt,
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
            LEFT JOIN employees chief_reviewed_employee ON chief_reviewed_employee.id = t.chief_reviewed_by_employee_id
            LEFT JOIN employees filed_employee ON filed_employee.id = t.filed_by_employee_id
            WHERE t.travel_order_id = :id';

    if ($employeeScopeId !== null) {
        $sql .= ' AND t.employee_id = :employee_scope_id';
    }

    if ($divisionScopeId !== null && $filedByEmployeeScopeId !== null) {
        $sql .= ' AND (e.division_id = :division_scope_id OR t.filed_by_employee_id = :filed_by_employee_scope_id)';
    } elseif ($divisionScopeId !== null) {
        $sql .= ' AND e.division_id = :division_scope_id';
    } elseif ($filedByEmployeeScopeId !== null) {
        $sql .= ' AND t.filed_by_employee_id = :filed_by_employee_scope_id';
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    if ($divisionScopeId !== null) {
        $params[':division_scope_id'] = $divisionScopeId;
    }
    if ($filedByEmployeeScopeId !== null) {
        $params[':filed_by_employee_scope_id'] = $filedByEmployeeScopeId;
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
            COALESCE(t.rejected_note, "") AS rejectedNote,
            COALESCE(t.rejected_by_role, "") AS rejectedByRole
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
    $request['rejectedByRole'] = travel_text($request['rejectedByRole'] ?? '');

    return $request;
}

function send_travel_rejection_notification(PDO $pdo, int $id): ?string
{
    $request = fetch_travel_order_notification_context($pdo, $id);

    if ($request === null) {
        return 'Travel order disapproved, but employee details could not be loaded for email notification.';
    }

    $employeeEmail = travel_text($request['employeeEmail'] ?? '');

    if ($employeeEmail === '' || filter_var($employeeEmail, FILTER_VALIDATE_EMAIL) === false) {
        return 'Travel order disapproved, but no valid employee email address is available.';
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
        return 'Travel order disapproved, but the disapproval email could not be sent.';
    }

    return null;
}

function list_travel_orders(PDO $pdo, array $sessionUser): void
{
    $scopes = travel_read_scopes($pdo, $sessionUser);
    $employeeScopeId = $scopes['employeeId'];
    $divisionScopeId = $scopes['divisionId'];
    $filedByEmployeeScopeId = $scopes['filedByEmployeeId'];

    $sql = 'SELECT
                t.travel_order_id AS id,
                t.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                d.name AS division,
                ' . employee_role_name_subselect() . ' AS employeeRole,
                des.name AS position,
                e.designation,
                t.destination,
                t.purpose,
                t.start_date AS startDate,
                t.end_date AS endDate,
                t.assistance_labor AS assistanceLabor,
                t.appropriations,
                t.remarks,
                COALESCE(t.rejected_note, "") AS rejectedNote,
                COALESCE(t.rejected_by_role, "") AS rejectedByRole,
                t.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedBy,
                t.employee_authorized_at AS employeeAuthorizedAt,
                t.recommended_by_employee_id AS recommendedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(recommended_employee.first_name, " ", COALESCE(recommended_employee.middle_name, ""), " ", recommended_employee.last_name)), ""), "") AS recommendedBy,
                t.recommended_at AS recommendedAt,
                t.chief_reviewed_by_employee_id AS chiefReviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(chief_reviewed_employee.first_name, " ", COALESCE(chief_reviewed_employee.middle_name, ""), " ", chief_reviewed_employee.last_name)), ""), "") AS chiefReviewedBy,
                t.chief_reviewed_at AS chiefReviewedAt,
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
            LEFT JOIN employees chief_reviewed_employee ON chief_reviewed_employee.id = t.chief_reviewed_by_employee_id
            LEFT JOIN employees filed_employee ON filed_employee.id = t.filed_by_employee_id
            WHERE t.is_archived = :is_archived';

    $params = [':is_archived' => archived_view_requested() ? 1 : 0];
    if ($employeeScopeId !== null) {
        $sql .= ' AND t.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    if ($divisionScopeId !== null && $filedByEmployeeScopeId !== null) {
        $sql .= ' AND (e.division_id = :division_scope_id OR t.filed_by_employee_id = :filed_by_employee_scope_id)';
        $params[':division_scope_id'] = $divisionScopeId;
        $params[':filed_by_employee_scope_id'] = $filedByEmployeeScopeId;
    } elseif ($divisionScopeId !== null) {
        $sql .= ' AND e.division_id = :division_scope_id';
        $params[':division_scope_id'] = $divisionScopeId;
    } elseif ($filedByEmployeeScopeId !== null) {
        $sql .= ' AND t.filed_by_employee_id = :filed_by_employee_scope_id';
        $params[':filed_by_employee_scope_id'] = $filedByEmployeeScopeId;
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

/** A Chief files travel orders only for employees in their own division (themselves included). */
function assert_travel_employee_in_chief_division(PDO $pdo, array $sessionUser, int $employeeId): void
{
    if (travel_role_key($sessionUser) !== 'chief') {
        return;
    }

    $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
    $statement->execute([':id' => $employeeId]);

    if ((int)$statement->fetchColumn() !== travel_session_division_id($pdo, $sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Chiefs may only file travel orders for employees in their own division.',
        ], 403);
    }
}

function create_travel_order(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_travel_employee_id($pdo, $body, $sessionUser);
    assert_travel_employee_in_chief_division($pdo, $sessionUser, $employeeId);
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
     * A planning officer filing has already made the recommendation, so their order skips to the
     * Division Chief (or the Regional Director, when the division has no Chief to sign). Everyone
     * else's starts at `pending` and waits for the Planning Officer.
     */
    $initialStatus = $recommendedByEmployeeId !== null
        ? travel_status_after_recommendation($pdo, $employeeId)
        : 'pending';

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
    $scopes = travel_read_scopes($pdo, $sessionUser);
    json_response([
        'success' => true,
        'request' => fetch_travel_order(
            $pdo,
            $requestId,
            $scopes['employeeId'],
            $scopes['divisionId'],
            $scopes['filedByEmployeeId']
        ),
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
            'message' => 'Disapproval note is required.',
        ], 422);
    }

    $scopes = travel_read_scopes($pdo, $sessionUser);
    if (fetch_travel_order(
        $pdo,
        $id,
        $scopes['employeeId'],
        $scopes['divisionId'],
        $scopes['filedByEmployeeId']
    ) === null) {
        json_response([
            'success' => false,
            'message' => 'Travel order not found.',
        ], 404);
    }

    $currentRequestStatement = $pdo->prepare(
        'SELECT employee_id, filed_by_employee_id, recommended_by_employee_id, chief_reviewed_by_employee_id, approved_by_employee_id, status
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
     * Officer's to recommend or reject; a reviewed one is the traveller's Division Chief's to
     * approve or reject; a chief_reviewed one is the Regional Director's. Cancelling is the way out
     * for whoever owns the trip -- the traveller or the filer -- for as long as the Director has
     * not signed.
     */
    $travellerEmployeeId = (int)($currentRequest['employee_id'] ?? 0);
    $isChiefRole = travel_role_key($sessionUser) === 'chief';
    $canRecommendNow = $currentStatus === 'pending' && travel_can_recommend($sessionUser);
    $canChiefReviewNow = $currentStatus === 'reviewed'
        && !$alreadyFinallyApproved
        && travel_can_chief_review($pdo, $sessionUser, $travellerEmployeeId);
    $canFinallyApproveNow = $currentStatus === 'chief_reviewed'
        && !$alreadyFinallyApproved
        && travel_can_give_final_approval($sessionUser);
    $isOwnCancellation = $status === 'cancelled'
        && ($isOwnRequest || $isFiler)
        && travel_status_is_open($currentStatus)
        && !$alreadyFinallyApproved;

    if (!$canRecommendNow && !$canChiefReviewNow && !$canFinallyApproveNow && !$isOwnCancellation) {
        // Say which desk the order is waiting on rather than a flat "not allowed".
        json_response([
            'success' => false,
            'message' => match (true) {
                !travel_status_is_open($currentStatus) => 'This travel order has already been ' . $currentStatus . '.',
                $alreadyFinallyApproved =>
                    'This travel order was already approved by the Regional Director and is waiting for the employee authorization.',
                $currentStatus === 'pending' && ($isChiefRole || travel_can_give_final_approval($sessionUser)) =>
                    'This travel order is still waiting for the Planning Officer to recommend it.',
                $currentStatus === 'reviewed' && $isChiefRole =>
                    'Only the Chief of the employee\'s division can approve this travel order.',
                $currentStatus === 'reviewed' && travel_can_recommend($sessionUser) =>
                    'This travel order has already been recommended and is waiting for the Division Chief.',
                $currentStatus === 'reviewed' && travel_can_give_final_approval($sessionUser) =>
                    'This travel order is still waiting for the Division Chief to approve it.',
                $currentStatus === 'chief_reviewed' && ($isChiefRole || travel_can_recommend($sessionUser)) =>
                    'This travel order has already been approved by the Division Chief and is waiting for the Regional Director.',
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
    $isChiefReview = $status === 'approved' && $canChiefReviewNow;
    $isFinalApproval = $status === 'approved' && $canFinallyApproveNow;

    if ($status === 'approved' && !$isRecommendation && !$isChiefReview && !$isFinalApproval) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to approve this travel order at its current stage.',
        ], 403);
    }

    if (($isRecommendation || $isChiefReview || $isFinalApproval) && ($sessionEmployeeId === null || $sessionEmployeeId <= 0)) {
        json_response([
            'success' => false,
            'message' => 'Your account is not linked to an employee record, so the decision cannot be recorded.',
        ], 422);
    }

    /*
     * Every signature on the order carries a solved captcha: the Planning Officer's recommendation,
     * which authorizes the trip for dispatch, the Division Chief's approval, and the Regional
     * Director's. Rejecting and cancelling do not; see the approval_workflow entry in
     * captcha-utils.php.
     */
    if ($isRecommendation || $isChiefReview || $isFinalApproval) {
        require_approval_captcha($body, 'travel', $id);
    }

    /*
     * A Regional Director approval does not finish the travel order. The employee still has to
     * accept the COA liquidation authorization printed on the form, so the row is held at its
     * current stage with the approver recorded, and authorize_travel_order() below moves it to
     * approved.
     */
    $nextStatus = match (true) {
        $isRecommendation => travel_status_after_recommendation($pdo, $travellerEmployeeId),
        $isChiefReview => 'chief_reviewed',
        $isFinalApproval => $currentStatus,
        default => $status,
    };

    $nextRecommendedByEmployeeId = $isRecommendation
        ? $sessionEmployeeId
        : (($currentRequest['recommended_by_employee_id'] ?? null) !== null
            ? (int)$currentRequest['recommended_by_employee_id']
            : null);

    /* A Chief rejecting at their desk is recorded as that desk's signer, like the Director below. */
    $isChiefSignature = $isChiefReview || ($status === 'rejected' && $canChiefReviewNow);
    $nextChiefReviewedByEmployeeId = $isChiefSignature
        ? $sessionEmployeeId
        : (($currentRequest['chief_reviewed_by_employee_id'] ?? null) !== null
            ? (int)$currentRequest['chief_reviewed_by_employee_id']
            : null);

    /* A rejection records who signed it too, so the form prints "Disapproved by" with a name. */
    $isDeskRejection = $status === 'rejected' && $canFinallyApproveNow;
    $nextApprovedByEmployeeId = ($isFinalApproval || $isDeskRejection) ? $sessionEmployeeId : null;

    $statement = $pdo->prepare(
        'UPDATE travel_orders
         SET status = :status,
             rejected_note = :rejected_note,
             rejected_by_role = :rejected_by_role,
             recommended_by_employee_id = :recommended_by_employee_id,
             /* Only a fresh recommendation moves this; every other update leaves it standing. */
             recommended_at = COALESCE(:recommended_at, recommended_at),
             chief_reviewed_by_employee_id = :chief_reviewed_by_employee_id,
             chief_reviewed_at = COALESCE(:chief_reviewed_at, chief_reviewed_at),
             approved_by_employee_id = :approved_by_employee_id,
             employee_authorized_at = NULL
         WHERE travel_order_id = :id'
    );
    $statement->execute([
        ':status' => $nextStatus,
        ':rejected_note' => $status === 'rejected' ? $rejectedNote : null,
        ':rejected_by_role' => $status === 'rejected' ? travel_role_key($sessionUser) : null,
        ':recommended_by_employee_id' => $nextRecommendedByEmployeeId,
        ':recommended_at' => $isRecommendation ? date('Y-m-d H:i:s') : null,
        ':chief_reviewed_by_employee_id' => $nextChiefReviewedByEmployeeId,
        ':chief_reviewed_at' => $isChiefSignature ? date('Y-m-d H:i:s') : null,
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

    $updatedRequest = fetch_travel_order(
        $pdo,
        $id,
        $scopes['employeeId'],
        $scopes['divisionId'],
        $scopes['filedByEmployeeId']
    );

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
            $status === 'rejected' => $notificationWarning ?? 'Travel order disapproved and the employee was notified by email.',
            $status === 'cancelled' => 'Travel order cancelled.',
            $isRecommendation && $nextStatus === 'reviewed' =>
                'Travel order authorized for dispatch. It now goes to the Division Chief for approval.',
            $isRecommendation => 'Travel order authorized for dispatch. It now goes to the Regional Director for final approval.',
            $isChiefReview => 'Travel order approved. It now goes to the Regional Director for final approval.',
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
           AND status IN ("pending", "reviewed", "chief_reviewed")
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
    $scopes = travel_read_scopes($pdo, $sessionUser);
    $request = $id > 0
        ? fetch_travel_order(
            $pdo,
            $id,
            $scopes['employeeId'],
            $scopes['divisionId'],
            $scopes['filedByEmployeeId']
        )
        : null;

    if ($request === null) {
        json_response([
            'success' => false,
            'message' => 'Travel order not found.',
        ], 404);
    }

    if (
        $archived
        && travel_is_self_service_role($sessionUser)
        && travel_status_is_open(travel_status_to_database($request['status'] ?? ''))
    ) {
        json_response([
            'success' => false,
            'message' => 'Only approved, rejected, or cancelled travel orders can be archived.',
        ], 422);
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
        'request' => fetch_travel_order(
            $pdo,
            $id,
            $scopes['employeeId'],
            $scopes['divisionId'],
            $scopes['filedByEmployeeId']
        ),
    ]);
}

try {
    ensure_travel_order_rejected_note_column($pdo);
    ensure_travel_order_approved_by_employee_column($pdo);
    ensure_travel_order_recommended_by_column($pdo);
    ensure_travel_order_filed_by_column($pdo);
    ensure_travel_order_recommended_at_column($pdo);
    ensure_travel_order_employee_authorized_column($pdo);
    ensure_travel_order_chief_reviewed_columns($pdo);
    ensure_travel_order_workflow_statuses($pdo);
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
