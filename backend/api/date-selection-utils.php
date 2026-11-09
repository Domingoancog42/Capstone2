<?php
declare(strict_types=1);

/*
 * A request names the exact days it covers rather than a start and an end, so June 1 and June 5 can
 * be filed without spending the days in between. Each day is taken either whole or as one half,
 * which is what the AM/PM choice means.
 *
 * Compensatory time off and travel orders keep no structured answers of their own, so their day
 * selection rides in the remarks column behind this marker. Mirrors frontend/src/utils/dateSelection.js.
 * Leave packs the same list inside its own richer metadata -- see leave_request.php.
 */
const DATE_SELECTION_META_PREFIX = '[HRIS_DATE_META]';

const DATE_SELECTION_PORTION_VALUES = [
    'whole' => 1.0,
    'am' => 0.5,
    'pm' => 0.5,
];

const DATE_SELECTION_PORTION_SHORT_LABELS = [
    'whole' => 'Whole',
    'am' => 'AM',
    'pm' => 'PM',
];

/* The selection travels inside a notes column, so it is capped to keep that text manageable. */
const DATE_SELECTION_MAX_DATES = 60;

/**
 * The day selection as the APIs will trust it: valid dates only, one entry per date, in date order.
 * Returns an empty list for a record filed without one, which callers read as a plain range.
 */
function normalize_selected_dates(mixed $value): array
{
    if (!is_array($value)) {
        return [];
    }

    $dates = [];
    foreach ($value as $entry) {
        $rawDate = trim((string)(is_array($entry) ? ($entry['date'] ?? '') : $entry));
        $date = DateTime::createFromFormat('Y-m-d', $rawDate);

        if (!$date || $date->format('Y-m-d') !== $rawDate) {
            continue;
        }

        $portion = strtolower(trim((string)(is_array($entry) ? ($entry['portion'] ?? '') : '')));
        $dates[$rawDate] = [
            'date' => $rawDate,
            'portion' => array_key_exists($portion, DATE_SELECTION_PORTION_VALUES) ? $portion : 'whole',
        ];
    }

    ksort($dates);

    return array_slice(array_values($dates), 0, DATE_SELECTION_MAX_DATES);
}

/**
 * Splits a notes column back into what the filer typed and the days they picked, so no message ever
 * shows the raw marker.
 */
function unpack_selected_dates(mixed $note): array
{
    $rawNote = (string)($note ?? '');
    $markerIndex = strrpos($rawNote, DATE_SELECTION_META_PREFIX);

    if ($markerIndex === false) {
        return ['note' => trim($rawNote), 'dates' => []];
    }

    $datesText = trim(substr($rawNote, $markerIndex + strlen(DATE_SELECTION_META_PREFIX)));
    $decoded = json_decode($datesText, true);

    /* Unreadable metadata is dropped rather than echoed back, so email never shows raw JSON. */
    return [
        'note' => trim(substr($rawNote, 0, $markerIndex)),
        'dates' => normalize_selected_dates($decoded),
    ];
}

/** The typed note alone, for the places that only need to display it. */
function selected_dates_note(mixed $note): string
{
    return unpack_selected_dates($note)['note'];
}

/** The dates as the printed forms ask for them, with half days marked: "Jun 01, 2026 (AM)". */
function selected_dates_summary(array $dates): string
{
    $parts = [];
    foreach ($dates as $day) {
        $label = (new DateTimeImmutable($day['date']))->format('M d, Y');
        $portion = $day['portion'] ?? 'whole';
        $parts[] = $portion === 'whole'
            ? $label
            : $label . ' (' . (DATE_SELECTION_PORTION_SHORT_LABELS[$portion] ?? strtoupper($portion)) . ')';
    }

    return implode(', ', $parts);
}

/** Days applied for, counting a morning or an afternoon as half a day. */
function selected_dates_total(array $dates): float
{
    $total = 0.0;
    foreach ($dates as $day) {
        $total += DATE_SELECTION_PORTION_VALUES[$day['portion'] ?? 'whole'] ?? 0.0;
    }

    return $total;
}

/** True when any normalized selected day is earlier than the minimum allowed filing date. */
function selected_dates_contain_before(array $dates, string $minimumDate): bool
{
    foreach (normalize_selected_dates($dates) as $day) {
        if (($day['date'] ?? '') < $minimumDate) {
            return true;
        }
    }

    return false;
}
