<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/password-reset-utils.php';

$sessionUser = require_session_user();
hris_ensure_user_security_columns($pdo);
hris_ensure_email_verification_columns($pdo);

/**
 * Account administration is admin/HR-head work. Before this gate the only check on the file was
 * require_session_user(), so any signed-in account -- including a plain employee -- could POST a new
 * user with role_id 1, or PUT a new role_id and password_hash onto someone else's account. That is a
 * full takeover from the lowest privilege level in the system.
 *
 * The two roles here are the ones granted the `users` module by hris_default_role_permission_access()
 * in app_settings.php, so this enforces on the server what that template already claims. Reads are
 * deliberately left open: ProfilePage, RoleAnalyticsOverview and the Regional Director dashboard all
 * call getUsers() for every role, and list_users() returns no password material.
 */
function users_require_account_manager(array $sessionUser): void
{
    if (in_array(hris_user_role_key($sessionUser), ['admin', 'hrhead'], true)) {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'You are not allowed to manage user accounts.',
    ], 403);
}

function user_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function user_int(mixed $value): int
{
    return (int)($value ?? 0);
}

function user_bool(mixed $value): bool
{
    if (is_bool($value)) {
        return $value;
    }

    $text = strtolower(trim((string)($value ?? '')));

    return in_array($text, ['1', 'true', 'yes', 'on'], true);
}

function user_activation_details(array $user): array
{
    return [
        'employeeName' => user_text($user['full_name'] ?? $user['username'] ?? ''),
        'employeeId' => user_text($user['employee_id'] ?? ''),
        'employeeEmail' => user_text($user['email'] ?? ''),
        'position' => user_text($user['designation'] ?? ''),
        'division' => user_text($user['division'] ?? ''),
        'accessRole' => user_text($user['role'] ?? 'Employee'),
    ];
}

function fetch_user(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.email_verified_at AS emailVerifiedAt,
            u.email_updated_at AS emailUpdatedAt,
            u.role_id AS roleId,
            r.name AS role,
            u.status_id AS statusId,
            s.name AS status,
            u.must_change_password AS mustChangePassword,
            e.employee_id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS full_name,
            d.name AS division,
            des.name AS designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN status s ON s.id = u.status_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.id = :id
           AND u.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $user = $statement->fetch();

    return $user ?: null;
}

function list_users(PDO $pdo): void
{
    $users = $pdo->query(
        'SELECT
            u.id,
            u.username,
            u.email,
            u.email_verified_at AS emailVerifiedAt,
            u.email_updated_at AS emailUpdatedAt,
            u.role_id AS roleId,
            r.name AS role,
            u.status_id AS statusId,
            s.name AS status,
            u.must_change_password AS mustChangePassword,
            e.employee_id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS full_name,
            d.name AS division,
            des.name AS designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN status s ON s.id = u.status_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.is_archived = 0
         ORDER BY u.created_at DESC, u.id DESC'
    )->fetchAll();

    // base_role marks an admin-created role and names the built-in dashboard it reuses;
    // it is NULL for the built-in roles.
    hris_ensure_role_columns($pdo);

    $roles = $pdo->query(
        'SELECT id, name, base_role AS baseRole, description FROM roles ORDER BY name'
    )->fetchAll();

    $statuses = $pdo->query(
        'SELECT id, name FROM status ORDER BY name'
    )->fetchAll();

    json_response([
        'success' => true,
        'users' => $users,
        'roles' => $roles,
        'statuses' => $statuses,
    ]);
}

