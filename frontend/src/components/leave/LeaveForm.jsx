import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import FormQrCode from "../UI/FormQrCode";
import useAutoPrint from "../../hooks/useAutoPrint";
import { CSC_FORM_LEAVE_TYPES, mergeCscLeaveTypes } from "../../data/leaveTypes";
import { formatDateDisplay, getDurationDays } from "../../utils/leaveHelpers";
import { buildLeaveRequestQrPayload } from "../../utils/formQrCode";
import { getSelectedDatesRange } from "../../utils/dateSelection";
import { splitEmployeeName } from "../../utils/employeeName";
import { unpackLeaveReason } from "../../utils/leaveRequestDetails";
import { formatSignatureTimestamp } from "../../utils/signatureTimestamp";
import { floorToHalfDay, resolveCreditPoolName } from "../../utils/leaveWithoutPay";
import { fitSheetToPrintArea, PRINT_AREA_WIDTH_MM, PRINT_PAGE_MARGIN_MM } from "../../utils/printSheetFit";
import { getCurrentEmployeeSignature, getEmployeeSignature } from "../../services/api";
import { fetchLeaveCredits, fetchLeaveRequestById, fetchLeaveTypes } from "../../services/leaveService";

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

function findEmployeeRecord(request, employees) {
  if (!request) {
    return null;
  }

  const requestEmployeeId = normalizeText(request.employeeId);
  const requestEmployeeName = normalizeText(request.employeeName);

  return employees.find((employee) => {
    const employeeId = normalizeText(employee.employeeId);
    const employeeName = normalizeText(employee.fullName);

    return (
      (requestEmployeeId && employeeId && requestEmployeeId === employeeId)
      || (requestEmployeeName && employeeName && requestEmployeeName === employeeName)
    );
  }) || null;
}

function formatSalary(employee) {
  const amount = Number(employee?.basicSalary);
  if (!amount) {
    return "";
  }

  const formatted = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount);

  return employee?.salaryRate ? `${formatted} / ${employee.salaryRate}` : formatted;
}

function mapLeaveType(leaveType, availableLeaveTypes) {
  const normalized = normalizeText(leaveType);

  if (normalized === "vawc leave") {
    return "10-Day VAWC Leave";
  }

  if (normalized === "calamity leave") {
    return "Special Emergency (Calamity) Leave";
  }

  return availableLeaveTypes.find((item) => normalizeText(item) === normalized) || "";
}

function formatInclusiveDates(startDate, endDate) {
  if (!startDate && !endDate) {
    return "";
  }

  if (!startDate || !endDate || startDate === endDate) {
    return formatDateDisplay(startDate || endDate);
  }

  return `${formatDateDisplay(startDate)} - ${formatDateDisplay(endDate)}`;
}

