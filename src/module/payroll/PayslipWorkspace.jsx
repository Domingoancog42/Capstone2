import React, { useCallback, useEffect, useMemo, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Printer,
  Search,
} from "lucide-react";
import { faDownload, faEye, faPrint } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import Modal from "../../components/UI/modal";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { fetchPayslipData } from "../../services/payslipService";

const DEFAULT_PERA_AMOUNT = 2000;
const PAYSLIP_OFFICE = "Mines and Geosciences Bureau, Regional Office No. X";
const PAYSLIP_SIGNATORY_TITLE = "Administrative Officer IV/OIC, Finance Section";
/* The name is filled in from the API, which reads whoever currently holds the HR Head role. */
const DEFAULT_PAYSLIP_SIGNATORY = { name: "", title: PAYSLIP_SIGNATORY_TITLE };
const WORKING_DAYS_PER_MONTH = 22;
const WORKING_HOURS_PER_DAY = 8;
const CONTRACT_SERVICE_EMPLOYMENT_TYPE = "Contract of Service";
const CONTRACT_SERVICE_PREMIUM_RATE = 20;
const CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES = ["Premium", "Premium Pay", "Premium Percentage"];
const CONTRACT_SERVICE_HIDDEN_ALLOWANCE_NAMES = ["PERA", ...CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES];
const CONTRACT_SERVICE_DETAIL_HIDDEN_ALLOWANCE_NAMES = ["PERA"];
const CONTRACT_SERVICE_DEDUCTION_ROWS = [
  { label: "Overpayment", aliases: ["Overpayment", "Deduction from Previous Payroll", "DEDUCTION PREVIOUS PAYROLL"] },
  { label: "Late/UT", aliases: ["Late Deduction", "Tardy/Undertime", "Tardy/ Undertime", "Late/UT"] },
  { label: "Pass Slip", aliases: ["Pass Slip", "Pass Slip Deduction"] },
  { label: "Tax", aliases: ["Withholding Tax", "W-TAX", "Tax"] },
  { label: "PhilHealth", aliases: ["PHIC", "PhilHealth", "PHILHEALTH", "PhilHealth Premium"] },
  { label: "PhilHealth Differential", aliases: ["PhilHealth Differential", "PHILHEALTH DIFFERENTIAL"] },
  { label: "Pag-IBIG", aliases: ["HDMF", "Pag-IBIG", "PAG-IBIG", "PAG-IBIG Premium"] },
  { label: "MP2", aliases: ["MP2", "PAG-IBIG MP2", "Pag-IBIG MP2", "Modified Pag-IBIG II (MP2)"] },
  { label: "Pag-IBIG MPL", aliases: ["PAG-IBIG MPL", "Pag-IBIG MPL"] },
  { label: "MGB Coop Loan", aliases: ["MGB Coop Loan", "MGB COOP LOAN", "MGB Cooperative Loan"] },
];

const PAYSLIP_DEDUCTION_ROWS = [
  { label: "GSIS Premium", aliases: ["GSIS", "GSIS Premium"] },
  { label: "PAG-IBIG Premium", aliases: ["HDMF", "Pag-IBIG", "PAG-IBIG", "PAG-IBIG Premium"] },
  { label: "PAG-IBIG MP2", aliases: ["PAG-IBIG MP2", "Pag-IBIG MP2", "MP2"] },
  { label: "PhilHealth Premium", aliases: ["PHIC", "PhilHealth", "PHILHEALTH", "PhilHealth Premium"] },
  { label: "Deduction from Previous Payroll", aliases: ["Deduction from Previous Payroll", "DEDUCTION PREVIOUS PAYROLL"] },
  { label: "Withholding Tax", aliases: ["Withholding Tax", "W-TAX", "Tax"] },
  { label: "Additional Withholding Tax (PBB 2020)", aliases: ["Additional Withholding Tax (PBB 2020)"] },
  { label: "Leave Without Pay (LWOP)", aliases: ["Leave Without Pay (LWOP)", "LWOP", "Absence Deduction"] },
  { label: "GSIS Consolidated Loan", aliases: ["GSIS CONSO LOAN", "GSIS Consolidated Loan", "Conso Loan"] },
  { label: "GSIS Policy Loan", aliases: ["GSIS POLICY LOAN", "GSIS Policy Loan", "Policy Loan"] },
  { label: "GSIS Emergency Loan", aliases: ["GSIS EMERGENCY LOAN", "GSIS Emergency Loan", "Emergency Loan"] },
  { label: "GSIS UOLI 1", aliases: ["GSIS UOLI (1)", "GSIS UOLI 1", "UOLI 1"] },
  { label: "GSIS UOLI 2", aliases: ["GSIS UOLI (2)", "GSIS UOLI 2", "UOLI 2"] },
  { label: "GSIS UOLI 1 Loan", aliases: ["GSIS UOLI LOAN (1)", "GSIS UOLI 1 Loan", "UOLI Loan 1"] },
  { label: "GSIS UOLI 2 Loan", aliases: ["GSIS UOLI LOAN (2)", "GSIS UOLI 2 Loan", "UOLI Loan 2"] },
  { label: "GSIS Housing Loan", aliases: ["GSIS HOUSING LOAN", "GSIS Housing Loan", "Housing Loan"] },
  { label: "GSIS Educational Loan", aliases: ["GSIS EDUCATIONAL LOAN", "GSIS EDUCATIONAL LOAN", "GSIS Educational Loan", "Educational Loan"] },
  { label: "GSIS GFAL", aliases: ["GSIS GFAL", "GFAL"] },
  { label: "GSIS Computer Loan", aliases: ["GSIS Computer Loan", "Computer Loan"] },
  { label: "GSIS MPL", aliases: ["GSIS MPL", "MPL"] },
  { label: "GSIS MPL Lite", aliases: ["GSIS MPL Lite", "MPL Lite"] },
  { label: "PAG-IBIG Housing Loan", aliases: ["PAG-IBIG HOUSING LOAN", "Pag-IBIG Housing Loan"] },
  { label: "PAG-IBIG MPL", aliases: ["PAG-IBIG MPL", "Pag-IBIG MPL"] },
  { label: "PAG-IBIG Home Equity Appreciation Loan (HEAL)", aliases: ["PAG-IBIG Home Equity Appreciation Loan (HEAL)", "HEAL"] },
  { label: "LBP Loan", aliases: ["LBP Loan", "LBP Salary Loan", "Landbank Salary Loan"] },
  { label: "Disallowance (COLA)", aliases: ["Disallowance (COLA)", "COLA DISALLOWANCE"] },
  { label: "Disallowance (PRAISE)", aliases: ["Disallowance (PRAISE)", "PRAISE DISALLOWANCE"] },
  { label: "Disallowance (Maternity Leave)", aliases: ["Disallowance (Maternity Leave)", "MATERNITY LEAVE DISALLOWANCE"] },
  { label: "ENRP MOWEL", aliases: ["ENRP MOWEL"] },
  { label: "DBP Salary Loan", aliases: ["DBP Salary Loan", "DBP SALARY LOAN"] },
  { label: "UCPB Salary Loan", aliases: ["UCPB Salary Loan", "UCPB SALARY LOAN"] },
  { label: "MGBEA-X", aliases: ["MGBEA-X", "MGBBEA- X", "MG BEA - 10", "MG BEA", "MGBEA"] },
  { label: "Family Support (w/ Court Order)", aliases: ["Family Support (w/ Court Order)", "FAMILY SUPPORT(W/ COURT ORDER)"] },
];

const moneyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseAmount(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

function formatAmount(value) {
  return moneyFormatter.format(parseAmount(value));
}

function formatAttendanceNumber(value) {
  const amount = parseAmount(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function normalizeLineItems(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        name: String(item?.name ?? "").trim(),
        category: String(item?.category ?? "").trim(),
        amount: parseAmount(item?.amount),
      }))
    : [];
}

