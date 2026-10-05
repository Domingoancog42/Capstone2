<?php
declare(strict_types=1);

require_once __DIR__ . '/xlsx-reader.php';

/* The printed form's status codes, back to the statuses an entry stores (statusCode() in serviceRecordUtils.js). */
const SERVICE_IMPORT_STATUS_CODES = [
    'p' => 'Regular',
    't' => 'Temporary',
    'c' => 'Casual',
    'ct' => 'Coterminous',
    'cont' => 'Contractual',
    'cont.' => 'Contractual',
    'cos' => 'Contract of Service',
    'jo' => 'Job Order',
];

function service_import_date(string $value, bool $optional = false): ?string
{
    $value = trim($value);
    // An open period: "Present", the printed form's "P", or "date" as in "09-01-26 to date".
    if ($optional && in_array(strtolower($value), ['', 'present', 'to present', 'p', 'date', 'to date', 'none', 'n/a', '-'], true)) {
        return null;
    }
    if (preg_match('/^\d{4,5}(?:\.0+)?$/', $value)) {
        return (new DateTimeImmutable('1899-12-30'))->modify('+' . (int)$value . ' days')->format('Y-m-d');
    }
    // MM-DD-YY, as the printed form writes dates. Read before the four-digit formats, which would take
    // "26" as the year 26; a two-digit year past next year belongs to the 1900s.
    if (preg_match('~^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$~', $value, $parts)) {
        $year = 2000 + (int)$parts[3];
        if ($year > (int)date('Y') + 1) {
            $year -= 100;
        }
        if (!checkdate((int)$parts[1], (int)$parts[2], $year)) {
            throw new InvalidArgumentException('Invalid date "' . $value . '". Use MM/DD/YYYY or YYYY-MM-DD.');
        }
        return sprintf('%04d-%02d-%02d', $year, (int)$parts[1], (int)$parts[2]);
    }
    foreach (['!Y-m-d', '!m/d/Y', '!m-d-Y', '!n/j/Y', '!F j, Y', '!M j, Y', '!d-M-Y'] as $format) {
        $date = DateTimeImmutable::createFromFormat($format, $value);
        $errors = DateTimeImmutable::getLastErrors();
        if ($date && (!$errors || (!$errors['warning_count'] && !$errors['error_count']))) {
            return $date->format('Y-m-d');
        }
    }
    throw new InvalidArgumentException('Invalid date "' . $value . '". Use MM/DD/YYYY or YYYY-MM-DD.');
}

function service_import_header(string $value): ?string
{
    $key = strtolower(preg_replace('/[^a-z0-9]/i', '', $value));
    $aliases = [
        'serviceFrom' => ['from', 'servicefrom', 'startdate'],
        'serviceTo' => ['to', 'serviceto', 'enddate'],
        'designationTitle' => ['designation', 'designationtitle', 'designationstep', 'position'],
        'employmentStatus' => ['status', 'employmentstatus'],
        'monthlySalary' => ['salary', 'monthlysalary'],
        'annualSalary' => ['salaryannum', 'salaryperannum', 'annualsalary'],
        'station' => ['station', 'stationplace', 'placeofassignment', 'officeentitydivision', 'officeentity'],
        'branch' => ['branch'],
        'salaryGrade' => ['salarygrade', 'sg'],
        'stepIncrement' => ['step', 'stepincrement'],
        'separationDate' => ['separationdate'],
        'separationCause' => ['cause', 'separationcause'],
        'remarks' => ['remarks'],
        'separationRemarks' => ['separationdatecauseremarks'],
        'lwop' => ['lvabwopay', 'leavewithoutpay', 'lwop', 'leaveofabsencewopay'],
    ];
    foreach ($aliases as $field => $names) {
        if (in_array($key, $names, true)) return $field;
    }
    return null;
}

/** Read both a table with one header row and the grouped headings of a SERVICE RECORD form. */
function service_import_rows(array $rows): array
{
    $columns = [];
    $records = [];
    $started = false;
    foreach ($rows as $index => $row) {
        $row = array_map(static fn ($cell): string => trim((string)$cell), $row);
        if (!array_filter($row, static fn ($cell) => $cell !== '')) continue;
        $headers = [];
        foreach ($row as $column => $value) {
            $field = service_import_header($value);
            if ($field !== null) $headers[$field] = $column;
        }
        if (isset($headers['separationCause'])) {
            foreach ($row as $column => $value) {
                if (strtolower($value) === 'date') $headers['separationDate'] = $column;
            }
        }
        if (count($headers) >= 2 && !$started) {
            $columns = array_merge($columns, $headers);
            continue;
        }
        if (!isset($columns['serviceFrom'], $columns['serviceTo'], $columns['designationTitle'], $columns['employmentStatus'], $columns['station'])) continue;
        $from = $row[$columns['serviceFrom']] ?? '';
        // Printed forms often number their appointment columns just before the entries.
        if (!$started && $from === '' && in_array($row[$columns['designationTitle']] ?? '', ['', '1'], true)) continue;
        $joined = implode(' ', $row);
        if (preg_match('/issued in compliance|certified correct|nothing follows|end of record|^\s*(?:date:|certified by|prepared by)/i', $joined)) break;
        try {
            $record = [];
            foreach ($columns as $field => $column) $record[$field] = $row[$column] ?? '';
            $record = service_import_validate_record($record);
        } catch (InvalidArgumentException $error) {
            throw new InvalidArgumentException('Row ' . ($index + 1) . ': ' . $error->getMessage());
        }
        $records[] = $record;
        $started = true;
        if (count($records) > 500) throw new InvalidArgumentException('Import up to 500 entries at a time.');
    }
    if (!$records) throw new InvalidArgumentException('No service entries found. Include From, To, Designation/Step, Status, Salary, and Station/Place headings on the first worksheet.');
    return $records;
}

