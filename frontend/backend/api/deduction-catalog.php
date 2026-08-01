<?php
declare(strict_types=1);

/**
 * The deduction catalog: one table per deduction family, listed in DEDUCTION_FAMILIES.
 *
 * This replaced two parallel catalogs that never agreed with each other — `deductiontype`, which
 * carried its category as a repeated string and was the only thing payroll read, and the four
 * structurally identical tables Settings wrote to and payroll ignored. Both Settings and payroll now
 * read these tables, so a rate edited in Settings is the rate payroll charges.
 *
 * Payroll stores what it charged in a column per deduction on `payroll`; `payrolldeduction` keeps
 * the itemised rows those columns are derived from.
 *
 * @see backend/database/split_deduction_tables.php     the family split
 * @see backend/database/payroll_deduction_columns.php  the payroll columns
 */

function deduction_catalog_slug(string $value): string
{
    $slug = preg_replace('/[^a-z0-9]+/', '_', strtolower(trim($value))) ?? '';

    return trim($slug, '_');
}

/**
 * One table per deduction family. The key is the "category" the rest of the app talks in; `band` is
 * where that table's AUTO_INCREMENT starts.
 *
 * The bands matter: `payrolldeduction.deduction_type_id` can point into any of these six tables and
 * cannot carry a foreign key to all of them, so ids have to stay unique across the whole set for a
 * reference to resolve. Non-overlapping bands are what guarantees that.
 */
const DEDUCTION_FAMILIES = [
    'attendance' => ['table' => 'attendance_deductions', 'label' => 'Attendance Deductions', 'band' => 1000],
    'gsis' => ['table' => 'gsis_deductions', 'label' => 'GSIS', 'band' => 2000],
    'pagibig' => ['table' => 'pagibig_deductions', 'label' => 'Pag-IBIG', 'band' => 3000],
    'phic' => ['table' => 'phic_deductions', 'label' => 'PHIC', 'band' => 4000],
    'tax' => ['table' => 'withholding_tax_deductions', 'label' => 'Withholding Tax', 'band' => 5000],
    'other' => ['table' => 'other_deductions', 'label' => 'Other Deductions', 'band' => 6000],
];

function deduction_family_for_key(string $key): ?array
{
    return DEDUCTION_FAMILIES[strtolower(trim($key))] ?? null;
}

/** Resolves a free-text category name back to one of the six families. */
function deduction_family_key_for_name(string $categoryName): string
{
    $name = strtolower(trim($categoryName));

    foreach (DEDUCTION_FAMILIES as $key => $family) {
        if ($name === strtolower($family['label']) || $name === $key) {
            return $key;
        }
    }

    return match (true) {
        str_contains($name, 'attendance') => 'attendance',
        str_contains($name, 'gsis') => 'gsis',
        str_contains($name, 'pag-ibig'), str_contains($name, 'pagibig'), str_contains($name, 'hdmf') => 'pagibig',
        str_contains($name, 'phic'), str_contains($name, 'philhealth') => 'phic',
        str_contains($name, 'withholding'), str_contains($name, 'tax') => 'tax',
        default => 'other',
    };
}

function deduction_catalog_ensure_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $columns = 'id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        code VARCHAR(80) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT NULL,
        calculation_type ENUM("fixed", "percentage", "tiered", "bracket") NOT NULL DEFAULT "fixed",
        default_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        /*
         * 8 decimal places, not 4. Attendance rates are divisions that do not terminate — a day is
         * monthly salary over 22 — and rounding those to 4 places moves the charge by a centavo on
         * a mid-range salary. No literal percent sign in this comment: the whole block is a
         * sprintf() template and a stray one is read as a format specifier.
         */
        default_rate DECIMAL(12,8) NOT NULL DEFAULT 0.00000000,
        basis VARCHAR(40) NOT NULL DEFAULT "basic_salary",
        threshold_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        threshold_rules JSON NULL,
        base_floor DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        base_cap DECIMAL(12,2) NULL,
        is_recurring TINYINT(1) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        show_in_payroll TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_%s_code (code),
        UNIQUE KEY uq_%s_name (name),
        KEY idx_%s_active (is_active)';

    foreach (DEDUCTION_FAMILIES as $family) {
        $short = str_replace('_deductions', '', $family['table']);
        $pdo->exec(sprintf(
            'CREATE TABLE IF NOT EXISTS `%s` (%s) ENGINE=InnoDB AUTO_INCREMENT=%d DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
            $family['table'],
            sprintf($columns, $short, $short, $short),
            $family['band']
        ));
    }

    deduction_catalog_sync_payroll_columns($pdo);

    $ensured = true;
}

