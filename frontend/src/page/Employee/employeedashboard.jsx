import React, { useEffect, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  Clock3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ScrollText,
  Trophy,
  UserRound,
} from "lucide-react";
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
import AwardCyclesWorkspace from "../../module/rewards/AwardCyclesWorkspace";
import ServiceRecordWorkspace from "../../module/serviceRecord/ServiceRecordWorkspace";
import PasswordExpiryModal from "../../components/auth/PasswordExpiryModal";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";
import EmployeeAnalyticsOverview from "../../components/dashboard/EmployeeAnalyticsOverview";

import { checkPasswordExpiry } from "../../services/api";

/**
 * The dashboard body itself lives in `EmployeeAnalyticsOverview` — the same shape as the admin
 * dashboard's `AdminAnalyticsOverview`, scoped to the signed-in employee's own records. This
 * wrapper only owns the password-expiry prompt, which is dashboard-entry behaviour rather than
 * anything the analytics need to know about.
 */
function EmployeeDashboardOverview({ user, onNavigate }) {
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

  const handleChangePassword = () => {
    setPasswordExpiryModalOpen(false);

    if (onNavigate) {
      onNavigate("/employee/profile");
      return;
    }

    window.location.href = "/employee/profile";
  };

  return (
    /* w-full, not a max-width: the shell's content container already sets the page width. */
    <div className="w-full">
      <PasswordExpiryModal
        open={passwordExpiryModalOpen}
        daysUntilExpiry={daysUntilExpiry}
        onClose={() => setPasswordExpiryModalOpen(false)}
        onChangePassword={handleChangePassword}
      />

      <EmployeeAnalyticsOverview user={user} onNavigate={onNavigate} />
    </div>
  );
}

const navigationItems = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/employee/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/employee/profile" },
  { key: "calendar", label: "Work Calendar", icon: CalendarDays, path: "/employee/calendar" },
  { key: "attendance", label: "Time & Attendance", icon: Clock3, path: "/employee/attendance" },
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
  { key: "myNomination", label: "Nominate", icon: Trophy, path: "/employee/nominate" },
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
    hidePageIntro: true,
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
  // Voting only — creating and closing cycles stays on the HR screen. See `SELF_SERVICE_MODULES`,
  // which gives the other roles this exact screen; Employee keeps its own module map.
  myNomination: {
    title: "Nominate",
    description: "Vote in the open award cycles and follow the leaderboard.",
    hidePageIntro: true,
    render: ({ user }) => <AwardCyclesWorkspace user={user} canManage={false} />,
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
      /*
       * Same content container as HR Head, HR Staff, Chief, and Regional Director. Without it the
       * shell falls back to `mx-auto max-w-7xl`, which centres the workspace and leaves the empty
       * gutters the other roles don't have — the tables need the full column to line up with theirs.
       */
      contentClassName="space-y-4 p-4"
    />
  );
}
