<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

/**
 * Rewards & Recognition — award cycles, the nominations filed against them, and the employees' vote.
 *
 * The HR Head opens a cycle, the division Chiefs nominate colleagues from their own division into it
 * with a reason, and the HR Head approves or rejects each nomination. The approved nominees are the
 * ballot, and an approval puts its nominee on it at once: from then until the cycle closes every
 * employee may vote for one of them, and whoever the employees vote for most wins the award. Each step
 * belongs to one role, and that split is enforced here rather than left to the UI that hides the buttons.
 */

function rewards_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

/** Certificate templates and their assets — the paper an award is printed on. */
function rewards_can_manage(array $user): bool
{
    return in_array(user_role_key($user), ['admin', 'hrhead', 'hrstaff', 'chief'], true);
}

/** Opening, editing, closing, and archiving a nomination is the HR Head's desk alone. */
function rewards_can_manage_cycles(array $user): bool
{
    return user_role_key($user) === 'hrhead';
}

/** Division Chiefs are the nominators: only they submit nominations, one colleague at a time. */
function rewards_can_vote(array $user): bool
{
    return user_role_key($user) === 'chief';
}

/** The ballot belongs to the employees: they choose the winner from the nominees HR approved. */
function rewards_can_cast_vote(array $user): bool
{
    return user_role_key($user) === REWARDS_VOTER_ROLE;
}

/** The division a voter may nominate from: that of their own employee record, or 0 when there is none. */
function rewards_voter_division_id(PDO $pdo, ?int $voterEmployeeRecordId): int
{
    if ($voterEmployeeRecordId === null || $voterEmployeeRecordId <= 0) {
        return 0;
    }

    $statement = $pdo->prepare('SELECT division_id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1');
    $statement->execute([':id' => $voterEmployeeRecordId]);

    return (int)$statement->fetchColumn();
}

/** The roles that see a nomination through: the Chiefs who vote in it and the HR Head who runs it. */
function rewards_nomination_audience_roles(): array
{
    return ['chief', 'hrhead'];
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

/** The reason is what the HR Head judges a nomination on, so a one-word one is refused. */
const REWARDS_NOMINATION_REASON_MIN = 10;
const REWARDS_NOMINATION_REASON_MAX = 1000;
const REWARDS_REVIEWER_NOTE_MAX = 500;

/** The review states a nomination moves through. Only `approved` nominees reach the ballot. */
const REWARDS_NOMINATION_STATUSES = ['submitted', 'approved', 'rejected'];

/** The role whose members vote on the approved nominees. */
const REWARDS_VOTER_ROLE = 'employee';

/**
 * Whether a cycle's period — nominations and voting share one — is behind it, for a cycle already fetched.
 *
 * A manager who reopens a cycle after its period has ended is overriding the deadline on purpose — it
 * is how a tied vote gets settled — so a reopening later than the deadline keeps the vote open until
 * somebody closes it or sets a new one. `rewards_close_expired_cycles()` selects on the same rule; the
 * two must agree, or the sweep would shut a ballot this still calls open.
 */
function rewards_period_has_ended(array $cycle): bool
{
    $closesOn = rewards_text($cycle['closesOn'] ?? '');

    if ($closesOn === '' || strtotime($closesOn) === false || strtotime($closesOn) > time()) {
        return false;
    }

    $reopenedAt = rewards_text($cycle['reopenedAt'] ?? '');

    return $reopenedAt === '' || strtotime($reopenedAt) <= strtotime($closesOn);
}

/**
 * Whether the Chiefs can no longer nominate into a cycle: once its period has ended, even if it was
 * reopened since. Reopening is how a tied vote is settled, and a nominee arriving mid-tiebreak would
 * make it a different contest. Moving the closing time later is how the HR Head reopens nominations.
 */
function rewards_nominations_have_ended(array $cycle): bool
{
    $closesOn = strtotime(rewards_text($cycle['closesOn'] ?? ''));

    return $closesOn !== false && $closesOn <= time();
}

/**
 * Where a cycle stands:
 *
 *   nomination — the period is open: the Chiefs nominate, and the employees vote on whoever HR has
 *                approved so far (a nominee is on the ballot from the moment they are approved)
 *   voting     — the period is over, but the HR Head reopened the cycle to settle a tie: voting only
 *   closed     — the result is final
 *
 * Only `closed` is stored (as the status); the rest is read off the clock, so a phase never waits on
 * somebody loading the page.
 */
function rewards_cycle_phase(array $cycle): string
{
    // Past the deadline but not yet swept: nothing more can be filed or cast, so it reads as closed.
    if (($cycle['status'] ?? 'ongoing') === 'closed' || rewards_period_has_ended($cycle)) {
        return 'closed';
    }

    return rewards_nominations_have_ended($cycle) ? 'voting' : 'nomination';
}

/** "1 vote", "3 votes". */
function rewards_vote_label(int $count): string
{
    return $count === 1 ? '1 vote' : $count . ' votes';
}

/** "Aug 9, 2026 at 5:00 PM" — the deadline as it reads in a notification. */
function rewards_period_label(?string $value): string
{
    $moment = $value !== null && $value !== '' ? strtotime($value) : false;

    return $moment === false ? 'the closing date' : date('M j, Y \a\t g:i A', $moment);
}

/**
 * The people a nomination concerns: the Chiefs who vote in it and the HR Head who runs it. Nobody
 * else can act on the notice, so nobody else gets it.
 */
function rewards_notify_nomination_audience(PDO $pdo, string $title, string $message, string $type, ?string $referenceId = null): int
{
    return notify_roles($pdo, rewards_nomination_audience_roles(), $title, $message, $type, $referenceId);
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

        rewards_notify_nomination_audience(
            $pdo,
            'Nominations close soon: ' . $cycle['category'],
            sprintf(
                'Nominations for %s close on %s. Submit your nominations before then.',
                $cycle['category'],
                rewards_period_label($cycle['closesOn'])
            ),
            'award_cycle_closing',
            (string)$cycle['id']
        );
    }
}

/**
 * The "voting is open" notice to the employees, sent once per cycle: when the HR Head approves its
 * first nominee, which is the moment there is something to vote for.
 *
 * Same mechanics as the closing reminder above: it rides on the requests that list the cycles — the
 * HR Head's own screen lists them again straight after the approval — and the stamp is claimed with a
 * conditional UPDATE so two requests cannot both send it. Nominees approved later join the ballot
 * without another notice; the employees already know where to vote.
 */
