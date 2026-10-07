import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Banknote,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Ellipsis,
  Eye,
  Pencil,
  Plus,
  Search,
  WalletCards,
  XCircle,
} from "lucide-react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import ActionsMenu from "../../components/UI/ActionsMenu";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import Button from "../../components/UI/button";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { getEmployees } from "../../services/api";
import {
  archiveLoanRequest,
  createLoanRequest,
  disburseLoanRequest,
  fetchLoanRequestById,
  fetchLoanRequests,
  recordLoanPayment,
  updateLoanRequest,
  updateLoanStatus,
} from "../../services/loanService";
import { currencyFormatter } from "../../utils/format";
import { resolveUserRoleKey } from "../../utils/roleRoutes";
import LoanEmployeeChecklist from "./LoanEmployeeChecklist";

const ROWS_PER_PAGE = 8;

/*
 * New applications are MGB Coop loans only. The government products below stay so loans filed
 * before keep their badge and default terms; they are no longer offered on the form.
 */
const MGB_COOP_PROVIDER = "MGB Coop";
const MGB_COOP_LOAN_NAME = "MGB Coop Loan";

export const LOAN_PRODUCTS = [
  {
    id: "mgb-coop",
    name: MGB_COOP_LOAN_NAME,
    provider: MGB_COOP_PROVIDER,
    providerName: "MGB Coop",
    rate: 0,
    term: 12,
    method: "flat",
    description: "MGB Coop loan, paid back through monthly payroll deductions.",
  },
  {
    id: "sss-salary",
    name: "SSS Salary Loan",
    provider: "SSS",
    providerName: "Social Security System",
    rate: 10,
    term: 24,
    method: "flat",
    description: "Short-term salary loan payable in 24 equal monthly installments at 10% p.a. flat.",
  },
  {
    id: "sss-calamity",
    name: "SSS Calamity Loan",
    provider: "SSS",
    providerName: "Social Security System",
    rate: 6,
    term: 24,
    method: "diminishing",
    description: "Calamity assistance for qualified SSS members with diminishing-balance interest.",
  },
  {
    id: "pagibig-mpl",
    name: "Pag-IBIG Multi-Purpose Loan",
    provider: "Pag-IBIG",
    providerName: "Home Development Mutual Fund",
    rate: 10.5,
    term: 24,
    method: "diminishing",
    description: "Multi-purpose member loan with fixed monthly payroll deductions.",
  },
  {
    id: "pagibig-housing",
    name: "Pag-IBIG Housing Loan",
    provider: "Pag-IBIG",
    providerName: "Home Development Mutual Fund",
    rate: 3,
    term: 240,
    method: "diminishing",
    description: "Long-term housing finance with a diminishing principal balance.",
  },
  {
    id: "gsis-salary",
    name: "GSIS Salary Loan",
    provider: "GSIS",
    providerName: "Government Service Insurance System",
    rate: 12,
    term: 36,
    method: "diminishing",
    description: "Salary-based financing for eligible government employees.",
  },
  {
    id: "gsis-emergency",
    name: "GSIS Emergency Loan",
    provider: "GSIS",
    providerName: "Government Service Insurance System",
    rate: 8,
    term: 36,
    method: "flat",
    description: "Emergency assistance with a predictable flat-rate monthly payment.",
  },
  {
    id: "gsis-policy",
    name: "GSIS Policy Loan",
    provider: "GSIS",
    providerName: "Government Service Insurance System",
    rate: 8,
    term: 24,
    method: "diminishing",
    description: "Member loan secured against the employee's GSIS policy value.",
  },
  {
    id: "company",
    name: "Company Loan",
    provider: "Company",
    providerName: "Employer",
    rate: 0,
    term: 12,
    method: "flat",
    description: "Interest-free employer loan collected through payroll deductions.",
  },
];

const LEGACY_PRODUCT_MAP = {
  "Emergency Loan": "gsis-emergency",
  "Policy Loan": "gsis-policy",
  "Salary Loan": "company",
  "Housing Loan": "pagibig-housing",
  "Multi-Purpose Loan (MPL)": "pagibig-mpl",
  "Calamity Loan": "sss-calamity",
  "Consolidated Loan": "gsis-salary",
  "Pension Loan": "gsis-salary",
  "GSIS Financial Assistance Loan (GFAL)": "gsis-salary",
  "Enhanced Housing Loan": "pagibig-housing",
};

