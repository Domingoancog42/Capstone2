import React, { act } from "react";
import { createRoot } from "react-dom/client";
import FileLoan from "./fileloan";
import { fetchLoanRequests, fetchLoanRequestById, updateLoanRequest } from "../../services/loanService";

jest.mock("../../components/auto/autorefreshdatalist", () => ({ useAutoRefreshOnChange: jest.fn() }));
jest.mock("sweetalert2", () => ({ __esModule: true, default: { fire: jest.fn() } }));
jest.mock("../../services/api", () => ({ getEmployees: jest.fn() }));
jest.mock("../../services/loanService", () => ({
  fetchLoanRequests: jest.fn(), fetchLoanRequestById: jest.fn(), updateLoanRequest: jest.fn(),
  archiveLoanRequest: jest.fn(), createLoanRequest: jest.fn(), disburseLoanRequest: jest.fn(),
  recordLoanPayment: jest.fn(), updateLoanStatus: jest.fn(),
}));

const record = {
  id: 1, employeeRecordId: 1, employeeId: "TEST-1", employeeName: "Alex Tester", employmentStatus: "Regular",
  loanType: "MGB COOP LOAN", loanAmount: 2400, repaymentTerms: "12 months", annualInterestRate: 12,
  dateFiled: "2026-10-01", status: "Pending", paidAmount: 0, payments: [],
};
const employees = [{ id: 1, fullName: "Alex Tester", employeeId: "TEST-1", employmentStatus: "Regular", status: "Active" }];
/* eslint-disable testing-library/no-unnecessary-act */
let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  fetchLoanRequests.mockResolvedValue({ records: [record], loanTypeDefinitions: [{ id: 1, typeName: "MGB COOP LOAN", categoryCode: "other" }] });
  fetchLoanRequestById.mockResolvedValue({ record });
  updateLoanRequest.mockResolvedValue({ record });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function mount() {
  await act(async () => root.render(<FileLoan user={{ roleKey: "admin" }} employees={employees} />));
}
async function rowAction(label) {
  await act(async () => container.querySelector('button[aria-haspopup="true"]').click());
  await act(async () => document.querySelector(`button[aria-label="${label}"]`).click());
}

test("editing a loan omits reference and method fields and saves the remaining fields", async () => {
  await mount();
  await rowAction("Edit employee loan");
  const form = container.querySelector("#loan-application-form");
  expect(form).not.toBeNull();
  expect(form.textContent).not.toContain("Reference Number");
  expect(form.textContent).not.toContain("Interest Method");
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(updateLoanRequest).toHaveBeenCalledWith(1, expect.objectContaining({ loanAmount: 2400, annualInterestRate: 12, repaymentTerms: "12 months" }));
  const payload = updateLoanRequest.mock.calls[0][1];
  expect(payload).not.toHaveProperty("interestMethod");
  expect(payload).not.toHaveProperty("governmentReferenceNumber");
});

test("loan details and the repayment schedule work without the removed fields", async () => {
  await mount();
  await rowAction("View loan details");
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain("Amortization Schedule");
  expect(dialog.textContent).not.toContain("Reference:");
  expect(dialog.textContent).toMatch(/224\.00/);
  expect(dialog.textContent).toMatch(/2,688\.00/);
});
