import React, { useCallback } from "react";
import ChiefDashboard from "../Chief/chiefdashboard";

const CHIEF_ROUTE_PREFIX = "/chief";
const CHIEF_ADMIN_ROUTE_PREFIX = "/chiefadmin";
/*
 * Replaces the Division Chief's set, so Payroll stays: Chief Admin gives the second payroll approval
 * (HR Head -> Chief Admin -> Regional Director), which a Division Chief does not.
 */
const CHIEF_ADMIN_HIDDEN_NAVIGATION_KEYS = ["employees"];
const CHIEF_ADMIN_DASHBOARD_OVERVIEW_PROPS = {
  showTeamDivisionSection: false,
  showTravelLeaveSection: false,
  pendingCardLabel: "Pending",
  showApprovedCard: true,
};

function replaceWorkspacePrefix(path, sourcePrefix, targetPrefix) {
  const value = String(path || "");

  if (value === sourcePrefix) {
    return targetPrefix;
  }

  return value.startsWith(`${sourcePrefix}/`)
    ? `${targetPrefix}${value.slice(sourcePrefix.length)}`
    : value;
}

export function toChiefWorkspacePath(path) {
  return replaceWorkspacePrefix(path, CHIEF_ADMIN_ROUTE_PREFIX, CHIEF_ROUTE_PREFIX);
}

export function toChiefAdminWorkspacePath(path) {
  return replaceWorkspacePrefix(path, CHIEF_ROUTE_PREFIX, CHIEF_ADMIN_ROUTE_PREFIX);
}

/**
 * Chief Admin uses the Division Chief workspace and data scope, but owns a distinct URL prefix.
 * Translating at this boundary keeps the mature Chief navigation/modules as the single source of
 * truth while every browser-visible route remains under /chiefadmin.
 */
export default function ChiefAdminDashboard({ currentPath, onNavigate, ...props }) {
  const handleNavigate = useCallback((path, ...args) => {
    onNavigate?.(toChiefAdminWorkspacePath(path), ...args);
  }, [onNavigate]);

  return (
    <ChiefDashboard
      {...props}
      currentPath={toChiefWorkspacePath(currentPath || "/chiefadmin/dashboard")}
      onNavigate={handleNavigate}
      portalLabel="Chief Admin Workspace"
      hiddenNavigationKeys={CHIEF_ADMIN_HIDDEN_NAVIGATION_KEYS}
      dashboardOverviewProps={CHIEF_ADMIN_DASHBOARD_OVERVIEW_PROPS}
    />
  );
}
