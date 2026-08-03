import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Building2,
  ClipboardList,
  Database,
  Download,
  Eye,
  FileText,
  Gauge,
  KeyRound,
  Layers,
  LockKeyhole,
  MailX,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  RotateCcw,
  Trash2,
  UnlockKeyhole,
  UserRoundCog,
} from "lucide-react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import Pagination from "../../components/UI/Pagination";
import {
  SettingsCheckbox,
  SettingsNav,
  SettingsNotice,
  SettingsNumberField,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  useSettingsNotice,
} from "../../components/settings";
import {
  createPayrollDeduction as createDeductionType,
  fetchPayrollDeductionData,
  updatePayrollDeduction as updateDeductionType,
} from "../../services/payrollService";
import {
  archiveDesignation,
  archiveDivision,
  createManualBackup,
  deleteBackupRecord,
  downloadBackupRecord,
  getBackupData,
  getAuditLogs,
  getSettings,
  saveBackupSettings,
  savePermissionSettings,
  saveUserPermissionSettings,
  resetUserPermissionSettings,
  saveDesignation,
  saveDivision,
  saveLeaveType,
  saveSecurityPolicySettings,
  saveSecuritySettings,
  saveEmailDomainPolicy,
  saveSystemConfiguration,
  saveTwoFactorSettings,
  unlockLockedAccount,
  restoreDesignation,
  restoreDivision,
} from "../../services/api";
import TwoFactorAuthenticationSettings from "./twofactorauthentication";
import AuditLogsSettings, { defaultAuditPagination } from "./auditlogs";
import RateLimitSettings from "./ratelimit";
import RoleSettings from "./roles";
import MathCaptchaSettings from "./math_captcha";
import EmailDomainPolicySettings, {
  defaultEmailDomainPolicy,
  normalizeEmailDomainPolicy,
} from "./email_domain_policy";
import DeductionSettings, {
  buildDeductionGroups,
  DeductionModal,
  defaultDeductionDefinitionForm,
} from "./deductions";
import PermissionSettings, {
  buildUserPermissionDraft,
  createDefaultPermissionTemplates,
  normalizePermissionTemplates,
  normalizeSinglePermissionTemplate,
  permissionItems,
  permissionRoles,
  permissionSections,
} from "./permission";

/**
 * The settings catalog, grouped for the navigator.
 *
 * Ten flat tabs gave no clue which settings relate to which. Grouping them means someone looking
 * for "who can see payroll" scans Access & Security instead of reading all ten labels. `keywords`
 * feeds the filter box so a search for "password" or "otp" finds Security Settings even though
 * neither word is in its label.
 */
const settingsGroups = [
  {
    label: "Organization",
    items: [
      {
        key: "organizationStructure",
        label: "Organization Structure",
        icon: Building2,
        description: "Divisions and designations",
        keywords: ["division", "designation", "department", "unit", "structure"],
      },
      {
        key: "leaveType",
        label: "Leave Types",
        icon: FileText,
        description: "Leave types available to employees",
        keywords: ["leave", "vacation", "sick", "holiday"],
      },
      {
        key: "deduction",
        label: "Deductions",
        icon: ClipboardList,
        description: "Payroll deduction names",
        keywords: ["deduction", "payroll", "phic", "gsis", "hdmf", "philhealth", "pagibig"],
      },
    ],
  },
  {
    label: "Access & Security",
    items: [
      {
        key: "roles",
        label: "Roles",
        icon: Layers,
        description: "Built-in and custom roles",
        keywords: ["role", "custom", "add", "create", "base", "module", "access"],
      },
      {
        key: "permissions",
        label: "Permissions",
        icon: KeyRound,
        description: "Role and per-user access",
        keywords: ["permission", "role", "access", "user", "grant", "revoke"],
      },
      {
        key: "securitySettings",
        label: "Security",
        icon: LockKeyhole,
        description: "Passwords, sessions, lockouts, and 2FA",
        keywords: ["password", "session", "lockout", "locked", "2fa", "otp", "two-factor", "timeout"],
      },
      {
        key: "captcha",
        label: "Login Captcha",
        icon: ShieldCheck,
        description: "Math captcha on the login page",
        keywords: ["captcha", "login", "bot", "math"],
      },
      {
        key: "emailDomainPolicy",
        label: "Temp Mail Blocker",
        icon: MailX,
        description: "Allowed and blocked email domains",
        keywords: ["email", "mail", "domain", "gmail", "temporary", "temp", "blocker", "disposable"],
      },
      {
        key: "rateLimiting",
        label: "Rate Limiting",
        icon: Gauge,
        description: "Request throttling and blocked addresses",
        keywords: ["rate", "limit", "throttle", "block", "ip", "abuse"],
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        key: "systemConfiguration",
        label: "System Configuration",
        icon: Settings2,
        description: "Company details, work schedule, overtime",
        keywords: ["company", "work week", "hours", "overtime", "undertime", "schedule", "profile"],
      },
      {
        key: "backupData",
        label: "Backup & Data",
        icon: Database,
        description: "Automatic and manual database backups",
        keywords: ["backup", "restore", "database", "export", "download", "schedule"],
      },
      {
        key: "auditLogs",
        label: "Audit Logs",
        icon: ClipboardList,
        description: "Recorded system activity",
        keywords: ["audit", "log", "history", "activity", "trail"],
      },
    ],
  },
];

const settingsSections = settingsGroups.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.label }))
);

const organizationRowsPerPage = 8;

const backupScheduleOptions = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const defaultBackupSettings = {
  automaticEnabled: false,
  schedule: "daily",
  backupPath: "",
  backupDateTime: "",
  lastAutomaticBackupAt: "",
};

const workWeekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const systemProfileOptions = ["Production", "Staging", "Development"];

const defaultSystemConfiguration = {
  companyName: "Human Resources Information System",
  companyAddress: "Mines Geosciences Bureau, DENR Region X",
  systemProfile: "Production",
  developedBy: "",
  workWeek: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  totalWorkHoursPerDay: "12",
  overtimeRules: {
    regularOvertimePercent: "125",
    restDayOvertimePercent: "130",
    specialHolidayOvertimePercent: "150",
    regularHolidayOvertimePercent: "200",
  },
  undertimeRules: {
    enabled: true,
    gracePeriodMinutes: "0",
    deductionPerHour: "100.00",
  },
};

const overtimeRuleFields = [
  { key: "regularOvertimePercent", label: "Regular Overtime (%)" },
  { key: "restDayOvertimePercent", label: "Rest day Overtime (%)" },
  { key: "specialHolidayOvertimePercent", label: "Special Holiday Overtime (%)" },
  { key: "regularHolidayOvertimePercent", label: "Regular Holiday Overtime (%)" },
];

const securityPolicyFields = [
  {
    key: "maximumPasswordLength",
    label: "Maximum Password Length",
    helper: "Default 64. Allowed range: 6 to 256 characters.",
    min: 6,
    max: 256,
    defaultValue: 64,
  },
  {
    key: "passwordExpiryDays",
    label: "Password Expiry (days)",
    helper: "Default 90. Set to 0 to disable password expiry entirely.",
    min: 0,
    max: 3650,
    defaultValue: 90,
  },
  {
    key: "sessionTimeoutMinutes",
    label: "Session Timeout (minutes)",
    helper: "Default 30. Minimum 1. Users are signed out automatically after inactivity.",
    min: 1,
    max: 1440,
    defaultValue: 30,
  },
  {
    key: "lockoutFailedAttempts",
    label: "Lockout After Failed Attempts",
    helper: "Default 5. Accounts lock after this many consecutive failed logins.",
    min: 1,
    max: 20,
    defaultValue: 5,
  },
  {
    key: "lockoutDurationMinutes",
    label: "Lockout Duration (minutes)",
    helper: "Default 15. Locked accounts unlock automatically after this duration.",
    min: 1,
    max: 1440,
    defaultValue: 15,
  },
];

const defaultTwoFactorSettings = {
  enabled: false,
  requireAdmins: false,
  requireHr: false,
  requireManagers: false,
  requireAllUsers: false,
  otpExpiryMinutes: "5",
  maxAttempts: "3",
  resendDelaySeconds: "0",
};

const twoFactorNumberFields = [
  { key: "otpExpiryMinutes", label: "OTP expiration time", min: 5, max: 15 },
  { key: "maxAttempts", label: "Maximum verification attempts", min: 3, max: 10 },
  { key: "resendDelaySeconds", label: "Resend OTP timer", min: 0, max: 60 },
];

function securityPolicyFormFromSettings(settings = {}) {
  return securityPolicyFields.reduce((form, field) => {
    const rawValue = settings[field.key];
    const value =
      rawValue !== undefined && rawValue !== null && Number.isFinite(Number(rawValue))
        ? Number(rawValue)
        : field.defaultValue;

    return {
      ...form,
      [field.key]: String(value),
    };
  }, {});
}

function twoFactorSettingsFormFromSettings(settings = {}) {
  return {
    ...defaultTwoFactorSettings,
    enabled: Boolean(settings.enabled),
    requireAdmins: Boolean(settings.requireAdmins),
    requireHr: Boolean(settings.requireHr),
    requireManagers: Boolean(settings.requireManagers),
    requireAllUsers: Boolean(settings.requireAllUsers),
    otpExpiryMinutes: String(settings.otpExpiryMinutes ?? defaultTwoFactorSettings.otpExpiryMinutes),
    maxAttempts: String(settings.maxAttempts ?? defaultTwoFactorSettings.maxAttempts),
    resendDelaySeconds: String(settings.resendDelaySeconds ?? defaultTwoFactorSettings.resendDelaySeconds),
  };
}

function systemConfigText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function systemConfigNumberString(value, fallback, decimals = null) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return String(fallback);
  }

  return decimals === null ? String(value) : number.toFixed(decimals);
}

function systemConfigurationFormFromSettings(settings = {}) {
  const sourceOvertime = settings.overtimeRules || {};
  const sourceUndertime = settings.undertimeRules || {};
  const selectedWorkDays = Array.isArray(settings.workWeek)
    ? settings.workWeek.filter((day) => workWeekDays.includes(day))
    : [];
  const systemProfile = systemProfileOptions.includes(settings.systemProfile)
    ? settings.systemProfile
    : defaultSystemConfiguration.systemProfile;

  return {
    companyName: systemConfigText(settings.companyName, defaultSystemConfiguration.companyName),
    companyAddress: systemConfigText(settings.companyAddress, defaultSystemConfiguration.companyAddress),
    systemProfile,
    developedBy: String(settings.developedBy ?? defaultSystemConfiguration.developedBy),
    workWeek: selectedWorkDays.length ? selectedWorkDays : defaultSystemConfiguration.workWeek,
    totalWorkHoursPerDay: systemConfigNumberString(
      settings.totalWorkHoursPerDay,
      defaultSystemConfiguration.totalWorkHoursPerDay
    ),
    overtimeRules: {
      regularOvertimePercent: systemConfigNumberString(
        sourceOvertime.regularOvertimePercent,
        defaultSystemConfiguration.overtimeRules.regularOvertimePercent
      ),
      restDayOvertimePercent: systemConfigNumberString(
        sourceOvertime.restDayOvertimePercent,
        defaultSystemConfiguration.overtimeRules.restDayOvertimePercent
      ),
      specialHolidayOvertimePercent: systemConfigNumberString(
        sourceOvertime.specialHolidayOvertimePercent,
        defaultSystemConfiguration.overtimeRules.specialHolidayOvertimePercent
      ),
      regularHolidayOvertimePercent: systemConfigNumberString(
        sourceOvertime.regularHolidayOvertimePercent,
        defaultSystemConfiguration.overtimeRules.regularHolidayOvertimePercent
      ),
    },
    undertimeRules: {
      enabled: sourceUndertime.enabled !== false,
      gracePeriodMinutes: systemConfigNumberString(
        sourceUndertime.gracePeriodMinutes,
        defaultSystemConfiguration.undertimeRules.gracePeriodMinutes
      ),
      deductionPerHour: systemConfigNumberString(
        sourceUndertime.deductionPerHour,
        defaultSystemConfiguration.undertimeRules.deductionPerHour,
        2
      ),
    },
  };
}

