<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

/*
 * Sample IPCR and OPCR records for Performance Management and its dashboard card.
 *
 * IPCR: every Regular employee gets three KPIs from their division's work for each quarter of the
 * current year that has started. A quarter well past its end is rated by the chief; the quarter
 * closing now is mostly submitted with the employee's own ratings, the rest still drafts. Contract
 * of Service staff are left out, as they are not rated under the SPMS.
 *
 * OPCR: every division commits its outputs for each semester that has started, one template and one
 * division assignment per KPI. Each KPI is reported on a planned date spread through the semester;
 * those already past are rated, the rest still assigned. Spreading the dates is also what gives the
 * dashboard card a point in most months, since it groups OPCR by submission month and IPCR by the
 * month the rating period ends.
 *
 * Ratings are whole numbers on the CSC 1-5 scale with A4 and the final rating as their average,
 * exactly what the rating screens save, and each rated KPI carries the matching adjectival remark.
 *
 * Usage, from frontend/backend:
 *   php database/seed_performance.php           replace the sample records
 *   php database/seed_performance.php --remove  delete the sample records only
 *
 * Sample IPCR rows carry SAMPLE_MARKER in the legacy approval_remarks column and sample OPCR
 * templates carry it as their template_status; neither is shown anywhere. Only marked rows are ever
 * replaced or deleted, so records entered through the app are left alone.
 */

const SAMPLE_MARKER = 'Sample';
const SAMPLE_IPCR_MARKER = 'HRIS sample data';

const PROGRAM_GEOHAZARD = 'OO3: ADAPTIVE CAPACITIES OF HUMAN COMMUNITIES AND NATURAL SYSTEMS IMPROVED - PROGRAM 1: GEOLOGICAL RISK REDUCTION AND RESILIENCY PROGRAM';
const PROGRAM_DEVELOPMENT = 'OO1: NATURAL RESOURCES SUSTAINABLY MANAGED - PROGRAM 2: MINERAL RESOURCES AND GEOSCIENCES DEVELOPMENT PROGRAM';
const PROGRAM_ENFORCEMENT = 'OO1: NATURAL RESOURCES SUSTAINABLY MANAGED - PROGRAM 1: MINERAL RESOURCES ENFORCEMENT AND REGULATORY PROGRAM';

/*
 * Each division's outputs. `target` is one employee's range per quarter -- a count to deliver, or
 * for a "100% of ..." indicator the volume that came in. The office's semester target is two
 * staff's worth of the top of that range, unless `officeTarget` fixes it (monthly reports, meetings).
 * `days` is the turnaround the indicator sets, which the accomplishment reports against. {target},
 * {actual} and {days} are filled in.
 */
