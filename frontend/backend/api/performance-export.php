<?php
declare(strict_types=1);

/*
 * Excel export of the OPCR and IPCR performance forms.
 *
 * What leaves this file is the *form*, not a table of the data behind it: the same merged header
 * bands, commitment and approval blocks, category groupings, rating columns, summary rows and
 * signature strip that OpcrFormDocument and IpcrFormDocument render in
 * src/module/performance/{Opcr,Ipcr}ManagementWorkspace.jsx. A signatory printing the workbook has
 * to end up with the sheet they would have printed from the screen, so any layout change on one
 * side has to be made on the other.
 *
 * The writer below is a form-shaped sibling of the one in payroll-export.php. It is separate
 * because that writer's styles are the payroll register's (grey rules, currency columns, frozen
 * header) while a CSC form needs a black grid, wrapped prose in tall merged cells and no freeze.
 * The hand-rolled ZIP is not a preference: this XAMPP build has no zip extension, so ZipArchive
 * does not exist and a stored-entry archive is the only way to emit a real .xlsx.
 */

/* Style slots defined in perf_xlsx_styles_xml(), in the order their <xf> entries appear. */
const PERF_XLSX_STYLE_DEFAULT = 0;
const PERF_XLSX_STYLE_TITLE = 1;
const PERF_XLSX_STYLE_TEXT = 2;
const PERF_XLSX_STYLE_CENTER = 3;
const PERF_XLSX_STYLE_BOLD = 4;
const PERF_XLSX_STYLE_BOLD_CENTER = 5;
const PERF_XLSX_STYLE_HEADER = 6;
const PERF_XLSX_STYLE_HEADER_BLUE = 7;
const PERF_XLSX_STYLE_HEADER_PINK = 8;
const PERF_XLSX_STYLE_SECTION = 9;
const PERF_XLSX_STYLE_RATING = 10;
const PERF_XLSX_STYLE_MONEY = 11;
const PERF_XLSX_STYLE_NOTE = 12;

function perf_xlsx_escape(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

function perf_xlsx_column_name(int $index): string
{
    $name = '';

    while ($index >= 0) {
        $name = chr(($index % 26) + 65) . $name;
        $index = intdiv($index, 26) - 1;
    }

    return $name;
}

/**
 * A text cell. `$across`/`$down` are the extra cells to merge into, matching colSpan/rowSpan minus
 * one, so a form cell can be written with the span the JSX gives it.
 */
function perf_xlsx_text(mixed $value, int $style = PERF_XLSX_STYLE_TEXT, int $across = 0, int $down = 0): array
{
    return ['value' => $value, 'kind' => 'text', 'style' => $style, 'across' => $across, 'down' => $down];
}

/** A numeric cell. Ratings and budgets stay numbers so a reviewer can still average a column. */
function perf_xlsx_number(mixed $value, int $style = PERF_XLSX_STYLE_RATING, int $across = 0, int $down = 0): array
{
    return ['value' => (float)$value, 'kind' => 'number', 'style' => $style, 'across' => $across, 'down' => $down];
}

function perf_xlsx_blank(int $style = PERF_XLSX_STYLE_DEFAULT, int $across = 0, int $down = 0): array
{
    return ['value' => '', 'kind' => 'blank', 'style' => $style, 'across' => $across, 'down' => $down];
}

/**
 * Pad a sparse row out to the full width of the form.
 *
 * Cells covered by a merge have to exist even though they hold nothing: Excel draws the outline of
 * a merged range from the borders of its constituent cells, so a gap in the row leaves that side of
 * the box unruled. Blank cells carry the border without carrying content Excel would flag.
 */
function perf_xlsx_row(array $cells, int $columns, int $fillStyle = PERF_XLSX_STYLE_TEXT): array
{
    $row = [];

    for ($index = 0; $index < $columns; $index++) {
        $row[$index] = $cells[$index] ?? perf_xlsx_blank($fillStyle);
    }

    return $row;
}

function perf_xlsx_styles_xml(): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $xml .= '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

    $xml .= '<numFmts count="2">'
        . '<numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/>'
        . '<numFmt numFmtId="165" formatCode="0.00"/>'
        . '</numFmts>';

    $xml .= '<fonts count="4">'
        . '<font><sz val="10"/><name val="Calibri"/></font>'
        . '<font><b/><sz val="10"/><name val="Calibri"/></font>'
        . '<font><b/><sz val="12"/><name val="Calibri"/></font>'
        . '<font><sz val="9"/><name val="Calibri"/></font>'
        . '</fonts>';

    // Fills 2-4 are the form's own header colours, read off the JSX documents.
    $xml .= '<fills count="5">'
        . '<fill><patternFill patternType="none"/></fill>'
        . '<fill><patternFill patternType="gray125"/></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFB8D4F1"/><bgColor indexed="64"/></patternFill></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFD7A6CF"/><bgColor indexed="64"/></patternFill></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>'
        . '</fills>';

    $ruled = '<left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right>'
        . '<top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom>';
    $xml .= '<borders count="2">'
        . '<border><left/><right/><top/><bottom/><diagonal/></border>'
        . '<border>' . $ruled . '<diagonal/></border>'
        . '</borders>';

    $xml .= '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>';

    $topLeft = '<alignment horizontal="left" vertical="top" wrapText="1"/>';
    $middle = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
    $leftMiddle = '<alignment horizontal="left" vertical="center" wrapText="1"/>';
    $rightMiddle = '<alignment horizontal="right" vertical="center"/>';

    // Order here defines the PERF_XLSX_STYLE_* indices above.
    $xfs = [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $middle . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' . $topLeft . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' . $middle . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $leftMiddle . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $middle . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $middle . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $middle . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $middle . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $leftMiddle . '</xf>',
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' . $middle . '</xf>',
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' . $rightMiddle . '</xf>',
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' . $topLeft . '</xf>',
    ];

    $xml .= '<cellXfs count="' . count($xfs) . '">' . implode('', $xfs) . '</cellXfs>';
    $xml .= '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>';
    $xml .= '</styleSheet>';

    return $xml;
}