function formatMonthDisplay(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return "";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
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

function toDayCount(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

/*
 * Credits are only deducted once a request is approved, so a request still awaiting action has to
 * show the balance it will leave behind rather than the balance on file today.
 */
function resolvePendingBalance(balance, chargedDays, requestStatus) {
  if (!balance) {
    return "";
  }

  const remaining = Number(balance.remaining ?? balance.total ?? 0);
  const isAwaitingAction = ["submitted", "pending", "endorsed", "reviewed", "chief reviewed", "chief_reviewed"].includes(requestStatus);
  const projectedRemaining = isAwaitingAction
    ? Math.max(0, remaining - chargedDays)
    : Math.max(0, remaining);

  return formatCreditValue(projectedRemaining);
}

export function buildFormData(request, employees, leaveCreditSnapshot = null, availableLeaveTypes = CSC_FORM_LEAVE_TYPES) {
  const employeeRecord = findEmployeeRecord(request, employees);
  const nameParts = splitEmployeeName(request?.employeeName || employeeRecord?.fullName || "");
  const matchedLeaveType = mapLeaveType(request?.leaveType, availableLeaveTypes);
  const leaveTypeOther = matchedLeaveType ? "" : String(request?.leaveType || "");
  const { visibleReason, details } = unpackLeaveReason(request?.reason);
  const normalizedReason = normalizeText(visibleReason);
  const normalizedLeaveType = normalizeText(matchedLeaveType || leaveTypeOther);
  const normalizedStatus = normalizeText(request?.status);
  const rejectedNote = String(request?.rejectedNote || "").trim();

  const isVacationOrPrivilege = normalizedLeaveType === "vacation leave" || normalizedLeaveType === "special privilege leave";
  const isSickLeave = normalizedLeaveType === "sick leave";
  const isWomenLeave = normalizedLeaveType === "special leave benefits for women";
  const isStudyLeave = normalizedLeaveType === "study leave";
  const isRejected = normalizedStatus === "rejected";
  const leaveCreditsMap = leaveCreditSnapshot?.balanceMap || {};
  const vacationCredits = leaveCreditsMap["Vacation Leave"] || null;
  const sickCredits = leaveCreditsMap["Sick Leave"] || null;
  const vacationScope = details.vacationScope || (/abroad|outside the philippines|international|overseas/.test(normalizedReason) ? "abroad" : (isVacationOrPrivilege ? "within_philippines" : ""));
  const sickLeaveMode = details.sickLeaveMode || (/out patient|outpatient/.test(normalizedReason) ? "out_patient" : (isSickLeave ? "in_hospital" : ""));
  const studyLeavePurpose = details.studyLeavePurpose
    || (/master'?s|masters/.test(normalizedReason) ? "masters" : "")
    || (/bar|board/.test(normalizedReason) ? "bar_review" : "");
  const numberOfDays = request?.numberOfDays || getDurationDays(request?.startDate, request?.endDate) || "";
  const requestedDays = Number(numberOfDays || 0);
  /*
   * A request filed beyond the employee's remaining credits carries Leave Without Pay days. Only
   * the with pay portion is charged against the certified credits in 7.A, and 7.C reports both.
   * Credits are also only spendable in whole days or half days, so a 1.25 day balance pays for 1
   * day and the leftover quarter stays on the balance. Flooring here keeps requests filed before
   * the API applied the same rule from printing a duration that cannot be availed.
   */
  const paidDays = floorToHalfDay(Math.min(toDayCount(request?.paidDays, requestedDays), requestedDays));
  const unpaidDays = Math.max(0, toDayCount(request?.unpaidDays, 0), requestedDays - paidDays);
  const certifiedChargedDays = isRejected ? 0 : paidDays;
  const hasActionableStatus = ["submitted", "pending", "endorsed", "reviewed", "chief reviewed", "chief_reviewed", "approved"].includes(normalizedStatus);
  const hasChiefApproval = ["chief reviewed", "chief_reviewed", "approved"].includes(normalizedStatus);
  /*
   * 7.A certifies the credits this application draws from, so only the applied leave type's column
   * is filled. Leaving the other column blank keeps unrelated balances off the certification.
   */
  const chargesVacationCredits = resolveCreditPoolName(normalizedLeaveType) === "vacation leave";
  const chargesSickCredits = isSickLeave;
  const creditsAsOf = leaveCreditSnapshot?.creditsAsOf
    ? toDateInputValue(leaveCreditSnapshot.creditsAsOf)
    : "";
  const selectedDateRange = getSelectedDatesRange(details.leaveDays);
  const inclusiveDateRange = normalizedLeaveType === "maternity leave" && details.maternityMonth
    ? formatMonthDisplay(details.maternityMonth)
    : formatInclusiveDates(
      selectedDateRange.startDate || request?.startDate,
      selectedDateRange.endDate || request?.endDate
    );

  return {
    office: request?.division || employeeRecord?.department || "",
    lastName: nameParts.lastName,
    firstName: nameParts.firstName,
    middleName: nameParts.middleName,
    applicantName: request?.employeeName || employeeRecord?.fullName || "",
    dateOfFiling: toDateInputValue(request?.dateFiled),
    /*
     * Most dashboards render the form without an employee directory to match against, so the
     * request's own employee details are the reliable source and the directory is the fallback.
     */
    position: request?.position || employeeRecord?.position || "",
    salary: formatSalary(Number(request?.basicSalary) > 0 ? request : employeeRecord),
    leaveType: matchedLeaveType,
    leaveTypeOther,
    leaveDetailVacationWithinChecked: isVacationOrPrivilege && vacationScope === "within_philippines",
    leaveDetailVacationWithinNote: isVacationOrPrivilege && vacationScope === "within_philippines" ? visibleReason : "",
    leaveDetailVacationAbroadChecked: isVacationOrPrivilege && vacationScope === "abroad",
    leaveDetailVacationAbroadNote: isVacationOrPrivilege && vacationScope === "abroad" ? (details.vacationNote || visibleReason) : "",
    leaveDetailSickHospitalChecked: isSickLeave && sickLeaveMode === "in_hospital",
    leaveDetailSickHospitalNote: isSickLeave && sickLeaveMode === "in_hospital" ? (details.sickLeaveIllness || visibleReason) : "",
    leaveDetailSickOutpatientChecked: isSickLeave && sickLeaveMode === "out_patient",
    leaveDetailSickOutpatientNote: isSickLeave && sickLeaveMode === "out_patient" ? (details.sickLeaveIllness || visibleReason) : "",
    leaveDetailWomen: isWomenLeave ? visibleReason : "",
    leaveDetailStudyMasters: isStudyLeave && studyLeavePurpose === "masters",
    leaveDetailStudyReview: isStudyLeave && studyLeavePurpose === "bar_review",
    leaveDetailOtherMonetization: false,
    leaveDetailOtherTerminal: false,
    numberOfDays: String(numberOfDays || ""),
    /*
     * The form reports the inclusive span only. Exact selected working days remain in the request
     * metadata for duration and overlap checks, without crowding the printed CSC form.
    */
    inclusiveDateRange,
    commutation: "",
    creditsAsOf,
    vlEarned: chargesVacationCredits ? formatCreditValue(vacationCredits?.total) : "",
    vlLess: chargesVacationCredits ? formatCreditValue(certifiedChargedDays) : "",
    vlBalance: chargesVacationCredits ? resolvePendingBalance(vacationCredits, certifiedChargedDays, normalizedStatus) : "",
    slEarned: chargesSickCredits ? formatCreditValue(sickCredits?.total) : "",
    slLess: chargesSickCredits ? formatCreditValue(certifiedChargedDays) : "",
    slBalance: chargesSickCredits ? resolvePendingBalance(sickCredits, certifiedChargedDays, normalizedStatus) : "",
    recommendation: isRejected ? "disapproved" : (hasChiefApproval ? "approved" : ""),
    disapprovalReason: isRejected ? rejectedNote : "",
    approvedDaysPay: hasActionableStatus ? formatCreditValue(paidDays) : "",
    approvedDaysNoPay: hasActionableStatus && unpaidDays > 0 ? formatCreditValue(unpaidDays) : "",
    approvedOthers: "",
    /* The rejection note is already printed under 7.B Recommendation. */
    disapprovedReason: "",
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
    boxShadow: "0 25px 60px rgba(15, 23, 42, 0.25)",
  },
  // The logo header sits outside the ruled box; only the numbered sections are framed.
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "20px",
    padding: "12px",
    textAlign: "center",
  },
  body: {
    border: "2px solid #000",
  },
  logoImage: {
    width: "130px",
    height: "130px",
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
  selectionBox: {
    width: "13px",
    height: "13px",
    border: "1px solid #000",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: "bold",
    lineHeight: 1,
    color: "#111827",
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
  // (empty) | Regional Director signature | QR. The equal side columns keep the signature centred.
  qrFooter: {
    display: "grid",
    gridTemplateColumns: "1fr 2fr 1fr",
    alignItems: "end",
    gap: "10px",
    padding: "6px 8px",
  },
  qrColumn: {
    gridColumn: 3,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "3px",
  },
  qrFooterNote: {
    fontSize: "8px",
    lineHeight: 1.4,
    color: "#111827",
    textAlign: "right",
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

/*
 * Print-only tightening for the cloned sheet. The on-screen form sizes itself with inline styles,
 * so these rules need `!important` to take over; the class names are hooks that only this print
 * window styles. The CSC Form No. 6 keeps its layout — only spacing, logos, type and QR shrink.
 */
const LEAVE_FORM_PRINT_CSS = `
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

  .print-shell > .leave-form-paper {
    width: ${PRINT_AREA_WIDTH_MM}mm !important;
    max-width: none !important;
    margin: 0 !important;
    box-shadow: none !important;
    font-size: 9.5px !important;
  }

  .leave-print-header { gap: 14px !important; padding: 0 4px 5px !important; }
  .leave-print-header img { width: 62px !important; height: 62px !important; }
  .leave-print-header p { margin: 0 !important; font-size: 9px !important; }
  .leave-print-header h3 { margin: 2px 0 !important; font-size: 11px !important; }
  .leave-print-title { margin-top: 3px !important; font-size: 14px !important; }

  .leave-print-section { padding: 2px !important; font-size: 10px !important; }
  .leave-print-row > div { padding: 3px 6px !important; }
  .leave-print-row p { margin-top: 2px !important; margin-bottom: 2px !important; }
  .leave-print-row .leave-print-sublabel { margin: 3px 0 1px !important; font-size: 8.5px !important; }
  .leave-print-check { gap: 4px !important; margin-bottom: 1px !important; font-size: 9px !important; }
  .leave-form-paper label { margin-bottom: 2px !important; font-size: 8px !important; }
  .leave-form-paper input:not([type="checkbox"]) { padding: 0 1px !important; font-size: 9.5px !important; }
  .leave-form-paper input[type="checkbox"] { width: 10px !important; height: 10px !important; }
  .leave-form-paper th,
  .leave-form-paper td { padding: 1px 3px !important; font-size: 9px !important; }

  .leave-print-sign { margin-top: 6px !important; }
  .leave-print-signature { min-height: 30px !important; }
  .leave-print-sign img { max-height: 32px !important; }

  /* About 23 mm across: still roughly 0.4 mm a module for the payload's QR version, which a phone reads. */
  .leave-print-qr { padding: 3px 6px !important; }
  .leave-print-qr svg { width: 88px !important; height: 88px !important; }
`;

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
    <div className="leave-print-sign" style={{ marginTop: "20px", textAlign: "center" }}>
      <div className="leave-print-signature" style={styles.signaturePreview}>
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

export default function LeaveFormModal({
  open = false,
  request = null,
  employees = [],
  reviewer = null,
  showRegionalDirectorApproverSignature = false,
  autoPrint = false,
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [resolvedRequest, setResolvedRequest] = useState(request);
  const [employeeSignature, setEmployeeSignature] = useState("");
  const [reviewerSignature, setReviewerSignature] = useState("");
  const [savedHrmoSignature, setSavedHrmoSignature] = useState("");
  const [savedRegionalDirectorSignature, setSavedRegionalDirectorSignature] = useState("");
  const [savedChiefSignature, setSavedChiefSignature] = useState("");
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
      setResolvedRequest(request);
      return;
    }

    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open, request]);

  useEffect(() => {
    let mounted = true;

    const loadResolvedRequest = async () => {
      if (!open || !request?.id) {
        setResolvedRequest(request);
        return;
      }

      try {
        const result = await fetchLeaveRequestById(request.id);
        if (!mounted) {
          return;
        }

        setResolvedRequest(result?.request || request);
      } catch {
        if (mounted) {
          setResolvedRequest(request);
        }
      }
    };

    void trackLoad(loadResolvedRequest);
    return () => {
      mounted = false;
    };
  }, [open, request, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadSignature = async () => {
      if (!open || !resolvedRequest?.employeeRecordId) {
        setEmployeeSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(resolvedRequest.employeeRecordId);
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

    void trackLoad(loadSignature);
    return () => {
      mounted = false;
    };
  }, [open, resolvedRequest?.employeeRecordId, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadReviewerSignature = async () => {
      const needsCurrentViewerSignature = open && (
        showRegionalDirectorApproverSignature
        && normalizeText(resolvedRequest?.status) === "approved"
        && !resolvedRequest?.approvedByEmployeeRecordId
      );

      if (!needsCurrentViewerSignature) {
        setReviewerSignature("");
        return;
      }

      try {
        const result = await getCurrentEmployeeSignature();
        if (!mounted) {
          return;
        }

        setReviewerSignature(String(result?.employee?.signatureDataUrl || ""));
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
    resolvedRequest?.approvedByEmployeeRecordId,
    resolvedRequest?.status,
    showRegionalDirectorApproverSignature,
    trackLoad,
  ]);

  useEffect(() => {
    let mounted = true;

    const loadSavedHrmoSignature = async () => {
      if (!open || !resolvedRequest?.reviewedByEmployeeRecordId) {
        setSavedHrmoSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(resolvedRequest.reviewedByEmployeeRecordId);
        if (!mounted) {
          return;
        }

        setSavedHrmoSignature(String(result?.employee?.signatureDataUrl || ""));
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
  }, [open, resolvedRequest?.reviewedByEmployeeRecordId, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadSavedRegionalDirectorSignature = async () => {
      if (!open || !resolvedRequest?.approvedByEmployeeRecordId) {
        setSavedRegionalDirectorSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(resolvedRequest.approvedByEmployeeRecordId);
        if (!mounted) {
          return;
        }

        setSavedRegionalDirectorSignature(String(result?.employee?.signatureDataUrl || ""));
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
  }, [open, resolvedRequest?.approvedByEmployeeRecordId, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadSavedChiefSignature = async () => {
      if (!open || !resolvedRequest?.chiefReviewedByEmployeeRecordId) {
        setSavedChiefSignature("");
        return;
      }

      try {
        const result = await getEmployeeSignature(resolvedRequest.chiefReviewedByEmployeeRecordId);
        if (!mounted) {
          return;
        }

        setSavedChiefSignature(String(result?.employee?.signatureDataUrl || ""));
      } catch {
        if (mounted) {
          setSavedChiefSignature("");
        }
      }
    };

    void trackLoad(loadSavedChiefSignature);
    return () => {
      mounted = false;
    };
  }, [open, resolvedRequest?.chiefReviewedByEmployeeRecordId, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadLeaveCredits = async () => {
      if (!open || !resolvedRequest?.employeeRecordId) {
        setLeaveCredits(null);
        return;
      }

      const requestYear = /^\d{4}/.test(String(resolvedRequest?.startDate || ""))
        ? Number(String(resolvedRequest.startDate).slice(0, 4))
        : null;

      try {
        const result = await fetchLeaveCredits(resolvedRequest.employeeRecordId, requestYear);
        if (!mounted) {
          return;
        }

        setLeaveCredits(result?.credits || null);
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
  }, [open, resolvedRequest?.employeeRecordId, resolvedRequest?.startDate, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const loadLeaveTypes = async () => {
      if (!open) {
        return;
      }

      try {
        const result = await fetchLeaveTypes();
        if (!mounted) {
          return;
        }

        setConfiguredLeaveTypes(result?.leaveTypes || []);
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
    () => buildFormData(resolvedRequest, employees, leaveCredits, availableLeaveTypes),
    [availableLeaveTypes, employees, leaveCredits, resolvedRequest]
  );
  const reviewerName = useMemo(
    () => String(reviewer?.full_name || reviewer?.fullName || reviewer?.username || "").trim(),
    [reviewer]
  );
  const normalizedRequestStatus = useMemo(
    () => normalizeText(resolvedRequest?.status),
    [resolvedRequest?.status]
  );
  const applicantTimestampLabel = useMemo(
    () => formatSignatureTimestamp(resolvedRequest?.requestedAt || resolvedRequest?.createdAt || resolvedRequest?.dateFiled),
    [resolvedRequest?.createdAt, resolvedRequest?.dateFiled, resolvedRequest?.requestedAt]
  );
  const hrmoName = useMemo(
    () => String(resolvedRequest?.reviewedByName || "").trim(),
    [resolvedRequest?.reviewedByName]
  );
  const hrmoSignature = useMemo(
    () => savedHrmoSignature,
    [savedHrmoSignature]
  );
  const hasHrmoSignatureBlock = useMemo(
    () => Boolean(resolvedRequest?.reviewedByEmployeeRecordId || resolvedRequest?.reviewedByName),
    [resolvedRequest?.reviewedByEmployeeRecordId, resolvedRequest?.reviewedByName]
  );
  /*
   * 7.A is captioned with the signing HR Head's own designation (or position, when they have none),
   * not a fixed title. Before anyone has signed, the blank line names the title of whoever holds the
   * HR Head desk now; "HRMO" is only the last resort when neither is on file.
   */
  const hrmoCaption = useMemo(() => {
    const position = hasHrmoSignatureBlock
      ? resolvedRequest?.reviewedByPosition
      : resolvedRequest?.hrHeadPosition;
    return String(position || "").trim() || "HRMO";
  }, [hasHrmoSignatureBlock, resolvedRequest?.hrHeadPosition, resolvedRequest?.reviewedByPosition]);
  const hrmoTimestampLabel = useMemo(() => {
    const hasSavedReviewer = Boolean(resolvedRequest?.reviewedByEmployeeRecordId || resolvedRequest?.reviewedByName);
    return hasSavedReviewer
      ? formatSignatureTimestamp(resolvedRequest?.reviewedAt || resolvedRequest?.updatedAt || resolvedRequest?.dateFiled)
      : "";
  }, [
    resolvedRequest?.dateFiled,
    resolvedRequest?.reviewedAt,
    resolvedRequest?.reviewedByEmployeeRecordId,
    resolvedRequest?.reviewedByName,
    resolvedRequest?.updatedAt,
  ]);
  /*
   * 7.B is the division Chief's recommendation. The Chief signs it whether they approve or reject,
   * and the signature is captioned with their own designation (or position) and division code ("Unit Head,
   * GD"), as the printed CSC form reads "Chief, MMD".
   */
  const hasChiefSignatureBlock = Boolean(
    resolvedRequest?.chiefReviewedByEmployeeRecordId || resolvedRequest?.chiefReviewedByName
  );
  const chiefName = String(resolvedRequest?.chiefReviewedByName || "").trim();
  const chiefCaption = [
    String(resolvedRequest?.chiefReviewedByPosition || "").trim() || "Division Chief",
    String(resolvedRequest?.chiefReviewedByDivisionCode || "").trim(),
  ].filter(Boolean).join(", ");
  const chiefTimestampLabel = useMemo(
    () => (hasChiefSignatureBlock
      ? formatSignatureTimestamp(resolvedRequest?.chiefReviewedAt || resolvedRequest?.updatedAt)
      : ""),
    [hasChiefSignatureBlock, resolvedRequest?.chiefReviewedAt, resolvedRequest?.updatedAt]
  );
  const regionalDirectorName = useMemo(
    () => String(
      resolvedRequest?.approvedByName
      || (showRegionalDirectorApproverSignature && normalizedRequestStatus === "approved" ? reviewerName : "")
    ).trim(),
    [normalizedRequestStatus, resolvedRequest?.approvedByName, reviewerName, showRegionalDirectorApproverSignature]
  );
  const regionalDirectorSignature = useMemo(
    () => savedRegionalDirectorSignature || (
      !resolvedRequest?.approvedByEmployeeRecordId
      && showRegionalDirectorApproverSignature
      && normalizedRequestStatus === "approved"
        ? reviewerSignature
        : ""
    ),
    [
      normalizedRequestStatus,
      resolvedRequest?.approvedByEmployeeRecordId,
      reviewerSignature,
      savedRegionalDirectorSignature,
      showRegionalDirectorApproverSignature,
    ]
  );
  const regionalDirectorTimestampLabel = useMemo(() => {
    const hasSavedApprover = Boolean(
      resolvedRequest?.approvedByEmployeeRecordId
      || resolvedRequest?.approvedByName
      || normalizedRequestStatus === "approved"
    );
    return hasSavedApprover
      ? formatSignatureTimestamp(resolvedRequest?.approvedAt || resolvedRequest?.updatedAt || resolvedRequest?.dateFiled)
      : "";
  }, [
    normalizedRequestStatus,
    resolvedRequest?.approvedAt,
    resolvedRequest?.approvedByEmployeeRecordId,
    resolvedRequest?.approvedByName,
    resolvedRequest?.dateFiled,
    resolvedRequest?.updatedAt,
  ]);
  const hasRegionalDirectorSignatureBlock = useMemo(
    () => Boolean(
      resolvedRequest?.approvedByEmployeeRecordId
      || resolvedRequest?.approvedByName
      || (showRegionalDirectorApproverSignature && normalizedRequestStatus === "approved")
    ),
    [
      normalizedRequestStatus,
      resolvedRequest?.approvedByEmployeeRecordId,
      resolvedRequest?.approvedByName,
      showRegionalDirectorApproverSignature,
    ]
  );
  const qrPayload = useMemo(
    () => buildLeaveRequestQrPayload(resolvedRequest, formData),
    [formData, resolvedRequest]
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
        return;
      }

      if (field instanceof HTMLSelectElement && clonedField instanceof HTMLSelectElement) {
        clonedField.value = field.value;
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
          <title>Application for Leave</title>
          <style>${LEAVE_FORM_PRINT_CSS}</style>
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

  if (!open || !resolvedRequest) {
    return null;
  }

  // Keep the viewport overlay outside animated workspace ancestors, whose transforms would clip it.
  return createPortal((
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close leave form preview"
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
            <h2 className="m-0 text-lg font-semibold text-slate-950">Leave Request Form</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Centered overlay preview of the submitted leave request.</p>
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
          <div className="leave-print-header" style={styles.header}>
            <img src="/mgb.png" alt="MGB Logo" style={styles.logoImage} />
            <div>
              <p style={{ margin: "1px 0", fontSize: "10px" }}>Republic of the Philippines</p>
              <p style={{ margin: "1px 0", fontSize: "10px" }}>Department of Environment and Natural Resources</p>
              <h3 style={{ margin: "4px 0", fontSize: "12px", fontWeight: "bold" }}>
                MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE NO. X
              </h3>
              <p style={{ margin: "1px 0", fontSize: "10px" }}>DENR-X Compound, Puntod, Cagayan de Oro City</p>
              <div className="leave-print-title" style={styles.formTitle}>APPLICATION FOR LEAVE</div>
            </div>
            <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={styles.logoImage} />
          </div>

          <div style={styles.body}>
          <div className="leave-print-row" style={styles.row}>
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
                  <div
                    key={field}
                    style={{
                      flex: 1,
                      paddingInline: "4px",
                    }}
                  >
                    <span style={{ fontSize: "8px", fontStyle: "italic", display: "block" }}>{label}</span>
                    {/* An input does not inherit text-align, so each name is centred under its caption here. */}
                    <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, textAlign: "center" }} value={formData[field]} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="leave-print-row" style={styles.row}>
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

          <div className="leave-print-section" style={styles.sectionTitle}>6. DETAILS OF APPLICATION</div>
          <div className="leave-print-row" style={styles.row}>
            <div style={{ ...styles.cell, width: "50%" }}>
              <label style={styles.label}>6.A Type of Leave to be Availed of</label>
              {availableLeaveTypes.map((type) => (
                <div key={type} className="leave-print-check" style={styles.checklistItem}>
                  <SelectionIndicator checked={formData.leaveType === type} />
                  <span>{type}</span>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "flex-end", marginTop: "5px", gap: "4px" }}>
                <span>Others:</span>
                <ReadOnlyInput
                  style={{ ...styles.input, flex: 1 }}
                  value={formData.leaveTypeOther}
                />
              </div>
            </div>

            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>6.B Details of Leave</label>

              <p className="leave-print-sublabel" style={styles.subLabel}>In case of Vacation/Special Privilege Leave:</p>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailVacationWithinChecked} />
                <span>Within the Philippines</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailVacationWithinNote} />
              </div>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailVacationAbroadChecked} />
                <span>Abroad (Specify)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailVacationAbroadNote} />
              </div>

              <p className="leave-print-sublabel" style={styles.subLabel}>In case of Sick Leave:</p>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailSickHospitalChecked} />
                <span>In Hospital (Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailSickHospitalNote} />
              </div>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailSickOutpatientChecked} />
                <span>Out Patient (Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailSickOutpatientNote} />
              </div>

              <p className="leave-print-sublabel" style={styles.subLabel}>In case of Special Leave Benefits for Women:</p>
              <div style={{ display: "flex", gap: "4px", alignItems: "flex-end" }}>
                <span style={{ whiteSpace: "nowrap" }}>(Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailWomen} />
              </div>

              <p className="leave-print-sublabel" style={styles.subLabel}>In case of Study Leave:</p>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailStudyMasters} />
                <span>Completion of Master's Degree</span>
              </div>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailStudyReview} />
                <span>BAR/Board Examination Review</span>
              </div>

              <p className="leave-print-sublabel" style={styles.subLabel}>Other purpose:</p>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailOtherMonetization} />
                <span>Monetization of Leave Credits</span>
              </div>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailOtherTerminal} />
                <span>Terminal Leave</span>
              </div>
            </div>
          </div>

          <div className="leave-print-row" style={styles.row}>
            <div style={{ ...styles.cell, width: "50%" }}>
              <label style={styles.label}>6.C Number of Working Days Applied For</label>
              <ReadOnlyInput
                style={{ ...styles.input, margin: "10px 0", display: "block" }}
                value={formData.numberOfDays}
              />
              <label style={styles.label}>Inclusive Dates</label>
              <div style={{ margin: "8px 0 6px" }}>
                <div
                  style={{
                    ...styles.input,
                    minHeight: "22px",
                    padding: "2px 0 4px",
                    display: "block",
                    textTransform: "none",
                  }}
                >
                  {formData.inclusiveDateRange}
                </div>
              </div>
            </div>
            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>6.D Commutation</label>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.commutation === "not_requested"} />
                Not Requested
              </div>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.commutation === "requested"} />
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

          <div className="leave-print-section" style={styles.sectionTitle}>7. DETAILS OF ACTION ON APPLICATION</div>
          <div className="leave-print-row" style={styles.row}>
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
                  caption={hrmoCaption}
                />
              ) : (
                <div className="leave-print-sign" style={{ marginTop: "20px", textAlign: "center" }}>
                  <div style={styles.sigLine}>{hrmoCaption}</div>
                </div>
              )}
            </div>

            {/* A column so the Chief's signature sits at the bottom, level with the HR Head's in 7.A. */}
            <div style={{ ...styles.cell, width: "50%", borderRight: "none", display: "flex", flexDirection: "column" }}>
              <label style={styles.label}>7.B Recommendation</label>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.recommendation === "approved"} />
                For approval
              </div>
              <div className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.recommendation === "disapproved"} />
                For disapproval due to:
              </div>
              <ReadOnlyInput
                style={{ ...inputWithoutUnderlineStyle, display: "block", marginTop: "10px", height: "40px" }}
                value={formData.disapprovalReason}
              />
              <div style={{ marginTop: "auto" }}>
                {hasChiefSignatureBlock ? (
                  <SignatureBlock
                    signatureDataUrl={savedChiefSignature}
                    fallbackText={chiefTimestampLabel}
                    name={chiefName}
                    caption={chiefCaption}
                  />
                ) : (
                  <div className="leave-print-sign" style={{ marginTop: "20px", textAlign: "center" }}>
                    <div style={styles.sigLine}>{chiefCaption}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 7.C and 7.D share one open box with the QR footer, as on the printed CSC form. */}
          <div className="leave-print-row" style={{ ...styles.row, borderBottom: "none" }}>
            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
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
                <ReadOnlyInput style={{ ...styles.input, width: "40px" }} value={formData.approvedOthers} />
                <span style={{ whiteSpace: "nowrap" }}>others (Specify)</span>
              </div>
            </div>
            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>7.D Disapproved Due To:</label>
              <ReadOnlyInput
                style={{ ...inputWithoutUnderlineStyle, display: "block", height: "20px" }}
                value={formData.disapprovedReason}
              />
            </div>
          </div>

          {/*
           * The Regional Director signs centred under both 7.C and 7.D, as on the printed CSC form,
           * with the QR raised beside the signature rather than in a band of its own below it.
           */}
          <div className="leave-print-qr" style={styles.qrFooter}>
            <div style={{ gridColumn: 2 }}>
              {hasRegionalDirectorSignatureBlock ? (
                <SignatureBlock
                  signatureDataUrl={regionalDirectorSignature}
                  fallbackText={regionalDirectorTimestampLabel}
                  name={regionalDirectorName}
                  caption="OIC, Regional Director"
                />
              ) : (
                <div className="leave-print-sign" style={{ marginTop: "20px", textAlign: "center" }}>
                  <div style={styles.sigLine}>OIC, Regional Director</div>
                </div>
              )}
            </div>
            {/* The LR reference stays inside the QR payload; only the printed caption was replaced. */}
            <div style={styles.qrColumn}>
              <FormQrCode
                value={qrPayload}
                size={118}
                align="right"
                caption=""
                logoSrc="/MGB-Logo-remove-background.png"
                logoAspectRatio={204 / 189}
              />
              <div style={styles.qrFooterNote}>
                This is an official Leave Form approved digitally and generated from the MGB-X Online
                Leave Form.
              </div>
            </div>
          </div>
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
  ), document.body);
}

