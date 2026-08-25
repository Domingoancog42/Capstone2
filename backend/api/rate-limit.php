<?php
declare(strict_types=1);

/*
 * Request rate limiting.
 *
 * The account lockout in login.php counts failures against one user row, so it only ever slows an
 * attacker who keeps guessing the same username. It does nothing about the shapes of abuse that
 * spread the load: one client walking a password list across a hundred usernames, a script hammering
 * the reset-code form, or a loop pointed at any endpoint at all. Those are counted here instead, by
 * *caller* rather than by account, in fixed windows.
 *
 * Six groups, each configurable from Settings > Rate Limiting:
 *
 *   login                 sign-in attempts, keyed by IP address and the username typed
 *   passwordReset         reset-code submissions, keyed by IP address
 *   passwordResetRequest  reset-code *requests*, keyed by IP address — a separate budget on purpose
 *   twoFactor             one-time passcode submissions, keyed by IP address
 *   leaveRequest          leave filings, keyed by user id — a daily quota rather than an abuse guard
 *   api                   every authenticated request, keyed by user id (or IP before sign-in)
 *
 * Everything about this fails open. A missing table, a database error, an open transaction: the
 * request is allowed through. A rate limiter that 500s under its own weight would be a far larger
 * outage than the abuse it exists to slow.
 */

const HRIS_RATE_LIMIT_SETTING_KEY = 'rate_limit_settings';

/**
 * The groups, their defaults, and the range each field accepts.
 *
 * `scope` is shown in the admin screen: which callers share one counter is the thing that decides
 * whether a limit is sane, and it is not something the numbers alone can say.
 */
function rate_limit_rule_definitions(): array
{
    return [
        'login' => [
            'label' => 'Sign-in attempts',
            'description' => 'Password submissions on the login screen. Sits in front of the per-account lockout, so one client cannot spread its guesses across many usernames.',
            'scope' => 'Per IP address and username',
            'default' => ['enabled' => true, 'maxRequests' => 10, 'windowSeconds' => 60, 'blockSeconds' => 900],
        ],
        'passwordReset' => [
            'label' => 'Password reset codes',
            'description' => 'Reset-code submissions. The code is six digits, so without a limit it can simply be counted through.',
            'scope' => 'Per IP address',
            'default' => ['enabled' => true, 'maxRequests' => 8, 'windowSeconds' => 900, 'blockSeconds' => 900],
        ],
        'passwordResetRequest' => [
            'label' => 'Password reset requests',
            'description' => 'Asking for a reset code, as opposed to submitting one. Deliberately a separate group from the one above: a client that has spent its guesses must not be able to reach for a fresh code, and someone who genuinely never received the first email must not have that count as a guess. It also caps how many mails one client can have sent to somebody else\'s inbox.',
            'scope' => 'Per IP address',
            'default' => ['enabled' => true, 'maxRequests' => 5, 'windowSeconds' => 900, 'blockSeconds' => 900],
        ],
        'twoFactor' => [
            'label' => 'Two-factor codes',
            'description' => 'One-time passcode submissions. The per-session attempt counter resets whenever a new code is sent; this one does not.',
            'scope' => 'Per IP address',
            'default' => ['enabled' => true, 'maxRequests' => 12, 'windowSeconds' => 600, 'blockSeconds' => 900],
        ],
        'leaveRequest' => [
            'label' => 'Leave Request Limit',
            'description' => 'How many leave requests one account may file per day. Set it to 50 and the fifty-first filing that day is refused until the allowance resets. Only a submission that passed validation is counted, so a form the employee got wrong does not spend the allowance.',
            'scope' => 'Per signed-in account. Someone filing on behalf of others spends their own allowance.',
            /*
             * Presented as a plain "N requests per day" control rather than the burst-guard card the
             * other groups use. It is the same three stored numbers underneath -- the cool-down is
             * simply fixed at zero, which is what makes a spent allowance last until the window rolls
             * over instead of adding a separate penalty on top.
             */
            'quota' => true,
            'default' => ['enabled' => true, 'maxRequests' => 50, 'windowSeconds' => 86400, 'blockSeconds' => 0],
        ],
        'api' => [
            'label' => 'General API requests',
            'description' => 'Every other request the application makes. The dashboards poll on timers, so keep this well above normal use — it is a ceiling on runaway scripts, not a throttle on people.',
            'scope' => 'Per signed-in user, or per IP address before sign-in',
            'default' => ['enabled' => true, 'maxRequests' => 300, 'windowSeconds' => 60, 'blockSeconds' => 60],
        ],
    ];
}

