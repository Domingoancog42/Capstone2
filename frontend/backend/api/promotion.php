<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/captcha-utils.php';

$sessionUser = require_session_user();

/*
 * Promotions.
 *
 * A promotion moves an employee to a designation that sits higher in the office hierarchy (see
 * `designations.hierarchy_level`, seeded and edited from Settings). Editing the designation on the
 * employee form already rewrites the appointment, but it does so instantly and by one pair of hands;
 * a promotion is a decision three desks sign: HR prepares it, the HR Head recommends it, and the
 * Regional Director gives the final approval. Only at that last signature does anything change on
 * the employee record, and the same transaction appends the CS Form No. 1 entry so the service
 * record and the masterfile can never disagree about when the appointment changed.
 *
 * The statuses walk that chain: pending (awaiting HR Head) -> recommended (awaiting the Regional
 * Director) -> approved, with rejected and cancelled as the two ways out. The HR Head can also
 * nominate an employee of any division themselves; being the recommending authority already, that
 * draft opens at `recommended`.
 */

const PROMOTION_TABLE = 'promotions';

const PROMOTION_STATUSES = ['pending', 'recommended', 'approved', 'rejected', 'cancelled'];

/** Statuses that still block a second promotion for the same employee. */
const PROMOTION_OPEN_STATUSES = ['pending', 'recommended'];

