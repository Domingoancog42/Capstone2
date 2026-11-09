import { uploadEmployeeDocument } from "./api";

/** Preserve only failed attachments so retrying cannot duplicate successful uploads. */
export async function saveEmployeeDocumentFiles(employeeId, attachments) {
  const results = await Promise.allSettled(attachments.map(({ documentType, file }) => {
    if (Number(employeeId) <= 0) return Promise.reject(new Error("The saved employee record has no valid ID."));
    return uploadEmployeeDocument(employeeId, documentType, file);
  }));
  return attachments.filter((_, index) => results[index].status === "rejected");
}