/**
 * Accepted ranges. The `api` floor is deliberately high: a dashboard opening fires a dozen requests
 * at once, and a limit below that would lock every administrator out of the screen where they could
 * put it back.
 */
function rate_limit_field_definitions(): array
{
    return [
        'maxRequests' => ['label' => 'Maximum requests', 'min' => 1, 'max' => 100000],
        'windowSeconds' => ['label' => 'Window', 'min' => 5, 'max' => 86400],
        'blockSeconds' => ['label' => 'Cool-down', 'min' => 0, 'max' => 86400],
    ];
}

function rate_limit_rule_field_minimum(string $ruleKey, string $field): int
{
    $minimum = rate_limit_field_definitions()[$field]['min'] ?? 1;

    if ($ruleKey === 'api' && $field === 'maxRequests') {
        return 60;
    }

    return $minimum;
}

function rate_limit_default_settings(): array
{
    $rules = [];

    foreach (rate_limit_rule_definitions() as $ruleKey => $definition) {
        $rules[$ruleKey] = $definition['default'];
    }

    return [
        'enabled' => true,
        'auditBlocked' => true,
        'trustedIps' => [],
        'rules' => $rules,
    ];
}

function rate_limit_normalize_ip(mixed $value): string
{
    $ip = trim((string)($value ?? ''));

    return $ip !== '' && filter_var($ip, FILTER_VALIDATE_IP) !== false ? $ip : '';
}

function rate_limit_normalize_settings(mixed $stored): array
{
    $defaults = rate_limit_default_settings();
    $source = is_array($stored) ? $stored : [];
    $sourceRules = isset($source['rules']) && is_array($source['rules']) ? $source['rules'] : [];
    $fields = rate_limit_field_definitions();
    $rules = [];

    foreach (rate_limit_rule_definitions() as $ruleKey => $definition) {
        $sourceRule = isset($sourceRules[$ruleKey]) && is_array($sourceRules[$ruleKey]) ? $sourceRules[$ruleKey] : [];
        $rule = ['enabled' => boolean_value($sourceRule['enabled'] ?? null, $definition['default']['enabled'])];

        foreach ($fields as $field => $fieldDefinition) {
            $number = filter_var($sourceRule[$field] ?? null, FILTER_VALIDATE_INT);
            $minimum = rate_limit_rule_field_minimum($ruleKey, $field);
            $rule[$field] = $number === false
                ? $definition['default'][$field]
                : max($minimum, min($fieldDefinition['max'], (int)$number));
        }

        $rules[$ruleKey] = $rule;
    }

    $trustedIps = [];

    foreach ((array)($source['trustedIps'] ?? []) as $candidate) {
        $ip = rate_limit_normalize_ip($candidate);

        if ($ip !== '' && !in_array($ip, $trustedIps, true)) {
            $trustedIps[] = $ip;
        }
    }

    return [
        'enabled' => boolean_value($source['enabled'] ?? null, $defaults['enabled']),
        'auditBlocked' => boolean_value($source['auditBlocked'] ?? null, $defaults['auditBlocked']),
        'trustedIps' => $trustedIps,
        'rules' => $rules,
    ];
}

/**
 * The stored configuration, read once per request.
 *
 * The `api` group is checked on every single request, so this cannot be a database round trip each
 * time it is consulted.
 */
function rate_limit_settings(PDO $pdo, bool $refresh = false): array
{
    static $settings = null;

    if ($settings !== null && !$refresh) {
        return $settings;
    }

    try {
        $stored = json_decode(get_application_setting($pdo, HRIS_RATE_LIMIT_SETTING_KEY, ''), true);
    } catch (Throwable $exception) {
        error_log('Rate limit settings lookup failed: ' . $exception->getMessage());
        $stored = null;
    }

    return $settings = rate_limit_normalize_settings($stored);
}

