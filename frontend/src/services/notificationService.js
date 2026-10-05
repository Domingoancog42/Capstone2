import api from "./api";
import { scalePollInterval } from "../components/auto/autorefreshconfig";
import { getProfilePathForRole, normalizeRole } from "../utils/roleRoutes";

export const NOTIFICATIONS_CHANGED_EVENT = "hris:notifications:changed";
export const NOTIFICATION_BELL_POLL_INTERVAL_MS = scalePollInterval(30000);

export const NOTIFICATION_TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "user_created", label: "User Created" },
  { value: "employee_added", label: "Employee Added" },
  { value: "leave_request_submitted", label: "Leave Request Submitted" },
  { value: "leave_request_approved", label: "Leave Request Approved" },
  { value: "leave_request_rejected", label: "Leave Request Rejected" },
  { value: "leave_monetization_submitted", label: "Leave Monetization Filed" },
  { value: "leave_monetization_approved", label: "Leave Monetization Approved" },
  { value: "leave_monetization_rejected", label: "Leave Monetization Rejected" },
  { value: "leave_monetization_updated", label: "Leave Monetization Updated" },
  { value: "travel_order_approved", label: "Travel Order Approved" },
  { value: "payroll_generated", label: "Payroll Generated" },
  { value: "payroll_submitted", label: "Payroll Submitted" },
  { value: "payroll_approved", label: "Payroll Approved" },
  { value: "payroll_rejected", label: "Payroll Rejected" },
  { value: "payroll_paid", label: "Payroll Paid" },
  { value: "attendance_updated", label: "Attendance Updated" },
  { value: "account_activated", label: "Account Activated" },
  { value: "account_deactivated", label: "Account Deactivated" },
  { value: "suspicious_login", label: "Suspicious Login" },
  { value: "account_locked", label: "Account Locked" },
  { value: "role_updated", label: "Role Updated" },
  { value: "permission_updated", label: "Permission Updated" },
  { value: "access_request", label: "Access Requested" },
  { value: "access_granted", label: "Access Granted" },
  { value: "profile_edit_request", label: "Personal Details Edit Requested" },
  { value: "profile_edit_approved", label: "Personal Details Edit Decided" },
  { value: "system_alert", label: "System Alerts" },
  { value: "custom", label: "Custom Notifications" },
];

/*
 * Alerts about the security of an account rather than about its work. They are raised for
 * administrators only and are the one kind of notification that reports on somebody other than the
 * reader, so they are singled out visually and never share the neutral styling of the rest.
 */
export const SECURITY_NOTIFICATION_TYPES = ["suspicious_login", "account_locked"];

export function isSecurityNotificationType(value) {
  return SECURITY_NOTIFICATION_TYPES.includes(normalizeNotificationType(value));
}

export const NOTIFICATION_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const notificationDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const notificationTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function dispatchChangedEvent() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT));
}

export function notifyNotificationsChanged() {
  dispatchChangedEvent();
}

