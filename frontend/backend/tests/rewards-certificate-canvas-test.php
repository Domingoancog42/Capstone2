<?php
declare(strict_types=1);

// Run production normalizers, library storage, and API handlers with connection-local temporary
// tables. The test never edits application settings, uploaded files, award cycles, or issued awards.
function certificate_canvas_test_load(string $path, string $name): void
{
    $source = file_get_contents($path);
    $start = strpos($source, 'function ' . $name . '(');
    if ($start === false) throw new RuntimeException('Missing function: ' . $name);
    $code = ''; $depth = 0; $opened = false;
    foreach (array_slice(token_get_all('<?php ' . substr($source, $start)), 1) as $token) {
        $code .= is_array($token) ? $token[1] : $token;
        if ($token === '{') { $depth++; $opened = true; }
        if ($token === '}' && --$depth === 0 && $opened) break;
    }
    eval($code);
}

class CertificateCanvasTestResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status)
    {
        parent::__construct($body['message'] ?? '');
    }
}
function json_response(array $body, int $status = 200): void { throw new CertificateCanvasTestResponse($body, $status); }
function ensure_application_settings_table(PDO $pdo): void {}
function read_json_body(): array { return $GLOBALS['certificateCanvasTestBody']; }
function user_role_key(array $user): string { return strtolower($user['role'] ?? ''); }
function write_auth_audit(PDO $pdo, array $user, string $action, string $summary, array $details): void
{
    $GLOBALS['certificateCanvasTestAudits'][] = compact('action', 'details');
}
function rewards_remove_certificate_signature_file(string $path): void { $GLOBALS['certificateCanvasTestRemovals'][] = $path; }
function rewards_remove_certificate_design_file(string $path): void { $GLOBALS['certificateCanvasTestRemovals'][] = $path; }
function certificate_canvas_test_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException('FAIL: ' . $message);
    $GLOBALS['certificateCanvasTestAssertions']++;
}
function certificate_canvas_test_response(callable $handler, array $body = []): CertificateCanvasTestResponse
{
    $GLOBALS['certificateCanvasTestBody'] = $body;
    try { $handler(); } catch (CertificateCanvasTestResponse $response) { return $response; }
    throw new RuntimeException('Handler returned without a response.');
}

foreach (['get_application_setting', 'store_application_setting'] as $name) {
    certificate_canvas_test_load(__DIR__ . '/../api/settings.php', $name);
}
foreach ([
    'rewards_text', 'rewards_can_manage', 'rewards_request_body',
    'rewards_default_certificate_template', 'rewards_legacy_certificate_template',
    'rewards_certificate_color', 'rewards_number_between', 'rewards_certificate_image_path',
    'rewards_normalize_certificate_template', 'rewards_normalize_canvas_certificate_template',
    'rewards_certificate_template_record_name', 'rewards_certificate_template_library',
    'rewards_store_certificate_template_library', 'rewards_certificate_template',
    'rewards_create_certificate_template', 'rewards_save_certificate_template', 'rewards_delete_certificate_template',
    'rewards_certificate_template_asset_paths', 'rewards_certificate_asset_is_referenced',
    'rewards_remove_certificate_asset_file',
] as $name) {
    certificate_canvas_test_load(__DIR__ . '/../api/rewards.php', $name);
}
$GLOBALS['certificateCanvasTestAssertions'] = 0;
$GLOBALS['certificateCanvasTestAudits'] = [];
$GLOBALS['certificateCanvasTestRemovals'] = [];
$_POST = [];
$blank = rewards_default_certificate_template();
certificate_canvas_test_expect($blank['version'] === 2 && $blank['preset'] === 'blank' && $blank['elements'] === [], 'default certificate is an empty canvas');
certificate_canvas_test_expect($blank['paper'] === ['backgroundColor' => '#ffffff'], 'new certificate starts with white paper');
certificate_canvas_test_expect(rewards_normalize_certificate_template(null) === $blank, 'missing templates start blank');
certificate_canvas_test_expect(rewards_normalize_certificate_template([]) === $blank, 'empty template input starts blank');

