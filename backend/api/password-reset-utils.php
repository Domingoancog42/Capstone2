<?php
declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/smtp-config.php';
require_once __DIR__ . '/hris-mail.php';

use PHPMailer\PHPMailer\PHPMailer;

function password_reset_smtp_config(): array
{
    return [
        'host' => defined('SMTP_HOST') ? SMTP_HOST : '',
        'port' => defined('SMTP_PORT') ? (int)SMTP_PORT : 587,
        'username' => defined('SMTP_USERNAME') ? SMTP_USERNAME : '',
        'password' => defined('SMTP_PASSWORD') ? preg_replace('/\s+/', '', (string)SMTP_PASSWORD) : '',
        'from_email' => defined('SMTP_FROM_EMAIL') ? SMTP_FROM_EMAIL : '',
        'from_name' => defined('SMTP_FROM_NAME') ? SMTP_FROM_NAME : 'REGION X MGB',
        'encryption' => strtolower((string)(defined('SMTP_ENCRYPTION') ? SMTP_ENCRYPTION : 'tls')),
    ];
}

function is_local_password_reset_environment(): bool
{
    /*
     * A forwarded request is never local, whatever the address on the socket says.
     *
     * This gate can put a live reset code in the response body, so what counts as "local" has to mean
     * the person is at this machine. REMOTE_ADDR does not mean that on its own: the React dev server's
     * `proxy` forwards anything it does not recognise to http://localhost, so with a tunnel pointed at
     * port 3000 every request in the world reaches Apache from 127.0.0.1 and satisfies the check below.
     * The same laundering is what let a published tunnel reach phpMyAdmin and /server-status through
     * their `Require local`.
     *
     * ALLOW_LOCAL_RESET_CODE_FALLBACK is off by default, so this was latent rather than live -- but it
     * is exactly the flag someone turns on for an afternoon of offline testing and forgets, and the
     * presence of any forwarding header is enough to say no.
     */
    foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_HOST', 'HTTP_X_REAL_IP', 'HTTP_FORWARDED'] as $header) {
        if (trim((string)($_SERVER[$header] ?? '')) !== '') {
            return false;
        }
    }

    $values = [
        (string)($_SERVER['HTTP_HOST'] ?? ''),
        (string)($_SERVER['SERVER_NAME'] ?? ''),
        (string)($_SERVER['REMOTE_ADDR'] ?? ''),
    ];

    foreach ($values as $value) {
        $normalized = strtolower(trim($value));

        if (
            $normalized === 'localhost'
            || $normalized === '127.0.0.1'
            || $normalized === '::1'
            || str_starts_with($normalized, 'localhost:')
            || str_starts_with($normalized, '127.0.0.1:')
            || str_starts_with($normalized, '[::1]:')
        ) {
            return true;
        }
    }

    return false;
}

function password_reset_store(): array
{
    if (!isset($_SESSION['password_reset_codes']) || !is_array($_SESSION['password_reset_codes'])) {
        $_SESSION['password_reset_codes'] = [];
    }

    return $_SESSION['password_reset_codes'];
}

function password_reset_code_expiry_minutes(): int
{
    return max(1, (int)(defined('CODE_EXPIRY_MINUTES') ? CODE_EXPIRY_MINUTES : 10));
}

function find_user_by_reset_identifier(PDO $pdo, string $identifier): ?array
{
    // The hash comes along so the reset can refuse a password the account is already using. It is
    // only ever compared against here -- neither caller puts this row in a response.
    $statement = $pdo->prepare(
        'SELECT id, username, email, status, password_hash
         FROM users
         WHERE (username = :username_identifier OR email = :email_identifier)
           AND is_archived = 0
         LIMIT 1'
    );
    $statement->execute([
        ':username_identifier' => $identifier,
        ':email_identifier' => $identifier,
    ]);
    $user = $statement->fetch();

    return $user ?: null;
}

