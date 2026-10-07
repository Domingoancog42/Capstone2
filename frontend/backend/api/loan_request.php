<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/deduction-catalog.php';

$sessionUser = require_session_user();

const LOAN_REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected'];
const LOAN_RECORDS_TABLE = 'loan_records';

function loan_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function loan_decimal(mixed $value): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return 0.0;
    }

    return round((float)$value, 2);
}

function loan_interest_method(mixed $value): string
{
    $method = strtolower(loan_text($value));

    return in_array($method, ['flat', 'diminishing'], true) ? $method : 'flat';
}

function loan_term_months(mixed $value): int
{
    $text = loan_text($value);

    if (preg_match('/(\d+)/', $text, $matches) !== 1) {
        return 0;
    }

    return max(0, min(360, (int)$matches[1]));
}

function loan_monthly_amortization(float $principal, float $annualRate, int $termMonths, string $method): float
{
    if ($principal <= 0 || $termMonths <= 0) {
        return 0.0;
    }

    if ($method === 'diminishing' && $annualRate > 0) {
        $monthlyRate = ($annualRate / 100) / 12;
        $factor = pow(1 + $monthlyRate, $termMonths);
        return round($principal * $monthlyRate * $factor / ($factor - 1), 2);
    }

    $interest = $principal * ($annualRate / 100) * ($termMonths / 12);
    return round(($principal + $interest) / $termMonths, 2);
}

function loan_total_payable(float $principal, float $annualRate, int $termMonths, string $method): float
{
    if ($principal <= 0 || $termMonths <= 0) {
        return round(max(0, $principal), 2);
    }

    if ($method === 'diminishing') {
        return round(loan_monthly_amortization($principal, $annualRate, $termMonths, $method) * $termMonths, 2);
    }

    return round($principal + ($principal * ($annualRate / 100) * ($termMonths / 12)), 2);
}

