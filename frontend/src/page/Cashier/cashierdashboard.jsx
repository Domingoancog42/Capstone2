import React, { useEffect, useState } from "react";
import {
  CalendarRange,
  FileText,
  LayoutDashboard,
  MessageCircle,
  UserRound,
} from "lucide-react";
import RoleWorkspacePage from "../../components/layout/RoleWorkspacePage";
import { SELF_SERVICE_MODULES, buildSelfServiceNavItems } from "../../components/layout/selfServiceModules";
import CashierDashboardOverview from "../../components/dashboard/CashierDashboardOverview";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import TravelOrderWorkspace from "../../module/travel/TravelOrderWorkspace";
import PassSlipWorkspace from "../../module/passslip/PassSlipWorkspace";
import CompensatoryWorkspace from "../../module/compensatory/CompensatoryWorkspace";
import PayrollManagementWorkspace from "../../module/payroll/PayrollManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import FileLoan from "../../module/Loan/fileloan";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";

import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { getEmployees } from "../../services/api";

/*
 * The cashier is the payout desk, and only that.
 *
 * A payroll batch climbs three approval rungs before it reaches this workspace -- HR Head, Chief
 * Admin, then the Regional Director -- and none of them are the cashier's. What lands here is a batch
 * already marked Approved, waiting for the money to actually move; marking it Paid is the one
 * transition this role owns (PAYROLL_PAYOUT_ROLES in payroll.php, and the matching
 * PAYOUT_DESK_ROLE_KEYS in PayrollManagementWorkspace). That is also why the register already
 * prints them: the "paidBy" signatory slot is titled "Administrative Officer III (Cashier)".
 *
 * The rest of the sidebar is the paperwork that rides along with a payout -- payslips, loans, cash
 * advances, and monetized leave are all deducted from or paid out with the same batch, so the desk
 * needs to read them. It cannot approve any of them; those stay with HR and the Regional Director.
 */

function CashierPayrollWorkspace({ view = "generate", user, onNavigate }) {
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

const navigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/cashier/dashboard" },
  { key: "profile", label: "My Profile", icon: UserRound, path: "/cashier/profile" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/cashier/messages" },
  { key: "notifications", label: "Notifications", path: "/cashier/notifications", hidden: true },
  { type: "section", label: "Requests" },
  {
    key: "leave",
    label: "File Request",
    icon: CalendarRange,
    path: "/cashier/leave",
    children: [
      { key: "leave", label: "Leave Request", path: "/cashier/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/cashier/leave/travel-order" },
      { key: "passSlip", label: "Pass Slips", path: "/cashier/leave/pass-slips" },
      { key: "cto", label: "Compensatory Time Off", path: "/cashier/leave/compensatory-time-off" },
    ],
  },
  { type: "section", label: "Disbursement" },
  {
    key: "payroll",
    label: "Payroll Management",
    icon: FileText,
    path: "/cashier/payroll/generate",
    children: [
      { key: "payrollGenerate", label: "Payroll", path: "/cashier/payroll/generate" },
      { key: "payrollRecords", label: "Payslip", path: "/cashier/payroll/payslip" },
      { key: "payrollLoan", label: "Loan", path: "/cashier/payroll/loan" },
    ],
  },
  /* Reached from the Archive toggle on the registry, not from the sidebar. */
  { key: "archivedPayroll", label: "Archived Payroll", path: "/cashier/payroll/archived", hidden: true },
  ...buildSelfServiceNavItems("/cashier"),
];

const modules = {
  dashboard: {
    title: "Cashier Dashboard",
    description: "Track approved payroll waiting for release and monitor disbursement activity.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <CashierDashboardOverview user={user} onNavigate={onNavigate} />,
  },
  leave: {
    title: "Leave Request",
    description: "File and monitor your personal leave requests.",
    hidePageIntro: true,
    render: ({ user }) => (
      <LeaveDashboard
        user={user}
        leaveRequestLayout="management"
        activeView="leave"
        showRequestTabs={false}
        showOnlyOwnLeaveRequests
      />
    ),
  },
  travel: {
    title: "Travel Order",
    description: "File and monitor travel orders under your employee account.",
    hidePageIntro: true,
    render: ({ user }) => (
      <TravelOrderWorkspace
        user={user}
        title="My Travel Orders"
        description="File and monitor travel orders under your employee account."
        allowCreate
      />
    ),
  },
  passSlip: {
    title: "Pass Slips",
    description: "File and review pass slips under your employee account.",
    hidePageIntro: true,
    render: ({ user }) => (
      <PassSlipWorkspace
        user={user}
        title="My Pass Slips"
        description="File and review pass slips under your employee account."
        submitLabel="Create Pass Slip"
        showDivisionFilter={false}
      />
    ),
  },
  cto: {
    title: "Compensatory Time Off",
    description: "File and monitor your compensatory time off requests.",
    hidePageIntro: true,
    render: ({ user }) => (
      <CompensatoryWorkspace
        user={user}
        title="My Compensatory Time Off Requests"
        description="File and monitor compensatory time off requests under your employee account."
        submitLabel="File CTO"
      />
    ),
  },
  payrollGenerate: {
    title: "Payroll",
    description: "Release payroll batches that have cleared the approval chain and mark them as paid.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <CashierPayrollWorkspace view="generate" user={user} onNavigate={onNavigate} />,
  },
  payrollRecords: {
    title: "Payslip",
    description: "Review generated payslip entries for released payroll.",
    hidePageIntro: true,
    render: ({ user }) => <CashierPayrollWorkspace view="payslip" user={user} />,
  },
  archivedPayroll: {
    title: "Archived Payroll",
    description: "View archived payroll records kept for audit review.",
    hidePageIntro: true,
    render: ({ user, onNavigate }) => <CashierPayrollWorkspace view="archived" user={user} onNavigate={onNavigate} />,
  },
  payrollLoan: {
    title: "Loan Management",
    description: "Review loan balances deducted from the payroll being released.",
    hidePageIntro: true,
    render: ({ user }) => <FileLoan user={user} />,
  },
  calendar: {
    title: "Calendar",
    description: "View approved employee leave and travel order schedules.",
    hidePageIntro: true,
    render: () => <LeaveTravelCalendarWorkspace canManageAnnouncements={false} showLegend={false} />,
  },
  messages: {
    title: "Messages",
    description: "Coordinate payroll release questions with HR and employees.",
    hidePageIntro: true,
    render: ({ user }) => <BubbleChat user={user} />,
  },

  ...SELF_SERVICE_MODULES,
};

export default function CashierDashboard(props) {
  return (
    <RoleWorkspacePage
      {...props}
      portalLabel="Cashier Workspace"
      navigationItems={navigationItems}
      modules={modules}
      contentClassName="space-y-4 p-4"
    />
  );
}