/**
 * Turn a sheet definition into worksheet XML.
 *
 * `$sheet` carries `rows` (arrays of cells), `cols` (widths) and `rowHeights` (keyed by row index,
 * which the form needs for the prose blocks that would otherwise clip).
 */
function perf_xlsx_sheet_xml(array $sheet): string
{
    $rows = $sheet['rows'] ?? [];
    $widths = $sheet['cols'] ?? [];
    $rowHeights = is_array($sheet['rowHeights'] ?? null) ? $sheet['rowHeights'] : [];

    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $xml .= '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

    if ($widths !== []) {
        $xml .= '<cols>';
        foreach ($widths as $index => $width) {
            $column = $index + 1;
            $xml .= '<col min="' . $column . '" max="' . $column . '" width="' . $width . '" customWidth="1"/>';
        }
        $xml .= '</cols>';
    }

    $merges = [];
    $xml .= '<sheetData>';

    foreach ($rows as $rowIndex => $cells) {
        $rowNumber = $rowIndex + 1;
        $height = $rowHeights[$rowIndex] ?? $rowHeights[(string)$rowIndex] ?? null;

        $xml .= '<row r="' . $rowNumber . '"';
        if (is_numeric($height) && (float)$height > 0) {
            $xml .= ' ht="' . perf_xlsx_escape((string)(float)$height) . '" customHeight="1"';
        }
        $xml .= '>';

        foreach ($cells as $columnIndex => $cell) {
            if ($cell === null) {
                continue;
            }

            $reference = perf_xlsx_column_name($columnIndex) . $rowNumber;
            $style = (int)($cell['style'] ?? 0);
            $kind = $cell['kind'] ?? 'text';

            if ($kind === 'number') {
                $xml .= '<c r="' . $reference . '" s="' . $style . '"><v>'
                    . rtrim(rtrim(number_format((float)$cell['value'], 4, '.', ''), '0'), '.') . '</v></c>';
            } elseif ($kind === 'blank' || (string)($cell['value'] ?? '') === '') {
                $xml .= '<c r="' . $reference . '" s="' . $style . '"/>';
            } else {
                $xml .= '<c r="' . $reference . '" s="' . $style . '" t="inlineStr"><is><t xml:space="preserve">'
                    . perf_xlsx_escape($cell['value']) . '</t></is></c>';
            }

            $across = (int)($cell['across'] ?? 0);
            $down = (int)($cell['down'] ?? 0);

            if ($across > 0 || $down > 0) {
                $merges[] = $reference . ':' . perf_xlsx_column_name($columnIndex + $across) . ($rowNumber + $down);
            }
        }

        $xml .= '</row>';
    }

    $xml .= '</sheetData>';

    if ($merges !== []) {
        $xml .= '<mergeCells count="' . count($merges) . '">';
        foreach ($merges as $merge) {
            $xml .= '<mergeCell ref="' . $merge . '"/>';
        }
        $xml .= '</mergeCells>';
    }

    // The forms are wide, so land in Excel already set up to print the way they are signed.
    $xml .= '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>';
    $xml .= '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>';
    $xml .= '</worksheet>';

    return $xml;
}

