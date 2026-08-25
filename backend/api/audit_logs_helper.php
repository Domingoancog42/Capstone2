<?php
declare(strict_types=1);

/**
 * The proxies whose forwarding headers this application believes.
 *
 * Only the loopback addresses, because the only proxy in this deployment is the React dev server's
 * setupProxy.js, which runs on this machine. Put a real reverse proxy in front of Apache one day and
 * its address belongs here -- and nowhere else, so that this stays the single place that decides what
 * "trusted" means.
 */
function trusted_proxy_addresses(): array
{
    return ['127.0.0.1', '::1'];
}

/**
 * Who the request came from.
 *
 * Every header naming a client -- X-Forwarded-For and the rest -- is written by whoever sent the
 * request, so any of them can say anything. This used to read the first one it found and take the
 * value at face value, which made the whole set of per-IP rate limits (sign-in, reset codes,
 * two-factor codes) opt-out: send a different X-Forwarded-For with each attempt and every attempt
 * lands in a fresh bucket, with an unlimited supply of buckets. It also meant the audit trail
 * recorded whatever address an attacker preferred it to record.
 *
 * Two rules make that safe:
 *
 *   1. Forwarding headers are read *only* when the request actually arrived from a trusted proxy.
 *      Straight from Apache to a browser there is no proxy, so there is nothing to believe and
 *      REMOTE_ADDR -- which comes from the TCP connection and cannot be forged -- is the answer.
 *
 *   2. From a trusted proxy, the LAST entry of X-Forwarded-For is used rather than the first. A
 *      proxy appends the address it received the connection from, so the final entry is the one our
 *      own proxy wrote. A client that pre-seeds the header only ever prepends to the part in front
 *      of it, which is exactly the part this ignores.
 *
 * Single-valued vendor headers (X-Real-IP, CF-Connecting-IP, Client-IP) are no longer consulted at
 * all: nothing in this stack sets them, so their only remaining use was to be forged.
 */
function client_ip_address(): ?string
{
    $remoteAddress = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));
    $remoteIsValid = $remoteAddress !== '' && filter_var($remoteAddress, FILTER_VALIDATE_IP) !== false;

    if ($remoteIsValid && in_array($remoteAddress, trusted_proxy_addresses(), true)) {
        $forwarded = array_filter(array_map('trim', explode(',', (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''))));

        while ($forwarded !== []) {
            $candidate = (string)array_pop($forwarded);

            if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
                return $candidate;
            }
        }
    }

    return $remoteIsValid ? $remoteAddress : null;
}

function audit_public_ip(?string $ipAddress): bool
{
    return $ipAddress !== null
        && $ipAddress !== ''
        && filter_var(
            $ipAddress,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        ) !== false;
}

function audit_loopback_ip(?string $ipAddress): bool
{
    return in_array($ipAddress, ['127.0.0.1', '::1'], true);
}

function audit_location_label(array $geo): string
{
    $parts = array_values(array_filter([
        trim((string)($geo['city'] ?? '')),
        trim((string)($geo['region'] ?? '')),
        trim((string)($geo['country_name'] ?? '')),
    ]));

    return $parts !== [] ? implode(', ', $parts) : 'External network';
}

function audit_http_json(string $url): ?array
{
    $body = null;

    if (function_exists('curl_init')) {
        $curl = curl_init($url);

        if ($curl !== false) {
            curl_setopt_array($curl, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 2,
                CURLOPT_TIMEOUT => 3,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 2,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
                CURLOPT_USERAGENT => 'HRIS Audit Logger',
            ]);

            $response = curl_exec($curl);
            $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            curl_close($curl);

            if (is_string($response) && $response !== '' && $status >= 200 && $status < 300) {
                $body = $response;
            }
        }
    }

    if ($body === null) {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "Accept: application/json\r\nUser-Agent: HRIS Audit Logger\r\n",
                'timeout' => 3,
                'ignore_errors' => true,
            ],
        ]);
        $response = @file_get_contents($url, false, $context);

        if (is_string($response) && $response !== '') {
            $body = $response;
        }
    }

    if ($body === null) {
        return null;
    }

    $decoded = json_decode($body, true);

    return is_array($decoded) ? $decoded : null;
}

function audit_ipapi_lookup(string $ipAddress): ?array
{
    static $cache = [];

    if (array_key_exists($ipAddress, $cache)) {
        return $cache[$ipAddress];
    }

    $url = 'https://ipapi.co/' . rawurlencode($ipAddress) . '/json/';
    $geo = audit_http_json($url);

    if ($geo === null || ($geo['error'] ?? false) === true) {
        $cache[$ipAddress] = null;
        return null;
    }

    $cache[$ipAddress] = $geo;

    return $geo;
}

