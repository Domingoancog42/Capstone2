import React from "react";
import { LEAVE_TYPES } from "../../data/leaveTypes";

function toBalanceRows(balanceMap = {}) {
  return LEAVE_TYPES.slice(0, 5).map((type) => ({
    type,
    remaining: Number(balanceMap[type]) || 0,
  }));
}

export default function LeaveBalance({ balanceMap = {} }) {
  const rows = toBalanceRows(balanceMap);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="m-0 text-base font-semibold text-slate-900">Leave Balance</h3>
      <p className="m-0 mt-1 text-sm text-slate-500">
        Remaining leave credits by leave type.
      </p>

      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <div
            key={row.type}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
          >
            <span className="text-sm text-slate-700">{row.type}</span>
            <span className="text-sm font-semibold text-slate-900">
              {row.remaining} days
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
