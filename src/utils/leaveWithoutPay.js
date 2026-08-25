import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

/*
 * Leave credits only cover the days an employee has actually earned. Anything beyond the
 * remaining balance is still filed, but the excess is charged as Leave Without Pay so the
 * approver and CSC Form No. 6 (7.C Approved For) both show the correct with pay / without
 * pay split. The backend answers with this code when a request needs that acknowledgement.
 */
export const LEAVE_WITHOUT_PAY_CONFIRMATION_CODE = "leave_without_pay_confirmation_required";

/*
 * Mandatory/forced leave is the required annual use of vacation credits rather than a separate
 * entitlement, so it is measured against the vacation balance. Mirrors 'chargedBy' in the API's
 * leave credit definitions.
 */
const CREDIT_POOL_BY_LEAVE_TYPE = {
  "forced leave": "vacation leave",
  "mandatory/forced leave": "vacation leave",
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function resolveCreditPoolName(leaveType) {
  const normalized = normalizeText(leaveType);
  return CREDIT_POOL_BY_LEAVE_TYPE[normalized] || normalized;
}

function roundDays(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
}

/*
 * Leave is only ever availed in whole days or half days, so a fractional balance such as 1.25 can
 * only pay for 1 day. Mirrors leave_credit_floor_half_day() in the API so the confirmation shows
 * the same split the request is filed with.
 */
export function floorToHalfDay(value) {
  const numericValue = roundDays(value);
  return numericValue > 0 ? Math.floor(numericValue * 2) / 2 : 0;
}

export function formatLeaveDays(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(2).replace(/\.?0+$/, "");
}

/*
 * Returns null when the leave type has no tracked credit balance, because those types have no
 * ceiling to run out of. Otherwise the requested days are split against the remaining credits.
 */
export function resolveLeaveWithoutPaySplit({ leaveType, numberOfDays, balances = [] }) {
  const creditPoolName = resolveCreditPoolName(leaveType);
  const requestedDays = roundDays(numberOfDays);

  if (!creditPoolName || requestedDays <= 0) {
    return null;
  }

  const balance = (balances || []).find(
    (item) => normalizeText(item?.type) === creditPoolName
  );

  if (!balance) {
    return null;
  }

  const remainingCredits = Math.max(0, roundDays(balance.remaining));
  const paidDays = roundDays(Math.min(requestedDays, floorToHalfDay(remainingCredits)));

  return {
    leaveType: String(balance.type || leaveType),
    requestedDays,
    remainingCredits,
    paidDays,
    unpaidDays: roundDays(requestedDays - paidDays),
  };
}

export function extractLeaveWithoutPayPrompt(error) {
  const data = error?.response?.data;

  if (!data || data.code !== LEAVE_WITHOUT_PAY_CONFIRMATION_CODE) {
    return null;
  }

  const prompt = data.leaveWithoutPay || {};
  const unpaidDays = roundDays(prompt.unpaidDays);

  if (unpaidDays <= 0) {
    return null;
  }

  return {
    leaveType: String(prompt.leaveType || ""),
    requestedDays: roundDays(prompt.requestedDays),
    remainingCredits: roundDays(prompt.remainingCredits),
    paidDays: roundDays(prompt.paidDays),
    unpaidDays,
  };
}

export async function confirmLeaveWithoutPay(split) {
  if (!split || split.unpaidDays <= 0) {
    return true;
  }

  const leaveTypeLabel = split.leaveType || "leave";
  const result = await Swal.fire({
    title: "Insufficient Leave Balance",
    icon: "warning",
    html: `
      <p style="margin:0 0 12px;font-size:14px;color:#334155;">
        You only have <strong>${formatLeaveDays(split.remainingCredits)} day(s)</strong>
        of ${leaveTypeLabel} credits left, so this request cannot be fully charged with pay.
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-size:13px;">
        <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 12px;background:#f8fafc;">
          <span style="color:#475569;">Days applied for</span>
          <strong style="color:#0f172a;">${formatLeaveDays(split.requestedDays)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #e2e8f0;">
          <span style="color:#475569;">Days with pay</span>
          <strong style="color:#0f766e;">${formatLeaveDays(split.paidDays)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #e2e8f0;">
          <span style="color:#475569;">Days without pay</span>
          <strong style="color:#b45309;">${formatLeaveDays(split.unpaidDays)}</strong>
        </div>
      </div>
      <p style="margin:12px 0 0;font-size:13px;color:#64748b;">
        If you proceed, the excess ${formatLeaveDays(split.unpaidDays)} day(s) will be filed as
        <strong>Leave Without Pay</strong>.
      </p>
    `,
    showCancelButton: true,
    confirmButtonText: "Proceed",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#0f766e",
    cancelButtonColor: "#64748b",
    reverseButtons: true,
    focusCancel: true,
  });

  return result.isConfirmed;
}
