<?php
declare(strict_types=1);

/*
 * Credentials live outside this file so it can be committed safely.
 *
 * Resolution order: smtp-credentials.local.php (gitignored), then the matching
 * environment variables, then empty. Empty means outgoing mail fails to send while
 * the rest of the app keeps working — see smtp-credentials.example.php for setup.
 */
$hrisSmtpCredentials = __DIR__ . '/smtp-credentials.local.php';

if (is_file($hrisSmtpCredentials)) {
    require_once $hrisSmtpCredentials;
}

unset($hrisSmtpCredentials);

foreach (['SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL'] as $hrisSmtpSetting) {
    if (!defined($hrisSmtpSetting)) {
        define($hrisSmtpSetting, (string)(getenv($hrisSmtpSetting) ?: ''));
    }
}

unset($hrisSmtpSetting);

// Gmail SMTP Settings
if (!defined('SMTP_HOST')) {
    define('SMTP_HOST', 'smtp.gmail.com');
}

if (!defined('SMTP_PORT')) {
    define('SMTP_PORT', 587);
}

if (!defined('SMTP_ENCRYPTION')) {
    define('SMTP_ENCRYPTION', 'tls');
}

// SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL are resolved at the top of this
// file from smtp-credentials.local.php or the environment.

if (!defined('SMTP_FROM_NAME')) {
    define('SMTP_FROM_NAME', 'REGION X MGB');
}

// Email Settings
if (!defined('EMAIL_SUBJECT')) {
    define('EMAIL_SUBJECT', 'REGION X MGB');
}

if (!defined('CODE_EXPIRY_MINUTES')) {
    define('CODE_EXPIRY_MINUTES', 10);
}

// Security Settings
if (!defined('ALLOW_LOCAL_RESET_CODE_FALLBACK')) {
    define('ALLOW_LOCAL_RESET_CODE_FALLBACK', false);
}
