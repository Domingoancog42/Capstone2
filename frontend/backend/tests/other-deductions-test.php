<?php
declare(strict_types=1);

// Temporary tables shadow the real catalogs and payroll. No persistent records are changed.
require __DIR__ . '/../api/deduction-catalog.php';
require __DIR__ . '/../database/simplify_other_deductions.php';

function other_test_load_function(string $path, string $name): void
{
    $source = file_get_contents($path);
    $start = strpos($source, 'function ' . $name . '(');
    if ($start === false) throw new RuntimeException('Missing function: ' . $name);
    $code = ''; $depth = 0; $opened = false;
    foreach (array_slice(token_get_all('<?php ' . substr($source, $start)), 1) as $token) {
        $code .= is_array($token) ? $token[1] : $token;
        if ($token === '{' || (is_array($token) && in_array($token[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true))) { $depth++; $opened = true; }
        if ($token === '}' && --$depth === 0 && $opened) break;
    }
    eval($code);
}

class OtherDeductionResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
function json_response(array $body, int $status = 200): void { throw new OtherDeductionResponse($body, $status); }
function other_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
    $GLOBALS['otherAssertions'] = ($GLOBALS['otherAssertions'] ?? 0) + 1;
}
function other_response(callable $handler): OtherDeductionResponse
{
    try { $handler(); } catch (OtherDeductionResponse $response) { return $response; }
    throw new RuntimeException('Expected an API response.');
}

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
);
$GLOBALS['pdo'] = $pdo;
$schema = '(
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(100) UNIQUE NOT NULL, description TEXT NULL,
    calculation_type VARCHAR(20) NOT NULL DEFAULT "fixed", default_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    default_rate DECIMAL(12,8) NOT NULL DEFAULT 0, basis VARCHAR(40) NOT NULL DEFAULT "basic_salary",
    threshold_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    threshold_rules LONGTEXT NULL CHECK (JSON_VALID(threshold_rules)),
    base_floor DECIMAL(12,2) NOT NULL DEFAULT 0, base_cap DECIMAL(12,2) NULL,
    is_recurring TINYINT NOT NULL DEFAULT 0, is_active TINYINT NOT NULL DEFAULT 1,
    show_in_payroll TINYINT NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB';
