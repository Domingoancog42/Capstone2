/* eslint-disable testing-library/no-unnecessary-act -- Matches the repo's native React createRoot tests. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PayrollRegistryDetailsView from "./PayrollRegistryDetailsView";
import { canEditPayrollRecordForRole, canEditRegistryDeductionCell, PayrollRegistryDetailsModal, registryRecordAmounts } from "./PayrollManagementWorkspace";

jest.mock("html2canvas", () => jest.fn());
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));

const employee = {
  id: 29, employeeId: "0005", employeeName: "Anshawer D. Bara-acal",
  lastName: "Bara-acal", firstName: "Anshawer", middleName: "D.",
  division: "Mine Safety, Environment and Social Development Division", employmentType: "Regular",
  payrollType: "Salary", status: "Paid", basicSalary: 33000, periodBasicSalary: 16500,
  grossPay: 18500, totalAllowance: 2000, pera: 2000, totalDeduction: 4156.93, netPay: 14343.07,
  allowanceItems: [{ name: "PERA", amount: 2000 }],
  deductionItems: [{ name: "PHIC", amount: 412.5 }, { name: "GSIS", amount: 3744.43 }],
};
const otherEmployee = {
  ...employee, id: 30, employeeId: "0006", employeeName: "Jane Doe", firstName: "Jane", lastName: "Doe",
  division: "Finance Division", employmentType: "Contract of Service", status: "Draft",
};
const entry = {
  registryId: "PR-0029", payrollType: "Salary", status: "Paid",
  periodLabel: "1st Half (2026-10-01 to 2026-10-15)", division: employee.division,
  dateCreated: "2026-10-15", records: [employee],
};
const totals = { totalGrossPay: 18500, totalDeductions: 4156.93, totalNetPay: 14343.07 };
const viewProps = { entry, records: [employee, otherEmployee], totals, onClose: jest.fn() };
let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = async (component) => act(async () => root.render(component));
const button = (label) => [...container.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === label || element.textContent === label);
const click = async (element) => {
  expect(element).toBeTruthy();
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const change = async (label, value) => {
  const element = container.querySelector(`[aria-label="${label}"]`);
  expect(element).toBeTruthy();
  const prototype = element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};
const table = () => container.querySelector('table[aria-label="Payroll employees"]');
const panel = () => container.querySelector("aside.pr-breakdown");

test("combines search, division, employment and status filters and clears them", async () => {
  await render(<PayrollRegistryDetailsView {...viewProps} />);
  expect(table().querySelectorAll("tbody tr")).toHaveLength(2);
  await change("Filter by division", "Finance Division");
  await change("Filter by employment type", "Contract of Service");
  await change("Filter by status", "Draft");
  await change("Search employee name or ID", "0006");
  expect(table().querySelectorAll("tbody tr")).toHaveLength(1);
  expect(table().textContent).toContain("Jane Doe");
  await change("Search employee name or ID", "missing employee");
  expect(table().textContent).toContain("No employees match your filters.");
  await click(button("Clear Filters"));
  expect(table().querySelectorAll("tbody tr")).toHaveLength(2);
});

test("opens the selected employee, follows refreshed totals, and restores focus when closed", async () => {
  await render(<PayrollRegistryDetailsView {...viewProps} />);
  const viewButton = button("View breakdown for Anshawer D. Bara-acal");
  await click(viewButton);
  expect(panel().textContent).toContain("Employee No. 0005");
  expect(panel().textContent).toContain("14,343.07");
  await render(<PayrollRegistryDetailsView {...viewProps} records={[{ ...employee, netPay: 14000 }, otherEmployee]} />);
  expect(panel().textContent).toContain("14,000.00");
  await act(async () => panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(viewButton);
});

test("pages employees and returns to the first page when filters change", async () => {
  const records = Array.from({ length: 12 }, (_, index) => ({ ...employee, id: index + 1, employeeId: `EMP-${index + 1}`, employeeName: `Employee ${index + 1}` }));
  await render(<PayrollRegistryDetailsView {...viewProps} records={records} />);
  expect(table().querySelectorAll("tbody tr")).toHaveLength(10);
  await click(button("Next page"));
  expect(table().querySelectorAll("tbody tr")).toHaveLength(2);
  expect(container.querySelector('[role="status"]').textContent).toBe("Showing 11 to 12 of 12 employees");
  await change("Search employee name or ID", "Employee 1");
  expect(container.querySelector('[aria-label="Page 1 of 1"]')).toBeTruthy();
  expect(table().querySelectorAll("tbody tr")).toHaveLength(4);
});

test("Salary Details shows earned salary and keeps protected amounts read-only", async () => {
  await render(<PayrollRegistryDetailsModal entry={entry} deductionColumns={[{ name: "PHIC" }, { name: "GSIS Premium" }]} />);
  await click(button("View breakdown for Bara-acal, Anshawer D."));
  const earnings = panel().querySelector('[aria-label="Earnings"]');
  expect(earnings.textContent).toContain("16,500.00");
  expect(earnings.textContent).not.toContain("33,000.00");
  expect(earnings.textContent).toContain("18,500.00");
  expect(panel().querySelector('button[title="Edit PHIC"]')).toBeNull();
  expect(panel().querySelector('input[aria-label="PHIC for Anshawer D. Bara-acal"]')).toBeNull();
  expect(button("Export Payroll")).toBeUndefined();
  expect(button("Create Payroll")).toBeUndefined();
  expect(button("Archive")).toBeUndefined();
  expect(button("Print Payroll")).toBeUndefined();
});

test("editable deductions save through the existing update callback and refresh totals", async () => {
  const onUpdateRecord = jest.fn(async (record) => record);
  const draft = { ...employee, status: "Draft" };
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, status: "Draft", records: [draft] }} canEditRecord={() => true} deductionColumns={[{ name: "PHIC" }, { name: "GSIS Premium" }]} onUpdateRecord={onUpdateRecord} />);
  await click(button("View breakdown for Bara-acal, Anshawer D."));
  const amount = panel().querySelector('input[aria-label="PHIC for Anshawer D. Bara-acal"]');
  expect(amount.value).toBe("412.5");
  await click(button("Edit PHIC deduction"));
  expect(document.activeElement).toBe(amount);
  await change("PHIC for Anshawer D. Bara-acal", "500");
  await act(async () => amount.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(onUpdateRecord).toHaveBeenCalledTimes(1);
  const saved = onUpdateRecord.mock.calls[0][0];
  expect(saved.phic).toBe(500);
  expect(saved.totalDeduction).toBe(4244.43);
  expect(saved.netPay).toBe(14255.57);
  expect(panel().querySelector('[aria-label="Employee payroll summary"]').textContent).toContain("14,255.57");
});

test("a stored deduction remains editable and saves when its amount is set to zero", async () => {
  const onUpdateRecord = jest.fn(async (record) => record);
  const draft = { ...employee, status: "Draft" };
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, status: "Draft", records: [draft] }} canEditRecord={() => true} deductionColumns={[{ name: "GSIS Premium" }]} onUpdateRecord={onUpdateRecord} />);
  await click(button("View breakdown for Bara-acal, Anshawer D."));
  await change("PHIC for Anshawer D. Bara-acal", "0");
  const amount = panel().querySelector('input[aria-label="PHIC for Anshawer D. Bara-acal"]');
  expect(amount).toBeTruthy();
  await act(async () => amount.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(onUpdateRecord).toHaveBeenCalledTimes(1);
  expect(onUpdateRecord.mock.calls[0][0].phic).toBe(0);
  expect(panel().querySelector('input[aria-label="PHIC for Anshawer D. Bara-acal"]').value).toBe("0");
});

test("admin edit permissions match the API's permitted payroll stages", () => {
  ["Draft", "Rejected", "Pending Approval"].forEach((status) => {
    expect(canEditPayrollRecordForRole("admin", { status })).toBe(true);
  });
  ["Pending Chief", "Pending Director", "Approved", "Paid", "Archived"].forEach((status) => {
    expect(canEditPayrollRecordForRole("admin", { status })).toBe(false);
  });
  expect(canEditPayrollRecordForRole("hrstaff", { status: "Draft" })).toBe(true);
  expect(canEditPayrollRecordForRole("hrstaff", { status: "Pending Approval" })).toBe(false);
  expect(canEditPayrollRecordForRole("hrhead", { status: "Pending Approval" })).toBe(true);
  expect(canEditPayrollRecordForRole("chief", { status: "Pending Chief" })).toBe(false);
});

test("contractual automatic deductions are read-only while the other six deductions stay editable", async () => {
  const record = {
    ...otherEmployee, status: "Draft", hasAttendanceCoverage: false, lateDeduction: 100, undertimeDeduction: 50,
    deductionItems: [
      { name: "Late Deduction", amount: 100 }, { name: "Undertime Deduction", amount: 50 },
      { name: "Withholding Tax", amount: 200 }, { name: "PHIC", amount: 300 }, { name: "HDMF", amount: 100 },
    ],
  };
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, status: "Draft", records: [record] }} canEditRecord={() => true} />);
  await click(button("View breakdown for Doe, Jane D."));
  const rows = [...panel().querySelector('[aria-label="Deductions"]').querySelectorAll(".pr-breakdown-row")];
  ["Tardy/ Undertime", "Pag-IBIG", "TAX", "PhilHealth"].forEach((label) => {
    const row = rows.find((item) => item.querySelector("dt").textContent === label);
    expect(row).toBeTruthy();
    expect(row.querySelector("input")).toBeNull();
    expect(row.querySelector("button")).toBeNull();
    expect(row.querySelector("dd").textContent).toMatch(/\d+\.\d{2}/);
  });
  ["Deduction from Previous Payroll", "Pass Slip", "PhilHealth Differential", "Modified Pag-IBIG II (MP2)", "Pag-IBIG MPL", "MGB Coop Loan"].forEach((label) => {
    const row = rows.find((item) => item.querySelector("dt").textContent === label);
    expect(row.querySelector("input")).toBeTruthy();
    expect(row.querySelector("button")).toBeTruthy();
  });
});

test.each([true, false])("regular automatic deductions are read-only with catalog rows: %s", async (withCatalog) => {
  const lockedLabels = ["Withholding Tax", "GSIS Premium", "HDMF", "Late Deduction", "Absence Deduction", "Undertime Deduction"];
  const record = {
    ...employee, status: "Draft", hasAttendanceCoverage: true,
    deductionItems: lockedLabels.map((name) => ({ name, amount: 100 })).concat([{ name: "PHIC", amount: 200 }, { name: "GSIS Policy Loan", amount: 50 }]),
  };
  const deductionColumns = withCatalog ? [...lockedLabels, "PHIC", "GSIS Policy Loan"].map((name) => ({ name })) : [];
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, status: "Draft", records: [record] }} canEditRecord={() => true} deductionColumns={deductionColumns} />);
  await click(button("View breakdown for Bara-acal, Anshawer D."));
  const rows = [...panel().querySelector('[aria-label="Deductions"]').querySelectorAll(".pr-breakdown-row")];
  lockedLabels.forEach((label) => {
    const row = rows.find((item) => item.querySelector("dt").textContent === label);
    expect(row).toBeTruthy();
    expect(row.querySelector("input")).toBeNull();
    expect(row.querySelector("button")).toBeNull();
  });
  ["PHIC", "GSIS Policy Loan"].forEach((label) => {
    const row = rows.find((item) => item.querySelector("dt").textContent === label);
    expect(row.querySelector("input")).toBeTruthy();
  });
});

test("deduction aliases and the regular Pass Slip cell cannot bypass the read-only rules", () => {
  ["GSIS", "GSIS Premium", "Pag-IBIG Premium", "HDMF", "TAX", "W-TAX"].forEach((label) => {
    expect(canEditRegistryDeductionCell(employee, { label })).toBe(false);
  });
  expect(canEditRegistryDeductionCell({ ...employee, hasAttendanceCoverage: false }, { label: "Pass Slip", contractualDeductionKey: "passSlip" })).toBe(false);
  ["Withholding Tax", "PHIC", "PhilHealth Premium", "HDMF"].forEach((label) => {
    expect(canEditRegistryDeductionCell(otherEmployee, { label })).toBe(false);
  });
  expect(canEditRegistryDeductionCell(otherEmployee, { label: "PhilHealth Differential" })).toBe(true);
  expect(canEditRegistryDeductionCell(employee, { label: "GSIS Policy Loan" })).toBe(true);
});

test("contractual breakdown includes attendance and loan aliases once", async () => {
  const record = {
    ...otherEmployee, lateDeduction: 100, undertimeDeduction: 50, hasAttendanceCoverage: false,
    totalDeduction: 1050, netPay: 17450,
    deductionItems: [
      { name: "Late Deduction", amount: 100 }, { name: "Undertime Deduction", amount: 50 },
      { name: "MP2", amount: 200 }, { name: "MGB Cooperative Loan", amount: 300 },
      { name: "PHIC", amount: 400 },
    ],
  };
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, records: [record] }} />);
  await click(button("View breakdown for Doe, Jane D."));
  const deductions = panel().querySelector('[aria-label="Deductions"]');
  const rows = [...deductions.querySelectorAll(".pr-breakdown-row")];
  const labels = rows.map((row) => row.querySelector("dt").textContent);
  expect(labels).not.toContain("Late Deduction");
  expect(labels).not.toContain("Undertime Deduction");
  expect(labels).not.toContain("MP2");
  expect(labels).not.toContain("MGB Cooperative Loan");
  const sum = rows.reduce((total, row) => total + Number(row.querySelector("dd").textContent.replace(/[^0-9.]/g, "")), 0);
  expect(sum).toBe(1050);
});

test("contractual deductions and totals follow the original register, excluding regular catalog rows", async () => {
  const record = {
    ...otherEmployee, status: "Paid", periodBasicSalary: 11250, totalAllowance: 2000,
    grossPay: 13250, totalDeduction: 2892.38, netPay: 10357.62,
    lateDeduction: 225.85, undertimeDeduction: 0, hasAttendanceCoverage: true,
    deductionItems: [
      { name: "Late Deduction", amount: 225.85 }, { name: "Withholding Tax", amount: 250.05 },
      { name: "PHIC", amount: 281.25 }, { name: "HDMF", amount: 100 },
      { name: "Other Deductions", amount: 2035.23 }, { name: "GSIS", amount: 0 },
    ],
  };
  expect(registryRecordAmounts(record)).toEqual({
    grossPay: 13024.15, totalDeduction: 2666.53, netPay: 10357.62, totalEarnings: 13250,
  });
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, records: [record] }} deductionColumns={[{ name: "GSIS Premium" }, { name: "Laptop Loan" }]} />);
  await click(button("View breakdown for Doe, Jane D."));
  const deductions = panel().querySelector('[aria-label="Deductions"]');
  const rows = [...deductions.querySelectorAll(".pr-breakdown-row")];
  expect(rows.map((row) => row.querySelector("dt").textContent)).toEqual([
    "Deduction from Previous Payroll", "Tardy/ Undertime", "Pass Slip", "TAX", "PhilHealth",
    "PhilHealth Differential", "Pag-IBIG", "Modified Pag-IBIG II (MP2)", "Pag-IBIG MPL", "MGB Coop Loan",
  ]);
  expect(deductions.querySelectorAll('[data-deduction-group="beforeGross"]')).toHaveLength(3);
  expect(deductions.querySelectorAll('[data-deduction-group="afterGross"]')).toHaveLength(7);
  expect(deductions.querySelector(".pr-breakdown-gross").textContent).toContain("13,024.15");
  expect(deductions.querySelector(".pr-breakdown-total").textContent).toContain("2,666.53");
  expect(panel().querySelector('[aria-label="Earnings"] .pr-breakdown-total').textContent).toContain("13,250.00");
  const summary = panel().querySelector('[aria-label="Employee payroll summary"]');
  expect(summary.textContent).toContain("13,024.15");
  expect(summary.textContent).toContain("2,666.53");
  expect(table().textContent).toContain("13,024.15");
  expect(table().textContent).toContain("2,666.53");
  expect(container.querySelector('[aria-label="Payroll summary"]').textContent).toContain("13,024.15");
});

test.each([
  ["Deduction from Previous Payroll", "DEDUCTION PREVIOUS PAYROLL"],
  ["Modified Pag-IBIG II (MP2)", "MP2"],
  ["MGB Coop Loan", "MGB Cooperative Loan"],
])("editing contractual %s updates the existing alias without duplicating deductions", async (label, alias) => {
  const onUpdateRecord = jest.fn(async (record) => record);
  const record = {
    ...otherEmployee, status: "Draft", lateDeduction: 0, undertimeDeduction: 0,
    totalDeduction: 200, netPay: 18300, deductionItems: [{ name: alias, amount: 200 }],
  };
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, status: "Draft", records: [record] }} canEditRecord={() => true} onUpdateRecord={onUpdateRecord} />);
  await click(button("View breakdown for Doe, Jane D."));
  await click(button(`Edit ${label} deduction`));
  await change(`${label} for Jane Doe`, "275");
  const amount = panel().querySelector(`input[aria-label="${label} for Jane Doe"]`);
  await act(async () => amount.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(onUpdateRecord).toHaveBeenCalledTimes(1);
  const saved = onUpdateRecord.mock.calls[0][0];
  expect(saved.deductionItems).toHaveLength(1);
  expect(saved.deductionItems[0]).toMatchObject({ name: alias, amount: 275 });
  expect(saved.totalDeduction).toBe(275);
  expect(saved.netPay).toBe(18225);
  expect(panel().querySelector(`input[aria-label="${label} for Jane Doe"]`).value).toBe("275");
});

test("registry export stays gated to approved or paid batches", async () => {
  const onExport = jest.fn();
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, status: "Draft" }} canExport onExport={onExport} />);
  expect(button("Export Payroll")).toBeUndefined();
  await render(<PayrollRegistryDetailsModal entry={entry} canExport onExport={onExport} />);
  await click(button("Export Payroll"));
  expect(onExport).toHaveBeenCalledWith(entry);
});

test("pass slip covers a stored undertime deduction outside the active catalog", async () => {
  const record = {
    ...employee, undertimeDeduction: 200, hasAttendanceCoverage: false,
    totalDeduction: 4356.93, netPay: 14143.07,
    deductionItems: [...employee.deductionItems, { name: "Undertime Deduction", amount: 200 }],
  };
  await render(<PayrollRegistryDetailsModal entry={{ ...entry, records: [record] }} deductionColumns={[{ name: "PHIC" }]} />);
  await click(button("View breakdown for Bara-acal, Anshawer D."));
  const rows = [...panel().querySelector('[aria-label="Deductions"]').querySelectorAll(".pr-breakdown-row")];
  const labels = rows.map((row) => row.querySelector("dt").textContent);
  expect(labels).toContain("Pass Slip");
  expect(labels).not.toContain("Undertime Deduction");
  const sum = rows.reduce((total, row) => total + Number(row.querySelector("dd").textContent.replace(/[^0-9.]/g, "")), 0);
  expect(sum).toBe(4356.93);
});
