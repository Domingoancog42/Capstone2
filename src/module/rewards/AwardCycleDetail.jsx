import React, { useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, CalendarDays, Filter, Pencil, RotateCcw, Search, Users } from "lucide-react";
import { toast } from "react-hot-toast";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import AwardCyclePodium from "./AwardCyclePodium";
import { NomineeAvatar, PanelCard, StatusPill } from "./AwardCyclePrimitives";
import {
  buildEmployeeLookup,
  divisionOf,
  formatDateTime,
  formatPeriod,
  leadingTie,
  nomineeOptionsFrom,
  tallyNominations,
  voteLabel,
} from "./awardCycleUtils";

const MEDALS = ["🥇", "🥈", "🥉"];

const lastRowFlush = "[&_tbody_tr:last-child>td]:border-b-0";

const NOMINATIONS_PAGE_SIZES = [5, 10, 20, 50];

const NOMINATIONS_ROWS_PER_PAGE = NOMINATIONS_PAGE_SIZES[1];

function RankCell({ rank }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-slate-500">
      <span aria-hidden="true">{MEDALS[rank - 1] || ""}</span>
      #{rank}
    </span>
  );
}

/**
 * One award cycle: who is winning, and the form the signed-in user votes with.
 *
 * The cycle itself is owned by `AwardCyclesWorkspace` — every mutation here goes back up through a
 * callback so the list and the detail can never disagree about the tally.
 */
