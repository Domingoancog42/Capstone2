import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

import { getRoleLabel } from "./roleRoutes";

/*
 * The temporary password a new employee account is created with is generated on the server, hashed
 * immediately, and never read back — the create response is the only moment it exists in plain text.
 * So the moment a record is created, the credentials are put in front of the operator once, instead
 * of leaving them to guess what the employee is supposed to sign in with when the activation email
 * does not arrive.
 */

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

const ROW_LABEL_STYLE = "margin:0;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;";
const ROW_VALUE_STYLE = "margin:2px 0 0;font-size:14px;font-weight:600;color:#0f172a;word-break:break-all;";

function detailRow(label, value, { last = false } = {}) {
  return `
    <div style="padding:10px 14px;${last ? "" : "border-bottom:1px solid #e2e8f0;"}">
      <p style="${ROW_LABEL_STYLE}">${escapeHtml(label)}</p>
      <p style="${ROW_VALUE_STYLE}">${escapeHtml(value)}</p>
    </div>
  `;
}

/** XAMPP is often served over a plain-http LAN address, where navigator.clipboard is unavailable. */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback below.
  }

  try {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(scratch);

    return copied;
  } catch {
    return false;
  }
}

/**
 * Shows the temporary sign-in details of a freshly created employee account.
 *
 * Resolves to `false` without opening anything when the save produced no password — an employee
 * saved without a role has no linked account, and an edit only reissues one on reactivation.
 */
export async function showEmployeeCredentialsAlert({
  employee = null,
  linkedUser = null,
  temporaryPassword = "",
  emailNotification = "",
  emailMessage = "",
} = {}) {
  const password = String(temporaryPassword || "").trim();

  if (!password) {
    return false;
  }

  const employeeName = String(
    employee?.fullName || linkedUser?.full_name || "the employee"
  ).trim();
  const employeeCode = String(employee?.employeeId || linkedUser?.employee_id || "").trim();
  const email = String(linkedUser?.email || employee?.email || "").trim();
  const username = String(linkedUser?.username || "").trim();
  const roleLabel = linkedUser?.role ? getRoleLabel(linkedUser.role) : "";

  const emailStatus = emailNotification === "sent"
    ? {
      style: "border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;",
      text: emailMessage || "An activation email with these details was sent to the employee.",
    }
    : emailNotification === "warning"
      ? {
        style: "border:1px solid #fecaca;background:#fef2f2;color:#991b1b;",
        text: `${emailMessage || "The activation email could not be sent."} Give these details to the employee yourself.`,
      }
      : null;

  const copyPayload = [
    employeeName ? `Employee: ${employeeName}` : "",
    employeeCode ? `Employee ID: ${employeeCode}` : "",
    username ? `Username: ${username}` : "",
    email ? `Email: ${email}` : "",
    `Temporary password: ${password}`,
  ].filter(Boolean).join("\n");

  await Swal.fire({
    title: "Employee created",
    icon: "success",
    width: 520,
    confirmButtonText: "Done",
    confirmButtonColor: "#D61E1E",
    allowOutsideClick: false,
    html: `
      <p style="margin:0 0 14px;text-align:left;font-size:14px;line-height:20px;color:#475569;">
        Sign-in details for <strong style="color:#0f172a;">${escapeHtml(employeeName)}</strong>.
        The temporary password is shown here only once — copy it before closing this card.
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;text-align:left;background:#ffffff;">
        ${employeeCode ? detailRow("Employee ID", employeeCode) : ""}
        ${username ? detailRow("Username", username) : ""}
        ${email ? detailRow("Email", email) : ""}
        ${roleLabel ? detailRow("Role", roleLabel) : ""}
        <div style="padding:10px 14px;background:#FEF1F1;border-top:1px solid #F8BFBF;">
          <p style="${ROW_LABEL_STYLE}color:#D61E1E;">Temporary password</p>
          <p style="margin:2px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;font-weight:700;letter-spacing:0.06em;color:#0f172a;word-break:break-all;">${escapeHtml(password)}</p>
        </div>
      </div>
      <button type="button" id="employeeCredentialsCopy"
        style="margin-top:12px;width:100%;min-height:40px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;font-size:14px;font-weight:600;color:#334155;cursor:pointer;">
        Copy sign-in details
      </button>
      <p style="margin:12px 0 0;text-align:left;font-size:12px;line-height:18px;color:#64748b;">
        The employee is required to set a new password the first time they sign in.
      </p>
      ${emailStatus ? `
        <p style="margin:10px 0 0;padding:8px 10px;border-radius:10px;text-align:left;font-size:12px;line-height:18px;${emailStatus.style}">
          ${escapeHtml(emailStatus.text)}
        </p>
      ` : ""}
    `,
    didOpen: () => {
      const copyButton = document.getElementById("employeeCredentialsCopy");

      copyButton?.addEventListener("click", async () => {
        const copied = await copyText(copyPayload);

        copyButton.textContent = copied ? "Copied to clipboard" : "Copy failed — select the text manually";
        copyButton.style.color = copied ? "#166534" : "#991b1b";
        copyButton.style.borderColor = copied ? "#bbf7d0" : "#fecaca";
        copyButton.style.background = copied ? "#f0fdf4" : "#fef2f2";
      });
    },
  });

  return true;
}
