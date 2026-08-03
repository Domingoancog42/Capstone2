import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FilePenLine,
  Search,
  X,
} from "lucide-react";
import { faEye, faFileLines, faPrint, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import SharedEmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import LeaveStatusBadge from "../../components/leave/LeaveStatusBadge";
import Pagination from "../../components/UI/Pagination";
import {
  canManageLeave,
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  matchesUserRecordScope,
  matchesUserEmployeeOption,
  normalizeRequestStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import {
  deletePassSlip,
  fetchPassSlips,
  filePassSlip,
} from "../../services/passSlipService";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";

const PASS_SLIP_STATUSES = ["Pending", "Approved", "Rejected", "Returned"];

const initialForm = {
  employeeRecordId: "",
  passDate: "",
  departureTime: "",
  timeReturned: "",
  destination: "",
  purpose: "",
};

const passSlipPreviewStyles = {
  slip: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "11px",
    width: "100%",
    maxWidth: "720px",
    margin: "0 auto",
    background: "#ffffff",
    border: "2px solid #000000",
    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderBottom: "2px solid #000000",
    padding: "8px 12px",
    gap: "12px",
  },
  logoImage: {
    width: "65px",
    height: "65px",
    objectFit: "contain",
    display: "block",
    flexShrink: 0,
  },
  agencyText: {
    fontSize: "10px",
    lineHeight: 1.6,
    textAlign: "center",
  },
  title: {
    textAlign: "center",
    fontSize: "20px",
    fontWeight: 900,
    fontStyle: "italic",
    letterSpacing: "3px",
    borderBottom: "2px solid #000000",
    padding: "6px 0",
    textTransform: "uppercase",
    fontFamily: "'Arial Black', Arial, sans-serif",
  },
  body: {
    padding: "10px 16px 0",
  },
  field: {
    borderBottom: "1px solid #000000",
    minHeight: "20px",
    padding: "1px 6px",
    fontSize: "12px",
    color: "#111827",
  },
  label: {
    fontWeight: "bold",
    fontSize: "11px",
    whiteSpace: "nowrap",
    alignSelf: "end",
  },
  footer: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    borderTop: "2px solid #000000",
    marginTop: "10px",
  },
  footerLeft: {
    borderRight: "1px solid #000000",
    padding: "8px 16px 6px",
  },
  footerRight: {
    padding: "8px 16px 6px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  sigLine: {
    borderBottom: "1px solid #000000",
    width: "100%",
    marginBottom: "2px",
    minHeight: "30px",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: "11px",
    color: "#111827",
  },
};

const passSlipRowBase = {
  display: "grid",
  alignItems: "end",
  marginBottom: "6px",
  gap: "0 6px",
};

function getDivisionName(value) {
  const division = String(value || "").trim();
  return division || "Unassigned";
}

function formatPassSlipLongDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function printPassSlipContent(contentNode) {
  if (!contentNode) {
    return;
  }

  const formClone = contentNode.cloneNode(true);
  const printWindow = window.open("", "_blank", "width=960,height=1200");
  if (!printWindow) {
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pass Slip Form</title>
        <style>
          @page {
            size: auto;
            margin: 10mm;
          }

          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
          }

          body {
            font-family: Arial, sans-serif;
            color: #000000;
          }

          *,
          *::before,
          *::after {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .print-shell {
            width: 100%;
            max-width: 190mm;
            margin: 0 auto;
          }
        </style>
      </head>
      <body>
        <div class="print-shell">${formClone.outerHTML}</div>
      </body>
    </html>
  `);
  printWindow.document.close();

  const formRoot = printWindow.document.querySelector(".print-shell > div");
  if (formRoot) {
    formRoot.style.width = "100%";
    formRoot.style.maxWidth = "190mm";
    formRoot.style.margin = "0 auto";
    formRoot.style.boxShadow = "none";
  }

  const finishPrint = () => {
    printWindow.focus();
    printWindow.print();
    printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
  };

  const images = Array.from(printWindow.document.images || []);
  if (images.length === 0) {
    window.setTimeout(finishPrint, 150);
    return;
  }

  Promise.all(
    images.map((image) => (
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        })
    ))
  ).then(() => {
    window.setTimeout(finishPrint, 150);
  });
}

function PassSlipFormSheet({ record, contentRef = null }) {
  if (!record) {
    return null;
  }

  return (
    <div ref={contentRef} className="pass-slip-form-paper" style={passSlipPreviewStyles.slip}>
      <div style={passSlipPreviewStyles.header}>
        <img src="/mgb.png" alt="MGB Logo" style={passSlipPreviewStyles.logoImage} />

        <div style={passSlipPreviewStyles.agencyText}>
          <p style={{ margin: "1px 0" }}>Republic of the Philippines</p>
          <p style={{ margin: "1px 0" }}>Department of Environment and Natural Resources</p>
          <p style={{ margin: "1px 0", fontWeight: "bold" }}>MINES AND GEOSCIENCES BUREAU 10</p>
          <p style={{ margin: "1px 0" }}>Cagayan de Oro City</p>
          <p style={{ margin: "1px 0" }}>E-mail: DENRMGBX@Philwepinc.Com | Tel. No. (088) 72-7874</p>
        </div>
      </div>

      <div style={passSlipPreviewStyles.title}>Pass Slip</div>

      <div style={passSlipPreviewStyles.body}>
        <div style={{ ...passSlipRowBase, gridTemplateColumns: "auto 1fr auto auto 1fr" }}>
          <span style={passSlipPreviewStyles.label}>NAME :</span>
          <div style={passSlipPreviewStyles.field}>{record.employeeName || ""}</div>
          <span style={{ width: "10px" }} />
          <span style={passSlipPreviewStyles.label}>DATE :</span>
          <div style={passSlipPreviewStyles.field}>{formatPassSlipLongDate(record.passDate)}</div>
        </div>

        <div style={{ ...passSlipRowBase, gridTemplateColumns: "auto 1fr auto 1fr" }}>
          <span style={passSlipPreviewStyles.label}>DEPARTURE TIME :</span>
          <div style={passSlipPreviewStyles.field}>{record.departureTimeDisplay || ""}</div>
          <span style={{ ...passSlipPreviewStyles.label, whiteSpace: "nowrap" }}>TIME RETURNED :</span>
          <div style={passSlipPreviewStyles.field}>{record.timeReturnedDisplay || ""}</div>
        </div>

        <div style={{ ...passSlipRowBase, gridTemplateColumns: "auto 1fr" }}>
          <span style={passSlipPreviewStyles.label}>DESTINATION :</span>
          <div style={passSlipPreviewStyles.field}>{record.destination || ""}</div>
        </div>

        <div style={{ ...passSlipRowBase, gridTemplateColumns: "auto 1fr", marginBottom: 0 }}>
          <span style={passSlipPreviewStyles.label}>PURPOSE :</span>
          <div style={passSlipPreviewStyles.field}>{record.purpose || ""}</div>
        </div>
      </div>

      <div style={passSlipPreviewStyles.footer}>
        <div style={passSlipPreviewStyles.footerLeft}>
          <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "30px" }}>
            Approved by :
          </div>
          <div style={passSlipPreviewStyles.sigLine}>{record.approvedByUsername || "\u00A0"}</div>
        </div>
        <div style={passSlipPreviewStyles.footerRight}>
          <div style={passSlipPreviewStyles.sigLine} />
          <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "11px" }}>
            Signature
          </div>
        </div>
      </div>
    </div>
  );
}

// Kept temporarily for local reference while pass slips uses the shared selector component.
// eslint-disable-next-line no-unused-vars
function EmployeeSearchSelect({
  employeeOptions,
  selectedEmployee,
  onSelect,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return employeeOptions;
    }

    return employeeOptions.filter((employee) =>
      [employee.employeeName, employee.employeeId, employee.division]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [employeeOptions, query]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-[46px] w-full items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 text-left text-sm outline-none transition ${
          disabled
            ? "cursor-not-allowed bg-slate-50 text-slate-500"
            : "bg-white text-slate-900 hover:border-slate-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        }`}
      >
        <span className={selectedEmployee ? "text-slate-900" : "text-slate-400"}>
          {selectedEmployee
            ? selectedEmployee.employeeName
            : "Search employee..."}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && !disabled ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-200 p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee..."
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {filteredOptions.length === 0 ? (
              <p className="m-0 rounded-xl px-3 py-3 text-sm text-slate-500">No employees found.</p>
            ) : filteredOptions.map((employee) => (
              <button
                key={employee.employeeRecordId}
                type="button"
                onClick={() => {
                  onSelect(employee);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-start justify-between rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{employee.employeeName}</span>
                  <span className="block text-xs text-slate-500">
                    {employee.employeeId || "No ID"}{employee.division ? ` â€¢ ${employee.division}` : ""}
                  </span>
                </span>
                {selectedEmployee?.employeeRecordId === employee.employeeRecordId ? (
                  <Check size={15} className="mt-0.5 text-teal-700" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PassSlipPreviewModal({ record, onClose }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!record) {
      setVisible(false);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [record]);

  if (!record) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close pass slip form preview"
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        className={`pass-slip-form-preview relative z-10 max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Pass Slip Form</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Centered overlay preview of the submitted pass slip.</p>
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-slate-100 px-3 py-4 sm:px-4">
          <PassSlipFormSheet record={record} />
        </div>
      </div>
    </div>
  );
}

function PassSlipModal({
  open,
  submitting,
  employeeOptions,
  selectedEmployee,
  canSelectEmployee,
  defaultValues,
  showHeaderCloseButton = true,
  onClose,
  onSubmit,
}) {
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }

    setForm({
      ...initialForm,
      ...defaultValues,
    });
    setErrors({});
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [defaultValues, open]);

  if (!open) {
    return null;
  }

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const handleSelectEmployee = (employee) => {
    setForm((current) => ({
      ...current,
      employeeRecordId: String(employee.employeeRecordId),
    }));
    setErrors((current) => ({ ...current, employeeRecordId: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};

    if (canSelectEmployee && !form.employeeRecordId) nextErrors.employeeRecordId = "Employee is required.";
    if (!form.passDate) nextErrors.passDate = "Pass date is required.";
    if (!form.departureTime) nextErrors.departureTime = "Departure time is required.";
    if (!form.timeReturned) nextErrors.timeReturned = "Time returned is required.";
    if (!form.destination.trim()) nextErrors.destination = "Destination is required.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit({
      employeeRecordId: Number(form.employeeRecordId),
      passDate: form.passDate,
      departureTime: form.departureTime,
      timeReturned: form.timeReturned,
      destination: form.destination.trim(),
      purpose: form.purpose.trim(),
    });
  };

  const inputClasses = "min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100";
  const resolvedEmployee = employeeOptions.find(
    (employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)
  ) || selectedEmployee;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close pass slip form"
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <form
        onSubmit={handleSubmit}
        className={`relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Create Pass Slip</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Complete the form to submit a pass slip request.</p>
          </div>
          <div className="flex items-center gap-2">
            <img
              src="/mgb.png"
              alt="MGB Logo"
              className="h-14 w-14 shrink-0 object-contain"
            />
            {showHeaderCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-5 py-5 sm:px-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Employee</span>
              {canSelectEmployee ? (
                <SharedEmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={resolvedEmployee || null}
                  onSelect={handleSelectEmployee}
                />
              ) : (
                <input
                  type="text"
                  value={resolvedEmployee?.employeeName || ""}
                  readOnly
                  className={`${inputClasses} cursor-not-allowed bg-slate-50 text-slate-500`}
                />
              )}
              {errors.employeeRecordId ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.employeeRecordId}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                Pass Date
              </span>
              <input
                type="date"
                value={form.passDate}
                onChange={updateField("passDate")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: dd/mm/yyyy</p>
              {errors.passDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.passDate}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Departure Time</span>
              <input
                type="time"
                value={form.departureTime}
                onChange={updateField("departureTime")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: --:-- --</p>
              {errors.departureTime ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.departureTime}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Time Returned</span>
              <input
                type="time"
                value={form.timeReturned}
                onChange={updateField("timeReturned")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: --:-- --</p>
              {errors.timeReturned ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.timeReturned}</p> : null}
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Destination</span>
              <input
                value={form.destination}
                onChange={updateField("destination")}
                placeholder="Enter destination"
                className={inputClasses}
              />
              {errors.destination ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.destination}</p> : null}
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Purpose</span>
              <textarea
                rows={4}
                value={form.purpose}
                onChange={updateField("purpose")}
                placeholder="Add the reason for the pass slip."
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-sky-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Pass Slip"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function PassSlipWorkspace({
  user,
  employees = [],
  title = "Pass Slip Management",
  description = "Create, review, and monitor pass slip requests.",
  submitLabel = "File Pass Slip",
  showDeleteAction = true,
  showHeaderCloseButton = true,
  showDivisionFilter = true,
  onPendingCountChange,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [printRecord, setPrintRecord] = useState(null);
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [status, setStatus] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const hiddenPrintRef = useRef(null);

  const managePermission = canManageLeave(user);
  const viewAllPermission = canViewAllLeaves(user);
  const allowEmployeeSelection = resolveRoleKey(user) === "admin";
  const pendingCount = useMemo(() => countPendingRecords(records), [records]);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchPassSlips();
      const nextRecords = result.records || [];
      setRecords(
        viewAllPermission
          ? nextRecords
          : nextRecords.filter((record) => matchesUserRecordScope(record, user))
      );
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load pass slips.");
      }
    } finally {
      setLoading(false);
    }
  }, [user, viewAllPermission]);

  const employeeOptions = useMemo(
    () =>
      employees
        .map((employee) => ({
          employeeRecordId: employee.id,
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          division: employee.department || employee.division || "",
        }))
        .filter((employee) => employee.employeeRecordId && employee.employeeName)
        .filter((employee) => !(allowEmployeeSelection && matchesUserEmployeeOption(employee, user)))
        .sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
    [allowEmployeeSelection, employees, user]
  );

  const divisionOptions = useMemo(() => {
    const nextDivisions = new Set();

    employeeOptions.forEach((employee) => {
      const division = String(employee.division || "").trim();
      if (division) {
        nextDivisions.add(division);
      }
    });

    records.forEach((record) => {
      nextDivisions.add(getDivisionName(record.division));
    });

    return Array.from(nextDivisions).sort((left, right) => left.localeCompare(right));
  }, [employeeOptions, records]);

  const selectedEmployee = useMemo(() => {
    const userEmployeeId = String(user?.employee_id || "").trim().toLowerCase();
    const userName = String(user?.full_name || user?.username || "").trim().toLowerCase();

    const matchedEmployee = employeeOptions.find((employee) => {
      const employeeCode = String(employee.employeeId || "").trim().toLowerCase();
      const employeeName = String(employee.employeeName || "").trim().toLowerCase();

      return (
        (userEmployeeId && employeeCode === userEmployeeId)
        || (userName && employeeName === userName)
      );
    });

    if (allowEmployeeSelection) {
      return null;
    }

    if (matchedEmployee) {
      return matchedEmployee;
    }

    if (user?.full_name || user?.username || user?.employee_id) {
      return {
        employeeRecordId: "",
        employeeId: user?.employee_id || "",
        employeeName: user?.full_name || user?.username || "",
        division: user?.division || "",
      };
    }

    return null;
  }, [allowEmployeeSelection, employeeOptions, user]);

  useAutoRefreshOnChange(loadRecords, { topic: "pass_slip" });

  useEffect(() => {
    if (!loading) {
      onPendingCountChange?.(pendingCount);
    }
  }, [loading, onPendingCountChange, pendingCount]);

  useEffect(() => {
    if (!printRecord) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      printPassSlipContent(hiddenPrintRef.current);
      setPrintRecord(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [printRecord]);

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = !search || [
        record.employeeName,
        getDivisionName(record.division),
        record.destination,
        record.purpose,
        record.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));

      const matchesDivision = !divisionFilter || getDivisionName(record.division) === divisionFilter;
      const matchesStatus = !status || record.status === status;
      const matchesDate = !dateFilter || record.passDate === dateFilter;

      return matchesSearch && matchesDivision && matchesStatus && matchesDate;
    });
  }, [dateFilter, divisionFilter, query, records, status]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, divisionFilter, status, dateFilter, rowsPerPage]);

  const defaultValues = useMemo(
    () => ({
      employeeRecordId: selectedEmployee ? String(selectedEmployee.employeeRecordId) : "",
    }),
    [selectedEmployee]
  );

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const employee = employeeOptions.find(
        (option) => option.employeeRecordId === Number(payload.employeeRecordId)
      ) || selectedEmployee;

      const result = await filePassSlip({
        ...payload,
        employeeId: employee?.employeeId || user?.employee_id || "",
        employeeName: employee?.employeeName || user?.full_name || user?.username || "",
      });

      setRecords((current) => [result.record, ...current]);
      setModalOpen(false);
      toast.success("Pass slip submitted successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to submit pass slip.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenPreview = (record) => {
    setSelectedRecord(record);
  };

  const handlePrintRecord = (record) => {
    setPrintRecord(record);
  };

  const handleClosePreview = () => {
    setSelectedRecord(null);
  };

  const handleDelete = async (record) => {
    const confirmation = await Swal.fire({
      title: "Delete Pass Slip?",
      text: `Delete the pass slip for ${record.employeeName}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete",
      cancelButtonText: "Keep record",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      await deletePassSlip(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      await Swal.fire({
        toast: true,
        position: "top-end",
        title: "Deleted",
        text: "Pass slip deleted successfully.",
        icon: "success",
        width: 320,
        timer: 3000,
        timerProgressBar: true,
        showConfirmButton: false,
        padding: "0.75rem 0.9rem",
      });
    } catch (error) {
      await Swal.fire({
        toast: true,
        position: "top-end",
        title: "Delete failed",
        text: error?.response?.data?.message || error?.message || "Unable to delete pass slip.",
        icon: "error",
        width: 320,
        timer: 4000,
        timerProgressBar: true,
        showConfirmButton: false,
        padding: "0.75rem 0.9rem",
      });
    }
  };

  const filterGridClass = showDivisionFilter
    ? "mt-4 grid gap-3 lg:grid-cols-[minmax(0,200px)_170px_150px_150px_120px]"
    : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_120px]";

  return (
    <div className="pass-slip-workspace space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">{title}</h3>
            <p className="m-0 mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            <FilePenLine size={16} />
            {submitLabel}
          </button>
        </div>

        <div className={filterGridClass}>
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={viewAllPermission ? "Search employee, division, destination, purpose" : "Search destination, purpose, status"}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          {showDivisionFilter ? (
            <select
              value={divisionFilter}
              onChange={(event) => setDivisionFilter(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All divisions</option>
              {divisionOptions.map((division) => (
                <option key={division} value={division}>
                  {division}
                </option>
              ))}
            </select>
          ) : null}
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All statuses</option>
            {PASS_SLIP_STATUSES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
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

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-[1240px] w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {["#", "Employee", "Division", "Pass Date", "Departure", "Returned", "Destination", "Status", "Actions"].map((header) => (
                    <th key={header} className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <tr key={index} className="animate-pulse border-b border-slate-100">
                      <td colSpan={9} className="px-3 py-3">
                        <div className="h-5 rounded bg-slate-200" />
                      </td>
                    </tr>
                  ))
                ) : paginatedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                        <ClipboardList size={20} />
                      </div>
                      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No pass slips found</p>
                      <p className="m-0 mt-1 text-sm text-slate-500">Create a pass slip or adjust the filters.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((record, index) => {
                    const canReviewRecord = managePermission;
                    const canDeleteRecord = showDeleteAction
                      && managePermission
                      && normalizeRequestStatus(record.status) === "Pending"
                      && !matchesUserRecordScope(record, user);

                    return (
                      <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                          {(safePage - 1) * pageSize + index + 1}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-800">
                          <div className="font-semibold text-slate-900">{record.employeeName}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.division || "Unassigned"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(record.passDate)}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.departureTimeDisplay}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.timeReturnedDisplay}</td>
                        <td className="max-w-[220px] truncate px-3 py-3 text-sm text-slate-700">{record.destination}</td>
                        <td className="px-3 py-3"><LeaveStatusBadge status={record.status} /></td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <ActionIconButton
                              label={canReviewRecord ? "Review pass slip" : "View pass slip form"}
                              icon={canReviewRecord ? faFileLines : faEye}
                              tone={canReviewRecord ? "review" : "view"}
                              onClick={() => handleOpenPreview(record)}
                            />
                            <ActionIconButton
                              label="Print pass slip"
                              icon={faPrint}
                              tone="print"
                              onClick={() => handlePrintRecord(record)}
                            />
                            {canDeleteRecord ? (
                              <ActionIconButton
                                label="Delete pass slip"
                                icon={faTrashCan}
                                tone="delete"
                                onClick={() => handleDelete(record)}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-slate-500">
            Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredRecords.length)} of {filteredRecords.length} pass slips
          </p>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      </section>

      <PassSlipModal
        open={modalOpen}
        submitting={submitting}
        employeeOptions={employeeOptions}
        selectedEmployee={selectedEmployee}
        canSelectEmployee={allowEmployeeSelection}
        defaultValues={defaultValues}
        showHeaderCloseButton={showHeaderCloseButton}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />

      <div className="pointer-events-none fixed -left-[10000px] top-0 opacity-0" aria-hidden="true">
        <PassSlipFormSheet record={printRecord} contentRef={hiddenPrintRef} />
      </div>

      <PassSlipPreviewModal record={selectedRecord} onClose={handleClosePreview} />
    </div>
  );
}