/**
 * Validate an administrator's payload. Out-of-range numbers are reported rather than clamped: a
 * silently corrected limit is a limit the administrator believes they set and did not.
 */
function rate_limit_normalize_payload(array $body): array
{
    $definitions = rate_limit_rule_definitions();
    $fields = rate_limit_field_definitions();
    $sourceRules = isset($body['rules']) && is_array($body['rules']) ? $body['rules'] : [];
    $errors = [];
    $rules = [];

    foreach ($definitions as $ruleKey => $definition) {
        $sourceRule = isset($sourceRules[$ruleKey]) && is_array($sourceRules[$ruleKey]) ? $sourceRules[$ruleKey] : [];
        $rule = ['enabled' => boolean_value($sourceRule['enabled'] ?? null, $definition['default']['enabled'])];

        foreach ($fields as $field => $fieldDefinition) {
            $rawValue = $sourceRule[$field] ?? $definition['default'][$field];
            $number = filter_var($rawValue, FILTER_VALIDATE_INT);
            $minimum = rate_limit_rule_field_minimum($ruleKey, $field);

            if ($number === false) {
                $errors[] = sprintf('%s: %s must be a whole number.', $definition['label'], $fieldDefinition['label']);
                $rule[$field] = $definition['default'][$field];
                continue;
            }

            $number = (int)$number;

            if ($number < $minimum || $number > $fieldDefinition['max']) {
                $errors[] = sprintf(
                    '%s: %s must be between %d and %d.',
                    $definition['label'],
                    $fieldDefinition['label'],
                    $minimum,
                    $fieldDefinition['max']
                );
                $rule[$field] = $definition['default'][$field];
                continue;
            }

            $rule[$field] = $number;
        }

        $rules[$ruleKey] = $rule;
    }

    $trustedSource = $body['trustedIps'] ?? [];
    $trustedSource = is_array($trustedSource) ? $trustedSource : preg_split('/[\s,;]+/', (string)$trustedSource);
    $trustedIps = [];

    foreach ((array)$trustedSource as $candidate) {
        $text = trim((string)$candidate);

        if ($text === '') {
            continue;
        }

        $ip = rate_limit_normalize_ip($text);

        if ($ip === '') {
            $errors[] = sprintf('"%s" is not a valid IP address.', $text);
            continue;
        }

        if (!in_array($ip, $trustedIps, true)) {
            $trustedIps[] = $ip;
        }
    }

    return [
        'settings' => [
            'enabled' => boolean_value($body['enabled'] ?? null, true),
            'auditBlocked' => boolean_value($body['auditBlocked'] ?? null, true),
            'trustedIps' => $trustedIps,
            'rules' => $rules,
        ],
        'errors' => $errors,
    ];
}

function store_rate_limit_settings(PDO $pdo, array $settings): array
{
    $normalized = rate_limit_normalize_settings($settings);
    $encoded = json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encoded === false) {
        throw new RuntimeException('Unable to encode rate limit settings.');
    }

    store_application_setting($pdo, HRIS_RATE_LIMIT_SETTING_KEY, $encoded);
    rate_limit_settings($pdo, true);

    return $normalized;
}

/** MySQL's "base table or view not found", the one error worth answering by provisioning. */
function rate_limit_table_is_missing(PDOException $exception): bool
{
    return $exception->getCode() === '42S02';
}


function rate_limit_bucket_key(string $ruleKey, string $identifier): string
{
    return substr($ruleKey, 0, 40) . ':' . sha1(strtolower($identifier));
}

function rate_limit_client_ip(): string
{
    $ip = function_exists('client_ip_address') ? client_ip_address() : ($_SERVER['REMOTE_ADDR'] ?? null);

    return rate_limit_normalize_ip($ip) ?: 'unknown';
}

function rate_limit_ip_is_trusted(array $settings, string $ip): bool
{
    return $ip !== '' && in_array($ip, $settings['trustedIps'] ?? [], true);
}

