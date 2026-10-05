import { resolveUserRoleKey } from "../../utils/roleRoutes";

/* Reserved for a future report desk that the API confines to one division. HR Staff are unscoped. */
const DIVISION_SCOPED_REPORT_ROLE_KEYS = new Set();
const DIVISION_SCOPED_REPORT_CATEGORIES = new Set(["employee", "payroll", "leave", "travel", "cto", "attendance", "performance"]);

/** Whether this user's reports in `category` are pinned to their own division. */
export function isDivisionScopedReportDesk(user, category) {
  return DIVISION_SCOPED_REPORT_ROLE_KEYS.has(resolveUserRoleKey(user))
    && DIVISION_SCOPED_REPORT_CATEGORIES.has(category);
}

/** The division a scoped desk's reports are pinned to, or "" when its profile names none. */
export function scopedReportDivision(user) {
  return String(user?.division || user?.department || "").trim();
}

/** The line under a scoped screen's heading: what it covers, or why it covers nothing. */
export function scopedReportDescription(scopedDivision, fallback) {
  if (scopedDivision) {
    return `${fallback.replace(/\.$/, "")} for ${scopedDivision}.`;
  }

  return "Your employee profile has no assigned division, so there is nothing to report on. Ask an administrator to set your division in Employee Management.";
}
