import React, { useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
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
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";

import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { getEmployees } from "../../services/api";
import TeamOverview from "../Chief/teamoverview";

/*
 * A planning officer works the same division desk a chief does: the same analytics, the same leave
 * and attendance review screens, the same team visibility. The one deliberate difference is payroll
 * -- the approval chain runs HR Head -> Chief -> Regional Director and a planning officer is not one
 * of its desks, so the Payroll Management section the chief sidebar carries is absent here. Nothing
 * else about the two workspaces is meant to drift apart.
 */

function usePlanningOfficerEmployees(errorMessage) {
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

function PlanningOfficerEmployeeLoadError({ error }) {
  if (!error) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
      {error}
    </div>
  );
}

function PlanningOfficerOvertimeWorkspace({ user }) {
  const { employees, error } = usePlanningOfficerEmployees("Unable to load employee options for overtime.");

  return (
    <div className="space-y-4">
      <PlanningOfficerEmployeeLoadError error={error} />
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

// The travel order form lets a planning officer pick the employees travelling, so this view needs
// the employee directory that the other LeaveDashboard views do not load.
function PlanningOfficerTravelWorkspace({ user }) {
  const { employees, error } = usePlanningOfficerEmployees("Unable to load employee options for travel orders.");

  return (
    <div className="space-y-4">
      <PlanningOfficerEmployeeLoadError error={error} />
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
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/planningofficer/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/planningofficer/profile" },
  { key: "employees", label: "Team/Division Employee", icon: Users, path: "/planningofficer/employees" },
  { key: "calendar", label: "Work Calendar", icon: CalendarDays, path: "/planningofficer/calendar" },
  { type: "section", label: "Communication" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/planningofficer/messages" },
  { key: "notifications", label: "Notifications", path: "/planningofficer/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  {
    key: "attendance",
    label: "Time & Attendance",
    icon: ClipboardCheck,
    path: "/planningofficer/attendance/overtime",
    children: [
      { key: "overtime", label: "Overtime", path: "/planningofficer/attendance/overtime" },
    ],
  },
  {
    key: "leave",
    label: "Leave Management",
    icon: CalendarRange,
    path: "/planningofficer/leave",
    children: [
      { key: "leave", label: "Leave", path: "/planningofficer/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/planningofficer/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/planningofficer/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/planningofficer/leave/pass-slips" },
    ],
  },

  { key: "team", label: "Team Overview", icon: Users, path: "/planningofficer/team", hidden: true },
  { key: "legacyAttendance", label: "Time & Attendance", icon: ClipboardCheck, path: "/planningofficer/attendance", hidden: true },
  ...buildSelfServiceNavItems("/planningofficer"),
];

const modules = {
  dashboard: {
    title: "Planning Officer Dashboard",
    description: "Track division output, pending approvals, and staffing priorities from one operational view.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => (
      <DivisionDashboardOverview
        user={user}
        onNavigate={onNavigate}
        directoryPath="/planningofficer/employees"
        leavePath="/planningofficer/leave"
      />
    ),
  },
  leave: {
    title: "Leave",
    description: "Review leave requests, travel orders, pass slips, and compensatory time off records from the planning workspace.",
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
    render: ({ user }) => <PlanningOfficerTravelWorkspace user={user} />,
  },
  cto: {
    title: "Compensatory Time Off",
    description: "Review compensatory time off requests from the planning workspace.",
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
    description: "Review pass slip records from the planning workspace.",
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
    render: ({ user }) => <PlanningOfficerOvertimeWorkspace user={user} />,
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
    render: ({ user }) => <BubbleChat user={user} />,
  },
  team: {
    title: "Team Overview",
    description: "Monitor workload and visibility across direct reports.",
    hidePageIntro: true,
    render: ({ user }) => <TeamOverview user={user} />,
  },

  ...SELF_SERVICE_MODULES,
};

export default function PlanningOfficerDashboard(props) {
  return (
    <RoleWorkspacePage
      {...props}
      portalLabel="Planning Officer Workspace"
      navigationItems={navigationItems}
      modules={modules}
      contentClassName="space-y-4 p-4"
    />
  );
}
