import React, { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  CheckCircle2,
  Clock3,
  Download,
  Printer,
  Send,
  UserRound,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "react-hot-toast";
import Button from "../../components/UI/button";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { currencyFormatter, numberFormatter } from "../../utils/format";

function parseAmount(value) {
  const parsed = Number.parseFloat(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return currencyFormatter.format(parseAmount(value));
}

function formatNumber(value) {
  return numberFormatter.format(parseAmount(value));
}

function formatHours(value) {
  const hours = parseAmount(value);
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  const normalizedValue = String(value).includes("T") ? value : String(value).replace(" ", "T");
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const dateText = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (!/\d{1,2}:\d{2}/.test(String(value))) {
    return dateText;
  }

  return `${dateText} ${date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })}`;
}

function payrollIdLabel(record = {}) {
  const id = Number(record.id);
  return Number.isFinite(id) && id > 0 ? `PR-${String(id).padStart(4, "0")}` : "N/A";
}

function buildPeriodLabel(record = {}) {
  if (record.periodLabel) {
    return record.periodLabel;
  }

  if (!record.payPeriod) {
    return "Unspecified period";
  }

  return `${record.payPeriod} (${record.startDate || "N/A"} to ${record.endDate || "N/A"})`;
}

/*
 * The three rungs of the payroll approval chain -- HR Head, then the FAD Division Chief, then Regional
 * Director. Kept in step with PAYROLL_APPROVAL_CHAIN in backend/api/payroll.php, where the stored
 * values are abbreviated to fit `payroll.status` (varchar(20)); the FAD Chief's rung is still
 * stored as "Pending Chief".
 */
const HR_HEAD_STATUS = "Pending Approval";
const CHIEF_STATUS = "Pending Chief";
const DIRECTOR_STATUS = "Pending Director";

const STATUS_DISPLAY_LABELS = {
  [HR_HEAD_STATUS]: "Pending HR Head",
  [CHIEF_STATUS]: "Pending FAD Division Chief",
  [DIRECTOR_STATUS]: "Pending Director",
  Rejected: "Returned for Correction",
};

function statusBadgeClasses(status) {
  switch (status) {
    case HR_HEAD_STATUS:
      return "border-amber-200 bg-amber-50 text-amber-700";
    case CHIEF_STATUS:
      return "border-orange-200 bg-orange-50 text-orange-700";
    case DIRECTOR_STATUS:
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "Approved":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "Rejected":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "Paid":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Archived":
      return "border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

const REQUIRED_DEDUCTION_ROWS = [
  ["GSIS Premium", "Government Contributions", ["GSIS", "GSIS Premium"]],
  ["PAG-IBIG Premium", "Government Contributions", ["HDMF", "Pag-IBIG", "PAG IBIG PREMIUM", "PAG-IBIG Premium"]],
  ["PAG-IBIG MP2", "Government Contributions", ["MP2", "PAG IBIG MP2", "PAG-IBIG MP2"]],
  ["PhilHealth Premium", "Government Contributions", ["PHIC", "PhilHealth", "PHILHEALTH PREMIUM", "PhilHealth Premium"]],
  ["Deduction from Previous Payroll", "Payroll Adjustments", ["Deduction from Previous Payroll", "DEDUCTION PREVIOUS PAYROLL"]],
  ["Withholding Tax", "Tax Deductions", ["Withholding Tax", "WITHHOLDING TAX"]],
  ["Additional Withholding Tax (PBB 2020)", "Tax Deductions", ["Additional Withholding Tax (PBB 2020)", "ADDITIONAL WITHHOLDING TAX (PBB 2020)"]],
  ["Leave Without Pay (LWOP)", "Attendance Deductions", ["Absence Deduction", "Leave Without Pay (LWOP)", "LEAVE WITHOUT PAY(LWOP)"]],
  ["GSIS Consolidated Loan", "GSIS Loans", ["GSIS CONSOLIDATED LOAN", "GSIS Consolidated Loan"]],
  ["GSIS Policy Loan", "GSIS Loans", ["Policy Loan", "GSIS POLICY LOAN", "GSIS Policy Loan"]],
  ["GSIS Emergency Loan", "GSIS Loans", ["Emergency Loan", "GSIS EMERGY LOAN", "GSIS EMERGENCY LOAN", "GSIS Emergency Loan"]],
  ["GSIS UOLI 1", "GSIS Loans", ["GSIS UOLI 1"]],
  ["GSIS UOLI 2", "GSIS Loans", ["GSIS UOLI 2"]],
  ["GSIS UOLI 1 Loan", "GSIS Loans", ["GSIS UOLI 1 LOAN", "GSIS UOLI 1 Loan"]],
  ["GSIS UOLI 2 Loan", "GSIS Loans", ["GSIS UOLI 2 LOAN", "GSIS UOLI 2 Loan"]],
  ["GSIS Housing Loan", "GSIS Loans", ["GSIS HOUSING LOAN", "GSIS Housing Loan"]],
  ["GSIS Educational Loan", "GSIS Loans", ["GSIS EDUCATION LOAN", "GSIS EDUCATIONAL LOAN", "GSIS Educational Loan"]],
  ["GSIS GFAL", "GSIS Loans", ["GFAL", "GSIS GFAL"]],
  ["GSIS Computer Loan", "GSIS Loans", ["GSIS COMPUTER LOAN", "GSIS Computer Loan"]],
  ["GSIS MPL", "GSIS Loans", ["GSIS MPL"]],
  ["GSIS MPL Lite", "GSIS Loans", ["MPL Lite", "GSIS MPL LITE", "GSIS MPL Lite"]],
  ["PAG-IBIG Housing Loan", "Pag-IBIG Loans", ["Housing Loan", "PAG IBIG HOUSING LOAN", "PAG-IBIG Housing Loan"]],
  ["PAG-IBIG MPL", "Pag-IBIG Loans", ["PAG-IBIG MPL", "PAG IBIG MPL"]],
  ["PAG-IBIG Home Equity Appreciation Loan (HEAL)", "Pag-IBIG Loans", ["PAG-IBIG Home Equity Appreciation Loan (HEAL)", "HEAL"]],
  ["LBP Loan", "Other Loan Deductions", ["LBP Loan", "LBP LOAN"]],
  ["Disallowance (COLA)", "Other Deductions", ["Disallowance (COLA)", "DISALLOWANCE(COLA)"]],
  ["Disallowance (PRAISE)", "Other Deductions", ["Disallowance (PRAISE)", "DISALLOWANCE(PRAISE)"]],
  ["Disallowance (Maternity Leave)", "Other Deductions", ["Disallowance (Maternity Leave)", "DISALLOWANCE(MATERNITY LEAVE)"]],
  ["ENRP MOWEL", "Other Deductions", ["ENRP MOWEL"]],
  ["DBP Salary Loan", "Other Loan Deductions", ["DBP Salary Loan", "DBP SALARY LOAN"]],
  ["UCPB Salary Loan", "Other Loan Deductions", ["UCPB Salary Loan", "UCPB SALARY LOAN"]],
  ["MGBEA-X", "Other Deductions", ["MGBEA-X", "MGBBEA- X"]],
  ["Family Support (w/ Court Order)", "Other Deductions", ["Family Support (w/ Court Order)", "FAMILY SUPPORT(W/ COURT ORDER)"]],
];

function normalizeDeductionName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getAllowanceItems(record = {}) {
  const storedItems = Array.isArray(record.allowanceItems) ? record.allowanceItems : [];
  if (storedItems.length > 0) {
    return storedItems;
  }

  return [
    ["PERA", record.pera],
    ["Overtime Pay", record.overtimePay],
    ["Travel Allowance", record.travelAllowance],
    ["Salary Adjustment", record.salaryAdjustment],
    ["Other Allowances", record.otherAllowances],
    ["Bonus Amount", record.bonusAmount],
  ]
    .map(([name, amount]) => ({ name, amount: parseAmount(amount) }))
    .filter((item) => item.amount > 0);
}

function getDeductionItems(record = {}) {
  const storedItems = Array.isArray(record.deductionItems) ? record.deductionItems : [];
  const fallbackItems = [
    ["Late Deduction", "Attendance Deductions", record.lateDeduction],
    ["Absence Deduction", "Attendance Deductions", record.absenceDeduction],
    ["Undertime Deduction", "Attendance Deductions", record.undertimeDeduction],
    ["Withholding Tax", "Government Contributions", record.withholdingTax],
    ["SSS", "Government Contributions", record.sss],
    ["GSIS", "Government Contributions", record.gsis],
    ["HDMF", "Government Contributions", record.hdmf],
    ["PHIC", "Government Contributions", record.phic],
    ["Manual Cash Advance Adjustment", "Loan Deductions", record.manualCashAdvanceAdjustment],
    ["Laptop Loan", "Loan Deductions", record.laptopLoan],
    ["Other Deductions", "Loan Deductions", record.otherDeductions],
  ]
    .map(([name, category, amount]) => ({ name, category, amount: parseAmount(amount) }))
    .filter((item) => item.amount > 0);
  const sourceItems = (storedItems.length > 0 ? storedItems : fallbackItems).map((item) => ({
    name: item.name || "",
    category: item.category || "Deductions",
    amount: parseAmount(item.amount),
  }));
  const sourceByName = new Map();

  sourceItems.forEach((item) => {
    const key = normalizeDeductionName(item.name);
    if (!key) {
      return;
    }

    sourceByName.set(key, {
      ...item,
      amount: (sourceByName.get(key)?.amount || 0) + parseAmount(item.amount),
    });
  });

  const requiredRows = REQUIRED_DEDUCTION_ROWS.map(([name, category, aliases]) => {
    const matchedItem = aliases
      .map((alias) => sourceByName.get(normalizeDeductionName(alias)))
      .find(Boolean);

    return {
      name,
      category,
      amount: parseAmount(matchedItem?.amount),
    };
  });
  const requiredAliasKeys = new Set(
    REQUIRED_DEDUCTION_ROWS.flatMap(([, , aliases]) => aliases.map(normalizeDeductionName))
  );
  const extraRows = sourceItems.filter((item) => {
    const key = normalizeDeductionName(item.name);
    return parseAmount(item.amount) > 0 && key && !requiredAliasKeys.has(key);
  });

  return [...requiredRows, ...extraRows];
}

function TimelineIcon({ action }) {
  if (action === "Approved") {
    return <CheckCircle2 size={16} />;
  }

  if (action === "Rejected") {
    return <XCircle size={16} />;
  }

  if (action === "Paid") {
    return <WalletCards size={16} />;
  }

  if (action === "Submitted") {
    return <Send size={16} />;
  }

  return <Clock3 size={16} />;
}

function SummaryTile({ label, value, tone = "blue", strong = false }) {
  const toneClasses = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    red: "border-rose-200 bg-rose-50 text-rose-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <div className={`rounded-lg border bg-white px-4 py-3 ${toneClasses[tone] || toneClasses.blue}`}>
      <p className="m-0 text-xs font-bold uppercase tracking-normal text-slate-500">{label}</p>
      <p className={`m-0 mt-2 tabular-nums ${strong ? "text-lg font-extrabold" : "text-xl font-bold"}`}>
        {value}
      </p>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_minmax(0,1fr)]">
      <dt className="text-sm font-semibold text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-sm font-medium text-slate-900">{value || "N/A"}</dd>
    </div>
  );
}

function ApprovalSignaturePreview({ item }) {
  const signatureDataUrl = String(item?.signatureDataUrl || "").trim();
  const action = String(item?.action || "");
  const timestamp = formatDate(item?.actionDate);

  if (!["Approved", "Paid"].includes(action) || (!signatureDataUrl && timestamp === "N/A")) {
    return null;
  }

  return (
    <div className="mt-3 inline-flex min-w-[220px] flex-col rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex min-h-[48px] items-end justify-center">
        {signatureDataUrl ? (
          <img
            src={signatureDataUrl}
            alt={`${item.approverName || "Approver"} signature`}
            className="max-h-12 max-w-[180px] object-contain"
          />
        ) : (
          <p className="m-0 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-700">
            {timestamp}
          </p>
        )}
      </div>
      <p className="m-0 min-h-6 border-b border-slate-900 px-2 pb-1 text-center text-sm font-extrabold uppercase tracking-wide text-slate-950">
        {item.approverName || "Approver"}
      </p>
      <p className="m-0 mt-1 text-center text-xs font-medium text-slate-600">{item.approverRole || item.action}</p>
    </div>
  );
}

export default function PayrollDetailDrawer({
  open = false,
  record = null,
  onClose,
  onSubmitForApproval,
  onApprove,
  onReject,
  onMarkPaid,
  canSubmitForApproval = false,
  canApprove = false,
  canReject = false,
  canMarkPaid = false,
  // The pending statuses this viewer owns; a batch on someone else's desk shows no action buttons.
  approvalStages = [],
  actionLoading = false,
}) {
  const contentRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const allowanceItems = useMemo(() => getAllowanceItems(record || {}), [record]);
  const deductionItems = useMemo(() => getDeductionItems(record || {}), [record]);
  const approvalHistory = Array.isArray(record?.approvalHistory) ? record.approvalHistory : [];
  const profileImageUrl = resolveBackendAssetUrl(record?.profileImage);
  const status = record?.status || "Draft";
  const awaitsViewer = approvalStages.includes(status);
  const showSubmit = canSubmitForApproval && ["Draft", "Rejected"].includes(status);
  const showApprove = canApprove && awaitsViewer;
  const showReject = canReject && awaitsViewer;
  const showMarkPaid = canMarkPaid && status === "Approved";

  const handleExportPdf = async () => {
    if (!contentRef.current || !record) {
      return;
    }

    setExporting(true);
    try {
      const canvas = await html2canvas(contentRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imageData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      let heightLeft = imageHeight;
      let position = 0;

      pdf.addImage(imageData, "PNG", 0, position, pageWidth, imageHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", 0, position, pageWidth, imageHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${payrollIdLabel(record)}.pdf`);
      toast.success("Payroll PDF exported.");
    } catch {
      toast.error("Unable to export payroll PDF.");
    } finally {
      setExporting(false);
    }
  };

  if (!open || !record) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-labelledby="payroll-detail-title">
      <button
        type="button"
        aria-label="Close payroll details"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/45 backdrop-blur-sm"
        onClick={onClose}
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[1400px] animate-[slideInRight_180ms_ease-out] flex-col bg-white shadow-[0_28px_80px_rgba(15,23,42,0.25)]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-slate-500">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt={record.employeeName || "Employee"} className="h-full w-full object-cover" />
              ) : (
                <UserRound size={24} />
              )}
            </div>
            <div className="min-w-0">
              <h2 id="payroll-detail-title" className="m-0 truncate text-lg font-extrabold text-slate-950 sm:text-xl">
                {record.employeeName || "Employee"}
              </h2>
              <p className="m-0 mt-1 truncate text-sm text-slate-500">
                {payrollIdLabel(record)} | {buildPeriodLabel(record)}
              </p>
              <span className={`mt-2 inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-bold ${statusBadgeClasses(status)}`}>
                {STATUS_DISPLAY_LABELS[status] || status}
              </span>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <X size={18} />
          </button>
        </div>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-4">
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryTile label="Gross Pay" value={formatCurrency(record.grossPay)} tone="blue" />
            <SummaryTile label="Total Deductions" value={formatCurrency(record.totalDeduction)} tone="red" />
            <SummaryTile label="Net Pay" value={formatCurrency(record.netPay)} tone="green" strong />
          </div>

          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="m-0 text-sm font-extrabold uppercase tracking-normal text-slate-700">Employee Information</h3>
            <dl className="mt-4 grid gap-3 md:grid-cols-2">
              <DetailRow label="Employee Name" value={record.employeeName} />
              <DetailRow label="Employee ID" value={record.employeeId} />
              <DetailRow label="Position" value={record.position} />
              <DetailRow label="Division" value={record.division} />
              <DetailRow label="Basic Salary" value={formatCurrency(record.basicSalary)} />
              <DetailRow label="PERA" value={formatCurrency(record.pera)} />
              {/* The salary step from the service record -- a number, not an amount. */}
              <DetailRow label="Step Increment" value={record.stepIncrement ? String(record.stepIncrement) : ""} />
              <DetailRow label="Gross Pay Amount Earned" value={formatCurrency(record.grossPay)} />
              <DetailRow label="Employment Type" value={record.employmentType} />
              <DetailRow label="Payroll Type" value={record.payrollType || "Salary"} />
              <DetailRow label="Start Date" value={formatDate(record.startDate)} />
              <DetailRow label="End Date" value={formatDate(record.endDate)} />
            </dl>
          </section>

          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="m-0 text-sm font-extrabold uppercase tracking-normal text-slate-700">Allowances</h3>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              {/*
                * Name and amount, and a total in the foot — that fits a phone once the 520px floor
                * that used to force sideways scrolling is gone. Cards would only split a two-column
                * list into one card per line and lose the total row, so this one stays a table.
                */}
              <table className="w-full border-collapse text-sm sm:min-w-[520px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-extrabold uppercase text-slate-600">
                    <th className="px-4 py-3">Allowance Type</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {allowanceItems.length > 0 ? allowanceItems.map((item) => (
                    <tr key={`${item.name}-${item.amount}`} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(item.amount)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-500">No allowances recorded.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 font-extrabold text-slate-900">
                    <td className="px-4 py-3">Total Allowances</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(record.totalAllowance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="m-0 text-sm font-extrabold uppercase tracking-normal text-slate-700">Deductions</h3>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              {/* Same reasoning as the allowances table above. */}
              <table className="w-full border-collapse text-sm sm:min-w-[640px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-extrabold uppercase text-slate-600">
                    <th className="px-4 py-3">Deduction Type</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {deductionItems.length > 0 ? deductionItems.map((item) => (
                    <tr key={`${item.name}-${item.category}-${item.amount}`} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                      <td className="px-4 py-3 text-slate-600">{item.category || "Deductions"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(item.amount)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="px-4 py-4 text-center text-slate-500">No deductions recorded.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 font-extrabold text-slate-900">
                    <td className="px-4 py-3" colSpan={2}>Total Deductions</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(record.totalDeduction)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="m-0 text-sm font-extrabold uppercase tracking-normal text-slate-700">Detailed Deductions & Loans</h3>
            <dl className="mt-4 grid gap-3 md:grid-cols-2">
              <DetailRow label="GSIS Premium" value={formatCurrency(record.gsis)} />
              <DetailRow label="PAG-IBIG Premium" value={formatCurrency(record.hdmf)} />
              <DetailRow label="PAG-IBIG MP2" value={formatCurrency(record.pagibigMp2)} />
              <DetailRow label="PhilHealth Premium" value={formatCurrency(record.phic)} />
              <DetailRow label="Deduction from Previous Payroll" value={formatCurrency(record.deductionPreviousPayroll)} />
              <DetailRow label="Withholding Tax" value={formatCurrency(record.withholdingTax)} />
              <DetailRow label="Additional Withholding Tax (PBB 2020)" value={formatCurrency(record.additionalWithholdingTax)} />
              <DetailRow label="Leave Without Pay (LWOP)" value={formatCurrency(record.absenceDeduction)} />
              <DetailRow label="GSIS Consolidated Loan" value={formatCurrency(record.gsisConsolidatedLoan)} />
              <DetailRow label="GSIS Policy Loan" value={formatCurrency(record.gsisPolicyLoan)} />
              <DetailRow label="GSIS Emergency Loan" value={formatCurrency(record.gsisEmergencyLoan)} />
              <DetailRow label="GSIS UOLI 1" value={formatCurrency(record.gsisUoli1)} />
              <DetailRow label="GSIS UOLI 2" value={formatCurrency(record.gsisUoli2)} />
              <DetailRow label="GSIS UOLI 1 Loan" value={formatCurrency(record.gsisUoli1Loan)} />
              <DetailRow label="GSIS UOLI 2 Loan" value={formatCurrency(record.gsisUoli2Loan)} />
              <DetailRow label="GSIS Housing Loan" value={formatCurrency(record.gsisHousingLoan)} />
              <DetailRow label="GSIS Educational Loan" value={formatCurrency(record.gsisEducationalLoan)} />
              <DetailRow label="GSIS GFAL" value={formatCurrency(record.gsisGfal)} />
              <DetailRow label="GSIS Computer Loan" value={formatCurrency(record.gsisComputerLoan)} />
              <DetailRow label="GSIS MPL" value={formatCurrency(record.gsisMpl)} />
              <DetailRow label="GSIS MPL Lite" value={formatCurrency(record.gsisMplLite)} />
              <DetailRow label="PAG-IBIG Housing Loan" value={formatCurrency(record.pagibigHousingLoan)} />
              <DetailRow label="PAG-IBIG MPL" value={formatCurrency(record.pagibigMpl)} />
              <DetailRow label="PAG-IBIG Home Equity Appreciation Loan (HEAL)" value={formatCurrency(record.pagibigHeal)} />
              <DetailRow label="LBP Loan" value={formatCurrency(record.lbpLoan)} />
              <DetailRow label="Disallowance (COLA)" value={formatCurrency(record.disallowanceCola)} />
              <DetailRow label="Disallowance (PRAISE)" value={formatCurrency(record.disallowancePraise)} />
              <DetailRow label="Disallowance (Maternity Leave)" value={formatCurrency(record.disallowanceMaternityLeave)} />
              <DetailRow label="ENRP MOWEL" value={formatCurrency(record.enrpMowel)} />
              <DetailRow label="DBP Salary Loan" value={formatCurrency(record.dbpSalaryLoan)} />
              <DetailRow label="UCPB Salary Loan" value={formatCurrency(record.ucpbSalaryLoan)} />
              <DetailRow label="MGBEA-X" value={formatCurrency(record.mgbeaX)} />
              <DetailRow label="Family Support (w/ Court Order)" value={formatCurrency(record.familySupport)} />
            </dl>
          </section>

          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="m-0 text-sm font-extrabold uppercase tracking-normal text-slate-700">Payroll Summary</h3>
            <dl className="mt-4 grid gap-3 md:grid-cols-2">
              <DetailRow label="Due Date" value={formatDate(record.dueDate)} />
              <DetailRow label="Total Deductions" value={formatCurrency(record.totalDeduction)} />
              <DetailRow label="Net Amount Due" value={formatCurrency(record.netPay)} />
              <DetailRow label="March 1-15, 2026" value={formatCurrency(record.marchFirstHalf)} />
              <DetailRow label="March 16-31, 2026" value={formatCurrency(record.marchSecondHalf)} />
            </dl>
          </section>

          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="m-0 text-sm font-extrabold uppercase tracking-normal text-slate-700">Attendance Summary</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Expected Workdays" value={formatNumber(record.attendanceExpectedWorkdays)} />
              <DetailRow label="Leave Days" value={formatNumber(record.attendanceLeaveDays)} />
              <DetailRow label="Absent Days" value={formatNumber(record.absenceDays)} />
              <DetailRow label="Late Minutes" value={formatNumber(record.attendanceLateMinutes)} />
              <DetailRow label="Undertime Minutes" value={formatNumber(record.attendanceUndertimeMinutes)} />
              <DetailRow label="Overtime Hours" value={formatHours(record.overtimeHours)} />
            </div>
          </section>

          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="m-0 text-sm font-extrabold uppercase tracking-normal text-slate-700">Approval History</h3>
            <div className="mt-4 space-y-4">
              {approvalHistory.length > 0 ? approvalHistory.map((item) => (
                <div key={item.id || `${item.action}-${item.actionDate}`} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-600">
                    <TimelineIcon action={item.action} />
                  </div>
                  <div className="min-w-0 border-b border-slate-100 pb-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="m-0 text-sm font-extrabold text-slate-900">{item.action || "Updated"}</p>
                      <span className="text-xs text-slate-400">by</span>
                      <p className="m-0 text-sm font-semibold text-slate-700">{item.approverName || "System User"}</p>
                    </div>
                    <p className="m-0 mt-1 text-xs text-slate-500">{formatDate(item.actionDate)}</p>
                    <ApprovalSignaturePreview item={item} />
                    {item.comments ? (
                      <p className="m-0 mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                        {item.comments}
                      </p>
                    ) : null}
                  </div>
                </div>
              )) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-500">
                  No approval actions yet.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={Download} onClick={handleExportPdf} loading={exporting}>
              Export PDF
            </Button>
            <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
              Print
            </Button>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {showSubmit ? (
              <Button variant="secondary" size="sm" icon={Send} onClick={() => onSubmitForApproval?.(record)} loading={actionLoading}>
                Submit
              </Button>
            ) : null}
            {showApprove ? (
              <Button variant="primary" size="sm" icon={CheckCircle2} onClick={() => onApprove?.(record)} loading={actionLoading}>
                Approve
              </Button>
            ) : null}
            {showReject ? (
              <Button variant="danger" size="sm" icon={XCircle} onClick={() => onReject?.(record)} loading={actionLoading}>
                Return for Correction
              </Button>
            ) : null}
            {showMarkPaid ? (
              <Button variant="primary" size="sm" icon={WalletCards} onClick={() => onMarkPaid?.(record)} loading={actionLoading}>
                Mark as Paid
              </Button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
