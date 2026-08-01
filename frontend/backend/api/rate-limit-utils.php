<?php
declare(strict_types=1);

require_once __DIR__ . '/audit_logs_helper.php';

// Composer packages live in frontend/vendor. The autoloader is optional at runtime so the
// API keeps working on a checkout where `composer install` has not been run yet.
$hrisVendorAutoload = __DIR__ . '/../../vendor/autoload.php';

if (is_file($hrisVendorAutoload)) {
    require_once $hrisVendorAutoload;
}

unset($hrisVendorAutoload);

/**
 * Endpoint groups that can be throttled independently.
 */
function hris_rate_limit_group_definitions(): array
{
    return [
        'login' => [
            'label' => 'Sign In',
            'description' => 'Sign-in attempts sent to login.php from a single IP address.',
            'defaults' => ['enabled' => true, 'maxRequests' => 10, 'windowSeconds' => 300, 'blockMinutes' => 15],
        ],
        'passwordReset' => [
            'label' => 'Password Reset',
            'description' => 'Forgot-password and reset-link requests from a single IP address.',
            'defaults' => ['enabled' => true, 'maxRequests' => 5, 'windowSeconds' => 900, 'blockMinutes' => 30],
        ],
        'twoFactor' => [
            'label' => 'Two-Factor Codes',
            'description' => 'Email OTP verification and resend requests from a single IP address.',
            'defaults' => ['enabled' => true, 'maxRequests' => 10, 'windowSeconds' => 600, 'blockMinutes' => 15],
        ],
        'api' => [
            'label' => 'Signed-In API Requests',
            'description' => 'Every authenticated API call. Settings and Rate Limiting are always exempt so an administrator can never be locked out of this page.',
            'defaults' => ['enabled' => false, 'maxRequests' => 300, 'windowSeconds' => 60, 'blockMinutes' => 5],
        ],
    ];
}

function hris_rate_limit_field_bounds(): array
{
    return [
        'maxRequests' => ['min' => 1, 'max' => 10000, 'label' => 'Requests allowed'],
        'windowSeconds' => ['min' => 10, 'max' => 86400, 'label' => 'Window (seconds)'],
        'blockMinutes' => ['min' => 1, 'max' => 1440, 'label' => 'Block duration (minutes)'],
    ];
}

/**
 * The global API group must never be able to lock an administrator out of the page
 * that turns it back off.
 */
function hris_rate_limit_exempt_scripts(): array
{
    return ['rate_limit.php', 'settings.php', 'logout.php', 'csrf.php'];
}

function hris_rate_limit_setting_key(string $group, string $field): string
{
    $normalizedField = strtolower((string)preg_replace('/([a-z])([A-Z])/', '$1_$2', $field));
    $normalizedGroup = strtolower((string)preg_replace('/([a-z])([A-Z])/', '$1_$2', $group));

    return "security_rate_limit_{$normalizedGroup}_{$normalizedField}";
}

