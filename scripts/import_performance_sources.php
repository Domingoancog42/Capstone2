<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This importer can only be run from the command line.\n");
    exit(1);
}

if ($argc < 3) {
    fwrite(STDERR, "Usage: php scripts/import_performance_sources.php <opcr.csv> <ipcr.csv>\n");
    exit(1);
}

$opcrPath = (string)$argv[1];
$ipcrPath = (string)$argv[2];

function import_csv_rows(string $path): array
{
    if (!is_file($path) || !is_readable($path)) {
        throw new RuntimeException("CSV file is not readable: {$path}");
    }

    $handle = fopen($path, 'rb');
    if ($handle === false) {
        throw new RuntimeException("Unable to open CSV file: {$path}");
    }

    $rows = [];
    try {
        while (($row = fgetcsv($handle, 0, ',', '"', '')) !== false) {
            $rows[] = array_map(
                static fn (mixed $value): string => trim((string)$value, "\xEF\xBB\xBF \t\n\r\0\x0B"),
                $row
            );
        }
    } finally {
        fclose($handle);
    }

    return $rows;
}

function import_cell(array $row, int $index): string
{
    return trim((string)($row[$index] ?? ''));
}

function import_decimal(string $value): ?float
{
    $normalized = str_replace(',', '', trim($value));
    return $normalized !== '' && is_numeric($normalized) ? (float)$normalized : null;
}

function import_period(array $rows): array
{
    $headerText = implode("\n", array_map(static fn (array $row): string => implode(' ', $row), array_slice($rows, 0, 15)));
    if (preg_match('/period\s+([a-z]+)\s+to\s+([a-z]+)[,\s]+(\d{4})/i', $headerText, $matches) !== 1) {
        throw new RuntimeException('The performance period could not be read from the CSV header.');
    }

    $fromMonth = DateTimeImmutable::createFromFormat('!F Y', ucfirst(strtolower($matches[1])) . ' ' . $matches[3]);
    $toMonth = DateTimeImmutable::createFromFormat('!F Y', ucfirst(strtolower($matches[2])) . ' ' . $matches[3]);
    if ($fromMonth === false || $toMonth === false) {
        throw new RuntimeException('The performance period contains an invalid month or year.');
    }

    return [
        'from' => $fromMonth->format('Y-m-01'),
        'to' => $toMonth->modify('last day of this month')->format('Y-m-d'),
        'year' => (int)$matches[3],
        'label' => sprintf('%s to %s %s', $fromMonth->format('F'), $toMonth->format('F'), $matches[3]),
    ];
}

$opcrRows = import_csv_rows($opcrPath);
$ipcrRows = import_csv_rows($ipcrPath);

if (stripos(import_cell($opcrRows[0] ?? [], 0), 'OFFICE PERFORMANCE COMMITMENT AND REVIEW') === false) {
    throw new RuntimeException('The first CSV is not the expected OPCR source.');
}
if (stripos(import_cell($ipcrRows[0] ?? [], 0), 'INDIVIDUAL PERFORMANCE COMMITMENT AND REVIEW') === false) {
    throw new RuntimeException('The second CSV is not the expected IPCR source.');
}

$opcrPeriod = import_period($opcrRows);
$ipcrPeriod = import_period($ipcrRows);
$opcrSource = basename($opcrPath);
$ipcrSource = basename($ipcrPath);

$host = getenv('HRIS_DB_HOST') ?: '127.0.0.1';
$database = getenv('HRIS_DB_NAME') ?: 'hris';
$username = getenv('HRIS_DB_USER') ?: 'root';
$password = getenv('HRIS_DB_PASSWORD');
$password = $password === false ? '' : $password;
$pdo = new PDO(
    "mysql:host={$host};dbname={$database};charset=utf8mb4",
    $username,
    $password,
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]
);

$employeeStatement = $pdo->prepare(
    'SELECT id
     FROM employees
     WHERE is_archived = 0
       AND LOWER(CONCAT_WS(" ", first_name, middle_name, last_name, suffix)) LIKE :employee_name
     ORDER BY id ASC
     LIMIT 1'
);
$employeeStatement->execute([':employee_name' => '%daphne niccole%serojales%']);
$ipcrEmployeeId = (int)$employeeStatement->fetchColumn();
if ($ipcrEmployeeId <= 0) {
    throw new RuntimeException('Daphne Niccole G. Serojales was not found in the employee directory.');
}

