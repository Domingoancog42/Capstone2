import React from "react";
import { ClipboardList, Clock3, FileText, ScrollText } from "lucide-react";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import EmployeeIpcrWorkspace from "../../module/performance/EmployeeIpcrWorkspace";
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
};

/**
 * Sidebar entries for the modules above, e.g. `buildSelfServiceNavItems("/hrhead")`.
 *
 * There is no personal "Nominate" entry: award voting belongs to the division Chiefs, who reach it
 * through the Rewards & Recognition screen from `buildPerformanceRewardsNavItems`.
 */
export function buildSelfServiceNavItems(basePath) {
  return [
    { type: "section", label: "My Records" },
    { key: "myAttendance", label: "My DTR", icon: Clock3, path: `${basePath}/my-attendance` },
    { key: "myPayslip", label: "My Payslip", icon: FileText, path: `${basePath}/my-payslip` },
    { key: "myIpcr", label: "My IPCR", icon: ClipboardList, path: `${basePath}/my-ipcr` },
    { key: "myServiceRecord", label: "My Service Record", icon: ScrollText, path: `${basePath}/my-service-record` },
  ];
}
