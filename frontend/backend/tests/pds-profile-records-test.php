<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/employee-pds-profile-utils.php';
require_once __DIR__ . '/../api/pds-xlsx.php';

function pds_records_expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function pds_records_invalid(string $section, array $records): void
{
    try {
        employee_pds_profile_clean_records($section, $records);
    } catch (InvalidArgumentException $exception) {
        return;
    }
    throw new RuntimeException('Invalid ' . $section . ' records were accepted.');
}

$eligibility = [];
for ($index = 1; $index <= 31; $index++) {
    $eligibility[] = [
        'eligibilityName' => 'Civil Eligibility ' . $index, 'rating' => '85.50%',
        'examinationDate' => '2024-08-11', 'examinationPlace' => 'Test City',
        'licenseNumber' => '000' . $index, 'validityDate' => '2028-08-11',
    ];
}
$training = [];
for ($index = 1; $index <= 61; $index++) {
    $training[] = [
        'title' => 'Training Program ' . $index, 'dateFrom' => '2026-01-02', 'dateTo' => '2026-01-04',
        'hours' => $index === 1 ? '0' : '15.5', 'type' => 'Technical', 'conductedBy' => 'Test Learning Academy',
    ];
}
pds_records_expect(count(employee_pds_profile_clean_records('eligibility', $eligibility)) === 31, 'Eligibility capacity');
pds_records_expect(count(employee_pds_profile_clean_records('training', $training)) === 61, 'Training capacity');
pds_records_expect(employee_pds_profile_clean_records('training', [$training[0]])[0]['hours'] === '0', 'Zero hours');
pds_records_expect(employee_pds_profile_clean_records('eligibility', [[]]) === [], 'Discard unused blank rows');
foreach ([
    ['eligibility', [['rating' => '80%']]],
    ['eligibility', [array_merge($eligibility[0], ['examinationDate' => '2024-02-30'])]],
    ['eligibility', array_merge($eligibility, [$eligibility[0]])],
    ['training', [['hours' => '2']]],
    ['training', [array_merge($training[0], ['dateTo' => '2026-01-01'])]],
    ['training', [array_merge($training[0], ['hours' => '-1'])]],
    ['training', [array_merge($training[0], ['hours' => '1.234'])]],
    ['training', array_merge($training, [$training[0]])],
] as [$section, $records]) pds_records_invalid($section, $records);
echo "PDS record validation, dates, blank/zero values and export capacities passed.\n";

if (($argv[1] ?? '') !== '--database') exit;

