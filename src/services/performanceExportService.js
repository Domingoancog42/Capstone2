import { downloadExportFile, exportApiBaseUrl } from "./exportDownload";

/*
 * Excel exports of the OPCR and IPCR forms.
 *
 * Both endpoints take the record the export was launched from and answer with the whole form it
 * belongs to: every KPI for the accountable unit/employee and rating period, matching the preview.
 */

function fileSlug(value, fallback) {
  const slug = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug || fallback;
}

/** Download the OPCR form the given assignment belongs to. */
export async function exportOpcrForm(record) {
  const templateId = Number(record?.templateId) || 0;
  const assignmentId = Number(record?.assignmentId ?? record?.id) || 0;

  if (templateId <= 0 && assignmentId <= 0) {
    throw new Error("Open an OPCR form before exporting it.");
  }

  const url = new URL("opcr.php", exportApiBaseUrl());
  url.searchParams.set("action", "export_form");
  if (assignmentId > 0) {
    url.searchParams.set("assignment_id", String(assignmentId));
  } else {
    url.searchParams.set("template_id", String(templateId));
  }

  const label = fileSlug(`${record?.period || ""} ${record?.semester || ""}`, "form");

  await downloadExportFile(url, `opcr-form-${label}.xlsx`, "Unable to export the OPCR form.");
}

/** Download the IPCR form the given record belongs to. */
export async function exportIpcrForm(record) {
  const ipcrId = Number(record?.ipcrId ?? record?.id) || 0;

  if (ipcrId <= 0) {
    throw new Error("Open an IPCR form before exporting it.");
  }

  const url = new URL("ipcr.php", exportApiBaseUrl());
  url.searchParams.set("action", "export_form");
  url.searchParams.set("ipcr_id", String(ipcrId));

  const label = fileSlug(
    `${record?.employeeName || ""} ${record?.periodFrom || ""} ${record?.periodTo || ""}`,
    "form"
  );

  await downloadExportFile(url, `ipcr-form-${label}.xlsx`, "Unable to export the IPCR form.");
}
