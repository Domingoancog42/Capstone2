<?php
declare(strict_types=1);

// Exercise the production settings helpers and handler against a temporary settings table.
// Authentication responses and audit delivery are captured; no persistent records change.
function filing_signatories_test_load_function(string $path, string $name): void
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

class FilingSignatoriesTestResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status)
    {
        parent::__construct($body['message'] ?? '');
    }
}

function json_response(array $body, int $status = 200): void
{
    throw new FilingSignatoriesTestResponse($body, $status);
}
function ensure_application_settings_table(PDO $pdo): void {}
// Temporary tables are absent from INFORMATION_SCHEMA; the test provisions this table below.
function changes_table_exists(PDO $pdo, string $table): bool { return $table === 'settings'; }
function write_auth_audit(PDO $pdo, array $user, string $action, string $summary, array $details): void
{
    $GLOBALS['filingSignatoryTestAudits'][] = compact('user', 'action', 'summary', 'details');
}
function filing_signatories_test_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
    $GLOBALS['filingSignatoryTestAssertions']++;
}
function filing_signatories_test_response(callable $handler): FilingSignatoriesTestResponse
{
    try {
        $handler();
    } catch (FilingSignatoriesTestResponse $response) {
        return $response;
    }
    throw new RuntimeException('Handler returned without a response.');
}

require __DIR__ . '/../api/auth.php';
foreach (['normalize_token', 'normalize_role', 'user_exact_role_key'] as $name) {
    filing_signatories_test_load_function(__DIR__ . '/../api/connection-pdo.php', $name);
}
foreach ([
    'get_application_setting', 'store_application_setting', 'settings_filing_signatories',
    'list_filing_signatories_settings', 'settings_update_filing_signatories',
] as $name) {
    filing_signatories_test_load_function(__DIR__ . '/../api/settings.php', $name);
}
$changeFeedSource = file_get_contents(__DIR__ . '/../api/changes.php');
$topicConstantStart = strpos($changeFeedSource, 'const CHANGE_FEED_TOPICS =');
if ($topicConstantStart === false) throw new RuntimeException('Missing change-feed topic configuration.');
$topicConstantCode = '';
foreach (array_slice(token_get_all('<?php ' . substr($changeFeedSource, $topicConstantStart)), 1) as $token) {
    $topicConstantCode .= is_array($token) ? $token[1] : $token;
    if ($token === ';') break;
}
eval($topicConstantCode);
filing_signatories_test_load_function(__DIR__ . '/../api/changes.php', 'changes_table_revision');

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root',
    getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
$pdo->exec('CREATE TEMPORARY TABLE settings (
    setting_key VARCHAR(120) PRIMARY KEY,
    setting_value LONGTEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)');
$pdo->exec("INSERT INTO settings (setting_key, setting_value) VALUES ('unrelated_setting', 'preserved')");
$GLOBALS['filingSignatoryTestAssertions'] = 0;
$GLOBALS['filingSignatoryTestAudits'] = [];
$defaults = ['showTimestamps' => true, 'showESignatures' => true];
$admin = ['id' => 123, 'role' => 'Admin', 'permissions' => ['settings' => ['view', 'edit']]];

$response = filing_signatories_test_response(fn() => list_filing_signatories_settings($pdo));
filing_signatories_test_expect($response->status === 200 && $response->body['status'] === 'success', 'focused read succeeds');
filing_signatories_test_expect($response->body['filingSignatories'] === $defaults, 'both controls default to enabled');
filing_signatories_test_expect(array_keys($response->body) === ['status', 'success', 'filingSignatories'], 'focused read exposes only the display policy');

foreach ([
    ['showTimestamps' => false, 'showESignatures' => false],
    ['showTimestamps' => true, 'showESignatures' => false],
    ['showTimestamps' => false, 'showESignatures' => true],
    $defaults,
] as $settings) {
    $response = filing_signatories_test_response(fn() => settings_update_filing_signatories($pdo, $admin, $settings));
    filing_signatories_test_expect($response->status === 200 && $response->body['filingSignatories'] === $settings, 'both boolean values round-trip');
    filing_signatories_test_expect(settings_filing_signatories($pdo) === $settings, 'subsequent read sees the saved policy');
    filing_signatories_test_expect(get_application_setting($pdo, 'unrelated_setting') === 'preserved', 'other settings remain unchanged');
    $audit = end($GLOBALS['filingSignatoryTestAudits']);
    filing_signatories_test_expect($audit['action'] === 'settings.filing_signatories_updated' && $audit['details']['settings'] === $settings, 'successful save is audited');
}
filing_signatories_test_expect((int)$pdo->query("SELECT COUNT(*) FROM settings WHERE setting_key = 'filing_signatories'")->fetchColumn() === 1, 'both controls occupy one atomic settings row');

