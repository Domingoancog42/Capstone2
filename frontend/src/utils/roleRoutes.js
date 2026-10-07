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
  "chiefadmin",
  "planningofficer",
  "cashier",
  "employee",
  "regionaldirector",
  "hrhead",
  "hrstaff",
];

const ROLE_LABELS = {
  admin: "Admin",
  chief: "Division Chief",
  chiefadmin: "Chief Admin",
  planningofficer: "Planning Officer",
  cashier: "Cashier",
  employee: "Employee",
  regionaldirector: "Regional Director",
  hrhead: "HR Head",
  hrstaff: "HR Staff",
};

const ROLE_BADGE_CLASSES = {
  admin: "border-rose-200 bg-rose-50 text-rose-700",
  chief: "border-violet-200 bg-violet-50 text-violet-700",
  chiefadmin: "border-purple-200 bg-purple-50 text-purple-700",
  planningofficer: "border-teal-200 bg-teal-50 text-teal-700",
  cashier: "border-cyan-200 bg-cyan-50 text-cyan-700",
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
  chiefadmin: "/chiefadmin/dashboard",
  planningofficer: "/planningofficer/dashboard",
  cashier: "/cashier/dashboard",
  employee: "/employee/dashboard",
  regionaldirector: "/regionaldirector/dashboard",
  hrhead: "/hrhead/dashboard",
  hrstaff: "/hrstaff/dashboard",
};

/** The public pass slip scan station opened on the guard's device. No sign-in is needed to open it. */
export const PASS_SLIP_SCANNER_PATH = "/guard-scanner-qr";

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
    case "chiefadmin":
      return "chiefadmin";
    case "planningofficer":
    case "planning":
      return "planningofficer";
    case "cashier":
      return "cashier";
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

const FAD_DIVISION_KEYS = new Set([
  "fad",
  "fam",
  "financeadministrativedivision",
  "financeandadministrativedivision",
  "financeadministrativemanagement",
  "financeandadministrativemanagement",
  "financialandadministrativedivision",
]);

/** Only the built-in Division Chief assigned to FAD/FAM owns the payroll approval desk. */
export function isFadDivisionChiefUser(user = {}) {
  const exactRoleKey = normalizeRole(user?.roleKey || user?.role);
  const divisionKey = normalizeToken(user?.division || user?.department);

  return exactRoleKey === "chief" && FAD_DIVISION_KEYS.has(divisionKey);
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
    return baseKey === "chiefadmin" ? "chief" : baseKey;
  }

  const key = normalizeRole(role);
  if (!DEFAULT_ROLE_PATHS[key]) {
    return "";
  }

  return key === "chiefadmin" ? "chief" : key;
}

/**
 * The workspace prefix a signed-in account owns. Chief Admin deliberately has its own address and
 * page wrapper while its capability/base role remains Chief; ordinary custom roles continue to use
 * the route of the built-in role they were based on.
 */
export function resolveRoutingRole(role, baseRole = null) {
  const exactRole = normalizeRole(role);

  if (exactRole === "chiefadmin") {
    return exactRole;
  }

  return resolveBaseRole(exactRole, baseRole);
}

/**
 * The role key a capability check should test against.
 *
 * A custom role has no behaviour of its own: it works the built-in role it was based on,
 * and the module checklist saved with it decides how much of that workspace it sees. Every
 * `roleKey === "hrhead"` style test in the app therefore has to read the base role, or a
 * custom role matches none of them and loses features its checklist plainly grants.
 * Built-in roles resolve to themselves, so this is a no-op for them.
 */
export function resolveUserRoleKey(user) {
  const key = normalizeRole(user?.roleKey || user?.role);

  return resolveBaseRole(key, user?.baseRoleKey) || key;
}

export function getDefaultPathForRole(role, baseRole = null) {
  const key = resolveRoutingRole(role, baseRole);
  return DEFAULT_ROLE_PATHS[key] || "/";
}

