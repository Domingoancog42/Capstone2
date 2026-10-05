<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

if (user_role_key($sessionUser) !== 'admin') {
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

    /*
     * A drive-letter path saved on XAMPP (the stored default is C:\xampp\...\backups) names nothing
     * on a Linux host such as InfinityFree. Left alone it would become "C:/xampp/..." relative to the
     * working directory -- inside backend/api, where .sql files are not denied. The default folder,
     * with its own .htaccess, is the safe reading. On Windows DIRECTORY_SEPARATOR is "\" and this
     * never applies.
     */
    if (DIRECTORY_SEPARATOR === '/' && preg_match('/^[A-Za-z]:[\\\\\\/]/', $path) === 1) {
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

function backup_settings(PDO $pdo): array
{
    $directory = backup_resolve_directory(
        get_application_setting($pdo, 'backup_file_path', backup_default_directory())
    );

    return [
        'automaticEnabled' => get_boolean_application_setting($pdo, 'backup_automatic_enabled', false),
        'schedule' => backup_normalize_schedule(get_application_setting($pdo, 'backup_schedule', 'daily')),
        'backupPath' => $directory,
        'backupDateTime' => get_application_setting($pdo, 'backup_date_time', ''),
        'lastAutomaticBackupAt' => get_application_setting($pdo, 'backup_last_auto_at', ''),
    ];
}

function backup_store_settings(PDO $pdo, array $body): array
{
    $schedule = backup_normalize_schedule($body['schedule'] ?? 'daily');
    $directory = backup_resolve_directory(backup_text($body['backupPath'] ?? $body['filePath'] ?? ''));
    $automaticEnabled = backup_bool($body['automaticEnabled'] ?? false);
    $backupDateTime = backup_normalize_datetime($body['backupDateTime'] ?? '');

    backup_ensure_directory($directory);

    store_boolean_application_setting($pdo, 'backup_automatic_enabled', $automaticEnabled);
    store_application_setting($pdo, 'backup_schedule', $schedule);
    store_application_setting($pdo, 'backup_file_path', $directory);
    store_application_setting($pdo, 'backup_date_time', $backupDateTime);

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

function backup_file_record_id(string $filePath): int
{
    $normalizedPath = strtolower(str_replace('\\', '/', $filePath));

    return (int)sprintf('%u', crc32($normalizedPath));
}

function backup_file_record(string $filePath): ?array
{
    if (!is_file($filePath) || strtolower((string)pathinfo($filePath, PATHINFO_EXTENSION)) !== 'sql') {
        return null;
    }

    $fileName = basename($filePath);
    $modifiedAt = filemtime($filePath);
    $modifiedAt = $modifiedAt !== false ? $modifiedAt : time();

    return [
        'id' => backup_file_record_id($filePath),
        'backupType' => str_contains(strtolower($fileName), '-automatic-') ? 'Automatic' : 'Manual',
        'backupDateTime' => date('Y-m-d H:i:s', $modifiedAt),
        'fileName' => $fileName,
        'filePath' => $filePath,
        'fileSize' => (int)(filesize($filePath) ?: 0),
        'status' => 'Completed',
        'errorMessage' => null,
        'createdByUserId' => null,
        'createdBy' => '',
        'deletedAt' => null,
        'updatedAt' => date('Y-m-d H:i:s', $modifiedAt),
    ];
}

function backup_list_history(PDO $pdo): array
{
    $directory = (string)(backup_settings($pdo)['backupPath'] ?? backup_default_directory());

    if (!is_dir($directory)) {
        return [];
    }

    $files = glob($directory . DIRECTORY_SEPARATOR . 'hris-backup-*.sql') ?: [];
    $records = [];

    foreach ($files as $filePath) {
        $record = backup_file_record($filePath);
        if ($record !== null) {
            $records[] = $record;
        }
    }

    usort(
        $records,
        static fn (array $left, array $right): int => strcmp(
            (string)($right['backupDateTime'] ?? ''),
            (string)($left['backupDateTime'] ?? '')
        )
    );

    return array_slice($records, 0, 200);
}

function backup_fetch_record(PDO $pdo, int $id): ?array
{
    if ($id <= 0) {
        return null;
    }

    foreach (backup_list_history($pdo) as $record) {
        if ((int)($record['id'] ?? 0) === $id) {
            return $record;
        }
    }

    return null;
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

        $createdTimestamp = strtotime($createdAt);
        if ($createdTimestamp !== false) {
            @touch($filePath, $createdTimestamp);
        }

        $record = backup_file_record($filePath) ?? [];
        $record['createdByUserId'] = $createdByUserId;
        $record['createdBy'] = backup_text($user['username'] ?? '');

        return $record;
    } catch (Throwable $exception) {
        if (is_file($filePath)) {
            @unlink($filePath);
        }

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

    store_application_setting($pdo, 'backup_last_auto_at', date('Y-m-d H:i:s'));

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

ensure_audit_logs_table($pdo);

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
            store_application_setting($pdo, 'backup_date_time', $backupDateTime);
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

    if (is_file((string)$record['filePath']) && !@unlink((string)$record['filePath'])) {
        json_response([
            'success' => false,
            'message' => 'Unable to delete the backup file.',
        ], 500);
    }

    $deletedRecord = [
        ...$record,
        'status' => 'Deleted',
        'deletedAt' => date('Y-m-d H:i:s'),
    ];
    write_auth_audit($pdo, $sessionUser, 'backup.deleted', 'A database backup file was deleted.', [
        'backupId' => $recordId,
        'fileName' => $record['fileName'] ?? null,
    ]);

    json_response([
        'success' => true,
        'message' => 'Backup deleted successfully.',
        'record' => $deletedRecord,
        'history' => backup_list_history($pdo),
        'settings' => backup_settings($pdo),
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
