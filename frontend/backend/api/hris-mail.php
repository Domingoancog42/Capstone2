<?php
declare(strict_types=1);

/**
 * Shared HRIS email presentation layer.
 *
 * Every outbound HRIS email (OTP codes, account notices, workflow rejections) is composed from
 * the builders in this file so the branding, spacing, and footer stay identical across features.
 * Callers supply content blocks; this module owns the markup.
 */

const HRIS_MAIL_BRAND_DARK = '#0b3323';
const HRIS_MAIL_BRAND_ACCENT = '#0d47a1';
const HRIS_MAIL_PAGE_BACKGROUND = '#eef4f0';
const HRIS_MAIL_ORGANIZATION = 'DENR - Mines and Geosciences Bureau Region X';
const HRIS_MAIL_PORTAL_NAME = 'MGB HRIS Portal';

/**
 * Badge palettes used by status blocks and notification banners.
 */
const HRIS_MAIL_TONES = [
    'success' => ['background' => '#dcfce7', 'text' => '#166534', 'border' => '#86efac'],
    'danger' => ['background' => '#fee2e2', 'text' => '#991b1b', 'border' => '#fca5a5'],
    'warning' => ['background' => '#fef3c7', 'text' => '#92400e', 'border' => '#fcd34d'],
    'info' => ['background' => '#dbeafe', 'text' => '#1e40af', 'border' => '#93c5fd'],
    'neutral' => ['background' => '#e2e8f0', 'text' => '#334155', 'border' => '#cbd5e1'],
];

function mail_escape(mixed $value): string
{
    return htmlspecialchars((string)($value ?? ''), ENT_QUOTES, 'UTF-8');
}

function mail_multiline(mixed $value): string
{
    return nl2br(mail_escape($value), false);
}

function mail_tone(string $tone): array
{
    return HRIS_MAIL_TONES[$tone] ?? HRIS_MAIL_TONES['neutral'];
}

/**
 * "5 minutes" / "1 minute" — used by every OTP email.
 */
function mail_minutes_label(int $minutes): string
{
    return $minutes . ' minute' . ($minutes === 1 ? '' : 's');
}

function mail_logo_markup(?string $logoContentId): string
{
    if ($logoContentId !== null && $logoContentId !== '') {
        return '<img src="cid:' . mail_escape($logoContentId) . '" alt="MGB Logo" width="60" height="60"'
            . ' style="display:block; width:60px; height:60px; border:0; border-radius:50%;" />';
    }

    return '<div style="width:60px; height:60px; border-radius:50%; background:#ffffff; color:' . HRIS_MAIL_BRAND_DARK
        . '; font-size:22px; font-weight:700; line-height:60px; text-align:center;">MGB</div>';
}

/**
 * Wraps block markup in the padded table row every section sits in.
 */
function mail_row(string $html, string $padding = '18px 32px 0 32px'): string
{
    return '<tr><td style="padding:' . $padding . ';">' . $html . '</td></tr>';
}

function mail_paragraph(string $html, string $color = '#4b5563'): string
{
    return mail_row(
        '<div style="font-size:14px; line-height:24px; color:' . $color . ';">' . $html . '</div>',
        '18px 32px 0 32px'
    );
}

function mail_greeting(string $name, string $intro): string
{
    $greeting = trim($name) !== ''
        ? '<div style="font-size:18px; line-height:28px; color:#111827;">Hello <span style="font-weight:700; color:'
            . HRIS_MAIL_BRAND_ACCENT . ';">' . mail_escape($name) . '</span>,</div>'
        : '';
    $introMarkup = trim($intro) !== ''
        ? '<div style="font-size:16px; line-height:28px; color:#374151; margin-top:' . ($greeting !== '' ? '18px' : '0')
            . ';">' . mail_escape($intro) . '</div>'
        : '';

    return mail_row($greeting . $introMarkup, '34px 32px 0 32px');
}

/**
 * The gradient hero card holding a one-time passcode.
 */
function mail_code_block(string $label, string $code, string $footnote): string
{
    return mail_row(
        '<div style="border:1px solid #d7e5dc; border-radius:22px; background:linear-gradient(135deg, #f8fbf8 0%, #eef7f1 100%); padding:24px; text-align:center;">'
        . '<div style="font-size:12px; line-height:18px; letter-spacing:2px; text-transform:uppercase; color:#5f7a67; font-weight:700;">'
        . mail_escape($label) . '</div>'
        . '<div style="font-size:38px; line-height:44px; letter-spacing:8px; font-weight:800; color:#1f2937; margin-top:12px;">'
        . mail_escape($code) . '</div>'
        . ($footnote !== ''
            ? '<div style="font-size:14px; line-height:22px; color:#4b5563; margin-top:14px;">' . $footnote . '</div>'
            : '')
        . '</div>',
        '20px 32px 0 32px'
    );
}