const PRODUCT_BADGES = {
  [MGB_COOP_PROVIDER]: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
  SSS:"border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  "Pag-IBIG": "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  GSIS: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  Company: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  Other: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const STATUS_BADGES = {
  Pending: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  Approved: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  Active: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  Paid: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  Rejected: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
};

// Upcoming and Not collected rows keep the plain grey badge.
const INSTALLMENT_STATUS_BADGES = {
  Paid: STATUS_BADGES.Paid,
  "Next payroll deduction": STATUS_BADGES.Approved,
  Overdue: STATUS_BADGES.Rejected,
  "Not in payroll": STATUS_BADGES.Pending,
};

function dateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayInputValue() {
  return dateInputValue(new Date());
}

function buildEmployeeOptions(employees = []) {
  return employees
    .map((employee) => ({
      employeeRecordId: employee.id || employee.employeeRecordId || "",
      employeeId: employee.employeeId || employee.employee_id || "",
      employeeName: employee.fullName || employee.employeeName || employee.full_name || "",
      division: employee.department || employee.division || "",
      position: employee.position || "",
      employmentStatus: employee.employmentStatus || employee.employment_status || "",
      status: employee.status || "",
    }))
    .filter((employee) => employee.employeeRecordId || employee.employeeName);
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseTermMonths(value) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Math.max(0, Number(match[1])) : 0;
}

function formatCurrency(value) {
  const amount = Number(value);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value, fallback = "N/A") {
  if (!value) return fallback;
  const normalized = String(value).slice(0, 10);
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function addMonths(value, months) {
  const base = value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return "";
  const day = base.getDate();
  base.setDate(1);
  base.setMonth(base.getMonth() + months);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(day, lastDay));
  return dateInputValue(base);
}

function loanNumber(record) {
  const year = String(record?.dateFiled || record?.createdAt || new Date().getFullYear()).slice(0, 4);
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? `LON-${year}-${String(id).padStart(4, "0")}` : "New loan";
}

function isCoopLoanType(type) {
  return normalizeKey(type).includes("coop");
}

function productForType(type) {
  const legacyId = LEGACY_PRODUCT_MAP[type];
  const coopProduct = LOAN_PRODUCTS.find((product) => product.provider === MGB_COOP_PROVIDER);
  return LOAN_PRODUCTS.find((product) => product.id === legacyId)
    || LOAN_PRODUCTS.find((product) => normalizeKey(product.name) === normalizeKey(type))
    // Any other coop product added in Deduction Setup takes the MGB Coop defaults under its own name.
    || (isCoopLoanType(type) ? { ...coopProduct, id: `coop-${normalizeKey(type)}`, name: type } : null)
    || {
      id: "other",
      name: type || "Loan",
      provider: "Other",
      providerName: "External lender",
      rate: 0,
      term: 12,
      method: "flat",
      description: "Employee loan collected through payroll deduction.",
    };
}

function providerForDefinition(name, definition, fallbackProvider) {
  const categoryLabel = String(definition?.categoryLabel || definition?.groupLabel || "").trim();
  const categoryCode = String(definition?.categoryCode || definition?.category_code || "").trim();
  const providerKey = normalizeKey(`${name} ${categoryLabel} ${categoryCode}`);

  if (isCoopLoanType(name)) return MGB_COOP_PROVIDER;
  if (providerKey.includes("gsis")) return "GSIS";
  if (providerKey.includes("pagibig") || providerKey.includes("hdmf")) return "Pag-IBIG";
  if (providerKey.includes("sss") || providerKey.includes("socialsecuritysystem")) return "SSS";
  if (providerKey.includes("company") || providerKey.includes("employer")) return "Company";

  return fallbackProvider === "Other" ? (categoryLabel || "Other") : fallbackProvider;
}

export function buildConfiguredLoanProducts(definitions = [], fallbackTypes = []) {
  const source = definitions.length
    ? definitions
    : fallbackTypes.map((typeName) => ({ typeName }));
  const productsByName = new Map();

  source.forEach((definition) => {
    const name = String(definition?.typeName || definition?.type_name || definition?.name || "").trim();
    const key = normalizeKey(name);

    if (!name || !key || productsByName.has(key)) {
      return;
    }

    const product = productForType(name);
    const categoryLabel = String(definition?.categoryLabel || definition?.groupLabel || "").trim();
    productsByName.set(key, {
      ...product,
      id: definition?.id ? `deduction-${definition.id}` : product.id,
      name,
      provider: providerForDefinition(name, definition, product.provider),
      providerName: categoryLabel || product.providerName,
      description: String(definition?.description || "").trim() || product.description,
    });
  });

  return [...productsByName.values()];
}

function principalFor(record) {
  const direct = Number(record?.loanAmount);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return Object.values(record?.loanAmounts || {}).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
}

function loanTerms(record) {
  const product = productForType(record?.loanType);
  return {
    principal: principalFor(record),
    rate: Number.isFinite(Number(record?.annualInterestRate)) ? Number(record.annualInterestRate) : product.rate,
    term: Number(record?.termMonths) || parseTermMonths(record?.repaymentTerms) || product.term,
    method: record?.interestMethod === "diminishing" ? "diminishing" : (record?.interestMethod || product.method),
  };
}

function monthlyAmortization(principal, annualRate, termMonths, method) {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (method === "diminishing" && annualRate > 0) {
    const monthlyRate = annualRate / 100 / 12;
    const factor = (1 + monthlyRate) ** termMonths;
    return principal * monthlyRate * factor / (factor - 1);
  }
  const totalInterest = principal * (annualRate / 100) * (termMonths / 12);
  return (principal + totalInterest) / termMonths;
}

function loanFinancials(record) {
  const { principal, rate, term, method } = loanTerms(record);
  const monthly = Number(record?.monthlyAmortization)
    || monthlyAmortization(principal, rate, term, method);
  const totalPayable = Number(record?.totalPayable) || monthly * term || principal;
  const paid = Number(record?.paidAmount)
    || (record?.payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const outstanding = Math.max(0, Number(record?.outstandingAmount ?? totalPayable - paid));
  const paidInstallments = Math.min(term, Math.floor((paid + 0.01) / Math.max(monthly, 0.01)));
  return { principal, rate, term, method, monthly, totalPayable, paid, outstanding, paidInstallments };
}

function displayStatus(record) {
  const financials = loanFinancials(record);
  if (record?.status === "Rejected") return "Rejected";
  if (record?.status === "Pending") return "Pending";
  if (record?.status === "Approved" && !record?.disbursedAt) return "Approved";
  if (record?.status === "Approved" && financials.outstanding <= 0.01) return "Paid";
  return "Active";
}

function emptyForm() {
  return {
    employeeRecordId: "",
    // A new application filed by HR covers every checked employee; an edited loan keeps its one employee.
    employeeRecordIds: [],
    productId: "",
    loanType: "",
    loanAmount: "",
    annualInterestRate: "",
    termMonths: "",
    interestMethod: "flat",
    governmentReferenceNumber: "",
    purpose: "",
    dateFiled: todayInputValue(),
  };
}

/** The form fields a loan type fills in: its name and its default rate, term and interest method. */
function productFormFields(product) {
  return {
    productId: product.id,
    loanType: product.name,
    annualInterestRate: String(product.rate),
    termMonths: String(product.term),
    interestMethod: product.method,
  };
}

function formFromRecord(record, configuredProducts = []) {
  const product = configuredProducts.find(
    (option) => normalizeKey(option.name) === normalizeKey(record?.loanType)
  ) || productForType(record?.loanType);
  const terms = loanTerms(record);
  return {
    employeeRecordId: String(record?.employeeRecordId || ""),
    employeeRecordIds: [],
    productId: product.id,
    loanType: record?.loanType || product.name,
    loanAmount: String(terms.principal || ""),
    annualInterestRate: String(terms.rate),
    termMonths: String(terms.term),
    interestMethod: terms.method,
    governmentReferenceNumber: record?.governmentReferenceNumber || "",
    purpose: record?.purpose || "",
    dateFiled: String(record?.dateFiled || todayInputValue()).slice(0, 10),
  };
}

/*
 * Payroll deducts a loan only while it is approved, disbursed and not archived, and only from a
 * Regular employee (payroll_fetch_approved_loan_deduction_items in payroll.php). The schedule reads
 * a loan the same way, so it can say which installment the next payroll takes.
 */
function payrollCollection(record) {
  if (record?.isArchived || record?.status === "Rejected") return "stopped";
  if (record?.status !== "Approved" || !record?.disbursedAt) return "waiting";
  // A record without an employment status is taken to be collected, as it was before.
  if (record?.employmentStatus && normalizeKey(record.employmentStatus) !== "regular") return "manual";
  return "collecting";
}

function installmentStatus(row, isNextInstallment, collection) {
  if (row.amountPaid >= row.amountDue - 0.01) return "Paid";
  if (collection === "stopped") return "Not collected";
  if (collection === "waiting") return "Upcoming";
  if (row.overdue) return "Overdue";
  if (collection === "manual") return "Not in payroll";
  return isNextInstallment ? "Next payroll deduction" : "Upcoming";
}

function repaymentSchedule(record) {
  const { principal, rate, term, method, monthly, totalPayable } = loanFinancials(record);
  const paymentsByInstallment = (record?.payments || []).reduce((map, payment) => {
    const number = Number(payment.installmentNumber);
    if (!map[number]) map[number] = [];
    map[number].push(payment);
    return map;
  }, {});
  const startDate = record?.disbursedAt || String(record?.approvedAt || record?.dateFiled || todayInputValue()).slice(0, 10);
  let scheduledBalance = principal;
  let paidToDate = 0;

  const rows = Array.from({ length: term }, (_, index) => {
    const installmentNumber = index + 1;
    const interest = method === "diminishing"
      ? scheduledBalance * (rate / 100 / 12)
      : principal * (rate / 100 / 12);
    const scheduledPrincipal = method === "diminishing" ? Math.max(0, monthly - interest) : principal / term;
    const principalDue = installmentNumber === term ? scheduledBalance : Math.min(scheduledBalance, scheduledPrincipal);
    scheduledBalance = Math.max(0, scheduledBalance - principalDue);
    const amountDue = installmentNumber === term
      ? Math.max(0, totalPayable - monthly * (term - 1))
      : monthly;
    const payments = paymentsByInstallment[installmentNumber] || [];
    const amountPaid = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    paidToDate += amountPaid;
    const dueDate = addMonths(startDate, installmentNumber);

    return {
      installmentNumber,
      dueDate,
      principal: principalDue,
      interest,
      amountDue,
      amountPaid,
      remainingDue: Math.max(0, Math.min(amountDue - amountPaid, totalPayable - paidToDate)),
      balance: scheduledBalance,
      overdue: Boolean(dueDate && dueDate < todayInputValue()),
      payments,
    };
  });

  // Payroll fills installments in order, so the next deduction goes to the first one not yet paid.
  const collection = payrollCollection(record);
  const nextIndex = rows.findIndex((row) => row.amountPaid < row.amountDue - 0.01);

  return rows.map((row, index) => ({ ...row, status: installmentStatus(row, index === nextIndex, collection) }));
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-semibold ${STATUS_BADGES[status] || STATUS_BADGES.Pending}`}>
      {status}
    </span>
  );
}

function ProductBadge({ product }) {
  return (
    <span className={`inline-flex rounded-lg border px-2 py-1 text-xs font-semibold ${PRODUCT_BADGES[product.provider] || PRODUCT_BADGES.Other}`}>
      {product.name}
    </span>
  );
}

function Field({ label, required, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}{required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      {children}
    </label>
  );
}

const inputClass = "min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-900/40";

function LoanActionButton({ icon: Icon, label, tone = "view", onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-tone={tone}
      className="action-icon-button inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition focus:outline-none focus:ring-2"
    >
      <Icon size={13} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export default function FileLoan({
  employees = [],
  user,
  title = "Loan Management",
  description = "MGB Coop loans with amortization tracking and payroll deductions.",
}) {
  const [records, setRecords] = useState([]);
  const [loanProducts, setLoanProducts] = useState([]);
  const [loadedEmployees, setLoadedEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [archiveView, setArchiveView] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [form, setForm] = useState(() => emptyForm());
  const [viewingRecord, setViewingRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    installmentNumber: 1,
    amount: "",
    paidAt: todayInputValue(),
    paymentReference: "",
    notes: "",
  });

  const roleKey = resolveUserRoleKey(user);
  const canManage = ["admin", "hrhead", "hrstaff"].includes(roleKey);
  const canManageDetails = roleKey === "admin";
  const canReview = roleKey === "hrhead";
  const canRecordPayments = ["admin", "cashier"].includes(roleKey);
  const canFileForOthers = canManage;
  const canCreate = canManage || Boolean(roleKey);
  const employeeOptions = useMemo(
    () => buildEmployeeOptions(employees.length ? employees : loadedEmployees),
    [employees, loadedEmployees]
  );
  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeOptions, form.employeeRecordId]
  );

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    try {
      const result = await fetchLoanRequests({ archived: archiveView });
      setRecords(Array.isArray(result.records) ? result.records : []);
      setLoanProducts(buildConfiguredLoanProducts(result.loanTypeDefinitions, result.loanTypes));
    } catch (error) {
      if (!background) toast.error(error?.response?.data?.message || "Unable to load loan records.");
    } finally {
      if (!background) setLoading(false);
    }
  }, [archiveView]);

  useAutoRefreshOnChange(loadRecords, { topics: ["loan_request", "deduction"], refreshOnMount: false });

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (employees.length > 0 || !canFileForOthers) return undefined;
    let active = true;
    setEmployeeLoading(true);
    getEmployees()
      .then((result) => {
        if (active) setLoadedEmployees(Array.isArray(result.employees) ? result.employees : []);
      })
      .catch((error) => {
        if (active) toast.error(error?.response?.data?.message || "Unable to load employee options.");
      })
      .finally(() => {
        if (active) setEmployeeLoading(false);
      });
    return () => { active = false; };
  }, [canFileForOthers, employees.length]);

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesSearch = !search || [
        loanNumber(record),
        record.governmentReferenceNumber,
        record.employeeName,
        record.employeeId,
        record.loanType,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      return matchesSearch && (!statusFilter || displayStatus(record) === statusFilter);
    });
  }, [query, records, statusFilter]);

  const sortedRecords = useMemo(
    () => [...filteredRecords].sort((left, right) => new Date(right.dateFiled || 0) - new Date(left.dateFiled || 0)),
    [filteredRecords]
  );
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const visibleRecords = sortedRecords.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

  useEffect(() => setCurrentPage(1), [archiveView, query, statusFilter]);

  const updateRecord = (record) => {
    if (!record) return;
    setRecords((current) => {
      const exists = current.some((item) => String(item.id) === String(record.id));
      return exists
        ? current.map((item) => String(item.id) === String(record.id) ? { ...item, ...record } : item)
        : [record, ...current];
    });
    setViewingRecord((current) => current && String(current.id) === String(record.id) ? { ...current, ...record } : current);
  };

  /*
   * A new application is always an MGB Coop Loan, so the form shows the type instead of offering a
   * choice. An edited loan keeps the type it was filed under. The interest-free default terms come
   * with it, since the form no longer asks for a rate or method.
   */
  const coopLoanProduct = loanProducts.find((product) => normalizeKey(product.name) === normalizeKey(MGB_COOP_LOAN_NAME))
    || loanProducts[0]
    || null;
  const formLoanType = form.loanType || (editingRecord ? "" : coopLoanProduct?.name || "");

  const openCreateForm = () => {
    setEditingRecord(null);
    setForm(coopLoanProduct ? { ...emptyForm(), ...productFormFields(coopLoanProduct) } : emptyForm());
    setFormOpen(true);
  };

  const openEditForm = (record) => {
    setEditingRecord(record);
    setForm(formFromRecord(record, loanProducts));
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingRecord(null);
  };

  const openView = async (record) => {
    setViewingRecord(record);
    setViewLoading(true);
    try {
      const result = await fetchLoanRequestById(record.id);
      setViewingRecord(result.record || record);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to load loan details.");
    } finally {
      setViewLoading(false);
    }
  };

  /*
   * Each checked employee gets a loan of their own with the same terms. They are filed one at a
   * time, so a failure names who it was and does not stop the rest. Whoever failed stays checked,
   * which makes submitting again a retry for just those employees.
   */
  const submitForSelectedEmployees = async (payload) => {
    const employeeIds = form.employeeRecordIds;
    const total = employeeIds.length;
    const toastId = toast.loading(total > 1 ? `Submitting 1 of ${total} loan applications...` : "Submitting loan application...");
    const failures = [];

    for (const [index, employeeRecordId] of employeeIds.entries()) {
      if (total > 1) toast.loading(`Submitting ${index + 1} of ${total} loan applications...`, { id: toastId });
      try {
        const result = await createLoanRequest({ ...payload, employeeRecordId });
        updateRecord(result.record);
      } catch (error) {
        failures.push({ employeeRecordId, message: error?.response?.data?.message || "Unable to save the loan application." });
      }
    }

    if (!failures.length) {
      toast.success(total > 1 ? `Loan applications filed for ${total} employees.` : "Loan application submitted.", { id: toastId });
      closeForm();
      return;
    }

    const nameOf = (id) => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(id))?.employeeName || "an employee";
    const filed = total - failures.length;
    const reasons = [...new Set(failures.map((failure) => failure.message))].join(" ");
    toast.error(
      `${filed ? `Filed ${filed} of ${total}. ` : ""}Not filed for ${failures.map((failure) => nameOf(failure.employeeRecordId)).join(", ")}: ${reasons}`,
      { id: toastId, duration: 8000 }
    );
    setForm((current) => ({ ...current, employeeRecordIds: failures.map((failure) => failure.employeeRecordId) }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const amount = Number(form.loanAmount);
    const rate = Number(form.annualInterestRate);
    const term = Number(form.termMonths);
    const filingForSelection = canFileForOthers && !editingRecord;
    if (filingForSelection && form.employeeRecordIds.length === 0) return toast.error("Select at least one employee.");
    if (canFileForOthers && editingRecord && !form.employeeRecordId) return toast.error("Select an employee first.");
    if (!formLoanType) return toast.error("MGB Coop Loan is not set up yet. Add it in Admin Settings → Deduction Setup.");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Principal amount must be greater than zero.");
    if (!Number.isInteger(term) || term < 1 || term > 360) return toast.error("Term must be between 1 and 360 months.");
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast.error("Interest rate must be between 0 and 100%.");

    setSaving(true);
    const payload = {
      employeeRecordId: canFileForOthers ? form.employeeRecordId : undefined,
      loanType: formLoanType,
      loanAmount: amount,
      loanAmounts: { [formLoanType]: amount },
      repaymentTerms: `${term} months`,
      annualInterestRate: rate,
      interestMethod: form.interestMethod,
      governmentReferenceNumber: editingRecord ? form.governmentReferenceNumber.trim() : undefined,
      purpose: form.purpose.trim(),
      dateFiled: editingRecord ? (form.dateFiled || todayInputValue()) : undefined,
    };

    if (filingForSelection) {
      await submitForSelectedEmployees(payload);
      setSaving(false);
      return;
    }

    const toastId = toast.loading(editingRecord ? "Saving loan changes..." : "Submitting loan application...");
    try {
      const result = editingRecord
        ? await updateLoanRequest(editingRecord.id, payload)
        : await createLoanRequest(payload);
      updateRecord(result.record);
      toast.success(result.message || (editingRecord ? "Loan updated." : "Loan application submitted."), { id: toastId });
      closeForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save the loan application.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status) => {
    if (!viewingRecord || !canReview) return;
    let remarks = "";
    if (status === "Rejected") {
      const result = await Swal.fire({
        title: "Reject loan application?",
        input: "textarea",
        inputLabel: "Reason for rejection",
        inputPlaceholder: "Enter the review notes...",
        showCancelButton: true,
        confirmButtonText: "Reject Application",
        confirmButtonColor: "#dc2626",
        inputValidator: (value) => !String(value || "").trim() ? "Please provide a reason." : undefined,
      });
      if (!result.isConfirmed) return;
      remarks = String(result.value || "").trim();
    } else {
      const result = await Swal.fire({
        title: "Approve loan application?",
        text: `${loanNumber(viewingRecord)} will become ready for disbursement.`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Approve",
        confirmButtonColor: "#047857",
      });
      if (!result.isConfirmed) return;
    }

    const toastId = toast.loading(`${status === "Approved" ? "Approving" : "Rejecting"} application...`);
    try {
      const result = await updateLoanStatus(viewingRecord.id, status, remarks);
      updateRecord(result.record);
      toast.success(result.message || `Loan ${status.toLowerCase()}.`, { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update loan status.", { id: toastId });
    }
  };

  const handleDisburse = async () => {
    if (!viewingRecord || !canManage) return;
    const result = await Swal.fire({
      title: "Mark loan as disbursed",
      input: "date",
      inputValue: todayInputValue(),
      inputLabel: "Disbursement date",
      showCancelButton: true,
      confirmButtonText: "Confirm Disbursement",
      confirmButtonColor: "#047857",
      inputValidator: (value) => !value ? "Select a disbursement date." : undefined,
    });
    if (!result.isConfirmed) return;
    const toastId = toast.loading("Saving disbursement...");
    try {
      const response = await disburseLoanRequest(viewingRecord.id, result.value);
      updateRecord(response.record);
      toast.success(response.message || "Loan marked as disbursed.", { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to disburse the loan.", { id: toastId });
    }
  };

  const startPayment = (installment) => {
    setPaymentForm({
      installmentNumber: installment.installmentNumber,
      amount: installment.remainingDue.toFixed(2),
      paidAt: todayInputValue(),
      paymentReference: "",
      notes: "",
    });
    setPaymentOpen(true);
  };

  const handlePaymentSubmit = async (event) => {
    event.preventDefault();
    if (!viewingRecord) return;
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Payment amount must be greater than zero.");
    setSaving(true);
    const toastId = toast.loading("Recording payment...");
    try {
      const result = await recordLoanPayment(viewingRecord.id, {
        ...paymentForm,
        amount,
      });
      updateRecord(result.record);
      setPaymentOpen(false);
      toast.success(result.message || "Loan payment recorded.", { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to record the payment.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (record = viewingRecord) => {
    const targetRecord = record?.id ? record : viewingRecord;
    if (!targetRecord || !canManage) return;
    const confirmation = await Swal.fire({
      title: "Archive loan record?",
      text: `${loanNumber(targetRecord)} will move to the archive.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Archive",
      confirmButtonColor: "#dc2626",
    });
    if (!confirmation.isConfirmed) return;
    const toastId = toast.loading("Archiving loan...");
    try {
      await archiveLoanRequest(targetRecord.id);
      setRecords((current) => current.filter((item) => String(item.id) !== String(targetRecord.id)));
      setViewingRecord((current) => (
        current && String(current.id) === String(targetRecord.id) ? null : current
      ));
      toast.success("Loan record archived.", { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to archive the loan.", { id: toastId });
    }
  };

  const selectionCount = canFileForOthers && !editingRecord ? form.employeeRecordIds.length : 0;
  const formMonthly = monthlyAmortization(
    Number(form.loanAmount) || 0,
    Number(form.annualInterestRate) || 0,
    Number(form.termMonths) || 0,
    form.interestMethod
  );
  const viewProduct = productForType(viewingRecord?.loanType);
  const viewFinances = viewingRecord ? loanFinancials(viewingRecord) : null;
  const viewSchedule = viewingRecord ? repaymentSchedule(viewingRecord) : [];
  const viewStatus = viewingRecord ? displayStatus(viewingRecord) : "Pending";
  const repaymentProgress = viewFinances?.totalPayable > 0 ? Math.min(100, viewFinances.paid / viewFinances.totalPayable * 100) : 0;

  return (
    <section className="w-full space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{archiveView ? "Archived Loans" : title}</h1>
          <p className="m-0 mt-1 text-sm text-slate-500 dark:text-slate-400">
            {archiveView ? "Review loan records that have been moved to the archive." : description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <ArchiveViewToggle archiveView={archiveView} onToggle={setArchiveView} label="loan records" />
          ) : null}
          {canCreate && !archiveView ? (
            <Button icon={Plus} onClick={openCreateForm} className="!bg-emerald-700 hover:!bg-emerald-800">
              New Loan Application
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(280px,380px)_155px]">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Search Loans</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by loan no., reference, or employee..."
              className={`${inputClass} pl-10`}
            />
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClass} w-full`}>
            <option value="">All Statuses</option>
            {Object.keys(STATUS_BADGES).map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] border-collapse text-left" aria-label="Employee loan records">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                {[
                  "Employee Loan",
                  "Employee",
                  "Principal",
                  "Terms",
                  "Repayment",
                  "Date Filed",
                  "Status",
                  "Actions",
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className={`border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300 ${label === "Actions" ? "text-center" : ""}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1, 2, 3, 4].map((item) => (
                  <tr key={item} className="animate-pulse border-b border-slate-100 last:border-0 dark:border-slate-800">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <td key={index} className="px-4 py-4">
                        <div className="h-5 rounded bg-slate-100 dark:bg-slate-800" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : visibleRecords.length ? (
                visibleRecords.map((record) => {
                  const product = productForType(record.loanType);
                  const status = displayStatus(record);
                  const finances = loanFinancials(record);
                  const progress = finances.totalPayable > 0
                    ? Math.min(100, finances.paid / finances.totalPayable * 100)
                    : 0;

                  return (
                    <tr key={record.id} className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3.5 align-middle">
                        <div className="font-bold text-slate-950 dark:text-white">{loanNumber(record)}</div>
                        <div className="mt-1.5"><ProductBadge product={product} /></div>
                      </td>
                      <td className="px-4 py-3.5 align-middle">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{record.employeeName || "Employee"}</div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{record.employeeId || "No employee ID"}</div>
                      </td>
                      <td className="px-4 py-3.5 align-middle font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCurrency(finances.principal)}
                      </td>
                      <td className="px-4 py-3.5 align-middle">
                        <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(finances.monthly)} / mo</div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{finances.term} months</div>
                      </td>
                      <td className="px-4 py-3.5 align-middle">
                        {status === "Active" || status === "Paid" ? (
                          <div className="min-w-[165px]">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-slate-500 dark:text-slate-400">{finances.paidInstallments}/{finances.term} paid</span>
                              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{Math.round(progress)}%</span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="mt-1 text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400">Balance: {formatCurrency(finances.outstanding)}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {status === "Pending" ? "Awaiting review" : status === "Approved" ? "Ready for disbursement" : "Not approved"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 align-middle text-sm text-slate-600 dark:text-slate-300">{formatDate(record.dateFiled)}</td>
                      <td className="px-4 py-3.5 align-middle"><StatusBadge status={status} /></td>
                      <td className="px-4 py-3.5 text-center align-middle">
                        <ActionsMenu icon={Ellipsis} label={`Actions for ${loanNumber(record)}`}>
                          <LoanActionButton icon={Eye} label="View loan details" onClick={() => openView(record)} />
                          {canManage && !archiveView ? (
                            <LoanActionButton icon={Pencil} label="Edit employee loan" tone="edit" onClick={() => openEditForm(record)} />
                          ) : null}
                          {canManage && !archiveView ? (
                            <LoanActionButton icon={Archive} label="Archive employee loan" tone="archive" onClick={() => handleArchive(record)} />
                          ) : null}
                        </ActionsMenu>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><WalletCards size={22} /></div>
                    <h2 className="mb-0 mt-4 text-base font-semibold text-slate-900 dark:text-white">{archiveView ? "No archived loans" : "No loans found"}</h2>
                    <p className="m-0 mt-1 text-sm text-slate-500 dark:text-slate-400">{query || statusFilter ? "Try adjusting your search or filters." : "New applications will appear here."}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sortedRecords.length > ROWS_PER_PAGE ? (
        <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-700">
          <p className="m-0 text-sm text-slate-500">Showing {(safePage - 1) * ROWS_PER_PAGE + 1}–{Math.min(safePage * ROWS_PER_PAGE, sortedRecords.length)} of {sortedRecords.length}</p>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      ) : null}

      <Modal
        open={formOpen}
        title={editingRecord ? "Edit Loan Application" : "New Loan Application"}
        onClose={closeForm}
        maxWidth="max-w-3xl"
        panelClassName="rounded-2xl"
        contentClassName="!p-0"
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm} disabled={saving}>Cancel</Button>
            <Button type="submit" form="loan-application-form" loading={saving} className="!bg-emerald-700 hover:!bg-emerald-800">
              {editingRecord ? "Save Changes" : selectionCount > 1 ? `Submit ${selectionCount} Applications` : "Submit Application"}
            </Button>
          </>
        )}
      >
        <form id="loan-application-form" onSubmit={handleSubmit} className="space-y-4 px-4 py-4 sm:px-5">
          <p className="m-0 text-sm text-slate-500 dark:text-slate-400">Apply for an MGB Coop loan. The monthly amortization is deducted from payroll once the loan is approved and disbursed.</p>

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Loan Type</span>
            {formLoanType || loading ? (
              <div className={`${inputClass} flex items-center !bg-slate-100 font-semibold dark:!bg-slate-800`} aria-label="Loan type">
                {formLoanType || "Loading..."}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                MGB Coop Loan is not set up yet. Add it in Admin Settings → Deduction Setup.
              </div>
            )}
          </div>

          {canFileForOthers && !editingRecord ? (
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Select Employees <span className="text-red-600">*</span></span>
              <p className="m-0 mb-2 text-xs text-slate-500 dark:text-slate-400">Choose a division to list its employees, then check everyone this loan is for. Each employee gets their own loan with the terms below.</p>
              <LoanEmployeeChecklist
                employees={employeeOptions}
                selectedIds={form.employeeRecordIds}
                onChange={(employeeRecordIds) => setForm((current) => ({ ...current, employeeRecordIds }))}
                loading={employeeLoading}
                inputClassName={inputClass}
              />
            </div>
          ) : canFileForOthers ? (
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Select Employee <span className="text-red-600">*</span></span>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={selectedEmployee}
                onSelect={(employee) => setForm((current) => ({ ...current, employeeRecordId: String(employee.employeeRecordId) }))}
                placeholder={employeeLoading ? "Loading employees..." : "Select employee"}
                disabled={employeeLoading || employeeOptions.length === 0}
                showSelectedDetails
                ariaLabel="Select employee"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">The application will be filed under your employee profile.</div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Principal Amount (PHP)" required>
              <input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.loanAmount} onChange={(event) => setForm((current) => ({ ...current, loanAmount: event.target.value }))} placeholder="30000" className={inputClass} required />
            </Field>
            <Field label="Term (months)" required>
              <input type="number" min="1" max="360" step="1" value={form.termMonths} onChange={(event) => setForm((current) => ({ ...current, termMonths: event.target.value }))} className={inputClass} required />
            </Field>
          </div>

          {Number(form.loanAmount) > 0 && Number(form.termMonths) > 0 ? (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
              <span className="text-emerald-800 dark:text-emerald-300">Estimated monthly amortization{selectionCount > 1 ? " per employee" : ""}</span>
              <strong className="text-emerald-900 dark:text-emerald-200">{formatCurrency(formMonthly)}</strong>
            </div>
          ) : null}

          {editingRecord ? (
            <Field label="Reference Number">
              <input value={form.governmentReferenceNumber} onChange={(event) => setForm((current) => ({ ...current, governmentReferenceNumber: event.target.value }))} placeholder="MGB Coop loan reference no." maxLength={180} className={inputClass} />
            </Field>
          ) : null}
          <Field label="Purpose">
            <textarea value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))} placeholder="Reason for the loan..." rows={3} maxLength={2000} className={`${inputClass} py-2.5`} />
          </Field>
          {editingRecord ? (
            <Field label="Application Date" required className="max-w-xs">
              <input type="date" value={form.dateFiled} onChange={(event) => setForm((current) => ({ ...current, dateFiled: event.target.value }))} className={inputClass} required />
            </Field>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(viewingRecord)}
        title="Loan Details"
        onClose={() => setViewingRecord(null)}
        maxWidth="max-w-5xl"
        maxHeight="max-h-[94dvh]"
        panelClassName="rounded-2xl"
        contentClassName="!p-0"
        footer={viewingRecord ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {canManageDetails ? <Button variant="secondary" icon={Pencil} onClick={() => { const record = viewingRecord; setViewingRecord(null); openEditForm(record); }}>Edit</Button> : null}
              {canManageDetails && !archiveView ? <Button variant="danger" icon={Archive} onClick={() => handleArchive()}>Archive</Button> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {canReview && viewingRecord.status === "Pending" ? (
                <>
                  <Button variant="danger" icon={XCircle} onClick={() => handleStatus("Rejected")}>Reject</Button>
                  <Button icon={Check} onClick={() => handleStatus("Approved")} className="!bg-emerald-700 hover:!bg-emerald-800">Approve</Button>
                </>
              ) : null}
              {canManage && viewingRecord.status === "Approved" && !viewingRecord.disbursedAt ? (
                <Button icon={Banknote} onClick={handleDisburse} className="!bg-emerald-700 hover:!bg-emerald-800">Mark Disbursed</Button>
              ) : null}
              <Button variant="secondary" onClick={() => setViewingRecord(null)}>Close</Button>
            </div>
          </div>
        ) : null}
      >
        {viewingRecord && viewFinances ? (
          <div className="space-y-4 px-4 py-4 sm:px-5">
            {viewLoading ? <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800">Refreshing loan details...</div> : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500 dark:text-slate-400">{loanNumber(viewingRecord)}</span>
              <ProductBadge product={viewProduct} />
              <StatusBadge status={viewStatus} />
            </div>

            <section className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-emerald-900 dark:from-emerald-950/40 dark:to-slate-900 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="m-0 text-2xl font-bold text-slate-950 dark:text-white">{formatCurrency(viewFinances.principal)} <span className="text-sm font-medium text-slate-500">principal</span></p>
                <p className="m-0 mt-1 text-sm text-slate-500 dark:text-slate-400">{viewingRecord.employeeName || "Employee"}{viewingRecord.employeeId ? ` (${viewingRecord.employeeId})` : ""}</p>
              </div>
              <StatusBadge status={viewStatus} />
            </section>

            <dl className="grid gap-2 sm:grid-cols-2">
              {[
                { icon: CalendarDays, label: "Term", value: `${viewFinances.term} months` },
                { icon: Banknote, label: "Monthly Amort.", value: formatCurrency(viewFinances.monthly) },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <dt className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><item.icon size={14} /> {item.label}</dt>
                  <dd className="m-0 mt-1 text-sm font-semibold text-slate-950 dark:text-white">{item.value}</dd>
                </div>
              ))}
            </dl>

            <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <strong className="text-slate-900 dark:text-white">Repayment Progress</strong>
                <span className="text-slate-500 dark:text-slate-400">{viewFinances.paidInstallments} of {viewFinances.term} installments paid</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${repaymentProgress}%` }} /></div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-emerald-700 dark:text-emerald-400">Paid: {formatCurrency(viewFinances.paid)}</span>
                <span className="font-medium text-amber-600 dark:text-amber-400">Outstanding: {formatCurrency(viewFinances.outstanding)}</span>
              </div>
              <dl className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:grid-cols-3">
                <div><dt>Disbursed</dt><dd className="m-0 mt-0.5 text-slate-700 dark:text-slate-200">{formatDate(viewingRecord.disbursedAt, "Not yet disbursed")}</dd></div>
                <div><dt>First Payment</dt><dd className="m-0 mt-0.5 text-slate-700 dark:text-slate-200">{viewingRecord.disbursedAt ? formatDate(addMonths(viewingRecord.disbursedAt, 1)) : "—"}</dd></div>
                <div><dt>Maturity</dt><dd className="m-0 mt-0.5 text-slate-700 dark:text-slate-200">{viewingRecord.disbursedAt ? formatDate(addMonths(viewingRecord.disbursedAt, viewFinances.term)) : "—"}</dd></div>
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-700">
              <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Purpose</span>
              <p className="m-0 mt-1 text-sm text-slate-800 dark:text-slate-200">{viewingRecord.purpose || "No purpose provided."}</p>
            </section>

            {viewingRecord.approvalRemarks ? (
              <section className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-800 dark:bg-amber-950/30">
                <span className="block text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Review Notes</span>
                <p className="m-0 mt-1 text-sm text-amber-900 dark:text-amber-100">{viewingRecord.approvalRemarks}</p>
              </section>
            ) : null}

            {viewingRecord.governmentReferenceNumber ? (
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"><Building2 size={16} /> <span>Reference:</span> <strong>{viewingRecord.governmentReferenceNumber}</strong></div>
            ) : null}

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 text-sm font-semibold text-slate-900 dark:text-white">Amortization Schedule</h3>
                <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400"><span><Clock3 size={12} className="mr-1 inline" />{viewSchedule.filter((row) => row.status === "Overdue").length} overdue</span><span>{viewSchedule.filter((row) => row.status === "Paid").length} paid</span></div>
              </div>
              {payrollCollection(viewingRecord) === "manual" ? (
                <p className="m-0 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  Payroll only deducts loans of Regular employees, and this employee is {viewingRecord.employmentStatus}.{canRecordPayments ? " Record this loan's payments with the Pay button." : " This loan requires manual payment recording by an Admin or Cashier."}
                </p>
              ) : null}
              <div className="max-h-[330px] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <tr>{["#", "Due Date", "Principal", "Amount Due", "Balance", "Status", ...(canRecordPayments ? ["Action"] : [])].map((label) => <th key={label} className="border-b border-slate-200 px-3 py-2.5 font-semibold dark:border-slate-700">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {viewSchedule.map((installment) => (
                      <tr key={installment.installmentNumber} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">{installment.installmentNumber}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{formatDate(installment.dueDate)}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{formatCurrency(installment.principal)}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-white">{formatCurrency(installment.amountDue)}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{formatCurrency(installment.balance)}</td>
                        <td className="px-3 py-2.5"><span className={`whitespace-nowrap rounded-md border px-2 py-1 font-semibold ${INSTALLMENT_STATUS_BADGES[installment.status] || PRODUCT_BADGES.Other}`}>{installment.status}</span></td>
                        {canRecordPayments ? <td className="px-3 py-2.5">
                          {canRecordPayments && viewStatus === "Active" && installment.remainingDue > 0.01 ? (
                            <button type="button" onClick={() => startPayment(installment)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"><Banknote size={12} /> Pay</button>
                          ) : installment.status === "Paid" ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check size={12} /> Paid</span> : "—"}
                        </td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={paymentOpen}
        title="Record Loan Payment"
        onClose={() => !saving && setPaymentOpen(false)}
        maxWidth="max-w-lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPaymentOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" form="loan-payment-form" loading={saving} className="!bg-emerald-700 hover:!bg-emerald-800">Record Payment</Button>
          </>
        )}
      >
        <form id="loan-payment-form" onSubmit={handlePaymentSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Installment #{paymentForm.installmentNumber} for {viewingRecord ? loanNumber(viewingRecord) : "loan"}</div>
          <Field label="Payment Amount" required><input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} className={inputClass} required /></Field>
          <Field label="Payment Date" required><input type="date" value={paymentForm.paidAt} onChange={(event) => setPaymentForm((current) => ({ ...current, paidAt: event.target.value }))} className={inputClass} required /></Field>
          <Field label="Reference Number" className="sm:col-span-2"><input value={paymentForm.paymentReference} onChange={(event) => setPaymentForm((current) => ({ ...current, paymentReference: event.target.value }))} placeholder="Payroll or receipt reference" className={inputClass} /></Field>
          <Field label="Notes" className="sm:col-span-2"><textarea rows={2} value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} className={`${inputClass} py-2.5`} /></Field>
        </form>
      </Modal>
    </section>
  );
}
