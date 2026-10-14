<?php
declare(strict_types=1);

/**
 * Addresses: the entries an administrator adds under Settings > Add Address.
 *
 * The Region / Province / City / Address pickers on the employee form and the profile page are built
 * from the PSGC lists compiled into the front end (src/data/philippines-addresses). Those lists are
 * fixed at build time, they predate BARMM and the Negros Island Region, and a barangay's ZIP code is
 * only ever guessed from the place names. This table is the editable layer on top of them: one row is
 * one complete address -- a barangay together with its region, province, city or municipality and
 * ZIP code -- and the front end lays the rows over the built-in lists (src/utils/addressDirectory.js).
 *
 * How a row names each level:
 *   - A level picked from the built-in list keeps its PSGC code (2, 4, 6 or 9 digits).
 *   - A region, province or city typed in as new gets a code derived from its parent's code and its
 *     own name: 'X' and ten hex digits. Every row that names the same new province under the same
 *     region therefore lands on the same code, with no lookup and no race between two saves.
 *   - A row whose barangay carries a PSGC code overrides that built-in barangay (its name or its ZIP
 *     code). Any other barangay is new and is given a random code, which it keeps when it is renamed,
 *     so a profile that saved the code still finds it.
 *
 * Reading is open to every signed-in user, because the profile page offers the pickers to every role.
 * Writing needs the Settings module, which only administrators hold by default.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

/** The levels from the top down, each with the length of its PSGC code. */
const ADDRESS_LEVELS = [
    'region' => 2,
    'province' => 4,
    'city' => 6,
    'barangay' => 9,
];

const ADDRESS_LEVEL_LABELS = [
    'region' => 'Region',
    'province' => 'Province',
    'city' => 'City / Municipality',
    'barangay' => 'Address',
];

const ADDRESS_NAME_MAX_LENGTH = 150;

