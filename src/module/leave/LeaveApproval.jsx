import React from "react";
import LeaveStatusBadge from "../../components/leave/LeaveStatusBadge";

export default function LeaveApproval({ pendingRequests = [] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="m-0 text-base font-semibold text-slate-900">Pending Approvals</h3>
      <p className="m-0 mt-1 text-sm text-slate-500">
        Requests waiting for reviewer action.
      </p>

      <div className="mt-4 space-y-2">
        {pendingRequests.length === 0 ? (
          <p className="m-0 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500">
            No pending leave requests right now.
          </p>
        ) : (
          pendingRequests.slice(0, 5).map((request) => (
            <div
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              <div>
                <p className="m-0 text-sm font-semibold text-slate-900">{request.employeeName}</p>
                <p className="m-0 text-xs text-slate-500">{request.leaveType} • {request.division}</p>
              </div>
              <LeaveStatusBadge status={request.status} rejectedByRole={request.rejectedByRole} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
