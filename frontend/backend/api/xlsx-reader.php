<?php
declare(strict_types=1);

const EMPLOYEE_XLSX_MAX_ARCHIVE_BYTES = 10_000_000;
const EMPLOYEE_XLSX_MAX_ENTRY_BYTES = 20_000_000;
const EMPLOYEE_XLSX_MAX_TOTAL_XML_BYTES = 30_000_000;
const EMPLOYEE_XLSX_MAX_ROWS = 5_000;
const EMPLOYEE_XLSX_MAX_COLUMNS = 100;

/**
 * Read the XML entries needed from a normal XLSX ZIP package.
 *
 * XAMPP does not have ZipArchive enabled in every environment used by this project, so this small
 * reader handles the two ZIP methods Excel uses for workbook XML: stored and raw DEFLATE. It does
 * not write files, install packages, or create database objects.
 *
 * @return array<string, string>
 */
function employee_xlsx_xml_entries(string $path): array
{
    $size = @filesize($path);
    if ($size === false || $size <= 0 || $size > EMPLOYEE_XLSX_MAX_ARCHIVE_BYTES) {
        throw new RuntimeException('The Excel workbook is empty or exceeds the 10 MB import limit.');
    }

    $archive = @file_get_contents($path);
    if ($archive === false) {
        throw new RuntimeException('Unable to read the Excel workbook.');
    }

    $endOffset = strrpos($archive, "PK\x05\x06");
    if ($endOffset === false || strlen($archive) < $endOffset + 22) {
        throw new RuntimeException('The Excel workbook is not a valid XLSX package.');
    }

    $end = unpack(
        'vdisk/vdirectoryDisk/ventriesOnDisk/ventriesTotal/VdirectorySize/VdirectoryOffset/vcommentLength',
        substr($archive, $endOffset + 4, 18)
    );
    if (!is_array($end)) {
        throw new RuntimeException('Unable to read the Excel workbook directory.');
    }

    $entryCount = (int)($end['entriesTotal'] ?? 0);
    $directoryOffset = (int)($end['directoryOffset'] ?? -1);
    if ($entryCount <= 0 || $entryCount > 1_000 || $directoryOffset < 0) {
        throw new RuntimeException('The Excel workbook directory is invalid.');
    }

    $entries = [];
    $totalXmlBytes = 0;
    $offset = $directoryOffset;

    for ($index = 0; $index < $entryCount; $index++) {
        if (substr($archive, $offset, 4) !== "PK\x01\x02") {
            throw new RuntimeException('The Excel workbook directory is damaged.');
        }

        $central = unpack(
            'vversionMade/vversionNeeded/vflags/vmethod/vtime/vdate/Vcrc/VcompressedSize/'
            . 'VuncompressedSize/vnameLength/vextraLength/vcommentLength/vdiskStart/'
            . 'vinternalAttributes/VexternalAttributes/VlocalOffset',
            substr($archive, $offset + 4, 42)
        );
        if (!is_array($central)) {
            throw new RuntimeException('Unable to read an Excel workbook entry.');
        }

        $nameLength = (int)$central['nameLength'];
        $extraLength = (int)$central['extraLength'];
        $commentLength = (int)$central['commentLength'];
        $name = str_replace('\\', '/', substr($archive, $offset + 46, $nameLength));
        $offset += 46 + $nameLength + $extraLength + $commentLength;

        $isWorkbookXml = in_array($name, [
            'xl/workbook.xml',
            'xl/_rels/workbook.xml.rels',
            'xl/sharedStrings.xml',
        ], true);
        $isWorksheetXml = str_starts_with($name, 'xl/worksheets/') && str_ends_with($name, '.xml');
        if (!$isWorkbookXml && !$isWorksheetXml) {
            continue;
        }

        if (str_contains($name, '../') || ((int)$central['flags'] & 0x0001) !== 0) {
            throw new RuntimeException('The Excel workbook contains an unsupported entry.');
        }

        $compressedSize = (int)$central['compressedSize'];
        $uncompressedSize = (int)$central['uncompressedSize'];
        if (
            $compressedSize < 0
            || $uncompressedSize < 0
            || $uncompressedSize > EMPLOYEE_XLSX_MAX_ENTRY_BYTES
            || $totalXmlBytes + $uncompressedSize > EMPLOYEE_XLSX_MAX_TOTAL_XML_BYTES
        ) {
            throw new RuntimeException('The Excel workbook contains an oversized worksheet.');
        }

        $localOffset = (int)$central['localOffset'];
        if ($localOffset < 0 || substr($archive, $localOffset, 4) !== "PK\x03\x04") {
            throw new RuntimeException('The Excel workbook contains a damaged worksheet entry.');
        }

        $local = unpack(
            'vversion/vflags/vmethod/vtime/vdate/Vcrc/VcompressedSize/VuncompressedSize/'
            . 'vnameLength/vextraLength',
            substr($archive, $localOffset + 4, 26)
        );
        if (!is_array($local)) {
            throw new RuntimeException('Unable to read an Excel worksheet entry.');
        }

        $dataOffset = $localOffset + 30 + (int)$local['nameLength'] + (int)$local['extraLength'];
        $compressed = substr($archive, $dataOffset, $compressedSize);
        $method = (int)$central['method'];

        if ($method === 0) {
            $xml = $compressed;
        } elseif ($method === 8) {
            $xml = @gzinflate($compressed, EMPLOYEE_XLSX_MAX_ENTRY_BYTES);
            if ($xml === false) {
                throw new RuntimeException('Unable to decompress an Excel worksheet.');
            }
        } else {
            throw new RuntimeException('The Excel workbook uses an unsupported compression method.');
        }

        if (strlen($xml) !== $uncompressedSize) {
            throw new RuntimeException('An Excel worksheet did not decompress to the expected size.');
        }

        $entries[$name] = $xml;
        $totalXmlBytes += strlen($xml);
    }

    return $entries;
}

