<?php
declare(strict_types=1);

/*
 * trusted_proxy_addresses() now lives in connection-pdo.php.
 *
 * It moved because the session cookie has to know whether the connection is encrypted before it can
 * decide whether to carry the Secure flag, and that happens near the top of connection-pdo.php --
 * long before this file is loaded. Both readers of the list, client_ip_address() below and
 * request_is_https() over there, apply the same rule to different headers, so the list has to sit
 * where the earlier of the two can reach it.
 *
 * Nothing needs to be required here to get it: connection-pdo.php is loaded before this file on both
 * paths that include it (audit_logs.php requires it first, and settings.php is itself required by it).
 */

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
    $remoteAddress = audit_plain_ipv4(trim((string)($_SERVER['REMOTE_ADDR'] ?? '')));
    $remoteIsValid = $remoteAddress !== '' && filter_var($remoteAddress, FILTER_VALIDATE_IP) !== false;

    if ($remoteIsValid && in_array($remoteAddress, trusted_proxy_addresses(), true)) {
        $forwarded = array_filter(array_map('trim', explode(',', (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''))));

        while ($forwarded !== []) {
            $candidate = audit_plain_ipv4((string)array_pop($forwarded));

            if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
                return $candidate;
            }
        }
    }

    return $remoteIsValid ? $remoteAddress : null;
}

/**
 * An IPv4 address the way people write it.
 *
 * A dual-stack listener -- the React dev server that proxies to Apache is one -- reports an IPv4
 * client as an IPv4-mapped IPv6 address, `::ffff:192.168.1.7`, and forwards it in that form. It is
 * the same address, so it is recorded as the 192.168.1.7 everyone else calls it. `::1` is loopback
 * under another name for the same reason.
 */