function validate_user_payload(PDO $pdo, array $user, string $password, bool $requirePassword = true): void
{
    $errors = [];

    if ($user['username'] === '') {
        $errors[] = 'Username is required.';
    }
    if ($user['email'] === '' || filter_var($user['email'], FILTER_VALIDATE_EMAIL) === false) {
        $errors[] = 'Valid email is required.';
    } else {
        $emailPolicyViolation = hris_email_domain_policy_violation($pdo, $user['email']);
        if ($emailPolicyViolation !== null) {
            $errors[] = $emailPolicyViolation;
        }
    }
    if ($requirePassword && $password === '') {
        $errors[] = 'Password is required.';
    }
    if ($password !== '') {
        $passwordLengthError = hris_password_length_error($pdo, $password, 6);

        if ($passwordLengthError !== null) {
            $errors[] = $passwordLengthError;
        }
    }
    if ($user['role_id'] <= 0) {
        $errors[] = 'Role is required.';
    }
    if ($user['status_id'] <= 0) {
        $errors[] = 'Status is required.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }
}

/**
 * Apply the module access chosen in the Add/Edit User form. Failing to store an
 * override must not fail the save itself — the user record is already written, and
 * the admin can still adjust access from Settings > Permissions.
 */
function user_apply_permission_selection(PDO $pdo, int $userId, mixed $template, ?array $savedUser): bool
{
    if (!is_array($template)) {
        return false;
    }

    try {
        return hris_sync_user_permission_override(
            $pdo,
            $userId,
            $template,
            (string)($savedUser['role'] ?? '')
        );
    } catch (Throwable $exception) {
        error_log('User permission override error: ' . $exception->getMessage());
        return false;
    }
}

/**
 * Mirror an account's Active/Inactive status onto the linked employee row.
 *
 * The Add/Edit User form writes users.status_id, but employee reports and the workforce charts read
 * employees.status, and nothing used to write it — so deactivating an account left every report
 * still counting that person as active. The Employee Management list hid the split by displaying
 * the account status over the employee's own (getEmployeeCardStatus), which made the reports look
 * broken when they were faithfully reporting a column that never changed.
 *
 * Records are paired on the shared e-mail address, the same link employee.php uses in
 * find_employee_user_by_email(). The two columns carry different collations, so the match is done
 * on LOWER(TRIM(...)) against a bound value rather than column-to-column, which MariaDB rejects
 * with "Illegal mix of collations".
 *
 * A status that already records *why* someone left — Resigned, Retired, Separated — is never
 * overwritten: deactivating only touches a plain "Active", and reactivating only lifts a plain
 * "Inactive". Flattening Retired to Inactive would destroy detail the Separated and Retired reports
 * depend on.
 */
function user_sync_employee_status(PDO $pdo, string $email, bool $isActive): int
{
    $email = trim($email);

    if ($email === '') {
        return 0;
    }

    $statement = $pdo->prepare(
        'UPDATE employees
         SET status = :status
         WHERE is_archived = 0
           AND LOWER(TRIM(email)) = LOWER(:email)
           AND LOWER(COALESCE(TRIM(status), "")) = :current_status'
    );
    $statement->execute([
        ':status' => $isActive ? 'Active' : 'Inactive',
        ':email' => $email,
        ':current_status' => $isActive ? 'inactive' : 'active',
    ]);

    return $statement->rowCount();
}

function update_user(PDO $pdo, int $id, array $user, string $password, mixed $permissions = null): void
{
    $existingUser = fetch_user($pdo, $id);

    if ($existingUser === null) {
        json_response([
            'success' => false,
            'message' => 'User record not found.',
        ], 404);
    }

    $emailChanged = strcasecmp(
        trim((string)($existingUser['email'] ?? '')),
        trim((string)($user['email'] ?? ''))
    ) !== 0;

    $query = 'UPDATE users
              SET username = :username,
                  email = :email,
                  role_id = :role_id,
                  status_id = :status_id,
                  must_change_password = :must_change_password';

    if ($emailChanged) {
        $query .= ',
                  email_verified_at = NULL,
                  email_updated_at = CURRENT_TIMESTAMP';
    }

    $params = [
        ':username' => $user['username'],
        ':email' => $user['email'],
        ':role_id' => $user['role_id'],
        ':status_id' => $user['status_id'],
        ':must_change_password' => $user['must_change_password'],
        ':id' => $id,
    ];

    if ($password !== '') {
        $query .= ',
                  password_hash = :password_hash,
                  password_changed_at = CURRENT_TIMESTAMP,
                  failed_login_attempts = 0,
                  locked_until = NULL';
        $params[':password_hash'] = password_hash($password, PASSWORD_DEFAULT);
    }

    $query .= '
              WHERE id = :id
                AND is_archived = 0';

    try {
        $statement = $pdo->prepare($query);
        $statement->execute($params);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Username or email already exists.',
            ], 409);
        }

        throw $exception;
    }

    $updatedUser = fetch_user($pdo, $id);
    $permissionsOverridden = user_apply_permission_selection($pdo, $id, $permissions, $updatedUser);
    $statusChanged = (int)($existingUser['statusId'] ?? 0) !== (int)$user['status_id'];

    // Keep the employee row in step with the account. Logged rather than fatal: the account itself
    // is already saved, and failing the request here would report a save that did happen as an error.
    if ($statusChanged) {
        try {
            user_sync_employee_status(
                $pdo,
                (string)($updatedUser['email'] ?? ''),
                strcasecmp((string)($updatedUser['status'] ?? ''), 'Active') === 0
            );
        } catch (Throwable $syncException) {
            error_log('Employee status sync error: ' . $syncException->getMessage());
        }
    }

    try {
        $roleChanged = (int)($existingUser['roleId'] ?? 0) !== (int)$user['role_id'];
        $policyChanged = (int)($existingUser['mustChangePassword'] ?? 0) !== (int)$user['must_change_password'];

        if ($roleChanged || $statusChanged || $policyChanged) {
            $notificationType = $statusChanged
                ? ((int)$user['status_id'] === 1 ? 'account_activated' : 'account_deactivated')
                : ($roleChanged ? 'role_updated' : 'permission_updated');
            $changes = [];

            if ($roleChanged) {
                $changes[] = 'role updated to ' . (string)($updatedUser['role'] ?? 'the selected role');
            }
            if ($statusChanged) {
                $changes[] = 'status set to ' . (string)($updatedUser['status'] ?? 'the selected status');
            }
            if ($policyChanged) {
                $changes[] = 'password change requirement updated';
            }

            $notificationMessage = sprintf('Your account has been updated (%s).', implode(', ', $changes));

            hris_notify_roles($pdo, ['admin'], 'Account Updated', $notificationMessage, $notificationType, (string)$id);
            hris_notify_users($pdo, [$id], 'Account Updated', $notificationMessage, $notificationType, (string)$id);
        }
    } catch (Throwable $notificationException) {
        error_log('User notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'User updated successfully.',
        'user' => $updatedUser,
        'permissionsOverridden' => $permissionsOverridden,
    ]);
}

