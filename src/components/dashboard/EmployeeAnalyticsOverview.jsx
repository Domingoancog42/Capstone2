import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Hourglass,
  Plane,
  Timer,
  Trophy,
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
import { fetchAwardCycles } from "../../services/api";
import { fetchAttendanceRecords } from "../../services/attendanceService";
import {
  fetchCompensatoryCreditBalance,
  fetchCompensatoryRequests,
} from "../../services/compensatoryService";
import { fetchLeaveCredits, fetchLeaveRequests } from "../../services/leaveService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchPassSlips } from "../../services/passSlipService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import {
  formatDateDisplay,
  getStatusBadgeClasses,
  isPendingRequestStatus,
  leaveCreditMatchesGender,
  matchesUserRecordScope,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { numberFormatter } from "../../utils/format";
import { getRoleLabel } from "../../utils/roleRoutes";

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
 * Leave credits used to carry eight of their own hues, keyed by leave code. The comment here
 * claimed the set cleared every gate; re-running it under `--pairs all` — which is the right
 * pairlist for a donut, where any two slices can sit side by side — showed it did not:
 * STL `#6d28d9` against VL `#1d4ed8` measured ΔE 0.3 under deuteranopia, the same colour to
 * that reader, and PL `#db2777` against FL `#e11d48` measured 6.5 unsimulated, well under the
 * 15 floor where full-colour readers start to struggle too.
 *
 * Eight series in an all-pairs form cannot be fixed by re-ordering or re-stepping — the series
 * cap is what binds, and no eight-hue palette clears all-pairs past three slots. So the form
 * changed instead: the leave balance is now a ranked bar where length carries the comparison and
 * every bar wears slot 1. That removes the need for this palette altogether rather than
 * replacing it with another one that would fail the same way.
 */

const REQUEST_SOURCES = [
  { key: "leave", label: "Leave" },
  { key: "travel", label: "Travel Order" },
  { key: "passSlip", label: "Pass Slip" },
  { key: "compensatory", label: "Compensatory" },
  { key: "overtime", label: "Overtime" },
];

/*
 * The filings an employee starts from this dashboard, in the order they are actually used. Each one
 * lands on the workspace that owns the form rather than opening a modal from here: the workspace is
 * where the balances, the filters, and the history that inform the request already live.
 */
const QUICK_ACTIONS = [
  {
    label: "File Leave",
    helper: "Vacation, sick, and other leave",
    icon: CalendarClock,
    tone: "bg-teal-50 text-teal-700 group-hover:bg-teal-100",
    path: "/employee/leave-request",
  },
  {
    label: "Travel Order",
    helper: "Request an official trip",
    icon: Plane,
    tone: "bg-sky-50 text-sky-700 group-hover:bg-sky-100",
    path: "/employee/travel-order",
  },
  {
    label: "Pass Slip",
    helper: "Step out during office hours",
    icon: Timer,
    tone: "bg-amber-50 text-amber-700 group-hover:bg-amber-100",
    path: "/employee/pass-slips",
  },
  {
    label: "Compensatory Time",
    helper: "Use earned CTO hours",
    icon: Clock3,
    tone: "bg-violet-50 text-violet-700 group-hover:bg-violet-100",
    path: "/employee/compensatory-time-off",
  },
  {
    label: "My Payslip",
    helper: "View and download payslips",
    icon: FileText,
    tone: "bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100",
    path: "/employee/payslip",
  },
  {
    label: "Monetize Leave",
    helper: "Convert credits to cash",
    icon: Wallet,
    tone: "bg-rose-50 text-rose-700 group-hover:bg-rose-100",
    /* Filed from the leave request form, under the Monetization of Leave Credits type. */
    path: "/employee/leave-request",
  },
];

const EMPTY_DATA = {
  leaveCredits: [],
  /* Gender on the employee record, which decides whether Maternity or Paternity is theirs to hold. */
  leaveCreditGender: "",
  leave: [],
  travel: [],
  passSlip: [],
  compensatory: [],
  overtime: [],
  /*
   * Compensatory overtime credits for the year in progress, counted by the server, with the date the
   * rest of them lapse. A credit is only good for the calendar year it was earned in.
   */
  cocBalance: {
    year: new Date().getFullYear(),
    earned: 0,
    used: 0,
    available: 0,
    expiresOn: "",
    daysRemaining: 0,
    expired: false,
  },
  /* Closed years that ended with credits nobody filed against — the forfeiture history. */
  cocForfeitures: [],
  attendance: [],
  awardCycles: [],
  /* The server's answer to "which of these votes is mine" — see `fetchAwardCycles`. */
  viewerKey: "",
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

/* Compensatory credits are counted in hours, never days — the CTO form spends them by the hour. */
function formatCreditHours(value) {
  return `${formatCreditValue(value)} hrs`;
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

/**
 * The one row on the dashboard that is about doing something rather than reading something. Two
 * columns on a phone so every action stays a thumb-sized target, widening to six on a desktop.
 */
function QuickActionsCard({ onNavigate }) {
  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-sm">
      <div>
        <h2 className="m-0 text-lg font-semibold text-slate-950">Quick actions</h2>
        <p className="m-0 mt-1 text-sm text-slate-500">Start a request or open a record without leaving the dashboard.</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onNavigate?.(action.path)}
              className="group flex min-h-[124px] flex-col items-start gap-2.5 rounded-2xl border border-slate-200 bg-white p-3.5 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${action.tone}`}>
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight text-slate-900">{action.label}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{action.helper}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * How loud the countdown gets. Credits nobody can lose — a zero balance — never raise their voice
 * however few days are left; the warning is about hours that are about to be forfeited, not about
 * the calendar. The last month is amber and the last week is red, which is roughly the notice an
 * employee needs to get a filing through review before the year closes.
 */
function resolveExpiryTone(daysRemaining, available) {
  if (available <= 0) {
    return {
      wrap: "border-slate-100 bg-slate-50/60",
      label: "text-slate-500",
      value: "text-slate-700",
    };
  }

  if (daysRemaining <= 7) {
    return {
      wrap: "border-rose-200 bg-rose-50",
      label: "text-rose-700",
      value: "text-rose-800",
    };
  }

  if (daysRemaining <= 30) {
    return {
      wrap: "border-amber-200 bg-amber-50",
      label: "text-amber-700",
      value: "text-amber-800",
    };
  }

  return {
    wrap: "border-slate-100 bg-slate-50/60",
    label: "text-slate-500",
    value: "text-slate-800",
  };
}

/**
 * The compensatory overtime credits this employee holds, in the three figures the CTO form itself
 * checks against: earned is every approved overtime row — rendered overtime plus what HR posted by
 * hand — used is the filings still holding their hours (a pending request has already spoken for
 * them), and available is what is left to spend.
 *
 * All three are for one calendar year, because that is how long a credit lasts. The countdown says
 * how much of that year is left, and the history below it names the years that closed with credits
 * still on them — those hours were forfeited on 31 December and the balance restarted at zero.
 */
function OvertimeCreditsCard({ balance, forfeitures = [], loading, onNavigate }) {
  const creditYear = balance?.year || new Date().getFullYear();
  const available = Number(balance?.available) || 0;
  const daysRemaining = Number(balance?.daysRemaining) || 0;
  const expiryTone = resolveExpiryTone(daysRemaining, available);

  const breakdown = [
    { label: "Earned", value: formatCreditHours(balance?.earned), helper: `Approved overtime credited in ${creditYear}` },
    { label: "Used", value: formatCreditHours(balance?.used), helper: "Spent or held by open CTO filings" },
  ];

  return (
    <section className="flex flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 p-4">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold text-slate-950">Overtime Credits</h2>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Compensatory overtime credits you can still spend on time off in {creditYear}.
          </p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
          <Clock3 size={18} aria-hidden="true" />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {loading ? (
          <div className="h-[150px] animate-pulse rounded-2xl bg-slate-100" />
        ) : (
          <>
            <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-700">
                Available in {creditYear}
              </p>
              <p className="m-0 mt-1 text-3xl font-semibold leading-none text-slate-900">
                {formatCreditValue(available)}
                <span className="ml-1.5 text-sm font-semibold text-slate-500">hours</span>
              </p>
            </div>

            {/* How long the credits above have left before they lapse. */}
            <div className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${expiryTone.wrap}`}>
              <Hourglass size={16} className={`shrink-0 ${expiryTone.label}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className={`m-0 text-sm font-semibold ${expiryTone.value}`}>
                  {daysRemaining === 0
                    ? "Credits have expired"
                    : `${numberFormatter.format(daysRemaining)} day${daysRemaining === 1 ? "" : "s"} left to use them`}
                </p>
                <p className={`m-0 mt-0.5 text-xs leading-5 ${expiryTone.label}`}>
                  {available > 0
                    ? `Unused credits are forfeited on ${formatDateDisplay(balance?.expiresOn)}.`
                    : `Credits expire ${formatDateDisplay(balance?.expiresOn)} and the balance restarts at zero.`}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {breakdown.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{item.label}</p>
                  <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-900">{item.value}</p>
                  <p className="m-0 mt-1 text-xs leading-5 text-slate-500">{item.helper}</p>
                </div>
              ))}
            </div>

            {/* Only shown to someone who has actually lost credits — otherwise it is noise. */}
            {forfeitures.length > 0 ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Expired / Forfeited
                </p>
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {forfeitures.map((entry) => (
                    <li key={entry.year} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{entry.year} credits</span>
                        <span className="block text-xs leading-5 text-slate-500">
                          Lapsed {formatDateDisplay(entry.expiredOn)} · {formatCreditHours(entry.earned)} earned,{" "}
                          {formatCreditHours(entry.used)} used
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                        -{formatCreditHours(entry.forfeited)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        <button
          type="button"
          onClick={() => onNavigate?.("/employee/compensatory-time-off")}
          className="mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
        >
          File compensatory time off
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
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
                  {request.tracksStatus ? (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${getStatusBadgeClasses(request.status)}`}>
                      {normalizeLeaveStatus(request.status)}
                    </span>
                  ) : null}
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
        cocBalanceResult,
        overtimeResult,
        attendanceResult,
        awardCycleResult,
      ] = await Promise.allSettled([
        fetchLeaveCredits(),
        fetchLeaveRequests(),
        fetchTravelOrders(),
        fetchPassSlips(),
        fetchCompensatoryRequests(),
        /*
         * The employee endpoint answers for the signed-in account whatever id is asked for, so the
         * balance here is always their own. Taken from the server rather than summed from the
         * request lists above: it is the same figure the CTO form validates against, and only the
         * server knows which filings still hold their hours.
         */
        fetchCompensatoryCreditBalance(0),
        fetchOvertimeRequests(),
        fetchAttendanceRecords(),
        fetchAwardCycles(),
      ]);

      /*
       * Every list is filtered to this employee even when its endpoint normally applies the same
       * session scope. The attendance chart must never turn an unexpectedly broad API response
       * into an organization-wide total on one employee's dashboard.
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
        leaveCreditGender: creditResult.status === "fulfilled"
          ? String(creditResult.value?.credits?.gender ?? "")
          : "",
        leave: ownRecords(leaveResult, "requests"),
        travel: ownRecords(travelResult, "requests"),
        passSlip: ownRecords(passSlipResult, "records"),
        compensatory: ownRecords(compensatoryResult, "records"),
        cocBalance: cocBalanceResult.status === "fulfilled" && cocBalanceResult.value?.balance
          ? cocBalanceResult.value.balance
          : EMPTY_DATA.cocBalance,
        cocForfeitures: cocBalanceResult.status === "fulfilled" && Array.isArray(cocBalanceResult.value?.forfeitures)
          ? cocBalanceResult.value.forfeitures
          : [],
        overtime: ownRecords(overtimeResult, "records"),
        attendance: ownRecords(attendanceResult, "records"),
        // Award cycles are the same for everybody, so there is nothing to scope to this user here —
        // `viewerKey` is what tells their own vote apart from the rest.
        awardCycles: awardCycleResult.status === "fulfilled" && Array.isArray(awardCycleResult.value?.cycles)
          ? awardCycleResult.value.cycles
          : [],
        viewerKey: awardCycleResult.status === "fulfilled" ? String(awardCycleResult.value?.viewerKey ?? "") : "",
      });

      const failed = [
        creditResult,
        leaveResult,
        travelResult,
        passSlipResult,
        compensatoryResult,
        cocBalanceResult,
        overtimeResult,
        attendanceResult,
        awardCycleResult,
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
    // Overtime and compensatory are here for the credit balance: approving overtime earns it,
    // filing time off spends it, and neither passes through the leave topics.
    topics: ["leave_request", "leave_credit", "attendance", "rewards", "overtime", "compensatory"],
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
          /*
           * Pass slips have no approval step and so no status of any kind — the column is gone from
           * the table. The flag is needed rather than just a null status because
           * normalizeLeaveStatus() answers "Pending" for anything it does not recognise, which is
           * exactly how a record with nothing to approve ended up wearing a Pending badge here.
           */
          tracksStatus: key !== "passSlip",
          status: key === "passSlip" ? null : record.status,
          filedDate,
          timestamp: filedDate ? filedDate.getTime() : 0,
        };
      })
    ))
  ), [data]);

  const requestStats = useMemo(() => {
    const now = new Date();
    // Only the request types that are actually approved by someone can be approved or pending;
    // counting a pass slip as pending would leave a number nobody can ever clear.
    const approved = allRequests.filter((request) => request.tracksStatus && normalizeLeaveStatus(request.status) === "Approved").length;
    const pending = allRequests.filter((request) => request.tracksStatus && isPendingRequestStatus(request.status)).length;
    const filedThisMonth = allRequests.filter((request) => (
      request.filedDate
      && request.filedDate.getFullYear() === now.getFullYear()
      && request.filedDate.getMonth() === now.getMonth()
    )).length;

    return { total: allRequests.length, approved, pending, filedThisMonth };
  }, [allRequests]);

  /*
   * Award cycles still open that this employee has not voted in — the one number about nominations
   * they can act on. Cycles they have already voted in are not counted: the vote can still be
   * changed, but nothing is waiting on them. The list endpoint leaves archived cycles out entirely.
   */
  const openNominations = useMemo(() => (
    data.awardCycles.filter((cycle) => (
      cycle?.status !== "closed"
      && !cycle?.isArchived
      && !(Array.isArray(cycle?.nominations) ? cycle.nominations : []).some(
        (nomination) => String(nomination?.voterKey ?? "") === data.viewerKey && data.viewerKey !== ""
      )
    )).length
  ), [data.awardCycles, data.viewerKey]);

  /*
   * Remaining and Used are built from the same balances, so the two views of the leave balance
   * always agree. Zero-value types are dropped — an empty bar is only noise — and so is whichever
   * of Maternity and Paternity this employee's gender rules out, which is never an entitlement
   * they can spend. Sorted by size, since the chart is now a ranking.
   */
  const leaveCreditSlices = useMemo(() => {
    const ownBalances = data.leaveCredits.filter(
      (balance) => leaveCreditMatchesGender(balance, data.leaveCreditGender)
    );
    const buildSlices = (field) => ownBalances
      .map((balance) => ({
        name: balance.type || balance.code || "Leave",
        value: Number(balance[field]) || 0,
      }))
      .filter((slice) => slice.value > 0)
      .sort((left, right) => right.value - left.value);

    return { remaining: buildSlices("remaining"), used: buildSlices("used") };
  }, [data.leaveCredits, data.leaveCreditGender]);

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
      if (!request.tracksStatus) {
        return;
      }

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
      // The leave figure this slot used to hold is still on the screen, in full, in the Leave
      // Balance donut below — this card is the one thing on the dashboard asking to be acted on.
      label: "Nominations To Vote",
      value: numberFormatter.format(openNominations),
      icon: Trophy,
      accent: "from-rose-500 via-rose-600 to-red-500",
      iconTone: "bg-gradient-to-br from-rose-500 to-red-600",
      glow: "bg-rose-200",
      onClick: () => onNavigate?.("/employee/nominate"),
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
        position={user?.position || user?.designation || "Not assigned"}
        role={getRoleLabel(user?.role || user?.roleKey || "employee")}
        division={user?.division || user?.department || "Not assigned"}
        imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat, index) => (
          <AdminStatCard key={stat.label} stat={stat} index={index} />
        ))}
      </section>

      <QuickActionsCard onNavigate={onNavigate} />

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
          form="bar"
        />
        {/* The other balance an employee carries, stacked over their filings in the same column. */}
        <div className="grid content-start gap-4">
          <OvertimeCreditsCard
            balance={data.cocBalance}
            forfeitures={data.cocForfeitures}
            loading={loading}
            onNavigate={onNavigate}
          />
          <RecentRequestsCard requests={latestRequests} loading={loading} onNavigate={onNavigate} />
        </div>
      </section>
    </div>
  );
}
