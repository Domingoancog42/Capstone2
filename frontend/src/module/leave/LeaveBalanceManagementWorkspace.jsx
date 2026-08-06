import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Baby,
  CalendarDays,
  ChevronDown,
  Download,
  FileClock,
  FolderSync,
  History,
  Minus,
  MoreHorizontal,
  Plus,
  PlusCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  StickyNote,
  Trash2,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import Pagination from "../../components/UI/Pagination";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  adjustLeaveBalances,
  bulkAddLeaveCredits,
  fetchLeaveBalanceHistory,
  fetchLeaveBalanceRows,
  resetEmployeeLeaveCredits,
  saveLeaveBalance,
} from "../../services/leaveCreditService";

const TABLE_BALANCE_COLUMNS = [
  { key: "VL", label: "Vacation Leave Balance" },
  { key: "SL", label: "Sick Leave Balance" },
  { key: "SPL", label: "Special Leave Balance" },
  { key: "SOPL", label: "Solo Parent Leave" },
  { key: "STL", label: "Study Leave" },
  { key: "ML", label: "Maternity Leave" },
  { key: "PL", label: "Paternity Leave" },
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


function formatBalanceValue(value) {
  const numericValue = Number(value) || 0;
  return numericValue.toFixed(2).replace(/\.00$/, "");
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
  };
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
    return {
      tone: "depleted",
      label: "Depleted",
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

function getRowFocusBalance(row, leaveTypeCode = "") {
  if (!leaveTypeCode) {
    return null;
  }

  return getDisplayBalanceRecord(row, leaveTypeCode);
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
  // A leave the employee's gender cannot file for reads as a plain 0 day rather
  // than a red "Depleted" balance, which would be misleading.
  if (balance.applicable === false) {
    return (
      <div className="space-y-1">
        <div className="inline-flex min-h-8 items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-400">
          0 days
        </div>
        <div className="text-[11px] text-slate-400">Not applicable</div>
      </div>
    );
  }

  const health = getBalanceHealth(balance);

  return (
    <div className="space-y-1">
      <div className={`inline-flex min-h-8 items-center rounded-xl border px-2.5 text-xs font-semibold ${health.amountClass}`}>
        {formatBalanceValue(balance.remaining)} day{Number(balance.remaining) === 1 ? "" : "s"}
      </div>
      <div className="text-[11px] text-slate-500">
        Used {formatBalanceValue(balance.used)} / Total {formatBalanceValue(balance.total)}
      </div>
      <BalanceStatusBadge balance={balance} />
    </div>
  );
}

function LeaveBalanceEditorModal({
  open = false,
  mode = "update",
  employeeRows = [],
  defaultEmployeeRecordId = null,
  defaultLeaveTypeCode = "",
  updatedBy = "",
  saving = false,
  onClose,
  onSave,
}) {
  const employeeOptions = useMemo(
    () =>
      employeeRows.map((row) => ({
        employeeRecordId: row.employeeRecordId,
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        division: row.division,
      })),
    [employeeRows]
  );

  const [form, setForm] = useState({
    employeeRecordId: "",
    leaveTypeCode: "",
    newBalance: "",
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
      employeeRecordId: defaultEmployeeRecordId ? String(defaultEmployeeRecordId) : "",
      leaveTypeCode: defaultLeaveTypeCode || "",
      newBalance: "",
      effectiveDate: today,
      remarks: "",
    });
    setErrors({});
  }, [defaultEmployeeRecordId, defaultLeaveTypeCode, open]);

  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeOptions, form.employeeRecordId]
  );

  const selectedRow = useMemo(
    () => employeeRows.find((row) => String(row.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeRows, form.employeeRecordId]
  );

  const currentBalance = useMemo(() => {
    if (!selectedRow || !form.leaveTypeCode) {
      return 0;
    }

    return getBalanceRecord(selectedRow, form.leaveTypeCode).remaining;
  }, [form.leaveTypeCode, selectedRow]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm((current) => {
      if (!current.leaveTypeCode || current.newBalance !== "") {
        return current;
      }

      return {
        ...current,
        newBalance: String(currentBalance),
      };
    });
  }, [currentBalance, open]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = {};

    if (!form.employeeRecordId) {
      nextErrors.employeeRecordId = "Employee is required.";
    }
    if (!form.leaveTypeCode) {
      nextErrors.leaveTypeCode = "Leave type is required.";
    }
    if (form.newBalance === "" || Number.isNaN(Number(form.newBalance)) || Number(form.newBalance) < 0) {
      nextErrors.newBalance = "Provide a valid non-negative balance.";
    }
    if (!form.effectiveDate) {
      nextErrors.effectiveDate = "Effective date is required.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const selectedLeaveType = LEAVE_TYPE_OPTIONS.find((item) => item.code === form.leaveTypeCode);
    const confirmation = await Swal.fire({
      title: `${mode === "set" ? "Set" : "Update"} Leave Balance?`,
      text: `Apply ${selectedLeaveType?.label || "leave balance"} for ${selectedEmployee?.employeeName || "this employee"}?`,
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
      employeeRecordId: Number(form.employeeRecordId),
      leaveTypeCode: form.leaveTypeCode,
      currentBalance,
      newBalance: Number(form.newBalance),
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
      title={mode === "set" ? "Set Leave Balance" : "Update Leave Balance"}
      description="Adjust employee leave credits with a clean audit-friendly workflow."
      maxWidthClassName="max-w-4xl"
    >
      <form onSubmit={handleSubmit}>
        <div className="max-h-[78vh] overflow-y-auto px-5 py-5 sm:px-4">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                <UserRound size={16} />
                <span>Employee</span>
              </div>
              <div className="mt-3">
                <EmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={selectedEmployee}
                  onSelect={(employee) => {
                    setForm((current) => ({
                      ...current,
                      employeeRecordId: String(employee.employeeRecordId),
                    }));
                    setErrors((current) => ({ ...current, employeeRecordId: "" }));
                  }}
                  placeholder="Search employee..."
                />
                {errors.employeeRecordId ? <p className={errorClassName}>{errors.employeeRecordId}</p> : null}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
                  <span className="block text-sm font-semibold text-slate-700">Current Balance</span>
                  <input
                    readOnly
                    value={`${formatBalanceValue(currentBalance)} days`}
                    className={`${inputClassName} mt-2 bg-slate-50 text-slate-600`}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck size={16} />
                <span>Balance Details</span>
              </div>

              <div className="mt-4 grid gap-4">
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
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
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
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FolderSync size={16} />
                <span>Current Leave Credit Snapshot</span>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="bg-slate-50">
                      <tr>
                        {["Leave Type", "Total", "Used", "Remaining", "Updated"].map((header) => (
                          <th key={header} className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                            No leave credit snapshot is available yet.
                          </td>
                        </tr>
                      ) : snapshot.map((item) => (
                        <tr key={item.code} className="border-b border-slate-100">
                          <td className="px-3 py-3 text-sm font-semibold text-slate-900">{item.type}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{formatBalanceValue(item.total)}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{formatBalanceValue(item.used)}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{formatBalanceValue(item.remaining)}</td>
                          <td className="px-3 py-3 text-sm text-slate-500">{formatDateTime(item.updatedAt || row?.lastUpdated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

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
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
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

export default function LeaveBalanceManagementWorkspace({
  user,
  allowActions = true,
  showEmployeeIdColumn = true,
  showRowNumberColumn = false,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({
    search: "",
    division: "",
    employmentStatus: "",
    leaveType: "",
    rowsPerPage: "10",
  });
  const sortBy = "employeeName";
  const sortDirection = "asc";
  const [currentPage, setCurrentPage] = useState(1);
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [editorState, setEditorState] = useState({
    open: false,
    mode: "update",
    employeeRecordId: null,
    leaveTypeCode: "",
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

  const loadRows = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const result = await fetchLeaveBalanceRows(currentYear);
      setRows(result.rows || []);
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || error?.message || "Unable to load leave balances.");
      }
    } finally {
      setLoading(false);
    }
  }, [currentYear]);

  useAutoRefreshOnChange(loadRows, {
    topics: ["leave_credit", "leave_request", "leave_monetization"],
  });

  useEffect(() => {
    if (openActionMenuId === null) {
      return undefined;
    }

    const handleClick = () => setOpenActionMenuId(null);
    window.addEventListener("click", handleClick);

    return () => window.removeEventListener("click", handleClick);
  }, [openActionMenuId]);

  const divisionOptions = useMemo(
    () =>
      Array.from(
        new Set(rows.map((row) => String(row.division || "").trim()).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right)),
    [rows]
  );

  const employmentStatusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((row) => String(row.employmentStatus || row.status || "").trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [rows]
  );


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
      const rowEmploymentStatus = String(row.employmentStatus || row.status || "").trim();
      const matchesEmploymentStatus = !filters.employmentStatus || rowEmploymentStatus === filters.employmentStatus;

      const focusBalance = getRowFocusBalance(row, filters.leaveType);
      const matchesLeaveType = !filters.leaveType || (
        Number(focusBalance?.total || 0) > 0
        || Number(focusBalance?.used || 0) > 0
        || Number(focusBalance?.remaining || 0) > 0
      );

      return matchesSearch && matchesDivision && matchesEmploymentStatus && matchesLeaveType;
    });
  }, [filters, rows]);

  const sortedRows = useMemo(() => sortRows(filteredRows, sortBy, sortDirection), [filteredRows, sortBy, sortDirection]);

  const pageSize = Number(filters.rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.division, filters.employmentStatus, filters.leaveType, filters.rowsPerPage, sortBy, sortDirection]);

  // Keep selection coherent with the employment-status verification context.
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

  const selectedHistoryRow = historyState.row;
  // Derived from the live rows so background refreshes keep the sheet in sync.
  const adjustRow = useMemo(
    () => rows.find((row) => row.employeeRecordId === adjustState.employeeRecordId) || null,
    [adjustState.employeeRecordId, rows]
  );
  const showSelectionColumn = allowActions;
  const visibleLeadColumns = 1 + (showEmployeeIdColumn ? 1 : 0) + (showRowNumberColumn ? 1 : 0) + 2;
  const tableColumnCount = (showSelectionColumn ? 1 : 0) + visibleLeadColumns + TABLE_BALANCE_COLUMNS.length + 1 + (allowActions ? 1 : 0);


  const openEditor = (mode, row) => {
    setOpenActionMenuId(null);
    setEditorState({
      open: true,
      mode,
      employeeRecordId: row?.employeeRecordId || null,
      leaveTypeCode: filters.leaveType || "VL",
    });
  };

  const openAdjustments = (row) => {
    setOpenActionMenuId(null);
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
      toast.error("There are no leave balance records to export.");
      return;
    }

    const balanceColumns = LEAVE_TYPE_OPTIONS;
    const headers = [
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
      const cells = [
        row.employeeName || "",
        row.employeeId || "",
        row.division || "",
        row.position || "",
        row.employmentStatus || row.status || "",
        ...balanceColumns.map((type) => formatBalanceValue(getDisplayBalanceRecord(row, type.code).remaining)),
        row.lastUpdated ? formatDateTime(row.lastUpdated) : "Never",
      ];
      return cells.map(escapeCell).join(",");
    });

    const csvContent = [headers.map(escapeCell).join(","), ...lines].join("\r\n");
    const blob = new Blob([`﻿${csvContent}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leave-balances-${currentYear}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${sortedRows.length} leave balance record(s).`);
  };

  const openHistory = async (row) => {
    setOpenActionMenuId(null);
    setHistoryState({
      open: true,
      row,
      loading: true,
      history: null,
    });

    try {
      const result = await fetchLeaveBalanceHistory(row.employeeRecordId, currentYear, filters.leaveType || "");
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

  const handleSaveBalance = async (payload) => {
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
      setEditorState({
        open: false,
        mode: "update",
        employeeRecordId: null,
        leaveTypeCode: "",
      });

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

  const handleResetBalances = async (row) => {
    setOpenActionMenuId(null);

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
        "Reset from HR Head leave balance workspace."
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

  return (
    <section className="space-y-4">

      <section className="rounded-[30px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="m-0 text-lg font-semibold text-slate-950">Employee Leave Credit Registry</h3>
              <p className="m-0 mt-1 text-sm text-slate-500">
                Search, filter, sort, and update leave balances for active employee records.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Download size={16} />
                Export CSV
              </button>
              {allowActions ? (
                <button
                  type="button"
                  onClick={() => openEditor("set", null)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#D61E1E] px-4 text-sm font-semibold text-white transition hover:bg-[#991B1B]"
                >
                  <ShieldCheck size={16} />
                  Set Balance
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,200px)_150px_150px_150px_120px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={filters.search}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Search employee name or ID"
                className="h-9 w-full rounded-2xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <select
              value={filters.division}
              onChange={(event) => setFilters((current) => ({ ...current, division: event.target.value }))}
              className="h-9 rounded-2xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">All divisions</option>
              {divisionOptions.map((division) => (
                <option key={division} value={division}>{division}</option>
              ))}
            </select>

            <select
              value={filters.employmentStatus}
              onChange={(event) => setFilters((current) => ({ ...current, employmentStatus: event.target.value }))}
              className="h-9 rounded-2xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">All employment statuses</option>
              {employmentStatusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>

            <select
              value={filters.leaveType}
              onChange={(event) => setFilters((current) => ({ ...current, leaveType: event.target.value }))}
              className="h-9 rounded-2xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">All leave types</option>
              {LEAVE_TYPE_OPTIONS.map((type) => (
                <option key={type.code} value={type.code}>{type.label}</option>
              ))}
            </select>

            <select
              value={filters.rowsPerPage}
              onChange={(event) => setFilters((current) => ({ ...current, rowsPerPage: event.target.value }))}
              className="h-9 rounded-2xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="5">5 rows</option>
              <option value="10">10 rows</option>
              <option value="20">20 rows</option>
              <option value="50">50 rows</option>
            </select>
          </div>

        </div>

        {allowActions && selectedIds.size > 0 ? (
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
                  {filters.employmentStatus ? `Employment status: ${filters.employmentStatus}` : "All employment statuses"}
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
          <div className="rounded-[26px] border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-[2050px] w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    {showSelectionColumn ? (
                      <th className="border-b border-slate-200 px-3 py-3 text-left">
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
                      ...(showRowNumberColumn ? [{ key: "rowNumber", label: "#" }] : []),
                      { key: "employeeName", label: "Employee Name" },
                      ...(showEmployeeIdColumn ? [{ key: "employeeId", label: "Employee ID" }] : []),
                      { key: "division", label: "Division" },
                      { key: "position", label: "Position" },
                      ...TABLE_BALANCE_COLUMNS,
                      { key: "lastUpdated", label: "Last Updated" },
                    ].map((column) => (
                      <th
                        key={column.key}
                        className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600"
                      >
                        {column.label}
                      </th>
                    ))}
                    {allowActions ? (
                      <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600">
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
                          <div className="h-9 rounded-2xl bg-slate-200" />
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
                          Adjust the filters or refresh the registry to load employee leave credit records.
                        </p>
                      </td>
                    </tr>
                  ) : paginatedRows.map((row, index) => {
                    const isSelected = selectedIds.has(row.employeeRecordId);

                    return (
                    <tr
                      key={row.employeeRecordId}
                      className={`border-b border-slate-100 align-top transition ${isSelected ? "bg-emerald-50/70" : "hover:bg-emerald-50/35"}`}
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
                      {showRowNumberColumn ? (
                        <td className="px-3 py-4 text-sm font-semibold text-slate-600">
                          {(safePage - 1) * pageSize + index + 1}
                        </td>
                      ) : null}
                      <td className="px-3 py-4 text-sm text-slate-900">
                        <div className="font-semibold">{row.employeeName}</div>
                        {row.employmentStatus || row.status ? (
                          <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                            {row.employmentStatus || row.status}
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
                        <td className="px-3 py-4">
                          <div className="relative" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setOpenActionMenuId((current) => (current === row.employeeRecordId ? null : row.employeeRecordId))}
                              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                              <MoreHorizontal size={16} />
                              Actions
                              <ChevronDown size={14} className={openActionMenuId === row.employeeRecordId ? "rotate-180 transition-transform" : "transition-transform"} />
                            </button>

                            {openActionMenuId === row.employeeRecordId ? (
                              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                                <button
                                  type="button"
                                  onClick={() => openAdjustments(row)}
                                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-800"
                                >
                                  <PlusCircle size={16} />
                                  Add Balance
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openHistory(row)}
                                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                  <History size={16} />
                                  View History
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleResetBalances(row)}
                                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                                >
                                  <RotateCcw size={16} />
                                  Reset Leave Credits
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {sortedRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, sortedRows.length)} of {sortedRows.length} employee balance records
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </div>
      </section>

      <LeaveBalanceEditorModal
        open={editorState.open}
        mode={editorState.mode}
        employeeRows={rows}
        defaultEmployeeRecordId={editorState.employeeRecordId}
        defaultLeaveTypeCode={editorState.leaveTypeCode}
        updatedBy={updaterName}
        saving={saving}
        onClose={() => setEditorState({ open: false, mode: "update", employeeRecordId: null, leaveTypeCode: "" })}
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
          defaultLeaveTypeCode={filters.leaveType}
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
