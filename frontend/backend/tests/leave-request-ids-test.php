<?php
declare(strict_types=1);

// Temporary tables shadow the live tables; no application records are changed.
$source = file_get_contents(__DIR__ . '/../api/leave_request.php');
$start = strpos($source, 'function ensure_leave_request_ids(');
$end = strpos($source, 'function ensure_leave_request_rejected_note_column(', $start);
eval(substr($source, $start, $end - $start));

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root',
    getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
function check_leave_ids(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$originalMode = (string)$pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn();
$pdo->exec('CREATE TEMPORARY TABLE leave_requests (leave_request_id INT NOT NULL PRIMARY KEY, reason TEXT) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE leave_attachments (leave_attachments_id INT UNSIGNED NOT NULL PRIMARY KEY, leave_request_id INT NOT NULL) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE leave_types (leave_type_id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(80)) ENGINE=InnoDB');
$pdo->exec("INSERT INTO leave_requests VALUES (0, 'Existing request'), (7, 'Existing request')");
$pdo->exec('INSERT INTO leave_attachments VALUES (0, 0)');
$pdo->exec("INSERT INTO leave_types VALUES (0, 'Existing type'), (3, 'Existing type')");

ensure_leave_request_ids($pdo);
check_leave_ids((string)$pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn() === $originalMode, 'SQL mode must be restored');
check_leave_ids((int)$pdo->query('SELECT COUNT(*) FROM leave_requests WHERE leave_request_id IN (0, 7)')->fetchColumn() === 2, 'Existing request IDs must be preserved');
check_leave_ids((int)$pdo->query('SELECT COUNT(*) FROM leave_attachments a JOIN leave_requests r ON r.leave_request_id = a.leave_request_id WHERE a.leave_attachments_id = 0 AND r.leave_request_id = 0')->fetchColumn() === 1, 'Existing attachment link must be preserved');
check_leave_ids(str_contains((string)$pdo->query("SHOW COLUMNS FROM leave_attachments LIKE 'leave_attachments_id'")->fetch()['Type'], 'unsigned'), 'ID signedness must be preserved');

$createdIds = [];
for ($i = 0; $i < 2; $i++) {
    $pdo->exec("INSERT INTO leave_requests (reason) VALUES ('New request')");
    $id = (int)$pdo->lastInsertId();
    $createdIds[] = $id;
    check_leave_ids($id > 7, 'New IDs must follow existing request IDs');
    $pdo->exec('INSERT INTO leave_attachments (leave_request_id) VALUES (' . $id . ')');
    check_leave_ids((int)$pdo->lastInsertId() > 0, 'Attachments must receive generated IDs');
}
check_leave_ids(count(array_unique($createdIds)) === 2, 'Consecutive requests must receive unique IDs');
$pdo->exec("INSERT INTO leave_types (name) VALUES ('New type')");
check_leave_ids((int)$pdo->lastInsertId() > 3, 'Leave types must receive generated IDs');
ensure_leave_request_ids($pdo);
check_leave_ids((int)$pdo->query('SELECT COUNT(*) FROM leave_requests')->fetchColumn() === 4, 'Repeated repair must preserve all records');
echo "Leave ID repair: existing IDs/links preserved, repeated inserts succeeded, SQL mode restored.\n";
