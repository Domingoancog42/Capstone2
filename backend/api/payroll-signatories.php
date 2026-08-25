<?php
declare(strict_types=1);

/*
 * Who signs a payroll register.
 *
 * The four names on the certification used to be typed into the code. They are people, and people
 * move on, so they are held here instead: an administrator picks an employee for each slot in
 * Settings, and the name printed on the screen and in the exported workbook is read back from that
 * employee's own record.
 *
 * The *titles* are not configurable. They name the office the form requires a signature from
 * ("OIC, Regional Director"), not the person's own designation, and they are part of the printed
 * form rather than of the staffing.
 */

const PAYROLL_SIGNATORY_SETTING_KEY = 'payroll_signatories';

/* The division whose chief certifies box A when nothing has been picked yet. */
const PAYROLL_SIGNATORY_FINANCE_DIVISION_HINTS = ['finance', 'administrative'];

/**
 * The four slots, in the order the certification lays them out.
 *
 * `placement` says where the slot is drawn: `box` slots are the lettered certifications down the
 * left, `side` slots are the officers alongside them.
 */
function payroll_signatory_slots(): array
{
    return [
        'certifiedServices' => [
            'box' => 'A',
            'statement' => '',
            'title' => 'Chief, Finance and Administrative Division',
            'placement' => 'box',
            'description' => 'Certifies that services were duly rendered.',
        ],
        'certifiedSupporting' => [
            'box' => 'B',
            'statement' => '',
            'title' => 'Administrative Officer IV/OIC, Finance Section',
            'placement' => 'box',
            'description' => 'Certifies the supporting documents and available cash.',
        ],
        'approvedBy' => [
            'box' => '',
            'statement' => '',
            'title' => 'OIC, Regional Director',
            'placement' => 'side',
            'description' => 'Approves the payroll for payment.',
        ],
        'paidBy' => [
            'box' => '',
            'statement' => '',
            'title' => 'Administrative Officer III (Cashier)',
            'placement' => 'side',
            'description' => 'Pays out the payroll.',
        ],
    ];
}

function payroll_signatory_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

/** The stored picks: slot key => employee record id, with anything unrecognised dropped. */
function payroll_signatory_selection(PDO $pdo): array
{
    $stored = json_decode(get_application_setting($pdo, PAYROLL_SIGNATORY_SETTING_KEY, ''), true);
    $selection = [];

    foreach (array_keys(payroll_signatory_slots()) as $key) {
        $employeeRecordId = is_array($stored) ? (int)($stored[$key] ?? 0) : 0;
        $selection[$key] = $employeeRecordId > 0 ? $employeeRecordId : null;
    }

    return $selection;
}

function payroll_signatory_store_selection(PDO $pdo, array $selection): array
{
    $clean = [];

    foreach (array_keys(payroll_signatory_slots()) as $key) {
        $employeeRecordId = (int)($selection[$key] ?? 0);
        $clean[$key] = $employeeRecordId > 0 ? $employeeRecordId : null;
    }

    $encoded = json_encode($clean, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encoded === false) {
        throw new RuntimeException('Unable to encode payroll signatories.');
    }

    store_application_setting($pdo, PAYROLL_SIGNATORY_SETTING_KEY, $encoded);

    return $clean;
}

/** One employee's name and designation, or null when the record is gone or archived. */
function payroll_signatory_employee(PDO $pdo, ?int $employeeRecordId): ?array
{
    if ($employeeRecordId === null || $employeeRecordId <= 0) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT
            e.id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS name,
            des.name AS designation,
            d.name AS division
         FROM employees e
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE e.id = :id AND e.is_archived = 0
         LIMIT 1'
    );
    $statement->execute([':id' => $employeeRecordId]);
    $row = $statement->fetch();

    if ($row === false) {
        return null;
    }

    return [
        'employeeRecordId' => (int)$row['id'],
        'name' => payroll_signatory_text($row['name']),
        'designation' => payroll_signatory_text($row['designation']),
        'division' => payroll_signatory_text($row['division']),
    ];
}

