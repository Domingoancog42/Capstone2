import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageCircle,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import DashboardWelcomeBanner from "../../components/dashboard/DashboardWelcomeBanner";
import RoleWorkspacePage from "../../components/layout/RoleWorkspacePage";
import { SELF_SERVICE_MODULES, buildSelfServiceNavItems } from "../../components/layout/selfServiceModules";
import {
  PERFORMANCE_REWARDS_MODULES,
  buildPerformanceRewardsNavItems,
} from "../../components/layout/performanceRewardsModules";
import RoleAnalyticsOverview from "../../components/dashboard/RoleAnalyticsOverview";
import { DashCalendarWidget } from "../../components/navigation/DashCalendarWidget";
import EmployeeManagementWorkspace from "../../module/employee/EmployeeManagementWorkspace";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import LeaveBalanceManagementWorkspace from "../../module/leave/LeaveBalanceManagementWorkspace";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import PayrollManagementWorkspace from "../../module/payroll/PayrollManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import FileLoan from "../../module/Loan/fileloan";
import OvertimeWorkspace from "../../module/overtime/Overtime";

import AdminReports from "../../module/reports/AdminReports";
import {
  buildReportCategoryModules,
  buildReportNavChildren,
} from "../../module/reports/reportCategories";
import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { getEmployees } from "../../services/api";
import { fetchLeaveRequests } from "../../services/leaveService";
import { getRequestTableStatusLabel, normalizeLeaveStatus } from "../../utils/leaveHelpers";
import { saveEmployeeProfileHandoff } from "../../utils/employeeProfileHandoff";
import { numberFormatter } from "../../utils/format";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { getRoleLabel } from "../../utils/roleRoutes";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/*
 * Employee analytics now live beside the employee registry, while the audit trail remains an
 * oversight function for the HR Head and Admin.
 */
const HR_STAFF_HIDDEN_REPORT_CATEGORIES = ["employee", "audit"];

const leaveStatusColors = {
  Submitted: "#f97316",
  Pending: "#f59e0b",
  Endorsed: "#6366f1",
  Reviewed: "#0ea5e9",
  "Chief Reviewed": "#8b5cf6",
  Approved: "#16a34a",
  Rejected: "#ef4444",
  Cancelled: "#64748b",
};

function formatShortDate(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? "No date" : shortDateFormatter.format(parsed);
}

