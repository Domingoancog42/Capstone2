import React, { useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import {
  ArrowRight, BadgeCheck, CalendarCheck2, CalendarDays, ChevronRight, ClipboardList,
  Clock3, FileText, Grid2X2, Megaphone, Plane, RefreshCw, Star, Timer, Trophy, UserRound, Wallet,
} from "lucide-react";
import DashboardWelcomeBanner from "./DashboardWelcomeBanner";
import LeaveBalanceModal from "../leave/LeaveBalanceModal";
import { requestProfileTab } from "../profile/profileUtils";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { formatDateDisplay, isPendingRequestStatus, leaveCreditMatchesGender, normalizeLeaveStatus } from "../../utils/leaveHelpers";
import { getRoleLabel } from "../../utils/roleRoutes";
import { amount, attendanceSummary, dateKey, monthKey, performanceSummary, recordDate, upcomingSchedule } from "./employeeDashboardData";
import "./employeeDashboard.css";

const SOURCES = [
  { key: "leave", label: "Leave Request", icon: Plane, path: "leave-request" },
  { key: "travel", label: "Travel Order", icon: Plane, path: "travel-order" },
  { key: "passSlip", label: "Pass Slip", icon: Timer, path: "pass-slips" },
  { key: "compensatory", label: "CTO Request", icon: ClipboardList, path: "compensatory-time-off" },
  { key: "overtime", label: "Overtime Request", icon: Clock3, path: "overtime" },
];
const PRIMARY_ACTIONS = [
  { label: "File Leave", note: "Submit a leave request", icon: FileText, path: "leave-request" },
  { label: "View Attendance", note: "Check your attendance", icon: Clock3, path: "attendance" },
  { label: "View Payslip", note: "Check your salary details", icon: Wallet, path: "payslip" },
  { label: "Update Profile", note: "Review your personal details", icon: UserRound, path: "profile" },
];
const COLORS = { Present: "#32b44a", Late: "#ffc33d", Leave: "#3387ff", Absent: "#ef5261", Incomplete: "#94a3b8" };
const money = (value) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount(value));
const credit = (value) => amount(value).toFixed(2);
const monthLabel = (value) => recordDate(`${value}-01`)?.toLocaleDateString("en-US", { month: "long", year: "numeric" }) || value;

function Panel({ title, action, children, className = "", delay = 0 }) {
  return <section className={`employee-panel employee-enter ${className}`} style={{ "--enter-delay": `${delay}ms` }}>
    <div className="employee-panel-heading"><h2>{title}</h2>{action}</div>{children}
  </section>;
}

function EmptyState({ icon: Icon = CalendarDays, children }) {
  return <div className="employee-empty"><Icon size={25} aria-hidden="true" /><p>{children}</p></div>;
}

function DataState({ loading, failed, children }) {
  return loading ? <div className="employee-skeleton" role="status"><span className="sr-only">Loading dashboard records</span><i /><i /><i /></div>
    : failed ? <EmptyState icon={RefreshCw}>Unable to load these records. Please retry.</EmptyState> : children;
}

function DashboardLink({ children = "View all", onClick, label }) {
  return <button type="button" className="employee-text-link" aria-label={label} onClick={onClick}>{children}</button>;
}

