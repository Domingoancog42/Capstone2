import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Archive, Award, Filter, Plus, Search, Trophy } from "lucide-react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import {
  faBoxArchive,
  faClockRotateLeft,
  faDownload,
  faEye,
  faLock,
  faLockOpen,
  faPen,
} from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import ProfileFloatingCard from "../../components/profile/ProfileFloatingCard";
import { SettingsSelect } from "../../components/settings";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  archiveAwardCycle,
  castAwardNomination,
  createAwardCycle,
  fetchAwardCycles,
  fetchMyAwardCertificates,
  getEmployees,
  restoreAwardCycle,
  setAwardCycleStatus,
  updateAwardCycle,
  withdrawAwardNomination,
} from "../../services/api";
import AwardCertificateModal, {
  AwardCertificatePaper,
  certificateFileName,
  exportCertificatePdf,
} from "./AwardCertificate";
import AwardCycleDetail from "./AwardCycleDetail";
import { StatusPill } from "./AwardCyclePrimitives";
import AwardVotersTable from "./AwardVotersTable";
import {
  AWARD_CATEGORIES,
  formatDate,
  formatPeriod,
  leadingTie,
  normalizeCycle,
  tallyNominations,
  voteLabel,
} from "./awardCycleUtils";

/**
 * Award Cycles — the Nomination screen under Rewards & Recognition.
 *
 * A cycle is one round of an award: it names the award, fixes the window nominations are accepted
 * in, and carries the tally. The list is the entry point; picking an award opens the detail screen
 * where people vote.
 *
 * Everything lives in `reward_cycles` / `reward_nominations` behind `rewards.php`, so a cycle HR
 * opens is the same cycle every employee votes in. Each mutation refetches rather than patching
 * local state — the tally is the sum of everyone's votes, so the server's copy is the only one worth
 * trusting.
 *
 * The list/detail split is local state rather than a route, so neither `AdminDashboard`'s path map
 * nor `RoleWorkspacePage`'s nav matching needs a second Rewards entry to know about.
 *
 * `canManage` is the difference between the HR screen and the one every employee gets: without it
 * the cycle stops being editable and all that is left is voting and watching the tally. The server
 * enforces the same split — hiding the buttons is a courtesy, not the control.
 */

const defaultForm = {
  category: AWARD_CATEGORIES[0],
  description: "",
  opensOn: "",
  closesOn: "",
};

/** Past this the cell is truncated and the full text moves into the floating card. */
const DESCRIPTION_PREVIEW_LIMIT = 60;

/** Matches `InputField`'s control so the merged period field sits level with the rest of the form. */
const dateFieldClass =
  "min-h-[46px] flex-1 rounded-lg border bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15";

/**
 * The nomination period is one field with two ends, so it carries one error rather than two — a
 * cycle with only an opening date has no point at which the tally is final.
 */
function validate(form) {
  const errors = {};

  if (!form.opensOn || !form.closesOn) {
    errors.period = "Set both the opening and closing dates before saving.";
  } else if (form.closesOn < form.opensOn) {
    errors.period = "The closing date cannot come before the opening date.";
  }

  return errors;
}

const AWARD_CYCLE_STATUS_OPTIONS = ["Ongoing", "Closed"];
const DEFAULT_AWARD_CYCLE_ROWS_PER_PAGE = 10;

const MEDALS = ["🥇", "🥈", "🥉"];

/** One line of the Result cell: the rank marker and the name. The Votes column already has the count. */
function ResultRow({ marker, name, className = "" }) {
  return (
    <li className={`flex items-center gap-1.5 whitespace-nowrap leading-6 ${className}`.trim()}>
      {/* A fixed floor rather than a fixed width: the medals are one glyph, "#1" is two. */}
      <span className="min-w-[1.25rem] shrink-0 text-center text-xs" aria-hidden="true">{marker}</span>
      <span className="truncate">{name}</span>
    </li>
  );
}

/**
 * The top three once voting is closed, who is ahead while it is open, and an em dash before any vote.
 *
 * The full standings live behind the eye; this is the glance the list gives without opening anything,
 * so it stops at the podium — a cycle with a dozen nominees would otherwise turn every row into a
 * scrolling list.
 */
