import React, { useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  MessageCircle,
  UserRound,
} from "lucide-react";
import AdminAnalyticsOverview from "../../components/dashboard/AdminAnalyticsOverview";
import RoleWorkspacePage from "../../components/layout/RoleWorkspacePage";
import { SELF_SERVICE_MODULES, buildSelfServiceNavItems } from "../../components/layout/selfServiceModules";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import PayrollManagementWorkspace from "../../module/payroll/PayrollManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { getEmployees, getUsers } from "../../services/api";

const navigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/regionaldirector/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/regionaldirector/profile" },
  { key: "calendar", label: "Work Calendar", icon: CalendarDays, path: "/regionaldirector/calendar" },
  { type: "section", label: "Communication" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/regionaldirector/messages" },
  { key: "notifications", label: "Notifications", path: "/regionaldirector/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  {
    key: "attendance",
    label: "Time & Attendance",
    icon: ClipboardCheck,
    path: "/regionaldirector/attendance/overtime",
    children: [
      { key: "overtime", label: "Overtime", path: "/regionaldirector/attendance/overtime" },
    ],
  },
  {
    key: "leave",
    label: "Leave Management",
    icon: CalendarRange,
    path: "/regionaldirector/leave",
    children: [
      { key: "leave", label: "Leave", path: "/regionaldirector/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/regionaldirector/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/regionaldirector/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/regionaldirector/leave/pass-slips" },
    ],
  },
  {
    key: "payroll",
    label: "Payroll Management",
    icon: FileText,
    path: "/regionaldirector/payroll/generate",
    children: [
      { key: "payrollGenerate", label: "Payroll", path: "/regionaldirector/payroll/generate" },
      { key: "payrollRecords", label: "Payslip", path: "/regionaldirector/payroll/payslip" },
    ],
  },
  { key: "legacyAttendance", label: "Time & Attendance", icon: ClipboardCheck, path: "/regionaldirector/attendance", hidden: true },
  ...buildSelfServiceNavItems("/regionaldirector"),
];

/**
 * Shared wrapper that loads the employee list once and passes it into any payroll
 * sub-workspace (Create Payroll, Payslip).
 */
function RegionalPayrollWorkspace({ view = "generate", user }) {
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
        <PayslipWorkspace employees={employees} />
      ) : (
        <PayrollManagementWorkspace employees={employees} view="generate" user={user} />
      )}
    </div>
  );
}

function RegionalOvertimeWorkspace({ user }) {
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
        description="File, review, and monitor regional overtime requests."
        submitLabel="File Overtime Request"
      />
    </div>
  );
}

function moduleCards(description) {
  return [
    {
      title: "Role Workspace",
      description,
      items: [
        { label: "Dashboard aligned", helper: "This section follows the Admin sidebar structure for consistent navigation.", value: "Ready" },
        { label: "Regional scope", helper: "Regional Director access remains limited to review and visibility workflows.", value: "Scoped" },
        { label: "Reporting", helper: "Use Reports and Leave Management for regional operating signals.", value: "Available" },
      ],
    },
  ];
}

function RegionalDirectorDashboardOverview({ user }) {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      setLoading(true);

      try {
        const [employeeResult, userResult] = await Promise.allSettled([
          getEmployees(),
          getUsers(),
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
        setError(
          employeeResult.status === "rejected" || userResult.status === "rejected"
            ? "Some dashboard data could not be loaded."
            : ""
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="w-full space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}
      <AdminAnalyticsOverview
        user={user}
        employees={employees}
        users={users}
        loading={loading}
      />
    </div>
  );
}

const modules = {
  dashboard: {
    title: "Regional Director Dashboard",
    description: "Review approvals, monitor regional operations, and keep leadership visibility high across divisions.",
    hidePageIntro: true,
    render: ({ user }) => <RegionalDirectorDashboardOverview user={user} />,
  },
  leave: {
    title: "Leave",
    description: "Monitor leave requests, travel orders, pass slips, and compensatory time off records from the regional director workspace.",
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
  calendar: {
    title: "Calendar",
    description: "View approved employee leave and travel order schedules.",
    hidePageIntro: true,
    render: () => <LeaveTravelCalendarWorkspace canManageAnnouncements={false} showLegend={false} />,
  },
  travel: {
    title: "Travel Order",
    description: "Monitor travel orders from the regional director workspace.",
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
    description: "Monitor compensatory time off records from the regional director workspace.",
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
    description: "Monitor pass slip records from the regional director workspace.",
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
    title: "Attendance Monitoring",
    description: "Review regional attendance logs, missing records, summaries, and printable DTR reports.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="regionaldirector" />,
  },
  legacyAttendance: {
    title: "Attendance Monitoring",
    description: "Review regional attendance logs, missing records, summaries, and printable DTR reports.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="regionaldirector" />,
  },
  overtime: {
    title: "Overtime Management",
    description: "File, review, and monitor regional overtime requests.",
    hidePageIntro: true,
    render: ({ user }) => <RegionalOvertimeWorkspace user={user} />,
  },
  payrollGenerate: {
    title: "Create Payroll",
    description: "Create payroll batches, review and approve computed payroll totals from the Regional Director workspace.",
    hidePageIntro: true,
    render: ({ user }) => <RegionalPayrollWorkspace view="generate" user={user} />,
  },
  payrollRecords: {
    title: "Payslip",
    description: "Review generated payslip entries and payroll details from the Regional Director workspace.",
    hidePageIntro: true,
    render: ({ user }) => <RegionalPayrollWorkspace view="payslip" user={user} />,
  },
  messages: {
    title: "Messages",
    description: "Coordinate regional conversations and employee communication.",
    hidePageIntro: true,
    render: ({ user }) => <BubbleChat user={user} />,
  },
  ...SELF_SERVICE_MODULES,
};

export default function RegionalDashboard(props) {
  return (
    <RoleWorkspacePage
      {...props}
      portalLabel="Regional Director Workspace"
      navigationItems={navigationItems}
      modules={modules}
      contentClassName="space-y-4 p-4"
    />
  );
}
