<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

if (hris_user_role_key($sessionUser) !== 'admin') {
    json_response([
        'success' => false,
        'message' => 'Only administrators can manage database backups.',
    ], 403);
}

const BACKUP_ALLOWED_SCHEDULES = ['daily', 'weekly', 'monthly'];

function backup_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function backup_bool(mixed $value): bool
{
    $normalized = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

    return $normalized === null ? false : $normalized;
}

function backup_default_directory(): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'backups';
}

function backup_is_absolute_path(string $path): bool
{
    return preg_match('/^[A-Za-z]:[\\\\\\/]/', $path) === 1
        || str_starts_with($path, '/')
        || str_starts_with($path, '\\\\');
}

function backup_resolve_directory(string $path): string
{
    $path = backup_text($path);

    if ($path === '') {
        return backup_default_directory();
    }

    if (!backup_is_absolute_path($path)) {
        $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . $path;
    }

    return rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $path), DIRECTORY_SEPARATOR);
}

function backup_normalize_schedule(mixed $value): string
{
    $schedule = strtolower(backup_text($value));

    return in_array($schedule, BACKUP_ALLOWED_SCHEDULES, true) ? $schedule : 'daily';
}

function backup_normalize_datetime(mixed $value): string
{
    $raw = str_replace('T', ' ', backup_text($value));

    if ($raw === '') {
        return '';
    }

    $timestamp = strtotime($raw);

    if ($timestamp === false) {
        throw new RuntimeException('Backup date/time is invalid.');
    }

    return date('Y-m-d H:i:s', $timestamp);
}

function backup_ensure_directory(string $directory): void
{
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        throw new RuntimeException('Unable to create the backup directory.');
    }

    if (!is_writable($directory)) {
        throw new RuntimeException('The backup directory is not writable.');
    }
}

