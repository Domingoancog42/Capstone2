<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/email-domain-policy.php';
require_once __DIR__ . '/leave-credit-utils.php';
require_once __DIR__ . '/password-reset-utils.php';

$sessionUser = require_session_user();
hris_ensure_organization_structure_columns($pdo);
hris_ensure_user_security_columns($pdo);
hris_ensure_email_verification_columns($pdo);

function employee_null_if_empty(mixed $value): mixed
{
    if ($value === null) {
        return null;
    }

    $trimmed = trim((string)$value);
    return $trimmed === '' ? null : $trimmed;
}

function employee_decimal_or_null(mixed $value): ?string
{
    $value = employee_null_if_empty($value);

    if ($value === null) {
        return null;
    }

    return is_numeric($value) ? (string)$value : null;
}

function employee_date_or_null(mixed $value): ?string
{
    $value = employee_null_if_empty($value);

    if ($value === null) {
        return null;
    }

    $date = DateTime::createFromFormat('Y-m-d', (string)$value);
    return $date && $date->format('Y-m-d') === $value ? (string)$value : null;
}

function employee_bool(mixed $value): bool
{
    if (is_bool($value)) {
        return $value;
    }

    $text = strtolower(trim((string)($value ?? '')));

    return in_array($text, ['1', 'true', 'yes', 'on'], true);
}

function employee_payload(array $body): array
{
    return [
        'employee_id' => trim((string)($body['employeeId'] ?? '')),
        'first_name' => trim((string)($body['firstName'] ?? '')),
        'middle_name' => employee_null_if_empty($body['middleName'] ?? null),
        'last_name' => trim((string)($body['lastName'] ?? '')),
        'date_of_birth' => employee_date_or_null($body['dateOfBirth'] ?? null),
        'address' => employee_null_if_empty($body['address'] ?? null),
        'city' => employee_null_if_empty($body['city'] ?? null),
        'province' => employee_null_if_empty($body['province'] ?? null),
        'zip_code' => employee_null_if_empty($body['zipCode'] ?? null),
        'gender' => employee_null_if_empty($body['gender'] ?? null),
        'email' => trim((string)($body['email'] ?? '')),
        'phone' => employee_null_if_empty($body['phone'] ?? null),
        'division_id' => (int)($body['divisionId'] ?? 0),
        'designation_id' => (int)($body['designationId'] ?? 0),
        'basic_salary' => employee_decimal_or_null($body['basicSalary'] ?? null),
        'salary_rate' => employee_null_if_empty($body['salaryRate'] ?? null),
        'date_hired' => employee_date_or_null($body['dateHired'] ?? null),
        'status' => employee_null_if_empty($body['status'] ?? 'Active') ?? 'Active',
        'employment_status' => employee_null_if_empty($body['employmentStatus'] ?? null),
        'pwd' => (int)(($body['pwd'] ?? '0') === '1' || ($body['pwd'] ?? false) === true),
        'civil_status' => employee_null_if_empty($body['civilStatus'] ?? null),
        'height' => employee_decimal_or_null($body['height'] ?? null),
        'weight' => employee_decimal_or_null($body['weight'] ?? null),
        'blood_type' => employee_null_if_empty($body['bloodType'] ?? null),
        'emp_gsis_id_no' => employee_null_if_empty($body['gsisIdNo'] ?? null),
        'emp_pagibig_id_no' => employee_null_if_empty($body['pagibigIdNo'] ?? null),
        'emp_philhealth_id_no' => employee_null_if_empty($body['philhealthIdNo'] ?? null),
        'tin_no' => employee_null_if_empty($body['tinNo'] ?? null),
    ];
}

function employee_payload_errors(PDO $pdo, array $employee): array
{
    $errors = [];

    if ($employee['employee_id'] === '') {
        $errors[] = 'Employee ID is required.';
    }
    if ($employee['first_name'] === '') {
        $errors[] = 'First name is required.';
    }
    if ($employee['last_name'] === '') {
        $errors[] = 'Last name is required.';
    }
    if ($employee['date_of_birth'] === null) {
        $errors[] = 'Date of birth is required.';
    }
    if ($employee['email'] === '' || filter_var($employee['email'], FILTER_VALIDATE_EMAIL) === false) {
        $errors[] = 'Valid email is required.';
    } else {
        $emailPolicyViolation = hris_email_domain_policy_violation($pdo, $employee['email']);
        if ($emailPolicyViolation !== null) {
            $errors[] = $emailPolicyViolation;
        }
    }
    if ($employee['phone'] === null) {
        $errors[] = 'Phone is required.';
    }
    if ($employee['division_id'] <= 0) {
        $errors[] = 'Division is required.';
    }
    if ($employee['designation_id'] <= 0) {
        $errors[] = 'Designation is required.';
    }

    if ($employee['division_id'] > 0 && $employee['designation_id'] > 0) {
        $statement = $pdo->prepare(
            'SELECT COUNT(*) FROM designations
             WHERE id = :designation_id
               AND division_id = :division_id
               AND is_archived = 0'
        );
        $statement->execute([
            ':designation_id' => $employee['designation_id'],
            ':division_id' => $employee['division_id'],
        ]);

        if ((int)$statement->fetchColumn() === 0) {
            $errors[] = 'Selected designation does not belong to the selected division.';
        }
    }

    return $errors;
}

function validate_employee_payload(PDO $pdo, array $employee): void
{
    $errors = employee_payload_errors($pdo, $employee);

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }
}

function generate_employee_id(PDO $pdo): string
{
    $year = date('Y');
    $prefix = 'EMP' . $year . '-';
    $statement = $pdo->prepare(
        'SELECT MAX(CAST(SUBSTRING(employee_id, :offset) AS UNSIGNED))
         FROM employees
         WHERE employee_id LIKE :prefix'
    );
    $statement->execute([
        ':offset' => strlen($prefix) + 1,
        ':prefix' => $prefix . '%',
    ]);

    $nextNumber = ((int)$statement->fetchColumn()) + 1;
    return $prefix . str_pad((string)$nextNumber, 4, '0', STR_PAD_LEFT);
}

function employee_role_exists(PDO $pdo, int $roleId): bool
{
    if ($roleId <= 0) {
        return false;
    }

    $statement = $pdo->prepare('SELECT COUNT(*) FROM roles WHERE id = :id');
    $statement->execute([':id' => $roleId]);

    return (int)$statement->fetchColumn() > 0;
}

function employee_status_exists(PDO $pdo, int $statusId): bool
{
    if ($statusId <= 0) {
        return false;
    }

    $statement = $pdo->prepare('SELECT COUNT(*) FROM status WHERE id = :id');
    $statement->execute([':id' => $statusId]);

    return (int)$statement->fetchColumn() > 0;
}

function employee_active_status_id(PDO $pdo): int
{
    $statement = $pdo->query(
        'SELECT id
         FROM status
         WHERE LOWER(name) = "active"
         ORDER BY id
         LIMIT 1'
    );
    $activeStatusId = $statement !== false ? (int)$statement->fetchColumn() : 0;

    if ($activeStatusId > 0) {
        return $activeStatusId;
    }

    $fallbackStatement = $pdo->query('SELECT id FROM status ORDER BY id LIMIT 1');

    return $fallbackStatement !== false ? (int)$fallbackStatement->fetchColumn() : 0;
}

