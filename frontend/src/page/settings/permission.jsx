import React from "react";
import {
  Check,
  ChevronDown,
  ClipboardList,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import SettingsNotice from "../../components/settings/SettingsNotice";

export const permissionRoles = [
  { key: "admin", label: "Super Admin", description: "Full access to all system features and settings." },
  { key: "hrhead", label: "HR Head", description: "Oversees HR operations and approvals." },
  { key: "hrstaff", label: "HR Staff", description: "Handles employee records, leave, and reports." },
  { key: "chief", label: "Chief", description: "Manages division-level requests and team visibility." },
  { key: "regionaldirector", label: "Regional Director", description: "Approves regional actions and reviews analytics." },
  { key: "employee", label: "Employee", description: "Uses self-service requests, records, and profile tools." },
];

const permissionRoleStyles = {
  admin: {
    accent: "text-red-600",
    badge: "bg-red-50 text-red-600",
    bar: "bg-red-600",
    dot: "bg-red-600",
    ring: "border-red-200",
  },
  hrhead: {
    accent: "text-orange-600",
    badge: "bg-orange-50 text-orange-600",
    bar: "bg-orange-600",
    dot: "bg-orange-600",
    ring: "border-orange-200",
  },
  hrstaff: {
    accent: "text-amber-600",
    badge: "bg-amber-50 text-amber-600",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
    ring: "border-amber-200",
  },
  chief: {
    accent: "text-emerald-600",
    badge: "bg-emerald-50 text-emerald-600",
    bar: "bg-emerald-600",
    dot: "bg-emerald-600",
    ring: "border-emerald-200",
  },
  regionaldirector: {
    accent: "text-violet-600",
    badge: "bg-violet-50 text-violet-600",
    bar: "bg-violet-600",
    dot: "bg-violet-600",
    ring: "border-violet-200",
  },
  employee: {
    accent: "text-sky-600",
    badge: "bg-sky-50 text-sky-600",
    bar: "bg-sky-600",
    dot: "bg-sky-600",
    ring: "border-sky-200",
  },
};

export const permissionActions = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "approve", label: "Approve" },
  { key: "reject", label: "Reject" },
  { key: "export", label: "Export" },
];

export const permissionSections = [
  {
    title: "Core Access",
    items: [
      {
        key: "dashboard",
        label: "Dashboard Access",
        description: "Open the role home page.",
        defaultActions: ["view"],
      },
      {
        key: "profile",
        label: "My Profile",
        description: "View and update personal account information.",
        defaultActions: ["view", "edit"],
      },
      {
        key: "serviceRecord",
        label: "Service Record",
        description: "View and update the employee service record.",
        defaultActions: ["view", "edit"],
      },
      {
        key: "users",
        label: "User Management",
        description: "View and manage system users.",
        defaultActions: ["view", "create", "edit", "delete"],
      },
      {
        key: "permissions",
        label: "Permissions",
        description: "Configure access rules for each role.",
        defaultActions: ["view", "edit"],
      },
      {
        key: "settings",
        label: "Settings",
        description: "Update system settings and preferences.",
        defaultActions: ["view", "edit"],
      },
      {
        key: "auditLogs",
        label: "Audit Logs",
        description: "Review system activity and security events.",
        defaultActions: ["view"],
      },
      {
        key: "calendar",
        label: "Calendar",
        description: "View holidays, events, and schedule references.",
        defaultActions: ["view"],
      },
    ],
  },
  {
    title: "Workspace Access",
    items: [
      {
        key: "employees",
        label: "Employee Management",
        description: "Create, edit, and review employee records.",
        defaultActions: ["view", "create", "edit", "delete"],
      },
      {
        key: "rewardsRecognition",
        label: "Rewards & Recognition",
        description: "Nominate employees and issue award certificates.",
        defaultActions: ["view", "create", "edit"],
      },
      {
        key: "attendance",
        label: "Attendance",
        description: "Review attendance logs, DTR records, and adjustments.",
        defaultActions: ["view", "create", "edit", "approve", "reject", "export"],
      },
      {
        key: "leave",
        label: "Leave Management",
        description: "Manage leave, travel order, pass slip, and CTO records.",
        defaultActions: ["view", "create", "edit", "approve", "reject", "export"],
      },
      {
        key: "leaveBalance",
        label: "Leave Balance",
        description: "View and update employee leave credits.",
        defaultActions: ["view", "edit"],
      },
      {
        key: "payroll",
        label: "Payroll",
        description: "Prepare payroll, payslips, deductions, and releases.",
        defaultActions: ["view", "create", "edit", "export"],
      },
      {
        key: "reports",
        label: "Reports",
        description: "Generate and export HRIS operational reports.",
        defaultActions: ["view", "export"],
      },
      {
        key: "payslip",
        label: "Payslip",
        description: "View generated payslip records.",
        defaultActions: ["view"],
      },
    ],
  },
];

