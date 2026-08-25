<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

const LOAN_REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected'];
const LOAN_REQUEST_TYPES = [
    'Emergency Loan',
    'Policy Loan',
    'Consolidated Loan',
    'Salary Loan',
    'Housing Loan',
    'Pension Loan',
    'GSIS Financial Assistance Loan (GFAL)',
    'Enhanced Housing Loan',
    'Multi-Purpose Loan (MPL)',
    'Calamity Loan',
];
const LOAN_RECORDS_TABLE = 'loan_records';
const LOAN_RECORD_AMOUNT_COLUMNS = [
    'Emergency Loan' => 'emergency_loan',
    'Policy Loan' => 'policy_loan',
    'Consolidated Loan' => 'consolidated_loan',
    'Salary Loan' => 'salary_loan',
    'Housing Loan' => 'housing_loan',
    'Pension Loan' => 'pension_loan',
    'GSIS Financial Assistance Loan (GFAL)' => 'gsis_financial_assistance_loan_gfal',
    'Enhanced Housing Loan' => 'enhanced_housing_loan',
    'Multi-Purpose Loan (MPL)' => 'multi_purpose_loan_mpl',
    'Calamity Loan' => 'calamity_loan',
];

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

    foreach (LOAN_REQUEST_TYPES as $allowedType) {
        if (strcasecmp($type, $allowedType) === 0) {
            return $allowedType;
        }
    }

    return '';
}

