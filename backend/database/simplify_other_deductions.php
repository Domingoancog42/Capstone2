<?php
declare(strict_types=1);

/**
 * Run once when deploying the simplified Other Deductions setup:
 *   php backend/database/simplify_other_deductions.php --apply
 *
 * Saves the original schema and all rows in the protected backups directory before changing it.
 * Names, descriptions, amounts, identifiers and payroll metadata survive the migration.
 */
function simplify_other_deductions(PDO $pdo, string $backupDirectory): array
{
    if ($pdo->inTransaction()) {
        throw new RuntimeException('Run this schema migration outside a transaction.');
    }

    $columns = array_column($pdo->query('SHOW COLUMNS FROM other_deductions')->fetchAll(PDO::FETCH_ASSOC), 'Field');
    $removed = array_intersect([
        'calculation_type', 'default_rate', 'basis', 'threshold_amount', 'threshold_rules', 'base_floor', 'base_cap',
    ], $columns);
    $hasOldAmount = in_array('default_amount', $columns, true);
    $hasAmount = in_array('amount', $columns, true);
    if ($hasOldAmount === $hasAmount) {
        throw new RuntimeException('Expected exactly one amount column on other_deductions.');
    }
    if (!$hasOldAmount && $removed === []) {
        return ['changed' => false];
    }

    $rows = $pdo->query('SELECT * FROM other_deductions ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $row) {
        if ((int)$row['is_active'] !== 1) {
            continue;
        }
        if (($row['calculation_type'] ?? 'fixed') !== 'fixed'
            || (float)($row['threshold_amount'] ?? 0) !== 0.0
            || !empty($row['threshold_rules'])
            || (float)($row['base_floor'] ?? 0) !== 0.0
            || ($row['base_cap'] ?? null) !== null) {
            throw new RuntimeException('Convert active calculation rules to fixed amounts before migrating Other Deductions.');
        }
    }

    $create = $pdo->query('SHOW CREATE TABLE other_deductions')->fetch(PDO::FETCH_NUM);
    $backup = json_encode([
        'table' => 'other_deductions',
        'createdAt' => gmdate('c'),
        'createSql' => $create[1],
        'rows' => $rows,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
    if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true) && !is_dir($backupDirectory)) {
        throw new RuntimeException('Unable to create the migration backup directory.');
    }
    $backupPath = $backupDirectory . '/other-deductions-before-simplification-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.json';
    if (file_put_contents($backupPath, $backup, LOCK_EX) !== strlen($backup)) {
        throw new RuntimeException('Unable to save the original Other Deductions table. No schema changes were made.');
    }

    $changes = $hasOldAmount ? ['CHANGE COLUMN default_amount amount DECIMAL(12,2) NOT NULL DEFAULT 0.00'] : [];
    foreach ($removed as $column) {
        $changes[] = 'DROP COLUMN `' . $column . '`';
    }
    $pdo->exec('ALTER TABLE other_deductions ' . implode(', ', $changes));

    $after = $pdo->query('SELECT * FROM other_deductions ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $expected = array_map(static function (array $row) use ($removed, $hasOldAmount): array {
        if ($hasOldAmount) {
            $row['amount'] = $row['default_amount'];
            unset($row['default_amount']);
        }
        return array_diff_key($row, array_flip($removed));
    }, $rows);
    if (count($expected) !== count($after)) {
        throw new RuntimeException('Row count changed during migration. Original data is saved at ' . $backupPath);
    }
    foreach ($expected as $index => $row) {
        if ($row != $after[$index]) {
            throw new RuntimeException('Data changed during migration. Original data is saved at ' . $backupPath);
        }
    }

    return ['changed' => true, 'rowsPreserved' => count($rows), 'backupPath' => $backupPath];
}

if (PHP_SAPI === 'cli' && realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    if (!in_array('--apply', $argv, true)) {
        fwrite(STDERR, "Usage: php backend/database/simplify_other_deductions.php --apply\n");
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
    echo json_encode(simplify_other_deductions($pdo, __DIR__ . '/../backups'), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), PHP_EOL;
}
