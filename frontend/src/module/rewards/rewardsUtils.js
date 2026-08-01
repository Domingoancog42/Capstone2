import {
  DEFAULT_CATEGORY,
  LEGACY_STORAGE_KEY,
  REWARD_CATEGORIES,
  STATUS_KEYS,
  categoryDetail,
} from "./rewardsConstants";

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();

  return normalized || fallback;
}

export function currentMonthValue() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isoNow() {
  return new Date().toISOString();
}

export function formatDate(value) {
  const parsed = new Date(value || "");

  if (Number.isNaN(parsed.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

export function formatMonth(value) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(`${value}-01T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(parsed);
}

export function ordinalDay(value) {
  const parsed = new Date(value || "");

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const day = parsed.getDate();
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";

  return `${day}${suffix}`;
}

export function monthName(value) {
  const parsed = new Date(value || "");

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(parsed);
}

export function yearValue(value) {
  const parsed = new Date(value || "");

  return Number.isNaN(parsed.getTime()) ? "" : String(parsed.getFullYear());
}

export function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "RR";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* -------------------------------------------------------------------------- */
/* Employees                                                                   */
/* -------------------------------------------------------------------------- */

export function employeeFullName(employee = {}) {
  return text(
    employee.fullName ||
      employee.full_name ||
      [
        employee.firstName || employee.first_name,
        employee.middleName || employee.middle_name,
        employee.lastName || employee.last_name,
      ]
        .filter(Boolean)
        .join(" "),
    ""
  );
}

export function normalizeEmployee(employee = {}) {
  const id = employee.id ?? employee.employeeRecordId ?? employee.employee_id ?? employee.employeeId ?? "";
  const employeeCode = text(
    employee.employeeId || employee.employee_id || employee.employeeCode || employee.code,
    ""
  );
  const employeeName = employeeFullName(employee) || text(employee.name || employee.employeeName, "Unnamed Employee");

  return {
    id: String(id),
    employeeRecordId: String(id),
    employeeId: employeeCode,
    employeeCode,
    employeeName,
    name: employeeName,
    division: text(employee.department || employee.division || employee.divisionName, ""),
    position: text(employee.position || employee.designation || employee.designationName, ""),
    employmentType: text(employee.employmentStatus || employee.employment_status || employee.employmentType, ""),
    dateHired: employee.dateHired || employee.date_hired || "",
  };
}

export function yearsBetween(startDate) {
  const parsed = new Date(startDate || "");

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const today = new Date();
  let years = today.getFullYear() - parsed.getFullYear();
  const monthDelta = today.getMonth() - parsed.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < parsed.getDate())) {
    years -= 1;
  }

  return years > 0 ? String(years) : "";
}

/* -------------------------------------------------------------------------- */
/* Nominations                                                                 */
/* -------------------------------------------------------------------------- */

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeNomination(record = {}) {
  const category = REWARD_CATEGORIES[record.category] ? record.category : DEFAULT_CATEGORY;

  return {
    id: record.id || buildId("nom"),
    employeeRecordId: record.employeeRecordId ?? null,
    employeeId: String(record.employeeId || ""),
    employeeCode: record.employeeCode || "",
    employeeName: record.employeeName || "Unnamed Employee",
    division: record.division || "",
    position: record.position || "",
    employmentType: record.employmentType || "",
    category,
    nominatedBy: record.nominatedBy || "",
    nominatedByEmployeeRecordId: record.nominatedByEmployeeRecordId ?? null,
    period: record.period || currentMonthValue(),
    yearsOfService: record.yearsOfService || "",
    reason: record.reason || "",
    status: STATUS_KEYS.includes(record.status) ? record.status : "Pending",
    decisionNote: record.decisionNote || "",
    createdAt: record.createdAt || isoNow(),
    reviewedAt: record.reviewedAt || "",
    reviewedBy: record.reviewedBy || "",
    certificate: record.certificate || null,
  };
}

/** What the award is pegged to — a month for the monthly award, a milestone for loyalty. */
export function nominationMilestone(record = {}) {
  if (categoryDetail(record.category).usesYearsOfService) {
    return record.yearsOfService ? `${record.yearsOfService} Years of Service` : "Service milestone";
  }

  return formatMonth(record.period);
}

/** Sorts loyalty by years and the monthly award by period, from one column. */
export function milestoneSortValue(record = {}) {
  return categoryDetail(record.category).usesYearsOfService
    ? Number(record.yearsOfService) || 0
    : record.period || "";
}

export function matchesNominationQuery(record, needle) {
  if (!needle) {
    return true;
  }

  return [
    record.employeeName,
    record.employeeCode,
    record.division,
    record.position,
    record.nominatedBy,
    record.reason,
    record.certificate?.number,
    categoryDetail(record.category).label,
    record.status,
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

/* -------------------------------------------------------------------------- */
/* Legacy browser storage                                                      */
/* -------------------------------------------------------------------------- */

function isSeededSampleRecord(record = {}) {
  return String(record.id || "").startsWith("sample-") || String(record.employeeId || "").startsWith("sample-");
}

/**
 * Nominations left behind in this browser from before awards were stored on the server.
 *
 * Local storage was the only persistence this screen had, so anything recorded on a given machine
 * exists nowhere else. These are read solely to offer a one-time hand-over; nothing is written back
 * here any more.
 */
export function readLegacyBrowserRecords() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) || "null");

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeNomination).filter((record) => !isSeededSampleRecord(record));
  } catch {
    return [];
  }
}

/** Called only after a successful import, so the offer stops reappearing. */
export function clearLegacyBrowserRecords() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}