export function getProfilePathForRole(role, baseRole = null) {
  const key = resolveRoutingRole(role, baseRole);
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
  const normalizedRole = resolveRoutingRole(role, baseRole);

  if (normalizedPath === PASS_SLIP_SCANNER_PATH) {
    return true;
  }

  if (!normalizedRole || normalizedPath === "/" || normalizedPath === "/login") {
    return false;
  }

  if (normalizedPath === "/dashboard") {
    return true;
  }

  if (normalizedRole === "admin") {
    return normalizedPath.startsWith("/admin/");
  }

  return normalizedPath.startsWith(`/${normalizedRole}/`);
}

/*
 * The app uses the browser history API directly instead of a route library. Keeping the routes
 * recognised by the UI here gives App one authoritative way to distinguish a real HRIS address
 * from a misspelled one before a dashboard gets the chance to fall back to its default module.
 */
const REPORT_ROUTE_SEGMENTS = ["employee", "payroll", "leave", "travel", "cto", "attendance", "performance", "audit"];
const SELF_SERVICE_ROUTE_SEGMENTS = [
  "my-attendance",
  "my-payslip",
  "my-ipcr",
  "my-service-record",
];
const MANAGER_ROUTE_SEGMENTS = [
  "dashboard",
  "profile",
  "calendar",
  "messages",
  "notifications",
  "attendance",
  "attendance/overtime",
  "leave",
  "leave/travel-order",
  "leave/compensatory-time-off",
  "leave/pass-slips",
  "payroll/generate",
  "payroll/payslip",
];
/* Planning Officers and ordinary Division Chiefs have no payroll route. ChiefDashboard exposes the
 * two Chief routes below only when the signed-in built-in Chief belongs to FAD/FAM. */
const DIVISION_DESK_ROUTE_SEGMENTS = MANAGER_ROUTE_SEGMENTS.filter(
  (segment) => !segment.startsWith("payroll/")
);
/*
 * The Cashier's operational desk owns the money screens. Leave, travel orders, pass slips, and CTO
 * are personal filing pages rather than management queues; attendance and overtime management
 * remain unavailable.
 */
const CASHIER_ROUTE_SEGMENTS = [
  "dashboard",
  "profile",
  "calendar",
  "messages",
  "notifications",
  "leave",
  "leave/travel-order",
  "leave/pass-slips",
  "leave/compensatory-time-off",
  "payroll/generate",
  "payroll/payslip",
  "payroll/loan",
  "payroll/archived",
];

function prefixedPaths(role, segments) {
  return segments.map((segment) => `/${role}/${segment}`);
}