$officeDivision = (string)($pdo->query(
    'SELECT name
     FROM divisions
     WHERE is_archived = 0 AND LOWER(name) LIKE "%office of the regional director%"
     ORDER BY id ASC
     LIMIT 1'
)->fetchColumn() ?: 'MGB Regional Office No. X');

$pdo->beginTransaction();

try {
    // Remove only the dashboard examples and prior runs of this importer.
    $pdo->exec('DELETE FROM ipcr WHERE output LIKE "Dashboard monthly performance sample %"');
    $pdo->exec('DELETE FROM division_opcr_assignments WHERE opcr_no LIKE "OPCR-DEMO-%"');
    $pdo->exec(
        'DELETE FROM division_opcr_assignments
         WHERE opcr_no = "OPCR-20260726-3621"
           AND prepared_by = "admin"
           AND remarks = "asd"
           AND actual_accomplishment = "sad"
           AND final_rating = 2.00
           AND mode_of_verification_name IS NULL'
    );
    $pdo->exec(
        'DELETE FROM opcr_templates
         WHERE template_name = "sad"
           AND output = "sad"
           AND success_indicator = "asdasd"
           AND NOT EXISTS (
               SELECT 1
               FROM division_opcr_assignments doa
               WHERE doa.template_id = opcr_templates.template_id
           )'
    );

    $deleteIpcrImport = $pdo->prepare('DELETE FROM ipcr WHERE mode_of_verification_name = :source_name');
    $deleteIpcrImport->execute([':source_name' => $ipcrSource]);

    $deleteOpcrImport = $pdo->prepare('DELETE FROM division_opcr_assignments WHERE mode_of_verification_name = :source_name');
    $deleteOpcrImport->execute([':source_name' => $opcrSource]);

    $deleteImportedTemplates = $pdo->prepare(
        'DELETE FROM opcr_templates
         WHERE template_name LIKE :template_marker'
    );
    $deleteImportedTemplates->execute([
        ':template_marker' => sprintf('Imported OPCR R10 %d row %%', $opcrPeriod['year']),
    ]);

    $insertIpcr = $pdo->prepare(
        'INSERT INTO ipcr
            (employee_id, period_from, period_to, output, success_indicator, kpi_category,
             actual_accomplishment, remarks, final_rating, q1_rating, e2_rating, t3_rating,
             a4_rating, mode_of_verification_name, mode_of_verification_size, submitted_at,
             status, is_archived)
         VALUES
            (:employee_id, :period_from, :period_to, :output, :success_indicator, :kpi_category,
             :actual_accomplishment, :remarks, :final_rating, :q1_rating, :e2_rating, :t3_rating,
             :a4_rating, :source_name, :source_size, :submitted_at, "reviewed", 0)'
    );

    $ipcrCount = 0;
    $ipcrCategory = 'Program';
    $lastIpcrOutput = '';
    foreach ($ipcrRows as $index => $row) {
        $output = import_cell($row, 0);
        if (strcasecmp($output, 'SUPPORT TO OPERATIONS') === 0) {
            $ipcrCategory = 'Support to Operations';
        }
        if ($output !== '') {
            $lastIpcrOutput = $output;
        }

        $q1 = import_decimal(import_cell($row, 4));
        $e2 = import_decimal(import_cell($row, 5));
        $t3 = import_decimal(import_cell($row, 6));
        $a4 = import_decimal(import_cell($row, 7));
        if ($q1 === null || $e2 === null || $t3 === null || $a4 === null || $a4 <= 0) {
            continue;
        }

        $insertIpcr->execute([
            ':employee_id' => $ipcrEmployeeId,
            ':period_from' => $ipcrPeriod['from'],
            ':period_to' => $ipcrPeriod['to'],
            ':output' => $output !== '' ? $output : $lastIpcrOutput,
            ':success_indicator' => import_cell($row, 1),
            ':kpi_category' => $ipcrCategory,
            ':actual_accomplishment' => import_cell($row, 3) ?: null,
            ':remarks' => import_cell($row, 8) ?: null,
            ':final_rating' => $a4,
            ':q1_rating' => $q1,
            ':e2_rating' => $e2,
            ':t3_rating' => $t3,
            ':a4_rating' => $a4,
            ':source_name' => $ipcrSource,
            ':source_size' => filesize($ipcrPath),
            ':submitted_at' => $ipcrPeriod['to'] . ' 17:00:00',
        ]);
        $ipcrCount++;
    }

    $insertTemplate = $pdo->prepare(
        'INSERT INTO opcr_templates
            (template_name, category, office_division, year_semester, template_status,
             output, success_indicator, budget, is_archived)
         VALUES
            (:template_name, :category, :office_division, :year_semester, "Active",
             :output, :success_indicator, :budget, 0)'
    );
    $insertOpcr = $pdo->prepare(
        'INSERT INTO division_opcr_assignments
            (opcr_no, template_id, employee_id, division, period, semester, prepared_by, budget,
             remarks, actual_accomplishment, assignment_status, approved_by, final_rating,
             q1_rating, e2_rating, t3_rating, a4_rating, mode_of_verification_name,
             mode_of_verification_size, submitted_at, is_archived)
         VALUES
            (:opcr_no, :template_id, NULL, :division, :period, :semester, :prepared_by, :budget,
             :remarks, :actual_accomplishment, "Rated", :approved_by, :final_rating,
             :q1_rating, :e2_rating, :t3_rating, :a4_rating, :source_name,
             :source_size, :submitted_at, 0)'
    );

    $opcrCount = 0;
    $opcrCategory = 'Program';
    $lastOpcrOutput = '';
    foreach ($opcrRows as $index => $row) {
        $sourceRow = $index + 1;
        $output = import_cell($row, 0);
        $normalizedOutput = strtolower($output);
        if ($normalizedOutput === 'general administration support and services') {
            $opcrCategory = 'General Administration';
        } elseif ($normalizedOutput === 'support to operations') {
            $opcrCategory = 'Support to Operations';
        }
        if ($output !== '') {
            $lastOpcrOutput = $output;
        }

        $q1 = import_decimal(import_cell($row, 13));
        $e2 = import_decimal(import_cell($row, 14));
        $t3 = import_decimal(import_cell($row, 15));
        $a4 = import_decimal(import_cell($row, 16));
        if (
            $a4 === null
            || $a4 <= 0
            || ($q1 === null && $e2 === null && $t3 === null)
            || in_array($normalizedOutput, ['total overall rating', 'final average rating'], true)
        ) {
            continue;
        }

        $resolvedOutput = $output !== '' ? $output : $lastOpcrOutput;
        $budget = import_decimal(import_cell($row, 7));
        $insertTemplate->execute([
            ':template_name' => sprintf('Imported OPCR R10 %d row %03d', $opcrPeriod['year'], $sourceRow),
            ':category' => $opcrCategory,
            ':office_division' => 'MGB Regional Office No. X',
            ':year_semester' => $opcrPeriod['label'],
            ':output' => $resolvedOutput,
            ':success_indicator' => import_cell($row, 1),
            ':budget' => $budget,
        ]);
        $templateId = (int)$pdo->lastInsertId();

        $insertOpcr->execute([
            ':opcr_no' => sprintf('OPCR-R10-%d-2S-%03d', $opcrPeriod['year'], $sourceRow),
            ':template_id' => $templateId,
            ':division' => $officeDivision,
            ':period' => $opcrPeriod['label'],
            ':semester' => sprintf('2nd Semester CY %d', $opcrPeriod['year']),
            ':prepared_by' => 'FELIZARDO A. GACAD, JR.',
            ':budget' => $budget,
            ':remarks' => import_cell($row, 17) ?: null,
            ':actual_accomplishment' => import_cell($row, 10) ?: null,
            ':approved_by' => 'ATTY. WILFREDO G. MONCANO',
            ':final_rating' => $a4,
            ':q1_rating' => $q1,
            ':e2_rating' => $e2,
            ':t3_rating' => $t3,
            ':a4_rating' => $a4,
            ':source_name' => $opcrSource,
            ':source_size' => filesize($opcrPath),
            ':submitted_at' => $opcrPeriod['to'] . ' 17:00:00',
        ]);
        $opcrCount++;
    }

    if ($ipcrCount === 0 || $opcrCount === 0) {
        throw new RuntimeException('No rated KPI rows were found in one or both source files.');
    }

    $pdo->commit();
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $exception;
}

echo json_encode([
    'success' => true,
    'ipcr' => [
        'source' => $ipcrSource,
        'period' => $ipcrPeriod['label'],
        'employee_id' => $ipcrEmployeeId,
        'rated_rows_imported' => $ipcrCount,
    ],
    'opcr' => [
        'source' => $opcrSource,
        'period' => $opcrPeriod['label'],
        'rated_rows_imported' => $opcrCount,
    ],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