export function normalizeNotificationType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getNotificationTypeLabel(value) {
  const type = normalizeNotificationType(value);

  switch (type) {
    case "user_created":
      return "User Created";
    case "employee_added":
      return "Employee Added";
    case "leave_request_submitted":
      return "Leave Request Submitted";
    case "leave_request_approved":
      return "Leave Request Approved";
    case "leave_request_rejected":
      return "Leave Request Rejected";
    case "leave_monetization_submitted":
      return "Leave Monetization Filed";
    case "leave_monetization_approved":
      return "Leave Monetization Approved";
    case "leave_monetization_rejected":
      return "Leave Monetization Rejected";
    case "leave_monetization_updated":
      return "Leave Monetization Updated";
    case "travel_order_approved":
      return "Travel Order Approved";
    case "payroll_generated":
      return "Payroll Generated";
    case "payroll_submitted":
      return "Payroll Submitted";
    case "payroll_approved":
      return "Payroll Approved";
    case "payroll_rejected":
      return "Payroll Rejected";
    case "payroll_paid":
      return "Payroll Paid";
    case "attendance_updated":
      return "Attendance Updated";
    case "account_activated":
      return "Account Activated";
    case "account_deactivated":
      return "Account Deactivated";
    case "suspicious_login":
      return "Suspicious Login";
    case "account_locked":
      return "Account Locked";
    case "role_updated":
      return "Role Updated";
    case "permission_updated":
      return "Permission Updated";
    case "access_request":
      return "Access Requested";
    case "access_granted":
      return "Access Granted";
    case "profile_edit_request":
      return "Personal Details Edit Requested";
    case "profile_edit_approved":
      return "Personal Details Edit Decided";
    case "ipcr_for_approval":
      return "IPCR For Approval";
    case "ipcr_approved":
      return "IPCR Approved";
    case "ipcr_returned":
      return "IPCR Returned";
    case "ipcr_assigned":
      return "IPCR Assigned";
    case "ipcr_submitted":
      return "IPCR For Validation";
    case "ipcr_validated":
      return "IPCR Validated";
    case "opcr_assigned":
      return "OPCR Assigned";
    case "opcr_submitted":
      return "OPCR For Validation";
    case "opcr_validated":
      return "OPCR Validated";
    case "opcr_returned":
      return "OPCR Returned";
    case "system_alert":
      return "System Alerts";
    case "award_received":
      return "Award Received";
    case "award_voting_open":
      return "Voting Open";
    case "custom":
      return "Custom Notification";
    default:
      return type ? type.replace(/_/g, " ") : "Notification";
  }
}

export function normalizeNotificationRecord(record = {}) {
  return {
    id: Number(record.id ?? record.notificationId ?? 0),
    userId: Number(record.userId ?? record.user_id ?? 0),
    title: String(record.title ?? "").trim(),
    message: String(record.message ?? "").trim(),
    type: normalizeNotificationType(record.type),
    typeLabel: record.typeLabel || getNotificationTypeLabel(record.type),
    isRead: Boolean(Number(record.isRead ?? record.is_read ?? 0)),
    referenceId: String(record.referenceId ?? record.reference_id ?? "").trim(),
    createdAt: String(record.createdAt ?? record.created_at ?? ""),
  };
}

export function formatNotificationRelativeTime(value) {
  const date = new Date(String(value || ""));

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) {
    return "Just now";
  }

  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) {
    return relativeTimeFormatter.format(-diffMinutes, "minute");
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return relativeTimeFormatter.format(-diffHours, "hour");
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((startOfToday - startOfTarget) / 86_400_000);

  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return relativeTimeFormatter.format(-diffDays, "day");
  }

  return notificationDateFormatter.format(date);
}

export function getNotificationDateGroupLabel(value) {
  const date = new Date(String(value || ""));

  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }

  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((current - target) / 86_400_000);

  if (diffDays <= 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return "This Week";
  }

  if (diffDays < 31) {
    return "This Month";
  }

  return notificationDateFormatter.format(date);
}