function promotion_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function promotion_date_or_null(mixed $value): ?string
{
    $text = promotion_text($value);

    if ($text === '') {
        return null;
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $text);

    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function promotion_decimal_or_null(mixed $value): ?string
{
    $text = promotion_text($value);

    if ($text === '' || !is_numeric($text)) {
        return null;
    }

    return number_format((float)$text, 2, '.', '');
}

function promotion_status_label(string $status): string
{
    return match (strtolower($status)) {
        'recommended' => 'Recommended',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled' => 'Cancelled',
        default => 'Pending',
    };
}

function promotion_role_key(array $user): string
{
    return user_role_key($user);
}

/*
 * Only Regular (plantilla) employees can be promoted up the designation hierarchy; a Contract of
 * Service appointment is not a position to be promoted from. `employees.employment_status` carries
 * the label the employee form writes -- "Regular" or "Contract of Service" -- but older rows were
 * typed by hand, so "Permanent" (the earlier spelling of Regular) is accepted too, and the match
 * ignores case and surrounding spaces. A blank status is not Regular.
 *
 * The SQL fragment and the PHP check must agree: the first draws the picker in
 * get_promotion_options(), the second holds the line in create_promotion().
 */
const PROMOTION_REGULAR_EMPLOYMENT_STATUSES = ['regular', 'permanent'];

function promotion_regular_employment_sql(string $alias = 'e'): string
{
    $values = implode(', ', array_map(static fn (string $value): string => '"' . $value . '"', PROMOTION_REGULAR_EMPLOYMENT_STATUSES));

    return 'LOWER(TRIM(COALESCE(' . $alias . '.employment_status, ""))) IN (' . $values . ')';
}

function promotion_is_regular_employment_status(mixed $value): bool
{
    return in_array(strtolower(trim((string)($value ?? ''))), PROMOTION_REGULAR_EMPLOYMENT_STATUSES, true);
}

/*
 * The desks that prepare a promotion, and cancel one still in flight. A chief prepares for the
 * Regular employees of their own division (see PROMOTION_DIVISION_SCOPED_ROLES). Mirrors
 * PREPARER_ROLES in PromotionWorkspace.jsx.
 */
function promotion_can_prepare(array $user): bool
{
    return in_array(promotion_role_key($user), ['admin', 'hrstaff', 'chief'], true);
}

/*
 * The desk that nominates: the HR Head drafts a promotion for a Regular employee of any division,
 * and since they are the recommending authority it opens at `recommended` (see create_promotion()).
 * Nominating does not carry the preparers' cancel. Mirrors NOMINATOR_ROLES in PromotionWorkspace.jsx.
 */
function promotion_can_nominate(array $user): bool
{
    return promotion_role_key($user) === 'hrhead';
}

/*
 * The organization-wide recommending desks are the HR Head and HR Staff. The screen calls the HR
 * Staff's step Approve; either way it moves a pending promotion on to the
 * Regional Director. Admin sits in every seat so a stuck promotion always has a way through.
 * Mirrors RECOMMENDER_ROLES in PromotionWorkspace.jsx.
 */
function promotion_can_recommend(array $user): bool
{
    return in_array(promotion_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

/**
 * The HR Staff whose employee record sits in a division: the desk told when one of its promotions
 * is waiting. Users are linked to employees by email, the way user_id_for_employee_record() does it,
 * and a custom role based on HR Staff counts the same as HR Staff itself.
 */
function promotion_hr_staff_user_ids_for_division(PDO $pdo, int $divisionId): array
{
    if ($divisionId <= 0) {
        return [];
    }

    ensure_role_columns($pdo);

    $statement = $pdo->prepare(
        'SELECT DISTINCT u.id
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE u.is_archived = 0
           AND e.division_id = :division_id
           AND (
             LOWER(REPLACE(r.name, " ", "")) = "hrstaff"
             OR LOWER(REPLACE(COALESCE(r.base_role, ""), " ", "")) = "hrstaff"
           )
         ORDER BY u.id ASC'
    );
    $statement->execute([':division_id' => $divisionId]);

    return array_map('intval', array_column($statement->fetchAll(), 'id'));
}

/** The final signature. */
function promotion_can_approve(array $user): bool
{
    return in_array(promotion_role_key($user), ['admin', 'regionaldirector'], true);
}

/**
 * The desks that file a settled promotion away and bring it back: the one that drafts it and the
 * two that sign it. Mirrors ARCHIVE_MANAGER_ROLES.promotions in frontend/src/utils/archiveActions.js.
 */
function promotion_can_archive(array $user): bool
{
    return promotion_can_prepare($user) || promotion_can_recommend($user) || promotion_can_approve($user);
}

/*
 * The desks that read the register rather than only their own record. For the division-scoped Chief,
 * "all" means their division's part of it; HR Staff read the organization-wide register.
 */
/**
 * Tells the HR desks and the desk that drafted a promotion how it was decided. HR is addressed by
 * role; the requester is addressed by user id as well, which is what reaches a chief without
 * telling every other division's chief. notification_insert() drops the duplicate an HR requester
 * would otherwise get.
 */
function promotion_notify_drafting_desks(
    PDO $pdo,
    array $promotion,
    string $title,
    string $message,
    string $type,
    string $referenceId
): void {
    notify_roles($pdo, ['hrhead', 'hrstaff'], $title, $message, $type, $referenceId);

    $requestedByUserId = (int)($promotion['requested_by_user_id'] ?? 0);

    if ($requestedByUserId > 0) {
        notify_users($pdo, [$requestedByUserId], $title, $message, $type, $referenceId);
    }
}

function promotion_can_view_all(array $user): bool
{
    return in_array(promotion_role_key($user), ['admin', 'hrhead', 'hrstaff', 'chief', 'regionaldirector'], true);
}

function ensure_promotions_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    ensure_designation_hierarchy_columns($pdo);

    if (!database_table_exists($pdo, PROMOTION_TABLE)) {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS promotions (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                employee_record_id INT UNSIGNED NOT NULL,
                from_designation_id INT UNSIGNED NULL,
                from_designation_title VARCHAR(180) NULL,
                from_division_id INT UNSIGNED NULL,
                from_hierarchy_level TINYINT UNSIGNED NULL,
                from_salary DECIMAL(12,2) NULL,
                to_designation_id INT UNSIGNED NOT NULL,
                to_designation_title VARCHAR(180) NOT NULL,
                to_division_id INT UNSIGNED NOT NULL,
                to_hierarchy_level TINYINT UNSIGNED NOT NULL,
                to_salary DECIMAL(12,2) NOT NULL,
                salary_grade VARCHAR(20) NULL,
                step_increment VARCHAR(10) NULL,
                effective_date DATE NOT NULL,
                justification TEXT NULL,
                status ENUM("pending","recommended","approved","rejected","cancelled") NOT NULL DEFAULT "pending",
                rejected_note TEXT NULL,
                rejected_by_role VARCHAR(80) NULL,
                requested_by_user_id INT UNSIGNED NULL,
                recommended_by_employee_id INT UNSIGNED NULL,
                recommended_at DATETIME NULL,
                approved_by_employee_id INT UNSIGNED NULL,
                approved_at DATETIME NULL,
                service_record_id INT UNSIGNED NULL,
                greeted_at DATETIME NULL,
                viewed_at DATETIME NULL,
                is_archived TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_promotions_employee (employee_record_id, status),
                KEY idx_promotions_status (status),
                KEY idx_promotions_effective_date (effective_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    ensure_promotion_greeted_column($pdo);
    ensure_promotion_viewed_column($pdo);

    $ensured = true;
}

/**
 * `greeted_at` is when the promoted employee saw the congratulations card on their dashboard. It is
 * NULL from the Director's signature until the employee next opens the dashboard, which is what
 * makes the greeting show once and on whichever device they sign in from, instead of once per
 * browser. Tables created before the column existed pick it up here.
 */
function ensure_promotion_greeted_column(PDO $pdo): void
{
    if (!database_table_exists($pdo, PROMOTION_TABLE) || database_column_exists($pdo, PROMOTION_TABLE, 'greeted_at')) {
        return;
    }

    try {
        $pdo->exec('ALTER TABLE promotions ADD COLUMN greeted_at DATETIME NULL AFTER service_record_id');
    } catch (Throwable $exception) {
        // A parallel request that won the race already added it; the next column check sees it.
        error_log('Promotion greeted_at column setup skipped: ' . $exception->getMessage());
    }
}

/**
 * `viewed_at` belongs to the My Promotion sidebar indicator, not the dashboard greeting.  The two
 * moments are deliberately distinct: closing the congratulations card should not clear the badge
 * before the employee has opened their promotion record.
 *
 * Existing greeted promotions are initialized as viewed during this one-time schema upgrade so an
 * employee is not alerted for an appointment they had already acknowledged before this indicator
 * existed.
 */
function ensure_promotion_viewed_column(PDO $pdo): void
{
    if (!database_table_exists($pdo, PROMOTION_TABLE) || database_column_exists($pdo, PROMOTION_TABLE, 'viewed_at')) {
        return;
    }

    try {
        $pdo->exec('ALTER TABLE promotions ADD COLUMN viewed_at DATETIME NULL AFTER greeted_at');
        $pdo->exec('UPDATE promotions SET viewed_at = greeted_at WHERE greeted_at IS NOT NULL AND viewed_at IS NULL');
    } catch (Throwable $exception) {
        // A parallel request may have installed the column first; either way later requests can use it.
        error_log('Promotion viewed_at column setup skipped: ' . $exception->getMessage());
    }
}

/**
 * One row with everything the client shows. Titles come from the snapshot columns rather than the
 * joined designation: a designation renamed after the fact must not rewrite what the promotion said.
 */
function promotion_base_select(): string
{
    return 'SELECT
                p.*,
                e.employee_id AS employee_code,
                CONCAT_WS(" ", NULLIF(e.first_name, ""), NULLIF(e.middle_name, ""), NULLIF(e.last_name, ""), NULLIF(e.suffix, "")) AS employee_name,
                e.profile_image AS employee_profile_image,
                e.date_hired AS employee_date_hired,
                e.employment_status AS employee_employment_status,
                ed.name AS employee_division_name,
                fd.name AS from_division_name,
                td.name AS to_division_name,
                CONCAT_WS(" ", NULLIF(rb.first_name, ""), NULLIF(rb.last_name, "")) AS recommended_by_name,
                CONCAT_WS(" ", NULLIF(ab.first_name, ""), NULLIF(ab.last_name, "")) AS approved_by_name,
                ru.username AS requested_by_username
            FROM promotions p
            INNER JOIN employees e ON e.id = p.employee_record_id
            LEFT JOIN divisions ed ON ed.id = e.division_id
            LEFT JOIN divisions fd ON fd.id = p.from_division_id
            LEFT JOIN divisions td ON td.id = p.to_division_id
            LEFT JOIN employees rb ON rb.id = p.recommended_by_employee_id
            LEFT JOIN employees ab ON ab.id = p.approved_by_employee_id
            LEFT JOIN users ru ON ru.id = p.requested_by_user_id';
}

function promotion_format_row(array $row): array
{
    $status = strtolower(promotion_text($row['status'] ?? 'pending'));

    return [
        'id' => (int)$row['id'],
        'employeeRecordId' => (int)$row['employee_record_id'],
        'employeeId' => promotion_text($row['employee_code'] ?? ''),
        'employeeName' => promotion_text($row['employee_name'] ?? ''),
        'profileImage' => promotion_text($row['employee_profile_image'] ?? ''),
        'dateHired' => $row['employee_date_hired'] ?? null,
        'employmentStatus' => promotion_text($row['employee_employment_status'] ?? ''),
        /* Where the employee sits today, which the from/to snapshot stops saying once they have moved. */
        'employeeDivision' => promotion_text($row['employee_division_name'] ?? ''),
        'fromDesignationId' => isset($row['from_designation_id']) ? (int)$row['from_designation_id'] : null,
        'fromDesignation' => promotion_text($row['from_designation_title'] ?? ''),
        'fromDivisionId' => isset($row['from_division_id']) ? (int)$row['from_division_id'] : null,
        'fromDivision' => promotion_text($row['from_division_name'] ?? ''),
        'fromLevel' => isset($row['from_hierarchy_level']) ? (int)$row['from_hierarchy_level'] : null,
        'fromSalary' => $row['from_salary'],
        'toDesignationId' => (int)$row['to_designation_id'],
        'toDesignation' => promotion_text($row['to_designation_title'] ?? ''),
        'toDivisionId' => (int)$row['to_division_id'],
        'toDivision' => promotion_text($row['to_division_name'] ?? ''),
        'toLevel' => (int)$row['to_hierarchy_level'],
        'toSalary' => $row['to_salary'],
        'salaryGrade' => promotion_text($row['salary_grade'] ?? ''),
        'stepIncrement' => promotion_text($row['step_increment'] ?? ''),
        'effectiveDate' => $row['effective_date'],
        'justification' => promotion_text($row['justification'] ?? ''),
        'status' => promotion_status_label($status),
        'statusKey' => $status,
        'rejectedNote' => promotion_text($row['rejected_note'] ?? ''),
        'rejectedByRole' => promotion_text($row['rejected_by_role'] ?? ''),
        'requestedBy' => promotion_text($row['requested_by_username'] ?? ''),
        'recommendedBy' => promotion_text($row['recommended_by_name'] ?? ''),
        'recommendedAt' => $row['recommended_at'] ?? null,
        'approvedBy' => promotion_text($row['approved_by_name'] ?? ''),
        'approvedAt' => $row['approved_at'] ?? null,
        'serviceRecordId' => isset($row['service_record_id']) ? (int)$row['service_record_id'] : null,
        'greetedAt' => $row['greeted_at'] ?? null,
        'viewedAt' => $row['viewed_at'] ?? null,
        'isArchived' => (int)($row['is_archived'] ?? 0) === 1,
        'createdAt' => $row['created_at'] ?? null,
        'updatedAt' => $row['updated_at'] ?? null,
    ];
}

/**
 * One promotion by id, or null when there is none -- or when it lies outside the given division
 * scope, so a scoped desk that knows another division's promotion id is told it does not exist
 * rather than shown it.
 */
function fetch_promotion(PDO $pdo, int $id, ?int $divisionScopeId = null): ?array
{
    [$scopeSql, $scopeParams] = promotion_division_scope_sql($divisionScopeId);
    $statement = $pdo->prepare(promotion_base_select() . ' WHERE p.id = :id' . $scopeSql . ' LIMIT 1');
    $statement->execute([':id' => $id] + $scopeParams);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ? promotion_format_row($row) : null;
}

/**
 * The HR desks and the Regional Director see the register; HR Staff and Chiefs see their own
 * division's part of it. Everybody else sees only promotions of their own record.
 */
function list_promotions(PDO $pdo, array $user): void
{
    $archived = archived_view_requested();
    $sql = promotion_base_select() . ' WHERE p.is_archived = :is_archived';
    $parameters = [':is_archived' => $archived ? 1 : 0];

    [$scopeSql, $scopeParams] = promotion_division_scope_sql(promotion_division_scope_id($pdo, $user));
    $sql .= $scopeSql;
    $parameters += $scopeParams;

    if (!promotion_can_view_all($user)) {
        $ownRecordId = session_employee_record_id($pdo, $user);

        if ($ownRecordId === null) {
            json_response(['success' => true, 'promotions' => []]);
        }

        // An employee's My Promotion page is their promotion history: the appointments that took
        // effect. A draft still on HR's desks, or one HR turned down, is HR's business until then.
        $sql .= ' AND p.employee_record_id = :employee_record_id AND p.status = "approved"';
        $parameters[':employee_record_id'] = $ownRecordId;
    }

    $sql .= ' ORDER BY p.created_at DESC, p.id DESC';
    $statement = $pdo->prepare($sql);
    $statement->execute($parameters);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    json_response([
        'success' => true,
        'promotions' => array_map('promotion_format_row', $rows),
    ]);
}

function get_promotion(PDO $pdo, array $user): void
{
    $id = (int)($_GET['id'] ?? 0);
    $promotion = $id > 0 ? fetch_promotion($pdo, $id, promotion_division_scope_id($pdo, $user)) : null;

    if ($promotion === null) {
        json_response(['success' => false, 'message' => 'Promotion not found.'], 404);
    }

    if (!promotion_can_view_all($user)) {
        $ownRecordId = session_employee_record_id($pdo, $user);

        // The same rule as the list: an employee sees the promotions that took effect, nothing in flight.
        if ($ownRecordId === null || $ownRecordId !== $promotion['employeeRecordId'] || $promotion['statusKey'] !== 'approved') {
            json_response(['success' => false, 'message' => 'You can only view your own approved promotions.'], 403);
        }
    }

    json_response(['success' => true, 'promotion' => $promotion]);
}

/**
 * The congratulations the dashboard owes the signed-in employee: their approved promotions that
 * nobody has greeted them for yet. Any role can be promoted, so any session may ask; a session with
 * no employee record simply has nothing to celebrate. Archiving is HR filing the record away and
 * does not take the greeting back -- the appointment still changed.
 */
function list_promotion_greetings(PDO $pdo, array $user): void
{
    $ownRecordId = session_employee_record_id($pdo, $user);

    if ($ownRecordId === null) {
        json_response(['success' => true, 'promotions' => []]);
    }

    $statement = $pdo->prepare(
        promotion_base_select()
        . ' WHERE p.employee_record_id = :employee_record_id
              AND p.status = "approved"
              AND p.greeted_at IS NULL
            ORDER BY p.approved_at DESC, p.id DESC'
    );
    $statement->execute([':employee_record_id' => $ownRecordId]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    json_response([
        'success' => true,
        'promotions' => array_map('promotion_format_row', $rows),
    ]);
}

/**
 * The employee closing their congratulations card. Only the promoted employee can stamp their own
 * promotion, and only an approved one: the stamp records that the greeting was seen, so it has no
 * meaning on a draft. Stamping twice is harmless and answers the same way.
 */
function acknowledge_promotion_greeting(PDO $pdo, array $body, array $user): void
{
    $id = (int)($body['id'] ?? 0);
    $promotion = $id > 0 ? fetch_promotion($pdo, $id) : null;

    if ($promotion === null) {
        json_response(['success' => false, 'message' => 'Promotion not found.'], 404);
    }

    $ownRecordId = session_employee_record_id($pdo, $user);

    if ($ownRecordId === null || $ownRecordId !== $promotion['employeeRecordId']) {
        json_response(['success' => false, 'message' => 'You can only acknowledge your own promotion.'], 403);
    }

    if ($promotion['statusKey'] !== 'approved') {
        json_response(['success' => false, 'message' => 'Only an approved promotion can be acknowledged.'], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE promotions
         SET greeted_at = COALESCE(greeted_at, :greeted_at)
         WHERE id = :id'
    );
    $statement->execute([
        ':greeted_at' => date('Y-m-d H:i:s'),
        ':id' => $id,
    ]);

    json_response([
        'success' => true,
        'message' => 'Promotion acknowledged.',
        'promotion' => fetch_promotion($pdo, $id),
    ]);
}

/**
 * Opening My Promotion clears the employee's new-promotion indicator.  This is deliberately a
 * separate action from acknowledging the dashboard greeting: the employee may close that greeting
 * and still use the sidebar badge as a reminder to review the appointment details.
 */
function mark_promotions_viewed(PDO $pdo, array $user): void
{
    $ownRecordId = session_employee_record_id($pdo, $user);

    if ($ownRecordId === null) {
        json_response(['success' => true, 'message' => 'No employee promotion records to mark as viewed.']);
    }

    $statement = $pdo->prepare(
        'UPDATE promotions
         SET viewed_at = COALESCE(viewed_at, :viewed_at)
         WHERE employee_record_id = :employee_record_id
           AND status = "approved"
           AND viewed_at IS NULL'
    );
    $statement->execute([
        ':viewed_at' => date('Y-m-d H:i:s'),
        ':employee_record_id' => $ownRecordId,
    ]);

    json_response([
        'success' => true,
        'message' => 'Promotions marked as viewed.',
    ]);
}

/**
 * What the promotion form is built from: the active designation catalog with its levels, and the
 * active employees with the level of the designation they hold today. The form filters targets to
 * levels above the employee's own, which is the hierarchy rule made visible before the server
 * enforces it in create_promotion().
 */
/*
 * The Chief drafts promotions for Regular employees of their division, and their register, archive,
 * and cancellations stay in that division. HR Staff, Admin, the HR Head, and the Regional Director
 * work organization-wide. Mirrors DIVISION_SCOPED_PROMOTION_ROLE_KEYS in PromotionWorkspace.jsx.
 */
const PROMOTION_DIVISION_SCOPED_ROLES = ['chief'];

/**
 * The division a desk's promotions are confined to: null for an organization-wide desk, the
 * division id for a scoped one, and 0 when the scoped desk has no division on its employee record,
 * which leaves it nobody to promote or read rather than everybody.
 */
function promotion_division_scope_id(PDO $pdo, array $user): ?int
{
    if (!in_array(promotion_role_key($user), PROMOTION_DIVISION_SCOPED_ROLES, true)) {
        return null;
    }

    $ownRecordId = session_employee_record_id($pdo, $user);

    if ($ownRecordId !== null) {
        $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
        $statement->execute([':id' => $ownRecordId]);
        $divisionId = (int)$statement->fetchColumn();

        if ($divisionId > 0) {
            return $divisionId;
        }
    }

    $division = promotion_text($user['division'] ?? '');

    if ($division === '') {
        return 0;
    }

    // One placeholder per marker: native prepares are on, so a reused name throws HY093.
    $statement = $pdo->prepare(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
           AND (name COLLATE utf8mb4_unicode_ci = :division_name OR code COLLATE utf8mb4_unicode_ci = :division_code)
         LIMIT 1'
    );
    $statement->execute([':division_name' => $division, ':division_code' => $division]);
    $divisionId = (int)$statement->fetchColumn();

    return $divisionId > 0 ? $divisionId : 0;
}

/**
 * The condition confining a query on `promotions p` joined to `employees e` to a scoped desk's
 * division. A promotion belongs to the division the employee was promoted out of and to the one
 * they sit in now, so one that moved them across divisions stays in sight of both HR desks rather
 * than vanishing from the desk that prepared it the moment it took effect. Returns the SQL to append
 * and its parameters; nothing for an organization-wide desk.
 */
function promotion_division_scope_sql(?int $divisionScopeId): array
{
    if ($divisionScopeId === null) {
        return ['', []];
    }

    if ($divisionScopeId <= 0) {
        return [' AND 1 = 0', []];
    }

    // One placeholder per marker: native prepares are on, so a reused name throws HY093.
    return [
        ' AND (p.from_division_id = :division_scope_from OR e.division_id = :division_scope_current)',
        [':division_scope_from' => $divisionScopeId, ':division_scope_current' => $divisionScopeId],
    ];
}

function get_promotion_options(PDO $pdo, array $user): void
{
    if (!promotion_can_prepare($user) && !promotion_can_view_all($user)) {
        json_response(['success' => false, 'message' => 'You do not have permission to prepare promotions.'], 403);
    }

    $divisionScopeId = promotion_division_scope_id($pdo, $user);
    $employeeScopeSql = '';
    $employeeScopeParams = [];
    $ownEmployeeRecordId = session_employee_record_id($pdo, $user);

    // A preparer cannot promote themselves, so do not offer their record in the employee picker.
    if ($ownEmployeeRecordId !== null && $ownEmployeeRecordId > 0) {
        $employeeScopeSql .= ' AND e.id <> :own_employee_record_id';
        $employeeScopeParams[':own_employee_record_id'] = $ownEmployeeRecordId;
    }

    // A scoped desk promotes within its division, so it is offered that division's designations only.
    $designationScopeSql = '';
    $designationScopeParams = [];

    if ($divisionScopeId !== null) {
        if ($divisionScopeId > 0) {
            $employeeScopeSql .= ' AND e.division_id = :division_scope_id';
            $employeeScopeParams[':division_scope_id'] = $divisionScopeId;
            $designationScopeSql = ' AND des.division_id = :division_scope_id';
            $designationScopeParams[':division_scope_id'] = $divisionScopeId;
        } else {
            $employeeScopeSql .= ' AND 1 = 0';
            $designationScopeSql = ' AND 1 = 0';
        }
    }

    $designationStatement = $pdo->prepare(
        'SELECT
            des.id,
            des.name,
            des.division_id,
            des.hierarchy_level,
            des.salary_grade,
            d.name AS division_name
         FROM designations des
         INNER JOIN divisions d ON d.id = des.division_id
         WHERE des.is_archived = 0
           AND d.is_archived = 0' . $designationScopeSql . '
         ORDER BY des.hierarchy_level DESC, d.name, des.name'
    );
    $designationStatement->execute($designationScopeParams);
    $designations = $designationStatement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $employeeStatement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id,
            CONCAT_WS(" ", NULLIF(e.first_name, ""), NULLIF(e.middle_name, ""), NULLIF(e.last_name, ""), NULLIF(e.suffix, "")) AS full_name,
            e.division_id,
            d.name AS division_name,
            e.designation_id,
            des.name AS designation_name,
            des.hierarchy_level,
            des.salary_grade,
            e.basic_salary,
            e.salary_rate,
            e.date_hired,
            e.employment_status,
            e.status,
            e.profile_image
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.is_archived = 0
           AND LOWER(e.status) = "active"
           AND ' . promotion_regular_employment_sql('e') . $employeeScopeSql . '
         ORDER BY e.last_name, e.first_name'
    );
    $employeeStatement->execute($employeeScopeParams);
    $employees = $employeeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $openStatement = $pdo->query(
        'SELECT employee_record_id, id, status
         FROM promotions
         WHERE is_archived = 0
           AND status IN ("pending", "recommended")'
    );
    $openByEmployee = [];

    foreach ($openStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $open) {
        $openByEmployee[(int)$open['employee_record_id']] = [
            'id' => (int)$open['id'],
            'status' => promotion_status_label((string)$open['status']),
        ];
    }

    json_response([
        'success' => true,
        'designations' => array_map(static fn (array $row): array => [
            'id' => (int)$row['id'],
            'name' => promotion_text($row['name']),
            'divisionId' => (int)$row['division_id'],
            'division' => promotion_text($row['division_name']),
            'level' => (int)$row['hierarchy_level'],
            'salaryGrade' => promotion_text($row['salary_grade'] ?? ''),
        ], $designations),
        'employees' => array_map(static fn (array $row): array => [
            'employeeRecordId' => (int)$row['id'],
            'employeeId' => promotion_text($row['employee_id']),
            'employeeName' => promotion_text($row['full_name']),
            'divisionId' => isset($row['division_id']) ? (int)$row['division_id'] : null,
            'division' => promotion_text($row['division_name'] ?? ''),
            'designationId' => isset($row['designation_id']) ? (int)$row['designation_id'] : null,
            'position' => promotion_text($row['designation_name'] ?? ''),
            'level' => isset($row['hierarchy_level']) ? (int)$row['hierarchy_level'] : 0,
            'salaryGrade' => promotion_text($row['salary_grade'] ?? ''),
            'basicSalary' => $row['basic_salary'],
            'salaryRate' => promotion_text($row['salary_rate'] ?? ''),
            'dateHired' => $row['date_hired'],
            'employmentStatus' => promotion_text($row['employment_status'] ?? ''),
            'profileImage' => promotion_text($row['profile_image'] ?? ''),
            'openPromotion' => $openByEmployee[(int)$row['id']] ?? null,
        ], $employees),
    ]);
}

function promotion_fetch_employee(PDO $pdo, int $employeeRecordId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id,
            CONCAT_WS(" ", NULLIF(e.first_name, ""), NULLIF(e.middle_name, ""), NULLIF(e.last_name, ""), NULLIF(e.suffix, "")) AS full_name,
            e.division_id,
            d.name AS division_name,
            e.designation_id,
            des.name AS designation_name,
            des.hierarchy_level,
            e.basic_salary,
            e.date_hired,
            e.employment_status,
            e.status,
            e.is_archived
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeRecordId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

function promotion_fetch_designation(PDO $pdo, int $designationId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            des.id,
            des.name,
            des.division_id,
            des.hierarchy_level,
            des.salary_grade,
            des.is_archived,
            d.name AS division_name,
            d.is_archived AS division_is_archived
         FROM designations des
         INNER JOIN divisions d ON d.id = des.division_id
         WHERE des.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $designationId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

function promotion_open_for_employee(PDO $pdo, int $employeeRecordId, int $excludeId = 0): ?array
{
    $statement = $pdo->prepare(
        'SELECT id, status
         FROM promotions
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
           AND status IN ("pending", "recommended")
           AND id <> :exclude_id
         LIMIT 1'
    );
    $statement->execute([
        ':employee_record_id' => $employeeRecordId,
        ':exclude_id' => $excludeId,
    ]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

function promotion_salary_grade_or_empty(mixed $value): string
{
    $digits = preg_replace('/[^0-9]/', '', strtolower(promotion_text($value))) ?? '';

    if ($digits === '') {
        return '';
    }

    $grade = (int)$digits;

    return $grade >= 1 && $grade <= 33 ? (string)$grade : '';
}

function promotion_step_or_empty(mixed $value): string
{
    $digits = preg_replace('/[^0-9]/', '', promotion_text($value)) ?? '';

    if ($digits === '') {
        return '';
    }

    $step = (int)$digits;

    return $step >= 1 && $step <= 8 ? (string)$step : '';
}

function create_promotion(PDO $pdo, array $body, array $user): void
{
    if (!promotion_can_prepare($user) && !promotion_can_nominate($user)) {
        json_response(['success' => false, 'message' => 'You do not have permission to prepare promotions.'], 403);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? 0);
    $toDesignationId = (int)($body['toDesignationId'] ?? 0);
    $toSalary = promotion_decimal_or_null($body['toSalary'] ?? null);
    $effectiveDate = promotion_date_or_null($body['effectiveDate'] ?? null);
    $justification = promotion_text($body['justification'] ?? '');
    $salaryGrade = promotion_salary_grade_or_empty($body['salaryGrade'] ?? '');
    $stepIncrement = promotion_step_or_empty($body['stepIncrement'] ?? '');

    if ($employeeRecordId <= 0) {
        json_response(['success' => false, 'message' => 'Select the employee to promote.'], 422);
    }

    if ($toDesignationId <= 0) {
        json_response(['success' => false, 'message' => 'Select the position the employee is promoted to.'], 422);
    }

    if ($effectiveDate === null) {
        json_response(['success' => false, 'message' => 'A valid effective date is required.'], 422);
    }

    if ($toSalary === null || (float)$toSalary <= 0) {
        json_response(['success' => false, 'message' => 'Enter the monthly salary for the new position.'], 422);
    }

    $employee = promotion_fetch_employee($pdo, $employeeRecordId);

    if ($employee === null || (int)($employee['is_archived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'Employee not found.'], 404);
    }

    if (strtolower(promotion_text($employee['status'] ?? '')) !== 'active') {
        json_response(['success' => false, 'message' => 'Only active employees can be promoted.'], 422);
    }

    if (!promotion_is_regular_employment_status($employee['employment_status'] ?? '')) {
        json_response(['success' => false, 'message' => 'Only Regular employees can be promoted. Contract of Service employees are not eligible.'], 422);
    }

    // A division-scoped preparer drafts only for their own division; the picker already confines
    // the list, so this only catches a request built by hand.
    $divisionScopeId = promotion_division_scope_id($pdo, $user);

    if ($divisionScopeId !== null && ($divisionScopeId <= 0 || (int)($employee['division_id'] ?? 0) !== $divisionScopeId)) {
        json_response(['success' => false, 'message' => 'You can only prepare promotions for employees in your division.'], 403);
    }

    // The desk drafting the promotion must not be its subject.
    $ownRecordId = session_employee_record_id($pdo, $user);

    if ($ownRecordId !== null && $ownRecordId === $employeeRecordId) {
        json_response(['success' => false, 'message' => 'You cannot prepare your own promotion.'], 403);
    }

    $designation = promotion_fetch_designation($pdo, $toDesignationId);

    if ($designation === null || (int)($designation['is_archived'] ?? 0) === 1 || (int)($designation['division_is_archived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'The selected position is not available.'], 422);
    }

    // Nor does a scoped desk promote anyone out of its division; the picker lists only its designations.
    if ($divisionScopeId !== null && (int)($designation['division_id'] ?? 0) !== $divisionScopeId) {
        json_response(['success' => false, 'message' => 'You can only promote to a position in your division.'], 403);
    }

    $currentDesignationId = (int)($employee['designation_id'] ?? 0);
    $currentLevel = (int)($employee['hierarchy_level'] ?? 0);
    $targetLevel = (int)($designation['hierarchy_level'] ?? 0);

    if ($currentDesignationId === $toDesignationId) {
        json_response(['success' => false, 'message' => 'The employee already holds this position.'], 422);
    }

    /*
     * The hierarchy rule. A move to the same or a lower level is a transfer or a demotion, and
     * neither belongs in a promotion record -- those stay with the employee form.
     */
    if ($targetLevel <= $currentLevel) {
        json_response([
            'success' => false,
            'message' => sprintf(
                '%s does not rank above the employee\'s current position. A promotion must move the employee to a higher position.',
                promotion_text($designation['name'])
            ),
        ], 422);
    }

    $currentSalary = promotion_decimal_or_null($employee['basic_salary'] ?? null);

    if ($currentSalary !== null && (float)$toSalary < (float)$currentSalary) {
        json_response([
            'success' => false,
            'message' => 'The new monthly salary cannot be lower than the current salary.',
        ], 422);
    }

    $dateHired = promotion_date_or_null($employee['date_hired'] ?? null);

    if ($dateHired !== null && $effectiveDate < $dateHired) {
        json_response([
            'success' => false,
            'message' => 'The effective date cannot be earlier than the date the employee was hired.',
        ], 422);
    }

    $open = promotion_open_for_employee($pdo, $employeeRecordId);

    if ($open !== null) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'This employee already has a %s promotion. Resolve it before preparing another.',
                strtolower(promotion_status_label((string)$open['status']))
            ),
        ], 409);
    }

    // A nomination is the recommending authority's own draft; it skips straight to the RD.
    $isHrHead = promotion_can_nominate($user);
    $status = $isHrHead ? 'recommended' : 'pending';
    $recommendedByEmployeeId = $isHrHead && $ownRecordId !== null ? $ownRecordId : null;
    $recommendedAt = $isHrHead ? date('Y-m-d H:i:s') : null;

    $statement = $pdo->prepare(
        'INSERT INTO promotions
            (employee_record_id, from_designation_id, from_designation_title, from_division_id,
             from_hierarchy_level, from_salary, to_designation_id, to_designation_title, to_division_id,
             to_hierarchy_level, to_salary, salary_grade, step_increment, effective_date, justification,
             status, requested_by_user_id, recommended_by_employee_id, recommended_at)
         VALUES
            (:employee_record_id, :from_designation_id, :from_designation_title, :from_division_id,
             :from_hierarchy_level, :from_salary, :to_designation_id, :to_designation_title, :to_division_id,
             :to_hierarchy_level, :to_salary, :salary_grade, :step_increment, :effective_date, :justification,
             :status, :requested_by_user_id, :recommended_by_employee_id, :recommended_at)'
    );
    $statement->execute([
        ':employee_record_id' => $employeeRecordId,
        ':from_designation_id' => $currentDesignationId > 0 ? $currentDesignationId : null,
        ':from_designation_title' => promotion_text($employee['designation_name'] ?? '') ?: null,
        ':from_division_id' => (int)($employee['division_id'] ?? 0) ?: null,
        ':from_hierarchy_level' => $currentDesignationId > 0 ? $currentLevel : null,
        ':from_salary' => $currentSalary,
        ':to_designation_id' => $toDesignationId,
        ':to_designation_title' => promotion_text($designation['name']),
        ':to_division_id' => (int)$designation['division_id'],
        ':to_hierarchy_level' => $targetLevel,
        ':to_salary' => $toSalary,
        ':salary_grade' => $salaryGrade !== '' ? $salaryGrade : (promotion_text($designation['salary_grade'] ?? '') ?: null),
        ':step_increment' => $stepIncrement !== '' ? $stepIncrement : null,
        ':effective_date' => $effectiveDate,
        ':justification' => $justification !== '' ? $justification : null,
        ':status' => $status,
        ':requested_by_user_id' => (int)($user['id'] ?? 0) ?: null,
        ':recommended_by_employee_id' => $recommendedByEmployeeId,
        ':recommended_at' => $recommendedAt,
    ]);
    $id = (int)$pdo->lastInsertId();

    try {
        $employeeName = promotion_text($employee['full_name']);
        $targetName = promotion_text($designation['name']);

        if ($status === 'pending') {
            // The HR Head reads every division's queue; the HR Staff of this division read theirs.
            $recommenderUserIds = array_merge(
                user_ids_for_role_keys($pdo, ['hrhead']),
                promotion_hr_staff_user_ids_for_division($pdo, (int)($employee['division_id'] ?? 0))
            );
            notify_users(
                $pdo,
                $recommenderUserIds,
                'Promotion For Recommendation',
                sprintf('A promotion of %s to %s is awaiting your recommendation.', $employeeName, $targetName),
                'promotion_submitted',
                (string)$id
            );
        } else {
            notify_roles(
                $pdo,
                ['regionaldirector'],
                'Promotion For Approval',
                sprintf('A promotion of %s to %s is awaiting your final approval.', $employeeName, $targetName),
                'promotion_recommended',
                (string)$id
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Promotion notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => $status === 'recommended'
            ? 'Promotion prepared and forwarded to the Regional Director for approval.'
            : 'Promotion prepared and forwarded to the HR Head for recommendation.',
        'promotion' => fetch_promotion($pdo, $id),
    ], 201);
}

/**
 * The approved promotion becomes the employee's appointment.
 *
 * Runs inside the caller's transaction. The masterfile takes the new designation, division and
 * salary; the service record closes the period in force and opens the new one on the effective
 * date, the same way employee_append_service_record() does for an edit -- except that here the
 * source says "promotion", so the CS Form No. 1 can tell a promotion from a correction.
 */
function promotion_apply(PDO $pdo, array $promotion, array $user): ?int
{
    $employeeRecordId = (int)$promotion['employee_record_id'];
    $effectiveDate = (string)$promotion['effective_date'];

    $update = $pdo->prepare(
        'UPDATE employees
         SET designation_id = :designation_id,
             division_id = :division_id,
             basic_salary = :basic_salary
         WHERE id = :id'
    );
    $update->execute([
        ':designation_id' => (int)$promotion['to_designation_id'],
        ':division_id' => (int)$promotion['to_division_id'],
        ':basic_salary' => $promotion['to_salary'],
        ':id' => $employeeRecordId,
    ]);

    if (!database_table_exists($pdo, 'service_records')) {
        return null;
    }

    $employee = promotion_fetch_employee($pdo, $employeeRecordId);
    $employmentStatus = promotion_text($employee['employment_status'] ?? '') ?: promotion_text($employee['status'] ?? '') ?: 'Regular';
    $station = promotion_text($promotion['to_division_name'] ?? '') ?: promotion_text($employee['division_name'] ?? '');

    $closesOn = (new DateTimeImmutable($effectiveDate))->modify('-1 day')->format('Y-m-d');
    $close = $pdo->prepare(
        'UPDATE service_records
         SET service_to = :closes_on
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
           AND service_to IS NULL
           AND service_from < :effective_date'
    );
    $close->execute([
        ':closes_on' => $closesOn,
        ':employee_record_id' => $employeeRecordId,
        ':effective_date' => $effectiveDate,
    ]);

    $remarks = sprintf(
        'Promoted from %s to %s.',
        promotion_text($promotion['from_designation_title'] ?? '') ?: 'previous position',
        promotion_text($promotion['to_designation_title'] ?? '')
    );

    $insert = $pdo->prepare(
        'INSERT INTO service_records
            (employee_record_id, service_from, designation_title, employment_status, monthly_salary,
             salary_grade, step_increment, station, designation_id, division_id, source, remarks, created_by)
         VALUES
            (:employee_record_id, :service_from, :designation_title, :employment_status, :monthly_salary,
             :salary_grade, :step_increment, :station, :designation_id, :division_id, "promotion", :remarks, :created_by)'
    );
    $insert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':service_from' => $effectiveDate,
        ':designation_title' => promotion_text($promotion['to_designation_title']),
        ':employment_status' => $employmentStatus,
        ':monthly_salary' => $promotion['to_salary'],
        ':salary_grade' => promotion_text($promotion['salary_grade'] ?? '') ?: null,
        ':step_increment' => promotion_text($promotion['step_increment'] ?? '') ?: null,
        ':station' => $station !== '' ? $station : 'Mines and Geosciences Bureau',
        ':designation_id' => (int)$promotion['to_designation_id'],
        ':division_id' => (int)$promotion['to_division_id'],
        ':remarks' => $remarks,
        ':created_by' => (int)($user['id'] ?? 0) ?: null,
    ]);

    return (int)$pdo->lastInsertId();
}

function update_promotion_status(PDO $pdo, array $body, array $user): void
{
    $id = (int)($body['id'] ?? 0);
    $action = strtolower(promotion_text($body['action'] ?? ''));
    $note = promotion_text($body['rejectedNote'] ?? ($body['note'] ?? ''));

    if ($id <= 0) {
        json_response(['success' => false, 'message' => 'Promotion is required.'], 422);
    }

    if (!in_array($action, ['recommend', 'approve', 'reject', 'cancel'], true)) {
        json_response(['success' => false, 'message' => 'Unknown promotion action.'], 422);
    }

    // A scoped desk cannot act on another division's promotion any more than it can read it.
    [$scopeSql, $scopeParams] = promotion_division_scope_sql(promotion_division_scope_id($pdo, $user));
    $statement = $pdo->prepare(promotion_base_select() . ' WHERE p.id = :id' . $scopeSql . ' LIMIT 1');
    $statement->execute([':id' => $id] + $scopeParams);
    $current = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$current) {
        json_response(['success' => false, 'message' => 'Promotion not found.'], 404);
    }

    if ((int)($current['is_archived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'Restore the promotion before acting on it.'], 422);
    }

    $currentStatus = strtolower(promotion_text($current['status']));
    $employeeRecordId = (int)$current['employee_record_id'];
    $ownRecordId = session_employee_record_id($pdo, $user);
    $roleKey = promotion_role_key($user);

    if ($ownRecordId !== null && $ownRecordId === $employeeRecordId) {
        json_response(['success' => false, 'message' => 'You cannot act on your own promotion.'], 403);
    }

    if (in_array($currentStatus, ['approved', 'rejected', 'cancelled'], true)) {
        json_response([
            'success' => false,
            'message' => sprintf('A %s promotion can no longer be updated.', $currentStatus),
        ], 422);
    }

    $nextStatus = $currentStatus;
    $recommendedBy = (int)($current['recommended_by_employee_id'] ?? 0) ?: null;
    $recommendedAt = null;
    $approvedBy = (int)($current['approved_by_employee_id'] ?? 0) ?: null;
    $approvedAt = null;
    $rejectedByRole = null;
    $serviceRecordId = null;

    switch ($action) {
        case 'recommend':
            if (!promotion_can_recommend($user)) {
                json_response(['success' => false, 'message' => 'Only the HR Head or the HR Staff of the division can recommend a promotion.'], 403);
            }

            if ($currentStatus !== 'pending') {
                json_response(['success' => false, 'message' => 'Only pending promotions can be recommended.'], 422);
            }

            require_approval_captcha($body, 'promotion', $id);
            $nextStatus = 'recommended';
            $recommendedBy = $ownRecordId;
            $recommendedAt = date('Y-m-d H:i:s');
            break;

        case 'approve':
            if (!promotion_can_approve($user)) {
                json_response(['success' => false, 'message' => 'Only the Regional Director can approve a promotion.'], 403);
            }

            if ($currentStatus !== 'recommended') {
                json_response([
                    'success' => false,
                    'message' => 'The Regional Director can only approve after HR has recommended the promotion.',
                ], 422);
            }

            // The target must still be a valid step up on the day it is signed.
            $employee = promotion_fetch_employee($pdo, $employeeRecordId);

            if ($employee === null || (int)($employee['is_archived'] ?? 0) === 1 || strtolower(promotion_text($employee['status'] ?? '')) !== 'active') {
                json_response(['success' => false, 'message' => 'The employee is no longer active, so the promotion cannot be approved.'], 422);
            }

            $designation = promotion_fetch_designation($pdo, (int)$current['to_designation_id']);

            if ($designation === null || (int)($designation['is_archived'] ?? 0) === 1 || (int)($designation['division_is_archived'] ?? 0) === 1) {
                json_response(['success' => false, 'message' => 'The target position has been archived. Reject this promotion and prepare a new one.'], 422);
            }

            if ((int)($designation['hierarchy_level'] ?? 0) <= (int)($employee['hierarchy_level'] ?? 0)) {
                json_response([
                    'success' => false,
                    'message' => 'The target position no longer ranks above the employee\'s current one. Reject this promotion and prepare a new one.',
                ], 422);
            }

            require_approval_captcha($body, 'promotion', $id);
            $nextStatus = 'approved';
            $approvedBy = $ownRecordId;
            $approvedAt = date('Y-m-d H:i:s');
            break;

        case 'reject':
            $mayReject = ($currentStatus === 'pending' && promotion_can_recommend($user))
                || ($currentStatus === 'recommended' && promotion_can_approve($user));

            if (!$mayReject) {
                json_response(['success' => false, 'message' => 'This promotion is not at your desk to reject.'], 403);
            }

            if ($note === '') {
                json_response(['success' => false, 'message' => 'A reason is required to reject a promotion.'], 422);
            }

            $nextStatus = 'rejected';
            $rejectedByRole = $roleKey;

            // The Director's slot records a refusal the same way it records an approval.
            if ($currentStatus === 'recommended') {
                $approvedBy = $ownRecordId;
                $approvedAt = date('Y-m-d H:i:s');
            }
            break;

        case 'cancel':
            if (!promotion_can_prepare($user)) {
                json_response(['success' => false, 'message' => 'Only HR can cancel a promotion.'], 403);
            }

            $nextStatus = 'cancelled';
            break;
    }

    $pdo->beginTransaction();

    try {
        if ($nextStatus === 'approved') {
            $serviceRecordId = promotion_apply($pdo, $current, $user);
        }

        $update = $pdo->prepare(
            'UPDATE promotions
             SET status = :status,
                 rejected_note = :rejected_note,
                 rejected_by_role = :rejected_by_role,
                 recommended_by_employee_id = :recommended_by_employee_id,
                 recommended_at = COALESCE(:recommended_at, recommended_at),
                 approved_by_employee_id = :approved_by_employee_id,
                 approved_at = COALESCE(:approved_at, approved_at),
                 service_record_id = COALESCE(:service_record_id, service_record_id)
             WHERE id = :id'
        );
        $update->execute([
            ':status' => $nextStatus,
            ':rejected_note' => $nextStatus === 'rejected' ? $note : null,
            ':rejected_by_role' => $rejectedByRole,
            ':recommended_by_employee_id' => $recommendedBy,
            ':recommended_at' => $recommendedAt,
            ':approved_by_employee_id' => $approvedBy,
            ':approved_at' => $approvedAt,
            ':service_record_id' => $serviceRecordId,
            ':id' => $id,
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $employeeName = promotion_text($current['employee_name'] ?? '');
        $targetName = promotion_text($current['to_designation_title'] ?? '');

        switch ($nextStatus) {
            case 'recommended':
                notify_roles(
                    $pdo,
                    ['regionaldirector'],
                    'Promotion For Approval',
                    sprintf('A promotion of %s to %s was recommended and is awaiting your final approval.', $employeeName, $targetName),
                    'promotion_recommended',
                    (string)$id
                );
                break;

            case 'approved':
                notify_employee(
                    $pdo,
                    $employeeRecordId,
                    'Promotion Approved',
                    sprintf(
                        'Congratulations! Your promotion to %s has been approved, effective %s.',
                        $targetName,
                        (new DateTimeImmutable((string)$current['effective_date']))->format('F j, Y')
                    ),
                    'promotion_approved',
                    (string)$id
                );
                promotion_notify_drafting_desks(
                    $pdo,
                    $current,
                    'Promotion Approved',
                    sprintf('The promotion of %s to %s was approved by the Regional Director.', $employeeName, $targetName),
                    'promotion_approved',
                    (string)$id
                );
                break;

            case 'rejected':
                promotion_notify_drafting_desks(
                    $pdo,
                    $current,
                    'Promotion Rejected',
                    sprintf('The promotion of %s to %s was rejected. %s', $employeeName, $targetName, $note),
                    'promotion_rejected',
                    (string)$id
                );
                break;
        }
    } catch (Throwable $notificationException) {
        error_log('Promotion notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => match ($nextStatus) {
            'recommended' => 'Promotion recommended and forwarded to the Regional Director for approval.',
            'approved' => 'Promotion approved. The employee record and service record have been updated.',
            'rejected' => 'Promotion rejected.',
            'cancelled' => 'Promotion cancelled.',
            default => 'Promotion updated.',
        },
        'promotion' => fetch_promotion($pdo, $id),
    ]);
}

function archive_promotion(PDO $pdo, array $body, array $user, bool $archived): void
{
    if (!promotion_can_archive($user)) {
        json_response(['success' => false, 'message' => 'You do not have permission to archive promotions.'], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $promotion = $id > 0 ? fetch_promotion($pdo, $id, promotion_division_scope_id($pdo, $user)) : null;

    if ($promotion === null) {
        json_response(['success' => false, 'message' => 'Promotion not found.'], 404);
    }

    // An open promotion is somebody's pending work; it is cancelled or resolved, never filed away.
    if ($archived && in_array($promotion['statusKey'], PROMOTION_OPEN_STATUSES, true)) {
        json_response(['success' => false, 'message' => 'Resolve or cancel the promotion before archiving it.'], 422);
    }

    $statement = $pdo->prepare('UPDATE promotions SET is_archived = :is_archived WHERE id = :id');
    $statement->execute([':is_archived' => $archived ? 1 : 0, ':id' => $id]);

    json_response([
        'success' => true,
        'message' => $archived ? 'Promotion archived.' : 'Promotion restored.',
        'promotion' => fetch_promotion($pdo, $id),
    ]);
}

try {
    ensure_promotions_table($pdo);

    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'GET') {
        $resource = promotion_text($_GET['resource'] ?? '');

        if ($resource === 'options') {
            get_promotion_options($pdo, $sessionUser);
        }

        if ($resource === 'greetings') {
            list_promotion_greetings($pdo, $sessionUser);
        }

        if (isset($_GET['id'])) {
            get_promotion($pdo, $sessionUser);
        }

        list_promotions($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_promotion($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $action = strtolower(promotion_text($body['action'] ?? ''));

        if ($action === 'archive' || $action === 'restore') {
            archive_promotion($pdo, $body, $sessionUser, $action === 'archive');
        }

        // Routed ahead of the status handler, which refuses anyone acting on their own promotion.
        if ($action === 'acknowledge') {
            acknowledge_promotion_greeting($pdo, $body, $sessionUser);
        }

        if ($action === 'mark_viewed') {
            mark_promotions_viewed($pdo, $sessionUser);
        }

        update_promotion_status($pdo, $body, $sessionUser);
    }

    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
} catch (Throwable $exception) {
    error_log('Promotion API error: ' . $exception->getMessage());
    json_response(['success' => false, 'message' => 'Unable to process the promotion request.'], 500);
}
