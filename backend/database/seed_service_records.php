<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

/*
 * Sample CS Form No. 1 histories for the Service Records floating card.
 *
 * Every active employee with no real service record gets a career that ends in their current
 * masterfile appointment: an original appointment on the date hired, a step increment every three
 * years, a promotion into the current designation when the tenure allows one, the salary
 * standardization tranches, and for some a prior government post they transferred or resigned
 * from, or a contract of service before their appointment. Contract of Service staff get one line
 * per yearly contract. Every closed line carries its separation date and cause, so each column of
 * the form is filled; the one open line is the appointment still in force.
 *
 * Past salaries are the 2026 schedule in salarySchedule.js scaled by each year's SG-1 step 1, so
 * they read plausibly without reproducing every historical tranche table. The open line uses the
 * employee's basic salary so the record agrees with Employee Management. LWOP is not seeded: that
 * column is derived from approved leave, and faking it would mean inventing leave applications.
 *
 * Usage, from frontend/backend:
 *   php database/seed_service_records.php           replace the sample rows
 *   php database/seed_service_records.php --remove  delete the sample rows only
 *
 * Rows are written with source = 'sample'. Employees who already have entered, imported, or
 * promotion rows are skipped, so real history is never mixed with invented lines.
 */

const SAMPLE_SOURCE = 'sample';
const SAMPLE_MGB_BRANCH = 'Mines and Geosciences Bureau';

/** EO No. 64, s. 2024 third tranche (2026) -- the same table as salarySchedule.js. */
const SAMPLE_SALARY_SCHEDULE = [
    1 => [14634, 14730, 14849, 14968, 15089, 15211, 15333, 15456],
    2 => [15522, 15636, 15752, 15869, 15986, 16103, 16223, 16342],
    3 => [16486, 16610, 16732, 16856, 16982, 17106, 17234, 17360],
    4 => [17536, 17636, 17767, 17898, 18031, 18163, 18298, 18433],
    5 => [18581, 18720, 18858, 18998, 19137, 19280, 19423, 19565],
    6 => [19716, 19862, 20009, 20158, 20307, 20456, 20609, 20761],
    7 => [20914, 21069, 21224, 21382, 21539, 21699, 21859, 22022],
    8 => [22423, 22627, 22832, 23038, 23246, 23456, 23668, 23883],
    9 => [24329, 24523, 24720, 24917, 25117, 25318, 25521, 25725],
    10 => [26917, 27131, 27347, 27565, 27786, 28007, 28230, 28456],
    11 => [31705, 31820, 32109, 32401, 32697, 32998, 33302, 33611],
    12 => [33947, 34069, 34357, 34648, 34943, 35242, 35544, 35850],
    13 => [36125, 36283, 36599, 36919, 37244, 37572, 37904, 38241],
    14 => [38764, 39141, 39523, 39910, 40300, 40696, 41097, 41503],
    15 => [42178, 42594, 43015, 43442, 43874, 44310, 44753, 45202],
    16 => [45694, 46152, 46615, 47084, 47559, 48040, 48528, 49020],
    17 => [49562, 50066, 50576, 51092, 51614, 52144, 52678, 53221],
    18 => [53818, 54371, 54933, 55499, 56075, 56657, 57246, 57842],
    19 => [59153, 59966, 60793, 61632, 62486, 63353, 64236, 65132],
    20 => [66052, 66970, 67904, 68853, 69818, 70772, 71727, 72671],
    21 => [73303, 74337, 75388, 76456, 77542, 78645, 79692, 80831],
    22 => [81796, 82963, 84151, 85356, 86582, 87746, 89011, 90295],
    23 => [91306, 92622, 93962, 95330, 96823, 98341, 99883, 101318],
    24 => [102603, 104209, 105841, 107500, 109185, 110898, 112533, 114301],
    25 => [116643, 118469, 120326, 122212, 124131, 126079, 128061, 130073],
    26 => [131807, 133870, 135968, 138100, 140268, 142469, 144707, 146983],
    27 => [148940, 151273, 153644, 155906, 158353, 160235, 162752, 165310],
    28 => [167129, 169752, 172418, 174797, 177545, 180339, 182660, 185537],
    29 => [187531, 190482, 193496, 196528, 199624, 202005, 205191, 208430],
    30 => [210718, 214038, 217207, 220425, 223691, 227224, 230595, 234123],
    31 => [300961, 306691, 312532, 318182, 323938, 329989, 336092, 342310],
    32 => [356237, 363257, 370418, 377359, 384805, 392400, 400150, 408055],
    33 => [449157, 462329],
];

