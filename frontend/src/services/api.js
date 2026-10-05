import axios from "axios";
import {
  publishAutoRefresh,
  shouldPublishAutoRefreshForRequest,
  topicFromRequestUrl,
} from "../components/auto/autorefreshconfig";

export const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost/Capstone2/frontend/backend/api";
export const AUTH_SESSION_EXPIRED_EVENT = "hris:auth-session-expired";
/**
 * The `reason` connection-pdo.php sends with its 401 when the account behind a live session has been
 * switched to Inactive. It rides on the session-expired event so App.jsx can say why the session
 * ended instead of dropping the user at the login screen with no explanation.
 */
export const AUTH_ACCOUNT_INACTIVE_REASON = "account_inactive";
export const AUTH_SESSION_TIMEOUT_REASON = "session_timeout";

export function getBackendAssetUrl(path = "") {
  const cleanPath = String(path || "").replace(/^\/+/, "");
  if (!cleanPath) {
    return "";
  }

  if (/^https?:\/\//i.test(cleanPath)) {
    return cleanPath;
  }

  return `${API_BASE_URL.replace(/\/api\/?$/i, "")}/${cleanPath}`;
}

const AUTH_EXEMPT_ENDPOINTS = [
  "/csrf.php",
  // Only the login screen's challenge, which is dealt before there is a session to expire. Every
  // other purpose guards an action behind a session, so a 401 there IS a session expiry and has to
  // reach the handler below — hence the query string rather than a bare "/captcha.php".
  "/captcha.php?purpose=login",
  "/captcha.php?action=verify&purpose=login",
  "/login.php",
  // The Google credential sign-in. Its 401 is a verdict on the credential or the account -- there is
  // no session behind it to have expired -- and it is spelled out because "/login.php" does not match it.
  "/google_login.php",
  // The two login-step actions of two_factor.php, which run for a caller who has no session yet.
  // Listed with their query string for the same substring reason as settings.php below: the third
  // action on that file is the Security tab's personal setting, which DOES need a live session, so
  // a bare "/two_factor.php" here would wrongly swallow its session-expired 401.
  "/two_factor.php?action=verify",
  "/two_factor.php?action=resend",
  "/forgot_password.php",
  "/reset_password.php",
  // The QR token itself authorizes one pass-slip departure/return transition. This endpoint never
  // reads a user session and must not turn an anonymous rejection into a global sign-out event.
  "/pass_slip_scan.php",
  // The login screen's slice of settings.php, which answers this one section before it asks for a
  // session. Matched by substring, so the query string keeps the rest of settings.php out of this list.
  "/settings.php?section=public",
];

const api = axios.create({
  baseURL: API_BASE_URL,
  // Aiven's free-tier database can take tens of seconds for authentication-heavy
  // requests (login performs several security and audit queries). Keep the client
  // alive long enough to receive the server's successful response instead of
  // turning a slow login into a misleading network error.
  timeout: 90000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

const NOTIFICATIONS_CHANGED_EVENT = "hris:notifications:changed";

function notifyNotificationsChangedEvent() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT));
}

let clientHintsPromise = null;
let csrfToken = "";
let csrfTokenPromise = null;

function setCsrfToken(token) {
  csrfToken = String(token || "");
  return csrfToken;
}

function requestNeedsCsrf(config = {}) {
  const method = String(config.method || "get").toLowerCase();
  const requestUrl = String(config.url || "");
  // These anonymous writes declare HRIS_CSRF_EXEMPT, so they are not held up waiting for a token
  // that their endpoint deliberately does not check.
  const isAnonymousWrite = requestUrl.includes("/login.php")
    || requestUrl.includes("/google_login.php")
    || requestUrl.includes("/captcha.php?action=verify&purpose=login")
    || requestUrl.includes("/pass_slip_scan.php");

  return (
    ["post", "put", "patch", "delete"].includes(method)
    && !requestUrl.includes("/csrf.php")
    && !isAnonymousWrite
  );
}

async function getCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  if (!csrfTokenPromise) {
    csrfTokenPromise = axios
      .get(`${API_BASE_URL}/csrf.php`, {
        withCredentials: true,
        timeout: 10000,
      })
      .then((response) => setCsrfToken(response.data?.csrfToken || ""))
      .finally(() => {
        csrfTokenPromise = null;
      });
  }

  return csrfTokenPromise;
}

