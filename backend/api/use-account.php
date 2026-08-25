<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

require_method('POST');

/*
 * Temporary account use is a browser-session feature. It used to refuse bearer-token callers
 * explicitly, there being no PHP session in which to preserve the original Admin identity; bearer
 * authentication has since been removed, so require_session_user() below is the only door left.
 */
$sessionUser = require_session_user(true, true);
$body = read_json_body();
$action = strtolower(trim((string)($body['action'] ?? '')));

/** Rotate both identifiers at a privilege boundary and return the new CSRF value to the client. */
function account_use_rotate_session_security(): string
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }

    unset($_SESSION['csrf_token']);
    return csrf_token();
}

function account_use_admin_snapshot(array $admin): array
{
    return [
        'admin_user_id' => (int)($admin['id'] ?? 0),
        'admin_username' => trim((string)($admin['username'] ?? '')),
        'admin_full_name' => trim((string)($admin['full_name'] ?? '')),
        'admin_role' => trim((string)($admin['role'] ?? 'Admin')) ?: 'Admin',
    ];
}

if ($action === 'start') {
    if (session_account_use() !== null) {
        json_response([
            'success' => false,
            'message' => 'Return to your administrator account before using another account.',
        ], 409);
    }

    if (user_role_key($sessionUser) !== 'admin') {
        json_response([
            'success' => false,
            'message' => 'Only an administrator can use another account temporarily.',
        ], 403);
    }

    $targetUserId = (int)($body['userId'] ?? 0);
    $adminUserId = (int)($sessionUser['id'] ?? 0);

    if ($targetUserId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Choose a user account to continue.',
        ], 422);
    }

    if ($targetUserId === $adminUserId) {
        json_response([
            'success' => false,
            'message' => 'You are already using this account.',
        ], 422);
    }

    $targetRecord = session_user_record($pdo, $targetUserId);

    if ($targetRecord === null) {
        json_response([
            'success' => false,
            'message' => 'The selected user account was not found.',
        ], 404);
    }

    $targetUser = format_user($targetRecord);

    if (strcasecmp((string)($targetUser['status'] ?? ''), 'Active') !== 0) {
        json_response([
            'success' => false,
            'message' => 'Only an active user account can be used temporarily.',
        ], 422);
    }

    $lockContext = acquire_account_use_lock($pdo, $adminUserId, $targetUserId);

    if ($lockContext === null) {
        json_response([
            'success' => false,
            'message' => 'This account is already being used temporarily by an administrator.',
        ], 409);
    }

    write_auth_audit(
        $pdo,
        $sessionUser,
        'account_use.started',
        'An administrator started temporary access to another user account.',
        [
            'targetUserId' => $targetUserId,
            'targetUsername' => $targetUser['username'] ?? null,
            'targetRole' => $targetUser['role'] ?? null,
        ]
    );

    $_SESSION[HRIS_ACCOUNT_USE_SESSION_KEY] = array_merge(
        account_use_admin_snapshot($sessionUser),
        $lockContext
    );
    $_SESSION['user'] = session_user_with_account_use($targetUser);
    $_SESSION['last_activity_at'] = time();

    json_response([
        'success' => true,
        'message' => 'You are now using the selected account temporarily.',
        'user' => $_SESSION['user'],
        'csrfToken' => account_use_rotate_session_security(),
    ]);
}

if ($action === 'return') {
    $accountUse = session_account_use();

    if ($accountUse === null) {
        json_response([
            'success' => false,
            'message' => 'This session is not using another account.',
        ], 409);
    }

    $adminUserId = (int)$accountUse['admin_user_id'];
    $adminRecord = session_user_record($pdo, $adminUserId);

    if ($adminRecord === null) {
        destroy_session();
        json_response([
            'success' => false,
            'message' => 'Your original administrator account is no longer available. Please sign in again.',
        ], 401);
    }

    $adminUser = format_user($adminRecord);

    if (strcasecmp((string)($adminUser['status'] ?? ''), 'Active') !== 0) {
        destroy_session();
        json_response([
            'success' => false,
            'message' => 'Your original administrator account is inactive. Please sign in again.',
        ], 401);
    }

    write_auth_audit(
        $pdo,
        $sessionUser,
        'account_use.ended',
        'An administrator returned from temporary account access.',
        [
            'targetUserId' => (int)($sessionUser['id'] ?? 0),
            'targetUsername' => $sessionUser['username'] ?? null,
        ]
    );

    release_account_use_lock($pdo, $accountUse);
    unset($_SESSION[HRIS_ACCOUNT_USE_SESSION_KEY]);
    $_SESSION['user'] = $adminUser;
    $_SESSION['last_activity_at'] = time();

    json_response([
        'success' => true,
        'message' => 'You are back in your administrator account.',
        'user' => $adminUser,
        'csrfToken' => account_use_rotate_session_security(),
    ]);
}

json_response([
    'success' => false,
    'message' => 'Unknown temporary account action.',
], 422);
