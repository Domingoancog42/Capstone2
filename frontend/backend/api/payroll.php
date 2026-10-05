<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/captcha-utils.php';
require_once __DIR__ . '/workflow-otp-utils.php';
require_once __DIR__ . '/deduction-catalog.php';
require_once __DIR__ . '/payroll-signatories.php';
require_once __DIR__ . '/payroll-export.php';

$sessionUser = require_session_user();
$roleKey = user_role_key($sessionUser);
$exactRoleKey = user_exact_role_key($sessionUser);
$workflowRoleKey = payroll_workflow_role_key($sessionUser);

/*
 * A Division Chief has no payroll desk -- the second approval belongs to the Chief Admin -- so the
 * chief is refused here the way the Planning Officer is. Their own payslip comes from payslip.php.
 */
if (!in_array($workflowRoleKey, ['admin', 'hrhead', 'hrstaff', 'chiefadmin', 'regionaldirector', 'employee', 'cashier', 'finance'], true)) {
    json_response([
        'success' => false,
        'message' => 'You are not allowed to access payroll records.',
    ], 403);
}

if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

const PAYROLL_ALLOWED_PERIODS = ['1st Half', '2nd Half', 'Monthly'];

/*
 * What a payroll batch pays out. `Salary` is the ordinary payroll run and is the only type a
 * Contract of Service employee can be paid under -- the rest are benefits that only plantilla
 * (Regular) employees receive, so generating them for anyone else is rejected below.
 *
 * Kept in step with PAYROLL_TYPE_DEFINITIONS in module/payroll/PayrollManagementWorkspace.jsx, which
 * also carries the register column labels each type prints under.
 */
const PAYROLL_TYPE_SALARY = 'Salary';
const PAYROLL_TYPE_REGULAR_ONLY = [
    'Mid-Year Bonus',
    'Year-End Bonus',
    'Performance-Based Bonus (PBB)',
    'Honorarium',
    'Transportation Allowance (TA)',
];
const PAYROLL_ALLOWED_TYPES = [
    PAYROLL_TYPE_SALARY,
    'Mid-Year Bonus',
    'Year-End Bonus',
    'Performance-Based Bonus (PBB)',
    'Honorarium',
    'Transportation Allowance (TA)',
];

const PAYROLL_APPROVAL_ROLES = ['admin', 'hrhead', 'chiefadmin', 'regionaldirector'];
const PAYROLL_STAFF_ROLES = ['admin', 'hrhead', 'hrstaff', 'regionaldirector'];
/*
 * Approving is the chain's job; releasing the money is the payout desk's step. Two roles sit at
 * that desk: `cashier`, the built-in role that matches the "paidBy" signatory the register already
 * prints ("Administrative Officer III (Cashier)"), and `finance`, a custom role built on HR Head.
 * Both are matched on their *exact* key, which is why a custom role based on Cashier does not
 * inherit the right to move money -- see how $exactRoleKey is passed to the require_* calls below.
 */
const PAYROLL_PAYOUT_ROLES = ['admin', 'finance', 'cashier'];
/*
 * Every desk the register passes through may file a settled batch away and bring it back: HR
 * prepares it, the Chief Admin and the Regional Director sign it, and the payout desk releases it.
 * The Chief Admin and the payout desk are matched on their exact keys ('chiefadmin', 'cashier',
 * 'finance'), the way PAYROLL_PAYOUT_ROLES is, because $workflowRoleKey carries the exact key for
 * those desks. Exporting stays with HR: archiving is housekeeping on a register these desks already
 * handled, not a new way to take its contents out of the system.
 */
const PAYROLL_ARCHIVE_ROLES = ['admin', 'hrhead', 'hrstaff', 'chiefadmin', 'regionaldirector', 'cashier', 'finance'];
/*
 * The desks confined to their own division. In practice none is: a Division Chief is refused at the
 * top of this file, and the Chief Admin -- built on Chief -- resolves to 'chiefadmin' through
 * payroll_workflow_role_key() and approves for every division. Mirrors
 * DIVISION_SCOPED_PAYROLL_ROLE_KEYS in PayrollManagementWorkspace.jsx.
 */
const PAYROLL_DIVISION_SCOPED_ROLES = ['chief'];
const PAYROLL_EDITABLE_STATUSES = ['Draft', 'Rejected'];

/*
 * A submitted payroll climbs three desks before the money moves: HR Head, then the Chief Admin,
 * then the Regional Director who gives final approval. Each rung is its own status so a role only
 * ever sees -- and can only ever act on -- the batches actually sitting with it.
 *
 * `payroll.status` is a varchar(20), which is why these are abbreviated. The second rung keeps the
 * stored value "Pending Chief" from when the Division Chief held it, so older rows and their approval
 * history still read correctly; the frontend shows it as "Pending Chief Admin".
 */
const PAYROLL_HR_HEAD_STATUS = 'Pending Approval';
const PAYROLL_CHIEF_STATUS = 'Pending Chief';
const PAYROLL_DIRECTOR_STATUS = 'Pending Director';
const PAYROLL_PENDING_STATUSES = [PAYROLL_HR_HEAD_STATUS, PAYROLL_CHIEF_STATUS, PAYROLL_DIRECTOR_STATUS];

/* Where a batch goes when the desk it is sitting on approves it. */
const PAYROLL_APPROVAL_CHAIN = [
    PAYROLL_HR_HEAD_STATUS => PAYROLL_CHIEF_STATUS,
    PAYROLL_CHIEF_STATUS => PAYROLL_DIRECTOR_STATUS,
    PAYROLL_DIRECTOR_STATUS => 'Approved',
];

/* Which pending status each approver owns. Admin stands in for every desk. */
const PAYROLL_ROLE_APPROVAL_STAGES = [
    'hrhead' => [PAYROLL_HR_HEAD_STATUS],
    'chiefadmin' => [PAYROLL_CHIEF_STATUS],
    'regionaldirector' => [PAYROLL_DIRECTOR_STATUS],
    'admin' => PAYROLL_PENDING_STATUSES,
];

const PAYROLL_ACTIVE_STATUSES = [
    'Draft',
    PAYROLL_HR_HEAD_STATUS,
    PAYROLL_CHIEF_STATUS,
    PAYROLL_DIRECTOR_STATUS,
    'Approved',
    'Rejected',
    'Paid',
];
const PAYROLL_ALL_STATUSES = [
    'Draft',
    PAYROLL_HR_HEAD_STATUS,
    PAYROLL_CHIEF_STATUS,
    PAYROLL_DIRECTOR_STATUS,
    'Approved',
    'Rejected',
    'Paid',
    'Archived',
];
const PAYROLL_DEFAULT_PERA_AMOUNT = 2000.0;
/*
 * DBM Budget Circular No. 004-03: the daily wage rate of a government position is its authorised
 * monthly salary divided by 22 days, and the hourly rate is that over 8 hours. Late, undertime and
 * absence deductions all fall out of these two numbers.
 */
const PAYROLL_WORKING_DAYS_PER_MONTH = 22.0;
const PAYROLL_WORKING_HOURS_PER_DAY = 8.0;

/**
 * BIR Revised Withholding Tax Table, TRAIN Law (RA 10963) second phase, effective 1 January 2023
 * and unchanged for 2026. Each bracket charges `base_tax` plus `rate`% of the amount above
 * `excess_over`. Used only when the catalog has no bracket table of its own.
 */
const PAYROLL_WITHHOLDING_TAX_BRACKETS = [
    ['up_to' => 20833, 'base_tax' => 0, 'rate' => 0, 'excess_over' => 0],
    ['up_to' => 33332, 'base_tax' => 0, 'rate' => 15, 'excess_over' => 20833],
    ['up_to' => 66666, 'base_tax' => 1875, 'rate' => 20, 'excess_over' => 33333],
    ['up_to' => 166666, 'base_tax' => 8541.80, 'rate' => 25, 'excess_over' => 66667],
    ['up_to' => 666666, 'base_tax' => 33541.80, 'rate' => 30, 'excess_over' => 166667],
    ['up_to' => null, 'base_tax' => 183541.80, 'rate' => 35, 'excess_over' => 666667],
];
const PAYROLL_REGULAR_OVERTIME_MULTIPLIER = 1.25;

const PAYROLL_ALLOWANCE_FIELD_MAP = [
    'Overtime Pay' => 'overtimePay',
    'PERA' => 'pera',
    'Travel Allowance' => 'travelAllowance',
    'Salary Adjustment' => 'salaryAdjustment',
    'Other Allowances' => 'otherAllowances',
    'Bonus Amount' => 'bonusAmount',
];

const PAYROLL_DEDUCTION_FIELD_MAP = [
    'Late Deduction' => 'lateDeduction',
    'Absence Deduction' => 'absenceDeduction',
    'Undertime Deduction' => 'undertimeDeduction',
    'Withholding Tax' => 'withholdingTax',
    'SSS' => 'sss',
    'GSIS' => 'gsis',
    'HDMF' => 'hdmf',
    'Pag-IBIG' => 'hdmf',
    'PHIC' => 'phic',
    'PhilHealth' => 'phic',
    'Manual Cash Advance Adjustment' => 'manualCashAdvanceAdjustment',
    'Laptop Loan' => 'laptopLoan',
    'Other Deductions' => 'otherDeductions',
];

/*
 * The category names here decide which family table a deduction is looked up in, so they have to be
 * the family labels in DEDUCTION_FAMILIES. They previously read "Government Contributions" and
 * "Loan Deductions" — names no family matches — so every deduction saved through this map resolved
 * to `other` and a duplicate GSIS / HDMF / PHIC was created there instead of charging the real row.
 */
const PAYROLL_DEDUCTION_CATEGORY_MAP = [
    'Late Deduction' => 'Attendance Deductions',
    'Absence Deduction' => 'Attendance Deductions',
    'Undertime Deduction' => 'Attendance Deductions',
    'Withholding Tax' => 'Withholding Tax',
    'SSS' => 'Other Deductions',
    'GSIS' => 'GSIS',
    'HDMF' => 'Pag-IBIG',
    'Pag-IBIG' => 'Pag-IBIG',
    'PHIC' => 'PHIC',
    'PhilHealth' => 'PHIC',
    'Manual Cash Advance Adjustment' => 'Other Deductions',
    'Laptop Loan' => 'Other Deductions',
    'Other Deductions' => 'Other Deductions',
];

const PAYROLL_DEDUCTION_FIELD_ALIASES = [
    'withholdingtax' => 'withholdingTax',
    'tax' => 'withholdingTax',
    'sss' => 'sss',
    'gsis' => 'gsis',
    'gsispremium' => 'gsis',
    'hdmf' => 'hdmf',
    'pagibig' => 'hdmf',
    'pagibigfund' => 'hdmf',
    'pagibigpremium' => 'hdmf',
    'phic' => 'phic',
    'philhealth' => 'phic',
    'philhealthpremium' => 'phic',
    'manualcashadvanceadjustment' => 'manualCashAdvanceAdjustment',
    'cashadvance' => 'manualCashAdvanceAdjustment',
    'laptoploan' => 'laptopLoan',
    'otherdeductions' => 'otherDeductions',
];

function payroll_normalize_status(mixed $value): string
{
    $text = trim((string)($value ?? ''));
    $token = preg_replace('/[^a-z]/', '', strtolower($text)) ?? '';

    return match ($token) {
        'pending', 'pendingapproval', 'pendinghrhead', 'pendinghrheadapproval' => PAYROLL_HR_HEAD_STATUS,
        'pendingchief', 'pendingchiefapproval', 'pendingchiefadmin', 'pendingchiefadminapproval' => PAYROLL_CHIEF_STATUS,
        'pendingdirector', 'pendingregionaldirector', 'pendingfinalapproval' => PAYROLL_DIRECTOR_STATUS,
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'paid' => 'Paid',
        'archived' => 'Archived',
        'draft' => 'Draft',
        default => $text !== '' ? $text : 'Draft',
    };
}

/**
 * The full wording of a status, for messages. The stored values are abbreviated to fit
 * `payroll.status`, so "Pending Chief" has to read back as "Pending Chief Admin Approval".
 */
function payroll_status_label(string $status): string
{
    return match (payroll_normalize_status($status)) {
        PAYROLL_HR_HEAD_STATUS => 'Pending HR Head Approval',
        PAYROLL_CHIEF_STATUS => 'Pending Chief Admin Approval',
        PAYROLL_DIRECTOR_STATUS => 'Pending Regional Director Approval',
        default => payroll_normalize_status($status),
    };
}

/**
 * The desk `$user` works in the payroll chain: their base role, except for the two desks a role built
 * on another one owns outright. Finance is built on HR Head but works the payout desk, and Chief Admin
 * is built on Chief but gives the second approval, which a Division Chief does not. Mirrors
 * workflowRoleKey in PayrollManagementWorkspace.jsx.
 */
function payroll_workflow_role_key(array $user): string
{
    $exactRoleKey = user_exact_role_key($user);

    return in_array($exactRoleKey, ['finance', 'chiefadmin'], true) ? $exactRoleKey : user_role_key($user);
}

/**
 * The pending statuses `$roleKey` is allowed to act on. Empty for anyone outside the chain.
 */
function payroll_role_approval_stages(string $roleKey): array
{
    return PAYROLL_ROLE_APPROVAL_STAGES[$roleKey] ?? [];
}

/**
 * The status a batch moves to when its current desk approves it, or null when the status is not
 * one that is waiting on an approver.
 */
function payroll_next_approval_status(string $currentStatus): ?string
{
    return PAYROLL_APPROVAL_CHAIN[payroll_normalize_status($currentStatus)] ?? null;
}

/**
 * The approve transitions available to `$roleKey`, as a current-status => next-status map that
 * payroll_transition_status() resolves against whatever the record actually holds.
 */
function payroll_role_approval_map(string $roleKey): array
{
    $map = [];

    foreach (payroll_role_approval_stages($roleKey) as $status) {
        $next = payroll_next_approval_status($status);

        if ($next !== null) {
            $map[$status] = $next;
        }
    }

    return $map;
}

function payroll_is_staff_role(string $roleKey): bool
{
    return in_array($roleKey, PAYROLL_STAFF_ROLES, true);
}

function payroll_is_approval_role(string $roleKey): bool
{
    return in_array($roleKey, PAYROLL_APPROVAL_ROLES, true);
}

function payroll_editable_statuses_for_role(string $roleKey): array
{
    return match ($roleKey) {
        'hrstaff' => ['Draft', 'Rejected'],
        'hrhead' => [PAYROLL_HR_HEAD_STATUS],
        'admin' => ['Draft', 'Rejected', PAYROLL_HR_HEAD_STATUS],
        default => [],
    };
}

function payroll_require_staff_role(string $roleKey): void
{
    if (!payroll_is_staff_role($roleKey)) {
        json_response([
            'success' => false,
            'message' => 'Only administrators, HR Head, and HR Staff can manage payroll records.',
        ], 403);
    }
}

function payroll_require_approval_role(string $roleKey): void
{
    if (!payroll_is_approval_role($roleKey)) {
        json_response([
            'success' => false,
            'message' => 'Only administrators, HR Head, Chief Admin, and Regional Director can approve or return payroll records.',
        ], 403);
    }
}

function payroll_require_payout_role(string $roleKey): void
{
    if (!in_array($roleKey, PAYROLL_PAYOUT_ROLES, true)) {
        json_response([
            'success' => false,
            'message' => 'Only administrators, the Cashier, and Finance can mark payroll as paid.',
        ], 403);
    }
}

/**
 * The math check that stands in front of the one-way steps of the payroll workflow: submitting a
 * batch for approval, approving it, and marking it paid.
 *
 * These move money and cannot be taken back. An approval that reaches the end of the chain releases
 * a division's payroll and there is no un-approve; marking a batch paid is the Cashier declaring the
 * money out of the door, which publishes every payslip in it to the employees. So each asks for one
 * more piece of evidence that a person meant it -- a single-digit sum dealt by the server and
 * answered here. What it buys is not protection from a robot (the caller is already signed in and
 * already authorised); it is that a stray click on a row, a double-submitted form, or a request
 * replayed out of a developer console cannot carry a payroll forward on its own, because none of
 * them can answer a challenge that was dealt after they were written.
 *
 * Returning a batch for correction is deliberately NOT gated: it is the one transition here that can
 * be walked back, and putting a sum in front of the correction path would make the safe move the
 * slow one.
 *
 * Enforced here rather than in the browser for the reason captcha-utils.php opens with: the client
 * neither knows the answer nor gets to mark it. Every route into these actions goes through this
 * router, so the single-record buttons, the registry buttons and the bulk toolbar are all covered by
 * the one gate -- there is no path that reaches a gated transition without passing it.
 *
 * `captchaFailed` tells the browser to deal itself a fresh challenge and show the message against
 * the answer box; the payroll itself is untouched, so it must not be reported as an action failure.
 */
function payroll_require_workflow_captcha(array $body): void
{
    // The verifying and the refusing both live in captcha-utils.php, so this gate and the one the
    // approval flows use cannot drift apart on what a valid check is or on what a refused one says.
    captcha_require(CAPTCHA_PURPOSE_PAYROLL_WORKFLOW, $body);
}

/**
 * Step one of the two-step check on submitting, approving, and releasing payslips: spend a solved
 * sum to have a code emailed to the acting user.
 *
 * The sum above proves someone meant to do this. It cannot prove it is the person whose session
 * this is, because anything holding the session cookie can read the sum and type it. So these two
 * transitions -- the ones that carry a batch along the approval chain -- ask for something the
 * session does not carry, and workflow-otp-utils.php explains the shape of it.
 *
 * Two things have to happen in this order, and both are here rather than in the browser:
 *
 *   the role gate first    someone who may not approve is told that, and never gets to spend a
 *                          challenge or cause this server to send a mail.
 *   the captcha second     every code that goes out costs a freshly dealt sum, so the request
 *                          endpoint cannot be hammered into flooding a mailbox.
 *
 * The code itself is judged later, by payroll_require_workflow_otp() inside the transition. Nothing
 * this function returns is permission to do anything.
 */
function payroll_request_workflow_otp(
    PDO $pdo,
    array $body,
    array $sessionUser,
    string $workflowRoleKey,
    string $exactRoleKey
): void {
    $action = strtolower(payroll_text($body['otpAction'] ?? ''));

    if (!payroll_workflow_otp_action_valid($action)) {
        json_response([
            'success' => false,
            'message' => 'That payroll action does not use an authorization code.',
        ], 422);
    }

    if ($action === 'submit') {
        payroll_require_staff_role($workflowRoleKey);
    } elseif ($action === 'approve') {
        payroll_require_approval_role($workflowRoleKey);
    } else {
        payroll_require_payout_role($exactRoleKey);
    }

    // Disabling payroll email OTP never removes the math security check. The request still spends
    // the submitted challenge, then tells the client to proceed without opening the email-code step.
    if (!payroll_workflow_otp_enabled($pdo)) {
        payroll_require_workflow_captcha($body);
        payroll_workflow_otp_session_reopen();
        payroll_workflow_otp_forget();

        json_response([
            'success' => true,
            'otpRequired' => false,
            'message' => 'Payroll email OTP verification is disabled.',
        ]);
    }

    /*
     * A resend rides on the ticket it is refreshing instead of a second sum. Holding a live ticket
     * already proves one was solved -- there is no other way to have got one -- so the captcha is
     * charged once per flow rather than once per email, and the resend limits on the ticket are what
     * bound it from there. A request with no live ticket is a first send and pays the sum.
     */
    $isResend = payroll_workflow_otp_ticket_matches($action, captcha_body_text($body, 'otpTicket'));

    if (!$isResend) {
        payroll_require_workflow_captcha($body);
    }

    try {
        $payload = payroll_workflow_otp_issue($pdo, $sessionUser, $action, $isResend);
    } catch (PayrollWorkflowOtpRestartException $exception) {
        /*
         * The ticket is gone and there is nothing left to resend against, so the client is told to
         * go back to step one rather than sit on a code box that can never be filled.
         */
        json_response([
            'success' => false,
            'message' => $exception->getMessage(),
            'restart' => true,
        ], 422);
    } catch (Throwable $exception) {
        /*
         * A rate-limited resend, an account with no address on file, and an SMTP failure all land
         * here. Each is a reason the user has to act on rather than a bug, and each is phrased for
         * them in workflow-otp-utils.php, so the message travels rather than being flattened into a
         * generic failure. 422 rather than 500: nothing broke, the request simply cannot proceed.
         */
        json_response([
            'success' => false,
            'message' => $exception->getMessage(),
        ], 422);
    }

    json_response([
        'success' => true,
        'otpRequired' => true,
        'message' => 'An authorization code was sent to your registered email address.',
    ] + $payload);
}