/** SG-1 step 1 of the tranche in force from each year on; years before 2009 use 5,082. */
const SAMPLE_BASE_SALARY_BY_YEAR = [
    2009 => 6968, 2010 => 7294, 2011 => 7831, 2012 => 9000, 2016 => 9478, 2017 => 9981,
    2018 => 10510, 2019 => 11068, 2020 => 11551, 2021 => 12034, 2022 => 12517, 2023 => 13000,
    2024 => 13530, 2025 => 14061, 2026 => 14634,
];

/** The salary laws that open a new line on the form, by effectivity date. */
const SAMPLE_SALARY_ADJUSTMENTS = [
    '2016-01-01' => 'Salary adjustment per EO No. 201, s. 2016 (SSL IV), 1st tranche',
    '2020-01-01' => 'Salary adjustment per RA 11466 (SSL V), 1st tranche',
    '2024-01-01' => 'Salary adjustment per EO No. 64, s. 2024 (SSL VI), 1st tranche',
    '2026-01-01' => 'Salary adjustment per EO No. 64, s. 2024 (SSL VI), 3rd tranche',
];

/**
 * The position held before a promotion into each current designation, keyed by the lowercased
 * designation. A nested array picks by division where the career path differs between divisions.
 */
const SAMPLE_ENTRY_TITLES = [
    'accountant' => 'Administrative Assistant III (Senior Bookkeeper)',
    'accounting clerk' => 'Administrative Aide VI',
    'accounting supervisor' => 'Accountant',
    'administrative aide' => 'Administrative Aide III',
    'administrative assistant' => 'Administrative Aide VI',
    'administrative assistant i' => 'Administrative Aide IV',
    'administrative assistant ii' => 'Administrative Assistant I',
    'administrative assistant iii' => 'Administrative Assistant II',
    'assistant regional director' => 'Chief Administrative Officer',
    'cartographer ii' => 'Cartographer I',
    'chief administrative officer' => 'Administrative Officer V / Chief, Administrative Section',
    'division chief' => [
        'Geosciences' => 'Supervising Geologist',
        'Mine Management Division' => 'Engineer IV / Chief, Mine Tenement Evaluation Section',
        'Mine Safety, Environment and Social Development Division' => 'Supervising Science Research Specialist',
        '' => 'Engineer IV',
    ],
    'engineer' => [
        'Mine Management Division' => 'Mining Claims Examiner II',
        '' => 'Engineer I',
    ],
    'engineer v' => 'Engineer IV',
    'field staff' => 'Geologic Aide',
    'hr officer' => 'Administrative Assistant II (HRM Assistant)',
    'hr staff' => 'Administrative Aide VI',
    'regional director' => 'Assistant Regional Director',
    'science research specialist ii' => 'Science Research Specialist I',
    'support staff' => 'Administrative Aide I',
    'unit head' => [
        'Geosciences' => 'Senior Geologist',
        'Mine Management Division' => 'Engineer III',
        'Mine Safety, Environment and Social Development Division' => 'Senior Science Research Specialist',
        '' => 'Administrative Officer III',
    ],
];

const SAMPLE_DENR_STATIONS = [
    'DENR Regional Office No. X',
    'DENR-PENRO Misamis Oriental',
    'DENR-PENRO Bukidnon',
    'DENR-CENRO Manolo Fortich',
    'DENR-CENRO Initao',
];

const SAMPLE_DENR_TITLES = ['Administrative Aide III', 'Administrative Aide IV', 'Forest Ranger', 'Engineering Assistant'];

const SAMPLE_LGU_STATIONS = [
    'City Government of Cagayan de Oro',
    'City Government of El Salvador',
    'Municipal Government of Opol',
    'Municipal Government of Tagoloan',
    'Provincial Government of Bukidnon',
];

const SAMPLE_LGU_TITLES = ['Administrative Aide IV', 'Engineering Aide', 'Planning Assistant', 'Revenue Collection Clerk I'];

