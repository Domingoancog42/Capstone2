import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";

export async function fetchCompensatoryRequests({ archived = false } = {}) {
  const response = await api.get("/compensatory.php", {
    params: archived ? { archived: 1 } : {},
  });
  return response.data;
}

/**
 * Compensatory overtime credits for one employee: `earned`, `used`, and what is left to file
 * against. An employee always gets their own, whatever id is passed.
 */
export async function fetchCompensatoryCreditBalance(employeeRecordId) {
  const response = await api.get("/compensatory.php", {
    params: {
      action: "credit_balance",
      employeeRecordId: Number(employeeRecordId) || 0,
    },
  });
  return response.data;
}

export async function fileCompensatoryRequest(payload) {
  const response = await api.post("/compensatory.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

/**
 * Every signature on the CTO form -- the Chief's endorsement, HR Head's review, the Director's
 * approval -- carries a solved captcha, because compensatory.php refuses them without one. The
 * caller asks for the final status and the server resolves it down to the stage the request is
 * actually at, so one `captcha` pair covers whichever of the three this turns out to be.
 * Rejections and cancellations are not gated and pass nothing.
 */
export async function updateCompensatoryStatus(id, status, rejectedNote = "", captcha = {}) {
  const response = await api.put("/compensatory.php", {
    id,
    status,
    rejectedNote: String(rejectedNote || "").trim(),
    ...captcha,
  });
  notifyLeaveRequestsChanged();
  return response.data;
}
