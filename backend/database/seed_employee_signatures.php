<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

/*
 * Sample e-signatures for every employee, so the forms that print one -- leave, DTR, service record,
 * payroll, pass slips, travel orders -- show a signed line during demos.
 *
 * Each signature is a hand-drawn scrawl rather than a written name: a lead-in stroke, one or two tall
 * looped letters (like a cursive f or l), sometimes a few small humps and eyelets, then a long tail
 * that trails off uphill, often with a dot after it. It is one pen stroke in black ink on a transparent
 * background: the same `data:image/png;base64,...` value the profile's signature pad saves. Images are
 * drawn at three times their size and scaled down, which is what smooths the stroke's edges.
 *
 * Usage, from frontend/backend (GD is off in XAMPP's php.ini, so it is loaded for this run only):
 *   php -d extension=gd database/seed_employee_signatures.php           replace the sample signatures
 *   php -d extension=gd database/seed_employee_signatures.php --remove  clear the sample signatures only
 *
 * Every image carries a PNG text chunk marking it as a sample. Employees who drew or uploaded their
 * own signature are skipped, and --remove clears only marked images, so a real signature is never
 * overwritten or deleted.
 */

const SAMPLE_SIGNATURE_MARKER = 'HRIS sample signature';
const SAMPLE_SIGNATURE_PREFIX = 'data:image/png;base64,';

/** Black, the same pen colour as the profile's signature pad. */
const SAMPLE_SIGNATURE_INK = [0, 0, 0];

const SAMPLE_SIGNATURE_SUPERSAMPLE = 3;

function signature_is_sample(?string $dataUrl): bool
{
    if ($dataUrl === null || !str_starts_with($dataUrl, SAMPLE_SIGNATURE_PREFIX)) {
        return false;
    }

    $png = base64_decode(substr($dataUrl, strlen(SAMPLE_SIGNATURE_PREFIX)), true);

    return $png !== false && str_contains($png, "Comment\0" . SAMPLE_SIGNATURE_MARKER);
}

/** Adds the sample marker as a tEXt chunk straight after IHDR, which is always the first 33 bytes. */
function signature_mark_png(string $png): string
{
    $data = "Comment\0" . SAMPLE_SIGNATURE_MARKER;
    $chunk = pack('N', strlen($data)) . 'tEXt' . $data . pack('N', crc32('tEXt' . $data));

    return substr($png, 0, 33) . $chunk . substr($png, 33);
}

function signature_rand(float $min, float $max): float
{
    return $min + (mt_rand() / mt_getrandmax()) * ($max - $min);
}

/**
 * A point on the centripetal Catmull-Rom curve between $p1 and $p2. Unlike a uniform one it never
 * overshoots into a cusp or a stray loop where the control points bunch up, as they do round a loop.
 */
function signature_catmull_rom(array $p0, array $p1, array $p2, array $p3, float $t): array
{
    $knot = static fn (array $a, array $b): float => max(1e-4, hypot($b[0] - $a[0], $b[1] - $a[1]) ** 0.5);
    $t0 = 0.0;
    $t1 = $t0 + $knot($p0, $p1);
    $t2 = $t1 + $knot($p1, $p2);
    $t3 = $t2 + $knot($p2, $p3);
    $t = $t1 + ($t2 - $t1) * $t;
    $lerp = static fn (array $a, array $b, float $ta, float $tb): array => [
        (($tb - $t) * $a[0] + ($t - $ta) * $b[0]) / ($tb - $ta),
        (($tb - $t) * $a[1] + ($t - $ta) * $b[1]) / ($tb - $ta),
    ];
    $a1 = $lerp($p0, $p1, $t0, $t1);
    $a2 = $lerp($p1, $p2, $t1, $t2);
    $a3 = $lerp($p2, $p3, $t2, $t3);

    return $lerp($lerp($a1, $a2, $t0, $t2), $lerp($a2, $a3, $t1, $t3), $t1, $t2);
}

/*
 * The letters below are control points for the pen, in units of the x-height, starting from the pen's
 * position $x on the baseline (y = 0, growing downwards). Each returns its points and where the pen
 * ends up, ready for the next letter.
 */

/** A tall looped letter like a cursive l, carried below the baseline into an f's lower loop when $descender > 0. */
function signature_tall_loop(float $x, float $width, float $height, float $descender): array
{
    $points = [
        [$x + 0.30 * $width, -0.15],
        [$x + 0.80 * $width, -0.38 * $height],
        [$x + 1.00 * $width, -0.72 * $height],
        [$x + 0.85 * $width, -0.96 * $height],
        [$x + 0.62 * $width, -$height],
        [$x + 0.44 * $width, -0.88 * $height],
        [$x + 0.42 * $width, -0.55 * $height],
        [$x + 0.52 * $width, -0.20 * $height],
    ];

    if ($descender <= 0) {
        array_push($points, [$x + 0.62 * $width, 0.0], [$x + 0.85 * $width, 0.10]);

        return [$points, $x + $width];
    }

    array_push(
        $points,
        [$x + 0.62 * $width, 0.0],
        [$x + 0.70 * $width, 0.40 * $descender],
        [$x + 0.70 * $width, 0.82 * $descender],
        [$x + 0.56 * $width, $descender],
        [$x + 0.44 * $width, 0.80 * $descender],
        [$x + 0.50 * $width, 0.40 * $descender],
        [$x + 0.75 * $width, 0.02],
        [$x + 1.05 * $width, -0.10],
    );

    return [$points, $x + 1.1 * $width];
}

