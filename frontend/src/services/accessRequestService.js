import api from "./api";

export const ACCESS_REQUEST_NOTIFICATION_TYPE = "access_request";
export const ACCESS_GRANTED_NOTIFICATION_TYPE = "access_granted";

export function normalizeAccessRequest(record = {}) {
  return {
    id: Number(record.id ?? 0),
    userId: Number(record.userId ?? 0),
    moduleKey: String(record.moduleKey ?? "").trim(),
    moduleLabel: String(record.moduleLabel ?? "").trim(),
    status: String(record.status ?? "").trim().toLowerCase(),
    requesterName: String(record.requesterName ?? "").trim(),
    requesterRole: String(record.requesterRole ?? "").trim(),
    createdAt: String(record.createdAt ?? ""),
    decidedAt: String(record.decidedAt ?? ""),
  };
}

export async function createAccessRequest({ moduleKey, moduleLabel }) {
  const response = await api.post("/access_request.php", {
    action: "create",
    moduleKey,
    moduleLabel,
  });

  return {
    ...response.data,
    request: normalizeAccessRequest(response.data?.request),
  };
}

export async function grantAccessRequest(id) {
  const response = await api.post("/access_request.php", {
    action: "grant",
    id,
  });

  return {
    ...response.data,
    request: normalizeAccessRequest(response.data?.request),
  };
}

/** Used by the notification detail view to tell a still-open request from an already-granted one. */
export async function fetchAccessRequest(id) {
  const response = await api.get("/access_request.php", { params: { id } });

  return normalizeAccessRequest(response.data?.request);
}
