<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/audit_logs_helper.php';

$sessionUser = require_session_user();

/*
 * Rewards & Recognition.
 *
 * Nominations used to live in browser local storage, which meant an award existed only on the
 * machine that issued it. This endpoint makes them shared records with a real approval step, a
 * gapless certificate sequence, and an audit trail.
 */

/**
 * Award categories.
 *
 * `singleWinnerPerPeriod` is the rule that matters: there is one Employee of the Month per month
 * across the whole bureau, whereas any number of people can receive a Loyalty Award in the same
 * year. MySQL cannot express "unique among approved rows only", so the constraint is enforced in
 * the approval transaction below — driven by this flag rather than a hardcoded category check, so
 * adding a category does not mean rediscovering the rule.
 *
 * The certificate designs are keyed off these same slugs in the frontend, so a new category needs a
 * design there as well as an entry here.
 */
const REWARD_CATEGORIES = [
    'best_employee_month' => [
        'label' => 'Best Employee of the Month',
        'requiresPeriod' => true,
        'singleWinnerPerPeriod' => true,
        'usesYearsOfService' => false,
    ],
    'loyalty' => [
        'label' => 'Loyalty Award',
        'requiresPeriod' => false,
        'singleWinnerPerPeriod' => false,
        'usesYearsOfService' => true,
    ],
];

function rewards_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function rewards_role_key(array $user): string
{
    return hris_user_role_key($user);
}

/** Anyone who can see the module may nominate. */
function rewards_can_nominate(array $user): bool
{
    return in_array(
        rewards_role_key($user),
        ['admin', 'hrhead', 'hrstaff', 'chief', 'regionaldirector'],
        true
    );
}

/**
 * Issuing a certificate is a narrower right than recording a nomination — the document carries the
 * Regional Executive Director's name, so it is limited to the offices that answer for it.
 */
function rewards_can_decide(array $user): bool
{
    return in_array(rewards_role_key($user), ['admin', 'hrhead', 'regionaldirector'], true);
}

function rewards_require_table(PDO $pdo): void
{
    if (!hris_database_table_exists($pdo, 'reward_nominations')) {
        json_response([
            'success' => false,
            'message' => 'The rewards tables have not been created in this installation. Run backend/sql/reward_nominations.sql.',
        ], 503);
    }
}

function rewards_actor_name(array $user): string
{
    return hris_trimmed_text($user['full_name'] ?? '') ?: hris_trimmed_text($user['username'] ?? '');
}

function rewards_period_or_null(mixed $value): ?string
{
    $value = rewards_text($value);

    return preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $value) === 1 ? $value : null;
}

function rewards_format_row(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'employeeRecordId' => (int)$row['employee_record_id'],
        'employeeId' => (string)$row['employee_record_id'],
        'employeeCode' => rewards_text($row['employee_code']),
        'employeeName' => rewards_text($row['employee_name']),
        'division' => rewards_text($row['division_name']),
        'position' => rewards_text($row['designation_title']),
        'employmentType' => rewards_text($row['employment_type']),
        'category' => rewards_text($row['category']),
        'period' => rewards_text($row['award_period']),
        'yearsOfService' => $row['years_of_service'] === null ? '' : (string)$row['years_of_service'],
        'reason' => rewards_text($row['reason']),
        'nominatedBy' => rewards_text($row['nominated_by_name']),
        'nominatedByEmployeeRecordId' => $row['nominated_by_employee_id'] === null
            ? null
            : (int)$row['nominated_by_employee_id'],
        // The workspace renders these capitalised; keep the wire format matching what it expects.
        'status' => ucfirst(rewards_text($row['status']) ?: 'pending'),
        'decisionNote' => rewards_text($row['decision_note']),
        'createdAt' => $row['created_at'],
        'reviewedAt' => $row['reviewed_at'] ?? '',
        'reviewedBy' => rewards_text($row['reviewed_by_name']),
        'certificate' => $row['certificate_number']
            ? [
                'number' => rewards_text($row['certificate_number']),
                'issuedAt' => $row['certificate_issued_at'],
                'issuedBy' => rewards_text($row['reviewed_by_name']),
                'signatoryName' => rewards_text($row['signatory_name']),
                'signatoryTitle' => rewards_text($row['signatory_title']),
            ]
            : null,
    ];
}

