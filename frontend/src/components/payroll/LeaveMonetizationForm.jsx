import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "react-hot-toast";
import LeaveApplicationSheet, {
  downloadLeaveApplicationPdf,
  printLeaveApplicationSheet,
} from "../leave/LeaveApplicationSheet";
import useAutoPrint from "../../hooks/useAutoPrint";
import { CSC_FORM_LEAVE_TYPES, mergeCscLeaveTypes } from "../../data/leaveTypes";
import { formatSignatureTimestamp } from "../../utils/signatureTimestamp";
import { buildLeaveMonetizationQrPayload } from "../../utils/formQrCode";
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
    // 6.B: a monetization is the form's "Other purpose", with what the credits are for beside it.
    leaveDetailVacationWithinChecked: false,
    leaveDetailVacationWithinNote: "",
    leaveDetailVacationAbroadChecked: false,
    leaveDetailVacationAbroadNote: "",
    leaveDetailSickHospitalChecked: false,
    leaveDetailSickHospitalNote: "",
    leaveDetailSickOutpatientChecked: false,
    leaveDetailSickOutpatientNote: "",
    leaveDetailWomen: "",
    leaveDetailStudyMasters: false,
    leaveDetailStudyReview: false,
    leaveDetailOtherMonetization: true,
    leaveDetailOtherTerminal: false,
    otherPurposeNote: String(record?.reason || ""),
    numberOfDays: formatCreditValue(monetizedDays),
    inclusiveDateRange: "N/A - Monetization of Leave Credits",
    // Monetizing credits turns them into pay, so commutation is always requested.
    commutation: "requested",
    creditsAsOf: leaveCreditSnapshot?.creditsAsOf ? toDateInputValue(leaveCreditSnapshot.creditsAsOf) : "",
    vlEarned: vacationRow.earned,
    vlLess: vacationRow.less,
    vlBalance: vacationRow.balance,
    slEarned: sickRow.earned,
    slLess: sickRow.less,
    slBalance: sickRow.balance,
    recommendation: isRejected ? "disapproved" : (record?.chiefReviewedByEmployeeRecordId ? "approved" : ""),
    disapprovalReason: isRejected ? rejectedNote : "",
    approvedDaysPay: isApproved ? formatCreditValue(monetizedDays) : "",
    approvedDaysNoPay: "",
    approvedOthers: isApproved && estimatedAmount > 0
      ? `Monetization - ${currencyFormatter.format(estimatedAmount)}`
      : (isApproved ? "Monetization of Leave Credits" : ""),
    disapprovedReason: isRejected ? rejectedNote : "",
  };
}

export default function LeaveMonetizationFormModal({
  open = false,
  record = null,
  reviewer = null,
  showHrmoReviewerSignature = false,
  showRegionalDirectorApproverSignature = false,
  autoPrint = false,
  autoDownload = false,
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [resolvedRecord, setResolvedRecord] = useState(record);
  const [employeeSignature, setEmployeeSignature] = useState("");
  const [reviewerSignature, setReviewerSignature] = useState("");
  const [savedHrmoSignature, setSavedHrmoSignature] = useState("");
  const [savedChiefSignature, setSavedChiefSignature] = useState("");
  const [savedRegionalDirectorSignature, setSavedRegionalDirectorSignature] = useState("");
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
    const loadChiefSignature = async () => {
      if (!open || !resolvedRecord?.chiefReviewedByEmployeeRecordId) {
        setSavedChiefSignature("");
        return;
      }
      try {
        const result = await getEmployeeSignature(resolvedRecord.chiefReviewedByEmployeeRecordId);
        if (mounted) setSavedChiefSignature(String(result?.employee?.signatureDataUrl || ""));
      } catch {
        if (mounted) setSavedChiefSignature("");
      }
    };
    void trackLoad(loadChiefSignature);
    return () => { mounted = false; };
  }, [open, resolvedRecord?.chiefReviewedByEmployeeRecordId, trackLoad]);

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
  /*
   * 7.A is captioned as on the leave request form: with the signing HR Head's own designation (or
   * position), and until someone signs, with the title of whoever holds the HR Head desk now.
   */
  const hrmoCaption = useMemo(() => {
    const hasSavedReviewer = Boolean(resolvedRecord?.reviewedByEmployeeRecordId || resolvedRecord?.reviewedByName);
    const position = hasSavedReviewer ? resolvedRecord?.reviewedByPosition : resolvedRecord?.hrHeadPosition;
    return String(position || "").trim() || "HRMO";
  }, [
    resolvedRecord?.hrHeadPosition,
    resolvedRecord?.reviewedByEmployeeRecordId,
    resolvedRecord?.reviewedByName,
    resolvedRecord?.reviewedByPosition,
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

  const qrPayload = useMemo(
    () => buildLeaveMonetizationQrPayload(resolvedRecord, formData),
    [formData, resolvedRecord]
  );

  const handlePrint = () => printLeaveApplicationSheet(printRef.current, { title: "Application for Leave Monetization" });

  /* The Download PDF row action: the sheet Print would send to the printer, saved as a file instead. */
  const handleDownloadPdf = async () => {
    const toastId = toast.loading("Preparing the leave monetization form PDF...");
    const employeeName = String(resolvedRecord?.employeeName || "")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    try {
      await downloadLeaveApplicationPdf(
        printRef.current,
        `Leave-Monetization-Form-${employeeName || "Employee"}-${resolvedRecord?.id || "request"}.pdf`,
      );
      toast.success("Leave monetization form PDF downloaded.", { id: toastId });
    } catch (error) {
      toast.error(error?.message || "Unable to download the leave monetization form PDF.", { id: toastId });
    }
  };

  if (!open || !resolvedRecord) {
    return null;
  }

  // Keep the viewport overlay outside animated workspace ancestors, whose transforms would clip it.
  return createPortal((
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
                signed: Boolean(resolvedRecord?.chiefReviewedByEmployeeRecordId),
                signatureDataUrl: savedChiefSignature,
                fallbackText: formatSignatureTimestamp(resolvedRecord?.chiefReviewedAt),
                name: resolvedRecord?.chiefReviewedByName || "",
                caption: "Division Chief",
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