$canvas = [
    'version' => 2, 'preset' => 'blank', 'paper' => ['backgroundColor' => '#aBcDeF'],
    'backgroundImage' => 'uploads/certificate-designs/background_a.png', 'backgroundImageFit' => 'cover',
    'elements' => [
        ['id' => 'my-heading', 'type' => 'text', 'x' => 110, 'y' => 64, 'width' => 740, 'height' => 110,
            'rotation' => -8, 'opacity' => 0.85, 'locked' => false,
            'text' => "Custom award\n{{employeeName}} — {{awardTitle}}", 'fontSize' => 56,
            'fontFamily' => "Georgia, 'Times New Roman', serif", 'fontWeight' => 700, 'fontStyle' => 'italic',
            'textAlign' => 'right', 'color' => '#123456', 'letterSpacing' => 3, 'lineHeight' => 1.5, 'textTransform' => 'uppercase'],
        ['id' => 'my-logo', 'type' => 'image', 'src' => 'uploads/certificate-designs/small_logo.webp',
            'fit' => 'contain', 'x' => 20, 'y' => 22, 'width' => 64, 'height' => 48, 'rotation' => 5, 'opacity' => 1, 'locked' => true],
        ['id' => 'my-rule', 'type' => 'shape', 'shape' => 'line', 'fill' => 'transparent', 'stroke' => '#abcdef',
            'strokeWidth' => 3, 'borderRadius' => 0, 'x' => 40, 'y' => 580, 'width' => 870, 'height' => 8,
            'rotation' => 0, 'opacity' => 0.7, 'locked' => false],
    ],
];
$normalized = rewards_normalize_certificate_template($canvas);
certificate_canvas_test_expect(array_column($normalized['elements'], 'id') === ['my-heading', 'my-logo', 'my-rule'], 'arbitrary object IDs and stacking order are retained');
certificate_canvas_test_expect($normalized['elements'] == $canvas['elements'], 'custom text, image, shapes, geometry, and formatting survive normalization');
certificate_canvas_test_expect($normalized['paper']['backgroundColor'] === '#abcdef', 'colors normalize to six-digit lowercase hex');
certificate_canvas_test_expect(rewards_normalize_certificate_template(json_decode(json_encode($normalized), true)) == $normalized, 'v2 JSON round trip is stable');
certificate_canvas_test_expect(rewards_normalize_certificate_template(['version' => 2, 'elements' => []])['elements'] === [], 'an intentionally empty canvas remains empty');
certificate_canvas_test_expect(rewards_normalize_certificate_template(['elements' => $canvas['elements']])['elements'] == $normalized['elements'], 'unversioned object lists are recognized as user-designed canvases');
certificate_canvas_test_expect(rewards_normalize_certificate_template(['unexpected' => true]) === $blank, 'unrecognized template data never adds hardcoded certificate content');

$hostile = ['version' => 2, 'paper' => ['backgroundColor' => 'url(javascript:alert(1))'], 'elements' => [[
    'id' => '<script>', 'type' => 'text', 'x' => -500, 'y' => 2000, 'width' => 2000, 'height' => -50,
    'rotation' => INF, 'opacity' => 6, 'locked' => 'false', 'fontSize' => 1000,
    'fontFamily' => 'url(https://evil.invalid)', 'color' => 'red; background-image:url(x)', 'fontWeight' => 431,
    'text' => str_repeat('é', 5001), 'html' => '<script>alert(1)</script>', 'onClick' => 'alert(1)', 'style' => ['position' => 'fixed'],
], ['id' => 'element_1', 'type' => 'shape', 'shape' => 'iframe'], ['type' => 'iframe']]];
$safe = rewards_normalize_certificate_template($hostile);
$safeText = $safe['elements'][0];
certificate_canvas_test_expect(count($safe['elements']) === 2 && array_column($safe['elements'], 'id') === ['element_1', 'element_2'], 'unsupported object types are dropped and IDs stay unique');
certificate_canvas_test_expect($safeText['x'] == 0 && $safeText['y'] == 678 && $safeText['width'] == 960 && $safeText['height'] == 1, 'object geometry is clamped to the certificate bounds');
certificate_canvas_test_expect($safeText['rotation'] == 0 && $safeText['opacity'] == 1 && $safeText['locked'] === false, 'non-finite rotation, opacity and lock are safely normalized');
certificate_canvas_test_expect($safeText['fontSize'] == 128 && $safeText['fontWeight'] === 400 && $safeText['fontFamily'] === 'Arial, Helvetica, sans-serif', 'font values use supported limits and family allowlist');
certificate_canvas_test_expect($safeText['color'] === '#111827' && $safe['paper']['backgroundColor'] === '#ffffff', 'CSS expressions cannot enter color properties');
certificate_canvas_test_expect(preg_match_all('/./us', $safeText['text']) === 5000, 'text is limited without breaking multibyte characters');
certificate_canvas_test_expect(!isset($safeText['html'], $safeText['onClick'], $safeText['style']) && !array_key_exists('html', $safeText), 'HTML, event handlers and arbitrary style are not persisted');
foreach (['data:image/png;base64,abcd', 'javascript:alert(1)', 'https://evil.invalid/logo.png', '../uploads/certificate-designs/a.png', 'uploads/certificate-designs/../a.png', 'uploads/certificate-designs/a.svg', 'uploads/certificate-designs/a.png?x=1', ['src' => 'a']] as $source) {
    $candidate = rewards_normalize_certificate_template(['version' => 2, 'backgroundImage' => $source, 'elements' => [['id' => 'image', 'type' => 'image', 'src' => $source]]]);
    certificate_canvas_test_expect($candidate['backgroundImage'] === '' && $candidate['elements'][0]['src'] === '', 'unsafe image and background sources are rejected');
}
certificate_canvas_test_expect(rewards_certificate_image_path('uploads/certificate-signatures/signature_1.png') !== '', 'uploaded signatures can be ordinary canvas images');
foreach (['/mgb.png', '/bagongpilipinas.png'] as $logo) {
    $logoTemplate = rewards_normalize_certificate_template(['version' => 2, 'elements' => [['id' => 'logo', 'type' => 'image', 'src' => $logo]]]);
    certificate_canvas_test_expect($logoTemplate['elements'][0]['src'] === $logo, 'bundled logos survive saving an editable preset');
}
certificate_canvas_test_expect(rewards_certificate_image_path('/private.png') === '', 'other root image paths are rejected');
$ringTemplate = rewards_normalize_certificate_template(['version' => 2, 'elements' => [
    ['id' => 'ring', 'type' => 'shape', 'shape' => 'ellipse', 'x' => -105, 'y' => 469, 'width' => 330, 'height' => 330, 'strokeWidth' => 48],
]]);
certificate_canvas_test_expect($ringTemplate['elements'][0]['x'] == -105 && $ringTemplate['elements'][0]['y'] == 469 && $ringTemplate['elements'][0]['strokeWidth'] == 48, 'preset decorations retain their clipped geometry and thick borders');
certificate_canvas_test_expect(rewards_normalize_certificate_template($ringTemplate) == $ringTemplate, 'editable decoration geometry survives repeated saves');
certificate_canvas_test_expect(count(rewards_normalize_certificate_template(['version' => 2, 'elements' => array_fill(0, 150, ['type' => 'shape'])])['elements']) === 100, 'canvas object count is capped at 100');
certificate_canvas_test_expect(rewards_normalize_certificate_template(['version' => 2, 'elements' => ['legacy' => ['type' => 'text']]])['elements'] === [], 'v2 elements must be an ordered list');

