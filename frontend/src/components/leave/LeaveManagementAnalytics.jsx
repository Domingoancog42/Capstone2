import React, { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCountUp } from "../../module/reports/reportsTheme";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import {
  formatDateDisplay,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";

const STATUS_META = [
  { key: "pending", label: "Pending", color: "#f6c453" },
  { key: "approved", label: "Approved", color: "#22b981" },
  { key: "rejected", label: "Rejected", color: "#fb4d57" },
  { key: "cancelled", label: "Cancelled", color: "#64748b" },
];

/*
 * The trend's bars, in legend order. They take their colors from STATUS_META so a status wears the
 * same color here as in the status chart beside it. Amber and green sit below 3:1 on white, so the
 * legend labels, the tooltip, and the screen-reader table carry the meaning, never color alone.
 */
const TREND_SERIES = ["approved", "pending", "rejected"]
  .map((key) => STATUS_META.find((item) => item.key === key));

const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const longMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });

/*
 * The request types the status chart can switch between. Leave reads the `requests` the whole panel
 * is built from; the others read `statusRequests[key]`. Every type's approval stages normalize to
 * the same four outcomes, so one set of bars fits them all.
 */
export const STATUS_SOURCES = [
  { key: "leave", label: "Leave", title: "Leave Requests by Status" },
  { key: "travel", label: "Travel Order", title: "Travel Orders by Status" },
  { key: "cto", label: "CTO", title: "CTO Requests by Status" },
  { key: "overtime", label: "Overtime", title: "Overtime Requests by Status" },
];