function clientHintHeaders() {
  if (typeof navigator === "undefined" || !navigator.userAgentData?.getHighEntropyValues) {
    return Promise.resolve({});
  }

  if (!clientHintsPromise) {
    clientHintsPromise = navigator.userAgentData
      .getHighEntropyValues(["platform", "platformVersion"])
      .then((hints) => ({
        ...(hints.platform ? { "X-Client-Platform": hints.platform } : {}),
        ...(hints.platformVersion ? { "X-Client-Platform-Version": hints.platformVersion } : {}),
      }))
      .catch(() => ({}));
  }

  return clientHintsPromise;
}

api.interceptors.request.use(async (config) => {
  if (requestNeedsCsrf(config)) {
    const token = await getCsrfToken();

    if (token) {
      config.headers = config.headers || {};
      config.headers["X-CSRF-Token"] = token;
    }
  }

  const headers = await clientHintHeaders();
  config.headers = config.headers || {};

  Object.entries(headers).forEach(([key, value]) => {
    if (value) {
      config.headers[key] = value;
    }
  });

  return config;
});

api.interceptors.response.use(
  (response) => {
    if (response.data?.csrfToken) {
      setCsrfToken(response.data.csrfToken);
    }

    if (shouldPublishAutoRefreshForRequest(response.config)) {
      publishAutoRefresh({
        dispatchLegacy: false,
        method: response.config?.method,
        source: "api",
        status: response.status,
        topic: topicFromRequestUrl(response.config?.url),
        url: response.config?.url,
      });
    }

    return response;
  },
  (error) => {
    const status = error?.response?.status;
    const requestUrl = String(error?.config?.url || "");
    const isAuthExemptRequest = AUTH_EXEMPT_ENDPOINTS.some((endpoint) => requestUrl.includes(endpoint));

    if ([401, 419].includes(status)) {
      setCsrfToken("");
    }

    /*
     * A 419 is returned by connection-pdo.php before the requested endpoint is allowed to run, so
     * the mutation has not happened and is safe to retry. Fetch a token for the browser's current
     * PHP session, replace the stale header, and replay the request once. The flag stays on Axios'
     * request config; if the cookie/session itself is unusable and the replay also gets a 419, the
     * ordinary error reaches the screen instead of entering a retry loop.
     */
    if (status === 419 && error?.config && error.config._csrfRetry !== true) {
      const retryConfig = error.config;
      retryConfig._csrfRetry = true;

      return getCsrfToken().then(
        (token) => {
          if (!token) {
            return Promise.reject(error);
          }

          retryConfig.headers = retryConfig.headers || {};
          retryConfig.headers["X-CSRF-Token"] = token;

          return api.request(retryConfig);
        },
        () => Promise.reject(error)
      );
    }

    if (
      status === 401
      && !isAuthExemptRequest
      && typeof window !== "undefined"
    ) {
      window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, {
        detail: {
          reason: String(error?.response?.data?.reason || ""),
          message: String(error?.response?.data?.message || ""),
        },
      }));
    }

    return Promise.reject(error);
  }
);

/**
 * Deals a captcha challenge. The answer stays on the server — what comes back is an id, the operator,
 * and the two operands drawn as image data URIs, including on servers where GD is not enabled. The id
 * goes back with the guarded request, and the endpoint behind it decides whether the answer was
 * right; nothing in this browser ever knows.
 *
 * `purpose` picks which flow is asking — see the purposes note in captcha-utils.php.
 */
export const getCaptcha = async (purpose = "login") => {
  // The purpose goes in the URL rather than through `params` because AUTH_EXEMPT_ENDPOINTS matches
  // on `config.url`, which axios leaves without the params it appends later. Same reason the
  // two_factor.php and settings.php entries on that list are written out in full.
  const response = await api.get(`/captcha.php?purpose=${encodeURIComponent(purpose)}`);
  return response.data;
};

/** The sign-in form's challenge, which is the one that runs before there is a session. */
export const getLoginCaptcha = async () => getCaptcha("login");

/** Asks the server to mark the login challenge solved without exposing its answer to this browser. */
export const verifyLoginCaptcha = async (captchaId, captchaAnswer) => {
  const response = await api.post("/captcha.php?action=verify&purpose=login", {
    purpose: "login",
    captchaId,
    captchaAnswer,
  });

  return response.data;
};

/*
 * The other two purposes -- "payroll_workflow" and "approval_workflow" -- are asked for by name
 * from serverCaptchaPrompt.js, which is the only thing that deals them, so they have no wrapper
 * of their own here. Login keeps one because login.jsx has to read the `enabled` flag that comes
 * back with it, which no other purpose returns.
 */

export const login = async (credentials) => {
  const response = await api.post("/login.php", credentials);
  return response.data;
};

