<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

/**
 * Rewards & Recognition — award cycles and the nominations filed against them.
 *
 * Voting is open to every signed-in account; creating, editing, closing, and deleting a cycle is
 * not. That split is the whole point of the module, so it is enforced here rather than left to the
 * UI that hides the buttons.
 */

function rewards_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function rewards_can_manage(array $user): bool
{
    return in_array(user_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
}

function rewards_request_body(): array
{
    if (!empty($_POST)) {
        return $_POST;
    }

    return read_json_body();
}

function rewards_date_or_null(mixed $value): ?string
{
    $text = substr(rewards_text($value), 0, 10);
    if ($text === '') {
        return null;
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $text);

    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

/**
 * A nomination period is a moment, not a day: the closing end carries a time so a cycle can be set
 * to stop at 5pm rather than at some unstated point in the day.
 *
 * `datetime-local` posts "Y-m-dTH:i", storage hands back "Y-m-d H:i:s", and a period saved before
 * this was a bare "Y-m-d" — all three are accepted. A date with no time is read as the whole day,
 * so `$endOfDay` fills in the end the caller means: 00:00 for an opening, 23:59 for a closing.
 */
function rewards_datetime_or_null(mixed $value, bool $endOfDay = false): ?string
{
    $text = str_replace('T', ' ', rewards_text($value));
    if ($text === '') {
        return null;
    }

    foreach (['Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d'] as $format) {
        $parsed = DateTimeImmutable::createFromFormat($format, $text);

        if ($parsed && $parsed->format($format) === $text) {
            return $format === 'Y-m-d'
                ? $parsed->format('Y-m-d') . ($endOfDay ? ' 23:59:00' : ' 00:00:00')
                : $parsed->format('Y-m-d H:i:00');
        }
    }

    return null;
}

/** How long before the deadline the one-time "closing soon" notice goes out. */
const REWARDS_CLOSING_NOTICE_LEAD_MINUTES = 24 * 60;

/**
 * Whether the nomination period is over for a cycle already fetched.
 *
 * A manager who reopens voting after the deadline has passed is overriding that deadline on purpose —
 * it is how a tied cycle gets settled — so a reopening later than the closing time keeps the ballot
 * open until somebody closes it or sets a new one. `rewards_close_expired_cycles()` selects on the
 * same rule; the two must agree, or the sweep would shut a ballot this still calls open.
 */
function rewards_voting_has_ended(array $cycle): bool
{
    $closesOn = rewards_text($cycle['closesOn'] ?? '');

    if ($closesOn === '' || strtotime($closesOn) === false || strtotime($closesOn) > time()) {
        return false;
    }

    $reopenedAt = rewards_text($cycle['reopenedAt'] ?? '');

    return $reopenedAt === '' || strtotime($reopenedAt) <= strtotime($closesOn);
}

/** "Aug 9, 2026 at 5:00 PM" — the deadline as it reads in a notification. */
function rewards_period_label(?string $value): string
{
    $moment = $value !== null && $value !== '' ? strtotime($value) : false;

    return $moment === false ? 'the closing date' : date('M j, Y \a\t g:i A', $moment);
}

/**
 * Every account that can sign in, which for this module means every account that can vote.
 *
 * Deliberately not role-scoped: an award cycle is the one thing in the system the whole office takes
 * part in, so narrowing it to a role list would leave somebody unable to nominate and unaware of it.
 */
function rewards_notify_everyone(PDO $pdo, string $title, string $message, string $type, ?string $referenceId = null): int
{
    $userIds = $pdo->query('SELECT id FROM users WHERE is_archived = 0')->fetchAll(PDO::FETCH_COLUMN);

    return notify_users($pdo, $userIds, $title, $message, $type, $referenceId);
}

/**
 * The "voting closes soon" reminder, sent once per cycle.
 *
 * There is no scheduler in this deployment, so the check rides on the request that lists the cycles —
 * anybody opening Rewards & Recognition inside the warning window is what sets it off. The stamp is
 * claimed with a conditional UPDATE before the notifications are written, so two requests arriving
 * together cannot both send it: the second one updates no rows and does nothing.
 */
function rewards_send_due_closing_notices(PDO $pdo): void
{
    $due = $pdo->prepare(
        'SELECT id, category, closes_on AS closesOn
         FROM reward_cycles
         WHERE is_archived = 0
           AND status <> "closed"
           AND closes_on IS NOT NULL
           AND closing_notice_sent_at IS NULL
           AND closes_on > NOW()
           AND closes_on <= DATE_ADD(NOW(), INTERVAL :lead MINUTE)'
    );
    $due->execute([':lead' => REWARDS_CLOSING_NOTICE_LEAD_MINUTES]);
    $cycles = $due->fetchAll();

    if ($cycles === []) {
        return;
    }

    $claim = $pdo->prepare('UPDATE reward_cycles SET closing_notice_sent_at = NOW() WHERE id = :id AND closing_notice_sent_at IS NULL');

    foreach ($cycles as $cycle) {
        $claim->execute([':id' => (int)$cycle['id']]);

        if ($claim->rowCount() === 0) {
            continue;
        }

        rewards_notify_everyone(
            $pdo,
            'Voting closes soon: ' . $cycle['category'],
            sprintf(
                'Nominations for %s close on %s. Cast or change your votes before then.',
                $cycle['category'],
                rewards_period_label($cycle['closesOn'])
            ),
            'award_cycle_closing',
            (string)$cycle['id']
        );
    }
}

function ensure_rewards_tables(PDO $pdo): void
{
    /*
     * Installs predating the archive column still need it added; the schema in
     * database/hris.sql already carries it. Cheap enough to check on every request.
     */
    $hasArchiveColumn = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycles"
           AND COLUMN_NAME = "is_archived"'
    )->fetchColumn();

    if ($hasArchiveColumn === 0) {
        $pdo->exec('ALTER TABLE reward_cycles ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER created_by_name');
        $pdo->exec('ALTER TABLE reward_cycles ADD KEY idx_reward_cycles_archived (is_archived)');
    }

    /*
     * The period ends at a time of day, so both columns widen from DATE to DATETIME. A widening
     * conversion fills the time in as 00:00, which would be right for an opening and wrong for a
     * closing — a cycle "closing on the 7th" has always meant through the end of the 7th — so the
     * closing end is pushed to 23:59 in the same pass. Both statements are no-ops once converted.
     */
    $periodIsDateOnly = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycles"
           AND COLUMN_NAME IN ("opens_on", "closes_on")
           AND DATA_TYPE = "date"'
    )->fetchColumn();

    if ($periodIsDateOnly > 0) {
        $pdo->exec('ALTER TABLE reward_cycles MODIFY opens_on DATETIME NULL, MODIFY closes_on DATETIME NULL');
        $pdo->exec('UPDATE reward_cycles SET closes_on = DATE_ADD(closes_on, INTERVAL 1439 MINUTE) WHERE closes_on IS NOT NULL');
    }

    /*
     * Stamped the first time the "closing soon" notice goes out for a cycle, so the reminder reaches
     * everyone once instead of on every request that happens to land inside the warning window.
     * Cleared when the period is edited, which is what lets a rescheduled cycle warn again.
     */
    $hasClosingNoticeColumn = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycles"
           AND COLUMN_NAME = "closing_notice_sent_at"'
    )->fetchColumn();

    if ($hasClosingNoticeColumn === 0) {
        $pdo->exec('ALTER TABLE reward_cycles ADD COLUMN closing_notice_sent_at DATETIME NULL AFTER closes_on');
    }

    /*
     * When a manager last reopened voting, which is what stops the deadline sweep from immediately
     * undoing them: reopening a cycle whose deadline has already passed — the way a tie gets broken —
     * is an explicit override of that deadline. Setting a new closing time re-arms the sweep on its
     * own, because the stamp is then older than the deadline again.
     */
    $hasReopenedColumn = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycles"
           AND COLUMN_NAME = "reopened_at"'
    )->fetchColumn();

    if ($hasReopenedColumn === 0) {
        $pdo->exec('ALTER TABLE reward_cycles ADD COLUMN reopened_at DATETIME NULL AFTER closing_notice_sent_at');
    }

    /* The design chosen for one nomination cycle. Kept as a normalized JSON snapshot. */
    $hasCycleTemplateColumn = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycles"
           AND COLUMN_NAME = "certificate_template"'
    )->fetchColumn();

    if ($hasCycleTemplateColumn === 0) {
        $pdo->exec('ALTER TABLE reward_cycles ADD COLUMN certificate_template LONGTEXT NULL AFTER reopened_at');
    }

    /* Preserve the exact design an employee received even if HR edits templates later. */
    $hasCertificateTemplateColumn = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_certificates"
           AND COLUMN_NAME = "template_snapshot"'
    )->fetchColumn();

    if ($hasCertificateTemplateColumn === 0) {
        $pdo->exec('ALTER TABLE reward_certificates ADD COLUMN template_snapshot LONGTEXT NULL AFTER signatory_title');
    }

    /*
     * A voter may nominate several people in one cycle, so the unique key spans the nominee as well:
     * it stops the same voter backing the same nominee twice (a double-submit or a second tab) while
     * still allowing one row per person they picked. Leaving that to the UI would let a race stuff
     * the ballot, and the tally would have no way to tell.
     *
     * Named `reward_cycle_votes` rather than `reward_nominations`, which was the retired certificate
     * module's table and held an unrelated shape. That table has since been dropped, but the name
     * stays clear of it so an old dump restored over this schema cannot point these queries at it.
     */
    /*
     * Installs created before multi-nomination still carry the two-column key, which would reject
     * every pick after the first. Widening it keeps existing ballots intact — each stored vote is
     * already unique under the wider key — so no rows have to be touched.
     */
    $voteKeyColumns = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycle_votes"
           AND INDEX_NAME = "uniq_reward_cycle_vote_voter"'
    )->fetchColumn();

    if ($voteKeyColumns === 2) {
        /*
         * Both halves in one statement, and not a DROP followed by an ADD: this index is what backs
         * the `cycle_id` foreign key, and InnoDB refuses to drop it while it stands alone (error
         * 1553). Swapped together, the wider key is in place to cover the constraint.
         */
        $pdo->exec(
            'ALTER TABLE reward_cycle_votes
             DROP INDEX uniq_reward_cycle_vote_voter,
             ADD UNIQUE KEY uniq_reward_cycle_vote_voter (cycle_id, voter_user_id, nominee_employee_id)'
        );
    }

    /*
     * The certificate a closed cycle mints for its winner.
     *
     * One row per cycle, enforced by the unique key: closing a cycle that is already closed must not
     * hand out a second certificate, and re-closing after a reopen re-points the existing row rather
     * than stacking another. Everything about the awardee is snapshotted — a certificate names who
     * somebody was on the day they were awarded, so a later transfer or rename must not rewrite it.
     */
    /*
     * One counter per year behind the certificate number. The table predates this module — the
     * retired certificate module left it behind empty — and is reused rather than duplicated so a
     * number can never be issued twice for the same year.
     */
}

