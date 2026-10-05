import React, { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { castAwardVote, fetchAwardCycles } from "../../services/api";
import {
  CardSkeleton,
  CycleStatusBadge,
  PersonAvatar,
  PortalButton,
  PortalEmptyState,
  StatCard,
} from "./NominationPortalUI";
import {
  buildStandings,
  formatCycleMonth,
  formatMoment,
  normalizeCycle,
  timeRemainingLabel,
  voteLabel,
} from "./awardCycleUtils";
import useDeadlineRefresh from "./useDeadlineRefresh";

/**
 * Award Voting — the employees' half of Rewards & Recognition.
 *
 * The HR Head opens an award, the division Chiefs nominate, and the HR Head approves; each approved
 * nominee joins the ballot this page shows the moment they are approved. Each employee votes for one
 * of them per award and may change that vote until voting closes — so a nominee approved later can
 * still win them over. The nominee with the most votes wins, and the certificate is issued when the
 * cycle closes.
 *
 * Reads the same list the Nomination screen does. `rewards.php` shapes it for a voter: only approved
 * nominees, nothing of HR's review, and no vote counts until the cycle closes — so nobody's choice is
 * steered by how everybody else is leaning. It also refuses a vote once voting has closed, for
 * somebody not on the ballot, or for the voter themselves; the screen only says so first.
 */

/** Past this a nomination reason is clamped, with the rest a click away. */
const REASON_PREVIEW_LIMIT = 160;

function NominationReason({ nomination }) {
  const [expanded, setExpanded] = useState(false);
  const long = nomination.reason.length > REASON_PREVIEW_LIMIT;

  return (
    <div className="text-xs leading-relaxed text-slate-600">
      <p className={`m-0 whitespace-pre-wrap italic ${long && !expanded ? "line-clamp-3" : ""}`.trim()}>
        “{nomination.reason}”
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
        {nomination.voterName ? <span>Nominated by {nomination.voterName}</span> : null}
        {long ? (
          <button
            type="button"
            onClick={(event) => {
              // Inside the option's label: cancelled so reading more can never also pick the nominee.
              event.preventDefault();
              setExpanded((current) => !current);
            }}
            className="border-0 bg-transparent p-0 text-[11px] font-semibold text-teal-700 hover:text-teal-900 hover:underline"
          >
            {expanded ? "Show less" : "Read more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One nominee on the ballot, as a radio choice. The voter's own entry is shown rather than hidden —
 * finding out you were nominated is worth seeing — but cannot be picked.
 */
function BallotOption({ cycleId, entry, checked, isSelf, isCurrentVote, disabled, onSelect }) {
  const unavailable = disabled || isSelf;

  return (
    <label
      className={`flex h-full cursor-pointer flex-col gap-3 rounded-xl border-2 p-4 transition ${
        checked ? "border-teal-600 bg-teal-50/60 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
      } ${unavailable ? "cursor-not-allowed opacity-70" : ""}`.trim()}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name={`ballot-${cycleId}`}
          value={entry.key}
          checked={checked}
          disabled={unavailable}
          onChange={() => onSelect(entry.key)}
          className="mt-1 h-4 w-4 shrink-0 accent-teal-700"
        />
        <PersonAvatar name={entry.name} photo={entry.photo} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold leading-tight text-slate-950">{entry.name}</span>
            {isSelf ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">You</span>
            ) : null}
            {isCurrentVote ? (
              <span className="rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Your vote
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
            {entry.position ? <span>{entry.position}</span> : null}
            {entry.position && entry.division ? <span aria-hidden="true">·</span> : null}
            {entry.division ? <span>{entry.division}</span> : null}
          </div>
          {isSelf ? <p className="m-0 mt-1 text-xs text-slate-500">You can&apos;t vote for yourself.</p> : null}
        </div>
      </div>
      {entry.nominations.length > 0 ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          {entry.nominations.map((nomination) => (
            <NominationReason key={nomination.id} nomination={nomination} />
          ))}
        </div>
      ) : null}
    </label>
  );
}

/** The approved nominees of one cycle, alphabetical so the order implies nothing about who is ahead. */
function ballotOf(cycle) {
  return buildStandings([cycle])
    .map((entry) => ({ ...entry, nominations: entry.nominations.filter((nomination) => nomination.status === "approved") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * When an award's vote ends, as a voter should read it: with the nomination period, or — for a
 * period run out but reopened by HR to settle a tie — whenever HR closes it.
 */
function votingEndsText(cycle) {
  if (cycle.phase === "voting") {
    return "Voting was reopened and stays open until HR closes it";
  }

  const remaining = timeRemainingLabel(cycle.closesOn);

  return `Voting closes ${formatMoment(cycle.closesOn)}${remaining ? ` (${remaining})` : ""}`;
}

function BallotCard({ cycle, viewerEmployeeRecordId, canCastVote, selected, submitting, onSelect, onSubmit }) {
  const nominees = useMemo(() => ballotOf(cycle), [cycle]);
  const choice = selected || cycle.myVote;
  const changed = Boolean(choice) && choice !== cycle.myVote;
  const votedFor = nominees.find((entry) => entry.key === cycle.myVote);

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="h-1.5 w-full bg-gradient-to-r from-sky-400 to-sky-600" aria-hidden="true" />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-base font-semibold leading-tight text-slate-950">{cycle.category}</h3>
              {/* An employee is here to vote, which they can do in either open phase. */}
              <CycleStatusBadge phase="voting" />
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {formatCycleMonth(cycle.opensOn) ? `${formatCycleMonth(cycle.opensOn)} · ` : ""}
              {votingEndsText(cycle)}
            </div>
            {cycle.phase === "nomination" ? (
              <p className="m-0 mt-1 text-xs text-slate-500">
                More nominees may join this ballot as HR approves them.
              </p>
            ) : null}
            {cycle.description ? (
              <p className="m-0 mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-500">{cycle.description}</p>
            ) : null}
          </div>
          <div
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${
              votedFor ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {votedFor ? `You voted for ${votedFor.name}` : "You haven't voted yet"}
          </div>
        </div>

        {nominees.length === 0 ? (
          <PortalEmptyState
            title="No nominees on the ballot yet"
            description="HR hasn't approved any nominees for this award yet. Check back soon."
            className="py-10"
          />
        ) : (
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="sr-only">Nominees for {cycle.category}</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {nominees.map((entry) => (
                <BallotOption
                  key={entry.key}
                  cycleId={cycle.id}
                  entry={entry}
                  checked={choice === entry.key}
                  isSelf={Boolean(viewerEmployeeRecordId) && entry.key === viewerEmployeeRecordId}
                  isCurrentVote={entry.key === cycle.myVote}
                  disabled={!canCastVote || submitting}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </fieldset>
        )}

        {nominees.length > 0 && canCastVote ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-xs text-slate-500">
              One vote per award. You can change it until voting closes.
            </p>
            <PortalButton onClick={onSubmit} disabled={submitting || !choice || (!changed && Boolean(cycle.myVote))}>
              {submitting ? "Submitting..." : cycle.myVote ? (changed ? "Change vote" : "Vote recorded") : "Submit vote"}
            </PortalButton>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** An open award with nobody approved yet: there is nothing to vote for until HR approves someone. */
function WaitingCard({ cycle }) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="m-0 text-sm font-semibold text-slate-950">{cycle.category}</h3>
      <p className="m-0 text-xs text-slate-500">
        {cycle.phase === "nomination"
          ? `Division Chiefs are nominating until ${formatMoment(cycle.closesOn)}. Each nominee appears here for you to vote on as soon as HR approves them.`
          : "Nominations have closed. The nominees appear here for you to vote on as soon as HR approves them."}
      </p>
      <p className="m-0 text-xs font-medium text-slate-700">{votingEndsText(cycle)}</p>
    </article>
  );
}

/** A closed cycle: who won, the final count, and what this voter chose. Counts are only sent once closed. */
function ResultCard({ cycle }) {
  const standings = useMemo(() => buildStandings([cycle]), [cycle]);
  const myChoice = standings.find((entry) => entry.key === cycle.myVote);
  const winnerName = cycle.certificate?.employeeName || "";
  const tied = !winnerName && standings.length > 1 && standings[0].votes > 0 && standings[0].votes === standings[1].votes;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold text-slate-950">{cycle.category}</h3>
        <CycleStatusBadge phase={cycle.phase} />
        <span className="text-xs text-slate-500">{formatCycleMonth(cycle.opensOn)}</span>
      </div>
      <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
        {winnerName ? `Winner: ${winnerName}` : tied ? "The vote ended in a tie." : "No winner was declared."}
      </div>
      {standings.length > 0 ? (
        <ol className="m-0 list-none space-y-1.5 p-0">
          {standings.map((entry) => (
            <li key={entry.key} className="flex items-center gap-2 text-xs">
              <span className="w-4 shrink-0 text-right font-semibold text-slate-400">{entry.rank}</span>
              <PersonAvatar name={entry.name} photo={entry.photo} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{entry.name}</span>
              <span className="shrink-0 text-slate-500">{voteLabel(entry.votes)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="m-0 text-xs text-slate-500">
        {myChoice ? `You voted for ${myChoice.name}.` : "You did not vote in this award."}
        {cycle.totalVotes !== null ? ` ${voteLabel(cycle.totalVotes)} cast in total.` : ""}
      </p>
    </article>
  );
}

function SectionHeading({ title, description }) {
  return (
    <div>
      <h3 className="m-0 text-base font-semibold text-slate-950">{title}</h3>
      {description ? <p className="m-0 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

export default function EmployeeVotingWorkspace() {
  const [cycles, setCycles] = useState([]);
  const [canCastVote, setCanCastVote] = useState(true);
  const [viewerEmployeeRecordId, setViewerEmployeeRecordId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /* The nominee picked on each ballot but not yet submitted, by cycle id. */
  const [choices, setChoices] = useState({});
  const [submittingId, setSubmittingId] = useState("");

  const loadCycles = useCallback(async () => {
    try {
      const result = await fetchAwardCycles();

      setCycles(Array.isArray(result?.cycles) ? result.cycles.map(normalizeCycle) : []);
      setCanCastVote(Boolean(result?.canCastVote));
      setViewerEmployeeRecordId(String(result?.viewerEmployeeRecordId ?? ""));
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load award voting.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  // Approvals land and cycles close while the page is open; both arrive on the rewards topic.
  useAutoRefreshOnChange(loadCycles, { topic: "rewards", refreshOnMount: false });
  useDeadlineRefresh(cycles, loadCycles);

  /*
   * An open award is on the ballot as soon as it has an approved nominee, whether or not the Chiefs
   * are still nominating; until then there is nothing to vote for, so it waits below.
   */
  const awards = useMemo(() => cycles.filter((cycle) => !cycle.isArchived), [cycles]);
  const openAwards = awards.filter((cycle) => cycle.phase !== "closed");
  const votingNow = openAwards.filter((cycle) => ballotOf(cycle).length > 0);
  const waiting = openAwards.filter((cycle) => ballotOf(cycle).length === 0);
  const results = awards.filter((cycle) => cycle.phase === "closed");

  const stats = [
    { label: "Open for voting", value: votingNow.length },
    { label: "Waiting for your vote", value: votingNow.filter((cycle) => !cycle.myVote).length },
    { label: "Awards you voted in", value: awards.filter((cycle) => cycle.myVote).length },
  ];

  const submitVote = async (cycle) => {
    const nomineeKey = choices[cycle.id] || "";
    const nominee = ballotOf(cycle).find((entry) => entry.key === nomineeKey);

    if (!nominee) {
      return;
    }

    const changing = Boolean(cycle.myVote);
    const confirmation = await Swal.fire({
      title: changing ? "Change your vote?" : "Submit your vote?",
      text: `Vote for ${nominee.name} for ${cycle.category}? You can change your vote until ${
        cycle.phase === "voting" ? "HR closes the voting" : `voting closes on ${formatMoment(cycle.closesOn)}`
      }.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: changing ? "Change vote" : "Submit vote",
      confirmButtonColor: "#D61E1E",
      cancelButtonText: "Cancel",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setSubmittingId(cycle.id);

    try {
      const result = await castAwardVote({ cycleId: cycle.id, nomineeKey });
      await loadCycles();
      setChoices((current) => {
        const { [cycle.id]: _submitted, ...rest } = current;
        return rest;
      });
      toast.success(result?.message || "Your vote has been recorded.");
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to record your vote.");
      // The ballot may have moved on (voting closed, say) — show the server's current state.
      void loadCycles();
    } finally {
      setSubmittingId("");
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight text-slate-950">Award Voting</h2>
          <p className="m-0 text-sm text-slate-500">
            Vote for the colleagues HR approved as nominees. The nominee with the most votes wins the award.
          </p>
        </div>
        <PortalButton size="sm" variant="ghost" onClick={() => void loadCycles()}>
          Refresh
        </PortalButton>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      {!loading && !canCastVote ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Only accounts with the Employee role can vote. You can still follow the ballots and results here.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <CardSkeleton className="h-64 w-full" />
          <CardSkeleton className="h-32 w-full" />
        </div>
      ) : awards.length === 0 ? (
        <PortalEmptyState
          title="No award voting yet"
          description="As soon as HR approves a nominee for an award, they will appear here for you to vote on, and you will be notified."
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <SectionHeading title="Vote now" description="Pick one nominee for each award." />
            {votingNow.length === 0 ? (
              <PortalEmptyState
                title="No nominees to vote on right now"
                description="You'll be notified as soon as HR approves a nominee for the next award."
                className="py-10"
              />
            ) : (
              <div className="space-y-4">
                {votingNow.map((cycle) => (
                  <BallotCard
                    key={cycle.id}
                    cycle={cycle}
                    viewerEmployeeRecordId={viewerEmployeeRecordId}
                    canCastVote={canCastVote}
                    selected={choices[cycle.id] || ""}
                    submitting={submittingId === cycle.id}
                    onSelect={(nomineeKey) => setChoices((current) => ({ ...current, [cycle.id]: nomineeKey }))}
                    onSubmit={() => void submitVote(cycle)}
                  />
                ))}
              </div>
            )}
          </section>

          {waiting.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading title="Coming up" description="Open awards with no approved nominees yet." />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {waiting.map((cycle) => (
                  <WaitingCard key={cycle.id} cycle={cycle} />
                ))}
              </div>
            </section>
          ) : null}

          {results.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading title="Results" description="Final counts, shown once voting has closed." />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {results.map((cycle) => (
                  <ResultCard key={cycle.id} cycle={cycle} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
