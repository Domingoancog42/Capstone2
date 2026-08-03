import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Filter,
  Plus,
  Search,
  Send,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { faBoxArchive, faCheck, faEye, faMoneyBillWave, faPaperPlane, faPen, faXmark } from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import Pagination from "../../components/UI/Pagination";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import PayrollDetailDrawer from "./PayrollDetailDrawer";
import {
  approvePayroll,
  archivePayrollRecord,
  bulkArchivePayroll,
  bulkApprovePayroll,
  bulkMarkPaid,
  bulkRejectPayroll,
  bulkSubmitForApproval,
  createPayroll,
  fetchPayrollRecords,
  markPayrollPaid,
  previewPayroll,
  rejectPayroll,
  submitPayrollForApproval,
  updatePayroll,
} from "../../services/payrollService";
import { fetchCashAdvanceRequests } from "../../services/cashAdvanceService";
import { fetchPassSlips } from "../../services/passSlipService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { currencyFormatter, numberFormatter } from "../../utils/format";

const daysFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PAYROLL_VIEWS = {
  generate: {
    title: "Create Payroll",
    description: "Create payroll batches, review computed totals, and manage active payroll processing in one government HRIS workspace.",
    showCreate: true,
    emptyTitle: "No payroll records yet",
    emptyMessage: "Create the first payroll record to start building the payroll registry.",
  },
  records: {
    title: "Payslip",
    description: "Review generated payslip entries, monitor statuses, and keep payroll details searchable and organized.",
    showCreate: false,
    emptyTitle: "No payslip records found",
    emptyMessage: "Payslip records will appear here after the first payroll is created.",
  },
  archived: {
    title: "Archived Payroll",
    description: "View archived payroll records kept for historical reference and audit review.",
    showCreate: false,
    emptyTitle: "No archived payroll records",
    emptyMessage: "Archived payroll items will be listed here once records are archived.",
  },
};

const PAY_PERIOD_OPTIONS = ["1st Half", "2nd Half", "Monthly"];
const ACTIVE_STATUS_OPTIONS = ["Draft", "Pending Approval", "Approved", "Rejected", "Paid"];
const DEFAULT_ROWS_PER_PAGE = 8;
const DEFAULT_PERA_AMOUNT = 2000;
const WORKING_DAYS_PER_MONTH = 22;
const WORKING_HOURS_PER_DAY = 8;
const REGULAR_OVERTIME_MULTIPLIER = 1.25;
const GENERATED_EMPLOYMENT_TYPE_OPTIONS = ["Contractual", "Regular"];
const ACTION_STATUS_VERIFY_DELAYS_MS = [500, 1000, 2000, 3000, 5000, 8000, 10000];

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function emptyGeneratedPayrollState() {
  return {
    payPeriod: "",
    startDate: "",
    endDate: "",
    search: "",
    division: "",
    employmentType: "",
  };
}

function resolvePeraAmount(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : DEFAULT_PERA_AMOUNT;
}

function inferPayPeriod(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) {
    return "";
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "";
  }

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    if (start.getDate() >= 16) {
      return "2nd Half";
    }

    if (end.getDate() <= 15) {
      return "1st Half";
    }
  }

  const differenceInDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (differenceInDays >= 27) {
    return "Monthly";
  }

  return start.getDate() >= 16 ? "2nd Half" : end.getDate() <= 15 ? "1st Half" : "Monthly";
}

function formatDateInput(year, monthIndex, day) {
  const month = String(monthIndex + 1).padStart(2, "0");
  const date = String(day).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

function getReferenceMonth(value) {
  const fallback = new Date();
  const date = value ? new Date(`${value}T00:00:00`) : fallback;

  return Number.isNaN(date.getTime())
    ? { year: fallback.getFullYear(), monthIndex: fallback.getMonth() }
    : { year: date.getFullYear(), monthIndex: date.getMonth() };
}

function getPayPeriodDateRange(period, referenceDate) {
  const { year, monthIndex } = getReferenceMonth(referenceDate);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();

  if (period === "1st Half") {
    return {
      startDate: formatDateInput(year, monthIndex, 1),
      endDate: formatDateInput(year, monthIndex, Math.min(15, lastDay)),
    };
  }

  if (period === "2nd Half") {
    return {
      startDate: formatDateInput(year, monthIndex, Math.min(16, lastDay)),
      endDate: formatDateInput(year, monthIndex, lastDay),
    };
  }

  if (period === "Monthly") {
    return {
      startDate: formatDateInput(year, monthIndex, 1),
      endDate: formatDateInput(year, monthIndex, lastDay),
    };
  }

  return {};
}

function normalizeEmploymentTypeLabel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized === "contractual") {
    return "Contractual";
  }

  if (normalized === "regular") {
    return "Regular";
  }

  return String(value ?? "").trim();
}

function emptyFormState(defaults = {}) {
  const peraAmount = resolvePeraAmount(defaults.pera);

  return {
    employeeRecordId: "",
    employeeId: "",
    employeeName: "",
    designation: "",
    division: "",
    basicSalary: "",
    payPeriod: "",
    startDate: "",
    endDate: "",
    overtimeHours: "0",
    overtimeRate: "0",
    overtimePay: "0",
    pera: String(peraAmount),
    travelAllowance: "0",
    salaryAdjustment: "0",
    otherAllowances: "0",
    lateDeduction: "0",
    absenceDeduction: "0",
    undertimeDeduction: "0",
    withholdingTax: "0",
    sss: "0",
    gsis: "0",
    hdmf: "0",
    phic: "0",
    manualCashAdvanceAdjustment: "0",
    laptopLoan: "0",
    otherDeductions: "0",
    bonusAmount: "0",
    status: "Draft",
    notes: "",
  };
}

function parseAmount(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

function calculateMonthlyHourlyRate(monthlySalary) {
  const salary = parseAmount(monthlySalary);
  return salary > 0 ? salary / WORKING_DAYS_PER_MONTH / WORKING_HOURS_PER_DAY : 0;
}

function calculateWithholdingTax(monthlyTaxableIncome) {
  const income = parseAmount(monthlyTaxableIncome);

  if (income <= 20833) {
    return 0;
  }

  if (income <= 33332) {
    return roundAmount((income - 20833) * 0.20);
  }

  if (income <= 66666) {
    return roundAmount(2500 + ((income - 33333) * 0.25));
  }

  if (income <= 166666) {
    return roundAmount(10833 + ((income - 66667) * 0.30));
  }

  if (income <= 666666) {
    return roundAmount(40833 + ((income - 166667) * 0.32));
  }

  return roundAmount(200833 + ((income - 666667) * 0.35));
}

function normalizeDateKey(value) {
  const text = String(value || "").trim();
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);

  if (isoMatch) {
    return isoMatch[1];
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isDateWithinRange(value, startDate, endDate) {
  const dateKey = normalizeDateKey(value);
  return Boolean(dateKey && startDate && endDate && dateKey >= startDate && dateKey <= endDate);
}

function isApprovedStatus(status) {
  return String(status || "").trim().toLowerCase() === "approved";
}

function timeToMinutes(value) {
  const [hours = "0", minutes = "0"] = String(value || "").split(":");
  const hourValue = Number.parseInt(hours, 10);
  const minuteValue = Number.parseInt(minutes, 10);

  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) {
    return null;
  }

  return (hourValue * 60) + minuteValue;
}

function calculatePassSlipHours(record = {}) {
  const departure = timeToMinutes(record.departureTime);
  const returned = timeToMinutes(record.timeReturned);

  if (departure === null || returned === null || returned <= departure) {
    return 0;
  }

  return roundAmount((returned - departure) / 60);
}

function getApprovedPassSlipHours(records = [], employeeRecordId, startDate, endDate) {
  const employeeKey = String(employeeRecordId || "");

  if (!employeeKey || !startDate || !endDate) {
    return 0;
  }

  return records.reduce((total, record) => {
    if (
      String(record.employeeRecordId || "") !== employeeKey
      || !isApprovedStatus(record.status)
      || !isDateWithinRange(record.passDate || record.dateFiled, startDate, endDate)
    ) {
      return total;
    }

    return total + calculatePassSlipHours(record);
  }, 0);
}

function getApprovedOvertimeHours(records = [], employeeRecordId, startDate, endDate) {
  const employeeKey = String(employeeRecordId || "");

  if (!employeeKey || !startDate || !endDate) {
    return 0;
  }

  return records.reduce((total, record) => {
    if (
      String(record.employeeRecordId || "") !== employeeKey
      || !isApprovedStatus(record.status)
      || !isDateWithinRange(record.workDate || record.overtimeDate || record.dateFiled, startDate, endDate)
    ) {
      return total;
    }

    return total + parseAmount(record.hourRequested ?? record.overtimeHours ?? record.hoursWorked ?? record.duration);
  }, 0);
}

function calculateAutomaticPayrollValues(form, passSlipRecords = [], overtimeRecords = []) {
  const hourlyRate = calculateMonthlyHourlyRate(form.basicSalary);
  const overtimeHours = roundAmount(getApprovedOvertimeHours(
    overtimeRecords,
    form.employeeRecordId,
    form.startDate,
    form.endDate
  ));
  const overtimeRate = roundAmount(hourlyRate * REGULAR_OVERTIME_MULTIPLIER);
  const undertimeHours = roundAmount(getApprovedPassSlipHours(
    passSlipRecords,
    form.employeeRecordId,
    form.startDate,
    form.endDate
  ));

  return {
    hourlyRate: roundAmount(hourlyRate),
    overtimeHours,
    overtimeRate,
    overtimePay: roundAmount(overtimeHours * hourlyRate * REGULAR_OVERTIME_MULTIPLIER),
    undertimeHours,
    undertimeDeduction: roundAmount(undertimeHours * hourlyRate),
    withholdingTax: calculateWithholdingTax(form.basicSalary),
  };
}

function formatAmountInput(value) {
  const parsed = parseAmount(value);
  return String(parsed);
}

function formatCurrency(value) {
  return currencyFormatter.format(parseAmount(value));
}

function getPayrollIdLabel(record = {}) {
  const id = Number(record.id);
  return Number.isFinite(id) && id > 0 ? `PR-${String(id).padStart(3, "0")}` : "N/A";
}

function statusBadgeClasses(status) {
  switch (status) {
    case "Pending Approval":
      return "border border-amber-200 bg-amber-50 text-amber-700";
    case "Approved":
      return "border border-blue-200 bg-blue-50 text-blue-700";
    case "Rejected":
      return "border border-rose-200 bg-rose-50 text-rose-700";
    case "Paid":
      return "border border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Archived":
      return "border border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border border-slate-200 bg-slate-100 text-slate-700";
  }
}

function normalizeRoleKey(user = {}) {
  return String(user?.roleKey || user?.role || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function buildPeriodLabel(record) {
  if (record.periodLabel) {
    return record.periodLabel;
  }

  if (!record.payPeriod) {
    return "Unspecified period";
  }

  return `${record.payPeriod} (${record.startDate || "N/A"} to ${record.endDate || "N/A"})`;
}

function buildFormState(record, defaults = {}) {
  if (!record) {
    return emptyFormState(defaults);
  }

  const peraAmount = parseAmount(record.pera) > 0
    ? parseAmount(record.pera)
    : resolvePeraAmount(defaults.pera);

  return {
    employeeRecordId: String(record.employeeRecordId || ""),
    employeeId: record.employeeId || "",
    employeeName: record.employeeName || "",
    designation: record.designation || "",
    division: record.division || "",
    basicSalary: record.basicSalary ? String(record.basicSalary) : "",
    payPeriod: record.payPeriod || "",
    startDate: record.startDate || "",
    endDate: record.endDate || "",
    overtimeHours: formatAmountInput(record.overtimeHours),
    overtimeRate: formatAmountInput(record.overtimeRate),
    overtimePay: formatAmountInput(record.overtimePay),
    pera: formatAmountInput(peraAmount),
    travelAllowance: formatAmountInput(record.travelAllowance),
    salaryAdjustment: formatAmountInput(record.salaryAdjustment),
    otherAllowances: formatAmountInput(record.otherAllowances),
    lateDeduction: formatAmountInput(record.lateDeduction),
    absenceDeduction: formatAmountInput(record.absenceDeduction),
    undertimeDeduction: formatAmountInput(record.undertimeDeduction),
    withholdingTax: formatAmountInput(record.withholdingTax),
    sss: formatAmountInput(record.sss),
    gsis: formatAmountInput(record.gsis),
    hdmf: formatAmountInput(record.hdmf),
    phic: formatAmountInput(record.phic),
    manualCashAdvanceAdjustment: formatAmountInput(record.manualCashAdvanceAdjustment),
    laptopLoan: formatAmountInput(record.laptopLoan),
    otherDeductions: formatAmountInput(record.otherDeductions),
    bonusAmount: formatAmountInput(record.bonusAmount),
    status: record.status || "Draft",
    notes: record.notes || "",
  };
}

function computeSummary(form) {
  const basicSalary = parseAmount(form.basicSalary);
  const overtimePay = parseAmount(form.overtimePay);
  const totalAllowance =
    overtimePay
    + parseAmount(form.pera)
    + parseAmount(form.travelAllowance)
    + parseAmount(form.salaryAdjustment)
    + parseAmount(form.otherAllowances)
    + parseAmount(form.bonusAmount);
  const grossPay = basicSalary + totalAllowance;
  const totalDeduction =
    parseAmount(form.lateDeduction)
    + parseAmount(form.absenceDeduction)
    + parseAmount(form.undertimeDeduction)
    + parseAmount(form.withholdingTax)
    + parseAmount(form.sss)
    + parseAmount(form.gsis)
    + parseAmount(form.hdmf)
    + parseAmount(form.phic)
    + parseAmount(form.manualCashAdvanceAdjustment)
    + parseAmount(form.laptopLoan)
    + parseAmount(form.otherDeductions);
  const netPay = grossPay - totalDeduction;

  return {
    basicSalary,
    overtimePay,
    totalAllowance,
    grossPay,
    totalDeduction,
    netPay,
  };
}

function buildPayload(form) {
  return {
    employeeRecordId: Number(form.employeeRecordId) || 0,
    payPeriod: form.payPeriod,
    startDate: form.startDate,
    endDate: form.endDate,
    overtimeHours: parseAmount(form.overtimeHours),
    overtimeRate: parseAmount(form.overtimeRate),
    pera: resolvePeraAmount(form.pera),
    travelAllowance: parseAmount(form.travelAllowance),
    salaryAdjustment: parseAmount(form.salaryAdjustment),
    otherAllowances: parseAmount(form.otherAllowances),
    lateDeduction: parseAmount(form.lateDeduction),
    absenceDeduction: parseAmount(form.absenceDeduction),
    undertimeDeduction: parseAmount(form.undertimeDeduction),
    withholdingTax: parseAmount(form.withholdingTax),
    sss: parseAmount(form.sss),
    gsis: parseAmount(form.gsis),
    hdmf: parseAmount(form.hdmf),
    phic: parseAmount(form.phic),
    manualCashAdvanceAdjustment: parseAmount(form.manualCashAdvanceAdjustment),
    laptopLoan: parseAmount(form.laptopLoan),
    otherDeductions: parseAmount(form.otherDeductions),
    bonusAmount: parseAmount(form.bonusAmount),
    status: form.status,
    notes: form.notes.trim(),
  };
}

function buildGeneratedPayrollPayload(employee, generatedPayroll, defaults = {}, approvedCashAdvanceAmount = 0) {
  return {
    employeeRecordId: Number(employee?.employeeRecordId) || 0,
    payPeriod: generatedPayroll.payPeriod || inferPayPeriod(generatedPayroll.startDate, generatedPayroll.endDate),
    startDate: generatedPayroll.startDate,
    endDate: generatedPayroll.endDate,
    overtimeHours: 0,
    overtimeRate: 0,
    overtimePay: 0,
    pera: resolvePeraAmount(defaults.pera),
    travelAllowance: 0,
    salaryAdjustment: 0,
    otherAllowances: 0,
    lateDeduction: 0,
    absenceDeduction: 0,
    undertimeDeduction: 0,
    withholdingTax: 0,
    sss: 0,
    gsis: 0,
    hdmf: 0,
    phic: 0,
    manualCashAdvanceAdjustment: parseAmount(approvedCashAdvanceAmount),
    laptopLoan: 0,
    otherDeductions: 0,
    bonusAmount: 0,
    status: "Draft",
    notes: "",
  };
}

function SectionCard({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="border-b border-slate-200 pb-2">
        <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">{title}</h3>
      </div>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value, valueClassName = "", strong = false }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 py-2.5 last:border-b-0 last:pb-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm ${strong ? "font-bold text-slate-900" : "font-semibold text-slate-700"} ${valueClassName}`.trim()}>
        {value}
      </span>
    </div>
  );
}

function PayrollStatusBadge({ status, compact = false }) {
  const displayStatus = status === "Draft" ? "Processed" : status;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold ${
        compact ? "min-h-6 px-2 text-[10px] leading-none" : "min-h-7 px-2.5 text-sm"
      } ${statusBadgeClasses(status)}`}
    >
      {displayStatus}
    </span>
  );
}

function normalizeRegistryDate(value) {
  const text = String(value || "").trim();
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);

  if (isoMatch) {
    return isoMatch[1];
  }

  return text;
}

