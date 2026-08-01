<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/deduction-catalog.php';

$sessionUser = require_session_user();
$roleKey = hris_user_role_key($sessionUser);

if (!in_array($roleKey, ['admin', 'hrhead'], true)) {
    json_response([
        'success' => false,
        'message' => 'Only administrators and HR Head can manage payroll deductions.',
    ], 403);
}

const DEDUCTION_EDITABLE_PAYROLL_STATUSES = ['Draft', 'Pending'];

function deduction_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function deduction_int(mixed $value): int
{
    return (int)($value ?? 0);
}

function deduction_decimal(mixed $value, string $label = 'Amount'): float
{
    if ($value === null || $value === '') {
        return 0.0;
    }

    if (!is_numeric($value)) {
        json_response([
            'success' => false,
            'message' => $label . ' must be numeric.',
        ], 422);
    }

    $amount = round((float)$value, 2);
    if ($amount < 0) {
        json_response([
            'success' => false,
            'message' => $label . ' cannot be negative.',
        ], 422);
    }

    return $amount;
}

function deduction_decimal_string(float $value): string
{
    return number_format($value, 2, '.', '');
}

function deduction_nullable_decimal(mixed $value, string $label = 'Amount'): ?float
{
    if ($value === null || $value === '') {
        return null;
    }

    return deduction_decimal($value, $label);
}

/**
 * Rates are held to 8 decimal places, matching `default_rate DECIMAL(12,8)`.
 *
 * Money rounds to 2 and this used to as well, which quietly destroyed any rate that is a division:
 * a day of absence is monthly salary over 22, or 4.54545455 percent, and saving that row from
 * Settings rewrote it as 4.55.
 */
function deduction_rate_string(float $value): string
{
    return number_format($value, 8, '.', '');
}

/** Parses a rate from a request without collapsing it to money precision. */
function deduction_rate_value(mixed $value, string $label = 'Rate'): float
{
    if ($value === null || $value === '') {
        return 0.0;
    }

    if (!is_numeric($value)) {
        json_response([
            'success' => false,
            'message' => $label . ' must be numeric.',
        ], 422);
    }

    $rate = round((float)$value, 8);

    if ($rate < 0) {
        json_response([
            'success' => false,
            'message' => $label . ' cannot be negative.',
        ], 422);
    }

    return $rate;
}

function deduction_bool_value(mixed $value, bool $default = false): bool
{
    if ($value === null || $value === '') {
        return $default;
    }

    if (is_bool($value)) {
        return $value;
    }

    return in_array(strtolower(trim((string)$value)), ['1', 'true', 'yes', 'on'], true);
}

function deduction_table_exists(PDO $pdo, string $table): bool
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

function deduction_normalize_key(string $value): string
{
    return preg_replace('/[^a-z0-9]/', '', strtolower($value)) ?? '';
}

function deduction_category_id_from_name(string $categoryName): int
{
    $normalized = deduction_normalize_key($categoryName);
    return (int)(sprintf('%u', crc32($normalized !== '' ? $normalized : 'otherdeductions')) % 2147483646) + 1;
}

function deduction_ensure_definition_tables(PDO $pdo): void
{
    deduction_catalog_ensure_schema($pdo);
}

/**
 * The groups Settings shows.
 *
 * These used to be four hard-coded entries, one per table — GSIS, PHIC, HDMF, Other. They are now
 * read from `deduction_categories`, so every category is manageable and adding one needs no code
 * change. The shape is kept (`key`, `label`, `categoryName`) so the existing callers still fit.
 */
function deduction_definition_groups(?PDO $pdo = null): array
{
    static $cache = null;

    if ($cache !== null) {
        return $cache;
    }

    $pdo ??= $GLOBALS['pdo'];
    $groups = [];

    foreach (deduction_catalog_categories($pdo) as $category) {
        $groups[$category['code']] = [
            'key' => $category['code'],
            'label' => $category['name'],
            'categoryId' => $category['id'],
            'categoryName' => $category['name'],
            'typeCount' => $category['typeCount'],
        ];
    }

    return $cache = $groups;
}

function deduction_definition_group(string $groupKey): array
{
    $groups = deduction_definition_groups($GLOBALS['pdo']);
    $groupKey = strtolower(deduction_text($groupKey));

    if (!isset($groups[$groupKey])) {
        json_response([
            'success' => false,
            'message' => 'Deduction group is required.',
        ], 422);
    }

    return $groups[$groupKey];
}

function deduction_column_exists(PDO $pdo, string $table, string $column): bool
{
    return hris_database_column_exists($pdo, $table, $column);
}

