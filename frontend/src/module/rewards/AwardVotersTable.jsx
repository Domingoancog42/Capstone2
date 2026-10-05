import React, { useMemo, useState } from "react";
import Table from "../../components/UI/table";
import { NomineeAvatar } from "./AwardCyclePrimitives";
import { buildEmployeeLookup, formatDateTime, tallyNominations, voteLabel } from "./awardCycleUtils";

/**
 * Who voted, and for whom — the ballot of a cycle as a plain listing.
 *
 * The standings say who won; this says how it got there. It is the same record the detail screen
 * shows under "All nominations", trimmed to what fits beside the final results: no search, no
 * pagination, just the nominee filter, because a closed cycle is read to answer "who voted for the
 * winner" rather than browsed.
 *
 * A voter photo is shown only when the account is explicitly linked to an employee record. User ids
 * and employee ids may share a number while belonging to different people, so they cannot be mixed.
 */
export default function AwardVotersTable({ nominations = [], employees = [] }) {
  const [nomineeFilter, setNomineeFilter] = useState("");

  const lookup = useMemo(() => buildEmployeeLookup(employees), [employees]);
  // Built off the tally so the filter lists every nominee once, in the order they placed.
  const nomineeOptions = useMemo(() => tallyNominations(nominations), [nominations]);

  // Newest first, so the list reads as the order the votes came in.
  const ordered = useMemo(
    () =>
      [...(Array.isArray(nominations) ? nominations : [])].sort((a, b) =>
        String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")),
      ),
    [nominations],
  );

  const rows = useMemo(
    () =>
      nomineeFilter
        ? ordered.filter((nomination) => String(nomination.nomineeKey || nomination.nomineeName) === nomineeFilter)
        : ordered,
    [nomineeFilter, ordered],
  );

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const columns = [
    {
      key: "voterName",
      header: "Voter",
      cardRole: "title",
      render: (row) => {
        const voterEmployee = row.voterEmployeeKey
          ? lookup.get(String(row.voterEmployeeKey))
          : null;

        return (
          <span className="flex items-center gap-2.5">
            {voterEmployee ? (
              <NomineeAvatar
                employee={voterEmployee}
                name={row.voterName}
                className="h-8 w-8 border border-slate-200 text-[11px]"
              />
            ) : null}
            <span className="font-semibold text-slate-900">{row.voterName || "—"}</span>
          </span>
        );
      },
    },
    {
      key: "nomineeName",
      header: "Voted for",
      render: (row) => <span className="text-slate-600">{row.nomineeName || "—"}</span>,
    },
    {
      key: "reason",
      header: "Reason",
      cellClassName: "max-w-[220px]",
      cardFull: true,
      render: (row) =>
        row.reason ? (
          <span className="block break-words text-slate-600">{row.reason}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "createdAt",
      header: "Date",
      render: (row) => <span className="whitespace-nowrap text-slate-400">{formatDateTime(row.createdAt) || "—"}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-slate-500">
          {nomineeFilter
            ? `${voteLabel(rows.length)} for ${nomineeOptions.find((entry) => entry.key === nomineeFilter)?.name || "this nominee"}`
            : voteLabel(ordered.length)}
        </p>
        {nomineeOptions.length > 1 ? (
          <select
            value={nomineeFilter}
            onChange={(event) => setNomineeFilter(event.target.value)}
            aria-label="Filter voters by nominee"
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All nominees</option>
            {nomineeOptions.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name} ({entry.votes})
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* Plain container for the card grid on a phone, framed box for the table from `sm` up. */}
      <div className="sm:overflow-hidden sm:rounded-2xl sm:border sm:border-slate-200">
        <Table
          columns={columns}
          data={rows}
          rowKey="id"
          minWidthClassName="min-w-[520px]"
          cardsClassName="sm:hidden"
          tableWrapperClassName="hidden sm:block"
          tableClassName="[&_tbody_tr:last-child>td]:border-b-0"
          emptyMessage={
            nomineeFilter ? "Nobody voted for this nominee." : "Voting closed without a single nomination."
          }
        />
      </div>
    </div>
  );
}