/**
 * The gradient hero card holding a status pill (approved, rejected, updated, ...).
 */
function mail_status_block(
    string $label,
    string $badgeText,
    string $tone = 'neutral',
    string $captionLabel = '',
    string $captionValue = ''
): string {
    $palette = mail_tone($tone);

    return mail_row(
        '<div style="border:1px solid #d7e5dc; border-radius:22px; background:linear-gradient(135deg, #f8fbf8 0%, #eef7f1 100%); padding:24px; text-align:center;">'
        . '<div style="font-size:12px; line-height:18px; letter-spacing:2px; text-transform:uppercase; color:#5f7a67; font-weight:700;">'
        . mail_escape($label) . '</div>'
        . '<div style="display:inline-block; margin-top:12px; padding:6px 14px; border-radius:999px; background-color:'
        . $palette['background'] . '; color:' . $palette['text']
        . '; font-size:12px; line-height:18px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase;">'
        . mail_escape($badgeText) . '</div>'
        . ($captionLabel !== ''
            ? '<div style="font-size:14px; line-height:24px; color:#4b5563; margin-top:14px;">' . mail_escape($captionLabel) . '</div>'
            : '')
        . ($captionValue !== ''
            ? '<div style="font-size:22px; line-height:32px; color:#1f2937; margin-top:12px; font-weight:800;">' . $captionValue . '</div>'
            : '')
        . '</div>',
        '20px 32px 0 32px'
    );
}

/**
 * Accent-bordered panel. $rows is an ordered label => value map; $sections appends further
 * heading/body pairs under the same panel (used for "Submitted Reason" style content).
 */
function mail_detail_block(string $heading, array $rows = [], array $sections = []): string
{
    $markup = '<div style="border-left:4px solid ' . HRIS_MAIL_BRAND_ACCENT
        . '; background-color:#f8fafc; border-radius:16px; padding:16px 18px;">';

    if ($heading !== '') {
        $markup .= '<div style="font-size:12px; line-height:18px; letter-spacing:1.6px; text-transform:uppercase; color:#475569; font-weight:700;">'
            . mail_escape($heading) . '</div>';
    }

    $isFirstRow = true;
    foreach ($rows as $label => $value) {
        $markup .= '<div style="font-size:14px; line-height:24px; color:#334155;'
            . ($isFirstRow && $heading !== '' ? ' margin-top:10px;' : '') . '"><strong>'
            . mail_escape($label) . ':</strong> ' . mail_escape($value) . '</div>';
        $isFirstRow = false;
    }

    foreach ($sections as $sectionHeading => $sectionHtml) {
        $markup .= '<div style="font-size:12px; line-height:18px; letter-spacing:1.6px; text-transform:uppercase; color:#475569; font-weight:700; margin-top:16px;">'
            . mail_escape($sectionHeading) . '</div>'
            . '<div style="font-size:14px; line-height:24px; color:#334155; margin-top:10px;">' . $sectionHtml . '</div>';
    }

    return mail_row($markup . '</div>');
}

/**
 * Accent-bordered panel holding a single sentence — the "what happens next" callout.
 */
function mail_note_block(string $html): string
{
    return mail_row(
        '<div style="border-left:4px solid ' . HRIS_MAIL_BRAND_ACCENT
        . '; background-color:#f8fafc; border-radius:16px; padding:16px 18px;">'
        . '<div style="font-size:14px; line-height:24px; color:#334155;">' . $html . '</div>'
        . '</div>'
    );
}

/**
 * Label/value card, optionally followed by a highlighted value (temporary password) and a warning line.
 */
function mail_definition_block(
    string $heading,
    array $rows,
    string $highlightLabel = '',
    string $highlightValue = '',
    string $footnoteHtml = ''
): string {
    $markup = '<div style="border:1px solid #d7e5dc; border-radius:22px; background-color:#f8fbf8; padding:22px;">';

    if ($heading !== '') {
        $markup .= '<div style="font-size:12px; line-height:18px; letter-spacing:2px; text-transform:uppercase; color:#5f7a67; font-weight:800;">'
            . mail_escape($heading) . '</div>';
    }

    $markup .= '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px; border-collapse:collapse;">';

    foreach ($rows as $label => $value) {
        $markup .= '<tr>'
            . '<td style="padding:10px 0; color:#64748b; font-size:13px; line-height:20px; width:42%;">' . mail_escape($label) . '</td>'
            . '<td style="padding:10px 0; color:#111827; font-size:14px; line-height:20px; font-weight:700;">' . mail_escape($value) . '</td>'
            . '</tr>';
    }

    $markup .= '</table>';

    if ($highlightValue !== '') {
        $markup .= '<div style="margin-top:16px; padding:16px; border-radius:16px; background-color:#ffffff; border:1px solid #dbe7df;">'
            . '<div style="font-size:12px; line-height:18px; letter-spacing:1.8px; text-transform:uppercase; color:#64748b; font-weight:800;">'
            . mail_escape($highlightLabel) . '</div>'
            . '<div style="font-size:24px; line-height:32px; color:#111827; font-weight:800; margin-top:8px; word-break:break-all;">'
            . mail_escape($highlightValue) . '</div>'
            . '</div>';
    }

    if ($footnoteHtml !== '') {
        $markup .= '<div style="font-size:13px; line-height:22px; color:#991b1b; margin-top:14px;">' . $footnoteHtml . '</div>';
    }

    return mail_row($markup . '</div>', '20px 32px 0 32px');
}

