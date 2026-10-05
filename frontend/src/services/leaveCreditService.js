import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";

export async function fetchLeaveBalanceRows(year = null, { archived = false } = {}) {
  const params = { list: 1 };

  if (year) {
    params.year = year;
  }

  if (archived) {
    params.archived = 1;
  }

  try {
    const response = await api.get("/leave_credit.php", { params });
    return response.data;
  } catch (error) {
    /*
     * Some installations answer an empty archive with 404 instead of the list endpoint's normal
     * `{ rows: [] }` response. An empty archive is a valid view, not a missing screen, so normalize
     * only that exact read. Active-registry failures and every other status still reach the caller.
     */
    if (archived && error?.response?.status === 404) {
      return {
        success: true,
        year: year || new Date().getFullYear(),
        rows: [],
      };
    }

    throw error;
  }
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
