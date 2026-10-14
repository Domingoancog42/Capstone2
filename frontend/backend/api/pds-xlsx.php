<?php
declare(strict_types=1);

/**
 * Minimal XLSX template reader/writer for CS Form No. 212, Revised 2026.
 *
 * The local XAMPP PHP build does not load ext-zip. Rebuilding the form would also risk changing
 * its page geometry, controls, borders, and printer settings. This helper therefore reads the
 * existing Open XML package, fills named cells/control states, normalizes its print/view settings,
 * and writes it back as a standards-compliant stored-entry ZIP archive.
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

    if ($text === '' && !is_bool($value)) {
        return $sheetXml;
    }

    $referencePattern = preg_quote(strtoupper($reference), '/');
    $pattern = '/<c\b(?=[^>]*\br="' . $referencePattern . '")([^>]*?)(?:\/>|>.*?<\/c>)/s';
    $replacementCount = 0;
    $updated = preg_replace_callback(
        $pattern,
        static function (array $match) use ($text, $value): string {
            $attributes = preg_replace('/\s+t="[^"]*"/', '', trim((string)$match[1])) ?? trim((string)$match[1]);

            if (is_bool($value)) {
                return '<c ' . $attributes . ' t="b"><v>' . ($value ? '1' : '0') . '</v></c>';
            }
            if (is_int($value) || is_float($value)) {
                if (!is_finite((float)$value)) {
                    throw new InvalidArgumentException('A PDS numeric value must be finite.');
                }
                return '<c ' . $attributes . '><v>' . pds_xlsx_xml_escape($value) . '</v></c>';
            }

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
    int $shapeId,
    bool $checked = true
): void {
    if (!isset($parts[$controlPropertyPart], $parts[$vmlPart])) {
        throw new RuntimeException('A required PDS checkbox control is missing from the template.');
    }

    $controlXml = preg_replace('/\s+checked="[^"]*"/', '', $parts[$controlPropertyPart]) ?? $parts[$controlPropertyPart];
    // Excel rejects explicit Unchecked properties in this legacy-control workbook.
    // The omitted attribute is its native unchecked state; linked cells/VML agree with it.
    if ($checked) {
        $controlXml = preg_replace('/<formControlPr\b/', '<formControlPr checked="Checked"', $controlXml, 1, $controlCount);
        if ($controlCount !== 1) {
            throw new RuntimeException('A PDS checkbox property could not be updated.');
        }
    }

    $parts[$controlPropertyPart] = (string)$controlXml;
    $shapePattern = '/(<v:shape\b(?=[^>]*\b(?:id|o:spid)="_x0000_s' . $shapeId . '")[^>]*>'
        . '.*?<x:ClientData\b[^>]*>)(.*?)(<\/x:ClientData>.*?<\/v:shape>)/s';
    $vmlXml = preg_replace_callback(
        $shapePattern,
        static function (array $match) use ($checked): string {
            $clientData = preg_replace('/\s*<x:Checked>.*?<\/x:Checked>/s', '', (string)$match[2]) ?? (string)$match[2];

            if ($checked) {
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

    $parts[$vmlPart] = (string)$vmlXml;
}

/** Use the PDF's legal-size page layout while keeping the form cells editable. */
function pds_xlsx_prepare_layout(array &$parts): void
{
    $namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    $relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    $loadXml = static function (string $xml): DOMDocument {
        $document = new DOMDocument();
        if (!$document->loadXML($xml, LIBXML_NONET)) {
            throw new RuntimeException('The PDS layout contains invalid XML.');
        }
        return $document;
    };
    $child = static function (DOMElement $parent, string $name) use ($namespace): DOMElement {
        foreach ($parent->childNodes as $node) {
            if ($node instanceof DOMElement && $node->namespaceURI === $namespace && $node->localName === $name) {
                return $node;
            }
        }
        throw new RuntimeException('The PDS layout is missing ' . $name . '.');
    };
    $styles = $loadXml($parts['xl/styles.xml']);
    $formats = $styles->getElementsByTagNameNS($namespace, 'cellXfs')->item(0);
    // Visible blank columns give Excel a white canvas beyond the form. Hiding
    // every remaining column instead exposes the application's dark workspace.
    $fills = $styles->getElementsByTagNameNS($namespace, 'fills')->item(0);
    $whiteFillId = $fills->getElementsByTagNameNS($namespace, 'fill')->length;
    $whiteFill = $styles->createElementNS($namespace, 'fill');
    $pattern = $styles->createElementNS($namespace, 'patternFill');
    $whiteFill->appendChild($pattern);
    $pattern->setAttribute('patternType', 'solid');
    $foreground = $styles->createElementNS($namespace, 'fgColor');
    $foreground->setAttribute('rgb', 'FFFFFFFF');
    $pattern->appendChild($foreground);
    $fills->appendChild($whiteFill);
    $fills->setAttribute('count', (string)($whiteFillId + 1));
    $blankStyle = $formats->getElementsByTagNameNS($namespace, 'xf')->item(0)->cloneNode(true);
    if (!$blankStyle instanceof DOMElement) {
        throw new RuntimeException('The PDS blank cell has an invalid style.');
    }
    $blankStyle->setAttribute('fillId', (string)$whiteFillId);
    $blankStyle->setAttribute('applyFill', '1');
    $blankStyleId = $formats->getElementsByTagNameNS($namespace, 'xf')->length;
    $formats->appendChild($blankStyle);
    $styleCache = [];
    $inputStyle = static function (int $styleId, bool $salary) use ($styles, $formats, $namespace, &$styleCache): int {
        $key = $styleId . ':' . (int)$salary;
        if (isset($styleCache[$key])) {
            return $styleCache[$key];
        }
        $source = $formats->getElementsByTagNameNS($namespace, 'xf')->item($styleId);
        if ($source === null) {
            throw new RuntimeException('A PDS input cell has an invalid style.');
        }
        $format = $source->cloneNode(true);
        if (!$format instanceof DOMElement) {
            throw new RuntimeException('A PDS input cell has an invalid style.');
        }
        $alignment = $format->getElementsByTagNameNS($namespace, 'alignment')->item(0);
        if ($alignment === null) {
            $alignment = $styles->createElementNS($namespace, 'alignment');
            $format->appendChild($alignment);
        }
        $alignment->setAttribute('vertical', 'center');
        $alignment->setAttribute('wrapText', '0');
        $alignment->setAttribute('shrinkToFit', '1');
        $format->setAttribute('applyAlignment', '1');
        if ($salary) {
            $format->setAttribute('numFmtId', '4'); // #,##0.00, matching the PDF.
            $format->setAttribute('applyNumberFormat', '1');
        }
        $index = $formats->getElementsByTagNameNS($namespace, 'xf')->length;
        $formats->appendChild($format);
        return $styleCache[$key] = $index;
    };
    $workbook = $loadXml($parts['xl/workbook.xml']);
    $populatedSheets = [];
    foreach ($workbook->getElementsByTagNameNS($namespace, 'definedName') as $area) {
        if (!$area instanceof DOMElement) {
            continue;
        }
        if ($area->getAttribute('name') !== '_xlnm.Print_Area') {
            continue;
        }
        $index = (int)$area->getAttribute('localSheetId');
        $sheetNumber = $index + 1;
        $part = 'xl/worksheets/sheet' . $sheetNumber . '.xml';
        $sheet = $loadXml($parts[$part]);
        $setup = $child($sheet->documentElement, 'pageSetup');
        $setup->setAttribute('paperSize', '5'); // 8.5 x 14 inches, like the PDF.
        $setup->setAttribute('orientation', 'portrait');
        $setup->setAttribute('fitToWidth', '1');
        $setup->setAttribute('fitToHeight', '1');
        $setup->removeAttribute('scale');
        $setup->removeAttributeNS($relationshipNamespace, 'id');
        foreach (['left', 'right', 'top', 'bottom'] as $edge) {
            $child($sheet->documentElement, 'pageMargins')->setAttribute($edge, '0.1666666666666667');
        }
        $printOptions = $child($sheet->documentElement, 'printOptions');
        $printOptions->setAttribute('horizontalCentered', '0');
        $printOptions->setAttribute('verticalCentered', '0');
        $view = $child($child($sheet->documentElement, 'sheetViews'), 'sheetView');
        // Page Layout editing view shows unscaled page gutters across this wide form.
        // Use a continuous worksheet view; print/PDF pagination is configured above.
        foreach (['view' => 'normal', 'zoomScale' => '100', 'zoomScaleNormal' => '100',
            'topLeftCell' => 'A1', 'showGridLines' => '0', 'tabSelected' => $index === 0 ? '1' : '0'] as $attribute => $value) {
            $view->setAttribute($attribute, $value);
        }
        $view->removeAttribute('zoomScalePageLayoutView');
        $view->removeAttribute('zoomScaleSheetLayoutView');
        $sheetProperties = $child($sheet->documentElement, 'sheetPr');
        $sheetProperties->setAttribute('showPageBreaks', '0');
        $pageProperties = $sheetProperties->getElementsByTagNameNS($namespace, 'pageSetUpPr')->item(0);
        if ($pageProperties === null) {
            $pageProperties = $sheet->createElementNS($namespace, 'pageSetUpPr');
            $sheetProperties->appendChild($pageProperties);
        }
        // Fit dimensions alone do not enable scaling on continuation sheet C5.
        $pageProperties->setAttribute('fitToPage', '1');
        if (!preg_match('/!\$[A-Z]+\$\d+:\$([A-Z]+)\$(\d+)$/', $area->textContent, $printEnd)) {
            throw new RuntimeException('The PDS print area is invalid.');
        }
        $lastColumn = 0;
        foreach (str_split($printEnd[1]) as $letter) {
            $lastColumn = $lastColumn * 26 + ord($letter) - 64;
        }
        // The country dropdown and template notes live outside the print area.
        // Keep that data hidden, then expose only empty columns after it.
        $lastHelperColumn = $lastColumn;
        foreach ($child($sheet->documentElement, 'sheetData')->getElementsByTagNameNS($namespace, 'c') as $cell) {
            if (!$cell instanceof DOMElement) {
                continue;
            }
            if ($cell->getElementsByTagNameNS($namespace, 'v')->length === 0
                && $cell->getElementsByTagNameNS($namespace, 'f')->length === 0
                && $cell->getElementsByTagNameNS($namespace, 'is')->length === 0) {
                continue;
            }
            preg_match('/^([A-Z]+)/', $cell->getAttribute('r'), $cellColumn);
            $number = 0;
            foreach (str_split($cellColumn[1]) as $letter) {
                $number = $number * 26 + ord($letter) - 64;
            }
            $lastHelperColumn = max($lastHelperColumn, $number);
        }
        $columns = $child($sheet->documentElement, 'cols');
        foreach (iterator_to_array($columns->childNodes) as $column) {
            if (!$column instanceof DOMElement || $column->localName !== 'col') {
                continue;
            }
            $first = (int)$column->getAttribute('min');
            $last = (int)$column->getAttribute('max');
            if ($first > $lastColumn) {
                $columns->removeChild($column);
            } elseif ($last > $lastColumn) {
                $column->setAttribute('max', (string)$lastColumn);
            }
        }
        if ($lastHelperColumn > $lastColumn) {
            $helpers = $sheet->createElementNS($namespace, 'col');
            $helpers->setAttribute('min', (string)($lastColumn + 1));
            $helpers->setAttribute('max', (string)$lastHelperColumn);
            $helpers->setAttribute('hidden', '1');
            $columns->appendChild($helpers);
        }
        $blankColumns = $sheet->createElementNS($namespace, 'col');
        $blankColumns->setAttribute('min', (string)($lastHelperColumn + 1));
        $blankColumns->setAttribute('max', '16384');
        $blankColumns->setAttribute('width', '8.43');
        $blankColumns->setAttribute('customWidth', '1');
        $blankColumns->setAttribute('style', (string)$blankStyleId);
        $blankColumns->setAttribute('hidden', '0');
        $columns->appendChild($blankColumns);
        foreach ($child($sheet->documentElement, 'sheetData')->getElementsByTagNameNS($namespace, 'row') as $row) {
            if (!$row instanceof DOMElement) {
                continue;
            }
            if ((int)$row->getAttribute('r') > (int)$printEnd[2]) {
                $row->setAttribute('hidden', '1');
            }
        }
        foreach ($view->getElementsByTagNameNS($namespace, 'selection') as $selection) {
            if (!$selection instanceof DOMElement) {
                continue;
            }
            $selection->setAttribute('activeCell', 'A1');
            $selection->setAttribute('sqref', 'A1');
        }
        foreach ($sheet->getElementsByTagNameNS($namespace, 'c') as $cell) {
            if (!$cell instanceof DOMElement) {
                continue;
            }
            $reference = $cell->getAttribute('r');
            $salary = in_array($sheetNumber, [2, 6], true) && preg_match('/^J(\d+)$/', $reference, $row)
                && (int)$row[1] >= ($sheetNumber === 2 ? 18 : 7)
                && (int)$row[1] <= ($sheetNumber === 2 ? 41 : 39)
                && $cell->getAttribute('t') === '' && $cell->getElementsByTagNameNS($namespace, 'v')->length > 0;
            if ($cell->getAttribute('t') === 'inlineStr' || $salary) {
                $cell->setAttribute('s', (string)$inputStyle((int)$cell->getAttribute('s'), (bool)$salary));
                $populatedSheets[$index] = true;
            }
        }
        $parts[$part] = $sheet->saveXML();
    }
    foreach ($workbook->getElementsByTagNameNS($namespace, 'sheet') as $index => $sheet) {
        if (!$sheet instanceof DOMElement) {
            continue;
        }
        if ($index >= 4 && !isset($populatedSheets[$index])) {
            $sheet->setAttribute('state', 'hidden');
        } else {
            $sheet->removeAttribute('state');
        }
    }
    foreach ($workbook->getElementsByTagNameNS($namespace, 'workbookView') as $view) {
        if (!$view instanceof DOMElement) {
            continue;
        }
        $view->setAttribute('activeTab', '0');
        $view->setAttribute('firstSheet', '0');
    }
    $formats->setAttribute('count', (string)$formats->getElementsByTagNameNS($namespace, 'xf')->length);
    $parts['xl/styles.xml'] = $styles->saveXML();
    $parts['xl/workbook.xml'] = $workbook->saveXML();
}

