<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/password-reset-utils.php';
require_once __DIR__ . '/date-selection-utils.php';
require_once __DIR__ . '/captcha-utils.php';
require_once __DIR__ . '/compensatory-workflow-utils.php';

$sessionUser = require_session_user();

/*
 * Compensatory credits are earned and spent in hours, but the time off is taken in days, so the
 * two are converted at the same eight-hour working day the payroll runs on (see
 * PAYROLL_WORKING_HOURS_PER_DAY in payroll.php). A whole day costs 8 credits and an AM or PM half
 * costs 4 -- which is also why a filing can never fall under the 4-hour minimum.
 *
 * Mirrors CTO_HOURS_PER_DAY in frontend/src/module/compensatory/CompensatoryWorkspace.jsx.
 */
const COMPENSATORY_HOURS_PER_DAY = 8.0;

function compensatory_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function compensatory_date_or_null(mixed $value): ?string
{
    $text = compensatory_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);
    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function ensure_compensatory_rejected_note_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'rejected_note'");
    if ($statement === false || $statement->fetch() === false) {
        $pdo->exec('ALTER TABLE compensatory ADD COLUMN rejected_note TEXT NULL AFTER remarks');
    }

    $roleStatement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'rejected_by_role'");
    if ($roleStatement === false || $roleStatement->fetch() === false) {
        $pdo->exec('ALTER TABLE compensatory ADD COLUMN rejected_by_role VARCHAR(80) NULL AFTER rejected_note');
    }
}

function compensatory_number_or_null(mixed $value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }

    if (!is_numeric($value)) {
        return null;
    }

    return (float)$value;
}

function compensatory_role_key(array $user): string
{
    return user_role_key($user);
}

function compensatory_can_manage(array $user): bool
{
    return in_array(compensatory_role_key($user), ['admin', 'regionaldirector', 'chief'], true);
}

function compensatory_can_view_all(array $user): bool
{
    return !compensatory_is_self_service_role($user);
}

/** The roles that only ever see their own filings. */
function compensatory_is_self_service_role(array $user): bool
{
    return in_array(compensatory_role_key($user), ['employee', 'cashier', 'hrhead', 'hrstaff', 'planningofficer'], true);
}

/*
 * Archiving is tidying, not deciding, so the applicant may do it too -- but only once the request
 * is settled, so a filing still moving through the desks cannot be hidden from them. Mirrors the
 * `cto` entry of ARCHIVE_MANAGER_ROLES in frontend/src/utils/archiveActions.js, which only decides
 * whether the button is drawn; this is what refuses the request.
 */
function compensatory_can_archive(array $user): bool
{
    return compensatory_can_manage($user) || compensatory_is_self_service_role($user);
}

function compensatory_hours_text(float $hours): string
{
    return number_format($hours, 2, '.', '') . ' hours';
}

/*
 * A compensatory overtime credit is only good for the calendar year it was earned in. Whatever is
 * left when the year closes is forfeited and the new year opens at zero, so every figure below is
 * scoped to a single credit year rather than run as one lifetime total.
 *
 * The year is taken from the date the overtime was rendered for a credit, and from the date the time
 * off starts for a filing — the year that is spending the credits is the year that has to hold them.
 */
function compensatory_credit_year(mixed $value = null): int
{
    $date = compensatory_date_or_null($value);

    return (int)($date !== null ? substr($date, 0, 4) : date('Y'));
}

function compensatory_credit_expiry_date(int $creditYear): string
{
    return sprintf('%04d-12-31', $creditYear);
}

/**
 * Whole days left in a credit year, today counted as one of them, and 0 once the year has closed.
 * The last day is worth a day: on 31 December the credits can still be filed against.
 */
function compensatory_credit_days_remaining(int $creditYear): int
{
    $today = new DateTimeImmutable(date('Y-m-d'));
    $expiry = new DateTimeImmutable(compensatory_credit_expiry_date($creditYear));
    $days = (int)$today->diff($expiry)->format('%r%a');

    return $days < 0 ? 0 : $days + 1;
}

/**
 * Every approved overtime row standing to the employee's name, archived filings excluded — the
 * rendered overtime the Regional Director signed off plus the credits HR added by hand. Pass a year
 * to count only that year's credits; pass null for the lifetime total.
 */
function compensatory_earned_credits(PDO $pdo, int $employeeId, ?int $creditYear = null): float
{
    if ($employeeId <= 0 || !database_table_exists($pdo, 'overtime')) {
        return 0.0;
    }

    $archiveFilter = database_column_exists($pdo, 'overtime', 'is_archived')
        ? ' AND is_archived = 0'
        : '';
    $yearFilter = $creditYear === null ? '' : ' AND YEAR(work_date) = :credit_year';

    $statement = $pdo->prepare(
        'SELECT COALESCE(SUM(hour_requested), 0)
         FROM overtime
         WHERE employee_id = :employee_id
           AND LOWER(status) = "approved"' . $archiveFilter . $yearFilter
    );

    $parameters = [':employee_id' => $employeeId];
    if ($creditYear !== null) {
        $parameters[':credit_year'] = $creditYear;
    }

    $statement->execute($parameters);

    return (float)$statement->fetchColumn();
}

/*
 * The part of a filing the credits actually paid for. Hours filed past the balance are taken as
 * leave without pay, and unpaid hours spend no credits, so only the covered portion is ever drawn
 * down — otherwise one over-filing would eat the credits every later filing was counting on.
 */
const COMPENSATORY_PAID_HOURS_SQL = 'GREATEST(hours_applied - COALESCE(unpaid_hours, 0), 0)';

/**
 * The hours already spoken for. A filing still moving through the Chief, HR Head, and Regional
 * Director chain has not been decided yet, but it is holding its hours — otherwise the same four
 * credits could be filed against all afternoon. Rejected and cancelled filings give theirs back.
 */
function compensatory_used_credits(PDO $pdo, int $employeeId, ?int $creditYear = null): float
{
    if ($employeeId <= 0) {
        return 0.0;
    }

    $yearFilter = $creditYear === null ? '' : ' AND YEAR(start_date) = :credit_year';

    $statement = $pdo->prepare(
        'SELECT COALESCE(SUM(' . COMPENSATORY_PAID_HOURS_SQL . '), 0)
         FROM compensatory
         WHERE employee_id = :employee_id
           AND LOWER(status) IN ("pending", "endorsed", "reviewed", "approved")
           AND is_archived = 0' . $yearFilter
    );

    $parameters = [':employee_id' => $employeeId];
    if ($creditYear !== null) {
        $parameters[':credit_year'] = $creditYear;
    }

    $statement->execute($parameters);

    return (float)$statement->fetchColumn();
}

/*
 * The part of a balance that can actually be charged to a filing. Time off is only ever taken in
 * whole days or halves, so the credits behind it are only spendable in the same steps: 10 hours
 * standing pay for one whole day and no more, because there is no portion of a day the leftover 2
 * hours buys. Those 2 stay on the balance for a later filing rather than being cut out of the
 * middle of a half day the record has no way to describe.
 *
 * Mirrors leave_credit_floor_half_day() in leave-credit-utils.php, which floors leave the same way,
 * and ctoPayableCredits() in frontend/src/module/compensatory/CompensatoryWorkspace.jsx.
 */
