import { REPORT_CATEGORIES } from "../module/reports/reportCategories";

export const MODULE_PERMISSION_MAP = {
  dashboard: "dashboard",
  profile: "profile",
  serviceRecord: "serviceRecord",
  users: "users",
  permissions: "permissions",
  rbac: "permissions",
  settings: "settings",
  divisions: "settings",
  designations: "settings",
  salaryManagement: "employees",
  salaryAdjustment: "employees",
  noticeSalaryAdjustment: "employees",
  noticeStepIncrement: "employees",
  auditLogs: "auditLogs",
  calendar: "calendar",
  employees: "employees",
  team: "employees",
  // Awards have their own resource: being able to edit employee records is not the same right as
  // issuing a certificate that carries the Regional Executive Director's name.
  rewardsRecognition: "rewardsRecognition",
  // Each award is the same screen scoped to one category, so both follow the `rewardsRecognition`
  // resource. Leaving them unmapped would fall through to "allowed", which in turn keeps the parent
  // Rewards & Recognition item visible to roles that cannot see awards at all.
  rewardsNomination: "rewardsRecognition",
  rewardsLoyalty: "rewardsRecognition",
  rewardsCertificateTemplate: "rewardsRecognition",
  // Moving somebody up the designation hierarchy rewrites their appointment, so it is its own
  // resource rather than a right bundled with editing employee records.
  promotions: "promotions",
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
  /*
   * My Attendance is the signed-in person's own DTR, so it follows the personal-records resource the
   * way My IPCR does, not `attendance`, which opens everybody's records. The Regional Director and
   * the Cashier hold no `attendance` right, and under it they had no way to their own DTR.
   */
  myAttendance: "serviceRecord",
  myPayslip: "payslip",
  myIpcr: "serviceRecord",
  myServiceRecord: "serviceRecord",
  // The signed-in person's own awards: a personal record, not the right to run nominations.
  myRewards: "serviceRecord",
  // An employee's own ballot follows My Rewards for the same reason: casting a vote is taking part in
  // an award, not running one. The API is what limits voting to the Employee role.
  awardVoting: "serviceRecord",
};

// These utilities have no module checkbox in RBAC. Personal record pages do, and
// follow that resource's permission while retaining their own-record data scope.
const ALWAYS_ALLOWED_MODULES = new Set([
  "messages",
  "notifications",
]);

function permissionListHasAction(permissionList, action) {
  if (Array.isArray(permissionList)) {
    return permissionList.includes(action);
  }

  if (!permissionList || typeof permissionList !== "object") {
    return false;
  }

  if (permissionList.enabled === false) {
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

  if (permissionList.enabled === false) {
    return false;
  }

  if (Array.isArray(permissionList.actions)) {
    return permissionList.enabled !== false && permissionList.actions.length > 0;
  }

  return Object.entries(permissionList).some(([action, allowed]) => action !== "enabled" && allowed === true);
}

export function permissionResourceForModule(moduleKey) {
  const key = String(moduleKey || "").trim();

  return MODULE_PERMISSION_MAP[key] || null;
}

export function userHasPermission(user, resource, action = "view") {
  if (!user || !resource) {
    return false;
  }

  const permissions = user.permissions || {};
  const resourcePermissions = permissions[resource];

  return permissionListHasAction(resourcePermissions, action);
}

export function userCanAccessResource(user, resource) {
  if (!user || !resource) {
    return false;
  }

  return permissionListHasAnyAction(user.permissions?.[resource]);
}

export function userCanAccessModule(user, moduleKey) {
  const key = String(moduleKey || "").trim();

  if (!user || !key) {
    return false;
  }

  if (ALWAYS_ALLOWED_MODULES.has(key)) {
    return true;
  }

  const resource = permissionResourceForModule(key);

  if (!resource) {
    return false;
  }

  return userHasPermission(user, resource, "view");
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