/**
 * Accent-bordered panel holding a numbered walkthrough.
 *
 * @param list<string> $steps
 */
function mail_steps_block(string $heading, array $steps): string
{
    $items = '';
    foreach ($steps as $step) {
        $items .= '<li>' . mail_escape($step) . '</li>';
    }

    return mail_row(
        '<div style="border-left:4px solid ' . HRIS_MAIL_BRAND_ACCENT
        . '; background-color:#f8fafc; border-radius:16px; padding:18px;">'
        . '<div style="font-size:12px; line-height:18px; letter-spacing:1.8px; text-transform:uppercase; color:#475569; font-weight:800;">'
        . mail_escape($heading) . '</div>'
        . '<ol style="margin:12px 0 0 20px; padding:0; color:#334155; font-size:14px; line-height:24px;">' . $items . '</ol>'
        . '</div>'
    );
}

/**
 * Tinted callout used for security notices and warnings.
 */
function mail_callout_block(string $heading, string $html, string $tone = 'warning'): string
{
    $palette = mail_tone($tone);

    return mail_row(
        '<div style="border:1px solid ' . $palette['border'] . '; background-color:' . $palette['background']
        . '; border-radius:16px; padding:16px 18px;">'
        . ($heading !== ''
            ? '<div style="font-size:12px; line-height:18px; letter-spacing:1.8px; text-transform:uppercase; color:'
                . $palette['text'] . '; font-weight:800;">' . mail_escape($heading) . '</div>'
            : '')
        . '<div style="font-size:14px; line-height:24px; color:' . $palette['text'] . '; margin-top:8px;">' . $html . '</div>'
        . '</div>'
    );
}

function mail_button_block(string $label, string $url): string
{
    return mail_row(
        '<a href="' . mail_escape($url) . '" style="display:inline-block; background-color:' . HRIS_MAIL_BRAND_ACCENT
        . '; color:#ffffff; font-size:15px; font-weight:700; line-height:22px; text-decoration:none; padding:13px 26px; border-radius:12px;">'
        . mail_escape($label) . '</a>',
        '22px 32px 0 32px'
    );
}

/**
 * Centered pill call-to-action with the destination spelled out underneath, for clients that
 * strip buttons.
 */
function mail_cta_block(string $label, string $url): string
{
    $escapedUrl = mail_escape($url);

    return '<tr><td align="center" style="padding:20px 32px 0 32px;">'
        . '<a href="' . $escapedUrl . '" style="display:inline-block; border-radius:999px; background-color:#0f766e; color:#ffffff;'
        . ' font-size:14px; line-height:18px; font-weight:800; text-decoration:none; padding:14px 24px; letter-spacing:1px; text-transform:uppercase;">'
        . mail_escape($label) . '</a>'
        . '<div style="font-size:13px; line-height:22px; color:#64748b; margin-top:14px;">Direct Login Link:<br />'
        . '<a href="' . $escapedUrl . '" style="color:' . HRIS_MAIL_BRAND_ACCENT . '; word-break:break-all;">' . $escapedUrl . '</a></div>'
        . '</td></tr>';
}

/**
 * Assembles a complete HTML email.
 *
 * @param array{
 *     title?: string,
 *     preheader?: string,
 *     eyebrow?: string,
 *     heading?: string,
 *     subtitle?: string,
 *     logoContentId?: string|null,
 *     greetingName?: string,
 *     intro?: string,
 *     blocks?: list<string>,
 *     closing?: string,
 *     footerNote?: string,
 *     footerLines?: list<string>
 * } $options
 */
