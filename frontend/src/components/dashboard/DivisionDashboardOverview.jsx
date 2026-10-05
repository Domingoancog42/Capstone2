import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { faEye } from "@fortawesome/free-solid-svg-icons";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Ellipsis,
  Plane,
  Search,
  UserRound,
  Users,
  UserRoundCheck,
} from "lucide-react";
import ActionIconButton from "../UI/ActionIconButton";
import ActionsMenu from "../UI/ActionsMenu";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../UI/card";
import Table from "../UI/table";
import AdminStatCard from "./AdminStatCard";
import DashboardWelcomeBanner from "./DashboardWelcomeBanner";
import DashboardLeaveManagementAnalytics from "./DashboardLeaveManagementAnalytics";
import ProfileFloatingCard from "../profile/ProfileFloatingCard";
import TeamEmployeeProfile from "../employee/TeamEmployeeProfile";
import {
  DistributionPieChart,
  RankedBarChart,
  TrendLineChart,
  useAnalyticsTheme,
} from "../analytics/analyticsChartKit";
import { useAutoRefreshOnChange } from "../auto/autorefreshdatalist";
import { getEmployees } from "../../services/api";
import { fetchCompensatoryCreditBalance } from "../../services/compensatoryService";
import { fetchLeaveRequests } from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { getRoleLabel } from "../../utils/roleRoutes";
import {
  formatDateDisplay,
  getDurationDays,
  getInitials,
  getStatusBadgeClasses,
  isCurrentDateWithin,
  isPendingRequestStatus,
  matchesUserEmployeeOption,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";
import { numberFormatter } from "../../utils/format";

/**
 * The dashboard shared by the Chief and Planning Officer workspaces.
 *
 * The Chief supervises one division, so by default this shows that division and nothing else. The
 * Planning Officer is an organization-wide desk (travel dispatch for every division), so it mounts
 * this with `organizationWide` and the same rosters and KPIs cover every employee instead. Either
 * way it deliberately does *not* mount `RoleAnalyticsOverview`: that panel is the HR/Admin view —
 * payroll expense, org-wide headcount growth, the division share pie, and the workforce demographic
 * cards — none of which these desks act on, and payroll in particular is HR's alone. What replaces
 * it is the two rosters these desks actually work from: who they oversee, and what leave and
 * travel those people have filed.
 *
 * Division scoping happens here rather than in the API: the employee endpoint is unscoped, so the
 * roster is filtered against the signed-in user's division name the same way `TeamOverview` does
 * it. The leave and travel lists arrive already scoped to what the role may see, and are narrowed
 * to the division again here for the Chief.
 */

const DASHBOARD_REFRESH_TOPICS = ["employee", "leave_request", "travel_order", "compensatory", "overtime", "user"];
const UPCOMING_WINDOW_DAYS = 30;

/*
 * Chart slots are named, never taken from array position, so a series that goes empty does not
 * repaint the ones beside it. Leave and Travel keep slots 0 and 1 on the trend line; the outcome
 * pie keeps 0/1/2 — the only three the categorical order clears on a pie's all-pairs comparison
 * (see the note in `reportsTheme.js`), which is why the outcomes are bucketed down to three.
 */
const TREND_SERIES = [
  { key: "leave", label: "Leave", slot: 0 },
  { key: "travel", label: "Travel Order", slot: 1 },
];
const OUTCOME_BUCKETS = [
  { key: "approved", label: "Approved", slot: 0 },
  { key: "awaiting", label: "Awaiting approval", slot: 1 },
  { key: "declined", label: "Rejected / Cancelled", slot: 2 },
];

/* Five cards are too narrow for one row beside the sidebar until 2xl, so they sit 3 + 2 before that. */
const STAT_GRID_COLUMNS = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-3 2xl:grid-cols-5",
};

const REQUEST_TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "leave", label: "Leave" },
  { key: "travel", label: "Travel Order" },
];

