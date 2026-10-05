import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import FormQrCode from "../UI/FormQrCode";
import useAutoPrint from "../../hooks/useAutoPrint";
import { CSC_FORM_LEAVE_TYPES, mergeCscLeaveTypes } from "../../data/leaveTypes";
import { formatSignatureTimestamp } from "../../utils/signatureTimestamp";
import {
  buildLeaveMonetizationQrPayload,
  buildLeaveMonetizationReference,
} from "../../utils/formQrCode";
import { getCurrentEmployeeSignature, getEmployeeSignature } from "../../services/api";
import { fetchLeaveCredits, fetchLeaveTypes } from "../../services/leaveService";
import { fetchLeaveMonetizationById } from "../../services/leaveMonetizationService";
import { currencyFormatter } from "../../utils/format";
import { splitEmployeeName } from "../../utils/employeeName";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function toDateInputValue(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSalary(record) {
  const amount = Number(record?.basicSalary);
  if (!amount) {
    return "";
  }

  const formatted = currencyFormatter.format(amount);
  return record?.salaryRate ? `${formatted} / ${record.salaryRate}` : formatted;
}

function formatCreditValue(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "";
  }

  return Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(2).replace(/\.?0+$/, "");
}

function buildCreditRow(balance, monetizedDays, appliesToRecord, isApproved) {
  const total = Number(balance?.total ?? 0);
  const remaining = Number(balance?.remaining ?? 0);

  /*
   * 7.A certifies the credits this filing draws from, so only the monetized credit's column is
   * filled -- the same rule the leave request form follows. Printing the other balance would put a
   * number on the certification that no one signed off on and that this filing never touches.
   */
  if (!appliesToRecord) {
    return {
      earned: "",
      less: "",
      balance: "",
    };
  }

  // Approved monetization is already deducted from the earned credits, so the
  // pre-deduction total is restored to keep the certification readable.
  return {
    earned: formatCreditValue(isApproved ? total + monetizedDays : total),
    less: formatCreditValue(monetizedDays),
    balance: formatCreditValue(isApproved ? remaining : Math.max(0, remaining - monetizedDays)),
  };
}

function buildFormData(record, leaveCreditSnapshot = null, availableLeaveTypes = CSC_FORM_LEAVE_TYPES) {
  const nameParts = splitEmployeeName(record?.employeeName || "");
  const monetizedDays = Number(record?.numberOfDays || 0);
  const normalizedStatus = normalizeText(record?.status);
  const isApproved = normalizedStatus === "approved";
  const isRejected = normalizedStatus === "rejected";
  const rejectedNote = String(record?.rejectedNote || "").trim();
  const leaveCreditsMap = leaveCreditSnapshot?.balanceMap || {};
  const monetizedLeaveType = String(record?.leaveType || "");
  const vacationCredits = leaveCreditsMap["Vacation Leave"] || null;
  const sickCredits = leaveCreditsMap["Sick Leave"] || null;
  const isVacationMonetization = normalizeText(monetizedLeaveType) === "vacation leave";
  const isSickMonetization = normalizeText(monetizedLeaveType) === "sick leave";
  const vacationRow = buildCreditRow(vacationCredits, monetizedDays, isVacationMonetization, isApproved);
  const sickRow = buildCreditRow(sickCredits, monetizedDays, isSickMonetization, isApproved);
  const estimatedAmount = Number(record?.estimatedAmount || 0);

  return {
    office: record?.division || "",
    lastName: nameParts.lastName,
    firstName: nameParts.firstName,
    middleName: nameParts.middleName,
    applicantName: record?.employeeName || "",
    dateOfFiling: toDateInputValue(record?.dateFiled),
    position: record?.position || "",
    salary: formatSalary(record),
    leaveType: availableLeaveTypes.find((type) => normalizeText(type) === normalizeText(monetizedLeaveType)) || "",
    leaveTypeOther: "",
    leaveDetailWomen: "",
    numberOfDays: formatCreditValue(monetizedDays),
    inclusiveDates: "N/A - Monetization of Leave Credits",
    purpose: String(record?.reason || ""),
    creditsAsOf: leaveCreditSnapshot?.creditsAsOf ? toDateInputValue(leaveCreditSnapshot.creditsAsOf) : "",
    vlEarned: vacationRow.earned,
    vlLess: vacationRow.less,
    vlBalance: vacationRow.balance,
    slEarned: sickRow.earned,
    slLess: sickRow.less,
    slBalance: sickRow.balance,
    recommendation: isRejected ? "disapproved" : (isApproved ? "approved" : ""),
    disapprovalReason: isRejected ? rejectedNote : "",
    approvedDaysPay: isApproved ? formatCreditValue(monetizedDays) : "",
    approvedDaysNoPay: "",
    approvedOthers: isApproved && estimatedAmount > 0
      ? `Monetization - ${currencyFormatter.format(estimatedAmount)}`
      : (isApproved ? "Monetization of Leave Credits" : ""),
    disapprovedReason: isRejected ? rejectedNote : "",
  };
}

