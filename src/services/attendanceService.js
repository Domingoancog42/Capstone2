import api from "./api";
import { notifyNotificationsChanged } from "./notificationService";

export const ATTENDANCE_CHANGED_EVENT = "attendance:changed";

export function notifyAttendanceChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(ATTENDANCE_CHANGED_EVENT));
}

export async function fetchAttendanceRecords(params = {}) {
  const response = await api.get("/attendance.php", { params });
  return response.data;
}

export async function importAttendanceCsv(file) {
  const formData = new FormData();
  formData.append("action", "import");
  formData.append("attendanceFile", file);

  const response = await api.post("/attendance.php?action=import", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  notifyAttendanceChanged({ broadcast: true });
  notifyNotificationsChanged();
  return response.data;
}

export async function fetchAttendanceLogs(recordId) {
  const response = await api.get("/attendance.php", {
    params: {
      action: "logs",
      recordId,
    },
  });
  return response.data;
}

export async function fetchAttendanceDtr(params = {}) {
  const response = await api.get("/attendance.php", {
    params: {
      action: "dtr",
      ...params,
    },
  });
  return response.data;
}

export async function updateAttendanceRecord(recordId, payload) {
  const response = await api.put("/attendance.php", {
    ...payload,
    id: recordId,
  });

  notifyAttendanceChanged();
  notifyNotificationsChanged();
  return response.data;
}

export async function requestAttendanceAdjustment(recordId, payload) {
  const response = await api.post("/attendance.php?action=requestAdjustment", {
    ...payload,
    recordId,
  });

  notifyAttendanceChanged({ broadcast: true });
  notifyNotificationsChanged();
  return response.data;
}

export async function updateAttendanceAdjustmentStatus(adjustmentId, status, remarks = "") {
  const response = await api.put("/attendance.php", {
    action: "adjustmentStatus",
    adjustmentId,
    status,
    remarks,
  });

  notifyAttendanceChanged();
  notifyNotificationsChanged();
  return response.data;
}