function perf_xlsx_package_parts(array $sheet, string $sheetName, string $title): array
{
    return [
        '[Content_Types].xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            . '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
            . '</Types>',
        '_rels/.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            . '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            . '</Relationships>',
        'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            . '</Relationships>',
        'xl/workbook.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheets><sheet name="' . perf_xlsx_escape($sheetName) . '" sheetId="1" r:id="rId1"/></sheets>'
            . '</workbook>',
        'xl/styles.xml' => perf_xlsx_styles_xml(),
        'xl/worksheets/sheet1.xml' => perf_xlsx_sheet_xml($sheet),
        'docProps/core.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            . '<dc:title>' . perf_xlsx_escape($title) . '</dc:title><dc:creator>HRIS</dc:creator>'
            . '</cp:coreProperties>',
        'docProps/app.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>HRIS</Application></Properties>',
    ];
}

function perf_zip_u16(int $value): string
{
    return pack('v', $value);
}

function perf_zip_u32(int $value): string
{
    return pack('V', $value < 0 ? $value + 4294967296 : $value);
}

function perf_zip_dos_datetime(): array
{
    $date = getdate();
    $year = max(1980, min(2107, (int)$date['year']));

    return [
        ((int)$date['hours'] << 11) | ((int)$date['minutes'] << 5) | intdiv((int)$date['seconds'], 2),
        (($year - 1980) << 9) | ((int)$date['mon'] << 5) | (int)$date['mday'],
    ];
}

/** Minimal stored-entry ZIP writer, used because this XAMPP has no ZipArchive extension loaded. */
function perf_zip_store(array $parts): string
{
    [$dosTime, $dosDate] = perf_zip_dos_datetime();
    $body = '';
    $central = '';

    foreach ($parts as $name => $contents) {
        $name = (string)$name;
        $contents = (string)$contents;
        $offset = strlen($body);
        $size = strlen($contents);
        $crc = (int)sprintf('%u', crc32($contents));
        $nameLength = strlen($name);

        $body .= perf_zip_u32(0x04034b50)
            . perf_zip_u16(20)
            . perf_zip_u16(0)
            . perf_zip_u16(0)
            . perf_zip_u16($dosTime)
            . perf_zip_u16($dosDate)
            . perf_zip_u32($crc)
            . perf_zip_u32($size)
            . perf_zip_u32($size)
            . perf_zip_u16($nameLength)
            . perf_zip_u16(0)
            . $name
            . $contents;

        $central .= perf_zip_u32(0x02014b50)
            . perf_zip_u16(20)
            . perf_zip_u16(20)
            . perf_zip_u16(0)
            . perf_zip_u16(0)
            . perf_zip_u16($dosTime)
            . perf_zip_u16($dosDate)
            . perf_zip_u32($crc)
            . perf_zip_u32($size)
            . perf_zip_u32($size)
            . perf_zip_u16($nameLength)
            . perf_zip_u16(0)
            . perf_zip_u16(0)
            . perf_zip_u16(0)
            . perf_zip_u16(0)
            . perf_zip_u32(0)
            . perf_zip_u32($offset)
            . $name;
    }

    $entryCount = count($parts);

    return $body
        . $central
        . perf_zip_u32(0x06054b50)
        . perf_zip_u16(0)
        . perf_zip_u16(0)
        . perf_zip_u16($entryCount)
        . perf_zip_u16($entryCount)
        . perf_zip_u32(strlen($central))
        . perf_zip_u32(strlen($body))
        . perf_zip_u16(0);
}

/** Package one sheet as a .xlsx and return the bytes. */
function perf_xlsx_package(array $sheet, string $sheetName, string $title): string
{
    return perf_zip_store(perf_xlsx_package_parts($sheet, $sheetName, $title));
}

/* ----------------------------------------------------------------------------------------------
 * Form values.
 *
 * These mirror the helpers of the same intent in the two workspace files -- text(), currency(),
 * averageRating() and finalAverageRating() -- so a cell reads the same in the workbook as on screen.
 * -------------------------------------------------------------------------------------------- */

function perf_text(mixed $value, string $fallback = 'N/A'): string
{
    $normalized = trim((string)($value ?? ''));

    return $normalized !== '' ? $normalized : $fallback;
}

/**
 * A KPI's success indicators, one per line in the stored column (see
 * frontend/src/module/performance/successIndicators.js). Several are numbered the way the screen
 * lists them; a lone one is left as plain text. The cells wrap, so the newlines survive in Excel.
 */
function perf_success_indicators_text(mixed $value, string $fallback = 'N/A'): string
{
    $lines = array_values(array_filter(
        array_map('trim', preg_split('/\r?\n/', (string)($value ?? ''))),
        static fn (string $line): bool => $line !== ''
    ));

    if ($lines === []) {
        return $fallback;
    }

    if (count($lines) === 1) {
        return $lines[0];
    }

    return implode("\n", array_map(
        static fn (string $line, int $index): string => ($index + 1) . '. ' . $line,
        $lines,
        array_keys($lines)
    ));
}

function perf_number(mixed $value): float
{
    return is_numeric($value) ? (float)$value : 0.0;
}