$valid = ['showTimestamps' => false, 'showESignatures' => true];
store_application_setting($pdo, 'filing_signatories', json_encode($valid));
$auditCount = count($GLOBALS['filingSignatoryTestAudits']);
foreach (['employee', 'hrhead', 'hrstaff', 'chief', 'regionaldirector', 'customadministrator'] as $role) {
    $user = array_merge($admin, ['role' => $role, 'baseRoleKey' => 'admin']);
    $response = filing_signatories_test_response(fn() => settings_update_filing_signatories($pdo, $user, $defaults));
    filing_signatories_test_expect($response->status === 403 && settings_filing_signatories($pdo) === $valid, 'non-admin cannot write, even with admin base role and settings permission: ' . $role);
}
$response = filing_signatories_test_response(fn() => settings_update_filing_signatories($pdo, array_merge($admin, ['permissions' => ['settings' => ['view']]]), $defaults));
filing_signatories_test_expect($response->status === 403 && settings_filing_signatories($pdo) === $valid, 'settings edit permission is required');

foreach (['showTimestamps', 'showESignatures'] as $field) {
    foreach ([null, 0, 1, 'false', 'true', [], new stdClass()] as $invalid) {
        $body = array_merge($defaults, [$field => $invalid]);
        $response = filing_signatories_test_response(fn() => settings_update_filing_signatories($pdo, $admin, $body));
        filing_signatories_test_expect($response->status === 422 && settings_filing_signatories($pdo) === $valid, 'non-boolean value is rejected without a partial save');
    }
    $body = $defaults;
    unset($body[$field]);
    $response = filing_signatories_test_response(fn() => settings_update_filing_signatories($pdo, $admin, $body));
    filing_signatories_test_expect($response->status === 422 && settings_filing_signatories($pdo) === $valid, 'missing field is rejected without a partial save');
}
filing_signatories_test_expect(count($GLOBALS['filingSignatoryTestAudits']) === $auditCount, 'failed writes do not emit success audits');

store_application_setting($pdo, 'filing_signatories', '{invalid json');
filing_signatories_test_expect(settings_filing_signatories($pdo) === $defaults, 'corrupt stored JSON uses enabled defaults');
store_application_setting($pdo, 'filing_signatories', '{"showTimestamps":false,"showESignatures":"false"}');
filing_signatories_test_expect(settings_filing_signatories($pdo) === ['showTimestamps' => false, 'showESignatures' => true], 'invalid stored values use their safe defaults');

$config = CHANGE_FEED_TOPICS['filing_signatories'][0] ?? null;
filing_signatories_test_expect(is_array($config), 'filing signatories have a cross-machine change-feed topic');
$revision = static function () use ($pdo, $config): string {
    $cache = [];
    return changes_table_revision($pdo, $config, $cache);
};
$pdo->exec("UPDATE settings SET updated_at = '2026-01-01 00:00:00'");
$before = $revision();
filing_signatories_test_expect(!in_array($before, ['absent', 'error', ''], true), 'topic scans the actual temporary settings table');
$pdo->exec("UPDATE settings SET setting_value = 'changed', updated_at = '2099-01-01 00:00:00' WHERE setting_key = 'unrelated_setting'");
filing_signatories_test_expect($revision() === $before, 'unrelated settings changes do not alter filing policy revision');
$updatePolicy = $pdo->prepare("UPDATE settings SET setting_value = ? WHERE setting_key = 'filing_signatories'");
$updatePolicy->execute([json_encode($defaults)]);
$afterValueChange = $revision();
filing_signatories_test_expect($afterValueChange !== $before, 'policy value changes alter revision even with an unchanged timestamp');
$pdo->exec("UPDATE settings SET updated_at = '2026-01-02 00:00:00' WHERE setting_key = 'filing_signatories'");
$afterTimestampChange = $revision();
filing_signatories_test_expect($afterTimestampChange !== $afterValueChange, 'policy timestamp changes alter revision');
$pdo->exec("DELETE FROM settings WHERE setting_key = 'filing_signatories'");
filing_signatories_test_expect($revision() !== $afterTimestampChange, 'removing the saved policy also changes its revision');

echo 'PASS: ' . $GLOBALS['filingSignatoryTestAssertions'] . ' filing signatory settings checks. Temporary table only.' . PHP_EOL;
