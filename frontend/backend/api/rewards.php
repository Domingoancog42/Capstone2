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
    return in_array(hris_user_role_key($user), ['admin', 'hrhead', 'hrstaff'], true);
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
    $text = rewards_text($value);
    if ($text === '') {
        return null;
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $text);

    return $date && $date->format('Y-m-d') === $text ? $text : null;
}

function ensure_rewards_tables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS reward_cycles (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            category VARCHAR(120) NOT NULL,
            description TEXT NULL,
            opens_on DATE NULL,
            closes_on DATE NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'ongoing',
            created_by_user_id INT UNSIGNED NULL,
            created_by_name VARCHAR(180) NULL,
            is_archived TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_reward_cycles_status (status),
            KEY idx_reward_cycles_archived (is_archived),
            CONSTRAINT fk_reward_cycles_user
                FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    /*
     * `CREATE TABLE IF NOT EXISTS` above does nothing on an install that already has the table, so
     * the archive column is added separately for those. Cheap enough to check on every request.
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
     * The unique key is what makes "one vote per person" true. Leaving it to the UI would let a
     * double-submit or a second tab stuff the ballot, and the tally would have no way to tell.
     *
     * Named `reward_cycle_votes`, not `reward_nominations`: a `reward_nominations` table already
     * exists from the retired certificate module and holds an unrelated shape. `CREATE TABLE IF NOT
     * EXISTS` would have quietly left it alone and every query here would have run against it.
     */
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS reward_cycle_votes (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            cycle_id INT UNSIGNED NOT NULL,
            voter_user_id INT UNSIGNED NOT NULL,
            voter_name VARCHAR(180) NULL,
            nominee_employee_id INT UNSIGNED NOT NULL,
            nominee_name VARCHAR(180) NOT NULL,
            reason TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_reward_cycle_vote_voter (cycle_id, voter_user_id),
            KEY idx_reward_cycle_votes_nominee (nominee_employee_id),
            CONSTRAINT fk_reward_cycle_votes_cycle
                FOREIGN KEY (cycle_id) REFERENCES reward_cycles(id)
                ON DELETE CASCADE,
            CONSTRAINT fk_reward_cycle_votes_voter
                FOREIGN KEY (voter_user_id) REFERENCES users(id)
                ON DELETE CASCADE,
            CONSTRAINT fk_reward_cycle_votes_employee
                FOREIGN KEY (nominee_employee_id) REFERENCES employees(id)
                ON DELETE CASCADE
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
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS reward_certificates (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            cycle_id INT UNSIGNED NOT NULL,
            employee_record_id INT UNSIGNED NOT NULL,
            certificate_number VARCHAR(40) NOT NULL,
            award_title VARCHAR(120) NOT NULL,
            employee_name VARCHAR(200) NOT NULL,
            employee_code VARCHAR(50) NULL,
            division_name VARCHAR(180) NULL,
            designation_title VARCHAR(180) NULL,
            votes INT UNSIGNED NOT NULL DEFAULT 0,
            period_start DATE NULL,
            period_end DATE NULL,
            awarded_on DATE NOT NULL,
            signatory_name VARCHAR(200) NULL,
            signatory_title VARCHAR(180) NULL,
            issued_by_user_id INT UNSIGNED NULL,
            issued_by_name VARCHAR(180) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_reward_certificates_cycle (cycle_id),
            UNIQUE KEY uniq_reward_certificates_number (certificate_number),
            KEY idx_reward_certificates_employee (employee_record_id),
            CONSTRAINT fk_reward_certificates_cycle
                FOREIGN KEY (cycle_id) REFERENCES reward_cycles(id)
                ON DELETE CASCADE,
            CONSTRAINT fk_reward_certificates_employee
                FOREIGN KEY (employee_record_id) REFERENCES employees(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    /*
     * One counter per year behind the certificate number. The table predates this module — the
     * retired certificate module left it behind empty — and is reused rather than duplicated so a
     * number can never be issued twice for the same year.
     */
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS reward_certificate_sequence (
            award_year SMALLINT UNSIGNED NOT NULL,
            last_number INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (award_year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function rewards_nominations_by_cycle(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT
            n.id,
            n.cycle_id AS cycleId,
            n.voter_user_id AS voterUserId,
            n.voter_name AS voterName,
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

    $statement = $pdo->prepare(
        rewards_cycle_select() . ' WHERE c.is_archived = :is_archived ORDER BY c.created_at DESC, c.id DESC'
    );
    $statement->execute([':is_archived' => $archived ? 1 : 0]);
    $nominations = rewards_nominations_by_cycle($pdo);

    $cycles = array_map(
        static fn (array $row): array => rewards_format_cycle($row, $nominations[(int)$row['id']] ?? []),
        $statement->fetchAll()
    );

    json_response([
        'success' => true,
        'cycles' => $cycles,
        'archived' => $archived,
        // Lets the Archived button carry a count without the client fetching the other view first.
        'archivedCount' => (int)$pdo->query('SELECT COUNT(*) FROM reward_cycles WHERE is_archived = 1')->fetchColumn(),
        // The client compares this against each nomination's `voterKey` to find its own vote,
        // rather than guessing which id field on the session user is the right one.
        'viewerKey' => (string)($user['id'] ?? ''),
        'canManage' => rewards_can_manage($user),
    ]);
}

function rewards_require_cycle(PDO $pdo, int $cycleId): array
{
    if ($cycleId <= 0) {
        json_response(['success' => false, 'message' => 'Award cycle is required.'], 422);
    }

    $statement = $pdo->prepare(rewards_cycle_select() . ' WHERE c.id = :id LIMIT 1');
    $statement->execute([':id' => $cycleId]);
    $row = $statement->fetch();

    if (!$row) {
        json_response(['success' => false, 'message' => 'Award cycle not found.'], 404);
    }

    return $row;
}

function rewards_require_manager(array $user): void
{
    if (!rewards_can_manage($user)) {
        json_response(['success' => false, 'message' => 'You are not allowed to manage award cycles.'], 403);
    }
}

function rewards_create_cycle(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $category = rewards_text($body['category'] ?? '');
    $description = rewards_text($body['description'] ?? '');
    $opensOn = rewards_date_or_null($body['opensOn'] ?? $body['opens_on'] ?? null);
    $closesOn = rewards_date_or_null($body['closesOn'] ?? $body['closes_on'] ?? null);

    if ($category === '') {
        json_response(['success' => false, 'message' => 'Award category is required.'], 422);
    }

    if ($opensOn === null || $closesOn === null) {
        json_response(['success' => false, 'message' => 'Set both the opening and closing dates before saving.'], 422);
    }

    if ($closesOn < $opensOn) {
        json_response(['success' => false, 'message' => 'The closing date cannot come before the opening date.'], 422);
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
        ':created_by_name' => hris_full_name_from_row($user) ?: rewards_text($user['username'] ?? ''),
    ]);

    write_auth_audit($pdo, $user, 'rewards.cycle_created', 'An award cycle was created.', [
        'cycleId' => (int)$pdo->lastInsertId(),
        'category' => $category,
    ]);

    json_response(['success' => true, 'message' => 'Award cycle created.'], 201);
}

function rewards_update_cycle(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    rewards_require_cycle($pdo, $cycleId);

    $category = rewards_text($body['category'] ?? '');
    $description = rewards_text($body['description'] ?? '');
    $opensOn = rewards_date_or_null($body['opensOn'] ?? $body['opens_on'] ?? null);
    $closesOn = rewards_date_or_null($body['closesOn'] ?? $body['closes_on'] ?? null);

    if ($category === '') {
        json_response(['success' => false, 'message' => 'Award category is required.'], 422);
    }

    if ($opensOn === null || $closesOn === null) {
        json_response(['success' => false, 'message' => 'Set both the opening and closing dates before saving.'], 422);
    }

    if ($closesOn < $opensOn) {
        json_response(['success' => false, 'message' => 'The closing date cannot come before the opening date.'], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE reward_cycles
         SET category = :category,
             description = :description,
             opens_on = :opens_on,
             closes_on = :closes_on
         WHERE id = :id'
    );
    $statement->execute([
        ':category' => $category,
        ':description' => $description !== '' ? $description : null,
        ':opens_on' => $opensOn,
        ':closes_on' => $closesOn,
        ':id' => $cycleId,
    ]);

    json_response(['success' => true, 'message' => 'Award cycle updated.']);
}

/**
 * The nominees sharing the top vote count, but only when more than one does.
 *
 * A cycle closed on a tie has no Best Employee to name — the podium would have to pick one of them
 * arbitrarily and the result would be a lie. So a tie blocks the close until a vote breaks it.
 */
function rewards_leading_tie(PDO $pdo, int $cycleId): array
{
    $statement = $pdo->prepare(
        'SELECT nominee_name AS name, COUNT(*) AS votes
         FROM reward_cycle_votes
         WHERE cycle_id = :cycle_id
         GROUP BY nominee_employee_id, nominee_name
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
    $statement = $pdo->prepare(
        'SELECT
            v.nominee_employee_id AS employeeRecordId,
            v.nominee_name AS nomineeName,
            COUNT(*) AS votes
         FROM reward_cycle_votes v
         WHERE v.cycle_id = :cycle_id
         GROUP BY v.nominee_employee_id, v.nominee_name
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
 * join back to `employees` on email — the same link `hris_user_id_for_employee_record` uses.
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
        $signatory['name'] = hris_full_name_from_row($row);
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
    $employeeName = $employee ? hris_full_name_from_row($employee) : rewards_text($winner['nomineeName']);
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

    $statement = $pdo->prepare(
        'INSERT INTO reward_certificates
            (cycle_id, employee_record_id, certificate_number, award_title, employee_name, employee_code,
             division_name, designation_title, votes, period_start, period_end, awarded_on,
             signatory_name, signatory_title, issued_by_user_id, issued_by_name)
         VALUES
            (:cycle_id, :employee_record_id, :certificate_number, :award_title, :employee_name, :employee_code,
             :division_name, :designation_title, :votes, :period_start, :period_end, :awarded_on,
             :signatory_name, :signatory_title, :issued_by_user_id, :issued_by_name)
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
        ':issued_by_user_id' => (int)($user['id'] ?? 0) ?: null,
        ':issued_by_name' => hris_full_name_from_row($user) ?: rewards_text($user['username'] ?? ''),
    ]);

    hris_ensure_notifications_table($pdo);
    hris_notify_employee(
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
    $employee = hris_find_employee_for_user($pdo, $user);
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

    $statement = $pdo->prepare('UPDATE reward_cycles SET status = :status WHERE id = :id');
    $statement->execute([':status' => $status, ':id' => $cycleId]);

    write_auth_audit($pdo, $user, 'rewards.cycle_status_changed', 'An award cycle status was changed.', [
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
            'message' => $archived ? 'That award cycle is already archived.' : 'That award cycle is not archived.',
        ], 409);
    }

    $statement = $pdo->prepare('UPDATE reward_cycles SET is_archived = :is_archived WHERE id = :id');
    $statement->execute([':is_archived' => $archived ? 1 : 0, ':id' => $cycleId]);

    write_auth_audit(
        $pdo,
        $user,
        $archived ? 'rewards.cycle_archived' : 'rewards.cycle_restored',
        $archived ? 'An award cycle was archived.' : 'An award cycle was restored from the archive.',
        [
            'cycleId' => $cycleId,
            'category' => $cycle['category'] ?? null,
        ]
    );

    json_response([
        'success' => true,
        'message' => $archived ? 'Award cycle archived.' : 'Award cycle restored.',
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

    write_auth_audit($pdo, $user, 'rewards.cycle_deleted', 'An award cycle was deleted.', [
        'cycleId' => $cycleId,
        'category' => $cycle['category'] ?? null,
    ]);

    json_response(['success' => true, 'message' => 'Award cycle deleted.']);
}

function rewards_cast_vote(PDO $pdo, array $user): void
{
    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    // Archived cycles are off the list, but a stale tab could still post to one.
    if ((int)($cycle['isArchived'] ?? 0) === 1) {
        json_response(['success' => false, 'message' => 'That award cycle has been archived.'], 409);
    }

    if (($cycle['status'] ?? 'ongoing') === 'closed') {
        json_response(['success' => false, 'message' => 'Voting is closed for this cycle.'], 409);
    }

    $voterUserId = (int)($user['id'] ?? 0);
    if ($voterUserId <= 0) {
        json_response(['success' => false, 'message' => 'Your account could not be identified.'], 403);
    }

    $nomineeId = (int)($body['nomineeKey'] ?? $body['nominee_employee_id'] ?? 0);
    if ($nomineeId <= 0) {
        json_response(['success' => false, 'message' => 'Pick who you are nominating.'], 422);
    }

    $employee = $pdo->prepare('SELECT id, first_name, middle_name, last_name FROM employees WHERE id = :id LIMIT 1');
    $employee->execute([':id' => $nomineeId]);
    $nominee = $employee->fetch();

    if (!$nominee) {
        json_response(['success' => false, 'message' => 'That employee is no longer in the directory.'], 422);
    }

    $reason = rewards_text($body['reason'] ?? '');

    /*
     * Upsert against the unique (cycle_id, voter_user_id) key: recasting a vote replaces it rather
     * than stacking a second one, and two racing submissions collapse to one row instead of erroring.
     */
    $statement = $pdo->prepare(
        'INSERT INTO reward_cycle_votes
            (cycle_id, voter_user_id, voter_name, nominee_employee_id, nominee_name, reason)
         VALUES
            (:cycle_id, :voter_user_id, :voter_name, :nominee_employee_id, :nominee_name, :reason)
         ON DUPLICATE KEY UPDATE
            nominee_employee_id = VALUES(nominee_employee_id),
            nominee_name = VALUES(nominee_name),
            reason = VALUES(reason)'
    );
    $statement->execute([
        ':cycle_id' => $cycleId,
        ':voter_user_id' => $voterUserId,
        ':voter_name' => hris_full_name_from_row($user) ?: rewards_text($user['username'] ?? ''),
        ':nominee_employee_id' => $nomineeId,
        ':nominee_name' => hris_full_name_from_row($nominee),
        ':reason' => $reason !== '' ? $reason : null,
    ]);

    json_response(['success' => true, 'message' => 'Your vote has been recorded.']);
}

function rewards_withdraw_vote(PDO $pdo, array $user): void
{
    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? $_GET['cycle_id'] ?? 0);
    $cycle = rewards_require_cycle($pdo, $cycleId);

    if (($cycle['status'] ?? 'ongoing') === 'closed') {
        json_response(['success' => false, 'message' => 'Voting is closed for this cycle.'], 409);
    }

    $statement = $pdo->prepare('DELETE FROM reward_cycle_votes WHERE cycle_id = :cycle_id AND voter_user_id = :voter_user_id');
    $statement->execute([
        ':cycle_id' => $cycleId,
        ':voter_user_id' => (int)($user['id'] ?? 0),
    ]);

    json_response(['success' => true, 'message' => 'Your vote has been withdrawn.']);
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

    if ($method === 'POST' && $action === 'create') {
        rewards_create_cycle($pdo, $sessionUser);
    }

    if ($method === 'POST' && $action === 'vote') {
        rewards_cast_vote($pdo, $sessionUser);
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