function employee_xlsx_document(string $xml, string $label): DOMDocument
{
    $document = new DOMDocument();
    $previous = libxml_use_internal_errors(true);

    try {
        $loaded = $document->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT);
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
    }

    if (!$loaded) {
        throw new RuntimeException("The Excel {$label} XML is invalid.");
    }

    return $document;
}

function employee_xlsx_normalize_target(string $baseDirectory, string $target): string
{
    $path = str_starts_with($target, '/')
        ? ltrim($target, '/')
        : trim($baseDirectory, '/') . '/' . $target;
    $parts = [];

    foreach (explode('/', str_replace('\\', '/', $path)) as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            array_pop($parts);
            continue;
        }
        $parts[] = $part;
    }

    return implode('/', $parts);
}

/** @param array<string, string> $entries */
function employee_xlsx_first_worksheet_path(array $entries): string
{
    $workbookXml = $entries['xl/workbook.xml'] ?? '';
    $relationshipsXml = $entries['xl/_rels/workbook.xml.rels'] ?? '';

    if ($workbookXml !== '' && $relationshipsXml !== '') {
        $workbook = employee_xlsx_document($workbookXml, 'workbook');
        $workbookXPath = new DOMXPath($workbook);
        $sheet = $workbookXPath->query('//*[local-name()="sheets"]/*[local-name()="sheet"]')->item(0);

        if ($sheet instanceof DOMElement) {
            $relationshipId = $sheet->getAttributeNS(
                'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                'id'
            );
            if ($relationshipId === '') {
                $relationshipId = $sheet->getAttribute('r:id');
            }

            $relationships = employee_xlsx_document($relationshipsXml, 'relationships');
            foreach ($relationships->getElementsByTagName('Relationship') as $relationship) {
                if (
                    $relationship instanceof DOMElement
                    && $relationship->getAttribute('Id') === $relationshipId
                ) {
                    $target = employee_xlsx_normalize_target('xl', $relationship->getAttribute('Target'));
                    if (isset($entries[$target])) {
                        return $target;
                    }
                }
            }
        }
    }

    $worksheetPaths = array_values(array_filter(
        array_keys($entries),
        static fn (string $name): bool => str_starts_with($name, 'xl/worksheets/')
            && str_ends_with($name, '.xml')
    ));
    sort($worksheetPaths, SORT_NATURAL);

    if ($worksheetPaths === []) {
        throw new RuntimeException('The Excel workbook does not contain a worksheet.');
    }

    return $worksheetPaths[0];
}