export const permissionItems = permissionSections.flatMap((section) => section.items);
export const totalPermissionUnits = permissionItems.reduce((total, item) => total + 1 + item.defaultActions.length, 0);

const permissionSectionStyles = {
  "Core Access": {
    icon: ShieldCheck,
    badge: "bg-red-50 text-red-600",
  },
  "Workspace Access": {
    icon: ClipboardList,
    badge: "bg-violet-50 text-violet-600",
  },
};

const rolePermissionAccess = {
  admin: "all",
  hrhead: [
    "dashboard",
    "profile",
    "serviceRecord",
    "users",
    "permissions",
    "auditLogs",
    "calendar",
    "employees",
    "rewardsRecognition",
    "attendance",
    "leave",
    "leaveBalance",
    "payroll",
    "reports",
  ],
  hrstaff: [
    "dashboard",
    "profile",
    "serviceRecord",
    "calendar",
    "employees",
    "rewardsRecognition",
    "attendance",
    "leave",
    "leaveBalance",
    "reports",
  ],
  chief: [
    "dashboard",
    "profile",
    "serviceRecord",
    "calendar",
    "attendance",
    "leave",
    "reports",
  ],
  regionaldirector: [
    "dashboard",
    "profile",
    "serviceRecord",
    "calendar",
    "leave",
    "reports",
    "rewardsRecognition",
    "auditLogs",
  ],
  employee: [
    "dashboard",
    "profile",
    "serviceRecord",
    "calendar",
    "attendance",
    "leave",
    "payslip",
  ],
};

function isPermissionModuleEnabledByDefault(roleKey, moduleKey) {
  const access = rolePermissionAccess[roleKey] || [];

  return access === "all" || access.includes(moduleKey);
}

export function createDefaultPermissionTemplates() {
  return permissionRoles.reduce((templates, role) => {
    templates[role.key] = {
      enabled: true,
      modules: permissionItems.reduce((modules, item) => {
        const enabled = isPermissionModuleEnabledByDefault(role.key, item.key);

        modules[item.key] = {
          enabled,
          actions: enabled ? item.defaultActions : [],
        };

        return modules;
      }, {}),
    };

    return templates;
  }, {});
}

export function normalizePermissionTemplates(templates = {}) {
  const defaults = createDefaultPermissionTemplates();

  const normalized = permissionRoles.reduce((normalizedTemplates, role) => {
    const sourceRole = templates?.[role.key] || {};
    const sourceModules = sourceRole.modules || {};

    normalizedTemplates[role.key] = {
      enabled: sourceRole.enabled !== false,
      modules: permissionItems.reduce((modules, item) => {
        const defaultModule = defaults[role.key].modules[item.key];
        const sourceModule = sourceModules[item.key] || {};
        const allowedActionKeys = new Set(item.defaultActions);
        const sourceActions = Array.isArray(sourceModule.actions) ? sourceModule.actions : defaultModule.actions;
        const actions = sourceActions.filter((action) => allowedActionKeys.has(action));

        modules[item.key] = {
          enabled: typeof sourceModule.enabled === "boolean" ? sourceModule.enabled : defaultModule.enabled,
          actions,
        };

        return modules;
      }, {}),
    };

    return normalizedTemplates;
  }, {});

  // Admin-created roles are not in the built-in list, so carry their templates through
  // untouched. Dropping them here would send an incomplete map back to the server and
  // reset every custom role to its base role's access.
  Object.keys(templates || {}).forEach((roleKey) => {
    if (!normalized[roleKey] && templates[roleKey]) {
      normalized[roleKey] = normalizeSinglePermissionTemplate(templates[roleKey]);
    }
  });

  return normalized;
}