/**
 * The default visual certificate template. A cycle may snapshot this (or an unsaved editor draft)
 * for its own winner, and the issued certificate snapshots it again so historical awards do not
 * change when HR edits the default later.
 */
function rewards_default_certificate_template(): array
{
    $serif = "Georgia, 'Times New Roman', serif";
    $sans = 'Arial, Helvetica, sans-serif';
    $element = static function (int $x, int $y, int $width, array $overrides = []) use ($sans): array {
        return array_merge([
            'x' => $x,
            'y' => $y,
            'width' => $width,
            'fontSize' => 14,
            'fontFamily' => $sans,
            'fontWeight' => 400,
            'fontStyle' => 'normal',
            'textAlign' => 'center',
            'color' => '#334155',
            'letterSpacing' => 0,
            'textTransform' => 'none',
            'lineHeight' => 1.35,
        ], $overrides);
    };

    return [
        'version' => 1,
        'preset' => 'classic',
        'paper' => [
            'backgroundColor' => '#fffdf7',
            'primaryColor' => '#8a641f',
            'accentColor' => '#d6ae4b',
        ],
        'text' => [
            'organization' => "Republic of the Philippines\nDepartment of Environment and Natural Resources\nMINES AND GEOSCIENCES BUREAU\nRegional Office No. X\nDENR-X Compound, Puntod, Cagayan de Oro City",
            'title' => 'CERTIFICATE OF RECOGNITION',
            'lead' => 'is proudly presented to',
            'message' => 'for having been chosen by peers as',
            'closing' => 'In recognition of outstanding service, dedication, and contribution to the Bureau.',
            'venue' => 'the Mines and Geosciences Bureau, Regional Office No. X, Cagayan de Oro City',
            'signatoryTitle' => 'OIC Regional Executive Director',
        ],
        'backgroundImage' => '',
        'backgroundImageFit' => 'cover',
        'signatureImage' => '',
        'showLeftLogo' => true,
        'showRightLogo' => true,
        'elements' => [
            'leftLogo' => $element(55, 35, 70),
            'rightLogo' => $element(835, 35, 70),
            'organization' => $element(205, 31, 550, ['fontSize' => 11, 'fontWeight' => 500, 'color' => '#334155', 'lineHeight' => 1.3]),
            'title' => $element(100, 176, 760, ['fontSize' => 29, 'fontFamily' => $serif, 'fontWeight' => 700, 'color' => '#765315', 'letterSpacing' => 5]),
            'lead' => $element(245, 226, 470, ['fontSize' => 14, 'fontFamily' => $serif, 'fontStyle' => 'italic', 'color' => '#64748b']),
            'recipient' => $element(105, 254, 750, ['fontSize' => 36, 'fontFamily' => $serif, 'fontWeight' => 700, 'color' => '#111827', 'letterSpacing' => 0.5]),
            'job' => $element(180, 304, 600, ['fontSize' => 11, 'color' => '#64748b']),
            'message' => $element(175, 337, 610, ['fontSize' => 13, 'fontFamily' => $serif, 'color' => '#334155']),
            'award' => $element(130, 370, 700, ['fontSize' => 21, 'fontFamily' => $serif, 'fontWeight' => 700, 'color' => '#765315', 'letterSpacing' => 1.5, 'textTransform' => 'uppercase']),
            'period' => $element(180, 413, 600, ['fontSize' => 11, 'color' => '#64748b']),
            'closing' => $element(170, 443, 620, ['fontSize' => 11, 'fontFamily' => $serif, 'color' => '#475569']),
            'dateLine' => $element(165, 477, 630, ['fontSize' => 10, 'color' => '#64748b', 'lineHeight' => 1.45]),
            'signatureImage' => $element(650, 492, 160),
            'signature' => $element(590, 542, 280, ['fontSize' => 14, 'fontFamily' => $serif, 'fontWeight' => 700, 'color' => '#111827', 'textTransform' => 'uppercase']),
            'signatureTitle' => $element(600, 575, 260, ['fontSize' => 10, 'color' => '#64748b']),
            'footer' => $element(50, 631, 860, ['fontSize' => 9, 'color' => '#64748b']),
        ],
    ];
}

function rewards_certificate_color(mixed $value, string $fallback): string
{
    $color = strtolower(rewards_text($value));
    return preg_match('/^#[0-9a-f]{6}$/', $color) === 1 ? $color : $fallback;
}

function rewards_number_between(mixed $value, float $fallback, float $minimum, float $maximum): float
{
    if (!is_numeric($value)) {
        return $fallback;
    }

    return max($minimum, min($maximum, (float)$value));
}