const styles = {
  wrap: {
    fontFamily: "Arial, sans-serif",
    fontSize: "11px",
    width: "100%",
    maxWidth: "860px",
    margin: 0,
    background: "#fff",
    border: "2px solid #000",
    boxShadow: "0 25px 60px rgba(15, 23, 42, 0.25)",
  },
  topBar: {
    background: "#e5e5e5",
    padding: "8px 12px",
    borderBottom: "1px solid #999",
    fontSize: "10px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "20px",
    padding: "12px",
    borderBottom: "2px solid #000",
    textAlign: "center",
  },
  logoImage: {
    width: "65px",
    height: "65px",
    objectFit: "contain",
    flexShrink: 0,
  },
  formTitle: {
    marginTop: "8px",
    fontSize: "17px",
    fontWeight: "bold",
    textDecoration: "underline",
  },
  row: {
    display: "flex",
    width: "100%",
    borderBottom: "1px solid #000",
  },
  cell: {
    padding: "6px 8px",
    borderRight: "1px solid #000",
    boxSizing: "border-box",
  },
  label: {
    fontWeight: "bold",
    display: "block",
    marginBottom: "4px",
    fontSize: "9px",
    textTransform: "uppercase",
  },
  sectionTitle: {
    background: "#f2f2f2",
    textAlign: "center",
    fontWeight: "bold",
    padding: "5px",
    borderBottom: "1px solid #000",
  },
  input: {
    border: "none",
    borderBottom: "1px solid #aaa",
    outline: "none",
    fontSize: "11px",
    fontWeight: "bold",
    textTransform: "uppercase",
    width: "100%",
    background: "transparent",
    color: "#111827",
  },
  checklistItem: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    marginBottom: "4px",
    fontSize: "11px",
  },
  subLabel: {
    fontStyle: "italic",
    margin: "8px 0 4px",
    fontWeight: "bold",
    fontSize: "10px",
  },
  creditsTable: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "5px",
  },
  sigLine: {
    borderTop: "1px solid #000",
    width: "85%",
    margin: "5px auto 0",
    fontWeight: "bold",
    fontSize: "10px",
    textAlign: "center",
    paddingTop: "2px",
  },
  signaturePreview: {
    minHeight: "40px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    marginBottom: "0",
  },
  signatureImage: {
    maxWidth: "170px",
    maxHeight: "44px",
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
  signatureCaption: {
    textAlign: "center",
    fontSize: "10px",
    marginTop: "2px",
  },
  signatureName: {
    width: "85%",
    margin: "0 auto",
    fontWeight: "bold",
    fontSize: "10px",
    textAlign: "center",
    minHeight: "12px",
  },
  signatureUnderline: {
    width: "85%",
    margin: "1px auto 0",
    borderTop: "1px solid #000",
  },
  qrFooter: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    gap: "10px",
    borderTop: "1px solid #000",
    padding: "6px 8px",
  },
  qrFooterNote: {
    fontSize: "8px",
    lineHeight: 1.4,
    color: "#334155",
    textAlign: "left",
    maxWidth: "300px",
    alignSelf: "center",
    marginRight: "auto",
  },
};

const tdStyle = {
  border: "1px solid #000",
  padding: "4px",
  textAlign: "center",
  fontSize: "10px",
};

const inputWithoutUnderlineStyle = {
  ...styles.input,
  borderBottom: "none",
};

function ReadOnlyInput(props) {
  return <input {...props} readOnly />;
}

function SelectionIndicator({ checked = false }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      aria-hidden="true"
      tabIndex={-1}
      style={{
        width: "13px",
        height: "13px",
        margin: 0,
        flexShrink: 0,
        accentColor: "#111827",
        pointerEvents: "none",
      }}
    />
  );
}

