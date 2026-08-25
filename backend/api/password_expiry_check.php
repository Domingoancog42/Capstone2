<?php

declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/session.php';
require_once __DIR__ . '/settings.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = get_pdo_connection();
    $sessionUser = get_session_user($pdo);

    if (!$sessionUser) {
        json_response([
            'success' => false,
            'message' => 'You are not signed in.',
        ], 401);
    }

    ensure_user_security_columns($pdo);

    $statement = $pdo->prepare(
        'SELECT password_changed_at
         FROM users
         WHERE id = :id
         LIMIT 1'
    );
    $statement->execute([':id' => (int)$sessionUser['id']]);
    $result = $statement->fetch();

    if (!$result) {
        json_response([
            'success' => false,
            'message' => 'User not found.',
        ], 404);
    }

    $expiryDays = password_validity_days();
    $passwordChangedAt = $result['password_changed_at'];

    if ($expiryDays <= 0) {
        json_response([
            'success' => true,
            'passwordExpiry' => [
                'enabled' => false,
                'daysUntilExpiry' => null,
                'expiryDate' => null,
                'shouldWarn' => false,
            ],
        ]);
    }

    $changedAt = datetime_timestamp($passwordChangedAt);

    if ($changedAt === null) {
        json_response([
            'success' => true,
            'passwordExpiry' => [
                'enabled' => true,
                'daysUntilExpiry' => $expiryDays,
                'expiryDate' => null,
                'shouldWarn' => false,
            ],
        ]);
    }

    $expiryTimestamp = $changedAt + ($expiryDays * 86400);
    $now = time();
    $daysUntilExpiry = (int)ceil(($expiryTimestamp - $now) / 86400);
    $expiryDate = date('Y-m-d H:i:s', $expiryTimestamp);
    $hasExpired = $daysUntilExpiry <= 0;
    $shouldWarn = $daysUntilExpiry <= 14 && $daysUntilExpiry > 0;

    json_response([
        'success' => true,
        'passwordExpiry' => [
            'enabled' => true,
            'daysUntilExpiry' => $daysUntilExpiry,
            'expiryDate' => $expiryDate,
            'hasExpired' => $hasExpired,
            'shouldWarn' => $shouldWarn,
            'passwordChangedAt' => $passwordChangedAt,
            'expiryDays' => $expiryDays,
        ],
    ]);
} catch (Throwable $exception) {
    json_response([
        'success' => false,
        'message' => 'An error occurred while checking password expiry.',
        'error' => $exception->getMessage(),
    ], 500);
}