function hris_ensure_rate_limit_tables(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS rate_limit_hits (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            limit_group VARCHAR(40) NOT NULL,
            identifier VARCHAR(190) NOT NULL,
            ip_address VARCHAR(45) NULL,
            endpoint VARCHAR(190) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_rate_limit_hits_lookup (limit_group, identifier, created_at),
            KEY idx_rate_limit_hits_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS rate_limit_blocks (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            limit_group VARCHAR(40) NOT NULL,
            identifier VARCHAR(190) NOT NULL,
            ip_address VARCHAR(45) NULL,
            reason VARCHAR(255) NULL,
            hit_count INT UNSIGNED NOT NULL DEFAULT 0,
            is_manual TINYINT(1) NOT NULL DEFAULT 0,
            blocked_by VARCHAR(190) NULL,
            released_by VARCHAR(190) NULL,
            blocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NULL,
            released_at DATETIME NULL,
            PRIMARY KEY (id),
            KEY idx_rate_limit_blocks_lookup (limit_group, identifier, released_at),
            KEY idx_rate_limit_blocks_blocked_at (blocked_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $ensured = true;
}

function hris_rate_limit_settings(PDO $pdo): array
{
    hris_ensure_application_settings_table($pdo);

    $bounds = hris_rate_limit_field_bounds();
    $groups = [];

    foreach (hris_rate_limit_group_definitions() as $group => $definition) {
        $defaults = $definition['defaults'];

        $groups[$group] = [
            'enabled' => hris_get_boolean_application_setting(
                $pdo,
                hris_rate_limit_setting_key($group, 'enabled'),
                (bool)$defaults['enabled']
            ),
        ];

        foreach ($bounds as $field => $bound) {
            $groups[$group][$field] = hris_get_integer_application_setting(
                $pdo,
                hris_rate_limit_setting_key($group, $field),
                (int)$defaults[$field],
                (int)$bound['min'],
                (int)$bound['max']
            );
        }
    }

    return [
        'enabled' => hris_get_boolean_application_setting($pdo, 'security_rate_limit_enabled', true),
        'groups' => $groups,
    ];
}

function hris_normalize_rate_limit_payload(array $body): array
{
    $bounds = hris_rate_limit_field_bounds();
    $definitions = hris_rate_limit_group_definitions();
    $requestGroups = is_array($body['groups'] ?? null) ? $body['groups'] : [];

    $settings = [
        'enabled' => filter_var($body['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
        'groups' => [],
    ];
    $errors = [];

    foreach ($definitions as $group => $definition) {
        $defaults = $definition['defaults'];
        $requested = is_array($requestGroups[$group] ?? null) ? $requestGroups[$group] : [];

        $settings['groups'][$group] = [
            'enabled' => filter_var($requested['enabled'] ?? $defaults['enabled'], FILTER_VALIDATE_BOOLEAN),
        ];

        foreach ($bounds as $field => $bound) {
            $number = filter_var($requested[$field] ?? $defaults[$field], FILTER_VALIDATE_INT);

            if ($number === false) {
                $errors[] = sprintf('%s for %s must be a whole number.', $bound['label'], $definition['label']);
                $settings['groups'][$group][$field] = (int)$defaults[$field];
                continue;
            }

            if ($number < $bound['min'] || $number > $bound['max']) {
                $errors[] = sprintf(
                    '%s for %s must be between %d and %d.',
                    $bound['label'],
                    $definition['label'],
                    $bound['min'],
                    $bound['max']
                );
            }

            $settings['groups'][$group][$field] = max($bound['min'], min($bound['max'], (int)$number));
        }
    }

    return ['settings' => $settings, 'errors' => $errors];
}

function hris_store_rate_limit_settings(PDO $pdo, array $settings): void
{
    hris_ensure_application_settings_table($pdo);
    hris_store_boolean_application_setting($pdo, 'security_rate_limit_enabled', $settings['enabled'] ?? true);

    foreach (hris_rate_limit_group_definitions() as $group => $definition) {
        $values = $settings['groups'][$group] ?? $definition['defaults'];

        hris_store_boolean_application_setting(
            $pdo,
            hris_rate_limit_setting_key($group, 'enabled'),
            $values['enabled'] ?? $definition['defaults']['enabled']
        );

        foreach (array_keys(hris_rate_limit_field_bounds()) as $field) {
            hris_store_integer_application_setting(
                $pdo,
                hris_rate_limit_setting_key($group, $field),
                (int)($values[$field] ?? $definition['defaults'][$field])
            );
        }
    }
}

function hris_rate_limit_identifier(?string $identifier = null): ?string
{
    $value = trim((string)($identifier ?? ''));

    if ($value !== '') {
        return substr($value, 0, 190);
    }

    $ipAddress = hris_client_ip_address();

    return $ipAddress !== null && $ipAddress !== '' ? $ipAddress : null;
}

function hris_rate_limit_current_script(): string
{
    return basename((string)($_SERVER['SCRIPT_NAME'] ?? $_SERVER['PHP_SELF'] ?? ''));
}

/**
 * Every timestamp comparison stays inside MySQL: PHP and the database can sit in
 * different timezones, and mixing the two clocks makes blocks expire the moment they
 * are written.
 */
function hris_rate_limit_active_block(PDO $pdo, string $group, string $identifier): ?array
{
    $statement = $pdo->prepare(
        'SELECT
            id,
            limit_group AS limitGroup,
            identifier,
            reason,
            is_manual AS isManual,
            blocked_at AS blockedAt,
            expires_at AS expiresAt,
            COALESCE(GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), expires_at)), 0) AS retryAfter
         FROM rate_limit_blocks
         WHERE limit_group = :limit_group
           AND identifier = :identifier
           AND released_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY id DESC
         LIMIT 1'
    );
    $statement->execute([
        ':limit_group' => $group,
        ':identifier' => $identifier,
    ]);

    $block = $statement->fetch();

    return $block ?: null;
}

function hris_rate_limit_prune(PDO $pdo): void
{
    // Hits only matter inside their window; keep a day so the monitor can still show trends.
    try {
        $pdo->exec('DELETE FROM rate_limit_hits WHERE created_at < (NOW() - INTERVAL 1 DAY)');
        $pdo->exec('DELETE FROM rate_limit_blocks WHERE blocked_at < (NOW() - INTERVAL 30 DAY)');
    } catch (Throwable $exception) {
        error_log('Rate limit prune failed: ' . $exception->getMessage());
    }
}

function hris_rate_limit_block(
    PDO $pdo,
    string $group,
    string $identifier,
    int $blockMinutes,
    int $hitCount,
    string $reason,
    bool $isManual = false,
    ?string $blockedBy = null
): array {
    hris_ensure_rate_limit_tables($pdo);

    $minutes = max(0, $blockMinutes);
    $expiresExpression = $minutes > 0
        ? sprintf('DATE_ADD(NOW(), INTERVAL %d MINUTE)', $minutes)
        : 'NULL';

    $statement = $pdo->prepare(
        'INSERT INTO rate_limit_blocks
            (limit_group, identifier, ip_address, reason, hit_count, is_manual, blocked_by, expires_at)
         VALUES
            (:limit_group, :identifier, :ip_address, :reason, :hit_count, :is_manual, :blocked_by, ' . $expiresExpression . ')'
    );
    $statement->execute([
        ':limit_group' => $group,
        ':identifier' => $identifier,
        ':ip_address' => filter_var($identifier, FILTER_VALIDATE_IP) !== false ? $identifier : hris_client_ip_address(),
        ':reason' => substr($reason, 0, 255),
        ':hit_count' => max(0, $hitCount),
        ':is_manual' => $isManual ? 1 : 0,
        ':blocked_by' => $blockedBy !== null ? substr($blockedBy, 0, 190) : null,
    ]);

    $id = (int)$pdo->lastInsertId();

    $lookup = $pdo->prepare('SELECT expires_at AS expiresAt FROM rate_limit_blocks WHERE id = :id');
    $lookup->execute([':id' => $id]);

    return [
        'id' => $id,
        'expiresAt' => $lookup->fetchColumn() ?: null,
        'retryAfter' => $minutes * 60,
    ];
}

function hris_rate_limit_release(PDO $pdo, int $blockId, ?string $releasedBy = null): bool
{
    hris_ensure_rate_limit_tables($pdo);

    $statement = $pdo->prepare(
        'UPDATE rate_limit_blocks
         SET released_at = NOW(),
             released_by = :released_by
         WHERE id = :id
           AND released_at IS NULL'
    );
    $statement->execute([
        ':id' => $blockId,
        ':released_by' => $releasedBy !== null ? substr($releasedBy, 0, 190) : null,
    ]);

    return $statement->rowCount() > 0;
}

function hris_rate_limit_reject(string $group, int $retryAfter, bool $manual): void
{
    $minutes = (int)ceil($retryAfter / 60);
    $wait = $retryAfter <= 0
        ? 'Contact your administrator to restore access.'
        : ($minutes <= 1 ? 'Try again in about a minute.' : "Try again in about {$minutes} minutes.");

    if ($retryAfter > 0) {
        header('Retry-After: ' . $retryAfter);
    }

    json_response([
        'success' => false,
        'message' => $manual
            ? 'Your IP address has been blocked by an administrator. ' . $wait
            : 'Too many requests. ' . $wait,
        'rateLimited' => true,
        'limitGroup' => $group,
        'retryAfter' => $retryAfter,
    ], 429);
}

/**
 * Records one request against a group and stops the request with HTTP 429 when the
 * configured limit is exceeded. Safe to call before authentication.
 */
function hris_rate_limit_guard(PDO $pdo, string $group, ?string $identifier = null): void
{
    $definitions = hris_rate_limit_group_definitions();

    if (!isset($definitions[$group])) {
        return;
    }

    if ($group === 'api' && in_array(hris_rate_limit_current_script(), hris_rate_limit_exempt_scripts(), true)) {
        return;
    }

    try {
        $settings = hris_rate_limit_settings($pdo);

        if (!$settings['enabled'] || !($settings['groups'][$group]['enabled'] ?? false)) {
            return;
        }

        $key = hris_rate_limit_identifier($identifier);

        if ($key === null) {
            return;
        }

        hris_ensure_rate_limit_tables($pdo);

        $activeBlock = hris_rate_limit_active_block($pdo, $group, $key);
    } catch (Throwable $exception) {
        // A throttling outage must never take the whole API down.
        error_log('Rate limit check failed: ' . $exception->getMessage());
        return;
    }

    if ($activeBlock !== null) {
        hris_rate_limit_reject(
            $group,
            (int)($activeBlock['retryAfter'] ?? 0),
            (int)($activeBlock['isManual'] ?? 0) === 1
        );
    }

    $configuration = $settings['groups'][$group];

    try {
        $insert = $pdo->prepare(
            'INSERT INTO rate_limit_hits (limit_group, identifier, ip_address, endpoint)
             VALUES (:limit_group, :identifier, :ip_address, :endpoint)'
        );
        $insert->execute([
            ':limit_group' => $group,
            ':identifier' => $key,
            ':ip_address' => hris_client_ip_address(),
            ':endpoint' => substr(hris_rate_limit_current_script(), 0, 190),
        ]);

        $count = $pdo->prepare(
            'SELECT COUNT(*)
             FROM rate_limit_hits
             WHERE limit_group = :limit_group
               AND identifier = :identifier
               AND created_at > (NOW() - INTERVAL ' . (int)$configuration['windowSeconds'] . ' SECOND)'
        );
        $count->execute([
            ':limit_group' => $group,
            ':identifier' => $key,
        ]);

        $hits = (int)$count->fetchColumn();

        if (random_int(1, 50) === 1) {
            hris_rate_limit_prune($pdo);
        }
    } catch (Throwable $exception) {
        error_log('Rate limit tracking failed: ' . $exception->getMessage());
        return;
    }

    if ($hits <= (int)$configuration['maxRequests']) {
        return;
    }

    try {
        $block = hris_rate_limit_block(
            $pdo,
            $group,
            $key,
            (int)$configuration['blockMinutes'],
            $hits,
            sprintf(
                '%d requests in %d seconds (limit %d).',
                $hits,
                (int)$configuration['windowSeconds'],
                (int)$configuration['maxRequests']
            )
        );
    } catch (Throwable $exception) {
        error_log('Rate limit block failed: ' . $exception->getMessage());
        return;
    }

    hris_rate_limit_reject($group, (int)$block['retryAfter'], false);
}

function hris_rate_limit_blocks(PDO $pdo, int $limit = 100): array
{
    hris_ensure_rate_limit_tables($pdo);

    $statement = $pdo->prepare(
        'SELECT
            id,
            limit_group AS limitGroup,
            identifier,
            ip_address AS ipAddress,
            reason,
            hit_count AS hitCount,
            is_manual AS isManual,
            blocked_by AS blockedBy,
            released_by AS releasedBy,
            blocked_at AS blockedAt,
            expires_at AS expiresAt,
            released_at AS releasedAt,
            CASE
                WHEN released_at IS NOT NULL THEN "released"
                WHEN expires_at IS NOT NULL AND expires_at <= NOW() THEN "expired"
                ELSE "active"
            END AS state,
            CASE
                WHEN released_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
                    THEN COALESCE(GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), expires_at)), 0)
                ELSE 0
            END AS retryAfter
         FROM rate_limit_blocks
         ORDER BY (released_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) DESC, blocked_at DESC
         LIMIT :row_limit'
    );
    $statement->bindValue(':row_limit', max(1, min(500, $limit)), PDO::PARAM_INT);
    $statement->execute();

    $blocks = $statement->fetchAll();

    foreach ($blocks as &$block) {
        $block['id'] = (int)$block['id'];
        $block['hitCount'] = (int)$block['hitCount'];
        $block['isManual'] = (int)$block['isManual'] === 1;
        $block['retryAfter'] = (int)$block['retryAfter'];
    }
    unset($block);

    return $blocks;
}

