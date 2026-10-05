import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import ProfileFloatingCard from "../../components/profile/ProfileFloatingCard";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import { SettingsSelect } from "../../components/settings";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  archiveAwardCycle,
  createAwardCycle,
  fetchAwardCycles,
  fetchCertificateTemplate,
  getEmployees,
  restoreAwardCycle,
  reviewAwardNomination,
  setAwardCycleStatus,
  submitAwardNomination,
  updateAwardCycle,
} from "../../services/api";
import AwardCertificateModal, { certificateFileName, exportCertificatePdf } from "./AwardCertificate";
import { createCertificateTemplate, normalizeCertificateTemplate } from "./certificateTemplate";
import MyRewardsWorkspace from "./MyRewardsWorkspace";
import useDeadlineRefresh from "./useDeadlineRefresh";
import {
  CardSkeleton,
  CycleCard,
  CycleStatusBadge,
  NominationCard,
  PersonAvatar,
  PortalButton,
  PortalEmptyState,
  PortalTabs,
  StatCard,
  WinnersTally,
} from "./NominationPortalUI";
import {
  AWARD_CATEGORIES,
  CYCLE_PHASES,
  NOMINATION_REASON_MAX,
  NOMINATION_REASON_MIN,
  PHASE_LABELS,
  REVIEWER_NOTE_MAX,
  buildEmployeeLookup,
  buildStandings,
  countNominations,
  formatCycleMonth,
  formatDate,
  formatMoment,
  formatPeriod,
  leadingTie,
  nomineeOptionsFrom,
  normalizeCycle,
  parseMoment,
  sameDivision,
  timeRemainingLabel,
  voteLabel,
} from "./awardCycleUtils";

/**
 * Award Cycles — the Nomination screen under Rewards & Recognition.
 *
 * A cycle is one monthly round of an award. The HR Head opens it, the division Chiefs nominate
 * colleagues from their own division into it with a reason, and the HR Head approves or rejects each
 * nomination. An approval puts the nominee straight into the Winners Tally and onto the employees'
 * ballot (their Award Voting page, `EmployeeVotingWorkspace`); the employees vote until the nomination
 * period ends — nominations and voting share it — the tally ranks the nominees by those votes, and
 * closing the cycle issues the certificate to whoever leads it.
 *
 * Everything lives behind `rewards.php`, so the cycle the HR Head opens is the same cycle every Chief
 * nominates into and every employee votes in. Each mutation refetches rather than patching local
 * state — the server's copy is the only one worth trusting.
 *
 * Three ways in, all decided by the server: the HR Head runs cycles and reviews (`canManage`), the
 * division Chiefs nominate (`canVote`), and anyone else who reaches the screen follows along. Hiding
 * the buttons is a courtesy — `rewards.php` enforces the same split.
 */

const defaultForm = {
  category: AWARD_CATEGORIES[0],
  description: "",
  opensOn: "",
  closesOn: "",
};

/**
 * The award announcements are SweetAlert `html` so a deadline can sit on its own line in bold, and
 * the category they name is free text the server accepts as typed — so it is escaped on the way in.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Matches `InputField`'s control so the merged period field sits level with the rest of the form. */
const dateFieldClass =
  "min-h-[46px] flex-1 rounded-lg border bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15";

/** The portal's own form controls, in the reference's quieter style. */
const textareaClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100";

/**
 * The nomination period is one field with two ends, so it carries one error rather than two — a
 * cycle with only an opening time has no point at which the tally is final. Voting shares the
 * period, so its closing time is when the vote ends too. `rewards.php` holds all of these as well.
 *
 * Both ends are "YYYY-MM-DDTHH:MM", which sorts correctly as text, so the comparison needs no
 * parsing. Equal ends are rejected too: a period that opens and closes on the same minute is one
 * nobody could nominate in.
 */
function validate(form, { cycles = [], editingId = null } = {}) {
  const errors = {};

  if (!String(form.category || "").trim()) {
    errors.category = "Enter or select an award type.";
  }

  if (!form.opensOn || !form.closesOn) {
    errors.period = "Set when nominations open and close before saving.";
  } else if (form.closesOn <= form.opensOn) {
    errors.period = "Nominations must close after they open.";
  } else {
    /*
     * An award is given once a month, so the same award cannot open twice in one calendar month.
     * The server enforces this too; checking here puts the message on the field instead of a toast.
     * Archived cycles are not in `cycles`, so a withdrawn one leaves its month free.
     */
    const month = form.opensOn.slice(0, 7);
    const category = String(form.category || "").trim().toLowerCase();
    const clash = cycles.find((cycle) =>
      cycle.id !== editingId
      && String(cycle.category || "").trim().toLowerCase() === category
      && String(cycle.opensOn || "").slice(0, 7) === month);

    if (clash) {
      errors.period = `A ${form.category} nomination for ${formatMonth(form.opensOn)} already exists. Only one can be opened per month.`;
    }
  }

  return errors;
}