function parseRequestDate(request) {
  const rawValue = request?.dateFiled || request?.requestedAt || request?.requested_at;

  if (!rawValue) return null;

  const dateOnlyMatch = String(rawValue).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parsed = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(rawValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameMonth(date, year, month) {
  return date?.getFullYear() === year && date?.getMonth() === month;
}

function openStatus(status) {
  return ["Pending", "Endorsed", "Reviewed", "Chief Reviewed"].includes(normalizeLeaveStatus(status));
}

function approvedRequestTimestamp(request) {
  const rawValue = request?.approvedAt
    || request?.updatedAt
    || request?.requestedAt
    || request?.requested_at
    || request?.dateFiled;
  const timestamp = rawValue ? new Date(rawValue).getTime() : 0;

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function filedThisMonth(records, now) {
  return records.filter((request) =>
    isSameMonth(parseRequestDate(request), now.getFullYear(), now.getMonth())
  );
}

/* Every approval stage short of the final signature counts as pending. */
function countStatuses(records) {
  const countStatus = (matcher) => records.filter((request) => matcher(request.status)).length;

  return {
    pending: countStatus(openStatus),
    approved: countStatus((status) => normalizeLeaveStatus(status) === "Approved"),
    rejected: countStatus((status) => normalizeLeaveStatus(status) === "Rejected"),
    cancelled: countStatus((status) => normalizeLeaveStatus(status) === "Cancelled"),
  };
}

/** The status chart's bars for any request type filed this month. */
export function buildMonthlyStatusRows(records = [], now = new Date()) {
  const counts = countStatuses(filedThisMonth(records, now));
  return STATUS_META.map((item) => ({ ...item, count: counts[item.key] }));
}

/**
 * One row per month from January through the current one, counting that month's filings by
 * outcome. Every stage short of the final signature is pending; cancelled filings are left out.
 */
export function buildLeaveTrendRows(requests = [], now = new Date()) {
  const year = now.getFullYear();
  const currentMonth = now.getMonth();
  const rows = Array.from({ length: currentMonth + 1 }, (_, month) => ({
    label: shortMonthFormatter.format(new Date(year, month, 1)),
    month: longMonthFormatter.format(new Date(year, month, 1)),
    approved: 0,
    pending: 0,
    rejected: 0,
  }));

  requests.forEach((request) => {
    const filed = parseRequestDate(request);

    if (!filed || filed.getFullYear() !== year || filed.getMonth() > currentMonth) return;

    const status = normalizeLeaveStatus(request.status);
    const row = rows[filed.getMonth()];

    if (status === "Approved") row.approved += 1;
    else if (status === "Rejected") row.rejected += 1;
    else if (openStatus(status)) row.pending += 1;
  });

  return rows;
}

export function buildLeaveManagementAnalytics(requests = [], now = new Date()) {
  const currentRecords = filedThisMonth(requests, now);
  const currentStatusCounts = countStatuses(currentRecords);
  const trendRows = buildLeaveTrendRows(requests, now);
  const firstMonth = trendRows[0].month;
  const lastMonth = trendRows[trendRows.length - 1].month;

  const approvedLeaveEmployees = [];
  const listedEmployeeIds = new Set();

  requests
    .filter((request) => normalizeLeaveStatus(request.status) === "Approved")
    .sort((left, right) =>
      approvedRequestTimestamp(right) - approvedRequestTimestamp(left)
        || Number(right.id || 0) - Number(left.id || 0)
    )
    .forEach((request) => {
      const employeeKey = String(
        request.employeeRecordId
          || request.employeeId
          || request.employeeName
          || request.rowKey
          || request.id
      );

      if (!listedEmployeeIds.has(employeeKey)) {
        listedEmployeeIds.add(employeeKey);
        approvedLeaveEmployees.push(request);
      }
    });

  return {
    monthLabel: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(now),
    total: currentRecords.length,
    pending: currentStatusCounts.pending,
    approved: currentStatusCounts.approved,
    rejected: currentStatusCounts.rejected,
    approvedEmployees: approvedLeaveEmployees.length,
    trendRows,
    trendRangeLabel: firstMonth === lastMonth
      ? `${firstMonth} ${now.getFullYear()}`
      : `${firstMonth} – ${lastMonth} ${now.getFullYear()}`,
    hasTrendData: trendRows.some((row) => row.approved + row.pending + row.rejected > 0),
    statusRows: STATUS_META.map((item) => ({ ...item, count: currentStatusCounts[item.key] })),
    approvedLeaveEmployees,
  };
}

function AnimatedValue({ value }) {
  const animatedValue = useCountUp(value, 700, true);
  return <>{Math.round(animatedValue).toLocaleString()}</>;
}

function MetricCard({ metric, index, loading, reduceMotion }) {
  const Icon = metric.icon;

  if (loading) {
    return (
      <div className="flex min-h-[112px] items-center rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex w-full animate-pulse items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />
          <div className="flex-1">
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-2 h-6 w-14 rounded bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reduceMotion ? undefined : { y: -4 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="group relative flex min-h-[112px] h-full items-center overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow duration-300 hover:shadow-lg"
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 ${metric.lineTone}`} />
      <div className="flex w-full items-center gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${metric.iconTone}`}>
          <Icon size={20} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="m-0 truncate text-[11px] font-semibold leading-4 text-slate-600" title={metric.label}>
            {metric.label}
          </p>
          <strong className="mt-1 block text-2xl font-bold leading-7 text-slate-950 tabular-nums">
            <AnimatedValue value={metric.value} />
          </strong>
        </div>
      </div>
    </motion.article>
  );
}

/* `aside` sits opposite the title — the trend's legend goes there. */
function ChartPanel({ title, subtitle, icon: Icon, aside, children, index, reduceMotion, className = "" }) {
  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: 0.18 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className={`min-h-[280px] rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="m-0 flex items-center gap-1.5 text-sm font-bold text-slate-900">
            {Icon ? <Icon size={16} className="shrink-0 text-blue-700" aria-hidden="true" /> : null}
            {title}
          </h3>
          {subtitle ? <p className="m-0 mt-1 text-[11px] text-slate-500">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </motion.article>
  );
}

function TrendLegend() {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-[11px] text-slate-600">
      {TREND_SERIES.map((series) => (
        <li key={series.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} aria-hidden="true" />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

/* The values and labels stay in text colors; only the swatch carries the series color. */
function TrendTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-[132px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] shadow-lg">
      <p className="m-0 font-semibold text-slate-900">{payload[0].payload.month}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="mt-1 flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
          <span className="flex-1">{entry.name}</span>
          <span className="font-semibold text-slate-900 tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function getEmployeeInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function EmployeeAvatar({ employee, size = "h-9 w-9" }) {
  const imageUrl = resolveBackendAssetUrl(employee?.profileImage);

  return (
    <div className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-full bg-blue-50 text-xs font-bold text-blue-600`}>
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      ) : getEmployeeInitials(employee?.employeeName)}
    </div>
  );
}

function formatLeaveDateRange(startDate, endDate) {
  if (!startDate && !endDate) return "Dates unavailable";
  if (!startDate || !endDate || startDate === endDate) {
    return formatDateDisplay(startDate || endDate);
  }
  return `${formatDateDisplay(startDate)} - ${formatDateDisplay(endDate)}`;
}

function EmployeeRow({ employee, index }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
      <EmployeeAvatar employee={employee} index={index} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-xs font-semibold text-slate-900">{employee.employeeName}</p>
        <p className="m-0 mt-0.5 truncate text-[10px] text-slate-500">{employee.leaveType}</p>
        <p className="m-0 mt-0.5 text-[10px] text-slate-400">
          {formatLeaveDateRange(employee.startDate, employee.endDate)}
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">
        Approved
      </span>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="min-h-[280px] animate-pulse rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="h-4 w-36 rounded bg-slate-200" />
      <div className="mt-5 h-48 rounded-lg bg-slate-100" />
    </div>
  );
}

