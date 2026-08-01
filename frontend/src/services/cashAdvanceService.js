import api from "./api";

export async function fetchCashAdvanceRequests(params = {}) {
  const response = await api.get("/cash_advance.php", { params });
  return response.data;
}

export async function createCashAdvanceRequest(payload) {
  const response = await api.post("/cash_advance.php", payload);
  return response.data;
}

export async function updateCashAdvanceRequest(id, payload) {
  const response = await api.put("/cash_advance.php", {
    ...payload,
    id,
    action: "update",
  });
  return response.data;
}

export async function updateCashAdvanceStatus(id, status) {
  const response = await api.put("/cash_advance.php", {
    id,
    status,
    action: "status",
  });
  return response.data;
}

export async function archiveCashAdvanceRequest(id) {
  const response = await api.put("/cash_advance.php", {
    id,
    action: "archive",
  });
  return response.data;
}
