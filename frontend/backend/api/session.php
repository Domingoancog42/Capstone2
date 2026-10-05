<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

require_method('GET');

// Background callers use this endpoint to re-read permissions without manufacturing activity.
// App.jsx adds `extend=1` only for real browser activity or an explicit "Stay Logged In".
$extendSession = filter_var($_GET['extend'] ?? false, FILTER_VALIDATE_BOOL);
$user = require_session_user($extendSession, false, true);

json_response([
    'authenticated' => $user !== null,
    'user' => $user,
]);
