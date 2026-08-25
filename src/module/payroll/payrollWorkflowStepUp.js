import Swal from "sweetalert2";
import { promptServerCaptcha, escapeHtml } from "../../utils/serverCaptchaPrompt";
import { requestPayrollWorkflowOtp } from "../../services/payrollService";

/**
 * The two-step check in front of submitting a payroll for approval and approving one.
 *
 *   step 1   the math sum, dealt by the server. It answers "did someone mean to do this?"
 *   step 2   a six-digit code emailed to the acting user. It answers "is it the person whose
 *            session this is?", which the sum cannot -- anything holding the session cookie can
 *            read the sum and type it.
 *
 * They are chained, not merely shown in order: the solved sum is what buys the emailed code, so a
 * script cannot post mail at a mailbox by hammering the request endpoint. What this function
 * returns is the code the user typed, and payroll.php is what judges it (payroll_require_workflow_otp
 * there). Nothing in this file decides anything, which is the same reason the captcha it builds on
 * is worth having.
 *
 * Marking a batch paid still asks for the sum alone, through promptPayrollWorkflowCaptcha; returning
 * one for correction asks for nothing. See workflow-otp-utils.php for why the line falls there.
 *
 * Resolves to `{ otpTicket, otpCode }` for the caller to send with the transition, or `null` when
 * the user backed out or a step could not be completed. A `null` is always a reason not to proceed,
 * so callers return on it rather than falling through.
 */

const STEP_LABELS = ["Security check", "Email code"];

const CANCELLED = { cancelled: true };

/*
 * The step rail, drawn here rather than with SweetAlert's `progressSteps`.
 *
 * That option puts each string it is given INSIDE a ~2em circle -- it expects "1", "2", not a name --
 * so passing the labels through it stacked two overflowing words on top of each other and on top of
 * the connector between them. Numbers in the circles and names underneath is the shape this wants,
 * and SweetAlert has no way to draw that, so the rail is markup and the circles are ours.
 *
 * Inline styles for the same reason the rest of these dialogs use them: SweetAlert renders into its
 * own container outside the React tree, so nothing here is reached by the app's stylesheets.
 */
const STEP_CIRCLE_BASE = [
  "display:grid",
  "place-items:center",
  "width:32px",
  "height:32px",
  "border-radius:50%",
  "font-size:13px",
  "font-weight:700",
  "line-height:1",
  // Nothing about the circle should shift as the label under it changes width.
  "flex:0 0 auto",
].join(";");

const TEAL = "#0f766e";
const IDLE = "#e2e8f0";

function stepCircle(index, currentStep) {
  const isDone = index < currentStep;
  const isActive = index === currentStep;
  const content = isDone ? "&#10003;" : String(index + 1);

  if (isDone || isActive) {
    return `<span style="${STEP_CIRCLE_BASE};background:${TEAL};color:#ffffff${
      // The ring marks where you are, so a completed circle and the current one do not read alike.
      isActive ? `;box-shadow:0 0 0 4px rgba(15,118,110,0.16)` : ""
    }">${content}</span>`;
  }

  return `<span style="${STEP_CIRCLE_BASE};background:${IDLE};color:#94a3b8">${content}</span>`;
}

function stepColumn(index, currentStep) {
  const isCurrentOrDone = index <= currentStep;

  return [
    '<span style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:0 0 104px">',
    stepCircle(index, currentStep),
    `<span style="font-size:12px;line-height:1.3;font-weight:${isCurrentOrDone ? "600" : "500"};color:${
      isCurrentOrDone ? "#0f172a" : "#94a3b8"
    }">${escapeHtml(STEP_LABELS[index])}</span>`,
    "</span>",
  ].join("");
}

function stepperHtml(currentStep) {
  return [
    '<div style="display:flex;align-items:flex-start;justify-content:center;margin:0 0 22px">',
    stepColumn(0, currentStep),
    // Sits on the circles' centre line: half of the 32px circle, less half the 2px rule.
    `<span style="flex:0 0 56px;height:2px;margin-top:15px;border-radius:1px;background:${
      currentStep > 0 ? TEAL : IDLE
    }"></span>`,
    stepColumn(1, currentStep),
    "</div>",
  ].join("");
}