function formatDisplayDate(value) {
  if (!value) {
    return "N/A";
  }

  const normalizedValue = String(value).includes("T") ? value : String(value).replace(" ", "T");
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getRegistryId(entry = {}) {
  const firstId = Number(entry.firstPayrollId);
  const lastId = Number(entry.lastPayrollId);

  if (!Number.isFinite(firstId) || firstId <= 0) {
    return "PR-N/A";
  }

  if (firstId === lastId || !Number.isFinite(lastId) || lastId <= 0) {
    return `PR-${String(firstId).padStart(4, "0")}`;
  }

  return `PR-${String(firstId).padStart(4, "0")}-${String(lastId).padStart(4, "0")}`;
}

function getRegistryGroupKey(record = {}) {
  return [
    record.division || "Unassigned",
    record.payPeriod || "",
    normalizeRegistryDate(record.startDate),
    normalizeRegistryDate(record.endDate || record.payrollDate),
  ].join("|");
}

function getRegistryStatus(records = []) {
  const statuses = records.map((record) => record.status || "Draft");

  if (statuses.length === 0) {
    return "Draft";
  }

  if (statuses.every((status) => status === "Paid")) {
    return "Paid";
  }

  if (statuses.every((status) => status === "Approved" || status === "Paid")) {
    return "Approved";
  }

  if (statuses.some((status) => status === "Pending Approval")) {
    return "Pending Approval";
  }

  if (statuses.some((status) => status === "Rejected")) {
    return "Rejected";
  }

  if (statuses.every((status) => status === "Archived")) {
    return "Archived";
  }

  return "Draft";
}

function buildRegistryEntries(records = []) {
  const groups = new Map();

  records.forEach((record) => {
    const key = getRegistryGroupKey(record);
    const existing = groups.get(key) || {
      id: key,
      records: [],
      division: record.division || "Unassigned",
      payPeriod: record.payPeriod || "",
      startDate: record.startDate || "",
      endDate: record.endDate || record.payrollDate || "",
      dateCreated: record.payrollDate || record.endDate || "",
      totalEmployees: 0,
      totalGrossPay: 0,
      totalDeductions: 0,
      totalNetPay: 0,
      firstPayrollId: Number(record.id) || 0,
      lastPayrollId: Number(record.id) || 0,
    };

    existing.records.push(record);
    existing.totalEmployees += 1;
    existing.totalGrossPay += parseAmount(record.grossPay);
    existing.totalDeductions += parseAmount(record.totalDeduction);
    existing.totalNetPay += parseAmount(record.netPay);
    existing.firstPayrollId = Math.min(existing.firstPayrollId || Number(record.id) || 0, Number(record.id) || 0);
    existing.lastPayrollId = Math.max(existing.lastPayrollId || Number(record.id) || 0, Number(record.id) || 0);

    if (String(record.payrollDate || "") > String(existing.dateCreated || "")) {
      existing.dateCreated = record.payrollDate;
    }

    groups.set(key, existing);
  });

  return Array.from(groups.values())
    .map((entry) => ({
      ...entry,
      registryId: getRegistryId(entry),
      periodLabel: entry.payPeriod
        ? `${entry.payPeriod} (${entry.startDate || "N/A"} to ${entry.endDate || "N/A"})`
        : `${entry.startDate || "N/A"} to ${entry.endDate || "N/A"}`,
      status: getRegistryStatus(entry.records),
      employmentTypes: getRegistryEmploymentTypes(entry.records),
    }))
    .sort((left, right) => {
      const dateCompare = String(right.dateCreated || "").localeCompare(String(left.dateCreated || ""));
      return dateCompare !== 0 ? dateCompare : String(right.registryId).localeCompare(String(left.registryId));
    });
}

// A registry row groups records only by division/period/date, so it can mix employment types
// (e.g. Regular and Contractual paid together). Returns every distinct type present, most common first.
function getRegistryEmploymentTypes(records = []) {
  const counts = new Map();

  records.forEach((record) => {
    const label = normalizeEmploymentTypeLabel(record.employmentType) || "Unspecified";
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type]) => type);
}

