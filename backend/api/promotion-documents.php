<?php
declare(strict_types=1);

const PROMOTION_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

function promotion_document_types(): array
{
    return [
        'pdf' => ['application/pdf'],
        'png' => ['image/png'],
        'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'],
        'webp' => ['image/webp'],
        'doc' => ['application/msword', 'application/x-ole-storage', 'application/CDFV2'],
        'xls' => ['application/vnd.ms-excel', 'application/x-ole-storage', 'application/CDFV2'],
        'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
        'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
    ];
}

function promotion_document_id_valid(string $id): bool
{
    return preg_match('/^[a-f0-9]{32}\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/D', $id) === 1;
}

function promotion_documents_root(): string
{
    return dirname(__DIR__) . '/uploads/promotion-documents';
}

/** Resolve only files owned by this application; never accept a client-supplied filesystem path. */
function promotion_document_path(int $promotionId, string $id): ?string
{
    if ($promotionId <= 0 || !promotion_document_id_valid($id)) return null;
    $root = realpath(promotion_documents_root());
    $path = realpath(promotion_documents_root() . '/' . $promotionId . '/' . $id);
    if (!$root || !$path || !str_starts_with($path, $root . DIRECTORY_SEPARATOR) || !is_file($path)) return null;
    return $path;
}

/** Validate actual bytes on disk as well as PHP's upload status and reported size. */
function promotion_document_validate(array $upload): array
{
    $error = (int)($upload['error'] ?? UPLOAD_ERR_NO_FILE);
    if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
        throw new DomainException('Each supporting document must be 10 MB or smaller.', 422);
    }
    if ($error !== UPLOAD_ERR_OK) throw new DomainException('The document upload did not complete. Choose the file again.', 422);
    $temporary = $upload['tmp_name'] ?? null;
    $name = $upload['name'] ?? null;
    if (!is_string($temporary) || !is_string($name) || !is_file($temporary)) throw new DomainException('Choose a valid document to upload.', 422);
    $size = filesize($temporary);
    if ($size === false || $size <= 0) throw new DomainException('The uploaded document is empty.', 422);
    if ($size > PROMOTION_DOCUMENT_MAX_BYTES || (int)($upload['size'] ?? 0) > PROMOTION_DOCUMENT_MAX_BYTES) {
        throw new DomainException('Each supporting document must be 10 MB or smaller.', 422);
    }
    $name = basename(str_replace('\\', '/', $name));
    $name = trim((string)preg_replace('/[\x00-\x1f\x7f]/', '', $name));
    if ($name === '' || strlen($name) > 240) throw new DomainException('Choose a document with a shorter file name.', 422);
    $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $types = promotion_document_types();
    if (!isset($types[$extension])) throw new DomainException('Upload a PDF, PNG, JPG, WEBP, Word, or Excel document.', 422);
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($temporary);
    if (!in_array($mime, $types[$extension], true)) throw new DomainException('The document contents do not match its file type.', 422);
    if (in_array($extension, ['docx', 'xlsx'], true)) {
        // PharData inspects package entries without extracting content or requiring XAMPP's ext-zip.
        try {
            $zip = new PharData($temporary, 0, null, Phar::ZIP);
            $part = $extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
            $valid = isset($zip['[Content_Types].xml'], $zip[$part]);
        } catch (Throwable $exception) {
            throw new DomainException('The Office document is invalid.', 422);
        } finally { unset($zip); }
        if (!$valid) throw new DomainException('The Office document contents do not match its file type.', 422);
    }
    return ['name' => $name, 'size' => (int)$size, 'extension' => $extension, 'mime' => $types[$extension][0]];
}

function promotion_document_store(int $promotionId, array $upload, array $user): array
{
    $document = promotion_document_validate($upload);
    if (!is_uploaded_file($upload['tmp_name'])) throw new DomainException('The uploaded document is invalid.', 422);
    $directory = promotion_documents_root() . '/' . $promotionId;
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        throw new RuntimeException('Unable to prepare the supporting document folder.');
    }
    $id = bin2hex(random_bytes(16)) . '.' . $document['extension'];
    if (!move_uploaded_file($upload['tmp_name'], $directory . '/' . $id)) throw new RuntimeException('Unable to save the supporting document.');
    unset($document['extension']);
    return $document + ['id' => $id, 'uploadedAt' => date('Y-m-d H:i:s'), 'uploadedBy' => (int)($user['id'] ?? 0)];
}

/** Only a newly uploaded file is removed on rollback; saved history keeps its documents. */
function promotion_document_rollback(int $promotionId, ?array $document): void
{
    $path = $document ? promotion_document_path($promotionId, (string)$document['id']) : null;
    if ($path !== null && !unlink($path)) error_log('Unable to remove rolled-back promotion document.');
}

/** Retain metadata from the server record, never from client-supplied document objects. */
function promotion_submission_input(array $input, array $saved): array
{
    $documents = is_array($saved['documents'] ?? null) ? $saved['documents'] : [];
    $known = array_column($documents, null, 'id');
    $ids = $input['documentIds'] ?? array_keys($known);
    if (!is_array($ids)) throw new DomainException('Invalid supporting document selection.', 422);
    $retained = [];
    foreach ($ids as $id) {
        if (!is_string($id) || !isset($known[$id])) throw new DomainException('A selected document does not belong to this application. Refresh and try again.', 422);
        $retained[$id] = $known[$id];
    }
    $input['documents'] = array_values($retained);
    $input['documentReferences'] = is_string($saved['documents'] ?? null) ? $saved['documents'] : ($saved['documentReferences'] ?? '');
    return $input;
}

/** Shared read rule: HR's scoped register, or the employee's own approved promotion. */
function promotion_document_require_access(PDO $pdo, array $user, ?array $promotion): array
{
    if ($promotion === null) throw new DomainException('Promotion not found.', 404);
    if (!promotion_can_view_all($user)
        && ($promotion['statusKey'] !== 'approved' || session_employee_record_id($pdo, $user) !== $promotion['employeeRecordId'])) {
        throw new DomainException('You can only view documents for your own approved promotions.', 403);
    }
    return $promotion;
}

function download_promotion_document(PDO $pdo, array $user): void
{
    $id = (int)($_GET['id'] ?? 0);
    $documentId = is_string($_GET['documentId'] ?? null) ? $_GET['documentId'] : '';
    try {
        $promotion = promotion_document_require_access($pdo, $user, fetch_promotion($pdo, $id, promotion_division_scope_id($pdo, $user)));
        $documents = $promotion['stageDetails']->submission['documents'] ?? [];
        $documents = is_array($documents) ? $documents : [];
        // Earlier attachments remain readable in the audit history after they are removed from submission.
        foreach ($promotion['stageHistory'] as $entry) {
            if (is_array($entry['details']['documents'] ?? null)) $documents = array_merge($documents, $entry['details']['documents']);
        }
        $document = null;
        foreach ($documents as $candidate) {
            if (($candidate['id'] ?? '') === $documentId) { $document = $candidate; break; }
        }
        $path = $document ? promotion_document_path($id, $documentId) : null;
        if ($path === null) throw new DomainException('Supporting document not found.', 404);
    } catch (DomainException $exception) {
        json_response(['success' => false, 'message' => $exception->getMessage()], $exception->getCode());
    }
    $fallback = preg_replace('/[^A-Za-z0-9._-]/', '_', $document['name']) ?: 'supporting-document';
    header('Content-Type: ' . $document['mime']);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: attachment; filename="' . $fallback . '"; filename*=UTF-8\'\'' . rawurlencode($document['name']));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    readfile($path);
    exit;
}
