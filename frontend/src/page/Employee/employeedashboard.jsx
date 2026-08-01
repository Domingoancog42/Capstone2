import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  FileText,
  IdCard,
  LayoutDashboard,
  Mail,
  PieChart,
  ScrollText,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Card, {
  CardContent,
} from "../../components/UI/card";
import Button from "../../components/UI/button";
import RoleWorkspacePage from "../../components/layout/RoleWorkspacePage";
import EmployeeLeaveWorkspace from "../../module/leave/EmployeeLeaveWorkspace";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import LeaveMonetizationWorkspace from "../../module/payroll/LeaveMonetizationWorkspace";
import TravelOrderWorkspace from "../../module/travel/TravelOrderWorkspace";
import PassSlipWorkspace from "../../module/passslip/PassSlipWorkspace";
import CompensatoryWorkspace from "../../module/compensatory/CompensatoryWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import EmployeeIpcrWorkspace from "../../module/performance/EmployeeIpcrWorkspace";
import ServiceRecordWorkspace from "../../module/serviceRecord/ServiceRecordWorkspace";
import PasswordExpiryModal from "../../components/auth/PasswordExpiryModal";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";

import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchLeaveCredits,
  fetchLeaveRequests,
} from "../../services/leaveService";
import {
  formatDateDisplay,
  getInitials,
  getStatusBadgeClasses,
  isPendingRequestStatus,
  matchesUserRecordScope,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { checkPasswordExpiry } from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { numberFormatter } from "../../utils/format";

function formatBalanceValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "0.00";
}

function isSameMonth(value, referenceDate) {
  const parsed = new Date(value || "");

  return !Number.isNaN(parsed.getTime())
    && parsed.getFullYear() === referenceDate.getFullYear()
    && parsed.getMonth() === referenceDate.getMonth();
}

function calculatePercent(value, total) {
  const numericValue = Number(value) || 0;
  const numericTotal = Number(total) || 0;

  if (numericTotal <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((numericValue / numericTotal) * 100)));
}

/**
 * Same shape as the HR dashboard's summary tile: icon on the left, a small tracked caption, and the
 * figure directly beneath it. Keeping the two dashboards on one layout means a user who moves
 * between roles reads the numbers in the same place.
 */
function DashboardStatCard({ icon: Icon, label, value, helper, tone, loading }) {
  return (
    <Card className={`px-4 py-4 ${tone.border}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${tone.icon}`}>
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          {loading ? (
            <div className="mt-1 h-8 w-16 animate-pulse rounded-md bg-slate-200" />
          ) : (
            <strong className="mt-1 block text-[2rem] font-semibold leading-none text-slate-950">{value}</strong>
          )}
          {helper ? <p className="m-0 mt-2 text-sm leading-5 text-slate-500">{helper}</p> : null}
        </div>
      </div>
    </Card>
  );
}

