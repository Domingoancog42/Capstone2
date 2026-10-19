<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/pds-xlsx.php';

function pds_media_expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$uploadDirectory = dirname(__DIR__) . '/uploads/profile-images';
if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true) && !is_dir($uploadDirectory)) {
    throw new RuntimeException('Cannot prepare PDS image fixtures.');
}
$fixtureName = 'pds-media-test-' . bin2hex(random_bytes(8)) . '.png';
$profilePath = $uploadDirectory . '/' . $fixtureName;
$outsidePath = dirname($uploadDirectory) . '/' . $fixtureName;

try {
    // A square portrait exercises the existing-photo cover crop in Excel/PDF.
    $portrait = imagecreatetruecolor(400, 400);
    $background = imagecolorallocate($portrait, 211, 237, 245);
    $jacket = imagecolorallocate($portrait, 27, 73, 101);
    $skin = imagecolorallocate($portrait, 218, 163, 122);
    $hair = imagecolorallocate($portrait, 51, 42, 43);
    imagefill($portrait, 0, 0, $background);
    imagefilledellipse($portrait, 200, 397, 275, 270, $jacket);
    imagefilledrectangle($portrait, 171, 240, 228, 303, $skin);
    imagefilledellipse($portrait, 200, 158, 177, 218, $hair);
    imagefilledellipse($portrait, 200, 181, 145, 179, $skin);
    imagefilledellipse($portrait, 176, 173, 11, 9, $hair);
    imagefilledellipse($portrait, 224, 173, 11, 9, $hair);
    imagesetthickness($portrait, 3);
    imagearc($portrait, 200, 212, 44, 30, 10, 170, $hair);
    imagepng($portrait, $profilePath);
    imagedestroy($portrait);
    $profileBytes = (string)file_get_contents($profilePath);
    file_put_contents($outsidePath, $profileBytes);

    $signature = imagecreatetruecolor(600, 150);
    imagealphablending($signature, false);
    imagesavealpha($signature, true);
    imagefill($signature, 0, 0, imagecolorallocatealpha($signature, 255, 255, 255, 127));
    $ink = imagecolorallocatealpha($signature, 10, 31, 84, 0);
    imagesetthickness($signature, 4);
    foreach ([[28, 103, 95, 24], [95, 24, 71, 116], [71, 116, 150, 47], [150, 47, 132, 106],
        [132, 106, 215, 58], [215, 58, 205, 97], [205, 97, 286, 56], [286, 56, 292, 97],
        [292, 97, 369, 48], [369, 48, 353, 107], [353, 107, 453, 67], [453, 67, 478, 92],
        [42, 129, 558, 109]] as [$x1, $y1, $x2, $y2]) {
        imageline($signature, $x1, $y1, $x2, $y2, $ink);
    }
    ob_start();
    imagepng($signature);
    $signatureBytes = (string)ob_get_clean();
    imagedestroy($signature);
    $signatureData = 'data:image/png;base64,' . base64_encode($signatureBytes);
    $storedProfile = 'uploads/profile-images/' . $fixtureName;

    pds_media_expect(pds_xlsx_profile_image($storedProfile) !== null, 'Saved profile upload should resolve.');
    foreach (['https://example.test/profile.png', 'file://' . $profilePath, $profilePath,
        'uploads/profile-images/../' . $fixtureName, 'uploads/profile-images/%2e%2e/' . $fixtureName] as $unsafe) {
        pds_media_expect(pds_xlsx_profile_image($unsafe) === null, 'Reject external or escaped image path: ' . $unsafe);
    }
    foreach (['data:image/svg+xml;base64,' . base64_encode('<svg/>'), 'data:image/png;base64,bm90LWFuLWltYWdl',
        'data:image/jpeg;base64,' . base64_encode($signatureBytes), 'https://example.test/signature.png'] as $invalid) {
        pds_media_expect(pds_xlsx_signature_image($invalid) === null, 'Reject invalid signature content or MIME.');
    }

    $template = __DIR__ . '/../templates/Personal-Data-Sheet-CS-Form-No.-212-Revised-2026.xlsx';
    $bytes = pds_xlsx_build($template, [
        'employee_id' => 'PDS-MEDIA-001', 'last_name' => 'Media', 'first_name' => 'Preview',
        'emp_gsis_id_no' => '001234567', 'profile_image' => $storedProfile, 'e_signature' => $signatureData,
    ], [], new DateTimeImmutable('2026-10-19'));
    $workbookFile = tempnam(sys_get_temp_dir(), 'pds-media-');
    try {
        file_put_contents($workbookFile, $bytes);
        $parts = pds_xlsx_read_package($workbookFile);
    } finally {
        unlink($workbookFile);
    }
    pds_media_expect($parts['xl/media/pds-profile.png'] === $profileBytes, 'Embed actual saved portrait bytes.');
    pds_media_expect($parts['xl/media/pds-signature.png'] === $signatureBytes, 'Preserve signature PNG transparency.');
    $drawing = new DOMDocument();
    $drawing->loadXML($parts['xl/drawings/drawing2.xml']);
    $xpath = new DOMXPath($drawing);
    $xpath->registerNamespace('xdr', 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing');
    $xpath->registerNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main');
    pds_media_expect($xpath->query('//xdr:pic')->length === 2, 'Both profile media pictures should be printable.');
    pds_media_expect($xpath->query('//a:t[contains(., "Passport-sized")]')->length === 0, 'Remove covered photo instructions.');
    $photo = $xpath->query('//xdr:pic[xdr:nvPicPr/xdr:cNvPr[@name="PDS Passport Photo"]]')->item(0);
    $signature = $xpath->query('//xdr:pic[xdr:nvPicPr/xdr:cNvPr[@name="PDS E-Signature"]]')->item(0);
    pds_media_expect($photo !== null && $signature !== null, 'Media names identify the expected form fields.');
    pds_media_expect((int)$xpath->query('xdr:blipFill/a:srcRect', $photo)->item(0)->getAttribute('l') === 11111,
        'Crop square existing portraits to the passport aspect without stretching.');
    $photoExtent = $xpath->query('xdr:spPr/a:xfrm/a:ext', $photo)->item(0);
    $signatureExtent = $xpath->query('xdr:spPr/a:xfrm/a:ext', $signature)->item(0);
    $scale = 0.9192984706146398;
    pds_media_expect(abs((int)$photoExtent->getAttribute('cx') / 12700 * $scale * 25.4 / 72 - 35) < 0.001,
        'Passport photo must print 35 mm wide.');
    pds_media_expect(abs((int)$photoExtent->getAttribute('cy') / 12700 * $scale * 25.4 / 72 - 45) < 0.001,
        'Passport photo must print 45 mm high.');
    pds_media_expect(abs((int)$signatureExtent->getAttribute('cx') / (int)$signatureExtent->getAttribute('cy') - 4) < 0.001,
        'Signature keeps its original aspect ratio.');
    $sheet = new SimpleXMLElement($parts['xl/worksheets/sheet4.xml']);
    $sheet->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    pds_media_expect($sheet->xpath('//s:c[@r="G60"]/*') === [], 'Remove red signature placeholder.');
    pds_media_expect((string)$sheet->xpath('//s:c[@r="D61"]/s:is/s:t')[0] === 'GSIS', 'Export the government ID type as GSIS.');
    pds_media_expect((string)$sheet->xpath('//s:c[@r="D62"]/s:is/s:t')[0] === '001234567', 'Preserve the GSIS ID number.');
    $previousErrors = libxml_use_internal_errors(true);
    foreach ($parts as $name => $contents) {
        if (preg_match('/\.(xml|rels|vml)$/', $name)) {
            pds_media_expect(simplexml_load_string($contents) !== false, 'Valid media package XML: ' . $name);
        }
    }
    libxml_clear_errors();
    libxml_use_internal_errors($previousErrors);
    $relationships = new SimpleXMLElement($parts['xl/drawings/_rels/drawing2.xml.rels']);
    $relationships->registerXPathNamespace('r', 'http://schemas.openxmlformats.org/package/2006/relationships');
    foreach ($relationships->xpath('//r:Relationship') as $relationship) {
        pds_media_expect(isset($parts['xl/' . substr((string)$relationship['Target'], 3)]), 'Image relationship target exists.');
    }
    if (isset($argv[1]) && is_dir($argv[1])) {
        file_put_contents($argv[1] . '/pds-2026-media.xlsx', $bytes);
    }
    echo "PDS saved passport photo, physical dimensions, contained transparent signature, safe media paths and GSIS ID name passed.\n";
} finally {
    if (is_file($profilePath)) {
        unlink($profilePath);
    }
    if (is_file($outsidePath)) {
        unlink($outsidePath);
    }
}