function ensure_deduction_schema(PDO $pdo): void
{
    // Categories and types now come from the shared catalog; this file no longer defines them.
    deduction_ensure_definition_tables($pdo);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS PayrollDeduction (
            payroll_deduction_id INT PRIMARY KEY AUTO_INCREMENT,
            payroll_id INT NOT NULL,
            deduction_type_id INT UNSIGNED NOT NULL,
            amount DECIMAL(10,2) NULL,
            FOREIGN KEY (payroll_id)
                REFERENCES Payroll(payroll_id),
            KEY idx_payrolldeduction_type (deduction_type_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    if (!deduction_column_exists($pdo, 'PayrollDeduction', 'amount')) {
        $pdo->exec('ALTER TABLE PayrollDeduction ADD COLUMN amount DECIMAL(10,2) NULL AFTER deduction_type_id');
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS EmployeeDeduction (
            employee_deduction_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_id INT UNSIGNED NOT NULL,
            deduction_type_id INT UNSIGNED NOT NULL,
            amount DECIMAL(12,2) NULL,
            rate DECIMAL(9,4) NULL,
            calculation_type VARCHAR(20) NOT NULL DEFAULT "fixed",
            basis VARCHAR(40) NOT NULL DEFAULT "basic_salary",
            frequency VARCHAR(30) NOT NULL DEFAULT "monthly",
            effective_start DATE NULL,
            effective_end DATE NULL,
            is_recurring TINYINT(1) NOT NULL DEFAULT 1,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            remarks TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (employee_deduction_id),
            KEY idx_employee_deductions_employee (employee_id),
            KEY idx_employee_deductions_type (deduction_type_id),
            KEY idx_employee_deductions_active (is_active, is_recurring),
            CONSTRAINT fk_employee_deductions_employee
                FOREIGN KEY (employee_id) REFERENCES employees(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function deduction_seed_defaults(PDO $pdo): void
{
    /*
     * Keyed by family, because the category decides which table the deduction is looked up in. These
     * previously read "Government Contributions" and "Loan Deductions", names no family matches, so
     * every one of them fell through to `other` — and the seeder created a second GSIS, HDMF, PHIC,
     * PhilHealth, Pag-IBIG and Withholding Tax there alongside the rows payroll actually charges.
     */
    $defaults = [
        'Withholding Tax' => [
            'Withholding Tax',
        ],
        'GSIS' => [
            'GSIS',
        ],
        'Pag-IBIG' => [
            'HDMF',
            'Pag-IBIG',
        ],
        'PHIC' => [
            'PHIC',
            'PhilHealth',
        ],
        'Attendance Deductions' => [
            'Late Deduction',
            'Absence Deduction',
            'Undertime Deduction',
        ],
        'Other Deductions' => [
            'SSS',
            'Manual Cash Advance Adjustment',
            'Laptop Loan',
            'Other Deductions',
            'Emergency Loan',
            'Policy Loan',
            'Consolidated Loan',
            'Salary Loan',
            'Housing Loan',
            'Pension Loan',
            'GSIS Financial Assistance Loan (GFAL)',
            'Multi-Purpose Loan (MPL)',
            'Calamity Loan',
        ],
    ];

    foreach ($defaults as $categoryName => $deductionNames) {
        foreach ($deductionNames as $deductionName) {
            deduction_resolve_type($pdo, $categoryName, $deductionName, 0.0);
        }
    }
}

/**
 * Category ids used to be derived by hashing the name (`crc32(name) % ...`), because there was no
 * category table to hold one. There is now, so this returns a real primary key — which is what makes
 * renaming a category possible without every reference to it breaking.
 */
function deduction_resolve_category(PDO $pdo, string $categoryName): int
{
    $categoryName = deduction_text($categoryName);

    if ($categoryName === '') {
        json_response([
            'success' => false,
            'message' => 'Deduction category is required.',
        ], 422);
    }

    return deduction_catalog_resolve_category($pdo, $categoryName);
}

function deduction_category_exists(PDO $pdo, int $categoryId): bool
{
    foreach (deduction_list_categories($pdo) as $category) {
        if ((int)($category['categoryId'] ?? 0) === $categoryId) {
            return true;
        }
    }

    return false;
}

function deduction_category_name_from_id(PDO $pdo, int $categoryId): string
{
    foreach (deduction_catalog_categories($pdo) as $category) {
        if ($category['id'] === $categoryId) {
            return $category['name'];
        }
    }

    return '';
}

function deduction_resolve_type(PDO $pdo, string $categoryName, string $deductionName, float $defaultAmount = 0.0): int
{
    $categoryName = deduction_text($categoryName);
    $deductionName = deduction_text($deductionName);
    if ($categoryName === '') {
        json_response([
            'success' => false,
            'message' => 'Deduction category is required.',
        ], 422);
    }

    if ($deductionName === '') {
        json_response([
            'success' => false,
            'message' => 'Deduction name is required.',
        ], 422);
    }

    $typeId = deduction_catalog_resolve_type($pdo, $categoryName, $deductionName);

    $table = deduction_catalog_table_for_id($pdo, $typeId);

    if ($defaultAmount > 0 && $table !== null) {
        // Only seeds an amount that has not been set; never overwrites what an admin configured.
        $update = $pdo->prepare(
            "UPDATE `{$table}` SET default_amount = :default_amount
             WHERE id = :id AND COALESCE(default_amount, 0.00) = 0.00"
        );
        $update->execute([
            ':default_amount' => deduction_decimal_string($defaultAmount),
            ':id' => $typeId,
        ]);
    }

    return $typeId;
}

function deduction_type_exists(PDO $pdo, int $deductionTypeId): bool
{
    return deduction_catalog_table_for_id($pdo, $deductionTypeId) !== null;
}

function deduction_fetch_payroll(PDO $pdo, int $payrollId): ?array
{
    if (!deduction_table_exists($pdo, 'Payroll')) {
        return null;
    }

    $statement = $pdo->prepare('SELECT * FROM Payroll WHERE payroll_id = :payroll_id LIMIT 1');
    $statement->execute([':payroll_id' => $payrollId]);
    $payroll = $statement->fetch();

    return $payroll ?: null;
}

function deduction_require_editable_payroll(PDO $pdo, int $payrollId): array
{
    $payroll = deduction_fetch_payroll($pdo, $payrollId);
    if ($payroll === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll record was not found.',
        ], 404);
    }

    $status = deduction_text($payroll['status'] ?? '');
    if (!in_array($status, DEDUCTION_EDITABLE_PAYROLL_STATUSES, true)) {
        json_response([
            'success' => false,
            'message' => 'Only draft or pending payroll records can have deductions edited.',
        ], 422);
    }

    return $payroll;
}

function deduction_recalculate_payroll(PDO $pdo, int $payrollId): void
{
    $amountExpression = deduction_column_exists($pdo, 'PayrollDeduction', 'amount')
        ? 'COALESCE(pd.amount, dt.default_amount, 0.00)'
        : 'COALESCE(dt.default_amount, 0.00)';

    $typeUnion = deduction_catalog_type_union_sql();
    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM({$amountExpression}), 0.00)
         FROM PayrollDeduction pd
         INNER JOIN {$typeUnion} dt ON dt.deduction_type_id = pd.deduction_type_id
         WHERE pd.payroll_id = :payroll_id"
    );
    $statement->execute([':payroll_id' => $payrollId]);
    $totalDeduction = deduction_decimal($statement->fetchColumn());

    // Native prepares are on, so the same placeholder cannot fill two markers — bind one per marker.
    $update = $pdo->prepare(
        'UPDATE Payroll
         SET total_deduction = :total_deduction,
             net_pay = COALESCE(gross_pay, 0.00) + COALESCE(total_allowance, 0.00) - :net_deduction
         WHERE payroll_id = :payroll_id'
    );
    $update->execute([
        ':total_deduction' => deduction_decimal_string($totalDeduction),
        ':net_deduction' => deduction_decimal_string($totalDeduction),
        ':payroll_id' => $payrollId,
    ]);
}

function deduction_list_categories(PDO $pdo): array
{
    return array_map(
        static fn (array $category): array => [
            'categoryId' => $category['id'],
            'categoryCode' => $category['code'],
            'categoryName' => $category['name'],
            'description' => $category['description'],
            'sortOrder' => $category['sortOrder'],
            'isActive' => $category['isActive'],
            'typeCount' => $category['typeCount'],
        ],
        deduction_catalog_categories($pdo)
    );
}

function deduction_list_types(PDO $pdo, ?int $categoryId = null): array
{
    deduction_catalog_ensure_schema($pdo);

    $where = '';
    $params = [];

    // Category ids are the family bands now, so this filters on the family the row came from.
    if ($categoryId !== null && $categoryId > 0) {
        $family = null;
        foreach (deduction_catalog_categories($pdo) as $candidate) {
            if ($candidate['id'] === $categoryId) {
                $family = $candidate['code'];
            }
        }

        if ($family === null) {
            return [];
        }

        $where = 'WHERE d.deduction_family = :family';
        $params[':family'] = $family;
    }

    $statement = $pdo->prepare(
        'SELECT
            d.id AS deductionTypeId,
            d.deduction_family AS categoryCode,
            d.source_table AS sourceTable,
            d.code AS deductionCode,
            d.name AS deductionName,
            d.default_amount AS defaultAmount,
            d.calculation_type AS calculationType,
            d.default_rate AS defaultRate,
            d.basis,
            d.threshold_amount AS thresholdAmount,
            d.base_floor AS baseFloor,
            d.base_cap AS baseCap,
            d.is_recurring AS isRecurring,
            d.is_active AS isActive,
            d.show_in_payroll AS showInPayroll,
            COUNT(pd.payroll_deduction_id) AS usageCount
         FROM ' . deduction_catalog_union_sql() . ' d
         LEFT JOIN payrolldeduction pd ON pd.deduction_type_id = d.id
         ' . $where . '
         GROUP BY d.id
         ORDER BY d.id'
    );
    $statement->execute($params);

    $labels = [];
    foreach (deduction_catalog_categories($pdo) as $category) {
        $labels[$category['code']] = ['name' => $category['name'], 'id' => $category['id']];
    }

    return array_map(static function (array $row) use ($labels): array {
        $family = $labels[$row['categoryCode']] ?? null;
        $row['categoryName'] = $family['name'] ?? $row['categoryCode'];
        $row['categoryId'] = $family['id'] ?? 0;

        return $row;
    }, $statement->fetchAll());
}

/**
 * Every deduction Settings can edit, in the flat shape the screen already renders.
 *
 * The four per-category tables this used to walk are gone; the rows now come from `deduction_types`
 * and the group is the row's category. Field names are preserved so the frontend keeps working:
 * `threshold_mode` is the catalog's `calculation_type`, and `is_percentage` is derived from it
 * rather than stored twice.
 */
function deduction_list_definition_types(PDO $pdo, string $groupKey = ''): array
{
    $filters = ['activeOnly' => false];

    if ($groupKey !== '') {
        $group = deduction_definition_group($groupKey);
        $filters['categoryCode'] = $group['key'];
    }

    return array_map(
        static fn (array $type): array => [
            'id' => $type['id'],
            'type_name' => $type['name'],
            'description' => $type['description'],
            'default_amount' => $type['defaultAmount'],
            'default_rate' => $type['defaultRate'],
            'basis' => $type['basis'],
            'threshold_amount' => $type['thresholdAmount'],
            'threshold_mode' => $type['calculationType'],
            'threshold_rules' => $type['thresholdRules'] !== null
                ? json_encode($type['thresholdRules'])
                : null,
            'base_floor' => $type['baseFloor'],
            'base_cap' => $type['baseCap'],
            'is_percentage' => $type['calculationType'] === 'percentage' ? 1 : 0,
            'is_recurring' => $type['isRecurring'] ? 1 : 0,
            'is_active' => $type['isActive'] ? 1 : 0,
            'show_in_payroll' => $type['showInPayroll'] ? 1 : 0,
            'groupKey' => $type['categoryCode'],
            'groupLabel' => $type['categoryName'],
            'categoryId' => $type['categoryId'],
            'definitionKey' => $type['categoryCode'] . ':' . $type['id'],
        ],
        deduction_catalog_types($pdo, $filters)
    );
}

function deduction_definition_payload(array $body): array
{
    $typeName = deduction_text($body['type_name'] ?? $body['typeName'] ?? $body['deductionName'] ?? $body['name'] ?? '');
    $description = deduction_text($body['description'] ?? '');
    $defaultAmount = deduction_decimal($body['default_amount'] ?? $body['defaultAmount'] ?? 0, 'Default amount');
    $thresholdAmount = deduction_decimal($body['threshold_amount'] ?? $body['thresholdAmount'] ?? 0, 'Threshold amount');
    $thresholdMode = strtolower(deduction_text($body['threshold_mode'] ?? $body['thresholdMode'] ?? 'fixed'));
    $thresholdRules = deduction_text($body['threshold_rules'] ?? $body['thresholdRules'] ?? '');
    $baseFloor = deduction_decimal($body['base_floor'] ?? $body['baseFloor'] ?? 0, 'Base floor');
    $baseCap = deduction_nullable_decimal($body['base_cap'] ?? $body['baseCap'] ?? null, 'Base cap');
    $isPercentage = deduction_bool_value($body['is_percentage'] ?? $body['isPercentage'] ?? null, false);
    $isActive = deduction_bool_value($body['is_active'] ?? $body['isActive'] ?? null, true);
    /*
     * The old four-table shape had no rate column at all, which is why a GSIS row could sit in
     * `percentage` mode carrying nothing but `default_amount 0.00` — the 9% actually charged lived
     * in a different table entirely. A percentage deduction is meaningless without it.
     */
    $defaultRate = deduction_rate_value($body['default_rate'] ?? $body['defaultRate'] ?? 0, 'Rate');

    if ($typeName === '') {
        json_response([
            'success' => false,
            'message' => 'Deduction type name is required.',
        ], 422);
    }

    if (!in_array($thresholdMode, ['fixed', 'percentage', 'tiered', 'bracket'], true)) {
        json_response([
            'success' => false,
            'message' => 'Threshold mode must be fixed, percentage, tiered, or bracket.',
        ], 422);
    }

    if ($thresholdMode === 'percentage' && $defaultRate <= 0) {
        json_response([
            'success' => false,
            'message' => 'A percentage deduction needs a rate greater than zero.',
        ], 422);
    }

    if ($defaultRate > 100) {
        json_response([
            'success' => false,
            'message' => 'Rate cannot exceed 100%.',
        ], 422);
    }

    if ($thresholdRules !== '') {
        json_decode($thresholdRules, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            json_response([
                'success' => false,
                'message' => 'Threshold rules must be valid JSON.',
            ], 422);
        }
    }

    return [
        'typeName' => $typeName,
        'description' => $description,
        'defaultAmount' => $defaultAmount,
        'defaultRate' => $defaultRate,
        'thresholdAmount' => $thresholdAmount,
        'thresholdMode' => $thresholdMode,
        'thresholdRules' => $thresholdRules !== '' ? $thresholdRules : null,
        'baseFloor' => $baseFloor,
        'baseCap' => $baseCap,
        'isPercentage' => $isPercentage,
        'isActive' => $isActive,
    ];
}

/**
 * Creates or updates a deduction from Settings.
 *
 * This used to insert into one of four per-category tables and then separately mirror the row into
 * `DeductionType` so payroll had a copy — two writes that could and did drift apart. There is one
 * row now, and it is the row payroll charges against.
 */
function deduction_create_definition_type(PDO $pdo, array $body): void
{
    $group = deduction_definition_group((string)($body['groupKey'] ?? $body['group_key'] ?? ''));
    $payload = deduction_definition_payload($body);

    // `deduction_catalog_resolve_type` is find-or-create, so editing an existing deduction and
    // adding a new one both land here and neither can produce a duplicate.
    $typeId = deduction_catalog_resolve_type($pdo, $group['categoryName'], $payload['typeName']);
    // The row lives in one of six family tables; resolve which before updating it.
    $table = deduction_catalog_table_for_id($pdo, $typeId);

    if ($table === null) {
        json_response([
            'success' => false,
            'message' => 'Unable to locate the deduction that was just saved.',
        ], 500);
    }

    $statement = $pdo->prepare(
        "UPDATE `{$table}`
         SET description = :description,
             calculation_type = :calculation_type,
             default_amount = :default_amount,
             default_rate = :default_rate,
             threshold_amount = :threshold_amount,
             threshold_rules = :threshold_rules,
             base_floor = :base_floor,
             base_cap = :base_cap,
             is_active = :is_active
         WHERE id = :id"
    );

    $statement->execute([
        ':description' => $payload['description'] !== '' ? $payload['description'] : null,
        // `is_percentage` was a second source of truth for the same fact. The mode decides.
        ':calculation_type' => $payload['thresholdMode'],
        ':default_amount' => deduction_decimal_string($payload['defaultAmount']),
        ':default_rate' => deduction_rate_string($payload['defaultRate']),
        ':threshold_amount' => deduction_decimal_string($payload['thresholdAmount']),
        ':threshold_rules' => $payload['thresholdRules'],
        ':base_floor' => deduction_decimal_string($payload['baseFloor']),
        ':base_cap' => $payload['baseCap'] === null ? null : deduction_decimal_string($payload['baseCap']),
        ':is_active' => $payload['isActive'] ? 1 : 0,
        ':id' => $typeId,
    ]);

    json_response([
        'success' => true,
        'message' => 'Deduction definition saved.',
        'definitionId' => $typeId,
        'definitionTypes' => deduction_list_definition_types($pdo),
        'categories' => deduction_catalog_categories($pdo),
    ], 201);
}

/**
 * Edits an existing deduction, addressed by id.
 *
 * Separate from the create path because that one is find-or-create keyed on the *name*: sending an
 * edited name through it would leave the original row untouched and add a second one. Editing has
 * to start from the id to be able to rename at all.
 */
function deduction_update_definition_type(PDO $pdo, array $body): void
{
    $typeId = deduction_int($body['definitionId'] ?? $body['definition_id'] ?? $body['id'] ?? 0);
    $table = $typeId > 0 ? deduction_catalog_table_for_id($pdo, $typeId) : null;

    if ($table === null) {
        json_response([
            'success' => false,
            'message' => 'Deduction was not found.',
        ], 404);
    }

    $payload = deduction_definition_payload($body);

    if ($payload['typeName'] === '') {
        json_response([
            'success' => false,
            'message' => 'Deduction name is required.',
        ], 422);
    }

    // Names are unique per family table, so a rename can collide with a sibling.
    $clash = $pdo->prepare("SELECT COUNT(*) FROM `{$table}` WHERE name = :name AND id <> :id");
    $clash->execute([':name' => $payload['typeName'], ':id' => $typeId]);

    if ((int)$clash->fetchColumn() > 0) {
        json_response([
            'success' => false,
            'message' => 'Another deduction in this category already uses that name.',
        ], 422);
    }

    $statement = $pdo->prepare(
        "UPDATE `{$table}`
         SET name = :name,
             description = :description,
             calculation_type = :calculation_type,
             default_amount = :default_amount,
             default_rate = :default_rate,
             threshold_amount = :threshold_amount,
             threshold_rules = :threshold_rules,
             base_floor = :base_floor,
             base_cap = :base_cap,
             is_active = :is_active
         WHERE id = :id"
    );

    $statement->execute([
        ':name' => $payload['typeName'],
        ':description' => $payload['description'] !== '' ? $payload['description'] : null,
        ':calculation_type' => $payload['thresholdMode'],
        ':default_amount' => deduction_decimal_string($payload['defaultAmount']),
        ':default_rate' => deduction_rate_string($payload['defaultRate']),
        ':threshold_amount' => deduction_decimal_string($payload['thresholdAmount']),
        ':threshold_rules' => $payload['thresholdRules'],
        ':base_floor' => deduction_decimal_string($payload['baseFloor']),
        ':base_cap' => $payload['baseCap'] === null ? null : deduction_decimal_string($payload['baseCap']),
        ':is_active' => $payload['isActive'] ? 1 : 0,
        ':id' => $typeId,
    ]);

    json_response([
        'success' => true,
        'message' => 'Deduction updated.',
        'definitionId' => $typeId,
        'definitionTypes' => deduction_list_definition_types($pdo),
        'categories' => deduction_catalog_categories($pdo),
    ]);
}

/**
 * The allowance catalog, shown beside the deductions so the two halves of a payslip are managed in
 * one place. `Allowance` is a flat name + amount list that payroll snapshots against a run.
 */
function deduction_list_allowances(PDO $pdo): array
{
    if (!deduction_table_exists($pdo, 'Allowance')) {
        return [];
    }

    return array_map(
        static fn (array $row): array => [
            'allowanceId' => (int)$row['allowance_id'],
            'allowanceName' => (string)$row['allowance_name'],
            'amount' => (float)$row['amount'],
        ],
        $pdo->query('SELECT allowance_id, allowance_name, amount FROM Allowance ORDER BY allowance_name')->fetchAll()
    );
}

function deduction_list_payroll_deductions(PDO $pdo, int $payrollId): array
{
    $amountExpression = deduction_column_exists($pdo, 'PayrollDeduction', 'amount')
        ? 'COALESCE(pd.amount, dt.default_amount, 0.00)'
        : 'COALESCE(dt.default_amount, 0.00)';
    $typeUnion = deduction_catalog_type_union_sql();

    $statement = $pdo->prepare(
        "SELECT
            pd.payroll_deduction_id AS payrollDeductionId,
            pd.payroll_id AS payrollId,
            pd.deduction_type_id AS deductionTypeId,
            dt.deduction_name AS deductionName,
            dt.category_name AS categoryName,
            {$amountExpression} AS amount
         FROM PayrollDeduction pd
         INNER JOIN {$typeUnion} dt ON dt.deduction_type_id = pd.deduction_type_id
         WHERE pd.payroll_id = :payroll_id
         ORDER BY pd.payroll_deduction_id ASC"
    );
    $statement->execute([':payroll_id' => $payrollId]);

    return array_map(
        static fn (array $row): array => [
            ...$row,
            'categoryId' => deduction_category_id_from_name((string)($row['categoryName'] ?? '')),
        ],
        $statement->fetchAll()
    );
}

function deduction_find_payroll_deduction(PDO $pdo, int $payrollDeductionId): ?array
{
    $statement = $pdo->prepare('SELECT * FROM PayrollDeduction WHERE payroll_deduction_id = :id LIMIT 1');
    $statement->execute([':id' => $payrollDeductionId]);
    $row = $statement->fetch();

    return $row ?: null;
}

function deduction_payload_type(PDO $pdo, array $body): array
{
    $categoryId = deduction_int($body['categoryId'] ?? $body['deductionCategoryId'] ?? $body['deduction_category_id'] ?? 0);
    $categoryName = deduction_text($body['categoryName'] ?? $body['category'] ?? '');
    $deductionName = deduction_text($body['deductionName'] ?? $body['deduction_name'] ?? $body['name'] ?? '');
    $defaultAmount = deduction_decimal($body['defaultAmount'] ?? $body['default_amount'] ?? 0, 'Default amount');
    $calculationType = strtolower(deduction_text($body['calculationType'] ?? $body['calculation_type'] ?? 'fixed'));
    $defaultRate = deduction_rate_value($body['defaultRate'] ?? $body['default_rate'] ?? 0, 'Default rate');
    $basis = deduction_text($body['basis'] ?? 'basic_salary') ?: 'basic_salary';
    $isRecurring = deduction_bool_value($body['isRecurring'] ?? $body['is_recurring'] ?? null, false);
    $isActive = deduction_bool_value($body['isActive'] ?? $body['is_active'] ?? null, true);

    if (!in_array($calculationType, ['fixed', 'percentage'], true)) {
        json_response([
            'success' => false,
            'message' => 'Calculation type must be fixed or percentage.',
        ], 422);
    }

    if ($categoryId <= 0 && $categoryName !== '') {
        $categoryId = deduction_resolve_category($pdo, $categoryName);
    }

    if ($categoryId > 0 && $categoryName === '') {
        $categoryName = deduction_category_name_from_id($pdo, $categoryId);
    }

    if ($categoryName === '') {
        json_response([
            'success' => false,
            'message' => 'Deduction category is required.',
        ], 422);
    }

    if ($deductionName === '') {
        json_response([
            'success' => false,
            'message' => 'Deduction name is required.',
        ], 422);
    }

    return [
        'categoryId' => $categoryId,
        'categoryName' => $categoryName,
        'deductionName' => $deductionName,
        'defaultAmount' => $defaultAmount,
        'calculationType' => $calculationType,
        'defaultRate' => $defaultRate,
        'basis' => $basis,
        'isRecurring' => $isRecurring,
        'isActive' => $isActive,
    ];
}

function deduction_create_category(PDO $pdo, array $body): void
{
    $categoryName = deduction_text($body['categoryName'] ?? $body['category_name'] ?? $body['name'] ?? '');
    $categoryId = deduction_resolve_category($pdo, $categoryName);

    json_response([
        'success' => true,
        'message' => 'Deduction category saved.',
        'categoryId' => $categoryId,
        'categories' => deduction_list_categories($pdo),
    ], 201);
}

/**
 * Categories are the six family tables and their names are fixed in `DEDUCTION_FAMILIES`, so there
 * is no row to rename — renaming would mean renaming a table that payroll history points into.
 */
function deduction_update_category(PDO $pdo, array $body): void
{
    json_response([
        'success' => false,
        'message' => 'Deduction categories are fixed tables and cannot be renamed.',
        'categories' => deduction_list_categories($pdo),
    ], 422);
}

function deduction_create_type(PDO $pdo, array $body): void
{
    $payload = deduction_payload_type($pdo, $body);
    $deductionTypeId = deduction_resolve_type($pdo, $payload['categoryName'], $payload['deductionName'], $payload['defaultAmount']);

    $table = deduction_catalog_table_for_id($pdo, $deductionTypeId);

    if ($table === null) {
        json_response([
            'success' => false,
            'message' => 'Unable to locate the deduction that was just saved.',
        ], 500);
    }

    $statement = $pdo->prepare(
        "UPDATE `{$table}`
         SET default_amount = :default_amount,
             calculation_type = :calculation_type,
             default_rate = :default_rate,
             basis = :basis,
             is_recurring = :is_recurring,
             is_active = :is_active
         WHERE id = :id"
    );
    $statement->execute([
        ':default_amount' => deduction_decimal_string($payload['defaultAmount']),
        ':calculation_type' => $payload['calculationType'],
        ':default_rate' => deduction_rate_string($payload['defaultRate']),
        ':basis' => $payload['basis'],
        ':is_recurring' => $payload['isRecurring'] ? 1 : 0,
        ':is_active' => $payload['isActive'] ? 1 : 0,
        ':id' => $deductionTypeId,
    ]);

    json_response([
        'success' => true,
        'message' => 'Deduction type saved.',
        'deductionTypeId' => $deductionTypeId,
        'types' => deduction_list_types($pdo),
    ], 201);
}

function deduction_update_type(PDO $pdo, array $body): void
{
    $deductionTypeId = deduction_int($body['deductionTypeId'] ?? $body['deduction_type_id'] ?? 0);
    if ($deductionTypeId <= 0 || !deduction_type_exists($pdo, $deductionTypeId)) {
        json_response([
            'success' => false,
            'message' => 'Deduction type was not found.',
        ], 404);
    }

    $payload = deduction_payload_type($pdo, $body);

    $currentTable = deduction_catalog_table_for_id($pdo, $deductionTypeId);
    $targetFamily = deduction_family_key_for_name($payload['categoryName']);
    $targetTable = DEDUCTION_FAMILIES[$targetFamily]['table'];

    if ($currentTable === null) {
        json_response([
            'success' => false,
            'message' => 'Deduction type was not found.',
        ], 404);
    }

    /*
     * Changing a deduction's category means moving the row to a different table, since each family
     * is its own table. Refused while payroll history points at it — the id would keep resolving,
     * but past runs would silently start reporting under a different family.
     */
    if ($currentTable !== $targetTable) {
        $used = $pdo->prepare('SELECT COUNT(*) FROM payrolldeduction WHERE deduction_type_id = :id');
        $used->execute([':id' => $deductionTypeId]);

        if ((int)$used->fetchColumn() > 0) {
            json_response([
                'success' => false,
                'message' => 'This deduction already appears on payroll records and cannot be moved to another category.',
            ], 422);
        }
    }

    $statement = $pdo->prepare(
        "UPDATE `{$currentTable}`
         SET name = :name,
             default_amount = :default_amount,
             calculation_type = :calculation_type,
             default_rate = :default_rate,
             basis = :basis,
             is_recurring = :is_recurring,
             is_active = :is_active
         WHERE id = :id"
    );

    try {
        $statement->execute([
            ':name' => $payload['deductionName'],
            ':default_amount' => deduction_decimal_string($payload['defaultAmount']),
            ':calculation_type' => $payload['calculationType'],
            ':default_rate' => deduction_rate_string($payload['defaultRate']),
            ':basis' => $payload['basis'],
            ':is_recurring' => $payload['isRecurring'] ? 1 : 0,
            ':is_active' => $payload['isActive'] ? 1 : 0,
            ':id' => $deductionTypeId,
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'That category already has a deduction with this name.',
            ], 422);
        }

        throw $exception;
    }

    json_response([
        'success' => true,
        'message' => 'Deduction type updated.',
        'types' => deduction_list_types($pdo),
    ]);
}

function deduction_create_payroll_deduction(PDO $pdo, array $body): void
{
    $payrollId = deduction_int($body['payrollId'] ?? $body['payroll_id'] ?? 0);
    deduction_require_editable_payroll($pdo, $payrollId);

    $deductionTypeId = deduction_int($body['deductionTypeId'] ?? $body['deduction_type_id'] ?? 0);
    if ($deductionTypeId <= 0) {
        $payload = deduction_payload_type($pdo, $body);
        $deductionTypeId = deduction_resolve_type($pdo, $payload['categoryName'], $payload['deductionName'], $payload['defaultAmount']);
    } elseif (!deduction_type_exists($pdo, $deductionTypeId)) {
        json_response([
            'success' => false,
            'message' => 'Deduction type was not found.',
        ], 422);
    }

    $amount = deduction_decimal($body['amount'] ?? $body['defaultAmount'] ?? 0);

    $statement = $pdo->prepare(
        'INSERT INTO PayrollDeduction (payroll_id, deduction_type_id, amount)
         VALUES (:payroll_id, :deduction_type_id, :amount)'
    );
    $statement->execute([
        ':payroll_id' => $payrollId,
        ':deduction_type_id' => $deductionTypeId,
        ':amount' => deduction_decimal_string($amount),
    ]);

    deduction_recalculate_payroll($pdo, $payrollId);

    json_response([
        'success' => true,
        'message' => 'Payroll deduction added.',
        'payrollDeductionId' => (int)$pdo->lastInsertId(),
        'payrollDeductions' => deduction_list_payroll_deductions($pdo, $payrollId),
    ], 201);
}

function deduction_update_payroll_deduction(PDO $pdo, array $body): void
{
    $payrollDeductionId = deduction_int($body['payrollDeductionId'] ?? $body['payroll_deduction_id'] ?? 0);
    $existing = $payrollDeductionId > 0 ? deduction_find_payroll_deduction($pdo, $payrollDeductionId) : null;

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll deduction was not found.',
        ], 404);
    }

    $payrollId = (int)($existing['payroll_id'] ?? 0);
    deduction_require_editable_payroll($pdo, $payrollId);

    $deductionTypeId = deduction_int($body['deductionTypeId'] ?? $body['deduction_type_id'] ?? $existing['deduction_type_id'] ?? 0);
    if ($deductionTypeId <= 0 || !deduction_type_exists($pdo, $deductionTypeId)) {
        json_response([
            'success' => false,
            'message' => 'Deduction type was not found.',
        ], 422);
    }

    $amount = deduction_decimal($body['amount'] ?? $existing['amount'] ?? 0);

    $statement = $pdo->prepare(
        'UPDATE PayrollDeduction
         SET deduction_type_id = :deduction_type_id,
             amount = :amount
         WHERE payroll_deduction_id = :payroll_deduction_id'
    );
    $statement->execute([
        ':deduction_type_id' => $deductionTypeId,
        ':amount' => deduction_decimal_string($amount),
        ':payroll_deduction_id' => $payrollDeductionId,
    ]);

    deduction_recalculate_payroll($pdo, $payrollId);

    json_response([
        'success' => true,
        'message' => 'Payroll deduction updated.',
        'payrollDeductions' => deduction_list_payroll_deductions($pdo, $payrollId),
    ]);
}

