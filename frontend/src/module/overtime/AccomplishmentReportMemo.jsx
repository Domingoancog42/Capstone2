import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Printer, Send, Undo2 } from "lucide-react";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import Button from "../../components/UI/button";
import Modal from "../../components/UI/modal";
import { getEmployeeSignature } from "../../services/api";
import { submitOvertimeAccomplishmentReport } from "../../services/overtimeService";
import { todayDateInputValue } from "../../utils/leaveHelpers";
import { formatSignatureTimestamp } from "../../utils/signatureTimestamp";

/*
 * The office's memorandum "Accomplishment Report of Task Rendered During Overtime", as the employee
 * fills it in and as the chief reads it. One paper component serves both: in editable mode the
 * details the employee supplies are inputs sitting in the memo where the words would go, so what is
 * being filled in is the memo itself rather than a form that later becomes one.
 *
 * Everything on the paper is inline-styled on purpose. Printing clones the node into a bare window
 * where the app stylesheet does not exist, so a class would print as nothing.
 */

export const DEFAULT_ACCOMPLISHMENT_LOCATION = "Office";

export const emptyAccomplishmentForm = {
  timeStart: "",
  timeEnd: "",
  location: DEFAULT_ACCOMPLISHMENT_LOCATION,
  tasks: "",
  outputs: "",
};

const memoStyles = {
  page: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "11px",
    lineHeight: 1.5,
    color: "#111111",
    width: "100%",
    maxWidth: "700px",
    margin: "0 auto",
    background: "#ffffff",
    boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
    padding: "24px 44px 28px",
    boxSizing: "border-box",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "96px minmax(0, 1fr) 104px",
    alignItems: "center",
    gap: "10px",
  },
  logo: {
    width: "96px",
    height: "96px",
    objectFit: "contain",
    display: "block",
  },
  seal: {
    width: "104px",
    height: "96px",
    objectFit: "contain",
    display: "block",
    justifySelf: "end",
  },
  headerLine: { margin: 0, fontSize: "9.5px", lineHeight: 1.35 },
  headerAgency: { margin: 0, fontSize: "12px", fontWeight: "bold", color: "#b91c1c", lineHeight: 1.35 },
  headerOffice: { margin: 0, fontSize: "10px", fontWeight: "bold", color: "#b91c1c", lineHeight: 1.35 },
  headerContact: { margin: 0, fontSize: "8px", lineHeight: 1.35 },
  rule: {
    border: "none",
    borderTop: "1.5px solid #111111",
    margin: "8px 0 14px",
  },
  memoDate: { textAlign: "right", margin: "0 0 14px" },
  memoTitle: { margin: "0 0 12px", fontSize: "12px", fontWeight: "bold", letterSpacing: "0.5px" },
  addressRow: {
    display: "grid",
    gridTemplateColumns: "88px 14px minmax(0, 1fr)",
    alignItems: "start",
    marginBottom: "8px",
  },
  addressIndentRow: {
    display: "grid",
    gridTemplateColumns: "88px 14px minmax(0, 1fr)",
    alignItems: "start",
    marginBottom: "8px",
    paddingLeft: "32px",
  },
  addressLabel: { fontWeight: "bold" },
  paragraph: { margin: "0 0 10px", textAlign: "justify" },
  details: { margin: "0 0 10px 28px" },
  detailLabel: { fontWeight: "bold", margin: "8px 0 0" },
  detailLine: { margin: "0 0 2px" },
  bullets: { margin: "2px 0 0", paddingLeft: "22px" },
  inlineInput: {
    fontFamily: "inherit",
    fontSize: "11px",
    color: "#111111",
    border: "none",
    borderBottom: "1px solid #111111",
    borderRadius: 0,
    background: "#fffbeb",
    padding: "1px 4px",
    outline: "none",
  },
  blockInput: {
    fontFamily: "inherit",
    fontSize: "11px",
    lineHeight: 1.5,
    color: "#111111",
    width: "100%",
    minHeight: "56px",
    border: "1px solid #94a3b8",
    borderRadius: "4px",
    background: "#fffbeb",
    padding: "4px 6px",
    outline: "none",
    resize: "vertical",
    boxSizing: "border-box",
  },
  fieldError: { margin: "2px 0 0", color: "#b91c1c", fontSize: "9.5px" },
  signatory: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    marginTop: "18px",
    marginRight: "8px",
  },
  signatureImage: { maxWidth: "150px", maxHeight: "42px", objectFit: "contain", display: "block" },
  signatureTimestamp: { fontSize: "8.5px", fontStyle: "italic", fontWeight: "bold", margin: "0 0 2px" },
  signatoryName: { fontWeight: "bold", minWidth: "200px", textAlign: "center" },
  notedBy: { marginTop: "26px" },
  notedBlock: { marginTop: "16px", width: "230px" },
  notedSignature: {
    minHeight: "44px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "2px",
  },
  notedName: { fontWeight: "bold", textAlign: "center", minHeight: "13px" },
  notedLine: { borderTop: "1px solid #111111", marginTop: "1px" },
  notedCaption: { fontSize: "9.5px", textAlign: "center", margin: "2px 0 0" },
  footer: {
    marginTop: "34px",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 64px",
    alignItems: "center",
    gap: "10px",
    borderTop: "1px solid #cbd5e1",
    paddingTop: "8px",
  },
  footerSlogan: { fontSize: "8.5px", fontStyle: "italic", textAlign: "center", margin: 0, lineHeight: 1.4 },
  footerBadge: {
    fontSize: "7.5px",
    fontWeight: "bold",
    textAlign: "center",
    border: "1px solid #111111",
    borderRadius: "4px",
    padding: "4px 2px",
    lineHeight: 1.3,
  },
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const date = new Date(DATE_ONLY.test(text) ? `${text}T00:00:00` : text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "March 7, 2026" — the way the office writes a date on a memo. */
export function formatMemoLongDate(value) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date)
    : "";
}

