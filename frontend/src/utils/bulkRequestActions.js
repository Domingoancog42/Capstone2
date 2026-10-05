import { toast } from "react-hot-toast";
import Swal from "sweetalert2";

import { requestApprovalCaptcha, isCaptchaFailure } from "./approvalCaptcha";

/**
 * Runs several existing, fully validated approval endpoints under one explicit bulk confirmation.
 * The batch targets are signed into the server-side captcha grant, so the solved challenge can only
 * be spent on the rows that were visible in this confirmation.
 */
export async function confirmBulkApproval({
  records = [],
  noun = "request",
  getTarget,
  approveRecord,
  confirmationText = "",
  captchaNote = "Answer the sum below to confirm these approvals.",
  confirmButtonText = "Approve selected",
  progressText = "Approving selected requests...",
  onComplete,
}) {
  if (records.length === 0 || typeof getTarget !== "function" || typeof approveRecord !== "function") {
    return { succeeded: [], failed: [] };
  }

  if (records.length > 50) {
    await Swal.fire({
      title: "Too many requests selected",
      text: "Approve up to 50 requests in one batch. Clear the selection and choose a smaller group.",
      icon: "warning",
      confirmButtonColor: "#0f766e",
    });
    return { succeeded: [], failed: [] };
  }

  const confirmation = await Swal.fire({
    title: `Approve ${records.length} selected ${noun}${records.length === 1 ? "" : "s"}?`,
    text: confirmationText || `This will approve the ${records.length} selected ${noun}${records.length === 1 ? "" : "s"} at their current workflow stage.`,
    icon: "success",
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: "Cancel",
    confirmButtonColor: "#0f766e",
    cancelButtonColor: "#64748b",
    reverseButtons: true,
    focusCancel: true,
  });

  if (!confirmation.isConfirmed) return { succeeded: [], failed: [] };

  const captcha = await requestApprovalCaptcha({
    note: captchaNote,
    confirmButtonText: "Verify and approve selected",
  });

  if (!captcha) return { succeeded: [], failed: [] };

  const captchaBatchTargets = Array.from(new Set(records.map(getTarget).filter(Boolean)));
  const batchCaptcha = captchaBatchTargets.length > 1
    ? { ...captcha, captchaBatchTargets }
    : captcha;
  const toastId = toast.loading(progressText);
  const succeeded = [];
  const failed = [];

  for (const record of records) {
    try {
      const result = await approveRecord(record, batchCaptcha);
      succeeded.push({ record, result });
    } catch (error) {
      failed.push({ record, error });
    }
  }

  await onComplete?.({ succeeded, failed });

  if (failed.length === 0) {
    const message = `${succeeded.length} ${noun}${succeeded.length === 1 ? "" : "s"} approved successfully.`;
    toast.success(message, { id: toastId });
    await Swal.fire({ title: "Bulk approval complete", text: message, icon: "success", confirmButtonColor: "#0f766e" });
  } else {
    const firstError = failed[0].error;
    const message = succeeded.length > 0
      ? `${succeeded.length} approved; ${failed.length} could not be approved. Refresh the list and try the remaining rows again.`
      : firstError?.response?.data?.message || firstError?.message || "The selected requests could not be approved.";
    toast.error(message, { id: toastId });
    await Swal.fire({
      title: isCaptchaFailure(firstError) ? "Security check failed" : "Bulk approval incomplete",
      text: message,
      icon: "error",
      confirmButtonColor: "#dc2626",
    });
  }

  return { succeeded, failed };
}
