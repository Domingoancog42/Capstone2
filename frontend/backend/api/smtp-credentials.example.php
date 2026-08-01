<?php
declare(strict_types=1);

/**
 * Template for SMTP credentials.
 *
 * Copy this file to `smtp-credentials.local.php` (which is gitignored) and fill in
 * the real values. Without it the app still runs, but outgoing mail — OTP codes,
 * password resets, account activation — will fail to send.
 *
 * For Gmail, SMTP_PASSWORD is an App Password generated at
 * https://myaccount.google.com/apppasswords, not the account password.
 *
 * These can also be supplied as the environment variables SMTP_USERNAME,
 * SMTP_PASSWORD, and SMTP_FROM_EMAIL instead of using this file.
 */

define('SMTP_USERNAME', '');
define('SMTP_PASSWORD', '');
define('SMTP_FROM_EMAIL', '');