function backup_ensure_history_table(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS backup_history (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            backup_type ENUM('Manual', 'Automatic') NOT NULL DEFAULT 'Manual',
            file_name VARCHAR(255) NOT NULL,
            file_path TEXT NOT NULL,
            file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
            status ENUM('Completed', 'Failed', 'Deleted') NOT NULL DEFAULT 'Completed',
            error_message TEXT NULL,
            created_by_user_id INT UNSIGNED NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at DATETIME NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_backup_history_created_at (created_at),
            KEY idx_backup_history_type (backup_type),
            KEY idx_backup_history_status (status),
            KEY idx_backup_history_created_by (created_by_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function backup_settings(PDO $pdo): array
{
    $directory = backup_resolve_directory(
        hris_get_application_setting($pdo, 'backup_file_path', backup_default_directory())
    );

    return [
        'automaticEnabled' => hris_get_boolean_application_setting($pdo, 'backup_automatic_enabled', false),
        'schedule' => backup_normalize_schedule(hris_get_application_setting($pdo, 'backup_schedule', 'daily')),
        'backupPath' => $directory,
        'backupDateTime' => hris_get_application_setting($pdo, 'backup_date_time', ''),
        'lastAutomaticBackupAt' => hris_get_application_setting($pdo, 'backup_last_auto_at', ''),
    ];
}

function backup_store_settings(PDO $pdo, array $body): array
{
    $schedule = backup_normalize_schedule($body['schedule'] ?? 'daily');
    $directory = backup_resolve_directory(backup_text($body['backupPath'] ?? $body['filePath'] ?? ''));
    $automaticEnabled = backup_bool($body['automaticEnabled'] ?? false);
    $backupDateTime = backup_normalize_datetime($body['backupDateTime'] ?? '');

    backup_ensure_directory($directory);

    hris_store_boolean_application_setting($pdo, 'backup_automatic_enabled', $automaticEnabled);
    hris_store_application_setting($pdo, 'backup_schedule', $schedule);
    hris_store_application_setting($pdo, 'backup_file_path', $directory);
    hris_store_application_setting($pdo, 'backup_date_time', $backupDateTime);

    return backup_settings($pdo);
}

function backup_quote_identifier(string $identifier): string
{
    return '`' . str_replace('`', '``', $identifier) . '`';
}

function backup_sql_value(PDO $pdo, mixed $value): string
{
    if ($value === null) {
        return 'NULL';
    }

    return (string)$pdo->quote((string)$value);
}

function backup_database_name(PDO $pdo): string
{
    $databaseName = $pdo->query('SELECT DATABASE()')->fetchColumn();

    return is_string($databaseName) && $databaseName !== '' ? $databaseName : 'database';
}

function backup_safe_filename_part(string $value): string
{
    $safe = strtolower((string)preg_replace('/[^A-Za-z0-9_-]+/', '-', $value));
    $safe = trim($safe, '-');

    return $safe !== '' ? $safe : 'database';
}

function backup_write_line(mixed $handle, string $line = ''): void
{
    fwrite($handle, $line . PHP_EOL);
}

function backup_write_database_sql(PDO $pdo, mixed $handle): void
{
    $databaseName = backup_database_name($pdo);

    backup_write_line($handle, '-- HRIS database backup');
    backup_write_line($handle, '-- Database: ' . $databaseName);
    backup_write_line($handle, '-- Generated at: ' . date('Y-m-d H:i:s'));
    backup_write_line($handle);
    backup_write_line($handle, 'SET FOREIGN_KEY_CHECKS = 0;');
    backup_write_line($handle, 'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";');
    backup_write_line($handle);

    $tables = $pdo->query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"')->fetchAll(PDO::FETCH_NUM);

    foreach ($tables as $tableRow) {
        $tableName = (string)($tableRow[0] ?? '');

        if ($tableName === '') {
            continue;
        }

        $quotedTableName = backup_quote_identifier($tableName);
        $createStatement = $pdo->query('SHOW CREATE TABLE ' . $quotedTableName);
        $createRow = $createStatement !== false ? $createStatement->fetch(PDO::FETCH_ASSOC) : null;
        $createSql = is_array($createRow) ? (string)($createRow['Create Table'] ?? '') : '';

        backup_write_line($handle);
        backup_write_line($handle, '-- ------------------------------------------------------------');
        backup_write_line($handle, '-- Table structure for ' . $quotedTableName);
        backup_write_line($handle, '-- ------------------------------------------------------------');
        backup_write_line($handle);
        backup_write_line($handle, 'DROP TABLE IF EXISTS ' . $quotedTableName . ';');
        if ($createSql !== '') {
            backup_write_line($handle, $createSql . ';');
            backup_write_line($handle);
        }

        $rowStatement = $pdo->query('SELECT * FROM ' . $quotedTableName);
        $columns = [];
        $rows = [];

        if ($rowStatement !== false) {
            $columnCount = $rowStatement->columnCount();
            for ($index = 0; $index < $columnCount; $index += 1) {
                $metadata = $rowStatement->getColumnMeta($index);
                $columns[] = backup_quote_identifier((string)($metadata['name'] ?? 'column_' . $index));
            }

            while ($row = $rowStatement->fetch(PDO::FETCH_NUM)) {
                $rows[] = '(' . implode(', ', array_map(
                    static fn (mixed $value): string => backup_sql_value($pdo, $value),
                    $row
                )) . ')';

                if (count($rows) >= 100) {
                    backup_write_line($handle, 'INSERT INTO ' . $quotedTableName . ' (' . implode(', ', $columns) . ') VALUES');
                    backup_write_line($handle, implode(',' . PHP_EOL, $rows) . ';');
                    backup_write_line($handle);
                    $rows = [];
                }
            }
        }

        if ($rows !== []) {
            backup_write_line($handle, 'INSERT INTO ' . $quotedTableName . ' (' . implode(', ', $columns) . ') VALUES');
            backup_write_line($handle, implode(',' . PHP_EOL, $rows) . ';');
            backup_write_line($handle);
        }
    }

    backup_write_line($handle);
    backup_write_line($handle, 'SET FOREIGN_KEY_CHECKS = 1;');
    backup_write_line($handle, '-- End of HRIS database backup');
}

function backup_insert_history(PDO $pdo, array $record): int
{
    $statement = $pdo->prepare(
        'INSERT INTO backup_history
            (backup_type, file_name, file_path, file_size, status, error_message, created_by_user_id, created_at)
         VALUES
            (:backup_type, :file_name, :file_path, :file_size, :status, :error_message, :created_by_user_id, :created_at)'
    );
    $statement->execute([
        ':backup_type' => $record['backupType'],
        ':file_name' => $record['fileName'],
        ':file_path' => $record['filePath'],
        ':file_size' => (int)($record['fileSize'] ?? 0),
        ':status' => $record['status'],
        ':error_message' => $record['errorMessage'] ?? null,
        ':created_by_user_id' => $record['createdByUserId'] ?? null,
        ':created_at' => $record['createdAt'] ?? date('Y-m-d H:i:s'),
    ]);

    return (int)$pdo->lastInsertId();
}

function backup_fetch_record(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            bh.id,
            bh.backup_type AS backupType,
            bh.created_at AS backupDateTime,
            bh.file_name AS fileName,
            bh.file_path AS filePath,
            bh.file_size AS fileSize,
            bh.status,
            bh.error_message AS errorMessage,
            bh.created_by_user_id AS createdByUserId,
            COALESCE(u.username, "") AS createdBy,
            bh.deleted_at AS deletedAt,
            bh.updated_at AS updatedAt
         FROM backup_history bh
         LEFT JOIN users u ON u.id = bh.created_by_user_id
         WHERE bh.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $record = $statement->fetch();

    if (!$record) {
        return null;
    }

    $record['id'] = (int)$record['id'];
    $record['fileSize'] = (int)$record['fileSize'];
    $record['createdByUserId'] = $record['createdByUserId'] !== null ? (int)$record['createdByUserId'] : null;

    return $record;
}

function backup_list_history(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT
            bh.id,
            bh.backup_type AS backupType,
            bh.created_at AS backupDateTime,
            bh.file_name AS fileName,
            bh.file_path AS filePath,
            bh.file_size AS fileSize,
            bh.status,
            bh.error_message AS errorMessage,
            bh.created_by_user_id AS createdByUserId,
            COALESCE(u.username, "") AS createdBy,
            bh.deleted_at AS deletedAt,
            bh.updated_at AS updatedAt
         FROM backup_history bh
         LEFT JOIN users u ON u.id = bh.created_by_user_id
         ORDER BY bh.created_at DESC, bh.id DESC
         LIMIT 200'
    );

    $records = $statement->fetchAll();

    foreach ($records as &$record) {
        $record['id'] = (int)$record['id'];
        $record['fileSize'] = (int)$record['fileSize'];
        $record['createdByUserId'] = $record['createdByUserId'] !== null ? (int)$record['createdByUserId'] : null;
    }
    unset($record);

    return $records;
}

function backup_create_record(PDO $pdo, string $type, string $directory, ?array $user, string $backupDateTime = ''): array
{
    $databaseName = backup_database_name($pdo);
    $createdAt = backup_normalize_datetime($backupDateTime) ?: date('Y-m-d H:i:s');
    $fileName = sprintf(
        'hris-backup-%s-%s-%s.sql',
        strtolower($type),
        backup_safe_filename_part($databaseName),
        date('Ymd-His')
    );
    $directory = backup_resolve_directory($directory);
    $filePath = $directory . DIRECTORY_SEPARATOR . $fileName;
    $createdByUserId = isset($user['id']) ? (int)$user['id'] : null;

    try {
        backup_ensure_directory($directory);
        $handle = fopen($filePath, 'wb');

        if ($handle === false) {
            throw new RuntimeException('Unable to open the backup file for writing.');
        }

        try {
            backup_write_database_sql($pdo, $handle);
        } finally {
            fclose($handle);
        }

        $fileSize = is_file($filePath) ? (int)filesize($filePath) : 0;
        $recordId = backup_insert_history($pdo, [
            'backupType' => $type,
            'fileName' => $fileName,
            'filePath' => $filePath,
            'fileSize' => $fileSize,
            'status' => 'Completed',
            'createdByUserId' => $createdByUserId,
            'createdAt' => $createdAt,
        ]);

        return backup_fetch_record($pdo, $recordId) ?? [];
    } catch (Throwable $exception) {
        $recordId = backup_insert_history($pdo, [
            'backupType' => $type,
            'fileName' => $fileName,
            'filePath' => $filePath,
            'fileSize' => 0,
            'status' => 'Failed',
            'errorMessage' => $exception->getMessage(),
            'createdByUserId' => $createdByUserId,
            'createdAt' => $createdAt,
        ]);

        $record = backup_fetch_record($pdo, $recordId) ?? [];
        $record['errorMessage'] = $exception->getMessage();

        throw new RuntimeException('Unable to create database backup.', 0, $exception);
    }
}

function backup_schedule_due(string $schedule, string $lastAttemptAt): bool
{
    $lastTimestamp = strtotime($lastAttemptAt);

    if ($lastTimestamp === false) {
        return true;
    }

    $intervalSeconds = match ($schedule) {
        'weekly' => 7 * 86400,
        'monthly' => 30 * 86400,
        default => 86400,
    };

    return $lastTimestamp + $intervalSeconds <= time();
}

function backup_maybe_run_automatic(PDO $pdo): void
{
    $settings = backup_settings($pdo);

    if (!$settings['automaticEnabled']) {
        return;
    }

    if (!backup_schedule_due($settings['schedule'], $settings['lastAutomaticBackupAt'])) {
        return;
    }

    hris_store_application_setting($pdo, 'backup_last_auto_at', date('Y-m-d H:i:s'));

    try {
        backup_create_record($pdo, 'Automatic', $settings['backupPath'], null, $settings['backupDateTime'] ?? '');
    } catch (Throwable $exception) {
        error_log('Automatic backup failed: ' . $exception->getMessage());
    }
}

function backup_payload(PDO $pdo): array
{
    backup_maybe_run_automatic($pdo);

    return [
        'success' => true,
        'settings' => backup_settings($pdo),
        'history' => backup_list_history($pdo),
    ];
}

function backup_stream_record(array $record): void
{
    if (($record['status'] ?? '') === 'Deleted' || !is_file((string)$record['filePath'])) {
        json_response([
            'success' => false,
            'message' => 'Backup file is no longer available.',
        ], 404);
    }

    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . basename((string)$record['fileName']) . '"');
    header('Content-Length: ' . (string)filesize((string)$record['filePath']));
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');

    readfile((string)$record['filePath']);
    exit;
}

backup_ensure_history_table($pdo);
hris_ensure_audit_logs_table($pdo);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $action = array_key_exists('action', $_GET) ? backup_text($_GET['action']) : 'legacy_download';

    if ($action === 'settings' || $action === 'history') {
        json_response(backup_payload($pdo));
    }

    if ($action === 'view') {
        $recordId = (int)($_GET['id'] ?? 0);
        $record = $recordId > 0 ? backup_fetch_record($pdo, $recordId) : null;

        if ($record === null) {
            json_response([
                'success' => false,
                'message' => 'Backup record not found.',
            ], 404);
        }

        json_response([
            'success' => true,
            'record' => $record,
        ]);
    }

    if ($action === 'download') {
        $recordId = (int)($_GET['id'] ?? 0);

        if ($recordId > 0) {
            $record = backup_fetch_record($pdo, $recordId);

            if ($record === null) {
                json_response([
                    'success' => false,
                    'message' => 'Backup record not found.',
                ], 404);
            }

            write_auth_audit($pdo, $sessionUser, 'backup.download', 'A database backup was downloaded.', [
                'backupId' => $recordId,
                'fileName' => $record['fileName'] ?? null,
            ]);
            backup_stream_record($record);
        }

        try {
            $settings = backup_settings($pdo);
            $record = backup_create_record($pdo, 'Manual', $settings['backupPath'], $sessionUser, $settings['backupDateTime'] ?? '');
        } catch (Throwable $exception) {
            json_response([
                'success' => false,
                'message' => 'Unable to create database backup.',
            ], 500);
        }
        write_auth_audit($pdo, $sessionUser, 'backup.manual_download', 'A manual database backup was created and downloaded.', [
            'backupId' => $record['id'] ?? null,
            'fileName' => $record['fileName'] ?? null,
        ]);
        backup_stream_record($record);
    }

    if ($action === 'legacy_download') {
        try {
            $settings = backup_settings($pdo);
            $record = backup_create_record($pdo, 'Manual', $settings['backupPath'], $sessionUser, $settings['backupDateTime'] ?? '');
        } catch (Throwable $exception) {
            json_response([
                'success' => false,
                'message' => 'Unable to create database backup.',
            ], 500);
        }
        write_auth_audit($pdo, $sessionUser, 'backup.download', 'A database backup was downloaded.', [
            'backupId' => $record['id'] ?? null,
            'fileName' => $record['fileName'] ?? null,
        ]);
        backup_stream_record($record);
    }
}

