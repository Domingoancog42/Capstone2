import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card, { CardContent } from "../UI/card";
import AnalyticsPieChart from "../chart/piechart";
import AdminStatCard from "./AdminStatCard";
import DashboardWelcomeBanner from "./DashboardWelcomeBanner";
import { useAutoRefreshOnChange } from "../auto/autorefreshdatalist";
import { fetchAttendanceRecords } from "../../services/attendanceService";
import { fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchLeaveCredits, fetchLeaveRequests } from "../../services/leaveService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchPassSlips } from "../../services/passSlipService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import {
  formatDateDisplay,
  getStatusBadgeClasses,
  isPendingRequestStatus,
  matchesUserRecordScope,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { numberFormatter } from "../../utils/format";

/*
 * Chart palettes. Both were run through the categorical validator (lightness band, chroma floor,
 * all-pairs CVD separation, normal-vision floor, contrast) rather than picked by eye, so the
 * slices stay tellable apart for deutan/protan/tritan readers.
 *
 * REQUEST_TYPE_COLORS carries one contrast warning on the lime slot, which is why the donut always
 * renders its legend with the name and count beside each swatch — identity is never colour alone.
 */
const REQUEST_TYPE_COLORS = ["#1d4ed8", "#0891b2", "#d97706", "#e11d48", "#84cc16"];
const REQUEST_STATUS_COLORS = {
  Approved: "#059669",
  Reviewed: "#2563eb",
  Pending: "#d97706",
  "Rejected / Cancelled": "#e11d48",
};
const REQUEST_ACTIVITY_COLOR = "#1d4ed8";
const ATTENDANCE_HOURS_COLOR = "#0f766e";

/*
 * Leave credits get their own eight slots because the backend tracks eight leave types. Keyed by
 * code, never by position, so a type keeps its colour when the zero-credit ones drop out of the
 * donut. The order was run through the same categorical validator against the card surface
 * (#f8fafc) and clears every gate; the lime slot carries a contrast warning, which is why the
 * legend always prints the leave name and the day count beside the swatch.
 */
const LEAVE_CREDIT_COLORS = {
  VL: "#1d4ed8",
  SL: "#0891b2",
  SPL: "#d97706",
  FL: "#e11d48",
  SOPL: "#84cc16",
  STL: "#6d28d9",
  ML: "#15803d",
  PL: "#db2777",
};
const LEAVE_CREDIT_FALLBACK_COLOR = "#64748b";

const REQUEST_SOURCES = [
  { key: "leave", label: "Leave" },
  { key: "travel", label: "Travel Order" },
  { key: "passSlip", label: "Pass Slip" },
  { key: "compensatory", label: "Compensatory" },
  { key: "overtime", label: "Overtime" },
];

const EMPTY_DATA = {
  leaveCredits: [],
  leave: [],
  travel: [],
  passSlip: [],
  compensatory: [],
  overtime: [],
  attendance: [],
};

function parseRecordDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Every request table names its filing date differently (`dateFiled` on leave and compensatory,
 * `requestDate` on overtime, `passDate` on a pass slip); this is the one place that knows the list.
 */
function resolveFiledDate(record) {
  return [
    record?.dateFiled,
    record?.requestDate,
    record?.requestedAt,
    record?.createdAt,
    record?.passDate,
    record?.startDate,
    record?.workDate,
  ]
    .map(parseRecordDate)
    .find(Boolean) || null;
}

function shortMonthLabel(index) {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(2000, index, 1));
}

function emptyMonthlySeries() {
  return Array.from({ length: 12 }, (_, index) => ({ label: shortMonthLabel(index) }));
}

function formatCreditValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "0.00";
}

function formatCreditDays(value) {
  return `${formatCreditValue(value)} days`;
}

function resolveFirstName(user) {
  const rawName = String(user?.full_name || user?.username || "Employee").trim();
  return rawName.split(/\s+/).filter(Boolean)[0] || "Employee";
}

/** Groups the Rejected and Cancelled buckets — for the person who filed, both mean "did not push through". */
function resolveDisplayStatus(status) {
  const normalized = normalizeLeaveStatus(status);
  return normalized === "Rejected" || normalized === "Cancelled" ? "Rejected / Cancelled" : normalized;
}

/*
 * Deliberately mirrors the shell of `AnalyticsPieChart` — same radius, border, and header rhythm —
 * so the three charts in the analytics row read as one set rather than three borrowed widgets.
 */