/** A small arch like the hump of a cursive n. */
function signature_hump(float $x, float $width): array
{
    return [[
        [$x + 0.20 * $width, -0.55],
        [$x + 0.45 * $width, -0.95],
        [$x + 0.68 * $width, -0.65],
        [$x + 0.80 * $width, -0.05],
        [$x + 0.95 * $width, 0.08],
    ], $x + $width];
}

/** A small eyelet like a cursive e. */
function signature_eyelet(float $x, float $width): array
{
    return [[
        [$x + 0.45 * $width, -0.45],
        [$x + 0.70 * $width, -0.95],
        [$x + 0.48 * $width, -1.12],
        [$x + 0.28 * $width, -0.80],
        [$x + 0.38 * $width, -0.15],
        [$x + 0.70 * $width, 0.02],
    ], $x + 0.85 * $width];
}

/**
 * The whole signature: the control points of its one pen stroke, and the dot after it, if any.
 *
 * @return array{0: array<int, array{float, float}>, 1: ?array{float, float}}
 */
function signature_path(): array
{
    $lead = signature_rand(1.2, 2.8);
    $points = [
        [-$lead, signature_rand(0.05, 0.35)],
        [-$lead * 0.55, signature_rand(0.10, 0.30)],
        [-$lead * 0.15, signature_rand(0.0, 0.15)],
    ];

    // A big looped capital, then usually a second tall loop, then up to two small letters.
    [$letter, $x] = signature_tall_loop(0.0, signature_rand(1.1, 1.5), signature_rand(2.8, 3.6), mt_rand(1, 100) <= 60 ? signature_rand(1.5, 2.2) : 0.0);
    array_push($points, ...$letter);

    if (mt_rand(1, 100) <= 70) {
        [$letter, $x] = signature_tall_loop($x, signature_rand(1.0, 1.3), signature_rand(2.4, 3.2), mt_rand(1, 100) <= 15 ? signature_rand(1.3, 1.8) : 0.0);
        array_push($points, ...$letter);
    }

    for ($small = mt_rand(0, 3) - 1; $small > 0; $small--) {
        [$letter, $x] = mt_rand(0, 1) === 0
            ? signature_hump($x, signature_rand(0.7, 1.0))
            : signature_eyelet($x, signature_rand(0.7, 0.9));
        array_push($points, ...$letter);
    }

    // The tail: a long stroke with a slight wave that trails off uphill.
    $length = signature_rand(3.0, 4.6);
    $wave = signature_rand(0.04, 0.14);
    $lift = signature_rand(0.15, 0.5);
    array_push(
        $points,
        [$x + 0.30 * $length, -0.40 - $wave],
        [$x + 0.62 * $length, -0.45 - 0.3 * $lift + $wave],
        [$x + $length, -0.55 - $lift],
    );

    $end = end($points);
    $dot = mt_rand(1, 100) <= 60 ? [$end[0] + signature_rand(0.3, 0.7), $end[1] - signature_rand(0.3, 0.8)] : null;

    return [$points, $dot];
}

