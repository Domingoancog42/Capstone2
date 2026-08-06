import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";
import { normalizeLeaveStatus } from "../utils/leaveHelpers";

export async function fetchTravelOrders() {
  const response = await api.get("/travel_order.php");
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

export async function updateTravelOrderStatus(requestId, status, rejectedNote = "") {
  const response = await api.put("/travel_order.php", {
    id: requestId,
    status: normalizeLeaveStatus(status),
    rejectedNote: String(rejectedNote || "").trim(),
  });
  notifyLeaveRequestsChanged();
  return response.data;
}