/** Whitelist every visual field before it reaches shared certificate rendering. */
function rewards_normalize_certificate_template(mixed $candidate): array
{
    $default = rewards_default_certificate_template();
    if (!is_array($candidate)) {
        return $default;
    }

    $template = $default;
    $preset = rewards_text($candidate['preset'] ?? '');
    $allowedPresets = [
        'classic',
        'modern',
        'executive',
        'emerald',
        'burgundy',
        'minimal',
        'geometric',
        'ceremonial',
        'academic',
        'sunrise',
    ];
    $template['preset'] = in_array($preset, $allowedPresets, true) ? $preset : 'classic';

    if (in_array($template['preset'], ['modern', 'geometric'], true)) {
        $template['elements']['leftLogo']['x'] = 42;
    } elseif (in_array($template['preset'], ['executive', 'burgundy', 'ceremonial'], true)) {
        $template['elements']['leftLogo']['y'] = 30;
        $template['elements']['rightLogo']['y'] = 30;
    }

    $paper = is_array($candidate['paper'] ?? null) ? $candidate['paper'] : [];
    foreach (['backgroundColor', 'primaryColor', 'accentColor'] as $key) {
        $template['paper'][$key] = rewards_certificate_color($paper[$key] ?? null, $default['paper'][$key]);
    }

    $text = is_array($candidate['text'] ?? null) ? $candidate['text'] : [];
    $textLimits = [
        'organization' => 600,
        'title' => 120,
        'lead' => 180,
        'message' => 500,
        'closing' => 500,
        'venue' => 300,
        'signatoryTitle' => 160,
    ];
    foreach ($textLimits as $key => $limit) {
        $template['text'][$key] = substr(trim((string)($text[$key] ?? $default['text'][$key])), 0, $limit);
    }

    $backgroundImage = rewards_text($candidate['backgroundImage'] ?? '');
    $template['backgroundImage'] = preg_match(
        '#^uploads/certificate-designs/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$#i',
        $backgroundImage
    ) === 1 ? $backgroundImage : '';
    $template['backgroundImageFit'] = ($candidate['backgroundImageFit'] ?? '') === 'contain'
        ? 'contain'
        : 'cover';

    $signatureImage = rewards_text($candidate['signatureImage'] ?? '');
    $template['signatureImage'] = preg_match(
        '#^uploads/certificate-signatures/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$#i',
        $signatureImage
    ) === 1 ? $signatureImage : '';

    $template['showLeftLogo'] = array_key_exists('showLeftLogo', $candidate)
        ? (bool)$candidate['showLeftLogo']
        : true;
    $template['showRightLogo'] = array_key_exists('showRightLogo', $candidate)
        ? (bool)$candidate['showRightLogo']
        : true;

    $elements = is_array($candidate['elements'] ?? null) ? $candidate['elements'] : [];
    $allowedFonts = [
        "Georgia, 'Times New Roman', serif",
        "'Times New Roman', Times, serif",
        "Garamond, 'Times New Roman', serif",
        "'Palatino Linotype', Palatino, serif",
        'Cambria, Georgia, serif',
        "'Book Antiqua', Palatino, serif",
        'Baskerville, Georgia, serif',
        'Arial, Helvetica, sans-serif',
        "'Trebuchet MS', Arial, sans-serif",
        "'Segoe UI', Arial, sans-serif",
        "'Century Gothic', Arial, sans-serif",
        'Verdana, Geneva, sans-serif',
        'Tahoma, Geneva, sans-serif',
        "'Franklin Gothic Medium', Arial, sans-serif",
        "'Monotype Corsiva', 'Segoe Script', cursive",
        "'Brush Script MT', 'Segoe Script', cursive",
        "'Segoe Script', 'Brush Script MT', cursive",
    ];

    foreach ($default['elements'] as $id => $fallback) {
        $input = is_array($elements[$id] ?? null) ? $elements[$id] : [];
        $isLogo = in_array($id, ['leftLogo', 'rightLogo'], true);
        $isSignatureImage = $id === 'signatureImage';
        $width = rewards_number_between(
            $input['width'] ?? null,
            (float)$template['elements'][$id]['width'],
            $isLogo ? 36 : ($isSignatureImage ? 80 : 80),
            $isLogo ? 140 : ($isSignatureImage ? 260 : 960)
        );
        $font = (string)($input['fontFamily'] ?? '');
        $weight = (int)rewards_number_between($input['fontWeight'] ?? null, (float)$fallback['fontWeight'], 400, 700);

        $template['elements'][$id] = [
            'x' => rewards_number_between($input['x'] ?? null, (float)$template['elements'][$id]['x'], 0, 960 - $width),
            'y' => rewards_number_between(
                $input['y'] ?? null,
                (float)$template['elements'][$id]['y'],
                0,
                $isLogo ? 679 - $width : ($isSignatureImage ? 679 - ($width * 0.34) : 661)
            ),
            'width' => $width,
            'fontSize' => rewards_number_between($input['fontSize'] ?? null, (float)$fallback['fontSize'], 8, 64),
            'fontFamily' => in_array($font, $allowedFonts, true) ? $font : $fallback['fontFamily'],
            'fontWeight' => in_array($weight, [400, 500, 600, 700], true) ? $weight : (int)$fallback['fontWeight'],
            'fontStyle' => in_array($input['fontStyle'] ?? '', ['normal', 'italic'], true) ? $input['fontStyle'] : $fallback['fontStyle'],
            'textAlign' => in_array($input['textAlign'] ?? '', ['left', 'center', 'right'], true) ? $input['textAlign'] : $fallback['textAlign'],
            'color' => rewards_certificate_color($input['color'] ?? null, $fallback['color']),
            'letterSpacing' => rewards_number_between($input['letterSpacing'] ?? null, (float)$fallback['letterSpacing'], -1, 10),
            'textTransform' => in_array($input['textTransform'] ?? '', ['none', 'uppercase'], true) ? $input['textTransform'] : $fallback['textTransform'],
            'lineHeight' => rewards_number_between($input['lineHeight'] ?? null, (float)$fallback['lineHeight'], 1, 2),
        ];
    }

    return $template;
}

function rewards_certificate_template(PDO $pdo): array
{
    $stored = json_decode(get_application_setting($pdo, 'reward_certificate_template', ''), true);
    return rewards_normalize_certificate_template($stored);
}

function rewards_get_certificate_template(PDO $pdo): void
{
    json_response([
        'success' => true,
        'template' => rewards_certificate_template($pdo),
    ]);
}

function rewards_remove_certificate_signature_file(string $storedPath): void
{
    if (preg_match('#^uploads/certificate-signatures/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$#i', $storedPath) !== 1) {
        return;
    }

    $baseDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'certificate-signatures';
    $absolutePath = dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $storedPath);
    $resolvedBase = realpath($baseDirectory);
    $resolvedFile = realpath($absolutePath);

    if ($resolvedBase === false || $resolvedFile === false || strpos($resolvedFile, $resolvedBase) !== 0 || !is_file($resolvedFile)) {
        return;
    }

    @unlink($resolvedFile);
}

function rewards_remove_certificate_design_file(string $storedPath): void
{
    if (preg_match('#^uploads/certificate-designs/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$#i', $storedPath) !== 1) {
        return;
    }

    $baseDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'certificate-designs';
    $absolutePath = dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $storedPath);
    $resolvedBase = realpath($baseDirectory);
    $resolvedFile = realpath($absolutePath);

    if ($resolvedBase === false || $resolvedFile === false || strpos($resolvedFile, $resolvedBase) !== 0 || !is_file($resolvedFile)) {
        return;
    }

    @unlink($resolvedFile);
}

function rewards_upload_certificate_signature(PDO $pdo, array $user): void
{
    if (!rewards_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to upload certificate signatures.'], 403);
    }

    $file = $_FILES['signature'] ?? null;
    if (!is_array($file) || (int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response(['success' => false, 'message' => 'Choose a signature image to upload.'], 422);
    }

    $temporaryFile = (string)($file['tmp_name'] ?? '');
    $fileSize = (int)($file['size'] ?? 0);
    if ($temporaryFile === '' || !is_uploaded_file($temporaryFile) || $fileSize <= 0) {
        json_response(['success' => false, 'message' => 'The uploaded signature image is invalid.'], 422);
    }

    if ($fileSize > 2 * 1024 * 1024) {
        json_response(['success' => false, 'message' => 'The signature image must be 2 MB or smaller.'], 422);
    }

    $image = @getimagesize($temporaryFile);
    $mime = strtolower((string)($image['mime'] ?? ''));
    $extensions = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
    ];

    if (!isset($extensions[$mime])) {
        json_response(['success' => false, 'message' => 'Use a PNG, JPG, or WebP signature image.'], 422);
    }

    if ((int)($image[0] ?? 0) <= 0 || (int)($image[1] ?? 0) <= 0 || (int)$image[0] > 5000 || (int)$image[1] > 5000) {
        json_response(['success' => false, 'message' => 'The signature image dimensions are invalid.'], 422);
    }

    $uploadDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'certificate-signatures';
    if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true) && !is_dir($uploadDirectory)) {
        json_response(['success' => false, 'message' => 'Unable to prepare the signature upload folder.'], 500);
    }

    $storedFileName = 'signature_' . date('Ymd_His') . '_' . bin2hex(random_bytes(8)) . '.' . $extensions[$mime];
    $absolutePath = $uploadDirectory . DIRECTORY_SEPARATOR . $storedFileName;
    if (!move_uploaded_file($temporaryFile, $absolutePath)) {
        json_response(['success' => false, 'message' => 'Unable to save the signature image.'], 500);
    }

    $storedPath = 'uploads/certificate-signatures/' . rawurlencode($storedFileName);
    write_auth_audit($pdo, $user, 'rewards.certificate_signature_uploaded', 'A certificate signature image was uploaded.', [
        'path' => $storedPath,
    ]);

    json_response([
        'success' => true,
        'message' => 'Signature image uploaded.',
        'signatureImage' => $storedPath,
    ]);
}

