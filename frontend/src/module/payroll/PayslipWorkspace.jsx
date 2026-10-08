import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Archive,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  RotateCcw,
  Search,
  Users,
} from "lucide-react";
import { faArchive, faDownload, faEye, faPrint, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ActionsMenu from "../../components/UI/ActionsMenu";
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
import { fetchPayslipData, fetchPayslipPeriods, fetchPayslipRecord, setPayslipsArchived } from "../../services/payslipService";
import { useOrganizationFilterOptions } from "../../hooks/useFilterOptions";

const DEFAULT_PERA_AMOUNT = 2000;
const PAYSLIP_OFFICE = "Mines and Geosciences Bureau, Regional Office No. X";
const PAYSLIP_SIGNATORY_TITLE = "Administrative Officer IV/OIC, Finance Section";
/*
 * Only for a paid record with no release stamp; a released payslip is signed by whoever released it
 * (resolvePayslipSignatory). The name is filled in from the API, which reads whoever currently holds
 * the HR Head role.
 */
const DEFAULT_PAYSLIP_SIGNATORY = { name: "", title: PAYSLIP_SIGNATORY_TITLE };
/* The only form employee_signature.php stores an e-signature in. */
const SIGNATURE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;
const WORKING_DAYS_PER_MONTH = 22;
const WORKING_HOURS_PER_DAY = 8;
const CONTRACT_SERVICE_EMPLOYMENT_TYPE = "Contract of Service";
const CONTRACT_SERVICE_PREMIUM_RATE = 20;
const CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES = ["Premium", "Premium Pay", "Premium Percentage"];
const CONTRACT_SERVICE_HIDDEN_ALLOWANCE_NAMES = ["PERA", ...CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES];
const CONTRACT_SERVICE_DEDUCTION_ROWS = [
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

const PAYSLIP_ALL_DEDUCTION_ROWS = [
  { label: "GSIS Premium", aliases: ["GSIS", "GSIS Premium"] },
  { label: "PAG-IBIG Premium", aliases: ["HDMF", "Pag-IBIG", "PAG-IBIG", "PAG-IBIG Premium"] },
  { label: "PAG-IBIG MP2", aliases: ["PAG-IBIG MP2", "Pag-IBIG MP2", "MP2"] },
  { label: "PhilHealth Premium", aliases: ["PHIC", "PhilHealth", "PHILHEALTH", "PhilHealth Premium"] },
  { label: "Deduction from Previous Payroll", aliases: ["Deduction from Previous Payroll", "DEDUCTION PREVIOUS PAYROLL"] },
  { label: "Withholding Tax", aliases: ["Withholding Tax", "W-TAX", "Tax"] },
  { label: "Additional Withholding Tax (PBB 2020)", aliases: ["Additional Withholding Tax (PBB 2020)"] },
  { label: "Leave Without Pay (LWOP)", aliases: ["Leave Without Pay (LWOP)", "LWOP", "Absence Deduction"] },
  { label: "Pass Slip", aliases: ["Pass Slip", "Pass Slip Deduction"] },
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

// Keep aliases for omitted lines so charged items do not reappear as extra rows.
const OMITTED_PAYSLIP_DEDUCTION_LABELS = new Set([
  "Deduction from Previous Payroll",
  "Additional Withholding Tax (PBB 2020)",
  "GSIS Consolidated Loan",
  "GSIS UOLI 1",
  "GSIS UOLI 2",
  "GSIS UOLI 1 Loan",
  "GSIS UOLI 2 Loan",
  "GSIS Educational Loan",
  "PAG-IBIG Housing Loan",
  "GSIS Computer Loan",
]);
const PAYSLIP_DEDUCTION_ROWS = PAYSLIP_ALL_DEDUCTION_ROWS.filter(
  (row) => !OMITTED_PAYSLIP_DEDUCTION_LABELS.has(row.label)
);

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

/**
 * Who released the payslip, as payslip.php reads it from the payroll row's release stamp. The
 * signature image only comes with a single-payslip read, which every view, print and download makes
 * first; the month's roster carries the name and role alone.
 */
function normalizeReleasedBy(value) {
  const name = String(value?.name ?? "").trim();

  if (!name) {
    return null;
  }

  const signatureDataUrl = String(value?.signatureDataUrl ?? "").trim();

  return {
    name,
    role: String(value?.role ?? "").trim(),
    signatureDataUrl: SIGNATURE_DATA_URL_PATTERN.test(signatureDataUrl) ? signatureDataUrl : "",
  };
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
    position: String(employee.position ?? "").trim(),
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
    passSlipCount: parseAmount(employee.passSlipCount),
    undertimeHours: parseAmount(employee.undertimeHours),
    lateHours: parseAmount(employee.lateHours),
    absenceDays: parseAmount(employee.absenceDays),
    attendanceRenderedMinutes: parseAmount(employee.attendanceRenderedMinutes),
    attendanceDaysWorked: parseAmount(employee.attendanceDaysWorked),
    attendanceLateMinutes: parseAmount(employee.attendanceLateMinutes),
    attendanceUndertimeMinutes: parseAmount(employee.attendanceUndertimeMinutes),
    attendanceExpectedWorkdays: parseAmount(employee.attendanceExpectedWorkdays ?? employee.expectedWorkdays),
    attendanceLeaveDays: parseAmount(employee.attendanceLeaveDays),
    attendanceSummarySource: String(employee.attendanceSummarySource ?? "").trim(),
    hasAttendanceCoverage: Boolean(employee.hasAttendanceCoverage),
    withholdingTaxBase: parseAmount(employee.withholdingTaxBase),
    overtimePay: parseAmount(employee.overtimePay),
    sss: parseAmount(employee.sss),
    allowanceItems: normalizeLineItems(employee.allowanceItems),
    deductionItems: normalizeLineItems(employee.deductionItems),
    releasedBy: normalizeReleasedBy(employee.releasedBy),
    isPaid: paidPayrollId !== "" || paidPayrollStatus.toLowerCase() === "paid",
  };
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

function buildPeriodAmounts(employee, netPay, { showZero = false } = {}) {
  const start = parseDateValue(employee.startDate);
  const end = parseDateValue(employee.endDate || employee.paidPayrollDate);
  const payPeriod = String(employee.payPeriod || "").toLowerCase();

  if (!start || !end || (netPay <= 0 && !showZero)) {
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

/**
 * Without attendance coverage the payroll charges pass-slip hours as "Undertime Deduction" (see
 * payroll_apply_automatic_calculations). The slip prints that amount on its Pass Slip line instead,
 * the same way the Contract-of-Service layout does, unless an explicit pass-slip item exists.
 */
function relabelPassSlipDeductionItems(employee = {}) {
  const items = employee.deductionItems || [];
  const hasExplicitPassSlip = getDeductionAmount(employee, ["Pass Slip", "Pass Slip Deduction"]) > 0;

  if (employee.hasAttendanceCoverage || hasExplicitPassSlip) {
    return items;
  }

  return items.map((item) => (
    normalizeKey(item.name) === normalizeKey("Undertime Deduction") ? { ...item, name: "Pass Slip" } : item
  ));
}

function buildPayslipDeductions(employee = {}) {
  const standardKeys = new Set();
  PAYSLIP_ALL_DEDUCTION_ROWS.forEach((row) => {
    row.aliases.forEach((alias) => standardKeys.add(normalizeKey(alias)));
  });

  const deductionItems = relabelPassSlipDeductionItems(employee);
  const standardRows = PAYSLIP_DEDUCTION_ROWS.map((row) => ({
    label: row.label,
    value: getLineItemAmount(deductionItems, row.aliases),
  }));
  const extraRows = deductionItems
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

function getContractServiceDaysRendered(employee = {}) {
  if (employee.attendanceSummarySource === "attendance") {
    return Math.max(roundAmount(employee.attendanceDaysWorked), 0);
  }

  const renderedMinutes = parseAmount(employee.attendanceRenderedMinutes);

  if (renderedMinutes > 0) {
    return roundAmount(renderedMinutes / (WORKING_HOURS_PER_DAY * 60));
  }

  return 0;
}

/**
 * True only when the refreshed DTR summary says the employee rendered no days in the period.
 * A payslip with no days worked carries no deductions and no take-home pay. Rows that have not
 * been refreshed from attendance yet simply lack the figure, so they are never treated as zero.
 */
function hasNoDaysWorked(employee = {}) {
  return employee.attendanceSummarySource === "attendance" && parseAmount(employee.attendanceDaysWorked) <= 0;
}

function getContractServiceDailyRate(employee = {}) {
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

/*
 * A released payslip is signed by whoever released it -- the Cashier whose Mark as Paid stamped the
 * payroll row -- with their e-signature over the name and their role under it. A paid record with no
 * release stamp keeps the signatory the roster request returned.
 */
function resolvePayslipSignatory(employee = {}, signatory = DEFAULT_PAYSLIP_SIGNATORY) {
  const releasedBy = employee.releasedBy;

  if (releasedBy?.name) {
    return {
      signatoryName: releasedBy.name,
      signatoryTitle: releasedBy.role || "",
      signatureDataUrl: releasedBy.signatureDataUrl || "",
    };
  }

  return {
    signatoryName: String(signatory?.name || ""),
    signatoryTitle: String(signatory?.title || PAYSLIP_SIGNATORY_TITLE),
    signatureDataUrl: "",
  };
}

function buildContractServicePayslip(employee = {}, signatory = DEFAULT_PAYSLIP_SIGNATORY) {
  const daysRendered = getContractServiceDaysRendered(employee);
  const dailyRate = getContractServiceDailyRate(employee);
  const periodSalary = daysRendered > 0 && dailyRate > 0
    ? roundAmount(daysRendered * dailyRate)
    : 0;
  const premiumUnit = roundAmount(dailyRate * (CONTRACT_SERVICE_PREMIUM_RATE / 100));
  const storedPremiumTotal = getAllowanceAmount(employee, CONTRACT_SERVICE_PREMIUM_ALLOWANCE_NAMES);
  const premiumTotal = daysRendered > 0
    ? (storedPremiumTotal > 0 ? storedPremiumTotal : roundAmount(premiumUnit * daysRendered))
    : 0;
  const additionalSalary = roundAmount(getContractServiceAdditionalSalary(employee));
  const grossPay = roundAmount(periodSalary + premiumTotal + additionalSalary);
  const noDaysWorked = hasNoDaysWorked(employee);
  const deductions = noDaysWorked
    ? CONTRACT_SERVICE_DEDUCTION_ROWS.map((row) => ({ label: row.label, value: 0 }))
    : buildContractServiceDeductions(employee);
  const totalDeductions = noDaysWorked
    ? 0
    : roundAmount(deductions.reduce((total, item) => total + parseAmount(item.value), 0));
  const netPay = noDaysWorked ? 0 : roundAmount(grossPay - totalDeductions);
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
    ...resolvePayslipSignatory(employee, signatory),
  };
}

export { buildContractServicePayslip, buildSamplePayslip, getContractServiceDaysRendered };

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
  const noDaysWorked = hasNoDaysWorked(employee);
  const totalDeductions = noDaysWorked ? 0 : parseAmount(employee.paidTotalDeduction);
  const netPay = noDaysWorked
    ? 0
    : parseAmount(employee.paidNetPay) || Math.max(grossPay - totalDeductions, 0);
  // With no days worked the deduction lines stay on the slip, each printed as 0.00.
  const deductions = noDaysWorked
    ? PAYSLIP_DEDUCTION_ROWS.map((row) => ({ label: row.label, value: 0 }))
    : buildPayslipDeductions(employee);

  return {
    office: PAYSLIP_OFFICE,
    period: formatPayslipPeriod(employee),
    employee: [employee.employeeId, employee.fullName || "Selected Employee"].filter(Boolean).join(" "),
    earnings: [
      { label: "MONTHLY SALARY", value: salaryAmount },
      { label: "ACA/PERA", value: pera },
      ...extraEarnings,
    ],
    deductions,
    totalDeductions,
    netPay,
    periodAmounts: buildPeriodAmounts(employee, netPay, { showZero: noDaysWorked }),
    ...resolvePayslipSignatory(employee, signatory),
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

/*
 * The block under "Certified true and correct", in step with payslip_signature_html() in
 * payslip.php: the e-signature when the signer has one, the name, and the title or role under it.
 * `signed` pulls the block up into the space a handwritten signature would otherwise take.
 */
function buildPayslipSignatureHtml(data) {
  const signatureHtml = data.signatureDataUrl
    ? `<img class="signature-image" src="${escapeHtml(data.signatureDataUrl)}" alt="" />`
    : "";

  return `<div class="signature${data.signatureDataUrl ? " signed" : ""}">${signatureHtml}<div class="signature-name">${escapeHtml(data.signatoryName)}</div><div class="signature-title">${escapeHtml(data.signatoryTitle)}</div></div>`;
}

function buildContractServicePayslipDownloadHtml(data) {
  const titleHtml = escapeHtml(data.title).replace(" FOR THE PERIOD ", " FOR THE<br />PERIOD ");
  const rowHtml = (label, value) => `
    <div class="deduction-row">
      <span class="deduction-label">${escapeHtml(label)}</span>
      <span class="deduction-value">${escapeHtml(formatContractServiceMoney(value))}</span>
    </div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Payslip</title><style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#000;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:430px;min-height:620px;background:#fff;padding:38px 28px 28px;font-size:12px;line-height:1.2}.office{text-align:center;font-weight:700}.title{margin-top:14px;text-align:center;font-size:14px;line-height:1.35}.employee{margin-top:14px;font-weight:700}.pay-row{display:grid;grid-template-columns:132px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.pay-row .days{text-align:center}.pay-row .amount{text-align:right}.add-row{display:grid;grid-template-columns:42px 108px 16px 70px 16px 92px;align-items:end;column-gap:6px;line-height:1.25}.add-row .amount{text-align:right}.gross-line{border-top:1px solid #000;font-weight:700}.deductions{margin-top:1px}.deduction-title{line-height:1.25}.deduction-row{display:grid;grid-template-columns:118px 1fr;line-height:1.35}.deduction-label{padding-left:70px;white-space:nowrap}.deduction-value{text-align:right}.total-deductions{display:grid;grid-template-columns:1fr 44px 96px;align-items:end;margin-top:2px;line-height:1.25}.total-deductions .label{font-style:italic;text-align:center}.total-deductions .dash{text-align:center}.net-row{display:grid;grid-template-columns:1fr 96px;column-gap:8px;margin-top:18px;align-items:end}.net-row .label{font-size:14px;font-style:italic;font-weight:700;text-align:center}.net-row .value{border-top:1px solid #000;font-size:15px;font-style:italic;font-weight:700;text-align:right}.certify{margin-top:30px;text-align:center;font-size:11px}.signature{margin-top:30px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{font-size:11px}.signature.signed{margin-top:8px}.signature-image{display:block;max-width:170px;max-height:56px;margin:0 auto -6px}@media print{.page{padding:0}.slip{width:100%;min-height:auto}}
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
    ${buildPayslipSignatureHtml(data)}
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
    *{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#262626;font-family:Arial,sans-serif}.page{display:flex;justify-content:center;padding:16px}.slip{width:280px;border:1px solid #d4d4d4;background:#fafafa;padding:16px;font-size:11px}.header{margin-bottom:8px;border-bottom:2px solid #d4d4d4;padding-bottom:8px;text-align:center}.title{margin:2px 0;font-size:13px;font-weight:700}.period{font-style:italic}.employee{font-weight:700}.section{margin-top:10px}.row{display:flex;justify-content:space-between;line-height:1.35}.label{width:60%}.value{width:40%;text-align:right}.bold{font-weight:700}.topline{margin-top:2px;border-top:1px solid #262626;padding-top:2px}.deduction-title{margin:10px 0 4px;font-weight:700}.total{margin-top:10px;border-top:1px solid #262626;padding-top:6px}.net{margin-top:10px;border-top:1px solid #262626;padding-top:6px;font-size:13px}.net .value{margin-top:-2px;font-size:14px}.periods{margin-top:6px;padding-left:20px}.certify{margin-top:20px;text-align:center;font-size:10px;letter-spacing:.04em;text-transform:uppercase}.signature{margin-top:16px;text-align:center}.signature-name{font-weight:700;text-transform:uppercase}.signature-title{margin-top:2px}.signature.signed{margin-top:8px}.signature-image{display:block;max-width:150px;max-height:48px;margin:0 auto -4px}@media print{body{background:#fff}.page{padding:0}}
  </style></head><body><main class="page"><section class="slip">
    <div class="header"><div>${escapeHtml(data.office)}</div><div class="title">PAYSLIP</div><div class="period">${escapeHtml(data.period)}</div></div>
    <div class="employee">${escapeHtml(data.employee)}</div>
    <div class="section">${data.earnings.map((item) => rowHtml(item)).join("")}<div class="row bold topline"><span class="label"></span><span class="value">${escapeHtml(formatPayslipMoney(earningsTotal))}</span></div></div>
    <div class="section"><div class="deduction-title">DEDUCTIONS:</div>${data.deductions.map((item) => rowHtml(item)).join("")}</div>
    <div class="row bold total"><span class="label">TOTAL DEDUCTIONS</span><span class="value">${escapeHtml(formatPayslipMoney(data.totalDeductions))}</span></div>
    <div class="row bold net"><span class="label">NET TAKE HOME PAY</span><span class="value">${escapeHtml(formatPayslipMoney(data.netPay))}</span></div>
    <div class="periods">${data.periodAmounts.map((item) => rowHtml(item)).join("")}</div>
    <div class="certify">Certified true and correct</div>
    ${buildPayslipSignatureHtml(data)}
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

function openPayslipPrintWindow(html, existingWindow = null) {
  const printWindow = existingWindow || window.open("", "_blank", "width=900,height=700");

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
    <div className="document-preview-well flex justify-center bg-neutral-100 p-4">
      <div
        className="document-paper min-h-[620px] w-[430px] bg-white px-7 pb-7 pt-9 text-[12px] text-black"
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

        <div className={`${data.signatureDataUrl ? "mt-2" : "mt-7"} text-center`}>
          {data.signatureDataUrl ? (
            <img
              src={data.signatureDataUrl}
              alt={`E-signature of ${data.signatoryName}`}
              className="mx-auto -mb-1.5 block max-h-14 max-w-[170px]"
            />
          ) : null}
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
    <div className="document-preview-well flex justify-center bg-neutral-100 p-4">
      <div
        className="document-paper w-[280px] border border-neutral-300 bg-neutral-50 p-4 text-[11px] text-neutral-800"
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

        <div className={`${data.signatureDataUrl ? "mt-2" : "mt-4"} text-center`}>
          {data.signatureDataUrl ? (
            <img
              src={data.signatureDataUrl}
              alt={`E-signature of ${data.signatoryName}`}
              className="mx-auto -mb-1 block max-h-12 max-w-[150px]"
            />
          ) : null}
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
  return String(employee?.paidPayrollId || employee?.id || employee?.employeeId || "");
}

function getPayslipDetailDeductionItems(employee) {
  if (hasNoDaysWorked(employee || {})) {
    return [];
  }

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
  if (hasNoDaysWorked(employee || {})) {
    return 0;
  }

  if (isContractServiceEmployee(employee || {})) {
    return getPayslipDetailDeductionItems(employee)
      .reduce((total, item) => total + parseAmount(item.amount), 0);
  }

  return parseAmount(employee?.paidTotalDeduction);
}

function buildAttendanceSummaryRows(employee = {}) {
  return [
    ["Days Worked", employee.attendanceDaysWorked],
    ["Expected Workdays", employee.attendanceExpectedWorkdays],
    ["Leave Days", employee.attendanceLeaveDays],
    ["Absent Days", employee.absenceDays],
    ["Late Minutes", employee.attendanceLateMinutes],
    ...(isContractServiceEmployee(employee) ? [["Pass Slips", employee.passSlipCount]] : []),
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

function EmploymentTypeBadge({ value }) {
  const colors = value === "Regular"
    ? "border-emerald-200 bg-emerald-50 text-emerald-600"
    : value === CONTRACT_SERVICE_EMPLOYMENT_TYPE
      ? "border-amber-200 bg-amber-50 text-amber-600"
      : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${colors}`}>
      {value || "N/A"}
    </span>
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

function PayslipViewModal({ employee, peraAmount, signatory, onClose }) {
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
  const noDaysWorked = hasNoDaysWorked(employee || {});
  const detailNetPay = contractService || noDaysWorked ? data.netPay : employee?.paidNetPay;
  const allowanceItems = (employee?.allowanceItems || [])
    .filter((item) => parseAmount(item.amount) > 0)
    .filter((item) => !contractService || !CONTRACT_SERVICE_HIDDEN_ALLOWANCE_NAMES.map(normalizeKey).includes(normalizeKey(item?.name)));
  const earningsSalary = contractService
    ? data.periodSalary
    : data.earnings[0].value;
  const earningsGross = contractService ? data.grossPay : employee?.paidGrossPay;

  return (
    <Modal
      open={open}
      title={employee ? `Payslip Details - ${employee.fullName || employee.employeeId || "Employee"}` : "Payslip Details"}
      onClose={onClose}
      maxWidth="max-w-5xl"
      contentClassName="bg-slate-50"
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
                  ["Position", employee.position || "N/A"],
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
                  <span className="text-slate-500">{contractService ? "Salary for Days Worked" : "Basic Salary"}</span>
                  <span className="font-semibold text-slate-800">{formatCurrency(earningsSalary)}</span>
                </div>
                {allowanceItems.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex justify-between gap-4">
                    <span className="text-slate-500">{item.name || "Allowance"}</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
                  <span className="font-semibold text-slate-700">Gross Pay</span>
                  <span className="font-bold text-blue-700">{formatCurrency(earningsGross)}</span>
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
                  <p className="m-0 text-slate-500">
                    {noDaysWorked
                      ? "No deductions apply because no days were worked in this period."
                      : "No deduction breakdown available."}
                  </p>
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

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const DEFAULT_ROWS_PER_PAGE = "10";
const DEFAULT_PAYSLIP_FILTERS = {
  department: "",
  employmentType: "",
  payPeriod: "",
  search: "",
};
const FILTER_CONTROL_CLASS_NAME = "h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100";
/* How many month cards share the rail at each width; the gap is gap-4 (16px). */
const MONTH_CARD_WIDTH_CLASS_NAME = "basis-[78%] sm:basis-[calc(50%-8px)] lg:basis-[calc(33.333%-10.667px)] xl:basis-[calc(25%-12px)] 2xl:basis-[calc(20%-12.8px)]";

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(month) {
  const match = String(month ?? "").match(MONTH_KEY_PATTERN);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : null;
}

function formatMonthLabel(month) {
  const date = parseMonthKey(month);
  return date ? `${monthName(date)} ${date.getFullYear()}` : "";
}

function formatShortDate(value) {
  const date = parseDateValue(value);
  return date
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";
}

function formatPayrollPeriodRange(start, end) {
  if (!start || !end) {
    return "N/A";
  }

  const dayLabel = (date, withYear) => date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
  const sameYear = start.getFullYear() === end.getFullYear();

  return `${dayLabel(start, !sameYear)} - ${dayLabel(end, true)}`;
}

/**
 * The month cards, newest first. The API lists only months that have payroll, so the office's
 * current month is added even when empty: this month's run shows as in progress before its first
 * payslip exists. The badge describes the available payslips, which come only from paid payroll.
 * Unpaid payroll is counted separately so it does not change the status of released payslips.
 */
function buildPayslipPeriods(apiPeriods, currentMonth) {
  const periodMap = new Map();

  (Array.isArray(apiPeriods) ? apiPeriods : []).forEach((period) => {
    const month = String(period?.month ?? "");

    if (MONTH_KEY_PATTERN.test(month)) {
      periodMap.set(month, {
        month,
        payrollCount: parseAmount(period.payrollCount),
        paidCount: parseAmount(period.paidCount),
        employeeCount: parseAmount(period.employeeCount),
        generatedAt: String(period.generatedAt ?? ""),
      });
    }
  });

  if (MONTH_KEY_PATTERN.test(currentMonth) && !periodMap.has(currentMonth)) {
    periodMap.set(currentMonth, {
      month: currentMonth,
      payrollCount: 0,
      paidCount: 0,
      employeeCount: 0,
      generatedAt: "",
    });
  }

  return Array.from(periodMap.values())
    .sort((left, right) => right.month.localeCompare(left.month))
    .map((period) => ({
      ...period,
      pendingCount: Math.max(period.payrollCount - period.paidCount, 0),
      isPaid: period.paidCount > 0,
    }));
}

/** Opens on the newest month that has payslips to show, else on the current month. */
function pickDefaultMonth(periods, currentMonth) {
  return periods.find((period) => period.employeeCount > 0)?.month
    || currentMonth
    || periods[0]?.month
    || "";
}

function PayslipMonthStatus({ isPaid, showIcon = false }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold ${
        isPaid
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "bg-teal-50 text-teal-700"
      }`}
    >
      {showIcon && isPaid ? <CheckCircle2 size={13} /> : null}
      {isPaid ? "Paid" : "In Progress"}
    </span>
  );
}

function PayslipMonthCard({ period, selected, onSelect }) {
  const label = formatMonthLabel(period.month);

  return (
    <article
      data-month={period.month}
      className={`flex shrink-0 snap-start flex-col rounded-xl border p-4 transition ${MONTH_CARD_WIDTH_CLASS_NAME} ${
        selected
          ? "border-teal-500 bg-teal-50 shadow-sm ring-1 ring-teal-400"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600">
          <CalendarDays size={18} />
        </span>
        <div className="min-w-0">
          <h4 className="m-0 truncate text-sm font-bold text-slate-900">{label}</h4>
          <div className="mt-1.5">
            <PayslipMonthStatus isPaid={period.isPaid} />
          </div>
        </div>
      </div>

      <p className="m-0 mt-4 text-2xl font-bold leading-none text-slate-900">{period.employeeCount}</p>
      <p className="m-0 mt-1.5 text-sm text-slate-500">{period.employeeCount === 1 ? "Employee" : "Employees"}</p>
      <p className="m-0 mt-0.5 truncate text-sm text-slate-500">
        Generated: {formatShortDate(period.generatedAt) || "-"}
      </p>

      <button
        type="button"
        onClick={() => onSelect(period.month)}
        aria-pressed={selected}
        aria-label={`View ${label} payslips`}
        className={`mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-teal-200 ${
          selected
            ? "bg-teal-600 text-white hover:bg-teal-700"
            : "border border-slate-200 bg-slate-50 text-teal-700 hover:bg-slate-100"
        }`}
      >
        <Eye size={16} />
        View
      </button>
    </article>
  );
}

/**
 * Months scroll sideways, newest on the left. The arrows page through them, and swiping works on
 * touch screens because the rail is a plain scroll container with snap points.
 */
function PayslipMonthRail({ periods, selectedMonth, loading, onSelect }) {
  const railRef = useRef(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const updateEdges = useCallback(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }

    const atStart = rail.scrollLeft <= 4;
    const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4;
    setEdges((current) => (
      current.atStart === atStart && current.atEnd === atEnd ? current : { atStart, atEnd }
    ));
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [periods, updateEdges]);

  /*
   * A month picked from the Pay Period select may sit off-screen in the rail, so it is scrolled into
   * view. scrollIntoView() is avoided because it would also scroll the page up to the rail.
   */
  useEffect(() => {
    const rail = railRef.current;
    const card = selectedMonth ? rail?.querySelector(`[data-month="${selectedMonth}"]`) : null;
    if (!rail || !card) {
      return;
    }

    // The 4px matches the rail's p-1, so the selected card's ring is not clipped at the edge.
    const cardStart = Math.max(card.offsetLeft - 4, 0);
    const cardEnd = card.offsetLeft + card.offsetWidth + 4;

    // Plain scrollLeft writes animate too: the rail's scroll-smooth class applies to them.
    if (cardStart < rail.scrollLeft) {
      rail.scrollLeft = cardStart;
    } else if (cardEnd > rail.scrollLeft + rail.clientWidth) {
      rail.scrollLeft = cardEnd - rail.clientWidth;
    }
  }, [periods, selectedMonth]);

  const scrollByPage = (direction) => {
    const rail = railRef.current;
    if (rail) {
      rail.scrollLeft += direction * rail.clientWidth;
    }
  };

  // Phones swipe the rail, so the arrows give their width back to the cards there.
  const arrowClassName = "hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:grid";

  return (
    /* flex-nowrap opts out of tailwind.css's phone rule that wraps every flex row. */
    <div className="mt-5 flex flex-nowrap items-center gap-2">
      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        disabled={edges.atStart}
        aria-label="Show newer months"
        className={arrowClassName}
      >
        <ChevronLeft size={18} />
      </button>

      <div
        ref={railRef}
        onScroll={updateEdges}
        className="relative flex min-w-0 flex-1 flex-nowrap snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {loading && periods.length === 0
          ? Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className={`h-[214px] shrink-0 animate-pulse rounded-xl border border-slate-200 bg-slate-100 ${MONTH_CARD_WIDTH_CLASS_NAME}`}
            />
          ))
          : periods.map((period) => (
            <PayslipMonthCard
              key={period.month}
              period={period}
              selected={period.month === selectedMonth}
              onSelect={onSelect}
            />
          ))}
      </div>

      <button
        type="button"
        onClick={() => scrollByPage(1)}
        disabled={edges.atEnd}
        aria-label="Show older months"
        className={arrowClassName}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function PayslipMonthStat({ icon: Icon, label, value, tone = "accent", loading = false }) {
  const tones = {
    accent: {
      tile: "bg-teal-50 text-teal-600",
      value: "text-slate-900",
    },
    emerald: {
      tile: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
      value: "text-emerald-700 dark:text-emerald-300",
    },
  };
  const toneClassNames = tones[tone] || tones.accent;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${toneClassNames.tile}`}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-xs text-slate-500">{label}</p>
        {loading ? (
          <span className="mt-1.5 block h-4 w-24 animate-pulse rounded bg-slate-200" />
        ) : (
          <p className={`m-0 mt-0.5 truncate text-sm font-bold ${toneClassNames.value}`}>{value}</p>
        )}
      </div>
    </div>
  );
}

export default function PayslipWorkspace({ mode = "admin" }) {
  const isEmployeeMode = mode === "employee";
  const [showArchived, setShowArchived] = useState(false);
  const [canArchive, setCanArchive] = useState(false);
  const [selectedPayslips, setSelectedPayslips] = useState(() => new Set());
  const [archiving, setArchiving] = useState(false);
  const [apiEmployees, setApiEmployees] = useState([]);
  const [peraAmount, setPeraAmount] = useState(DEFAULT_PERA_AMOUNT);
  const [signatory, setSignatory] = useState(DEFAULT_PAYSLIP_SIGNATORY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [periods, setPeriods] = useState([]);
  const [periodsLoading, setPeriodsLoading] = useState(!isEmployeeMode);
  const [periodsError, setPeriodsError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_PAYSLIP_FILTERS }));
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [viewedEmployee, setViewedEmployee] = useState(null);
  const [openingPayslipKey, setOpeningPayslipKey] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [currentPage, setCurrentPage] = useState(1);
  const [downloadingPayslipKey, setDownloadingPayslipKey] = useState("");
  /*
   * The month also lives in a ref because the auto-refresh tick reads it after awaiting the month
   * list, by which time another card may have been clicked. Each row request takes a sequence
   * number, so a slow response for the month just left cannot land on top of the one picked.
   */
  const selectedMonthRef = useRef("");
  const rowsRequestRef = useRef(0);

  const loadRows = useCallback(async (month, { background = false } = {}) => {
    const requestId = rowsRequestRef.current + 1;
    rowsRequestRef.current = requestId;

    if (!background) {
      setLoading(true);
    }

    try {
      const result = await fetchPayslipData(isEmployeeMode ? { scope: "self" } : { month, archived: showArchived ? 1 : 0 });

      if (rowsRequestRef.current !== requestId) {
        return;
      }

      setApiEmployees(Array.isArray(result.employees) ? result.employees : []);
      setCanArchive(Boolean(result.canArchive) && !isEmployeeMode);
      setPeraAmount(parseAmount(result.defaults?.pera || DEFAULT_PERA_AMOUNT));
      setSignatory({
        name: String(result.defaults?.signatory?.name || ""),
        title: String(result.defaults?.signatory?.title || PAYSLIP_SIGNATORY_TITLE),
      });
      setError("");
    } catch (requestError) {
      if (!background && rowsRequestRef.current === requestId) {
        setError(requestError.response?.data?.message || "Unable to load payslip data.");
      }
    } finally {
      if (rowsRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [isEmployeeMode, showArchived]);

  const loadPayslipData = useCallback(async ({ background = false } = {}) => {
    if (isEmployeeMode) {
      await loadRows("", { background });
      return;
    }

    try {
      const result = await fetchPayslipPeriods({ archived: showArchived ? 1 : 0 });
      const currentMonth = MONTH_KEY_PATTERN.test(String(result.currentMonth ?? ""))
        ? String(result.currentMonth)
        : monthKeyFromDate(new Date());
      const nextPeriods = buildPayslipPeriods(result.periods, currentMonth);

      setPeriods(nextPeriods);
      setPeriodsError("");

      if (!selectedMonthRef.current) {
        selectedMonthRef.current = pickDefaultMonth(nextPeriods, currentMonth);
        setSelectedMonth(selectedMonthRef.current);
      }
    } catch (requestError) {
      if (!background) {
        setPeriodsError(requestError.response?.data?.message || "Unable to load payslip months.");
      }

      if (!selectedMonthRef.current) {
        const currentMonth = monthKeyFromDate(new Date());
        selectedMonthRef.current = currentMonth;
        setSelectedMonth(currentMonth);
        setPeriods(buildPayslipPeriods([], currentMonth));
      }
    } finally {
      setPeriodsLoading(false);
    }

    await loadRows(selectedMonthRef.current, { background });
  }, [isEmployeeMode, loadRows, showArchived]);

  /** Attendance is included because the payslip's days-worked summary is refreshed from the DTR. */
  useAutoRefreshOnChange(loadPayslipData, { topics: ["payslip", "payroll", "employee", "attendance"], refreshOnMount: false });

  const payslipRows = useMemo(() => (
    apiEmployees
      .map(normalizeEmployee)
      .filter((employee) => employee.isPaid)
      /*
       * My Payslip Records reads newest first. A month's roster reads by name, the way the payroll
       * desk looks people up, with a person's later cut-off ahead of the earlier one.
       */
      .sort((left, right) => (
        isEmployeeMode
          ? String(right.paidPayrollDate || "").localeCompare(String(left.paidPayrollDate || ""))
          : String(left.fullName || "").localeCompare(String(right.fullName || ""))
            || String(right.paidPayrollDate || "").localeCompare(String(left.paidPayrollDate || ""))
      ))
  ), [apiEmployees, isEmployeeMode]);

  /*
   * Divisions and employment statuses come from the database. The statuses go through the same
   * normalization the rows do ("Contractual" reads as Contract of Service), so a picked type matches.
   * Cut-offs have no table of their own; they are the pay periods the month's payroll was run for.
   */
  const { divisions: databaseDivisions, employmentStatuses } = useOrganizationFilterOptions({ enabled: !isEmployeeMode });
  const filterOptions = useMemo(() => ({
    departments: databaseDivisions,
    employmentTypes: Array.from(new Set(employmentStatuses.map(normalizeEmploymentType).filter(Boolean))).sort(),
    payPeriods: Array.from(new Set(payslipRows.map((employee) => employee.payPeriod).filter(Boolean))).sort(),
  }), [databaseDivisions, employmentStatuses, payslipRows]);
  /* A month run as 1st Half and 2nd Half lists a person twice, so only then is the cut-off shown. */
  const showCutOff = !isEmployeeMode && filterOptions.payPeriods.length > 1;

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

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.month === selectedMonth) || null,
    [periods, selectedMonth]
  );
  const selectedMonthLabel = formatMonthLabel(selectedMonth);

  /* Describes the whole month, so it ignores the search and filters below it. */
  const monthSummary = useMemo(() => {
    const employeeKeys = new Set();
    let start = null;
    let end = null;
    let totalGrossPay = 0;
    let totalNetPay = 0;

    payslipRows.forEach((employee) => {
      employeeKeys.add(employee.id || employee.employeeId || employee.fullName);
      totalGrossPay += parseAmount(employee.paidGrossPay);
      totalNetPay += parseAmount(employee.paidNetPay);

      const rowEnd = parseDateValue(employee.endDate || employee.paidPayrollDate);
      const rowStart = parseDateValue(employee.startDate) || rowEnd;

      if (rowStart && (!start || rowStart < start)) {
        start = rowStart;
      }

      if (rowEnd && (!end || rowEnd > end)) {
        end = rowEnd;
      }
    });

    const monthStart = parseMonthKey(selectedMonth);
    if ((!start || !end) && monthStart) {
      start = monthStart;
      end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    }

    return {
      employeeCount: employeeKeys.size,
      totalGrossPay: roundAmount(totalGrossPay),
      totalNetPay: roundAmount(totalNetPay),
      periodLabel: formatPayrollPeriodRange(start, end),
    };
  }, [payslipRows, selectedMonth]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRows, pageSize, safePage]
  );

  useEffect(() => {
    setSelectedPayslips(new Set());
    setExpandedRows(new Set());
    setCurrentPage(1);
    setViewedEmployee(null);
    setApiEmployees([]);
    loadPayslipData();
  }, [showArchived, loadPayslipData]);

  const togglePayslipSelection = (employee) => {
    const key = getEmployeeKey(employee);
    setSelectedPayslips((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allPageSelected = paginatedRows.length > 0
    && paginatedRows.every((employee) => selectedPayslips.has(getEmployeeKey(employee)));
  const togglePageSelection = () => {
    setSelectedPayslips((current) => {
      const next = new Set(current);
      paginatedRows.forEach((employee) => {
        const key = getEmployeeKey(employee);
        if (allPageSelected) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  };

  const handleArchivePayslips = async (ids) => {
    if (archiving || !canArchive || ids.length === 0) return;
    setArchiving(true);
    try {
      await setPayslipsArchived(ids, !showArchived);
      setSelectedPayslips(new Set());
      setViewedEmployee(null);
      toast.success(`${ids.length} payslip${ids.length === 1 ? "" : "s"} ${showArchived ? "restored" : "archived"}.`);
      await loadPayslipData({ background: true });
    } catch (archiveError) {
      toast.error(archiveError.response?.data?.message || "Unable to update payslip archive.");
    } finally {
      setArchiving(false);
    }
  };

  const renderArchiveAction = (employee) => canArchive ? (
    <ActionIconButton
      label={showArchived ? "Restore payslip" : "Archive payslip"}
      icon={showArchived ? faRotateLeft : faArchive}
      tone={showArchived ? "restore" : "archive"}
      text={showArchived ? "Restore" : "Archive"}
      disabled={archiving}
      onClick={() => handleArchivePayslips([getEmployeeKey(employee)])}
    />
  ) : null;

  const renderPayslipCheckbox = (employee) => (
    <input
      type="checkbox"
      aria-label={`Select payslip for ${employee.fullName || employee.employeeId}, ${employee.periodLabel || formatDate(employee.paidPayrollDate)}`}
      checked={selectedPayslips.has(getEmployeeKey(employee))}
      disabled={archiving}
      onChange={() => togglePayslipSelection(employee)}
    />
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, rowsPerPage]);

  const handleFilterChange = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const filtersAreDefault = rowsPerPage === DEFAULT_ROWS_PER_PAGE
    && Object.keys(DEFAULT_PAYSLIP_FILTERS).every((name) => filters[name] === DEFAULT_PAYSLIP_FILTERS[name]);

  /* Reset clears the filters inside the month; the month itself stays where the cards put it. */
  const handleResetFilters = () => {
    setFilters({ ...DEFAULT_PAYSLIP_FILTERS });
    setRowsPerPage(DEFAULT_ROWS_PER_PAGE);
    setExpandedRows(new Set());
  };

  const handleSelectMonth = (month) => {
    if (!month || month === selectedMonthRef.current) {
      return;
    }

    selectedMonthRef.current = month;
    setSelectedMonth(month);
    // Cleared so the last month's rows never show under the new month's heading while it loads.
    setApiEmployees([]);
    setSelectedPayslips(new Set());
    setExpandedRows(new Set());
    // A cut-off picked in one month may not exist in the next.
    setFilters((current) => ({ ...current, payPeriod: "" }));
    setCurrentPage(1);
    loadRows(month);
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

  const fetchCurrentPayslip = useCallback(async (employee) => {
    const payrollId = String(employee?.paidPayrollId || "").trim();
    if (!payrollId) {
      return employee;
    }

    const result = await fetchPayslipRecord(
      payrollId,
      isEmployeeMode ? { scope: "self" } : { archived: showArchived ? 1 : 0 }
    );
    const currentEmployee = Array.isArray(result.employees) ? result.employees[0] : null;
    if (!currentEmployee) {
      throw new Error("Unable to load the released payslip.");
    }

    setApiEmployees((current) => current.map((item) => (
      String(item?.paidPayrollId || "") === payrollId ? currentEmployee : item
    )));

    return normalizeEmployee(currentEmployee);
  }, [isEmployeeMode, showArchived]);

  const handleViewPayslip = async (employee) => {
    const key = getEmployeeKey(employee);
    setOpeningPayslipKey(key);

    try {
      setViewedEmployee(await fetchCurrentPayslip(employee));
    } catch (viewError) {
      toast.error(viewError.response?.data?.message || viewError.message || "Unable to open the payslip.");
    } finally {
      setOpeningPayslipKey("");
    }
  };

  const handleDownloadPayslip = async (employee) => {
    if (!employee?.isPaid) {
      toast.error("Payslip can only be downloaded after payroll is marked as Paid.");
      return;
    }

    const key = getEmployeeKey(employee);
    setDownloadingPayslipKey(key);

    try {
      const currentEmployee = await fetchCurrentPayslip(employee);
      const currentHtml = buildPayslipDownloadHtml(currentEmployee, peraAmount, signatory);
      await downloadPayslipPdf(currentHtml, getPayslipFileName(currentEmployee, "pdf"));
      toast.success("Payslip PDF downloaded.");
    } catch (downloadError) {
      toast.error(downloadError?.message || "Unable to download the payslip PDF.");
    } finally {
      setDownloadingPayslipKey("");
    }
  };

  const handlePrintPayslip = async (employee) => {
    if (!employee?.isPaid) {
      toast.error("Payslip can only be printed after payroll is marked as Paid.");
      return;
    }

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      toast.error("Allow pop-ups to print the payslip.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write('<!doctype html><title>Loading payslip</title><p style="font-family:Arial,sans-serif;padding:24px">Loading current attendance summary...</p>');
    printWindow.document.close();

    try {
      const currentEmployee = await fetchCurrentPayslip(employee);
      openPayslipPrintWindow(
        buildPayslipDownloadHtml(currentEmployee, peraAmount, signatory),
        printWindow
      );
    } catch (printError) {
      printWindow.close();
      toast.error(printError?.message || "Unable to open the payslip print form.");
    }
  };

  const emptyState = (() => {
    if (isEmployeeMode) {
      return {
        title: "No paid payslip records found",
        description: "Payslips will appear after payroll is marked as paid.",
      };
    }

    if (payslipRows.length > 0) {
      return {
        title: "No payslips match these filters",
        description: "Clear the search or choose a different division, type or cut-off.",
      };
    }

    return {
      title: `No payslips for ${selectedMonthLabel || "this month"} yet`,
      description: "Payslips appear here once the month's payroll is marked as paid.",
    };
  })();

  const renderSearchField = (placeholder, label, hideLabel = false) => (
    <label className="block">
      <span className={hideLabel ? "sr-only" : "mb-1.5 block text-sm font-semibold text-slate-700"}>{label}</span>
      <span className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={filters.search}
          onChange={(event) => handleFilterChange("search", event.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        />
      </span>
    </label>
  );

  const renderRowsPerPage = () => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">Rows Per Page</span>
      <select
        value={rowsPerPage}
        onChange={(event) => setRowsPerPage(event.target.value)}
        className={FILTER_CONTROL_CLASS_NAME}
      >
        <option value="10">10 rows</option>
        <option value="20">20 rows</option>
        <option value="50">50 rows</option>
        <option value="100">100 rows</option>
        <option value="200">200 rows</option>
      </select>
    </label>
  );

  const renderFilters = () => {
    if (isEmployeeMode) {
      /*
       * My Payslip Records shows one person's own payslips, so the period picker was dropped;
       * the search box still narrows by payroll period, matching on the period label.
       */
      return (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_120px]">
          {renderSearchField("Search payroll period, position", "Search Payslips")}
          {renderRowsPerPage()}
        </div>
      );
    }

    return (
      <div
        className={`mt-5 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 ${
          showCutOff
            ? "xl:grid-cols-[minmax(200px,1.4fr)_repeat(4,minmax(130px,1fr))_minmax(110px,0.6fr)_auto]"
            : "xl:grid-cols-[minmax(220px,1.5fr)_repeat(3,minmax(150px,1fr))_minmax(110px,0.6fr)_auto]"
        }`}
      >
        <div className="sm:col-span-2 lg:col-span-3 xl:col-span-1">
          {renderSearchField("Search employee (ID, name, division)...", "Search payslips", true)}
        </div>

        {[
          ["department", "Division", "All divisions", filterOptions.departments],
          ["employmentType", "Employment Type", "All types", filterOptions.employmentTypes],
        ].map(([name, label, placeholder, options]) => (
          <label key={name} className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
            <select
              value={filters[name]}
              onChange={(event) => handleFilterChange(name, event.target.value)}
              className={FILTER_CONTROL_CLASS_NAME}
            >
              <option value="">{placeholder}</option>
              {options.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Pay Period</span>
          <span className="relative block">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <select
              value={selectedMonth}
              onChange={(event) => handleSelectMonth(event.target.value)}
              className={`${FILTER_CONTROL_CLASS_NAME} pl-9`}
            >
              {periods.map((period) => (
                <option key={period.month} value={period.month}>{formatMonthLabel(period.month)}</option>
              ))}
            </select>
          </span>
        </label>

        {showCutOff ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Cut-off</span>
            <select
              value={filters.payPeriod}
              onChange={(event) => handleFilterChange("payPeriod", event.target.value)}
              className={FILTER_CONTROL_CLASS_NAME}
            >
              <option value="">Whole month</option>
              {filterOptions.payPeriods.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        ) : null}

        {renderRowsPerPage()}

        <button
          type="button"
          onClick={handleResetFilters}
          disabled={filtersAreDefault}
          className="mt-[26px] inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 xl:w-auto"
        >
          <RotateCcw size={15} />
          Reset
        </button>
      </div>
    );
  };

  const renderRows = () => {
    if (loading) {
      return Array.from({ length: 4 }).map((_, index) => (
        <tr key={index} className="animate-pulse border-b border-slate-100">
          <td colSpan={canArchive ? 11 : 10} className="px-3 py-3">
            <div className="h-5 rounded bg-slate-200" />
          </td>
        </tr>
      ));
    }

    if (paginatedRows.length === 0) {
      return (
        <tr>
          <td colSpan={canArchive ? 11 : 10} className="px-4 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
              <FileText size={20} />
            </div>
            <p className="m-0 mt-3 text-sm font-semibold text-slate-700">{emptyState.title}</p>
            <p className="m-0 mt-1 text-sm text-slate-500">{emptyState.description}</p>
          </td>
        </tr>
      );
    }

    return paginatedRows.flatMap((employee) => {
      const key = getEmployeeKey(employee);
      const expanded = expandedRows.has(key);
      const downloading = downloadingPayslipKey !== "" && downloadingPayslipKey === key;
      const opening = openingPayslipKey !== "" && openingPayslipKey === key;

      return [
        <tr key={key} className="border-b border-slate-100 transition hover:bg-slate-50">
          {canArchive ? <td className="px-3 py-3">{renderPayslipCheckbox(employee)}</td> : null}
          <td className="px-3 py-3 text-sm text-slate-600">{employee.employeeId || "N/A"}</td>
          <td className="px-3 py-3 text-sm text-slate-800">
            <div className="font-semibold text-slate-900">{employee.fullName || "Employee"}</div>
            {showCutOff && employee.payPeriod ? (
              <div className="text-xs text-slate-500">{employee.payPeriod}</div>
            ) : null}
          </td>
          <td className="px-3 py-3 text-sm text-slate-600">{employee.department || "Unassigned"}</td>
          <td className="px-3 py-3 text-sm text-slate-600">{employee.position || "N/A"}</td>
          <td className="px-3 py-3"><EmploymentTypeBadge value={employee.employmentType} /></td>
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
            <ActionsMenu>
              {renderArchiveAction(employee)}
              <ActionIconButton
                label="View payslip"
                icon={faEye}
                tone="view"
                text={opening ? "Opening" : "View"}
                onClick={() => handleViewPayslip(employee)}
                disabled={opening}
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
            </ActionsMenu>
          </td>
        </tr>,
        expanded ? (
          <tr key={`${key}-deductions`} className="border-b border-slate-100">
            <td colSpan={canArchive ? 11 : 10} className="bg-white px-3 py-3">
              <PayslipDeductionBreakdown employee={employee} />
            </td>
          </tr>
        ) : null,
      ].filter(Boolean);
    });
  };

  /*
   * The card face of the same rows. Nine columns still need a wide table, so this one keeps cards
   * all the way up to `xl` rather than the `lg` the other workspaces use — a 1024px window still
   * cannot show that table without a long sideways drag.
   *
   * In employee mode the ID, name, division and position columns all describe the one person
   * reading the screen, so the card drops them and leads with the payroll period.
  */
  const renderCard = (employee) => {
    const key = getEmployeeKey(employee);
    const expanded = expandedRows.has(key);
    const downloading = downloadingPayslipKey !== "" && downloadingPayslipKey === key;
    const opening = openingPayslipKey !== "" && openingPayslipKey === key;

    return {
      title: employee.periodLabel || formatDate(employee.paidPayrollDate),
      selection: canArchive ? renderPayslipCheckbox(employee) : null,
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
          { label: "Position", value: employee.position || "N/A" },
          { label: "Employment Type", value: <EmploymentTypeBadge value={employee.employmentType} /> },
        ]),
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
        <ActionsMenu>
          {renderArchiveAction(employee)}
          <ActionIconButton
            label="View payslip"
            icon={faEye}
            tone="view"
            text={opening ? "Opening" : "View"}
            onClick={() => handleViewPayslip(employee)}
            disabled={opening}
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
        </ActionsMenu>
      ),
    };
  };

  const renderResults = () => (
    <>
      {canArchive ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allPageSelected} disabled={archiving || loading || paginatedRows.length === 0} onChange={togglePageSelection} />
            Select this page
          </label>
          <button type="button" className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={archiving || loading || selectedPayslips.size === 0} onClick={() => handleArchivePayslips([...selectedPayslips])}>
            {archiving ? "Saving..." : `${showArchived ? "Restore" : "Archive"} Selected (${selectedPayslips.size})`}
          </button>
        </div>
      ) : null}
      <RecordCards
        className="mt-4 xl:hidden"
        /* One column: the deduction breakdown opens inside a card and needs the width. */
        gridClassName="grid gap-3"
        items={paginatedRows}
        itemKey={(employee) => getEmployeeKey(employee)}
        loading={loading}
        loadingCards={3}
        empty={{ icon: FileText, ...emptyState }}
        renderCard={renderCard}
      />

      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 xl:block">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                {canArchive ? (
                  <th className="border-b border-slate-200 px-3 py-3">
                    <input type="checkbox" aria-label="Select all payslips on this page" checked={allPageSelected} disabled={archiving || loading || paginatedRows.length === 0} onChange={togglePageSelection} />
                  </th>
                ) : null}
                {[
                  "Employee ID",
                  "Full Name",
                  "Division",
                  "Position",
                  "Employment Type",
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
    </>
  );

  const pendingCount = selectedPeriod?.pendingCount || 0;

  return (
    <div className="space-y-4">
      {isEmployeeMode ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">My Payslip Records</h3>
            <p className="m-0 mt-1 text-sm text-slate-500">Available payslips from paid payroll records.</p>
            {error ? <p className="m-0 mt-2 text-sm font-semibold text-rose-700">{error}</p> : null}
          </div>

          {renderFilters()}
          {renderResults()}
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
              <CalendarDays className="mt-0.5 shrink-0 text-teal-600" size={22} />
              <div className="min-w-0">
                <h3 className="m-0 text-lg font-bold text-slate-950">{showArchived ? "Archived Payslip Records" : "Payslip Records"}</h3>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  View and manage generated payslips by month. Select a period to see the list of employees.
                </p>
                {periodsError ? <p className="m-0 mt-2 text-sm font-semibold text-rose-700">{periodsError}</p> : null}
              </div>
              </div>
              {canArchive ? (
                <button
                  type="button"
                  className="ml-auto inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-blue-200 bg-white px-3 text-xs font-medium text-blue-600 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
                  disabled={archiving || loading}
                  onClick={() => {
                    rowsRequestRef.current += 1;
                    setShowArchived((current) => !current);
                  }}
                >
                  <Archive size={14} aria-hidden="true" />
                  {showArchived ? "Back to Payslips" : "Archived Payslips"}
                </button>
              ) : null}
            </div>

            <PayslipMonthRail
              periods={periods}
              selectedMonth={selectedMonth}
              loading={periodsLoading}
              onSelect={handleSelectMonth}
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="flex min-w-0 flex-nowrap items-start gap-3">
                <CalendarDays className="mt-0.5 shrink-0 text-teal-600" size={22} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="m-0 text-lg font-bold text-slate-950">
                      {selectedMonthLabel ? `Employee Payslips - ${selectedMonthLabel}` : "Employee Payslips"}
                    </h3>
                    {selectedMonth ? <PayslipMonthStatus isPaid={Boolean(selectedPeriod?.isPaid)} showIcon /> : null}
                  </div>
                  <p className="m-0 mt-1 text-sm text-slate-500">
                    {selectedMonthLabel
                      ? `Below are the employees included in the ${selectedMonthLabel} payroll.`
                      : "Select a month above to see its payslips."}
                    {pendingCount > 0
                      ? ` ${pendingCount} more payroll record${pendingCount === 1 ? " is" : "s are"} not paid yet, so ${pendingCount === 1 ? "its payslip is" : "their payslips are"} not listed.`
                      : ""}
                  </p>
                  {error ? <p className="m-0 mt-2 text-sm font-semibold text-rose-700">{error}</p> : null}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:shrink-0 2xl:grid-cols-[repeat(4,auto)] 2xl:gap-x-8">
                <PayslipMonthStat icon={CalendarDays} label="Payroll Period" value={monthSummary.periodLabel} loading={loading} />
                <PayslipMonthStat icon={Users} label="Total Employees" value={monthSummary.employeeCount} loading={loading} />
                <PayslipMonthStat icon={FileText} label="Total Gross Pay" value={formatCurrency(monthSummary.totalGrossPay)} loading={loading} />
                <PayslipMonthStat icon={Banknote} label="Total Net Pay" value={formatCurrency(monthSummary.totalNetPay)} tone="emerald" loading={loading} />
              </div>
            </div>

            {renderFilters()}
            {renderResults()}
          </section>
        </>
      )}

      <PayslipViewModal
        employee={viewedEmployee}
        peraAmount={peraAmount}
        signatory={signatory}
        onClose={() => setViewedEmployee(null)}
      />
    </div>
  );
}
