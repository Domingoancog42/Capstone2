/**
 * The categories the backend groups its report catalog into — these keys must match
 * `reports_category_labels()` in `backend/api/reports.php`, because the frontend filters the
 * catalog payload by them.
 *
 * The list lives here rather than in each dashboard so the sidebar children, the path parsing, and
 * the workspace module map are all generated from one edit instead of drifting apart.
 */
export const REPORT_CATEGORIES = [
  {
    key: "employee",
    navKey: "reportsEmployee",
    label: "Employee Report",
    title: "Employee Reports",
    description: "Headcount, demographics, employment status, and master list records.",
  },
  {
    key: "payroll",
    navKey: "reportsPayroll",
    label: "Payroll Report",
    title: "Payroll Reports",
    description: "Payroll registers, releases, deductions, and net pay summaries.",
  },
  {
    key: "leave",
    navKey: "reportsLeave",
    label: "Leave Report",
    title: "Leave Reports",
    description: "Leave applications, balances, utilisation, and monetisation.",
  },
  {
    key: "travel",
    navKey: "reportsTravel",
    label: "Travel Order Report",
    title: "Travel Order Reports",
    description: "Travel orders, destinations, days away, and approval status.",
  },
  {
    key: "cto",
    navKey: "reportsCto",
    label: "CTO Report",
    title: "Compensatory Time Off Reports",
    description: "CTO requests, hours taken, unpaid hours, and approval status.",
  },
  {
    key: "attendance",
    navKey: "reportsAttendance",
    label: "Attendance Report",
    title: "Attendance Reports",
    description: "Daily attendance, absences, tardiness, overtime, and CTO.",
  },
  {
    key: "performance",
    navKey: "reportsPerformance",
    label: "Performance Report",
    title: "Performance Reports",
    description: "IPCR and OPCR summaries, top performers, and division ratings.",
  },
  {
    key: "audit",
    navKey: "reportsAudit",
    label: "Audit Report",
    title: "Audit Reports",
    description: "Activity logs, login history, and report actions.",
  },
];

/** Report categories the Admin desk does not show. The sidebar and the admin page share it. */
export const ADMIN_HIDDEN_REPORT_CATEGORIES = ["audit"];

/**
 * The categories a role's sidebar and module map are built from. `exclude` names the category keys
 * a role does not get -- the HR Staff desk has no Audit tab -- and must agree with
 * reports_blocked_category_keys() in reports.php, which refuses those reports at the API too.
 * The Admin and HR Head desks also leave Audit out, but only from their screens; the API still
 * serves it to them.
 */
function reportCategoriesFor({ exclude = [] } = {}) {
  const excluded = new Set(exclude);

  return REPORT_CATEGORIES.filter((category) => !excluded.has(category.key));
}

/** Sidebar children for a role's Reports item, e.g. `buildReportNavChildren("/admin/reports")`. */
export function buildReportNavChildren(basePath, options = {}) {
  return reportCategoriesFor(options).map((category) => ({
    key: category.navKey,
    label: category.label,
    path: `${basePath}/${category.key}`,
  }));
}

/**
 * Returns "" for the bare reports route or an unknown segment, which is the signal the screen uses
 * to show its "pick a category" state rather than guessing at a report. A category in
 * `options.exclude` counts as unknown, so a typed-in URL cannot reach a tab the role does not have.
 */
export function reportCategoryFromPath(pathname, basePath, options = {}) {
  const path = String(pathname || "");
  const prefix = `${basePath}/`;

  if (!path.startsWith(prefix)) {
    return "";
  }

  const [candidate] = path.slice(prefix.length).split("/");

  return reportCategoriesFor(options).some((category) => category.key === candidate) ? candidate : "";
}

/**
 * Workspace module entries, one per category, each rendering the same reports screen scoped to its
 * own category. `renderCategory` receives the category key and the workspace render context
 * (`{ user, currentPath, onNavigate }`), so a role can pass `user` through for export attribution.
 * `options.exclude` leaves a category's module out, the same way it leaves its sidebar entry out.
 */
export function buildReportCategoryModules(renderCategory, options = {}) {
  return reportCategoriesFor(options).reduce((modules, category) => {
    modules[category.navKey] = {
      title: category.title,
      description: category.description,
      hidePageIntro: true,
      render: (context = {}) => renderCategory(category.key, context),
    };

    return modules;
  }, {});
}
