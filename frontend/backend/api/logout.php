<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

require_method('POST');

$user = session_user();

if ($user) {
    write_auth_audit($pdo, $user, 'logout.success', 'A user signed out.', [
        'username' => $user['username'] ?? null,
    ]);
}

$_SESSION = [];

if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool)$params['secure'], (bool)$params['httponly']);
}

session_destroy();

json_response([
    'success' => true,
    'message' => 'Logged out successfully.',
]);