/** Why a line closed, named after whatever opened the line after it. */
const SAMPLE_CAUSE_BY_NEXT_KIND = [
    'step' => 'Step Increment',
    'promotion' => 'Promotion',
    'salary' => 'Salary Adjustment',
    'renewal' => 'End of Contract',
];

function sample_pick(array $values): string
{
    return $values[mt_rand(0, count($values) - 1)];
}

/** "Chief administrative officer" -> "Chief Administrative Officer", keeping numerals and acronyms. */
function sample_title(string $title): string
{
    $words = preg_split('/(\s+)/', trim($title), -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];

    foreach ($words as $index => $word) {
        $lower = strtolower($word);

        if (in_array($lower, ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'hr', 'oic', 'gis'], true)) {
            $words[$index] = strtoupper($word);
        } elseif ($index > 0 && in_array($lower, ['of', 'and', 'the'], true)) {
            $words[$index] = $lower;
        } elseif ($word === $lower) {
            $words[$index] = ucfirst($word);
        }
    }

    return implode('', $words);
}

function sample_entry_title(string $currentTitle, string $division): string
{
    $entry = SAMPLE_ENTRY_TITLES[strtolower($currentTitle)] ?? 'Administrative Aide IV';

    return is_array($entry) ? ($entry[$division] ?? $entry['']) : $entry;
}

/** @return array{int, int} The grade and step whose 2026 rate is closest to the salary. */
function sample_nearest_grade_step(float $salary): array
{
    $best = [1, 1];
    $bestGap = INF;

    foreach (SAMPLE_SALARY_SCHEDULE as $grade => $steps) {
        foreach ($steps as $index => $rate) {
            $gap = abs($rate - $salary);

            if ($gap < $bestGap) {
                $best = [$grade, $index + 1];
                $bestGap = $gap;
            }
        }
    }

    return $best;
}

function sample_year_factor(int $year): float
{
    $base = 5082;

    foreach (SAMPLE_BASE_SALARY_BY_YEAR as $fromYear => $salary) {
        if ($year >= $fromYear) {
            $base = $salary;
        }
    }

    return $base / SAMPLE_BASE_SALARY_BY_YEAR[2026];
}

function sample_salary(int $grade, int $step, DateTimeImmutable $from): string
{
    $steps = SAMPLE_SALARY_SCHEDULE[$grade];
    $rate = $steps[min($step, count($steps)) - 1];

    return number_format(round($rate * sample_year_factor((int)$from->format('Y'))), 2, '.', '');
}

/** Splits whichever line a salary law took effect in, so the new rate opens its own line. */
function sample_apply_salary_adjustments(array $lines, DateTimeImmutable $today): array
{
    foreach (SAMPLE_SALARY_ADJUSTMENTS as $date => $remarks) {
        $effective = new DateTimeImmutable($date);

        if ($effective <= $lines[0]['from'] || $effective > $today) {
            continue;
        }

        $holder = null;

        foreach ($lines as $index => $line) {
            if ($line['from'] <= $effective) {
                $holder = $index;
            }
        }

        if ($holder === null || $lines[$holder]['from'] == $effective || isset($lines[$holder]['to'])) {
            continue;
        }

        array_splice($lines, $holder + 1, 0, [array_merge($lines[$holder], [
            'from' => $effective,
            'kind' => 'salary',
            'remarks' => $remarks,
        ])]);
    }

    return $lines;
}

/**
 * A plantilla career ending in the current designation at the grade and step nearest the basic
 * salary. The current designation started at step 1 and gained a step every three years, which
 * places the promotion into it. When that date falls too close to the hire date, a long-serving
 * employee is promoted midway instead, and anyone else held the designation from the start -- one
 * who started it above step 1 is shown transferring in.
 */
