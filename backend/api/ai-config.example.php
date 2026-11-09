<?php
declare(strict_types=1);

// Optional fallback for hosts without environment variables or frontend/.env.
// Precedence: backend environment variables, frontend/.env, then ai-config.local.php.
// The local file is ignored by Git, excluded from Docker builds, and denied over HTTP.
defined('NVIDIA_API_KEY') || define('NVIDIA_API_KEY', '');
defined('HRIS_FAQ_AI_MODEL') || define('HRIS_FAQ_AI_MODEL', 'deepseek-ai/deepseek-v4.1-flash');
