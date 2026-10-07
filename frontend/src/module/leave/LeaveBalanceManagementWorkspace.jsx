import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Baby,
  CalendarDays,
  CalendarPlus,
  Clock3,
  Download,
  FileClock,
  FolderSync,
  History,
  Minus,
  Plus,
  PlusCircle,
  Search,
  ShieldCheck,
  StickyNote,
  Trash2,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  faArrowsRotate,
  faBoxArchive,
  faCirclePlus,
  faClockRotateLeft,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ActionsMenu from "../../components/UI/ActionsMenu";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import LeaveCreditSnapshot from "../../components/leave/LeaveCreditSnapshot";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  adjustLeaveBalances,
  bulkAddLeaveCredits,
  fetchLeaveBalanceHistory,
  fetchLeaveBalanceRows,
  resetEmployeeLeaveCredits,
  saveLeaveBalance,
} from "../../services/leaveCreditService";
import {
  adjustCompensatoryOvertimeCredits,
  fetchOvertimeRequests,
} from "../../services/overtimeService";
import {
  canArchiveModule,
  confirmArchiveRecordGroup,
  confirmRestoreRecordGroup,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import { resolveRoleKey } from "../../utils/leaveHelpers";
import { useOrganizationFilterOptions } from "../../hooks/useFilterOptions";

/*
 * The header row sticks to the top of its own scroll box, and `border-collapse` paints cell
 * borders on the table rather than the cell — so a sticky header loses its divider and shows
 * rows through it. The solid fill plus an inset bottom line keep both while it is pinned.
 */
const TABLE_HEAD_CELL = "bg-slate-50 shadow-[inset_0_-1px_0_#e2e8f0]";

const TABLE_BALANCE_COLUMNS = [
  { key: "VL", label: "Vacation Leave Balance" },
  { key: "SL", label: "Sick Leave Balance" },
  { key: "SPL", label: "Special Leave Balance" },
];

/*
 * Forced leave has no entry of its own: filing it spends vacation credits, so adjusting the
 * vacation balance is what changes how much forced leave an employee can still take.
 */
const LEAVE_TYPE_OPTIONS = [
  { code: "VL", label: "Vacation Leave" },
  { code: "SL", label: "Sick Leave" },
  { code: "SPL", label: "Special Privilege Leave" },
  { code: "SOPL", label: "Solo Parent Leave" },
  { code: "STL", label: "Study Leave" },
  { code: "ML", label: "Maternity Leave" },
  { code: "PL", label: "Paternity Leave" },
];

// Parental leave credits only apply to one gender, so the adjustment sheet hides
// the leave that the employee can never file for.
const GENDER_RESTRICTED_LEAVE_CODES = {
  ML: "female",
  PL: "male",
};

// One click on the stepper moves the balance by a monthly accrual (1.25 days);
// typed values may be finer (quarter day) for corrections.
const BALANCE_STEP = 1.25;

/*
 * The registry shows two credit pools, and they are counted in different units: leave is days
 * carried in `leave_credits`, COC is hours derived from approved overtime. They share this screen —
 * and its search, division and pagination controls — but never share a row, so the mode simply
 * swaps the table and the primary button.
 */
const BALANCE_MODES = [
  { key: "leave", label: "Leave Credits" },
  { key: "coc", label: "COC Credits" },
];

// Compensatory credits are earned in whole rendered hours, so that is the stepper's click.
const COC_STEP = 1;

const EMPTY_COC_TOTALS = { rendered: 0, manual: 0, total: 0, latestDate: "" };

/*
 * COC balances can be set for Regular and Contract of Service employees. "Permanent" is the older
 * spelling of Regular, while "Contractual" and "COS" are legacy Contract of Service values that
 * still exist on older employee records.
 */
const COC_ELIGIBLE_EMPLOYMENT_STATUSES = new Set([
  "regular",
  "permanent",
  "contract of service",
  "contractual",
  "cos",
]);

function isCocEligibleEmployeeRow(row = {}) {
  const status = String(row.employmentStatus || "").trim().toLowerCase();
  return COC_ELIGIBLE_EMPLOYMENT_STATUSES.has(status);
}

function formatBalanceValue(value) {
  const numericValue = Number(value) || 0;
  return numericValue.toFixed(2).replace(/\.00$/, "");
}

function formatHours(value) {
  const numericValue = Number(value) || 0;
  return numericValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * COC credits per employee, keyed by employee record id.
 *
 * Only approved overtime counts — that final signature is what turns a filing into a credit. The
 * hand-posted rows HR writes from this screen carry `source: "manual_coc"` and are already approved,
 * so they are split out to show how much of the total the desk put there itself.
 */
function buildCocTotals(records = []) {
  const totals = new Map();

  records.forEach((record) => {
    if (String(record?.status || "").trim().toLowerCase() !== "approved") {
      return;
    }

    const key = String(record.employeeRecordId || "");
    if (!key) {
      return;
    }

    const hours = Number(
      record.hourRequested ?? record.overtimeHours ?? record.hoursWorked ?? record.duration
    );
    const entry = totals.get(key) || { ...EMPTY_COC_TOTALS };

    if (Number.isFinite(hours)) {
      if (String(record.source || "request").trim().toLowerCase() === "manual_coc") {
        entry.manual += hours;
      } else {
        entry.rendered += hours;
      }

      entry.total += hours;
    }

    const recordDate = record.workDate || record.overtimeDate || record.dateFiled || "";
    if (recordDate && (!entry.latestDate || recordDate > entry.latestDate)) {
      entry.latestDate = recordDate;
    }

    totals.set(key, entry);
  });

  return totals;
}

function getCocTotals(totals, employeeRecordId) {
  return totals.get(String(employeeRecordId)) || EMPTY_COC_TOTALS;
}

// Keeps stepper arithmetic free of floating point drift (0.1 + 0.2 style noise).
function roundBalance(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatDateTime(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function normalizeBalanceRecord(balance = {}) {
  return {
    code: String(balance.code || "").trim(),
    type: String(balance.type || "").trim(),
    total: Number(balance.total) || 0,
    used: Number(balance.used) || 0,
    remaining: Number(balance.remaining) || 0,
    /* Vacation and sick leave earn credits on the 1st of every month; the API says how much and when next. */
    monthlyAccrual: Number(balance.monthlyAccrual) || 0,
    nextAccrualDate: String(balance.nextAccrualDate || "").trim(),
  };
}

/**
 * "+1.25 on Nov 01, 2026" — the posting this balance is about to receive, so the registry reads as
 * what the balance is becoming and not only what it is. Empty for pools that do not accrue.
 */
function formatUpcomingAccrual(balance) {
  if (!(balance?.monthlyAccrual > 0) || !balance?.nextAccrualDate) {
    return "";
  }

  return `+${formatBalanceValue(balance.monthlyAccrual)} on ${formatDateOnly(balance.nextAccrualDate)}`;
}

function getBalanceRecord(row, code) {
  if (!row) {
    return normalizeBalanceRecord({ code });
  }

  return normalizeBalanceRecord(row.balanceMap?.[code]);
}

function resolveGenderKey(row) {
  const gender = String(row?.gender || "").trim().toLowerCase();

  if (gender === "male" || gender === "m") {
    return "male";
  }
  if (gender === "female" || gender === "f") {
    return "female";
  }

  return "";
}

function getGenderLabel(row) {
  const genderKey = resolveGenderKey(row);

  if (genderKey === "male") {
    return "Male";
  }
  if (genderKey === "female") {
    return "Female";
  }

  return String(row?.gender || "").trim() || "Not recorded";
}

function isLeaveTypeApplicable(row, code) {
  const restrictedTo = GENDER_RESTRICTED_LEAVE_CODES[code];

  if (!restrictedTo) {
    return true;
  }

  // With no recorded gender both parental leaves stay available so HR can still act.
  const genderKey = resolveGenderKey(row);
  return !genderKey || restrictedTo === genderKey;
}

function getApplicableLeaveTypes(row) {
  return LEAVE_TYPE_OPTIONS.filter((type) => isLeaveTypeApplicable(row, type.code));
}

/**
 * Balance as the registry should present it: parental leave that the employee's
 * gender can never file for always reads as 0 day, regardless of stored credits.
 */
function getDisplayBalanceRecord(row, code) {
  const balance = getBalanceRecord(row, code);

  if (isLeaveTypeApplicable(row, code)) {
    return { ...balance, applicable: true };
  }

  return {
    code: balance.code,
    type: balance.type,
    total: 0,
    used: 0,
    remaining: 0,
    monthlyAccrual: 0,
    nextAccrualDate: "",
    applicable: false,
  };
}

function getParentalLeaveSummary(row) {
  const genderKey = resolveGenderKey(row);

  if (genderKey === "male") {
    return "Paternity Leave";
  }
  if (genderKey === "female") {
    return "Maternity Leave";
  }

  return "Maternity & Paternity Leave (gender not recorded)";
}

function getBalanceHealth(balance) {
  const remaining = Number(balance?.remaining) || 0;
  const total = Number(balance?.total) || 0;

  if (remaining <= 0) {
    const leaveCode = String(balance?.code || "").trim().toUpperCase();

    return {
      tone: "depleted",
      label: ["VL", "SL"].includes(leaveCode) ? "Insufficient" : "Depleted",
      amountClass: "border-rose-200 bg-rose-50 text-rose-700",
      badgeClass: "bg-rose-600 text-white",
    };
  }

  const lowThreshold = total > 0 ? Math.min(3, total * 0.25) : 3;
  if (remaining <= lowThreshold) {
    return {
      tone: "low",
      label: "Low",
      amountClass: "border-amber-200 bg-amber-50 text-amber-700",
      badgeClass: "bg-amber-500 text-slate-950",
    };
  }

  return {
    tone: "healthy",
    label: "Healthy",
    amountClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    badgeClass: "bg-emerald-600 text-white",
  };
}

function getSortValue(row, sortKey) {
  switch (sortKey) {
    case "employeeName":
    case "employeeId":
    case "division":
    case "position":
      return String(row?.[sortKey] || "").toLowerCase();
    case "lastUpdated":
      return new Date(row?.lastUpdated || 0).getTime();
    case "VL":
    case "SL":
    case "SPL":
    case "SOPL":
    case "STL":
    case "ML":
    case "PL":
      return getDisplayBalanceRecord(row, sortKey).remaining;
    default:
      return String(row?.employeeName || "").toLowerCase();
  }
}

function sortRows(rows, sortBy, sortDirection) {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const leftValue = getSortValue(left, sortBy);
    const rightValue = getSortValue(right, sortBy);

    if (typeof leftValue === "number" || typeof rightValue === "number") {
      return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * direction;
    }

    return String(leftValue).localeCompare(String(rightValue), undefined, {
      sensitivity: "base",
    }) * direction;
  });
}

function FloatingCardModal({
  open = false,
  title = "",
  description = "",
  maxWidthClassName = "max-w-3xl",
  onClose,
  children,
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`relative z-10 w-full ${maxWidthClassName} overflow-hidden rounded-[30px] border border-emerald-100 bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="border-b border-slate-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50 px-5 py-4 sm:px-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="m-0 text-lg font-semibold text-slate-950">{title}</h2>
              <p className="m-0 mt-1 text-sm text-slate-500">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

function BalanceStatusBadge({ balance }) {
  const health = getBalanceHealth(balance);

  if (health.tone === "healthy") {
    return null;
  }

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${health.badgeClass}`}>
      {health.label}
    </span>
  );
}

function BalanceCell({ balance }) {
  // A leave the employee's gender cannot file for reads as a plain 0 credits rather
  // than a red "Depleted" balance, which would be misleading.
  if (balance.applicable === false) {
    return (
      <div className="space-y-1">
        <div className="inline-flex min-h-8 items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-400">
          0 credits
        </div>
        <div className="text-[11px] text-slate-400">Not applicable</div>
      </div>
    );
  }

  const health = getBalanceHealth(balance);
  const upcomingAccrual = formatUpcomingAccrual(balance);

  // A column, so the next posting and the status badge sit under the balance, not beside it.
  return (
    <div className="flex flex-col items-start gap-1">
      <div className={`inline-flex min-h-8 items-center rounded-xl border px-2.5 text-xs font-semibold ${health.amountClass}`}>
        {formatBalanceValue(balance.remaining)} credit{Number(balance.remaining) === 1 ? "" : "s"}
      </div>
      {upcomingAccrual ? (
        <div
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-emerald-700"
          title={`${balance.type} earns ${formatBalanceValue(balance.monthlyAccrual)} credit(s) on the 1st of every month.`}
        >
          <CalendarPlus size={12} aria-hidden="true" />
          <span>{upcomingAccrual}</span>
        </div>
      ) : null}
      <BalanceStatusBadge balance={balance} />
    </div>
  );
}

/**
 * The -/+ control that sets an employee's COC credits straight from the registry row.
 *
 * The field holds the *new total*, not the movement, so an untouched row simply mirrors what the
 * employee already has and reads as no change. The movement is derived on save, which is what the
 * API is posted — one credit or deduction row per employee that actually moved.
 */
function CocBalanceStepper({ total = 0, draft, disabled = false, onChange, employeeName = "" }) {
  const rawTarget = draft ?? formatBalanceValue(total);
  const target = Number(rawTarget);
  const hasTarget = rawTarget !== "" && !Number.isNaN(target);
  const nextTotal = hasTarget ? roundBalance(target) : total;
  const delta = hasTarget ? roundBalance(nextTotal - total) : 0;
  const belowZero = hasTarget && nextTotal < 0;

  const stepTotal = (direction) => {
    const base = hasTarget ? nextTotal : total;
    onChange(formatBalanceValue(Math.max(0, roundBalance(base + (direction * COC_STEP)))));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || (hasTarget && nextTotal <= 0)}
          onClick={() => stepTotal(-1)}
          aria-label={`Deduct ${COC_STEP} COC credit from ${employeeName || "this employee"}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white disabled:hover:text-slate-600"
        >
          <Minus size={15} />
        </button>

        <input
          type="number"
          min="0"
          step="0.25"
          inputMode="decimal"
          disabled={disabled}
          value={rawTarget}
          onChange={(event) => onChange(event.target.value)}
          placeholder={formatBalanceValue(total)}
          aria-label={`COC credits for ${employeeName || "this employee"}`}
          className="h-9 w-24 rounded-xl border border-slate-300 bg-white px-2.5 text-center text-sm font-semibold text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-500"
        />

        <button
          type="button"
          disabled={disabled}
          onClick={() => stepTotal(1)}
          aria-label={`Add ${COC_STEP} COC credit to ${employeeName || "this employee"}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={15} />
        </button>
      </div>

      {delta !== 0 ? (
        <p className={`m-0 text-[11px] font-semibold ${
          belowZero ? "text-rose-600" : delta > 0 ? "text-emerald-700" : "text-amber-700"
        }`}>
          {belowZero
            ? "Credits cannot go below 0."
            : `${delta > 0 ? "+" : "-"}${formatBalanceValue(Math.abs(delta))} hrs · ${formatHours(total)} → ${formatHours(nextTotal)}`}
        </p>
      ) : (
        <p className="m-0 text-[11px] text-slate-400">No change</p>
      )}
    </div>
  );
}

function LeaveBalanceEditorModal({
  open = false,
  mode = "update",
  employeeRows = [],
  cocTotals = null,
  defaultEmployeeRecordId = null,
  defaultLeaveTypeCode = "",
  defaultCreditType = "leave",
  updatedBy = "",
  saving = false,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState({
    creditType: "leave",
    employeeRecordId: "",
    leaveTypeCode: "",
    newBalance: "",
    effectiveDate: "",
    remarks: "",
  });
  const [errors, setErrors] = useState({});

  const isCocCredit = form.creditType === "coc";

  /* The COC picker is limited to Regular and Contract of Service appointments. */
  const employeeOptions = useMemo(
    () =>
      employeeRows
        .filter((row) => !isCocCredit || isCocEligibleEmployeeRow(row))
        .map((row) => ({
          employeeRecordId: row.employeeRecordId,
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          division: row.division,
        })),
    [employeeRows, isCocCredit]
  );

  useEffect(() => {
    if (!open) {
      setErrors({});
      return;
    }

    setForm({
      creditType: defaultCreditType === "coc" ? "coc" : "leave",
      employeeRecordId: defaultEmployeeRecordId ? String(defaultEmployeeRecordId) : "",
      leaveTypeCode: defaultLeaveTypeCode || "",
      newBalance: "",
      // Not shown on the form any more — every save is simply dated the day it was made.
      effectiveDate: todayInputValue(),
      remarks: "",
    });
    setErrors({});
  }, [defaultCreditType, defaultEmployeeRecordId, defaultLeaveTypeCode, open]);

  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeOptions, form.employeeRecordId]
  );

  const selectedRow = useMemo(
    () => employeeRows.find((row) => String(row.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeRows, form.employeeRecordId]
  );

  // Switching credit types clears an employee whose appointment is not eligible for COC.
  useEffect(() => {
    if (!open || !form.employeeRecordId || selectedEmployee) {
      return;
    }

    setForm((current) => ({ ...current, employeeRecordId: "", newBalance: "" }));
  }, [form.employeeRecordId, open, selectedEmployee]);

  const selectedCocTotals = useMemo(
    () => (cocTotals && form.employeeRecordId
      ? getCocTotals(cocTotals, form.employeeRecordId)
      : EMPTY_COC_TOTALS),
    [cocTotals, form.employeeRecordId]
  );

  const currentBalance = useMemo(() => {
    if (isCocCredit) {
      return selectedRow ? selectedCocTotals.total : 0;
    }

    if (!selectedRow || !form.leaveTypeCode) {
      return 0;
    }

    return getBalanceRecord(selectedRow, form.leaveTypeCode).remaining;
  }, [form.leaveTypeCode, isCocCredit, selectedCocTotals, selectedRow]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm((current) => {
      // COC has a single pool, so a chosen employee is all it takes to know the starting balance.
      const readyToPrefill = current.creditType === "coc"
        ? Boolean(current.employeeRecordId)
        : Boolean(current.leaveTypeCode);

      if (!readyToPrefill || current.newBalance !== "") {
        return current;
      }

      return {
        ...current,
        newBalance: formatBalanceValue(currentBalance),
      };
    });
  }, [currentBalance, open]);

  // COC is posted as a movement, so the field's total is only worth saving once it actually moved.
  const cocDelta = roundBalance(Number(form.newBalance || 0) - currentBalance);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = {};

    if (!form.employeeRecordId) {
      nextErrors.employeeRecordId = "Employee is required.";
    }
    if (!isCocCredit && !form.leaveTypeCode) {
      nextErrors.leaveTypeCode = "Leave type is required.";
    }
    if (form.newBalance === "" || Number.isNaN(Number(form.newBalance)) || Number(form.newBalance) < 0) {
      nextErrors.newBalance = "Provide a valid non-negative balance.";
    } else if (isCocCredit && form.employeeRecordId && cocDelta === 0) {
      nextErrors.newBalance = "Set a different balance before saving.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const selectedLeaveType = LEAVE_TYPE_OPTIONS.find((item) => item.code === form.leaveTypeCode);
    const confirmation = await Swal.fire({
      title: `${mode === "set" ? "Set" : "Update"} ${isCocCredit ? "COC" : "Leave"} Balance?`,
      text: isCocCredit
        ? `Post ${cocDelta > 0 ? "+" : "-"}${formatBalanceValue(Math.abs(cocDelta))} hrs for ${selectedEmployee?.employeeName || "this employee"} (${formatHours(currentBalance)} → ${formatHours(Number(form.newBalance))} hrs)?`
        : `Apply ${selectedLeaveType?.label || "leave balance"} for ${selectedEmployee?.employeeName || "this employee"}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Save balance",
      cancelButtonText: "Review first",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    await onSave?.({
      action: mode,
      creditType: form.creditType,
      employeeRecordId: Number(form.employeeRecordId),
      employeeName: selectedEmployee?.employeeName || "",
      leaveTypeCode: isCocCredit ? "" : form.leaveTypeCode,
      currentBalance,
      newBalance: Number(form.newBalance),
      delta: cocDelta,
      // The ledger still dates every posted credit; the desk just no longer picks the day.
      effectiveDate: form.effectiveDate || todayInputValue(),
      remarks: form.remarks.trim(),
    });
  };

  const inputClassName = "min-h-[46px] w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
  const errorClassName = "mt-1 text-xs text-rose-600";

  return (
    <FloatingCardModal
      open={open}
      onClose={onClose}
      title={`${mode === "set" ? "Set" : "Update"} ${isCocCredit ? "COC" : "Leave"} Balance`}
      description={isCocCredit
        ? "Post compensatory overtime credits for a Regular or Contract of Service employee with a clean audit-friendly workflow."
        : "Adjust employee leave credits with a clean audit-friendly workflow."}
      maxWidthClassName="max-w-4xl"
    >
      <form onSubmit={handleSubmit}>
        <div className="max-h-[78vh] overflow-y-auto px-5 py-5 sm:px-4">
          {/* Which pool the balance is written to: leave days or compensatory overtime hours. */}
          <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <span className="block text-sm font-semibold text-slate-700">Credit Type</span>
            <div
              role="tablist"
              aria-label="Credit type"
              className="mt-2 inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1"
            >
              {BALANCE_MODES.map((creditMode) => (
                <button
                  key={creditMode.key}
                  type="button"
                  role="tab"
                  aria-selected={form.creditType === creditMode.key}
                  onClick={() => {
                    setForm((current) => (current.creditType === creditMode.key ? current : {
                      ...current,
                      creditType: creditMode.key,
                      newBalance: "",
                    }));
                    setErrors({});
                  }}
                  className={`inline-flex min-h-9 items-center justify-center rounded-xl px-3.5 text-sm font-semibold transition ${
                    form.creditType === creditMode.key
                      ? "bg-[#D61E1E] text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {creditMode.label}
                </button>
              ))}
            </div>
            <p className="m-0 mt-2 text-xs text-slate-500">
              {isCocCredit
                ? "Compensatory overtime credits are counted in hours and list Regular and Contract of Service employees."
                : "Leave credits are counted in days and cover every active employee record."}
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                <UserRound size={16} />
                <span>Employee</span>
                {isCocCredit ? (
                  <span className="ml-auto inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                    Regular &amp; Contract of Service only
                  </span>
                ) : null}
              </div>
              <div className="mt-3">
                <EmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={selectedEmployee}
                  onSelect={(employee) => {
                    setForm((current) => ({
                      ...current,
                      employeeRecordId: String(employee.employeeRecordId),
                      newBalance: "",
                    }));
                    setErrors((current) => ({ ...current, employeeRecordId: "" }));
                  }}
                  placeholder={isCocCredit ? "Search Regular or Contract of Service employee..." : "Search employee..."}
                />
                {errors.employeeRecordId ? <p className={errorClassName}>{errors.employeeRecordId}</p> : null}
                {isCocCredit && employeeOptions.length === 0 ? (
                  <p className="m-0 mt-2 text-xs text-amber-700">
                    No Regular or Contract of Service employees found. Check that employment status is set on the employee records.
                  </p>
                ) : null}
              </div>

              {/* COC has a single pool, so the leave-type picker has nothing to offer it. */}
              <div className={`mt-4 grid gap-4 ${isCocCredit ? "" : "sm:grid-cols-2"}`}>
                {isCocCredit ? null : (
                  <label>
                    <span className="block text-sm font-semibold text-slate-700">Leave Type</span>
                    <select
                      value={form.leaveTypeCode}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, leaveTypeCode: event.target.value, newBalance: "" }));
                        setErrors((current) => ({ ...current, leaveTypeCode: "" }));
                      }}
                      className={`${inputClassName} mt-2`}
                    >
                      <option value="">Select leave type</option>
                      {LEAVE_TYPE_OPTIONS.map((type) => (
                        <option key={type.code} value={type.code}>{type.label}</option>
                      ))}
                    </select>
                    {errors.leaveTypeCode ? <p className={errorClassName}>{errors.leaveTypeCode}</p> : null}
                  </label>
                )}

                <label>
                  <span className="block text-sm font-semibold text-slate-700">Current Balance</span>
                  <input
                    readOnly
                    value={isCocCredit
                      ? `${formatHours(currentBalance)} hrs`
                      : `${formatBalanceValue(currentBalance)} days`}
                    className={`${inputClassName} mt-2 bg-slate-50 text-slate-600`}
                  />
                </label>
              </div>

              {/* Where the credits came from: rendered overtime versus what this desk posted. */}
              {isCocCredit && selectedEmployee ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-emerald-100 bg-white px-3 py-2.5">
                    <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Rendered</p>
                    <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{formatHours(selectedCocTotals.rendered)} hrs</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-white px-3 py-2.5">
                    <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">HR-posted</p>
                    <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{formatHours(selectedCocTotals.manual)} hrs</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck size={16} />
                <span>Balance Details</span>
              </div>

              <div className="mt-4 grid gap-4">
                {isCocCredit ? (
                  <div>
                    <span className="block text-sm font-semibold text-slate-700">New Balance (hours)</span>
                    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <CocBalanceStepper
                        total={currentBalance}
                        draft={form.newBalance}
                        disabled={!form.employeeRecordId}
                        employeeName={selectedEmployee?.employeeName || ""}
                        onChange={(value) => {
                          setForm((current) => ({ ...current, newBalance: value }));
                          setErrors((current) => ({ ...current, newBalance: "" }));
                        }}
                      />
                    </div>
                    {errors.newBalance ? <p className={errorClassName}>{errors.newBalance}</p> : null}
                  </div>
                ) : (
                  <label>
                    <span className="block text-sm font-semibold text-slate-700">New Balance</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.newBalance}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, newBalance: event.target.value }));
                        setErrors((current) => ({ ...current, newBalance: "" }));
                      }}
                      className={`${inputClassName} mt-2`}
                      placeholder="Enter updated balance"
                    />
                    {errors.newBalance ? <p className={errorClassName}>{errors.newBalance}</p> : null}
                  </label>
                )}

                <label>
                  <span className="block text-sm font-semibold text-slate-700">Remarks / Notes</span>
                  <textarea
                    rows={4}
                    value={form.remarks}
                    onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Add a short explanation for this change"
                  />
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Updated By</p>
                  <p className="m-0 mt-2 text-sm font-semibold text-slate-900">{updatedBy || "HR Head"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#D61E1E] px-4 text-sm font-semibold text-white transition hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : mode === "set" ? "Set Balance" : "Update Balance"}
          </button>
        </div>
      </form>
    </FloatingCardModal>
  );
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function getEmployeeInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "NA";
  }

  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";

  return `${first}${last}`.toUpperCase();
}