/**
 * Categories are the six family tables, so there is nothing to delete — removing one would mean
 * dropping a table holding payroll history. Deactivate the deductions inside it instead.
 */
function deduction_delete_category(PDO $pdo, int $categoryId): void
{
    json_response([
        'success' => false,
        'message' => 'Deduction categories are fixed tables and cannot be deleted. '
            . 'Deactivate the deductions inside the category instead.',
        'categories' => deduction_list_categories($pdo),
    ], 422);
}

function deduction_delete_type(PDO $pdo, int $deductionTypeId): void
{
    if ($deductionTypeId <= 0 || !deduction_type_exists($pdo, $deductionTypeId)) {
        json_response([
            'success' => false,
            'message' => 'Deduction type was not found.',
        ], 404);
    }

    $statement = $pdo->prepare('SELECT COUNT(*) FROM PayrollDeduction WHERE deduction_type_id = :deduction_type_id');
    $statement->execute([':deduction_type_id' => $deductionTypeId]);
    if ((int)$statement->fetchColumn() > 0) {
        json_response([
            'success' => false,
            'message' => 'Deduction type cannot be deleted while payroll records use it.',
        ], 422);
    }

    /*
     * `payrolldeduction` has no foreign key to fall back on now, so this check is the only thing
     * standing between a delete and an orphaned payroll reference. It runs above.
     */
    $table = deduction_catalog_table_for_id($pdo, $deductionTypeId);
    $delete = $pdo->prepare("DELETE FROM `{$table}` WHERE id = :id");
    $delete->execute([':id' => $deductionTypeId]);

    /*
     * The deduction's column on `payroll` is deliberately left in place. Dropping it would discard
     * whatever past runs charged under this deduction, and the check above only proves no
     * `payrolldeduction` row still points here — not that no payroll ever did.
     */

    json_response([
        'success' => true,
        'message' => 'Deduction type deleted.',
        'types' => deduction_list_types($pdo),
    ]);
}