function payroll_require_archive_role(string $roleKey): void
{
    if (!in_array($roleKey, PAYROLL_ARCHIVE_ROLES, true)) {
        json_response([
            'success' => false,
            'message' => 'Your role cannot archive or restore payroll records.',
        ], 403);
    }
}

function payroll_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function payroll_nullable_text(mixed $value): ?string
{
    $trimmed = payroll_text($value);
    return $trimmed === '' ? null : $trimmed;
}

/*
 * Records created before payroll types existed carry no type in their meta, so an empty value reads
 * as `Salary` -- what every one of them was. Matching is case-insensitive so a stored label that
 * differs only in casing still resolves to its canonical spelling rather than failing validation.
 */
function payroll_normalize_type(mixed $value): string
{
    $text = payroll_text($value);

    if ($text === '') {
        return PAYROLL_TYPE_SALARY;
    }

    foreach (PAYROLL_ALLOWED_TYPES as $type) {
        if (strcasecmp($type, $text) === 0) {
            return $type;
        }
    }

    return $text;
}

function payroll_type_allows_employment_type(string $payrollType, string $employmentType): bool
{
    if (!in_array($payrollType, PAYROLL_TYPE_REGULAR_ONLY, true)) {
        return true;
    }

    return strcasecmp(payroll_text($employmentType), 'Regular') === 0;
}

function payroll_decimal(mixed $value): float
{
    if ($value === null || $value === '') {
        return 0.0;
    }

    if (!is_numeric($value)) {
        return 0.0;
    }

    return round((float)$value, 2);
}

function payroll_decimal_string(float $value): string
{
    return number_format($value, 2, '.', '');
}

function payroll_database_table_exists(PDO $pdo, string $table): bool
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

function payroll_ensure_loan_tracking_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured || !payroll_database_table_exists($pdo, 'loan_records')) {
        return;
    }

    $columns = [
        'annual_interest_rate' => 'DECIMAL(7,4) NOT NULL DEFAULT 0.0000 AFTER repayment_terms',
        'interest_method' => 'VARCHAR(20) NOT NULL DEFAULT "flat" AFTER annual_interest_rate',
        'government_reference_number' => 'VARCHAR(180) NULL AFTER purpose',
        'disbursed_at' => 'DATE NULL AFTER date_filed',
    ];

    foreach ($columns as $column => $definition) {
        if (!database_column_exists($pdo, 'loan_records', $column)) {
            $pdo->exec("ALTER TABLE loan_records ADD COLUMN {$column} {$definition}");
        }
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS loan_payments (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            loan_record_id INT UNSIGNED NOT NULL,
            installment_number INT UNSIGNED NOT NULL,
            amount DECIMAL(12,2) NOT NULL,
            paid_at DATE NOT NULL,
            payment_reference VARCHAR(180) NULL,
            notes VARCHAR(500) NULL,
            source VARCHAR(30) NOT NULL DEFAULT "manual",
            payroll_id INT UNSIGNED NULL,
            recorded_by_user_id INT UNSIGNED NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_loan_payment_installment (loan_record_id, installment_number),
            UNIQUE KEY uq_loan_payment_payroll (loan_record_id, payroll_id),
            KEY idx_loan_payments_paid_at (paid_at),
            CONSTRAINT fk_payroll_loan_payments_loan FOREIGN KEY (loan_record_id) REFERENCES loan_records(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $ensured = true;
}

function payroll_loan_monthly_amount(float $principal, float $annualRate, int $months, string $method): float
{
    if ($principal <= 0 || $months <= 0) {
        return 0.0;
    }

    if ($method === 'diminishing' && $annualRate > 0) {
        $monthlyRate = ($annualRate / 100) / 12;
        $factor = pow(1 + $monthlyRate, $months);
        return round($principal * $monthlyRate * $factor / ($factor - 1), 2);
    }

    return round(($principal + ($principal * ($annualRate / 100) * ($months / 12))) / $months, 2);
}

function payroll_log_deduction_debug(string $message, array $context = []): void
{
    $encodedContext = $context !== []
        ? ' ' . json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        : '';

    error_log('[Payroll Deductions] ' . $message . $encodedContext);
}

function payroll_normalize_deduction_key(string $name): string
{
    return preg_replace('/[^a-z0-9]/', '', strtolower($name)) ?? '';
}

function payroll_deduction_field_for_name(string $name): ?string
{
    $key = payroll_normalize_deduction_key($name);
    return PAYROLL_DEDUCTION_FIELD_ALIASES[$key] ?? PAYROLL_DEDUCTION_FIELD_MAP[$name] ?? null;
}

function payroll_category_id_from_name(string $categoryName): int
{
    $normalized = payroll_normalize_deduction_key($categoryName);
    return (int)(sprintf('%u', crc32($normalized !== '' ? $normalized : 'otherdeductions')) % 2147483646) + 1;
}

/** Keeps the existing deduction-family catalog ready for payroll calculations. */
function payroll_ensure_deduction_definition_tables(PDO $pdo): void
{
    deduction_catalog_ensure_schema($pdo);
}

function payroll_ensure_deduction_engine_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    payroll_ensure_deduction_definition_tables($pdo);
    ensure_payroll_embedded_detail_columns($pdo);

    payroll_seed_deduction_engine_defaults($pdo);
    $ensured = true;
}

function payroll_seed_deduction_engine_defaults(PDO $pdo): void
{
    /*
     * The category decides which family table the row is looked up in, so these must name real
     * families. They previously read "Government Contributions" / "Loan Deductions", which match no
     * family and therefore all fell through to `other` — the seeder then created a second GSIS, HDMF,
     * PHIC, PhilHealth, Pag-IBIG and Withholding Tax there and configured those copies instead of
     * the rows payroll actually charges.
     */
    $defaults = [
        ['Withholding Tax', 'Withholding Tax', 'percentage', 0.00, 0.0000, 'taxable_income', 0, 1],
        ['Other Deductions', 'SSS', 'percentage', 0.00, 4.5000, 'basic_salary', 1, 0],
        ['GSIS', 'GSIS', 'percentage', 0.00, 9.0000, 'basic_salary', 1, 1],
        ['Pag-IBIG', 'HDMF', 'fixed', 200.00, 0.0000, 'basic_salary', 1, 1],
        ['Pag-IBIG', 'Pag-IBIG', 'fixed', 200.00, 0.0000, 'basic_salary', 1, 0],
        ['PHIC', 'PHIC', 'percentage', 0.00, 2.5000, 'basic_salary', 1, 1],
        ['PHIC', 'PhilHealth', 'percentage', 0.00, 2.5000, 'basic_salary', 1, 0],
        ['Attendance Deductions', 'Late Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Attendance Deductions', 'Absence Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Attendance Deductions', 'Undertime Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Other Deductions', 'Manual Cash Advance Adjustment', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
        ['Other Deductions', 'Laptop Loan', 'fixed', 0.00, 0.0000, 'basic_salary', 1, 1],
        ['Other Deductions', 'Other Deductions', 'fixed', 0.00, 0.0000, 'basic_salary', 1, 1],
        ['Other Deductions', 'Custom Deduction', 'fixed', 0.00, 0.0000, 'basic_salary', 0, 1],
    ];

    /*
     * Seeds only fill gaps. A rate an administrator has since changed in Settings must survive a
     * redeploy, so each CASE writes the default only where the column is still at its zero value —
     * these rows are now the same rows Settings edits, not a private copy.
     */
    // Prepared per family table, because the seed rows are spread across all six.
    $statements = [];
    $statementFor = static function (string $table) use ($pdo, &$statements): PDOStatement {
        return $statements[$table] ??= $pdo->prepare(
            "UPDATE `{$table}`
             SET default_amount = CASE
                     WHEN COALESCE(default_amount, 0.00) = 0.00 THEN :default_amount
                     ELSE default_amount
                 END,
                 calculation_type = CASE
                     WHEN calculation_type = \"fixed\" THEN :calculation_type
                     ELSE calculation_type
                 END,
                 default_rate = CASE
                     WHEN COALESCE(default_rate, 0.0000) = 0.0000 THEN :default_rate
                     ELSE default_rate
                 END,
                 basis = CASE
                     WHEN basis IS NULL OR basis = \"\" OR basis = \"basic_salary\" THEN :basis
                     ELSE basis
                 END,
                 is_recurring = :is_recurring,
                 is_active = :is_active
             WHERE id = :deduction_type_id"
        );
    };

    foreach ($defaults as [$categoryName, $deductionName, $calculationType, $amount, $rate, $basis, $isRecurring, $isActive]) {
        $deductionTypeId = payroll_resolve_deduction_type($pdo, $categoryName, $deductionName);
        $table = deduction_catalog_table_for_id($pdo, $deductionTypeId);

        if ($table === null) {
            continue;
        }

        $statementFor($table)->execute([
            ':default_amount' => payroll_decimal_string((float)$amount),
            ':calculation_type' => $calculationType,
            ':default_rate' => number_format((float)$rate, 4, '.', ''),
            ':basis' => $basis,
            ':is_recurring' => (int)$isRecurring,
            ':is_active' => (int)$isActive,
            ':deduction_type_id' => $deductionTypeId,
        ]);
    }
}

function payroll_monthly_hourly_rate(float $monthlySalary): float
{
    if ($monthlySalary <= 0) {
        return 0.0;
    }

    return $monthlySalary / PAYROLL_WORKING_DAYS_PER_MONTH / PAYROLL_WORKING_HOURS_PER_DAY;
}

/**
 * The per-day and per-hour money a salary is worth, for charging absence, tardiness and undertime.
 *
 * Read from `attendance_deductions` rather than recomputed here, so the rates an administrator can
 * see and edit in Settings are the rates payroll charges. Those rows carry a percentage of monthly
 * salary — 4.5455% a day, 0.5682% an hour — which is DBM Budget Circular 004-03's monthly / 22 / 8
 * expressed as a rate. Falls back to the constants when a row is missing or has no rate, so a
 * half-seeded database still charges the right amount.
 */
function payroll_attendance_rates(PDO $pdo, float $basicSalary): array
{
    static $rates = null;

    if ($basicSalary <= 0) {
        return ['daily' => 0.0, 'hourly' => 0.0];
    }

    if ($rates === null) {
        $rates = ['per_day' => null, 'per_hour' => null];

        foreach (deduction_catalog_types($pdo, ['categoryCode' => 'attendance']) as $type) {
            $basis = $type['basis'];

            if (array_key_exists($basis, $rates) && $rates[$basis] === null && $type['defaultRate'] > 0) {
                $rates[$basis] = $type['defaultRate'];
            }
        }
    }

    $daily = $rates['per_day'] !== null
        ? $basicSalary * ($rates['per_day'] / 100)
        : $basicSalary / PAYROLL_WORKING_DAYS_PER_MONTH;

    $hourly = $rates['per_hour'] !== null
        ? $basicSalary * ($rates['per_hour'] / 100)
        : payroll_monthly_hourly_rate($basicSalary);

    return ['daily' => $daily, 'hourly' => $hourly];
}

/**
 * BIR monthly withholding tax on compensation.
 *
 * The brackets come from the `Withholding Tax` row in the catalog, so the table an administrator
 * sees in Settings is the table payroll charges. PAYROLL_WITHHOLDING_TAX_BRACKETS below is the
 * fallback for a database that has not been seeded yet.
 *
 * These are the TRAIN Law (RA 10963) second-phase rates, in force since 1 January 2023. The
 * hard-coded table this replaced still held the 2018-2022 first-phase rates — 20/25/30/32% against
 * the correct 15/20/25/30%, with base amounts to match — so every employee above the exemption was
 * over-withheld. On a ₱43,000 taxable month that was ₱4,916.75 charged against ₱3,808.40 due.
 */
function payroll_calculate_withholding_tax(float $monthlyTaxableIncome, ?PDO $pdo = null): float
{
    if ($monthlyTaxableIncome <= 0) {
        return 0.0;
    }

    $rules = $pdo !== null ? payroll_withholding_tax_brackets($pdo) : null;

    return round(deduction_catalog_compute_tiered(
        [
            'thresholdRules' => $rules ?? PAYROLL_WITHHOLDING_TAX_BRACKETS,
            'defaultAmount' => 0,
        ],
        $monthlyTaxableIncome
    ), 2);
}

/** The catalog's bracket table, or null when it carries none. */
function payroll_withholding_tax_brackets(PDO $pdo): ?array
{
    static $cached = false;
    static $rules = null;

    if ($cached) {
        return $rules;
    }

    $cached = true;

    foreach (deduction_catalog_types($pdo, ['categoryCode' => 'tax']) as $type) {
        if ($type['name'] === 'Withholding Tax' && is_array($type['thresholdRules']) && $type['thresholdRules'] !== []) {
            $rules = $type['thresholdRules'];
            break;
        }
    }

    return $rules;
}

function payroll_approved_overtime_hours(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate): float
{
    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'overtime')
    ) {
        return 0.0;
    }

    $dateColumn = database_column_exists($pdo, 'overtime', 'work_date')
        ? 'work_date'
        : (database_column_exists($pdo, 'overtime', 'overtime_date') ? 'overtime_date' : '');
    if ($dateColumn === '') {
        return 0.0;
    }

    $hoursColumn = '';
    foreach (['hour_requested', 'overtime_hours', 'hours_worked', 'duration'] as $column) {
        if (database_column_exists($pdo, 'overtime', $column)) {
            $hoursColumn = $column;
            break;
        }
    }

    if ($hoursColumn === '') {
        return 0.0;
    }

    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM({$hoursColumn}), 0)
         FROM overtime
         WHERE employee_id = :employee_id
           AND LOWER(status) = 'approved'
           AND {$dateColumn} BETWEEN :start_date AND :end_date"
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return payroll_decimal($statement->fetchColumn());
}

/**
 * The SQL condition limiting a pass slip query to trips that actually happened.
 *
 * Filing a pass slip is a request now, and a request can be rejected, cancelled, or approved and
 * never used. None of those is time out of the office, so none of them belongs in payroll. What
 * marks a real trip is a scanned departure: `time_out_at` is written by the QR scan at the gate and
 * by nothing else, which makes it the one honest test of whether the person left.
 *
 * Returns an empty string on a database that predates the QR columns, where every row was a typed,
 * completed slip and the old "count them all" rule was already right.
 */
function payroll_pass_slip_used_condition(PDO $pdo): string
{
    return database_column_exists($pdo, 'pass_slip', 'time_out_at')
        ? ' AND time_out_at IS NOT NULL'
        : '';
}

/*
 * Hours an employee was out of the office on a pass slip, which stand in for undertime when there is
 * no attendance data for the period (see payroll_apply_automatic_calculations).
 *
 * This used to count only slips whose status was 'approved'. Pass slips went through a spell of
 * having no status at all, and then got a real one back with the QR workflow -- so the rule here is
 * neither "approved" nor "every row" but "actually scanned out", which is what the surrounding code
 * always meant by the number. To go back to pass slips not affecting payroll at all, return 0.0.
 */
function payroll_filed_pass_slip_hours(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate): float
{
    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'pass_slip')
        || !database_column_exists($pdo, 'pass_slip', 'pass_date')
        || !database_column_exists($pdo, 'pass_slip', 'departure_time')
        || !database_column_exists($pdo, 'pass_slip', 'time_returned')
    ) {
        return 0.0;
    }

    /*
     * `duration_minutes` is preferred where it exists because it is computed from the two DATETIME
     * stamps, so an absence that crosses midnight measures as the hour it was rather than as a
     * negative TIMEDIFF that GREATEST() then flattens to zero. A slip that is still out contributes
     * nothing either way: its return has not been scanned, so there is no duration yet to deduct.
     */
    $span = database_column_exists($pdo, 'pass_slip', 'duration_minutes')
        ? 'GREATEST(COALESCE(duration_minutes, 0), 0) * 60'
        : 'GREATEST(TIME_TO_SEC(TIMEDIFF(time_returned, departure_time)), 0)';

    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM({$span}) / 3600, 0)
         FROM pass_slip
         WHERE employee_id = :employee_id
           AND pass_date BETWEEN :start_date AND :end_date"
        . payroll_pass_slip_used_condition($pdo)
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return payroll_decimal($statement->fetchColumn());
}

/*
 * How many pass slips an employee used in the period. Shown on the payslip next to the attendance
 * figures; it does not feed any deduction. Same rule as the hours above: a slip counts once it has
 * been scanned out, not when it was filed.
 */
function payroll_filed_pass_slip_count(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate): int
{
    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'pass_slip')
        || !database_column_exists($pdo, 'pass_slip', 'pass_date')
    ) {
        return 0;
    }

    $statement = $pdo->prepare(
        "SELECT COUNT(*)
         FROM pass_slip
         WHERE employee_id = :employee_id
           AND pass_date BETWEEN :start_date AND :end_date"
        . payroll_pass_slip_used_condition($pdo)
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    return (int)$statement->fetchColumn();
}

function payroll_deduction_frequency_factor(string $frequency, string $payPeriod): float
{
    $frequency = strtolower(trim($frequency));

    return match ($frequency) {
        'monthly' => $payPeriod === 'Monthly' ? 1.0 : 0.5,
        'first_half', '1st_half', 'first half' => $payPeriod === '1st Half' ? 1.0 : 0.0,
        'second_half', '2nd_half', 'second half' => $payPeriod === '2nd Half' ? 1.0 : 0.0,
        'one_time', 'once', 'per_payroll', 'payroll' => 1.0,
        default => 1.0,
    };
}

function payroll_deduction_basis_amount(string $basis, float $basicSalary, float $grossPay, float $taxableIncome): float
{
    return match (strtolower(trim($basis))) {
        'gross', 'gross_pay' => $grossPay,
        'taxable', 'taxable_income' => $taxableIncome,
        default => $basicSalary,
    };
}

function payroll_calculated_deduction_amount(
    array $row,
    float $basicSalary,
    float $grossPay,
    float $taxableIncome,
    string $payPeriod
): float {
    $name = payroll_text($row['deductionName'] ?? $row['deduction_name'] ?? '');
    $calculationType = strtolower(payroll_text($row['calculationType'] ?? $row['calculation_type'] ?? 'fixed'));
    $basis = payroll_text($row['basis'] ?? 'basic_salary') ?: 'basic_salary';
    $frequency = payroll_text($row['frequency'] ?? 'monthly') ?: 'monthly';
    $factor = payroll_deduction_frequency_factor($frequency, $payPeriod);

    if ($factor <= 0) {
        return 0.0;
    }

    $base = payroll_deduction_basis_amount($basis, $basicSalary, $grossPay, $taxableIncome);

    /*
     * The salary a rate applies to is clamped before the rate is applied. This is what makes a
     * contribution like "2.5% of salary, but never on more than ₱100,000" express itself, and it was
     * missing: base_floor and base_cap were stored but never read, so PhilHealth charged 2.5% of the
     * full salary and a ₱123,123 earner was billed ₱3,078.08 against the ₱2,500 statutory maximum.
     */
    $floor = (float)($row['baseFloor'] ?? $row['base_floor'] ?? 0);
    $cap = $row['baseCap'] ?? $row['base_cap'] ?? null;

    if ($floor > 0) {
        $base = max($base, $floor);
    }

    if ($cap !== null && $cap !== '' && (float)$cap > 0) {
        $base = min($base, (float)$cap);
    }

    if ($calculationType === 'percentage') {
        $rate = $row['rate'] ?? $row['defaultRate'] ?? $row['default_rate'] ?? null;

        if ($rate === null || $rate === '' || !is_numeric($rate)) {
            payroll_log_deduction_debug('Percentage deduction skipped because rate is missing or invalid.', [
                'deduction' => $name,
                'rate' => $rate,
            ]);
            return 0.0;
        }

        return round(($base * ((float)$rate / 100)) * $factor, 2);
    }

    // Bracket tables (the withholding schedule, Pag-IBIG's 1%/2% split) charge per band.
    if ($calculationType === 'tiered' || $calculationType === 'bracket') {
        $rules = $row['thresholdRules'] ?? $row['threshold_rules'] ?? null;

        if (is_string($rules)) {
            $rules = json_decode($rules, true);
        }

        if (is_array($rules) && $rules !== []) {
            return round(deduction_catalog_compute_tiered([
                'thresholdRules' => $rules,
                'defaultAmount' => $row['amount'] ?? $row['defaultAmount'] ?? $row['default_amount'] ?? 0,
            ], $base) * $factor, 2);
        }
    }

    $amount = $row['amount'] ?? $row['defaultAmount'] ?? $row['default_amount'] ?? null;
    if ($amount === null || $amount === '' || !is_numeric($amount)) {
        payroll_log_deduction_debug('Fixed deduction skipped because amount is missing or invalid.', [
            'deduction' => $name,
            'amount' => $amount,
        ]);
        return 0.0;
    }

    return round(((float)$amount) * $factor, 2);
}

