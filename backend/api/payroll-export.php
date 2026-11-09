<?php
declare(strict_types=1);

/*
 * Excel export of the payroll register.
 *
 * The workbook has to be the register the HR screens already show -- same two tables, same grouped
 * headers, same order, same totals -- so the file that reaches a signatory and the screen it was
 * approved on cannot disagree. Every layout decision here is therefore a deliberate mirror of
 * PayrollRegistryDetailsModal in module/payroll/PayrollManagementWorkspace.jsx, and the row maths
 * below mirrors that file's buildContractualRow(); change one and the other has to follow.
 *
 * reports.php already writes .xlsx, but only flat sheets: one header row, every value an inline
 * string. The register is two-row grouped headers over merged cells with currency that has to stay
 * numeric, so the small writer below adds merges, styles and number formats.
 */

const PAYROLL_XLSX_WORKING_HOURS_PER_DAY = 8.0;
const PAYROLL_XLSX_WORKING_DAYS_PER_MONTH = 22.0;

/* Style slots defined in payroll_xlsx_styles_xml(), in the order their <xf> entries appear. */
const PAYROLL_XLSX_STYLE_DEFAULT = 0;
const PAYROLL_XLSX_STYLE_TITLE = 1;
const PAYROLL_XLSX_STYLE_LABEL = 2;
const PAYROLL_XLSX_STYLE_GROUP_HEADER = 3;
const PAYROLL_XLSX_STYLE_SUB_HEADER = 4;
const PAYROLL_XLSX_STYLE_GROSS_HEADER = 5;
const PAYROLL_XLSX_STYLE_TEXT = 6;
const PAYROLL_XLSX_STYLE_MONEY = 7;
const PAYROLL_XLSX_STYLE_NUMBER = 8;
const PAYROLL_XLSX_STYLE_PERCENT = 9;
const PAYROLL_XLSX_STYLE_GROSS_MONEY = 10;
const PAYROLL_XLSX_STYLE_TOTAL_LABEL = 11;
const PAYROLL_XLSX_STYLE_TOTAL_MONEY = 12;
const PAYROLL_XLSX_STYLE_NAME = 13;
const PAYROLL_XLSX_STYLE_SECTION = 14;
const PAYROLL_XLSX_STYLE_SIGN_NAME = 15;
const PAYROLL_XLSX_STYLE_SIGN_TITLE = 16;
const PAYROLL_XLSX_STYLE_CERT_TEXT = 17;
const PAYROLL_XLSX_STYLE_BOX_LABEL = 18;
const PAYROLL_XLSX_STYLE_STEP = 19;

