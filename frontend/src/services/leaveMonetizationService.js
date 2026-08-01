import api from "./api";
import { normalizeLeaveStatus } from "../utils/leaveHelpers";
import { notifyNotificationsChanged } from "./notificationService";

export const LEAVE_MONETIZATION_CHANGED_EVENT = "leave-monetization:changed";

export function notifyLeaveMonetizationChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(LEAVE_MONETIZATION_CHANGED_EVENT));
}

export async function fetchLeaveMonetizationRequests() {
  const response = await api.get("/leave_monetization.php");
  return response.data;
}

export async function fetchLeaveMonetizationById(recordId) {
  const response = await api.get("/leave_monetization.php", {
    params: {
      id: recordId,
    },
  });
  return response.data;
}

export async function fetchMonetizableLeaveCredits(employeeRecordId = null, year = null) {
  const params = { credits: 1 };

  if (employeeRecordId) {
    params.employeeRecordId = employeeRecordId;
  }

  if (year) {
    params.year = year;
  }

  const response = await api.get("/leave_monetization.php", { params });
  return response.data;
}

export async function fileLeaveMonetizationRequest(payload) {
  const response = await api.post("/leave_monetization.php", payload);
  notifyLeaveMonetizationChanged();
  notifyNotificationsChanged();
  return response.data;
}

export async function updateLeaveMonetizationStatus(recordId, status, rejectedNote = "") {
  const response = await api.put("/leave_monetization.php", {
    id: recordId,
    status: normalizeLeaveStatus(status),
    rejectedNote: String(rejectedNote || "").trim(),
  });
  notifyLeaveMonetizationChanged();
  notifyNotificationsChanged();
  return response.data;
}
