<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

require_method('POST');

$user = session_user();

/*
 * Signing out is now only the cookie. This used to also retire the bearer-token family the request
 * was holding -- a signed token being otherwise good until it expires no matter what happens at this
 * end -- and `{"allDevices": true}` asked for every family the account had. Bearer authentication
 * has been removed, so destroying the session is the whole of signing out and there is no second
 * credential left to outlive it.
 */
if ($user) {
    write_auth_audit($pdo, $user, 'logout.success', 'A user signed out.', [
        'username' => $user['username'] ?? null,
    ]);
}

// destroy_session() also releases any temporary Admin account-use lock before removing the cookie.
destroy_session();

json_response([
    'success' => true,
    'message' => 'Logged out successfully.',
]);
