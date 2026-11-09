<?php
declare(strict_types=1);

/*
 * The chat endpoint. It was chat.php until the hosted copy turned out to be unreachable: InfinityFree
 * answers any API URL whose name contains "chat" (chat.php, xchat.php, even a bare /chat) with a 403
 * before PHP runs, which left the chat bubble and Communications on "Unable to load messages.".
 * Keep "chat" out of this file's name.
 */

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();

const CHAT_PRESENCE_WINDOW_SECONDS = 90;
const CHAT_PRESENCE_RETENTION_SECONDS = 86400;

function chat_ensure_messages_table(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    if (!database_column_exists($pdo, 'messages', 'Message_ID')) {
        $pdo->exec('ALTER TABLE messages ADD COLUMN Message_ID INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST');
    }
    if (!database_column_exists($pdo, 'messages', 'sender_id')) {
        $pdo->exec('ALTER TABLE messages ADD COLUMN sender_id INT UNSIGNED NOT NULL AFTER Message_ID');
    }
    if (!database_column_exists($pdo, 'messages', 'receiver_id')) {
        $pdo->exec('ALTER TABLE messages ADD COLUMN receiver_id INT UNSIGNED NOT NULL AFTER sender_id');
    }
    if (!database_column_exists($pdo, 'messages', 'message_text')) {
        $pdo->exec('ALTER TABLE messages ADD COLUMN message_text TEXT NOT NULL AFTER receiver_id');
    }
    if (!database_column_exists($pdo, 'messages', 'is_read')) {
        $pdo->exec('ALTER TABLE messages ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0 AFTER message_text');
    }
    if (!database_column_exists($pdo, 'messages', 'created_at')) {
        $pdo->exec('ALTER TABLE messages ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER is_read');
    }

    try {
        $primaryKey = $pdo->prepare(
            'SELECT COUNT(*)
             FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = "messages"
               AND CONSTRAINT_TYPE = "PRIMARY KEY"'
        );
        $primaryKey->execute();

        if ((int)$primaryKey->fetchColumn() === 0) {
            $pdo->exec('ALTER TABLE messages ADD PRIMARY KEY (Message_ID)');
        }

        $messageId = $pdo->prepare(
            'SELECT EXTRA
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = "messages"
               AND COLUMN_NAME = "Message_ID"
             LIMIT 1'
        );
        $messageId->execute();
        $extra = strtolower((string)$messageId->fetchColumn());

        if (!str_contains($extra, 'auto_increment')) {
            $pdo->exec('ALTER TABLE messages MODIFY COLUMN Message_ID INT UNSIGNED NOT NULL AUTO_INCREMENT');
        }
    } catch (Throwable $exception) {
        // Keep the endpoint available; inserts will surface any remaining table issue.
    }

    $ensured = true;
}

function chat_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function chat_user_id(array $user): int
{
    return (int)($user['id'] ?? 0);
}

function chat_presence_file_path(): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'chat-presence.json';
}

function chat_presence_read(): array
{
    $path = chat_presence_file_path();

    if (!is_file($path)) {
        return [];
    }

    $contents = @file_get_contents($path);
    if (!is_string($contents) || trim($contents) === '') {
        return [];
    }

    $decoded = json_decode($contents, true);

    return is_array($decoded) ? $decoded : [];
}

