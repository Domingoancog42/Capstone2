<?php
declare(strict_types=1);

/**
 * Remove unused per-product loan amounts and attachment metadata left by the old loan form.
 * The current form/API uses loan_type and loan_amount and has no attachment upload feature.
 * Interest uses the flat-rate calculation; the method and reference fields have been removed.
 * Run: php backend/database/remove_legacy_loan_columns.php --apply
 */
function remove_legacy_loan_columns(PDO $pdo, string $backupDirectory): array
{
    if ($pdo->inTransaction()) {
        throw new RuntimeException('Run this schema migration outside a transaction.');
    }
    $columns = array_column($pdo->query('SHOW COLUMNS FROM loan_records')->fetchAll(PDO::FETCH_ASSOC), 'Field');
    foreach (['id', 'loan_type', 'loan_amount'] as $required) {
        if (!in_array($required, $columns, true)) {
            throw new RuntimeException('Missing required loan column: ' . $required);
        }
    }
    $removed = array_values(array_intersect([
        'emergency_loan', 'policy_loan', 'consolidated_loan', 'salary_loan', 'housing_loan',
        'pension_loan', 'gsis_financial_assistance_loan_gfal', 'enhanced_housing_loan',
        'multi_purpose_loan_mpl', 'calamity_loan',
        'supporting_document_name', 'supporting_document_path', 'supporting_document_size', 'supporting_document_type',
        'interest_method', 'government_reference_number',
    ], $columns));
    if ($removed === []) {
        return ['changed' => false];
    }

    $rows = $pdo->query('SELECT * FROM loan_records ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $row) {
        foreach ($removed as $column) {
            if ($column === 'interest_method') {
                if (!in_array(strtolower(trim((string)($row[$column] ?? ''))), ['', 'flat'], true)) {
                    throw new RuntimeException('A loan uses a different interest calculation. Reconcile its repayment terms before removing interest_method.');
                }
                continue;
            }
            if ($column === 'government_reference_number') {
                if (trim((string)($row[$column] ?? '')) !== '') {
                    throw new RuntimeException('A loan contains a reference number. Preserve it before removing government_reference_number.');
                }
                continue;
            }
            if (str_starts_with($column, 'supporting_document_')) {
                if ($row[$column] !== null && (string)$row[$column] !== '') {
                    throw new RuntimeException('Unused column ' . $column . ' contains attachment data. Preserve it before removing the column.');
                }
                continue;
            }
            if ((float)($row[$column] ?? 0) !== 0.0) {
                throw new RuntimeException('Legacy column ' . $column . ' contains an amount. Reconcile it with loan_type and loan_amount before removing it.');
            }
        }
    }
    $create = $pdo->query('SHOW CREATE TABLE loan_records')->fetch(PDO::FETCH_NUM);
    $backup = json_encode([
        'table' => 'loan_records', 'createdAt' => gmdate('c'), 'createSql' => $create[1], 'rows' => $rows,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
    if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true) && !is_dir($backupDirectory)) {
        throw new RuntimeException('Unable to create the migration backup directory.');
    }
    $backupPath = $backupDirectory . '/loan-records-before-column-cleanup-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.json';
    if (file_put_contents($backupPath, $backup, LOCK_EX) !== strlen($backup)) {
        throw new RuntimeException('Unable to back up loan_records. No schema changes were made.');
    }

    $pdo->exec('ALTER TABLE loan_records ' . implode(', ', array_map(
        static fn (string $column): string => 'DROP COLUMN `' . $column . '`', $removed
    )));
    $after = $pdo->query('SELECT * FROM loan_records ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $expected = array_map(static fn (array $row): array => array_diff_key($row, array_flip($removed)), $rows);
    if ($expected !== $after) {
        throw new RuntimeException('Loan data changed during migration. Original data is saved at ' . $backupPath);
    }

    return ['changed' => true, 'removedColumns' => $removed, 'rowsPreserved' => count($rows), 'backupPath' => $backupPath];
}

if (PHP_SAPI === 'cli' && realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    if (!in_array('--apply', $argv, true)) {
        fwrite(STDERR, "Usage: php backend/database/remove_legacy_loan_columns.php --apply\n");
        exit(1);
    }
    $config = __DIR__ . '/../api/server-config.local.php';
    if (is_file($config)) {
        require $config;
    }
    $value = static function (string $key, string $default): string {
        $environment = getenv($key);
        return $environment !== false ? $environment : (defined($key) ? (string)constant($key) : $default);
    };
    $host = $value('HRIS_DB_HOST', '127.0.0.1');
    $name = $value('HRIS_DB_NAME', 'hris');
    $port = $value('HRIS_DB_PORT', '3306');
    $options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false];
    if (in_array(strtolower($value('HRIS_DB_SSL', '')), ['1', 'true', 'on', 'yes'], true)) {
        $options[PDO::MYSQL_ATTR_SSL_CA] = $value('HRIS_DB_SSL_CA', '/etc/ssl/certs/ca-certificates.crt');
        $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
    }
    $pdo = new PDO("mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4", $value('HRIS_DB_USER', 'root'), $value('HRIS_DB_PASSWORD', ''), $options);
    echo json_encode(remove_legacy_loan_columns($pdo, __DIR__ . '/../backups'), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), PHP_EOL;
}
