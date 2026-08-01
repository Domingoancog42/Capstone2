export const SESSION_USER_KEY = "hris_admin_user";

export function readStoredUser() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedUser = window.localStorage.getItem(SESSION_USER_KEY);
    return storedUser ? normalizeUser(JSON.parse(storedUser)) : null;
  } catch {
    return null;
  }
}
export const MANAGED_USER_ROLE_KEYS = [
  "chief",
  "employee",
  "regionaldirector",
  "hrhead",
  "hrstaff",
];

const ROLE_LABELS = {
  admin: "Admin",
  chief: "Chief",
  employee: "Employee",
  regionaldirector: "Regional Director",
  hrhead: "HR Head",
  hrstaff: "HR Staff",
};

const ROLE_BADGE_CLASSES = {
  admin: "border-rose-200 bg-rose-50 text-rose-700",
  chief: "border-violet-200 bg-violet-50 text-violet-700",
  employee: "border-emerald-200 bg-emerald-50 text-emerald-700",
  regionaldirector: "border-indigo-200 bg-indigo-50 text-indigo-700",
  hrhead: "border-amber-200 bg-amber-50 text-amber-700",
  hrstaff: "border-sky-200 bg-sky-50 text-sky-700",
};

const STATUS_LABELS = {
  active: "Active",
  inactive: "Inactive",
};

const DEFAULT_ROLE_PATHS = {
  admin: "/admin/dashboard",
  chief: "/chief/dashboard",
  employee: "/employee/dashboard",
  regionaldirector: "/regionaldirector/dashboard",
  hrhead: "/hrhead/dashboard",
  hrstaff: "/hrstaff/dashboard",
};

const LEGACY_PATHS = {
  "/admindashboard": "/admin/dashboard",
  "/users": "/admin/users",
  "/employee": "/admin/employees",
  "/employees": "/admin/employees",
  "/attendance": "/admin/attendance",
  "/leave": "/admin/leave",
  "/message": "/admin/messages",
  "/messages": "/admin/messages",
  "/reports": "/admin/reports",
  "/settings": "/admin/settings",
  "/regionaldirector/approvals": "/regionaldirector/dashboard",
};

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function normalizeRole(value) {
  const token = normalizeToken(value);

  switch (token) {
    case "admin":
    case "administrator":
    case "superadmin":
      return "admin";
    case "chief":
      return "chief";
    case "employee":
      return "employee";
    case "regionaldirector":
    case "regionaldir":
      return "regionaldirector";
    case "hrhead":
      return "hrhead";
    case "hrstaff":
      return "hrstaff";
    default:
      return token;
  }
}

export function normalizeStatus(value) {
  const token = normalizeToken(value);

  switch (token) {
    case "active":
      return "active";
    case "inactive":
    case "disabled":
      return "inactive";
    default:
      return token;
  }
}

export function getRoleLabel(value) {
  const key = normalizeRole(value);
  return ROLE_LABELS[key] || String(value || "User");
}

export function getRoleBadgeClass(value) {
  const key = normalizeRole(value);
  return ROLE_BADGE_CLASSES[key] || "border-slate-200 bg-slate-50 text-slate-700";
}

export function getStatusLabel(value) {
  const key = normalizeStatus(value);
  return STATUS_LABELS[key] || String(value || "Unknown");
}

/**
 * Custom roles have no dashboard or route prefix of their own, so everything about
 * where a user can go is decided by the built-in role they were based on. `baseRole`
 * comes from the session payload; built-in roles resolve to themselves.
 */
export function resolveBaseRole(role, baseRole = null) {
  const baseKey = normalizeRole(baseRole);

  if (baseKey && DEFAULT_ROLE_PATHS[baseKey]) {
    return baseKey;
  }

  const key = normalizeRole(role);
  return DEFAULT_ROLE_PATHS[key] ? key : "";
}

export function getDefaultPathForRole(role, baseRole = null) {
  const key = resolveBaseRole(role, baseRole);
  return DEFAULT_ROLE_PATHS[key] || "/";
}