function chat_presence_write(array $presence): void
{
    $path = chat_presence_file_path();
    $directory = dirname($path);

    if (!is_dir($directory)) {
        @mkdir($directory, 0775, true);
    }

    @file_put_contents($path, json_encode($presence, JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function chat_presence_timestamp(mixed $value): int
{
    $timestamp = strtotime((string)($value ?? ''));

    return $timestamp === false ? 0 : $timestamp;
}

function chat_touch_presence(array $user): array
{
    $presence = chat_presence_read();
    $now = time();
    $currentUserId = chat_user_id($user);

    foreach ($presence as $key => $entry) {
        if (!is_array($entry)) {
            unset($presence[$key]);
            continue;
        }

        $lastActiveAt = chat_presence_timestamp($entry['lastActiveAt'] ?? '');
        if ($lastActiveAt <= 0 || ($now - $lastActiveAt) > CHAT_PRESENCE_RETENTION_SECONDS) {
            unset($presence[$key]);
        }
    }

    if ($currentUserId > 0) {
        $presence[(string)$currentUserId] = [
            'userId' => $currentUserId,
            'fullName' => chat_text($user['name'] ?? $user['fullName'] ?? $user['username'] ?? ''),
            'role' => (string)($user['role'] ?? ''),
            'lastActiveAt' => date(DATE_ATOM),
        ];
    }

    chat_presence_write($presence);

    return $presence;
}

function chat_presence_entry(array $presence, int $userId): array
{
    $entry = $presence[(string)$userId] ?? null;

    return is_array($entry) ? $entry : [];
}

function chat_presence_last_active_at(array $presence, int $userId): string
{
    return (string)(chat_presence_entry($presence, $userId)['lastActiveAt'] ?? '');
}

function chat_presence_is_online(array $presence, int $userId): bool
{
    $lastActiveAt = chat_presence_timestamp(chat_presence_last_active_at($presence, $userId));

    return $lastActiveAt > 0 && (time() - $lastActiveAt) <= CHAT_PRESENCE_WINDOW_SECONDS;
}

function chat_format_contact(array $row, array $presence = []): array
{
    $userId = (int)($row['id'] ?? 0);
    $fullName = chat_text($row['full_name'] ?? '');
    $username = chat_text($row['username'] ?? '');
    $isOnline = chat_presence_is_online($presence, $userId);

    return [
        'id' => $userId,
        'name' => $fullName !== '' ? $fullName : $username,
        'username' => $username,
        'email' => (string)($row['email'] ?? ''),
        'role' => (string)($row['role'] ?? ''),
        'division' => (string)($row['division'] ?? ''),
        'position' => (string)($row['position'] ?? ''),
        'designation' => (string)($row['designation'] ?? ''),
        'profileImage' => (string)($row['profile_image'] ?? ''),
        'isOnline' => $isOnline,
        'presenceStatus' => $isOnline ? 'online' : 'offline',
        'lastActiveAt' => chat_presence_last_active_at($presence, $userId),
        'lastMessage' => (string)($row['last_message'] ?? ''),
        'lastMessageAt' => (string)($row['last_message_at'] ?? ''),
        'unreadCount' => (int)($row['unread_count'] ?? 0),
    ];
}

function chat_format_message(array $row, int $currentUserId): array
{
    $senderId = (int)($row['sender_id'] ?? 0);

    return [
        'id' => (int)($row['Message_ID'] ?? 0),
        'senderId' => $senderId,
        'receiverId' => (int)($row['receiver_id'] ?? 0),
        'messageText' => (string)($row['message_text'] ?? ''),
        'isRead' => (bool)($row['is_read'] ?? false),
        'createdAt' => (string)($row['created_at'] ?? ''),
        'mine' => $senderId === $currentUserId,
    ];
}

function chat_contacts(PDO $pdo, int $currentUserId, array $presence = []): array
{
    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.username,
            u.email,
            r.name AS role,
            TRIM(CONCAT(COALESCE(e.first_name, ""), " ", COALESCE(e.middle_name, ""), " ", COALESCE(e.last_name, ""))) AS full_name,
            e.profile_image,
            d.name AS division,
            des.name AS position,
            e.designation,
            latest.last_message_at,
            lm.message_text AS last_message,
            COALESCE(unread.unread_count, 0) AS unread_count
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e
            ON e.email COLLATE utf8mb4_unicode_ci = u.email
           AND e.is_archived = 0
         LEFT JOIN divisions d ON d.id = e.division_id
         LEFT JOIN designations des ON des.id = e.designation_id
         LEFT JOIN (
            SELECT
                CASE WHEN sender_id = :self_latest_sender THEN receiver_id ELSE sender_id END AS contact_id,
                MAX(Message_ID) AS last_message_id,
                MAX(created_at) AS last_message_at
            FROM messages
            WHERE sender_id = :self_latest_where_sender
               OR receiver_id = :self_latest_where_receiver
            GROUP BY contact_id
         ) latest ON latest.contact_id = u.id
         LEFT JOIN messages lm ON lm.Message_ID = latest.last_message_id
         LEFT JOIN (
            SELECT sender_id, COUNT(*) AS unread_count
            FROM messages
            WHERE receiver_id = :self_unread_receiver
              AND is_read = 0
            GROUP BY sender_id
         ) unread ON unread.sender_id = u.id
         WHERE u.id <> :self_user_id
           AND u.is_archived = 0
           AND LOWER(u.status) = "active"
         ORDER BY latest.last_message_at IS NULL, latest.last_message_at DESC, full_name ASC, u.username ASC'
    );
    $statement->execute([
        ':self_latest_sender' => $currentUserId,
        ':self_latest_where_sender' => $currentUserId,
        ':self_latest_where_receiver' => $currentUserId,
        ':self_unread_receiver' => $currentUserId,
        ':self_user_id' => $currentUserId,
    ]);

    return array_map(
        static fn (array $row): array => chat_format_contact($row, $presence),
        $statement->fetchAll()
    );
}

function chat_find_contact(PDO $pdo, int $currentUserId, int $contactId, array $presence = []): ?array
{
    if ($contactId <= 0 || $contactId === $currentUserId) {
        return null;
    }

    foreach (chat_contacts($pdo, $currentUserId, $presence) as $contact) {
        if ((int)$contact['id'] === $contactId) {
            return $contact;
        }
    }

    return null;
}

function chat_messages(PDO $pdo, int $currentUserId, int $contactId): array
{
    if ($contactId <= 0 || $contactId === $currentUserId) {
        return [];
    }

    $markRead = $pdo->prepare(
        'UPDATE messages
         SET is_read = 1
         WHERE sender_id = :contact_id
           AND receiver_id = :current_user_id
           AND is_read = 0'
    );
    $markRead->execute([
        ':contact_id' => $contactId,
        ':current_user_id' => $currentUserId,
    ]);

    $statement = $pdo->prepare(
        'SELECT Message_ID, sender_id, receiver_id, message_text, is_read, created_at
         FROM messages
         WHERE (sender_id = :current_sender AND receiver_id = :contact_receiver)
            OR (sender_id = :contact_sender AND receiver_id = :current_receiver)
         ORDER BY created_at ASC, Message_ID ASC'
    );
    $statement->execute([
        ':current_sender' => $currentUserId,
        ':contact_receiver' => $contactId,
        ':contact_sender' => $contactId,
        ':current_receiver' => $currentUserId,
    ]);

    return array_map(
        static fn (array $row): array => chat_format_message($row, $currentUserId),
        $statement->fetchAll()
    );
}

chat_ensure_messages_table($pdo);

$currentUserId = chat_user_id($sessionUser);

if ($currentUserId <= 0) {
    json_response([
        'success' => false,
        'message' => 'Your session user could not be identified.',
    ], 401);
}

$presence = chat_touch_presence($sessionUser);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $contactId = (int)($_GET['contactId'] ?? 0);
    $contacts = chat_contacts($pdo, $currentUserId, $presence);
    $activeContact = null;
    $messages = [];

    if ($contactId > 0) {
        $activeContact = chat_find_contact($pdo, $currentUserId, $contactId, $presence);
        $messages = $activeContact === null ? [] : chat_messages($pdo, $currentUserId, $contactId);
        $contacts = chat_contacts($pdo, $currentUserId, $presence);
    }

    json_response([
        'success' => true,
        'contacts' => $contacts,
        'activeContact' => $activeContact,
        'messages' => $messages,
    ]);
}

if ($method === 'POST') {
    $body = read_json_body();
    $receiverId = (int)($body['receiverId'] ?? 0);
    $messageText = chat_text($body['messageText'] ?? '');

    if ($receiverId <= 0 || $receiverId === $currentUserId) {
        json_response([
            'success' => false,
            'message' => 'Select a valid recipient.',
        ], 422);
    }

    if ($messageText === '') {
        json_response([
            'success' => false,
            'message' => 'Message is required.',
        ], 422);
    }

    if (strlen($messageText) > 5000) {
        json_response([
            'success' => false,
            'message' => 'Message must not exceed 5000 characters.',
        ], 422);
    }

    $recipient = chat_find_contact($pdo, $currentUserId, $receiverId, $presence);

    if ($recipient === null) {
        json_response([
            'success' => false,
            'message' => 'Recipient was not found.',
        ], 404);
    }

    $statement = $pdo->prepare(
        'INSERT INTO messages (sender_id, receiver_id, message_text, is_read)
         VALUES (:sender_id, :receiver_id, :message_text, 0)'
    );
    $statement->execute([
        ':sender_id' => $currentUserId,
        ':receiver_id' => $receiverId,
        ':message_text' => $messageText,
    ]);

    $messages = chat_messages($pdo, $currentUserId, $receiverId);

    json_response([
        'success' => true,
        'message' => 'Message sent.',
        'contacts' => chat_contacts($pdo, $currentUserId, $presence),
        'activeContact' => chat_find_contact($pdo, $currentUserId, $receiverId, $presence),
        'messages' => $messages,
    ]);
}

json_response([
    'success' => false,
    'message' => 'Method not allowed.',
], 405);