function ensure_addresses_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $ensured = true;

    // Provisioned outside any transaction, for the reason spelled out in ensure_audit_logs_table().
    ensure_audit_logs_table($pdo);

    try {
        if (!database_table_exists($pdo, 'addresses')) {
            $pdo->exec(
                'CREATE TABLE `addresses` (
                    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    `region_code` VARCHAR(16) NOT NULL,
                    `region_name` VARCHAR(150) NOT NULL,
                    `province_code` VARCHAR(16) NOT NULL,
                    `province_name` VARCHAR(150) NOT NULL,
                    `city_code` VARCHAR(16) NOT NULL,
                    `city_name` VARCHAR(150) NOT NULL,
                    `barangay_code` VARCHAR(16) NOT NULL,
                    `barangay_name` VARCHAR(150) NOT NULL,
                    `zip_code` CHAR(4) NOT NULL,
                    `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
                    `updated_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
                    `updated_at` TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_addresses_barangay_code` (`barangay_code`),
                    KEY `idx_addresses_city_code` (`city_code`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );
        }
    } catch (Throwable $exception) {
        // Another request may have won the race to create it.
        error_log('Address table setup skipped: ' . $exception->getMessage());
    }
}

/**
 * Administrators, and any role given the matching Settings action in Settings > Permissions.
 */
function addresses_can_manage(array $sessionUser, string $action): bool
{
    return user_role_key($sessionUser) === 'admin' || user_has_permission($sessionUser, 'settings', $action);
}

function addresses_require_manager(array $sessionUser, string $action): void
{
    if (addresses_can_manage($sessionUser, $action)) {
        return;
    }

    json_response([
        'success' => false,
        'message' => 'You are not allowed to manage addresses.',
    ], 403);
}

/** Trimmed, with every run of whitespace collapsed to a single space. */
function addresses_name(mixed $value): string
{
    return trim((string)preg_replace('/\s+/u', ' ', (string)($value ?? '')));
}

function addresses_is_builtin_code(string $level, string $code): bool
{
    return preg_match('/^\d{' . ADDRESS_LEVELS[$level] . '}$/', $code) === 1;
}

/**
 * The code of a region, province or city typed in as new. Derived rather than looked up, so the same
 * name under the same parent always comes out the same -- ignoring case, which is also how the
 * pickers match a typed name against the list.
 */
function addresses_custom_level_code(string $level, string $parentCode, string $name): string
{
    return 'X' . strtoupper(substr(sha1($level . '|' . $parentCode . '|' . mb_strtolower($name, 'UTF-8')), 0, 10));
}

function addresses_new_barangay_code(PDO $pdo): string
{
    $statement = $pdo->prepare('SELECT COUNT(*) FROM addresses WHERE barangay_code = :code');

    for ($attempt = 0; $attempt < 5; $attempt++) {
        $code = 'X' . strtoupper(bin2hex(random_bytes(5)));
        $statement->execute([':code' => $code]);

        if ((int)$statement->fetchColumn() === 0) {
            return $code;
        }
    }

    throw new RuntimeException('Unable to allocate an address code.');
}

/**
 * The address a request describes, with its codes settled.
 *
 * `$existing` is the row being edited. Its barangay code is its identity and survives a rename or a
 * move; a new row's barangay code stays empty for the insert to allocate, unless it names a built-in
 * barangay to override.
 */
function addresses_validate(array $body, ?array $existing = null): array
{
    $address = [];
    $errors = [];
    $parentCode = '';
    $parentIsBuiltIn = true;

    foreach (ADDRESS_LEVELS as $level => $codeLength) {
        $label = ADDRESS_LEVEL_LABELS[$level];
        $name = addresses_name($body[$level . 'Name'] ?? '');
        $code = strtoupper(trim((string)($body[$level . 'Code'] ?? '')));

        if ($name === '') {
            $errors[$level . 'Name'] = $label . ' is required.';
        } elseif (mb_strlen($name, 'UTF-8') > ADDRESS_NAME_MAX_LENGTH) {
            $errors[$level . 'Name'] = sprintf('%s must not exceed %d characters.', $label, ADDRESS_NAME_MAX_LENGTH);
        } elseif (preg_match('/[\p{L}\p{N}]/u', $name) !== 1) {
            $errors[$level . 'Name'] = $label . ' must contain a letter or a number.';
        }

        if ($level === 'barangay') {
            if ($existing !== null) {
                $code = (string)$existing['barangay_code'];
            } elseif (!addresses_is_builtin_code($level, $code)) {
                $code = '';
            }
        } elseif (
            !addresses_is_builtin_code($level, $code)
            || !$parentIsBuiltIn
            || !str_starts_with($code, $parentCode)
        ) {
            // PSGC codes nest (province 1043 sits under region 10, city 104305 under 1043), so a
            // built-in code only stands where it fits. Anything else -- typed as new, or a code put
            // under a parent it does not belong to -- is a new entry under the parent this row names.
            $code = addresses_custom_level_code($level, $parentCode, $name);
            $parentIsBuiltIn = false;
        }

        $address[$level . '_code'] = $code;
        $address[$level . '_name'] = $name;
        $parentCode = $code;
    }

    $zipCode = trim((string)($body['zipCode'] ?? ''));

    if ($zipCode === '') {
        $errors['zipCode'] = 'ZIP code is required.';
    } elseif (preg_match('/^\d{4}$/', $zipCode) !== 1) {
        $errors['zipCode'] = 'ZIP code must be exactly 4 digits.';
    }

    $address['zip_code'] = $zipCode;

    return ['address' => $address, 'errors' => $errors];
}

function addresses_reject_invalid(array $errors): void
{
    if ($errors === []) {
        return;
    }

    json_response([
        'success' => false,
        'message' => reset($errors),
        'errors' => $errors,
    ], 422);
}

/**
 * Two rows may not describe the same barangay: neither by code nor by name within one city. The
 * column collation compares names without regard to case.
 */
function addresses_reject_duplicate(PDO $pdo, array $address, int $ignoreId = 0): void
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM addresses
         WHERE id <> :ignore_id
           AND (barangay_code = :barangay_code
                OR (city_code = :city_code AND barangay_name = :barangay_name))'
    );
    $statement->execute([
        ':ignore_id' => $ignoreId,
        // A new barangay has no code until the insert, and an empty one must not match anything.
        ':barangay_code' => $address['barangay_code'] !== '' ? $address['barangay_code'] : '-',
        ':city_code' => $address['city_code'],
        ':barangay_name' => $address['barangay_name'],
    ]);

    if ((int)$statement->fetchColumn() > 0) {
        json_response([
            'success' => false,
            'message' => 'That address is already in the list.',
        ], 409);
    }
}

/**
 * Give every row the name just saved for a new region, province or city it shares. The derived code
 * already pins the spelling down to case and spacing, so all this carries across is a correction of
 * those -- "lanao sur" fixed to "Lanao Sur" on one row is fixed on all of them.
 */
function addresses_sync_level_names(PDO $pdo, array $address): void
{
    foreach (['region', 'province', 'city'] as $level) {
        $code = $address[$level . '_code'];

        if (addresses_is_builtin_code($level, $code)) {
            continue;
        }

        $statement = $pdo->prepare("UPDATE addresses SET {$level}_name = :name WHERE {$level}_code = :code");
        $statement->execute([
            ':name' => $address[$level . '_name'],
            ':code' => $code,
        ]);
    }
}

function addresses_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare('SELECT * FROM addresses WHERE id = :id LIMIT 1');
    $statement->execute([':id' => $id]);
    $row = $statement->fetch();

    return $row === false ? null : $row;
}

function addresses_format(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'regionCode' => (string)$row['region_code'],
        'regionName' => (string)$row['region_name'],
        'provinceCode' => (string)$row['province_code'],
        'provinceName' => (string)$row['province_name'],
        'cityCode' => (string)$row['city_code'],
        'cityName' => (string)$row['city_name'],
        'barangayCode' => (string)$row['barangay_code'],
        'barangayName' => (string)$row['barangay_name'],
        'zipCode' => (string)$row['zip_code'],
        'createdAt' => $row['created_at'] ?? null,
        'updatedAt' => $row['updated_at'] ?? null,
    ];
}

/** Most recently saved first, which is the order Settings lists them in. */
function addresses_list(PDO $pdo): array
{
    $statement = $pdo->query('SELECT * FROM addresses ORDER BY updated_at DESC, id DESC');

    return array_map('addresses_format', $statement->fetchAll());
}

function addresses_label(array $address): string
{
    return implode(', ', [$address['barangay_name'], $address['city_name'], $address['province_name']]);
}

/** Every response carries the whole list, so the caller never needs a second request to redraw. */
function addresses_response(PDO $pdo, array $sessionUser, array $extra = [], int $status = 200): void
{
    json_response(array_merge([
        'success' => true,
        'canManage' => addresses_can_manage($sessionUser, 'create') || addresses_can_manage($sessionUser, 'edit'),
        'addresses' => addresses_list($pdo),
    ], $extra), $status);
}

function addresses_create(PDO $pdo, array $sessionUser, array $body): void
{
    addresses_require_manager($sessionUser, 'create');

    ['address' => $address, 'errors' => $errors] = addresses_validate($body);
    addresses_reject_invalid($errors);
    addresses_reject_duplicate($pdo, $address);

    $userId = (int)($sessionUser['id'] ?? 0);
    $pdo->beginTransaction();

    try {
        if ($address['barangay_code'] === '') {
            $address['barangay_code'] = addresses_new_barangay_code($pdo);
        }

        $insert = $pdo->prepare(
            'INSERT INTO addresses
                (region_code, region_name, province_code, province_name, city_code, city_name,
                 barangay_code, barangay_name, zip_code, created_by_user_id, updated_by_user_id)
             VALUES
                (:region_code, :region_name, :province_code, :province_name, :city_code, :city_name,
                 :barangay_code, :barangay_name, :zip_code, :created_by_user_id, :updated_by_user_id)'
        );
        $insert->execute([
            ':region_code' => $address['region_code'],
            ':region_name' => $address['region_name'],
            ':province_code' => $address['province_code'],
            ':province_name' => $address['province_name'],
            ':city_code' => $address['city_code'],
            ':city_name' => $address['city_name'],
            ':barangay_code' => $address['barangay_code'],
            ':barangay_name' => $address['barangay_name'],
            ':zip_code' => $address['zip_code'],
            ':created_by_user_id' => $userId > 0 ? $userId : null,
            ':updated_by_user_id' => $userId > 0 ? $userId : null,
        ]);
        $id = (int)$pdo->lastInsertId();

        addresses_sync_level_names($pdo, $address);
        $pdo->commit();
    } catch (PDOException $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        // The unique barangay code, reached by a save that raced this one past the duplicate check.
        if ($exception->getCode() === '23000') {
            json_response([
                'success' => false,
                'message' => 'That address is already in the list.',
            ], 409);
        }

        throw $exception;
    }

    write_auth_audit($pdo, $sessionUser, 'addresses.created', 'An address was added.', [
        'module' => 'settings',
        'addressId' => $id,
        'address' => addresses_label($address),
        'zipCode' => $address['zip_code'],
    ]);

    addresses_response($pdo, $sessionUser, [
        'message' => 'Address added successfully.',
        'address' => addresses_format(addresses_row($pdo, $id)),
    ], 201);
}

function addresses_update(PDO $pdo, array $sessionUser, array $body): void
{
    addresses_require_manager($sessionUser, 'edit');

    $id = (int)($body['id'] ?? 0);
    $existing = $id > 0 ? addresses_row($pdo, $id) : null;

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Address was not found.',
        ], 404);
    }

    ['address' => $address, 'errors' => $errors] = addresses_validate($body, $existing);
    addresses_reject_invalid($errors);
    addresses_reject_duplicate($pdo, $address, $id);

    $userId = (int)($sessionUser['id'] ?? 0);
    $pdo->beginTransaction();

    try {
        $update = $pdo->prepare(
            'UPDATE addresses
             SET region_code = :region_code,
                 region_name = :region_name,
                 province_code = :province_code,
                 province_name = :province_name,
                 city_code = :city_code,
                 city_name = :city_name,
                 barangay_name = :barangay_name,
                 zip_code = :zip_code,
                 updated_by_user_id = :updated_by_user_id
             WHERE id = :id'
        );
        $update->execute([
            ':region_code' => $address['region_code'],
            ':region_name' => $address['region_name'],
            ':province_code' => $address['province_code'],
            ':province_name' => $address['province_name'],
            ':city_code' => $address['city_code'],
            ':city_name' => $address['city_name'],
            ':barangay_name' => $address['barangay_name'],
            ':zip_code' => $address['zip_code'],
            ':updated_by_user_id' => $userId > 0 ? $userId : null,
            ':id' => $id,
        ]);

        addresses_sync_level_names($pdo, $address);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    write_auth_audit($pdo, $sessionUser, 'addresses.updated', 'An address was updated.', [
        'module' => 'settings',
        'addressId' => $id,
        'previous' => addresses_label($existing),
        'address' => addresses_label($address),
        'zipCode' => $address['zip_code'],
    ]);

    addresses_response($pdo, $sessionUser, [
        'message' => 'Address updated successfully.',
        'address' => addresses_format(addresses_row($pdo, $id)),
    ]);
}

function addresses_delete(PDO $pdo, array $sessionUser, array $body): void
{
    addresses_require_manager($sessionUser, 'archive');

    $id = (int)($body['id'] ?? ($_GET['id'] ?? 0));
    $existing = $id > 0 ? addresses_row($pdo, $id) : null;

    if ($existing === null) {
        json_response([
            'success' => false,
            'message' => 'Address was not found.',
        ], 404);
    }

    $delete = $pdo->prepare('DELETE FROM addresses WHERE id = :id');
    $delete->execute([':id' => $id]);

    // Employee records keep the names they were saved with, so nothing else needs to change.
    write_auth_audit($pdo, $sessionUser, 'addresses.deleted', 'An address was removed.', [
        'module' => 'settings',
        'addressId' => $id,
        'address' => addresses_label($existing),
        'zipCode' => (string)$existing['zip_code'],
    ]);

    addresses_response($pdo, $sessionUser, [
        'message' => 'Address removed.',
    ]);
}

try {
    ensure_addresses_table($pdo);

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        addresses_response($pdo, $sessionUser);
    }

    if ($method === 'POST') {
        addresses_create($pdo, $sessionUser, read_json_body());
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        addresses_update($pdo, $sessionUser, read_json_body());
    }

    if ($method === 'DELETE') {
        addresses_delete($pdo, $sessionUser, read_json_body());
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Address API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process the address request.',
    ], 500);
}