function audit_current_public_ip_lookup(): ?array
{
    static $resolved = false;
    static $geo = null;

    if ($resolved) {
        return $geo;
    }

    $resolved = true;
    $result = audit_http_json('https://ipapi.co/json/');

    if (
        $result === null
        || ($result['error'] ?? false) === true
        || !audit_public_ip((string)($result['ip'] ?? ''))
    ) {
        $geo = null;
        return null;
    }

    $geo = $result;

    return $geo;
}

function audit_location_from_ip(?string $ipAddress): string
{
    if ($ipAddress === null || $ipAddress === '') {
        return 'Unknown';
    }

    if (audit_loopback_ip($ipAddress)) {
        return 'Localhost';
    }

    if (!audit_public_ip($ipAddress)) {
        return 'Private network';
    }

    $geo = audit_ipapi_lookup($ipAddress);

    return $geo === null ? 'External network' : audit_location_label($geo);
}

function audit_network_details_from_geo(array $geo): array
{
    $keys = [
        'ip',
        'network',
        'version',
        'city',
        'region',
        'country',
        'country_name',
        'postal',
        'latitude',
        'longitude',
        'timezone',
        'utc_offset',
        'asn',
        'org',
    ];

    $details = [];
    foreach ($keys as $key) {
        if (array_key_exists($key, $geo) && $geo[$key] !== null && $geo[$key] !== '') {
            $details[$key] = $geo[$key];
        }
    }

    return $details;
}

function audit_network_details(?string $ipAddress): array
{
    if (!audit_public_ip($ipAddress)) {
        return [];
    }

    $geo = audit_ipapi_lookup((string)$ipAddress);

    return $geo === null ? [] : audit_network_details_from_geo($geo);
}

function audit_browser_from_user_agent(string $userAgent): string
{
    if ($userAgent === '') {
        return 'Unknown';
    }

    if (preg_match('/Edg\//i', $userAgent)) {
        return 'Microsoft Edge';
    }
    if (preg_match('/SamsungBrowser\//i', $userAgent)) {
        return 'Samsung Internet';
    }
    if (preg_match('/OPR\/|Opera/i', $userAgent)) {
        return 'Opera';
    }
    if (preg_match('/CriOS\/|Chrome\//i', $userAgent)) {
        return 'Chrome';
    }
    if (preg_match('/FxiOS\/|Firefox\//i', $userAgent)) {
        return 'Firefox';
    }
    if (preg_match('/Version\/.*Safari\//i', $userAgent)) {
        return 'Safari';
    }
    if (preg_match('/MSIE|Trident/i', $userAgent)) {
        return 'Internet Explorer';
    }

    return 'Unknown';
}

function audit_header_text(string $headerName): string
{
    return trim((string)($_SERVER[$headerName] ?? ''), " \t\n\r\0\x0B\"");
}

function audit_os_from_user_agent(string $userAgent, ?string $clientPlatform = null, ?string $clientPlatformVersion = null): string
{
    $platform = trim((string)($clientPlatform ?? ''));
    $platformVersion = trim((string)($clientPlatformVersion ?? ''), " \t\n\r\0\x0B\"");

    if (strcasecmp($platform, 'Windows') === 0) {
        $majorVersion = (int)explode('.', $platformVersion)[0];

        if ($majorVersion >= 13) {
            return 'Windows 11';
        }
        if ($majorVersion >= 1) {
            return 'Windows 10';
        }
    }

    if ($userAgent === '') {
        return 'Unknown';
    }

    if (preg_match('/Windows NT 10\.0/i', $userAgent)) {
        return 'Windows 10/11';
    }
    if (preg_match('/Windows NT 6\.3/i', $userAgent)) {
        return 'Windows 8.1';
    }
    if (preg_match('/Windows NT 6\.2/i', $userAgent)) {
        return 'Windows 8';
    }
    if (preg_match('/Windows NT 6\.1/i', $userAgent)) {
        return 'Windows 7';
    }
    if (preg_match('/Windows NT/i', $userAgent)) {
        return 'Windows';
    }
    if (preg_match('/CrOS/i', $userAgent)) {
        return 'Chrome OS';
    }
    if (preg_match('/Android/i', $userAgent)) {
        return 'Android';
    }
    if (preg_match('/iPhone|iPad|iPod/i', $userAgent)) {
        return 'iOS';
    }
    if (preg_match('/Mac OS X|Macintosh/i', $userAgent)) {
        return 'macOS';
    }
    if (preg_match('/Linux/i', $userAgent)) {
        return 'Linux';
    }

    return 'Unknown';
}

