<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/employee-pds-profile-utils.php';

$sessionUser = require_session_user();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $employeeRecordId = (int)(session_employee_record_id($pdo, $sessionUser) ?? 0);
    if ($employeeRecordId <= 0) {
        json_response([
            'success' => false,
            'message' => 'No employee record is linked to this account.',
        ], 422);
    }

    ensure_employee_pds_profile_tables($pdo);

    if ($method === 'GET') {
        json_response(array_merge(
            ['success' => true],
            employee_pds_profile_fetch($pdo, $employeeRecordId)
        ));
    }

    if ($method !== 'PUT') {
        json_response([
            'success' => false,
            'message' => 'Method not allowed.',
        ], 405);
    }

    $body = read_json_body();
    $section = strtolower(employee_pds_profile_text($body['section'] ?? '', 20));
    $sectionLabels = [
        'family' => 'Family background', 'education' => 'Educational background',
        'eligibility' => 'Civil service eligibility', 'training' => 'Learning and development',
    ];
    if (!isset($sectionLabels[$section])) {
        json_response([
            'success' => false,
            'message' => 'Choose a valid PDS profile section to save.',
        ], 422);
    }

    $pdo->beginTransaction();
    try {
        if ($section === 'family') {
            $family = $body['family'] ?? [];
            if (!is_array($family)) {
                throw new InvalidArgumentException('Family background must be an object.');
            }
            employee_pds_profile_save_family($pdo, $employeeRecordId, $family);
        } elseif ($section === 'education') {
            $education = $body['education'] ?? [];
            if (!is_array($education)) {
                throw new InvalidArgumentException('Educational background must be a list.');
            }
            employee_pds_profile_save_education($pdo, $employeeRecordId, $education);
        } else {
            $records = $body[$section] ?? null;
            if (!is_array($records)) {
                throw new InvalidArgumentException($sectionLabels[$section] . ' must be a list.');
            }
            employee_pds_profile_save_records($pdo, $employeeRecordId, $section, $records);
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    write_auth_audit(
        $pdo,
        $sessionUser,
        'profile.pds_' . $section . '_updated',
        'The employee updated their PDS ' . strtolower($sectionLabels[$section]) . '.',
        ['module' => 'profile', 'employeeRecordId' => $employeeRecordId]
    );

    json_response(array_merge(
        [
            'success' => true,
            'message' => $sectionLabels[$section] . ' saved successfully.',
        ],
        employee_pds_profile_fetch($pdo, $employeeRecordId)
    ));
} catch (InvalidArgumentException $exception) {
    json_response([
        'success' => false,
        'message' => $exception->getMessage(),
    ], 422);
} catch (Throwable $exception) {
    error_log('Employee PDS profile error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the PDS profile section.',
    ], 500);
}