function generate_password_reset_code(): string
{
    return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

/*
 * How many wrong guesses one issued code survives.
 *
 * The per-IP `passwordReset` throttle already bounds how fast a client may submit, but it bounds the
 * *client* -- and the one thing an address-keyed counter cannot see is the same guess arriving from a
 * hundred different addresses. This cap is keyed to the code itself, so a distributed attempt spends
 * the same five guesses a single-address one does, and spends them for good: the sixth wrong answer
 * destroys the code rather than merely delaying the next try.
 *
 * Five is chosen against a six-digit space. It leaves an honest user room to fat-finger the code they
 * are reading off their phone, while capping the odds any one issued code can be guessed at 5-in-a-
 * million -- and a fresh code is a fresh mailbox round trip, which is the part an attacker cannot skip.
 */
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

function store_password_reset_code(int $userId, string $code, ?int $expiresInMinutes = null): void
{
    $expiresInMinutes = $expiresInMinutes ?? password_reset_code_expiry_minutes();
    $store = password_reset_store();
    $store[$userId] = [
        'code_hash' => password_hash($code, PASSWORD_DEFAULT),
        'expires_at' => time() + ($expiresInMinutes * 60),
        // Guesses spent against this particular code. Issuing a new one starts the count over, which
        // is intended: the cost of a fresh budget is a fresh email to a mailbox the attacker must hold.
        'attempts' => 0,
    ];
    $_SESSION['password_reset_codes'] = $store;
}

function delete_password_reset_code(int $userId): void
{
    $store = password_reset_store();
    unset($store[$userId]);
    $_SESSION['password_reset_codes'] = $store;
}

/**
 * Check one guess against the stored code and spend an attempt if it is wrong.
 *
 * Returns `ok` when the code matches, and `exhausted` when this call used up the last attempt and the
 * code was destroyed. The caller needs both because they are different things to say to the user: a
 * wrong code can be retyped, a burnt one has to be re-requested.
 *
 * A correct guess does not clear the entry -- reset_password.php spends the code inside its
 * transaction, so a password that is refused further down (one already in use, one that fails policy)
 * leaves the code usable for the retry.
 */
function verify_password_reset_code(int $userId, string $code): array
{
    $store = password_reset_store();
    $entry = $store[$userId] ?? null;

    if (!is_array($entry)) {
        return ['ok' => false, 'exhausted' => false];
    }

    if ((int)($entry['expires_at'] ?? 0) < time()) {
        delete_password_reset_code($userId);
        return ['ok' => false, 'exhausted' => false];
    }

    if (password_verify($code, (string)($entry['code_hash'] ?? ''))) {
        return ['ok' => true, 'exhausted' => false];
    }

    $attempts = (int)($entry['attempts'] ?? 0) + 1;

    if ($attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
        delete_password_reset_code($userId);
        return ['ok' => false, 'exhausted' => true];
    }

    $entry['attempts'] = $attempts;
    $store[$userId] = $entry;
    $_SESSION['password_reset_codes'] = $store;

    return ['ok' => false, 'exhausted' => false];
}

function consume_password_reset_code(int $userId): void
{
    delete_password_reset_code($userId);
}

/** Alias kept for existing callers; mail_escape() is the shared implementation. */
function password_reset_escape_html(string $value): string
{
    return mail_escape($value);
}

function password_reset_embed_logo(PHPMailer $mail): ?string
{
    $logoPath = realpath(__DIR__ . '/../../public/mgb.png');

    if (!is_string($logoPath) || $logoPath === '' || !is_file($logoPath)) {
        return null;
    }

    $contentId = 'mgb-hris-logo';

    try {
        $mail->addEmbeddedImage($logoPath, $contentId, 'mgb.png', PHPMailer::ENCODING_BASE64, 'image/png');
        return $contentId;
    } catch (Throwable) {
        return null;
    }
}

function password_reset_subject(): string
{
    $configuredSubject = trim((string)(defined('EMAIL_SUBJECT') ? EMAIL_SUBJECT : ''));

    if ($configuredSubject === '' || strcasecmp($configuredSubject, 'REGION X MGB') === 0) {
        return 'REGION X MGB | HRIS Password Reset Code';
    }

    return $configuredSubject;
}

function email_base_label(): string
{
    $configuredSubject = trim((string)(defined('EMAIL_SUBJECT') ? EMAIL_SUBJECT : ''));

    return $configuredSubject !== '' ? $configuredSubject : 'REGION X MGB';
}

function configured_mailer(): PHPMailer
{
    $config = password_reset_smtp_config();

    if (
        $config['host'] === '' ||
        $config['username'] === '' ||
        $config['password'] === '' ||
        $config['from_email'] === ''
    ) {
        throw new RuntimeException('SMTP is not configured. Set SMTP_* values in smtp-config.php or your server environment.');
    }

    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = $config['host'];
    $mail->SMTPAuth = true;
    $mail->Username = $config['username'];
    $mail->Password = $config['password'];
    $mail->Port = $config['port'];
    $mail->Timeout = 15;
    $mail->Timelimit = 15;
    $mail->SMTPKeepAlive = false;

    if ($config['encryption'] === 'ssl' || $config['encryption'] === 'smtps') {
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
    } elseif ($config['encryption'] === 'none' || $config['encryption'] === '') {
        $mail->SMTPSecure = false;
        $mail->SMTPAutoTLS = false;
    } else {
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    }

    $mail->setFrom($config['from_email'], $config['from_name']);
    $mail->CharSet = 'UTF-8';
    $mail->isHTML(true);

    return $mail;
}

function mail_delivery_error(PHPMailer $mail, Throwable $exception): string
{
    $details = trim((string)$mail->ErrorInfo);
    $message = trim($exception->getMessage());
    $combined = trim($details !== '' ? $details : $message);

    if ($combined === '' && $message !== '') {
        $combined = $message;
    }

    $combined = preg_replace('/\s+/', ' ', $combined) ?? $combined;

    if (stripos($combined, 'Daily user sending limit exceeded') !== false || stripos($combined, '5.4.5') !== false) {
        return 'Gmail daily sending limit exceeded for the configured SMTP account. Try again after Gmail resets the limit or use a different SMTP account.';
    }

    if (stripos($combined, 'Could not connect to SMTP host') !== false) {
        return 'Could not connect to the SMTP host. Check internet access, firewall rules, SMTP host, port, and encryption settings.';
    }

    if (stripos($combined, 'authenticate') !== false || stripos($combined, 'authentication') !== false) {
        return 'SMTP authentication failed. Check the sender email address and app password.';
    }

    return $combined !== '' ? $combined : 'Unable to send email through the configured SMTP account.';
}

function format_human_date(?string $value): string
{
    $text = trim((string)($value ?? ''));

    if ($text === '') {
        return 'Not specified';
    }

    $date = DateTimeImmutable::createFromFormat('Y-m-d', $text);

    if ($date instanceof DateTimeImmutable && $date->format('Y-m-d') === $text) {
        return $date->format('F j, Y');
    }

    return $text;
}

function password_reset_html_body(string $username, string $code, int $expiresInMinutes, ?string $logoContentId = null): string
{
    return mail_document([
        'title' => 'HRIS Password Reset Code',
        'preheader' => 'Use your 6-digit HRIS password reset code to regain access to the MGB HRIS Portal.',
        'subtitle' => 'Region X Mines and Geosciences Bureau password recovery',
        'logoContentId' => $logoContentId,
        'greetingName' => $username,
        'intro' => 'Use this 6-digit code to reset your HRIS password.',
        'blocks' => [
            mail_code_block(
                'Reset Code',
                $code,
                'This code expires in <strong>' . mail_escape(mail_minutes_label($expiresInMinutes)) . '</strong>.'
            ),
            mail_note_block('After resetting your password, return to the <strong>MGB HRIS Portal</strong> and sign in with your new password.'),
        ],
        'closing' => 'If you did not request a password reset, you can safely ignore this email.',
        'footerNote' => 'This is an automated security message from the HRIS password recovery service.',
    ]);
}

function password_reset_text_body(string $username, string $code, int $expiresInMinutes): string
{
    $expiresText = $expiresInMinutes . ' minute' . ($expiresInMinutes === 1 ? '' : 's');

    return "REGION X MGB - MGB HRIS Portal\n"
        . "Hello {$username},\n\n"
        . "Use this 6-digit code to reset your HRIS password: {$code}\n"
        . "This code expires in {$expiresText}.\n\n"
        . "After resetting your password, return to the MGB HRIS Portal and sign in with your new password.\n\n"
        . "If you did not request this, you can ignore this email.";
}

function leave_request_rejection_subject(): string
{
    return email_base_label() . ' | Leave Request Rejected';
}

function leave_request_rejection_html_body(
    string $employeeName,
    string $leaveType,
    string $leaveDetails,
    string $division,
    string $startDate,
    string $endDate,
    string $numberOfDays,
    string $reason,
    string $rejectedNote,
    ?string $logoContentId = null,
    string $leaveDates = ''
): string {
    $summaryRows = ['Leave Type' => $leaveType !== '' ? $leaveType : 'Not specified'];

    if ($leaveDetails !== '') {
        $summaryRows['Leave Details'] = $leaveDetails;
    }

    $summaryRows['Division'] = $division !== '' ? $division : 'Not specified';

    /*
     * A request covers the days it actually named, which can skip working days inside its span, so
     * the exact list replaces the start and end whenever the filing recorded one.
     */
    if ($leaveDates !== '') {
        $summaryRows['Leave Dates'] = $leaveDates;
    } else {
        $summaryRows['Start Date'] = format_human_date($startDate);
        $summaryRows['End Date'] = format_human_date($endDate);
    }

    $summaryRows['Number of Days'] = $numberOfDays !== '' ? $numberOfDays : 'Not specified';

    return mail_document([
        'title' => 'Leave Request Rejected',
        'preheader' => 'Your leave request has been reviewed and marked as rejected in the MGB HRIS Portal.',
        'subtitle' => 'Region X Mines and Geosciences Bureau leave request update',
        'logoContentId' => $logoContentId,
        'greetingName' => $employeeName,
        'intro' => 'Your leave request has been reviewed and was not approved at this time.',
        'blocks' => [
            mail_status_block(
                'Leave Request Update',
                'Rejected',
                'danger',
                'Administrative note from the reviewer',
                mail_multiline($rejectedNote)
            ),
            mail_detail_block(
                'Request Summary',
                $summaryRows,
                ['Submitted Reason' => mail_multiline($reason !== '' ? $reason : 'No leave reason was provided.')]
            ),
        ],
        'closing' => 'Please sign in to the MGB HRIS Portal if you need to review your request details or coordinate with your supervisor or HR office.',
        'footerNote' => 'This is an automated notification from the HRIS leave request workflow.',
    ]);
}

function leave_request_rejection_text_body(
    string $employeeName,
    string $leaveType,
    string $leaveDetails,
    string $division,
    string $startDate,
    string $endDate,
    string $numberOfDays,
    string $reason,
    string $rejectedNote,
    string $leaveDates = ''
): string {
    return "REGION X MGB - Leave Request Rejected\n"
        . "Hello {$employeeName},\n\n"
        . "Your leave request has been reviewed and was not approved at this time.\n\n"
        . "Administrative note: {$rejectedNote}\n\n"
        . "Leave type: " . ($leaveType !== '' ? $leaveType : 'Not specified') . "\n"
        . ($leaveDetails !== '' ? "Leave details: {$leaveDetails}\n" : '')
        . "Division: " . ($division !== '' ? $division : 'Not specified') . "\n"
        . ($leaveDates !== ''
            ? "Leave dates: {$leaveDates}\n"
            : "Start date: " . format_human_date($startDate) . "\n"
                . "End date: " . format_human_date($endDate) . "\n")
        . "Number of days: " . ($numberOfDays !== '' ? $numberOfDays : 'Not specified') . "\n"
        . "Submitted reason: " . ($reason !== '' ? $reason : 'No leave reason was provided.') . "\n\n"
        . "Please sign in to the MGB HRIS Portal if you need to review your request details or coordinate with your supervisor or HR office.";
}

function send_leave_request_rejection_email(
    string $recipientEmail,
    string $employeeName,
    string $leaveType,
    string $leaveDetails,
    string $division,
    string $startDate,
    string $endDate,
    string $numberOfDays,
    string $reason,
    string $rejectedNote,
    string $leaveDates = ''
): void {
    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = leave_request_rejection_subject();
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = leave_request_rejection_html_body(
        $employeeName,
        $leaveType,
        $leaveDetails,
        $division,
        $startDate,
        $endDate,
        $numberOfDays,
        $reason,
        $rejectedNote,
        $logoContentId,
        $leaveDates
    );
    $mail->AltBody = leave_request_rejection_text_body(
        $employeeName,
        $leaveType,
        $leaveDetails,
        $division,
        $startDate,
        $endDate,
        $numberOfDays,
        $reason,
        $rejectedNote,
        $leaveDates
    );
    $mail->send();
}

function travel_order_rejection_subject(): string
{
    return email_base_label() . ' | Travel Order Rejected';
}

function travel_order_rejection_html_body(
    string $employeeName,
    string $division,
    string $destination,
    string $purpose,
    string $startDate,
    string $endDate,
    string $assistanceLabor,
    string $appropriations,
    string $remarks,
    string $rejectedNote,
    ?string $logoContentId = null,
    string $travelDates = ''
): string {
    $summaryRows = [
        'Destination' => $destination !== '' ? $destination : 'Not specified',
        'Division' => $division !== '' ? $division : 'Not specified',
        'Start Date' => format_human_date($startDate),
        'End Date' => format_human_date($endDate),
    ];

    /*
     * An order covers the days it actually named, which can skip days inside its span, so the exact
     * list is added whenever the filing recorded one. Departure and arrival stay: they are the trip.
     */
    if ($travelDates !== '') {
        $summaryRows['Travel Dates'] = $travelDates;
    }

    $summaryRows['Assistance or Labor'] = $assistanceLabor !== '' ? $assistanceLabor : 'Not specified';

    return mail_document([
        'title' => 'Travel Order Rejected',
        'preheader' => 'Your travel order has been reviewed and marked as rejected in the MGB HRIS Portal.',
        'subtitle' => 'Region X Mines and Geosciences Bureau travel order update',
        'logoContentId' => $logoContentId,
        'greetingName' => $employeeName,
        'intro' => 'Your travel order has been reviewed and was not approved at this time.',
        'blocks' => [
            mail_status_block(
                'Travel Order Update',
                'Rejected',
                'danger',
                'Administrative note from the reviewer',
                mail_multiline($rejectedNote)
            ),
            mail_detail_block(
                'Request Summary',
                $summaryRows,
                [
                    'Appropriations' => mail_multiline($appropriations !== '' ? $appropriations : 'Not specified'),
                    'Purpose of Travel' => mail_multiline($purpose !== '' ? $purpose : 'No travel purpose was provided.'),
                    'Submitted Remarks' => mail_multiline($remarks !== '' ? $remarks : 'No additional remarks were provided.'),
                ]
            ),
        ],
        'closing' => 'Please sign in to the MGB HRIS Portal if you need to review your travel order details or coordinate with your supervisor or HR office.',
        'footerNote' => 'This is an automated notification from the HRIS travel order workflow.',
    ]);
}

function travel_order_rejection_text_body(
    string $employeeName,
    string $division,
    string $destination,
    string $purpose,
    string $startDate,
    string $endDate,
    string $assistanceLabor,
    string $appropriations,
    string $remarks,
    string $rejectedNote,
    string $travelDates = ''
): string {
    return email_base_label() . " - Travel Order Rejected\n"
        . "Hello {$employeeName},\n\n"
        . "Your travel order has been reviewed and was not approved at this time.\n\n"
        . "Administrative note: {$rejectedNote}\n\n"
        . "Destination: " . ($destination !== '' ? $destination : 'Not specified') . "\n"
        . "Division: " . ($division !== '' ? $division : 'Not specified') . "\n"
        . "Start date: " . format_human_date($startDate) . "\n"
        . "End date: " . format_human_date($endDate) . "\n"
        . ($travelDates !== '' ? "Travel dates: {$travelDates}\n" : '')
        . "Assistance or labor: " . ($assistanceLabor !== '' ? $assistanceLabor : 'Not specified') . "\n"
        . "Appropriations: " . ($appropriations !== '' ? $appropriations : 'Not specified') . "\n"
        . "Purpose of travel: " . ($purpose !== '' ? $purpose : 'No travel purpose was provided.') . "\n"
        . "Submitted remarks: " . ($remarks !== '' ? $remarks : 'No additional remarks were provided.') . "\n\n"
        . "Please sign in to the MGB HRIS Portal if you need to review your travel order details or coordinate with your supervisor or HR office.";
}

function send_travel_order_rejection_email(
    string $recipientEmail,
    string $employeeName,
    string $division,
    string $destination,
    string $purpose,
    string $startDate,
    string $endDate,
    string $assistanceLabor,
    string $appropriations,
    string $remarks,
    string $rejectedNote,
    string $travelDates = ''
): void {
    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = travel_order_rejection_subject();
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = travel_order_rejection_html_body(
        $employeeName,
        $division,
        $destination,
        $purpose,
        $startDate,
        $endDate,
        $assistanceLabor,
        $appropriations,
        $remarks,
        $rejectedNote,
        $logoContentId,
        $travelDates
    );
    $mail->AltBody = travel_order_rejection_text_body(
        $employeeName,
        $division,
        $destination,
        $purpose,
        $startDate,
        $endDate,
        $assistanceLabor,
        $appropriations,
        $remarks,
        $rejectedNote,
        $travelDates
    );
    $mail->send();
}

function compensatory_rejection_subject(): string
{
    return email_base_label() . ' | Compensatory Request Rejected';
}

function compensatory_rejection_html_body(
    string $employeeName,
    string $division,
    string $hoursApplied,
    string $startDate,
    string $endDate,
    string $remarks,
    string $rejectedNote,
    ?string $logoContentId = null,
    string $inclusiveDates = ''
): string {
    $summaryRows = [
        'Hours Applied' => $hoursApplied !== '' ? $hoursApplied : 'Not specified',
        'Division' => $division !== '' ? $division : 'Not specified',
    ];

    /*
     * A request covers the days it actually named, which can skip days inside its span, so the exact
     * list replaces the start and end whenever the filing recorded one.
     */
    if ($inclusiveDates !== '') {
        $summaryRows['Inclusive Dates'] = $inclusiveDates;
    } else {
        $summaryRows['Inclusive Start Date'] = format_human_date($startDate);
        $summaryRows['Inclusive End Date'] = format_human_date($endDate);
    }

    return mail_document([
        'title' => 'Compensatory Request Rejected',
        'preheader' => 'Your compensatory time off request has been reviewed and marked as rejected in the MGB HRIS Portal.',
        'subtitle' => 'Region X Mines and Geosciences Bureau compensatory request update',
        'logoContentId' => $logoContentId,
        'greetingName' => $employeeName,
        'intro' => 'Your compensatory time off request has been reviewed and was not approved at this time.',
        'blocks' => [
            mail_status_block(
                'Compensatory Request Update',
                'Rejected',
                'danger',
                'Administrative note from the reviewer',
                mail_multiline($rejectedNote)
            ),
            mail_detail_block(
                'Request Summary',
                $summaryRows,
                ['Submitted Remarks' => mail_multiline($remarks !== '' ? $remarks : 'No additional remarks were provided.')]
            ),
        ],
        'closing' => 'Please sign in to the MGB HRIS Portal if you need to review your compensatory request details or coordinate with your supervisor or HR office.',
        'footerNote' => 'This is an automated notification from the HRIS compensatory request workflow.',
    ]);
}

function compensatory_rejection_text_body(
    string $employeeName,
    string $division,
    string $hoursApplied,
    string $startDate,
    string $endDate,
    string $remarks,
    string $rejectedNote,
    string $inclusiveDates = ''
): string {
    return email_base_label() . " - Compensatory Request Rejected\n"
        . "Hello {$employeeName},\n\n"
        . "Your compensatory time off request has been reviewed and was not approved at this time.\n\n"
        . "Administrative note: {$rejectedNote}\n\n"
        . "Hours applied: " . ($hoursApplied !== '' ? $hoursApplied : 'Not specified') . "\n"
        . "Division: " . ($division !== '' ? $division : 'Not specified') . "\n"
        . ($inclusiveDates !== ''
            ? "Inclusive dates: {$inclusiveDates}\n"
            : "Inclusive start date: " . format_human_date($startDate) . "\n"
                . "Inclusive end date: " . format_human_date($endDate) . "\n")
        . "Submitted remarks: " . ($remarks !== '' ? $remarks : 'No additional remarks were provided.') . "\n\n"
        . "Please sign in to the MGB HRIS Portal if you need to review your compensatory request details or coordinate with your supervisor or HR office.";
}

function send_compensatory_rejection_email(
    string $recipientEmail,
    string $employeeName,
    string $division,
    string $hoursApplied,
    string $startDate,
    string $endDate,
    string $remarks,
    string $rejectedNote,
    string $inclusiveDates = ''
): void {
    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = compensatory_rejection_subject();
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = compensatory_rejection_html_body(
        $employeeName,
        $division,
        $hoursApplied,
        $startDate,
        $endDate,
        $remarks,
        $rejectedNote,
        $logoContentId,
        $inclusiveDates
    );
    $mail->AltBody = compensatory_rejection_text_body(
        $employeeName,
        $division,
        $hoursApplied,
        $startDate,
        $endDate,
        $remarks,
        $rejectedNote,
        $inclusiveDates
    );
    $mail->send();
}

function employee_account_activation_subject(): string
{
    return 'Mines and Geosciences Bureau | Employee Account Activation';
}

function employee_account_activation_login_url(): string
{
    $configuredUrl = trim((string)(defined('HRIS_LOGIN_URL') ? HRIS_LOGIN_URL : (getenv('HRIS_LOGIN_URL') ?: '')));

    if ($configuredUrl !== '') {
        return $configuredUrl;
    }

    $origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));

    if ($origin !== '' && preg_match('#^https?://#i', $origin) === 1) {
        return rtrim($origin, '/') . '/';
    }

    $host = trim((string)($_SERVER['HTTP_HOST'] ?? ''));

    if ($host !== '') {
        $isSecure = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off')
            || (string)($_SERVER['SERVER_PORT'] ?? '') === '443';
        return ($isSecure ? 'https' : 'http') . '://' . $host;
    }

    return 'https://r13nbfw7-3000.asse.devtunnels.ms/';
}