// Exercise actual MySQL persistence in a disposable schema, never in employee records.
$pdo = new PDO(getenv('PDS_TEST_MYSQL_DSN') ?: 'mysql:host=127.0.0.1;charset=utf8mb4',
    getenv('PDS_TEST_MYSQL_USER') ?: 'root', getenv('PDS_TEST_MYSQL_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
$schema = 'pds_profile_test_' . bin2hex(random_bytes(6));
$created = false;
try {
    $pdo->exec('CREATE DATABASE `' . $schema . '`');
    $created = true;
    $pdo->exec('USE `' . $schema . '`');
    $pdo->exec('CREATE TABLE employees (
        id INT UNSIGNED NOT NULL PRIMARY KEY, is_archived TINYINT NOT NULL DEFAULT 0,
        spouse_name VARCHAR(255), spouse_occupation VARCHAR(255), father_name VARCHAR(255), mother_name VARCHAR(255),
        highest_education VARCHAR(255), school_name VARCHAR(255), education_course VARCHAR(255), year_graduated VARCHAR(20)
    ) ENGINE=InnoDB');
    $pdo->exec('INSERT INTO employees (id) VALUES (1), (2)');
    ensure_employee_pds_profile_tables($pdo);
    ensure_employee_pds_profile_tables($pdo); // Schema initialization remains repeatable.
    $pdo->beginTransaction();
    employee_pds_profile_save_records($pdo, 1, 'eligibility', $eligibility);
    employee_pds_profile_save_records($pdo, 1, 'training', $training);
    $pdo->commit();
    $profile = employee_pds_profile_fetch($pdo, 1);
    pds_records_expect(count($profile['eligibility']) === 31 && count($profile['training']) === 61, 'Saved records reload');
    pds_records_expect($profile['eligibility'][30]['licenseNumber'] === '00031', 'License preserves leading zeroes and ordering');
    pds_records_expect((float)$profile['training'][0]['hours'] === 0.0, 'Saved zero hours');
    $other = employee_pds_profile_fetch($pdo, 2);
    pds_records_expect($other['eligibility'] === [] && $other['training'] === [], 'Employee data isolation');
    $employee = [
        'last_name' => 'Test Last', 'first_name' => 'Test First', 'suffix' => 'III', 'gender' => 'Female', 'civil_status' => 'Married',
        'civil_service_eligibility' => $profile['eligibility'], 'learning_development' => $profile['training'],
    ];
    $bytes = pds_xlsx_build(__DIR__ . '/../templates/Personal-Data-Sheet-CS-Form-No.-212-Revised-2026.xlsx', $employee,
        [['designation_title' => 'Test Appointment', 'monthly_salary' => 21877.25, 'salary_grade' => '11', 'step_increment' => '2']],
        new DateTimeImmutable('2026-10-14'));
    $path = tempnam(sys_get_temp_dir(), 'pds-records-');
    try {
        file_put_contents($path, $bytes);
        $parts = pds_xlsx_read_package($path);
    } finally { unlink($path); }
    $namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    $cell = static function (int $sheet, string $ref) use ($parts, $namespace): string {
        $xml = new SimpleXMLElement($parts['xl/worksheets/sheet' . $sheet . '.xml']);
        $xml->registerXPathNamespace('s', $namespace);
        $node = $xml->xpath('s:sheetData/s:row/s:c[@r="' . $ref . '"]')[0];
        $node->registerXPathNamespace('s', $namespace);
        return (string)($node->xpath('s:is/s:t|s:v')[0] ?? '');
    };
    foreach ([[2, 'A5', 'Civil Eligibility 1'], [2, 'A11', 'Civil Eligibility 7'], [9, 'A5', 'Civil Eligibility 8'],
        [9, 'A28', 'Civil Eligibility 31'], [9, 'J28', '00031'], [2, 'G5', '11/08/2024'],
        [3, 'A5', 'Training Program 1'], [3, 'A12', 'Training Program 8'], [3, 'A21', 'Training Program 17'],
        [5, 'A6', 'Training Program 18'], [5, 'A49', 'Training Program 61'], [3, 'G5', '0'], [5, 'G49', '15.5'],
        [3, 'E5', '02/01/2026'], [5, 'H50', '14/10/2026'], [9, 'I29', '14/10/2026']] as [$sheet, $ref, $expected]) {
        pds_records_expect($cell($sheet, $ref) === $expected, 'Saved data exports in the correct PDS field: C' . $sheet . '!' . $ref);
    }
    pds_records_expect(str_contains($parts['xl/worksheets/sheet3.xml'], 'ref="A12:D12"')
        && str_contains($parts['xl/worksheets/sheet3.xml'], 'ref="I21:K21"'), 'Training text uses full-width fields');
    $workbook = new SimpleXMLElement($parts['xl/workbook.xml']);
    $workbook->registerXPathNamespace('s', $namespace);
    pds_records_expect(count($workbook->xpath('s:sheets/s:sheet[not(@state="hidden")]')) === 6, 'Only populated continuation sheets shown');
    if (isset($argv[2]) && is_dir($argv[2])) file_put_contents($argv[2] . '/pds-2026-sections.xlsx', $bytes);
    $pdo->beginTransaction();
    employee_pds_profile_save_records($pdo, 1, 'eligibility', [$eligibility[1]]);
    employee_pds_profile_save_records($pdo, 1, 'training', []);
    $pdo->commit();
    $reloaded = employee_pds_profile_fetch($pdo, 1);
    pds_records_expect(count($reloaded['eligibility']) === 1 && $reloaded['eligibility'][0]['eligibilityName'] === 'Civil Eligibility 2'
        && $reloaded['training'] === [], 'Removing entries persists without changing another section');
    try {
        $pdo->beginTransaction();
        employee_pds_profile_save_records($pdo, 1, 'eligibility', [['rating' => '80%']]);
    } catch (InvalidArgumentException $exception) {
        $pdo->rollBack();
    }
    pds_records_expect(count(employee_pds_profile_fetch($pdo, 1)['eligibility']) === 1, 'Rejected saves preserve previous records');
    echo "MySQL save/reload/removal, employee isolation and main/continuation XLSX exports passed.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($created) $pdo->exec('DROP DATABASE `' . $schema . '`');
}
