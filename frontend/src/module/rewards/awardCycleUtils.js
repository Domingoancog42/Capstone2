/**
 * Shared formatting and tallying for the Award Cycles screens.
 *
 * Cycles live in `reward_cycles` / `reward_nominations` and are read through `rewards.php`, so every
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

/** "Aug 1, 2026 → Aug 7, 2026" when both ends are set, and the open-ended forms when only one is. */
export function formatPeriod(cycle) {
  const opens = formatDate(cycle?.opensOn);
  const closes = formatDate(cycle?.closesOn);

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

/** The directory rows come back with either a joined `fullName` or the parts, depending on caller. */
export function employeeOptionsFrom(employees = []) {
  return (Array.isArray(employees) ? employees : [])
    .map((row) => ({
      value: String(row?.id ?? row?.employeeId ?? ""),
      label: String(
        row?.fullName || [row?.firstName, row?.middleName, row?.lastName].filter(Boolean).join(" "),
      ).trim(),
    }))
    .filter((option) => option.value && option.label)
    .sort((a, b) => a.label.localeCompare(b.label));
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
    // MySQL hands back DATE columns as "YYYY-MM-DD" and NULL as null; the date inputs want "".
    opensOn: String(cycle?.opensOn || "").slice(0, 10),
    closesOn: String(cycle?.closesOn || "").slice(0, 10),
    status: cycle?.status === "closed" ? "closed" : "ongoing",
    nominations: Array.isArray(cycle?.nominations) ? cycle.nominations.map(normalizeNomination) : [],
    createdByName: String(cycle?.createdByName || "").trim(),
    createdAt: cycle?.createdAt || null,
    isArchived: Boolean(cycle?.isArchived),
  };
}

export function normalizeNomination(nomination) {
  return {
    id: String(nomination?.id ?? ""),
    voterKey: String(nomination?.voterKey ?? ""),
    voterName: String(nomination?.voterName || "").trim(),
    nomineeKey: String(nomination?.nomineeKey ?? ""),
    nomineeName: String(nomination?.nomineeName || "").trim(),
    reason: String(nomination?.reason || "").trim(),
    createdAt: nomination?.createdAt || null,
  };
}