const SAMPLE_KPIS = [
    'Geosciences' => [
        [
            'category' => 'GROUNDWATER RESOURCE ASSESSMENT',
            'program' => PROGRAM_GEOHAZARD,
            'output' => 'Groundwater resource and vulnerability assessment',
            'indicator' => '{target} municipal groundwater assessment report(s) submitted within 45 working days after fieldwork',
            'accomplishment' => '{actual} groundwater assessment report(s) submitted within {days} working days after fieldwork',
            'target' => [1, 2],
            'days' => 45,
        ],
        [
            'category' => 'LAND GEOLOGICAL ASSESSMENT',
            'program' => PROGRAM_GEOHAZARD,
            'output' => 'Geohazard assessment of barangays (1:10,000 scale)',
            'indicator' => '{target} barangays assessed for landslide and flood susceptibility',
            'accomplishment' => '{actual} barangays assessed; geohazard maps turned over to the LGUs',
            'target' => [4, 8],
            'days' => null,
        ],
        [
            'category' => 'LAND GEOLOGICAL ASSESSMENT',
            'program' => PROGRAM_GEOHAZARD,
            'output' => 'Engineering geological and geohazard assessment reports (EGGAR) evaluated',
            'indicator' => '100% of EGGAR applications evaluated within 15 working days upon receipt',
            'accomplishment' => '{actual} EGGAR applications evaluated within an average of {days} working days',
            'target' => [3, 8],
            'days' => 15,
        ],
        [
            'category' => 'SUPPORT TO OPERATIONS',
            'program' => PROGRAM_GEOHAZARD,
            'output' => 'Geohazard information, education and communication (IEC) campaigns',
            'indicator' => '{target} IEC campaigns conducted with partner LGUs and schools',
            'accomplishment' => '{actual} IEC campaigns conducted with partner LGUs and schools',
            'target' => [1, 3],
            'days' => null,
        ],
    ],
    'Mine Management Division' => [
        [
            'category' => 'MINING TENEMENT EVALUATION',
            'program' => PROGRAM_ENFORCEMENT,
            'output' => 'Mining tenement applications evaluated',
            'indicator' => '100% of mining tenement applications evaluated within 30 working days upon receipt',
            'accomplishment' => '{actual} tenement applications evaluated within an average of {days} working days',
            'target' => [2, 6],
            'days' => 30,
        ],
        [
            'category' => 'MONITORING AND TECHNICAL SERVICES',
            'program' => PROGRAM_ENFORCEMENT,
            'output' => 'Operating mines monitored for compliance',
            'indicator' => '{target} mining tenements inspected and monitoring reports submitted',
            'accomplishment' => '{actual} mining tenements inspected; monitoring reports submitted',
            'target' => [3, 6],
            'days' => null,
        ],
        [
            'category' => 'MINERAL LAND SURVEY',
            'program' => PROGRAM_ENFORCEMENT,
            'output' => 'Survey returns verified',
            'indicator' => '100% of survey returns verified within 20 working days upon receipt',
            'accomplishment' => '{actual} survey returns verified within an average of {days} working days',
            'target' => [2, 5],
            'days' => 20,
        ],
        [
            'category' => 'SMALL-SCALE MINING REGULATION',
            'program' => PROGRAM_DEVELOPMENT,
            'output' => 'Minahang Bayan and small-scale mining applications processed',
            'indicator' => '{target} small-scale mining applications processed',
            'accomplishment' => '{actual} small-scale mining applications processed and endorsed',
            'target' => [1, 3],
            'days' => null,
        ],
    ],
    'Mine Safety, Environment and Social Development Division' => [
        [
            'category' => 'MINE SAFETY AND HEALTH MONITORING',
            'program' => PROGRAM_ENFORCEMENT,
            'output' => 'Mine safety and health inspections conducted',
            'indicator' => '{target} mine safety and health inspections conducted, reports submitted within 10 working days',
            'accomplishment' => '{actual} inspections conducted; reports submitted within {days} working days',
            'target' => [3, 6],
            'days' => 10,
        ],
        [
            'category' => 'MINE ENVIRONMENTAL PROTECTION',
            'program' => PROGRAM_ENFORCEMENT,
            'output' => 'Annual EPEP and final mine rehabilitation plans evaluated',
            'indicator' => '100% of AEPEP submissions evaluated within 20 working days upon receipt',
            'accomplishment' => '{actual} AEPEP submissions evaluated within an average of {days} working days',
            'target' => [2, 5],
            'days' => 20,
        ],
        [
            'category' => 'SOCIAL DEVELOPMENT MONITORING',
            'program' => PROGRAM_ENFORCEMENT,
            'output' => 'Social Development and Management Program (SDMP) implementation monitored',
            'indicator' => '{target} SDMP monitoring reports submitted',
            'accomplishment' => '{actual} SDMP monitoring reports submitted',
            'target' => [2, 4],
            'days' => null,
        ],
        [
            'category' => 'MINE WASTE AND TAILINGS MANAGEMENT',
            'program' => PROGRAM_ENFORCEMENT,
            'output' => 'Mine waste and tailings storage facilities inspected',
            'indicator' => '{target} tailings storage facilities inspected',
            'accomplishment' => '{actual} tailings storage facilities inspected; findings issued to the permit holders',
            'target' => [1, 3],
            'days' => null,
        ],
    ],
    'Finance & Administrative Division' => [
        [
            'category' => 'HUMAN RESOURCE MANAGEMENT',
            'program' => null,
            'output' => 'Appointments and personnel actions processed',
            'indicator' => '100% of appointments and personnel actions processed within 5 working days',
            'accomplishment' => '{actual} personnel actions processed within an average of {days} working days',
            'target' => [8, 20],
            'days' => 5,
            'keywords' => ['hr'],
        ],
        [
            'category' => 'FINANCIAL MANAGEMENT',
            'program' => null,
            'output' => 'Disbursement vouchers processed',
            'indicator' => '100% of disbursement vouchers processed within 3 working days upon receipt of complete documents',
            'accomplishment' => '{actual} disbursement vouchers processed within an average of {days} working days',
            'target' => [60, 150],
            'days' => 3,
            'keywords' => ['account'],
        ],
        [
            'category' => 'BUDGET MANAGEMENT',
            'program' => null,
            'output' => 'Budget and financial accountability reports (BFARs) submitted',
            'indicator' => '{target} monthly BFARs submitted on or before the 10th of the following month',
            'accomplishment' => '{actual} monthly BFARs submitted on or before the deadline',
            'target' => [3, 3],
            'officeTarget' => 6,
            'days' => null,
            'keywords' => ['account', 'chief'],
        ],
        [
            'category' => 'PROCUREMENT AND SUPPLY MANAGEMENT',
            'program' => null,
            'output' => 'Purchase requests acted upon',
            'indicator' => '100% of purchase requests acted upon within 7 working days',
            'accomplishment' => '{actual} purchase requests acted upon within an average of {days} working days',
            'target' => [15, 40],
            'days' => 7,
        ],
        [
            'category' => 'RECORDS MANAGEMENT',
            'program' => null,
            'output' => 'Incoming and outgoing communications recorded and routed',
            'indicator' => '100% of communications recorded and routed within 1 working day',
            'accomplishment' => '{actual} communications recorded and routed within {days} working day(s)',
            'target' => [150, 300],
            'days' => 1,
        ],
    ],
    'Office of the Regional Director' => [
        [
            'category' => 'EXECUTIVE DIRECTION AND MANAGEMENT',
            'program' => null,
            'output' => 'Regional operations directed and monitored',
            'indicator' => '{target} management committee meetings conducted',
            'accomplishment' => '{actual} management committee meetings conducted; action points monitored',
            'target' => [3, 3],
            'officeTarget' => 6,
            'days' => null,
            'keywords' => ['director'],
        ],
        [
            'category' => 'PLANNING AND MONITORING',
            'program' => null,
            'output' => 'Regional physical and financial accomplishment reports',
            'indicator' => 'Quarterly accomplishment report submitted within 10 days after the quarter',
            'accomplishment' => 'Quarterly accomplishment report submitted {days} days after the quarter',
            'target' => [1, 1],
            'days' => 10,
        ],
        [
            'category' => 'LEGAL SERVICES',
            'program' => null,
            'output' => 'Mining disputes and legal cases acted upon',
            'indicator' => '100% of legal cases and complaints acted upon within 15 working days',
            'accomplishment' => '{actual} cases and complaints acted upon within an average of {days} working days',
            'target' => [2, 6],
            'days' => 15,
        ],
        [
            'category' => 'GENERAL ADMINISTRATION AND SUPPORT',
            'program' => null,
            'output' => 'Documents for the Regional Director\'s signature processed',
            'indicator' => '100% of documents routed and released within 1 working day',
            'accomplishment' => '{actual} documents routed and released within {days} working day(s)',
            'target' => [80, 160],
            'days' => 1,
        ],
    ],
];