function signature_png(array $ink): string
{
    $scale = SAMPLE_SIGNATURE_SUPERSAMPLE;
    [$controls, $dot] = signature_path();

    // A hand never lands exactly where it means to: nudge every control point a little, slant the
    // letters forward, and tilt the whole signature slightly uphill.
    $slant = signature_rand(0.22, 0.42);
    $angle = deg2rad(signature_rand(1.0, 5.0));
    $transform = static fn (array $p): array => [
        ($p[0] - $p[1] * $slant) * cos($angle) + $p[1] * sin($angle),
        -($p[0] - $p[1] * $slant) * sin($angle) + $p[1] * cos($angle),
    ];
    $controls = array_map(
        static fn (array $p): array => $transform([$p[0] + signature_rand(-0.05, 0.05), $p[1] + signature_rand(-0.05, 0.05)]),
        $controls
    );
    $dot = $dot === null ? null : $transform($dot);

    // The curve runs through every control point; the two ends are extended in a straight line so
    // the first and last segments have a neighbour to curve towards.
    $unit = signature_rand(21.0, 25.0) * $scale;
    $count = count($controls);
    $padded = [
        [2 * $controls[0][0] - $controls[1][0], 2 * $controls[0][1] - $controls[1][1]],
        ...$controls,
        [2 * $controls[$count - 1][0] - $controls[$count - 2][0], 2 * $controls[$count - 1][1] - $controls[$count - 2][1]],
    ];
    $samples = [];

    for ($i = 1; $i < $count; $i++) {
        // Sampled closely enough, in pixels, that each dab of the pen overlaps the last.
        $steps = max(2, (int)ceil(hypot($padded[$i + 1][0] - $padded[$i][0], $padded[$i + 1][1] - $padded[$i][1]) * $unit * 1.5));

        for ($step = $i === 1 ? 0 : 1; $step <= $steps; $step++) {
            $samples[] = signature_catmull_rom($padded[$i - 1], $padded[$i], $padded[$i + 1], $padded[$i + 2], $step / $steps);
        }
    }

    $everything = $dot === null ? $samples : [...$samples, $dot];
    $minX = min(array_column($everything, 0));
    $minY = min(array_column($everything, 1));
    $pad = 10 * $scale;
    $width = (int)ceil(((max(array_column($everything, 0)) - $minX) * $unit + 2 * $pad) / $scale) * $scale;
    $height = (int)ceil(((max(array_column($everything, 1)) - $minY) * $unit + 2 * $pad) / $scale) * $scale;
    $toPixel = static fn (array $p): array => [(int)round($pad + ($p[0] - $minX) * $unit), (int)round($pad + ($p[1] - $minY) * $unit)];

    $canvas = imagecreatetruecolor($width, $height);
    imagealphablending($canvas, false);
    // The transparent background is the ink colour, so scaling down leaves no dark or white fringe.
    imagefilledrectangle($canvas, 0, 0, $width - 1, $height - 1, imagecolorallocatealpha($canvas, $ink[0], $ink[1], $ink[2], 127));
    imagealphablending($canvas, true);
    $color = imagecolorallocate($canvas, $ink[0], $ink[1], $ink[2]);

    // Pressure: the pen lands and lifts lightly, so the stroke tapers at both ends.
    $pen = signature_rand(2.3, 3.0) * $scale;
    $total = count($samples);
    $taper = min(40, intdiv($total, 6));

    foreach ($samples as $index => $point) {
        $pressure = min(1.0, ($index + 1) / $taper, ($total - $index) / $taper);
        $diameter = max(2, (int)round($pen * (0.45 + 0.55 * $pressure)));
        [$px, $py] = $toPixel($point);
        imagefilledellipse($canvas, $px, $py, $diameter, $diameter, $color);
    }

    if ($dot !== null) {
        [$px, $py] = $toPixel($dot);
        $diameter = (int)round($pen * 1.9);
        imagefilledellipse($canvas, $px, $py, $diameter, $diameter, $color);
    }

    $image = imagecreatetruecolor(intdiv($width, $scale), intdiv($height, $scale));
    imagealphablending($image, false);
    imagesavealpha($image, true);
    imagefilledrectangle($image, 0, 0, imagesx($image) - 1, imagesy($image) - 1, imagecolorallocatealpha($image, $ink[0], $ink[1], $ink[2], 127));
    imagecopyresampled($image, $canvas, 0, 0, 0, 0, imagesx($image), imagesy($image), $width, $height);

    ob_start();
    imagepng($image, null, 9);

    return (string)ob_get_clean();
}

$host = getenv('HRIS_DB_HOST') ?: '127.0.0.1';
$password = getenv('HRIS_DB_PASSWORD');
$pdo = new PDO(
    'mysql:host=' . $host . ';dbname=' . (getenv('HRIS_DB_NAME') ?: 'hris') . ';charset=utf8mb4',
    getenv('HRIS_DB_USER') ?: 'root',
    $password === false ? '' : $password,
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]
);

$employees = $pdo->query(
    'SELECT id, employee_id, first_name, last_name, e_signature
     FROM employees
     WHERE is_archived = 0
     ORDER BY id'
)->fetchAll();
$update = $pdo->prepare('UPDATE employees SET e_signature = :e_signature WHERE id = :id');

if (in_array('--remove', $argv, true)) {
    $cleared = 0;

    foreach ($employees as $employee) {
        if (signature_is_sample($employee['e_signature'])) {
            $update->execute([':e_signature' => null, ':id' => (int)$employee['id']]);
            $cleared++;
        }
    }

    echo "Cleared {$cleared} sample signatures.\n";
    exit(0);
}

if (!function_exists('imagefilledellipse')) {
    fwrite(STDERR, "GD is required. Run: php -d extension=gd database/seed_employee_signatures.php\n");
    exit(1);
}

$pdo->beginTransaction();

try {
    $signed = 0;

    foreach ($employees as $employee) {
        $existing = trim((string)$employee['e_signature']);

        if ($existing !== '' && !signature_is_sample($existing)) {
            echo "Skipped {$employee['employee_id']} {$employee['first_name']} {$employee['last_name']}: has their own signature.\n";
            continue;
        }

        // Seeded by employee so a re-run draws the same signature.
        mt_srand((int)$employee['id'] * 104729);
        $png = signature_mark_png(signature_png(SAMPLE_SIGNATURE_INK));

        $update->execute([
            ':e_signature' => SAMPLE_SIGNATURE_PREFIX . base64_encode($png),
            ':id' => (int)$employee['id'],
        ]);
        $signed++;
    }

    $pdo->commit();
} catch (Throwable $error) {
    $pdo->rollBack();
    fwrite(STDERR, 'Seeding failed, nothing was written: ' . $error->getMessage() . "\n");
    exit(1);
}

echo "Added sample signatures for {$signed} employees.\n";
