<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/rate-limit-utils.php';

$sessionUser = require_session_user();

function rate_limit_require_admin(array $sessionUser): void
{
    if (hris_user_role_key($sessionUser) === 'admin') {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'Only administrators can manage rate limiting.',
    ], 403);
}

function rate_limit_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function rate_limit_actor(array $sessionUser): string
{
    $name = rate_limit_text($sessionUser['full_name'] ?? '');

    return $name !== '' ? $name : rate_limit_text($sessionUser['username'] ?? 'Administrator');
}

function rate_limit_group_metadata(): array
{
    $groups = [];

    foreach (hris_rate_limit_group_definitions() as $key => $definition) {
        $groups[] = [
            'key' => $key,
            'label' => $definition['label'],
            'description' => $definition['description'],
            'defaults' => $definition['defaults'],
        ];
    }

    return $groups;
}

function rate_limit_overview(PDO $pdo): void
{
    json_response([
        'success' => true,
        'settings' => hris_rate_limit_settings($pdo),
        'groups' => rate_limit_group_metadata(),
        'bounds' => hris_rate_limit_field_bounds(),
        'exemptScripts' => hris_rate_limit_exempt_scripts(),
        'blocks' => hris_rate_limit_blocks($pdo),
        'activity' => hris_rate_limit_activity($pdo),
        'statistics' => hris_rate_limit_statistics($pdo),
        'driver' => hris_rate_limit_driver(),
    ]);
}

rate_limit_require_admin($sessionUser);
hris_ensure_rate_limit_tables($pdo);

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        rate_limit_overview($pdo);
    }

    $body = read_json_body();
    $action = rate_limit_text($body['action'] ?? '');

    if ($method === 'PUT' && ($action === '' || $action === 'settings')) {
        $normalized = hris_normalize_rate_limit_payload($body);

        if ($normalized['errors'] !== []) {
            json_response([
                'success' => false,
                'message' => implode(' ', $normalized['errors']),
            ], 422);
        }

        hris_store_rate_limit_settings($pdo, $normalized['settings']);

        write_auth_audit(
            $pdo,
            $sessionUser,
            'security.rate_limit_updated',
            'Rate limiting settings were updated.',
            ['enabled' => $normalized['settings']['enabled']]
        );

        rate_limit_overview($pdo);
    }

    if ($method === 'POST' && ($action === '' || $action === 'block')) {
        $group = rate_limit_text($body['group'] ?? '');
        $identifier = rate_limit_text($body['identifier'] ?? '');
        $minutes = filter_var($body['minutes'] ?? 60, FILTER_VALIDATE_INT);
        $reason = rate_limit_text($body['reason'] ?? '');

        if (!isset(hris_rate_limit_group_definitions()[$group])) {
            json_response([
                'success' => false,
                'message' => 'Select a valid endpoint group.',
            ], 422);
        }

        if ($identifier === '') {
            json_response([
                'success' => false,
                'message' => 'An IP address is required.',
            ], 422);
        }

        if (filter_var($identifier, FILTER_VALIDATE_IP) === false) {
            json_response([
                'success' => false,
                'message' => 'Enter a valid IPv4 or IPv6 address.',
            ], 422);
        }

        if ($minutes === false || $minutes < 1 || $minutes > 10080) {
            json_response([
                'success' => false,
                'message' => 'Block duration must be between 1 and 10080 minutes.',
            ], 422);
        }

        if (hris_rate_limit_active_block($pdo, $group, $identifier) !== null) {
            json_response([
                'success' => false,
                'message' => 'That address is already blocked for this endpoint group.',
            ], 409);
        }

        hris_rate_limit_block(
            $pdo,
            $group,
            $identifier,
            (int)$minutes,
            0,
            $reason !== '' ? $reason : 'Blocked manually by an administrator.',
            true,
            rate_limit_actor($sessionUser)
        );

        write_auth_audit(
            $pdo,
            $sessionUser,
            'security.rate_limit_blocked',
            sprintf('%s was blocked for %d minute(s) on the %s group.', $identifier, (int)$minutes, $group),
            ['identifier' => $identifier, 'group' => $group, 'minutes' => (int)$minutes]
        );

        rate_limit_overview($pdo);
    }

    if (($method === 'PUT' || $method === 'POST' || $method === 'DELETE') && $action === 'unblock') {
        $id = filter_var($body['id'] ?? ($_GET['id'] ?? 0), FILTER_VALIDATE_INT);

        if ($id === false || $id <= 0) {
            json_response([
                'success' => false,
                'message' => 'Select a block to release.',
            ], 422);
        }

        if (!hris_rate_limit_release($pdo, (int)$id, rate_limit_actor($sessionUser))) {
            json_response([
                'success' => false,
                'message' => 'That block was already released or has expired.',
            ], 404);
        }

        write_auth_audit(
            $pdo,
            $sessionUser,
            'security.rate_limit_released',
            'A rate limit block was released.',
            ['blockId' => (int)$id]
        );

        rate_limit_overview($pdo);
    }

    if ($method === 'DELETE' && $action === '') {
        $pdo->exec('DELETE FROM rate_limit_hits');

        write_auth_audit(
            $pdo,
            $sessionUser,
            'security.rate_limit_counters_cleared',
            'Rate limiting request counters were cleared.'
        );

        rate_limit_overview($pdo);
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Rate limit API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the rate limiting request.',
    ], 500);
}
