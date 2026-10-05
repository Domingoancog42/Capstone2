import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { buildSignatureTimestampLabel } from "../../utils/signatureTimestamp";
import { getCurrentEmployeeSignature, getEmployeeSignature } from "../../services/api";
import { fetchLoanRequestById, LOAN_TYPES } from "../../services/loanService";
import { currencyFormatter } from "../../utils/format";
import { splitEmployeeName } from "../../utils/employeeName";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function toDateInputValue(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSalary(employee) {
  const amount = Number(employee?.basicSalary);
  if (!amount) {
    return "";
  }

  const formatted = currencyFormatter.format(amount);
  return employee?.salaryRate ? `${formatted} / ${employee.salaryRate}` : formatted;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const SCALES = [
  [1000000000, "Billion"],
  [1000000, "Million"],
  [1000, "Thousand"],
];

function belowThousandToWords(value) {
  const words = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;

  if (hundreds > 0) {
    words.push(`${ONES[hundreds]} Hundred`);
  }

  if (remainder >= 20) {
    const tens = Math.floor(remainder / 10);
    const ones = remainder % 10;
    words.push(ones > 0 ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens]);
  } else if (remainder > 0) {
    words.push(ONES[remainder]);
  }

  return words.join(" ");
}

function integerToWords(value) {
  if (value === 0) {
    return "Zero";
  }

  let remaining = value;
  const words = [];

  SCALES.forEach(([scaleValue, scaleName]) => {
    const count = Math.floor(remaining / scaleValue);
    if (count > 0) {
      words.push(`${integerToWords(count)} ${scaleName}`);
      remaining %= scaleValue;
    }
  });

  if (remaining > 0) {
    words.push(belowThousandToWords(remaining));
  }

  return words.join(" ");
}

// Government loan forms spell the principal out beside the figures, so a mistyped digit cannot
// change the amount on its own.
function amountInWords(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  let pesos = Math.floor(amount);
  let centavos = Math.round((amount - pesos) * 100);

  // Rounding up from .995 and above carries into the peso figure instead of printing "100/100".
  if (centavos === 100) {
    pesos += 1;
    centavos = 0;
  }

  return `${integerToWords(pesos)} Pesos and ${String(centavos).padStart(2, "0")}/100 Only`.toUpperCase();
}

/*
 * Repayment terms are free text -- "12 months", "12", "2 years", "24 mos." and "1 year and 6 months"
 * all turn up -- so the amortization is only computed when a term can be read out of the entry.
 */
function parseTermMonths(repaymentTerms) {
  const text = String(repaymentTerms || "").trim();
  if (!text) {
    return 0;
  }

  const yearMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i);
  const monthMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?|mons?)\b/i);

  if (yearMatch || monthMatch) {
    const years = yearMatch ? Number(yearMatch[1]) : 0;
    const months = monthMatch ? Number(monthMatch[1]) : 0;
    return Math.round((years * 12) + months);
  }

  // A bare number in this field means months ("12", "24 payments").
  const bareMatch = text.match(/\d+(?:\.\d+)?/);
  return bareMatch ? Math.round(Number(bareMatch[0])) : 0;
}

function loanAmountEntries(record) {
  return Object.entries(record?.loanAmounts || {})
    .map(([loanType, loanAmount]) => ({
      loanType,
      loanAmount: Number(loanAmount),
    }))
    .filter((entry) => entry.loanType && Number.isFinite(entry.loanAmount) && entry.loanAmount > 0);
}

