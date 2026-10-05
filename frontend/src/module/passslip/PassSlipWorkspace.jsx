import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FilePenLine,
  IdCard,
  LogIn,
  LogOut,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  faBan,
  faBoxArchive,
  faPrint,
  faRotateLeft,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ViewFormActions from "../../components/UI/ViewFormActions";
import SharedEmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import {
  canManageLeave,
  canViewAllLeaves,
  formatDateDisplay,
  isPastDate,
  matchesUserRecordScope,
  matchesUserEmployeeOption,
  resolveRoleKey,
  todayDateInputValue,
} from "../../utils/leaveHelpers";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import { buildSignatureTimestampLabel } from "../../utils/signatureTimestamp";
import { formatRecordDivision } from "../../utils/divisionDisplay";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { getEmployeeSignature } from "../../services/api";
import {
  cancelPassSlip,
  deletePassSlip,
  fetchPassSlips,
  filePassSlip,
} from "../../services/passSlipService";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import FormQrCode from "../../components/UI/FormQrCode";
import {
  PASS_SLIP_MAX_MINUTES,
  PASS_SLIP_MIN_MINUTES,
  PASS_SLIP_STATUS,
  PASS_SLIP_TYPES,
  formatPassSlipDuration,
  normalizePassSlipStatus,
} from "../../utils/passSlipStatus";
import { useOrganizationFilterOptions } from "../../hooks/useFilterOptions";

/* Pass slips are filed directly without an approval step. Employee details come from HRIS. */

export { PASS_SLIP_MIN_MINUTES, PASS_SLIP_MAX_MINUTES, formatPassSlipDuration };

const initialForm = {
  employeeRecordId: "",
  passDate: "",
  passType: PASS_SLIP_TYPES[0],
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
  /* Equal outer columns keep the agency text centered beside the logo. */
  header: {
    display: "grid",
    gridTemplateColumns: "116px 1fr 116px",
    alignItems: "center",
    borderBottom: "2px solid #000000",
    padding: "8px 12px",
    gap: "12px",
  },
  /* Sits against the agency text rather than the slip's left edge. */
  logoImage: {
    width: "90px",
    height: "90px",
    objectFit: "contain",
    display: "block",
    flexShrink: 0,
    justifySelf: "end",
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
  // Capped just under `sigLine`'s 30px so a signature sits *on* the ruled line rather than stretching
  // it — the printed slip keeps the same geometry it has today, signed or not.
  sigImage: {
    maxWidth: "100%",
    maxHeight: "28px",
    objectFit: "contain",
    display: "block",
  },
  signatureTimestamp: {
    color: "#111827",
    fontSize: "9px",
    fontStyle: "italic",
    fontWeight: "bold",
    lineHeight: 1.2,
    textAlign: "center",
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

/** The printable slip. */
function PassSlipFormSheet({ record, contentRef = null, signatureDataUrl = "" }) {
  if (!record) {
    return null;
  }

  /*
   * Stands in for the drawn signature when the employee has not saved one in their profile — the same
   * fallback the travel order form uses, so an unsigned slip still carries dated proof of who filed it
   * and when instead of printing a blank line.
   */
  const filedTimestampLabel = buildSignatureTimestampLabel("Filed", record.createdAt || record.dateFiled);

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

        <FormQrCode
          value={record.qrValue || ""}
          size={104}
          align="right"
          reference=""
          caption=""
          showBorder={false}
        />
      </div>

      <div style={passSlipPreviewStyles.title}>Pass Slip</div>

      <div style={passSlipPreviewStyles.body}>
        <div style={{ ...passSlipRowBase, gridTemplateColumns: "auto 1fr auto auto 1fr" }}>
          <span style={passSlipPreviewStyles.label}>NAME :</span>
          <div style={passSlipPreviewStyles.field}>{record.employeeName || ""}</div>
          <span style={{ width: "10px" }} />
          <span style={passSlipPreviewStyles.label}>DATE :</span>
          <div style={passSlipPreviewStyles.field}>
            {formatPassSlipLongDate(record.timeOutDate || record.passDate)}
          </div>
        </div>

        {/* Read off the employee's HRIS profile, never typed onto the slip. */}
        <div style={{ ...passSlipRowBase, gridTemplateColumns: "auto 1fr auto auto 1fr" }}>
          <span style={passSlipPreviewStyles.label}>EMPLOYEE ID :</span>
          <div style={passSlipPreviewStyles.field}>{record.employeeId || ""}</div>
          <span style={{ width: "10px" }} />
          <span style={passSlipPreviewStyles.label}>POSITION :</span>
          <div style={passSlipPreviewStyles.field}>{record.position || ""}</div>
        </div>

        <div style={{ ...passSlipRowBase, gridTemplateColumns: "auto 1fr auto auto 1fr" }}>
          <span style={passSlipPreviewStyles.label}>DIVISION / OFFICE :</span>
          <div style={passSlipPreviewStyles.field}>{formatRecordDivision(record)}</div>
          <span style={{ width: "10px" }} />
          <span style={passSlipPreviewStyles.label}>TYPE :</span>
          <div style={passSlipPreviewStyles.field}>{record.passType || ""}</div>
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
          <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "8px" }}>
            Approved by :
          </div>
          {/*
            * Nothing in the app writes approved_by, because a pass slip has no approval step -- so
            * this prints as an empty ruled line, which is what the paper form wants. The slip is
            * signed by hand on the way out if a signature is wanted at all. The name is still read
            * here for the older records that carry one.
            */}
          <div style={passSlipPreviewStyles.sigLine}>{record.approvedByUsername || " "}</div>
        </div>
        <div style={passSlipPreviewStyles.footerRight}>
          <div style={passSlipPreviewStyles.sigLine}>
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt={`${record.employeeName || "Employee"} signature`}
                style={passSlipPreviewStyles.sigImage}
              />
            ) : filedTimestampLabel ? (
              <span style={passSlipPreviewStyles.signatureTimestamp}>{filedTimestampLabel}</span>
            ) : " "}
          </div>
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
                    {employee.employeeId || "No ID"}{employee.division ? ` • ${employee.division}` : ""}
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

