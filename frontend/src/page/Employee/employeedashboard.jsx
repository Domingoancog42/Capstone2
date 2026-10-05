import React, { useEffect, useState } from "react";
import {
  CalendarClock,
  Clock3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageCircle,
  ScrollText,
  TrendingUp,
  Trophy,
  UserRound,
  Vote,
} from "lucide-react";
import RoleWorkspacePage from "../../components/layout/RoleWorkspacePage";
import EmployeeLeaveWorkspace from "../../module/leave/EmployeeLeaveWorkspace";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import TravelOrderWorkspace from "../../module/travel/TravelOrderWorkspace";
import PassSlipWorkspace from "../../module/passslip/PassSlipWorkspace";
import CompensatoryWorkspace from "../../module/compensatory/CompensatoryWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import EmployeeIpcrWorkspace from "../../module/performance/EmployeeIpcrWorkspace";
import ServiceRecordWorkspace from "../../module/serviceRecord/ServiceRecordWorkspace";
import PromotionWorkspace from "../../module/promotion/PromotionWorkspace";
import MyRewardsWorkspace from "../../module/rewards/MyRewardsWorkspace";
import EmployeeVotingWorkspace from "../../module/rewards/EmployeeVotingWorkspace";
import usePromotionGreeting from "../../module/promotion/usePromotionGreeting";
import PasswordExpiryModal from "../../components/auth/PasswordExpiryModal";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";
import EmployeeAnalyticsOverview from "../../components/dashboard/EmployeeAnalyticsOverview";
import BubbleChat from "../../components/bubble_chat/bubble_chat";

import { checkPasswordExpiry } from "../../services/api";

/**
 * The dashboard body itself lives in `EmployeeAnalyticsOverview` — the same shape as the admin
 * dashboard's `AdminAnalyticsOverview`, scoped to the signed-in employee's own records. This
 * wrapper only owns the dashboard-entry prompts — the promotion congratulations and the
 * password-expiry warning — which are not anything the analytics need to know about.
 */
function EmployeeDashboardOverview({ user, onNavigate }) {
  const [passwordExpiryModalOpen, setPasswordExpiryModalOpen] = useState(false);
  const [daysUntilExpiry, setDaysUntilExpiry] = useState(null);

  /*
   * A promotion the Regional Director approved since the employee last looked is celebrated the
   * moment the dashboard opens. The password-expiry modal waits until that card is closed, so the
   * two prompts never sit on top of each other.
   */
  const promotionGreetingSettled = usePromotionGreeting({
    user,
    onNavigate,
    promotionsPath: "/employee/promotions",
  });

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
        open={passwordExpiryModalOpen && promotionGreetingSettled}
        daysUntilExpiry={daysUntilExpiry}
        onClose={() => setPasswordExpiryModalOpen(false)}
        onChangePassword={handleChangePassword}
      />

      <EmployeeAnalyticsOverview user={user} onNavigate={onNavigate} />
    </div>
  );
}

const navigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/employee/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/employee/profile" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/employee/messages" },
  { key: "notifications", label: "Notifications", path: "/employee/notifications", hidden: true },
  { type: "section", label: "Requests" },
  {
    key: "leave",
    label: "File Request",
    icon: CalendarClock,
    path: "/employee/leave-request",
    children: [
      { key: "leave", label: "Leave Request", path: "/employee/leave-request", exact: true },
      { key: "travel", label: "Travel Order", path: "/employee/travel-order" },
      { key: "passSlip", label: "Pass Slips", path: "/employee/pass-slips" },
      { key: "cto", label: "Compensatory Time Off", path: "/employee/compensatory-time-off" },
      { key: "overtime", label: "Overtime Request", path: "/employee/overtime" },
    ],
  },
  { type: "section", label: "My Records" },
  { key: "attendance", label: "My DTR", icon: Clock3, path: "/employee/attendance" },
  { key: "payslip", label: "My Payslip", icon: FileText, path: "/employee/payslip" },
  { key: "ipcr", label: "My IPCR", icon: ClipboardList, path: "/employee/ipcr" },
  { key: "serviceRecord", label: "My Service Record", icon: ScrollText, path: "/employee/service-record" },
  { key: "promotions", label: "My Promotion", icon: TrendingUp, path: "/employee/promotions" },
  { key: "myRewards", label: "My Rewards", icon: Trophy, path: "/employee/rewards" },
  { key: "awardVoting", label: "Award Voting", icon: Vote, path: "/employee/voting" },
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
  messages: {
    title: "Messages",
    description: "Message colleagues across Mines and Geosciences Bureau.",
    hidePageIntro: true,
    // BubbleChat sizes itself against its parent (scrolling contact list, scrolling thread, composer
    // pinned to the bottom), so it needs the shell's full-height container the way Admin's does.
    fitViewport: true,
    render: ({ user }) => <BubbleChat user={user} />,
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
        allowCreate
      />
    ),
  },
  passSlip: {
    title: "Pass Slips",
    description: "Create and review your pass slips.",
    hidePageIntro: true,
    render: ({ user }) => (
      <PassSlipWorkspace
        user={user}
        title="Pass Slip Requests"
        description="Create and review your pass slips."
        submitLabel="Create Pass Slip"
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
        submitLabel="File CTO"
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
  promotions: {
    title: "My Promotion",
    description: "The promotions that took effect on your appointment, with the position and salary each one moved you to.",
    // The workspace carries its own "My Promotion" heading and description.
    hidePageIntro: true,
    render: ({ user }) => <PromotionWorkspace user={user} mode="employee" />,
  },
  myRewards: {
    title: "My Rewards",
    description: "The awards you have won through Rewards & Recognition, with their certificates.",
    // The workspace carries its own "My Rewards" heading and description.
    hidePageIntro: true,
    render: () => <MyRewardsWorkspace />,
  },
  awardVoting: {
    title: "Award Voting",
    description: "Vote for one of the nominees HR approved for each award.",
    // The workspace carries its own "Award Voting" heading and description.
    hidePageIntro: true,
    render: () => <EmployeeVotingWorkspace />,
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
      /*
       * Same content container as HR Head, HR Staff, Chief, and Regional Director. Without it the
       * shell falls back to `mx-auto max-w-7xl`, which centres the workspace and leaves the empty
       * gutters the other roles don't have — the tables need the full column to line up with theirs.
       */
      contentClassName="space-y-4 p-4"
    />
  );
}
