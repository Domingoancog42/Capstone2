<?php
/**
 * Test script to simulate different password expiry scenarios
 * This helps test the UI without modifying actual user data
 */

declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/session.php';
require_once __DIR__ . '/app_settings.php';

header('Content-Type: application/json; charset=utf-8');

// Get test scenario from query parameter
$scenario = $_GET['scenario'] ?? 'default';

try {
    $pdo = get_pdo_connection();
    $sessionUser = get_session_user($pdo);

    if (!$sessionUser) {
        json_response([
            'success' => false,
            'message' => 'You are not signed in.',
        ], 401);
    }

    // Simulate different scenarios
    switch ($scenario) {
        case 'critical': // 3 days left
            $response = [
                'success' => true,
                'passwordExpiry' => [
                    'enabled' => true,
                    'daysUntilExpiry' => 3,
                    'expiryDate' => date('Y-m-d H:i:s', strtotime('+3 days')),
                    'hasExpired' => false,
                    'shouldWarn' => true,
                    'passwordChangedAt' => date('Y-m-d H:i:s', strtotime('-87 days')),
                    'expiryDays' => 90,
                ],
            ];
            break;

        case 'urgent': // 7 days left
            $response = [
                'success' => true,
                'passwordExpiry' => [
                    'enabled' => true,
                    'daysUntilExpiry' => 7,
                    'expiryDate' => date('Y-m-d H:i:s', strtotime('+7 days')),
                    'hasExpired' => false,
                    'shouldWarn' => true,
                    'passwordChangedAt' => date('Y-m-d H:i:s', strtotime('-83 days')),
                    'expiryDays' => 90,
                ],
            ];
            break;

        case 'warning': // 14 days left
            $response = [
                'success' => true,
                'passwordExpiry' => [
                    'enabled' => true,
                    'daysUntilExpiry' => 14,
                    'expiryDate' => date('Y-m-d H:i:s', strtotime('+14 days')),
                    'hasExpired' => false,
                    'shouldWarn' => true,
                    'passwordChangedAt' => date('Y-m-d H:i:s', strtotime('-76 days')),
                    'expiryDays' => 90,
                ],
            ];
            break;

        case 'safe': // 50 days left - no warning
            $response = [
                'success' => true,
                'passwordExpiry' => [
                    'enabled' => true,
                    'daysUntilExpiry' => 50,
                    'expiryDate' => date('Y-m-d H:i:s', strtotime('+50 days')),
                    'hasExpired' => false,
                    'shouldWarn' => false,
                    'passwordChangedAt' => date('Y-m-d H:i:s', strtotime('-40 days')),
                    'expiryDays' => 90,
                ],
            ];
            break;

        case 'expired': // Already expired
            $response = [
                'success' => true,
                'passwordExpiry' => [
                    'enabled' => true,
                    'daysUntilExpiry' => -5,
                    'expiryDate' => date('Y-m-d H:i:s', strtotime('-5 days')),
                    'hasExpired' => true,
                    'shouldWarn' => false,
                    'passwordChangedAt' => date('Y-m-d H:i:s', strtotime('-95 days')),
                    'expiryDays' => 90,
                ],
            ];
            break;

        default: // Get real data
            include __DIR__ . '/password_expiry_check.php';
            return;
    }

    json_response($response);
} catch (Throwable $exception) {
    json_response([
        'success' => false,
        'message' => 'An error occurred.',
        'error' => $exception->getMessage(),
    ], 500);
}
