<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

/*
 * Personal documents -- birth certificate, valid IDs, resume/CV, diploma -- stored as files and
 * nothing else. There is no table behind this endpoint by design: the directory IS the index.
 *
 * Every upload lands in uploads/employee-documents/{employee record id}/ under a name that carries
 * everything a row would have held, so scanning one folder and parsing its names reproduces the
 * listing:
 *
 *     valid_id__20260809_142233__9f3c1ab2c4d5e6f7__Drivers-License.pdf
 *     ^type     ^uploaded        ^16 random hex     ^original name
 *
 * Parts split on a DOUBLE underscore. Type keys carry single underscores (birth_certificate) and the
 * sanitiser collapses everything outside [A-Za-z0-9-] in the original name to a dash, so the
 * separator cannot appear inside a part and the split is always exactly four pieces.
 *
 * The random block is what keeps a stored file from being guessable, the same trick the profile
 * images use -- uploads/.htaccess turns directory listing off so the folder cannot be walked.
 */

const EMPLOYEE_DOCUMENTS_MAX_BYTES = 10 * 1024 * 1024;
const EMPLOYEE_DOCUMENTS_PUBLIC_ROOT = 'uploads/employee-documents';

function employee_documents_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function employee_documents_int(mixed $value): int
{
    return (int)($value ?? 0);
}

function employee_documents_flag(mixed $value): bool
{
    return in_array(strtolower(employee_documents_text($value)), ['1', 'true', 'yes', 'on'], true);
}

/** The document kinds the profile page offers. A type outside this list is rejected on upload. */
function employee_document_type_labels(): array
{
    return [
        'birth_certificate' => 'Birth Certificate',
        'valid_id' => 'Valid ID',
        'resume' => 'Resume / CV',
        'diploma' => 'Diploma',
    ];
}

function employee_documents_allowed_extensions(): array
{
    return ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
}

function employee_documents_root(): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'employee-documents';
}

function employee_documents_directory(int $employeeId): string
{
    return employee_documents_root() . DIRECTORY_SEPARATOR . $employeeId;
}

/**
 * Strips the original file name down to something safe to embed in a stored name.
 *
 * Underscores go too, not only path characters: the double underscore is the field separator, so a
 * file called "my__id.pdf" would otherwise split into five parts and be listed as the wrong type.
 */
function employee_documents_sanitize_name(string $originalName): string
{
    $base = (string)pathinfo($originalName, PATHINFO_FILENAME);
    $base = (string)preg_replace('/[^A-Za-z0-9-]+/', '-', $base);
    $base = trim($base, '-');
    $base = substr($base, 0, 60);

    return $base === '' ? 'document' : $base;
}

function employee_documents_entry(int $employeeId, string $fileName): ?array
{
    $parts = explode('__', $fileName);

    if (count($parts) !== 4) {
        return null;
    }

    [$documentType, $uploadedStamp, , $originalName] = $parts;
    $labels = employee_document_type_labels();

    if (!isset($labels[$documentType])) {
        return null;
    }

    $absolutePath = employee_documents_directory($employeeId) . DIRECTORY_SEPARATOR . $fileName;

    if (!is_file($absolutePath)) {
        return null;
    }

    $uploadedAt = DateTimeImmutable::createFromFormat('Ymd_His', $uploadedStamp);
    $modifiedAt = filemtime($absolutePath);

    return [
        'id' => $fileName,
        'documentType' => $documentType,
        'typeLabel' => $labels[$documentType],
        'fileName' => $originalName,
        'extension' => strtolower((string)pathinfo($fileName, PATHINFO_EXTENSION)),
        'size' => (int)filesize($absolutePath),
        'uploadedAt' => $uploadedAt instanceof DateTimeImmutable
            ? $uploadedAt->format('Y-m-d H:i:s')
            : date('Y-m-d H:i:s', $modifiedAt === false ? time() : $modifiedAt),
        'sortKey' => $uploadedStamp,
        'path' => EMPLOYEE_DOCUMENTS_PUBLIC_ROOT . '/' . $employeeId . '/' . rawurlencode($fileName),
    ];
}

function employee_documents_list(int $employeeId): array
{
    $directory = employee_documents_directory($employeeId);

    if (!is_dir($directory)) {
        return [];
    }

    $fileNames = scandir($directory);
    $documents = [];

    foreach ($fileNames === false ? [] : $fileNames as $fileName) {
        if ($fileName === '.' || $fileName === '..') {
            continue;
        }

        $entry = employee_documents_entry($employeeId, $fileName);

        if ($entry !== null) {
            $documents[] = $entry;
        }
    }

    // Newest first, so the most recent copy of a re-uploaded document leads its group.
    usort($documents, static fn (array $left, array $right): int => strcmp($right['sortKey'], $left['sortKey']));

    return array_map(static function (array $document): array {
        unset($document['sortKey']);
        return $document;
    }, $documents);
}

function employee_documents_require_employee(PDO $pdo, int $employeeId): void
{
    if ($employeeId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    /*
     * Archived records are readable here on purpose -- the admin directory opens the same viewer for
     * an archived employee, and 404ing their documents would make the panel look broken.
     */
    $statement = $pdo->prepare('SELECT id FROM employees WHERE id = :id LIMIT 1');
    $statement->execute([':id' => $employeeId]);

    if ((int)$statement->fetchColumn() <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record not found.',
        ], 404);
    }
}

function employee_documents_resolve_self(PDO $pdo, array $sessionUser): int
{
    $employeeId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);

    if ($employeeId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Your account is not linked to an employee record.',
        ], 404);
    }

    return $employeeId;
}

