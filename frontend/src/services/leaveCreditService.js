import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";

export async function fetchLeaveBalanceRows(year = null) {
  const params = { list: 1 };

  if (year) {
    params.year = year;
  }

  const response = await api.get("/leave_credit.php", { params });
  return response.data;
}

export async function fetchLeaveBalanceHistory(employeeRecordId, year = null, leaveTypeCode = "") {
  const params = {
    history: 1,
    employeeRecordId,
  };

  if (year) {
    params.year = year;
  }

  if (leaveTypeCode) {
    params.leaveTypeCode = leaveTypeCode;
  }

  const response = await api.get("/leave_credit.php", { params });
  return response.data;
}

export async function saveLeaveBalance(payload) {
  const response = await api.put("/leave_credit.php", payload);
  notifyLeaveRequestsChanged();
  return response.data;
}

export async function adjustLeaveBalances(payload) {
  const response = await api.put("/leave_credit.php", {
    action: "adjust",
    ...payload,
  });
  notifyLeaveRequestsChanged();
  return response.data;
}

export async function bulkAddLeaveCredits(payload) {
  const response = await api.put("/leave_credit.php", {
    action: "bulk_add",
    ...payload,
  });
  notifyLeaveRequestsChanged();
  return response.data;
}

export async function resetEmployeeLeaveCredits(employeeRecordId, year = null, effectiveDate = "", remarks = "") {
  const response = await api.put("/leave_credit.php", {
    action: "reset",
    employeeRecordId,
    year,
    effectiveDate,
    remarks,
  });
  notifyLeaveRequestsChanged();
  return response.data;
}