const KNOWN_APP_PATHS = new Set([
  "/",
  "/login",
  PASS_SLIP_SCANNER_PATH,
  // Stable landing address used by global actions such as the 404 page. App resolves it to the
  // signed-in user's role dashboard without trusting any client-side role claim.
  "/dashboard",
  ...prefixedPaths("admin", [
    "dashboard",
    "users",
    "employees",
    "divisions",
    "designations",
    "rbac",
    "calendar",
    "messages",
    "notifications",
    "service-record",
    "promotions",
    "rewards-recognition",
    "rewards-recognition/nomination",
    "rewards-recognition/loyalty",
    "rewards-recognition/certificate-template",
    "masterfiles/leave-balances",
    "masterfiles/performance-management/opcr",
    "masterfiles/performance-management/ipcr",
    "masterfiles/salary-management",
    "masterfiles/salary-management/salary-adjustment",
    "masterfiles/salary-management/notice-of-salary-adjustment",
    "masterfiles/salary-management/notice-of-step-increment",
    "attendance",
    "attendance/overtime",
    "leave",
    "leave/travel-order",
    "leave/compensatory-time-off",
    "leave/pass-slips",
    "payroll",
    "payroll/generate",
    "payroll/payslip",
    "payroll/records",
    "payroll/loan",
    "payroll/archived",
    "reports",
    "settings",
    "profile",
  ]),
  ...prefixedPaths("admin", REPORT_ROUTE_SEGMENTS.map((segment) => `reports/${segment}`)),
  ...prefixedPaths("chief", [
    ...DIVISION_DESK_ROUTE_SEGMENTS,
    "payroll/generate",
    "payroll/archived",
    "employees",
    "team",
    "promotions",
    "rewards-recognition/nomination",
    "masterfiles/performance-management/opcr",
    "masterfiles/performance-management/ipcr",
    ...SELF_SERVICE_ROUTE_SEGMENTS,
  ]),
  ...prefixedPaths("chiefadmin", [
    ...DIVISION_DESK_ROUTE_SEGMENTS,
    "employees",
    "team",
    "promotions",
    "rewards-recognition/nomination",
    "masterfiles/performance-management/opcr",
    "masterfiles/performance-management/ipcr",
    ...SELF_SERVICE_ROUTE_SEGMENTS,
  ]),
  ...prefixedPaths("planningofficer", [
    ...DIVISION_DESK_ROUTE_SEGMENTS,
    "employees",
    "team",
    ...SELF_SERVICE_ROUTE_SEGMENTS,
  ]),
  ...prefixedPaths("cashier", [
    ...CASHIER_ROUTE_SEGMENTS,
    ...SELF_SERVICE_ROUTE_SEGMENTS,
  ]),
  ...prefixedPaths("regionaldirector", [
    ...MANAGER_ROUTE_SEGMENTS,
    "promotions",
    "payroll/archived",
    // Where the Director validates the accomplishments and MOVs the division chiefs submit.
    "masterfiles/performance-management/opcr",
    ...SELF_SERVICE_ROUTE_SEGMENTS,
  ]),
  ...prefixedPaths("hrhead", [
    ...MANAGER_ROUTE_SEGMENTS,
    "employees",
    "leave-balance",
    "masterfiles/leave-balances",
    "reports",
    "payroll/loan",
    "payroll/archived",
    "service-record",
    "promotions",
    "rewards-recognition/nomination",
    "rewards-recognition/loyalty",
    "rewards-recognition/certificate-template",
    "masterfiles/performance-management/opcr",
    "masterfiles/performance-management/ipcr",
    ...SELF_SERVICE_ROUTE_SEGMENTS,
  ]),
  ...prefixedPaths("hrstaff", [
    ...MANAGER_ROUTE_SEGMENTS,
    "employees",
    "leave-balance",
    "masterfiles/leave-balances",
    "reports",
    "payroll/loan",
    "payroll/archived",
    "service-record",
    "promotions",
    "rewards-recognition/loyalty",
    "rewards-recognition/certificate-template",
    "masterfiles/performance-management/opcr",
    "masterfiles/performance-management/ipcr",
    ...SELF_SERVICE_ROUTE_SEGMENTS,
  ]),
  ...prefixedPaths("employee", [
    "dashboard",
    "profile",
    "calendar",
    "messages",
    "notifications",
    "attendance",
    "leave-request",
    "travel-order",
    "pass-slips",
    "compensatory-time-off",
    "overtime",
    "payslip",
    "ipcr",
    "service-record",
    "promotions",
    "rewards",
    "voting",
  ]),
  ...prefixedPaths("hrhead", REPORT_ROUTE_SEGMENTS.map((segment) => `reports/${segment}`)),
  ...prefixedPaths("hrstaff", REPORT_ROUTE_SEGMENTS.map((segment) => `reports/${segment}`)),
]);

/** Returns whether a URL is an address that this HRIS intentionally serves. */
export function isKnownAppPath(pathname) {
  return KNOWN_APP_PATHS.has(normalizePath(pathname));
}

/** Exact React Router paths. Legacy addresses remain valid until their callers are retired. */
export const APP_ROUTE_PATHS = Object.freeze([
  ...new Set([...KNOWN_APP_PATHS, ...Object.keys(LEGACY_PATHS)]),
]);

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