/** The records-and-communications KPI every administrative post in a technical division carries. */
const SAMPLE_SUPPORT_KPI = [
    'category' => 'SUPPORT TO OPERATIONS',
    'program' => null,
    'output' => 'Division records and communications managed',
    'indicator' => '100% of incoming communications recorded and routed within 1 working day',
    'accomplishment' => '{actual} communications recorded and routed within {days} working day(s)',
    'target' => [60, 140],
    'days' => 1,
];

const SAMPLE_ADMIN_DESIGNATION_WORDS = ['administrative', 'aide', 'clerk', 'support', 'staff'];

const SAMPLE_OPCR_BUDGET_THOUSANDS = [
    'Geosciences' => [350, 1200],
    'Mine Management Division' => [250, 900],
    'Mine Safety, Environment and Social Development Division' => [250, 900],
    'Finance & Administrative Division' => [60, 300],
    'Office of the Regional Director' => [60, 250],
];

/** CSC adjectival rating for an average, with the remark a rater would add. */
function sample_remark(float $average): string
{
    return match (true) {
        $average >= 4.5 => 'Outstanding. Exceeded the target ahead of schedule.',
        $average >= 3.5 => 'Very Satisfactory. Target met with quality outputs.',
        $average >= 2.5 => 'Satisfactory. Target met.',
        $average >= 1.5 => 'Unsatisfactory. Target partially met; coaching recommended.',
        default => 'Poor. Target not met.',
    };
}

