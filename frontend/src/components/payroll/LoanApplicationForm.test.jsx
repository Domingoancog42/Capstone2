import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LoanApplicationForm from "./LoanApplicationForm";
import useFilingSignatories from "../../hooks/useFilingSignatories";
import { getEmployeeSignature } from "../../services/api";

jest.mock("../../hooks/useFilingSignatories", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/api", () => ({
  getCurrentEmployeeSignature: jest.fn(),
  getEmployeeSignature: jest.fn(),
}));
jest.mock("../../services/loanService", () => ({
  fetchLoanRequestById: jest.fn(),
  LOAN_TYPES: ["Salary Loan"],
}));

const record = {
  employeeRecordId: 17,
  employeeName: "Alex Applicant",
  dateFiled: "2026-10-01",
  createdAt: "2026-10-01 09:00:00",
  reviewedBy: "Harper Reviewer",
  reviewedAt: "2026-10-02 10:00:00",
  approvedBy: "Devon Director",
  approvedAt: "2026-10-03 11:00:00",
  status: "Approved",
  loanType: "Salary Loan",
  loanAmount: 12000,
  repaymentTerms: "12 months",
};

let container;
let root;
const printButton = () => Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Print Form");
const timestampNodes = (prefix) => Array.from(container.querySelectorAll("div")).filter((node) => node.children.length === 0 && node.textContent.startsWith(prefix));
// These tests use a React DOM root directly.
// eslint-disable-next-line testing-library/no-unnecessary-act
const mount = () => act(async () => root.render(<LoanApplicationForm open record={record} />));

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  getEmployeeSignature.mockResolvedValue({ employee: { signatureDataUrl: "data:image/png;base64,applicant-ink" } });
  useFilingSignatories.mockReturnValue({ showESignatures: true, showTimestamps: true, loading: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test.each([
  [true, true],
  [true, false],
  [false, true],
  [false, false],
])("loan form honors e-signatures=%s and timestamps=%s independently", async (showESignatures, showTimestamps) => {
  useFilingSignatories.mockReturnValue({ showESignatures, showTimestamps, loading: false });
  await mount();

  expect(getEmployeeSignature).toHaveBeenCalledWith(17);
  expect(container.querySelectorAll('img[alt="Alex Applicant signature"]')).toHaveLength(showESignatures ? 1 : 0);
  expect(timestampNodes("Date: ")).toHaveLength(showTimestamps ? 2 : 0);
  expect(timestampNodes("Filed: ")).toHaveLength(showTimestamps && !showESignatures ? 1 : 0);
  ["Alex Applicant", "Harper Reviewer", "Devon Director", "OIC, Regional Director"].forEach((name) => {
    expect(container.textContent).toContain(name);
  });
});

test("loan print waits for the policy and uses the form without disabled signatory details", async () => {
  useFilingSignatories.mockReturnValue({ showESignatures: false, showTimestamps: false, loading: true });
  await mount();
  expect(printButton().disabled).toBe(true);

  useFilingSignatories.mockReturnValue({ showESignatures: false, showTimestamps: false, loading: false });
  await mount();
  expect(printButton().disabled).toBe(false);
  const printWindow = {
    document: { write: jest.fn(), close: jest.fn(), querySelector: jest.fn(), images: [] },
    focus: jest.fn(), print: jest.fn(), addEventListener: jest.fn(), close: jest.fn(),
  };
  const openWindow = jest.spyOn(window, "open").mockReturnValue(printWindow);
  act(() => printButton().click());
  const printedHtml = printWindow.document.write.mock.calls[0][0];
  expect(printedHtml).toContain("Harper Reviewer");
  expect(printedHtml).toContain("Devon Director");
  expect(printedHtml).not.toContain("applicant-ink");
  expect(printedHtml).not.toContain("Filed:");
  expect(printedHtml).not.toContain("Date:");
  openWindow.mockRestore();
});
