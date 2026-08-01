import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import {
  Archive,
  Building2,
  CalendarDays,
  Download,
  FileText,
  Mail,
  Pencil,
  Plus,
  Phone,
  Search,
  ShieldCheck,
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
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import Breadcrumbs from "../../components/breadcrumbs/breadcrumbs";
import Header from "../../components/navigation/Header";
import Sidebar from "../../components/navigation/Sidebar";
import ProfilePage from "../../components/profile/ProfilePage";
import { requestProfileTab } from "../../components/profile/profileUtils";
import {
  archiveUser,
  createEmployee,
  createUser,
  deleteEmployee,
  getArchivedEmployees,
  getEmployeeOptions,
  getEmployees,
  getSettings,
  getUsers,
  importEmployeesCsv,
  restoreEmployee,
  updateUser,
  updateEmployee,
  updateEmployeeProfileImage,
} from "../../services/api";
import DivisionSettings from "../settings/division";
import {
  createDefaultPermissionTemplates,
  normalizePermissionTemplates,
  normalizeSinglePermissionTemplate,
  permissionItems,
  permissionSections,
} from "../settings/permission";
import LeaveDashboard from "../../module/leave/LeaveDashboard";
import LeaveBalanceManagementWorkspace from "../../module/leave/LeaveBalanceManagementWorkspace";
import AttendanceManagementWorkspace from "../../module/attendance/AttendanceManagementWorkspace";
import OvertimeWorkspace from "../../module/overtime/Overtime";
import PayrollManagementWorkspace from "../../module/payroll/PayrollManagementWorkspace";
import PayslipWorkspace from "../../module/payroll/PayslipWorkspace";
import CashAdvanceWorkspace from "../../module/payroll/CashAdvanceWorkspace";
import LeaveMonetizationWorkspace from "../../module/payroll/LeaveMonetizationWorkspace";
import FileLoan from "../../module/Loan/fileloan";
import ServiceRecordWorkspace from "../../module/serviceRecord/ServiceRecordWorkspace";

import AdminReports from "../../module/reports/AdminReports";
import { reportCategoryFromPath } from "../../module/reports/reportCategories";
import IpcrManagementWorkspace from "../../module/performance/IpcrManagementWorkspace";
import OpcrManagementWorkspace from "../../module/performance/OpcrManagementWorkspace";
import LeaveTravelCalendarWorkspace from "../../module/calendar/LeaveTravelCalendarWorkspace";
import RewardsRecognitionWorkspace from "../../module/rewards/RewardsRecognitionWorkspace";
import NotificationCenter from "../../components/notification/NotificationCenter";
import CreateEmployee from "./create_employee";
import AdminAnalyticsOverview from "../../components/dashboard/AdminAnalyticsOverview";
import BubbleChat from "../../components/bubble_chat/bubble_chat";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import {
  getRoleBadgeClass,
  getProfilePathForRole,
  getManagedRoleOptions,
  getRoleLabel,
  getStatusLabel,
  MANAGED_USER_ROLE_KEYS,
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
const DEFAULT_USER_ROWS_PER_PAGE = 8;
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
  serviceRecord: "/admin/service-record",
  rewardsRecognition: "/admin/rewards-recognition",
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
  payrollCashAdvance: "/admin/payroll/cash-advance",
  payrollLeaveMonetization: "/admin/payroll/leave-monetization",
  archivedPayroll: "/admin/payroll/archived",

  reports: "/admin/reports",
  settings: "/admin/settings",
};

const leaveWorkspaceItems = [
  { key: "leave", label: "Leave", path: modulePaths.leave },
  { key: "travel", label: "Travel Order", path: modulePaths.travel },
  { key: "cto", label: "Compensatory Time Off", path: modulePaths.cto },
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
      { key: "employeeId", header: "Employee ID", render: (row) => row.employeeId || "N/A" },
      { key: "fullName", header: "Employee", render: (row) => row.fullName || "N/A" },
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
      { key: "employeeId", header: "Employee ID", render: (row) => row.employeeId || "N/A" },
      { key: "fullName", header: "Employee", render: (row) => row.fullName || "N/A" },
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
      { key: "employeeId", header: "Employee ID", render: (row) => row.employeeId || "N/A" },
      { key: "fullName", header: "Employee", render: (row) => row.fullName || "N/A" },
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
  users: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Users", path: modulePaths.users }],
  employees: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Employees", path: modulePaths.employees }],
  serviceRecord: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Service Record", path: modulePaths.serviceRecord }],
  rewardsRecognition: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Rewards & Recognition", path: modulePaths.rewardsRecognition }],
  calendar: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Calendar", path: modulePaths.calendar }],
  leaveBalances: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Masterfiles" },
    { label: "Set Balances", path: modulePaths.leaveBalances },
  ],
  performanceOpcr: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Performance Management", path: modulePaths.performanceManagement },
    { label: "OPCR", path: modulePaths.performanceOpcr },
  ],
  performanceIpcr: [
    { label: "Dashboard", path: modulePaths.dashboard },
    { label: "Performance Management", path: modulePaths.performanceManagement },
    { label: "IPCR", path: modulePaths.performanceIpcr },
  ],
  salaryManagement: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Salary Management", path: modulePaths.salaryManagement }],
  attendance: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Attendance", path: modulePaths.attendance }],
  overtime: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Attendance", path: modulePaths.attendance }, { label: "Overtime", path: modulePaths.overtime }],
  leave: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Leave", path: modulePaths.leave }],
  payrollGenerate: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll", path: modulePaths.payroll }, { label: "Create Payroll" }],
  payrollRecords: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll", path: modulePaths.payroll }, { label: "Payslip" }],
  payrollLoan: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll", path: modulePaths.payroll }, { label: "Loan" }],
  payrollCashAdvance: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll", path: modulePaths.payroll }, { label: "Cash Advance" }],
  payrollLeaveMonetization: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll", path: modulePaths.payroll }, { label: "Leave Monetization" }],
  archivedPayroll: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Payroll", path: modulePaths.payroll }, { label: "Archived Payroll" }],

  reports: [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Reports", path: modulePaths.reports }],
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

  if (pathname === modulePaths.serviceRecord) {
    return "serviceRecord";
  }

  if (pathname === modulePaths.rewardsRecognition) {
    return "rewardsRecognition";
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

  if (pathname === "/admin/payroll/cash-advance") {
    return "payrollCashAdvance";
  }

  if (pathname === modulePaths.payrollLeaveMonetization) {
    return "payrollLeaveMonetization";
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
  statusId: "",
  mustChangePassword: true,
};

function UserSelectField({ label, name, value, onChange, error, children, helper }) {
  return (
    <div className="w-full">
      <label htmlFor={name} className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        className={`min-h-[46px] w-full rounded-2xl border bg-white px-3.5 py-3 text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 ${
          error ? "border-rose-600" : "border-slate-200"
        }`}
      >
        {children}
      </select>
      {helper ? <p className="mt-2 text-sm leading-6 text-slate-500">{helper}</p> : null}
      {error ? <p className="mt-1.5 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

/**
 * Module access for a user who has no override of their own: a copy of their role's
 * template. Falls back to the built-in defaults when the backend has not sent one.
 */
function moduleAccessFromRole(roleKey, roleTemplates) {
  const template = roleTemplates?.[roleKey] || createDefaultPermissionTemplates()[roleKey];

  return normalizeSinglePermissionTemplate(template || { enabled: true, modules: {} });
}

function countEnabledModules(template) {
  return Object.values(template?.modules || {}).filter((modulePermission) => modulePermission.enabled).length;
}

function CreateUserForm({
  initialValues = null,
  options,
  onSubmit,
  onCancel,
  submitLabel = "Create User",
}) {
  const [form, setForm] = useState(defaultUserFormValues);
  const [errors, setErrors] = useState({});
  const [moduleAccess, setModuleAccess] = useState(() => normalizeSinglePermissionTemplate({}));
  // Once the admin touches a checkbox we stop re-seeding from the role template, so a
  // deliberate selection is never silently discarded by a later role change.
  const [moduleAccessTouched, setModuleAccessTouched] = useState(false);

  const roles = useMemo(() => options?.roles || [], [options?.roles]);
  const statuses = useMemo(() => options?.statuses || [], [options?.statuses]);
  const roleTemplates = options?.roleTemplates;
  const userOverrides = options?.userOverrides;
  const maximumPasswordLength = Number(options?.security?.maximumPasswordLength) || 64;
  const isEditing = Boolean(initialValues?.id);

  const selectedRoleKey = useMemo(
    () => roles.find((role) => String(role.id) === String(form.roleId))?.key || "",
    [form.roleId, roles]
  );

  useEffect(() => {
    setForm({
      email: initialValues?.email || "",
      username: initialValues?.username || "",
      password: "",
      roleId: initialValues?.roleId ? String(initialValues.roleId) : "",
      statusId: initialValues?.statusId ? String(initialValues.statusId) : "",
      mustChangePassword: initialValues?.mustChangePassword ?? true,
    });
    setErrors({});
    setModuleAccessTouched(false);
  }, [initialValues]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      roleId: current.roleId || String(roles[0]?.id || ""),
      statusId: current.statusId || String(statuses[0]?.id || ""),
    }));
  }, [roles, statuses]);

  // Seed the checkboxes: an existing user's own access if they have an override,
  // otherwise the template of whichever role is currently selected.
  useEffect(() => {
    if (moduleAccessTouched) {
      return;
    }

    const existingOverride = initialValues?.id
      ? (userOverrides?.[String(initialValues.id)] ?? userOverrides?.[initialValues.id])
      : null;

    setModuleAccess(
      existingOverride
        ? normalizeSinglePermissionTemplate(existingOverride)
        : moduleAccessFromRole(selectedRoleKey, roleTemplates)
    );
  }, [initialValues?.id, moduleAccessTouched, roleTemplates, selectedRoleKey, userOverrides]);

  const toggleModuleAccess = (moduleKey, defaultActions) => {
    setModuleAccessTouched(true);
    setModuleAccess((current) => {
      const modulePermission = current.modules?.[moduleKey] || { enabled: false, actions: [] };
      const nextEnabled = !modulePermission.enabled;

      return {
        ...current,
        modules: {
          ...current.modules,
          // Checking a module grants its standard actions; per-action tuning stays in
          // Settings > Permissions.
          [moduleKey]: {
            enabled: nextEnabled,
            actions: nextEnabled
              ? (modulePermission.actions?.length ? modulePermission.actions : defaultActions)
              : [],
          },
        },
      };
    });
  };

  const setAllModules = (enabled) => {
    setModuleAccessTouched(true);
    setModuleAccess((current) => ({
      ...current,
      modules: permissionItems.reduce((modules, item) => {
        modules[item.key] = {
          enabled,
          actions: enabled ? (current.modules?.[item.key]?.actions?.length
            ? current.modules[item.key].actions
            : item.defaultActions) : [],
        };

        return modules;
      }, {}),
    }));
  };

  const resetModulesToRole = () => {
    setModuleAccessTouched(false);
    setModuleAccess(moduleAccessFromRole(selectedRoleKey, roleTemplates));
  };

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
    if (!form.statusId) nextErrors.statusId = "Status is required.";

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
      statusId: form.statusId,
      mustChangePassword: form.mustChangePassword,
      // The backend drops this when it matches the role template, so a user left on the
      // defaults keeps inheriting future changes to their role.
      permissions: moduleAccess,
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
  const enabledModuleCount = countEnabledModules(moduleAccess);
  const selectedRoleLabel = roles.find((role) => String(role.id) === String(form.roleId))?.label || "role";

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

      <InputField
        label={isEditing ? "Password" : "Password *"}
        name="password"
        type="password"
        value={form.password}
        onChange={updateField("password")}
        placeholder={isEditing ? "Enter new password" : "Enter temporary password"}
        error={errors.password}
        maxLength={maximumPasswordLength}
      />

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

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-950">
              <ShieldCheck size={16} className="text-slate-500" />
              Module Access
            </p>
            <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
              {moduleAccessTouched
                ? `${enabledModuleCount} of ${permissionItems.length} modules selected · custom access`
                : `${enabledModuleCount} of ${permissionItems.length} modules from the ${selectedRoleLabel} default`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAllModules(true)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setAllModules(false)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={resetModulesToRole}
              disabled={!moduleAccessTouched}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use role default
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4">
          {permissionSections.map((section) => (
            <div key={section.title}>
              <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                {section.title}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {section.items.map((item) => {
                  const checked = Boolean(moduleAccess.modules?.[item.key]?.enabled);

                  return (
                    <label
                      key={item.key}
                      title={item.description}
                      className={[
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition",
                        checked
                          ? "border-slate-300 bg-white shadow-sm"
                          : "border-transparent bg-white/50 hover:border-slate-200",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleModuleAccess(item.key, item.defaultActions)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-900 focus:ring-slate-900"
                      />
                      <span className="min-w-0 text-xs font-semibold leading-5 text-slate-800">
                        {item.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

function buildNextEmployeeId(employees) {
  const year = new Date().getFullYear();
  const prefix = `EMP${year}-`;
  const maxNumber = employees.reduce((max, employee) => {
    const employeeId = String(employee.employeeId || "");

    if (!employeeId.startsWith(prefix)) {
      return max;
    }

    const numericPart = Number.parseInt(employeeId.slice(prefix.length), 10);
    return Number.isNaN(numericPart) ? max : Math.max(max, numericPart);
  }, 0);

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

const employeeIdCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareEmployeesByEmployeeId(firstEmployee, secondEmployee) {
  const firstEmployeeId = String(firstEmployee?.employeeId || "").trim();
  const secondEmployeeId = String(secondEmployee?.employeeId || "").trim();

  if (firstEmployeeId && secondEmployeeId) {
    return employeeIdCollator.compare(firstEmployeeId, secondEmployeeId);
  }

  if (firstEmployeeId) {
    return -1;
  }

  if (secondEmployeeId) {
    return 1;
  }

  return Number(firstEmployee?.id || 0) - Number(secondEmployee?.id || 0);
}

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

function employeeAccentClass(status) {
  switch (normalizeStatus(status)) {
    case "active":
      return "from-emerald-300 via-emerald-400 to-teal-400";
    case "inactive":
      return "from-amber-300 via-amber-400 to-orange-400";
    case "archived":
      return "from-slate-200 via-slate-300 to-slate-400";
    default:
      return "from-rose-300 via-rose-400 to-red-500";
  }
}

function EmployeeMetaRow({ icon: Icon, label, value, valueClassName = "text-slate-700" }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <Icon size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <p className={`m-0 truncate text-sm font-medium ${valueClassName}`}>{value || "N/A"}</p>
      </div>
    </div>
  );
}

function AdminEmployeeCard({
  employee,
  linkedUser = null,
  archiveView = "active",
  onView,
  onEdit,
  onRestore,
  onToggleStatus,
  statusSavingId = null,
}) {
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);
  const statusLabel = getEmployeeCardStatus(employee, linkedUser, archiveView);
  const roleLabel = linkedUser?.role ? getRoleLabel(linkedUser.role) : "Employee";
  const accentClass = employeeAccentClass(statusLabel);
  const isArchived = archiveView === "archive";
  const normalizedStatus = normalizeStatus(statusLabel);
  const isStatusSaving = Boolean(
    linkedUser
    && statusSavingId !== null
    && String(statusSavingId) === String(linkedUser.id)
  );
  const canToggleStatus = !isArchived && Boolean(linkedUser) && ["active", "inactive"].includes(normalizedStatus);

  return (
    <article className={`group relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl ${isArchived ? "bg-slate-50/70" : ""}`.trim()}>
      <div className={`absolute inset-x-0 bottom-0 h-1.5 bg-gradient-to-r ${accentClass}`} />

      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        {canToggleStatus ? (
          <button
            type="button"
            aria-label={normalizedStatus === "active" ? `Set ${employee.fullName || "employee"} inactive` : `Set ${employee.fullName || "employee"} active`}
            title={normalizedStatus === "active" ? "Click to set inactive" : "Click to set active"}
            disabled={isStatusSaving}
            onClick={() => onToggleStatus?.(employee)}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70 ${
              normalizedStatus === "active"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 focus:ring-emerald-100"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 focus:ring-amber-100"
            }`}
          >
            {isStatusSaving ? "Saving..." : statusLabel}
          </button>
        ) : (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${employeeStatusBadgeClass(statusLabel)}`}>
            {statusLabel}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {employee.employeeId || "N/A"}
        </span>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
        <div className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-2xl font-bold text-slate-500 ring-4 ring-white">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={employee.fullName || "Employee profile"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{resolveEmployeeInitials(employee)}</span>
          )}
        </div>

        <div className="mt-4 text-center">
          <h3 className="m-0 truncate text-base font-semibold text-slate-950">
            {employee.fullName || "Employee"}
          </h3>
          <p className="m-0 mt-1 truncate text-sm text-slate-500">
            {employee.position || "N/A"}
          </p>
        </div>

        <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <EmployeeMetaRow icon={Building2} label="Division" value={employee.department || "N/A"} />
            <EmployeeMetaRow
              icon={UserRound}
              label="Role"
              value={roleLabel}
              valueClassName={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${getRoleBadgeClass(roleLabel)}`}
            />
            <EmployeeMetaRow icon={Mail} label="Email" value={employee.email || "N/A"} />
            <EmployeeMetaRow icon={Phone} label="Phone" value={employee.phone || "N/A"} />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} aria-hidden="true" />
            Date Hired {formatDateValue(employee.dateHired)}
          </span>
          <strong className="text-sm font-semibold text-slate-800">
            {formatCurrencyValue(employee.basicSalary)}
          </strong>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <ActionIconButton
            label={`View ${employee.fullName || employee.employeeId || "employee"}`}
            icon={faEyeAction}
            tone="view"
            onClick={() => onView(employee)}
          />
          {isArchived ? (
            <ActionIconButton
              label={`Restore ${employee.fullName || employee.employeeId || "employee"}`}
              icon={faClockRotateLeft}
              tone="approve"
              onClick={() => onRestore(employee)}
            />
          ) : (
            <ActionIconButton
              label={`Edit ${employee.fullName || employee.employeeId || "employee"}`}
              icon={faPen}
              tone="edit"
              onClick={() => onEdit(employee)}
            />
          )}
        </div>
      </div>
    </article>
  );
}

export default function AdminDashboard({ user, onLogout, currentPath = "/admin/dashboard", onNavigate, onUserChange }) {
  const [activeModule, setActiveModule] = useState(() => moduleFromPath(currentPath));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeViewOpen, setEmployeeViewOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const [employeeRowsPerPage, setEmployeeRowsPerPage] = useState(DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
  const [employeeOptions, setEmployeeOptions] = useState({ divisions: [], designations: [] });
  const [securitySettings, setSecuritySettings] = useState(DEFAULT_SECURITY_SETTINGS);
  // Role templates seed the module checkboxes in the Add User form; the override map
  // tells us which users already have access of their own.
  const [permissionTemplates, setPermissionTemplates] = useState(() => createDefaultPermissionTemplates());
  const [userPermissionOverrides, setUserPermissionOverrides] = useState({});
  const [employeeError, setEmployeeError] = useState("");
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [userOptions, setUserOptions] = useState({ roles: [], statuses: [] });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userError, setUserError] = useState("");
  const [userSaving, setUserSaving] = useState(false);
  const [userStatusSavingId, setUserStatusSavingId] = useState(null);
  const [userStatusFilter, setUserStatusFilter] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userRowsPerPage, setUserRowsPerPage] = useState(DEFAULT_USER_ROWS_PER_PAGE);
  const [employeeDivisionFilter, setEmployeeDivisionFilter] = useState("");
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
  const isUsersWorkspaceView = !isProfileView && activeModule === "users";
  const isMessagesWorkspaceView = !isProfileView && activeModule === "messages";
  const isNotificationsWorkspaceView = !isProfileView && activeModule === "notifications";
  const isTableWorkspaceView = isUsersWorkspaceView || isMessagesWorkspaceView || isNotificationsWorkspaceView;
  const activeLeaveView = leaveViewFromPath(currentPath);
  const activeLeaveItem = leaveWorkspaceItems.find((item) => item.key === activeLeaveView) || leaveWorkspaceItems[0];
  const activeSalaryManagementView = salaryManagementViewFromPath(currentPath) || selectedSalaryManagementView;
  const activeSalaryManagementItem = salaryManagementViews.find((item) => item.key === activeSalaryManagementView) || salaryManagementViews[0];
  const breadcrumbs = isProfileView
    ? [{ label: "Dashboard", path: modulePaths.dashboard }, { label: "Profile" }]
    : activeModule === "leave"
      ? [
          { label: "Dashboard", path: modulePaths.dashboard },
          ...(activeLeaveView === "leave"
            ? [{ label: "Leave", path: modulePaths.leave }]
            : [
                { label: "Leave", path: modulePaths.leave },
                { label: activeLeaveItem.label, path: activeLeaveItem.path },
              ]),
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

  useEffect(() => {
    const nextModule = moduleFromPath(currentPath);
    setActiveModule(nextModule);

    if (nextModule === "users") {
      setUserPage(1);
    }
  }, [currentPath]);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (mounted) {
        setDashboardLoading(true);
      }

      try {
        const [employeesResult, archivedEmployeesResult, optionsResult, usersResult, settingsResult] = await Promise.allSettled([
          getEmployees(),
          getArchivedEmployees(),
          getEmployeeOptions(),
          getUsers(),
          getSettings(),
        ]);

        if (!mounted) {
          return;
        }

        const nextEmployees = employeesResult.status === "fulfilled" ? employeesResult.value : {};
        const nextArchivedEmployees = archivedEmployeesResult.status === "fulfilled" ? archivedEmployeesResult.value : {};
        const nextOptions = optionsResult.status === "fulfilled" ? optionsResult.value : {};
        const nextUsers = usersResult.status === "fulfilled" ? usersResult.value : {};
        const nextSettings = settingsResult.status === "fulfilled" ? settingsResult.value : {};

        setEmployees(nextEmployees.employees || []);
        setArchivedEmployees(nextArchivedEmployees.employees || []);
        setEmployeeOptions({
          divisions: nextOptions.divisions || [],
          designations: nextOptions.designations || [],
        });
        setUsers(nextUsers.users || []);
        setUserOptions({
          roles: nextUsers.roles || [],
          statuses: nextUsers.statuses || [],
        });
        setSecuritySettings({
          ...DEFAULT_SECURITY_SETTINGS,
          ...(nextSettings.security || {}),
        });
        setPermissionTemplates(normalizePermissionTemplates(nextSettings.permissions?.templates || {}));
        setUserPermissionOverrides(nextSettings.permissions?.userOverrides || {});
        const failedRequest = [employeesResult, archivedEmployeesResult, optionsResult, usersResult, settingsResult]
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
  }, []);

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

  const managedUsers = useMemo(
    () => users.filter((item) => MANAGED_USER_ROLE_KEYS.includes(normalizeRole(item.role))),
    [users]
  );
  const managedRoleOptions = useMemo(
    () => getManagedRoleOptions(userOptions.roles || [], editingUser?.role || null),
    [editingUser?.role, userOptions.roles]
  );
  const employeeRoleOptions = useMemo(
    () => (userOptions.roles || []).map((role) => ({
      ...role,
      key: normalizeRole(role.name),
      label: getRoleLabel(role.name),
    })),
    [userOptions.roles]
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
  const managedStatusOptions = useMemo(
    () => (userOptions.statuses || []).map((status) => ({
      ...status,
      label: getStatusLabel(status.name),
    })),
    [userOptions.statuses]
  );

  const handleSettingsChange = useCallback((nextSettings = {}) => {
    const activeDivisions = Array.isArray(nextSettings.divisions)
      ? nextSettings.divisions.filter((division) => Number(division?.is_archived ?? division?.isArchived ?? 0) === 0)
      : [];
    const activeDivisionIds = new Set(activeDivisions.map((division) => String(division.id)));
    const activeDesignations = Array.isArray(nextSettings.designations)
      ? nextSettings.designations.filter((designation) => {
        const divisionId = String(designation?.division_id ?? designation?.divisionId ?? "");
        const isDesignationArchived = Number(designation?.is_archived ?? designation?.isArchived ?? 0) === 1;
        return !isDesignationArchived && activeDivisionIds.has(divisionId);
      })
      : [];

    setEmployeeOptions({
      divisions: activeDivisions,
      designations: activeDesignations,
    });

    if (nextSettings.security) {
      setSecuritySettings({
        ...DEFAULT_SECURITY_SETTINGS,
        ...nextSettings.security,
      });
    }
  }, []);

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLowerCase();

    return managedUsers.filter((item) => {
      const matchesSearch = !search || [item.username, item.full_name, item.email, item.role, item.division, getUserEmailVerificationLabel(item)]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(search));
      const matchesStatus = !userStatusFilter || normalizeStatus(item.status) === normalizeStatus(userStatusFilter);

      return matchesSearch && matchesStatus;
    });
  }, [managedUsers, query, userStatusFilter]);
  const userStatusOptions = useMemo(
    () => {
      const statusSet = new Set(["Active", "Inactive"]);

      managedUsers.forEach((item) => {
        statusSet.add(getStatusLabel(item.status || "Unknown"));
      });

      (userOptions.statuses || []).forEach((status) => {
        statusSet.add(getStatusLabel(status.name || status.label || "Unknown"));
      });

      return Array.from(statusSet);
    },
    [managedUsers, userOptions.statuses]
  );
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / userRowsPerPage));
  const safeUserPage = Math.min(userPage, totalUserPages);
  const paginatedUsers = useMemo(() => {
    const startIndex = (safeUserPage - 1) * userRowsPerPage;
    return filteredUsers.slice(startIndex, startIndex + userRowsPerPage);
  }, [filteredUsers, safeUserPage, userRowsPerPage]);

  const visibleEmployees = employeeArchiveView === "archive" ? archivedEmployees : employees;
  const employeeStatusOptions = useMemo(
    () => ["Active", "Inactive"],
    []
  );
  const filteredEmployees = useMemo(() => {
    const search = employeeQuery.trim().toLowerCase();

    return visibleEmployees.filter((employee) => {
      const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
      const statusLabel = getEmployeeCardStatus(employee, linkedUser, employeeArchiveView);
      const matchesSearch = !search || [
        employee.employeeId,
        employee.fullName,
        employee.department,
        employee.position,
        linkedUser?.role,
        linkedUser?.status,
        statusLabel,
        employee.basicSalary,
        employee.dateHired,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesDivision = !employeeDivisionFilter || employee.department === employeeDivisionFilter;
      const matchesStatus = !employeeStatusFilter || statusLabel === employeeStatusFilter;

      return matchesSearch && matchesDivision && matchesStatus;
    });
  }, [employeeArchiveView, employeeDivisionFilter, employeeStatusFilter, employeeQuery, userByEmail, visibleEmployees]);
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
  const activeEmployeeCount = useMemo(
    () =>
      employees.filter((employee) => {
        const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
        return normalizeStatus(linkedUser?.status || employee.status || "Inactive") === "active";
      }).length,
    [employees, userByEmail]
  );
  const inactiveEmployeeCount = Math.max(0, employees.length - activeEmployeeCount);

  const nextEmployeeId = useMemo(() => buildNextEmployeeId(employees), [employees]);
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

  const handleUserStatusChange = async (row, nextStatusId) => {
    const currentStatusId = String(row.statusId || "");
    const selectedStatusId = String(nextStatusId || "");

    if (!selectedStatusId || selectedStatusId === currentStatusId) {
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
        statusId: selectedStatusId,
        mustChangePassword,
      });
      const savedUser = result.user;
      const nextStatus = managedStatusOptions.find((status) => String(status.id) === selectedStatusId);
      const savedStatus = nextStatus?.name || nextStatus?.label || savedUser?.status;
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
      (status) => normalizeStatus(status.name || status.label) === nextStatusKey
    );

    if (!nextStatus?.id) {
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
        statusId: nextStatus.id,
        mustChangePassword,
      });
      const savedUser = result.user;
      const savedStatus = nextStatus.name || nextStatus.label || savedUser?.status;
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

  const userColumns = [
    {
      key: "index",
      header: "#",
      render: (_row, index) => (
        <span className="font-medium text-slate-700">
          {(safeUserPage - 1) * userRowsPerPage + index + 1}
        </span>
      ),
    },
    {
      key: "username",
      header: "Username",
      render: (row) => <strong className="font-semibold text-slate-900">{row.username}</strong>,
    },
    { key: "email", header: "Email", render: (row) => row.email || "N/A" },
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
      render: (row) => (
        <span className="inline-flex min-h-7 items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 text-sm font-semibold text-slate-700">
          {getRoleLabel(row.role)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const currentStatus = normalizeStatus(row.status);
        const nextStatusKey = currentStatus === "active" ? "inactive" : "active";
        const nextStatus = managedStatusOptions.find(
          (status) => normalizeStatus(status.name || status.label) === nextStatusKey
        );
        const isActive = currentStatus === "active";
        const isSaving = userStatusSavingId === row.id;

        return (
          <button
            type="button"
            aria-label={`Change ${row.username} to ${getStatusLabel(nextStatusKey)}`}
            title={`Click to set ${getStatusLabel(nextStatusKey)}`}
            disabled={isSaving || !nextStatus?.id}
            onClick={() => handleUserStatusChange(row, nextStatus?.id)}
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
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Pencil}
            onClick={() => {
              setEditingUser(row);
              setUserError("");
              setUserModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={Archive}
            disabled={row.id === user?.id}
            onClick={async () => {
              if (!window.confirm(`Archive ${row.username}?`)) {
                return;
              }

              try {
                await archiveUser(row.id);
                setUsers((current) => current.filter((item) => item.id !== row.id));
              } catch (error) {
                setUserError(error.response?.data?.message || "Unable to archive user.");
              }
            }}
          >
            Archive
          </Button>
        </div>
      ),
    },
  ];

  const employeeColumns = [
    {
      key: "index",
      header: "#",
      render: (_row, index) => (
        <span className="font-medium text-slate-700">
          {(safeEmployeePage - 1) * employeeRowsPerPage + index + 1}
        </span>
      ),
    },
    {
      key: "employeeId",
      header: "Employee ID",
      render: (row) => (
        <span className="font-semibold text-slate-900">{row.employeeId || "N/A"}</span>
      ),
    },
    {
      key: "fullName",
      header: "Full Name",
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
      key: "email",
      header: "Email",
      render: (row) => <span className="text-slate-700">{row.email || "N/A"}</span>,
    },
    {
      key: "phone",
      header: "Phone",
      render: (row) => <span className="text-slate-700">{row.phone || "N/A"}</span>,
    },
    {
      key: "department",
      header: "Division",
      render: (row) => <span className="text-slate-700">{row.department || "N/A"}</span>,
    },
    {
      key: "position",
      header: "Position",
      render: (row) => <span className="text-slate-700">{row.position || "N/A"}</span>,
    },
    {
      key: "role",
      header: "Role",
      render: (row) => {
        const linkedUser = userByEmail.get(String(row.email || "").trim().toLowerCase());
        const roleLabel = linkedUser?.role ? getRoleLabel(linkedUser.role) : "Employee";
        return (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${getRoleBadgeClass(roleLabel)}`}>
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

  const openEmployeeRecordEditor = (employee) => {
    setEditingEmployee(employee);
    setEmployeeModalOpen(true);
  };

  const handleExportEmployees = () => {
    const fileDate = new Date().toISOString().slice(0, 10);
    const exportLabel = employeeArchiveView === "archive" ? "archived-employees" : "employees";
    const rows = [
      ["Employee ID", "Full Name", "Email", "Phone", "Division", "Position", "Role", "Status", "Date Hired", "Salary Rate", "Basic Salary"],
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
          linkedUser?.role ? getRoleLabel(linkedUser.role) : "Employee",
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
      setEmployeeViewOpen(false);
      setViewingEmployee(null);
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
      setEmployeeViewOpen(false);
      setViewingEmployee(null);
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
      toast.error("Choose a CSV file to import.");
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
      toast.dismiss(toastId);
      if (createdCount > 0) {
        await Swal.fire({
          title: "Import Successful!",
          text: "The employee CSV file has been imported successfully.",
          icon: "success",
          confirmButtonText: "Done",
          confirmButtonColor: "#0f766e",
        });
      } else {
        const message = result.errors?.[0] || result.message || "No employees were imported. Review the CSV rows and try again.";
        setEmployeeError(message);
        await Swal.fire({
          title: "Import Failed",
          text: "The employee CSV file could not be imported. Please check the file format and try again.",
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
        text: "The employee CSV file could not be imported. Please check the file format and try again.",
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

    const isCsv = /\.csv$/i.test(file.name) || ["text/csv", "application/vnd.ms-excel"].includes(file.type);
    if (!isCsv) {
      toast.error("Choose a CSV file exported from Excel.");
      return;
    }

    importEmployeeFile(file);
  };

  const handleOpenImportEmployees = () => {
    employeeImportInputRef.current?.click();
  };

  const renderUsersCard = ({ className = "", title = "Users", scrollableTable = false } = {}) => (
    <Card
      className={`${scrollableTable ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""} ${className}`.trim()}
    >
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            Create and manage role-based workforce accounts for chiefs, employees, regional directors, HR heads, and HR staff.
          </CardDescription>
          {userError ? (
            <p className="m-0 mt-2 text-sm font-semibold text-rose-700">{userError}</p>
          ) : null}
        </div>
        <div>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setEditingUser(null);
              setUserError("");
              setUserModalOpen(true);
            }}
          >
            Add User
          </Button>
        </div>
      </CardHeader>
      <CardContent className={`${scrollableTable ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-4"}`.trim()}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
          <div className="w-full sm:w-[240px]">
            <label htmlFor="userStatusFilter" className="mb-2 block text-sm font-semibold text-slate-700">
              Status
            </label>
            <select
              id="userStatusFilter"
              value={userStatusFilter}
              onChange={(event) => {
                setUserStatusFilter(event.target.value);
                setUserPage(1);
              }}
              className="min-h-[46px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none"
            >
              <option value="">All</option>
              {userStatusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-[180px]">
            <label htmlFor="userRowsPerPage" className="mb-2 block text-sm font-semibold text-slate-700">
              Rows Per Page
            </label>
            <select
              id="userRowsPerPage"
              value={userRowsPerPage}
              onChange={(event) => {
                setUserRowsPerPage(Number(event.target.value) || DEFAULT_USER_ROWS_PER_PAGE);
                setUserPage(1);
              }}
              className="min-h-[46px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none"
            >
              {[5, 8, 10, 15, 20].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
        <div
          className={`${scrollableTable ? "min-h-0 flex-1" : ""} overflow-hidden rounded-xl border border-slate-200`.trim()}
        >
          <Table
            columns={userColumns}
            data={paginatedUsers}
            emptyMessage="No matching users found."
            className={scrollableTable ? "h-full overflow-y-auto" : ""}
            stickyHeader={scrollableTable}
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
              <strong className="mt-2 block text-2xl font-semibold text-slate-900">
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

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <Table
              columns={activeView.columns}
              data={employees}
              rowKey="id"
              emptyMessage={activeView.emptyMessage}
              tableClassName="min-w-[1180px]"
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

      // Mirror what the backend decided: it only keeps an override when the chosen
      // modules differ from the role template.
      setUserPermissionOverrides((current) => {
        const savedId = String(savedUser?.id ?? editingUser?.id ?? "");

        if (!savedId || !userData.permissions) {
          return current;
        }

        const next = { ...current };

        if (result.permissionsOverridden) {
          next[savedId] = userData.permissions;
        } else {
          delete next[savedId];
        }

        return next;
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

  const openCreateEmployee = () => {
    setEditingEmployee(null);
    setEmployeeModalOpen(true);
  };

  const closeEmployeeModal = () => {
    setEmployeeModalOpen(false);
    setEditingEmployee(null);
  };

  const selectModule = (module) => {
    const resolvedModule = module === "payroll" ? "payrollGenerate" : module;
    const nextPath = modulePaths[resolvedModule] || modulePaths.dashboard;
    const nextModule = moduleFromPath(nextPath);
    setActiveModule(nextModule);

    if (nextModule === "users") {
      setUserPage(1);
    }

    if (onNavigate) {
      onNavigate(nextPath);
      return;
    }

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
  };

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
    <div className="min-h-screen bg-transparent">
      <Header
        user={user}
        onOpenProfile={profilePath && onNavigate ? (tabId) => {
          requestProfileTab(tabId);
          onNavigate(profilePath);
        } : undefined}
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

      <main className={`${sidebarCollapsed ? "lg:ml-20" : "lg:ml-72"} pt-16 transition-all duration-300 ${isTableWorkspaceView ? "lg:overflow-hidden" : ""}`.trim()}>
        <div
          className={`${
            isTableWorkspaceView ? "flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-4 sm:p-6 lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:overflow-hidden" : "space-y-4 p-4 sm:p-6"
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
              {isProfileView ? (
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
                    onAddEmployee={openCreateEmployee}
                    onSelectModule={selectModule}
                  />
                </div>
              ) : null}

              {activeModule === "users" ? (
                renderUsersCard({ className: "w-full", title: "Users", scrollableTable: true })
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
                        <CardTitle className="text-2xl">
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
                        accept=".csv,text/csv,application/vnd.ms-excel"
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <InputField
                        label="Search Employees"
                        name="employeeSearch"
                        value={employeeQuery}
                        onChange={(event) => {
                          setEmployeeQuery(event.target.value);
                          setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                        }}
                        placeholder="Search by name, ID, email, or position"
                        icon={Search}
                        aria-label="Search employees"
                        className="w-full sm:w-[320px]"
                      />
                      <div className="w-full sm:w-[200px]">
                        <label htmlFor="employeeDivisionFilter" className="mb-2 block text-sm font-semibold text-slate-700">
                          Division
                        </label>
                        <select
                          id="employeeDivisionFilter"
                          value={employeeDivisionFilter}
                          onChange={(event) => {
                            setEmployeeDivisionFilter(event.target.value);
                            setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                          }}
                          className="min-h-[46px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none"
                        >
                          <option value="">All divisions</option>
                          {employeeDivisionOptions.map((division) => (
                            <option key={division} value={division}>{division}</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-full sm:w-[180px]">
                        <label htmlFor="employeeStatusFilter" className="mb-2 block text-sm font-semibold text-slate-700">
                          Status
                        </label>
                        <select
                          id="employeeStatusFilter"
                          value={employeeStatusFilter}
                          onChange={(event) => {
                            setEmployeeStatusFilter(event.target.value);
                            setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                          }}
                          className="min-h-[46px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none"
                        >
                          <option value="">All statuses</option>
                          {employeeStatusOptions.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-full sm:w-[180px]">
                        <label htmlFor="employeeRowsPerPage" className="mb-2 block text-sm font-semibold text-slate-700">
                          Rows Per Page
                        </label>
                        <select
                          id="employeeRowsPerPage"
                          value={employeeRowsPerPage}
                          onChange={(event) => {
                            setEmployeeRowsPerPage(Number(event.target.value) || DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
                            setEmployeePage(DEFAULT_EMPLOYEE_PAGE);
                          }}
                          className="min-h-[46px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none"
                        >
                          {[5, 10, 15, 20, 25, 50].map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="overflow-x-auto">
                        <Table
                          columns={employeeColumns}
                          data={paginatedEmployees}
                          emptyMessage={
                            employeeArchiveView === "archive"
                              ? "No archived employee records found."
                              : "No employee records found. Try adjusting your search or filters."
                          }
                          tableClassName="min-w-[1400px]"
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

              {activeModule === "rewardsRecognition" ? (
                <RewardsRecognitionWorkspace employees={employees} user={user} />
              ) : null}

              {activeModule === "salaryManagement" ? renderSalaryManagementCard() : null}

              {activeModule === "performanceIpcr" ? (
                <IpcrManagementWorkspace employees={employees} />
              ) : null}

              {activeModule === "performanceOpcr" ? (
                <OpcrManagementWorkspace employees={employees} />
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
                <PayslipWorkspace employees={employees} />
              ) : null}

              {activeModule === "payrollLoan" ? (
                <FileLoan employees={employees} user={user} />
              ) : null}

              {activeModule === "payrollCashAdvance" ? (
                <CashAdvanceWorkspace employees={employees} user={user} />
              ) : null}

              {activeModule === "payrollLeaveMonetization" ? (
                <LeaveMonetizationWorkspace employees={employees} user={user} />
              ) : null}

              {activeModule === "archivedPayroll" ? (
                <PayrollManagementWorkspace employees={employees} view="archived" user={user} onNavigate={onNavigate} />
              ) : null}




              {activeModule === "settings" ? (
                <DivisionSettings onSettingsChange={handleSettingsChange} />
              ) : null}

                  {activeModule === "reports" ? (
                    <AdminReports
                      user={user}
                      category={reportCategoryFromPath(currentPath, "/admin/reports")}
                    />
                  ) : null}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <Modal
        open={employeeModalOpen}
        title={editingEmployee ? "Edit Employee" : "Add New Employee"}
        maxWidth="max-w-[1120px]"
        onClose={closeEmployeeModal}
        footer={(
          <>
            <Button variant="ghost" onClick={closeEmployeeModal} disabled={employeeSaving}>
              Cancel
            </Button>
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
        open={employeeViewOpen}
        title="Employee Details"
        maxWidth="max-w-[880px]"
        onClose={() => {
          setEmployeeViewOpen(false);
          setViewingEmployee(null);
        }}
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setEmployeeViewOpen(false);
                setViewingEmployee(null);
              }}
            >
              Close
            </Button>
            {viewingEmployee ? (
              employeeArchiveView === "archive" ? (
                <Button
                  variant="secondary"
                  icon={RotateCcw}
                  onClick={() => handleRestoreEmployee(viewingEmployee)}
                >
                  Restore
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    icon={Pencil}
                    onClick={() => {
                      setEmployeeViewOpen(false);
                      setEditingEmployee(viewingEmployee);
                      setEmployeeModalOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    icon={Archive}
                    onClick={() => handleArchiveEmployee(viewingEmployee)}
                  >
                    Archive
                  </Button>
                </>
              )
            ) : null}
          </div>
        )}
      >
        {viewingEmployee ? (
          <div className="space-y-5">
            <div className="flex justify-center">
              <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-2xl font-bold text-slate-500 shadow-sm">
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
        open={userModalOpen}
        title={editingUser ? "Edit User" : "Add User"}
        onClose={closeUserModal}
      >
        <CreateUserForm
          initialValues={editingUser}
          options={{
            roles: managedRoleOptions,
            statuses: managedStatusOptions,
            security: securitySettings,
            roleTemplates: permissionTemplates,
            userOverrides: userPermissionOverrides,
          }}
          employees={employees}
          existingUsers={managedUsers}
          onCancel={closeUserModal}
          onSubmit={handleSaveUser}
          submitLabel={userSaving ? "Saving..." : editingUser ? "Save Changes" : "Create User"}
        />
      </Modal>

    </div>
  );
}
