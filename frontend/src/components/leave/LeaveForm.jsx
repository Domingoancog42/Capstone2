import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { formatDateDisplay, getDurationDays } from "../../utils/leaveHelpers";
import { unpackLeaveReason } from "../../utils/leaveRequestDetails";
import { buildSignatureTimestampLabel } from "../../utils/signatureTimestamp";
import { getCurrentEmployeeSignature, getEmployeeSignature } from "../../services/api";
import { fetchLeaveCredits, fetchLeaveRequestById, fetchLeaveTypes } from "../../services/leaveService";

const cscLeaveTypes = [
  "Vacation Leave",
  "Mandatory/Forced Leave",
  "Sick Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Special Privilege Leave",
  "Solo Parent Leave",
  "Study Leave",
  "10-Day VAWC Leave",
  "Rehabilitation Privilege",
  "Special Leave Benefits for Women",
  "Special Emergency (Calamity) Leave",
  "Adoption Leave",
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function mergeLeaveTypes(configuredLeaveTypes) {
  const merged = [...cscLeaveTypes];
  const seen = new Set(merged.map(normalizeText));

  (configuredLeaveTypes || []).forEach((leaveType) => {
    const name = String(leaveType?.name ?? leaveType ?? "").trim();
    const normalized = normalizeText(name);

    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    merged.push(name);
  });

  return merged;
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

function splitEmployeeName(fullName) {
  const name = String(fullName || "").trim();
  if (!name) {
    return { firstName: "", middleName: "", lastName: "" };
  }

  if (name.includes(",")) {
    const [lastName, remaining = ""] = name.split(",");
    const parts = remaining.trim().split(/\s+/).filter(Boolean);
    return {
      lastName: lastName.trim(),
      firstName: parts[0] || "",
      middleName: parts.slice(1).join(" "),
    };
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], middleName: "", lastName: "" };
  }

  if (parts.length === 2) {
    return { firstName: parts[0], middleName: "", lastName: parts[1] };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
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

  if (startDate && endDate && startDate === endDate) {
    return formatDateDisplay(startDate);
  }

  return `${formatDateDisplay(startDate)} to ${formatDateDisplay(endDate)}`;
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

function resolvePendingBalance(balance, requestedDays, appliesToRequestedType, requestStatus) {
  if (!balance) {
    return "";
  }

  const remaining = Number(balance.remaining ?? balance.total ?? 0);
  const projectedRemaining = appliesToRequestedType && requestStatus === "pending"
    ? Math.max(0, remaining - requestedDays)
    : Math.max(0, remaining);

  return formatCreditValue(projectedRemaining);
}

function buildFormData(request, employees, leaveCreditSnapshot = null, availableLeaveTypes = cscLeaveTypes) {
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
  const creditsAsOf = leaveCreditSnapshot?.creditsAsOf
    ? toDateInputValue(leaveCreditSnapshot.creditsAsOf)
    : "";

  return {
    office: request?.division || employeeRecord?.department || "",
    lastName: nameParts.lastName,
    firstName: nameParts.firstName,
    middleName: nameParts.middleName,
    applicantName: request?.employeeName || employeeRecord?.fullName || "",
    dateOfFiling: toDateInputValue(request?.dateFiled),
    position: employeeRecord?.position || "",
    salary: formatSalary(employeeRecord),
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
    inclusiveDates: formatInclusiveDates(request?.startDate, request?.endDate),
    commutation: "",
    creditsAsOf,
    vlEarned: formatCreditValue(vacationCredits?.total),
    vlLess: normalizedLeaveType === "vacation leave" ? formatCreditValue(requestedDays) : "",
    vlBalance: resolvePendingBalance(vacationCredits, requestedDays, normalizedLeaveType === "vacation leave", normalizedStatus),
    slEarned: formatCreditValue(sickCredits?.total),
    slLess: isSickLeave ? formatCreditValue(requestedDays) : "",
    slBalance: resolvePendingBalance(sickCredits, requestedDays, isSickLeave, normalizedStatus),
    recommendation: isRejected ? "disapproved" : "",
    disapprovalReason: isRejected ? rejectedNote : "",
    approvedDaysPay: "",
    approvedDaysNoPay: "",
    approvedOthers: "",
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

export default function LeaveFormModal({
  open = false,
  request = null,
  employees = [],
  reviewer = null,
  showHrmoReviewerSignature = false,
  showRegionalDirectorApproverSignature = false,
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [resolvedRequest, setResolvedRequest] = useState(request);
  const [employeeSignature, setEmployeeSignature] = useState("");
  const [reviewerSignature, setReviewerSignature] = useState("");
  const [savedHrmoSignature, setSavedHrmoSignature] = useState("");
  const [savedRegionalDirectorSignature, setSavedRegionalDirectorSignature] = useState("");
  const [leaveCredits, setLeaveCredits] = useState(null);
  const [configuredLeaveTypes, setConfiguredLeaveTypes] = useState([]);
  const printRef = useRef(null);

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

    loadResolvedRequest();
    return () => {
      mounted = false;
    };
  }, [open, request]);

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

    loadSignature();
    return () => {
      mounted = false;
    };
  }, [open, resolvedRequest?.employeeRecordId]);

  useEffect(() => {
    let mounted = true;

    const loadReviewerSignature = async () => {
      const needsCurrentViewerSignature = open && (
        (showHrmoReviewerSignature && !resolvedRequest?.reviewedByEmployeeRecordId)
        || (showRegionalDirectorApproverSignature && normalizeText(resolvedRequest?.status) === "approved" && !resolvedRequest?.approvedByEmployeeRecordId)
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

    loadReviewerSignature();
    return () => {
      mounted = false;
    };
  }, [
    open,
    resolvedRequest?.approvedByEmployeeRecordId,
    resolvedRequest?.reviewedByEmployeeRecordId,
    resolvedRequest?.status,
    showHrmoReviewerSignature,
    showRegionalDirectorApproverSignature,
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

    loadSavedHrmoSignature();
    return () => {
      mounted = false;
    };
  }, [open, resolvedRequest?.reviewedByEmployeeRecordId]);

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

    loadSavedRegionalDirectorSignature();
    return () => {
      mounted = false;
    };
  }, [open, resolvedRequest?.approvedByEmployeeRecordId]);

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

    loadLeaveCredits();
    return () => {
      mounted = false;
    };
  }, [open, resolvedRequest?.employeeRecordId, resolvedRequest?.startDate]);

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

    loadLeaveTypes();
    return () => {
      mounted = false;
    };
  }, [open]);

  const availableLeaveTypes = useMemo(
    () => mergeLeaveTypes(configuredLeaveTypes),
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
    () => buildSignatureTimestampLabel(
      "Filed",
      resolvedRequest?.requestedAt || resolvedRequest?.createdAt || resolvedRequest?.dateFiled
    ),
    [resolvedRequest?.createdAt, resolvedRequest?.dateFiled, resolvedRequest?.requestedAt]
  );
  const hrmoName = useMemo(
    () => String(resolvedRequest?.reviewedByName || (showHrmoReviewerSignature ? reviewerName : "")).trim(),
    [resolvedRequest?.reviewedByName, reviewerName, showHrmoReviewerSignature]
  );
  const hrmoSignature = useMemo(
    () => savedHrmoSignature || (!resolvedRequest?.reviewedByEmployeeRecordId && showHrmoReviewerSignature ? reviewerSignature : ""),
    [resolvedRequest?.reviewedByEmployeeRecordId, reviewerSignature, savedHrmoSignature, showHrmoReviewerSignature]
  );
  const hasHrmoSignatureBlock = useMemo(
    () => Boolean(resolvedRequest?.reviewedByEmployeeRecordId || resolvedRequest?.reviewedByName || showHrmoReviewerSignature),
    [resolvedRequest?.reviewedByEmployeeRecordId, resolvedRequest?.reviewedByName, showHrmoReviewerSignature]
  );
  const hrmoTimestampLabel = useMemo(() => {
    const hasSavedReviewer = Boolean(resolvedRequest?.reviewedByEmployeeRecordId || resolvedRequest?.reviewedByName);
    return hasSavedReviewer
      ? buildSignatureTimestampLabel(
        "Date",
        resolvedRequest?.reviewedAt || resolvedRequest?.updatedAt || resolvedRequest?.dateFiled
      )
      : "";
  }, [
    resolvedRequest?.dateFiled,
    resolvedRequest?.reviewedAt,
    resolvedRequest?.reviewedByEmployeeRecordId,
    resolvedRequest?.reviewedByName,
    resolvedRequest?.updatedAt,
  ]);
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
      ? buildSignatureTimestampLabel(
        "Date",
        resolvedRequest?.approvedAt || resolvedRequest?.updatedAt || resolvedRequest?.dateFiled
      )
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

  if (!open || !resolvedRequest) {
    return null;
  }

  return (
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
                  <div
                    key={field}
                    style={{
                      flex: 1,
                      paddingInline: "4px",
                    }}
                  >
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
                <ReadOnlyInput
                  style={{ ...styles.input, flex: 1 }}
                  value={formData.leaveTypeOther}
                />
              </div>
            </div>

            <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
              <label style={styles.label}>6.B Details of Leave</label>

              <p style={styles.subLabel}>In case of Vacation/Special Privilege Leave:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailVacationWithinChecked} />
                <span>Within the Philippines</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailVacationWithinNote} />
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailVacationAbroadChecked} />
                <span>Abroad (Specify)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailVacationAbroadNote} />
              </div>

              <p style={styles.subLabel}>In case of Sick Leave:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailSickHospitalChecked} />
                <span>In Hospital (Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailSickHospitalNote} />
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailSickOutpatientChecked} />
                <span>Out Patient (Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailSickOutpatientNote} />
              </div>

              <p style={styles.subLabel}>In case of Special Leave Benefits for Women:</p>
              <div style={{ display: "flex", gap: "4px", alignItems: "flex-end" }}>
                <span style={{ whiteSpace: "nowrap" }}>(Specify Illness)</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailWomen} />
              </div>

              <p style={styles.subLabel}>In case of Study Leave:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailStudyMasters} />
                <span>Completion of Master's Degree</span>
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailStudyReview} />
                <span>BAR/Board Examination Review</span>
              </div>

              <p style={styles.subLabel}>Other purpose:</p>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailOtherMonetization} />
                <span>Monetization of Leave Credits</span>
              </div>
              <div style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveDetailOtherTerminal} />
                <span>Terminal Leave</span>
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
                <SelectionIndicator checked={formData.commutation === "not_requested"} />
                Not Requested
              </div>
              <div style={styles.checklistItem}>
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
                <ReadOnlyInput style={{ ...styles.input, width: "40px" }} value={formData.approvedOthers} />
                <span>others (Specify)</span>
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

