<?php
declare(strict_types=1);

// Exercise the real archive handlers. Storage/session boundaries are in memory; no live records change.
function archive_test_load_function(string $path, string $name): void
{
    $source = file_get_contents($path);
    $start = strpos($source, 'function ' . $name . '(');
    if ($start === false) throw new RuntimeException('Missing function: ' . $name);
    $tokens = token_get_all('<?php ' . substr($source, $start));
    $code = ''; $depth = 0; $opened = false;
    foreach (array_slice($tokens, 1) as $token) {
        $code .= is_array($token) ? $token[1] : $token;
        if ($token === '{') { $depth++; $opened = true; }
        if ($token === '}' && --$depth === 0 && $opened) break;
    }
    eval($code);
}
class ArchiveTestResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
class ArchiveTestPDO extends PDO
{
    public array $records = [];
    public function __construct() {}
}
function json_response(array $body, int $status = 200): void { throw new ArchiveTestResponse($body, $status); }
function user_role_key(array $user): string { return $user['role']; }
function leave_can_manage(array $user): bool { return $user['role'] === 'admin'; }
function monetization_can_manage(array $user): bool { return $user['role'] === 'admin'; }
function leave_read_scopes(PDO $pdo, array $user): array { return ['employeeId' => $user['employeeId'], 'divisionId' => null]; }
function monetization_employee_scope_id(PDO $pdo, array $user): ?int { return $user['employeeId']; }
function fetch_leave_request(PDO $pdo, int $id, ?int $employeeId = null, ?int $divisionId = null): ?array
{
    $record = $pdo->records[$id] ?? null;
    return $record && ($employeeId === null || $record['employeeRecordId'] === $employeeId) ? $record : null;
}
function fetch_leave_monetization(PDO $pdo, int $id, ?int $employeeId = null): ?array { return fetch_leave_request($pdo, $id, $employeeId); }
function set_record_archived(PDO $pdo, string $table, string $key, int $id, bool $archived, array $user, string $label): int
{
    $pdo->records[$id]['isArchived'] = $archived;
    $pdo->records[$id]['archivedByUserId'] = $archived ? $user['id'] : null;
    return 1;
}
foreach (['leave_role_key', 'leave_is_self_service_role', 'leave_can_archive', 'leave_is_chief', 'archive_leave_request'] as $name) {
    archive_test_load_function(__DIR__ . '/../api/leave_request.php', $name);
}
foreach (['monetization_role_key', 'monetization_is_self_service_role', 'monetization_can_archive', 'archive_leave_monetization'] as $name) {
    archive_test_load_function(__DIR__ . '/../api/leave_monetization.php', $name);
}
$pdo = new ArchiveTestPDO();
$user = ['id' => 100, 'employeeId' => 10, 'role' => 'employee'];
$handlers = ['leave' => 'archive_leave_request', 'monetization' => 'archive_leave_monetization'];
foreach ($handlers as $module => $handler) {
    foreach (['Pending', 'Endorsed', 'Reviewed', 'Chief Reviewed', 'Approved', 'Rejected', 'Cancelled'] as $status) {
        $pdo->records = [1 => ['id' => 1, 'employeeRecordId' => 10, 'status' => $status, 'isArchived' => false, 'archivedByUserId' => null]];
        try { $handler($pdo, ['id' => 1], $user, true); } catch (ArchiveTestResponse $response) {
            if ($response->status !== 200 || !$pdo->records[1]['isArchived'] || $pdo->records[1]['status'] !== $status) {
                throw new RuntimeException('FAIL: ' . $module . ' archive at ' . $status);
            }
        }
        try { $handler($pdo, ['id' => 1], $user, false); } catch (ArchiveTestResponse $response) {
            if ($response->status !== 200 || $pdo->records[1]['isArchived']) throw new RuntimeException('FAIL: restore at ' . $status);
        }
    }
    echo 'PASS: Employee can archive and restore ' . $module . ' requests at every status without changing approval status.' . PHP_EOL;

    $pdo->records = [1 => ['id' => 1, 'employeeRecordId' => 20, 'status' => 'Pending', 'isArchived' => false, 'archivedByUserId' => null]];
    try { $handler($pdo, ['id' => 1], $user, true); } catch (ArchiveTestResponse $response) {
        if ($response->status !== 404 || $pdo->records[1]['isArchived']) throw new RuntimeException('FAIL: other employee archive');
    }
    $pdo->records[1] = ['id' => 1, 'employeeRecordId' => 10, 'status' => 'Pending', 'isArchived' => true, 'archivedByUserId' => 999];
    try { $handler($pdo, ['id' => 1], $user, false); } catch (ArchiveTestResponse $response) {
        if ($response->status !== 403 || !$pdo->records[1]['isArchived']) throw new RuntimeException('FAIL: wrong archiver restore');
    }
    $pdo->records[1]['isArchived'] = false;
    foreach (['planningofficer', 'cashier'] as $role) {
        try { $handler($pdo, ['id' => 1], array_merge($user, ['role' => $role]), true); } catch (ArchiveTestResponse $response) {
            if ($response->status !== 422 || $pdo->records[1]['isArchived']) throw new RuntimeException('FAIL: unrelated role rule changed');
        }
    }
    echo 'PASS: ' . $module . ' ownership, restore permissions, and other roles\' restrictions remain enforced.' . PHP_EOL;
}
