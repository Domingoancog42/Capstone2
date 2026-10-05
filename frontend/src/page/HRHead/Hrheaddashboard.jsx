import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Clock3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageCircle,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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
import { getEmployees, getUsers } from "../../services/api";
import { fetchAttendanceRecords } from "../../services/attendanceService";
import { fetchLeaveRequests } from "../../services/leaveService";
import { getRequestTableStatusLabel, normalizeLeaveStatus } from "../../utils/leaveHelpers";
import { saveEmployeeProfileHandoff } from "../../utils/employeeProfileHandoff";
import { numberFormatter } from "../../utils/format";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { getRoleLabel } from "../../utils/roleRoutes";

const HR_HEAD_HIDDEN_REPORT_CATEGORIES = ["employee", "audit"];

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

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
const reportChartColors = ["#0f766e", "#0ea5e9", "#f59e0b", "#10b981", "#334155", "#8b5cf6", "#ef4444", "#14b8a6"];

function formatShortDate(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? "No date" : shortDateFormatter.format(parsed);
}

function MetricCard({ label, value, helper, icon: Icon, tone }) {
  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
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

function normalizeReportValue(value, fallback = "Unassigned") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeEmploymentType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("regular")) {
    return "Regular";
  }
  if (normalized.includes("contract") || normalized === "cos") {
    return "Contract of Service";
  }
  return normalized ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unassigned";
}

function calculateAge(dateValue) {
  const parsed = new Date(dateValue || "");
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDelta = today.getMonth() - parsed.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < parsed.getDate())) {
    age -= 1;
  }
  return age;
}

function countBy(items, getKey) {
  const counts = new Map();
  items.forEach((item) => {
    const key = normalizeReportValue(getKey(item));
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([name, value], index) => ({
      name,
      value,
      color: reportChartColors[index % reportChartColors.length],
    }))
    .sort((left, right) => right.value - left.value);
}

function ReportChartCard({ title, description, children, empty = false }) {
  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-[340px]">
        {empty ? (
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm text-slate-500">
            No report data available yet.
          </div>
        ) : children}
      </CardContent>
    </Card>
  );
}