/**
 * The six family tables as one result set.
 *
 * `payrolldeduction.deduction_type_id` can point into any of them and carries no foreign key, so
 * every query that needs to turn an id back into a deduction joins this. It is inlined as a derived
 * table rather than kept as a view: `payroll` now stores each deduction in its own column, and the
 * `all_deductions` / `payroll_deduction_columns` views that used to stand in for that are gone.
 *
 * Always used as `... INNER JOIN ' . deduction_catalog_union_sql() . ' d ON d.id = ...`.
 */
function deduction_catalog_union_sql(): string
{
    $parts = [];
    foreach (DEDUCTION_FAMILIES as $key => $family) {
        $parts[] = sprintf(
            'SELECT id, code, name, description, calculation_type, default_amount, default_rate, basis,
                    threshold_amount, threshold_rules, base_floor, base_cap, is_recurring, is_active,
                    show_in_payroll, sort_order, %s AS deduction_family, %s AS source_table
             FROM `%s`',
            deduction_catalog_sql_string($key),
            deduction_catalog_sql_string($family['table']),
            $family['table']
        );
    }

    return '(' . implode(' UNION ALL ', $parts) . ')';
}

/**
 * Quotes a literal for the union builders. They only ever quote DEDUCTION_FAMILIES keys, labels and
 * table names — values written in this file, never user input — which is what lets the builders work
 * without a connection and be called from query builders that have none.
 */
function deduction_catalog_sql_string(string $value): string
{
    return "'" . str_replace(['\\', "'"], ['\\\\', "\\'"], $value) . "'";
}

/**
 * The same union presented under the column names the old single `DeductionType` table used.
 *
 * The payslip, report and payroll-detail queries were written against that shape and read
 * `dt.deduction_name` / `dt.category_name`. Rather than rewrite each one around the family tables,
 * they join this and keep working — `category_name` resolves the family key back to its label.
 */
function deduction_catalog_type_union_sql(): string
{
    $labels = [];
    foreach (DEDUCTION_FAMILIES as $key => $family) {
        $labels[] = sprintf(
            'WHEN %s THEN %s',
            deduction_catalog_sql_string($key),
            deduction_catalog_sql_string($family['label'])
        );
    }

    return '(SELECT
                d.id AS deduction_type_id,
                d.code AS deduction_code,
                d.name AS deduction_name,
                CASE d.deduction_family ' . implode(' ', $labels) . ' END AS category_name,
                d.deduction_family AS category_code,
                d.source_table,
                d.description,
                d.default_amount,
                d.default_rate,
                d.calculation_type,
                d.basis,
                d.threshold_amount,
                d.threshold_rules,
                d.base_floor,
                d.base_cap,
                d.is_recurring,
                d.is_active,
                d.show_in_payroll,
                d.sort_order
             FROM ' . deduction_catalog_union_sql() . ' d)';
}

/** The `payroll` column a deduction is stored in. Codes are already slugs; 64 is MySQL's limit. */
function deduction_catalog_payroll_column(string $code): string
{
    $column = preg_replace('/[^a-z0-9_]+/', '_', strtolower(trim($code))) ?? '';
    $column = trim($column, '_');

    if ($column === '') {
        return '';
    }

    // Truncating alone could collide; the hash keeps long codes distinct.
    return strlen($column) <= 64 ? $column : substr($column, 0, 55) . '_' . substr(md5($code), 0, 8);
}

