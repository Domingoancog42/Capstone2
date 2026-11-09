<?php
declare(strict_types=1);

/*
 * Pass slip QR support: schema, tokens, and the scan state machine.
 *
 * A pass slip is now a QR credential rather than a paper form someone writes times on. The record
 * carries a secret token, the token is printed as a QR code, and the two times that used to be typed
 * -- Time Out and Time Returned -- are stamped by scanning that code at the gate. Everything in this
 * file exists to make those scans safe: one token per slip, a status that only moves forward, and a
 * row in `pass_slip_scans` for every attempt including the refused ones.
 *
 * It lives beside pass_slip.php rather than inside it because the scan endpoint, the list endpoint
 * and the schema migration all need the same status vocabulary, and a second reader (reports, or a
 * future kiosk endpoint) should not have to pull in the whole HTTP router to get it.
 */

require_once __DIR__ . '/connection-pdo.php';

/*
 * The life of a slip. It only ever moves forward, and each arrow is guarded by exactly one caller:
 *
 *   ACTIVE --scan--> OUT --scan--> COMPLETED
 *      |              |
 *      +--cancel--> CANCELLED
 *
 * There is no approval step. A slip is live the moment it is filed, which is why it starts in
 * ACTIVE rather than waiting for somebody: the status on a pass slip answers "is this person in the
 * building", not "has this been signed off". The only status a human writes is CANCELLED.
 *
 * The QR code works only in ACTIVE (it stamps Time Out) and OUT (it stamps Time Returned). Both of
 * the other states refuse the scan, which is what makes a completed or cancelled slip's code dead.
 */
const PASS_SLIP_STATUS_ACTIVE = 'ACTIVE';
const PASS_SLIP_STATUS_OUT = 'OUT';
const PASS_SLIP_STATUS_COMPLETED = 'COMPLETED';
const PASS_SLIP_STATUS_CANCELLED = 'CANCELLED';

const PASS_SLIP_STATUSES = [
    PASS_SLIP_STATUS_ACTIVE,
    PASS_SLIP_STATUS_OUT,
    PASS_SLIP_STATUS_COMPLETED,
    PASS_SLIP_STATUS_CANCELLED,
];

/** The two states whose QR code a scanner will act on. Mirrors PASS_SLIP_SCANNABLE in passSlipStatus.js. */
const PASS_SLIP_SCANNABLE_STATUSES = [PASS_SLIP_STATUS_ACTIVE, PASS_SLIP_STATUS_OUT];

/* What a scan did, as stored in `pass_slip_scans.scan_type`. */
const PASS_SLIP_SCAN_TIME_OUT = 'TIME_OUT';
const PASS_SLIP_SCAN_TIME_IN = 'TIME_IN';
const PASS_SLIP_SCAN_DENIED = 'DENIED';

/*
 * How long a pass slip is expected to cover. It is for stepping out, not for a stretch of the day:
 * under an hour is not filed at all, over three hours is a leave request. These now bound the
 * *expected* duration chosen on the form -- the actual duration comes off the two scans and is
 * recorded whatever it turns out to be, with anything past the expectation flagged as overdue.
 */
const PASS_SLIP_MIN_MINUTES = 60;
const PASS_SLIP_MAX_MINUTES = 180;

/** The QR payload prefix. `MGBX-PS:<32 hex>` -- short enough to keep the printed modules large. */
const PASS_SLIP_QR_PREFIX = 'MGBX-PS:';

function pass_slip_normalize_status(mixed $value): string
{
    $status = strtoupper(trim((string)($value ?? '')));

    return in_array($status, PASS_SLIP_STATUSES, true) ? $status : PASS_SLIP_STATUS_ACTIVE;
}

/** A fresh, unguessable slip token. 128 bits of CSPRNG output, hex so it survives any transport. */
function pass_slip_generate_token(): string
{
    return bin2hex(random_bytes(16));
}

/** The string encoded into the QR image for a slip. */
function pass_slip_qr_value(string $token): string
{
    return $token === '' ? '' : PASS_SLIP_QR_PREFIX . $token;
}

