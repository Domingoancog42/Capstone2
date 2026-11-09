<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';
require_once __DIR__ . '/faq-assistant-utils.php';

$sessionUser = require_session_user(keepSessionOpen: true);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
}

try {
    $entries = faq_knowledge();
    if ($method === 'GET') {
        session_write_close();
        json_response(['success' => true, 'faqs' => $entries]);
    }
    $body = read_json_body();
    $question = faq_question($body['question'] ?? null);
    $history = faq_history($body['history'] ?? []);
    // A per-session AI allowance supplements the app's existing account-wide API throttle.
    $state = (array)($_SESSION['faq_ai_limit'] ?? []);
    $wait = faq_request_wait($state, time());
    $_SESSION['faq_ai_limit'] = $state;
    session_write_close();
    if ($wait > 0) {
        header('Retry-After: ' . $wait);
        json_response(['success' => false, 'message' => 'Please wait a moment before asking another question.', 'retryAfter' => $wait], 429);
    }
    // Only the user's question/history and the static guide leave the server; no employee query is made.
    json_response(faq_reply($question, $history, $entries, faq_ai_config(), context: faq_user_context($sessionUser, $body['page'] ?? '')));
} catch (InvalidArgumentException $exception) {
    json_response(['success' => false, 'message' => $exception->getMessage()], 422);
} catch (Throwable $exception) {
    error_log('FAQ assistant could not process the request.');
    json_response(['success' => false, 'message' => 'Unable to load help right now. Please try again.'], 500);
}