foreach (DEDUCTION_FAMILIES as $family) {
    $pdo->exec('CREATE TEMPORARY TABLE `' . $family['table'] . '` ' . $schema . ' AUTO_INCREMENT=' . $family['band']);
}
$pdo->exec('CREATE TEMPORARY TABLE payroll (payroll_id INT PRIMARY KEY, total_allowance DECIMAL(12,2) DEFAULT 0, deduction_items_json LONGTEXT NULL)');
$pdo->exec("INSERT INTO other_deductions (id, code, name, description, default_amount, is_recurring) VALUES
    (6001, 'equipment', 'Equipment', 'Monthly repayment', 1250.50, 1)");
$pdo->exec("INSERT INTO other_deductions (id, code, name, calculation_type, default_rate, is_active) VALUES
    (6002, 'sss', 'SSS', 'percentage', 4.5, 0)");
$pdo->exec("INSERT INTO gsis_deductions (id, code, name, calculation_type, default_rate) VALUES
    (2001, 'gsis', 'GSIS', 'percentage', 9)");
$pdo->exec('UPDATE other_deductions SET is_active = 1 WHERE id = 6002');
try {
    simplify_other_deductions($pdo, __DIR__ . '/../backups');
    throw new RuntimeException('Expected migration to reject an active percentage deduction.');
} catch (RuntimeException $exception) {
    other_expect(str_contains($exception->getMessage(), 'Convert active calculation rules'), 'active rules are protected from accidental conversion');
}
$pdo->exec('UPDATE other_deductions SET is_active = 0 WHERE id = 6002');
$legacyTypes = deduction_catalog_type_map($pdo);
other_expect($legacyTypes[6001]['defaultAmount'] === 1250.5, 'existing deployment amounts load before the optional schema cleanup');
deduction_catalog_update_fields($pdo, 'other_deductions', 6001, ['default_amount' => '1350.75']);
other_expect($pdo->query('SELECT default_amount FROM other_deductions WHERE id = 6001')->fetchColumn() === '1350.75', 'existing deployment amounts can be edited without renaming a column');
deduction_catalog_update_fields($pdo, 'other_deductions', 6001, ['default_amount' => '1250.50']);
$migration = simplify_other_deductions($pdo, __DIR__ . '/../backups');
try {
    other_expect($migration['rowsPreserved'] === 2, 'migration preserves every catalog row');
    $backup = json_decode(file_get_contents($migration['backupPath']), true, 512, JSON_THROW_ON_ERROR);
    other_expect(count($backup['rows']) === 2 && isset($backup['rows'][0]['default_amount']), 'backup retains the original fields and data');
    $columns = array_column($pdo->query('SHOW COLUMNS FROM other_deductions')->fetchAll(), 'Field');
    other_expect(in_array('amount', $columns, true) && !in_array('default_amount', $columns, true), 'amount replaces default_amount');
    foreach (['calculation_type', 'default_rate', 'basis', 'threshold_amount', 'threshold_rules', 'base_floor', 'base_cap'] as $column) {
        other_expect(!in_array($column, $columns, true), 'removed calculation field: ' . $column);
    }
    other_expect(simplify_other_deductions($pdo, __DIR__ . '/../backups') === ['changed' => false], 'migration can be run again safely');
    $types = deduction_catalog_type_map($pdo);
    other_expect($types[6001]['name'] === 'Equipment' && $types[6001]['defaultAmount'] === 1250.5, 'catalog reads the migrated name and amount');
    other_expect($types[6001]['isRecurring'] && !$types[6002]['isActive'], 'payroll metadata and retired rows survive');
    other_expect(deduction_catalog_compute($types[6001], 50000) === 1250.5, 'Other Deductions calculates a fixed amount');
    other_expect(deduction_catalog_compute($types[2001], 50000) === 4500.0, 'GSIS still calculates percentages');

    foreach ([
        'deduction_text', 'deduction_int', 'deduction_decimal', 'deduction_decimal_string', 'deduction_nullable_decimal',
        'deduction_rate_string', 'deduction_rate_value', 'deduction_bool_value', 'deduction_definition_groups',
        'deduction_definition_group', 'deduction_definition_payload', 'deduction_list_definition_types',
        'deduction_create_definition_type', 'deduction_update_definition_type',
    ] as $function) {
        other_test_load_function(__DIR__ . '/../api/deduction.php', $function);
    }
    $created = other_response(fn () => deduction_create_definition_type($pdo, [
        'groupKey' => 'other', 'type_name' => 'New Fee', 'description' => 'A simple fee', 'default_amount' => '375.25',
        'threshold_mode' => 'percentage', 'default_rate' => 100, 'is_active' => 0,
    ]));
    other_expect($created->status === 201, 'three-field deduction saves through the production API');
    $id = $created->body['definitionId'];
    $row = $pdo->query('SELECT * FROM other_deductions WHERE id = ' . $id)->fetch();
    other_expect($row['amount'] === '375.25' && $row['description'] === 'A simple fee' && (int)$row['is_active'] === 1, 'only the simple fields are saved by the Other Deductions form');
    $updated = other_response(fn () => deduction_update_definition_type($pdo, [
        'id' => $id, 'type_name' => 'Renamed Fee', 'description' => '', 'default_amount' => '0.00',
    ]));
    other_expect($updated->status === 200, 'existing deduction can still be addressed by id');
    $row = $pdo->query('SELECT * FROM other_deductions WHERE id = ' . $id)->fetch();
    other_expect($row['name'] === 'Renamed Fee' && $row['amount'] === '0.00' && $row['description'] === null, 'zero amounts and an empty description are supported');
    foreach (['-1', 'invalid'] as $amount) {
        $bad = other_response(fn () => deduction_create_definition_type($pdo, ['groupKey' => 'other', 'type_name' => 'Bad amount', 'default_amount' => $amount]));
        other_expect($bad->status === 422, 'invalid amount is rejected: ' . $amount);
    }
    $missingName = other_response(fn () => deduction_create_definition_type($pdo, ['groupKey' => 'other', 'type_name' => ' ']));
    other_expect($missingName->status === 422, 'empty deduction name is rejected');
    $clash = other_response(fn () => deduction_update_definition_type($pdo, ['id' => $id, 'type_name' => 'Equipment']));
    other_expect($clash->status === 422, 'duplicate names are rejected');
    $gsis = other_response(fn () => deduction_update_definition_type($pdo, [
        'id' => 2001, 'type_name' => 'GSIS', 'threshold_mode' => 'percentage', 'default_rate' => 9.5,
    ]));
    other_expect($gsis->status === 200 && deduction_catalog_type_map($pdo)[2001]['defaultRate'] === 9.5, 'advanced settings still save for other families');
    foreach (['payroll_decimal_string', 'payroll_resolve_deduction_type', 'payroll_seed_deduction_engine_defaults', 'payroll_fetch_global_recurring_deduction_rows'] as $function) {
        other_test_load_function(__DIR__ . '/../api/payroll.php', $function);
    }
    other_test_load_function(__DIR__ . '/../api/payroll.php', 'payroll_normalize_deduction_key');
    other_test_load_function(__DIR__ . '/../api/payroll.php', 'payroll_text');
    payroll_seed_deduction_engine_defaults($pdo);
    $phicId = (int)$pdo->query("SELECT id FROM phic_deductions WHERE code = 'phic'")->fetchColumn();
    foreach (['PhilHealth', 'philhealth', 'PhilHealth Premium', 'PHIC'] as $alias) {
        other_expect(deduction_catalog_resolve_type($pdo, 'PHIC', $alias) === $phicId, 'contribution alias resolves to PHIC: ' . $alias);
    }
    payroll_seed_deduction_engine_defaults($pdo);
    other_expect((int)$pdo->query('SELECT COUNT(*) FROM phic_deductions')->fetchColumn() === 1, 'repeated payroll seeding keeps only the PHIC contribution');
    other_expect($pdo->query('SELECT amount FROM other_deductions WHERE id = 6001')->fetchColumn() === '1250.50', 'payroll seeding supports the simplified schema and preserves amounts');
    other_expect((int)$pdo->query("SELECT is_active FROM other_deductions WHERE code = 'sss'")->fetchColumn() === 0, 'payroll seeding keeps SSS retired');
    $recurring = payroll_fetch_global_recurring_deduction_rows($pdo);
    $equipment = array_values(array_filter($recurring, static fn (array $row): bool => (int)$row['deductionTypeId'] === 6001));
    other_expect(count($equipment) === 1 && (float)$equipment[0]['amount'] === 1250.5 && $equipment[0]['calculationType'] === 'fixed', 'payroll still collects recurring Other Deductions using the configured amount');
    echo 'PASS: ' . $GLOBALS['otherAssertions'] . ' Other Deductions checks. Temporary tables only.' . PHP_EOL;
} finally {
    unlink($migration['backupPath']);
}