// Normalize a single {enabled, modules} template against the known modules/actions.
export function normalizeSinglePermissionTemplate(template = {}) {
  const sourceModules = template?.modules || {};

  return {
    enabled: template?.enabled !== false,
    modules: permissionItems.reduce((modules, item) => {
      const sourceModule = sourceModules[item.key] || {};
      const allowedActionKeys = new Set(item.defaultActions);
      const sourceActions = Array.isArray(sourceModule.actions) ? sourceModule.actions : [];
      const actions = sourceActions.filter((action) => allowedActionKeys.has(action));

      modules[item.key] = {
        enabled: typeof sourceModule.enabled === "boolean" ? sourceModule.enabled : false,
        actions,
      };

      return modules;
    }, {}),
  };
}

// Build the editable permission draft for a user: their saved override if one
// exists, otherwise a copy of their role's template.
export function buildUserPermissionDraft(user, roleTemplates, overrides) {
  if (!user) {
    return normalizeSinglePermissionTemplate({});
  }

  const override = overrides?.[String(user.id)] ?? overrides?.[user.id];

  if (override) {
    return normalizeSinglePermissionTemplate(override);
  }

  const defaults = createDefaultPermissionTemplates();
  const roleTemplate = roleTemplates?.[user.roleKey] || defaults[user.roleKey] || defaults.employee;

  return normalizeSinglePermissionTemplate(roleTemplate);
}

function countEnabledPermissions(roleTemplate = {}) {
  if (roleTemplate.enabled === false) {
    return 0;
  }

  return Object.values(roleTemplate.modules || {}).reduce((total, modulePermission) => (
    modulePermission.enabled ? total + 1 + (modulePermission.actions?.length || 0) : total
  ), 0);
}

function countEnabledPermissionsInSection(roleTemplate = {}, section = {}) {
  if (roleTemplate.enabled === false) {
    return 0;
  }

  return (section.items || []).reduce((total, item) => {
    const modulePermission = roleTemplate.modules?.[item.key] || { enabled: false, actions: [] };

    return modulePermission.enabled ? total + 1 + (modulePermission.actions?.length || 0) : total;
  }, 0);
}

function countPermissionUnitsInSection(section = {}) {
  return (section.items || []).reduce((total, item) => total + 1 + item.defaultActions.length, 0);
}

function permissionProgressPercent(enabledCount = 0, totalCount = totalPermissionUnits) {
  if (!totalCount) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((enabledCount / totalCount) * 100)));
}

function permissionActionsLabel(actions = []) {
  if (!actions.length) {
    return "No access";
  }

  return actions
    .map((actionKey) => permissionActions.find((action) => action.key === actionKey)?.label || actionKey)
    .join(", ");
}

function getPermissionActionColor(actionKey) {
  const colorMap = {
    view: "bg-blue-100 text-blue-700 border-blue-200",
    create: "bg-green-100 text-green-700 border-green-200",
    edit: "bg-amber-100 text-amber-700 border-amber-200",
    delete: "bg-rose-100 text-rose-700 border-rose-200",
    approve: "bg-purple-100 text-purple-700 border-purple-200",
    reject: "bg-orange-100 text-orange-700 border-orange-200",
    export: "bg-teal-100 text-teal-700 border-teal-200",
  };
  return colorMap[actionKey] || "bg-slate-100 text-slate-700 border-slate-200";
}

