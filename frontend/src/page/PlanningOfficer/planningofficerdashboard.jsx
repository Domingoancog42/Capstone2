import React, { useEffect, useState } from "react";
import {
  CalendarRange,
  ClipboardCheck,
  LayoutDashboard,
  MessageCircle,
  UserRound,
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
import { isLeaveDivisionDesk } from "../../utils/leaveHelpers";

/*
 * A planning officer works much the same desk a chief does: the same analytics, the same leave and
 * attendance review screens. Two things are deliberately absent from this sidebar. Payroll -- the
 * approval chain runs HR Head -> FAD Division Chief -> Regional Director and a planning officer is not one
 * of its desks. And the Team/Division Employee roster -- the planning officer is an organization-wide
 * desk rather than one division's, so the dashboard's employee list (every division) covers it.
 * Nothing else about the two workspaces is meant to drift apart.
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

// The Planning Officer is the organization-wide dispatch desk, so this view loads every travel
// order regardless of the traveller's division.
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
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/planningofficer/messages" },
  { key: "notifications", label: "Notifications", path: "/planningofficer/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  {
    key: "leave",
    label: "File Request",
    icon: CalendarRange,
    path: "/planningofficer/leave",
    children: [
      { key: "leave", label: "Leave Request", path: "/planningofficer/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/planningofficer/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/planningofficer/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/planningofficer/leave/pass-slips" },
      { key: "overtime", label: "Overtime Request", path: "/planningofficer/attendance/overtime" },
    ],
  },

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
        leavePath="/planningofficer/leave"
        organizationWide
      />
    ),
  },
  leave: {
    title: "Leave",
    description: "Review leave requests, travel orders, pass slips, and compensatory time off records from the planning workspace.",
    hidePageIntro: true,
    /*
     * A self-service filing page by default. Once an administrator grants Leave Management
     * approve or reject under Settings > Roles, the Planning Officer works their division's
     * requests at the Chief's stage and this becomes that register (own filings under My Leave).
     */
    render: ({ user }) => (
      <LeaveDashboard
        user={user}
        leaveRequestLayout="management"
        activeView="leave"
        showRequestTabs={false}
        showOnlyOwnLeaveRequests={!isLeaveDivisionDesk(user)}
      />
    ),
  },
  travel: {
    title: "Travel Order",
    description: "Review travel orders from every division and authorize them for dispatch.",
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
