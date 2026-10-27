import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "react-hot-toast";
import LeaveAttachmentUploadButton from "./LeaveAttachmentUploadButton";
import { removeLeaveMedicalCertificate, uploadLeaveMedicalCertificate } from "../../services/leaveService";
import { canUploadLeaveMedicalCertificate } from "../../utils/leaveHelpers";

jest.mock("../../services/leaveService", () => ({
  removeLeaveMedicalCertificate: jest.fn(),
  uploadLeaveMedicalCertificate: jest.fn(),
}));
jest.mock("react-hot-toast", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("./LeaveAttachmentPreview", () => {
  const React = require("react");
  return function MockLeaveAttachmentPreview({ open, attachmentName, attachmentPath, onClose, onRemove, removing }) {
    return open ? React.createElement("div", {
      role: "dialog",
      "aria-label": "Medical certificate preview",
      "data-attachment-path": attachmentPath,
    }, attachmentName,
    React.createElement("button", { type: "button", onClick: onClose }, "Close preview"),
    onRemove ? React.createElement("button", {
      type: "button", "aria-label": "Cancel medical certificate upload", disabled: removing, onClick: onRemove,
    }, "Cancel Upload") : null) : null;
  };
});

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

test("uploads a certificate and switches the single action to view the saved attachment", async () => {
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
  act(() => root.render(<LeaveAttachmentUploadButton request={updatedRequest} onUploaded={onUploaded} />));
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector('button[aria-label="Upload medical certificate"]')).toBeNull();
  expect(container.querySelector('input[type="file"]')).toBeNull();
  const viewButton = container.querySelector('button[aria-label="View medical certificate"]');
  expect(viewButton.textContent).toBe("");
  act(() => viewButton.click());
  expect(container.querySelector('[role="dialog"]').getAttribute("data-attachment-path")).toBe(updatedRequest.attachmentPath);
});

test("reports a failed upload and allows the employee to retry", async () => {
  uploadLeaveMedicalCertificate.mockRejectedValueOnce({ response: { data: { message: "Upload failed" } } });
  const onUploaded = jest.fn();
  act(() => root.render(<LeaveAttachmentUploadButton request={{ id: 42 }} onUploaded={onUploaded} />));
  await selectFile(new File(["certificate"], "medical.pdf"));
  expect(toast.error).toHaveBeenCalledWith("Upload failed");
  expect(onUploaded).not.toHaveBeenCalled();
  expect(container.querySelector('button[aria-label="Upload medical certificate"]').disabled).toBe(false);
});

test("rejects unsupported files before sending an upload", async () => {
  act(() => root.render(<LeaveAttachmentUploadButton request={{ id: 42 }} />));
  await selectFile(new File(["script"], "certificate.exe"));
  expect(uploadLeaveMedicalCertificate).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

test("opens the saved certificate in the shared overlay and closes without uploading", () => {
  const request = {
    id: 42,
    attachmentName: "medical.jpg",
    attachmentPath: "uploads/leave-attachments/medical.jpg",
  };
  const onUploaded = jest.fn();
  act(() => root.render(<LeaveAttachmentUploadButton request={request} onUploaded={onUploaded} />));
  const viewButton = container.querySelector('button[aria-label="View medical certificate"]');
  expect(viewButton.type).toBe("button");
  expect(container.querySelector('a[target="_blank"]')).toBeNull();
  act(() => viewButton.click());
  const preview = container.querySelector('[role="dialog"]');
  expect(preview.textContent).toContain("medical.jpg");
  expect(preview.getAttribute("data-attachment-path")).toBe(request.attachmentPath);
  act(() => preview.querySelector("button").click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(uploadLeaveMedicalCertificate).not.toHaveBeenCalled();
  expect(onUploaded).not.toHaveBeenCalled();
  expect(removeLeaveMedicalCertificate).not.toHaveBeenCalled();
});

test("cancels the saved upload and restores the upload action for a replacement", async () => {
  const request = { id: 42, attachmentName: "wrong.pdf", attachmentPath: "uploads/leave-attachments/wrong.pdf" };
  const updatedRequest = { ...request, attachmentName: "", attachmentPath: "" };
  let resolveRemoval;
  removeLeaveMedicalCertificate.mockReturnValueOnce(new Promise((resolve) => { resolveRemoval = resolve; }));
  const onUploaded = jest.fn();
  act(() => root.render(<LeaveAttachmentUploadButton request={request} onUploaded={onUploaded} />));
  act(() => container.querySelector('button[aria-label="View medical certificate"]').click());
  const cancelButton = container.querySelector('button[aria-label="Cancel medical certificate upload"]');
  act(() => cancelButton.click());
  expect(cancelButton.disabled).toBe(true);
  act(() => cancelButton.click());
  expect(removeLeaveMedicalCertificate).toHaveBeenCalledTimes(1);
  expect(removeLeaveMedicalCertificate).toHaveBeenCalledWith(42, request.attachmentPath);
  await act(async () => resolveRemoval({ request: updatedRequest }));
  expect(onUploaded).toHaveBeenCalledWith(updatedRequest);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(toast.success).toHaveBeenCalled();
  act(() => root.render(<LeaveAttachmentUploadButton request={updatedRequest} onUploaded={onUploaded} />));
  expect(container.querySelector('button[aria-label="Upload medical certificate"]')).not.toBeNull();
  expect(container.querySelector('input[type="file"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="View medical certificate"]')).toBeNull();
});

test("keeps the saved certificate open when cancelling the upload fails", async () => {
  const request = { id: 42, attachmentName: "wrong.pdf", attachmentPath: "uploads/leave-attachments/wrong.pdf" };
  removeLeaveMedicalCertificate.mockRejectedValueOnce({ response: { data: { message: "Unable to remove the file" } } });
  const onUploaded = jest.fn();
  act(() => root.render(<LeaveAttachmentUploadButton request={request} onUploaded={onUploaded} />));
  act(() => container.querySelector('button[aria-label="View medical certificate"]').click());
  await act(async () => container.querySelector('button[aria-label="Cancel medical certificate upload"]').click());
  expect(toast.error).toHaveBeenCalledWith("Unable to remove the file");
  expect(onUploaded).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="Cancel medical certificate upload"]').disabled).toBe(false);
});

test.each([
  { id: 43, attachmentPath: "uploads/leave-attachments/medical.jpg" },
  { id: 42, attachmentPath: "uploads/leave-attachments/replacement.jpg" },
])("closes the previous preview when its request or attachment changes: %j", (changedRequest) => {
  const request = { id: 42, attachmentName: "medical.jpg", attachmentPath: "uploads/leave-attachments/medical.jpg" };
  act(() => root.render(<LeaveAttachmentUploadButton request={request} />));
  const viewButton = container.querySelector('button[aria-label="View medical certificate"]');
  act(() => viewButton.click());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => root.render(<LeaveAttachmentUploadButton request={{ ...request, ...changedRequest }} />));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  act(() => root.render(<LeaveAttachmentUploadButton request={request} />));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(uploadLeaveMedicalCertificate).not.toHaveBeenCalled();
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
