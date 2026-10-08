import { readFileSync } from "fs";
import { resolve } from "path";
import { buildReportPdf } from "./reportPdf";

test("exports every report row across pages with letterhead, table headings and print column rules", async () => {
  const report = {
    label: "Employee List",
    appliedFilters: [{ key: "divisionId", label: "Division", value: "Geosciences" }],
    columns: [
      { key: "employeeId", label: "Employee ID" },
      { key: "name", label: "Employee Name" },
      { key: "employmentStatus", label: "Employment Status" },
      { key: "status", label: "Status" },
    ],
    rows: Array.from({ length: 205 }, (_, index) => ({
      employeeId: String(index + 1).padStart(4, "0"),
      name: `Employee ${index + 1}`, employmentStatus: "Regular", status: "Hidden Status",
    })),
  };
  const pdf = await buildReportPdf(report, {
    logo: new Uint8Array(readFileSync(resolve("public/mgb.png"))),
    generatedAt: new Date("2026-10-09T03:40:00"), pageTitle: "HRIS", pageUrl: "localhost/reports",
  });
  const content = pdf.output();
  expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
  expect(content).toContain("MINES AND GEOSCIENCES BUREAU - 10");
  expect(content).toContain("EMPLOYEE LIST");
  expect(content).toContain("Division: Geosciences");
  expect(content).toContain("0205");
  expect(content).toContain("Regular");
  expect(content).not.toContain("Hidden Status");
  expect(content.match(/EMPLOYEE ID/g).length).toBe(pdf.getNumberOfPages());
});

test("Payroll Deductions fits all employee rows and deduction columns on one landscape page", async () => {
  const roster = readFileSync(resolve("backend/api/report-payroll-deductions.php"), "utf8");
  const columns = [{ key: "employeeId", label: "Employee ID" }, { key: "employeeName", label: "Employee Name" },
    { key: "payrollId", label: "Payroll ID" }, { key: "payrollDate", label: "Payroll Date" }, ...Array.from(
    roster.matchAll(/^    \['([^']+)', '([^']+)'/gm),
    (match) => ({ key: `amount_${match[1]}`, label: match[2] })
  )];
  const row = Object.fromEntries(columns.map((column, index) => [column.key, index]));
  const rows = Array.from({ length: 80 }, (_, index) => ({ ...row, employeeId: `EMP${index + 1}`, employeeName: `Employee ${index + 1}`, payrollId: `PR-${index + 1}`, payrollDate: "2026-10-15" }));
  const pdf = await buildReportPdf({ key: "payroll-deductions", label: "Payroll Deductions", columns, rows }, {
    logo: new Uint8Array(readFileSync(resolve("public/mgb.png"))), pageTitle: "HRIS", pageUrl: "localhost/reports",
  });
  expect(pdf.internal.pageSize.getWidth()).toBeGreaterThan(pdf.internal.pageSize.getHeight());
  expect(columns).toHaveLength(45);
  expect(pdf.getNumberOfPages()).toBe(1);
  expect(pdf.output()).toContain("EMP80");
  expect(pdf.output()).toContain("(44.00)");
});