function deduction_delete_payroll_deduction(PDO $pdo, int $payrollDeductionId): void
{
    $existing = $payrollDeductionId > 0 ? deduction_find_payroll_deduction($pdo, $payrollDeductionId) : null;
    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Payroll deduction was not found.',
        ], 404);
    }

    $payrollId = (int)($existing['payroll_id'] ?? 0);
    deduction_require_editable_payroll($pdo, $payrollId);

    $delete = $pdo->prepare('DELETE FROM PayrollDeduction WHERE payroll_deduction_id = :payroll_deduction_id');
    $delete->execute([':payroll_deduction_id' => $payrollDeductionId]);

    deduction_recalculate_payroll($pdo, $payrollId);

    json_response([
        'success' => true,
        'message' => 'Payroll deduction removed.',
        'payrollDeductions' => deduction_list_payroll_deductions($pdo, $payrollId),
    ]);
}

ensure_deduction_schema($pdo);
deduction_seed_defaults($pdo);

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        $payrollId = deduction_int($_GET['payrollId'] ?? $_GET['payroll_id'] ?? 0);
        $categoryId = deduction_int($_GET['categoryId'] ?? $_GET['deductionCategoryId'] ?? $_GET['deduction_category_id'] ?? 0);
        $action = deduction_text($_GET['action'] ?? '');

        if ($action === 'categories') {
            json_response([
                'success' => true,
                'categories' => deduction_list_categories($pdo),
            ]);
        }

        if ($action === 'types') {
            json_response([
                'success' => true,
                'types' => deduction_list_types($pdo, $categoryId > 0 ? $categoryId : null),
            ]);
        }

        if ($action === 'definition_types' || $action === 'definitions') {
            json_response([
                'success' => true,
                'definitionTypes' => deduction_list_definition_types(
                    $pdo,
                    deduction_text($_GET['groupKey'] ?? $_GET['group_key'] ?? '')
                ),
            ]);
        }

        if ($action === 'payroll' || $payrollId > 0) {
            if ($payrollId <= 0) {
                json_response([
                    'success' => false,
                    'message' => 'Payroll record is required.',
                ], 422);
            }

            json_response([
                'success' => true,
                'payrollDeductions' => deduction_list_payroll_deductions($pdo, $payrollId),
            ]);
        }

        json_response([
            'success' => true,
            'categories' => deduction_list_categories($pdo),
            'types' => deduction_list_types($pdo),
            'definitionTypes' => deduction_list_definition_types($pdo),
            'allowances' => deduction_list_allowances($pdo),
        ]);
    }

    $body = read_json_body();
    $action = deduction_text($body['action'] ?? '');

    if ($method === 'POST') {
        if ($action === 'category') {
            deduction_create_category($pdo, $body);
        }

        if ($action === 'type') {
            deduction_create_type($pdo, $body);
        }

        if ($action === 'definition_type' || $action === 'definition') {
            deduction_create_definition_type($pdo, $body);
        }

        if ($action === 'payroll' || $action === 'payroll_deduction') {
            deduction_create_payroll_deduction($pdo, $body);
        }

        json_response([
            'success' => false,
            'message' => 'Unsupported deduction create action.',
        ], 422);
    }

    if ($method === 'PUT') {
        if ($action === 'category') {
            deduction_update_category($pdo, $body);
        }

        if ($action === 'type') {
            deduction_update_type($pdo, $body);
        }

        if ($action === 'definition_type' || $action === 'definition') {
            deduction_update_definition_type($pdo, $body);
        }

        if ($action === 'payroll' || $action === 'payroll_deduction') {
            deduction_update_payroll_deduction($pdo, $body);
        }

        json_response([
            'success' => false,
            'message' => 'Unsupported deduction update action.',
        ], 422);
    }

    if ($method === 'DELETE') {
        $deleteBody = $body ?: read_json_body();
        $deleteAction = deduction_text($deleteBody['action'] ?? $_GET['action'] ?? '');

        if ($deleteAction === 'category') {
            deduction_delete_category($pdo, deduction_int($deleteBody['categoryId'] ?? $_GET['categoryId'] ?? 0));
        }

        if ($deleteAction === 'type') {
            deduction_delete_type($pdo, deduction_int($deleteBody['deductionTypeId'] ?? $_GET['deductionTypeId'] ?? 0));
        }

        if ($deleteAction === 'payroll' || $deleteAction === 'payroll_deduction') {
            deduction_delete_payroll_deduction($pdo, deduction_int($deleteBody['payrollDeductionId'] ?? $_GET['payrollDeductionId'] ?? 0));
        }

        json_response([
            'success' => false,
            'message' => 'Unsupported deduction delete action.',
        ], 422);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Deduction API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process deduction request.',
    ], 500);
}