function validate_employee_account_payload(PDO $pdo, int $roleId): void
{
    if ($roleId <= 0) {
        return;
    }

    $errors = [];

    if (!employee_role_exists($pdo, $roleId)) {
        $errors[] = 'Selected account role is not available.';
    }

    if (employee_active_status_id($pdo) <= 0) {
        $errors[] = 'No active account status is available.';
    }

    if ($errors !== []) {
        json_response([
            'success' => false,
            'message' => implode(' ', $errors),
        ], 422);
    }
}

function fetch_employee(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            e.first_name AS firstName,
            e.middle_name AS middleName,
            e.last_name AS lastName,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS fullName,
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
         INNER JOIN divisions d ON d.id = e.division_id
         INNER JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

/**
 * Appends a service record entry when an edit changes the employee's appointment.
 *
 * `employees` keeps only current state, so without this a promotion silently overwrites the previous
 * designation and salary and the history is gone. Only the four fields that appear on CS Form No. 1
 * are watched — editing a phone number is not an appointment change.
 *
 * The effective date is NOT the date of the edit. HR records promotions late and corrects typos, so
 * the client sends `serviceEffectiveDate` (what the appointment document says) and
 * `serviceChangeMode`. A "correction" amends the row currently in force instead of opening a new
 * one, which is what keeps typo fixes from appearing as fictitious promotions.
 *
 * Runs inside the caller's transaction: if the employee update rolls back, so does this.
 */
function employee_append_service_record(
    PDO $pdo,
    int $employeeRecordId,
    array $previous,
    array $current,
    array $body,
    ?int $createdBy
): void {
    if (!hris_database_table_exists($pdo, 'service_records') || !$current) {
        return;
    }

    $watched = [
        'designationId' => 'designation',
        'basicSalary' => 'salary',
        'employmentStatus' => 'employment status',
        'divisionId' => 'division',
    ];
    $changed = [];

    foreach ($watched as $key => $label) {
        $before = trim((string)($previous[$key] ?? ''));
        $after = trim((string)($current[$key] ?? ''));

        // Salary is decimal text ("25000.00" vs "25000"), so compare numerically where possible.
        if (is_numeric($before) && is_numeric($after)) {
            if (abs((float)$before - (float)$after) > 0.001) {
                $changed[] = $label;
            }

            continue;
        }

        if ($before !== $after) {
            $changed[] = $label;
        }
    }

    if (!$changed) {
        return;
    }

    $effectiveDate = trim((string)($body['serviceEffectiveDate'] ?? ''));
    $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $effectiveDate);

    if (!$parsedDate || $parsedDate->format('Y-m-d') !== $effectiveDate) {
        $effectiveDate = (new DateTimeImmutable('today'))->format('Y-m-d');
    }

    $isCorrection = strtolower(trim((string)($body['serviceChangeMode'] ?? 'change'))) === 'correction';
    $remarks = trim((string)($body['serviceChangeRemarks'] ?? ''));

    if ($remarks === '') {
        $remarks = ucfirst(implode(', ', $changed)) . ' updated.';
    }

    $designationTitle = trim((string)($current['position'] ?? ''));
    $station = trim((string)($current['department'] ?? ''));
    $employmentStatus = trim((string)($current['employmentStatus'] ?? '')) ?: trim((string)($current['status'] ?? ''));

    if ($designationTitle === '' || $station === '' || $employmentStatus === '') {
        return;
    }

    if ($isCorrection) {
        $update = $pdo->prepare(
            'UPDATE service_records
             SET designation_title = :designation_title,
                 employment_status = :employment_status,
                 monthly_salary = :monthly_salary,
                 station = :station,
                 designation_id = :designation_id,
                 division_id = :division_id,
                 remarks = :remarks
             WHERE employee_record_id = :employee_record_id
               AND is_archived = 0
               AND service_to IS NULL
             ORDER BY service_from DESC
             LIMIT 1'
        );
        $update->execute([
            ':designation_title' => $designationTitle,
            ':employment_status' => $employmentStatus,
            ':monthly_salary' => $current['basicSalary'] ?? null,
            ':station' => $station,
            ':designation_id' => $current['designationId'] ?? null,
            ':division_id' => $current['divisionId'] ?? null,
            ':remarks' => $remarks,
            ':employee_record_id' => $employeeRecordId,
        ]);

        if ($update->rowCount() > 0) {
            return;
        }
        // Nothing open to amend — fall through and record it as a new period instead.
    }

    $closesOn = (new DateTimeImmutable($effectiveDate))->modify('-1 day')->format('Y-m-d');
    $close = $pdo->prepare(
        'UPDATE service_records
         SET service_to = :closes_on
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
           AND service_to IS NULL
           AND service_from <= :effective_date'
    );
    $close->execute([
        ':closes_on' => $closesOn,
        ':employee_record_id' => $employeeRecordId,
        ':effective_date' => $effectiveDate,
    ]);

    $insert = $pdo->prepare(
        'INSERT INTO service_records
            (employee_record_id, service_from, designation_title, employment_status, monthly_salary,
             station, designation_id, division_id, source, remarks, created_by)
         VALUES
            (:employee_record_id, :service_from, :designation_title, :employment_status, :monthly_salary,
             :station, :designation_id, :division_id, "system", :remarks, :created_by)'
    );
    $insert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':service_from' => $effectiveDate,
        ':designation_title' => $designationTitle,
        ':employment_status' => $employmentStatus,
        ':monthly_salary' => $current['basicSalary'] ?? null,
        ':station' => $station,
        ':designation_id' => $current['designationId'] ?? null,
        ':division_id' => $current['divisionId'] ?? null,
        ':remarks' => $remarks,
        ':created_by' => $createdBy,
    ]);
}

