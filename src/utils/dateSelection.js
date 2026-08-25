import { formatDateDisplay } from "./leaveHelpers";

/*
 * A request names the exact days it covers rather than a start and an end, so June 1 and June 5 can
 * be filed without spending the working days in between. Each day is taken either whole or as one
 * half, which is what the AM/PM choice means. Shared by leave, compensatory time off and travel
 * orders; the PHP mirror of the same rules lives beside each module's API.
 */
export const DATE_PORTIONS = ["whole", "am", "pm"];

export const DATE_PORTION_LABELS = {
  whole: "Whole Day",
  am: "Morning (AM)",
  pm: "Afternoon (PM)",
};

export const DATE_PORTION_SHORT_LABELS = {
  whole: "Whole",
  am: "AM",
  pm: "PM",
};

const DATE_PORTION_VALUES = {
  whole: 1,
  am: 0.5,
  pm: 0.5,
};

/* The selection travels inside a notes column, so it is capped to keep that text manageable. */
const MAX_SELECTED_DATES = 60;

/*
 * Compensatory time off and travel orders keep no structured answers of their own, so their day
 * selection rides in the remarks column behind this marker. Leave packs the same list inside its
 * own richer metadata block -- see packLeaveReason() in leaveRequestDetails.js.
 */
const DATE_SELECTION_META_PREFIX = "[HRIS_DATE_META]";

function normalizePortion(value) {
  const portion = String(value || "").trim().toLowerCase();
  return DATE_PORTIONS.includes(portion) ? portion : "whole";
}

/**
 * The stored form of a day selection: one entry per calendar date, deduplicated and in date order,
 * so the same list reads the same way whichever screen renders it.
 */
export function sanitizeSelectedDates(value) {
  const entries = Array.isArray(value) ? value : [];
  const byDate = new Map();

  entries.forEach((entry) => {
    const date = String((typeof entry === "string" ? entry : entry?.date) || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }

    byDate.set(date, {
      date,
      portion: normalizePortion(typeof entry === "string" ? "whole" : entry?.portion),
    });
  });

  return [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, MAX_SELECTED_DATES);
}

/** Days applied for, counting a morning or an afternoon as half a day. */
export function getSelectedDatesTotal(dates) {
  return sanitizeSelectedDates(dates).reduce(
    (total, day) => total + (DATE_PORTION_VALUES[day.portion] || 0),
    0
  );
}

/** The dates as the printed forms ask for them, with half days marked: "Jun 01, 2026 (AM)". */
export function formatSelectedDatesSummary(dates) {
  return sanitizeSelectedDates(dates)
    .map((day) => (
      day.portion === "whole"
        ? formatDateDisplay(day.date)
        : `${formatDateDisplay(day.date)} (${DATE_PORTION_SHORT_LABELS[day.portion]})`
    ))
    .join(", ");
}

/** The span a selection covers, for the start and end columns the records still keep. */
export function getSelectedDatesRange(dates) {
  const selected = sanitizeSelectedDates(dates);

  return {
    startDate: selected[0]?.date || "",
    endDate: selected[selected.length - 1]?.date || "",
  };
}

/** Appends the day selection to a notes column. Returns the note untouched when nothing is picked. */
export function packSelectedDates(note, dates) {
  const visibleNote = String(note || "").trim();
  const selected = sanitizeSelectedDates(dates);

  if (selected.length === 0) {
    return visibleNote;
  }

  const separator = visibleNote ? "\n\n" : "";
  return `${visibleNote}${separator}${DATE_SELECTION_META_PREFIX}${JSON.stringify(selected)}`;
}

/**
 * Splits a notes column back into what the filer typed and the days they picked. Every screen that
 * shows remarks goes through here, so the marker is never displayed.
 */
export function unpackSelectedDates(note) {
  const rawNote = String(note || "");
  const markerIndex = rawNote.lastIndexOf(DATE_SELECTION_META_PREFIX);

  if (markerIndex === -1) {
    return { note: rawNote.trim(), dates: [] };
  }

  const visibleNote = rawNote.slice(0, markerIndex).trim();
  const datesText = rawNote.slice(markerIndex + DATE_SELECTION_META_PREFIX.length).trim();

  try {
    return { note: visibleNote, dates: sanitizeSelectedDates(JSON.parse(datesText)) };
  } catch {
    /* Unreadable metadata is dropped rather than echoed back, so no screen shows the raw marker. */
    return { note: visibleNote, dates: [] };
  }
}

/** The typed note alone, for the many places that only need to display or search it. */
export function getNoteDisplay(note) {
  return unpackSelectedDates(note).note;
}