function payroll_fetch_global_recurring_deduction_rows(PDO $pdo, array $excludedKeys = []): array
{
    $statement = $pdo->query(
        'SELECT
            dt.deduction_type_id AS deductionTypeId,
            dt.deduction_name AS deductionName,
            dt.category_name AS categoryName,
            dt.default_amount AS amount,
            dt.default_rate AS rate,
            dt.calculation_type AS calculationType,
            dt.basis AS basis,
            dt.base_floor AS baseFloor,
            dt.base_cap AS baseCap,
            dt.threshold_rules AS thresholdRules,
            "monthly" AS frequency,
            "global" AS source
         FROM ' . deduction_catalog_type_union_sql() . ' dt
         WHERE COALESCE(dt.is_active, 1) = 1
           AND COALESCE(dt.is_recurring, 0) = 1
         ORDER BY dt.deduction_type_id ASC'
    );

    $rows = [];
    foreach ($statement->fetchAll() as $row) {
        $key = payroll_normalize_deduction_key((string)($row['deductionName'] ?? ''));
        if (isset($excludedKeys[$key])) {
            continue;
        }
        $rows[] = $row;
    }

    return $rows;
}

function payroll_extract_repayment_months(string $repaymentTerms): ?int
{
    if (preg_match('/(\d+)\s*(month|months|mos|mo|installment|installments)/i', $repaymentTerms, $matches) === 1) {
        return max(1, (int)$matches[1]);
    }

    if (preg_match('/(\d+)/', $repaymentTerms, $matches) === 1) {
        return max(1, (int)$matches[1]);
    }

    return null;
}

/**
 * Approved loans are only amortised for regular employees.
 *
 * `employees.employment_status` carries the label the employee form writes — "Regular" or
 * "Contractual" — so the comparison is on that text, normalised for case and spacing rather than
 * matched exactly, because older rows were typed in by hand.
 */
function payroll_is_regular_employment_status(mixed $value): bool
{
    return payroll_normalize_deduction_key((string)($value ?? '')) === 'regular';
}

function payroll_fetch_approved_loan_deduction_items(
    PDO $pdo,
    int $employeeRecordId,
    ?string $endDate,
    string $payPeriod,
    mixed $employmentStatus = null
): array {
    payroll_ensure_loan_tracking_schema($pdo);

    if (
        $employeeRecordId <= 0
        || $endDate === null
        || !payroll_database_table_exists($pdo, 'loan_records')
    ) {
        return [];
    }

    if (!payroll_is_regular_employment_status($employmentStatus)) {
        payroll_log_deduction_debug('Approved loans skipped because the employee is not regular.', [
            'employeeRecordId' => $employeeRecordId,
            'employmentStatus' => payroll_text($employmentStatus),
        ]);

        return [];
    }

    $statement = $pdo->prepare(
        'SELECT
            lr.id,
            lr.loan_type AS loanType,
            lr.loan_amount AS loanAmount,
            lr.repayment_terms AS repaymentTerms,
            lr.annual_interest_rate AS annualInterestRate,
            lr.interest_method AS interestMethod,
            lr.date_filed AS dateFiled,
            lr.disbursed_at AS disbursedAt,
            COALESCE(payment_summary.paidAmount, 0) AS paidAmount
         FROM loan_records lr
         LEFT JOIN (
             SELECT loan_record_id, SUM(amount) AS paidAmount
             FROM loan_payments
             GROUP BY loan_record_id
         ) payment_summary ON payment_summary.loan_record_id = lr.id
         WHERE lr.employee_id = :employee_id
           AND lr.status = "Approved"
           AND lr.is_archived = 0
           AND lr.disbursed_at IS NOT NULL
           AND lr.disbursed_at <= :end_date
         ORDER BY lr.disbursed_at ASC, lr.id ASC'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':end_date' => $endDate,
    ]);

    $items = [];
    foreach ($statement->fetchAll() as $loan) {
        $months = payroll_extract_repayment_months((string)($loan['repaymentTerms'] ?? ''));
        if ($months === null) {
            payroll_log_deduction_debug('Approved loan skipped because repayment terms do not contain a month count.', [
                'loanRequestId' => (int)($loan['id'] ?? 0),
                'employeeRecordId' => $employeeRecordId,
                'repaymentTerms' => $loan['repaymentTerms'] ?? null,
            ]);
            continue;
        }

        $principal = payroll_decimal($loan['loanAmount'] ?? 0);
        $annualRate = payroll_decimal($loan['annualInterestRate'] ?? 0);
        $interestMethod = strtolower(payroll_text($loan['interestMethod'] ?? 'flat')) === 'diminishing'
            ? 'diminishing'
            : 'flat';
        $monthlyAmount = payroll_loan_monthly_amount($principal, $annualRate, $months, $interestMethod);
        $totalPayable = round($monthlyAmount * $months, 2);
        $paidAmount = payroll_decimal($loan['paidAmount'] ?? 0);
        $outstanding = max(0.0, $totalPayable - $paidAmount);
        $amount = min(
            $outstanding,
            round($monthlyAmount * payroll_deduction_frequency_factor('monthly', $payPeriod), 2)
        );
        if ($amount <= 0) {
            continue;
        }

        $loanType = payroll_text($loan['loanType'] ?? 'Loan Deduction') ?: 'Loan Deduction';

        $items[] = [
            'name' => $loanType,
            /*
             * Charged under the family that already lists the product (GSIS "Policy Loan", Pag-IBIG
             * "Housing Loan"); only a product no family carries falls back to Other Deductions.
             * Hard-coding Other here made payroll_sync_deductions() create a second row for every
             * loan there, which is what Deduction Setup showed as duplicates.
             */
            'category' => deduction_catalog_category_for_name($pdo, $loanType) ?? 'Other Deductions',
            'amount' => $amount,
            'source' => 'approved_loan',
            'referenceId' => (int)($loan['id'] ?? 0),
            'monthlyAmount' => $monthlyAmount,
            'paidAmountBeforePayroll' => $paidAmount,
        ];
    }

    return $items;
}

function payroll_apply_resolved_deduction_items(array $payload, array $items): array
{
    $fieldTotals = [];
    $additionalItems = [];

    foreach ($items as $item) {
        $name = payroll_text($item['name'] ?? $item['deductionName'] ?? '');
        $amount = payroll_decimal($item['amount'] ?? 0);

        if ($name === '' || $amount <= 0) {
            continue;
        }

        $field = payroll_deduction_field_for_name($name);
        if ($field !== null && $field !== 'withholdingTax') {
            $fieldTotals[$field] = ($fieldTotals[$field] ?? 0.0) + $amount;
            continue;
        }

        if ($field === 'withholdingTax') {
            payroll_log_deduction_debug('Configured withholding tax deduction ignored because payroll tax is calculated separately.', [
                'deduction' => $name,
                'amount' => $amount,
            ]);
            continue;
        }

        $additionalItems[] = [
            'name' => $name,
            'category' => payroll_text($item['category'] ?? $item['categoryName'] ?? '') ?: 'Other Deductions',
            'amount' => $amount,
            'source' => payroll_text($item['source'] ?? ''),
            'referenceId' => (int)($item['referenceId'] ?? 0),
            'monthlyAmount' => payroll_decimal($item['monthlyAmount'] ?? 0),
            'paidAmountBeforePayroll' => payroll_decimal($item['paidAmountBeforePayroll'] ?? 0),
        ];
    }

    foreach ($fieldTotals as $field => $amount) {
        if ($amount > 0) {
            $payload[$field] = payroll_decimal($amount);
        }
    }

    $payload['additionalDeductionItems'] = $additionalItems;
    $payload['additionalDeductionsTotal'] = round(array_reduce(
        $additionalItems,
        static fn (float $sum, array $item): float => $sum + payroll_decimal($item['amount'] ?? 0),
        0.0
    ), 2);

    return $payload;
}

function payroll_manual_deduction_items_from_body(array $body): ?array
{
    if (!is_array($body['deductionItems'] ?? null)) {
        return null;
    }

    $items = [];

    foreach ($body['deductionItems'] as $item) {
        if (!is_array($item)) {
            continue;
        }

        $name = payroll_text($item['name'] ?? $item['deductionName'] ?? '');
        if ($name === '') {
            continue;
        }

        $items[] = [
            'name' => $name,
            'category' => payroll_text($item['category'] ?? $item['categoryName'] ?? '') ?: 'Deductions',
            'amount' => payroll_decimal($item['amount'] ?? 0),
        ];
    }

    return $items;
}

function payroll_apply_manual_deduction_items(array $payload, array $items): array
{
    $manualFields = [];
    $additionalItems = [];

    foreach ($items as $item) {
        $name = payroll_text($item['name'] ?? '');
        if ($name === '') {
            continue;
        }

        $amount = payroll_decimal($item['amount'] ?? 0);
        $field = payroll_deduction_field_for_name($name);

        if ($field !== null) {
            $manualFields[$field] = ($manualFields[$field] ?? 0.0) + $amount;
            continue;
        }

        if ($amount > 0) {
            $additionalItems[] = [
                'name' => $name,
                'category' => payroll_text($item['category'] ?? '') ?: 'Other Deductions',
                'amount' => $amount,
            ];
        }
    }

    foreach ($manualFields as $field => $amount) {
        $payload[$field] = payroll_decimal($amount);
    }

    $payload['additionalDeductionItems'] = $additionalItems;
    $payload['additionalDeductionsTotal'] = round(array_reduce(
        $additionalItems,
        static fn (float $sum, array $item): float => $sum + payroll_decimal($item['amount'] ?? 0),
        0.0
    ), 2);

    return $payload;
}

function payroll_apply_recurring_deductions(PDO $pdo, array $payload, array $employee, float $basicSalary): array
{
    payroll_ensure_deduction_engine_schema($pdo);

    $employeeRecordId = (int)($employee['id'] ?? $payload['employeeRecordId'] ?? 0);
    $grossPreview = round(
        $basicSalary
        + $payload['overtimePay']
        + $payload['pera']
        + $payload['travelAllowance']
        + $payload['salaryAdjustment']
        + $payload['otherAllowances']
        + $payload['bonusAmount'],
        2
    );
    $taxableIncome = payroll_decimal($payload['withholdingTaxBase'] ?? $basicSalary);
    $globalRows = payroll_fetch_global_recurring_deduction_rows($pdo);
    $resolvedItems = [];
    $diagnostics = [];

    foreach ($globalRows as $row) {
        $amount = payroll_calculated_deduction_amount(
            $row,
            $basicSalary,
            $grossPreview,
            $taxableIncome,
            $payload['payPeriod']
        );

        if ($amount <= 0) {
            $diagnostics[] = [
                'deduction' => payroll_text($row['deductionName'] ?? ''),
                'source' => payroll_text($row['source'] ?? ''),
                'message' => 'No amount was applied. Check fixed amount or percentage rate.',
            ];
            continue;
        }

        $resolvedItems[] = [
            'name' => payroll_text($row['deductionName'] ?? ''),
            'category' => payroll_text($row['categoryName'] ?? 'Deductions') ?: 'Deductions',
            'amount' => $amount,
            'source' => payroll_text($row['source'] ?? ''),
        ];
    }

    $loanItems = payroll_fetch_approved_loan_deduction_items(
        $pdo,
        $employeeRecordId,
        $payload['endDate'],
        $payload['payPeriod'],
        $employee['employmentType'] ?? null
    );
    $resolvedItems = [...$resolvedItems, ...$loanItems];

    $payload = payroll_apply_resolved_deduction_items($payload, $resolvedItems);
    $payload['deductionDiagnostics'] = $diagnostics;

    foreach ($diagnostics as $diagnostic) {
        payroll_log_deduction_debug('Deduction diagnostic.', $diagnostic);
    }

    return $payload;
}

function payroll_system_workday_numbers(PDO $pdo): array
{
    $configuration = json_decode(get_application_setting($pdo, 'system_configuration', '{}'), true);
    $workWeek = is_array($configuration) && is_array($configuration['workWeek'] ?? null)
        ? $configuration['workWeek']
        : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    $dayMap = [
        'mon' => 1,
        'monday' => 1,
        'tue' => 2,
        'tuesday' => 2,
        'wed' => 3,
        'wednesday' => 3,
        'thu' => 4,
        'thursday' => 4,
        'fri' => 5,
        'friday' => 5,
        'sat' => 6,
        'saturday' => 6,
        'sun' => 7,
        'sunday' => 7,
    ];
    $days = [];

    foreach ($workWeek as $day) {
        $key = strtolower(trim((string)$day));
        if (isset($dayMap[$key])) {
            $days[$dayMap[$key]] = true;
        }
    }

    if ($days === []) {
        return [1, 2, 3, 4, 5];
    }

    $numbers = array_keys($days);
    sort($numbers);

    return $numbers;
}

function payroll_non_working_holiday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    if (!payroll_database_table_exists($pdo, 'holidays')) {
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
        $holidayDate = payroll_date_or_null($row['holidayDate'] ?? null);

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

function payroll_workday_dates(PDO $pdo, string $startDate, string $endDate): array
{
    $holidays = payroll_non_working_holiday_dates($pdo, $startDate, $endDate);
    $workdayNumbers = array_flip(payroll_system_workday_numbers($pdo));
    $workdays = [];
    $current = new DateTimeImmutable($startDate);
    $end = new DateTimeImmutable($endDate);

    while ($current <= $end) {
        $dateKey = $current->format('Y-m-d');
        $dayOfWeek = (int)$current->format('N');

        if (isset($workdayNumbers[$dayOfWeek]) && !isset($holidays[$dateKey])) {
            $workdays[$dateKey] = true;
        }

        $current = $current->modify('+1 day');
    }

    return $workdays;
}

function payroll_approved_leave_dates(PDO $pdo, int $employeeRecordId, string $startDate, string $endDate, array $workdayDates): array
{
    if (!payroll_database_table_exists($pdo, 'leave_requests')) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT start_date AS startDate, end_date AS endDate
         FROM leave_requests
         WHERE employee_id = :employee_id
           AND LOWER(status) = "approved"
           AND start_date <= :end_date
           AND end_date >= :start_date'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $leaveDates = [];

    foreach ($statement->fetchAll() as $row) {
        $requestStart = payroll_date_or_null($row['startDate'] ?? null);
        $requestEnd = payroll_date_or_null($row['endDate'] ?? null);

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
                $leaveDates[$dateKey] = true;
            }

            $current = $current->modify('+1 day');
        }
    }

    return $leaveDates;
}