function compensatory_floor_half_day(float $hours): float
{
    if ($hours <= 0) {
        return 0.0;
    }

    $halfDay = COMPENSATORY_HOURS_PER_DAY / 2;

    return round(floor(round($hours, 2) / $halfDay) * $halfDay, 2);
}

/**
 * The compensatory overtime credits an employee still has to spend in a credit year, with the date
 * the rest of them lapse. Defaults to the year in progress, which is the only one that can be filed
 * against: on 1 January the earned total resets to whatever the new year has credited so far.
 */
function compensatory_credit_balance(PDO $pdo, int $employeeId, ?int $creditYear = null): array
{
    $year = $creditYear ?? compensatory_credit_year();
    $earned = compensatory_earned_credits($pdo, $employeeId, $year);
    $used = compensatory_used_credits($pdo, $employeeId, $year);
    $daysRemaining = compensatory_credit_days_remaining($year);

    return [
        'year' => $year,
        'earned' => round($earned, 2),
        'used' => round($used, 2),
        'available' => round(max(0.0, $earned - $used), 2),
        'expiresOn' => compensatory_credit_expiry_date($year),
        'daysRemaining' => $daysRemaining,
        'expired' => $daysRemaining === 0,
    ];
}

/**
 * What was lost when a credit year closed: the hours credited that year that nobody filed against
 * before 31 December.
 *
 * Derived from the same two tables the live balance reads rather than posted to a ledger of its own.
 * Nothing has to run at midnight on New Year's Eve for the history to be right, an employee who was
 * never credited anything has no history to show, and a late correction to an old overtime row is
 * reflected the moment it is made.
 */
function compensatory_credit_forfeitures(PDO $pdo, int $employeeId, int $limit = 5): array
{
    if ($employeeId <= 0 || !database_table_exists($pdo, 'overtime')) {
        return [];
    }

    $archiveFilter = database_column_exists($pdo, 'overtime', 'is_archived')
        ? ' AND is_archived = 0'
        : '';

    $earnedStatement = $pdo->prepare(
        'SELECT YEAR(work_date) AS credit_year, COALESCE(SUM(hour_requested), 0) AS hours
         FROM overtime
         WHERE employee_id = :employee_id
           AND LOWER(status) = "approved"' . $archiveFilter . '
         GROUP BY credit_year'
    );
    $earnedStatement->execute([':employee_id' => $employeeId]);

    $usedStatement = $pdo->prepare(
        'SELECT YEAR(start_date) AS credit_year, COALESCE(SUM(' . COMPENSATORY_PAID_HOURS_SQL . '), 0) AS hours
         FROM compensatory
         WHERE employee_id = :employee_id
           AND LOWER(status) IN ("pending", "endorsed", "reviewed", "approved")
           AND is_archived = 0
         GROUP BY credit_year'
    );
    $usedStatement->execute([':employee_id' => $employeeId]);

    $usedByYear = [];
    foreach ($usedStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $usedByYear[(int)$row['credit_year']] = (float)$row['hours'];
    }

    $currentYear = compensatory_credit_year();
    $forfeitures = [];

    foreach ($earnedStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $year = (int)$row['credit_year'];

        /* The year in progress has not lapsed yet, and future-dated credits are not lost either. */
        if ($year >= $currentYear) {
            continue;
        }

        $earned = (float)$row['hours'];
        $used = $usedByYear[$year] ?? 0.0;
        $forfeited = round(max(0.0, $earned - $used), 2);

        if ($forfeited <= 0) {
            continue;
        }

        $forfeitures[] = [
            'year' => $year,
            'earned' => round($earned, 2),
            'used' => round($used, 2),
            'forfeited' => $forfeited,
            'expiredOn' => compensatory_credit_expiry_date($year),
        ];
    }

    usort($forfeitures, static fn (array $left, array $right) => $right['year'] <=> $left['year']);

    return array_slice($forfeitures, 0, max(1, $limit));
}

function show_compensatory_credit_balance(PDO $pdo, array $sessionUser): void
{
    /* An employee only ever gets their own balance, whatever the query string asks for. */
    $employeeId = compensatory_can_view_all($sessionUser)
        ? (int)($_GET['employeeRecordId'] ?? $_GET['employee_record_id'] ?? 0)
        : resolve_compensatory_session_employee_id($pdo, $sessionUser);

    json_response([
        'success' => true,
        'employeeRecordId' => $employeeId,
        'balance' => compensatory_credit_balance($pdo, $employeeId),
        'forfeitures' => compensatory_credit_forfeitures($pdo, $employeeId),
    ]);
}

function compensatory_status_to_database(mixed $status): string
{
    return match (strtolower(compensatory_text($status))) {
        'endorsed' => 'Endorsed',
        'reviewed' => 'Reviewed',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'cancelled', 'canceled' => 'Cancelled',
        default => 'Pending',
    };
}

/** The roles whose signature the request is waiting on, or [] once it has been decided. */
function compensatory_stage_roles(string $currentStatus, string $approvalRoute): array
{
    return compensatory_workflow_stage_roles($currentStatus, $approvalRoute);
}

/** The role the waiting desk is named after, or null once the request has been decided. */
function compensatory_stage_role(string $currentStatus, string $approvalRoute): ?string
{
    return compensatory_stage_roles($currentStatus, $approvalRoute)[0] ?? null;
}

/** The status the waiting role's approval moves the request to, or null once it has been decided. */
function compensatory_stage_next_status(string $currentStatus, string $approvalRoute): ?string
{
    return compensatory_workflow_next_status($currentStatus, $approvalRoute);
}

/*
 * Whether this user is the desk the request is currently waiting on. Admin stands in at any open
 * stage so a filing is never stranded while an approver is away, but nobody else may sign out of
 * turn: the Chief cannot reach ahead for the Director's signature, and the Director cannot sign
 * before HR has certified the credits.
 */
function compensatory_can_act_on(array $user, string $currentStatus, string $approvalRoute): bool
{
    $stageRoles = compensatory_stage_roles($currentStatus, $approvalRoute);
    if ($stageRoles === []) {
        return false;
    }

    $roleKey = compensatory_role_key($user);
    $exactRoleKey = user_exact_role_key($user);

    if ($roleKey === 'admin') {
        return true;
    }

    /* Chief Admin is based on Chief, but a Chief Admin stage must require that exact role. */
    if (in_array('chiefadmin', $stageRoles, true)) {
        return $exactRoleKey === 'chiefadmin';
    }

    return in_array($roleKey, $stageRoles, true);
}

/** How a desk is named when a user is told the request is not on theirs yet. */
function compensatory_stage_role_label(?string $roleKey): string
{
    return match ($roleKey) {
        'chief' => 'Division Chief',
        'chiefadmin' => 'Chief Admin',
        'hrhead' => 'HR Head',
        'regionaldirector' => 'Regional Director',
        default => 'an authorized approver',
    };
}

function ensure_compensatory_reviewed_status(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'status'");
    $column = $statement !== false ? $statement->fetch() : false;
    $columnType = strtolower((string)($column['Type'] ?? $column['type'] ?? ''));

    /* 'Endorsed' is the newest of the statuses, so an enum holding it is already up to date. */
    if ($columnType !== '' && strpos($columnType, "'endorsed'") !== false) {
        return;
    }

    $pdo->exec(
        "ALTER TABLE compensatory
         MODIFY COLUMN status ENUM('Pending', 'Endorsed', 'Reviewed', 'Approved', 'Rejected', 'Cancelled')
         NOT NULL DEFAULT 'Pending'"
    );
}