function EmployeeProfileCard({ user, requestStats, loading, onNavigate }) {
  const displayName = user?.full_name || user?.username || "Employee";
  const profileImageUrl = resolveBackendAssetUrl(user?.profile_image || user?.profileImage);
  const employeeMeta = [
    { label: "Employee ID", value: user?.employee_id || "Unlinked", icon: IdCard },
    { label: "Division", value: user?.division || "Unassigned", icon: BriefcaseBusiness },
    { label: "Designation", value: user?.designation || "Not assigned", icon: BadgeCheck },
    { label: "Email", value: user?.email || "No email", icon: Mail },
  ];

  return (
    <Card>
      <CardContent className="px-4 py-4">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-xl font-semibold text-slate-700">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <span>{getInitials(displayName)}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-[#D61E1E]">Employee Dashboard</p>
              <h1 className="m-0 mt-2 truncate text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
                Welcome, {displayName}
              </h1>
              <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Review your profile details, leave requests, attendance, and payslip records from one workspace.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
            <Button variant="primary" icon={Send} onClick={() => onNavigate?.("/employee/leave-request")}>
              File Leave
            </Button>
            <Button variant="secondary" icon={UserRound} onClick={() => onNavigate?.("/employee/profile")}>
              My Profile
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {employeeMeta.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600">
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
                <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-900">{value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Pending Requests</p>
            {loading ? <div className="mt-3 h-7 w-10 animate-pulse rounded bg-amber-100" /> : (
              <strong className="mt-2 block text-2xl font-semibold text-amber-900">{requestStats.pending}</strong>
            )}
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Approval Rate</p>
            {loading ? <div className="mt-3 h-7 w-14 animate-pulse rounded bg-emerald-100" /> : (
              <strong className="mt-2 block text-2xl font-semibold text-emerald-900">{requestStats.approvalRate}%</strong>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActionsCard({ onNavigate }) {
  const actions = [
    {
      label: "Attendance",
      helper: "DTR and logs",
      icon: Clock3,
      path: "/employee/attendance",
      tone: "text-sky-700",
    },
    {
      label: "Payslip",
      helper: "Salary records",
      icon: FileText,
      path: "/employee/payslip",
      tone: "text-emerald-700",
    },
    {
      label: "Calendar",
      helper: "Leave and travel",
      icon: CalendarDays,
      path: "/employee/calendar",
      tone: "text-violet-700",
    },
    {
      label: "IPCR",
      helper: "Performance",
      icon: ClipboardList,
      path: "/employee/ipcr",
      tone: "text-rose-700",
    },
  ];

  return (
    <Card>
      <CardContent className="px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Quick access</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Common employee actions.</p>
          </div>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
            <ShieldCheck size={18} />
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {actions.map(({ label, helper, icon: Icon, path, tone }) => (
            <button
              key={label}
              type="button"
              onClick={() => onNavigate?.(path)}
              className="group flex min-h-[72px] w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 ${tone}`}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">{label}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{helper}</span>
                </span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LeaveBalanceSummary({ leaveCredits, loading }) {
  const getCredit = (type, code) => (
    leaveCredits.find((credit) => credit.type === type || String(credit.code || "").toUpperCase() === code) || {}
  );
  const balances = [
    {
      label: "Vacation Leave",
      credit: getCredit("Vacation Leave", "VL"),
      icon: CalendarDays,
    },
    {
      label: "Sick Leave",
      credit: getCredit("Sick Leave", "SL"),
      icon: CalendarClock,
    },
  ];

  return (
    <Card>
      <CardContent className="px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Leave balance</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Available credits for your employee account.</p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <CalendarDays size={15} />
            Current year
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {balances.map(({ label, credit, icon: Icon }) => (
            <div key={label} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700">
                <Icon size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-medium text-slate-600">{label}</p>
                {loading ? (
                  <div className="mt-2 h-7 w-20 animate-pulse rounded-md bg-slate-200" />
                ) : (
                  <strong className="mt-1 block text-2xl font-semibold leading-none text-slate-900">
                    {formatBalanceValue(credit.remaining)}
                  </strong>
                )}
                <p className="m-0 mt-1 text-xs text-slate-500">
                  {formatBalanceValue(credit.total)} total | {formatBalanceValue(credit.used)} used
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RequestStatusOverview({ stats, loading }) {
  const statusRows = [
    { label: "Approved", value: stats.approved, color: "bg-emerald-500", tone: "text-emerald-700" },
    { label: "Pending", value: stats.pending, color: "bg-amber-500", tone: "text-amber-700" },
    { label: "Rejected/Cancelled", value: stats.rejected, color: "bg-rose-500", tone: "text-rose-700" },
  ];

  return (
    <Card>
      <CardContent className="px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Request status</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">A simple view of your leave request progress.</p>
          </div>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
            <PieChart size={18} />
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {statusRows.map((row) => {
            const percent = calculatePercent(row.value, stats.total);

            return (
              <div key={row.label}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="m-0 text-sm font-semibold text-slate-700">{row.label}</p>
                  {loading ? <div className="h-5 w-10 animate-pulse rounded bg-slate-200" /> : (
                    <span className={`text-sm font-semibold ${row.tone}`}>{row.value}</span>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${row.color}`} style={{ width: loading ? "35%" : `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentRequestsCard({ requests, loading, onNavigate }) {
  return (
    <Card>
      <CardContent className="px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Latest requests</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Recently submitted leave activity.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.("/employee/leave-request")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
            aria-label="Open leave requests"
          >
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            [0, 1, 2].map((item) => (
              <div key={item} className="h-[72px] animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
            ))
          ) : requests.length ? (
            requests.map((request) => (
              <div key={request.id || `${request.leaveType}-${request.startDate}-${request.status}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-slate-900">{request.leaveType || "Leave Request"}</p>
                    <p className="m-0 mt-1 text-xs text-slate-500">
                      {formatDateDisplay(request.startDate)} to {formatDateDisplay(request.endDate)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${getStatusBadgeClasses(request.status)}`}>
                    {normalizeLeaveStatus(request.status)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
              <p className="m-0 text-sm font-semibold text-slate-700">No leave requests yet</p>
              <p className="m-0 mt-1 text-sm text-slate-500">Your submitted employee requests will appear here.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EmployeeDashboardOverview({ user, onNavigate }) {
  const [leaveCredits, setLeaveCredits] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [passwordExpiryModalOpen, setPasswordExpiryModalOpen] = useState(false);
  const [daysUntilExpiry, setDaysUntilExpiry] = useState(null);

  useEffect(() => {
    const checkPasswordStatus = async () => {
      try {
        const response = await checkPasswordExpiry();
        if (response.success && response.passwordExpiry?.shouldWarn) {
          setDaysUntilExpiry(response.passwordExpiry.daysUntilExpiry);
          setPasswordExpiryModalOpen(true);
        }
      } catch (error) {
        console.error("Failed to check password expiry:", error);
      }
    };

    checkPasswordStatus();
  }, []);

  const loadDashboard = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const [creditResult, requestResult] = await Promise.allSettled([
        fetchLeaveCredits(),
        fetchLeaveRequests(),
      ]);

      setLeaveCredits(
        creditResult.status === "fulfilled" && Array.isArray(creditResult.value?.credits?.balances)
          ? creditResult.value.credits.balances
          : []
      );
      setLeaveRequests(
        requestResult.status === "fulfilled" && Array.isArray(requestResult.value?.requests)
          ? requestResult.value.requests.filter((request) => matchesUserRecordScope(request, user))
          : []
      );
      setError(
        creditResult.status === "rejected" || requestResult.status === "rejected"
          ? "Some dashboard data could not be loaded."
          : ""
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  /*
   * This is the screen an employee leaves open waiting on a decision, so the refresh has to be
   * invisible: `background` keeps the cards and the status badge in place while the new values load,
   * instead of blanking the dashboard every time an approver clicks something.
   */
  useAutoRefreshOnChange(loadDashboard, {
    topics: ["leave_request", "leave_credit"],
    refreshOnMount: false,
  });

  const requestStats = useMemo(() => {
    const now = new Date();
    const approved = leaveRequests.filter((request) => normalizeLeaveStatus(request.status) === "Approved").length;
    const rejected = leaveRequests.filter((request) => {
      const status = normalizeLeaveStatus(request.status);
      return status === "Rejected" || status === "Cancelled";
    }).length;
    const filedThisMonth = leaveRequests.filter((request) => isSameMonth(request.dateFiled || request.startDate, now)).length;
    const approvalRate = leaveRequests.length > 0 ? Math.round((approved / leaveRequests.length) * 100) : 0;

    return {
      total: leaveRequests.length,
      filedThisMonth,
      pending: leaveRequests.filter((request) => isPendingRequestStatus(request.status)).length,
      approved,
      rejected,
      approvalRate,
    };
  }, [leaveRequests]);
  const latestRequests = useMemo(() => (
    [...leaveRequests]
      .sort((a, b) => {
        const dateA = new Date(a.dateFiled || a.startDate || 0).getTime();
        const dateB = new Date(b.dateFiled || b.startDate || 0).getTime();

        return (Number.isNaN(dateB) ? 0 : dateB) - (Number.isNaN(dateA) ? 0 : dateA);
      })
      .slice(0, 4)
  ), [leaveRequests]);
  const handleChangePassword = () => {
    setPasswordExpiryModalOpen(false);
    if (onNavigate) {
      onNavigate("/employee/profile");
      return;
    }

    window.location.href = "/employee/profile";
  };

  return (
    /* w-full, not a second max-width: the workspace shell already centres and caps the content. */
    <div className="w-full space-y-6">
      <PasswordExpiryModal
        open={passwordExpiryModalOpen}
        daysUntilExpiry={daysUntilExpiry}
        onClose={() => setPasswordExpiryModalOpen(false)}
        onChangePassword={handleChangePassword}
      />

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <EmployeeProfileCard
          user={user}
          requestStats={requestStats}
          loading={loading}
          onNavigate={onNavigate}
        />
        <QuickActionsCard onNavigate={onNavigate} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          icon={ClipboardList}
          label="My Requests"
          value={numberFormatter.format(requestStats.total)}
          tone={{ border: "border-slate-200", icon: "border-slate-200 bg-slate-50 text-slate-600" }}
          loading={loading}
        />
        <DashboardStatCard
          icon={Clock3}
          label="Pending"
          value={numberFormatter.format(requestStats.pending)}
          tone={{ border: "border-amber-200", icon: "border-amber-200 bg-amber-50 text-amber-700" }}
          loading={loading}
        />
        <DashboardStatCard
          icon={CheckCircle2}
          label="Approved"
          value={numberFormatter.format(requestStats.approved)}
          
          tone={{ border: "border-emerald-200", icon: "border-emerald-200 bg-emerald-50 text-emerald-700" }}
          loading={loading}
        />
        <DashboardStatCard
          icon={CalendarClock}
          label="Filed This Month"
          value={numberFormatter.format(requestStats.filedThisMonth)}
          tone={{ border: "border-sky-200", icon: "border-sky-200 bg-sky-50 text-sky-700" }}
          loading={loading}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <LeaveBalanceSummary leaveCredits={leaveCredits} loading={loading} />
        <div className="grid gap-4">
          <RequestStatusOverview stats={requestStats} loading={loading} />
          <RecentRequestsCard requests={latestRequests} loading={loading} onNavigate={onNavigate} />
        </div>
      </section>
    </div>
  );
}

const navigationItems = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/employee/dashboard" },
  { key: "profile", label: "Profile", icon: UserRound, path: "/employee/profile" },
  { key: "calendar", label: "Calendar", icon: CalendarDays, path: "/employee/calendar" },
  { key: "attendance", label: "Attendance", icon: Clock3, path: "/employee/attendance" },
  {
    key: "leave",
    label: "Leave Request",
    icon: CalendarClock,
    path: "/employee/leave-request",
    children: [
      { key: "leave", label: "Leave Request", path: "/employee/leave-request", exact: true },
      { key: "travel", label: "Travel Order", path: "/employee/travel-order" },
      { key: "passSlip", label: "Pass Slips", path: "/employee/pass-slips" },
      { key: "cto", label: "Compensatory Time Off", path: "/employee/compensatory-time-off" },
      { key: "overtime", label: "Overtime", path: "/employee/overtime" },
      { key: "leaveMonetization", label: "Leave Monetization", path: "/employee/leave-monetization" },
    ],
  },
  { key: "notifications", label: "Notifications", path: "/employee/notifications", hidden: true },
  { key: "payslip", label: "Payslip", icon: FileText, path: "/employee/payslip" },
  { key: "ipcr", label: "IPCR", icon: ClipboardList, path: "/employee/ipcr" },
  { key: "serviceRecord", label: "Service Record", icon: ScrollText, path: "/employee/service-record" },
];

const modules = {
  dashboard: {
    title: "Employee Dashboard",
    description: "Keep track of your requests, attendance, payslips, and profile details in one place.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <EmployeeDashboardOverview user={user} onNavigate={onNavigate} />,
  },
  profile: {
    title: "Profile",
    description: "A quick view of the information linked to your HRIS account.",
    cards: [
      {
        title: "Account Profile",
        description: "Core identity and employment details",
        items: [
          { label: "Full name", helper: props => props, value: "" },
        ],
      },
    ],
  },
  calendar: {
    title: "Calendar",
    description: "View your approved leave and travel order schedules.",
    hidePageIntro: true,
    render: () => <LeaveTravelCalendarWorkspace canManageAnnouncements={false} showLegend={false} />,
  },
  leave: {
    title: "Leave Request",
    description: "Prepare, submit, and monitor leave requests from your employee workspace.",
    render: ({ user }) => <EmployeeLeaveWorkspace user={user} />,
  },
  travel: {
    title: "Travel Order",
    description: "Submit travel orders and monitor the status of each official trip request.",
    hidePageIntro: true,
    render: ({ user }) => (
      <TravelOrderWorkspace
        user={user}
        title="Travel Order Requests"
        description="Submit travel orders and monitor the status of each official trip request."
        submitLabel="Submit Travel Order"
      />
    ),
  },
  passSlip: {
    title: "Pass Slips",
    description: "Submit pass slips and monitor the status of your outgoing requests.",
    hidePageIntro: true,
    render: ({ user }) => (
      <PassSlipWorkspace
        user={user}
        title="Pass Slip Requests"
        description="Submit pass slips and monitor the status of your outgoing requests."
        submitLabel="Submit Pass Slip"
        showDivisionFilter={false}
      />
    ),
  },
  cto: {
    title: "Compensatory Time Off",
    description: "Submit compensatory time off requests and track their status in real time.",
    hidePageIntro: true,
    render: ({ user }) => (
      <CompensatoryWorkspace
        user={user}
        title="Compensatory Time Off Requests"
        description="Submit compensatory time off requests and track their status in real time."
        submitLabel="Submit Compensatory Time Off"
        showEmployeeFilter={false}
      />
    ),
  },
  overtime: {
    title: "Overtime",
    description: "Submit overtime requests and track their status in real time.",
    hidePageIntro: true,
    render: ({ user }) => (
      <OvertimeWorkspace
        user={user}
        title="Overtime Requests"
        description="Submit overtime requests and track their status in real time."
        submitLabel="Submit Overtime Request"
        showEmployeeFilter={false}
      />
    ),
  },
  leaveMonetization: {
    title: "Leave Monetization",
    description: "Convert unused leave credits to cash and track HR Head review and Regional Director approval.",
    hidePageIntro: true,
    render: ({ user }) => <LeaveMonetizationWorkspace user={user} />,
  },
  payslip: {
    title: "Payslip",
    description: "Generate and review your available payslip based on paid payroll records.",
    hidePageIntro: true,
    render: () => <PayslipWorkspace mode="employee" />,
  },
  ipcr: {
    title: "IPCR",
    description: "Review assigned IPCR KPIs and submit your accomplishments.",
    hidePageIntro: true,
    render: () => <EmployeeIpcrWorkspace />,
  },
  serviceRecord: {
    title: "Service Record",
    description: "Your chronological record of appointments, salaries, and separations (CS Form No. 1).",
    hidePageIntro: true,
    render: ({ user }) => <ServiceRecordWorkspace user={user} mode="employee" />,
  },
  attendance: {
    title: "My Attendance",
    description: "View personal attendance logs, DTR forms, printable records, and daily log history.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="employee" />,
  },
};

export default function EmployeeDashboard(props) {
  const profileModule = {
    ...modules.profile,
    cards: [
      {
        title: "Account Profile",
        description: "Core identity and employment details",
        items: [
          { label: "Full name", helper: "Employee record linked to your login.", value: props.user?.full_name || "N/A" },
          { label: "Email", helper: "Primary email used for HRIS notifications.", value: props.user?.email || "N/A" },
          { label: "Division", helper: "Current division assignment.", value: props.user?.division || "Unassigned" },
        ],
      },
    ],
  };

  return (
    <RoleWorkspacePage
      {...props}
      portalLabel=""
      navigationItems={navigationItems}
      modules={{ ...modules, profile: profileModule }}
    />
  );
}
