import { API_BASE_URL } from "./api";

/**
 * Base URL for a binary export endpoint.
 *
 * On localhost:3000, route binary downloads directly to Apache instead of through CRA's proxy;
 * that proxy can crash on a closed XLSX stream with ERR_STREAM_WRITE_AFTER_END, taking
 * `npm start` down with it.
 */
export function exportApiBaseUrl() {
  const baseUrl = new URL(`${API_BASE_URL.replace(/\/?$/, "/")}`, window.location.origin);
  const isLocalDevServer = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    && window.location.port === "3000"
    && baseUrl.origin === window.location.origin;

  if (isLocalDevServer) {
    baseUrl.hostname = window.location.hostname;
    baseUrl.port = "";
    baseUrl.protocol = window.location.protocol;
  }

  return baseUrl;
}

/**
 * Download one export endpoint as a file.
 *
 * Use fetch rather than Axios for the blob, and read a refusal back out of it by hand: a rejected
 * export still arrives as a blob, so without this every failure would surface as a corrupt
 * download instead of the message the API sent.
 */
export async function downloadExportFile(url, filename, fallbackMessage = "Unable to export this file.") {
  const response = await fetch(String(url), {
    credentials: "include",
    headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json" },
  });
  const blob = await response.blob();

  const contentType = String(response.headers.get("content-type") || "");
  if (!response.ok || contentType.includes("application/json")) {
    let message = "";

    try {
      message = JSON.parse(await blob.text())?.message || "";
    } catch {
      message = "";
    }

    throw new Error(message || fallbackMessage);
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}
