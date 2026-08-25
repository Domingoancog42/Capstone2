<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/audit_logs_helper.php';

require_method('GET');

$sessionUser = require_session_user();

if (user_role_key($sessionUser) !== 'admin') {
    json_response([
        'success' => false,
        'message' => 'Only administrators can view audit logs.',
    ], 403);
}

$result = paginated_audit_logs($pdo, [
    'search' => $_GET['search'] ?? '',
    'range' => $_GET['range'] ?? '30d',
    'page' => $_GET['page'] ?? 1,
    'perPage' => $_GET['perPage'] ?? ($_GET['per_page'] ?? 25),
]);

// array_merge() rather than unpacking: $result has string keys, and spreading those is PHP 8.1+.
json_response(array_merge(['success' => true], $result));