/**
 * Gives every payroll-visible deduction its own column on `payroll`, the way the reference schema
 * lays out `sss_contribution` / `philhealth_contribution` / `other_deductions`.
 *
 * This is what replaced the `payroll_deduction_columns` view. The trade-off is real and worth
 * naming: a new deduction now means an ALTER on the table holding financial history, where the view
 * cost nothing. `payrolldeduction` remains the record of truth — these columns are kept in step with
 * it by payroll_sync_deductions() — so a column that ever drifted can be rebuilt from it.
 */
function deduction_catalog_sync_payroll_columns(PDO $pdo): void
{
    /*
     * ALTER is an implicit commit in MySQL: running one inside a caller's transaction would end that
     * transaction early and its later commit() would fail. Provisioning waits for open work to end.
     */
    if ($pdo->inTransaction()) {
        return;
    }

    $existing = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `payroll`') as $row) {
        $existing[strtolower((string)$row['Field'])] = true;
    }

    $after = isset($existing['total_allowance']) ? 'total_allowance' : null;
    $statement = $pdo->query(
        'SELECT code FROM ' . deduction_catalog_union_sql() . ' d
         WHERE d.is_active = 1 AND d.show_in_payroll = 1 ORDER BY d.id'
    );

    foreach ($statement as $row) {
        $column = deduction_catalog_payroll_column((string)$row['code']);

        if ($column === '') {
            continue;
        }

        if (!isset($existing[$column])) {
            $pdo->exec(sprintf(
                'ALTER TABLE `payroll` ADD COLUMN `%s` DECIMAL(10,2) NOT NULL DEFAULT 0.00%s',
                $column,
                $after === null ? '' : sprintf(' AFTER `%s`', $after)
            ));
            $existing[$column] = true;
        }

        $after = $column;
    }
}

/**
 * Which of the six tables holds a given deduction id.
 *
 * Needed because `payrolldeduction.deduction_type_id` no longer has a foreign key to follow — with
 * the catalog split across six tables, no single constraint can cover it. Returns null if the id
 * belongs to none of them.
 */
function deduction_catalog_table_for_id(PDO $pdo, int $deductionId): ?string
{
    if ($deductionId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT d.source_table FROM ' . deduction_catalog_union_sql() . ' d WHERE d.id = :id LIMIT 1'
    );
    $statement->execute([':id' => $deductionId]);
    $table = $statement->fetchColumn();

    return $table === false ? null : (string)$table;
}

/**
 * Categories are the six tables themselves now, so this returns the family's band rather than a row
 * id. Kept because callers still speak in category names.
 */
function deduction_catalog_resolve_category(PDO $pdo, string $categoryName): int
{
    deduction_catalog_ensure_schema($pdo);

    $key = deduction_family_key_for_name($categoryName);

    return DEDUCTION_FAMILIES[$key]['band'];
}

/**
 * Resolves a (category, deduction) pair to a deduction id, creating the row if it is new.
 *
 * The category decides which of the six tables the row lives in. Name alone cannot identify a
 * deduction — "MPL" exists under both GSIS and Pag-IBIG — so it is only unique within its table.
 */
