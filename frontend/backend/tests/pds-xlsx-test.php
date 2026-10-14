<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/pds-xlsx.php';

function pds_test_cell(array $parts, int $sheet, string $reference): array
{
    $xml = new SimpleXMLElement($parts['xl/worksheets/sheet' . $sheet . '.xml']);
    $xml->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    $cells = $xml->xpath('//s:c[@r="' . $reference . '"]');
    if (count($cells) !== 1) {
        throw new RuntimeException('Missing test cell: ' . $reference);
    }
    $cell = $cells[0];
    $cell->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    return [(string)$cell['t'], (string)($cell->xpath('s:v|s:is/s:t')[0] ?? '')];
}

function pds_test_expect(mixed $actual, mixed $expected, string $message): void
{
    if ($actual !== $expected) {
        throw new RuntimeException($message . ': ' . var_export($actual, true));
    }
}

function pds_test_parts(string $bytes): array
{
    $path = tempnam(sys_get_temp_dir(), 'pds-test-');
    try {
        file_put_contents($path, $bytes);
        return pds_xlsx_read_package($path);
    } finally {
        unlink($path);
    }
}

$template = __DIR__ . '/../templates/Personal-Data-Sheet-CS-Form-No.-212-Revised-2026.xlsx';
$original = pds_xlsx_read_package($template);
$employee = [
    'employee_id' => 'PDS-TEST-001', 'first_name' => 'Test First', 'last_name' => 'Test Last',
    'middle_name' => 'Test Middle', 'suffix' => 'III', 'date_of_birth' => '1990-05-06',
    'gender' => 'Female', 'civil_status' => 'Married', 'nationality' => 'Filipino', 'pwd' => 1,
    'emp_gsis_id_no' => '001234567', 'phone' => '09123456789', 'email' => 'pds@example.test',
    'family_background' => [
        'spouseLastName' => 'Spouse Last', 'spouseFirstName' => 'Spouse First', 'spouseSuffix' => 'Sr.',
        'fatherLastName' => 'Father Last', 'fatherFirstName' => 'Father First',
        'fatherMiddleName' => 'Father Middle', 'fatherSuffix' => 'Jr.',
        'motherMaidenLastName' => 'Mother Maiden', 'motherFirstName' => 'Mother First',
        'motherMiddleName' => 'Mother Middle',
    ],
    'children' => [['fullName' => 'Test Child', 'dateOfBirth' => '2015-12-31']],
    'education_background' => array_map(static fn(string $level): array => [
        'level' => $level, 'schoolName' => $level . ' School & Academy',
        'degreeCourse' => $level . ' Course', 'attendanceFrom' => '2000', 'attendanceTo' => '2004',
        'highestLevelUnits' => 'Complete', 'yearGraduated' => '2004', 'honors' => 'With Honors',
    ], ['elementary', 'secondary', 'vocational', 'college', 'graduate']),
];
$records = [];
for ($index = 0; $index < 28; $index++) {
    $records[] = [
        'service_from' => '2020-01-02', 'service_to' => $index === 0 ? null : '2021-03-04',
        'designation_title' => 'Work Record ' . ($index + 1),
        'organization' => 'Test Bureau & Office', 'monthly_salary' => $index === 1 ? 0 : 21877.25 + $index,
        'salary_grade' => '11', 'step_increment' => '2', 'employment_status' => 'Permanent',
        'government_service' => 'Y',
    ];
}
$completedOn = new DateTimeImmutable('2026-10-14');
$bytes = pds_xlsx_build($template, $employee, $records, $completedOn);
$parts = pds_test_parts($bytes);
foreach ([
    'D10' => 'Test Last', 'D11' => 'Test First', 'D12' => 'Test Middle', 'N11' => 'III',
    'D13' => '06/05/1990', 'D44' => 'Father Last', 'D45' => 'Father First', 'D46' => 'Father Middle',
    'H45' => 'Jr.', 'D36' => 'Spouse Last', 'D37' => 'Spouse First', 'H37' => 'Sr.',
    'D48' => 'Mother Maiden', 'D49' => 'Mother First', 'D50' => 'Mother Middle',
    'I37' => 'Test Child', 'M37' => '31/12/2015', 'L61' => '14/10/2026',
] as $reference => $expected) {
    pds_test_expect(pds_test_cell($parts, 1, $reference), ['inlineStr', $expected], '2026 personal/family mapping ' . $reference);
}
foreach (['elementary', 'secondary', 'vocational', 'college', 'graduate'] as $index => $level) {
    pds_test_expect(pds_test_cell($parts, 1, 'D' . (55 + $index)), ['inlineStr', $level . ' School & Academy'], 'Education row ' . $level);
}
foreach (['D16' => '0', 'E16' => '1', 'D17' => '0', 'E17' => '1', 'D18' => '0', 'E19' => '0', 'D20' => '0', 'J13' => '1'] as $reference => $expected) {
    pds_test_expect(pds_test_cell($parts, 1, $reference), ['b', $expected], 'Checkbox linked value ' . $reference);
}
pds_test_expect(pds_test_cell($parts, 4, 'H45'), ['b', '1'], 'PWD yes');
pds_test_expect(pds_test_cell($parts, 4, 'J45'), ['b', '0'], 'PWD no');
pds_test_expect(str_contains($parts['xl/ctrlProps/ctrlProp5.xml'], 'checked="Checked"'), true, 'Female Excel control');
pds_test_expect(str_contains($parts['xl/ctrlProps/ctrlProp11.xml'], 'checked="Checked"'), true, 'Married Excel control');
pds_test_expect(str_contains($parts['xl/ctrlProps/ctrlProp4.xml'], 'checked='), false, 'Native unchecked checkbox state');
pds_test_expect(str_contains($parts['xl/drawings/vmlDrawing1.vml'], '<x:Checked>1</x:Checked>'), true, 'Printable checkbox state');
for ($index = 0; $index < 28; $index++) {
    $sheet = $index < 24 ? 2 : 6;
    $row = $index < 24 ? 18 + $index : 7 + $index - 24;
    pds_test_expect(pds_test_cell($parts, $sheet, 'D' . $row), ['inlineStr', 'Work Record ' . ($index + 1)], 'Work record preserved ' . $index);
    pds_test_expect(pds_test_cell($parts, $sheet, 'K' . $row), ['inlineStr', '11-2'], 'Grade/step column');
    pds_test_expect(pds_test_cell($parts, $sheet, 'L' . $row), ['inlineStr', 'Permanent'], 'Appointment column');
    pds_test_expect(pds_test_cell($parts, $sheet, 'M' . $row), ['inlineStr', 'Y'], 'Government service column');
}
pds_test_expect(pds_test_cell($parts, 2, 'J18'), ['', '21877.25'], 'Salary is numeric');
pds_test_expect(pds_test_cell($parts, 2, 'J19'), ['', '0'], 'Zero salary is retained');
pds_test_expect(pds_test_cell($parts, 2, 'C18'), ['inlineStr', 'PRESENT'], 'Current work period');
foreach ([[2, 'J43'], [3, 'I47'], [4, 'G64'], [6, 'I40']] as [$sheet, $reference]) {
    pds_test_expect(pds_test_cell($parts, $sheet, $reference), ['inlineStr', '14/10/2026'], 'Date on each populated page');
}
// A value inside a merged field is invisible unless it is in the top-left cell.
$cellPosition = static function (string $reference): array {
    preg_match('/^([A-Z]+)(\d+)$/', $reference, $match);
    $column = 0;
    foreach (str_split($match[1]) as $letter) {
        $column = $column * 26 + ord($letter) - 64;
    }
    return [$column, (int)$match[2]];
};
foreach ([1, 2, 3, 4, 6] as $sheet) {
    $xml = new SimpleXMLElement($parts['xl/worksheets/sheet' . $sheet . '.xml']);
    $xml->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    foreach ($xml->xpath('//s:c[@t="inlineStr"]') as $cell) {
        $reference = (string)$cell['r'];
        [$column, $row] = $cellPosition($reference);
        foreach ($xml->xpath('//s:mergeCell') as $merge) {
            [$start, $end] = explode(':', (string)$merge['ref']);
            [$firstColumn, $firstRow] = $cellPosition($start);
            [$lastColumn, $lastRow] = $cellPosition($end);
            if ($column >= $firstColumn && $column <= $lastColumn && $row >= $firstRow && $row <= $lastRow) {
                pds_test_expect($reference, $start, 'Printed merged field C' . $sheet . '!' . $reference);
            }
        }
    }
}
foreach ($original as $name => $contents) {
    if (preg_match('#^xl/(worksheets/sheet\d+\.xml|ctrlProps/|drawings/vmlDrawing|sharedStrings\.xml|styles\.xml|workbook\.xml)#', $name)) {
        continue;
    }
    pds_test_expect($parts[$name] ?? null, $contents, 'Preserve native workbook part ' . $name);
}
pds_test_expect(count($parts), count($original), 'Preserve all template package parts');
foreach ([1, 2, 3, 4, 6] as $sheet) {
    $xml = new SimpleXMLElement($parts['xl/worksheets/sheet' . $sheet . '.xml']);
    $xml->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    $setup = $xml->xpath('s:pageSetup')[0];
    pds_test_expect((string)$setup['paperSize'], '5', 'Legal-size Excel page');
    pds_test_expect((string)$setup['fitToWidth'], '1', 'One page wide');
    pds_test_expect((string)$setup['fitToHeight'], '1', 'One page tall');
    pds_test_expect((string)$xml->xpath('s:sheetViews/s:sheetView')[0]['view'], 'normal', 'Continuous form without page gutters');
    pds_test_expect((string)$xml->xpath('s:sheetViews/s:sheetView')[0]['zoomScale'], '100', 'Readable Excel opening zoom');
    pds_test_expect((string)$xml->xpath('s:sheetPr')[0]['showPageBreaks'], '0', 'Hide page-break overlays');
    foreach (['mergeCells'] as $element) {
        $source = new SimpleXMLElement($original['xl/worksheets/sheet' . $sheet . '.xml']);
        $source->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
        pds_test_expect($xml->xpath('//s:' . $element)[0]->asXML(), $source->xpath('//s:' . $element)[0]->asXML(), 'Preserve form geometry: ' . $element);
    }
    $lastColumn = [1 => 14, 2 => 13, 3 => 11, 4 => 14, 6 => 13][$sheet];
    $lastHelperColumn = [1 => 18, 2 => 14, 3 => 11, 4 => 14, 6 => 13][$sheet];
    foreach ($xml->xpath('s:cols/s:col') as $column) {
        if ((int)$column['min'] > $lastColumn && (int)$column['max'] <= $lastHelperColumn) {
            pds_test_expect((string)$column['hidden'], '1', 'Template helper data stays hidden');
        } elseif ((int)$column['min'] > $lastHelperColumn) {
            pds_test_expect((string)$column['hidden'], '0', 'Blank worksheet canvas stays visible');
            pds_test_expect((string)$column['max'], '16384', 'White canvas reaches the worksheet edge');
            $styles = new SimpleXMLElement($parts['xl/styles.xml']);
            $styles->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
            $format = $styles->xpath('s:cellXfs/s:xf')[(int)$column['style']];
            $fill = $styles->xpath('s:fills/s:fill')[(int)$format['fillId']];
            $fill->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
            pds_test_expect((string)$fill->xpath('s:patternFill/s:fgColor')[0]['rgb'], 'FFFFFFFF', 'Blank canvas is explicitly white');
        }
    }
    for ($columnNumber = 1; $columnNumber <= $lastColumn; $columnNumber++) {
        $findColumn = static function (SimpleXMLElement $document, int $number): SimpleXMLElement {
            return $document->xpath('s:cols/s:col[@min<=' . $number . ' and @max>=' . $number . ']')[0];
        };
        $source = new SimpleXMLElement($original['xl/worksheets/sheet' . $sheet . '.xml']);
        $source->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
        pds_test_expect((string)$findColumn($xml, $columnNumber)['width'], (string)$findColumn($source, $columnNumber)['width'], 'Preserve form column width');
    }
}
$workbookXml = new SimpleXMLElement($parts['xl/workbook.xml']);
$workbookXml->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
pds_test_expect(count($workbookXml->xpath('//s:sheet[not(@state="hidden")]')), 5, 'Only populated form pages are visible');
pds_test_expect(str_contains($parts['xl/sharedStrings.xml'], "Don't Know"), false, 'Do not export template sample answers');
$previousXmlErrors = libxml_use_internal_errors(true);
foreach ($parts as $name => $contents) {
    if (str_ends_with($name, '.xml') || str_ends_with($name, '.rels') || str_ends_with($name, '.vml')) {
        if (simplexml_load_string($contents) === false) {
            throw new RuntimeException('Invalid exported XML: ' . $name);
        }
    }
}
libxml_clear_errors();
libxml_use_internal_errors($previousXmlErrors);
$mainBytes = pds_xlsx_build($template, $employee, array_slice($records, 0, 24), $completedOn);
$mainParts = pds_test_parts($mainBytes);
$mainWorkbookXml = new SimpleXMLElement($mainParts['xl/workbook.xml']);
$mainWorkbookXml->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
pds_test_expect(count($mainWorkbookXml->xpath('//s:sheet[not(@state="hidden")]')), 4, 'No blank continuation pages in Excel');
pds_test_expect(pds_test_cell($mainParts, 6, 'D7')[1], '', 'No unused continuation entries');
$legacyParts = pds_test_parts(pds_xlsx_build($template, [
    'gender' => 'Male', 'civil_status' => 'Single', 'pwd' => 0,
    'highest_education' => 'College', 'school_name' => 'Legacy College',
    'father_name' => 'Legacy, Father Middle Jr.', 'mother_name' => 'Legacy, Mother Middle',
], [], $completedOn));
pds_test_expect(pds_test_cell($legacyParts, 1, 'D58'), ['inlineStr', 'Legacy College'], 'Legacy education still exports');
pds_test_expect(pds_test_cell($legacyParts, 1, 'D44'), ['inlineStr', 'Legacy'], 'Legacy family still exports');
pds_test_expect(pds_test_cell($legacyParts, 1, 'D16'), ['b', '1'], 'Male selection');
pds_test_expect(pds_test_cell($legacyParts, 4, 'J45'), ['b', '1'], 'PWD no selection');

if (isset($argv[1]) && is_dir($argv[1])) {
    file_put_contents($argv[1] . '/pds-2026-main.xlsx', $mainBytes);
    file_put_contents($argv[1] . '/pds-2026-continuation.xlsx', $bytes);
}
echo "PDS 2026 mappings, salary/grade columns, checkbox states, 28 work records and native package preservation passed.\n";
