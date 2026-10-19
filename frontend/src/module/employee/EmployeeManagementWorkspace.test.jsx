import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "react-hot-toast";
import EmployeeManagementWorkspace from "./EmployeeManagementWorkspace";
import {
  createEmployee,
  getArchivedEmployees,
  getArchivedUsers,
  getEmployeeOptions,
  getEmployees,
  getUsers,
  updateEmployee,
  uploadEmployeeDocument,
} from "../../services/api";

/* eslint-disable testing-library/no-unnecessary-act */

jest.mock("sweetalert2", () => ({ fire: jest.fn() }));
jest.mock("react-hot-toast", () => ({
  toast: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));
jest.mock("../../services/api", () => ({
  createEmployee: jest.fn(),
  deleteEmployee: jest.fn(),
  getArchivedUsers: jest.fn(),
  getEmployeeOptions: jest.fn(),
  getArchivedEmployees: jest.fn(),
  getEmployees: jest.fn(),
  getUsers: jest.fn(),
  importEmployeesCsv: jest.fn(),
  restoreEmployee: jest.fn(),
  updateEmployee: jest.fn(),
  updateEmployeeProfileImage: jest.fn(),
  uploadEmployeeDocument: jest.fn(),
}));
jest.mock("../../components/auto/autorefreshdatalist", () => ({
  useAutoRefreshOnChange: (loadEmployees) => {
    const { useEffect } = require("react");
    useEffect(() => { loadEmployees(); }, [loadEmployees]);
  },
}));
jest.mock("../../utils/employeeAccountAlert", () => ({
  showEmployeeCredentialsAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../components/employee/EmployeeDocumentsModal", () => ({
  EmployeeDocumentDownloadButtons: () => null,
}));
jest.mock("../../components/employee/EmployeeDocumentManager", () => ({
  __esModule: true,
  default: ({ employee }) => (
    <div data-testid="saved-documents" data-employee-id={employee?.id}>
      Saved documents for {employee?.fullName}
    </div>
  ),
}));
jest.mock("./EmployeeReportsAnalytics", () => () => null);
jest.mock("../../components/UI/modal", () => ({
  __esModule: true,
  default: ({ open, title, children, footer, onClose }) => open ? (
    <section role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button type="button" aria-label={`Close ${title}`} onClick={onClose}>Close</button>
      {children}
      {footer}
    </section>
  ) : null,
}));
jest.mock("../../components/UI/table", () => ({
  __esModule: true,
  default: ({ columns, data }) => (
    <div>{data.map((employee) => (
      <div key={employee.id}>{columns.find((column) => column.key === "actions").render(employee)}</div>
    ))}</div>
  ),
}));
jest.mock("../../page/Admin/create_employee", () => ({
  __esModule: true,
  default: ({ formId, initialValues, onSubmit, additionalFields, submitting }) => (
    <form id={formId} onSubmit={(event) => {
      event.preventDefault();
      onSubmit(initialValues || { fullName: "New Employee", employeeId: "EMP-003" });
    }}>
      {additionalFields}
      <button type="submit" disabled={submitting}>Save employee form</button>
    </form>
  ),
}));

const firstEmployee = {
  id: 42,
  employeeId: "EMP-001",
  fullName: "Ana Reyes",
  email: "ana@example.test",
  status: "Active",
};
const secondEmployee = {
  id: 43,
  employeeId: "EMP-002",
  fullName: "Ben Santos",
  email: "ben@example.test",
  status: "Active",
};

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  getEmployees.mockResolvedValue({ employees: [firstEmployee, secondEmployee] });
  getArchivedEmployees.mockResolvedValue({ employees: [] });
  getEmployeeOptions.mockResolvedValue({});
  getUsers.mockResolvedValue({ users: [], roles: [] });
  getArchivedUsers.mockResolvedValue({ users: [] });
  updateEmployee.mockResolvedValue({ employee: firstEmployee });
  createEmployee.mockResolvedValue({ employee: { id: 44, fullName: "New Employee" } });
  uploadEmployeeDocument.mockResolvedValue({ success: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderWorkspace(role = "hrstaff") {
  await act(async () => {
    root.render(<EmployeeManagementWorkspace user={{ role }} />);
  });
}

async function clickButton(label, within = container) {
  const button = Array.from(within.querySelectorAll("button")).find((item) => (
    item.getAttribute("aria-label") === label || item.textContent === label
  ));
  expect(button).toBeDefined();
  await act(async () => { button.click(); });
}

async function queueFiles(documentType, files) {
  await clickButton(`Upload ${documentType}`);
  const input = container.querySelector('[aria-label="Employee document files"]');
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

test.each(["admin", "hrhead", "hrstaff"])("%s can open Edit with saved documents and replacement upload controls", async (role) => {
  await renderWorkspace(role);
  await clickButton("Edit Ana Reyes");

  const dialog = container.querySelector('[role="dialog"][aria-label="Edit Employee"]');
  expect(dialog).not.toBeNull();
  expect(dialog.querySelector('[data-testid="saved-documents"]').getAttribute("data-employee-id")).toBe("42");
  expect(dialog.textContent).toContain("Saved documents for Ana Reyes");
  expect(dialog.querySelector('[aria-label="Upload Birth Certificate"]')).not.toBeNull();
  expect(dialog.querySelector('[aria-label="Upload Valid IDs"]')).not.toBeNull();
  expect(dialog.querySelector('[aria-label="Upload Diploma"]')).not.toBeNull();
});

test("saving an existing employee uploads queued replacements to the saved employee record", async () => {
  const replacement = new File(["correct ID"], "correct-id.pdf", { type: "application/pdf" });
  await renderWorkspace();
  await clickButton("Edit Ana Reyes");
  await queueFiles("Valid IDs", [replacement]);
  await clickButton("Save employee form");

  expect(updateEmployee).toHaveBeenCalledWith(42, expect.objectContaining({ fullName: "Ana Reyes", sendActivationEmail: false }));
  expect(createEmployee).not.toHaveBeenCalled();
  expect(uploadEmployeeDocument).toHaveBeenCalledTimes(1);
  expect(uploadEmployeeDocument).toHaveBeenCalledWith(42, "valid_id", replacement);
  expect(container.querySelector('[aria-label="Edit Employee"]')).toBeNull();
  expect(toast.success).toHaveBeenCalledWith("Employee edited successfully.");
});

test("a partial replacement upload failure retains only failed files and retries them without saving the employee again", async () => {
  const first = new File(["correct birth record"], "birth.pdf", { type: "application/pdf" });
  const second = new File(["correct diploma"], "diploma.pdf", { type: "application/pdf" });
  uploadEmployeeDocument.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error("offline"));
  await renderWorkspace();
  await clickButton("Edit Ana Reyes");
  await queueFiles("Birth Certificate", [first]);
  await queueFiles("Diploma", [second]);
  await clickButton("Save employee form");

  const retryDialog = container.querySelector('[role="dialog"][aria-label="Finish Document Uploads"]');
  expect(retryDialog).not.toBeNull();
  expect(retryDialog.textContent).toContain("diploma.pdf");
  expect(retryDialog.textContent).not.toContain("birth.pdf");
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("1 document upload failed"));

  await clickButton("Retry Uploads", retryDialog);
  expect(updateEmployee).toHaveBeenCalledTimes(1);
  expect(uploadEmployeeDocument).toHaveBeenCalledTimes(3);
  expect(uploadEmployeeDocument).toHaveBeenNthCalledWith(1, 42, "birth_certificate", first);
  expect(uploadEmployeeDocument).toHaveBeenNthCalledWith(2, 42, "diploma", second);
  expect(uploadEmployeeDocument).toHaveBeenNthCalledWith(3, 42, "diploma", second);
  expect(container.querySelector('[aria-label="Finish Document Uploads"]')).toBeNull();
});

test("opening a different employee clears queued files and selects that employee's saved documents", async () => {
  const replacement = new File(["ID"], "ana-id.pdf", { type: "application/pdf" });
  await renderWorkspace();
  await clickButton("Edit Ana Reyes");
  await queueFiles("Valid IDs", [replacement]);
  expect(container.textContent).toContain("ana-id.pdf");
  await clickButton("Edit Ben Santos");

  const dialog = container.querySelector('[role="dialog"][aria-label="Edit Employee"]');
  expect(dialog.querySelector('[data-testid="saved-documents"]').getAttribute("data-employee-id")).toBe("43");
  expect(dialog.textContent).not.toContain("ana-id.pdf");
});

test("creating an employee keeps upload controls and does not display a saved document manager", async () => {
  const diploma = new File(["diploma"], "new-diploma.pdf", { type: "application/pdf" });
  await renderWorkspace();
  await clickButton("Add Employee");

  const dialog = container.querySelector('[role="dialog"][aria-label="Add New Employee"]');
  expect(dialog.querySelector('[data-testid="saved-documents"]')).toBeNull();
  expect(dialog.querySelector('[aria-label="Upload Diploma"]')).not.toBeNull();
  await queueFiles("Diploma", [diploma]);
  await clickButton("Save employee form");

  expect(createEmployee).toHaveBeenCalledWith(expect.objectContaining({ fullName: "New Employee", sendActivationEmail: true }));
  expect(updateEmployee).not.toHaveBeenCalled();
  expect(uploadEmployeeDocument).toHaveBeenCalledWith(44, "diploma", diploma);
});
