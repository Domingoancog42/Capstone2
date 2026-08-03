import axios from "axios";
import {
  publishAutoRefresh,
  shouldPublishAutoRefreshForRequest,
  topicFromRequestUrl,
} from "../components/auto/autorefreshconfig";

export const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost/Capstone2/frontend/backend/api";
export const AUTH_SESSION_EXPIRED_EVENT = "hris:auth-session-expired";

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
  "/login.php",
  "/two_factor_verify.php",
  "/two_factor_resend.php",
  "/forgot_password.php",
  "/reset_password.php",
  "/public_settings.php",
];

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
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

  return (
    ["post", "put", "patch", "delete"].includes(method)
    && !requestUrl.includes("/csrf.php")
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

    if (
      status === 401
      && !isAuthExemptRequest
      && typeof window !== "undefined"
    ) {
      window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
    }

    return Promise.reject(error);
  }
);

export const login = async (credentials) => {
  const response = await api.post("/login.php", credentials);
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

export const refreshSession = async () => {
  const response = await api.get("/session.php");
  return response.data;
};

export const checkPasswordExpiry = async () => {
  const response = await api.get("/password_expiry_check.php");
  return response.data;
};

export const forgotPassword = async (payload) => {
  const response = await api.post("/forgot_password.php", payload);
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
  const response = await api.post("/two_factor_verify.php", payload);
  return response.data;
};

export const resendTwoFactorCode = async () => {
  const response = await api.post("/two_factor_resend.php");
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

  const response = await api.post("/employee.php", formData, {
    timeout: 180000,
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

export const getUsers = async () => {
  const response = await api.get("/user.php");
  return response.data;
};

export const createUser = async (user) => {
  const response = await api.post("/user.php", user);
  notifyNotificationsChangedEvent();
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

export const getChat = async (contactId = "") => {
  const response = await api.get("/chat.php", {
    params: contactId ? { contactId } : {},
  });
  return response.data;
};

export const sendChatMessage = async (receiverId, messageText) => {
  const response = await api.post("/chat.php", {
    receiverId,
    messageText,
  });
  return response.data;
};

export const getSettings = async () => {
  const response = await api.get("/settings.php");
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

export const submitIpcrRating = async (payload) => {
  const response = await api.put("/ipcr.php?action=submit_rating", payload);
  notifyNotificationsChangedEvent();
  return response.data;
};

export const submitIpcrAccomplishment = async (payload) => {
  const response = await api.put("/ipcr.php?action=submit_accomplishment", payload);
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

export const submitOpcrRating = async (payload) => {
  const response = await api.put("/opcr.php?action=submit_rating", payload);
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
 * the `viewerKey` the screen matches against each nomination to find the signed-in user's own vote.
 */
export const fetchAwardCycles = async () => {
  const response = await api.get("/rewards.php", { params: { action: "list" } });
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

export const deleteAwardCycle = async (cycleId) => {
  const response = await api.delete("/rewards.php?action=delete", { data: { cycleId } });
  return response.data;
};

export const castAwardNomination = async (payload) => {
  const response = await api.post("/rewards.php?action=vote", payload);
  return response.data;
};

export const withdrawAwardNomination = async (cycleId) => {
  const response = await api.delete("/rewards.php?action=withdraw", { data: { cycleId } });
  return response.data;
};

/**
 * Revision string per topic, used by the live-update poller to spot work done by other users.
 * Deliberately unauthenticated of side effects — it only ever reads.
 */
export const getChangeFeed = async () => {
  const response = await api.get("/changes.php");
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

export const getReportSchedules = async () => {
  const response = await api.get("/reports.php", { params: { action: "schedules" } });
  return response.data;
};

export const saveReportSchedule = async (payload = {}) => {
  const method = payload?.id ? "put" : "post";
  const response = await api[method]("/reports.php?action=schedules", payload);
  return response.data;
};

export const deleteReportSchedule = async (id) => {
  const response = await api.delete("/reports.php", {
    params: { action: "schedules", id },
  });
  return response.data;
};

export const getPublicSettings = async () => {
  const response = await api.get("/public_settings.php");
  return response.data;
};

export const getTwoFactorProfile = async () => {
  const response = await api.get("/two_factor_profile.php");
  return response.data;
};

export const saveTwoFactorProfile = async (payload) => {
  const response = await api.put("/two_factor_profile.php", payload);
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

export const fetchRateLimitOverview = async () => {
  const response = await api.get("/rate_limit.php");
  return response.data;
};

export const saveRateLimitSettings = async (settings) => {
  const response = await api.put("/rate_limit.php", {
    action: "settings",
    ...settings,
  });
  return response.data;
};

export const blockRateLimitAddress = async ({ group, identifier, minutes, reason }) => {
  const response = await api.post("/rate_limit.php", {
    action: "block",
    group,
    identifier,
    minutes,
    reason,
  });
  return response.data;
};

export const releaseRateLimitBlock = async (id) => {
  const response = await api.put("/rate_limit.php", {
    action: "unblock",
    id,
  });
  return response.data;
};

export const clearRateLimitCounters = async () => {
  const response = await api.delete("/rate_limit.php");
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