function fetch_employee_linked_user(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
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

function find_employee_user_by_email(PDO $pdo, string $email): ?array
{
    $email = trim($email);

    if ($email === '') {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id, username, email, role_id AS roleId, status_id AS statusId,
                must_change_password AS mustChangePassword, is_archived AS isArchived
         FROM users
         WHERE email COLLATE utf8mb4_unicode_ci = :email
         ORDER BY is_archived ASC, id DESC
         LIMIT 1'
    );
    $statement->execute([':email' => $email]);
    $user = $statement->fetch();

    return $user ?: null;
}

function find_employee_user_for_emails(PDO $pdo, array $emails): ?array
{
    $seenEmails = [];

    foreach ($emails as $email) {
        $email = trim((string)$email);
        $emailKey = strtolower($email);

        if ($email === '' || isset($seenEmails[$emailKey])) {
            continue;
        }

        $seenEmails[$emailKey] = true;
        $user = find_employee_user_by_email($pdo, $email);

        if ($user !== null) {
            return $user;
        }
    }

    return null;
}

function employee_username_is_available(PDO $pdo, string $username, ?int $exceptUserId = null): bool
{
    $sql = 'SELECT COUNT(*) FROM users WHERE username = :username';
    $params = [':username' => $username];

    if ($exceptUserId !== null && $exceptUserId > 0) {
        $sql .= ' AND id <> :id';
        $params[':id'] = $exceptUserId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (int)$statement->fetchColumn() === 0;
}

function employee_limited_username(string $baseUsername, string $suffix = ''): string
{
    $baseUsername = preg_replace('/\s+/', ' ', trim($baseUsername)) ?? '';
    $suffix = preg_replace('/\s+/', ' ', trim($suffix)) ?? '';
    $maxLength = 100;

    if ($suffix === '') {
        return substr($baseUsername, 0, $maxLength);
    }

    $suffix = substr($suffix, 0, $maxLength);
    $baseLimit = max(0, $maxLength - strlen($suffix) - 1);
    $base = trim(substr($baseUsername, 0, $baseLimit));

    return trim($base . ' ' . $suffix);
}

function employee_unique_username(PDO $pdo, string $baseUsername, string $employeeCode, ?int $exceptUserId = null): string
{
    $baseUsername = trim($baseUsername) !== '' ? trim($baseUsername) : $employeeCode;
    $baseUsername = trim($baseUsername) !== '' ? trim($baseUsername) : 'Employee';
    $employeeCode = trim($employeeCode);

    $candidates = [
        employee_limited_username($baseUsername),
    ];

    if ($employeeCode !== '') {
        $candidates[] = employee_limited_username($baseUsername, $employeeCode);
    }

    for ($index = 2; $index <= 50; $index++) {
        $suffix = $employeeCode !== '' ? $employeeCode . ' ' . $index : (string)$index;
        $candidates[] = employee_limited_username($baseUsername, $suffix);
    }

    foreach ($candidates as $candidate) {
        if ($candidate !== '' && employee_username_is_available($pdo, $candidate, $exceptUserId)) {
            return $candidate;
        }
    }

    return employee_limited_username($baseUsername, bin2hex(random_bytes(4)));
}

function employee_temporary_password(PDO $pdo): string
{
    $maximumLength = hris_security_settings($pdo)['maximumPasswordLength'];
    $targetLength = max(6, min(12, $maximumLength));
    $randomLength = max(2, $targetLength - 4);
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $randomText = '';

    for ($index = 0; $index < $randomLength; $index++) {
        $randomText .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }

    return substr('Tmp' . $randomText . '!', 0, $targetLength);
}

function employee_account_activation_details(array $employee, array $user): array
{
    return [
        'employeeName' => trim((string)($employee['fullName'] ?? $user['username'] ?? '')),
        'employeeId' => trim((string)($employee['employeeId'] ?? '')),
        'employeeEmail' => trim((string)($employee['email'] ?? $user['email'] ?? '')),
        'position' => trim((string)($employee['position'] ?? '')),
        'division' => trim((string)($employee['department'] ?? '')),
        'accessRole' => trim((string)($user['role'] ?? 'Employee')),
    ];
}

function upsert_employee_linked_user(
    PDO $pdo,
    array $employee,
    int $roleId,
    ?string $previousEmail = null,
    bool $issueTemporaryPassword = false
): ?array {
    if ($roleId <= 0) {
        return null;
    }

    $email = trim((string)($employee['email'] ?? ''));

    if ($email === '') {
        throw new RuntimeException('Employee email is required to create a linked user account.');
    }

    $employeeCode = trim((string)($employee['employeeId'] ?? ''));
    $baseUsername = trim((string)($employee['fullName'] ?? ''));
    $existingUser = find_employee_user_for_emails($pdo, [$email, (string)$previousEmail]);
    $existingUserId = $existingUser !== null ? (int)$existingUser['id'] : null;
    $statusId = $existingUser !== null && employee_status_exists($pdo, (int)$existingUser['statusId'])
        ? (int)$existingUser['statusId']
        : employee_active_status_id($pdo);
    $username = employee_unique_username($pdo, $baseUsername !== '' ? $baseUsername : $email, $employeeCode, $existingUserId);

    if ($statusId <= 0) {
        throw new RuntimeException('No active account status is available.');
    }

    if ($existingUser !== null) {
        $temporaryPassword = '';
        $mustChangePassword = (int)(
            ($existingUser['mustChangePassword'] ?? false) === true
            || (string)($existingUser['mustChangePassword'] ?? '0') === '1'
        );

        if ($issueTemporaryPassword) {
            $temporaryPassword = employee_temporary_password($pdo);
            $passwordLengthError = hris_password_length_error($pdo, $temporaryPassword, 6);
            $activeStatusId = employee_active_status_id($pdo);

            if ($passwordLengthError !== null) {
                throw new RuntimeException($passwordLengthError);
            }

            if ($activeStatusId > 0) {
                $statusId = $activeStatusId;
            }

            $mustChangePassword = 1;
        }

        $emailChanged = strcasecmp(trim((string)($existingUser['email'] ?? '')), $email) !== 0;
        $query = 'UPDATE users
             SET username = :username,
                 email = :email,
                 role_id = :role_id,
                 status_id = :status_id,
                 must_change_password = :must_change_password,
                 is_archived = 0';

        if ($emailChanged) {
            $query .= ',
                 email_verified_at = NULL,
                 email_updated_at = CURRENT_TIMESTAMP';
        }

        if ($temporaryPassword !== '') {
            $query .= ',
                 password_hash = :password_hash,
                 password_changed_at = CURRENT_TIMESTAMP,
                 failed_login_attempts = 0,
                 locked_until = NULL';
        }

        $query .= '
             WHERE id = :id';

        $params = [
            ':username' => $username,
            ':email' => $email,
            ':role_id' => $roleId,
            ':status_id' => $statusId,
            ':must_change_password' => $mustChangePassword,
            ':id' => $existingUserId,
        ];

        if ($temporaryPassword !== '') {
            $params[':password_hash'] = password_hash($temporaryPassword, PASSWORD_DEFAULT);
        }

        $statement = $pdo->prepare($query);
        $statement->execute($params);

        return [
            'created' => false,
            'temporaryPassword' => $temporaryPassword,
            'user' => fetch_employee_linked_user($pdo, $existingUserId),
            'message' => $temporaryPassword !== ''
                ? 'Linked account updated with a new temporary password.'
                : 'Linked account role updated.',
        ];
    }

    $temporaryPassword = employee_temporary_password($pdo);
    $passwordLengthError = hris_password_length_error($pdo, $temporaryPassword, 6);

    if ($passwordLengthError !== null) {
        throw new RuntimeException($passwordLengthError);
    }

    $statement = $pdo->prepare(
        'INSERT INTO users
            (username, email, password_hash, role_id, status_id, must_change_password, password_changed_at)
         VALUES
            (:username, :email, :password_hash, :role_id, :status_id, 1, CURRENT_TIMESTAMP)'
    );
    $statement->execute([
        ':username' => $username,
        ':email' => $email,
        ':password_hash' => password_hash($temporaryPassword, PASSWORD_DEFAULT),
        ':role_id' => $roleId,
        ':status_id' => $statusId,
    ]);

    $userId = (int)$pdo->lastInsertId();

    return [
        'created' => true,
        'temporaryPassword' => $temporaryPassword,
        'user' => fetch_employee_linked_user($pdo, $userId),
        'message' => 'Linked account created.',
    ];
}

function employee_linked_account_response(?array $linkedAccount, array $employee, bool $sendActivationEmail): array
{
    if ($linkedAccount === null) {
        return [
            'linkedUser' => null,
            'accountMessage' => '',
            'accountWarning' => '',
            'emailNotification' => null,
            'emailMessage' => '',
            'temporaryPassword' => '',
        ];
    }

    $linkedUser = $linkedAccount['user'] ?? null;
    $temporaryPassword = (string)($linkedAccount['temporaryPassword'] ?? '');
    $accountMessage = (string)($linkedAccount['message'] ?? '');
    $emailNotification = null;
    $emailMessage = '';

    if (($linkedAccount['created'] ?? false) === true || $temporaryPassword !== '') {
        if ($sendActivationEmail && is_array($linkedUser) && $temporaryPassword !== '') {
            try {
                send_employee_account_activation_email(
                    trim((string)($linkedUser['email'] ?? $employee['email'] ?? '')),
                    employee_account_activation_details($employee, $linkedUser),
                    $temporaryPassword
                );
                $emailNotification = 'sent';
                $emailMessage = 'Activation email sent to the employee.';
                $accountMessage = ($linkedAccount['created'] ?? false) === true
                    ? 'Linked account created and activation email sent.'
                    : 'Linked account updated and activation email sent.';
            } catch (Throwable $exception) {
                error_log('Employee activation email failed: ' . $exception->getMessage());
                $emailNotification = 'warning';
                $emailMessage = 'Activation email could not be sent. ' . $exception->getMessage();
                $accountMessage = ($linkedAccount['created'] ?? false) === true
                    ? 'Linked account created.'
                    : 'Linked account updated with a new temporary password.';
            }
        } elseif ($temporaryPassword !== '') {
            $accountMessage = ($linkedAccount['created'] ?? false) === true
                ? 'Linked account created.'
                : 'Linked account updated with a new temporary password.';
        }
    }

    return [
        'linkedUser' => $linkedUser,
        'accountMessage' => $accountMessage,
        'accountWarning' => '',
        'emailNotification' => $emailNotification,
        'emailMessage' => $emailMessage,
        'temporaryPassword' => $temporaryPassword,
    ];
}

function insert_employee_record(PDO $pdo, array $employee): int
{
    $statement = $pdo->prepare(
        'INSERT INTO employees
            (employee_id, first_name, middle_name, last_name, date_of_birth, address, city,
             province, zip_code, gender, email, phone, division_id, designation_id,
             basic_salary, salary_rate, date_hired, status, employment_status, pwd,
             civil_status, height, weight, blood_type, emp_gsis_id_no, emp_pagibig_id_no,
             emp_philhealth_id_no, tin_no)
         VALUES
            (:employee_id, :first_name, :middle_name, :last_name, :date_of_birth, :address, :city,
             :province, :zip_code, :gender, :email, :phone, :division_id, :designation_id,
             :basic_salary, :salary_rate, :date_hired, :status, :employment_status, :pwd,
             :civil_status, :height, :weight, :blood_type, :emp_gsis_id_no, :emp_pagibig_id_no,
             :emp_philhealth_id_no, :tin_no)'
    );
    $statement->execute(array_combine(
        array_map(fn (string $key): string => ':' . $key, array_keys($employee)),
        array_values($employee)
    ));

    $employeeId = (int)$pdo->lastInsertId();
    ensure_employee_default_leave_credits($pdo, $employeeId);
    recalculate_employee_leave_credit_usage($pdo, $employeeId);

    return $employeeId;
}

function employee_csv_header_key(mixed $value): string
{
    $text = preg_replace('/^\xEF\xBB\xBF/', '', (string)($value ?? '')) ?? '';
    return strtolower(preg_replace('/[^a-z0-9]+/i', '', $text) ?? '');
}

function employee_csv_canonical_key(mixed $value): string
{
    $key = employee_csv_header_key($value);
    $aliases = [
        'employeeid' => 'employeeId',
        'firstname' => 'firstName',
        'middlename' => 'middleName',
        'lastname' => 'lastName',
        'dateofbirth' => 'dateOfBirth',
        'birthdate' => 'dateOfBirth',
        'dob' => 'dateOfBirth',
        'address' => 'address',
        'barangay' => 'address',
        'city' => 'city',
        'municipality' => 'city',
        'province' => 'province',
        'zipcode' => 'zipCode',
        'gender' => 'gender',
        'email' => 'email',
        'emailaddress' => 'email',
        'phone' => 'phone',
        'phonenumber' => 'phone',
        'contactnumber' => 'phone',
        'roleid' => 'roleId',
        'accountroleid' => 'roleId',
        'userroleid' => 'roleId',
        'role' => 'roleName',
        'rolename' => 'roleName',
        'accountrole' => 'roleName',
        'userrole' => 'roleName',
        'accessrole' => 'roleName',
        'divisionid' => 'divisionId',
        'departmentid' => 'divisionId',
        'division' => 'divisionName',
        'department' => 'divisionName',
        'divisionname' => 'divisionName',
        'departmentname' => 'divisionName',
        'designationid' => 'designationId',
        'positionid' => 'designationId',
        'designation' => 'designationName',
        'position' => 'designationName',
        'jobtitle' => 'designationName',
        'designationname' => 'designationName',
        'positionname' => 'designationName',
        'basicsalary' => 'basicSalary',
        'salaryrate' => 'salaryRate',
        'datehired' => 'dateHired',
        'hiredate' => 'dateHired',
        'status' => 'status',
        'employmentstatus' => 'employmentStatus',
        'pwd' => 'pwd',
        'civilstatus' => 'civilStatus',
        'height' => 'height',
        'weight' => 'weight',
        'bloodtype' => 'bloodType',
        'empgsisidno' => 'gsisIdNo',
        'gsisidno' => 'gsisIdNo',
        'gsis' => 'gsisIdNo',
        'emppagibigidno' => 'pagibigIdNo',
        'pagibigidno' => 'pagibigIdNo',
        'pagibig' => 'pagibigIdNo',
        'empphilhealthidno' => 'philhealthIdNo',
        'philhealthidno' => 'philhealthIdNo',
        'philhealth' => 'philhealthIdNo',
        'tinno' => 'tinNo',
        'tin' => 'tinNo',
    ];

    return $aliases[$key] ?? '';
}

function employee_csv_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function employee_csv_truthy(mixed $value): string
{
    return employee_bool($value) ? '1' : '0';
}

function employee_csv_date(mixed $value): string
{
    $text = employee_csv_text($value);

    if ($text === '') {
        return '';
    }

    $formats = ['Y-m-d', 'm/d/Y', 'n/j/Y', 'd/m/Y', 'j/n/Y', 'm-d-Y', 'n-j-Y'];
    foreach ($formats as $format) {
        $date = DateTime::createFromFormat($format, $text);
        if ($date instanceof DateTime) {
            return $date->format('Y-m-d');
        }
    }

    $timestamp = strtotime($text);
    return $timestamp === false ? $text : date('Y-m-d', $timestamp);
}

function employee_csv_find_division_id(PDO $pdo, string $value): int
{
    $text = employee_csv_text($value);
    if ($text === '') {
        return 0;
    }

    if (ctype_digit($text)) {
        return (int)$text;
    }

    // Native prepares are on, so the same placeholder cannot fill two markers — bind one per marker.
    $statement = $pdo->prepare(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
           AND (name COLLATE utf8mb4_unicode_ci = :name_value
                OR code COLLATE utf8mb4_unicode_ci = :code_value)
         ORDER BY id
         LIMIT 1'
    );
    $statement->execute([
        ':name_value' => $text,
        ':code_value' => $text,
    ]);

    return (int)$statement->fetchColumn();
}

function employee_csv_find_designation_id(PDO $pdo, string $value, int $divisionId): int
{
    $text = employee_csv_text($value);
    if ($text === '') {
        return 0;
    }

    if (ctype_digit($text)) {
        return (int)$text;
    }

    $sql = 'SELECT id
            FROM designations
            WHERE is_archived = 0
              AND name COLLATE utf8mb4_unicode_ci = :value';
    $params = [':value' => $text];

    if ($divisionId > 0) {
        $sql .= ' AND division_id = :division_id';
        $params[':division_id'] = $divisionId;
    }

    $sql .= ' ORDER BY id LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (int)$statement->fetchColumn();
}

function employee_csv_designation_belongs_to_division(PDO $pdo, int $designationId, int $divisionId): bool
{
    if ($designationId <= 0 || $divisionId <= 0) {
        return false;
    }

    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM designations
         WHERE id = :designation_id
           AND division_id = :division_id
           AND is_archived = 0'
    );
    $statement->execute([
        ':designation_id' => $designationId,
        ':division_id' => $divisionId,
    ]);

    return (int)$statement->fetchColumn() > 0;
}

function employee_csv_default_designation_id(PDO $pdo, int $divisionId): int
{
    if ($divisionId <= 0) {
        return 0;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM designations
         WHERE division_id = :division_id
           AND is_archived = 0
         ORDER BY id
         LIMIT 1'
    );
    $statement->execute([':division_id' => $divisionId]);

    return (int)$statement->fetchColumn();
}

function employee_csv_default_division_id(PDO $pdo): int
{
    $statement = $pdo->query(
        'SELECT id
         FROM divisions
         WHERE is_archived = 0
         ORDER BY id
         LIMIT 1'
    );

    return $statement !== false ? (int)$statement->fetchColumn() : 0;
}

function employee_csv_find_role_id(PDO $pdo, string $value): int
{
    $text = employee_csv_text($value);
    if ($text === '') {
        return 0;
    }

    if (ctype_digit($text)) {
        return (int)$text;
    }

    $roleKey = strtolower(preg_replace('/[^a-z0-9]+/i', '', $text) ?? '');
    if ($roleKey === '') {
        return 0;
    }

    $statement = $pdo->prepare(
        'SELECT id
         FROM roles
         WHERE LOWER(REPLACE(name, " ", "")) = :role_key
         ORDER BY id
         LIMIT 1'
    );
    $statement->execute([':role_key' => $roleKey]);

    return (int)$statement->fetchColumn();
}

function employee_csv_body(PDO $pdo, array $headers, array $row): array
{
    $body = [];

    foreach ($headers as $index => $key) {
        if ($key === '') {
            continue;
        }

        $body[$key] = employee_csv_text($row[$index] ?? '');
    }

    if (isset($body['dateOfBirth'])) {
        $body['dateOfBirth'] = employee_csv_date($body['dateOfBirth']);
    }

    if (isset($body['dateHired'])) {
        $body['dateHired'] = employee_csv_date($body['dateHired']);
    }

    if (isset($body['pwd'])) {
        $body['pwd'] = employee_csv_truthy($body['pwd']);
    }

    $divisionId = (int)($body['divisionId'] ?? 0);
    if ($divisionId <= 0) {
        $divisionId = employee_csv_find_division_id($pdo, (string)($body['divisionName'] ?? ''));
    }

    $designationId = (int)($body['designationId'] ?? 0);
    if ($designationId <= 0) {
        $designationId = employee_csv_find_designation_id($pdo, (string)($body['designationName'] ?? ''), $divisionId);
    }

    if (
        $designationId > 0
        && $divisionId > 0
        && !employee_csv_designation_belongs_to_division($pdo, $designationId, $divisionId)
    ) {
        $designationId = employee_csv_default_designation_id($pdo, $divisionId);
    }

    $body['divisionId'] = $divisionId;
    $body['designationId'] = $designationId;

    return $body;
}

function employee_duplicate_exists(PDO $pdo, array $employee): bool
{
    $statement = $pdo->prepare(
        'SELECT id
         FROM employees
         WHERE employee_id COLLATE utf8mb4_unicode_ci = :employee_id
            OR email COLLATE utf8mb4_unicode_ci = :email
         LIMIT 1'
    );
    $statement->execute([
        ':employee_id' => (string)($employee['employee_id'] ?? ''),
        ':email' => (string)($employee['email'] ?? ''),
    ]);

    return (bool)$statement->fetchColumn();
}

function employee_import_default_password(): string
{
    return '123';
}

function employee_import_employee_role_id(PDO $pdo): int
{
    $statement = $pdo->query(
        'SELECT id
         FROM roles
         WHERE LOWER(REPLACE(name, " ", "")) = "employee"
         ORDER BY id
         LIMIT 1'
    );

    return $statement !== false ? (int)$statement->fetchColumn() : 0;
}

function employee_import_duplicate_reason(PDO $pdo, array $employee): ?string
{
    $employeeId = trim((string)($employee['employee_id'] ?? ''));
    $email = trim((string)($employee['email'] ?? ''));

    if ($employeeId !== '') {
        $statement = $pdo->prepare(
            'SELECT COUNT(*)
             FROM employees
             WHERE employee_id COLLATE utf8mb4_unicode_ci = :employee_id'
        );
        $statement->execute([':employee_id' => $employeeId]);

        if ((int)$statement->fetchColumn() > 0) {
            return "Employee ID {$employeeId} already exists.";
        }
    }

    if ($email !== '') {
        $statement = $pdo->prepare(
            'SELECT COUNT(*)
             FROM employees
             WHERE email COLLATE utf8mb4_unicode_ci = :email'
        );
        $statement->execute([':email' => $email]);

        if ((int)$statement->fetchColumn() > 0) {
            return "Employee email {$email} already exists.";
        }

        $statement = $pdo->prepare(
            'SELECT COUNT(*)
             FROM users
             WHERE email COLLATE utf8mb4_unicode_ci = :email
                OR username COLLATE utf8mb4_unicode_ci = :username'
        );
        $statement->execute([
            ':email' => $email,
            ':username' => $email,
        ]);

        if ((int)$statement->fetchColumn() > 0) {
            return "User account for {$email} already exists.";
        }
    }

    return null;
}

function employee_import_name_piece(string $value, string $fallback): string
{
    $text = preg_replace('/[^a-z0-9]+/i', ' ', $value) ?? '';
    $text = trim(preg_replace('/\s+/', ' ', $text) ?? '');

    return $text === '' ? $fallback : ucwords(strtolower($text));
}

function employee_import_apply_defaults(PDO $pdo, array $employee): array
{
    $email = trim((string)($employee['email'] ?? ''));
    $emailLocalPart = $email !== '' ? strstr($email, '@', true) : false;
    $nameSeed = $emailLocalPart !== false && $emailLocalPart !== ''
        ? $emailLocalPart
        : trim((string)($employee['employee_id'] ?? ''));
    $nameParts = preg_split('/[^a-z0-9]+/i', $nameSeed, -1, PREG_SPLIT_NO_EMPTY) ?: [];

    if (trim((string)($employee['first_name'] ?? '')) === '') {
        $employee['first_name'] = employee_import_name_piece((string)($nameParts[0] ?? ''), 'Imported');
    }

    if (trim((string)($employee['last_name'] ?? '')) === '') {
        $lastNamePart = count($nameParts) > 1 ? (string)end($nameParts) : '';
        $employee['last_name'] = employee_import_name_piece($lastNamePart, 'Employee');
    }

    if ((int)($employee['division_id'] ?? 0) <= 0) {
        $employee['division_id'] = employee_csv_default_division_id($pdo);
    }

    if ((int)($employee['designation_id'] ?? 0) <= 0 && (int)($employee['division_id'] ?? 0) > 0) {
        $employee['designation_id'] = employee_csv_default_designation_id($pdo, (int)$employee['division_id']);
    }

    if (
        (int)($employee['designation_id'] ?? 0) > 0
        && (int)($employee['division_id'] ?? 0) > 0
        && !employee_csv_designation_belongs_to_division(
            $pdo,
            (int)$employee['designation_id'],
            (int)$employee['division_id']
        )
    ) {
        $employee['designation_id'] = employee_csv_default_designation_id($pdo, (int)$employee['division_id']);
    }

    return $employee;
}

function employee_import_payload_errors(PDO $pdo, array $employee): array
{
    $errors = [];

    if (trim((string)($employee['employee_id'] ?? '')) === '') {
        $errors[] = 'Employee ID is required.';
    }

    if (trim((string)($employee['first_name'] ?? '')) === '') {
        $errors[] = 'First name is required.';
    }

    if (trim((string)($employee['last_name'] ?? '')) === '') {
        $errors[] = 'Last name is required.';
    }

    if (
        trim((string)($employee['email'] ?? '')) === ''
        || filter_var($employee['email'], FILTER_VALIDATE_EMAIL) === false
    ) {
        $errors[] = 'Valid email is required.';
    } else {
        $emailPolicyViolation = hris_email_domain_policy_violation($pdo, (string)$employee['email']);
        if ($emailPolicyViolation !== null) {
            $errors[] = $emailPolicyViolation;
        }
    }

    if ((int)($employee['division_id'] ?? 0) <= 0) {
        $errors[] = 'Division is required or no active default division is available.';
    }

    if ((int)($employee['designation_id'] ?? 0) <= 0) {
        $errors[] = 'Designation is required or no active default designation is available.';
    }

    if ((int)($employee['division_id'] ?? 0) > 0 && (int)($employee['designation_id'] ?? 0) > 0) {
        $statement = $pdo->prepare(
            'SELECT COUNT(*) FROM designations
             WHERE id = :designation_id
               AND division_id = :division_id
               AND is_archived = 0'
        );
        $statement->execute([
            ':designation_id' => (int)$employee['designation_id'],
            ':division_id' => (int)$employee['division_id'],
        ]);

        if ((int)$statement->fetchColumn() === 0) {
            $errors[] = 'Selected designation does not belong to the selected division.';
        }
    }

    return $errors;
}

function employee_import_role_id(PDO $pdo, array $body, int $defaultRoleId): int
{
    $roleId = (int)($body['roleId'] ?? 0);
    if ($roleId <= 0) {
        $roleId = employee_csv_find_role_id($pdo, (string)($body['roleName'] ?? ''));
    }

    if ($roleId <= 0) {
        return $defaultRoleId;
    }

    return employee_role_exists($pdo, $roleId) ? $roleId : 0;
}

function create_imported_employee_user(PDO $pdo, array $employee, int $roleId, int $statusId): int
{
    $email = trim((string)($employee['email'] ?? ''));

    if ($email === '') {
        throw new RuntimeException('Employee email is required to create the imported user account.');
    }

    if ($roleId <= 0) {
        throw new RuntimeException('Default Employee role is not available.');
    }

    if ($statusId <= 0) {
        throw new RuntimeException('Active account status is not available.');
    }

    $statement = $pdo->prepare(
        'INSERT INTO users
            (username, email, password_hash, role_id, status_id, must_change_password,
             password_changed_at, failed_login_attempts, locked_until, is_archived)
         VALUES
            (:username, :email, :password_hash, :role_id, :status_id, 1,
             CURRENT_TIMESTAMP, 0, NULL, 0)'
    );
    $statement->execute([
        ':username' => $email,
        ':email' => $email,
        ':password_hash' => password_hash(employee_import_default_password(), PASSWORD_DEFAULT),
        ':role_id' => $roleId,
        ':status_id' => $statusId,
    ]);

    return (int)$pdo->lastInsertId();
}

function import_employees_csv(PDO $pdo): void
{
    $file = $_FILES['employeeFile'] ?? $_FILES['file'] ?? null;

    if (!is_array($file)) {
        json_response([
            'success' => false,
            'message' => 'Choose a CSV file to import.',
        ], 422);
    }

    if ((int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response([
            'success' => false,
            'message' => 'Unable to upload the employee CSV file.',
        ], 422);
    }

    $fileName = trim((string)($file['name'] ?? ''));
    $fileType = strtolower(trim((string)($file['type'] ?? '')));
    $isCsvFile = preg_match('/\.csv$/i', $fileName) === 1
        || in_array($fileType, ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'], true);

    if (!$isCsvFile) {
        json_response([
            'success' => false,
            'message' => 'Choose a valid CSV file.',
        ], 422);
    }

    $handle = fopen((string)($file['tmp_name'] ?? ''), 'rb');
    if ($handle === false) {
        json_response([
            'success' => false,
            'message' => 'Unable to read the employee CSV file.',
        ], 422);
    }

    $rawHeaders = fgetcsv($handle);
    if ($rawHeaders === false) {
        fclose($handle);
        json_response([
            'success' => false,
            'message' => 'The CSV file is empty.',
        ], 422);
    }

    $headers = array_map('employee_csv_canonical_key', $rawHeaders);
    if (!in_array('employeeId', $headers, true) || !in_array('email', $headers, true)) {
        fclose($handle);
        json_response([
            'success' => false,
            'message' => 'The CSV header must include employee_id and email columns.',
        ], 422);
    }

    $defaultRoleId = employee_import_employee_role_id($pdo);
    if ($defaultRoleId <= 0) {
        fclose($handle);
        json_response([
            'success' => false,
            'message' => 'Default Employee role is not available.',
        ], 422);
    }

    $activeStatusId = employee_active_status_id($pdo);
    if ($activeStatusId <= 0) {
        fclose($handle);
        json_response([
            'success' => false,
            'message' => 'Active account status is not available.',
        ], 422);
    }

    $summary = [
        'totalRows' => 0,
        'created' => 0,
        'userAccountsCreated' => 0,
        'duplicatesSkipped' => 0,
        'invalidRows' => 0,
    ];
    $invalidSamples = [];
    $importErrors = [];
    $createdIds = [];
    $createdUserIds = [];

    $pdo->beginTransaction();

    try {
        $lineNumber = 1;
        while (($row = fgetcsv($handle)) !== false) {
            $lineNumber++;
            $hasContent = count(array_filter($row, static fn ($value): bool => employee_csv_text($value) !== '')) > 0;
            if (!$hasContent) {
                continue;
            }

            $summary['totalRows']++;
            $body = employee_csv_body($pdo, $headers, $row);
            $rowRoleId = employee_import_role_id($pdo, $body, $defaultRoleId);
            $employee = employee_import_apply_defaults($pdo, employee_payload($body));

            if ($employee['employee_id'] === '') {
                $employee['employee_id'] = generate_employee_id($pdo);
            }

            $validationErrors = employee_import_payload_errors($pdo, $employee);
            if ($rowRoleId <= 0) {
                $validationErrors[] = 'Selected account role is not available.';
            }
            if ($validationErrors !== []) {
                $summary['invalidRows']++;
                if (count($invalidSamples) < 10) {
                    $invalidSamples[] = [
                        'line' => $lineNumber,
                        'employeeId' => $employee['employee_id'],
                        'email' => $employee['email'],
                        'reason' => implode(' ', $validationErrors),
                    ];
                }
                if (count($importErrors) < 50) {
                    $importErrors[] = "Line {$lineNumber}: " . implode(' ', $validationErrors);
                }
                continue;
            }

            $duplicateReason = employee_import_duplicate_reason($pdo, $employee);
            if ($duplicateReason !== null) {
                $summary['duplicatesSkipped']++;
                if (count($importErrors) < 50) {
                    $importErrors[] = "Line {$lineNumber}: {$duplicateReason}";
                }
                continue;
            }

            $rowSavepointStarted = false;

            try {
                $pdo->exec('SAVEPOINT employee_import_row');
                $rowSavepointStarted = true;

                $employeeRecordId = insert_employee_record($pdo, $employee);
                $userId = create_imported_employee_user($pdo, $employee, $rowRoleId, $activeStatusId);

                $pdo->exec('RELEASE SAVEPOINT employee_import_row');

                $createdIds[] = $employeeRecordId;
                $createdUserIds[] = $userId;
                $summary['created']++;
                $summary['userAccountsCreated']++;
            } catch (PDOException $exception) {
                if ($rowSavepointStarted) {
                    $pdo->exec('ROLLBACK TO SAVEPOINT employee_import_row');
                    $pdo->exec('RELEASE SAVEPOINT employee_import_row');
                }

                if ($exception->getCode() === '23000') {
                    $summary['duplicatesSkipped']++;
                    if (count($importErrors) < 50) {
                        $importErrors[] = "Line {$lineNumber}: Employee ID, email, or user account already exists.";
                    }
                    continue;
                }

                throw $exception;
            } catch (Throwable $exception) {
                if ($rowSavepointStarted) {
                    $pdo->exec('ROLLBACK TO SAVEPOINT employee_import_row');
                    $pdo->exec('RELEASE SAVEPOINT employee_import_row');
                }
                throw $exception;
            }
        }

        fclose($handle);
        $pdo->commit();
    } catch (Throwable $exception) {
        if (is_resource($handle)) {
            fclose($handle);
        }

        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    try {
        if ((int)$summary['created'] > 0) {
            hris_notify_roles(
                $pdo,
                ['admin', 'hrhead', 'hrstaff'],
                'Employees Imported',
                sprintf('%d employee record%s imported from CSV.', (int)$summary['created'], (int)$summary['created'] === 1 ? '' : 's'),
                'employee_added',
                'employee-import'
            );

            hris_notify_users(
                $pdo,
                $createdUserIds,
                'Account Created',
                'Your employee profile has been imported. Use your email address and temporary password to sign in.',
                'user_created',
                'employee-import'
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Employee import notification error: ' . $notificationException->getMessage());
    }

    write_auth_audit($pdo, session_user(), 'employee.imported', 'Employees were imported from CSV.', [
        'summary' => $summary,
        'createdIds' => $createdIds,
        'createdUserIds' => $createdUserIds,
    ]);

    json_response([
        'success' => true,
        'imported' => (int)$summary['created'],
        'failed' => (int)$summary['duplicatesSkipped'] + (int)$summary['invalidRows'],
        'userAccountsCreated' => (int)$summary['userAccountsCreated'],
        'userAccounts' => [
            'created' => (int)$summary['userAccountsCreated'],
            'defaultPassword' => employee_import_default_password(),
        ],
        'message' => sprintf(
            'Employee import completed. %d employee%s and %d user account%s created, %d duplicate%s skipped, %d invalid row%s.',
            (int)$summary['created'],
            (int)$summary['created'] === 1 ? '' : 's',
            (int)$summary['userAccountsCreated'],
            (int)$summary['userAccountsCreated'] === 1 ? '' : 's',
            (int)$summary['duplicatesSkipped'],
            (int)$summary['duplicatesSkipped'] === 1 ? '' : 's',
            (int)$summary['invalidRows'],
            (int)$summary['invalidRows'] === 1 ? '' : 's'
        ),
        'summary' => $summary,
        'invalidSamples' => $invalidSamples,
        'errors' => $importErrors,
        'createdIds' => $createdIds,
    ], 201);
}

function list_employees(PDO $pdo, bool $archived = false): void
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            e.employee_id AS employeeId,
            e.first_name AS firstName,
            e.middle_name AS middleName,
            e.last_name AS lastName,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS fullName,
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
         INNER JOIN divisions d ON d.id = e.division_id
         INNER JOIN designations des ON des.id = e.designation_id
         WHERE e.is_archived = :is_archived
         ORDER BY e.created_at DESC, e.id DESC'
    );
    $statement->execute([
        ':is_archived' => $archived ? 1 : 0,
    ]);

    json_response([
        'success' => true,
        'employees' => $statement->fetchAll(),
    ]);
}

function list_options(PDO $pdo): void
{
    $divisions = $pdo->query(
        'SELECT id, name, description, code
         FROM divisions
         WHERE is_archived = 0
         ORDER BY name'
    )->fetchAll();

    $designations = $pdo->query(
        'SELECT des.id, des.division_id, des.name
         FROM designations des
         INNER JOIN divisions d ON d.id = des.division_id
         WHERE des.is_archived = 0
           AND d.is_archived = 0
         ORDER BY d.name, des.name'
    )->fetchAll();

    json_response([
        'success' => true,
        'divisions' => $divisions,
        'designations' => $designations,
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && isset($_GET['options'])) {
    list_options($pdo);
}

if ($method === 'GET') {
    list_employees($pdo, (string)($_GET['archived'] ?? '') === '1');
}

$employeeAction = (string)($_POST['action'] ?? $_GET['action'] ?? '');
if ($method === 'POST' && in_array($employeeAction, ['importEmployeesCsv', 'import'], true)) {
    import_employees_csv($pdo);
}

$body = read_json_body();

if ($method === 'POST') {
    $employee = employee_payload($body);
    if ($employee['employee_id'] === '') {
        $employee['employee_id'] = generate_employee_id($pdo);
    }
    $roleId = (int)($body['roleId'] ?? 0);
    $sendActivationEmail = employee_bool($body['sendActivationEmail'] ?? false);
    validate_employee_payload($pdo, $employee);
    validate_employee_account_payload($pdo, $roleId);

    $savedEmployee = null;
    $linkedAccount = null;

    try {
        $pdo->beginTransaction();

        $employeeId = insert_employee_record($pdo, $employee);
        $savedEmployee = fetch_employee($pdo, $employeeId);

        if ($savedEmployee !== null && $roleId > 0) {
            $linkedAccount = upsert_employee_linked_user(
                $pdo,
                $savedEmployee,
                $roleId,
                null,
                $sendActivationEmail
            );
        }

        $pdo->commit();
    } catch (PDOException $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Employee ID, email, or linked user account already exists.',
            ], 409);
        }

        throw $exception;
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $accountResponse = employee_linked_account_response($linkedAccount, $savedEmployee ?? [], $sendActivationEmail);

    try {
        $employeeName = (string)($savedEmployee['fullName'] ?? trim((string)($savedEmployee['firstName'] ?? '')) . ' ' . trim((string)($savedEmployee['lastName'] ?? '')));
        $employeeName = trim($employeeName);
        $employeeLabel = (string)($savedEmployee['employeeId'] ?? ('#' . $employeeId));
        $divisionName = (string)($savedEmployee['division'] ?? 'the division');

        hris_notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Employee Added',
            sprintf('%s (%s) was added to %s.', $employeeName !== '' ? $employeeName : 'A new employee', $employeeLabel, $divisionName),
            'employee_added',
            (string)$employeeId
        );

        if ($linkedAccount !== null && !empty($linkedAccount['user']['id'])) {
            $linkedUserId = (int)$linkedAccount['user']['id'];
            $accountCreated = (bool)($linkedAccount['created'] ?? false);

            hris_notify_users(
                $pdo,
                [$linkedUserId],
                $accountCreated ? 'Account Created' : 'Account Updated',
                $accountCreated
                    ? 'Your employee profile has been created. Check your email for your temporary password.'
                    : 'Your linked account role has been updated to match your employee record.',
                $accountCreated ? 'user_created' : 'role_updated',
                (string)$employeeId
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Employee creation notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Employee created successfully.',
        'employee' => $savedEmployee,
        ...$accountResponse,
    ], 201);
}

if ($method === 'PUT') {
    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    $employee = employee_payload($body);
    $roleId = (int)($body['roleId'] ?? 0);
    $sendActivationEmail = employee_bool($body['sendActivationEmail'] ?? false);
    validate_employee_payload($pdo, $employee);
    validate_employee_account_payload($pdo, $roleId);

    $existingEmployee = fetch_employee($pdo, $id);

    if ($existingEmployee === null) {
        json_response([
            'success' => false,
            'message' => 'Employee record not found.',
        ], 404);
    }

    $savedEmployee = null;
    $linkedAccount = null;

    try {
        $pdo->beginTransaction();

        $statement = $pdo->prepare(
            'UPDATE employees
             SET employee_id = :employee_id,
                 first_name = :first_name,
                 middle_name = :middle_name,
                 last_name = :last_name,
                 date_of_birth = :date_of_birth,
                 address = :address,
                 city = :city,
                 province = :province,
                 zip_code = :zip_code,
                 gender = :gender,
                 email = :email,
                 phone = :phone,
                 division_id = :division_id,
                 designation_id = :designation_id,
                 basic_salary = :basic_salary,
                 salary_rate = :salary_rate,
                 date_hired = :date_hired,
                 status = :status,
                 employment_status = :employment_status,
                 pwd = :pwd,
                 civil_status = :civil_status,
                 height = :height,
                 weight = :weight,
                 blood_type = :blood_type,
                 emp_gsis_id_no = :emp_gsis_id_no,
                 emp_pagibig_id_no = :emp_pagibig_id_no,
                 emp_philhealth_id_no = :emp_philhealth_id_no,
                 tin_no = :tin_no
             WHERE id = :id
               AND is_archived = 0'
        );
        $statement->execute([
            ...array_combine(
                array_map(fn (string $key): string => ':' . $key, array_keys($employee)),
                array_values($employee)
            ),
            ':id' => $id,
        ]);

        $savedEmployee = fetch_employee($pdo, $id);

        employee_append_service_record(
            $pdo,
            $id,
            $existingEmployee,
            $savedEmployee ?? [],
            $body,
            (int)($sessionUser['id'] ?? 0) ?: null
        );

        if ($savedEmployee !== null && $roleId > 0) {
            $linkedAccount = upsert_employee_linked_user(
                $pdo,
                $savedEmployee,
                $roleId,
                (string)($existingEmployee['email'] ?? ''),
                $sendActivationEmail
            );
        }

        $pdo->commit();
    } catch (PDOException $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'Employee ID, email, or linked user account already exists.',
            ], 409);
        }

        throw $exception;
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    $accountResponse = employee_linked_account_response($linkedAccount, $savedEmployee ?? [], $sendActivationEmail);

    try {
        $employeeName = (string)($savedEmployee['fullName'] ?? trim((string)($savedEmployee['firstName'] ?? '')) . ' ' . trim((string)($savedEmployee['lastName'] ?? '')));
        $employeeName = trim($employeeName);
        $employeeLabel = (string)($savedEmployee['employeeId'] ?? ('#' . $id));
        $divisionName = (string)($savedEmployee['division'] ?? 'the division');

        hris_notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Employee Updated',
            sprintf('%s (%s) was updated in %s.', $employeeName !== '' ? $employeeName : 'An employee', $employeeLabel, $divisionName),
            'system_alert',
            (string)$id
        );

        if ($linkedAccount !== null && !empty($linkedAccount['user']['id'])) {
            $linkedUserId = (int)$linkedAccount['user']['id'];
            $accountCreated = (bool)($linkedAccount['created'] ?? false);

            hris_notify_users(
                $pdo,
                [$linkedUserId],
                $accountCreated ? 'Account Created' : 'Account Updated',
                $accountCreated
                    ? 'Your employee profile has been created and your account is ready to use.'
                    : 'Your linked account role has been updated to match your employee record.',
                $accountCreated ? 'user_created' : 'role_updated',
                (string)$id
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Employee update notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Employee updated successfully.',
        'employee' => $savedEmployee,
        ...$accountResponse,
    ]);
}

if ($method === 'PATCH') {
    $id = (int)($body['id'] ?? 0);
    $restore = (string)($body['restore'] ?? '') === '1';

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    if (!$restore) {
        json_response([
            'success' => false,
            'message' => 'Unsupported employee update action.',
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE employees SET is_archived = 0 WHERE id = :id AND is_archived = 1'
    );
    $statement->execute([':id' => $id]);

    $restoredEmployee = fetch_employee($pdo, $id);

    try {
        $employeeName = (string)($restoredEmployee['fullName'] ?? trim((string)($restoredEmployee['firstName'] ?? '')) . ' ' . trim((string)($restoredEmployee['lastName'] ?? '')));
        $employeeName = trim($employeeName);
        $employeeLabel = (string)($restoredEmployee['employeeId'] ?? ('#' . $id));

        hris_notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Account Activated',
            sprintf('%s (%s) has been restored.', $employeeName !== '' ? $employeeName : 'An employee', $employeeLabel),
            'account_activated',
            (string)$id
        );

        $linkedUser = $restoredEmployee !== null
            ? find_employee_user_for_emails($pdo, [(string)($restoredEmployee['email'] ?? '')])
            : null;

        if ($linkedUser !== null) {
            hris_notify_users(
                $pdo,
                [(int)$linkedUser['id']],
                'Account Activated',
                'Your employee profile has been restored and your account is active again.',
                'account_activated',
                (string)$id
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Employee restore notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Employee restored successfully.',
        'employee' => $restoredEmployee,
    ]);
}

if ($method === 'DELETE') {
    $id = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    $archivedEmployee = fetch_employee($pdo, $id);

    $statement = $pdo->prepare(
        'UPDATE employees SET is_archived = 1 WHERE id = :id'
    );
    $statement->execute([':id' => $id]);

    try {
        $employeeName = (string)($archivedEmployee['fullName'] ?? trim((string)($archivedEmployee['firstName'] ?? '')) . ' ' . trim((string)($archivedEmployee['lastName'] ?? '')));
        $employeeName = trim($employeeName);
        $employeeLabel = (string)($archivedEmployee['employeeId'] ?? ('#' . $id));

        hris_notify_roles(
            $pdo,
            ['admin', 'hrhead', 'hrstaff'],
            'Employee Archived',
            sprintf('%s (%s) has been archived.', $employeeName !== '' ? $employeeName : 'An employee', $employeeLabel),
            'system_alert',
            (string)$id
        );

        $linkedUser = $archivedEmployee !== null
            ? find_employee_user_for_emails($pdo, [(string)($archivedEmployee['email'] ?? '')])
            : null;

        if ($linkedUser !== null) {
            hris_notify_users(
                $pdo,
                [(int)$linkedUser['id']],
                'Account Deactivated',
                'Your employee profile has been archived and your account can no longer be used to sign in.',
                'account_deactivated',
                (string)$id
            );
        }
    } catch (Throwable $notificationException) {
        error_log('Employee archive notification error: ' . $notificationException->getMessage());
    }

    json_response([
        'success' => true,
        'message' => 'Employee archived successfully.',
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