function deduction_catalog_resolve_type(PDO $pdo, string $categoryName, string $deductionName): int
{
    deduction_catalog_ensure_schema($pdo);

    $name = trim($deductionName);

    if ($name === '') {
        throw new InvalidArgumentException('A deduction name is required.');
    }

    $familyKey = deduction_family_key_for_name($categoryName);
    $table = DEDUCTION_FAMILIES[$familyKey]['table'];

    $statement = $pdo->prepare("SELECT id FROM `{$table}` WHERE name = :name LIMIT 1");
    $statement->execute([':name' => $name]);
    $id = (int)$statement->fetchColumn();

    if ($id > 0) {
        return $id;
    }

    /*
     * Codes have to stay unique across all six tables, not just within one: the register keys its
     * columns by code, and each code becomes a column on `payroll`.
     */
    $base = deduction_catalog_slug($name) ?: 'deduction';
    $code = $base;
    $exists = $pdo->prepare(
        'SELECT COUNT(*) FROM ' . deduction_catalog_union_sql() . ' d WHERE d.code = :code'
    );
    $exists->execute([':code' => $code]);

    if ((int)$exists->fetchColumn() > 0) {
        $code = $familyKey . '_' . $base;
    }

    $suffix = 2;
    while (true) {
        $exists->execute([':code' => $code]);
        if ((int)$exists->fetchColumn() === 0) {
            break;
        }
        $code = $base . '_' . $suffix++;
    }

    /*
     * `sort_order` is read first rather than as a subquery inside the INSERT: MySQL refuses to
     * select from the table it is inserting into (error 1093), and that failure is indistinguishable
     * from a duplicate-key race once it reaches the catch below.
     */
    $nextSort = (int)$pdo->query("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM `{$table}`")->fetchColumn();

    $insert = $pdo->prepare(
        "INSERT INTO `{$table}` (code, name, sort_order) VALUES (:code, :name, :sort_order)"
    );

    try {
        $insert->execute([':code' => $code, ':name' => $name, ':sort_order' => $nextSort]);
        $newId = (int)$pdo->lastInsertId();
    } catch (PDOException $exception) {
        // Only a duplicate key means another request won the race; anything else is a real fault
        // and must not be reported as "the row already existed".
        if ($exception->getCode() !== '23000') {
            throw $exception;
        }

        $statement->execute([':name' => $name]);

        return (int)$statement->fetchColumn();
    }

    // A new deduction means a new column on `payroll`.
    deduction_catalog_sync_payroll_columns($pdo);

    return $newId;
}

/**
 * Every type with its category, newest schema shape. `$filters` accepts `activeOnly` and
 * `payrollOnly` — the latter returns the types that earn a column in the payroll register, which is
 * what replaced the hard-coded column list in the payroll workspace.
 */
function deduction_catalog_types(PDO $pdo, array $filters = []): array
{
    deduction_catalog_ensure_schema($pdo);

    $conditions = [];

    if (!empty($filters['activeOnly'])) {
        $conditions[] = 'd.is_active = 1';
    }

    if (!empty($filters['payrollOnly'])) {
        $conditions[] = 'd.show_in_payroll = 1';
    }

    if (!empty($filters['categoryCode'])) {
        $conditions[] = 'd.deduction_family = :category_code';
    }

    $whereSql = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

    // The union spares callers from having to know which family table a deduction lives in.
    $statement = $pdo->prepare(
        'SELECT d.* FROM ' . deduction_catalog_union_sql() . ' d' . $whereSql . ' ORDER BY d.id'
    );

    if (!empty($filters['categoryCode'])) {
        $statement->bindValue(':category_code', $filters['categoryCode']);
    }

    $statement->execute();

    return array_map(static function (array $row): array {
        $family = DEDUCTION_FAMILIES[$row['deduction_family']] ?? null;

        return [
            'id' => (int)$row['id'],
            'code' => (string)$row['code'],
            'name' => (string)$row['name'],
            'description' => $row['description'] !== null ? (string)$row['description'] : '',
            'calculationType' => (string)$row['calculation_type'],
            'defaultAmount' => (float)$row['default_amount'],
            'defaultRate' => (float)$row['default_rate'],
            'basis' => (string)$row['basis'],
            'thresholdAmount' => (float)$row['threshold_amount'],
            'thresholdRules' => $row['threshold_rules'] !== null ? json_decode((string)$row['threshold_rules'], true) : null,
            'baseFloor' => (float)$row['base_floor'],
            'baseCap' => $row['base_cap'] !== null ? (float)$row['base_cap'] : null,
            'isRecurring' => (int)$row['is_recurring'] === 1,
            'isActive' => (int)$row['is_active'] === 1,
            'showInPayroll' => (int)$row['show_in_payroll'] === 1,
            'sortOrder' => (int)$row['sort_order'],
            'categoryId' => $family['band'] ?? 0,
            'categoryCode' => (string)$row['deduction_family'],
            'categoryName' => $family['label'] ?? (string)$row['deduction_family'],
            'sourceTable' => (string)$row['source_table'],
            'payrollColumn' => deduction_catalog_payroll_column((string)$row['code']),
        ];
    }, $statement->fetchAll());
}

