import { normalizeRole } from "./roleRoutes";
import { REPORT_CATEGORIES } from "../module/reports/reportCategories";

export const MODULE_PERMISSION_MAP = {
  dashboard: "dashboard",
  profile: "profile",
  serviceRecord: "serviceRecord",
  users: "users",
  permissions: "permissions",
  settings: "settings",
  auditLogs: "auditLogs",
  calendar: "calendar",
  employees: "employees",
  // Awards have their own resource: being able to edit employee records is not the same right as
  // issuing a certificate that carries the Regional Executive Director's name.
  rewardsRecognition: "rewardsRecognition",
  attendance: "attendance",
  legacyAttendance: "attendance",
  overtime: "attendance",
  leave: "leave",
  travel: "leave",
  cto: "leave",
  passSlip: "leave",
  leaveBalance: "leaveBalance",
  leaveBalances: "leaveBalance",
  payroll: "payroll",
  payrollGenerate: "payroll",
  payrollRecords: "payroll",
  payrollLoan: "payroll",
  payrollCashAdvance: "payroll",
  // Leave monetization follows the leave approval chain, so it is gated by the
  // leave resource rather than payroll.
  payrollLeaveMonetization: "leave",
  leaveMonetization: "leave",
  archivedPayroll: "payroll",
  reports: "reports",
  // Each report category is the same screen scoped to one category, so they follow the `reports`
  // resource. Leaving them unmapped would fall through to "allowed", which in turn keeps the
  // parent Reports item visible to roles that cannot see reports at all.
  ...REPORT_CATEGORIES.reduce((map, category) => {
    map[category.navKey] = "reports";

    return map;
  }, {}),
  performanceManagement: "reports",
  performanceOpcr: "reports",
  performanceIpcr: "reports",
  performanceRatingPeriods: "reports",
  payslip: "payslip",
  ipcr: "serviceRecord",
};

/**
 * The `my*` entries are a user's own attendance, payslip, and IPCR. They are scoped to the signed-in
 * user by the workspace itself, so they must not be gated behind the management permissions that
 * govern seeing *other* people's records — an HR Staff member with no payroll permission still has
 * their own payslip.
 */
const ALWAYS_ALLOWED_MODULES = new Set([
  "messages",
  "notifications",
  "myAttendance",
  "myPayslip",
  "myIpcr",
  "myServiceRecord",
]);

function permissionListHasAction(permissionList, action) {
  if (Array.isArray(permissionList)) {
    return permissionList.includes(action);
  }

  if (!permissionList || typeof permissionList !== "object") {
    return false;
  }

  if (Array.isArray(permissionList.actions)) {
    return permissionList.enabled !== false && permissionList.actions.includes(action);
  }

  return permissionList[action] === true;
}

function permissionListHasAnyAction(permissionList) {
  if (Array.isArray(permissionList)) {
    return permissionList.length > 0;
  }

  if (!permissionList || typeof permissionList !== "object") {
    return false;
  }

  if (Array.isArray(permissionList.actions)) {
    return permissionList.enabled !== false && permissionList.actions.length > 0;
  }

  return Object.values(permissionList).some((allowed) => allowed === true);
}

export function permissionResourceForModule(moduleKey) {
  const key = String(moduleKey || "").trim();

  return MODULE_PERMISSION_MAP[key] || null;
}

export function userHasPermission(user, resource, action = "view") {
  if (!user || !resource) {
    return false;
  }

  if (normalizeRole(user.roleKey || user.role) === "admin") {
    return true;
  }

  const permissions = user.permissions || {};
  const resourcePermissions = permissions[resource];

  return permissionListHasAction(resourcePermissions, action);
}

export function userCanAccessResource(user, resource) {
  if (!user || !resource) {
    return false;
  }

  if (normalizeRole(user.roleKey || user.role) === "admin") {
    return true;
  }

  return permissionListHasAnyAction(user.permissions?.[resource]);
}

export function userCanAccessModule(user, moduleKey) {
  const key = String(moduleKey || "").trim();

  if (!key || ALWAYS_ALLOWED_MODULES.has(key)) {
    return true;
  }

  const resource = permissionResourceForModule(key);

  if (!resource) {
    return true;
  }

  return userHasPermission(user, resource, "view") || userCanAccessResource(user, resource);
}

export function canAccessNavigationItem(item, user) {
  if (!item || item.type === "section") {
    return true;
  }

  return userCanAccessModule(user, item.permissionModule || item.key);
}

export function filterNavigationItemsByPermissions(navigationItems = [], user) {
  const filteredItems = [];
  let pendingSection = null;

  navigationItems.forEach((item) => {
    if (item?.type === "section") {
      pendingSection = item;
      return;
    }

    const children = Array.isArray(item?.children)
      ? item.children.filter((child) => canAccessNavigationItem(child, user))
      : null;
    const hasAllowedChildren = Boolean(children?.length);
    const itemAllowed = canAccessNavigationItem(item, user) || hasAllowedChildren;

    if (!itemAllowed) {
      return;
    }

    if (pendingSection) {
      filteredItems.push(pendingSection);
      pendingSection = null;
    }

    filteredItems.push(
      children
        ? {
            ...item,
            children,
          }
        : item
    );
  });

  return filteredItems;
}
