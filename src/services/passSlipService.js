import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";

export async function fetchPassSlips({ archived = false } = {}) {
  const response = await api.get("/pass_slip.php", {
    params: archived ? { archived: 1 } : {},
  });
  return response.data;
}

export async function filePassSlip(payload) {
  const response = await api.post("/pass_slip.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

/*
 * The only edit a person makes to a filed slip. There is nothing to approve -- a slip is live from
 * the moment it is filed -- and the two times on it are not typed either: Time Out and Time Returned
 * are stamped by scanPassSlip() below and by nothing else, which is the point of the QR workflow.
 */
export async function cancelPassSlip(id, note = "") {
  const response = await api.put("/pass_slip.php", { id, action: "cancel", note });
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

/**
 * Present one scanned code to the server.
 *
 * The caller sends the reader's output verbatim and is told what happened -- it does not decide
 * whether this is the Time Out scan or the Time Returned one. That is worked out from the slip's own
 * status on the server, under a row lock, so two readers pointed at the same code cannot both stamp
 * the same step.
 *
 * A refused scan is a rejected promise with the server's explanation on it, because "already
 * completed" and "this slip has expired" are results the console has to show, not transport failures.
 */
export async function scanPassSlip(token, { publicAccess = false } = {}) {
  const endpoint = publicAccess ? "/pass_slip_scan.php" : "/pass_slip.php";
  const response = await api.post(endpoint, { action: "scan", token });
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

/**
 * The scan station's recent history, from the server so every device at the desk shows the same
 * list: one entry per slip scanned (its departure and return share it), plus each refused scan.
 */
export async function fetchPassSlipScanHistory({ publicAccess = false } = {}) {
  const endpoint = publicAccess ? "/pass_slip_scan.php" : "/pass_slip.php";
  const response = await api.get(endpoint, { params: { action: "scan_history" } });
  return response.data;
}

/** Every scan attempt recorded against one slip, accepted and refused alike. */
export async function fetchPassSlipScans(id) {
  const response = await api.get("/pass_slip.php", { params: { action: "scans", id } });
  return response.data;
}

export async function deletePassSlip(id) {
  const response = await api.delete("/pass_slip.php", { data: { id } });
  notifyLeaveRequestsChanged();
  return response.data;
}