function ChartCard({ title, description, children, summary = [] }) {
  return (
    <section className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-sm transition duration-300 hover:shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-200/80 p-4">
        <h2 className="m-0 text-xl font-semibold leading-tight text-slate-900">{title}</h2>
        <p className="m-0 mt-2 text-sm leading-6 text-slate-500">{description}</p>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-4 p-4">
        {children}

        {summary.length ? (
          /* The figures the chart implies, spelled out — also the text relief the plot itself can't give. */
          <div className="grid gap-3 sm:grid-cols-2">
            {summary.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{item.label}</p>
                <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-900">{item.value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ChartEmptyState({ message }) {
  return (
    <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 text-center">
      <p className="m-0 max-w-xs text-sm text-slate-500">{message}</p>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-[220px] animate-pulse rounded-xl bg-slate-100" />;
}

function RecentRequestsCard({ requests, loading, onNavigate }) {
  return (
    <Card className="h-full">
      <CardContent className="px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="m-0 text-base font-semibold text-slate-950">Latest requests</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Your most recent filings across every request type.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.("/employee/leave-request")}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
            aria-label="Open leave requests"
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            [0, 1, 2].map((item) => (
              <div key={item} className="h-[72px] animate-pulse rounded-xl bg-slate-100" />
            ))
          ) : requests.length ? (
            requests.map((request) => (
              <div key={request.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-slate-900">{request.title}</p>
                    <p className="m-0 mt-1 truncate text-xs text-slate-500">{request.detail}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${getStatusBadgeClasses(request.status)}`}>
                    {normalizeLeaveStatus(request.status)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
              <p className="m-0 text-sm font-semibold text-slate-700">No requests yet</p>
              <p className="m-0 mt-1 text-sm text-slate-500">Anything you file shows up here.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmployeeAnalyticsOverview({ user, onNavigate }) {
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const loadDashboard = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setLoading(true);
    }

    try {
      const [
        creditResult,
        leaveResult,
        travelResult,
        passSlipResult,
        compensatoryResult,
        overtimeResult,
        attendanceResult,
      ] = await Promise.allSettled([
        fetchLeaveCredits(),
        fetchLeaveRequests(),
        fetchTravelOrders(),
        fetchPassSlips(),
        fetchCompensatoryRequests(),
        fetchOvertimeRequests(),
        fetchAttendanceRecords(),
      ]);

      /*
       * Only some of these endpoints scope by session role, so every request list is filtered to
       * this user here as well. Attendance is already scoped server-side by `attendance_scope_sql`.
       */
      const ownRecords = (result, key) => (
        result.status === "fulfilled" && Array.isArray(result.value?.[key])
          ? result.value[key].filter((record) => matchesUserRecordScope(record, user))
          : []
      );

      setData({
        leaveCredits: creditResult.status === "fulfilled" && Array.isArray(creditResult.value?.credits?.balances)
          ? creditResult.value.credits.balances
          : [],
        leave: ownRecords(leaveResult, "requests"),
        travel: ownRecords(travelResult, "requests"),
        passSlip: ownRecords(passSlipResult, "records"),
        compensatory: ownRecords(compensatoryResult, "records"),
        overtime: ownRecords(overtimeResult, "records"),
        attendance: attendanceResult.status === "fulfilled" && Array.isArray(attendanceResult.value?.records)
          ? attendanceResult.value.records
          : [],
      });

      const failed = [
        creditResult,
        leaveResult,
        travelResult,
        passSlipResult,
        compensatoryResult,
        overtimeResult,
        attendanceResult,
      ].some((result) => result.status === "rejected");

      setError(failed ? "Some dashboard data could not be loaded." : "");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  /*
   * This is the screen an employee leaves open waiting on a decision, so the refresh has to be
   * invisible: `background` keeps the cards and the charts in place while the new values load,
   * instead of blanking the dashboard every time an approver clicks something.
   */
  useAutoRefreshOnChange(loadDashboard, {
    topics: ["leave_request", "leave_credit", "attendance"],
    refreshOnMount: false,
  });

  /** One flat list of everything this employee has filed — the basis for every count and chart. */
  const allRequests = useMemo(() => (
    REQUEST_SOURCES.flatMap(({ key, label }) => (
      (data[key] || []).map((record, index) => {
        const filedDate = resolveFiledDate(record);
        let detail = "";

        switch (key) {
          case "travel":
            detail = record.destination || "Travel order";
            break;
          case "passSlip":
            detail = record.reason || record.purpose || "Pass slip";
            break;
          case "compensatory": {
            const hours = Number(record.hoursApplied);
            detail = Number.isFinite(hours) && hours > 0 ? `${hours.toFixed(2)} hours applied` : "Compensatory time off";
            break;
          }
          case "overtime": {
            const hours = Number(record.overtimeHours ?? record.hourRequested);
            detail = Number.isFinite(hours) && hours > 0 ? `${hours} hours overtime` : "Overtime request";
            break;
          }
          default:
            detail = record.leaveType || "Leave request";
        }

        return {
          id: `${key}-${record.id ?? record.requestId ?? index}`,
          type: label,
          title: key === "leave" ? (record.leaveType || "Leave Request") : label,
          detail: filedDate ? `${detail} | Filed ${formatDateDisplay(filedDate)}` : detail,
          status: record.status,
          filedDate,
          timestamp: filedDate ? filedDate.getTime() : 0,
        };
      })
    ))
  ), [data]);

  const requestStats = useMemo(() => {
    const now = new Date();
    const approved = allRequests.filter((request) => normalizeLeaveStatus(request.status) === "Approved").length;
    const pending = allRequests.filter((request) => isPendingRequestStatus(request.status)).length;
    const filedThisMonth = allRequests.filter((request) => (
      request.filedDate
      && request.filedDate.getFullYear() === now.getFullYear()
      && request.filedDate.getMonth() === now.getMonth()
    )).length;

    return { total: allRequests.length, approved, pending, filedThisMonth };
  }, [allRequests]);

  const totalRemainingCredits = useMemo(
    () => data.leaveCredits.reduce((sum, balance) => sum + (Number(balance.remaining) || 0), 0),
    [data.leaveCredits]
  );

  /*
   * Both slices of the leave donut are built from the same balances, so a leave type keeps one
   * colour whether you are looking at what is left or at what has been spent. Zero-value types are
   * dropped — an invisible slice is only noise in the legend.
   */
  const leaveCreditSlices = useMemo(() => {
    const buildSlices = (field) => data.leaveCredits
      .map((balance) => ({
        name: balance.type || balance.code || "Leave",
        value: Number(balance[field]) || 0,
        color: LEAVE_CREDIT_COLORS[String(balance.code || "").toUpperCase()] || LEAVE_CREDIT_FALLBACK_COLOR,
      }))
      .filter((slice) => slice.value > 0);

    return { remaining: buildSlices("remaining"), used: buildSlices("used") };
  }, [data.leaveCredits]);

  /* Years that actually hold data, newest first, with the current year always offered. */
  const yearOptions = useMemo(() => {
    const years = new Set([new Date().getFullYear()]);

    allRequests.forEach((request) => {
      if (request.filedDate) {
        years.add(request.filedDate.getFullYear());
      }
    });

    data.attendance.forEach((record) => {
      const date = parseRecordDate(record.date);

      if (date) {
        years.add(date.getFullYear());
      }
    });

    return Array.from(years).sort((left, right) => right - left);
  }, [allRequests, data.attendance]);

  useEffect(() => {
    if (yearOptions.length > 0 && !yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0]);
    }
  }, [selectedYear, yearOptions]);

  const requestActivity = useMemo(() => {
    const months = emptyMonthlySeries().map((month) => ({ ...month, requests: 0 }));

    allRequests.forEach((request) => {
      if (request.filedDate && request.filedDate.getFullYear() === selectedYear) {
        months[request.filedDate.getMonth()].requests += 1;
      }
    });

    return months;
  }, [allRequests, selectedYear]);
  const requestActivitySummary = useMemo(() => {
    const total = requestActivity.reduce((sum, month) => sum + month.requests, 0);
    const busiest = requestActivity.reduce(
      (best, month) => (month.requests > best.requests ? month : best),
      requestActivity[0]
    );

    return [
      { label: `Filed in ${selectedYear}`, value: `${numberFormatter.format(total)} requests` },
      { label: "Busiest month", value: busiest.requests > 0 ? `${busiest.label} (${busiest.requests})` : "None yet" },
    ];
  }, [requestActivity, selectedYear]);
  const hasRequestActivity = requestActivity.some((month) => month.requests > 0);

  const attendanceHours = useMemo(() => {
    const months = emptyMonthlySeries().map((month) => ({ ...month, hours: 0 }));

    data.attendance.forEach((record) => {
      const date = parseRecordDate(record.date);

      if (!date || date.getFullYear() !== selectedYear) {
        return;
      }

      months[date.getMonth()].hours += (Number(record.totalMinutes) || 0) / 60;
    });

    return months.map((month) => ({ ...month, hours: Math.round(month.hours * 10) / 10 }));
  }, [data.attendance, selectedYear]);
  const attendanceSummary = useMemo(() => {
    const monthsWithHours = attendanceHours.filter((month) => month.hours > 0);
    const total = attendanceHours.reduce((sum, month) => sum + month.hours, 0);
    const average = monthsWithHours.length > 0 ? total / monthsWithHours.length : 0;

    return [
      { label: `Total in ${selectedYear}`, value: `${numberFormatter.format(Math.round(total))} hours` },
      {
        label: "Monthly average",
        // Averaged over the months that actually have records, so a mid-year hire is not halved.
        value: monthsWithHours.length > 0 ? `${numberFormatter.format(Math.round(average))} hours` : "No records",
      },
    ];
  }, [attendanceHours, selectedYear]);
  const hasAttendanceHours = attendanceHours.some((month) => month.hours > 0);

  const statusPieData = useMemo(() => {
    const counts = new Map();

    allRequests.forEach((request) => {
      const status = resolveDisplayStatus(request.status);
      counts.set(status, (counts.get(status) || 0) + 1);
    });

    return Object.keys(REQUEST_STATUS_COLORS)
      .filter((status) => counts.get(status) > 0)
      .map((status) => ({
        name: status,
        value: counts.get(status),
        color: REQUEST_STATUS_COLORS[status],
      }));
  }, [allRequests]);

  const typePieData = useMemo(() => (
    REQUEST_SOURCES
      .map(({ label }, index) => ({
        name: label,
        value: allRequests.filter((request) => request.type === label).length,
        // Fixed slot per request type, never cycled, so a type keeps its colour as counts change.
        color: REQUEST_TYPE_COLORS[index],
      }))
      .filter((slice) => slice.value > 0)
  ), [allRequests]);

  const latestRequests = useMemo(
    () => [...allRequests].sort((left, right) => right.timestamp - left.timestamp).slice(0, 4),
    [allRequests]
  );

  const yearSelect = (
    <select
      aria-label="Select analytics year"
      value={selectedYear}
      onChange={(event) => setSelectedYear(Number(event.target.value))}
      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
    >
      {yearOptions.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </select>
  );

  const statCards = [
    {
      label: "My Requests",
      value: numberFormatter.format(requestStats.total),
      icon: ClipboardList,
      accent: "from-indigo-500 via-sky-600 to-cyan-500",
      iconTone: "bg-gradient-to-br from-indigo-500 to-sky-600",
      glow: "bg-indigo-200",
      onClick: () => onNavigate?.("/employee/leave-request"),
    },
    {
      label: "Pending",
      value: numberFormatter.format(requestStats.pending),
      icon: Clock3,
      accent: "from-amber-400 via-amber-500 to-orange-500",
      iconTone: "bg-gradient-to-br from-amber-400 to-orange-500",
      glow: "bg-amber-200",
      onClick: () => onNavigate?.("/employee/leave-request"),
    },
    {
      label: "Approved",
      value: numberFormatter.format(requestStats.approved),
      icon: CheckCircle2,
      accent: "from-emerald-500 via-emerald-600 to-lime-500",
      iconTone: "bg-gradient-to-br from-emerald-500 to-lime-600",
      glow: "bg-emerald-200",
      onClick: () => onNavigate?.("/employee/calendar"),
    },
    {
      label: "Leave Credits Left",
      value: formatCreditValue(totalRemainingCredits),
      icon: Wallet,
      accent: "from-teal-500 via-teal-600 to-emerald-500",
      iconTone: "bg-gradient-to-br from-teal-500 to-emerald-600",
      glow: "bg-teal-200",
      onClick: () => onNavigate?.("/employee/leave-request"),
    },
  ];

  return (
    <div className="w-full space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      <DashboardWelcomeBanner
        name={resolveFirstName(user)}
        subtitle={user?.designation || user?.division || "Employee workspace"}
        imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat, index) => (
          <AdminStatCard key={stat.label} stat={stat} index={index} />
        ))}
      </section>

      <section className="space-y-4">
        {/* One filter row above the charts — both trend charts read the same year. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">My analytics</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">
              Your own filing activity, request mix, and rendered hours.
            </p>
          </div>
          {yearSelect}
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <ChartCard
            title="My Request Activity"
            description={`Requests you filed each month in ${selectedYear}.`}
            summary={loading || !hasRequestActivity ? [] : requestActivitySummary}
          >
            {loading ? (
              <ChartSkeleton />
            ) : hasRequestActivity ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={requestActivity} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="employeeRequestFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={REQUEST_ACTIVITY_COLOR} stopOpacity={0.26} />
                        <stop offset="95%" stopColor={REQUEST_ACTIVITY_COLOR} stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                    <Tooltip
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }}
                      formatter={(value) => [numberFormatter.format(value), "Requests filed"]}
                      contentStyle={{ borderRadius: 12, borderColor: "#cbd5e1", fontSize: 12 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="requests"
                      name="Requests filed"
                      stroke={REQUEST_ACTIVITY_COLOR}
                      strokeWidth={2}
                      fill="url(#employeeRequestFill)"
                      dot={{ r: 4, fill: "#ffffff", stroke: REQUEST_ACTIVITY_COLOR, strokeWidth: 2 }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartEmptyState message={`You have not filed any request in ${selectedYear} yet.`} />
            )}
          </ChartCard>

          <AnalyticsPieChart
            title="My Requests Breakdown"
            description="How your filings split by status and by request type."
            datasets={[
              {
                id: "by-status",
                label: "By Status",
                shortLabel: "Status",
                description: "Where your filings currently stand.",
                centerLabel: "Requests",
                data: statusPieData,
              },
              {
                id: "by-type",
                label: "By Type",
                shortLabel: "Type",
                description: "Which kinds of request you file most.",
                centerLabel: "Requests",
                data: typePieData,
              },
            ]}
            loading={loading}
            emptyMessage="File a leave, travel order, pass slip, compensatory, or overtime request to populate this chart."
            compactLegend
            className="h-full"
          />

          <ChartCard
            title="Attendance Hours Rendered"
            description={`Hours recorded on your daily time records in ${selectedYear}.`}
            summary={loading || !hasAttendanceHours ? [] : attendanceSummary}
          >
            {loading ? (
              <ChartSkeleton />
            ) : hasAttendanceHours ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={attendanceHours} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="employeeAttendanceFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={ATTENDANCE_HOURS_COLOR} stopOpacity={0.24} />
                        <stop offset="95%" stopColor={ATTENDANCE_HOURS_COLOR} stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      stroke="#64748b"
                      tickFormatter={(value) => `${value}h`}
                    />
                    <Tooltip
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }}
                      formatter={(value) => [`${numberFormatter.format(value)} hours`, "Hours rendered"]}
                      contentStyle={{ borderRadius: 12, borderColor: "#cbd5e1", fontSize: 12 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="hours"
                      name="Hours rendered"
                      stroke={ATTENDANCE_HOURS_COLOR}
                      strokeWidth={2}
                      fill="url(#employeeAttendanceFill)"
                      dot={{ r: 4, fill: "#ffffff", stroke: ATTENDANCE_HOURS_COLOR, strokeWidth: 2 }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartEmptyState message={`No attendance was recorded against your record in ${selectedYear}.`} />
            )}
          </ChartCard>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <AnalyticsPieChart
          title="Leave Balance"
          description="Your leave credits for the current year."
          datasets={[
            {
              id: "remaining",
              label: "Remaining",
              shortLabel: "Remaining",
              description: "Days still available on each leave type.",
              centerLabel: "Remaining",
              valueFormatter: formatCreditDays,
              data: leaveCreditSlices.remaining,
            },
            {
              id: "used",
              label: "Used",
              shortLabel: "Used",
              description: "Days already consumed on each leave type.",
              centerLabel: "Used",
              valueFormatter: formatCreditDays,
              data: leaveCreditSlices.used,
            },
          ]}
          loading={loading}
          emptyMessage="Your leave balance appears here once HR sets up your credits."
          compactLegend
          className="h-full"
        />
        <RecentRequestsCard requests={latestRequests} loading={loading} onNavigate={onNavigate} />
      </section>
    </div>
  );
}
