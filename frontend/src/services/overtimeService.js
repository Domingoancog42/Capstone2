import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";
import { normalizeLeaveStatus } from "../utils/leaveHelpers";

export async function fetchOvertimeRequests() {
  const response = await api.get("/overtime.php");
  return response.data;
}

export async function fileOvertimeRequest(payload) {
  const response = await api.post("/overtime.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

export async function updateOvertimeStatus(id, status) {
  const response = await api.put("/overtime.php", {
    id,
    status: normalizeLeaveStatus(status),
  });
  notifyLeaveRequestsChanged();
  return response.data;
}
