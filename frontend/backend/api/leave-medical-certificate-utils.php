<?php
declare(strict_types=1);

/** A durable stamp keeps the three-day reminder from repeating, even if the notification is deleted. */
function ensure_leave_medical_certificate_schema(PDO $pdo): void
{
    $column = $pdo->query("SHOW COLUMNS FROM leave_requests LIKE 'medical_certificate_reminded_at'")->fetch();
    if (!$column) {
        try {
            $pdo->exec('ALTER TABLE leave_requests ADD COLUMN medical_certificate_reminded_at DATETIME NULL');
        } catch (PDOException $exception) {
            // Concurrent notification polls may both try to add the column.
            if ((int)($exception->errorInfo[1] ?? 0) !== 1060) {
                throw $exception;
            }
        }
    }
}

/** Called by the notification bell's normal polling, including the first refresh after signing in. */
function send_due_leave_medical_certificate_reminders(PDO $pdo, array $sessionUser): void
{
    $userId = (int)($sessionUser['id'] ?? 0);
    $employeeId = session_employee_record_id($pdo, $sessionUser);
    if ($userId <= 0 || !$employeeId) {
        return;
    }

    ensure_archive_columns($pdo, 'leave_requests');
    ensure_leave_medical_certificate_schema($pdo);
    ensure_notification_ids($pdo);

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'SELECT lr.leave_request_id, lr.start_date, lr.end_date
             FROM leave_requests lr
             INNER JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
             WHERE lr.employee_id = :employee_id
               AND LOWER(TRIM(lt.name)) = "sick leave"
               AND lr.requested_at <= DATE_SUB(NOW(), INTERVAL 3 DAY)
               AND lr.medical_certificate_reminded_at IS NULL
               AND lr.is_archived = 0
               AND lr.status NOT IN ("rejected", "cancelled", "canceled", "withdrawn")
               AND NOT EXISTS (
                   SELECT 1 FROM leave_attachments la
                   WHERE la.leave_request_id = lr.leave_request_id
                     AND COALESCE(TRIM(la.file_path), "") <> ""
               )
             ORDER BY lr.leave_request_id
             FOR UPDATE'
        );
        $statement->execute([':employee_id' => $employeeId]);
        $requests = $statement->fetchAll();
        $stamp = $pdo->prepare(
            'UPDATE leave_requests SET medical_certificate_reminded_at = NOW(), updated_at = updated_at
             WHERE leave_request_id = :id'
        );

        foreach ($requests as $request) {
            $id = (int)$request['leave_request_id'];
            $notificationId = notification_insert(
                $pdo,
                $userId,
                'Medical Certificate Reminder',
                sprintf(
                    'It has been three days since you filed your sick-leave request for %s to %s. Please upload your medical certificate using the file-upload icon in the request\'s Actions column.',
                    (string)$request['start_date'],
                    (string)$request['end_date']
                ),
                'leave_medical_certificate_reminder',
                (string)$id
            );
            if ($notificationId !== null) {
                $stamp->execute([':id' => $id]);
            }
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}
