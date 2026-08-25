import api from "./api";

/**
 * Service record print requests.
 *
 * Employees cannot issue their own certified CS Form No. 1, so My Service Record asks instead of
 * printing. HR Head and Admin approve from the notification bell, and the approval covers one copy —
 * `markServiceRecordPrinted` spends it as the print window opens.
 */

export const SERVICE_RECORD_PRINT_REQUEST_NOTIFICATION_TYPE = "service_record_print_request";
export const SERVICE_RECORD_PRINT_APPROVED_NOTIFICATION_TYPE = "service_record_print_approved";

export function normalizeServiceRecordPrintRequest(record) {
  if (!record) {
    return null;
  }

  return {
    id: Number(record.id ?? 0),
    employeeRecordId: Number(record.employeeRecordId ?? 0),
    requestedByUserId: Number(record.requestedByUserId ?? 0),
    status: String(record.status ?? "").trim().toLowerCase(),
    requesterName: String(record.requesterName ?? "").trim(),
    requesterRole: String(record.requesterRole ?? "").trim(),
    employeeCode: String(record.employeeCode ?? "").trim(),
    designationTitle: String(record.designationTitle ?? "").trim(),
    approverName: String(record.approverName ?? "").trim(),
    approverSignatureDataUrl: String(record.approverSignatureDataUrl ?? ""),
    createdAt: String(record.createdAt ?? ""),
    approvedAt: String(record.approvedAt ?? ""),
    printedAt: String(record.printedAt ?? ""),
  };
}

/** The signed-in user's open request, if any, plus what they are allowed to do without one. */
export async function fetchServiceRecordPrintStatus() {
  const response = await api.get("/service_record_print.php");

  return {
    ...response.data,
    request: normalizeServiceRecordPrintRequest(response.data?.request),
  };
}

/** Used by the notification detail view to re-read a request another approver may have acted on. */
export async function fetchServiceRecordPrintRequest(id) {
  const response = await api.get("/service_record_print.php", { params: { id } });

  return normalizeServiceRecordPrintRequest(response.data?.request);
}

export async function requestServiceRecordPrint() {
  const response = await api.post("/service_record_print.php", { action: "request" });

  return {
    ...response.data,
    request: normalizeServiceRecordPrintRequest(response.data?.request),
  };
}

export async function approveServiceRecordPrint(id) {
  const response = await api.post("/service_record_print.php", { action: "approve", id });

  return {
    ...response.data,
    request: normalizeServiceRecordPrintRequest(response.data?.request),
  };
}

export async function markServiceRecordPrinted(id) {
  const response = await api.post("/service_record_print.php", { action: "mark_printed", id });

  return {
    ...response.data,
    request: normalizeServiceRecordPrintRequest(response.data?.request),
  };
}