function EmployeeProfileOverview({ user, profile, leaveBalance, attendanceLabel, onNavigate }) {
  const fullName = profile?.fullName || user?.full_name || user?.username || "Employee";
  const employeeId = profile?.employeeId || user?.employee_id || "Employee ID pending";
  const position = profile?.position || user?.position || "Not assigned";
  const profileImage = resolveBackendAssetUrl(profile?.profileImage || user?.profile_image || user?.profileImage);
  const details = [
    { label: "Employment Status", value: profile?.employmentStatus || "Not available", icon: BadgeCheck, active: true },
    { label: "Date Hired", value: formatDateDisplay(profile?.dateHired), icon: CalendarDays },
    { label: "Work Status", value: profile?.status || user?.statusLabel || user?.status || "Active", icon: Clock3, active: true },
    { label: "Leave Balance", value: leaveBalance, icon: Plane },
    { label: "Attendance Today", value: attendanceLabel, icon: CalendarCheck2 },
  ];

  return <div className="employee-identity-grid employee-enter" style={{ "--enter-delay": "70ms" }}>
    <section className="employee-profile-overview" aria-labelledby="employee-profile-overview-title">
      <div className="employee-profile-overview-heading">
        <h2 id="employee-profile-overview-title">My Employee Profile</h2>
        <button type="button" onClick={() => onNavigate("profile")}>View Profile <ChevronRight size={17} aria-hidden="true" /></button>
      </div>
      <div className="employee-profile-summary">
        <div className="employee-profile-avatar">
          {profileImage ? <img src={profileImage} alt={fullName} /> : <UserRound size={42} aria-hidden="true" />}
        </div>
        <div className="employee-profile-copy">
          <strong>{fullName}</strong>
          <span>{employeeId}</span>
          <small>{position}</small>
        </div>
      </div>
      <div className="employee-profile-details">
        {details.map(({ icon: Icon, ...item }) => <div key={item.label}>
          <Icon size={18} aria-hidden="true" />
          <span><small>{item.label}</small><strong>{item.active ? <i aria-hidden="true" /> : null}{item.value}</strong></span>
        </div>)}
      </div>
    </section>

    <section className="employee-primary-actions" aria-labelledby="employee-primary-actions-title">
      <div className="employee-primary-actions-heading">
        <span><Grid2X2 size={19} aria-hidden="true" /></span>
        <div><h2 id="employee-primary-actions-title">Quick Actions</h2><p>Common tasks for employees</p></div>
      </div>
      <div className="employee-primary-actions-grid">
        {PRIMARY_ACTIONS.map(({ icon: Icon, ...action }) => <button type="button" key={action.label} onClick={() => onNavigate(action.path)}>
          <span className="employee-primary-action-icon"><Icon size={21} aria-hidden="true" /></span>
          <span className="employee-primary-action-copy"><strong>{action.label}</strong><small>{action.note}</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>)}
      </div>
    </section>
  </div>;
}

function AttendanceDonut({ attendance, month }) {
  return <div className="employee-attendance">
    <div className="employee-donut" role="img" aria-label={`${attendance.total} recorded days: ${Object.entries(attendance.counts).map(([label, count]) => `${count} ${label.toLowerCase()}`).join(", ")}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="employee-donut-track" cx="60" cy="60" r="46" fill="none" strokeWidth="16" />
        {Object.entries(attendance.counts).map(([label, count], index, entries) => {
          const part = attendance.total ? count / attendance.total * 100 : 0;
          const offset = attendance.total ? entries.slice(0, index).reduce((sum, entry) => sum + entry[1], 0) / attendance.total * 100 : 0;
          return count > 0 && <circle key={`${month}-${label}`} cx="60" cy="60" r="46" fill="none" stroke={COLORS[label]} strokeWidth="16" pathLength="100" strokeDasharray={`${part} ${100 - part}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" className="employee-donut-segment" />;
        })}</svg>
      <div className="employee-donut-center"><strong>{attendance.total}</strong><span>Recorded days</span></div>
    </div>
    <dl className="employee-attendance-legend">{Object.entries(attendance.counts).filter(([label, count]) => label !== "Incomplete" || count > 0).map(([label, count]) => <div key={label}><dt><i style={{ background: COLORS[label] }} />{label}</dt><dd>{count}</dd></div>)}</dl>
  </div>;
}