function sample_regular_history(array $employee, DateTimeImmutable $today, array $designationIds): array
{
    $hired = new DateTimeImmutable($employee['dateHired']);
    $division = (string)$employee['division'];
    $divisionId = $employee['divisionId'];
    $currentTitle = sample_title((string)$employee['designation']);
    [$grade, $step] = sample_nearest_grade_step((float)$employee['basicSalary']);
    $yearsOfService = $hired->diff($today)->y;

    $promotedOn = $today
        ->modify('-' . (3 * ($step - 1)) . ' years')
        ->modify('-' . mt_rand(1, 30) . ' months')
        ->modify('first day of this month');
    $startStep = 1;

    if ($promotedOn < $hired->modify('+2 years')) {
        // Too little service for that path: promoted midway, keeping the step the salary implies,
        // or in the designation from the start.
        $promotedOn = $yearsOfService >= 5 && mt_rand(1, 100) <= 70
            ? $hired
                ->modify('+' . intdiv($yearsOfService * mt_rand(40, 60), 100) . ' years')
                ->modify('+' . mt_rand(0, 11) . ' months')
                ->modify('first day of this month')
            : null;
        $startStep = max(1, $step - intdiv(($promotedOn ?? $hired)->diff($today)->y, 3));
    }

    $promoted = $promotedOn !== null;
    $mgbLine = static fn (array $fields): array => array_merge([
        'status' => 'Regular',
        'station' => $division,
        'branch' => SAMPLE_MGB_BRANCH,
        'divisionId' => $divisionId,
    ], $fields);
    $lines = [];

    if ($promoted) {
        $entryTitle = sample_entry_title($currentTitle, $division);
        $entryGrade = max(1, $grade - mt_rand(2, 4));

        for ($years = 0; ($from = $hired->modify("+{$years} years")) < $promotedOn; $years += 3) {
            $lines[] = $mgbLine([
                'from' => $from,
                'kind' => $years === 0 ? 'original' : 'step',
                'title' => $entryTitle,
                'grade' => $entryGrade,
                'step' => min(8, 1 + intdiv($years, 3)),
                'designationId' => $designationIds[$divisionId][strtolower($entryTitle)] ?? null,
                'remarks' => $years === 0 ? 'Original Appointment' : 'Step Increment due to length of service',
            ]);
        }

        $currentStart = $promotedOn;
        $lines[] = $mgbLine([
            'from' => $promotedOn,
            'kind' => 'promotion',
            'title' => $currentTitle,
            'grade' => $grade,
            'step' => $startStep,
            'designationId' => $employee['designationId'],
            'remarks' => "Promoted from {$entryTitle}",
        ]);
    } else {
        $currentStart = $hired;
        $lines[] = $mgbLine([
            'from' => $hired,
            'kind' => 'original',
            'title' => $currentTitle,
            'grade' => $grade,
            'step' => $startStep,
            'designationId' => $employee['designationId'],
            'remarks' => 'Original Appointment',
        ]);
    }

    for ($next = $startStep + 1; $next <= $step; $next++) {
        $from = $currentStart->modify('+' . (3 * ($next - $startStep)) . ' years');

        if ($from > $today) {
            break;
        }

        $lines[] = $mgbLine([
            'from' => $from,
            'kind' => 'step',
            'title' => $currentTitle,
            'grade' => $grade,
            'step' => $next,
            'designationId' => $employee['designationId'],
            'remarks' => 'Step Increment due to length of service',
        ]);
    }

    $lines = sample_apply_salary_adjustments($lines, $today);

    // Earlier service elsewhere. Anyone appointed above step 1 brought it with them on transfer.
    $roll = mt_rand(1, 100);
    $prior = !$promoted && $startStep > 1 ? 'transfer' : null;

    if ($prior === null && (int)$hired->format('Y') <= 2020) {
        $prior = match (true) {
            $roll <= 20 => 'transfer',
            $roll <= 35 => 'resignation',
            $roll <= 50 => 'contract',
            default => null,
        };
    }

    $first = $lines[0];

    if ($prior === 'transfer') {
        $lateral = !$promoted && $startStep > 1;
        $station = sample_pick(SAMPLE_DENR_STATIONS);
        $lines[0]['remarks'] = "Transfer from {$station}";
        array_unshift($lines, [
            'from' => $hired->modify('-' . mt_rand(14, 34) . ' months')->modify('first day of this month'),
            'to' => $hired->modify('-1 day'),
            'cause' => 'Transferred to MGB Region X',
            'kind' => 'original',
            'title' => $lateral ? $currentTitle : sample_pick(SAMPLE_DENR_TITLES),
            'status' => 'Regular',
            'grade' => $lateral ? $grade : max(1, $first['grade'] - mt_rand(0, 1)),
            'step' => $lateral ? $startStep : 1,
            'station' => $station,
            'branch' => 'Department of Environment and Natural Resources',
            'designationId' => null,
            'divisionId' => null,
            'remarks' => 'Original Appointment',
        ]);
    } elseif ($prior === 'resignation') {
        $resignedOn = $hired->modify('-' . mt_rand(1, 6) . ' months')->modify('last day of this month');
        array_unshift($lines, [
            'from' => $resignedOn->modify('-' . mt_rand(14, 34) . ' months')->modify('first day of next month'),
            'to' => $resignedOn,
            'cause' => 'Resignation',
            'kind' => 'original',
            'title' => sample_pick(SAMPLE_LGU_TITLES),
            'status' => 'Regular',
            'grade' => max(1, $first['grade'] - mt_rand(1, 2)),
            'step' => 1,
            'station' => sample_pick(SAMPLE_LGU_STATIONS),
            'branch' => 'Local Government Unit',
            'designationId' => null,
            'divisionId' => null,
            'remarks' => 'Original Appointment',
        ]);
    } elseif ($prior === 'contract') {
        $from = $hired->modify('-' . mt_rand(6, 24) . ' months')->modify('first day of this month');
        array_unshift($lines, array_merge($first, [
            'from' => $from,
            'to' => $hired->modify('-1 day'),
            'cause' => 'End of Contract',
            'kind' => 'original',
            'status' => 'Contract of Service',
            'step' => null,
            'remarks' => sprintf('Contract of Service No. %s-%03d', $from->format('Y'), mt_rand(1, 250)),
        ]));
    }

    return $lines;
}

