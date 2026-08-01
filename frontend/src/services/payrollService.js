import api from "./api";
import { notifyNotificationsChanged } from "./notificationService";

const PAYROLL_ACTION_TIMEOUT_MS = 120000;

export async function fetchPayrollRecords() {
  const response = await api.get("/payroll.php");
  return response.data;
}

export async function createPayroll(payload) {
  const response = await api.post("/payroll.php", payload);
  notifyNotificationsChanged();
  return response.data;
}

export async function previewPayroll(payload) {
  const response = await api.post("/payroll.php", {
    ...payload,
    action: "preview",
  });
  return response.data;
}

export async function updatePayroll(id, payload) {
  const response = await api.put("/payroll.php", {
    ...payload,
    id,
    action: "update",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function submitPayrollForApproval(id, comments = "") {
  const response = await api.post("/payroll.php", {
    id,
    comments,
    action: "submit_for_approval",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function approvePayroll(id, comments = "") {
  const response = await api.post("/payroll.php", {
    id,
    comments,
    action: "approve",
  }, {
    timeout: PAYROLL_ACTION_TIMEOUT_MS,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function rejectPayroll(id, reason) {
  const response = await api.post("/payroll.php", {
    id,
    reason,
    action: "reject",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function markPayrollPaid(id) {
  const response = await api.post("/payroll.php", {
    id,
    action: "mark_paid",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function bulkSubmitForApproval(payrollIds) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    action: "bulk_submit",
  }, {
    timeout: PAYROLL_ACTION_TIMEOUT_MS,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function bulkApprovePayroll(payrollIds, comments = "") {
  const response = await api.post("/payroll.php", {
    payrollIds,
    comments,
    action: "bulk_approve",
  }, {
    timeout: PAYROLL_ACTION_TIMEOUT_MS,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function bulkRejectPayroll(payrollIds, reason) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    reason,
    action: "bulk_reject",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function bulkMarkPaid(payrollIds) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    action: "bulk_mark_paid",
  }, {
    timeout: PAYROLL_ACTION_TIMEOUT_MS,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function bulkArchivePayroll(payrollIds) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    action: "bulk_archive",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function archivePayrollRecord(id) {
  const response = await api.put("/payroll.php", {
    id,
    action: "archive",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function fetchPayrollDeductionData(params = {}) {
  const response = await api.get("/deduction.php", { params });
  return response.data;
}

export async function createPayrollDeduction(payload) {
  const response = await api.post("/deduction.php", payload);
  return response.data;
}

export async function updatePayrollDeduction(payload) {
  const response = await api.put("/deduction.php", payload);
  return response.data;
}

export async function deletePayrollDeduction(payload) {
  const response = await api.delete("/deduction.php", { data: payload });
  return response.data;
}