function rewards_upload_certificate_design(PDO $pdo, array $user): void
{
    if (!rewards_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to upload certificate designs.'], 403);
    }

    $file = $_FILES['design'] ?? null;
    if (!is_array($file) || (int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response(['success' => false, 'message' => 'Choose a certificate design image to upload.'], 422);
    }

    $temporaryFile = (string)($file['tmp_name'] ?? '');
    $fileSize = (int)($file['size'] ?? 0);
    if ($temporaryFile === '' || !is_uploaded_file($temporaryFile) || $fileSize <= 0) {
        json_response(['success' => false, 'message' => 'The uploaded certificate design is invalid.'], 422);
    }

    if ($fileSize > 5 * 1024 * 1024) {
        json_response(['success' => false, 'message' => 'The certificate design must be 5 MB or smaller.'], 422);
    }

    $image = @getimagesize($temporaryFile);
    $mime = strtolower((string)($image['mime'] ?? ''));
    $extensions = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
    ];

    if (!isset($extensions[$mime])) {
        json_response(['success' => false, 'message' => 'Use a PNG, JPG, or WebP certificate design.'], 422);
    }

    if ((int)($image[0] ?? 0) < 600 || (int)($image[1] ?? 0) < 400 || (int)$image[0] > 8000 || (int)$image[1] > 8000) {
        json_response(['success' => false, 'message' => 'Use a design image between 600 × 400 and 8000 × 8000 pixels.'], 422);
    }

    $uploadDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'certificate-designs';
    if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true) && !is_dir($uploadDirectory)) {
        json_response(['success' => false, 'message' => 'Unable to prepare the certificate design folder.'], 500);
    }

    $storedFileName = 'design_' . date('Ymd_His') . '_' . bin2hex(random_bytes(8)) . '.' . $extensions[$mime];
    $absolutePath = $uploadDirectory . DIRECTORY_SEPARATOR . $storedFileName;
    if (!move_uploaded_file($temporaryFile, $absolutePath)) {
        json_response(['success' => false, 'message' => 'Unable to save the certificate design.'], 500);
    }

    $storedPath = 'uploads/certificate-designs/' . rawurlencode($storedFileName);
    write_auth_audit($pdo, $user, 'rewards.certificate_design_uploaded', 'A custom certificate design image was uploaded.', [
        'path' => $storedPath,
    ]);

    json_response([
        'success' => true,
        'message' => 'Certificate design uploaded.',
        'backgroundImage' => $storedPath,
    ]);
}