function ResultCell({ cycle }) {
  const leaderboard = tallyNominations(cycle.nominations);
  const leader = leaderboard[0];

  if (!leader) {
    return <span className="text-slate-400">—</span>;
  }

  const podium = leaderboard.slice(0, 3);

  if (cycle.status === "closed") {
    return (
      <ol className="m-0 list-none space-y-0.5 p-0 text-sm">
        {podium.map((entry) => (
          <ResultRow
            key={entry.key}
            marker={MEDALS[entry.rank - 1]}
            name={entry.name}
            className={entry.rank === 1 ? "font-semibold text-[#D61E1E]" : "text-slate-500"}
          />
        ))}
      </ol>
    );
  }

  // Naming one of several tied nominees as the leader would read as a result the cycle has not
  // reached, so a tie drops the ranks and lists the names level with each other instead.
  const tied = leadingTie(cycle.nominations);

  if (tied.length > 0) {
    return (
      <div className="text-sm">
        <p className="m-0 font-semibold text-amber-700">Tied at {voteLabel(tied[0].votes)}</p>
        <ol className="m-0 mt-0.5 list-none space-y-0.5 p-0">
          {podium.map((entry) => (
            <ResultRow
              key={entry.key}
              marker="•"
              name={entry.name}
              className="text-slate-500"
            />
          ))}
        </ol>
      </div>
    );
  }

  return (
    <ol className="m-0 list-none space-y-0.5 p-0 text-sm">
      {podium.map((entry) => (
        <ResultRow
          key={entry.key}
          marker={`#${entry.rank}`}
          name={entry.name}
          className={entry.rank === 1 ? "font-semibold text-slate-900" : "text-slate-500"}
        />
      ))}
    </ol>
  );
}

/**
 * The final standings of a closed cycle as a plain ranked list — rank, a medal for the top three,
 * the name, the count.
 *
 * Deliberately undecorated: the podium on the detail screen is the showpiece, this is the glance you
 * get from the list without leaving it.
 */
function AwardResultsList({ cycle }) {
  const leaderboard = tallyNominations(cycle?.nominations);

  if (leaderboard.length === 0) {
    return (
      <p className="m-0 text-center text-sm text-slate-500">
        Voting closed without a single nomination.
      </p>
    );
  }

  return (
    <ol className="m-0 list-none divide-y divide-slate-100 p-0">
      {leaderboard.map((entry) => (
        <li key={entry.key} className="flex items-center gap-3 py-2.5 text-sm">
          <span className="w-4 shrink-0 text-right font-semibold text-slate-400">{entry.rank}</span>
          <span className="w-5 shrink-0 text-center leading-none" aria-hidden="true">
            {MEDALS[entry.rank - 1] || ""}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{entry.name}</span>
          <span className="shrink-0 text-slate-500">{voteLabel(entry.votes)}</span>
        </li>
      ))}
    </ol>
  );
}

function MyAwardsEmptyState({ linked = true }) {
  return (
    <div className="py-5">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <Award size={20} aria-hidden="true" />
      </div>
      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
        {linked ? "No awards yet" : "We cannot tell which employee you are"}
      </p>
      <p className="m-0 mt-1 text-sm text-slate-500">
        {linked
          ? "Win an award cycle and the certificate is issued here the moment voting closes."
          : "Your account is not linked to an employee record, so awards cannot be matched to you. Ask HR to check it."}
      </p>
    </div>
  );
}