/**
 * The route is stamped when the CTO is filed so a later employee transfer or division rename does
 * not move an in-flight request to a different approval chain. The backfill also catches FAD rows
 * created before its direct Chief Admin route was introduced.
 */
function ensure_compensatory_approval_route_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'approval_route'");
    if ($statement === false || $statement->fetch() === false) {
        $pdo->exec(
            "ALTER TABLE compensatory
             ADD COLUMN approval_route VARCHAR(50) NOT NULL DEFAULT 'standard' AFTER status"
        );
    }

    /* ORD keeps its existing direct route; FAD/FAM now uses that same two-approver route. */
    $pdo->exec(
        "UPDATE compensatory c
         INNER JOIN employees e ON e.id = c.employee_id
         INNER JOIN divisions d ON d.id = e.division_id
         SET c.approval_route = 'chief_admin_regional_director'
         WHERE c.approval_route = 'standard'
           AND (
                UPPER(TRIM(COALESCE(d.code, ''))) IN ('ORD', 'FAD', 'FAM')
                OR LOWER(TRIM(COALESCE(d.name, ''))) IN (
                    'office of the regional director',
                    'finance & administrative management',
                    'finance and administrative management',
                    'finance and administrative division'
                )
           )"
    );
}

/** Decide the immutable route for a newly filed request from the employee's current office. */
function compensatory_approval_route_for_employee(PDO $pdo, int $employeeId): string
{
    $statement = $pdo->prepare(
        'SELECT COALESCE(d.code, "") AS divisionCode, COALESCE(d.name, "") AS divisionName
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE e.id = :employee_id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':employee_id' => $employeeId]);
    $division = $statement->fetch();

    if (!$division) {
        return COMPENSATORY_APPROVAL_ROUTE_STANDARD;
    }

    return compensatory_approval_route_for_division(
        $division['divisionCode'] ?? '',
        $division['divisionName'] ?? ''
    );
}

/*
 * Time off filed past the credit balance is still taken, it is simply not paid for. The uncovered
 * hours are stored on the row rather than derived later: the balance moves as other filings are
 * approved, but what this filing went unpaid for was settled the day it was filed.
 */
function ensure_compensatory_unpaid_hours_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'unpaid_hours'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec(
        'ALTER TABLE compensatory
         ADD COLUMN unpaid_hours DECIMAL(8,2) NOT NULL DEFAULT 0.00 AFTER coc_balance_hours'
    );
}

/*
 * Three desks sign a filing on three different days, and the form prints the moment each of them
 * did. `updated_at` only remembers the last of the three, so every signature carries its own stamp.
 */
function ensure_compensatory_action_timestamp_columns(PDO $pdo): void
{
    foreach (['endorsed_at', 'reviewed_at', 'approved_at'] as $column) {
        $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE '" . $column . "'");
        if ($statement !== false && $statement->fetch() === false) {
            $pdo->exec('ALTER TABLE compensatory ADD COLUMN ' . $column . ' TIMESTAMP NULL DEFAULT NULL');
        }
    }
}

function ensure_compensatory_action_actor_columns(PDO $pdo): void
{
    $endorsedByStatement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'endorsed_by_employee_id'");
    if ($endorsedByStatement !== false && $endorsedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE compensatory
             ADD COLUMN endorsed_by_employee_id INT UNSIGNED NULL AFTER rejected_note'
        );
    }

    $reviewedByStatement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'reviewed_by_employee_id'");
    if ($reviewedByStatement !== false && $reviewedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE compensatory
             ADD COLUMN reviewed_by_employee_id INT UNSIGNED NULL AFTER rejected_note'
        );
    }

    $approvedByStatement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'approved_by_employee_id'");
    if ($approvedByStatement !== false && $approvedByStatement->fetch() === false) {
        $pdo->exec(
            'ALTER TABLE compensatory
             ADD COLUMN approved_by_employee_id INT UNSIGNED NULL AFTER reviewed_by_employee_id'
        );
    }
}

/**
 * The COC certification printed on the form reports the credits the employee held on the day the
 * request was filed, so that figure is stamped onto the row at filing time instead of being
 * recomputed on every read: a certification "as of" a date must not move when the balance later does.
 */
function ensure_compensatory_credit_snapshot_column(PDO $pdo): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM compensatory LIKE 'coc_balance_hours'");
    if ($statement !== false && $statement->fetch() !== false) {
        return;
    }

    $pdo->exec('ALTER TABLE compensatory ADD COLUMN coc_balance_hours DECIMAL(8,2) NULL AFTER hours_applied');
    backfill_compensatory_credit_snapshots($pdo);
}

/**
 * Requests filed before the snapshot column existed still have to print a figure, so each one is
 * given the balance it would have been stamped with: everything earned, less the filings that were
 * already alive when it was created. Runs once, right after the column is added.
 */
function backfill_compensatory_credit_snapshots(PDO $pdo): void
{
    $rows = $pdo->query(
        'SELECT id, employee_id, created_at
         FROM compensatory
         WHERE coc_balance_hours IS NULL
         ORDER BY employee_id ASC, created_at ASC, id ASC'
    );

    if ($rows === false) {
        return;
    }

    /* Native prepares are on, so the created_at comparison needs its own placeholder per use. */
    $priorStatement = $pdo->prepare(
        'SELECT COALESCE(SUM(' . COMPENSATORY_PAID_HOURS_SQL . '), 0)
         FROM compensatory
         WHERE employee_id = :employee_id
           AND LOWER(status) IN ("pending", "endorsed", "reviewed", "approved")
           AND is_archived = 0
           AND (created_at < :created_at OR (created_at = :tie_created_at AND id < :id))'
    );
    $updateStatement = $pdo->prepare('UPDATE compensatory SET coc_balance_hours = :balance WHERE id = :id');

    $earnedByEmployee = [];

    foreach ($rows as $row) {
        $employeeId = (int)($row['employee_id'] ?? 0);
        $recordId = (int)($row['id'] ?? 0);

        if (!array_key_exists($employeeId, $earnedByEmployee)) {
            $earnedByEmployee[$employeeId] = compensatory_earned_credits($pdo, $employeeId);
        }

        $priorStatement->execute([
            ':employee_id' => $employeeId,
            ':created_at' => $row['created_at'],
            ':tie_created_at' => $row['created_at'],
            ':id' => $recordId,
        ]);
        $priorlyUsed = (float)$priorStatement->fetchColumn();

        $updateStatement->execute([
            ':balance' => number_format(max(0.0, $earnedByEmployee[$employeeId] - $priorlyUsed), 2, '.', ''),
            ':id' => $recordId,
        ]);
    }
}

/** The signed-in user's employee record, or null for an account (an Admin, say) that has none. */
function compensatory_find_session_employee_id(PDO $pdo, array $user): ?int
{
    $employeeCode = compensatory_text($user['employee_id'] ?? '');
    $employeeName = compensatory_text($user['full_name'] ?? '');

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

    return null;
}

