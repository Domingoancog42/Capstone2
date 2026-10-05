/**
 * Shared formatting and tallying for the Award Cycles screens.
 *
 * Cycles live in `reward_cycles` / `reward_cycle_votes` (the Chiefs' nominations) and
 * `reward_employee_votes` (the employees' ballots), and are read through `rewards.php`, so every
 * account sees the same award. Nothing here touches storage — `AwardCyclesWorkspace` and
 * `EmployeeVotingWorkspace` own the fetching and hand normalised cycles down.
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

/*
 * Where a cycle stands, as `rewards.php` works it out from the clock (rewards_cycle_phase()).
 * Nominations and voting share one period, and a nominee is on the ballot from the moment HR approves
 * them. `voting` is the period run out but reopened by the HR Head to settle a tie: voting only.
 */
export const CYCLE_PHASES = ["nomination", "voting", "closed"];

export const PHASE_LABELS = {
  nomination: "Nominations & voting open",
  voting: "Voting open",
  closed: "Closed",
};

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
 * The nominees of one cycle sharing the most votes, but only when more than one does — an empty array
 * means there is a clear leader (or nobody has a vote yet).
 *
 * A cycle closed on a tie has no Best Employee to name, so this is what blocks the close. `rewards.php`
 * repeats the check; this copy is only so the button can explain itself before the request is sent.
 */