/** Turns a client-supplied document id back into a path, or answers the request with an error. */
function employee_documents_resolve_file(int $employeeId, string $documentId): string
{
    if ($documentId === '' || preg_match('/^[A-Za-z0-9._-]+$/', $documentId) !== 1 || str_contains($documentId, '..')) {
        json_response([
            'success' => false,
            'message' => 'Document reference is invalid.',
        ], 422);
    }

    $resolvedDirectory = realpath(employee_documents_directory($employeeId));
    $resolvedFile = $resolvedDirectory === false
        ? false
        : realpath($resolvedDirectory . DIRECTORY_SEPARATOR . $documentId);

    if (
        $resolvedDirectory === false
        || $resolvedFile === false
        || strpos($resolvedFile, $resolvedDirectory . DIRECTORY_SEPARATOR) !== 0
        || !is_file($resolvedFile)
    ) {
        json_response([
            'success' => false,
            'message' => 'Document not found.',
        ], 404);
    }

    return $resolvedFile;
}

function employee_documents_store(int $employeeId, string $documentType, array $file): array
{
    $error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);

    if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
        throw new RuntimeException('The document is larger than the server accepts.');
    }

    if ($error !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Unable to upload the document.');
    }

    $originalName = employee_documents_text($file['name'] ?? '');
    $temporaryFile = employee_documents_text($file['tmp_name'] ?? '');
    $fileSize = (int)($file['size'] ?? 0);
    $extension = strtolower((string)pathinfo($originalName, PATHINFO_EXTENSION));

    if ($originalName === '' || $temporaryFile === '' || !is_uploaded_file($temporaryFile)) {
        throw new RuntimeException('The uploaded document is invalid.');
    }

    if ($extension === '' || !in_array($extension, employee_documents_allowed_extensions(), true)) {
        throw new RuntimeException('Documents must be a PDF, PNG, JPG, or WEBP file.');
    }

    if ($fileSize <= 0) {
        throw new RuntimeException('The uploaded document is empty.');
    }

    if ($fileSize > EMPLOYEE_DOCUMENTS_MAX_BYTES) {
        throw new RuntimeException('Documents must be 10 MB or smaller.');
    }

    $directory = employee_documents_directory($employeeId);
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        throw new RuntimeException('Unable to prepare the employee document folder.');
    }

    $storedFileName = implode('__', [
        $documentType,
        date('Ymd_His'),
        bin2hex(random_bytes(8)),
        employee_documents_sanitize_name($originalName),
    ]) . '.' . $extension;

    if (!move_uploaded_file($temporaryFile, $directory . DIRECTORY_SEPARATOR . $storedFileName)) {
        throw new RuntimeException('Unable to save the uploaded document.');
    }

    $entry = employee_documents_entry($employeeId, $storedFileName);

    if ($entry === null) {
        throw new RuntimeException('The document was saved but could not be read back.');
    }

    unset($entry['sortKey']);

    return $entry;
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'GET') {
    $employeeId = employee_documents_flag($_GET['self'] ?? null)
        ? employee_documents_resolve_self($pdo, $sessionUser)
        : employee_documents_int($_GET['employeeId'] ?? 0);

    /*
     * These are birth certificates and government IDs, so unlike the e-signature endpoint the read is
     * gated the same way the write is: your own record, or an account that manages employee records.
     */
    require_employee_record_access(
        $pdo,
        $sessionUser,
        $employeeId,
        'You can only view your own documents.'
    );

    employee_documents_require_employee($pdo, $employeeId);

    json_response([
        'success' => true,
        'employeeId' => $employeeId,
        'documentTypes' => employee_document_type_labels(),
        'documents' => employee_documents_list($employeeId),
    ]);
}

if ($method === 'POST') {
    $employeeId = employee_documents_flag($_POST['self'] ?? null)
        ? employee_documents_resolve_self($pdo, $sessionUser)
        : employee_documents_int($_POST['employeeId'] ?? 0);
    $documentType = employee_documents_text($_POST['documentType'] ?? '');

    require_employee_record_access(
        $pdo,
        $sessionUser,
        $employeeId,
        'You can only upload documents to your own record.'
    );

    employee_documents_require_employee($pdo, $employeeId);

    if (!isset(employee_document_type_labels()[$documentType])) {
        json_response([
            'success' => false,
            'message' => 'Choose a valid document type.',
        ], 422);
    }

    if (!isset($_FILES['document']) || !is_array($_FILES['document'])) {
        json_response([
            'success' => false,
            'message' => 'A document file is required.',
        ], 422);
    }

    try {
        $document = employee_documents_store($employeeId, $documentType, $_FILES['document']);
    } catch (RuntimeException $exception) {
        json_response([
            'success' => false,
            'message' => $exception->getMessage(),
        ], 422);
    }

    json_response([
        'success' => true,
        'message' => 'Document uploaded successfully.',
        'employeeId' => $employeeId,
        'document' => $document,
        'documents' => employee_documents_list($employeeId),
    ]);
}

if ($method === 'DELETE') {
    $body = read_json_body();
    $employeeId = employee_documents_flag($body['self'] ?? null)
        ? employee_documents_resolve_self($pdo, $sessionUser)
        : employee_documents_int($body['employeeId'] ?? 0);
    $documentId = employee_documents_text($body['documentId'] ?? '');

    require_employee_record_access(
        $pdo,
        $sessionUser,
        $employeeId,
        'You can only remove documents from your own record.'
    );

    employee_documents_require_employee($pdo, $employeeId);

    $absolutePath = employee_documents_resolve_file($employeeId, $documentId);

    if (!@unlink($absolutePath)) {
        json_response([
            'success' => false,
            'message' => 'Unable to remove the document.',
        ], 500);
    }

    json_response([
        'success' => true,
        'message' => 'Document removed successfully.',
        'employeeId' => $employeeId,
        'documents' => employee_documents_list($employeeId),
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