function loan_date_or_null(mixed $value): ?string
{
    $text = loan_text($value);

    if ($text === '') {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', $text);

    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function loan_status(mixed $value): string
{
    $status = loan_text($value);

    foreach (LOAN_REQUEST_STATUSES as $allowedStatus) {
        if (strcasecmp($status, $allowedStatus) === 0) {
            return $allowedStatus;
        }
    }

    return 'Pending';
}

function loan_type(mixed $value): string
{
    $type = loan_text($value);
    return $type !== '' && strlen($type) <= 100 ? $type : '';
}

function loan_type_from_allowed(mixed $value, array $allowedTypes): string
{
    $type = loan_type($value);

    foreach ($allowedTypes as $allowedType) {
        if (strcasecmp($type, (string)$allowedType) === 0) {
            return (string)$allowedType;
        }
    }

    return '';
}

/**
 * Loans filed here are MGB Coop loans. The GSIS, Pag-IBIG and bank loans in Deduction Setup are
 * still charged by payroll, but they are not offered here: a Deduction Setup loan is a coop loan when
 * its name or code says so.
 */
function loan_type_is_coop(array $type): bool
{
    return str_contains(strtolower($type['name'] . ' ' . $type['code']), 'coop');
}

function loan_type_definitions(PDO $pdo): array
{
    return array_map(
        static fn (array $type): array => [
            'id' => $type['id'],
            'typeName' => $type['name'],
            'description' => $type['description'],
            'defaultRate' => $type['defaultRate'],
            'categoryCode' => $type['categoryCode'],
            'categoryLabel' => $type['categoryName'],
        ],
        array_values(array_filter(deduction_catalog_loan_types($pdo), 'loan_type_is_coop'))
    );
}

function loan_request_types(PDO $pdo): array
{
    return array_column(loan_type_definitions($pdo), 'typeName');
}

function loan_amount_map(
    mixed $value,
    string $fallbackType = '',
    float $fallbackAmount = 0.0,
    ?array $allowedTypes = null
): array
{
    if (is_string($value) && loan_text($value) !== '') {
        $decoded = json_decode($value, true);
        $value = is_array($decoded) ? $decoded : [];
    }

    $amounts = [];
    if (is_array($value)) {
        foreach ($value as $type => $amountValue) {
            $normalizedType = $allowedTypes === null
                ? loan_type($type)
                : loan_type_from_allowed($type, $allowedTypes);
            $amount = loan_decimal($amountValue);

            if ($normalizedType !== '' && $amount > 0) {
                $amounts[$normalizedType] = $amount;
            }
        }
    }

    $normalizedFallback = $allowedTypes === null
        ? loan_type($fallbackType)
        : loan_type_from_allowed($fallbackType, $allowedTypes);

    if ($amounts === [] && $normalizedFallback !== '' && $fallbackAmount > 0) {
        $amounts[$normalizedFallback] = $fallbackAmount;
    }

    return $amounts;
}

function loan_primary_type(array $amounts): string
{
    $type = array_key_first($amounts);
    return is_string($type) ? $type : '';
}

function loan_total_amount(array $amounts): float
{
    return round(array_sum($amounts), 2);
}

/** `{loan type: amount}`, the shape the loan page sends and reads back. A loan has one type. */
function loan_amount_map_from_record(array $record): array
{
    return loan_amount_map([], (string)($record['loanType'] ?? ''), loan_decimal($record['loanAmount'] ?? 0));
}

function loan_role_key(array $user): string
{
    return user_role_key($user);
}

function loan_can_file_for_others(array $user): bool
{
    return in_array(loan_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function loan_can_review(array $user): bool
{
    return loan_role_key($user) === 'hrhead';
}

function loan_can_manage_records(array $user): bool
{
    return in_array(loan_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function loan_can_record_payments(array $user): bool
{
    return in_array(loan_role_key($user), ['admin', 'hrhead', 'hrstaff', 'cashier'], true);
}

/*
 * Reading the whole ledger is wider than acting on it: the cashier is here because a loan is
 * deducted from the pay they release, so they have to see the balances -- but they are deliberately
 * absent from loan_can_review() and loan_can_manage_records() above, so it stays a read.
 */
function loan_can_view_all(array $user): bool
{
    return in_array(loan_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector', 'cashier'], true);
}

function loan_request_body(): array
{
    if (!empty($_POST)) {
        return $_POST;
    }

    return read_json_body();
}

function ensure_loan_request_tables(PDO $pdo): void
{
    $pdo->exec('DROP TABLE IF EXISTS loan_request_audit_trail');

    if (database_table_exists($pdo, 'loan_requests') && !database_table_exists($pdo, LOAN_RECORDS_TABLE)) {
        $pdo->exec('RENAME TABLE loan_requests TO ' . LOAN_RECORDS_TABLE);
    }

    $columns = [
        'annual_interest_rate' => 'DECIMAL(7,4) NOT NULL DEFAULT 0.0000 AFTER repayment_terms',
        'interest_method' => 'VARCHAR(20) NOT NULL DEFAULT "flat" AFTER annual_interest_rate',
        'government_reference_number' => 'VARCHAR(180) NULL AFTER purpose',
        'disbursed_at' => 'DATE NULL AFTER date_filed',
        'approval_remarks' => 'TEXT NULL AFTER status',
        'approved_by_user_id' => 'INT UNSIGNED NULL AFTER approval_remarks',
        'approved_at' => 'DATETIME NULL AFTER approved_by_user_id',
        'rejected_by_user_id' => 'INT UNSIGNED NULL AFTER approved_at',
        'rejected_at' => 'DATETIME NULL AFTER rejected_by_user_id',
        'reviewed_by_user_id' => 'INT UNSIGNED NULL AFTER rejected_at',
        'reviewed_at' => 'DATETIME NULL AFTER reviewed_by_user_id',
        'created_by_user_id' => 'INT UNSIGNED NULL AFTER reviewed_at',
        'updated_by_user_id' => 'INT UNSIGNED NULL AFTER created_by_user_id',
        'is_archived' => 'TINYINT(1) NOT NULL DEFAULT 0 AFTER updated_by_user_id',
        'created_at' => 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER is_archived',
        'updated_at' => 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    ];

    foreach ($columns as $column => $definition) {
        if (!database_column_exists($pdo, LOAN_RECORDS_TABLE, $column)) {
            $pdo->exec("ALTER TABLE " . LOAN_RECORDS_TABLE . " ADD COLUMN {$column} {$definition}");
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
            CONSTRAINT fk_loan_payments_loan FOREIGN KEY (loan_record_id) REFERENCES loan_records(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    /*
     * Called here, outside any transaction, because every write below records an audit entry
     * from inside one. MySQL implicitly commits when it sees DDL, so letting `write_auth_audit()`
     * reach the audit_logs migration mid-transaction ended the transaction early and made the
     * commit() fail with "There is no active transaction" — after the loan row was already durable.
     * Doing it up front means the lazy path finds its work already done and issues no DDL.
     */
    ensure_audit_logs_table($pdo);
}

function loan_session_employee_scope_id(PDO $pdo, array $sessionUser): ?int
{
    if (loan_can_view_all($sessionUser)) {
        return null;
    }

    $employeeId = session_employee_record_id($pdo, $sessionUser);

    if ($employeeId !== null) {
        return $employeeId;
    }

    json_response([
        'success' => false,
        'message' => 'Signed-in employee record was not found.',
    ], 422);
}

function resolve_loan_employee_id(PDO $pdo, array $body, array $sessionUser): int
{
    if (!loan_can_file_for_others($sessionUser)) {
        $employeeId = session_employee_record_id($pdo, $sessionUser);

        if ($employeeId !== null) {
            return $employeeId;
        }

        json_response([
            'success' => false,
            'message' => 'Signed-in employee record was not found.',
        ], 422);
    }

    $employeeRecordId = (int)($body['employeeRecordId'] ?? $body['employee_id'] ?? 0);
    $employeeCode = loan_text($body['employeeCode'] ?? $body['employeeId'] ?? '');
    $employeeName = loan_text($body['employeeName'] ?? '');

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
             WHERE TRIM(CONCAT(first_name, " ", COALESCE(middle_name, ""), " ", last_name)) COLLATE utf8mb4_unicode_ci = :employee_name
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

function loan_actor_name(array $user): string
{
    return audit_user_display_name($user) ?: loan_text($user['username'] ?? 'System');
}

function write_loan_audit(
    PDO $pdo,
    array $user,
    int $loanRequestId,
    string $action,
    ?string $previousStatus,
    ?string $newStatus,
    string $remarks = ''
): void {
    $summary = match ($action) {
        'submitted' => 'A loan request was submitted.',
        'updated' => 'A loan request was updated.',
        'approved' => 'A loan request was approved.',
        'rejected' => 'A loan request was rejected.',
        'archived' => 'A loan record was archived.',
        default => 'A loan request audit event was recorded.',
    };

    write_auth_audit($pdo, $user, 'loan_request.' . $action, $summary, [
        'module' => 'loan_management',
        'loanRequestId' => $loanRequestId,
        'previousStatus' => $previousStatus,
        'newStatus' => $newStatus,
        'remarks' => $remarks,
    ]);
}

function loan_user_display_sql(string $alias): string
{
    return 'COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(' . $alias . '_employee.first_name, ""), " ", COALESCE(' . $alias . '_employee.middle_name, ""), " ", COALESCE(' . $alias . '_employee.last_name, ""))), ""),
        NULLIF(' . $alias . '_user.username, "")
    )';
}

function loan_base_select(): string
{
    return 'SELECT
            lr.id,
            lr.employee_id AS employeeRecordId,
            e.employee_id AS employeeId,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS employeeName,
            d.name AS division,
            des.name AS position,
            e.employment_status AS employmentStatus,
            e.designation,
            lr.loan_type AS loanType,
            lr.loan_amount AS loanAmount,
            lr.repayment_terms AS repaymentTerms,
            lr.annual_interest_rate AS annualInterestRate,
            lr.interest_method AS interestMethod,
            lr.purpose,
            lr.government_reference_number AS governmentReferenceNumber,
            lr.date_filed AS dateFiled,
            DATE_FORMAT(lr.date_filed, "%M %e, %Y") AS dateFiledDisplay,
            lr.disbursed_at AS disbursedAt,
            lr.status,
            COALESCE(payment_summary.paymentCount, 0) AS paymentCount,
            COALESCE(payment_summary.paidAmount, 0) AS paidAmount,
            payment_summary.lastPaymentAt AS lastPaymentAt,
            lr.approval_remarks AS approvalRemarks,
            lr.approved_by_user_id AS approvedByUserId,
            lr.approved_at AS approvedAt,
            ' . loan_user_display_sql('approved') . ' AS approvedBy,
            lr.rejected_by_user_id AS rejectedByUserId,
            lr.rejected_at AS rejectedAt,
            ' . loan_user_display_sql('rejected') . ' AS rejectedBy,
            lr.reviewed_by_user_id AS reviewedByUserId,
            lr.reviewed_at AS reviewedAt,
            ' . loan_user_display_sql('reviewed') . ' AS reviewedBy,
            lr.created_by_user_id AS createdByUserId,
            creator_user.username AS createdBy,
            lr.updated_by_user_id AS updatedByUserId,
            updater_user.username AS updatedBy,
            lr.is_archived AS isArchived,
            lr.created_at AS createdAt,
            lr.updated_at AS updatedAt
         FROM loan_records lr
         INNER JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN users approved_user ON approved_user.id = lr.approved_by_user_id
         LEFT JOIN employees approved_employee ON approved_employee.email COLLATE utf8mb4_unicode_ci = approved_user.email COLLATE utf8mb4_unicode_ci
            AND approved_employee.is_archived = 0
         LEFT JOIN users rejected_user ON rejected_user.id = lr.rejected_by_user_id
         LEFT JOIN employees rejected_employee ON rejected_employee.email COLLATE utf8mb4_unicode_ci = rejected_user.email COLLATE utf8mb4_unicode_ci
            AND rejected_employee.is_archived = 0
         LEFT JOIN users reviewed_user ON reviewed_user.id = lr.reviewed_by_user_id
         LEFT JOIN employees reviewed_employee ON reviewed_employee.email COLLATE utf8mb4_unicode_ci = reviewed_user.email COLLATE utf8mb4_unicode_ci
            AND reviewed_employee.is_archived = 0
         LEFT JOIN users creator_user ON creator_user.id = lr.created_by_user_id
         LEFT JOIN users updater_user ON updater_user.id = lr.updated_by_user_id
         LEFT JOIN (
             SELECT
                 loan_record_id,
                 COUNT(*) AS paymentCount,
                 SUM(amount) AS paidAmount,
                 MAX(paid_at) AS lastPaymentAt
             FROM loan_payments
             GROUP BY loan_record_id
         ) payment_summary ON payment_summary.loan_record_id = lr.id';
}

function loan_normalize_record(array $record): array
{
    $record['id'] = (int)$record['id'];
    $record['employeeRecordId'] = (int)$record['employeeRecordId'];
    $record['loanAmount'] = loan_decimal($record['loanAmount'] ?? 0);
    $record['annualInterestRate'] = round((float)($record['annualInterestRate'] ?? 0), 4);
    $record['interestMethod'] = loan_interest_method($record['interestMethod'] ?? 'flat');
    $record['termMonths'] = loan_term_months($record['repaymentTerms'] ?? '');
    $record['monthlyAmortization'] = loan_monthly_amortization(
        $record['loanAmount'],
        $record['annualInterestRate'],
        $record['termMonths'],
        $record['interestMethod']
    );
    $record['totalPayable'] = loan_total_payable(
        $record['loanAmount'],
        $record['annualInterestRate'],
        $record['termMonths'],
        $record['interestMethod']
    );
    $record['paymentCount'] = (int)($record['paymentCount'] ?? 0);
    $record['paidAmount'] = loan_decimal($record['paidAmount'] ?? 0);
    $record['outstandingAmount'] = round(max(0, $record['totalPayable'] - $record['paidAmount']), 2);
    $record['loanAmounts'] = loan_amount_map_from_record($record);
    $record['approvedByUserId'] = $record['approvedByUserId'] !== null ? (int)$record['approvedByUserId'] : null;
    $record['rejectedByUserId'] = $record['rejectedByUserId'] !== null ? (int)$record['rejectedByUserId'] : null;
    $record['reviewedByUserId'] = $record['reviewedByUserId'] !== null ? (int)$record['reviewedByUserId'] : null;
    $record['createdByUserId'] = $record['createdByUserId'] !== null ? (int)$record['createdByUserId'] : null;
    $record['updatedByUserId'] = $record['updatedByUserId'] !== null ? (int)$record['updatedByUserId'] : null;
    $record['isArchived'] = (bool)($record['isArchived'] ?? false);

    return $record;
}

function fetch_loan_payments(PDO $pdo, int $loanRequestId): array
{
    $statement = $pdo->prepare(
        'SELECT
            lp.id,
            lp.loan_record_id AS loanRequestId,
            lp.installment_number AS installmentNumber,
            lp.amount,
            lp.paid_at AS paidAt,
            lp.payment_reference AS paymentReference,
            lp.notes,
            lp.source,
            lp.payroll_id AS payrollId,
            lp.created_at AS createdAt
         FROM loan_payments lp
         WHERE lp.loan_record_id = :loan_record_id
         ORDER BY lp.installment_number ASC, lp.id ASC'
    );
    $statement->execute([':loan_record_id' => $loanRequestId]);

    return array_map(static function (array $payment): array {
        $payment['id'] = (int)$payment['id'];
        $payment['loanRequestId'] = (int)$payment['loanRequestId'];
        $payment['installmentNumber'] = (int)$payment['installmentNumber'];
        $payment['amount'] = loan_decimal($payment['amount'] ?? 0);
        $payment['payrollId'] = $payment['payrollId'] !== null ? (int)$payment['payrollId'] : null;
        return $payment;
    }, $statement->fetchAll());
}

function fetch_loan_request(PDO $pdo, int $id, ?int $employeeScopeId = null, bool $withAuditTrail = false): ?array
{
    $sql = loan_base_select() . ' WHERE lr.id = :id';
    $params = [':id' => $id];

    if ($employeeScopeId !== null) {
        $sql .= ' AND lr.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $employeeScopeId;
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $normalized = loan_normalize_record($record);
    if ($withAuditTrail) {
        $normalized['payments'] = fetch_loan_payments($pdo, (int)$normalized['id']);
    }

    return $normalized;
}

function list_loan_requests(PDO $pdo, array $sessionUser): void
{
    $id = (int)($_GET['id'] ?? 0);
    $scopeId = loan_session_employee_scope_id($pdo, $sessionUser);

    if ($id > 0) {
        $record = fetch_loan_request($pdo, $id, $scopeId, true);

        if ($record === null) {
            json_response([
                'success' => false,
                'message' => 'Loan request not found.',
            ], 404);
        }

        json_response([
            'success' => true,
            'record' => $record,
        ]);
    }

    $includeArchived = filter_var($_GET['archived'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $search = loan_text($_GET['search'] ?? '');
    $rawStatusFilter = loan_text($_GET['status'] ?? '');
    $statusFilter = $rawStatusFilter !== '' ? loan_status($rawStatusFilter) : '';
    $loanTypeFilter = loan_type($_GET['loanType'] ?? $_GET['loan_type'] ?? '');
    $sortBy = loan_text($_GET['sortBy'] ?? 'dateFiled');
    $sortDirection = strtoupper(loan_text($_GET['sortDirection'] ?? 'DESC')) === 'ASC' ? 'ASC' : 'DESC';

    $conditions = [];
    $params = [];

    $conditions[] = $includeArchived ? 'lr.is_archived = 1' : 'lr.is_archived = 0';

    if ($scopeId !== null) {
        $conditions[] = 'lr.employee_id = :employee_scope_id';
        $params[':employee_scope_id'] = $scopeId;
    }

    if ($search !== '') {
        // Native prepares accept a placeholder only once, so each searched column binds its own.
        $searchColumns = [
            'e.employee_id', 'e.first_name', 'e.middle_name', 'e.last_name',
            'lr.loan_type', 'lr.loan_amount', 'lr.repayment_terms', 'lr.purpose', 'lr.status',
        ];
        $searchParts = [];
        foreach ($searchColumns as $index => $column) {
            $searchParts[] = $column . ' LIKE :search_' . $index;
            $params[':search_' . $index] = '%' . $search . '%';
        }
        $conditions[] = '(' . implode(' OR ', $searchParts) . ')';
    }

    if ($statusFilter !== '' && in_array($statusFilter, LOAN_REQUEST_STATUSES, true)) {
        $conditions[] = 'lr.status = :status';
        $params[':status'] = $statusFilter;
    }

    if ($loanTypeFilter !== '') {
        $conditions[] = 'lr.loan_type = :loan_type';
        $params[':loan_type'] = $loanTypeFilter;
    }

    $sortColumns = [
        'loanId' => 'lr.id',
        'employeeName' => 'employeeName',
        'employeeId' => 'e.employee_id',
        'loanType' => 'lr.loan_type',
        'loanAmount' => 'lr.loan_amount',
        'repaymentTerms' => 'lr.repayment_terms',
        'dateFiled' => 'lr.date_filed',
        'status' => 'lr.status',
    ];
    $orderColumn = $sortColumns[$sortBy] ?? $sortColumns['dateFiled'];

    $sql = loan_base_select();
    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }
    $sql .= " ORDER BY {$orderColumn} {$sortDirection}, lr.id DESC";

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $records = array_map(
        static fn (array $record): array => loan_normalize_record($record),
        $statement->fetchAll()
    );

    $loanTypeDefinitions = loan_type_definitions($pdo);

    json_response([
        'success' => true,
        'records' => $records,
        'loanTypes' => array_column($loanTypeDefinitions, 'typeName'),
        'loanTypeDefinitions' => $loanTypeDefinitions,
        'statuses' => LOAN_REQUEST_STATUSES,
    ]);
}

function validate_loan_payload(array $amounts, string $repaymentTerms, ?string $dateFiled, float $annualInterestRate = 0): void
{
    $errors = [];

    if ($amounts === []) {
        $errors[] = 'At least one loan amount greater than 0 is required.';
    }

    if ($repaymentTerms === '') {
        $errors[] = 'Repayment terms are required.';
    }

    if ($dateFiled === null) {
        $errors[] = 'Date filed is required.';
    }

    if (loan_term_months($repaymentTerms) <= 0) {
        $errors[] = 'Repayment term must include a valid number of months.';
    }

    if ($annualInterestRate < 0 || $annualInterestRate > 100) {
        $errors[] = 'Annual interest rate must be between 0 and 100.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }
}

function create_loan_request(PDO $pdo, array $body, array $sessionUser): void
{
    $employeeId = resolve_loan_employee_id($pdo, $body, $sessionUser);
    $allowedTypes = loan_request_types($pdo);
    $requestedType = loan_type($body['loanType'] ?? $body['loan_type'] ?? '');

    if ($requestedType !== '' && loan_type_from_allowed($requestedType, $allowedTypes) === '') {
        json_response([
            'success' => false,
            'message' => 'Only MGB Coop loans can be filed. Choose an MGB Coop loan type.',
        ], 422);
    }

    $amounts = loan_amount_map(
        $body['loanAmounts'] ?? $body['loan_amounts'] ?? null,
        loan_type_from_allowed($body['loanType'] ?? $body['loan_type'] ?? '', $allowedTypes),
        loan_decimal($body['loanAmount'] ?? $body['loan_amount'] ?? 0),
        $allowedTypes
    );
    $type = loan_primary_type($amounts);
    $amount = loan_total_amount($amounts);
    $repaymentTerms = loan_text($body['repaymentTerms'] ?? $body['repayment_terms'] ?? '');
    $annualInterestRate = loan_decimal($body['annualInterestRate'] ?? $body['annual_interest_rate'] ?? 0);
    $interestMethod = loan_interest_method($body['interestMethod'] ?? $body['interest_method'] ?? 'flat');
    $purpose = loan_text($body['purpose'] ?? '');
    $governmentReferenceNumber = loan_text($body['governmentReferenceNumber'] ?? $body['government_reference_number'] ?? '');
    $dateFiled = loan_date_or_null($body['dateFiled'] ?? $body['date_filed'] ?? date('Y-m-d'));

    validate_loan_payload($amounts, $repaymentTerms, $dateFiled, $annualInterestRate);

    try {
        $pdo->beginTransaction();

        $statement = $pdo->prepare(
            'INSERT INTO loan_records
                (employee_id, loan_type, loan_amount, repayment_terms, annual_interest_rate,
                 interest_method, purpose, government_reference_number, date_filed, status,
                 created_by_user_id, updated_by_user_id)
             VALUES
                (:employee_id, :loan_type, :loan_amount, :repayment_terms, :annual_interest_rate,
                 :interest_method, :purpose, :government_reference_number, :date_filed, "Pending",
                 :created_by_user_id, :updated_by_user_id)'
        );
        $statement->execute([
            ':employee_id' => $employeeId,
            ':loan_type' => $type,
            ':loan_amount' => number_format($amount, 2, '.', ''),
            ':repayment_terms' => $repaymentTerms,
            ':annual_interest_rate' => number_format($annualInterestRate, 4, '.', ''),
            ':interest_method' => $interestMethod,
            ':purpose' => $purpose !== '' ? $purpose : null,
            ':government_reference_number' => $governmentReferenceNumber !== '' ? $governmentReferenceNumber : null,
            ':date_filed' => $dateFiled,
            ':created_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
            ':updated_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
        ]);

        $loanRequestId = (int)$pdo->lastInsertId();
        write_loan_audit($pdo, $sessionUser, $loanRequestId, 'submitted', null, 'Pending', 'Loan request submitted.');

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    $scopeId = loan_session_employee_scope_id($pdo, $sessionUser);

    json_response([
        'success' => true,
        'message' => 'Loan request submitted successfully.',
        'record' => fetch_loan_request($pdo, $loanRequestId, $scopeId, true),
    ], 201);
}

function update_loan_request(PDO $pdo, array $body, array $sessionUser): void
{
    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Loan request is required.',
        ], 422);
    }

    $scopeId = loan_session_employee_scope_id($pdo, $sessionUser);
    $existing = fetch_loan_request($pdo, $id, $scopeId, true);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Loan request not found.',
        ], 404);
    }

    if (!loan_can_manage_records($sessionUser) && $existing['status'] !== 'Pending') {
        json_response([
            'success' => false,
            'message' => 'Only pending loan requests can be edited.',
        ], 403);
    }

    $employeeId = loan_can_file_for_others($sessionUser)
        ? resolve_loan_employee_id($pdo, [
            'employeeRecordId' => $body['employeeRecordId'] ?? $existing['employeeRecordId'],
        ], $sessionUser)
        : (int)$existing['employeeRecordId'];
    $allowedTypes = loan_request_types($pdo);
    if (loan_type($existing['loanType']) !== '' && loan_type_from_allowed($existing['loanType'], $allowedTypes) === '') {
        $allowedTypes[] = loan_type($existing['loanType']);
    }
    $amounts = loan_amount_map(
        $body['loanAmounts'] ?? $body['loan_amounts'] ?? ($existing['loanAmounts'] ?? null),
        loan_type_from_allowed($body['loanType'] ?? $body['loan_type'] ?? $existing['loanType'], $allowedTypes),
        loan_decimal($body['loanAmount'] ?? $body['loan_amount'] ?? $existing['loanAmount']),
        $allowedTypes
    );
    $type = loan_primary_type($amounts);
    $amount = loan_total_amount($amounts);
    $repaymentTerms = loan_text($body['repaymentTerms'] ?? $body['repayment_terms'] ?? $existing['repaymentTerms']);
    $annualInterestRate = loan_decimal($body['annualInterestRate'] ?? $body['annual_interest_rate'] ?? $existing['annualInterestRate']);
    $interestMethod = loan_interest_method($body['interestMethod'] ?? $body['interest_method'] ?? $existing['interestMethod']);
    $purpose = loan_text($body['purpose'] ?? $existing['purpose']);
    $governmentReferenceNumber = loan_text(
        $body['governmentReferenceNumber']
        ?? $body['government_reference_number']
        ?? $existing['governmentReferenceNumber']
    );
    $dateFiled = loan_date_or_null($body['dateFiled'] ?? $body['date_filed'] ?? $existing['dateFiled']);

    validate_loan_payload($amounts, $repaymentTerms, $dateFiled, $annualInterestRate);

    try {
        $pdo->beginTransaction();

        $statement = $pdo->prepare(
            'UPDATE loan_records
             SET employee_id = :employee_id,
                 loan_type = :loan_type,
                 loan_amount = :loan_amount,
                 repayment_terms = :repayment_terms,
                 annual_interest_rate = :annual_interest_rate,
                 interest_method = :interest_method,
                 purpose = :purpose,
                 government_reference_number = :government_reference_number,
                 date_filed = :date_filed,
                 updated_by_user_id = :updated_by_user_id
             WHERE id = :id'
        );
        $statement->execute([
            ':employee_id' => $employeeId,
            ':loan_type' => $type,
            ':loan_amount' => number_format($amount, 2, '.', ''),
            ':repayment_terms' => $repaymentTerms,
            ':annual_interest_rate' => number_format($annualInterestRate, 4, '.', ''),
            ':interest_method' => $interestMethod,
            ':purpose' => $purpose !== '' ? $purpose : null,
            ':government_reference_number' => $governmentReferenceNumber !== '' ? $governmentReferenceNumber : null,
            ':date_filed' => $dateFiled,
            ':updated_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
            ':id' => $id,
        ]);

        write_loan_audit($pdo, $sessionUser, $id, 'updated', $existing['status'], $existing['status'], 'Loan request details updated.');

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    json_response([
        'success' => true,
        'message' => 'Loan request updated successfully.',
        'record' => fetch_loan_request($pdo, $id, $scopeId, true),
    ]);
}

function update_loan_request_status(PDO $pdo, array $body, array $sessionUser): void
{
    if (!loan_can_review($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'Only the HR Head can approve or reject loan applications.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $status = loan_status($body['status'] ?? '');
    $remarks = loan_text($body['remarks'] ?? $body['approvalRemarks'] ?? '');

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Loan request is required.',
        ], 422);
    }

    if (!in_array($status, ['Approved', 'Rejected'], true)) {
        json_response([
            'success' => false,
            'message' => 'Loan status must be Approved or Rejected.',
        ], 422);
    }

    $existing = fetch_loan_request($pdo, $id);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Loan request not found.',
        ], 404);
    }

    $now = date('Y-m-d H:i:s');
    $userId = (int)($sessionUser['id'] ?? 0) ?: null;
    $approvedBy = $status === 'Approved' ? $userId : null;
    $approvedAt = $status === 'Approved' ? $now : null;
    $rejectedBy = $status === 'Rejected' ? $userId : null;
    $rejectedAt = $status === 'Rejected' ? $now : null;

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'UPDATE loan_records
             SET status = :status,
                 approval_remarks = :approval_remarks,
                 approved_by_user_id = :approved_by_user_id,
                 approved_at = :approved_at,
                 rejected_by_user_id = :rejected_by_user_id,
                 rejected_at = :rejected_at,
                 reviewed_by_user_id = :reviewed_by_user_id,
                 reviewed_at = :reviewed_at,
                 updated_by_user_id = :updated_by_user_id
             WHERE id = :id'
        );
        $statement->execute([
            ':status' => $status,
            ':approval_remarks' => $remarks !== '' ? $remarks : null,
            ':approved_by_user_id' => $approvedBy,
            ':approved_at' => $approvedAt,
            ':rejected_by_user_id' => $rejectedBy,
            ':rejected_at' => $rejectedAt,
            ':reviewed_by_user_id' => $userId,
            ':reviewed_at' => $now,
            ':updated_by_user_id' => $userId,
            ':id' => $id,
        ]);

        write_loan_audit(
            $pdo,
            $sessionUser,
            $id,
            strtolower($status),
            $existing['status'],
            $status,
            $remarks
        );

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    json_response([
        'success' => true,
        'message' => 'Loan request status updated successfully.',
        'record' => fetch_loan_request($pdo, $id, null, true),
    ]);
}

function disburse_loan_request(PDO $pdo, array $body, array $sessionUser): void
{
    if (!loan_can_manage_records($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to disburse loan records.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $disbursedAt = loan_date_or_null($body['disbursedAt'] ?? $body['disbursed_at'] ?? date('Y-m-d'));
    $existing = $id > 0 ? fetch_loan_request($pdo, $id) : null;

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Loan record not found.',
        ], 404);
    }

    if ($existing['status'] !== 'Approved') {
        json_response([
            'success' => false,
            'message' => 'Only approved loans can be disbursed.',
        ], 422);
    }

    if ($disbursedAt === null) {
        json_response([
            'success' => false,
            'message' => 'A valid disbursement date is required.',
        ], 422);
    }

    try {
        $pdo->beginTransaction();
        $statement = $pdo->prepare(
            'UPDATE loan_records
             SET disbursed_at = :disbursed_at,
                 updated_by_user_id = :updated_by_user_id
             WHERE id = :id'
        );
        $statement->execute([
            ':disbursed_at' => $disbursedAt,
            ':updated_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
            ':id' => $id,
        ]);
        write_loan_audit($pdo, $sessionUser, $id, 'disbursed', 'Approved', 'Approved', 'Loan disbursed on ' . $disbursedAt . '.');
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    json_response([
        'success' => true,
        'message' => 'Loan marked as disbursed.',
        'record' => fetch_loan_request($pdo, $id, null, true),
    ]);
}

function record_loan_payment(PDO $pdo, array $body, array $sessionUser): void
{
    if (!loan_can_record_payments($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to record loan payments.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);
    $existing = $id > 0 ? fetch_loan_request($pdo, $id, null, true) : null;

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Loan record not found.',
        ], 404);
    }

    if ($existing['status'] !== 'Approved' || empty($existing['disbursedAt'])) {
        json_response([
            'success' => false,
            'message' => 'The loan must be approved and disbursed before recording a payment.',
        ], 422);
    }

    $amount = loan_decimal($body['amount'] ?? 0);
    $paidAt = loan_date_or_null($body['paidAt'] ?? $body['paid_at'] ?? date('Y-m-d'));
    $installmentNumber = (int)($body['installmentNumber'] ?? $body['installment_number'] ?? ((int)$existing['paymentCount'] + 1));
    $paymentReference = loan_text($body['paymentReference'] ?? $body['payment_reference'] ?? '');
    $notes = loan_text($body['notes'] ?? '');

    $paidForInstallment = array_reduce(
        $existing['payments'] ?? [],
        static fn (float $sum, array $payment): float => $sum + (
            (int)($payment['installmentNumber'] ?? 0) === $installmentNumber
                ? loan_decimal($payment['amount'] ?? 0)
                : 0.0
        ),
        0.0
    );
    $scheduledAmount = (float)$existing['monthlyAmortization'];
    if ($installmentNumber === (int)$existing['termMonths']) {
        $scheduledAmount = max(
            0.0,
            (float)$existing['totalPayable'] - ((float)$existing['monthlyAmortization'] * ((int)$existing['termMonths'] - 1))
        );
    }
    $installmentOutstanding = max(0.0, $scheduledAmount - $paidForInstallment);

    if (
        $amount <= 0
        || $amount > (float)$existing['outstandingAmount'] + 0.01
        || $amount > $installmentOutstanding + 0.01
    ) {
        json_response([
            'success' => false,
            'message' => 'Payment must be greater than zero and cannot exceed the installment balance.',
        ], 422);
    }

    if ($paidAt === null || $installmentNumber <= 0 || $installmentNumber > max(1, (int)$existing['termMonths'])) {
        json_response([
            'success' => false,
            'message' => 'A valid installment number and payment date are required.',
        ], 422);
    }

    try {
        $pdo->beginTransaction();
        $statement = $pdo->prepare(
            'INSERT INTO loan_payments
                (loan_record_id, installment_number, amount, paid_at, payment_reference, notes, source, recorded_by_user_id)
             VALUES
                (:loan_record_id, :installment_number, :amount, :paid_at, :payment_reference, :notes, "manual", :recorded_by_user_id)'
        );
        $statement->execute([
            ':loan_record_id' => $id,
            ':installment_number' => $installmentNumber,
            ':amount' => number_format($amount, 2, '.', ''),
            ':paid_at' => $paidAt,
            ':payment_reference' => $paymentReference !== '' ? $paymentReference : null,
            ':notes' => $notes !== '' ? $notes : null,
            ':recorded_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
        ]);
        write_loan_audit($pdo, $sessionUser, $id, 'payment', 'Approved', 'Approved', sprintf('Payment of %.2f recorded.', $amount));
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    json_response([
        'success' => true,
        'message' => 'Loan payment recorded.',
        'record' => fetch_loan_request($pdo, $id, null, true),
    ], 201);
}

function archive_loan_request(PDO $pdo, array $body, array $sessionUser): void
{
    if (!loan_can_manage_records($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You are not allowed to archive loan records.',
        ], 403);
    }

    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Loan record is required.',
        ], 422);
    }

    $existing = fetch_loan_request($pdo, $id);

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Loan record not found.',
        ], 404);
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'UPDATE loan_records
             SET is_archived = 1,
                 updated_by_user_id = :updated_by_user_id
             WHERE id = :id'
        );
        $statement->execute([
            ':updated_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
            ':id' => $id,
        ]);

        write_loan_audit($pdo, $sessionUser, $id, 'archived', $existing['status'], $existing['status'], 'Loan record archived.');

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    json_response([
        'success' => true,
        'message' => 'Loan record archived successfully.',
        'record' => fetch_loan_request($pdo, $id),
    ]);
}

try {
    ensure_loan_request_tables($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        list_loan_requests($pdo, $sessionUser);
    }

    $body = loan_request_body();
    $action = loan_text($body['action'] ?? '');

    if ($method === 'POST') {
        if ($action === 'payment') {
            record_loan_payment($pdo, $body, $sessionUser);
        }

        if ($action === 'update') {
            update_loan_request($pdo, $body, $sessionUser);
        }

        create_loan_request($pdo, $body, $sessionUser);
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        if ($action === 'status') {
            update_loan_request_status($pdo, $body, $sessionUser);
        }

        if ($action === 'archive') {
            archive_loan_request($pdo, $body, $sessionUser);
        }

        if ($action === 'disburse') {
            disburse_loan_request($pdo, $body, $sessionUser);
        }

        update_loan_request($pdo, $body, $sessionUser);
    }

    if ($method === 'DELETE') {
        archive_loan_request($pdo, $body, $sessionUser);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Loan request API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process loan request.',
    ], 500);
}