/** "8:16am" from a stored "08:16:00" or an input's "08:16". */
export function formatMemoTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!match) {
    return "";
  }
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "pm" : "am";
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelveHour}:${match[2]}${suffix}`;
}

/** Minutes between two "HH:MM" values, or null when either is missing or the order is wrong. */
export function minutesBetween(start, end) {
  const parse = (value) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const from = parse(start);
  const to = parse(end);
  if (from === null || to === null || to <= from) {
    return null;
  }
  return to - from;
}

export function formatMinutesAsHours(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

/** One task per line, with any bullet the writer typed stripped so the memo prints a single one. */
export function splitTaskLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•\-*–—]+/, "").trim())
    .filter(Boolean);
}

export function formatAccomplishmentStatusLabel(report) {
  const status = String(report?.status || "Pending");
  if (status === "Approved") {
    return "Noted by Chief";
  }
  if (status === "Rejected") {
    return "Returned by Chief";
  }
  return "Pending by Chief";
}

function MemoRow({ label, indent = false, children }) {
  return (
    <div style={indent ? memoStyles.addressIndentRow : memoStyles.addressRow}>
      <span style={memoStyles.addressLabel}>{label}</span>
      <span>:</span>
      <div>{children}</div>
    </div>
  );
}

/**
 * The memo. `values` are the details that vary per report; in editable mode they come from the
 * form state and `onChange(field, value)` writes them back.
 */
export function AccomplishmentMemoPaper({
  employeeName = "",
  division = "",
  workDate = "",
  memoDate = "",
  values = emptyAccomplishmentForm,
  editable = false,
  errors = {},
  onChange,
  employeeSignature = "",
  submittedAt = "",
  notedByName = "",
  notedAt = "",
  chiefSignature = "",
  paperRef,
}) {
  const tasks = editable ? [] : splitTaskLines(values.tasks);
  const attentionLine = division ? `The Chief, ${division}` : "The Chief of Division";
  const submittedLabel = submittedAt ? formatSignatureTimestamp(submittedAt) : "";
  const notedLabel = notedAt ? formatSignatureTimestamp(notedAt) : "";
  const setField = (field) => (event) => onChange?.(field, event.target.value);

  return (
    <div ref={paperRef} className="overtime-accomplishment-memo" style={memoStyles.page}>
      <div style={memoStyles.header}>
        <img src="/mgb.png" alt="MGB Logo" style={memoStyles.logo} />
        <div>
          <p style={memoStyles.headerLine}>Republic of the Philippines</p>
          <p style={memoStyles.headerLine}>Department of Environment and Natural Resources</p>
          <p style={memoStyles.headerAgency}>MINES AND GEOSCIENCES BUREAU</p>
          <p style={memoStyles.headerOffice}>Regional Office No. X</p>
          <p style={memoStyles.headerContact}>DENR-X Compound, Puntod, Cagayan de Oro City</p>
          <p style={memoStyles.headerContact}>
            Telefax No.: (088) 856-2110; (088) 856-1331; Email: region10@mgb.gov.ph
          </p>
        </div>
        <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={memoStyles.seal} />
      </div>

      <hr style={memoStyles.rule} />

      <p style={memoStyles.memoDate}>{formatMemoLongDate(memoDate) || " "}</p>

      <p style={memoStyles.memoTitle}>MEMORANDUM</p>

      <MemoRow label="FOR">
        <div>The Regional Director</div>
        <div>This Office</div>
      </MemoRow>
      <MemoRow label="Attention" indent>
        <div>{attentionLine}</div>
        <div>This Office</div>
      </MemoRow>
      <MemoRow label="FROM">
        <div>{employeeName || " "}</div>
        <div>This Office</div>
      </MemoRow>
      <MemoRow label="SUBJECT">
        <div style={{ fontWeight: "bold" }}>ACCOMPLISHMENT REPORT OF TASK RENDERED DURING OVERTIME</div>
      </MemoRow>

      <p style={{ ...memoStyles.paragraph, marginTop: "6px" }}>
        In compliance with agency policies on work offsetting/Compensatory Service Day off/Compensatory
        Time Off, submitted is this memorandum to report the accomplishment of work rendered beyond
        regular office hours.
      </p>

      <p style={memoStyles.paragraph}>Below are the details of the task completed during overtime:</p>

      <div style={memoStyles.details}>
        <p style={{ ...memoStyles.detailLabel, marginTop: 0 }}>Date/s of Overtime:</p>
        <p style={memoStyles.detailLine}>
          Time: {formatMemoLongDate(workDate) || " "} (
          {editable ? (
            <>
              <input
                type="time"
                aria-label="Overtime start time"
                value={values.timeStart}
                onChange={setField("timeStart")}
                style={memoStyles.inlineInput}
                required
              />
              {" – "}
              <input
                type="time"
                aria-label="Overtime end time"
                value={values.timeEnd}
                onChange={setField("timeEnd")}
                style={memoStyles.inlineInput}
                required
              />
            </>
          ) : (
            `${formatMemoTime(values.timeStart)} – ${formatMemoTime(values.timeEnd)}`
          )}
          )
        </p>
        {editable && errors.time ? <p style={memoStyles.fieldError}>{errors.time}</p> : null}
        <p style={memoStyles.detailLine}>
          Location:{" "}
          {editable ? (
            <input
              type="text"
              aria-label="Location"
              value={values.location}
              onChange={setField("location")}
              maxLength={120}
              placeholder={DEFAULT_ACCOMPLISHMENT_LOCATION}
              style={{ ...memoStyles.inlineInput, minWidth: "160px" }}
            />
          ) : (
            values.location || DEFAULT_ACCOMPLISHMENT_LOCATION
          )}
        </p>

        <p style={memoStyles.detailLabel}>
          Task Performed: <span style={{ fontWeight: "normal", fontStyle: "italic" }}>(bullet type)</span>
        </p>
        {editable ? (
          <>
            <textarea
              aria-label="Tasks performed"
              value={values.tasks}
              onChange={setField("tasks")}
              placeholder={"One task per line, e.g.\nWeb development on the MGBX Portal — DTR and biometrics attendance"}
              style={memoStyles.blockInput}
              rows={3}
              required
            />
            {errors.tasks ? <p style={memoStyles.fieldError}>{errors.tasks}</p> : null}
          </>
        ) : (
          <ul style={memoStyles.bullets}>
            {tasks.map((task, index) => (
              <li key={`${index}-${task}`}>{task}</li>
            ))}
          </ul>
        )}

        <p style={memoStyles.detailLabel}>Output/s Delivered:</p>
        {editable ? (
          <>
            <textarea
              aria-label="Outputs delivered"
              value={values.outputs}
              onChange={setField("outputs")}
              placeholder="What the overtime produced, e.g. Functional attendance and payroll features added to the MGBX Portal"
              style={{ ...memoStyles.blockInput, minHeight: "44px" }}
              rows={2}
              required
            />
            {errors.outputs ? <p style={memoStyles.fieldError}>{errors.outputs}</p> : null}
          </>
        ) : (
          <p style={{ ...memoStyles.detailLine, fontStyle: "italic", whiteSpace: "pre-wrap" }}>{values.outputs}</p>
        )}
      </div>

      <p style={memoStyles.paragraph}>
        This is submitted for your information and appropriate action in support of CTO/CDO application.
      </p>

      <div style={memoStyles.signatory}>
        {employeeSignature ? (
          <img src={employeeSignature} alt={`${employeeName || "Employee"} signature`} style={memoStyles.signatureImage} />
        ) : null}
        {submittedLabel ? <p style={memoStyles.signatureTimestamp}>Submitted: {submittedLabel}</p> : null}
        <div style={memoStyles.signatoryName}>{employeeName || " "}</div>
      </div>

      <p style={{ ...memoStyles.notedBy, margin: "26px 0 0" }}>Noted by:</p>
      <div style={memoStyles.notedBlock}>
        <div style={memoStyles.notedSignature}>
          {notedByName && chiefSignature ? (
            <img src={chiefSignature} alt={`${notedByName} signature`} style={memoStyles.signatureImage} />
          ) : null}
          {notedByName && notedLabel ? <p style={memoStyles.signatureTimestamp}>Noted: {notedLabel}</p> : null}
        </div>
        <div style={memoStyles.notedName}>{notedByName || " "}</div>
        <div style={memoStyles.notedLine} />
        <p style={memoStyles.notedCaption}>
          Printed Name and Signature of
          <br />
          Division Chief/Supervisor
        </p>
      </div>

      <div style={memoStyles.footer}>
        <p style={memoStyles.footerSlogan}>
          "MINING SHALL BE PRO-PEOPLE AND PRO-ENVIRONMENT
          <br />
          IN SUSTAINING WEALTH CREATION AND IMPROVED QUALITY OF LIFE"
        </p>
        <div style={memoStyles.footerBadge}>
          ISO 9001:2015
          <br />
          Certified
        </div>
      </div>
    </div>
  );
}

/** Clones the paper into a bare window and prints it; the inline styles carry the layout across. */
export function printAccomplishmentMemo(node) {
  if (!node) {
    return;
  }

  const printWindow = window.open("", "_blank", "width=960,height=1200");
  if (!printWindow) {
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Accomplishment Report of Task Rendered During Overtime</title>
        <style>
          @page { size: auto; margin: 10mm; }
          html, body { margin: 0; padding: 0; background: #ffffff; }
          body { font-family: Arial, sans-serif; color: #000000; }
          *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-shell { width: 100%; max-width: 190mm; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="print-shell">${node.outerHTML}</div>
      </body>
    </html>
  `);
  printWindow.document.close();

  const paper = printWindow.document.querySelector(".print-shell > div");
  if (paper) {
    paper.style.maxWidth = "190mm";
    paper.style.boxShadow = "none";
  }

  const finish = () => {
    printWindow.focus();
    printWindow.print();
    printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
  };

  const images = Array.from(printWindow.document.images || []);
  Promise.all(images.map((image) => (
    image.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      })
  ))).then(() => window.setTimeout(finish, 150));
}