export default function AwardCycleDetail({
  cycle,
  viewerKey = "",
  viewerEmployeeRecordId = "",
  employees = [],
  canManage = true,
  saving = false,
  onBack,
  onEdit,
  onToggleStatus,
  onArchive,
  onRestore,
  onVote,
  onWithdraw,
}) {
  const viewerEmployeeKey = String(viewerEmployeeRecordId ?? "").trim();
  const employeeOptions = useMemo(() => {
    const options = nomineeOptionsFrom(employees);

    return viewerEmployeeKey
      ? options.filter((option) => String(option.employeeRecordId) !== viewerEmployeeKey)
      : options;
  }, [employees, viewerEmployeeKey]);
  const employeeLookup = useMemo(() => buildEmployeeLookup(employees), [employees]);
  const leaderboard = useMemo(() => tallyNominations(cycle.nominations), [cycle.nominations]);
  const tiedLeaders = useMemo(() => leadingTie(cycle.nominations), [cycle.nominations]);

  const closed = cycle.status === "closed";
  const archived = Boolean(cycle.isArchived);
  // An archived cycle is out of circulation: it reads exactly like a closed one, ballot and all.
  const readOnly = closed || archived;
  // Closing a tie would force the podium to crown one of them arbitrarily, so the button waits.
  const blockedByTie = !closed && tiedLeaders.length > 0;
  const topVotes = leaderboard[0]?.votes ?? 0;
  // `viewerKey` comes from the API rather than from the session object, so "which vote is mine" is
  // the server's answer and cannot drift with whichever id field the client happens to hold.
  // A voter may back several nominees in one cycle, so this is every row they filed, not one.
  const myNominations = useMemo(
    () => cycle.nominations.filter((nomination) => nomination.voterKey === viewerKey),
    [cycle.nominations, viewerKey],
  );

  // Joined into a string so the sync effect below compares the picks themselves rather than the
  // array identity `filter` hands back fresh on every render.
  const myNomineeKeys = myNominations
    .map((nomination) => nomination.nomineeKey)
    .filter((key) => !viewerEmployeeKey || String(key) !== viewerEmployeeKey)
    .join(",");
  // Every row of a ballot carries the same reason, so the first one is the reason.
  const myReason = myNominations[0]?.reason || "";
  const myNomineeNames = myNominations.map((nomination) => nomination.nomineeName).join(", ");

  const [nomineeValues, setNomineeValues] = useState(() => (myNomineeKeys ? myNomineeKeys.split(",") : []));
  const [reason, setReason] = useState(myReason);

  // Re-sync whenever the stored ballot changes — after a cast, a withdrawal, or a jump between cycles.
  useEffect(() => {
    setNomineeValues(myNomineeKeys ? myNomineeKeys.split(",") : []);
    setReason(myReason);
  }, [myNomineeKeys, myReason]);

  const canChangeBallot = Boolean(viewerKey) && !readOnly;
  const canVote = canChangeBallot && employeeOptions.length > 0;

  const [page, setPage] = useState(1);
  const [ballotQuery, setBallotQuery] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(NOMINATIONS_ROWS_PER_PAGE);

  // Newest first: the ballot reads as a feed of who just voted.
  const orderedNominations = useMemo(
    () => [...cycle.nominations].sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""))),
    [cycle.nominations],
  );

  // The search covers the nominee's name, so a nominee filter would only repeat what typing a name
  // already does — the division comes from the directory rather than the row, hence not searched.
  const filteredNominations = useMemo(() => {
    const search = ballotQuery.trim().toLowerCase();

    if (!search) {
      return orderedNominations;
    }

    return orderedNominations.filter((nomination) =>
      [nomination.voterName, nomination.nomineeName, nomination.reason]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search)),
    );
  }, [ballotQuery, orderedNominations]);

  const totalPages = Math.max(1, Math.ceil(filteredNominations.length / rowsPerPage));
  // Derived rather than clamped in state: withdrawing a vote can shrink the list out from under the
  // page the reader is on, and a stale `page` would leave the table blank.
  const safePage = Math.min(page, totalPages);
  const pagedNominations = filteredNominations.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  // A changed filter or page size makes the current page number meaningless — start over from the top.
  useEffect(() => {
    setPage(1);
  }, [ballotQuery, rowsPerPage]);

  const selectedNominees = useMemo(
    () => employeeOptions.filter((option) => nomineeValues.includes(String(option.employeeRecordId))),
    [employeeOptions, nomineeValues],
  );

  const toggleNominee = (employee) => {
    const key = String(employee.employeeRecordId);
    if (viewerEmployeeKey && key === viewerEmployeeKey) {
      return;
    }

    setNomineeValues((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const submittedNomineeValues = nomineeValues.filter(
      (key) => !viewerEmployeeKey || String(key) !== viewerEmployeeKey,
    );

    if (submittedNomineeValues.length === 0) {
      toast.error("Pick who you are nominating.");
      return;
    }

    onVote({ nomineeKeys: submittedNomineeValues, reason: reason.trim() });
  };

  // A nomination stores the nominee's id and name only, so the division is read from the live
  // directory — a nominee who has transferred since voting shows where they are now.
  const divisionFor = (nomineeKey) => divisionOf(employeeLookup.get(String(nomineeKey)));

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const leaderboardColumns = [
    { key: "rank", header: "Rank", cardRole: "eyebrow", render: (row) => <RankCell rank={row.rank} /> },
    {
      key: "employee",
      header: "Employee",
      cardRole: "title",
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <NomineeAvatar
            employee={employeeLookup.get(String(row.key))}
            name={row.name}
            className="h-8 w-8 border border-slate-200 text-[11px]"
          />
          <span className="font-semibold text-slate-900">{row.name}</span>
        </span>
      ),
    },
    {
      key: "division",
      header: "Division",
      cardRole: "subtitle",
      render: (row) => <span className="text-slate-600">{divisionFor(row.key) || "—"}</span>,
    },
    {
      key: "votes",
      header: "Votes",
      render: (row) => (
        <span className="inline-flex min-w-[28px] justify-center rounded-md bg-[#D61E1E] px-2 py-0.5 text-xs font-semibold text-white">
          {row.votes}
        </span>
      ),
    },
    {
      key: "result",
      header: "Result",
      cardRole: "badge",
      // Keyed on the vote count, not the rank: everyone level at the top is leading, and saying
      // otherwise would contradict the tie that is blocking the close.
      render: (row) => {
        if (row.votes !== topVotes || topVotes === 0) return null;

        return closed ? (
          <span className="inline-flex items-center rounded-full border border-[#F8BFBF] bg-[#FEF1F1] px-2.5 py-1 text-xs font-semibold text-[#D61E1E]">
            Best Employee
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            {blockedByTie ? "Tied" : "Leading"}
          </span>
        );
      },
    },
  ];

  const nominationColumns = [
    {
      key: "voterName",
      header: "Voter",
      cardRole: "subtitle",
      render: (row) => <span className="text-slate-600">{row.voterName || "—"}</span>,
    },
    {
      key: "nomineeName",
      header: "Nominated",
      cardRole: "title",
      render: (row) => <span className="font-semibold text-slate-900">{row.nomineeName}</span>,
    },
    {
      key: "division",
      header: "Division",
      render: (row) => <span className="text-slate-600">{divisionFor(row.nomineeKey) || "—"}</span>,
    },
    {
      key: "reason",
      header: "Reason",
      cardFull: true,
      render: (row) => (row.reason ? <span className="text-slate-600">{row.reason}</span> : <span className="text-slate-400">—</span>),
    },
    {
      key: "createdAt",
      header: "Date",
      render: (row) => <span className="text-slate-400">{formatDateTime(row.createdAt) || "—"}</span>,
    },
  ];

  const period = formatPeriod(cycle);

  return (
    <div className="w-full space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-lg border-0 bg-transparent p-0 text-sm font-semibold text-slate-500 transition hover:text-[#D61E1E]"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        All nominations
      </button>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 text-lg font-semibold leading-tight text-slate-900">{cycle.category}</h2>
              <StatusPill status={cycle.status} archived={archived} />
            </div>
            {cycle.description ? <p className="m-0 mt-1.5 text-sm text-slate-500">{cycle.description}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
              {period ? (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={15} aria-hidden="true" />
                  {period}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Users size={15} aria-hidden="true" />
                {voteLabel(cycle.nominations.length)}
              </span>
              {cycle.createdByName ? (
                <span className="text-slate-400">Created by {cycle.createdByName}</span>
              ) : null}
            </div>
          </div>

          {canManage ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {archived ? (
                <Button size="sm" icon={RotateCcw} disabled={saving} onClick={() => onRestore(cycle)}>
                  Restore
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEdit(cycle)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    disabled={blockedByTie || saving}
                    title={blockedByTie ? "Voting is tied — one nominee must be ahead before it can close." : undefined}
                    onClick={() => onToggleStatus(cycle)}
                  >
                    {closed ? "Reopen nominations" : "Close nominations"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Archive}
                    disabled={saving}
                    onClick={() => onArchive(cycle)}
                  >
                    Archive
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Managers get the reason the Close voting button is greyed out; nobody else can close. */}
        {canManage && blockedByTie ? (
          <p className="m-0 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-semibold leading-6 text-amber-800">
            Voting is tied — {tiedLeaders.map((entry) => entry.name).join(", ")} each have{" "}
            {voteLabel(tiedLeaders[0].votes)}. One nominee must be ahead before voting can close.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-1">
          {readOnly ? (
            /* Nothing here is actionable once voting closes, so the form gives way to the outcome. */
            <>
              <h3 className="m-0 text-base font-semibold text-slate-900">
                {archived ? "This nomination is archived" : "Nominations are closed"}
              </h3>
              <p className="m-0 mt-1 text-sm leading-6 text-slate-500">
                {archived
                  ? "Restore it to return it to the active list and reopen nominations."
                  : "The results for this nomination are final."}
              </p>
              {myNominations.length > 0 ? (
                <p className="m-0 mt-4 text-sm leading-6 text-slate-500">
                  You voted for <span className="font-semibold text-slate-700">{myNomineeNames}</span>.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h3 className="m-0 text-base font-semibold text-slate-900">Cast your nomination</h3>
              <p className="m-0 mt-1 text-sm leading-6 text-slate-500">
                Select each colleague you wish to nominate. You can update your selection until nominations close.
              </p>

              <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
                <div className="w-full">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Nominate</span>
                  {/* Search-and-tick rather than a plain select: the directory runs to hundreds of
                      names, and a ballot may back more than one of them. */}
                  <EmployeeSearchSelect
                    multiple
                    employeeOptions={employeeOptions}
                    selectedEmployees={selectedNominees}
                    onSelect={toggleNominee}
                    onClear={() => setNomineeValues([])}
                    disabled={!canVote}
                    placeholder="Search employees to nominate"
                  />
                </div>

                <div className="w-full">
                  <label htmlFor="nomination-reason" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Reason <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <textarea
                    id="nomination-reason"
                    name="reason"
                    rows={3}
                    value={reason}
                    disabled={!canVote}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="What made them stand out?"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" className="flex-1" disabled={!canVote} loading={saving}>
                    {myNominations.length > 0 ? "Update nomination" : "Submit nomination"}
                  </Button>
                  {myNominations.length > 0 ? (
                    <Button variant="secondary" disabled={!canChangeBallot || saving} onClick={() => onWithdraw(cycle)}>
                      Withdraw nomination
                    </Button>
                  ) : null}
                </div>
              </form>

              <p className="m-0 mt-3 text-xs leading-5 text-slate-500">
                {!viewerKey ? (
                  "Your account could not be identified, so voting is unavailable."
                ) : employeeOptions.length === 0 ? (
                  viewerEmployeeKey
                    ? "There are no other employees available to nominate yet."
                    : "The employee directory is empty, so there is nobody to nominate yet."
                ) : myNominations.length > 0 ? (
                  <>
                    You voted for <span className="font-semibold text-slate-700">{myNomineeNames}</span>. You can
                    change or withdraw your {myNominations.length === 1 ? "vote" : "votes"} while voting is open.
                  </>
                ) : (
                  "You have not submitted a nomination yet."
                )}
              </p>
            </>
          )}
        </section>

        <PanelCard
          title={closed ? "Final results" : "Leaderboard"}
          aside={closed ? "Final tally" : "Live tally"}
          className="lg:col-span-2"
        >
          {closed ? (
            <AwardCyclePodium leaderboard={leaderboard} employees={employees} />
          ) : (
            <Table
              columns={leaderboardColumns}
              data={leaderboard}
              rowKey="key"
              cardsClassName="lg:hidden"
              tableWrapperClassName="hidden lg:block"
              tableClassName={lastRowFlush}
              rowClassName={(row) => (row.rank === 1 ? "bg-[#FEF1F1]/60" : "")}
              emptyMessage="No nominations yet — be the first to vote."
            />
          )}
        </PanelCard>
      </div>

      {/*
        The per-voter ballot is for the people running the award. Everyone else gets the leaderboard
        and their own vote — seeing who each teammate nominated is not theirs to have.
      */}
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>All nominations</CardTitle>
            <CardDescription>Every nomination submitted for this award, newest first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_150px]">
              <label className="relative">
                <span className="sr-only">Search nominations</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={ballotQuery}
                  onChange={(event) => setBallotQuery(event.target.value)}
                  placeholder="Search voter, nominee, reason"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </label>
              <select
                value={rowsPerPage}
                onChange={(event) => setRowsPerPage(Number(event.target.value))}
                aria-label="Nominations per page"
                className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                {NOMINATIONS_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size} rows</option>
                ))}
              </select>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <Table
                columns={nominationColumns}
                data={pagedNominations}
                rowKey="id"
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
                tableClassName={lastRowFlush}
                emptyState={
                  <div className="py-5">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                      <Filter size={20} aria-hidden="true" />
                    </div>
                    <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
                      {ballotQuery.trim() ? "No nominations match your search" : "No nominations found"}
                    </p>
                    <p className="m-0 mt-1 text-sm text-slate-500">
                      {ballotQuery.trim()
                        ? "Try a different voter, nominee, or reason."
                        : "No nominations have been submitted for this award yet."}
                    </p>
                  </div>
                }
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-sm text-slate-500">
                Showing {filteredNominations.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1}
                {" "}to {Math.min(safePage * rowsPerPage, filteredNominations.length)} of {filteredNominations.length} nominations
              </p>
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