function employee_account_activation_value(mixed $value, string $fallback = 'Not specified'): string
{
    $text = trim((string)($value ?? ''));

    return $text !== '' ? $text : $fallback;
}

function employee_account_activation_role_label(mixed $value): string
{
    $text = trim((string)($value ?? 'Employee'));
    $token = preg_replace('/[^a-z]/', '', strtolower($text));

    return match ($token) {
        'regionaldirector', 'regionaldir' => 'Regional Director',
        'hrhead' => 'HR Head',
        'hrstaff' => 'HR Staff',
        'chief' => 'Chief',
        'planningofficer', 'planning' => 'Planning Officer',
        'cashier' => 'Cashier',
        'admin', 'administrator', 'superadmin' => 'Admin',
        'employee', '' => 'Employee',
        default => $text,
    };
}

function employee_account_activation_html_body(
    array $employee,
    string $temporaryPassword,
    string $loginUrl,
    ?string $logoContentId = null
): string {
    $employeeName = employee_account_activation_value(
        $employee['employeeName'] ?? $employee['fullName'] ?? $employee['full_name'] ?? $employee['username'] ?? '',
        'Employee'
    );
    $employeeId = employee_account_activation_value($employee['employeeId'] ?? $employee['employee_id'] ?? '');
    $employeeEmail = employee_account_activation_value($employee['employeeEmail'] ?? $employee['email'] ?? '');
    $position = employee_account_activation_value($employee['position'] ?? $employee['designation'] ?? '');
    $division = employee_account_activation_value($employee['division'] ?? $employee['department'] ?? '');
    $accessRole = employee_account_activation_role_label($employee['accessRole'] ?? $employee['role'] ?? 'Employee');
    $organization = 'Mines and Geosciences Bureau';

    return mail_document([
        'title' => 'Employee Account Activation',
        'preheader' => 'Your HRIS account is ready. Use your temporary password for first login.',
        'eyebrow' => 'Mines and Geosciences Bureau',
        'heading' => 'Employee Account Activation',
        'subtitle' => 'Your HRIS Account is Ready',
        'logoContentId' => $logoContentId,
        'greetingName' => $employeeName,
        'intro' => 'Welcome to the Mines and Geosciences Bureau Human Resource Information System (HRIS). Your account has been created by the HR Administrator. Use the temporary password below for your first sign in — you will be required to change it immediately after logging in.',
        'blocks' => [
            mail_definition_block(
                'Account Information',
                [
                    'Employee Name:' => $employeeName,
                    'Employee ID:' => $employeeId,
                    'Email Address:' => $employeeEmail,
                    'Position:' => $position,
                    'Division/Section:' => $division,
                    'Access Role:' => $accessRole,
                    'Organization:' => $organization,
                ],
                'Temporary Password',
                $temporaryPassword,
                '<strong>Important:</strong> This password is valid only for your initial login and must be changed immediately after accessing the system.'
            ),
            mail_steps_block('Next Steps', [
                'Click the login button below or visit the HRIS portal.',
                'Sign in using your registered email address and temporary password.',
                'Create a new secure password.',
                'Complete or review your employee profile information.',
                'Familiarize yourself with the available HRIS features.',
            ]),
            mail_cta_block('Login to HRIS', $loginUrl),
            mail_callout_block(
                'Security Notice',
                'The Mines and Geosciences Bureau will never request your password through email, phone call, chat, or text message. Do not share your login credentials with anyone. If you receive suspicious communications regarding your account, please report them to the HR Office immediately.',
                'warning'
            ),
        ],
        'closing' => 'For assistance or technical support, please contact your HR Administrator.',
        'footerLines' => [
            'This is an automated message generated by the MGB Human Resource Information System. Please do not reply to this email.',
            '(c) 2026 Mines and Geosciences Bureau. All Rights Reserved.',
        ],
    ]);
}

