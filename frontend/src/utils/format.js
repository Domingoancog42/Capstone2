/**
 * Shared number, currency, and date formatting.
 *
 * Before this module every workspace declared its own `currencyFormatter` / `numberFormatter`
 * pair. Import from here instead of re-declaring them.
 */

/** Peso amounts with centavos — the default across payroll, loans, and cash advance. */
export const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Peso amounts rounded to whole pesos — used by dashboards and report headline tiles. */
export const wholeCurrencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

/** Grouped integers ("1,234"). */
export const numberFormatter = new Intl.NumberFormat("en-US");

/** Coerces user input, API strings, and nullish values to a finite number. */
export function parseAmount(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrency(value) {
  return currencyFormatter.format(parseAmount(value));
}

export function formatWholeCurrency(value) {
  return wholeCurrencyFormatter.format(parseAmount(value));
}

export function formatNumber(value) {
  return numberFormatter.format(parseAmount(value));
}

/**
 * Parses the date shapes this API returns: ISO dates, "YYYY-MM-DD HH:MM:SS", and Date objects.
 * `dateOnly` anchors bare "YYYY-MM-DD" values to local midnight so they don't shift a day in
 * timezones behind UTC.
 */
export function parseDateValue(value, { dateOnly = false } = {}) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const normalized = isBareDate && dateOnly
    ? `${text}T00:00:00`
    : text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `fallback` is what to show for empty/unparseable input — screens differ here ("N/A",
 * "Not recorded", "Not available"), so it is always explicit at the call site.
 */
export function formatDate(value, { fallback = "N/A", dateOnly = true, locale = "en-US", ...options } = {}) {
  const date = parseDateValue(value, { dateOnly });

  if (!date) {
    return fallback;
  }

  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  });
}

export function formatDateTime(value, { fallback = "N/A", locale = "en-US", ...options } = {}) {
  const date = parseDateValue(value);

  if (!date) {
    return fallback;
  }

  return date.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  });
}

/** Countdown display for OTP timers ("04:31"). */
export function formatTimer(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
