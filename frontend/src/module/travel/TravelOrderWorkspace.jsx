import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  FilePenLine,
  Filter,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  faBan,
  faBoxArchive,
  faCheck,
  faFileArrowDown,
  faFileSignature,
  faPrint,
  faRotateLeft,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ViewFormActions from "../../components/UI/ViewFormActions";
import BulkSelectionToolbar from "../../components/UI/BulkSelectionToolbar";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import SelectionCheckbox from "../../components/UI/SelectionCheckbox";
import LeaveStatusBadge, { getDisapprovedStatusLabel } from "../../components/leave/LeaveStatusBadge";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import {
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  isPastDate,
  matchesUserRecordScope,
  matchesUserEmployeeOption,
  normalizeLeaveStatus,
  resolveRoleKey,
  todayDateInputValue,
} from "../../utils/leaveHelpers";
import { getRoleBadgeClass, getRoleLabel, normalizeRole } from "../../utils/roleRoutes";
import { formatSignatureTimestamp } from "../../utils/signatureTimestamp";
import { formatRecordDivision } from "../../utils/divisionDisplay";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmArchiveRecords,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import FormQrCode from "../../components/UI/FormQrCode";
import MultiDatePicker from "../../components/UI/MultiDatePicker";
import {
  formatSelectedDatesSummary,
  getNoteDisplay,
  getSelectedDatesRange,
  packSelectedDates,
  unpackSelectedDates,
} from "../../utils/dateSelection";
import { buildTravelOrderQrPayload } from "../../utils/formQrCode";
import useAutoPrint from "../../hooks/useAutoPrint";
import { fitSheetToPrintArea, PRINT_AREA_WIDTH_MM, PRINT_PAGE_MARGIN_MM } from "../../utils/printSheetFit";
import { downloadFormSheetPdf } from "../../utils/formSheetPdf";
import { getEmployeeSignature } from "../../services/api";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  authorizeTravelOrder,
  fetchTravelOrders,
  fileTravelOrder,
  updateTravelOrderStatus,
} from "../../services/travelOrderService";
import { requestApprovalCaptcha, isCaptchaFailure } from "../../utils/approvalCaptcha";
import { confirmBulkApproval } from "../../utils/bulkRequestActions";
import useRowSelection from "../../hooks/useRowSelection";

// Printed in the AUTHORIZATION block of the form and shown verbatim in the acceptance dialog the
// employee answers after the Regional Director approves -- they must be the same words.
const TRAVEL_AUTHORIZATION_TEXT = "I hereby authorize the Accountant to deduct the corresponding amount of the unliquidated cash advance from my succeeding salary for my failure to liquidate this travel within twenty (20) days upon return to my permanent official station pursuant to Commission on Audit (COA) Circular No. 2012-004 dated November 28, 2012.";
/*
 * A travel order is signed in three desks, mirroring travel_order.php. The Planning Officer
 * recommends a filed order, which fills the "Recommended by" line on the form and moves it to
 * Reviewed; the Division Chief of the traveller's division approves it next (Chief Reviewed); the
 * Regional Director then gives the final approval. No desk may act out of turn, so the actions a
 * row offers are decided by the stage it is sitting on, not by the role alone. An admin sits in
 * all three so a stuck order always has a way through.
 */
const TRAVEL_RECOMMENDER_ROLES = new Set(["planningofficer", "admin"]);
const TRAVEL_CHIEF_REVIEWER_ROLES = new Set(["chief", "admin"]);
const TRAVEL_FINAL_APPROVER_ROLES = new Set(["regionaldirector", "admin"]);
// These request-only roles are not tied to one Chief's approval desk. Once recommended by the
// Planning Officer, their orders appear for every ordinary Division Chief as "All Divisions".
const TRAVEL_ALL_CHIEF_REQUESTER_ROLES = new Set(["hrhead", "hrstaff", "chiefadmin", "cashier"]);
// The HR desk reads travel orders and archives them, but signs nothing on the form.
const TRAVEL_REVIEW_ONLY_ROLES = new Set(["hrstaff", "hrhead"]);
// Statuses a travel order can still be acted on from.
const TRAVEL_OPEN_STATUSES = new Set(["Pending", "Reviewed", "Chief Reviewed"]);
const travelRowKey = (request) => request?.id;

