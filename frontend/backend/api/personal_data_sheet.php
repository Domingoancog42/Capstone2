<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/employee-pds-profile-utils.php';
require_once __DIR__ . '/pds-xlsx.php';

$sessionUser = require_session_user();

function pds_download_employee(PDO $pdo, int $employeeRecordId): ?array
{
    $statement = $pdo->prepare(
        'SELECT e.id, e.employee_id, e.first_name, e.middle_name, e.last_name, e.suffix,
                e.date_of_birth, e.address, e.city, e.province, e.zip_code, e.gender, e.email,
                e.phone, e.date_hired, e.employment_status, e.pwd, e.civil_status, e.spouse_name,
                e.spouse_occupation, e.father_name, e.mother_name, e.highest_education,
                e.school_name, e.education_course, e.year_graduated, e.height, e.weight,
                e.blood_type, e.emp_gsis_id_no, e.emp_pagibig_id_no, e.emp_philhealth_id_no,
                e.tin_no, d.name AS division_name, des.name AS designation_title
         FROM employees e
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         WHERE e.id = :id
           AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeRecordId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : $row;
}

/** @return array<int, array<string, mixed>> */
function pds_download_service_records(PDO $pdo, array $employee): array
{
    $statement = $pdo->prepare(
        'SELECT service_from, service_to, designation_title, employment_status, station, branch
         FROM service_records
         WHERE employee_record_id = :employee_record_id
           AND is_archived = 0
         ORDER BY service_from DESC, id DESC
         LIMIT 28'
    );
    $statement->execute([':employee_record_id' => (int)$employee['id']]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    if ($rows === []) {
        return [[
            'service_from' => $employee['date_hired'] ?? null,
            'service_to' => null,
            'designation_title' => $employee['designation_title'] ?? '',
            'employment_status' => $employee['employment_status'] ?? '',
            'organization' => trim('Mines and Geosciences Bureau - ' . (string)($employee['division_name'] ?? ''), ' -'),
            'government_service' => 'Y',
        ]];
    }

    return array_map(static function (array $row): array {
        $organizationParts = [];

        foreach ([$row['branch'] ?? '', $row['station'] ?? ''] as $part) {
            $part = pds_xlsx_clean_text($part);
            $normalized = strtolower($part);

            if ($part !== '' && !in_array($normalized, array_map('strtolower', $organizationParts), true)) {
                $organizationParts[] = $part;
            }
        }

        return array_merge($row, [
            'organization' => implode(' - ', $organizationParts),
            'government_service' => 'Y',
        ]);
    }, $rows);
}

function pds_download_filename(array $employee): string
{
    $employeeCode = preg_replace('/[^A-Za-z0-9_-]+/', '-', (string)($employee['employee_id'] ?? 'employee'));
    $employeeCode = trim((string)$employeeCode, '-');

    return 'PDS-' . ($employeeCode !== '' ? $employeeCode : 'employee') . '.xlsx';
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if (!in_array($method, ['GET', 'POST'], true)) {
        json_response([
            'success' => false,
            'message' => 'Method not allowed.',
        ], 405);
    }

    $profileContext = $method === 'POST' ? read_json_body() : [];

    $employeeRecordId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);

    if ($employeeRecordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'No employee record is linked to this account.',
        ], 422);
    }

    $employee = pds_download_employee($pdo, $employeeRecordId);

    if ($employee === null) {
        json_response([
            'success' => false,
            'message' => 'Your employee record could not be found.',
        ], 404);
    }

    // These two address/profile values currently live in the profile workspace rather than the
    // employee master table. The authenticated client may supply only its own visible values; the
    // employee identity and all other PDS data still come from the session-scoped database record.
    $employee['nationality'] = pds_xlsx_clean_text($profileContext['nationality'] ?? 'Filipino') ?: 'Filipino';
    $employee['barangay'] = pds_xlsx_clean_text($profileContext['barangay'] ?? '');
    ensure_employee_pds_profile_tables($pdo);
    $pdsProfile = employee_pds_profile_fetch($pdo, $employeeRecordId);
    $employee['family_background'] = $pdsProfile['family'];
    $employee['children'] = $pdsProfile['family']['children'] ?? [];
    $employee['education_background'] = $pdsProfile['education'];
    $serviceRecords = pds_download_service_records($pdo, $employee);
    $templatePath = __DIR__ . '/../templates/Personal-Data-Sheet-CS-Form-No.-212-Revised-2025.xlsx';

    if (!is_file($templatePath)) {
        throw new RuntimeException('The official PDS workbook template is unavailable.');
    }

    $workbook = pds_xlsx_build($templatePath, $employee, $serviceRecords);

    write_auth_audit(
        $pdo,
        $sessionUser,
        'profile.pds_downloaded',
        'The employee downloaded their Personal Data Sheet.',
        [
            'module' => 'profile',
            'employeeRecordId' => $employeeRecordId,
            'form' => 'CS Form No. 212 (Revised 2025)',
        ]
    );

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    header_remove('Content-Type');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . pds_download_filename($employee) . '"');
    header('Content-Length: ' . strlen($workbook));
    header('Cache-Control: private, no-store, max-age=0');
    echo $workbook;
    exit;
} catch (Throwable $exception) {
    error_log('Personal Data Sheet download error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to prepare your Personal Data Sheet.',
    ], 500);
}
