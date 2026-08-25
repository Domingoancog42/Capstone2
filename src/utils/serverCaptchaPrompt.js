import Swal from "sweetalert2";
import { getCaptcha } from "../services/api";

/**
 * The dialog that puts a server-dealt captcha in front of an action.
 *
 * Every guarantee this check makes lives in captcha-utils.php: the sum is composed there, only a
 * hash of the answer is kept there, and the endpoint being guarded is what judges the pair. This
 * file draws the challenge and collects what was typed. It is never told the answer and never
 * decides anything, which is the entire reason the check is worth having -- the captcha it replaced
 * was dealt, known and marked inside this browser, so anything that skipped the dialog skipped the
 * check, and anything that opened the console could read the answer out of it.
 *
 * Shared by the payroll workflow and by the four approval flows, so a security check looks and
 * behaves the same wherever it appears and a fix to one is a fix to all of them.
 */

/** The operand boxes match the larger image tiles on the login screen. */
const OPERAND_BOX_STYLE = [
  "display:grid",
  "place-items:center",
  "width:70px",
  "height:56px",
  "overflow:hidden",
  "border:1px solid #cbd5e1",
  "border-radius:8px",
  "background:#f8fafc",
].join(";");

const SYMBOL_STYLE = "font-size:18px;font-weight:600;color:#94a3b8";

/**
 * Everything rendered below comes from our own captcha.php, but it is still written into innerHTML,
 * so it is escaped on the way in rather than trusted for being ours.
 *
 * Exported because the payroll step-up draws a second dialog on the same rule -- one escape, so a
 * fix to it is a fix everywhere rather than to whichever copy someone remembered.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One operand.
 *
 * `mode` is the server saying how the digits travelled. New responses always use noisy image tiles;
 * the text branch remains so a page opened against an older backend still works.
 */
function operandHtml(isImage, value, label) {
  if (isImage) {
    // The alt text names the position rather than the digit: saying the number would hand back in
    // text exactly what drawing it was meant to withhold.
    return `<span style="${OPERAND_BOX_STYLE}"><img alt="${escapeHtml(label)}" draggable="false" src="${escapeHtml(value)}" style="width:100%;height:100%;object-fit:cover"></span>`;
  }

  // Unselectable so the challenge cannot simply be dragged out of the dialog.
  return `<span style="${OPERAND_BOX_STYLE}"><span style="user-select:none;font-family:ui-monospace,monospace;font-size:20px;font-weight:700;color:#1e293b">${escapeHtml(value)}</span></span>`;
}

function challengeHtml(challenge, note, headerHtml) {
  const isImage = challenge.mode === "image";

  return [
    headerHtml,
    `<p style="margin:0;font-size:14px;color:#475569">${escapeHtml(note)}</p>`,
    '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px">',
    operandHtml(isImage, challenge.left, "First number of the security check"),
    `<span aria-hidden="true" style="${SYMBOL_STYLE}">${escapeHtml(challenge.operator || "+")}</span>`,
    operandHtml(isImage, challenge.right, "Second number of the security check"),
    `<span aria-hidden="true" style="${SYMBOL_STYLE}">=</span>`,
    "</div>",
  ].join("");
}

/**
 * Deals a challenge for `purpose` and asks for the answer.
 *
 * Resolves to `{ captchaId, captchaAnswer }` for the caller to send with the guarded request, or
 * `null` when the user cancelled or no challenge could be dealt. A `null` is always a reason not to
 * proceed, so callers return on it rather than falling through -- sending the action without the
 * pair would only earn a 422 from the endpoint, but it would also mean the browser had decided on
 * its own that the check did not apply.
 *
 * `message` puts a previous refusal above the sum, for a caller re-asking after the server turned an
 * answer down. Blank on the first ask.
 *
 * `headerHtml` is markup placed above the sum, for a caller where this dialog is one stage of
 * something longer -- the payroll step-up puts its step rail there. It is markup rather than text
 * because a caller drawing a rail needs structure, so callers own escaping whatever they put in it.
 * The four approval flows and the login screen pass nothing and the dialog is unchanged for them.
 *
 * `icon` is the badge above the title; pass null for none, which is what a caller drawing its own
 * header wants. A refusal always overrides it with the error icon.
 */
export async function promptServerCaptcha({
  purpose,
  title = "Security Check",
  note = "Answer the sum below to confirm this action.",
  confirmButtonText = "Confirm",
  confirmButtonColor = "#0f766e",
  cancelButtonText = "Cancel",
  unavailableText = "The security check could not be loaded, so nothing was sent. Try again in a moment.",
  message = "",
  headerHtml = "",
  icon = "question",
} = {}) {
  let challenge = null;

  try {
    challenge = await getCaptcha(purpose);
  } catch (requestError) {
    await Swal.fire({
      title: "Security Check Unavailable",
      text: requestError?.response?.data?.message || unavailableText,
      icon: "error",
      confirmButtonColor: "#dc2626",
    });

    return null;
  }

  /*
   * No challenge means no gate, and a guarded action must not slip through on a malformed response
   * the way it would if this returned an empty pair and let the caller carry on.
   */
  if (!challenge?.captchaId) {
    await Swal.fire({
      title: "Security Check Unavailable",
      text: unavailableText,
      icon: "error",
      confirmButtonColor: "#dc2626",
    });

    return null;
  }

  const result = await Swal.fire({
    title,
    html: challengeHtml(challenge, message || note, headerHtml),
    input: "text",
    inputAttributes: {
      "aria-label": "Answer to the security check",
      autocomplete: "off",
      inputmode: "numeric",
      maxlength: "2",
    },
    // Only what this browser can judge on its own. Whether the number is the RIGHT one is the
    // server's call, and asking it here would mean this file knew the answer.
    inputValidator: (value) => (
      /^\d{1,2}$/.test(String(value || "").trim())
        ? undefined
        : "Enter the answer to the sum above."
    ),
    icon: message ? "error" : (icon || undefined),
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor,
    cancelButtonColor: "#64748b",
    reverseButtons: true,
    allowOutsideClick: false,
  });

  if (!result.isConfirmed) {
    return null;
  }

  return {
    captchaId: challenge.captchaId,
    captchaAnswer: String(result.value || "").trim(),
  };
}

/**
 * Whether a rejected request was the security check refusing rather than the action failing.
 *
 * The endpoints set `captchaFailed` on exactly that case, and it matters to the user: the record was
 * not touched, nothing half-happened, and what they have to do is answer a fresh sum. Reporting it
 * as "Update failed" would be a lie about the record.
 */
export function isCaptchaFailure(error) {
  return Boolean(error?.response?.data?.captchaFailed);
}
