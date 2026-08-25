import React from "react";
import { NomineeAvatar } from "./AwardCyclePrimitives";
import { buildEmployeeLookup, voteLabel } from "./awardCycleUtils";

/**
 * The closed-cycle result: the top three on a podium instead of a table.
 *
 * A ranked table is the right shape while votes are still moving, but the outcome is the point once
 * voting closes — so the winner gets the centre column, the photo, and the size.
 */

const MEDALS = ["🥇", "🥈", "🥉"];

// #1 sits in the middle on a wide screen and first on a narrow one, so the podium reads as a podium
// without hiding the winner below the runner-up on mobile.
const PODIUM_ORDER = ["order-1 sm:order-2", "order-2 sm:order-1", "order-3"];

function jobTitle(employee) {
  return String(
    employee?.position || employee?.designationTitle || employee?.department || employee?.division || "",
  ).trim();
}

function PodiumCard({ entry, employee, featured, orderClass }) {
  const title = jobTitle(employee);

  return (
    <article
      className={`flex flex-col items-center rounded-2xl p-4 text-center ${orderClass} ${
        featured
          ? "border-2 border-[#F8BFBF] bg-gradient-to-b from-[#FEF1F1] to-white shadow-md"
          : "border border-slate-200 bg-white shadow-sm sm:mt-8"
      }`}
    >
      {featured ? (
        <span className="inline-flex items-center rounded-full bg-[#D61E1E] px-3 py-1 text-xs font-semibold text-white">
          Best Employee
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
          #{entry.rank}
        </span>
      )}

      <div className="relative mt-4">
        <NomineeAvatar
          employee={employee}
          name={entry.name}
          className={
            featured
              ? "h-24 w-24 border border-[#F8BFBF] text-lg ring-4 ring-[#D61E1E]/10"
              : "h-20 w-20 border border-slate-200 text-xl ring-4 ring-white"
          }
        />
        <span
          className="absolute -bottom-2 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-slate-200 bg-white text-base shadow-sm"
          aria-hidden="true"
        >
          {MEDALS[entry.rank - 1]}
        </span>
      </div>

      <h4 className={`m-0 mt-5 font-semibold text-slate-900 ${featured ? "text-lg" : "text-base"}`}>{entry.name}</h4>
      <p className="m-0 mt-0.5 min-h-[1.25rem] text-xs text-slate-500">{title}</p>

      <p className={`m-0 mt-4 font-semibold leading-none ${featured ? "text-lg text-[#D61E1E]" : "text-xl text-slate-900"}`}>
        {entry.votes}
      </p>
      <p className="m-0 mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {entry.votes === 1 ? "Vote" : "Votes"}
      </p>
    </article>
  );
}

export default function AwardCyclePodium({ leaderboard = [], employees = [] }) {
  if (leaderboard.length === 0) {
    return (
      <p className="m-0 px-5 py-12 text-center text-sm text-slate-500">
        This nomination closed without any submissions.
      </p>
    );
  }

  const lookup = buildEmployeeLookup(employees);
  const podium = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  return (
    <div className="px-5 pb-4 pt-2">
      <div className="grid items-start gap-4 sm:grid-cols-3">
        {podium.map((entry, index) => (
          <PodiumCard
            key={entry.key}
            entry={entry}
            employee={lookup.get(String(entry.key))}
            featured={entry.rank === 1}
            orderClass={PODIUM_ORDER[index] || "order-3"}
          />
        ))}
      </div>

      {rest.length > 0 ? (
        <p className="m-0 mt-6 border-t border-slate-100 pt-4 text-center text-xs leading-5 text-slate-500">
          Also nominated: {rest.map((entry) => `${entry.name} (${voteLabel(entry.votes)})`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
