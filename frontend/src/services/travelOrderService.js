import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";
import { normalizeLeaveStatus } from "../utils/leaveHelpers";

export async function fetchTravelOrders({ archived = false } = {}) {
  const response = await api.get("/travel_order.php", {
    params: archived ? { archived: 1 } : {},
  });
  return response.data;
}

export async function fileTravelOrder(payload) {
  const response = await api.post("/travel_order.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

export async function authorizeTravelOrder(requestId) {
  const response = await api.put("/travel_order.php", {
    id: requestId,
    action: "authorize",
  });
  notifyLeaveRequestsChanged();
  return response.data;
}

/**
 * Both signatures on a travel order carry a solved captcha -- the Planning Officer's recommendation
 * and the Regional Director's approval -- because travel_order.php refuses them without one. Which
 * of the two an "approved" means is the server's call, so one `captcha` pair covers either.
 * Rejections and cancellations are not gated and pass nothing.
 */
export async function updateTravelOrderStatus(requestId, status, rejectedNote = "", captcha = {}) {
  const response = await api.put("/travel_order.php", {
    id: requestId,
    status: normalizeLeaveStatus(status),
    rejectedNote: String(rejectedNote || "").trim(),
    ...captcha,
  });
  notifyLeaveRequestsChanged();
  return response.data;
}
