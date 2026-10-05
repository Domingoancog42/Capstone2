<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$pdo->query('SELECT 1')->fetchColumn();

echo json_encode([
    'status' => 'ok',
    'service' => 'mgb-hris-backend',
], JSON_UNESCAPED_SLASHES);