function rewards_send_due_voting_notices(PDO $pdo): void
{
    $cycles = $pdo->query(
        'SELECT
            c.id,
            c.category,
            c.closes_on AS closesOn,
            (
                SELECT COUNT(DISTINCT n.nominee_employee_id)
                FROM reward_cycle_votes n
                WHERE n.cycle_id = c.id
                  AND n.status = "approved"
            ) AS nominees
         FROM reward_cycles c
         WHERE c.is_archived = 0
           AND c.status <> "closed"
           AND c.voting_notice_sent_at IS NULL
           AND c.closes_on > NOW()'
    )->fetchAll();

    $claim = $pdo->prepare('UPDATE reward_cycles SET voting_notice_sent_at = NOW() WHERE id = :id AND voting_notice_sent_at IS NULL');

    foreach ($cycles as $cycle) {
        $nominees = (int)$cycle['nominees'];

        if ($nominees === 0) {
            continue;
        }

        $claim->execute([':id' => (int)$cycle['id']]);

        if ($claim->rowCount() === 0) {
            continue;
        }

        notify_roles(
            $pdo,
            [REWARDS_VOTER_ROLE],
            'Voting is open: ' . $cycle['category'],
            sprintf(
                'Voting for %s is open until %s, with %d %s approved so far. Cast your vote under Award Voting.',
                $cycle['category'],
                rewards_period_label($cycle['closesOn']),
                $nominees,
                $nominees === 1 ? 'nominee' : 'nominees'
            ),
            'award_voting_open',
            (string)$cycle['id']
        );
    }
}