/** The human reference printed beside the QR, e.g. PS-0042-2026. */
function pass_slip_reference(int $id, ?string $passDate): string
{
    if ($id <= 0) {
        return '';
    }

    $year = substr((string)($passDate ?? ''), 0, 4);
    if (!preg_match('/^\d{4}$/', $year)) {
        $year = date('Y');
    }

    return sprintf('PS-%04d-%s', $id, $year);
}

/**
 * The bare token inside whatever a scanner handed us, or '' when there is none.
 *
 * Readers differ in what they deliver: the in-app camera gives the payload verbatim, a USB
 * keyboard-wedge reader may upper-case it, and a phone that opened the code as a link gives a whole
 * URL. All three are accepted by looking for the one thing that is actually the credential -- 32 hex
 * characters -- rather than by insisting on an exact payload format.
 */
function pass_slip_extract_token(mixed $value): string
{
    $text = trim((string)($value ?? ''));
    if ($text === '') {
        return '';
    }

    if (preg_match('/[0-9a-fA-F]{32}/', $text, $match) === 1) {
        return strtolower($match[0]);
    }

    return '';
}

/**
 * Add the QR columns and the scan table, once, on first request after deploy.
 *
 * Written the way the other ensure_* migrations in connection-pdo.php are: every step checks before
 * it acts, so running it on each request costs a handful of catalogue reads and re-running it after
 * a partial failure finishes the job rather than erroring.
 */
function ensure_pass_slip_qr_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }

    $columns = [
        'qr_token' => 'ALTER TABLE `pass_slip` ADD COLUMN `qr_token` CHAR(32) NULL AFTER `purpose`',
        'status' => 'ALTER TABLE `pass_slip` ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT "ACTIVE" AFTER `qr_token`',
        'pass_type' => 'ALTER TABLE `pass_slip` ADD COLUMN `pass_type` VARCHAR(40) NOT NULL DEFAULT "Official Business" AFTER `destination`',
        'expected_minutes' => 'ALTER TABLE `pass_slip` ADD COLUMN `expected_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 60 AFTER `pass_type`',
        'time_out_at' => 'ALTER TABLE `pass_slip` ADD COLUMN `time_out_at` DATETIME NULL AFTER `status`',
        'time_in_at' => 'ALTER TABLE `pass_slip` ADD COLUMN `time_in_at` DATETIME NULL AFTER `time_out_at`',
        'duration_minutes' => 'ALTER TABLE `pass_slip` ADD COLUMN `duration_minutes` INT NULL AFTER `time_in_at`',
        'decided_at' => 'ALTER TABLE `pass_slip` ADD COLUMN `decided_at` DATETIME NULL AFTER `approved_by`',
        'decision_note' => 'ALTER TABLE `pass_slip` ADD COLUMN `decision_note` VARCHAR(255) NULL AFTER `decided_at`',
    ];

    foreach ($columns as $column => $statement) {
        if (!database_column_exists($pdo, 'pass_slip', $column)) {
            $pdo->exec($statement);
        }
    }

    /*
     * Both times used to be required, because both were typed on the form. They are stamped by a
     * scan now, so a slip exists for hours with neither of them -- the NOT NULL has to go or filing
     * one is impossible. They stay as the TIME of day the scans landed, which is what the printed
     * form and every existing reader of this table already expect to find there.
     */
    foreach (['departure_time', 'time_returned'] as $timeColumn) {
        if (!pass_slip_column_is_nullable($pdo, 'pass_slip', $timeColumn)) {
            $pdo->exec('ALTER TABLE `pass_slip` MODIFY COLUMN `' . $timeColumn . '` TIME NULL DEFAULT NULL');
        }
    }

    /*
     * One slip, one token. The uniqueness is the whole security property -- without it a duplicate
     * token would make two slips answer to the same code -- so it is enforced by the index rather
     * than by the generator remembering what it has produced.
     */
    if (!pass_slip_index_exists($pdo, 'pass_slip', 'uq_pass_slip_qr_token')) {
        $pdo->exec('ALTER TABLE `pass_slip` ADD UNIQUE KEY `uq_pass_slip_qr_token` (`qr_token`)');
    }

    if (!pass_slip_index_exists($pdo, 'pass_slip', 'idx_pass_slip_status')) {
        $pdo->exec('ALTER TABLE `pass_slip` ADD KEY `idx_pass_slip_status` (`status`)');
    }

    if (!database_table_exists($pdo, 'pass_slip_scans')) {
        $pdo->exec(
            'CREATE TABLE `pass_slip_scans` (
                `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
                `pass_slip_id` INT(10) UNSIGNED NOT NULL,
                `scan_type` VARCHAR(20) NOT NULL,
                `accepted` TINYINT(1) NOT NULL DEFAULT 1,
                `scanned_at` DATETIME NOT NULL,
                `scanned_by_user_id` INT(10) UNSIGNED NULL,
                `scanned_by_name` VARCHAR(160) NULL,
                `scanned_by_role` VARCHAR(60) NULL,
                `status_before` VARCHAR(20) NULL,
                `status_after` VARCHAR(20) NULL,
                `message` VARCHAR(255) NULL,
                `ip_address` VARCHAR(45) NULL,
                `user_agent` VARCHAR(255) NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_pass_slip_scans_slip` (`pass_slip_id`),
                KEY `idx_pass_slip_scans_scanned_at` (`scanned_at`),
                CONSTRAINT `fk_pass_slip_scans_slip`
                    FOREIGN KEY (`pass_slip_id`) REFERENCES `pass_slip` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    pass_slip_backfill_qr_columns($pdo);
    pass_slip_retire_approval_statuses($pdo);

    $done = true;
}

/*
 * Both of these read INFORMATION_SCHEMA rather than SHOW, for one practical reason: MariaDB will not
 * accept a placeholder in `SHOW COLUMNS ... LIKE ?` or `SHOW INDEX ... WHERE`, and interpolating the
 * name instead is exactly the habit worth not starting in a file that also writes DDL.
 */
function pass_slip_index_exists(PDO $pdo, string $table, string $indexName): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name
           AND INDEX_NAME = :index_name'
    );
    $statement->execute([':table_name' => $table, ':index_name' => $indexName]);

    return (int)$statement->fetchColumn() > 0;
}

