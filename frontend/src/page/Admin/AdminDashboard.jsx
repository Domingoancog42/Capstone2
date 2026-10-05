import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import {
  Archive,
  Download,
  Eye,
  FileText,
  Mail,
  Pencil,
  Plus,
  Search,
  Upload,
  RotateCcw,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { faBoxArchive, faClockRotateLeft, faEye as faEyeAction, faPen } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import CreateLinkedUserForm, { UserSelectField } from "./CreateLinkedUserForm";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import Breadcrumbs from "../../components/breadcrumbs/breadcrumbs";
import Header from "../../components/navigation/Header";
import Sidebar from "../../components/navigation/Sidebar";
import { AccessDeniedInline } from "../../components/auth/AccessDenied";
import { userCanAccessModule } from "../../utils/permissions";
import { buildNextEmployeeId } from "../../utils/employeeIds";
import { EmployeeDocumentDownloadButtons } from "../../components/employee/EmployeeDocumentsModal";
import AdminAccountCard from "../../components/profile/AdminAccountCard";
import ProfilePage from "../../components/profile/ProfilePage";
import {
  archiveUser,
  createEmployee,
  createUser,
  deleteEmployee,
  getArchivedUsers,
  getArchivedEmployees,
  getEmployeeOptions,
  getEmployees,
  getSettings,
  getUsers,
  importEmployeesCsv,
  restoreEmployee,
  restoreUser,
  updateUser,
  updateEmployee,
  updateEmployeeProfileImage,
} from "../../services/api";
import DivisionSettings from "../settings/division";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import LeaveBalanceManagementWorkspace from "../../module/leave/LeaveBalanceManagementWorkspace";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import PayrollManagementWorkspace from "../../module/payroll/PayrollManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import FileLoan from "../../module/Loan/fileloan";
import AwardCyclesWorkspace from "../../module/rewards/AwardCyclesWorkspace";
import LoyaltyWorkspace from "../../module/rewards/LoyaltyWorkspace";
import PromotionWorkspace from "../../module/promotion/PromotionWorkspace";
import CertificateTemplateEditor from "../../module/rewards/CertificateTemplateEditor";
import ServiceRecordWorkspace from "../../module/serviceRecord/ServiceRecordWorkspace";

import AdminReports from "../../module/reports/AdminReports";
import {
  ADMIN_HIDDEN_REPORT_CATEGORIES,
  reportCategoryFromPath,
} from "../../module/reports/reportCategories";
import IpcrManagementWorkspace from "../../module/performance/IpcrManagementWorkspace";
import OpcrManagementWorkspace from "../../module/performance/OpcrManagementWorkspace";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";
import NotificationCenter from "../../components/notification/NotificationCenter";
import CreateEmployee from "./create_employee";
import AdminAnalyticsOverview from "../../components/dashboard/AdminAnalyticsOverview";
import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { showEmployeeCredentialsAlert } from "../../utils/employeeAccountAlert";
import {
  getRoleBadgeClass,
  getProfilePathForRole,
  getManagedRoleOptions,
  getRoleLabel,
  getStatusLabel,
  normalizeRole,
  normalizeStatus,
} from "../../utils/roleRoutes";

const numberFormat = new Intl.NumberFormat("en-US");
const currencyFormat = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DEFAULT_EMPLOYEE_ROWS_PER_PAGE = 10;
const DEFAULT_USER_ROWS_PER_PAGE = 10;
const DEFAULT_EMPLOYEE_PAGE = 1;
const ADMIN_EMPLOYEE_FORM_ID = "admin-employee-form";
const DEFAULT_SECURITY_SETTINGS = {
  maximumPasswordLength: 64,
  passwordExpiryDays: 90,
  sessionTimeoutMinutes: 30,
  lockoutFailedAttempts: 5,
  lockoutDurationMinutes: 15,
};

const modulePaths = {
  dashboard: "/admin/dashboard",
  messages: "/admin/messages",
  notifications: "/admin/notifications",
  users: "/admin/users",
  employees: "/admin/employees",
  divisions: "/admin/divisions",
  designations: "/admin/designations",
  rbac: "/admin/rbac",
  serviceRecord: "/admin/service-record",
  promotions: "/admin/promotions",
  rewardsRecognition: "/admin/rewards-recognition",
  rewardsNomination: "/admin/rewards-recognition/nomination",
  rewardsLoyalty: "/admin/rewards-recognition/loyalty",
  rewardsCertificateTemplate: "/admin/rewards-recognition/certificate-template",
  performanceManagement: "/admin/masterfiles/performance-management/opcr",
  performanceOpcr: "/admin/masterfiles/performance-management/opcr",
  performanceIpcr: "/admin/masterfiles/performance-management/ipcr",
  leaveBalances: "/admin/masterfiles/leave-balances",
  salaryManagement: "/admin/masterfiles/salary-management",
  salaryAdjustment: "/admin/masterfiles/salary-management/salary-adjustment",
  noticeSalaryAdjustment: "/admin/masterfiles/salary-management/notice-of-salary-adjustment",
  noticeStepIncrement: "/admin/masterfiles/salary-management/notice-of-step-increment",
  attendance: "/admin/attendance",
  overtime: "/admin/attendance/overtime",
  leave: "/admin/leave",
  travel: "/admin/leave/travel-order",
  cto: "/admin/leave/compensatory-time-off",
  passSlip: "/admin/leave/pass-slips",
  calendar: "/admin/calendar",
  payroll: "/admin/payroll/generate",
  payrollGenerate: "/admin/payroll/generate",
  payrollRecords: "/admin/payroll/payslip",
  payrollLoan: "/admin/payroll/loan",
  archivedPayroll: "/admin/payroll/archived",

  reports: "/admin/reports",
  settings: "/admin/settings",
};

const leaveWorkspaceItems = [
  { key: "leave", label: "Leave Management", path: modulePaths.leave },
  { key: "travel", label: "Travel Order Management", path: modulePaths.travel },
  { key: "cto", label: "CTO Management", path: modulePaths.cto },
  { key: "passSlip", label: "Pass Slips", path: modulePaths.passSlip },
];

const salaryManagementViews = [
  {
    key: "salaryAdjustment",
    label: "Salary Adjustment",
    path: modulePaths.salaryAdjustment,
    description: "Prepare and review salary adjustment records based on employee masterfile salary data.",
    emptyMessage: "No salary adjustment records found.",
    columns: [
      { key: "employeeId", header: "Employee ID", cardRole: "eyebrow", render: (row) => row.employeeId || "N/A" },
      { key: "fullName", header: "Employee", cardRole: "title", render: (row) => row.fullName || "N/A" },
      { key: "position", header: "Position", render: (row) => row.position || "N/A" },
      { key: "department", header: "Division", render: (row) => row.department || "N/A" },
      { key: "basicSalary", header: "Current Salary", render: (row) => formatCurrencyValue(row.basicSalary) },
      { key: "salaryRate", header: "Salary Rate", render: (row) => row.salaryRate || "N/A" },
    ],
  },
  {
    key: "noticeSalaryAdjustment",
    label: "Notice of Salary Adjustment",
    path: modulePaths.noticeSalaryAdjustment,
    description: "Track notices prepared for employee salary adjustment actions.",
    emptyMessage: "No notice of salary adjustment records found.",
    columns: [
      { key: "employeeId", header: "Employee ID", cardRole: "eyebrow", render: (row) => row.employeeId || "N/A" },
      { key: "fullName", header: "Employee", cardRole: "title", render: (row) => row.fullName || "N/A" },
      { key: "position", header: "Position", render: (row) => row.position || "N/A" },
      { key: "basicSalary", header: "Salary", render: (row) => formatCurrencyValue(row.basicSalary) },
      { key: "dateHired", header: "Date Hired", render: (row) => formatDateValue(row.dateHired) },
      { key: "status", header: "Notice Status", render: () => "Pending preparation" },
    ],
  },
  {
    key: "noticeStepIncrement",
    label: "Notice of Step Increment",
    path: modulePaths.noticeStepIncrement,
    description: "Review employees for step increment notice preparation and salary movement tracking.",
    emptyMessage: "No notice of step increment records found.",
    columns: [
      { key: "employeeId", header: "Employee ID", cardRole: "eyebrow", render: (row) => row.employeeId || "N/A" },
      { key: "fullName", header: "Employee", cardRole: "title", render: (row) => row.fullName || "N/A" },
      { key: "position", header: "Position", render: (row) => row.position || "N/A" },
      { key: "department", header: "Division", render: (row) => row.department || "N/A" },
      { key: "basicSalary", header: "Current Salary", render: (row) => formatCurrencyValue(row.basicSalary) },
      { key: "status", header: "Eligibility", render: () => "For review" },
    ],
  },
];

const adminModuleBreadcrumbs = {
  dashboard: [{ label: "Dashboard", path: modulePaths.dashboard }],
  messages: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Messages", path: modulePaths.messages }],
  notifications: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Notifications", path: modulePaths.notifications }],
  users: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "User Management", path: modulePaths.users }],
  employees: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Employee Management", path: modulePaths.employees }],
  divisions: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Divisions Management", path: modulePaths.divisions }],
  designations: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Positions Management", path: modulePaths.designations }],
  rbac: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "RBAC Management", path: modulePaths.rbac }],
  serviceRecord: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Service Record", path: modulePaths.serviceRecord }],
  promotions: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Promotions", path: modulePaths.promotions }],
  rewardsNomination: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Recognition & Rewards", path: modulePaths.rewardsNomination },
    { label: "Nomination", path: modulePaths.rewardsNomination },
  ],
  rewardsLoyalty: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Recognition & Rewards", path: modulePaths.rewardsNomination },
    { label: "Loyalty", path: modulePaths.rewardsLoyalty },
  ],
  rewardsCertificateTemplate: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Recognition & Rewards", path: modulePaths.rewardsNomination },
    { label: "Certificate Template", path: modulePaths.rewardsCertificateTemplate },
  ],
  calendar: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Calendar", path: modulePaths.calendar }],
  leaveBalances: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "HR Operations" },
    { label: "Leave Balances", path: modulePaths.leaveBalances },
  ],
  performanceOpcr: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Performance Reviews", path: modulePaths.performanceManagement },
    { label: "OPCR", path: modulePaths.performanceOpcr },
  ],
  performanceIpcr: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Performance Reviews", path: modulePaths.performanceManagement },
    { label: "IPCR", path: modulePaths.performanceIpcr },
  ],
  salaryManagement: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Salary Management", path: modulePaths.salaryManagement }],
  attendance: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Time & Attendance", path: modulePaths.attendance }],
  overtime: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Time & Attendance", path: modulePaths.attendance }, { label: "Overtime", path: modulePaths.overtime }],
  leave: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Leave Management", path: modulePaths.leave }],
  payrollGenerate: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll Management", path: modulePaths.payroll }, { label: "Create Payroll" }],
  payrollRecords: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll Management", path: modulePaths.payroll }, { label: "Payslip" }],
  payrollLoan: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll Management", path: modulePaths.payroll }, { label: "Loan" }],
  archivedPayroll: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll Management", path: modulePaths.payroll }, { label: "Archived Payroll" }],

  reports: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Reports & Analytics", path: modulePaths.reports }],
  settings: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Settings", path: modulePaths.settings }],
};

