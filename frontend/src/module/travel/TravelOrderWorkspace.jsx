import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  FilePenLine,
  Filter,
  Search,
  X,
} from "lucide-react";
import { faBan, faCheck, faEye, faFileLines, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Pagination from "../../components/UI/Pagination";
import LeaveStatusBadge from "../../components/leave/LeaveStatusBadge";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import {
  canManageLeave,
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  matchesUserRecordScope,
  matchesUserEmployeeOption,
  normalizeLeaveStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { buildSignatureTimestampLabel } from "../../utils/signatureTimestamp";
import { getEmployeeSignature } from "../../services/api";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  authorizeTravelOrder,
  fetchTravelOrders,
  fileTravelOrder,
  updateTravelOrderStatus,
} from "../../services/travelOrderService";
import { requestApprovalCaptcha } from "../../utils/approvalCaptcha";

// Printed in the AUTHORIZATION block of the form and shown verbatim in the acceptance dialog the
// employee answers after the Regional Director approves -- they must be the same words.
const TRAVEL_AUTHORIZATION_TEXT = "I hereby authorize the Accountant to deduct the corresponding amount of the unliquidated cash advance from my succeeding salary for my failure to liquidate this travel within twenty (20) days upon return to my permanent official station pursuant to Commission on Audit (COA) Circular No. 2012-004 dated November 28, 2012.";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const initialForm = {
  employeeRecordIds: [],
  destination: "",
  purpose: "",
  startDate: "",
  endDate: "",
  assistanceLabor: "",
  appropriations: "",
  remarks: "",
};

const travelFormStyles = {
  wrap: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "11px",
    width: "100%",
    maxWidth: "640px",
    margin: "0 auto",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "75px 1fr 75px",
    alignItems: "center",
    padding: "10px 14px",
    gap: "8px",
  },
  logoImage: {
    width: "68px",
    height: "68px",
    objectFit: "contain",
    display: "block",
  },
  headerText: {
    textAlign: "center",
    lineHeight: 1.5,
  },
  bar: {
    backgroundColor: "#f5c518",
    height: "6px",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },
  title: {
    textAlign: "center",
    margin: "18px 0 6px",
    letterSpacing: "6px",
    fontSize: "15px",
    fontWeight: "bold",
  },
  subtitle: {
    textAlign: "center",
    fontSize: "11px",
    marginBottom: "14px",
    color: "#555555",
  },
  numberValue: {
    display: "inline-block",
    minWidth: "92px",
    borderBottom: "1px solid #000000",
    padding: "1px 4px",
    color: "#111827",
  },
  fields: {
    padding: "0 20px",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "170px 1fr",
    marginBottom: "4px",
    gap: "0 6px",
    alignItems: "baseline",
  },
  rowTwo: {
    display: "grid",
    gridTemplateColumns: "170px minmax(0,1fr) 110px minmax(0,1fr)",
    marginBottom: "4px",
    gap: "0 6px",
    alignItems: "baseline",
  },
  label: {
    fontWeight: "bold",
    fontSize: "10.5px",
    whiteSpace: "nowrap",
  },
  multiLabel: {
    fontWeight: "bold",
    fontSize: "10.5px",
    lineHeight: 1.4,
    whiteSpace: "normal",
  },
  value: {
    fontSize: "10.5px",
    borderBottom: "1px solid #000000",
    padding: "1px 4px",
    minHeight: "16px",
    color: "#111827",
  },
  valueBold: {
    fontSize: "10.5px",
    borderBottom: "1px solid #000000",
    padding: "1px 4px",
    minHeight: "16px",
    fontWeight: "bold",
    color: "#111827",
    textTransform: "uppercase",
  },
  selectionBox: {
    width: "13px",
    height: "13px",
    border: "1px solid #000000",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: "11px",
    lineHeight: 1,
    fontWeight: "bold",
    color: "#111827",
  },
  selectionGroup: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    minHeight: "16px",
    padding: "1px 4px",
  },
  selectionOption: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "10.5px",
  },
  divider: {
    border: "none",
    borderTop: "1px solid #000000",
    margin: "8px 20px",
  },
  cert: {
    padding: "10px 20px 0",
  },
  certTitle: {
    fontWeight: "bold",
    fontSize: "11px",
    margin: "0 0 4px",
  },
  certText: {
    margin: 0,
    fontSize: "10.5px",
    textAlign: "justify",
    lineHeight: 1.6,
  },
  raGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    padding: "6px 20px 0",
    gap: "0 20px",
  },
  raLabel: {
    fontSize: "10.5px",
    margin: "0 0 28px",
    textAlign: "center",
    color: "#555555",
  },
  raSigPreview: {
    minHeight: "44px",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    marginBottom: "2px",
  },
  raSigImage: {
    maxWidth: "190px",
    maxHeight: "42px",
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
  raName: {
    borderBottom: "1px solid #000000",
    fontWeight: "bold",
    fontSize: "10.5px",
    textAlign: "center",
    textTransform: "uppercase",
    minHeight: "16px",
  },
  raRole: {
    fontSize: "10px",
    textAlign: "center",
    color: "#555555",
  },
  auth: {
    padding: "10px 20px 0",
  },
  authTitle: {
    textAlign: "center",
    fontSize: "12px",
    fontWeight: "bold",
    letterSpacing: "4px",
    margin: "0 0 6px",
  },
  authText: {
    fontSize: "10.5px",
    textAlign: "justify",
    lineHeight: 1.6,
    margin: "0 0 10px",
  },
  authSig: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    paddingRight: "40px",
  },
  authSigPreview: {
    width: "200px",
    minHeight: "44px",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    marginBottom: "2px",
  },
  authSigImage: {
    maxWidth: "190px",
    maxHeight: "42px",
    objectFit: "contain",
    display: "block",
  },
  authSigName: {
    width: "200px",
    borderBottom: "1px solid #000000",
    textAlign: "center",
    fontSize: "10.5px",
    fontWeight: "bold",
    textDecoration: "underline",
    textTransform: "uppercase",
    minHeight: "16px",
  },
  authSigRole: {
    width: "200px",
    textAlign: "center",
    fontSize: "10px",
    color: "#555555",
  },
  footer: {
    marginTop: "16px",
    borderTop: "1px solid #cccccc",
    padding: "8px 14px 10px",
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  },
  footerCode: {
    fontSize: "9px",
    color: "#555555",
    marginRight: "auto",
  },
  footerText: {
    fontSize: "8px",
    fontStyle: "italic",
    fontWeight: "bold",
    textAlign: "center",
    lineHeight: 1.5,
    flex: 1,
    color: "#334155",
  },
  footerBadge: {
    fontSize: "7px",
    textAlign: "center",
    border: "1px solid #999999",
    padding: "3px 5px",
    lineHeight: 1.4,
    width: "60px",
    color: "#334155",
  },
};

function formatIsoDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildTravelOrderNumber(request) {
  const year = String(request?.dateFiled || request?.startDate || new Date().getFullYear()).slice(0, 4);
  const id = String(request?.id || "").padStart(4, "0");
  return `${id}-${year}`;
}

function travelBoolean(value, fallback = true) {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["no", "n", "false", "not allowed"].includes(normalized)) {
    return false;
  }

  if (["yes", "y", "true", "allowed"].includes(normalized)) {
    return true;
  }

  return fallback;
}

function TravelPreviewSelectionBox({ checked = false }) {
  return (
    <span aria-hidden="true" style={travelFormStyles.selectionBox}>
      {checked ? "✓" : ""}
    </span>
  );
}

function TravelOrderPreviewModal({ request, onClose }) {
  const [visible, setVisible] = useState(false);
  const [employeeSignature, setEmployeeSignature] = useState("");
  const [recommendedBySignature, setRecommendedBySignature] = useState("");
  const [approvedBySignature, setApprovedBySignature] = useState("");
  const printRef = useRef(null);

  useEffect(() => {
    if (!request) {
      setVisible(false);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [request]);

  useEffect(() => {
    let mounted = true;

    const loadEmployeeSignature = async () => {
      if (!request?.employeeRecordId) {
        setEmployeeSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(request.employeeRecordId);
        if (!mounted) {
          return;
        }

        setEmployeeSignature(String(result?.employee?.signatureDataUrl || ""));
      } catch {
        if (mounted) {
          setEmployeeSignature("");
        }
      }
    };

    loadEmployeeSignature();
    return () => {
      mounted = false;
    };
  }, [request?.employeeRecordId]);

  useEffect(() => {
    let mounted = true;

    const loadRecommendedBySignature = async () => {
      if (!request?.recommendedByEmployeeRecordId) {
        setRecommendedBySignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(request.recommendedByEmployeeRecordId);
        if (!mounted) {
          return;
        }

        setRecommendedBySignature(String(result?.employee?.signatureDataUrl || ""));
      } catch {
        if (mounted) {
          setRecommendedBySignature("");
        }
      }
    };

    loadRecommendedBySignature();
    return () => {
      mounted = false;
    };
  }, [request?.recommendedByEmployeeRecordId]);

  useEffect(() => {
    let mounted = true;

    const loadApprovedBySignature = async () => {
      if (!request?.approvedByEmployeeRecordId) {
        setApprovedBySignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(request.approvedByEmployeeRecordId);
        if (!mounted) {
          return;
        }

        setApprovedBySignature(String(result?.employee?.signatureDataUrl || ""));
      } catch {
        if (mounted) {
          setApprovedBySignature("");
        }
      }
    };

    loadApprovedBySignature();
    return () => {
      mounted = false;
    };
  }, [request?.approvedByEmployeeRecordId]);

  if (!request) {
    return null;
  }

  const requestDate = request.dateFiled || request.startDate;
  const displayValue = (value) => String(value || "").trim();
  const position = displayValue(request.position || request.designation);
  const division = displayValue(request.division);
  const destination = displayValue(request.destination);
  const purpose = displayValue(request.purpose);
  const appropriations = displayValue(request.appropriations);
  const remarks = displayValue(request.remarks);
  const assistanceLabor = displayValue(request.assistanceLabor) || "-";
  const approvedBy = displayValue(request.approvedBy);
  const approvedByRole = displayValue(request.approvedByRole) || "Regional Director";
  const recommendedBy = displayValue(request.recommendedBy);
  const recommendedByRole = displayValue(request.recommendedByRole) || "Division Chief";
  const signatoryRole = displayValue(request.signatoryRole) || "Official Employee";
  const perDiemsAllowed = travelBoolean(request.perDiems, true);
  const applicantTimestampLabel = request.employeeAuthorizedAt
    ? buildSignatureTimestampLabel("Authorized", request.employeeAuthorizedAt)
    : buildSignatureTimestampLabel("Filed", request.createdAt || request.dateFiled);
  const recommendedTimestampLabel = (recommendedBy || request.recommendedByEmployeeRecordId)
    ? buildSignatureTimestampLabel("Filed", request.createdAt || request.dateFiled)
    : "";
  const approvedTimestampLabel = (
    approvedBy || request.approvedByEmployeeRecordId || normalizeLeaveStatus(request.status) === "Approved"
  )
    ? buildSignatureTimestampLabel(
      "Date",
      request.approvedAt || request.updatedAt || request.createdAt || request.dateFiled
    )
    : "";

  const handlePrint = () => {
    if (!printRef.current) {
      return;
    }

    const formClone = printRef.current.cloneNode(true);
    const sourceElements = [printRef.current, ...printRef.current.querySelectorAll("*")];
    const clonedElements = [formClone, ...formClone.querySelectorAll("*")];

    sourceElements.forEach((sourceElement, index) => {
      const clonedElement = clonedElements[index];
      if (!(sourceElement instanceof HTMLElement) || !(clonedElement instanceof HTMLElement)) {
        return;
      }

      const computedStyle = window.getComputedStyle(sourceElement);
      const inlineStyles = Array.from(computedStyle).map((property) => (
        `${property}: ${computedStyle.getPropertyValue(property)};`
      )).join(" ");

      clonedElement.setAttribute("style", inlineStyles);
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
          <title>Travel Order Form</title>
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

            @media print {
              .print-shell {
                max-width: 100%;
              }
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

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close travel order form preview"
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        className={`travel-order-form-preview relative z-10 max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-[28px] bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Travel Order Form</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Centered overlay preview of the submitted travel order.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Print Form
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-slate-100 px-3 py-4 sm:px-4">
          <div ref={printRef} className="travel-order-form-paper" style={travelFormStyles.wrap}>
            <div style={travelFormStyles.header}>
              <img src="/mgb.png" alt="MGB Logo" style={travelFormStyles.logoImage} />

              <div style={travelFormStyles.headerText}>
                <p style={{ margin: "1px 0", fontSize: "9.5px" }}>Republic of the Philippines</p>
                <p style={{ margin: "1px 0", fontSize: "9.5px" }}>Department of Environment and Natural Resources</p>
                <p style={{ margin: "1px 0", fontSize: "13.5px", fontWeight: "bold" }}>MINES AND GEOSCIENCES BUREAU</p>
                <p style={{ margin: "1px 0", fontSize: "10px", fontWeight: "bold" }}>Regional Office No. X</p>
                <p style={{ margin: "1px 0", fontSize: "8.5px" }}>DENR-X Compound, Puntod, Cagayan de Oro City</p>
                <p style={{ margin: "1px 0", fontSize: "8.5px" }}>
                  Telefax Nos. (088) 856-2110; (088) 856-1331 | region10@mgb.gov.ph
                </p>
              </div>

              <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={travelFormStyles.logoImage} />
            </div>

            <div style={travelFormStyles.bar} />

            <div style={travelFormStyles.title}>T R A V E L   O R D E R</div>
            <div style={travelFormStyles.subtitle}>
              No. <span style={travelFormStyles.numberValue}>{buildTravelOrderNumber(request)}</span>
            </div>

            <div style={travelFormStyles.fields}>
              <div style={travelFormStyles.rowTwo}>
                <span style={travelFormStyles.label}>Name:</span>
                <div style={travelFormStyles.valueBold}>{displayValue(request.employeeName)}</div>
                <span style={travelFormStyles.label}>Date:</span>
                <div style={travelFormStyles.value}>{formatIsoDate(requestDate)}</div>
              </div>

              <div style={travelFormStyles.rowTwo}>
                <span style={travelFormStyles.label}>Position:</span>
                <div style={travelFormStyles.value}>{position}</div>
                <span style={travelFormStyles.label}>Division/Section:</span>
                <div style={travelFormStyles.value}>{division}</div>
              </div>

              <div style={travelFormStyles.rowTwo}>
                <span style={travelFormStyles.label}>Departure:</span>
                <div style={travelFormStyles.value}>{formatIsoDate(request.startDate)}</div>
                <span style={travelFormStyles.label}>Official Station:</span>
                <div style={travelFormStyles.value}>{displayValue(request.officialStation) || "MGB-X"}</div>
              </div>

              <div style={travelFormStyles.rowTwo}>
                <span style={travelFormStyles.label}>Destination:</span>
                <div style={travelFormStyles.value}>{destination}</div>
                <span style={travelFormStyles.label}>Arrival Date:</span>
                <div style={travelFormStyles.value}>{formatIsoDate(request.endDate)}</div>
              </div>

              <div style={travelFormStyles.row}>
                <span style={travelFormStyles.label}>Purpose of Travel:</span>
                <div style={travelFormStyles.value}>{purpose}</div>
              </div>

              <div style={travelFormStyles.row}>
                <span style={travelFormStyles.label}>Per Diems/Expense Allowed:</span>
                <div style={travelFormStyles.selectionGroup}>
                  <span style={travelFormStyles.selectionOption}>
                    <TravelPreviewSelectionBox checked={perDiemsAllowed} />
                    <span>Yes</span>
                  </span>
                  <span style={travelFormStyles.selectionOption}>
                    <TravelPreviewSelectionBox checked={!perDiemsAllowed} />
                    <span>No</span>
                  </span>
                </div>
              </div>

              <div style={travelFormStyles.row}>
                <span style={travelFormStyles.label}>Assistance or Laborer Allowed:</span>
                <div style={travelFormStyles.value}>{assistanceLabor}</div>
              </div>

              <div style={{ ...travelFormStyles.row, alignItems: "flex-end" }}>
                <span style={travelFormStyles.multiLabel}>Appropriations to which travel should be charged:</span>
                <div style={travelFormStyles.value}>{appropriations}</div>
              </div>

              <div style={travelFormStyles.row}>
                <span style={travelFormStyles.label}>Remarks or Special instructions:</span>
                <div style={travelFormStyles.value}>{remarks}</div>
              </div>
            </div>

            <hr style={travelFormStyles.divider} />

            <div style={travelFormStyles.cert}>
              <p style={travelFormStyles.certTitle}>Certifications:</p>
              <p style={travelFormStyles.certText}>
                This is to certify that the travel is necessary and is connected with the function of the
                official/employee of this Division/Section/Unit.
              </p>
            </div>

            <div style={travelFormStyles.raGrid}>
              <div style={{ gridColumn: "1" }}>
                <p style={travelFormStyles.raLabel}>Recommended by:</p>
                <div style={travelFormStyles.raSigPreview}>
                  {recommendedBySignature ? (
                    <img
                      src={recommendedBySignature}
                      alt={`${recommendedBy || "Division Chief"} signature`}
                      style={travelFormStyles.raSigImage}
                    />
                  ) : recommendedTimestampLabel ? (
                    <div style={travelFormStyles.signatureTimestamp}>{recommendedTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={travelFormStyles.raName}>{recommendedBy}</div>
                <div style={travelFormStyles.raRole}>{recommendedByRole}</div>
              </div>

              <div style={{ gridColumn: "2" }}>
                <p style={travelFormStyles.raLabel}>Approved by:</p>
                <div style={travelFormStyles.raSigPreview}>
                  {approvedBySignature ? (
                    <img
                      src={approvedBySignature}
                      alt={`${approvedBy || "Regional Director"} signature`}
                      style={travelFormStyles.raSigImage}
                    />
                  ) : approvedTimestampLabel ? (
                    <div style={travelFormStyles.signatureTimestamp}>{approvedTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={travelFormStyles.raName}>{approvedBy}</div>
                <div style={travelFormStyles.raRole}>{approvedByRole}</div>
              </div>
            </div>

            <hr style={travelFormStyles.divider} />

            <div style={travelFormStyles.auth}>
              <p style={travelFormStyles.authTitle}>A U T H O R I Z A T I O N</p>
              <p style={travelFormStyles.authText}>{TRAVEL_AUTHORIZATION_TEXT}</p>
              <div style={travelFormStyles.authSig}>
                <div style={travelFormStyles.authSigPreview}>
                  {employeeSignature ? (
                    <img
                      src={employeeSignature}
                      alt={`${displayValue(request.employeeName) || "Official Employee"} signature`}
                      style={travelFormStyles.authSigImage}
                    />
                  ) : applicantTimestampLabel ? (
                    <div style={travelFormStyles.signatureTimestamp}>{applicantTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={travelFormStyles.authSigName}>{displayValue(request.employeeName)}</div>
                <div style={travelFormStyles.authSigRole}>{signatoryRole}</div>
              </div>
            </div>

            <div style={travelFormStyles.footer}>
              <div style={travelFormStyles.footerCode}>MGB-X-FAD-FO-033</div>
              <div style={travelFormStyles.footerText}>
                "MINING SHALL BE PRO-PEOPLE AND PRO-ENVIRONMENT
                <br />
                IN SUSTAINING WEALTH CREATION AND IMPROVED QUALITY OF LIFE"
              </div>
              <div style={travelFormStyles.footerBadge}>
                ISO 9001:2015
                <br />
                Certified
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TravelOrderFormModal({
  open,
  submitting,
  employeeOptions = [],
  defaultEmployeeRecordId = "",
  fallbackEmployeeName = "",
  canSelectEmployee = false,
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
      employeeRecordIds: defaultEmployeeRecordId ? [String(defaultEmployeeRecordId)] : [],
    });
    setErrors({});
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [defaultEmployeeRecordId, open]);

  if (!open) {
    return null;
  }

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};

    if (canSelectEmployee && form.employeeRecordIds.length === 0) {
      nextErrors.employeeRecordId = "Select at least one employee.";
    }
    if (!form.destination.trim()) nextErrors.destination = "Destination is required.";
    if (!form.startDate) nextErrors.startDate = "Start date is required.";
    if (!form.endDate) nextErrors.endDate = "End date is required.";
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      nextErrors.endDate = "End date must not be earlier than start date.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit({
      employeeRecordIds: form.employeeRecordIds.map((recordId) => Number(recordId)).filter(Boolean),
      destination: form.destination.trim(),
      purpose: form.purpose.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      assistanceLabor: form.assistanceLabor.trim(),
      appropriations: form.appropriations.trim(),
      remarks: form.remarks.trim(),
    });
  };

  const inputClasses = "min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100";
  const selectedEmployees = employeeOptions.filter(
    (employee) => form.employeeRecordIds.includes(String(employee.employeeRecordId))
  );
  const readOnlyEmployeeName = selectedEmployees[0]?.employeeName || fallbackEmployeeName || "";

  const handleToggleEmployee = (employee) => {
    const recordId = String(employee.employeeRecordId);
    setForm((current) => ({
      ...current,
      employeeRecordIds: current.employeeRecordIds.includes(recordId)
        ? current.employeeRecordIds.filter((selectedId) => selectedId !== recordId)
        : [...current.employeeRecordIds, recordId],
    }));
    setErrors((current) => ({ ...current, employeeRecordId: "" }));
  };

  const handleClearEmployees = () => {
    setForm((current) => ({ ...current, employeeRecordIds: [] }));
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close travel order form"
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
            <h2 className="m-0 text-lg font-semibold text-slate-950">Request Travel Order</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Complete the form to submit an official travel request.</p>
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
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                {canSelectEmployee ? "Employees" : "Employee"}
              </span>
              {canSelectEmployee ? (
                <>
                  <EmployeeSearchSelect
                    multiple
                    employeeOptions={employeeOptions}
                    selectedEmployees={selectedEmployees}
                    onSelect={handleToggleEmployee}
                    onClear={handleClearEmployees}
                    placeholder="Search and select employees..."
                  />
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    Tick the checkbox of every employee covered by this travel. A separate travel order is filed for each one.
                  </p>
                </>
              ) : (
                <input
                  type="text"
                  value={readOnlyEmployeeName}
                  readOnly
                  className={`${inputClasses} cursor-not-allowed bg-slate-50 text-slate-500`.trim()}
                />
              )}
              {errors.employeeRecordId ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.employeeRecordId}</p> : null}
            </div>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Destination</span>
              <input
                value={form.destination}
                onChange={updateField("destination")}
                placeholder="Enter travel destination"
                className={inputClasses}
              />
              {errors.destination ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.destination}</p> : null}
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Purpose</span>
              <input
                value={form.purpose}
                onChange={updateField("purpose")}
                placeholder="Enter travel purpose"
                className={inputClasses}
              />
            </label>

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                Start Date
              </span>
              <input
                type="date"
                value={form.startDate}
                onChange={updateField("startDate")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: dd/mm/yyyy</p>
              {errors.startDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.startDate}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                End Date
              </span>
              <input
                type="date"
                value={form.endDate}
                onChange={updateField("endDate")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: dd/mm/yyyy</p>
              {errors.endDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.endDate}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Assistance or Labor Allowed</span>
              <input
                value={form.assistanceLabor}
                onChange={updateField("assistanceLabor")}
                placeholder="Enter assistance or labor details"
                className={inputClasses}
              />
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Appropriations</span>
              <input
                value={form.appropriations}
                onChange={updateField("appropriations")}
                placeholder="Enter appropriation details"
                className={inputClasses}
              />
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Remarks</span>
              <textarea
                rows={4}
                value={form.remarks}
                onChange={updateField("remarks")}
                placeholder="Add travel notes or remarks"
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
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Travel Order"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function TravelOrderWorkspace({
  user,
  employees = [],
  title = "Travel Orders",
  description = "Submit and monitor travel requests.",
  submitLabel = "Request Travel Order",
  allowCreate = true,
  showHeaderCloseButton = true,
  onPendingCountChange,
}) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);

  const managePermission = canManageLeave(user);
  const viewAllPermission = canViewAllLeaves(user);
  // Admins file on anyone's behalf; a chief files for their division and is stamped as the
  // recommending officer on each form (see resolve_travel_recommender_id in travel_order.php).
  const isAdmin = resolveRoleKey(user) === "admin";
  const allowEmployeeSelection = isAdmin || resolveRoleKey(user) === "chief";
  const pendingCount = useMemo(() => countPendingRecords(requests), [requests]);

  const loadRequests = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchTravelOrders();
      const nextRequests = result.requests || [];
      setRequests(
        viewAllPermission
          ? nextRequests
          : nextRequests.filter((request) => matchesUserRecordScope(request, user))
      );
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load travel orders.");
      }
    } finally {
      setLoading(false);
    }
  }, [user, viewAllPermission]);

  useAutoRefreshOnChange(loadRequests, { topic: "travel_order" });

  /*
   * Once the Regional Director approves, the travel order waits at pending until its employee
   * accepts the COA liquidation authorization. Prompt them here, one order at a time.
   *
   * Both refs guard against this screen's auto-refresh: without them every poll would stack a
   * second dialog on top of the open one, and answering "No" would be undone by the next tick.
   * Declining only defers -- the prompt returns on the next visit, nothing is written.
   */
  const authorizationPromptOpenRef = useRef(false);
  const deferredAuthorizationsRef = useRef(new Set());

  useEffect(() => {
    if (authorizationPromptOpenRef.current) {
      return undefined;
    }

    const awaitingRequests = requests.filter((request) => (
      request.awaitingAuthorization
      && matchesUserRecordScope(request, user)
      && !deferredAuthorizationsRef.current.has(request.id)
    ));

    if (awaitingRequests.length === 0) {
      return undefined;
    }

    let cancelled = false;

    const promptForAuthorization = async () => {
      authorizationPromptOpenRef.current = true;

      try {
        for (const request of awaitingRequests) {
          if (cancelled) {
            break;
          }

          const confirmation = await Swal.fire({
            title: "Travel Order Authorization",
            html: `
              <p style="margin:0 0 10px;font-size:14px;color:#334155;">
                Your travel order to <strong>${escapeHtml(request.destination)}</strong>
                (${escapeHtml(formatDateDisplay(request.startDate))} - ${escapeHtml(formatDateDisplay(request.endDate))})
                has been approved by the Regional Director.
              </p>
              <p style="margin:0 0 10px;font-size:13px;text-align:justify;line-height:1.6;color:#0f172a;">
                ${escapeHtml(TRAVEL_AUTHORIZATION_TEXT)}
              </p>
              <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">
                Do you accept this authorization?
              </p>
            `,
            icon: "info",
            showCancelButton: true,
            confirmButtonText: "Yes, I authorize",
            cancelButtonText: "No, not now",
            confirmButtonColor: "#0f766e",
            cancelButtonColor: "#64748b",
            reverseButtons: true,
            allowOutsideClick: false,
            allowEscapeKey: false,
          });

          if (!confirmation.isConfirmed) {
            deferredAuthorizationsRef.current.add(request.id);
            continue;
          }

          try {
            const result = await authorizeTravelOrder(request.id);
            setRequests((current) =>
              current.map((item) => (item.id === result.request.id ? result.request : item))
            );
            await Swal.fire({
              title: "Authorized",
              text: result.message || "Travel authorization accepted. Your travel order is now approved.",
              icon: "success",
              confirmButtonColor: "#0f766e",
            });
          } catch (error) {
            deferredAuthorizationsRef.current.add(request.id);
            await Swal.fire({
              title: "Authorization failed",
              text: error?.response?.data?.message || error?.message || "Unable to accept the travel authorization.",
              icon: "error",
              confirmButtonColor: "#dc2626",
            });
          }
        }
      } finally {
        authorizationPromptOpenRef.current = false;
      }
    };

    void promptForAuthorization();

    return () => {
      cancelled = true;
    };
  }, [requests, user]);

  useEffect(() => {
    if (!loading) {
      onPendingCountChange?.(pendingCount);
    }
  }, [loading, onPendingCountChange, pendingCount]);

  const employeeOptions = useMemo(
    () => employees
      .map((employee) => ({
        employeeRecordId: employee.id,
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        division: employee.department || employee.division || "",
      }))
      .filter((employee) => employee.employeeRecordId && employee.employeeName)
      // An admin files purely on behalf of others, so drop their own record. A chief can be on the
      // trip too and has no self-service travel page, so they stay in their own list.
      .filter((employee) => !(isAdmin && matchesUserEmployeeOption(employee, user))),
    [employees, isAdmin, user]
  );

  const resolvedEmployee = useMemo(() => {
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

  const defaultEmployeeRecordId = resolvedEmployee?.employeeRecordId
    ? String(resolvedEmployee.employeeRecordId)
    : "";

  const filteredRequests = useMemo(() => {
    const search = query.trim().toLowerCase();

    return requests.filter((request) => {
      const matchesSearch = !search || [
        request.employeeName,
        request.destination,
        request.purpose,
        request.remarks,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));

      const matchesStatus = !status || normalizeLeaveStatus(request.status) === status;
      const matchesDate = !dateFilter || [request.startDate, request.endDate, request.dateFiled].includes(dateFilter);

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [dateFilter, query, requests, status]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRequests = filteredRequests.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, status, dateFilter, rowsPerPage]);

  const handleSubmitRequest = async ({ employeeRecordIds = [], ...details }) => {
    const targetRecordIds = employeeRecordIds.length > 0
      ? employeeRecordIds
      : [resolvedEmployee?.employeeRecordId || ""];

    setSubmitting(true);
    try {
      const createdRequests = [];
      const failures = [];

      for (const employeeRecordId of targetRecordIds) {
        const matchedEmployee = employeeOptions.find(
          (employee) => String(employee.employeeRecordId) === String(employeeRecordId)
        );

        try {
          const result = await fileTravelOrder({
            ...details,
            employeeRecordId,
            employeeId:
              matchedEmployee?.employeeId
              || resolvedEmployee?.employeeId
              || user?.employee_id
              || "",
            employeeName:
              matchedEmployee?.employeeName
              || resolvedEmployee?.employeeName
              || user?.full_name
              || user?.username
              || "",
          });
          createdRequests.push(result.request);
        } catch (error) {
          failures.push({
            employeeName: matchedEmployee?.employeeName || resolvedEmployee?.employeeName || "Selected employee",
            message: error?.response?.data?.message || error?.message || "Unable to submit travel order.",
          });
        }
      }

      if (createdRequests.length > 0) {
        setRequests((current) => [...createdRequests.slice().reverse(), ...current]);
        setModalOpen(false);
        toast.success(
          createdRequests.length === 1
            ? "Travel order submitted successfully."
            : `${createdRequests.length} travel orders submitted successfully.`
        );
      }

      if (failures.length > 0) {
        toast.error(
          createdRequests.length === 0
            ? failures[0].message
            : `Failed for ${failures.map((failure) => failure.employeeName).join(", ")}.`
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (actionType, request) => {
    if (actionType === "view" || actionType === "review") {
      setSelectedRequest(request);
      return;
    }

    const isOwnRequest = matchesUserRecordScope(request, user);
    const isSelfCancellation = actionType === "cancel" && isOwnRequest;

    if (isOwnRequest && !isSelfCancellation) {
      toast.error("You cannot update your own travel order. Please ask another authorized user to review it.");
      return;
    }

    const nextStatusMap = {
      approve: "Approved",
      reject: "Rejected",
      cancel: "Cancelled",
    };

    const nextStatus = nextStatusMap[actionType];
    if (!nextStatus || (!managePermission && !isSelfCancellation)) {
      return;
    }

    if (isSelfCancellation && normalizeLeaveStatus(request.status) !== "Pending") {
      toast.error("Only pending travel orders can be cancelled.");
      return;
    }

    const isRejectAction = actionType === "reject";
    const confirmation = await Swal.fire({
      title: `${nextStatus} Travel Order?`,
      text: isSelfCancellation
        ? `Cancel your travel order to ${request.destination}?`
        : `Update the travel order for ${request.employeeName} to ${nextStatus.toLowerCase()}?`,
      icon: actionType === "approve" ? "success" : "warning",
      input: isRejectAction ? "textarea" : undefined,
      inputLabel: isRejectAction ? "Rejected note" : undefined,
      inputPlaceholder: isRejectAction ? "Explain why this travel order is being rejected." : undefined,
      inputValue: isRejectAction ? String(request.rejectedNote || "") : undefined,
      inputAttributes: isRejectAction
        ? {
          "aria-label": "Rejected note",
          autocapitalize: "sentences",
        }
        : undefined,
      inputValidator: isRejectAction
        ? (value) => (!String(value || "").trim() ? "Rejected note is required." : undefined)
        : undefined,
      showCancelButton: true,
      confirmButtonText: `Yes, ${nextStatus.toLowerCase()}`,
      cancelButtonText: "Keep current status",
      confirmButtonColor: actionType === "approve" ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const rejectedNote = isRejectAction ? String(confirmation.value || "").trim() : "";

    if (actionType === "approve") {
      const captchaConfirmed = await requestApprovalCaptcha({
        text: "Solve the captcha before this travel order approval is completed.",
        confirmButtonText: "Verify and approve",
      });

      if (!captchaConfirmed) {
        return;
      }
    }

    try {
      Swal.fire({
        title: "Updating...",
        text: "Please wait while the travel order is updated.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await updateTravelOrderStatus(request.id, nextStatus, rejectedNote);
      setRequests((current) =>
        current.map((item) => (item.id === result.request.id ? result.request : item))
      );
      await Swal.fire({
        title: result.emailNotification === "warning" ? "Updated with warning" : "Updated",
        text: result.message || `Travel order ${nextStatus.toLowerCase()}.`,
        icon: result.emailNotification === "warning" ? "warning" : "success",
        confirmButtonColor: result.emailNotification === "warning" ? "#d97706" : "#0f766e",
      });
    } catch (error) {
      await Swal.fire({
        title: "Update failed",
        text: error?.response?.data?.message || error?.message || "Unable to update travel order status.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  return (
    <div className="travel-order-workspace space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">{title}</h3>
            <p className="m-0 mt-1 text-sm text-slate-500">{description}</p>
          </div>
          {allowCreate ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              <FilePenLine size={16} />
              {submitLabel}
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_120px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={viewAllPermission ? "Search employee, destination, purpose" : "Search destination, purpose, remarks"}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
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
            <table className="min-w-[1180px] w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {["#", "Employee", "Division", "Destination", "Purpose", "Travel Dates", "Status", "Date Filed", "Actions"].map((header) => (
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
                ) : paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                        <Filter size={20} />
                      </div>
                      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No travel orders found</p>
                      <p className="m-0 mt-1 text-sm text-slate-500">Submit a travel request or adjust the filters.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRequests.map((request, index) => {
                    const isOwnRequest = matchesUserRecordScope(request, user);
                    const showOwnCancelAction = isOwnRequest && normalizeLeaveStatus(request.status) === "Pending";
                    const showDecisionActions = managePermission
                      && normalizeLeaveStatus(request.status) === "Pending"
                      && !isOwnRequest;
                    // Already approved by the Regional Director and waiting on the employee, so the
                    // approve action is spent. Reject and cancel stay available for a trip called off
                    // before the employee gets round to authorizing it.
                    const showApproveAction = showDecisionActions && !request.awaitingAuthorization;
                    const canReviewRequest = managePermission;

                    return (
                      <tr key={request.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                          {(safePage - 1) * pageSize + index + 1}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-800">
                          <div className="font-semibold text-slate-900">{request.employeeName}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{request.division || "Unassigned"}</td>
                        <td className="px-3 py-3 text-sm text-slate-700">{request.destination}</td>
                        <td className="max-w-[220px] truncate px-3 py-3 text-sm text-slate-600">{request.purpose || "No purpose provided"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">
                          {formatDateDisplay(request.startDate)} - {formatDateDisplay(request.endDate)}
                        </td>
                        <td className="px-3 py-3">
                          {request.awaitingAuthorization ? (
                            <span
                              className="inline-flex min-h-7 items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-700"
                              title="Approved by the Regional Director. Waiting for the employee to accept the travel authorization."
                            >
                              Awaiting Authorization
                            </span>
                          ) : (
                            <LeaveStatusBadge status={request.status} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(request.dateFiled)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <ActionIconButton
                              label={canReviewRequest ? "Review travel order" : "View travel order form"}
                              icon={canReviewRequest ? faFileLines : faEye}
                              tone={canReviewRequest ? "review" : "view"}
                              onClick={() => handleAction(canReviewRequest ? "review" : "view", request)}
                            />
                            {showApproveAction ? (
                              <ActionIconButton
                                label="Approve travel order"
                                icon={faCheck}
                                tone="approve"
                                onClick={() => handleAction("approve", request)}
                              />
                            ) : null}
                            {showDecisionActions ? (
                              <>
                                <ActionIconButton
                                  label="Reject travel order"
                                  icon={faXmark}
                                  tone="reject"
                                  onClick={() => handleAction("reject", request)}
                                />
                                <ActionIconButton
                                  label="Cancel travel order"
                                  icon={faBan}
                                  tone="cancel"
                                  onClick={() => handleAction("cancel", request)}
                                />
                              </>
                            ) : null}
                            {showOwnCancelAction ? (
                              <ActionIconButton
                                label="Cancel travel order"
                                icon={faBan}
                                tone="cancel"
                                onClick={() => handleAction("cancel", request)}
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
            Showing {filteredRequests.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredRequests.length)} of {filteredRequests.length} travel orders
          </p>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      </section>

      <TravelOrderFormModal
        open={allowCreate && modalOpen}
        submitting={submitting}
        employeeOptions={employeeOptions}
        defaultEmployeeRecordId={defaultEmployeeRecordId}
        fallbackEmployeeName={resolvedEmployee?.employeeName || user?.full_name || user?.username || ""}
        canSelectEmployee={allowEmployeeSelection}
        showHeaderCloseButton={showHeaderCloseButton}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmitRequest}
      />

      <TravelOrderPreviewModal request={selectedRequest} onClose={() => setSelectedRequest(null)} />
    </div>
  );
}