export function getProfilePathForRole(role, baseRole = null) {
  const key = resolveBaseRole(role, baseRole);
  return key ? `/${key}/profile` : "/";
}

export function normalizePath(pathname) {
  const trimmed = String(pathname || "/").trim();
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;

  return LEGACY_PATHS[withoutTrailingSlash] || withoutTrailingSlash || "/";
}

export function isPathAllowedForRole(pathname, role, baseRole = null) {
  const normalizedPath = normalizePath(pathname);
  const normalizedRole = resolveBaseRole(role, baseRole);

  if (!normalizedRole || normalizedPath === "/") {
    return false;
  }

  if (normalizedRole === "admin") {
    return normalizedPath.startsWith("/admin/");
  }

  return normalizedPath.startsWith(`/${normalizedRole}/`);
}

export function normalizeUser(user) {
  if (!user) {
    return null;
  }

  const roleKey = normalizeRole(user.roleKey || user.role);
  const statusKey = normalizeStatus(user.status);
  const baseRoleKey = resolveBaseRole(roleKey, user.baseRoleKey);

  return {
    ...user,
    roleKey,
    baseRoleKey,
    // A custom role has no entry in ROLE_LABELS, so fall back to the name the admin
    // gave it rather than the generic "User".
    roleLabel: getRoleLabel(roleKey) === "User" ? String(user.role || "User") : getRoleLabel(roleKey),
    statusKey,
    statusLabel: getStatusLabel(statusKey || user.status),
  };
}

export function getManagedRoleOptions(roles = [], currentRole = null) {
  const roleMap = new Map(
    roles.map((role) => {
      const key = normalizeRole(role.name);
      const baseRole = resolveBaseRole(key, role.baseRole);

      return [
        key,
        {
          ...role,
          key,
          baseRole,
          // Custom roles are the ones the admin created; they carry a base_role and are
          // named by whatever was typed in the Roles tab.
          isCustom: Boolean(role.baseRole) && !MANAGED_USER_ROLE_KEYS.includes(key) && key !== "admin",
          label: MANAGED_USER_ROLE_KEYS.includes(key) || key === "admin"
            ? getRoleLabel(key)
            : String(role.name || getRoleLabel(key)),
        },
      ];
    })
  );

  const requestedRoles = MANAGED_USER_ROLE_KEYS.map((key) => roleMap.get(key)).filter(Boolean);

  // Custom roles are assignable too, listed after the built-ins.
  roleMap.forEach((role) => {
    if (role.isCustom) {
      requestedRoles.push(role);
    }
  });

  const currentRoleKey = normalizeRole(currentRole);

  if (currentRoleKey && !requestedRoles.some((role) => role.key === currentRoleKey) && roleMap.has(currentRoleKey)) {
    requestedRoles.push(roleMap.get(currentRoleKey));
  }

  return requestedRoles;
}

export function getMissingManagedRoles(roles = []) {
  const available = new Set(roles.map((role) => normalizeRole(role.name)));
  return MANAGED_USER_ROLE_KEYS.filter((key) => !available.has(key)).map((key) => getRoleLabel(key));
}

export function getStatusOptions(statuses = [], currentStatus = null) {
  const statusMap = new Map(
    statuses.map((status) => {
      const key = normalizeStatus(status.name);
      return [
        key,
        {
          ...status,
          key,
          label: getStatusLabel(key),
        },
      ];
    })
  );

  const orderedStatuses = ["active", "inactive"]
    .map((key) => statusMap.get(key))
    .filter(Boolean);
  const currentStatusKey = normalizeStatus(currentStatus);

  if (
    currentStatusKey
    && !orderedStatuses.some((status) => status.key === currentStatusKey)
    && statusMap.has(currentStatusKey)
  ) {
    orderedStatuses.push(statusMap.get(currentStatusKey));
  }

  return orderedStatuses;
}

export function getMissingRequestedStatuses(statuses = []) {
  const available = new Set(statuses.map((status) => normalizeStatus(status.name)));
  return ["active", "inactive"]
    .filter((key) => !available.has(key))
    .map((key) => getStatusLabel(key));
}