function payroll_xlsx_escape(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

function payroll_xlsx_column_name(int $index): string
{
    $name = '';

    while ($index >= 0) {
        $name = chr(($index % 26) + 65) . $name;
        $index = intdiv($index, 26) - 1;
    }

    return $name;
}

/**
 * A text cell. `$across`/`$down` are extra cells to merge into, matching colSpan/rowSpan minus one.
 */
function payroll_xlsx_text(mixed $value, int $style = PAYROLL_XLSX_STYLE_TEXT, int $across = 0, int $down = 0): array
{
    return ['value' => $value, 'kind' => 'text', 'style' => $style, 'across' => $across, 'down' => $down];
}

/** A numeric cell. Kept as a number so the workbook stays sortable and summable. */
function payroll_xlsx_number(mixed $value, int $style = PAYROLL_XLSX_STYLE_MONEY, int $across = 0, int $down = 0): array
{
    return ['value' => (float)$value, 'kind' => 'number', 'style' => $style, 'across' => $across, 'down' => $down];
}

function payroll_xlsx_blank(int $style = PAYROLL_XLSX_STYLE_DEFAULT): array
{
    return ['value' => '', 'kind' => 'blank', 'style' => $style, 'across' => 0, 'down' => 0];
}

function payroll_xlsx_image_from_data_url(mixed $value): ?array
{
    $dataUrl = trim((string)($value ?? ''));

    if ($dataUrl === '') {
        return null;
    }

    if (preg_match('/^data:image\/(png|jpe?g|gif|bmp|webp);base64,(.+)$/is', $dataUrl, $matches) !== 1) {
        return null;
    }

    $bytes = base64_decode(preg_replace('/\s+/', '', $matches[2]) ?? '', true);
    if ($bytes === false || $bytes === '') {
        return null;
    }

    $type = strtolower($matches[1]);
    $extension = match ($type) {
        'jpg', 'jpeg' => 'jpg',
        default => $type,
    };
    $contentType = match ($extension) {
        'jpg' => 'image/jpeg',
        'png' => 'image/png',
        'gif' => 'image/gif',
        'bmp' => 'image/bmp',
        'webp' => 'image/webp',
        default => 'application/octet-stream',
    };

    return [
        'bytes' => $bytes,
        'extension' => $extension,
        'contentType' => $contentType,
    ];
}

function payroll_xlsx_styles_xml(): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $xml .= '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

    /*
     * The screen renders money through Intl "PHP" currency and days through a 0-2 decimal formatter.
     * Writing those as formats rather than as pre-rendered strings keeps the cells numeric, so a
     * reviewer can still total a column in Excel and see what the register footer says.
     */
    $xml .= '<numFmts count="3">'
        . '<numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/>'
        . '<numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/>'
        . '<numFmt numFmtId="166" formatCode="#,##0.##"/>'
        . '</numFmts>';

    $xml .= '<fonts count="3">'
        . '<font><sz val="10"/><name val="Calibri"/></font>'
        . '<font><b/><sz val="10"/><name val="Calibri"/></font>'
        . '<font><b/><sz val="14"/><name val="Calibri"/></font>'
        . '</fonts>';

    $xml .= '<fills count="6">'
        . '<fill><patternFill patternType="none"/></fill>'
        . '<fill><patternFill patternType="gray125"/></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE047"/><bgColor indexed="64"/></patternFill></fill>'
        . '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/><bgColor indexed="64"/></patternFill></fill>'
        . '</fills>';

    $thin = '<left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right>'
        . '<top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom>';
    // Border 2 is the signature rule: a line under the name, nothing on the other three sides.
    $xml .= '<borders count="3">'
        . '<border><left/><right/><top/><bottom/><diagonal/></border>'
        . '<border>' . $thin . '<diagonal/></border>'
        . '<border><left/><right/><top/><bottom style="thin"><color rgb="FF0F172A"/></bottom><diagonal/></border>'
        . '</borders>';

    $xml .= '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>';

    $centred = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
    $right = '<alignment horizontal="right" vertical="center"/>';
    $left = '<alignment horizontal="left" vertical="center"/>';

    // Order here defines the PAYROLL_XLSX_STYLE_* indices above.
    $xfs = [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $centred . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $centred . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $centred . '</xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' . $right . '</xf>',
        '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' . $right . '</xf>',
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' . $right . '</xf>',
        '<xf numFmtId="164" fontId="1" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $right . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $right . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' . $left . '</xf>',
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $left . '</xf>',
        // The certification block: name on a rule, designation under it, statements wrapped.
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom"/></xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>',
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
        // A salary step: a whole number with no peso sign or decimals.
        '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    ];

    $xml .= '<cellXfs count="' . count($xfs) . '">' . implode('', $xfs) . '</cellXfs>';
    $xml .= '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>';
    $xml .= '</styleSheet>';

    return $xml;
}

/**
 * Turn a sheet definition into worksheet XML.
 *
 * `$sheet` carries `rows` (arrays of cells), `cols` (widths) and `freeze` (rows held at the top,
 * standing in for the sticky header the screen uses).
 */
function payroll_xlsx_sheet_xml(array $sheet): string
{
    $rows = $sheet['rows'] ?? [];
    $widths = $sheet['cols'] ?? [];
    $freeze = (int)($sheet['freeze'] ?? 0);
    $rowHeights = is_array($sheet['rowHeights'] ?? null) ? $sheet['rowHeights'] : [];
    $hasImages = !empty($sheet['images']);
    $page = is_array($sheet['page'] ?? null) ? $sheet['page'] : [];
    $showGridLines = !array_key_exists('showGridLines', $sheet) || (bool)$sheet['showGridLines'];
    $zoomScale = max(10, min(400, (int)($sheet['zoomScale'] ?? 100)));

    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $xml .= '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        . ($hasImages ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : '')
        . '>';

    if ($page !== []) {
        $xml .= '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
    }

    if ($freeze > 0 || !$showGridLines || $zoomScale !== 100) {
        $topLeft = 'A' . ($freeze + 1);
        $xml .= '<sheetViews><sheetView workbookViewId="0" showGridLines="'
            . ($showGridLines ? '1' : '0') . '" zoomScale="' . $zoomScale . '">';
        if ($freeze > 0) {
            $xml .= '<pane ySplit="' . $freeze . '" topLeftCell="' . $topLeft . '" activePane="bottomLeft" state="frozen"/>';
        }
        $xml .= '</sheetView></sheetViews>';
    }

    if ($widths !== []) {
        $xml .= '<cols>';
        foreach ($widths as $index => $width) {
            $column = $index + 1;
            $xml .= '<col min="' . $column . '" max="' . $column . '" width="' . $width . '" customWidth="1"/>';
        }
        $xml .= '</cols>';
    }

    /*
     * Excel keeps the style of every physical cell underneath a merged range. If only the
     * top-left anchor is written, fills and -- most visibly on the DTR -- bottom/outer borders can
     * stop after that first cell. Mirror the anchor style into otherwise-empty merged cells before
     * serializing so merged headings, name rules and signature rules draw as continuous boxes.
     */
    $mergedAnchors = [];
    foreach ($rows as $rowIndex => $cells) {
        foreach ($cells as $columnIndex => $cell) {
            if (!is_array($cell)) {
                continue;
            }

            $across = max(0, (int)($cell['across'] ?? 0));
            $down = max(0, (int)($cell['down'] ?? 0));
            if ($across > 0 || $down > 0) {
                $mergedAnchors[] = [$rowIndex, $columnIndex, $across, $down, (int)($cell['style'] ?? 0)];
            }
        }
    }

    foreach ($mergedAnchors as [$rowIndex, $columnIndex, $across, $down, $style]) {
        for ($mergedRow = $rowIndex; $mergedRow <= $rowIndex + $down; $mergedRow++) {
            $rows[$mergedRow] ??= [];
            for ($mergedColumn = $columnIndex; $mergedColumn <= $columnIndex + $across; $mergedColumn++) {
                if ($mergedRow === $rowIndex && $mergedColumn === $columnIndex) {
                    continue;
                }
                if (!array_key_exists($mergedColumn, $rows[$mergedRow]) || $rows[$mergedRow][$mergedColumn] === null) {
                    $rows[$mergedRow][$mergedColumn] = payroll_xlsx_blank($style);
                }
            }
            ksort($rows[$mergedRow]);
        }
    }
    ksort($rows);

    $merges = [];
    $xml .= '<sheetData>';

    foreach ($rows as $rowIndex => $cells) {
        $rowNumber = $rowIndex + 1;
        $height = $rowHeights[$rowIndex] ?? $rowHeights[(string)$rowIndex] ?? null;

        $xml .= '<row r="' . $rowNumber . '"';
        if (is_numeric($height) && (float)$height > 0) {
            $xml .= ' ht="' . payroll_xlsx_escape((string)(float)$height) . '" customHeight="1"';
        }
        $xml .= '>';

        foreach ($cells as $columnIndex => $cell) {
            if ($cell === null) {
                continue;
            }

            $reference = payroll_xlsx_column_name($columnIndex) . $rowNumber;
            $style = (int)($cell['style'] ?? 0);
            $kind = $cell['kind'] ?? 'text';

            if ($kind === 'number') {
                $xml .= '<c r="' . $reference . '" s="' . $style . '"><v>' . rtrim(rtrim(number_format((float)$cell['value'], 4, '.', ''), '0'), '.') . '</v></c>';
            } elseif ($kind === 'blank') {
                $xml .= '<c r="' . $reference . '" s="' . $style . '"/>';
            } else {
                $xml .= '<c r="' . $reference . '" s="' . $style . '" t="inlineStr"><is><t xml:space="preserve">'
                    . payroll_xlsx_escape($cell['value']) . '</t></is></c>';
            }

            $across = (int)($cell['across'] ?? 0);
            $down = (int)($cell['down'] ?? 0);

            if ($across > 0 || $down > 0) {
                $merges[] = $reference . ':'
                    . payroll_xlsx_column_name($columnIndex + $across) . ($rowNumber + $down);
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

    if ($page !== []) {
        $orientation = in_array(($page['orientation'] ?? ''), ['portrait', 'landscape'], true)
            ? $page['orientation']
            : 'portrait';
        $paperSize = max(1, (int)($page['paperSize'] ?? 9));
        $fitToWidth = max(0, (int)($page['fitToWidth'] ?? 1));
        $fitToHeight = max(0, (int)($page['fitToHeight'] ?? 1));
        $margin = static fn (string $key, float $fallback): string => payroll_xlsx_escape(
            (string)(float)($page[$key] ?? $fallback)
        );

        $xml .= '<printOptions horizontalCentered="1" verticalCentered="0"/>'
            . '<pageMargins left="' . $margin('left', 0.25) . '" right="' . $margin('right', 0.25)
            . '" top="' . $margin('top', 0.25) . '" bottom="' . $margin('bottom', 0.25)
            . '" header="' . $margin('header', 0.1) . '" footer="' . $margin('footer', 0.1) . '"/>'
            . '<pageSetup paperSize="' . $paperSize . '" orientation="' . $orientation
            . '" fitToWidth="' . $fitToWidth . '" fitToHeight="' . $fitToHeight . '"/>';
    }

    if ($hasImages) {
        $xml .= '<drawing r:id="rId1"/>';
    }

    $xml .= '</worksheet>';

    return $xml;
}

function payroll_xlsx_drawing_xml(array $images): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $xml .= '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
        . ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
        . ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

    foreach (array_values($images) as $index => $image) {
        $id = $index + 1;
        $name = payroll_xlsx_escape($image['name'] ?? ('Signature ' . $id));
        $fromCol = max(0, (int)($image['fromCol'] ?? 0));
        $fromRow = max(0, (int)($image['fromRow'] ?? 0));
        $toCol = max($fromCol + 1, (int)($image['toCol'] ?? ($fromCol + 1)));
        $toRow = max($fromRow + 1, (int)($image['toRow'] ?? ($fromRow + 1)));
        $fromColOff = max(0, (int)($image['fromColOff'] ?? 180000));
        $fromRowOff = max(0, (int)($image['fromRowOff'] ?? 20000));
        $toColOff = max(0, (int)($image['toColOff'] ?? 0));
        $toRowOff = max(0, (int)($image['toRowOff'] ?? 0));

        $xml .= '<xdr:twoCellAnchor editAs="oneCell">'
            . '<xdr:from><xdr:col>' . $fromCol . '</xdr:col><xdr:colOff>' . $fromColOff . '</xdr:colOff>'
            . '<xdr:row>' . $fromRow . '</xdr:row><xdr:rowOff>' . $fromRowOff . '</xdr:rowOff></xdr:from>'
            . '<xdr:to><xdr:col>' . $toCol . '</xdr:col><xdr:colOff>' . $toColOff . '</xdr:colOff>'
            . '<xdr:row>' . $toRow . '</xdr:row><xdr:rowOff>' . $toRowOff . '</xdr:rowOff></xdr:to>'
            . '<xdr:pic>'
            . '<xdr:nvPicPr><xdr:cNvPr id="' . $id . '" name="' . $name . '"/>'
            . '<xdr:cNvPicPr><a:picLocks'
            . (($image['lockAspect'] ?? true) ? ' noChangeAspect="1"' : '')
            . '/></xdr:cNvPicPr></xdr:nvPicPr>'
            . '<xdr:blipFill><a:blip r:embed="rId' . $id . '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
            . '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
            . '</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>';
    }

    $xml .= '</xdr:wsDr>';

    return $xml;
}

function payroll_xlsx_drawing_relationships_xml(array $images): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $xml .= '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

    foreach (array_values($images) as $index => $image) {
        $id = $index + 1;
        $extension = payroll_xlsx_escape($image['extension'] ?? 'png');
        $xml .= '<Relationship Id="rId' . $id . '"'
            . ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'
            . ' Target="../media/image' . $id . '.' . $extension . '"/>';
    }

    $xml .= '</Relationships>';

    return $xml;
}

function payroll_xlsx_package_parts(array $sheet, string $sheetName, string $title): array
{
    $images = [];

    foreach (($sheet['images'] ?? []) as $image) {
        if (!is_array($image) || !isset($image['bytes'])) {
            continue;
        }

        $images[] = $image;
    }

    $hasImages = $images !== [];

    $contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>';

    foreach (array_unique(array_map(static fn (array $image): string => (string)($image['extension'] ?? 'png'), $images)) as $extension) {
        $contentType = '';
        foreach ($images as $image) {
            if (($image['extension'] ?? 'png') === $extension) {
                $contentType = (string)($image['contentType'] ?? '');
                break;
            }
        }

        if ($contentType !== '') {
            $contentTypes .= '<Default Extension="' . payroll_xlsx_escape($extension) . '" ContentType="' . payroll_xlsx_escape($contentType) . '"/>';
        }
    }

    $contentTypes .= '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';

    if ($hasImages) {
        $contentTypes .= '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
    }

    $contentTypes .= '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        . '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        . '</Types>';

    $parts = [
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
            . '<sheets><sheet name="' . payroll_xlsx_escape($sheetName) . '" sheetId="1" r:id="rId1"/></sheets>'
            . '</workbook>',
        'xl/styles.xml' => (string)($sheet['stylesXml'] ?? payroll_xlsx_styles_xml()),
        'xl/worksheets/sheet1.xml' => payroll_xlsx_sheet_xml($sheet),
        'docProps/core.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            . '<dc:title>' . payroll_xlsx_escape($title) . '</dc:title><dc:creator>HRIS</dc:creator>'
            . '</cp:coreProperties>',
        'docProps/app.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>HRIS</Application></Properties>',
    ];

    $parts['[Content_Types].xml'] = $contentTypes;

    if ($hasImages) {
        $parts['xl/worksheets/_rels/sheet1.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
            . '</Relationships>';
        $parts['xl/drawings/drawing1.xml'] = payroll_xlsx_drawing_xml($images);
        $parts['xl/drawings/_rels/drawing1.xml.rels'] = payroll_xlsx_drawing_relationships_xml($images);

        foreach (array_values($images) as $index => $image) {
            $parts['xl/media/image' . ($index + 1) . '.' . ($image['extension'] ?? 'png')] = (string)($image['bytes'] ?? '');
        }
    }

    return $parts;
}

function payroll_zip_u16(int $value): string
{
    return pack('v', $value);
}

function payroll_zip_u32(int $value): string
{
    return pack('V', $value < 0 ? $value + 4294967296 : $value);
}

function payroll_zip_dos_datetime(): array
{
    $date = getdate();
    $year = max(1980, min(2107, (int)$date['year']));

    return [
        ((int)$date['hours'] << 11) | ((int)$date['minutes'] << 5) | intdiv((int)$date['seconds'], 2),
        (($year - 1980) << 9) | ((int)$date['mon'] << 5) | (int)$date['mday'],
    ];
}

/** Minimal stored-entry ZIP writer used when XAMPP has no ZipArchive extension loaded. */
function payroll_zip_store(array $parts): ?string
{
    if (count($parts) > 65535) {
        return null;
    }

    [$dosTime, $dosDate] = payroll_zip_dos_datetime();
    $body = '';
    $central = '';

    foreach ($parts as $name => $contents) {
        $name = (string)$name;
        $contents = (string)$contents;
        $offset = strlen($body);
        $size = strlen($contents);
        $crc = (int)sprintf('%u', crc32($contents));
        $nameLength = strlen($name);

        $body .= payroll_zip_u32(0x04034b50)
            . payroll_zip_u16(20)
            . payroll_zip_u16(0)
            . payroll_zip_u16(0)
            . payroll_zip_u16($dosTime)
            . payroll_zip_u16($dosDate)
            . payroll_zip_u32($crc)
            . payroll_zip_u32($size)
            . payroll_zip_u32($size)
            . payroll_zip_u16($nameLength)
            . payroll_zip_u16(0)
            . $name
            . $contents;

        $central .= payroll_zip_u32(0x02014b50)
            . payroll_zip_u16(20)
            . payroll_zip_u16(20)
            . payroll_zip_u16(0)
            . payroll_zip_u16(0)
            . payroll_zip_u16($dosTime)
            . payroll_zip_u16($dosDate)
            . payroll_zip_u32($crc)
            . payroll_zip_u32($size)
            . payroll_zip_u32($size)
            . payroll_zip_u16($nameLength)
            . payroll_zip_u16(0)
            . payroll_zip_u16(0)
            . payroll_zip_u16(0)
            . payroll_zip_u16(0)
            . payroll_zip_u32(0)
            . payroll_zip_u32($offset)
            . $name;
    }

    $entryCount = count($parts);
    $centralSize = strlen($central);
    $centralOffset = strlen($body);

    return $body
        . $central
        . payroll_zip_u32(0x06054b50)
        . payroll_zip_u16(0)
        . payroll_zip_u16(0)
        . payroll_zip_u16($entryCount)
        . payroll_zip_u16($entryCount)
        . payroll_zip_u32($centralSize)
        . payroll_zip_u32($centralOffset)
        . payroll_zip_u16(0);
}

/** Package one sheet as a .xlsx and return the bytes. */
function payroll_xlsx_package(array $sheet, string $sheetName, string $title): ?string
{
    $parts = payroll_xlsx_package_parts($sheet, $sheetName, $title);

    if (!class_exists(ZipArchive::class)) {
        return payroll_zip_store($parts);
    }

    $tempFile = tempnam(sys_get_temp_dir(), 'hris-payroll-');

    if ($tempFile === false) {
        return payroll_zip_store($parts);
    }

    $zip = new ZipArchive();

    if ($zip->open($tempFile, ZipArchive::OVERWRITE) !== true) {
        @unlink($tempFile);
        return payroll_zip_store($parts);
    }

    foreach ($parts as $path => $contents) {
        if ($zip->addFromString($path, $contents) !== true) {
            $zip->close();
            @unlink($tempFile);
            return payroll_zip_store($parts);
        }
    }

    $zip->close();

    $bytes = file_get_contents($tempFile);
    @unlink($tempFile);

    return $bytes === false ? payroll_zip_store($parts) : $bytes;
}

/* ----------------------------------------------------------------------------------------------
 * The register itself.
 *
 * Everything below mirrors PayrollRegistryDetailsModal. The helper names deliberately echo the
 * frontend ones (buildContractualRow, getDeductionAmount, buildPayoutHalfColumnLabels...) so the
 * two can be read side by side.
 * -------------------------------------------------------------------------------------------- */

/** Mirrors normalizeEmploymentTypeLabel(): older spellings read back as "Contract of Service". */
function payroll_export_employment_type(mixed $value): string
{
    $normalized = strtolower(trim((string)($value ?? '')));

    if ($normalized === '') {
        return '';
    }

    if (in_array($normalized, ['contract of service', 'contractual', 'cos'], true)) {
        return 'Contract of Service';
    }

    return $normalized === 'regular' ? 'Regular' : trim((string)$value);
}

function payroll_export_is_contractual(array $record): bool
{
    return payroll_export_employment_type($record['employmentType'] ?? '') === 'Contract of Service';
}

function payroll_export_amount(mixed $value): float
{
    return is_numeric($value) ? round((float)$value, 2) : 0.0;
}

/** Mirrors the frontend's key-flattening match, so "Pag-IBIG" and "PAG IBIG" hit the same row. */
function payroll_export_item_amount(array $items, array $names): float
{
    $keys = [];

    foreach ($names as $name) {
        $keys[preg_replace('/[^a-z0-9]/', '', strtolower((string)$name))] = true;
    }

    $total = 0.0;

    foreach ($items as $item) {
        $key = preg_replace('/[^a-z0-9]/', '', strtolower((string)($item['name'] ?? '')));

        if (isset($keys[$key])) {
            $total += payroll_export_amount($item['amount'] ?? 0);
        }
    }

    return round($total, 2);
}

function payroll_export_deduction_amount(array $record, array $names): float
{
    return payroll_export_item_amount(
        is_array($record['deductionItems'] ?? null) ? $record['deductionItems'] : [],
        $names
    );
}

function payroll_export_allowance_amount(array $record, array $names): float
{
    return payroll_export_item_amount(
        is_array($record['allowanceItems'] ?? null) ? $record['allowanceItems'] : [],
        $names
    );
}

function payroll_export_days_rendered(array $record): float
{
    $renderedMinutes = payroll_export_amount($record['attendanceRenderedMinutes'] ?? 0);

    if ($renderedMinutes > 0) {
        return round($renderedMinutes / (PAYROLL_XLSX_WORKING_HOURS_PER_DAY * 60), 2);
    }

    $expectedWorkdays = payroll_export_amount($record['attendanceExpectedWorkdays'] ?? 0);

    if ($expectedWorkdays > 0) {
        return max(round($expectedWorkdays - payroll_export_amount($record['absenceDays'] ?? 0), 2), 0);
    }

    return 0.0;
}

function payroll_export_daily_rate(array $record): float
{
    $hourlyRate = payroll_export_amount($record['hourlyRate'] ?? 0);

    if ($hourlyRate > 0) {
        return round($hourlyRate * PAYROLL_XLSX_WORKING_HOURS_PER_DAY, 2);
    }

    $basicSalary = payroll_export_amount($record['basicSalary'] ?? 0);

    return $basicSalary > 0 ? round($basicSalary / PAYROLL_XLSX_WORKING_DAYS_PER_MONTH, 2) : 0.0;
}

/** Mirrors buildContractualRow(). */
function payroll_export_contractual_row(array $record): array
{
    $basicSalary = payroll_export_amount($record['basicSalary'] ?? 0);
    $dailyRate = payroll_export_daily_rate($record);
    $premiumTotal = payroll_export_allowance_amount($record, ['Premium', 'Premium Pay', 'Premium Percentage']);
    $calculatedPremiumRate = $basicSalary > 0 ? round(($premiumTotal / $basicSalary) * 100, 2) : 0.0;
    $premiumRate = $calculatedPremiumRate > 0 ? $calculatedPremiumRate : 0.20;
    $additionalSalary = payroll_export_amount($record['totalAllowance'] ?? 0);
    $earnedBasicSalary = payroll_export_amount($record['periodBasicSalary'] ?? (payroll_export_amount($record['grossPay'] ?? 0) - $additionalSalary));
    $salaryTotal = round($earnedBasicSalary + $additionalSalary, 2);

    // Pass slips only become their own deduction when attendance did not already cover the period.
    $undertimeDeduction = payroll_export_amount($record['undertimeDeduction'] ?? 0);
    $passSlipDeduction = !empty($record['hasAttendanceCoverage']) ? 0.0 : $undertimeDeduction;
    $tardyUndertimeDeduction = max(
        round(payroll_export_amount($record['lateDeduction'] ?? 0) + $undertimeDeduction - $passSlipDeduction, 2),
        0
    );
    $previousPayrollDeduction = payroll_export_deduction_amount($record, [
        'DEDUCTION PREVIOUS PAYROLL',
        'Deduction from Previous Payroll',
    ]);
    $salaryLessTotal = round($previousPayrollDeduction + $tardyUndertimeDeduction + $passSlipDeduction, 2);

    return [
        'daysRendered' => payroll_export_days_rendered($record),
        'dailyRate' => $dailyRate,
        'premiumRate' => $premiumRate,
        'premiumTotal' => $premiumTotal,
        'rateWithPremium' => round($dailyRate * (1 + $premiumRate / 100), 2),
        'periodSalary' => $earnedBasicSalary,
        'additionalSalary' => $additionalSalary,
        'salaryTotal' => $salaryTotal,
        'previousPayrollDeduction' => $previousPayrollDeduction,
        'tardyUndertimeDeduction' => $tardyUndertimeDeduction,
        'passSlipDeduction' => $passSlipDeduction,
        'grossPay' => round($salaryTotal - $salaryLessTotal, 2),
        'tax' => payroll_export_deduction_amount($record, ['Withholding Tax', 'WITHHOLDING TAX', 'W-TAX', 'TAX']),
        'philHealth' => payroll_export_deduction_amount($record, ['PHIC', 'PhilHealth', 'PHILHEALTH PREMIUM']),
        'philHealthDifferential' => payroll_export_deduction_amount($record, ['PhilHealth Differential', 'PHILHEALTH DIFFERENTIAL']),
        'pagIbig' => payroll_export_deduction_amount($record, ['HDMF', 'Pag-IBIG', 'PAG IBIG PREMIUM', 'PAG-IBIG']),
        'pagIbigMp2' => payroll_export_deduction_amount($record, ['MP2', 'PAG IBIG MP2', 'PAG-IBIG MP2', 'Modified Pag-IBIG II (MP2)']),
        'pagIbigMpl' => payroll_export_deduction_amount($record, ['PAG-IBIG MPL', 'PAG IBIG MPL']),
        'mgbCoopLoan' => payroll_export_deduction_amount($record, ['MGB Coop Loan', 'MGB COOP LOAN', 'MGB Cooperative Loan']),
        'totalDeductions' => max(round(payroll_export_amount($record['totalDeduction'] ?? 0) - $salaryLessTotal, 2), 0),
        'netPay' => payroll_export_amount($record['netPay'] ?? 0),
    ];
}

function payroll_export_date(mixed $value): ?DateTimeImmutable
{
    $text = trim((string)($value ?? ''));

    if ($text === '') {
        return null;
    }

    if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $text, $matches) === 1) {
        $text = $matches[1];
    }

    try {
        return new DateTimeImmutable($text);
    } catch (Throwable) {
        return null;
    }
}

/** Mirrors formatDisplayDate(): "Mar 15, 2026", or the raw text when it will not parse. */
function payroll_export_display_date(mixed $value): string
{
    $date = payroll_export_date($value);

    if ($date === null) {
        return trim((string)($value ?? '')) !== '' ? (string)$value : 'N/A';
    }

    return $date->format('M j, Y');
}

/** Mirrors buildSalaryPeriodColumnLabel(). */
function payroll_export_salary_period_label(mixed $startDate, mixed $endDate): string
{
    $start = payroll_export_date($startDate);
    $end = payroll_export_date($endDate);

    if ($start === null || $end === null) {
        return 'Salary for the Period';
    }

    if ($start->format('Y-m') === $end->format('Y-m')) {
        return $start->format('F') . ' ' . $start->format('j') . '-' . $end->format('j') . ', ' . $end->format('Y');
    }

    return payroll_export_display_date($startDate) . ' - ' . payroll_export_display_date($endDate);
}

/** Mirrors buildPayoutHalfColumnLabels(): both halves, dated from the period the payroll carries. */
function payroll_export_payout_amounts(array $record): array
{
    $netPay = payroll_export_amount($record['netPay'] ?? 0);
    $period = strtolower(trim((string)($record['payPeriod'] ?? '')));
    if ($period === '1st half') {
        return [$netPay, 0.0];
    }
    if ($period === '2nd half') {
        return [0.0, $netPay];
    }
    if ($period === 'monthly') {
        $firstHalf = floor($netPay / 2 * 100 + 0.5) / 100;
        return [$firstHalf, round($netPay - $firstHalf, 2)];
    }
    return [0.0, 0.0];
}

function payroll_export_payout_half_labels(mixed $startDate, mixed $endDate): array
{
    $start = payroll_export_date($startDate);
    $end = payroll_export_date($endDate);
    $firstHalf = $start ?? $end;
    $secondHalf = $end ?? $start;

    if ($firstHalf === null || $secondHalf === null) {
        return [
            ['month' => 'Payout', 'range' => '1st Half'],
            ['month' => 'Payout', 'range' => '2nd Half'],
        ];
    }

    return [
        ['month' => $firstHalf->format('F'), 'range' => '1-15, ' . $firstHalf->format('Y')],
        ['month' => $secondHalf->format('F'), 'range' => '16-' . $secondHalf->format('t') . ', ' . $secondHalf->format('Y')],
    ];
}

/**
 * The name as the register lists it: "Lastname, Firstname Middlename". Mirrors
 * formatRegisterEmployeeName() in module/payroll/PayrollManagementWorkspace.jsx; a record without
 * the name parts keeps its full name.
 */
function payroll_export_register_name(array $record): string
{
    $lastName = trim((string)($record['lastName'] ?? ''));
    $givenNames = trim(trim((string)($record['firstName'] ?? '')) . ' ' . trim((string)($record['middleName'] ?? '')));

    if ($lastName === '') {
        $fullName = trim((string)($record['employeeName'] ?? ''));
        return $fullName !== '' ? $fullName : 'Employee';
    }

    return $givenNames !== '' ? $lastName . ', ' . $givenNames : $lastName;
}

/** The surname, first name, and middle name to sort by, in that order. */
function payroll_export_name_sort_keys(array $record): array
{
    $lastName = trim((string)($record['lastName'] ?? ''));

    return $lastName !== ''
        ? [$lastName, trim((string)($record['firstName'] ?? '')), trim((string)($record['middleName'] ?? ''))]
        : [payroll_export_register_name($record), '', ''];
}

/**
 * Mirrors the modal's sortedRecords: alphabetical by surname, then first and middle name,
 * case-insensitive. Comparing the parts rather than the joined name keeps "Dela, Maria" ahead of
 * "Dela Cruz, Juan".
 */
function payroll_export_sort_records(array $records): array
{
    usort($records, static function (array $left, array $right): int {
        $rightKeys = payroll_export_name_sort_keys($right);

        foreach (payroll_export_name_sort_keys($left) as $index => $value) {
            $comparison = strcasecmp($value, $rightKeys[$index]);

            if ($comparison !== 0) {
                return $comparison;
            }
        }

        return 0;
    });

    return $records;
}

/** Mirrors getRegistryEmploymentTypes(): every distinct type present, most common first. */
function payroll_export_employment_type_counts(array $records): array
{
    $counts = [];

    foreach ($records as $record) {
        $label = payroll_export_employment_type($record['employmentType'] ?? '') ?: 'Unspecified';
        $counts[$label] = ($counts[$label] ?? 0) + 1;
    }

    uksort($counts, static function (string $a, string $b) use ($counts): int {
        return $counts[$b] <=> $counts[$a] ?: strcmp($a, $b);
    });

    return $counts;
}

/** The Contract of Service table: two-row grouped header, one row per employee, totals footer. */
function payroll_export_contractual_rows(array $records, string $salaryPeriodLabel): array
{
    $group = PAYROLL_XLSX_STYLE_GROUP_HEADER;
    $sub = PAYROLL_XLSX_STYLE_SUB_HEADER;
    $money = PAYROLL_XLSX_STYLE_MONEY;
    $rows = [];

    // Header row one. `down => 1` is the screen's rowSpan={2}; `across` is its colSpan.
    $rows[] = [
        payroll_xlsx_text('NAMES', $group, 0, 1),
        payroll_xlsx_text('# of days rendered', $group, 0, 1),
        payroll_xlsx_text('Rate/ day', $group, 0, 1),
        payroll_xlsx_text('Premium', $group, 1),
        null,
        payroll_xlsx_text('Total (Rate plus Premium Percentage)', $group, 0, 1),
        payroll_xlsx_text('Salary', $group, 2),
        null,
        null,
        payroll_xlsx_text('Less:', $group, 2),
        null,
        null,
        payroll_xlsx_text('GROSS', PAYROLL_XLSX_STYLE_GROSS_HEADER, 0, 1),
        payroll_xlsx_text('Less', $group, 6),
        null,
        null,
        null,
        null,
        null,
        null,
        payroll_xlsx_text('Total Deductions', $group, 0, 1),
        payroll_xlsx_text('NET PAY', $group, 0, 1),
    ];

    // Header row two: only the columns the row above spanned.
    $rows[] = [
        3 => payroll_xlsx_text('%', $sub),
        4 => payroll_xlsx_text('Total', $sub),
        6 => payroll_xlsx_text($salaryPeriodLabel, $sub),
        7 => payroll_xlsx_text('Additional Salary', $sub),
        8 => payroll_xlsx_text('Total', $sub),
        9 => payroll_xlsx_text('Deduction from Previous Payroll', $sub),
        10 => payroll_xlsx_text('Tardy/ Undertime', $sub),
        11 => payroll_xlsx_text('Pass Slip', $sub),
        13 => payroll_xlsx_text('TAX', $sub),
        14 => payroll_xlsx_text('PhilHealth', $sub),
        15 => payroll_xlsx_text('PhilHealth Differential', $sub),
        16 => payroll_xlsx_text('Pag-IBIG', $sub),
        17 => payroll_xlsx_text('Modified Pag-IBIG II (MP2)', $sub),
        18 => payroll_xlsx_text('Pag-IBIG MPL', $sub),
        19 => payroll_xlsx_text('MGB Coop Loan', $sub),
    ];

    $totalDeductions = 0.0;
    $totalNetPay = 0.0;

    foreach ($records as $record) {
        $row = payroll_export_contractual_row($record);
        $totalDeductions += $row['totalDeductions'];
        $totalNetPay += $row['netPay'];

        $rows[] = [
            payroll_xlsx_text(payroll_export_register_name($record), PAYROLL_XLSX_STYLE_NAME),
            payroll_xlsx_number($row['daysRendered'], PAYROLL_XLSX_STYLE_NUMBER),
            payroll_xlsx_number($row['dailyRate'], $money),
            payroll_xlsx_number($row['premiumRate'], PAYROLL_XLSX_STYLE_PERCENT),
            payroll_xlsx_number($row['premiumTotal'], $money),
            payroll_xlsx_number($row['rateWithPremium'], $money),
            payroll_xlsx_number($row['periodSalary'], $money),
            payroll_xlsx_number($row['additionalSalary'], $money),
            payroll_xlsx_number($row['salaryTotal'], $money),
            payroll_xlsx_number($row['previousPayrollDeduction'], $money),
            payroll_xlsx_number($row['tardyUndertimeDeduction'], $money),
            payroll_xlsx_number($row['passSlipDeduction'], $money),
            payroll_xlsx_number($row['grossPay'], PAYROLL_XLSX_STYLE_GROSS_MONEY),
            payroll_xlsx_number($row['tax'], $money),
            payroll_xlsx_number($row['philHealth'], $money),
            payroll_xlsx_number($row['philHealthDifferential'], $money),
            payroll_xlsx_number($row['pagIbig'], $money),
            payroll_xlsx_number($row['pagIbigMp2'], $money),
            payroll_xlsx_number($row['pagIbigMpl'], $money),
            payroll_xlsx_number($row['mgbCoopLoan'], $money),
            payroll_xlsx_number($row['totalDeductions'], $money),
            payroll_xlsx_number($row['netPay'], $money),
        ];
    }

    $footer = [payroll_xlsx_text('Total Net Payroll Amount (Contract of Service)', PAYROLL_XLSX_STYLE_TOTAL_LABEL, 19)];
    for ($index = 1; $index < 20; $index += 1) {
        $footer[$index] = null;
    }
    $footer[20] = payroll_xlsx_number(round($totalDeductions, 2), PAYROLL_XLSX_STYLE_TOTAL_MONEY);
    $footer[21] = payroll_xlsx_number(round($totalNetPay, 2), PAYROLL_XLSX_STYLE_TOTAL_MONEY);
    $rows[] = $footer;

    return $rows;
}

/**
 * The register's column text for one payroll type: the earnings breakdown beneath the group cell,
 * and what the gross and net columns are called.
 *
 * Kept in step with PAYROLL_TYPE_DEFINITIONS in module/payroll/PayrollManagementWorkspace.jsx so the
 * workbook prints the same headings the details modal shows. An unknown type falls back to Salary,
 * which is also what a record written before payroll types existed resolves to.
 *
 * An earnings column with `'kind' => 'step'` holds the employee's salary step, not an amount, so it
 * is written as a plain whole number.
 */
function payroll_export_type_labels(mixed $payrollType): array
{
    $definitions = [
        'Salary' => [
            'groupLabel' => '',
            'earnings' => [
                ['label' => 'Basic', 'field' => 'periodBasicSalary'],
                ['label' => 'PERA', 'field' => 'pera'],
                ['label' => 'Step Increment', 'field' => 'stepIncrement', 'kind' => 'step'],
            ],
            'grossLabel' => 'Gross Amount Earned',
            'netLabel' => 'Net Pay',
        ],
        'Mid-Year Bonus' => [
            'groupLabel' => 'Mid-Year Bonus',
            'earnings' => [
                ['label' => 'Monthly Basic Salary', 'field' => 'basicSalary'],
                ['label' => 'Mid-Year Bonus', 'field' => 'bonusAmount'],
                ['label' => 'Other Adjustment', 'field' => 'salaryAdjustment'],
            ],
            'grossLabel' => 'Total Bonus Earned',
            'netLabel' => 'Net Pay',
        ],
        'Year-End Bonus' => [
            'groupLabel' => 'Year-End Bonus',
            'earnings' => [
                ['label' => 'Monthly Basic Salary', 'field' => 'basicSalary'],
                ['label' => 'Year-End Bonus', 'field' => 'bonusAmount'],
                ['label' => 'Cash Gift', 'field' => 'otherAllowances'],
            ],
            'grossLabel' => 'Total Year-End Benefit',
            'netLabel' => 'Net Pay',
        ],
        'Performance-Based Bonus (PBB)' => [
            'groupLabel' => 'Performance-Based Bonus',
            'earnings' => [
                ['label' => 'Monthly Basic Salary', 'field' => 'basicSalary'],
                ['label' => 'PBB Amount', 'field' => 'bonusAmount'],
                ['label' => 'Adjustment', 'field' => 'salaryAdjustment'],
            ],
            'grossLabel' => 'Total PBB Earned',
            'netLabel' => 'Net PBB Due',
        ],
        'Honorarium' => [
            'groupLabel' => 'Honorarium',
            'earnings' => [
                ['label' => 'Honorarium', 'field' => 'bonusAmount'],
                ['label' => 'Other Compensation', 'field' => 'otherAllowances'],
                ['label' => 'Adjustment', 'field' => 'salaryAdjustment'],
            ],
            'grossLabel' => 'Total Honorarium Earned',
            'netLabel' => 'Net Honorarium Due',
        ],
        'Transportation Allowance (TA)' => [
            'groupLabel' => 'Transportation Allowance',
            'earnings' => [
                ['label' => 'Transportation Allowance', 'field' => 'travelAllowance'],
                ['label' => 'Other Allowance', 'field' => 'otherAllowances'],
                ['label' => 'Adjustment', 'field' => 'salaryAdjustment'],
            ],
            'grossLabel' => 'Total Allowance Earned',
            'netLabel' => 'Net Allowance Due',
        ],
    ];

    $key = trim((string)($payrollType ?? ''));

    return $definitions[$key] ?? $definitions['Salary'];
}

/** The Regular table. Its deduction columns come from the catalog, exactly as the screen's do. */
function payroll_export_is_undertime_column(array $column): bool
{
    return preg_replace('/[^a-z0-9]/', '', strtolower((string)($column['name'] ?? ''))) === 'undertimededuction';
}

/*
 * The Regular register carries the same Pass Slip column the screen draws (see
 * buildRegularDeductionColumns in PayrollManagementWorkspace.jsx). It is not a catalog type; it sits
 * beside the undertime column whose amount it splits.
 */
function payroll_export_regular_deduction_columns(array $deductionColumns): array
{
    $columns = array_values($deductionColumns);
    $passSlip = ['code' => 'pass_slip', 'name' => 'Pass Slip', 'category' => 'Attendance Deductions', 'passSlip' => true];
    $insertAt = count($columns);

    foreach ($columns as $index => $column) {
        if (payroll_export_is_undertime_column($column)) {
            $insertAt = $index + 1;
            break;
        }
    }

    array_splice($columns, $insertAt, 0, [$passSlip]);

    return $columns;
}

/*
 * Pass slips only become their own deduction when attendance did not cover the period, and the
 * payroll stores that charge as the undertime deduction -- so Pass Slip and Undertime Deduction
 * split one stored amount between them and never show it twice. Matches the details modal.
 */
function payroll_export_regular_deduction_cell(array $record, array $column): float
{
    $hasAttendanceCoverage = !empty($record['hasAttendanceCoverage']);

    if (!empty($column['passSlip'])) {
        return $hasAttendanceCoverage ? 0.0 : payroll_export_deduction_amount($record, ['Undertime Deduction']);
    }

    if (payroll_export_is_undertime_column($column) && !$hasAttendanceCoverage) {
        return 0.0;
    }

    return payroll_export_deduction_amount($record, [$column['name'] ?? '']);
}

function payroll_export_regular_rows(
    array $records,
    array $deductionColumns,
    array $payoutHalves,
    float $registryTotalDeductions,
    float $registryNetPay,
    array $typeLabels
): array
{
    $group = PAYROLL_XLSX_STYLE_GROUP_HEADER;
    $sub = PAYROLL_XLSX_STYLE_SUB_HEADER;
    $money = PAYROLL_XLSX_STYLE_MONEY;
    $deductionColumns = payroll_export_regular_deduction_columns($deductionColumns);
    $deductionCount = count($deductionColumns);
    $rows = [];

    /*
     * Series, Employee No., Employee Name, then the payroll type's earnings breakdown, the gross
     * column, every deduction, Due Date, Total Deductions, the net column, and the two payout
     * halves. The earnings columns are counted rather than fixed because each payroll type names its
     * own -- see payroll_export_type_labels().
     */
    $earnings = array_values($typeLabels['earnings']);
    $earningCount = count($earnings);
    $grossIndex = 3 + $earningCount;
    $deductionStart = $grossIndex + 1;
    $columnTotal = 9 + $earningCount + $deductionCount;

    $header = [
        payroll_xlsx_text('Series', $group, 0, 1),
        payroll_xlsx_text('Employee No.', $group, 0, 1),
        payroll_xlsx_text('Employee Name', $group, 0, 1),
        // On a salary register the screen leaves this group cell empty and labels the earnings
        // columns beneath it; the benefit types name the group instead.
        payroll_xlsx_text($typeLabels['groupLabel'], $group, $earningCount - 1),
    ];

    for ($index = 1; $index < $earningCount; $index += 1) {
        $header[3 + $index] = null;
    }

    $header[$grossIndex] = payroll_xlsx_text($typeLabels['grossLabel'], $group, 0, 1);

    if ($deductionCount > 0) {
        $header[$deductionStart] = payroll_xlsx_text('Deductions', $group, $deductionCount - 1);
        for ($index = 1; $index < $deductionCount; $index += 1) {
            $header[$deductionStart + $index] = null;
        }
    }

    $header[$deductionStart + $deductionCount] = payroll_xlsx_text('Due Date', $group, 0, 1);
    $header[$deductionStart + $deductionCount + 1] = payroll_xlsx_text('Total Deductions', $group, 0, 1);
    $header[$deductionStart + $deductionCount + 2] = payroll_xlsx_text($typeLabels['netLabel'], $group, 0, 1);
    $header[$deductionStart + $deductionCount + 3] = payroll_xlsx_text($payoutHalves[0]['month'], $group);
    $header[$deductionStart + $deductionCount + 4] = payroll_xlsx_text($payoutHalves[1]['month'], $group);
    ksort($header);
    $rows[] = $header;

    $subHeader = [];
    foreach ($earnings as $earningIndex => $earning) {
        $subHeader[3 + $earningIndex] = payroll_xlsx_text($earning['label'], $sub);
    }

    foreach (array_values($deductionColumns) as $index => $column) {
        $subHeader[$deductionStart + $index] = payroll_xlsx_text($column['name'] ?? '', $sub);
    }

    $subHeader[$deductionStart + $deductionCount + 3] = payroll_xlsx_text($payoutHalves[0]['range'], $sub);
    $subHeader[$deductionStart + $deductionCount + 4] = payroll_xlsx_text($payoutHalves[1]['range'], $sub);
    ksort($subHeader);
    $rows[] = $subHeader;

    foreach (array_values($records) as $index => $record) {
        $row = [
            payroll_xlsx_number($index + 1, PAYROLL_XLSX_STYLE_NUMBER),
            payroll_xlsx_text($record['employeeId'] ?? 'N/A', PAYROLL_XLSX_STYLE_TEXT),
            payroll_xlsx_text(payroll_export_register_name($record), PAYROLL_XLSX_STYLE_NAME),
        ];

        foreach ($earnings as $earningIndex => $earning) {
            if (($earning['kind'] ?? '') === 'step') {
                $step = (int)($record[$earning['field']] ?? 0);
                $row[3 + $earningIndex] = $step > 0
                    ? payroll_xlsx_number($step, PAYROLL_XLSX_STYLE_STEP)
                    : payroll_xlsx_blank(PAYROLL_XLSX_STYLE_STEP);
                continue;
            }

            $row[3 + $earningIndex] = payroll_xlsx_number(
                payroll_export_amount($record[$earning['field']] ?? 0),
                $money
            );
        }

        $row[$grossIndex] = payroll_xlsx_number(payroll_export_amount($record['grossPay'] ?? 0), $money);

        foreach (array_values($deductionColumns) as $columnIndex => $column) {
            $row[$deductionStart + $columnIndex] = payroll_xlsx_number(
                payroll_export_regular_deduction_cell($record, $column),
                $money
            );
        }

        $row[$deductionStart + $deductionCount] = payroll_xlsx_text(
            payroll_export_display_date($record['dueDate'] ?? $record['endDate'] ?? ''),
            PAYROLL_XLSX_STYLE_TEXT
        );
        $row[$deductionStart + $deductionCount + 1] = payroll_xlsx_number(payroll_export_amount($record['totalDeduction'] ?? 0), $money);
        $row[$deductionStart + $deductionCount + 2] = payroll_xlsx_number(payroll_export_amount($record['netPay'] ?? 0), $money);
        $row[$deductionStart + $deductionCount + 3] = payroll_xlsx_number(payroll_export_payout_amounts($record)[0], $money);
        $row[$deductionStart + $deductionCount + 4] = payroll_xlsx_number(payroll_export_payout_amounts($record)[1], $money);
        ksort($row);
        $rows[] = $row;
    }

    /*
     * The footer repeats the screen's: one label spanning everything before the overall totals,
     * then the registry's total deductions and net pay. These are whole-registry totals, not only
     * the regular employees' subtotal, so the file agrees with the details modal.
     */
    $footer = [payroll_xlsx_text('Overall Total', PAYROLL_XLSX_STYLE_TOTAL_LABEL, $columnTotal - 5)];
    for ($index = 1; $index <= $columnTotal - 5; $index += 1) {
        $footer[$index] = null;
    }
    $footer[$columnTotal - 4] = payroll_xlsx_number($registryTotalDeductions, PAYROLL_XLSX_STYLE_TOTAL_MONEY);
    $footer[$columnTotal - 3] = payroll_xlsx_number($registryNetPay, PAYROLL_XLSX_STYLE_TOTAL_MONEY);
    $footer[$columnTotal - 2] = payroll_xlsx_blank(PAYROLL_XLSX_STYLE_TOTAL_LABEL);
    $footer[$columnTotal - 1] = payroll_xlsx_blank(PAYROLL_XLSX_STYLE_TOTAL_LABEL);
    ksort($footer);
    $rows[] = $footer;

    return $rows;
}

/** Assemble the register tables directly so exported data starts on the first row. */
function payroll_export_build_register_sheet(array $entry, array $deductionColumns): array
{
    $records = payroll_export_sort_records($entry['records'] ?? []);
    $contractual = array_values(array_filter($records, 'payroll_export_is_contractual'));
    $regular = array_values(array_filter($records, static fn (array $record): bool => !payroll_export_is_contractual($record)));
    $showsBothTables = $contractual !== [] && $regular !== [];

    $rows = [];
    $images = [];
    $rowHeights = [];

    $salaryPeriodLabel = payroll_export_salary_period_label($entry['startDate'] ?? '', $entry['endDate'] ?? '');
    $payoutHalves = payroll_export_payout_half_labels($entry['startDate'] ?? '', $entry['endDate'] ?? '');

    if ($contractual !== []) {
        foreach (payroll_export_contractual_rows($contractual, $salaryPeriodLabel) as $row) {
            $rows[] = $row;
        }

        $rows[] = [];
    }

    if ($regular !== []) {
        if ($showsBothTables && $rows !== []) {
            $rows[] = [payroll_xlsx_text('Regular', PAYROLL_XLSX_STYLE_SECTION)];
        }

        foreach (payroll_export_regular_rows(
            $regular,
            $deductionColumns,
            $payoutHalves,
            payroll_export_amount($entry['totalDeductions'] ?? 0),
            payroll_export_amount($entry['totalNetPay'] ?? 0),
            payroll_export_type_labels($entry['payrollType'] ?? '')
        ) as $row) {
            $rows[] = $row;
        }
    }

    // The register is signed as a whole, so the certification closes the sheet under both tables.
    $rows[] = [];
    $rows[] = [];

    $certificationStartRow = count($rows);
    $certificationBlock = payroll_export_certification_block(
        $entry['signatories'] ?? [],
        $entry['certificationStatement'] ?? '',
        $records,
        [
            'grossPay' => payroll_export_amount($entry['totalGrossPay'] ?? 0),
            'deductions' => payroll_export_amount($entry['totalDeductions'] ?? 0),
            'netPay' => payroll_export_amount($entry['totalNetPay'] ?? 0),
        ]
    );

    foreach ($certificationBlock['rows'] ?? [] as $row) {
        $rows[] = $row;
    }

    foreach ($certificationBlock['images'] ?? [] as $image) {
        $image['fromRow'] = (int)($image['fromRow'] ?? 0) + $certificationStartRow;
        $image['toRow'] = (int)($image['toRow'] ?? 0) + $certificationStartRow;
        $images[] = $image;
    }

    foreach (($certificationBlock['rowHeights'] ?? []) as $rowIndex => $height) {
        $rowHeights[$certificationStartRow + (int)$rowIndex] = $height;
    }

    // Wide first columns for names, a readable default for the money columns behind them.
    $widths = [30, 20, 30];
    $longestRow = 0;

    foreach ($rows as $row) {
        $longestRow = max($longestRow, $row === [] ? 0 : max(array_keys($row)) + 1);
    }

    for ($index = count($widths); $index < $longestRow; $index += 1) {
        $widths[] = 16;
    }

    return [
        'rows' => $rows,
        'cols' => $widths,
        'freeze' => 0,
        'images' => $images,
        'rowHeights' => $rowHeights,
    ];
}

/* ----------------------------------------------------------------------------------------------
 * The certification block that closes the register.
 *
 * Boxes A and B sit on the left with the two certifying officers; the approving and paying officers
 * sit to their right, which is how the printed form lays them out. Kept in step with
 * PAYROLL_CERTIFICATION_* in module/payroll/PayrollManagementWorkspace.jsx so the screen and the
 * workbook are signed under identical wording.
 * -------------------------------------------------------------------------------------------- */

/**
 * Rows for the certification block.
 *
 * `$signatories` comes from payroll_signatories(), then the display names are replaced with the
 * actual approval history names only after the matching workflow stage has acted.
 *
 * Column 0 carries the A/B letter, columns 1-5 the certification and its signatory, columns 7-11
 * the officer alongside it. Fixed columns rather than ones derived from the table above, so the
 * block lands in the same place whichever of the two registers it follows.
 */
function payroll_export_certification_stage_for_slot(mixed $slotKey): string
{
    return match (payroll_text($slotKey)) {
        'certifiedServices' => 'chief',
        'certifiedSupporting' => 'hrhead',
        'approvedBy' => 'regionaldirector',
        'paidBy' => 'finance',
        default => '',
    };
}

function payroll_export_certification_stage_for_action(array $action): string
{
    $actionName = payroll_text($action['action'] ?? '');

    if ($actionName === 'Paid') {
        return 'finance';
    }

    if ($actionName !== 'Approved') {
        return '';
    }

    $fromStatus = payroll_normalize_status($action['fromStatus'] ?? '');

    if ($fromStatus === PAYROLL_HR_HEAD_STATUS) {
        return 'hrhead';
    }

    if ($fromStatus === PAYROLL_CHIEF_STATUS) {
        return 'chief';
    }

    if ($fromStatus === PAYROLL_DIRECTOR_STATUS) {
        return 'regionaldirector';
    }

    $approverRole = normalize_role($action['approverRole'] ?? '');
    return in_array($approverRole, ['hrhead', 'chief', 'regionaldirector'], true) ? $approverRole : '';
}

function payroll_export_certification_actions_by_stage(array $records): array
{
    $byStage = [];

    foreach ($records as $record) {
        $history = is_array($record['approvalHistory'] ?? null) ? $record['approvalHistory'] : [];

        foreach ($history as $action) {
            if (!is_array($action)) {
                continue;
            }

            $stage = payroll_export_certification_stage_for_action($action);
            if ($stage === '' || isset($byStage[$stage])) {
                continue;
            }

            $byStage[$stage] = $action;
        }
    }

    return $byStage;
}

function payroll_export_certification_signatories(array $signatories, array $records): array
{
    $actionsByStage = payroll_export_certification_actions_by_stage($records);

    return array_map(
        static function (array $slot) use ($actionsByStage): array {
            $stage = payroll_export_certification_stage_for_slot($slot['key'] ?? '');

            if ($stage === '') {
                return $slot;
            }

            $action = $actionsByStage[$stage] ?? null;
            if ($action === null) {
                $slot['name'] = '';
                $slot['signatureDataUrl'] = '';
                return $slot;
            }

            $approverName = payroll_text($action['approverName'] ?? '');
            $slot['name'] = $approverName !== '' ? mb_strtoupper($approverName, 'UTF-8') : '';
            $slot['signatureDataUrl'] = payroll_text($action['signatureDataUrl'] ?? '');

            return $slot;
        },
        $signatories
    );
}

function payroll_export_signature_image(mixed $dataUrl, int $fromCol, int $fromRow, int $toCol, int $toRow, string $name): ?array
{
    $image = payroll_xlsx_image_from_data_url($dataUrl);

    if ($image === null) {
        return null;
    }

    return array_merge($image, [
        'name' => $name,
        'fromCol' => $fromCol,
        'fromRow' => $fromRow,
        'toCol' => $toCol,
        'toRow' => $toRow,
        'fromColOff' => 120000,
        'fromRowOff' => 30000,
        'toColOff' => 120000,
        'toRowOff' => 0,
    ]);
}

/*
 * Where the registry totals sit in the certification block: to the right of the approving and
 * paying officers (columns 7-11), so the officer signing for the payout reads the gross, the
 * deductions and the net beside their own name. Label across two columns, amount in the third.
 */
const PAYROLL_XLSX_CERT_TOTALS_COLUMN = 13;

/**
 * The three registry totals as a small boxed table, written into `$rows` alongside the first
 * certification: a header on the statement row, then one row each for gross, deductions and net.
 * Rows that do not exist yet are created, so the panel is drawn even for a register with no
 * certifying officers configured.
 */
function payroll_export_certification_totals(array &$rows, int $startRow, array $totals): void
{
    $column = PAYROLL_XLSX_CERT_TOTALS_COLUMN;
    $lines = [
        [payroll_xlsx_text('PAYROLL TOTALS', PAYROLL_XLSX_STYLE_GROUP_HEADER, 2)],
        [
            payroll_xlsx_text('Total Gross Pay', PAYROLL_XLSX_STYLE_TOTAL_LABEL, 1),
            payroll_xlsx_number($totals['grossPay'] ?? 0, PAYROLL_XLSX_STYLE_TOTAL_MONEY),
        ],
        [
            payroll_xlsx_text('Total Deductions', PAYROLL_XLSX_STYLE_TOTAL_LABEL, 1),
            payroll_xlsx_number($totals['deductions'] ?? 0, PAYROLL_XLSX_STYLE_TOTAL_MONEY),
        ],
        [
            payroll_xlsx_text('Total Net Pay', PAYROLL_XLSX_STYLE_TOTAL_LABEL, 1),
            payroll_xlsx_number($totals['netPay'] ?? 0, PAYROLL_XLSX_STYLE_TOTAL_MONEY),
        ],
    ];

    foreach ($lines as $offset => $cells) {
        $rowIndex = $startRow + $offset;

        while (!isset($rows[$rowIndex])) {
            $rows[] = [];
        }

        $rows[$rowIndex][$column] = $cells[0];

        if (isset($cells[1])) {
            // The label merges across two columns, so the amount lands in the third.
            $rows[$rowIndex][$column + 2] = $cells[1];
        }

        // The writer emits cells in array order, and a sheet's cells must ascend by column.
        ksort($rows[$rowIndex]);
    }
}

function payroll_export_certification_block(
    array $signatories,
    string $statement,
    array $records = [],
    array $totals = []
): array {
    $signatories = payroll_export_certification_signatories($signatories, $records);
    $boxes = array_values(array_filter($signatories, static fn (array $slot): bool => ($slot['placement'] ?? '') === 'box'));
    $side = array_values(array_filter($signatories, static fn (array $slot): bool => ($slot['placement'] ?? '') === 'side'));
    $rows = [];
    $images = [];
    $rowHeights = [];

    $rows[] = [payroll_xlsx_text(
        'CERTIFIED: ' . $statement,
        PAYROLL_XLSX_STYLE_CERT_TEXT,
        11
    )];
    $rows[] = [];

    // The totals panel starts level with the first certification, beside the approving officer.
    $totalsStartRow = count($rows);

    foreach ($boxes as $index => $box) {
        $signatory = $side[$index] ?? null;
        $boxStatement = payroll_text($box['statement'] ?? '');
        $statementRow = count($rows);

        // The letter box spans the five rows of its certification, as the printed form draws it.
        $rows[] = [
            payroll_xlsx_text($box['box'], PAYROLL_XLSX_STYLE_BOX_LABEL, 0, 4),
            payroll_xlsx_text(
                $boxStatement !== '' ? 'CERTIFIED:   ' . $boxStatement : '',
                PAYROLL_XLSX_STYLE_CERT_TEXT,
                4
            ),
        ];

        // Blank run: the officer signs above the rule on the printed sheet.
        $rows[] = [];
        $rows[] = [];
        $rowHeights[$statementRow + 1] = 22;
        $rowHeights[$statementRow + 2] = 22;

        $nameRow = [
            1 => payroll_xlsx_text($box['name'], PAYROLL_XLSX_STYLE_SIGN_NAME, 2),
            4 => payroll_xlsx_text('', PAYROLL_XLSX_STYLE_SIGN_NAME, 1),
        ];
        $titleRow = [
            1 => payroll_xlsx_text($box['title'], PAYROLL_XLSX_STYLE_SIGN_TITLE, 2),
            4 => payroll_xlsx_text('Date', PAYROLL_XLSX_STYLE_SIGN_TITLE, 1),
        ];

        if ($signatory !== null) {
            $nameRow[7] = payroll_xlsx_text($signatory['name'], PAYROLL_XLSX_STYLE_SIGN_NAME, 4);
            $titleRow[7] = payroll_xlsx_text($signatory['title'], PAYROLL_XLSX_STYLE_SIGN_TITLE, 4);
        }

        $boxImage = payroll_export_signature_image(
            $box['signatureDataUrl'] ?? '',
            1,
            $statementRow + 1,
            4,
            $statementRow + 3,
            'Signature - ' . payroll_text($box['name'] ?? $box['title'] ?? 'Certifying Officer')
        );
        if ($boxImage !== null) {
            $images[] = $boxImage;
        }

        if ($signatory !== null) {
            $sideImage = payroll_export_signature_image(
                $signatory['signatureDataUrl'] ?? '',
                7,
                $statementRow + 1,
                12,
                $statementRow + 3,
                'Signature - ' . payroll_text($signatory['name'] ?? $signatory['title'] ?? 'Officer')
            );
            if ($sideImage !== null) {
                $images[] = $sideImage;
            }
        }

        ksort($nameRow);
        ksort($titleRow);
        $rows[] = $nameRow;
        $rows[] = $titleRow;
        $rows[] = [];
    }

    if ($totals !== []) {
        payroll_export_certification_totals($rows, $totalsStartRow, $totals);
    }

    return [
        'rows' => $rows,
        'images' => $images,
        'rowHeights' => $rowHeights,
    ];
}

function payroll_export_certification_rows(array $signatories, string $statement, array $records = []): array
{
    return payroll_export_certification_block($signatories, $statement, $records)['rows'];
}