function payroll_attendance_deductions(PDO $pdo, int $employeeRecordId, ?string $startDate, ?string $endDate, float $basicSalary): array
{
    $empty = [
        'renderedMinutes' => 0,
        'lateMinutes' => 0,
        'undertimeMinutes' => 0,
        'lateHours' => 0.0,
        'undertimeHours' => 0.0,
        'absentDays' => 0,
        'leaveDays' => 0,
        'expectedWorkdays' => 0,
        'lateDeduction' => 0.0,
        'absenceDeduction' => 0.0,
        'undertimeDeduction' => 0.0,
        'hasAttendanceCoverage' => false,
    ];

    if (
        $employeeRecordId <= 0
        || $startDate === null
        || $endDate === null
        || $startDate > $endDate
        || !payroll_database_table_exists($pdo, 'attendance_daily_records')
    ) {
        return $empty;
    }

    $coverageStatement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM attendance_daily_records
         WHERE attendance_date BETWEEN :start_date AND :end_date'
    );
    $coverageStatement->execute([
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    if ((int)$coverageStatement->fetchColumn() === 0) {
        return $empty;
    }

    $statement = $pdo->prepare(
        'SELECT
            attendance_date AS attendanceDate,
            time_in AS timeIn,
            time_out AS timeOut,
            total_minutes AS totalMinutes,
            late_minutes AS lateMinutes,
            undertime_minutes AS undertimeMinutes
         FROM attendance_daily_records
         WHERE employee_id = :employee_id
           AND attendance_date BETWEEN :start_date AND :end_date
         ORDER BY attendance_date ASC'
    );
    $statement->execute([
        ':employee_id' => $employeeRecordId,
        ':start_date' => $startDate,
        ':end_date' => $endDate,
    ]);

    $records = $statement->fetchAll();
    $totals = $empty;
    $datesWithEntries = [];

    foreach ($records as $record) {
        $recordDate = payroll_date_or_null($record['attendanceDate'] ?? null);
        $totalMinutes = (int)($record['totalMinutes'] ?? 0);

        $totals['renderedMinutes'] += $totalMinutes;
        $totals['lateMinutes'] += (int)($record['lateMinutes'] ?? 0);
        $totals['undertimeMinutes'] += (int)($record['undertimeMinutes'] ?? 0);

        if (
            $recordDate !== null
            && (
                payroll_text($record['timeIn'] ?? '') !== ''
                || payroll_text($record['timeOut'] ?? '') !== ''
                || $totalMinutes > 0
            )
        ) {
            $datesWithEntries[$recordDate] = true;
        }
    }

    $workdayDates = payroll_workday_dates($pdo, $startDate, $endDate);
    $leaveDates = payroll_approved_leave_dates($pdo, $employeeRecordId, $startDate, $endDate, $workdayDates);
    $absentDays = 0;

    foreach ($workdayDates as $date => $_) {
        if (!isset($datesWithEntries[$date]) && !isset($leaveDates[$date])) {
            $absentDays++;
        }
    }

    $rates = payroll_attendance_rates($pdo, $basicSalary);
    $hourlyRate = $rates['hourly'];
    $dailyRate = $rates['daily'];
    $lateHours = $totals['lateMinutes'] / 60;
    $undertimeHours = $totals['undertimeMinutes'] / 60;

    return array_merge($totals, [
        'lateHours' => payroll_decimal($lateHours),
        'undertimeHours' => payroll_decimal($undertimeHours),
        'absentDays' => $absentDays,
        'leaveDays' => count($leaveDates),
        'expectedWorkdays' => count($workdayDates),
        'lateDeduction' => round($lateHours * $hourlyRate, 2),
        'absenceDeduction' => round($absentDays * $dailyRate, 2),
        'undertimeDeduction' => round($undertimeHours * $hourlyRate, 2),
        'hasAttendanceCoverage' => true,
    ]);
}

function payroll_date_or_null(mixed $value): ?string
{
    $value = payroll_nullable_text($value);

    if ($value === null) {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $value);
    return $date && $date->format('Y-m-d') === $value ? $value : null;
}

function payroll_lookup_allowance_amount(PDO $pdo, string $allowanceName, float $fallback = 0.0): float
{
    $statement = $pdo->prepare(
        'SELECT amount
         FROM allowance
         WHERE allowance_name = :allowance_name
         ORDER BY allowance_id DESC
         LIMIT 1'
    );
    $statement->execute([':allowance_name' => $allowanceName]);
    $amount = $statement->fetchColumn();

    if ($amount === false || !is_numeric($amount)) {
        return $fallback;
    }

    return payroll_decimal($amount);
}

function payroll_default_settings(PDO $pdo): array
{
    return [
        'pera' => payroll_lookup_allowance_amount($pdo, 'PERA', PAYROLL_DEFAULT_PERA_AMOUNT),
        /*
         * The register's deduction columns. These were 34 names typed into the payroll workspace,
         * so a deduction added in Settings never got a column and one removed left a dead one.
         * `show_in_payroll` on each catalog row decides now, and the order follows the catalog's
         * category and type sort order.
         */
        'deductionColumns' => array_map(
            static fn (array $type): array => [
                'code' => $type['code'],
                'name' => $type['name'],
                'category' => $type['categoryName'],
                'categoryCode' => $type['categoryCode'],
            ],
            deduction_catalog_types($pdo, ['activeOnly' => true, 'payrollOnly' => true])
        ),
        /*
         * Who signs the register. Served with the payroll defaults so the certification the
         * workspace draws is the same one the Excel export writes, both read from Settings rather
         * than from names typed into either screen.
         */
        'signatories' => payroll_signatories($pdo),
        'certificationStatement' => payroll_signatory_statement(),
    ];
}

function payroll_payload(PDO $pdo, array $body): array
{
    $overtimeHours = payroll_decimal($body['overtimeHours'] ?? 0);
    $overtimeRate = payroll_decimal($body['overtimeRate'] ?? 0);
    $overtimePay = round($overtimeHours * $overtimeRate, 2);

    return [
        'employeeRecordId' => (int)($body['employeeRecordId'] ?? 0),
        'payrollType' => payroll_normalize_type($body['payrollType'] ?? ''),
        'payPeriod' => payroll_text($body['payPeriod'] ?? ''),
        'startDate' => payroll_date_or_null($body['startDate'] ?? null),
        'endDate' => payroll_date_or_null($body['endDate'] ?? null),
        'overtimeHours' => $overtimeHours,
        'overtimeRate' => $overtimeRate,
        'overtimePay' => $overtimePay,
        'pera' => payroll_lookup_allowance_amount($pdo, 'PERA', PAYROLL_DEFAULT_PERA_AMOUNT),
        'travelAllowance' => payroll_decimal($body['travelAllowance'] ?? 0),
        'salaryAdjustment' => payroll_decimal($body['salaryAdjustment'] ?? 0),
        'otherAllowances' => payroll_decimal($body['otherAllowances'] ?? 0),
        'bonusAmount' => payroll_decimal($body['bonusAmount'] ?? 0),
        'lateDeduction' => payroll_decimal($body['lateDeduction'] ?? 0),
        'absenceDeduction' => payroll_decimal($body['absenceDeduction'] ?? 0),
        'undertimeDeduction' => payroll_decimal($body['undertimeDeduction'] ?? 0),
        'withholdingTax' => payroll_decimal($body['withholdingTax'] ?? 0),
        'sss' => payroll_decimal($body['sss'] ?? 0),
        'gsis' => payroll_decimal($body['gsis'] ?? 0),
        'hdmf' => payroll_decimal($body['hdmf'] ?? 0),
        'phic' => payroll_decimal($body['phic'] ?? 0),
        'manualCashAdvanceAdjustment' => payroll_decimal($body['manualCashAdvanceAdjustment'] ?? 0),
        'laptopLoan' => payroll_decimal($body['laptopLoan'] ?? 0),
        'otherDeductions' => payroll_decimal($body['otherDeductions'] ?? 0),
        'additionalDeductionItems' => [],
        'additionalDeductionsTotal' => 0.0,
        'deductionDiagnostics' => [],
        'status' => payroll_text($body['status'] ?? 'Draft'),
        'notes' => payroll_nullable_text($body['notes'] ?? null),
    ];
}

function payroll_fetch_employee_snapshot(PDO $pdo, int $employeeRecordId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.last_name AS lastName,
            e.first_name AS firstName,
            e.middle_name AS middleName,
            des.name AS position,
            e.division_id AS divisionId,
            d.name AS division,
            e.employment_status AS employmentType,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            e.profile_image AS profileImage
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeRecordId]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

function payroll_validate_payload(PDO $pdo, array $payload, bool $allowArchivedStatus = false): array
{
    $errors = [];

    if ($payload['employeeRecordId'] <= 0) {
        $errors[] = 'Employee is required.';
    }

    if (!in_array($payload['payPeriod'], PAYROLL_ALLOWED_PERIODS, true)) {
        $errors[] = 'Pay period is required.';
    }

    $payrollType = payroll_text($payload['payrollType'] ?? '');
    if (!in_array($payrollType, PAYROLL_ALLOWED_TYPES, true)) {
        $errors[] = 'Selected payroll type is invalid.';
    }

    if ($payload['startDate'] === null) {
        $errors[] = 'Start date is required.';
    }

    if ($payload['endDate'] === null) {
        $errors[] = 'End date is required.';
    }

    if ($payload['startDate'] !== null && $payload['endDate'] !== null && $payload['startDate'] > $payload['endDate']) {
        $errors[] = 'End date must be on or after the start date.';
    }

    $allowedStatuses = $allowArchivedStatus
        ? PAYROLL_ALL_STATUSES
        : PAYROLL_ACTIVE_STATUSES;
    if (!in_array(payroll_normalize_status($payload['status']), $allowedStatuses, true)) {
        $errors[] = 'Selected payroll status is invalid.';
    }

    $employee = $payload['employeeRecordId'] > 0
        ? payroll_fetch_employee_snapshot($pdo, $payload['employeeRecordId'])
        : null;

    if ($payload['employeeRecordId'] > 0 && $employee === null) {
        $errors[] = 'Selected employee record is unavailable.';
    }

    // Only plantilla employees receive the benefit payrolls, so a Contract of Service employee
    // caught in the selection is rejected here rather than being paid a bonus they are not due.
    if ($employee !== null && !payroll_type_allows_employment_type($payrollType, (string)($employee['employmentType'] ?? ''))) {
        $errors[] = sprintf(
            '%s is only applicable to Regular employees. %s is %s.',
            $payrollType,
            payroll_text($employee['employeeName'] ?? 'This employee'),
            payroll_text($employee['employmentType'] ?? '') !== ''
                ? payroll_text($employee['employmentType'])
                : 'not set as Regular'
        );
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    return $employee;
}

function payroll_calculate_totals(array $payload, array $employee): array
{
    $basicSalary = payroll_decimal($employee['basicSalary'] ?? 0);
    $totalAllowance = round(
        $payload['overtimePay']
        + $payload['pera']
        + $payload['travelAllowance']
        + $payload['salaryAdjustment']
        + $payload['otherAllowances']
        + $payload['bonusAmount'],
        2
    );
    $grossPay = round($basicSalary + $totalAllowance, 2);
    $totalDeduction = round(
        $payload['lateDeduction']
        + $payload['absenceDeduction']
        + $payload['undertimeDeduction']
        + $payload['withholdingTax']
        + ($payload['sss'] ?? 0)
        + $payload['gsis']
        + $payload['hdmf']
        + $payload['phic']
        + $payload['manualCashAdvanceAdjustment']
        + $payload['laptopLoan']
        + $payload['otherDeductions']
        + ($payload['additionalDeductionsTotal'] ?? 0),
        2
    );
    $netPay = round($grossPay - $totalDeduction, 2);

    return [
        'basicSalary' => $basicSalary,
        'totalAllowance' => $totalAllowance,
        'grossPay' => $grossPay,
        'totalDeduction' => $totalDeduction,
        'netPay' => $netPay,
    ];
}

function payroll_apply_automatic_calculations(PDO $pdo, array $payload, array $employee): array
{
    $basicSalary = payroll_decimal($employee['basicSalary'] ?? 0);
    $employeeRecordId = (int)($employee['id'] ?? $payload['employeeRecordId'] ?? 0);
    $hourlyRate = payroll_monthly_hourly_rate($basicSalary);
    $overtimeHours = payroll_approved_overtime_hours(
        $pdo,
        $employeeRecordId,
        $payload['startDate'],
        $payload['endDate']
    );
    $overtimeRate = $hourlyRate * PAYROLL_REGULAR_OVERTIME_MULTIPLIER;
    $passSlipHours = payroll_filed_pass_slip_hours(
        $pdo,
        $employeeRecordId,
        $payload['startDate'],
        $payload['endDate']
    );
    $passSlipCount = payroll_filed_pass_slip_count(
        $pdo,
        $employeeRecordId,
        $payload['startDate'],
        $payload['endDate']
    );
    $attendanceDeductions = payroll_attendance_deductions(
        $pdo,
        $employeeRecordId,
        $payload['startDate'],
        $payload['endDate'],
        $basicSalary
    );

    $payload['hourlyRate'] = payroll_decimal($hourlyRate);
    $payload['overtimeHours'] = $overtimeHours;
    $payload['overtimeRate'] = payroll_decimal($overtimeRate);
    $payload['overtimePay'] = round($overtimeHours * $overtimeRate, 2);
    $payload['passSlipHours'] = $passSlipHours;
    $payload['passSlipCount'] = $passSlipCount;
    $payload['attendanceRenderedMinutes'] = $attendanceDeductions['renderedMinutes'];
    $payload['attendanceLateMinutes'] = $attendanceDeductions['lateMinutes'];
    $payload['attendanceUndertimeMinutes'] = $attendanceDeductions['undertimeMinutes'];
    $payload['attendanceExpectedWorkdays'] = $attendanceDeductions['expectedWorkdays'];
    $payload['attendanceLeaveDays'] = $attendanceDeductions['leaveDays'];
    $payload['absenceDays'] = $attendanceDeductions['absentDays'];
    $payload['hasAttendanceCoverage'] = (bool)($attendanceDeductions['hasAttendanceCoverage'] ?? false);

    if ($payload['hasAttendanceCoverage']) {
        $payload['lateHours'] = $attendanceDeductions['lateHours'];
        $payload['undertimeHours'] = $attendanceDeductions['undertimeHours'];
        $payload['lateDeduction'] = $attendanceDeductions['lateDeduction'];
        $payload['absenceDeduction'] = $attendanceDeductions['absenceDeduction'];
        $payload['undertimeDeduction'] = $attendanceDeductions['undertimeDeduction'];
    } else {
        $payload['lateHours'] = 0;
        $payload['undertimeHours'] = $passSlipHours;
        $payload['undertimeDeduction'] = round($passSlipHours * $hourlyRate, 2);
    }

    $payload['withholdingTaxBase'] = $basicSalary;
    $payload['withholdingTax'] = payroll_calculate_withholding_tax($basicSalary, $pdo);
    $payload = payroll_apply_recurring_deductions($pdo, $payload, $employee, $basicSalary);

    return $payload;
}

function payroll_with_legacy_fk_bypass(PDO $pdo, callable $callback): mixed
{
    $pdo->exec('SET FOREIGN_KEY_CHECKS=0');

    try {
        return $callback();
    } finally {
        $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
    }
}

function payroll_store_meta(PDO $pdo, int $payrollId, array $meta): void
{
    ensure_payroll_meta_column($pdo);

    $statement = $pdo->prepare(
        'UPDATE payroll
         SET meta_json = :meta_json
         WHERE payroll_id = :payroll_id'
    );
    $statement->execute([
        ':payroll_id' => $payrollId,
        ':meta_json' => json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
}

function payroll_fetch_meta(PDO $pdo, int $payrollId): array
{
    ensure_payroll_meta_column($pdo);

    $statement = $pdo->prepare(
        'SELECT meta_json
         FROM payroll
         WHERE payroll_id = :payroll_id
         LIMIT 1'
    );
    $statement->execute([':payroll_id' => $payrollId]);
    $value = $statement->fetchColumn();

    if (!is_string($value) || trim($value) === '') {
        return [];
    }

    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : [];
}

function payroll_ensure_approval_schema(PDO $pdo): void
{
    ensure_payroll_embedded_detail_columns($pdo);
}

function payroll_actor_display_name(array $user): string
{
    $name = payroll_text($user['fullName'] ?? $user['full_name'] ?? '');

    if ($name !== '') {
        return $name;
    }

    $firstName = payroll_text($user['first_name'] ?? '');
    $middleName = payroll_text($user['middle_name'] ?? '');
    $lastName = payroll_text($user['last_name'] ?? '');
    $name = trim($firstName . ' ' . $middleName . ' ' . $lastName);

    if ($name !== '') {
        return preg_replace('/\s+/', ' ', $name) ?? $name;
    }

    return payroll_text($user['username'] ?? '') ?: 'System User';
}

function payroll_record_approval_action(
    PDO $pdo,
    int $payrollId,
    array $actorUser,
    string $action,
    ?string $comments = null,
    ?string $fromStatus = null,
    ?string $toStatus = null
): void {
    payroll_ensure_approval_schema($pdo);

    $userId = (int)($actorUser['id'] ?? 0);
    if ($payrollId <= 0 || $userId <= 0 || payroll_text($action) === '') {
        return;
    }

    $employeeRecordId = session_employee_record_id($pdo, $actorUser);
    $history = payroll_read_embedded_json_list($pdo, $payrollId, 'approval_history_json');
    $nextId = 1;

    foreach ($history as $entry) {
        if (is_array($entry)) {
            $nextId = max($nextId, (int)($entry['id'] ?? 0) + 1);
        }
    }

    $history[] = [
        'id' => $nextId,
        'payrollId' => $payrollId,
        'approverUserId' => $userId,
        'approverEmployeeRecordId' => $employeeRecordId,
        'action' => payroll_text($action),
        'fromStatus' => $fromStatus !== null ? payroll_normalize_status($fromStatus) : null,
        'toStatus' => $toStatus !== null ? payroll_normalize_status($toStatus) : null,
        'actionDate' => date('Y-m-d H:i:s'),
        'comments' => payroll_nullable_text($comments),
    ];

    payroll_write_embedded_json_list($pdo, $payrollId, 'approval_history_json', $history);
}

function payroll_approval_actor_details(PDO $pdo, int $userId, int $employeeRecordId): array
{
    static $cache = [];
    $cacheKey = $userId . ':' . $employeeRecordId;

    if (isset($cache[$cacheKey])) {
        return $cache[$cacheKey];
    }

    if ($userId <= 0) {
        return $cache[$cacheKey] = [
            'approverEmployeeRecordId' => $employeeRecordId,
            'approverName' => 'System User',
            'approverRole' => '',
            'signatureDataUrl' => '',
        ];
    }

    $statement = $pdo->prepare(
        'SELECT
            COALESCE(e.id, :fallback_employee_id) AS approverEmployeeRecordId,
            COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))), ""),
                u.username,
                "System User"
            ) AS approverName,
            COALESCE(r.name, "") AS approverRole,
            COALESCE(e.e_signature, "") AS signatureDataUrl
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON (
                e.id = :employee_id
                OR (:use_email_match = 1 AND e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci)
            )
           AND e.is_archived = 0
         WHERE u.id = :user_id
         ORDER BY (e.id = :preferred_employee_id) DESC
         LIMIT 1'
    );
    $statement->execute([
        ':fallback_employee_id' => $employeeRecordId,
        ':employee_id' => $employeeRecordId,
        ':use_email_match' => $employeeRecordId > 0 ? 0 : 1,
        ':user_id' => $userId,
        ':preferred_employee_id' => $employeeRecordId,
    ]);
    $row = $statement->fetch() ?: [];

    return $cache[$cacheKey] = [
        'approverEmployeeRecordId' => (int)($row['approverEmployeeRecordId'] ?? $employeeRecordId),
        'approverName' => payroll_text($row['approverName'] ?? 'System User') ?: 'System User',
        'approverRole' => payroll_text($row['approverRole'] ?? ''),
        'signatureDataUrl' => payroll_text($row['signatureDataUrl'] ?? ''),
    ];
}

function payroll_fetch_approval_history(PDO $pdo, int $payrollId): array
{
    if ($payrollId <= 0) {
        return [];
    }

    payroll_ensure_approval_schema($pdo);
    $history = [];

    foreach (payroll_read_embedded_json_list($pdo, $payrollId, 'approval_history_json') as $entry) {
        if (!is_array($entry)) {
            continue;
        }

        $userId = (int)($entry['approverUserId'] ?? $entry['approver_user_id'] ?? 0);
        $employeeRecordId = (int)($entry['approverEmployeeRecordId'] ?? $entry['approver_employee_id'] ?? 0);
        $actor = payroll_approval_actor_details($pdo, $userId, $employeeRecordId);
        $history[] = [
            'id' => (int)($entry['id'] ?? 0),
            'payrollId' => $payrollId,
            'approverUserId' => $userId,
            'approverEmployeeRecordId' => $actor['approverEmployeeRecordId'],
            'approverName' => $actor['approverName'],
            'approverRole' => $actor['approverRole'],
            'action' => payroll_text($entry['action'] ?? ''),
            'fromStatus' => payroll_text($entry['fromStatus'] ?? $entry['from_status'] ?? ''),
            'toStatus' => payroll_text($entry['toStatus'] ?? $entry['to_status'] ?? ''),
            'actionDate' => $entry['actionDate'] ?? $entry['action_date'] ?? null,
            'comments' => payroll_nullable_text($entry['comments'] ?? null),
            'signatureDataUrl' => $actor['signatureDataUrl'],
        ];
    }

    usort($history, static function (array $left, array $right): int {
        $dateOrder = strcmp((string)($left['actionDate'] ?? ''), (string)($right['actionDate'] ?? ''));
        return $dateOrder !== 0 ? $dateOrder : ((int)$left['id'] <=> (int)$right['id']);
    });

    return $history;
}

function payroll_allowance_items(array $payload): array
{
    return [
        ['name' => 'Overtime Pay', 'amount' => $payload['overtimePay']],
        ['name' => 'PERA', 'amount' => $payload['pera']],
        ['name' => 'Travel Allowance', 'amount' => $payload['travelAllowance']],
        ['name' => 'Salary Adjustment', 'amount' => $payload['salaryAdjustment']],
        ['name' => 'Other Allowances', 'amount' => $payload['otherAllowances']],
        ['name' => 'Bonus Amount', 'amount' => $payload['bonusAmount']],
    ];
}

function payroll_deduction_items(array $payload): array
{
    return [
        ['name' => 'Late Deduction', 'amount' => $payload['lateDeduction']],
        ['name' => 'Absence Deduction', 'amount' => $payload['absenceDeduction']],
        ['name' => 'Undertime Deduction', 'amount' => $payload['undertimeDeduction']],
        ['name' => 'Withholding Tax', 'amount' => $payload['withholdingTax']],
        ['name' => 'SSS', 'amount' => $payload['sss'] ?? 0],
        ['name' => 'GSIS', 'amount' => $payload['gsis']],
        ['name' => 'HDMF', 'amount' => $payload['hdmf']],
        ['name' => 'PHIC', 'amount' => $payload['phic']],
        ['name' => 'Manual Cash Advance Adjustment', 'amount' => $payload['manualCashAdvanceAdjustment']],
        ['name' => 'Laptop Loan', 'amount' => $payload['laptopLoan']],
        ['name' => 'Other Deductions', 'amount' => $payload['otherDeductions']],
        ...($payload['additionalDeductionItems'] ?? []),
    ];
}

function payroll_resolve_allowance_snapshot(PDO $pdo, string $name, float $amount): int
{
    $statement = $pdo->prepare(
        'SELECT allowance_id
         FROM allowance
         WHERE allowance_name = :allowance_name
           AND amount = :amount
         ORDER BY allowance_id DESC
         LIMIT 1'
    );
    $statement->execute([
        ':allowance_name' => $name,
        ':amount' => payroll_decimal_string($amount),
    ]);
    $existingId = (int)$statement->fetchColumn();

    if ($existingId > 0) {
        return $existingId;
    }

    $insert = $pdo->prepare(
        'INSERT INTO allowance (allowance_name, amount)
         VALUES (:allowance_name, :amount)'
    );
    $insert->execute([
        ':allowance_name' => $name,
        ':amount' => payroll_decimal_string($amount),
    ]);

    return (int)$pdo->lastInsertId();
}

function payroll_resolve_deduction_category(PDO $pdo, string $categoryName): int
{
    return payroll_category_id_from_name($categoryName);
}

/**
 * Resolves a deduction to its catalog id, creating the type if the payroll run names a new one.
 *
 * The lookup and insert use the same existing family tables that Deduction Setup edits.
 */
function payroll_resolve_deduction_type(PDO $pdo, string $categoryName, string $deductionName): int
{
    return deduction_catalog_resolve_type($pdo, $categoryName, $deductionName);
}

function payroll_sync_allowances(PDO $pdo, int $payrollId, array $items): void
{
    foreach ($items as $item) {
        $amount = payroll_decimal($item['amount'] ?? 0);
        if ($amount <= 0) {
            continue;
        }

        payroll_resolve_allowance_snapshot($pdo, (string)$item['name'], $amount);
    }
}

/**
 * Writes the itemised deduction snapshot on its parent payroll row, then mirrors it into the
 * register's deduction columns.
 *
 * The JSON list keeps names and categories for historical display while type ids keep catalog usage
 * checks reliable. payroll_rebuild_deduction_columns() can reconstruct every amount column from it.
 */
