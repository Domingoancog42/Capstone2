<?php
declare(strict_types=1);

require_once __DIR__ . '/connection-pdo.php';

$sessionUser = require_session_user();
hris_ensure_notifications_table($pdo);

function notifications_text(mixed $value): string
{
    return trim((string)($value ?? ''));
}

function notifications_int_list(mixed $value): array
{
    if (!is_array($value)) {
        return [];
    }

    $result = [];
    foreach ($value as $item) {
        $id = (int)$item;
        if ($id > 0) {
            $result[$id] = true;
        }
    }

    return array_keys($result);
}

function notifications_format_row(array $row): array
{
    $type = hris_normalize_notification_type((string)($row['type'] ?? ''));

    return [
        'id' => (int)($row['id'] ?? 0),
        'userId' => (int)($row['userId'] ?? $row['user_id'] ?? 0),
        'title' => notifications_text($row['title'] ?? ''),
        'message' => notifications_text($row['message'] ?? ''),
        'type' => $type,
        'typeLabel' => hris_notification_type_label($type),
        'isRead' => (int)($row['isRead'] ?? $row['is_read'] ?? 0) === 1,
        'referenceId' => notifications_text($row['referenceId'] ?? $row['reference_id'] ?? ''),
        'createdAt' => (string)($row['createdAt'] ?? $row['created_at'] ?? ''),
    ];
}

function notifications_list(PDO $pdo, array $sessionUser): void
{
    $userId = (int)($sessionUser['id'] ?? 0);
    $page = max(1, (int)($_GET['page'] ?? 1));
    $perPage = (int)($_GET['perPage'] ?? ($_GET['per_page'] ?? 20));
    $perPage = max(5, min(100, $perPage));
    $offset = ($page - 1) * $perPage;
    $search = notifications_text($_GET['search'] ?? '');
    $type = hris_normalize_notification_type((string)($_GET['type'] ?? ''));
    $status = strtolower(notifications_text($_GET['status'] ?? 'all'));

    $conditions = ['user_id = :user_id'];
    $params = [':user_id' => $userId];

    if ($search !== '') {
        $conditions[] = '(title LIKE :search OR message LIKE :search OR type LIKE :search OR COALESCE(reference_id, "") LIKE :search)';
        $params[':search'] = '%' . $search . '%';
    }

    if ($type !== '' && $type !== 'all') {
        $conditions[] = 'type = :type';
        $params[':type'] = $type;
    }

    if (in_array($status, ['read', 'unread'], true)) {
        $conditions[] = 'is_read = :is_read';
        $params[':is_read'] = $status === 'read' ? 1 : 0;
    }

    $whereSql = implode(' AND ', $conditions);

    $countStatement = $pdo->prepare('SELECT COUNT(*) FROM notifications WHERE ' . $whereSql);
    $countStatement->execute($params);
    $total = (int)$countStatement->fetchColumn();

    $unreadStatement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM notifications
         WHERE user_id = :user_id
           AND is_read = 0'
    );
    $unreadStatement->execute([':user_id' => $userId]);
    $unreadCount = (int)$unreadStatement->fetchColumn();

    $statement = $pdo->prepare(
        'SELECT
            id,
            user_id AS userId,
            title,
            message,
            type,
            is_read AS isRead,
            reference_id AS referenceId,
            created_at AS createdAt
         FROM notifications
         WHERE ' . $whereSql . '
         ORDER BY created_at DESC, id DESC
         LIMIT :limit OFFSET :offset'
    );

    foreach ($params as $key => $value) {
        $statement->bindValue($key, $value);
    }
    $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
    $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
    $statement->execute();

    $notifications = array_map('notifications_format_row', $statement->fetchAll());

    json_response([
        'success' => true,
        'notifications' => $notifications,
        'unreadCount' => $unreadCount,
        'pagination' => [
            'page' => $page,
            'perPage' => $perPage,
            'total' => $total,
            'totalPages' => $perPage > 0 ? (int)max(1, (int)ceil($total / $perPage)) : 1,
        ],
    ]);
}

function notifications_mark_read(PDO $pdo, array $sessionUser, int $id): void
{
    $statement = $pdo->prepare(
        'UPDATE notifications
         SET is_read = 1
         WHERE id = :id
           AND user_id = :user_id'
    );
    $statement->execute([
        ':id' => $id,
        ':user_id' => (int)($sessionUser['id'] ?? 0),
    ]);

    json_response([
        'success' => true,
        'message' => 'Notification marked as read.',
    ]);
}

