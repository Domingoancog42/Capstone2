<?php
declare(strict_types=1);

/*
 * What the two sign-in endpoints have in common.
 *
 * login.php takes a password and google_login.php takes a Google credential, and once the credential
 * has been checked the two walk the same gates in the same order: the lock, the archive flag, the
 * account status, the e-mail domain policy, two-factor. The sequence itself stays written out in each
 * endpoint, where it can be read top to bottom. What lives here is the parts of it that are code
 * rather than order -- the account query, the lock wording and payload, the counter reset -- so that
 * the two cannot drift apart in which columns they load or how they describe a locked account.
 *
 * Only functions; it expects connection-pdo.php to have been required first, which every endpoint
 * does. Denied over HTTP by .htaccess like every other include here.
 */

/**
 * Everything a sign-in needs to know about one account, in one row.
 *
 * The employee is joined by e-mail rather than by a foreign key because that is the link the schema
 * has: `users` and `employees` are related through the address, and the COLLATE is there because the
 * two columns were created with different collations and MySQL refuses to compare them otherwise.
 * enrich_user_with_employee() then fills in whatever the join could not.
 *
 * `$condition` is the WHERE clause without the keyword, written by the two callers below and nowhere
 * else -- it is a fragment of trusted SQL, never anything a request typed.
 */
function login_user_query(PDO $pdo, string $condition, array $parameters): ?array
{
    ensure_employee_designation_column($pdo);

    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.email_verified_at,
            u.email_updated_at,
            u.password_hash,
            u.must_change_password,
            u.password_changed_at,
            u.failed_login_attempts,
            u.locked_until,
            u.two_factor_enabled,
            u.is_archived,
            r.name AS role,
            u.status,
            e.employee_id,
            e.first_name,
            e.middle_name,
            e.last_name,
            e.gender,
            e.profile_image,
            d.name AS division,
            des.name AS position,
            e.designation
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE ' . $condition . '
         LIMIT 1'
    );
    $statement->execute($parameters);
    $user = $statement->fetch();

    return $user ? enrich_user_with_employee($pdo, $user) : null;
}

/** The password form accepts either the username or the e-mail address in its one box. */
function login_find_user_by_identifier(PDO $pdo, string $identifier): ?array
{
    return login_user_query($pdo, '(u.username = :username_identifier OR u.email = :email_identifier)', [
        ':username_identifier' => $identifier,
        ':email_identifier' => $identifier,
    ]);
}

/**
 * Google sign-in only ever learns an address, so the address is all it may match on. Deliberately
 * not the username column: a username that happens to look like somebody else's Gmail address must
 * not let that Gmail account in.
 */
function login_find_user_by_email(PDO $pdo, string $email): ?array
{
    return login_user_query($pdo, 'u.email = :email', [':email' => $email]);
}

function login_locked_until_message(mixed $lockedUntil): string
{
    $timestamp = datetime_timestamp($lockedUntil);

    if ($timestamp === null) {
        return 'This account is temporarily locked due to repeated failed sign-in attempts.';
    }

    return 'This account is locked until ' . date('M j, Y g:i A', $timestamp) . ' due to repeated failed sign-in attempts.';
}

/**
 * The wall-clock string in the message is only a fallback. What the browser actually renders is built
 * from these fields: an ISO timestamp carrying the UTC offset, so it can be shown in whatever zone the
 * user is sitting in, and the seconds left, so the countdown never depends on the visitor's device
 * clock being set correctly.
 *
 * `lockTriggered` separates the attempt that spent the last try from every attempt made afterwards.
 * They deserve different treatment in the UI -- being locked out is news the first time and nothing
 * but a repeat of what the screen already says every time after -- and that is a distinction only
 * the endpoint can draw, so it is stated outright rather than inferred from the message wording.
 */
function login_lock_payload(int $lockedUntilTimestamp, bool $lockTriggered): array
{
    return [
        'lockedUntil' => date('c', $lockedUntilTimestamp),
        'secondsRemaining' => max(0, $lockedUntilTimestamp - time()),
        'lockTriggered' => $lockTriggered,
    ];
}

function login_clear_failed_attempts(PDO $pdo, int $userId): void
{
    if ($userId <= 0) {
        return;
    }

    $statement = $pdo->prepare(
        'UPDATE users
         SET failed_login_attempts = 0,
             locked_until = NULL
         WHERE id = :id'
    );
    $statement->execute([':id' => $userId]);
}