function rewards_save_certificate_template(PDO $pdo, array $user): void
{
    if (!rewards_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to edit certificate templates.'], 403);
    }

    $previousTemplate = rewards_certificate_template($pdo);
    $body = rewards_request_body();
    $template = rewards_normalize_certificate_template($body['template'] ?? null);
    $encoded = json_encode($template, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encoded === false) {
        json_response(['success' => false, 'message' => 'The certificate template could not be saved.'], 422);
    }

    store_application_setting($pdo, 'reward_certificate_template', $encoded);
    $previousSignature = rewards_text($previousTemplate['signatureImage'] ?? '');
    $nextSignature = rewards_text($template['signatureImage'] ?? '');
    if (
        $previousSignature !== ''
        && $previousSignature !== $nextSignature
        && !rewards_certificate_signature_is_referenced($pdo, $previousSignature)
    ) {
        rewards_remove_certificate_signature_file($previousSignature);
    }
    $previousDesign = rewards_text($previousTemplate['backgroundImage'] ?? '');
    $nextDesign = rewards_text($template['backgroundImage'] ?? '');
    if (
        $previousDesign !== ''
        && $previousDesign !== $nextDesign
        && !rewards_certificate_asset_is_referenced($pdo, 'backgroundImage', $previousDesign)
    ) {
        rewards_remove_certificate_design_file($previousDesign);
    }
    write_auth_audit($pdo, $user, 'rewards.certificate_template_updated', 'The award certificate template was updated.', [
        'preset' => $template['preset'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Certificate template saved.',
        'template' => $template,
    ]);
}

/** An assigned or already-issued certificate may still need a signature no longer used by the default. */
function rewards_certificate_signature_is_referenced(PDO $pdo, string $storedPath): bool
{
    return rewards_certificate_asset_is_referenced($pdo, 'signatureImage', $storedPath);
}

function rewards_certificate_asset_is_referenced(PDO $pdo, string $field, string $storedPath): bool
{
    if ($storedPath === '' || !in_array($field, ['signatureImage', 'backgroundImage'], true)) {
        return false;
    }

    $needle = '%"' . $field . '":"' . $storedPath . '"%';
    $statement = $pdo->prepare(
        'SELECT
            EXISTS(SELECT 1 FROM reward_cycles WHERE certificate_template LIKE :cycle_path)
            OR EXISTS(SELECT 1 FROM reward_certificates WHERE template_snapshot LIKE :certificate_path)'
    );
    $statement->execute([
        ':cycle_path' => $needle,
        ':certificate_path' => $needle,
    ]);

    return (int)$statement->fetchColumn() === 1;
}

/** Assign the exact editor design to one open nomination cycle. */
function rewards_assign_certificate_template(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    if (($cycle['status'] ?? 'ongoing') === 'closed') {
        json_response(['success' => false, 'message' => 'Reopen the nomination before changing its certificate.'], 409);
    }

    if ((int)($cycle['isArchived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'Restore the nomination before assigning a certificate.'], 409);
    }

    $template = rewards_normalize_certificate_template($body['template'] ?? null);
    $encoded = json_encode($template, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encoded === false) {
        json_response(['success' => false, 'message' => 'The certificate design could not be assigned.'], 422);
    }

    $statement = $pdo->prepare('UPDATE reward_cycles SET certificate_template = :template WHERE id = :id');
    $statement->execute([
        ':template' => $encoded,
        ':id' => $cycleId,
    ]);

    write_auth_audit($pdo, $user, 'rewards.certificate_template_assigned', 'A certificate design was assigned to a nomination cycle.', [
        'cycleId' => $cycleId,
        'category' => $cycle['category'] ?? null,
        'preset' => $template['preset'],
    ]);

    json_response([
        'success' => true,
        'message' => sprintf('This certificate will be issued to the winner of %s when nominations close.', $cycle['category'] ?? 'the nomination'),
        'cycleId' => (string)$cycleId,
        'preset' => $template['preset'],
    ]);
}

function rewards_nominations_by_cycle(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT
            n.id,
            n.cycle_id AS cycleId,
            n.voter_user_id AS voterUserId,
            n.voter_name AS voterName,
            (
                SELECT e.id
                FROM users u
                INNER JOIN employees e
                   ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
                  AND e.is_archived = 0
                WHERE u.id = n.voter_user_id
                ORDER BY e.id ASC
                LIMIT 1
            ) AS voterEmployeeRecordId,
            n.nominee_employee_id AS nomineeEmployeeId,
            n.nominee_name AS nomineeName,
            n.reason,
            n.created_at AS createdAt
         FROM reward_cycle_votes n
         ORDER BY n.created_at ASC, n.id ASC'
    );

    $grouped = [];
    foreach ($statement->fetchAll() as $row) {
        $grouped[(int)$row['cycleId']][] = [
            'id' => (string)$row['id'],
            // Strings on both sides so the client can compare against `viewerKey` without coercing.
            'voterKey' => (string)$row['voterUserId'],
            'voterName' => $row['voterName'] ?? '',
            // User ids and employee ids are separate namespaces. This explicit link prevents an
            // admin account from accidentally borrowing an unrelated employee's profile photo.
            'voterEmployeeKey' => (string)($row['voterEmployeeRecordId'] ?? ''),
            'nomineeKey' => (string)$row['nomineeEmployeeId'],
            'nomineeName' => $row['nomineeName'] ?? '',
            'reason' => $row['reason'] ?? '',
            'createdAt' => $row['createdAt'] ?? null,
        ];
    }

    return $grouped;
}

function rewards_format_cycle(array $row, array $nominations): array
{
    $assignedTemplate = json_decode((string)($row['certificateTemplate'] ?? ''), true);

    return [
        'id' => (string)$row['id'],
        'category' => $row['category'] ?? '',
        'description' => $row['description'] ?? '',
        'opensOn' => $row['opensOn'] ?? '',
        'closesOn' => $row['closesOn'] ?? '',
        'status' => ($row['status'] ?? 'ongoing') === 'closed' ? 'closed' : 'ongoing',
        'createdByName' => $row['createdByName'] ?? '',
        'createdAt' => $row['createdAt'] ?? null,
        'isArchived' => (int)($row['isArchived'] ?? 0) === 1,
        'hasCertificateTemplate' => is_array($assignedTemplate),
        'certificateTemplatePreset' => is_array($assignedTemplate)
            ? rewards_normalize_certificate_template($assignedTemplate)['preset']
            : '',
        'nominations' => $nominations,
    ];
}

function rewards_cycle_select(): string
{
    return 'SELECT
            c.id,
            c.category,
            c.description,
            c.opens_on AS opensOn,
            c.closes_on AS closesOn,
            c.reopened_at AS reopenedAt,
            c.certificate_template AS certificateTemplate,
            c.status,
            c.created_by_name AS createdByName,
            c.is_archived AS isArchived,
            c.created_at AS createdAt
        FROM reward_cycles c';
}

/**
 * One list, two views. Archived cycles are kept out of the working list entirely rather than shown
 * greyed out — an archived award is not one anybody should still be voting in.
 */
function rewards_list_cycles(PDO $pdo, array $user): void
{
    $archived = in_array(rewards_text($_GET['archived'] ?? ''), ['1', 'true', 'yes'], true);

    /*
     * Expired cycles are closed before the list is read, not after: deferring it would hand back a
     * list still calling a finished cycle "ongoing", with a ballot the reader could open and be
     * refused at. The query behind it is one indexed range scan that matches nothing on almost every
     * request. The closing reminder has no such constraint, so it stays deferred.
     */
    rewards_close_expired_cycles($pdo);
    defer(static fn () => rewards_send_due_closing_notices($pdo));

    $statement = $pdo->prepare(
        rewards_cycle_select() . ' WHERE c.is_archived = :is_archived ORDER BY c.created_at DESC, c.id DESC'
    );
    $statement->execute([':is_archived' => $archived ? 1 : 0]);
    $nominations = rewards_nominations_by_cycle($pdo);

    $cycles = array_map(
        static fn (array $row): array => rewards_format_cycle($row, $nominations[(int)$row['id']] ?? []),
        $statement->fetchAll()
    );
    $viewerEmployeeRecordId = session_employee_record_id($pdo, $user);

    json_response([
        'success' => true,
        'cycles' => $cycles,
        'archived' => $archived,
        // Lets the Archived button carry a count without the client fetching the other view first.
        'archivedCount' => (int)$pdo->query('SELECT COUNT(*) FROM reward_cycles WHERE is_archived = 1')->fetchColumn(),
        // The client compares this against each nomination's `voterKey` to find its own vote,
        // rather than guessing which id field on the session user is the right one.
        'viewerKey' => (string)($user['id'] ?? ''),
        // Nominee rows are keyed by employee record id, so the ballot needs this separately to keep
        // the signed-in employee out of their own nominee list.
        'viewerEmployeeRecordId' => $viewerEmployeeRecordId !== null ? (string)$viewerEmployeeRecordId : '',
        'canManage' => rewards_can_manage($user),
    ]);
}

function rewards_require_cycle(PDO $pdo, int $cycleId): array
{
    if ($cycleId <= 0) {
        json_response(['success' => false, 'message' => 'Nomination is required.'], 422);
    }

    $statement = $pdo->prepare(rewards_cycle_select() . ' WHERE c.id = :id LIMIT 1');
    $statement->execute([':id' => $cycleId]);
    $row = $statement->fetch();

    if (!$row) {
        json_response(['success' => false, 'message' => 'Nomination not found.'], 404);
    }

    return $row;
}

function rewards_require_manager(array $user): void
{
    if (!rewards_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to manage nominations.'], 403);
    }
}

function rewards_create_cycle(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $category = rewards_text($body['category'] ?? '');
    $description = rewards_text($body['description'] ?? '');
    $opensOn = rewards_datetime_or_null($body['opensOn'] ?? $body['opens_on'] ?? null);
    $closesOn = rewards_datetime_or_null($body['closesOn'] ?? $body['closes_on'] ?? null, true);

    if ($category === '') {
        json_response(['success' => false, 'message' => 'Award category is required.'], 422);
    }

    if ($opensOn === null || $closesOn === null) {
        json_response(['success' => false, 'message' => 'Set when nominations open and close before saving.'], 422);
    }

    if ($closesOn <= $opensOn) {
        json_response(['success' => false, 'message' => 'Nominations must close after they open.'], 422);
    }

    $statement = $pdo->prepare(
        'INSERT INTO reward_cycles
            (category, description, opens_on, closes_on, status, created_by_user_id, created_by_name)
         VALUES
            (:category, :description, :opens_on, :closes_on, :status, :created_by_user_id, :created_by_name)'
    );
    $statement->execute([
        ':category' => $category,
        ':description' => $description !== '' ? $description : null,
        ':opens_on' => $opensOn,
        ':closes_on' => $closesOn,
        ':status' => 'ongoing',
        ':created_by_user_id' => (int)($user['id'] ?? 0) ?: null,
        ':created_by_name' => full_name_from_row($user) ?: rewards_text($user['username'] ?? ''),
    ]);

    $cycleId = (int)$pdo->lastInsertId();

    write_auth_audit($pdo, $user, 'rewards.cycle_created', 'A nomination was created.', [
        'cycleId' => $cycleId,
        'category' => $category,
    ]);

    /*
     * Everyone votes, so everyone is told. Deferred because this writes one row per account and the
     * manager who pressed Create should not wait on the estate's worth of inserts.
     */
    defer(static function () use ($pdo, $cycleId, $category, $closesOn): void {
        rewards_notify_everyone(
            $pdo,
            'Nominations are open: ' . $category,
            sprintf(
                'Voting for %s has started and runs until %s. Cast your nominations under Rewards & Recognition.',
                $category,
                rewards_period_label($closesOn)
            ),
            'award_cycle_opened',
            (string)$cycleId
        );
    });

    json_response(['success' => true, 'message' => 'Nomination created.', 'cycleId' => (string)$cycleId], 201);
}

function rewards_update_cycle(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    $existing = rewards_require_cycle($pdo, $cycleId);

    $category = rewards_text($body['category'] ?? '');
    $description = rewards_text($body['description'] ?? '');
    $opensOn = rewards_datetime_or_null($body['opensOn'] ?? $body['opens_on'] ?? null);
    $closesOn = rewards_datetime_or_null($body['closesOn'] ?? $body['closes_on'] ?? null, true);

    if ($category === '') {
        json_response(['success' => false, 'message' => 'Award category is required.'], 422);
    }

    if ($opensOn === null || $closesOn === null) {
        json_response(['success' => false, 'message' => 'Set when nominations open and close before saving.'], 422);
    }

    if ($closesOn <= $opensOn) {
        json_response(['success' => false, 'message' => 'Nominations must close after they open.'], 422);
    }

    /*
     * Setting a new closing time is a fresh deadline in every sense, so both stamps that track the
     * old one are dropped: the reminder can warn about the new date, and the sweep will close on it
     * even for a cycle that was reopened past the previous one. Compared here rather than in the
     * UPDATE, where `closes_on` would already hold the value being written.
     */
    $rescheduled = rewards_text($existing['closesOn'] ?? '') !== $closesOn;
    $clearDeadlineStamps = $rescheduled ? ', closing_notice_sent_at = NULL, reopened_at = NULL' : '';

    $statement = $pdo->prepare(
        'UPDATE reward_cycles
         SET category = :category,
             description = :description,
             opens_on = :opens_on,
             closes_on = :closes_on' . $clearDeadlineStamps . '
         WHERE id = :id'
    );
    $statement->execute([
        ':category' => $category,
        ':description' => $description !== '' ? $description : null,
        ':opens_on' => $opensOn,
        ':closes_on' => $closesOn,
        ':id' => $cycleId,
    ]);

    json_response(['success' => true, 'message' => 'Nomination updated.']);
}

/**
 * The nominees sharing the top vote count, but only when more than one does.
 *
 * A cycle closed on a tie has no Best Employee to name — the podium would have to pick one of them
 * arbitrarily and the result would be a lie. So a tie blocks the close until a vote breaks it.
 */
function rewards_leading_tie(PDO $pdo, int $cycleId): array
{
    /*
     * Grouped on the nominee's id alone. Every vote snapshots the name it was cast under, so one
     * employee can hold two spellings in the same ballot — a middle initial added to the directory
     * between two votes is enough. Grouping on the name as well split those into separate rows,
     * halving the nominee's count and inventing a tie that blocked the close.
     *
     * The name is only a label here; `MAX()` picks one of the spellings deterministically.
     */
    $statement = $pdo->prepare(
        'SELECT MAX(nominee_name) AS name, COUNT(*) AS votes
         FROM reward_cycle_votes
         WHERE cycle_id = :cycle_id
         GROUP BY nominee_employee_id
         ORDER BY votes DESC'
    );
    $statement->execute([':cycle_id' => $cycleId]);
    $rows = $statement->fetchAll();

    if (count($rows) < 2) {
        return [];
    }

    $topVotes = (int)$rows[0]['votes'];
    $tied = array_values(array_filter($rows, static fn (array $row): bool => (int)$row['votes'] === $topVotes));

    return count($tied) > 1 ? $tied : [];
}

/**
 * The nominee to certify: most votes, and — because a tie blocks the close — the only one at the top.
 *
 * The tiebreakers after `votes` are there so the query is deterministic rather than correct: they can
 * only be reached by a race between a vote and a close, and the earliest nomination winning matches
 * what the leaderboard showed the person who clicked.
 */
function rewards_cycle_winner(PDO $pdo, int $cycleId): ?array
{
    // Grouped on the id alone, for the reason spelled out in `rewards_leading_tie()`: the same
    // nominee can be stored under two spellings, and grouping on the name too would split their votes.
    // `nomineeName` is a fallback anyway — the certificate re-reads the name from the directory.
    $statement = $pdo->prepare(
        'SELECT
            v.nominee_employee_id AS employeeRecordId,
            MAX(v.nominee_name) AS nomineeName,
            COUNT(*) AS votes
         FROM reward_cycle_votes v
         WHERE v.cycle_id = :cycle_id
         GROUP BY v.nominee_employee_id
         ORDER BY votes DESC, MIN(v.created_at) ASC, v.nominee_employee_id ASC
         LIMIT 1'
    );
    $statement->execute([':cycle_id' => $cycleId]);

    return $statement->fetch() ?: null;
}

function rewards_employee_snapshot(PDO $pdo, int $employeeRecordId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id,
            e.first_name,
            e.middle_name,
            e.last_name,
            d.name AS division_name,
            des.name AS designation_title
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeRecordId]);

    return $statement->fetch() ?: null;
}

