<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

/*
 * Sample profile pictures for every employee, so avatars across the app show a face instead of
 * initials during demos.
 *
 * The faces in database/sample-faces/ are AI-generated portraits of people who do not exist, from
 * thispersondoesnotexist.com, sorted into female/ and male/. No real person's photo ends up on an
 * employee's record. Employees are matched to a face of their own gender in employee order, so a
 * re-run gives everyone the same face.
 *
 * Each face is copied into uploads/profile-images/ under a random name, the same as an upload
 * through the profile page, and employees.profile_image holds the path. Copies are named
 * `profile_sample_...`: employees who uploaded their own picture are skipped, and a re-run or
 * --remove only ever replaces or deletes sample copies.
 *
 * Usage, from frontend/backend:
 *   php database/seed_profile_pictures.php           replace the sample pictures
 *   php database/seed_profile_pictures.php --remove  remove the sample pictures only
 */

const PICTURE_DIRECTORY = 'uploads/profile-images';
const PICTURE_SAMPLE_PREFIX = 'profile_sample_';

function picture_is_sample(?string $storedPath): bool
{
    return str_starts_with((string)$storedPath, PICTURE_DIRECTORY . '/' . PICTURE_SAMPLE_PREFIX);
}

function picture_absolute_path(string $storedPath): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, rawurldecode($storedPath));
}

function picture_delete_file(string $storedPath): void
{
    $path = picture_absolute_path($storedPath);
    if (picture_is_sample($storedPath) && is_file($path)) {
        unlink($path);
    }
}

$host = getenv('HRIS_DB_HOST') ?: '127.0.0.1';
$password = getenv('HRIS_DB_PASSWORD');
$pdo = new PDO(
    'mysql:host=' . $host . ';dbname=' . (getenv('HRIS_DB_NAME') ?: 'hris') . ';charset=utf8mb4',
    getenv('HRIS_DB_USER') ?: 'root',
    $password === false ? '' : $password,
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]
);

$employees = $pdo->query(
    'SELECT id, employee_id, first_name, last_name, gender, profile_image
     FROM employees
     WHERE is_archived = 0
     ORDER BY id'
)->fetchAll();
$update = $pdo->prepare('UPDATE employees SET profile_image = :profile_image WHERE id = :id');

if (in_array('--remove', $argv, true)) {
    $removed = 0;

    foreach ($employees as $employee) {
        if (picture_is_sample($employee['profile_image'])) {
            $update->execute([':profile_image' => null, ':id' => (int)$employee['id']]);
            picture_delete_file((string)$employee['profile_image']);
            $removed++;
        }
    }

    echo "Removed {$removed} sample profile pictures.\n";
    exit(0);
}

$faces = [];
foreach (['female', 'male'] as $gender) {
    $faces[$gender] = glob(__DIR__ . "/sample-faces/{$gender}/*.jpg") ?: [];
    sort($faces[$gender]);

    if ($faces[$gender] === []) {
        fwrite(STDERR, "No faces found in database/sample-faces/{$gender}/.\n");
        exit(1);
    }
}

$directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, PICTURE_DIRECTORY);
if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
    fwrite(STDERR, "Unable to create {$directory}.\n");
    exit(1);
}

// New copies are written first and the old sample files deleted only once the database points at
// the new ones, so a failure part-way leaves every picture working.
$written = [];
$replaced = [];
$nextFace = ['female' => 0, 'male' => 0];

$pdo->beginTransaction();

try {
    foreach ($employees as $employee) {
        $current = trim((string)$employee['profile_image']);

        if ($current !== '' && !picture_is_sample($current)) {
            echo "Skipped {$employee['employee_id']} {$employee['first_name']} {$employee['last_name']}: has their own picture.\n";
            continue;
        }

        // A face of their own gender, in employee order; faces are reused only if they run out.
        $gender = strcasecmp((string)$employee['gender'], 'Female') === 0 ? 'female' : 'male';
        $source = $faces[$gender][$nextFace[$gender]++ % count($faces[$gender])];

        $storedPath = PICTURE_DIRECTORY . '/' . PICTURE_SAMPLE_PREFIX . bin2hex(random_bytes(8)) . '.jpg';
        if (!copy($source, picture_absolute_path($storedPath))) {
            throw new RuntimeException("Unable to write {$storedPath}.");
        }
        $written[] = $storedPath;

        $update->execute([':profile_image' => $storedPath, ':id' => (int)$employee['id']]);

        if ($current !== '') {
            $replaced[] = $current;
        }
    }

    $pdo->commit();
} catch (Throwable $error) {
    $pdo->rollBack();
    foreach ($written as $storedPath) {
        picture_delete_file($storedPath);
    }
    fwrite(STDERR, 'Seeding failed, nothing was changed: ' . $error->getMessage() . "\n");
    exit(1);
}

foreach ($replaced as $storedPath) {
    picture_delete_file($storedPath);
}

foreach (['female', 'male'] as $gender) {
    if ($nextFace[$gender] > count($faces[$gender])) {
        echo "Note: {$nextFace[$gender]} {$gender} employees share " . count($faces[$gender]) . " faces, so some repeat.\n";
    }
}

echo 'Added sample profile pictures for ' . count($written) . " employees.\n";
