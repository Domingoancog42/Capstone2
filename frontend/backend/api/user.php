<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/employee-id-utils.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/leave-credit-utils.php';
require_once __DIR__ . '/password-reset-utils.php';
require_once __DIR__ . '/admin-user-otp-utils.php';

$sessionUser = require_session_user();
ensure_user_security_columns($pdo);
ensure_email_verification_columns($pdo);
ensure_employee_assignment_optional($pdo);
migrate_legacy_employee_ids($pdo);

/**
 * Account administration is admin/HR-head work. Before this gate the only check on the file was
 * require_session_user(), so any signed-in account -- including a plain employee -- could POST a new
 * user with role_id 1, or PUT a new role_id and password_hash onto someone else's account. That is a
 * full takeover from the lowest privilege level in the system.
 *
 * The two roles here are the ones granted the `users` module by default_role_permission_access()
 * in settings.php, so this enforces on the server what that template already claims. Reads are
 * deliberately left open: ProfilePage, RoleAnalyticsOverview and the Regional Director dashboard all
 * call getUsers() for every role, and list_users() returns no password material.
 */
function users_require_account_manager(array $sessionUser): void
{
    if (in_array(user_role_key($sessionUser), ['admin', 'hrhead'], true)) {
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

function user_role_is_admin(PDO $pdo, int $roleId): bool
{
    $statement = $pdo->prepare('SELECT name FROM roles WHERE id = :id');
    $statement->execute([':id' => $roleId]);
    return strtolower(trim((string)$statement->fetchColumn())) === 'admin';
}

function user_verify_admin_creation(array $sessionUser, string $email, array $body): void
{
    try {
        admin_user_otp_consume($sessionUser, $email, user_text($body['otpCode'] ?? ''));
    } catch (RuntimeException $exception) {
        json_response(['success' => false, 'message' => $exception->getMessage()], 422);
    }
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
        'position' => user_text($user['position'] ?? ''),
        'division' => user_text($user['division'] ?? ''),
        'accessRole' => user_text($user['role'] ?? 'Employee'),
    ];
}

function user_next_employee_code(PDO $pdo): string
{
    return next_employee_id($pdo);
}

function user_split_full_name(string $fullName): array
{
    $parts = preg_split('/\s+/', trim($fullName)) ?: [];
    $lastName = count($parts) > 1 ? (string)array_pop($parts) : '';
    $firstName = $parts !== [] ? (string)array_shift($parts) : '';

    return [
        'firstName' => trim($firstName),
        'middleName' => trim(implode(' ', $parts)),
        'lastName' => trim($lastName),
    ];
}

function user_username_available(PDO $pdo, string $username): bool
{
    $statement = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = :username');
    $statement->execute([':username' => $username]);

    return (int)$statement->fetchColumn() === 0;
}

function user_unique_employee_username(PDO $pdo, string $fullName, string $employeeCode): string
{
    $base = substr(trim(preg_replace('/\s+/', ' ', $fullName) ?? ''), 0, 100);
    $candidates = [$base];

    for ($index = 1; $index <= 50; $index++) {
        $suffix = $index === 1 ? $employeeCode : $employeeCode . ' ' . $index;
        $baseLimit = max(0, 99 - strlen($suffix));
        $candidates[] = trim(substr($base, 0, $baseLimit) . ' ' . $suffix);
    }

    foreach ($candidates as $candidate) {
        if ($candidate !== '' && user_username_available($pdo, $candidate)) {
            return $candidate;
        }
    }

    return substr($employeeCode . ' ' . bin2hex(random_bytes(4)), 0, 100);
}

function user_temporary_password(PDO $pdo): string
{
    $maximumLength = (int)(security_settings($pdo)['maximumPasswordLength'] ?? 64);
    $targetLength = max(6, min(12, $maximumLength));
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $randomText = '';

    for ($index = 0; $index < max(2, $targetLength - 4); $index++) {
        $randomText .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }

    return substr('Tmp' . $randomText . '!', 0, $targetLength);
}

function user_fetch_employee(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            e.first_name AS firstName,
            e.middle_name AS middleName,
            e.last_name AS lastName,
            e.suffix,
            CONCAT_WS(" ", NULLIF(e.first_name, ""), NULLIF(e.middle_name, ""), NULLIF(e.last_name, ""), NULLIF(e.suffix, "")) AS fullName,
            e.date_of_birth AS dateOfBirth,
            e.address,
            e.city,
            e.province,
            e.zip_code AS zipCode,
            e.gender,
            e.email,
            e.phone,
            e.division_id AS divisionId,
            d.name AS department,
            e.designation_id AS designationId,
            des.name AS position,
            e.designation,
            e.basic_salary AS basicSalary,
            e.salary_rate AS salaryRate,
            e.date_hired AS dateHired,
            e.status,
            e.employment_status AS employmentStatus,
            e.profile_image AS profileImage,
            CAST(e.pwd AS CHAR) AS pwd,
            e.civil_status AS civilStatus,
            e.height,
            e.weight,
            e.blood_type AS bloodType,
            e.emp_gsis_id_no AS gsisIdNo,
            e.emp_pagibig_id_no AS pagibigIdNo,
            e.emp_philhealth_id_no AS philhealthIdNo,
            e.tin_no AS tinNo
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

function create_linked_employee_user(PDO $pdo, array $sessionUser, array $body): void
{
    $fullName = user_text($body['fullName'] ?? '');
    $email = user_text($body['email'] ?? '');
    $roleId = user_int($body['roleId'] ?? 0);
    $isAdmin = user_role_is_admin($pdo, $roleId);
    /* Optional placement; an administrator has no employee record, so it is ignored for that role. */
    $divisionId = $isAdmin ? 0 : user_int($body['divisionId'] ?? 0);
    $designationId = $isAdmin ? 0 : user_int($body['designationId'] ?? 0);
    $nameParts = user_split_full_name($fullName);
    $errors = [];

    if ($nameParts['firstName'] === '' || $nameParts['lastName'] === '') {
        $errors[] = 'Full name must include a first and last name.';
    } elseif (
        strlen($nameParts['firstName']) > 100
        || strlen($nameParts['middleName']) > 100
        || strlen($nameParts['lastName']) > 100
    ) {
        $errors[] = 'Each part of the employee name must not exceed 100 characters.';
    }
    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        $errors[] = 'Valid email is required.';
    } elseif (strlen($email) > 150) {
        $errors[] = 'Email must not exceed 150 characters.';
    } else {
        $emailPolicyViolation = email_domain_policy_violation($pdo, $email);
        if ($emailPolicyViolation !== null) {
            $errors[] = $emailPolicyViolation;
        }
    }
    if ($roleId <= 0) {
        $errors[] = 'Role is required.';
    } else {
        $roleStatement = $pdo->prepare('SELECT COUNT(*) FROM roles WHERE id = :id');
        $roleStatement->execute([':id' => $roleId]);
        if ((int)$roleStatement->fetchColumn() === 0) {
            $errors[] = 'Selected role is not available.';
        }
    }
    if ($divisionId > 0) {
        $divisionStatement = $pdo->prepare('SELECT COUNT(*) FROM divisions WHERE id = :id AND is_archived = 0');
        $divisionStatement->execute([':id' => $divisionId]);
        if ((int)$divisionStatement->fetchColumn() === 0) {
            $errors[] = 'Selected division is not available.';
        }
    }
    if ($designationId > 0) {
        if ($divisionId <= 0) {
            $errors[] = 'Select the division the position belongs to.';
        } else {
            /* The same rule the employee form enforces: a position is only valid inside its own division. */
            $designationStatement = $pdo->prepare(
                'SELECT COUNT(*) FROM designations
                 WHERE id = :id
                   AND division_id = :division_id
                   AND is_archived = 0'
            );
            $designationStatement->execute([':id' => $designationId, ':division_id' => $divisionId]);
            if ((int)$designationStatement->fetchColumn() === 0) {
                $errors[] = 'Selected position does not belong to the selected division.';
            }
        }
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }

    $duplicateStatement = $pdo->prepare(
        'SELECT
            (SELECT COUNT(*) FROM employees WHERE LOWER(TRIM(email)) = LOWER(:employee_email)) AS employee_count,
            (SELECT COUNT(*) FROM users WHERE LOWER(TRIM(email)) = LOWER(:user_email)) AS user_count'
    );
    $duplicateStatement->execute([
        ':employee_email' => $email,
        ':user_email' => $email,
    ]);
    $duplicates = $duplicateStatement->fetch() ?: [];

    if ((int)($duplicates['employee_count'] ?? 0) > 0 || (int)($duplicates['user_count'] ?? 0) > 0) {
        json_response([
            'success' => false,
            'message' => 'An employee or user with this email already exists.',
        ], 409);
    }

    $employeeRecordId = 0;
    $userId = 0;
    $temporaryPassword = user_temporary_password($pdo);
    if ($isAdmin) {
        user_verify_admin_creation($sessionUser, $email, $body);
    }

    try {
        $pdo->beginTransaction();
        $employeeCode = $isAdmin ? 'ADMIN' : user_next_employee_code($pdo);
        $username = user_unique_employee_username($pdo, $fullName, $employeeCode);

        if (!$isAdmin) {
            // The placement is whatever the form chose; left blank, division and designation stay
            // empty and are filled in later from Employee Management, whose edit form requires both.
            $statement = $pdo->prepare(
                'INSERT INTO employees
                    (employee_id, first_name, middle_name, last_name, email, division_id, designation_id, status)
                 VALUES
                    (:employee_id, :first_name, :middle_name, :last_name, :email, :division_id, :designation_id, :status)'
            );
            $statement->execute([
                ':employee_id' => $employeeCode,
                ':first_name' => $nameParts['firstName'],
                ':middle_name' => $nameParts['middleName'] !== '' ? $nameParts['middleName'] : null,
                ':last_name' => $nameParts['lastName'],
                ':email' => $email,
                ':division_id' => $divisionId > 0 ? $divisionId : null,
                ':designation_id' => $designationId > 0 ? $designationId : null,
                ':status' => 'Active',
            ]);
            $employeeRecordId = (int)$pdo->lastInsertId();

            // A brand-new employee record: vacation and sick leave open at 0.
            ensure_employee_default_leave_credits($pdo, $employeeRecordId, null, true);
            recalculate_employee_leave_credit_usage($pdo, $employeeRecordId);
        }

        $statement = $pdo->prepare(
            'INSERT INTO users
                (username, email, password_hash, role_id, status, must_change_password, password_changed_at)
             VALUES
                (:username, :email, :password_hash, :role_id, :status, 1, CURRENT_TIMESTAMP)'
        );
        $statement->execute([
            ':username' => $username,
            ':email' => $email,
            ':password_hash' => password_hash($temporaryPassword, PASSWORD_DEFAULT),
            ':role_id' => $roleId,
            ':status' => HRIS_USER_STATUS_ACTIVE,
        ]);
        $userId = (int)$pdo->lastInsertId();
        $pdo->commit();
    } catch (PDOException $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Employee ID, username, or email already exists.',
            ], 409);
        }

        throw $exception;
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $employee = $isAdmin ? null : user_fetch_employee($pdo, $employeeRecordId);
    $createdUser = fetch_user($pdo, $userId);
    $emailNotification = null;
    $emailMessage = '';
    $sendActivationEmail = !array_key_exists('sendActivationEmail', $body)
        || user_bool($body['sendActivationEmail']);

    if ($sendActivationEmail && $createdUser !== null) {
        try {
            send_employee_account_activation_email(
                $email,
                user_activation_details($createdUser),
                $temporaryPassword
            );
            $emailNotification = 'sent';
            $emailMessage = $isAdmin ? 'Activation email sent to the Admin.' : 'Activation email sent to the employee.';
        } catch (Throwable $exception) {
            error_log('Employee activation email failed: ' . $exception->getMessage());
            $emailNotification = 'warning';
            $emailMessage = 'User created, but activation email could not be sent. Check SMTP settings.';
        }
    }

    try {
        notify_roles(
            $pdo,
            ['admin'],
            'User Created',
            sprintf('%s (%s) was added as %s.', $fullName, (string)($employee['employeeId'] ?? ''), (string)($createdUser['role'] ?? 'a user')),
            'user_created',
            (string)$userId
        );
        notify_users(
            $pdo,
            [$userId],
            'Account Activated',
            $isAdmin ? 'Your Admin account has been created.' : 'Your employee profile and HRIS account have been created.',
            'account_activated',
            (string)$employeeRecordId
        );
        write_auth_audit($pdo, $sessionUser, 'user.created', $isAdmin ? 'An Admin account was created after OTP verification of the acting account.' : 'A linked employee and user account were created.', [
            'employeeRecordId' => $employeeRecordId,
            'userId' => $userId,
            'employeeId' => $employee['employeeId'] ?? null,
        ]);
    } catch (Throwable $notificationException) {
        error_log('Linked user notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => $emailNotification === 'sent'
            ? 'User created successfully. Activation email sent.'
            : 'User created successfully.',
        'employee' => $employee,
        'linkedUser' => $createdUser,
        'user' => $createdUser,
        'temporaryPassword' => $temporaryPassword,
        'emailNotification' => $emailNotification,
        'emailMessage' => $emailMessage,
    ], 201);
}

