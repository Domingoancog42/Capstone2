<?php
declare(strict_types=1);

// The real upload/reminder handlers run against connection-local temporary tables only.
// Disk storage and session resolution are replaced at their boundaries for deterministic testing.
function medical_test_load_functions(string $path, array $names): void
{
    $source = file_get_contents($path);
    preg_match_all('/^function ([a-zA-Z0-9_]+)\(/m', $source, $matches, PREG_OFFSET_CAPTURE);
    foreach ($matches[1] as [$name, $offset]) {
        if (!in_array($name, $names, true)) continue;
        $start = strrpos(substr($source, 0, $offset), 'function ');
        $tokens = token_get_all('<?php ' . substr($source, $start));
        $code = ''; $depth = 0; $opened = false;
        foreach (array_slice($tokens, 1) as $token) {
            $code .= is_array($token) ? $token[1] : $token;
            if ($token === '{') { $depth++; $opened = true; }
            if ($token === '}' && --$depth === 0 && $opened) break;
        }
        eval($code);
    }
}
class MedicalTestResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
function json_response(array $body, int $status = 200): void { throw new MedicalTestResponse($body, $status); }
function session_employee_record_id(PDO $pdo, array $user): ?int { return $user['linked_employee_record_id'] ?? null; }
function ensure_archive_columns(PDO $pdo, string $table): void {}
function ensure_notification_ids(PDO $pdo): void {}
function store_leave_attachment(array $upload): array
{
    if (($upload['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) throw new RuntimeException('Unable to upload the attachment.');
    return ['fileName' => 'medical.pdf', 'filePath' => 'uploads/leave-attachments/test.pdf', 'fileSize' => 12, 'absolutePath' => __DIR__ . '/nonexistent-test-file.pdf'];
}
function fetch_leave_request(PDO $pdo, int $id, ?int $employeeId = null): array
{
    $statement = $pdo->prepare('SELECT file_name AS attachmentName, file_path AS attachmentPath FROM leave_attachments WHERE leave_request_id = ? ORDER BY leave_attachments_id DESC LIMIT 1');
    $statement->execute([$id]);
    return ['id' => $id] + ($statement->fetch() ?: []);
}
function medical_test_assert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
    echo 'PASS: ' . $message . PHP_EOL;
}
medical_test_load_functions(__DIR__ . '/../api/connection-pdo.php', ['normalize_notification_type', 'notification_insert']);
medical_test_load_functions(__DIR__ . '/../api/leave_request.php', ['upload_leave_medical_certificate']);
require __DIR__ . '/../api/leave-medical-certificate-utils.php';

$pdo = new PDO(getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4', getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec("SET time_zone = '+08:00', timestamp = UNIX_TIMESTAMP('2026-10-12 09:00:00')");
$pdo->exec('CREATE TEMPORARY TABLE leave_types (leave_type_id INT PRIMARY KEY, name VARCHAR(100)) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE leave_requests (
    leave_request_id INT PRIMARY KEY, employee_id INT, leave_type_id INT, start_date DATE, end_date DATE,
    status VARCHAR(30) DEFAULT "pending", is_archived TINYINT DEFAULT 0, requested_at DATETIME, updated_at DATETIME
) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE leave_attachments (leave_attachments_id INT AUTO_INCREMENT PRIMARY KEY, leave_request_id INT, file_name VARCHAR(255), file_path VARCHAR(255), file_size INT) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE notifications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, title VARCHAR(255), message TEXT, type VARCHAR(100), is_read TINYINT DEFAULT 0, reference_id VARCHAR(100), created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
ensure_leave_medical_certificate_schema($pdo);
$pdo->exec('INSERT INTO leave_types VALUES (1, "Sick Leave"), (2, "Vacation Leave")');
$pdo->exec('INSERT INTO leave_requests (leave_request_id, employee_id, leave_type_id, start_date, end_date, requested_at, updated_at) VALUES
    (1, 10, 1, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 3 DAY), NOW()),
    (2, 10, 1, "2026-10-12", "2026-10-12", DATE_ADD(DATE_SUB(NOW(), INTERVAL 3 DAY), INTERVAL 1 SECOND), NOW()),
    (3, 10, 1, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 4 DAY), NOW()),
    (4, 10, 2, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 4 DAY), NOW()),
    (5, 20, 1, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 4 DAY), NOW()),
    (6, 10, 1, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 4 DAY), NOW()),
    (7, 10, 1, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 4 DAY), NOW()),
    (8, 10, 1, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 4 DAY), NOW()),
    (9, 10, 1, "2026-10-12", "2026-10-12", DATE_SUB(NOW(), INTERVAL 4 DAY), NOW())');
$pdo->exec('INSERT INTO leave_attachments (leave_request_id, file_name, file_path, file_size) VALUES (3, "existing.pdf", "uploads/existing.pdf", 10)');
$pdo->exec('UPDATE leave_requests SET status = "cancelled" WHERE leave_request_id = 6');
$pdo->exec('UPDATE leave_requests SET status = "rejected" WHERE leave_request_id = 7');
$pdo->exec('UPDATE leave_requests SET is_archived = 1 WHERE leave_request_id = 8');
$pdo->exec('UPDATE leave_requests SET status = "approved" WHERE leave_request_id = 9');
$user = ['id' => 100, 'linked_employee_record_id' => 10];
send_due_leave_medical_certificate_reminders($pdo, $user);
$references = $pdo->query('SELECT reference_id FROM notifications ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
medical_test_assert($references === ['1', '9'], 'Reminder starts at exactly 72 hours, reaches only the applicant, and skips uploaded/inactive/non-sick requests');
send_due_leave_medical_certificate_reminders($pdo, $user);
medical_test_assert((int)$pdo->query('SELECT COUNT(*) FROM notifications')->fetchColumn() === 2, 'Polling does not duplicate reminders');

foreach ([1 => 200, 2 => 200, 4 => 422, 5 => 404, 6 => 422, 7 => 422, 8 => 422, 9 => 200] as $id => $expected) {
    try {
        upload_leave_medical_certificate($pdo, ['id' => $id], $user, ['error' => UPLOAD_ERR_OK]);
        throw new RuntimeException('Handler returned without a response');
    } catch (MedicalTestResponse $response) {
        medical_test_assert($response->status === $expected, 'Upload request ' . $id . ' returns ' . $expected);
    }
}
medical_test_assert((int)$pdo->query('SELECT COUNT(*) FROM leave_attachments')->fetchColumn() === 4, 'Rejected uploads create no attachment rows');
medical_test_assert((int)$pdo->query('SELECT COUNT(*) FROM notifications WHERE is_read = 0')->fetchColumn() === 0, 'Uploading acknowledges the outstanding certificate reminders');
try {
    upload_leave_medical_certificate($pdo, ['id' => 2], $user, ['error' => UPLOAD_ERR_PARTIAL]);
} catch (MedicalTestResponse $response) {
    medical_test_assert($response->status === 422 && !$pdo->inTransaction(), 'Failed uploads roll back and can be retried');
}
$pdo->exec('DELETE FROM notifications');
$pdo->exec('DELETE FROM leave_attachments WHERE leave_request_id = 9');
send_due_leave_medical_certificate_reminders($pdo, $user);
medical_test_assert((int)$pdo->query('SELECT COUNT(*) FROM notifications')->fetchColumn() === 0, 'Deleting a reminder does not cause it to repeat');