/** One whole-number rating around a performer's level. */
function sample_score(float $level): int
{
    return max(2, min(5, (int)round($level + mt_rand(-60, 60) / 100)));
}

/** @return array{int, int, int, float} Quantity, efficiency, timeliness and their average. */
function sample_ratings(float $level): array
{
    $q = sample_score($level);
    $e = sample_score($level);
    $t = sample_score($level);

    return [$q, $e, $t, round(($q + $e + $t) / 3, 2)];
}

/**
 * The accomplishment a set of ratings describes: more delivered for Q, faster turnaround for T. A
 * "100% of ..." KPI reports whatever volume came in that period, so it varies around the range; a
 * fixed deliverable (three monthly reports a quarter) cannot be exceeded, so it reports the target.
 */
function sample_accomplishment(array $kpi, int $target, int $quantity, int $timeliness): string
{
    $actual = match (true) {
        str_starts_with($kpi['indicator'], '100%') => max(1, (int)round($target * mt_rand(80, 130) / 100)),
        $kpi['target'][0] === $kpi['target'][1] => $target,
        default => max(1, (int)round($target * [2 => 0.8, 3 => 1.0, 4 => 1.15, 5 => 1.3][$quantity])),
    };
    $days = $kpi['days'] === null ? 0 : max(1, (int)round($kpi['days'] * [2 => 1.2, 3 => 1.0, 4 => 0.8, 5 => 0.6][$timeliness]));

    return strtr($kpi['accomplishment'], ['{actual}' => (string)$actual, '{days}' => (string)$days]);
}

function sample_indicator(array $kpi, int $target): string
{
    return strtr($kpi['indicator'], ['{target}' => (string)$target]);
}

/** A working-hours timestamp on the given day, never later than $latest. */
function sample_timestamp(DateTimeImmutable $day, DateTimeImmutable $latest): string
{
    $moment = $day->setTime(mt_rand(8, 16), mt_rand(0, 59), mt_rand(0, 59));

    return ($moment > $latest ? $latest : $moment)->format('Y-m-d H:i:s');
}

function sample_person_name(array $row): string
{
    $middle = trim((string)($row['middle_name'] ?? ''));

    return trim(implode(' ', array_filter([
        trim((string)$row['first_name']),
        $middle !== '' ? mb_strtoupper(mb_substr($middle, 0, 1)) . '.' : '',
        trim((string)$row['last_name']),
    ])));
}