/**
 * Who signs the certificate.
 *
 * The Regional Director signs awards, so the name is read from whoever holds that role rather than
 * from the HR account that happened to click Close. `users` carries no name of its own, hence the
 * join back to `employees` on email — the same link `user_id_for_employee_record` uses.
 *
 * The title under the line is the office, not the signer's designation: a certificate is signed in
 * the Regional Director's capacity, and printing the personnel designation instead would read as the
 * wrong person having signed it.
 */
function rewards_signatory(PDO $pdo): array
{
    $signatory = ['name' => '', 'title' => 'OIC Regional Executive Director'];

    $statement = $pdo->query(
        'SELECT
            e.first_name,
            e.middle_name,
            e.last_name
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         WHERE u.is_archived = 0
           AND LOWER(REPLACE(r.name, " ", "")) = "regionaldirector"
         ORDER BY u.id ASC
         LIMIT 1'
    );
    $row = $statement->fetch();

    if ($row) {
        $signatory['name'] = full_name_from_row($row);
    }

    return $signatory;
}

/**
 * One certificate per year, numbered in order of issue.
 *
 * The upsert is what makes the number safe under two managers closing cycles at once: it takes a row
 * lock on the year, so the read that follows cannot see the same value twice.
 */
function rewards_next_certificate_number(PDO $pdo, int $year): string
{
    $bump = $pdo->prepare(
        'INSERT INTO reward_certificate_sequence (award_year, last_number)
         VALUES (:year, 1)
         ON DUPLICATE KEY UPDATE last_number = last_number + 1'
    );
    $bump->execute([':year' => $year]);

    $read = $pdo->prepare('SELECT last_number FROM reward_certificate_sequence WHERE award_year = :year');
    $read->execute([':year' => $year]);

    return sprintf('MGB-X-%d-%04d', $year, (int)$read->fetchColumn());
}

/**
 * Closing a cycle is the moment the result becomes real, so the certificate is minted here rather
 * than waiting for somebody to press a second button — and the awardee is told the same moment.
 *
 * Returns null when there is nothing to certify (no votes were cast). Re-closing a cycle that still
 * has its certificate is a no-op; re-closing after a reopen changed the winner re-points the existing
 * row so the number stays with the cycle.
 */
function rewards_issue_certificate(PDO $pdo, array $user, array $cycle): ?array
{
    $cycleId = (int)($cycle['id'] ?? 0);
    $winner = rewards_cycle_winner($pdo, $cycleId);

    if ($winner === null) {
        return null;
    }

    $employeeRecordId = (int)$winner['employeeRecordId'];
    $employee = rewards_employee_snapshot($pdo, $employeeRecordId);
    $employeeName = $employee ? full_name_from_row($employee) : rewards_text($winner['nomineeName']);
    $awardTitle = rewards_text($cycle['category'] ?? '') ?: 'Award';
    $votes = (int)$winner['votes'];

    $lookup = $pdo->prepare(
        'SELECT id, certificate_number, employee_record_id
         FROM reward_certificates
         WHERE cycle_id = :cycle_id
         LIMIT 1'
    );
    $lookup->execute([':cycle_id' => $cycleId]);
    $existing = $lookup->fetch();

    $result = [
        'certificateNumber' => (string)($existing['certificate_number'] ?? ''),
        'employeeName' => $employeeName,
        'awardTitle' => $awardTitle,
        'votes' => $votes,
        'isNew' => false,
    ];

    // Already issued to this winner: the tally may have moved, but the award has not.
    if ($existing && (int)$existing['employee_record_id'] === $employeeRecordId) {
        return $result;
    }

    $number = (string)($existing['certificate_number'] ?? '') ?: rewards_next_certificate_number($pdo, (int)date('Y'));
    $signatory = rewards_signatory($pdo);
    $assignedTemplate = json_decode((string)($cycle['certificateTemplate'] ?? ''), true);
    $certificateTemplate = is_array($assignedTemplate)
        ? rewards_normalize_certificate_template($assignedTemplate)
        : rewards_certificate_template($pdo);
    $templateSnapshot = json_encode($certificateTemplate, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    $statement = $pdo->prepare(
        'INSERT INTO reward_certificates
            (cycle_id, employee_record_id, certificate_number, award_title, employee_name, employee_code,
             division_name, designation_title, votes, period_start, period_end, awarded_on,
             signatory_name, signatory_title, template_snapshot, issued_by_user_id, issued_by_name)
         VALUES
            (:cycle_id, :employee_record_id, :certificate_number, :award_title, :employee_name, :employee_code,
             :division_name, :designation_title, :votes, :period_start, :period_end, :awarded_on,
             :signatory_name, :signatory_title, :template_snapshot, :issued_by_user_id, :issued_by_name)
         ON DUPLICATE KEY UPDATE
            employee_record_id = VALUES(employee_record_id),
            award_title = VALUES(award_title),
            employee_name = VALUES(employee_name),
            employee_code = VALUES(employee_code),
            division_name = VALUES(division_name),
            designation_title = VALUES(designation_title),
            votes = VALUES(votes),
            period_start = VALUES(period_start),
            period_end = VALUES(period_end),
            awarded_on = VALUES(awarded_on),
            signatory_name = VALUES(signatory_name),
            signatory_title = VALUES(signatory_title),
            template_snapshot = VALUES(template_snapshot),
            issued_by_user_id = VALUES(issued_by_user_id),
            issued_by_name = VALUES(issued_by_name)'
    );
    $statement->execute([
        ':cycle_id' => $cycleId,
        ':employee_record_id' => $employeeRecordId,
        ':certificate_number' => $number,
        ':award_title' => $awardTitle,
        ':employee_name' => $employeeName,
        ':employee_code' => rewards_text($employee['employee_id'] ?? '') ?: null,
        ':division_name' => rewards_text($employee['division_name'] ?? '') ?: null,
        ':designation_title' => rewards_text($employee['designation_title'] ?? '') ?: null,
        ':votes' => $votes,
        ':period_start' => rewards_date_or_null($cycle['opensOn'] ?? null),
        ':period_end' => rewards_date_or_null($cycle['closesOn'] ?? null),
        ':awarded_on' => date('Y-m-d'),
        ':signatory_name' => $signatory['name'] !== '' ? $signatory['name'] : null,
        ':signatory_title' => $signatory['title'],
        ':template_snapshot' => $templateSnapshot !== false ? $templateSnapshot : null,
        ':issued_by_user_id' => (int)($user['id'] ?? 0) ?: null,
        ':issued_by_name' => full_name_from_row($user) ?: rewards_text($user['username'] ?? ''),
    ]);

    notify_employee(
        $pdo,
        $employeeRecordId,
        'You have been awarded ' . $awardTitle,
        sprintf(
            'Voting for %s is closed and you were chosen with %d %s. Certificate %s is ready to view and download under Rewards & Recognition, My Awards.',
            $awardTitle,
            $votes,
            $votes === 1 ? 'vote' : 'votes',
            $number
        ),
        'award_received',
        $number
    );

    write_auth_audit($pdo, $user, 'rewards.certificate_issued', 'An award certificate was issued.', [
        'cycleId' => $cycleId,
        'certificateNumber' => $number,
        'employeeRecordId' => $employeeRecordId,
        'employeeName' => $employeeName,
        'votes' => $votes,
    ]);

    return ['certificateNumber' => $number, 'employeeName' => $employeeName, 'awardTitle' => $awardTitle, 'votes' => $votes, 'isNew' => true];
}

/**
 * Reopening voting un-decides the result, so the certificate goes with it. Leaving it in place would
 * hand somebody a printable award for a cycle that can still turn against them.
 */
function rewards_revoke_certificate(PDO $pdo, array $user, int $cycleId): void
{
    $lookup = $pdo->prepare('SELECT certificate_number, employee_name FROM reward_certificates WHERE cycle_id = :cycle_id LIMIT 1');
    $lookup->execute([':cycle_id' => $cycleId]);
    $existing = $lookup->fetch();

    if (!$existing) {
        return;
    }

    $statement = $pdo->prepare('DELETE FROM reward_certificates WHERE cycle_id = :cycle_id');
    $statement->execute([':cycle_id' => $cycleId]);

    write_auth_audit($pdo, $user, 'rewards.certificate_revoked', 'An award certificate was revoked when voting reopened.', [
        'cycleId' => $cycleId,
        'certificateNumber' => $existing['certificate_number'] ?? null,
        'employeeName' => $existing['employee_name'] ?? null,
    ]);
}

function rewards_format_certificate(array $row): array
{
    $template = json_decode((string)($row['certificateTemplate'] ?? ''), true);

    return [
        'id' => (string)$row['id'],
        'cycleId' => (string)$row['cycleId'],
        'certificateNumber' => (string)($row['certificateNumber'] ?? ''),
        'awardTitle' => $row['awardTitle'] ?? '',
        'employeeName' => $row['employeeName'] ?? '',
        'employeeCode' => $row['employeeCode'] ?? '',
        'divisionName' => $row['divisionName'] ?? '',
        'designationTitle' => $row['designationTitle'] ?? '',
        'votes' => (int)($row['votes'] ?? 0),
        // Named to match the cycle shape so the client's `formatPeriod` works on either.
        'opensOn' => (string)($row['periodStart'] ?? ''),
        'closesOn' => (string)($row['periodEnd'] ?? ''),
        'awardedOn' => (string)($row['awardedOn'] ?? ''),
        'signatoryName' => $row['signatoryName'] ?? '',
        'signatoryTitle' => $row['signatoryTitle'] ?? '',
        'issuedByName' => $row['issuedByName'] ?? '',
        'issuedAt' => $row['issuedAt'] ?? null,
        'template' => is_array($template) ? rewards_normalize_certificate_template($template) : null,
    ];
}

/**
 * "My Awards": the certificates belonging to the signed-in user, and nobody else's.
 *
 * Scoped by the employee record behind the session rather than by a client-supplied id, so there is
 * no parameter to tamper with. An account with no employee record answers with an empty list and
 * says why, which is the difference between "you have no awards" and "we cannot tell who you are".
 */
function rewards_list_certificates(PDO $pdo, array $user): void
{
    $employee = find_employee_for_user($pdo, $user);
    $employeeRecordId = (int)($employee['linked_employee_record_id'] ?? 0);

    if ($employeeRecordId <= 0) {
        json_response([
            'success' => true,
            'certificates' => [],
            'linked' => false,
        ]);
    }

    $statement = $pdo->prepare(
        'SELECT
            c.id,
            c.cycle_id AS cycleId,
            c.certificate_number AS certificateNumber,
            c.award_title AS awardTitle,
            c.employee_name AS employeeName,
            c.employee_code AS employeeCode,
            c.division_name AS divisionName,
            c.designation_title AS designationTitle,
            c.votes,
            c.period_start AS periodStart,
            c.period_end AS periodEnd,
            c.awarded_on AS awardedOn,
            c.signatory_name AS signatoryName,
            c.signatory_title AS signatoryTitle,
            c.template_snapshot AS certificateTemplate,
            c.issued_by_name AS issuedByName,
            c.created_at AS issuedAt
         FROM reward_certificates c
         WHERE c.employee_record_id = :employee_record_id
         ORDER BY c.awarded_on DESC, c.id DESC'
    );
    $statement->execute([':employee_record_id' => $employeeRecordId]);

    json_response([
        'success' => true,
        'certificates' => array_map('rewards_format_certificate', $statement->fetchAll()),
        'linked' => true,
    ]);
}

/**
 * Voting stops when the period ends, whether or not anybody presses Close voting.
 *
 * The automatic twin of `rewards_set_status()`, and it follows the same rules: the status flips, the
 * winner's certificate is minted, and the winner is told. Like the closing reminder it rides on the
 * request that lists the cycles rather than on a scheduler, and claims each cycle with a conditional
 * UPDATE so two requests arriving together cannot both close it.
 *
 * A tie is the one place the two paths differ. The manual close refuses and waits for a vote to break
 * it; a deadline cannot wait, so voting shuts with no certificate issued and the managers are told
 * there is a tie to resolve. Reopening the cycle is what lets a further vote settle it — the same
 * button, doing what it already did.
 */
function rewards_close_expired_cycles(PDO $pdo): void
{
    $due = $pdo->query(
        rewards_cycle_select()
        . ' WHERE c.is_archived = 0
              AND c.status <> "closed"
              AND c.closes_on IS NOT NULL
              AND c.closes_on <= NOW()
              AND (c.reopened_at IS NULL OR c.reopened_at <= c.closes_on)'
    )->fetchAll();

    if ($due === []) {
        return;
    }

    // No signed-in manager acts here, and attributing the award to whoever happened to load the page
    // would put a stranger's name on the certificate.
    $system = ['username' => 'System'];
    $claim = $pdo->prepare('UPDATE reward_cycles SET status = "closed" WHERE id = :id AND status <> "closed"');

    foreach ($due as $cycle) {
        $cycleId = (int)$cycle['id'];
        $claim->execute([':id' => $cycleId]);

        if ($claim->rowCount() === 0) {
            continue;
        }

        write_auth_audit($pdo, $system, 'rewards.cycle_auto_closed', 'Voting closed automatically at the end of the nomination period.', [
            'cycleId' => $cycleId,
            'category' => $cycle['category'] ?? null,
            'closesOn' => $cycle['closesOn'] ?? null,
        ]);

        $tied = rewards_leading_tie($pdo, $cycleId);

        if ($tied !== []) {
            notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Tied result: ' . ($cycle['category'] ?? 'award nomination'),
                sprintf(
                    'Voting for %s closed on %s with %s tied at %d %s, so no certificate was issued. Reopen voting to break the tie.',
                    $cycle['category'] ?? 'this nomination',
                    rewards_period_label($cycle['closesOn'] ?? null),
                    implode(', ', array_column($tied, 'name')),
                    (int)$tied[0]['votes'],
                    (int)$tied[0]['votes'] === 1 ? 'vote' : 'votes'
                ),
                'award_cycle_tied',
                (string)$cycleId
            );

            continue;
        }

        rewards_issue_certificate($pdo, $system, $cycle);
    }
}

