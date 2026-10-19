import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import EmployeeDocumentManager from "./EmployeeDocumentManager";
import { EmployeeDocumentsModal } from "./EmployeeDocumentsModal";
import { deleteEmployeeDocument, getEmployeeDocuments } from "../../services/api";
import { downloadBackendFile } from "../../utils/downloadBackendFile";

/* eslint-disable testing-library/no-unnecessary-act */
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));
jest.mock("react-hot-toast", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("../../services/api", () => ({ getEmployeeDocuments: jest.fn(), deleteEmployeeDocument: jest.fn() }));
jest.mock("../../utils/downloadBackendFile", () => ({ downloadBackendFile: jest.fn() }));
jest.mock("../documents/EmployeeDocumentPreviewModal", () => ({ open, documentItem, subtitle }) => (
  open ? <div role="dialog" aria-label="Document preview">{subtitle}: {documentItem.fileName}</div> : null
));
jest.mock("../UI/modal", () => ({ open, children, footer }) => (
  open ? <div role="dialog" aria-label="Employee Documents">{children}{footer}</div> : null
));

const employee = { id: 47, fullName: "Alex Reyes", employeeId: "EMP-047" };
const firstId = { id: "stored-valid-id-1", documentType: "valid_id", fileName: "first-id.pdf", path: "/uploads/first-id.pdf" };
const secondId = { id: "stored-valid-id-2", documentType: "valid_id", fileName: "second-id.png", path: "/uploads/second-id.png" };
const resume = { id: "stored-resume", documentType: "resume", fileName: "resume.pdf", path: "/uploads/resume.pdf" };
let container;
let root;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function findButton(text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === text);
}

async function renderManager(props = {}) {
  await act(async () => root.render(<EmployeeDocumentManager employee={employee} {...props} />));
}

async function clickRemove(name = firstId.fileName) {
  await act(async () => container.querySelector(`[aria-label="Remove ${name}"]`).click());
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  getEmployeeDocuments.mockResolvedValue({ documents: [firstId, secondId, resume] });
  deleteEmployeeDocument.mockResolvedValue({ documents: [secondId, resume] });
  Swal.fire.mockResolvedValue({ isConfirmed: true });
  downloadBackendFile.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("lists every uploaded file and all four document groups, with preview and download available", async () => {
  await renderManager();
  expect(getEmployeeDocuments).toHaveBeenCalledWith(47);
  ["Birth Certificate", "Valid IDs", "Resume / CV", "Diploma", firstId.fileName, secondId.fileName, resume.fileName]
    .forEach((label) => expect(container.textContent).toContain(label));
  expect(container.textContent).toContain("2 files");
  expect(container.textContent).toContain("Confirmed removals take effect immediately");
  await act(async () => findButton("View").click());
  expect(container.querySelector('[aria-label="Document preview"]').textContent).toBe("Alex Reyes: first-id.pdf");
  await act(async () => findButton("Download").click());
  expect(downloadBackendFile).toHaveBeenCalledWith(firstId.path, firstId.fileName);
});

test("removes only the confirmed document using the employee record id and returned listing", async () => {
  const addedByServer = { ...firstId, id: "another-file", fileName: "new-file.pdf" };
  deleteEmployeeDocument.mockResolvedValue({ documents: [secondId, resume, addedByServer] });
  await renderManager();
  await clickRemove();
  expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining('"first-id.pdf"'),
    showCancelButton: true,
    focusCancel: true,
  }));
  expect(deleteEmployeeDocument).toHaveBeenCalledTimes(1);
  expect(deleteEmployeeDocument).toHaveBeenCalledWith(47, "stored-valid-id-1");
  expect(container.textContent).not.toContain("first-id.pdf");
  expect(container.textContent).toContain("second-id.png");
  expect(container.textContent).toContain("new-file.pdf");
  expect(toast.success).toHaveBeenCalled();
});

test("canceling confirmation keeps the file and does not issue a delete", async () => {
  Swal.fire.mockResolvedValue({ isConfirmed: false });
  await renderManager();
  await clickRemove();
  expect(deleteEmployeeDocument).not.toHaveBeenCalled();
  expect(container.textContent).toContain(firstId.fileName);
  expect(container.querySelector('[aria-label="Remove first-id.pdf"]').disabled).toBe(false);
});

test("a failed delete keeps the file and allows a retry", async () => {
  deleteEmployeeDocument.mockRejectedValue({ response: { data: { message: "Deletion was denied." } } });
  await renderManager();
  await clickRemove();
  expect(toast.error).toHaveBeenCalledWith("Deletion was denied.");
  expect(container.textContent).toContain(firstId.fileName);
  expect(container.querySelector('[aria-label="Remove first-id.pdf"]').disabled).toBe(false);
});