// eslint-disable-next-line no-unused-vars
function HrHeadDashboardOverview({ user }) {
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

  const divisionData = useMemo(() => {
    const counts = new Map();
    employees.forEach((employee) => {
      const division = employee.department || employee.division || "Unassigned";
      counts.set(division, (counts.get(division) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([division, total]) => ({ division, total }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 8);
  }, [employees]);

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
  const welcomeName = user?.full_name || user?.username || "HR Head";

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <DashboardWelcomeBanner
        name={welcomeName}
        position={user?.position || "Not assigned"}
        role={getRoleLabel(user?.role || user?.roleKey || "hrhead")}
        division="All Divisions"
        divisionHelper="Organization-wide access"
        imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
        showCalendar
        canManageCalendar
      />

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Total Employees"
          value={loading ? "..." : numberFormatter.format(totalEmployees)}
          helper="Active employee records visible to HR Head."
          icon={Users}
          tone="bg-teal-700"
        />
        <MetricCard
          label="Total Pending Request"
          value={loading ? "..." : numberFormatter.format(pendingRequests)}
          helper="Leave requests waiting for HR review."
          icon={ClipboardList}
          tone="bg-amber-700"
        />
        <MetricCard
          label="Total Approve"
          value={loading ? "..." : numberFormatter.format(approvedRequests)}
          helper="Leave requests already approved."
          icon={ShieldCheck}
          tone="bg-emerald-700"
        />
      </section>

      <section className="grid gap-4">
        <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Employees by Division</CardTitle>
            <CardDescription>Headcount distribution across divisions.</CardDescription>
          </CardHeader>
          <CardContent className="h-[360px]">
            {divisionData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={divisionData} margin={{ top: 8, right: 16, left: 0, bottom: 36 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="division" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={62} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#0f766e" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">No division data available.</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <CardDescription>Latest leave request activity from the HR workspace.</CardDescription>
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
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function HrHeadReportsAnalytics() {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadReports = async () => {
      setLoading(true);
      try {
        const [employeeResult, userResult, attendanceResult] = await Promise.allSettled([
          getEmployees(),
          getUsers(),
          fetchAttendanceRecords(),
        ]);

        if (!active) {
          return;
        }

        setEmployees(
          employeeResult.status === "fulfilled" && Array.isArray(employeeResult.value?.employees)
            ? employeeResult.value.employees
            : []
        );
        setUsers(
          userResult.status === "fulfilled" && Array.isArray(userResult.value?.users)
            ? userResult.value.users
            : []
        );
        setAttendanceRecords(
          attendanceResult.status === "fulfilled" && Array.isArray(attendanceResult.value?.records)
            ? attendanceResult.value.records
            : []
        );
        setError(
          [employeeResult, userResult, attendanceResult].some((result) => result.status === "rejected")
            ? "Some report data could not be loaded."
            : ""
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadReports();

    return () => {
      active = false;
    };
  }, []);

  const employeesByDivision = useMemo(
    () => countBy(employees, (employee) => employee.department || employee.division),
    [employees]
  );

  const demographics = useMemo(() => {
    const male = employees.filter((employee) => String(employee.gender || "").toLowerCase().startsWith("m")).length;
    const female = employees.filter((employee) => String(employee.gender || "").toLowerCase().startsWith("f")).length;
    const pwd = employees.filter((employee) => String(employee.pwd ?? "").trim() === "1" || employee.pwd === true).length;
    const seniorCitizen = employees.filter((employee) => {
      const age = calculateAge(employee.dateOfBirth || employee.date_of_birth);
      return age !== null && age >= 60;
    }).length;

    return [
      { name: "Male", value: male, color: "#0ea5e9" },
      { name: "Female", value: female, color: "#ec4899" },
      { name: "PWD", value: pwd, color: "#f59e0b" },
      { name: "Senior Citizen", value: seniorCitizen, color: "#10b981" },
    ].filter((item) => item.value > 0);
  }, [employees]);

  const employmentTypes = useMemo(
    () => countBy(employees, (employee) => normalizeEmploymentType(employee.employmentStatus || employee.employmentType)),
    [employees]
  );

  const roleDistribution = useMemo(
    () => countBy(users, (user) => user.role),
    [users]
  );

  const attendanceByDate = useMemo(() => {
    const byDate = new Map();
    attendanceRecords.forEach((record) => {
      const date = normalizeReportValue(record.date, "No date");
      const current = byDate.get(date) || {
        date,
        present: 0,
        late: 0,
        incomplete: 0,
        employees: new Set(),
      };
      const status = String(record.status || "").toLowerCase();
      current.employees.add(record.employeeRecordId || record.employeeId || record.employeeName);

      if (status === "present") {
        current.present += 1;
      } else if (status.includes("late")) {
        current.late += 1;
      } else if (status === "incomplete") {
        current.incomplete += 1;
      }

      byDate.set(date, current);
    });

    return Array.from(byDate.values())
      .sort((left, right) => String(left.date).localeCompare(String(right.date)))
      .slice(-10)
      .map((item) => ({
        date: formatShortDate(item.date),
        employees: item.employees.size,
        present: item.present,
        late: item.late,
        incomplete: item.incomplete,
      }));
  }, [attendanceRecords]);

  const reportMetrics = [
    { label: "Employees", value: employees.length, helper: "Active employee records included in reports.", icon: Users, tone: "bg-teal-700" },
    { label: "Divisions", value: employeesByDivision.length, helper: "Divisions represented by employee records.", icon: LayoutDashboard, tone: "bg-sky-700" },
    { label: "Roles", value: roleDistribution.length, helper: "System roles assigned to active user accounts.", icon: UserCog, tone: "bg-indigo-700" },
    { label: "Attendance Logs", value: attendanceRecords.length, helper: "Daily attendance records currently available.", icon: Clock3, tone: "bg-amber-700" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {reportMetrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={loading ? "..." : numberFormatter.format(metric.value)}
            helper={metric.helper}
            icon={metric.icon}
            tone={metric.tone}
          />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ReportChartCard
          title="Employees by Division"
          description="Headcount count per division."
          empty={!employeesByDivision.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={employeesByDivision} margin={{ top: 8, right: 16, left: 0, bottom: 44 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={64} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" name="Employees" fill="#0f766e" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportChartCard
          title="Employee Demographics"
          description="Male, female, PWD, and senior citizen counts."
          empty={!demographics.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={demographics} dataKey="value" nameKey="name" innerRadius={62} outerRadius={105} paddingAngle={4}>
                {demographics.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportChartCard
          title="Employment Type"
          description="Regular, Contract of Service, and other employment classifications."
          empty={!employmentTypes.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={employmentTypes} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" name="Employees" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <ReportChartCard
          title="Role Distribution"
          description="How many active user accounts are assigned to each role."
          empty={!roleDistribution.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={roleDistribution} dataKey="value" nameKey="name" outerRadius={112} paddingAngle={3}>
                {roleDistribution.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
        </ReportChartCard>

        <div className="xl:col-span-2">
          <ReportChartCard
            title="Attendance Coverage"
            description="Daily attendance count by employee and status."
            empty={!attendanceByDate.length}
          >
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={attendanceByDate} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend verticalAlign="top" height={32} />
                <Line type="monotone" dataKey="employees" name="Employees with attendance" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="present" name="Present" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="late" name="Late" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="incomplete" name="Incomplete" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
              </RechartsLineChart>
            </ResponsiveContainer>
          </ReportChartCard>
        </div>
      </section>
    </div>
  );
}

function HrHeadPayrollWorkspace({ view = "generate", user, onNavigate }) {
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

function HrHeadOvertimeWorkspace({ user }) {
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
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/hrhead/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/hrhead/profile" },
  { key: "employees", label: "Employee Directory", icon: Users, path: "/hrhead/employees" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/hrhead/messages" },
  { key: "notifications", label: "Notifications", path: "/hrhead/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  ...buildPerformanceRewardsNavItems("/hrhead"),
  /* Leave credits and COC credits are two modes of one registry, so this is a single page. */
  {
    key: "leaveBalances",
    label: "Leave & COC Balances",
    icon: ClipboardList,
    path: "/hrhead/masterfiles/leave-balances",
    permissionModule: "leaveBalance",
  },
  {
    key: "leave",
    label: "File Request",
    icon: CalendarRange,
    path: "/hrhead/leave",
    children: [
      { key: "leave", label: "Leave Request", path: "/hrhead/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/hrhead/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/hrhead/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/hrhead/leave/pass-slips" },
      { key: "overtime", label: "Overtime", path: "/hrhead/attendance/overtime" },
    ],
  },
  {
    key: "payroll",
    label: "Payroll Management",
    icon: FileText,
    path: "/hrhead/payroll/generate",
    children: [
      { key: "payrollGenerate", label: "Payroll", path: "/hrhead/payroll/generate" },
      { key: "payrollRecords", label: "Payslip", path: "/hrhead/payroll/payslip" },
      { key: "payrollLoan", label: "Loan", path: "/hrhead/payroll/loan" },
    ],
  },
  /* Reached from the Archive toggle on the registry, not from the sidebar. */
  { key: "archivedPayroll", label: "Archived Payroll", path: "/hrhead/payroll/archived", hidden: true },

  { type: "section", label: "Reports & Analytics" },
  {
    key: "reports",
    label: "Reports & Analytics",
    icon: FileText,
    path: "/hrhead/reports",
    children: buildReportNavChildren("/hrhead/reports", { exclude: HR_HEAD_HIDDEN_REPORT_CATEGORIES }),
  },
  { key: "leaveBalance", label: "Set Leave Balance", icon: ClipboardList, path: "/hrhead/leave-balance", hidden: true },
  ...buildSelfServiceNavItems("/hrhead"),
];

const modules = {
  dashboard: {
    title: "HR Head Dashboard",
    description: "Oversee workforce readiness, policy compliance, and operational reporting.",
    hidePageIntro: true,
    render: ({ user }) => <RoleAnalyticsOverview user={user} />,
  },
  messages: {
    title: "Messages",
    description: "Coordinate HR conversations and employee communication from one workspace.",
    hidePageIntro: true,
    render: ({ user }) => <BubbleChat user={user} />,
  },
  leave: {
    title: "Leave",
    description: "Review leave requests, travel orders, pass slips, and compensatory time off records from the HR head workspace.",
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
    title: "Travel Order",
    description: "Review submitted travel orders and update request outcomes from the HR head workspace.",
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
    description: "Review Chief-approved compensatory requests from every division and forward them for final approval.",
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
  overtime: {
    title: "Overtime Management",
    description: "File, review, and monitor employee overtime requests.",
    hidePageIntro: true,
    render: ({ user }) => <HrHeadOvertimeWorkspace user={user} />,
  },
  calendar: {
    title: "Calendar",
    description: "View approved employee leave and travel order schedules.",
    hidePageIntro: true,
    render: ({ onNavigate }) => (
      <LeaveTravelCalendarWorkspace
        onViewEmployeeProfile={(employee) => {
          saveEmployeeProfileHandoff(employee);
          onNavigate?.("/hrhead/employees");
        }}
      />
    ),
  },
  employees: {
    title: "Employee Management",
    description: "Add, edit, and review employee records from the HR Head workspace.",
    hidePageIntro: true,
    render: ({ user }) => <EmployeeManagementWorkspace user={user} allowAccountCreation={false} />,
  },
  attendance: {
    title: "Attendance Management",
    description: "Monitor employee logs and generate DTR forms.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="hrhead" />,
  },
  leaveBalance: {
    title: "Set Leave Balance",
    description: "Manage employee leave credits, updates, and history logs from the HR Head workspace.",
    render: ({ user }) => (
      <LeaveBalanceManagementWorkspace
        user={user}
        showEmployeeIdColumn={false}
      />
    ),
  },
  leaveBalances: {
    title: "Set Balances",
    description: "Manage employee leave credits and compensatory overtime credits, with their updates and history logs.",
    hidePageIntro: true,
    render: ({ user }) => (
      <LeaveBalanceManagementWorkspace
        user={user}
        showEmployeeIdColumn={false}
      />
    ),
  },
  payrollGenerate: {
    title: "Create Payroll",
    description: "Create payroll batches and review computed payroll totals from the HR Head workspace.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <HrHeadPayrollWorkspace view="generate" user={user} onNavigate={onNavigate} />,
  },
  payrollRecords: {
    title: "Payslip",
    description: "Review generated payslip entries and payroll details from the HR Head workspace.",
    hidePageIntro: true,
    render: ({ user }) => <HrHeadPayrollWorkspace view="payslip" user={user} />,
  },
  payrollLoan: {
    title: "Loan Management",
    description: "Review, approve, reject, and audit employee loan requests from the HR Head workspace.",
    hidePageIntro: true,
    render: ({ user }) => <FileLoan user={user} />,
  },
  archivedPayroll: {
    title: "Archived Payroll",
    description: "View archived payroll records kept for audit review.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <HrHeadPayrollWorkspace view="archived" user={user} onNavigate={onNavigate} />,
  },

  workforce: {
    title: "Workforce",
    description: "Track staffing posture and workload distribution across the organization.",
    table: {
      title: "Regional Workforce Snapshot",
      description: "High-level headcount and staffing signals.",
      columns: [
        { key: "region", header: "Region", render: (row) => row.region },
        { key: "headcount", header: "Headcount", render: (row) => row.headcount },
        { key: "vacancies", header: "Vacancies", render: (row) => row.vacancies },
        { key: "risk", header: "Risk", render: (row) => row.risk },
      ],
      rows: [
        { id: 1, region: "North Cluster", headcount: "58", vacancies: "3", risk: "Moderate" },
        { id: 2, region: "Central Cluster", headcount: "72", vacancies: "1", risk: "Low" },
        { id: 3, region: "South Cluster", headcount: "56", vacancies: "4", risk: "High" },
      ],
    },
  },
  compliance: {
    title: "Compliance",
    description: "Review policy completion and audit-critical follow-through.",
    cards: [
      {
        title: "Compliance Tasks",
        description: "Items requiring HR head visibility",
        items: [
          { label: "Mandatory orientation refresh", helper: "One division still needs final confirmation uploads.", value: "82%" },
          { label: "Document expiry tracking", helper: "A small batch of IDs will expire next month.", value: "9 files" },
          { label: "Records audit", helper: "Quarterly review has no critical blockers.", value: "Stable" },
        ],
      },
    ],
  },
  reports: {
    title: "Reports",
    description: "Prepare executive-level summaries and people analytics.",
    hidePageIntro: true,
    render: ({ user }) => <AdminReports user={user} />,
  },
  ...buildReportCategoryModules(
    (categoryKey, { user }) => <AdminReports user={user} category={categoryKey} />,
    { exclude: HR_HEAD_HIDDEN_REPORT_CATEGORIES }
  ),
  ...PERFORMANCE_REWARDS_MODULES,
  ...SELF_SERVICE_MODULES,
};

export default function HrheadDashboard(props) {
  return (
    <RoleWorkspacePage
      {...props}
      portalLabel="HR Head Workspace"
      navigationItems={navigationItems}
      modules={modules}
      contentClassName="space-y-4 p-4"
    />
  );
}