function ensure_rewards_tables(PDO $pdo): void
{
    // Some imported schemas lost the nomination primary key and AUTO_INCREMENT,
    // leaving new submissions with id 0, which the review endpoint cannot accept.
    $nominationIdColumn = $pdo->query(
        'SELECT COLUMN_KEY, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycle_votes"
           AND COLUMN_NAME = "id"'
    )->fetch();

    if ($nominationIdColumn && !str_contains((string)$nominationIdColumn['EXTRA'], 'auto_increment')) {
        $nextId = (int)$pdo->query('SELECT COALESCE(MAX(id), 0) + 1 FROM reward_cycle_votes')->fetchColumn();
        $repairId = $pdo->prepare('UPDATE reward_cycle_votes SET id = :id WHERE id = 0 LIMIT 1');
        do {
            $repairId->execute([':id' => $nextId++]);
        } while ($repairId->rowCount() > 0);

        $primaryKey = $nominationIdColumn['COLUMN_KEY'] === 'PRI' ? '' : ', ADD PRIMARY KEY (id)';
        $pdo->exec('ALTER TABLE reward_cycle_votes MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT' . $primaryKey);
    }

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
     * A nomination is reviewed by the HR Head before it counts: submitted, then approved or rejected,
     * with an optional note back to the Chief who filed it. Rows filed before the review step existed
     * were already counted as votes — and may already sit behind an issued certificate — so they are
     * carried over as approved rather than dropped back into the review queue.
     */
    $hasNominationStatusColumn = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycle_votes"
           AND COLUMN_NAME = "status"'
    )->fetchColumn();

    if ($hasNominationStatusColumn === 0) {
        $pdo->exec(
            'ALTER TABLE reward_cycle_votes
             ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT "submitted" AFTER reason,
             ADD COLUMN reviewer_note TEXT NULL AFTER status,
             ADD COLUMN reviewed_at DATETIME NULL AFTER reviewer_note,
             ADD COLUMN reviewed_by_user_id INT UNSIGNED NULL AFTER reviewed_at,
             ADD COLUMN reviewed_by_name VARCHAR(180) NULL AFTER reviewed_by_user_id,
             ADD KEY idx_reward_cycle_votes_status (status)'
        );
        $pdo->exec('UPDATE reward_cycle_votes SET status = "approved", reviewed_at = created_at');
    }

    /*
     * The "voting is open" twin of `closing_notice_sent_at`: stamped when a cycle's first approved
     * nominee opens its vote, so the employees are told once.
     */
    $hasVotingNoticeColumn = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycles"
           AND COLUMN_NAME = "voting_notice_sent_at"'
    )->fetchColumn();

    if ($hasVotingNoticeColumn === 0) {
        $pdo->exec('ALTER TABLE reward_cycles ADD COLUMN voting_notice_sent_at DATETIME NULL AFTER closing_notice_sent_at');
    }

    /*
     * Earlier versions of the vote kept times of its own: when voting opened, and when it closed if
     * later than nominations. Voting now opens with each approval and closes with the nomination
     * period, so installs that ran those versions lose the columns rather than keep ones nothing reads.
     */
    $retiredColumn = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "reward_cycles"
           AND COLUMN_NAME = :column'
    );

    foreach (['voting_opens_on', 'voting_closes_on'] as $column) {
        $retiredColumn->execute([':column' => $column]);

        if ((int)$retiredColumn->fetchColumn() > 0) {
            // The name comes from the literal list above, never from a request.
            $pdo->exec('ALTER TABLE reward_cycles DROP COLUMN ' . $column);
        }
    }

    /*
     * The ballots. One per employee per cycle, and the unique key is what holds that against a
     * double-submit or a second tab: changing a vote rewrites the row instead of adding one, so the
     * number of rows is the number of people who voted. Who chose whom is never shown back to anybody
     * but the voter; only the counts leave this table.
     */
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS reward_employee_votes (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            cycle_id INT UNSIGNED NOT NULL,
            voter_user_id INT UNSIGNED NOT NULL,
            nominee_employee_id INT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_reward_employee_votes_voter (cycle_id, voter_user_id),
            KEY idx_reward_employee_votes_nominee (cycle_id, nominee_employee_id),
            KEY idx_reward_employee_votes_user (voter_user_id),
            KEY idx_reward_employee_votes_employee (nominee_employee_id),
            CONSTRAINT fk_reward_employee_votes_cycle FOREIGN KEY (cycle_id) REFERENCES reward_cycles (id) ON DELETE CASCADE,
            CONSTRAINT fk_reward_employee_votes_voter FOREIGN KEY (voter_user_id) REFERENCES users (id) ON DELETE CASCADE,
            CONSTRAINT fk_reward_employee_votes_nominee FOREIGN KEY (nominee_employee_id) REFERENCES employees (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

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

function rewards_certificate_template_record_name(mixed $value, string $fallback = 'Certificate Template'): string
{
    $name = substr(rewards_text($value), 0, 80);
    return $name !== '' ? $name : $fallback;
}

/**
 * The editable certificate library. Existing installations only have the legacy single-template
 * setting, so that design becomes the first library record without requiring a separate migration.
 */
function rewards_certificate_template_library(PDO $pdo): array
{
    $legacy = json_decode(get_application_setting($pdo, 'reward_certificate_template', ''), true);
    $legacyTemplate = rewards_normalize_certificate_template($legacy);
    $stored = json_decode(get_application_setting($pdo, 'reward_certificate_templates', ''), true);
    $records = [];
    $seenIds = [];

    foreach (is_array($stored['templates'] ?? null) ? $stored['templates'] : [] as $candidate) {
        if (!is_array($candidate) || count($records) >= 50) {
            continue;
        }

        $id = rewards_text($candidate['id'] ?? '');
        if (preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id) !== 1 || isset($seenIds[$id])) {
            continue;
        }

        $seenIds[$id] = true;
        $records[] = [
            'id' => $id,
            'name' => rewards_certificate_template_record_name($candidate['name'] ?? null),
            'template' => rewards_normalize_certificate_template($candidate['template'] ?? null),
            'createdAt' => substr(rewards_text($candidate['createdAt'] ?? ''), 0, 40),
            'updatedAt' => substr(rewards_text($candidate['updatedAt'] ?? ''), 0, 40),
        ];
    }

    if ($records === []) {
        $records[] = [
            'id' => 'default',
            'name' => 'Default Certificate',
            'template' => $legacyTemplate,
            'createdAt' => '',
            'updatedAt' => '',
        ];
    }

    $activeId = rewards_text($stored['activeTemplateId'] ?? '');
    if (!isset($seenIds[$activeId]) && !in_array($activeId, array_column($records, 'id'), true)) {
        $activeId = (string)$records[0]['id'];
    }

    return [
        'version' => 1,
        'activeTemplateId' => $activeId,
        'templates' => array_values($records),
    ];
}

function rewards_store_certificate_template_library(PDO $pdo, array $library): void
{
    $encoded = json_encode($library, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false) {
        throw new RuntimeException('The certificate template library could not be encoded.');
    }

    store_application_setting($pdo, 'reward_certificate_templates', $encoded);

    foreach ($library['templates'] as $record) {
        if (($record['id'] ?? '') !== ($library['activeTemplateId'] ?? '')) {
            continue;
        }

        $activeTemplate = json_encode($record['template'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($activeTemplate !== false) {
            // Retain the original key for older clients and deployments during rolling updates.
            store_application_setting($pdo, 'reward_certificate_template', $activeTemplate);
        }
        break;
    }
}

function rewards_certificate_template(PDO $pdo): array
{
    $library = rewards_certificate_template_library($pdo);
    foreach ($library['templates'] as $record) {
        if ($record['id'] === $library['activeTemplateId']) {
            return $record['template'];
        }
    }

    return $library['templates'][0]['template'];
}

function rewards_get_certificate_template(PDO $pdo): void
{
    $library = rewards_certificate_template_library($pdo);
    $activeTemplate = $library['templates'][0]['template'];
    foreach ($library['templates'] as $record) {
        if ($record['id'] === $library['activeTemplateId']) {
            $activeTemplate = $record['template'];
            break;
        }
    }

    json_response([
        'success' => true,
        'template' => $activeTemplate,
        'activeTemplateId' => $library['activeTemplateId'],
        'templates' => $library['templates'],
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

    $body = rewards_request_body();
    $library = rewards_certificate_template_library($pdo);
    $templateId = rewards_text($body['templateId'] ?? $body['template_id'] ?? $library['activeTemplateId']);
    $recordIndex = null;

    foreach ($library['templates'] as $index => $record) {
        if ($record['id'] === $templateId) {
            $recordIndex = $index;
            break;
        }
    }

    if ($recordIndex === null) {
        json_response(['success' => false, 'message' => 'That certificate template no longer exists.'], 404);
    }

    $previousTemplate = $library['templates'][$recordIndex]['template'];
    $template = rewards_normalize_certificate_template($body['template'] ?? null);
    $name = array_key_exists('name', $body)
        ? rewards_certificate_template_record_name($body['name'], $library['templates'][$recordIndex]['name'])
        : $library['templates'][$recordIndex]['name'];
    $library['templates'][$recordIndex] = array_merge($library['templates'][$recordIndex], [
        'name' => $name,
        'template' => $template,
        'updatedAt' => date(DATE_ATOM),
    ]);
    $library['activeTemplateId'] = $templateId;
    rewards_store_certificate_template_library($pdo, $library);

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
        'templateId' => $templateId,
        'name' => $name,
        'preset' => $template['preset'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Certificate template saved.',
        'template' => $template,
        'templateRecord' => $library['templates'][$recordIndex],
        'activeTemplateId' => $templateId,
        'templates' => $library['templates'],
    ]);
}

function rewards_create_certificate_template(PDO $pdo, array $user): void
{
    if (!rewards_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to add certificate templates.'], 403);
    }

    $body = rewards_request_body();
    $name = rewards_certificate_template_record_name($body['name'] ?? null, '');
    if ($name === '') {
        json_response(['success' => false, 'message' => 'Enter a name for the new certificate template.'], 422);
    }

    $library = rewards_certificate_template_library($pdo);
    foreach ($library['templates'] as $record) {
        if (strcasecmp($record['name'], $name) === 0) {
            json_response(['success' => false, 'message' => 'A certificate template with that name already exists.'], 409);
        }
    }

    if (count($library['templates']) >= 50) {
        json_response(['success' => false, 'message' => 'You can save up to 50 certificate templates.'], 409);
    }

    $now = date(DATE_ATOM);
    $record = [
        'id' => 'template_' . bin2hex(random_bytes(8)),
        'name' => $name,
        'template' => rewards_normalize_certificate_template($body['template'] ?? null),
        'createdAt' => $now,
        'updatedAt' => $now,
    ];
    $library['templates'][] = $record;
    $library['activeTemplateId'] = $record['id'];
    rewards_store_certificate_template_library($pdo, $library);

    write_auth_audit($pdo, $user, 'rewards.certificate_template_created', 'A certificate template was added.', [
        'templateId' => $record['id'],
        'name' => $record['name'],
        'preset' => $record['template']['preset'],
    ]);

    json_response([
        'success' => true,
        'message' => 'Certificate template added.',
        'template' => $record['template'],
        'templateRecord' => $record,
        'activeTemplateId' => $record['id'],
        'templates' => $library['templates'],
    ], 201);
}

function rewards_delete_certificate_template(PDO $pdo, array $user): void
{
    if (!rewards_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to delete certificate templates.'], 403);
    }

    $body = rewards_request_body();
    $templateId = rewards_text($body['templateId'] ?? $body['template_id'] ?? '');
    $library = rewards_certificate_template_library($pdo);

    if (count($library['templates']) <= 1) {
        json_response(['success' => false, 'message' => 'Keep at least one certificate template.'], 409);
    }

    $removed = null;
    $remaining = [];
    foreach ($library['templates'] as $record) {
        if ($record['id'] === $templateId) {
            $removed = $record;
        } else {
            $remaining[] = $record;
        }
    }

    if ($removed === null) {
        json_response(['success' => false, 'message' => 'That certificate template no longer exists.'], 404);
    }

    $library['templates'] = array_values($remaining);
    if ($library['activeTemplateId'] === $templateId) {
        $library['activeTemplateId'] = $library['templates'][0]['id'];
    }
    rewards_store_certificate_template_library($pdo, $library);

    foreach (['signatureImage', 'backgroundImage'] as $field) {
        $storedPath = rewards_text($removed['template'][$field] ?? '');
        if ($storedPath === '' || rewards_certificate_asset_is_referenced($pdo, $field, $storedPath)) {
            continue;
        }

        if ($field === 'signatureImage') {
            rewards_remove_certificate_signature_file($storedPath);
        } else {
            rewards_remove_certificate_design_file($storedPath);
        }
    }

    write_auth_audit($pdo, $user, 'rewards.certificate_template_deleted', 'A certificate template was deleted.', [
        'templateId' => $templateId,
        'name' => $removed['name'],
    ]);

    $activeTemplate = $library['templates'][0]['template'];
    foreach ($library['templates'] as $record) {
        if ($record['id'] === $library['activeTemplateId']) {
            $activeTemplate = $record['template'];
            break;
        }
    }

    json_response([
        'success' => true,
        'message' => 'Certificate template deleted.',
        'template' => $activeTemplate,
        'activeTemplateId' => $library['activeTemplateId'],
        'templates' => $library['templates'],
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
            OR EXISTS(SELECT 1 FROM reward_certificates WHERE template_snapshot LIKE :certificate_path)
            OR EXISTS(
                SELECT 1 FROM settings
                WHERE setting_key = "reward_certificate_templates"
                  AND setting_value LIKE :library_path
            )'
    );
    $statement->execute([
        ':cycle_path' => $needle,
        ':certificate_path' => $needle,
        ':library_path' => $needle,
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
            (
                SELECT vd.name
                FROM users u
                INNER JOIN employees e
                   ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
                  AND e.is_archived = 0
                LEFT JOIN divisions vd ON vd.id = e.division_id
                WHERE u.id = n.voter_user_id
                ORDER BY e.id ASC
                LIMIT 1
            ) AS voterDivision,
            n.nominee_employee_id AS nomineeEmployeeId,
            n.nominee_name AS nomineeName,
            nd.name AS nomineeDivision,
            ndes.name AS nomineePosition,
            ne.profile_image AS nomineePhoto,
            n.reason,
            n.status,
            n.reviewer_note AS reviewerNote,
            n.reviewed_at AS reviewedAt,
            n.reviewed_by_name AS reviewedByName,
            n.created_at AS createdAt
         FROM reward_cycle_votes n
         LEFT JOIN employees ne ON ne.id = n.nominee_employee_id
         LEFT JOIN divisions nd ON nd.id = ne.division_id
         LEFT JOIN designations ndes ON ndes.id = ne.designation_id
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
            'voterDivision' => $row['voterDivision'] ?? '',
            'nomineeKey' => (string)$row['nomineeEmployeeId'],
            'nomineeName' => $row['nomineeName'] ?? '',
            // Read live from the directory, so a transfer after the nomination shows where they are now.
            'nomineeDivision' => $row['nomineeDivision'] ?? '',
            'nomineePosition' => $row['nomineePosition'] ?? '',
            // The ballot is read by employees, who cannot load the directory the other screens take faces from.
            'nomineePhoto' => $row['nomineePhoto'] ?? '',
            'reason' => $row['reason'] ?? '',
            'status' => in_array($row['status'] ?? '', REWARDS_NOMINATION_STATUSES, true) ? $row['status'] : 'submitted',
            'reviewerNote' => $row['reviewerNote'] ?? '',
            'reviewedAt' => $row['reviewedAt'] ?? null,
            'reviewedByName' => $row['reviewedByName'] ?? '',
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
        'phase' => rewards_cycle_phase($row),
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
    defer(static fn () => rewards_send_due_voting_notices($pdo));

    $statement = $pdo->prepare(
        rewards_cycle_select() . ' WHERE c.is_archived = :is_archived ORDER BY c.created_at DESC, c.id DESC'
    );
    $statement->execute([':is_archived' => $archived ? 1 : 0]);
    $nominations = rewards_nominations_by_cycle($pdo);
    $certificates = rewards_certificates_by_cycle($pdo);
    $voteCounts = rewards_vote_counts_by_cycle($pdo);
    $myVotes = rewards_votes_cast_by($pdo, (int)($user['id'] ?? 0));
    $isVoter = rewards_can_cast_vote($user);

    $cycles = array_map(
        static function (array $row) use ($nominations, $certificates, $voteCounts, $myVotes, $isVoter): array {
            $cycleId = (int)$row['id'];
            $cycleNominations = $nominations[$cycleId] ?? [];

            /*
             * A voter needs the ballot, not the review behind it: who was turned down, and what HR
             * wrote back to the Chief who filed it, stays between HR and the Chiefs.
             */
            if ($isVoter) {
                $cycleNominations = array_values(array_map(
                    static fn (array $nomination): array => array_merge($nomination, ['reviewerNote' => '', 'reviewedByName' => '']),
                    array_filter($cycleNominations, static fn (array $nomination): bool => $nomination['status'] === 'approved')
                ));
            }

            $cycle = rewards_format_cycle($row, $cycleNominations);
            $counts = $voteCounts[$cycleId] ?? [];

            /*
             * A voter sees the count only once the result is final, so nobody's choice is steered by
             * how everybody else is leaning. The people running or following the award see it live.
             */
            $revealed = !$isVoter || $cycle['phase'] === 'closed';

            return $cycle + [
                // An object even when empty, so the client always reads it as a nominee-to-count map.
                'voteCounts' => $revealed ? (object)$counts : null,
                'totalVotes' => $revealed ? array_sum($counts) : null,
                'myVote' => $myVotes[$cycleId] ?? '',
                'certificate' => $certificates[$cycleId] ?? null,
            ];
        },
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
        'canManage' => rewards_can_manage_cycles($user),
        // `canVote` predates the employees' ballot and means "may nominate" (a Chief); `canCastVote` is the ballot.
        'canVote' => rewards_can_vote($user),
        'canCastVote' => $isVoter,
        // How many people the ballot is open to, so the HR Head can read turnout off the vote count.
        'voterCount' => count(user_ids_for_role_keys($pdo, [REWARDS_VOTER_ROLE])),
    ]);
}

/** Employee votes per cycle, as [cycle id => [nominee employee id => count]]. */
function rewards_vote_counts_by_cycle(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT cycle_id AS cycleId, nominee_employee_id AS nomineeId, COUNT(*) AS votes
         FROM reward_employee_votes
         GROUP BY cycle_id, nominee_employee_id'
    );

    $counts = [];
    foreach ($statement->fetchAll() as $row) {
        $counts[(int)$row['cycleId']][(string)$row['nomineeId']] = (int)$row['votes'];
    }

    return $counts;
}

/** The nominee one account voted for in each cycle, as [cycle id => nominee employee id]. */
function rewards_votes_cast_by(PDO $pdo, int $voterUserId): array
{
    if ($voterUserId <= 0) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT cycle_id AS cycleId, nominee_employee_id AS nomineeId
         FROM reward_employee_votes
         WHERE voter_user_id = :voter_user_id'
    );
    $statement->execute([':voter_user_id' => $voterUserId]);

    $votes = [];
    foreach ($statement->fetchAll() as $row) {
        $votes[(int)$row['cycleId']] = (string)$row['nomineeId'];
    }

    return $votes;
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

function rewards_require_cycle_manager(array $user): void
{
    if (!rewards_can_manage_cycles($user)) {
        json_response(['success' => false, 'message' => 'Only the HR Head can create or manage nominations.'], 403);
    }
}

function rewards_require_voter(array $user): void
{
    if (!rewards_can_vote($user)) {
        json_response(['success' => false, 'message' => 'Only division Chiefs can submit nominations.'], 403);
    }
}

/**
 * An award is given once a month, so one nomination per award per calendar month — the month it
 * opens in. Archived cycles do not count: archiving is how a mistaken one is withdrawn, and it must
 * be possible to open the right one in its place. `$excludeCycleId` is the cycle being edited.
 */
function rewards_assert_month_available(PDO $pdo, string $category, string $opensOn, ?int $excludeCycleId = null): void
{
    $statement = $pdo->prepare(
        'SELECT id, opens_on
         FROM reward_cycles
         WHERE is_archived = 0
           AND LOWER(category) = LOWER(:category)
           AND DATE_FORMAT(opens_on, "%Y-%m") = DATE_FORMAT(:opens_on, "%Y-%m")
           AND id <> :exclude_id
         LIMIT 1'
    );
    $statement->execute([
        ':category' => $category,
        ':opens_on' => $opensOn,
        ':exclude_id' => $excludeCycleId ?? 0,
    ]);

    if ($statement->fetch() !== false) {
        json_response([
            'success' => false,
            'message' => sprintf(
                'A %s nomination for %s already exists. Only one can be opened per month.',
                $category,
                date('F Y', strtotime($opensOn))
            ),
        ], 422);
    }
}

function rewards_create_cycle(PDO $pdo, array $user): void
{
    rewards_require_cycle_manager($user);

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

    rewards_assert_month_available($pdo, $category, $opensOn);

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
     * The Chiefs are told nominations are open. Deferred because this writes one row per account and
     * the HR Head who pressed Create should not wait on those inserts.
     */
    defer(static function () use ($pdo, $cycleId, $category, $closesOn): void {
        rewards_notify_nomination_audience(
            $pdo,
            'Nominations are open: ' . $category,
            sprintf(
                'Nominations for %s are open until %s. Submit your nominations under Rewards & Recognition.',
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
    rewards_require_cycle_manager($user);

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

    /* Moving a cycle into a month that already has this award is the same clash as creating one there. */
    rewards_assert_month_available($pdo, $category, $opensOn, $cycleId);

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
 * Every approved nominee, most employee votes first. Only approved nominees are in the running —
 * nothing is on the scoreboard until HR approves it — and every one of them is listed, at zero votes
 * if need be, since an approval is what puts somebody on the ballot.
 *
 * Grouped on the nominee's id alone. Every nomination snapshots the name it was filed under, so one
 * employee can hold two spellings in the same cycle — a middle initial added to the directory between
 * two nominations is enough — and grouping on the name as well would split them into two entries,
 * halving their votes and inventing a tie. The name is only a label; `MAX()` picks one deterministically,
 * and the certificate re-reads it from the directory anyway.
 *
 * The orderings after the votes are there so the result is deterministic rather than meaningful: the
 * top row is only ever certified when it stands alone (see `rewards_leading_tie()`).
 */
function rewards_cycle_standings(PDO $pdo, array $cycle): array
{
    $cycleId = (int)($cycle['id'] ?? 0);

    // Two placeholders for the one id: with emulated prepares off, a named placeholder cannot repeat.
    $statement = $pdo->prepare(
        'SELECT
            nominee.nominee_employee_id AS employeeRecordId,
            nominee.nomineeName,
            COUNT(ballot.id) AS votes
         FROM (
            SELECT nominee_employee_id, MAX(nominee_name) AS nomineeName, MIN(created_at) AS firstNominatedAt
            FROM reward_cycle_votes
            WHERE cycle_id = :nominations_cycle_id
              AND status = "approved"
            GROUP BY nominee_employee_id
         ) nominee
         LEFT JOIN reward_employee_votes ballot
            ON ballot.cycle_id = :ballots_cycle_id
           AND ballot.nominee_employee_id = nominee.nominee_employee_id
         GROUP BY nominee.nominee_employee_id, nominee.nomineeName, nominee.firstNominatedAt
         ORDER BY votes DESC, nominee.firstNominatedAt ASC, nominee.nominee_employee_id ASC'
    );
    $statement->execute([':nominations_cycle_id' => $cycleId, ':ballots_cycle_id' => $cycleId]);

    return $statement->fetchAll();
}

/**
 * The nominees sharing the most votes, but only when more than one does.
 *
 * A cycle closed on a tie has no Best Employee to name — the podium would have to pick one of them
 * arbitrarily and the result would be a lie. So a tie blocks the close until more votes break it.
 * Nobody having a vote at all is not a tie; it is simply no winner.
 */
function rewards_leading_tie(PDO $pdo, array $cycle): array
{
    $voted = array_values(array_filter(
        rewards_cycle_standings($pdo, $cycle),
        static fn (array $row): bool => (int)$row['votes'] > 0
    ));

    if (count($voted) < 2) {
        return [];
    }

    $topVotes = (int)$voted[0]['votes'];
    $tied = array_values(array_filter($voted, static fn (array $row): bool => (int)$row['votes'] === $topVotes));

    return count($tied) > 1 ? $tied : [];
}

/** The nominee to certify: the top of the standings, once anybody has a vote. A tie never gets this far. */
function rewards_cycle_winner(PDO $pdo, array $cycle): ?array
{
    $leader = rewards_cycle_standings($pdo, $cycle)[0] ?? null;

    return $leader !== null && (int)$leader['votes'] > 0 ? $leader : null;
}

/** "Ana Cruz and Ben Reyes", "Ana Cruz, Ben Reyes and Cy Lim" — the nominees a tie is between. */
function rewards_tied_names(array $tied): string
{
    $names = array_column($tied, 'nomineeName');
    $last = array_pop($names);

    return $names === [] ? (string)$last : implode(', ', $names) . ' and ' . $last;
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
    $winner = rewards_cycle_winner($pdo, $cycle);

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
            'Voting for %s has closed and your colleagues chose you with %s. Certificate %s is ready to view and download under My Rewards.',
            $awardTitle,
            rewards_vote_label($votes),
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
 * Reopening nominations un-decides the result, so the certificate goes with it. Leaving it in place
 * would hand somebody a printable award for a cycle that can still turn against them.
 */
function rewards_revoke_certificate(
    PDO $pdo,
    array $user,
    int $cycleId,
    string $summary = 'An award certificate was revoked when nominations reopened.'
): void {
    $lookup = $pdo->prepare('SELECT certificate_number, employee_name FROM reward_certificates WHERE cycle_id = :cycle_id LIMIT 1');
    $lookup->execute([':cycle_id' => $cycleId]);
    $existing = $lookup->fetch();

    if (!$existing) {
        return;
    }

    $statement = $pdo->prepare('DELETE FROM reward_certificates WHERE cycle_id = :cycle_id');
    $statement->execute([':cycle_id' => $cycleId]);

    write_auth_audit($pdo, $user, 'rewards.certificate_revoked', $summary, [
        'cycleId' => $cycleId,
        'certificateNumber' => $existing['certificate_number'] ?? null,
        'employeeName' => $existing['employee_name'] ?? null,
    ]);
}

function rewards_certificate_select(): string
{
    return 'SELECT
            c.id,
            c.cycle_id AS cycleId,
            c.employee_record_id AS employeeRecordId,
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
         FROM reward_certificates c';
}

/**
 * The certificate each closed cycle issued, keyed by cycle — what the winners tally opens from the
 * podium. A cycle closed on a tie or with nothing approved has none.
 */
function rewards_certificates_by_cycle(PDO $pdo): array
{
    $byCycle = [];

    foreach ($pdo->query(rewards_certificate_select())->fetchAll() as $row) {
        $byCycle[(int)$row['cycleId']] = rewards_format_certificate($row);
    }

    return $byCycle;
}

function rewards_format_certificate(array $row): array
{
    $template = json_decode((string)($row['certificateTemplate'] ?? ''), true);

    return [
        'id' => (string)$row['id'],
        'cycleId' => (string)$row['cycleId'],
        'employeeRecordId' => (string)($row['employeeRecordId'] ?? ''),
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
 * "My Rewards": the certificates belonging to the signed-in user, and nobody else's.
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
        rewards_certificate_select() . '
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
 * A cycle closes when its period ends — nominations and voting together — whether or not anybody
 * presses Close cycle.
 *
 * The automatic twin of `rewards_set_status()`, and it follows the same rules: the status flips, the
 * winner's certificate is minted, and the winner is told. Like the closing reminder it rides on the
 * request that lists the cycles rather than on a scheduler, and claims each cycle with a conditional
 * UPDATE so two requests arriving together cannot both close it. The WHERE clause is
 * `rewards_period_has_ended()` in SQL; the two must agree.
 *
 * A tie is the one place the two paths differ. The manual close refuses and waits for the tie to be
 * broken; a deadline cannot wait, so the cycle shuts with no certificate issued and the HR Head is
 * told there is a tie to resolve, by reopening the cycle.
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

        write_auth_audit($pdo, $system, 'rewards.cycle_auto_closed', 'Nominations and voting closed automatically at the end of the nomination period.', [
            'cycleId' => $cycleId,
            'category' => $cycle['category'] ?? null,
            'closesOn' => $cycle['closesOn'] ?? null,
        ]);

        $tied = rewards_leading_tie($pdo, $cycle);

        if ($tied !== []) {
            /* Reopening is an instruction only the HR Head can carry out. */
            notify_roles(
                $pdo,
                ['hrhead'],
                'Tied result: ' . ($cycle['category'] ?? 'award nomination'),
                sprintf(
                    'Voting for %s closed on %s with %s tied at %s, so no certificate was issued. Reopen the cycle so the employees who have not voted yet can break the tie.',
                    $cycle['category'] ?? 'this nomination',
                    rewards_period_label($cycle['closesOn'] ?? null),
                    rewards_tied_names($tied),
                    rewards_vote_label((int)$tied[0]['votes'])
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
    rewards_require_cycle_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    $status = rewards_text($body['status'] ?? '') === 'closed' ? 'closed' : 'ongoing';

    if ($status === 'closed') {
        $tied = rewards_leading_tie($pdo, $cycle);

        if ($tied !== []) {
            json_response([
                'success' => false,
                'message' => sprintf(
                    'The tally is tied — %s each have %s. One nominee must be ahead before the cycle can close.',
                    rewards_tied_names($tied),
                    rewards_vote_label((int)$tied[0]['votes'])
                ),
                'tiedNominees' => array_column($tied, 'nomineeName'),
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
        // Reopened into whichever phase the clock now puts it in; reopened past the deadline, that is voting.
        $message = rewards_cycle_phase(rewards_require_cycle($pdo, $cycleId)) === 'voting'
            ? 'Voting is open again.'
            : 'The nomination is open for submissions and voting again.';
    } elseif ($certificate === null) {
        $message = 'The nomination is now closed. No approved nominee received a vote, so no certificate was issued.';
    } elseif ($certificate['isNew']) {
        $message = sprintf(
            'The nomination is now closed. Certificate %s was issued to %s and they have been notified.',
            $certificate['certificateNumber'],
            $certificate['employeeName']
        );
    } else {
        $message = sprintf('The nomination is now closed. %s already holds certificate %s.', $certificate['employeeName'], $certificate['certificateNumber']);
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
    rewards_require_cycle_manager($user);

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
    rewards_require_cycle_manager($user);

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

/**
 * A Chief puts one colleague forward, with the reason they deserve the award. The nomination waits
 * for the HR Head's review and only counts toward the award once it is approved.
 *
 * One nomination per colleague per Chief per cycle — the unique key on `reward_cycle_votes` holds
 * that even against a double-submit — but a Chief may nominate as many colleagues as they like.
 */
function rewards_submit_nomination(PDO $pdo, array $user): void
{
    rewards_require_voter($user);

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
     * Nominations end at their deadline whether or not anything has looked at the cycle since, and
     * a cycle with a vote to follow keeps the status "ongoing" while it moves on to voting. Checked
     * here too, or a tab left open on the form could file a nomination after its period had ended.
     */
    if (rewards_nominations_have_ended($cycle)) {
        json_response([
            'success' => false,
            'message' => 'Nominations closed on ' . rewards_period_label($cycle['closesOn'] ?? null) . '.',
        ], 409);
    }

    $voterUserId = (int)($user['id'] ?? 0);
    if ($voterUserId <= 0) {
        json_response(['success' => false, 'message' => 'Your account could not be identified.'], 403);
    }

    $nomineeId = (int)($body['nomineeKey'] ?? $body['nominee_employee_id'] ?? 0);
    if ($nomineeId <= 0) {
        json_response(['success' => false, 'message' => 'Choose the employee you are nominating.'], 422);
    }

    $reason = rewards_text($body['reason'] ?? '');
    if (mb_strlen($reason) < REWARDS_NOMINATION_REASON_MIN) {
        json_response([
            'success' => false,
            'message' => sprintf('Give a reason of at least %d characters.', REWARDS_NOMINATION_REASON_MIN),
        ], 422);
    }

    if (mb_strlen($reason) > REWARDS_NOMINATION_REASON_MAX) {
        json_response([
            'success' => false,
            'message' => sprintf('Keep the reason to %s characters or fewer.', number_format(REWARDS_NOMINATION_REASON_MAX)),
        ], 422);
    }

    $voterEmployeeRecordId = session_employee_record_id($pdo, $user);
    if ($voterEmployeeRecordId !== null && $voterEmployeeRecordId === $nomineeId) {
        json_response(['success' => false, 'message' => 'You cannot nominate yourself.'], 422);
    }

    $employee = $pdo->prepare(
        'SELECT id, first_name, middle_name, last_name, division_id FROM employees WHERE id = :id AND is_archived = 0 LIMIT 1'
    );
    $employee->execute([':id' => $nomineeId]);
    $nominee = $employee->fetch();

    if (!$nominee) {
        json_response(['success' => false, 'message' => 'That employee is no longer in the directory.'], 422);
    }

    /*
     * A Chief nominates from their own division only. The list the Chief's screen offers is drawn
     * the same way (ChiefNominationWorkspace in page/Chief/chiefdashboard.jsx); this is what holds
     * when the request did not come from that screen. A Chief whose employee record sits in no
     * division has nobody to nominate.
     */
    $voterDivisionId = rewards_voter_division_id($pdo, $voterEmployeeRecordId);
    if ($voterDivisionId <= 0 || (int)($nominee['division_id'] ?? 0) !== $voterDivisionId) {
        json_response(['success' => false, 'message' => 'You can only nominate employees from your own division.'], 422);
    }

    $nomineeName = full_name_from_row($nominee);
    $voterName = full_name_from_row($user) ?: rewards_text($user['username'] ?? '');

    $insert = $pdo->prepare(
        'INSERT INTO reward_cycle_votes
            (cycle_id, voter_user_id, voter_name, nominee_employee_id, nominee_name, reason, status)
         VALUES
            (:cycle_id, :voter_user_id, :voter_name, :nominee_employee_id, :nominee_name, :reason, "submitted")'
    );

    try {
        $insert->execute([
            ':cycle_id' => $cycleId,
            ':voter_user_id' => $voterUserId,
            ':voter_name' => $voterName,
            ':nominee_employee_id' => $nomineeId,
            ':nominee_name' => $nomineeName,
            ':reason' => $reason,
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() !== '23000') {
            throw $exception;
        }

        json_response([
            'success' => false,
            'message' => sprintf('You have already nominated %s for this award.', $nomineeName),
        ], 409);
    }

    $nominationId = (int)$pdo->lastInsertId();
    $category = rewards_text($cycle['category'] ?? '') ?: 'the award';

    write_auth_audit($pdo, $user, 'rewards.nomination_submitted', 'A nomination was submitted for review.', [
        'cycleId' => $cycleId,
        'nominationId' => $nominationId,
        'nomineeEmployeeId' => $nomineeId,
    ]);

    /* The review queue is the HR Head's; deferred so the Chief does not wait on the inserts. */
    defer(static function () use ($pdo, $cycleId, $category, $voterName, $nomineeName): void {
        notify_roles(
            $pdo,
            ['hrhead'],
            'Nomination to review: ' . $category,
            sprintf('%s nominated %s for %s. Review it under Rewards & Recognition.', $voterName, $nomineeName, $category),
            'award_nomination_submitted',
            (string)$cycleId
        );
    });

    json_response([
        'success' => true,
        'message' => sprintf('Your nomination of %s has been submitted for HR review.', $nomineeName),
        'nominationId' => (string)$nominationId,
    ], 201);
}

/**
 * The HR Head's decision on one nomination, with an optional note shown back to the Chief who filed
 * it. A nomination is reviewed once: approving or rejecting it takes it out of the pending queue.
 */
function rewards_review_nomination(PDO $pdo, array $user): void
{
    rewards_require_cycle_manager($user);

    $body = rewards_request_body();
    $nominationId = (int)($body['nominationId'] ?? $body['nomination_id'] ?? 0);
    $status = rewards_text($body['status'] ?? '');
    $note = rewards_text($body['reviewerNote'] ?? $body['reviewer_note'] ?? '');

    if (!in_array($status, ['approved', 'rejected'], true)) {
        json_response(['success' => false, 'message' => 'Choose whether to approve or reject the nomination.'], 422);
    }

    if (mb_strlen($note) > REWARDS_REVIEWER_NOTE_MAX) {
        json_response([
            'success' => false,
            'message' => sprintf('Keep the reviewer note to %d characters or fewer.', REWARDS_REVIEWER_NOTE_MAX),
        ], 422);
    }

    $lookup = $pdo->prepare(
        'SELECT id, cycle_id, voter_user_id, nominee_employee_id, nominee_name, status
         FROM reward_cycle_votes
         WHERE id = :id
         LIMIT 1'
    );
    $lookup->execute([':id' => $nominationId]);
    $nomination = $nominationId > 0 ? $lookup->fetch() : false;

    if (!$nomination) {
        json_response(['success' => false, 'message' => 'Nomination not found.'], 404);
    }

    $cycle = rewards_require_cycle($pdo, (int)$nomination['cycle_id']);

    if ((int)($cycle['isArchived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'That nomination has been archived.'], 409);
    }

    $alreadyReviewed = ['success' => false, 'message' => 'This nomination has already been reviewed.'];

    if (($nomination['status'] ?? '') !== 'submitted') {
        json_response($alreadyReviewed, 409);
    }

    // Conditional on the status so two reviewers deciding at once cannot both win.
    $update = $pdo->prepare(
        'UPDATE reward_cycle_votes
         SET status = :status,
             reviewer_note = :reviewer_note,
             reviewed_at = NOW(),
             reviewed_by_user_id = :reviewed_by_user_id,
             reviewed_by_name = :reviewed_by_name
         WHERE id = :id AND status = "submitted"'
    );
    $update->execute([
        ':status' => $status,
        ':reviewer_note' => $note !== '' ? $note : null,
        ':reviewed_by_user_id' => (int)($user['id'] ?? 0) ?: null,
        ':reviewed_by_name' => full_name_from_row($user) ?: rewards_text($user['username'] ?? ''),
        ':id' => $nominationId,
    ]);

    if ($update->rowCount() === 0) {
        json_response($alreadyReviewed, 409);
    }

    write_auth_audit($pdo, $user, 'rewards.nomination_reviewed', 'A nomination was ' . $status . '.', [
        'cycleId' => (int)$nomination['cycle_id'],
        'nominationId' => $nominationId,
        'status' => $status,
    ]);

    $category = rewards_text($cycle['category'] ?? '') ?: 'the award';
    $nomineeName = rewards_text($nomination['nominee_name'] ?? '') ?: 'the employee';

    // An approval puts the nominee on the ballot there and then — unless the cycle has already closed,
    // where nobody can vote for them any more and so the result they missed cannot change.
    $onBallot = $status === 'approved' && rewards_cycle_phase($cycle) !== 'closed';

    if ($onBallot) {
        // The first approval is what opens a cycle's vote, so the employees hear about it now rather
        // than on whichever request happens to list the cycles next.
        defer(static fn () => rewards_send_due_voting_notices($pdo));
    }

    defer(static fn () => notify_users(
        $pdo,
        [(int)$nomination['voter_user_id']],
        ($status === 'approved' ? 'Nomination approved: ' : 'Nomination rejected: ') . $category,
        sprintf(
            'Your nomination of %s for %s was %s by HR.%s%s',
            $nomineeName,
            $category,
            $status,
            $onBallot ? ' They are now on the ballot, and the employees can vote for them.' : '',
            $note !== '' ? ' Note: ' . $note : ''
        ),
        'award_nomination_reviewed',
        (string)$nomination['cycle_id']
    ));

    json_response([
        'success' => true,
        'message' => sprintf(
            "%s's nomination has been %s.",
            $nomineeName,
            $status
        ),
    ]);
}

/**
 * An employee's vote: one approved nominee per cycle, cast any time before the cycle closes — a
 * nominee is on the ballot from the moment HR approves them.
 *
 * Voting again before the cycle closes changes the vote rather than adding a second one — the unique
 * key on (cycle, voter) holds that even against a double-submit — so each person counts once however
 * often they change their mind, and a nominee approved after somebody voted can still win them over.
 * The ballot is secret: the audit trail records that somebody voted, never whom they chose, and nobody
 * but the voter is ever shown their choice.
 */
function rewards_cast_vote(PDO $pdo, array $user): void
{
    if (!rewards_can_cast_vote($user)) {
        json_response(['success' => false, 'message' => 'Only employees can vote on award nominees.'], 403);
    }

    $body = rewards_request_body();
    $cycle = rewards_require_cycle($pdo, (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0));
    $cycleId = (int)$cycle['id'];

    // Archived cycles are off the list, but a stale tab could still post to one.
    if ((int)($cycle['isArchived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'That award has been archived.'], 409);
    }

    if (rewards_cycle_phase($cycle) === 'closed') {
        json_response(['success' => false, 'message' => 'Voting has closed for this award.'], 409);
    }

    $voterUserId = (int)($user['id'] ?? 0);
    if ($voterUserId <= 0) {
        json_response(['success' => false, 'message' => 'Your account could not be identified.'], 403);
    }

    $nomineeId = (int)($body['nomineeKey'] ?? $body['nominee_employee_id'] ?? 0);
    if ($nomineeId <= 0) {
        json_response(['success' => false, 'message' => 'Choose the nominee you are voting for.'], 422);
    }

    $voterEmployeeRecordId = session_employee_record_id($pdo, $user);
    if ($voterEmployeeRecordId !== null && $voterEmployeeRecordId === $nomineeId) {
        json_response(['success' => false, 'message' => 'You cannot vote for yourself.'], 422);
    }

    // The ballot is the nominees HR approved and nobody else, whoever the request names.
    $ballot = $pdo->prepare(
        'SELECT MAX(nominee_name)
         FROM reward_cycle_votes
         WHERE cycle_id = :cycle_id
           AND nominee_employee_id = :nominee_employee_id
           AND status = "approved"'
    );
    $ballot->execute([':cycle_id' => $cycleId, ':nominee_employee_id' => $nomineeId]);
    $nomineeName = rewards_text($ballot->fetchColumn());

    if ($nomineeName === '') {
        json_response(['success' => false, 'message' => 'That employee is not on the ballot for this award.'], 422);
    }

    $previous = $pdo->prepare(
        'SELECT nominee_employee_id FROM reward_employee_votes WHERE cycle_id = :cycle_id AND voter_user_id = :voter_user_id LIMIT 1'
    );
    $previous->execute([':cycle_id' => $cycleId, ':voter_user_id' => $voterUserId]);
    $previousNomineeId = (int)$previous->fetchColumn();

    /*
     * Names nobody, unlike the two messages below: nothing is written on this path, so the automatic
     * activity audit records this response's message, and a name here would put the choice in the log.
     */
    if ($previousNomineeId === $nomineeId) {
        json_response(['success' => true, 'message' => 'That nominee already has your vote.']);
    }

    $pdo->prepare(
        'INSERT INTO reward_employee_votes (cycle_id, voter_user_id, nominee_employee_id)
         VALUES (:cycle_id, :voter_user_id, :nominee_employee_id)
         ON DUPLICATE KEY UPDATE nominee_employee_id = VALUES(nominee_employee_id)'
    )->execute([
        ':cycle_id' => $cycleId,
        ':voter_user_id' => $voterUserId,
        ':nominee_employee_id' => $nomineeId,
    ]);

    $changed = $previousNomineeId > 0;

    write_auth_audit(
        $pdo,
        $user,
        $changed ? 'rewards.vote_changed' : 'rewards.vote_cast',
        $changed ? 'An award vote was changed.' : 'An award vote was cast.',
        ['cycleId' => $cycleId]
    );

    json_response([
        'success' => true,
        'message' => $changed
            ? sprintf('Your vote has been changed to %s.', $nomineeName)
            : sprintf('Your vote for %s has been recorded.', $nomineeName),
    ], $changed ? 200 : 201);
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

    if ($method === 'POST' && $action === 'nominate') {
        rewards_submit_nomination($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'vote') {
        rewards_cast_vote($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'certificate-template') {
        rewards_create_certificate_template($pdo, $sessionUser);
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

    if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'review') {
        rewards_review_nomination($pdo, $sessionUser);
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

    if ($method === 'DELETE' && $action === 'certificate-template') {
        rewards_delete_certificate_template($pdo, $sessionUser);
    }

    json_response(['success' => false, 'message' => 'Unsupported rewards action.'], 405);
} catch (Throwable $exception) {
    error_log('Rewards API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process rewards request.',
    ], 500);
}