/** Employee identity shown beside the paper form. */
function PassSlipEmployeeProfile({ record }) {
  const photoUrl = resolveBackendAssetUrl(record?.profileImage || record?.profile_image);
  const details = [
    { label: "Position", value: record?.position || "Not assigned", icon: BriefcaseBusiness },
    { label: "Division / Office", value: formatRecordDivision(record) || "Not assigned", icon: Building2 },
    {
      label: "Employment Status",
      value: record?.employmentStatus || record?.employment_status || "Not assigned",
      icon: BadgeCheck,
    },
    /* Stamped by the two gate scans of this slip's QR code; a dash until the scan happens. */
    { label: "Departure", value: record?.timeOutDisplay || "—", icon: LogOut },
    { label: "Time Returned", value: record?.timeInDisplay || "—", icon: LogIn },
  ];

  return (
    <section
      aria-label="Employee profile"
      className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm"
    >
      <div className="flex items-center gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-white px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-sm">
          <UserRound size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-bold text-blue-950">Employee Profile</h3>
          <p className="m-0 mt-0.5 text-xs text-slate-500">Pass slip information and employee details</p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3.5 pb-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-100 to-slate-100 text-blue-600 ring-4 ring-blue-50">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={`${record?.employeeName || "Employee"} profile`}
                className="h-full w-full object-cover"
              />
            ) : (
              <UserRound size={36} aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-base font-bold text-slate-950" title={record?.employeeName || "Employee"}>
              {record?.employeeName || "Employee"}
            </p>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
              <IdCard size={14} aria-hidden="true" />
              <span>{record?.employeeId || "No employee ID"}</span>
            </p>
          </div>
        </div>

        <dl className="m-0 border-t border-slate-200">
          {details.map(({ label, value, icon: Icon }) => (
            <div key={label} className="grid grid-cols-[32px_104px_minmax(0,1fr)] items-center border-b border-slate-200 py-2.5 last:border-b-0">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-50 text-blue-600">
                <Icon size={15} aria-hidden="true" />
              </span>
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="m-0 min-w-0 break-words text-sm font-medium leading-tight text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function PassSlipPreviewModal({ record, signatureDataUrl = "", onClose }) {
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

  // Keep the viewport overlay outside animated workspace ancestors, whose transforms would clip it.
  return createPortal((
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
        className={`pass-slip-form-preview relative z-10 max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[28px] bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Pass Slip Form</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {record.reference}
            </p>
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <PassSlipFormSheet record={record} signatureDataUrl={signatureDataUrl} />

            <aside aria-label="Pass slip details sidebar" className="space-y-4">
              <PassSlipEmployeeProfile record={record} />
            </aside>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
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

  /*
   * A pass slip covers a trip out of the office that has not happened yet, so the calendar starts
   * today. This holds for every role, admin included -- a back-dated filing is not something any
   * account may enter through this form.
   *
   * Recomputed each render rather than memoised, so a form left open past midnight still moves on.
   */
  const today = todayDateInputValue();

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
    /*
     * The `min` on the input stops the calendar offering earlier days, but a typed or pasted value
     * still gets here, so the rule is enforced again rather than trusted.
     */
    if (form.passDate && isPastDate(form.passDate)) {
      nextErrors.passDate = "Pass date cannot be in the past. Choose today or a later date.";
    }
    if (!form.destination.trim()) nextErrors.destination = "Destination is required.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit({
      employeeRecordId: Number(form.employeeRecordId),
      passDate: form.passDate,
      passType: form.passType,
      expectedMinutes: PASS_SLIP_MIN_MINUTES,
      destination: form.destination.trim(),
      purpose: form.purpose.trim(),
    });
  };

  const inputClasses = "min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100";
  const resolvedEmployee = employeeOptions.find(
    (employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)
  ) || selectedEmployee;

  // Keep the viewport overlay outside animated workspace ancestors, whose transforms would clip it.
  return createPortal((
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
            <p className="m-0 mt-1 text-sm text-slate-500">
              Your employee details are taken from your HRIS profile.
            </p>
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
            {/*
             * Only shown to roles that may file on someone else's behalf. Everyone else can only file
             * for themselves, so a read-only box echoing their own name is noise — the record still
             * gets `employeeRecordId` from `defaultValues`.
             */}
            {canSelectEmployee ? (
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Employee</span>
                <SharedEmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={resolvedEmployee || null}
                  onSelect={handleSelectEmployee}
                />
                {errors.employeeRecordId ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.employeeRecordId}</p> : null}
              </label>
            ) : null}

            {/*
             * The profile card, not a set of inputs. These four are on the employee's HRIS record
             * already, so the slip reads them from there -- retyping them is how a pass slip ends up
             * naming a division somebody left two years ago.
             */}
            {resolvedEmployee ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:col-span-2">
                <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">
                  From the HRIS profile
                </p>
                <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  {[
                    ["Name", resolvedEmployee.employeeName],
                    ["Employee ID", resolvedEmployee.employeeId],
                    ["Position", resolvedEmployee.position],
                    ["Division / Office", resolvedEmployee.division],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="m-0 text-xs font-semibold text-slate-500">{label}</dt>
                      <dd className="m-0 mt-0.5 break-words text-sm font-medium text-slate-800">
                        {value || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                Pass Date
              </span>
              <input
                type="date"
                value={form.passDate}
                min={today}
                onChange={updateField("passDate")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: dd/mm/yyyy</p>
              {errors.passDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.passDate}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Pass Slip Type</span>
              <select
                value={form.passType}
                onChange={updateField("passType")}
                className={inputClasses}
              >
                {PASS_SLIP_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <p className="m-0 mt-1 text-xs text-slate-500">Official Business or Personal.</p>
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
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-sky-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Pass Slip"}
          </button>
        </div>
      </form>
    </div>
  ), document.body);
}

/*
 * The desks confined to their own division: pass_slip.php hands them that division's slips and
 * nothing else, so the Division control names only their division. Mirrors
 * PASS_SLIP_DIVISION_SCOPED_ROLES in backend/api/pass_slip.php.
 */
const DIVISION_SCOPED_PASS_SLIP_ROLE_KEYS = new Set(["chief"]);

/*
 * Scoped desks that get no Division control at all. Kept as a set so any future desk can opt out
 * without coupling that presentation choice to the API scope rule. A Chief only ever sees one
 * division, so a locked one-option dropdown is noise.
 */
const HIDDEN_DIVISION_FILTER_ROLE_KEYS = new Set(["chief"]);

/*
 * Whose register splits the same way Leave Requests, Travel Orders and CTO do: the table carries
 * the slips of the people on the desk, and the viewer's own filings are followed under "View My
 * Pass Slips" instead.
 */
const MY_PASS_SLIP_VIEW_ROLE_KEYS = new Set(["chief", "planningofficer", "regionaldirector", "hrhead", "hrstaff"]);

export default function PassSlipWorkspace({
  user,
  employees = [],
  title = "Pass Slip Management",
  description = "Create and review pass slip requests.",
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
  const [selectedSignature, setSelectedSignature] = useState("");
  const [printRecord, setPrintRecord] = useState(null);
  const [printSignature, setPrintSignature] = useState("");
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const hiddenPrintRef = useRef(null);
  const signatureCacheRef = useRef(new Map());

  const roleKey = resolveRoleKey(user);
  const managePermission = canManageLeave(user);
  const viewAllPermission = canViewAllLeaves(user) && roleKey !== "cashier";
  const allowEmployeeSelection = roleKey === "admin";
  const isDivisionScoped = DIVISION_SCOPED_PASS_SLIP_ROLE_KEYS.has(roleKey);
  const scopedDivision = isDivisionScoped ? String(user?.division || user?.department || "").trim() : "";
  const showDivisionControl = showDivisionFilter && !HIDDEN_DIVISION_FILTER_ROLE_KEYS.has(roleKey);
  const [myView, setMyView] = useState(false);
  const canToggleMyView = viewAllPermission && MY_PASS_SLIP_VIEW_ROLE_KEYS.has(roleKey);
  const isViewerRecord = useCallback((record) => matchesUserRecordScope(record, user), [user]);
  const canArchive = canArchiveModule(roleKey, "passSlip");
  const [archiveView, setArchiveView] = useState(false);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchPassSlips({ archived: archiveView });
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
  }, [archiveView, user, viewAllPermission]);

  /* Pass slips have no approval queue, so this module never contributes a pending count. */
  const pendingCount = 0;

  const handleArchiveRecord = async (record, restore = false) => {
    const confirmAction = restore ? confirmRestoreRecord : confirmArchiveRecord;

    await confirmAction({
      module: "passSlip",
      id: record.id,
      noun: "pass slip",
      owner: record.employeeName,
      onArchived: () => loadRecords({ background: true }),
      onRestored: () => loadRecords({ background: true }),
    });
  };

  /*
   * Cached per employee record because the same slip is routinely previewed and then printed, and a
   * signature is a base64 image — refetching it on every open is a needless round trip. A failed or
   * empty lookup is cached as "" too, so an employee without a signature does not retry on each view.
   */
  const resolveSignature = useCallback(async (employeeRecordId) => {
    const cacheKey = String(employeeRecordId || "");

    if (!cacheKey || cacheKey === "0") {
      return "";
    }

    if (signatureCacheRef.current.has(cacheKey)) {
      return signatureCacheRef.current.get(cacheKey);
    }

    let signature = "";
    try {
      const result = await getEmployeeSignature(employeeRecordId);
      signature = String(result?.employee?.signatureDataUrl || "");
    } catch {
      signature = "";
    }

    signatureCacheRef.current.set(cacheKey, signature);
    return signature;
  }, []);

  const employeeOptions = useMemo(
    () =>
      employees
        .map((employee) => ({
          employeeRecordId: employee.id,
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          position: employee.position || "",
          division: employee.department || employee.division || "",
        }))
        .filter((employee) => employee.employeeRecordId && employee.employeeName)
        .filter((employee) => !(allowEmployeeSelection && matchesUserEmployeeOption(employee, user)))
        .sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
    [allowEmployeeSelection, employees, user]
  );

  /* The division table, not the divisions found on the employee list or the loaded slips. */
  const { divisions: divisionOptions } = useOrganizationFilterOptions();

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
        position: user?.position || "",
        division: user?.division || "",
      };
    }

    return null;
  }, [allowEmployeeSelection, employeeOptions, user]);

  // The hook reads its callback through a ref, so it will not refetch when `loadRecords` changes
  // identity — this effect does, which is what makes the archive toggle actually reload the table.
  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useAutoRefreshOnChange(loadRecords, { topic: "pass_slip", refreshOnMount: false });

  useEffect(() => {
    if (!loading) {
      onPendingCountChange?.(pendingCount);
    }
  }, [loading, onPendingCountChange, pendingCount]);

  useEffect(() => {
    const employeeRecordId = selectedRecord?.employeeRecordId;

    if (!employeeRecordId) {
      setSelectedSignature("");
      return undefined;
    }

    let active = true;
    setSelectedSignature("");

    resolveSignature(employeeRecordId).then((signature) => {
      if (active) {
        setSelectedSignature(signature);
      }
    });

    return () => {
      active = false;
    };
  }, [resolveSignature, selectedRecord?.employeeRecordId]);

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
      /*
       * The register never carries the viewer's own slips; "View My Pass Slips" carries only them.
       * The archive keeps every record, since the My view never shows archived rows.
       */
      if (canToggleMyView && !archiveView && isViewerRecord(record) !== myView) {
        return false;
      }

      const matchesSearch = !search || [
        record.employeeName,
        record.employeeId,
        getDivisionName(record.division),
        record.destination,
        record.purpose,
        record.reference,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));

      /* A division desk's list is its own division only; the API scopes it and this repeats the rule. */
      const matchesDivision = isDivisionScoped
        ? scopedDivision !== "" && getDivisionName(record.division).toLowerCase() === scopedDivision.toLowerCase()
        : !divisionFilter || getDivisionName(record.division) === divisionFilter;
      const matchesDate = !dateFilter || record.passDate === dateFilter;

      return matchesSearch && matchesDivision && matchesDate;
    });
  }, [archiveView, canToggleMyView, dateFilter, divisionFilter, isDivisionScoped, isViewerRecord, myView, query, records, scopedDivision]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, divisionFilter, dateFilter, rowsPerPage]);

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
      toast.success("Pass slip created successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to submit pass slip.");
    } finally {
      setSubmitting(false);
    }
  };

  /** Fold one updated record back into the table without a round trip for the whole list. */
  const replaceRecord = (updated) => {
    if (!updated) return;
    setRecords((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedRecord((current) => (current && current.id === updated.id ? updated : current));
  };

  /*
   * The one decision anybody makes about a filed slip: it will not be used, so retire its code. The
   * reason is optional on purpose -- somebody clearing a mistaken filing should not be made to
   * justify it -- but it rides along to the employee's notification when there is one.
   */
  const handleCancel = async (record) => {
    const { isConfirmed, value } = await Swal.fire({
      title: "Cancel Pass Slip?",
      text: `Cancel the pass slip for ${record.employeeName}?`,
      icon: "warning",
      input: "text",
      inputPlaceholder: "Reason (optional)",
      showCancelButton: true,
      confirmButtonText: "Yes, cancel it",
      cancelButtonText: "Keep it",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!isConfirmed) {
      return;
    }

    try {
      const result = await cancelPassSlip(record.id, value || "");
      replaceRecord(result.record);
      toast.success(result.message || "Pass slip cancelled.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to cancel the pass slip.");
    }
  };

  const handleOpenPreview = (record) => {
    setSelectedRecord(record);
  };

  /*
   * The signature has to be resolved *before* `printRecord` is set: the print effect grabs the hidden
   * sheet on the very next frame, so anything still in flight would be cloned into the print window
   * missing its signature. Both states settle in the same continuation, so React renders the sheet
   * once, already signed.
   */
  const handlePrintRecord = async (record) => {
    setPrintSignature(await resolveSignature(record.employeeRecordId));
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

  const filterGridClass = showDivisionControl
    ? "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_120px]"
    : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_120px]";

  /* One definition of what a row can do, used by the table and by the narrow-screen cards. */
  const renderRecordActions = (record) => {
    const status = normalizePassSlipStatus(record.status);
    const isOwnRecord = matchesUserRecordScope(record, user);
    /* A manager may delete someone else's slip, never their own. */
    const canDeleteRecord = showDeleteAction && managePermission && !isOwnRecord;
    /* Anyone whose desk lists an active slip may cancel it; employees can cancel only their own. */
    const canCancel = (isOwnRecord || viewAllPermission) && status === PASS_SLIP_STATUS.ACTIVE;

    if (archiveView) {
      return (
        <ViewFormActions viewLabel="View pass slip form" onView={() => handleOpenPreview(record)}>
          <ActionIconButton
            label="Print pass slip"
            icon={faPrint}
            tone="print"
            onClick={() => handlePrintRecord(record)}
          />
          <ActionIconButton
            label="Restore pass slip"
            icon={faRotateLeft}
            tone="restore"
            onClick={() => handleArchiveRecord(record, true)}
          />
        </ViewFormActions>
      );
    }

    return (
      <ViewFormActions viewLabel="View pass slip form" onView={() => handleOpenPreview(record)}>
        {canCancel ? (
          <ActionIconButton
            label="Cancel pass slip"
            icon={faBan}
            tone="cancel"
            onClick={() => handleCancel(record)}
          />
        ) : null}
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
        {canArchive ? (
          <ActionIconButton
            label="Archive pass slip"
            icon={faBoxArchive}
            tone="archive"
            onClick={() => handleArchiveRecord(record)}
          />
        ) : null}
      </ViewFormActions>
    );
  };

  /*
   * The open review follows the register. A gate scan reaches `records` through the live-update feed,
   * and the modal should show the Departure or Time Returned that just landed, not the snapshot it
   * was opened on.
   */
  const previewRecord = selectedRecord
    ? records.find((record) => record.id === selectedRecord.id) || selectedRecord
    : null;

  const tableHeaders = [
    "Employee",
    "Division",
    "Date",
    "Departure",
    "Time Returned",
    "Destination",
    "Actions",
  ];

  return (
    <div className="pass-slip-workspace space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">
              {archiveView
                ? "Archived Pass Slips"
                : myView
                  ? "My Pass Slips"
                  : title}
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {archiveView
                ? "Pass slips moved to archive. Restore one to put it back in the list."
                : myView
                  ? "View the pass slips filed under your employee account."
                  : description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canToggleMyView && !archiveView ? (
                  <button
                    type="button"
                    aria-pressed={myView}
                    onClick={() => {
                      setMyView((current) => !current);
                      setCurrentPage(1);
                    }}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
                      myView
                        ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <UserRound size={16} />
                    {myView ? "View All Pass Slips" : "View My Pass Slips"}
                  </button>
            ) : null}
            {canArchive ? (
                  <ArchiveViewToggle
                    archiveView={archiveView}
                    onToggle={(next) => {
                      setArchiveView(next);
                      setCurrentPage(1);
                    }}
                    label="pass slips"
                  />
            ) : null}
            {archiveView ? null : (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
                  >
                    <FilePenLine size={16} />
                    {submitLabel}
                  </button>
            )}
          </div>
        </div>

        <div className={filterGridClass}>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Pass Slips</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={viewAllPermission ? "Search employee, division, destination, reference" : "Search destination, purpose, reference"}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  />
                </span>
              </label>
              {showDivisionControl ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Division</span>
                  <select
                    value={isDivisionScoped ? "" : divisionFilter}
                    disabled={isDivisionScoped}
                    onChange={(event) => setDivisionFilter(event.target.value)}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
                  >
                    {isDivisionScoped ? (
                      <option value="">{scopedDivision || "No assigned division"}</option>
                    ) : (
                      <>
                        <option value="">All divisions</option>
                        {divisionOptions.map((division) => (
                          <option key={division} value={division}>
                            {division}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Pass Slip Date</span>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Rows Per Page</span>
                <select
                  value={rowsPerPage}
                  onChange={(event) => setRowsPerPage(event.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                >
                  <option value="10">10 rows</option>
                  <option value="20">20 rows</option>
                  <option value="50">50 rows</option>
                  <option value="100">100 rows</option>
                  <option value="200">200 rows</option>
                </select>
              </label>
            </div>

            {/* Cards below `lg`, table from `lg` up — see the note in `RecordCards`. */}
            <RecordCards
              className="mt-4 lg:hidden"
              items={paginatedRecords}
              loading={loading}
              loadingCards={3}
              empty={{
                icon: ClipboardList,
                title: myView ? "You have no pass slips yet" : "No pass slips found",
                description: myView ? "Pass slips you file will appear here." : "Create a pass slip or adjust the filters.",
              }}
              renderCard={(record) => ({
                title: record.destination,
                subtitle: formatDateDisplay(record.passDate),
                fields: [
                  { label: "Employee", value: record.employeeName },
                  { label: "Division", value: formatRecordDivision(record) },
                  { label: "Departure", value: record.timeOutDisplay || "—" },
                  { label: "Time Returned", value: record.timeInDisplay || "—" },
                ],
                actions: renderRecordActions(record),
              })}
            />

            <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full border-collapse">
                  <thead className="bg-slate-50">
                    <tr>
                      {tableHeaders.map((header) => (
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
                          <td colSpan={tableHeaders.length} className="px-3 py-3">
                            <div className="h-5 rounded bg-slate-200" />
                          </td>
                        </tr>
                      ))
                    ) : paginatedRecords.length === 0 ? (
                      <tr>
                        <td colSpan={tableHeaders.length} className="px-4 py-12 text-center">
                          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                            <ClipboardList size={20} />
                          </div>
                          <p className="m-0 mt-3 text-sm font-semibold text-slate-700">{myView ? "You have no pass slips yet" : "No pass slips found"}</p>
                          <p className="m-0 mt-1 text-sm text-slate-500">{myView ? "Pass slips you file will appear here." : "Create a pass slip or adjust the filters."}</p>
                        </td>
                      </tr>
                    ) : (
                      paginatedRecords.map((record) => (
                        <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                          <td className="px-3 py-3 text-sm text-slate-800">
                            <div className="font-semibold text-slate-900">{record.employeeName}</div>
                            <div className="text-xs text-slate-500">{record.employeeId || record.reference}</div>
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-600">{formatRecordDivision(record)}</td>
                          <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(record.passDate)}</td>
                          {/* Both stamped by scanning the slip's QR code at the gate, never typed. */}
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-600">{record.timeOutDisplay || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-600">{record.timeInDisplay || "—"}</td>
                          <td className="max-w-[200px] truncate px-3 py-3 text-sm text-slate-700">{record.destination}</td>
                          <td className="px-3 py-3">
                            {renderRecordActions(record)}
                          </td>
                        </tr>
                      ))
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
        <PassSlipFormSheet
          record={printRecord}
          contentRef={hiddenPrintRef}
          signatureDataUrl={printSignature}
        />
      </div>

      <PassSlipPreviewModal
        record={previewRecord}
        signatureDataUrl={selectedSignature}
        onClose={handleClosePreview}
      />
    </div>
  );
}
