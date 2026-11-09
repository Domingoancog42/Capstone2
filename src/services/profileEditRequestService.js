import api from "./api";

export const PROFILE_EDIT_REQUEST_NOTIFICATION_TYPE = "profile_edit_request";
export const PROFILE_EDIT_APPROVED_NOTIFICATION_TYPE = "profile_edit_approved";

export function normalizeProfileEditRequest(record) {
  if (!record) {
    return null;
  }

  return {
    id: Number(record.id ?? 0),
    employeeRecordId: Number(record.employeeRecordId ?? 0),
    requestedByUserId: Number(record.requestedByUserId ?? 0),
    section: String(record.section ?? "personal").trim(),
    status: String(record.status ?? "").trim().toLowerCase(),
    requesterName: String(record.requesterName ?? "").trim(),
    requesterRole: String(record.requesterRole ?? "").trim(),
    employeeCode: String(record.employeeCode ?? "").trim(),
    designationTitle: String(record.designationTitle ?? "").trim(),
    decidedByName: String(record.decidedByName ?? "").trim(),
    createdAt: String(record.createdAt ?? ""),
    decidedAt: String(record.decidedAt ?? ""),
  };
}
export async function fetchProfileEditRequestStatus() {
  const response = await api.get("/profile_edit_request.php");

  return {
    ...response.data,
    request: normalizeProfileEditRequest(response.data?.request),
  };
}

export async function fetchProfileEditRequest(id) {
  const response = await api.get("/profile_edit_request.php", { params: { id } });
  return normalizeProfileEditRequest(response.data?.request);
}

export async function requestProfileEdit() {
  const response = await api.post("/profile_edit_request.php", { action: "request" });

  return {
    ...response.data,
    request: normalizeProfileEditRequest(response.data?.request),
  };
}

export async function approveProfileEditRequest(id) {
  const response = await api.post("/profile_edit_request.php", { action: "approve", id });

  return {
    ...response.data,
    request: normalizeProfileEditRequest(response.data?.request),
  };
}

export async function declineProfileEditRequest(id) {
  const response = await api.post("/profile_edit_request.php", { action: "decline", id });

  return {
    ...response.data,
    request: normalizeProfileEditRequest(response.data?.request),
  };
}