function rewards_set_status(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    $status = rewards_text($body['status'] ?? '') === 'closed' ? 'closed' : 'ongoing';

    if ($status === 'closed') {
        $tied = rewards_leading_tie($pdo, $cycleId);

        if ($tied !== []) {
            $names = array_column($tied, 'name');
            $votes = (int)$tied[0]['votes'];
            $last = array_pop($names);
            $joined = $names === [] ? $last : implode(', ', $names) . ' and ' . $last;

            json_response([
                'success' => false,
                'message' => sprintf(
                    'Voting is tied — %s each have %d %s. One nominee must be ahead before voting can close.',
                    $joined,
                    $votes,
                    $votes === 1 ? 'vote' : 'votes'
                ),
                'tiedNominees' => array_column($tied, 'name'),
            ], 409);
        }
    }

    // Reopening stamps the moment so the deadline sweep leaves the cycle alone: a manager reopening a
    // cycle that has already run out is overriding its closing time, not asking to race it.
    $statement = $pdo->prepare(
        'UPDATE reward_cycles
         SET status = :status,
             reopened_at = IF(:is_reopening, NOW(), reopened_at)
         WHERE id = :id'
    );
    $statement->execute([
        ':status' => $status,
        ':is_reopening' => $status === 'closed' ? 0 : 1,
        ':id' => $cycleId,
    ]);

    write_auth_audit($pdo, $user, 'rewards.cycle_status_changed', 'A nomination status was changed.', [
        'cycleId' => $cycleId,
        'status' => $status,
    ]);

    // Revealing the result and awarding it are the same act, so the certificate is minted (or pulled
    // back, when the result is un-decided) inside the same request that flips the status.
    $certificate = null;

    if ($status === 'closed') {
        $certificate = rewards_issue_certificate($pdo, $user, $cycle);
    } else {
        rewards_revoke_certificate($pdo, $user, $cycleId);
    }

    if ($status !== 'closed') {
        $message = 'Voting has been reopened.';
    } elseif ($certificate === null) {
        $message = 'Voting is now closed. Nobody was nominated, so no certificate was issued.';
    } elseif ($certificate['isNew']) {
        $message = sprintf(
            'Voting is now closed. Certificate %s was issued to %s and they have been notified.',
            $certificate['certificateNumber'],
            $certificate['employeeName']
        );
    } else {
        $message = sprintf('Voting is now closed. %s already holds certificate %s.', $certificate['employeeName'], $certificate['certificateNumber']);
    }

    json_response([
        'success' => true,
        'message' => $message,
        'certificate' => $certificate,
    ]);
}

/**
 * Archiving is the reversible retirement the list offers in place of deleting: the cycle and every
 * vote filed under it stay on the record, they just leave the working list. `rewards_delete_cycle`
 * still exists for a permanent removal, but nothing in the UI routes to it any more.
 */
