<?php
declare(strict_types=1);

const EMPLOYEE_PDS_EDUCATION_LEVELS = [
    'elementary',
    'secondary',
    'vocational',
    'college',
    'graduate',
];

function ensure_employee_pds_profile_tables(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS employee_family_background (
            employee_record_id INT(10) UNSIGNED NOT NULL,
            spouse_last_name VARCHAR(100) DEFAULT NULL,
            spouse_first_name VARCHAR(100) DEFAULT NULL,
            spouse_middle_name VARCHAR(100) DEFAULT NULL,
            spouse_suffix VARCHAR(20) DEFAULT NULL,
            spouse_occupation VARCHAR(150) DEFAULT NULL,
            spouse_employer VARCHAR(180) DEFAULT NULL,
            spouse_business_address VARCHAR(255) DEFAULT NULL,
            spouse_telephone VARCHAR(30) DEFAULT NULL,
            father_last_name VARCHAR(100) DEFAULT NULL,
            father_first_name VARCHAR(100) DEFAULT NULL,
            father_middle_name VARCHAR(100) DEFAULT NULL,
            father_suffix VARCHAR(20) DEFAULT NULL,
            mother_maiden_last_name VARCHAR(100) DEFAULT NULL,
            mother_first_name VARCHAR(100) DEFAULT NULL,
            mother_middle_name VARCHAR(100) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (employee_record_id),
            CONSTRAINT fk_employee_family_background_employee
                FOREIGN KEY (employee_record_id) REFERENCES employees (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS employee_children (
            id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_record_id INT(10) UNSIGNED NOT NULL,
            full_name VARCHAR(180) NOT NULL,
            date_of_birth DATE DEFAULT NULL,
            sort_order TINYINT(3) UNSIGNED NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_employee_children_employee (employee_record_id, sort_order),
            CONSTRAINT fk_employee_children_employee
                FOREIGN KEY (employee_record_id) REFERENCES employees (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS employee_education_background (
            id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
            employee_record_id INT(10) UNSIGNED NOT NULL,
            education_level VARCHAR(20) NOT NULL,
            school_name VARCHAR(180) DEFAULT NULL,
            degree_course VARCHAR(180) DEFAULT NULL,
            attendance_from VARCHAR(20) DEFAULT NULL,
            attendance_to VARCHAR(20) DEFAULT NULL,
            highest_level_units VARCHAR(100) DEFAULT NULL,
            year_graduated VARCHAR(20) DEFAULT NULL,
            honors VARCHAR(180) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_employee_education_level (employee_record_id, education_level),
            CONSTRAINT fk_employee_education_background_employee
                FOREIGN KEY (employee_record_id) REFERENCES employees (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci'
    );
}

function employee_pds_profile_text(mixed $value, int $maximumLength = 255): string
{
    $text = trim(preg_replace('/\s+/u', ' ', (string)($value ?? '')) ?? '');

    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $maximumLength);
    }

    return substr($text, 0, $maximumLength);
}

/** @return array{first:string,middle:string,last:string,suffix:string} */
function employee_pds_profile_name_parts(mixed $value): array
{
    $name = employee_pds_profile_text($value, 320);
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

function employee_pds_profile_education_level(mixed $value): string
{
    $normalized = strtolower(employee_pds_profile_text($value, 150));

    if (preg_match('/graduate|master|doctor|phd/', $normalized)) {
        return 'graduate';
    }
    if (preg_match('/college|bachelor|university/', $normalized)) {
        return 'college';
    }
    if (preg_match('/vocational|trade|technical|tesda/', $normalized)) {
        return 'vocational';
    }
    if (preg_match('/secondary|high school|senior high|junior high/', $normalized)) {
        return 'secondary';
    }

    return 'elementary';
}

/** @return array<string, string> */
function employee_pds_profile_empty_family(): array
{
    return [
        'spouseLastName' => '',
        'spouseFirstName' => '',
        'spouseMiddleName' => '',
        'spouseSuffix' => '',
        'spouseOccupation' => '',
        'spouseEmployer' => '',
        'spouseBusinessAddress' => '',
        'spouseTelephone' => '',
        'fatherLastName' => '',
        'fatherFirstName' => '',
        'fatherMiddleName' => '',
        'fatherSuffix' => '',
        'motherMaidenLastName' => '',
        'motherFirstName' => '',
        'motherMiddleName' => '',
    ];
}

/** @return array<string, string> */
function employee_pds_profile_empty_education(string $level): array
{
    return [
        'level' => $level,
        'schoolName' => '',
        'degreeCourse' => '',
        'attendanceFrom' => '',
        'attendanceTo' => '',
        'highestLevelUnits' => '',
        'yearGraduated' => '',
        'honors' => '',
    ];
}

/** @return array{family:array<string, mixed>,education:array<int, array<string, string>>} */
function employee_pds_profile_fetch(PDO $pdo, int $employeeRecordId): array
{
    $legacyStatement = $pdo->prepare(
        'SELECT spouse_name, spouse_occupation, father_name, mother_name,
                highest_education, school_name, education_course, year_graduated
         FROM employees
         WHERE id = :id AND is_archived = 0
         LIMIT 1'
    );
    $legacyStatement->execute([':id' => $employeeRecordId]);
    $legacy = $legacyStatement->fetch(PDO::FETCH_ASSOC) ?: [];

    $family = employee_pds_profile_empty_family();
    $familyStatement = $pdo->prepare(
        'SELECT spouse_last_name, spouse_first_name, spouse_middle_name, spouse_suffix,
                spouse_occupation, spouse_employer, spouse_business_address, spouse_telephone,
                father_last_name, father_first_name, father_middle_name, father_suffix,
                mother_maiden_last_name, mother_first_name, mother_middle_name
         FROM employee_family_background
         WHERE employee_record_id = :employee_record_id
         LIMIT 1'
    );
    $familyStatement->execute([':employee_record_id' => $employeeRecordId]);
    $familyRow = $familyStatement->fetch(PDO::FETCH_ASSOC);

    if ($familyRow) {
        $family = [
            'spouseLastName' => (string)($familyRow['spouse_last_name'] ?? ''),
            'spouseFirstName' => (string)($familyRow['spouse_first_name'] ?? ''),
            'spouseMiddleName' => (string)($familyRow['spouse_middle_name'] ?? ''),
            'spouseSuffix' => (string)($familyRow['spouse_suffix'] ?? ''),
            'spouseOccupation' => (string)($familyRow['spouse_occupation'] ?? ''),
            'spouseEmployer' => (string)($familyRow['spouse_employer'] ?? ''),
            'spouseBusinessAddress' => (string)($familyRow['spouse_business_address'] ?? ''),
            'spouseTelephone' => (string)($familyRow['spouse_telephone'] ?? ''),
            'fatherLastName' => (string)($familyRow['father_last_name'] ?? ''),
            'fatherFirstName' => (string)($familyRow['father_first_name'] ?? ''),
            'fatherMiddleName' => (string)($familyRow['father_middle_name'] ?? ''),
            'fatherSuffix' => (string)($familyRow['father_suffix'] ?? ''),
            'motherMaidenLastName' => (string)($familyRow['mother_maiden_last_name'] ?? ''),
            'motherFirstName' => (string)($familyRow['mother_first_name'] ?? ''),
            'motherMiddleName' => (string)($familyRow['mother_middle_name'] ?? ''),
        ];
    } else {
        $spouse = employee_pds_profile_name_parts($legacy['spouse_name'] ?? '');
        $father = employee_pds_profile_name_parts($legacy['father_name'] ?? '');
        $mother = employee_pds_profile_name_parts($legacy['mother_name'] ?? '');
        $family = array_merge($family, [
            'spouseLastName' => $spouse['last'],
            'spouseFirstName' => $spouse['first'],
            'spouseMiddleName' => $spouse['middle'],
            'spouseSuffix' => $spouse['suffix'],
            'spouseOccupation' => (string)($legacy['spouse_occupation'] ?? ''),
            'fatherLastName' => $father['last'],
            'fatherFirstName' => $father['first'],
            'fatherMiddleName' => $father['middle'],
            'fatherSuffix' => $father['suffix'],
            'motherMaidenLastName' => $mother['last'],
            'motherFirstName' => $mother['first'],
            'motherMiddleName' => $mother['middle'],
        ]);
    }

    $childrenStatement = $pdo->prepare(
        'SELECT id, full_name, date_of_birth
         FROM employee_children
         WHERE employee_record_id = :employee_record_id
         ORDER BY sort_order, id
         LIMIT 12'
    );
    $childrenStatement->execute([':employee_record_id' => $employeeRecordId]);
    $family['children'] = array_map(static fn(array $row): array => [
        'id' => (int)$row['id'],
        'fullName' => (string)$row['full_name'],
        'dateOfBirth' => (string)($row['date_of_birth'] ?? ''),
    ], $childrenStatement->fetchAll(PDO::FETCH_ASSOC));

    $educationByLevel = [];
    foreach (EMPLOYEE_PDS_EDUCATION_LEVELS as $level) {
        $educationByLevel[$level] = employee_pds_profile_empty_education($level);
    }

    $educationStatement = $pdo->prepare(
        'SELECT education_level, school_name, degree_course, attendance_from, attendance_to,
                highest_level_units, year_graduated, honors
         FROM employee_education_background
         WHERE employee_record_id = :employee_record_id'
    );
    $educationStatement->execute([':employee_record_id' => $employeeRecordId]);
    $educationRows = $educationStatement->fetchAll(PDO::FETCH_ASSOC);

    foreach ($educationRows as $row) {
        $level = (string)$row['education_level'];
        if (!isset($educationByLevel[$level])) {
            continue;
        }

        $educationByLevel[$level] = [
            'level' => $level,
            'schoolName' => (string)($row['school_name'] ?? ''),
            'degreeCourse' => (string)($row['degree_course'] ?? ''),
            'attendanceFrom' => (string)($row['attendance_from'] ?? ''),
            'attendanceTo' => (string)($row['attendance_to'] ?? ''),
            'highestLevelUnits' => (string)($row['highest_level_units'] ?? ''),
            'yearGraduated' => (string)($row['year_graduated'] ?? ''),
            'honors' => (string)($row['honors'] ?? ''),
        ];
    }

    if ($educationRows === [] && array_filter([
        $legacy['school_name'] ?? '',
        $legacy['education_course'] ?? '',
        $legacy['year_graduated'] ?? '',
    ], static fn(mixed $value): bool => trim((string)$value) !== '') !== []) {
        $legacyLevel = employee_pds_profile_education_level($legacy['highest_education'] ?? '');
        $educationByLevel[$legacyLevel] = array_merge($educationByLevel[$legacyLevel], [
            'schoolName' => (string)($legacy['school_name'] ?? ''),
            'degreeCourse' => (string)($legacy['education_course'] ?? ''),
            'yearGraduated' => (string)($legacy['year_graduated'] ?? ''),
        ]);
    }

    return [
        'family' => $family,
        'education' => array_values($educationByLevel),
    ];
}

function employee_pds_profile_valid_date(mixed $value): string
{
    $date = employee_pds_profile_text($value, 10);
    if ($date === '') {
        return '';
    }

    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    $errors = DateTimeImmutable::getLastErrors();
    if ($parsed === false || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) || $parsed->format('Y-m-d') !== $date) {
        throw new InvalidArgumentException('Each child date of birth must be a valid date.');
    }

    return $date;
}

/** @param array<string, mixed> $family */
function employee_pds_profile_save_family(PDO $pdo, int $employeeRecordId, array $family): void
{
    $fields = [
        'spouseLastName' => 100,
        'spouseFirstName' => 100,
        'spouseMiddleName' => 100,
        'spouseSuffix' => 20,
        'spouseOccupation' => 150,
        'spouseEmployer' => 180,
        'spouseBusinessAddress' => 255,
        'spouseTelephone' => 30,
        'fatherLastName' => 100,
        'fatherFirstName' => 100,
        'fatherMiddleName' => 100,
        'fatherSuffix' => 20,
        'motherMaidenLastName' => 100,
        'motherFirstName' => 100,
        'motherMiddleName' => 100,
    ];
    $clean = [];
    foreach ($fields as $field => $maximumLength) {
        $clean[$field] = employee_pds_profile_text($family[$field] ?? '', $maximumLength);
    }

    $children = $family['children'] ?? [];
    if (!is_array($children)) {
        throw new InvalidArgumentException('Children must be supplied as a list.');
    }
    if (count($children) > 12) {
        throw new InvalidArgumentException('The official PDS supports up to 12 children.');
    }

    $cleanChildren = [];
    foreach ($children as $child) {
        if (!is_array($child)) {
            continue;
        }

        $fullName = employee_pds_profile_text($child['fullName'] ?? '', 180);
        $dateOfBirth = employee_pds_profile_valid_date($child['dateOfBirth'] ?? '');
        if ($fullName === '' && $dateOfBirth === '') {
            continue;
        }
        if ($fullName === '') {
            throw new InvalidArgumentException('Enter a name for every child with a date of birth.');
        }

        $cleanChildren[] = ['fullName' => $fullName, 'dateOfBirth' => $dateOfBirth];
    }

    $upsert = $pdo->prepare(
        'INSERT INTO employee_family_background (
            employee_record_id, spouse_last_name, spouse_first_name, spouse_middle_name, spouse_suffix,
            spouse_occupation, spouse_employer, spouse_business_address, spouse_telephone,
            father_last_name, father_first_name, father_middle_name, father_suffix,
            mother_maiden_last_name, mother_first_name, mother_middle_name
         ) VALUES (
            :employee_record_id, :spouse_last_name, :spouse_first_name, :spouse_middle_name, :spouse_suffix,
            :spouse_occupation, :spouse_employer, :spouse_business_address, :spouse_telephone,
            :father_last_name, :father_first_name, :father_middle_name, :father_suffix,
            :mother_maiden_last_name, :mother_first_name, :mother_middle_name
         ) ON DUPLICATE KEY UPDATE
            spouse_last_name = VALUES(spouse_last_name), spouse_first_name = VALUES(spouse_first_name),
            spouse_middle_name = VALUES(spouse_middle_name), spouse_suffix = VALUES(spouse_suffix),
            spouse_occupation = VALUES(spouse_occupation), spouse_employer = VALUES(spouse_employer),
            spouse_business_address = VALUES(spouse_business_address), spouse_telephone = VALUES(spouse_telephone),
            father_last_name = VALUES(father_last_name), father_first_name = VALUES(father_first_name),
            father_middle_name = VALUES(father_middle_name), father_suffix = VALUES(father_suffix),
            mother_maiden_last_name = VALUES(mother_maiden_last_name),
            mother_first_name = VALUES(mother_first_name), mother_middle_name = VALUES(mother_middle_name)'
    );
    $upsert->execute([
        ':employee_record_id' => $employeeRecordId,
        ':spouse_last_name' => $clean['spouseLastName'],
        ':spouse_first_name' => $clean['spouseFirstName'],
        ':spouse_middle_name' => $clean['spouseMiddleName'],
        ':spouse_suffix' => $clean['spouseSuffix'],
        ':spouse_occupation' => $clean['spouseOccupation'],
        ':spouse_employer' => $clean['spouseEmployer'],
        ':spouse_business_address' => $clean['spouseBusinessAddress'],
        ':spouse_telephone' => $clean['spouseTelephone'],
        ':father_last_name' => $clean['fatherLastName'],
        ':father_first_name' => $clean['fatherFirstName'],
        ':father_middle_name' => $clean['fatherMiddleName'],
        ':father_suffix' => $clean['fatherSuffix'],
        ':mother_maiden_last_name' => $clean['motherMaidenLastName'],
        ':mother_first_name' => $clean['motherFirstName'],
        ':mother_middle_name' => $clean['motherMiddleName'],
    ]);

    $deleteChildren = $pdo->prepare('DELETE FROM employee_children WHERE employee_record_id = :employee_record_id');
    $deleteChildren->execute([':employee_record_id' => $employeeRecordId]);
    $insertChild = $pdo->prepare(
        'INSERT INTO employee_children (employee_record_id, full_name, date_of_birth, sort_order)
         VALUES (:employee_record_id, :full_name, :date_of_birth, :sort_order)'
    );
    foreach ($cleanChildren as $index => $child) {
        $insertChild->bindValue(':employee_record_id', $employeeRecordId, PDO::PARAM_INT);
        $insertChild->bindValue(':full_name', $child['fullName']);
        $insertChild->bindValue(':date_of_birth', $child['dateOfBirth'] !== '' ? $child['dateOfBirth'] : null, $child['dateOfBirth'] !== '' ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $insertChild->bindValue(':sort_order', $index, PDO::PARAM_INT);
        $insertChild->execute();
    }

    $legacySpouse = trim(implode(' ', array_filter([
        $clean['spouseFirstName'], $clean['spouseMiddleName'], $clean['spouseLastName'], $clean['spouseSuffix'],
    ], static fn(string $value): bool => $value !== '')));
    $legacyFather = trim(implode(' ', array_filter([
        $clean['fatherFirstName'], $clean['fatherMiddleName'], $clean['fatherLastName'], $clean['fatherSuffix'],
    ], static fn(string $value): bool => $value !== '')));
    $legacyMother = trim(implode(' ', array_filter([
        $clean['motherFirstName'], $clean['motherMiddleName'], $clean['motherMaidenLastName'],
    ], static fn(string $value): bool => $value !== '')));
    $legacyUpdate = $pdo->prepare(
        'UPDATE employees
         SET spouse_name = :spouse_name, spouse_occupation = :spouse_occupation,
             father_name = :father_name, mother_name = :mother_name
         WHERE id = :id'
    );
    $legacyUpdate->execute([
        ':spouse_name' => $legacySpouse !== '' ? $legacySpouse : null,
        ':spouse_occupation' => $clean['spouseOccupation'] !== '' ? $clean['spouseOccupation'] : null,
        ':father_name' => $legacyFather !== '' ? $legacyFather : null,
        ':mother_name' => $legacyMother !== '' ? $legacyMother : null,
        ':id' => $employeeRecordId,
    ]);
}

/** @param array<int, mixed> $education */
function employee_pds_profile_save_education(PDO $pdo, int $employeeRecordId, array $education): void
{
    $provided = [];
    foreach ($education as $record) {
        if (!is_array($record)) {
            continue;
        }
        $level = strtolower(employee_pds_profile_text($record['level'] ?? '', 20));
        if (!in_array($level, EMPLOYEE_PDS_EDUCATION_LEVELS, true) || isset($provided[$level])) {
            throw new InvalidArgumentException('Educational background contains an invalid or duplicate level.');
        }

        $provided[$level] = [
            'level' => $level,
            'schoolName' => employee_pds_profile_text($record['schoolName'] ?? '', 180),
            'degreeCourse' => employee_pds_profile_text($record['degreeCourse'] ?? '', 180),
            'attendanceFrom' => employee_pds_profile_text($record['attendanceFrom'] ?? '', 20),
            'attendanceTo' => employee_pds_profile_text($record['attendanceTo'] ?? '', 20),
            'highestLevelUnits' => employee_pds_profile_text($record['highestLevelUnits'] ?? '', 100),
            'yearGraduated' => employee_pds_profile_text($record['yearGraduated'] ?? '', 20),
            'honors' => employee_pds_profile_text($record['honors'] ?? '', 180),
        ];
    }

    $delete = $pdo->prepare('DELETE FROM employee_education_background WHERE employee_record_id = :employee_record_id');
    $delete->execute([':employee_record_id' => $employeeRecordId]);
    $insert = $pdo->prepare(
        'INSERT INTO employee_education_background (
            employee_record_id, education_level, school_name, degree_course, attendance_from,
            attendance_to, highest_level_units, year_graduated, honors
         ) VALUES (
            :employee_record_id, :education_level, :school_name, :degree_course, :attendance_from,
            :attendance_to, :highest_level_units, :year_graduated, :honors
         )'
    );

    $highest = null;
    foreach (EMPLOYEE_PDS_EDUCATION_LEVELS as $level) {
        if (!isset($provided[$level])) {
            continue;
        }
        $record = $provided[$level];
        $hasValue = array_filter(array_slice($record, 1), static fn(string $value): bool => $value !== '') !== [];
        if (!$hasValue) {
            continue;
        }

        $insert->execute([
            ':employee_record_id' => $employeeRecordId,
            ':education_level' => $level,
            ':school_name' => $record['schoolName'] !== '' ? $record['schoolName'] : null,
            ':degree_course' => $record['degreeCourse'] !== '' ? $record['degreeCourse'] : null,
            ':attendance_from' => $record['attendanceFrom'] !== '' ? $record['attendanceFrom'] : null,
            ':attendance_to' => $record['attendanceTo'] !== '' ? $record['attendanceTo'] : null,
            ':highest_level_units' => $record['highestLevelUnits'] !== '' ? $record['highestLevelUnits'] : null,
            ':year_graduated' => $record['yearGraduated'] !== '' ? $record['yearGraduated'] : null,
            ':honors' => $record['honors'] !== '' ? $record['honors'] : null,
        ]);
        $highest = $record;
    }

    $labels = [
        'elementary' => 'Elementary',
        'secondary' => 'Secondary',
        'vocational' => 'Vocational / Trade Course',
        'college' => 'College',
        'graduate' => 'Graduate Studies',
    ];
    $legacyUpdate = $pdo->prepare(
        'UPDATE employees
         SET highest_education = :highest_education, school_name = :school_name,
             education_course = :education_course, year_graduated = :year_graduated
         WHERE id = :id'
    );
    $legacyUpdate->execute([
        ':highest_education' => $highest !== null ? $labels[$highest['level']] : null,
        ':school_name' => $highest !== null && $highest['schoolName'] !== '' ? $highest['schoolName'] : null,
        ':education_course' => $highest !== null && $highest['degreeCourse'] !== '' ? $highest['degreeCourse'] : null,
        ':year_graduated' => $highest !== null && $highest['yearGraduated'] !== '' ? $highest['yearGraduated'] : null,
        ':id' => $employeeRecordId,
    ]);
}