/** One line per yearly contract: the hire date to year end, then each calendar year after. */
function sample_contract_history(array $employee, DateTimeImmutable $today): array
{
    [$grade] = sample_nearest_grade_step((float)$employee['basicSalary']);
    $title = sample_title((string)$employee['designation']);
    $lines = [];

    for ($from = new DateTimeImmutable($employee['dateHired']); $from <= $today;) {
        $year = (int)$from->format('Y');
        $contract = sprintf('Contract of Service No. %d-%03d', $year, mt_rand(1, 250));
        $lines[] = [
            'from' => $from,
            'kind' => $lines ? 'renewal' : 'original',
            'title' => $title,
            'status' => 'Contract of Service',
            'grade' => $grade,
            'step' => null,
            'station' => (string)$employee['division'],
            'branch' => SAMPLE_MGB_BRANCH,
            'designationId' => $employee['designationId'],
            'divisionId' => $employee['divisionId'],
            'salary' => number_format(round((float)$employee['basicSalary'] * sample_year_factor($year)), 2, '.', ''),
            'remarks' => $lines ? "Renewed, {$contract}" : $contract,
        ];
        $from = new DateTimeImmutable(($year + 1) . '-01-01');
    }

    return $lines;
}

/** Fills each line's end date, separation, and salary from the line that follows it. */
function sample_finish_lines(array $lines, string $currentSalary): array
{
    $count = count($lines);

    foreach ($lines as $index => &$line) {
        $next = $lines[$index + 1] ?? null;
        $to = $line['to'] ?? ($next ? $next['from']->modify('-1 day') : null);

        $line['to'] = $to;
        $line['separationDate'] = $to;
        $line['cause'] = $to === null ? null : ($line['cause'] ?? SAMPLE_CAUSE_BY_NEXT_KIND[$next['kind']]);

        if ($index === $count - 1) {
            $line['salary'] = $currentSalary;
        } elseif (!isset($line['salary'])) {
            $line['salary'] = sample_salary($line['grade'], $line['step'] ?? 1, $line['from']);
        }
    }
    unset($line);

    return $lines;
}

date_default_timezone_set('Asia/Manila');

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

$removed = $pdo->prepare('DELETE FROM service_records WHERE source = :source');

if (in_array('--remove', $argv, true)) {
    $removed->execute([':source' => SAMPLE_SOURCE]);
    echo "Removed {$removed->rowCount()} sample service record lines.\n";
    exit(0);
}

$today = new DateTimeImmutable('today');

$designationIds = [];
foreach ($pdo->query('SELECT id, division_id, name FROM designations WHERE is_archived = 0') as $row) {
    $designationIds[(int)$row['division_id']][strtolower(trim((string)$row['name']))] ??= (int)$row['id'];
}