function loan_amount_map(mixed $value, string $fallbackType = '', float $fallbackAmount = 0.0): array
{
    if (is_string($value) && loan_text($value) !== '') {
        $decoded = json_decode($value, true);
        $value = is_array($decoded) ? $decoded : [];
    }

    $amounts = [];
    if (is_array($value)) {
        foreach ($value as $type => $amountValue) {
            $normalizedType = loan_type($type);
            $amount = loan_decimal($amountValue);

            if ($normalizedType !== '' && $amount > 0) {
                $amounts[$normalizedType] = $amount;
            }
        }
    }

    if ($amounts === [] && $fallbackType !== '' && $fallbackAmount > 0) {
        $amounts[$fallbackType] = $fallbackAmount;
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

function loan_amount_params(array $amounts): array
{
    $params = [];

    foreach (LOAN_RECORD_AMOUNT_COLUMNS as $type => $column) {
        $params[':' . $column] = number_format(loan_decimal($amounts[$type] ?? 0), 2, '.', '');
    }

    return $params;
}

function loan_amount_select_sql(): string
{
    return implode(",\n            ", array_map(
        static fn (string $column): string => 'lr.' . $column . ' AS ' . $column,
        LOAN_RECORD_AMOUNT_COLUMNS
    ));
}

function loan_amount_column_list(): string
{
    return implode(', ', array_values(LOAN_RECORD_AMOUNT_COLUMNS));
}

function loan_amount_placeholder_list(): string
{
    return implode(', ', array_map(
        static fn (string $column): string => ':' . $column,
        array_values(LOAN_RECORD_AMOUNT_COLUMNS)
    ));
}

function loan_amount_update_sql(): string
{
    return implode(",\n                 ", array_map(
        static fn (string $column): string => $column . ' = :' . $column,
        array_values(LOAN_RECORD_AMOUNT_COLUMNS)
    ));
}

function loan_amount_map_from_record(array $record): array
{
    $amounts = [];

    foreach (LOAN_RECORD_AMOUNT_COLUMNS as $type => $column) {
        $amount = loan_decimal($record[$column] ?? 0);
        if ($amount > 0) {
            $amounts[$type] = $amount;
        }
    }

    return loan_amount_map($amounts, (string)($record['loanType'] ?? ''), loan_decimal($record['loanAmount'] ?? 0));
}

function loan_amount_search_sql(): string
{
    return implode(' OR ', array_map(
        static fn (string $column): string => 'lr.' . $column . ' LIKE :search',
        array_values(LOAN_RECORD_AMOUNT_COLUMNS)
    ));
}

function loan_amount_nonzero_sql(string $type): string
{
    $column = LOAN_RECORD_AMOUNT_COLUMNS[$type] ?? '';
    return $column !== '' ? 'lr.' . $column . ' > 0' : '';
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
    return in_array(loan_role_key($user), ['admin', 'hrhead', 'hrstaff', 'regionaldirector'], true);
}

function loan_can_manage_records(array $user): bool
{
    return in_array(loan_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
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
        'emergency_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER loan_amount',
        'policy_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER emergency_loan',
        'consolidated_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER policy_loan',
        'salary_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER consolidated_loan',
        'housing_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER salary_loan',
        'pension_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER housing_loan',
        'gsis_financial_assistance_loan_gfal' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER pension_loan',
        'enhanced_housing_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER gsis_financial_assistance_loan_gfal',
        'multi_purpose_loan_mpl' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER enhanced_housing_loan',
        'calamity_loan' => 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER multi_purpose_loan_mpl',
        'supporting_document_name' => 'VARCHAR(255) NULL AFTER status',
        'supporting_document_path' => 'VARCHAR(500) NULL AFTER supporting_document_name',
        'supporting_document_size' => 'INT UNSIGNED NULL AFTER supporting_document_path',
        'supporting_document_type' => 'VARCHAR(120) NULL AFTER supporting_document_size',
        'approval_remarks' => 'TEXT NULL AFTER supporting_document_type',
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

    /*
     * Called here, outside any transaction, because every write below records an audit entry
     * from inside one. MySQL implicitly commits when it sees DDL, so letting `write_auth_audit()`
     * reach the audit_logs migration mid-transaction ended the transaction early and made the
     * commit() fail with "There is no active transaction" — after the loan row was already durable.
     * Doing it up front means the lazy path finds its work already done and issues no DDL.
     */
    ensure_audit_logs_table($pdo);
    migrate_loan_record_amount_columns($pdo);
}

function migrate_loan_record_amount_columns(PDO $pdo): void
{
    $selectColumns = 'id, loan_type AS loanType, loan_amount AS loanAmount';
    $hasLegacyJson = database_column_exists($pdo, LOAN_RECORDS_TABLE, 'loan_amounts');

    if ($hasLegacyJson) {
        $selectColumns .= ', loan_amounts AS loanAmountsJson';
    }

    foreach (LOAN_RECORD_AMOUNT_COLUMNS as $column) {
        $selectColumns .= ', ' . $column;
    }

    $statement = $pdo->query('SELECT ' . $selectColumns . ' FROM ' . LOAN_RECORDS_TABLE);
    $updateSql = 'UPDATE ' . LOAN_RECORDS_TABLE . '
                  SET loan_amount = :loan_amount,
                      loan_type = :loan_type,
                      ' . loan_amount_update_sql() . '
                  WHERE id = :id';
    $updateStatement = $pdo->prepare($updateSql);

    foreach ($statement->fetchAll() as $record) {
        $currentAmounts = loan_amount_map_from_record($record);
        $legacyAmounts = $hasLegacyJson
            ? loan_amount_map($record['loanAmountsJson'] ?? null, (string)($record['loanType'] ?? ''), loan_decimal($record['loanAmount'] ?? 0))
            : [];
        $amounts = $legacyAmounts !== [] ? $legacyAmounts : $currentAmounts;

        if ($amounts === []) {
            continue;
        }

        $updateStatement->execute([
            ':id' => (int)$record['id'],
            ':loan_type' => loan_primary_type($amounts),
            ':loan_amount' => number_format(loan_total_amount($amounts), 2, '.', ''),
            ...loan_amount_params($amounts),
        ]);
    }

    if ($hasLegacyJson) {
        $pdo->exec('ALTER TABLE ' . LOAN_RECORDS_TABLE . ' DROP COLUMN loan_amounts');
    }
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

function loan_document_upload(): ?array
{
    if (!isset($_FILES['supportingDocument']) || !is_array($_FILES['supportingDocument'])) {
        return null;
    }

    $file = $_FILES['supportingDocument'];
    $error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);

    if ($error === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    return $file;
}

function store_loan_document(array $upload): array
{
    $error = (int)($upload['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($error !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Unable to upload the supporting document.');
    }

    $originalName = loan_text($upload['name'] ?? '');
    $temporaryFile = (string)($upload['tmp_name'] ?? '');
    $fileSize = (int)($upload['size'] ?? 0);
    $mimeType = loan_text($upload['type'] ?? '');
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'doc', 'docx'];

    if ($originalName === '' || $temporaryFile === '') {
        throw new RuntimeException('Uploaded supporting document is invalid.');
    }

    if ($extension === '' || !in_array($extension, $allowedExtensions, true)) {
        throw new RuntimeException('Unsupported document type. Upload PDF, Word, or image files only.');
    }

    if ($fileSize <= 0) {
        throw new RuntimeException('Uploaded supporting document is empty.');
    }

    if ($fileSize > 10 * 1024 * 1024) {
        throw new RuntimeException('Supporting document must not exceed 10 MB.');
    }

    $uploadDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'loan-documents';
    if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true) && !is_dir($uploadDirectory)) {
        throw new RuntimeException('Unable to prepare the loan document folder.');
    }

    $storedFileName = sprintf('loan_%s_%s.%s', date('Ymd_His'), bin2hex(random_bytes(8)), $extension);
    $absolutePath = $uploadDirectory . DIRECTORY_SEPARATOR . $storedFileName;

    if (!move_uploaded_file($temporaryFile, $absolutePath)) {
        throw new RuntimeException('Unable to save the uploaded supporting document.');
    }

    return [
        'fileName' => $originalName,
        'filePath' => 'uploads/loan-documents/' . rawurlencode($storedFileName),
        'fileSize' => $fileSize,
        'fileType' => $mimeType !== '' ? $mimeType : null,
        'absolutePath' => $absolutePath,
    ];
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
            des.name AS designation,
            lr.loan_type AS loanType,
            lr.loan_amount AS loanAmount,
            ' . loan_amount_select_sql() . ',
            lr.repayment_terms AS repaymentTerms,
            lr.purpose,
            lr.date_filed AS dateFiled,
            DATE_FORMAT(lr.date_filed, "%M %e, %Y") AS dateFiledDisplay,
            lr.status,
            lr.supporting_document_name AS supportingDocumentName,
            lr.supporting_document_path AS supportingDocumentPath,
            lr.supporting_document_size AS supportingDocumentSize,
            lr.supporting_document_type AS supportingDocumentType,
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
         LEFT JOIN users updater_user ON updater_user.id = lr.updated_by_user_id';
}

function loan_normalize_record(array $record): array
{
    $record['id'] = (int)$record['id'];
    $record['employeeRecordId'] = (int)$record['employeeRecordId'];
    $record['loanAmount'] = loan_decimal($record['loanAmount'] ?? 0);
    $record['loanAmounts'] = loan_amount_map_from_record($record);
    foreach (LOAN_RECORD_AMOUNT_COLUMNS as $column) {
        unset($record[$column]);
    }
    $record['supportingDocumentSize'] = $record['supportingDocumentSize'] !== null ? (int)$record['supportingDocumentSize'] : null;
    $record['approvedByUserId'] = $record['approvedByUserId'] !== null ? (int)$record['approvedByUserId'] : null;
    $record['rejectedByUserId'] = $record['rejectedByUserId'] !== null ? (int)$record['rejectedByUserId'] : null;
    $record['reviewedByUserId'] = $record['reviewedByUserId'] !== null ? (int)$record['reviewedByUserId'] : null;
    $record['createdByUserId'] = $record['createdByUserId'] !== null ? (int)$record['createdByUserId'] : null;
    $record['updatedByUserId'] = $record['updatedByUserId'] !== null ? (int)$record['updatedByUserId'] : null;
    $record['isArchived'] = (bool)($record['isArchived'] ?? false);

    return $record;
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

    return loan_normalize_record($record);
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
        $conditions[] = '(
            e.employee_id LIKE :search
            OR e.first_name LIKE :search
            OR e.middle_name LIKE :search
            OR e.last_name LIKE :search
            OR lr.loan_type LIKE :search
            OR ' . loan_amount_search_sql() . '
            OR lr.repayment_terms LIKE :search
            OR lr.purpose LIKE :search
            OR lr.status LIKE :search
        )';
        $params[':search'] = '%' . $search . '%';
    }

    if ($statusFilter !== '' && in_array($statusFilter, LOAN_REQUEST_STATUSES, true)) {
        $conditions[] = 'lr.status = :status';
        $params[':status'] = $statusFilter;
    }

    if ($loanTypeFilter !== '') {
        $loanTypeSql = loan_amount_nonzero_sql($loanTypeFilter);
        if ($loanTypeSql !== '') {
            $conditions[] = $loanTypeSql;
        }
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

    json_response([
        'success' => true,
        'records' => $records,
        'loanTypes' => LOAN_REQUEST_TYPES,
        'statuses' => LOAN_REQUEST_STATUSES,
    ]);
}