/**
 * Round the way the screen does.
 *
 * The workspaces publish every average through JavaScript's toFixed(2), which rounds the binary
 * value as it actually is; PHP's round() first nudges values that only look like an exact half, so
 * an average of 4.335 reads 4.33 on screen and would read 4.34 in the workbook. sprintf agrees with
 * toFixed, so the two never disagree by a hundredth.
 */
function perf_round(float $value): float
{
    return (float)sprintf('%.2f', $value);
}

/** Mirrors averageRating(): the saved average when there is one, else the mean of the three scores. */
function perf_average_rating(array $record): ?float
{
    $saved = perf_number($record['a4Rating'] ?? $record['finalRating'] ?? null);
    if ($saved > 0) {
        return perf_round($saved);
    }

    $scores = array_values(array_filter([
        perf_number($record['q1Rating'] ?? null),
        perf_number($record['e2Rating'] ?? null),
        perf_number($record['t3Rating'] ?? null),
    ], static fn (float $score): bool => $score > 0));

    if ($scores === []) {
        return null;
    }

    return perf_round(array_sum($scores) / count($scores));
}

/** Mirrors finalAverageRating(): the mean of the rows that carry a rating at all. */
function perf_final_average_rating(array $records): ?float
{
    $scores = [];

    foreach ($records as $record) {
        $average = perf_average_rating($record);
        if ($average !== null && $average > 0) {
            $scores[] = $average;
        }
    }

    if ($scores === []) {
        return null;
    }

    return perf_round(array_sum($scores) / count($scores));
}

function perf_category_label(array $record): string
{
    return strtoupper(perf_text($record['category'] ?? $record['kpiCategory'] ?? null, 'Program'));
}

/**
 * The semester column of an OPCR row. A row with no semester target prints the form's own wording
 * for that, "NO TARGET FOR 2ND SEMESTER", rather than an empty cell.
 */
function perf_opcr_semester_target(array $record): string
{
    $target = perf_success_indicators_text($record['semesterIndicator'] ?? null, '');

    return $target !== ''
        ? $target
        : 'NO TARGET FOR ' . strtoupper(perf_text($record['semester'] ?? null, 'THE SEMESTER'));
}

/** Two adjacent form rows print under one output cell when they share the band and the output. */
function perf_same_output_cell(array $left, array $right): bool
{
    $output = static fn (array $record): string => mb_strtolower(perf_text($record['output'] ?? $record['kpiTitle'] ?? null));

    return perf_category_label($left) === perf_category_label($right) && $output($left) === $output($right);
}

/** A rating cell: numeric when rated, an empty ruled cell when not, exactly as the form prints. */
function perf_rating_cell(mixed $value): array
{
    $rating = perf_number($value);

    return $rating > 0 ? perf_xlsx_number($rating) : perf_xlsx_blank(PERF_XLSX_STYLE_RATING);
}

/**
 * The first value any row of the form carries for `$key`.
 *
 * Header fields such as the approving officer are only written once a row has been rated, so
 * reading them off row one alone would leave the heading of a half-rated form blank.
 */
function perf_first_value(array $records, string $key, string $fallback = ''): string
{
    foreach ($records as $record) {
        $value = trim((string)($record[$key] ?? ''));
        if ($value !== '') {
            return $value;
        }
    }

    return $fallback;
}

function perf_export_filename(string $prefix, string $detail): string
{
    $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $detail) ?? '', '-'));

    return $slug === '' ? $prefix . '.xlsx' : $prefix . '-' . $slug . '.xlsx';
}

/* ----------------------------------------------------------------------------------------------
 * The OPCR form. Mirrors OpcrFormDocument in OpcrManagementWorkspace.jsx.
 * -------------------------------------------------------------------------------------------- */

const PERF_OPCR_COLUMNS = 11;

