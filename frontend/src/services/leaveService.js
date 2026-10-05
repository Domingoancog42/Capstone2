import api from "./api";
import { normalizeLeaveStatus } from "../utils/leaveHelpers";
import { notifyNotificationsChanged } from "./notificationService";

export const LEAVE_REQUESTS_CHANGED_EVENT = "leave-requests:changed";

export async function fetchLeaveRequests({ archived = false } = {}) {
  const response = await api.get("/leave_request.php", {
    params: archived ? { archived: 1 } : {},
  });
  return response.data;
}

export async function fetchLeaveRequestById(requestId) {
  const response = await api.get("/leave_request.php", {
    params: {
      id: requestId,
    },
  });
  return response.data;
}

export async function fetchLeaveTypes() {
  const response = await api.get("/leave_request.php", {
    params: {
      resource: "leave_types",
    },
  });
  return response.data;
}

export async function fetchLeaveCredits(employeeRecordId = null, year = null) {
  const params = {};

  if (employeeRecordId) {
    params.employeeRecordId = employeeRecordId;
  }

  if (year) {
    params.year = year;
  }

  const response = await api.get("/leave_credit.php", { params });
  return response.data;
}

export function notifyLeaveRequestsChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(LEAVE_REQUESTS_CHANGED_EVENT));
}

function buildLeaveRequestFormData(payload) {
  const formData = new FormData();

  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (key === "attachment" && value instanceof File) {
      formData.append(key, value);
      return;
    }

    formData.append(key, typeof value === "string" ? value : String(value));
  });

  return formData;
}

export async function fileLeaveRequest(payload) {
  if (typeof File !== "undefined" && payload?.attachment instanceof File) {
    const response = await api.post("/leave_request.php", buildLeaveRequestFormData(payload), {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    notifyLeaveRequestsChanged({ broadcast: true });
    notifyNotificationsChanged();
    return response.data;
  }

  const response = await api.post("/leave_request.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  notifyNotificationsChanged();
  return response.data;
}

/**
 * Marking a leave request reviewed or approved carries a solved captcha, because leave_request.php
 * refuses those two transitions without one -- see require_approval_captcha() there. `captcha` is
 * the `{ captchaId, captchaAnswer }` pair requestApprovalCaptcha() returns; rejections and
 * cancellations pass nothing and are not gated. Sending nothing on a gated transition simply gets
 * a 422 back with `captchaFailed`, which is the same answer a forged or stale pair gets.
 */
export async function updateLeaveStatus(requestId, status, rejectedNote = "", captcha = {}) {
  const response = await api.put("/leave_request.php", {
    id: requestId,
    status: normalizeLeaveStatus(status),
    rejectedNote: String(rejectedNote || "").trim(),
    ...captcha,
  });
  notifyLeaveRequestsChanged();
  notifyNotificationsChanged();
  return response.data;
}

export async function resetLeaveStore() {
  return { success: true };
}
