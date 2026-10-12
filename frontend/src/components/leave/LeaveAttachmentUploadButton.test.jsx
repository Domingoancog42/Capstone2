import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "react-hot-toast";
import LeaveAttachmentUploadButton from "./LeaveAttachmentUploadButton";
import { uploadLeaveMedicalCertificate } from "../../services/leaveService";
import { canUploadLeaveMedicalCertificate } from "../../utils/leaveHelpers";

jest.mock("../../services/leaveService", () => ({ uploadLeaveMedicalCertificate: jest.fn() }));
jest.mock("react-hot-toast", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

/* eslint-disable testing-library/no-unnecessary-act */
let container;
let root;
beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function selectFile(file) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

test("uploads a certificate to the existing request and refreshes the saved attachment", async () => {
  const request = { id: 42, leaveType: "Sick Leave" };
  const updatedRequest = { ...request, attachmentName: "medical.pdf", attachmentPath: "uploads/leave-attachments/medical.pdf" };
  uploadLeaveMedicalCertificate.mockResolvedValue({ request: updatedRequest });
  const onUploaded = jest.fn();
  act(() => root.render(<LeaveAttachmentUploadButton request={request} onUploaded={onUploaded} />));
  const file = new File(["certificate"], "medical.pdf", { type: "application/pdf" });
  await selectFile(file);
  expect(onUploaded).toHaveBeenCalledWith(updatedRequest);
  expect(uploadLeaveMedicalCertificate).toHaveBeenCalledWith(42, file);
  expect(toast.success).toHaveBeenCalled();
});

test("reports a failed upload and allows the employee to retry", async () => {
  uploadLeaveMedicalCertificate.mockRejectedValueOnce({ response: { data: { message: "Upload failed" } } });
  const onUploaded = jest.fn();
  act(() => root.render(<LeaveAttachmentUploadButton request={{ id: 42 }} onUploaded={onUploaded} />));
  await selectFile(new File(["certificate"], "medical.pdf"));
  expect(toast.error).toHaveBeenCalledWith("Upload failed");
  expect(onUploaded).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Attachment Upload"]').disabled).toBe(false);
});

test("rejects unsupported files before sending an upload", async () => {
  act(() => root.render(<LeaveAttachmentUploadButton request={{ id: 42 }} />));
  await selectFile(new File(["script"], "certificate.exe"));
  expect(uploadLeaveMedicalCertificate).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

test("offers the upload only for the applicant's active sick-leave request", () => {
  const user = { employee_id: "EMP-1", full_name: "Test Employee" };
  const request = { employeeId: "EMP-1", leaveType: "Sick Leave", status: "Approved" };
  expect(canUploadLeaveMedicalCertificate(user, request)).toBe(true);
  expect(canUploadLeaveMedicalCertificate(user, { ...request, employeeId: "EMP-2" })).toBe(false);
  expect(canUploadLeaveMedicalCertificate(user, { ...request, leaveType: "Vacation Leave" })).toBe(false);
  expect(canUploadLeaveMedicalCertificate(user, { ...request, status: "Cancelled" })).toBe(false);
  expect(canUploadLeaveMedicalCertificate(user, { ...request, status: "Rejected" })).toBe(false);
  expect(canUploadLeaveMedicalCertificate(user, request, true)).toBe(false);
});