function LeaveAdjustmentCard({
  type,
  balance,
  draft,
  removable = false,
  onChange,
  onClear,
  onRemove,
}) {
  // The input carries the *new* remaining balance, so an untouched card simply
  // mirrors whatever the employee currently has left.
  const rawTarget = draft?.target ?? formatBalanceValue(balance.remaining);
  const target = Number(rawTarget);
  const hasTarget = rawTarget !== "" && !Number.isNaN(target);
  const nextRemaining = hasTarget ? roundBalance(target) : balance.remaining;
  const delta = hasTarget ? roundBalance(nextRemaining - balance.remaining) : 0;
  const hasChange = delta !== 0;
  const operation = delta > 0 ? "add" : "deduct";
  const exceedsBalance = hasTarget && nextRemaining < 0;

  const cardToneClass = !hasChange
    ? "border-slate-200 bg-white hover:border-slate-300"
    : exceedsBalance
      ? "border-rose-400 bg-rose-50/70 shadow-sm"
      : operation === "add"
        ? "border-emerald-300 bg-emerald-50/60 shadow-sm"
        : "border-amber-300 bg-amber-50/60 shadow-sm";

  const stepBalance = (direction) => {
    const base = hasTarget ? nextRemaining : balance.remaining;
    const stepped = roundBalance(base + (direction * BALANCE_STEP));
    onChange({ target: formatBalanceValue(Math.max(0, stepped)) });
  };

  return (
    <article className={`rounded-3xl border p-4 transition ${cardToneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-900 text-[11px] font-bold tracking-wide text-white">
            {type.code}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-900">{type.label}</p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">
              Current <strong className="font-semibold text-slate-700">{formatBalanceValue(balance.remaining)}</strong>
              {" · "}Used {formatBalanceValue(balance.used)}
              {" · "}Total {formatBalanceValue(balance.total)}
            </p>
          </div>
        </div>

        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${type.label}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => stepBalance(-1)}
            disabled={hasTarget && nextRemaining <= 0}
            aria-label={`Decrease ${type.label} balance by ${BALANCE_STEP} day(s)`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white disabled:hover:text-slate-600"
          >
            <Minus size={16} />
          </button>

          <input
            type="number"
            min="0"
            step="0.25"
            inputMode="decimal"
            value={rawTarget}
            onChange={(event) => onChange({ target: event.target.value })}
            placeholder={formatBalanceValue(balance.remaining)}
            aria-label={`${type.label} remaining balance`}
            className="h-10 w-24 rounded-xl border border-slate-300 bg-white px-3 text-center text-sm font-semibold text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />

          <button
            type="button"
            onClick={() => stepBalance(1)}
            aria-label={`Increase ${type.label} balance by ${BALANCE_STEP} day(s)`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
          >
            <Plus size={16} />
          </button>
        </div>

        <span className="text-xs font-medium text-slate-500">remaining day(s)</span>

        {hasChange ? (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-white hover:text-slate-700"
          >
            <Undo2 size={12} />
            Reset
          </button>
        ) : null}
      </div>

      {hasChange ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/80 px-3 py-2">
          <span className="inline-flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">New balance</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              exceedsBalance
                ? "bg-rose-100 text-rose-700"
                : operation === "add"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
            }`}>
              {delta > 0 ? "+" : "-"}{formatBalanceValue(Math.abs(delta))}
            </span>
          </span>
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <span className="text-slate-400">{formatBalanceValue(balance.remaining)}</span>
            <span className="text-slate-400">&rarr;</span>
            <span className={exceedsBalance ? "text-rose-600" : operation === "add" ? "text-emerald-700" : "text-amber-700"}>
              {formatBalanceValue(nextRemaining)} day{Number(nextRemaining) === 1 ? "" : "s"}
            </span>
          </span>
        </div>
      ) : null}

      {exceedsBalance ? (
        <p className="m-0 mt-2 text-xs font-semibold text-rose-600">
          The remaining balance cannot go below 0 day(s).
        </p>
      ) : null}
    </article>
  );
}

