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
import DivisionDashboardOverview from "../../components/dashboard/DivisionDashboardOverview";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import PayrollManagementWorkspace from "../../module/payroll/PayrollManagementWorkspace";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";

import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { getEmployees } from "../../services/api";
import TeamOverview from "./teamoverview";

function useChiefEmployees(errorMessage) {
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
          setError(requestError.response?.data?.message || errorMessage);
        }
      }
    };

    void loadEmployees();

    return () => {
      active = false;
    };
  }, [errorMessage]);

  return { employees, error };
}

function ChiefEmployeeLoadError({ error }) {
  if (!error) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
      {error}
    </div>
  );
}

function ChiefOvertimeWorkspace({ user }) {
  const { employees, error } = useChiefEmployees("Unable to load employee options for overtime.");

  return (
    <div className="space-y-4">
      <ChiefEmployeeLoadError error={error} />
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

/*
 * A chief is the second desk in the payroll approval chain: batches the HR Head has approved wait
 * here before going on to the Regional Director for final approval. The workspace is the same one
 * HR uses, and it decides which buttons a chief gets from their role -- approve or return for
 * correction on batches sitting at their stage, and nothing on batches waiting elsewhere.
 */
function ChiefPayrollWorkspace({ user }) {
  const { employees, error } = useChiefEmployees("Unable to load employee options for payroll.");

  return (
    <div className="space-y-4">
      <ChiefEmployeeLoadError error={error} />
      <PayrollManagementWorkspace employees={employees} view="generate" user={user} />
    </div>
  );
}

// The travel order form lets a chief pick the employees travelling, so this view needs the
// employee directory that the other chief LeaveDashboard views do not load.
function ChiefTravelWorkspace({ user }) {
  const { employees, error } = useChiefEmployees("Unable to load employee options for travel orders.");

  return (
    <div className="space-y-4">
      <ChiefEmployeeLoadError error={error} />
      <LeaveDashboard
        user={user}
        employees={employees}
        leaveRequestLayout="management"
        activeView="travel"
        showRequestTabs={false}
      />
    </div>
  );
}

const navigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/chief/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/chief/profile" },
  { key: "employees", label: "Team/Division Employee", icon: Users, path: "/chief/employees" },
  { key: "calendar", label: "Work Calendar", icon: CalendarDays, path: "/chief/calendar" },
  { type: "section", label: "Communication" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/chief/messages" },
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
    label: "Leave Management",
    icon: CalendarRange,
    path: "/chief/leave",
    children: [
      { key: "leave", label: "Leave", path: "/chief/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/chief/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/chief/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/chief/leave/pass-slips" },
    ],
  },
  /*
   * A chief only ever approves payroll batches sitting at their desk -- payslips and loans are
   * HR/Admin workflows -- so this stays a single entry rather than a group with one live child.
   * The key stays "payroll" because the sidebar's pending badge keys off it.
   */
  { key: "payroll", label: "Payroll", icon: FileText, path: "/chief/payroll/generate" },

  { key: "team", label: "Team Overview", icon: Users, path: "/chief/team", hidden: true },
  { key: "legacyAttendance", label: "Time & Attendance", icon: ClipboardCheck, path: "/chief/attendance", hidden: true },
  ...buildSelfServiceNavItems("/chief"),
];

const modules = {
  dashboard: {
    title: "Chief Dashboard",
    description: "Track division output, pending approvals, and staffing priorities from one operational view.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => (
      <DivisionDashboardOverview
        user={user}
        onNavigate={onNavigate}
        directoryPath="/chief/employees"
        leavePath="/chief/leave"
      />
    ),
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
    description: "File travel orders for division employees and review submitted requests.",
    hidePageIntro: true,
    render: ({ user }) => <ChiefTravelWorkspace user={user} />,
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
    title: "Team/Division Employee",
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
    // BubbleChat sizes itself against its parent (scrolling contact list, scrolling thread, composer
    // pinned to the bottom), so it needs the shell's full-height container the way Admin's does.
    fitViewport: true,
    render: ({ user }) => <BubbleChat user={user} />,
  },
  team: {
    title: "Team Overview",
    description: "Monitor workload and visibility across direct reports.",
    hidePageIntro: true,
    render: ({ user }) => <TeamOverview user={user} />,
  },
  payroll: {
    title: "Payroll",
    description: "Review and approve payroll batches forwarded by the HR Head.",
    hidePageIntro: true,
    render: ({ user }) => <ChiefPayrollWorkspace user={user} />,
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