function pass_slip_column_is_nullable(PDO $pdo, string $table, string $column): bool
{
    $statement = $pdo->prepare(
        'SELECT IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name
           AND COLUMN_NAME = :column_name
         LIMIT 1'
    );
    $statement->execute([':table_name' => $table, ':column_name' => $column]);

    return strtoupper((string)$statement->fetchColumn()) === 'YES';
}

/**
 * Give the rows filed before the QR workflow a token, a status and actual-time stamps.
 *
 * A slip from the old module was typed complete -- both times were already on it -- so it is
 * COMPLETED, and its typed times become the stamps. It gets a token like any other row so that
 * nothing downstream has to special-case a slip with no QR; the token is inert because a COMPLETED
 * slip refuses every scan.
 */
function pass_slip_backfill_qr_columns(PDO $pdo): void
{
    $pending = $pdo->query('SELECT id FROM `pass_slip` WHERE `qr_token` IS NULL')->fetchAll();

    if ($pending === []) {
        return;
    }

    foreach ($pending as $row) {
        pass_slip_assign_token($pdo, (int)$row['id']);
    }

    /*
     * A row filed before the QR workflow carries both typed times, which makes it a finished trip.
     * It is stamped as one with the times it was filed with, rather than being left at the column
     * default and looking like a slip somebody is still holding.
     */
    $pdo->exec(
        'UPDATE `pass_slip`
            SET `status` = "COMPLETED",
                `time_out_at` = COALESCE(`time_out_at`, TIMESTAMP(`pass_date`, `departure_time`)),
                `time_in_at` = COALESCE(`time_in_at`, TIMESTAMP(`pass_date`, `time_returned`))
          WHERE `status` NOT IN ("OUT", "COMPLETED", "CANCELLED")
            AND `departure_time` IS NOT NULL
            AND `time_returned` IS NOT NULL'
    );

    $pdo->exec(
        'UPDATE `pass_slip`
            SET `duration_minutes` = TIMESTAMPDIFF(MINUTE, `time_out_at`, `time_in_at`)
          WHERE `duration_minutes` IS NULL
            AND `time_out_at` IS NOT NULL
            AND `time_in_at` IS NOT NULL'
    );
}

