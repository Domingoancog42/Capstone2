import React, { useEffect, useState } from "react";
import { FolderSync, Wallet } from "lucide-react";
import ProfileFloatingCard from "../profile/ProfileFloatingCard";
import { fetchLeaveBalanceHistory } from "../../services/leaveCreditService";

function formatBalanceValue(value) {
  const numericValue = Number(value) || 0;
  return numericValue.toFixed(2).replace(/\.00$/, "");
}

function formatDateTime(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const SNAPSHOT_HEADERS = ["Leave Type", "Total", "Used", "Remaining", "Updated"];

/**
 * The "Current Leave Credit Snapshot" table: one row per leave credit with its total, used, and
 * remaining days. Shared by the Leave Balances history modal and the leave request desk's
 * View Leave Balances action, so both read the same numbers the same way.
 */
export default function LeaveCreditSnapshot({ snapshot = [], fallbackUpdatedAt = "", loading = false }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <FolderSync size={16} />
        <span>Current Leave Credit Snapshot</span>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                {SNAPSHOT_HEADERS.map((header) => (
                  <th key={header} className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <tr key={index} className="animate-pulse border-b border-slate-100">
                    <td colSpan={SNAPSHOT_HEADERS.length} className="px-3 py-3">
                      <div className="h-4 rounded bg-slate-200" />
                    </td>
                  </tr>
                ))
              ) : snapshot.length === 0 ? (
                <tr>
                  <td colSpan={SNAPSHOT_HEADERS.length} className="px-4 py-10 text-center text-sm text-slate-500">
                    No leave credit snapshot is available yet.
                  </td>
                </tr>
              ) : snapshot.map((item) => (
                <tr key={item.code} className="border-b border-slate-100">
                  <td className="px-3 py-3 text-sm font-semibold text-slate-900">{item.type}</td>
                  <td className="px-3 py-3 text-sm text-slate-700">{formatBalanceValue(item.total)}</td>
                  <td className="px-3 py-3 text-sm text-slate-700">{formatBalanceValue(item.used)}</td>
                  <td className="px-3 py-3 text-sm text-slate-700">{formatBalanceValue(item.remaining)}</td>
                  <td className="px-3 py-3 text-sm text-slate-500">{formatDateTime(item.updatedAt || fallbackUpdatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * One employee's current leave credit snapshot in a floating card, loaded when it opens. HR Staff
 * open it from a leave request row to check the filer's balances while verifying the request.
 */
export function LeaveCreditSnapshotModal({ open = false, employeeRecordId = null, employeeName = "", onClose }) {
  const [state, setState] = useState({ loading: false, error: "", year: null, snapshot: [] });

  useEffect(() => {
    if (!open || !employeeRecordId) {
      return undefined;
    }

    let active = true;
    setState({ loading: true, error: "", year: null, snapshot: [] });

    fetchLeaveBalanceHistory(employeeRecordId)
      .then((result) => {
        if (active) {
          setState({
            loading: false,
            error: "",
            year: result?.history?.year || null,
            snapshot: result?.history?.snapshot || [],
          });
        }
      })
      .catch((error) => {
        if (active) {
          setState({
            loading: false,
            error: error?.response?.data?.message || error?.message || "Unable to load leave balances.",
            year: null,
            snapshot: [],
          });
        }
      });

    return () => {
      active = false;
    };
  }, [employeeRecordId, open]);

  const year = state.year || new Date().getFullYear();

  return (
    <ProfileFloatingCard
      open={open}
      onClose={onClose}
      title="Leave Balances"
      subtitle={`${employeeName || "This employee"}'s leave credits for ${year}.`}
      icon={Wallet}
      maxWidth="max-w-[760px]"
    >
      {state.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
          <p className="m-0 text-sm font-semibold text-rose-800">Unable to load leave balances.</p>
          <p className="m-0 mt-1 text-sm text-rose-700">{state.error}</p>
        </div>
      ) : (
        <LeaveCreditSnapshot snapshot={state.snapshot} loading={state.loading} />
      )}
    </ProfileFloatingCard>
  );
}