function useEmployeeSignature(employeeRecordId) {
  const [signature, setSignature] = useState("");

  useEffect(() => {
    let mounted = true;
    setSignature("");

    if (!(Number(employeeRecordId) > 0)) {
      return () => {
        mounted = false;
      };
    }

    getEmployeeSignature(employeeRecordId)
      .then((result) => {
        if (mounted) {
          setSignature(String(result?.employee?.signatureDataUrl || ""));
        }
      })
      .catch(() => {
        if (mounted) {
          setSignature("");
        }
      });

    return () => {
      mounted = false;
    };
  }, [employeeRecordId]);

  return signature;
}

function formatApprovedHours(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

/** Whether the overtime request carries the memo's details; requests filed before they were asked for do not. */
function hasFilingDetails(overtime) {
  return Boolean(overtime?.timeStart && overtime?.timeEnd);
}

/**
 * Whether the request carries every detail the memo needs. Such a memo is shown read-only -- it is
 * the request's own details, to review rather than rewrite -- and overtime.php files the report from
 * the request itself on the same test (overtime_accomplishment_values_from_filing).
 */
function isFilingComplete(overtime) {
  return minutesBetween(overtime?.timeStart, overtime?.timeEnd) !== null
    && splitTaskLines(overtime?.reason).length > 0
    && String(overtime?.expectedOutputs || "").trim() !== "";
}

/**
 * What the memo opens with. A returned memo comes back as it was sent, for revising. A first one is
 * filled in from the overtime request -- its window, location, tasks (the reason, one per line) and
 * expected output -- so the employee checks it against what was actually done instead of typing it.
 */
function buildAccomplishmentFormValues(overtime, previousReport) {
  if (previousReport) {
    return {
      timeStart: String(previousReport.timeStart || "").slice(0, 5),
      timeEnd: String(previousReport.timeEnd || "").slice(0, 5),
      location: previousReport.location || DEFAULT_ACCOMPLISHMENT_LOCATION,
      tasks: (previousReport.tasks || []).join("\n"),
      outputs: previousReport.outputsDelivered || "",
    };
  }

  if (hasFilingDetails(overtime)) {
    return {
      timeStart: String(overtime.timeStart).slice(0, 5),
      timeEnd: String(overtime.timeEnd).slice(0, 5),
      location: overtime.location || DEFAULT_ACCOMPLISHMENT_LOCATION,
      tasks: splitTaskLines(overtime.reason).join("\n"),
      outputs: overtime.expectedOutputs || "",
    };
  }

  return emptyAccomplishmentForm;
}

/**
 * The floating card the employee gets from "Submit Report": first a note of which overtime this
 * accounts for, then the memo -- shown read-only when the request carries every detail, since it is
 * then just those details to review and submit, and to fill in otherwise. `previousReport` is the
 * returned memo being revised, so its wording comes back for editing along with the chief's remarks.
 */
/*
 * Both memo windows float the way the Leave Request Form preview does: a wide rounded sheet over a
 * blurred page, the paper centred on grey. `leave-form-preview` keeps the sheet white in dark mode,
 * because the memo is a printed form and reads as one.
 */
const memoOverlayProps = {
  maxWidth: "max-w-5xl",
  panelClassName: "leave-form-preview !rounded-[28px]",
  backdropClassName: "backdrop-blur-sm",
  contentClassName: "bg-slate-100",
};

export function AccomplishmentReportFormModal({
  open,
  overtime,
  previousReport = null,
  onClose,
  onSubmitted,
}) {
  const [form, setForm] = useState(emptyAccomplishmentForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const employeeSignature = useEmployeeSignature(open ? overtime?.employeeRecordId : 0);

  /* Both props are the snapshot the workspace took on opening, so this runs once per window. */
  useEffect(() => {
    if (!open) {
      return;
    }
    setErrors({});
    setForm(buildAccomplishmentFormValues(overtime, previousReport));
  }, [open, overtime, previousReport]);

  const renderedMinutes = minutesBetween(form.timeStart, form.timeEnd);
  const memoDate = useMemo(() => todayDateInputValue(), []);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field === "timeStart" || field === "timeEnd" ? "time" : field]: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!overtime || saving) {
      return;
    }

    const tasks = splitTaskLines(form.tasks);
    const nextErrors = {};
    if (!form.timeStart || !form.timeEnd) {
      nextErrors.time = "Enter the time the overtime started and ended.";
    } else if (renderedMinutes === null) {
      nextErrors.time = "The end time must be later than the start time.";
    }
    if (tasks.length === 0) {
      nextErrors.tasks = "List at least one task performed.";
    }
    if (!form.outputs.trim()) {
      nextErrors.outputs = "Describe the output delivered.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      const result = await submitOvertimeAccomplishmentReport({
        overtimeId: overtime.id,
        timeStart: form.timeStart,
        timeEnd: form.timeEnd,
        location: form.location.trim() || DEFAULT_ACCOMPLISHMENT_LOCATION,
        tasks,
        outputs: form.outputs.trim(),
      });
      toast.success(result?.message || "Accomplishment report submitted to the division chief.");
      onSubmitted?.(result?.record || null);
      onClose?.();
    } catch (error) {
      const message = error?.response?.data?.message || "Unable to submit the accomplishment report.";
      toast.error(message);
      await Swal.fire({
        title: "Submission Failed",
        text: message,
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setSaving(false);
    }
  };

  const isRevision = previousReport && String(previousReport.status) === "Rejected";
  /* A returned memo is revised by hand: the chief sent it back to be changed. */
  const memoFromRequest = !previousReport && isFilingComplete(overtime);

  return (
    <Modal
      open={open && Boolean(overtime)}
      {...memoOverlayProps}
      title={isRevision ? "Revise Accomplishment Report" : "Submit Accomplishment Report"}
      description={memoFromRequest
        ? "Generated from your approved overtime request. Review it and submit it to your Division Chief."
        : "Fill in the memorandum below and submit it to your Division Chief."}
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="accomplishmentReportForm" icon={Send} loading={saving}>
            {isRevision ? "Resubmit to Division Chief" : "Submit to Division Chief"}
          </Button>
        </>
      }
    >
      {overtime ? (
        <form id="accomplishmentReportForm" onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <section
            className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900"
            aria-label="Overtime rendered"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-teal-700 shadow-sm">
                <CalendarCheck size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="m-0 font-semibold">
                  This report is for the overtime rendered on {formatMemoLongDate(overtime.workDate || overtime.overtimeDate)}
                </p>
                <dl className="m-0 mt-1 grid gap-x-6 gap-y-0.5 text-xs text-teal-800 sm:grid-cols-2">
                  <div className="flex gap-1.5">
                    <dt className="font-semibold">Approved hours:</dt>
                    <dd className="m-0">{formatApprovedHours(overtime.hourRequested ?? overtime.hoursWorked)} hrs</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="font-semibold">Approved by:</dt>
                    <dd className="m-0">
                      {overtime.approvedBy || "Regional Director"}
                      {overtime.approvedAt ? ` on ${formatMemoLongDate(overtime.approvedAt)}` : ""}
                    </dd>
                  </div>
                  <div className="flex gap-1.5 sm:col-span-2">
                    <dt className="font-semibold">Reason filed:</dt>
                    <dd className="m-0 whitespace-pre-line">{overtime.reason || "No reason provided"}</dd>
                  </div>
                </dl>
                <p className="m-0 mt-2 text-xs text-teal-800">
                  {memoFromRequest
                    ? "The memorandum below is generated from your approved overtime request, so there is nothing to fill in. Review it, then submit it."
                    : "Fill in the time rendered, the tasks and the output on the memorandum below."}
                  {" "}It goes to your Division Chief for noting and supports your CTO/CDO application.
                </p>
                {renderedMinutes !== null ? (
                  <p className="m-0 mt-1 text-xs font-semibold text-teal-900">
                    Time rendered: {formatMinutesAsHours(renderedMinutes)}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {isRevision ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="m-0 font-semibold">
                Returned by {previousReport.notedBy || "the Division Chief"}
                {previousReport.notedAt ? ` on ${formatSignatureTimestamp(previousReport.notedAt)}` : ""}
              </p>
              <p className="m-0 mt-1 whitespace-pre-wrap">{previousReport.remarks || "No remarks were given."}</p>
            </section>
          ) : null}

          <div className="overflow-x-auto py-1">
            <AccomplishmentMemoPaper
              editable={!memoFromRequest}
              employeeName={overtime.employeeName}
              division={overtime.division}
              workDate={overtime.workDate || overtime.overtimeDate}
              memoDate={memoDate}
              values={form}
              errors={errors}
              onChange={updateField}
              employeeSignature={employeeSignature}
            />
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

/**
 * The memo as filed, for anyone allowed to see it. The chief's desk gets Note / Return here as well,
 * so the decision is made on the memo itself rather than from a table row.
 */
export function AccomplishmentReportPreviewModal({
  report,
  canDecide = false,
  busy = false,
  onClose,
  onNote,
  onReturn,
}) {
  const paperRef = useRef(null);
  const employeeSignature = useEmployeeSignature(report?.employeeRecordId);
  const chiefSignature = useEmployeeSignature(
    report && String(report.status) === "Approved" ? report.notedByEmployeeRecordId : 0
  );
  const status = String(report?.status || "Pending");
  const isPending = status === "Pending";
  const noted = status === "Approved";

  const banner = !report ? null : noted ? (
    <p className="m-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
      Noted by <span className="font-semibold">{report.notedBy || "the Division Chief"}</span>
      {report.notedAt ? ` on ${formatSignatureTimestamp(report.notedAt)}` : ""}.
    </p>
  ) : status === "Rejected" ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
      <p className="m-0 font-semibold">
        Returned by {report.notedBy || "the Division Chief"}
        {report.notedAt ? ` on ${formatSignatureTimestamp(report.notedAt)}` : ""}
      </p>
      <p className="m-0 mt-1 whitespace-pre-wrap">{report.remarks || "No remarks were given."}</p>
    </div>
  ) : (
    <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
      Waiting for the Division Chief to note this report.
    </p>
  );

  return (
    <Modal
      {...memoOverlayProps}
      open={Boolean(report)}
      title="Accomplishment Report"
      description="Centered overlay preview of the submitted accomplishment report."
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" icon={Printer} onClick={() => printAccomplishmentMemo(paperRef.current)} disabled={busy}>
            Print
          </Button>
          {canDecide && isPending ? (
            <>
              <Button variant="danger" icon={Undo2} onClick={() => onReturn?.(report)} disabled={busy}>
                Return
              </Button>
              <Button variant="success" icon={CalendarCheck} onClick={() => onNote?.(report)} loading={busy}>
                Note Report
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          )}
        </>
      }
    >
      {report ? (
        <div className="grid gap-4">
          {banner}
          <div className="overflow-x-auto py-1">
            <AccomplishmentMemoPaper
              paperRef={paperRef}
              employeeName={report.employeeName}
              division={report.division}
              workDate={report.workDate}
              memoDate={report.reportDate}
              values={{
                timeStart: report.timeStart,
                timeEnd: report.timeEnd,
                location: report.location,
                tasks: (report.tasks || []).join("\n"),
                outputs: report.outputsDelivered,
              }}
              employeeSignature={employeeSignature}
              submittedAt={report.createdAt}
              notedByName={noted ? report.notedBy : ""}
              notedAt={noted ? report.notedAt : ""}
              chiefSignature={chiefSignature}
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
