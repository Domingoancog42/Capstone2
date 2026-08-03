import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Plus, Search, Trophy } from "lucide-react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import { faEye, faLock, faLockOpen, faPen, faTrash } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import ProfileFloatingCard from "../../components/profile/ProfileFloatingCard";
import { SettingsSelect } from "../../components/settings";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  castAwardNomination,
  createAwardCycle,
  deleteAwardCycle,
  fetchAwardCycles,
  getEmployees,
  setAwardCycleStatus,
  updateAwardCycle,
  withdrawAwardNomination,
} from "../../services/api";
import AwardCycleDetail from "./AwardCycleDetail";
import { StatusPill } from "./AwardCyclePrimitives";
import {
  AWARD_CATEGORIES,
  formatDate,
  formatPeriod,
  leadingNominee,
  leadingTie,
  normalizeCycle,
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

/** The winner once voting is closed, who is ahead while it is open, and an em dash before any vote. */
function ResultCell({ cycle }) {
  const leader = leadingNominee(cycle.nominations);

  if (!leader) {
    return <span className="text-slate-400">—</span>;
  }

  if (cycle.status === "closed") {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-[#D61E1E]">
        <Trophy size={15} aria-hidden="true" />
        {leader.name}
      </span>
    );
  }

  // Naming one of several tied nominees here would read as a result the cycle has not reached.
  const tied = leadingTie(cycle.nominations);

  if (tied.length > 0) {
    return (
      <span className="font-semibold text-amber-700">
        Tied at {voteLabel(tied[0].votes)}
      </span>
    );
  }

  return (
    <span className="text-slate-500">
      Leading: <span className="font-semibold text-slate-900">{leader.name}</span>
    </span>
  );
}

const AWARD_CYCLE_STATUS_OPTIONS = ["Ongoing", "Closed"];
const DEFAULT_AWARD_CYCLE_ROWS_PER_PAGE = 10;

function EmptyState({ canManage, hasFilters, onCreate }) {
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const loadCycles = useCallback(async () => {
    try {
      const result = await fetchAwardCycles();

      setCycles(Array.isArray(result?.cycles) ? result.cycles.map(normalizeCycle) : []);
      setViewerKey(String(result?.viewerKey ?? ""));
      setError("");
    } catch (requestError) {
      setCycles([]);
      setError(requestError.response?.data?.message || "Unable to load the award cycles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  // Votes land from other accounts while this screen is open, so the tally follows the change feed.
  // `refreshOnMount` is off because the effect above already made the first call.
  useAutoRefreshOnChange(loadCycles, { topic: "rewards", refreshOnMount: false });

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

  const handleDelete = async (cycle) => {
    const confirmation = await Swal.fire({
      title: "Delete this cycle?",
      text: `“${cycle.category}” and any nominations filed under it will be removed.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#D61E1E",
      cancelButtonText: "Cancel",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const deleted = await runMutation(() => deleteAwardCycle(cycle.id), "Unable to delete the award cycle.");

    // Deleting from the detail screen leaves nothing to show, so fall back to the list.
    if (deleted && selectedCycleId === cycle.id) {
      setSelectedCycleId(null);
    }
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
      render: (cycle) => <StatusPill status={cycle.status} />,
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
        // Same rule the detail screen enforces and the server backs: a tie has no winner to crown.
        const tied = cycle.status !== "closed" && leadingTie(cycle.nominations).length > 0;

        return (
          <div className="flex items-center gap-2">
            <ActionIconButton
              label={`Open ${cycle.category}`}
              icon={faEye}
              tone="view"
              onClick={() => setSelectedCycleId(cycle.id)}
            />
            {canManage ? (
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
                    cycle.status === "closed"
                      ? `Reopen voting for ${cycle.category}`
                      : tied
                        ? "Voting is tied — one nominee must be ahead before it can close"
                        : `Close voting for ${cycle.category}`
                  }
                  icon={cycle.status === "closed" ? faLockOpen : faLock}
                  tone={cycle.status === "closed" ? "approve" : "cancel"}
                  disabled={tied || saving}
                  onClick={() => handleToggleStatus(cycle)}
                />
                <ActionIconButton
                  label={`Delete ${cycle.category}`}
                  icon={faTrash}
                  tone="delete"
                  disabled={saving}
                  onClick={() => handleDelete(cycle)}
                />
              </>
            ) : null}
          </div>
        );
      },
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
          onDelete={handleDelete}
          onVote={(vote) => handleVote(selectedCycle, vote)}
          onWithdraw={handleWithdraw}
        />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="m-0 text-base font-semibold text-slate-950">Award Cycles</h3>
              <p className="m-0 mt-1 text-sm text-slate-500">
                {canManage
                  ? "Nominate teammates, tally the votes, and crown the best employee."
                  : "Nominate a teammate and follow the tally for every open award."}
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <Plus size={16} />
                New award cycle
              </button>
            ) : null}
          </div>

          <div>
            {error ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {error}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px]">
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
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <Table
                columns={columns}
                data={paginatedCycles}
                rowKey="id"
                loading={loading}
                emptyState={<EmptyState canManage={canManage} hasFilters={hasActiveFilters} onCreate={openCreate} />}
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