function audit_device_from_user_agent(string $userAgent): string
{
    if ($userAgent === '') {
        return 'Unknown';
    }

    if (preg_match('/bot|crawler|spider|crawling/i', $userAgent)) {
        return 'Bot';
    }
    if (preg_match('/iPad|Tablet/i', $userAgent)) {
        return 'Tablet';
    }
    if (preg_match('/iPhone|Mobile/i', $userAgent)) {
        return 'Mobile';
    }
    if (preg_match('/Android/i', $userAgent)) {
        return 'Android Tablet';
    }

    return 'Desktop';
}

function audit_request_context(): array
{
    $detectedIpAddress = client_ip_address();
    $ipAddress = $detectedIpAddress;
    $userAgent = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    $clientPlatform = audit_header_text('HTTP_X_CLIENT_PLATFORM') ?: audit_header_text('HTTP_SEC_CH_UA_PLATFORM');
    $clientPlatformVersion = audit_header_text('HTTP_X_CLIENT_PLATFORM_VERSION') ?: audit_header_text('HTTP_SEC_CH_UA_PLATFORM_VERSION');
    $localPublicGeo = null;

    if (audit_loopback_ip($detectedIpAddress)) {
        $localPublicGeo = audit_current_public_ip_lookup();
        $publicIpAddress = trim((string)($localPublicGeo['ip'] ?? ''));

        if (audit_public_ip($publicIpAddress)) {
            $ipAddress = $publicIpAddress;
        }
    }

    $networkDetails = $localPublicGeo !== null
        ? audit_network_details_from_geo($localPublicGeo)
        : audit_network_details($ipAddress);

    if ($detectedIpAddress !== null && $detectedIpAddress !== $ipAddress) {
        $networkDetails['detected_request_ip'] = $detectedIpAddress;
        $networkDetails['ip_resolution'] = 'localhost_public_ip_fallback';
    }

    return [
        'ipAddress' => $ipAddress,
        'location' => $localPublicGeo !== null
            ? audit_location_label($localPublicGeo)
            : audit_location_from_ip($ipAddress),
        'device' => audit_device_from_user_agent($userAgent),
        'browser' => audit_browser_from_user_agent($userAgent),
        'os' => audit_os_from_user_agent($userAgent, $clientPlatform, $clientPlatformVersion),
        'userAgent' => $userAgent,
        'networkDetails' => $networkDetails,
    ];
}

function audit_user_display_name(?array $user): ?string
{
    if ($user === null) {
        return null;
    }

    $fullName = trim((string)($user['full_name'] ?? ''));

    if ($fullName !== '') {
        return $fullName;
    }

    $firstName = trim((string)($user['first_name'] ?? ''));
    $middleName = trim((string)($user['middle_name'] ?? ''));
    $lastName = trim((string)($user['last_name'] ?? ''));
    $name = trim(implode(' ', array_filter([$firstName, $middleName, $lastName])));

    if ($name !== '') {
        return $name;
    }

    $username = trim((string)($user['username'] ?? ''));

    return $username !== '' ? $username : null;
}

function audit_details_json(array $details, array $context): string
{
    if (($context['networkDetails'] ?? []) !== []) {
        $details['network'] = $context['networkDetails'];
    }

    $encoded = json_encode($details, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    return $encoded === false ? '{}' : $encoded;
}

function audit_log_row_from_database(array $row): array
{
    return [
        'id' => (int)($row['id'] ?? 0),
        'userId' => $row['user_id'] !== null ? (int)$row['user_id'] : null,
        'userName' => (string)($row['user_name'] ?? ''),
        'userEmail' => (string)($row['user_email'] ?? ''),
        'action' => (string)($row['action'] ?? ''),
        'ipAddress' => (string)($row['ip_address'] ?? ''),
        'location' => (string)($row['location'] ?? ''),
        'device' => (string)($row['device'] ?? ''),
        'browser' => (string)($row['browser'] ?? ''),
        'os' => (string)($row['os'] ?? ''),
        'actorName' => (string)($row['actor_name'] ?? ''),
        'actorRole' => (string)($row['actor_role'] ?? ''),
        'category' => (string)($row['category'] ?? ''),
        'summary' => (string)($row['summary'] ?? ''),
        'detailsJson' => (string)($row['details_json'] ?? ''),
        'userAgent' => (string)($row['user_agent'] ?? ''),
        'createdAt' => (string)($row['created_at'] ?? ''),
    ];
}

function audit_log_filters(array $params): array
{
    $range = strtolower(trim((string)($params['range'] ?? '30d')));
    $rangeDays = match ($range) {
        '7d' => 7,
        '90d' => 90,
        'all', 'all_time', 'alltime' => null,
        default => 30,
    };
    $normalizedRange = $rangeDays === null ? 'all' : $rangeDays . 'd';
    $page = filter_var($params['page'] ?? 1, FILTER_VALIDATE_INT);
    $perPage = filter_var($params['perPage'] ?? ($params['per_page'] ?? 25), FILTER_VALIDATE_INT);
    $maxPerPage = filter_var($params['maxPerPage'] ?? 100, FILTER_VALIDATE_INT);
    $maxPerPage = max(5, min(500, $maxPerPage === false ? 100 : (int)$maxPerPage));

    return [
        'search' => trim((string)($params['search'] ?? '')),
        'range' => $normalizedRange,
        'rangeDays' => $rangeDays,
        'page' => max(1, $page === false ? 1 : (int)$page),
        'perPage' => max(5, min($maxPerPage, $perPage === false ? 25 : (int)$perPage)),
    ];
}

function audit_log_where_sql(array $filters, array &$bindings): string
{
    $where = [];

    if ($filters['rangeDays'] !== null) {
        $where[] = 'log.created_at >= DATE_SUB(NOW(), INTERVAL ' . (int)$filters['rangeDays'] . ' DAY)';
    }

    if ($filters['search'] !== '') {
        $where[] = '(
            log.action LIKE :search
            OR log.summary LIKE :search
            OR log.ip_address LIKE :search
            OR log.location LIKE :search
            OR log.device LIKE :search
            OR log.browser LIKE :search
            OR log.os LIKE :search
            OR log.category LIKE :search
            OR log.actor_name LIKE :search
            OR log.actor_role LIKE :search
            OR account.username LIKE :search
            OR account.email LIKE :search
            OR employee.first_name LIKE :search
            OR employee.middle_name LIKE :search
            OR employee.last_name LIKE :search
        )';
        $bindings[':search'] = '%' . $filters['search'] . '%';
    }

    return $where === [] ? '' : ' WHERE ' . implode(' AND ', $where);
}

