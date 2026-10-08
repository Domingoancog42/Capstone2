import { LEAVE_MONETIZATION_TYPE } from "../data/leaveTypes";
import { normalizeLeaveStatus } from "./leaveHelpers";

/*
 * CSC Omnibus Rules on Leave, Rule XVI, Sec. 22-23. The server is the authority on these and sends
 * them alongside the credit summary; these are the numbers the form draws with before the first
 * summary lands, and the fallback if an older response omits them.
 */
export const DEFAULT_MONETIZATION_RULES = {
  minimumAccumulatedDays: 15,
  minimumRequestDays: 10,
  retainedDays: 5,
  annualCapDays: 30,
  justificationRatio: 0.5,
};

export function formatMonetizationDays(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(2);
}

export function resolveMonetizationRules(creditSummary) {
  return { ...DEFAULT_MONETIZATION_RULES, ...(creditSummary?.rules || {}) };
}

/**
 * Half or more of the accumulated credits is the "50% or more" filing, which the rules allow only
 * for a stated reason — so the purpose that is optional elsewhere becomes mandatory.
 */
export function monetizationNeedsJustification({ requestedDays, accumulatedDays, rules }) {
  return requestedDays > 0
    && accumulatedDays > 0
    && requestedDays >= accumulatedDays * rules.justificationRatio;
}

/**
 * The first CSC ceiling the entered figure breaks, checked widest gate inwards so the message names
 * the rule that actually stopped it. Empty string means the figure is filable. Re-checked server
 * side by leave_monetization.php, which is the authority.
 */
export function resolveMonetizationDaysError({
  creditOption,
  requestedDays,
  rules,
  yearToDateMonetized,
}) {
  if (!creditOption || requestedDays <= 0) {
    return "";
  }

  const accumulatedDays = Number(creditOption.remaining || 0);
  const availableDays = Number(creditOption.available || 0);
  const annualRemaining = Math.max(0, rules.annualCapDays - yearToDateMonetized);

  if (accumulatedDays < rules.minimumAccumulatedDays) {
    return `At least ${formatMonetizationDays(rules.minimumAccumulatedDays)} accumulated ${creditOption.leaveType} credit(s) are required before any can be monetized (currently ${formatMonetizationDays(accumulatedDays)}).`;
  }

  if (requestedDays < rules.minimumRequestDays) {
    return `A monetization must cover at least ${formatMonetizationDays(rules.minimumRequestDays)} day(s).`;
  }

  if (requestedDays > availableDays) {
    return `Only ${formatMonetizationDays(availableDays)} day(s) available.`;
  }

  if (availableDays - requestedDays < rules.retainedDays) {
    return `At least ${formatMonetizationDays(rules.retainedDays)} day(s) must remain after monetization, so at most ${formatMonetizationDays(Math.max(0, availableDays - rules.retainedDays))} day(s) can be monetized now.`;
  }

  if (yearToDateMonetized + requestedDays > rules.annualCapDays) {
    return `Only ${formatMonetizationDays(rules.annualCapDays)} day(s) may be monetized per year. ${formatMonetizationDays(yearToDateMonetized)} day(s) are already monetized or awaiting approval, leaving ${formatMonetizationDays(annualRemaining)}.`;
  }

  return "";
}

/**
 * A monetization request dressed as a row of the leave request list.
 *
 * The two live in different tables and their ids overlap, so the row carries a `rowKey` the lists
 * key on and an `isLeaveMonetization` flag every handler branches on before it calls an API. The
 * filing has no span of dates — it is days of credit, not days away — so `startDate` and `endDate`
 * stay empty and the credit it draws from is kept under `monetizedLeaveType`.
 */
export function toLeaveMonetizationRow(record) {
  return {
    ...record,
    isLeaveMonetization: true,
    rowKey: `monetization-${record.id}`,
    monetizedLeaveType: record.leaveType || "",
    leaveType: LEAVE_MONETIZATION_TYPE,
    startDate: "",
    endDate: "",
  };
}

/** The list rows for a leave request, which only ever collide with a monetization row's key. */
export function toLeaveRequestRow(request) {
  return { ...request, rowKey: `leave-${request.id}` };
}

/** Monetization follows the same approval desks as a leave application. */
export function resolveMonetizationRowActions({ roleKey, record, isOwnRecord }) {
  const role = String(roleKey || "").trim().toLowerCase();
  const status = normalizeLeaveStatus(record?.status);
  const stages = {
    Pending: { role: "hrstaff", next: "Endorsed" },
    Endorsed: { role: "hrhead", next: "Reviewed" },
    Reviewed: { role: "chief", next: "Chief Reviewed" },
    "Chief Reviewed": { role: "regionaldirector", next: "Approved" },
  };
  const stage = stages[status];
  const canAct = !isOwnRecord && Boolean(stage) && (role === "admin" || role === stage.role);
  return {
    showReview: false,
    showApprove: canAct,
    showReject: canAct,
    showCancel: !isOwnRecord && role === "admin" && Boolean(stage),
    showOwnCancel: isOwnRecord && status === "Pending",
    nextStatus: stage?.next || "",
  };
}