function payroll_sync_deductions(PDO $pdo, int $payrollId, array $items): void
{
    $existingIds = [];
    foreach (deduction_catalog_payroll_items($pdo, $payrollId) as $existing) {
        $typeId = (int)($existing['deductionTypeId'] ?? 0);
        $existingIds[$typeId][] = (int)($existing['payrollDeductionId'] ?? 0);
    }

    $nextId = payroll_next_embedded_item_id($pdo, 'deduction_items_json');
    $stored = [];

    foreach ($items as $item) {
        $amount = payroll_decimal($item['amount'] ?? 0);
        if ($amount <= 0) {
            continue;
        }

        $name = (string)$item['name'];
        $categoryName = payroll_text($item['category'] ?? '') ?: (PAYROLL_DEDUCTION_CATEGORY_MAP[$name] ?? 'Other Deductions');
        $deductionTypeId = payroll_resolve_deduction_type($pdo, $categoryName, $name);

        $itemId = !empty($existingIds[$deductionTypeId])
            ? (int)array_shift($existingIds[$deductionTypeId])
            : 0;
        if ($itemId <= 0) {
            $itemId = $nextId++;
        }

        $stored[] = [
            'id' => $itemId,
            'payrollDeductionId' => $itemId,
            'payrollId' => $payrollId,
            'deductionTypeId' => $deductionTypeId,
            'name' => $name,
            'category' => $categoryName,
            'amount' => payroll_decimal($amount),
            'source' => payroll_text($item['source'] ?? ''),
            'referenceId' => (int)($item['referenceId'] ?? 0),
            'monthlyAmount' => payroll_decimal($item['monthlyAmount'] ?? 0),
            'paidAmountBeforePayroll' => payroll_decimal($item['paidAmountBeforePayroll'] ?? 0),
        ];
    }

    payroll_write_embedded_json_list($pdo, $payrollId, 'deduction_items_json', $stored);
    payroll_rebuild_deduction_columns($pdo, $payrollId);
}

function payroll_record_paid_loan_deductions(PDO $pdo, int $payrollId, array $deductionItems, ?string $paidAt): void
{
    payroll_ensure_loan_tracking_schema($pdo);

    $loanItems = array_values(array_filter(
        $deductionItems,
        static fn (array $item): bool => payroll_text($item['source'] ?? '') === 'approved_loan'
            && (int)($item['referenceId'] ?? 0) > 0
            && payroll_decimal($item['amount'] ?? 0) > 0
    ));

    if (
        $payrollId <= 0
        || $paidAt === null
        || $loanItems === []
        || !payroll_database_table_exists($pdo, 'loan_payments')
    ) {
        return;
    }

    $statement = $pdo->prepare(
        'INSERT INTO loan_payments
            (loan_record_id, installment_number, amount, paid_at, payment_reference, notes, source, payroll_id)
         VALUES
            (:loan_record_id, :installment_number, :amount, :paid_at, :payment_reference, :notes, "payroll", :payroll_id)
         ON DUPLICATE KEY UPDATE
            installment_number = VALUES(installment_number),
            amount = VALUES(amount),
            paid_at = VALUES(paid_at),
            payment_reference = VALUES(payment_reference),
            notes = VALUES(notes)'
    );

    foreach ($loanItems as $item) {
        $loanRequestId = (int)($item['referenceId'] ?? 0);
        $amount = payroll_decimal($item['amount'] ?? 0);
        $monthlyAmount = payroll_decimal($item['monthlyAmount'] ?? 0);
        $paidBefore = payroll_decimal($item['paidAmountBeforePayroll'] ?? 0);

        if ($loanRequestId <= 0 || $amount <= 0) {
            continue;
        }

        $installmentNumber = $monthlyAmount > 0
            ? max(1, (int)floor(($paidBefore + 0.01) / $monthlyAmount) + 1)
            : 1;

        $statement->execute([
            ':loan_record_id' => $loanRequestId,
            ':installment_number' => $installmentNumber,
            ':amount' => payroll_decimal_string($amount),
            ':paid_at' => $paidAt,
            ':payment_reference' => 'PAYROLL-' . $payrollId,
            ':notes' => 'Automatically recorded when payroll was marked paid.',
            ':payroll_id' => $payrollId,
        ]);
    }
}

/**
 * Reloads every deduction column on a payroll row from its embedded itemised snapshot.
 *
 * Deductions the run did not charge are written back to 0.00 rather than left alone, so a deduction
 * removed from a payroll run clears its column instead of keeping the previous run's figure.
 */
function payroll_rebuild_deduction_columns(PDO $pdo, int $payrollId): void
{
    if ($payrollId <= 0) {
        return;
    }

    $columns = payroll_deduction_column_map($pdo);

    if ($columns === []) {
        return;
    }

    $amounts = [];
    foreach (deduction_catalog_payroll_items($pdo, $payrollId) as $item) {
        $typeId = (int)($item['deductionTypeId'] ?? 0);
        $amounts[$typeId] = payroll_decimal(($amounts[$typeId] ?? 0) + payroll_decimal($item['amount'] ?? 0));
    }

    $assignments = [];
    $params = [':payroll_id' => $payrollId];

    foreach ($columns as $column => $deductionId) {
        $placeholder = ':amount_' . $deductionId;
        $assignments[] = sprintf('`%s` = %s', $column, $placeholder);
        $params[$placeholder] = payroll_decimal_string($amounts[$deductionId] ?? 0.0);
    }

    $update = $pdo->prepare(
        'UPDATE `payroll` SET ' . implode(', ', $assignments) . ' WHERE payroll_id = :payroll_id'
    );
    $update->execute($params);
}

/**
 * Creates any deduction type the run names that the catalog does not have yet, and gives it its
 * column on `payroll`.
 *
 * Must be called before the caller opens its transaction. Both steps are DDL-adjacent — a new type
 * means an ALTER on `payroll` — and DDL is an implicit commit in MySQL, so doing this inside the
 * transaction would end it early and leave the new deduction without a column to be written to.
 */
function payroll_prepare_deduction_types(PDO $pdo, array $items): void
{
    foreach ($items as $item) {
        $name = payroll_text($item['name'] ?? '');

        if ($name === '' || payroll_decimal($item['amount'] ?? 0) <= 0) {
            continue;
        }

        $categoryName = payroll_text($item['category'] ?? '')
            ?: (PAYROLL_DEDUCTION_CATEGORY_MAP[$name] ?? 'Other Deductions');
        payroll_resolve_deduction_type($pdo, $categoryName, $name);
    }

    deduction_catalog_sync_payroll_columns($pdo);
    payroll_deduction_column_map($pdo, true);
}

/** column name => deduction id, for the deductions that have a column on `payroll`. */
function payroll_deduction_column_map(PDO $pdo, bool $refresh = false): array
{
    static $map = null;

    if ($map !== null && !$refresh) {
        return $map;
    }

    $existing = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `payroll`') as $row) {
        $existing[strtolower((string)$row['Field'])] = true;
    }

    $map = [];
    foreach (deduction_catalog_types($pdo, ['activeOnly' => true, 'payrollOnly' => true]) as $type) {
        $column = $type['payrollColumn'];

        if ($column !== '' && isset($existing[$column])) {
            $map[$column] = $type['id'];
        }
    }

    return $map;
}

function payroll_base_query(): string
{
    return 'SELECT
            p.payroll_id AS id,
            p.employee_id AS employeeRecordId,
            p.payroll_date AS payrollDate,
            p.status,
            p.gross_pay AS grossPay,
            p.total_allowance AS totalAllowance,
            p.total_deduction AS totalDeduction,
            p.net_pay AS netPay,
            e.employee_id AS employeeId,
            e.division_id AS divisionId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            e.last_name AS lastName,
            e.first_name AS firstName,
            e.middle_name AS middleName,
            des.name AS position,
            d.name AS division,
            e.employment_status AS currentEmploymentType,
            e.basic_salary AS currentBasicSalary,
            e.profile_image AS profileImage
         FROM payroll p
         LEFT JOIN employees e ON e.id = p.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id';
}

function payroll_fetch_allowances(PDO $pdo, int $payrollId, array $meta = []): array
{
    if (isset($meta['allowanceItems']) && is_array($meta['allowanceItems'])) {
        return array_values(array_filter(
            array_map(
                static fn (array $item): array => [
                    'name' => payroll_text($item['name'] ?? ''),
                    'amount' => payroll_decimal($item['amount'] ?? 0),
                ],
                $meta['allowanceItems']
            ),
            static fn (array $item): bool => $item['name'] !== ''
        ));
    }

    if (!payroll_database_table_exists($pdo, 'PayrollAllowance')) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT a.allowance_name AS name, a.amount
         FROM PayrollAllowance pa
         INNER JOIN allowance a ON a.allowance_id = pa.allowance_id
         WHERE pa.payroll_id = :payroll_id
         ORDER BY pa.payroll_allowance_id ASC'
    );
    $statement->execute([':payroll_id' => $payrollId]);

    return $statement->fetchAll();
}

function payroll_fetch_deductions(PDO $pdo, int $payrollId): array
{
    return array_map(
        static fn (array $item): array => [
            'name' => (string)($item['name'] ?? ''),
            'category' => (string)($item['category'] ?? ''),
            'amount' => payroll_decimal($item['amount'] ?? 0),
            'source' => payroll_text($item['source'] ?? ''),
            'referenceId' => (int)($item['referenceId'] ?? 0),
            'monthlyAmount' => payroll_decimal($item['monthlyAmount'] ?? 0),
            'paidAmountBeforePayroll' => payroll_decimal($item['paidAmountBeforePayroll'] ?? 0),
        ],
        deduction_catalog_payroll_items($pdo, $payrollId)
    );
}

/**
 * The employee's name in parts, which the register needs to list people surname-first.
 *
 * Read from the snapshot when the record has one, so a register keeps the name it was prepared
 * under, as `employeeName` does. Records generated before the snapshot carried the parts fall back
 * to the employee's current name.
 */
function payroll_record_name_parts(array $meta, array $baseRow): array
{
    $source = array_key_exists('lastName', $meta) ? $meta : $baseRow;

    return [
        'lastName' => payroll_text($source['lastName'] ?? ''),
        'firstName' => payroll_text($source['firstName'] ?? ''),
        'middleName' => payroll_text($source['middleName'] ?? ''),
    ];
}

/**
 * The salary step (1-8) the employee's service record has in force on `$asOf` -- the pay period's
 * end date -- for the register's Step Increment column. It is the step number, not an amount: the
 * step is already priced into the basic salary.
 *
 * Read from the newest service record entry dated on or before that day, the same entry
 * service_record_current_steps() treats as current. Null when there is none or it carries no step
 * (Contract of Service entries have none). Memoised per employee and date because a batch lists
 * many records for the same period.
 */
function payroll_service_record_step(PDO $pdo, int $employeeRecordId, ?string $asOf): ?int
{
    static $steps = [];

    if ($employeeRecordId <= 0) {
        return null;
    }

    $asOfDate = $asOf !== null && preg_match('/^\d{4}-\d{2}-\d{2}/', $asOf) === 1
        ? substr($asOf, 0, 10)
        : date('Y-m-d');
    $cacheKey = $employeeRecordId . '|' . $asOfDate;

    if (array_key_exists($cacheKey, $steps)) {
        return $steps[$cacheKey];
    }

    try {
        $statement = $pdo->prepare(
            'SELECT step_increment
             FROM service_records
             WHERE employee_record_id = :employee_record_id
               AND is_archived = 0
               AND service_from <= :as_of
             ORDER BY service_from DESC, id DESC
             LIMIT 1'
        );
        $statement->execute([
            ':employee_record_id' => $employeeRecordId,
            ':as_of' => $asOfDate,
        ]);
        $value = payroll_text($statement->fetchColumn() ?: '');
    } catch (Throwable $exception) {
        // An install without service records yet: the column stays blank rather than failing the list.
        $value = '';
    }

    $step = ctype_digit($value) ? (int)$value : 0;

    return $steps[$cacheKey] = $step >= 1 && $step <= 8 ? $step : null;
}

function payroll_expand_record(PDO $pdo, array $baseRow): array
{
    $payrollId = (int)($baseRow['id'] ?? 0);
    $meta = payroll_fetch_meta($pdo, $payrollId);
    $allowances = payroll_fetch_allowances($pdo, $payrollId, $meta);
    $deductions = payroll_fetch_deductions($pdo, $payrollId);

    $allowanceFieldValues = array_fill_keys(array_values(PAYROLL_ALLOWANCE_FIELD_MAP), 0.0);
    foreach ($allowances as $allowance) {
        $name = (string)($allowance['name'] ?? '');
        $field = PAYROLL_ALLOWANCE_FIELD_MAP[$name] ?? null;
        if ($field !== null) {
            $allowanceFieldValues[$field] = payroll_decimal($allowance['amount'] ?? 0);
        }
    }

    $deductionFieldValues = array_fill_keys(array_values(PAYROLL_DEDUCTION_FIELD_MAP), 0.0);
    foreach ($deductions as $deduction) {
        $name = (string)($deduction['name'] ?? '');
        $field = PAYROLL_DEDUCTION_FIELD_MAP[$name] ?? null;
        if ($field !== null) {
            $deductionFieldValues[$field] = payroll_decimal($deduction['amount'] ?? 0);
        }
    }

    $employeeId = payroll_text($meta['employeeId'] ?? $baseRow['employeeId'] ?? '');
    $employeeName = payroll_text($meta['employeeName'] ?? $baseRow['employeeName'] ?? '');
    $nameParts = payroll_record_name_parts($meta, $baseRow);
    // Snapshots saved before positions and designations were separate hold the position under 'designation'.
    $position = payroll_text(
        array_key_exists('position', $meta)
            ? ($meta['position'] ?? $baseRow['position'] ?? '')
            : ($meta['designation'] ?? $baseRow['position'] ?? '')
    );
    $division = payroll_text($meta['division'] ?? $baseRow['division'] ?? '');
    $employmentType = payroll_text($meta['employmentType'] ?? $baseRow['currentEmploymentType'] ?? '');
    $profileImage = payroll_text($meta['profileImage'] ?? $baseRow['profileImage'] ?? '');
    $payrollType = payroll_normalize_type($meta['payrollType'] ?? '');
    $payPeriod = payroll_text($meta['payPeriod'] ?? '');
    $startDate = payroll_nullable_text($meta['startDate'] ?? null);
    $endDate = payroll_nullable_text($meta['endDate'] ?? $baseRow['payrollDate'] ?? null);
    $periodLabel = $payPeriod !== ''
        ? sprintf('%s (%s to %s)', $payPeriod, $startDate ?? 'N/A', $endDate ?? 'N/A')
        : ($endDate ?? 'Unspecified period');
    $basicSalary = payroll_decimal($meta['basicSalary'] ?? $baseRow['currentBasicSalary'] ?? 0);
    $hourlyRate = payroll_decimal($meta['hourlyRate'] ?? 0);
    if ($hourlyRate <= 0 && $basicSalary > 0) {
        $hourlyRate = payroll_decimal(payroll_monthly_hourly_rate($basicSalary));
    }
    $attendanceDeductions = payroll_attendance_deductions(
        $pdo,
        (int)($baseRow['employeeRecordId'] ?? 0),
        $startDate,
        $endDate,
        $basicSalary
    );
    $hasAttendanceCoverage = (bool)($attendanceDeductions['hasAttendanceCoverage'] ?? false);

    if ($hasAttendanceCoverage) {
        $deductionFieldValues['lateDeduction'] = payroll_decimal($attendanceDeductions['lateDeduction'] ?? 0);
        $deductionFieldValues['absenceDeduction'] = payroll_decimal($attendanceDeductions['absenceDeduction'] ?? 0);
        $deductionFieldValues['undertimeDeduction'] = payroll_decimal($attendanceDeductions['undertimeDeduction'] ?? 0);
    }

    $grossPay = payroll_decimal($baseRow['grossPay'] ?? 0);
    $totalAllowance = payroll_decimal($baseRow['totalAllowance'] ?? 0);
    $additionalDeductionTotal = 0.0;
    foreach ($deductions as $deduction) {
        $name = (string)($deduction['name'] ?? '');
        if (!isset(PAYROLL_DEDUCTION_FIELD_MAP[$name]) && payroll_deduction_field_for_name($name) === null) {
            $additionalDeductionTotal += payroll_decimal($deduction['amount'] ?? 0);
        }
    }
    $additionalDeductionTotal = round($additionalDeductionTotal, 2);
    $computedTotalDeduction = round(
        $deductionFieldValues['lateDeduction']
        + $deductionFieldValues['absenceDeduction']
        + $deductionFieldValues['undertimeDeduction']
        + $deductionFieldValues['withholdingTax']
        + ($deductionFieldValues['sss'] ?? 0)
        + $deductionFieldValues['gsis']
        + $deductionFieldValues['hdmf']
        + $deductionFieldValues['phic']
        + $deductionFieldValues['manualCashAdvanceAdjustment']
        + $deductionFieldValues['laptopLoan']
        + $deductionFieldValues['otherDeductions']
        + $additionalDeductionTotal,
        2
    );
    $totalDeduction = $hasAttendanceCoverage
        ? $computedTotalDeduction
        : payroll_decimal($baseRow['totalDeduction'] ?? $computedTotalDeduction);
    $netPay = $hasAttendanceCoverage
        ? round($grossPay - $totalDeduction, 2)
        : payroll_decimal($baseRow['netPay'] ?? ($grossPay - $totalDeduction));
    $deductionItems = array_map(
        static fn (array $item): array => [
            'name' => $item['name'],
            'category' => $item['category'],
            'amount' => payroll_decimal($item['amount'] ?? 0),
            'source' => payroll_text($item['source'] ?? ''),
            'referenceId' => (int)($item['referenceId'] ?? 0),
            'monthlyAmount' => payroll_decimal($item['monthlyAmount'] ?? 0),
            'paidAmountBeforePayroll' => payroll_decimal($item['paidAmountBeforePayroll'] ?? 0),
        ],
        $deductions
    );
    $status = payroll_normalize_status($baseRow['status'] ?? 'Draft');

    if ($hasAttendanceCoverage) {
        $attendanceDeductionNames = [
            'Late Deduction' => $deductionFieldValues['lateDeduction'],
            'Absence Deduction' => $deductionFieldValues['absenceDeduction'],
            'Undertime Deduction' => $deductionFieldValues['undertimeDeduction'],
        ];

        foreach ($attendanceDeductionNames as $deductionName => $amount) {
            $found = false;
            foreach ($deductionItems as &$deductionItem) {
                if (($deductionItem['name'] ?? '') === $deductionName) {
                    $deductionItem['amount'] = payroll_decimal($amount);
                    $found = true;
                    break;
                }
            }
            unset($deductionItem);

            if (!$found && payroll_decimal($amount) > 0) {
                $deductionItems[] = [
                    'name' => $deductionName,
                    'category' => PAYROLL_DEDUCTION_CATEGORY_MAP[$deductionName] ?? 'Attendance Deductions',
                    'amount' => payroll_decimal($amount),
                ];
            }
        }
    }

    return [
        'id' => $payrollId,
        'employeeRecordId' => (int)($baseRow['employeeRecordId'] ?? 0),
        'divisionId' => (int)($baseRow['divisionId'] ?? 0),
        'employeeId' => $employeeId,
        'employeeName' => $employeeName,
        'lastName' => $nameParts['lastName'],
        'firstName' => $nameParts['firstName'],
        'middleName' => $nameParts['middleName'],
        'position' => $position,
        'division' => $division,
        'employmentType' => $employmentType,
        'profileImage' => $profileImage,
        'basicSalary' => $basicSalary,
        'stepIncrement' => payroll_service_record_step(
            $pdo,
            (int)($baseRow['employeeRecordId'] ?? 0),
            $endDate ?? payroll_nullable_text($baseRow['payrollDate'] ?? null)
        ),
        'payrollType' => $payrollType,
        'payPeriod' => $payPeriod,
        'startDate' => $startDate,
        'endDate' => $endDate,
        'periodLabel' => $periodLabel,
        'payrollDate' => $baseRow['payrollDate'] ?? null,
        'status' => $status,
        'notes' => payroll_nullable_text($meta['notes'] ?? null),
        'overtimeHours' => payroll_decimal($meta['overtimeHours'] ?? 0),
        'overtimeRate' => payroll_decimal($meta['overtimeRate'] ?? 0),
        'hourlyRate' => $hourlyRate,
        'passSlipHours' => payroll_decimal($meta['passSlipHours'] ?? 0),
        'passSlipCount' => (int)($meta['passSlipCount'] ?? 0),
        'undertimeHours' => $hasAttendanceCoverage
            ? payroll_decimal($attendanceDeductions['undertimeHours'] ?? 0)
            : payroll_decimal($meta['undertimeHours'] ?? 0),
        'lateHours' => $hasAttendanceCoverage
            ? payroll_decimal($attendanceDeductions['lateHours'] ?? 0)
            : payroll_decimal($meta['lateHours'] ?? 0),
        'absenceDays' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['absentDays'] ?? 0)
            : (int)($meta['absenceDays'] ?? 0),
        'attendanceRenderedMinutes' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['renderedMinutes'] ?? 0)
            : (int)($meta['attendanceRenderedMinutes'] ?? 0),
        'attendanceLateMinutes' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['lateMinutes'] ?? 0)
            : (int)($meta['attendanceLateMinutes'] ?? 0),
        'attendanceUndertimeMinutes' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['undertimeMinutes'] ?? 0)
            : (int)($meta['attendanceUndertimeMinutes'] ?? 0),
        'attendanceExpectedWorkdays' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['expectedWorkdays'] ?? 0)
            : (int)($meta['attendanceExpectedWorkdays'] ?? 0),
        'attendanceLeaveDays' => $hasAttendanceCoverage
            ? (int)($attendanceDeductions['leaveDays'] ?? 0)
            : (int)($meta['attendanceLeaveDays'] ?? 0),
        'hasAttendanceCoverage' => $hasAttendanceCoverage,
        'withholdingTaxBase' => payroll_decimal($meta['withholdingTaxBase'] ?? $meta['basicSalary'] ?? 0),
        'overtimePay' => payroll_decimal($meta['overtimePay'] ?? $allowanceFieldValues['overtimePay'] ?? 0),
        'pera' => $allowanceFieldValues['pera'] ?? 0.0,
        'travelAllowance' => $allowanceFieldValues['travelAllowance'] ?? 0.0,
        'salaryAdjustment' => $allowanceFieldValues['salaryAdjustment'] ?? 0.0,
        'otherAllowances' => $allowanceFieldValues['otherAllowances'] ?? 0.0,
        'bonusAmount' => $allowanceFieldValues['bonusAmount'] ?? 0.0,
        'lateDeduction' => $deductionFieldValues['lateDeduction'] ?? 0.0,
        'absenceDeduction' => $deductionFieldValues['absenceDeduction'] ?? 0.0,
        'undertimeDeduction' => $deductionFieldValues['undertimeDeduction'] ?? 0.0,
        'withholdingTax' => $deductionFieldValues['withholdingTax'] ?? 0.0,
        'sss' => $deductionFieldValues['sss'] ?? 0.0,
        'gsis' => $deductionFieldValues['gsis'] ?? 0.0,
        'hdmf' => $deductionFieldValues['hdmf'] ?? 0.0,
        'phic' => $deductionFieldValues['phic'] ?? 0.0,
        'manualCashAdvanceAdjustment' => $deductionFieldValues['manualCashAdvanceAdjustment'] ?? 0.0,
        'laptopLoan' => $deductionFieldValues['laptopLoan'] ?? 0.0,
        'otherDeductions' => $deductionFieldValues['otherDeductions'] ?? 0.0,
        'additionalDeductionsTotal' => $additionalDeductionTotal,
        'deductionDiagnostics' => is_array($meta['deductionDiagnostics'] ?? null) ? $meta['deductionDiagnostics'] : [],
        'grossPay' => $grossPay,
        'totalAllowance' => $totalAllowance,
        'totalDeduction' => $totalDeduction,
        'netPay' => $netPay,
        'allowanceItems' => array_map(
            static fn (array $item): array => [
                'name' => $item['name'],
                'amount' => payroll_decimal($item['amount'] ?? 0),
            ],
            $allowances
        ),
        'deductionItems' => $deductionItems,
        'approvalHistory' => payroll_fetch_approval_history($pdo, $payrollId),
        'isArchived' => $status === 'Archived',
        'isEditable' => in_array($status, PAYROLL_EDITABLE_STATUSES, true),
    ];
}

