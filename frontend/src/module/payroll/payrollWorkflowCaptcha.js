import { promptServerCaptcha } from "../../utils/serverCaptchaPrompt";

/**
 * The math check that stands between a user and a one-way payroll transition.
 *
 * Submitting a payroll for approval, approving it, and marking it paid all move money and cannot be
 * undone, so each asks for one more deliberate act before it runs. The sum is dealt by the server and
 * the answer never reaches this browser -- the dialog only collects what was typed and hands the pair
 * to payroll.php, which is what judges it (see payroll_require_workflow_captcha there). Nothing here
 * can mark its own homework, which is the entire reason the check is worth having.
 *
 * The dialog itself is serverCaptchaPrompt.js, shared with the leave, monetization, compensatory and
 * travel approvals so every security check in the system is the same check drawn the same way.
 */
export async function promptPayrollWorkflowCaptcha({
  title = "Security Check",
  note = "Answer the sum below to confirm this payroll action.",
  confirmButtonText = "Confirm",
  confirmButtonColor = "#0f766e",
  message = "",
} = {}) {
  return promptServerCaptcha({
    // Deliberately not the approvals' purpose: releasing money is a different decision from
    // endorsing a day off, and captcha-utils.php folds the purpose into the answer hash so a sum
    // answered for one cannot be spent on the other.
    purpose: "payroll_workflow",
    title,
    note,
    confirmButtonText,
    confirmButtonColor,
    unavailableText: "The security check could not be loaded, so this payroll action was not sent. Try again in a moment.",
    message,
  });
}