function getDeductionAmount(record = {}, names = []) {
  const keys = new Set(names.map((name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "")));
  const items = Array.isArray(record.deductionItems) ? record.deductionItems : [];

  return items.reduce((total, item) => {
    const key = String(item.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return keys.has(key) ? total + parseAmount(item.amount) : total;
  }, 0);
}

const REGISTRY_DETAIL_PAGE_SIZE = 10;
const REGISTRY_DETAIL_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/*
 * The register's deduction columns come from the deduction catalog — every active type flagged
 * `show_in_payroll`, in the catalog's own order. This used to be 33 names typed out here, which is
 * why the column header said "GSIS Premium" while the cell underneath matched on "GSIS": the list
 * and the data had drifted, and a deduction added in Settings never got a column at all.
 */
function buildRegularDeductionColumns(deductionColumns = []) {
  return deductionColumns
    .filter((column) => column?.name)
    .map((column) => ({
      key: column.code || column.name,
      label: column.name,
      category: column.category || "",
    }));
}

// Series, Employee No., Employee Name, the gross breakdown, Gross Amount Earned, every deduction,
// Due Date, Total Deductions, Net Amount Due, and the two payout halves.
function regularColumnCount(deductionColumnCount) {
  return 3 + 3 + 1 + deductionColumnCount + 3 + 2;
}

const REGULAR_HEADER_CELL_CLASS =
  "border border-slate-200 bg-slate-50 px-4 py-3 text-center align-middle whitespace-nowrap";

const CONTRACTUAL_EMPLOYMENT_TYPES = new Set(["Contractual"]);
const PREMIUM_ALLOWANCE_NAMES = ["Premium", "Premium Pay", "Premium Percentage"];
const CONTRACTUAL_COLUMN_COUNT = 22;

function getAllowanceAmount(record = {}, names = []) {
  const keys = new Set(names.map((name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "")));
  const items = Array.isArray(record.allowanceItems) ? record.allowanceItems : [];

  return items.reduce((total, item) => {
    const key = String(item.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return keys.has(key) ? total + parseAmount(item.amount) : total;
  }, 0);
}

function isContractualRecord(record = {}) {
  return CONTRACTUAL_EMPLOYMENT_TYPES.has(normalizeEmploymentTypeLabel(record.employmentType));
}

function buildSalaryPeriodColumnLabel(startDate, endDate) {
  const start = new Date(`${normalizeRegistryDate(startDate)}T00:00:00`);
  const end = new Date(`${normalizeRegistryDate(endDate)}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Salary for the Period";
  }

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    const monthLabel = start.toLocaleDateString("en-US", { month: "long" });
    return `${monthLabel} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  }

  return `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
}

// The register always shows both halves of the month, but the month and the day span follow the
// pay period the payroll was created with instead of a fixed calendar month.
function buildPayoutHalfColumnLabels(startDate, endDate) {
  const start = new Date(`${normalizeRegistryDate(startDate)}T00:00:00`);
  const end = new Date(`${normalizeRegistryDate(endDate)}T00:00:00`);
  const firstHalfSource = Number.isNaN(start.getTime()) ? end : start;
  const secondHalfSource = Number.isNaN(end.getTime()) ? start : end;

  if (Number.isNaN(firstHalfSource.getTime()) || Number.isNaN(secondHalfSource.getTime())) {
    return [
      { month: "Payout", range: "1st Half" },
      { month: "Payout", range: "2nd Half" },
    ];
  }

  const lastDay = new Date(secondHalfSource.getFullYear(), secondHalfSource.getMonth() + 1, 0).getDate();

  return [
    {
      month: firstHalfSource.toLocaleDateString("en-US", { month: "long" }),
      range: `1-15, ${firstHalfSource.getFullYear()}`,
    },
    {
      month: secondHalfSource.toLocaleDateString("en-US", { month: "long" }),
      range: `16-${lastDay}, ${secondHalfSource.getFullYear()}`,
    },
  ];
}

function getContractualDaysRendered(record = {}) {
  const renderedMinutes = parseAmount(record.attendanceRenderedMinutes);

  if (renderedMinutes > 0) {
    return roundAmount(renderedMinutes / (WORKING_HOURS_PER_DAY * 60));
  }

  const expectedWorkdays = parseAmount(record.attendanceExpectedWorkdays);

  if (expectedWorkdays > 0) {
    return Math.max(roundAmount(expectedWorkdays - parseAmount(record.absenceDays)), 0);
  }

  return 0;
}

function getContractualDailyRate(record = {}) {
  const hourlyRate = parseAmount(record.hourlyRate);

  if (hourlyRate > 0) {
    return roundAmount(hourlyRate * WORKING_HOURS_PER_DAY);
  }

  const basicSalary = parseAmount(record.basicSalary);
  return basicSalary > 0 ? roundAmount(basicSalary / WORKING_DAYS_PER_MONTH) : 0;
}

function buildContractualRow(record = {}) {
  const basicSalary = parseAmount(record.basicSalary);
  const dailyRate = getContractualDailyRate(record);
  const premiumTotal = getAllowanceAmount(record, PREMIUM_ALLOWANCE_NAMES);
  const calculatedPremiumRate = basicSalary > 0 ? roundAmount((premiumTotal / basicSalary) * 100) : 0;
  const premiumRate = calculatedPremiumRate > 0 ? calculatedPremiumRate : 0.20;
  const additionalSalary = parseAmount(record.totalAllowance);
  const salaryTotal = roundAmount(basicSalary + additionalSalary);

  // Pass slips only become their own deduction when attendance did not already cover the period,
  // so the two columns together always add up to the stored tardy plus undertime deduction.
  const undertimeDeduction = parseAmount(record.undertimeDeduction);
  const passSlipDeduction = record.hasAttendanceCoverage ? 0 : undertimeDeduction;
  const tardyUndertimeDeduction = Math.max(
    roundAmount(parseAmount(record.lateDeduction) + undertimeDeduction - passSlipDeduction),
    0
  );
  const previousPayrollDeduction = getDeductionAmount(record, [
    "DEDUCTION PREVIOUS PAYROLL",
    "Deduction from Previous Payroll",
  ]);
  const salaryLessTotal = roundAmount(previousPayrollDeduction + tardyUndertimeDeduction + passSlipDeduction);

  return {
    daysRendered: getContractualDaysRendered(record),
    dailyRate,
    premiumRate,
    premiumTotal,
    rateWithPremium: roundAmount(dailyRate * (1 + premiumRate / 100)),
    periodSalary: basicSalary,
    additionalSalary,
    salaryTotal,
    previousPayrollDeduction,
    tardyUndertimeDeduction,
    passSlipDeduction,
    grossPay: roundAmount(salaryTotal - salaryLessTotal),
    tax: getDeductionAmount(record, ["Withholding Tax", "WITHHOLDING TAX", "W-TAX", "TAX"]),
    philHealth: getDeductionAmount(record, ["PHIC", "PhilHealth", "PHILHEALTH PREMIUM"]),
    philHealthDifferential: getDeductionAmount(record, ["PhilHealth Differential", "PHILHEALTH DIFFERENTIAL"]),
    pagIbig: getDeductionAmount(record, ["HDMF", "Pag-IBIG", "PAG IBIG PREMIUM", "PAG-IBIG"]),
    pagIbigMp2: getDeductionAmount(record, ["MP2", "PAG IBIG MP2", "PAG-IBIG MP2", "Modified Pag-IBIG II (MP2)"]),
    pagIbigMpl: getDeductionAmount(record, ["PAG-IBIG MPL", "PAG IBIG MPL"]),
    mgbCoopLoan: getDeductionAmount(record, ["MGB Coop Loan", "MGB COOP LOAN", "MGB Cooperative Loan"]),
    totalDeductions: Math.max(roundAmount(parseAmount(record.totalDeduction) - salaryLessTotal), 0),
    netPay: parseAmount(record.netPay),
  };
}

function ContractualRegistryTable({ records, salaryPeriodLabel, totalDeductions, totalNetPay }) {
  const groupHeaderClass =
    "border border-slate-300 bg-slate-100 px-3 py-2 text-center align-middle text-[11px] font-extrabold uppercase text-slate-700";
  const subHeaderClass =
    "border border-slate-300 bg-slate-50 px-3 py-2 text-center align-middle text-[11px] font-extrabold uppercase text-slate-600";
  const lessHeaderClass = `${subHeaderClass} text-rose-700`;
  const amountCellClass = "border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-700 whitespace-nowrap";

  return (
    <table className="min-w-[2400px] w-full border-collapse text-sm">
      <thead className="sticky top-0 z-20">
        <tr>
          <th rowSpan={2} className={groupHeaderClass}>NAMES</th>
          <th rowSpan={2} className={groupHeaderClass}># of days rendered</th>
          <th rowSpan={2} className={groupHeaderClass}>Rate/ day</th>
          <th colSpan={2} className={groupHeaderClass}>Premium</th>
          <th rowSpan={2} className={groupHeaderClass}>Total (Rate plus Premium Percentage)</th>
          <th colSpan={3} className={groupHeaderClass}>Salary</th>
          <th colSpan={3} className={groupHeaderClass}>Less:</th>
          <th rowSpan={2} className={`${groupHeaderClass} bg-yellow-300 text-slate-900`}>GROSS</th>
          <th colSpan={7} className={groupHeaderClass}>Less</th>
          <th rowSpan={2} className={groupHeaderClass}>Total Deductions</th>
          <th rowSpan={2} className={groupHeaderClass}>NET PAY</th>
        </tr>
        <tr>
          <th className={subHeaderClass}>%</th>
          <th className={subHeaderClass}>Total</th>
          <th className={lessHeaderClass}>{salaryPeriodLabel}</th>
          <th className={subHeaderClass}>Additional Salary</th>
          <th className={subHeaderClass}>Total</th>
          <th className={lessHeaderClass}>Deduction from Previous Payroll</th>
          <th className={lessHeaderClass}>Tardy/ Undertime</th>
          <th className={lessHeaderClass}>Pass Slip</th>
          <th className={lessHeaderClass}>TAX</th>
          <th className={lessHeaderClass}>PhilHealth</th>
          <th className={lessHeaderClass}>PhilHealth Differential</th>
          <th className={lessHeaderClass}>Pag-IBIG</th>
          <th className={lessHeaderClass}>Modified Pag-IBIG II (MP2)</th>
          <th className={lessHeaderClass}>Pag-IBIG MPL</th>
          <th className={lessHeaderClass}>MGB Coop Loan</th>
        </tr>
      </thead>
      <tbody>
        {records.length > 0 ? records.map((record) => {
          const row = buildContractualRow(record);

          return (
            <tr key={record.id}>
              <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-900 whitespace-nowrap">
                {record.employeeName || "Employee"}
              </td>
              <td className={amountCellClass}>{daysFormatter.format(row.daysRendered)}</td>
              <td className={amountCellClass}>{formatCurrency(row.dailyRate)}</td>
              <td className={amountCellClass}>{`${percentFormatter.format(row.premiumRate)}%`}</td>
              <td className={amountCellClass}>{formatCurrency(row.premiumTotal)}</td>
              <td className={amountCellClass}>{formatCurrency(row.rateWithPremium)}</td>
              <td className={amountCellClass}>{formatCurrency(row.periodSalary)}</td>
              <td className={amountCellClass}>{formatCurrency(row.additionalSalary)}</td>
              <td className={amountCellClass}>{formatCurrency(row.salaryTotal)}</td>
              <td className={amountCellClass}>{formatCurrency(row.previousPayrollDeduction)}</td>
              <td className={amountCellClass}>{formatCurrency(row.tardyUndertimeDeduction)}</td>
              <td className={amountCellClass}>{formatCurrency(row.passSlipDeduction)}</td>
              <td className={`${amountCellClass} bg-yellow-50 font-bold text-slate-950`}>{formatCurrency(row.grossPay)}</td>
              <td className={amountCellClass}>{formatCurrency(row.tax)}</td>
              <td className={amountCellClass}>{formatCurrency(row.philHealth)}</td>
              <td className={amountCellClass}>{formatCurrency(row.philHealthDifferential)}</td>
              <td className={amountCellClass}>{formatCurrency(row.pagIbig)}</td>
              <td className={amountCellClass}>{formatCurrency(row.pagIbigMp2)}</td>
              <td className={amountCellClass}>{formatCurrency(row.pagIbigMpl)}</td>
              <td className={amountCellClass}>{formatCurrency(row.mgbCoopLoan)}</td>
              <td className={`${amountCellClass} text-slate-950`}>{formatCurrency(row.totalDeductions)}</td>
              <td className={`${amountCellClass} font-bold text-slate-950`}>{formatCurrency(row.netPay)}</td>
            </tr>
          );
        }) : (
          <tr>
            <td colSpan={CONTRACTUAL_COLUMN_COUNT} className="border border-slate-200 px-4 py-10 text-center text-sm font-medium text-slate-500">
              No employees match your search.
            </td>
          </tr>
        )}
      </tbody>
      <tfoot className="sticky bottom-0 z-20">
        <tr className="text-slate-900">
          <td className="border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-extrabold uppercase" colSpan={20}>
            Total Net Payroll Amount (Contractual)
          </td>
          <td className="border border-slate-300 bg-slate-50 px-3 py-2 text-right tabular-nums text-slate-950 whitespace-nowrap">
            {formatCurrency(totalDeductions)}
          </td>
          <td className="border border-slate-300 bg-slate-50 px-3 py-2 text-right font-bold tabular-nums text-slate-950 whitespace-nowrap">
            {formatCurrency(totalNetPay)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function PayrollRegistryDetailsModal({
  entry,
  canApprove,
  canMarkPaid,
  canArchive,
  actionLoading,
  deductionColumns = [],
  onClose,
  onApprove,
  onMarkPaid,
  onArchive,
}) {
  const open = Boolean(entry);
  const records = useMemo(() => entry?.records || [], [entry]);
  const regularDeductionColumns = useMemo(
    () => buildRegularDeductionColumns(deductionColumns),
    [deductionColumns]
  );
  const regularColumnTotal = regularColumnCount(regularDeductionColumns.length);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(REGISTRY_DETAIL_PAGE_SIZE);

  useEffect(() => {
    setSearchQuery("");
    setCurrentPage(1);
  }, [entry?.registryId]);

  const sortedRecords = useMemo(
    () =>
      [...records].sort((a, b) =>
        String(a.employeeName || "").localeCompare(String(b.employeeName || ""), undefined, {
          sensitivity: "base",
        })
      ),
    [records]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredRecords = useMemo(() => {
    if (!normalizedQuery) {
      return sortedRecords;
    }

    return sortedRecords.filter((record) => {
      const name = String(record.employeeName || "").toLowerCase();
      const id = String(record.employeeId || "").toLowerCase();
      return name.includes(normalizedQuery) || id.includes(normalizedQuery);
    });
  }, [normalizedQuery, sortedRecords]);

  const totalPages =
    pageSize === Infinity ? 1 : Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) {
      setCurrentPage(safeCurrentPage);
    }
  }, [currentPage, safeCurrentPage]);

  const pagedRecords = useMemo(() => {
    if (pageSize === Infinity) {
      return filteredRecords;
    }

    const start = (safeCurrentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, pageSize, safeCurrentPage]);

  const employmentTypeSummary = useMemo(() => {
    const counts = new Map();

    records.forEach((record) => {
      const label = normalizeEmploymentTypeLabel(record.employmentType) || "Unspecified";
      counts.set(label, (counts.get(label) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }, [records]);

  const pagedContractualRecords = useMemo(
    () => pagedRecords.filter((record) => isContractualRecord(record)),
    [pagedRecords]
  );

  const pagedStandardRecords = useMemo(
    () => pagedRecords.filter((record) => !isContractualRecord(record)),
    [pagedRecords]
  );

  // Series numbers run over every regular row that survived the search, so they stay stable per page.
  const standardSeriesNumbers = useMemo(() => {
    const series = new Map();

    filteredRecords
      .filter((record) => !isContractualRecord(record))
      .forEach((record, index) => series.set(record.id, index + 1));

    return series;
  }, [filteredRecords]);

  const hasContractualRecords = useMemo(
    () => records.some((record) => isContractualRecord(record)),
    [records]
  );

  const hasStandardRecords = useMemo(
    () => records.some((record) => !isContractualRecord(record)),
    [records]
  );

  const contractualTotals = useMemo(
    () => records.filter((record) => isContractualRecord(record)).reduce(
      (totals, record) => {
        const row = buildContractualRow(record);
        return {
          totalDeductions: totals.totalDeductions + row.totalDeductions,
          netPay: totals.netPay + row.netPay,
        };
      },
      { totalDeductions: 0, netPay: 0 }
    ),
    [records]
  );

  const salaryPeriodLabel = useMemo(
    () => buildSalaryPeriodColumnLabel(entry?.startDate, entry?.endDate),
    [entry?.endDate, entry?.startDate]
  );

  const payoutHalfLabels = useMemo(
    () => buildPayoutHalfColumnLabels(entry?.startDate, entry?.endDate),
    [entry?.endDate, entry?.startDate]
  );

  const showsBothTables = hasContractualRecords && hasStandardRecords;

  return (
    <Modal
      open={open}
      title={entry ? `Payroll Details - ${entry.registryId}` : "Payroll Details"}
      onClose={onClose}
      maxWidth="max-w-7xl"
      contentClassName="bg-white"
      footerClassName="bg-white"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {canApprove && entry && !["Approved", "Paid", "Archived"].includes(entry.status) ? (
            <Button variant="primary" icon={Check} loading={actionLoading} onClick={() => onApprove(entry)}>
              Approve Payroll
            </Button>
          ) : null}
          {canMarkPaid && entry?.status === "Approved" ? (
            <Button variant="primary" icon={WalletCards} loading={actionLoading} onClick={() => onMarkPaid(entry)}>
              Mark as Paid
            </Button>
          ) : null}
          {canArchive && entry && entry.status !== "Archived" ? (
            <Button variant="danger" icon={faBoxArchive} loading={actionLoading} onClick={() => onArchive(entry)}>
              Archive
            </Button>
          ) : null}
        </>
      )}
    >
      {entry ? (
        <div className="flex max-h-[calc(92dvh-168px)] flex-col gap-4">
          <div className="shrink-0 space-y-3">
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
            >
              {[
                ["Payroll ID", entry.registryId],
                ["Division", entry.division],
                ["Date Created", formatDisplayDate(entry.dateCreated)],
                ["Total Employees", numberFormatter.format(entry.totalEmployees)],
                ...employmentTypeSummary.map(({ type, count }) => [type, numberFormatter.format(count)]),
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-xs font-bold uppercase text-slate-500">{label}</p>
                  <p className="m-0 mt-1 truncate text-sm font-extrabold text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["Gross Pay", formatCurrency(entry.totalGrossPay), "border-blue-200 bg-blue-50 text-blue-700"],
                ["Total Deductions", formatCurrency(entry.totalDeductions), "border-rose-200 bg-rose-50 text-rose-700"],
                ["Total Net Payroll Amount", formatCurrency(entry.totalNetPay), "border-emerald-200 bg-emerald-50 text-emerald-700"],
              ].map(([label, value, toneClass]) => (
                <div key={label} className={`rounded-lg border px-4 py-3 ${toneClass}`}>
                  <p className="m-0 text-xs font-bold uppercase tracking-normal text-slate-500">{label}</p>
                  <p className="m-0 mt-1 text-xl font-extrabold tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-xs">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search employee name or ID"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  Rows per page
                  <select
                    value={pageSize === Infinity ? "all" : String(pageSize)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPageSize(value === "all" ? Infinity : Number(value));
                      setCurrentPage(1);
                    }}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
                  >
                    {REGISTRY_DETAIL_PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                    <option value="all">All</option>
                  </select>
                </label>
                <p className="m-0 shrink-0 text-xs font-semibold text-slate-500">
                  Showing {numberFormatter.format(filteredRecords.length)} of {numberFormatter.format(records.length)} employees
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {pagedContractualRecords.length > 0 ? (
              <div className="rounded-lg border border-slate-200">
                {showsBothTables ? (
                  <p className="m-0 border-b border-slate-200 bg-white px-4 py-2 text-xs font-extrabold uppercase text-slate-600">
                    Contractual
                  </p>
                ) : null}
                <div className="overflow-x-auto">
                  <ContractualRegistryTable
                    records={pagedContractualRecords}
                    salaryPeriodLabel={salaryPeriodLabel}
                    totalDeductions={contractualTotals.totalDeductions}
                    totalNetPay={contractualTotals.netPay}
                  />
                </div>
              </div>
            ) : null}

            {pagedStandardRecords.length > 0 ? (
              <div className="overflow-auto rounded-lg border border-slate-200">
                {showsBothTables ? (
                  <p className="m-0 border-b border-slate-200 bg-white px-4 py-2 text-xs font-extrabold uppercase text-slate-600">
                    Regular
                  </p>
                ) : null}
                <table className="min-w-[3300px] w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-20">
                    <tr className="text-xs font-extrabold uppercase text-slate-600">
                      <th rowSpan={2} className={REGULAR_HEADER_CELL_CLASS}>Series</th>
                      <th rowSpan={2} className={REGULAR_HEADER_CELL_CLASS}>Employee No.</th>
                      <th rowSpan={2} className={REGULAR_HEADER_CELL_CLASS}>Employee Name</th>
                      <th colSpan={3} className={REGULAR_HEADER_CELL_CLASS} aria-hidden="true" />
                      <th rowSpan={2} className={REGULAR_HEADER_CELL_CLASS}>Gross Amount Earned</th>
                      <th colSpan={regularDeductionColumns.length} className={`${REGULAR_HEADER_CELL_CLASS} tracking-[0.3em]`}>
                        Deductions
                      </th>
                      <th rowSpan={2} className={REGULAR_HEADER_CELL_CLASS}>Due Date</th>
                      <th rowSpan={2} className={REGULAR_HEADER_CELL_CLASS}>Total Deductions</th>
                      <th rowSpan={2} className={REGULAR_HEADER_CELL_CLASS}>Net Amount Due</th>
                      <th className={REGULAR_HEADER_CELL_CLASS}>{payoutHalfLabels[0].month}</th>
                      <th className={REGULAR_HEADER_CELL_CLASS}>{payoutHalfLabels[1].month}</th>
                    </tr>
                    <tr className="text-xs font-extrabold uppercase text-slate-600">
                      {[
                        { key: "basic", label: "Basic" },
                        { key: "pera", label: "PERA" },
                        { key: "stepIncrement", label: "Step Increment" },
                        ...regularDeductionColumns,
                        { key: "payoutFirst", label: payoutHalfLabels[0].range },
                        { key: "payoutSecond", label: payoutHalfLabels[1].range },
                      ].map((header) => (
                        <th key={header.key} className={REGULAR_HEADER_CELL_CLASS} title={header.category || undefined}>
                          {header.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStandardRecords.length > 0 ? pagedStandardRecords.map((record, index) => (
                      <tr key={record.id} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-4 py-3 tabular-nums text-slate-600 whitespace-nowrap">{standardSeriesNumbers.get(record.id) ?? index + 1}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{record.employeeId || "N/A"}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{record.employeeName || "Employee"}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">{formatCurrency(record.basicSalary)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">{formatCurrency(record.pera)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">{formatCurrency(record.stepIncrement)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">{formatCurrency(record.grossPay)}</td>
                        {regularDeductionColumns.map((column) => (
                          <td key={column.key} className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">
                            {formatCurrency(getDeductionAmount(record, [column.label]))}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDisplayDate(record.dueDate || record.endDate)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-950 whitespace-nowrap">{formatCurrency(record.totalDeduction)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-950 whitespace-nowrap">{formatCurrency(record.netPay)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">{formatCurrency(record.marchFirstHalf)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">{formatCurrency(record.marchSecondHalf)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={regularColumnTotal} className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                          No employees match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20">
                    <tr className="text-slate-900">
                      <td className="border-t border-slate-200 bg-slate-50 px-4 py-3" colSpan={regularColumnTotal - 3}>Total Net Payroll Amount</td>
                      <td className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 whitespace-nowrap">{formatCurrency(entry.totalNetPay)}</td>
                      <td className="border-t border-slate-200 bg-slate-50 px-4 py-3"></td>
                      <td className="border-t border-slate-200 bg-slate-50 px-4 py-3"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : null}

            {pagedRecords.length === 0 ? (
              <div className="rounded-lg border border-slate-200 px-4 py-10 text-center text-sm font-medium text-slate-500">
                No employees match your search.
              </div>
            ) : null}
          </div>

          <Pagination
            currentPage={safeCurrentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            className="shrink-0"
          />
        </div>
      ) : null}
    </Modal>
  );
}

function GeneratedPayrollEmployeeRow({ employee, selected = false, onToggle }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0 transition ${
        selected ? "bg-[#fff5f5]" : "bg-white hover:bg-slate-50"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(employee.employeeRecordId)}
        className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[#D61E1E] focus:ring-[#D61E1E]/20"
      />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-medium text-slate-900">
          {employee.employeeName || "Employee"}
        </p>
        <p className="m-0 truncate text-xs text-slate-500">
          {employee.employeeId || "N/A"}
        </p>
      </div>
      <p className="hidden min-w-0 max-w-[140px] truncate text-xs text-slate-500 sm:block">
        {employee.division || "Unassigned"}
      </p>
      <p className="hidden w-24 shrink-0 truncate text-xs text-slate-500 md:block">
        {employee.employmentType || "Employee"}
      </p>
    </label>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="overflow-hidden border-slate-200/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <div className="h-11 w-11 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-4 w-24 animate-pulse rounded-full bg-slate-100" />
              <div className="h-8 w-28 animate-pulse rounded-full bg-slate-200" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden border-slate-200/80 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="h-6 w-44 animate-pulse rounded-full bg-slate-100" />
          <div className="mt-3 h-4 w-72 animate-pulse rounded-full bg-slate-100" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse border-b border-slate-200 bg-white last:border-b-0" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PayrollManagementWorkspace({
  employees = [],
  view = "generate",
  user = null,
  onNavigate = null,
}) {
  const pageConfig = PAYROLL_VIEWS[view] || PAYROLL_VIEWS.generate;
  const isRegistryView = view === "generate";
  const roleKey = normalizeRoleKey(user);
  const canSubmitPayroll = ["admin", "hrhead", "hrstaff", "regionaldirector"].includes(roleKey);
  const canApprovePayroll = ["admin", "hrhead", "regionaldirector"].includes(roleKey);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig] = useState({ key: "payrollId", direction: "asc" });
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [processingGeneratedPayroll, setProcessingGeneratedPayroll] = useState(false);
  const [generatedPayroll, setGeneratedPayroll] = useState(() => emptyGeneratedPayrollState());
  const [selectedGeneratedEmployeeIds, setSelectedGeneratedEmployeeIds] = useState([]);
  const [payrollPreviewRecords, setPayrollPreviewRecords] = useState([]);
  const [payrollPreviewLoading, setPayrollPreviewLoading] = useState(false);
  const [payrollPreviewError, setPayrollPreviewError] = useState("");
  const [cashAdvanceRequests, setCashAdvanceRequests] = useState([]);
  const [passSlipRecords, setPassSlipRecords] = useState([]);
  const [overtimeRequests, setOvertimeRequests] = useState([]);
  const [editingRecord, setEditingRecord] = useState(null);
  const [allowanceDefaults, setAllowanceDefaults] = useState(() => ({ pera: DEFAULT_PERA_AMOUNT }));
  // Which deductions get a column in the register, straight from the catalog.
  const [deductionColumns, setDeductionColumns] = useState([]);
  const [form, setForm] = useState(() => emptyFormState({ pera: DEFAULT_PERA_AMOUNT }));
  const [viewRecord, setViewRecord] = useState(null);
  const [selectedPayrollIds, setSelectedPayrollIds] = useState([]);
  const [bulkFailedPayrollIds, setBulkFailedPayrollIds] = useState([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [drawerActionLoading, setDrawerActionLoading] = useState(false);
  const [registryDetailEntry, setRegistryDetailEntry] = useState(null);
  const [registryActionLoading, setRegistryActionLoading] = useState(false);
  const [archiveActionLoading, setArchiveActionLoading] = useState(false);
  const archivePayrollPath = roleKey === "admin" ? "/admin/payroll/archived" : "";

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        employeeRecordId: employee.id,
        employeeId: employee.employeeId || employee.employee_id || "",
        employeeName: employee.fullName || employee.employeeName || "Employee",
        designation: employee.position || employee.designation || "",
        division: employee.department || employee.division || "",
        employmentType: normalizeEmploymentTypeLabel(employee.employmentStatus || employee.employmentType),
        basicSalary: employee.basicSalary,
        profileImage: employee.profileImage || employee.profile_image || "",
      })),
    [employees]
  );
  const sortedEmployeeOptions = useMemo(
    () => [...employeeOptions].sort((left, right) => String(left.employeeName || "").localeCompare(String(right.employeeName || ""))),
    [employeeOptions]
  );
  const employeeDivisionOptions = useMemo(
    () => Array.from(new Set(sortedEmployeeOptions.map((employee) => employee.division).filter(Boolean))).sort(),
    [sortedEmployeeOptions]
  );
  const selectedGeneratedEmployeeIdSet = useMemo(
    () => new Set(selectedGeneratedEmployeeIds.map((id) => String(id))),
    [selectedGeneratedEmployeeIds]
  );
  const filteredGeneratedEmployees = useMemo(() => {
    const search = generatedPayroll.search.trim().toLowerCase();

    return sortedEmployeeOptions.filter((employee) => {
      const matchesSearch = !search || [
        employee.employeeName,
        employee.employeeId,
        employee.division,
        employee.employmentType,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesDivision = !generatedPayroll.division || employee.division === generatedPayroll.division;
      const matchesEmploymentType = !generatedPayroll.employmentType || employee.employmentType === generatedPayroll.employmentType;

      return matchesSearch && matchesDivision && matchesEmploymentType;
    });
  }, [generatedPayroll.division, generatedPayroll.employmentType, generatedPayroll.search, sortedEmployeeOptions]);
  const allGeneratedEmployeesSelected = filteredGeneratedEmployees.length > 0
    && filteredGeneratedEmployees.every((employee) => selectedGeneratedEmployeeIdSet.has(String(employee.employeeRecordId)));

  const approvedCashAdvanceByEmployeeId = useMemo(() => {
    const totals = new Map();

    cashAdvanceRequests.forEach((request) => {
      if (request.status !== "Approved" || request.isArchived) {
        return;
      }

      const employeeRecordId = String(request.employeeRecordId || "");
      if (!employeeRecordId) {
        return;
      }

      totals.set(employeeRecordId, (totals.get(employeeRecordId) || 0) + parseAmount(request.amount));
    });

    return totals;
  }, [cashAdvanceRequests]);

  const approvedCashAdvanceAmountForEmployee = useCallback(
    (employeeRecordId) => approvedCashAdvanceByEmployeeId.get(String(employeeRecordId || "")) || 0,
    [approvedCashAdvanceByEmployeeId]
  );

  const payrollPreviewTotals = useMemo(
    () => payrollPreviewRecords.reduce(
      (totals, record) => ({
        grossPay: totals.grossPay + parseAmount(record.grossPay),
        totalDeduction: totals.totalDeduction + parseAmount(record.totalDeduction),
        netPay: totals.netPay + parseAmount(record.netPay),
      }),
      { grossPay: 0, totalDeduction: 0, netPay: 0 }
    ),
    [payrollPreviewRecords]
  );

  const summary = useMemo(() => computeSummary(form), [form]);

  useEffect(() => {
    setForm((current) => {
      const computed = calculateAutomaticPayrollValues(current, passSlipRecords, overtimeRequests);
      const nextValues = {
        overtimeHours: formatAmountInput(computed.overtimeHours),
        overtimeRate: formatAmountInput(computed.overtimeRate),
        overtimePay: formatAmountInput(computed.overtimePay),
        undertimeDeduction: formatAmountInput(computed.undertimeDeduction),
        withholdingTax: formatAmountInput(computed.withholdingTax),
      };

      if (
        current.overtimeHours === nextValues.overtimeHours
        && current.overtimeRate === nextValues.overtimeRate
        && current.overtimePay === nextValues.overtimePay
        && current.undertimeDeduction === nextValues.undertimeDeduction
        && current.withholdingTax === nextValues.withholdingTax
      ) {
        return current;
      }

      return {
        ...current,
        ...nextValues,
      };
    });
  }, [
    form.basicSalary,
    form.employeeRecordId,
    form.endDate,
    form.startDate,
    overtimeRequests,
    passSlipRecords,
  ]);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchPayrollRecords();

      setRecords(Array.isArray(result.records) ? result.records : []);
      setAllowanceDefaults({
        pera: resolvePeraAmount(result.defaults?.pera),
      });
      setDeductionColumns(
        Array.isArray(result.defaults?.deductionColumns) ? result.defaults.deductionColumns : []
      );
      setError("");

      const [cashAdvanceResult, passSlipResult, overtimeResult] = await Promise.allSettled([
        fetchCashAdvanceRequests({ approved: 1 }),
        fetchPassSlips(),
        fetchOvertimeRequests(),
      ]);

      setCashAdvanceRequests(
        cashAdvanceResult.status === "fulfilled" && Array.isArray(cashAdvanceResult.value.records)
          ? cashAdvanceResult.value.records
          : []
      );
      setPassSlipRecords(
        passSlipResult.status === "fulfilled" && Array.isArray(passSlipResult.value.records)
          ? passSlipResult.value.records
          : []
      );
      setOvertimeRequests(
        overtimeResult.status === "fulfilled" && Array.isArray(overtimeResult.value.records)
          ? overtimeResult.value.records
          : []
      );
    } catch (requestError) {
      if (!background) {
        setError(requestError.response?.data?.message || "Unable to load payroll records.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /*
   * Payroll is assembled from other people's approvals — a cash advance cleared by HR or an overtime
   * request approved by a chief both change what this screen should compute, so it watches those
   * topics as well as its own.
   */
  useAutoRefreshOnChange(loadRecords, {
    topics: ["payroll", "cash_advance", "pass_slip", "overtime", "employee"],
  });

  useEffect(() => {
    if (!generateModalOpen) {
      return undefined;
    }

    const payPeriod = generatedPayroll.payPeriod || inferPayPeriod(generatedPayroll.startDate, generatedPayroll.endDate);

    if (!generatedPayroll.startDate || !generatedPayroll.endDate || !payPeriod || selectedGeneratedEmployeeIds.length === 0) {
      setPayrollPreviewRecords([]);
      setPayrollPreviewError("");
      setPayrollPreviewLoading(false);
      return undefined;
    }

    let active = true;
    setPayrollPreviewLoading(true);
    setPayrollPreviewError("");

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await previewPayroll({
          employeeIds: selectedGeneratedEmployeeIds.map((id) => Number(id)).filter(Boolean),
          payPeriod,
          startDate: generatedPayroll.startDate,
          endDate: generatedPayroll.endDate,
        });

        if (!active) {
          return;
        }

        setPayrollPreviewRecords(Array.isArray(result.records) ? result.records : []);
        setPayrollPreviewError(
          Array.isArray(result.errors) && result.errors.length > 0
            ? `${result.errors.length} preview calculation${result.errors.length === 1 ? "" : "s"} failed.`
            : ""
        );
      } catch (requestError) {
        if (active) {
          setPayrollPreviewRecords([]);
          setPayrollPreviewError(requestError.response?.data?.message || "Unable to calculate payroll preview.");
        }
      } finally {
        if (active) {
          setPayrollPreviewLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    generateModalOpen,
    generatedPayroll.endDate,
    generatedPayroll.payPeriod,
    generatedPayroll.startDate,
    selectedGeneratedEmployeeIds,
  ]);

  const viewScopedRecords = useMemo(() => {
    if (view === "archived") {
      return records.filter((record) => record.status === "Archived");
    }

    return records.filter((record) => record.status !== "Archived");
  }, [records, view]);

  const divisions = useMemo(
    () => Array.from(new Set(records.map((record) => record.division).filter(Boolean))).sort(),
    [records]
  );

  const periodOptions = useMemo(
    () => Array.from(new Set(records.map((record) => record.payPeriod).filter(Boolean))),
    [records]
  );

  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return viewScopedRecords.filter((record) => {
      const matchesSearch = isRegistryView || !query || [
        record.employeeId,
        record.employeeName,
        record.designation,
        record.division,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus = !statusFilter || record.status === statusFilter;
      const matchesDivision = !divisionFilter || record.division === divisionFilter;
      const matchesPeriod = !periodFilter || record.payPeriod === periodFilter;

      return matchesSearch && matchesStatus && matchesDivision && matchesPeriod;
    });
  }, [divisionFilter, isRegistryView, periodFilter, searchQuery, statusFilter, viewScopedRecords]);

  const sortedRecords = useMemo(() => {
    const items = [...filteredRecords];
    const { key, direction } = sortConfig;

    const valueFor = (record) => {
      switch (key) {
        case "payrollId":
        case "id":
          return Number(record.id) || 0;
        case "grossPay":
        case "totalDeduction":
        case "netPay":
          return parseAmount(record[key]);
        case "payrollDate":
          return record.payrollDate || "";
        case "periodLabel":
          return buildPeriodLabel(record);
        default:
          return String(record[key] || "").toLowerCase();
      }
    };

    items.sort((left, right) => {
      const leftValue = valueFor(left);
      const rightValue = valueFor(right);

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
      }

      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
      return direction === "asc" ? comparison : -comparison;
    });

    return items;
  }, [filteredRecords, sortConfig]);

  const registryEntries = useMemo(
    () => {
      const query = searchQuery.trim().toLowerCase();
      const entries = buildRegistryEntries(filteredRecords);

      if (!query) {
        return entries;
      }

      return entries.filter((entry) => [
        entry.registryId,
        entry.division,
        entry.periodLabel,
        entry.status,
        entry.dateCreated,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)));
    },
    [filteredRecords, searchQuery]
  );
  const displayedRows = isRegistryView ? registryEntries : sortedRecords;
  const totalPages = Math.max(1, Math.ceil(displayedRows.length / rowsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * rowsPerPage;
    return displayedRows.slice(startIndex, startIndex + rowsPerPage);
  }, [displayedRows, rowsPerPage, safeCurrentPage]);
  const selectedPayrollIdSet = useMemo(
    () => new Set(selectedPayrollIds.map((id) => String(id))),
    [selectedPayrollIds]
  );
  const bulkFailedPayrollIdSet = useMemo(
    () => new Set(bulkFailedPayrollIds.map((id) => String(id))),
    [bulkFailedPayrollIds]
  );
  const selectedPayrollRecords = useMemo(
    () => records.filter((record) => selectedPayrollIdSet.has(String(record.id))),
    [records, selectedPayrollIdSet]
  );
  const visibleSelectableRecords = useMemo(
    () => paginatedRecords.filter((record) => record.status !== "Archived"),
    [paginatedRecords]
  );
  const allVisiblePayrollsSelected = visibleSelectableRecords.length > 0
    && visibleSelectableRecords.every((record) => selectedPayrollIdSet.has(String(record.id)));
  const selectedCount = selectedPayrollIds.length;

  const applyUpdatedRecords = useCallback((updatedRecords = []) => {
    const updatedById = new Map(
      updatedRecords
        .filter((record) => record?.id)
        .map((record) => [String(record.id), record])
    );

    if (updatedById.size === 0) {
      return;
    }

    setRecords((current) => current.map((record) => updatedById.get(String(record.id)) || record));
    setViewRecord((current) => (current?.id ? updatedById.get(String(current.id)) || current : current));
    setRegistryDetailEntry((current) => {
      if (!current?.records?.length) {
        return current;
      }

      const records = current.records.map((record) => updatedById.get(String(record.id)) || record);
      return buildRegistryEntries(records)[0] || current;
    });
  }, []);

  const applyUpdatedRecord = useCallback((record) => {
    if (record?.id) {
      applyUpdatedRecords([record]);
    }
  }, [applyUpdatedRecords]);

  const resolveActionUpdatedRecords = useCallback((sourceRecords = [], ids = [], updatedRecords = [], status = "") => {
    const updatedById = new Map(
      updatedRecords
        .filter((record) => record?.id)
        .map((record) => [String(record.id), record])
    );
    const sourceById = new Map(
      sourceRecords
        .filter((record) => record?.id)
        .map((record) => [String(record.id), record])
    );
    const currentById = new Map(
      records
        .filter((record) => record?.id)
        .map((record) => [String(record.id), record])
    );

    return ids
      .map((id) => {
        const key = String(id);
        const record = updatedById.get(key) || sourceById.get(key) || currentById.get(key);
        return record ? { ...record, status: status || record.status } : null;
      })
      .filter(Boolean);
  }, [records]);

  const refreshActionStatusFromServer = useCallback(async (ids = [], acceptedStatuses = []) => {
    const idSet = new Set(ids.map((id) => String(id)).filter(Boolean));
    const acceptedStatusSet = new Set(acceptedStatuses);

    if (idSet.size === 0 || acceptedStatusSet.size === 0) {
      return false;
    }

    const result = await fetchPayrollRecords();
    const latestRecords = Array.isArray(result.records) ? result.records : [];
    const actionRecords = latestRecords.filter((record) => idSet.has(String(record.id)));
    const actionSucceeded = actionRecords.length === idSet.size
      && actionRecords.every((record) => acceptedStatusSet.has(record.status));

    setRecords(latestRecords);
    applyUpdatedRecords(actionRecords);

    return actionSucceeded;
  }, [applyUpdatedRecords]);

  const waitForActionStatusFromServer = useCallback(async (ids = [], acceptedStatuses = []) => {
    for (const delay of ACTION_STATUS_VERIFY_DELAYS_MS) {
      await wait(delay);

      try {
        const actionSucceeded = await refreshActionStatusFromServer(ids, acceptedStatuses);
        if (actionSucceeded) {
          return true;
        }
      } catch {
        // Try again; the original action may still be finishing on the server.
      }
    }

    return false;
  }, [refreshActionStatusFromServer]);

  const waitForActionRequestOrStatus = useCallback(async (requestPromise, ids = [], acceptedStatuses = []) => {
    const requestOutcome = Promise.resolve(requestPromise)
      .then((result) => ({ type: "response", result }))
      .catch((error) => ({ type: "error", error }));
    const statusOutcome = waitForActionStatusFromServer(ids, acceptedStatuses)
      .then((confirmed) => ({ type: confirmed ? "confirmed" : "unconfirmed" }))
      .catch(() => ({ type: "unconfirmed" }));

    return Promise.race([requestOutcome, statusOutcome]);
  }, [waitForActionStatusFromServer]);

  useEffect(() => {
    setSelectedPayrollIds((current) => current.filter((id) => records.some((record) => String(record.id) === String(id))));
    setBulkFailedPayrollIds((current) => current.filter((id) => records.some((record) => String(record.id) === String(id))));
  }, [records]);

  const openCreateModal = () => {
    setEditingRecord(null);
    setForm(emptyFormState(allowanceDefaults));
    setFormOpen(true);
  };

  const openGenerateModal = () => {
    setGeneratedPayroll(emptyGeneratedPayrollState());
    setSelectedGeneratedEmployeeIds([]);
    setPayrollPreviewRecords([]);
    setPayrollPreviewError("");
    setGenerateModalOpen(true);
  };

  const closeFormModal = () => {
    if (saving) {
      return;
    }

    setFormOpen(false);
    setEditingRecord(null);
    setForm(emptyFormState(allowanceDefaults));
  };

  const closeGenerateModal = (force = false) => {
    if (processingGeneratedPayroll && !force) {
      return;
    }

    setGenerateModalOpen(false);
    setGeneratedPayroll(emptyGeneratedPayrollState());
    setSelectedGeneratedEmployeeIds([]);
    setPayrollPreviewRecords([]);
    setPayrollPreviewError("");
  };

  const applyEmployeeSelection = (employee) => {
    const approvedCashAdvanceAmount = approvedCashAdvanceAmountForEmployee(employee.employeeRecordId);

    setForm((current) => ({
      ...current,
      employeeRecordId: String(employee.employeeRecordId || ""),
      employeeId: employee.employeeId || "",
      employeeName: employee.employeeName || "",
      designation: employee.designation || "",
      division: employee.division || "",
      basicSalary: employee.basicSalary ? String(employee.basicSalary) : "",
      manualCashAdvanceAdjustment: String(approvedCashAdvanceAmount),
    }));
  };

  const handleTogglePayrollSelection = useCallback((payrollId) => {
    const normalizedId = String(payrollId || "");
    if (!normalizedId) {
      return;
    }

    setSelectedPayrollIds((current) => (
      current.some((id) => String(id) === normalizedId)
        ? current.filter((id) => String(id) !== normalizedId)
        : [...current, normalizedId]
    ));
  }, []);

  const handleToggleVisiblePayrollSelection = useCallback(() => {
    const visibleIds = visibleSelectableRecords.map((record) => String(record.id));

    if (visibleIds.length === 0) {
      return;
    }

    if (allVisiblePayrollsSelected) {
      const visibleIdSet = new Set(visibleIds);
      setSelectedPayrollIds((current) => current.filter((id) => !visibleIdSet.has(String(id))));
      return;
    }

    setSelectedPayrollIds((current) => Array.from(new Set([...current.map(String), ...visibleIds])));
  }, [allVisiblePayrollsSelected, visibleSelectableRecords]);

  const handleApproveRegistryEntry = useCallback(async (entry) => {
    if (!entry?.records?.length) {
      return;
    }

    if (["Approved", "Paid", "Archived"].includes(entry.status)) {
      toast.error("This payroll has already been approved and cannot be modified.");
      return;
    }

    const actionableRecords = entry.records.filter((record) =>
      ["Draft", "Rejected", "Pending Approval"].includes(record.status)
    );
    const submitIds = actionableRecords
      .filter((record) => ["Draft", "Rejected"].includes(record.status))
      .map((record) => record.id);
    const approveIds = actionableRecords.map((record) => record.id);

    if (approveIds.length === 0) {
      toast.error("No payroll records are available for approval in this registry.");
      return;
    }

    const confirmation = await Swal.fire({
      title: "Approve Payroll Registry?",
      text: [
        `You are about to approve Payroll ID: ${entry.registryId}`,
        `Division: ${entry.division || "Unassigned"}`,
        `Total Employees: ${numberFormatter.format(entry.totalEmployees)}`,
        `Total Net Pay: ${formatCurrency(entry.totalNetPay)}`,
        "Once approved, this action cannot be undone.",
      ].join("\n"),
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Approve Payroll",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setRegistryActionLoading(true);
    try {
      Swal.fire({
        title: "Approving Payroll...",
        text: `Please wait while ${entry.registryId} is approved.`,
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      if (submitIds.length > 0) {
        const submitOutcome = await waitForActionRequestOrStatus(
          bulkSubmitForApproval(submitIds),
          submitIds,
          ["Pending Approval", "Approved", "Paid"]
        );

        if (submitOutcome.type === "error") {
          throw submitOutcome.error;
        }

        if (submitOutcome.type === "unconfirmed") {
          await Swal.fire({
            title: "Approval Still Processing",
            text: `Payroll ID ${entry.registryId} is taking longer than expected. The registry was refreshed; please check the status again in a moment.`,
            icon: "info",
            confirmButtonColor: "#0f766e",
          });
          return;
        }

        const submitResult = submitOutcome.result || {};
        const submittedRecords = resolveActionUpdatedRecords(
          entry.records,
          submitIds,
          Array.isArray(submitResult.records) ? submitResult.records : [],
          "Pending Approval"
        );
        applyUpdatedRecords(submittedRecords);
      }

      const approveOutcome = await waitForActionRequestOrStatus(
        bulkApprovePayroll(approveIds, `Approved from ${entry.registryId}`),
        approveIds,
        ["Approved", "Paid"]
      );

      if (approveOutcome.type === "confirmed") {
        await Swal.fire({
          title: "Payroll Approved",
          text: `Payroll ID ${entry.registryId} has been approved successfully.`,
          icon: "success",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      if (approveOutcome.type === "unconfirmed") {
        await Swal.fire({
          title: "Approval Still Processing",
          text: `Payroll ID ${entry.registryId} is taking longer than expected. The registry was refreshed; please check the status again in a moment.`,
          icon: "info",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      if (approveOutcome.type === "error") {
        throw approveOutcome.error;
      }

      const approveResult = approveOutcome.result || {};
      const failedIds = new Set((approveResult.failed || []).map((item) => String(item.id)));
      const successfulApproveIds = approveIds.filter((id) => !failedIds.has(String(id)));
      const approvedRecords = resolveActionUpdatedRecords(
        entry.records,
        successfulApproveIds,
        Array.isArray(approveResult.records) ? approveResult.records : [],
        "Approved"
      );
      applyUpdatedRecords(approvedRecords);

      if ((approveResult.failedCount || 0) > 0) {
        const approvedOnServer = await waitForActionStatusFromServer(approveIds, ["Approved", "Paid"]);
        if (approvedOnServer) {
          await Swal.fire({
            title: "Payroll Approved",
            text: `Payroll ID ${entry.registryId} has been approved successfully.`,
            icon: "success",
            confirmButtonColor: "#0f766e",
          });
          return;
        }

        await Swal.fire({
          title: "Approval Incomplete",
          text: approveResult.message || "Some payroll records could not be approved.",
          icon: "warning",
          confirmButtonColor: "#d97706",
        });
        return;
      }

      await Swal.fire({
        title: "Payroll Approved",
        text: `Payroll ID ${entry.registryId} has been approved successfully.`,
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (requestError) {
      const approvedOnServer = await waitForActionStatusFromServer(approveIds, ["Approved", "Paid"]);
      if (approvedOnServer) {
        await Swal.fire({
          title: "Payroll Approved",
          text: `Payroll ID ${entry.registryId} has been approved successfully.`,
          icon: "success",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      await Swal.fire({
        title: "Approval Failed",
        text: requestError.response?.data?.message || "Failed to approve payroll. Please try again or contact support.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setRegistryActionLoading(false);
    }
  }, [applyUpdatedRecords, resolveActionUpdatedRecords, waitForActionRequestOrStatus, waitForActionStatusFromServer]);

  const handleMarkRegistryPaid = useCallback(async (entry) => {
    if (!entry?.records?.length) {
      return;
    }

    const approvedIds = entry.records
      .filter((record) => record.status === "Approved")
      .map((record) => record.id)
      .filter(Boolean);

    if (approvedIds.length === 0) {
      toast.error("Only approved payroll records can be marked as paid.");
      return;
    }

    const confirmation = await Swal.fire({
      title: "Mark Payroll as Paid?",
      text: [
        `You are about to mark Payroll ID: ${entry.registryId} as paid.`,
        `Division: ${entry.division || "Unassigned"}`,
        `Total Employees: ${numberFormatter.format(approvedIds.length)}`,
        "Once paid, employees can view and download their payslips.",
      ].join("\n"),
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Mark as Paid",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setRegistryActionLoading(true);
    try {
      Swal.fire({
        title: "Marking Payroll Paid...",
        text: `Please wait while ${entry.registryId} is marked as paid.`,
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      const paidOutcome = await waitForActionRequestOrStatus(
        bulkMarkPaid(approvedIds),
        approvedIds,
        ["Paid"]
      );

      if (paidOutcome.type === "confirmed") {
        await Swal.fire({
          title: "Payroll Marked Paid",
          text: `Payroll ID ${entry.registryId} is paid. Payslips are now available for employees.`,
          icon: "success",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      if (paidOutcome.type === "unconfirmed") {
        await Swal.fire({
          title: "Payment Still Processing",
          text: `Payroll ID ${entry.registryId} is taking longer than expected. The registry was refreshed; please check the status again in a moment.`,
          icon: "info",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      if (paidOutcome.type === "error") {
        throw paidOutcome.error;
      }

      const result = paidOutcome.result || {};
      const failedIds = new Set((result.failed || []).map((item) => String(item.id)));
      const successfulPaidIds = approvedIds.filter((id) => !failedIds.has(String(id)));
      const paidRecords = resolveActionUpdatedRecords(
        entry.records,
        successfulPaidIds,
        Array.isArray(result.records) ? result.records : [],
        "Paid"
      );
      applyUpdatedRecords(paidRecords);

      if ((result.failedCount || 0) > 0) {
        const paidOnServer = await waitForActionStatusFromServer(approvedIds, ["Paid"]);
        if (paidOnServer) {
          await Swal.fire({
            title: "Payroll Marked Paid",
            text: `Payroll ID ${entry.registryId} is paid. Payslips are now available for employees.`,
            icon: "success",
            confirmButtonColor: "#0f766e",
          });
          return;
        }

        await Swal.fire({
          title: "Payment Update Incomplete",
          text: result.message || "Some payroll records could not be marked as paid.",
          icon: "warning",
          confirmButtonColor: "#d97706",
        });
        return;
      }

      await Swal.fire({
        title: "Payroll Marked Paid",
        text: `Payroll ID ${entry.registryId} is paid. Payslips are now available for employees.`,
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (requestError) {
      const paidOnServer = await waitForActionStatusFromServer(approvedIds, ["Paid"]);
      if (paidOnServer) {
        await Swal.fire({
          title: "Payroll Marked Paid",
          text: `Payroll ID ${entry.registryId} is paid. Payslips are now available for employees.`,
          icon: "success",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      await Swal.fire({
        title: "Payment Update Failed",
        text: requestError.response?.data?.message || "Unable to mark payroll as paid.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setRegistryActionLoading(false);
    }
  }, [applyUpdatedRecords, resolveActionUpdatedRecords, waitForActionRequestOrStatus, waitForActionStatusFromServer]);

  const handleArchiveAction = useCallback(async ({ record = null, entry = null, type = "archive" } = {}) => {
    if (!record && !entry) {
      return;
    }

    const isRegistryArchive = type === "archive-registry";
    const activeRegistryRecords = isRegistryArchive
      ? (entry?.records || []).filter((item) => item.status !== "Archived")
      : [];

    if (isRegistryArchive && activeRegistryRecords.length === 0) {
      toast.error("No active payroll records are available to archive.");
      return;
    }

    const title = isRegistryArchive ? "Archive Payroll Registry?" : "Archive Payroll Record?";
    const text = isRegistryArchive
      ? `Archive ${numberFormatter.format(activeRegistryRecords.length)} payroll record${activeRegistryRecords.length === 1 ? "" : "s"} from ${entry?.registryId || "this registry"}?`
      : `Archive payroll for ${record?.employeeName || "this employee"}?`;

    const confirmation = await Swal.fire({
      title,
      text: `${text} Archived records remain viewable for audit purposes but are removed from the active payroll registry.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: isRegistryArchive ? "Archive Registry" : "Archive Record",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setArchiveActionLoading(true);

    try {
      Swal.fire({
        title: "Archiving...",
        text: "Please wait while the payroll archive is updated.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      if (isRegistryArchive) {
        const ids = activeRegistryRecords.map((item) => item.id).filter(Boolean);
        const result = await bulkArchivePayroll(ids);
        applyUpdatedRecords(Array.isArray(result.records) ? result.records : []);

        if ((result.failedCount || 0) > 0) {
          await Swal.fire({
            title: "Archive Incomplete",
            text: result.message || "Some payroll records could not be archived.",
            icon: "warning",
            confirmButtonColor: "#D61E1E",
          });
          return;
        }

        await Swal.fire({
          title: "Archived",
          text: result.message || "Payroll registry archived successfully.",
          icon: "success",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      const result = await archivePayrollRecord(record.id);
      applyUpdatedRecord(result.record);

      await Swal.fire({
        title: "Archived",
        text: result.message || "Payroll record archived successfully.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (requestError) {
      await Swal.fire({
        title: "Archive Failed",
        text: requestError.response?.data?.message || "Unable to update payroll status.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setArchiveActionLoading(false);
    }
  }, [applyUpdatedRecord, applyUpdatedRecords]);

  const openArchiveRegistryConfirmation = useCallback((entry) => {
    if (!entry?.records?.length || entry.status === "Archived") {
      return;
    }

    void handleArchiveAction({ type: "archive-registry", entry });
  }, [handleArchiveAction]);

  const handleSubmitForApproval = useCallback(async (record) => {
    if (!record || !["Draft", "Rejected"].includes(record.status)) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Submit Payroll for Approval?",
      text: `${record.employeeName || "This payroll record"} will be sent to HR Head/Admin for review.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Submit",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setDrawerActionLoading(true);
    try {
      Swal.fire({
        title: "Submitting...",
        text: "Please wait while the payroll is submitted.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      const result = await submitPayrollForApproval(record.id);
      applyUpdatedRecord(result.record);

      await Swal.fire({
        title: "Submitted",
        text: result?.message || "Payroll submitted for approval.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (requestError) {
      await Swal.fire({
        title: "Submit Failed",
        text: requestError.response?.data?.message || "Unable to submit payroll for approval.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setDrawerActionLoading(false);
    }
  }, [applyUpdatedRecord]);

  const handleApprovePayroll = useCallback(async (record) => {
    if (!record || record.status !== "Pending Approval") {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Approve Payroll?",
      input: "textarea",
      inputPlaceholder: "Optional approval comments",
      inputAttributes: { "aria-label": "Approval comments" },
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Approve",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setDrawerActionLoading(true);
    try {
      Swal.fire({
        title: "Approving...",
        text: "Please wait while the payroll is approved.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      const result = await approvePayroll(record.id, confirmation.value || "");
      applyUpdatedRecord(result.record);

      await Swal.fire({
        title: "Approved",
        text: result?.message || "Payroll approved successfully.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (requestError) {
      try {
        const approvedOnServer = await refreshActionStatusFromServer([record.id], ["Approved", "Paid"]);
        if (approvedOnServer) {
          await Swal.fire({
            title: "Approved",
            text: "Payroll approved successfully.",
            icon: "success",
            confirmButtonColor: "#0f766e",
          });
          return;
        }
      } catch {
        // Fall through to the original error alert if the verification request also fails.
      }

      await Swal.fire({
        title: "Approval Failed",
        text: requestError.response?.data?.message || "Unable to approve payroll.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setDrawerActionLoading(false);
    }
  }, [applyUpdatedRecord, refreshActionStatusFromServer]);

  const handleRejectPayroll = useCallback(async (record) => {
    if (!record || record.status !== "Pending Approval") {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Reject Payroll?",
      input: "textarea",
      inputPlaceholder: "Enter the reason for rejection",
      inputAttributes: { "aria-label": "Rejection reason" },
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Reject",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      inputValidator: (value) => (String(value || "").trim() ? undefined : "Rejection comments are required."),
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setDrawerActionLoading(true);
    try {
      Swal.fire({
        title: "Rejecting...",
        text: "Please wait while the payroll is returned for correction.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      const result = await rejectPayroll(record.id, confirmation.value);
      applyUpdatedRecord(result.record);

      await Swal.fire({
        title: "Rejected",
        text: result?.message || "Payroll rejected and returned for correction.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (requestError) {
      await Swal.fire({
        title: "Rejection Failed",
        text: requestError.response?.data?.message || "Unable to reject payroll.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setDrawerActionLoading(false);
    }
  }, [applyUpdatedRecord]);

  const handleMarkPaidClick = useCallback(async (record) => {
    if (!record || record.status !== "Approved") {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Mark Payroll as Paid?",
      text: `Once confirmed, ${record.employeeName || "this payroll record"}'s approved payroll will be marked as paid.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, mark paid",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setDrawerActionLoading(true);
    try {
      Swal.fire({
        title: "Marking paid...",
        text: "Please wait while the payroll status is updated.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await markPayrollPaid(record.id);
      applyUpdatedRecord(result.record);

      await Swal.fire({
        title: "Payroll Marked Paid",
        text: result?.message || "Payroll record marked as paid.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (requestError) {
      try {
        const paidOnServer = await refreshActionStatusFromServer([record.id], ["Paid"]);
        if (paidOnServer) {
          await Swal.fire({
            title: "Payroll Marked Paid",
            text: "Payroll record marked as paid.",
            icon: "success",
            confirmButtonColor: "#0f766e",
          });
          return;
        }
      } catch {
        // Fall through to the original error alert if the verification request also fails.
      }

      await Swal.fire({
        title: "Update Failed",
        text: requestError.response?.data?.message || "Unable to update payroll status.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setDrawerActionLoading(false);
    }
  }, [applyUpdatedRecord, refreshActionStatusFromServer]);

  const handleBulkAction = useCallback(async (type) => {
    const ids = selectedPayrollRecords.map((record) => record.id).filter(Boolean);
    if (ids.length === 0) {
      toast.error("Select at least one payroll record.");
      return;
    }

    const actionConfig = {
      submit: {
        title: "Submit Selected Payrolls?",
        text: `${ids.length} payroll record${ids.length === 1 ? "" : "s"} will be submitted for approval.`,
        confirmButtonText: "Submit selected",
        loadingText: "Submitting payrolls...",
        successTitle: "Payrolls Submitted",
        partialTitle: "Submission Incomplete",
        errorTitle: "Submission Failed",
        targetStatus: "Pending Approval",
        request: () => bulkSubmitForApproval(ids),
      },
      approve: {
        title: "Approve Selected Payrolls?",
        text: `${ids.length} payroll record${ids.length === 1 ? "" : "s"} will be approved.`,
        confirmButtonText: "Approve selected",
        loadingText: "Approving payrolls...",
        successTitle: "Payrolls Approved",
        partialTitle: "Approval Incomplete",
        errorTitle: "Approval Failed",
        targetStatus: "Approved",
        request: () => bulkApprovePayroll(ids),
      },
      paid: {
        title: "Mark Selected as Paid?",
        text: `${ids.length} payroll record${ids.length === 1 ? "" : "s"} will be marked as paid.`,
        confirmButtonText: "Mark paid",
        loadingText: "Marking payrolls paid...",
        successTitle: "Payrolls Marked Paid",
        partialTitle: "Payment Update Incomplete",
        errorTitle: "Payment Update Failed",
        targetStatus: "Paid",
        request: () => bulkMarkPaid(ids),
      },
    };

    let config = actionConfig[type];
    let reason = "";

    if (type === "reject") {
      const rejection = await Swal.fire({
        title: "Reject Selected Payrolls?",
        input: "textarea",
        inputPlaceholder: "Enter rejection comments for all selected payrolls",
        inputAttributes: { "aria-label": "Bulk rejection comments" },
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Reject selected",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#dc2626",
        cancelButtonColor: "#64748b",
        reverseButtons: true,
        inputValidator: (value) => (String(value || "").trim() ? undefined : "Rejection comments are required."),
      });

      if (!rejection.isConfirmed) {
        return;
      }

      reason = rejection.value;
      config = {
        successTitle: "Payrolls Rejected",
        partialTitle: "Rejection Incomplete",
        errorTitle: "Rejection Failed",
        loadingText: "Rejecting payrolls...",
        targetStatus: "Rejected",
        request: () => bulkRejectPayroll(ids, reason),
      };
    } else {
      const confirmation = await Swal.fire({
        title: config.title,
        text: config.text,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: config.confirmButtonText,
        cancelButtonText: "Cancel",
        confirmButtonColor: "#D61E1E",
        cancelButtonColor: "#64748b",
        reverseButtons: true,
        focusCancel: true,
      });

      if (!confirmation.isConfirmed) {
        return;
      }
    }

    setBulkProcessing(true);
    try {
      Swal.fire({
        title: config.loadingText,
        text: "Please wait while the selected payroll records are updated.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      const result = await config.request();
      const failedIds = new Set((result.failed || []).map((item) => String(item.id)));
      const successfulIds = ids.filter((id) => !failedIds.has(String(id)));
      const updatedRecords = resolveActionUpdatedRecords(
        selectedPayrollRecords,
        successfulIds,
        Array.isArray(result.records) ? result.records : [],
        config.targetStatus
      );
      applyUpdatedRecords(updatedRecords);

      setSelectedPayrollIds((current) => current.filter((id) => failedIds.has(String(id))));
      setBulkFailedPayrollIds(Array.from(failedIds));

      const summary = result?.message || `${result.successCount || 0} updated, ${result.failedCount || 0} failed.`;
      if ((result.failedCount || 0) > 0 && (result.successCount || 0) === 0) {
        await Swal.fire({
          title: config.partialTitle || "Payroll Action Incomplete",
          text: summary,
          icon: "warning",
          confirmButtonColor: "#d97706",
        });
      } else {
        await Swal.fire({
          title: (result.failedCount || 0) > 0 ? (config.partialTitle || "Payroll Action Incomplete") : (config.successTitle || "Payroll Updated"),
          text: summary,
          icon: (result.failedCount || 0) > 0 ? "warning" : "success",
          confirmButtonColor: (result.failedCount || 0) > 0 ? "#d97706" : "#0f766e",
        });
      }
    } catch (requestError) {
      try {
        const acceptedStatuses = config.targetStatus === "Approved"
          ? ["Approved", "Paid"]
          : [config.targetStatus].filter(Boolean);
        const succeededOnServer = await refreshActionStatusFromServer(ids, acceptedStatuses);
        if (succeededOnServer) {
          setSelectedPayrollIds([]);
          setBulkFailedPayrollIds([]);
          await Swal.fire({
            title: config.successTitle || "Payroll Updated",
            text: type === "approve"
              ? `${ids.length} payroll record${ids.length === 1 ? "" : "s"} approved.`
              : type === "paid"
                ? `${ids.length} payroll record${ids.length === 1 ? "" : "s"} marked as paid.`
                : `${ids.length} payroll record${ids.length === 1 ? "" : "s"} updated.`,
            icon: "success",
            confirmButtonColor: "#0f766e",
          });
          return;
        }
      } catch {
        // Fall through to the original error alert if the verification request also fails.
      }

      await Swal.fire({
        title: config.errorTitle || "Payroll Action Failed",
        text: requestError.response?.data?.message || "Unable to complete the bulk payroll action.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
      setBulkFailedPayrollIds(ids.map(String));
    } finally {
      setBulkProcessing(false);
    }
  }, [applyUpdatedRecords, refreshActionStatusFromServer, resolveActionUpdatedRecords, selectedPayrollRecords]);

  const registryColumns = useMemo(
    () => [
      {
        key: "registryId",
        header: "Payroll ID",
        headerClassName: "w-[130px]",
        render: (row) => (
          <span className="font-semibold text-slate-950">{row.registryId}</span>
        ),
      },
      {
        key: "totalEmployees",
        header: "No. of Employees",
        headerClassName: "w-[140px]",
        render: (row) => numberFormatter.format(row.totalEmployees),
      },
      {
        key: "division",
        header: "Division",
        headerClassName: "w-[140px]",
        render: (row) => (
          <span className="block truncate font-semibold text-slate-900" title={row.division}>
            {row.division || "Unassigned"}
          </span>
        ),
      },
      {
        key: "employmentType",
        header: "Employment Type",
        headerClassName: "w-[160px]",
        render: (row) => {
          const types = Array.isArray(row.employmentTypes) && row.employmentTypes.length > 0
            ? row.employmentTypes
            : ["Unspecified"];

          return (
            <div className="flex flex-wrap gap-1">
              {types.map((type) => (
                <span
                  key={type}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700"
                >
                  {type}
                </span>
              ))}
            </div>
          );
        },
      },
      {
        key: "periodLabel",
        header: "Pay Period",
        headerClassName: "w-[260px]",
        render: (row) => (
          <span className="block truncate text-sm text-slate-700" title={row.periodLabel}>
            {row.periodLabel}
          </span>
        ),
      },
      {
        key: "dateCreated",
        header: "Date Created",
        headerClassName: "w-[130px]",
        render: (row) => formatDisplayDate(row.dateCreated),
      },
      {
        key: "status",
        header: "Status",
        headerClassName: "w-[120px] text-center",
        cellClassName: "text-center",
        render: (row) => <PayrollStatusBadge status={row.status} compact />,
      },
      {
        key: "totalGrossPay",
        header: "Total Gross",
        headerClassName: "w-[140px]",
        render: (row) => (
          <span className="font-semibold text-slate-900">{formatCurrency(row.totalGrossPay)}</span>
        ),
      },
      {
        key: "totalDeductions",
        header: "Total Deductions",
        headerClassName: "w-[150px]",
        render: (row) => (
          <span className="text-slate-950">{formatCurrency(row.totalDeductions)}</span>
        ),
      },
      {
        key: "totalNetPay",
        header: "Total Net Pay",
        headerClassName: "w-[140px]",
        render: (row) => (
          <span className="text-slate-950">{formatCurrency(row.totalNetPay)}</span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        headerClassName: "w-[150px]",
        cellClassName: "text-left",
        render: (row) => (
          <div className="flex flex-nowrap items-center justify-start gap-2">
            <ActionIconButton
              label="View payroll registry"
              icon={faEye}
              tone="view"
              className="h-8 w-8"
              onClick={() => setRegistryDetailEntry(row)}
            />
            {canApprovePayroll && !["Approved", "Paid", "Archived"].includes(row.status) ? (
              <ActionIconButton
                label="Approve payroll registry"
                icon={faCheck}
                tone="approve"
                className="h-8 w-8"
                onClick={() => handleApproveRegistryEntry(row)}
              />
            ) : null}
            {canApprovePayroll && row.status === "Approved" ? (
              <ActionIconButton
                label="Mark registry as paid"
                icon={faMoneyBillWave}
                tone="approve"
                className="h-8 w-8"
                onClick={() => handleMarkRegistryPaid(row)}
              />
            ) : null}
            {canApprovePayroll && row.status !== "Archived" ? (
              <ActionIconButton
                label="Archive payroll registry"
                icon={faBoxArchive}
                tone="archive"
                className="h-8 w-8"
                onClick={() => openArchiveRegistryConfirmation(row)}
              />
            ) : null}
          </div>
        ),
      },
    ],
    [canApprovePayroll, handleApproveRegistryEntry, handleMarkRegistryPaid, openArchiveRegistryConfirmation]
  );

  const columns = useMemo(
    () => {
      const compactHeaderClassName = "px-2 py-2 text-[10px]";
      const compactCellClassName = "px-2 py-2 text-[11px] leading-4";
      const compactAmountCellClassName = `${compactCellClassName} whitespace-nowrap`;

      return [
        {
          key: "select",
          header: (
            <input
              type="checkbox"
              aria-label="Select visible payroll records"
              checked={allVisiblePayrollsSelected}
              disabled={visibleSelectableRecords.length === 0}
              onChange={handleToggleVisiblePayrollSelection}
              className="h-4 w-4 rounded border-slate-300 accent-[#D61E1E] focus:ring-[#D61E1E]/20 disabled:cursor-not-allowed"
            />
          ),
          headerClassName: `${compactHeaderClassName} w-[46px] text-center`,
          cellClassName: `${compactCellClassName} text-center`,
          render: (row) => (
            <input
              type="checkbox"
              aria-label={`Select ${row.employeeName || "payroll record"}`}
              checked={selectedPayrollIdSet.has(String(row.id))}
              disabled={row.status === "Archived"}
              onChange={() => handleTogglePayrollSelection(row.id)}
              className="h-4 w-4 rounded border-slate-300 accent-[#D61E1E] focus:ring-[#D61E1E]/20 disabled:cursor-not-allowed"
            />
          ),
        },
        {
          key: "payrollId",
          header: "Payroll ID",
          headerClassName: `${compactHeaderClassName} w-[110px]`,
          cellClassName: `${compactCellClassName} max-w-[110px] whitespace-nowrap`,
          render: (row) => {
            const payrollIdLabel = getPayrollIdLabel(row);
            const isFailed = bulkFailedPayrollIdSet.has(String(row.id));
            return (
              <span
                className={`block truncate rounded px-1.5 py-1 font-semibold ${
                  isFailed ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "text-slate-900"
                }`}
                title={isFailed ? `${payrollIdLabel} failed in the last bulk action` : payrollIdLabel}
              >
                {payrollIdLabel}
              </span>
            );
          },
        },
        {
          key: "employeeName",
          header: "Employee",
          headerClassName: `${compactHeaderClassName} w-[170px]`,
          cellClassName: `${compactCellClassName} max-w-[170px]`,
          render: (row) => (
            <div className="min-w-0">
              <span className="block truncate font-semibold text-slate-900" title={row.employeeName || "N/A"}>
                {row.employeeName || "N/A"}
              </span>
            </div>
          ),
        },
        {
          key: "employeeId",
          header: "Employee ID",
          headerClassName: `${compactHeaderClassName} w-[105px]`,
          cellClassName: `${compactCellClassName} max-w-[105px] whitespace-nowrap`,
          render: (row) => <span className="block truncate" title={row.employeeId || "N/A"}>{row.employeeId || "N/A"}</span>,
        },
        {
          key: "designation",
          header: "Designation",
          headerClassName: `${compactHeaderClassName} w-[150px]`,
          cellClassName: `${compactCellClassName} max-w-[150px]`,
          render: (row) => <span className="block truncate" title={row.designation || "N/A"}>{row.designation || "N/A"}</span>,
        },
        {
          key: "payPeriod",
          header: "Pay Period",
          headerClassName: `${compactHeaderClassName} w-[100px]`,
          cellClassName: `${compactCellClassName} max-w-[100px]`,
          render: (row) => <span className="block truncate font-semibold text-slate-700" title={row.payPeriod || "N/A"}>{row.payPeriod || "N/A"}</span>,
        },
        {
          key: "periodLabel",
          header: "Period Date Range",
          headerClassName: `${compactHeaderClassName} w-[170px]`,
          cellClassName: `${compactCellClassName} max-w-[170px]`,
          render: (row) => {
            const dateRange = `${row.startDate || "N/A"} to ${row.endDate || "N/A"}`;
            return <span className="block truncate text-xs text-slate-600" title={dateRange}>{dateRange}</span>;
          },
        },
        {
          key: "grossPay",
          header: "Gross (Before Attendance)",
          headerClassName: `${compactHeaderClassName} w-[150px]`,
          cellClassName: compactAmountCellClassName,
          render: (row) => formatCurrency(row.grossPay),
        },
        {
          key: "totalDeduction",
          header: "Deductions",
          headerClassName: `${compactHeaderClassName} w-[110px]`,
          cellClassName: `${compactAmountCellClassName} text-slate-950`,
          render: (row) => formatCurrency(row.totalDeduction),
        },
        {
          key: "netPay",
          header: "Net Pay",
          headerClassName: `${compactHeaderClassName} w-[110px]`,
          cellClassName: `${compactAmountCellClassName} text-slate-950`,
          render: (row) => <span className="text-slate-950">{formatCurrency(row.netPay)}</span>,
        },
        {
          key: "status",
          header: "Status",
          headerClassName: `${compactHeaderClassName} w-[100px]`,
          cellClassName: `${compactCellClassName} text-center`,
          render: (row) => <PayrollStatusBadge status={row.status} compact />,
        },
        {
          key: "actions",
          header: "Actions",
          headerClassName: `${compactHeaderClassName} w-[150px] text-center`,
          cellClassName: `${compactCellClassName} whitespace-nowrap`,
          render: (row) => (
            <div className="flex flex-nowrap items-center justify-end gap-1">
              {canSubmitPayroll && ["Draft", "Rejected"].includes(row.status) ? (
                <ActionIconButton
                  label="Submit for approval"
                  icon={faPaperPlane}
                  tone="review"
                  className="h-7 w-7"
                  onClick={() => handleSubmitForApproval(row)}
                />
              ) : null}
              {canApprovePayroll && row.status === "Pending Approval" ? (
                <>
                  <ActionIconButton
                    label="Approve payroll"
                    icon={faCheck}
                    tone="approve"
                    className="h-7 w-7"
                    onClick={() => handleApprovePayroll(row)}
                  />
                  <ActionIconButton
                    label="Reject payroll"
                    icon={faXmark}
                    tone="reject"
                    className="h-7 w-7"
                    onClick={() => handleRejectPayroll(row)}
                  />
                </>
              ) : null}
              {canApprovePayroll && row.status === "Approved" ? (
                <ActionIconButton
                  label="Mark payroll as paid"
                  icon={faMoneyBillWave}
                  tone="approve"
                  className="h-7 w-7"
                  onClick={() => handleMarkPaidClick(row)}
                />
              ) : null}
              <ActionIconButton
                label="View payroll record"
                icon={faEye}
                tone="view"
                className="h-7 w-7"
                onClick={() => setViewRecord(row)}
              />
              {row.status !== "Archived" ? (
                <>
                  <ActionIconButton
                    label="Edit payroll record"
                    icon={faPen}
                    tone="edit"
                    className="h-7 w-7"
                    disabled={!canSubmitPayroll || !row.isEditable}
                    onClick={() => {
                      setEditingRecord(row);
                      setForm(buildFormState(row, allowanceDefaults));
                      setFormOpen(true);
                    }}
                  />
                  {canApprovePayroll ? (
                    <ActionIconButton
                      label="Archive payroll record"
                      icon={faBoxArchive}
                      tone="archive"
                      className="h-7 w-7"
                      disabled={archiveActionLoading}
                      onClick={() => handleArchiveAction({ type: "archive", record: row })}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          ),
        },
      ];
    },
    [
      allVisiblePayrollsSelected,
      allowanceDefaults,
      bulkFailedPayrollIdSet,
      canApprovePayroll,
      canSubmitPayroll,
      handleApprovePayroll,
      handleArchiveAction,
      handleMarkPaidClick,
      handleRejectPayroll,
      handleSubmitForApproval,
      handleTogglePayrollSelection,
      handleToggleVisiblePayrollSelection,
      selectedPayrollIdSet,
      visibleSelectableRecords.length,
      archiveActionLoading,
    ]
  );

  const handleSave = async () => {
    if (!form.employeeRecordId || !form.payPeriod || !form.startDate || !form.endDate) {
      toast.error("Complete the employee and pay period details first.");
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload(form);
      const result = editingRecord
        ? await updatePayroll(editingRecord.id, payload)
        : await createPayroll(payload);

      setRecords((current) => {
        if (editingRecord) {
          return current.map((record) => (record.id === result.record.id ? result.record : record));
        }

        return [result.record, ...current];
      });

      toast.success(result.message || (editingRecord ? "Payroll updated." : "Payroll created."));
      closeFormModal();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to save payroll record.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleGeneratedEmployee = (employeeRecordId) => {
    const normalizedId = String(employeeRecordId || "");

    setSelectedGeneratedEmployeeIds((current) => (
      current.some((id) => String(id) === normalizedId)
        ? current.filter((id) => String(id) !== normalizedId)
        : [...current, normalizedId]
    ));
  };

  const handleToggleAllGeneratedEmployees = () => {
    if (allGeneratedEmployeesSelected) {
      const visibleIds = new Set(filteredGeneratedEmployees.map((employee) => String(employee.employeeRecordId)));
      setSelectedGeneratedEmployeeIds((current) => current.filter((id) => !visibleIds.has(String(id))));
      return;
    }

    setSelectedGeneratedEmployeeIds((current) => {
      const next = new Set(current.map((id) => String(id)));
      filteredGeneratedEmployees.forEach((employee) => {
        next.add(String(employee.employeeRecordId));
      });
      return Array.from(next);
    });
  };

  const handleProcessGeneratedPayroll = async () => {
    if (!generatedPayroll.startDate || !generatedPayroll.endDate) {
      toast.error("Select the payroll start and end dates first.");
      return;
    }

    if (generatedPayroll.startDate > generatedPayroll.endDate) {
      toast.error("Pay period end must be on or after the start date.");
      return;
    }

    if (selectedGeneratedEmployeeIds.length === 0) {
      // Distinguish "you forgot to tick someone" from "this employment type has no employees",
      // which otherwise looks like the button is broken.
      const activeType = generatedPayroll.employmentType;
      const noneMatchFilter = filteredGeneratedEmployees.length === 0;

      await Swal.fire({
        title: "No Employees Selected",
        text: noneMatchFilter && activeType
          ? `No ${activeType} employees match the current filters, so there is nothing to process. Check the Employment Type and Division filters, or confirm that ${activeType} employees exist in the employee records.`
          : noneMatchFilter
            ? "No employees match the current filters. Adjust the Employment Type, Division, or search filters and try again."
            : "Tick at least one employee in the list before processing payroll.",
        icon: "warning",
        confirmButtonColor: "#0f766e",
      });
      return;
    }

    const payPeriod = generatedPayroll.payPeriod || inferPayPeriod(generatedPayroll.startDate, generatedPayroll.endDate);
    if (!payPeriod) {
      toast.error("Select a pay period or choose dates that match a payroll period.");
      return;
    }

    const duplicateKeys = new Set(
      records
        .filter((record) => record.status !== "Archived")
        .map((record) => `${record.employeeRecordId}|${record.startDate}|${record.endDate}`)
    );

    const selectedEmployees = sortedEmployeeOptions.filter((employee) =>
      selectedGeneratedEmployeeIdSet.has(String(employee.employeeRecordId))
    );

    // Selections survive filter changes, so report what is actually queued rather than what
    // the Employment Type dropdown currently shows.
    const selectedTypeCounts = selectedEmployees.reduce((counts, employee) => {
      const label = normalizeEmploymentTypeLabel(employee.employmentType) || "Unspecified";
      counts.set(label, (counts.get(label) || 0) + 1);
      return counts;
    }, new Map());
    const selectedTypeSummary = Array.from(selectedTypeCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count]) => `${type}: ${numberFormatter.format(count)}`)
      .join(", ");

    const confirmation = await Swal.fire({
      title: "Process Payroll?",
      text: [
        `Employees: ${numberFormatter.format(selectedEmployees.length)}`,
        `Employment Type: ${selectedTypeSummary || "Unspecified"}`,
        `Division: ${generatedPayroll.division || "All Divisions"}`,
        `Pay Period: ${payPeriod} (${generatedPayroll.startDate} to ${generatedPayroll.endDate})`,
        "Draft payroll records will be generated for each selected employee.",
      ].join("\n"),
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Process Payroll",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    let duplicateCount = 0;
    let failureCount = 0;
    let lastFailureMessage = "";
    const createdRecords = [];

    setProcessingGeneratedPayroll(true);
    Swal.fire({
      title: "Processing Payroll...",
      text: `Generating payroll for ${numberFormatter.format(selectedEmployees.length)} employee${selectedEmployees.length === 1 ? "" : "s"}.`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      for (const employee of selectedEmployees) {
        const duplicateKey = `${employee.employeeRecordId}|${generatedPayroll.startDate}|${generatedPayroll.endDate}`;
        if (duplicateKeys.has(duplicateKey)) {
          duplicateCount += 1;
          continue;
        }

        try {
          const result = await createPayroll({
            ...buildGeneratedPayrollPayload(
              employee,
              generatedPayroll,
              allowanceDefaults,
              approvedCashAdvanceAmountForEmployee(employee.employeeRecordId)
            ),
            payPeriod,
          });

          if (result?.record) {
            createdRecords.push(result.record);
            duplicateKeys.add(duplicateKey);
          }
        } catch (requestError) {
          failureCount += 1;
          lastFailureMessage = requestError.response?.data?.message || "Unable to generate one or more payroll records.";
        }
      }

      if (createdRecords.length > 0) {
        setRecords((current) => [...createdRecords, ...current]);
      }

      const generatedTypeSummary = Array.from(
        createdRecords.reduce((counts, record) => {
          const label = normalizeEmploymentTypeLabel(record.employmentType) || "Unspecified";
          counts.set(label, (counts.get(label) || 0) + 1);
          return counts;
        }, new Map())
      )
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([type, count]) => `${type}: ${numberFormatter.format(count)}`)
        .join(", ");

      if (createdRecords.length === 0 && duplicateCount > 0 && failureCount === 0) {
        await Swal.fire({
          title: "Already Processed",
          text: `All ${numberFormatter.format(duplicateCount)} selected employee${duplicateCount === 1 ? " already has a payroll record" : "s already have payroll records"} for ${payPeriod} (${generatedPayroll.startDate} to ${generatedPayroll.endDate}).`,
          icon: "info",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      if (createdRecords.length === 0) {
        await Swal.fire({
          title: "Payroll Not Processed",
          text: lastFailureMessage || "No payroll records were generated.",
          icon: "error",
          confirmButtonColor: "#0f766e",
        });
        return;
      }

      const totalNetPay = createdRecords.reduce((total, record) => total + parseAmount(record.netPay), 0);

      await Swal.fire({
        title: failureCount > 0 ? "Payroll Partially Processed" : "Payroll Processed",
        text: [
          `Records Generated: ${numberFormatter.format(createdRecords.length)}`,
          `Employment Type: ${generatedTypeSummary || "Unspecified"}`,
          `Pay Period: ${payPeriod} (${generatedPayroll.startDate} to ${generatedPayroll.endDate})`,
          `Total Net Pay: ${formatCurrency(totalNetPay)}`,
          duplicateCount > 0
            ? `Skipped as duplicates: ${numberFormatter.format(duplicateCount)}`
            : "",
          failureCount > 0
            ? `Failed: ${numberFormatter.format(failureCount)} - ${lastFailureMessage || "Unable to generate one or more payroll records."}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        icon: failureCount > 0 ? "warning" : "success",
        confirmButtonColor: "#0f766e",
      });

      closeGenerateModal(true);
    } catch (requestError) {
      await Swal.fire({
        title: "Unable to Process Payroll",
        text: requestError?.response?.data?.message || "Unable to process payroll.",
        icon: "error",
        confirmButtonColor: "#0f766e",
      });
    } finally {
      setProcessingGeneratedPayroll(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      {loading ? <LoadingState /> : (
        <>
          <Card className="overflow-hidden border-slate-200/80 bg-white/95 shadow-sm">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>{isRegistryView ? "Create Payroll Registry" : `${pageConfig.title} Registry`}</CardTitle>
                <CardDescription>
                  {isRegistryView
                    ? "Generate payroll batches, review registry totals, and approve processed payrolls."
                    : "Search, filter, sort, and manage payroll records from the admin workspace."}
                </CardDescription>
                {error ? <p className="m-0 mt-2 text-sm font-semibold text-rose-700">{error}</p> : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {pageConfig.showCreate && canSubmitPayroll ? (
                  <Button
                    variant="primary"
                    onClick={openGenerateModal}
                    className="min-h-[44px] rounded-xl px-4 text-sm"
                  >
                    Create payroll
                  </Button>
                ) : null}
                {pageConfig.showCreate && archivePayrollPath && onNavigate ? (
                  <Button
                    variant="secondary"
                    icon={Archive}
                    onClick={() => onNavigate(archivePayrollPath)}
                    className="min-h-[44px] rounded-xl px-4 text-sm"
                  >
                    Archive
                  </Button>
                ) : null}
                {pageConfig.showCreate && canSubmitPayroll ? (
                  <Button
                    variant="secondary"
                    icon={Plus}
                    onClick={openCreateModal}
                    className="h-11 w-11 rounded-xl border-slate-200 bg-white px-0 text-sm text-[#D61E1E] hover:border-slate-300 hover:bg-slate-50"
                    aria-label="Manual Payroll"
                    title="Manual Payroll"
                  />
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <InputField
                  label={isRegistryView ? "Search Registry" : "Search Employee"}
                  name="payrollSearch"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={isRegistryView ? "Search payroll ID, division, period" : "Search employee"}
                  icon={Search}
                />

                <div>
                  <label htmlFor="payrollStatusFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Payroll Status
                  </label>
                  <select
                    id="payrollStatusFilter"
                    value={statusFilter}
                    onChange={(event) => {
                      setStatusFilter(event.target.value);
                      setCurrentPage(1);
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
                  >
                    <option value="">All statuses</option>
                    {(view === "archived" ? ["Archived"] : ACTIVE_STATUS_OPTIONS).map((status) => (
                      <option key={status} value={status}>
                        {isRegistryView && status === "Draft" ? "Processed" : status}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="payrollDivisionFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Division
                  </label>
                  <select
                    id="payrollDivisionFilter"
                    value={divisionFilter}
                    onChange={(event) => {
                      setDivisionFilter(event.target.value);
                      setCurrentPage(1);
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
                  >
                    <option value="">All divisions</option>
                    {divisions.map((division) => (
                      <option key={division} value={division}>{division}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="payrollPeriodFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Payroll Period
                  </label>
                  <select
                    id="payrollPeriodFilter"
                    value={periodFilter}
                    onChange={(event) => {
                      setPeriodFilter(event.target.value);
                      setCurrentPage(1);
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
                  >
                    <option value="">All periods</option>
                    {periodOptions.map((period) => (
                      <option key={period} value={period}>{period}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="payrollRowsPerPage" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Rows Per Page
                  </label>
                  <select
                    id="payrollRowsPerPage"
                    value={rowsPerPage}
                    onChange={(event) => {
                      setRowsPerPage(Number(event.target.value) || DEFAULT_ROWS_PER_PAGE);
                      setCurrentPage(1);
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
                  >
                    {[5, 8, 10, 15, 20].map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </div>
              </div>

              {!isRegistryView && selectedCount > 0 ? (
                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-extrabold text-slate-900">
                      {numberFormatter.format(selectedCount)} selected
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canSubmitPayroll ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Send}
                        loading={bulkProcessing}
                        onClick={() => handleBulkAction("submit")}
                      >
                        Submit for Approval
                      </Button>
                    ) : null}
                    {canApprovePayroll ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          icon={Check}
                          loading={bulkProcessing}
                          onClick={() => handleBulkAction("approve")}
                        >
                          Approve Selected
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={XCircle}
                          loading={bulkProcessing}
                          onClick={() => handleBulkAction("reject")}
                        >
                          Reject Selected
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={WalletCards}
                          loading={bulkProcessing}
                          onClick={() => handleBulkAction("paid")}
                        >
                          Mark as Paid
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={X}
                      disabled={bulkProcessing}
                      onClick={() => {
                        setSelectedPayrollIds([]);
                        setBulkFailedPayrollIds([]);
                      }}
                    >
                      Clear Selection
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <Table
                  columns={isRegistryView ? registryColumns : columns}
                  data={paginatedRecords}
                  rowKey={isRegistryView ? "id" : "id"}
                  emptyMessage={(
                    <div className="py-10 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                        <Filter size={20} />
                      </div>
                      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
                        {isRegistryView ? "No payroll registries found" : "No payroll records found"}
                      </p>
                      <p className="m-0 mt-1 text-sm text-slate-500">
                        {isRegistryView
                          ? "Click Create payroll to create your first payroll batch."
                          : "Generate payroll or adjust the filters."}
                      </p>
                    </div>
                  )}
                  stickyHeader
                  className="max-h-[520px] overflow-y-auto"
                  tableClassName={isRegistryView ? "min-w-[1270px]" : "min-w-[1460px]"}
                />
              </div>

              {displayedRows.length > 0 ? (
                <Pagination
                  currentPage={safeCurrentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      <Modal
        open={generateModalOpen}
        title="Generate New Payroll"
        onClose={() => closeGenerateModal()}
        maxWidth="max-w-3xl"
        panelClassName="rounded-[26px] border border-slate-200 bg-white shadow-[0_28px_72px_rgba(15,23,42,0.18)]"
        contentClassName="bg-white px-4 py-4 md:px-5 md:py-5"
        footerClassName="bg-white"
        footer={(
          <>
            <Button variant="ghost" onClick={() => closeGenerateModal()} disabled={processingGeneratedPayroll}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleProcessGeneratedPayroll}
              loading={processingGeneratedPayroll}
            >
              Process Payroll
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="m-0 text-sm leading-6 text-slate-600">
            This will process payroll for the selected period and division. Review the parameters before continuing.
          </p>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">Pay Period</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {PAY_PERIOD_OPTIONS.map((period) => {
                const active = generatedPayroll.payPeriod === period;

                return (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setGeneratedPayroll((current) => ({
                      ...current,
                      payPeriod: period,
                      ...getPayPeriodDateRange(period, current.startDate || current.endDate),
                    }))}
                    className={`min-h-[42px] rounded-xl border px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-red-100 ${
                      active
                        ? "border-[#D61E1E] bg-[#D61E1E] text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {period}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <InputField
              label="Pay Period Start"
              name="generatedPayrollStart"
              type="date"
              value={generatedPayroll.startDate}
              onChange={(event) => setGeneratedPayroll((current) => ({ ...current, startDate: event.target.value }))}
            />
            <InputField
              label="Pay Period End"
              name="generatedPayrollEnd"
              type="date"
              value={generatedPayroll.endDate}
              onChange={(event) => setGeneratedPayroll((current) => ({ ...current, endDate: event.target.value }))}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="generatedPayrollEmploymentType" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Employment Type
              </label>
              <select
                id="generatedPayrollEmploymentType"
                value={generatedPayroll.employmentType}
                onChange={(event) => setGeneratedPayroll((current) => ({ ...current, employmentType: event.target.value }))}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              >
                <option value="">All Types</option>
                {GENERATED_EMPLOYMENT_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="generatedPayrollDivision" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Division
              </label>
              <select
                id="generatedPayrollDivision"
                value={generatedPayroll.division}
                onChange={(event) => setGeneratedPayroll((current) => ({ ...current, division: event.target.value }))}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              >
                <option value="">All Division</option>
                {employeeDivisionOptions.map((division) => (
                  <option key={division} value={division}>{division}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <InputField
              label=""
              name="generatedPayrollSearch"
              value={generatedPayroll.search}
              onChange={(event) => setGeneratedPayroll((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search employees"
              icon={Search}
            />
          </div>

          <label className="flex items-center gap-2 border-b border-slate-200 pb-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={allGeneratedEmployeesSelected}
              onChange={handleToggleAllGeneratedEmployees}
              className="h-4 w-4 rounded border-slate-300 accent-[#D61E1E] focus:ring-[#D61E1E]/20"
            />
            <span>Select all</span>
          </label>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="hidden border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_140px_96px] sm:items-center sm:gap-3">
              <span className="w-4" aria-hidden="true" />
              <span>Employee</span>
              <span className="hidden sm:block">Division</span>
              <span className="hidden md:block">Type</span>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {filteredGeneratedEmployees.length === 0 ? (
                <div className="px-4 py-5 text-center text-sm text-slate-500">
                  <p className="m-0 font-semibold text-slate-600">
                    {generatedPayroll.employmentType
                      ? `No ${generatedPayroll.employmentType} employees found.`
                      : "No employees found for this filter."}
                  </p>
                  {generatedPayroll.employmentType ? (
                    <p className="m-0 mt-1 text-xs text-slate-500">
                      Payroll can only be processed for employees whose record is set to{" "}
                      {generatedPayroll.employmentType}. Clear the filter or update the employment
                      status in Employee Management.
                    </p>
                  ) : null}
                </div>
              ) : filteredGeneratedEmployees.map((employee) => {
                const isSelected = selectedGeneratedEmployeeIdSet.has(String(employee.employeeRecordId));

                return (
                  <GeneratedPayrollEmployeeRow
                    key={employee.employeeRecordId}
                    employee={employee}
                    selected={isSelected}
                    onToggle={handleToggleGeneratedEmployee}
                  />
                );
              })}
            </div>
          </div>

          <p className="m-0 text-sm text-slate-500">
            {numberFormatter.format(selectedGeneratedEmployeeIds.length)} selected
          </p>

          {selectedGeneratedEmployeeIds.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="m-0 text-sm font-bold text-slate-950">Payroll Preview</h3>
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    Estimated deductions use the selected period and configured recurring deduction records.
                  </p>
                </div>
                {payrollPreviewLoading ? (
                  <span className="text-xs font-semibold text-slate-500">Calculating...</span>
                ) : null}
              </div>

              {payrollPreviewError ? (
                <p className="m-0 mt-3 text-xs font-semibold text-rose-700">{payrollPreviewError}</p>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["Gross", payrollPreviewTotals.grossPay],
                  ["Deductions", payrollPreviewTotals.totalDeduction],
                  ["Net Pay", payrollPreviewTotals.netPay],
                ].map(([label, amount]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                    <p className="m-0 text-xs font-semibold uppercase text-slate-500">{label}</p>
                    <strong className="mt-1 block text-sm text-slate-950">{formatCurrency(amount)}</strong>
                  </div>
                ))}
              </div>

              {payrollPreviewRecords.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {payrollPreviewRecords.slice(0, 5).map((record) => {
                    const deductionLabels = Array.isArray(record.deductionItems)
                      ? record.deductionItems
                        .filter((item) => parseAmount(item.amount) > 0)
                        .slice(0, 4)
                        .map((item) => `${item.name}: ${formatCurrency(item.amount)}`)
                      : [];

                    return (
                      <div key={record.employeeRecordId} className="grid gap-2 border-b border-slate-100 px-3 py-3 text-xs last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <p className="m-0 truncate font-semibold text-slate-900">{record.employeeName || "Employee"}</p>
                          <p className="m-0 mt-1 truncate text-slate-500">
                            {deductionLabels.length > 0 ? deductionLabels.join(" | ") : "No configured deductions found"}
                          </p>
                        </div>
                        <div className="text-left md:text-right">
                          <p className="m-0 text-slate-950">{formatCurrency(record.totalDeduction)}</p>
                          <p className="m-0 mt-1 text-slate-500">Net {formatCurrency(record.netPay)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : !payrollPreviewLoading && generatedPayroll.startDate && generatedPayroll.endDate ? (
                <p className="m-0 mt-3 text-xs text-slate-500">No preview rows available yet.</p>
              ) : null}

              {payrollPreviewRecords.length > 5 ? (
                <p className="m-0 mt-3 text-xs text-slate-500">
                  Showing 5 of {numberFormatter.format(payrollPreviewRecords.length)} preview rows.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={formOpen}
        title={editingRecord ? "Edit Payroll" : "Add Payroll"}
        onClose={closeFormModal}
        maxWidth="max-w-4xl"
        panelClassName="rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_72px_rgba(15,23,42,0.18)]"
        contentClassName="bg-white px-5 py-5 md:px-4 md:py-4"
        footerClassName="bg-white"
        footer={(
          <>
            <Button variant="ghost" onClick={closeFormModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              {editingRecord ? "Save Changes" : "Create Payroll"}
            </Button>
          </>
        )}
      >
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Employee *</label>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={
                  employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId))
                  || (form.employeeRecordId
                    ? {
                      employeeRecordId: form.employeeRecordId,
                      employeeId: form.employeeId,
                      employeeName: form.employeeName,
                      designation: form.designation,
                      division: form.division,
                      basicSalary: form.basicSalary,
                    }
                    : null)
                }
                onSelect={applyEmployeeSelection}
                placeholder="Select employee"
              />
            </div>
            <InputField
              label="Basic Salary"
              name="basicSalaryPreview"
              value={form.basicSalary ? formatCurrency(form.basicSalary) : formatCurrency(0)}
              readOnly
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Pay Period *</label>
              <div className="flex flex-wrap gap-2">
                {PAY_PERIOD_OPTIONS.map((period) => {
                  const isSelected = form.payPeriod === period;

                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, payPeriod: period }))}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected
                          ? "border-[#D61E1E] bg-[#D61E1E] text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-[#d9a3a3] hover:bg-[#fff5f5] hover:text-[#D61E1E]"
                      }`}
                    >
                      {period}
                    </button>
                  );
                })}
              </div>
            </div>
            <InputField
              label="Start"
              name="startDate"
              type="date"
              value={form.startDate}
              onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
            />
            <InputField
              label="End"
              name="endDate"
              type="date"
              value={form.endDate}
              onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
            />
          </div>

          <SectionCard title="Allowances">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField
                label="PERA"
                name="pera"
                type="number"
                min="0"
                step="0.01"
                value={form.pera}
                readOnly
                inputClassName="cursor-not-allowed text-slate-500"
              />
              <InputField
                label="Approved Overtime Hours"
                name="overtimeHours"
                type="number"
                min="0"
                step="0.01"
                value={form.overtimeHours}
                readOnly
                inputClassName="cursor-not-allowed text-slate-500"
              />
              <InputField
                label="Overtime Rate"
                name="overtimeRate"
                type="number"
                min="0"
                step="0.01"
                value={form.overtimeRate}
                readOnly
                inputClassName="cursor-not-allowed text-slate-500"
              />
              <InputField
                label="Overtime Pay"
                name="overtimePay"
                type="number"
                min="0"
                step="0.01"
                value={form.overtimePay}
                readOnly
                inputClassName="cursor-not-allowed text-slate-500"
              />
              <InputField
                label="Travel Allowance"
                name="travelAllowance"
                type="number"
                min="0"
                step="0.01"
                value={form.travelAllowance}
                onChange={(event) => setForm((current) => ({ ...current, travelAllowance: event.target.value }))}
              />
              <InputField
                label="Salary Adjustment"
                name="salaryAdjustment"
                type="number"
                min="0"
                step="0.01"
                value={form.salaryAdjustment}
                onChange={(event) => setForm((current) => ({ ...current, salaryAdjustment: event.target.value }))}
              />
              <InputField
                label="Other Allowances"
                name="otherAllowances"
                type="number"
                min="0"
                step="0.01"
                value={form.otherAllowances}
                onChange={(event) => setForm((current) => ({ ...current, otherAllowances: event.target.value }))}
              />
            </div>
          </SectionCard>

          <SectionCard title="Attendance Deductions">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField
                label="Late Deduction"
                name="lateDeduction"
                type="number"
                min="0"
                step="0.01"
                value={form.lateDeduction}
                onChange={(event) => setForm((current) => ({ ...current, lateDeduction: event.target.value }))}
              />
              <InputField
                label="Absence Deduction"
                name="absenceDeduction"
                type="number"
                min="0"
                step="0.01"
                value={form.absenceDeduction}
                onChange={(event) => setForm((current) => ({ ...current, absenceDeduction: event.target.value }))}
              />
              <InputField
                label="Undertime Deduction"
                name="undertimeDeduction"
                type="number"
                min="0"
                step="0.01"
                value={form.undertimeDeduction}
                readOnly
                inputClassName="cursor-not-allowed text-slate-500"
              />
            </div>
          </SectionCard>

          <SectionCard title="Government Contributions">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField
                label="Withholding Tax"
                name="withholdingTax"
                type="number"
                min="0"
                step="0.01"
                value={form.withholdingTax}
                readOnly
                inputClassName="cursor-not-allowed text-slate-500"
              />
              <InputField
                label="GSIS"
                name="gsis"
                type="number"
                min="0"
                step="0.01"
                value={form.gsis}
                onChange={(event) => setForm((current) => ({ ...current, gsis: event.target.value }))}
              />
              <InputField
                label="PHIC"
                name="phic"
                type="number"
                min="0"
                step="0.01"
                value={form.phic}
                onChange={(event) => setForm((current) => ({ ...current, phic: event.target.value }))}
              />
              <InputField
                label="HDMF"
                name="hdmf"
                type="number"
                min="0"
                step="0.01"
                value={form.hdmf}
                onChange={(event) => setForm((current) => ({ ...current, hdmf: event.target.value }))}
              />
            </div>
          </SectionCard>

          <SectionCard title="Loan Deductions">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField
                label="Manual Cash Advance Adjustment"
                name="manualCashAdvanceAdjustment"
                type="number"
                min="0"
                step="0.01"
                value={form.manualCashAdvanceAdjustment}
                onChange={(event) => setForm((current) => ({ ...current, manualCashAdvanceAdjustment: event.target.value }))}
              />
              <InputField
                label="Laptop Loan"
                name="laptopLoan"
                type="number"
                min="0"
                step="0.01"
                value={form.laptopLoan}
                onChange={(event) => setForm((current) => ({ ...current, laptopLoan: event.target.value }))}
              />
              <InputField
                label="Other Deductions"
                name="otherDeductions"
                type="number"
                min="0"
                step="0.01"
                value={form.otherDeductions}
                onChange={(event) => setForm((current) => ({ ...current, otherDeductions: event.target.value }))}
              />
            </div>
          </SectionCard>

          <SectionCard title="Bonus">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField
                label="Bonus Amount"
                name="bonusAmount"
                type="number"
                min="0"
                step="0.01"
                value={form.bonusAmount}
                onChange={(event) => setForm((current) => ({ ...current, bonusAmount: event.target.value }))}
              />
            </div>
          </SectionCard>

          <SectionCard title="Summary">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-2">
              <SummaryRow label="Overtime Pay" value={formatCurrency(summary.overtimePay)} />
              <SummaryRow label="Undertime Deduction" value={formatCurrency(form.undertimeDeduction)} valueClassName="text-rose-600" />
              <SummaryRow label="Withholding Tax" value={formatCurrency(form.withholdingTax)} valueClassName="text-rose-600" />
              <SummaryRow label="Gross Pay" value={formatCurrency(summary.grossPay)} />
              <SummaryRow label="Total Deductions" value={formatCurrency(summary.totalDeduction)} valueClassName="text-rose-600" />
              <SummaryRow label="Net Pay" value={formatCurrency(summary.netPay)} strong />
            </div>
          </SectionCard>
        </div>
      </Modal>

      <PayrollRegistryDetailsModal
        entry={registryDetailEntry}
        canApprove={canApprovePayroll}
        canMarkPaid={canApprovePayroll}
        canArchive={canApprovePayroll}
        actionLoading={registryActionLoading}
        deductionColumns={deductionColumns}
        onClose={() => setRegistryDetailEntry(null)}
        onApprove={handleApproveRegistryEntry}
        onMarkPaid={handleMarkRegistryPaid}
        onArchive={openArchiveRegistryConfirmation}
      />

      <PayrollDetailDrawer
        open={Boolean(viewRecord)}
        record={viewRecord}
        onClose={() => setViewRecord(null)}
        onSubmitForApproval={handleSubmitForApproval}
        onApprove={handleApprovePayroll}
        onReject={handleRejectPayroll}
        onMarkPaid={handleMarkPaidClick}
        canSubmitForApproval={canSubmitPayroll}
        canApprove={canApprovePayroll}
        canReject={canApprovePayroll}
        canMarkPaid={canApprovePayroll}
        actionLoading={drawerActionLoading}
      />
    </div>
  );
}