function moduleFromPath(pathname) {
  if (pathname === "/admin/dashboard" || pathname === "/admindashboard" || pathname === "/") {
    return "dashboard";
  }

  if (pathname === "/admin/users" || pathname === "/user" || pathname === "/users") {
    return "users";
  }

  if (pathname === "/admin/messages" || pathname === "/messages" || pathname === "/message") {
    return "messages";
  }

  if (pathname === modulePaths.notifications || pathname.startsWith(`${modulePaths.notifications}/`)) {
    return "notifications";
  }

  if (pathname === "/admin/employees" || pathname === "/employee" || pathname === "/employees") {
    return "employees";
  }

  if (pathname === modulePaths.divisions) {
    return "divisions";
  }

  if (pathname === modulePaths.designations) {
    return "designations";
  }

  if (pathname === modulePaths.rbac) {
    return "rbac";
  }

  if (pathname === modulePaths.serviceRecord) {
    return "serviceRecord";
  }

  if (pathname === modulePaths.promotions) {
    return "promotions";
  }

  if (pathname === modulePaths.rewardsLoyalty) {
    return "rewardsLoyalty";
  }

  if (pathname === modulePaths.rewardsCertificateTemplate) {
    return "rewardsCertificateTemplate";
  }

  // The bare route is what older links point at; send it to the first award rather than nowhere.
  if (pathname === modulePaths.rewardsRecognition || pathname === modulePaths.rewardsNomination) {
    return "rewardsNomination";
  }

  if (pathname === modulePaths.calendar) {
    return "calendar";
  }

  if (pathname === modulePaths.performanceManagement || pathname === modulePaths.performanceOpcr) {
    return "performanceOpcr";
  }

  if (pathname === modulePaths.performanceIpcr) {
    return "performanceIpcr";
  }

  if (pathname === modulePaths.performanceRatingPeriods) {
    return "performanceRatingPeriods";
  }

  if (pathname === modulePaths.leaveBalances) {
    return "leaveBalances";
  }

  if (pathname === modulePaths.salaryManagement || pathname.startsWith(`${modulePaths.salaryManagement}/`)) {
    return "salaryManagement";
  }

  if (pathname === "/admin/attendance" || pathname === "/attendance") {
    return "attendance";
  }

  if (pathname === modulePaths.overtime) {
    return "overtime";
  }

  if (pathname === "/admin/leave" || pathname.startsWith("/admin/leave/") || pathname === "/leave") {
    return "leave";
  }

  if (pathname === "/admin/payroll" || pathname === "/admin/payroll/generate" || pathname === "/payroll") {
    return "payrollGenerate";
  }

  if (pathname === "/admin/payroll/records" || pathname === "/admin/payroll/payslip") {
    return "payrollRecords";
  }

  if (pathname === "/admin/payroll/loan") {
    return "payrollLoan";
  }

  if (pathname === "/admin/payroll/archived") {
    return "archivedPayroll";
  }




  if (
    pathname === "/admin/reports"
    || pathname === "/reports"
    || pathname.startsWith("/admin/reports/")
  ) {
    return "reports";
  }

  if (pathname === "/admin/settings" || pathname === "/settings") {
    return "settings";
  }

  return "dashboard";
}

function leaveViewFromPath(pathname) {
  if (pathname === modulePaths.travel) {
    return "travel";
  }

  if (pathname === modulePaths.cto) {
    return "cto";
  }

  if (pathname === modulePaths.passSlip) {
    return "passSlip";
  }

  return "leave";
}

function salaryManagementViewFromPath(pathname) {
  return salaryManagementViews.find((item) => item.path === pathname)?.key;
}

const defaultUserFormValues = {
  email: "",
  username: "",
  password: "",
  roleId: "",
  status: "",
  mustChangePassword: true,
};

function CreateUserForm({
  initialValues = null,
  options,
  onSubmit,
  submitLabel = "Create User",
}) {
  const [form, setForm] = useState(defaultUserFormValues);
  const [errors, setErrors] = useState({});

  const roles = useMemo(() => options?.roles || [], [options?.roles]);
  const statuses = useMemo(() => options?.statuses || [], [options?.statuses]);
  const maximumPasswordLength = Number(options?.security?.maximumPasswordLength) || 64;
  const isEditing = Boolean(initialValues?.id);

  useEffect(() => {
    setForm({
      email: initialValues?.email || "",
      username: initialValues?.username || "",
      password: "",
      roleId: initialValues?.roleId ? String(initialValues.roleId) : "",
      status: initialValues?.status ? String(initialValues.status) : "",
      // The API stores this as 1/0; the checkbox wants a real boolean.
      mustChangePassword: initialValues ? [true, 1, "1"].includes(initialValues.mustChangePassword) : true,
    });
    setErrors({});
  }, [initialValues]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      roleId: current.roleId || String(roles[0]?.id || ""),
      status: current.status || String(statuses[0]?.value || ""),
    }));
  }, [roles, statuses]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const validate = () => {
    const nextErrors = {};

    if (!form.email.trim()) nextErrors.email = "Email is required.";
    if (!form.username.trim()) nextErrors.username = "Username is required.";
    if (!isEditing && !form.password) nextErrors.password = "Password is required.";
    if (form.password && form.password.length < 6) nextErrors.password = "Use at least 6 characters.";
    if (form.password && form.password.length > maximumPasswordLength) {
      nextErrors.password = `Password must not exceed ${maximumPasswordLength} characters.`;
    }
    if (!form.roleId) nextErrors.roleId = "Role is required.";
    if (!form.status) nextErrors.status = "Status is required.";

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    const payload = {
      username: form.username.trim(),
      email: form.email.trim(),
      roleId: form.roleId,
      status: form.status,
      mustChangePassword: form.mustChangePassword,
    };

    if (form.password) {
      payload.password = form.password;
    }

    onSubmit?.(payload);
  };

  const roleWarning = roles.length === 0
    ? "No supported workforce roles are available from the backend yet."
    : "";
  const statusWarning = statuses.length === 0
    ? "No account statuses are available from the backend yet."
    : "";
  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      {roleWarning || statusWarning ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          {roleWarning || statusWarning}
        </div>
      ) : null}

      <InputField
        label="Email *"
        name="email"
        type="email"
        value={form.email}
        onChange={updateField("email")}
        placeholder="Employee email"
        icon={Mail}
        error={errors.email}
      />

      <InputField
        label="Username *"
        name="username"
        value={form.username}
        onChange={updateField("username")}
        placeholder="Enter username"
        icon={UserRound}
        error={errors.username}
      />

      {!isEditing ? (
        <InputField
          label="Password *"
          name="password"
          type="password"
          value={form.password}
          onChange={updateField("password")}
          placeholder="Enter temporary password"
          error={errors.password}
          maxLength={maximumPasswordLength}
        />
      ) : null}

      <UserSelectField
        label="Role *"
        name="roleId"
        value={form.roleId}
        onChange={updateField("roleId")}
        error={errors.roleId}
      >
        <option value="">Select role</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.label || role.name}
          </option>
        ))}
      </UserSelectField>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

const employeeIdCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Employee ID order, numeric-aware so 0002 comes before 0010. Records with no ID go last, oldest
 * first. `employeeIdOf` reads the ID, since employee rows carry `employeeId` and user rows
 * `employee_id`.
 */
function compareByEmployeeId(employeeIdOf) {
  return (firstRecord, secondRecord) => {
    const firstEmployeeId = String(employeeIdOf(firstRecord) || "").trim();
    const secondEmployeeId = String(employeeIdOf(secondRecord) || "").trim();

    if (firstEmployeeId && secondEmployeeId) {
      return employeeIdCollator.compare(firstEmployeeId, secondEmployeeId);
    }

    if (firstEmployeeId) {
      return -1;
    }

    if (secondEmployeeId) {
      return 1;
    }

    return Number(firstRecord?.id || 0) - Number(secondRecord?.id || 0);
  };
}

const compareEmployeesByEmployeeId = compareByEmployeeId((employee) => employee?.employeeId);

/* The admin account shows "—" in the Employee ID column, so it sorts as having no ID. */
const compareUsersByEmployeeId = compareByEmployeeId((user) => (
  normalizeRole(user?.role) === "admin" ? "" : user?.employee_id
));

function resolveEmployeeInitials(employee) {
  const name = String(employee?.fullName || employee?.email || "Employee").trim();
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "E";
}

function formatCurrencyValue(value) {
  const amount = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(amount) ? currencyFormat.format(amount) : "N/A";
}

