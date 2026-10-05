import React, { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  LoaderCircle,
  Sparkles,
  UserRoundMinus,
  X,
  XCircle,
} from "lucide-react";
import LeaveStatusBadge from "./LeaveStatusBadge";
import {
  formatDateDisplay,
  formatDurationLabel,
  getInitials,
} from "../../utils/leaveHelpers";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

function SummaryCard({ title, value, helper, icon: Icon, gradient }) {
  return (
    <article className="group rounded-2xl border border-white/50 bg-white/70 p-4 shadow-sm backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="m-0 mt-2 text-lg font-bold text-slate-900">{value}</p>
          <p className="m-0 mt-1 text-xs text-slate-500">{helper}</p>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-xl text-white shadow ${gradient}`}>
          <Icon size={20} />
        </div>
      </div>
    </article>
  );
}

function SummaryCardSkeleton() {
  return (
    <article className="animate-pulse rounded-2xl border border-slate-200 bg-white/75 p-4">
      <div className="h-3 w-24 rounded bg-slate-200" />
      <div className="mt-3 h-7 w-14 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-40 rounded bg-slate-200" />
    </article>
  );
}

const avatarTone = [
  "from-sky-500 to-cyan-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-indigo-500 to-blue-500",
  "from-rose-500 to-pink-500",
];

function DistributionBars({ title, icon: Icon, rows = [], loading = false, emptyLabel = "No data available." }) {
  const maxValue = Math.max(...rows.map((row) => row.count), 0);

  return (
    <article className="rounded-2xl border border-white/40 bg-white/80 p-5 shadow-sm backdrop-blur">
      <div className="mb-4 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700">
          <Icon size={18} />
        </div>
        <h3 className="m-0 text-base font-semibold text-slate-900">{title}</h3>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="animate-pulse">
              <div className="mb-1 h-3 w-28 rounded bg-slate-200" />
              <div className="h-2.5 w-full rounded bg-slate-200" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-600">{row.label}</span>
                <span className="text-slate-500">{row.count}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 to-sky-500 transition-all duration-500"
                  style={{ width: `${maxValue > 0 ? (row.count / maxValue) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function OnLeaveEmployeeCard({ employee, index, roleKey = "" }) {
  const profileImageUrl = resolveBackendAssetUrl(employee.profileImage);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div
          className={`grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-gradient-to-br text-sm font-bold text-white ${avatarTone[index % avatarTone.length]}`}
        >
          {profileImageUrl ? (
            <img
              src={profileImageUrl}
              alt={employee.employeeName}
              className="h-full w-full object-cover"
            />
          ) : (
            getInitials(employee.employeeName)
          )}
        </div>
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-slate-900">
            {employee.employeeName}
          </p>
          <p className="m-0 truncate text-xs text-slate-500">{employee.division}</p>
        </div>
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500">Leave Type</dt>
          <dd className="m-0 font-semibold text-slate-700">{employee.leaveType}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500">Duration</dt>
          <dd className="m-0 font-semibold text-slate-700">
            {formatDateDisplay(employee.startDate)} - {formatDateDisplay(employee.endDate)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500">Days</dt>
          <dd className="m-0 font-semibold text-slate-700">
            {formatDurationLabel(employee.numberOfDays)}
          </dd>
        </div>
      </dl>

      <LeaveStatusBadge
        status={employee.status}
        startDate={employee.startDate}
        endDate={employee.endDate}
        roleKey={roleKey}
        className="mt-3"
      />
    </article>
  );
}

export default function LeaveCards({
  summary,
  onLeaveEmployees = [],
  statusBreakdown = [],
  divisionBreakdown = [],
  loading = false,
  roleKey = "",
}) {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [viewAllLoading, setViewAllLoading] = useState(false);
  const viewAllTimerRef = useRef(null);

  useEffect(() => () => {
    if (viewAllTimerRef.current) {
      window.clearTimeout(viewAllTimerRef.current);
    }
  }, []);

  const handleOpenViewAll = () => {
    if (viewAllTimerRef.current) {
      window.clearTimeout(viewAllTimerRef.current);
    }

    setViewAllOpen(true);
    setViewAllLoading(true);

    viewAllTimerRef.current = window.setTimeout(() => {
      setViewAllLoading(false);
      viewAllTimerRef.current = null;
    }, 550);
  };

  const handleCloseViewAll = () => {
    if (viewAllTimerRef.current) {
      window.clearTimeout(viewAllTimerRef.current);
      viewAllTimerRef.current = null;
    }

    setViewAllLoading(false);
    setViewAllOpen(false);
  };

  const summaryCards = [
    {
      key: "total",
      title: "Total Leave Requests",
      value: summary.total,
      helper: "All submitted requests",
      icon: ClipboardList,
      gradient: "bg-gradient-to-br from-slate-700 to-slate-900",
    },
    {
      key: "pending",
      title: "Balance Verification",
      value: summary.pending,
      helper: "Waiting for HR Staff to verify the leave balance",
      icon: Clock3,
      gradient: "bg-gradient-to-br from-amber-500 to-orange-500",
    },
    {
      key: "endorsed",
      title: "Pending HR Head Approval",
      value: summary.endorsed || 0,
      helper: "Leave balance verified",
      icon: LoaderCircle,
      gradient: "bg-gradient-to-br from-indigo-500 to-blue-500",
    },
    {
      key: "reviewed",
      title: "Pending Chief Admin Review",
      value: summary.reviewed || 0,
      helper: "HR Head approved",
      icon: LoaderCircle,
      gradient: "bg-gradient-to-br from-sky-500 to-cyan-500",
    },
    {
      key: "chiefReviewed",
      title: "Pending Regional Director Approval",
      value: summary.chiefReviewed || 0,
      helper: "Chief Admin reviewed",
      icon: LoaderCircle,
      gradient: "bg-gradient-to-br from-violet-500 to-indigo-500",
    },
    {
      key: "approved",
      title: "Approved Leaves",
      value: summary.approved,
      helper: "Already approved",
      icon: CheckCircle2,
      gradient: "bg-gradient-to-br from-emerald-500 to-teal-500",
    },
    {
      key: "rejected",
      title: "Rejected Leaves",
      value: summary.rejected,
      helper: "Denied requests",
      icon: XCircle,
      gradient: "bg-gradient-to-br from-rose-500 to-red-500",
    },
    {
      key: "onleave",
      title: "Employees On Leave",
      value: summary.onLeave,
      helper: "Currently on leave today",
      icon: UserRoundMinus,
      gradient: "bg-gradient-to-br from-sky-500 to-indigo-500",
    },
  ];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {loading
          ? Array.from({ length: 8 }).map((_, index) => <SummaryCardSkeleton key={index} />)
          : summaryCards.map((card) => <SummaryCard key={card.key} {...card} />)}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <article className="rounded-2xl border border-white/40 bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700">
                <Sparkles size={18} />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-slate-900">Employees Currently On Leave</h3>
                <p className="m-0 text-xs text-slate-500">Real-time visibility for coverage planning.</p>
              </div>
            </div>
            {!loading && onLeaveEmployees.length > 0 ? (
              <button
                type="button"
                onClick={handleOpenViewAll}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
              >
                View All
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="animate-pulse rounded-2xl border border-slate-200 p-4">
                  <div className="h-10 w-10 rounded-full bg-slate-200" />
                  <div className="mt-3 h-4 w-36 rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-28 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          ) : onLeaveEmployees.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
              <p className="m-0 text-sm font-semibold text-slate-700">No employees are currently on leave.</p>
              <p className="m-0 mt-1 text-sm text-slate-500">Once leave dates become active, they will appear here.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {onLeaveEmployees.map((employee, index) => (
                <OnLeaveEmployeeCard key={employee.id} employee={employee} index={index} roleKey={roleKey} />
              ))}
            </div>
          )}
        </article>

        <div className="grid gap-4">
          <DistributionBars
            title="Leave Status Distribution"
            icon={BarChart3}
            rows={statusBreakdown}
            loading={loading}
            emptyLabel="No status records found."
          />
          <DistributionBars
            title="Division Leave Distribution"
            icon={Building2}
            rows={divisionBreakdown}
            loading={loading}
            emptyLabel="No division records found."
          />
        </div>
      </section>

      {viewAllOpen ? (
        <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close currently on leave modal"
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={handleCloseViewAll}
          />

          <div className="relative z-10 flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/25 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
              <div>
                <h3 className="m-0 text-lg font-semibold text-slate-950">Employees Currently On Leave</h3>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  {onLeaveEmployees.length} employee{onLeaveEmployees.length === 1 ? "" : "s"} currently on approved leave.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseViewAll}
                className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-50 p-5 sm:p-4">
              {viewAllLoading ? (
                <div className="grid min-h-[320px] place-items-center rounded-2xl border border-slate-200 bg-white">
                  <div className="text-center">
                    <LoaderCircle className="mx-auto animate-spin text-teal-600" size={32} />
                    <p className="m-0 mt-3 text-sm font-semibold text-slate-800">Loading employees on leave...</p>
                    <p className="m-0 mt-1 text-sm text-slate-500">Preparing the current leave roster.</p>
                  </div>
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto pr-1">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {onLeaveEmployees.map((employee, index) => (
                      <OnLeaveEmployeeCard key={`${employee.id}-modal`} employee={employee} index={index} roleKey={roleKey} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
