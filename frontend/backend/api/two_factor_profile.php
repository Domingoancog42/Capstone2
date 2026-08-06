<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/two-factor-utils.php';

$sessionUser = require_session_user();
$userId = (int)($sessionUser['id'] ?? 0);

function two_factor_profile_payload(PDO $pdo, array $sessionUser): array
{
    $userId = (int)($sessionUser['id'] ?? 0);
    hris_ensure_two_factor_schema($pdo);
    hris_ensure_audit_logs_table($pdo);

    $statement = $pdo->prepare(
        'SELECT two_factor_enabled
         FROM users
         WHERE id = :id
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $userId]);
    $personalEnabled = (bool)((int)$statement->fetchColumn());

    // The 2FA trail lives in audit_logs, which already carries richer request context
    // (location, device, browser) than the retired two_factor_logs table ever did.
    $lastVerificationStatement = $pdo->prepare(
        'SELECT created_at
         FROM audit_logs
         WHERE user_id = :user_id
           AND action = "two_factor.verify_success"
         ORDER BY created_at DESC, id DESC
         LIMIT 1'
    );
    $lastVerificationStatement->execute([':user_id' => $userId]);

    $activityStatement = $pdo->prepare(
        'SELECT
            action,
            summary,
            ip_address AS ipAddress,
            device,
            browser,
            created_at AS createdAt
         FROM audit_logs
         WHERE user_id = :user_id
           AND category = "auth"
         ORDER BY created_at DESC, id DESC
         LIMIT 12'
    );
    $activityStatement->execute([':user_id' => $userId]);

    return [
        'success' => true,
        'user' => $sessionUser,
        'twoFactor' => [
            'personalEnabled' => $personalEnabled,
            'systemSettings' => hris_two_factor_settings($pdo),
            'requiredForCurrentUser' => hris_two_factor_required($pdo, [
                ...$sessionUser,
                'two_factor_enabled' => $personalEnabled,
            ]),
            'lastVerificationAt' => $lastVerificationStatement->fetchColumn() ?: null,
            'loginActivity' => $activityStatement->fetchAll(),
        ],
    ];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    json_response(two_factor_profile_payload($pdo, $sessionUser));
}

if ($method === 'PUT' || $method === 'POST') {
    $body = read_json_body();
    $enabled = hris_boolean_value($body['personalEnabled'] ?? ($body['enabled'] ?? null), false);

    $statement = $pdo->prepare(
        'UPDATE users
         SET two_factor_enabled = :enabled
         WHERE id = :id
           AND is_archived = 0'
    );
    $statement->execute([
        ':enabled' => $enabled ? 1 : 0,
        ':id' => $userId,
    ]);

    write_auth_audit($pdo, $sessionUser, 'two_factor.personal_setting_updated', 'A user updated their personal 2FA setting.', [
        'enabled' => $enabled,
    ]);
    hris_two_factor_notify_user(
        $pdo,
        $userId,
        '2FA preference updated',
        $enabled ? 'Personal two-factor authentication was enabled.' : 'Personal two-factor authentication was disabled.',
        'two_factor_profile'
    );
    hris_two_factor_safe_alert_email(
        (string)($sessionUser['email'] ?? ''),
        '2FA Preference Updated',
        $enabled
            ? 'Personal two-factor authentication was enabled for your MGB HRIS account.'
            : 'Personal two-factor authentication was disabled for your MGB HRIS account.'
    );

    $freshUser = refresh_session_user($sessionUser) ?? $sessionUser;
    $_SESSION['user'] = $freshUser;

    json_response(two_factor_profile_payload($pdo, $freshUser));
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
