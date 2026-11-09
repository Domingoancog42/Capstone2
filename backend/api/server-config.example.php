<?php
declare(strict_types=1);

/*
 * Template for server-config.local.php -- settings for a host that cannot set environment
 * variables (InfinityFree, most shared hosting). Copy this file to server-config.local.php
 * next to it and fill in the values. connection-pdo.php loads it when present; XAMPP and
 * Docker have no such file and keep their own defaults.
 *
 * server-config.local.php holds the database password: it is gitignored (*.local.php) and
 * denied over HTTP by backend/api/.htaccess. Never commit the filled-in copy.
 *
 * Every line is guarded by defined() so loading it twice, or after the same name was set
 * elsewhere, is harmless.
 */

// Database -- from the hosting control panel (InfinityFree: "MySQL Databases").
defined('HRIS_DB_HOST') || define('HRIS_DB_HOST', 'sqlXXX.infinityfree.com');
defined('HRIS_DB_PORT') || define('HRIS_DB_PORT', '3306');
defined('HRIS_DB_NAME') || define('HRIS_DB_NAME', 'if0_00000000_hris');
defined('HRIS_DB_USER') || define('HRIS_DB_USER', 'if0_00000000');
defined('HRIS_DB_PASSWORD') || define('HRIS_DB_PASSWORD', 'your-hosting-account-password');

// "Sign in with Google" -- the OAuth client id (the same value as GOOGLE_CLIENT_ID in frontend/.env).
// Leave it empty to hide the Google button.
defined('GOOGLE_CLIENT_ID') || define('GOOGLE_CLIENT_ID', '');

// Address account-activation e-mails link to, with a trailing slash. Optional: when empty the
// link follows the address the request came from.
defined('HRIS_LOGIN_URL') || define('HRIS_LOGIN_URL', '');