function payroll_fetch_record(PDO $pdo, int $payrollId): ?array
{
    $statement = $pdo->prepare(payroll_base_query() . ' WHERE p.payroll_id = :payroll_id LIMIT 1');
    $statement->execute([':payroll_id' => $payrollId]);
    $row = $statement->fetch();

    return $row ? payroll_expand_record($pdo, $row) : null;
}

/**
 * Which division a caller's payroll view is confined to.
 *
 * A chief is the second desk in the approval chain, but only for their division: their registry
 * lists that division's batches and nothing else, and acting on another division is refused.
 * HR Staff and every other management, approval, and payout desk work organization-wide (null).
 * Employees are still restricted to their
 * own payroll through `$employeeRecordId` in the GET handler, so this scope never broadens payslip
 * access.
 *
 * A scoped desk with no resolvable division gets 0, which the list query turns into `1 = 0` -- an
 * empty registry rather than everybody's.
 */
function payroll_division_scope_id(PDO $pdo, array $user, string $roleKey): ?int
{
    if (!in_array($roleKey, PAYROLL_DIVISION_SCOPED_ROLES, true)) {
        return null;
    }

    $division = trimmed_text($user['division'] ?? '');

    if ($division === '') {
        return 0;
    }

    // Native prepares are on, so a placeholder cannot be reused across two markers.
    $statement = $pdo->prepare(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
           AND (name COLLATE utf8mb4_unicode_ci = :division_name OR code COLLATE utf8mb4_unicode_ci = :division_code)
         LIMIT 1'
    );
    $statement->execute([
        ':division_name' => $division,
        ':division_code' => $division,
    ]);
    $divisionId = (int)$statement->fetchColumn();

    return $divisionId > 0 ? $divisionId : 0;
}

function payroll_record_matches_division_scope(array $record, ?int $divisionScopeId): bool
{
    return $divisionScopeId === null
        || ($divisionScopeId > 0 && (int)($record['divisionId'] ?? 0) === $divisionScopeId);
}

function payroll_list_records(
    PDO $pdo,
    ?int $employeeRecordId = null,
    ?int $divisionScopeId = null
): void {
    $conditions = [];
    $params = [];

    if ($employeeRecordId !== null && $employeeRecordId > 0) {
        $conditions[] = 'p.employee_id = :employee_id';
        $params[':employee_id'] = $employeeRecordId;
    }

    if ($divisionScopeId !== null) {
        $conditions[] = $divisionScopeId > 0 ? 'e.division_id = :division_scope_id' : '1 = 0';
        if ($divisionScopeId > 0) {
            $params[':division_scope_id'] = $divisionScopeId;
        }
    }

    $sql = payroll_base_query()
        . ($conditions !== [] ? ' WHERE ' . implode(' AND ', $conditions) : '')
        . ' ORDER BY p.payroll_date DESC, p.payroll_id DESC';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    $records = [];

    foreach ($statement->fetchAll() as $row) {
        $records[] = payroll_expand_record($pdo, $row);
    }

    json_response([
        'success' => true,
        'records' => $records,
        'defaults' => payroll_default_settings($pdo),
    ]);
}

function payroll_meta_payload(array $payload, array $employee, array $totals): array
{
    return [
        'employeeId' => $employee['employeeId'] ?? null,
        'employeeName' => $employee['employeeName'] ?? null,
        // The parts too, so the register can list the name surname-first as it read at generation.
        'lastName' => $employee['lastName'] ?? null,
        'firstName' => $employee['firstName'] ?? null,
        'middleName' => $employee['middleName'] ?? null,
        'position' => $employee['position'] ?? null,
        'division' => $employee['division'] ?? null,
        'employmentType' => $employee['employmentType'] ?? null,
        'profileImage' => $employee['profileImage'] ?? null,
        'basicSalary' => payroll_decimal($employee['basicSalary'] ?? 0),
        'salaryRate' => $employee['salaryRate'] ?? null,
        'payrollType' => payroll_normalize_type($payload['payrollType'] ?? ''),
        'payPeriod' => $payload['payPeriod'],
        'startDate' => $payload['startDate'],
        'endDate' => $payload['endDate'],
        'overtimeHours' => $payload['overtimeHours'],
        'overtimeRate' => $payload['overtimeRate'],
        'hourlyRate' => $payload['hourlyRate'] ?? 0,
        'passSlipHours' => $payload['passSlipHours'] ?? 0,
        'passSlipCount' => (int)($payload['passSlipCount'] ?? 0),
        'undertimeHours' => $payload['undertimeHours'] ?? 0,
        'lateHours' => $payload['lateHours'] ?? 0,
        'absenceDays' => $payload['absenceDays'] ?? 0,
        'attendanceRenderedMinutes' => $payload['attendanceRenderedMinutes'] ?? 0,
        'attendanceLateMinutes' => $payload['attendanceLateMinutes'] ?? 0,
        'attendanceUndertimeMinutes' => $payload['attendanceUndertimeMinutes'] ?? 0,
        'attendanceExpectedWorkdays' => $payload['attendanceExpectedWorkdays'] ?? 0,
        'attendanceLeaveDays' => $payload['attendanceLeaveDays'] ?? 0,
        'hasAttendanceCoverage' => (bool)($payload['hasAttendanceCoverage'] ?? false),
        'withholdingTaxBase' => $payload['withholdingTaxBase'] ?? payroll_decimal($employee['basicSalary'] ?? 0),
        'overtimePay' => $payload['overtimePay'],
        'allowanceItems' => array_values(array_filter(
            array_map(
                static fn (array $item): array => [
                    'name' => (string)$item['name'],
                    'amount' => payroll_decimal($item['amount'] ?? 0),
                ],
                payroll_allowance_items($payload)
            ),
            static fn (array $item): bool => payroll_decimal($item['amount'] ?? 0) > 0
        )),
        'sss' => $payload['sss'] ?? 0,
        'additionalDeductionsTotal' => $payload['additionalDeductionsTotal'] ?? 0,
        'deductionDiagnostics' => $payload['deductionDiagnostics'] ?? [],
        'notes' => $payload['notes'],
        'totals' => $totals,
    ];
}

function payroll_action_record_id(array $body): int
{
    return (int)($body['id'] ?? $body['payrollId'] ?? 0);
}

function payroll_action_ids(array $body): array
{
    $ids = $body['payrollIds'] ?? $body['ids'] ?? [];

    if (!is_array($ids)) {
        return [];
    }

    return array_values(array_unique(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0)));
}

function payroll_period_text(array $record): string
{
    $payPeriod = payroll_text($record['payPeriod'] ?? '');
    $startDate = payroll_text($record['startDate'] ?? '');
    $endDate = payroll_text($record['endDate'] ?? $record['payrollDate'] ?? '');

    if ($payPeriod !== '') {
        return $payPeriod . ($startDate !== '' || $endDate !== '' ? ' (' . ($startDate !== '' ? $startDate : 'N/A') . ' to ' . ($endDate !== '' ? $endDate : 'N/A') . ')' : '');
    }

    return trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
}

/**
 * How a payroll that just landed in `$status` should be announced, and to whom.
 *
 * The chain hands the batch to a different desk at every rung, so the audience follows the new
 * status rather than the action: only the role that now has to act is told it is waiting, while
 * the desks it already passed get the same note for their records.
 */
function payroll_stage_notice(string $status): array
{
    return match (payroll_normalize_status($status)) {
        PAYROLL_HR_HEAD_STATUS => [
            'title' => 'Payroll Submitted for Approval',
            'summary' => 'is awaiting HR Head approval',
            'approvers' => ['admin', 'hrhead'],
            'observers' => ['hrstaff'],
        ],
        PAYROLL_CHIEF_STATUS => [
            'title' => 'Payroll Awaiting Chief Admin Approval',
            'summary' => 'was approved by the HR Head and is awaiting Chief Admin approval',
            'approvers' => ['chiefadmin'],
            'observers' => ['admin', 'hrhead', 'hrstaff'],
        ],
        PAYROLL_DIRECTOR_STATUS => [
            'title' => 'Payroll Awaiting Final Approval',
            'summary' => 'was approved by the Chief Admin and is awaiting Regional Director final approval',
            'approvers' => ['regionaldirector'],
            'observers' => ['admin', 'hrhead', 'hrstaff', 'chiefadmin'],
        ],
        'Approved' => [
            'title' => 'Payroll Approved',
            'summary' => 'has received final approval from the Regional Director',
            'approvers' => ['admin', 'finance', 'cashier'],
            'observers' => ['chiefadmin', 'regionaldirector'],
        ],
        default => [
            'title' => 'Payroll Updated',
            'summary' => 'was updated',
            'approvers' => ['admin', 'hrhead', 'hrstaff'],
            'observers' => [],
        ],
    };
}

/**
 * Whether the audience for this transition is decided by the status it landed in rather than by
 * the action name. Submitting and approving both walk the chain; rejecting, paying and archiving
 * always end up in front of the same HR audience.
 */
function payroll_is_chain_action(string $action): bool
{
    return in_array($action, ['Submitted', 'Approved'], true);
}

/**
 * The one payroll notice an employee receives: their pay has gone out. The approval chain
 * (submitted, awaiting chief admin, final approval, approved) is HR's business and stays with the
 * roles in payroll_stage_notice(); the employee only needs to know when the money is there.
 */
function payroll_notify_employee_paid(PDO $pdo, array $record): void
{
    $employeeRecordId = (int)($record['employeeRecordId'] ?? 0);
    if ($employeeRecordId <= 0) {
        return;
    }

    $periodText = payroll_period_text($record);
    $periodSuffix = $periodText !== '' ? ' for ' . $periodText : '';
    $netPay = number_format(payroll_decimal($record['netPay'] ?? 0), 2);

    notify_employee(
        $pdo,
        $employeeRecordId,
        'Payroll Paid',
        "Your payroll{$periodSuffix} has been paid. Net pay: PHP {$netPay}. Open your payslip to see the breakdown.",
        'payroll_paid',
        (string)($record['id'] ?? '')
    );
}