export function formatNotificationDateTime(value) {
  const date = new Date(String(value || ""));

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${notificationDateFormatter.format(date)} at ${notificationTimeFormatter.format(date)}`;
}

export function getNotificationRoute(notification = {}, roleKey = "") {
  const type = normalizeNotificationType(notification.type);
  const role = normalizeRole(roleKey) || "employee";
  const profilePath = getProfilePathForRole(role);

  switch (type) {
    case "employee_added":
      return role === "admin" ? "/admin/employees" : profilePath;
    case "user_created":
    case "account_activated":
    case "account_deactivated":
    case "role_updated":
    case "permission_updated":
      return role === "admin" ? "/admin/users" : profilePath;
    /*
     * User management, where the locked account can be inspected and released. No fallback for the
     * other roles: they are never sent these, and the profile page they would otherwise land on is
     * not theirs to begin with.
     */
    case "suspicious_login":
    case "account_locked":
      return role === "admin" ? "/admin/users" : "";
    case "leave_request_submitted":
    case "leave_request_approved":
    case "leave_request_rejected":
      return role === "employee" ? "/employee/leave-request" : `/${role}/leave`;
    /* Monetization is filed and reviewed in the leave list, alongside the leave requests. */
    case "leave_monetization_submitted":
    case "leave_monetization_approved":
    case "leave_monetization_rejected":
    case "leave_monetization_updated":
      return role === "employee" ? "/employee/leave-request" : `/${role}/leave`;
    case "payroll_generated":
    case "payroll_submitted":
    case "payroll_approved":
    case "payroll_rejected":
    case "payroll_paid":
      return role === "employee" ? "/employee/payslip" : `/${role}/payroll/generate`;
    /*
     * The approval is only half the step: the employee still has to accept the COA clause, and the
     * Authorize action that does it lives on their own travel order screen. Every other role has
     * theirs under Leave Management.
     */
    case "travel_order_approved":
      return role === "employee" ? "/employee/travel-order" : `/${role}/leave/travel-order`;
    case "attendance_updated":
      return `/${role}/attendance`;
    case "profile_edit_request":
    case "profile_edit_approved":
      return `/${role}/profile`;
    /*
     * Submitted KPIs waiting on their rater, who validates them on the IPCR desk. The approval
     * types are from the retired chief-assignment workflow, kept so old rows still open the desk.
     */
    case "ipcr_submitted":
    case "ipcr_for_approval":
    case "ipcr_approved":
      return ["admin", "hrhead", "hrstaff", "chief", "chiefadmin"].includes(role)
        ? `/${role}/masterfiles/performance-management/ipcr`
        : "";
    /* The rater's decision, and new KPIs: the employee reads all of them on My IPCR. */
    case "ipcr_validated":
    case "ipcr_returned":
    case "ipcr_assigned":
      if (role === "employee") return "/employee/ipcr";
      /* Admin has no My IPCR page. */
      return role === "admin" ? "" : `/${role}/my-ipcr`;
    /*
     * The OPCR workflow: the HR Head assigns KPIs to a division, its chief submits the
     * accomplishments and MOVs, and the Regional Director validates them. Every step is worked on
     * the OPCR desk, which sits at the same address under each of those roles.
     */
    case "opcr_assigned":
    case "opcr_submitted":
    case "opcr_validated":
    case "opcr_returned":
      return ["admin", "hrhead", "hrstaff", "chief", "chiefadmin", "regionaldirector"].includes(role)
        ? `/${role}/masterfiles/performance-management/opcr`
        : "";
    /*
     * A won award: the employee's My Rewards page. The roles that run nominations reach the same
     * list through the My Rewards button on their Nomination screen.
     */
    case "award_received":
      if (role === "employee") return "/employee/rewards";
      return ["admin", "hrhead", "chief", "chiefadmin"].includes(role)
        ? `/${role}/rewards-recognition/nomination`
        : "";
    /* Only employees vote, so only they are sent this — straight to the ballot. */
    case "award_voting_open":
      return role === "employee" ? "/employee/voting" : "";
    default:
      return "";
  }
}

export function getNotificationsCenterPath(roleKey = "") {
  const role = normalizeRole(roleKey);

  if (!role) {
    return "/admin/notifications";
  }

  return role === "admin" ? "/admin/notifications" : `/${role}/notifications`;
}

export async function fetchNotifications(params = {}) {
  const response = await api.get("/notifications.php", { params });
  const notifications = Array.isArray(response.data?.notifications)
    ? response.data.notifications.map(normalizeNotificationRecord)
    : [];

  return {
    ...response.data,
    notifications,
  };
}

export async function markNotificationRead(id) {
  const response = await api.post("/notifications.php", {
    action: "mark_read",
    id,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function markNotificationsRead(ids = []) {
  const response = await api.post("/notifications.php", {
    action: "mark_selected_read",
    ids,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function markAllNotificationsRead() {
  const response = await api.post("/notifications.php", {
    action: "mark_all_read",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function createNotification(payload) {
  const response = await api.post("/notifications.php", {
    action: "create",
    ...payload,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function deleteNotification(id) {
  const response = await api.delete("/notifications.php", {
    data: { id },
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function deleteNotifications(ids = []) {
  const response = await api.delete("/notifications.php", {
    data: { ids },
  });
  notifyNotificationsChanged();
  return response.data;
}
