<?php
declare(strict_types=1);

/*
 * Authorisation: whether the signed-in user may do the thing they are asking to do.
 *
 * Authentication itself is the session cookie, resolved in connection-pdo.php. This file used to
 * carry a second path as well -- bearer-token authentication for callers that are not a browser,
 * built on short-lived access JWTs, long-lived hashed refresh tokens, and an `auth_tokens` table
 * whose rows existed so that signing out could actually revoke a credential.
 *
 * That half has been removed. Nothing in the project ever asked for a token: the React app signs in
 * with the cookie it already had, no client sent `"issueTokens": true`, and the table never held a
 * row. What it did cost was reach -- a CSRF exemption, a bearer fallback inside
 * require_session_user(), a revocation branch in logout, and a throttle identity -- all of it live
 * on every request for a caller that never arrived.
 *
 * Reinstating it means bringing back jwt.php, token.php and the auth_tokens table together. The
 * revocation design is the part that made it worth having, and it does not work without the table.
 */
/**
 * Whether a user holds one action on one module, as the Settings > Permissions checklist defines it.
 *
 * The permissions array is already on every user format_user() builds, so this is a lookup rather
 * than a query.
 */
function user_has_permission(array $user, string $module, string $action = 'view'): bool
{
    $permissions = $user['permissions'] ?? [];

    if (!is_array($permissions) || !isset($permissions[$module]) || !is_array($permissions[$module])) {
        return false;
    }

    foreach ($permissions[$module] as $granted) {
        if (strcasecmp((string)$granted, $action) === 0) {
            return true;
        }
    }

    return false;
}

/**
 * Refuse the request with a 403 unless the user holds the permission.
 *
 * The default message names neither the module nor the action. Whoever is on the other end of a
 * refusal does not need to be told the shape of the permission model, and a caller probing for what
 * exists learns nothing from a uniform answer.
 */
function require_permission(array $user, string $module, string $action = 'view', string $message = ''): void
{
    if (user_has_permission($user, $module, $action)) {
        return;
    }

    json_response([
        'success' => false,
        'reason' => 'forbidden',
        'message' => $message !== '' ? $message : 'You do not have permission to perform this action.',
    ], 403);
}

/**
 * Refuse the request unless the caller's role is in the list.
 *
 * Tested against user_role_key(), never the raw role name, so a custom role reaches whatever its
 * base role reaches -- which is the whole point of custom roles, and the thing an inline
 * `$user['role'] === 'Admin'` comparison gets wrong.
 */
function require_role(array $user, array $roleKeys, string $message = ''): void
{
    if (user_has_role($user, $roleKeys)) {
        return;
    }

    json_response([
        'success' => false,
        'reason' => 'forbidden',
        'message' => $message !== '' ? $message : 'You do not have permission to perform this action.',
    ], 403);
}

function user_has_role(array $user, array $roleKeys): bool
{
    $normalized = array_map(static fn (mixed $roleKey): string => normalize_role($roleKey), $roleKeys);

    return in_array(user_role_key($user), $normalized, true);
}
