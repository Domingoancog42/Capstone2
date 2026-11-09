<?php
declare(strict_types=1);

const PROMOTION_STATUSES = ['assessment', 'not_qualified', 'examination', 'interview', 'submission', 'recommended', 'approved', 'disapproved', 'cancelled'];
// Include legacy pending rows so existing applications still block duplicate applications.
const PROMOTION_OPEN_STATUSES = ['assessment', 'examination', 'interview', 'submission', 'pending', 'recommended'];
const PROMOTION_EVALUATION_STAGES = ['assessment', 'examination', 'interview'];

function promotion_workflow_status(string $status): string
{
    return match (strtolower(trim($status))) {
        'pending' => 'submission',
        'rejected' => 'disapproved',
        default => strtolower(trim($status)),
    };
}

/** Resolve transitions on the server; a submitted target status cannot skip a stage. */
function promotion_workflow_next_status(string $status, string $action, string $role): string
{
    $status = promotion_workflow_status($status);
    if (!in_array($status, PROMOTION_OPEN_STATUSES, true)) {
        throw new DomainException('This application is closed and can no longer be updated.', 422);
    }
    $hr = in_array($role, ['admin', 'hrhead', 'hrstaff'], true);
    $director = in_array($role, ['admin', 'regionaldirector'], true);
    if ($action === 'cancel') {
        if (!in_array($role, ['admin', 'hrstaff', 'chief'], true)) {
            throw new DomainException('You do not have permission to cancel this application.', 403);
        }
        return 'cancelled';
    }
    if (in_array($action, ['save_stage', 'advance', 'not_qualified'], true)) {
        if (!$hr) {
            throw new DomainException('Only HR can evaluate a promotion application.', 403);
        }
        if (!in_array($status, [...PROMOTION_EVALUATION_STAGES, 'submission'], true)
            || ($status === 'submission' && $action !== 'save_stage')) {
            throw new DomainException('This action is not available at the current stage.', 422);
        }
        return match ($action) {
            'save_stage' => $status,
            'not_qualified' => 'not_qualified',
            default => ['assessment' => 'examination', 'examination' => 'interview', 'interview' => 'submission'][$status],
        };
    }
    if ($action === 'recommend') {
        if (!$hr) throw new DomainException('Only HR can recommend a promotion.', 403);
        if ($status !== 'submission') throw new DomainException('Complete the evaluation and submission stages before recommending a promotion.', 422);
        return 'recommended';
    }
    if ($action === 'approve') {
        if (!$director) throw new DomainException('Only the Regional Director can give final approval.', 403);
        if ($status !== 'recommended') throw new DomainException('HR must recommend the application before final approval.', 422);
        return 'approved';
    }
    if ($action === 'reject') {
        if (!(($status === 'submission' && $hr) || ($status === 'recommended' && $director))) {
            throw new DomainException('This application is not at your desk to disapprove.', 403);
        }
        return 'disapproved';
    }
    throw new DomainException('Unknown promotion action.', 422);
}

function promotion_workflow_text(mixed $value, int $limit = 4000): string
{
    if (!is_scalar($value) && $value !== null) throw new DomainException('Invalid stage information.', 422);
    $text = trim((string)($value ?? ''));
    if (strlen($text) > $limit) throw new DomainException('Stage information is too long.', 422);
    return $text;
}

/** Only the current stage's known fields are writable. Draft schedules may have no result yet. */
function promotion_workflow_details(string $stage, array $input, bool $complete = false): array
{
    $fields = match ($stage) {
        'assessment' => ['reviewedOn', 'result', 'remarks'],
        'examination' => ['scheduledOn', 'score', 'result', 'remarks'],
        'interview' => ['scheduledOn', 'panel', 'rating', 'result', 'remarks'],
        'submission' => ['documentReferences', 'remarks'],
        default => throw new DomainException('This stage has no editable evaluation details.', 422),
    };
    $details = [];
    foreach ($fields as $field) $details[$field] = promotion_workflow_text($input[$field] ?? '');
    if ($stage === 'submission') {
        $details['documents'] = is_array($input['documents'] ?? null) ? array_values($input['documents']) : [];
    }
    $dateField = $stage === 'assessment' ? 'reviewedOn' : 'scheduledOn';
    if (isset($details[$dateField]) && $details[$dateField] !== '') {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $details[$dateField]);
        if (!$date || $date->format('Y-m-d') !== $details[$dateField]) {
            throw new DomainException('Enter a valid evaluation date.', 422);
        }
        if ($complete && $details[$dateField] > date('Y-m-d')) {
            throw new DomainException('An evaluation cannot be completed before its scheduled date.', 422);
        }
    }
    foreach (['score', 'rating'] as $field) {
        if (isset($details[$field]) && $details[$field] !== ''
            && (!is_numeric($details[$field]) || !is_finite((float)$details[$field]) || (float)$details[$field] < 0 || (float)$details[$field] > 100)) {
            throw new DomainException('Scores and ratings must be between 0 and 100.', 422);
        }
    }
    if (isset($details['result'])) {
        $results = $stage === 'assessment' ? ['', 'qualified', 'not_qualified'] : ['', 'passed', 'failed'];
        if (!in_array($details['result'], $results, true)) throw new DomainException('Select a valid evaluation result.', 422);
    }
    if ($complete) {
        if ($stage === 'submission') {
            if (count($details['documents']) === 0) throw new DomainException('Upload at least one supporting document before recommendation.', 422);
        } else {
            $passingResult = $stage === 'assessment' ? 'qualified' : 'passed';
            if ($details[$dateField] === '' || $details['result'] !== $passingResult) {
                throw new DomainException('Record the completed evaluation date and a passing result before advancing.', 422);
            }
            if ($stage === 'examination' && $details['score'] === '') throw new DomainException('Record the examination score before advancing.', 422);
            if ($stage === 'interview' && ($details['rating'] === '' || $details['panel'] === '')) {
                throw new DomainException('Record the interview panel and rating before advancing.', 422);
            }
        }
    }
    return $details;
}

function promotion_workflow_json(mixed $value): array
{
    $decoded = is_string($value) ? json_decode($value, true) : null;
    return is_array($decoded) ? $decoded : [];
}

function promotion_workflow_event(array $user, string $from, string $to, string $action, string $note = '', array $details = []): array
{
    return [
        'fromStatus' => $from, 'toStatus' => $to, 'action' => $action,
        'actorUserId' => (int)($user['id'] ?? 0),
        'actorName' => trim((string)($user['full_name'] ?? $user['name'] ?? $user['username'] ?? '')),
        'actorRole' => user_role_key($user),
        'createdAt' => date('Y-m-d H:i:s'), 'note' => $note, 'details' => $details,
    ];
}
