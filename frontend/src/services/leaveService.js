import api from "./api";
import { normalizeLeaveStatus } from "../utils/leaveHelpers";
import { notifyNotificationsChanged } from "./notificationService";

export const LEAVE_REQUESTS_CHANGED_EVENT = "leave-requests:changed";

export async function fetchLeaveRequests() {
  const response = await api.get("/leave_request.php");
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

export async function updateLeaveStatus(requestId, status, rejectedNote = "") {
  const response = await api.put("/leave_request.php", {
    id: requestId,
    status: normalizeLeaveStatus(status),
    rejectedNote: String(rejectedNote || "").trim(),
  });
  notifyLeaveRequestsChanged();
  notifyNotificationsChanged();
  return response.data;
}

export async function resetLeaveStore() {
  return { success: true };
}