function rewards_list(PDO $pdo): array
{
    $rows = $pdo->query(
        'SELECT * FROM reward_nominations WHERE is_archived = 0 ORDER BY created_at DESC, id DESC'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    return array_map('rewards_format_row', $rows);
}

function rewards_fetch_employee(PDO $pdo, int $employeeRecordId): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeCode,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS fullName,
            e.date_hired AS dateHired,
            e.employment_status AS employmentStatus,
            e.status,
            d.name AS divisionName,
            des.name AS designationTitle
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :employee_record_id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':employee_record_id' => $employeeRecordId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

/** Completed years since the hire date, used when a loyalty nomination does not state them. */
function rewards_years_of_service(?string $dateHired): ?int
{
    $dateHired = rewards_text($dateHired);

    if ($dateHired === '') {
        return null;
    }

    try {
        $hired = new DateTimeImmutable($dateHired);
    } catch (Throwable) {
        return null;
    }

    $years = (int)$hired->diff(new DateTimeImmutable('today'))->y;

    return $years > 0 ? $years : null;
}

/**
 * Next certificate number for the year, as `RR-2026-000042`.
 *
 * Must be called inside a transaction: the upsert takes a row lock on the year, so two approvals
 * racing cannot receive the same number.
 */
function rewards_next_certificate_number(PDO $pdo, int $year): string
{
    $upsert = $pdo->prepare(
        'INSERT INTO reward_certificate_sequence (award_year, last_number)
         VALUES (:award_year, 1)
         ON DUPLICATE KEY UPDATE last_number = last_number + 1'
    );
    $upsert->execute([':award_year' => $year]);

    $read = $pdo->prepare('SELECT last_number FROM reward_certificate_sequence WHERE award_year = :award_year');
    $read->execute([':award_year' => $year]);
    $next = (int)$read->fetchColumn();

    return sprintf('RR-%d-%06d', $year, $next);
}

function rewards_write_audit(PDO $pdo, array $sessionUser, string $action, int $nominationId, string $summary, array $details = []): void
{
    // `hris_ensure_audit_logs_table()` lives in app_settings.php, which is an endpoint and cannot be
    // included here without running it, so this checks for the table instead of creating it.
    if (!hris_database_table_exists($pdo, 'audit_logs')) {
        return;
    }

    try {
        $context = hris_audit_request_context();
        $userId = isset($sessionUser['id']) ? (int)$sessionUser['id'] : null;

        $statement = $pdo->prepare(
            'INSERT INTO audit_logs
                (user_id, action, ip_address, location, device, browser, os, actor_id, actor_name,
                 actor_role, category, entity_type, entity_id, summary, details_json, user_agent)
             VALUES
                (:user_id, :action, :ip_address, :location, :device, :browser, :os, :actor_id, :actor_name,
                 :actor_role, :category, :entity_type, :entity_id, :summary, :details_json, :user_agent)'
        );
        $statement->execute([
            ':user_id' => $userId,
            ':action' => $action,
            ':ip_address' => $context['ipAddress'],
            ':location' => $context['location'],
            ':device' => $context['device'],
            ':browser' => $context['browser'],
            ':os' => $context['os'],
            ':actor_id' => $userId,
            ':actor_name' => rewards_actor_name($sessionUser),
            ':actor_role' => $sessionUser['role'] ?? null,
            ':category' => 'rewards',
            ':entity_type' => 'reward_nomination',
            ':entity_id' => $nominationId,
            ':summary' => $summary,
            ':details_json' => hris_audit_details_json($details, $context),
            ':user_agent' => $context['userAgent'],
        ]);
    } catch (Throwable) {
        // An award must not fail to record only because optional audit logging is unavailable.
    }
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$action = strtolower(rewards_text($_GET['action'] ?? ''));
$body = [];

if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    $raw = file_get_contents('php://input') ?: '';
    $decoded = json_decode($raw, true);
    $body = is_array($decoded) ? $decoded : [];
}

rewards_require_table($pdo);

if (!rewards_can_nominate($sessionUser)) {
    json_response([
        'success' => false,
        'message' => 'You do not have access to rewards and recognition.',
    ], 403);
}

$sessionEmployeeRecordId = hris_session_employee_record_id($pdo, $sessionUser);

if ($method === 'GET') {
    json_response([
        'success' => true,
        'nominations' => rewards_list($pdo),
        'canDecide' => rewards_can_decide($sessionUser),
        'categories' => array_map(
            static fn (array $category, string $key): array => $category + ['key' => $key],
            REWARD_CATEGORIES,
            array_keys(REWARD_CATEGORIES)
        ),
    ]);
}

if ($method === 'POST' && $action === 'nominate') {
    $employeeRecordId = (int)($body['employeeRecordId'] ?? 0);
    $category = rewards_text($body['category'] ?? '');
    $reason = rewards_text($body['reason'] ?? '');
    $errors = [];

    if (!isset(REWARD_CATEGORIES[$category])) {
        $errors['category'] = 'Select a valid award category.';
    }

    if ($employeeRecordId <= 0) {
        $errors['employeeId'] = 'Select the employee being nominated.';
    }

    if ($reason === '') {
        $errors['reason'] = 'A justification is required.';
    }

    $definition = REWARD_CATEGORIES[$category] ?? null;
    $period = rewards_period_or_null($body['period'] ?? null);

    if ($definition && $definition['requiresPeriod'] && $period === null) {
        $errors['period'] = 'Select the award month.';
    }

    if ($errors) {
        json_response([
            'success' => false,
            'message' => 'Please correct the highlighted fields.',
            'errors' => $errors,
        ], 422);
    }

    // An award loses its meaning if you can put yourself up for it.
    if ($sessionEmployeeRecordId !== null && $sessionEmployeeRecordId === $employeeRecordId) {
        json_response([
            'success' => false,
            'message' => 'You cannot nominate yourself.',
        ], 422);
    }

    $employee = rewards_fetch_employee($pdo, $employeeRecordId);

    if ($employee === null) {
        json_response([
            'success' => false,
            'message' => 'Employee record not found.',
        ], 404);
    }

    // One open nomination per person per category per period — re-nominating after a rejection is
    // still allowed, which a UNIQUE index could not have expressed.
    $duplicate = $pdo->prepare(
        'SELECT COUNT(*)
         FROM reward_nominations
         WHERE employee_record_id = :employee_record_id
           AND category = :category
           AND is_archived = 0
           AND status IN ("pending", "approved")
           AND (award_period <=> :award_period)'
    );
    $duplicate->execute([
        ':employee_record_id' => $employeeRecordId,
        ':category' => $category,
        ':award_period' => $period,
    ]);

    if ((int)$duplicate->fetchColumn() > 0) {
        json_response([
            'success' => false,
            'message' => 'This employee already has a pending or approved nomination for that award.',
        ], 409);
    }

    $yearsOfService = null;

    if ($definition['usesYearsOfService']) {
        $stated = (int)($body['yearsOfService'] ?? 0);
        $yearsOfService = $stated > 0 ? $stated : rewards_years_of_service($employee['dateHired'] ?? null);
    }

    $insert = $pdo->prepare(
        'INSERT INTO reward_nominations
            (employee_record_id, category, award_period, years_of_service, reason, employee_name,
             employee_code, division_name, designation_title, employment_type,
             nominated_by_employee_id, nominated_by_name)
         VALUES
            (:employee_record_id, :category, :award_period, :years_of_service, :reason, :employee_name,
             :employee_code, :division_name, :designation_title, :employment_type,
             :nominated_by_employee_id, :nominated_by_name)'
    );
    $insert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':category' => $category,
        ':award_period' => $period,
        ':years_of_service' => $yearsOfService,
        ':reason' => $reason,
        // Snapshotted server-side rather than trusted from the client: the certificate must show the
        // post held at the time of the award.
        ':employee_name' => rewards_text($employee['fullName']),
        ':employee_code' => rewards_text($employee['employeeCode']),
        ':division_name' => rewards_text($employee['divisionName']),
        ':designation_title' => rewards_text($employee['designationTitle']),
        ':employment_type' => rewards_text($employee['employmentStatus']) ?: rewards_text($employee['status']),
        ':nominated_by_employee_id' => $sessionEmployeeRecordId,
        ':nominated_by_name' => rewards_text($body['nominatedBy'] ?? '') ?: rewards_actor_name($sessionUser),
    ]);

    $nominationId = (int)$pdo->lastInsertId();

    rewards_write_audit(
        $pdo,
        $sessionUser,
        'reward_nominated',
        $nominationId,
        sprintf('%s nominated for %s.', rewards_text($employee['fullName']), $definition['label'])
    );

    try {
        hris_notify_roles(
            $pdo,
            ['admin', 'hrhead'],
            'New award nomination',
            sprintf('%s was nominated for the %s.', rewards_text($employee['fullName']), $definition['label']),
            'reward_nomination',
            (string)$nominationId
        );
    } catch (Throwable $notificationError) {
        error_log('Reward nomination notification error: ' . $notificationError->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Nomination submitted.',
        'nominations' => rewards_list($pdo),
    ]);
}

