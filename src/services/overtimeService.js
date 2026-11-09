import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";
import { normalizeLeaveStatus } from "../utils/leaveHelpers";

/**
 * Overtime rows for a screen.
 *
 * `source: "request"` leaves out the manual compensatory credits HR adds directly — they are stored
 * as approved overtime rows, but they are not requests and do not belong in a request list.
 * `source: "manual_coc"` returns only those. Omit it to get both, which is what the credit totals
 * on the compensatory and payroll screens are counted from.
 */
export async function fetchOvertimeRequests({ archived = false, source = "" } = {}) {
  const response = await api.get("/overtime.php", {
    params: {
      ...(archived ? { archived: 1 } : {}),
      ...(source ? { source } : {}),
    },
  });
  return response.data;
}

export async function fileOvertimeRequest(payload) {
  const response = await api.post("/overtime.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

export async function addCompensatoryOvertimeCredit(payload) {
  const response = await api.post("/overtime.php", {
    ...payload,
    action: "manual_coc_credit",
  });
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

/**
 * Save the pending +/- COC movements from the Set Balances screen in one call.
 *
 * `adjustments` carries the delta per employee, not the new total — a positive one credits, a
 * negative one deducts. The server applies the whole set in a transaction or none of it.
 */
export async function adjustCompensatoryOvertimeCredits(payload) {
  const response = await api.post("/overtime.php", {
    ...payload,
    action: "manual_coc_adjust",
  });
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

export async function updateOvertimeRequest(id, payload) {
  const response = await api.put("/overtime.php", {
    ...payload,
    id,
    action: "update",
  });
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

/**
 * Both signatures on an overtime filing — the Chief Admin's first approval and the Regional Director's final approval —
 * carry a solved captcha, because overtime.php refuses them without one. Rejections and
 * cancellations are not gated and pass nothing, so `captcha` stays empty for those.
 */
export async function updateOvertimeStatus(id, status, captcha = {}) {
  const response = await api.put("/overtime.php", {
    id,
    status: normalizeLeaveStatus(status),
    ...captcha,
  });
  notifyLeaveRequestsChanged();
  return response.data;
}

/**
 * The accomplishment reports (the "task rendered during overtime" memos) the caller may see: an
 * employee's own, or every one for the desks that note and monitor them. Same endpoint as the
 * requests so a submitted memo wakes the same `overtime` topic the workspace already listens to.
 */
export async function fetchOvertimeAccomplishmentReports() {
  const response = await api.get("/overtime.php", { params: { view: "accomplishments" } });
  return response.data;
}

/** Files (or, after a return, revises) the memo for one approved overtime request. */
export async function submitOvertimeAccomplishmentReport(payload) {
  const response = await api.post("/overtime.php", {
    ...payload,
    action: "accomplishment_submit",
  });
  notifyLeaveRequestsChanged();
  return response.data;
}

/** The chief's decision on a memo: "Approved" notes it, "Rejected" returns it with remarks. */
export async function updateOvertimeAccomplishmentStatus(reportId, status, remarks = "") {
  const response = await api.put("/overtime.php", {
    action: "accomplishment_status",
    reportId,
    status,
    remarks,
  });
  notifyLeaveRequestsChanged();
  return response.data;
}
