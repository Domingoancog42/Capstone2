<?php
declare(strict_types=1);

// Temporary tables shadow the real loan records. Persistent records are never changed.
require __DIR__ . '/../database/remove_legacy_loan_columns.php';
$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
);
$checks = 0;
function loan_columns_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
    $GLOBALS['checks']++;
}
$legacyColumns = [
    'emergency_loan', 'policy_loan', 'consolidated_loan', 'salary_loan', 'housing_loan',
    'pension_loan', 'gsis_financial_assistance_loan_gfal', 'enhanced_housing_loan',
    'multi_purpose_loan_mpl', 'calamity_loan',
];
$legacySql = implode(', ', array_map(static fn (string $column): string => '`' . $column . '` DECIMAL(12,2) NOT NULL DEFAULT 0', $legacyColumns));
$attachmentColumns = ['supporting_document_name', 'supporting_document_path', 'supporting_document_size', 'supporting_document_type'];
$removedColumns = array_merge($legacyColumns, $attachmentColumns, ['interest_method', 'government_reference_number']);
$pdo->exec('CREATE TEMPORARY TABLE loan_records (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT, employee_id INT UNSIGNED NOT NULL,
    loan_type VARCHAR(120) NOT NULL, loan_amount DECIMAL(12,2) NOT NULL,
    ' . $legacySql . ', repayment_terms VARCHAR(180) NOT NULL,
    annual_interest_rate DECIMAL(7,4) NOT NULL DEFAULT 0, interest_method VARCHAR(20) NOT NULL DEFAULT "flat",
    government_reference_number VARCHAR(180) NULL,
    supporting_document_name VARCHAR(255) NULL, supporting_document_path VARCHAR(500) NULL,
    supporting_document_size INT UNSIGNED NULL, supporting_document_type VARCHAR(120) NULL,
    status VARCHAR(20) NOT NULL DEFAULT "Pending", created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB');
$pdo->exec("INSERT INTO loan_records (employee_id, loan_type, loan_amount, repayment_terms, emergency_loan)
    VALUES (123, 'MGB COOP LOAN', 2000, '12 months', 500)");
try {
    remove_legacy_loan_columns($pdo, __DIR__ . '/../backups');
    throw new RuntimeException('Expected nonzero legacy amounts to be protected.');
} catch (RuntimeException $error) {
    loan_columns_expect(str_contains($error->getMessage(), 'contains an amount'), 'nonzero legacy values are protected');
}
loan_columns_expect(count($pdo->query('SHOW COLUMNS FROM loan_records')->fetchAll()) === 25, 'a rejected migration leaves every column intact');
$pdo->exec('UPDATE loan_records SET emergency_loan = 0');
foreach (['supporting_document_name' => 'letter.pdf', 'supporting_document_path' => '/uploads/letter.pdf', 'supporting_document_size' => 1024, 'supporting_document_type' => 'application/pdf'] as $column => $value) {
    $update = $pdo->prepare('UPDATE loan_records SET `' . $column . '` = :value');
    $update->execute([':value' => $value]);
    try {
        remove_legacy_loan_columns($pdo, __DIR__ . '/../backups');
        throw new RuntimeException('Expected stored attachment data to be protected.');
    } catch (RuntimeException $error) {
        loan_columns_expect(str_contains($error->getMessage(), 'contains attachment data'), 'stored attachment data is protected: ' . $column);
    }
    $pdo->exec('UPDATE loan_records SET `' . $column . '` = NULL');
}
foreach ([
    ['interest_method', 'diminishing', 'flat', 'different interest calculation'],
    ['government_reference_number', 'REF-123', null, 'contains a reference number'],
] as [$column, $value, $restored, $message]) {
    $update = $pdo->prepare('UPDATE loan_records SET `' . $column . '` = :value');
    $update->execute([':value' => $value]);
    try {
        remove_legacy_loan_columns($pdo, __DIR__ . '/../backups');
        throw new RuntimeException('Expected populated legacy fields to be protected.');
    } catch (RuntimeException $error) {
        loan_columns_expect(str_contains($error->getMessage(), $message), 'populated legacy data is protected: ' . $column);
    }
    $update->execute([':value' => $restored]);
}
$before = $pdo->query('SELECT * FROM loan_records')->fetchAll();
$result = remove_legacy_loan_columns($pdo, __DIR__ . '/../backups');
try {
    loan_columns_expect($result['removedColumns'] === $removedColumns, 'all removed loan fields are absent');
    loan_columns_expect($result['rowsPreserved'] === 1, 'the existing record is preserved');
    $backup = json_decode(file_get_contents($result['backupPath']), true, 512, JSON_THROW_ON_ERROR);
    loan_columns_expect($backup['rows'] === $before && str_contains($backup['createSql'], 'emergency_loan'), 'backup contains the complete original schema and records');
    $columns = array_column($pdo->query('SHOW COLUMNS FROM loan_records')->fetchAll(), 'Field');
    loan_columns_expect(array_intersect($removedColumns, $columns) === [], 'no unused amount or attachment columns remain');
    $after = $pdo->query('SELECT * FROM loan_records')->fetchAll();
    loan_columns_expect($after === array_map(static fn (array $row): array => array_diff_key($row, array_flip($removedColumns)), $before), 'every retained field is unchanged');
    loan_columns_expect(remove_legacy_loan_columns($pdo, __DIR__ . '/../backups') === ['changed' => false], 'the migration is safe to rerun');
    $pdo->exec("INSERT INTO loan_records (employee_id, loan_type, loan_amount, repayment_terms) VALUES (124, 'MGB COOP LOAN', 3750.25, '6 months')");
    $id = (int)$pdo->lastInsertId();
    $pdo->exec('UPDATE loan_records SET loan_amount = 4000.50 WHERE id = ' . $id);
    loan_columns_expect($pdo->query('SELECT loan_amount FROM loan_records WHERE id = ' . $id)->fetchColumn() === '4000.50', 'loans can still be inserted and updated using loan_type and loan_amount');
    echo 'PASS: ' . $checks . ' loan record column checks. Temporary table only.' . PHP_EOL;
} finally {
    unlink($result['backupPath']);
}
