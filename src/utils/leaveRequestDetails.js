import { sanitizeSelectedDates } from "./dateSelection";

const LEAVE_REQUEST_META_PREFIX = "[HRIS_LEAVE_META]";

export const DEFAULT_LEAVE_REQUEST_DETAILS = {
  vacationScope: "",
  vacationNote: "",
  sickLeaveMode: "",
  sickLeaveIllness: "",
  studyLeavePurpose: "",
};

function normalizeText(value) {
  return String(value || "").trim();
}

function sanitizeLeaveRequestDetails(details = {}) {
  const next = {
    ...DEFAULT_LEAVE_REQUEST_DETAILS,
    ...details,
  };

  const normalizedVacationScope = ["within_philippines", "abroad"].includes(next.vacationScope)
    ? next.vacationScope
    : "";
  const normalizedSickLeaveMode = ["in_hospital", "out_patient"].includes(next.sickLeaveMode)
    ? next.sickLeaveMode
    : "";
  const normalizedStudyLeavePurpose = ["masters", "bar_review"].includes(next.studyLeavePurpose)
    ? next.studyLeavePurpose
    : "";

  return {
    vacationScope: normalizedVacationScope,
    vacationNote: normalizedVacationScope === "abroad" ? normalizeText(next.vacationNote) : "",
    sickLeaveMode: normalizedSickLeaveMode,
    sickLeaveIllness: normalizedSickLeaveMode ? normalizeText(next.sickLeaveIllness) : "",
    studyLeavePurpose: normalizedStudyLeavePurpose,
    /* The picked days and their AM/PM halves; the shared model lives in dateSelection.js. */
    leaveDays: sanitizeSelectedDates(next.leaveDays),
  };
}

function hasStructuredLeaveDetails(details = {}) {
  return Boolean(
    details.vacationScope
    || details.vacationNote
    || details.sickLeaveMode
    || details.sickLeaveIllness
    || details.studyLeavePurpose
    || (details.leaveDays || []).length > 0
  );
}

function deriveReasonFromDetails(details = {}, leaveType = "") {
  if (details.vacationScope === "within_philippines") {
    return "Within the Philippines";
  }

  if (details.vacationScope === "abroad") {
    return details.vacationNote ? `Abroad: ${details.vacationNote}` : "Abroad";
  }

  if (details.sickLeaveMode === "in_hospital") {
    return details.sickLeaveIllness ? `In Hospital: ${details.sickLeaveIllness}` : "In Hospital";
  }

  if (details.sickLeaveMode === "out_patient") {
    return details.sickLeaveIllness ? `Out Patient: ${details.sickLeaveIllness}` : "Out Patient";
  }

  if (details.studyLeavePurpose === "masters") {
    return "Completion of Master's Degree";
  }

  if (details.studyLeavePurpose === "bar_review") {
    return "BAR/Board Examination Review";
  }

  return String(leaveType || "").trim() ? "" : "";
}

export function packLeaveReason(reason, details = {}) {
  const visibleReason = normalizeText(reason);
  const sanitizedDetails = sanitizeLeaveRequestDetails(details);

  if (!hasStructuredLeaveDetails(sanitizedDetails)) {
    return visibleReason;
  }

  const separator = visibleReason ? "\n\n" : "";
  return `${visibleReason}${separator}${LEAVE_REQUEST_META_PREFIX}${JSON.stringify(sanitizedDetails)}`;
}

export function unpackLeaveReason(reason) {
  const rawReason = String(reason || "");
  const markerIndex = rawReason.lastIndexOf(LEAVE_REQUEST_META_PREFIX);

  if (markerIndex === -1) {
    return {
      visibleReason: rawReason.trim(),
      details: { ...DEFAULT_LEAVE_REQUEST_DETAILS, leaveDays: [] },
    };
  }

  const visibleReason = rawReason.slice(0, markerIndex).trim();
  const detailsText = rawReason.slice(markerIndex + LEAVE_REQUEST_META_PREFIX.length).trim();

  try {
    const parsed = JSON.parse(detailsText);
    return {
      visibleReason,
      details: sanitizeLeaveRequestDetails(parsed),
    };
  } catch {
    return {
      visibleReason: rawReason.trim(),
      details: { ...DEFAULT_LEAVE_REQUEST_DETAILS, leaveDays: [] },
    };
  }
}

export function getLeaveReasonDisplay(reason, leaveType = "") {
  const { visibleReason, details } = unpackLeaveReason(reason);
  return visibleReason || deriveReasonFromDetails(details, leaveType);
}