function fetch_user(PDO $pdo, int $id, bool $archived = false): ?array
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
            u.status,
            u.is_archived AS isArchived,
            u.created_at AS createdAt,
            u.must_change_password AS mustChangePassword,
            e.employee_id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS full_name,
            d.name AS division,
            des.name AS position,
            e.designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.id = :id
           AND u.is_archived = :is_archived
         LIMIT 1'
    );
    $statement->execute([
        ':id' => $id,
        ':is_archived' => $archived ? 1 : 0,
    ]);
    $user = $statement->fetch();

    return $user ?: null;
}

function list_users(PDO $pdo, bool $archived = false): void
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
            u.status,
            u.is_archived AS isArchived,
            u.created_at AS createdAt,
            u.must_change_password AS mustChangePassword,
            e.employee_id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS full_name,
            d.name AS division,
            des.name AS position,
            e.designation
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE u.is_archived = :is_archived
         ORDER BY u.created_at DESC, u.id DESC'
    );
    $statement->execute([':is_archived' => $archived ? 1 : 0]);
    $users = $statement->fetchAll();

    // base_role usually marks an admin-created role and names the built-in capability set it
    // reuses. Chief Admin is the built-in exception: it has its own route but inherits Chief.
    ensure_role_columns($pdo);

    $roles = $pdo->query(
        'SELECT id, name, base_role AS baseRole, description FROM roles ORDER BY name'
    )->fetchAll();

    /*
     * The two values `users.status` accepts, sent as plain strings. This used to be
     * `SELECT id, name FROM status` and the form posted back the id it picked; the column is an
     * ENUM now, so the value itself is what travels both ways and there is no id to keep in step.
     */
    json_response([
        'success' => true,
        'users' => $users,
        'roles' => $roles,
        'statuses' => [HRIS_USER_STATUS_ACTIVE, HRIS_USER_STATUS_INACTIVE],
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
        $emailPolicyViolation = email_domain_policy_violation($pdo, $user['email']);
        if ($emailPolicyViolation !== null) {
            $errors[] = $emailPolicyViolation;
        }
    }
    if ($requirePassword && $password === '') {
        $errors[] = 'Password is required.';
    }
    if ($password !== '') {
        $passwordLengthError = password_length_error($pdo, $password, 6);

        if ($passwordLengthError !== null) {
            $errors[] = $passwordLengthError;
        }
    }
    if ($user['role_id'] <= 0) {
        $errors[] = 'Role is required.';
    }
    if ($user['status'] === '') {
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
        return sync_user_permission_override(
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
 * The Add/Edit User form writes users.status, but employee reports and the workforce charts read
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

/**
 * The employee record an account is linked to: the one active employee whose e-mail is the account's.
 *
 * The link between the two tables is the shared address and nothing else (see fetch_user() and
 * enrich_user_with_employee()), which is why an e-mail edit has to move both rows together --
 * change only `users.email` and the account silently stops being that employee.
 */
function user_linked_employee_id(PDO $pdo, string $email): ?int
{
    $email = trim($email);

    if ($email === '') {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM employees
         WHERE is_archived = 0
           AND LOWER(TRIM(email)) = LOWER(:email)
         ORDER BY id ASC
         LIMIT 1'
    );
    $statement->execute([':email' => $email]);
    $employeeId = (int)$statement->fetchColumn();

    return $employeeId > 0 ? $employeeId : null;
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

    /*
     * An e-mail edit travels to the employee record the account is linked to, or the two fall out
     * of step: User Management would show the new address while Employee Management, the profile
     * and every screen that pairs the tables on the address kept the old one -- and the account,
     * no longer matching any employee, would lose its name, employee ID and division on the spot.
     * Checked before anything is written, so a clash with another employee's address refuses the
     * whole edit rather than leaving the account changed and the employee not.
     */
    $linkedEmployeeId = $emailChanged ? user_linked_employee_id($pdo, (string)($existingUser['email'] ?? '')) : null;

    if ($linkedEmployeeId !== null) {
        $clashStatement = $pdo->prepare(
            'SELECT COUNT(*)
             FROM employees
             WHERE LOWER(TRIM(email)) = LOWER(:email)
               AND id <> :employee_id'
        );
        $clashStatement->execute([
            ':email' => $user['email'],
            ':employee_id' => $linkedEmployeeId,
        ]);

        if ((int)$clashStatement->fetchColumn() > 0) {
            json_response([
                'success' => false,
                'message' => 'Another employee record already uses this email.',
            ], 409);
        }
    }

    $query = 'UPDATE users
              SET username = :username,
                  email = :email,
                  role_id = :role_id,
                  status = :status,
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
        ':status' => $user['status'],
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
        $pdo->beginTransaction();

        $statement = $pdo->prepare($query);
        $statement->execute($params);

        if ($linkedEmployeeId !== null) {
            $employeeStatement = $pdo->prepare('UPDATE employees SET email = :email WHERE id = :id');
            $employeeStatement->execute([
                ':email' => $user['email'],
                ':id' => $linkedEmployeeId,
            ]);
        }

        $pdo->commit();
    } catch (PDOException $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

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
    $statusChanged = strcasecmp((string)($existingUser['status'] ?? ''), $user['status']) !== 0;

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
                ? ($user['status'] === HRIS_USER_STATUS_ACTIVE ? 'account_activated' : 'account_deactivated')
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

            notify_roles($pdo, ['admin'], 'Account Updated', $notificationMessage, $notificationType, (string)$id);
            notify_users($pdo, [$id], 'Account Updated', $notificationMessage, $notificationType, (string)$id);
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

        notify_roles($pdo, ['admin'], 'Account Deactivated', $notificationMessage, 'account_deactivated', (string)$id);
        notify_users(
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
        'user' => array_merge($targetUser ?: [], ['isArchived' => 1]),
    ]);
}

function restore_user(PDO $pdo, int $id): void
{
    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'User record is required.',
        ], 422);
    }

    $targetUser = fetch_user($pdo, $id, true);

    if ($targetUser === null) {
        json_response([
            'success' => false,
            'message' => 'Archived user record not found.',
        ], 404);
    }

    $statement = $pdo->prepare(
        'UPDATE users
         SET is_archived = 0
         WHERE id = :id
           AND is_archived = 1'
    );
    $statement->execute([':id' => $id]);

    if ($statement->rowCount() === 0) {
        json_response([
            'success' => false,
            'message' => 'Archived user record not found.',
        ], 404);
    }

    $restoredUser = fetch_user($pdo, $id);

    try {
        $notificationMessage = sprintf(
            'User %s has been restored.',
            (string)($restoredUser['username'] ?? $targetUser['username'] ?? ('#' . $id))
        );

        notify_roles($pdo, ['admin'], 'Account Restored', $notificationMessage, 'account_activated', (string)$id);
        notify_users(
            $pdo,
            [$id],
            'Account Restored',
            'Your HRIS account has been restored.',
            'account_activated',
            (string)$id
        );
    } catch (Throwable $notificationException) {
        error_log('User restore notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'User restored successfully.',
        'user' => $restoredUser,
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $archived = in_array(
        strtolower(trim((string)($_GET['archived'] ?? ''))),
        ['1', 'true', 'yes'],
        true
    );
    list_users($pdo, $archived);
}

$body = read_json_body();

// Everything past this point creates, rewrites or archives an account.
users_require_account_manager($sessionUser);

if ($method === 'POST' && strtolower(user_text($body['action'] ?? '')) === 'sendadminotp') {
    $email = user_text($body['email'] ?? '');
    if (!user_role_is_admin($pdo, user_int($body['roleId'] ?? 0))) {
        json_response(['success' => false, 'message' => 'Select the Admin role to request verification.'], 422);
    }
    if (strlen($email) > 150 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_response(['success' => false, 'message' => 'Enter a valid Admin email address.'], 422);
    }
    $violation = email_domain_policy_violation($pdo, $email);
    if ($violation !== null) {
        json_response(['success' => false, 'message' => $violation], 422);
    }
    $existing = $pdo->prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(:email) LIMIT 1');
    $existing->execute([':email' => $email]);
    if ($existing->fetchColumn()) {
        json_response(['success' => false, 'message' => 'A user with this email already exists.'], 409);
    }
    try {
        json_response(admin_user_otp_issue($sessionUser, $email));
    } catch (RuntimeException $exception) {
        json_response(['success' => false, 'message' => $exception->getMessage()], 422);
    }
}

if (
    $method === 'POST'
    && strtolower(user_text($body['action'] ?? '')) === 'createlinkedemployeeuser'
) {
    create_linked_employee_user($pdo, $sessionUser, $body);
}

if ($method === 'POST') {
    $password = (string)($body['password'] ?? '');
    $sendActivationEmail = user_bool($body['sendActivationEmail'] ?? false);
    $user = [
        'username' => user_text($body['username'] ?? ''),
        'email' => user_text($body['email'] ?? ''),
        'role_id' => user_int($body['roleId'] ?? 0),
        'status' => normalize_user_status($body['status'] ?? ''),
        // user_bool(): the edit form posts the stored 1/0 back, which the old strict === checks read as off.
        'must_change_password' => (int)user_bool($body['mustChangePassword'] ?? false),
    ];

    validate_user_payload($pdo, $user, $password);
    if (user_role_is_admin($pdo, $user['role_id'])) {
        user_verify_admin_creation($sessionUser, $user['email'], $body);
    }

    try {
        $statement = $pdo->prepare(
            'INSERT INTO users
                (username, email, password_hash, role_id, status, must_change_password, password_changed_at)
             VALUES
                (:username, :email, :password_hash, :role_id, :status, :must_change_password, CURRENT_TIMESTAMP)'
        );
        $statement->execute([
            ':username' => $user['username'],
            ':email' => $user['email'],
            ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
            ':role_id' => $user['role_id'],
            ':status' => $user['status'],
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

        notify_roles($pdo, ['admin'], 'User Created', $notificationMessage, 'user_created', (string)$userId);

        if (strcasecmp((string)($createdUser['status'] ?? ''), HRIS_USER_STATUS_ACTIVE) === 0) {
            notify_users(
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

if ($method === 'PUT' && strtolower(user_text($body['action'] ?? '')) === 'restore') {
    restore_user($pdo, user_int($body['id'] ?? 0));
}

if ($method === 'PUT') {
    $id = user_int($body['id'] ?? 0);
    $password = (string)($body['password'] ?? '');
    $user = [
        'username' => user_text($body['username'] ?? ''),
        'email' => user_text($body['email'] ?? ''),
        'role_id' => user_int($body['roleId'] ?? 0),
        'status' => normalize_user_status($body['status'] ?? ''),
        // user_bool(): the edit form posts the stored 1/0 back, which the old strict === checks read as off.
        'must_change_password' => (int)user_bool($body['mustChangePassword'] ?? false),
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
