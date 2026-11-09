<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();
require_method('POST');
ensure_employee_suffix_column($pdo);
ensure_employee_pds_photo_column($pdo);

function employee_profile_int(mixed $value): int
{
    return (int)($value ?? 0);
}

function employee_profile_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function fetch_employee_profile_record(PDO $pdo, int $id): ?array
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
            e.include_profile_image_in_pds AS includeProfileImageInPds,
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
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

function store_profile_image(array $file): string
{
    $error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($error !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Unable to upload the profile picture.');
    }

    $originalName = employee_profile_text($file['name'] ?? '');
    $temporaryFile = employee_profile_text($file['tmp_name'] ?? '');
    $fileSize = (int)($file['size'] ?? 0);
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowedExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

    if ($originalName === '' || $temporaryFile === '') {
        throw new RuntimeException('Uploaded profile picture is invalid.');
    }

    if ($extension === '' || !in_array($extension, $allowedExtensions, true)) {
        throw new RuntimeException('Unsupported profile picture file type.');
    }

    if ($fileSize <= 0) {
        throw new RuntimeException('Uploaded profile picture is empty.');
    }

    if ($fileSize > 5 * 1024 * 1024) {
        throw new RuntimeException('Profile picture must be 5 MB or smaller.');
    }

    $uploadDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'profile-images';
    if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true) && !is_dir($uploadDirectory)) {
        throw new RuntimeException('Unable to prepare the profile image folder.');
    }

    $storedFileName = 'profile_' . date('Ymd_His') . '_' . bin2hex(random_bytes(8)) . '.' . $extension;
    $absolutePath = $uploadDirectory . DIRECTORY_SEPARATOR . $storedFileName;

    if (!move_uploaded_file($temporaryFile, $absolutePath)) {
        throw new RuntimeException('Unable to save the uploaded profile picture.');
    }

    return 'uploads/profile-images/' . rawurlencode($storedFileName);
}

function remove_profile_image_file(?string $storedPath): void
{
    $path = employee_profile_text($storedPath);
    if ($path === '' || preg_match('/^(https?:|data:|blob:)/i', $path) === 1) {
        return;
    }

    $baseDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'profile-images';
    $normalizedRelativePath = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $path);
    $absolutePath = dirname(__DIR__) . DIRECTORY_SEPARATOR . ltrim($normalizedRelativePath, DIRECTORY_SEPARATOR);
    $resolvedBaseDirectory = realpath($baseDirectory);
    $resolvedAbsolutePath = realpath($absolutePath);

    if ($resolvedBaseDirectory === false || $resolvedAbsolutePath === false) {
        return;
    }

    if (strpos($resolvedAbsolutePath, $resolvedBaseDirectory) !== 0 || !is_file($resolvedAbsolutePath)) {
        return;
    }

    @unlink($resolvedAbsolutePath);
}

$employeeId = employee_profile_int($_POST['employeeId'] ?? 0);
$remove = employee_profile_text($_POST['remove'] ?? '') === '1';

if ($employeeId <= 0) {
    json_response([
        'success' => false,
        'message' => 'Employee record is required.',
    ], 422);
}

/*
 * `employeeId` arrives from the request body, so before this check any signed-in account could
 * replace or delete the photo on anyone else's record just by changing the number.
 *
 * The three callers are the profile page saving its own avatar and the two management screens, so
 * self-or-HR matches what the app already does.
 */
require_employee_record_access(
    $pdo,
    $sessionUser,
    $employeeId,
    'You can only change your own profile picture.'
);

$existingEmployee = fetch_employee_profile_record($pdo, $employeeId);
if ($existingEmployee === null) {
    json_response([
        'success' => false,
        'message' => 'Employee record not found.',
    ], 404);
}

$currentProfileImage = employee_profile_text($existingEmployee['profileImage'] ?? '');
$nextProfileImage = $currentProfileImage;
$includeProfileImageInPds = (int)($existingEmployee['includeProfileImageInPds'] ?? 1);
$hasPdsPreference = array_key_exists('includeProfileImageInPds', $_POST);
if ($hasPdsPreference) {
    if (!in_array($_POST['includeProfileImageInPds'], ['0', '1'], true)) {
        json_response(['success' => false, 'message' => 'Choose whether to include your profile picture in your PDS.'], 422);
    }
    $includeProfileImageInPds = (int)$_POST['includeProfileImageInPds'];
}

try {
    if ($remove) {
        $nextProfileImage = null;
    } elseif (isset($_FILES['profileImage']) && is_array($_FILES['profileImage'])) {
        $nextProfileImage = store_profile_image($_FILES['profileImage']);
    } elseif (!$hasPdsPreference) {
        json_response([
            'success' => false,
            'message' => 'Profile picture file is required.',
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE employees
         SET profile_image = :profile_image,
             include_profile_image_in_pds = :include_profile_image_in_pds
         WHERE id = :id
           AND is_archived = 0'
    );
    $statement->bindValue(':profile_image', $nextProfileImage !== null ? $nextProfileImage : null, $nextProfileImage !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $statement->bindValue(':include_profile_image_in_pds', $includeProfileImageInPds, PDO::PARAM_INT);
    $statement->bindValue(':id', $employeeId, PDO::PARAM_INT);
    $statement->execute();

    if ($currentProfileImage !== '' && $currentProfileImage !== $nextProfileImage) {
        remove_profile_image_file($currentProfileImage);
    }
} catch (RuntimeException $exception) {
    json_response([
        'success' => false,
        'message' => $exception->getMessage(),
    ], 422);
}

json_response([
    'success' => true,
    'message' => $remove ? 'Profile picture removed successfully.' : 'Profile picture updated successfully.',
    'employee' => fetch_employee_profile_record($pdo, $employeeId),
]);
