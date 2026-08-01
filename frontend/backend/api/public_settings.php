<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/app_settings.php';

require_method('GET');

$securitySettings = hris_security_settings($pdo);

json_response([
    'success' => true,
    'csrfToken' => hris_csrf_token(),
    'loginCaptchaEnabled' => hris_get_boolean_application_setting($pdo, 'login_captcha_enabled', true),
    'security' => [
        'maximumPasswordLength' => $securitySettings['maximumPasswordLength'],
        'sessionTimeoutMinutes' => $securitySettings['sessionTimeoutMinutes'],
    ],
]);
