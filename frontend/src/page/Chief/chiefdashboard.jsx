import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  MessageCircle,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import RoleWorkspacePage from "../../components/layout/RoleWorkspacePage";
import { SELF_SERVICE_MODULES, buildSelfServiceNavItems } from "../../components/layout/selfServiceModules";
import { PERFORMANCE_REWARDS_MODULES } from "../../components/layout/performanceRewardsModules";
import DivisionDashboardOverview from "../../components/dashboard/DivisionDashboardOverview";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import PayrollManagementWorkspace from "../../module/payroll/PayrollManagementWorkspace";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";
import IpcrManagementWorkspace from "../../module/performance/IpcrManagementWorkspace";
import OpcrManagementWorkspace from "../../module/performance/OpcrManagementWorkspace";
import AwardCyclesWorkspace from "../../module/rewards/AwardCyclesWorkspace";

import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { getEmployees } from "../../services/api";
import TeamOverview, { scopeEmployeesToChiefDivision } from "./teamoverview";

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
 * The Chief Admin's payroll desk, the second in the approval chain: batches the HR Head has approved
 * wait here before going on to the Regional Director for final approval. Only Chief Admin opens it;
 * a Division Chief has no payroll desk (see DIVISION_CHIEF_HIDDEN_NAVIGATION_KEYS). The workspace is
 * the same one HR uses, and it decides which buttons the desk gets from the role -- approve or return
 * for correction on batches sitting at its stage, and nothing on batches waiting elsewhere.
 */
function ChiefPayrollWorkspace({ user, view = "generate", onNavigate }) {
  const { employees, error } = useChiefEmployees("Unable to load employee options for payroll.");

  return (
    <div className="space-y-4">
      <ChiefEmployeeLoadError error={error} />
      <PayrollManagementWorkspace employees={employees} view={view} user={user} onNavigate={onNavigate} />
    </div>
  );
}

/*
 * A chief's IPCR desk is scoped to the chief's own division. Chiefs review and rate the records;
 * IPCR creation belongs to the HR Head.
 */
function ChiefIpcrWorkspace({ user }) {
  const { employees, error } = useChiefEmployees("Unable to load your division's employees for IPCR review.");
  const divisionEmployees = useMemo(() => scopeEmployeesToChiefDivision(employees, user), [employees, user]);

  return (
    <div className="space-y-4">
      <ChiefEmployeeLoadError error={error} />
      {!String(user?.division || "").trim() ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Your employee record is not assigned to a division, so division IPCR records cannot be shown yet.
        </div>
      ) : null}
      <IpcrManagementWorkspace employees={divisionEmployees} mode="chief" canAssign={false} division={user?.division} />
    </div>
  );
}

/*
 * A chief's OPCR desk: the forms assigned to the chief's own division, whoever assigned them, so a
 * KPI the HR Head bulk-assigns to several divisions is listed on each of their chiefs' desks. A
 * chief writes the accomplishments, attaches the MOVs, and submits them to the Regional Director,
 * who validates and rates them; the chief may also file further commitments for their own division
 * through Bulk Assign KPI. Rewriting or retiring one stays with HR (opcr_apply_read_scope(),
 * opcr_submit_accomplishment(), opcr_create_records(), and opcr_can_manage() in backend/api/opcr.php).
 */
function ChiefOpcrWorkspace({ user }) {
  const division = String(user?.division || "").trim();

  return (
    <div className="space-y-4">
      {!division ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Your employee record is not assigned to a division, so division OPCR forms cannot be shown yet.
        </div>
      ) : null}
      <OpcrManagementWorkspace mode="chief" division={division} canManage={false} canAssign />
    </div>
  );
}

/*
 * A chief's ballot. The whole directory is still handed down so the podium and the voters table
 * can name nominees from every division, but the people this chief may nominate are their own
 * division only; rewards.php refuses anyone outside it.
 */