export default function EmployeeDashboardView({ user, onNavigate, data, loading, failures, onRetry }) {
  const [attendanceMonth, setAttendanceMonth] = useState(() => monthKey(new Date()));
  const [performanceYear, setPerformanceYear] = useState(() => new Date().getFullYear());
  const [payrollId, setPayrollId] = useState("");
  const [showAllRequests, setShowAllRequests] = useState(false);
  /* The Leave Balance tile opens the card wall of every leave type rather than leaving the dashboard. */
  const [balanceOpen, setBalanceOpen] = useState(false);
  const navigate = (path, tab) => {
    if (tab) requestProfileTab(tab);
    if (onNavigate) onNavigate(`/employee/${path}`);
    else window.location.assign(`/employee/${path}`);
  };
  const requests = useMemo(() => SOURCES.flatMap((source) => data[source.key].map((record, index) => ({
    ...source, id: `${source.key}-${record.id ?? record.requestId ?? index}`, record,
    filedDate: [record.dateFiled, record.requestDate, record.requestedAt, record.createdAt, record.passDate, record.startDate, record.workDate].map(recordDate).find(Boolean),
    status: source.key === "passSlip" ? "Filed" : normalizeLeaveStatus(record.status),
  }))).sort((a, b) => (b.filedDate?.getTime() || 0) - (a.filedDate?.getTime() || 0)), [data]);
  const pending = requests.filter((item) => item.key !== "passSlip" && isPendingRequestStatus(item.record.status)).length;
  const requestFailure = SOURCES.some((source) => failures.includes(source.key));
  const balances = data.leaveCredits.filter((item) => leaveCreditMatchesGender(item, data.leaveCreditGender));
  const balanceFor = (code) => balances.find((item) => String(item.code).toUpperCase() === code);
  const latestPayroll = data.payroll[0];
  const selectedPayroll = data.payroll.find((item) => String(item.paidPayrollId) === payrollId) || latestPayroll;
  const attendance = attendanceSummary(data.attendance, attendanceMonth);
  const todayRecord = data.attendance.find((item) => dateKey(item.date) === dateKey(new Date()));
  const timeIn = recordDate(todayRecord?.timeIn);
  const todayStatus = todayRecord ? (todayRecord.status || (timeIn ? "Present" : "Recorded")) : "No record yet";
  const attendanceMonths = [...new Set([monthKey(new Date()), attendanceMonth, ...data.attendance.map((item) => monthKey(item.date)).filter(Boolean)])].sort().reverse();
  const years = [...new Set([new Date().getFullYear(), performanceYear, ...data.performance.map((item) => recordDate(item.periodTo || item.periodFrom)?.getFullYear()).filter(Boolean)])].sort((a, b) => b - a);
  const performance = performanceSummary(data.performance, performanceYear);
  const currentPerformance = performanceSummary(data.performance, new Date().getFullYear());
  const announcements = data.announcements.filter((item) => item.entryType !== "event").sort((a, b) => (recordDate(b.createdAt || b.startDate)?.getTime() || 0) - (recordDate(a.createdAt || a.startDate)?.getTime() || 0)).slice(0, 3);
  const schedule = upcomingSchedule(data);
  // Open awards with an approved nominee to vote for, that this employee has not voted in yet. A voter
  // is only ever sent the approved nominations, so any nomination on the cycle is one on the ballot.
  const nominations = data.awardCycles.filter((cycle) => cycle.phase !== "closed" && !cycle.isArchived && !cycle.myVote
    && (Array.isArray(cycle.nominations) ? cycle.nominations : []).some((nomination) => nomination.status === "approved")).length;
  const metricValue = (key, value) => loading ? "…" : failures.includes(key) ? "Unavailable" : value;
  const metrics = [
    { label: "Attendance Today", icon: CalendarCheck2, tone: "green", path: "attendance", value: metricValue("attendance", `${todayStatus}${timeIn ? ` · ${timeIn.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}`), note: timeIn ? "Have a productive day!" : "Your daily time record" },
    { label: "Leave Balance", icon: Plane, tone: "blue", onClick: () => setBalanceOpen(true), value: metricValue("leaveCredits", `VL: ${balanceFor("VL") ? credit(balanceFor("VL").remaining) : "—"} | SL: ${balanceFor("SL") ? credit(balanceFor("SL").remaining) : "—"}`), note: "Tap to see every leave type" },
    { label: "Latest Net Pay", icon: Wallet, tone: "amber", path: "payslip", value: metricValue("payroll", latestPayroll ? money(latestPayroll.paidNetPay) : "No payslip yet"), note: latestPayroll ? formatDateDisplay(latestPayroll.paidPayrollDate) : "Your latest paid payroll" },
    { label: "Pending Requests", icon: FileText, tone: "rose", value: loading ? "…" : requestFailure ? "Unavailable" : `${pending} Request${pending === 1 ? "" : "s"}`, note: pending ? "Awaiting approval" : "You're all caught up" },
    { label: "Performance Rating", icon: Star, tone: "violet", path: "ipcr", value: metricValue("performance", currentPerformance.score ? `${currentPerformance.score.toFixed(2)} / 5.00` : "Not yet rated"), note: `${new Date().getFullYear()} · Reviewed IPCR` },
    { label: "COC Balance", icon: ClipboardList, tone: "teal", path: "compensatory-time-off", value: metricValue("cocBalance", data.cocBalance ? `${credit(data.cocBalance.available)} Hours` : "Not available"), note: data.cocBalance?.expiresOn ? `Expires ${formatDateDisplay(data.cocBalance.expiresOn)}` : "Compensatory overtime credits" },
  ];
  const profileLeaveBalance = failures.includes("leaveCredits")
    ? "Unavailable"
    : balanceFor("VL") ? `${credit(balanceFor("VL").remaining)} Days` : "Not available";
  const profileAttendance = failures.includes("attendance")
    ? "Unavailable"
    : `${todayStatus}${timeIn ? ` · ${timeIn.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}`;
  const openRequests = () => {
    setShowAllRequests(true);
    document.getElementById("employee-recent-requests")?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block: "center" });
  };

  return <MotionConfig reducedMotion="user"><div className="employee-dashboard" aria-busy={loading}>
    <DashboardWelcomeBanner name={String(user?.full_name || user?.username || "Employee").trim().split(/\s+/)[0]}
      position={user?.position || "Not assigned"} role={getRoleLabel(user?.role || user?.roleKey || "employee")}
      division={user?.division || user?.department || "Not assigned"} imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
      supervisor={data.profile?.supervisor || "Not assigned"} variant="employee" showCalendar />
    <div className="employee-dashboard-body">
      {failures.length > 0 && <div className="employee-load-error" role="status"><span>Some dashboard records could not be loaded.</span><button type="button" onClick={() => onRetry()} disabled={loading}><RefreshCw size={14} /> Retry</button></div>}
      <EmployeeProfileOverview
        user={user}
        profile={data.profile}
        leaveBalance={loading ? "…" : profileLeaveBalance}
        attendanceLabel={loading ? "…" : profileAttendance}
        onNavigate={navigate}
      />
      <section className="employee-metrics" aria-label="Your work at a glance">
        {metrics.map(({ icon: Icon, ...item }, index) => <button type="button" key={item.label} className={`employee-metric employee-tone-${item.tone} employee-enter`}
          style={{ "--enter-delay": `${index * 45}ms` }} onClick={() => item.onClick ? item.onClick() : item.path ? navigate(item.path) : openRequests()}>
          <span className="employee-metric-icon"><Icon size={21} aria-hidden="true" /></span><span className="employee-metric-copy"><span className="employee-metric-label">{item.label}</span><strong>{item.value}</strong><span className="employee-metric-note">{item.note}</span></span>
        </button>)}
      </section>

      <div className="employee-primary-grid">
        <Panel title="My Attendance" delay={120} action={<select aria-label="Attendance month" value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)}>{attendanceMonths.map((month) => <option key={month} value={month}>{month === monthKey(new Date()) ? "This month" : monthLabel(month)}</option>)}</select>}>
          <DataState loading={loading} failed={failures.includes("attendance")}>
            <AttendanceDonut attendance={attendance} month={attendanceMonth} />
            <div className="employee-panel-footnote">{attendance.total ? `${Number(attendance.hours.toFixed(1))} hours rendered this month` : "No attendance records for this month."}<DashboardLink onClick={() => navigate("attendance")} label="View time records"><ArrowRight size={14} /></DashboardLink></div>
          </DataState>
        </Panel>

        <Panel title="My Leave" delay={170} action={<button type="button" className="employee-button employee-button-primary employee-button-small" onClick={() => navigate("leave-request")}><Plane size={14} /> File Leave</button>}>
          <DataState loading={loading} failed={failures.includes("leaveCredits")}>
            {balances.length ? <div className="employee-leave-table-wrap"><table className="employee-leave-table"><thead><tr><th>Leave type</th><th>Available</th><th>Used</th></tr></thead><tbody>{balances.map((item, index) => <tr key={`${item.code}-${index}`}><th scope="row">{item.type || item.code}</th><td>{credit(item.remaining)}</td><td>{credit(item.used)}</td></tr>)}</tbody></table></div> : <EmptyState icon={Plane}>Your leave credits will appear once HR sets them up.</EmptyState>}
            <div className="employee-panel-footnote">Balances are shown in days.<DashboardLink onClick={() => setBalanceOpen(true)} label="View every leave type">View all<ArrowRight size={14} /></DashboardLink></div>
          </DataState>
        </Panel>

        <Panel title="Latest Payroll" delay={220} action={data.payroll.length > 0 && <select aria-label="Payroll period" value={String(selectedPayroll?.paidPayrollId || "")} onChange={(event) => setPayrollId(event.target.value)}>{data.payroll.map((item) => <option key={item.paidPayrollId} value={String(item.paidPayrollId)}>{item.periodLabel || formatDateDisplay(item.paidPayrollDate)}</option>)}</select>}>
          <DataState loading={loading} failed={failures.includes("payroll")}>
            {selectedPayroll ? <><dl className="employee-payroll-summary"><div><dt>Gross Pay</dt><dd>{money(selectedPayroll.paidGrossPay)}</dd></div><div><dt>Total Deductions</dt><dd>{money(selectedPayroll.paidTotalDeduction)}</dd></div><div className="employee-net-pay"><dt>Net Pay</dt><dd>{money(selectedPayroll.paidNetPay)}</dd></div></dl><p className="employee-panel-footnote">Paid {formatDateDisplay(selectedPayroll.paidPayrollDate)}</p></> : <EmptyState icon={Wallet}>Your payslip will appear after payroll is paid.</EmptyState>}
            <div className="employee-payroll-actions"><button type="button" className="employee-button employee-button-primary" onClick={() => navigate("payslip")}><FileText size={14} /> View Payslip</button><button type="button" className="employee-button" onClick={() => navigate("payslip")}><Clock3 size={14} /> Payroll History</button></div>
          </DataState>
        </Panel>
      </div>

      <div className="employee-secondary-grid">
        <Panel title="Performance" delay={260} action={<select aria-label="Performance year" value={performanceYear} onChange={(event) => setPerformanceYear(Number(event.target.value))}>{years.map((year) => <option key={year} value={year}>{year === new Date().getFullYear() ? "This year" : year}</option>)}</select>}>
          <DataState loading={loading} failed={failures.includes("performance")}>
            <div className="employee-performance-score"><span className="employee-star"><Star size={27} fill="currentColor" aria-hidden="true" /></span><div><span>{performance.score ? "Reviewed IPCR average" : "Awaiting your rating"}</span><strong>{performance.score ? `${performance.score.toFixed(2)} / 5.00` : "Not yet rated"}</strong></div></div>
            <div className="employee-performance-bars">{performance.dimensions.map((item) => <div key={`${performanceYear}-${item.label}`}><div className="employee-bar-label"><span>{item.label}</span><strong>{item.score ? item.score.toFixed(2) : "—"}</strong></div><div className="employee-bar-track"><span style={{ "--bar-width": `${(item.score || 0) / 5 * 100}%` }} /></div></div>)}</div>
            <div className="employee-panel-footnote">{performance.count ? `${performance.count} rated KPI${performance.count === 1 ? "" : "s"}` : "Ratings appear after review."}<DashboardLink onClick={() => navigate("ipcr")} label="View performance details"><ArrowRight size={14} /></DashboardLink></div>
          </DataState>
        </Panel>

        <Panel title="Recent Requests" delay={300} action={<DashboardLink onClick={() => setShowAllRequests((value) => !value)}>{showAllRequests ? "Show less" : "View all"}</DashboardLink>}>
          <div id="employee-recent-requests" className={showAllRequests ? "employee-list employee-list-expanded" : "employee-list"}>
            <DataState loading={loading} failed={requestFailure}>
              {requests.length ? (showAllRequests ? requests : requests.slice(0, 4)).map((item) => <button type="button" className="employee-request-row" key={item.id} onClick={() => navigate(item.path)}>
                <span className={`employee-small-icon employee-tone-${item.key === "compensatory" ? "teal" : "blue"}`}><item.icon size={17} aria-hidden="true" /></span>
                <span className="employee-row-copy"><strong title={item.record.leaveType || item.label}>{item.record.leaveType || item.label}</strong><small>{item.filedDate ? formatDateDisplay(item.filedDate) : "Date unavailable"}</small></span>
                <span className={`employee-status employee-status-${item.status.toLowerCase()}`}>{item.status}</span><ChevronRight size={13} className="employee-row-chevron" aria-hidden="true" />
              </button>) : <EmptyState icon={ClipboardList}>Your requests will appear here when you file one.</EmptyState>}
            </DataState>
          </div>
        </Panel>

        <Panel title="Announcements" delay={340} action={<DashboardLink label="View all announcements" onClick={() => navigate("calendar")} />}>
          <DataState loading={loading} failed={failures.includes("announcements")}>
            {announcements.length ? <div className="employee-list">{announcements.map((item) => <button type="button" className="employee-announcement-row" key={item.id} onClick={() => navigate("calendar")}><span className="employee-small-icon employee-tone-blue"><Megaphone size={17} aria-hidden="true" /></span><span className="employee-row-copy"><strong>{item.title}</strong><small>{formatDateDisplay(item.startDate)}</small><span className="employee-announcement-description">{item.description || "Open your work calendar for details."}</span></span></button>)}</div> : <EmptyState icon={Megaphone}>You're up to date. New announcements will appear here.</EmptyState>}
          </DataState>
        </Panel>

        <Panel title="Upcoming Schedule" delay={380} action={<DashboardLink label="View full work calendar" onClick={() => navigate("calendar")} />}>
          <DataState loading={loading} failed={["announcements", "leave", "travel", "compensatory"].some((key) => failures.includes(key))}>
            {schedule.length ? <div className="employee-list">{schedule.map((item) => <button type="button" className={`employee-schedule-row employee-tone-${item.tone}`} key={item.id} onClick={() => navigate("calendar")}><span className="employee-date-tile"><small>{recordDate(item.date).toLocaleDateString("en-US", { month: "short" })}</small><strong>{recordDate(item.date).getDate()}</strong></span><span className="employee-row-copy"><strong>{item.title}</strong><small>{item.ongoing ? "Ongoing · " : ""}{item.detail}</small></span></button>)}</div> : <EmptyState icon={CalendarDays}>No upcoming events. Your approved schedules will appear here.</EmptyState>}
          </DataState>
        </Panel>
      </div>

      {!loading && nominations > 0 && <button type="button" className="employee-nomination-link" onClick={() => navigate("voting")}><Trophy size={16} /> {nominations} award{nominations === 1 ? "" : "s"} waiting for your vote <ArrowRight size={14} /></button>}
    </div>
    <LeaveBalanceModal open={balanceOpen} onClose={() => setBalanceOpen(false)} credits={data.leaveCreditSnapshot} loading={loading}
      error={failures.includes("leaveCredits") ? "Your leave balances are unavailable right now." : ""} onRetry={() => onRetry()} />
  </div></MotionConfig>;
}
