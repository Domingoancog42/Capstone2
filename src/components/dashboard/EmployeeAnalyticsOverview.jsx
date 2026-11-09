import React, { useCallback, useEffect, useRef, useState } from "react";
import EmployeeDashboardView from "./EmployeeDashboardView";
import { useAutoRefreshOnChange } from "../auto/autorefreshdatalist";
import { fetchAwardCycles, fetchIpcrRecords, getCurrentEmployee, getUsers } from "../../services/api";
import { fetchAttendanceRecords } from "../../services/attendanceService";
import { fetchCompensatoryCreditBalance, fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchLeaveCredits, fetchLeaveRequests } from "../../services/leaveService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchPassSlips } from "../../services/passSlipService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { fetchPayslipData } from "../../services/payslipService";
import { fetchAnnouncements } from "../../services/announcementService";
import { matchesUserRecordScope } from "../../utils/leaveHelpers";
import { amount, recordDate } from "./employeeDashboardData";
import { resolveUserRoleKey } from "../../utils/roleRoutes";

const EMPTY = { profile: null, leaveCredits: [], leaveCreditGender: "", leaveCreditSnapshot: null, leave: [], travel: [], passSlip: [], compensatory: [], overtime: [], attendance: [], payroll: [], performance: [], announcements: [], awardCycles: [], viewerKey: "", cocBalance: null };

function resolveEmployeeSupervisor(users = [], employee = null, user = null) {
  const division = String(employee?.department || user?.division || user?.department || "").trim().toLowerCase();

  if (!division) return "";

  const supervisor = users.find((candidate) => (
    resolveUserRoleKey(candidate) === "chief"
    && String(candidate?.division || "").trim().toLowerCase() === division
  ));

  return String(supervisor?.full_name || supervisor?.fullName || supervisor?.username || "").trim();
}

export default function EmployeeAnalyticsOverview({ user, onNavigate }) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState([]);
  const generation = useRef(0);

  const loadDashboard = useCallback(async ({ background = false } = {}) => {
    const current = ++generation.current;
    if (!background) setLoading(true);
    const jobs = {
      leaveCredits: () => fetchLeaveCredits(), leave: () => fetchLeaveRequests(), travel: () => fetchTravelOrders(),
      passSlip: () => fetchPassSlips(), compensatory: () => fetchCompensatoryRequests(),
      cocBalance: () => fetchCompensatoryCreditBalance(0), overtime: () => fetchOvertimeRequests(),
      attendance: () => fetchAttendanceRecords(), awards: () => fetchAwardCycles(),
      profile: () => getCurrentEmployee(), supervisors: () => getUsers().catch(() => ({ users: [] })),
      payroll: () => fetchPayslipData(), performance: () => fetchIpcrRecords(), announcements: () => fetchAnnouncements(),
    };
    const keys = Object.keys(jobs);
    const results = await Promise.allSettled(keys.map((key) => Promise.resolve().then(jobs[key]).then((result) => {
      if (result?.success === false) throw new Error("Unavailable");
      return result;
    })));
    if (current !== generation.current) return;
    const failed = keys.filter((key, index) => results[index].status === "rejected");
    const response = Object.fromEntries(keys.map((key, index) => [key, results[index].status === "fulfilled" ? results[index].value : null]));
    const list = (value) => Array.isArray(value) ? value : [];
    // Apply employee scope even if a service returns records for several employees.
    const own = (value) => list(value).filter((record) => matchesUserRecordScope({ ...record, employeeName: record.employeeName || record.fullName }, user));
    const employeeProfile = response.profile?.employee || null;
    const supervisor = resolveEmployeeSupervisor(response.supervisors?.users, employeeProfile, user);
    setData({
      profile: employeeProfile ? { ...employeeProfile, supervisor } : null,
      leaveCredits: list(response.leaveCredits?.credits?.balances), leaveCreditGender: response.leaveCredits?.credits?.gender || "",
      // The full snapshot (every leave type, not only the tracked credits) feeds the Leave Balance card wall.
      leaveCreditSnapshot: response.leaveCredits?.credits || null,
      leave: own(response.leave?.requests), travel: own(response.travel?.requests), passSlip: own(response.passSlip?.records),
      compensatory: own(response.compensatory?.records), overtime: own(response.overtime?.records),
      attendance: own(response.attendance?.records), cocBalance: response.cocBalance?.balance || null,
      payroll: own(response.payroll?.employees).filter((record) => record.isPaid || String(record.paidPayrollStatus).toLowerCase() === "paid")
        .sort((a, b) => (recordDate(b.paidPayrollDate)?.getTime() || 0) - (recordDate(a.paidPayrollDate)?.getTime() || 0) || amount(b.paidPayrollId) - amount(a.paidPayrollId)),
      performance: own(response.performance?.records || response.performance?.ipcrRecords),
      announcements: list(response.announcements?.announcements),
      awardCycles: list(response.awards?.cycles), viewerKey: String(response.awards?.viewerKey || ""),
    });
    setFailures(failed);
    setLoading(false);
  }, [user]);

  useEffect(() => { void loadDashboard(); return () => { generation.current += 1; }; }, [loadDashboard]);
  useAutoRefreshOnChange(loadDashboard, {
    topics: ["leave_request", "leave_credit", "attendance", "rewards", "overtime", "compensatory", "travel_order", "pass_slip", "payroll", "ipcr", "announcement", "user"],
    refreshOnMount: false,
  });

  return <EmployeeDashboardView user={user} onNavigate={onNavigate} data={data} loading={loading} failures={failures} onRetry={loadDashboard} />;
}