function parseDateValue(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthName(date, uppercase = false) {
  const value = date.toLocaleString("en-US", { month: "long" });
  return uppercase ? value.toUpperCase() : value;
}

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeEmploymentType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  // "Contractual" and "COS" are the older spellings of the same appointment.
  if (normalized === "contract of service" || normalized === "contractual" || normalized === "cos") {
    return "Contract of Service";
  }

  if (normalized === "regular") {
    return "Regular";
  }

  return "";
}

function normalizeEmployee(employee = {}) {
  const id = String(employee.id ?? employee.employeeRecordId ?? employee.employeeId ?? "").trim();
  const fullName = String(employee.fullName ?? employee.employeeName ?? "").trim();
  const paidPayrollId = String(employee.paidPayrollId ?? "").trim();
  const paidPayrollStatus = String(employee.paidPayrollStatus ?? "").trim();

  return {
    id,
    employeeId: String(employee.employeeId ?? "").trim(),
    fullName,
    department: String(employee.department ?? employee.division ?? "").trim(),
    position: String(employee.position ?? employee.designation ?? "").trim(),
    employmentType: normalizeEmploymentType(employee.employmentStatus ?? employee.employmentType),
    basicSalary: String(employee.basicSalary ?? "").trim(),
    paidBasicSalary: String(employee.paidBasicSalary ?? employee.basicSalary ?? "").trim(),
    salaryRate: String(employee.salaryRate ?? "").trim(),
    payPeriod: String(employee.payPeriod ?? "").trim(),
    startDate: String(employee.startDate ?? "").trim(),
    endDate: String(employee.endDate ?? "").trim(),
    periodLabel: String(employee.periodLabel ?? "").trim(),
    paidPayrollId,
    paidPayrollDate: String(employee.paidPayrollDate ?? "").trim(),
    paidPayrollStatus,
    paidGrossPay: String(employee.paidGrossPay ?? "").trim(),
    paidTotalAllowance: String(employee.paidTotalAllowance ?? "").trim(),
    paidTotalDeduction: String(employee.paidTotalDeduction ?? "").trim(),
    paidNetPay: String(employee.paidNetPay ?? "").trim(),
    overtimeHours: parseAmount(employee.overtimeHours),
    overtimeRate: parseAmount(employee.overtimeRate),
    hourlyRate: parseAmount(employee.hourlyRate),
    passSlipHours: parseAmount(employee.passSlipHours),
    undertimeHours: parseAmount(employee.undertimeHours),
    lateHours: parseAmount(employee.lateHours),
    absenceDays: parseAmount(employee.absenceDays),
    attendanceRenderedMinutes: parseAmount(employee.attendanceRenderedMinutes),
    attendanceLateMinutes: parseAmount(employee.attendanceLateMinutes),
    attendanceUndertimeMinutes: parseAmount(employee.attendanceUndertimeMinutes),
    attendanceExpectedWorkdays: parseAmount(employee.attendanceExpectedWorkdays ?? employee.expectedWorkdays),
    attendanceLeaveDays: parseAmount(employee.attendanceLeaveDays),
    hasAttendanceCoverage: Boolean(employee.hasAttendanceCoverage),
    withholdingTaxBase: parseAmount(employee.withholdingTaxBase),
    overtimePay: parseAmount(employee.overtimePay),
    sss: parseAmount(employee.sss),
    allowanceItems: normalizeLineItems(employee.allowanceItems),
    deductionItems: normalizeLineItems(employee.deductionItems),
    isPaid: paidPayrollId !== "" || paidPayrollStatus.toLowerCase() === "paid",
  };
}