function validate_loan_payload(array $amounts, string $repaymentTerms, ?string $dateFiled): void
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

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }
}

function create_loan_request(PDO $pdo, array $body, array $sessionUser, ?array $documentUpload = null): void
{
    $employeeId = resolve_loan_employee_id($pdo, $body, $sessionUser);
    $amounts = loan_amount_map(
        $body['loanAmounts'] ?? $body['loan_amounts'] ?? null,
        loan_type($body['loanType'] ?? $body['loan_type'] ?? ''),
        loan_decimal($body['loanAmount'] ?? $body['loan_amount'] ?? 0)
    );
    $type = loan_primary_type($amounts);
    $amount = loan_total_amount($amounts);
    $repaymentTerms = loan_text($body['repaymentTerms'] ?? $body['repayment_terms'] ?? '');
    $purpose = loan_text($body['purpose'] ?? '');
    $dateFiled = loan_date_or_null($body['dateFiled'] ?? $body['date_filed'] ?? date('Y-m-d'));

    validate_loan_payload($amounts, $repaymentTerms, $dateFiled);

    $storedDocument = null;
    $storedDocumentAbsolutePath = null;

    if ($documentUpload !== null) {
        try {
            $storedDocument = store_loan_document($documentUpload);
            $storedDocumentAbsolutePath = $storedDocument['absolutePath'];
        } catch (RuntimeException $exception) {
            json_response([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    try {
        $pdo->beginTransaction();

        $statement = $pdo->prepare(
            'INSERT INTO loan_records
                (employee_id, loan_type, loan_amount, ' . loan_amount_column_list() . ', repayment_terms, purpose, date_filed, status,
                 supporting_document_name, supporting_document_path, supporting_document_size, supporting_document_type,
                 created_by_user_id, updated_by_user_id)
             VALUES
                (:employee_id, :loan_type, :loan_amount, ' . loan_amount_placeholder_list() . ', :repayment_terms, :purpose, :date_filed, "Pending",
                 :supporting_document_name, :supporting_document_path, :supporting_document_size, :supporting_document_type,
                 :created_by_user_id, :updated_by_user_id)'
        );
        $statement->execute([
            ':employee_id' => $employeeId,
            ':loan_type' => $type,
            ':loan_amount' => number_format($amount, 2, '.', ''),
            ...loan_amount_params($amounts),
            ':repayment_terms' => $repaymentTerms,
            ':purpose' => $purpose !== '' ? $purpose : null,
            ':date_filed' => $dateFiled,
            ':supporting_document_name' => $storedDocument['fileName'] ?? null,
            ':supporting_document_path' => $storedDocument['filePath'] ?? null,
            ':supporting_document_size' => $storedDocument['fileSize'] ?? null,
            ':supporting_document_type' => $storedDocument['fileType'] ?? null,
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
        if ($storedDocumentAbsolutePath !== null && is_file($storedDocumentAbsolutePath)) {
            @unlink($storedDocumentAbsolutePath);
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

function update_loan_request(PDO $pdo, array $body, array $sessionUser, ?array $documentUpload = null): void
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
    $amounts = loan_amount_map(
        $body['loanAmounts'] ?? $body['loan_amounts'] ?? ($existing['loanAmounts'] ?? null),
        loan_type($body['loanType'] ?? $body['loan_type'] ?? $existing['loanType']),
        loan_decimal($body['loanAmount'] ?? $body['loan_amount'] ?? $existing['loanAmount'])
    );
    $type = loan_primary_type($amounts);
    $amount = loan_total_amount($amounts);
    $repaymentTerms = loan_text($body['repaymentTerms'] ?? $body['repayment_terms'] ?? $existing['repaymentTerms']);
    $purpose = loan_text($body['purpose'] ?? $existing['purpose']);
    $dateFiled = loan_date_or_null($body['dateFiled'] ?? $body['date_filed'] ?? $existing['dateFiled']);

    validate_loan_payload($amounts, $repaymentTerms, $dateFiled);

    $storedDocument = null;
    $storedDocumentAbsolutePath = null;
    if ($documentUpload !== null) {
        try {
            $storedDocument = store_loan_document($documentUpload);
            $storedDocumentAbsolutePath = $storedDocument['absolutePath'];
        } catch (RuntimeException $exception) {
            json_response([
                'success' => false,
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    try {
        $pdo->beginTransaction();

        $documentSql = '';
        $params = [
            ':employee_id' => $employeeId,
            ':loan_type' => $type,
            ':loan_amount' => number_format($amount, 2, '.', ''),
            ...loan_amount_params($amounts),
            ':repayment_terms' => $repaymentTerms,
            ':purpose' => $purpose !== '' ? $purpose : null,
            ':date_filed' => $dateFiled,
            ':updated_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
            ':id' => $id,
        ];

        if ($storedDocument !== null) {
            $documentSql = ',
             supporting_document_name = :supporting_document_name,
             supporting_document_path = :supporting_document_path,
             supporting_document_size = :supporting_document_size,
             supporting_document_type = :supporting_document_type';
            $params[':supporting_document_name'] = $storedDocument['fileName'];
            $params[':supporting_document_path'] = $storedDocument['filePath'];
            $params[':supporting_document_size'] = $storedDocument['fileSize'];
            $params[':supporting_document_type'] = $storedDocument['fileType'];
        }

        $statement = $pdo->prepare(
            'UPDATE loan_records
             SET employee_id = :employee_id,
                 loan_type = :loan_type,
                 loan_amount = :loan_amount,
                 ' . loan_amount_update_sql() . ',
                 repayment_terms = :repayment_terms,
                 purpose = :purpose,
                 date_filed = :date_filed,
                 updated_by_user_id = :updated_by_user_id' . $documentSql . '
             WHERE id = :id'
        );
        $statement->execute($params);

        write_loan_audit($pdo, $sessionUser, $id, 'updated', $existing['status'], $existing['status'], 'Loan request details updated.');

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($storedDocumentAbsolutePath !== null && is_file($storedDocumentAbsolutePath)) {
            @unlink($storedDocumentAbsolutePath);
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
            'message' => 'Only Admin, HR users, or Regional Directors can approve or reject loan applications.',
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
        if ($action === 'update') {
            update_loan_request($pdo, $body, $sessionUser, loan_document_upload());
        }

        create_loan_request($pdo, $body, $sessionUser, loan_document_upload());
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        if ($action === 'status') {
            update_loan_request_status($pdo, $body, $sessionUser);
        }

        if ($action === 'archive') {
            archive_loan_request($pdo, $body, $sessionUser);
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
