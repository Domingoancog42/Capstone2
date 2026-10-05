import api from "./api";
import { downloadExportFile, exportApiBaseUrl } from "./exportDownload";
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

export async function importAttendanceCsv(file, cutoff = {}) {
  const formData = new FormData();
  formData.append("action", "import");
  formData.append("attendanceFile", file);
  /* The cut-off lets the API fence the import to one payroll period and label the notification. */
  if (cutoff.dateFrom && cutoff.dateTo) {
    formData.append("dateFrom", cutoff.dateFrom);
    formData.append("dateTo", cutoff.dateTo);
    formData.append("payPeriod", cutoff.payPeriod || "");
  }
  const response = await api.post("/attendance.php?action=import", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  notifyAttendanceChanged({ broadcast: true });
  notifyNotificationsChanged();
  return response.data;
}

export async function fetchAttendanceImportHistory(params = {}) {
  const response = await api.get("/attendance.php", {
    params: {
      action: "imports",
      ...params,
    },
  });
  return response.data;
}

export async function fetchAttendanceLogs(recordId, params = {}) {
  const response = await api.get("/attendance.php", {
    params: {
      action: "logs",
      recordId,
      ...params,
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

export async function exportAttendanceDtrExcel(params = {}, filename = "daily-time-record.xlsx") {
  const url = new URL("attendance.php", exportApiBaseUrl());
  url.searchParams.set("action", "export_dtr_xlsx");

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  await downloadExportFile(url, filename, "Unable to export the Daily Time Record to Excel.");
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
