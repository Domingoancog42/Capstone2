/**
 * Shared formatting and tallying for the Award Cycles screens.
 *
 * Cycles live in `reward_cycles` / `reward_cycle_votes` and are read through `rewards.php`, so every
 * account sees the same ballot. Nothing here touches storage — `AwardCyclesWorkspace` owns the
 * fetching and hands normalised cycles down.
 */

export const AWARD_CATEGORIES = [
  "Best Employee of the Month",
  "Best Employee of the Year",
  "Outstanding Division",
  "Service Excellence",
  "Special Recognition",
];

export function formatDate(value) {
  if (!value) return "";

  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A nomination period is stored as a datetime; a certificate's period is stored as a bare date. Both
 * come through here, so the parse accepts either — MySQL's "YYYY-MM-DD HH:MM:SS" needs the space
 * turned into a "T" before Safari and Firefox will read it at all.
 */
export function parseMoment(value) {
  const text = String(value ?? "").trim().replace(" ", "T");
  if (!text) return null;

  const parsed = new Date(text.length <= 10 ? `${text}T00:00:00` : text);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The value a `datetime-local` input binds to: "YYYY-MM-DDTHH:MM", whichever form came in. */
export function toDateTimeInputValue(value) {
  const text = String(value ?? "").trim().replace(" ", "T");
  if (!text) return "";

  return text.length <= 10 ? `${text}T00:00` : text.slice(0, 16);
}

/** "Aug 9, 2026, 5:00 PM", or just the date when the value carries no time of its own. */
export function formatMoment(value) {
  const parsed = parseMoment(value);
  if (!parsed) return "";

  const dateText = parsed.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

  if (String(value ?? "").trim().length <= 10) {
    return dateText;
  }

  return `${dateText}, ${parsed.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * "in 3 hours", "in 25 minutes", "in 2 days" — how long is left before a deadline, said the way the
 * closing reminder needs to say it. Under a minute reads as "in under a minute" rather than "in 0
 * minutes", and anything already past returns "" so a caller can tell the deadline has gone.
 */
export function timeRemainingLabel(value, now = Date.now()) {
  const parsed = parseMoment(value);
  if (!parsed) return "";

  const minutes = Math.floor((parsed.getTime() - now) / 60000);

  if (minutes < 0) return "";
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** "Aug 2, 4:17 AM" — nominations are same-day reading, so the year is noise here. */
export function formatDateTime(value) {
  if (!value) return "";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Aug 1, 2026, 8:00 AM → Aug 7, 2026, 5:00 PM", and the open-ended forms when only one end is set. */
export function formatPeriod(cycle) {
  const opens = formatMoment(cycle?.opensOn);
  const closes = formatMoment(cycle?.closesOn);

  if (opens && closes) return `${opens} → ${closes}`;
  if (opens) return `Since ${opens}`;
  if (closes) return `Until ${closes}`;
  return "";
}

export function voteLabel(count) {
  return count === 1 ? "1 vote" : `${count} votes`;
}

/**
 * The tally, highest first.
 *
 * `Map` keeps insertion order, so a tie resolves to whoever was nominated first rather than to
 * whichever name the engine happened to hash last.
 */
export function tallyNominations(nominations = []) {
  const counts = new Map();

  nominations.forEach((nomination) => {
    const name = String(nomination?.nomineeName || "").trim();
    if (!name) return;

    const key = String(nomination?.nomineeKey || name);
    const existing = counts.get(key);

    if (existing) {
      existing.votes += 1;
    } else {
      counts.set(key, { key, name, votes: 1 });
    }
  });

  return [...counts.values()]
    .sort((a, b) => b.votes - a.votes)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * The nominees sharing the top vote count, but only when more than one does — an empty array means
 * there is a clear leader (or nobody has voted).
 *
 * A cycle closed on a tie has no Best Employee to name, so this is what blocks the close. `rewards.php`
 * repeats the check; this copy is only so the button can explain itself before the request is sent.
 */
export function leadingTie(nominations = []) {
  const tally = tallyNominations(nominations);

  if (tally.length < 2) {
    return [];
  }

  const tied = tally.filter((entry) => entry.votes === tally[0].votes);

  return tied.length > 1 ? tied : [];
}

/**
 * Directory rows disagree about what the column is called — `getEmployees()` returns `department`,
 * other callers pass `division` — so every screen reading a division goes through here.
 */
export function divisionOf(employee) {
  return String(employee?.department || employee?.division || "").trim();
}

/**
 * The directory as pickable nominees, in the shape `EmployeeSearchSelect` reads — the ballot is a
 * searchable checklist, so the division rides along as the line that tells two same-named people
 * apart. Rows come back with either a joined `fullName` or the parts, depending on caller.
 */
export function nomineeOptionsFrom(employees = []) {
  return (Array.isArray(employees) ? employees : [])
    .map((row) => ({
      employeeRecordId: String(row?.id ?? row?.employeeId ?? ""),
      employeeId: String(row?.employeeId ?? ""),
      employeeName: String(
        row?.fullName || [row?.firstName, row?.middleName, row?.lastName].filter(Boolean).join(" "),
      ).trim(),
      division: divisionOf(row),
    }))
    .filter((option) => option.employeeRecordId && option.employeeName)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/**
 * Nominations store the nominee's id and name only, so the podium resolves photos and job titles
 * from the live directory rather than from a stale copy taken at vote time. Keyed on every id the
 * directory rows carry, since callers disagree about which one they pass around.
 */
export function buildEmployeeLookup(employees = []) {
  const lookup = new Map();

  (Array.isArray(employees) ? employees : []).forEach((employee) => {
    [employee?.id, employee?.employeeId, employee?.employeeRecordId].forEach((candidate) => {
      const key = String(candidate ?? "").trim();

      if (key && !lookup.has(key)) {
        lookup.set(key, employee);
      }
    });
  });

  return lookup;
}

export function normalizeCycle(cycle) {
  return {
    id: String(cycle?.id ?? ""),
    category: String(cycle?.category || AWARD_CATEGORIES[0]),
    description: String(cycle?.description || "").trim(),
    // MySQL hands back "YYYY-MM-DD HH:MM:SS" and NULL as null; the datetime inputs want "" or
    // "YYYY-MM-DDTHH:MM", and the form posts back whatever it is given here.
    opensOn: toDateTimeInputValue(cycle?.opensOn),
    closesOn: toDateTimeInputValue(cycle?.closesOn),
    status: cycle?.status === "closed" ? "closed" : "ongoing",
    nominations: Array.isArray(cycle?.nominations) ? cycle.nominations.map(normalizeNomination) : [],
    createdByName: String(cycle?.createdByName || "").trim(),
    createdAt: cycle?.createdAt || null,
    isArchived: Boolean(cycle?.isArchived),
    hasCertificateTemplate: Boolean(cycle?.hasCertificateTemplate),
    certificateTemplatePreset: String(cycle?.certificateTemplatePreset || ""),
  };
}

export function normalizeNomination(nomination) {
  return {
    id: String(nomination?.id ?? ""),
    voterKey: String(nomination?.voterKey ?? ""),
    voterEmployeeKey: String(nomination?.voterEmployeeKey ?? ""),
    voterName: String(nomination?.voterName || "").trim(),
    nomineeKey: String(nomination?.nomineeKey ?? ""),
    nomineeName: String(nomination?.nomineeName || "").trim(),
    reason: String(nomination?.reason || "").trim(),
    createdAt: nomination?.createdAt || null,
  };
}