/** The three KPIs an employee is rated on: keyword matches first, administrative posts get the support KPI. */
function sample_employee_kpis(string $division, string $designation): array
{
    $library = SAMPLE_KPIS[$division] ?? [];
    $designation = strtolower($designation);
    $chosen = [];

    $isAdministrative = false;
    foreach (SAMPLE_ADMIN_DESIGNATION_WORDS as $word) {
        $isAdministrative = $isAdministrative || str_contains($designation, $word);
    }

    foreach ($library as $kpi) {
        foreach ($kpi['keywords'] ?? [] as $keyword) {
            if (str_contains($designation, $keyword) && !in_array($kpi, $chosen, true)) {
                $chosen[] = $kpi;
            }
        }
    }

    $remaining = array_values(array_filter($library, static fn (array $kpi): bool => !in_array($kpi, $chosen, true)));
    while (count($chosen) < ($isAdministrative && !in_array($division, ['Finance & Administrative Division', 'Office of the Regional Director'], true) ? 2 : 3) && $remaining !== []) {
        $chosen[] = array_splice($remaining, mt_rand(0, count($remaining) - 1), 1)[0];
    }

    if (count($chosen) < 3 && $isAdministrative) {
        $chosen[] = SAMPLE_SUPPORT_KPI;
    }

    return array_slice($chosen, 0, 3);
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

date_default_timezone_set('Asia/Manila');

function sample_remove(PDO $pdo): array
{
    $ipcr = $pdo->prepare('DELETE FROM ipcr WHERE approval_remarks = :marker');
    $ipcr->execute([':marker' => SAMPLE_IPCR_MARKER]);

    $assignments = $pdo->prepare(
        'DELETE doa FROM division_opcr_assignments doa
         INNER JOIN opcr_templates ot ON ot.template_id = doa.template_id
         WHERE ot.template_status = :marker'
    );
    $assignments->execute([':marker' => SAMPLE_MARKER]);

    $templates = $pdo->prepare('DELETE FROM opcr_templates WHERE template_status = :marker');
    $templates->execute([':marker' => SAMPLE_MARKER]);

    return [$ipcr->rowCount(), $assignments->rowCount(), $templates->rowCount()];
}

if (in_array('--remove', $argv, true)) {
    [$ipcrRows, $assignmentRows, $templateRows] = sample_remove($pdo);
    echo "Removed {$ipcrRows} IPCR rows, {$assignmentRows} OPCR assignments and {$templateRows} OPCR templates.\n";
    exit(0);
}

/*
 * opcr.php adds these template columns the first time the OPCR screen is opened (ensure_opcr_tables),
 * so a database nobody has opened it on yet lacks them. Same statements; DDL commits on its own, so
 * this runs before the transaction.
 */
$templateColumns = [
    'semester_indicator' => 'ALTER TABLE opcr_templates ADD COLUMN semester_indicator TEXT NULL AFTER success_indicator',
    'sub_category' => 'ALTER TABLE opcr_templates ADD COLUMN sub_category VARCHAR(255) NULL AFTER category',
];
$columnExists = $pdo->prepare(
    'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = "opcr_templates" AND COLUMN_NAME = :column_name'
);
foreach ($templateColumns as $column => $sql) {
    $columnExists->execute([':column_name' => $column]);
    if ((int)$columnExists->fetchColumn() === 0) {
        $pdo->exec($sql);
    }
}

$now = new DateTimeImmutable('now');
$today = $now->setTime(0, 0);
$year = (int)$today->format('Y');

$employees = $pdo->query(
    'SELECT e.id, e.first_name, e.middle_name, e.last_name, e.employment_status, e.division_id,
            dv.name AS division, des.name AS designation
     FROM employees e
     INNER JOIN divisions dv ON dv.id = e.division_id
     LEFT JOIN designations des ON des.id = e.designation_id
     WHERE e.is_archived = 0
     ORDER BY e.id'
)->fetchAll();

/*
 * Who prepares each division's OPCR (its head) and who approves it (the Regional Director). The
 * Office of the Regional Director's own commitment is prepared by the Assistant Regional Director.
 */
$heads = [];
$approver = '';
foreach ($employees as $employee) {
    $designation = strtolower(trim((string)$employee['designation']));
    if ($designation === 'regional director') {
        $approver = sample_person_name($employee);
    }
    if (in_array($designation, ['division chief', 'chief administrative officer', 'assistant regional director'], true)) {
        $heads[$employee['division']] ??= sample_person_name($employee);
    }
}

$hrUserStatement = $pdo->query(
    'SELECT u.id
     FROM users u
     INNER JOIN employees e ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
     INNER JOIN designations des ON des.id = e.designation_id
     WHERE u.is_archived = 0 AND LOWER(des.name) = "hr officer"
     ORDER BY u.id
     LIMIT 1'
);
$hrUserId = (int)$hrUserStatement->fetchColumn() ?: null;

$insertIpcr = $pdo->prepare(
    'INSERT INTO ipcr
        (employee_id, period_from, period_to, output, success_indicator, kpi_category, program,
         actual_accomplishment, remarks, final_rating, q1_rating, e2_rating, t3_rating, a4_rating,
         submitted_at, status, assigned_by_user_id, approval_remarks, created_at, updated_at)
     VALUES
        (:employee_id, :period_from, :period_to, :output, :success_indicator, :kpi_category, :program,
         :actual_accomplishment, :remarks, :final_rating, :q1_rating, :e2_rating, :t3_rating, :a4_rating,
         :submitted_at, :status, :assigned_by_user_id, :approval_remarks, :created_at, :updated_at)'
);
$insertTemplate = $pdo->prepare(
    'INSERT INTO opcr_templates
        (template_name, category, sub_category, office_division, year_semester, template_status,
         output, success_indicator, semester_indicator, budget, created_at, updated_at)
     VALUES
        (:template_name, :category, :sub_category, :office_division, :year_semester, :template_status,
         :output, :success_indicator, :semester_indicator, :budget, :created_at, :updated_at)'
);
$insertAssignment = $pdo->prepare(
    'INSERT INTO division_opcr_assignments
        (opcr_no, template_id, employee_id, division, period, semester, prepared_by, budget, remarks,
         actual_accomplishment, assignment_status, approved_by, final_rating, q1_rating, e2_rating,
         t3_rating, a4_rating, submitted_at, created_at, updated_at)
     VALUES
        (:opcr_no, :template_id, NULL, :division, :period, :semester, :prepared_by, :budget, :remarks,
         :actual_accomplishment, :assignment_status, :approved_by, :final_rating, :q1_rating, :e2_rating,
         :t3_rating, :a4_rating, :submitted_at, :created_at, :updated_at)'
);

$pdo->beginTransaction();

try {
    sample_remove($pdo);
    $counts = ['ipcr' => 0, 'ipcrRated' => 0, 'ipcrSubmitted' => 0, 'opcr' => 0, 'opcrRated' => 0];

    /* IPCR: one form per Regular employee per quarter that has started. */
    foreach ($employees as $employee) {
        if (strcasecmp((string)$employee['employment_status'], 'Regular') !== 0) {
            continue;
        }

        mt_srand((int)$employee['id'] * 7727);
        $kpis = sample_employee_kpis((string)$employee['division'], (string)$employee['designation']);
        $targets = array_map(static fn (array $kpi): int => mt_rand(...$kpi['target']), $kpis);
        // How strong a performer this is, improving a little each quarter.
        $level = mt_rand(360, 470) / 100;

        for ($quarter = 1; $quarter <= 4; $quarter++) {
            $from = new DateTimeImmutable(sprintf('%d-%02d-01', $year, 3 * $quarter - 2));
            $to = $from->modify('+2 months')->modify('last day of this month');

            if ($from > $today) {
                break;
            }

            // Rated once the chief has had three weeks after the quarter; submitted from two
            // weeks before its close (most staff by now); a draft before that.
            $stage = match (true) {
                $to->modify('+21 days') < $today => 'rated',
                $to->modify('-14 days') <= $today && mt_rand(1, 100) <= 70 => 'submitted',
                default => 'draft',
            };
            $quarterLevel = $level + 0.08 * ($quarter - 1);
            $created = sample_timestamp($from->modify('+' . mt_rand(2, 6) . ' days'), $now);
            $submittedDay = $stage === 'rated'
                ? $to->modify('+' . mt_rand(3, 10) . ' days')
                : $to->modify('-' . mt_rand(1, 8) . ' days');
            $submittedDay = $submittedDay >= $today ? $today->modify('-1 day') : $submittedDay;
            $ratedDay = $to->modify('+' . mt_rand(12, 20) . ' days');

            foreach ($kpis as $index => $kpi) {
                $fields = [
                    ':actual_accomplishment' => null,
                    ':remarks' => null,
                    ':final_rating' => null,
                    ':q1_rating' => null,
                    ':e2_rating' => null,
                    ':t3_rating' => null,
                    ':a4_rating' => null,
                    ':submitted_at' => null,
                    ':updated_at' => $created,
                ];

                if ($stage !== 'draft') {
                    // An employee rates themselves a little higher than their chief does.
                    [$q, $e, $t, $average] = sample_ratings($quarterLevel + ($stage === 'submitted' ? 0.3 : 0));
                    $submitted = sample_timestamp($submittedDay, $now);
                    $fields = [
                        ':actual_accomplishment' => sample_accomplishment($kpi, $targets[$index], $q, $t),
                        ':remarks' => $stage === 'rated' ? sample_remark($average) : null,
                        ':final_rating' => $average,
                        ':q1_rating' => $q,
                        ':e2_rating' => $e,
                        ':t3_rating' => $t,
                        ':a4_rating' => $average,
                        ':submitted_at' => $submitted,
                        ':updated_at' => $stage === 'rated' ? sample_timestamp($ratedDay, $now) : $submitted,
                    ];
                }

                $insertIpcr->execute($fields + [
                    ':employee_id' => (int)$employee['id'],
                    ':period_from' => $from->format('Y-m-d'),
                    ':period_to' => $to->format('Y-m-d'),
                    ':output' => $kpi['output'],
                    ':success_indicator' => sample_indicator($kpi, $targets[$index]),
                    ':kpi_category' => $kpi['category'],
                    ':program' => $kpi['program'],
                    ':status' => $stage,
                    ':assigned_by_user_id' => $hrUserId,
                    ':approval_remarks' => SAMPLE_IPCR_MARKER,
                    ':created_at' => $created,
                ]);
                $counts['ipcr']++;
                $counts['ipcrRated'] += $stage === 'rated' ? 1 : 0;
                $counts['ipcrSubmitted'] += $stage === 'submitted' ? 1 : 0;
            }
        }
    }

    /* OPCR: each division's commitment per semester that has started, one template per KPI. */
    $usedNumbers = [];
    foreach (array_keys(SAMPLE_KPIS) as $divisionIndex => $division) {
        mt_srand(crc32($division));
        [$budgetLow, $budgetHigh] = SAMPLE_OPCR_BUDGET_THOUSANDS[$division];

        foreach (['1st Semester' => 1, '2nd Semester' => 7] as $semester => $firstMonth) {
            $semesterStart = new DateTimeImmutable(sprintf('%d-%02d-01', $year, $firstMonth));
            if ($semesterStart > $today) {
                continue;
            }

            $createdDay = $semesterStart->modify('+' . mt_rand(5, 12) . ' days');
            $created = sample_timestamp($createdDay, $now);

            foreach (SAMPLE_KPIS[$division] as $kpiIndex => $kpi) {
                $semesterTarget = $kpi['officeTarget'] ?? $kpi['target'][1] * 2 * 2;
                $budget = number_format(mt_rand($budgetLow, $budgetHigh) * 1000, 2, '.', '');

                // Reported across five months, staggered by division so each month has some: the
                // first semester's in February to June, the second's from July.
                $reportMonth = $firstMonth + ($firstMonth === 1 ? 1 : 0) + (($kpiIndex + $divisionIndex) % 5);
                $reportDay = (new DateTimeImmutable(sprintf('%d-%02d-01', $year, $reportMonth)))
                    ->modify('+' . mt_rand(2, 24) . ' days');
                $rated = $reportDay < $today;

                $insertTemplate->execute([
                    ':template_name' => $kpi['output'],
                    ':category' => $kpi['program'] ?? $kpi['category'],
                    // "SUPPORT TO OPERATIONS" under the program band reads "Support to Operations".
                    ':sub_category' => $kpi['program'] !== null
                        ? str_replace([' To ', ' And ', ' Of '], [' to ', ' and ', ' of '], ucwords(strtolower($kpi['category'])))
                        : null,
                    ':office_division' => $division,
                    ':year_semester' => "FY {$year} - {$semester}",
                    ':template_status' => SAMPLE_MARKER,
                    ':output' => $kpi['output'],
                    ':success_indicator' => sample_indicator($kpi, $semesterTarget * 2),
                    ':semester_indicator' => sample_indicator($kpi, $semesterTarget),
                    ':budget' => $budget,
                    ':created_at' => $created,
                    ':updated_at' => $created,
                ]);
                $templateId = (int)$pdo->lastInsertId();

                do {
                    $opcrNo = sprintf('OPCR-%s-%04d', $createdDay->format('Ymd'), mt_rand(1, 9999));
                } while (isset($usedNumbers[$opcrNo]));
                $usedNumbers[$opcrNo] = true;

                $fields = [
                    ':remarks' => null,
                    ':actual_accomplishment' => null,
                    ':assignment_status' => 'Assigned',
                    ':approved_by' => null,
                    ':final_rating' => null,
                    ':q1_rating' => null,
                    ':e2_rating' => null,
                    ':t3_rating' => null,
                    ':a4_rating' => null,
                    ':submitted_at' => null,
                    ':updated_at' => $created,
                ];

                if ($rated) {
                    [$q, $e, $t, $average] = sample_ratings(mt_rand(390, 470) / 100);
                    $submitted = sample_timestamp($reportDay, $now);
                    $fields = [
                        ':remarks' => sample_remark($average),
                        ':actual_accomplishment' => sample_accomplishment($kpi, $semesterTarget, $q, $t),
                        ':assignment_status' => 'Rated',
                        ':approved_by' => $approver !== '' ? $approver : null,
                        ':final_rating' => $average,
                        ':q1_rating' => $q,
                        ':e2_rating' => $e,
                        ':t3_rating' => $t,
                        ':a4_rating' => $average,
                        ':submitted_at' => $submitted,
                        ':updated_at' => $submitted,
                    ];
                    $counts['opcrRated']++;
                }

                $insertAssignment->execute($fields + [
                    ':opcr_no' => $opcrNo,
                    ':template_id' => $templateId,
                    ':division' => $division,
                    ':period' => "FY {$year}",
                    ':semester' => $semester,
                    ':prepared_by' => $heads[$division] ?? 'HR Office',
                    ':budget' => $budget,
                    ':created_at' => $created,
                ]);
                $counts['opcr']++;
            }
        }
    }

    $pdo->commit();
} catch (Throwable $error) {
    $pdo->rollBack();
    fwrite(STDERR, 'Seeding failed, nothing was written: ' . $error->getMessage() . "\n");
    exit(1);
}

echo "Seeded {$counts['ipcr']} IPCR KPI rows ({$counts['ipcrRated']} rated, {$counts['ipcrSubmitted']} submitted, the rest drafts)"
    . " and {$counts['opcr']} OPCR KPIs ({$counts['opcrRated']} rated, the rest assigned).\n";