/**
 * Retire the approval statuses from rows written while the module briefly had an approval step.
 *
 * A pass slip is filed and immediately usable -- there is nobody to wait for -- so PENDING and
 * APPROVED both describe the same thing the module now calls ACTIVE. REJECTED has no successor
 * either: a slip somebody refused is a slip that will not be used, which is CANCELLED.
 *
 * Kept rather than dropped once the rows are converted, because the column default and this sweep
 * are what let a database that sat on the old build come forward without anybody running SQL by
 * hand. It costs one indexed UPDATE that matches nothing on every subsequent deploy.
 */
function pass_slip_retire_approval_statuses(PDO $pdo): void
{
    $pdo->exec('UPDATE `pass_slip` SET `status` = "ACTIVE" WHERE `status` IN ("PENDING", "APPROVED")');
    $pdo->exec('UPDATE `pass_slip` SET `status` = "CANCELLED" WHERE `status` = "REJECTED"');

    /*
     * The column default moved with the vocabulary. Without this an older table keeps defaulting new
     * rows to PENDING, and since nothing inserts a status explicitly on the fallback path, a slip
     * could be filed into a state that no longer exists.
     */
    $default = $pdo->prepare(
        'SELECT COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "pass_slip"
           AND COLUMN_NAME = "status"
         LIMIT 1'
    );
    $default->execute();

    if (strtoupper((string)$default->fetchColumn()) !== 'ACTIVE') {
        $pdo->exec('ALTER TABLE `pass_slip` MODIFY COLUMN `status` VARCHAR(20) NOT NULL DEFAULT "ACTIVE"');
    }
}

/**
 * Store a fresh token on a slip, retrying past a collision on the unique index.
 *
 * Returns the token that stuck. The retry is not superstition about randomness: the index is the
 * only authority on whether a token is free, and one unlucky row must not abort a migration that
 * still has rows to go.
 */
function pass_slip_assign_token(PDO $pdo, int $passSlipId): string
{
    $statement = $pdo->prepare('UPDATE `pass_slip` SET `qr_token` = :token WHERE `id` = :id');

    for ($attempt = 0; $attempt < 5; $attempt++) {
        $token = pass_slip_generate_token();

        try {
            $statement->execute([':token' => $token, ':id' => $passSlipId]);
            return $token;
        } catch (PDOException $exception) {
            if ($attempt === 4) {
                throw $exception;
            }
        }
    }

    return '';
}

/** Record one scan attempt -- accepted or refused -- against a slip. */
function pass_slip_record_scan(
    PDO $pdo,
    int $passSlipId,
    string $scanType,
    bool $accepted,
    array $user,
    string $statusBefore,
    string $statusAfter,
    string $message
): ?array {
    try {
        $context = function_exists('audit_request_context') ? audit_request_context() : [];

        $statement = $pdo->prepare(
            'INSERT INTO `pass_slip_scans`
                (pass_slip_id, scan_type, accepted, scanned_at, scanned_by_user_id, scanned_by_name,
                 scanned_by_role, status_before, status_after, message, ip_address, user_agent)
             VALUES
                (:pass_slip_id, :scan_type, :accepted, NOW(), :user_id, :name, :role, :before, :after, :message, :ip, :agent)'
        );
        $statement->execute([
            ':pass_slip_id' => $passSlipId,
            ':scan_type' => $scanType,
            ':accepted' => $accepted ? 1 : 0,
            ':user_id' => (int)($user['id'] ?? 0) ?: null,
            ':name' => substr(trim((string)($user['full_name'] ?? $user['username'] ?? '')), 0, 160) ?: null,
            ':role' => substr(trim((string)($user['role'] ?? '')), 0, 60) ?: null,
            ':before' => $statusBefore !== '' ? $statusBefore : null,
            ':after' => $statusAfter !== '' ? $statusAfter : null,
            ':message' => substr($message, 0, 255) ?: null,
            ':ip' => $context['ipAddress'] ?? null,
            ':agent' => substr((string)($context['userAgent'] ?? ''), 0, 255) ?: null,
        ]);

        return pass_slip_fetch_scan($pdo, (int)$pdo->lastInsertId());
    } catch (Throwable $exception) {
        /* An accepted scan is already committed to `pass_slip`; its log entry failing must not undo it. */
        error_log('Pass slip scan log failed: ' . $exception->getMessage());
        return null;
    }
}