function rewards_set_archived(PDO $pdo, array $user, bool $archived): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? $_GET['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    if ((int)($cycle['isArchived'] ?? 0) === ($archived ? 1 : 0)) {
        json_response([
            'success' => false,
            'message' => $archived ? 'That nomination is already archived.' : 'That nomination is not archived.',
        ], 409);
    }

    $statement = $pdo->prepare('UPDATE reward_cycles SET is_archived = :is_archived WHERE id = :id');
    $statement->execute([':is_archived' => $archived ? 1 : 0, ':id' => $cycleId]);

    write_auth_audit(
        $pdo,
        $user,
        $archived ? 'rewards.cycle_archived' : 'rewards.cycle_restored',
        $archived ? 'A nomination was archived.' : 'A nomination was restored from the archive.',
        [
            'cycleId' => $cycleId,
            'category' => $cycle['category'] ?? null,
        ]
    );

    json_response([
        'success' => true,
        'message' => $archived ? 'Nomination archived.' : 'Nomination restored.',
    ]);
}

function rewards_delete_cycle(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? $_GET['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    // Nominations go with it through ON DELETE CASCADE.
    $statement = $pdo->prepare('DELETE FROM reward_cycles WHERE id = :id');
    $statement->execute([':id' => $cycleId]);

    write_auth_audit($pdo, $user, 'rewards.cycle_deleted', 'A nomination was deleted.', [
        'cycleId' => $cycleId,
        'category' => $cycle['category'] ?? null,
    ]);

    json_response(['success' => true, 'message' => 'Nomination deleted.']);
}

function rewards_cast_vote(PDO $pdo, array $user): void
{
    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    // Archived cycles are off the list, but a stale tab could still post to one.
    if ((int)($cycle['isArchived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'That nomination has been archived.'], 409);
    }

    if (($cycle['status'] ?? 'ongoing') === 'closed') {
        json_response(['success' => false, 'message' => 'Nominations are closed for this award.'], 409);
    }

    /*
     * The status flip happens on the next request that lists the cycles, so between the deadline and
     * that sweep a cycle is still marked ongoing. Checked here too, or a tab left open on the ballot
     * could file a vote after the period it belongs to had ended.
     */
    if (rewards_voting_has_ended($cycle)) {
        json_response([
            'success' => false,
            'message' => 'Voting closed on ' . rewards_period_label($cycle['closesOn'] ?? null) . '.',
        ], 409);
    }

    $voterUserId = (int)($user['id'] ?? 0);
    if ($voterUserId <= 0) {
        json_response(['success' => false, 'message' => 'Your account could not be identified.'], 403);
    }

    /*
     * The ballot posts the voter's whole selection as `nomineeKeys`; `nomineeKey` is still read so a
     * client left on the old single-pick form keeps working. Duplicates are folded here rather than
     * left to the unique key, so "3 picks" in the response means three distinct people.
     */
    $rawKeys = $body['nomineeKeys'] ?? $body['nominee_employee_ids'] ?? $body['nomineeKey'] ?? $body['nominee_employee_id'] ?? [];
    $nomineeIds = array_values(array_unique(array_filter(
        array_map(static fn (mixed $key): int => (int)$key, is_array($rawKeys) ? $rawKeys : [$rawKeys]),
        static fn (int $id): bool => $id > 0,
    )));

    if (count($nomineeIds) === 0) {
        json_response(['success' => false, 'message' => 'Pick who you are nominating.'], 422);
    }

    $voterEmployeeRecordId = session_employee_record_id($pdo, $user);
    if ($voterEmployeeRecordId !== null && in_array($voterEmployeeRecordId, $nomineeIds, true)) {
        json_response(['success' => false, 'message' => 'You cannot nominate yourself.'], 422);
    }

    $placeholders = implode(',', array_fill(0, count($nomineeIds), '?'));
    $employee = $pdo->prepare(
        "SELECT id, first_name, middle_name, last_name FROM employees WHERE id IN ($placeholders)"
    );
    $employee->execute($nomineeIds);
    $nominees = [];
    foreach ($employee->fetchAll() as $row) {
        $nominees[(int)$row['id']] = full_name_from_row($row);
    }

    // Partial matches are rejected outright: silently dropping a name would record a ballot the
    // voter never chose, and they would have no way to tell from the confirmation.
    if (count($nominees) !== count($nomineeIds)) {
        json_response(['success' => false, 'message' => 'One of those employees is no longer in the directory.'], 422);
    }

    $reason = rewards_text($body['reason'] ?? '');
    $voterName = full_name_from_row($user) ?: rewards_text($user['username'] ?? '');

    /*
     * The submitted set replaces the voter's ballot for this cycle: upsert every pick, then drop the
     * rows for anyone they unticked. Upserting rather than deleting-and-reinserting keeps `created_at`
     * on picks that survived the edit, which is what orders the ballot feed and breaks a tie on close.
     *
     * One transaction, so a failure part-way cannot leave a voter with half of each ballot.
     */
    $pdo->beginTransaction();

    try {
        $insert = $pdo->prepare(
            'INSERT INTO reward_cycle_votes
                (cycle_id, voter_user_id, voter_name, nominee_employee_id, nominee_name, reason)
             VALUES
                (:cycle_id, :voter_user_id, :voter_name, :nominee_employee_id, :nominee_name, :reason)
             ON DUPLICATE KEY UPDATE
                voter_name = VALUES(voter_name),
                nominee_name = VALUES(nominee_name),
                reason = VALUES(reason)'
        );

        foreach ($nomineeIds as $nomineeId) {
            $insert->execute([
                ':cycle_id' => $cycleId,
                ':voter_user_id' => $voterUserId,
                ':voter_name' => $voterName,
                ':nominee_employee_id' => $nomineeId,
                ':nominee_name' => $nominees[$nomineeId],
                ':reason' => $reason !== '' ? $reason : null,
            ]);
        }

        $prune = $pdo->prepare(
            "DELETE FROM reward_cycle_votes
             WHERE cycle_id = ? AND voter_user_id = ? AND nominee_employee_id NOT IN ($placeholders)"
        );
        $prune->execute([$cycleId, $voterUserId, ...$nomineeIds]);

        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }

    json_response([
        'success' => true,
        'message' => count($nomineeIds) === 1
            ? 'Your vote has been recorded.'
            : sprintf('Your %d nominations have been recorded.', count($nomineeIds)),
    ]);
}

function rewards_withdraw_vote(PDO $pdo, array $user): void
{
    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? $_GET['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    if (($cycle['status'] ?? 'ongoing') === 'closed') {
        json_response(['success' => false, 'message' => 'Nominations are closed for this award.'], 409);
    }

    // Same deadline guard as casting: a ballot cannot be pulled out of a period that has ended either.
    if (rewards_voting_has_ended($cycle)) {
        json_response([
            'success' => false,
            'message' => 'Voting closed on ' . rewards_period_label($cycle['closesOn'] ?? null) . '.',
        ], 409);
    }

    // Withdrawing clears the voter's whole ballot for the cycle, however many people they nominated.
    $statement = $pdo->prepare('DELETE FROM reward_cycle_votes WHERE cycle_id = :cycle_id AND voter_user_id = :voter_user_id');
    $statement->execute([
        ':cycle_id' => $cycleId,
        ':voter_user_id' => (int)($user['id'] ?? 0),
    ]);

    json_response([
        'success' => true,
        'message' => $statement->rowCount() === 1
            ? 'Your vote has been withdrawn.'
            : 'Your nominations have been withdrawn.',
    ]);
}

try {
    ensure_rewards_tables($pdo);

    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $action = rewards_text($_GET['action'] ?? $_POST['action'] ?? 'list');

    if ($method === 'GET' && $action === 'list') {
        rewards_list_cycles($pdo, $sessionUser);
    }

    if ($method === 'GET' && $action === 'certificates') {
        rewards_list_certificates($pdo, $sessionUser);
    }

    if ($method === 'GET' && $action === 'certificate-template') {
        rewards_get_certificate_template($pdo);
    }

    if ($method === 'POST' && $action === 'create') {
        rewards_create_cycle($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'vote') {
        rewards_cast_vote($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'certificate-signature') {
        rewards_upload_certificate_signature($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'certificate-design-image') {
        rewards_upload_certificate_design($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'update') {
        rewards_update_cycle($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'status') {
        rewards_set_status($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'archive') {
        rewards_set_archived($pdo, $sessionUser, true);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'restore') {
        rewards_set_archived($pdo, $sessionUser, false);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'certificate-template') {
        rewards_save_certificate_template($pdo, $sessionUser);
    }

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'assign-certificate-template') {
        rewards_assign_certificate_template($pdo, $sessionUser);
    }

    if ($method === 'DELETE' && $action === 'delete') {
        rewards_delete_cycle($pdo, $sessionUser);
    }

    if ($method === 'DELETE' && $action === 'withdraw') {
        rewards_withdraw_vote($pdo, $sessionUser);
    }

    json_response(['success' => false, 'message' => 'Unsupported rewards action.'], 405);
} catch (Throwable $exception) {
    error_log('Rewards API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process rewards request.',
    ], 500);
}
