import React from "react";
import { ClipboardList, Clock3, FileText, ScrollText, Trophy } from "lucide-react";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import EmployeeIpcrWorkspace from "../../module/performance/EmployeeIpcrWorkspace";
import AwardCyclesWorkspace from "../../module/rewards/AwardCyclesWorkspace";
import ServiceRecordWorkspace from "../../module/serviceRecord/ServiceRecordWorkspace";

/**
 * "My" records — the personal attendance, payslip, and IPCR screens every staff member needs for
 * their own record, regardless of what they can see for other people.
 *
 * HR Head, HR Staff, Chief, and Regional Director are all employees too, so they get the same three
 * screens the Employee workspace has, rendered by the same components in the same `employee` mode.
 * Defining them once here is what keeps "same format as the employee" true over time.
 *
 * The keys are deliberately distinct from the management screens (`attendance`, `payrollRecords`,
 * `performanceIpcr`) that these roles already have — those show everyone's records, these show only
 * the signed-in user's, and a role can hold both at once.
 */
export const SELF_SERVICE_MODULES = {
  myAttendance: {
    title: "My Attendance",
    description: "View personal attendance logs, DTR forms, printable records, and daily log history.",
    hidePageIntro: true,
    render: ({ user }) => <AttendanceManagementWorkspace user={user} mode="employee" />,
  },
  myPayslip: {
    title: "My Payslip",
    description: "Generate and review your available payslip based on paid payroll records.",
    hidePageIntro: true,
    render: () => <PayslipWorkspace mode="employee" />,
  },
  myIpcr: {
    title: "My IPCR",
    description: "Review assigned IPCR KPIs and submit your accomplishments.",
    hidePageIntro: true,
    render: () => <EmployeeIpcrWorkspace />,
  },
  myServiceRecord: {
    title: "My Service Record",
    description: "Your chronological record of appointments, salaries, and separations (CS Form No. 1).",
    hidePageIntro: true,
    render: ({ user }) => <ServiceRecordWorkspace user={user} mode="employee" />,
  },
  /**
   * Voting is everybody's, so this is the same workspace HR runs, minus `canManage` — no creating,
   * editing, closing, or deleting a cycle, only casting a vote and watching the leaderboard.
   */
  myNomination: {
    title: "Nominate",
    description: "Nominate deserving colleagues for open awards and follow the results.",
    hidePageIntro: true,
    render: ({ user }) => <AwardCyclesWorkspace user={user} canManage={false} />,
  },
};

/**
 * Sidebar entries for the modules above, e.g. `buildSelfServiceNavItems("/hrhead")`.
 *
 * `includeNomination: false` is for the roles that already carry the Rewards & Recognition
 * management screen from `buildPerformanceRewardsNavItems` — that screen votes too, so adding this
 * one would put a second Rewards & Recognition heading in the same sidebar.
 */
export function buildSelfServiceNavItems(basePath, { includeNomination = true } = {}) {
  return [
    { type: "section", label: "My Records" },
    { key: "myAttendance", label: "My Attendance", icon: Clock3, path: `${basePath}/my-attendance` },
    { key: "myPayslip", label: "My Payslip", icon: FileText, path: `${basePath}/my-payslip` },
    { key: "myIpcr", label: "My IPCR", icon: ClipboardList, path: `${basePath}/my-ipcr` },
    { key: "myServiceRecord", label: "My Service Record", icon: ScrollText, path: `${basePath}/my-service-record` },
    ...(includeNomination
      ? [
          { type: "section", label: "Recognition & Rewards" },
          { key: "myNomination", label: "Nominate", icon: Trophy, path: `${basePath}/nominate` },
        ]
      : []),
  ];
}
