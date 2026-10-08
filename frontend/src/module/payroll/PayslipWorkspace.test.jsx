/* eslint-disable testing-library/no-unnecessary-act -- React createRoot and native clicks require act here. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PayslipWorkspace from "./PayslipWorkspace";
import { fetchPayslipData, fetchPayslipPeriods, fetchPayslipRecord, setPayslipsArchived } from "../../services/payslipService";

jest.mock("../../services/payslipService", () => ({
  fetchPayslipData: jest.fn(), fetchPayslipPeriods: jest.fn(),
  fetchPayslipRecord: jest.fn(), setPayslipsArchived: jest.fn(),
}));
jest.mock("../../hooks/useFilterOptions", () => ({
  useOrganizationFilterOptions: () => ({ divisions: [], employmentStatuses: [] }),
}));
jest.mock("../../components/auto/autorefreshdatalist", () => ({ useAutoRefreshOnChange: () => {} }));
jest.mock("html2canvas", () => jest.fn());
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));

test("first-half Payslip Details shows earned basic salary instead of the monthly rate", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const employee = {
    id: 1, employeeId: "EMP-1", fullName: "First Half Employee", employmentStatus: "Regular",
    paidPayrollId: 29, paidPayrollStatus: "Paid", paidPayrollDate: "2026-10-15",
    payPeriod: "1st Half", basicSalary: 33000, paidBasicSalary: 33000,
    paidGrossPay: 18500, paidTotalAllowance: 2000, paidTotalDeduction: 500, paidNetPay: 18000,
    allowanceItems: [{ name: "PERA", amount: 2000 }],
  };
  fetchPayslipPeriods.mockResolvedValue({ currentMonth: "2026-10", periods: [{ month: "2026-10", paidCount: 1 }] });
  fetchPayslipData.mockResolvedValue({ canArchive: true, employees: [employee] });
  fetchPayslipRecord.mockResolvedValue({ employees: [employee] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<PayslipWorkspace mode="admin" />));
    await act(async () => container.querySelector('button[aria-label="Show actions"]').click());
    await act(async () => document.querySelector('button[aria-label="View payslip"]').click());
    const basicSalaryLabel = [...document.querySelectorAll("span")].find((span) => span.textContent === "Basic Salary");
    expect(basicSalaryLabel).toBeTruthy();
    expect(basicSalaryLabel.parentElement.textContent).toContain("16,500.00");
    expect(basicSalaryLabel.parentElement.textContent).not.toContain("33,000.00");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("selects several payslips, archives them, opens the archive, and restores one", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const archived = new Set();
  const employees = [1, 2].map((id) => ({
    id, employeeId: `EMP-${id}`, paidPayrollId: id, fullName: `Employee ${id}`,
    paidPayrollStatus: "Paid", paidPayrollDate: "2026-10-15", paidGrossPay: 1000, paidNetPay: 900,
  }));
  fetchPayslipPeriods.mockResolvedValue({ currentMonth: "2026-10", periods: [{ month: "2026-10", paidCount: 2, payrollCount: 2, employeeCount: 2 }] });
  fetchPayslipData.mockImplementation(async ({ archived: view }) => ({
    canArchive: true,
    employees: employees.filter((employee) => archived.has(String(employee.paidPayrollId)) === Boolean(view)),
  }));
  setPayslipsArchived.mockImplementation(async (ids, flag) => {
    ids.forEach((id) => flag ? archived.add(id) : archived.delete(id));
    return { success: true };
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const click = async (element) => {
    expect(element).toBeTruthy();
    await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  };
  try {
    await act(async () => root.render(<PayslipWorkspace mode="admin" />));
    await click(container.querySelector('input[aria-label="Select all payslips on this page"]'));
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "Archive Selected (2)"));
    expect(setPayslipsArchived).toHaveBeenCalledWith(["1", "2"], true);
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "Archived Payslips"));
    expect(fetchPayslipData).toHaveBeenLastCalledWith({ month: "2026-10", archived: 1 });
    expect(container.textContent).toContain("Archived Payslip Records");
    await click(container.querySelector('button[aria-label="Show actions"]'));
    await click(document.querySelector('button[aria-label="Restore payslip"]'));
    expect(setPayslipsArchived).toHaveBeenLastCalledWith(["1"], false);
    expect(archived.size).toBe(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