/** Resolve a checkbox through its linked cell instead of revision-specific shape IDs. */
function pds_xlsx_set_checkbox(array &$parts, int $sheetNumber, string $reference, bool $checked): void
{
    $sheetPart = 'xl/worksheets/sheet' . $sheetNumber . '.xml';
    $relationshipPart = 'xl/worksheets/_rels/sheet' . $sheetNumber . '.xml.rels';
    $relationships = [];
    $vmlPart = '';
    preg_match_all('/<Relationship\b[^>]*\/>/', $parts[$relationshipPart] ?? '', $matches);
    foreach ($matches[0] as $relationship) {
        preg_match('/\bId="([^"]+)"/', $relationship, $id);
        preg_match('/\bTarget="([^"]+)"/', $relationship, $target);
        $part = 'xl/' . preg_replace('#^\.\./#', '', $target[1] ?? '');
        $relationships[$id[1] ?? ''] = $part;
        if (str_contains($relationship, '/vmlDrawing"')) {
            $vmlPart = $part;
        }
    }
    preg_match_all('/<(?:\w+:)?control\b[^>]*>/', $parts[$sheetPart] ?? '', $controls);
    foreach ($controls[0] as $control) {
        preg_match('/\br:id="([^"]+)"/', $control, $id);
        preg_match('/\bshapeId="(\d+)"/', $control, $shape);
        $propertyPart = $relationships[$id[1] ?? ''] ?? '';
        preg_match('/\bfmlaLink="([^"]+)"/', $parts[$propertyPart] ?? '', $link);
        if (str_replace('$', '', $link[1] ?? '') !== $reference) {
            continue;
        }
        pds_xlsx_check_control($parts, $propertyPart, $vmlPart, (int)($shape[1] ?? 0), $checked);
        $parts[$sheetPart] = pds_xlsx_set_cell($parts[$sheetPart], $reference, $checked);
        return;
    }
    throw new RuntimeException('The PDS checkbox linked to ' . $reference . ' was not found.');
}