function buildFormData(record, employee) {
  const nameParts = splitEmployeeName(record?.employeeName || "");
  const normalizedStatus = normalizeText(record?.status);
  const isApproved = normalizedStatus === "approved";
  const isRejected = normalizedStatus === "rejected";
  const remarks = String(record?.approvalRemarks || "").trim();
  const amounts = loanAmountEntries(record);
  const loanAmount = amounts.length
    ? amounts.reduce((sum, entry) => sum + entry.loanAmount, 0)
    : Number(record?.loanAmount || 0);
  const termMonths = parseTermMonths(record?.repaymentTerms);
  const monthlyAmortization = termMonths > 0 ? loanAmount / termMonths : 0;
  const loanType = String(record?.loanType || "");
  const matchedLoanType = LOAN_TYPES.find((type) => normalizeText(type) === normalizeText(loanType)) || "";
  const loanTypes = amounts.length
    ? amounts.map((entry) => entry.loanType)
    : (matchedLoanType ? [matchedLoanType] : []);
  const loanTypeSummary = loanTypes.length > 1
    ? `${loanTypes.length} loans`
    : (loanTypes[0] || loanType || "Loan");

  return {
    office: record?.division || "",
    lastName: nameParts.lastName,
    firstName: nameParts.firstName,
    middleName: nameParts.middleName,
    applicantName: record?.employeeName || "",
    dateOfFiling: toDateInputValue(record?.dateFiled),
    position: record?.position || employee?.position || "",
    employeeNumber: record?.employeeId || "",
    salary: formatSalary(employee),
    loanType: matchedLoanType,
    loanTypes,
    loanTypeSummary,
    loanTypeOther: matchedLoanType ? "" : loanType,
    loanAmountFigures: loanAmount > 0 ? currencyFormatter.format(loanAmount) : "",
    loanAmountWords: amountInWords(loanAmount),
    repaymentTerms: record?.repaymentTerms || "",
    termMonths: termMonths > 0 ? String(termMonths) : "",
    monthlyAmortization: monthlyAmortization > 0 ? currencyFormatter.format(monthlyAmortization) : "",
    purpose: String(record?.purpose || ""),
    recommendation: isRejected ? "disapproved" : (isApproved ? "approved" : ""),
    disapprovalReason: isRejected ? remarks : "",
    approvedAmount: isApproved && loanAmount > 0 ? currencyFormatter.format(loanAmount) : "",
    approvedTerms: isApproved ? (record?.repaymentTerms || "") : "",
    approvedAmortization: isApproved && monthlyAmortization > 0
      ? currencyFormatter.format(monthlyAmortization)
      : "",
    disapprovedReason: isRejected ? remarks : "",
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
  undertaking: {
    margin: "4px 0 0",
    fontSize: "10px",
    lineHeight: 1.5,
    textAlign: "justify",
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
    alignItems: "flex-end",
    justifyContent: "center",
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
          <img
            src={signatureDataUrl}
            alt={`${name || "Authorized"} signature`}
            style={styles.signatureImage}
          />
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

function loanReference(record) {
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? `LN-${String(id).padStart(4, "0")}` : "";
}

export default function LoanApplicationFormModal({
  open = false,
  record = null,
  employee = null,
  reviewer = null,
  showHrmoReviewerSignature = false,
  showRegionalDirectorApproverSignature = false,
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [resolvedRecord, setResolvedRecord] = useState(record);
  const [employeeSignature, setEmployeeSignature] = useState("");
  const [reviewerSignature, setReviewerSignature] = useState("");
  const printRef = useRef(null);

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
        const result = await fetchLoanRequestById(record.id);
        if (mounted) {
          setResolvedRecord(result?.record || record);
        }
      } catch {
        if (mounted) {
          setResolvedRecord(record);
        }
      }
    };

    loadResolvedRecord();
    return () => {
      mounted = false;
    };
  }, [open, record]);

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

    loadSignature();
    return () => {
      mounted = false;
    };
  }, [open, resolvedRecord?.employeeRecordId]);

  /*
   * Loan records only store the reviewer/approver as a user id, so a saved signature image cannot be
   * looked up per record the way the leave form does. The current viewer's signature is used when
   * they are the one whose block is still unsigned; every other case falls back to name plus date.
   */
  useEffect(() => {
    let mounted = true;

    const loadReviewerSignature = async () => {
      const needsCurrentViewerSignature = open && (
        (showHrmoReviewerSignature && !resolvedRecord?.reviewedBy)
        || (
          showRegionalDirectorApproverSignature
          && normalizeText(resolvedRecord?.status) === "approved"
          && !resolvedRecord?.approvedBy
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

    loadReviewerSignature();
    return () => {
      mounted = false;
    };
  }, [
    open,
    resolvedRecord?.approvedBy,
    resolvedRecord?.reviewedBy,
    resolvedRecord?.status,
    showHrmoReviewerSignature,
    showRegionalDirectorApproverSignature,
  ]);

  const formData = useMemo(() => buildFormData(resolvedRecord, employee), [employee, resolvedRecord]);
  const reviewerName = useMemo(
    () => String(reviewer?.full_name || reviewer?.fullName || reviewer?.username || "").trim(),
    [reviewer]
  );
  const normalizedStatus = useMemo(() => normalizeText(resolvedRecord?.status), [resolvedRecord?.status]);
  const applicantTimestampLabel = useMemo(
    () => buildSignatureTimestampLabel("Filed", resolvedRecord?.createdAt || resolvedRecord?.dateFiled),
    [resolvedRecord?.createdAt, resolvedRecord?.dateFiled]
  );
  const hrmoName = useMemo(
    () => String(resolvedRecord?.reviewedBy || (showHrmoReviewerSignature ? reviewerName : "")).trim(),
    [resolvedRecord?.reviewedBy, reviewerName, showHrmoReviewerSignature]
  );
  const hrmoSignature = useMemo(
    () => (!resolvedRecord?.reviewedBy && showHrmoReviewerSignature ? reviewerSignature : ""),
    [resolvedRecord?.reviewedBy, reviewerSignature, showHrmoReviewerSignature]
  );
  const hasHrmoSignatureBlock = useMemo(
    () => Boolean(resolvedRecord?.reviewedBy || showHrmoReviewerSignature),
    [resolvedRecord?.reviewedBy, showHrmoReviewerSignature]
  );
  const hrmoTimestampLabel = useMemo(
    () => (resolvedRecord?.reviewedBy
      ? buildSignatureTimestampLabel("Date", resolvedRecord?.reviewedAt || resolvedRecord?.updatedAt)
      : ""),
    [resolvedRecord?.reviewedAt, resolvedRecord?.reviewedBy, resolvedRecord?.updatedAt]
  );
  const regionalDirectorName = useMemo(
    () => String(
      resolvedRecord?.approvedBy
      || resolvedRecord?.rejectedBy
      || (showRegionalDirectorApproverSignature && normalizedStatus === "approved" ? reviewerName : "")
    ).trim(),
    [
      normalizedStatus,
      resolvedRecord?.approvedBy,
      resolvedRecord?.rejectedBy,
      reviewerName,
      showRegionalDirectorApproverSignature,
    ]
  );
  const regionalDirectorSignature = useMemo(
    () => (
      !resolvedRecord?.approvedBy
      && showRegionalDirectorApproverSignature
      && normalizedStatus === "approved"
        ? reviewerSignature
        : ""
    ),
    [
      normalizedStatus,
      resolvedRecord?.approvedBy,
      reviewerSignature,
      showRegionalDirectorApproverSignature,
    ]
  );
  const regionalDirectorTimestampLabel = useMemo(
    () => (resolvedRecord?.approvedBy || resolvedRecord?.rejectedBy
      ? buildSignatureTimestampLabel(
        "Date",
        resolvedRecord?.approvedAt || resolvedRecord?.rejectedAt || resolvedRecord?.updatedAt
      )
      : ""),
    [
      resolvedRecord?.approvedAt,
      resolvedRecord?.approvedBy,
      resolvedRecord?.rejectedAt,
      resolvedRecord?.rejectedBy,
      resolvedRecord?.updatedAt,
    ]
  );
  const hasRegionalDirectorSignatureBlock = useMemo(
    () => Boolean(
      resolvedRecord?.approvedBy
      || resolvedRecord?.rejectedBy
      || (showRegionalDirectorApproverSignature && normalizedStatus === "approved")
    ),
    [
      normalizedStatus,
      resolvedRecord?.approvedBy,
      resolvedRecord?.rejectedBy,
      showRegionalDirectorApproverSignature,
    ]
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
          <title>Application for Loan</title>
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
        aria-label="Close loan application form preview"
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
            <h2 className="m-0 text-lg font-semibold text-slate-950">Loan Application Form</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">
              Government loan application with authority to deduct amortization from salary.
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
                <strong>Loan Application Form</strong>
                &nbsp;&bull;&nbsp;
                <em>For GSIS / Agency Loan Privileges</em>
                &nbsp;&bull;&nbsp;
                <strong>Ref. No. {loanReference(resolvedRecord) || "N/A"}</strong>
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
                  <div style={styles.formTitle}>APPLICATION FOR LOAN</div>
                </div>
                <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={styles.logoImage} />
              </div>

              <div style={styles.row}>
                <div style={{ ...styles.cell, width: "33.33%" }}>
                  <label style={styles.label}>1. Office/Division</label>
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
                <div style={{ ...styles.cell, width: "35%" }}>
                  <label style={styles.label}>4. Position</label>
                  <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.position} />
                </div>
                <div style={{ ...styles.cell, width: "20%" }}>
                  <label style={styles.label}>5. Employee No.</label>
                  <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.employeeNumber} />
                </div>
                <div style={{ ...styles.cell, width: "20%", borderRight: "none" }}>
                  <label style={styles.label}>6. Monthly Salary</label>
                  <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.salary} />
                </div>
              </div>

              <div style={styles.sectionTitle}>7. DETAILS OF LOAN APPLICATION</div>
              <div style={styles.row}>
                <div style={{ ...styles.cell, width: "50%" }}>
                  <label style={styles.label}>7.A Type of Loan Applied For</label>
                  {LOAN_TYPES.map((type) => (
                    <div key={type} style={styles.checklistItem}>
                      <SelectionIndicator checked={formData.loanTypes?.includes(type) || formData.loanType === type} />
                      <span>{type}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "flex-end", marginTop: "5px", gap: "4px" }}>
                    <span>Others:</span>
                    <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.loanTypeOther} />
                  </div>
                </div>

                <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
                  <label style={styles.label}>7.B Loan Particulars</label>

                  <p style={styles.subLabel}>Amount of Loan Applied For (in figures):</p>
                  <ReadOnlyInput style={{ ...styles.input, display: "block" }} value={formData.loanAmountFigures} />

                  <p style={styles.subLabel}>Amount of Loan Applied For (in words):</p>
                  <ReadOnlyInput style={{ ...styles.input, display: "block" }} value={formData.loanAmountWords} />

                  <p style={styles.subLabel}>Mode of Payment / Repayment Terms:</p>
                  <ReadOnlyInput style={{ ...styles.input, display: "block" }} value={formData.repaymentTerms} />

                  <div style={{ display: "flex", alignItems: "flex-end", marginTop: "8px", gap: "4px" }}>
                    <span style={{ whiteSpace: "nowrap" }}>No. of Months:</span>
                    <ReadOnlyInput style={{ ...styles.input, width: "60px" }} value={formData.termMonths} />
                    <span style={{ whiteSpace: "nowrap" }}>Monthly Amortization:</span>
                    <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.monthlyAmortization} />
                  </div>

                  <p style={styles.subLabel}>Purpose of Loan:</p>
                  <ReadOnlyInput style={{ ...styles.input, display: "block" }} value={formData.purpose} />
                </div>
              </div>

              <div style={styles.sectionTitle}>8. CERTIFICATION AND AUTHORITY TO DEDUCT</div>
              <div style={{ ...styles.row }}>
                <div style={{ ...styles.cell, width: "55%" }}>
                  <p style={styles.undertaking}>
                    I hereby certify that the information given above is true and correct to the best of my
                    knowledge. I understand that any misrepresentation is a ground for the denial of this
                    application and for the appropriate administrative action.
                  </p>
                  <p style={styles.undertaking}>
                    I authorize the Mines and Geosciences Bureau Regional Office No. X to deduct from my salary,
                    allowances, and any amount due me the monthly amortization stated above until the loan is
                    fully paid, and to apply my terminal leave benefits or any remaining claim to the unpaid
                    balance should I be separated from the service.
                  </p>
                </div>
                <div style={{ ...styles.cell, width: "45%", borderRight: "none" }}>
                  <label style={styles.label}>8.A Applicant</label>
                  <SignatureBlock
                    signatureDataUrl={employeeSignature}
                    fallbackText={applicantTimestampLabel}
                    name={formData.applicantName}
                    caption="(Signature of Applicant)"
                  />
                </div>
              </div>

              <div style={styles.sectionTitle}>9. DETAILS OF ACTION ON APPLICATION</div>
              <div style={styles.row}>
                <div style={{ ...styles.cell, width: "50%" }}>
                  <label style={styles.label}>9.A Certification of Human Resource Unit</label>
                  <p style={styles.undertaking}>
                    This certifies that the applicant is an employee of this Office, that the salary and position
                    stated above are in accordance with our records, and that the monthly amortization applied for
                    may be accommodated through salary deduction.
                  </p>
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
                  <label style={styles.label}>9.B Recommendation</label>
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
                  <label style={styles.label}>9.C Approved For:</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
                    <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.approvedAmount} />
                    <span style={{ whiteSpace: "nowrap" }}>loan amount</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
                    <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.approvedTerms} />
                    <span style={{ whiteSpace: "nowrap" }}>repayment terms</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
                    <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.approvedAmortization} />
                    <span style={{ whiteSpace: "nowrap" }}>monthly deduction</span>
                  </div>
                </div>
                <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
                  <label style={styles.label}>9.D Disapproved Due To:</label>
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
            </div>

            <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="m-0">
                <span className="font-semibold text-slate-900">Loan applied for:</span>{" "}
                {formData.loanTypeSummary || resolvedRecord.loanType || "Loan"}
                {formData.loanAmountFigures ? ` - ${formData.loanAmountFigures}` : ""}
                {formData.repaymentTerms ? ` payable in ${formData.repaymentTerms}` : ""}
              </p>
              <p className="m-0 mt-1">
                <span className="font-semibold text-slate-900">Status:</span>{" "}
                {resolvedRecord.status || "Pending"}
                {formData.monthlyAmortization
                  ? ` (estimated monthly deduction ${formData.monthlyAmortization})`
                  : ""}
              </p>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Print Form
              </button>
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