function getPermissionLabelColor(actions = []) {
  if (!actions.length) {
    return "bg-slate-100 text-slate-600 border-slate-200";
  }

  // If multiple actions, use a neutral gradient style
  if (actions.length > 1) {
    return "bg-gradient-to-r from-blue-50 to-purple-50 text-slate-700 border-slate-300";
  }

  // Single action - use specific color
  return getPermissionActionColor(actions[0]);
}

export default function PermissionSettings({
  mode = "role",
  onModeChange,
  message = "",
  messageTone = "info",
  templates = {},
  userCounts = {},
  selectedRoleKey = permissionRoles[0]?.key,
  onSelectRole,
  savingRole = "",
  onSaveRole,
  onResetRole,
  users = [],
  userOverrides = {},
  userSearch = "",
  onUserSearchChange,
  selectedUserId = null,
  onSelectUser,
  userDraft,
  savingUser = false,
  unsavedUserChanges = false,
  onSaveUser,
  onResetUser,
  expandedSections = {},
  onToggleSection,
  actionPopover = null,
  onToggleActionPopover,
  onCloseActionPopover,
  onToggleEnabled,
  onToggleModule,
  onToggleAction,
}) {
  const isUserMode = mode === "user";
  const selectedRole = permissionRoles.find((role) => role.key === selectedRoleKey) || permissionRoles[0];
  const selectedUser = users.find((candidate) => candidate.id === selectedUserId) || null;
  const roleStyle = permissionRoleStyles[selectedRole.key] || permissionRoleStyles.employee;
  const userRoleStyle = selectedUser
    ? (permissionRoleStyles[selectedUser.roleKey] || permissionRoleStyles.employee)
    : permissionRoleStyles.employee;
  const activeStyle = isUserMode ? userRoleStyle : roleStyle;
  const activeTemplate = isUserMode
    ? userDraft
    : (templates[selectedRole.key] || createDefaultPermissionTemplates()[selectedRole.key]);
  const activeDisabled = activeTemplate.enabled === false;
  const enabledCount = countEnabledPermissions(activeTemplate);
  const progressPercent = permissionProgressPercent(enabledCount);
  const userHasOverride = selectedUser
    ? Boolean(userOverrides?.[String(selectedUser.id)] ?? userOverrides?.[selectedUser.id])
    : false;
  const scopeKey = isUserMode ? `user:${selectedUserId ?? "none"}` : selectedRole.key;
  const savingActive = isUserMode ? savingUser : (savingRole === selectedRole.key);
  const overrideCount = Object.keys(userOverrides || {}).length;
  const normalizedUserSearch = userSearch.trim().toLowerCase();
  const filteredUsers = !normalizedUserSearch
    ? users
    : users.filter((candidate) =>
      [candidate.fullName, candidate.username, candidate.email, candidate.role, candidate.division]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedUserSearch))
    );
  const activeInitials = (selectedUser?.fullName || selectedUser?.username || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
  const showEditor = !isUserMode || Boolean(selectedUser);

  return (
    <div className="grid gap-6 rounded-2xl bg-white p-1">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 text-white shadow-sm">
            <ShieldCheck size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-2xl font-bold leading-tight text-slate-950">Access Control</h2>
            <p className="m-0 mt-1 text-sm leading-5 text-slate-500">
              {isUserMode
                ? "Fine-tune permissions for an individual user."
                : "Manage permissions for each role in your organization."}
            </p>
            {/* This used to be hardcoded as a green "saved" pill, so a failure to save permissions
                announced itself in the same reassuring green as a success. */}
            <SettingsNotice tone={messageTone} className="mt-2">
              {message}
            </SettingsNotice>
          </div>
        </div>

        <div className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {[
            { key: "role", label: "By Role", icon: ShieldCheck },
            { key: "user", label: "By User", icon: UserCog },
          ].map((modeOption) => {
            const ModeIcon = modeOption.icon;
            const modeActive = mode === modeOption.key;

            return (
              <button
                key={modeOption.key}
                type="button"
                onClick={() => onModeChange?.(modeOption.key)}
                className={[
                  "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition",
                  modeActive
                    ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-900",
                ].join(" ")}
              >
                <ModeIcon size={16} />
                {modeOption.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-w-0">
          {isUserMode ? (
            <>
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Users</p>
                <span className="text-xs font-semibold text-slate-500">
                  {overrideCount} custom
                </span>
              </div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="search"
                  value={userSearch}
                  onChange={onUserSearchChange}
                  placeholder="Search name, email, role..."
                  className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pl-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  aria-label="Search users"
                />
              </div>
              <div className="grid max-h-[560px] gap-2 overflow-y-auto pr-1">
                {filteredUsers.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs font-medium text-slate-500">
                    No users match your search.
                  </p>
                ) : (
                  filteredUsers.map((candidate) => {
                    const style = permissionRoleStyles[candidate.roleKey] || permissionRoleStyles.employee;
                    const active = candidate.id === selectedUserId;
                    const hasOverride = Boolean(
                      userOverrides?.[String(candidate.id)] ?? userOverrides?.[candidate.id]
                    );
                    const initials = (candidate.fullName || candidate.username || "?")
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase() || "")
                      .join("") || "?";

                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => onSelectUser?.(candidate.id)}
                        className={[
                          "relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                          active ? `${style.ring} ring-1 ring-slate-200` : "border-slate-200",
                        ].join(" ")}
                      >
                        {active ? <span className={`absolute bottom-3 left-0 top-3 w-1 rounded-r-full ${style.bar}`} /> : null}
                        {candidate.profileImage ? (
                          <img
                            src={candidate.profileImage}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${style.badge}`}>
                            {initials}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-950">
                              {candidate.fullName || candidate.username}
                            </span>
                            {hasOverride ? (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                                Custom
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                            <span className="truncate text-[11px] font-medium text-slate-500">
                              {candidate.role || "—"}{candidate.division ? ` · ${candidate.division}` : ""}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Roles</p>
                <span className="text-xs font-semibold text-slate-500">{permissionRoles.length} total</span>
              </div>
              <div className="grid gap-2">
                {permissionRoles.map((role) => {
                  const template = templates[role.key] || createDefaultPermissionTemplates()[role.key];
                  const roleEnabledCount = countEnabledPermissions(template);
                  const roleProgress = permissionProgressPercent(roleEnabledCount);
                  const activeUserCount = userCounts[role.key] || 0;
                  const style = permissionRoleStyles[role.key] || permissionRoleStyles.employee;
                  const active = role.key === selectedRole.key;
                  const templateDisabled = template.enabled === false;

                  return (
                    <button
                      key={role.key}
                      type="button"
                      onClick={() => onSelectRole?.(role.key)}
                      className={[
                        "relative overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                        active ? `${style.ring} ring-1 ring-slate-200` : "border-slate-200",
                        templateDisabled ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      {active ? <span className={`absolute bottom-3 left-0 top-3 w-1 rounded-r-full ${style.bar}`} /> : null}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                            <p className="m-0 truncate text-sm font-semibold text-slate-950">{role.label}</p>
                            {role.key === "employee" ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                                Default
                              </span>
                            ) : null}
                          </div>
                          <p className="m-0 mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{role.description}</p>
                          <p className="m-0 mt-2 text-[11px] font-semibold text-slate-400">
                            {activeUserCount} active {activeUserCount === 1 ? "user" : "users"}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-slate-500">
                          {roleEnabledCount}/{totalPermissionUnits}
                        </span>
                      </div>
                      <div className="mt-3 h-1 rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${style.bar}`}
                          style={{ width: `${roleProgress}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        <section className="grid min-w-0 gap-5">
          {!showEditor ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center">
              <Users size={32} className="text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">Select a user to manage permissions</p>
              <p className="mt-1 text-xs text-slate-500">Pick someone from the list to grant individual access.</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    {isUserMode ? (
                      selectedUser?.profileImage ? (
                        <img src={selectedUser.profileImage} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold ${activeStyle.badge}`}>
                          {activeInitials}
                        </div>
                      )
                    ) : (
                      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${activeStyle.badge}`}>
                        <ShieldCheck size={20} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 truncate text-lg font-semibold text-slate-950">
                          {isUserMode ? (selectedUser?.fullName || selectedUser?.username) : selectedRole.label}
                        </h3>
                        {isUserMode ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${activeStyle.badge}`}>
                            {selectedUser?.role || "—"}
                          </span>
                        ) : null}
                        {isUserMode && userHasOverride ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                            Custom access
                          </span>
                        ) : null}
                      </div>
                      <p className="m-0 mt-1 text-sm text-slate-500">
                        {isUserMode && !userHasOverride
                          ? `Inheriting ${selectedUser?.role || "role"} default · ${enabledCount} of ${totalPermissionUnits} permissions`
                          : `${enabledCount} of ${totalPermissionUnits} permissions enabled`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!activeDisabled}
                      onClick={onToggleEnabled}
                      className={[
                        "inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-slate-200",
                        activeDisabled
                          ? "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                          : "border-slate-900 bg-slate-900 text-white hover:bg-slate-800",
                      ].join(" ")}
                    >
                      {activeDisabled ? "Disabled" : "Enabled"}
                    </button>
                    <button
                      type="button"
                      onClick={isUserMode ? onResetUser : () => onResetRole?.(selectedRole.key)}
                      disabled={savingActive}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw size={15} />
                      {isUserMode ? "Reset to role" : "Reset"}
                    </button>
                    {/* Unsaved edits were tracked but never surfaced, so nothing told you the
                        switches you just flipped still needed saving. */}
                    {isUserMode && unsavedUserChanges && !savingActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                        Unsaved changes
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={isUserMode ? onSaveUser : () => onSaveRole?.(selectedRole.key)}
                      disabled={savingActive}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Save size={15} />
                      {savingActive ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </div>
                <div className="mt-4 h-1.5 rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-900 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid gap-4">
                {permissionSections.map((section, sectionIndex) => {
                  const sectionKey = `${scopeKey}:${section.title}`;
                  const sectionOpen = expandedSections[sectionKey] ?? sectionIndex === 0;
                  const sectionStyle = permissionSectionStyles[section.title] || permissionSectionStyles["Core Access"];
                  const SectionIcon = sectionStyle.icon;
                  const sectionEnabledCount = countEnabledPermissionsInSection(activeTemplate, section);
                  const sectionTotal = countPermissionUnitsInSection(section);
                  const sectionComplete = !activeDisabled && sectionEnabledCount === sectionTotal;

                  return (
                    <div key={sectionKey} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${sectionStyle.badge}`}>
                            <SectionIcon size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="m-0 text-base font-semibold text-slate-950">{section.title}</h4>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">
                                {sectionEnabledCount}/{sectionTotal}
                              </span>
                            </div>
                            <p className="m-0 mt-1 text-sm text-slate-500">
                              {sectionComplete ? "All permissions enabled" : `${sectionEnabledCount} permissions enabled`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 sm:justify-end">
                          <span
                            className={[
                              "grid h-4 w-4 place-items-center rounded border text-white",
                              sectionComplete ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white",
                            ].join(" ")}
                            aria-hidden="true"
                          >
                            {sectionComplete ? <Check size={11} /> : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => onToggleSection?.(scopeKey, section.title)}
                            aria-expanded={sectionOpen}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                          >
                            <ChevronDown size={16} className={`transition-transform ${sectionOpen ? "rotate-180" : ""}`} />
                          </button>
                        </div>
                      </div>

                      {sectionOpen ? (
                        <div className="grid gap-2 px-5 pb-5">
                          {section.items.map((item) => {
                            const modulePermission = activeTemplate.modules?.[item.key] || {
                              enabled: false,
                              actions: [],
                            };
                            const rowKey = `${scopeKey}:${item.key}`;
                            const popoverOpen = actionPopover?.rowKey === rowKey;
                            const enabled = activeTemplate.enabled !== false && modulePermission.enabled;
                            const canManageActions = item.defaultActions.length > 1;
                            const actionsLabel = permissionActionsLabel(enabled ? modulePermission.actions : []);

                            return (
                              <div
                                key={rowKey}
                                className={[
                                  "rounded-xl border px-3 py-3 transition",
                                  enabled ? "border-slate-200 bg-white" : "border-transparent bg-slate-50",
                                ].join(" ")}
                              >
                                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                  <label className="flex min-w-0 cursor-pointer items-start gap-3">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(modulePermission.enabled)}
                                      disabled={activeDisabled}
                                      onChange={() => onToggleModule?.(item.key)}
                                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900 focus:ring-slate-900 disabled:cursor-not-allowed"
                                      aria-label={item.label}
                                    />
                                    <span className="min-w-0">
                                      <span className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-slate-950">{item.label}</span>
                                        {enabled ? <Check size={13} className="text-emerald-600" /> : null}
                                      </span>
                                      <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
                                    </span>
                                  </label>

                                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                                    {canManageActions ? (
                                      <button
                                        type="button"
                                        disabled={activeDisabled || !modulePermission.enabled}
                                        onClick={(event) => onToggleActionPopover?.(event, item.key)}
                                        aria-expanded={popoverOpen}
                                        aria-label={`Manage ${item.label} actions`}
                                        className={[
                                          "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
                                          popoverOpen
                                            ? "border-slate-900 bg-slate-900 text-white"
                                            : `hover:border-slate-300 ${getPermissionLabelColor(enabled ? modulePermission.actions : [])}`,
                                        ].join(" ")}
                                      >
                                        <span className="max-w-[180px] truncate">{actionsLabel}</span>
                                        <ChevronDown
                                          size={14}
                                          className={`shrink-0 transition-transform ${popoverOpen ? "rotate-180" : ""}`}
                                        />
                                      </button>
                                    ) : (
                                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getPermissionLabelColor(enabled ? modulePermission.actions : [])}`}>
                                        {actionsLabel}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {actionPopover ? (() => {
        const popItem = permissionItems.find((item) => item.key === actionPopover.moduleKey);

        if (!popItem) {
          return null;
        }

        const popModule = activeTemplate.modules?.[actionPopover.moduleKey] || { enabled: false, actions: [] };

        return (
          <>
            <button
              type="button"
              aria-label="Close actions"
              onClick={onCloseActionPopover}
              className="fixed inset-0 z-40 cursor-default bg-slate-900/5"
            />
            <div
              role="dialog"
              aria-label={`${popItem.label} actions`}
              style={{ top: actionPopover.top, right: actionPopover.right }}
              className="fixed z-50 w-[min(92vw,560px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-slate-900/5"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold text-slate-950">{popItem.label} actions</p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">Toggle what this {isUserMode ? "user" : "role"} can do.</p>
                </div>
                <button
                  type="button"
                  onClick={onCloseActionPopover}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {popItem.defaultActions.map((actionKey) => {
                  const actionLabel = permissionActions.find((action) => action.key === actionKey)?.label || actionKey;
                  const checked = popModule.actions?.includes(actionKey);
                  const actionColor = getPermissionActionColor(actionKey);

                  return (
                    <button
                      type="button"
                      key={`${actionPopover.rowKey}-${actionKey}`}
                      disabled={activeDisabled || !popModule.enabled}
                      onClick={() => onToggleAction?.(actionPopover.moduleKey, actionKey)}
                      className={[
                        "inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                        checked
                          ? actionColor
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "grid h-4 w-4 place-items-center rounded-full border",
                          checked ? "border-current bg-white/60" : "border-slate-300",
                        ].join(" ")}
                      >
                        {checked ? <Check size={11} /> : null}
                      </span>
                      {actionLabel}
                    </button>
                  );
                })}
              </div>
              {!popModule.enabled ? (
                <p className="m-0 mt-3 text-xs font-medium text-amber-600">
                  Enable this module first to choose its actions.
                </p>
              ) : null}
            </div>
          </>
        );
      })() : null}
    </div>
  );
}
