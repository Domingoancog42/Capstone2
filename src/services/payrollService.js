import api from "./api";
import { publishAutoRefresh } from "../components/auto/autorefreshconfig";
import { downloadExportFile, exportApiBaseUrl } from "./exportDownload";
import { notifyNotificationsChanged } from "./notificationService";

const PAYROLL_ACTION_TIMEOUT_MS = 120000;

export async function fetchPayrollRecords() {
  const response = await api.get("/payroll.php");
  return response.data;
}

/**
 * Create one payroll record.
 *
 * Pass `batched: true` when this is one create inside a run over many employees. It suppresses the
 * notification broadcast and the auto-refresh publication that each create would otherwise fire:
 * both make every listening screen refetch, so a fifty-employee batch spent six requests per
 * employee instead of one and ran the account into the API rate limit. A batched caller is
 * responsible for calling `notifyPayrollBatchFinished()` once the run is over.
 */
export async function createPayroll(payload, { batched = false } = {}) {
  // Creating a record runs the attendance and deduction engines over the whole pay period, which
  // can outrun the shared 20s client timeout. Aborting here does not roll back the insert, so the
  // caller would otherwise report a failure the payroll list immediately contradicts.
  const response = await api.post("/payroll.php", payload, {
    timeout: PAYROLL_ACTION_TIMEOUT_MS,
    skipAutoRefresh: batched,
  });

  if (!batched) {
    notifyNotificationsChanged();
  }

  return response.data;
}

/** The single refresh that stands in for the ones a batched run suppressed. */
export function notifyPayrollBatchFinished() {
  publishAutoRefresh({ source: "payroll-batch", topic: "payroll" });
  notifyNotificationsChanged();
}

/** Download one payroll registry as an .xlsx. */
export async function exportPayrollRegistry(payrollIds = [], filename = "payroll-register.xlsx") {
  const ids = payrollIds.map((id) => Number(id)).filter(Boolean);

  if (ids.length === 0) {
    throw new Error("Select a payroll registry to export.");
  }

  const url = new URL("payroll.php", exportApiBaseUrl());
  url.searchParams.set("action", "export_registry");
  url.searchParams.set("ids", ids.join(","));

  await downloadExportFile(url, filename, "Unable to export the payroll registry.");
}

export async function previewPayroll(payload) {
  const response = await api.post("/payroll.php", {
    ...payload,
    action: "preview",
  });
  return response.data;
}

export async function updatePayroll(id, payload, { notify = true } = {}) {
  const response = await api.put("/payroll.php", {
    ...payload,
    id,
    action: "update",
  });
  if (notify) {
    notifyNotificationsChanged();
  }
  return response.data;
}

/**
 * Asks payroll.php to email an authorization code, spending a solved captcha to do it.
 *
 * This is step one of the two-step check in front of submitting and approving: the sum buys the
 * send, and the code it mails is what the transition itself will ask for. `otpAction` is "submit" or
 * "approve", and the code is bound to whichever it was -- one mailed out to submit a batch cannot be
 * spent approving one. Call it again with the same action to resend; the server keeps the ticket and
 * replaces the code, and enforces its own floor on how often and how many times that can happen.
 *
 * Resolves to `{ otpTicket, maskedEmail, expiresInSeconds, resendAvailableInSeconds, ... }`. It
 * never returns the code: only the mailbox gets that, which is the entire point of the second step.
 */
export async function requestPayrollWorkflowOtp(otpAction, captcha = {}) {
  const response = await api.post("/payroll.php", {
    ...captcha,
    otpAction,
    action: "request_workflow_otp",
  });
  return response.data;
}

/**
 * The one-way steps of the payroll workflow, each carrying the security credential payroll.php
 * refuses them without.
 *
 * Submitting and approving carry `{ otpTicket, otpCode }` -- the emailed code from the step-up
 * above, which could only have been sent because a sum was solved first. Marking paid carries
 * `{ captchaId, captchaAnswer }` on its own. Returning a batch for correction carries nothing and is
 * deliberately ungated: it is the one move here that can be walked back. See
 * payroll_require_workflow_otp() and payroll_require_workflow_captcha() in payroll.php for which is
 * which and why.
 *
 * Sending nothing simply gets a 422 back with `captchaFailed`, which is the same answer a forged or
 * stale credential gets.
 */
export async function submitPayrollForApproval(id, comments = "", credential = {}) {
  const response = await api.post("/payroll.php", {
    id,
    comments,
    ...credential,
    action: "submit_for_approval",
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function approvePayroll(id, comments = "", credential = {}) {
  const response = await api.post("/payroll.php", {
    id,
    comments,
    ...credential,
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

export async function markPayrollPaid(id, captcha = {}) {
  const response = await api.post("/payroll.php", {
    id,
    ...captcha,
    action: "mark_paid",
  });
  notifyNotificationsChanged();
  return response.data;
}

/* The bulk twins reach the same transitions, so they ask for the same credential. */
export async function bulkSubmitForApproval(payrollIds, credential = {}) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    ...credential,
    action: "bulk_submit",
  }, {
    timeout: PAYROLL_ACTION_TIMEOUT_MS,
  });
  notifyNotificationsChanged();
  return response.data;
}

export async function bulkApprovePayroll(payrollIds, comments = "", credential = {}) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    comments,
    ...credential,
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

export async function bulkMarkPaid(payrollIds, captcha = {}) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    ...captcha,
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

export async function bulkRestorePayroll(payrollIds) {
  const response = await api.post("/payroll.php", {
    payrollIds,
    action: "bulk_restore",
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

export async function restorePayrollRecord(id) {
  const response = await api.put("/payroll.php", {
    id,
    action: "restore",
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