if (in_array($method, ['PUT', 'PATCH'], true) && $action === 'decide') {
    if (!rewards_can_decide($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You do not have permission to approve or reject nominations.',
        ], 403);
    }

    $nominationId = (int)($body['id'] ?? 0);
    $decision = strtolower(rewards_text($body['decision'] ?? ''));
    $note = rewards_text($body['note'] ?? '');

    if ($nominationId <= 0 || !in_array($decision, ['approved', 'rejected'], true)) {
        json_response([
            'success' => false,
            'message' => 'A nomination and a decision are required.',
        ], 422);
    }

    // Declared out here because the audit and notification steps below run after the transaction
    // block and would otherwise depend on assignments made inside it.
    $nomination = [];
    $definition = null;
    $certificateNumber = null;

    try {
        $pdo->beginTransaction();

        $lookup = $pdo->prepare('SELECT * FROM reward_nominations WHERE id = :id AND is_archived = 0 FOR UPDATE');
        $lookup->execute([':id' => $nominationId]);
        $nomination = $lookup->fetch(PDO::FETCH_ASSOC);

        if (!$nomination) {
            $pdo->rollBack();
            json_response([
                'success' => false,
                'message' => 'Nomination not found.',
            ], 404);
        }

        if ($nomination['status'] !== 'pending') {
            $pdo->rollBack();
            json_response([
                'success' => false,
                'message' => 'This nomination has already been decided.',
            ], 409);
        }

        // Deciding your own nomination defeats the point of having a review step.
        if (
            $sessionEmployeeRecordId !== null
            && (int)($nomination['nominated_by_employee_id'] ?? 0) === $sessionEmployeeRecordId
        ) {
            $pdo->rollBack();
            json_response([
                'success' => false,
                'message' => 'You cannot decide a nomination you submitted yourself.',
            ], 403);
        }

        $category = rewards_text($nomination['category']);
        $definition = REWARD_CATEGORIES[$category] ?? null;
        $issuedAt = null;
        $signatoryName = null;

        if ($decision === 'approved') {
            // There is one Employee of the Month per month. The FOR UPDATE above plus this check
            // inside the transaction is what a UNIQUE index cannot express.
            if ($definition && $definition['singleWinnerPerPeriod']) {
                $existing = $pdo->prepare(
                    'SELECT employee_name
                     FROM reward_nominations
                     WHERE category = :category
                       AND (award_period <=> :award_period)
                       AND status = "approved"
                       AND is_archived = 0
                     LIMIT 1
                     FOR UPDATE'
                );
                $existing->execute([
                    ':category' => $category,
                    ':award_period' => $nomination['award_period'],
                ]);
                $winner = $existing->fetchColumn();

                if ($winner !== false) {
                    $pdo->rollBack();
                    json_response([
                        'success' => false,
                        'message' => sprintf(
                            '%s has already been awarded the %s for that period.',
                            (string)$winner,
                            $definition['label']
                        ),
                    ], 409);
                }
            }

            $issuedAt = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
            $certificateNumber = rewards_next_certificate_number($pdo, (int)date('Y'));
            $signatoryName = rewards_text($body['signatoryName'] ?? '');
        }

        $update = $pdo->prepare(
            'UPDATE reward_nominations
             SET status = :status,
                 reviewed_by_user_id = :reviewed_by_user_id,
                 reviewed_by_name = :reviewed_by_name,
                 reviewed_at = NOW(),
                 decision_note = :decision_note,
                 certificate_number = :certificate_number,
                 certificate_issued_at = :certificate_issued_at,
                 signatory_name = :signatory_name
             WHERE id = :id'
        );
        $update->execute([
            ':status' => $decision,
            ':reviewed_by_user_id' => (int)($sessionUser['id'] ?? 0) ?: null,
            ':reviewed_by_name' => rewards_actor_name($sessionUser),
            ':decision_note' => $note ?: null,
            ':certificate_number' => $certificateNumber,
            ':certificate_issued_at' => $issuedAt,
            ':signatory_name' => $signatoryName ?: null,
            ':id' => $nominationId,
        ]);

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        error_log('Reward decision failed: ' . $error->getMessage());
        json_response([
            'success' => false,
            'message' => 'Unable to record the decision.',
        ], 500);
    }

    rewards_write_audit(
        $pdo,
        $sessionUser,
        $decision === 'approved' ? 'reward_approved' : 'reward_rejected',
        $nominationId,
        $decision === 'approved'
            ? sprintf('Certificate %s issued to %s.', (string)$certificateNumber, rewards_text($nomination['employee_name']))
            : sprintf('Nomination for %s rejected.', rewards_text($nomination['employee_name'])),
        ['certificateNumber' => $certificateNumber, 'note' => $note]
    );

    try {
        if ($decision === 'approved') {
            hris_notify_employee(
                $pdo,
                (int)$nomination['employee_record_id'],
                'Congratulations!',
                sprintf(
                    'You have been awarded the %s. Certificate %s is ready at the HR office.',
                    $definition['label'] ?? 'award',
                    (string)$certificateNumber
                ),
                'reward_approved',
                (string)$nominationId
            );
        }
    } catch (Throwable $notificationError) {
        error_log('Reward decision notification error: ' . $notificationError->getMessage());
    }

    json_response([
        'success' => true,
        'message' => $decision === 'approved' ? 'Certificate issued.' : 'Nomination rejected.',
        'nominations' => rewards_list($pdo),
    ]);
}

