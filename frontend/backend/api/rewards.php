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
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_reward_cycles_status (status),
            CONSTRAINT fk_reward_cycles_user
                FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

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
            c.created_at AS createdAt
        FROM reward_cycles c';
}

function rewards_list_cycles(PDO $pdo, array $user): void
{
    $statement = $pdo->query(rewards_cycle_select() . ' ORDER BY c.created_at DESC, c.id DESC');
    $nominations = rewards_nominations_by_cycle($pdo);

    $cycles = array_map(
        static fn (array $row): array => rewards_format_cycle($row, $nominations[(int)$row['id']] ?? []),
        $statement->fetchAll()
    );

    json_response([
        'success' => true,
        'cycles' => $cycles,
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

function rewards_set_status(PDO $pdo, array $user): void
{
    rewards_require_manager($user);

    $body = rewards_request_body();
    $cycleId = (int)($body['cycleId'] ?? $body['cycle_id'] ?? 0);
    rewards_require_cycle($pdo, $cycleId);

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

    json_response([
        'success' => true,
        'message' => $status === 'closed' ? 'Voting is now closed.' : 'Voting has been reopened.',
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
