import { normalizeRole } from "./roleRoutes";

export const ALL_DIVISIONS_LABEL = "All Divisions";

/*
 * Roles whose desk is organization-wide rather than one division's. Their workspaces already
 * present them as "All Divisions / Organization-wide access" (see the role dashboards), so a row
 * they filed reads the same in every Division column instead of naming the division their
 * employee record happens to sit in. The Chief and a plain Employee belong to one division.
 */
export const ORGANIZATION_WIDE_ROLES = new Set([
  "hrstaff",
  "hrhead",
  "regionaldirector",
  "planningofficer",
  "cashier",
]);

export function isOrganizationWideRole(role) {
  return ORGANIZATION_WIDE_ROLES.has(normalizeRole(role));
}

/**
 * The Division cell for a record filed by `record.employeeRole` in `record.division`.
 * Display only — filters keep matching on the stored division.
 */
export function formatRecordDivision(record, fallback = "Unassigned") {
  if (isOrganizationWideRole(record?.employeeRole)) {
    return ALL_DIVISIONS_LABEL;
  }

  return String(record?.division || "").trim() || fallback;
}