/** Turns an axios rejection into the sentence the server wrote, or a stated fallback. */
function serverMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

/**
 * Whether the server turned down the sum specifically, as opposed to refusing the request for some
 * other reason. Only this case is worth re-asking step one for; anything else would loop the user
 * through a challenge that was never the problem.
 */
function isCaptchaRefusal(error) {
  return Boolean(error?.response?.data?.captchaFailed);
}

/**
 * Whether the server is saying the ticket is gone and step two has nothing left to stand on -- a
 * refused sum on a first send, or `restart` when a resend ran the ticket out of sends. Either way
 * the only way forward is a fresh sum, so the flow goes back to step one rather than leaving the
 * user on a code box that can never be filled.
 */
function needsRestart(error) {
  return isCaptchaRefusal(error) || Boolean(error?.response?.data?.restart);
}

function otpDialogHtml(maskedEmail, message) {
  return [
    stepperHtml(1),
    message
      ? `<p style="margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;font-size:13px;line-height:1.45;font-weight:600;color:#b91c1c">${escapeHtml(message)}</p>`
      : "",
    '<p style="margin:0;font-size:14px;color:#475569">We emailed a 6-digit authorization code to</p>',
    /*
     * The masked address is long and has no spaces, so it is given its own line and allowed to break
     * inside the run of asterisks -- otherwise it widens the whole dialog to fit on one line.
     */
    `<p style="margin:6px 0 0;font-size:15px;font-weight:700;color:#0f172a;overflow-wrap:anywhere">${escapeHtml(maskedEmail)}</p>`,
    '<p style="margin:10px 0 0;font-size:13px;color:#64748b">Enter it below to finish. The code is good for 10 minutes.</p>',
  ].join("");
}

/**
 * Step two. Collects the code, and offers a resend on the deny button.
 *
 * Resolves to the typed code, to `"resend"`, or to CANCELLED. The resend countdown is drawn from
 * `resendAvailableInSeconds` as the server reported it -- the browser is told when it may next ask,
 * rather than deciding for itself, because the server enforces that floor either way and a
 * disagreement would only show the user an enabled button that then refuses.
 */
