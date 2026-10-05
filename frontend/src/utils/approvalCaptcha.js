import { promptServerCaptcha, isCaptchaFailure } from "./serverCaptchaPrompt";

/**
 * The security check in front of an approval: a leave request, a leave monetization, a compensatory
 * time off request, or a travel order.
 *
 * This file used to be the whole check. It dealt the sum with Math.random(), held the answer in a
 * local, and marked the typed value against it in a SweetAlert preConfirm -- so the four endpoints
 * behind it were never told a captcha existed. Anything that did not go through this dialog met no
 * check at all: a PUT from curl or from the browser console approved a request outright, and even
 * inside the dialog the answer was one breakpoint away. A check the client both sets and marks is
 * not a check.
 *
 * Now the challenge is dealt by captcha.php, the answer stays hashed in the session, and
 * require_approval_captcha() in captcha-utils.php is what judges the pair -- called from inside each
 * update handler, so every route to an approval passes it whether or not it came from this dialog.
 * What is left here is the asking.
 *
 * Callers hand the returned pair to the service function for the action; see the approval_workflow
 * entry in captcha-utils.php for which transitions are gated and which deliberately are not.
 */

/**
 * Asks for the answer to a freshly dealt approval challenge.
 *
 * Resolves to `{ captchaId, captchaAnswer }`, or `null` when the approver cancelled or no challenge
 * could be dealt -- either way the approval is not sent.
 */
export async function requestApprovalCaptcha({
  title = "Security Check",
  note = "Answer the sum below to confirm this approval.",
  confirmButtonText = "Verify and approve",
  message = "",
} = {}) {
  return promptServerCaptcha({
    purpose: "approval_workflow",
    title,
    note,
    confirmButtonText,
    cancelButtonText: "Cancel approval",
    unavailableText: "The security check could not be loaded, so this approval was not sent. Try again in a moment.",
    message,
  });
}

/** Re-exported so an approval screen can tell a refused check from a failed update in one import. */
export { isCaptchaFailure };