function LeaveBalanceAdjustmentModal({
  open = false,
  row = null,
  updatedBy = "",
  saving = false,
  onClose,
  onApply,
}) {
  const [drafts, setDrafts] = useState({});
  const [extraCodes, setExtraCodes] = useState([]);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");

  const employeeRecordId = row?.employeeRecordId ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }

    setDrafts({});
    setExtraCodes([]);
    setEffectiveDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setFormError("");
  }, [employeeRecordId, open]);

  const applicableTypes = useMemo(() => getApplicableLeaveTypes(row), [row]);
  const applicableCodes = useMemo(() => applicableTypes.map((type) => type.code), [applicableTypes]);

  const visibleTypes = useMemo(
    () => [
      ...applicableTypes,
      ...LEAVE_TYPE_OPTIONS.filter((type) => extraCodes.includes(type.code)),
    ],
    [applicableTypes, extraCodes]
  );

  const availableExtraTypes = useMemo(
    () => LEAVE_TYPE_OPTIONS.filter(
      (type) => !applicableCodes.includes(type.code) && !extraCodes.includes(type.code)
    ),
    [applicableCodes, extraCodes]
  );

  const pendingChanges = useMemo(
    () =>
      visibleTypes
        .map((type) => {
          const draft = drafts[type.code];
          const target = Number(draft?.target);

          if (!draft || draft.target === "" || Number.isNaN(target)) {
            return null;
          }

          const balance = getBalanceRecord(row, type.code);
          const nextRemaining = roundBalance(target);
          const delta = roundBalance(nextRemaining - balance.remaining);

          if (delta === 0) {
            return null;
          }

          return {
            type,
            balance,
            operation: delta > 0 ? "add" : "deduct",
            amount: Math.abs(delta),
            nextRemaining,
          };
        })
        .filter(Boolean),
    [drafts, row, visibleTypes]
  );

  const invalidChanges = pendingChanges.filter((change) => change.nextRemaining < 0);

  const updateDraft = useCallback((code, patch) => {
    setDrafts((current) => ({
      ...current,
      [code]: { target: "", ...(current[code] || {}), ...patch },
    }));
    setFormError("");
  }, []);

  const clearDraft = useCallback((code) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
  }, []);

  const removeExtraType = useCallback((code) => {
    setExtraCodes((current) => current.filter((item) => item !== code));
    clearDraft(code);
  }, [clearDraft]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!row?.employeeRecordId) {
      setFormError("Select an employee record first.");
      return;
    }
    if (!effectiveDate) {
      setFormError("Effective date is required.");
      return;
    }
    if (pendingChanges.length === 0) {
      setFormError("Change the remaining balance on at least one leave type before saving.");
      return;
    }
    if (invalidChanges.length > 0) {
      setFormError("Fix the highlighted leave types: the remaining balance cannot be negative.");
      return;
    }

    const summaryHtml = pendingChanges
      .map((change) => `<li style="text-align:left">${change.operation === "add" ? "+" : "-"}${formatBalanceValue(change.amount)} ${escapeHtml(change.type.label)} <em>(${formatBalanceValue(change.balance.remaining)} &rarr; ${formatBalanceValue(change.nextRemaining)})</em></li>`)
      .join("");

    const confirmation = await Swal.fire({
      title: "Apply Balance Changes?",
      html: `<p style="margin:0 0 8px">Update leave credits for <strong>${escapeHtml(row.employeeName)}</strong>:</p><ul style="margin:0;padding-left:20px">${summaryHtml}</ul>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Save changes",
      cancelButtonText: "Review first",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    await onApply?.({
      employeeRecordId: Number(row.employeeRecordId),
      effectiveDate,
      remarks: note.trim(),
      adjustments: pendingChanges.map((change) => ({
        leaveTypeCode: change.type.code,
        operation: change.operation,
        amount: change.amount,
      })),
    });
  };

  const inputClassName = "min-h-[46px] w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

  return (
    <FloatingCardModal
      open={open}
      onClose={onClose}
      title="Add New Balance"
      description="Set the remaining leave credits per leave type, then record the reason for the change."
      maxWidthClassName="max-w-5xl"
    >
      <form onSubmit={handleSubmit}>
        <div className="max-h-[74vh] overflow-y-auto bg-slate-50/60 px-5 py-5 sm:px-4">
          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-600 text-sm font-bold text-white">
                    {getEmployeeInitials(row?.employeeName)}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-slate-950">{row?.employeeName || "Unavailable"}</p>
                    <p className="m-0 truncate text-xs text-slate-500">{row?.employeeId || "N/A"}</p>
                  </div>
                </div>

                <dl className="mt-4 space-y-2.5">
                  <div>
                    <dt className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Division</dt>
                    <dd className="m-0 mt-0.5 text-sm font-semibold text-slate-900">{row?.division || "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Position</dt>
                    <dd className="m-0 mt-0.5 text-sm font-semibold text-slate-900">{row?.position || "Not set"}</dd>
                  </div>
                  <div>
                    <dt className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Gender</dt>
                    <dd className="m-0 mt-1">
                      <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                        {getGenderLabel(row)}
                      </span>
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-start gap-2 rounded-2xl bg-white/80 px-3 py-2.5">
                  <Baby size={15} className="mt-0.5 shrink-0 text-emerald-700" />
                  <p className="m-0 text-xs text-slate-600">
                    Parental leave shown: <strong className="font-semibold text-slate-900">{getParentalLeaveSummary(row)}</strong>
                  </p>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <label>
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <CalendarDays size={15} />
                    Effective Date
                  </span>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(event) => {
                      setEffectiveDate(event.target.value);
                      setFormError("");
                    }}
                    className={`${inputClassName} mt-2`}
                  />
                </label>

                <label className="mt-4 block">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <StickyNote size={15} />
                    Note
                  </span>
                  <textarea
                    rows={4}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Why is this balance being changed? (e.g. Monthly accrual, correction of overposted credits)"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <span className="mt-1.5 block text-xs text-slate-500">
                    Saved with every adjustment in the audit trail.
                  </span>
                </label>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Updated By</p>
                  <p className="m-0 mt-1.5 text-sm font-semibold text-slate-900">{updatedBy || "HR Head"}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-900">Leave Credits</p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">
                    Each field shows the remaining balance &mdash; use &minus;/+ or type a new value. Unchanged rows are left untouched.
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                  pendingChanges.length > 0 ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
                }`}>
                  {pendingChanges.length} pending change{pendingChanges.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {visibleTypes.map((type) => (
                  <LeaveAdjustmentCard
                    key={type.code}
                    type={type}
                    balance={getBalanceRecord(row, type.code)}
                    draft={drafts[type.code]}
                    removable={extraCodes.includes(type.code)}
                    onChange={(patch) => updateDraft(type.code, patch)}
                    onClear={() => clearDraft(type.code)}
                    onRemove={() => removeExtraType(type.code)}
                  />
                ))}
              </div>

              {availableExtraTypes.length > 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-3">
                  <label className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-semibold text-slate-700">
                      Need another leave type?
                    </span>
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) {
                          setExtraCodes((current) => [...current, event.target.value]);
                        }
                      }}
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-64"
                    >
                      <option value="">Include leave type...</option>
                      {availableExtraTypes.map((type) => (
                        <option key={type.code} value={type.code}>{type.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              {pendingChanges.length > 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="m-0 text-sm font-semibold text-slate-900">Change Summary</p>
                  <ul className="m-0 mt-3 list-none space-y-2 p-0">
                    {pendingChanges.map((change) => (
                      <li
                        key={change.type.code}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2"
                      >
                        <span className="text-sm font-semibold text-slate-800">{change.type.label}</span>
                        <span className="inline-flex items-center gap-2 text-sm">
                          <span className={`font-bold ${change.operation === "add" ? "text-emerald-700" : "text-rose-600"}`}>
                            {change.operation === "add" ? "+" : "-"}{formatBalanceValue(change.amount)}
                          </span>
                          <span className="text-slate-400">|</span>
                          <span className="font-semibold text-slate-700">
                            {formatBalanceValue(change.balance.remaining)} &rarr; {formatBalanceValue(change.nextRemaining)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <p className={`m-0 text-sm ${formError ? "font-semibold text-rose-600" : "text-slate-500"}`}>
            {formError || `${pendingChanges.length} leave type${pendingChanges.length === 1 ? "" : "s"} will be updated.`}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={saving || pendingChanges.length === 0 || invalidChanges.length > 0}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#D61E1E] px-4 text-sm font-semibold text-white transition hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PlusCircle size={16} />
              {saving
                ? "Saving..."
                : pendingChanges.length > 0
                  ? `Save ${pendingChanges.length} change${pendingChanges.length === 1 ? "" : "s"}`
                  : "Save Changes"}
            </button>
          </div>
        </div>
      </form>
    </FloatingCardModal>
  );
}

function LeaveBalanceHistoryModal({
  open = false,
  loading = false,
  row = null,
  history = null,
  onClose,
}) {
  const logs = history?.logs || [];
  const snapshot = history?.snapshot || [];

  return (
    <FloatingCardModal
      open={open}
      onClose={onClose}
      title="Leave Balance History"
      description="Review current leave credit records and recent update activity for the selected employee."
      maxWidthClassName="max-w-5xl"
    >
      <div className="max-h-[78vh] overflow-y-auto px-5 py-5 sm:px-4">
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <History size={16} />
              <span>Employee Summary</span>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <p className="m-0 text-xs uppercase tracking-[0.16em] text-slate-500">Employee</p>
                <p className="m-0 mt-1 text-sm font-semibold text-slate-950">{row?.employeeName || "Unavailable"}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="m-0 text-xs uppercase tracking-[0.16em] text-slate-500">Employee ID</p>
                  <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{row?.employeeId || "N/A"}</p>
                </div>
                <div>
                  <p className="m-0 text-xs uppercase tracking-[0.16em] text-slate-500">Division</p>
                  <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{row?.division || "N/A"}</p>
                </div>
              </div>
              <div>
                <p className="m-0 text-xs uppercase tracking-[0.16em] text-slate-500">Latest Balance Update</p>
                <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{formatDateTime(row?.lastUpdated)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <LeaveCreditSnapshot snapshot={snapshot} fallbackUpdatedAt={row?.lastUpdated} />

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileClock size={16} />
                <span>Audit Trail</span>
              </div>
              <div className="mt-4 space-y-3">
                {loading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="h-4 w-40 rounded bg-slate-200" />
                      <div className="mt-3 h-3 w-full rounded bg-slate-200" />
                      <div className="mt-2 h-3 w-2/3 rounded bg-slate-200" />
                    </div>
                  ))
                ) : logs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
                    <p className="m-0 text-sm font-semibold text-slate-700">No audit log entries available</p>
                    <p className="m-0 mt-2 text-sm text-slate-500">
                      This database setup does not currently have stored leave balance history entries for this employee.
                    </p>
                  </div>
                ) : logs.map((log, index) => (
                  <article key={`${log.createdAt}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="m-0 text-sm font-semibold text-slate-950">{log.summary || "Leave balance update"}</p>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                    <p className="m-0 mt-2 text-sm text-slate-600">
                      {log.actorName || "Unknown"}{log.actorRole ? ` • ${log.actorRole}` : ""}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {log.details?.leaveTypeName ? (
                        <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                          <strong className="text-slate-900">Leave Type:</strong> {log.details.leaveTypeName}
                        </div>
                      ) : null}
                      {log.details?.effectiveDate ? (
                        <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                          <strong className="text-slate-900">Effective:</strong> {formatDateOnly(log.details.effectiveDate)}
                        </div>
                      ) : null}
                      {typeof log.details?.previousRemaining !== "undefined" ? (
                        <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                          <strong className="text-slate-900">Previous Balance:</strong> {formatBalanceValue(log.details.previousRemaining)}
                        </div>
                      ) : null}
                      {typeof log.details?.newRemaining !== "undefined" ? (
                        <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                          <strong className="text-slate-900">New Balance:</strong> {formatBalanceValue(log.details.newRemaining)}
                        </div>
                      ) : null}
                    </div>
                    {log.details?.remarks ? (
                      <p className="m-0 mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                        {log.details.remarks}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </FloatingCardModal>
  );
}

function BulkLeaveCreditModal({
  open = false,
  selectedRows = [],
  defaultLeaveTypeCode = "",
  employmentStatus = "",
  updatedBy = "",
  saving = false,
  onClose,
  onApply,
}) {
  const [form, setForm] = useState({
    leaveTypeCode: "",
    amount: "",
    effectiveDate: "",
    remarks: "",
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) {
      setErrors({});
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setForm({
      leaveTypeCode: defaultLeaveTypeCode || "VL",
      amount: "",
      effectiveDate: today,
      remarks: "",
    });
    setErrors({});
  }, [defaultLeaveTypeCode, open]);

  const selectedLeaveType = useMemo(
    () => LEAVE_TYPE_OPTIONS.find((type) => type.code === form.leaveTypeCode) || null,
    [form.leaveTypeCode]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = {};

    if (!form.leaveTypeCode) {
      nextErrors.leaveTypeCode = "Leave type is required.";
    }
    if (form.amount === "" || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      nextErrors.amount = "Enter a positive credit amount.";
    }
    if (!form.effectiveDate) {
      nextErrors.effectiveDate = "Effective date is required.";
    }
    if (selectedRows.length === 0) {
      nextErrors.selection = "Select at least one employee first.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Apply Bulk Leave Credits?",
      html: `Add <strong>${formatBalanceValue(Number(form.amount))}</strong> ${selectedLeaveType?.label || "leave"} credit(s) to <strong>${selectedRows.length}</strong> employee(s)?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Apply to all selected",
      cancelButtonText: "Review first",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    await onApply?.({
      leaveTypeCode: form.leaveTypeCode,
      amount: Number(form.amount),
      effectiveDate: form.effectiveDate,
      remarks: form.remarks.trim(),
    });
  };

  const inputClassName = "min-h-[46px] w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
  const errorClassName = "mt-1 text-xs text-rose-600";

  return (
    <FloatingCardModal
      open={open}
      onClose={onClose}
      title="Add Leave Credits in Bulk"
      description="Apply the same leave credit amount to every selected employee in one atomic operation."
      maxWidthClassName="max-w-4xl"
    >
      <form onSubmit={handleSubmit}>
        <div className="max-h-[78vh] overflow-y-auto px-5 py-5 sm:px-4">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck size={16} />
                <span>Credit Details</span>
              </div>

              <div className="mt-4 grid gap-4">
                <label>
                  <span className="block text-sm font-semibold text-slate-700">Leave Type</span>
                  <select
                    value={form.leaveTypeCode}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, leaveTypeCode: event.target.value }));
                      setErrors((current) => ({ ...current, leaveTypeCode: "" }));
                    }}
                    className={`${inputClassName} mt-2`}
                  >
                    <option value="">Select leave type</option>
                    {LEAVE_TYPE_OPTIONS.map((type) => (
                      <option key={type.code} value={type.code}>{type.label}</option>
                    ))}
                  </select>
                  {errors.leaveTypeCode ? <p className={errorClassName}>{errors.leaveTypeCode}</p> : null}
                </label>

                <label>
                  <span className="block text-sm font-semibold text-slate-700">Credit Amount to Add (days)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, amount: event.target.value }));
                      setErrors((current) => ({ ...current, amount: "" }));
                    }}
                    className={`${inputClassName} mt-2`}
                    placeholder="e.g. 1.25"
                  />
                  {errors.amount ? <p className={errorClassName}>{errors.amount}</p> : null}
                </label>

                <label>
                  <span className="block text-sm font-semibold text-slate-700">Effective Date</span>
                  <input
                    type="date"
                    value={form.effectiveDate}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, effectiveDate: event.target.value }));
                      setErrors((current) => ({ ...current, effectiveDate: "" }));
                    }}
                    className={`${inputClassName} mt-2`}
                  />
                  {errors.effectiveDate ? <p className={errorClassName}>{errors.effectiveDate}</p> : null}
                </label>

                <label>
                  <span className="block text-sm font-semibold text-slate-700">Remarks / Notes</span>
                  <textarea
                    rows={3}
                    value={form.remarks}
                    onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Reason for this bulk accrual (e.g. Annual leave accrual)"
                  />
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Applied By</p>
                  <p className="m-0 mt-2 text-sm font-semibold text-slate-900">{updatedBy || "HR Head"}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <Users size={16} />
                  <span>Selected Employees</span>
                </div>
                <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">
                  {selectedRows.length}
                </span>
              </div>

              {employmentStatus ? (
                <p className="m-0 mt-2 text-xs font-semibold text-emerald-800">
                  Filtered by employment status: {employmentStatus}
                </p>
              ) : null}

              {errors.selection ? <p className={errorClassName}>{errors.selection}</p> : null}

              <div className="mt-3 max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                {selectedRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-emerald-200 bg-white px-4 py-5 text-center text-sm text-slate-500">
                    No employees selected.
                  </div>
                ) : selectedRows.map((row) => {
                  const balance = form.leaveTypeCode ? getBalanceRecord(row, form.leaveTypeCode) : null;

                  return (
                    <div key={row.employeeRecordId} className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-white px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-slate-900">{row.employeeName}</p>
                        <p className="m-0 truncate text-xs text-slate-500">
                          {row.employeeId || "N/A"}{row.employmentStatus ? ` • ${row.employmentStatus}` : ""}
                        </p>
                      </div>
                      {balance ? (
                        <div className="shrink-0 text-right">
                          <p className="m-0 text-[11px] uppercase tracking-wide text-slate-400">Current</p>
                          <p className="m-0 text-sm font-semibold text-slate-700">
                            {formatBalanceValue(balance.remaining)}
                            {form.amount && !Number.isNaN(Number(form.amount)) ? (
                              <span className="ml-1 text-emerald-600">→ {formatBalanceValue(balance.remaining + Number(form.amount))}</span>
                            ) : null}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-4">
          <button
            type="submit"
            disabled={saving || selectedRows.length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#D61E1E] px-4 text-sm font-semibold text-white transition hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlusCircle size={16} />
            {saving ? "Applying..." : `Apply to ${selectedRows.length || 0} employee${selectedRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </FloatingCardModal>
  );
}

/**
 * The COC half of the registry: the same employee list, counted in overtime hours.
 *
 * Rendered and HR-posted credits are shown apart so the desk can see how much of a total it wrote
 * itself, but the stepper works on the total — that is the number an employee spends on CTO.
 */
function CocCreditRegistry({
  rows = [],
  totals,
  drafts = {},
  loading = false,
  allowActions = true,
  columnCount = 6,
  onDraftChange,
}) {
  const headers = [
    "Employee",
    "Division",
    "Rendered Overtime",
    "HR-Posted Credits",
    "Total COC Credits",
    "Latest Rendered Date",
    ...(allowActions ? ["Set COC Credits"] : []),
  ];

  return (
    <>
      <RecordCards
        className="xl:hidden"
        gridClassName="grid gap-3"
        items={rows}
        itemKey={(row) => row.employeeRecordId}
        loading={loading}
        loadingCards={3}
        empty={{
          icon: Clock3,
          title: "No COC credit records found",
          description: "Set compensatory overtime credits for an employee to create a record.",
        }}
        renderCard={(row) => {
          const entry = getCocTotals(totals, row.employeeRecordId);

          return {
            title: row.employeeName,
            subtitle: `${row.division || "Unassigned"} - ${row.position || "Not set"}`,
            fields: [
              { label: "Rendered", value: `${formatHours(entry.rendered)} hrs` },
              { label: "HR-Posted", value: `${formatHours(entry.manual)} hrs` },
              { label: "Total COC Credits", value: `${formatHours(entry.total)} hrs` },
              {
                label: "Latest Rendered Date",
                value: entry.latestDate || "No approved overtime yet",
                full: true,
              },
              ...(allowActions
                ? [{
                  label: "Set COC Credits",
                  full: true,
                  value: (
                    <CocBalanceStepper
                      total={entry.total}
                      draft={drafts[row.employeeRecordId]}
                      employeeName={row.employeeName}
                      onChange={(value) => onDraftChange(row.employeeRecordId, value)}
                    />
                  ),
                }]
                : []),
            ],
          };
        }}
      />

      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white xl:block">
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-[1180px] w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                {headers.map((header) => (
                  <th
                    key={header}
                    className={`${TABLE_HEAD_CELL} px-3 py-3 text-left text-xs font-bold uppercase text-slate-600`}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <tr key={index} className="animate-pulse border-b border-slate-100">
                    <td colSpan={columnCount} className="px-4 py-4">
                      <div className="h-9 rounded bg-slate-200" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-14 text-center">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                      <Clock3 size={24} />
                    </div>
                    <p className="m-0 mt-4 text-base font-semibold text-slate-800">No COC credit records found</p>
                    <p className="m-0 mt-2 text-sm text-slate-500">
                      Set compensatory overtime credits for an employee to create a record.
                    </p>
                  </td>
                </tr>
              ) : rows.map((row) => {
                const entry = getCocTotals(totals, row.employeeRecordId);
                const draft = drafts[row.employeeRecordId];
                const hasChange = draft !== undefined
                  && draft !== ""
                  && Number.isFinite(Number(draft))
                  && roundBalance(Number(draft)) !== roundBalance(entry.total);

                return (
                  <tr
                    key={row.employeeRecordId}
                    className={`border-b border-slate-100 align-top transition ${
                      hasChange ? "bg-emerald-50/70" : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-3 py-4 text-sm text-slate-900">
                      <div className="font-semibold">{row.employeeName}</div>
                      {row.employmentStatus ? (
                        <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          {row.employmentStatus}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-4 text-sm text-slate-700">{row.division || "Unassigned"}</td>
                    <td className="px-3 py-4 text-sm font-semibold text-slate-700">{formatHours(entry.rendered)} hrs</td>
                    <td className="px-3 py-4 text-sm font-semibold text-slate-700">{formatHours(entry.manual)} hrs</td>
                    <td className="px-3 py-4 text-sm font-bold text-slate-950">{formatHours(entry.total)} hrs</td>
                    <td className="px-3 py-4 text-sm text-slate-600">
                      {entry.latestDate || "No approved overtime yet"}
                    </td>
                    {allowActions ? (
                      <td className="px-3 py-4">
                        <CocBalanceStepper
                          total={entry.total}
                          draft={draft}
                          employeeName={row.employeeName}
                          onChange={(value) => onDraftChange(row.employeeRecordId, value)}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function LeaveBalanceManagementWorkspace({
  user,
  allowActions = true,
  showEmployeeIdColumn = true,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [archiveView, setArchiveView] = useState(false);
  const [saving, setSaving] = useState(false);
  /*
   * The Leave/COC tab strip was removed from the registry header, so this page always reads the
   * leave ledger. The COC branches further down are left intact for when the switcher comes back —
   * the "Credit Type" toggle inside the Set Balance modal still posts to either pool.
   */
  const balanceMode = "leave";
  const [cocRecords, setCocRecords] = useState([]);
  const [cocLoading, setCocLoading] = useState(false);
  const [cocDrafts, setCocDrafts] = useState({});
  const [cocSaving, setCocSaving] = useState(false);
  const [cocEffectiveDate, setCocEffectiveDate] = useState(todayInputValue);
  const [cocNote, setCocNote] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    division: "",
    employmentStatus: "",
    rowsPerPage: "10",
  });
  const sortBy = "employeeName";
  const sortDirection = "asc";
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [editorState, setEditorState] = useState({
    open: false,
    mode: "update",
    employeeRecordId: null,
    leaveTypeCode: "",
    creditType: "leave",
  });
  const [adjustState, setAdjustState] = useState({ open: false, employeeRecordId: null });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [historyState, setHistoryState] = useState({
    open: false,
    row: null,
    loading: false,
    history: null,
  });

  const currentYear = new Date().getFullYear();
  const updaterName = String(user?.full_name || user?.username || "HR Head").trim();
  const roleKey = resolveRoleKey(user);
  const canArchive = allowActions && canArchiveModule(roleKey, "leaveBalance");

  const loadRows = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const result = await fetchLeaveBalanceRows(currentYear, { archived: archiveView });
      setRows(result.rows || []);
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || error?.message || "Unable to load leave balances.");
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView, currentYear]);

  // The hook reads its callback through a ref, so it will not refetch when `loadRows` changes
  // identity — this effect does, which is what makes the archive toggle actually reload the table.
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useAutoRefreshOnChange(loadRows, {
    topics: ["leave_credit", "leave_request", "leave_monetization"],
    refreshOnMount: false,
  });

  /*
   * COC totals are derived from the overtime table, so they are fetched separately — and only once
   * the desk actually switches to that mode, since most visits to this screen never leave the leave
   * ledger.
   */
  const isCocMode = balanceMode === "coc";

  const loadCocRecords = useCallback(async ({ background = false } = {}) => {
    setCocLoading(!background);

    try {
      const result = await fetchOvertimeRequests();
      setCocRecords(Array.isArray(result?.records) ? result.records : []);
    } catch (error) {
      if (!background) {
        toast.error(
          error?.response?.data?.message || error?.message || "Unable to load compensatory overtime credits."
        );
      }
    } finally {
      setCocLoading(false);
    }
  }, []);

  // The editor can post COC from either mode, so opening it pulls the totals the leave ledger skips.
  useEffect(() => {
    if (!isCocMode && !editorState.open) {
      return;
    }

    void loadCocRecords();
  }, [editorState.open, isCocMode, loadCocRecords]);

  useAutoRefreshOnChange(loadCocRecords, {
    enabled: isCocMode,
    topic: "overtime",
    refreshOnMount: false,
  });

  /*
   * Division and employment status choices come from the database, not from the rows on screen, so
   * a division or status with no balance rows yet can still be picked.
   */
  const {
    divisions: divisionOptions,
    employmentStatuses: employmentStatusOptions,
  } = useOrganizationFilterOptions();

  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch = !search || [
        row.employeeName,
        row.employeeId,
        row.division,
        row.position,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));

      const matchesDivision = !filters.division || row.division === filters.division;
      const rowEmploymentStatus = String(row.employmentStatus || "").trim();
      const matchesEmploymentStatus =
        !filters.employmentStatus || rowEmploymentStatus === filters.employmentStatus;

      return matchesSearch && matchesDivision && matchesEmploymentStatus;
    });
  }, [filters, rows]);

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortBy, sortDirection),
    [filteredRows, sortBy, sortDirection]
  );

  const pageSize = Number(filters.rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.division, filters.employmentStatus, filters.rowsPerPage, sortBy, sortDirection]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters.employmentStatus]);

  const selectableIds = useMemo(
    () => sortedRows.map((row) => row.employeeRecordId),
    [sortedRows]
  );

  const allFilteredSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someFilteredSelected = selectableIds.some((id) => selectedIds.has(id));

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.employeeRecordId)),
    [rows, selectedIds]
  );

  const toggleRowSelected = useCallback((employeeRecordId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(employeeRecordId)) {
        next.delete(employeeRecordId);
      } else {
        next.add(employeeRecordId);
      }
      return next;
    });
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedIds((current) => {
      const next = new Set(current);
      const everySelected = selectableIds.length > 0 && selectableIds.every((id) => next.has(id));

      if (everySelected) {
        selectableIds.forEach((id) => next.delete(id));
      } else {
        selectableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [selectableIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const summary = useMemo(() => {
    let lowCount = 0;
    let depletedCount = 0;

    rows.forEach((row) => {
      TABLE_BALANCE_COLUMNS.forEach((column) => {
        const balance = getDisplayBalanceRecord(row, column.key);

        // Leave the employee can never file for is not a depleted balance.
        if (balance.applicable === false) {
          return;
        }

        const health = getBalanceHealth(balance);

        if (health.tone === "low") {
          lowCount += 1;
        }
        if (health.tone === "depleted") {
          depletedCount += 1;
        }
      });
    });

    return {
      totalEmployees: rows.length,
      lowCount,
      depletedCount,
    };
  }, [rows]);

  const cocTotals = useMemo(() => buildCocTotals(cocRecords), [cocRecords]);

  /*
   * Read across every loaded employee rather than the visible page: a row stepped before the desk
   * paged or re-filtered still has to be saved, otherwise the change would quietly disappear.
   */
  const cocPendingChanges = useMemo(() => {
    if (!isCocMode) {
      return [];
    }

    return rows
      .map((row) => {
        const draft = cocDrafts[row.employeeRecordId];

        if (draft === undefined || draft === "") {
          return null;
        }

        const target = Number(draft);
        if (!Number.isFinite(target)) {
          return null;
        }

        const current = getCocTotals(cocTotals, row.employeeRecordId).total;
        const nextTotal = roundBalance(target);
        const delta = roundBalance(nextTotal - current);

        return delta === 0 ? null : { row, current, nextTotal, delta };
      })
      .filter(Boolean);
  }, [cocDrafts, cocTotals, isCocMode, rows]);

  const invalidCocChanges = cocPendingChanges.filter((change) => change.nextTotal < 0);

  const updateCocDraft = useCallback((employeeRecordId, value) => {
    setCocDrafts((current) => ({ ...current, [employeeRecordId]: value }));
  }, []);

  const handleSaveCocBalances = async () => {
    if (cocPendingChanges.length === 0) {
      toast.error("Adjust at least one employee's COC credits before saving.");
      return;
    }
    if (invalidCocChanges.length > 0) {
      toast.error("Fix the highlighted employees: COC credits cannot go below 0.");
      return;
    }
    if (!cocEffectiveDate) {
      toast.error("An effective date is required before saving COC credits.");
      return;
    }

    const summaryHtml = cocPendingChanges
      .map((change) => `<li style="text-align:left">${escapeHtml(change.row.employeeName)}: <strong>${change.delta > 0 ? "+" : "-"}${formatBalanceValue(Math.abs(change.delta))}</strong> hrs <em>(${formatBalanceValue(change.current)} &rarr; ${formatBalanceValue(change.nextTotal)})</em></li>`)
      .join("");

    const confirmation = await Swal.fire({
      title: "Set COC Balances?",
      html: `<p style="margin:0 0 8px">Apply these compensatory overtime credit changes?</p><ul style="margin:0;padding-left:20px">${summaryHtml}</ul>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Set balance",
      cancelButtonText: "Review first",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setCocSaving(true);

    try {
      const result = await adjustCompensatoryOvertimeCredits({
        effectiveDate: cocEffectiveDate,
        remarks: cocNote.trim(),
        adjustments: cocPendingChanges.map((change) => ({
          employeeRecordId: change.row.employeeRecordId,
          employeeName: change.row.employeeName,
          hours: change.delta,
        })),
      });

      setCocDrafts({});
      setCocNote("");
      await loadCocRecords({ background: true });
      toast.success(result?.message || "Compensatory overtime credits updated.");
    } catch (error) {
      toast.error(
        error?.response?.data?.message || error?.message || "Unable to update compensatory overtime credits."
      );
    } finally {
      setCocSaving(false);
    }
  };

  const selectedHistoryRow = historyState.row;
  // Derived from the live rows so background refreshes keep the sheet in sync.
  const adjustRow = useMemo(
    () => rows.find((row) => row.employeeRecordId === adjustState.employeeRecordId) || null,
    [adjustState.employeeRecordId, rows]
  );
  // Bulk leave credits are a leave-ledger action, so the COC table drops the selection column.
  const showSelectionColumn = allowActions && !isCocMode;
  const visibleLeadColumns = 1 + (showEmployeeIdColumn ? 1 : 0) + 2;
  const tableColumnCount = (showSelectionColumn ? 1 : 0) + visibleLeadColumns + TABLE_BALANCE_COLUMNS.length + 1 + (allowActions ? 1 : 0);
  // Employee, Division, Rendered, HR-posted, Total, Latest date (+ the stepper when editable).
  const cocTableColumnCount = 6 + (allowActions ? 1 : 0);


  const openEditor = (mode, row, creditType = "leave") => {
    setEditorState({
      open: true,
      mode,
      employeeRecordId: row?.employeeRecordId || null,
      leaveTypeCode: "VL",
      creditType,
    });
  };

  const closeEditor = () => {
    setEditorState({
      open: false,
      mode: "update",
      employeeRecordId: null,
      leaveTypeCode: "",
      creditType: "leave",
    });
  };

  const openAdjustments = (row) => {
    setAdjustState({ open: true, employeeRecordId: row?.employeeRecordId || null });
  };

  const handleApplyAdjustments = async (payload) => {
    setAdjustSaving(true);

    try {
      const result = await adjustLeaveBalances({
        employeeRecordId: payload.employeeRecordId,
        adjustments: payload.adjustments,
        effectiveDate: payload.effectiveDate,
        remarks: payload.remarks,
        year: currentYear,
      });

      setRows(result.rows || []);
      setAdjustState({ open: false, employeeRecordId: null });

      if (historyState.open && historyState.row?.employeeRecordId === payload.employeeRecordId) {
        const updatedRow = (result.rows || []).find((row) => row.employeeRecordId === payload.employeeRecordId) || historyState.row;
        setHistoryState({
          open: true,
          row: updatedRow,
          loading: false,
          history: result.history || historyState.history,
        });
      }

      toast.success(result.message || "Leave balance updated successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to update the leave balance.");
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleBulkApply = async (payload) => {
    setBulkSaving(true);

    try {
      const result = await bulkAddLeaveCredits({
        leaveTypeCode: payload.leaveTypeCode,
        amount: payload.amount,
        effectiveDate: payload.effectiveDate,
        remarks: payload.remarks,
        employeeRecordIds: selectedRows.map((row) => row.employeeRecordId),
        employmentStatus: filters.employmentStatus || "",
        year: currentYear,
      });

      setRows(result.rows || []);
      clearSelection();
      setBulkOpen(false);
      toast.success(result.message || `Leave credits added to ${result.affectedCount || 0} employee(s).`);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to apply bulk leave credits.");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleExportCsv = () => {
    if (sortedRows.length === 0) {
      toast.error(
        isCocMode
          ? "There are no COC credit records to export."
          : "There are no leave balance records to export."
      );
      return;
    }

    const balanceColumns = LEAVE_TYPE_OPTIONS;
    const headers = isCocMode
      ? [
        "Employee Name",
        "Employee ID",
        "Division",
        "Position",
        "Employment Status",
        "Rendered Overtime (hrs)",
        "HR-Posted Credits (hrs)",
        "Total COC Credits (hrs)",
        "Latest Rendered Date",
      ]
      : [
        "Employee Name",
        "Employee ID",
        "Division",
        "Position",
        "Employment Status",
        ...balanceColumns.map((type) => `${type.label} (Remaining)`),
        "Last Updated",
      ];

    const escapeCell = (value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = sortedRows.map((row) => {
      const totals = getCocTotals(cocTotals, row.employeeRecordId);
      const cells = [
        row.employeeName || "",
        row.employeeId || "",
        row.division || "",
        row.position || "",
        row.employmentStatus || "",
        ...(isCocMode
          ? [
            formatBalanceValue(totals.rendered),
            formatBalanceValue(totals.manual),
            formatBalanceValue(totals.total),
            totals.latestDate || "No approved overtime yet",
          ]
          : [
            ...balanceColumns.map((type) => formatBalanceValue(getDisplayBalanceRecord(row, type.code).remaining)),
            row.lastUpdated ? formatDateTime(row.lastUpdated) : "Never",
          ]),
      ];
      return cells.map(escapeCell).join(",");
    });

    const csvContent = [headers.map(escapeCell).join(","), ...lines].join("\r\n");
    const blob = new Blob([`﻿${csvContent}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${isCocMode ? "coc-credits" : "leave-balances"}-${currentYear}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(
      isCocMode
        ? `Exported ${sortedRows.length} COC credit record(s).`
        : `Exported ${sortedRows.length} leave balance record(s).`
    );
  };

  const openHistory = async (row) => {
    setHistoryState({
      open: true,
      row,
      loading: true,
      history: null,
    });

    try {
      const result = await fetchLeaveBalanceHistory(row.employeeRecordId, currentYear, "");
      setHistoryState({
        open: true,
        row,
        loading: false,
        history: result.history || { logs: [], snapshot: [] },
      });
    } catch (error) {
      setHistoryState({
        open: true,
        row,
        loading: false,
        history: { logs: [], snapshot: [] },
      });
      toast.error(error?.response?.data?.message || error?.message || "Unable to load leave balance history.");
    }
  };

  /*
   * The editor posts one employee at a time while the API takes movements rather than totals, so the
   * new balance is sent as the difference against what the employee already holds. The row's own
   * stepper draft is dropped afterwards — the posted credit is now part of the total it compares to.
   */
  const handleSaveCocBalance = async (payload) => {
    setSaving(true);

    try {
      const result = await adjustCompensatoryOvertimeCredits({
        effectiveDate: payload.effectiveDate,
        remarks: payload.remarks,
        adjustments: [
          {
            employeeRecordId: payload.employeeRecordId,
            employeeName: payload.employeeName,
            hours: payload.delta,
          },
        ],
      });

      setCocDrafts((current) => {
        const next = { ...current };
        delete next[payload.employeeRecordId];
        return next;
      });
      closeEditor();
      await loadCocRecords({ background: true });
      toast.success(result?.message || "Compensatory overtime credits updated.");
    } catch (error) {
      toast.error(
        error?.response?.data?.message || error?.message || "Unable to update compensatory overtime credits."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBalance = async (payload) => {
    if (payload.creditType === "coc") {
      await handleSaveCocBalance(payload);
      return;
    }

    setSaving(true);

    try {
      const result = await saveLeaveBalance({
        action: payload.action,
        employeeRecordId: payload.employeeRecordId,
        leaveTypeCode: payload.leaveTypeCode,
        newBalance: payload.newBalance,
        effectiveDate: payload.effectiveDate,
        remarks: payload.remarks,
        year: currentYear,
      });

      setRows(result.rows || []);
      closeEditor();

      if (historyState.open && historyState.row?.employeeRecordId === payload.employeeRecordId) {
        const updatedRow = (result.rows || []).find((row) => row.employeeRecordId === payload.employeeRecordId) || historyState.row;
        setHistoryState({
          open: true,
          row: updatedRow,
          loading: false,
          history: result.history || historyState.history,
        });
      }

      toast.success(result.message || "Leave balance saved successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to save the leave balance.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveBalances = async (row, restore = false) => {
    const confirmAction = restore ? confirmRestoreRecordGroup : confirmArchiveRecordGroup;
    const removeFromCurrentRegistry = (employeeRecordId) => {
      setRows((current) =>
        current.filter((item) => item.employeeRecordId !== employeeRecordId)
      );
      setSelectedIds((current) => {
        if (!current.has(employeeRecordId)) {
          return current;
        }

        const next = new Set(current);
        next.delete(employeeRecordId);
        return next;
      });
      void loadRows({ background: true });
    };

    await confirmAction({
      module: "leaveBalance",
      employeeRecordId: row.employeeRecordId,
      year: currentYear,
      noun: "leave balances",
      owner: row.employeeName,
      onArchived: removeFromCurrentRegistry,
      onRestored: removeFromCurrentRegistry,
    });
  };

  const handleResetBalances = async (row) => {
    const confirmation = await Swal.fire({
      title: "Reset Leave Credits?",
      text: `Reset the tracked leave balances for ${row.employeeName} to their default yearly values?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, reset credits",
      cancelButtonText: "Keep current balances",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await resetEmployeeLeaveCredits(
        row.employeeRecordId,
        currentYear,
        new Date().toISOString().slice(0, 10),
        "Reset from leave balance management workspace."
      );

      setRows(result.rows || []);

      if (historyState.open && historyState.row?.employeeRecordId === row.employeeRecordId) {
        const updatedRow = (result.rows || []).find((item) => item.employeeRecordId === row.employeeRecordId) || row;
        setHistoryState({
          open: true,
          row: updatedRow,
          loading: false,
          history: result.history || historyState.history,
        });
      }

      toast.success(result.message || "Leave credits reset successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to reset leave credits.");
    }
  };

  /* The per-row actions, shared by the ledger table and by the narrow-screen cards above it. */
  const renderRowActions = (row) => (
    <>
      <ActionIconButton
        label={`Add leave balance for ${row.employeeName}`}
        icon={faCirclePlus}
        tone="approve"
        text="Add Balance"
        onClick={() => openAdjustments(row)}
      />
      <ActionIconButton
        label={`View leave credit history for ${row.employeeName}`}
        icon={faClockRotateLeft}
        tone="view"
        text="History"
        onClick={() => openHistory(row)}
      />
      <ActionIconButton
        label={`Reset leave credits for ${row.employeeName}`}
        icon={faArrowsRotate}
        tone="edit"
        text="Reset"
        onClick={() => handleResetBalances(row)}
      />
      {canArchive ? (
        <ActionIconButton
          label={archiveView ? `Restore leave balances for ${row.employeeName}` : `Archive leave balances for ${row.employeeName}`}
          icon={archiveView ? faRotateLeft : faBoxArchive}
          tone={archiveView ? "restore" : "archive"}
          onClick={() => handleArchiveBalances(row, archiveView)}
        />
      ) : null}
    </>
  );

  return (
    <section className="leave-credit-registry space-y-4">

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="m-0 text-lg font-semibold text-slate-950">
                {isCocMode
                  ? "Compensatory Overtime Credit Registry"
                  : archiveView
                    ? "Archived Leave Balances"
                    : "Employee Leave Credit Registry"}
              </h3>
              <p className="m-0 mt-1 text-sm text-slate-500">
                {isCocMode
                  ? "Overtime credits posted once the Regional Director gives the final approval, plus the credits HR sets here."
                  : archiveView
                    ? "Leave balances moved to archive. Restore an employee to return their credits to the registry."
                    : "Search, filter, sort, and update leave balances for active employee records. Vacation and sick leave earn 1.25 credits on the 1st of every month; each balance shows its next posting."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canArchive && !isCocMode ? (
                <ArchiveViewToggle
                  archiveView={archiveView}
                  onToggle={(next) => {
                    setArchiveView(next);
                    setCurrentPage(1);
                  }}
                  label="leave balances"
                  className="min-h-11 rounded-2xl px-4"
                />
              ) : null}
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Download size={16} />
                Export CSV
              </button>
              {/* Row steppers keep their own save; the button only appears once a row was touched. */}
              {allowActions && isCocMode && cocPendingChanges.length > 0 ? (
                <button
                  type="button"
                  onClick={handleSaveCocBalances}
                  disabled={cocSaving || invalidCocChanges.length > 0}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#D61E1E] bg-white px-4 text-sm font-semibold text-[#D61E1E] transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Clock3 size={16} />
                  {cocSaving ? "Saving..." : `Save Row Edits (${cocPendingChanges.length})`}
                </button>
              ) : null}
              {allowActions && !archiveView ? (
                <button
                  type="button"
                  onClick={() => openEditor("set", null, isCocMode ? "coc" : "leave")}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#D61E1E] px-4 text-sm font-semibold text-white transition hover:bg-[#991B1B]"
                >
                  <ShieldCheck size={16} />
                  Set Balance
                </button>
              ) : null}
            </div>
          </div>

          {/* Every posted credit needs a date and a reason, and one save covers the whole sheet. */}
          {allowActions && isCocMode ? (
            <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[170px_minmax(0,1fr)_auto] md:items-center">
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <CalendarDays size={13} />
                  Effective Date
                </span>
                <input
                  type="date"
                  value={cocEffectiveDate}
                  onChange={(event) => setCocEffectiveDate(event.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>

              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <StickyNote size={13} />
                  Reason
                </span>
                <input
                  type="text"
                  value={cocNote}
                  onChange={(event) => setCocNote(event.target.value)}
                  placeholder="Why are these COC credits being set? (saved on every posted credit)"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>

              <span className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold md:mt-5 ${
                cocPendingChanges.length > 0 ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
              }`}>
                {cocPendingChanges.length} pending change{cocPendingChanges.length === 1 ? "" : "s"}
              </span>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,220px)_170px_190px_120px]">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Employees</span>
              <span className="relative block">
                <Search
                  size={16}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, search: event.target.value }))
                  }
                  placeholder="Search employee name or ID"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Division</span>
              <select
                value={filters.division}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, division: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">All divisions</option>
                {divisionOptions.map((division) => (
                  <option key={division} value={division}>
                    {division}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Employment Status</span>
              <select
                value={filters.employmentStatus}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, employmentStatus: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">All employment statuses</option>
                {employmentStatusOptions.map((employmentStatus) => (
                  <option key={employmentStatus} value={employmentStatus}>
                    {employmentStatus}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Rows Per Page</span>
              <select
                value={filters.rowsPerPage}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, rowsPerPage: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                {[10, 20, 50, 100, 200].map((rowCount) => (
                  <option key={rowCount} value={rowCount}>
                    {rowCount} rows
                  </option>
                ))}
              </select>
            </label>
          </div>

        </div>

        {allowActions && !isCocMode && selectedIds.size > 0 ? (
          <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-2xl bg-emerald-600 px-2.5 text-sm font-bold text-white">
                {selectedIds.size}
              </span>
              <div>
                <p className="m-0 text-sm font-semibold text-emerald-900">
                  {selectedIds.size} employee{selectedIds.size === 1 ? "" : "s"} selected
                </p>
                <p className="m-0 text-xs text-emerald-700">
                  {filters.employmentStatus
                    ? `Employment status: ${filters.employmentStatus}`
                    : "All employment statuses"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-emerald-200 bg-white px-4 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
              >
                Clear selection
              </button>
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-[#D61E1E] px-4 text-sm font-semibold text-white transition hover:bg-[#991B1B]"
              >
                <PlusCircle size={16} />
                Add Leave Credits
              </button>
            </div>
          </div>
        ) : null}

        <div className="px-5 py-5 sm:px-4">
          {isCocMode ? (
            <CocCreditRegistry
              rows={paginatedRows}
              totals={cocTotals}
              drafts={cocDrafts}
              loading={loading || cocLoading}
              allowActions={allowActions}
              columnCount={cocTableColumnCount}
              onDraftChange={updateCocDraft}
            />
          ) : (
          <>
          {/* Narrow screens use cards; desktop screens keep the core balances and actions together. */}
          <RecordCards
            className="xl:hidden"
            /* One column: the balance grid inside each card needs the full width. */
            gridClassName="grid gap-3"
            items={paginatedRows}
            itemKey={(row) => row.employeeRecordId}
            loading={loading}
            loadingCards={3}
            empty={{
              icon: FolderSync,
              title: "No leave balance records found",
              description: "Refresh the registry to load employee leave credit records.",
            }}
            renderCard={(row) => ({
              eyebrow: (
                <span className="inline-flex items-center gap-2">
                  {showSelectionColumn ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.employeeName}`}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                      checked={selectedIds.has(row.employeeRecordId)}
                      onChange={() => toggleRowSelected(row.employeeRecordId)}
                    />
                  ) : null}
                  <span>
                    {showEmployeeIdColumn ? (row.employeeId || "N/A") : "Employee"}
                  </span>
                </span>
              ),
              title: row.employeeName,
              subtitle: `${row.division || "Unassigned"} - ${row.position || "Not set"}`,
              badge: row.employmentStatus ? (
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {row.employmentStatus}
                </span>
              ) : null,
              fields: [
                {
                  label: "Leave Credits",
                  full: true,
                  value: (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {TABLE_BALANCE_COLUMNS.map((column) => (
                        <div key={column.key} className="rounded-xl border border-slate-100 bg-slate-50/60 px-2.5 py-2">
                          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                            {column.label}
                          </p>
                          <div className="mt-1">
                            <BalanceCell balance={getDisplayBalanceRecord(row, column.key)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                { label: "Last Updated", value: formatDateTime(row.lastUpdated), full: true },
              ],
              actions: allowActions ? <ActionsMenu>{renderRowActions(row)}</ActionsMenu> : null,
            })}
          />

          {/* Keep the registry compact so the row actions remain visible beside the core balances. */}
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white xl:block">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    {showSelectionColumn ? (
                      <th className={`${TABLE_HEAD_CELL} px-3 py-3 text-left`}>
                        <input
                          type="checkbox"
                          aria-label="Select all filtered employees"
                          className="h-4 w-4 cursor-pointer accent-emerald-600"
                          checked={allFilteredSelected}
                          ref={(element) => {
                            if (element) {
                              element.indeterminate = someFilteredSelected && !allFilteredSelected;
                            }
                          }}
                          onChange={toggleSelectAllFiltered}
                          disabled={selectableIds.length === 0}
                        />
                      </th>
                    ) : null}
                    {[
                      { key: "employeeName", label: "Employee Name" },
                      ...(showEmployeeIdColumn ? [{ key: "employeeId", label: "Employee ID" }] : []),
                      { key: "division", label: "Division" },
                      { key: "position", label: "Position" },
                      ...TABLE_BALANCE_COLUMNS,
                      { key: "lastUpdated", label: "Last Updated" },
                    ].map((column) => (
                      <th
                        key={column.key}
                        className={`${TABLE_HEAD_CELL} px-3 py-3 text-left text-xs font-bold uppercase text-slate-600`}
                      >
                        {column.label}
                      </th>
                    ))}
                    {allowActions ? (
                      <th className={`${TABLE_HEAD_CELL} px-3 py-3 text-left text-xs font-bold uppercase text-slate-600`}>
                        Actions
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="animate-pulse border-b border-slate-100">
                        <td colSpan={tableColumnCount} className="px-4 py-4">
                          <div className="h-9 rounded bg-slate-200" />
                        </td>
                      </tr>
                    ))
                  ) : paginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={tableColumnCount} className="px-4 py-14 text-center">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                          <FolderSync size={24} />
                        </div>
                        <p className="m-0 mt-4 text-base font-semibold text-slate-800">No leave balance records found</p>
                        <p className="m-0 mt-2 text-sm text-slate-500">
                          Refresh the registry to load employee leave credit records.
                        </p>
                      </td>
                    </tr>
                  ) : paginatedRows.map((row) => {
                    const isSelected = selectedIds.has(row.employeeRecordId);

                    return (
                    <tr
                      key={row.employeeRecordId}
                      className={`border-b border-slate-100 align-top transition ${isSelected ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}
                    >
                      {showSelectionColumn ? (
                        <td className="px-3 py-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.employeeName}`}
                            className="h-4 w-4 cursor-pointer accent-emerald-600"
                            checked={isSelected}
                            onChange={() => toggleRowSelected(row.employeeRecordId)}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-4 text-sm text-slate-900">
                        <div className="font-semibold">{row.employeeName}</div>
                        {row.employmentStatus ? (
                          <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                            {row.employmentStatus}
                          </span>
                        ) : null}
                      </td>
                      {showEmployeeIdColumn ? (
                        <td className="px-3 py-4 text-sm text-slate-700">{row.employeeId || "N/A"}</td>
                      ) : null}
                      <td className="px-3 py-4 text-sm text-slate-700">{row.division || "Unassigned"}</td>
                      <td className="px-3 py-4 text-sm text-slate-700">{row.position || "Not set"}</td>
                      {TABLE_BALANCE_COLUMNS.map((column) => (
                        <td key={column.key} className="px-3 py-4">
                          <BalanceCell balance={getDisplayBalanceRecord(row, column.key)} />
                        </td>
                      ))}
                      <td className="px-3 py-4 text-sm text-slate-600">{formatDateTime(row.lastUpdated)}</td>
                      {allowActions ? (
                        <td className="whitespace-nowrap px-3 py-4">
                          {/* `flex-nowrap` keeps the four buttons on one line at every zoom level;
                              the row grows the table's width instead of stacking them. */}
                          <ActionsMenu>{renderRowActions(row)}</ActionsMenu>
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
          )}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {sortedRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, sortedRows.length)} of {sortedRows.length} {isCocMode ? "employee COC credit records" : "employee balance records"}
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </div>
      </section>

      <LeaveBalanceEditorModal
        open={editorState.open}
        mode={editorState.mode}
        employeeRows={rows}
        cocTotals={cocTotals}
        defaultEmployeeRecordId={editorState.employeeRecordId}
        defaultLeaveTypeCode={editorState.leaveTypeCode}
        defaultCreditType={editorState.creditType}
        updatedBy={updaterName}
        saving={saving}
        onClose={closeEditor}
        onSave={handleSaveBalance}
      />

      <LeaveBalanceAdjustmentModal
        open={adjustState.open}
        row={adjustRow}
        updatedBy={updaterName}
        saving={adjustSaving}
        onClose={() => setAdjustState({ open: false, employeeRecordId: null })}
        onApply={handleApplyAdjustments}
      />

      <LeaveBalanceHistoryModal
        open={historyState.open}
        loading={historyState.loading}
        row={selectedHistoryRow}
        history={historyState.history}
        onClose={() => setHistoryState({ open: false, row: null, loading: false, history: null })}
      />

      {allowActions ? (
        <BulkLeaveCreditModal
          open={bulkOpen}
          selectedRows={selectedRows}
          employmentStatus={filters.employmentStatus}
          updatedBy={updaterName}
          saving={bulkSaving}
          onClose={() => setBulkOpen(false)}
          onApply={handleBulkApply}
        />
      ) : null}
    </section>
  );
}
