export const PROMOTION_STAGES = [
  { key: "assessment", label: "Assessment" },
  { key: "examination", label: "Examination" },
  { key: "interview", label: "Interview" },
  { key: "submission", label: "Submission for Approval" },
  { key: "recommended", label: "HR Recommended" },
  { key: "approved", label: "Approved" },
];

export const PROMOTION_STATUS_OPTIONS = [
  { key: "all", label: "All statuses" },
  PROMOTION_STAGES[0],
  { key: "not_qualified", label: "Not Qualified" },
  ...PROMOTION_STAGES.slice(1),
  { key: "disapproved", label: "Disapproved" },
  { key: "cancelled", label: "Cancelled" },
];

export const OPEN_PROMOTION_STATUSES = ["assessment", "examination", "interview", "submission", "pending", "recommended"];
export const EVALUATION_STAGES = ["assessment", "examination", "interview", "submission"];
export const PROMOTION_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PROMOTION_DOCUMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx";

export function promotionStatusLabel(status) {
  const key = status === "pending" ? "submission" : status === "rejected" ? "disapproved" : status;
  return PROMOTION_STATUS_OPTIONS.find((option) => option.key === key)?.label || key || "Application opened";
}

export function nextPromotionStage(stage) {
  return { assessment: "examination", examination: "interview", interview: "submission" }[stage];
}

export const STAGE_FIELD_LABELS = {
  reviewedOn: "Assessment date", scheduledOn: "Scheduled date", result: "Result",
  score: "Examination score", panel: "Interview panel", rating: "Interview rating",
  documents: "Supporting requirements", documentReferences: "Previous document references", remarks: "Remarks",
};

export function evaluationResultLabel(result) {
  return { qualified: "Qualified", not_qualified: "Not Qualified", passed: "Passed", failed: "Failed" }[result] || result;
}