function StaffMetricCard({ label, value, helper, icon: Icon, tone }) {
  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white ${tone}`}>
          <Icon size={21} />
        </div>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-slate-500">{label}</p>
          <strong className="mt-1 block text-lg font-semibold text-slate-950">{value}</strong>
          <p className="m-0 mt-1 text-xs leading-5 text-slate-500">{helper}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// eslint-disable-next-line no-unused-vars
function HrStaffDashboardOverview({ user }) {
  const [employees, setEmployees] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const [employeeResult, leaveResult] = await Promise.allSettled([
        getEmployees(),
        fetchLeaveRequests(),
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
      setError(
        employeeResult.status === "rejected" || leaveResult.status === "rejected"
          ? "Some dashboard data could not be loaded."
          : ""
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadDashboard, {
    topics: ["leave_request", "employee"],
  });

  const statusCounts = useMemo(() => {
    const counts = {
      Submitted: 0,
      Pending: 0,
      Endorsed: 0,
      Reviewed: 0,
      "Chief Reviewed": 0,
      Approved: 0,
      Rejected: 0,
      Cancelled: 0,
    };

    leaveRequests.forEach((request) => {
      const status = normalizeLeaveStatus(request.status);
      if (counts[status] !== undefined) {
        counts[status] += 1;
      }
    });

    return counts;
  }, [leaveRequests]);

  const leavePieData = useMemo(
    () => Object.entries(statusCounts)
      .filter(([, value]) => value > 0)
      .map(([status, value]) => ({ name: getRequestTableStatusLabel(status), status, value })),
    [statusCounts]
  );

  const recentActivity = useMemo(
    () => [...leaveRequests]
      .sort((left, right) => new Date(right.dateFiled || right.startDate || 0) - new Date(left.dateFiled || left.startDate || 0))
      .slice(0, 5),
    [leaveRequests]
  );

  const totalEmployees = employees.length;
  const pendingRequests = statusCounts.Pending;
  const approvedRequests = statusCounts.Approved;
  const welcomeName = user?.full_name || user?.username || "HR Staff";

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <DashboardWelcomeBanner
        name={welcomeName}
        position={user?.position || "Not assigned"}
        role={getRoleLabel(user?.role || user?.roleKey || "hrstaff")}
        division={user?.division || user?.department || "Not assigned"}
        divisionHelper="Your assigned division"
        imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
        showCalendar
      />

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StaffMetricCard
          label="Total Employees"
          value={loading ? "..." : numberFormatter.format(totalEmployees)}
          helper="Employee records available for HR staff monitoring."
          icon={Users}
          tone="bg-teal-700"
        />
        <StaffMetricCard
          label="Total Pending Request"
          value={loading ? "..." : numberFormatter.format(pendingRequests)}
          helper="Leave requests waiting for routing or review."
          icon={ClipboardList}
          tone="bg-amber-700"
        />
        <StaffMetricCard
          label="Total Approve"
          value={loading ? "..." : numberFormatter.format(approvedRequests)}
          helper="Leave requests already approved."
          icon={ShieldCheck}
          tone="bg-emerald-700"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Calendar</CardTitle>
            <CardDescription>Quick date view for daily HR staff tracking.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-5">
            <DashCalendarWidget />
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Leave Request Analytics</CardTitle>
            <CardDescription>Status breakdown of submitted leave requests.</CardDescription>
          </CardHeader>
          <CardContent className="h-[330px]">
            {leavePieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={leavePieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={64}
                    outerRadius={106}
                    paddingAngle={4}
                  >
                    {leavePieData.map((entry) => (
                      <Cell key={entry.name} fill={leaveStatusColors[entry.status] || "#64748b"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">No leave request data available.</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <CardDescription>Latest leave request activity from the HR staff workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivity.length ? recentActivity.map((request) => {
              const status = normalizeLeaveStatus(request.status);
              return (
                <div key={request.id} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-slate-950">{request.employeeName || "Employee"}</p>
                    <p className="m-0 mt-1 text-sm text-slate-500">{request.leaveType || "Leave Request"} - {request.division || "Unassigned"}</p>
                    <p className="m-0 mt-1 text-xs text-slate-400">{formatShortDate(request.dateFiled || request.startDate)}</p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
                    style={{
                      backgroundColor: `${leaveStatusColors[status] || "#64748b"}18`,
                      color: leaveStatusColors[status] || "#64748b",
                    }}
                  >
                    {getRequestTableStatusLabel(status)}
                  </span>
                </div>
              );
            }) : (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
                No recent leave activity yet.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function HrStaffPayrollWorkspace({ view = "generate", user, onNavigate }) {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadEmployees = async () => {
      try {
        const result = await getEmployees();
        if (!active) {
          return;
        }

        setEmployees(Array.isArray(result?.employees) ? result.employees : []);
        setError("");
      } catch (requestError) {
        if (active) {
          setEmployees([]);
          setError(requestError.response?.data?.message || "Unable to load employee options for payroll.");
        }
      }
    };

    void loadEmployees();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      {view === "payslip" ? (
        <PayslipWorkspace />
      ) : view === "archived" ? (
        <PayrollManagementWorkspace employees={employees} view="archived" user={user} onNavigate={onNavigate} />
      ) : (
        <PayrollManagementWorkspace employees={employees} view="generate" user={user} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function HrStaffOvertimeWorkspace({ user }) {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadEmployees = async () => {
      try {
        const result = await getEmployees();
        if (!active) {
          return;
        }

        setEmployees(Array.isArray(result?.employees) ? result.employees : []);
        setError("");
      } catch (requestError) {
        if (active) {
          setEmployees([]);
          setError(requestError.response?.data?.message || "Unable to load employee options for overtime.");
        }
      }
    };

    void loadEmployees();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}
      <OvertimeWorkspace
        user={user}
        employees={employees}
        title="Overtime Management"
        description="File, review, and monitor employee overtime requests."
        submitLabel="File Overtime Request"
      />
    </div>
  );
}

const navigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/hrstaff/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/hrstaff/profile" },
  { key: "employees", label: "Employee Directory", icon: Users, path: "/hrstaff/employees" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/hrstaff/messages" },
  { key: "notifications", label: "Notifications", path: "/hrstaff/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  /* HR Staff do not run OPCR/IPCR, so the Performance Reviews group is left out of their sidebar. */
  ...buildPerformanceRewardsNavItems("/hrstaff", {
    includePerformanceReviews: false,
    includeNomination: false,
  }),
  /* Leave credits and COC credits are two modes of one registry, so this is a single page. */
  {
    key: "leaveBalance",
    label: "Leave & COC Balances",
    icon: ClipboardList,
    path: "/hrstaff/leave-balance",
    permissionModule: "leaveBalance",
  },
  {
    key: "attendance",
    label: "Time & Attendance",
    icon: ClipboardCheck,
    path: "/hrstaff/attendance",
    children: [
      /* HR Staff own the biometric import, so it is a first-class entry here rather than a hidden route. */
      { key: "attendance", label: "Import Attendance", path: "/hrstaff/attendance", exact: true },
      { key: "overtime", label: "Overtime", path: "/hrstaff/attendance/overtime" },
    ],
  },
  {
    key: "leave",
    label: "File Request",
    icon: CalendarRange,
    path: "/hrstaff/leave",
    children: [
      { key: "leave", label: "Leave Request", path: "/hrstaff/leave", exact: true },
      { key: "travel", label: "Travel Order Request", path: "/hrstaff/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/hrstaff/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/hrstaff/leave/pass-slips" },
    ],
  },
  {
    key: "payroll",
    label: "Payroll Management",
    icon: FileText,
    path: "/hrstaff/payroll/generate",
    children: [
      { key: "payrollGenerate", label: "Payroll", path: "/hrstaff/payroll/generate" },
      { key: "payrollRecords", label: "Payslip", path: "/hrstaff/payroll/payslip" },
      { key: "payrollLoan", label: "Loan", path: "/hrstaff/payroll/loan" },
    ],
  },
  /* Reached from the Archive toggle on the registry, not from the sidebar. */
  { key: "archivedPayroll", label: "Archived Payroll", path: "/hrstaff/payroll/archived", hidden: true },

  { type: "section", label: "Reports & Analytics" },
  {
    key: "reports",
    label: "Reports & Analytics",
    icon: FileText,
    path: "/hrstaff/reports",
    children: buildReportNavChildren("/hrstaff/reports", { exclude: HR_STAFF_HIDDEN_REPORT_CATEGORIES }),
  },
  { key: "leaveBalance", label: "Set Leave Balance", icon: ClipboardList, path: "/hrstaff/leave-balance", hidden: true },
  ...buildSelfServiceNavItems("/hrstaff"),
];

const modules = {
  dashboard: {
    title: "HR Staff Dashboard",
    description: "Handle day-to-day employee records, leave tracking, and recurring HR reports.",
    hidePageIntro: true,
    render: ({ user }) => (
      <RoleAnalyticsOverview
        user={user}
        organizationWide
      />
    ),
  },
  employees: {
    title: "Employee Management",
    description: "Add, edit, and review employee records from the HR Staff workspace.",
    hidePageIntro: true,
    render: ({ user }) => <EmployeeManagementWorkspace user={user} allowAccountCreation={false} />,
  },
  calendar: {
    title: "Calendar",
    description: "View approved employee leave and travel order schedules.",
    hidePageIntro: true,
    render: ({ onNavigate }) => (
      <LeaveTravelCalendarWorkspace
        onViewEmployeeProfile={(employee) => {
          saveEmployeeProfileHandoff(employee);
          onNavigate?.("/hrstaff/employees");
        }}
      />
    ),
  },
  messages: {
    title: "Messages",
    description: "Coordinate HR conversations and employee communication from one workspace.",
    hidePageIntro: true,
    render: ({ user }) => <BubbleChat user={user} />,
  },
  leave: {
    title: "Leave",
    description: "Review leave requests, travel orders, pass slips, and compensatory time off records from the HR staff workspace.",
    hidePageIntro: true,
    render: ({ user }) => (
      <LeaveDashboard
        user={user}
        leaveRequestLayout="management"
        activeView="leave"
        showRequestTabs={false}
      />
    ),
  },
  travel: {
    title: "Travel Order Request",
    description: "File and monitor travel orders under your employee account.",
    hidePageIntro: true,
    render: ({ user }) => (
      <LeaveDashboard
        user={user}
        leaveRequestLayout="management"
        activeView="travel"
        showRequestTabs={false}
      />
    ),
  },
  cto: {
    title: "Compensatory Time Off",
    description: "Review compensatory time off requests and monitor employee CTO records.",
    hidePageIntro: true,
    render: ({ user }) => (
      <LeaveDashboard
        user={user}
        leaveRequestLayout="management"
        activeView="cto"
        showRequestTabs={false}
      />
    ),
  },
  passSlip: {
    title: "Pass Slips",
    description: "Review pass slip records and monitor employee pass slip activity.",
    hidePageIntro: true,
    render: ({ user }) => (
      <LeaveDashboard
        user={user}
        leaveRequestLayout="management"
        activeView="passSlip"
        showRequestTabs={false}
      />
    ),
  },
  attendance: {
    title: "Attendance Management",
    description: "Import DAT logs, monitor employee attendance, review missing logs, and generate monthly DTR reports.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="hrstaff" />,
  },
  overtime: {
    title: "Overtime Management",
    description: "File, review, and monitor employee overtime requests.",
    hidePageIntro: true,
    render: ({ user }) => <HrStaffOvertimeWorkspace user={user} />,
  },
  payrollGenerate: {
    title: "Create Payroll",
    description: "Create payroll batches and review computed payroll totals from the HR Staff workspace.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <HrStaffPayrollWorkspace view="generate" user={user} onNavigate={onNavigate} />,
  },
  payrollRecords: {
    title: "Payslip",
    description: "Review generated payslip entries and payroll details from the HR Staff workspace.",
    hidePageIntro: true,
    render: ({ user }) => <HrStaffPayrollWorkspace view="payslip" user={user} />,
  },
  payrollLoan: {
    title: "Loan Management",
    description: "Review, approve, reject, and audit employee loan requests from the HR Staff workspace.",
    hidePageIntro: true,
    render: ({ user }) => <FileLoan user={user} />,
  },
  archivedPayroll: {
    title: "Archived Payroll",
    description: "View archived payroll records kept for audit review.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <HrStaffPayrollWorkspace view="archived" user={user} onNavigate={onNavigate} />,
  },

  leaveBalance: {
    title: "Leave & COC Balances",
    description: "Manage employee leave credit and compensatory overtime credit balances from the HR staff workspace.",
    hidePageIntro: true,
    render: ({ user }) => <LeaveBalanceManagementWorkspace user={user} />,
  },
  reports: {
    title: "Reports",
    description: "Compile operational reports used by chiefs and HR leadership.",
    hidePageIntro: true,
    render: ({ user }) => <AdminReports user={user} />,
  },
  ...buildReportCategoryModules(
    (categoryKey, { user }) => <AdminReports user={user} category={categoryKey} />,
    { exclude: HR_STAFF_HIDDEN_REPORT_CATEGORIES }
  ),
  ...PERFORMANCE_REWARDS_MODULES,
  ...SELF_SERVICE_MODULES,
};

export default function HrstaffDashboard(props) {
  return (
    <RoleWorkspacePage
      {...props}
      portalLabel="HR Staff Workspace"
      navigationItems={navigationItems}
      modules={modules}
      contentClassName="space-y-4 p-4"
    />
  );
}