/** The six family tables, presented the way the Settings screen expects categories. */
function deduction_catalog_categories(PDO $pdo, bool $activeOnly = false): array
{
    deduction_catalog_ensure_schema($pdo);

    $categories = [];
    $sortOrder = 0;

    foreach (DEDUCTION_FAMILIES as $key => $family) {
        $count = (int)$pdo->query("SELECT COUNT(*) FROM `{$family['table']}`")->fetchColumn();

        $categories[] = [
            'id' => $family['band'],
            'code' => $key,
            'name' => $family['label'],
            'description' => 'Deductions stored in ' . $family['table'] . '.',
            'sortOrder' => $sortOrder += 10,
            'isActive' => true,
            'typeCount' => $count,
            'table' => $family['table'],
        ];
    }

    return $categories;
}

/**
 * Computes what a type deducts from a given base.
 *
 * `base_floor` / `base_cap` clamp the salary the rate applies to — that is how a contribution can be
 * "9% of salary, but never on more than the cap". `threshold_amount` is a minimum the result is
 * lifted to. Tiered and bracket modes walk `threshold_rules`, which is a list of
 * `{ "up_to": <amount|null>, "amount": <fixed>, "rate": <percent> }` ordered low to high.
 */
function deduction_catalog_compute(array $type, float $base): float
{
    $floor = (float)($type['baseFloor'] ?? 0);
    $cap = $type['baseCap'] ?? null;
    $effectiveBase = max($base, $floor);

    if ($cap !== null && $cap > 0) {
        $effectiveBase = min($effectiveBase, (float)$cap);
    }

    $amount = match ($type['calculationType'] ?? 'fixed') {
        'percentage' => $effectiveBase * ((float)($type['defaultRate'] ?? 0) / 100),
        'tiered', 'bracket' => deduction_catalog_compute_tiered($type, $effectiveBase),
        default => (float)($type['defaultAmount'] ?? 0),
    };

    $threshold = (float)($type['thresholdAmount'] ?? 0);

    if ($threshold > 0 && $amount < $threshold) {
        $amount = $threshold;
    }

    return round(max(0.0, $amount), 2);
}

/**
 * Walks `threshold_rules` and returns what the matching bracket charges.
 *
 * Two rule shapes are understood, because two kinds of deduction need different arithmetic:
 *
 *   flat        {"up_to": 1500, "rate": 1}                     -> base * rate%
 *               {"up_to": null, "amount": 200}                 -> the amount
 *
 *   progressive {"up_to": 66666, "base_tax": 1875,
 *                "rate": 20, "excess_over": 33333}             -> base_tax + rate% of the excess
 *
 * The progressive shape is what the BIR withholding table needs: each bracket charges a fixed
 * amount for everything below its floor plus a rate on the part above it. Computing it as a flat
 * percentage of the whole base — which is all the flat shape can express — overstates the tax
 * badly, so a rule carrying `base_tax`/`excess_over` is treated as progressive.
 */
function deduction_catalog_compute_tiered(array $type, float $base): float
{
    $rules = $type['thresholdRules'] ?? null;

    if (!is_array($rules) || $rules === []) {
        return (float)($type['defaultAmount'] ?? 0);
    }

    $charge = static function (array $rule, float $base) use ($type): float {
        if (array_key_exists('base_tax', $rule) || array_key_exists('excess_over', $rule)) {
            $baseTax = (float)($rule['base_tax'] ?? 0);
            $excessOver = (float)($rule['excess_over'] ?? 0);
            $rate = (float)($rule['rate'] ?? 0);

            return $baseTax + max(0.0, $base - $excessOver) * ($rate / 100);
        }

        if (isset($rule['rate']) && (float)$rule['rate'] > 0) {
            return $base * ((float)$rule['rate'] / 100);
        }

        return (float)($rule['amount'] ?? $type['defaultAmount'] ?? 0);
    };

    foreach ($rules as $rule) {
        if (!is_array($rule)) {
            continue;
        }

        $upTo = $rule['up_to'] ?? $rule['upTo'] ?? null;

        if ($upTo === null || $base <= (float)$upTo) {
            return $charge($rule, $base);
        }
    }

    // Above every bracket: the last one governs.
    $last = end($rules);

    return is_array($last) ? $charge($last, $base) : (float)($type['defaultAmount'] ?? 0);
}