if ($method === 'DELETE' && $action === 'archive') {
    if (!rewards_can_decide($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You do not have permission to remove nominations.',
        ], 403);
    }

    $nominationId = (int)($body['id'] ?? $_GET['id'] ?? 0);

    if ($nominationId <= 0) {
        json_response([
            'success' => false,
            'message' => 'A nomination is required.',
        ], 422);
    }

    $statement = $pdo->prepare('UPDATE reward_nominations SET is_archived = 1 WHERE id = :id');
    $statement->execute([':id' => $nominationId]);

    rewards_write_audit($pdo, $sessionUser, 'reward_archived', $nominationId, 'Nomination removed.');

    json_response([
        'success' => true,
        'message' => 'Nomination removed.',
        'nominations' => rewards_list($pdo),
    ]);
}

/*
 * One-time migration of nominations stranded in a browser's local storage.
 *
 * Records made before this endpoint existed live only in the browser that created them. This lets
 * the workspace hand them over once; already-issued certificate numbers are preserved rather than
 * reassigned, so a printed certificate still matches its record.
 */
if ($method === 'POST' && $action === 'import') {
    if (!rewards_can_decide($sessionUser)) {
        json_response([
            'success' => false,
            'message' => 'You do not have permission to import nominations.',
        ], 403);
    }

    $incoming = is_array($body['nominations'] ?? null) ? $body['nominations'] : [];
    $imported = 0;
    $skipped = 0;

    foreach ($incoming as $record) {
        if (!is_array($record)) {
            $skipped++;
            continue;
        }

        $employeeRecordId = (int)($record['employeeRecordId'] ?? $record['employeeId'] ?? 0);
        $category = rewards_text($record['category'] ?? '');
        $employee = $employeeRecordId > 0 ? rewards_fetch_employee($pdo, $employeeRecordId) : null;

        if ($employee === null || !isset(REWARD_CATEGORIES[$category])) {
            $skipped++;
            continue;
        }

        $status = strtolower(rewards_text($record['status'] ?? 'pending'));
        $status = in_array($status, ['pending', 'approved', 'rejected'], true) ? $status : 'pending';
        $certificateNumber = rewards_text($record['certificate']['number'] ?? '') ?: null;

        if ($certificateNumber !== null) {
            $exists = $pdo->prepare('SELECT COUNT(*) FROM reward_nominations WHERE certificate_number = :certificate_number');
            $exists->execute([':certificate_number' => $certificateNumber]);

            if ((int)$exists->fetchColumn() > 0) {
                $skipped++;
                continue;
            }
        }

        $insert = $pdo->prepare(
            'INSERT INTO reward_nominations
                (employee_record_id, category, award_period, years_of_service, reason, employee_name,
                 employee_code, division_name, designation_title, employment_type, nominated_by_name,
                 status, reviewed_by_name, reviewed_at, certificate_number, certificate_issued_at)
             VALUES
                (:employee_record_id, :category, :award_period, :years_of_service, :reason, :employee_name,
                 :employee_code, :division_name, :designation_title, :employment_type, :nominated_by_name,
                 :status, :reviewed_by_name, :reviewed_at, :certificate_number, :certificate_issued_at)'
        );
        $insert->execute([
            ':employee_record_id' => $employeeRecordId,
            ':category' => $category,
            ':award_period' => rewards_period_or_null($record['period'] ?? null),
            ':years_of_service' => (int)($record['yearsOfService'] ?? 0) ?: null,
            ':reason' => rewards_text($record['reason'] ?? '') ?: 'Imported from local records.',
            ':employee_name' => rewards_text($record['employeeName'] ?? '') ?: rewards_text($employee['fullName']),
            ':employee_code' => rewards_text($record['employeeCode'] ?? '') ?: rewards_text($employee['employeeCode']),
            ':division_name' => rewards_text($record['division'] ?? '') ?: rewards_text($employee['divisionName']),
            ':designation_title' => rewards_text($record['position'] ?? '') ?: rewards_text($employee['designationTitle']),
            ':employment_type' => rewards_text($record['employmentType'] ?? ''),
            ':nominated_by_name' => rewards_text($record['nominatedBy'] ?? ''),
            ':status' => $status,
            ':reviewed_by_name' => rewards_text($record['reviewedBy'] ?? '') ?: null,
            ':reviewed_at' => rewards_text($record['reviewedAt'] ?? '') ?: null,
            ':certificate_number' => $certificateNumber,
            ':certificate_issued_at' => rewards_text($record['certificate']['issuedAt'] ?? '') ?: null,
        ]);

        $imported++;
    }

    rewards_write_audit(
        $pdo,
        $sessionUser,
        'reward_imported',
        0,
        sprintf('Imported %d nomination(s) from local browser storage; %d skipped.', $imported, $skipped)
    );

    json_response([
        'success' => true,
        'message' => sprintf('Imported %d nomination(s). %d skipped.', $imported, $skipped),
        'imported' => $imported,
        'skipped' => $skipped,
        'nominations' => rewards_list($pdo),
    ]);
}

json_response([
    'success' => false,
    'message' => 'Unsupported rewards action.',
], 400);