function ChiefNominationWorkspace({ user }) {
  const { employees, error } = useChiefEmployees("Unable to load the employee directory for nominations.");
  const division = String(user?.division || "").trim();

  return (
    <div className="space-y-4">
      <ChiefEmployeeLoadError error={error} />
      {!division ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Your employee record is not assigned to a division, so there is nobody to nominate yet.
        </div>
      ) : null}
      <AwardCyclesWorkspace user={user} employees={employees} nomineeDivision={division} />
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
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/chief/messages" },
  { key: "notifications", label: "Notifications", path: "/chief/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  /*
   * Same address shape as HR's Performance Reviews group so the notification routes and the known
   * path list read alike across roles. The parent points at OPCR the way Admin's and HR's do. A
   * chief submits the OPCR accomplishments and MOVs for the Regional Director to validate, and assigns
   * IPCR targets to their own division.
   */
  {
    key: "performanceManagement",
    label: "Performance Reviews",
    icon: BarChart3,
    path: "/chief/masterfiles/performance-management/opcr",
    children: [
      { key: "performanceOpcr", label: "OPCR", path: "/chief/masterfiles/performance-management/opcr" },
      { key: "performanceIpcr", label: "IPCR", path: "/chief/masterfiles/performance-management/ipcr" },
    ],
  },
  /* Prepares promotions for the division's Regular employees; the HR Head and Regional Director sign. */
  { key: "promotions", label: "Promotions", icon: TrendingUp, path: "/chief/promotions" },
  {
    key: "rewardsRecognition",
    label: "Recognition & Rewards",
    icon: Trophy,
    path: "/chief/rewards-recognition/nomination",
    children: [
      {
        key: "rewardsNomination",
        label: "Nomination",
        path: "/chief/rewards-recognition/nomination",
      },
    ],
  },
  {
    key: "leave",
    label: "File Request",
    icon: CalendarRange,
    path: "/chief/leave",
    children: [
      { key: "leave", label: "Leave Request", path: "/chief/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/chief/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/chief/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/chief/leave/pass-slips" },
      { key: "overtime", label: "Overtime", path: "/chief/attendance/overtime" },
    ],
  },
  /*
   * Chief Admin's payroll desk; the Division Chief's own workspace leaves this and Archived Payroll
   * out. The desk only ever approves batches sitting at it -- payslips and loans are HR/Admin
   * workflows -- so this stays a single entry rather than a group with one live child. The key stays
   * "payroll" because the sidebar's pending badge keys off it.
   */
  { key: "payroll", label: "Payroll", icon: FileText, path: "/chief/payroll/generate" },
  /* Reached from the Archive toggle on the registry, not from the sidebar. */
  { key: "archivedPayroll", label: "Archived Payroll", path: "/chief/payroll/archived", hidden: true },

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
    description: "Review compensatory time off requests assigned to your desk and forward approved requests to the next approver.",
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
    render: ({ user, onNavigate }) => <ChiefPayrollWorkspace user={user} onNavigate={onNavigate} />,
  },
  archivedPayroll: {
    title: "Archived Payroll",
    description: "View archived payroll records kept for audit review.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <ChiefPayrollWorkspace user={user} view="archived" onNavigate={onNavigate} />,
  },

  /* The shared register; the API and the form confine a chief to their own division. */
  promotions: {
    ...PERFORMANCE_REWARDS_MODULES.promotions,
    description: "Prepare promotions for Regular employees of your division and follow them through the HR Head and Regional Director.",
  },

  /* The shared screen, but with the ballot drawn from the chief's own division. */
  rewardsNomination: {
    ...PERFORMANCE_REWARDS_MODULES.rewardsNomination,
    description: "Nominate colleagues from your division for awards and follow the results.",
    render: ({ user }) => <ChiefNominationWorkspace user={user} />,
  },

  performanceOpcr: {
    title: "OPCR",
    description: "Record the accomplishments and MOVs for the OPCR forms assigned to your division, and submit them to the Regional Director for validation.",
    hidePageIntro: true,
    render: ({ user }) => <ChiefOpcrWorkspace user={user} />,
  },

  performanceIpcr: {
    title: "IPCR",
    description: "Review and rate IPCR targets for your division.",
    hidePageIntro: true,
    render: ({ user }) => <ChiefIpcrWorkspace user={user} />,
  },

  ...SELF_SERVICE_MODULES,
};

/*
 * A Division Chief has no payroll desk -- the Chief Admin gives the second payroll approval -- so the
 * chief's own workspace leaves both payroll entries out, and roleRoutes.js no longer lists their
 * addresses. Chief Admin passes its own set.
 */
const DIVISION_CHIEF_HIDDEN_NAVIGATION_KEYS = ["payroll", "archivedPayroll"];
/*
 * The Division Chief's own dashboard leaves out the request charts, the Travel & Leave list, and
 * the Out Today card; those requests are worked in Leave Management. It counts them instead, as
 * Pending and Approved summary cards. Chief Admin passes its own set.
 */
const DEFAULT_DASHBOARD_OVERVIEW_PROPS = {
  showRequestCharts: false,
  showTravelLeaveSection: false,
  showOutTodayCard: false,
  pendingCardLabel: "Pending",
  showApprovedCard: true,
};

export default function ChiefDashboard({
  portalLabel = "Chief Workspace",
  hiddenNavigationKeys = DIVISION_CHIEF_HIDDEN_NAVIGATION_KEYS,
  dashboardOverviewProps = DEFAULT_DASHBOARD_OVERVIEW_PROPS,
  ...props
}) {
  const configuredNavigationItems = useMemo(() => {
    const hiddenKeys = new Set(hiddenNavigationKeys);
    return hiddenKeys.size
      ? navigationItems.filter((item) => !item.key || !hiddenKeys.has(item.key))
      : navigationItems;
  }, [hiddenNavigationKeys]);

  const configuredModules = useMemo(() => ({
    ...modules,
    dashboard: {
      ...modules.dashboard,
      render: ({ user, onNavigate }) => (
        <DivisionDashboardOverview
          user={user}
          onNavigate={onNavigate}
          leavePath="/chief/leave"
          {...dashboardOverviewProps}
        />
      ),
    },
  }), [dashboardOverviewProps]);

  return (
    <RoleWorkspacePage
      {...props}
      portalLabel={portalLabel}
      navigationItems={configuredNavigationItems}
      modules={configuredModules}
      contentClassName="space-y-4 p-4"
    />
  );
}
