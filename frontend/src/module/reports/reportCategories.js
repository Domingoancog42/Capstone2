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

const REPORT_CATEGORY_KEYS = REPORT_CATEGORIES.map((category) => category.key);

/** Sidebar children for a role's Reports item, e.g. `buildReportNavChildren("/admin/reports")`. */
export function buildReportNavChildren(basePath) {
  return REPORT_CATEGORIES.map((category) => ({
    key: category.navKey,
    label: category.label,
    path: `${basePath}/${category.key}`,
  }));
}

/**
 * Returns "" for the bare reports route or an unknown segment, which is the signal the screen uses
 * to show its "pick a category" state rather than guessing at a report.
 */
export function reportCategoryFromPath(pathname, basePath) {
  const path = String(pathname || "");
  const prefix = `${basePath}/`;

  if (!path.startsWith(prefix)) {
    return "";
  }

  const [candidate] = path.slice(prefix.length).split("/");

  return REPORT_CATEGORY_KEYS.includes(candidate) ? candidate : "";
}

/**
 * Workspace module entries, one per category, each rendering the same reports screen scoped to its
 * own category. `renderCategory` receives the category key and the workspace render context
 * (`{ user, currentPath, onNavigate }`), so a role can pass `user` through for export attribution.
 */
export function buildReportCategoryModules(renderCategory) {
  return REPORT_CATEGORIES.reduce((modules, category) => {
    modules[category.navKey] = {
      title: category.title,
      description: category.description,
      hidePageIntro: true,
      render: (context = {}) => renderCategory(category.key, context),
    };

    return modules;
  }, {});
}