function pass_slip_scan_select(): string
{
    return 'SELECT
                s.id,
                s.pass_slip_id AS passSlipId,
                s.scan_type AS scanType,
                s.accepted,
                s.scanned_at AS scannedAt,
                DATE_FORMAT(s.scanned_at, "%b %e, %Y %h:%i %p") AS scannedAtDisplay,
                s.scanned_by_user_id AS scannedByUserId,
                s.scanned_by_name AS scannedByName,
                s.scanned_by_role AS scannedByRole,
                s.status_before AS statusBefore,
                s.status_after AS statusAfter,
                s.message,
                s.ip_address AS ipAddress
            FROM `pass_slip_scans` s';
}

function pass_slip_shape_scan(array $row): array
{
    $row['id'] = (int)$row['id'];
    $row['passSlipId'] = (int)$row['passSlipId'];
    $row['accepted'] = (int)$row['accepted'] === 1;
    $row['scannedByUserId'] = $row['scannedByUserId'] !== null ? (int)$row['scannedByUserId'] : null;

    return $row;
}

function pass_slip_fetch_scan(PDO $pdo, int $scanId): ?array
{
    $statement = $pdo->prepare(pass_slip_scan_select() . ' WHERE s.id = :id LIMIT 1');
    $statement->execute([':id' => $scanId]);
    $row = $statement->fetch();

    return is_array($row) ? pass_slip_shape_scan($row) : null;
}

/** Every scan attempt on one slip, oldest first, which is the order the history reads in. */
function pass_slip_fetch_scans(PDO $pdo, int $passSlipId): array
{
    $statement = $pdo->prepare(pass_slip_scan_select() . ' WHERE s.pass_slip_id = :id ORDER BY s.scanned_at ASC, s.id ASC');
    $statement->execute([':id' => $passSlipId]);

    return array_map('pass_slip_shape_scan', $statement->fetchAll() ?: []);
}

/**
 * What this scan should do, given where the slip already is.
 *
 * This is the whole "scan logic" in one place: no Time Out yet means stamp Time Out, a Time Out but
 * no return means stamp the return, and both means the slip is finished. Everything else is a state
 * whose code was never live or is live no longer.
 */
function pass_slip_scan_decision(string $status, array $row): array
{
    if ($status === PASS_SLIP_STATUS_COMPLETED) {
        return ['ok' => false, 'status' => 409, 'action' => PASS_SLIP_SCAN_DENIED, 'message' => 'This Pass Slip has already been completed.'];
    }

    if ($status === PASS_SLIP_STATUS_CANCELLED) {
        return ['ok' => false, 'status' => 409, 'action' => PASS_SLIP_SCAN_DENIED, 'message' => 'This pass slip was cancelled. Its QR code is no longer active.'];
    }

    if ($status === PASS_SLIP_STATUS_ACTIVE) {
        $passDate = (string)($row['pass_date'] ?? '');
        $today = date('Y-m-d');

        if ($passDate !== '' && $passDate > $today) {
            return ['ok' => false, 'status' => 409, 'action' => PASS_SLIP_SCAN_DENIED, 'message' => 'This pass slip is dated ' . $passDate . ' and cannot be used before then.'];
        }

        /*
         * A slip that was never scanned out on its own day is spent. This is the one date rule that
         * matters now that nobody signs a slip off: without it, filing one is a standing permission
         * to leave that never runs out.
         */
        if ($passDate !== '' && $passDate < $today) {
            return ['ok' => false, 'status' => 409, 'action' => PASS_SLIP_SCAN_DENIED, 'message' => 'This pass slip was for ' . $passDate . ' and has expired. File a new one.'];
        }

        return ['ok' => true, 'action' => PASS_SLIP_SCAN_TIME_OUT];
    }

    /* OUT: the very next deliberate scan records the return, regardless of elapsed minutes. */
    return ['ok' => true, 'action' => PASS_SLIP_SCAN_TIME_IN];
}

function pass_slip_format_duration(mixed $minutes): string
{
    $total = (int)($minutes ?? 0);
    if ($total <= 0) {
        return 'under a minute';
    }

    $hours = intdiv($total, 60);
    $rest = $total % 60;

    if ($hours === 0) {
        return $rest . ' min';
    }

    return $hours . ' hr' . ($hours === 1 ? '' : 's') . ($rest > 0 ? ' ' . $rest . ' min' : '');
}