function hris_rate_limit_activity(PDO $pdo, int $limit = 25): array
{
    hris_ensure_rate_limit_tables($pdo);

    $statement = $pdo->prepare(
        'SELECT
            limit_group AS limitGroup,
            identifier,
            MAX(ip_address) AS ipAddress,
            COUNT(*) AS hits,
            MAX(created_at) AS lastSeenAt
         FROM rate_limit_hits
         WHERE created_at > (NOW() - INTERVAL 1 HOUR)
         GROUP BY limit_group, identifier
         ORDER BY hits DESC, lastSeenAt DESC
         LIMIT :row_limit'
    );
    $statement->bindValue(':row_limit', max(1, min(200, $limit)), PDO::PARAM_INT);
    $statement->execute();

    $rows = $statement->fetchAll();

    foreach ($rows as &$row) {
        $row['hits'] = (int)$row['hits'];
    }
    unset($row);

    return $rows;
}

function hris_rate_limit_statistics(PDO $pdo): array
{
    hris_ensure_rate_limit_tables($pdo);

    $hitsLastHour = (int)$pdo->query(
        'SELECT COUNT(*) FROM rate_limit_hits WHERE created_at > (NOW() - INTERVAL 1 HOUR)'
    )->fetchColumn();

    $hitsLastDay = (int)$pdo->query(
        'SELECT COUNT(*) FROM rate_limit_hits WHERE created_at > (NOW() - INTERVAL 1 DAY)'
    )->fetchColumn();

    $activeBlocks = (int)$pdo->query(
        'SELECT COUNT(*)
         FROM rate_limit_blocks
         WHERE released_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())'
    )->fetchColumn();

    $blocksLastDay = (int)$pdo->query(
        'SELECT COUNT(*) FROM rate_limit_blocks WHERE blocked_at > (NOW() - INTERVAL 1 DAY)'
    )->fetchColumn();

    return [
        'hitsLastHour' => $hitsLastHour,
        'hitsLastDay' => $hitsLastDay,
        'activeBlocks' => $activeBlocks,
        'blocksLastDay' => $blocksLastDay,
    ];
}

/**
 * Describes where counters are stored so the settings page can show the active driver.
 */
function hris_rate_limit_driver(): array
{
    $vendorAutoloadPath = realpath(__DIR__ . '/../../vendor/autoload.php');

    return [
        'name' => 'mysql',
        'label' => 'MySQL (rate_limit_hits)',
        'vendorAutoloadLoaded' => $vendorAutoloadPath !== false,
        'predisAvailable' => class_exists('Predis\\Client'),
    ];
}
