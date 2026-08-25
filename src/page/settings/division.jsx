import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Building2,
  ClipboardList,
  Database,
  FileText,
  Gauge,
  KeyRound,
  Layers,
  LockKeyhole,
  MailX,
  Pencil,
  PenLine,
  Palette,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  RotateCcw,
  UserRoundCog,
  Users,
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
  getLockedAccounts,
  getRoles,
  getSettings,
  saveBackupSettings,
  savePermissionSettings,
  saveUiPreference,
  saveUserPermissionSettings,
  resetUserPermissionSettings,
  saveDesignation,
  saveDivision,
  saveLeaveType,
  saveRateLimitSettings,
  savePayrollSignatories,
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
import BackupDataSettings, {
  defaultBackupSettings,
  normalizeBackupSettings,
} from "./backup_data";
import LeaveTypeSettings, { LeaveTypeModal } from "./leavetypes";
import LockAttemptSettings from "./lockattempt";
import AuditLogsSettings, { defaultAuditPagination } from "./auditlogs";
import RoleSettings from "./roles";
import MathCaptchaSettings from "./math_captcha";
import RateLimitSettings, { defaultRateLimitSettings } from "./rate_limiting";
import PayrollSignatorySettings from "./payroll_signatories";
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
import PreferencesSettings from "./preferences";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  applyUiThemeColor,
  DEFAULT_UI_THEME_COLOR,
  getActiveUiThemeColor,
  getStoredUiThemeColor,
  normalizeUiThemeColor,
} from "../../components/theme/systemTheme";

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
      {
        key: "payrollSignatories",
        label: "Payroll Signatories",
        icon: PenLine,
        description: "Who certifies, approves and pays a payroll",
        keywords: ["signatory", "signature", "certified", "payroll", "register", "approve", "cashier", "director", "chief"],
      },
    ],
  },
  {
    label: "Access & Security",
    items: [
      {
        key: "users",
        label: "Users",
        icon: Users,
        description: "Create users and review their assigned roles",
        keywords: ["user", "employee", "account", "add", "create", "role", "employee id"],
      },
      {
        key: "roles",
        label: "Create New Role",
        icon: Layers,
        description: "Create custom roles and choose their modules",
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
        key: "rateLimiting",
        label: "Rate Limiting",
        icon: Gauge,
        description: "Request limits for sign-in, codes, and the API",
        keywords: ["rate", "limit", "throttle", "brute", "force", "flood", "abuse", "429", "requests", "block"],
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
    ],
  },
  {
    label: "System",
    items: [
      {
        key: "preferences",
        label: "Preferences",
        icon: Palette,
        description: "Interface color and appearance",
        keywords: ["preference", "appearance", "theme", "color", "sidebar", "button", "card", "ui"],
      },
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

// `roles.php` returns both fixed and administrator-created roles.  Keep the fixed
// definitions as a fallback so the Permissions page remains usable if that request
// is temporarily unavailable, but use the server's labels and custom metadata when
// it is available.
function permissionRoleOptionsFromApi(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    return permissionRoles;
  }

  const byKey = new Map(
    roles
      .filter((role) => role && role.key)
      .map((role) => [role.key, role])
  );
  const builtIn = permissionRoles.map((role) => ({
    ...role,
    ...(byKey.get(role.key) || {}),
  }));
  const custom = roles.filter((role) => role?.key && !permissionRoles.some((builtInRole) => builtInRole.key === role.key));

  return [...builtIn, ...custom];
}

const organizationRowsPerPage = 8;

const workWeekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const systemProfileOptions = ["Production", "Staging", "Development"];

const defaultSystemConfiguration = {
  companyName: "Human Resources Information System",
  companyAddress: "Mines Geosciences Bureau, DENR Region X",
  uiThemeColor: DEFAULT_UI_THEME_COLOR,
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
    // Saving this form writes the interface color back with everything else, so a payload that
    // carries no color has to fall back to the one in use -- falling back to the crimson default
    // would turn an unrelated save of, say, the company name into a reset of the interface color.
    uiThemeColor: normalizeUiThemeColor(settings.uiThemeColor, getStoredUiThemeColor()),
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

function organizationRecordIsArchived(record = {}) {
  return Number(record.is_archived ?? record.isArchived ?? 0) === 1;
}

function organizationStatusClass(record = {}) {
  return organizationRecordIsArchived(record)
    ? "border-slate-200 bg-slate-100 text-slate-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function DivisionSettings({ onSettingsChange, renderUsersSection }) {
  const [activeTab, setActiveTab] = useState("organizationStructure");
  const [sectionQuery, setSectionQuery] = useState("");
  const activeSection = settingsSections.find((section) => section.key === activeTab);
  const ActiveSectionIcon = activeSection?.icon || Settings2;
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
  // The rules and their accepted ranges are described by the server, so the section renders nothing
  // until the settings payload arrives.
  const [rateLimitSettings, setRateLimitSettings] = useState(defaultRateLimitSettings);
  const [rateLimitRules, setRateLimitRules] = useState([]);
  const [rateLimitSaving, setRateLimitSaving] = useState(false);
  const rateLimitNotice = useSettingsNotice();
  const [payrollSignatorySlots, setPayrollSignatorySlots] = useState([]);
  const [payrollSignatoryEmployees, setPayrollSignatoryEmployees] = useState([]);
  const [payrollSignatorySaving, setPayrollSignatorySaving] = useState(false);
  const payrollSignatoryNotice = useSettingsNotice();
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
  const [uiThemeColor, setUiThemeColor] = useState(DEFAULT_UI_THEME_COLOR);
  const [uiPreferenceSaving, setUiPreferenceSaving] = useState(false);
  const uiPreferenceNotice = useSettingsNotice();
  const [permissionTemplates, setPermissionTemplates] = useState(() => createDefaultPermissionTemplates());
  const [permissionRoleOptions, setPermissionRoleOptions] = useState(permissionRoles);
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

  const loadSettings = useCallback(async () => {
    try {
      // Roles are fetched beside the settings payload because the latter contains
      // permission templates but no display metadata for administrator-created roles.
      // A failed role lookup must not make the rest of Settings unusable.
      const [result, rolesResult] = await Promise.all([
        getSettings(),
        getRoles().catch(() => null),
      ]);
      const nextSecurityPolicy = securityPolicyFormFromSettings(result.security || {});
      const nextTwoFactor = twoFactorSettingsFormFromSettings(result.security?.twoFactor || {});
      const nextPermissionTemplates = normalizePermissionTemplates(result.permissions?.templates || {});
      const nextPermissionRoleOptions = permissionRoleOptionsFromApi(rolesResult?.roles);
      const nextSystemConfiguration = systemConfigurationFormFromSettings(result.systemConfiguration || {});
      const nextEmailDomainPolicy = normalizeEmailDomainPolicy(result.emailDomainPolicy || {});
      // Opening Settings must not repaint the interface. This screen used to apply the stored color
      // on every load, so arriving here -- from the sidebar or the Settings item in the account
      // menu -- threw away the color on screen and put the previous one back. It also fell through
      // to the crimson default whenever the payload carried no color at all, and persisted it.
      //
      // `paintedUiThemeColor` is what the administrator is looking at; it differs from the stored
      // color only while a pick in Preferences is still unsaved. Keep that pick, and only paint
      // when this tab is genuinely behind another administrator's save.
      const paintedUiThemeColor = getActiveUiThemeColor();
      const storedUiThemeColor = getStoredUiThemeColor();
      const savedUiThemeColor = normalizeUiThemeColor(
        result.systemConfiguration?.uiThemeColor,
        storedUiThemeColor
      );
      const hasUnsavedUiThemeColor = paintedUiThemeColor !== storedUiThemeColor;
      const nextUiThemeColor = hasUnsavedUiThemeColor ? paintedUiThemeColor : savedUiThemeColor;

      setDivisions(result.divisions || []);
      setDesignations(result.designations || []);
      setLeaveTypes(result.leaveTypes || []);
      setDivisionPage(1);
      setDesignationPage(1);
      setLoginCaptchaEnabled(result.security?.loginCaptchaEnabled !== false);
      setEmailDomainPolicy(nextEmailDomainPolicy);
      emailDomainPolicyNotice.clear();
      setRateLimitSettings(result.rateLimit?.settings || defaultRateLimitSettings);
      setRateLimitRules(Array.isArray(result.rateLimit?.rules) ? result.rateLimit.rules : []);
      setPayrollSignatorySlots(Array.isArray(result.payrollSignatories?.slots) ? result.payrollSignatories.slots : []);
      setPayrollSignatoryEmployees(
        Array.isArray(result.payrollSignatories?.employees) ? result.payrollSignatories.employees : []
      );
      setLockedAccounts(Array.isArray(result.lockedAccounts) ? result.lockedAccounts : []);
      setSecurityPolicyForm(nextSecurityPolicy);
      setSecurityPolicyErrors({});
      setTwoFactorForm(nextTwoFactor);
      setTwoFactorErrors({});
      twoFactorNotice.clear();
      setSystemConfigForm(nextSystemConfiguration);
      setUiThemeColor(nextUiThemeColor);

      if (nextUiThemeColor !== paintedUiThemeColor) {
        applyUiThemeColor(nextUiThemeColor, { persist: true });
      }

      setSystemConfigErrors({});
      systemConfigNotice.clear();
      setPermissionTemplates(nextPermissionTemplates);
      setPermissionRoleOptions(nextPermissionRoleOptions);
      setSelectedPermissionRole((currentRoleKey) => (
        nextPermissionRoleOptions.some((role) => role.key === currentRoleKey)
          ? currentRoleKey
          : (nextPermissionRoleOptions[0]?.key || permissionRoles[0]?.key || "admin")
      ));
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
        roles: nextPermissionRoleOptions,
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

  /*
   * Deliberately not `loadSettings`. That re-seeds every form on this screen from the server, so
   * running it in the background would wipe a half-typed security policy, clear the notices and reset
   * the division pagination under an admin who is mid-edit. Somebody else's account locking has no
   * business touching anything but this one list.
   */
  const refreshLockedAccounts = useCallback(async () => {
    try {
      const result = await getLockedAccounts();
      setLockedAccounts(Array.isArray(result.lockedAccounts) ? result.lockedAccounts : []);
    } catch {
      // Leave the list as it stands; the next event and the panel's Refresh button both retry.
    }
  }, []);

  /*
   * `locked_accounts` moves when login.php locks or releases an account on some other machine, which
   * is the whole reason this cannot be left to the browser's own tab-to-tab sync. The unset interval
   * is the house convention and doubles as the answer to the one transition no topic can see: a lock
   * reaching its expiry writes nothing, so the row leaves the list on the next timed pass instead.
   */
  useAutoRefreshOnChange(refreshLockedAccounts, {
    topic: "locked_accounts",
    refreshOnMount: false,
  });

  /*
   * Sign-in events, for the tab that lists them. Gated on the tab being open so a busy login screen
   * is not re-running the audit query for an admin who is looking at Divisions, and wrapped so the
   * hook's `{ background, reason }` argument cannot reach `loadAuditLogs`, whose first parameter is
   * a set of query overrides. Calling it bare keeps the admin's current filters and page.
   */
  useAutoRefreshOnChange(() => loadAuditLogs(), {
    topic: "auth_activity",
    enabled: activeTab === "auditLogs",
    refreshOnMount: false,
  });

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

  /*
   * Every rate limiting write answers with the whole settings payload, the same as the other
   * sections, so the counters on screen are refreshed by the save itself rather than by a second
   * request behind it.
   */
  const applyRateLimitResult = (result) => {
    setRateLimitSettings(result.rateLimit?.settings || defaultRateLimitSettings);
    setRateLimitRules(Array.isArray(result.rateLimit?.rules) ? result.rateLimit.rules : []);
  };

  const handleSaveRateLimitSettings = async (payload) => {
    setRateLimitSaving(true);
    rateLimitNotice.clear();

    try {
      const result = await saveRateLimitSettings(payload);
      applyRateLimitResult(result);
      rateLimitNotice.success("Rate limiting settings saved successfully.");
      toast.success("Rate limiting settings saved successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save rate limiting settings.";
      rateLimitNotice.error(message);
      toast.error(message);
    } finally {
      setRateLimitSaving(false);
    }
  };

  const handleSavePayrollSignatories = async (signatories) => {
    setPayrollSignatorySaving(true);
    payrollSignatoryNotice.clear();

    try {
      const result = await savePayrollSignatories(signatories);
      setPayrollSignatorySlots(Array.isArray(result.payrollSignatories?.slots) ? result.payrollSignatories.slots : []);
      setPayrollSignatoryEmployees(
        Array.isArray(result.payrollSignatories?.employees) ? result.payrollSignatories.employees : []
      );
      payrollSignatoryNotice.success("Payroll signatories saved successfully.");
      toast.success("Payroll signatories saved successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save payroll signatories.";
      payrollSignatoryNotice.error(message);
      toast.error(message);
    } finally {
      setPayrollSignatorySaving(false);
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
        // Kept in this payload so saving work-schedule settings cannot overwrite a color selected
        // from Preferences in a previous visit.
        uiThemeColor: normalizeUiThemeColor(systemConfigForm.uiThemeColor),
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
      // Saving this tab writes the whole configuration back, interface color included, so the color
      // it returns is applied. A response that omits it keeps the color already on screen rather
      // than dropping the administrator back to the crimson default.
      const nextUiThemeColor = normalizeUiThemeColor(
        result.systemConfiguration?.uiThemeColor,
        getActiveUiThemeColor()
      );
      setUiThemeColor(nextUiThemeColor);
      applyUiThemeColor(nextUiThemeColor, { persist: true });
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

  const handleRolesChanged = useCallback((result, { createdRoleKey = "" } = {}) => {
    const nextRoleOptions = permissionRoleOptionsFromApi(result?.roles);
    const hasTemplates = Boolean(result && Object.prototype.hasOwnProperty.call(result, "templates"));
    const nextPermissionTemplates = hasTemplates
      ? normalizePermissionTemplates(result.templates || {})
      : null;
    const nextUserCounts = nextRoleOptions.reduce((counts, role) => {
      counts[role.key] = Number(role.userCount || 0);
      return counts;
    }, {});
    const createdRole = nextRoleOptions.find((role) => role.key === createdRoleKey) || null;

    setPermissionRoleOptions(nextRoleOptions);
    setPermissionUserCounts((current) => ({ ...current, ...nextUserCounts }));

    if (nextPermissionTemplates) {
      setPermissionTemplates(nextPermissionTemplates);
    }

    setSelectedPermissionRole((currentRoleKey) => {
      if (createdRole) {
        return createdRole.key;
      }

      return nextRoleOptions.some((role) => role.key === currentRoleKey)
        ? currentRoleKey
        : (nextRoleOptions[0]?.key || permissionRoles[0]?.key || "admin");
    });

    onSettingsChange?.({
      roles: nextRoleOptions,
      ...(nextPermissionTemplates ? { permissions: { templates: nextPermissionTemplates } } : {}),
    });

    if (createdRole) {
      // The new template is already saved with the role.  Take the administrator
      // straight to the normal permission editor, with that role selected, so any
      // finer action-level adjustments are immediately available.
      setPermissionMode("role");
      setActionPopover(null);
      setActiveTab("permissions");
      permissionNotice.success(`${createdRole.label || "New role"} was created. You can now review its permissions.`);
    }
  }, [onSettingsChange, permissionNotice]);

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

  const defaultPermissionTemplateForRole = (roleKey, sourceTemplates = permissionTemplates) => {
    const builtInDefaults = createDefaultPermissionTemplates();

    if (builtInDefaults[roleKey]) {
      return normalizeSinglePermissionTemplate(builtInDefaults[roleKey]);
    }

    const baseRoleKey = permissionRoleOptions.find((role) => role.key === roleKey)?.baseRole;

    return normalizeSinglePermissionTemplate(
      sourceTemplates?.[baseRoleKey]
      || builtInDefaults[baseRoleKey]
      || {}
    );
  };

  const handleUiThemeColorChange = (nextColor) => {
    const normalizedColor = normalizeUiThemeColor(nextColor);
    setUiThemeColor(normalizedColor);
    applyUiThemeColor(normalizedColor, { persist: false });
    uiPreferenceNotice.clear();
  };

  const handleSaveUiPreference = async (event) => {
    event.preventDefault();

    setUiPreferenceSaving(true);
    uiPreferenceNotice.clear();

    try {
      const result = await saveUiPreference(uiThemeColor);
      const nextColor = normalizeUiThemeColor(result.systemConfiguration?.uiThemeColor || uiThemeColor);

      setUiThemeColor(nextColor);
      setSystemConfigForm((current) => ({ ...current, uiThemeColor: nextColor }));
      applyUiThemeColor(nextColor, { persist: true });
      uiPreferenceNotice.success("Interface color saved for every module.");
      onSettingsChange?.({
        systemConfiguration: result.systemConfiguration || { uiThemeColor: nextColor },
      });
      toast.success("Interface color saved successfully.");
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save the interface color.";
      uiPreferenceNotice.error(message);
      toast.error(message);
    } finally {
      setUiPreferenceSaving(false);
    }
  };

  const updatePermissionRole = (roleKey, updater) => {
    setPermissionTemplates((current) => {
      const normalizedCurrent = normalizePermissionTemplates(current);
      const currentRole = normalizedCurrent[roleKey]
        || defaultPermissionTemplateForRole(roleKey, normalizedCurrent);

      return {
        ...normalizedCurrent,
        [roleKey]: normalizeSinglePermissionTemplate(updater(currentRole)),
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
    setPermissionTemplates((current) => {
      const normalizedCurrent = normalizePermissionTemplates(current);

      return {
        ...normalizedCurrent,
        [roleKey]: defaultPermissionTemplateForRole(roleKey, normalizedCurrent),
      };
    });
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
    // React clears currentTarget once the click handler returns. Capture the position now,
    // before the state updater runs, otherwise opening an action checklist can throw when
    // it tries to call getBoundingClientRect() on null.
    const triggerRect = event.currentTarget?.getBoundingClientRect?.();

    if (!triggerRect) {
      return;
    }

    const popoverTop = triggerRect.bottom + 8;
    const popoverRight = Math.max(16, window.innerWidth - triggerRect.right);

    setActionPopover((current) => {
      if (current?.rowKey === rowKey) {
        return null;
      }

      return {
        rowKey,
        moduleKey,
        top: popoverTop,
        right: popoverRight,
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
    const roleLabel = permissionRoleOptions.find((role) => role.key === roleKey)?.label || "Role";

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

  /*
   * `cardRole` / `cardFull` lay these columns out as cards below `lg`, the way every record table
   * in the app now does — see `components/UI/table.jsx`.
   */
  const divisionColumns = [
    {
      key: "name",
      header: "Division Name",
      cardRole: "title",
      render: (row) => <span className="font-semibold text-slate-900">{row.name}</span>,
    },
    {
      key: "description",
      header: "Description",
      cardFull: true,
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
      cardRole: "badge",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${organizationStatusClass(row)}`}>
          {organizationRecordIsArchived(row) ? "Archived" : "Active"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
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
      cardRole: "title",
      render: (row) => <span className="font-semibold text-slate-900">{row.name}</span>,
    },
    {
      key: "division_name",
      header: "Assigned Division",
      cardRole: "subtitle",
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
      cardRole: "badge",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${organizationStatusClass(row)}`}>
          {organizationRecordIsArchived(row) ? "Archived" : "Active"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
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
          <div className="relative mb-4 overflow-hidden rounded-[20px] border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.65)] sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-indigo-100/80 blur-3xl" aria-hidden="true" />
            <div className="relative flex min-w-0 items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-sky-500 text-white shadow-sm shadow-indigo-200">
                <ActiveSectionIcon size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">
                  {activeSection?.group}
                </p>
                <h2 className="m-0 mt-1 text-xl font-bold tracking-tight text-slate-950">{activeSection?.label}</h2>
                {activeSection?.description ? (
                  <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{activeSection.description}</p>
                ) : null}
              </div>
            </div>
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
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-4">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">Active divisions</p>
              <p className="m-0 mt-1 text-2xl font-bold tracking-tight text-slate-950">{activeDivisions.length}</p>
              <p className="m-0 mt-1 text-xs leading-5 text-slate-500">Operational units in your organization</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-600">Designations</p>
              <p className="m-0 mt-1 text-2xl font-bold tracking-tight text-slate-950">{designations.length}</p>
              <p className="m-0 mt-1 text-xs leading-5 text-slate-500">Role titles linked to divisions</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Directory health</p>
              <p className="m-0 mt-1 text-2xl font-bold tracking-tight text-slate-950">Ready</p>
              <p className="m-0 mt-1 text-xs leading-5 text-slate-500">Structure is ready for employee assignments</p>
            </div>
          </div>

          <div className="grid gap-4 2xl:grid-cols-2">
          <SettingsPanel
            icon={Building2}
            title="Divisions"
            description="View, search, archive, and restore divisions."
            className="border-indigo-100"
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
              cardsClassName="mt-4 lg:hidden"
              tableWrapperClassName="hidden lg:block"
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
            className="border-sky-100"
            /*
             * "Restore" only makes sense when there is something archived to restore. An empty list
             * means either a fresh database or a settings load that failed, and telling an
             * administrator to restore a division they never had sends them looking in the wrong
             * place entirely.
             */
            notice={
              activeDivisions.length > 0
                ? ""
                : divisions.length === 0
                  ? "No divisions are available. Add one first — every designation belongs to a division."
                  : "Restore a division before creating a new designation."
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
              cardsClassName="mt-4 lg:hidden"
              tableWrapperClassName="hidden lg:block"
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
        </div>
      ) : null}

      {activeTab === "users" ? (
        renderUsersSection?.() || (
          <SettingsNotice tone="error">
            User management is unavailable. Refresh the page and try again.
          </SettingsNotice>
        )
      ) : null}

      {activeTab === "leaveType" ? (
        <LeaveTypeSettings
          leaveTypes={leaveTypes}
          query={leaveTypeQuery}
          onQueryChange={(event) => setLeaveTypeQuery(event.target.value)}
          onAdd={openLeaveTypeModal}
        />
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

      {activeTab === "payrollSignatories" ? (
        <PayrollSignatorySettings
          slots={payrollSignatorySlots}
          employees={payrollSignatoryEmployees}
          saving={payrollSignatorySaving}
          notice={payrollSignatoryNotice.text}
          noticeTone={payrollSignatoryNotice.tone}
          onSave={handleSavePayrollSignatories}
        />
      ) : null}

      {activeTab === "rateLimiting" ? (
        <RateLimitSettings
          settings={rateLimitSettings}
          rules={rateLimitRules}
          saving={rateLimitSaving}
          notice={rateLimitNotice.text}
          noticeTone={rateLimitNotice.tone}
          onSave={handleSaveRateLimitSettings}
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

      {activeTab === "roles" ? (
        <RoleSettings onRolesChanged={handleRolesChanged} />
      ) : null}

      {activeTab === "permissions" ? (
        <PermissionSettings
          mode={permissionMode}
          onModeChange={handlePermissionModeChange}
          message={permissionNotice.text}
          messageTone={permissionNotice.tone}
          roles={permissionRoleOptions}
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
        <BackupDataSettings
          settings={backupSettings}
          history={backupHistory}
          loading={backupDataLoading}
          saving={backupSettingsSaving}
          manualLoading={backupManualLoading}
          actionId={backupActionId}
          notice={backupNotice.text}
          noticeTone={backupNotice.tone}
          onSettingChange={updateBackupSetting}
          onSave={handleSaveBackupSettings}
          onRefresh={loadBackupData}
          onCreateManualBackup={handleCreateManualBackup}
          onDownload={handleDownloadBackup}
          onDelete={handleDeleteBackup}
        />
      ) : null}

      {activeTab === "preferences" ? (
        <PreferencesSettings
          color={uiThemeColor}
          notice={uiPreferenceNotice.text}
          noticeTone={uiPreferenceNotice.tone}
          saving={uiPreferenceSaving}
          onColorChange={handleUiThemeColorChange}
          onSave={handleSaveUiPreference}
        />
      ) : null}

      {activeTab === "systemConfiguration" ? (
        <SettingsPanel
          icon={Settings2}
          title="System Configuration"
          description="Company identity, work schedule, and the rules payroll uses to value overtime and undertime."
          className="border-violet-100"
          notice={systemConfigNotice.text}
          noticeTone={systemConfigNotice.tone}
          onSubmit={handleSaveSystemConfiguration}
          footer={
            <Button type="submit" icon={Save} loading={systemConfigSaving}>
              Save System Settings
            </Button>
          }
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-violet-100 bg-violet-50/70 px-3.5 py-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">System profile</p>
              <p className="m-0 mt-1 text-sm font-bold text-slate-900">{systemConfigForm.systemProfile || "Not set"}</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3.5 py-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-700">Work week</p>
              <p className="m-0 mt-1 text-sm font-bold text-slate-900">{systemConfigForm.workWeek.length} days configured</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Daily schedule</p>
              <p className="m-0 mt-1 text-sm font-bold text-slate-900">{systemConfigForm.totalWorkHoursPerDay || "0"} hours per day</p>
            </div>
          </div>
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

          <LockAttemptSettings
            accounts={lockedAccounts}
            refreshing={securityPolicySaving}
            unlockingAccountId={unlockingAccountId}
            onRefresh={loadSettings}
            onUnlock={handleUnlockAccount}
          />
        </div>
      ) : null}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>

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

      <LeaveTypeModal
        open={leaveTypeModalOpen}
        name={leaveTypeName}
        code={leaveTypeCode}
        errors={errors}
        saving={saving}
        onNameChange={(event) => {
          setLeaveTypeName(event.target.value);
          setErrors((current) => ({ ...current, leaveTypeName: "" }));
        }}
        onCodeChange={(event) => {
          setLeaveTypeCode(event.target.value.toUpperCase());
          setErrors((current) => ({ ...current, leaveTypeCode: "" }));
        }}
        onClose={() => setLeaveTypeModalOpen(false)}
        onSubmit={handleSaveLeaveType}
      />

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
                {divisions.length === 0
                  ? "No divisions are available. Add one first — every designation belongs to a division."
                  : "Restore a division before creating or editing a designation."}
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