function parseAuditDate(value) {
  const date = new Date(String(value || "").replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatBackupId(row = {}) {
  const id = Number(row.id);
  return Number.isFinite(id) && id > 0 ? `BKP-${String(id).padStart(4, "0")}` : "N/A";
}

function formatBackupDateTime(value) {
  const date = parseAuditDate(value);

  return date
    ? new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date)
    : "N/A";
}

function formatLockRemaining(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0);

  if (totalSeconds <= 0) {
    return "Less than 1 minute";
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = `${hours} hour${hours === 1 ? "" : "s"}`;

  if (minutes === 0) {
    return hourText;
  }

  return `${hourText} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function formatBackupDateTimeInput(value) {
  const date = parseAuditDate(value);

  if (!date) {
    return "";
  }

  const pad = (part) => String(part).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeBackupSettings(settings = {}) {
  return {
    ...defaultBackupSettings,
    ...settings,
    backupDateTime: formatBackupDateTimeInput(settings.backupDateTime),
  };
}

function formatFileSize(value) {
  const bytes = Number(value) || 0;

  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** unitIndex);

  return `${amount.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function backupStatusClass(status) {
  switch (String(status || "").toLowerCase()) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "deleted":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function organizationRecordIsArchived(record = {}) {
  return Number(record.is_archived ?? record.isArchived ?? 0) === 1;
}

function organizationStatusClass(record = {}) {
  return organizationRecordIsArchived(record)
    ? "border-slate-200 bg-slate-100 text-slate-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function DivisionSettings({ onSettingsChange }) {
  const [activeTab, setActiveTab] = useState("organizationStructure");
  const [sectionQuery, setSectionQuery] = useState("");
  const activeSection = settingsSections.find((section) => section.key === activeTab);
  const [divisions, setDivisions] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [divisionQuery, setDivisionQuery] = useState("");
  const [designationQuery, setDesignationQuery] = useState("");
  const [leaveTypeQuery, setLeaveTypeQuery] = useState("");
  const [divisionModalOpen, setDivisionModalOpen] = useState(false);
  const [designationModalOpen, setDesignationModalOpen] = useState(false);
  const [leaveTypeModalOpen, setLeaveTypeModalOpen] = useState(false);
  const [deductionModalOpen, setDeductionModalOpen] = useState(false);
  const [editingDivision, setEditingDivision] = useState(null);
  const [editingDesignation, setEditingDesignation] = useState(null);
  const [divisionName, setDivisionName] = useState("");
  const [divisionDescription, setDivisionDescription] = useState("");
  const [designationName, setDesignationName] = useState("");
  const [designationDivisionId, setDesignationDivisionId] = useState("");
  const [leaveTypeName, setLeaveTypeName] = useState("");
  const [leaveTypeCode, setLeaveTypeCode] = useState("");
  const [deductionTypes, setDeductionTypes] = useState([]);
  const [deductionAllowances, setDeductionAllowances] = useState([]);
  const [deductionLoading, setDeductionLoading] = useState(false);
  const [deductionSaving, setDeductionSaving] = useState(false);
  const [editingDeduction, setEditingDeduction] = useState(null);
  const deductionNotice = useSettingsNotice();
  // Categories drive the panels now, so the initial key is empty until the API answers.
  const [deductionCategories, setDeductionCategories] = useState([]);
  const [deductionGroupKey, setDeductionGroupKey] = useState("");
  const [deductionDefinitionForm, setDeductionDefinitionForm] = useState(defaultDeductionDefinitionForm);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loginCaptchaEnabled, setLoginCaptchaEnabled] = useState(true);
  const captchaNotice = useSettingsNotice();
  const [emailDomainPolicy, setEmailDomainPolicy] = useState(defaultEmailDomainPolicy);
  const [emailDomainPolicySaving, setEmailDomainPolicySaving] = useState(false);
  const emailDomainPolicyNotice = useSettingsNotice();
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securityPolicyForm, setSecurityPolicyForm] = useState(() => securityPolicyFormFromSettings());
  const [securityPolicyErrors, setSecurityPolicyErrors] = useState({});
  const securityPolicyNotice = useSettingsNotice();
  const [securityPolicySaving, setSecurityPolicySaving] = useState(false);
  const [twoFactorForm, setTwoFactorForm] = useState(() => twoFactorSettingsFormFromSettings());
  const [twoFactorErrors, setTwoFactorErrors] = useState({});
  const twoFactorNotice = useSettingsNotice();
  const [twoFactorSaving, setTwoFactorSaving] = useState(false);
  const [lockedAccounts, setLockedAccounts] = useState([]);
  const [unlockingAccountId, setUnlockingAccountId] = useState("");
  const [systemConfigForm, setSystemConfigForm] = useState(() => systemConfigurationFormFromSettings());
  const [systemConfigErrors, setSystemConfigErrors] = useState({});
  const systemConfigNotice = useSettingsNotice();
  const [systemConfigSaving, setSystemConfigSaving] = useState(false);
  const [permissionTemplates, setPermissionTemplates] = useState(() => createDefaultPermissionTemplates());
  const [permissionUserCounts, setPermissionUserCounts] = useState({});
  const permissionNotice = useSettingsNotice();
  const [permissionSavingRole, setPermissionSavingRole] = useState("");
  const [selectedPermissionRole, setSelectedPermissionRole] = useState(permissionRoles[0]?.key || "admin");
  const [expandedPermissionSections, setExpandedPermissionSections] = useState({});
  const [permissionMode, setPermissionMode] = useState("role");
  const [permissionUsers, setPermissionUsers] = useState([]);
  const [permissionUserOverrides, setPermissionUserOverrides] = useState({});
  const [permissionUserSearch, setPermissionUserSearch] = useState("");
  const [selectedPermissionUserId, setSelectedPermissionUserId] = useState(null);
  const [userPermissionDraft, setUserPermissionDraft] = useState(() => normalizeSinglePermissionTemplate({}));
  const [permissionUserDirty, setPermissionUserDirty] = useState(false);
  const [permissionSavingUser, setPermissionSavingUser] = useState(false);
  const [actionPopover, setActionPopover] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSearchInput, setAuditSearchInput] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditDateRange, setAuditDateRange] = useState("30d");
  const [auditPageSize, setAuditPageSize] = useState(25);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPagination, setAuditPagination] = useState(defaultAuditPagination);
  const [auditLoading, setAuditLoading] = useState(false);
  const auditNotice = useSettingsNotice();
  const [divisionPage, setDivisionPage] = useState(1);
  const [designationPage, setDesignationPage] = useState(1);
  const [backupDataLoading, setBackupDataLoading] = useState(false);
  const [backupSettingsSaving, setBackupSettingsSaving] = useState(false);
  const [backupManualLoading, setBackupManualLoading] = useState(false);
  const [backupActionId, setBackupActionId] = useState("");
  const backupNotice = useSettingsNotice();
  const [backupSettings, setBackupSettings] = useState(defaultBackupSettings);
  const [backupHistory, setBackupHistory] = useState([]);
  const [viewingBackup, setViewingBackup] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      const result = await getSettings();
      const nextSecurityPolicy = securityPolicyFormFromSettings(result.security || {});
      const nextTwoFactor = twoFactorSettingsFormFromSettings(result.security?.twoFactor || {});
      const nextPermissionTemplates = normalizePermissionTemplates(result.permissions?.templates || {});
      const nextSystemConfiguration = systemConfigurationFormFromSettings(result.systemConfiguration || {});
      const nextEmailDomainPolicy = normalizeEmailDomainPolicy(result.emailDomainPolicy || {});

      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      setLeaveTypes(result.leaveTypes || []);
      setDivisionPage(1);
      setDesignationPage(1);
      setLoginCaptchaEnabled(result.security?.loginCaptchaEnabled !== false);
      setEmailDomainPolicy(nextEmailDomainPolicy);
      emailDomainPolicyNotice.clear();
      setLockedAccounts(Array.isArray(result.lockedAccounts) ? result.lockedAccounts : []);
      setSecurityPolicyForm(nextSecurityPolicy);
      setSecurityPolicyErrors({});
      setTwoFactorForm(nextTwoFactor);
      setTwoFactorErrors({});
      twoFactorNotice.clear();
      setSystemConfigForm(nextSystemConfiguration);
      setSystemConfigErrors({});
      systemConfigNotice.clear();
      setPermissionTemplates(nextPermissionTemplates);
      setPermissionUserCounts(result.permissions?.activeUserCounts || {});
      setPermissionUsers(Array.isArray(result.permissions?.users) ? result.permissions.users : []);
      setPermissionUserOverrides(result.permissions?.userOverrides || {});
      permissionNotice.clear();
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
        leaveTypes: result.leaveTypes || [],
        security: {
          loginCaptchaEnabled: result.security?.loginCaptchaEnabled !== false,
          ...securityPolicyFields.reduce((settings, field) => ({
            ...settings,
            [field.key]: Number(nextSecurityPolicy[field.key]),
          }), {}),
          twoFactor: {
            ...nextTwoFactor,
            otpExpiryMinutes: Number(nextTwoFactor.otpExpiryMinutes),
            maxAttempts: Number(nextTwoFactor.maxAttempts),
            resendDelaySeconds: Number(nextTwoFactor.resendDelaySeconds),
          },
        },
        permissions: {
          templates: nextPermissionTemplates,
          activeUserCounts: result.permissions?.activeUserCounts || {},
        },
        systemConfiguration: result.systemConfiguration || nextSystemConfiguration,
        emailDomainPolicy: nextEmailDomainPolicy,
      });
      setMessage("");
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to load settings.");
    }
    }, [emailDomainPolicyNotice, onSettingsChange, permissionNotice, systemConfigNotice, twoFactorNotice]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Close the floating action card when the layout shifts under it.
  useEffect(() => {
    if (!actionPopover) {
      return undefined;
    }

    const close = () => setActionPopover(null);

    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [actionPopover]);

  // Default to the first user once the user list is available in "By User" mode.
  useEffect(() => {
    if (permissionMode !== "user" || selectedPermissionUserId || permissionUsers.length === 0) {
      return;
    }

    selectPermissionUser(permissionUsers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionMode, permissionUsers, selectedPermissionUserId]);

  const loadDeductionTypes = useCallback(async () => {
    setDeductionLoading(true);
    deductionNotice.clear();

    try {
      // The default GET returns both, so the panels and their contents arrive in one round trip.
      const result = await fetchPayrollDeductionData();
      setDeductionTypes(Array.isArray(result.definitionTypes) ? result.definitionTypes : []);
      setDeductionCategories(Array.isArray(result.categories) ? result.categories : []);
      setDeductionAllowances(Array.isArray(result.allowances) ? result.allowances : []);
    } catch (error) {
      setDeductionTypes([]);
      setDeductionCategories([]);
      setDeductionAllowances([]);
      deductionNotice.error(error.response?.data?.message || "Unable to load deduction types.");
    } finally {
      setDeductionLoading(false);
    }
    }, [deductionNotice]);

  useEffect(() => {
    if (activeTab === "deduction") {
      loadDeductionTypes();
    }
  }, [activeTab, loadDeductionTypes]);

  const loadBackupData = useCallback(async () => {
    setBackupDataLoading(true);
    backupNotice.clear();

    try {
      const result = await getBackupData();
      setBackupSettings(normalizeBackupSettings(result.settings || {}));
      setBackupHistory(Array.isArray(result.history) ? result.history : []);
    } catch (error) {
      backupNotice.error(error.response?.data?.message || "Unable to load backup data.");
      setBackupHistory([]);
    } finally {
      setBackupDataLoading(false);
    }
    }, [backupNotice]);

  useEffect(() => {
    if (activeTab === "backupData") {
      loadBackupData();
    }
  }, [activeTab, loadBackupData]);

  const loadAuditLogs = useCallback(async (overrides = {}) => {
    const params = {
      search: auditSearch,
      range: auditDateRange,
      page: auditPage,
      perPage: auditPageSize,
      ...overrides,
    };

    setAuditLoading(true);
    auditNotice.clear();

    try {
      const result = await getAuditLogs(params);
      const pagination = result.pagination || {};
      const nextPagination = {
        page: Number(pagination.page || params.page || 1),
        perPage: Number(pagination.perPage || params.perPage || 25),
        total: Number(pagination.total || 0),
        totalPages: Number(pagination.totalPages || 1),
        from: Number(pagination.from || 0),
        to: Number(pagination.to || 0),
      };

      setAuditLogs(result.auditLogs || []);
      setAuditPagination(nextPagination);

      if (nextPagination.page !== auditPage) {
        setAuditPage(nextPagination.page);
      }

      return result;
    } catch (error) {
      setAuditLogs([]);
      setAuditPagination({
        ...defaultAuditPagination,
        perPage: auditPageSize,
      });
      auditNotice.error(error.response?.data?.message || "Unable to load audit logs.");
      return null;
    } finally {
      setAuditLoading(false);
    }
    }, [auditDateRange, auditNotice, auditPage, auditPageSize, auditSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAuditPage(1);
      setAuditSearch(auditSearchInput.trim());
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [auditSearchInput]);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  const activeDivisions = useMemo(
    () => divisions.filter((division) => !organizationRecordIsArchived(division)),
    [divisions]
  );

  const editableDesignationDivisionOptions = useMemo(() => {
    const options = [...activeDivisions];
    const currentDivisionId = String(designationDivisionId || "");

    if (editingDesignation?.division_id) {
      const currentDivision = divisions.find(
        (division) => String(division.id) === String(editingDesignation.division_id)
      );

      if (
        currentDivision
        && !options.some((division) => String(division.id) === String(currentDivision.id))
      ) {
        options.unshift(currentDivision);
      }
    } else if (currentDivisionId) {
      const currentDivision = divisions.find((division) => String(division.id) === currentDivisionId);

      if (
        currentDivision
        && !options.some((division) => String(division.id) === String(currentDivision.id))
      ) {
        options.unshift(currentDivision);
      }
    }

    return options;
  }, [activeDivisions, designationDivisionId, divisions, editingDesignation?.division_id]);

  const filteredDivisions = useMemo(() => {
    const search = divisionQuery.trim().toLowerCase();
    const results = !search
      ? divisions
      : divisions.filter((division) =>
        [
          division.name,
          division.description,
          division.code,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search))
      );

    return results;
  }, [divisionQuery, divisions]);

  const filteredDesignations = useMemo(() => {
    const search = designationQuery.trim().toLowerCase();
    const results = !search
      ? designations
      : designations.filter((designation) =>
        [designation.name, designation.division_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search))
      );

    return results;
  }, [designationQuery, designations]);

  const divisionTotalPages = Math.max(1, Math.ceil(filteredDivisions.length / organizationRowsPerPage));
  const designationTotalPages = Math.max(1, Math.ceil(filteredDesignations.length / organizationRowsPerPage));
  const visibleDivisions = filteredDivisions.slice(
    (Math.min(divisionPage, divisionTotalPages) - 1) * organizationRowsPerPage,
    Math.min(divisionPage, divisionTotalPages) * organizationRowsPerPage
  );
  const visibleDesignations = filteredDesignations.slice(
    (Math.min(designationPage, designationTotalPages) - 1) * organizationRowsPerPage,
    Math.min(designationPage, designationTotalPages) * organizationRowsPerPage
  );

  useEffect(() => {
    setDivisionPage((current) => Math.min(Math.max(1, current), divisionTotalPages));
  }, [divisionTotalPages]);

  useEffect(() => {
    setDesignationPage((current) => Math.min(Math.max(1, current), designationTotalPages));
  }, [designationTotalPages]);

  const filteredLeaveTypes = useMemo(() => {
    const search = leaveTypeQuery.trim().toLowerCase();
    if (!search) {
      return leaveTypes;
    }

    return leaveTypes.filter((leaveType) =>
      [leaveType.name, leaveType.code, leaveType.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [leaveTypeQuery, leaveTypes]);

  const openDivisionModal = (division = null) => {
    setEditingDivision(division);
    setDivisionName(division?.name || "");
    setDivisionDescription(division?.description || "");
    setErrors({});
    setDivisionModalOpen(true);
  };

  const openDesignationModal = (designation = null) => {
    setEditingDesignation(designation);
    setDesignationName(designation?.name || "");
    setDesignationDivisionId(String(designation?.division_id || ""));
    setErrors({});
    setDesignationModalOpen(true);
  };

  const openLeaveTypeModal = () => {
    setLeaveTypeName("");
    setLeaveTypeCode("");
    setErrors({});
    setLeaveTypeModalOpen(true);
  };

  const openDeductionModal = (groupKey) => {
    setEditingDeduction(null);
    setDeductionGroupKey(groupKey);
    setDeductionDefinitionForm(defaultDeductionDefinitionForm);
    setErrors({});
    setDeductionModalOpen(true);
  };

  const openEditDeductionModal = (deduction) => {
    setEditingDeduction(deduction);
    setDeductionGroupKey(deduction?.groupKey || "");
    setDeductionDefinitionForm({
      type_name: deduction?.type_name || "",
      description: deduction?.description || "",
      default_amount: String(deduction?.default_amount ?? "0.00"),
      default_rate: String(deduction?.default_rate ?? "0.0000"),
      threshold_amount: String(deduction?.threshold_amount ?? "0.00"),
      threshold_mode: deduction?.threshold_mode || "fixed",
      threshold_rules: deduction?.threshold_rules || "",
      base_floor: String(deduction?.base_floor ?? "0.00"),
      base_cap: deduction?.base_cap === null || deduction?.base_cap === undefined ? "" : String(deduction.base_cap),
      is_active: String(deduction?.is_active ?? "1"),
    });
    setErrors({});
    setDeductionModalOpen(true);
  };

  const updateDeductionDefinitionField = (fieldKey) => (event) => {
    setDeductionDefinitionForm((current) => ({
      ...current,
      [fieldKey]: event.target.value,
    }));
    setErrors((current) => ({ ...current, [fieldKey]: "" }));
  };

  const handleSaveDivision = async (event) => {
    event.preventDefault();

    if (!divisionName.trim()) {
      setErrors({ divisionName: "Division name is required." });
      return;
    }

    setSaving(true);
    try {
      const result = await saveDivision({
        id: editingDivision?.id,
        name: divisionName.trim(),
        description: divisionDescription.trim(),
      });
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
      });
      setDivisionModalOpen(false);
      setEditingDivision(null);
      setDivisionName("");
      setDivisionDescription("");
      toast.success(editingDivision ? "Division updated successfully." : "Division added successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save division.";
      setErrors({ divisionName: message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDesignation = async (event) => {
    event.preventDefault();
    const nextErrors = {};

    if (!designationName.trim()) {
      nextErrors.designationName = "Designation name is required.";
    }
    if (!designationDivisionId) {
      nextErrors.designationDivisionId = "Division is required.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      const result = await saveDesignation({
        id: editingDesignation?.id,
        name: designationName.trim(),
        divisionId: designationDivisionId,
      });
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
      });
      setDesignationModalOpen(false);
      setEditingDesignation(null);
      setDesignationName("");
      setDesignationDivisionId("");
      toast.success(editingDesignation ? "Designation updated successfully." : "Designation added successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save designation.";
      setErrors(
        message.toLowerCase().includes("division")
          ? { designationDivisionId: message }
          : { designationName: message }
      );
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveDivision = async (division) => {
    if (!division?.id) {
      return;
    }

    const designationCount = designations.filter(
      (designation) => String(designation.division_id) === String(division.id)
    ).length;
    const confirmation = await Swal.fire({
      title: "Archive division?",
      text: designationCount
        ? `This will archive ${designationCount} designation${designationCount === 1 ? "" : "s"} under this division.`
        : "This division will be archived.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Archive",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await archiveDivision(division.id);
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
      });
      toast.success("Division archived successfully. Its designations were archived too.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to archive division.";
      toast.error(message);
    }
  };

  const handleRestoreDivision = async (division) => {
    if (!division?.id) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Restore division?",
      text: "The division will be made active again.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Restore",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await restoreDivision(division.id);
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
      });
      toast.success("Division restored successfully. Restore designations as needed.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to restore division.";
      toast.error(message);
    }
  };

  const handleArchiveDesignation = async (designation) => {
    if (!designation?.id) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Archive designation?",
      text: `Archive ${designation.name || "this designation"}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Archive",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await archiveDesignation(designation.id);
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
      });
      toast.success("Designation archived successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to archive designation.";
      toast.error(message);
    }
  };

  const handleRestoreDesignation = async (designation) => {
    if (!designation?.id) {
      return;
    }

    if (Number(designation.division_is_archived ?? 0) === 1) {
      toast.error("Restore the division before restoring this designation.");
      return;
    }

    const confirmation = await Swal.fire({
      title: "Restore designation?",
      text: `Restore ${designation.name || "this designation"}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Restore",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await restoreDesignation(designation.id);
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
      });
      toast.success("Designation restored successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to restore designation.";
      toast.error(message);
    }
  };

  const handleSaveLeaveType = async (event) => {
    event.preventDefault();
    const nextErrors = {};

    if (!leaveTypeName.trim()) {
      nextErrors.leaveTypeName = "Leave type name is required.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      const result = await saveLeaveType({
        name: leaveTypeName.trim(),
        code: leaveTypeCode.trim(),
      });
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      setLeaveTypes(result.leaveTypes || []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
        leaveTypes: result.leaveTypes || [],
      });
      setLeaveTypeModalOpen(false);
      setLeaveTypeName("");
      setLeaveTypeCode("");
      setMessage("");
      toast.success("Leave type added successfully.");
    } catch (error) {
      setErrors({ leaveTypeName: error.response?.data?.message || "Unable to save leave type." });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDeductionType = async (event) => {
    event.preventDefault();

    const group = buildDeductionGroups(deductionCategories)
      .find((item) => item.key === deductionGroupKey);

    if (!group) {
      setErrors({ type_name: "Pick a deduction category first." });
      return;
    }

    if (!deductionDefinitionForm.type_name.trim()) {
      setErrors({ type_name: "Type name is required." });
      return;
    }

    setDeductionSaving(true);
    try {
      const payload = {
        action: "definition_type",
        groupKey: group.key,
        ...deductionDefinitionForm,
        type_name: deductionDefinitionForm.type_name.trim(),
        description: deductionDefinitionForm.description.trim(),
        threshold_rules: deductionDefinitionForm.threshold_rules.trim(),
      };
      if (editingDeduction?.id) {
        await updateDeductionType({
          ...payload,
          id: editingDeduction.id,
          definitionId: editingDeduction.id,
        });
      } else {
        await createDeductionType(payload);
      }
      await loadDeductionTypes();

      setDeductionModalOpen(false);
      setEditingDeduction(null);
      setDeductionDefinitionForm(defaultDeductionDefinitionForm);
      setErrors({});
      toast.success(`${group.label} deduction ${editingDeduction?.id ? "updated" : "added"} successfully.`);
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save deduction.";
      setErrors({ type_name: message });
      toast.error(message);
    } finally {
      setDeductionSaving(false);
    }
  };

  const handleToggleLoginCaptcha = async () => {
    const nextEnabledState = !loginCaptchaEnabled;

    setSecuritySaving(true);
    try {
      const result = await saveSecuritySettings({
        loginCaptchaEnabled: nextEnabledState,
      });
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      setLoginCaptchaEnabled(result.security?.loginCaptchaEnabled !== false);
      setTwoFactorForm(twoFactorSettingsFormFromSettings(result.security?.twoFactor || {}));
      setLockedAccounts(Array.isArray(result.lockedAccounts) ? result.lockedAccounts : []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
        security: result.security || {},
      });
      setMessage("");
      captchaNotice.success(
        nextEnabledState
          ? "Math captcha is now enabled on the login page."
          : "Math captcha is now disabled on the login page."
      );
    } catch (error) {
      captchaNotice.error(error.response?.data?.message || "Unable to update login security settings.");
    } finally {
      setSecuritySaving(false);
    }
  };

  const handleSaveEmailDomainPolicy = async (policy) => {
    setEmailDomainPolicySaving(true);
    emailDomainPolicyNotice.clear();

    try {
      const result = await saveEmailDomainPolicy(policy);
      const nextPolicy = normalizeEmailDomainPolicy(result.emailDomainPolicy || policy);
      setEmailDomainPolicy(nextPolicy);
      emailDomainPolicyNotice.success("Temp mail blocker settings saved successfully.");
      toast.success("Temp mail blocker settings saved successfully.");
      onSettingsChange?.({
        emailDomainPolicy: nextPolicy,
      });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save temp mail blocker settings.";
      emailDomainPolicyNotice.error(message);
      toast.error(message);
    } finally {
      setEmailDomainPolicySaving(false);
    }
  };

  const updateSecurityPolicyField = (fieldKey) => (event) => {
    setSecurityPolicyForm((current) => ({
      ...current,
      [fieldKey]: event.target.value,
    }));
    setSecurityPolicyErrors((current) => ({ ...current, [fieldKey]: "" }));
    securityPolicyNotice.clear();
  };

  const validateSecurityPolicyForm = () => {
    const nextErrors = {};
    const payload = {};

    securityPolicyFields.forEach((field) => {
      const rawValue = String(securityPolicyForm[field.key] ?? "").trim();

      if (!/^\d+$/.test(rawValue)) {
        nextErrors[field.key] = `${field.label} must be a whole number.`;
        return;
      }

      const value = Number.parseInt(rawValue, 10);

      if (value < field.min || value > field.max) {
        nextErrors[field.key] = `${field.label} must be between ${field.min} and ${field.max}.`;
        return;
      }

      payload[field.key] = value;
    });

    setSecurityPolicyErrors(nextErrors);

    return {
      isValid: Object.keys(nextErrors).length === 0,
      payload,
    };
  };

  const handleSaveSecurityPolicy = async (event) => {
    event.preventDefault();

    const validation = validateSecurityPolicyForm();

    if (!validation.isValid) {
      return;
    }

    setSecurityPolicySaving(true);
    securityPolicyNotice.clear();

    try {
      const result = await saveSecurityPolicySettings(validation.payload);
      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      setSecurityPolicyForm(securityPolicyFormFromSettings(result.security || {}));
      setLoginCaptchaEnabled(result.security?.loginCaptchaEnabled !== false);
      setTwoFactorForm(twoFactorSettingsFormFromSettings(result.security?.twoFactor || {}));
      setLockedAccounts(Array.isArray(result.lockedAccounts) ? result.lockedAccounts : []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
        security: result.security || {},
      });
      setSecurityPolicyErrors({});
      securityPolicyNotice.success("Security settings saved successfully.");
      toast.success("Security settings saved successfully.");
    } catch (error) {
      securityPolicyNotice.error(error.response?.data?.message || "Unable to update security settings.");
    } finally {
      setSecurityPolicySaving(false);
    }
  };

  const updateTwoFactorField = (fieldKey) => (event) => {
    setTwoFactorForm((current) => ({
      ...current,
      [fieldKey]: event.target.value,
    }));
    setTwoFactorErrors((current) => ({ ...current, [fieldKey]: "" }));
    twoFactorNotice.clear();
  };

  const toggleTwoFactorField = (fieldKey) => {
    setTwoFactorForm((current) => {
      const nextValue = !current[fieldKey];

      if (fieldKey === "requireAllUsers" && nextValue) {
        return {
          ...current,
          requireAllUsers: true,
          requireAdmins: false,
          requireHr: false,
          requireManagers: false,
        };
      }

      if (["requireAdmins", "requireHr", "requireManagers"].includes(fieldKey) && nextValue) {
        return {
          ...current,
          requireAllUsers: false,
          [fieldKey]: true,
        };
      }

      return {
        ...current,
        [fieldKey]: nextValue,
      };
    });
    twoFactorNotice.clear();
  };

  const validateTwoFactorForm = () => {
    const nextErrors = {};
    const payload = {
      enabled: Boolean(twoFactorForm.enabled),
      requireAdmins: Boolean(twoFactorForm.requireAdmins),
      requireHr: Boolean(twoFactorForm.requireHr),
      requireManagers: Boolean(twoFactorForm.requireManagers),
      requireAllUsers: Boolean(twoFactorForm.requireAllUsers),
    };

    twoFactorNumberFields.forEach((field) => {
      const rawValue = String(twoFactorForm[field.key] ?? "").trim();

      if (!/^\d+$/.test(rawValue)) {
        nextErrors[field.key] = `${field.label} must be a whole number.`;
        return;
      }

      const value = Number.parseInt(rawValue, 10);

      if (value < field.min || value > field.max) {
        nextErrors[field.key] = `${field.label} must be between ${field.min} and ${field.max}.`;
        return;
      }

      payload[field.key] = value;
    });

    setTwoFactorErrors(nextErrors);

    return {
      isValid: Object.keys(nextErrors).length === 0,
      payload,
    };
  };

  const handleSaveTwoFactor = async (event) => {
    event.preventDefault();

    const validation = validateTwoFactorForm();

    if (!validation.isValid) {
      return;
    }

    setTwoFactorSaving(true);
    twoFactorNotice.clear();

    try {
      const result = await saveTwoFactorSettings(validation.payload);
      const nextTwoFactor = twoFactorSettingsFormFromSettings(result.security?.twoFactor || {});

      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      setTwoFactorForm(nextTwoFactor);
      setTwoFactorErrors({});
      setLockedAccounts(Array.isArray(result.lockedAccounts) ? result.lockedAccounts : []);
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
        security: result.security || {},
      });
      twoFactorNotice.success("Two-factor authentication settings saved successfully.");
      toast.success("Two-factor authentication settings saved successfully.");
    } catch (error) {
      twoFactorNotice.error(error.response?.data?.message || "Unable to update two-factor authentication settings.");
    } finally {
      setTwoFactorSaving(false);
    }
  };

  const updateSystemConfigField = (field) => (event) => {
    setSystemConfigForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
    setSystemConfigErrors((current) => ({ ...current, [field]: "" }));
    systemConfigNotice.clear();
  };

  const updateSystemConfigNestedField = (section, field) => (event) => {
    setSystemConfigForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: event.target.value,
      },
    }));
    setSystemConfigErrors((current) => ({ ...current, [field]: "" }));
    systemConfigNotice.clear();
  };

  const handleToggleSystemWorkDay = (day) => {
    setSystemConfigForm((current) => {
      const selectedDays = new Set(current.workWeek || []);

      if (selectedDays.has(day)) {
        selectedDays.delete(day);
      } else {
        selectedDays.add(day);
      }

      return {
        ...current,
        workWeek: workWeekDays.filter((workDay) => selectedDays.has(workDay)),
      };
    });
    setSystemConfigErrors((current) => ({ ...current, workWeek: "" }));
    systemConfigNotice.clear();
  };

  const handleToggleUndertimeDeduction = (event) => {
    setSystemConfigForm((current) => ({
      ...current,
      undertimeRules: {
        ...current.undertimeRules,
        enabled: event.target.checked,
      },
    }));
    systemConfigNotice.clear();
  };

  const validateSystemConfigurationForm = () => {
    const nextErrors = {};
    const companyName = String(systemConfigForm.companyName || "").trim();
    const companyAddress = String(systemConfigForm.companyAddress || "").trim();
    const developedBy = String(systemConfigForm.developedBy || "").trim();
    const selectedWorkDays = workWeekDays.filter((day) => systemConfigForm.workWeek?.includes(day));

    const parseNumberField = (key, label, value, minimum, maximum, integer = false) => {
      const rawValue = String(value ?? "").trim();

      if (!rawValue) {
        nextErrors[key] = `${label} is required.`;
        return null;
      }

      const parsedValue = Number(rawValue);

      if (!Number.isFinite(parsedValue) || (integer && !Number.isInteger(parsedValue))) {
        nextErrors[key] = `${label} must be a valid number.`;
        return null;
      }

      if (parsedValue < minimum || parsedValue > maximum) {
        nextErrors[key] = `${label} must be between ${minimum} and ${maximum}.`;
        return null;
      }

      return integer ? Math.trunc(parsedValue) : parsedValue;
    };

    if (!companyName) {
      nextErrors.companyName = "Company name is required.";
    }

    if (!companyAddress) {
      nextErrors.companyAddress = "Company address is required.";
    }

    if (!systemProfileOptions.includes(systemConfigForm.systemProfile)) {
      nextErrors.systemProfile = "Select a valid system profile.";
    }

    if (!selectedWorkDays.length) {
      nextErrors.workWeek = "Select at least one work day.";
    }

    const totalWorkHoursPerDay = parseNumberField(
      "totalWorkHoursPerDay",
      "Total work hours",
      systemConfigForm.totalWorkHoursPerDay,
      1,
      24
    );
    const overtimeRules = {
      regularOvertimePercent: parseNumberField(
        "regularOvertimePercent",
        "Regular overtime",
        systemConfigForm.overtimeRules.regularOvertimePercent,
        0,
        500
      ),
      restDayOvertimePercent: parseNumberField(
        "restDayOvertimePercent",
        "Rest day overtime",
        systemConfigForm.overtimeRules.restDayOvertimePercent,
        0,
        500
      ),
      specialHolidayOvertimePercent: parseNumberField(
        "specialHolidayOvertimePercent",
        "Special holiday overtime",
        systemConfigForm.overtimeRules.specialHolidayOvertimePercent,
        0,
        500
      ),
      regularHolidayOvertimePercent: parseNumberField(
        "regularHolidayOvertimePercent",
        "Regular holiday overtime",
        systemConfigForm.overtimeRules.regularHolidayOvertimePercent,
        0,
        500
      ),
    };
    const undertimeRules = {
      enabled: Boolean(systemConfigForm.undertimeRules.enabled),
      gracePeriodMinutes: parseNumberField(
        "gracePeriodMinutes",
        "Undertime grace period",
        systemConfigForm.undertimeRules.gracePeriodMinutes,
        0,
        240,
        true
      ),
      deductionPerHour: parseNumberField(
        "deductionPerHour",
        "Undertime deduction",
        systemConfigForm.undertimeRules.deductionPerHour,
        0,
        999999
      ),
    };

    setSystemConfigErrors(nextErrors);

    return {
      isValid: Object.keys(nextErrors).length === 0,
      payload: {
        companyName,
        companyAddress,
        systemProfile: systemConfigForm.systemProfile,
        developedBy,
        workWeek: selectedWorkDays,
        totalWorkHoursPerDay,
        overtimeRules,
        undertimeRules,
      },
    };
  };

  const handleSaveSystemConfiguration = async (event) => {
    event.preventDefault();

    const validation = validateSystemConfigurationForm();

    if (!validation.isValid) {
      return;
    }

    setSystemConfigSaving(true);
    systemConfigNotice.clear();

    try {
      const result = await saveSystemConfiguration(validation.payload);
      const nextSecurityPolicy = securityPolicyFormFromSettings(result.security || {});
      const nextTwoFactor = twoFactorSettingsFormFromSettings(result.security?.twoFactor || {});
      const nextPermissionTemplates = normalizePermissionTemplates(result.permissions?.templates || {});
      const nextSystemConfiguration = systemConfigurationFormFromSettings(
        result.systemConfiguration || validation.payload
      );

      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      setLoginCaptchaEnabled(result.security?.loginCaptchaEnabled !== false);
      setSecurityPolicyForm(nextSecurityPolicy);
      setTwoFactorForm(nextTwoFactor);
      setPermissionTemplates(nextPermissionTemplates);
      setPermissionUserCounts(result.permissions?.activeUserCounts || {});
      setSystemConfigForm(nextSystemConfiguration);
      setSystemConfigErrors({});
      systemConfigNotice.success("System settings saved successfully.");
      onSettingsChange?.({
        divisions: result.divisions || [],
        designations: result.designations || [],
        security: result.security || {},
        permissions: {
          templates: nextPermissionTemplates,
          activeUserCounts: result.permissions?.activeUserCounts || {},
        },
        systemConfiguration: result.systemConfiguration || validation.payload,
      });
      toast.success("System settings saved successfully.");
    } catch (error) {
      systemConfigNotice.error(error.response?.data?.message || "Unable to save system settings.");
    } finally {
      setSystemConfigSaving(false);
    }
  };

  const applyPermissionSettingsResult = (result) => {
    const nextPermissionTemplates = normalizePermissionTemplates(result.permissions?.templates || {});
    const nextUsers = Array.isArray(result.permissions?.users) ? result.permissions.users : [];
    const nextOverrides = result.permissions?.userOverrides || {};

    setDivisions(result.divisions || []);
    setDesignations(result.designations || []);
    setLoginCaptchaEnabled(result.security?.loginCaptchaEnabled !== false);
    setSecurityPolicyForm(securityPolicyFormFromSettings(result.security || {}));
    setTwoFactorForm(twoFactorSettingsFormFromSettings(result.security?.twoFactor || {}));
    setPermissionTemplates(nextPermissionTemplates);
    setPermissionUserCounts(result.permissions?.activeUserCounts || {});
    setPermissionUsers(nextUsers);
    setPermissionUserOverrides(nextOverrides);
    onSettingsChange?.({
      divisions: result.divisions || [],
      designations: result.designations || [],
      security: result.security || {},
      permissions: {
        templates: nextPermissionTemplates,
        activeUserCounts: result.permissions?.activeUserCounts || {},
        users: nextUsers,
        userOverrides: nextOverrides,
      },
    });

    return { nextPermissionTemplates, nextUsers, nextOverrides };
  };

  const updatePermissionRole = (roleKey, updater) => {
    setPermissionTemplates((current) => {
      const normalizedCurrent = normalizePermissionTemplates(current);
      const currentRole = normalizedCurrent[roleKey];

      return {
        ...normalizedCurrent,
        [roleKey]: updater(currentRole),
      };
    });
    permissionNotice.clear();
  };

  // Apply a template updater to whichever template is currently being edited
  // (a role template or the selected user's draft).
  const applyActivePermissionUpdate = (updater) => {
    if (permissionMode === "user") {
      setUserPermissionDraft((current) => updater(current));
      setPermissionUserDirty(true);
      permissionNotice.clear();
      return;
    }

    updatePermissionRole(selectedPermissionRole, updater);
  };

  const handleToggleActivePermissionEnabled = () => {
    applyActivePermissionUpdate((template) => ({
      ...template,
      enabled: !template.enabled,
    }));
  };

  const handleResetPermissionRole = (roleKey) => {
    const defaults = createDefaultPermissionTemplates();

    setPermissionTemplates((current) => ({
      ...normalizePermissionTemplates(current),
      [roleKey]: defaults[roleKey],
    }));
    setActionPopover(null);
    permissionNotice.clear();
  };

  const handleToggleActivePermissionModule = (moduleKey) => {
    const permissionItem = permissionItems.find((item) => item.key === moduleKey);

    if (!permissionItem) {
      return;
    }

    applyActivePermissionUpdate((template) => {
      const currentModule = template.modules[moduleKey] || { enabled: false, actions: [] };
      const enabled = !currentModule.enabled;

      return {
        ...template,
        modules: {
          ...template.modules,
          [moduleKey]: {
            enabled,
            actions: enabled ? (currentModule.actions?.length ? currentModule.actions : permissionItem.defaultActions) : [],
          },
        },
      };
    });
  };

  const handleToggleActivePermissionAction = (moduleKey, actionKey) => {
    const permissionItem = permissionItems.find((item) => item.key === moduleKey);

    if (!permissionItem || !permissionItem.defaultActions.includes(actionKey)) {
      return;
    }

    applyActivePermissionUpdate((template) => {
      const currentModule = template.modules[moduleKey] || { enabled: false, actions: [] };
      const actionSet = new Set(currentModule.actions || []);

      if (actionSet.has(actionKey)) {
        actionSet.delete(actionKey);
      } else {
        actionSet.add(actionKey);
      }

      const actions = permissionItem.defaultActions.filter((action) => actionSet.has(action));

      return {
        ...template,
        modules: {
          ...template.modules,
          [moduleKey]: {
            enabled: actions.length > 0 || currentModule.enabled,
            actions,
          },
        },
      };
    });
  };

  const handlePermissionModeChange = (modeKey) => {
    setPermissionMode(modeKey);
    setActionPopover(null);
    permissionNotice.clear();
  };

  const handleSelectPermissionRole = (roleKey) => {
    setSelectedPermissionRole(roleKey);
    setActionPopover(null);
  };

  const handleTogglePermissionSection = (scopeKey, sectionTitle) => {
    const sectionKey = `${scopeKey}:${sectionTitle}`;

    setExpandedPermissionSections((current) => ({
      ...current,
      [sectionKey]: !(current[sectionKey] ?? sectionTitle === permissionSections[0]?.title),
    }));
  };

  // Open/close the floating action card anchored to the clicked control.
  const handleToggleActionPopover = (event, moduleKey) => {
    const rowKey = `${permissionMode === "user" ? `user:${selectedPermissionUserId}` : selectedPermissionRole}:${moduleKey}`;

    setActionPopover((current) => {
      if (current?.rowKey === rowKey) {
        return null;
      }

      const rect = event.currentTarget.getBoundingClientRect();

      return {
        rowKey,
        moduleKey,
        top: rect.bottom + 8,
        right: Math.max(16, window.innerWidth - rect.right),
      };
    });
  };

  const selectPermissionUser = (userId) => {
    const user = permissionUsers.find((candidate) => candidate.id === userId);

    setSelectedPermissionUserId(userId);
    setActionPopover(null);
    setUserPermissionDraft(buildUserPermissionDraft(user, permissionTemplates, permissionUserOverrides));
    setPermissionUserDirty(false);
    permissionNotice.clear();
  };

  const handleSavePermissionRole = async (roleKey) => {
    const roleLabel = permissionRoles.find((role) => role.key === roleKey)?.label || "Role";

    setPermissionSavingRole(roleKey);
    permissionNotice.clear();

    try {
      const result = await savePermissionSettings(normalizePermissionTemplates(permissionTemplates));
      applyPermissionSettingsResult(result);
      permissionNotice.success(`${roleLabel} permissions saved successfully.`);
    } catch (error) {
      permissionNotice.error(error.response?.data?.message || "Unable to save permission settings.");
    } finally {
      setPermissionSavingRole("");
    }
  };

  const handleSaveUserPermissions = async () => {
    const user = permissionUsers.find((candidate) => candidate.id === selectedPermissionUserId);

    if (!user) {
      return;
    }

    setPermissionSavingUser(true);
    permissionNotice.clear();

    try {
      const result = await saveUserPermissionSettings(user.id, normalizeSinglePermissionTemplate(userPermissionDraft));
      const { nextOverrides } = applyPermissionSettingsResult(result);
      const savedTemplate = nextOverrides?.[String(user.id)] ?? nextOverrides?.[user.id];

      if (savedTemplate) {
        setUserPermissionDraft(normalizeSinglePermissionTemplate(savedTemplate));
      }

      setPermissionUserDirty(false);
      permissionNotice.success(`Individual permissions saved for ${user.fullName || user.username}.`);
    } catch (error) {
      permissionNotice.error(error.response?.data?.message || "Unable to save user permissions.");
    } finally {
      setPermissionSavingUser(false);
    }
  };

  const handleResetUserPermissions = async () => {
    const user = permissionUsers.find((candidate) => candidate.id === selectedPermissionUserId);

    if (!user) {
      return;
    }

    const hasOverride = Boolean(permissionUserOverrides?.[String(user.id)] ?? permissionUserOverrides?.[user.id]);

    if (!hasOverride) {
      // Nothing stored yet â€” just restore the draft to the role default.
      setUserPermissionDraft(buildUserPermissionDraft(user, permissionTemplates, {}));
      setPermissionUserDirty(false);
      setActionPopover(null);
      permissionNotice.clear();
      return;
    }

    setPermissionSavingUser(true);
    permissionNotice.clear();

    try {
      const result = await resetUserPermissionSettings(user.id);
      const { nextPermissionTemplates } = applyPermissionSettingsResult(result);

      setUserPermissionDraft(buildUserPermissionDraft(user, nextPermissionTemplates, {}));
      setPermissionUserDirty(false);
      setActionPopover(null);
      permissionNotice.success(`${user.fullName || user.username} now inherits the ${user.role || "role"} default.`);
    } catch (error) {
      permissionNotice.error(error.response?.data?.message || "Unable to reset user permissions.");
    } finally {
      setPermissionSavingUser(false);
    }
  };

  const handleAuditDateRangeChange = (event) => {
    setAuditDateRange(event.target.value);
    setAuditPage(1);
  };

  const handleAuditPageSizeChange = (event) => {
    setAuditPageSize(Number(event.target.value));
    setAuditPage(1);
  };

  const handleAuditPreviousPage = () => {
    setAuditPage((currentPage) => Math.max(1, currentPage - 1));
  };

  const handleAuditNextPage = () => {
    setAuditPage((currentPage) => Math.min(auditPagination.totalPages || 1, currentPage + 1));
  };

  const downloadBlob = (result) => {
    const url = window.URL.createObjectURL(result.blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const updateBackupSetting = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setBackupSettings((current) => ({
      ...current,
      [field]: value,
    }));
    backupNotice.clear();
  };

  const handleSaveBackupSettings = async (event) => {
    event.preventDefault();

    if (!String(backupSettings.backupPath || "").trim()) {
      backupNotice.error("Backup file path is required.");
      return;
    }

    const confirmation = await Swal.fire({
      title: "Save Backup Settings?",
      text: "Apply the backup schedule, file path, and backup date/time changes?",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Save Settings",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setBackupSettingsSaving(true);
    backupNotice.clear();

    try {
      const result = await saveBackupSettings(backupSettings);
      setBackupSettings(normalizeBackupSettings(result.settings || {}));
      setBackupHistory(Array.isArray(result.history) ? result.history : []);
      backupNotice.success(result.message || "Backup settings saved successfully.");
      toast.success(result.message || "Backup settings saved successfully.");
    } catch (error) {
      backupNotice.error(error.response?.data?.message || "Unable to save backup settings.");
    } finally {
      setBackupSettingsSaving(false);
    }
  };

  const handleCreateManualBackup = async () => {
    setBackupManualLoading(true);
    backupNotice.clear();
    const toastId = toast.loading("Creating manual backup...");

    try {
      const result = await createManualBackup(backupSettings);
      setBackupSettings(normalizeBackupSettings(result.settings || backupSettings));
      setBackupHistory(Array.isArray(result.history) ? result.history : []);
      backupNotice.success(result.message || "Manual backup created successfully.");
      toast.success(result.message || "Manual backup created successfully.", { id: toastId });
      setAuditPage(1);
      await loadAuditLogs({ page: 1 });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to create manual backup.";
      backupNotice.error(message);
      toast.error(message, { id: toastId });
    } finally {
      setBackupManualLoading(false);
    }
  };

  const handleDownloadBackup = async (record) => {
    if (!record?.id) {
      return;
    }

    setBackupActionId(`download:${record.id}`);
    backupNotice.clear();

    try {
      const result = await downloadBackupRecord(record.id);
      downloadBlob(result);
      backupNotice.success(`Backup downloaded: ${result.filename}`);
      setAuditPage(1);
      await loadAuditLogs({ page: 1 });
    } catch (error) {
      backupNotice.error(error.response?.data?.message || "Unable to download backup file.");
    } finally {
      setBackupActionId("");
    }
  };

  const handleDeleteBackup = async (record) => {
    if (!record?.id) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Delete Backup?",
      text: `Delete ${record.fileName || "this backup file"} from storage?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setBackupActionId(`delete:${record.id}`);
    backupNotice.clear();

    try {
      const result = await deleteBackupRecord(record.id);
      setBackupHistory(Array.isArray(result.history) ? result.history : []);
      setBackupSettings(normalizeBackupSettings(result.settings || backupSettings));
      backupNotice.success(result.message || "Backup deleted successfully.");
      toast.success(result.message || "Backup deleted successfully.");
    } catch (error) {
      backupNotice.error(error.response?.data?.message || "Unable to delete backup.");
    } finally {
      setBackupActionId("");
    }
  };

  const handleUnlockAccount = async (account) => {
    if (!account?.id) {
      return;
    }

    const accountLabel = account.username || account.email || "this account";
    const confirmation = await Swal.fire({
      title: "Unlock Account?",
      text: `Unlock ${accountLabel} and clear failed login attempts?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Unlock",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setUnlockingAccountId(String(account.id));

    try {
      const result = await unlockLockedAccount(account.id);
      setLockedAccounts(Array.isArray(result.lockedAccounts) ? result.lockedAccounts : []);
      setAuditLogs(result.auditLogs || []);
      toast.success(`${accountLabel} unlocked successfully.`);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to unlock account.");
    } finally {
      setUnlockingAccountId("");
    }
  };

  const divisionColumns = [
    {
      key: "name",
      header: "Division Name",
      render: (row) => <span className="font-semibold text-slate-900">{row.name}</span>,
    },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <div>
          <p className="m-0 max-w-[320px] truncate text-sm text-slate-700" title={row.description || "No description provided."}>
            {row.description || "No description provided."}
          </p>
          {row.code ? (
            <p className="m-0 mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
              Code: {row.code}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${organizationStatusClass(row)}`}>
          {organizationRecordIsArchived(row) ? "Archived" : "Active"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => openDivisionModal(row)}>
            Edit
          </Button>
          {organizationRecordIsArchived(row) ? (
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => handleRestoreDivision(row)}>
              Restore
            </Button>
          ) : (
            <Button variant="danger" size="sm" icon={Archive} onClick={() => handleArchiveDivision(row)}>
              Archive
            </Button>
          )}
        </div>
      ),
    },
  ];

  const designationColumns = [
    {
      key: "name",
      header: "Designation Name",
      render: (row) => <span className="font-semibold text-slate-900">{row.name}</span>,
    },
    {
      key: "division_name",
      header: "Assigned Division",
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{row.division_name || "Unassigned"}</p>
          {Number(row.division_is_archived ?? 0) === 1 ? (
            <p className="m-0 mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-amber-600">
              Archived division
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${organizationStatusClass(row)}`}>
          {organizationRecordIsArchived(row) ? "Archived" : "Active"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => openDesignationModal(row)}>
            Edit
          </Button>
          {organizationRecordIsArchived(row) ? (
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCcw}
              onClick={() => handleRestoreDesignation(row)}
              disabled={Number(row.division_is_archived ?? 0) === 1}
            >
              Restore
            </Button>
          ) : (
            <Button variant="danger" size="sm" icon={Archive} onClick={() => handleArchiveDesignation(row)}>
              Archive
            </Button>
          )}
        </div>
      ),
    },
  ];

  const leaveTypeColumns = [
    {
      key: "name",
      header: "Leave Type",
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{row.name}</p>
          {row.description ? (
            <p className="m-0 mt-1 max-w-[320px] truncate text-xs text-slate-500">{row.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "code",
      header: "Code",
      render: (row) => (
        <span className="inline-flex min-h-7 items-center rounded-full bg-slate-100 px-2.5 font-mono text-xs font-semibold text-slate-700">
          {row.code || "N/A"}
        </span>
      ),
    },
    {
      key: "maxDaysPerYear",
      header: "Max Days/Year",
      render: (row) => {
        const value = Number(row.maxDaysPerYear);
        return Number.isFinite(value) && value > 0 ? value.toFixed(2) : "No yearly cap";
      },
    },
    {
      key: "isWithPay",
      header: "With Pay",
      render: (row) => (Number(row.isWithPay) === 1 ? "Yes" : "No"),
    },
    {
      key: "requiresAttachment",
      header: "Attachment",
      render: (row) => (Number(row.requiresAttachment) === 1 ? "Required" : "Not required"),
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
            Number(row.isActive) === 1
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          {Number(row.isActive) === 1 ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  const lockedAccountColumns = [
    {
      key: "account",
      header: "Account",
      render: (row) => {
        const displayName = row.employeeName || row.username || "Unknown account";
        const detail = row.email || row.employeeId || row.username || "N/A";

        return (
          <div>
            <p className="m-0 font-semibold text-slate-900">{displayName}</p>
            <p className="m-0 mt-1 text-xs text-slate-500">{detail}</p>
            {row.division || row.designation ? (
              <p className="m-0 mt-1 max-w-[260px] truncate text-xs text-slate-400">
                {[row.designation, row.division].filter(Boolean).join(" - ")}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "role",
      header: "Role",
      render: (row) => row.role || "N/A",
    },
    {
      key: "failedLoginAttempts",
      header: "Failed Logins",
      render: (row) => (
        <span className="inline-flex min-h-7 items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700">
          {Number(row.failedLoginAttempts) || 0}
        </span>
      ),
    },
    {
      key: "lockedUntil",
      header: "Locked Until",
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{formatBackupDateTime(row.lockedUntil)}</p>
          <p className="m-0 mt-1 text-xs text-slate-500">{formatLockRemaining(row.secondsRemaining)} left</p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          icon={UnlockKeyhole}
          loading={unlockingAccountId === String(row.id)}
          onClick={() => handleUnlockAccount(row)}
        >
          Unlock
        </Button>
      ),
    },
  ];

  const backupHistoryColumns = [
    {
      key: "id",
      header: "Backup ID",
      render: (row) => <span className="font-semibold text-slate-900">{formatBackupId(row)}</span>,
    },
    {
      key: "backupDateTime",
      header: "Backup Date/Time",
      render: (row) => formatBackupDateTime(row.backupDateTime),
    },
    {
      key: "backupType",
      header: "Backup Type",
      render: (row) => row.backupType || "Manual",
    },
    {
      key: "fileName",
      header: "File Name",
      render: (row) => (
        <span className="block max-w-[260px] truncate font-semibold text-slate-900" title={row.fileName || "N/A"}>
          {row.fileName || "N/A"}
        </span>
      ),
    },
    {
      key: "filePath",
      header: "File Path",
      render: (row) => (
        <span className="block max-w-[320px] truncate text-sm text-slate-600" title={row.filePath || "N/A"}>
          {row.filePath || "N/A"}
        </span>
      ),
    },
    {
      key: "fileSize",
      header: "File Size",
      render: (row) => formatFileSize(row.fileSize),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${backupStatusClass(row.status)}`}>
          {row.status || "Completed"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-center",
      cellClassName: "whitespace-nowrap",
      render: (row) => {
        const unavailable = row.status === "Deleted" || row.status === "Failed";

        return (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" icon={Eye} onClick={() => setViewingBackup(row)}>
              View
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              loading={backupActionId === `download:${row.id}`}
              disabled={unavailable}
              onClick={() => handleDownloadBackup(row)}
            >
              Download
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              loading={backupActionId === `delete:${row.id}`}
              disabled={row.status === "Deleted"}
              onClick={() => handleDeleteBackup(row)}
            >
              Delete
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="w-full">
      <header className="mb-5">
        <h1 className="m-0 text-xl font-semibold text-slate-900">Settings</h1>
        <p className="m-0 mt-1 text-sm leading-6 text-slate-500">
          Manage organization setup, access control, and system behaviour.
        </p>
        {message ? (
          <SettingsNotice tone="error" className="mt-3 max-w-3xl">
            {message}
          </SettingsNotice>
        ) : null}
      </header>

      <div className="grid gap-5 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start">
        <SettingsNav
          groups={settingsGroups}
          activeKey={activeTab}
          onSelect={setActiveTab}
          query={sectionQuery}
          onQueryChange={setSectionQuery}
        />

        <div className="min-w-0">
          <div className="mb-4">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {activeSection?.group}
            </p>
            <h2 className="m-0 mt-0.5 text-lg font-semibold text-slate-900">{activeSection?.label}</h2>
            {activeSection?.description ? (
              <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{activeSection.description}</p>
            ) : null}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="transform-gpu"
            >
      {activeTab === "organizationStructure" ? (
        <div className="grid gap-4 2xl:grid-cols-2">
          <SettingsPanel
            icon={Building2}
            title="Divisions"
            description="View, search, archive, and restore divisions."
            actions={
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                {activeDivisions.length} active
              </span>
            }
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <InputField
                name="divisionSearch"
                value={divisionQuery}
                onChange={(event) => {
                  setDivisionQuery(event.target.value);
                  setDivisionPage(1);
                }}
                placeholder="Search divisions"
                icon={Search}
                aria-label="Search divisions"
                className="w-full sm:flex-1"
              />
              <Button icon={Plus} onClick={() => openDivisionModal()}>
                Add Division
              </Button>
            </div>
            <Table
              columns={divisionColumns}
              data={visibleDivisions}
              emptyMessage="No divisions found."
              tableClassName="min-w-[980px]"
              className="mt-4 rounded-lg border border-slate-200"
              stickyHeader
            />
            <div className="mt-4">
              <Pagination
                currentPage={Math.min(divisionPage, divisionTotalPages)}
                totalPages={divisionTotalPages}
                onPageChange={setDivisionPage}
              />
            </div>
          </SettingsPanel>

          <SettingsPanel
            icon={UserRoundCog}
            title="Designations"
            description="View, search, archive, and restore designations while keeping each role linked to a division."
            notice={
              activeDivisions.length === 0 ? "Restore a division before creating a new designation." : ""
            }
            noticeTone="warning"
            actions={
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                {visibleDesignations.length} shown
              </span>
            }
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <InputField
                name="designationSearch"
                value={designationQuery}
                onChange={(event) => {
                  setDesignationQuery(event.target.value);
                  setDesignationPage(1);
                }}
                placeholder="Search designations"
                icon={Search}
                aria-label="Search designations"
                className="w-full sm:flex-1"
              />
              <Button
                icon={Plus}
                onClick={() => openDesignationModal()}
                disabled={activeDivisions.length === 0}
              >
                Add Designation
              </Button>
            </div>
            <Table
              columns={designationColumns}
              data={visibleDesignations}
              emptyMessage="No designations found."
              tableClassName="min-w-[1020px]"
              className="mt-4 rounded-lg border border-slate-200"
              stickyHeader
            />
            <div className="mt-4">
              <Pagination
                currentPage={Math.min(designationPage, designationTotalPages)}
                totalPages={designationTotalPages}
                onPageChange={setDesignationPage}
              />
            </div>
          </SettingsPanel>
        </div>
      ) : null}

      {activeTab === "leaveType" ? (
        <SettingsPanel
          icon={FileText}
          title="Leave Types"
          description="Maintain the leave types available for employee leave requests."
          actions={
            <>
              <InputField
                name="leaveTypeSearch"
                value={leaveTypeQuery}
                onChange={(event) => setLeaveTypeQuery(event.target.value)}
                placeholder="Search leave types"
                icon={Search}
                aria-label="Search leave types"
                className="w-full sm:w-[260px]"
              />
              <Button icon={Plus} onClick={openLeaveTypeModal}>
                Add Leave Type
              </Button>
            </>
          }
        >
          <Table
            columns={leaveTypeColumns}
            data={filteredLeaveTypes}
            rowKey="id"
            emptyMessage="No leave types found."
            tableClassName="min-w-[1120px]"
            className="rounded-lg border border-slate-200"
          />
        </SettingsPanel>
      ) : null}

      {activeTab === "deduction" ? (
        <DeductionSettings
          deductionTypes={deductionTypes}
          categories={deductionCategories}
          allowances={deductionAllowances}
          loading={deductionLoading}
          message={deductionNotice.text}
          messageTone={deductionNotice.tone}
          onAdd={openDeductionModal}
          onEdit={openEditDeductionModal}
          onRefresh={loadDeductionTypes}
        />
      ) : null}

      {activeTab === "captcha" ? (
        <MathCaptchaSettings
          enabled={loginCaptchaEnabled}
          message={captchaNotice.text}
          messageTone={captchaNotice.tone}
          saving={securitySaving}
          onToggle={handleToggleLoginCaptcha}
        />
      ) : null}

      {activeTab === "emailDomainPolicy" ? (
        <EmailDomainPolicySettings
          policy={emailDomainPolicy}
          saving={emailDomainPolicySaving}
          notice={emailDomainPolicyNotice.text}
          noticeTone={emailDomainPolicyNotice.tone}
          onSave={handleSaveEmailDomainPolicy}
        />
      ) : null}

      {activeTab === "permissions" ? (
        <PermissionSettings
          mode={permissionMode}
          onModeChange={handlePermissionModeChange}
          message={permissionNotice.text}
          messageTone={permissionNotice.tone}
          templates={permissionTemplates}
          userCounts={permissionUserCounts}
          selectedRoleKey={selectedPermissionRole}
          onSelectRole={handleSelectPermissionRole}
          savingRole={permissionSavingRole}
          onSaveRole={handleSavePermissionRole}
          onResetRole={handleResetPermissionRole}
          users={permissionUsers}
          userOverrides={permissionUserOverrides}
          userSearch={permissionUserSearch}
          onUserSearchChange={(event) => setPermissionUserSearch(event.target.value)}
          selectedUserId={selectedPermissionUserId}
          onSelectUser={selectPermissionUser}
          userDraft={userPermissionDraft}
          savingUser={permissionSavingUser}
          unsavedUserChanges={permissionUserDirty}
          onSaveUser={handleSaveUserPermissions}
          onResetUser={handleResetUserPermissions}
          expandedSections={expandedPermissionSections}
          onToggleSection={handleTogglePermissionSection}
          actionPopover={actionPopover}
          onToggleActionPopover={handleToggleActionPopover}
          onCloseActionPopover={() => setActionPopover(null)}
          onToggleEnabled={handleToggleActivePermissionEnabled}
          onToggleModule={handleToggleActivePermissionModule}
          onToggleAction={handleToggleActivePermissionAction}
        />
      ) : null}

      {activeTab === "auditLogs" ? (
        <AuditLogsSettings
          logs={auditLogs}
          loading={auditLoading}
          message={auditNotice.text}
          messageTone={auditNotice.tone}
          pagination={auditPagination}
          searchInput={auditSearchInput}
          dateRange={auditDateRange}
          pageSize={auditPageSize}
          onSearchInputChange={(event) => setAuditSearchInput(event.target.value)}
          onDateRangeChange={handleAuditDateRangeChange}
          onPageSizeChange={handleAuditPageSizeChange}
          onRefresh={() => loadAuditLogs()}
          onPreviousPage={handleAuditPreviousPage}
          onNextPage={handleAuditNextPage}
        />
      ) : null}

      {activeTab === "backupData" ? (
        <div className="grid gap-4">
          <SettingsPanel
            icon={Database}
            title="Backup Schedule"
            description="Configure automatic database backups and where the files are written."
            notice={backupNotice.text}
            noticeTone={backupNotice.tone}
            onSubmit={handleSaveBackupSettings}
            actions={
              <Button
                type="button"
                variant="secondary"
                icon={RefreshCw}
                loading={backupDataLoading}
                onClick={loadBackupData}
              >
                Refresh
              </Button>
            }
            footer={
              <Button type="submit" icon={Save} loading={backupSettingsSaving}>
                Save Settings
              </Button>
            }
          >
            <div className="grid gap-4">
              <SettingsRow
                label="Automatic backup"
                description="Run backups on the schedule below without manual action."
                htmlFor="automaticEnabled"
                control={
                  <SettingsCheckbox
                    name="automaticEnabled"
                    label={backupSettings.automaticEnabled ? "Enabled" : "Disabled"}
                    checked={Boolean(backupSettings.automaticEnabled)}
                    onChange={updateBackupSetting("automaticEnabled")}
                  />
                }
              />
              <div className="grid gap-4 lg:grid-cols-[220px_240px_minmax(0,1fr)]">
                <SettingsSelect
                  name="backupSchedule"
                  label="Backup schedule"
                  value={backupSettings.schedule || "daily"}
                  onChange={updateBackupSetting("schedule")}
                  options={backupScheduleOptions}
                  disabled={!backupSettings.automaticEnabled}
                />
                <InputField
                  label="Backup date/time"
                  name="backupDateTime"
                  type="datetime-local"
                  value={backupSettings.backupDateTime || ""}
                  onChange={updateBackupSetting("backupDateTime")}
                />
                <InputField
                  label="Backup file path"
                  name="backupPath"
                  value={backupSettings.backupPath || ""}
                  onChange={updateBackupSetting("backupPath")}
                  placeholder="C:\\xampp\\htdocs\\Capstone2\\backend\\backups"
                  required
                />
              </div>
            </div>
          </SettingsPanel>

          <SettingsPanel
            icon={Archive}
            title="Backup History"
            description="Completed manual and automatic backups with their storage details."
            actions={
              <Button icon={PlayCircle} loading={backupManualLoading} onClick={handleCreateManualBackup}>
                Manual Backup
              </Button>
            }
          >
            <Table
              columns={backupHistoryColumns}
              data={backupHistory}
              rowKey="id"
              emptyMessage={backupDataLoading ? "Loading backup history..." : "No backup history found."}
              stickyHeader
              tableClassName="min-w-[1460px]"
              className="max-h-[620px] rounded-lg border border-slate-200"
            />
          </SettingsPanel>
        </div>
      ) : null}

      {activeTab === "systemConfiguration" ? (
        <SettingsPanel
          icon={Settings2}
          title="System Configuration"
          description="Company identity, work schedule, and the rules payroll uses to value overtime and undertime."
          notice={systemConfigNotice.text}
          noticeTone={systemConfigNotice.tone}
          onSubmit={handleSaveSystemConfiguration}
          footer={
            <Button type="submit" icon={Save} loading={systemConfigSaving}>
              Save System Settings
            </Button>
          }
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsSection title="General" description="Identity shown on printed forms and reports.">
              <div className="grid gap-3">
                <InputField
                  label="Company name"
                  name="companyName"
                  value={systemConfigForm.companyName}
                  onChange={updateSystemConfigField("companyName")}
                  error={systemConfigErrors.companyName}
                />
                <InputField
                  label="Company address"
                  name="companyAddress"
                  value={systemConfigForm.companyAddress}
                  onChange={updateSystemConfigField("companyAddress")}
                  error={systemConfigErrors.companyAddress}
                />
                <SettingsSelect
                  name="systemProfile"
                  label="System profile"
                  value={systemConfigForm.systemProfile}
                  onChange={updateSystemConfigField("systemProfile")}
                  options={systemProfileOptions}
                  error={systemConfigErrors.systemProfile}
                />
                <InputField
                  label="Developed by"
                  name="developedBy"
                  value={systemConfigForm.developedBy}
                  onChange={updateSystemConfigField("developedBy")}
                  error={systemConfigErrors.developedBy}
                />
              </div>
            </SettingsSection>

            <SettingsSection title="Work Schedule" description="Sets the working days and hours attendance is measured against.">
              <div className="grid gap-4">
                <div>
                  <p className="m-0 mb-2 text-sm font-semibold text-slate-700">Work week</p>
                  <div className="flex flex-wrap gap-2">
                    {workWeekDays.map((day) => (
                      <SettingsCheckbox
                        key={day}
                        name={`workWeek-${day}`}
                        label={day}
                        checked={systemConfigForm.workWeek.includes(day)}
                        onChange={() => handleToggleSystemWorkDay(day)}
                      />
                    ))}
                  </div>
                  {systemConfigErrors.workWeek ? (
                    <p className="m-0 mt-1.5 text-xs font-semibold text-rose-700">{systemConfigErrors.workWeek}</p>
                  ) : null}
                </div>
                <SettingsNumberField
                  name="totalWorkHoursPerDay"
                  label="Total work hours"
                  suffix="per day"
                  min="1"
                  max="24"
                  step="0.25"
                  value={systemConfigForm.totalWorkHoursPerDay}
                  onChange={updateSystemConfigField("totalWorkHoursPerDay")}
                  error={systemConfigErrors.totalWorkHoursPerDay}
                />
              </div>
            </SettingsSection>

            <SettingsSection title="Overtime Rules" description="Percentage of the hourly rate paid for each overtime category.">
              <div className="grid gap-3 sm:grid-cols-2">
                {overtimeRuleFields.map((field) => (
                  <SettingsNumberField
                    key={field.key}
                    name={field.key}
                    label={field.label}
                    suffix="%"
                    min="0"
                    max="500"
                    step="0.01"
                    value={systemConfigForm.overtimeRules[field.key]}
                    onChange={updateSystemConfigNestedField("overtimeRules", field.key)}
                    error={systemConfigErrors[field.key]}
                  />
                ))}
              </div>
            </SettingsSection>

            <SettingsSection title="Undertime Rules" description="How short hours are treated when payroll is generated.">
              <div className="grid gap-3">
                <SettingsRow
                  label="Undertime deduction"
                  description="Deduct pay when an employee works fewer than the required hours."
                  htmlFor="undertimeEnabled"
                  control={
                    <SettingsCheckbox
                      name="undertimeEnabled"
                      label={systemConfigForm.undertimeRules.enabled ? "Enabled" : "Disabled"}
                      checked={systemConfigForm.undertimeRules.enabled}
                      onChange={handleToggleUndertimeDeduction}
                    />
                  }
                />
                <SettingsNumberField
                  name="gracePeriodMinutes"
                  label="Grace period"
                  suffix="minutes"
                  min="0"
                  max="240"
                  step="1"
                  value={systemConfigForm.undertimeRules.gracePeriodMinutes}
                  onChange={updateSystemConfigNestedField("undertimeRules", "gracePeriodMinutes")}
                  error={systemConfigErrors.gracePeriodMinutes}
                  disabled={!systemConfigForm.undertimeRules.enabled}
                />
                <SettingsNumberField
                  name="deductionPerHour"
                  label="Deduction"
                  suffix="per hour"
                  min="0"
                  step="0.01"
                  value={systemConfigForm.undertimeRules.deductionPerHour}
                  onChange={updateSystemConfigNestedField("undertimeRules", "deductionPerHour")}
                  error={systemConfigErrors.deductionPerHour}
                  disabled={!systemConfigForm.undertimeRules.enabled}
                />
              </div>
            </SettingsSection>
          </div>
        </SettingsPanel>
      ) : null}

      {activeTab === "securitySettings" ? (
        <div className="grid gap-4">
          <SettingsPanel
            icon={LockKeyhole}
            title="Password & Session Policy"
            description="Configure password strength, session timeout, and account lockout rules."
            notice={securityPolicyNotice.text}
            noticeTone={securityPolicyNotice.tone}
            onSubmit={handleSaveSecurityPolicy}
            footer={
              <Button type="submit" icon={Save} loading={securityPolicySaving}>
                Save Settings
              </Button>
            }
          >
            <div className="grid gap-3">
              {securityPolicyFields.map((field) => (
                <SettingsRow
                  key={field.key}
                  label={field.label}
                  description={field.helper}
                  htmlFor={field.key}
                  error={securityPolicyErrors[field.key]}
                  control={
                    <SettingsNumberField
                      name={field.key}
                      min={field.min}
                      max={field.max}
                      step="1"
                      value={securityPolicyForm[field.key] ?? ""}
                      onChange={updateSecurityPolicyField(field.key)}
                      invalid={Boolean(securityPolicyErrors[field.key])}
                      className="w-full sm:w-[170px]"
                    />
                  }
                />
              ))}
            </div>
          </SettingsPanel>

          <TwoFactorAuthenticationSettings
            errors={twoFactorErrors}
            form={twoFactorForm}
            message={twoFactorNotice.text}
            messageTone={twoFactorNotice.tone}
            saving={twoFactorSaving}
            onFieldChange={updateTwoFactorField}
            onSave={handleSaveTwoFactor}
            onToggle={toggleTwoFactorField}
          />

          <SettingsPanel
            icon={UnlockKeyhole}
            title="Locked Accounts"
            description="Accounts appear here only while failed login attempts have locked them."
            actions={
              <>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {lockedAccounts.length} locked
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={RefreshCw}
                  loading={securityPolicySaving}
                  onClick={loadSettings}
                >
                  Refresh
                </Button>
              </>
            }
          >
            <Table
              columns={lockedAccountColumns}
              data={lockedAccounts}
              emptyMessage="No accounts are currently locked from failed logins."
              className="rounded-lg border border-slate-200"
            />
          </SettingsPanel>
        </div>
      ) : null}

      {activeTab === "rateLimiting" ? <RateLimitSettings /> : null}

      {activeTab === "roles" ? <RoleSettings /> : null}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <Modal
        open={Boolean(viewingBackup)}
        title="Backup Details"
        onClose={() => setViewingBackup(null)}
        maxWidth="max-w-2xl"
        footer={<Button variant="secondary" onClick={() => setViewingBackup(null)}>Close</Button>}
      >
        {viewingBackup ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-slate-500">Backup ID</dt>
              <dd className="m-0 mt-1 font-semibold text-slate-950">{formatBackupId(viewingBackup)}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Status</dt>
              <dd className="m-0 mt-1">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${backupStatusClass(viewingBackup.status)}`}>
                  {viewingBackup.status || "Completed"}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Backup Date/Time</dt>
              <dd className="m-0 mt-1 text-slate-950">{formatBackupDateTime(viewingBackup.backupDateTime)}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Backup Type</dt>
              <dd className="m-0 mt-1 text-slate-950">{viewingBackup.backupType || "Manual"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">File Name</dt>
              <dd className="m-0 mt-1 break-words text-slate-950">{viewingBackup.fileName || "N/A"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">File Size</dt>
              <dd className="m-0 mt-1 text-slate-950">{formatFileSize(viewingBackup.fileSize)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-semibold text-slate-500">File Path</dt>
              <dd className="m-0 mt-1 break-words text-slate-950">{viewingBackup.filePath || "N/A"}</dd>
            </div>
            {viewingBackup.errorMessage ? (
              <div className="sm:col-span-2">
                <dt className="text-sm font-semibold text-slate-500">Error</dt>
                <dd className="m-0 mt-1 break-words text-rose-700">{viewingBackup.errorMessage}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>

      <DeductionModal
        open={deductionModalOpen}
        groupKey={deductionGroupKey}
        categories={deductionCategories}
        mode={editingDeduction ? "edit" : "add"}
        form={deductionDefinitionForm}
        errors={errors}
        saving={deductionSaving}
        onFieldChange={updateDeductionDefinitionField}
        onClose={() => {
          setDeductionModalOpen(false);
          setEditingDeduction(null);
        }}
        onSubmit={handleSaveDeductionType}
      />

      <Modal
        open={leaveTypeModalOpen}
        title="Add Leave Type"
        onClose={() => setLeaveTypeModalOpen(false)}
      >
        <form className="grid gap-5" onSubmit={handleSaveLeaveType}>
          <InputField
            label="Leave Type Name"
            name="leaveTypeName"
            value={leaveTypeName}
            onChange={(event) => {
              setLeaveTypeName(event.target.value);
              setErrors((current) => ({ ...current, leaveTypeName: "" }));
            }}
            placeholder="Enter leave type name"
            error={errors.leaveTypeName}
          />
          <InputField
            label="Code"
            name="leaveTypeCode"
            value={leaveTypeCode}
            onChange={(event) => {
              setLeaveTypeCode(event.target.value.toUpperCase());
              setErrors((current) => ({ ...current, leaveTypeCode: "" }));
            }}
            placeholder="Auto-generated if blank"
            error={errors.leaveTypeCode}
          />
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button type="button" variant="ghost" onClick={() => setLeaveTypeModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Leave Type
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={divisionModalOpen}
        title={editingDivision ? "Edit Division" : "Add Division"}
        onClose={() => setDivisionModalOpen(false)}
      >
        <form className="grid gap-5" onSubmit={handleSaveDivision}>
          <InputField
            label="Division Name"
            name="divisionName"
            value={divisionName}
            onChange={(event) => {
              setDivisionName(event.target.value);
              setErrors((current) => ({ ...current, divisionName: "" }));
            }}
            placeholder="Enter division name"
            error={errors.divisionName}
          />
          <div>
            <label htmlFor="divisionDescription" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Description
            </label>
            <textarea
              id="divisionDescription"
              name="divisionDescription"
              value={divisionDescription}
              onChange={(event) => {
                setDivisionDescription(event.target.value);
              }}
              placeholder="Describe the division's purpose or coverage"
              rows={4}
              className="min-h-[110px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
            />
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button type="button" variant="ghost" onClick={() => setDivisionModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editingDivision ? "Save Changes" : "Save Division"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={designationModalOpen}
        title={editingDesignation ? "Edit Designation" : "Add Designation"}
        onClose={() => setDesignationModalOpen(false)}
      >
        <form className="grid gap-5" onSubmit={handleSaveDesignation}>
          <InputField
            label="Designation Name"
            name="designationName"
            value={designationName}
            onChange={(event) => {
              setDesignationName(event.target.value);
              setErrors((current) => ({ ...current, designationName: "" }));
            }}
            placeholder="Enter designation name"
            error={errors.designationName}
          />
          <div>
            <label htmlFor="designationDivisionId" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Division
            </label>
            <select
              id="designationDivisionId"
              value={designationDivisionId}
              onChange={(event) => {
                setDesignationDivisionId(event.target.value);
                setErrors((current) => ({ ...current, designationDivisionId: "" }));
              }}
            className={`min-h-[46px] w-full rounded-lg border bg-white px-3.5 py-3 text-slate-900 outline-none focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 ${
                errors.designationDivisionId ? "border-rose-600" : "border-slate-200"
              }`}
            >
              <option value="">Select division</option>
              {editableDesignationDivisionOptions.map((division) => {
                const archived = organizationRecordIsArchived(division);
                const isCurrentSelection = String(division.id) === String(designationDivisionId || "");

                return (
                  <option
                    key={division.id}
                    value={division.id}
                    disabled={archived && !isCurrentSelection}
                  >
                    {division.name}{archived ? " (Archived)" : ""}
                  </option>
                );
              })}
            </select>
            {editableDesignationDivisionOptions.length === 0 ? (
              <p className="mt-1.5 text-sm text-amber-700">
                Restore a division before creating or editing a designation.
              </p>
            ) : null}
            {editingDesignation && Number(
              editableDesignationDivisionOptions.find(
                (division) => String(division.id) === String(designationDivisionId || "")
              )?.is_archived ?? 0
            ) === 1 ? (
              <p className="mt-1.5 text-sm text-amber-700">
                This designation is currently assigned to an archived division. Select an active division before saving.
              </p>
            ) : null}
            {errors.designationDivisionId ? (
              <p className="mt-1.5 text-sm text-rose-700">{errors.designationDivisionId}</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button type="button" variant="ghost" onClick={() => setDesignationModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editingDesignation ? "Save Changes" : "Save Designation"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
