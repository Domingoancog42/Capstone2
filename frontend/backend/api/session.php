<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

require_method('GET');

$user = require_session_user();

json_response([
    'success' => true,
    'user' => $user,
]);
