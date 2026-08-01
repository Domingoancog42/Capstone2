import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";

export async function fetchCompensatoryRequests() {
  const response = await api.get("/compensatory.php");
  return response.data;
}

export async function fileCompensatoryRequest(payload) {
  const response = await api.post("/compensatory.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

export async function updateCompensatoryStatus(id, status, rejectedNote = "") {
  const response = await api.put("/compensatory.php", {
    id,
    status,
    rejectedNote: String(rejectedNote || "").trim(),
  });
  notifyLeaveRequestsChanged();
  return response.data;
}
