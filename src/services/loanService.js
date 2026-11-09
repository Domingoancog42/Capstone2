import api from "./api";

export const LOAN_REQUESTS_CHANGED_EVENT = "loan-requests:changed";

export const LOAN_TYPES = [
  "SSS Salary Loan",
  "SSS Calamity Loan",
  "Pag-IBIG Multi-Purpose Loan",
  "Pag-IBIG Housing Loan",
  "GSIS Salary Loan",
  "GSIS Emergency Loan",
  "GSIS Policy Loan",
  "Company Loan",
  "Emergency Loan",
  "Policy Loan",
  "Consolidated Loan",
  "Salary Loan",
  "Housing Loan",
  "Pension Loan",
  "GSIS Financial Assistance Loan (GFAL)",
  "Enhanced Housing Loan",
  "Multi-Purpose Loan (MPL)",
  "Calamity Loan",
];

export const LOAN_STATUSES = ["Pending", "Approved", "Rejected"];

function notifyLoanRequestsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOAN_REQUESTS_CHANGED_EVENT));
  }
}

export async function fetchLoanRequests(params = {}) {
  const response = await api.get("/loan_request.php", { params });
  return response.data;
}

export async function fetchLoanRequestById(id) {
  const response = await api.get("/loan_request.php", {
    params: { id },
  });
  return response.data;
}

export async function createLoanRequest(payload) {
  const requestPayload = {
    ...payload,
    action: "create",
  };

  const response = await api.post("/loan_request.php", requestPayload);

  notifyLoanRequestsChanged();
  return response.data;
}

export async function updateLoanRequest(id, payload) {
  const requestPayload = {
    ...payload,
    id,
    action: "update",
  };

  const response = await api.put("/loan_request.php", requestPayload);

  notifyLoanRequestsChanged();
  return response.data;
}

export async function updateLoanStatus(id, status, remarks = "") {
  const response = await api.put("/loan_request.php", {
    id,
    status,
    remarks,
    action: "status",
  });
  notifyLoanRequestsChanged();
  return response.data;
}

export async function disburseLoanRequest(id, disbursedAt) {
  const response = await api.put("/loan_request.php", {
    id,
    disbursedAt,
    action: "disburse",
  });
  notifyLoanRequestsChanged();
  return response.data;
}

export async function recordLoanPayment(id, payload = {}) {
  const response = await api.post("/loan_request.php", {
    ...payload,
    id,
    action: "payment",
  });
  notifyLoanRequestsChanged();
  return response.data;
}

export async function archiveLoanRequest(id) {
  const response = await api.put("/loan_request.php", {
    id,
    action: "archive",
  });
  notifyLoanRequestsChanged();
  return response.data;
}