async function promptForCode({ maskedEmail, resendAvailableInSeconds, resendsRemaining, confirmButtonText, confirmButtonColor, message }) {
  let countdownTimer = null;

  const result = await Swal.fire({
    title: "Email Verification",
    html: otpDialogHtml(maskedEmail, message),
    input: "text",
    inputAttributes: {
      "aria-label": "Six digit authorization code",
      autocomplete: "one-time-code",
      inputmode: "numeric",
      maxlength: "6",
    },
    // Only what this browser can judge on its own: that six digits were typed. Whether they are the
    // RIGHT six is the server's call, and asking it here would mean this file knew the code.
    inputValidator: (value) => (
      /^\d{6}$/.test(String(value || "").trim())
        ? undefined
        : "Enter the 6-digit code from your email."
    ),
    // No icon: the rail already says where the user is, and a badge above it only crowds the dialog.
    // A refusal is shown in the banner inside the html, where it sits with the box it is about.
    showCancelButton: true,
    showDenyButton: resendsRemaining > 0,
    confirmButtonText,
    denyButtonText: "Resend code",
    cancelButtonText: "Cancel",
    confirmButtonColor,
    denyButtonColor: "#64748b",
    cancelButtonColor: "#94a3b8",
    reverseButtons: true,
    allowOutsideClick: false,
    didOpen: () => {
      const denyButton = Swal.getDenyButton();

      if (!denyButton || resendsRemaining <= 0) {
        return;
      }

      let remaining = Math.max(0, Number(resendAvailableInSeconds) || 0);

      const paint = () => {
        if (remaining > 0) {
          denyButton.disabled = true;
          denyButton.textContent = `Resend in ${remaining}s`;
          remaining -= 1;
          return;
        }

        denyButton.disabled = false;
        denyButton.textContent = "Resend code";
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      };

      paint();
      countdownTimer = window.setInterval(paint, 1000);
    },
    // The dialog can close on any of four paths -- confirm, deny, cancel, Escape -- so the timer is
    // cleared here rather than on each of them.
    willClose: () => {
      if (countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
    },
  });

  if (result.isDenied) {
    return "resend";
  }

  if (!result.isConfirmed) {
    return CANCELLED;
  }

  return String(result.value || "").trim();
}

export async function promptPayrollWorkflowStepUp({
  otpAction,
  captchaNote = "Answer the sum below to continue.",
  confirmButtonText = "Confirm",
  confirmButtonColor = "#0f766e",
} = {}) {
  let captchaMessage = "";

  // Step one repeats only while the SERVER is the one rejecting the sum, so a mistyped answer costs
  // a fresh challenge rather than the whole flow. Every other failure leaves the loop.
  for (;;) {
    const captcha = await promptServerCaptcha({
      purpose: "payroll_workflow",
      title: "Security Check",
      note: captchaNote,
      confirmButtonText: "Next",
      confirmButtonColor,
      cancelButtonText: "Cancel",
      unavailableText: "The security check could not be loaded, so nothing was sent. Try again in a moment.",
      message: captchaMessage,
      headerHtml: stepperHtml(0),
      icon: null,
    });

    if (!captcha) {
      return null;
    }

    Swal.fire({
      title: "Sending code...",
      text: "Please wait while the authorization code is emailed to you.",
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading(),
    });

    let issued = null;

    try {
      issued = await requestPayrollWorkflowOtp(otpAction, captcha);
    } catch (error) {
      if (isCaptchaRefusal(error)) {
        // Straight back to a fresh sum with the server's own wording above it.
        captchaMessage = serverMessage(error, "That is not the right answer to the security check.");
        continue;
      }

      await Swal.fire({
        title: "Code Not Sent",
        text: serverMessage(error, "The authorization code could not be sent, so nothing was submitted. Try again in a moment."),
        icon: "error",
        confirmButtonColor: "#dc2626",
      });

      return null;
    }

    /*
     * No ticket means no second step, and a guarded transition must not slip through on a malformed
     * response the way it would if this returned an empty pair and let the caller carry on.
     */
    if (!issued?.otpTicket) {
      await Swal.fire({
        title: "Code Not Sent",
        text: "The authorization code could not be sent, so nothing was submitted. Try again in a moment.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });

      return null;
    }

    const otpTicket = issued.otpTicket;
    let maskedEmail = issued.maskedEmail || "your registered email address";
    let resendAvailableInSeconds = issued.resendAvailableInSeconds ?? 30;
    let resendsRemaining = issued.resendsRemaining ?? 0;
    let otpMessage = "";

    // Step two repeats for a resend. A wrong code is not caught here -- only payroll.php can tell --
    // so it comes back as a refused transition, and the caller re-enters this whole flow.
    for (;;) {
      const answer = await promptForCode({
        maskedEmail,
        resendAvailableInSeconds,
        resendsRemaining,
        confirmButtonText,
        confirmButtonColor,
        message: otpMessage,
      });

      if (answer === CANCELLED) {
        return null;
      }

      if (answer !== "resend") {
        return { otpTicket, otpCode: answer };
      }

      Swal.fire({
        title: "Resending code...",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      try {
        /*
         * The ticket goes up instead of a second sum: the server takes holding a live one as proof a
         * sum was already solved to mint it, and bounds the resend by the ticket's own send limits.
         */
        const resent = await requestPayrollWorkflowOtp(otpAction, { otpTicket });
        maskedEmail = resent.maskedEmail || maskedEmail;
        resendAvailableInSeconds = resent.resendAvailableInSeconds ?? 30;
        resendsRemaining = resent.resendsRemaining ?? 0;
        otpMessage = "";
      } catch (error) {
        if (needsRestart(error)) {
          captchaMessage = serverMessage(error, "Your security check expired. Answer the new one and try again.");
          break;
        }

        // Anything else -- the resend floor, a mail failure -- is a sentence the user acts on, shown
        // above the code box they are still looking at.
        otpMessage = serverMessage(error, "The code could not be resent. Try again in a moment.");
        resendAvailableInSeconds = 30;
      }
    }
  }
}
