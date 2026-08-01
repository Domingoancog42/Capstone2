const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const normalized = DATE_ONLY_PATTERN.test(text)
    ? `${text}T00:00:00`
    : text.replace(" ", "T");
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatSignatureTimestamp(value) {
  const text = String(value || "").trim();
  const date = toDate(text);
  if (!date) {
    return "";
  }

  const hasTime = !DATE_ONLY_PATTERN.test(text);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function buildSignatureTimestampLabel(action, value) {
  const formatted = formatSignatureTimestamp(value);
  return formatted ? `${action}: ${formatted}` : "";
}