function EmptyState({ canManage, hasFilters, onCreate, archiveView }) {
  if (archiveView) {
    return (
      <div className="py-5">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
          <Archive size={20} aria-hidden="true" />
        </div>
        <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
          {hasFilters ? "No archived cycles match your filters" : "Nothing archived yet"}
        </p>
        <p className="m-0 mt-1 text-sm text-slate-500">
          {hasFilters
            ? "Try a different search term or status."
            : "Archiving a cycle retires it from the list without losing its votes. It will show up here."}
        </p>
      </div>
    );
  }

  return (
    <div className="py-5">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <Filter size={20} aria-hidden="true" />
      </div>
      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
        {hasFilters ? "No award cycles match your filters" : "No award cycles yet"}
      </p>
      <p className="m-0 mt-1 text-sm text-slate-500">
        {hasFilters
          ? "Try a different search term or status."
          : canManage
            ? "Create your first cycle — for example “Best Employee of the Month” — and let everyone nominate."
            : "Nominations open here as soon as HR starts an award cycle."}
      </p>
      {!hasFilters && canManage ? (
        <Button className="mt-5" icon={Plus} onClick={onCreate}>
          Create the first cycle
        </Button>
      ) : null}
    </div>
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

export default function AwardCyclesWorkspace({ employees, canManage = true }) {
  const directory = useNomineeDirectory(employees);
  const [cycles, setCycles] = useState([]);
  const [viewerKey, setViewerKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [formErrors, setFormErrors] = useState({});
  /*
   * Two pieces of state rather than one: closing only flips `descriptionOpen`, so the card still has
   * its text to render while it animates out instead of blanking the moment it is dismissed.
   */
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionCycle, setDescriptionCycle] = useState(null);
  /* Same split for the results card. A closed tally cannot move, so the snapshot cannot go stale. */
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsCycle, setResultsCycle] = useState(null);
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
   * "My Awards" is a third view over the same screen: the certificates the signed-in user has won.
   * The list is fetched only once the view is opened — most visits to Award Cycles never ask for it.
   */
  const [awardsView, setAwardsView] = useState(false);
  const [certificates, setCertificates] = useState([]);
  const [certificatesLoading, setCertificatesLoading] = useState(false);
  const [certificatesLinked, setCertificatesLinked] = useState(true);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [certificateRecord, setCertificateRecord] = useState(null);
  const [downloadingId, setDownloadingId] = useState("");
  /*
   * A row's Download has no certificate on screen to capture, so the paper is mounted off-screen for
   * the length of the export. The preview hands over its own node and skips this entirely.
   */
  const [downloadTarget, setDownloadTarget] = useState(null);
  const hiddenPaperRef = useRef(null);

  const loadCycles = useCallback(async () => {
    try {
      const result = await fetchAwardCycles({ archived: archiveView });

      setCycles(Array.isArray(result?.cycles) ? result.cycles.map(normalizeCycle) : []);
      setViewerKey(String(result?.viewerKey ?? ""));
      setArchivedCount(Number(result?.archivedCount ?? 0));
      setError("");
    } catch (requestError) {
      setCycles([]);
      setError(requestError.response?.data?.message || "Unable to load the award cycles.");
    } finally {
      setLoading(false);
    }
  }, [archiveView]);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  const loadCertificates = useCallback(async () => {
    try {
      const result = await fetchMyAwardCertificates();

      setCertificates(Array.isArray(result?.certificates) ? result.certificates : []);
      setCertificatesLinked(result?.linked !== false);
    } catch {
      setCertificates([]);
    } finally {
      setCertificatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!awardsView) {
      return;
    }

    setCertificatesLoading(true);
    void loadCertificates();
  }, [awardsView, loadCertificates]);

  /*
   * Votes cast elsewhere in this browser move the tally, so the list follows the rewards topic. The
   * same signal covers My Awards: closing a cycle mints the certificate, so a win that lands while
   * the view is open appears without a reload. `refreshOnMount` is off because the effects above
   * already made the first calls.
   */
  useAutoRefreshOnChange(
    useCallback(async () => {
      await loadCycles();

      if (awardsView) {
        await loadCertificates();
      }
    }, [awardsView, loadCertificates, loadCycles]),
    { topic: "rewards", refreshOnMount: false },
  );

  // The server already orders newest first; this keeps that true after an optimistic refetch.
  const orderedCycles = useMemo(
    () => [...cycles].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [cycles],
  );

  const selectedCycle = useMemo(
    () => cycles.find((cycle) => cycle.id === selectedCycleId) || null,
    [cycles, selectedCycleId],
  );

  const filteredCycles = useMemo(() => {
    const search = query.trim().toLowerCase();

    return orderedCycles.filter((cycle) => {
      const matchesSearch = !search || [cycle.category, cycle.description, cycle.createdByName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesStatus = !statusFilter || cycle.status === statusFilter.toLowerCase();

      return matchesSearch && matchesStatus;
    });
  }, [orderedCycles, query, statusFilter]);
  const hasActiveFilters = Boolean(query.trim()) || Boolean(statusFilter);
  const totalPages = Math.max(1, Math.ceil(filteredCycles.length / DEFAULT_AWARD_CYCLE_ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCycles = useMemo(() => {
    const startIndex = (safePage - 1) * DEFAULT_AWARD_CYCLE_ROWS_PER_PAGE;
    return filteredCycles.slice(startIndex, startIndex + DEFAULT_AWARD_CYCLE_ROWS_PER_PAGE);
  }, [filteredCycles, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter]);

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
    setModalOpen(true);
  };

  const updateField = (field) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const errors = validate(form);
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    const saved = await runMutation(
      () => (editingId ? updateAwardCycle({ cycleId: editingId, ...form }) : createAwardCycle(form)),
      editingId ? "Unable to update the award cycle." : "Unable to create the award cycle.",
    );

    if (saved) {
      setModalOpen(false);
    }
  };

  const handleToggleStatus = (cycle) => {
    const status = cycle.status === "closed" ? "ongoing" : "closed";

    void runMutation(
      () => setAwardCycleStatus({ cycleId: cycle.id, status }),
      "Unable to change the voting status.",
    );
  };

  /**
   * Archiving replaces deleting here. The votes are the record of who the office picked, so a cycle
   * is retired from the list rather than erased — everything stays recoverable from the archive.
   */
  const handleArchive = async (cycle) => {
    const confirmation = await Swal.fire({
      title: "Archive this cycle?",
      text: `“${cycle.category}” will move to the archive. Its ${voteLabel(cycle.nominations.length)} stay on record and it can be restored later.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Archive",
      confirmButtonColor: "#D61E1E",
      cancelButtonText: "Cancel",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const archived = await runMutation(() => archiveAwardCycle(cycle.id), "Unable to archive the award cycle.");

    // Archiving from the detail screen leaves nothing to show, so fall back to the list.
    if (archived && selectedCycleId === cycle.id) {
      setSelectedCycleId(null);
    }
  };

  const handleRestore = (cycle) => {
    void runMutation(() => restoreAwardCycle(cycle.id), "Unable to restore the award cycle.");
  };

  /** Switching views resets everything scoped to the old list rather than carrying it across. */
  const toggleArchiveView = () => {
    setArchiveView((current) => !current);
    setAwardsView(false);
    setSelectedCycleId(null);
    setQuery("");
    setStatusFilter("");
    setCurrentPage(1);
    setLoading(true);
  };

  const toggleAwardsView = () => {
    setAwardsView((current) => !current);
    setArchiveView(false);
    setSelectedCycleId(null);
  };

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
   * Waits one frame so the off-screen paper is laid out before it is captured; the export itself
   * waits on the letterhead images, so nothing else here needs to.
   */
  useEffect(() => {
    if (!downloadTarget) {
      return undefined;
    }

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void runCertificateDownload(hiddenPaperRef.current, downloadTarget).finally(() => {
        if (!cancelled) {
          setDownloadTarget(null);
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [downloadTarget, runCertificateDownload]);

  const openCertificate = (certificate) => {
    setCertificateRecord(certificate);
    setCertificateOpen(true);
  };

  /**
   * One vote per person. The unique key on `reward_nominations` is what enforces that — recasting
   * updates the existing row instead of adding a second one.
   */
  const handleVote = (cycle, { nomineeKey, reason }) => {
    void runMutation(
      () => castAwardNomination({ cycleId: cycle.id, nomineeKey, reason }),
      "Unable to record your vote.",
    );
  };

  const handleWithdraw = (cycle) => {
    void runMutation(() => withdrawAwardNomination(cycle.id), "Unable to withdraw your vote.");
  };

  const columns = [
    {
      key: "award",
      header: "Award",
      render: (cycle) => (
        <button
          type="button"
          onClick={() => setSelectedCycleId(cycle.id)}
          className="m-0 border-0 bg-transparent p-0 text-left font-semibold text-slate-900 transition hover:text-[#D61E1E] hover:underline"
        >
          {cycle.category}
        </button>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (cycle) => {
        if (!cycle.description) {
          return <span className="text-slate-400">—</span>;
        }

        // Short enough to read in place — a click target here would promise more than it delivers.
        if (cycle.description.length <= DESCRIPTION_PREVIEW_LIMIT) {
          return <span className="text-slate-600">{cycle.description}</span>;
        }

        return (
          <button
            type="button"
            title="Read the full description"
            onClick={() => {
              setDescriptionCycle(cycle);
              setDescriptionOpen(true);
            }}
            className="m-0 border-0 bg-transparent p-0 text-left text-slate-600 underline decoration-slate-300 decoration-dotted underline-offset-4 transition hover:text-[#D61E1E] hover:decoration-[#D61E1E]"
          >
            {`${cycle.description.slice(0, DESCRIPTION_PREVIEW_LIMIT).trimEnd()}…`}
          </button>
        );
      },
    },
    {
      key: "period",
      header: "Period",
      render: (cycle) => {
        const period = formatPeriod(cycle);
        return period ? <span className="text-slate-600">{period}</span> : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (cycle) => <StatusPill status={cycle.status} archived={cycle.isArchived} />,
    },
    {
      key: "votes",
      header: "Votes",
      render: (cycle) => <span className="font-semibold text-slate-900">{cycle.nominations.length}</span>,
    },
    {
      key: "result",
      header: "Result",
      render: (cycle) => <ResultCell cycle={cycle} />,
    },
    {
      key: "createdAt",
      header: "Created",
      render: (cycle) => <span className="text-slate-400">{formatDate(cycle.createdAt) || "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (cycle) => {
        const closed = cycle.status === "closed";
        // Same rule the detail screen enforces and the server backs: a tie has no winner to crown.
        const tied = !closed && leadingTie(cycle.nominations).length > 0;

        return (
          <div className="flex items-center gap-2">
            <ActionIconButton
              label={closed ? `See the results of ${cycle.category}` : `Open ${cycle.category}`}
              icon={faEye}
              tone="view"
              // Once voting is closed the standings are the whole story, so the eye shows them here
              // instead of sending the reader to a ballot nobody can cast on.
              onClick={() => {
                if (closed) {
                  setResultsCycle(cycle);
                  setResultsOpen(true);
                  return;
                }

                setSelectedCycleId(cycle.id);
              }}
            />
            {canManage && archiveView ? (
              <ActionIconButton
                label={`Restore ${cycle.category}`}
                icon={faClockRotateLeft}
                tone="approve"
                text="Restore"
                disabled={saving}
                onClick={() => handleRestore(cycle)}
              />
            ) : null}
            {canManage && !archiveView ? (
              <>
                <ActionIconButton
                  label={`Edit ${cycle.category}`}
                  icon={faPen}
                  tone="edit"
                  disabled={saving}
                  onClick={() => openEdit(cycle)}
                />
                <ActionIconButton
                  label={
                    closed
                      ? `Reopen voting for ${cycle.category}`
                      : tied
                        ? "Voting is tied — one nominee must be ahead before it can close"
                        : `Close voting for ${cycle.category}`
                  }
                  icon={closed ? faLockOpen : faLock}
                  tone={closed ? "approve" : "cancel"}
                  // The tone is only the colour here — "Approve" would name an action this button
                  // does not do, so both states spell out what the click actually does.
                  text={closed ? "Open" : "Cancel"}
                  disabled={tied || saving}
                  onClick={() => handleToggleStatus(cycle)}
                />
                <ActionIconButton
                  label={`Archive ${cycle.category}`}
                  icon={faBoxArchive}
                  tone="archive"
                  disabled={saving}
                  onClick={() => handleArchive(cycle)}
                />
              </>
            ) : null}
          </div>
        );
      },
    },
  ];

  const certificateColumns = [
    {
      key: "awardTitle",
      header: "Award",
      render: (certificate) => <span className="font-semibold text-slate-900">{certificate.awardTitle}</span>,
    },
    {
      key: "certificateNumber",
      header: "Certificate No.",
      render: (certificate) => <span className="text-slate-600">{certificate.certificateNumber || "—"}</span>,
    },
    {
      key: "period",
      header: "Period",
      render: (certificate) => {
        const period = formatPeriod(certificate);
        return period ? <span className="text-slate-600">{period}</span> : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: "awardedOn",
      header: "Awarded",
      render: (certificate) => <span className="text-slate-600">{formatDate(certificate.awardedOn) || "—"}</span>,
    },
    {
      key: "votes",
      header: "Votes",
      render: (certificate) => <span className="font-semibold text-slate-900">{certificate.votes}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (certificate) => (
        <div className="flex items-center gap-2">
          <ActionIconButton
            label={`View the certificate for ${certificate.awardTitle}`}
            icon={faEye}
            tone="view"
            onClick={() => openCertificate(certificate)}
          />
          <ActionIconButton
            label={`Download the certificate for ${certificate.awardTitle}`}
            icon={faDownload}
            tone="print"
            text={downloadingId === String(certificate.id) ? "Saving..." : "Download"}
            disabled={downloadingId !== ""}
            onClick={() => setDownloadTarget(certificate)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      {selectedCycle ? (
        <AwardCycleDetail
          cycle={selectedCycle}
          viewerKey={viewerKey}
          employees={directory}
          canManage={canManage}
          saving={saving}
          onBack={() => setSelectedCycleId(null)}
          onEdit={openEdit}
          onToggleStatus={handleToggleStatus}
          onArchive={handleArchive}
          onRestore={handleRestore}
          onVote={(vote) => handleVote(selectedCycle, vote)}
          onWithdraw={handleWithdraw}
        />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="m-0 text-base font-semibold text-slate-950">
                {awardsView ? "My Awards" : archiveView ? "Archived Award Cycles" : "Award Cycles"}
              </h3>
              <p className="m-0 mt-1 text-sm text-slate-500">
                {awardsView
                  ? "Every award you have won. Certificates are issued automatically when voting closes."
                  : archiveView
                    ? "Retired cycles and their votes. Restore one to put it back on the list."
                    : canManage
                      ? "Nominate teammates, tally the votes, and crown the best employee."
                      : "Nominate a teammate and follow the tally for every open award."}
              </p>
            </div>
            {/* My Awards belongs to everybody — the rest of these buttons are the manager's. */}
            <div className="flex flex-wrap items-center gap-2">
              {canManage && !archiveView && !awardsView ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
                >
                  <Plus size={16} />
                  New award cycle
                </button>
              ) : null}
              <button
                type="button"
                onClick={toggleAwardsView}
                aria-pressed={awardsView}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                {awardsView ? <ArrowLeft size={16} /> : <Award size={16} />}
                {awardsView ? "Back to award cycles" : "My Awards"}
              </button>
              {canManage && !awardsView ? (
                <button
                  type="button"
                  onClick={toggleArchiveView}
                  aria-pressed={archiveView}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                  {archiveView ? <ArrowLeft size={16} /> : <Archive size={16} />}
                  {archiveView ? "Back to award cycles" : "Archived"}
                  {!archiveView && archivedCount > 0 ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {archivedCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
            </div>
          </div>

          {awardsView ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <Table
                columns={certificateColumns}
                data={certificates}
                rowKey="id"
                loading={certificatesLoading}
                emptyState={<MyAwardsEmptyState linked={certificatesLinked} />}
                tableClassName="[&_tbody_tr:last-child>td]:border-b-0"
              />
            </div>
          ) : (
          <div>
            {error ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {error}
              </div>
            ) : null}

            {/* Every archived row reads "Archived", so a status filter there would act on a value the table no longer shows. */}
            <div className={`mt-4 grid gap-3 ${archiveView ? "lg:grid-cols-[minmax(0,220px)]" : "lg:grid-cols-[minmax(0,220px)_160px]"}`}>
              <label className="relative">
                <span className="sr-only">Search award cycles</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search award, description"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </label>
              {archiveView ? null : (
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                >
                  <option value="">All statuses</option>
                  {AWARD_CYCLE_STATUS_OPTIONS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <Table
                columns={columns}
                data={paginatedCycles}
                rowKey="id"
                loading={loading}
                emptyState={(
                  <EmptyState
                    canManage={canManage}
                    hasFilters={hasActiveFilters}
                    onCreate={openCreate}
                    archiveView={archiveView}
                  />
                )}
                tableClassName="[&_tbody_tr:last-child>td]:border-b-0"
              />
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-sm text-slate-500">
                Showing {filteredCycles.length === 0 ? 0 : (safePage - 1) * DEFAULT_AWARD_CYCLE_ROWS_PER_PAGE + 1}
                {" "}to {Math.min(safePage * DEFAULT_AWARD_CYCLE_ROWS_PER_PAGE, filteredCycles.length)} of {filteredCycles.length} award cycles
              </p>
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>
          </div>
          )}
        </section>
      )}

      <ProfileFloatingCard
        open={descriptionOpen}
        onClose={() => setDescriptionOpen(false)}
        title={descriptionCycle?.category || "Award cycle"}
        subtitle={formatPeriod(descriptionCycle || {}) || undefined}
        icon={Trophy}
        maxWidth="max-w-[520px]"
      >
        <p className="m-0 whitespace-pre-wrap text-sm leading-7 text-slate-600">
          {descriptionCycle?.description}
        </p>
      </ProfileFloatingCard>

      <ProfileFloatingCard
        open={resultsOpen}
        onClose={() => setResultsOpen(false)}
        title={resultsCycle?.category || "Final results"}
        subtitle={formatPeriod(resultsCycle || {}) || undefined}
        // The standings alone fit a narrow card; the ballot underneath needs room for its columns.
        maxWidth={canManage ? "max-w-[720px]" : "max-w-[460px]"}
      >
        <div className="space-y-5">
          <section>
            <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              Final standings
            </h3>
            <AwardResultsList cycle={resultsCycle} />
          </section>

          {/*
            Same rule the detail screen follows: the per-voter ballot belongs to the people running
            the award. Everyone else gets the standings and their own vote.
          */}
          {canManage ? (
            <section className="border-t border-slate-100 pt-4">
              <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                Voters
              </h3>
              <AwardVotersTable nominations={resultsCycle?.nominations} employees={directory} />
            </section>
          ) : null}
        </div>
      </ProfileFloatingCard>

      <AwardCertificateModal
        open={certificateOpen}
        certificate={certificateRecord}
        downloading={downloadingId === String(certificateRecord?.id ?? "")}
        onDownload={(node) => runCertificateDownload(node, certificateRecord)}
        onClose={() => setCertificateOpen(false)}
      />

      {/*
        Off-screen rather than hidden: html2canvas paints what the browser laid out, and a
        `display: none` paper has no layout to paint.
      */}
      {downloadTarget ? (
        <div
          aria-hidden="true"
          style={{ position: "fixed", top: 0, left: "-10000px", width: "960px", pointerEvents: "none" }}
        >
          <AwardCertificatePaper ref={hiddenPaperRef} certificate={downloadTarget} />
        </div>
      ) : null}

      {canManage ? (
        <Modal
          open={modalOpen}
          title={editingId ? "Edit award cycle" : "New award cycle"}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" form="award-cycle-form" loading={saving}>
                {editingId ? "Save changes" : "Create cycle"}
              </Button>
            </>
          }
        >
          <form id="award-cycle-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
            <SettingsSelect
              name="category"
              label="Award"
              value={form.category}
              onChange={updateField("category")}
              options={AWARD_CATEGORIES}
            />

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
                  type="date"
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
                  type="date"
                  value={form.closesOn}
                  // Stops the picker offering a closing date the validation would only reject.
                  min={form.opensOn || undefined}
                  onChange={updateField("closesOn")}
                  aria-label="Nominations close"
                  aria-invalid={Boolean(formErrors.period)}
                  className={`${dateFieldClass} ${formErrors.period ? "border-rose-600" : "border-slate-200"}`}
                />
              </div>
              {formErrors.period ? (
                <p className="m-0 mt-1.5 text-sm text-rose-700">{formErrors.period}</p>
              ) : (
                <p className="m-0 mt-1.5 text-xs text-slate-500">
                  Nominations are accepted between these dates.
                </p>
              )}
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
