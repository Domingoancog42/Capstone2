import React, { useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  MessageCircle,
  UserRound,
  Users,
} from "lucide-react";
import RoleWorkspacePage from "../../components/layout/RoleWorkspacePage";
import { SELF_SERVICE_MODULES, buildSelfServiceNavItems } from "../../components/layout/selfServiceModules";
import RoleAnalyticsOverview from "../../components/dashboard/RoleAnalyticsOverview";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import LeaveMonetizationWorkspace from "../../module/payroll/LeaveMonetizationWorkspace";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";

import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { getEmployees } from "../../services/api";
import TeamOverview from "./teamoverview";

function ChiefOvertimeWorkspace({ user }) {
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
        description="File, review, and monitor division overtime requests."
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
        { label: "Role scope", helper: "Chief access remains limited to division-safe records and review workflows.", value: "Scoped" },
        { label: "Reporting", helper: "Use Reports and Leave Management for operational visibility.", value: "Available" },
      ],
    },
  ];
}

const navigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/chief/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/chief/profile" },
  { key: "employees", label: "Employee Directory", icon: Users, path: "/chief/employees" },
  { key: "calendar", label: "Work Calendar", icon: CalendarDays, path: "/chief/calendar" },
  { type: "section", label: "Communication" },
  { key: "messages", label: "Communications", icon: MessageCircle, path: "/chief/messages" },
  { key: "notifications", label: "Notifications", path: "/chief/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  {
    key: "attendance",
    label: "Time & Attendance",
    icon: ClipboardCheck,
    path: "/chief/attendance/overtime",
    children: [
      { key: "overtime", label: "Overtime", path: "/chief/attendance/overtime" },
    ],
  },
  {
    key: "leave",
    label: "Leave Administration",
    icon: CalendarRange,
    path: "/chief/leave",
    children: [
      { key: "leave", label: "Leave", path: "/chief/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/chief/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/chief/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/chief/leave/pass-slips" },
    ],
  },
  {
    key: "payroll",
    label: "Payroll Management",
    icon: FileText,
    path: "/chief/payroll/generate",
    children: [
      { key: "payrollGenerate", label: "Create Payroll", path: "/chief/payroll/generate" },
      { key: "payrollRecords", label: "Payslip", path: "/chief/payroll/payslip" },
      { key: "payrollLoan", label: "Loan", path: "/chief/payroll/loan" },
      { key: "payrollCashAdvance", label: "Cash Advance", path: "/chief/payroll/cash-advance" },
      { key: "payrollLeaveMonetization", label: "Leave Monetization", path: "/chief/payroll/leave-monetization" },
    ],
  },

  { key: "team", label: "Team Overview", icon: Users, path: "/chief/team", hidden: true },
  { key: "legacyAttendance", label: "Time & Attendance", icon: ClipboardCheck, path: "/chief/attendance", hidden: true },
  ...buildSelfServiceNavItems("/chief"),
];

const modules = {
  dashboard: {
    title: "Chief Dashboard",
    description: "Track division output, pending approvals, and staffing priorities from one operational view.",
    hidePageIntro: true,
    render: ({ user }) => <RoleAnalyticsOverview user={user} />,
  },
  leave: {
    title: "Leave",
    description: "Review leave requests, travel orders, pass slips, and compensatory time off records from the chief workspace.",
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
    description: "Review submitted travel orders from the chief workspace.",
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
    description: "Review compensatory time off requests from the chief workspace.",
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
    description: "Review pass slip records from the chief workspace.",
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
    description: "Monitor division attendance, missing logs, DTR records, and daily status trends.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="chief" />,
  },
  legacyAttendance: {
    title: "Attendance Monitoring",
    description: "Monitor division attendance, missing logs, DTR records, and daily status trends.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="chief" />,
  },
  overtime: {
    title: "Overtime Management",
    description: "File, review, and monitor division overtime requests.",
    hidePageIntro: true,
    render: ({ user }) => <ChiefOvertimeWorkspace user={user} />,
  },
  employees: {
    title: "Employees",
    description: "Monitor workload and visibility across direct reports.",
    hidePageIntro: true,
    render: ({ user }) => <TeamOverview user={user} />,
  },
  calendar: {
    title: "Calendar",
    description: "View approved employee leave and travel order schedules.",
    hidePageIntro: true,
    render: () => <LeaveTravelCalendarWorkspace canManageAnnouncements={false} showLegend={false} />,
  },
  messages: {
    title: "Messages",
    description: "Coordinate division conversations and employee communication.",
    hidePageIntro: true,
    render: ({ user }) => <BubbleChat user={user} />,
  },
  team: {
    title: "Team Overview",
    description: "Monitor workload and visibility across direct reports.",
    hidePageIntro: true,
    render: ({ user }) => <TeamOverview user={user} />,
  },
  payrollGenerate: {
    title: "Create Payroll",
    description: "Review payroll workspace availability.",
    cards: moduleCards("Payroll generation remains governed by HR/Admin workflows."),
  },
  payrollRecords: {
    title: "Payslip",
    description: "Review payroll record workspace availability.",
    cards: moduleCards("Payslip management remains governed by HR/Admin workflows."),
  },
  payrollLoan: {
    title: "Loan",
    description: "Review loan workspace availability.",
    cards: moduleCards("Loan request review remains governed by HR workflows."),
  },
  payrollCashAdvance: {
    title: "Cash Advance",
    description: "Review cash advance workspace availability.",
    cards: moduleCards("Cash advance processing remains governed by HR/Admin workflows."),
  },
  payrollLeaveMonetization: {
    title: "Leave Monetization",
    description: "Monitor leave monetization requests filed by employees.",
    hidePageIntro: true,
    render: ({ user }) => <LeaveMonetizationWorkspace user={user} />,
  },

  ...SELF_SERVICE_MODULES,
};

export default function ChiefDashboard(props) {
  return (
    <RoleWorkspacePage
      {...props}
      portalLabel="Chief Workspace"
      navigationItems={navigationItems}
      modules={modules}
      contentClassName="space-y-4 p-4"
    />
  );
}