/**
 * The employee behind a role, for the slots that can be guessed before anyone configures them.
 *
 * `$divisionHints` narrows a role held by several people -- there is one Regional Director but a
 * chief per division, and only the finance one certifies the register.
 */
function payroll_signatory_employee_for_role(PDO $pdo, string $roleName, array $divisionHints = []): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            e.id,
            TRIM(CONCAT(e.first_name, " ", COALESCE(e.middle_name, ""), " ", e.last_name)) AS name,
            des.name AS designation,
            d.name AS division
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         INNER JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email COLLATE utf8mb4_unicode_ci
           AND e.is_archived = 0
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN divisions d ON d.id = e.division_id
         WHERE LOWER(r.name) = LOWER(:role)
           AND u.is_archived = 0
         ORDER BY e.id'
    );
    $statement->execute([':role' => $roleName]);
    $rows = $statement->fetchAll();

    if ($rows === []) {
        return null;
    }

    $match = $rows[0];

    if ($divisionHints !== []) {
        $match = null;

        foreach ($rows as $row) {
            $division = strtolower(payroll_signatory_text($row['division']));

            foreach ($divisionHints as $hint) {
                if ($division !== '' && str_contains($division, strtolower($hint))) {
                    $match = $row;
                    break 2;
                }
            }
        }

        if ($match === null) {
            return null;
        }
    }

    return [
        'employeeRecordId' => (int)$match['id'],
        'name' => payroll_signatory_text($match['name']),
        'designation' => payroll_signatory_text($match['designation']),
        'division' => payroll_signatory_text($match['division']),
    ];
}

/**
 * The best guess for a slot nobody has configured yet.
 *
 * Only two of the four can be inferred: there is a Regional Director role and a chief per division.
 * The finance-section slots have no role or designation to key on, so they stay empty until an
 * administrator picks someone -- an empty rule on the form is honest, an invented name is not.
 */
function payroll_signatory_fallback(PDO $pdo, string $slotKey): ?array
{
    return match ($slotKey) {
        'certifiedServices' => payroll_signatory_employee_for_role($pdo, 'Chief', PAYROLL_SIGNATORY_FINANCE_DIVISION_HINTS),
        'approvedBy' => payroll_signatory_employee_for_role($pdo, 'Regionaldirector'),
        default => null,
    };
}

/**
 * The certification block, resolved against real employee records.
 *
 * Every consumer -- the payroll API, the Excel export, the Settings screen -- reads this, so the
 * screen and the workbook can never be signed by different people.
 */
function payroll_signatories(PDO $pdo): array
{
    $selection = payroll_signatory_selection($pdo);
    $resolved = [];

    foreach (payroll_signatory_slots() as $key => $slot) {
        $employee = payroll_signatory_employee($pdo, $selection[$key]);
        $isFallback = false;

        if ($employee === null) {
            $employee = payroll_signatory_fallback($pdo, $key);
            $isFallback = $employee !== null;
        }

        $resolved[] = [
            'key' => $key,
            'box' => $slot['box'],
            'statement' => $slot['statement'],
            'title' => $slot['title'],
            'placement' => $slot['placement'],
            'description' => $slot['description'],
            'employeeRecordId' => $employee['employeeRecordId'] ?? null,
            // Upper case is how the printed form sets a signatory's name.
            'name' => $employee !== null ? mb_strtoupper($employee['name'], 'UTF-8') : '',
            'designation' => $employee['designation'] ?? '',
            // True when nobody picked this one and the role lookup filled it in.
            'isFallback' => $isFallback,
            'isConfigured' => $selection[$key] !== null,
        ];
    }

    return $resolved;
}

/** The certification statement that heads the block. Fixed wording from the printed form. */
function payroll_signatory_statement(): string
{
    return 'Each employee whose name appears on the payroll has been paid the amount as indicated opposite his/her name';
}