function resolve_compensatory_session_employee_id(PDO $pdo, array $user): int
{
    $id = compensatory_find_session_employee_id($pdo, $user);

    if ($id !== null) {
        return $id;
    }

    json_response([
        'success' => false,
        'message' => 'Signed-in employee record was not found.',
    ], 422);
}

function compensatory_session_division_id(PDO $pdo, array $user): int
{
    $employeeId = resolve_compensatory_session_employee_id($pdo, $user);
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
 * Applicants receive only their own filings. A Division Chief remains division-scoped,
 * while Chief Admin and the Regional Director are organization-wide CTO approval desks.
 */
function compensatory_read_scopes(PDO $pdo, array $sessionUser): array
{
    if (user_exact_role_key($sessionUser) === 'chiefadmin') {
        return ['employeeId' => null, 'divisionId' => null];
    }

    return match (compensatory_role_key($sessionUser)) {
        'employee', 'cashier', 'hrhead', 'hrstaff', 'planningofficer' => [
            'employeeId' => resolve_compensatory_session_employee_id($pdo, $sessionUser),
            'divisionId' => null,
        ],
        'regionaldirector' => [
            'employeeId' => null,
            'divisionId' => null,
        ],
        'chief' => [
            'employeeId' => null,
            'divisionId' => compensatory_session_division_id($pdo, $sessionUser),
        ],
        default => ['employeeId' => null, 'divisionId' => null],
    };
}

function resolve_compensatory_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!compensatory_can_view_all($sessionUser)) {
        return resolve_compensatory_session_employee_id($pdo, $sessionUser);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employeeId'] ?? 0);
    $employeeCode = compensatory_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = compensatory_text($body['employeeName'] ?? '');

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

function fetch_compensatory(
    PDO $pdo,
    int $id,
    ?int $employeeScopeId = null,
    ?int $divisionScopeId = null
): ?array
{
    $sql = 'SELECT
                c.id,
                c.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                e.first_name AS employeeFirstName,
                e.middle_name AS employeeMiddleName,
                e.last_name AS employeeLastName,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                des.name AS position,
                d.name AS division,
                ' . employee_role_name_subselect() . ' AS employeeRole,
                c.hours_applied AS hoursApplied,
                c.coc_balance_hours AS cocBalanceHours,
                COALESCE(c.unpaid_hours, 0) AS unpaidHours,
                c.start_date AS startDate,
                c.end_date AS endDate,
                c.status,
                c.approval_route AS approvalRoute,
                c.approved_by AS approvedBy,
                approver.username AS approvedByUsername,
                c.endorsed_by_employee_id AS endorsedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(endorsed_employee.first_name, " ", COALESCE(endorsed_employee.middle_name, ""), " ", endorsed_employee.last_name)), ""), "") AS endorsedByName,
                COALESCE(NULLIF(TRIM(endorsed_employee.designation), ""), endorsed_designation.name, "") AS endorsedByPosition,
                c.endorsed_at AS endorsedAt,
                c.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
                COALESCE(NULLIF(TRIM(reviewed_employee.designation), ""), reviewed_designation.name, "") AS reviewedByPosition,
                c.reviewed_at AS reviewedAt,
                c.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
                c.approved_at AS approvedAt,
                c.remarks,
                COALESCE(c.rejected_note, "") AS rejectedNote,
                COALESCE(c.rejected_by_role, "") AS rejectedByRole,
                DATE(c.created_at) AS dateFiled,
                c.created_at AS createdAt,
                c.updated_at AS updatedAt
            FROM compensatory c
            INNER JOIN employees e ON e.id = c.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN designations des ON des.id = e.designation_id
            LEFT JOIN users approver ON approver.id = c.approved_by
            LEFT JOIN employees endorsed_employee ON endorsed_employee.id = c.endorsed_by_employee_id
            LEFT JOIN designations endorsed_designation ON endorsed_designation.id = endorsed_employee.designation_id
            LEFT JOIN employees reviewed_employee ON reviewed_employee.id = c.reviewed_by_employee_id
            LEFT JOIN designations reviewed_designation ON reviewed_designation.id = reviewed_employee.designation_id
            LEFT JOIN employees approved_employee ON approved_employee.id = c.approved_by_employee_id
            WHERE c.id = :id';

    $params = [':id' => $id];
    if ($employeeScopeId !== null) {
        $sql .= ' AND c.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    if ($divisionScopeId !== null) {
        $sql .= ' AND e.division_id = :division_scope_id';
        $params[':division_scope_id'] = $divisionScopeId;
    }
    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $record['id'] = (int)$record['id'];
    $record['employeeRecordId'] = (int)$record['employeeRecordId'];
    $record['approvedBy'] = $record['approvedBy'] !== null ? (int)$record['approvedBy'] : null;
    $record['endorsedByEmployeeRecordId'] = $record['endorsedByEmployeeRecordId'] !== null
        ? (int)$record['endorsedByEmployeeRecordId']
        : null;
    $record['endorsedByName'] = compensatory_text($record['endorsedByName'] ?? '');
    $record['endorsedByPosition'] = compensatory_text($record['endorsedByPosition'] ?? '');
    $record['reviewedByEmployeeRecordId'] = $record['reviewedByEmployeeRecordId'] !== null
        ? (int)$record['reviewedByEmployeeRecordId']
        : null;
    $record['reviewedByName'] = compensatory_text($record['reviewedByName'] ?? '');
    $record['reviewedByPosition'] = compensatory_text($record['reviewedByPosition'] ?? '');
    $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
        ? (int)$record['approvedByEmployeeRecordId']
        : null;
    $record['approvedByName'] = compensatory_text($record['approvedByName'] ?? '');
    $record['position'] = compensatory_text($record['position'] ?? '');
    $record['status'] = compensatory_status_to_database($record['status'] ?? '');
    $record['approvalRoute'] = normalize_compensatory_approval_route($record['approvalRoute'] ?? '');
    $record['hoursApplied'] = (float)$record['hoursApplied'];
    $record['cocBalanceHours'] = $record['cocBalanceHours'] !== null ? (float)$record['cocBalanceHours'] : null;
    $record['unpaidHours'] = (float)($record['unpaidHours'] ?? 0);
    $record['isLeaveWithoutPay'] = $record['unpaidHours'] > 0.001;
    $record['rejectedNote'] = compensatory_text($record['rejectedNote'] ?? '');
    $record['rejectedByRole'] = compensatory_text($record['rejectedByRole'] ?? '');

    return $record;
}

function fetch_compensatory_notification_context(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            c.id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.email AS employeeEmail,
            d.name AS division,
            c.hours_applied AS hoursApplied,
            c.start_date AS startDate,
            c.end_date AS endDate,
            COALESCE(c.remarks, "") AS remarks,
            COALESCE(c.rejected_note, "") AS rejectedNote,
            COALESCE(c.rejected_by_role, "") AS rejectedByRole
         FROM compensatory c
         INNER JOIN employees e ON e.id = c.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE c.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $record['employeeName'] = compensatory_text($record['employeeName'] ?? '');
    $record['employeeEmail'] = compensatory_text($record['employeeEmail'] ?? '');
    $record['division'] = compensatory_text($record['division'] ?? '');
    $record['hoursApplied'] = rtrim(rtrim(number_format((float)($record['hoursApplied'] ?? 0), 2, '.', ''), '0'), '.');
    if ((string)$record['hoursApplied'] !== '') {
        $record['hoursApplied'] .= ' hours';
    }
    $record['startDate'] = compensatory_text($record['startDate'] ?? '');
    $record['endDate'] = compensatory_text($record['endDate'] ?? '');
    $record['remarks'] = compensatory_text($record['remarks'] ?? '');
    $record['rejectedNote'] = compensatory_text($record['rejectedNote'] ?? '');
    $record['rejectedByRole'] = compensatory_text($record['rejectedByRole'] ?? '');

    return $record;
}