function pds_xlsx_education_row(mixed $level): int
{
    $normalized = strtolower(pds_xlsx_clean_text($level));

    if (preg_match('/graduate|master|doctor|phd/', $normalized)) {
        return 59;
    }
    if (preg_match('/college|bachelor|university/', $normalized)) {
        return 58;
    }
    if (preg_match('/vocational|trade|technical|tesda/', $normalized)) {
        return 57;
    }
    if (preg_match('/secondary|high school|senior high|junior high/', $normalized)) {
        return 56;
    }

    return 55;
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

    foreach ([1, 2, 3, 4, 5, 6, 9] as $sheetNumber) {
        $part = 'xl/worksheets/sheet' . $sheetNumber . '.xml';
        if (!isset($parts[$part])) {
            throw new RuntimeException('The official PDS workbook is missing a required sheet.');
        }
    }

    // Start with unanswered controls, including the linked values in this revision.
    foreach ($parts as $name => $contents) {
        if (str_starts_with($name, 'xl/ctrlProps/')) {
            $parts[$name] = preg_replace('/\s+checked="[^"]*"/', '', $contents) ?? $contents;
        } elseif (str_starts_with($name, 'xl/drawings/vmlDrawing')) {
            $parts[$name] = preg_replace('/<x:Checked>.*?<\/x:Checked>/s', '', $contents) ?? $contents;
        } elseif (str_starts_with($name, 'xl/worksheets/sheet')) {
            $parts[$name] = preg_replace('/(<c\b[^>]*\bt="b"[^>]*>\s*<v>)[01](<\/v>)/', '${1}0$2', $contents) ?? $contents;
        }
    }
    // The public mirror has a sample placeholder behind the question 35(b) drawing.
    $parts['xl/sharedStrings.xml'] = str_replace("   Don't Know ", ' ', $parts['xl/sharedStrings.xml']);
    // A country cannot be inferred from the stored nationality; leave the dropdown unselected.
    $parts['xl/ctrlProps/ctrlProp1.xml'] = preg_replace('/\b(sel|val)="\d+"/', '$1="0"', $parts['xl/ctrlProps/ctrlProp1.xml']) ?? $parts['xl/ctrlProps/ctrlProp1.xml'];
    $parts['xl/drawings/vmlDrawing1.vml'] = preg_replace('/<x:Sel>\d+<\/x:Sel>/', '<x:Sel>0</x:Sel>', $parts['xl/drawings/vmlDrawing1.vml']) ?? $parts['xl/drawings/vmlDrawing1.vml'];
    $parts['xl/worksheets/sheet1.xml'] = pds_xlsx_set_cell($parts['xl/worksheets/sheet1.xml'], 'J16', 0);

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
        'N11' => $employee['suffix'] ?? '',
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
        'H37' => $spouse['suffix'],
        'D38' => $spouse['middle'],
        'D39' => $family['spouseOccupation'] ?? $employee['spouse_occupation'] ?? '',
        'D40' => $family['spouseEmployer'] ?? '',
        'D41' => $family['spouseBusinessAddress'] ?? '',
        'D42' => $family['spouseTelephone'] ?? '',
        'D44' => $father['last'],
        'D45' => $father['first'],
        'H45' => $father['suffix'],
        'D46' => $father['middle'],
        'D48' => $mother['last'],
        'D49' => $mother['first'],
        'D50' => $mother['middle'],
        'L61' => $completedOn,
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
        'elementary' => 55,
        'secondary' => 56,
        'vocational' => 57,
        'college' => 58,
        'graduate' => 59,
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
    if (in_array($gender, ['male', 'female'], true)) {
        pds_xlsx_set_checkbox($parts, 1, 'D16', $gender === 'male');
        pds_xlsx_set_checkbox($parts, 1, 'E16', $gender === 'female');
    }

    $civilStatus = strtolower(pds_xlsx_clean_text($employee['civil_status'] ?? ''));
    $civilControls = [
        'single' => 'D17',
        'married' => 'E17',
        'widowed' => 'D18',
        'separated' => 'E19',
    ];

    if ($civilStatus !== '') {
        foreach (array_merge(array_values($civilControls), ['D20']) as $reference) {
            pds_xlsx_set_checkbox($parts, 1, $reference, $reference === ($civilControls[$civilStatus] ?? 'D20'));
        }
    }

    if (strtolower(pds_xlsx_clean_text($employee['nationality'] ?? 'Filipino')) === 'filipino') {
        pds_xlsx_set_checkbox($parts, 1, 'J13', true);
    }

    $workSheetValues = ['J43' => $completedOn];
    $eligibility = is_array($employee['civil_service_eligibility'] ?? null) ? $employee['civil_service_eligibility'] : [];
    if (count($eligibility) > 31) {
        throw new InvalidArgumentException('The PDS workbook supports up to 31 civil service eligibility entries.');
    }
    $eligibilityContinuationValues = [];
    foreach (array_values($eligibility) as $index => $record) {
        $main = $index < 7;
        $row = $main ? 5 + $index : 5 + $index - 7;
        $values = [
            'A' . $row => $record['eligibilityName'] ?? '',
            'F' . $row => $record['rating'] ?? '',
            'G' . $row => pds_xlsx_date($record['examinationDate'] ?? ''),
            'I' . $row => $record['examinationPlace'] ?? '',
            ($main ? 'L' : 'J') . $row => $record['licenseNumber'] ?? '',
            ($main ? 'M' : 'K') . $row => pds_xlsx_date($record['validityDate'] ?? ''),
        ];
        if ($main) {
            $workSheetValues = array_merge($workSheetValues, $values);
        } else {
            $eligibilityContinuationValues = array_merge($eligibilityContinuationValues, $values);
        }
    }
    if ($eligibilityContinuationValues !== []) {
        $eligibilityContinuationValues['I29'] = $completedOn;
        $parts['xl/worksheets/sheet9.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet9.xml'], $eligibilityContinuationValues);
    }
    $workContinuationValues = [];
    foreach (array_slice($serviceRecords, 0, 28) as $index => $record) {
        // C2 has 24 work rows; additional records belong in C6, starting at row 7.
        $row = $index < 24 ? 18 + $index : 7 + $index - 24;
        $values = [];
        $values['A' . $row] = pds_xlsx_date($record['service_from'] ?? '');
        $values['C' . $row] = pds_xlsx_clean_text($record['service_to'] ?? '') !== ''
            ? pds_xlsx_date($record['service_to'])
            : 'PRESENT';
        $values['D' . $row] = $record['designation_title'] ?? '';
        $values['G' . $row] = $record['organization'] ?? '';
        $salary = pds_xlsx_clean_text($record['monthly_salary'] ?? '');
        $values['J' . $row] = $salary !== '' && is_numeric($salary) ? (float)$salary : $salary;
        $grade = pds_xlsx_clean_text($record['salary_grade'] ?? '');
        $step = pds_xlsx_clean_text($record['step_increment'] ?? '');
        $values['K' . $row] = $grade !== '' ? $grade . ($step !== '' ? '-' . $step : '') : '';
        $values['L' . $row] = $record['employment_status'] ?? '';
        $values['M' . $row] = $record['government_service'] ?? 'Y';
        if ($index < 24) {
            $workSheetValues = array_merge($workSheetValues, $values);
        } else {
            $workContinuationValues = array_merge($workContinuationValues, $values);
        }
    }
    $parts['xl/worksheets/sheet2.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet2.xml'], $workSheetValues);
    if ($workContinuationValues !== []) {
        $workContinuationValues['I40'] = $completedOn;
        $parts['xl/worksheets/sheet6.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet6.xml'], $workContinuationValues);
    }

    $training = is_array($employee['learning_development'] ?? null) ? $employee['learning_development'] : [];
    if (count($training) > 61) {
        throw new InvalidArgumentException('The PDS workbook supports up to 61 learning and development entries.');
    }
    $trainingValues = ['I47' => $completedOn];
    $trainingContinuationValues = [];
    $trainingMerges = [];
    foreach (array_values($training) as $index => $record) {
        $main = $index < 17;
        $row = $main ? 5 + $index : 6 + $index - 17;
        $hours = pds_xlsx_clean_text($record['hours'] ?? '');
        $values = [
            'A' . $row => $record['title'] ?? '',
            'E' . $row => pds_xlsx_date($record['dateFrom'] ?? ''),
            'F' . $row => pds_xlsx_date($record['dateTo'] ?? ''),
            'G' . $row => $hours !== '' && is_numeric($hours) ? (float)$hours : $hours,
            'H' . $row => $record['type'] ?? '',
            'I' . $row => $record['conductedBy'] ?? '',
        ];
        if ($main) {
            $trainingValues = array_merge($trainingValues, $values);
            // The mirror omits the title/sponsor merges in rows 12-21. Complete
            // those fields when used so entered text fits the full printed box.
            if ($row >= 12) {
                $trainingMerges[] = 'A' . $row . ':D' . $row;
                $trainingMerges[] = 'I' . $row . ':K' . $row;
            }
        } else {
            $trainingContinuationValues = array_merge($trainingContinuationValues, $values);
        }
    }
    if ($trainingMerges !== []) {
        $parts['xl/worksheets/sheet3.xml'] = preg_replace_callback('/<mergeCells\b[^>]*>(.*?)<\/mergeCells>/s',
            static function (array $match) use ($trainingMerges): string {
                $merges = $match[1];
                foreach ($trainingMerges as $range) {
                    if (!str_contains($merges, 'ref="' . $range . '"')) {
                        $merges .= '<mergeCell ref="' . $range . '"/>';
                    }
                }
                $count = preg_match_all('/<mergeCell\b/', $merges);
                return '<mergeCells count="' . $count . '">' . $merges . '</mergeCells>';
            }, $parts['xl/worksheets/sheet3.xml']);
    }
    $parts['xl/worksheets/sheet3.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet3.xml'], $trainingValues);
    if ($trainingContinuationValues !== []) {
        $trainingContinuationValues['H50'] = $completedOn;
        $parts['xl/worksheets/sheet5.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet5.xml'], $trainingContinuationValues);
    }

    $parts['xl/worksheets/sheet4.xml'] = pds_xlsx_set_cells($parts['xl/worksheets/sheet4.xml'], [
        'D61' => pds_xlsx_clean_text($employee['emp_gsis_id_no'] ?? '') !== '' ? 'GSIS' : '',
        'D62' => $employee['emp_gsis_id_no'] ?? '',
        'G64' => $completedOn,
    ]);

    pds_xlsx_set_checkbox($parts, 4, 'H45', (int)($employee['pwd'] ?? 0) === 1);
    pds_xlsx_set_checkbox($parts, 4, 'J45', (int)($employee['pwd'] ?? 0) !== 1);

    pds_xlsx_prepare_layout($parts);
    return pds_xlsx_write_package($parts);
}