test("disables removal while confirming or deleting and when the editor is disabled", async () => {
  const confirmation = deferred();
  const deletion = deferred();
  Swal.fire.mockReturnValue(confirmation.promise);
  deleteEmployeeDocument.mockReturnValue(deletion.promise);
  await renderManager();
  await clickRemove();
  expect([...container.querySelectorAll('[aria-label^="Remove "]')].every((button) => button.disabled)).toBe(true);
  await act(async () => confirmation.resolve({ isConfirmed: true }));
  expect([...container.querySelectorAll('[aria-label^="Remove "]')].every((button) => button.disabled)).toBe(true);
  await act(async () => deletion.resolve({ documents: [secondId, resume] }));
  expect(container.querySelector('[aria-label="Remove second-id.png"]').disabled).toBe(false);
  await renderManager({ disabled: true });
  expect([...container.querySelectorAll('[aria-label^="Remove "]')].every((button) => button.disabled)).toBe(true);
  expect(findButton("View").disabled).toBe(false);
  expect(findButton("Download").disabled).toBe(false);
});

test("shows a fetch failure and retries loading the employee's files", async () => {
  getEmployeeDocuments.mockRejectedValueOnce(new Error("Could not fetch documents."));
  await renderManager();
  expect(container.querySelector('[role="alert"]').textContent).toContain("Could not fetch documents.");
  await act(async () => findButton("Retry").click());
  expect(getEmployeeDocuments).toHaveBeenCalledTimes(2);
  expect(getEmployeeDocuments).toHaveBeenLastCalledWith(47);
  expect(container.textContent).toContain(firstId.fileName);
});

test("applies a pending deletion response even when Save temporarily disables the editor", async () => {
  const deletion = deferred();
  deleteEmployeeDocument.mockReturnValue(deletion.promise);
  await renderManager();
  await clickRemove();
  expect(deleteEmployeeDocument).toHaveBeenCalledWith(47, firstId.id);
  await renderManager({ disabled: true });
  await renderManager({ disabled: false });
  expect(container.querySelector('[aria-label="Remove second-id.png"]').disabled).toBe(true);
  await act(async () => deletion.resolve({ documents: [secondId, resume] }));
  expect(container.textContent).not.toContain(firstId.fileName);
  expect(container.querySelector('[aria-label="Remove second-id.png"]').disabled).toBe(false);
});

test("clears the previous employee's visible files while the next employee loads", async () => {
  await renderManager();
  const nextListing = deferred();
  getEmployeeDocuments.mockReturnValueOnce(nextListing.promise);
  await renderManager({ employee: { id: 73, fullName: "Jamie Cruz" } });
  expect(container.textContent).not.toContain(firstId.fileName);
  expect(container.querySelector('[role="status"]').textContent).toContain("Loading documents...");
  await act(async () => nextListing.resolve({ documents: [] }));
  expect(container.textContent).toContain("No file uploaded yet.");
});

test("ignores a late listing from the previously selected employee", async () => {
  const oldListing = deferred();
  const newListing = deferred();
  getEmployeeDocuments.mockReturnValueOnce(oldListing.promise).mockReturnValueOnce(newListing.promise);
  await renderManager();
  await renderManager({ employee: { id: 73, fullName: "Jamie Cruz" } });
  await act(async () => newListing.resolve({ documents: [{ ...resume, fileName: "jamie-resume.pdf" }] }));
  expect(container.textContent).toContain("jamie-resume.pdf");
  await act(async () => oldListing.resolve({ documents: [firstId] }));
  expect(container.textContent).toContain("jamie-resume.pdf");
  expect(container.textContent).not.toContain(firstId.fileName);
  expect(getEmployeeDocuments).toHaveBeenNthCalledWith(2, 73);
});

test("switching employees during confirmation cannot remove the old employee's file", async () => {
  const confirmation = deferred();
  Swal.fire.mockReturnValue(confirmation.promise);
  await renderManager();
  await clickRemove();
  await renderManager({ employee: { id: 73, fullName: "Jamie Cruz" } });
  await act(async () => confirmation.resolve({ isConfirmed: true }));
  expect(deleteEmployeeDocument).not.toHaveBeenCalled();
});

test("the read-only Documents modal still lists uploads with View and Download but no Remove", async () => {
  await act(async () => root.render(<EmployeeDocumentsModal open employee={employee} documents={[firstId, resume]} onClose={() => {}} />));
  const dialog = document.querySelector('[aria-label="Employee Documents"]');
  expect(dialog.textContent).toContain(firstId.fileName);
  expect(dialog.textContent).toContain(resume.fileName);
  expect([...dialog.querySelectorAll("button")].some((button) => button.textContent === "View")).toBe(true);
  expect([...dialog.querySelectorAll("button")].some((button) => button.textContent === "Download")).toBe(true);
  expect(dialog.querySelector('[aria-label^="Remove "]')).toBeNull();
  expect(getEmployeeDocuments).not.toHaveBeenCalled();
});