function archive_user(PDO $pdo, array $sessionUser, int $id): void
{
    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'User record is required.',
        ], 422);
    }

    if ((int)($sessionUser['id'] ?? 0) === $id) {
        json_response([
            'success' => false,
            'message' => 'You cannot archive your current account.',
        ], 422);
    }

    $targetUser = fetch_user($pdo, $id);

    $statement = $pdo->prepare(
        'UPDATE users
         SET is_archived = 1
         WHERE id = :id
           AND is_archived = 0'
    );
    $statement->execute([':id' => $id]);

    if ($statement->rowCount() === 0) {
        json_response([
            'success' => false,
            'message' => 'User record not found.',
        ], 404);
    }

    try {
        $notificationMessage = sprintf(
            'User %s has been archived and can no longer sign in.',
            (string)($targetUser['username'] ?? $targetUser['full_name'] ?? ('#' . $id))
        );

        hris_notify_roles($pdo, ['admin'], 'Account Deactivated', $notificationMessage, 'account_deactivated', (string)$id);
        hris_notify_users(
            $pdo,
            [$id],
            'Account Deactivated',
            'Your account has been archived and can no longer be used to sign in.',
            'account_deactivated',
            (string)$id
        );
    } catch (Throwable $notificationException) {
        error_log('User archive notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'User archived successfully.',
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    list_users($pdo);
}

$body = read_json_body();

// Everything past this point creates, rewrites or archives an account.
users_require_account_manager($sessionUser);

if ($method === 'POST') {
    $password = (string)($body['password'] ?? '');
    $sendActivationEmail = user_bool($body['sendActivationEmail'] ?? false);
    $user = [
        'username' => user_text($body['username'] ?? ''),
        'email' => user_text($body['email'] ?? ''),
        'role_id' => user_int($body['roleId'] ?? 0),
        'status_id' => user_int($body['statusId'] ?? 0),
        'must_change_password' => (int)(($body['mustChangePassword'] ?? false) === true || ($body['mustChangePassword'] ?? '0') === '1'),
    ];

    validate_user_payload($pdo, $user, $password);

    try {
        $statement = $pdo->prepare(
            'INSERT INTO users
                (username, email, password_hash, role_id, status_id, must_change_password, password_changed_at)
             VALUES
                (:username, :email, :password_hash, :role_id, :status_id, :must_change_password, CURRENT_TIMESTAMP)'
        );
        $statement->execute([
            ':username' => $user['username'],
            ':email' => $user['email'],
            ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
            ':role_id' => $user['role_id'],
            ':status_id' => $user['status_id'],
            ':must_change_password' => $user['must_change_password'],
        ]);
        $userId = (int)$pdo->lastInsertId();
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Username or email already exists.',
            ], 409);
        }

        throw $exception;
    }

    $createdUser = fetch_user($pdo, $userId);
    $permissionsOverridden = user_apply_permission_selection(
        $pdo,
        $userId,
        $body['permissions'] ?? null,
        $createdUser
    );

    // An account created straight into Inactive must not leave an existing employee row reading Active.
    try {
        user_sync_employee_status(
            $pdo,
            (string)($createdUser['email'] ?? $user['email']),
            strcasecmp((string)($createdUser['status'] ?? ''), 'Active') === 0
        );
    } catch (Throwable $syncException) {
        error_log('Employee status sync error: ' . $syncException->getMessage());
    }

    try {
        $notificationMessage = sprintf(
            'User account %s (%s) was created.',
            (string)($createdUser['username'] ?? $user['username']),
            (string)($createdUser['role'] ?? 'selected role')
        );

        hris_notify_roles($pdo, ['admin'], 'User Created', $notificationMessage, 'user_created', (string)$userId);

        if ((int)($createdUser['statusId'] ?? 0) === 1) {
            hris_notify_users(
                $pdo,
                [$userId],
                'Account Activated',
                'Your HRIS account has been created. Check your email for your temporary password.',
                'account_activated',
                (string)$userId
            );
        }
    } catch (Throwable $notificationException) {
        error_log('User creation notification error: ' . $notificationException->getMessage());
    }

    $emailNotification = null;
    $emailMessage = '';

    if ($sendActivationEmail) {
        if ($createdUser === null) {
            $emailNotification = 'warning';
            $emailMessage = 'User created, but activation email could not be prepared.';
        } else {
            try {
                send_employee_account_activation_email(
                    user_text($createdUser['email'] ?? $user['email']),
                    user_activation_details($createdUser),
                    $password
                );
                $emailNotification = 'sent';
                $emailMessage = 'Activation email sent to the employee.';
            } catch (Throwable $exception) {
                error_log('Employee activation email failed: ' . $exception->getMessage());
                $emailNotification = 'warning';
                $emailMessage = 'User created, but activation email could not be sent. Check SMTP settings.';
            }
        }
    }

    $message = 'User created successfully.';

    if ($emailNotification === 'sent') {
        $message = 'User created successfully. Activation email sent.';
    } elseif ($emailNotification === 'warning') {
        $message = 'User created successfully, but activation email could not be sent.';
    }

    json_response([
        'success' => true,
        'message' => $message,
        'user' => $createdUser,
        'permissionsOverridden' => $permissionsOverridden,
        'emailNotification' => $emailNotification,
        'emailMessage' => $emailMessage,
    ], 201);
}

if ($method === 'PUT') {
    $id = user_int($body['id'] ?? 0);
    $password = (string)($body['password'] ?? '');
    $user = [
        'username' => user_text($body['username'] ?? ''),
        'email' => user_text($body['email'] ?? ''),
        'role_id' => user_int($body['roleId'] ?? 0),
        'status_id' => user_int($body['statusId'] ?? 0),
        'must_change_password' => (int)(($body['mustChangePassword'] ?? false) === true || ($body['mustChangePassword'] ?? '0') === '1'),
    ];

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'User record is required.',
        ], 422);
    }

    validate_user_payload($pdo, $user, $password, false);
    update_user($pdo, $id, $user, $password, $body['permissions'] ?? null);
}

if ($method === 'DELETE') {
    $id = user_int($body['id'] ?? 0);
    archive_user($pdo, $sessionUser, $id);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