function notifications_mark_selected_read(PDO $pdo, array $sessionUser, array $ids): void
{
    $ids = notifications_int_list($ids);

    if ($ids === []) {
        json_response([
            'success' => false,
            'message' => 'At least one notification is required.',
        ], 422);
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'UPDATE notifications
         SET is_read = 1
         WHERE user_id = ?
           AND id IN (' . $placeholders . ')'
    );
    $statement->execute(array_merge([(int)($sessionUser['id'] ?? 0)], $ids));

    json_response([
        'success' => true,
        'message' => 'Notifications marked as read.',
    ]);
}

function notifications_mark_all_read(PDO $pdo, array $sessionUser): void
{
    $statement = $pdo->prepare(
        'UPDATE notifications
         SET is_read = 1
         WHERE user_id = :user_id
           AND is_read = 0'
    );
    $statement->execute([':user_id' => (int)($sessionUser['id'] ?? 0)]);

    json_response([
        'success' => true,
        'message' => 'All notifications marked as read.',
    ]);
}

function notifications_delete(PDO $pdo, array $sessionUser, int $id): void
{
    $statement = $pdo->prepare(
        'DELETE FROM notifications
         WHERE id = :id
           AND user_id = :user_id'
    );
    $statement->execute([
        ':id' => $id,
        ':user_id' => (int)($sessionUser['id'] ?? 0),
    ]);

    json_response([
        'success' => true,
        'message' => 'Notification deleted.',
    ]);
}

function notifications_delete_selected(PDO $pdo, array $sessionUser, array $ids): void
{
    $ids = notifications_int_list($ids);

    if ($ids === []) {
        json_response([
            'success' => false,
            'message' => 'At least one notification is required.',
        ], 422);
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'DELETE FROM notifications
         WHERE user_id = ?
           AND id IN (' . $placeholders . ')'
    );
    $statement->execute(array_merge([(int)($sessionUser['id'] ?? 0)], $ids));

    json_response([
        'success' => true,
        'message' => 'Notifications deleted.',
    ]);
}

function notifications_create_custom(PDO $pdo, array $sessionUser, array $body): void
{
    if (hris_user_role_key($sessionUser) !== 'admin') {
        json_response([
            'success' => false,
            'message' => 'Only administrators can create custom notifications.',
        ], 403);
    }

    $title = notifications_text($body['title'] ?? '');
    $message = notifications_text($body['message'] ?? '');
    $type = hris_normalize_notification_type((string)($body['type'] ?? 'custom')) ?: 'custom';
    $referenceId = notifications_text($body['referenceId'] ?? '');
    $userIds = notifications_int_list($body['userIds'] ?? []);
    $roleKeys = [];

    foreach ((array)($body['roleKeys'] ?? []) as $roleKey) {
        $normalizedRole = hris_normalize_role($roleKey);
        if ($normalizedRole !== '') {
            $roleKeys[] = $normalizedRole;
        }
    }

    if ($title === '' || $message === '') {
        json_response([
            'success' => false,
            'message' => 'Title and message are required.',
        ], 422);
    }

    $recipientIds = array_unique(array_merge($userIds, hris_user_ids_for_role_keys($pdo, $roleKeys)));

    if ($recipientIds === []) {
        json_response([
            'success' => false,
            'message' => 'At least one recipient is required.',
        ], 422);
    }

    $createdCount = hris_notify_users($pdo, $recipientIds, $title, $message, $type, $referenceId);

    json_response([
        'success' => true,
        'message' => 'Notification created successfully.',
        'createdCount' => $createdCount,
    ], 201);
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        notifications_list($pdo, $sessionUser);
    }

    $body = read_json_body();
    $action = hris_normalize_notification_type((string)($body['action'] ?? $_GET['action'] ?? ''));

    if ($method === 'POST') {
        if ($action === 'mark_read') {
            notifications_mark_read($pdo, $sessionUser, (int)($body['id'] ?? 0));
        }

        if ($action === 'mark_selected_read') {
            notifications_mark_selected_read($pdo, $sessionUser, $body['ids'] ?? []);
        }

        if ($action === 'mark_all_read') {
            notifications_mark_all_read($pdo, $sessionUser);
        }

        if ($action === 'create') {
            notifications_create_custom($pdo, $sessionUser, $body);
        }
    }

    if ($method === 'DELETE') {
        $body = read_json_body();
        $ids = $body['ids'] ?? [];

        if (!is_array($ids) || $ids === []) {
            notifications_delete($pdo, $sessionUser, (int)($body['id'] ?? 0));
        } else {
            notifications_delete_selected($pdo, $sessionUser, $ids);
        }
    }

    json_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
} catch (Throwable $exception) {
    error_log('Notifications API error: ' . $exception->getMessage());
    json_response([
        'success' => false,
        'message' => 'Unable to process notifications.',
    ], 500);
}