function employee_account_activation_text_body(array $employee, string $temporaryPassword, string $loginUrl): string
{
    $employeeName = employee_account_activation_value(
        $employee['employeeName'] ?? $employee['fullName'] ?? $employee['full_name'] ?? $employee['username'] ?? '',
        'Employee'
    );
    $employeeId = employee_account_activation_value($employee['employeeId'] ?? $employee['employee_id'] ?? '');
    $employeeEmail = employee_account_activation_value($employee['employeeEmail'] ?? $employee['email'] ?? '');
    $position = employee_account_activation_value($employee['position'] ?? $employee['designation'] ?? '');
    $division = employee_account_activation_value($employee['division'] ?? $employee['department'] ?? '');
    $accessRole = employee_account_activation_role_label($employee['accessRole'] ?? $employee['role'] ?? 'Employee');

    return "MINES AND GEOSCIENCES BUREAU\n\n"
        . "Employee Account Activation\n\n"
        . "Your HRIS Account is Ready\n\n"
        . "Welcome to the Mines and Geosciences Bureau Human Resource Information System (HRIS). Your employee account has been successfully created by the HR Administrator, and your temporary login credentials are provided below.\n\n"
        . "Hello {$employeeName},\n\n"
        . "We are pleased to inform you that your HRIS account has been successfully created. Please use the temporary password below to access the system for the first time. For security purposes, you will be required to change your password upon login.\n\n"
        . "ACCOUNT INFORMATION\n\n"
        . "Employee Name:\n{$employeeName}\n\n"
        . "Employee ID:\n{$employeeId}\n\n"
        . "Email Address:\n{$employeeEmail}\n\n"
        . "Position:\n{$position}\n\n"
        . "Division/Section:\n{$division}\n\n"
        . "Access Role:\n{$accessRole}\n\n"
        . "Organization:\nMines and Geosciences Bureau\n\n"
        . "Temporary Password:\n{$temporaryPassword}\n\n"
        . "Important: This password is valid only for your initial login and must be changed immediately after accessing the system.\n\n"
        . "NEXT STEPS\n\n"
        . "1. Click the login button below or visit the HRIS portal.\n"
        . "2. Sign in using your registered email address and temporary password.\n"
        . "3. Create a new secure password.\n"
        . "4. Complete or review your employee profile information.\n"
        . "5. Familiarize yourself with the available HRIS features.\n\n"
        . "LOGIN TO HRIS\n\n"
        . "Access HRIS:\n{$loginUrl}\n\n"
        . "Direct Login Link:\n{$loginUrl}\n\n"
        . "SECURITY NOTICE\n\n"
        . "The Mines and Geosciences Bureau will never request your password through email, phone call, chat, or text message. Do not share your login credentials with anyone. If you receive suspicious communications regarding your account, please report them to the HR Office immediately.\n\n"
        . "For assistance or technical support, please contact your HR Administrator.\n\n"
        . "This is an automated message generated by the Mines and Geosciences Bureau Human Resource Information System (HRIS). Please do not reply to this email.\n\n"
        . "(c) 2026 Mines and Geosciences Bureau. All Rights Reserved.";
}