function perf_opcr_form_sheet(array $records): array
{
    $columns = PERF_OPCR_COLUMNS;
    $fiscalYear = perf_first_value($records, 'period', 'FY ' . date('Y'));
    $semester = perf_first_value($records, 'semester', 'Semester');
    $period = trim(implode(' - ', array_filter([$fiscalYear, $semester]))) ?: 'Rating Period';
    // The division's chief commits and assesses, the HR Head signs beside, and the Regional Director
    // gives the final rating; all come with the records (opcr_attach_signatories()). Nobody in the
    // role prints a blank line.
    $blankName = '______________________________';
    $division = mb_strtoupper(perf_first_value($records, 'division', 'DIVISION'));
    $chiefName = mb_strtoupper(perf_first_value($records, 'divisionChiefName', $blankName));
    $chiefPosition = perf_first_value($records, 'divisionChiefPosition', 'Division Chief');
    $hrHeadName = mb_strtoupper(perf_first_value($records, 'hrHeadName', $blankName));
    $hrHeadPosition = perf_first_value($records, 'hrHeadPosition', 'HR Head');
    $directorName = mb_strtoupper(perf_first_value($records, 'regionalDirectorName', $blankName));
    $directorPosition = perf_first_value($records, 'regionalDirectorPosition', 'Regional Director');
    $finalAverage = perf_final_average_rating($records);

    $rows = [];
    $rowHeights = [];

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('OFFICE PERFORMANCE COMMITMENT AND REVIEW - MGB REGIONAL OFFICE', PERF_XLSX_STYLE_TITLE, $columns - 1),
    ], $columns, PERF_XLSX_STYLE_TITLE);
    $rowHeights[count($rows) - 1] = 26;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text(
            'I, ' . $chiefName . ', Head of the ' . $division . ', MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE No. X,'
            . ' commit to deliver and agree to be rated on the attainment of the following targets in accordance with the'
            . ' indicated measures for the period ' . $period . '.',
            PERF_XLSX_STYLE_TEXT,
            6
        ),
        7 => perf_xlsx_text($chiefName . "\n" . $chiefPosition . "\n\nDate: __________", PERF_XLSX_STYLE_CENTER, 3),
    ], $columns);
    $rowHeights[count($rows) - 1] = 78;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_blank(PERF_XLSX_STYLE_TEXT, 6),
        7 => perf_xlsx_text(
            "RATING SCALE\n5 - Outstanding    4 - Very Satisfactory    3 - Satisfactory    2 - Unsatisfactory    1 - Poor",
            PERF_XLSX_STYLE_CENTER,
            3
        ),
    ], $columns);
    $rowHeights[count($rows) - 1] = 40;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('OO/PAP', PERF_XLSX_STYLE_HEADER, 0, 1),
        1 => perf_xlsx_text('Success Indicators', PERF_XLSX_STYLE_HEADER, 1),
        3 => perf_xlsx_text("Allotted Budget\n(MOOE Php '000)", PERF_XLSX_STYLE_HEADER, 0, 1),
        4 => perf_xlsx_text('Divisions/Individuals Accountable', PERF_XLSX_STYLE_HEADER, 0, 1),
        5 => perf_xlsx_text('Actual Accomp.', PERF_XLSX_STYLE_HEADER, 0, 1),
        6 => perf_xlsx_text('Rating', PERF_XLSX_STYLE_HEADER, 3),
        10 => perf_xlsx_text('Remarks', PERF_XLSX_STYLE_HEADER, 0, 1),
    ], $columns, PERF_XLSX_STYLE_HEADER);
    $rowHeights[count($rows) - 1] = 34;

    $rows[] = perf_xlsx_row([
        1 => perf_xlsx_text($fiscalYear, PERF_XLSX_STYLE_HEADER),
        2 => perf_xlsx_text($semester, PERF_XLSX_STYLE_HEADER),
        6 => perf_xlsx_text('Q1', PERF_XLSX_STYLE_HEADER),
        7 => perf_xlsx_text('Q2', PERF_XLSX_STYLE_HEADER),
        8 => perf_xlsx_text('Q3', PERF_XLSX_STYLE_HEADER),
        9 => perf_xlsx_text('Q4', PERF_XLSX_STYLE_HEADER),
    ], $columns, PERF_XLSX_STYLE_HEADER);

    $previousCategory = null;

    $records = array_values($records);
    $count = count($records);

    for ($index = 0; $index < $count; $index++) {
        $record = $records[$index];
        $category = perf_category_label($record);

        if ($category !== $previousCategory) {
            $rows[] = perf_xlsx_row([
                0 => perf_xlsx_text($category, PERF_XLSX_STYLE_SECTION, $columns - 1),
            ], $columns, PERF_XLSX_STYLE_SECTION);
            $previousCategory = $category;
        }

        // Adjacent rows of one OO/PAP share its cell and its budget, merged down over the run the
        // way the form prints "Mineral Reservation Program" once beside its three indicators. The
        // budget is allotted to the OO/PAP, so the run's rows are added into that one cell.
        $continuesOutput = $index > 0 && perf_same_output_cell($records[$index - 1], $record);
        $outputRun = 0;
        $runBudget = perf_number($record['budget'] ?? null);
        while (!$continuesOutput && $index + $outputRun + 1 < $count && perf_same_output_cell($record, $records[$index + $outputRun + 1])) {
            $outputRun++;
            $runBudget += perf_number($records[$index + $outputRun]['budget'] ?? null);
        }

        $average = perf_average_rating($record);

        $rows[] = perf_xlsx_row([
            0 => $continuesOutput
                ? perf_xlsx_blank(PERF_XLSX_STYLE_BOLD)
                : perf_xlsx_text(perf_text($record['output'] ?? $record['kpiTitle'] ?? null), PERF_XLSX_STYLE_BOLD, 0, $outputRun),
            1 => perf_xlsx_text(perf_success_indicators_text($record['successIndicator'] ?? null)),
            2 => perf_xlsx_text(perf_opcr_semester_target($record)),
            3 => $continuesOutput
                ? perf_xlsx_blank(PERF_XLSX_STYLE_MONEY)
                : ($runBudget > 0 ? perf_xlsx_number($runBudget, PERF_XLSX_STYLE_MONEY, 0, $outputRun) : perf_xlsx_blank(PERF_XLSX_STYLE_MONEY, 0, $outputRun)),
            // Every division sharing the KPI, as opcr.php prints it; older rows carry only their own name.
            4 => perf_xlsx_text(perf_text($record['accountableLabel'] ?? $record['accountableName'] ?? null), PERF_XLSX_STYLE_CENTER),
            5 => perf_xlsx_text(perf_text($record['actualAccomplishment'] ?? null, '')),
            6 => perf_rating_cell($record['q1Rating'] ?? null),
            7 => perf_rating_cell($record['e2Rating'] ?? null),
            8 => perf_rating_cell($record['t3Rating'] ?? null),
            9 => $average !== null ? perf_xlsx_number($average) : perf_xlsx_blank(PERF_XLSX_STYLE_RATING),
            10 => perf_xlsx_text(perf_text($record['remarks'] ?? null, '')),
        ], $columns);
        $rowHeights[count($rows) - 1] = 42;
    }

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Average Rating', PERF_XLSX_STYLE_BOLD, 8),
        9 => $finalAverage !== null ? perf_xlsx_number($finalAverage) : perf_xlsx_blank(PERF_XLSX_STYLE_RATING),
    ], $columns);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Category', PERF_XLSX_STYLE_BOLD, 2),
        3 => perf_xlsx_text('Output', PERF_XLSX_STYLE_CENTER, 1),
        9 => perf_xlsx_text('Rating', PERF_XLSX_STYLE_CENTER),
    ], $columns);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Total Overall Rating', PERF_XLSX_STYLE_BOLD, 2),
    ], $columns);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Final Average Rating', PERF_XLSX_STYLE_BOLD, 2),
        9 => $finalAverage !== null ? perf_xlsx_number($finalAverage) : perf_xlsx_blank(PERF_XLSX_STYLE_RATING),
    ], $columns);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Adjectival Rating', PERF_XLSX_STYLE_BOLD, 2),
    ], $columns);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text("Assessed by:\n\n" . $chiefName . "\n" . $chiefPosition, PERF_XLSX_STYLE_CENTER, 2),
        3 => perf_xlsx_text('Date', PERF_XLSX_STYLE_CENTER),
        4 => perf_xlsx_text("\n\n" . $hrHeadName . "\n" . $hrHeadPosition, PERF_XLSX_STYLE_CENTER, 2),
        7 => perf_xlsx_text('Date', PERF_XLSX_STYLE_CENTER),
        8 => perf_xlsx_text("Final Rating:\n\n" . $directorName . "\n" . $directorPosition, PERF_XLSX_STYLE_CENTER, 1),
        10 => perf_xlsx_text('Date', PERF_XLSX_STYLE_CENTER),
    ], $columns);
    $rowHeights[count($rows) - 1] = 92;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text(
            'Legend: 1 - Quantity    2 - Quality    3 - Timeliness    4 - Average',
            PERF_XLSX_STYLE_NOTE,
            $columns - 1
        ),
    ], $columns, PERF_XLSX_STYLE_NOTE);

    return [
        'rows' => $rows,
        'cols' => [26, 26, 26, 16, 24, 28, 6, 6, 6, 8, 22],
        'rowHeights' => $rowHeights,
    ];
}