export function leadingTie(cycle) {
  const voted = buildStandings(cycle ? [cycle] : []).filter((entry) => entry.votes > 0);

  if (voted.length < 2) {
    return [];
  }

  const tied = voted.filter((entry) => entry.votes === voted[0].votes);

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
 * Whether two division names refer to the same division. Names are compared, not ids, because
 * that is all the directory rows and the session user carry; the comparison ignores case and
 * surrounding whitespace so "Finance Division" on one record matches "finance division" on another.
 * Two blanks are not a match — a record with no division belongs to nobody's ballot.
 */
export function sameDivision(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();

  return a !== "" && a === b;
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
  const status = cycle?.status === "closed" ? "closed" : "ongoing";

  return {
    id: String(cycle?.id ?? ""),
    category: String(cycle?.category || AWARD_CATEGORIES[0]),
    description: String(cycle?.description || "").trim(),
    // MySQL hands back "YYYY-MM-DD HH:MM:SS" and NULL as null; the datetime inputs want "" or
    // "YYYY-MM-DDTHH:MM", and the form posts back whatever it is given here.
    opensOn: toDateTimeInputValue(cycle?.opensOn),
    // The end of the period, when nominations and voting both close.
    closesOn: toDateTimeInputValue(cycle?.closesOn),
    phase: CYCLE_PHASES.includes(cycle?.phase) ? cycle.phase : status === "closed" ? "closed" : "nomination",
    status,
    nominations: Array.isArray(cycle?.nominations) ? cycle.nominations.map(normalizeNomination) : [],
    // Nominee key → employee votes. Null while the server keeps the count from this viewer, which it
    // does for a voter until the cycle closes.
    voteCounts: cycle?.voteCounts && typeof cycle.voteCounts === "object" ? cycle.voteCounts : null,
    totalVotes: cycle?.totalVotes === null || cycle?.totalVotes === undefined ? null : Number(cycle.totalVotes) || 0,
    // The nominee the signed-in employee voted for in this cycle, or "".
    myVote: String(cycle?.myVote ?? ""),
    createdByName: String(cycle?.createdByName || "").trim(),
    createdAt: cycle?.createdAt || null,
    isArchived: Boolean(cycle?.isArchived),
    hasCertificateTemplate: Boolean(cycle?.hasCertificateTemplate),
    certificateTemplatePreset: String(cycle?.certificateTemplatePreset || ""),
    // The certificate a closed cycle issued to its winner, or null (still open, tied, or none approved).
    certificate: cycle?.certificate && typeof cycle.certificate === "object" ? cycle.certificate : null,
  };
}

export function normalizeNomination(nomination) {
  return {
    id: String(nomination?.id ?? ""),
    voterKey: String(nomination?.voterKey ?? ""),
    voterEmployeeKey: String(nomination?.voterEmployeeKey ?? ""),
    voterName: String(nomination?.voterName || "").trim(),
    voterDivision: String(nomination?.voterDivision || "").trim(),
    nomineeKey: String(nomination?.nomineeKey ?? ""),
    nomineeName: String(nomination?.nomineeName || "").trim(),
    nomineeDivision: String(nomination?.nomineeDivision || "").trim(),
    nomineePosition: String(nomination?.nomineePosition || "").trim(),
    nomineePhoto: String(nomination?.nomineePhoto || "").trim(),
    reason: String(nomination?.reason || "").trim(),
    status: NOMINATION_STATUSES.includes(nomination?.status) ? nomination.status : "submitted",
    reviewerNote: String(nomination?.reviewerNote || "").trim(),
    reviewedAt: nomination?.reviewedAt || null,
    reviewedByName: String(nomination?.reviewedByName || "").trim(),
    createdAt: nomination?.createdAt || null,
  };
}

/*
 * The review states a nomination moves through. A Chief submits it, the HR Head approves or rejects
 * it, and only approved nominees go on the employees' ballot.
 */
export const NOMINATION_STATUSES = ["submitted", "approved", "rejected"];

/** The same limits `rewards.php` enforces, so the form can say so before the request is sent. */
export const NOMINATION_REASON_MIN = 10;
export const NOMINATION_REASON_MAX = 1000;
export const REVIEWER_NOTE_MAX = 500;

/** Submitted / approved / rejected counts for one list of nominations. */
export function countNominations(nominations = []) {
  const counts = { total: 0, pending: 0, approved: 0, rejected: 0 };

  nominations.forEach((nomination) => {
    counts.total += 1;

    if (nomination?.status === "approved") counts.approved += 1;
    else if (nomination?.status === "rejected") counts.rejected += 1;
    else counts.pending += 1;
  });

  return counts;
}

/**
 * One entry per nominee across `cycles`, whatever their review status, ranked by the employees'
 * `votes`, then by approved nominations, then by how many times they were nominated at all, then by
 * who was nominated first. Only approved nominees collect votes, which is all `rewards.php` counts
 * (rewards_cycle_standings()); votes the server is keeping from this viewer (`voteCounts` null) count
 * as none. `buildStandings` is the approved-only view of this that the tally and the ballot show.
 *
 * Each entry keeps its own nominations newest first, so "last nominated" is simply the first one.
 */
export function buildNomineeTally(cycles = []) {
  const entries = new Map();

  (Array.isArray(cycles) ? cycles : []).forEach((cycle) => {
    // The nominees approved in this cycle: the only ones its votes can count for.
    const approvedHere = new Set();

    (cycle?.nominations || []).forEach((nomination) => {
      const name = String(nomination?.nomineeName || "").trim();
      if (!name) return;

      const key = String(nomination?.nomineeKey || name);
      const entry = entries.get(key) || {
        key,
        name,
        position: "",
        division: "",
        photo: "",
        votes: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        total: 0,
        firstNominatedAt: nomination?.createdAt || "",
        nominations: [],
      };

      entry.total += 1;
      if (nomination.status === "approved") {
        entry.approved += 1;
        approvedHere.add(key);
      } else if (nomination.status === "rejected") entry.rejected += 1;
      else entry.pending += 1;

      entry.position = entry.position || nomination.nomineePosition || "";
      entry.division = entry.division || nomination.nomineeDivision || "";
      entry.photo = entry.photo || nomination.nomineePhoto || "";
      entry.nominations.push(nomination);

      if (String(nomination?.createdAt || "") < String(entry.firstNominatedAt || "")) {
        entry.firstNominatedAt = nomination.createdAt;
      }

      entries.set(key, entry);
    });

    approvedHere.forEach((key) => {
      entries.get(key).votes += Number(cycle?.voteCounts?.[key] || 0);
    });
  });

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      nominations: [...entry.nominations].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))),
    }))
    .sort((a, b) =>
      b.votes - a.votes
      || b.approved - a.approved
      || b.total - a.total
      || String(a.firstNominatedAt).localeCompare(String(b.firstNominatedAt)))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * The Winners Tally: every approved nominee across `cycles`, most votes first, at zero votes if need
 * be. An approval is what puts somebody in the running, so it is also what puts them here — pending
 * and rejected nominees are not up for a vote and stay off it. Ranked afresh after the filter.
 */
export function buildStandings(cycles = []) {
  return buildNomineeTally(cycles)
    .filter((entry) => entry.approved > 0)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** An entry's slice of the votes on show, as a whole percentage; 0 while nobody has voted. */
export function voteShare(votes, totalVotes) {
  return totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
}

/** "October 2026" — the month a cycle opens in, which is the month its award is for. */
export function formatCycleMonth(value) {
  const parsed = parseMoment(value);

  return parsed ? parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
}