function send_employee_account_activation_email(
    string $recipientEmail,
    array $employee,
    string $temporaryPassword,
    ?string $loginUrl = null
): void {
    if (filter_var($recipientEmail, FILTER_VALIDATE_EMAIL) === false) {
        throw new RuntimeException('A valid employee email address is required for account activation email.');
    }

    $resolvedLoginUrl = employee_account_activation_value($loginUrl, employee_account_activation_login_url());
    $employee['employeeEmail'] = $employee['employeeEmail'] ?? $employee['email'] ?? $recipientEmail;

    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = employee_account_activation_subject();
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = employee_account_activation_html_body($employee, $temporaryPassword, $resolvedLoginUrl, $logoContentId);
    $mail->AltBody = employee_account_activation_text_body($employee, $temporaryPassword, $resolvedLoginUrl);

    try {
        $mail->send();
    } catch (Throwable $exception) {
        throw new RuntimeException(mail_delivery_error($mail, $exception), 0, $exception);
    }
}

/**
 * Sends the activation email to a batch of recipients over a single SMTP connection.
 *
 * A CSV import can create hundreds of accounts at once, and opening a fresh authenticated SMTP
 * session per employee is what makes that run for minutes. One keep-alive connection carries the
 * whole batch instead, and one failing recipient never stops the rest.
 *
 * @param array<int, array{email: string, employee: array<string, mixed>, temporaryPassword: string}> $recipients
 * @return array<int, string> Failure reason keyed by the recipient's index; empty when all were sent.
 */