/** "45 seconds", "3 minutes", "1 hour" — for the message a blocked caller reads. */
function rate_limit_duration_text(int $seconds): string
{
    $seconds = max(1, $seconds);

    if ($seconds < 60) {
        return $seconds . ' second' . ($seconds === 1 ? '' : 's');
    }

    if ($seconds < 3600) {
        $minutes = (int)ceil($seconds / 60);

        return $minutes . ' minute' . ($minutes === 1 ? '' : 's');
    }

    $hours = (int)ceil($seconds / 3600);

    return $hours . ' hour' . ($hours === 1 ? '' : 's');
}

/**
 * Count one request against a bucket and say whether it may proceed.
 *
 * Read-then-write rather than a single atomic upsert. Two requests landing in the same millisecond
 * can therefore have one of them counted twice or not at all, which for a limiter measured in tens
 * of requests is noise — and the readable version is the one that stays correct when the next person
 * changes it.
 *
 * The returned array always carries `allowed`; `retryAfter` and `blockStarted` are only meaningful
 * when it is false.
 */
function rate_limit_consume(PDO $pdo, string $ruleKey, string $identifier): array
{
    $allowed = ['allowed' => true, 'retryAfter' => 0, 'blockStarted' => false, 'limit' => 0, 'remaining' => 0];

    /*
     * Counters are skipped inside somebody's transaction: the write below would join it and be
     * rolled back with it, so the hit would be lost. Nothing is counted on those requests.
     */
    if ($pdo->inTransaction()) {
        return $allowed;
    }

    $settings = rate_limit_settings($pdo);
    $rule = $settings['rules'][$ruleKey] ?? null;

    if (!$settings['enabled'] || $rule === null || !$rule['enabled']) {
        return $allowed;
    }

    $identifier = substr(trim($identifier), 0, 190);

    if ($identifier === '') {
        return $allowed;
    }

    $bucketKey = rate_limit_bucket_key($ruleKey, $identifier);
    $now = time();
    $limit = (int)$rule['maxRequests'];
    $window = (int)$rule['windowSeconds'];
    $blockSeconds = (int)$rule['blockSeconds'];

    try {
        $statement = $pdo->prepare(
            'SELECT hit_count, window_started_at, blocked_until, blocked_count
             FROM rate_limits
             WHERE bucket_key = :bucket_key
             LIMIT 1'
        );
        $statement->execute([':bucket_key' => $bucketKey]);

        $row = $statement->fetch() ?: null;

        $blockedUntil = $row === null ? null : datetime_timestamp($row['blocked_until'] ?? null);

        // Still serving a cool-down: refuse without counting, so a client that keeps hammering
        // cannot extend its own penalty indefinitely.
        if ($blockedUntil !== null && $blockedUntil > $now) {
            return [
                'allowed' => false,
                'retryAfter' => $blockedUntil - $now,
                'blockStarted' => false,
                'limit' => $limit,
                'remaining' => 0,
            ];
        }

        $windowStartedAt = $row === null ? null : datetime_timestamp($row['window_started_at'] ?? null);
        $windowExpired = $windowStartedAt === null || ($now - $windowStartedAt) >= $window;
        $hitCount = $windowExpired ? 1 : (int)($row['hit_count'] ?? 0) + 1;
        $windowStartedAt = $windowExpired ? $now : $windowStartedAt;
        $exceeded = $hitCount > $limit;

        /*
         * With no cool-down configured the refusal simply lasts out the window, which is what makes
         * a cool-down of zero mean "no extra penalty" rather than "no limit".
         */
        $retryAfter = $exceeded
            ? ($blockSeconds > 0 ? $blockSeconds : max(1, $window - ($now - $windowStartedAt)))
            : 0;
        $blockedUntilValue = $exceeded ? date('Y-m-d H:i:s', $now + $retryAfter) : null;

        $parameters = [
            ':bucket_key' => $bucketKey,
            ':rule_key' => $ruleKey,
            ':identifier' => $identifier,
            ':hit_count' => $hitCount,
            ':window_started_at' => date('Y-m-d H:i:s', $windowStartedAt),
            ':blocked_until' => $blockedUntilValue,
            ':blocked_count' => (int)($row['blocked_count'] ?? 0) + ($exceeded ? 1 : 0),
        ];

        $write = $pdo->prepare(
            'INSERT INTO rate_limits
                (bucket_key, rule_key, identifier, hit_count, window_started_at, blocked_until, blocked_count)
             VALUES
                (:bucket_key, :rule_key, :identifier, :hit_count, :window_started_at, :blocked_until, :blocked_count)
             ON DUPLICATE KEY UPDATE
                hit_count = VALUES(hit_count),
                window_started_at = VALUES(window_started_at),
                blocked_until = VALUES(blocked_until),
                blocked_count = VALUES(blocked_count),
                updated_at = CURRENT_TIMESTAMP'
        );
        $write->execute($parameters);

        rate_limit_prune($pdo);

        return [
            'allowed' => !$exceeded,
            'retryAfter' => $retryAfter,
            // True only on the request that tripped the limit, which is the one worth auditing.
            'blockStarted' => $exceeded,
            'limit' => $limit,
            'remaining' => max(0, $limit - $hitCount),
        ];
    } catch (Throwable $exception) {
        error_log('Rate limit check failed for ' . $ruleKey . ': ' . $exception->getMessage());

        return $allowed;
    }
}