function mergeEmployees(localEmployees, apiEmployees) {
  const employeeMap = new Map();

  [...localEmployees, ...apiEmployees].forEach((employee) => {
    const normalized = normalizeEmployee(employee);
    const key = normalized.id || normalized.employeeId || normalized.fullName;

    if (key) {
      employeeMap.set(key, {
        ...(employeeMap.get(key) || {}),
        ...normalized,
      });
    }
  });

  return Array.from(employeeMap.values()).sort((left, right) =>
    String(left.fullName || "").localeCompare(String(right.fullName || ""))
  );
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getLineItemAmount(items, labels) {
  const keys = new Set(labels.map(normalizeKey));
  return items.reduce((total, item) => (
    keys.has(normalizeKey(item.name)) ? total + parseAmount(item.amount) : total
  ), 0);
}

function getAllowanceAmount(employee, labels) {
  return getLineItemAmount(employee.allowanceItems || [], labels);
}

function getDeductionAmount(employee, labels, fallbackFields = []) {
  const fromItems = getLineItemAmount(employee.deductionItems || [], labels);
  if (fromItems > 0) {
    return fromItems;
  }

  return fallbackFields.reduce((total, field) => total + parseAmount(employee[field]), 0);
}

function formatPayslipPeriod(employee) {
  const start = parseDateValue(employee.startDate);
  const end = parseDateValue(employee.endDate || employee.paidPayrollDate);

  if (start && end) {
    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      if (start.getDate() === end.getDate()) {
        return `For the period ${monthName(start)} ${start.getDate()}, ${end.getFullYear()}`;
      }

      return `For the period ${monthName(start)} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
    }

    return `For the period ${monthName(start)} ${start.getDate()}, ${start.getFullYear()} - ${monthName(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }

  const payrollDate = parseDateValue(employee.paidPayrollDate);
  if (payrollDate) {
    return `For the period ${monthName(payrollDate)} ${payrollDate.getDate()}, ${payrollDate.getFullYear()}`;
  }

  return "For the period";
}

function formatPeriodAmountLabel(start, end) {
  if (!start || !end) {
    return "Payroll period";
  }

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    if (start.getDate() === end.getDate()) {
      return `${monthName(start)} ${start.getDate()}`;
    }

    return `${monthName(start)} ${start.getDate()}-${end.getDate()}`;
  }

  return `${monthName(start)} ${start.getDate()}-${monthName(end)} ${end.getDate()}`;
}

function buildPeriodAmounts(employee, netPay) {
  const start = parseDateValue(employee.startDate);
  const end = parseDateValue(employee.endDate || employee.paidPayrollDate);
  const payPeriod = String(employee.payPeriod || "").toLowerCase();

  if (!start || !end || netPay <= 0) {
    return [];
  }

  if (payPeriod.includes("monthly") && start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const halfAmount = netPay / 2;

    return [
      { label: `${monthName(start)} 1-15`, value: halfAmount },
      { label: `${monthName(start)} 16-${lastDay}`, value: halfAmount },
    ];
  }

  return [{ label: formatPeriodAmountLabel(start, end), value: netPay }];
}

function buildPayslipDeductions(employee = {}) {
  const standardKeys = new Set();
  PAYSLIP_DEDUCTION_ROWS.forEach((row) => {
    row.aliases.forEach((alias) => standardKeys.add(normalizeKey(alias)));
  });

  const standardRows = PAYSLIP_DEDUCTION_ROWS.map((row) => ({
    label: row.label,
    value: getDeductionAmount(employee, row.aliases),
  }));
  const extraRows = (employee.deductionItems || [])
    .filter((item) => !standardKeys.has(normalizeKey(item.name)) && parseAmount(item.amount) > 0)
    .map((item) => ({
      label: item.name,
      value: parseAmount(item.amount),
    }));

  return [...standardRows, ...extraRows];
}

function isContractServiceEmployee(employee = {}) {
  return normalizeEmploymentType(employee.employmentType ?? employee.employmentStatus) === CONTRACT_SERVICE_EMPLOYMENT_TYPE;
}

function formatContractServiceEmployeeName(employee = {}) {
  const fullName = String(employee.fullName || employee.employeeName || "Selected Employee").replace(/\s+/g, " ").trim();

  if (!fullName || fullName.includes(",")) {
    return fullName || "Selected Employee";
  }

  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length < 2) {
    return fullName;
  }

  const lastName = parts.pop();
  return `${lastName}, ${parts.join(" ")}`;
}

function formatContractServicePeriodRange(employee = {}) {
  const start = parseDateValue(employee.startDate);
  const end = parseDateValue(employee.endDate || employee.paidPayrollDate);

  if (start && end) {
    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      if (start.getDate() === end.getDate()) {
        return `${monthName(start, true)} ${start.getDate()}, ${end.getFullYear()}`;
      }

      return `${monthName(start, true)} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
    }

    return `${monthName(start, true)} ${start.getDate()}, ${start.getFullYear()} - ${monthName(end, true)} ${end.getDate()}, ${end.getFullYear()}`;
  }

  const payrollDate = parseDateValue(employee.paidPayrollDate);
  if (payrollDate) {
    return `${monthName(payrollDate, true)} ${payrollDate.getDate()}, ${payrollDate.getFullYear()}`;
  }

  return "";
}

function countContractServicePeriodDays(employee = {}) {
  const start = parseDateValue(employee.startDate);
  const end = parseDateValue(employee.endDate || employee.paidPayrollDate);

  if (!start || !end || start > end) {
    return 0;
  }

  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    if (current.getDay() !== 0) {
      count += 1;
    }

    current.setDate(current.getDate() + 1);
  }

  return count;
}

function getContractServiceDaysRendered(employee = {}) {
  const renderedMinutes = parseAmount(employee.attendanceRenderedMinutes);

  if (renderedMinutes > 0) {
    return roundAmount(renderedMinutes / (WORKING_HOURS_PER_DAY * 60));
  }

  const expectedWorkdays = parseAmount(employee.attendanceExpectedWorkdays);
  if (expectedWorkdays > 0) {
    return Math.max(roundAmount(expectedWorkdays - parseAmount(employee.absenceDays)), 0);
  }

  const periodDays = countContractServicePeriodDays(employee);
  return periodDays > 0 ? Math.max(roundAmount(periodDays - parseAmount(employee.absenceDays)), 0) : 0;
}

function getContractServiceDailyRate(employee = {}, daysRendered = 0, salaryAmount = 0) {
  if (daysRendered > 0 && salaryAmount > 0) {
    return roundAmount(salaryAmount / daysRendered);
  }

  const hourlyRate = parseAmount(employee.hourlyRate);
  if (hourlyRate > 0) {
    return roundAmount(hourlyRate * WORKING_HOURS_PER_DAY);
  }

  const basicSalary = parseAmount(employee.paidBasicSalary || employee.basicSalary);
  return basicSalary > 0 ? roundAmount(basicSalary / WORKING_DAYS_PER_MONTH) : 0;
}

function buildContractServiceDeductions(employee = {}) {
  const undertimeDeduction = getDeductionAmount(employee, ["Undertime Deduction"]);
  const explicitPassSlipDeduction = getDeductionAmount(employee, ["Pass Slip", "Pass Slip Deduction"]);
  const passSlipDeduction = explicitPassSlipDeduction > 0
    ? explicitPassSlipDeduction
    : (!employee.hasAttendanceCoverage && undertimeDeduction > 0 ? undertimeDeduction : 0);

  return CONTRACT_SERVICE_DEDUCTION_ROWS.map((row) => {
    let value = getDeductionAmount(employee, row.aliases);

    if (row.label === "Late/UT" && employee.hasAttendanceCoverage) {
      value += undertimeDeduction;
    }

    if (row.label === "Pass Slip") {
      value = passSlipDeduction;
    }

    return {
      label: row.label,
      value: roundAmount(value),
    };
  });
}

function getContractServiceAdditionalSalary(employee = {}) {
  const hiddenKeys = new Set(CONTRACT_SERVICE_HIDDEN_ALLOWANCE_NAMES.map(normalizeKey));

  return (employee.allowanceItems || []).reduce((total, item) => {
    if (hiddenKeys.has(normalizeKey(item.name))) {
      return total;
    }

    return total + parseAmount(item.amount);
  }, 0);
}

function buildContractServicePayslip(employee = {}, signatory = DEFAULT_PAYSLIP_SIGNATORY) {
  const salaryAmount = parseAmount(employee.paidBasicSalary || employee.basicSalary);
  const daysRendered = getContractServiceDaysRendered(employee);
  const dailyRate = getContractServiceDailyRate(employee, daysRendered, salaryAmount);
  const periodSalary = daysRendered > 0 && dailyRate > 0
    ? roundAmount(daysRendered * dailyRate)
    : salaryAmount;
  const premiumUnit = roundAmount(dailyRate * (CONTRACT_SERVICE_PREMIUM_RATE / 100));
  const storedPremiumTotal = getAllowanceAmount(employee, CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES);
  const premiumTotal = storedPremiumTotal > 0
    ? storedPremiumTotal
    : roundAmount(premiumUnit * daysRendered);
  const additionalSalary = roundAmount(getContractServiceAdditionalSalary(employee));
  const grossPay = roundAmount(periodSalary + premiumTotal + additionalSalary);
  const deductions = buildContractServiceDeductions(employee);
  const totalDeductions = roundAmount(deductions.reduce((total, item) => total + parseAmount(item.value), 0));
  const netPay = roundAmount(grossPay - totalDeductions);
  const periodRange = formatContractServicePeriodRange(employee);

  return {
    layout: "contractService",
    officeLines: ["MINES AND GEOSCIENCES BUREAU", "Regional Office No. X"],
    title: `SALARY OF CONTRACT OF SERVICE FOR THE${periodRange ? ` PERIOD ${periodRange}` : " PERIOD"}`,
    employee: formatContractServiceEmployeeName(employee),
    daysRendered,
    dailyRate,
    periodSalary,
    premiumRate: CONTRACT_SERVICE_PREMIUM_RATE,
    premiumUnit,
    premiumTotal,
    additionalSalary,
    grossPay,
    deductions,
    totalDeductions,
    netPay,
    signatoryName: String(signatory?.name || ""),
    signatoryTitle: String(signatory?.title || PAYSLIP_SIGNATORY_TITLE),
  };
}

function buildSamplePayslip(employee = {}, peraAmount = DEFAULT_PERA_AMOUNT, signatory = DEFAULT_PAYSLIP_SIGNATORY) {
  if (isContractServiceEmployee(employee)) {
    return buildContractServicePayslip(employee, signatory);
  }

  const allowanceItems = employee.allowanceItems || [];
  const hasAllowanceItems = allowanceItems.length > 0;
  const pera = getAllowanceAmount(employee, ["PERA"]) || (hasAllowanceItems ? 0 : parseAmount(peraAmount));
  const extraEarnings = allowanceItems
    .filter((item) => normalizeKey(item.name) !== "pera" && parseAmount(item.amount) > 0)
    .map((item) => ({
      label: String(item.name || "Additional Earnings").toUpperCase(),
      value: parseAmount(item.amount),
    }));
  const allowanceTotal = pera + extraEarnings.reduce((total, item) => total + parseAmount(item.value), 0);
  const salary = parseAmount(employee.paidBasicSalary || employee.basicSalary);
  const grossPay = parseAmount(employee.paidGrossPay) || salary + allowanceTotal;
  const salaryAmount = grossPay > allowanceTotal ? grossPay - allowanceTotal : salary;
  const totalDeductions = parseAmount(employee.paidTotalDeduction);
  const netPay = parseAmount(employee.paidNetPay) || Math.max(grossPay - totalDeductions, 0);

  return {
    office: PAYSLIP_OFFICE,
    period: formatPayslipPeriod(employee),
    employee: [employee.employeeId, employee.fullName || "Selected Employee"].filter(Boolean).join(" "),
    earnings: [
      { label: "MONTHLY SALARY", value: salaryAmount },
      { label: "ACA/PERA", value: pera },
      ...extraEarnings,
    ],
    deductions: buildPayslipDeductions(employee),
    totalDeductions,
    netPay,
    periodAmounts: buildPeriodAmounts(employee, netPay),
    signatoryName: String(signatory?.name || ""),
    signatoryTitle: String(signatory?.title || PAYSLIP_SIGNATORY_TITLE),
  };
}

function formatPayslipMoney(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return formatAmount(value);
}

function formatContractServiceMoney(value, { dash = false } = {}) {
  if (value === null || value === undefined || value === "") {
    return dash ? "-" : "";
  }

  const amount = parseAmount(value);
  if (amount === 0) {
    return dash ? "-" : "";
  }

  return formatAmount(amount);
}

function formatContractServiceDays(value) {
  const amount = parseAmount(value);
  if (amount === 0) {
    return "";
  }

  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function buildContractServicePayslipDownloadHtml(data) {
  const titleHtml = escapeHtml(data.title).replace(" FOR THE PERIOD ", " FOR THE<br />PERIOD ");
  const rowHtml = (label, value) => `
    <div class="deduction-row">
      <span class="deduction-label">${escapeHtml(label)}</span>
      <span class="deduction-value">${escapeHtml(formatContractServiceMoney(value))}</span>
    </div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Payslip</title><style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#000;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:430px;min-height:620px;background:#fff;padding:38px 28px 28px;font-size:12px;line-height:1.2}.office{text-align:center;font-weight:700}.title{margin-top:14px;text-align:center;font-size:14px;line-height:1.35}.employee{margin-top:14px;font-weight:700}.pay-row{display:grid;grid-template-columns:132px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.pay-row .days{text-align:center}.pay-row .amount{text-align:right}.add-row{display:grid;grid-template-columns:42px 108px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.add-row .amount{text-align:right}.gross-line{border-top:1px solid #000;font-weight:700}.deductions{margin-top:1px}.deduction-title{line-height:1.25}.deduction-row{display:grid;grid-template-columns:118px 1fr;line-height:1.35}.deduction-label{padding-left:70px;white-space:nowrap}.deduction-value{text-align:right}.total-deductions{display:grid;grid-template-columns:1fr 44px 96px;align-items:end;margin-top:2px;line-height:1.25}.total-deductions .label{font-style:italic;text-align:center}.total-deductions .dash{text-align:center}.net-row{display:grid;grid-template-columns:1fr 96px;column-gap:8px;margin-top:18px;align-items:end}.net-row .label{font-size:14px;font-style:italic;font-weight:700;text-align:center}.net-row .value{border-top:1px solid #000;font-size:15px;font-style:italic;font-weight:700;text-align:right}.certify{margin-top:30px;text-align:center;font-size:11px}.signature{margin-top:30px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{font-size:11px}@media print{.page{padding:0}.slip{width:100%;min-height:auto}}
  </style></head><body><main class="page"><section class="slip">
    <div class="office">${data.officeLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
    <div class="title">${titleHtml}</div>
    <div class="employee">${escapeHtml(data.employee)}</div>
    <div class="pay-row"><span class="days">${escapeHtml(formatContractServiceDays(data.daysRendered))}</span><span>x</span><span class="amount">${escapeHtml(formatContractServiceMoney(data.dailyRate))}</span><span>=</span><span class="amount">${escapeHtml(formatContractServiceMoney(data.periodSalary))}</span></div>
    <div class="add-row"><span>Add:</span><span>Premium (${escapeHtml(formatContractServiceDays(data.premiumRate))}%)</span><span>+</span><span class="amount">${escapeHtml(formatContractServiceMoney(data.premiumUnit))}</span><span>=</span><span class="amount">${escapeHtml(formatContractServiceMoney(data.premiumTotal))}</span></div>
    <div class="add-row"><span></span><span>Additional Salary</span><span>+</span><span class="amount">${escapeHtml(formatContractServiceMoney(data.additionalSalary))}</span><span>=</span><span class="amount gross-line">${escapeHtml(formatContractServiceMoney(data.additionalSalary))}</span></div>
    <div class="pay-row"><span></span><span></span><span></span><span></span><span class="amount">${escapeHtml(formatContractServiceMoney(data.grossPay))}</span></div>
    <div class="deductions"><div class="deduction-title">Deductions:</div>${data.deductions.map((item) => rowHtml(item.label, item.value)).join("")}</div>
    <div class="total-deductions"><span class="label">Total Deduction</span><span class="dash">-</span><span class="deduction-value">${escapeHtml(formatContractServiceMoney(data.totalDeductions, { dash: true }))}</span></div>
    <div class="net-row"><span class="label">Total</span><span class="value">${escapeHtml(formatContractServiceMoney(data.netPay, { dash: true }))}</span></div>
    <div class="certify">CERTIFIED TRUE AND CORRECT</div>
    <div class="signature"><div class="signature-name">${escapeHtml(data.signatoryName)}</div><div class="signature-title">${escapeHtml(data.signatoryTitle)}</div></div>
  </section></main></body></html>`;
}

function buildPayslipDownloadHtml(employee, peraAmount, signatory) {
  const data = buildSamplePayslip(employee, peraAmount, signatory);

  if (data.layout === "contractService") {
    return buildContractServicePayslipDownloadHtml(data);
  }

  const earningsTotal = data.earnings.reduce((sum, item) => sum + parseAmount(item.value), 0);
  const rowHtml = (item, bold = false) => `
    <div class="row ${bold ? "bold" : ""}">
      <span class="label">${escapeHtml(item.label)}</span>
      <span class="value">${escapeHtml(formatPayslipMoney(item.value))}</span>
    </div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Payslip</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#262626;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:280px;border:1px solid #d4d4d4;background:#fafafa;padding:16px;font-size:11px}.header{margin-bottom:8px;border-bottom:2px solid #d4d4d4;padding-bottom:8px;text-align:center}.title{margin:2px 0;font-size:13px;font-weight:700}.period{font-style:italic}.employee{font-weight:700}.section{margin-top:10px}.row{display:flex;justify-content:space-between;line-height:1.35}.label{width:60%}.value{width:40%;text-align:right}.bold{font-weight:700}.topline{margin-top:2px;border-top:1px solid #262626;padding-top:2px}.deduction-title{margin:10px 0 4px;font-weight:700}.total{margin-top:10px;border-top:1px solid #262626;padding-top:6px}.net{margin-top:10px;border-top:1px solid #262626;padding-top:6px;font-size:13px}.net .value{margin-top:-2px;font-size:14px}.periods{margin-top:6px;padding-left:20px}.certify{margin-top:20px;text-align:center;font-size:10px;letter-spacing:.04em;text-transform:uppercase}.signature{margin-top:16px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{margin-top:2px}@media print{body{background:#fff}.page{padding:0}}
  </style></head><body><main class="page"><section class="slip">
    <div class="header"><div>${escapeHtml(data.office)}</div><div class="title">PAYSLIP</div><div class="period">${escapeHtml(data.period)}</div></div>
    <div class="employee">${escapeHtml(data.employee)}</div>
    <div class="section">${data.earnings.map((item) => rowHtml(item)).join("")}<div class="row bold topline"><span class="label"></span><span class="value">${escapeHtml(formatPayslipMoney(earningsTotal))}</span></div></div>
    <div class="section"><div class="deduction-title">DEDUCTIONS:</div>${data.deductions.map((item) => rowHtml(item)).join("")}</div>
    <div class="row bold total"><span class="label">TOTAL DEDUCTIONS</span><span class="value">${escapeHtml(formatPayslipMoney(data.totalDeductions))}</span></div>
    <div class="row bold net"><span class="label">NET TAKE HOME PAY</span><span class="value">${escapeHtml(formatPayslipMoney(data.netPay))}</span></div>
    <div class="periods">${data.periodAmounts.map((item) => rowHtml(item)).join("")}</div>
    <div class="certify">Certified true and correct</div>
    <div class="signature"><div class="signature-name">${escapeHtml(data.signatoryName)}</div><div class="signature-title">${escapeHtml(data.signatoryTitle)}</div></div>
  </section></main></body></html>`;
}

function getPayslipFileName(employee, extension = "pdf") {
  const safeName = String(employee?.fullName || employee?.employeeId || "employee")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "employee";
  const payrollDate = String(employee?.paidPayrollDate || "").replace(/[^0-9-]/g, "");
  const suffix = String(payrollDate || employee?.paidPayrollId || "record")
    .trim()
    .replace(/[^a-z0-9-]+/gi, "") || "record";

  return `payslip-${safeName}-${suffix}.${extension}`;
}

function waitForFramePaint(iframe) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    };

    iframe.addEventListener("load", settle, { once: true });
    window.setTimeout(settle, 350);
  });
}

async function downloadPayslipPdf(html, filename) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Payslip PDF renderer");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "900px",
    height: "1200px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });

  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;

    if (!doc) {
      throw new Error("Unable to prepare the payslip PDF.");
    }

    const ready = waitForFramePaint(iframe);
    doc.open();
    doc.write(html);
    doc.close();
    await ready;

    const target = doc.querySelector(".slip") || doc.body;
    const canvas = await html2canvas(target, {
      scale: 3,
      useCORS: true,
      backgroundColor: "#ffffff",
    });
    const imageData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const imageScale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
    const imageWidth = canvas.width * imageScale;
    const imageHeight = canvas.height * imageScale;
    const x = (pageWidth - imageWidth) / 2;

    pdf.addImage(imageData, "PNG", x, margin, imageWidth, imageHeight);
    pdf.save(filename);
  } finally {
    iframe.remove();
  }
}

function openPayslipPrintWindow(html) {
  const printWindow = window.open("", "_blank", "width=900,height=700");

  if (!printWindow) {
    throw new Error("Allow pop-ups to print the payslip.");
  }

  const printScript = `
    <script>
      window.addEventListener("load", function () {
        window.focus();
        window.setTimeout(function () {
          window.print();
        }, 250);
      });
    </script>`;

  printWindow.document.open();
  printWindow.document.write(html.replace("</body>", `${printScript}</body>`));
  printWindow.document.close();
}

function PayslipAmountRow({ label, value, bold = false }) {
  return (
    <div className={`flex justify-between leading-snug ${bold ? "font-bold" : ""}`}>
      <span className="w-3/5">{label}</span>
      <span className="w-2/5 text-right">{formatPayslipMoney(value)}</span>
    </div>
  );
}

function ContractServicePayslip({ data }) {
  const titleLines = data.title.replace(" FOR THE PERIOD ", " FOR THE\nPERIOD ").split("\n");

  return (
    <div className="flex justify-center bg-neutral-100 p-4">
      <div
        className="min-h-[620px] w-[430px] bg-white px-7 pb-7 pt-9 text-[12px] text-black"
        style={{ fontFamily: "Arial, sans-serif", lineHeight: 1.2 }}
      >
        <div className="text-center font-bold">
          {data.officeLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>

        <div className="mt-3.5 text-center text-[14px] leading-snug">
          {titleLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>

        <div className="mt-3.5 font-bold">{data.employee}</div>

        <div className="grid grid-cols-[132px_16px_70px_16px_92px] items-end gap-x-1.5 leading-tight">
          <span className="text-center">{formatContractServiceDays(data.daysRendered)}</span>
          <span>x</span>
          <span className="text-right">{formatContractServiceMoney(data.dailyRate)}</span>
          <span>=</span>
          <span className="text-right">{formatContractServiceMoney(data.periodSalary)}</span>
        </div>

        <div className="grid grid-cols-[42px_108px_16px_70px_16px_92px] items-end gap-x-1.5 leading-tight">
          <span>Add:</span>
          <span>{`Premium (${formatContractServiceDays(data.premiumRate)}%)`}</span>
          <span>+</span>
          <span className="text-right">{formatContractServiceMoney(data.premiumUnit)}</span>
          <span>=</span>
          <span className="text-right">{formatContractServiceMoney(data.premiumTotal)}</span>
        </div>

        <div className="grid grid-cols-[42px_108px_16px_70px_16px_92px] items-end gap-x-1.5 leading-tight">
          <span></span>
          <span>Additional Salary</span>
          <span>+</span>
          <span className="text-right">{formatContractServiceMoney(data.additionalSalary)}</span>
          <span>=</span>
          <span className="border-t border-black text-right">
            {formatContractServiceMoney(data.additionalSalary)}
          </span>
        </div>

        <div className="grid grid-cols-[132px_16px_70px_16px_92px] items-end gap-x-1.5 leading-tight">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span className="text-right font-bold">{formatContractServiceMoney(data.grossPay)}</span>
        </div>

        <div className="mt-0.5 leading-snug">Deductions:</div>
        <div>
          {data.deductions.map((deduction) => (
            <div key={deduction.label} className="grid grid-cols-[118px_1fr] leading-snug">
              <span className="whitespace-nowrap pl-[70px]">{deduction.label}</span>
              <span className="text-right">{formatContractServiceMoney(deduction.value)}</span>
            </div>
          ))}
        </div>

        <div className="mt-0.5 grid grid-cols-[1fr_44px_96px] items-end leading-tight">
          <span className="text-center italic">Total Deduction</span>
          <span className="text-center">-</span>
          <span className="text-right">{formatContractServiceMoney(data.totalDeductions, { dash: true })}</span>
        </div>

        <div className="mt-[18px] grid grid-cols-[1fr_96px] items-end gap-x-2">
          <span className="text-center text-[14px] font-bold italic">Total</span>
          <span className="border-t border-black text-right text-[15px] font-bold italic">
            {formatContractServiceMoney(data.netPay, { dash: true })}
          </span>
        </div>

        <div className="mt-7 text-center text-[11px]">CERTIFIED TRUE AND CORRECT</div>

        <div className="mt-7 text-center">
          <div className="font-bold uppercase">{data.signatoryName}</div>
          <div className="text-[11px]">{data.signatoryTitle}</div>
        </div>
      </div>
    </div>
  );
}

function SamplePayslip({ data }) {
  if (data.layout === "contractService") {
    return <ContractServicePayslip data={data} />;
  }

  const earningsTotal = data.earnings.reduce((sum, earning) => sum + parseAmount(earning.value), 0);

  return (
    <div className="flex justify-center bg-neutral-100 p-4">
      <div
        className="w-[280px] border border-neutral-300 bg-neutral-50 p-4 text-[11px] text-neutral-800"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        <div className="mb-2 border-b-2 border-neutral-300 pb-2 text-center">
          <div>{data.office}</div>
          <div className="my-0.5 text-[13px] font-bold">PAYSLIP</div>
          <div className="italic">{data.period}</div>
        </div>

        <div className="font-bold">{data.employee}</div>

        <div className="mt-2.5">
          {data.earnings.map((earning) => (
            <PayslipAmountRow key={earning.label} label={earning.label} value={earning.value} />
          ))}
          <div className="mt-0.5 flex justify-between border-t border-neutral-800 pt-0.5 font-bold">
            <span className="w-3/5"></span>
            <span className="w-2/5 text-right">{formatPayslipMoney(earningsTotal)}</span>
          </div>
        </div>

        <div className="mt-2.5">
          <div className="mb-1 mt-2.5 font-bold">DEDUCTIONS:</div>
          {data.deductions.map((deduction, index) => (
            <PayslipAmountRow key={`${deduction.label}-${index}`} label={deduction.label} value={deduction.value} />
          ))}
        </div>

        <div className="mt-2.5 flex justify-between border-t border-neutral-800 pt-1.5 font-bold">
          <span className="w-3/5">TOTAL DEDUCTIONS</span>
          <span className="w-2/5 text-right">{formatPayslipMoney(data.totalDeductions)}</span>
        </div>

        <div className="mt-2.5 border-t border-neutral-800 pt-1.5 text-[13px]">
          <div className="flex justify-between">
            <span className="w-3/5 font-bold">NET TAKE HOME PAY</span>
            <span className="-mt-0.5 w-2/5 text-right text-[14px] font-bold">
              {formatPayslipMoney(data.netPay)}
            </span>
          </div>
        </div>

        <div className="mt-1.5 pl-5">
          {data.periodAmounts.map((periodAmount) => (
            <PayslipAmountRow key={periodAmount.label} label={periodAmount.label} value={periodAmount.value} />
          ))}
        </div>

        <div className="mt-5 text-center text-[10px] uppercase tracking-wide">
          Certified true and correct
        </div>

        <div className="mt-4 text-center">
          <div className="font-bold uppercase">{data.signatoryName}</div>
          <div className="mt-0.5">{data.signatoryTitle}</div>
        </div>
      </div>
    </div>
  );
}
function formatCurrency(value) {
  return `PHP ${formatAmount(value)}`;
}

function getEmployeeKey(employee) {
  return String(employee?.id || employee?.employeeId || employee?.paidPayrollId || "");
}

function getPayslipDetailDeductionItems(employee) {
  const sourceItems = isContractServiceEmployee(employee || {})
    ? buildContractServiceDeductions(employee || {})
    : buildPayslipDeductions(employee || {});

  return sourceItems.map((item) => ({
    name: item.label,
    category: "Deductions",
    amount: parseAmount(item.value),
  }));
}

function getPayslipDetailDeductionTotal(employee) {
  if (isContractServiceEmployee(employee || {})) {
    return getPayslipDetailDeductionItems(employee)
      .reduce((total, item) => total + parseAmount(item.amount), 0);
  }

  return parseAmount(employee?.paidTotalDeduction);
}

function isContractServiceHiddenAllowance(item) {
  return CONTRACT_SERVICE_DETAIL_HIDDEN_ALLOWANCE_NAMES.map(normalizeKey).includes(normalizeKey(item?.name));
}

function buildAttendanceSummaryRows(employee = {}) {
  return [
    ["Expected Workdays", employee.attendanceExpectedWorkdays],
    ["Leave Days", employee.attendanceLeaveDays],
    ["Absent Days", employee.absenceDays],
    ["Late Minutes", employee.attendanceLateMinutes],
    ["Undertime Minutes", employee.attendanceUndertimeMinutes],
    ["Overtime Hours", employee.overtimeHours],
  ];
}

function SummaryStat({ label, value, tone = "slate" }) {
  const toneClasses = {
    slate: "bg-slate-50 text-slate-900",
    rose: "bg-rose-50 text-rose-700",
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
  };

  return (
    <div className={`rounded-lg border border-slate-200 px-4 py-3 ${toneClasses[tone] || toneClasses.slate}`}>
      <p className="m-0 text-xs font-bold uppercase text-slate-500">{label}</p>
      <strong className="mt-1 block truncate text-base">{value}</strong>
    </div>
  );
}

function PayslipSummaryCard({ summary }) {
  const employmentBreakdown = Object.entries(summary.byEmploymentType || {});

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white/95 shadow-sm">
      <CardHeader>
        <CardTitle>Summary Statistics</CardTitle>
        <CardDescription>Totals update from the employees currently selected in the table.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryStat label="Selected" value={summary.totalEmployees} />
          <SummaryStat label="Gross Pay" value={formatCurrency(summary.totalGrossPay)} tone="blue" />
          <SummaryStat label="Deductions" value={formatCurrency(summary.totalDeductions)} tone="rose" />
          <SummaryStat label="Net Pay" value={formatCurrency(summary.totalNetPay)} tone="emerald" />
          <SummaryStat label="Average Net" value={formatCurrency(summary.averageNetPay)} />
        </div>

        {employmentBreakdown.length ? (
          <div className="grid gap-2 md:grid-cols-3">
            {employmentBreakdown.map(([type, item]) => (
              <div key={type} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-slate-800">{type}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-600">
                    {item.count}
                  </span>
                </div>
                <p className="m-0 mt-1 text-xs text-slate-500">Net {formatCurrency(item.netPay)}</p>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PayslipDeductionCell({ employee, expanded, onToggle }) {
  const deductions = getPayslipDetailDeductionItems(employee);
  const totalDeductions = getPayslipDetailDeductionTotal(employee);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-[#F18E8E] hover:bg-[#fff5f5] hover:text-[#D61E1E]"
        aria-label={`${expanded ? "Hide" : "Show"} deductions for ${employee.fullName || "employee"}`}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      <div>
        <p className="m-0 font-semibold text-rose-700">{formatCurrency(totalDeductions)}</p>
        <p className="m-0 text-xs text-slate-500">{deductions.length} deduction item{deductions.length === 1 ? "" : "s"}</p>
      </div>
    </div>
  );
}

function PayslipDeductionBreakdown({ employee }) {
  const deductions = getPayslipDetailDeductionItems(employee);
  const totalDeductions = getPayslipDetailDeductionTotal(employee);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="m-0 text-sm font-bold text-slate-900">
            Deductions for {employee.fullName || "Employee"} {employee.employeeId ? `(${employee.employeeId})` : ""}
          </h3>
          <p className="m-0 mt-1 text-xs text-slate-500">
            Payroll {employee.paidPayrollId || "record"} - {employee.periodLabel || formatDate(employee.paidPayrollDate)}
          </p>
        </div>
        <strong className="text-sm text-rose-700">{formatCurrency(totalDeductions)}</strong>
      </div>

      {deductions.length ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {deductions.map((item, index) => (
            <div key={`${item.name}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-slate-800">{item.name || "Deduction"}</p>
                  <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{item.category || "Other deductions"}</p>
                </div>
                <span className="shrink-0 text-sm font-bold text-rose-700">{formatCurrency(item.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-slate-500">No deduction breakdown is available for this payroll record.</p>
      )}
    </div>
  );
}

function PayslipViewModal({ employee, peraAmount, signatory, onClose, onDownload, onPrint, downloading = false }) {
  const open = Boolean(employee);
  const data = useMemo(
    () => buildSamplePayslip(employee || {}, peraAmount, signatory),
    [employee, peraAmount, signatory]
  );
  const attendanceRows = useMemo(
    () => buildAttendanceSummaryRows(employee || {}),
    [employee]
  );
  const deductions = getPayslipDetailDeductionItems(employee);
  const totalDeductions = getPayslipDetailDeductionTotal(employee);
  const contractService = isContractServiceEmployee(employee || {});
  const detailNetPay = contractService ? data.netPay : employee?.paidNetPay;
  const allowanceItems = (employee?.allowanceItems || [])
    .filter((item) => parseAmount(item.amount) > 0)
    .filter((item) => !contractService || !isContractServiceHiddenAllowance(item));

  return (
    <Modal
      open={open}
      title={employee ? `Payslip Details - ${employee.fullName || employee.employeeId || "Employee"}` : "Payslip Details"}
      onClose={onClose}
      maxWidth="max-w-5xl"
      contentClassName="bg-slate-50"
      footer={(
        <>
          <Button variant="ghost" icon={Printer} onClick={() => employee && onPrint(employee)} disabled={!employee?.isPaid}>
            Print
          </Button>
          <Button
            variant="primary"
            icon={Download}
            onClick={() => employee && onDownload(employee)}
            loading={downloading}
            disabled={!employee?.isPaid}
          >
            Download Payslip
          </Button>
        </>
      )}
    >
      {employee ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="m-0 text-sm font-bold text-slate-900">Employment Information</h3>
              <div className="mt-3 space-y-2 text-sm">
                {[
                  ["Employee ID", employee.employeeId || "N/A"],
                  ["Division", employee.department || "Unassigned"],
                  ["Designation", employee.position || "N/A"],
                  ["Employment Type", employee.employmentType || "N/A"],
                  ["Payroll Period", employee.periodLabel || "N/A"],
                  ["Payroll Date", formatDate(employee.paidPayrollDate)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                    <span className="text-slate-500">{label}</span>
                    <span className="text-right font-semibold text-slate-800">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="m-0 text-sm font-bold text-slate-900">Attendance Summary</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm xl:grid-cols-3">
                {attendanceRows.map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="m-0 text-xs font-semibold text-slate-500">{label}</p>
                    <strong className="mt-1 block text-base text-slate-900">{formatAttendanceNumber(value)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="m-0 text-sm font-bold text-slate-900">Earnings</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Basic Salary</span>
                  <span className="font-semibold text-slate-800">{formatCurrency(employee.paidBasicSalary || employee.basicSalary)}</span>
                </div>
                {allowanceItems.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex justify-between gap-4">
                    <span className="text-slate-500">{item.name || "Allowance"}</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
                  <span className="font-semibold text-slate-700">Gross Pay</span>
                  <span className="font-bold text-blue-700">{formatCurrency(employee.paidGrossPay)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="m-0 text-sm font-bold text-slate-900">Deductions</h3>
              <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1 text-sm">
                {deductions.length ? deductions.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex justify-between gap-4">
                    <span className="min-w-0 truncate text-slate-500">{item.name || "Deduction"}</span>
                    <span className="shrink-0 font-semibold text-rose-700">{formatCurrency(item.amount)}</span>
                  </div>
                )) : (
                  <p className="m-0 text-slate-500">No deduction breakdown available.</p>
                )}
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
                  <span className="font-semibold text-slate-700">
                    {contractService ? "Total Deduction" : "Total Deductions"}
                  </span>
                  <span className="font-bold text-rose-700">{formatCurrency(totalDeductions)}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
                  <span className="font-semibold text-slate-700">Net Take Home Pay</span>
                  <span className="font-bold text-emerald-700">{formatCurrency(detailNetPay)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
            <SamplePayslip data={data} />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function PayslipWorkspace({ employees = [], mode = "admin" }) {
  const isEmployeeMode = mode === "employee";
  const [apiEmployees, setApiEmployees] = useState([]);
  const [peraAmount, setPeraAmount] = useState(DEFAULT_PERA_AMOUNT);
  const [signatory, setSignatory] = useState(DEFAULT_PAYSLIP_SIGNATORY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    department: "",
    employmentType: "",
    payPeriod: "",
    search: "",
  });
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [viewedEmployee, setViewedEmployee] = useState(null);
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const [downloadingPayslipKey, setDownloadingPayslipKey] = useState("");

  const loadPayslipData = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchPayslipData(isEmployeeMode ? { scope: "self" } : {});

      setApiEmployees(Array.isArray(result.employees) ? result.employees : []);
      setPeraAmount(parseAmount(result.defaults?.pera || DEFAULT_PERA_AMOUNT));
      setSignatory({
        name: String(result.defaults?.signatory?.name || ""),
        title: String(result.defaults?.signatory?.title || PAYSLIP_SIGNATORY_TITLE),
      });
      setError("");
    } catch (requestError) {
      if (!background) {
        setError(requestError.response?.data?.message || "Unable to load payslip data.");
      }
    } finally {
      setLoading(false);
    }
  }, [isEmployeeMode]);

  /** `employee` is here so a payslip picks up a name or salary edit, not just a payroll release. */
  useAutoRefreshOnChange(loadPayslipData, { topics: ["payslip", "payroll", "employee"] });

  const employeeOptions = useMemo(
    () => mergeEmployees(employees, apiEmployees),
    [apiEmployees, employees]
  );

  const payslipRows = useMemo(() => (
    (isEmployeeMode ? apiEmployees.map(normalizeEmployee) : employeeOptions)
      .filter((employee) => employee.isPaid)
      .sort((left, right) => String(right.paidPayrollDate || "").localeCompare(String(left.paidPayrollDate || "")))
  ), [apiEmployees, employeeOptions, isEmployeeMode]);

  const filterOptions = useMemo(() => ({
    departments: Array.from(new Set(payslipRows.map((employee) => employee.department).filter(Boolean))).sort(),
    employmentTypes: Array.from(new Set(payslipRows.map((employee) => employee.employmentType).filter(Boolean))).sort(),
    payPeriods: Array.from(new Set(payslipRows.map((employee) => employee.payPeriod).filter(Boolean))).sort(),
  }), [payslipRows]);

  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return payslipRows.filter((employee) => {
      if (filters.department && employee.department !== filters.department) {
        return false;
      }

      if (filters.employmentType && employee.employmentType !== filters.employmentType) {
        return false;
      }

      if (filters.payPeriod && employee.payPeriod !== filters.payPeriod) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [
        employee.employeeId,
        employee.fullName,
        employee.department,
        employee.position,
        employee.periodLabel,
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [filters, payslipRows]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRows, pageSize, safePage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, rowsPerPage]);

  const handleFilterChange = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const handleToggleExpandedRow = (employee) => {
    const key = getEmployeeKey(employee);

    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDownloadPayslip = async (employee) => {
    if (!employee?.isPaid) {
      toast.error("Payslip can only be downloaded after payroll is marked as Paid.");
      return;
    }

    const key = getEmployeeKey(employee);
    const html = buildPayslipDownloadHtml(employee, peraAmount, signatory);
    setDownloadingPayslipKey(key);

    try {
      await downloadPayslipPdf(html, getPayslipFileName(employee, "pdf"));
      toast.success("Payslip PDF downloaded.");
    } catch (downloadError) {
      toast.error(downloadError?.message || "Unable to download the payslip PDF.");
    } finally {
      setDownloadingPayslipKey("");
    }
  };

  const handlePrintPayslip = (employee) => {
    if (!employee?.isPaid) {
      toast.error("Payslip can only be printed after payroll is marked as Paid.");
      return;
    }

    try {
      openPayslipPrintWindow(buildPayslipDownloadHtml(employee, peraAmount, signatory));
    } catch (printError) {
      toast.error(printError?.message || "Unable to open the payslip print form.");
    }
  };

  const renderFilters = () => (
    <div
      className={
        isEmployeeMode
          ? "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_120px]"
          : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_160px_120px]"
      }
    >
      <label className="relative">
        <span className="sr-only">Search payslip records</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={filters.search}
          onChange={(event) => handleFilterChange("search", event.target.value)}
          placeholder={isEmployeeMode ? "Search payroll period, designation" : "Search employee, ID, division"}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        />
      </label>

      {(isEmployeeMode
        /*
         * My Payslip Records shows one person's own payslips, so the period picker was dropped;
         * the search box still narrows by payroll period, matching on the period label.
         */
        ? []
        : [
          ["department", "All divisions", filterOptions.departments],
          ["employmentType", "All types", filterOptions.employmentTypes],
          ["payPeriod", "All periods", filterOptions.payPeriods],
        ]
      ).map(([name, placeholder, options]) => (
        <select
          key={name}
          value={filters[name]}
          onChange={(event) => handleFilterChange(name, event.target.value)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ))}

      <select
        value={rowsPerPage}
        onChange={(event) => setRowsPerPage(event.target.value)}
        className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      >
        <option value="5">5 rows</option>
        <option value="10">10 rows</option>
        <option value="20">20 rows</option>
      </select>
    </div>
  );

  const renderRows = () => {
    if (loading) {
      return Array.from({ length: 4 }).map((_, index) => (
        <tr key={index} className="animate-pulse border-b border-slate-100">
          <td colSpan={14} className="px-3 py-3">
            <div className="h-5 rounded bg-slate-200" />
          </td>
        </tr>
      ));
    }

    if (paginatedRows.length === 0) {
      return (
        <tr>
          <td colSpan={14} className="px-4 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
              <FileText size={20} />
            </div>
            <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No paid payslip records found</p>
            <p className="m-0 mt-1 text-sm text-slate-500">Payslips will appear after payroll is marked as paid.</p>
          </td>
        </tr>
      );
    }

    return paginatedRows.flatMap((employee, index) => {
      const key = getEmployeeKey(employee);
      const expanded = expandedRows.has(key);
      const downloading = downloadingPayslipKey !== "" && downloadingPayslipKey === key;

      return [
        <tr key={key} className="border-b border-slate-100 transition hover:bg-slate-50">
          <td className="px-3 py-3 text-sm font-semibold text-slate-600">
            {(safePage - 1) * pageSize + index + 1}
          </td>
          <td className="px-3 py-3 text-sm text-slate-600">{employee.employeeId || "N/A"}</td>
          <td className="px-3 py-3 text-sm text-slate-800">
            <div className="font-semibold text-slate-900">{employee.fullName || "Employee"}</div>
          </td>
          <td className="px-3 py-3 text-sm text-slate-600">{employee.department || "Unassigned"}</td>
          <td className="px-3 py-3 text-sm text-slate-600">{employee.position || "N/A"}</td>
          <td className="px-3 py-3 text-sm text-slate-600">{employee.employmentType || "N/A"}</td>
          <td className="px-3 py-3 text-sm text-slate-600">{employee.periodLabel || formatDate(employee.paidPayrollDate)}</td>
          <td className="px-3 py-3 text-sm text-slate-600">{formatCurrency(employee.paidBasicSalary || employee.basicSalary)}</td>
          <td className="px-3 py-3 text-sm text-slate-600">{formatCurrency(employee.paidTotalAllowance)}</td>
          <td className="px-3 py-3 text-sm text-slate-600">
            <PayslipDeductionCell
              employee={employee}
              expanded={expanded}
              onToggle={() => handleToggleExpandedRow(employee)}
            />
          </td>
          <td className="px-3 py-3 text-sm text-slate-600">{formatCurrency(employee.paidGrossPay)}</td>
          <td className="px-3 py-3 text-sm font-semibold text-emerald-700">{formatCurrency(employee.paidNetPay)}</td>
          <td className="px-3 py-3">
            <span className="inline-flex min-h-7 items-center rounded-full bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700">
              {employee.paidPayrollStatus || "Paid"}
            </span>
          </td>
          <td className="px-3 py-3">
            <div className="flex flex-wrap gap-2">
              <ActionIconButton
                label="View payslip"
                icon={faEye}
                tone="view"
                onClick={() => setViewedEmployee(employee)}
              />
              <ActionIconButton
                label="Print payslip"
                icon={faPrint}
                tone="print"
                onClick={() => handlePrintPayslip(employee)}
              />
              <ActionIconButton
                label="Download payslip"
                icon={faDownload}
                tone="export"
                text={downloading ? "Saving" : "Download"}
                onClick={() => handleDownloadPayslip(employee)}
                disabled={downloading}
              />
            </div>
          </td>
        </tr>,
        expanded ? (
          <tr key={`${key}-deductions`} className="border-b border-slate-100">
            <td colSpan={14} className="bg-white px-3 py-3">
              <PayslipDeductionBreakdown employee={employee} />
            </td>
          </tr>
        ) : null,
      ].filter(Boolean);
    });
  };

  /*
   * The card face of the same rows. Fourteen columns is 1760px of table, so this one keeps cards
   * all the way up to `xl` rather than the `lg` the other workspaces use — a 1024px window still
   * cannot show that table without a long sideways drag.
   *
   * In employee mode the ID, name, division, designation and employment type columns all describe
   * the one person reading the screen, so the card drops them and leads with the payroll period.
  */
  const renderCard = (employee, index) => {
    const key = getEmployeeKey(employee);
    const expanded = expandedRows.has(key);
    const downloading = downloadingPayslipKey !== "" && downloadingPayslipKey === key;

    return {
      eyebrow: `#${(safePage - 1) * pageSize + index + 1}`,
      title: employee.periodLabel || formatDate(employee.paidPayrollDate),
      subtitle: isEmployeeMode
        ? employee.position || "N/A"
        : `${employee.fullName || "Employee"} - ${employee.employeeId || "No ID"}`,
      badge: (
        <span className="inline-flex min-h-7 items-center rounded-full bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700">
          {employee.paidPayrollStatus || "Paid"}
        </span>
      ),
      fields: [
        ...(isEmployeeMode ? [] : [
          { label: "Division", value: employee.department || "Unassigned" },
          { label: "Designation", value: employee.position || "N/A" },
          { label: "Employment Type", value: employee.employmentType || "N/A" },
        ]),
        { label: "Basic Salary", value: formatCurrency(employee.paidBasicSalary || employee.basicSalary) },
        { label: "Total Allowances", value: formatCurrency(employee.paidTotalAllowance) },
        { label: "Gross Pay", value: formatCurrency(employee.paidGrossPay) },
        {
          label: "Net Pay",
          value: <span className="font-semibold text-emerald-700">{formatCurrency(employee.paidNetPay)}</span>,
        },
        {
          label: "Total Deductions",
          full: true,
          value: (
            <>
              <PayslipDeductionCell
                employee={employee}
                expanded={expanded}
                onToggle={() => handleToggleExpandedRow(employee)}
              />
              {expanded ? (
                <div className="mt-2">
                  <PayslipDeductionBreakdown employee={employee} />
                </div>
              ) : null}
            </>
          ),
        },
      ],
      actions: (
        <>
          <ActionIconButton
            label="View payslip"
            icon={faEye}
            tone="view"
            onClick={() => setViewedEmployee(employee)}
          />
          <ActionIconButton
            label="Print payslip"
            icon={faPrint}
            tone="print"
            onClick={() => handlePrintPayslip(employee)}
          />
          <ActionIconButton
            label="Download payslip"
            icon={faDownload}
            tone="export"
            text={downloading ? "Saving" : "Download"}
            onClick={() => handleDownloadPayslip(employee)}
            disabled={downloading}
          />
        </>
      ),
    };
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">
              {isEmployeeMode ? "My Payslip Records" : "Generate Payslip"}
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {isEmployeeMode
                ? "Available payslips from paid payroll records."
                : "Review paid employee deductions, then view or download payslips."}
            </p>
            {error ? <p className="m-0 mt-2 text-sm font-semibold text-rose-700">{error}</p> : null}
          </div>
        </div>

        {renderFilters()}

        <RecordCards
          className="mt-4 xl:hidden"
          /* One column: the deduction breakdown opens inside a card and needs the width. */
          gridClassName="grid gap-3"
          items={paginatedRows}
          itemKey={(employee) => getEmployeeKey(employee)}
          loading={loading}
          loadingCards={3}
          empty={{
            icon: FileText,
            title: "No paid payslip records found",
            description: "Payslips will appear after payroll is marked as paid.",
          }}
          renderCard={renderCard}
        />

        <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 xl:block">
          <div className="overflow-x-auto">
            <table className="min-w-[1760px] w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    "#",
                    "Employee ID",
                    "Full Name",
                    "Division",
                    "Designation",
                    "Employment Type",
                    "Payroll Period",
                    "Basic Salary",
                    "Total Allowances",
                    "Total Deductions",
                    "Gross Pay",
                    "Net Pay",
                    "Status",
                    "Actions",
                  ].map((header) => (
                    <th key={header} className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{renderRows()}</tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-slate-500">
            Showing {filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredRows.length)} of {filteredRows.length} payslip records
          </p>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      </section>

      <PayslipViewModal
        employee={viewedEmployee}
        peraAmount={peraAmount}
        signatory={signatory}
        onClose={() => setViewedEmployee(null)}
        onDownload={handleDownloadPayslip}
        onPrint={handlePrintPayslip}
        downloading={downloadingPayslipKey !== "" && downloadingPayslipKey === getEmployeeKey(viewedEmployee)}
      />
    </div>
  );
}
