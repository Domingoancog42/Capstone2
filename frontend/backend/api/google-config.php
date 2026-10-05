<?php
declare(strict_types=1);

/*
 * The Google OAuth client that "Sign in with Google" on the login screen belongs to.
 *
 * One value, GOOGLE_CLIENT_ID, and two readers: google_login.php checks that every credential it
 * is handed was issued to this client and no other, and settings.php hands the same id to the
 * browser so the button can be drawn. A client id is not a secret -- it is in the page source of
 * every site that uses the button -- but it is a deployment fact rather than code, so it is kept
 * out of this file the same way the SMTP credentials are kept out of smtp-config.php.
 *
 * Resolved in this order, first non-empty value wins:
 *
 *   1. the literal below, for a machine where editing this file is the simplest thing;
 *   2. the GOOGLE_CLIENT_ID environment variable (Apache SetEnv, or the process environment),
 *      which is how the Docker stack supplies its database settings too;
 *   3. GOOGLE_CLIENT_ID in frontend/.env, with a gitignored frontend/.env.local winning over it,
 *      which is the convention that file already documents for every other setting in it.
 *
 * The third is there because on XAMPP nothing sets environment variables for Apache, and the
 * .env file is where this project already keeps per-deployment configuration. PHP never reads
 * that file on its own (react-scripts does, for the front end), so the handful of lines below do.
 *
 * Leaving all three empty is the documented way to turn the feature off: google_login.php answers
 * 503, settings.php sends an empty id, and the login screen draws no button. connection-pdo.php
 * includes this file only when it exists, so a checkout without it behaves the same way.
 */

/**
 * The value of one key in a dotenv file, or '' when the file or the key is absent.
 *
 * Deliberately not a dotenv implementation: no interpolation, no multi-line values, no export
 * keyword. A line is `KEY=value`, with optional surrounding quotes and `#` comments, which is all
 * frontend/.env has ever used and all react-scripts needs from it either.
 */
function google_config_dotenv_value(string $path, string $key): string
{
    if (!is_file($path) || !is_readable($path)) {
        return '';
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

    if ($lines === false) {
        return '';
    }

    foreach ($lines as $line) {
        $line = trim($line);

        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }

        [$name, $value] = explode('=', $line, 2);

        if (trim($name) !== $key) {
            continue;
        }

        $value = trim($value);

        // A quoted value keeps everything inside the quotes; an unquoted one ends at a comment.
        if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
            return substr($value, 1, -1);
        }

        return trim((string)preg_replace('/\s+#.*$/', '', $value));
    }

    return '';
}

if (!defined('GOOGLE_CLIENT_ID')) {
    // 1. The literal. Blank on purpose -- the id lives in frontend/.env on this deployment.
    $hrisGoogleClientId = '';

    // 2. The environment. getenv() returns false for an unset name, hence the cast.
    if ($hrisGoogleClientId === '') {
        $hrisGoogleClientId = trim((string)(getenv('GOOGLE_CLIENT_ID') ?: ''));
    }

    // 3. frontend/.env, two directories up; .env.local overrides it, as it does for npm.
    foreach ([__DIR__ . '/../../.env.local', __DIR__ . '/../../.env'] as $hrisGoogleDotenv) {
        if ($hrisGoogleClientId !== '') {
            break;
        }

        $hrisGoogleClientId = google_config_dotenv_value($hrisGoogleDotenv, 'GOOGLE_CLIENT_ID');
    }

    define('GOOGLE_CLIENT_ID', $hrisGoogleClientId);

    unset($hrisGoogleClientId, $hrisGoogleDotenv);
}
