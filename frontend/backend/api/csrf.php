<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

require_method('GET');

json_response([
    'success' => true,
    'csrfToken' => csrf_token(),
]);