function send_compensatory_rejection_notification(PDO $pdo, int $id): ?string
{
    $record = fetch_compensatory_notification_context($pdo, $id);

    if ($record === null) {
        return 'Compensatory request disapproved, but employee details could not be loaded for email notification.';
    }

    $employeeEmail = compensatory_text($record['employeeEmail'] ?? '');

    if ($employeeEmail === '' || filter_var($employeeEmail, FILTER_VALIDATE_EMAIL) === false) {
        return 'Compensatory request disapproved, but no valid employee email address is available.';
    }

    /*
     * The picked days ride in the remarks column, so the typed remarks are separated out here and
     * the exact dates are reported on their own line. Empty for a request filed as a plain range,
     * which the email then reports as a start and end.
     */
    $unpackedRemarks = unpack_selected_dates($record['remarks'] ?? '');

    try {
        send_compensatory_rejection_email(
            $employeeEmail,
            (string)$record['employeeName'],
            (string)$record['division'],
            (string)$record['hoursApplied'],
            (string)$record['startDate'],
            (string)$record['endDate'],
            $unpackedRemarks['note'],
            (string)$record['rejectedNote'],
            selected_dates_summary($unpackedRemarks['dates'])
        );
    } catch (Throwable $exception) {
        error_log('Compensatory rejection email error: ' . $exception->getMessage());
        return 'Compensatory request disapproved, but the disapproval email could not be sent.';
    }

    return null;
}

function list_compensatory(PDO $pdo, array $sessionUser): void
{
    $scopes = compensatory_read_scopes($pdo, $sessionUser);
    $employeeScopeId = $scopes['employeeId'];
    $divisionScopeId = $scopes['divisionId'];
    $roleKey = compensatory_role_key($sessionUser);
    $exactRoleKey = user_exact_role_key($sessionUser);

    $sql = 'SELECT
                c.id,
                c.employee_id AS employeeRecordId,
                e.employee_id AS employeeId,
                e.first_name AS employeeFirstName,
                e.middle_name AS employeeMiddleName,
                e.last_name AS employeeLastName,
                TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
                des.name AS position,
                d.name AS division,
                ' . employee_role_name_subselect() . ' AS employeeRole,
                c.hours_applied AS hoursApplied,
                c.coc_balance_hours AS cocBalanceHours,
                COALESCE(c.unpaid_hours, 0) AS unpaidHours,
                c.start_date AS startDate,
                c.end_date AS endDate,
                c.status,
                c.approval_route AS approvalRoute,
                c.approved_by AS approvedBy,
                approver.username AS approvedByUsername,
                c.endorsed_by_employee_id AS endorsedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(endorsed_employee.first_name, " ", COALESCE(endorsed_employee.middle_name, ""), " ", endorsed_employee.last_name)), ""), "") AS endorsedByName,
                COALESCE(NULLIF(TRIM(endorsed_employee.designation), ""), endorsed_designation.name, "") AS endorsedByPosition,
                c.endorsed_at AS endorsedAt,
                c.reviewed_by_employee_id AS reviewedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(reviewed_employee.first_name, " ", COALESCE(reviewed_employee.middle_name, ""), " ", reviewed_employee.last_name)), ""), "") AS reviewedByName,
                COALESCE(NULLIF(TRIM(reviewed_employee.designation), ""), reviewed_designation.name, "") AS reviewedByPosition,
                c.reviewed_at AS reviewedAt,
                c.approved_by_employee_id AS approvedByEmployeeRecordId,
                COALESCE(NULLIF(TRIM(CONCAT(approved_employee.first_name, " ", COALESCE(approved_employee.middle_name, ""), " ", approved_employee.last_name)), ""), "") AS approvedByName,
                c.approved_at AS approvedAt,
                c.remarks,
                COALESCE(c.rejected_note, "") AS rejectedNote,
                COALESCE(c.rejected_by_role, "") AS rejectedByRole,
                DATE(c.created_at) AS dateFiled,
                c.created_at AS createdAt,
                c.updated_at AS updatedAt
            FROM compensatory c
            INNER JOIN employees e ON e.id = c.employee_id
            LEFT JOIN divisions d ON d.id = e.division_id
            LEFT JOIN designations des ON des.id = e.designation_id
            LEFT JOIN users approver ON approver.id = c.approved_by
            LEFT JOIN employees endorsed_employee ON endorsed_employee.id = c.endorsed_by_employee_id
            LEFT JOIN designations endorsed_designation ON endorsed_designation.id = endorsed_employee.designation_id
            LEFT JOIN employees reviewed_employee ON reviewed_employee.id = c.reviewed_by_employee_id
            LEFT JOIN designations reviewed_designation ON reviewed_designation.id = reviewed_employee.designation_id
            LEFT JOIN employees approved_employee ON approved_employee.id = c.approved_by_employee_id
            WHERE c.is_archived = :is_archived';

    $params = [':is_archived' => archived_view_requested() ? 1 : 0];
    if ($employeeScopeId !== null) {
        $sql .= ' AND c.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }
    if ($divisionScopeId !== null) {
        $sql .= ' AND e.division_id = :division_scope_id';
        $params[':division_scope_id'] = $divisionScopeId;
    }

    /* Direct-route filings bypass the ordinary Division Chief desk. */
    if ($exactRoleKey !== 'chiefadmin' && $roleKey === 'chief') {
        $sql .= ' AND c.approval_route <> :chief_admin_route';
        $params[':chief_admin_route'] = COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN;
    }

    /*
     * Downstream desks must not see a request before the preceding signature sends it forward.
     * Terminal records remain visible only when they reached that desk, preserving its history
     * without leaking a Division-Chief-pending filing to Chief Admin or the Director.
     *
     * The desk's own filing is the exception: it is theirs to follow from the moment it is filed,
     * under "View My CTO", whichever desk it is currently sitting on.
     */
    if ($exactRoleKey === 'chiefadmin' || in_array($roleKey, ['hrhead', 'hrstaff', 'regionaldirector'], true)) {
        $ownEmployeeId = compensatory_find_session_employee_id($pdo, $sessionUser);
        $params[':own_employee_id'] = $ownEmployeeId ?? 0;
    }

    if ($exactRoleKey === 'chiefadmin') {
        $sql .= ' AND (
            c.employee_id = :own_employee_id
            OR c.approval_route = :direct_chief_admin_route
            OR (
                c.approval_route <> :non_direct_chief_admin_route
                AND (
                    c.status IN ("Endorsed", "Reviewed", "Approved")
                    OR (c.status = "Rejected" AND LOWER(COALESCE(c.rejected_by_role, "")) IN ("chiefadmin", "regionaldirector"))
                )
            )
        )';
        $params[':direct_chief_admin_route'] = COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN;
        $params[':non_direct_chief_admin_route'] = COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN;
    } elseif ($roleKey === 'hrhead' || $roleKey === 'hrstaff') {
        $sql .= ' AND c.employee_id = :own_employee_id';
    } elseif ($roleKey === 'regionaldirector') {
        $sql .= ' AND (
            c.employee_id = :own_employee_id
            OR c.status IN ("Reviewed", "Approved")
            OR (c.status = "Rejected" AND LOWER(COALESCE(c.rejected_by_role, "")) = "regionaldirector")
        )';
    }

    $sql .= ' ORDER BY c.created_at DESC, c.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $records = $statement->fetchAll();

    foreach ($records as &$record) {
        $record['id'] = (int)$record['id'];
        $record['employeeRecordId'] = (int)$record['employeeRecordId'];
        $record['approvedBy'] = $record['approvedBy'] !== null ? (int)$record['approvedBy'] : null;
        $record['endorsedByEmployeeRecordId'] = $record['endorsedByEmployeeRecordId'] !== null
            ? (int)$record['endorsedByEmployeeRecordId']
            : null;
        $record['endorsedByName'] = compensatory_text($record['endorsedByName'] ?? '');
        $record['endorsedByPosition'] = compensatory_text($record['endorsedByPosition'] ?? '');
        $record['reviewedByEmployeeRecordId'] = $record['reviewedByEmployeeRecordId'] !== null
            ? (int)$record['reviewedByEmployeeRecordId']
            : null;
        $record['reviewedByName'] = compensatory_text($record['reviewedByName'] ?? '');
        $record['reviewedByPosition'] = compensatory_text($record['reviewedByPosition'] ?? '');
        $record['approvedByEmployeeRecordId'] = $record['approvedByEmployeeRecordId'] !== null
            ? (int)$record['approvedByEmployeeRecordId']
            : null;
        $record['approvedByName'] = compensatory_text($record['approvedByName'] ?? '');
        $record['position'] = compensatory_text($record['position'] ?? '');
        $record['status'] = compensatory_status_to_database($record['status'] ?? '');
        $record['approvalRoute'] = normalize_compensatory_approval_route($record['approvalRoute'] ?? '');
        $record['hoursApplied'] = (float)$record['hoursApplied'];
        $record['cocBalanceHours'] = $record['cocBalanceHours'] !== null ? (float)$record['cocBalanceHours'] : null;
        $record['unpaidHours'] = (float)($record['unpaidHours'] ?? 0);
        $record['isLeaveWithoutPay'] = $record['unpaidHours'] > 0.001;
        $record['rejectedNote'] = compensatory_text($record['rejectedNote'] ?? '');
        $record['rejectedByRole'] = compensatory_text($record['rejectedByRole'] ?? '');
    }
    unset($record);

    json_response([
        'success' => true,
        'records' => $records,
    ]);
}

