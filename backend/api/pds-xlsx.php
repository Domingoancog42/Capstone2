<?php
declare(strict_types=1);

/**
 * Minimal XLSX template reader/writer for the official CS Form No. 212 workbook.
 *
 * The local XAMPP PHP build does not load ext-zip. Rebuilding the form would also risk changing
 * its page geometry, controls, borders, and printer settings. This helper therefore reads the
 * existing Open XML package, changes only named cells/control states, and writes the same package
 * back as a standards-compliant stored-entry ZIP archive.
 */

function pds_xlsx_xml_escape(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

function pds_xlsx_u16(int $value): string
{
    return pack('v', $value);
}

function pds_xlsx_u32(int $value): string
{
    return pack('V', $value < 0 ? $value + 4294967296 : $value);
}

function pds_xlsx_dos_datetime(): array
{
    $date = getdate();
    $year = max(1980, min(2107, (int)$date['year']));

    return [
        ((int)$date['hours'] << 11) | ((int)$date['minutes'] << 5) | intdiv((int)$date['seconds'], 2),
        (($year - 1980) << 9) | ((int)$date['mon'] << 5) | (int)$date['mday'],
    ];
}

/** @return array<string, string> */
function pds_xlsx_read_package(string $path): array
{
    $archive = file_get_contents($path);

    if ($archive === false || $archive === '') {
        throw new RuntimeException('The PDS workbook template could not be read.');
    }

    $eocdOffset = strrpos($archive, "\x50\x4b\x05\x06");

    if ($eocdOffset === false || strlen($archive) < $eocdOffset + 22) {
        throw new RuntimeException('The PDS workbook template is not a valid ZIP package.');
    }

    $eocd = unpack(
        'vdisk/vcentralDisk/ventriesOnDisk/ventries/VcentralSize/VcentralOffset/vcommentLength',
        substr($archive, $eocdOffset + 4, 18)
    );

    if (!is_array($eocd) || (int)$eocd['disk'] !== 0 || (int)$eocd['centralDisk'] !== 0) {
        throw new RuntimeException('Multi-disk PDS workbook packages are not supported.');
    }

    $entryCount = (int)$eocd['entries'];
    $cursor = (int)$eocd['centralOffset'];
    $parts = [];

    if ($entryCount <= 0 || $entryCount > 5000) {
        throw new RuntimeException('The PDS workbook template contains an invalid entry count.');
    }

    for ($entryIndex = 0; $entryIndex < $entryCount; $entryIndex++) {
        if (substr($archive, $cursor, 4) !== "\x50\x4b\x01\x02") {
            throw new RuntimeException('The PDS workbook central directory is invalid.');
        }

        $central = unpack(
            'vmadeBy/vneeded/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vuncompressed/'
            . 'vnameLength/vextraLength/vcommentLength/vdisk/vinternal/Vexternal/VlocalOffset',
            substr($archive, $cursor + 4, 42)
        );

        if (!is_array($central)) {
            throw new RuntimeException('A PDS workbook entry could not be read.');
        }

        $nameLength = (int)$central['nameLength'];
        $extraLength = (int)$central['extraLength'];
        $commentLength = (int)$central['commentLength'];
        $name = substr($archive, $cursor + 46, $nameLength);

        if ($name === '' || str_contains($name, "\0") || str_contains($name, '..')) {
            throw new RuntimeException('The PDS workbook contains an unsafe package entry.');
        }

        if (((int)$central['flags'] & 0x0001) !== 0) {
            throw new RuntimeException('Encrypted PDS workbook entries are not supported.');
        }

        $localOffset = (int)$central['localOffset'];

        if (substr($archive, $localOffset, 4) !== "\x50\x4b\x03\x04") {
            throw new RuntimeException('A PDS workbook local entry is invalid.');
        }

        $local = unpack(
            'vneeded/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vuncompressed/vnameLength/vextraLength',
            substr($archive, $localOffset + 4, 26)
        );

        if (!is_array($local)) {
            throw new RuntimeException('A PDS workbook local entry could not be read.');
        }

        $dataOffset = $localOffset + 30 + (int)$local['nameLength'] + (int)$local['extraLength'];
        $compressedSize = (int)$central['compressed'];
        $compressed = substr($archive, $dataOffset, $compressedSize);
        $method = (int)$central['method'];

        if ($method === 0) {
            $contents = $compressed;
        } elseif ($method === 8) {
            $contents = gzinflate($compressed);

            if ($contents === false) {
                throw new RuntimeException('A compressed PDS workbook entry could not be inflated.');
            }
        } else {
            throw new RuntimeException('The PDS workbook uses an unsupported compression method.');
        }

        if (strlen($contents) !== (int)$central['uncompressed']) {
            throw new RuntimeException('A PDS workbook entry has an invalid size.');
        }

        $actualCrc = (int)sprintf('%u', crc32($contents));
        $expectedCrc = (int)sprintf('%u', (int)$central['crc']);

        if ($actualCrc !== $expectedCrc) {
            throw new RuntimeException('A PDS workbook entry failed its integrity check.');
        }

        $parts[$name] = $contents;
        $cursor += 46 + $nameLength + $extraLength + $commentLength;
    }

    return $parts;
}

/** @param array<string, string> $parts */
function pds_xlsx_write_package(array $parts): string
{
    [$dosTime, $dosDate] = pds_xlsx_dos_datetime();
    $body = '';
    $central = '';

    foreach ($parts as $name => $contents) {
        $name = (string)$name;
        $contents = (string)$contents;
        $offset = strlen($body);
        $size = strlen($contents);
        $crc = (int)sprintf('%u', crc32($contents));
        $nameLength = strlen($name);

        $body .= pds_xlsx_u32(0x04034b50)
            . pds_xlsx_u16(20)
            . pds_xlsx_u16(0)
            . pds_xlsx_u16(0)
            . pds_xlsx_u16($dosTime)
            . pds_xlsx_u16($dosDate)
            . pds_xlsx_u32($crc)
            . pds_xlsx_u32($size)
            . pds_xlsx_u32($size)
            . pds_xlsx_u16($nameLength)
            . pds_xlsx_u16(0)
            . $name
            . $contents;

        $central .= pds_xlsx_u32(0x02014b50)
            . pds_xlsx_u16(20)
            . pds_xlsx_u16(20)
            . pds_xlsx_u16(0)
            . pds_xlsx_u16(0)
            . pds_xlsx_u16($dosTime)
            . pds_xlsx_u16($dosDate)
            . pds_xlsx_u32($crc)
            . pds_xlsx_u32($size)
            . pds_xlsx_u32($size)
            . pds_xlsx_u16($nameLength)
            . pds_xlsx_u16(0)
            . pds_xlsx_u16(0)
            . pds_xlsx_u16(0)
            . pds_xlsx_u16(0)
            . pds_xlsx_u32(0)
            . pds_xlsx_u32($offset)
            . $name;
    }

    $entryCount = count($parts);

    if ($entryCount > 65535) {
        throw new RuntimeException('The PDS workbook package contains too many entries.');
    }

    return $body
        . $central
        . pds_xlsx_u32(0x06054b50)
        . pds_xlsx_u16(0)
        . pds_xlsx_u16(0)
        . pds_xlsx_u16($entryCount)
        . pds_xlsx_u16($entryCount)
        . pds_xlsx_u32(strlen($central))
        . pds_xlsx_u32(strlen($body))
        . pds_xlsx_u16(0);
}

function pds_xlsx_clean_text(mixed $value): string
{
    return trim(preg_replace('/\s+/u', ' ', (string)($value ?? '')) ?? '');
}

function pds_xlsx_date(mixed $value): string
{
    $text = pds_xlsx_clean_text($value);

    if ($text === '') {
        return '';
    }

    try {
        return (new DateTimeImmutable($text))->format('d/m/Y');
    } catch (Throwable) {
        return $text;
    }
}

/** @return array{first:string,middle:string,last:string,suffix:string} */
function pds_xlsx_name_parts(mixed $value): array
{
    $name = pds_xlsx_clean_text($value);
    $parts = ['first' => '', 'middle' => '', 'last' => '', 'suffix' => ''];

    if ($name === '') {
        return $parts;
    }

    if (str_contains($name, ',')) {
        [$last, $rest] = array_pad(array_map('trim', explode(',', $name, 2)), 2, '');
        $parts['last'] = $last;
        $name = $rest;
    }

    $tokens = preg_split('/\s+/u', $name, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $suffixes = ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'];

    if ($tokens !== [] && in_array(strtolower((string)end($tokens)), $suffixes, true)) {
        $parts['suffix'] = (string)array_pop($tokens);
    }

    if ($parts['last'] === '' && $tokens !== []) {
        $parts['last'] = (string)array_pop($tokens);
    }

    if (count($tokens) >= 2) {
        $parts['middle'] = (string)array_pop($tokens);
    }

    $parts['first'] = implode(' ', $tokens);

    return $parts;
}

function pds_xlsx_set_cell(string $sheetXml, string $reference, mixed $value): string
{
    $text = pds_xlsx_clean_text($value);

    if ($text === '') {
        return $sheetXml;
    }

    $referencePattern = preg_quote(strtoupper($reference), '/');
    $pattern = '/<c\b(?=[^>]*\br="' . $referencePattern . '")([^>]*?)(?:\/>|>.*?<\/c>)/s';
    $replacementCount = 0;
    $updated = preg_replace_callback(
        $pattern,
        static function (array $match) use ($text): string {
            $attributes = preg_replace('/\s+t="[^"]*"/', '', trim((string)$match[1])) ?? trim((string)$match[1]);

            return '<c ' . $attributes . ' t="inlineStr"><is><t xml:space="preserve">'
                . pds_xlsx_xml_escape($text) . '</t></is></c>';
        },
        $sheetXml,
        1,
        $replacementCount
    );

    if ($updated === null || $replacementCount !== 1) {
        throw new RuntimeException('The PDS template cell ' . strtoupper($reference) . ' was not found.');
    }

    return $updated;
}

/** @param array<string, mixed> $values */
function pds_xlsx_set_cells(string $sheetXml, array $values): string
{
    foreach ($values as $reference => $value) {
        $sheetXml = pds_xlsx_set_cell($sheetXml, (string)$reference, $value);
    }

    return $sheetXml;
}

/** @param array<string, string> $parts */
function pds_xlsx_check_control(
    array &$parts,
    string $controlPropertyPart,
    string $vmlPart,
    int $shapeId
): void {
    if (!isset($parts[$controlPropertyPart], $parts[$vmlPart])) {
        throw new RuntimeException('A required PDS checkbox control is missing from the template.');
    }

    $controlXml = preg_replace('/\s+checked="[^"]*"/', '', $parts[$controlPropertyPart]) ?? $parts[$controlPropertyPart];
    $controlXml = preg_replace('/<formControlPr\b/', '<formControlPr checked="Checked"', $controlXml, 1, $controlCount);

    if ($controlCount !== 1) {
        throw new RuntimeException('A PDS checkbox property could not be updated.');
    }

    $parts[$controlPropertyPart] = $controlXml;
    $shapePattern = '/(<v:shape\b(?=[^>]*\b(?:id|o:spid)="_x0000_s' . $shapeId . '")[^>]*>'
        . '.*?<x:ClientData\b[^>]*>)(.*?)(<\/x:ClientData>.*?<\/v:shape>)/s';
    $vmlXml = preg_replace_callback(
        $shapePattern,
        static function (array $match): string {
            $clientData = preg_replace('/\s*<x:Checked>.*?<\/x:Checked>/s', '', (string)$match[2]) ?? (string)$match[2];

            if (str_contains($clientData, '<x:NoThreeD/>')) {
                $clientData = str_replace('<x:NoThreeD/>', '<x:Checked>1</x:Checked><x:NoThreeD/>', $clientData);
            } else {
                $clientData .= '<x:Checked>1</x:Checked>';
            }

            return $match[1] . $clientData . $match[3];
        },
        $parts[$vmlPart],
        1,
        $shapeCount
    );

    if ($vmlXml === null || $shapeCount !== 1) {
        throw new RuntimeException('A PDS checkbox drawing could not be updated.');
    }

    $parts[$vmlPart] = $vmlXml;
}

function pds_xlsx_education_row(mixed $level): int
{
    $normalized = strtolower(pds_xlsx_clean_text($level));

    if (preg_match('/graduate|master|doctor|phd/', $normalized)) {
        return 58;
    }
    if (preg_match('/college|bachelor|university/', $normalized)) {
        return 57;
    }
    if (preg_match('/vocational|trade|technical|tesda/', $normalized)) {
        return 56;
    }
    if (preg_match('/secondary|high school|senior high|junior high/', $normalized)) {
        return 55;
    }

    return 54;
}

/**
 * @param array<string, mixed> $employee
 * @param array<int, array<string, mixed>> $serviceRecords
 */
function pds_xlsx_build(
    string $templatePath,
    array $employee,
    array $serviceRecords,
    ?DateTimeInterface $dateAccomplished = null
): string {
    $parts = pds_xlsx_read_package($templatePath);

    foreach (['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml'] as $part) {
        if (!isset($parts[$part])) {
            throw new RuntimeException('The official PDS workbook is missing a required sheet.');
        }
    }

    $family = is_array($employee['family_background'] ?? null) ? $employee['family_background'] : [];
    $spouse = $family !== [] ? [
        'last' => pds_xlsx_clean_text($family['spouseLastName'] ?? ''),
        'first' => pds_xlsx_clean_text($family['spouseFirstName'] ?? ''),
        'middle' => pds_xlsx_clean_text($family['spouseMiddleName'] ?? ''),
        'suffix' => pds_xlsx_clean_text($family['spouseSuffix'] ?? ''),
    ] : pds_xlsx_name_parts($employee['spouse_name'] ?? '');
    $father = $family !== [] ? [
        'last' => pds_xlsx_clean_text($family['fatherLastName'] ?? ''),
        'first' => pds_xlsx_clean_text($family['fatherFirstName'] ?? ''),
        'middle' => pds_xlsx_clean_text($family['fatherMiddleName'] ?? ''),
        'suffix' => pds_xlsx_clean_text($family['fatherSuffix'] ?? ''),
    ] : pds_xlsx_name_parts($employee['father_name'] ?? '');
    $mother = $family !== [] ? [
        'last' => pds_xlsx_clean_text($family['motherMaidenLastName'] ?? ''),
        'first' => pds_xlsx_clean_text($family['motherFirstName'] ?? ''),
        'middle' => pds_xlsx_clean_text($family['motherMiddleName'] ?? ''),
        'suffix' => '',
    ] : pds_xlsx_name_parts($employee['mother_name'] ?? '');
    $address = pds_xlsx_clean_text($employee['address'] ?? '');
    $barangay = pds_xlsx_clean_text($employee['barangay'] ?? '');
    $city = pds_xlsx_clean_text($employee['city'] ?? '');
    $province = pds_xlsx_clean_text($employee['province'] ?? '');
    $zipCode = pds_xlsx_clean_text($employee['zip_code'] ?? '');
    $completedOn = ($dateAccomplished ?? new DateTimeImmutable('now'))->format('d/m/Y');
    $educationRows = [];
    foreach (($employee['education_background'] ?? []) as $education) {
        if (!is_array($education)) {
            continue;
        }
        $level = strtolower(pds_xlsx_clean_text($education['level'] ?? ''));
        if (in_array($level, ['elementary', 'secondary', 'vocational', 'college', 'graduate'], true)) {
            $educationRows[$level] = $education;
        }
    }
    if ($educationRows === []) {
        $legacyLevel = strtolower(pds_xlsx_clean_text($employee['highest_education'] ?? ''));
        $educationRows[$legacyLevel] = [
            'level' => $legacyLevel,
            'schoolName' => $employee['school_name'] ?? '',
            'degreeCourse' => $employee['education_course'] ?? '',
            'yearGraduated' => $employee['year_graduated'] ?? '',
        ];
    }

    $sheetOneValues = [

        'D10' => $employee['last_name'] ?? '',
        'D11' => $employee['first_name'] ?? '',
        'D12' => $employee['middle_name'] ?? '',
        'L12' => $employee['suffix'] ?? '',
        'D13' => pds_xlsx_date($employee['date_of_birth'] ?? ''),
        'D15' => $employee['place_of_birth'] ?? '',
        'D22' => $employee['height'] ?? '',
        'D24' => $employee['weight'] ?? '',
        'D25' => $employee['blood_type'] ?? '',
        'D29' => $employee['emp_pagibig_id_no'] ?? '',
        'D31' => $employee['emp_philhealth_id_no'] ?? '',
        'D33' => $employee['tin_no'] ?? '',
        'D34' => $employee['employee_id'] ?? '',
        'I17' => $address,
        'L19' => $barangay,
        'I22' => $city,
        'L22' => $province,
        'I24' => $zipCode,
        'I25' => $address,
        'L27' => $barangay,
        'I29' => $city,
        'L29' => $province,
        'I31' => $zipCode,
        'I33' => $employee['phone'] ?? '',
        'I34' => $employee['email'] ?? '',
        'D36' => $spouse['last'],
        'D37' => $spouse['first'],
        'L37' => $spouse['suffix'],
        'D38' => $spouse['middle'],
        'D39' => $family['spouseOccupation'] ?? $employee['spouse_occupation'] ?? '',
        'D40' => $family['spouseEmployer'] ?? '',
        'D41' => $family['spouseBusinessAddress'] ?? '',
        'D42' => $family['spouseTelephone'] ?? '',
        'D43' => $father['last'],
        'D44' => $father['first'],
        'L44' => $father['suffix'],
        'D45' => $father['middle'],
        'D47' => $mother['last'],
        'D48' => $mother['first'],
        'D49' => $mother['middle'],
        'L60' => $completedOn,
    ];

    foreach (array_slice(is_array($employee['children'] ?? null) ? $employee['children'] : [], 0, 12) as $index => $child) {
        if (!is_array($child)) {
            continue;
        }
        $row = 37 + $index;
        $sheetOneValues['I' . $row] = $child['fullName'] ?? '';
        $sheetOneValues['M' . $row] = pds_xlsx_date($child['dateOfBirth'] ?? '');
    }

    $educationLevelRows = [
        'elementary' => 54,
        'secondary' => 55,
        'vocational' => 56,
        'college' => 57,
        'graduate' => 58,
    ];
    foreach ($educationRows as $level => $education) {
        $row = $educationLevelRows[$level] ?? pds_xlsx_education_row($level);
        $sheetOneValues['D' . $row] = $education['schoolName'] ?? '';
        $sheetOneValues['G' . $row] = $education['degreeCourse'] ?? '';
        $sheetOneValues['J' . $row] = $education['attendanceFrom'] ?? '';
        $sheetOneValues['K' . $row] = $education['attendanceTo'] ?? '';
        $sheetOneValues['L' . $row] = $education['highestLevelUnits'] ?? '';
        $sheetOneValues['M' . $row] = $education['yearGraduated'] ?? '';
        $sheetOneValues['N' . $row] = $education['honors'] ?? '';
    }

    $parts['xl/worksheets/sheet1.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet1.xml'], $sheetOneValues);

    $gender = strtolower(pds_xlsx_clean_text($employee['gender'] ?? ''));
    if ($gender === 'male') {
        pds_xlsx_check_control($parts, 'xl/ctrlProps/ctrlProp4.xml', 'xl/drawings/vmlDrawing1.vml', 1049);
    } elseif ($gender === 'female') {
        pds_xlsx_check_control($parts, 'xl/ctrlProps/ctrlProp5.xml', 'xl/drawings/vmlDrawing1.vml', 1050);
    }

    $civilStatus = strtolower(pds_xlsx_clean_text($employee['civil_status'] ?? ''));
    $civilControls = [
        'single' => ['xl/ctrlProps/ctrlProp6.xml', 1058],
        'married' => ['xl/ctrlProps/ctrlProp7.xml', 1059],
        'widowed' => ['xl/ctrlProps/ctrlProp8.xml', 1060],
        'separated' => ['xl/ctrlProps/ctrlProp10.xml', 1062],
    ];

    if (isset($civilControls[$civilStatus])) {
        pds_xlsx_check_control(
            $parts,
            $civilControls[$civilStatus][0],
            'xl/drawings/vmlDrawing1.vml',
            $civilControls[$civilStatus][1]
        );
    } elseif ($civilStatus !== '') {
        pds_xlsx_check_control($parts, 'xl/ctrlProps/ctrlProp9.xml', 'xl/drawings/vmlDrawing1.vml', 1061);
    }

    if (strtolower(pds_xlsx_clean_text($employee['nationality'] ?? 'Filipino')) === 'filipino') {
        pds_xlsx_check_control($parts, 'xl/ctrlProps/ctrlProp2.xml', 'xl/drawings/vmlDrawing1.vml', 1045);
    }

    $workSheetValues = ['J47' => $completedOn];
    foreach (array_slice($serviceRecords, 0, 28) as $index => $record) {
        $row = 18 + $index;
        $workSheetValues['A' . $row] = pds_xlsx_date($record['service_from'] ?? '');
        $workSheetValues['C' . $row] = pds_xlsx_clean_text($record['service_to'] ?? '') !== ''
            ? pds_xlsx_date($record['service_to'])
            : 'PRESENT';
        $workSheetValues['D' . $row] = $record['designation_title'] ?? '';
        $workSheetValues['G' . $row] = $record['organization'] ?? '';
        $workSheetValues['J' . $row] = $record['employment_status'] ?? '';
        $workSheetValues['K' . $row] = $record['government_service'] ?? 'Y';
    }
    $parts['xl/worksheets/sheet2.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet2.xml'], $workSheetValues);

    $parts['xl/worksheets/sheet3.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet3.xml'], [
        'I50' => $completedOn,
    ]);

    $parts['xl/worksheets/sheet4.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet4.xml'], [
        'D61' => pds_xlsx_clean_text($employee['emp_gsis_id_no'] ?? '') !== '' ? 'GSIS' : '',
        'D62' => $employee['emp_gsis_id_no'] ?? '',
        'F64' => $completedOn,
    ]);

    if ((int)($employee['pwd'] ?? 0) === 1) {
        pds_xlsx_check_control($parts, 'xl/ctrlProps/ctrlProp28.xml', 'xl/drawings/vmlDrawing2.vml', 4112);
    } else {
        pds_xlsx_check_control($parts, 'xl/ctrlProps/ctrlProp31.xml', 'xl/drawings/vmlDrawing2.vml', 4115);
    }

    return pds_xlsx_write_package($parts);
}