$employees = $pdo->query(
    'SELECT e.id, e.employee_id AS employeeCode, e.first_name AS firstName, e.last_name AS lastName,
            e.date_hired AS dateHired, e.employment_status AS employmentStatus, e.status,
            e.basic_salary AS basicSalary, e.designation_id AS designationId,
            e.division_id AS divisionId, d.name AS designation, dv.name AS division
     FROM employees e
     LEFT JOIN designations d ON d.id = e.designation_id
     LEFT JOIN divisions dv ON dv.id = e.division_id
     WHERE e.is_archived = 0
     ORDER BY e.id'
)->fetchAll();

$insert = $pdo->prepare(
    'INSERT INTO service_records
        (employee_record_id, service_from, service_to, designation_title, employment_status,
         monthly_salary, salary_grade, step_increment, station, branch, separation_date,
         separation_cause, remarks, designation_id, division_id, source)
     VALUES
        (:employee_record_id, :service_from, :service_to, :designation_title, :employment_status,
         :monthly_salary, :salary_grade, :step_increment, :station, :branch, :separation_date,
         :separation_cause, :remarks, :designation_id, :division_id, :source)'
);

$pdo->beginTransaction();

try {
    $removed->execute([':source' => SAMPLE_SOURCE]);

    $withRealHistory = array_flip(array_map('intval', $pdo->query(
        'SELECT DISTINCT employee_record_id FROM service_records WHERE is_archived = 0'
    )->fetchAll(PDO::FETCH_COLUMN)));

    $seededEmployees = 0;
    $seededLines = 0;

    foreach ($employees as $employee) {
        $name = trim("{$employee['firstName']} {$employee['lastName']}");
        $hired = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$employee['dateHired']);
        $skip = match (true) {
            isset($withRealHistory[(int)$employee['id']]) => 'already has service record entries',
            in_array(strtolower((string)$employee['status']), ['retired', 'resigned'], true) => 'is separated',
            $hired === false || $hired > $today => 'has no usable date hired',
            trim((string)$employee['designation']) === '' || trim((string)$employee['division']) === '' => 'has no designation or division',
            (float)$employee['basicSalary'] <= 0 => 'has no basic salary',
            default => null,
        };

        if ($skip !== null) {
            echo "Skipped {$employee['employeeCode']} {$name}: {$skip}.\n";
            continue;
        }

        // Seeded by employee so a re-run writes the same history.
        mt_srand((int)$employee['id'] * 7919);
        $employee['divisionId'] = (int)$employee['divisionId'];
        $employee['designationId'] = (int)$employee['designationId'];

        $lines = strcasecmp((string)$employee['employmentStatus'], 'Regular') === 0
            ? sample_regular_history($employee, $today, $designationIds)
            : sample_contract_history($employee, $today);
        $lines = sample_finish_lines($lines, number_format((float)$employee['basicSalary'], 2, '.', ''));

        foreach ($lines as $line) {
            $insert->execute([
                ':employee_record_id' => (int)$employee['id'],
                ':service_from' => $line['from']->format('Y-m-d'),
                ':service_to' => $line['to']?->format('Y-m-d'),
                ':designation_title' => $line['title'],
                ':employment_status' => $line['status'],
                ':monthly_salary' => $line['salary'],
                ':salary_grade' => (string)$line['grade'],
                ':step_increment' => $line['step'] === null ? null : (string)$line['step'],
                ':station' => $line['station'],
                ':branch' => $line['branch'],
                ':separation_date' => $line['separationDate']?->format('Y-m-d'),
                ':separation_cause' => $line['cause'],
                ':remarks' => $line['remarks'],
                ':designation_id' => $line['designationId'] ?: null,
                ':division_id' => $line['divisionId'] ?: null,
                ':source' => SAMPLE_SOURCE,
            ]);
        }

        $seededEmployees++;
        $seededLines += count($lines);
    }

    $pdo->commit();
} catch (Throwable $error) {
    $pdo->rollBack();
    fwrite(STDERR, 'Seeding failed, nothing was written: ' . $error->getMessage() . "\n");
    exit(1);
}

echo "Seeded {$seededLines} service record lines for {$seededEmployees} employees.\n";