function service_import_validate_record(array $record): array
{
    foreach ($record as $value) {
        if (!is_scalar($value) && $value !== null) throw new InvalidArgumentException('Invalid entry value.');
    }
    /*
     * The printed form's last column holds the remarks and, where service stopped, the separation as
     * "MM-DD-YY / Cause"; its salary is per annum. Both go back into the entry's own fields.
     */
    if (array_key_exists('separationRemarks', $record)) {
        $combined = trim((string)$record['separationRemarks']);
        if (preg_match('~^(.*?)\s*(\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2}))\s*/\s*([^/]+)$~', $combined, $matches)) {
            $combined = trim($matches[1]);
            if (trim((string)($record['separationDate'] ?? '')) === '') $record['separationDate'] = $matches[2];
            if (trim((string)($record['separationCause'] ?? '')) === '') $record['separationCause'] = trim($matches[3]);
        }
        if (trim((string)($record['remarks'] ?? '')) === '') $record['remarks'] = $combined;
        unset($record['separationRemarks']);
    }
    if (array_key_exists('annualSalary', $record)) {
        $annual = preg_replace('/[₱,\s]|PHP/i', '', (string)$record['annualSalary']);
        if (!in_array(strtolower($annual), ['', '-', 'none', 'n/a'], true)) {
            if (!is_numeric($annual)) throw new InvalidArgumentException('Salary must be a valid nonnegative amount.');
            if (trim((string)($record['monthlySalary'] ?? '')) === '') $record['monthlySalary'] = number_format((float)$annual / 12, 2, '.', '');
        }
        unset($record['annualSalary']);
    }
    foreach (['serviceFrom', 'serviceTo', 'separationDate'] as $field) {
        $record[$field] = service_import_date((string)($record[$field] ?? ''), $field !== 'serviceFrom');
    }
    foreach (['serviceTo', 'separationDate'] as $field) {
        if ($record[$field] !== null && $record[$field] < $record['serviceFrom']) throw new InvalidArgumentException('End and separation dates cannot precede the start date.');
    }
    foreach (['designationTitle', 'employmentStatus', 'station'] as $field) {
        if (trim((string)($record[$field] ?? '')) === '') throw new InvalidArgumentException('Designation, status, and station are required for every entry.');
    }
    $record['employmentStatus'] = SERVICE_IMPORT_STATUS_CODES[strtolower(trim((string)$record['employmentStatus']))] ?? $record['employmentStatus'];
    if (preg_match('/^(.*?)\s*\/\s*Step\s+(\d+)$/i', $record['designationTitle'], $matches)) {
        $record['designationTitle'] = trim($matches[1]);
        $record['stepIncrement'] = $matches[2];
    }
    if (preg_match('/^(.*?)\s*\/\s*SG\s+([^\/]+)$/i', $record['designationTitle'], $matches)) {
        $record['designationTitle'] = trim($matches[1]);
        $record['salaryGrade'] = trim($matches[2]);
    }
    if (in_array(strtolower(trim((string)($record['separationCause'] ?? ''))), ['none', 'n/a', '-'], true)) {
        $record['separationCause'] = '';
    }
    $salary = preg_replace('/[₱,\s]|PHP/i', '', (string)($record['monthlySalary'] ?? ''));
    if (in_array(strtolower($salary), ['', '-', 'none', 'n/a'], true)) $salary = null;
    if ($salary !== null && (!is_numeric($salary) || (float)$salary < 0 || (float)$salary > 9999999999.99)) throw new InvalidArgumentException('Salary must be a valid nonnegative amount.');
    $record['monthlySalary'] = $salary === null ? null : number_format((float)$salary, 2, '.', '');
    // Historical LWOP has no column in service_records; retain it in remarks.
    $lwop = trim((string)($record['lwop'] ?? ''));
    if (!in_array(strtolower($lwop), ['', 'none', '0', '-', 'n/a'], true)) {
        $record['remarks'] = trim(($record['remarks'] ?? '') . ' [Imported leave without pay: ' . $lwop . ']');
    }
    unset($record['lwop']);
    foreach (['designationTitle' => 180, 'employmentStatus' => 50, 'station' => 180, 'branch' => 180, 'salaryGrade' => 20, 'stepIncrement' => 10, 'separationCause' => 255, 'remarks' => 255] as $field => $limit) {
        if (mb_strlen((string)($record[$field] ?? '')) > $limit) throw new InvalidArgumentException($field . ' exceeds ' . $limit . ' characters.');
    }
    return $record;
}
