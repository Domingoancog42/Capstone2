<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

function employee_signature_int(mixed $value): int
{
    return (int)($value ?? 0);
}

function employee_signature_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function employee_signature_flag(mixed $value): bool
{
    $normalizedValue = strtolower(employee_signature_text($value));
    return in_array($normalizedValue, ['1', 'true', 'yes', 'on'], true);
}

function fetch_employee_signature_record(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            id,
            e_signature AS signatureDataUrl
         FROM employees
         WHERE id = :id
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $id]);
    $employee = $statement->fetch();

    return $employee ?: null;
}

function validate_employee_signature(mixed $value): ?string
{
    $signature = employee_signature_text($value);

    if ($signature === '') {
        return null;
    }

    if (preg_match('/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i', $signature) !== 1) {
        json_response([
            'success' => false,
            'message' => 'Signature must be a valid PNG, JPG, GIF, WEBP, or BMP image.',
        ], 422);
    }

    $encodedPayload = preg_replace('/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i', '', $signature);
    $decodedPayload = base64_decode((string)$encodedPayload, true);

    if ($decodedPayload === false) {
        json_response([
            'success' => false,
            'message' => 'Signature image data is invalid.',
        ], 422);
    }

    if (strlen($decodedPayload) > 5 * 1024 * 1024) {
        json_response([
            'success' => false,
            'message' => 'Signature image must be 5 MB or smaller.',
        ], 422);
    }

    return $signature;
}

function require_employee_signature_record(PDO $pdo, int $employeeId): array
{
    if ($employeeId <= 0) {
        json_response([
            'success' => false,
            'message' => 'Employee record is required.',
        ], 422);
    }

    $employee = fetch_employee_signature_record($pdo, $employeeId);

    if ($employee === null) {
        json_response([
            'success' => false,
            'message' => 'Employee record not found.',
        ], 404);
    }

    return $employee;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $employeeId = employee_signature_int($_GET['employeeId'] ?? 0);

    if (employee_signature_flag($_GET['self'] ?? null)) {
        $employeeId = (int)(hris_session_employee_record_id($pdo, $sessionUser) ?? 0);

        if ($employeeId <= 0) {
            json_response([
                'success' => false,
                'message' => 'Your account is not linked to an employee record.',
            ], 404);
        }
    }

    $employee = require_employee_signature_record($pdo, $employeeId);

    json_response([
        'success' => true,
        'employee' => $employee,
    ]);
}

if ($method === 'PUT') {
    $body = read_json_body();
    $employeeId = employee_signature_int($body['employeeId'] ?? 0);
    require_employee_signature_record($pdo, $employeeId);

    $signature = validate_employee_signature($body['signatureDataUrl'] ?? null);

    $statement = $pdo->prepare(
        'UPDATE employees
         SET e_signature = :e_signature
         WHERE id = :id
           AND is_archived = 0'
    );
    $statement->bindValue(':e_signature', $signature, $signature !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $statement->bindValue(':id', $employeeId, PDO::PARAM_INT);
    $statement->execute();

    json_response([
        'success' => true,
        'message' => $signature === null ? 'Signature removed successfully.' : 'Signature updated successfully.',
        'employee' => fetch_employee_signature_record($pdo, $employeeId),
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
