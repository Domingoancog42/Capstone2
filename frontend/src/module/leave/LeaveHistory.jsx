import React from "react";
import LeaveStatusBadge from "../../components/leave/LeaveStatusBadge";
import { formatDateDisplay, formatDurationLabel } from "../../utils/leaveHelpers";

export default function LeaveHistory({ requests = [] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="m-0 text-base font-semibold text-slate-900">Leave History</h3>
      <p className="m-0 mt-1 text-sm text-slate-500">
        Snapshot of recent requests and outcomes.
      </p>

      <div className="mt-4 space-y-2">
        {requests.length === 0 ? (
          <p className="m-0 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500">
            No leave history records yet.
          </p>
        ) : (
          requests.slice(0, 6).map((request) => (
            <article
              key={request.id}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-slate-900">{request.leaveType}</strong>
                <LeaveStatusBadge status={request.status} />
              </div>
              <p className="m-0 mt-1 text-xs text-slate-600">
                {formatDateDisplay(request.startDate)} - {formatDateDisplay(request.endDate)} •{" "}
                {formatDurationLabel(request.numberOfDays)}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