function formatMonth(value) {
  const date = new Date(`${String(value).slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? "that month" : date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function nominationLabel(count) {
  return count === 1 ? "1 nomination" : `${count} nominations`;
}

const CYCLE_PHASE_OPTIONS = CYCLE_PHASES.map((phase) => ({ value: phase, label: PHASE_LABELS[phase] }));
const CYCLES_PER_PAGE = 10;

/**
 * The standings of one cycle — rank, name, and the employees' votes. Every approved nominee is
 * listed, since that is the ballot; an unreviewed or rejected one never places. `voterCount` turns
 * the vote total into turnout.
 */
function CycleStandings({ cycle, voterCount = 0 }) {
  const standings = useMemo(() => buildStandings(cycle ? [cycle] : []), [cycle]);

  if (standings.length === 0) {
    return (
      <p className="m-0 text-center text-sm text-slate-500">
        No nominee has been approved for the ballot yet.
      </p>
    );
  }

  return (
    <>
      <ol className="m-0 list-none divide-y divide-slate-100 p-0">
        {standings.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="w-4 shrink-0 text-right font-semibold text-slate-400">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{entry.name}</span>
            <span className="shrink-0 text-slate-500">{voteLabel(entry.votes)}</span>
          </li>
        ))}
      </ol>
      {voterCount > 0 ? (
        <p className="m-0 mt-2 text-xs text-slate-500">
          {cycle.totalVotes ?? 0} of {voterCount} employees have voted.
        </p>
      ) : null}
    </>
  );
}

/**
 * Admin already holds a directory in its own state and passes it down. The role workspaces do not,
 * so the screen fetches one rather than silently offering an empty list of people to nominate.
 */
function useNomineeDirectory(provided) {
  const supplied = Array.isArray(provided) && provided.length > 0;
  const [loaded, setLoaded] = useState([]);

  useEffect(() => {
    if (supplied) {
      return undefined;
    }

    let active = true;

    const loadEmployees = async () => {
      try {
        const result = await getEmployees();

        if (active) {
          setLoaded(Array.isArray(result?.employees) ? result.employees : []);
        }
      } catch {
        if (active) {
          setLoaded([]);
        }
      }
    };

    void loadEmployees();

    return () => {
      active = false;
    };
  }, [supplied]);

  return supplied ? provided : loaded;
}

/*
 * How close to the deadline the alert fires, tightest first. Two rungs rather than one: a day's
 * notice is what lets somebody plan to nominate, and the final hour is what catches whoever meant to
 * and has not. `find` walks these in order, so the alert always names the tightest window that applies.
 */
const CLOSING_ALERT_THRESHOLDS_MINUTES = [60, 24 * 60];

/**
 * One alert per cycle per rung, remembered for the tab.
 *
 * `sessionStorage` rather than component state: the list refetches on every nomination filed
 * anywhere in the office, and state would let a refetch re-fire an alert the reader already
 * dismissed. Wrapped because a browser with storage blocked throws on access — there the alert
 * simply repeats, which is a better failure than the screen not rendering.
 */
function claimClosingAlert(cycleId, threshold) {
  const key = `hris.award-closing-alert.${cycleId}.${threshold}`;

  try {
    if (window.sessionStorage.getItem(key)) {
      return false;
    }

    window.sessionStorage.setItem(key, "1");
  } catch {
    // Storage unavailable — fall through and show it.
  }

  return true;
}

/**
 * The "nominations close soon" interruption for somebody already on the screen.
 *
 * The bell notice `rewards.php` sends is the durable half of this and reaches everyone once; this is
 * the half that gets noticed while the deadline is actually passing. Only the most urgent cycle is
 * alerted per tick — two `Swal.fire` calls in one pass would leave only the last one on screen.
 */
function useClosingSoonAlert(cycles, enabled) {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const check = () => {
      const now = Date.now();

      const due = cycles
        .filter((cycle) => cycle.status !== "closed" && !cycle.isArchived)
        .map((cycle) => {
          const closesAt = parseMoment(cycle.closesOn);
          const minutesLeft = closesAt ? (closesAt.getTime() - now) / 60000 : Number.POSITIVE_INFINITY;

          return { cycle, minutesLeft };
        })
        .filter(({ minutesLeft }) => minutesLeft > 0 && minutesLeft <= CLOSING_ALERT_THRESHOLDS_MINUTES.at(-1))
        .sort((left, right) => left.minutesLeft - right.minutesLeft);

      for (const { cycle, minutesLeft } of due) {
        const threshold = CLOSING_ALERT_THRESHOLDS_MINUTES.find((limit) => minutesLeft <= limit);

        if (!claimClosingAlert(cycle.id, threshold)) {
          continue;
        }

        void Swal.fire({
          title: "Nominations close soon",
          html: `Nominations for <strong>${escapeHtml(cycle.category)}</strong> close `
            + `<strong>${escapeHtml(timeRemainingLabel(cycle.closesOn, now))}</strong>`
            + ` — ${escapeHtml(formatMoment(cycle.closesOn))}.<br /><br />`
            + "Submit or review nominations before then.",
          icon: "warning",
          confirmButtonText: "Go to nominations",
          confirmButtonColor: "#D61E1E",
        });

        return;
      }
    };

    check();
    const timer = window.setInterval(check, 60_000);

    return () => window.clearInterval(timer);
  }, [cycles, enabled]);
}

/** Newest first, by whichever moment the list is about. */
function byNewest(field) {
  return (left, right) => String(right.nomination[field] ?? "").localeCompare(String(left.nomination[field] ?? ""));
}

function cycleLabelOf(cycle) {
  const month = formatCycleMonth(cycle.opensOn);
  return month ? `${cycle.category} · ${month}` : cycle.category;
}

/**
 * `nomineeDivision` narrows the nominee list to one division's members (a Chief's own); `null`
 * offers the whole directory. It only shapes who can be picked, never who is shown.
 */
export default function AwardCyclesWorkspace({
  employees,
  canManage: canManageProp = true,
  nomineeDivision = null,
}) {
  const directory = useNomineeDirectory(employees);
  const employeeLookup = useMemo(() => buildEmployeeLookup(directory), [directory]);
  const [cycles, setCycles] = useState([]);
  const [viewerKey, setViewerKey] = useState("");
  const [viewerEmployeeRecordId, setViewerEmployeeRecordId] = useState("");
  /*
   * Who may run a cycle and who may nominate are the server's answers (HR Head and the Chiefs), so
   * the screen asks rather than assumes from the route it was mounted on. Both start false: no
   * button shows until the list confirms it belongs there.
   */
  const [serverCanManage, setServerCanManage] = useState(false);
  const [canVote, setCanVote] = useState(false);
  // How many employees the ballot is open to — the denominator of the turnout line.
  const [voterCount, setVoterCount] = useState(0);
  const canManage = canManageProp && serverCanManage;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [formErrors, setFormErrors] = useState({});
  const [customAwardOpen, setCustomAwardOpen] = useState(false);
  /*
   * Each floating card keeps two pieces of state rather than one: closing only flips the `...Open`
   * flag, so the card still has its content to render while it animates out instead of blanking the
   * moment it is dismissed.
   */
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionCycle, setDescriptionCycle] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsCycleId, setDetailsCycleId] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [nominateOpen, setNominateOpen] = useState(false);
  const [nominateCycleId, setNominateCycleId] = useState(null);
  const [nominee, setNominee] = useState(null);
  const [nominationReason, setNominationReason] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  /*
   * The archive is a second view over the same endpoint rather than a filter over one list: the
   * server never sends archived cycles to the working list, so there is nothing local to filter.
   */
  const [archiveView, setArchiveView] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  /*
   * "My Rewards" is a third view over the same screen: the awards the signed-in user has won. It is
   * the same page the Employee sidebar opens, and it fetches its list only once the view is opened.
   */
  const [awardsView, setAwardsView] = useState(false);
  /* The certificate the tally's podium opens — the issued one, or a preview before it is issued. */
  const [certificateTemplate, setCertificateTemplate] = useState(() => createCertificateTemplate());
  const templateRequested = useRef(false);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [certificateRecord, setCertificateRecord] = useState(null);
  const [downloadingId, setDownloadingId] = useState("");

  const loadCycles = useCallback(async () => {
    try {
      const result = await fetchAwardCycles({ archived: archiveView });

      setCycles(Array.isArray(result?.cycles) ? result.cycles.map(normalizeCycle) : []);
      setViewerKey(String(result?.viewerKey ?? ""));
      setViewerEmployeeRecordId(String(result?.viewerEmployeeRecordId ?? ""));
      setServerCanManage(Boolean(result?.canManage));
      setCanVote(Boolean(result?.canVote));
      setVoterCount(Number(result?.voterCount ?? 0));
      setArchivedCount(Number(result?.archivedCount ?? 0));
      setError("");
    } catch (requestError) {
      setCycles([]);
      setError(requestError.response?.data?.message || "Unable to load nominations.");
    } finally {
      setLoading(false);
    }
  }, [archiveView]);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  // The archive holds retired cycles, so nothing there has a deadline worth warning about. Only the
  // people who act on a cycle — the Chiefs nominating and the HR Head reviewing — are interrupted.
  useClosingSoonAlert(cycles, !archiveView && (canVote || canManage));
  useDeadlineRefresh(cycles, loadCycles);

  /*
   * Nominations filed and reviewed elsewhere move the tally, so the list follows the rewards topic.
   * My Rewards subscribes to the same topic on its own. `refreshOnMount` is off because the effect
   * above already made the first call. Between this and the deadline timer the screen keeps itself
   * current, which is why it has no Refresh button.
   */
  useAutoRefreshOnChange(loadCycles, { topic: "rewards", refreshOnMount: false });

  // The server already orders newest first; this keeps that true after a refetch.
  const orderedCycles = useMemo(
    () => [...cycles].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [cycles],
  );

  /* ---------------------------------------------------------------------------------------- */
  /* Who is looking, and what they see                                                         */
  /* ---------------------------------------------------------------------------------------- */

  const portalRole = canManage ? "hr" : canVote ? "chief" : "observer";

  const allNominations = useMemo(
    () => orderedCycles.flatMap((cycle) => cycle.nominations.map((nomination) => ({ nomination, cycle }))),
    [orderedCycles],
  );
  const pendingItems = useMemo(
    () => allNominations.filter(({ nomination }) => nomination.status === "submitted").sort(byNewest("createdAt")),
    [allNominations],
  );
  const recognizedItems = useMemo(
    () => allNominations.filter(({ nomination }) => nomination.status === "approved").sort(byNewest("reviewedAt")),
    [allNominations],
  );
  const myItems = useMemo(
    () => (viewerKey
      ? allNominations.filter(({ nomination }) => nomination.voterKey === viewerKey).sort(byNewest("createdAt"))
      : []),
    [allNominations, viewerKey],
  );
  const openCycles = useMemo(() => orderedCycles.filter((cycle) => cycle.status !== "closed"), [orderedCycles]);

  const tabs = useMemo(() => {
    if (portalRole === "hr") {
      return [
        { value: "cycles", label: "Cycles" },
        { value: "pending", label: "Pending", badge: pendingItems.length || null },
        { value: "recognized", label: "Recognized" },
        { value: "tally", label: "Tally" },
      ];
    }

    if (portalRole === "chief") {
      return [
        { value: "open", label: "Open Cycles" },
        { value: "mine", label: "My Nominations" },
        { value: "tally", label: "Tally" },
      ];
    }

    return [
      { value: "cycles", label: "Cycles" },
      { value: "recognized", label: "Recognized" },
      { value: "tally", label: "Tally" },
    ];
  }, [pendingItems.length, portalRole]);
  const currentTab = tabs.some((tab) => tab.value === activeTab) ? activeTab : tabs[0].value;

  const stats = useMemo(() => {
    const openCount = openCycles.length;

    if (portalRole === "chief") {
      const mine = countNominations(myItems.map(({ nomination }) => nomination));

      return [
        { label: "Open cycles", value: openCount },
        { label: "My nominations", value: mine.total },
        { label: "Pending review", value: mine.pending },
        { label: "Approved", value: mine.approved },
      ];
    }

    return [
      { label: "Open cycles", value: openCount, hint: `${cycles.length} total` },
      { label: "Pending review", value: pendingItems.length },
      { label: "Approved", value: recognizedItems.length },
      { label: "Total nominations", value: allNominations.length },
    ];
  }, [allNominations.length, cycles.length, myItems, openCycles.length, pendingItems.length, portalRole, recognizedItems.length]);

  const banner = {
    hr: {
      heading: "Rewards & Recognition Overview",
      intro: "Create monthly cycles and review the Division Chiefs' nominations. Every nominee you approve goes straight into the Winners Tally for the employees to vote on.",
    },
    chief: {
      heading: "Division Nomination Workspace",
      intro: nomineeDivision
        ? `Recognize excellence within the ${nomineeDivision}.`
        : nomineeDivision === ""
          ? "You are not currently assigned to a division."
          : "Recognize excellence within your division.",
    },
    observer: {
      heading: "Rewards & Recognition",
      intro: "Follow each award cycle, the recognized employees, and the winners tally.",
    },
  }[portalRole];

  /* ---------------------------------------------------------------------------------------- */
  /* Cycles list: search, status, pages                                                        */
  /* ---------------------------------------------------------------------------------------- */

  /*
   * Keep the standard choices, then add custom award names already used in the current list. That
   * makes a typed award reusable on the next nomination without turning this back into a fixed list.
   */
  const awardCategoryOptions = useMemo(() => {
    const seen = new Set();

    return [...AWARD_CATEGORIES, ...cycles.map((cycle) => cycle.category)]
      .map((category) => String(category || "").trim())
      .filter((category) => {
        const key = category.toLowerCase();

        if (!key || seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }, [cycles]);

  const filteredCycles = useMemo(() => {
    const search = query.trim().toLowerCase();

    return orderedCycles.filter((cycle) => {
      const matchesSearch = !search || [cycle.category, cycle.description, cycle.createdByName, formatCycleMonth(cycle.opensOn)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesStatus = !statusFilter || cycle.phase === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [orderedCycles, query, statusFilter]);
  const hasActiveFilters = Boolean(query.trim()) || Boolean(statusFilter);
  const totalPages = Math.max(1, Math.ceil(filteredCycles.length / CYCLES_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCycles = useMemo(() => {
    const startIndex = (safePage - 1) * CYCLES_PER_PAGE;
    return filteredCycles.slice(startIndex, startIndex + CYCLES_PER_PAGE);
  }, [filteredCycles, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter]);

  /* ---------------------------------------------------------------------------------------- */
  /* Mutations                                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  /** Every mutation ends the same way: tell the user, then take the server's word for the new state. */
  const runMutation = async (action, fallbackMessage) => {
    setSaving(true);

    try {
      const result = await action();
      await loadCycles();
      toast.success(result?.message || fallbackMessage);
      return true;
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || fallbackMessage);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setFormErrors({});
    setCustomAwardOpen(false);
    setModalOpen(true);
  };

  const openEdit = (cycle) => {
    setEditingId(cycle.id);
    setForm({
      category: cycle.category,
      description: cycle.description,
      opensOn: cycle.opensOn,
      closesOn: cycle.closesOn,
    });
    setFormErrors({});
    setCustomAwardOpen(false);
    setModalOpen(true);
  };

  const updateField = (field) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const selectAward = (event) => {
    setCustomAwardOpen(false);
    updateField("category")(event);
  };

  const openCustomAward = () => {
    if (customAwardOpen) {
      return;
    }

    setCustomAwardOpen(true);
    setForm((current) => ({ ...current, category: "" }));
    setFormErrors((current) => (current.category ? { ...current, category: undefined } : current));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const submission = { ...form, category: String(form.category || "").trim() };
    const errors = validate(submission, { cycles, editingId });
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    const creating = !editingId;

    const saved = await runMutation(
      () => (editingId ? updateAwardCycle({ cycleId: editingId, ...submission }) : createAwardCycle(submission)),
      editingId ? "Unable to update the nomination." : "Unable to create the nomination.",
    );

    if (!saved) {
      return;
    }

    setModalOpen(false);

    if (creating) {
      // The server has already put this in everyone else's bell; this is the confirmation for the
      // manager who opened the cycle, who would otherwise only see a toast.
      await Swal.fire({
        title: "Nominations are open",
        html: `Nominations for <strong>${escapeHtml(submission.category)}</strong> are now open.<br />`
          + `Nominations and voting close ${escapeHtml(formatMoment(submission.closesOn))}.<br />`
          + "Each nominee you approve goes into the Winners Tally, and the employees can vote for them right away.<br /><br />"
          + "The division Chiefs have been notified, and the employees will be when you approve the first nominee.",
        icon: "success",
        confirmButtonText: "Got it",
        confirmButtonColor: "#D61E1E",
      });
    }
  };

  const handleToggleStatus = (cycle) => {
    const status = cycle.status === "closed" ? "ongoing" : "closed";

    void runMutation(
      () => setAwardCycleStatus({ cycleId: cycle.id, status }),
      "Unable to change the cycle status.",
    );
  };

  /**
   * Archiving replaces deleting here. The nominations are the record of who the office recognized,
   * so a cycle is retired from the list rather than erased — everything stays recoverable.
   */
  const handleArchive = async (cycle) => {
    const confirmation = await Swal.fire({
      title: "Archive this nomination?",
      text: `“${cycle.category}” will move to the archive. Its ${nominationLabel(cycle.nominations.length)} will remain on record, and the nomination can be restored later.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Archive",
      confirmButtonColor: "#D61E1E",
      cancelButtonText: "Cancel",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const archived = await runMutation(() => archiveAwardCycle(cycle.id), "Unable to archive the nomination.");

    if (archived && detailsCycleId === cycle.id) {
      setDetailsOpen(false);
    }
  };

  const handleRestore = (cycle) => {
    void runMutation(() => restoreAwardCycle(cycle.id), "Unable to restore the nomination.");
  };

  /** Switching views resets everything scoped to the old list rather than carrying it across. */
  const toggleArchiveView = () => {
    setArchiveView((current) => !current);
    setAwardsView(false);
    setDetailsOpen(false);
    setQuery("");
    setStatusFilter("");
    setCurrentPage(1);
    setLoading(true);
  };

  const toggleAwardsView = () => {
    setAwardsView((current) => !current);
    setArchiveView(false);
    setDetailsOpen(false);
  };

  /* Cycle details — the floating card listing a cycle's nominations. */
  const detailsCycle = useMemo(
    () => cycles.find((cycle) => cycle.id === detailsCycleId) || null,
    [cycles, detailsCycleId],
  );

  const openDetails = (cycle) => {
    setDetailsCycleId(cycle.id);
    setDetailsOpen(true);
  };

  /* Review — approve or reject one nomination, with an optional note back to the Chief. */
  const openReview = (nomination, action) => {
    setReviewTarget({ nomination, action });
    setReviewNote("");
    setReviewOpen(true);
  };

  const submitReview = async (event) => {
    event.preventDefault();

    if (!reviewTarget) {
      return;
    }

    const reviewed = await runMutation(
      () => reviewAwardNomination({
        nominationId: reviewTarget.nomination.id,
        status: reviewTarget.action,
        reviewerNote: reviewNote.trim(),
      }),
      "Unable to review the nomination.",
    );

    if (reviewed) {
      setReviewOpen(false);
    }
  };

  /* Nominate — a Chief puts one colleague from their division forward. */
  const nominateCycle = useMemo(
    () => cycles.find((cycle) => cycle.id === nominateCycleId) || null,
    [cycles, nominateCycleId],
  );
  const scopedToDivision = nomineeDivision !== null && nomineeDivision !== undefined;
  const divisionNominees = useMemo(() => {
    const options = nomineeOptionsFrom(directory).filter(
      (option) => !viewerEmployeeRecordId || String(option.employeeRecordId) !== viewerEmployeeRecordId,
    );

    return scopedToDivision ? options.filter((option) => sameDivision(option.division, nomineeDivision)) : options;
  }, [directory, nomineeDivision, scopedToDivision, viewerEmployeeRecordId]);
  const alreadyNominated = useMemo(
    () => new Set(
      (nominateCycle?.nominations || [])
        .filter((nomination) => viewerKey && nomination.voterKey === viewerKey)
        .map((nomination) => nomination.nomineeKey),
    ),
    [nominateCycle, viewerKey],
  );
  const eligibleNominees = useMemo(
    () => divisionNominees.filter((option) => !alreadyNominated.has(String(option.employeeRecordId))),
    [alreadyNominated, divisionNominees],
  );
  const reasonLength = nominationReason.trim().length;
  const canSubmitNomination = Boolean(nominee) && reasonLength >= NOMINATION_REASON_MIN && !saving;

  const openNominate = (cycle) => {
    setNominateCycleId(cycle.id);
    setNominee(null);
    setNominationReason("");
    setNominateOpen(true);
  };

  const submitNomination = async (event) => {
    event.preventDefault();

    if (!nominateCycle || !canSubmitNomination) {
      return;
    }

    const submitted = await runMutation(
      () => submitAwardNomination({
        cycleId: nominateCycle.id,
        nomineeKey: nominee.employeeRecordId,
        reason: nominationReason.trim(),
      }),
      "Unable to submit your nomination.",
    );

    if (submitted) {
      setNominateOpen(false);
    }
  };

  /* Certificates — the tally's first place opens the certificate from the podium. */
  const runCertificateDownload = useCallback(async (node, certificate) => {
    setDownloadingId(String(certificate?.id ?? ""));

    try {
      await exportCertificatePdf(node, certificateFileName(certificate));
      toast.success("Certificate downloaded.");
    } catch {
      toast.error("Unable to download the certificate.");
    } finally {
      setDownloadingId("");
    }
  }, []);

  /*
   * An issued certificate carries a snapshot of the design it was printed on. A preview has none,
   * so the current template is fetched the first time one is opened.
   */
  const openCertificate = (certificate) => {
    setCertificateRecord(certificate);
    setCertificateOpen(true);

    if (certificate?.template || templateRequested.current) {
      return;
    }

    templateRequested.current = true;

    const loadTemplate = async () => {
      try {
        const result = await fetchCertificateTemplate();

        if (result?.template) {
          setCertificateTemplate(normalizeCertificateTemplate(result.template));
        }
      } catch {
        // Keep the built-in design, and try again the next time a preview is opened.
        templateRequested.current = false;
      }
    };

    void loadTemplate();
  };

  /* ---------------------------------------------------------------------------------------- */
  /* Tab bodies                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  const cycleSkeletons = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CardSkeleton className="h-44 w-full" />
      <CardSkeleton className="h-44 w-full" />
    </div>
  );

  const listSkeletons = (
    <div className="space-y-3">
      <CardSkeleton className="h-32 w-full" />
      <CardSkeleton className="h-32 w-full" />
      <CardSkeleton className="h-32 w-full" />
    </div>
  );

  const renderNominationList = (items, { showNominator = true, withCycle = true, review = false } = {}) => (
    <div className="space-y-3">
      {items.map(({ nomination, cycle }) => (
        <NominationCard
          key={nomination.id}
          nomination={nomination}
          nominee={employeeLookup.get(nomination.nomineeKey)}
          nominator={nomination.voterEmployeeKey ? employeeLookup.get(nomination.voterEmployeeKey) : null}
          showNominator={showNominator}
          cycleLabel={withCycle ? cycleLabelOf(cycle) : ""}
          canReview={review && !cycle.isArchived}
          onApprove={(target) => openReview(target, "approved")}
          onReject={(target) => openReview(target, "rejected")}
        />
      ))}
    </div>
  );

  /** The HR Head's close button explains itself on a tie instead of letting the server refuse it. */
  const toggleProps = (cycle) => {
    const tied = cycle.status !== "closed" && leadingTie(cycle).length > 0;

    return {
      onToggleStatus: () => handleToggleStatus(cycle),
      toggleDisabled: tied || saving,
      toggleTitle: tied ? "The tally is tied — one nominee must be ahead before the cycle can close" : "",
    };
  };

  const renderCycleCard = (cycle) => {
    const readDescription = () => {
      setDescriptionCycle(cycle);
      setDescriptionOpen(true);
    };

    if (portalRole === "hr") {
      return (
        <CycleCard
          key={cycle.id}
          cycle={cycle}
          counts={countNominations(cycle.nominations)}
          primaryAction={{ label: "View nominations", onClick: () => openDetails(cycle) }}
          onReadDescription={readDescription}
          {...(archiveView ? {} : toggleProps(cycle))}
          extraActions={archiveView ? (
            <PortalButton size="sm" variant="outline" onClick={() => handleRestore(cycle)} disabled={saving} aria-label={`Restore ${cycle.category}`}>
              Restore
            </PortalButton>
          ) : (
            <>
              <PortalButton size="sm" variant="outline" onClick={() => openEdit(cycle)} disabled={saving} aria-label={`Edit ${cycle.category}`}>
                Edit
              </PortalButton>
              <PortalButton size="sm" variant="ghost" onClick={() => handleArchive(cycle)} disabled={saving} aria-label={`Archive ${cycle.category}`}>
                Archive
              </PortalButton>
            </>
          )}
        />
      );
    }

    if (portalRole === "chief") {
      const mine = cycle.nominations.filter((nomination) => viewerKey && nomination.voterKey === viewerKey);

      return (
        <CycleCard
          key={cycle.id}
          cycle={cycle}
          counts={countNominations(mine)}
          // Once nominations close the cycle carries on into voting, but there is nothing left to nominate into.
          primaryAction={cycle.phase === "nomination"
            ? { label: "Nominate employee", onClick: () => openNominate(cycle), disabled: saving }
            : null}
          onOpenDetails={() => openDetails(cycle)}
          onReadDescription={readDescription}
        />
      );
    }

    return (
      <CycleCard
        key={cycle.id}
        cycle={cycle}
        counts={countNominations(cycle.nominations)}
        onOpenDetails={() => openDetails(cycle)}
        onReadDescription={readDescription}
      />
    );
  };

  const cyclesTab = (
    <div className="space-y-4">
      {/* Every archived card reads "Archived", so a status filter there would act on a value the card no longer shows. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="block w-full sm:max-w-xs">
          <span className="sr-only">Search cycles</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search award, month, description"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>
        {archiveView ? null : (
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Status"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 sm:w-44"
          >
            <option value="">All statuses</option>
            {CYCLE_PHASE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? cycleSkeletons : filteredCycles.length === 0 ? (
        hasActiveFilters ? (
          <PortalEmptyState
            title={archiveView ? "No archived nominations match your filters" : "No cycles match your filters"}
            description="Try a different search term or status."
          />
        ) : archiveView ? (
          <PortalEmptyState
            title="No archived nominations yet"
            description="Archived nominations remain available with their records and can be restored at any time."
          />
        ) : (
          <PortalEmptyState
            title="No nomination cycles yet"
            description={canManage
              ? "Create your first monthly nomination cycle to start collecting submissions from division chiefs."
              : "Nomination cycles will appear here as soon as the HR Head opens them."}
            action={canManage ? (
              <PortalButton onClick={openCreate}>
                Create cycle
              </PortalButton>
            ) : null}
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {paginatedCycles.map(renderCycleCard)}
          </div>
          {totalPages > 1 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-sm text-slate-500">
                Showing {(safePage - 1) * CYCLES_PER_PAGE + 1}
                {" "}to {Math.min(safePage * CYCLES_PER_PAGE, filteredCycles.length)} of {filteredCycles.length} cycles
              </p>
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const tabBody = {
    cycles: cyclesTab,
    open: loading ? cycleSkeletons : openCycles.length === 0 ? (
      <PortalEmptyState
        title="No open nomination cycles"
        description="The HR Head hasn't opened any nomination cycles yet. Check back soon or reach out to HR."
      />
    ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{openCycles.map(renderCycleCard)}</div>
    ),
    pending: loading ? listSkeletons : pendingItems.length === 0 ? (
      <PortalEmptyState
        title="Nothing pending"
        description="You're all caught up. Nominations awaiting review will appear here."
      />
    ) : renderNominationList(pendingItems, { review: true }),
    recognized: loading ? listSkeletons : recognizedItems.length === 0 ? (
      <PortalEmptyState
        title="No recognized employees yet"
        description="Approved nominations from any cycle will be celebrated here."
      />
    ) : renderNominationList(recognizedItems),
    mine: loading ? listSkeletons : myItems.length === 0 ? (
      <PortalEmptyState
        title="You haven't nominated anyone yet"
        description="When you submit a nomination, it will appear here with its current review status."
      />
    ) : renderNominationList(myItems, { showNominator: false }),
    tally: (
      <WinnersTally
        cycles={orderedCycles}
        employeeLookup={employeeLookup}
        loading={loading}
        onViewCertificate={openCertificate}
      />
    ),
  };

  /* A Chief sees their own nominations inside a cycle, as on their My Nominations tab. */
  const detailsNominations = useMemo(() => {
    if (!detailsCycle) {
      return [];
    }

    const nominations = portalRole === "chief"
      ? detailsCycle.nominations.filter((nomination) => viewerKey && nomination.voterKey === viewerKey)
      : detailsCycle.nominations;

    return [...nominations].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }, [detailsCycle, portalRole, viewerKey]);

  const reviewNomination = reviewTarget?.nomination;
  const approving = reviewTarget?.action === "approved";
  const reviewNominee = reviewNomination ? employeeLookup.get(reviewNomination.nomineeKey) : null;
  const reviewCycle = reviewNomination
    ? cycles.find((cycle) => cycle.nominations.some((nomination) => nomination.id === reviewNomination.id))
    : null;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight text-slate-950">
            {awardsView ? "My Rewards" : archiveView ? "Archived Nominations" : banner.heading}
          </h2>
          <p className="m-0 text-sm text-slate-500">
            {awardsView
              ? "Awards you have won. A certificate is issued automatically when a nomination cycle you won closes."
              : archiveView
                ? "Archived nominations and their records. Restore a nomination to return it to the active list."
                : banner.intro}
          </p>
        </div>
        {/* My Rewards belongs to everybody — the rest of these buttons are the manager's. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleAwardsView}
            aria-pressed={awardsView}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            {awardsView ? "Back to nominations" : "My Rewards"}
          </button>
          {canManage && !awardsView ? (
            <button
              type="button"
              onClick={toggleArchiveView}
              aria-pressed={archiveView}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              {archiveView ? "Back to nominations" : "Archived"}
              {!archiveView && archivedCount > 0 ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                  {archivedCount}
                </span>
              ) : null}
            </button>
          ) : null}
          {canManage && !archiveView && !awardsView ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              New nomination
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      {awardsView ? (
        <MyRewardsWorkspace embedded />
      ) : archiveView ? (
        cyclesTab
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>

          <div className="w-full">
            <PortalTabs tabs={tabs} value={currentTab} onChange={setActiveTab} />
            <div className="mt-4" role="tabpanel">
              {tabBody[currentTab]}
            </div>
          </div>
        </>
      )}

      <ProfileFloatingCard
        open={descriptionOpen}
        onClose={() => setDescriptionOpen(false)}
        title={descriptionCycle?.category || "Award nomination"}
        subtitle={formatPeriod(descriptionCycle || {}) || undefined}
        maxWidth="max-w-[520px]"
      >
        <p className="m-0 whitespace-pre-wrap text-sm leading-7 text-slate-600">
          {descriptionCycle?.description}
        </p>
      </ProfileFloatingCard>

      {/*
        A review opens on top of this card, so Escape and the backdrop only close it once the review
        is out of the way — otherwise one keypress would dismiss both.
      */}
      <ProfileFloatingCard
        open={detailsOpen && Boolean(detailsCycle)}
        onClose={() => {
          if (!reviewOpen) {
            setDetailsOpen(false);
          }
        }}
        title={detailsCycle?.category || "Nomination cycle"}
        subtitle={detailsCycle
          ? [formatCycleMonth(detailsCycle.opensOn), `Created ${formatDate(detailsCycle.createdAt) || "—"}`].filter(Boolean).join(" · ")
          : undefined}
        maxWidth="max-w-[720px]"
      >
        {detailsCycle ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
              <CycleStatusBadge phase={detailsCycle.phase} archived={detailsCycle.isArchived} />
              {formatPeriod(detailsCycle) ? <span>Nominations &amp; voting: {formatPeriod(detailsCycle)}</span> : null}
            </div>
            {detailsCycle.description ? (
              <p className="m-0 whitespace-pre-wrap text-center text-sm text-slate-600">{detailsCycle.description}</p>
            ) : null}

            {/* Live from the first approval, since that is when the employees can start voting. */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <h3 className="m-0 mb-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                {detailsCycle.phase === "closed" ? "Final standings" : "Live results"}
              </h3>
              <CycleStandings cycle={detailsCycle} voterCount={voterCount} />
            </section>

            <div className="text-xs uppercase tracking-wide text-slate-500">
              {nominationLabel(detailsNominations.length)}
              {portalRole === "chief" ? " from you" : ""}
            </div>

            {detailsNominations.length === 0 ? (
              <PortalEmptyState
                title="No nominations yet"
                description={portalRole === "chief"
                  ? "You haven't submitted any nominations for this cycle yet."
                  : "Division Chiefs haven't submitted any nominations for this cycle."}
                className="py-12"
              />
            ) : (
              renderNominationList(
                detailsNominations.map((nomination) => ({ nomination, cycle: detailsCycle })),
                { showNominator: portalRole !== "chief", withCycle: false, review: portalRole === "hr" },
              )
            )}
          </div>
        ) : null}
      </ProfileFloatingCard>

      <ProfileFloatingCard
        open={reviewOpen}
        onClose={() => {
          if (!saving) {
            setReviewOpen(false);
          }
        }}
        title={approving ? "Approve nomination" : "Reject nomination"}
        subtitle={approving
          ? reviewCycle?.phase === "closed"
            ? "This cycle has closed, so the approval is recorded but the employees can no longer vote for them."
            : "Approving puts this employee in the Winners Tally right away, and the employees can start voting for them."
          : "Rejecting will remove this nomination from the running for this cycle."}
        maxWidth="max-w-[520px]"
      >
        {reviewNomination ? (
          <form className="space-y-4" onSubmit={submitReview}>
            <div className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <PersonAvatar name={reviewNomination.nomineeName} photo={reviewNominee?.profileImage} size="md" />
                <div className="min-w-0 flex-1">
                  <h4 className="m-0 text-sm font-semibold text-slate-950">{reviewNomination.nomineeName}</h4>
                  <p className="m-0 text-xs text-slate-500">
                    {[reviewNomination.nomineePosition, reviewNomination.nomineeDivision].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              </div>
              {reviewNomination.voterName ? (
                <div className="mt-3 text-xs text-slate-500">
                  Nominated by <span className="font-medium text-slate-700">{reviewNomination.voterName}</span>
                  {" · Division Chief · "}
                  {formatDate(reviewNomination.createdAt) || "—"}
                </div>
              ) : null}
              <p className="m-0 mt-2 whitespace-pre-wrap text-sm italic text-slate-700">“{reviewNomination.reason}”</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="award-review-note" className="block text-sm font-semibold text-slate-700">
                Reviewer note{" "}
                <span className="text-xs font-normal text-slate-500">(optional, shown to the nominator)</span>
              </label>
              <textarea
                id="award-review-note"
                rows={3}
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                maxLength={REVIEWER_NOTE_MAX}
                placeholder={approving
                  ? "Add a note of recognition or context for the approval..."
                  : "Provide feedback on why this nomination was rejected..."}
                className={textareaClass}
              />
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <PortalButton variant="ghost" onClick={() => setReviewOpen(false)} disabled={saving}>
                Cancel
              </PortalButton>
              <PortalButton type="submit" variant={approving ? "success" : "danger"} disabled={saving}>
                {saving ? "Submitting..." : approving ? "Confirm approval" : "Confirm rejection"}
              </PortalButton>
            </div>
          </form>
        ) : null}
      </ProfileFloatingCard>

      {canVote ? (
        <ProfileFloatingCard
          open={nominateOpen && Boolean(nominateCycle)}
          onClose={() => {
            if (!saving) {
              setNominateOpen(false);
            }
          }}
          title="Nominate an employee"
          subtitle={nominateCycle
            ? `Submit a nomination for ${cycleLabelOf(nominateCycle)}.`
            : undefined}
          maxWidth="max-w-[560px]"
        >
          {nominateCycle ? (
            <form className="space-y-4" onSubmit={submitNomination} noValidate>
              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-700">
                  Select employee from your team <span className="text-rose-600">*</span>
                </span>
                <EmployeeSearchSelect
                  employeeOptions={eligibleNominees}
                  selectedEmployee={nominee}
                  onSelect={setNominee}
                  disabled={eligibleNominees.length === 0 || saving}
                  placeholder={eligibleNominees.length === 0 ? "No eligible employees left" : "Choose an employee"}
                  ariaLabel="Employee"
                  showSelectedDetails
                  inlineMenu
                />
                {divisionNominees.length === 0 ? (
                  <p className="m-0 text-xs text-slate-500">
                    There are no other employees in your division to nominate yet.
                  </p>
                ) : eligibleNominees.length === 0 ? (
                  <p className="m-0 text-xs text-slate-500">
                    All employees in your team have already been nominated for this period.
                  </p>
                ) : alreadyNominated.size > 0 ? (
                  <p className="m-0 text-xs text-slate-500">
                    {alreadyNominated.size} employee{alreadyNominated.size === 1 ? "" : "s"} already nominated this cycle.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="award-nomination-reason" className="block text-sm font-semibold text-slate-700">
                  Reason for nomination <span className="text-rose-600">*</span>
                </label>
                <textarea
                  id="award-nomination-reason"
                  rows={5}
                  value={nominationReason}
                  onChange={(event) => setNominationReason(event.target.value)}
                  maxLength={NOMINATION_REASON_MAX}
                  placeholder="Describe the specific achievements, behaviors, or contributions that make this employee deserve the recognition..."
                  className={textareaClass}
                />
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Minimum {NOMINATION_REASON_MIN} characters.</span>
                  <span>{nominationReason.length}/{NOMINATION_REASON_MAX}</span>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <PortalButton variant="ghost" onClick={() => setNominateOpen(false)} disabled={saving}>
                  Cancel
                </PortalButton>
                <PortalButton type="submit" disabled={!canSubmitNomination || eligibleNominees.length === 0}>
                  {saving ? "Submitting..." : "Submit nomination"}
                </PortalButton>
              </div>
            </form>
          ) : null}
        </ProfileFloatingCard>
      ) : null}

      <AwardCertificateModal
        open={certificateOpen}
        certificate={certificateRecord}
        template={normalizeCertificateTemplate(certificateRecord?.template || certificateTemplate)}
        downloading={downloadingId === String(certificateRecord?.id ?? "")}
        onDownload={(node) => runCertificateDownload(node, certificateRecord)}
        onClose={() => setCertificateOpen(false)}
      />

      {canManage ? (
        <Modal
          open={modalOpen}
          title={editingId ? "Edit nomination" : "New nomination"}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button type="submit" form="award-cycle-form" loading={saving}>
                {editingId ? "Save changes" : "Create nomination"}
              </Button>
            </>
          }
        >
          <form id="award-cycle-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <SettingsSelect
                  id="award-cycle-category"
                  name="category"
                  label="Award *"
                  value={customAwardOpen ? "" : form.category}
                  onChange={selectAward}
                  options={awardCategoryOptions}
                  placeholder="Select an award"
                  error={!customAwardOpen ? formErrors.category : undefined}
                />
                <Button
                  variant={customAwardOpen ? "primary" : "secondary"}
                  className="min-h-[42px] sm:mb-0"
                  aria-pressed={customAwardOpen}
                  onClick={openCustomAward}
                >
                  Custom
                </Button>
              </div>

              {customAwardOpen ? (
                <InputField
                  id="award-cycle-custom-category"
                  name="category"
                  label="Custom award type *"
                  value={form.category}
                  onChange={updateField("category")}
                  error={formErrors.category}
                  maxLength={120}
                  placeholder="Enter a custom award type"
                  autoComplete="off"
                  autoFocus
                />
              ) : null}

              {!formErrors.category && !customAwardOpen ? (
                <p className="m-0 mt-1.5 text-xs text-slate-500">
                  Select an existing award type, or choose Custom to enter a new one.
                </p>
              ) : null}
            </div>

            <div className="w-full">
              <label htmlFor="award-cycle-description" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Description <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="award-cycle-description"
                name="description"
                rows={3}
                value={form.description}
                onChange={updateField("description")}
                placeholder="What this award recognises and who may be nominated."
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
              />
            </div>

            <div className="w-full">
              <label htmlFor="award-cycle-opens-on" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Nomination period
              </label>
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  id="award-cycle-opens-on"
                  name="opensOn"
                  type="datetime-local"
                  value={form.opensOn}
                  onChange={updateField("opensOn")}
                  aria-label="Nominations open"
                  aria-invalid={Boolean(formErrors.period)}
                  className={`${dateFieldClass} ${formErrors.period ? "border-rose-600" : "border-slate-200"}`}
                />
                <span className="text-sm text-slate-500">to</span>
                <input
                  id="award-cycle-closes-on"
                  name="closesOn"
                  type="datetime-local"
                  value={form.closesOn}
                  // Stops the picker offering a closing time the validation would only reject.
                  min={form.opensOn || undefined}
                  onChange={updateField("closesOn")}
                  aria-label="Nominations and voting close"
                  aria-invalid={Boolean(formErrors.period)}
                  className={`${dateFieldClass} ${formErrors.period ? "border-rose-600" : "border-slate-200"}`}
                />
              </div>
              {formErrors.period ? (
                <p className="m-0 mt-1.5 text-sm text-rose-700">{formErrors.period}</p>
              ) : (
                <p className="m-0 mt-1.5 text-xs text-slate-500">
                  One nomination per award each month. Nominations and voting both close automatically at
                  the time you set here: the employees can vote for a nominee as soon as you approve them,
                  and the nominee with the most votes wins. The division Chiefs are notified when
                  nominations open, and again a day before they close.
                </p>
              )}
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