/** A Chief files compensatory requests only for employees in their own division (themselves included). */
function assert_compensatory_employee_in_chief_division(PDO $pdo, array $sessionUser, int $employeeId): void
{
    if (compensatory_role_key($sessionUser) !== 'chief') {
        return;
    }

    $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
    $statement->execute([':id' => $employeeId]);

    if ((int)$statement->fetchColumn() !== compensatory_session_division_id($pdo, $sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Chiefs may only file compensatory requests for employees in their own division.',
        ], 403);
    }
}

function create_compensatory(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_compensatory_employee_id($pdo, $body, $sessionUser);
    assert_compensatory_employee_in_chief_division($pdo, $sessionUser, $employeeId);
    $approvalRoute = compensatory_approval_route_for_employee($pdo, $employeeId);
    $hoursApplied = compensatory_number_or_null($body['hoursApplied'] ?? $body['hours_applied'] ?? null);
    $startDate = compensatory_date_or_null($body['startDate'] ?? $body['start_date'] ?? null);
    $endDate = compensatory_date_or_null($body['endDate'] ?? $body['end_date'] ?? null);
    $remarks = compensatory_text($body['remarks'] ?? '');
    $selectedDates = unpack_selected_dates($remarks)['dates'];

    $errors = [];
    if ($hoursApplied === null) {
        $errors[] = 'Number of hours applied for is required.';
    } elseif ($hoursApplied < 4) {
        $errors[] = 'Number of hours applied for must be at least 4 hours.';
    }
    if ($startDate === null) {
        $errors[] = 'Inclusive start date is required.';
    }
    if ($endDate === null) {
        $errors[] = 'Inclusive end date is required.';
    }
    /*
     * There is deliberately no past-date rule here any more.
     *
     * Compensatory time off is not applied for ahead of the days it covers the way leave is: the
     * employee takes the day off against credits they have already earned, and the filing catches up
     * afterwards. Refusing a date behind today made the ordinary case impossible to record, so the
     * rule went from the picker, the form and here together. The ordering and balance checks below
     * are what still constrain a filing.
     */
    if ($startDate !== null && $endDate !== null && $endDate < $startDate) {
        $errors[] = 'Inclusive end date must not be earlier than the start date.';
    }
    if ($selectedDates !== [] && $startDate !== null && $endDate !== null) {
        $selectedStartDate = (string)($selectedDates[0]['date'] ?? '');
        $selectedEndDate = (string)($selectedDates[count($selectedDates) - 1]['date'] ?? '');

        if ($startDate !== $selectedStartDate || $endDate !== $selectedEndDate) {
            $errors[] = 'The selected CTO leave dates do not match the submitted inclusive date range.';
        }
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    /*
     * Compensatory time off is spent against overtime already rendered and approved, but a filing
     * larger than the balance is not refused: the days are still taken, the uncovered hours are
     * simply not paid for. The balance is read here rather than trusted from the form because it can
     * be drawn down by another filing between the form loading and the submit landing.
     *
     * Read against the credit year the time off starts in, not today's: filing in December for a day
     * in January spends next year's credits, and this year's lapse on the 31st either way.
     */
    $balance = compensatory_credit_balance($pdo, $employeeId, compensatory_credit_year($startDate));

    /*
     * The days picked are what the filing actually spends, so the hours have to be the cost of
     * those days and not a figure that travelled beside them. Without this a filing could name
     * four hours and still carry a week of dates in its remarks, and the balance check below
     * would wave it through.
     */
    if ($selectedDates !== []) {
        $expectedHours = round(selected_dates_total($selectedDates) * COMPENSATORY_HOURS_PER_DAY, 2);

        if (abs((float)$hoursApplied - $expectedHours) > 0.001) {
            json_response([
                'success' => false,
                'message' => sprintf(
                    'The %d inclusive date(s) selected cost %s at %s hours a day, but %s were applied for.',
                    count($selectedDates),
                    compensatory_hours_text($expectedHours),
                    compensatory_hours_text((float)COMPENSATORY_HOURS_PER_DAY),
                    compensatory_hours_text((float)$hoursApplied)
                ),
            ], 422);
        }
    }

    /*
     * Whatever the credits cannot cover is taken as leave without pay. Only credits that come to a
     * whole day or a half are chargeable, so a balance is floored before it is spent -- a 12-hour
     * filing against 10 hours standing is paid 8 and takes 4 without pay, not 10 and 2, because
     * neither day on the filing is 2 hours long. A cent of slack, so 4.00 credits still cover a
     * 4.00-hour filing after the float round-trip rather than leaving a hundredth of an hour unpaid.
     */
    $payableCredits = compensatory_floor_half_day((float)$balance['available']);
    $unpaidHours = round((float)$hoursApplied - $payableCredits, 2);
    $unpaidHours = $unpaidHours > 0.001 ? $unpaidHours : 0.0;

    /*
     * The balance read a moment ago is also what the form certifies, so it is stored with the row.
     * It is the credits standing before this filing is counted, which is what "COC as of <date
     * filed>" means: the next filing certifies a figure this one has already been taken out of.
     */
    $statement = $pdo->prepare(
        'INSERT INTO compensatory
            (employee_id, hours_applied, coc_balance_hours, unpaid_hours, start_date, end_date, status, approval_route, remarks)
         VALUES
            (:employee_id, :hours_applied, :coc_balance_hours, :unpaid_hours, :start_date, :end_date, "Pending", :approval_route, :remarks)'
    );
    $statement->execute([
        ':employee_id' => $employeeId,
        ':hours_applied' => number_format((float)$hoursApplied, 2, '.', ''),
        ':coc_balance_hours' => number_format((float)$balance['available'], 2, '.', ''),
        ':unpaid_hours' => number_format($unpaidHours, 2, '.', ''),
        ':start_date' => $startDate,
        ':end_date' => $endDate,
        ':approval_route' => $approvalRoute,
        ':remarks' => $remarks !== '' ? $remarks : null,
    ]);

    $recordId = (int)$pdo->lastInsertId();
    $scopes = compensatory_read_scopes($pdo, $sessionUser);
    json_response([
        'success' => true,
        'record' => fetch_compensatory($pdo, $recordId, $scopes['employeeId'], $scopes['divisionId']),
    ], 201);
}

function update_compensatory(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? 0);
    $status = compensatory_status_to_database($body['status'] ?? '');
    $rejectedNote = compensatory_text($body['rejectedNote'] ?? $body['rejected_note'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Compensatory request is required.',
        ], 422);
    }

    if ($status === 'Rejected' && $rejectedNote === '') {
        json_response([
            'success' => false,
            'message' => 'Disapproval note is required.',
        ], 422);
    }

    $scopes = compensatory_read_scopes($pdo, $sessionUser);
    if (fetch_compensatory($pdo, $id, $scopes['employeeId'], $scopes['divisionId']) === null) {
        json_response([
            'success' => false,
            'message' => 'Compensatory request was not found.',
        ], 404);
    }

    $currentRecordStatement = $pdo->prepare(
        'SELECT employee_id, status, approval_route,
                endorsed_by_employee_id, endorsed_at,
                reviewed_by_employee_id, reviewed_at,
                approved_by_employee_id, approved_at
         FROM compensatory
         WHERE id = :id
         LIMIT 1'
    );
    $currentRecordStatement->execute([':id' => $id]);
    $currentRecord = $currentRecordStatement->fetch();

    if (!$currentRecord) {
        json_response([
            'success' => false,
            'message' => 'Compensatory request was not found.',
        ], 404);
    }

    $sessionEmployeeId = session_employee_record_id($pdo, $sessionUser);
    $currentStatus = compensatory_status_to_database($currentRecord['status'] ?? '');
    $approvalRoute = normalize_compensatory_approval_route($currentRecord['approval_route'] ?? '');
    $usesChiefAdminRoute = compensatory_uses_chief_admin_route($approvalRoute);
    $currentEndorsedByEmployeeId = (int)($currentRecord['endorsed_by_employee_id'] ?? 0);
    $currentReviewedByEmployeeId = (int)($currentRecord['reviewed_by_employee_id'] ?? 0);
    $currentApprovedByEmployeeId = (int)($currentRecord['approved_by_employee_id'] ?? 0);
    $currentEndorsedAt = $currentRecord['endorsed_at'] ?? null;
    $currentReviewedAt = $currentRecord['reviewed_at'] ?? null;
    $currentApprovedAt = $currentRecord['approved_at'] ?? null;
    $isOwnRecord = $sessionEmployeeId !== null && (int)($currentRecord['employee_id'] ?? 0) === $sessionEmployeeId;
    $isOwnCancellation = $isOwnRecord && $status === 'Cancelled';

    if (!compensatory_can_manage($sessionUser) && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to update compensatory time off requests.',
        ], 403);
    }

    if ($isOwnRecord && !$isOwnCancellation) {
        json_response([
            'success' => false,
            'message' => 'You cannot update your own compensatory time off request. Please ask another authorized user to review it.',
        ], 403);
    }

    if ($isOwnCancellation && $currentStatus !== 'Pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending compensatory time off requests can be cancelled.',
        ], 422);
    }

    /*
     * Every remaining decision belongs to an approver, and an approver may only act on the stage the
     * request is actually sitting at: Division Chief on standard Pending filings, Chief Admin on
     * direct Pending or standard Endorsed filings, and Regional Director on Reviewed filings.
     */
    if (!$isOwnCancellation && !compensatory_can_act_on($sessionUser, $currentStatus, $approvalRoute)) {
        $waitingRole = compensatory_stage_role($currentStatus, $approvalRoute);

        json_response([
            'success' => false,
            'message' => $waitingRole === null
                ? 'This compensatory time off request has already been ' . strtolower($currentStatus) . '.'
                : 'This compensatory time off request is waiting on ' . compensatory_stage_role_label($waitingRole) . '.',
        ], 403);
    }

    /*
     * One approval moves the request exactly one step, so the stage decides the next status rather
     * than the caller: a client that asks for the final Approved while the Chief has yet to sign gets
     * the Chief's endorsement, never the Director's signature.
     */
    if (in_array($status, ['Endorsed', 'Reviewed', 'Approved'], true)) {
        $status = compensatory_stage_next_status($currentStatus, $approvalRoute) ?? $status;

        if ($sessionEmployeeId === null || $sessionEmployeeId <= 0) {
            json_response([
                'success' => false,
                'message' => 'Your account is not linked to an employee record, so your name and signature cannot be placed on the CTO form.',
            ], 422);
        }
    }

    /*
     * Every signature on the CTO form -- Chief/Chief Admin endorsement, Chief Admin review, or
     * Director approval -- carries a solved captcha. Rejecting and cancelling do not; see the
     * approval_workflow entry in captcha-utils.php.
     *
     * Read after the stage resolution above rather than before it, so the gate follows the status
     * the request is actually going to move to and not the one the caller asked for.
     */
    if (in_array($status, ['Endorsed', 'Reviewed', 'Approved'], true)) {
        require_approval_captcha($body, 'compensatory', $id);
    }

    $signerEmployeeId = $sessionEmployeeId !== null && $sessionEmployeeId > 0 ? $sessionEmployeeId : null;
    $signedAt = date('Y-m-d H:i:s');
    $nextEndorsedByEmployeeId = $currentEndorsedByEmployeeId > 0 ? $currentEndorsedByEmployeeId : null;
    $nextReviewedByEmployeeId = $currentReviewedByEmployeeId > 0 ? $currentReviewedByEmployeeId : null;
    $nextApprovedByEmployeeId = $currentApprovedByEmployeeId > 0 ? $currentApprovedByEmployeeId : null;
    $nextEndorsedAt = $nextEndorsedByEmployeeId !== null ? $currentEndorsedAt : null;
    $nextReviewedAt = $nextReviewedByEmployeeId !== null ? $currentReviewedAt : null;
    $nextApprovedAt = $nextApprovedByEmployeeId !== null ? $currentApprovedAt : null;

    if ($status === 'Endorsed') {
        $nextEndorsedByEmployeeId = $signerEmployeeId;
        $nextEndorsedAt = $signedAt;
        $nextReviewedByEmployeeId = null;
        $nextReviewedAt = null;
        $nextApprovedByEmployeeId = null;
        $nextApprovedAt = null;
    }

    if ($status === 'Reviewed') {
        if ($usesChiefAdminRoute) {
            /* On a direct route, Chief Admin is the Head of Office and signs the recommending slot. */
            $nextEndorsedByEmployeeId = $signerEmployeeId;
            $nextEndorsedAt = $signedAt;
            $nextReviewedByEmployeeId = null;
            $nextReviewedAt = null;
        } else {
            $nextReviewedByEmployeeId = $signerEmployeeId;
            $nextReviewedAt = $signedAt;
        }
        $nextApprovedByEmployeeId = null;
        $nextApprovedAt = null;
    }

    if ($status === 'Approved') {
        $nextApprovedByEmployeeId = $signerEmployeeId;
        $nextApprovedAt = $signedAt;
    }

    /*
     * A rejection is signed as well, by whichever desk turned the request down -- but only when that
     * desk has an employee record to sign with, so the form never prints a time against no name.
     */
    if ($status === 'Rejected' && $signerEmployeeId !== null) {
        /* The route and stage pick the signature slot even when Chief Admin is the signer. */
        if ($currentStatus === 'Pending' || ($usesChiefAdminRoute && $currentStatus === 'Endorsed')) {
            $nextEndorsedByEmployeeId = $signerEmployeeId;
            $nextEndorsedAt = $signedAt;
        }

        if (!$usesChiefAdminRoute && $currentStatus === 'Endorsed') {
            $nextReviewedByEmployeeId = $signerEmployeeId;
            $nextReviewedAt = $signedAt;
        }
    }

    if (in_array($status, ['Rejected', 'Cancelled'], true)) {
        $nextApprovedByEmployeeId = null;
        $nextApprovedAt = null;
    }

    $statement = $pdo->prepare(
        'UPDATE compensatory
         SET status = :status,
             approved_by = :approved_by,
             rejected_note = :rejected_note,
             rejected_by_role = :rejected_by_role,
             endorsed_by_employee_id = :endorsed_by_employee_id,
             endorsed_at = :endorsed_at,
             reviewed_by_employee_id = :reviewed_by_employee_id,
             reviewed_at = :reviewed_at,
             approved_by_employee_id = :approved_by_employee_id,
             approved_at = :approved_at
         WHERE id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':approved_by' => $isOwnCancellation ? null : ((int)($sessionUser['id'] ?? 0) ?: null),
        ':rejected_note' => $status === 'Rejected' ? $rejectedNote : null,
        ':rejected_by_role' => $status === 'Rejected' ? user_exact_role_key($sessionUser) : null,
        ':endorsed_by_employee_id' => $nextEndorsedByEmployeeId,
        ':endorsed_at' => $nextEndorsedAt,
        ':reviewed_by_employee_id' => $nextReviewedByEmployeeId,
        ':reviewed_at' => $nextReviewedAt,
        ':approved_by_employee_id' => $nextApprovedByEmployeeId,
        ':approved_at' => $nextApprovedAt,
        ':id' => $id,
    ]);

    if ($statement->rowCount() === 0) {
        $exists = $pdo->prepare('SELECT COUNT(*) FROM compensatory WHERE id = :id');
        $exists->execute([':id' => $id]);
        if ((int)$exists->fetchColumn() === 0) {
            json_response([
                'success' => false,
                'message' => 'Compensatory request was not found.',
            ], 404);
        }
    }

    $notificationWarning = null;

    if ($status === 'Rejected') {
        $notificationWarning = send_compensatory_rejection_notification($pdo, $id);
    }

    json_response([
        'success' => true,
        'record' => fetch_compensatory($pdo, $id, $scopes['employeeId'], $scopes['divisionId']),
        'emailNotification' => $status === 'Rejected'
            ? ($notificationWarning === null ? 'sent' : 'warning')
            : 'not_applicable',
        'message' => match ($status) {
            'Rejected' => $notificationWarning ?? 'Compensatory request disapproved and the employee was notified by email.',
            'Endorsed' => 'Compensatory request approved by the Division Chief and forwarded to Chief Admin.',
            'Reviewed' => 'Compensatory request approved by Chief Admin and forwarded to Regional Director for final approval.',
            'Approved' => 'Compensatory request approved by Regional Director.',
            'Cancelled' => 'Compensatory request cancelled.',
            default => 'Compensatory request updated.',
        },
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function archive_compensatory(PDO $pdo, array $body, array $sessionUser, bool $archived): void
{
    if (!compensatory_can_archive($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive compensatory requests.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $scopes = compensatory_read_scopes($pdo, $sessionUser);
    $record = $id > 0 ? fetch_compensatory($pdo, $id, $scopes['employeeId'], $scopes['divisionId']) : null;

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Compensatory request not found.',
        ], 404);
    }

    if (
        $archived
        && compensatory_is_self_service_role($sessionUser)
        && !in_array(strtolower((string)($record['status'] ?? '')), ['approved', 'rejected', 'cancelled'], true)
    ) {
        json_response([
            'success' => false,
            'message' => 'Only approved, rejected, or cancelled compensatory requests can be archived.',
        ], 422);
    }

    set_record_archived($pdo, 'compensatory', 'id', $id, $archived, $sessionUser, 'Compensatory Request');

    json_response([
        'success' => true,
        'message' => $archived ? 'Compensatory request archived.' : 'Compensatory request restored.',
        'record' => fetch_compensatory($pdo, $id, $scopes['employeeId'], $scopes['divisionId']),
    ]);
}

try {
    ensure_compensatory_rejected_note_column($pdo);
    ensure_compensatory_reviewed_status($pdo);
    ensure_compensatory_approval_route_column($pdo);
    ensure_compensatory_action_actor_columns($pdo);
    ensure_compensatory_action_timestamp_columns($pdo);
    ensure_compensatory_unpaid_hours_column($pdo);
    ensure_archive_columns($pdo, 'compensatory');
    ensure_compensatory_credit_snapshot_column($pdo);

    if ($method === 'GET') {
        if (strtolower(compensatory_text($_GET['action'] ?? '')) === 'credit_balance') {
            show_compensatory_credit_balance($pdo, $sessionUser);
        }

        list_compensatory($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        create_compensatory($pdo, read_json_body(), $sessionUser);
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $action = strtolower(compensatory_text($body['action'] ?? ''));

        if ($action === 'archive' || $action === 'restore') {
            archive_compensatory($pdo, $body, $sessionUser, $action === 'archive');
        }

        update_compensatory($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Compensatory API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process compensatory request.',
    ], 500);
}