function payroll_notify_status_change(PDO $pdo, array $record, string $action, ?string $comments = null, bool $notifyRoles = true): void
{
    try {
        $payrollId = (int)($record['id'] ?? 0);
        $employeeName = payroll_text($record['employeeName'] ?? 'the employee') ?: 'the employee';
        $periodText = payroll_period_text($record);
        $periodSuffix = $periodText !== '' ? ' for ' . $periodText : '';
        $commentSuffix = payroll_nullable_text($comments) !== null ? ' Comment: ' . payroll_text($comments) : '';

        $isChainAction = payroll_is_chain_action($action);
        $stage = payroll_stage_notice($record['status'] ?? '');

        $title = $isChainAction ? $stage['title'] : match ($action) {
            'Rejected' => 'Payroll Returned for Correction',
            'Paid' => 'Payroll Paid',
            'Archived' => 'Payroll Archived',
            'Restored' => 'Payroll Restored',
            default => 'Payroll Updated',
        };

        $message = $isChainAction
            ? "Payroll for {$employeeName}{$periodSuffix} {$stage['summary']}.{$commentSuffix}"
            : match ($action) {
                'Rejected' => "Payroll for {$employeeName}{$periodSuffix} was returned to HR Staff for correction.{$commentSuffix}",
                'Paid' => "Payroll for {$employeeName}{$periodSuffix} has been marked as paid.",
                'Archived' => "Payroll for {$employeeName}{$periodSuffix} has been archived.",
                'Restored' => "Payroll for {$employeeName}{$periodSuffix} has been restored.",
                default => "Payroll for {$employeeName}{$periodSuffix} was updated.",
            };

        $type = match ($action) {
            'Submitted' => 'payroll_submitted',
            'Approved' => 'payroll_approved',
            'Rejected' => 'payroll_rejected',
            'Paid' => 'payroll_paid',
            default => 'system_alert',
        };

        if ($notifyRoles) {
            if ($isChainAction) {
                notify_roles($pdo, $stage['approvers'], $title, $message, $type, (string)$payrollId);

                if ($stage['observers'] !== []) {
                    notify_roles($pdo, $stage['observers'], $title, $message, $type, (string)$payrollId);
                }
            } else {
                notify_roles($pdo, ['admin', 'hrhead', 'hrstaff'], $title, $message, $type, (string)$payrollId);
            }
        }

        if ($action === 'Paid') {
            payroll_notify_employee_paid($pdo, $record);
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll status notification error: ' . $notificationException->getMessage());
    }
}

/**
 * Emit a single aggregated staff notification for a batch of payroll records that
 * transitioned together (approve / mark paid / submit / archive on a registry),
 * instead of one notification per employee. The message carries the employee list
 * and totals so the notification "View" shows the full registry breakdown.
 */
function payroll_notify_bulk_status_change(PDO $pdo, array $records, string $action, ?string $comments = null): void
{
    try {
        $records = array_values(array_filter($records, static fn ($record): bool => is_array($record)));
        $count = count($records);

        if ($count === 0) {
            return;
        }

        $isChainAction = payroll_is_chain_action($action);
        $stage = payroll_stage_notice($records[0]['status'] ?? '');

        $title = $isChainAction ? $stage['title'] : match ($action) {
            'Rejected' => 'Payroll Returned for Correction',
            'Paid' => 'Payroll Paid',
            'Archived' => 'Payroll Archived',
            'Restored' => 'Payroll Restored',
            default => 'Payroll Updated',
        };

        $type = match ($action) {
            'Submitted' => 'payroll_submitted',
            'Approved' => 'payroll_approved',
            'Rejected' => 'payroll_rejected',
            'Paid' => 'payroll_paid',
            default => 'system_alert',
        };

        // The stage summaries carry their own verb ("is awaiting...", "was approved by..."), so the
        // sentence below is built without one and the fixed actions supply theirs here.
        $actionText = $isChainAction ? $stage['summary'] : match ($action) {
            'Rejected' => 'has been returned to HR Staff for correction',
            'Paid' => 'has been marked as paid',
            'Archived' => 'has been archived',
            'Restored' => 'has been restored',
            default => 'has been updated',
        };

        $payrollIds = [];
        $divisions = [];
        $totalNet = 0.0;

        foreach ($records as $record) {
            $id = (int)($record['id'] ?? 0);
            if ($id > 0) {
                $payrollIds[] = $id;
            }

            $division = payroll_text($record['division'] ?? '');
            if ($division !== '') {
                $divisions[$division] = true;
            }

            $totalNet += payroll_decimal($record['netPay'] ?? 0);
        }

        sort($payrollIds);
        $firstId = $payrollIds[0] ?? 0;
        $lastId = $payrollIds !== [] ? $payrollIds[count($payrollIds) - 1] : 0;
        $registryId = '';
        if ($firstId > 0) {
            $registryId = $firstId === $lastId
                ? 'PR-' . str_pad((string)$firstId, 4, '0', STR_PAD_LEFT)
                : 'PR-' . str_pad((string)$firstId, 4, '0', STR_PAD_LEFT) . '-' . str_pad((string)$lastId, 4, '0', STR_PAD_LEFT);
        }

        $divisionText = count($divisions) === 1 ? (string)array_key_first($divisions) : (count($divisions) . ' divisions');
        $periodText = payroll_period_text($records[0]);
        $commentSuffix = payroll_nullable_text($comments) !== null ? "\nComment: " . payroll_text($comments) : '';

        $header = sprintf(
            '%s%s%s %s. %d employee%s, total net pay PHP %s.',
            $registryId !== '' ? 'Registry ' . $registryId . ' — ' : '',
            $divisionText !== '' ? $divisionText : 'Payroll',
            $periodText !== '' ? ' (' . $periodText . ')' : '',
            $actionText,
            $count,
            $count === 1 ? '' : 's',
            number_format($totalNet, 2)
        );

        $limit = 40;
        $lines = [];
        foreach (array_slice($records, 0, $limit) as $index => $record) {
            $lines[] = sprintf(
                '%d. %s — PHP %s',
                $index + 1,
                payroll_text($record['employeeName'] ?? 'Employee') ?: 'Employee',
                number_format(payroll_decimal($record['netPay'] ?? 0), 2)
            );
        }

        if ($count > $limit) {
            $lines[] = sprintf('...and %d more.', $count - $limit);
        }

        $message = $header . "\n\nEmployees:\n" . implode("\n", $lines) . $commentSuffix;

        if ($isChainAction) {
            notify_roles($pdo, $stage['approvers'], $title, $message, $type, $registryId);

            if ($stage['observers'] !== []) {
                notify_roles($pdo, $stage['observers'], $title, $message, $type, $registryId);
            }
        } else {
            notify_roles($pdo, ['admin', 'hrhead', 'hrstaff'], $title, $message, $type, $registryId);
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll bulk status notification error: ' . $notificationException->getMessage());
    }
}

/**
 * Move one payroll record to its next status.
 *
 * `$targetStatus` is a plain status for transitions that always land in the same place, or a
 * current-status => next-status map for the approval chain, where where the batch goes depends on
 * which desk it is sitting on. When a map is given, its keys are the allowed current statuses.
 */
function payroll_transition_status(
    PDO $pdo,
    int $payrollId,
    array $actorUser,
    string|array $targetStatus,
    string $action,
    array $allowedCurrentStatuses,
    ?string $comments = null,
    bool $notifyRoles = true
): array {
    if ($payrollId <= 0) {
        return [
            'success' => false,
            'statusCode' => 422,
            'message' => 'Payroll record is required.',
        ];
    }

    $record = payroll_fetch_record($pdo, $payrollId);

    if ($record === null) {
        return [
            'success' => false,
            'statusCode' => 404,
            'message' => 'Payroll record not found.',
        ];
    }

    $divisionScopeId = payroll_division_scope_id($pdo, $actorUser, payroll_workflow_role_key($actorUser));
    if (!payroll_record_matches_division_scope($record, $divisionScopeId)) {
        return [
            'success' => false,
            'statusCode' => 403,
            'message' => 'You can only act on payroll records for your division.',
        ];
    }

    $currentStatus = payroll_normalize_status($record['status'] ?? '');
    $allowedStatuses = array_map('payroll_normalize_status', $allowedCurrentStatuses);

    if (!in_array($currentStatus, $allowedStatuses, true)) {
        // Naming the status the record is actually in, rather than the ones this actor handles:
        // an approver told "payroll must be Pending Chief Admin Approval" cannot tell whether the batch
        // has not reached them yet or has already moved past them.
        return [
            'success' => false,
            'statusCode' => 422,
            'message' => sprintf(
                'This payroll is %s, so it cannot be %s at this stage.',
                payroll_status_label($currentStatus),
                strtolower($action)
            ),
        ];
    }

    if (is_array($targetStatus)) {
        $resolvedTarget = $targetStatus[$currentStatus] ?? null;

        if ($resolvedTarget === null) {
            return [
                'success' => false,
                'statusCode' => 422,
                'message' => sprintf(
                    'Payroll is %s and is not waiting on you.',
                    payroll_status_label($currentStatus)
                ),
            ];
        }

        $targetStatus = $resolvedTarget;
    }

    $targetStatus = payroll_normalize_status($targetStatus);

    if ($targetStatus === 'Paid') {
        // Schema work must happen before the transaction because MySQL commits around DDL.
        payroll_ensure_loan_tracking_schema($pdo);
    }

    /*
     * Marking paid is the Cashier's release, so the row keeps the moment and the desk that made it:
     * the Released Payroll report (reports.php) lists a batch by the day the money went out, not by
     * the pay period it covered. Restoring an archived Paid batch lands on the same status through
     * the `Restored` action and leaves the original stamp alone.
     */
    $isRelease = $targetStatus === 'Paid' && $action === 'Paid';

    try {
        $pdo->beginTransaction();

        $statement = $pdo->prepare(
            'UPDATE payroll
             SET status = :status'
            . ($isRelease ? ', released_at = :released_at, released_by = :released_by' : '')
            . ' WHERE payroll_id = :payroll_id'
        );
        $statement->execute(array_merge(
            [
                ':status' => $targetStatus,
                ':payroll_id' => $payrollId,
            ],
            $isRelease
                ? [
                    ':released_at' => date('Y-m-d H:i:s'),
                    ':released_by' => (int)($actorUser['id'] ?? 0) > 0 ? (int)$actorUser['id'] : null,
                ]
                : []
        ));

        payroll_record_approval_action($pdo, $payrollId, $actorUser, $action, $comments, $currentStatus, $targetStatus);

        if ($targetStatus === 'Paid') {
            payroll_record_paid_loan_deductions(
                $pdo,
                $payrollId,
                is_array($record['deductionItems'] ?? null) ? $record['deductionItems'] : [],
                payroll_date_or_null($record['endDate'] ?? $record['payrollDate'] ?? date('Y-m-d'))
            );
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $updatedRecord = payroll_fetch_record($pdo, $payrollId);
    if ($updatedRecord !== null) {
        payroll_notify_status_change($pdo, $updatedRecord, $action, $comments, $notifyRoles);
    }

    return [
        'success' => true,
        'message' => match (true) {
            $action === 'Submitted' => 'Payroll submitted to the HR Head for approval.',
            $action === 'Approved' => match ($targetStatus) {
                PAYROLL_CHIEF_STATUS => 'Payroll approved and forwarded to the Chief Admin.',
                PAYROLL_DIRECTOR_STATUS => 'Payroll approved and forwarded to the Regional Director for final approval.',
                default => 'Payroll approved successfully.',
            },
            $action === 'Rejected' => 'Payroll returned to HR Staff for correction.',
            $action === 'Paid' => 'Payroll marked as paid.',
            $action === 'Archived' => 'Payroll archived successfully.',
            $action === 'Restored' => 'Payroll restored successfully.',
            default => 'Payroll status updated.',
        },
        'record' => $updatedRecord,
    ];
}

function payroll_transition_json_response(array $result): void
{
    if (!($result['success'] ?? false)) {
        json_response([
            'success' => false,
            'message' => $result['message'] ?? 'Unable to update payroll status.',
        ], (int)($result['statusCode'] ?? 422));
    }

    json_response([
        'success' => true,
        'message' => $result['message'] ?? 'Payroll status updated.',
        'record' => $result['record'] ?? null,
    ]);
}

/**
 * Stream one payroll registry as an .xlsx.
 *
 * The registry is identified by the payroll ids the screen has in hand, which is what keeps the
 * file and the screen in step: the same records, grouped and ordered the same way, rather than a
 * second query that could drift from what the reviewer is looking at.
 */
/**
 * The statuses a register may be exported from: the end of the approval chain, and the paid state
 * beyond it.
 *
 * Kept in step with EXPORTABLE_REGISTRY_STATUSES in module/payroll/PayrollManagementWorkspace.jsx,
 * which is what decides whether the button is drawn at all. The check is repeated here because the
 * button being hidden is a UI courtesy, not a rule -- the export is a plain GET with the ids in the
 * query string, so without this anyone could pull an unsigned register straight out of the address
 * bar and hand it round as though the Director had approved it.
 */
const PAYROLL_EXPORTABLE_STATUSES = ['Approved', 'Paid'];

function payroll_registry_export_allowed(array $records): bool
{
    foreach ($records as $record) {
        if (!in_array((string)($record['status'] ?? ''), PAYROLL_EXPORTABLE_STATUSES, true)) {
            return false;
        }
    }

    return $records !== [];
}

function payroll_export_registry(PDO $pdo, array $ids, array $actorUser): void
{
    $records = [];
    $divisionScopeId = payroll_division_scope_id($pdo, $actorUser, payroll_workflow_role_key($actorUser));

    foreach ($ids as $payrollId) {
        $record = payroll_fetch_record($pdo, $payrollId);

        if ($record !== null && payroll_record_matches_division_scope($record, $divisionScopeId)) {
            $records[] = $record;
        } elseif ($record !== null && $divisionScopeId !== null) {
            json_response([
                'success' => false,
                'message' => 'You can only export payroll records for your division.',
            ], 403);
        }
    }

    if ($records === []) {
        json_response([
            'success' => false,
            'message' => 'No payroll records were found for this registry.',
        ], 404);
    }

    /*
     * Every record, not just the first: a batch moves through the chain together, so one row still
     * waiting on a desk means the register as a whole is not final yet.
     */
    if (!payroll_registry_export_allowed($records)) {
        json_response([
            'success' => false,
            'message' => 'This payroll can only be exported once it has been approved by the Regional Director.',
        ], 409);
    }

    $first = $records[0];
    $payrollIds = array_map(static fn (array $record): int => (int)$record['id'], $records);
    sort($payrollIds);
    $firstId = $payrollIds[0];
    $lastId = $payrollIds[count($payrollIds) - 1];

    // Mirrors getRegistryId(): one padded id, or the span when the batch covers several.
    $registryId = $firstId === $lastId
        ? 'PR-' . str_pad((string)$firstId, 4, '0', STR_PAD_LEFT)
        : 'PR-' . str_pad((string)$firstId, 4, '0', STR_PAD_LEFT) . '-' . str_pad((string)$lastId, 4, '0', STR_PAD_LEFT);

    $totals = ['grossPay' => 0.0, 'deductions' => 0.0, 'netPay' => 0.0];
    $dateCreated = '';

    foreach ($records as $record) {
        $totals['grossPay'] += payroll_export_amount($record['grossPay'] ?? 0);
        $totals['deductions'] += payroll_export_amount($record['totalDeduction'] ?? 0);
        $totals['netPay'] += payroll_export_amount($record['netPay'] ?? 0);

        $recordDate = (string)($record['payrollDate'] ?? '');
        if ($recordDate > $dateCreated) {
            $dateCreated = $recordDate;
        }
    }

    $entry = [
        'registryId' => $registryId,
        // Decides the register's column text -- see payroll_export_type_labels().
        'payrollType' => payroll_normalize_type($first['payrollType'] ?? ''),
        'division' => payroll_text($first['division'] ?? '') ?: 'Unassigned',
        'periodLabel' => payroll_period_text($first),
        'startDate' => $first['startDate'] ?? '',
        'endDate' => $first['endDate'] ?? ($first['payrollDate'] ?? ''),
        'dateCreated' => $dateCreated !== '' ? $dateCreated : ($first['endDate'] ?? ''),
        'status' => payroll_status_label($first['status'] ?? ''),
        'totalGrossPay' => round($totals['grossPay'], 2),
        'totalDeductions' => round($totals['deductions'], 2),
        'totalNetPay' => round($totals['netPay'], 2),
        'records' => $records,
        // The same list the screen renders its certification from, so both are signed alike.
        'signatories' => payroll_signatories($pdo),
        'certificationStatement' => payroll_signatory_statement(),
    ];

    $sheet = payroll_export_build_register_sheet($entry, payroll_default_settings($pdo)['deductionColumns']);
    $workbook = payroll_xlsx_package($sheet, 'Payroll Register', 'Payroll Register ' . $registryId);

    if ($workbook === null) {
        json_response([
            'success' => false,
            'message' => 'Unable to generate the Excel payroll registry. Please try again or contact an administrator.',
        ], 503);
    }

    $filename = 'payroll-register-' . strtolower($registryId) . '.xlsx';

    write_auth_audit($pdo, $actorUser, 'payroll.registry_exported', 'A payroll registry was exported.', [
        'registryId' => $registryId,
        'recordCount' => count($records),
    ]);

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

function payroll_submit_for_approval(PDO $pdo, array $body, array $actorUser): void
{
    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        PAYROLL_HR_HEAD_STATUS,
        'Submitted',
        ['Draft', 'Rejected'],
        payroll_nullable_text($body['comments'] ?? null)
    ));
}

function payroll_approve(PDO $pdo, array $body, array $actorUser, string $roleKey): void
{
    $approvalMap = payroll_role_approval_map($roleKey);

    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        $approvalMap,
        'Approved',
        array_keys($approvalMap),
        payroll_nullable_text($body['comments'] ?? null)
    ));
}

/*
 * Returning for correction skips the rest of the chain: whichever desk sends a batch back, it goes
 * straight to HR Staff as an editable record, and a resubmission starts again at the HR Head.
 */
function payroll_reject(PDO $pdo, array $body, array $actorUser, string $roleKey): void
{
    $comments = payroll_nullable_text($body['comments'] ?? $body['reason'] ?? null);

    if ($comments === null) {
        json_response([
            'success' => false,
            'message' => 'Correction comments are required.',
        ], 422);
    }

    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        'Rejected',
        'Rejected',
        payroll_role_approval_stages($roleKey),
        $comments
    ));
}

function payroll_mark_paid_action(PDO $pdo, array $body, array $actorUser): void
{
    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        payroll_action_record_id($body),
        $actorUser,
        'Paid',
        'Paid',
        ['Approved'],
        payroll_nullable_text($body['comments'] ?? null)
    ));
}

function payroll_bulk_transition(
    PDO $pdo,
    array $body,
    array $actorUser,
    string|array $targetStatus,
    string $action,
    array $allowedCurrentStatuses,
    bool $commentsRequired = false
): void {
    $ids = payroll_action_ids($body);

    if ($ids === []) {
        json_response([
            'success' => false,
            'message' => 'Select at least one payroll record.',
        ], 422);
    }

    $comments = payroll_nullable_text($body['comments'] ?? $body['reason'] ?? null);
    if ($commentsRequired && $comments === null) {
        json_response([
            'success' => false,
            'message' => 'Rejection comments are required.',
        ], 422);
    }

    $records = [];
    $failed = [];

    foreach ($ids as $payrollId) {
        $result = payroll_transition_status(
            $pdo,
            $payrollId,
            $actorUser,
            $targetStatus,
            $action,
            $allowedCurrentStatuses,
            $comments,
            false
        );

        if ($result['success'] ?? false) {
            if (isset($result['record'])) {
                $records[] = $result['record'];
            }
            continue;
        }

        $failed[] = [
            'id' => $payrollId,
            'message' => $result['message'] ?? 'Unable to update payroll.',
        ];
    }

    $successCount = count($records);
    $failedCount = count($failed);

    // Send a single aggregated staff notification for the whole batch instead of
    // one per employee (which previously flooded the notification center).
    if ($successCount > 0) {
        payroll_notify_bulk_status_change($pdo, $records, $action, $comments);
    }

    json_response([
        'success' => true,
        'message' => sprintf(
            '%d %s, %d failed.',
            $successCount,
            match ($action) {
                'Submitted' => $successCount === 1 ? 'submitted' : 'submitted',
                'Approved' => $successCount === 1 ? 'approved' : 'approved',
                'Rejected' => $successCount === 1 ? 'rejected' : 'rejected',
                'Paid' => $successCount === 1 ? 'marked paid' : 'marked paid',
                'Archived' => $successCount === 1 ? 'archived' : 'archived',
                'Restored' => $successCount === 1 ? 'restored' : 'restored',
                default => $successCount === 1 ? 'updated' : 'updated',
            },
            $failedCount
        ),
        'successCount' => $successCount,
        'failedCount' => $failedCount,
        'failed' => $failed,
        'records' => $records,
    ]);
}

function payroll_bulk_restore(PDO $pdo, array $body, array $actorUser): void
{
    $ids = payroll_action_ids($body);

    if ($ids === []) {
        json_response([
            'success' => false,
            'message' => 'Select at least one payroll record to restore.',
        ], 422);
    }

    $records = [];
    $failed = [];

    foreach ($ids as $payrollId) {
        $result = payroll_restore_result($pdo, $payrollId, $actorUser, false);

        if ($result['success'] ?? false) {
            if (isset($result['record'])) {
                $records[] = $result['record'];
            }
            continue;
        }

        $failed[] = [
            'id' => $payrollId,
            'message' => $result['message'] ?? 'Unable to restore payroll.',
        ];
    }

    $successCount = count($records);
    $failedCount = count($failed);

    if ($successCount > 0) {
        payroll_notify_bulk_status_change($pdo, $records, 'Restored');
    }

    json_response([
        'success' => true,
        'message' => sprintf(
            '%d %s, %d failed.',
            $successCount,
            $successCount === 1 ? 'restored' : 'restored',
            $failedCount
        ),
        'successCount' => $successCount,
        'failedCount' => $failedCount,
        'failed' => $failed,
        'records' => $records,
    ]);
}

function payroll_create(PDO $pdo, array $body, ?int $divisionScopeId = null): void
{
    $payload = payroll_payload($pdo, $body);
    $payload['status'] = 'Draft';
    $employee = payroll_validate_payload($pdo, $payload);

    // A division-scoped desk may only generate payroll for its own division. The Generate form
    // already confines the employee list, so this only catches a request built by hand.
    if (!payroll_record_matches_division_scope($employee, $divisionScopeId)) {
        json_response([
            'success' => false,
            'message' => 'You can only generate payroll for employees in your division.',
        ], 403);
    }

    $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
    $totals = payroll_calculate_totals($payload, $employee);
    // Outside the transaction: a deduction this run names for the first time needs a catalog row
    // and a column on `payroll`, and that ALTER would implicitly commit the transaction below.
    payroll_prepare_deduction_types($pdo, payroll_deduction_items($payload));

    try {
        $pdo->beginTransaction();

        $payrollId = payroll_with_legacy_fk_bypass($pdo, static function () use ($pdo, $payload, $employee, $totals): int {
            $statement = $pdo->prepare(
                'INSERT INTO payroll
                    (employee_id, payroll_date, status, gross_pay, total_allowance, total_deduction, net_pay)
                 VALUES
                    (:employee_id, :payroll_date, :status, :gross_pay, :total_allowance, :total_deduction, :net_pay)'
            );
            $statement->execute([
                ':employee_id' => (int)$employee['id'],
                ':payroll_date' => $payload['endDate'],
                ':status' => $payload['status'],
                ':gross_pay' => payroll_decimal_string($totals['grossPay']),
                ':total_allowance' => payroll_decimal_string($totals['totalAllowance']),
                ':total_deduction' => payroll_decimal_string($totals['totalDeduction']),
                ':net_pay' => payroll_decimal_string($totals['netPay']),
            ]);

            return (int)$pdo->lastInsertId();
        });

        payroll_sync_allowances($pdo, $payrollId, payroll_allowance_items($payload));
        payroll_sync_deductions($pdo, $payrollId, payroll_deduction_items($payload));
        payroll_store_meta($pdo, $payrollId, payroll_meta_payload($payload, $employee, $totals));

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    // Expanding a record re-runs the attendance and deduction lookups for the whole period, so the
    // response below reuses this copy instead of building a second one. Generation posts one request
    // per employee, and the duplicated work was enough to push a batch past the client timeout.
    $record = null;

    try {
        $record = payroll_fetch_record($pdo, $payrollId);
        if ($record !== null) {
            $payPeriod = (string)($record['payPeriod'] ?? '');
            if ($payPeriod === '') {
                $startDate = (string)($record['startDate'] ?? '');
                $endDate = (string)($record['endDate'] ?? '');
                $payPeriod = trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
            }

            // Payroll is generated one employee at a time, so notify staff roles with a
            // generic message keyed to the pay period. The 5-minute de-duplication in
            // notification_insert() collapses the whole batch into a single staff
            // notification instead of one per employee. The employee is not told: a draft
            // is an HR working document, and they hear from payroll_notify_employee_paid()
            // once it is actually paid.
            $rolePeriodLabel = $payPeriod !== '' ? $payPeriod : 'the current pay period';
            notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Payroll Generated',
                sprintf('New payroll records for %s have been generated and are ready for review.', $rolePeriodLabel),
                'payroll_generated',
                'generated:' . $rolePeriodLabel
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll creation notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Payroll created successfully.',
        'record' => $record ?? payroll_fetch_record($pdo, $payrollId),
    ], 201);
}

function payroll_update(PDO $pdo, array $body, string $roleKey = ''): void
{
    $payrollId = (int)($body['id'] ?? 0);

    if ($payrollId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Payroll record is required.',
        ], 422);
    }

    $existing = payroll_fetch_record($pdo, $payrollId);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll record not found.',
        ], 404);
    }

    $existingStatus = payroll_normalize_status($existing['status'] ?? '');
    if (!in_array($existingStatus, payroll_editable_statuses_for_role($roleKey), true)) {
        json_response([
            'success' => false,
            'message' => 'This payroll record cannot be edited at this workflow stage.',
        ], 422);
    }

    $manualDeductionItems = payroll_manual_deduction_items_from_body($body);
    $payload = payroll_payload($pdo, $body);
    // An edit never changes what the batch pays out, and a body that omits the type would otherwise
    // silently rewrite a bonus registry into a salary one, so the stored type always wins.
    $payload['payrollType'] = payroll_normalize_type($existing['payrollType'] ?? '');
    $payload['status'] = payroll_normalize_status($payload['status']);
    if ($existingStatus === 'Rejected') {
        $payload['status'] = 'Draft';
    } elseif ($existingStatus === PAYROLL_HR_HEAD_STATUS) {
        $payload['status'] = PAYROLL_HR_HEAD_STATUS;
    } else {
        $payload['status'] = in_array($payload['status'], PAYROLL_EDITABLE_STATUSES, true)
            ? $payload['status']
            : $existingStatus;
    }
    $employee = payroll_validate_payload($pdo, $payload);
    $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
    if ($manualDeductionItems !== null) {
        $payload = payroll_apply_manual_deduction_items($payload, $manualDeductionItems);
    }
    $totals = payroll_calculate_totals($payload, $employee);
    // Outside the transaction: a deduction this run names for the first time needs a catalog row
    // and a column on `payroll`, and that ALTER would implicitly commit the transaction below.
    payroll_prepare_deduction_types($pdo, payroll_deduction_items($payload));

    try {
        $pdo->beginTransaction();

        payroll_with_legacy_fk_bypass($pdo, static function () use ($pdo, $payrollId, $payload, $employee, $totals): void {
            $statement = $pdo->prepare(
                'UPDATE payroll
                 SET employee_id = :employee_id,
                     payroll_date = :payroll_date,
                     status = :status,
                     gross_pay = :gross_pay,
                     total_allowance = :total_allowance,
                     total_deduction = :total_deduction,
                     net_pay = :net_pay
                 WHERE payroll_id = :payroll_id'
            );
            $statement->execute([
                ':employee_id' => (int)$employee['id'],
                ':payroll_date' => $payload['endDate'],
                ':status' => $payload['status'],
                ':gross_pay' => payroll_decimal_string($totals['grossPay']),
                ':total_allowance' => payroll_decimal_string($totals['totalAllowance']),
                ':total_deduction' => payroll_decimal_string($totals['totalDeduction']),
                ':net_pay' => payroll_decimal_string($totals['netPay']),
                ':payroll_id' => $payrollId,
            ]);
        });

        payroll_sync_allowances($pdo, $payrollId, payroll_allowance_items($payload));
        payroll_sync_deductions($pdo, $payrollId, payroll_deduction_items($payload));
        payroll_store_meta($pdo, $payrollId, payroll_meta_payload($payload, $employee, $totals));

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $record = payroll_fetch_record($pdo, $payrollId);
        if ($record !== null) {
            $payPeriod = (string)($record['payPeriod'] ?? '');
            if ($payPeriod === '') {
                $startDate = (string)($record['startDate'] ?? '');
                $endDate = (string)($record['endDate'] ?? '');
                $payPeriod = trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
            }

            $notificationMessage = sprintf(
                'Payroll record for %s was updated%s.',
                (string)($record['employeeName'] ?? 'the employee'),
                $payPeriod !== '' ? ' (' . $payPeriod . ')' : ''
            );

            // HR-only, like generation: the employee sees the final figures on their payslip
            // once the record is paid, not every edit on the way there.
            notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Payroll Updated',
                $notificationMessage,
                'system_alert',
                (string)$payrollId
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll update notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Payroll updated successfully.',
        'record' => payroll_fetch_record($pdo, $payrollId),
    ]);
}

