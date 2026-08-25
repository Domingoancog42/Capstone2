import api from "./api";

export const LOAN_REQUESTS_CHANGED_EVENT = "loan-requests:changed";

export const LOAN_TYPES = [
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

function buildLoanFormData(payload = {}) {
  const formData = new FormData();

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (key === "supportingDocument" && typeof File !== "undefined" && value instanceof File) {
      formData.append(key, value);
      return;
    }

    if (typeof value === "object") {
      formData.append(key, JSON.stringify(value));
      return;
    }

    formData.append(key, typeof value === "string" ? value : String(value));
  });

  return formData;
}

function hasDocument(payload = {}) {
  return typeof File !== "undefined" && payload.supportingDocument instanceof File;
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

  const response = hasDocument(payload)
    ? await api.post("/loan_request.php", buildLoanFormData(requestPayload), {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      })
    : await api.post("/loan_request.php", requestPayload);

  notifyLoanRequestsChanged();
  return response.data;
}

export async function updateLoanRequest(id, payload) {
  const requestPayload = {
    ...payload,
    id,
    action: "update",
  };

  const response = hasDocument(payload)
    ? await api.post("/loan_request.php", buildLoanFormData(requestPayload), {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      })
    : await api.put("/loan_request.php", requestPayload);

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

export async function archiveLoanRequest(id) {
  const response = await api.put("/loan_request.php", {
    id,
    action: "archive",
  });
  notifyLoanRequestsChanged();
  return response.data;
}