function TravelRequesterRoleBadge({ role }) {
  const label = String(role || "").trim();
  if (!label) return <span className="text-xs font-medium text-slate-400">Unassigned</span>;

  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getRoleBadgeClass(label)}`}>
      {getRoleLabel(label)}
    </span>
  );
}

// The API resolves ownership from the signed-in account's linked employee record for every role.
// Older responses and freshly updated rows retain the existing employee-code/name fallback.
function isOwnTravelOrder(request, user) {
  return typeof request?.isOwnTravelOrder === "boolean"
    ? request.isOwnTravelOrder
    : matchesUserRecordScope(request, user);
}

/**
 * Whether the signed-in user is the desk that filed this order.
 *
 * A chief files on an employee's behalf, so they are neither the traveller nor — since the Planning
 * Officer step exists — the recommender. Calling the trip off is always theirs, so the filer is
 * matched against the employee record the API records at filing time.
 */
function isRequestFiledBy(request, user) {
  if (!(Number(request?.filedByEmployeeRecordId) > 0)) {
    return false;
  }

  return matchesUserEmployeeOption({
    employeeId: request?.filedByEmployeeId,
    employeeName: request?.filedBy,
  }, user);
}

/*
 * A Chief normally signs for their own division. Requests from the organization-wide request-only
 * roles are intentionally routed to every Division Chief, matching travel_order.php. Division
 * names are compared as the employee picker supplies them.
 */
function isChiefOfRequestDivision(request, user) {
  if (TRAVEL_ALL_CHIEF_REQUESTER_ROLES.has(normalizeRole(request?.employeeRole))) {
    return true;
  }

  const chiefDivision = String(user?.division || "").trim().toLowerCase();

  return chiefDivision !== "" && String(request?.division || "").trim().toLowerCase() === chiefDivision;
}

/**
 * Which desk, if any, the signed-in role may act on this travel order from right now.
 *
 * Returns "recommend" while the order waits on the Planning Officer, "chiefReview" once it is
 * recommended and waiting on the traveller's Division Chief, "approve" once the Chief has approved
 * it and it waits on the Regional Director, and "" when the role has nothing to sign — including
 * after the Director has signed and the order is waiting on its employee.
 */
function travelDecisionStage(request, roleKey, user) {
  if (request?.awaitingAuthorization) {
    return "";
  }

  const status = normalizeLeaveStatus(request?.status);

  if (status === "Pending" && TRAVEL_RECOMMENDER_ROLES.has(roleKey)) {
    return "recommend";
  }

  if (
    status === "Reviewed"
    && TRAVEL_CHIEF_REVIEWER_ROLES.has(roleKey)
    && (roleKey !== "chief" || isChiefOfRequestDivision(request, user))
  ) {
    return "chiefReview";
  }

  if (status === "Chief Reviewed" && TRAVEL_FINAL_APPROVER_ROLES.has(roleKey)) {
    return "approve";
  }

  return "";
}

/**
 * The role whose action is required at the travel order's current workflow stage. After the
 * Director signs, that is the traveller: named by their own role (HR Staff, Chief, ...) rather
 * than a generic "Employee", falling back to it only when the record carries no linked account.
 */
function getTravelPendingRoleLabel(request) {
  if (request?.awaitingAuthorization) {
    return `Pending by ${getRoleLabel(request?.employeeRole || "employee")}`;
  }

  const status = normalizeLeaveStatus(request?.status);

  if (status === "Pending") {
    return "Pending by Planning Officer";
  }

  if (status === "Reviewed") {
    return "Pending by Division Chief";
  }

  if (status === "Chief Reviewed") {
    return "Pending by Regional Director";
  }

  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/*
 * The days an order actually named, for the lists. An order filed as a plain range -- an older
 * record, or one filed before the day picker -- still reads as start to end.
 */
function formatRequestDates(request) {
  const summary = formatSelectedDatesSummary(unpackSelectedDates(request?.remarks).dates);

  return summary || `${formatDateDisplay(request?.startDate)} - ${formatDateDisplay(request?.endDate)}`;
}

const initialForm = {
  employeeRecordIds: [],
  destination: "",
  purpose: "",
  /* The days the trip covers, each with its own whole/AM/PM portion. */
  selectedDates: [],
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
    gridTemplateColumns: "130px minmax(0, 1fr) 130px",
    alignItems: "center",
    padding: "10px 14px",
    gap: "8px",
  },
  logoImage: {
    width: "130px",
    height: "130px",
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
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
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
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
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
  footerQrBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "4px",
    marginRight: "auto",
  },
  footerCode: {
    fontSize: "9px",
    color: "#555555",
  },
  footerText: {
    fontSize: "8px",
    fontStyle: "italic",
    fontWeight: "bold",
    textAlign: "center",
    lineHeight: 1.5,
    flex: 1,
    color: "#334155",
    // The QR block makes this strip several times taller than the text beside it, so the motto and
    // the ISO badge are centred against it rather than left stranded at the top.
    alignSelf: "center",
  },
  footerBadge: {
    fontSize: "7px",
    textAlign: "center",
    border: "1px solid #999999",
    padding: "3px 5px",
    lineHeight: 1.4,
    width: "60px",
    color: "#334155",
    alignSelf: "center",
  },
};

/*
 * Print-only tightening for the cloned order. The on-screen paper sizes itself with inline styles,
 * so these rules need `!important` to take over; the class names are hooks only this print window
 * styles. The printed order drops the paper's outline and shadow and spans the printable width,
 * with the gaps and QR shrunk so it sits on one page of A4 or short bond paper.
 */
const TRAVEL_ORDER_PRINT_CSS = `
  @page {
    size: auto;
    margin: ${PRINT_PAGE_MARGIN_MM}mm;
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
    width: ${PRINT_AREA_WIDTH_MM}mm;
    margin: 0 auto;
    overflow: hidden;
  }

  .print-shell > .travel-order-form-paper {
    width: ${PRINT_AREA_WIDTH_MM}mm !important;
    max-width: none !important;
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
  }

  .travel-print-header { grid-template-columns: 120px minmax(0, 1fr) 120px !important; padding: 0 14px 6px !important; }
  .travel-print-header img { width: 120px !important; height: 120px !important; }
  .travel-print-title { margin: 10px 0 4px !important; }
  .travel-print-subtitle { margin-bottom: 10px !important; }
  .travel-print-divider { margin: 6px 20px !important; }
  .travel-print-section { padding-top: 6px !important; }
  .travel-print-ra-label { margin-bottom: 12px !important; }
  .travel-print-signature { min-height: 36px !important; }
  .travel-print-signature img { max-height: 34px !important; }

  /* About 25 mm across: still well over 0.4 mm a module for the payload's QR version. */
  .travel-print-footer { margin-top: 10px !important; padding: 6px 14px 4px !important; }
  .travel-print-footer svg { width: 96px !important; height: 96px !important; }