function payroll_mark_paid(PDO $pdo, int $payrollId): void
{
    $record = payroll_fetch_record($pdo, $payrollId);

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll record not found.',
        ], 404);
    }

    if ($record['status'] === 'Archived') {
        json_response([
            'success' => false,
            'message' => 'Archived payroll records cannot be marked as paid.',
        ], 422);
    }

    $endDate = payroll_date_or_null($record['endDate'] ?? $record['payrollDate'] ?? null);
    $startDate = payroll_date_or_null($record['startDate'] ?? null);
    if ($startDate === null && $endDate !== null) {
        $startDate = substr($endDate, 0, 8) . '01';
    }

    $payload = [
        'employeeRecordId' => (int)($record['employeeRecordId'] ?? 0),
        'payrollType' => payroll_normalize_type($record['payrollType'] ?? ''),
        'payPeriod' => payroll_text($record['payPeriod'] ?? '') ?: 'Monthly',
        'startDate' => $startDate,
        'endDate' => $endDate,
        'overtimeHours' => payroll_decimal($record['overtimeHours'] ?? 0),
        'overtimeRate' => payroll_decimal($record['overtimeRate'] ?? 0),
        'overtimePay' => payroll_decimal($record['overtimePay'] ?? 0),
        'pera' => payroll_decimal($record['pera'] ?? 0),
        'travelAllowance' => payroll_decimal($record['travelAllowance'] ?? 0),
        'salaryAdjustment' => payroll_decimal($record['salaryAdjustment'] ?? 0),
        'otherAllowances' => payroll_decimal($record['otherAllowances'] ?? 0),
        'bonusAmount' => payroll_decimal($record['bonusAmount'] ?? 0),
        'lateDeduction' => payroll_decimal($record['lateDeduction'] ?? 0),
        'absenceDeduction' => payroll_decimal($record['absenceDeduction'] ?? 0),
        'undertimeDeduction' => payroll_decimal($record['undertimeDeduction'] ?? 0),
        'withholdingTax' => payroll_decimal($record['withholdingTax'] ?? 0),
        'sss' => payroll_decimal($record['sss'] ?? 0),
        'gsis' => payroll_decimal($record['gsis'] ?? 0),
        'hdmf' => payroll_decimal($record['hdmf'] ?? 0),
        'phic' => payroll_decimal($record['phic'] ?? 0),
        'manualCashAdvanceAdjustment' => payroll_decimal($record['manualCashAdvanceAdjustment'] ?? 0),
        'laptopLoan' => payroll_decimal($record['laptopLoan'] ?? 0),
        'otherDeductions' => payroll_decimal($record['otherDeductions'] ?? 0),
        'status' => 'Paid',
        'notes' => payroll_nullable_text($record['notes'] ?? null),
    ];
    $employee = payroll_validate_payload($pdo, $payload);
    $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
    $totals = payroll_calculate_totals($payload, $employee);
    // Outside the transaction: a deduction this run names for the first time needs a catalog row
    // and a column on `payroll`, and that ALTER would implicitly commit the transaction below.
    payroll_prepare_deduction_types($pdo, payroll_deduction_items($payload));

    try {
        $pdo->beginTransaction();

        payroll_with_legacy_fk_bypass($pdo, static function () use ($pdo, $payrollId, $payload, $employee, $totals): void {
            $statement = $pdo->prepare(
                'UPDATE payroll
                 SET employee_id = :employee_id,
                     payroll_date = :payroll_date,
                     status = :status,
                     gross_pay = :gross_pay,
                     total_allowance = :total_allowance,
                     total_deduction = :total_deduction,
                     net_pay = :net_pay
                 WHERE payroll_id = :payroll_id'
            );
            $statement->execute([
                ':employee_id' => (int)$employee['id'],
                ':payroll_date' => $payload['endDate'],
                ':status' => 'Paid',
                ':gross_pay' => payroll_decimal_string($totals['grossPay']),
                ':total_allowance' => payroll_decimal_string($totals['totalAllowance']),
                ':total_deduction' => payroll_decimal_string($totals['totalDeduction']),
                ':net_pay' => payroll_decimal_string($totals['netPay']),
                ':payroll_id' => $payrollId,
            ]);
        });

        payroll_sync_allowances($pdo, $payrollId, payroll_allowance_items($payload));
        payroll_sync_deductions($pdo, $payrollId, payroll_deduction_items($payload));
        payroll_store_meta($pdo, $payrollId, payroll_meta_payload($payload, $employee, $totals));

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        $record = payroll_fetch_record($pdo, $payrollId);
        if ($record !== null) {
            $payPeriod = (string)($record['payPeriod'] ?? '');
            if ($payPeriod === '') {
                $startDate = (string)($record['startDate'] ?? '');
                $endDate = (string)($record['endDate'] ?? '');
                $payPeriod = trim($startDate . ($endDate !== '' ? ' to ' . $endDate : ''));
            }

            $notificationMessage = sprintf(
                'Payroll for %s has been marked as paid%s.',
                (string)($record['employeeName'] ?? 'the employee'),
                $payPeriod !== '' ? ' (' . $payPeriod . ')' : ''
            );

            notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Payroll Paid',
                $notificationMessage,
                'system_alert',
                (string)$payrollId
            );

            payroll_notify_employee_paid($pdo, $record);
        }
    } catch (Throwable $notificationException) {
        error_log('Payroll paid notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Payroll marked as paid.',
        'record' => payroll_fetch_record($pdo, $payrollId),
    ]);
}

function payroll_archive(PDO $pdo, int $payrollId, array $actorUser): void
{
    payroll_transition_json_response(payroll_transition_status(
        $pdo,
        $payrollId,
        $actorUser,
        'Archived',
        'Archived',
        PAYROLL_ACTIVE_STATUSES
    ));
}

function payroll_restore_target_status(PDO $pdo, int $payrollId): string
{
    payroll_ensure_approval_schema($pdo);
    $history = array_reverse(payroll_fetch_approval_history($pdo, $payrollId));

    foreach ($history as $entry) {
        $fromStatus = payroll_normalize_status($entry['fromStatus'] ?? '');
        if (
            payroll_normalize_status($entry['action'] ?? '') === 'Archived'
            && payroll_normalize_status($entry['toStatus'] ?? '') === 'Archived'
            && in_array($fromStatus, PAYROLL_ACTIVE_STATUSES, true)
        ) {
            return $fromStatus;
        }
    }

    foreach ($history as $entry) {
        $status = payroll_normalize_status($entry['toStatus'] ?? '');
        if ($status !== 'Archived' && in_array($status, PAYROLL_ACTIVE_STATUSES, true)) {
            return $status;
        }
    }

    return 'Draft';
}

function payroll_restore_result(PDO $pdo, int $payrollId, array $actorUser, bool $notifyRoles = true): array
{
    return payroll_transition_status(
        $pdo,
        $payrollId,
        $actorUser,
        payroll_restore_target_status($pdo, $payrollId),
        'Restored',
        ['Archived'],
        null,
        $notifyRoles
    );
}

function payroll_restore(PDO $pdo, int $payrollId, array $actorUser): void
{
    payroll_transition_json_response(payroll_restore_result($pdo, $payrollId, $actorUser));
}

function payroll_preview(PDO $pdo, array $body): void
{
    $employeeIds = $body['employeeIds'] ?? $body['employeeRecordIds'] ?? [];
    if (!is_array($employeeIds)) {
        $employeeIds = [];
    }

    $payPeriod = payroll_text($body['payPeriod'] ?? '');
    $payrollType = payroll_normalize_type($body['payrollType'] ?? '');
    $startDate = payroll_date_or_null($body['startDate'] ?? null);
    $endDate = payroll_date_or_null($body['endDate'] ?? null);
    $records = [];
    $errors = [];

    foreach (array_values(array_unique(array_map('intval', $employeeIds))) as $employeeRecordId) {
        if ($employeeRecordId <= 0) {
            continue;
        }

        $payload = [
            'employeeRecordId' => $employeeRecordId,
            'payrollType' => $payrollType,
            'payPeriod' => $payPeriod,
            'startDate' => $startDate,
            'endDate' => $endDate,
            'overtimeHours' => 0.0,
            'overtimeRate' => 0.0,
            'overtimePay' => 0.0,
            'pera' => payroll_lookup_allowance_amount($pdo, 'PERA', PAYROLL_DEFAULT_PERA_AMOUNT),
            'travelAllowance' => 0.0,
            'salaryAdjustment' => 0.0,
            'otherAllowances' => 0.0,
            'bonusAmount' => 0.0,
            'lateDeduction' => 0.0,
            'absenceDeduction' => 0.0,
            'undertimeDeduction' => 0.0,
            'withholdingTax' => 0.0,
            'sss' => 0.0,
            'gsis' => 0.0,
            'hdmf' => 0.0,
            'phic' => 0.0,
            'manualCashAdvanceAdjustment' => 0.0,
            'laptopLoan' => 0.0,
            'otherDeductions' => 0.0,
            'additionalDeductionItems' => [],
            'additionalDeductionsTotal' => 0.0,
            'deductionDiagnostics' => [],
            'status' => 'Draft',
            'notes' => null,
        ];

        try {
            $employee = payroll_validate_payload($pdo, $payload);
            $payload = payroll_apply_automatic_calculations($pdo, $payload, $employee);
            $totals = payroll_calculate_totals($payload, $employee);
            $deductionItems = payroll_deduction_items($payload);

            $records[] = [
                'employeeRecordId' => (int)$employee['id'],
                'employeeId' => $employee['employeeId'] ?? null,
                'employeeName' => $employee['employeeName'] ?? null,
                'position' => $employee['position'] ?? null,
                'division' => $employee['division'] ?? null,
                'basicSalary' => payroll_decimal($employee['basicSalary'] ?? 0),
                'grossPay' => $totals['grossPay'],
                'totalDeduction' => $totals['totalDeduction'],
                'netPay' => $totals['netPay'],
                'lateDeduction' => $payload['lateDeduction'],
                'absenceDeduction' => $payload['absenceDeduction'],
                'undertimeDeduction' => $payload['undertimeDeduction'],
                'withholdingTax' => $payload['withholdingTax'],
                'sss' => $payload['sss'] ?? 0,
                'gsis' => $payload['gsis'],
                'hdmf' => $payload['hdmf'],
                'phic' => $payload['phic'],
                'manualCashAdvanceAdjustment' => $payload['manualCashAdvanceAdjustment'],
                'laptopLoan' => $payload['laptopLoan'],
                'otherDeductions' => $payload['otherDeductions'],
                'additionalDeductionsTotal' => $payload['additionalDeductionsTotal'] ?? 0,
                'deductionItems' => array_values(array_filter(
                    array_map(
                        static fn (array $item): array => [
                            'name' => $item['name'] ?? '',
                            'category' => $item['category'] ?? (PAYROLL_DEDUCTION_CATEGORY_MAP[$item['name'] ?? ''] ?? 'Deductions'),
                            'amount' => payroll_decimal($item['amount'] ?? 0),
                        ],
                        $deductionItems
                    ),
                    static fn (array $item): bool => payroll_decimal($item['amount'] ?? 0) > 0
                )),
                'deductionDiagnostics' => $payload['deductionDiagnostics'] ?? [],
            ];
        } catch (Throwable $exception) {
            $errors[] = [
                'employeeRecordId' => $employeeRecordId,
                'message' => $exception->getMessage(),
            ];
            payroll_log_deduction_debug('Preview calculation failed.', [
                'employeeRecordId' => $employeeRecordId,
                'error' => $exception->getMessage(),
            ]);
        }
    }

    json_response([
        'success' => true,
        'records' => $records,
        'errors' => $errors,
    ]);
}

payroll_ensure_deduction_engine_schema($pdo);
payroll_ensure_approval_schema($pdo);
ensure_payroll_embedded_detail_columns($pdo);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $payrollId = (int)($_GET['id'] ?? 0);
    $employeeRecordId = null;
    $divisionScopeId = payroll_division_scope_id($pdo, $sessionUser, $workflowRoleKey);

    /*
     * Exporting the register is a payroll-management action, so it follows the same role gate as
     * the rest of the workspace rather than being open to every signed-in employee.
     */
    if (payroll_text($_GET['action'] ?? '') === 'export_registry') {
        if (!payroll_is_staff_role($workflowRoleKey) && !payroll_is_approval_role($workflowRoleKey) && !in_array($exactRoleKey, PAYROLL_PAYOUT_ROLES, true)) {
            json_response([
                'success' => false,
                'message' => 'You are not allowed to export payroll records.',
            ], 403);
        }

        $exportIds = array_values(array_filter(array_map(
            static fn (string $value): int => (int)trim($value),
            explode(',', payroll_text($_GET['ids'] ?? ''))
        ), static fn (int $value): bool => $value > 0));

        if ($exportIds === []) {
            json_response([
                'success' => false,
                'message' => 'Select a payroll registry to export.',
            ], 422);
        }

        payroll_export_registry($pdo, $exportIds, $sessionUser);
    }

    if ($roleKey === 'employee') {
        $employeeRecordId = session_employee_record_id($pdo, $sessionUser);

        if ($employeeRecordId === null || $employeeRecordId <= 0) {
            json_response([
                'success' => false,
                'message' => 'Your account is not linked to an employee payroll profile.',
            ], 403);
        }
    }

    if ($payrollId > 0) {
        $record = payroll_fetch_record($pdo, $payrollId);

        if ($record === null) {
            json_response([
                'success' => false,
                'message' => 'Payroll record not found.',
            ], 404);
        }

        if ($roleKey === 'employee' && (int)($record['employeeRecordId'] ?? 0) !== (int)$employeeRecordId) {
            json_response([
                'success' => false,
                'message' => 'You can only view your own payroll records.',
            ], 403);
        }

        if (!payroll_record_matches_division_scope($record, $divisionScopeId)) {
            json_response([
                'success' => false,
                'message' => 'You can only view payroll records for your division.',
            ], 403);
        }

        json_response([
            'success' => true,
            'record' => $record,
            'defaults' => payroll_default_settings($pdo),
        ]);
    }

    payroll_list_records($pdo, $employeeRecordId, $divisionScopeId);
}

$body = read_json_body();
$action = payroll_text($_GET['action'] ?? $body['action'] ?? '');

if ($method === 'POST') {
    if ($action === 'preview') {
        payroll_require_staff_role($workflowRoleKey);
        payroll_preview($pdo, $body);
    }

    /*
     * Step one of the two-step check on submitting, approving, and releasing payslips. It is a
     * request for a code, not a transition: nothing is written, and the role gate plus the captcha
     * behind it are what stop it being used to post mail at someone.
     */
    if ($action === 'request_workflow_otp') {
        payroll_request_workflow_otp($pdo, $body, $sessionUser, $workflowRoleKey, $exactRoleKey);
    }

    /*
     * The role gate runs before the security check on all the transitions below. Someone who is not
     * allowed to approve should be told that, not handed a sum to solve first -- and a caller with no
     * business here never gets to spend a challenge or a code.
     *
     * Submitting and approving carry the batch along the approval chain, while marking paid releases
     * the payslips. All three ask for the emailed code, which can only exist because a sum was already
     * solved to send it.
     */
    if ($action === 'submit_for_approval') {
        payroll_require_staff_role($workflowRoleKey);
        payroll_require_workflow_otp($pdo, $body, 'submit');
        payroll_submit_for_approval($pdo, $body, $sessionUser);
    }

    if ($action === 'approve') {
        payroll_require_approval_role($workflowRoleKey);
        payroll_require_workflow_otp($pdo, $body, 'approve');
        payroll_approve($pdo, $body, $sessionUser, $workflowRoleKey);
    }

    if ($action === 'reject') {
        payroll_require_approval_role($workflowRoleKey);
        payroll_reject($pdo, $body, $sessionUser, $workflowRoleKey);
    }

    if ($action === 'mark_paid') {
        payroll_require_payout_role($exactRoleKey);
        payroll_require_workflow_otp($pdo, $body, 'paid');
        payroll_mark_paid_action($pdo, $body, $sessionUser);
    }

    // The bulk twins of the two branches above. Both reach the same transitions, so both ask for the
    // same code -- otherwise the step-up would be one toolbar button away from being skipped.
    if ($action === 'bulk_submit') {
        payroll_require_staff_role($workflowRoleKey);
        payroll_require_workflow_otp($pdo, $body, 'submit');
        payroll_bulk_transition($pdo, $body, $sessionUser, PAYROLL_HR_HEAD_STATUS, 'Submitted', ['Draft', 'Rejected']);
    }

    if ($action === 'bulk_approve') {
        payroll_require_approval_role($workflowRoleKey);
        payroll_require_workflow_otp($pdo, $body, 'approve');
        $approvalMap = payroll_role_approval_map($workflowRoleKey);
        payroll_bulk_transition($pdo, $body, $sessionUser, $approvalMap, 'Approved', array_keys($approvalMap));
    }

    if ($action === 'bulk_reject') {
        payroll_require_approval_role($workflowRoleKey);
        payroll_bulk_transition(
            $pdo,
            $body,
            $sessionUser,
            'Rejected',
            'Rejected',
            payroll_role_approval_stages($workflowRoleKey),
            true
        );
    }

    if ($action === 'bulk_mark_paid') {
        payroll_require_payout_role($exactRoleKey);
        payroll_require_workflow_otp($pdo, $body, 'paid');
        payroll_bulk_transition($pdo, $body, $sessionUser, 'Paid', 'Paid', ['Approved']);
    }

    if ($action === 'bulk_archive') {
        payroll_require_archive_role($workflowRoleKey);
        payroll_bulk_transition($pdo, $body, $sessionUser, 'Archived', 'Archived', PAYROLL_ACTIVE_STATUSES);
    }

    if ($action === 'bulk_restore') {
        payroll_require_archive_role($workflowRoleKey);
        payroll_bulk_restore($pdo, $body, $sessionUser);
    }

    payroll_require_staff_role($workflowRoleKey);
    payroll_create($pdo, $body, payroll_division_scope_id($pdo, $sessionUser, $workflowRoleKey));
}

if ($method === 'PUT') {
    $action = $action !== '' ? $action : 'update';
    $payrollId = (int)($body['id'] ?? 0);

    // The PUT twin of the POST branch above. Both reach payroll_mark_paid_action(), so both are
    // gated -- otherwise the check would be one HTTP verb away from being skipped.
    if ($action === 'mark_paid') {
        payroll_require_payout_role($exactRoleKey);
        payroll_require_workflow_otp($pdo, $body, 'paid');
        payroll_mark_paid_action($pdo, $body, $sessionUser);
    }

    if ($action === 'archive') {
        payroll_require_archive_role($workflowRoleKey);
        payroll_archive($pdo, $payrollId, $sessionUser);
    }

    if ($action === 'restore') {
        payroll_require_archive_role($workflowRoleKey);
        payroll_restore($pdo, $payrollId, $sessionUser);
    }

    payroll_require_staff_role($workflowRoleKey);
    payroll_update($pdo, $body, $workflowRoleKey);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