function mail_document(array $options): string
{
    $title = (string)($options['title'] ?? HRIS_MAIL_PORTAL_NAME);
    $preheader = (string)($options['preheader'] ?? '');
    $eyebrow = (string)($options['eyebrow'] ?? 'Authorized Access');
    $heading = (string)($options['heading'] ?? HRIS_MAIL_PORTAL_NAME);
    $subtitle = (string)($options['subtitle'] ?? '');
    $greetingName = (string)($options['greetingName'] ?? '');
    $intro = (string)($options['intro'] ?? '');
    $closing = (string)($options['closing'] ?? '');
    $footerNote = (string)($options['footerNote'] ?? 'This is an automated message from the MGB HRIS Portal.');
    $footerLines = (array)($options['footerLines'] ?? [HRIS_MAIL_ORGANIZATION, $footerNote]);
    $blocks = array_values(array_filter((array)($options['blocks'] ?? []), static fn ($block): bool => is_string($block) && $block !== ''));

    $body = '';

    if ($greetingName !== '' || $intro !== '') {
        $body .= mail_greeting($greetingName, $intro);
    }

    $body .= implode('', $blocks);

    if ($closing !== '') {
        $body .= mail_paragraph(mail_escape($closing));
    }

    return implode('', [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<title>' . mail_escape($title) . '</title>',
        '</head>',
        '<body style="margin:0; padding:0; background-color:' . HRIS_MAIL_PAGE_BACKGROUND . '; font-family:Arial, Helvetica, sans-serif; color:#1f2937;">',
        '<div style="display:none; max-height:0; overflow:hidden; opacity:0;">' . mail_escape($preheader) . '</div>',
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:'
            . HRIS_MAIL_PAGE_BACKGROUND . '; margin:0; padding:24px 12px;">',
        '<tr><td align="center">',
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px; background-color:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 12px 40px rgba(15, 23, 42, 0.10);">',

        // Branded header band.
        '<tr><td style="background-color:' . HRIS_MAIL_BRAND_DARK . '; padding:0;">',
        '<div style="height:8px; background-color:' . HRIS_MAIL_BRAND_ACCENT . ';"></div>',
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>',
        '<td style="padding:28px 32px 24px 32px;">',
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>',
        '<td style="vertical-align:middle; width:76px;">' . mail_logo_markup($options['logoContentId'] ?? null) . '</td>',
        '<td style="vertical-align:middle; padding-left:18px;">',
        '<div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#cce3d4; font-weight:700;">'
            . mail_escape($eyebrow) . '</div>',
        '<div style="font-size:28px; line-height:34px; font-weight:800; color:#ffffff; margin-top:6px;">'
            . mail_escape($heading) . '</div>',
        $subtitle !== ''
            ? '<div style="font-size:14px; line-height:22px; color:#d8f0e0; margin-top:8px;">' . mail_escape($subtitle) . '</div>'
            : '',
        '</td></tr></table>',
        '</td></tr></table>',
        '</td></tr>',

        $body,

        // Footer.
        '<tr><td style="padding:26px 32px 32px 32px;">',
        '<div style="height:1px; background-color:#e5e7eb;"></div>',
        implode('', array_map(
            static fn (string $line, int $index): string => '<div style="font-size:12px; line-height:20px; color:'
                . ($index === 0 ? '#6b7280' : '#94a3b8') . ';'
                . ($index === 0 ? ' margin-top:18px;' : '') . '">' . mail_escape($line) . '</div>',
            array_values($footerLines),
            array_keys(array_values($footerLines))
        )),
        '</td></tr>',

        '</table>',
        '</td></tr>',
        '</table>',
        '</body>',
        '</html>',
    ]);
}

/**
 * Designed shell for short account notifications ("your email was changed", "password updated").
 * Replaces the bare <div> these alerts used to ship with.
 */
function mail_notification_document(
    string $heading,
    string $message,
    string $tone = 'info',
    ?string $logoContentId = null,
    string $recipientName = ''
): string {
    return mail_document([
        'title' => $heading,
        'preheader' => $heading,
        'eyebrow' => 'Account Notification',
        'subtitle' => 'Region X Mines and Geosciences Bureau account activity',
        'logoContentId' => $logoContentId,
        'greetingName' => $recipientName,
        'intro' => $recipientName !== '' ? '' : $heading,
        'blocks' => [
            mail_status_block('Account Update', $heading, $tone),
            mail_note_block(mail_multiline($message)),
        ],
        'closing' => 'If you did not perform this action, contact the HRIS administrator immediately.',
        'footerNote' => 'This is an automated security message from the HRIS account service.',
    ]);
}

/**
 * Plain-text counterpart for mail_notification_document().
 */
function mail_notification_text(string $heading, string $message): string
{
    return HRIS_MAIL_PORTAL_NAME . " - {$heading}\n\n"
        . $message . "\n\n"
        . "If you did not perform this action, contact the HRIS administrator immediately.";
}
