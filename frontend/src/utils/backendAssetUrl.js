const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost/Capstone2/frontend/backend/api";

export function resolveBackendAssetUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  if (/^(https?:|data:|blob:)/i.test(rawValue)) {
    return rawValue;
  }

  if (/^[a-z]:\\/i.test(rawValue)) {
    return "";
  }

  if (rawValue.startsWith("/")) {
    return `${window.location.origin}${rawValue}`;
  }

  let backendRootUrl = "";
  try {
    const apiUrl = new URL(API_BASE_URL, window.location.origin);
    const backendBasePath = apiUrl.pathname.replace(/\/api\/?$/, "/");
    backendRootUrl = `${apiUrl.origin}${backendBasePath}`;
  } catch {
    backendRootUrl = `${window.location.origin}/`;
  }

  const normalizedPath = rawValue.replace(/\\/g, "/").replace(/^\/+/, "");
  return new URL(normalizedPath, backendRootUrl).toString();
}