function send_employee_account_activation_emails(array $recipients, ?string $loginUrl = null): array
{
    if ($recipients === []) {
        return [];
    }

    $resolvedLoginUrl = employee_account_activation_value($loginUrl, employee_account_activation_login_url());
    $failures = [];

    try {
        $mail = configured_mailer();
    } catch (Throwable $exception) {
        $reason = trim($exception->getMessage());

        foreach (array_keys($recipients) as $index) {
            $failures[$index] = $reason !== '' ? $reason : 'SMTP is not configured.';
        }

        return $failures;
    }

    $mail->SMTPKeepAlive = true;
    $mail->Subject = employee_account_activation_subject();
    $logoContentId = password_reset_embed_logo($mail);

    try {
        foreach ($recipients as $index => $recipient) {
            $recipientEmail = trim((string)($recipient['email'] ?? ''));

            if (filter_var($recipientEmail, FILTER_VALIDATE_EMAIL) === false) {
                $failures[$index] = 'A valid employee email address is required for the activation email.';
                continue;
            }

            $employee = is_array($recipient['employee'] ?? null) ? $recipient['employee'] : [];
            $employee['employeeEmail'] = $employee['employeeEmail'] ?? $employee['email'] ?? $recipientEmail;
            $temporaryPassword = (string)($recipient['temporaryPassword'] ?? '');

            try {
                $mail->clearAddresses();
                $mail->addAddress($recipientEmail);
                $mail->Body = employee_account_activation_html_body(
                    $employee,
                    $temporaryPassword,
                    $resolvedLoginUrl,
                    $logoContentId
                );
                $mail->AltBody = employee_account_activation_text_body($employee, $temporaryPassword, $resolvedLoginUrl);
                $mail->send();
            } catch (Throwable $exception) {
                $failures[$index] = mail_delivery_error($mail, $exception);
            }
        }
    } finally {
        $mail->smtpClose();
    }

    return $failures;
}

function send_password_reset_email(string $recipientEmail, string $username, string $code, ?int $expiresInMinutes = null): void
{
    $expiresInMinutes = $expiresInMinutes ?? password_reset_code_expiry_minutes();
    $mail = configured_mailer();
    $mail->addAddress($recipientEmail);
    $mail->Subject = password_reset_subject();
    $logoContentId = password_reset_embed_logo($mail);
    $mail->Body = password_reset_html_body($username, $code, $expiresInMinutes, $logoContentId);
    $mail->AltBody = password_reset_text_body($username, $code, $expiresInMinutes);
    $mail->send();
}