/**
 * Sign-in with a Google credential: the signed ID token the Identity Services button hands back.
 * It is carried to the server as-is and verified there, with Google; nothing in this browser reads
 * it or decides who it belongs to. Answers with the same shape as login() -- `user`, or
 * `requiresTwoFactor` with a `twoFactor` challenge -- so the login screen follows the same branches.
 */
export const googleLogin = async (credential) => {
  const response = await api.post("/google_login.php", { credential });
  return response.data;
};

export const logout = async () => {
  try {
    const response = await api.post("/logout.php");
    return response.data;
  } finally {
    setCsrfToken("");
  }
};

export const refreshSession = async ({ extend = false, allowAnonymous = false } = {}) => {
  const response = await api.get("/session.php", {
    params: extend ? { extend: 1 } : undefined,
  });
  const result = response.data;

  // session.php deliberately answers anonymous callers with 200 so the authentication provider can
  // choose the correct public UI without turning an expected signed-out state into a request error.
  // Existing authenticated refresh callers still need a dead session to behave like a failure.
  if (result?.authenticated === false && !allowAnonymous) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
    }

    const error = new Error("The authenticated session is no longer valid.");
    error.response = { status: 401, data: result };
    throw error;
  }

  return result;
};

export const checkPasswordExpiry = async () => {
  const response = await api.get("/password_expiry_check.php");
  return response.data;
};

export const forgotPassword = async (payload) => {
  const response = await api.post("/forgot_password.php", payload);
  return response.data;
};

export const verifyPasswordResetCode = async (payload) => {
  const response = await api.post("/reset_password.php", {
    action: "verify_code",
    ...payload,
  });
  return response.data;
};

export const resetPassword = async (payload) => {
  const response = await api.post("/reset_password.php", payload);
  return response.data;
};

export const forceChangePassword = async (payload) => {
  const response = await api.post("/force_change_password.php", payload);
  return response.data;
};

export const verifyTwoFactorCode = async (payload) => {
  const response = await api.post("/two_factor.php?action=verify", payload);
  return response.data;
};

export const resendTwoFactorCode = async () => {
  const response = await api.post("/two_factor.php?action=resend");
  return response.data;
};

export const getEmployeeOptions = async () => {
  const response = await api.get("/employee.php", { params: { options: 1 } });
  return response.data;
};

export const getEmployees = async () => {
  const response = await api.get("/employee.php");
  return response.data;
};

export const getCurrentEmployee = async () => {
  const response = await api.get("/employee.php", { params: { self: 1 } });
  return response.data;
};

export const getArchivedEmployees = async () => {
  const response = await api.get("/employee.php", { params: { archived: 1 } });
  return response.data;
};




export const createEmployee = async (employee) => {
  const response = await api.post("/employee.php", employee);
  notifyNotificationsChangedEvent();
  return response.data;
};