const REQUEST_VIEW_FILTERS = [
  { key: "all", label: "All requests" },
  { key: "pending", label: "Awaiting approval" },
  { key: "today", label: "Out today" },
  { key: "upcoming", label: `Next ${UPCOMING_WINDOW_DAYS} days` },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function firstText(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function resolveEmployeeDivision(employee) {
  return firstText(employee?.department, employee?.division, employee?.divisionName, employee?.office);
}

function resolveRequestDivision(request) {
  return firstText(request?.division, request?.department);
}

function resolveFirstName(user) {
  const rawName = String(user?.full_name || user?.username || "User").trim();
  return rawName.split(/\s+/).filter(Boolean)[0] || "User";
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/* "YYYY-MM-DD" parsed by `new Date()` is UTC midnight, which reads as the previous day in Manila. */
function toLocalDate(value) {
  if (!value) {
    return null;
  }

  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (parts) {
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startsWithinDays(startDate, days) {
  const start = toLocalDate(startDate);

  if (!start) {
    return false;
  }

  const today = startOfToday();
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);

  return start >= today && start <= limit;
}

function searchEmployees(employees, query) {
  const search = normalizeKey(query);

  if (!search) {
    return employees;
  }

  return employees.filter((employee) => (
    [
      employee.employeeId,
      employee.fullName,
      employee.position,
      employee.email,
      employee.phone,
      employee.employmentStatus,
      employee.status,
    ]
      .filter(Boolean)
      .some((value) => normalizeKey(value).includes(search))
  ));
}

const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });

/* Compensatory credits are counted in hours, never days — the CTO form spends them by the hour. */
function formatCreditHours(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
}

function buildLeaveRow(record) {
  const status = normalizeLeaveStatus(record?.status);
  const leaveType = firstText(record?.leaveType, "Leave");
  const days = Number(record?.numberOfDays) || getDurationDays(record?.startDate, record?.endDate);

  return {
    id: `leave-${firstText(record?.id, record?.employeeName)}`,
    kind: "leave",
    typeLabel: leaveType,
    employeeName: firstText(record?.employeeName, "Employee"),
    employeeId: firstText(record?.employeeId),
    position: firstText(record?.position),
    profileImage: record?.profileImage || "",
    detail: firstText(getLeaveReasonDisplay(record?.reason, leaveType), leaveType),
    startDate: record?.startDate || "",
    endDate: record?.endDate || "",
    days,
    status,
    dateFiled: record?.dateFiled || record?.requestedAt || "",
    timestamp: toLocalDate(record?.dateFiled || record?.requestedAt)?.getTime() || 0,
  };
}

function buildTravelRow(record) {
  const status = normalizeLeaveStatus(record?.status);
  const destination = firstText(record?.destination, "No destination");
  const purpose = firstText(record?.purpose);

  return {
    id: `travel-${firstText(record?.id, record?.employeeName)}`,
    kind: "travel",
    typeLabel: "Travel Order",
    employeeName: firstText(record?.employeeName, "Employee"),
    employeeId: firstText(record?.employeeId),
    position: firstText(record?.position),
    profileImage: record?.profileImage || "",
    detail: purpose ? `${destination} — ${purpose}` : destination,
    startDate: record?.startDate || "",
    endDate: record?.endDate || "",
    days: getDurationDays(record?.startDate, record?.endDate),
    status,
    dateFiled: record?.dateFiled || record?.createdAt || "",
    timestamp: toLocalDate(record?.dateFiled || record?.createdAt)?.getTime() || 0,
  };
}

function EmployeeIdentity({ name, meta, imageUrl }) {
  const avatarUrl = resolveBackendAssetUrl(imageUrl);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-teal-600 text-xs font-bold text-white">
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span>{getInitials(name) || "E"}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-semibold text-slate-900">{name}</p>
        <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{meta || "No employee ID"}</p>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusBadgeClasses(status)}`}>
      {status}
    </span>
  );
}

function SearchField({ value, onChange, placeholder, label }) {
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      />
    </label>
  );
}

function SectionCard({ title, description, count, countLabel, action, children }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
            {numberFormatter.format(count)} {countLabel}
          </span>
          {action}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/* The card shell in `analyticsChartKit` wears the Reports module's chrome; these sit in the
 * dashboard's own `Card`, so only the empty and loading states are borrowed. */
function ChartCard({ title, description, isEmpty, emptyMessage, loading, children }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px]">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center p-4">
        {loading ? (
          <div className="h-[196px] animate-pulse rounded-xl bg-slate-100" />
        ) : isEmpty ? (
          <div className="grid h-[196px] place-items-center rounded-xl border border-dashed border-slate-200 px-4 text-center">
            <p className="m-0 text-sm font-semibold text-slate-500">{emptyMessage}</p>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function OpenModuleButton({ label, onClick }) {
  if (!onClick) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#F8BFBF] bg-[#fff5f5] px-3.5 text-sm font-semibold text-[#D61E1E] transition hover:border-[#F18E8E] hover:bg-[#FEF1F1]"
    >
      {label}
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}

export default function DivisionDashboardOverview({
  user,
  onNavigate,
  leavePath = "",
  /* Show every division's employees and requests instead of only the signed-in user's division. */
  organizationWide = false,
  showTeamDivisionSection = true,
  showTravelLeaveSection = true,
  /* The Requests Filed by Month, Leave Types Used, and Request Outcomes charts. */
  showRequestCharts = true,
  showOutTodayCard = true,
  pendingCardLabel = "Awaiting Approval",
  showApprovedCard = false,
}) {
  const [employees, setEmployees] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [travelOrders, setTravelOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [creditBalance, setCreditBalance] = useState(null);
  const [rosterQuery, setRosterQuery] = useState("");
  /* The floating roster opened from the employee count card keeps its own search. */
  const [rosterCardOpen, setRosterCardOpen] = useState(false);
  const [rosterCardQuery, setRosterCardQuery] = useState("");
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const viewingEmployeeRef = useRef(null);
  const [requestQuery, setRequestQuery] = useState("");
  const [requestType, setRequestType] = useState("all");
  const [requestView, setRequestView] = useState("all");
  const requestSectionRef = useRef(null);
  const chartTheme = useAnalyticsTheme();

  const loadDashboard = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setLoading(true);
    }

    const [employeeResult, leaveResult, travelResult] = await Promise.allSettled([
      getEmployees(),
      fetchLeaveRequests(),
      fetchTravelOrders(),
    ]);

    setEmployees(
      employeeResult.status === "fulfilled" && Array.isArray(employeeResult.value?.employees)
        ? employeeResult.value.employees
        : []
    );
    setLeaveRequests(
      leaveResult.status === "fulfilled" && Array.isArray(leaveResult.value?.requests)
        ? leaveResult.value.requests
        : []
    );
    setTravelOrders(
      travelResult.status === "fulfilled" && Array.isArray(travelResult.value?.requests)
        ? travelResult.value.requests
        : []
    );

    /* One failing endpoint degrades its own section rather than blanking the dashboard. */
    const failed = [
      employeeResult.status === "rejected" ? "employee roster" : "",
      leaveResult.status === "rejected" ? "leave requests" : "",
      travelResult.status === "rejected" ? "travel orders" : "",
    ].filter(Boolean);

    setLoadError(failed.length ? `Unable to load ${failed.join(", ")}.` : "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    viewingEmployeeRef.current = viewingEmployee;
  }, [viewingEmployee]);

  /*
   * Each floating card locks page scroll and restores it on close, re-running whenever its
   * `onClose` changes, so both handlers stay stable to keep the two stacked cards' locks in order.
   * Both cards close on Escape; with a profile open over the roster, only the profile should.
   */
  const closeRosterCard = useCallback(() => {
    if (!viewingEmployeeRef.current) {
      setRosterCardOpen(false);
    }
  }, []);
  const closeEmployeeProfile = useCallback(() => setViewingEmployee(null), []);

  useAutoRefreshOnChange(loadDashboard, {
    topics: DASHBOARD_REFRESH_TOPICS,
    refreshOnMount: false,
  });

  const divisionName = firstText(user?.division, user?.department);
  const divisionKey = normalizeKey(divisionName);
  /* What the rosters cover, for the banner and the section copy. */
  const scopeLabel = organizationWide ? "All Divisions" : divisionName;
  const hasScope = organizationWide || Boolean(divisionKey);

  /*
   * `compensatory_can_view_all()` treats every non-employee role as a supervisor, so unlike the
   * employee dashboard this endpoint will NOT default to the caller's own row — it reads the id
   * off the query string and answers for whoever is asked for. Passing 0 would return an empty
   * balance, so the signed-in user's own employee record is matched out of the roster first.
   */
  const ownEmployeeRecordId = useMemo(() => {
    const match = employees.find((employee) => matchesUserEmployeeOption(employee, user));
    return Number(match?.id) || 0;
  }, [employees, user]);

  useEffect(() => {
    if (!ownEmployeeRecordId) {
      setCreditBalance(null);
      return undefined;
    }

    let active = true;

    fetchCompensatoryCreditBalance(ownEmployeeRecordId)
      .then((result) => {
        if (active) {
          setCreditBalance(result?.balance || null);
        }
      })
      .catch(() => {
        if (active) {
          setCreditBalance(null);
        }
      });

    return () => {
      active = false;
    };
  }, [ownEmployeeRecordId]);

  const divisionEmployees = useMemo(() => {
    if (!hasScope) {
      return [];
    }

    return employees
      .filter((employee) => organizationWide || normalizeKey(resolveEmployeeDivision(employee)) === divisionKey)
      .sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")));
  }, [divisionKey, employees, hasScope, organizationWide]);

  const divisionRequests = useMemo(() => {
    if (!hasScope) {
      return [];
    }

    const inScope = (request) => organizationWide || normalizeKey(resolveRequestDivision(request)) === divisionKey;

    return [
      ...leaveRequests.filter(inScope).map(buildLeaveRow),
      ...travelOrders.filter(inScope).map(buildTravelRow),
    ].sort((left, right) => right.timestamp - left.timestamp);
  }, [divisionKey, hasScope, leaveRequests, organizationWide, travelOrders]);

  const pendingCount = useMemo(
    () => divisionRequests.filter((row) => isPendingRequestStatus(row.status)).length,
    [divisionRequests]
  );
  const approvedCount = useMemo(
    () => divisionRequests.filter((row) => row.status === "Approved").length,
    [divisionRequests]
  );
  const outTodayCount = useMemo(
    () => divisionRequests.filter(
      (row) => row.status === "Approved" && isCurrentDateWithin(row.startDate, row.endDate)
    ).length,
    [divisionRequests]
  );
  const focusRequests = useCallback((view) => {
    setRequestView(view);
    setRequestType("all");
    requestSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const statCards = [
    {
      label: organizationWide ? "Total Employees" : "Division Employees",
      value: numberFormatter.format(divisionEmployees.length),
      icon: Users,
      accent: "from-teal-500 via-teal-600 to-emerald-500",
      iconTone: "bg-gradient-to-br from-teal-500 to-emerald-600",
      glow: "bg-teal-200",
      /* Opens the roster over the dashboard rather than leaving it for the employee directory. */
      onClick: () => {
        setRosterCardQuery("");
        setRosterCardOpen(true);
      },
    },
    {
      /* Every non-final status is still open, even after the Chief or HR has signed it. */
      label: pendingCardLabel,
      value: numberFormatter.format(pendingCount),
      icon: ClipboardList,
      accent: "from-amber-400 via-amber-500 to-orange-500",
      iconTone: "bg-gradient-to-br from-amber-400 to-orange-500",
      glow: "bg-amber-200",
      onClick: showTravelLeaveSection ? () => focusRequests("pending") : undefined,
    },
    ...(showApprovedCard ? [{
      label: "Approved",
      value: numberFormatter.format(approvedCount),
      icon: CheckCircle2,
      accent: "from-emerald-400 via-green-500 to-lime-500",
      iconTone: "bg-gradient-to-br from-emerald-500 to-green-600",
      glow: "bg-emerald-200",
      onClick: showTravelLeaveSection ? () => focusRequests("approved") : undefined,
    }] : []),
    ...(showOutTodayCard ? [{
      label: "Out Today",
      value: numberFormatter.format(outTodayCount),
      icon: UserRoundCheck,
      accent: "from-rose-500 via-rose-600 to-pink-500",
      iconTone: "bg-gradient-to-br from-rose-500 to-pink-600",
      glow: "bg-rose-200",
      onClick: showTravelLeaveSection ? () => focusRequests("today") : undefined,
    }] : []),
    {
      /* The signed-in user's own compensatory overtime credits, not the division's. */
      label: "My Overtime Credits",
      value: `${formatCreditHours(creditBalance?.available)} hrs`,
      icon: Clock3,
      accent: "from-indigo-500 via-sky-600 to-cyan-500",
      iconTone: "bg-gradient-to-br from-indigo-500 to-sky-600",
      glow: "bg-indigo-200",
    },
  ];

  /* Twelve fixed months so a quiet month reads as a dip rather than vanishing from the axis. */
  const requestTrend = useMemo(() => {
    const year = new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, index) => ({
      label: shortMonthFormatter.format(new Date(year, index, 1)),
      leave: 0,
      travel: 0,
    }));

    divisionRequests.forEach((row) => {
      const filed = toLocalDate(row.dateFiled);

      if (filed && filed.getFullYear() === year) {
        months[filed.getMonth()][row.kind] += 1;
      }
    });

    return months;
  }, [divisionRequests]);

  const hasTrendData = useMemo(
    () => requestTrend.some((month) => month.leave > 0 || month.travel > 0),
    [requestTrend]
  );

  const leaveTypeRanking = useMemo(() => {
    const counts = new Map();

    divisionRequests
      .filter((row) => row.kind === "leave")
      .forEach((row) => {
        counts.set(row.typeLabel, (counts.get(row.typeLabel) || 0) + 1);
      });

    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 6);
  }, [divisionRequests]);

  const outcomeBreakdown = useMemo(() => {
    const totals = { approved: 0, awaiting: 0, declined: 0 };

    divisionRequests.forEach((row) => {
      if (isPendingRequestStatus(row.status)) {
        totals.awaiting += 1;
      } else if (row.status === "Approved") {
        totals.approved += 1;
      } else {
        totals.declined += 1;
      }
    });

    return OUTCOME_BUCKETS
      .map((bucket) => ({
        label: bucket.label,
        value: totals[bucket.key],
        color: chartTheme.series[bucket.slot],
      }))
      .filter((slice) => slice.value > 0);
  }, [chartTheme, divisionRequests]);

  const filteredEmployees = useMemo(
    () => searchEmployees(divisionEmployees, rosterQuery),
    [divisionEmployees, rosterQuery]
  );
  const rosterCardEmployees = useMemo(
    () => searchEmployees(divisionEmployees, rosterCardQuery),
    [divisionEmployees, rosterCardQuery]
  );

  const filteredRequests = useMemo(() => {
    const search = normalizeKey(requestQuery);

    return divisionRequests
      .filter((row) => requestType === "all" || row.kind === requestType)
      .filter((row) => {
        switch (requestView) {
          case "pending":
            return isPendingRequestStatus(row.status);
          case "today":
            return row.status === "Approved" && isCurrentDateWithin(row.startDate, row.endDate);
          case "upcoming":
            return row.status === "Approved" && startsWithinDays(row.startDate, UPCOMING_WINDOW_DAYS);
          case "approved":
            return row.status === "Approved";
          case "rejected":
            return row.status === "Rejected";
          default:
            return true;
        }
      })
      .filter((row) => (
        !search
        || [row.employeeName, row.employeeId, row.typeLabel, row.detail, row.status]
          .filter(Boolean)
          .some((value) => normalizeKey(value).includes(search))
      ));
  }, [divisionRequests, requestQuery, requestType, requestView]);

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const employeeColumns = useMemo(() => ([
    {
      key: "employee",
      header: "Employee",
      cardRole: "title",
      render: (row) => (
        <EmployeeIdentity
          name={row.fullName || "Unnamed employee"}
          meta={row.employeeId}
          imageUrl={row.profileImage}
        />
      ),
    },
    {
      key: "position",
      header: "Position",
      cardRole: "subtitle",
      render: (row) => (
        <span className="text-sm text-slate-700">
          {row.position || "Unassigned"}
          {row.designation ? <span className="block text-xs text-slate-500">{row.designation}</span> : null}
        </span>
      ),
    },
    {
      key: "employmentStatus",
      header: "Employment Status",
      render: (row) => (
        <span className="text-sm text-slate-700">{row.employmentStatus || "N/A"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (row) => {
        const status = firstText(row.status, "Active");
        const tone = normalizeKey(status) === "active"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

        return (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
            {status}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      /* The menu is drawn here with horizontal dots, so the table must not wrap it in its own. */
      actionMenu: false,
      render: (row) => (
        <ActionsMenu icon={Ellipsis} label={`Actions for ${row.fullName || "employee"}`}>
          <ActionIconButton
            label={`View ${row.fullName || "employee"} profile`}
            icon={faEye}
            tone="view"
            onClick={() => setViewingEmployee(row)}
          />
        </ActionsMenu>
      ),
    },
    /* `setViewingEmployee` is a setter, so it is stable and the empty dep list still holds. */
  ]), []);

  const requestColumns = useMemo(() => ([
    {
      key: "employee",
      header: "Employee",
      cardRole: "title",
      render: (row) => (
        <EmployeeIdentity
          name={row.employeeName}
          meta={row.employeeId || row.position}
          imageUrl={row.profileImage}
        />
      ),
    },
    {
      key: "type",
      header: "Request",
      cardRole: "subtitle",
      render: (row) => {
        const Icon = row.kind === "travel" ? Plane : CalendarRange;
        const tone = row.kind === "travel"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-blue-200 bg-blue-50 text-blue-700";

        return (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
            <Icon size={13} aria-hidden="true" />
            {row.typeLabel}
          </span>
        );
      },
    },
    {
      key: "detail",
      header: "Details",
      cardFull: true,
      render: (row) => (
        <p className="m-0 line-clamp-1 max-w-[18rem] text-sm text-slate-600">{row.detail || "No details provided"}</p>
      ),
    },
    {
      key: "schedule",
      header: "Schedule",
      render: (row) => (
        <div>
          <p className="m-0 whitespace-nowrap text-sm text-slate-700">
            {formatDateDisplay(row.startDate)} – {formatDateDisplay(row.endDate)}
          </p>
          <p className="m-0 mt-0.5 text-xs text-slate-500">
            {row.days} {row.days === 1 ? "day" : "days"}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (row) => <StatusPill status={row.status} />,
    },
  ]), []);

  /* Shared by the Team / Division section and the floating roster. */
  const rosterScopeDescription = organizationWide
    ? "Employees across all divisions."
    : `Employees assigned to ${divisionName || "your division"}.`;
  const employeeEmptyMessage = divisionName && !organizationWide
    ? `No employees are currently assigned to ${divisionName}.`
    : "No employees found.";

  const missingDivisionNotice = !hasScope ? (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
      This account is not linked to a division yet, so no division records can be shown.
    </div>
  ) : null;

  return (
    <div className="w-full space-y-6">
      <DashboardWelcomeBanner
        name={resolveFirstName(user)}
        position={user?.position || "Not assigned"}
        role={getRoleLabel(user?.role || user?.roleKey || "chief")}
        division={scopeLabel || "Not assigned"}
        divisionHelper={organizationWide ? "Organization-wide access" : "Your assigned division"}
        imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
        showCalendar
      />

      {loadError ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      ) : null}

      <section className={`grid gap-4 sm:grid-cols-2 ${STAT_GRID_COLUMNS[statCards.length] || STAT_GRID_COLUMNS[4]}`}>
        {statCards.map((stat, index) => (
          <AdminStatCard key={stat.label} stat={stat} index={index} />
        ))}
      </section>

      <DashboardLeaveManagementAnalytics
        user={user}
        requests={leaveRequests}
        travelOrders={travelOrders}
        loading={loading}
      />

      {showRequestCharts ? (
        <section className="grid items-stretch gap-4 lg:grid-cols-3">
          <ChartCard
            title="Requests Filed by Month"
            description={`Leave and travel orders filed across ${new Date().getFullYear()}.`}
            isEmpty={!hasTrendData}
            emptyMessage="No requests filed this year."
            loading={loading}
          >
            <TrendLineChart data={requestTrend} series={TREND_SERIES} theme={chartTheme} height={196} />
          </ChartCard>

          <ChartCard
            title="Leave Types Used"
            description={organizationWide ? "Which leave types are filed most." : "Which leave types the division files most."}
            isEmpty={leaveTypeRanking.length === 0}
            emptyMessage="No leave requests to rank yet."
            loading={loading}
          >
            <RankedBarChart
              data={leaveTypeRanking}
              theme={chartTheme}
              height={196}
              labelWidth={116}
              seriesLabel="Requests"
            />
          </ChartCard>

          <ChartCard
            title="Request Outcomes"
            description={organizationWide ? "Where every request has landed." : "Where every division request has landed."}
            isEmpty={outcomeBreakdown.length === 0}
            emptyMessage="No requests to summarise yet."
            loading={loading}
          >
            <DistributionPieChart data={outcomeBreakdown} theme={chartTheme} height={150} />
          </ChartCard>
        </section>
      ) : null}

      {showTeamDivisionSection ? (
        <SectionCard
          title={organizationWide ? "Employees" : "Team / Division"}
          description={rosterScopeDescription}
          count={filteredEmployees.length}
          countLabel={filteredEmployees.length === 1 ? "employee" : "employees"}
        >
          {missingDivisionNotice}

          <SearchField
            value={rosterQuery}
            onChange={setRosterQuery}
            label={organizationWide ? "Search employees" : "Search division employees"}
            placeholder="Search employee, position, or email"
          />

          <div className="lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
            <Table
              columns={employeeColumns}
              data={filteredEmployees}
              rowKey="id"
              loading={loading}
              loadingRows={4}
              stickyHeader
              className="max-h-[300px] overflow-y-auto"
              minWidthClassName="min-w-[620px]"
              emptyMessage={employeeEmptyMessage}
              cardsClassName="lg:hidden"
              tableWrapperClassName="hidden lg:block"
            />
          </div>
        </SectionCard>
      ) : null}

      {showTravelLeaveSection ? (
        <div ref={requestSectionRef}>
          <SectionCard
            title="Travel & Leave"
            description={
              organizationWide
                ? "Leave requests and travel orders filed across all divisions."
                : `Leave requests and travel orders filed by ${divisionName || "your division"}.`
            }
            count={filteredRequests.length}
            countLabel={filteredRequests.length === 1 ? "request" : "requests"}
            action={
              <OpenModuleButton
                label="Leave Management"
                onClick={leavePath && onNavigate ? () => onNavigate(leavePath) : undefined}
              />
            }
          >
            {missingDivisionNotice}

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 p-1">
                {REQUEST_TYPE_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setRequestType(filter.key)}
                    className={`min-h-8 rounded-full px-3.5 text-sm font-semibold transition ${
                      requestType === filter.key
                        ? "bg-white text-[#D61E1E] shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="sr-only" htmlFor="division-request-view">
                  Filter requests
                </label>
                <select
                  id="division-request-view"
                  value={requestView}
                  onChange={(event) => setRequestView(event.target.value)}
                  className="h-9 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                >
                  {REQUEST_VIEW_FILTERS.map((filter) => (
                    <option key={filter.key} value={filter.key}>
                      {filter.label}
                    </option>
                  ))}
                </select>

                <SearchField
                  value={requestQuery}
                  onChange={setRequestQuery}
                  label="Search leave and travel requests"
                  placeholder="Search employee, type, or details"
                />
              </div>
            </div>

            <div className="lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
              <Table
                columns={requestColumns}
                data={filteredRequests}
                rowKey="id"
                loading={loading}
                loadingRows={4}
                stickyHeader
                className="max-h-[320px] overflow-y-auto"
                minWidthClassName="min-w-[820px]"
                emptyMessage={
                  hasScope
                    ? "No leave requests or travel orders match this filter."
                    : "No requests found."
                }
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
              />
            </div>
          </SectionCard>
        </div>
      ) : null}

      <ProfileFloatingCard
        open={rosterCardOpen}
        onClose={closeRosterCard}
        title={organizationWide ? "Total Employees" : "Division Employees"}
        subtitle={rosterScopeDescription}
        icon={Users}
        maxWidth="max-w-[860px]"
        closeLabel={organizationWide ? "Close employees" : "Close division employees"}
      >
        <div className="space-y-4">
          {missingDivisionNotice}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchField
              value={rosterCardQuery}
              onChange={setRosterCardQuery}
              label={organizationWide ? "Search employees" : "Search division employees"}
              placeholder="Search employee, position, or email"
            />
            <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
              {numberFormatter.format(rosterCardEmployees.length)} {rosterCardEmployees.length === 1 ? "employee" : "employees"}
            </span>
          </div>

          <div className="lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
            <Table
              columns={employeeColumns}
              data={rosterCardEmployees}
              rowKey="id"
              loading={loading}
              loadingRows={4}
              stickyHeader
              className="max-h-[60vh] overflow-y-auto"
              minWidthClassName="min-w-[620px]"
              emptyMessage={employeeEmptyMessage}
              cardsClassName="lg:hidden"
              tableWrapperClassName="hidden lg:block"
            />
          </div>
        </div>
      </ProfileFloatingCard>

      {/* Rendered after the roster card so it stacks above it when opened from there. */}
      <ProfileFloatingCard
        open={Boolean(viewingEmployee)}
        onClose={closeEmployeeProfile}
        title="Employee Profile"
        icon={UserRound}
        maxWidth="max-w-[760px]"
        closeLabel="Close employee profile"
      >
        {viewingEmployee ? <TeamEmployeeProfile employee={viewingEmployee} /> : null}
      </ProfileFloatingCard>
    </div>
  );
}