/** @param array<string, string> $entries @return array<int, string> */
function employee_xlsx_shared_strings(array $entries): array
{
    $xml = $entries['xl/sharedStrings.xml'] ?? '';
    if ($xml === '') {
        return [];
    }

    $document = employee_xlsx_document($xml, 'shared strings');
    $xpath = new DOMXPath($document);
    $strings = [];

    foreach ($xpath->query('//*[local-name()="si"]') as $item) {
        $value = '';
        foreach ($xpath->query('.//*[local-name()="t"]', $item) as $textNode) {
            $value .= $textNode->textContent;
        }
        $strings[] = $value;
    }

    return $strings;
}

function employee_xlsx_column_index(string $reference): int
{
    if (preg_match('/^([A-Z]+)/i', $reference, $matches) !== 1) {
        return -1;
    }

    $index = 0;
    foreach (str_split(strtoupper($matches[1])) as $letter) {
        $index = ($index * 26) + (ord($letter) - 64);
    }

    return $index - 1;
}

/** @param array<int, string> $sharedStrings */
function employee_xlsx_cell_value(DOMXPath $xpath, DOMElement $cell, array $sharedStrings): string
{
    $type = $cell->getAttribute('t');

    if ($type === 'inlineStr') {
        $value = '';
        foreach ($xpath->query('./*[local-name()="is"]//*[local-name()="t"]', $cell) as $textNode) {
            $value .= $textNode->textContent;
        }
        return $value;
    }

    $valueNode = $xpath->query('./*[local-name()="v"]', $cell)->item(0);
    $value = $valueNode?->textContent ?? '';

    if ($type === 's') {
        return $sharedStrings[(int)$value] ?? '';
    }

    if ($type === 'b') {
        return $value === '1' ? '1' : '0';
    }

    return $value;
}

/** @return array<int, array<int, string>> */
function employee_xlsx_read_rows(string $path): array
{
    $entries = employee_xlsx_xml_entries($path);
    $worksheetPath = employee_xlsx_first_worksheet_path($entries);
    $worksheet = employee_xlsx_document($entries[$worksheetPath], 'worksheet');
    $xpath = new DOMXPath($worksheet);
    $sharedStrings = employee_xlsx_shared_strings($entries);
    $rows = [];

    foreach ($xpath->query('//*[local-name()="sheetData"]/*[local-name()="row"]') as $rowNode) {
        if (count($rows) >= EMPLOYEE_XLSX_MAX_ROWS) {
            throw new RuntimeException('The Excel worksheet exceeds the 5,000-row import limit.');
        }

        $row = [];
        $nextColumn = 0;

        foreach ($xpath->query('./*[local-name()="c"]', $rowNode) as $cell) {
            if (!$cell instanceof DOMElement) {
                continue;
            }

            $column = employee_xlsx_column_index($cell->getAttribute('r'));
            if ($column < 0) {
                $column = $nextColumn;
            }
            if ($column >= EMPLOYEE_XLSX_MAX_COLUMNS) {
                throw new RuntimeException('The Excel worksheet exceeds the 100-column import limit.');
            }

            while (count($row) < $column) {
                $row[] = '';
            }
            $row[$column] = employee_xlsx_cell_value($xpath, $cell, $sharedStrings);
            $nextColumn = $column + 1;
        }

        if (count(array_filter($row, static fn (string $value): bool => trim($value) !== '')) > 0) {
            $rows[] = $row;
        }
    }

    if ($rows === []) {
        throw new RuntimeException('The Excel worksheet is empty.');
    }

    return $rows;
}