export const importEmployeesCsv = async (file) => {
  const formData = new FormData();
  formData.append("action", "importEmployeesCsv");
  formData.append("employeeFile", file);

  // Password hashing still happens in this request; activation email delivery continues server-side
  // after the response, so keep a generous limit without making SMTP part of the wait.
  const response = await api.post("/employee.php", formData, {
    timeout: 600000,
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const updateEmployee = async (id, employee) => {
  const response = await api.put("/employee.php", { ...employee, id });
  notifyNotificationsChangedEvent();
  return response.data;
};

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);

  if (!match) {
    throw new Error("Invalid profile image data.");
  }

  const mimeType = match[1] || "application/octet-stream";
  const encodedValue = match[3] || "";
  const binary = match[2] ? window.atob(encodedValue) : decodeURIComponent(encodedValue);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export const updateEmployeeProfileImage = async (employeeId, imageDataUrl = "") => {
  const formData = new FormData();
  formData.append("employeeId", String(employeeId || ""));

  if (imageDataUrl) {
    const profileImageBlob = dataUrlToBlob(imageDataUrl);
    formData.append("profileImage", profileImageBlob, `profile-${employeeId || "employee"}.png`);
  } else {
    formData.append("remove", "1");
  }

  const response = await api.post("/employee_profile_image.php", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data;
};

export const getEmployeeSignature = async (employeeId) => {
  const response = await api.get("/employee_signature.php", {
    params: {
      employeeId,
    },
  });
  return response.data;
};

export const getCurrentEmployeeSignature = async () => {
  const response = await api.get("/employee_signature.php", {
    params: {
      self: 1,
    },
  });
  return response.data;
};

export const updateEmployeeSignature = async (employeeId, signatureDataUrl = "") => {
  const response = await api.put("/employee_signature.php", {
    employeeId,
    signatureDataUrl,
  });
  return response.data;
};

/*
 * Personal documents (birth certificate, valid IDs, resume, diploma). These live on disk with no
 * table behind them, so `documentId` is the stored file name -- see employee_documents.php.
 */
export const getEmployeeDocuments = async (employeeId) => {
  const response = await api.get("/employee_documents.php", {
    params: {
      employeeId,
    },
  });
  return response.data;
};

export const getCurrentEmployeeDocuments = async () => {
  const response = await api.get("/employee_documents.php", {
    params: {
      self: 1,
    },
  });
  return response.data;
};

export const uploadEmployeeDocument = async (employeeId, documentType, file) => {
  const formData = new FormData();
  formData.append("employeeId", String(employeeId || ""));
  formData.append("documentType", String(documentType || ""));
  formData.append("document", file, file?.name || "document");

  const response = await api.post("/employee_documents.php", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data;
};

export const deleteEmployeeDocument = async (employeeId, documentId) => {
  const response = await api.delete("/employee_documents.php", {
    data: {
      employeeId,
      documentId,
    },
  });
  return response.data;
};

export const deleteEmployee = async (id) => {
  const response = await api.delete("/employee.php", { data: { id } });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const restoreEmployee = async (id) => {
  const response = await api.patch("/employee.php", { id, restore: 1 });
  notifyNotificationsChangedEvent();
  return response.data;
};

/**
 * Records a retirement or resignation from the Loyalty dashboard.
 *
 * `separationType` is "retirement" or "resignation". The backend moves the employee's status and
 * closes their service record with the separation date and cause in one transaction.
 */
export const separateEmployee = async ({ id, separationType, effectiveDate, remarks = "" }) => {
  const response = await api.patch("/employee.php", {
    id,
    action: "separate",
    separationType,
    effectiveDate,
    remarks,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const getUsers = async () => {
  const response = await api.get("/user.php");
  return response.data;
};

export const getArchivedUsers = async () => {
  const response = await api.get("/user.php", { params: { archived: 1 } });
  return response.data;
};

export const createUser = async (user) => {
  const response = await api.post("/user.php", user);
  notifyNotificationsChangedEvent();
  return response.data;
};

export const sendAdminUserOtp = async ({ email, roleId }) => {
  const response = await api.post("/user.php", { action: "sendAdminOtp", email, roleId });
  return response.data;
};

export const updateUser = async (id, user) => {
  const response = await api.put("/user.php", { ...user, id });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const archiveUser = async (id) => {
  const response = await api.delete("/user.php", { data: { id } });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const restoreUser = async (id) => {
  const response = await api.put("/user.php", { id, action: "restore" });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const getChat = async (contactId = "") => {
  const response = await api.get("/messages.php", {
    params: contactId ? { contactId } : {},
  });
  return response.data;
};

export const sendChatMessage = async (receiverId, messageText) => {
  const response = await api.post("/messages.php", {
    receiverId,
    messageText,
  });
  return response.data;
};

export const getSettings = async (params = {}) => {
  const response = await api.get("/settings.php", { params });
  return response.data;
};

// `section=lockedAccounts` skips the division, permission, audit and configuration queries the full
// settings payload runs, which matters because the security screen re-reads this on every lock.
export const getLockedAccounts = async () => {
  const response = await api.get("/settings.php", { params: { section: "lockedAccounts" } });
  return response.data;
};

export const getAuditLogs = async (params = {}) => {
  const response = await api.get("/audit_logs.php", { params });
  return response.data;
};

export const fetchIpcrRecords = async (params = {}) => {
  const response = await api.get("/ipcr.php", {
    params: {
      action: "list",
      ...params,
    },
  });
  return response.data;
};

export const fetchIpcrRecord = async (ipcrId) => {
  const response = await api.get("/ipcr.php", {
    params: {
      action: "view",
      ipcr_id: ipcrId,
    },
  });
  return response.data;
};

export const createIpcr = async (payload) => {
  const response = await api.post("/ipcr.php?action=create", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

export const updateIpcrRecord = async (payload) => {
  const response = await api.put("/ipcr.php?action=update", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

export const submitIpcrRating = async (payload) => {
  const response = await api.put("/ipcr.php?action=submit_rating", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

/*
 * Submits KPIs for validation: `{ kpis: [{ ipcr_id, actual_accomplishment, q1_rating, e2_rating,
 * t3_rating }] }`. Each KPI must already carry at least one MOV, so upload those first.
 */
export const submitIpcrAccomplishment = async (payload) => {
  const response = await api.put("/ipcr.php?action=submit_accomplishment", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

/*
 * The rater's decisions on submitted KPIs, in one call: `[{ ipcr_id, decision: "validate" |
 * "return", q1_rating, e2_rating, t3_rating, remarks }]`. A return needs `remarks` for the employee.
 */
export const validateIpcrRecords = async (decisions) => {
  const response = await api.put("/ipcr.php?action=validate", { decisions });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const deleteIpcrVerification = async (fileId) => {
  const response = await api.delete("/ipcr.php?action=delete_verification", {
    data: {
      file_id: fileId,
    },
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const updateIpcrStatus = async (ipcrId, status) => {
  const response = await api.put("/ipcr.php?action=status", {
    ipcr_id: ipcrId,
    status,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const archiveIpcrRecord = async (ipcrId) => {
  const response = await api.delete("/ipcr.php?action=archive", {
    data: {
      ipcr_id: ipcrId,
    },
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const restoreIpcrRecord = async (ipcrId) => {
  const response = await api.patch("/ipcr.php?action=restore", {
    ipcr_id: ipcrId,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const uploadIpcrVerification = async (ipcrId, file, outputId = "") => {
  const formData = new FormData();
  formData.append("ipcr_id", String(ipcrId || ""));
  if (outputId) {
    formData.append("output_id", String(outputId));
  }
  formData.append("verification_file", file);

  const response = await api.post("/ipcr.php?action=upload_verification", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

/**
 * Service Record (CSC Form No. 1).
 *
 * Omitting `employeeRecordId` asks the backend for the signed-in user's own record, which is what
 * the self-service screen wants.
 */
export const fetchServiceRecord = async (employeeRecordId = null) => {
  const response = await api.get("/service_record.php", {
    params: employeeRecordId ? { employeeId: employeeRecordId } : {},
  });
  return response.data;
};

export const createServiceRecordEntry = async (payload) => {
  const response = await api.post("/service_record.php?action=create", payload);
  return response.data;
};

export const previewServiceRecordImport = async (employeeRecordId, file) => {
  if (/\.pdf$/i.test(file.name)) {
    const { readServiceRecordPdf } = await import("../module/serviceRecord/serviceRecordPdfReader");
    const rows = await readServiceRecordPdf(file);
    const response = await api.post("/service_record.php?action=preview-pdf", { employeeRecordId, rows });
    return response.data;
  }
  const formData = new FormData();
  formData.append("employeeRecordId", employeeRecordId);
  formData.append("file", file);
  const response = await api.post("/service_record.php?action=preview-import", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const importServiceRecordEntries = async (employeeRecordId, entries) => {
  const response = await api.post("/service_record.php?action=import", { employeeRecordId, entries });
  return response.data;
};

export const updateServiceRecordEntry = async (payload) => {
  const response = await api.put("/service_record.php?action=update", payload);
  return response.data;
};

export const archiveServiceRecordEntry = async (employeeRecordId, id) => {
  const response = await api.delete("/service_record.php?action=archive", {
    data: { employeeRecordId, id },
  });
  return response.data;
};

/** Every employee's current step and the date it took effect, for the Loyalty step column. */
export const fetchServiceRecordSteps = async () => {
  const response = await api.get("/service_record.php", { params: { action: "steps" } });
  return response.data;
};

export const fetchOpcrRecords = async (params = {}) => {
  const response = await api.get("/opcr.php", {
    params: {
      action: "list",
      ...params,
    },
  });
  return response.data;
};

export const createOpcr = async (payload) => {
  const response = await api.post("/opcr.php?action=create", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

export const updateOpcrRecord = async (payload) => {
  const response = await api.put("/opcr.php?action=update", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

export const archiveOpcrRecord = async (assignmentId) => {
  const response = await api.delete("/opcr.php?action=archive", {
    data: {
      assignment_id: assignmentId,
    },
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const restoreOpcrRecord = async (assignmentId) => {
  const response = await api.patch("/opcr.php?action=restore", {
    assignment_id: assignmentId,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const submitOpcrRating = async (payload) => {
  const response = await api.put("/opcr.php?action=submit_rating", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

/*
 * The division chief sends KPIs to the Regional Director: `{ kpis: [{ assignment_id,
 * actual_accomplishment }] }`. Each KPI must already carry at least one MOV, so upload those first.
 */
export const submitOpcrAccomplishment = async (payload) => {
  const response = await api.put("/opcr.php?action=submit_accomplishment", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

/*
 * The Regional Director's decisions on submitted KPIs, in one call: `[{ assignment_id, decision:
 * "validate" | "return", q1_rating, e2_rating, t3_rating, remarks }]`. A return needs `remarks`.
 */
export const validateOpcrRecords = async (decisions) => {
  const response = await api.put("/opcr.php?action=validate", { decisions });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const deleteOpcrVerification = async (fileId) => {
  const response = await api.delete("/opcr.php?action=delete_verification", {
    data: {
      file_id: fileId,
    },
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const uploadOpcrVerification = async (assignmentId, file) => {
  const formData = new FormData();
  formData.append("assignment_id", String(assignmentId || ""));
  formData.append("verification_file", file);

  const response = await api.post("/opcr.php?action=upload_verification", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

/**
 * Rewards & Recognition. `fetchAwardCycles` returns every cycle with its nominations nested, plus
 * the `viewerKey` the screen matches against each nomination to find the signed-in user's own ones.
 */
export const fetchAwardCycles = async ({ archived = false } = {}) => {
  const response = await api.get("/rewards.php", {
    params: { action: "list", ...(archived ? { archived: 1 } : {}) },
  });
  return response.data;
};

export const createAwardCycle = async (payload) => {
  const response = await api.post("/rewards.php?action=create", payload);
  return response.data;
};

export const updateAwardCycle = async (payload) => {
  const response = await api.put("/rewards.php?action=update", payload);
  return response.data;
};

export const setAwardCycleStatus = async (payload) => {
  const response = await api.put("/rewards.php?action=status", payload);
  return response.data;
};

export const archiveAwardCycle = async (cycleId) => {
  const response = await api.put("/rewards.php?action=archive", { cycleId });
  return response.data;
};

export const restoreAwardCycle = async (cycleId) => {
  const response = await api.put("/rewards.php?action=restore", { cycleId });
  return response.data;
};

export const deleteAwardCycle = async (cycleId) => {
  const response = await api.delete("/rewards.php?action=delete", { data: { cycleId } });
  return response.data;
};

/** A Chief's nomination of one colleague: `{ cycleId, nomineeKey, reason }`. It waits for HR review. */
export const submitAwardNomination = async (payload) => {
  const response = await api.post("/rewards.php?action=nominate", payload);
  return response.data;
};

/** The HR Head's decision on one nomination: `{ nominationId, status: "approved" | "rejected", reviewerNote }`. */
export const reviewAwardNomination = async (payload) => {
  const response = await api.put("/rewards.php?action=review", payload);
  return response.data;
};

/**
 * An employee's vote for one approved nominee: `{ cycleId, nomineeKey }`. Voting again in the same
 * cycle changes the vote rather than adding a second one.
 */
export const castAwardVote = async (payload) => {
  const response = await api.post("/rewards.php?action=vote", payload);
  return response.data;
};

/**
 * The signed-in user's own award certificates, minted when a cycle they won was closed.
 *
 * Takes no employee argument on purpose — the server scopes the list to the employee record behind
 * the session, so "My Rewards" cannot be pointed at somebody else's.
 */
export const fetchMyAwardCertificates = async () => {
  const response = await api.get("/rewards.php", { params: { action: "certificates" } });
  return response.data;
};

export const fetchCertificateTemplate = async () => {
  const response = await api.get("/rewards.php", { params: { action: "certificate-template" } });
  return response.data;
};

export const createSavedCertificateTemplate = async ({ name, template }) => {
  const response = await api.post("/rewards.php?action=certificate-template", { name, template });
  return response.data;
};

export const updateCertificateTemplate = async (template, { templateId, name } = {}) => {
  const response = await api.put("/rewards.php?action=certificate-template", {
    template,
    ...(templateId ? { templateId } : {}),
    ...(name ? { name } : {}),
  });
  return response.data;
};

export const deleteSavedCertificateTemplate = async (templateId) => {
  const response = await api.delete("/rewards.php?action=certificate-template", {
    data: { templateId },
  });
  return response.data;
};

export const assignCertificateTemplateToCycle = async ({ cycleId, template }) => {
  const response = await api.put("/rewards.php?action=assign-certificate-template", { cycleId, template });
  return response.data;
};

export const uploadCertificateSignature = async (file) => {
  const formData = new FormData();
  formData.append("signature", file);

  const response = await api.post("/rewards.php?action=certificate-signature", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const uploadCertificateDesign = async (file) => {
  const formData = new FormData();
  formData.append("design", file);

  const response = await api.post("/rewards.php?action=certificate-design-image", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

/**
 * One long-poll against the change feed.
 *
 * The shared 20s client timeout would abort a full hold just before the server answers, so this
 * request carries its own: the hold plus enough margin for the final tick's queries and the trip
 * back. `signal` lets the caller drop a parked request immediately when the tab is hidden or the
 * user signs out, instead of leaving an Apache worker thread pinned to a reader that has gone.
 */
export const getChangeFeed = async ({ cursor = "", holdSeconds = 25, signal } = {}) => {
  const response = await api.get("/changes.php", {
    params: { cursor, hold: holdSeconds },
    timeout: (holdSeconds + 10) * 1000,
    signal,
  });
  return response.data;
};

export const getReportData = async (params = {}) => {
  const response = await api.get("/reports.php", { params });
  return response.data;
};

export const exportReportData = async (params = {}) => {
  const response = await api.get("/reports.php", {
    params,
    responseType: "blob",
  });
  const disposition = response.headers?.["content-disposition"] || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

  return {
    blob: response.data,
    filename: filenameMatch?.[1] || `hris-report-${new Date().toISOString().slice(0, 10)}`,
  };
};

export const getReportCatalog = async () => {
  const response = await api.get("/reports.php", { params: { action: "catalog" } });
  return response.data;
};

export const getReportFilterOptions = async () => {
  const response = await api.get("/reports.php", { params: { action: "filters" } });
  return response.data;
};

export const getReportsDashboard = async (params = {}) => {
  const response = await api.get("/reports.php", {
    params: { action: "dashboard", ...params },
  });
  return response.data;
};

export const getReportActivity = async (params = {}) => {
  const response = await api.get("/reports.php", {
    params: { action: "activity", ...params },
  });
  return response.data;
};

export const deleteReportActivity = async (ids = []) => {
  const response = await api.delete("/reports.php", {
    params: { action: "activity", ids: ids.join(",") },
  });
  return response.data;
};

export const logReportAction = async (payload = {}) => {
  const response = await api.post("/reports.php?action=log", payload);
  return response.data;
};

export const getPublicSettings = async () => {
  const response = await api.get("/settings.php?section=public");
  return response.data;
};

export const getTwoFactorProfile = async () => {
  const response = await api.get("/two_factor.php");
  return response.data;
};

export const saveTwoFactorProfile = async (payload) => {
  const response = await api.put("/two_factor.php", payload);
  return response.data;
};

export const getEmailVerificationProfile = async () => {
  const response = await api.get("/email_verification.php");
  return response.data;
};

export const requestEmailChange = async ({ newEmail, confirmNewEmail }) => {
  const response = await api.post("/email_verification.php", {
    action: "request_change",
    newEmail,
    confirmNewEmail,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const requestCurrentEmailVerification = async () => {
  const response = await api.post("/email_verification.php", {
    action: "request_current",
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const verifyEmailVerificationCode = async (code) => {
  const response = await api.post("/email_verification.php", {
    action: "verify",
    code,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const resendEmailVerificationCode = async () => {
  const response = await api.post("/email_verification.php", {
    action: "resend",
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const cancelEmailVerification = async () => {
  const response = await api.post("/email_verification.php", {
    action: "cancel",
  });
  return response.data;
};

export const getPasswordChangeStatus = async () => {
  const response = await api.get("/password_change.php");
  return response.data;
};

export const requestPasswordChangeCode = async (currentPassword) => {
  const response = await api.post("/password_change.php", {
    action: "request",
    currentPassword,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const resendPasswordChangeCode = async () => {
  const response = await api.post("/password_change.php", {
    action: "resend",
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const confirmPasswordChange = async ({ code, newPassword, confirmPassword }) => {
  const response = await api.post("/password_change.php", {
    action: "verify",
    code,
    newPassword,
    confirmPassword,
  });
  notifyNotificationsChangedEvent();
  return response.data;
};

export const cancelPasswordChange = async () => {
  const response = await api.post("/password_change.php", {
    action: "cancel",
  });
  return response.data;
};

export const saveDivision = async (division) => {
  const method = division.id ? "put" : "post";
  const response = await api[method]("/settings.php", {
    type: "division",
    ...division,
  });
  return response.data;
};

export const saveDesignation = async (designation) => {
  const method = designation.id ? "put" : "post";
  const response = await api[method]("/settings.php", {
    type: "designation",
    ...designation,
  });
  return response.data;
};

export const archiveDivision = async (id) => {
  const response = await api.put("/settings.php", {
    type: "division",
    action: "archive",
    id,
  });
  return response.data;
};

export const restoreDivision = async (id) => {
  const response = await api.put("/settings.php", {
    type: "division",
    action: "restore",
    id,
  });
  return response.data;
};

export const archiveDesignation = async (id) => {
  const response = await api.put("/settings.php", {
    type: "designation",
    action: "archive",
    id,
  });
  return response.data;
};

export const restoreDesignation = async (id) => {
  const response = await api.put("/settings.php", {
    type: "designation",
    action: "restore",
    id,
  });
  return response.data;
};

export const saveLeaveType = async (leaveType) => {
  const response = await api.post("/settings.php", {
    type: "leave_type",
    ...leaveType,
  });
  return response.data;
};

export const saveSecuritySettings = async (security) => {
  const response = await api.put("/settings.php", {
    type: "security",
    ...security,
  });
  return response.data;
};

export const saveSecurityPolicySettings = async (security) => {
  const response = await api.put("/settings.php", {
    type: "security_policy",
    ...security,
  });
  return response.data;
};

export const saveTwoFactorSettings = async (settings) => {
  const response = await api.put("/settings.php", {
    type: "two_factor",
    ...settings,
  });
  return response.data;
};

export const saveRateLimitSettings = async (settings) => {
  const response = await api.put("/settings.php", {
    type: "rate_limit",
    ...settings,
  });
  return response.data;
};

/** `signatories` maps each certification slot to an employee record id, or 0 to leave it blank. */
export const savePayrollSignatories = async (signatories) => {
  const response = await api.put("/settings.php", {
    type: "payroll_signatories",
    signatories,
  });
  return response.data;
};

export const saveEmailDomainPolicy = async (policy) => {
  const response = await api.put("/settings.php", {
    type: "email_domain_policy",
    ...policy,
  });
  return response.data;
};

export const unlockLockedAccount = async (id) => {
  const response = await api.put("/settings.php", {
    type: "unlock_account",
    id,
  });
  return response.data;
};

export const savePermissionSettings = async (permissions) => {
  const response = await api.put("/settings.php", {
    type: "permissions",
    permissions,
  });
  return response.data;
};

export const saveUserPermissionSettings = async (userId, permissions) => {
  const response = await api.put("/settings.php", {
    type: "user_permissions",
    userId,
    permissions,
  });
  return response.data;
};

export const resetUserPermissionSettings = async (userId) => {
  const response = await api.put("/settings.php", {
    type: "user_permissions",
    userId,
    reset: true,
  });
  return response.data;
};

export const getPermissions = async (params = {}) => {
  const response = await api.get("/permissions.php", { params });
  return response.data;
};

export const getRoles = async () => {
  const response = await api.get("/roles.php");
  return response.data;
};

export const createRole = async (payload) => {
  const response = await api.post("/roles.php", payload);
  return response.data;
};

export const updateRole = async (id, payload) => {
  const response = await api.put("/roles.php", { ...payload, id });
  return response.data;
};

export const deleteRole = async (id) => {
  const response = await api.delete("/roles.php", { data: { id } });
  return response.data;
};

export const saveRolePermissions = async (payload) => {
  const response = await api.put("/permissions.php", payload);
  return response.data;
};

export const saveSystemConfiguration = async (systemConfiguration) => {
  const response = await api.put("/settings.php", {
    type: "system_configuration",
    ...systemConfiguration,
  });
  return response.data;
};

export const saveUiPreference = async (uiThemeColor) => {
  const response = await api.put("/settings.php", {
    type: "ui_preference",
    uiThemeColor,
  });
  return response.data;
};

export const downloadDatabaseBackup = async () => {
  const response = await api.get("/backup.php", {
    params: { action: "download" },
    responseType: "blob",
  });
  const disposition = response.headers?.["content-disposition"] || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

  return {
    blob: response.data,
    filename: filenameMatch?.[1] || `hris-backup-${new Date().toISOString().slice(0, 10)}.sql`,
  };
};

export const getBackupData = async () => {
  const response = await api.get("/backup.php", {
    params: { action: "settings" },
  });
  return response.data;
};

export const saveBackupSettings = async (settings) => {
  const response = await api.put("/backup.php", {
    action: "settings",
    ...settings,
  });
  return response.data;
};

export const createManualBackup = async (settings = {}) => {
  const response = await api.post("/backup.php", {
    action: "manual",
    backupDateTime: settings.backupDateTime || "",
  });
  return response.data;
};

export const downloadBackupRecord = async (id) => {
  const response = await api.get("/backup.php", {
    params: {
      action: "download",
      id,
    },
    responseType: "blob",
  });
  const disposition = response.headers?.["content-disposition"] || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

  return {
    blob: response.data,
    filename: filenameMatch?.[1] || `hris-backup-${id || new Date().toISOString().slice(0, 10)}.sql`,
  };
};

export const deleteBackupRecord = async (id) => {
  const response = await api.delete("/backup.php", {
    data: { id },
  });
  return response.data;
};

export default api;
