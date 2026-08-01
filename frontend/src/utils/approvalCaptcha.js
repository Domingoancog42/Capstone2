import Swal from "sweetalert2";

function randomCaptchaNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createApprovalCaptcha() {
  const left = randomCaptchaNumber(2, 12);
  const right = randomCaptchaNumber(2, 12);

  return {
    left,
    right,
    answer: left + right,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function requestApprovalCaptcha({
  title = "Verification Required",
  text = "Solve the captcha before this approval is completed.",
  confirmButtonText = "Verify and approve",
} = {}) {
  const captcha = createApprovalCaptcha();

  const result = await Swal.fire({
    title,
    icon: "question",
    html: `
      <div style="display:flex;flex-direction:column;gap:0.75rem;align-items:center;">
        <div style="font-size:0.95rem;color:#475569;">${escapeHtml(text)}</div>
        <div style="font-size:0.9rem;color:#475569;">Enter the answer to continue.</div>
        <div style="border:1px solid #cbd5e1;background:#f8fafc;border-radius:0.75rem;padding:0.75rem 1rem;font-size:1.35rem;font-weight:800;color:#0f172a;">
          ${captcha.left} + ${captcha.right} = ?
        </div>
      </div>
    `,
    input: "text",
    inputPlaceholder: "Captcha answer",
    inputAttributes: {
      "aria-label": "Captcha answer",
      inputmode: "numeric",
      autocomplete: "off",
    },
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: "Cancel approval",
    confirmButtonColor: "#0f766e",
    cancelButtonColor: "#64748b",
    reverseButtons: true,
    focusConfirm: false,
    preConfirm: (value) => {
      const numericValue = Number(String(value || "").trim());
      if (!Number.isFinite(numericValue)) {
        Swal.showValidationMessage("Enter the captcha answer.");
        return false;
      }

      if (numericValue !== captcha.answer) {
        Swal.showValidationMessage("Captcha answer is incorrect.");
        return false;
      }

      return true;
    },
  });

  return result.isConfirmed;
}