function formatDateValue(value) {
  const dateText = String(value || "").trim();

  if (!dateText) {
    return "N/A";
  }

  const [year, month, day] = dateText.split("-").map((part) => Number(part));
  const parsedDate = year && month && day ? new Date(year, month - 1, day) : new Date(dateText);

  if (Number.isNaN(parsedDate.getTime())) {
    return dateText;
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function getEmployeeCardStatus(employee, linkedUser, archiveView) {
  if (archiveView === "archive") {
    return "Archived";
  }

  return getStatusLabel(linkedUser?.status || employee.status || "No Account");
}

function isUserEmailVerified(row) {
  return Boolean(row?.emailVerifiedAt || row?.email_verified_at || row?.isEmailVerified);
}

function getUserEmailVerificationLabel(row) {
  return isUserEmailVerified(row) ? "Verified" : "Pending Verification";
}

function userEmailVerificationBadgeClass(row) {
  return isUserEmailVerified(row)
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function employeeStatusBadgeClass(status) {
  switch (normalizeStatus(status)) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "inactive":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "archived":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-rose-200 bg-rose-50 text-rose-700";
  }
}

export default function AdminDashboard({
  user,
  onLogout,
  currentPath = "/admin/dashboard",
  onNavigate,
  onUserChange,
}) {
  const [activeModule, setActiveModule] = useState(() => moduleFromPath(currentPath));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [accountCardOpen, setAccountCardOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeViewOpen, setEmployeeViewOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const [employeeRowsPerPage, setEmployeeRowsPerPage] = useState(DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
  const [employeeOptions, setEmployeeOptions] = useState({
    divisions: [],
    designations: [],
    emailDomainPolicy: {},
  });
  const [securitySettings, setSecuritySettings] = useState(DEFAULT_SECURITY_SETTINGS);
  const [employeeError, setEmployeeError] = useState("");
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [archivedUsers, setArchivedUsers] = useState([]);
  const [userOptions, setUserOptions] = useState({ roles: [], statuses: [] });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardDetailsRequested, setDashboardDetailsRequested] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [rbacRoleKey, setRbacRoleKey] = useState("");
  const [userViewOpen, setUserViewOpen] = useState(false);
  const [linkedUserModalOpen, setLinkedUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [viewingUser, setViewingUser] = useState(null);
  const [userError, setUserError] = useState("");
  const [linkedUserError, setLinkedUserError] = useState("");
  const [userSaving, setUserSaving] = useState(false);
  const [linkedUserSaving, setLinkedUserSaving] = useState(false);
  const [userStatusSavingId, setUserStatusSavingId] = useState(null);
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState("");
  const [userArchiveView, setUserArchiveView] = useState("active");
  const [userPage, setUserPage] = useState(1);
  const [userRowsPerPage, setUserRowsPerPage] = useState(DEFAULT_USER_ROWS_PER_PAGE);
  const [employeeDivisionFilter, setEmployeeDivisionFilter] = useState("");
  const [employeeDesignationFilter, setEmployeeDesignationFilter] = useState("");
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState("");
  const [employeeArchiveView, setEmployeeArchiveView] = useState("active");
  const [employeeImporting, setEmployeeImporting] = useState(false);
  const [employeePage, setEmployeePage] = useState(DEFAULT_EMPLOYEE_PAGE);
  const [selectedSalaryManagementView, setSelectedSalaryManagementView] = useState("salaryAdjustment");

  const [employees, setEmployees] = useState([]);
  const [archivedEmployees, setArchivedEmployees] = useState([]);
  const employeeImportInputRef = useRef(null);
  const profilePath = getProfilePathForRole(user?.roleKey || user?.role);
  const isProfileView = currentPath === profilePath;
  const permissionDenied = !userCanAccessModule(user, isProfileView ? "profile" : activeModule);
  const isMessagesWorkspaceView = !isProfileView && activeModule === "messages";
  const isNotificationsWorkspaceView = !isProfileView && activeModule === "notifications";
  const isTableWorkspaceView = isMessagesWorkspaceView || isNotificationsWorkspaceView;
  const activeLeaveView = leaveViewFromPath(currentPath);
  const activeLeaveItem = leaveWorkspaceItems.find((item) => item.key === activeLeaveView) || leaveWorkspaceItems[0];
  const activeSalaryManagementView = salaryManagementViewFromPath(currentPath) || selectedSalaryManagementView;
  const activeSalaryManagementItem = salaryManagementViews.find((item) => item.key === activeSalaryManagementView) || salaryManagementViews[0];
  const breadcrumbs = isProfileView
    ? [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "My Profile" }]
    : activeModule === "leave"
      ? [
          { label: "Dashboard", path: modulePaths.dashboard },
          { label: activeLeaveItem.label, path: activeLeaveItem.path },
        ]
    : activeModule === "salaryManagement"
      ? [
          { label: "Dashboard", path: modulePaths.dashboard },
          { label: "Salary Management", path: modulePaths.salaryManagement },
          { label: activeSalaryManagementItem.label, path: activeSalaryManagementItem.path },
        ]
    : activeModule === "notifications"
      ? [
          { label: "Dashboard", path: modulePaths.dashboard },
          { label: "Notifications", path: modulePaths.notifications },
        ]
    : (adminModuleBreadcrumbs[activeModule] || adminModuleBreadcrumbs.dashboard);
  const contentAnimationKey = isProfileView ? "profile" : `${activeModule}-${currentPath || ""}`;

  const resetEmployeeTable = useCallback(() => {
    setEmployeeQuery("");
    setEmployeeDivisionFilter("");
    setEmployeeDesignationFilter("");
    setEmployeeStatusFilter("");
    setEmployeeRowsPerPage(DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
    setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
    setEmployeeArchiveView("active");
  }, []);

  useEffect(() => {
    const nextModule = moduleFromPath(currentPath);
    setActiveModule(nextModule);

    if (nextModule === "users") {
      setUserPage(1);
    }

    if (nextModule === "employees") {
      resetEmployeeTable();
    }
  }, [currentPath, resetEmployeeTable]);

  const needsAdminRecords = !permissionDenied && (activeModule !== "dashboard" || dashboardDetailsRequested);

  useEffect(() => {
    if (!needsAdminRecords) {
      setDashboardLoading(false);
      return undefined;
    }

    let mounted = true;

    const loadData = async () => {
      if (mounted) {
        setDashboardLoading(true);
      }

      try {
        const [employeesResult, archivedEmployeesResult, optionsResult, usersResult, archivedUsersResult, settingsResult] = await Promise.allSettled([
          getEmployees(),
          getArchivedEmployees(),
          getEmployeeOptions(),
          getUsers(),
          getArchivedUsers(),
          getSettings(),
        ]);

        if (!mounted) {
          return;
        }

        // An empty body counts the same as a failed call: one blank response must not abort the
        // state updates for the five lists that did arrive.
        const nextEmployees = (employeesResult.status === "fulfilled" && employeesResult.value) || {};
        const nextArchivedEmployees = (archivedEmployeesResult.status === "fulfilled" && archivedEmployeesResult.value) || {};
        const nextOptions = (optionsResult.status === "fulfilled" && optionsResult.value) || {};
        const nextUsers = (usersResult.status === "fulfilled" && usersResult.value) || {};
        const nextArchivedUsers = (archivedUsersResult.status === "fulfilled" && archivedUsersResult.value) || {};
        const nextSettings = (settingsResult.status === "fulfilled" && settingsResult.value) || {};

        setEmployees(nextEmployees.employees || []);
        setArchivedEmployees(nextArchivedEmployees.employees || []);
        setEmployeeOptions({
          divisions: nextOptions.divisions || [],
          designations: nextOptions.designations || [],
          designationSuggestions: nextOptions.designationSuggestions || [],
          emailDomainPolicy: nextOptions.emailDomainPolicy || nextSettings.emailDomainPolicy || {},
        });
        setUsers(nextUsers.users || []);
        setArchivedUsers(nextArchivedUsers.users || []);
        setUserOptions({
          roles: nextUsers.roles || [],
          statuses: nextUsers.statuses || [],
        });
        setSecuritySettings({
          ...DEFAULT_SECURITY_SETTINGS,
          ...(nextSettings.security || {}),
        });
        const failedRequest = [employeesResult, archivedEmployeesResult, optionsResult, usersResult, archivedUsersResult, settingsResult]
          .find((result) => result.status === "rejected");

        if (failedRequest) {
          const message = failedRequest.reason?.response?.data?.message || "Some admin records could not be loaded.";
          setEmployeeError(message);
          setUserError(message);
        } else {
          setEmployeeError("");
          setUserError("");
        }
      } catch (error) {
        if (!mounted) {
          return;
        }
        const message = error.response?.data?.message || "Unable to load admin records.";
        setEmployeeError(message);
        setUserError(message);
      } finally {
        if (mounted) {
          setDashboardLoading(false);
        }
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [needsAdminRecords]);

  useEffect(() => {
    if (!isTableWorkspaceView) {
      return undefined;
    }

    const desktopMediaQuery = window.matchMedia("(min-width: 1024px)");

    if (!desktopMediaQuery.matches) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isTableWorkspaceView]);

  const managedUsers = users;
  const managedArchivedUsers = archivedUsers;
  const managedRoleOptions = useMemo(
    () => getManagedRoleOptions(userOptions.roles || [], editingUser?.role || null),
    [editingUser?.role, userOptions.roles]
  );
  const employeeRoleOptions = useMemo(
    () => (userOptions.roles || [])
      .filter((role) => editingEmployee?.id || normalizeRole(role.name) !== "admin")
      .map((role) => ({
        ...role,
        key: normalizeRole(role.name),
        label: getRoleLabel(role.name),
      })),
    [editingEmployee?.id, userOptions.roles]
  );
  const userByEmail = useMemo(
    () => {
      const nextMap = new Map();

      users.forEach((item) => {
        const emailKey = String(item.email || "").trim().toLowerCase();
        if (emailKey) {
          nextMap.set(emailKey, item);
        }
      });

      return nextMap;
    },
    [users]
  );
  const allUserByEmail = useMemo(
    () => {
      const nextMap = new Map();

      [...archivedUsers, ...users].forEach((item) => {
        const emailKey = String(item?.email || "").trim().toLowerCase();
        if (emailKey) {
          nextMap.set(emailKey, item);
        }
      });

      return nextMap;
    },
    [archivedUsers, users]
  );
  /*
   * user.php now sends the two values `users.status` accepts as plain strings ("Active",
   * "Inactive") rather than rows from a lookup table. `value` is what gets posted back; there is no
   * id to carry any more.
   */
  const managedStatusOptions = useMemo(
    () => (userOptions.statuses || []).map((status) => ({
      value: String(status),
      label: getStatusLabel(status),
    })),
    [userOptions.statuses]
  );

  const handleSettingsChange = useCallback((nextSettings = {}) => {
    const hasDivisions = Array.isArray(nextSettings.divisions);
    const hasDesignations = Array.isArray(nextSettings.designations);

    // A roles-only update should never erase organization choices from an open
    // employee form.  Apply this part of the settings payload only when it really
    // carries divisions or designations, preserving the other current collection.
    if (hasDivisions || hasDesignations) {
      setEmployeeOptions((current) => {
        const activeDivisions = (hasDivisions ? nextSettings.divisions : current.divisions || [])
          .filter((division) => Number(division?.is_archived ?? division?.isArchived ?? 0) === 0);
        const activeDivisionIds = new Set(activeDivisions.map((division) => String(division.id)));
        const activeDesignations = (hasDesignations ? nextSettings.designations : current.designations || [])
          .filter((designation) => {
            const divisionId = String(designation?.division_id ?? designation?.divisionId ?? "");
            const isDesignationArchived = Number(designation?.is_archived ?? designation?.isArchived ?? 0) === 1;
            return !isDesignationArchived && activeDivisionIds.has(divisionId);
          });

        return {
          ...current,
          divisions: activeDivisions,
          designations: activeDesignations,
        };
      });
    }

    if (nextSettings.emailDomainPolicy) {
      setEmployeeOptions((current) => ({
        ...current,
        emailDomainPolicy: nextSettings.emailDomainPolicy,
      }));
    }

    if (nextSettings.security) {
      setSecuritySettings({
        ...DEFAULT_SECURITY_SETTINGS,
        ...nextSettings.security,
      });
    }

    // The Roles settings screen returns role metadata after a create/edit/delete.
    // Mirror it into the user form's option list so a freshly created custom role
    // can be assigned immediately instead of requiring a dashboard reload.
    if (Array.isArray(nextSettings.roles)) {
      const nextRoles = nextSettings.roles
        .filter((role) => role && role.id != null && (role.label || role.name))
        .map((role) => ({
          id: role.id,
          name: role.label || role.name,
          baseRole: role.baseRole || null,
          description: role.description || "",
        }));

      if (nextRoles.length > 0) {
        setUserOptions((current) => ({
          ...current,
          roles: nextRoles,
        }));
      }
    }
  }, []);

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLowerCase();
    const visibleUsers = userArchiveView === "archive" ? managedArchivedUsers : managedUsers;

    return visibleUsers.filter((item) => {
      const matchesSearch = !search || [item.employee_id, item.username, item.full_name, item.email, item.role, item.division, getUserEmailVerificationLabel(item)]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(search));
      const matchesRole = !userRoleFilter || normalizeRole(item.role) === userRoleFilter;
      const matchesStatus = !userStatusFilter || normalizeStatus(item.status) === normalizeStatus(userStatusFilter);

      return matchesSearch && matchesRole && matchesStatus;
    }).sort(compareUsersByEmployeeId);
  }, [managedArchivedUsers, managedUsers, query, userArchiveView, userRoleFilter, userStatusFilter]);
  /* Every role in the roles table and every value users.status accepts, as user.php reports them. */
  const userRoleFilterOptions = useMemo(
    () => {
      const roleMap = new Map();

      (userOptions.roles || []).forEach((role) => {
        const key = normalizeRole(role.name);

        if (key && !roleMap.has(key)) {
          roleMap.set(key, getRoleLabel(role.name));
        }
      });

      return Array.from(roleMap, ([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label));
    },
    [userOptions.roles]
  );
  const userStatusOptions = useMemo(
    () => Array.from(new Set(
      (userOptions.statuses || []).map((status) => getStatusLabel(status || "Unknown"))
    )),
    [userOptions.statuses]
  );
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / userRowsPerPage));
  const safeUserPage = Math.min(userPage, totalUserPages);
  const paginatedUsers = useMemo(() => {
    const startIndex = (safeUserPage - 1) * userRowsPerPage;
    return filteredUsers.slice(startIndex, startIndex + userRowsPerPage);
  }, [filteredUsers, safeUserPage, userRowsPerPage]);

  /*
   * Every employee record is listed whatever role its account holds -- a Chief, HR Head, or
   * Regional Director created from User Management lands here the same as an Employee, with the
   * Role column telling them apart. Filtering the roster by account role also made it depend on
   * the users list, which an admin without the users permission never receives.
   */
  const visibleEmployees = employeeArchiveView === "archive" ? archivedEmployees : employees;
  /* An employee row shows its linked account status, so this is the users.status list too. */
  const employeeStatusOptions = userStatusOptions;
  const filteredEmployees = useMemo(() => {
    const search = employeeQuery.trim().toLowerCase();

    return visibleEmployees.filter((employee) => {
      const emailKey = String(employee.email || "").trim().toLowerCase();
      const linkedUser = userByEmail.get(emailKey);
      const statusLabel = getEmployeeCardStatus(employee, linkedUser, employeeArchiveView);
      const matchesSearch = !search || [
        employee.employeeId,
        employee.fullName,
        employee.department,
        employee.position,
        employee.designation,
        getRoleLabel(allUserByEmail.get(emailKey)?.role),
        linkedUser?.status,
        statusLabel,
        employee.basicSalary,
        employee.dateHired,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesDivision = !employeeDivisionFilter || employee.department === employeeDivisionFilter;
      const matchesDesignation = !employeeDesignationFilter || employee.position === employeeDesignationFilter;
      const matchesStatus = !employeeStatusFilter || statusLabel === employeeStatusFilter;

      return matchesSearch && matchesDivision && matchesDesignation && matchesStatus;
    });
  }, [employeeArchiveView, employeeDesignationFilter, employeeDivisionFilter, employeeStatusFilter, employeeQuery, allUserByEmail, userByEmail, visibleEmployees]);
  const employeeDivisionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (employeeOptions.divisions || [])
            .map((division) => String(division.name || division.code || "").trim())
            .filter(Boolean)
        )
      ).sort(),
    [employeeOptions.divisions]
  );
  /* Positions from the position catalog only -- not titles picked off the rows. */
  const employeeDesignationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (employeeOptions.designations || [])
            .map((designation) => String(designation.name || "").trim())
            .filter(Boolean)
        )
      ).sort(),
    [employeeOptions.designations]
  );
  const activeEmployeeCount = useMemo(
    () =>
      employees.filter((employee) => {
        const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
        return normalizeStatus(linkedUser?.status || employee.status || "Inactive") === "active";
      }).length,
    [employees, userByEmail]
  );
  const inactiveEmployeeCount = Math.max(0, employees.length - activeEmployeeCount)
    + archivedEmployees.length;

  const nextEmployeeId = useMemo(
    () => buildNextEmployeeId([...employees, ...archivedEmployees]),
    [archivedEmployees, employees]
  );
  const sortedFilteredEmployees = useMemo(
    () => [...filteredEmployees].sort(compareEmployeesByEmployeeId),
    [filteredEmployees]
  );
  const totalEmployeePages = Math.max(1, Math.ceil(filteredEmployees.length / employeeRowsPerPage));
  const safeEmployeePage = Math.min(employeePage, totalEmployeePages);
  const paginatedEmployees = useMemo(
    () => {
      const startIndex = (safeEmployeePage - 1) * employeeRowsPerPage;
      return sortedFilteredEmployees.slice(startIndex, startIndex + employeeRowsPerPage);
    },
    [sortedFilteredEmployees, safeEmployeePage, employeeRowsPerPage]
  );

  const employeeFormInitialValues = useMemo(() => {
    if (!editingEmployee) {
      return null;
    }

    const employeeEmail = String(editingEmployee.email || "").trim().toLowerCase();
    const linkedUser = employeeEmail
      ? users.find((item) => String(item.email || "").trim().toLowerCase() === employeeEmail)
      : null;

    return {
      ...editingEmployee,
      roleId: linkedUser?.roleId ? String(linkedUser.roleId) : "",
    };
  }, [editingEmployee, users]);

  const handleUserStatusChange = async (row, nextStatusValue) => {
    const selectedStatus = String(nextStatusValue || "");

    if (!selectedStatus || normalizeStatus(selectedStatus) === normalizeStatus(row.status)) {
      return;
    }

    const roleId =
      row.roleId
      || managedRoleOptions.find((role) => normalizeRole(role.name || role.label) === normalizeRole(row.role))?.id
      || "";

    if (!roleId) {
      setUserError("Unable to update status because the user's role is missing.");
      return;
    }

    const mustChangePassword =
      row.mustChangePassword === true
      || row.mustChangePassword === 1
      || row.mustChangePassword === "1";

    setUserStatusSavingId(row.id);
    setUserError("");

    try {
      const result = await updateUser(row.id, {
        username: row.username,
        email: row.email,
        roleId,
        status: selectedStatus,
        mustChangePassword,
      });
      const savedUser = result.user;
      const savedStatus = savedUser?.status || selectedStatus;
      const savedStatusLabel = getStatusLabel(savedStatus);

      setUsers((current) => current.map((item) => (item.id === row.id ? savedUser : item)));
      if (normalizeStatus(savedStatus) === "inactive") {
        toast.error(`${row.username} is inactive.`);
      } else {
        toast.success(`${row.username} is now ${savedStatusLabel}.`);
      }
    } catch (error) {
      setUserError(error.response?.data?.message || "Unable to update user status.");
    } finally {
      setUserStatusSavingId(null);
    }
  };

  const openUserViewer = (row) => {
    setViewingUser(row);
    setUserViewOpen(true);
  };

  const closeUserViewer = () => {
    setUserViewOpen(false);
    setViewingUser(null);
  };

  const handleArchiveUser = async (row) => {
    const confirmation = await Swal.fire({
      title: "Archive user?",
      text: `${row.full_name || row.username || "This user"} will move to Archived Users.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Archive",
      confirmButtonColor: "#ef3b2d",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await archiveUser(row.id);
      const archivedUser = result.user || { ...row, isArchived: 1 };
      setUsers((current) => current.filter((item) => item.id !== row.id));
      setArchivedUsers((current) => (
        current.some((item) => item.id === row.id)
          ? current.map((item) => (item.id === row.id ? archivedUser : item))
          : [archivedUser, ...current]
      ));
      setUserError("");
      closeUserViewer();
      toast.success(result.message || "User archived successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to archive user.";
      setUserError(message);
      toast.error(message);
    }
  };

  const handleRestoreUser = async (row) => {
    const confirmation = await Swal.fire({
      title: "Restore user?",
      text: `${row.full_name || row.username || "This user"} will return to Active Users.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Restore",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await restoreUser(row.id);
      const restoredUser = result.user || { ...row, isArchived: 0 };
      setArchivedUsers((current) => current.filter((item) => item.id !== row.id));
      setUsers((current) => (
        current.some((item) => item.id === row.id)
          ? current.map((item) => (item.id === row.id ? restoredUser : item))
          : [restoredUser, ...current]
      ));
      setUserError("");
      closeUserViewer();
      toast.success(result.message || "User restored successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to restore user.";
      setUserError(message);
      toast.error(message);
    }
  };

  const handleEmployeeAccountStatusToggle = async (employeeRow) => {
    const linkedUser = userByEmail.get(String(employeeRow.email || "").trim().toLowerCase());

    if (!linkedUser) {
      const message = "No linked user account found for this employee.";
      setEmployeeError(message);
      toast.error(message);
      return;
    }

    const currentStatus = normalizeStatus(linkedUser.status);
    const nextStatusKey = currentStatus === "active" ? "inactive" : "active";
    const nextStatus = managedStatusOptions.find(
      (status) => normalizeStatus(status.value) === nextStatusKey
    );

    if (!nextStatus?.value) {
      const message = `Unable to find the ${getStatusLabel(nextStatusKey)} account status.`;
      setEmployeeError(message);
      toast.error(message);
      return;
    }

    if (linkedUser.id === user?.id && nextStatusKey === "inactive") {
      const message = "You cannot set your current account to inactive.";
      setEmployeeError(message);
      toast.error(message);
      return;
    }

    const roleId =
      linkedUser.roleId
      || managedRoleOptions.find((role) => normalizeRole(role.name || role.label) === normalizeRole(linkedUser.role))?.id
      || "";

    if (!roleId) {
      const message = "Unable to update status because the linked account role is missing.";
      setEmployeeError(message);
      toast.error(message);
      return;
    }

    const mustChangePassword =
      linkedUser.mustChangePassword === true
      || linkedUser.mustChangePassword === 1
      || linkedUser.mustChangePassword === "1";

    setUserStatusSavingId(linkedUser.id);
    setEmployeeError("");

    try {
      const result = await updateUser(linkedUser.id, {
        username: linkedUser.username,
        email: linkedUser.email,
        roleId,
        status: nextStatus.value,
        mustChangePassword,
      });
      const savedUser = result.user;
      const savedStatus = savedUser?.status || nextStatus.value;
      const employeeName = employeeRow.fullName || linkedUser.username || "Employee";

      setUsers((current) => current.map((item) => (item.id === linkedUser.id ? savedUser : item)));

      if (normalizeStatus(savedStatus) === "inactive") {
        toast.error(`${employeeName} is inactive and cannot log in.`);
      } else {
        toast.success(`${employeeName} is active and can log in.`);
      }
    } catch (error) {
      const message = error.response?.data?.message || "Unable to update employee account status.";
      setEmployeeError(message);
      toast.error(message);
    } finally {
      setUserStatusSavingId(null);
    }
  };

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const userColumns = [
    {
      key: "employeeId",
      header: "Employee ID",
      cardRole: "eyebrow",
      render: (row) => (
        <span className="font-semibold text-slate-900">{normalizeRole(row.role) === "admin" ? "—" : row.employee_id || "Pending"}</span>
      ),
    },
    {
      key: "fullName",
      header: "Full Name",
      cardRole: "title",
      render: (row) => <strong className="font-semibold text-slate-900">{row.full_name || row.username || "N/A"}</strong>,
    },
    { key: "email", header: "Email", cardRole: "subtitle", render: (row) => row.email || "N/A" },
    {
      key: "emailVerification",
      header: "Email Verification",
      render: (row) => (
        <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-sm font-semibold ${userEmailVerificationBadgeClass(row)}`}>
          {getUserEmailVerificationLabel(row)}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      cardRole: "badge",
      render: (row) => (
        <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-sm font-semibold ${getRoleBadgeClass(row.role)}`}>
          {getRoleLabel(row.role)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        if (userArchiveView === "archive") {
          return (
            <span className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 text-sm font-semibold text-slate-600">
              Archived
            </span>
          );
        }

        const currentStatus = normalizeStatus(row.status);
        const nextStatusKey = currentStatus === "active" ? "inactive" : "active";
        const nextStatus = managedStatusOptions.find(
          (status) => normalizeStatus(status.value) === nextStatusKey
        );
        const isActive = currentStatus === "active";
        const isSaving = userStatusSavingId === row.id;

        return (
          <button
            type="button"
            aria-label={`Change ${row.username} to ${getStatusLabel(nextStatusKey)}`}
            title={`Click to set ${getStatusLabel(nextStatusKey)}`}
            disabled={isSaving || !nextStatus?.value}
            onClick={() => handleUserStatusChange(row, nextStatus?.value)}
            className={`inline-flex min-h-8 items-center rounded-full border px-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:opacity-70 ${
              isActive
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            {isSaving ? "Saving..." : getStatusLabel(row.status)}
          </button>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => openUserViewer(row)}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-sky-600 bg-sky-500 px-2.5 text-xs font-semibold text-white transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
          >
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
            View
          </button>
          {userArchiveView === "archive" ? (
            <button
              type="button"
              onClick={() => handleRestoreUser(row)}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-600 px-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingUser(row);
                  setUserError("");
                  setUserModalOpen(true);
                }}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-amber-600 bg-amber-500 px-2.5 text-xs font-semibold text-white transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-200"
              >
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                disabled={row.id === user?.id}
                onClick={() => handleArchiveUser(row)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-700 bg-[#ef3b2d] px-2.5 text-xs font-semibold text-white transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Archive aria-hidden="true" className="h-3.5 w-3.5" />
                Archive
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const employeeColumns = [
    {
      key: "employeeId",
      header: "Employee ID",
      cardRole: "eyebrow",
      render: (row) => (
        <span className="font-semibold text-slate-900">{row.employeeId || "N/A"}</span>
      ),
    },
    {
      key: "fullName",
      header: "Full Name",
      cardRole: "title",
      render: (row) => {
        const avatarUrl = resolveBackendAssetUrl(row.profileImage);
        return (
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-bold text-slate-500">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={row.fullName || "Employee"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{resolveEmployeeInitials(row)}</span>
              )}
            </div>
            <strong className="font-semibold text-slate-900">{row.fullName || "N/A"}</strong>
          </div>
        );
      },
    },
    {
      key: "department",
      header: "Division",
      render: (row) => <span className="text-slate-700">{row.department || "N/A"}</span>,
    },
    {
      key: "position",
      header: "Position",
      cardRole: "subtitle",
      render: (row) => (
        <span className="text-slate-700">
          {row.position || "N/A"}
          {row.designation ? <span className="block text-xs text-slate-500">{row.designation}</span> : null}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      cardRole: "badge",
      render: (row) => {
        const linkedUser = allUserByEmail.get(String(row.email || "").trim().toLowerCase());
        const roleLabel = getRoleLabel(linkedUser?.role);

        return (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${getRoleBadgeClass(linkedUser?.role)}`}>
            {roleLabel}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const linkedUser = userByEmail.get(String(row.email || "").trim().toLowerCase());
        const statusLabel = getEmployeeCardStatus(row, linkedUser, employeeArchiveView);
        const normalizedStatus = normalizeStatus(statusLabel);
        const isArchived = employeeArchiveView === "archive";
        const isSaving = Boolean(
          linkedUser
          && userStatusSavingId !== null
          && String(userStatusSavingId) === String(linkedUser.id)
        );
        const canToggleStatus = !isArchived && Boolean(linkedUser) && ["active", "inactive"].includes(normalizedStatus);

        if (canToggleStatus) {
          return (
            <button
              type="button"
              aria-label={normalizedStatus === "active" ? `Set ${row.fullName || "employee"} inactive` : `Set ${row.fullName || "employee"} active`}
              title={normalizedStatus === "active" ? "Click to set inactive" : "Click to set active"}
              disabled={isSaving}
              onClick={() => handleEmployeeAccountStatusToggle(row)}
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70 ${
                normalizedStatus === "active"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 focus:ring-emerald-100"
                  : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 focus:ring-amber-100"
              }`}
            >
              {isSaving ? "Saving..." : statusLabel}
            </button>
          );
        }

        return (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${employeeStatusBadgeClass(statusLabel)}`}>
            {statusLabel}
          </span>
        );
      },
    },
    {
      key: "dateHired",
      header: "Date Hired",
      render: (row) => <span className="text-slate-700">{formatDateValue(row.dateHired)}</span>,
    },
    {
      key: "salary",
      header: "Salary",
      render: (row) => <strong className="font-semibold text-slate-900">{formatCurrencyValue(row.basicSalary)}</strong>,
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (row) => {
        const isArchived = employeeArchiveView === "archive";
        return (
          <div className="flex items-center gap-2">
            <ActionIconButton
              label={`View ${row.fullName || row.employeeId || "employee"}`}
              icon={faEyeAction}
              tone="view"
              onClick={() => openEmployeeViewer(row)}
            />
            {isArchived ? (
              <ActionIconButton
                label={`Restore ${row.fullName || row.employeeId || "employee"}`}
                icon={faClockRotateLeft}
                tone="approve"
                text="Restore"
                onClick={() => handleRestoreEmployee(row)}
              />
            ) : (
              <>
                <ActionIconButton
                  label={`Edit ${row.fullName || row.employeeId || "employee"}`}
                  icon={faPen}
                  tone="edit"
                  onClick={() => openEmployeeRecordEditor(row)}
                />
                <ActionIconButton
                  label={`Archive ${row.fullName || row.employeeId || "employee"}`}
                  icon={faBoxArchive}
                  tone="archive"
                  onClick={() => handleArchiveEmployee(row)}
                />
              </>
            )}
          </div>
        );
      },
    },
  ];

  const openEmployeeViewer = (employee) => {
    setViewingEmployee(employee);
    setEmployeeViewOpen(true);
  };

  const closeEmployeeViewer = () => {
    setEmployeeViewOpen(false);
    setViewingEmployee(null);
  };

  const openEmployeeRecordEditor = (employee) => {
    setEditingEmployee(employee);
    setEmployeeModalOpen(true);
  };

  const handleExportEmployees = () => {
    const fileDate = new Date().toISOString().slice(0, 10);
    const exportLabel = employeeArchiveView === "archive" ? "archived-employees" : "employees";
    const rows = [
      ["Employee ID", "Full Name", "Email", "Phone", "Division", "Position", "Designation", "Role", "Status", "Date Hired", "Salary Rate", "Basic Salary"],
      ...filteredEmployees.map((employee) => {
        const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
        const statusLabel = getEmployeeCardStatus(employee, linkedUser, employeeArchiveView);

        return [
          employee.employeeId || "",
          employee.fullName || "",
          employee.email || "",
          employee.phone || "",
          employee.department || "",
          employee.position || "",
          employee.designation || "",
          getRoleLabel(allUserByEmail.get(String(employee.email || "").trim().toLowerCase())?.role),
          statusLabel,
          formatDateValue(employee.dateHired),
          employee.salaryRate || "",
          formatCurrencyValue(employee.basicSalary),
        ];
      }),
    ];

    downloadCsv(`${exportLabel}-${fileDate}.csv`, rows);
  };

  const handleArchiveEmployee = async (employee) => {
    const employeeName = employee.fullName || employee.employeeId || "this employee";
    const confirmation = await Swal.fire({
      title: "Archive employee?",
      text: `Move ${employeeName} to the employee archive?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, archive",
      cancelButtonText: "Keep employee",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      Swal.fire({
        title: "Archiving...",
        text: "Please wait while the employee is archived.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await deleteEmployee(employee.id);
      setEmployees((current) => current.filter((item) => item.id !== employee.id));
      setArchivedEmployees((current) => (
        current.some((item) => item.id === employee.id) ? current : [employee, ...current]
      ));
      setEmployeeError("");
      closeEmployeeViewer();
      await Swal.fire({
        title: "Archived",
        text: result.message || "Employee archived successfully.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to archive employee.";
      setEmployeeError(message);
      await Swal.fire({
        title: "Archive failed",
        text: message,
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  const handleRestoreEmployee = async (employee) => {
    const employeeName = employee.fullName || employee.employeeId || "this employee";
    const confirmation = await Swal.fire({
      title: "Restore employee?",
      text: `Move ${employeeName} back to the employees table?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes, restore",
      cancelButtonText: "Keep archived",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      Swal.fire({
        title: "Restoring...",
        text: "Please wait while the employee is restored.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await restoreEmployee(employee.id);
      const restoredEmployee = result.employee || employee;
      setArchivedEmployees((current) => current.filter((item) => item.id !== employee.id));
      setEmployees((current) => (
        current.some((item) => item.id === restoredEmployee.id)
          ? current
          : [restoredEmployee, ...current]
      ));
      setEmployeeError("");
      closeEmployeeViewer();
      await Swal.fire({
        title: "Restored",
        text: result.message || "Employee restored successfully.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to restore employee.";
      setEmployeeError(message);
      await Swal.fire({
        title: "Restore failed",
        text: message,
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  const refreshEmployeeRecords = async () => {
    const [employeesResult, archivedEmployeesResult, usersResult] = await Promise.all([
      getEmployees(),
      getArchivedEmployees(),
      getUsers(),
    ]);

    setEmployees(employeesResult.employees || []);
    setArchivedEmployees(archivedEmployeesResult.employees || []);
    setUsers(usersResult.users || []);
  };

  const importEmployeeFile = async (file) => {
    if (!file) {
      toast.error("Choose a CSV or Excel workbook to import.");
      return;
    }

    setEmployeeImporting(true);
    setEmployeeError("");
    const toastId = toast.loading("Importing employee records...", { duration: Infinity });

    try {
      const result = await importEmployeesCsv(file);
      let refreshWarning = "";
      try {
        await refreshEmployeeRecords();
      } catch (refreshError) {
        refreshWarning =
          refreshError.response?.data?.message
          || refreshError.message
          || "Employee records were imported, but the list could not refresh automatically.";
        setEmployeeError(refreshWarning);
      }
      const createdCount = Number(result.summary?.created ?? result.imported ?? 0);
      const activationQueued = Number(result.summary?.activationEmailsQueued ?? result.activationEmails?.queued ?? 0);
      const activationSent = Number(result.summary?.activationEmailsSent ?? result.activationEmails?.sent ?? 0);
      const activationFailed = Number(result.summary?.activationEmailsFailed ?? result.activationEmails?.failed ?? 0);
      toast.dismiss(toastId);
      if (createdCount > 0) {
        if (activationFailed > 0) {
          setEmployeeError(
            `${activationFailed} activation email${activationFailed === 1 ? "" : "s"} could not be sent. Reissue those credentials from the employee record.`,
          );
        }
        await Swal.fire({
          title: "Import Successful!",
          text: activationFailed > 0
            ? `The employee file has been imported. ${activationSent} activation email${activationSent === 1 ? "" : "s"} sent, ${activationFailed} failed — reissue those credentials from the employee record.`
            : activationQueued > 0
              ? `The employee file has been imported successfully. ${activationQueued} activation email${activationQueued === 1 ? " is" : "s are"} queued for background delivery.`
              : `The employee file has been imported successfully. ${activationSent} activation email${activationSent === 1 ? "" : "s"} sent.`,
          icon: activationFailed > 0 ? "warning" : "success",
          confirmButtonText: "Done",
          confirmButtonColor: "#0f766e",
        });
      } else {
        const message = result.errors?.[0] || result.message || "No employees were imported. Review the CSV rows and try again.";
        setEmployeeError(message);
        await Swal.fire({
          title: "Import Failed",
          text: "The employee file could not be imported. Please check the file format and try again.",
          icon: "error",
          confirmButtonText: "Done",
          confirmButtonColor: "#dc2626",
        });
      }
    } catch (error) {
      const message = error.code === "ECONNABORTED"
        ? "The import is taking longer than expected. Check the employee list in a moment before importing the same file again."
        : error.response?.data?.message || "Unable to import employee records.";
      setEmployeeError(message);
      toast.dismiss(toastId);
      await Swal.fire({
        title: "Import Failed",
        text: "The employee file could not be imported. Please check the file format and try again.",
        icon: "error",
        confirmButtonText: "Done",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setEmployeeImporting(false);
    }
  };

  const handleEmployeeImportFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (!file) {
      return;
    }

    const isEmployeeImportFile = /\.(csv|xlsx)$/i.test(file.name)
      || [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ].includes(file.type);
    if (!isEmployeeImportFile) {
      toast.error("Choose a CSV or XLSX employee file.");
      return;
    }

    importEmployeeFile(file);
  };

  const handleOpenImportEmployees = () => {
    employeeImportInputRef.current?.click();
  };

  const handleDownloadEmployeeTemplate = () => {
    const link = document.createElement("a");
    link.href = `${process.env.PUBLIC_URL || ""}/templates/HRIS-employees.xlsx`;
    link.download = "HRIS-employees.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const renderUsersCard = ({
    className = "",
    title = "Users",
    scrollableTable = false,
    description = "Create and manage role-based workforce accounts for chiefs, planning officers, cashiers, employees, regional directors, HR heads, and HR staff.",
    onAddUser = null,
    showEmailVerification = true,
  } = {}) => (
    <Card
      className={`${scrollableTable ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""} ${className}`.trim()}
    >
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>{userArchiveView === "archive" ? "Archived Users" : title}</CardTitle>
          <CardDescription>
            {userArchiveView === "archive"
              ? "Review archived user accounts and restore them when needed."
              : description}
          </CardDescription>
          {userError ? (
            <p className="m-0 mt-2 text-sm font-semibold text-rose-700">{userError}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={userArchiveView === "archive" ? Users : Archive}
            onClick={() => {
              setUserArchiveView((view) => (view === "archive" ? "active" : "archive"));
              setUserPage(1);
              setUserRoleFilter("");
              setUserStatusFilter("");
            }}
          >
            {userArchiveView === "archive" ? "Back to Users" : "Archive"}
          </Button>
          {userArchiveView === "active" ? (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                if (onAddUser) {
                  onAddUser();
                  return;
                }

                setEditingUser(null);
                setUserError("");
                setUserModalOpen(true);
              }}
            >
              Add User
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className={`${scrollableTable ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}`.trim()}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <InputField
            label="Search Employee"
            name="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setUserPage(1);
            }}
            placeholder="Search users"
            icon={Search}
            aria-label="Search users"
            className="w-full sm:w-[300px]"
          />
          <div className="w-full sm:w-[220px]">
            <label htmlFor="userRoleFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Role
            </label>
            <select
              id="userRoleFilter"
              value={userRoleFilter}
              onChange={(event) => {
                setUserRoleFilter(event.target.value);
                setUserPage(1);
              }}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
            >
              <option value="">All roles</option>
              {userRoleFilterOptions.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </div>
          {userArchiveView === "active" ? (
            <div className="w-full sm:w-[240px]">
              <label htmlFor="userStatusFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Status
              </label>
              <select
                id="userStatusFilter"
                value={userStatusFilter}
                onChange={(event) => {
                  setUserStatusFilter(event.target.value);
                  setUserPage(1);
                }}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
              >
                <option value="">All</option>
                {userStatusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="w-full sm:w-[180px]">
            <label htmlFor="userRowsPerPage" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Rows Per Page
            </label>
            <select
              id="userRowsPerPage"
              value={userRowsPerPage}
              onChange={(event) => {
                setUserRowsPerPage(Number(event.target.value) || DEFAULT_USER_ROWS_PER_PAGE);
                setUserPage(1);
              }}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
            >
              {[10, 20, 50, 100, 200].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
        {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
        <div
          className={`${scrollableTable ? "min-h-0 flex-1" : ""} lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200`.trim()}
        >
          <Table
            columns={showEmailVerification
              ? userColumns
              : userColumns.filter((column) => column.key !== "emailVerification")}
            data={paginatedUsers}
            emptyMessage={userArchiveView === "archive" ? "No archived users found." : "No matching users found."}
            className={scrollableTable ? "h-full overflow-y-auto" : ""}
            stickyHeader={scrollableTable}
            cardsClassName="lg:hidden"
            tableWrapperClassName="hidden lg:block"
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Showing {filteredUsers.length === 0 ? 0 : (safeUserPage - 1) * userRowsPerPage + 1}
            -{Math.min(safeUserPage * userRowsPerPage, filteredUsers.length)} of {filteredUsers.length}
          </p>
          <Pagination currentPage={safeUserPage} totalPages={totalUserPages} onPageChange={setUserPage} />
        </div>
      </CardContent>
    </Card>
  );

  const renderLeaveCard = () => (
    <LeaveDashboard
      user={user}
      employees={employees}
      divisions={employeeOptions.divisions}
      leaveRequestLayout="management"
      activeView={activeLeaveView}
      showRequestTabs={false}
    />
  );

  const renderSalaryManagementCard = () => {
    const activeView = salaryManagementViews.find((item) => item.key === activeSalaryManagementView) || salaryManagementViews[0];

    return (
      <Card className="w-full">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Salary Management</CardTitle>
            <CardDescription>{activeView.description}</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="salaryManagementView" className="sr-only">
              Salary management view
            </label>
            <select
              id="salaryManagementView"
              value={activeSalaryManagementView}
              onChange={(event) => {
                const nextView = salaryManagementViews.find((item) => item.key === event.target.value);
                if (!nextView) {
                  return;
                }

                setSelectedSalaryManagementView(nextView.key);
                if (onNavigate) {
                  onNavigate(nextView.path);
                  return;
                }

                window.history.pushState({}, "", nextView.path);
                setActiveModule("salaryManagement");
              }}
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              {salaryManagementViews.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-700">
              <FileText size={20} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="m-0 text-sm font-semibold text-slate-500">Active Employees</p>
              <strong className="mt-2 block text-lg font-semibold text-slate-900">
                {numberFormat.format(employees.length)}
              </strong>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="m-0 text-sm font-semibold text-slate-500">Current View</p>
              <strong className="mt-2 block text-lg font-semibold text-slate-900">{activeView.label}</strong>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="m-0 text-sm font-semibold text-slate-500">Source</p>
              <strong className="mt-2 block text-lg font-semibold text-slate-900">Employee Masterfile</strong>
            </div>
          </section>

          {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
          <div className="lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
            <Table
              columns={activeView.columns}
              data={employees}
              rowKey="id"
              emptyMessage={activeView.emptyMessage}
              tableClassName="min-w-[1180px]"
              cardsClassName="lg:hidden"
              tableWrapperClassName="hidden lg:block"
            />
          </div>
        </CardContent>
      </Card>
    );
  };

  const handleSaveEmployee = async (employeeData) => {
    setEmployeeSaving(true);
    setEmployeeError("");
    const {
      profileImageDataUrl = "",
      removeProfileImage = false,
      ...employeePayload
    } = employeeData;
    const isEditingEmployee = Boolean(editingEmployee);

    try {
      const savePayload = {
        ...employeePayload,
        sendActivationEmail: !isEditingEmployee,
      };
      const result = isEditingEmployee
        ? await updateEmployee(editingEmployee.id, savePayload)
        : await createEmployee(savePayload);
      let savedEmployee = result.employee;
      let profileImageWarning = "";
      const emailNotification = result.emailNotification || "";
      const emailMessage = result.emailMessage || "";
      const linkedUser = result.linkedUser || null;

      if (savedEmployee?.id && (profileImageDataUrl || removeProfileImage)) {
        try {
          const imageResult = await updateEmployeeProfileImage(savedEmployee.id, profileImageDataUrl);
          savedEmployee = imageResult.employee || savedEmployee;
        } catch (imageError) {
          profileImageWarning =
            imageError.response?.data?.message
            || imageError.message
            || "Unable to save the profile image.";
        }
      }

      if (linkedUser?.id) {
        setUsers((current) => {
          const linkedEmailKey = String(linkedUser.email || "").trim().toLowerCase();
          const previousEmailKey = String(editingEmployee?.email || "").trim().toLowerCase();
          const exists = current.some((item) => {
            const userEmailKey = String(item.email || "").trim().toLowerCase();
            return item.id === linkedUser.id
              || (linkedEmailKey && userEmailKey === linkedEmailKey)
              || (previousEmailKey && userEmailKey === previousEmailKey);
          });

          if (!exists) {
            return [linkedUser, ...current];
          }

          return current.map((item) => {
            const userEmailKey = String(item.email || "").trim().toLowerCase();
            const shouldReplace = item.id === linkedUser.id
              || (linkedEmailKey && userEmailKey === linkedEmailKey)
              || (previousEmailKey && userEmailKey === previousEmailKey);

            return shouldReplace ? linkedUser : item;
          });
        });
      }

      setEmployees((current) => {
        if (isEditingEmployee) {
          return current.map((employee) =>
            employee.id === savedEmployee.id ? savedEmployee : employee
          );
        }

        return [savedEmployee, ...current];
      });

      setEmployeeModalOpen(false);
      setEditingEmployee(null);

      const emailWarning = emailNotification === "warning"
        ? (emailMessage || "Activation email could not be sent.")
        : "";
      const saveWarnings = [profileImageWarning, emailWarning].filter(Boolean);

      if (saveWarnings.length > 0) {
        const message = `Employee saved, but ${saveWarnings.join(" ")}`;
        setEmployeeError(message);
        toast.error(message);
      } else {
        toast.success(
          [
            isEditingEmployee ? "Employee edited successfully." : "Employee created successfully.",
            !isEditingEmployee && emailNotification === "sent"
              ? (emailMessage || "Activation email sent to the employee.")
              : "",
          ].filter(Boolean).join(" ")
        );
        setEmployeeError("");
      }

      if (!isEditingEmployee) {
        await showEmployeeCredentialsAlert({
          employee: savedEmployee,
          linkedUser,
          temporaryPassword: result.temporaryPassword,
          emailNotification,
          emailMessage,
        });
      }
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save employee.";
      setEmployeeError(message);
      toast.error(message);
    } finally {
      setEmployeeSaving(false);
    }
  };

  const handleSaveUser = async (userData) => {
    setUserSaving(true);
    setUserError("");
    const isEditingUser = Boolean(editingUser);

    try {
      const result = editingUser
        ? await updateUser(editingUser.id, userData)
        : await createUser(userData);
      const savedUser = result.user;

      setUsers((current) => {
        if (editingUser) {
          return current.map((item) => (item.id === editingUser.id ? savedUser : item));
        }

        return [savedUser, ...current];
      });

      setUserModalOpen(false);
      setEditingUser(null);
      toast.success(isEditingUser ? "User edited successfully." : "User created successfully.");
    } catch (error) {
      setUserError(error.response?.data?.message || "Unable to save user.");
    } finally {
      setUserSaving(false);
    }
  };

  const closeUserModal = () => {
    setUserModalOpen(false);
    setEditingUser(null);
  };

  const openCreateLinkedUser = () => {
    setLinkedUserError("");
    setLinkedUserModalOpen(true);
  };

  const closeLinkedUserModal = () => {
    if (linkedUserSaving) {
      return;
    }

    setLinkedUserModalOpen(false);
    setLinkedUserError("");
  };

  // Division and designation are only asked for HR Staff and Chief (the form decides); every other
  // role has them set later from Employee Management.
  const handleSaveLinkedUser = async ({ fullName, email, roleId, otpCode, divisionId, designationId }) => {
    setLinkedUserSaving(true);
    setLinkedUserError("");

    try {
      const result = await createUser({
        action: "createLinkedEmployeeUser",
        fullName,
        email,
        roleId,
        otpCode,
        divisionId,
        designationId,
        sendActivationEmail: true,
      });
      const savedEmployee = result.employee;
      const linkedUser = result.linkedUser || result.user;

      const isAdmin = normalizeRole(linkedUser?.role) === "admin";
      if ((!isAdmin && !savedEmployee?.id) || !linkedUser?.id) {
        throw new Error("The linked employee and user records could not be created.");
      }

      if (savedEmployee?.id) {
        setEmployees((current) => [savedEmployee, ...current]);
      }
      setUsers((current) => (
        current.some((item) => item.id === linkedUser.id)
          ? current.map((item) => (item.id === linkedUser.id ? linkedUser : item))
          : [linkedUser, ...current]
      ));
      setLinkedUserModalOpen(false);
      toast.success(isAdmin ? "Admin account created successfully." : "User account created and linked to the employee.");

      await showEmployeeCredentialsAlert({
        employee: savedEmployee,
        linkedUser,
        temporaryPassword: result.temporaryPassword,
        emailNotification: result.emailNotification,
        emailMessage: result.emailMessage,
      });
    } catch (error) {
      setLinkedUserError(
        error.response?.data?.message
        || error.message
        || "Unable to create the user account."
      );
    } finally {
      setLinkedUserSaving(false);
    }
  };

  const openCreateEmployee = () => {
    setEditingEmployee(null);
    setEmployeeModalOpen(true);
  };

  const closeEmployeeModal = () => {
    setEmployeeModalOpen(false);
    setEditingEmployee(null);
  };

  const selectModule = useCallback((module) => {
    const resolvedModule = module === "payroll" ? "payrollGenerate" : module;
    const nextPath = modulePaths[resolvedModule] || modulePaths.dashboard;
    const nextModule = moduleFromPath(nextPath);
    setActiveModule(nextModule);

    if (nextModule === "users") {
      setUserPage(1);
    }

    if (nextModule === "employees") {
      resetEmployeeTable();
    }

    if (onNavigate) {
      onNavigate(nextPath);
      return;
    }

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
  }, [onNavigate, resetEmployeeTable]);

  const openRbacPermissions = useCallback((roleKey) => {
    setRbacRoleKey(roleKey);
    selectModule("rbac");
  }, [selectModule]);

  const openDashboardEmployeeProfile = (employee) => {
    if (!employee) {
      return;
    }

    const fullEmployee = employees.find((item) => (
      Number(item.id) === Number(employee.employeeRecordId || employee.id)
      || String(item.employeeId || "") === String(employee.employeeId || "")
    )) || employee;

    selectModule("employees");
    setViewingEmployee(fullEmployee);
    setEmployeeViewOpen(true);
  };

  const navigateFromBreadcrumb = (path) => {
    if (onNavigate) {
      onNavigate(path);
      return;
    }

    window.history.pushState({}, "", path);
    setActiveModule(moduleFromPath(path));
  };

  return (
    // Transparent so the page gradient on <html> shows through; dark mode paints over it there.
    <div className="app-workspace min-h-screen bg-transparent">
      <Header
        user={user}
        onOpenProfile={() => userCanAccessModule(user, "profile") ? setAccountCardOpen(true) : onNavigate?.(profilePath)}
        onOpenSettings={() => selectModule("settings")}
        onLogout={onLogout}
        onNavigate={onNavigate}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setMobileSidebarOpen(true)}
      />
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 border-0 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <Sidebar
        user={user}
        onLogout={onLogout}
        activeModule={activeModule}
        activePath={currentPath}
        onNavigate={onNavigate}
        onSelectModule={selectModule}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        variant="crimson"
      />

      <main className={`${sidebarCollapsed ? "lg:ml-16" : "lg:ml-72"} pt-14 transition-all duration-300 ${isTableWorkspaceView ? "lg:overflow-hidden" : ""}`.trim()}>
        <div
          className={`${
            isTableWorkspaceView ? "flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-4 sm:p-4 lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:overflow-hidden" : "space-y-4 p-4 sm:p-4"
          }`.trim()}
        >
          <Breadcrumbs
            items={breadcrumbs}
            onNavigate={navigateFromBreadcrumb}
            className="w-full shrink-0"
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={contentAnimationKey}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className={isTableWorkspaceView ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "w-full"}
            >
              {permissionDenied ? (
                <AccessDeniedInline
                  message="You don't have permission to view this page."
                  onNavigateBack={userCanAccessModule(user, "dashboard") ? () => selectModule("dashboard") : undefined}
                />
              ) : isProfileView ? (
                <ProfilePage user={user} onUserChange={onUserChange} />
              ) : (
                <>
              {activeModule === "dashboard" ? (
                <div className="space-y-4">
                  <AdminAnalyticsOverview
                    user={user}
                    employees={employees}
                    users={managedUsers}
                    divisions={employeeOptions.divisions}
                    loading={dashboardLoading}
                    onLoadDetails={() => setDashboardDetailsRequested(true)}
                    onAddEmployee={openCreateEmployee}
                    onSelectModule={selectModule}
                    showWelcomeAssignmentCards={false}
                  />
                </div>
              ) : null}

              {activeModule === "users" ? (
                renderUsersCard({
                  className: "w-full",
                  title: "User Management",
                  description: "Create a user and link it to an Employee Management record using the automatically generated employee ID, full name, email, and role.",
                  onAddUser: openCreateLinkedUser,
                  showEmailVerification: false,
                  scrollableTable: false,
                })
              ) : null}

              {activeModule === "messages" ? (
                <BubbleChat user={user} />
              ) : null}

              {activeModule === "notifications" ? (
                <NotificationCenter user={user} onNavigate={onNavigate} />
              ) : null}

              {activeModule === "employees" ? (
                <Card className="w-full">
                  <CardHeader className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div>
                        <CardTitle className="text-lg">
                          {employeeArchiveView === "archive" ? "Archived Employees" : "Employees"}
                        </CardTitle>
                        <CardDescription>
                          {employeeArchiveView === "archive"
                            ? "Review employee records that have been moved to archive."
                            : "Manage employee records, accounts, and workforce information."}
                        </CardDescription>
                      </div>
                      <p className="m-0 text-sm text-slate-500">
                        {employeeArchiveView === "archive"
                          ? `${numberFormat.format(archivedEmployees.length)} archived employee${archivedEmployees.length === 1 ? "" : "s"}`
                          : `${numberFormat.format(activeEmployeeCount)} active employee${activeEmployeeCount === 1 ? "" : "s"} • ${numberFormat.format(inactiveEmployeeCount)} inactive`}
                      </p>
                      {employeeError ? (
                        <p className="m-0 text-sm font-semibold text-rose-700">{employeeError}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="secondary"
                        icon={FileText}
                        onClick={handleDownloadEmployeeTemplate}
                      >
                        Download Template
                      </Button>
                      <Button
                        variant="secondary"
                        icon={Upload}
                        onClick={handleOpenImportEmployees}
                        loading={employeeImporting}
                        disabled={employeeImporting}
                      >
                        Import
                      </Button>
                      <input
                        ref={employeeImportInputRef}
                        type="file"
                        accept=".csv,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="hidden"
                        onChange={handleEmployeeImportFileChange}
                        disabled={employeeImporting}
                      />
                      <Button variant="secondary" icon={Download} onClick={handleExportEmployees}>
                        Export
                      </Button>
                      <Button
                        variant="secondary"
                        icon={employeeArchiveView === "archive" ? Users : Archive}
                        onClick={() => {
                          setEmployeeArchiveView((view) => (view === "archive" ? "active" : "archive"));
                          setEmployeeStatusFilter("");
                          setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                        }}
                      >
                        {employeeArchiveView === "archive" ? "Back to Employees" : "Archive"}
                      </Button>
                      <Button variant="primary" icon={Plus} onClick={openCreateEmployee}>
                        Add Employee
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,220px)_150px_180px_130px_110px]">
                      <InputField
                        label="Search Employees"
                        name="employeeSearch"
                        value={employeeQuery}
                        onChange={(event) => {
                          setEmployeeQuery(event.target.value);
                          setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                        }}
                        placeholder="Search by name, ID, or email"
                        icon={Search}
                        aria-label="Search employees"
                      />
                      <div>
                        <label htmlFor="employeeDivisionFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                          Division
                        </label>
                        <select
                          id="employeeDivisionFilter"
                          value={employeeDivisionFilter}
                          onChange={(event) => {
                            setEmployeeDivisionFilter(event.target.value);
                            setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                          }}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
                        >
                          <option value="">All divisions</option>
                          {employeeDivisionOptions.map((division) => (
                            <option key={division} value={division}>{division}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="employeeDesignationFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                          Position
                        </label>
                        <select
                          id="employeeDesignationFilter"
                          value={employeeDesignationFilter}
                          onChange={(event) => {
                            setEmployeeDesignationFilter(event.target.value);
                            setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                          }}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
                        >
                          <option value="">All positions</option>
                          {employeeDesignationOptions.map((designation) => (
                            <option key={designation} value={designation}>{designation}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="employeeStatusFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                          Status
                        </label>
                        <select
                          id="employeeStatusFilter"
                          value={employeeStatusFilter}
                          onChange={(event) => {
                            setEmployeeStatusFilter(event.target.value);
                            setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                          }}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
                        >
                          <option value="">All statuses</option>
                          {employeeStatusOptions.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="employeeRowsPerPage" className="mb-1.5 block text-sm font-semibold text-slate-700">
                          Rows Per Page
                        </label>
                        <select
                          id="employeeRowsPerPage"
                          value={employeeRowsPerPage}
                          onChange={(event) => {
                            setEmployeeRowsPerPage(Number(event.target.value) || DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
                            setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                          }}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
                        >
                          {[10, 20, 50, 100, 200].map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
                    <div className="lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200">
                      <div className="lg:overflow-x-auto">
                        <Table
                          columns={employeeColumns}
                          data={paginatedEmployees}
                          emptyMessage={
                            employeeArchiveView === "archive"
                              ? "No archived employee records found."
                              : "No employee records found. Try adjusting your search or filters."
                          }
                          tableClassName="min-w-[1100px]"
                          cardsClassName="lg:hidden"
                          tableWrapperClassName="hidden lg:block"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-slate-600">
                        Showing {filteredEmployees.length === 0 ? 0 : (safeEmployeePage - 1) * employeeRowsPerPage + 1}
                        -{Math.min(safeEmployeePage * employeeRowsPerPage, filteredEmployees.length)} of {filteredEmployees.length}
                      </p>
                      <Pagination
                        currentPage={safeEmployeePage}
                        totalPages={totalEmployeePages}
                        onPageChange={setEmployeePage}
                      />
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {activeModule === "calendar" ? (
                <LeaveTravelCalendarWorkspace onViewEmployeeProfile={openDashboardEmployeeProfile} />
              ) : null}

              {activeModule === "serviceRecord" ? (
                <ServiceRecordWorkspace user={user} mode="manage" />
              ) : null}

              {activeModule === "promotions" ? (
                <PromotionWorkspace user={user} />
              ) : null}

              {activeModule === "rewardsNomination" ? (
                <AwardCyclesWorkspace user={user} employees={employees} />
              ) : null}

              {activeModule === "rewardsLoyalty" ? (
                <LoyaltyWorkspace user={user} employees={employees} />
              ) : null}

              {activeModule === "rewardsCertificateTemplate" ? (
                <CertificateTemplateEditor />
              ) : null}

              {activeModule === "salaryManagement" ? renderSalaryManagementCard() : null}

              {activeModule === "performanceIpcr" ? (
                <IpcrManagementWorkspace employees={employees} canAssign={false} />
              ) : null}

              {activeModule === "performanceOpcr" ? (
                <OpcrManagementWorkspace employees={employees} canValidate />
              ) : null}

              {activeModule === "leaveBalances" ? (
                <LeaveBalanceManagementWorkspace user={user} />
              ) : null}

              {activeModule === "leave" ? renderLeaveCard() : null}

              {activeModule === "attendance" ? (
                <AttendanceManagementWorkspace user={user} mode="admin" />
              ) : null}

              {activeModule === "overtime" ? (
                <OvertimeWorkspace
                  user={user}
                  employees={employees}
                  title="Overtime Management"
                  description="File, review, and monitor employee overtime requests."
                  submitLabel="File Overtime Request"
                />
              ) : null}

              {activeModule === "payrollGenerate" ? (
                <PayrollManagementWorkspace employees={employees} view="generate" user={user} onNavigate={onNavigate} />
              ) : null}

              {activeModule === "payrollRecords" ? (
                <PayslipWorkspace />
              ) : null}

              {activeModule === "payrollLoan" ? (
                <FileLoan employees={employees} user={user} />
              ) : null}

              {activeModule === "archivedPayroll" ? (
                <PayrollManagementWorkspace employees={employees} view="archived" user={user} onNavigate={onNavigate} />
              ) : null}




              {["settings", "divisions", "designations", "rbac"].includes(activeModule) ? (
                <DivisionSettings
                  key={activeModule}
                  user={user}
                  workspaceView={activeModule === "settings" ? null : activeModule}
                  initialPermissionRoleKey={rbacRoleKey}
                  onOpenPermissions={openRbacPermissions}
                  onSettingsChange={handleSettingsChange}
                />
              ) : null}

                  {activeModule === "reports" ? (
                    <AdminReports
                      user={user}
                      category={reportCategoryFromPath(currentPath, "/admin/reports", {
                        exclude: ADMIN_HIDDEN_REPORT_CATEGORIES,
                      })}
                    />
                  ) : null}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AdminAccountCard
        open={accountCardOpen && userCanAccessModule(user, "profile")}
        onClose={() => setAccountCardOpen(false)}
        user={user}
        onUserChange={onUserChange}
        employees={employees}
      />

      <Modal
        open={employeeModalOpen && userCanAccessModule(user, "employees")}
        title={editingEmployee ? "Edit Employee" : "Add New Employee"}
        maxWidth="max-w-[1120px]"
        onClose={closeEmployeeModal}
        footer={(
          <>
            <Button
              type="submit"
              form={ADMIN_EMPLOYEE_FORM_ID}
              disabled={employeeSaving}
            >
              {employeeSaving ? "Saving..." : editingEmployee ? "Save Changes" : "Create Employee"}
            </Button>
          </>
        )}
      >
        <CreateEmployee
          formId={ADMIN_EMPLOYEE_FORM_ID}
          initialValues={employeeFormInitialValues}
          options={{
            ...employeeOptions,
            roles: employeeRoleOptions,
          }}
          nextEmployeeId={nextEmployeeId}
          onCancel={closeEmployeeModal}
          onSubmit={handleSaveEmployee}
          submitLabel={employeeSaving ? "Saving..." : editingEmployee ? "Save Changes" : "Create Employee"}
          showActions={false}
          submitting={employeeSaving}
        />
      </Modal>

      <Modal
        open={linkedUserModalOpen && userCanAccessModule(user, "users")}
        title="Add User"
        onClose={closeLinkedUserModal}
      >
        <CreateLinkedUserForm
          nextEmployeeId={nextEmployeeId}
          roles={getManagedRoleOptions(userOptions.roles || [], "admin")}
          divisions={employeeOptions.divisions}
          designations={employeeOptions.designations}
          error={linkedUserError}
          submitting={linkedUserSaving}
          onSubmit={handleSaveLinkedUser}
        />
      </Modal>

      <Modal
        open={employeeViewOpen && userCanAccessModule(user, "employees")}
        title="Employee Details"
        maxWidth="max-w-[880px]"
        onClose={closeEmployeeViewer}
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-3">
            <EmployeeDocumentDownloadButtons
              open={employeeViewOpen && Boolean(viewingEmployee)}
              employee={viewingEmployee}
            />
            {viewingEmployee ? (
              employeeArchiveView === "archive" ? (
                <Button
                  variant="secondary"
                  icon={RotateCcw}
                  onClick={() => handleRestoreEmployee(viewingEmployee)}
                >
                  Restore
                </Button>
              ) : null
            ) : null}
          </div>
        )}
      >
        {viewingEmployee ? (
          <div className="space-y-5">
            <div className="flex justify-center">
              <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-lg font-bold text-slate-500 shadow-sm">
                {resolveBackendAssetUrl(viewingEmployee.profileImage) ? (
                  <img
                    src={resolveBackendAssetUrl(viewingEmployee.profileImage)}
                    alt={viewingEmployee.fullName || "Employee profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{resolveEmployeeInitials(viewingEmployee)}</span>
                )}
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-sm font-semibold text-slate-500">Employee ID</dt><dd className="m-0 text-slate-900">{viewingEmployee.employeeId || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Full Name</dt><dd className="m-0 text-slate-900">{viewingEmployee.fullName || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Email</dt><dd className="m-0 text-slate-900">{viewingEmployee.email || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Phone</dt><dd className="m-0 text-slate-900">{viewingEmployee.phone || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Division</dt><dd className="m-0 text-slate-900">{viewingEmployee.department || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Position</dt><dd className="m-0 text-slate-900">{viewingEmployee.position || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Designation</dt><dd className="m-0 text-slate-900">{viewingEmployee.designation || "None"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Status</dt><dd className="m-0 text-slate-900">{viewingEmployee.status || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Employment Status</dt><dd className="m-0 text-slate-900">{viewingEmployee.employmentStatus || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Date of Birth</dt><dd className="m-0 text-slate-900">{viewingEmployee.dateOfBirth || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Date Hired</dt><dd className="m-0 text-slate-900">{viewingEmployee.dateHired || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Salary Rate</dt><dd className="m-0 text-slate-900">{viewingEmployee.salaryRate || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Basic Salary</dt><dd className="m-0 text-slate-900">{viewingEmployee.basicSalary || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Address</dt><dd className="m-0 text-slate-900">{viewingEmployee.address || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">City</dt><dd className="m-0 text-slate-900">{viewingEmployee.city || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Province</dt><dd className="m-0 text-slate-900">{viewingEmployee.province || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Zip Code</dt><dd className="m-0 text-slate-900">{viewingEmployee.zipCode || "N/A"}</dd></div>
            </dl>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={userViewOpen && userCanAccessModule(user, "users")}
        title="User Details"
        maxWidth="max-w-[680px]"
        onClose={closeUserViewer}
        footer={viewingUser && userArchiveView === "archive" ? (
          <Button variant="secondary" icon={RotateCcw} onClick={() => handleRestoreUser(viewingUser)}>
            Restore
          </Button>
        ) : null}
      >
        {viewingUser ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            {normalizeRole(viewingUser.role) !== "admin" ? <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Employee ID</dt><dd className="m-0 mt-1 font-medium text-slate-900">{viewingUser.employee_id || "Pending"}</dd></div> : null}
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Full Name</dt><dd className="m-0 mt-1 font-medium text-slate-900">{viewingUser.full_name || viewingUser.username || "N/A"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Username</dt><dd className="m-0 mt-1 font-medium text-slate-900">{viewingUser.username || "N/A"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt><dd className="m-0 mt-1 break-all font-medium text-slate-900">{viewingUser.email || "N/A"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</dt><dd className="m-0 mt-1 font-medium text-slate-900">{getRoleLabel(viewingUser.role)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account Status</dt><dd className="m-0 mt-1 font-medium text-slate-900">{userArchiveView === "archive" ? "Archived" : getStatusLabel(viewingUser.status)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Division</dt><dd className="m-0 mt-1 font-medium text-slate-900">{viewingUser.division || "N/A"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Position</dt><dd className="m-0 mt-1 font-medium text-slate-900">{viewingUser.position || "N/A"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Designation</dt><dd className="m-0 mt-1 font-medium text-slate-900">{viewingUser.designation || "None"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</dt><dd className="m-0 mt-1 font-medium text-slate-900">{formatDateValue(viewingUser.createdAt)}</dd></div>
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={userModalOpen && userCanAccessModule(user, "users")}
        title={editingUser ? "Edit User" : "Add User"}
        onClose={closeUserModal}
        /* Editing has no header close button; the dialog still dismisses via Escape or the backdrop. */
        showCloseButton={!editingUser}
      >
        <CreateUserForm
          initialValues={editingUser}
          options={{
            roles: managedRoleOptions,
            statuses: managedStatusOptions,
            security: securitySettings,
          }}
          onSubmit={handleSaveUser}
          submitLabel={userSaving ? "Saving..." : editingUser ? "Save Changes" : "Create User"}
        />
      </Modal>

    </div>
  );
}