function audit_log_from_join_sql(): string
{
    return ' FROM audit_logs log
         LEFT JOIN users account
            ON account.id = COALESCE(log.user_id, log.actor_id)
         LEFT JOIN employees employee
            ON employee.email COLLATE utf8mb4_unicode_ci = account.email COLLATE utf8mb4_unicode_ci
           AND employee.is_archived = 0';
}

function paginated_audit_logs(PDO $pdo, array $params = []): array
{
    ensure_audit_logs_table($pdo);

    $filters = audit_log_filters($params);
    $bindings = [];
    $fromSql = audit_log_from_join_sql();
    $whereSql = audit_log_where_sql($filters, $bindings);

    $countStatement = $pdo->prepare('SELECT COUNT(*)' . $fromSql . $whereSql);
    foreach ($bindings as $name => $value) {
        $countStatement->bindValue($name, $value, PDO::PARAM_STR);
    }
    $countStatement->execute();

    $total = max(0, (int)$countStatement->fetchColumn());
    $totalPages = max(1, (int)ceil($total / $filters['perPage']));
    $page = min($filters['page'], $totalPages);
    $offset = ($page - 1) * $filters['perPage'];

    $statement = $pdo->prepare(
        'SELECT
            log.id,
            COALESCE(log.user_id, log.actor_id) AS user_id,
            COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(employee.first_name, ""), " ", COALESCE(employee.middle_name, ""), " ", COALESCE(employee.last_name, ""))), ""),
                NULLIF(log.actor_name, ""),
                NULLIF(account.username, "")
            ) AS user_name,
            account.email AS user_email,
            log.action,
            log.ip_address,
            log.location,
            log.device,
            log.browser,
            log.os,
            log.actor_name,
            log.actor_role,
            log.category,
            log.summary,
            log.details_json,
            log.user_agent,
            log.created_at
         ' . $fromSql . $whereSql . '
         ORDER BY log.created_at DESC, log.id DESC
         LIMIT :limit OFFSET :offset'
    );

    foreach ($bindings as $name => $value) {
        $statement->bindValue($name, $value, PDO::PARAM_STR);
    }
    $statement->bindValue(':limit', $filters['perPage'], PDO::PARAM_INT);
    $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
    $statement->execute();

    $logs = array_map('audit_log_row_from_database', $statement->fetchAll());

    return [
        'auditLogs' => $logs,
        'pagination' => [
            'page' => $page,
            'perPage' => $filters['perPage'],
            'total' => $total,
            'totalPages' => $totalPages,
            'from' => $total === 0 ? 0 : $offset + 1,
            'to' => min($offset + count($logs), $total),
        ],
        'filters' => [
            'search' => $filters['search'],
            'range' => $filters['range'],
        ],
    ];
}

function fetch_audit_logs(PDO $pdo, int $limit = 250): array
{
    $result = paginated_audit_logs($pdo, [
        'range' => 'all',
        'page' => 1,
        'perPage' => $limit,
        'maxPerPage' => 500,
    ]);

    return $result['auditLogs'];
}