$body = read_json_body();
$action = backup_text($body['action'] ?? '');

if ($method === 'POST' && ($action === '' || $action === 'manual')) {
    try {
        $settings = backup_settings($pdo);
        $backupDateTime = backup_normalize_datetime($body['backupDateTime'] ?? $settings['backupDateTime'] ?? '');

        if (array_key_exists('backupDateTime', $body)) {
            hris_store_application_setting($pdo, 'backup_date_time', $backupDateTime);
            $settings['backupDateTime'] = $backupDateTime;
        }

        $record = backup_create_record($pdo, 'Manual', $settings['backupPath'], $sessionUser, $backupDateTime);
        write_auth_audit($pdo, $sessionUser, 'backup.manual_created', 'A manual database backup was created.', [
            'backupId' => $record['id'] ?? null,
            'fileName' => $record['fileName'] ?? null,
            'backupDateTime' => $record['backupDateTime'] ?? null,
        ]);

        json_response([
            'success' => true,
            'message' => 'Manual backup created successfully.',
            'record' => $record,
            'history' => backup_list_history($pdo),
            'settings' => backup_settings($pdo),
        ], 201);
    } catch (Throwable $exception) {
        json_response([
            'success' => false,
            'message' => 'Unable to create manual backup.',
            'history' => backup_list_history($pdo),
            'settings' => backup_settings($pdo),
        ], 500);
    }
}

