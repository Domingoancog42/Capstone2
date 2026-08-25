import api from "./api";
import { exportApiBaseUrl } from "./exportDownload";

async function blobErrorMessage(blob, fallbackMessage) {
  if (!(blob instanceof Blob)) {
    return fallbackMessage;
  }

  try {
    return JSON.parse(await blob.text())?.message || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

export async function downloadPersonalDataSheet(profile = {}) {
  const url = exportApiBaseUrl();
  url.pathname = `${url.pathname.replace(/\/?$/, "/")}personal_data_sheet.php`;

  const employeeCode = String(profile.employeeId || "employee")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "employee";

  const fallbackMessage = "Unable to download your Personal Data Sheet.";

  try {
    const response = await api.post(
      String(url),
      {
        nationality: String(profile.nationality || "Filipino").trim(),
        barangay: String(profile.barangay || "").trim(),
      },
      {
        responseType: "blob",
        headers: {
          Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json",
        },
      }
    );

    const contentType = String(response.headers?.["content-type"] || "");
    if (contentType.includes("application/json")) {
      throw new Error(await blobErrorMessage(response.data, fallbackMessage));
    }

    const objectUrl = window.URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `PDS-${employeeCode}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    if (error?.response?.data instanceof Blob) {
      throw new Error(await blobErrorMessage(error.response.data, fallbackMessage));
    }

    throw new Error(error?.message || fallbackMessage);
  }
}