function audit_plain_ipv4(string $ipAddress): string
{
    if (preg_match('/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i', $ipAddress, $match)) {
        return $match[1];
    }

    return $ipAddress === '::1' ? '127.0.0.1' : $ipAddress;
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

/**
 * The IPv4 address this machine answers to on the office network.
 *
 * A request from the server's own console reaches PHP as loopback, which names no machine at all.
 * The audit trail used to swap that for the machine's *public* address from ipapi.co, which on an
 * IPv6 connection produced a 39-character address nobody on the LAN would recognise. The address
 * the machine is actually known by is its LAN one -- the same 192.168.x.x every other workstation
 * is recorded under when it reaches Apache directly -- so that is what a console request records.
 *
 * Connecting a UDP socket picks the interface the machine would route out of, without sending a
 * packet; on a box with several adapters (a VirtualBox host-only network, say) that is the one that
 * matters. The hostname lookup is the fallback for a machine with no default route at all.
 */
function audit_server_lan_ipv4(): ?string
{
    static $resolved = false;
    static $address = null;

    if ($resolved) {
        return $address;
    }

    $resolved = true;

    $candidates = [];
    $socket = @stream_socket_client('udp://8.8.8.8:53', $errorNumber, $errorMessage, 1);

    if ($socket !== false) {
        $candidates[] = preg_replace('/:\d+$/', '', (string)stream_socket_get_name($socket, false));
        fclose($socket);
    }

    $hostname = (string)gethostname();
    if ($hostname !== '') {
        $candidates[] = (string)gethostbyname($hostname);
    }

    foreach ($candidates as $candidate) {
        if (
            filter_var($candidate, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false
            && !audit_loopback_ip($candidate)
        ) {
            $address = $candidate;
            break;
        }
    }

    return $address;
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

    /*
     * A console request is recorded under the machine's LAN address (see audit_server_lan_ipv4()).
     * The public lookup is kept for the location column and the network details only; the public
     * address itself no longer stands in for the IP.
     */
    if (audit_loopback_ip($detectedIpAddress)) {
        $localPublicGeo = audit_current_public_ip_lookup();
        $ipAddress = audit_server_lan_ipv4() ?? $detectedIpAddress;
    }

    $networkDetails = $localPublicGeo !== null
        ? audit_network_details_from_geo($localPublicGeo)
        : audit_network_details($ipAddress);

    if ($detectedIpAddress !== null && $detectedIpAddress !== $ipAddress) {
        $networkDetails['detected_request_ip'] = $detectedIpAddress;
        $networkDetails['ip_resolution'] = 'localhost_lan_ipv4';
    }

    return [
        'ipAddress' => $ipAddress,
        'location' => $localPublicGeo !== null
            ? audit_location_label($localPublicGeo)
            : audit_location_from_ip($detectedIpAddress),
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
    $perPage = filter_var($params['perPage'] ?? ($params['per_page'] ?? 10), FILTER_VALIDATE_INT);
    $maxPerPage = filter_var($params['maxPerPage'] ?? 200, FILTER_VALIDATE_INT);
    $userId = filter_var($params['userId'] ?? ($params['user_id'] ?? null), FILTER_VALIDATE_INT);
    $accountHistory = filter_var(
        $params['accountHistory'] ?? ($params['account_history'] ?? false),
        FILTER_VALIDATE_BOOLEAN
    );
    $maxPerPage = max(5, min(500, $maxPerPage === false ? 200 : (int)$maxPerPage));

    return [
        'search' => trim((string)($params['search'] ?? '')),
        'userId' => $userId === false || (int)$userId <= 0 ? null : (int)$userId,
        'accountHistory' => $accountHistory,
        'range' => $normalizedRange,
        'rangeDays' => $rangeDays,
        'page' => max(1, $page === false ? 1 : (int)$page),
        'perPage' => max(5, min($maxPerPage, $perPage === false ? 10 : (int)$perPage)),
    ];
}

function audit_log_where_sql(array $filters, array &$bindings): string
{
    $where = [];

    if ($filters['rangeDays'] !== null) {
        $where[] = 'log.created_at >= DATE_SUB(NOW(), INTERVAL ' . (int)$filters['rangeDays'] . ' DAY)';
    }

    if ($filters['userId'] !== null) {
        if ($filters['accountHistory']) {
            // The profile history belongs to the affected login, not every other user or employee
            // record this administrator happened to manage as the actor.
            $where[] = 'log.user_id = :account_history_user_id';
            $bindings[':account_history_user_id'] = $filters['userId'];
        } else {
            // Keep both sides of a general audit event: user_id is the affected login on detailed
            // rows, while actor_id identifies the signed-in account on generic activity rows.
            $where[] = '(log.user_id = :account_user_id OR log.actor_id = :account_actor_id)';
            $bindings[':account_user_id'] = $filters['userId'];
            $bindings[':account_actor_id'] = $filters['userId'];
        }
    }

    if ($filters['accountHistory']) {
        $accountActionPatterns = [
            'login.%',
            'logout.%',
            'password.%',
            'email_verification.%',
            'two_factor.otp_%',
            'two_factor.verify_%',
            'two_factor.resend_%',
            'two_factor.personal_setting_updated',
            'account.%',
        ];
        $accountActionWhere = [];

        foreach ($accountActionPatterns as $index => $pattern) {
            $placeholder = ':account_action_' . $index;
            $accountActionWhere[] = 'log.action LIKE ' . $placeholder;
            $bindings[$placeholder] = $pattern;
        }

        $where[] = '(' . implode(' OR ', $accountActionWhere) . ')';
    }

    if ($filters['search'] !== '') {
        /*
         * Native PDO prepares do not permit one named placeholder to be reused. The old query used
         * `:search` for every column, so any non-empty search failed with SQLSTATE[HY093] before it
         * could return a row. Give each LIKE its own binding while retaining one search value.
         */
        $searchColumns = [
            'log.action',
            'log.summary',
            'log.ip_address',
            'log.location',
            'log.device',
            'log.browser',
            'log.os',
            'log.category',
            'log.actor_name',
            'log.actor_role',
            'account.username',
            'account.email',
            'employee.first_name',
            'employee.middle_name',
            'employee.last_name',
        ];
        $searchWhere = [];

        foreach ($searchColumns as $index => $column) {
            $placeholder = ':search_' . $index;
            $searchWhere[] = $column . ' LIKE ' . $placeholder;
            $bindings[$placeholder] = '%' . $filters['search'] . '%';
        }

        $where[] = '(' . implode(' OR ', $searchWhere) . ')';
    }

    return $where === [] ? '' : ' WHERE ' . implode(' AND ', $where);
}

function audit_log_from_join_sql(): string
{
    return ' FROM audit_logs log
         LEFT JOIN users account
            ON account.id = COALESCE(log.actor_id, log.user_id)
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
        $countStatement->bindValue($name, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    $countStatement->execute();

    $total = max(0, (int)$countStatement->fetchColumn());
    $totalPages = max(1, (int)ceil($total / $filters['perPage']));
    $page = min($filters['page'], $totalPages);
    $offset = ($page - 1) * $filters['perPage'];

    $statement = $pdo->prepare(
        'SELECT
            log.id,
            COALESCE(log.actor_id, log.user_id) AS user_id,
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
        $statement->bindValue($name, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
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
            'userId' => $filters['userId'],
            'accountHistory' => $filters['accountHistory'],
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