if ($method === 'PUT' && ($action === '' || $action === 'settings')) {
    try {
        $settings = backup_store_settings($pdo, $body);
    } catch (Throwable $exception) {
        json_response([
            'success' => false,
            'message' => $exception->getMessage() ?: 'Unable to save backup settings.',
        ], 422);
    }

    write_auth_audit($pdo, $sessionUser, 'backup.settings_updated', 'Automatic database backup settings were updated.', [
        'schedule' => $settings['schedule'],
        'backupPath' => $settings['backupPath'],
        'backupDateTime' => $settings['backupDateTime'],
        'automaticEnabled' => $settings['automaticEnabled'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Backup settings saved successfully.',
        'settings' => $settings,
        'history' => backup_list_history($pdo),
    ]);
}

if ($method === 'DELETE') {
    $recordId = (int)($body['id'] ?? $_GET['id'] ?? 0);
    $record = $recordId > 0 ? backup_fetch_record($pdo, $recordId) : null;

    if ($record === null) {
        json_response([
            'success' => false,
            'message' => 'Backup record not found.',
        ], 404);
    }

    if (($record['status'] ?? '') !== 'Deleted' && is_file((string)$record['filePath'])) {
        @unlink((string)$record['filePath']);
    }

    $statement = $pdo->prepare(
        'UPDATE backup_history
         SET status = "Deleted",
             deleted_at = NOW()
         WHERE id = :id'
    );
    $statement->execute([':id' => $recordId]);
    write_auth_audit($pdo, $sessionUser, 'backup.deleted', 'A database backup file was deleted.', [
        'backupId' => $recordId,
        'fileName' => $record['fileName'] ?? null,
    ]);

    json_response([
        'success' => true,
        'message' => 'Backup deleted successfully.',
        'record' => backup_fetch_record($pdo, $recordId),
        'history' => backup_list_history($pdo),
        'settings' => backup_settings($pdo),
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
