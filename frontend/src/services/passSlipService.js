import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";

export async function fetchPassSlips() {
  const response = await api.get("/pass_slip.php");
  return response.data;
}

export async function filePassSlip(payload) {
  const response = await api.post("/pass_slip.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

export async function updatePassSlipStatus(id, status) {
  const response = await api.put("/pass_slip.php", { id, status });
  notifyLeaveRequestsChanged();
  return response.data;
}

export async function deletePassSlip(id) {
  const response = await api.delete("/pass_slip.php", { data: { id } });
  notifyLeaveRequestsChanged();
  return response.data;
}
