import React from "react";
import { getStatusBadgeClasses, normalizeLeaveStatus } from "../../utils/leaveHelpers";

export function getLeaveStatusDisplayLabel(status, roleKey = "") {
  const normalizedStatus = normalizeLeaveStatus(status);
  const normalizedRoleKey = String(roleKey || "").trim().toLowerCase();

  if (normalizedRoleKey === "hrhead" && normalizedStatus === "Reviewed") {
    return "Approved by HR";
  }

  return normalizedStatus;
}

export default function LeaveStatusBadge({ status, className = "", roleKey = "" }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${getStatusBadgeClasses(
        status
      )} ${className}`.trim()}
    >
      {getLeaveStatusDisplayLabel(status, roleKey)}
    </span>
  );
}
