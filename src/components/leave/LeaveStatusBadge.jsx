import React from "react";
import {
  getRequestTableStatusLabel,
  getStatusBadgeClasses,
  isCurrentDateWithin,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { getRoleLabel } from "../../utils/roleRoutes";

/* Every module stores a disapproval as "rejected"; screens show it as the forms word it. */
export function getDisapprovedStatusLabel(rejectedByRole = "") {
  return String(rejectedByRole || "").trim()
    ? `Disapproved by ${getRoleLabel(rejectedByRole)}`
    : "Disapproved";
}

export function getLeaveStatusDisplayLabel(status, rejectedByRole = "") {
  const normalizedStatus = normalizeLeaveStatus(status);

  if (normalizedStatus === "Pending") {
    return "Pending Leave Balance Verification";
  }

  if (normalizedStatus === "Endorsed") {
    return "Pending HR Head Approval";
  }

  if (normalizedStatus === "Reviewed") {
    return "Pending Division Chief Review";
  }

  if (normalizedStatus === "Chief Reviewed") {
    return "Pending Regional Director Approval";
  }

  if (normalizedStatus === "Rejected" && String(rejectedByRole || "").trim()) {
    return getDisapprovedStatusLabel(rejectedByRole);
  }

  return normalizedStatus;
}

export function getLeaveManagementStatusLabel(
  status,
  rejectedByRole = "",
  isLeaveMonetization = false
) {
  const normalizedStatus = normalizeLeaveStatus(status);

  if (normalizedStatus === "Pending") {
    return isLeaveMonetization ? "Pending by HR Head" : "Pending Leave Balance Verification";
  }

  if (normalizedStatus === "Endorsed") {
    return "Pending HR Head Approval";
  }

  if (normalizedStatus === "Reviewed") {
    return "Pending Division Chief Approval";
  }

  if (normalizedStatus === "Chief Reviewed") {
    return "Pending Regional Director Approval";
  }

  return getLeaveStatusDisplayLabel(status, rejectedByRole);
}

/** Only the initial leave stage needs an explanatory line in management tables. */
export function getLeaveManagementStatusRoleHint(status, isLeaveMonetization = false) {
  const normalizedStatus = normalizeLeaveStatus(status);

  if (normalizedStatus === "Pending" && !isLeaveMonetization) {
    return "For HR Staff verification";
  }

  return "";
}

export function isApprovedLeaveActive(status, startDate, endDate, targetDate = new Date()) {
  return normalizeLeaveStatus(status) === "Approved"
    && isCurrentDateWithin(startDate, endDate, targetDate);
}

export default function LeaveStatusBadge({
  status,
  rejectedByRole = "",
  simplified = false,
  pendingByRole = false,
  labelOverride = "",
  isLeaveMonetization = false,
  startDate = "",
  endDate = "",
  className = "",
}) {
  const isOnLeave = isApprovedLeaveActive(status, startDate, endDate);
  const defaultDisplayLabel = pendingByRole
    ? getLeaveManagementStatusLabel(status, rejectedByRole, isLeaveMonetization)
    : simplified
      ? getRequestTableStatusLabel(status)
      : getLeaveStatusDisplayLabel(status, rejectedByRole);
  const displayLabel = String(labelOverride || "").trim() || defaultDisplayLabel;
  const badgeStatus = simplified || pendingByRole
    ? getRequestTableStatusLabel(status)
    : status;
  const roleHint = pendingByRole
    ? getLeaveManagementStatusRoleHint(status, isLeaveMonetization)
    : "";

  const badge = (
    <span
      className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${getStatusBadgeClasses(
        badgeStatus
      )} ${className}`.trim()}
    >
      {isOnLeave
        ? "On Leave"
        : displayLabel}
    </span>
  );

  if (!roleHint || isOnLeave) {
    return badge;
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {badge}
      <span className="pl-1 text-[11px] italic leading-4 text-slate-500">{roleHint}</span>
    </span>
  );
}
