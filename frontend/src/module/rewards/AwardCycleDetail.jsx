import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Filter, Pencil, Search, Trash2, Users } from "lucide-react";
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
import { SettingsSelect } from "../../components/settings";
import AwardCyclePodium from "./AwardCyclePodium";
import { NomineeAvatar, PanelCard, StatusPill } from "./AwardCyclePrimitives";
import {
  buildEmployeeLookup,
  employeeOptionsFrom,
  formatDateTime,
  formatPeriod,
  leadingTie,
  tallyNominations,
  voteLabel,
} from "./awardCycleUtils";

const MEDALS = ["🥇", "🥈", "🥉"];

const lastRowFlush = "[&_tbody_tr:last-child>td]:border-b-0";

const NOMINATIONS_ROWS_PER_PAGE = 10;

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
  employees = [],
  canManage = true,
  saving = false,
  onBack,
  onEdit,
  onToggleStatus,
  onDelete,
  onVote,
  onWithdraw,
}) {
  const employeeOptions = useMemo(() => employeeOptionsFrom(employees), [employees]);
  const employeeLookup = useMemo(() => buildEmployeeLookup(employees), [employees]);
  const leaderboard = useMemo(() => tallyNominations(cycle.nominations), [cycle.nominations]);
  const tiedLeaders = useMemo(() => leadingTie(cycle.nominations), [cycle.nominations]);

  const closed = cycle.status === "closed";
  // Closing a tie would force the podium to crown one of them arbitrarily, so the button waits.
  const blockedByTie = !closed && tiedLeaders.length > 0;
  const topVotes = leaderboard[0]?.votes ?? 0;
  // `viewerKey` comes from the API rather than from the session object, so "which vote is mine" is
  // the server's answer and cannot drift with whichever id field the client happens to hold.
  const myNomination = useMemo(
    () => cycle.nominations.find((nomination) => nomination.voterKey === viewerKey) || null,
    [cycle.nominations, viewerKey],
  );

  const [nomineeValue, setNomineeValue] = useState(myNomination?.nomineeKey || "");
  const [reason, setReason] = useState(myNomination?.reason || "");

  // Re-sync whenever the stored vote changes — after a cast, a withdrawal, or a jump between cycles.
  useEffect(() => {
    setNomineeValue(myNomination?.nomineeKey || "");
    setReason(myNomination?.reason || "");
  }, [myNomination?.nomineeKey, myNomination?.reason]);

  const canVote = Boolean(viewerKey) && !closed && employeeOptions.length > 0;

  const [page, setPage] = useState(1);
  const [ballotQuery, setBallotQuery] = useState("");
  const [ballotNomineeFilter, setBallotNomineeFilter] = useState("");

  // Newest first: the ballot reads as a feed of who just voted.
  const orderedNominations = useMemo(
    () => [...cycle.nominations].sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""))),
    [cycle.nominations],
  );

  // Distinct nominees actually on the ballot, so the filter never offers a name with nothing to show.
  const ballotNomineeOptions = useMemo(() => {
    const seen = new Map();

    orderedNominations.forEach((nomination) => {
      const key = String(nomination.nomineeKey || nomination.nomineeName || "");
      if (key && !seen.has(key)) {
        seen.set(key, nomination.nomineeName || key);
      }
    });

    return [...seen.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orderedNominations]);

  const filteredNominations = useMemo(() => {
    const search = ballotQuery.trim().toLowerCase();

    return orderedNominations.filter((nomination) => {
      const matchesSearch = !search || [nomination.voterName, nomination.nomineeName, nomination.reason]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesNominee = !ballotNomineeFilter || String(nomination.nomineeKey || nomination.nomineeName) === ballotNomineeFilter;

      return matchesSearch && matchesNominee;
    });
  }, [ballotNomineeFilter, ballotQuery, orderedNominations]);

  const totalPages = Math.max(1, Math.ceil(filteredNominations.length / NOMINATIONS_ROWS_PER_PAGE));
  // Derived rather than clamped in state: withdrawing a vote can shrink the list out from under the
  // page the reader is on, and a stale `page` would leave the table blank.
  const safePage = Math.min(page, totalPages);
  const pagedNominations = filteredNominations.slice(
    (safePage - 1) * NOMINATIONS_ROWS_PER_PAGE,
    safePage * NOMINATIONS_ROWS_PER_PAGE,
  );

  // A changed filter makes the current page number meaningless — start over from the top.
  useEffect(() => {
    setPage(1);
  }, [ballotNomineeFilter, ballotQuery]);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!nomineeValue) {
      toast.error("Pick who you are nominating.");
      return;
    }

    onVote({ nomineeKey: nomineeValue, reason: reason.trim() });
  };

  const leaderboardColumns = [
    { key: "rank", header: "Rank", render: (row) => <RankCell rank={row.rank} /> },
    {
      key: "employee",
      header: "Employee",
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
      render: (row) => <span className="text-slate-600">{row.voterName || "—"}</span>,
    },
    {
      key: "nomineeName",
      header: "Nominated",
      render: (row) => <span className="font-semibold text-slate-900">{row.nomineeName}</span>,
    },
    {
      key: "reason",
      header: "Reason",
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
        All award cycles
      </button>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 text-lg font-semibold leading-tight text-slate-900">{cycle.category}</h2>
              <StatusPill status={cycle.status} />
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
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEdit(cycle)}>
                Edit
              </Button>
              <Button
                size="sm"
                disabled={blockedByTie || saving}
                title={blockedByTie ? "Voting is tied — one nominee must be ahead before it can close." : undefined}
                onClick={() => onToggleStatus(cycle)}
              >
                {closed ? "Reopen voting" : "Close voting"}
              </Button>
              <Button
                variant="icon"
                size="sm"
                icon={Trash2}
                aria-label={`Delete ${cycle.category}`}
                onClick={() => onDelete(cycle)}
              />
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
          {closed ? (
            /* Nothing here is actionable once voting closes, so the form gives way to the outcome. */
            <>
              <h3 className="m-0 text-base font-semibold text-slate-900">Voting is closed</h3>
              <p className="m-0 mt-1 text-sm leading-6 text-slate-500">Results are final for this cycle.</p>
              {myNomination ? (
                <p className="m-0 mt-4 text-sm leading-6 text-slate-500">
                  You voted for <span className="font-semibold text-slate-700">{myNomination.nomineeName}</span>.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h3 className="m-0 text-base font-semibold text-slate-900">Cast your nomination</h3>
              <p className="m-0 mt-1 text-sm leading-6 text-slate-500">
                One vote per person — you can change it anytime before voting closes.
              </p>

              <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
                <SettingsSelect
                  name="nominee"
                  label="Nominate"
                  value={nomineeValue}
                  onChange={(event) => setNomineeValue(event.target.value)}
                  options={employeeOptions}
                  placeholder="Select an employee"
                  disabled={!canVote}
                />

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
                    {myNomination ? "Update my vote" : "Cast my vote"}
                  </Button>
                  {myNomination ? (
                    <Button variant="secondary" disabled={!canVote || saving} onClick={() => onWithdraw(cycle)}>
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              </form>

              <p className="m-0 mt-3 text-xs leading-5 text-slate-500">
                {!viewerKey ? (
                  "Your account could not be identified, so voting is unavailable."
                ) : employeeOptions.length === 0 ? (
                  "The employee directory is empty, so there is nobody to nominate yet."
                ) : myNomination ? (
                  <>
                    You voted for <span className="font-semibold text-slate-700">{myNomination.nomineeName}</span>. You
                    can change or withdraw your vote while voting is open.
                  </>
                ) : (
                  "You have not voted in this cycle yet."
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
            <CardDescription>Every vote cast in this cycle, newest first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_200px]">
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
                value={ballotNomineeFilter}
                onChange={(event) => setBallotNomineeFilter(event.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">All nominees</option>
                {ballotNomineeOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.name}</option>
                ))}
              </select>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <Table
                columns={nominationColumns}
                data={pagedNominations}
                rowKey="id"
                tableClassName={lastRowFlush}
                emptyState={
                  <div className="py-5">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                      <Filter size={20} aria-hidden="true" />
                    </div>
                    <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
                      {ballotQuery.trim() || ballotNomineeFilter ? "No nominations match your filters" : "No nominations found"}
                    </p>
                    <p className="m-0 mt-1 text-sm text-slate-500">
                      {ballotQuery.trim() || ballotNomineeFilter
                        ? "Try a different search term or nominee."
                        : "Nobody has nominated in this cycle yet."}
                    </p>
                  </div>
                }
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-sm text-slate-500">
                Showing {filteredNominations.length === 0 ? 0 : (safePage - 1) * NOMINATIONS_ROWS_PER_PAGE + 1}
                {" "}to {Math.min(safePage * NOMINATIONS_ROWS_PER_PAGE, filteredNominations.length)} of {filteredNominations.length} nominations
              </p>
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
