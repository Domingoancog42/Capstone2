import api from "./api";

/**
 * Personal details edit requests.
 *
 * Personal details are read-only on the profile page — they are the identity HR certifies on
 * official forms. An employee asks for the section instead, giving a reason; HR Head and Admin
 * decide from the notification bell, and an approval covers one save, spent by `markProfileEditUsed`.
 */

export const PROFILE_EDIT_REQUEST_NOTIFICATION_TYPE = "profile_edit_request";
export const PROFILE_EDIT_APPROVED_NOTIFICATION_TYPE = "profile_edit_approved";

/** The section this gate covers. Sent on every call so a second gated section can be added later. */
export const PROFILE_EDIT_SECTION = "personal";

export function normalizeProfileEditRequest(record) {
  if (!record) {
    return null;
  }

  return {
    id: Number(record.id ?? 0),
    employeeRecordId: Number(record.employeeRecordId ?? 0),
    requestedByUserId: Number(record.requestedByUserId ?? 0),
    section: String(record.section ?? PROFILE_EDIT_SECTION).trim(),
    reason: String(record.reason ?? "").trim(),
    status: String(record.status ?? "").trim().toLowerCase(),
    requesterName: String(record.requesterName ?? "").trim(),
    requesterRole: String(record.requesterRole ?? "").trim(),
    employeeCode: String(record.employeeCode ?? "").trim(),
    designationTitle: String(record.designationTitle ?? "").trim(),
    decidedByName: String(record.decidedByName ?? "").trim(),
    decisionNote: String(record.decisionNote ?? "").trim(),
    createdAt: String(record.createdAt ?? ""),
    decidedAt: String(record.decidedAt ?? ""),
    usedAt: String(record.usedAt ?? ""),
  };
}

/** The signed-in user's latest request, plus whether their role needs one at all. */
export async function fetchProfileEditRequestStatus(section = PROFILE_EDIT_SECTION) {
  const response = await api.get("/profile_edit_request.php", { params: { section } });

  return {
    ...response.data,
    request: normalizeProfileEditRequest(response.data?.request),
  };
}

/** Used by the notification detail view to re-read a request another approver may have decided. */
export async function fetchProfileEditRequest(id) {
  const response = await api.get("/profile_edit_request.php", { params: { id } });

  return normalizeProfileEditRequest(response.data?.request);
}

export async function requestProfileEdit({ reason, section = PROFILE_EDIT_SECTION }) {
  const response = await api.post("/profile_edit_request.php", {
    action: "request",
    reason,
    section,
  });

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

export async function declineProfileEditRequest(id, note = "") {
  const response = await api.post("/profile_edit_request.php", { action: "decline", id, note });

  return {
    ...response.data,
    request: normalizeProfileEditRequest(response.data?.request),
  };
}

/** Spends the approval once the section has actually saved. */
export async function markProfileEditUsed(id) {
  const response = await api.post("/profile_edit_request.php", { action: "mark_used", id });

  return {
    ...response.data,
    request: normalizeProfileEditRequest(response.data?.request),
  };
}