function SignatureBlock({
  signatureDataUrl = "",
  fallbackText = "",
  name = "",
  caption = "",
}) {
  return (
    <div style={{ marginTop: "20px", textAlign: "center" }}>
      <div style={styles.signaturePreview}>
        {signatureDataUrl ? (
          <>
            <img
              src={signatureDataUrl}
              alt={`${name || "Authorized"} signature`}
              style={styles.signatureImage}
            />
            {fallbackText ? (
              <div style={styles.signatureTimestamp}>{fallbackText}</div>
            ) : null}
          </>
        ) : fallbackText ? (
          <div style={styles.signatureTimestamp}>{fallbackText}</div>
        ) : null}
      </div>
      <div style={styles.signatureName}>{name}</div>
      <div style={styles.signatureUnderline} />
      <div style={styles.signatureCaption}>{caption}</div>
    </div>
  );
}

export default function LeaveMonetizationFormModal({
  open = false,
  record = null,
  reviewer = null,
  showHrmoReviewerSignature = false,
  showRegionalDirectorApproverSignature = false,
  autoPrint = false,
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [resolvedRecord, setResolvedRecord] = useState(record);
  const [employeeSignature, setEmployeeSignature] = useState("");
  const [reviewerSignature, setReviewerSignature] = useState("");
  const [savedHrmoSignature, setSavedHrmoSignature] = useState("");
  const [savedRegionalDirectorSignature, setSavedRegionalDirectorSignature] = useState("");
  const [leaveCredits, setLeaveCredits] = useState(null);
  const [configuredLeaveTypes, setConfiguredLeaveTypes] = useState([]);
  const printRef = useRef(null);
  /*
   * Opened from the Print action in the table rather than by a reader: print the form once every
   * load below has landed, then hand back to the caller so the sheet does not linger on screen.
   * `handlePrint` is only called from inside the frame callback, well after it is initialised.
   */
  const trackLoad = useAutoPrint({
    active: open && autoPrint,
    onPrint: () => handlePrint(),
    onDone: onClose,
  });

  useEffect(() => {
    if (!open) {
      setVisible(false);
      setResolvedRecord(record);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open, record]);

  useEffect(() => {
    let mounted = true;

    const loadResolvedRecord = async () => {
      if (!open || !record?.id) {
        setResolvedRecord(record);
        return;
      }

      try {
        const result = await fetchLeaveMonetizationById(record.id);
        if (mounted) {
          setResolvedRecord(result?.record || record);
        }
      } catch {
        if (mounted) {
          setResolvedRecord(record);
        }
      }
    };

    void trackLoad(loadResolvedRecord);
    return () => {
      mounted = false;
    };
  }, [open, record, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadSignature = async () => {
      if (!open || !resolvedRecord?.employeeRecordId) {
        setEmployeeSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(resolvedRecord.employeeRecordId);
        if (mounted) {
          setEmployeeSignature(String(result?.employee?.signatureDataUrl || ""));
        }
      } catch {
        if (mounted) {
          setEmployeeSignature("");
        }
      }
    };

    void trackLoad(loadSignature);
    return () => {
      mounted = false;
    };
  }, [open, resolvedRecord?.employeeRecordId, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadReviewerSignature = async () => {
      const needsCurrentViewerSignature = open && (
        (showHrmoReviewerSignature && !resolvedRecord?.reviewedByEmployeeRecordId)
        || (
          showRegionalDirectorApproverSignature
          && normalizeText(resolvedRecord?.status) === "approved"
          && !resolvedRecord?.approvedByEmployeeRecordId
        )
      );

      if (!needsCurrentViewerSignature) {
        setReviewerSignature("");
        return;
      }

      try {
        const result = await getCurrentEmployeeSignature();
        if (mounted) {
          setReviewerSignature(String(result?.employee?.signatureDataUrl || ""));
        }
      } catch {
        if (mounted) {
          setReviewerSignature("");
        }
      }
    };

    void trackLoad(loadReviewerSignature);
    return () => {
      mounted = false;
    };
  }, [
    open,
    resolvedRecord?.approvedByEmployeeRecordId,
    resolvedRecord?.reviewedByEmployeeRecordId,
    resolvedRecord?.status,
    showHrmoReviewerSignature,
    showRegionalDirectorApproverSignature,
    trackLoad,
  ]);

  useEffect(() => {
    let mounted = true;

    const loadSavedHrmoSignature = async () => {
      if (!open || !resolvedRecord?.reviewedByEmployeeRecordId) {
        setSavedHrmoSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(resolvedRecord.reviewedByEmployeeRecordId);
        if (mounted) {
          setSavedHrmoSignature(String(result?.employee?.signatureDataUrl || ""));
        }
      } catch {
        if (mounted) {
          setSavedHrmoSignature("");
        }
      }
    };

    void trackLoad(loadSavedHrmoSignature);
    return () => {
      mounted = false;
    };
  }, [open, resolvedRecord?.reviewedByEmployeeRecordId, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadSavedRegionalDirectorSignature = async () => {
      if (!open || !resolvedRecord?.approvedByEmployeeRecordId) {
        setSavedRegionalDirectorSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(resolvedRecord.approvedByEmployeeRecordId);
        if (mounted) {
          setSavedRegionalDirectorSignature(String(result?.employee?.signatureDataUrl || ""));
        }
      } catch {
        if (mounted) {
          setSavedRegionalDirectorSignature("");
        }
      }
    };

    void trackLoad(loadSavedRegionalDirectorSignature);
    return () => {
      mounted = false;
    };
  }, [open, resolvedRecord?.approvedByEmployeeRecordId, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadLeaveCredits = async () => {
      if (!open || !resolvedRecord?.employeeRecordId) {
        setLeaveCredits(null);
        return;
      }

      const recordYear = /^\d{4}/.test(String(resolvedRecord?.dateFiled || ""))
        ? Number(String(resolvedRecord.dateFiled).slice(0, 4))
        : null;

      try {
        const result = await fetchLeaveCredits(resolvedRecord.employeeRecordId, recordYear);
        if (mounted) {
          setLeaveCredits(result?.credits || null);
        }
      } catch {
        if (mounted) {
          setLeaveCredits(null);
        }
      }
    };

    void trackLoad(loadLeaveCredits);
    return () => {
      mounted = false;
    };
  }, [open, resolvedRecord?.employeeRecordId, resolvedRecord?.dateFiled, trackLoad]);

  /* 6.A prints the same checklist as the leave request form, configured types included. */
  useEffect(() => {
    let mounted = true;

    const loadLeaveTypes = async () => {
      if (!open) {
        return;
      }

      try {
        const result = await fetchLeaveTypes();
        if (mounted) {
          setConfiguredLeaveTypes(result?.leaveTypes || []);
        }
      } catch {
        if (mounted) {
          setConfiguredLeaveTypes([]);
        }
      }
    };

    void trackLoad(loadLeaveTypes);
    return () => {
      mounted = false;
    };
  }, [open, trackLoad]);

  const availableLeaveTypes = useMemo(
    () => mergeCscLeaveTypes(configuredLeaveTypes),
    [configuredLeaveTypes]
  );
  const formData = useMemo(
    () => buildFormData(resolvedRecord, leaveCredits, availableLeaveTypes),
    [availableLeaveTypes, leaveCredits, resolvedRecord]
  );
  const reviewerName = useMemo(
    () => String(reviewer?.full_name || reviewer?.fullName || reviewer?.username || "").trim(),
    [reviewer]
  );
  const normalizedStatus = useMemo(() => normalizeText(resolvedRecord?.status), [resolvedRecord?.status]);
  const applicantTimestampLabel = useMemo(
    () => formatSignatureTimestamp(resolvedRecord?.createdAt || resolvedRecord?.dateFiled),
    [resolvedRecord?.createdAt, resolvedRecord?.dateFiled]
  );
  const hrmoName = useMemo(
    () => String(resolvedRecord?.reviewedByName || (showHrmoReviewerSignature ? reviewerName : "")).trim(),
    [resolvedRecord?.reviewedByName, reviewerName, showHrmoReviewerSignature]
  );
  const hrmoSignature = useMemo(
    () => savedHrmoSignature
      || (!resolvedRecord?.reviewedByEmployeeRecordId && showHrmoReviewerSignature ? reviewerSignature : ""),
    [resolvedRecord?.reviewedByEmployeeRecordId, reviewerSignature, savedHrmoSignature, showHrmoReviewerSignature]
  );
  const hasHrmoSignatureBlock = useMemo(
    () => Boolean(
      resolvedRecord?.reviewedByEmployeeRecordId
      || resolvedRecord?.reviewedByName
      || showHrmoReviewerSignature
    ),
    [resolvedRecord?.reviewedByEmployeeRecordId, resolvedRecord?.reviewedByName, showHrmoReviewerSignature]
  );
  const hrmoTimestampLabel = useMemo(() => {
    const hasSavedReviewer = Boolean(resolvedRecord?.reviewedByEmployeeRecordId || resolvedRecord?.reviewedByName);
    return hasSavedReviewer
      ? formatSignatureTimestamp(resolvedRecord?.reviewedAt || resolvedRecord?.updatedAt)
      : "";
  }, [
    resolvedRecord?.reviewedAt,
    resolvedRecord?.reviewedByEmployeeRecordId,
    resolvedRecord?.reviewedByName,
    resolvedRecord?.updatedAt,
  ]);
  const regionalDirectorName = useMemo(
    () => String(
      resolvedRecord?.approvedByName
      || (showRegionalDirectorApproverSignature && normalizedStatus === "approved" ? reviewerName : "")
    ).trim(),
    [normalizedStatus, resolvedRecord?.approvedByName, reviewerName, showRegionalDirectorApproverSignature]
  );
  const regionalDirectorSignature = useMemo(
    () => savedRegionalDirectorSignature || (
      !resolvedRecord?.approvedByEmployeeRecordId
      && showRegionalDirectorApproverSignature
      && normalizedStatus === "approved"
        ? reviewerSignature
        : ""
    ),
    [
      normalizedStatus,
      resolvedRecord?.approvedByEmployeeRecordId,
      reviewerSignature,
      savedRegionalDirectorSignature,
      showRegionalDirectorApproverSignature,
    ]
  );
  const regionalDirectorTimestampLabel = useMemo(() => {
    const hasSavedApprover = Boolean(
      resolvedRecord?.approvedByEmployeeRecordId
      || resolvedRecord?.approvedByName
      || normalizedStatus === "approved"
    );
    return hasSavedApprover
      ? formatSignatureTimestamp(resolvedRecord?.approvedAt || resolvedRecord?.updatedAt)
      : "";
  }, [
    normalizedStatus,
    resolvedRecord?.approvedAt,
    resolvedRecord?.approvedByEmployeeRecordId,
    resolvedRecord?.approvedByName,
    resolvedRecord?.updatedAt,
  ]);
  const hasRegionalDirectorSignatureBlock = useMemo(
    () => Boolean(
      resolvedRecord?.approvedByEmployeeRecordId
      || resolvedRecord?.approvedByName
      || (showRegionalDirectorApproverSignature && normalizedStatus === "approved")
    ),
    [
      normalizedStatus,
      resolvedRecord?.approvedByEmployeeRecordId,
      resolvedRecord?.approvedByName,
      showRegionalDirectorApproverSignature,
    ]
  );

  const monetizationReference = useMemo(
    () => buildLeaveMonetizationReference(resolvedRecord),
    [resolvedRecord]
  );
  const qrPayload = useMemo(
    () => buildLeaveMonetizationQrPayload(resolvedRecord, formData),
    [formData, resolvedRecord]
  );

  const handlePrint = () => {
    if (!printRef.current) {
      return;
    }

    const formClone = printRef.current.cloneNode(true);
    const sourceFields = printRef.current.querySelectorAll("input, textarea, select");
    const clonedFields = formClone.querySelectorAll("input, textarea, select");

    sourceFields.forEach((field, index) => {
      const clonedField = clonedFields[index];
      if (!clonedField) {
        return;
      }

      if (field instanceof HTMLInputElement && clonedField instanceof HTMLInputElement) {
        if (field.type === "checkbox" || field.type === "radio") {
          clonedField.checked = field.checked;
        } else {
          clonedField.value = field.value;
          clonedField.setAttribute("value", field.value);
        }
        return;
      }

      if (field instanceof HTMLTextAreaElement && clonedField instanceof HTMLTextAreaElement) {
        clonedField.value = field.value;
        clonedField.textContent = field.value;
      }
    });

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
          <title>Application for Leave Monetization</title>
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
  };

  if (!open || !resolvedRecord) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close leave monetization form preview"
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        className={`relative z-10 max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[28px] bg-white leave-form-preview shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Leave Monetization Form</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">
              Civil Service Form No. 6 filed for monetization of leave credits.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-slate-100 px-3 py-4 sm:px-4">
          <div className="mx-auto w-full max-w-[900px]">
            <div ref={printRef} className="leave-form-paper" style={styles.wrap}>
          <div style={styles.topBar}>
            <strong>Civil Service Form No. 6</strong>
            &nbsp;&bull;&nbsp;
            <em>Revised 2020</em>
          </div>

          <div style={styles.header}>
            <img src="/mgb.png" alt="MGB Logo" style={styles.logoImage} />
            <div>
              <p style={{ margin: "1px 0", fontSize: "10px" }}>Republic of the Philippines</p>
              <p style={{ margin: "1px 0", fontSize: "10px" }}>Department of Environment and Natural Resources</p>
              <h3 style={{ margin: "4px 0", fontSize: "12px", fontWeight: "bold" }}>
                MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE NO. X
              </h3>
              <p style={{ margin: "1px 0", fontSize: "10px" }}>DENR-X Compound, Puntod, Cagayan de Oro City</p>
              <div style={styles.formTitle}>APPLICATION FOR LEAVE</div>
            </div>
            <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={styles.logoImage} />
          </div>

          <div style={styles.row}>
            <div style={{ ...styles.cell, width: "33.33%" }}>
              <label style={styles.label}>1. Office/Department</label>
              <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.office} />
            </div>
            <div style={{ ...styles.cell, width: "66.66%", borderRight: "none" }}>
              <label style={styles.label}>2. Name</label>
              <div style={{ display: "flex", textAlign: "center" }}>
                {[
                  ["lastName", "(Last)"],
                  ["firstName", "(First)"],
                  ["middleName", "(Middle)"],
                ].map(([field, label]) => (
                  <div key={field} style={{ flex: 1, paddingInline: "4px" }}>
                    <span style={{ fontSize: "8px", fontStyle: "italic", display: "block" }}>{label}</span>
                    <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData[field]} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={styles.row}>
            <div style={{ ...styles.cell, width: "25%" }}>
              <label style={styles.label}>3. Date of Filing</label>
              <ReadOnlyInput type="date" style={inputWithoutUnderlineStyle} value={formData.dateOfFiling} />
            </div>
            <div style={{ ...styles.cell, width: "50%" }}>
              <label style={styles.label}>4. Position</label>
              <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.position} />
            </div>
            <div style={{ ...styles.cell, width: "25%", borderRight: "none" }}>
              <label style={styles.label}>5. Salary</label>
              <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.salary} />
            </div>
          </div>

          <div style={styles.sectionTitle}>6. DETAILS OF APPLICATION</div>
          <div style={styles.row}>
            <div style={{ ...styles.cell, width: "50%" }}>
              <label style={styles.label}>6.A Type of Leave to be Availed of</label>
              {availableLeaveTypes.map((type) => (
                <div key={type} style={styles.checklistItem}>
                  <SelectionIndicator checked={formData.leaveType === type} />
                  <span>{type}</span>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "flex-end", marginTop: "5px", gap: "4px" }}>
                <span>Others:</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveTypeOther} />
              </div>
            </div>

            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>6.B Details of Leave</label>

              <p style={styles.subLabel}>In case of Vacation/Special Privilege Leave:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                <span>Within the Philippines</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value="" />
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                <span>Abroad (Specify)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value="" />
              </div>

              <p style={styles.subLabel}>In case of Sick Leave:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                <span>In Hospital (Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value="" />
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                <span>Out Patient (Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value="" />
              </div>

              <p style={styles.subLabel}>In case of Special Leave Benefits for Women:</p>
              <div style={{ display: "flex", gap: "4px", alignItems: "flex-end" }}>
                <span style={{ whiteSpace: "nowrap" }}>(Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailWomen} />
              </div>

              <p style={styles.subLabel}>In case of Study Leave:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                <span>Completion of Master's Degree</span>
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                <span>BAR/Board Examination Review</span>
              </div>

              <p style={styles.subLabel}>Other purpose:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked />
                <span>Monetization of Leave Credits</span>
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                <span>Terminal Leave</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", marginTop: "5px", gap: "4px" }}>
                <span style={{ whiteSpace: "nowrap" }}>Purpose:</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.purpose} />
              </div>
            </div>
          </div>

          <div style={styles.row}>
            <div style={{ ...styles.cell, width: "50%" }}>
              <label style={styles.label}>6.C Number of Working Days Applied For</label>
              <ReadOnlyInput
                style={{ ...styles.input, margin: "10px 0", display: "block" }}
                value={formData.numberOfDays}
              />
              <label style={styles.label}>Inclusive Dates</label>
              <ReadOnlyInput
                style={{ ...styles.input, margin: "10px 0", display: "block" }}
                value={formData.inclusiveDates}
              />
            </div>
            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>6.D Commutation</label>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={false} />
                Not Requested
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked />
                Requested
              </div>
              <SignatureBlock
                signatureDataUrl={employeeSignature}
                fallbackText={applicantTimestampLabel}
                name={formData.applicantName}
                caption="(Signature of Applicant)"
              />
            </div>
          </div>

          <div style={styles.sectionTitle}>7. DETAILS OF ACTION ON APPLICATION</div>
          <div style={styles.row}>
            <div style={{ ...styles.cell, width: "50%" }}>
              <label style={styles.label}>7.A Certification of Leave Credits</label>
              <p style={{ textAlign: "center", fontSize: "10px" }}>
                As of <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, width: "80px", display: "inline" }} value={formData.creditsAsOf} />
              </p>
              <table style={styles.creditsTable}>
                <thead>
                  <tr>
                    <th style={tdStyle}></th>
                    <th style={tdStyle}>Vacation Leave</th>
                    <th style={tdStyle}>Sick Leave</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Total Earned", "vlEarned", "slEarned"],
                    ["Less this App.", "vlLess", "slLess"],
                    ["Balance", "vlBalance", "slBalance"],
                  ].map(([label, vl, sl]) => (
                    <tr key={label}>
                      <td style={tdStyle}>{label}</td>
                      <td style={tdStyle}>
                        <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, textAlign: "center" }} value={formData[vl]} />
                      </td>
                      <td style={tdStyle}>
                        <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, textAlign: "center" }} value={formData[sl]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasHrmoSignatureBlock ? (
                <SignatureBlock
                  signatureDataUrl={hrmoSignature}
                  fallbackText={hrmoTimestampLabel}
                  name={hrmoName}
                  caption="Administrative Officer V (HRMO)"
                />
              ) : (
                <div style={{ marginTop: "20px", textAlign: "center" }}>
                  <div style={styles.sigLine}>Administrative Officer V (HRMO)</div>
                </div>
              )}
            </div>

            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>7.B Recommendation</label>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.recommendation === "approved"} />
                For approval
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.recommendation === "disapproved"} />
                For disapproval due to:
              </div>
              <ReadOnlyInput
                style={{ ...styles.input, display: "block", marginTop: "10px", height: "40px" }}
                value={formData.disapprovalReason}
              />
            </div>
          </div>

          <div style={{ ...styles.row, borderBottom: "none" }}>
            <div style={{ ...styles.cell, width: "50%" }}>
              <label style={styles.label}>7.C Approved For:</label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
                <ReadOnlyInput style={{ ...styles.input, width: "40px" }} value={formData.approvedDaysPay} />
                <span>days with pay</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
                <ReadOnlyInput style={{ ...styles.input, width: "40px" }} value={formData.approvedDaysNoPay} />
                <span>days without pay</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.approvedOthers} />
                <span style={{ whiteSpace: "nowrap" }}>others (Specify)</span>
              </div>
            </div>
            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>7.D Disapproved Due To:</label>
              <ReadOnlyInput
                style={{ ...inputWithoutUnderlineStyle, display: "block", height: "20px" }}
                value={formData.disapprovedReason}
              />
              {hasRegionalDirectorSignatureBlock ? (
                <SignatureBlock
                  signatureDataUrl={regionalDirectorSignature}
                  fallbackText={regionalDirectorTimestampLabel}
                  name={regionalDirectorName}
                  caption="OIC, Regional Director"
                />
              ) : (
                <div style={{ marginTop: "20px", textAlign: "center" }}>
                  <div style={styles.sigLine}>OIC, Regional Director</div>
                </div>
              )}
            </div>
          </div>

          <div style={styles.qrFooter}>
            <div style={styles.qrFooterNote}>
              Generated by the MGB Regional Office No. X HRIS. Scan the QR code to read the filed
              monetization details.
            </div>
            <FormQrCode
              value={qrPayload}
              size={118}
              align="right"
              reference={monetizationReference}
              caption="Scan to view monetization details"
            />
          </div>
            </div>

            {/* Printing is a row action in the table now, so the sheet itself only offers Close. */}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-900 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
              >
                Close Form
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