$legacy = rewards_legacy_certificate_template();
$legacy['preset'] = 'emerald';
$legacy['text']['title'] = 'Previously issued award';
$legacy['backgroundImage'] = 'uploads/certificate-designs/legacy_background.png';
$legacy['signatureImage'] = 'uploads/certificate-signatures/legacy_signature.png';
certificate_canvas_test_expect(rewards_normalize_certificate_template($legacy) == $legacy, 'legacy preset, content, images and element positions remain unchanged');
$unversioned = $legacy; unset($unversioned['version']);
certificate_canvas_test_expect(rewards_normalize_certificate_template($unversioned) == $legacy, 'older unversioned preset templates still normalize as v1');
certificate_canvas_test_expect(rewards_normalize_certificate_template(['version' => 1]) == rewards_legacy_certificate_template(), 'legacy partial records retain their original preset defaults');

$pdo = new PDO(
    getenv('HRIS_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=hris;charset=utf8mb4',
    getenv('HRIS_TEST_DB_USER') ?: 'root', getenv('HRIS_TEST_DB_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
$pdo->exec('CREATE TEMPORARY TABLE settings (setting_key VARCHAR(120) PRIMARY KEY, setting_value LONGTEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
$pdo->exec('CREATE TEMPORARY TABLE reward_cycles (id INT PRIMARY KEY, certificate_template LONGTEXT NULL)');
$pdo->exec('CREATE TEMPORARY TABLE reward_certificates (id INT PRIMARY KEY, template_snapshot LONGTEXT NULL)');
$admin = ['id' => 123, 'role' => 'admin'];
$initialLibrary = rewards_certificate_template_library($pdo);
certificate_canvas_test_expect($initialLibrary['templates'][0]['template'] === $blank, 'new libraries begin with a blank certificate');
certificate_canvas_test_expect((int)$pdo->query('SELECT COUNT(*) FROM settings')->fetchColumn() === 0, 'reading defaults does not write settings');
store_application_setting($pdo, 'reward_certificate_template', json_encode($legacy, JSON_UNESCAPED_SLASHES));
certificate_canvas_test_expect(rewards_certificate_template_library($pdo)['templates'][0]['template'] == $legacy, 'existing single-template settings migrate to the library without visual changes');
$cycleSnapshot = json_encode($legacy, JSON_UNESCAPED_SLASHES);
$issuedSnapshot = json_encode($normalized, JSON_UNESCAPED_SLASHES);
$pdo->prepare('INSERT INTO reward_cycles (id, certificate_template) VALUES (1, ?)')->execute([$cycleSnapshot]);
$pdo->prepare('INSERT INTO reward_certificates (id, template_snapshot) VALUES (1, ?)')->execute([$issuedSnapshot]);
$created = certificate_canvas_test_response(fn() => rewards_create_certificate_template($pdo, $admin), ['name' => 'User-designed award', 'template' => $canvas]);
certificate_canvas_test_expect($created->status === 201 && $created->body['template'] == $normalized, 'create handler returns all custom canvas objects');
$createdId = $created->body['templateRecord']['id'];
certificate_canvas_test_expect(rewards_certificate_template($pdo) == $normalized, 'saved library and active setting round-trip user-created objects');
certificate_canvas_test_expect($pdo->query('SELECT certificate_template FROM reward_cycles WHERE id = 1')->fetchColumn() === $cycleSnapshot && $pdo->query('SELECT template_snapshot FROM reward_certificates WHERE id = 1')->fetchColumn() === $issuedSnapshot, 'editing library never rewrites assigned or issued snapshots');
certificate_canvas_test_expect(rewards_certificate_asset_is_referenced($pdo, 'backgroundImage', $canvas['elements'][1]['src']), 'image src in a saved library counts as a reference');
certificate_canvas_test_expect(rewards_certificate_asset_is_referenced($pdo, 'signatureImage', $legacy['signatureImage']), 'legacy assigned snapshots retain their signature assets');
certificate_canvas_test_expect(!rewards_certificate_asset_is_referenced($pdo, 'src', 'uploads/certificate-designs/smallXlogo.webp'), 'asset filename underscores are literal rather than SQL wildcards');
$pdo->prepare('INSERT INTO reward_cycles (id, certificate_template) VALUES (2, ?)')->execute([json_encode(['version' => 2, 'elements' => [['type' => 'image', 'src' => 'uploads/certificate-designs/escaped_path.png']]])]);
certificate_canvas_test_expect(rewards_certificate_asset_is_referenced($pdo, 'src', 'uploads/certificate-designs/escaped_path.png'), 'historical JSON with escaped slashes also protects referenced assets');

$cleared = certificate_canvas_test_response(fn() => rewards_save_certificate_template($pdo, $admin), ['templateId' => $createdId, 'template' => $blank]);
certificate_canvas_test_expect($cleared->status === 200 && $cleared->body['template']['elements'] === [] && rewards_certificate_template($pdo)['elements'] === [], 'saving an empty canvas stays empty after a library reload');
certificate_canvas_test_expect(!in_array($canvas['elements'][1]['src'], $GLOBALS['certificateCanvasTestRemovals'], true), 'issued image objects protect assets removed from the editable template');
certificate_canvas_test_expect(rewards_certificate_asset_is_referenced($pdo, 'src', $canvas['elements'][1]['src']), 'issued element src is retained after library no longer uses it');

$fresh = certificate_canvas_test_response(fn() => rewards_create_certificate_template($pdo, $admin), ['name' => 'Fresh blank']);
certificate_canvas_test_expect($fresh->body['template'] === $blank, 'create without a template begins with a white empty canvas');
$denied = certificate_canvas_test_response(fn() => rewards_save_certificate_template($pdo, ['role' => 'employee']), ['templateId' => $createdId, 'template' => $canvas]);
certificate_canvas_test_expect($denied->status === 403, 'employee role cannot change library templates');

// Convert the legacy image into a v2 object, then delete the old preset record. The shared file must
// be retained even though it is no longer referenced by the old dedicated backgroundImage field.
$reused = $blank;
$reused['elements'] = [['id' => 'reused', 'type' => 'image', 'src' => $legacy['backgroundImage']]];
certificate_canvas_test_response(fn() => rewards_save_certificate_template($pdo, $admin), ['templateId' => $createdId, 'template' => $reused]);
$pdo->exec('DELETE FROM reward_cycles');
$deleted = certificate_canvas_test_response(fn() => rewards_delete_certificate_template($pdo, $admin), ['templateId' => 'default']);
certificate_canvas_test_expect($deleted->status === 200, 'legacy template can be deleted after another template is saved');
certificate_canvas_test_expect(!in_array($legacy['backgroundImage'], $GLOBALS['certificateCanvasTestRemovals'], true), 'v2 src protects a background reused from a deleted legacy template');
certificate_canvas_test_expect(in_array($legacy['signatureImage'], $GLOBALS['certificateCanvasTestRemovals'], true), 'unreferenced legacy signature is eligible for cleanup');

echo 'PASS: ' . $GLOBALS['certificateCanvasTestAssertions'] . ' certificate canvas checks. Temporary tables only.' . PHP_EOL;
