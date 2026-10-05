/*
 * A KPI may carry more than one success indicator. They are kept in the one `success_indicator`
 * text column the IPCR and OPCR tables already have, one indicator per line, so the API, the
 * database and every older record are untouched: a single-indicator record is simply one line.
 */

/** The indicators a stored value holds, blank lines dropped. */
export function splitSuccessIndicators(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The stored form of a list of indicators. */
export function joinSuccessIndicators(lines) {
  return (lines || []).map((line) => String(line ?? "").trim()).filter(Boolean).join("\n");
}

/** A form value tidied for saving: trimmed, blank rows removed. */
export function normalizeSuccessIndicators(value) {
  return joinSuccessIndicators(String(value ?? "").split(/\r?\n/));
}
