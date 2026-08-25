/**
 * Loyalty & retirement math shared by the Loyalty dashboard and its detail modal.
 *
 * Dates from the API arrive as "YYYY-MM-DD" strings. Parsing them with `new Date(string)` treats
 * them as UTC and can shift a day depending on the browser's timezone, so every parse here builds
 * the date from its parts instead — the same approach `AdminEmployeeCard` uses for date display.
 */
export function parseDateOnly(value) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  const [year, month, day] = text.split("-").map((part) => Number(part));
  const date = year && month && day ? new Date(year, month - 1, day) : new Date(text);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole years and remainder months between a past date and today. */
function yearsAndMonthsSince(date, today) {
  if (!date || date > today) {
    return null;
  }

  let years = today.getFullYear() - date.getFullYear();
  let months = today.getMonth() - date.getMonth();

  if (today.getDate() < date.getDate()) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years, months };
}

export function computeTenure(dateHired, today = new Date()) {
  return yearsAndMonthsSince(parseDateOnly(dateHired), today);
}

export function computeAge(dateOfBirth, today = new Date()) {
  const result = yearsAndMonthsSince(parseDateOnly(dateOfBirth), today);
  return result ? result.years : null;
}

export function formatTenure(tenure) {
  if (!tenure) {
    return "N/A";
  }

  const { years, months } = tenure;
  const yearsText = `${years} yr${years === 1 ? "" : "s"}`;

  return months > 0 ? `${yearsText} ${months}mo` : yearsText;
}

export function formatTenureLong(tenure) {
  if (!tenure) {
    return "N/A";
  }

  const { years, months } = tenure;
  const yearsText = `${years} year${years === 1 ? "" : "s"}`;
  const monthsText = `${months} month${months === 1 ? "" : "s"}`;

  return months > 0 ? `${yearsText}, ${monthsText}` : yearsText;
}

export function formatLongDate(value) {
  const date = parseDateOnly(value);

  if (!date) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

/**
 * Loyalty tiers by years of service. The top band closes at `Infinity` rather than an arbitrary cap,
 * since a 30-year employee is still a Legend.
 */
export const LOYALTY_TIERS = [
  {
    key: "risingStar",
    label: "Rising Star",
    minYears: 0,
    maxYears: 4,
    rangeLabel: "0-4 yrs",
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
    dotClass: "bg-sky-500",
    bannerClass: "from-sky-400 to-sky-500",
  },
  {
    key: "silver",
    label: "Silver",
    minYears: 5,
    maxYears: 9,
    rangeLabel: "5-9 yrs",
    badgeClass: "border-slate-300 bg-slate-100 text-slate-600",
    dotClass: "bg-slate-400",
    bannerClass: "from-slate-400 to-slate-500",
  },
  {
    key: "gold",
    label: "Gold",
    minYears: 10,
    maxYears: 14,
    rangeLabel: "10-14 yrs",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    dotClass: "bg-amber-500",
    bannerClass: "from-amber-400 to-amber-500",
  },
  {
    key: "platinum",
    label: "Platinum",
    minYears: 15,
    maxYears: 19,
    rangeLabel: "15-19 yrs",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
    dotClass: "bg-violet-500",
    bannerClass: "from-violet-400 to-violet-500",
  },
  {
    key: "legend",
    label: "Legend",
    minYears: 20,
    maxYears: Infinity,
    rangeLabel: "20+ yrs",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
    dotClass: "bg-rose-500",
    bannerClass: "from-rose-400 to-rose-500",
  },
];

export function resolveLoyaltyTier(years) {
  const safeYears = Number.isFinite(years) ? years : 0;

  return LOYALTY_TIERS.find((tier) => safeYears >= tier.minYears && safeYears <= tier.maxYears) || LOYALTY_TIERS[0];
}

/**
 * GSIS optional retirement age (RA 8291) — the earliest a government employee can retire. There is
 * no tenure requirement layered on top because the dashboard only knows date hired at this agency,
 * not total creditable government service.
 */
export const RETIREMENT_ELIGIBLE_AGE = 60;

export function isRetirementEligible(age) {
  return Number.isFinite(age) && age >= RETIREMENT_ELIGIBLE_AGE;
}

/** Years still to run before the optional retirement age, or 0 once it has been reached. */
export function yearsUntilRetirement(age) {
  if (!Number.isFinite(age)) {
    return null;
  }

  return Math.max(0, RETIREMENT_ELIGIBLE_AGE - age);
}

/**
 * The two ways an employee leaves. `key` is what the API expects as `separationType`; `status` is
 * what `employees.status` ends up holding, and must stay in step with EMPLOYEE_SEPARATION_TYPES in
 * backend/api/employee.php.
 */
export const SEPARATION_TYPES = {
  retirement: {
    key: "retirement",
    status: "Retired",
    label: "Retirement",
    verb: "retired",
    confirmLabel: "Confirm Retirement",
  },
  resignation: {
    key: "resignation",
    status: "Resigned",
    label: "Resignation",
    verb: "resigned",
    confirmLabel: "Confirm Resignation",
  },
};

export function normalizeEmployeeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

/** Whether a status means the employee has left, whichever way they went. */
export function isSeparatedStatus(value) {
  const status = normalizeEmployeeStatus(value);

  return status === "retired" || status === "resigned";
}

/**
 * What the Loyalty dashboard calls this employee's state.
 *
 * Someone still serving at 60 reads as "Eligible" rather than "Active": spotting them is the whole
 * point of this screen, and their stored status is still Active until HR acts on it. Once they have
 * actually retired or resigned, the stored status speaks for itself.
 */
export function resolveLoyaltyStatusLabel({ status, retirementEligible }) {
  const normalized = normalizeEmployeeStatus(status);

  if (retirementEligible && normalized === "active") {
    return "Eligible";
  }

  return String(status || "").trim() || "Unknown";
}

export function loyaltyStatusBadgeClass(label) {
  switch (normalizeEmployeeStatus(label)) {
    case "eligible":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "retired":
      return "border-slate-200 bg-slate-100 text-slate-600";
    case "resigned":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "inactive":
      return "border-orange-200 bg-orange-50 text-orange-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

/** Today as "YYYY-MM-DD" in local time — `toISOString()` would shift the day in +08:00. */
export function todayAsDateInput(today = new Date()) {
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${today.getFullYear()}-${month}-${day}`;
}

/** Rotates a small palette across cards by employee identity so a full page doesn't read as one flat color. */
const AVATAR_PALETTES = [
  { bar: "bg-purple-500", bg: "bg-purple-100", text: "text-purple-600" },
  { bar: "bg-blue-500", bg: "bg-blue-100", text: "text-blue-600" },
  { bar: "bg-orange-500", bg: "bg-orange-100", text: "text-orange-600" },
  { bar: "bg-indigo-500", bg: "bg-indigo-100", text: "text-indigo-600" },
  { bar: "bg-emerald-500", bg: "bg-emerald-100", text: "text-emerald-600" },
  { bar: "bg-rose-500", bg: "bg-rose-100", text: "text-rose-600" },
  { bar: "bg-red-500", bg: "bg-red-100", text: "text-red-600" },
  { bar: "bg-teal-500", bg: "bg-teal-100", text: "text-teal-600" },
];

export function resolveAvatarPalette(seed) {
  const text = String(seed || "");
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }

  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}