/**
 * Drop buckets nothing has touched for a day. Rolled rather than scheduled — there is no cron in
 * this deployment, and a table of expired counters is the only thing that would otherwise grow
 * without limit.
 */
function rate_limit_prune(PDO $pdo): void
{
    static $pruned = false;

    if ($pruned || random_int(1, 200) !== 1) {
        return;
    }

    $pruned = true;

    try {
        $pdo->exec('DELETE FROM rate_limits WHERE updated_at < (NOW() - INTERVAL 1 DAY)');
    } catch (Throwable $exception) {
        error_log('Rate limit prune failed: ' . $exception->getMessage());
    }
}

/**
 * Count the request and answer it with a 429 when the bucket is spent.
 *
 * Everything about the block is in the body as well as the status: the client screens read
 * `message`, and `retryAfter` is what a countdown would need.
 */
function rate_limit_enforce(PDO $pdo, string $ruleKey, string $identifier, ?array $user = null, string $message = ''): void
{
    $settings = rate_limit_settings($pdo);
    $ip = rate_limit_client_ip();

    if (rate_limit_ip_is_trusted($settings, $ip)) {
        return;
    }

    $result = rate_limit_consume($pdo, $ruleKey, $identifier);

    if ($result['allowed']) {
        return;
    }

    $waitText = rate_limit_duration_text((int)$result['retryAfter']);
    $definition = rate_limit_rule_definitions()[$ruleKey] ?? null;

    // Only the request that tripped the limit is logged. Auditing every refusal afterwards would
    // fill the trail with the very flood being blocked.
    if ($result['blockStarted'] && !empty($settings['auditBlocked'])) {
        write_auth_audit(
            $pdo,
            $user,
            'rate_limit.blocked',
            sprintf(
                'Requests were rate limited: %s from client address %s.',
                $definition['label'] ?? $ruleKey,
                $ip
            ),
            [
                'rule' => $ruleKey,
                'identifier' => $identifier,
                'limit' => $result['limit'],
                'retryAfterSeconds' => $result['retryAfter'],
            ]
        );
    }

    if (!headers_sent()) {
        header('Retry-After: ' . max(1, (int)$result['retryAfter']));
    }

    json_response([
        'success' => false,
        'reason' => 'rate_limited',
        'message' => ($message !== '' ? $message : 'Too many requests.') . ' Please try again in ' . $waitText . '.',
        'retryAfter' => (int)$result['retryAfter'],
    ], 429);
}

/*
 * Which endpoints are exempt from the general ceiling, and who a request counts as, used to be
 * decided here. Both moved to throttle.php, where the answer belongs beside the rest of the
 * throttling policy rather than inside the counter that serves it.
 *
 * Listing the live counters and releasing one lived here too, read and written by the Rate Limiting
 * screen's Active Limits panel. Both went when that panel was removed. The counters themselves are
 * untouched -- rate_limit_consume() still writes them and rate_limit_prune() still clears out what
 * has expired -- there is simply nothing that reads them back or clears one early any more.
 */

