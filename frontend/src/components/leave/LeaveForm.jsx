import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "react-hot-toast";
import LeaveApplicationSheet, {
  downloadLeaveApplicationPdf,
  printLeaveApplicationSheet,
} from "./LeaveApplicationSheet";
import useAutoPrint from "../../hooks/useAutoPrint";
import { CSC_FORM_LEAVE_TYPES, mergeCscLeaveTypes } from "../../data/leaveTypes";
import { formatDateDisplay, getDurationDays } from "../../utils/leaveHelpers";
import { buildLeaveRequestQrPayload } from "../../utils/formQrCode";
import { getSelectedDatesRange } from "../../utils/dateSelection";
import { splitEmployeeName } from "../../utils/employeeName";
import { unpackLeaveReason } from "../../utils/leaveRequestDetails";
import { formatSignatureTimestamp } from "../../utils/signatureTimestamp";
import { floorToHalfDay, resolveCreditPoolName } from "../../utils/leaveWithoutPay";
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

export default function LeaveFormModal({
  open = false,
  request = null,
  employees = [],
  reviewer = null,
  showRegionalDirectorApproverSignature = false,
  autoPrint = false,
  autoDownload = false,
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
   * Opened from the Print or Download PDF action in the table rather than by a reader: print or save
   * the form once every load below has landed, then hand back to the caller so the sheet does not
   * linger on screen. `handlePrint` and `handleDownloadPdf` are only called from inside the frame
   * callback, well after they are initialised.
   */
  const trackLoad = useAutoPrint({
    active: open && (autoPrint || autoDownload),
    /* The PDF is saved asynchronously, so a download closes the sheet only once the file is out. */
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

  const handlePrint = () => printLeaveApplicationSheet(printRef.current, { title: "Application for Leave" });

  /* The Download PDF row action: the sheet Print would send to the printer, saved as a file instead. */
  const handleDownloadPdf = async () => {
    const toastId = toast.loading("Preparing the leave form PDF...");
    const employeeName = String(resolvedRequest?.employeeName || "")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    try {
      await downloadLeaveApplicationPdf(
        printRef.current,
        `Leave-Form-${employeeName || "Employee"}-${resolvedRequest?.id || "request"}.pdf`,
      );
      toast.success("Leave form PDF downloaded.", { id: toastId });
    } catch (error) {
      toast.error(error?.message || "Unable to download the leave form PDF.", { id: toastId });
    }
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
            <LeaveApplicationSheet
              sheetRef={printRef}
              formData={formData}
              leaveTypes={availableLeaveTypes}
              applicant={{ signatureDataUrl: employeeSignature, fallbackText: applicantTimestampLabel }}
              hrmo={{
                signed: hasHrmoSignatureBlock,
                signatureDataUrl: hrmoSignature,
                fallbackText: hrmoTimestampLabel,
                name: hrmoName,
                caption: hrmoCaption,
              }}
              chief={{
                signed: hasChiefSignatureBlock,
                signatureDataUrl: savedChiefSignature,
                fallbackText: chiefTimestampLabel,
                name: chiefName,
                caption: chiefCaption,
              }}
              regionalDirector={{
                signed: hasRegionalDirectorSignatureBlock,
                signatureDataUrl: regionalDirectorSignature,
                fallbackText: regionalDirectorTimestampLabel,
                name: regionalDirectorName,
              }}
              qrPayload={qrPayload}
            />

            {/* Print and Download PDF are row actions in the table, so the sheet itself only offers Close. */}
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

