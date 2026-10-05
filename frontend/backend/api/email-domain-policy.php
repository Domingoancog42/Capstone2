<?php
declare(strict_types=1);

require_once __DIR__ . '/settings.php';

const HRIS_EMAIL_DOMAIN_POLICY_KEY = 'email_domain_policy';

function email_domain_policy_defaults(): array
{
    return [
        'enabled' => false,
        'allowListedOnly' => false,
        'allowedDomains' => ['gmail.com'],
        'blockedDomains' => [
            '10minutemail.com',
            'guerrillamail.com',
            'mailinator.com',
            'tempmail.com',
            'temp-mail.org',
            'yopmail.com',
        ],
    ];
}

function email_domain_policy_bool(mixed $value, bool $default = false): bool
{
    if ($value === null || $value === '') {
        return $default;
    }

    if (is_bool($value)) {
        return $value;
    }

    return in_array(strtolower(trim((string)$value)), ['1', 'true', 'yes', 'on'], true);
}

function email_domain_policy_normalize_domain(mixed $value): string
{
    $domain = strtolower(trim((string)($value ?? '')));
    $domain = preg_replace('#^https?://#', '', $domain) ?? '';
    $domain = preg_replace('#/.*$#', '', $domain) ?? '';
    $domain = ltrim($domain, '@.');

    if ($domain === '' || strlen($domain) > 253) {
        return '';
    }

    if (preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/', $domain) !== 1) {
        return '';
    }

    return $domain;
}

function email_domain_policy_domain_list(mixed $values): array
{
    if (is_string($values)) {
        $values = preg_split('/[\s,;]+/', $values) ?: [];
    }

    if (!is_array($values)) {
        return [];
    }

    $domains = [];

    foreach ($values as $value) {
        $domain = email_domain_policy_normalize_domain($value);
        if ($domain !== '') {
            $domains[$domain] = true;
        }
    }

    return array_keys($domains);
}

function normalize_email_domain_policy_payload(array $payload, bool $strict = true): array
{
    $defaults = email_domain_policy_defaults();
    $settings = [
        'enabled' => email_domain_policy_bool($payload['enabled'] ?? $defaults['enabled'], $defaults['enabled']),
        'allowListedOnly' => email_domain_policy_bool(
            $payload['allowListedOnly'] ?? $payload['allow_listed_only'] ?? $defaults['allowListedOnly'],
            $defaults['allowListedOnly']
        ),
        'allowedDomains' => email_domain_policy_domain_list($payload['allowedDomains'] ?? $payload['allowed_domains'] ?? $defaults['allowedDomains']),
        'blockedDomains' => email_domain_policy_domain_list($payload['blockedDomains'] ?? $payload['blocked_domains'] ?? $defaults['blockedDomains']),
    ];

    $errors = [];

    if ($settings['allowListedOnly'] && $settings['allowedDomains'] === []) {
        $errors[] = 'Add at least one allowed email domain before enabling allow-list-only mode.';
    }

    $overlap = array_values(array_intersect($settings['allowedDomains'], $settings['blockedDomains']));
    if ($overlap !== []) {
        $errors[] = 'A domain cannot be both allowed and blocked: ' . implode(', ', $overlap) . '.';
    }

    return [
        'settings' => $settings,
        'errors' => $strict ? $errors : [],
    ];
}

function email_domain_policy(PDO $pdo): array
{
    $raw = get_application_setting(
        $pdo,
        HRIS_EMAIL_DOMAIN_POLICY_KEY,
        json_encode(email_domain_policy_defaults(), JSON_UNESCAPED_SLASHES)
    );
    $decoded = json_decode($raw, true);

    if (!is_array($decoded)) {
        $decoded = email_domain_policy_defaults();
    }

    return normalize_email_domain_policy_payload($decoded, false)['settings'];
}

function store_email_domain_policy(PDO $pdo, array $policy): void
{
    $encoded = json_encode($policy, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($encoded === false) {
        throw new RuntimeException('Unable to encode email domain policy.');
    }

    store_application_setting($pdo, HRIS_EMAIL_DOMAIN_POLICY_KEY, $encoded);
}

function email_domain_matches(string $domain, array $rules): bool
{
    foreach ($rules as $rule) {
        if ($domain === $rule || str_ends_with($domain, '.' . $rule)) {
            return true;
        }
    }

    return false;
}

function email_domain_policy_violation(PDO $pdo, string $email, ?array $policy = null): ?string
{
    $policy ??= email_domain_policy($pdo);

    if (!$policy['enabled']) {
        return null;
    }

    $domain = email_domain_policy_normalize_domain(substr(strrchr($email, '@') ?: '', 1));

    if ($domain === '') {
        return 'Valid email is required.';
    }

    if (email_domain_matches($domain, $policy['blockedDomains'])) {
        if ($policy['allowListedOnly'] && count($policy['allowedDomains']) === 1) {
            return "Email addresses from {$domain} cannot be used. Only {$policy['allowedDomains'][0]} email addresses are allowed.";
        }

        if ($policy['allowListedOnly'] && count($policy['allowedDomains']) > 1) {
            return 'Email addresses from ' . $domain . ' cannot be used. Use an allowed domain: '
                . implode(', ', $policy['allowedDomains']) . '.';
        }

        return "Email addresses from {$domain} cannot be used because this domain is blocked by the Temp Mail Blocker.";
    }

    if ($policy['allowListedOnly'] && !email_domain_matches($domain, $policy['allowedDomains'])) {
        if (count($policy['allowedDomains']) === 1) {
            return "Only {$policy['allowedDomains'][0]} email addresses are allowed.";
        }

        return 'Use an allowed email domain: ' . implode(', ', $policy['allowedDomains']) . '.';
    }

    return null;
}