function StatusSourceSwitch({ value, onChange }) {
  return (
    <div
      role="group"
      aria-label="Request type"
      className="mt-3 inline-flex max-w-full flex-wrap gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5"
    >
      {STATUS_SOURCES.map((source) => (
        <button
          key={source.key}
          type="button"
          aria-pressed={value === source.key}
          onClick={() => onChange(source.key)}
          className={`min-h-7 rounded-full px-2.5 text-[11px] font-semibold transition ${
            value === source.key
              ? "bg-white text-[#D61E1E] shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {source.label}
        </button>
      ))}
    </div>
  );
}

/**
 * `statusRequests` carries the travel order, CTO, and overtime records for the status chart, keyed
 * as in STATUS_SOURCES; `statusLoading` covers only those, so the leave panels never wait on them.
 *
 * `referenceDate` is any day in the month the panels report on — the dashboard's month filter.
 * The monthly figures cover that month and the trend runs from January up to it. Left out, it is
 * today.
 */
export default function LeaveManagementAnalytics({
  requests = [],
  loading = false,
  statusRequests = {},
  statusLoading = false,
  referenceDate,
}) {
  const reduceMotion = useReducedMotion();
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [statusSource, setStatusSource] = useState("leave");
  const analytics = useMemo(
    () => buildLeaveManagementAnalytics(requests, referenceDate),
    [referenceDate, requests]
  );
  const activeStatusSource = STATUS_SOURCES.find((source) => source.key === statusSource) || STATUS_SOURCES[0];
  const statusRows = useMemo(() => (
    statusSource === "leave"
      ? analytics.statusRows
      : buildMonthlyStatusRows(statusRequests[statusSource] || [], referenceDate)
  ), [analytics.statusRows, referenceDate, statusRequests, statusSource]);
  const statusChartLoading = statusSource !== "leave" && statusLoading;
  const metrics = [
    {
      label: "Total Requests",
      value: analytics.total,
      icon: ClipboardList,
      iconTone: "bg-blue-50 text-blue-600",
      lineTone: "bg-blue-500",
    },
    {
      label: "Rejected",
      value: analytics.rejected,
      icon: XCircle,
      iconTone: "bg-rose-50 text-rose-500",
      lineTone: "bg-rose-500",
    },
  ];

  return (
    <section aria-label="Leave request analytics" className="space-y-3">
      <div className="grid auto-rows-fr items-stretch gap-3 sm:grid-cols-2">
        {metrics.map((metric, index) => (
          <MetricCard
            key={metric.label}
            metric={metric}
            index={index}
            loading={loading}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3 xl:grid-cols-[1.7fr_1fr_1fr]">
          <LoadingPanel />
          <LoadingPanel />
          <LoadingPanel />
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[1.7fr_1fr_1fr]">
          <ChartPanel
            title="Leave Requests Trend"
            subtitle={analytics.trendRangeLabel}
            icon={BarChart3}
            aside={<TrendLegend />}
            index={0}
            reduceMotion={reduceMotion}
          >
            {!analytics.hasTrendData ? (
              <div className="grid min-h-[210px] place-items-center text-center text-xs text-slate-400">
                <div><CalendarClock className="mx-auto mb-2" size={28} /><p className="m-0">No leave requests filed in {analytics.trendRangeLabel}.</p></div>
              </div>
            ) : (
              <>
                {/* Keyboard users step the tooltip with the arrow keys; the table below is the text version. */}
                <div className="mt-3 h-[218px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analytics.trendRows}
                      barGap={2}
                      barCategoryGap="22%"
                      margin={{ top: 8, right: 4, bottom: 4, left: -24 }}
                    >
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="label" axisLine={{ stroke: "#cbd5e1" }} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                      <Tooltip cursor={{ fill: "#f8fafc" }} content={<TrendTooltip />} />
                      {TREND_SERIES.map((series) => (
                        <Bar
                          key={series.key}
                          dataKey={series.key}
                          name={series.label}
                          fill={series.color}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={16}
                          isAnimationActive={!reduceMotion}
                          animationDuration={850}
                          animationEasing="ease-out"
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="sr-only">
                  <caption>Leave requests filed each month, {analytics.trendRangeLabel}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      {TREND_SERIES.map((series) => <th key={series.key} scope="col">{series.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.trendRows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.month}</th>
                        {TREND_SERIES.map((series) => <td key={series.key}>{row[series.key]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </ChartPanel>

          <ChartPanel
            title={activeStatusSource.title}
            subtitle={analytics.monthLabel}
            index={1}
            reduceMotion={reduceMotion}
          >
            <StatusSourceSwitch value={statusSource} onChange={setStatusSource} />
            {statusChartLoading ? (
              <div className="mt-3 h-[196px] animate-pulse rounded-lg bg-slate-100" aria-label="Loading requests" />
            ) : (
              <div className="mt-3 h-[196px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusRows} margin={{ top: 20, right: 4, bottom: 4, left: -24 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" axisLine={{ stroke: "#cbd5e1" }} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <Tooltip cursor={{ fill: "#f8fafc" }} formatter={(value) => [`${value} request${value === 1 ? "" : "s"}`, "Total"]} />
                    <Bar
                      dataKey="count"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={48}
                      isAnimationActive={!reduceMotion}
                      animationDuration={850}
                      animationEasing="ease-out"
                    >
                      <LabelList dataKey="count" position="top" fill="#334155" fontSize={10} fontWeight={700} />
                      {statusRows.map((item) => <Cell key={item.key} fill={item.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartPanel>

          <ChartPanel
            title="Employees with Approved Leave"
            index={2}
            reduceMotion={reduceMotion}
            className="relative"
          >
            {analytics.approvedLeaveEmployees.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllEmployees(true)}
                className="absolute right-4 top-4 text-[10px] font-semibold text-blue-600 transition-colors hover:text-blue-800"
              >
                View All
              </button>
            ) : null}
            <div className="mt-3">
              {analytics.approvedLeaveEmployees.length === 0 ? (
                <div className="grid min-h-[200px] place-items-center text-center text-xs text-slate-400">
                  <div><UsersRound className="mx-auto mb-2" size={28} /><p className="m-0">No employees have approved leave.</p></div>
                </div>
              ) : analytics.approvedLeaveEmployees.slice(0, 3).map((employee, index) => (
                <motion.div
                  key={employee.rowKey || employee.id}
                  initial={reduceMotion ? false : { opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.34 + index * 0.08 }}
                >
                  <EmployeeRow employee={employee} index={index} />
                </motion.div>
              ))}
            </div>
          </ChartPanel>
        </div>
      )}

      <AnimatePresence>
        {showAllEmployees ? (
          <motion.div
            className="fixed inset-0 z-[120] grid place-items-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-label="Employees with approved leave"
          >
            <button
              type="button"
              aria-label="Close employees on leave"
              className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
              onClick={() => setShowAllEmployees(false)}
            />
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 max-h-[82vh] w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h3 className="m-0 text-base font-bold text-slate-900">Employees with Approved Leave</h3>
                  <p className="m-0 mt-1 text-xs text-slate-500">{analytics.approvedEmployees} employee{analytics.approvedEmployees === 1 ? "" : "s"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllEmployees(false)}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="max-h-[65vh] overflow-y-auto px-5 py-2">
                {analytics.approvedLeaveEmployees.map((employee, index) => (
                  <EmployeeRow key={`${employee.rowKey || employee.id}-all`} employee={employee} index={index} />
                ))}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