/* ----------------------------------------------------------------------------------------------
 * The IPCR form. Mirrors IpcrFormDocument in IpcrManagementWorkspace.jsx.
 * -------------------------------------------------------------------------------------------- */

const PERF_IPCR_COLUMNS = 9;

function perf_long_date(mixed $value): string
{
    $text = trim((string)($value ?? ''));
    if ($text === '') {
        return 'DATE';
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', substr($text, 0, 10));

    return $date ? $date->format('F j, Y') : $text;
}

/** Mirrors commitmentPeriodLabel(): "JANUARY TO JUNE 2026", or both years when they differ. */
function perf_commitment_period_label(array $record): string
{
    $from = DateTimeImmutable::createFromFormat('Y-m-d', substr((string)($record['periodFrom'] ?? ''), 0, 10));
    $to = DateTimeImmutable::createFromFormat('Y-m-d', substr((string)($record['periodTo'] ?? ''), 0, 10));

    if (!$from || !$to) {
        return 'RATING PERIOD';
    }

    $years = $from->format('Y') === $to->format('Y')
        ? ' ' . $to->format('Y')
        : ' ' . $from->format('Y') . ' TO ' . $to->format('Y');

    return strtoupper($from->format('F')) . ' TO ' . strtoupper($to->format('F')) . $years;
}

function perf_ipcr_form_sheet(array $records): array
{
    $anchor = $records[0] ?? [];
    $columns = PERF_IPCR_COLUMNS;
    $employee = strtoupper(perf_text($anchor['employeeName'] ?? null, 'EMPLOYEE NAME'));
    $division = strtoupper(perf_text($anchor['division'] ?? null, 'DIVISION'));
    $position = perf_text($anchor['position'] ?? null, 'Position');
    $commitmentDate = perf_long_date($anchor['periodFrom'] ?? null);
    $reviewedBy = 'JOY CHRISTINE V. ASIS';
    $reviewerPosition = trim((string)($anchor['division'] ?? '')) !== ''
        ? 'OIC, ' . perf_text($anchor['division'] ?? null)
        : 'OIC, Geosciences Division';
    $finalAverage = perf_final_average_rating($records);

    $rows = [];
    $rowHeights = [];

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('INDIVIDUAL PERFORMANCE COMMITMENT AND REVIEW (IPCR)', PERF_XLSX_STYLE_TITLE, $columns - 1),
    ], $columns, PERF_XLSX_STYLE_TITLE);
    $rowHeights[count($rows) - 1] = 26;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text(
            'I, ' . $employee . ', of the ' . $division . ' of the MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE NO. X,'
            . ' commit to deliver and agree to be rated on the attainment of the following targets in accordance with the'
            . ' indicated measures for the period ' . perf_commitment_period_label($anchor) . '.',
            PERF_XLSX_STYLE_TEXT,
            6
        ),
        7 => perf_xlsx_text($employee . "\nRatee\n\nDate: " . $commitmentDate, PERF_XLSX_STYLE_CENTER, 1),
    ], $columns);
    $rowHeights[count($rows) - 1] = 78;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Reviewed by:', PERF_XLSX_STYLE_HEADER_PINK, 1),
        2 => perf_xlsx_text('Date', PERF_XLSX_STYLE_HEADER_PINK, 1),
        4 => perf_xlsx_text('Approved by:', PERF_XLSX_STYLE_HEADER_PINK, 1),
        6 => perf_xlsx_text('Date', PERF_XLSX_STYLE_HEADER_PINK, 2),
    ], $columns, PERF_XLSX_STYLE_HEADER_PINK);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text($reviewedBy . "\n" . $reviewerPosition, PERF_XLSX_STYLE_CENTER, 1),
        2 => perf_xlsx_text($commitmentDate, PERF_XLSX_STYLE_CENTER, 1),
        4 => perf_xlsx_text($reviewedBy . "\n" . $reviewerPosition, PERF_XLSX_STYLE_CENTER, 1),
        6 => perf_xlsx_text($commitmentDate, PERF_XLSX_STYLE_CENTER, 2),
    ], $columns);
    $rowHeights[count($rows) - 1] = 44;

    $rows[] = [];

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('OUTPUT', PERF_XLSX_STYLE_HEADER_BLUE, 0, 1),
        1 => perf_xlsx_text("SUCCESS INDICATOR\n(Target + Measure)", PERF_XLSX_STYLE_HEADER_BLUE, 1, 1),
        3 => perf_xlsx_text('Actual Accomplishments', PERF_XLSX_STYLE_HEADER_BLUE, 0, 1),
        4 => perf_xlsx_text('Rating', PERF_XLSX_STYLE_HEADER_BLUE, 3),
        8 => perf_xlsx_text('Remarks', PERF_XLSX_STYLE_HEADER_BLUE, 0, 1),
    ], $columns, PERF_XLSX_STYLE_HEADER_BLUE);
    $rowHeights[count($rows) - 1] = 32;

    $rows[] = perf_xlsx_row([
        4 => perf_xlsx_text('Q1', PERF_XLSX_STYLE_HEADER_BLUE),
        5 => perf_xlsx_text('E2', PERF_XLSX_STYLE_HEADER_BLUE),
        6 => perf_xlsx_text('T3', PERF_XLSX_STYLE_HEADER_BLUE),
        7 => perf_xlsx_text('A4', PERF_XLSX_STYLE_HEADER_BLUE),
    ], $columns, PERF_XLSX_STYLE_HEADER_BLUE);

    $previousProgram = null;
    $previousCategory = null;
    $records = array_values($records);
    $count = count($records);

    for ($index = 0; $index < $count; $index++) {
        $record = $records[$index];
        $category = perf_category_label($record);

        /*
         * The organizational outcome and program band, printed once above the categories filed
         * under it. Optional: a KPI without one prints its category band alone, as every record
         * assigned before the column existed does.
         */
        $program = perf_text($record['program'] ?? null, '');
        if ($program !== '' && $program !== $previousProgram) {
            $rows[] = perf_xlsx_row([
                0 => perf_xlsx_text($program, PERF_XLSX_STYLE_SECTION, $columns - 1),
            ], $columns, PERF_XLSX_STYLE_SECTION);
            $previousCategory = null;
        }
        $previousProgram = $program;

        if ($category !== $previousCategory) {
            $rows[] = perf_xlsx_row([
                0 => perf_xlsx_text($category, PERF_XLSX_STYLE_BOLD, $columns - 1),
            ], $columns, PERF_XLSX_STYLE_BOLD);
            $previousCategory = $category;
        }

        // Adjacent rows with the same output share one output cell, as the preview and the printed
        // form do: the cell on the first row is merged down over the rest, which stay blank.
        $continuesOutput = $index > 0 && perf_same_output_cell($records[$index - 1], $record);
        $outputRun = 0;
        while (!$continuesOutput && $index + $outputRun + 1 < $count && perf_same_output_cell($record, $records[$index + $outputRun + 1])) {
            $outputRun++;
        }

        $average = perf_average_rating($record);

        $rows[] = perf_xlsx_row([
            0 => $continuesOutput
                ? perf_xlsx_blank(PERF_XLSX_STYLE_TEXT)
                : perf_xlsx_text(perf_text($record['output'] ?? $record['kpiTitle'] ?? null), PERF_XLSX_STYLE_TEXT, 0, $outputRun),
            1 => perf_xlsx_text(perf_success_indicators_text($record['successIndicator'] ?? null)),
            2 => perf_xlsx_text(perf_success_indicators_text($record['secondIndicator'] ?? null, '')),
            3 => perf_xlsx_text(perf_text($record['actualAccomplishment'] ?? null, 'No accomplishment submitted yet.')),
            4 => perf_rating_cell($record['q1Rating'] ?? null),
            5 => perf_rating_cell($record['e2Rating'] ?? null),
            6 => perf_rating_cell($record['t3Rating'] ?? null),
            7 => $average !== null ? perf_xlsx_number($average) : perf_xlsx_blank(PERF_XLSX_STYLE_RATING),
            8 => perf_xlsx_text(perf_text($record['remarks'] ?? null, '')),
        ], $columns);
        $rowHeights[count($rows) - 1] = 44;
    }

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Final Average Rating', PERF_XLSX_STYLE_BOLD),
        7 => $finalAverage !== null ? perf_xlsx_number($finalAverage) : perf_xlsx_blank(PERF_XLSX_STYLE_RATING),
    ], $columns);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Comments and Recommendations for Development Purposes', PERF_XLSX_STYLE_SECTION, $columns - 1),
    ], $columns, PERF_XLSX_STYLE_SECTION);

    $rows[] = perf_xlsx_row([], $columns);
    $rowHeights[count($rows) - 1] = 64;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text('Discussed with:', PERF_XLSX_STYLE_BOLD_CENTER, 1),
        2 => perf_xlsx_text('Date', PERF_XLSX_STYLE_BOLD_CENTER),
        3 => perf_xlsx_text('Assessed by:', PERF_XLSX_STYLE_BOLD_CENTER, 1),
        5 => perf_xlsx_text('Date', PERF_XLSX_STYLE_BOLD_CENTER),
        6 => perf_xlsx_text('Final Rating by:', PERF_XLSX_STYLE_BOLD_CENTER, 1),
        8 => perf_xlsx_text('Date', PERF_XLSX_STYLE_BOLD_CENTER),
    ], $columns);

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text("\n" . $employee . "\n" . $position, PERF_XLSX_STYLE_CENTER, 1),
        3 => perf_xlsx_text(
            "I certify that I discussed my assessment of the performance with the employee.\n\n"
            . $reviewedBy . "\n" . $reviewerPosition,
            PERF_XLSX_STYLE_CENTER,
            1
        ),
        6 => perf_xlsx_text("\n" . $reviewedBy . "\n" . $reviewerPosition, PERF_XLSX_STYLE_CENTER, 1),
    ], $columns);
    $rowHeights[count($rows) - 1] = 96;

    $rows[] = perf_xlsx_row([
        0 => perf_xlsx_text(
            'Legend: 1 - Quantity, 2 - Efficiency, 3 - Timeliness, 4 - Average',
            PERF_XLSX_STYLE_NOTE,
            $columns - 1
        ),
    ], $columns, PERF_XLSX_STYLE_NOTE);

    return [
        'rows' => $rows,
        'cols' => [28, 30, 30, 34, 6, 6, 6, 6, 26],
        'rowHeights' => $rowHeights,
    ];
}

/** Send one workbook as a download and end the request. */
function perf_export_stream(array $sheet, string $sheetName, string $title, string $filename): void
{
    $workbook = perf_xlsx_package($sheet, $sheetName, $title);

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    header_remove('Content-Type');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($workbook));
    echo $workbook;
    exit;
}