`;

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

function TravelOrderPreviewModal({ request, autoPrint = false, autoDownload = false, onClose }) {
  const [visible, setVisible] = useState(false);
  const [employeeSignature, setEmployeeSignature] = useState("");
  const [recommendedBySignature, setRecommendedBySignature] = useState("");
  const [approvedBySignature, setApprovedBySignature] = useState("");
  const printRef = useRef(null);
  /*
   * Opened from the Print or Download PDF action in the table rather than by a reader: print or
   * save the order once the signatures below have landed, then hand back to the caller so it does
   * not linger on screen. `handlePrint` and `handleDownloadPdf` are only called from inside the
   * frame callback, well after they are initialised.
   */
  const trackLoad = useAutoPrint({
    active: Boolean(request) && (autoPrint || autoDownload),
    /* The PDF is saved asynchronously, so a download closes the order only once the file is out. */
    onPrint: () => {
      if (autoDownload) {
        void handleDownloadPdf().finally(() => onClose?.());
        return;
      }

      handlePrint();
    },
    onDone: autoDownload ? undefined : onClose,
  });

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

    /*
     * The applicant signature belongs to the authorization clause it sits under, so it only
     * appears once the employee has accepted that clause. An order filed on their behalf -- by a
     * chief or an admin -- leaves the line empty until the employee authorizes it themselves.
     */
    const loadEmployeeSignature = async () => {
      if (!request?.employeeRecordId || !request?.employeeAuthorizedAt) {
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

    void trackLoad(loadEmployeeSignature);
    return () => {
      mounted = false;
    };
  }, [request?.employeeAuthorizedAt, request?.employeeRecordId, trackLoad]);

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

    void trackLoad(loadRecommendedBySignature);
    return () => {
      mounted = false;
    };
  }, [request?.recommendedByEmployeeRecordId, trackLoad]);

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

    void trackLoad(loadApprovedBySignature);
    return () => {
      mounted = false;
    };
  }, [request?.approvedByEmployeeRecordId, trackLoad]);

  if (!request) {
    return null;
  }

  const requestDate = request.dateFiled || request.startDate;
  const displayValue = (value) => String(value || "").trim();
  const position = displayValue(request.position);
  const division = displayValue(request.division);
  const destination = displayValue(request.destination);
  const purpose = displayValue(request.purpose);
  const appropriations = displayValue(request.appropriations);
  /*
   * An order covers the days it actually named, which can skip days inside its span, so the exact
   * list is what the printed order shows. Orders filed as a plain range still read as start to end.
   */
  const { note: requestRemarks, dates: requestDates } = unpackSelectedDates(request.remarks);
  const remarks = displayValue(requestRemarks);
  const travelDatesSummary = formatSelectedDatesSummary(requestDates);
  const assistanceLabor = displayValue(request.assistanceLabor) || "-";
  const approvedBy = displayValue(request.approvedBy);
  const approvedByRole = displayValue(request.approvedByRole) || "Regional Director";
  const requestStatus = normalizeLeaveStatus(request.status);
  const isRegionalDirectorDisapproval = requestStatus === "Rejected"
    && Boolean(approvedBy || request.approvedByEmployeeRecordId);
  const approvalActionLabel = isRegionalDirectorDisapproval ? "Disapproved by:" : "Approved by:";
  const recommendedBy = displayValue(request.recommendedBy);
  // Recommending a travel order is the Planning Officer's step, so that line is always theirs --
  // on an unsigned form as much as a signed one.
  const recommendedByRole = "Planning Officer";
  const signatoryRole = displayValue(request.signatoryRole) || "Official Employee";
  const perDiemsAllowed = travelBoolean(request.perDiems, true);
  const applicantTimestampLabel = request.employeeAuthorizedAt
    ? formatSignatureTimestamp(request.employeeAuthorizedAt)
    : "";
  // Dated from when the recommendation was actually signed, not from when the order was filed.
  const recommendedTimestampLabel = (recommendedBy || request.recommendedByEmployeeRecordId)
    ? formatSignatureTimestamp(request.recommendedAt || request.createdAt || request.dateFiled)
    : "";
  const approvedTimestampLabel = (
    approvedBy || request.approvedByEmployeeRecordId || requestStatus === "Approved"
  )
    ? formatSignatureTimestamp(request.approvedAt || request.updatedAt || request.createdAt || request.dateFiled)
    : "";
  const travelOrderNumber = buildTravelOrderNumber(request);
  const qrPayload = buildTravelOrderQrPayload(request, {
    travelOrderNumber,
    perDiems: perDiemsAllowed,
  });

  const handlePrint = () => {
    if (!printRef.current) {
      return;
    }

    /*
     * The order is styled inline throughout, so a plain clone carries its look. Freezing every
     * computed style onto the clone would pin each box to its on-screen pixel size, leaving the
     * print styles nothing to reflow.
     */
    const formClone = printRef.current.cloneNode(true);

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
          <style>${TRAVEL_ORDER_PRINT_CSS}</style>
        </head>
        <body>
          <div class="print-shell">${formClone.outerHTML}</div>
        </body>
      </html>
    `);
    printWindow.document.close();

    /* Fitted once the images are in, since a signature's height is only known after it loads. */
    const finishPrint = () => {
      fitSheetToPrintArea(printWindow.document);
      printWindow.focus();
      printWindow.print();
      printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
    };

    /* The QR logo is an SVG <image>, which document.images leaves out, so it loads through a stand-in. */
    const svgImageStandIns = Array.from(printWindow.document.querySelectorAll("svg image"))
      .map((node) => node.getAttribute("href"))
      .filter(Boolean)
      .map((href) => {
        const standIn = printWindow.document.createElement("img");
        standIn.src = href;
        return standIn;
      });
    const images = [...Array.from(printWindow.document.images || []), ...svgImageStandIns];
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

  /* The Download PDF row action: the order Print would send to the printer, saved as a file instead. */
  const handleDownloadPdf = async () => {
    const toastId = toast.loading("Preparing the travel order PDF...");
    const employeeName = String(request.employeeName || "")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    try {
      await downloadFormSheetPdf(printRef.current, {
        fileName: `Travel-Order-${employeeName || "Employee"}-${travelOrderNumber}.pdf`,
        printCss: TRAVEL_ORDER_PRINT_CSS,
      });
      toast.success("Travel order PDF downloaded.", { id: toastId });
    } catch (error) {
      toast.error(error?.message || "Unable to download the travel order PDF.", { id: toastId });
    }
  };

  // Keep the viewport overlay outside animated workspace ancestors, whose transforms would clip it.
  return createPortal((
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
          {/* Print and Download PDF are row actions in the table, so the preview only offers Close. */}
          <div className="flex shrink-0 items-center gap-2">
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
            <div className="travel-print-header" style={travelFormStyles.header}>
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

            <div className="travel-print-title" style={travelFormStyles.title}>T R A V E L   O R D E R</div>
            <div className="travel-print-subtitle" style={travelFormStyles.subtitle}>
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

              {/* Departure and arrival above give the span; this names the days actually authorized. */}
              {travelDatesSummary ? (
                <div style={travelFormStyles.row}>
                  <span style={travelFormStyles.label}>Travel Dates:</span>
                  <div style={travelFormStyles.value}>{travelDatesSummary}</div>
                </div>
              ) : null}

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

            <hr className="travel-print-divider" style={travelFormStyles.divider} />

            <div className="travel-print-section" style={travelFormStyles.cert}>
              <p style={travelFormStyles.certTitle}>Certifications:</p>
              <p style={travelFormStyles.certText}>
                This is to certify that the travel is necessary and is connected with the function of the
                official/employee of this Division/Section/Unit.
              </p>
            </div>

            <div style={travelFormStyles.raGrid}>
              <div style={{ gridColumn: "1" }}>
                <p className="travel-print-ra-label" style={travelFormStyles.raLabel}>Recommended by:</p>
                <div className="travel-print-signature" style={travelFormStyles.raSigPreview}>
                  {recommendedBySignature ? (
                    <>
                      <img
                        src={recommendedBySignature}
                        alt={`${recommendedBy || recommendedByRole} signature`}
                        style={travelFormStyles.raSigImage}
                      />
                      {recommendedTimestampLabel ? (
                        <div style={travelFormStyles.signatureTimestamp}>{recommendedTimestampLabel}</div>
                      ) : null}
                    </>
                  ) : recommendedTimestampLabel ? (
                    <div style={travelFormStyles.signatureTimestamp}>{recommendedTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={travelFormStyles.raName}>{recommendedBy}</div>
                <div style={travelFormStyles.raRole}>{recommendedByRole}</div>
              </div>

              <div style={{ gridColumn: "2" }}>
                <p className="travel-print-ra-label" style={travelFormStyles.raLabel}>{approvalActionLabel}</p>
                <div className="travel-print-signature" style={travelFormStyles.raSigPreview}>
                  {approvedBySignature ? (
                    <>
                      <img
                        src={approvedBySignature}
                        alt={`${approvedBy || "Regional Director"} signature`}
                        style={travelFormStyles.raSigImage}
                      />
                      {approvedTimestampLabel ? (
                        <div style={travelFormStyles.signatureTimestamp}>{approvedTimestampLabel}</div>
                      ) : null}
                    </>
                  ) : approvedTimestampLabel ? (
                    <div style={travelFormStyles.signatureTimestamp}>{approvedTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={travelFormStyles.raName}>{approvedBy}</div>
                <div style={travelFormStyles.raRole}>{approvedByRole}</div>
              </div>
            </div>

            <hr className="travel-print-divider" style={travelFormStyles.divider} />

            <div className="travel-print-section" style={travelFormStyles.auth}>
              <p style={travelFormStyles.authTitle}>A U T H O R I Z A T I O N</p>
              <p style={travelFormStyles.authText}>{TRAVEL_AUTHORIZATION_TEXT}</p>
              <div style={travelFormStyles.authSig}>
                <div className="travel-print-signature" style={travelFormStyles.authSigPreview}>
                  {employeeSignature ? (
                    <>
                      <img
                        src={employeeSignature}
                        alt={`${displayValue(request.employeeName) || "Official Employee"} signature`}
                        style={travelFormStyles.authSigImage}
                      />
                      {applicantTimestampLabel ? (
                        <div style={travelFormStyles.signatureTimestamp}>{applicantTimestampLabel}</div>
                      ) : null}
                    </>
                  ) : applicantTimestampLabel ? (
                    <div style={travelFormStyles.signatureTimestamp}>{applicantTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={travelFormStyles.authSigName}>{displayValue(request.employeeName)}</div>
                <div style={travelFormStyles.authSigRole}>{signatoryRole}</div>
              </div>
            </div>

            <div className="travel-print-footer" style={travelFormStyles.footer}>
              <div style={travelFormStyles.footerQrBlock}>
                <FormQrCode
                  value={qrPayload}
                  size={124}
                  align="left"
                  caption=""
                  logoSrc="/MGB-Logo-remove-background.png"
                  logoAspectRatio={204 / 189}
                />
              </div>
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
  ), document.body);
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

  /*
   * Travel is authorized ahead of the trip, so the calendar starts today. This holds for every role,
   * admin included -- a back-dated filing is not something any account may enter through this form.
   *
   * Recomputed each render rather than memoised, so a form left open past midnight still moves on.
   */
  const today = todayDateInputValue();

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const updateSelectedDates = (selectedDates) => {
    setForm((current) => ({ ...current, selectedDates }));
    setErrors((current) => ({ ...current, selectedDates: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};

    if (canSelectEmployee && form.employeeRecordIds.length === 0) {
      nextErrors.employeeRecordId = "Select at least one employee.";
    }
    if (!form.destination.trim()) nextErrors.destination = "Destination is required.";
    if (form.selectedDates.length === 0) nextErrors.selectedDates = "Select at least one travel date.";

    /*
     * The picker already refuses these days, but a form left open past midnight can age into a past
     * date, so the rule is enforced again rather than trusted.
     */
    if (form.selectedDates.some((day) => isPastDate(day.date))) {
      nextErrors.selectedDates = "Travel dates cannot be in the past. Choose today or a later date.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    /*
     * The record still keeps a start and an end so lists and the printed order have a span to show;
     * the exact days ride in the remarks column, which every screen unpacks before displaying.
     */
    await onSubmit({
      employeeRecordIds: form.employeeRecordIds.map((recordId) => Number(recordId)).filter(Boolean),
      destination: form.destination.trim(),
      purpose: form.purpose.trim(),
      ...getSelectedDatesRange(form.selectedDates),
      assistanceLabor: form.assistanceLabor.trim(),
      appropriations: form.appropriations.trim(),
      remarks: packSelectedDates(form.remarks, form.selectedDates),
    });
  };

  const inputClasses = "h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100";
  const fieldLabelClasses = "mb-1.5 flex min-h-5 items-center text-sm font-semibold leading-5 text-slate-700";
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

  // Keep the viewport overlay outside animated workspace ancestors, whose transforms would clip it.
  return createPortal((
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
          <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <span className={fieldLabelClasses}>
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

            <label className="md:col-span-2">
              <span className={fieldLabelClasses}>Destination</span>
              <input
                value={form.destination}
                onChange={updateField("destination")}
                placeholder="Enter travel destination"
                className={inputClasses}
              />
              {errors.destination ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.destination}</p> : null}
            </label>

            <label className="md:col-span-2">
              <span className={fieldLabelClasses}>Purpose</span>
              <input
                value={form.purpose}
                onChange={updateField("purpose")}
                placeholder="Enter travel purpose"
                className={inputClasses}
              />
            </label>

            <div>
              <span className={`${fieldLabelClasses} gap-1`}>
                <CalendarDays size={15} />
                Travel Dates
              </span>
              <MultiDatePicker
                value={form.selectedDates}
                minDate={today}
                allowWeekends
                placeholder="Select travel dates"
                floating
                closeOnSelect
                selectionMode="range"
                rangeLabel="Travel Date Range"
                onChange={updateSelectedDates}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">
                Select the trip's start and end dates. Every date in the range is included.
              </p>
              {errors.selectedDates ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.selectedDates}</p> : null}
            </div>

            <label>
              <span className={fieldLabelClasses}>Assistance or Labor Allowed</span>
              <input
                value={form.assistanceLabor}
                onChange={updateField("assistanceLabor")}
                placeholder="Enter assistance or labor details"
                className={inputClasses}
              />
            </label>

            <label className="md:col-span-2">
              <span className={fieldLabelClasses}>Appropriations</span>
              <input
                value={form.appropriations}
                onChange={updateField("appropriations")}
                placeholder="Enter appropriation details"
                className={inputClasses}
              />
            </label>

            <label className="md:col-span-2">
              <span className={fieldLabelClasses}>Remarks</span>
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
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Travel Order"}
          </button>
        </div>
      </form>
    </div>
  ), document.body);
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
  const roleKey = resolveRoleKey(user);
  const exactRoleKey = normalizeRole(user?.roleKey || user?.role);
  const isChiefAdmin = exactRoleKey === "chiefadmin";
  const isSelfServiceTravelRole = ["employee", "cashier", "hrhead", "hrstaff"].includes(roleKey)
    || isChiefAdmin;
  /*
   * Reviewed is an internal handoff stage rather than a user-facing filter. The Regional Director
   * therefore opens on all statuses so orders routed from the Planning Officer remain visible.
   */
  const defaultStatus = isSelfServiceTravelRole || roleKey === "regionaldirector" ? "" : "Pending";
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [printRequest, setPrintRequest] = useState(false);
  const [downloadRequest, setDownloadRequest] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(defaultStatus);
  const [dateFilter, setDateFilter] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Chief Admin inherits the Chief workspace but owns this archive desk under its exact role.
  const archiveRoleKey = exactRoleKey === "chiefadmin" ? exactRoleKey : roleKey;
  const canArchive = canArchiveModule(archiveRoleKey, "travel");
  /*
   * Request-only roles may archive their own orders at any stage.
   * Keep this aligned with travel_order.php so row and bulk archive actions are available together.
   */
  const canArchiveRequest = useCallback(() => canArchive, [canArchive]);
  const [archiveView, setArchiveView] = useState(false);
  const viewAllPermission = canViewAllLeaves(user);
  const showOnlyOwnTravelOrders = ["cashier", "hrhead", "hrstaff"].includes(roleKey) || isChiefAdmin;
  // Every signed-in employee can file their own order. Admins and chiefs can additionally file on
  // an employee's behalf, and the filer is recorded so they can still call the trip off.
  const isAdmin = roleKey === "admin";
  const isChief = roleKey === "chief";
  const isDivisionChief = isChief && !isChiefAdmin;
  const isPlanningOfficer = roleKey === "planningofficer";
  const showRequesterRole = isPlanningOfficer || isDivisionChief || roleKey === "regionaldirector";
  const chiefDivisionKey = isDivisionChief ? String(user?.division || "").trim().toLowerCase() : "";
  const isVisibleToChief = useCallback((request) => {
    if (!isDivisionChief) return true;

    const wasRecommended = Number(request?.recommendedByEmployeeRecordId) > 0;
    const isWaitingForRegionalDirector = normalizeLeaveStatus(request?.status) === "Chief Reviewed"
      && !request?.awaitingAuthorization;
    const routesToAllChiefs = TRAVEL_ALL_CHIEF_REQUESTER_ROLES.has(normalizeRole(request?.employeeRole));
    const belongsToChiefDivision = routesToAllChiefs
      || (chiefDivisionKey !== ""
        && String(request?.division || "").trim().toLowerCase() === chiefDivisionKey);

    return belongsToChiefDivision && wasRecommended && !isWaitingForRegionalDirector;
  }, [chiefDivisionKey, isDivisionChief]);
  const allowEmployeeSelection = isAdmin || isDivisionChief;
  // The name the session carries; employees are matched on the same name, as TeamOverview does.
  const canCreateTravelOrder = allowCreate;
  /*
   * Same split as Leave Requests and CTO. The organization-wide list is for orders the viewer acts
   * on, so one they filed or are travelling on goes straight to the Planning Officer's queue and is
   * followed under "View My Travel Orders" instead. Roles whose list is already only their own have
   * nothing to toggle, and neither does HR Staff: their organization-wide list is a record screen rather than
   * an approval queue, so their own orders simply sit in it. A Chief approves their division's
   * orders after the Planning Officer, and the orders they file for their employees stay in their
   * table too; "View My Travel Orders" carries only the ones they are travelling on.
   */
  const [myView, setMyView] = useState(false);
  const canToggleMyView = viewAllPermission
    && !showOnlyOwnTravelOrders
    && !["admin", "hrstaff"].includes(roleKey);
  const isViewerOrder = useCallback(
    (request) => isOwnTravelOrder(request, user) || (!isChief && isRequestFiledBy(request, user)),
    [isChief, user]
  );

  const loadRequests = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchTravelOrders({ archived: archiveView });
      /*
       * Pending employee filings belong exclusively to the Planning Officer, and orders the Chief
       * approved belong to the Regional Director. The API applies both rules; this client-side guard
       * also prevents a stale/cached response from briefly rendering a row outside the Chief's desk.
       */
      const nextRequests = (result.requests || []).filter(isVisibleToChief);
      setRequests(
        showOnlyOwnTravelOrders || !viewAllPermission
          ? nextRequests.filter((request) => isOwnTravelOrder(request, user))
          : nextRequests
      );
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load travel orders.");
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView, isVisibleToChief, showOnlyOwnTravelOrders, user, viewAllPermission]);

  /*
   * The organization-wide list never carries the viewer's own orders; "View My Travel Orders"
   * carries only them. The archive keeps every record, since the My view never shows archived rows.
   */
  const scopedRequests = useMemo(() => {
    if (!canToggleMyView || archiveView) {
      return requests;
    }

    return requests.filter((request) => (myView ? isViewerOrder(request) : !isViewerOrder(request)));
  }, [archiveView, canToggleMyView, isViewerOrder, myView, requests]);
  /* The badge counts what is waiting on this desk, so the viewer's own orders are not in it. */
  const pendingCount = useMemo(
    () => countPendingRecords(canToggleMyView ? requests.filter((request) => !isViewerOrder(request)) : requests),
    [canToggleMyView, isViewerOrder, requests]
  );

  // The hook reads its callback through a ref, so it will not refetch when `loadRequests` changes
  // identity — this effect does, which is what makes the archive toggle actually reload the table.
  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useAutoRefreshOnChange(loadRequests, { topic: "travel_order", refreshOnMount: false });

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

  /*
   * One acceptance dialog, shared by the prompt above and the Authorize action on the row: the
   * employee is agreeing to the same COA clause either way, so it has to read and behave the same.
   * Declining defers the order rather than answering for it -- nothing is written, and the row's
   * Authorize button brings the dialog straight back.
   */
  const promptForTravelAuthorization = useCallback(async (request) => {
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
      return;
    }

    try {
      const result = await authorizeTravelOrder(request.id);
      setRequests((current) =>
        current.map((item) => (item.id === result.request.id ? result.request : item))
      );
      deferredAuthorizationsRef.current.delete(request.id);
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
  }, []);

  useEffect(() => {
    if (authorizationPromptOpenRef.current) {
      return undefined;
    }

    const awaitingRequests = requests.filter((request) => (
      request.awaitingAuthorization
      && isOwnTravelOrder(request, user)
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

          await promptForTravelAuthorization(request);
        }
      } finally {
        authorizationPromptOpenRef.current = false;
      }
    };

    void promptForAuthorization();

    return () => {
      cancelled = true;
    };
  }, [promptForTravelAuthorization, requests, user]);

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
        divisionId: employee.divisionId,
        division: employee.department || employee.division || "",
      }))
      .filter((employee) => employee.employeeRecordId && employee.employeeName)
      // A Chief requests travel only for their own division, themselves included; the API refuses
      // anyone else. An admin files purely on behalf of others, so only the admin's own record is
      // removed.
      .filter((employee) => (
        !isDivisionChief || String(employee.division || "").trim().toLowerCase() === chiefDivisionKey
      ))
      .filter((employee) => !(isAdmin && matchesUserEmployeeOption(employee, user)))
      .sort((left, right) => (
        String(left.division || "").localeCompare(String(right.division || ""))
        || left.employeeName.localeCompare(right.employeeName)
      )),
    [chiefDivisionKey, employees, isAdmin, isDivisionChief, user]
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

    return scopedRequests.filter((request) => {
      const matchesSearch = !search || [
        request.employeeName,
        request.destination,
        request.purpose,
        /* The typed remarks only -- the day-selection metadata is never searched against. */
        getNoteDisplay(request.remarks),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));

      const matchesStatus = !status || (
        status === "Pending"
          ? Boolean(getTravelPendingRoleLabel(request))
          : normalizeLeaveStatus(request.status) === status
      );
      const matchesDate = !dateFilter || [request.startDate, request.endDate, request.dateFiled].includes(dateFilter);

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [dateFilter, query, scopedRequests, status]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRequests = filteredRequests.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selection = useRowSelection(filteredRequests, travelRowKey);

  const canBulkApproveRequest = useCallback((request) => (
    !isChiefAdmin
    && !isOwnTravelOrder(request, user)
    && Boolean(travelDecisionStage(request, roleKey, user))
  ), [isChiefAdmin, roleKey, user]);
  const bulkApprovableRequests = selection.selectedRows.filter(canBulkApproveRequest);
  const bulkArchivableRequests = canArchive && !archiveView ? selection.selectedRows.filter(canArchiveRequest) : [];
  const selectablePageRequests = !archiveView
    ? paginatedRequests.filter((request) => canArchiveRequest(request) || canBulkApproveRequest(request))
    : [];

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
        /*
         * A Chief's newly filed order is returned by the POST before the list endpoint is queried
         * again. Apply the same Planning Officer gate here so it never flashes in the Chief table.
         */
        const visibleCreatedRequests = createdRequests.filter(isVisibleToChief);
        if (visibleCreatedRequests.length > 0) {
          setRequests((current) => [...visibleCreatedRequests.slice().reverse(), ...current]);
        }
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
      setPrintRequest(false);
      setDownloadRequest(false);
      setSelectedRequest(request);
      return;
    }

    /*
     * The preview is the print source: it opens, prints itself once loaded, and closes again.
     * Download PDF works the same way, saving the order as a file instead.
     */
    if (actionType === "print" || actionType === "download") {
      setPrintRequest(actionType === "print");
      setDownloadRequest(actionType === "download");
      setSelectedRequest(request);
      return;
    }

    /*
     * Accepting the COA clause on an order the Regional Director already approved. The row's own
     * action, so an employee who dismissed the prompt on an earlier visit can still come back to it.
     */
    if (actionType === "authorize") {
      if (!request.awaitingAuthorization || !isOwnTravelOrder(request, user)) {
        return;
      }

      if (authorizationPromptOpenRef.current) {
        return;
      }

      authorizationPromptOpenRef.current = true;

      try {
        await promptForTravelAuthorization(request);
      } finally {
        authorizationPromptOpenRef.current = false;
      }

      return;
    }

    if (actionType === "archive" || actionType === "restore") {
      const confirmAction = actionType === "archive" ? confirmArchiveRecord : confirmRestoreRecord;
      await confirmAction({
        module: "travel",
        id: request.id,
        noun: "travel order",
        owner: request.employeeName,
        onArchived: () => loadRequests({ background: true }),
        onRestored: () => loadRequests({ background: true }),
      });
      return;
    }

    if (TRAVEL_REVIEW_ONLY_ROLES.has(roleKey) && ["approve", "reject", "cancel"].includes(actionType)) {
      return;
    }

    const requestStatus = normalizeLeaveStatus(request.status);
    const isOwnRequest = isOwnTravelOrder(request, user);
    const decisionStage = isChiefAdmin ? "" : travelDecisionStage(request, roleKey, user);
    // The traveller or filer may cancel only before the Regional Director has signed.
    const isSelfCancellation = actionType === "cancel"
      && (isOwnRequest || isRequestFiledBy(request, user))
      && !request.awaitingAuthorization;

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
    if (!nextStatus || (!decisionStage && !isSelfCancellation)) {
      return;
    }

    if (isSelfCancellation && !TRAVEL_OPEN_STATUSES.has(requestStatus)) {
      toast.error("Only travel orders that are still in review can be cancelled.");
      return;
    }

    const isRejectAction = actionType === "reject";
    // Stored as "Rejected", but the order and its form call it a disapproval.
    const nextStatusWord = isRejectAction ? "disapproved" : nextStatus.toLowerCase();
    // The Planning Officer authorizes an order for dispatch rather than approving it, so the
    // dialog says so -- the final approval is the Regional Director's separate signature.
    const isRecommendation = actionType === "approve" && decisionStage === "recommend";
    const isChiefApproval = actionType === "approve" && decisionStage === "chiefReview";
    const confirmation = await Swal.fire({
      title: isRecommendation
        ? "Authorize for Dispatch?"
        : isRejectAction
          ? "Disapprove Travel Order?"
          : `${nextStatus} Travel Order?`,
      text: isSelfCancellation
        ? `Cancel the travel order to ${request.destination}?`
        : isRecommendation
          ? `Authorize the travel order for ${request.employeeName} for dispatch and send it to the Division Chief for approval?`
          : isChiefApproval
            ? `Approve the travel order for ${request.employeeName} and send it to the Regional Director for final approval?`
            : `Update the travel order for ${request.employeeName} to ${nextStatusWord}?`,
      icon: actionType === "approve" ? "success" : "warning",
      input: isRejectAction ? "textarea" : undefined,
      inputLabel: isRejectAction ? "Disapproval note" : undefined,
      inputPlaceholder: isRejectAction ? "Explain why this travel order is being disapproved." : undefined,
      inputValue: isRejectAction ? String(request.rejectedNote || "") : undefined,
      inputAttributes: isRejectAction
        ? {
          "aria-label": "Disapproval note",
          autocapitalize: "sentences",
        }
        : undefined,
      inputValidator: isRejectAction
        ? (value) => (!String(value || "").trim() ? "Disapproval note is required." : undefined)
        : undefined,
      showCancelButton: true,
      confirmButtonText: isRecommendation
        ? "Yes, authorize for dispatch"
        : isRejectAction
          ? "Yes, disapprove"
          : `Yes, ${nextStatus.toLowerCase()}`,
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

    /*
     * Every signature on the order is gated: the Planning Officer recommending it, which authorizes
     * the trip for dispatch, the Division Chief approving it, and the Director approving it. What
     * comes back is the pair to send with the update, not a verdict -- travel_order.php is what
     * judges the answer.
     */
    let captcha = {};

    if (actionType === "approve") {
      captcha = await requestApprovalCaptcha({
        note: isRecommendation
          ? "Answer the sum below to authorize this travel order for dispatch."
          : "Answer the sum below to confirm this travel order approval.",
        confirmButtonText: isRecommendation ? "Verify and authorize" : "Verify and approve",
      });

      if (!captcha) {
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

      const result = await updateTravelOrderStatus(request.id, nextStatus, rejectedNote, captcha);
      setRequests((current) => {
        if (!isVisibleToChief(result.request)) {
          return current.filter((item) => item.id !== result.request.id);
        }

        return current.map((item) => (item.id === result.request.id ? result.request : item));
      });
      await Swal.fire({
        title: result.emailNotification === "warning" ? "Updated with warning" : "Updated",
        text: result.message || `Travel order ${nextStatusWord}.`,
        icon: result.emailNotification === "warning" ? "warning" : "success",
        confirmButtonColor: result.emailNotification === "warning" ? "#d97706" : "#0f766e",
      });
    } catch (error) {
      // A refused security check leaves the order exactly as it was, so it is reported as the check
      // refusing rather than as the update failing.
      await Swal.fire({
        title: isCaptchaFailure(error) ? "Security Check Failed" : "Update failed",
        text: error?.response?.data?.message || error?.message || "Unable to update travel order status.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  const handleBulkApprove = async () => {
    if (bulkApprovableRequests.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    try {
      await confirmBulkApproval({
        records: bulkApprovableRequests,
        noun: "travel order",
        getTarget: (request) => `travel:${request.id}`,
        approveRecord: (request, captcha) => updateTravelOrderStatus(request.id, "Approved", "", captcha),
        confirmationText: isPlanningOfficer
          ? `Authorize ${bulkApprovableRequests.length} selected travel order${bulkApprovableRequests.length === 1 ? "" : "s"} for dispatch to the Division Chief?`
          : `Approve ${bulkApprovableRequests.length} selected travel order${bulkApprovableRequests.length === 1 ? "" : "s"} at the workflow stage currently assigned to you?`,
        captchaNote: isPlanningOfficer
          ? "Answer the sum below to authorize the selected travel orders for dispatch."
          : "Answer the sum below to confirm the selected travel order approvals.",
        progressText: isPlanningOfficer
          ? "Authorizing selected travel orders for dispatch..."
          : "Approving selected travel orders...",
        onComplete: async () => {
          selection.clearSelection();
          await loadRequests({ background: true });
        },
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkArchive = async () => {
    if (bulkArchivableRequests.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    try {
      await confirmArchiveRecords({
        records: bulkArchivableRequests,
        getModule: () => "travel",
        noun: "travel order",
        onArchived: async () => {
          selection.clearSelection();
          await loadRequests({ background: true });
        },
      });
    } finally {
      setBulkBusy(false);
    }
  };

  /*
   * The status pill and the action buttons are shared by the table and by the narrow-screen cards
   * below it, so which actions a row offers is decided in one place for both.
   */
  const renderStatusBadge = (request) => {
    const pendingRoleLabel = getTravelPendingRoleLabel(request);
    const tableLabel = isAdmin && pendingRoleLabel
      ? "Pending"
      : pendingRoleLabel || (normalizeLeaveStatus(request.status) === "Rejected"
        ? getDisapprovedStatusLabel(request.rejectedByRole)
        : "");

    return (
      <LeaveStatusBadge
        status={request.status}
        rejectedByRole={request.rejectedByRole}
        simplified
        labelOverride={tableLabel}
      />
    );
  };

  const renderRequestActions = (request) => {
    const requestStatus = normalizeLeaveStatus(request.status);
    const isOwnRequest = isOwnTravelOrder(request, user);
    const decisionStage = isChiefAdmin ? "" : travelDecisionStage(request, roleKey, user);
    const isOpen = TRAVEL_OPEN_STATUSES.has(requestStatus);
    /*
     * The desk that owns the trip may call it off: the traveller, or the Chief who filed it on an
     * employee's behalf. It stops being theirs to cancel once the Regional Director has signed and the
     * order is only waiting on the employee's authorization.
     */
    const showOwnCancelAction = !TRAVEL_REVIEW_ONLY_ROLES.has(roleKey)
      && (isOwnRequest || isRequestFiledBy(request, user))
      && isOpen
      && !request.awaitingAuthorization;
    // Approve is offered by whichever desk the order is currently sitting on, and only that one.
    const showApproveAction = Boolean(decisionStage) && !isOwnRequest;
    // The employee's own step: the Director has signed and the COA clause is theirs to accept.
    const showAuthorizeAction = Boolean(request.awaitingAuthorization) && isOwnRequest;
    // Reject is the alternative to approving at the current desk; it is spent once approval lands.
    const showRejectAction = showApproveAction;
    /*
     * The completed form includes the employee's accepted COA authorization. Until that last step
     * changes the stored status to Approved, no desk receives a Print action.
     */
    const showPrintAction = requestStatus === "Approved" && Boolean(request.employeeAuthorizedAt);
    // Download PDF saves the same completed order, so it is offered exactly when Print is.
    const printActions = showPrintAction ? (
      <>
        <ActionIconButton
          label="Print travel order form"
          icon={faPrint}
          tone="print"
          onClick={() => handleAction("print", request)}
        />
        <ActionIconButton
          label="Download travel order form as PDF"
          text="Download PDF"
          icon={faFileArrowDown}
          tone="export"
          onClick={() => handleAction("download", request)}
        />
      </>
    ) : null;

    if (archiveView) {
      return (
        <ViewFormActions viewLabel="View travel order form" onView={() => handleAction("view", request)}>
          {printActions}
          <ActionIconButton
            label="Restore travel order"
            icon={faRotateLeft}
            tone="restore"
            onClick={() => handleAction("restore", request)}
          />
        </ViewFormActions>
      );
    }

    return (
      <ViewFormActions viewLabel="View travel order form" onView={() => handleAction("view", request)}>
        {printActions}
        {showAuthorizeAction ? (
          <ActionIconButton
            label="Accept the travel authorization"
            icon={faFileSignature}
            tone="approve"
            text="Authorize"
            onClick={() => handleAction("authorize", request)}
          />
        ) : null}
        {showApproveAction ? (
          <ActionIconButton
            label={decisionStage === "recommend" ? "Authorize this travel order for dispatch" : "Approve travel order"}
            icon={faCheck}
            tone="approve"
            text={decisionStage === "recommend" ? "Authorize for Dispatch" : undefined}
            onClick={() => handleAction("approve", request)}
          />
        ) : null}
        {showRejectAction ? (
          <ActionIconButton
            label="Disapprove travel order"
            icon={faXmark}
            tone="reject"
            text="Disapprove"
            onClick={() => handleAction("reject", request)}
          />
        ) : null}
        {showOwnCancelAction ? (
          <ActionIconButton
            label="Cancel travel order"
            icon={faBan}
            tone="cancel"
            onClick={() => handleAction("cancel", request)}
          />
        ) : null}
        {canArchiveRequest(request) ? (
          <ActionIconButton
            label="Archive travel order"
            icon={faBoxArchive}
            tone="archive"
            onClick={() => handleAction("archive", request)}
          />
        ) : null}
      </ViewFormActions>
    );
  };

  return (
    <div className="travel-order-workspace space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">
              {archiveView
                ? "Archived Travel Orders"
                : myView
                  ? "My Travel Orders"
                  : title}
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {archiveView
                ? "Travel orders moved to archive. Restore one to put it back in the list."
                : myView
                  ? (isChief
                    ? "Follow the travel orders you are travelling on, and see whose desk each one is on."
                    : "Follow the travel orders you filed or are travelling on, and see whose desk each one is on.")
                  : description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canToggleMyView && !archiveView ? (
              <button
                type="button"
                aria-pressed={myView}
                onClick={() => {
                  selection.clearSelection();
                  setMyView((current) => !current);
                  /* Own orders are followed at every stage, so the desk filter gives way to all. */
                  setStatus(myView ? defaultStatus : "");
                  setCurrentPage(1);
                }}
                className={`inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
                  myView
                    ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <UserRound size={16} />
                {myView ? "View All Travel Orders" : "View My Travel Orders"}
              </button>
            ) : null}
            {canArchive ? (
              <ArchiveViewToggle
                archiveView={archiveView}
                onToggle={(next) => {
                  selection.clearSelection();
                  setArchiveView(next);
                  setMyView(false);
                  setStatus(next ? "" : defaultStatus);
                  setCurrentPage(1);
                }}
                label="travel orders"
              />
            ) : null}
            {canCreateTravelOrder && !archiveView ? (
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
        </div>

        {!archiveView ? (
          <BulkSelectionToolbar
            selectedCount={selection.selectedCount}
            approveCount={bulkApprovableRequests.length}
            archiveCount={bulkArchivableRequests.length}
            busy={bulkBusy}
            approveLabel={isPlanningOfficer ? "Authorize selected for dispatch" : "Approve selected"}
            archiveLabel="Archive selected"
            onApprove={handleBulkApprove}
            onArchive={handleBulkArchive}
            onClear={selection.clearSelection}
          />
        ) : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_120px]">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Travel Orders</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={viewAllPermission ? "Search employee, destination, purpose" : "Search destination, purpose, remarks"}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              <option value="Pending">{isAdmin ? "Pending" : "Pending by Role"}</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Disapproved</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Travel Date</span>
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

        {/*
          * Narrow screens get the same rows as cards. The compact record table returns at `lg`,
          * which a zoomed-out browser reaches because zooming out widens the CSS viewport.
          */}
        <RecordCards
          className="mt-4 lg:hidden"
          items={paginatedRequests}
          loading={loading}
          loadingCards={3}
          empty={{
            icon: Filter,
            title: "No travel orders found",
            description: "Submit a travel request or adjust the filters.",
          }}
          renderCard={(request) => ({
            title: request.destination,
            subtitle: formatRequestDates(request),
            badge: renderStatusBadge(request),
            selection: !archiveView && (canArchiveRequest(request) || canBulkApproveRequest(request)) ? (
              <SelectionCheckbox
                checked={selection.isSelected(request)}
                onChange={() => selection.toggleRow(request)}
                label={`Select ${request.employeeName || "travel order"}`}
              />
            ) : null,
            fields: [
              { label: "Employee", value: request.employeeName },
              ...(showRequesterRole ? [{ label: "Role", value: <TravelRequesterRoleBadge role={request.employeeRole} /> }] : []),
              { label: "Division", value: formatRecordDivision(request) },
              { label: "Date Filed", value: formatDateDisplay(request.dateFiled) },
              { label: "Purpose", value: request.purpose || "No purpose provided", full: true },
            ],
            actions: renderRequestActions(request),
          })}
        />

        <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3 text-left">
                    {!archiveView && selectablePageRequests.length > 0 ? (
                      <SelectionCheckbox
                        checked={selection.areAllSelected(selectablePageRequests)}
                        indeterminate={selection.areSomeSelected(selectablePageRequests) && !selection.areAllSelected(selectablePageRequests)}
                        onChange={() => selection.toggleRows(selectablePageRequests)}
                        label="Select all travel orders on this page"
                      />
                    ) : null}
                  </th>
                  {["Employee", ...(showRequesterRole ? ["Role"] : []), "Division", "Status", "Date Filed", "Actions"].map((header) => (
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
                      <td colSpan={showRequesterRole ? 7 : 6} className="px-3 py-3">
                        <div className="h-5 rounded bg-slate-200" />
                      </td>
                    </tr>
                  ))
                ) : paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={showRequesterRole ? 7 : 6} className="px-4 py-12 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                        <Filter size={20} />
                      </div>
                      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No travel orders found</p>
                      <p className="m-0 mt-1 text-sm text-slate-500">Submit a travel request or adjust the filters.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRequests.map((request) => {
                    return (
                      <tr key={request.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3">
                          {!archiveView && (canArchiveRequest(request) || canBulkApproveRequest(request)) ? (
                            <SelectionCheckbox
                              checked={selection.isSelected(request)}
                              onChange={() => selection.toggleRow(request)}
                              label={`Select ${request.employeeName || "travel order"}`}
                            />
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-800">
                          <div className="font-semibold text-slate-900">{request.employeeName}</div>
                        </td>
                        {showRequesterRole ? (
                          <td className="px-3 py-3 text-sm text-slate-600"><TravelRequesterRoleBadge role={request.employeeRole} /></td>
                        ) : null}
                        <td className="px-3 py-3 text-sm text-slate-600">{formatRecordDivision(request)}</td>
                        <td className="px-3 py-3">{renderStatusBadge(request)}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(request.dateFiled)}</td>
                        <td className="px-3 py-3">
                          {renderRequestActions(request)}
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
        open={canCreateTravelOrder && modalOpen}
        submitting={submitting}
        employeeOptions={employeeOptions}
        defaultEmployeeRecordId={defaultEmployeeRecordId}
        fallbackEmployeeName={resolvedEmployee?.employeeName || user?.full_name || user?.username || ""}
        canSelectEmployee={allowEmployeeSelection}
        showHeaderCloseButton={showHeaderCloseButton}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmitRequest}
      />

      <TravelOrderPreviewModal
        request={selectedRequest}
        autoPrint={printRequest}
        autoDownload={downloadRequest}
        onClose={() => {
          setSelectedRequest(null);
          setPrintRequest(false);
          setDownloadRequest(false);
        }}
      />
    </div>
  );
}
