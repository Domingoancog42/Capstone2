/*
 * The pass slip status vocabulary, shared by the register, the printed sheet and the scan console.
 *
 * Mirrors the constants in backend/api/pass-slip-utils.php. The server is the only thing that moves
 * a slip between these; everything here is about naming and colouring what it decided, so that the
 * table badge, the QR panel and the scanner result all say the same word for the same state.
 *
 * None of these is an approval state, because a pass slip has no approval step: it is live the
 * moment it is filed. The status answers "where is this person" -- ready to go, out of the
 * building, or back -- plus CANCELLED for a slip that will not be used at all.
 */

export const PASS_SLIP_STATUS = {
  ACTIVE: "ACTIVE",
  OUT: "OUT",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

/** The two states in which a slip's QR code does something when scanned. */
export const PASS_SLIP_SCANNABLE = new Set([PASS_SLIP_STATUS.ACTIVE, PASS_SLIP_STATUS.OUT]);

/*
 * How long a pass slip may be expected to cover. Under an hour is not filed at all and over three
 * hours is a leave request, so the picker offers the half-hour steps in between. The actual time out
 * is whatever the two scans say and is never refused -- someone already out of the office cannot be
 * told their return is invalid -- so these bound the request, not the result.
 */
export const PASS_SLIP_MIN_MINUTES = 60;
export const PASS_SLIP_MAX_MINUTES = 180;

export const PASS_SLIP_DURATION_OPTIONS = [60, 90, 120, 150, 180];

export const PASS_SLIP_TYPES = ["Official Business", "Personal"];

export function normalizePassSlipStatus(status) {
  const value = String(status || "").trim().toUpperCase();
  return PASS_SLIP_STATUS[value] || PASS_SLIP_STATUS.ACTIVE;
}

/*
 * "OUT / ON PASS SLIP" and "RETURNED / COMPLETED" are spelled the way the gate desk reads them, not
 * the way the column stores them -- the whole point of the status on this screen is that someone
 * glancing at it knows whether the person is in the building. ACTIVE is named for what to do with
 * it rather than for what it is, since "active" on its own tells an employee nothing.
 */
export function passSlipStatusLabel(status) {
  switch (normalizePassSlipStatus(status)) {
    case PASS_SLIP_STATUS.OUT:
      return "Out / On Pass Slip";
    case PASS_SLIP_STATUS.COMPLETED:
      return "Returned / Completed";
    case PASS_SLIP_STATUS.CANCELLED:
      return "Cancelled";
    default:
      return "Ready to Scan";
  }
}

/** The short form for the printed sheet and the narrow table badge. */
export function passSlipShortStatusLabel(status) {
  switch (normalizePassSlipStatus(status)) {
    case PASS_SLIP_STATUS.OUT:
      return "Out";
    case PASS_SLIP_STATUS.COMPLETED:
      return "Completed";
    default:
      return passSlipStatusLabel(status);
  }
}

export function passSlipStatusBadgeClasses(status) {
  switch (normalizePassSlipStatus(status)) {
    /* Amber, and only this one: it is the state that means a person is not in the building. */
    case PASS_SLIP_STATUS.OUT:
      return "border border-amber-300 bg-amber-50 text-amber-800";
    case PASS_SLIP_STATUS.COMPLETED:
      return "border border-emerald-200 bg-emerald-50 text-emerald-700";
    case PASS_SLIP_STATUS.CANCELLED:
      return "border border-slate-300 bg-slate-100 text-slate-600";
    default:
      return "border border-sky-200 bg-sky-50 text-sky-700";
  }
}

/** True while the slip's QR code will still move it along. */
export function isPassSlipQrActive(record) {
  return Boolean(record?.qrToken)
    && !record?.isArchived
    && PASS_SLIP_SCANNABLE.has(normalizePassSlipStatus(record?.status));
}

/** What the next scan of this slip's code would do, in words, for the QR panel's caption. */
export function passSlipNextScanLabel(record) {
  const status = normalizePassSlipStatus(record?.status);

  if (status === PASS_SLIP_STATUS.ACTIVE) return "Next scan records Time Out";
  if (status === PASS_SLIP_STATUS.OUT) return "Next scan records Time Returned";
  if (status === PASS_SLIP_STATUS.COMPLETED) return "Completed — the code is no longer active";
  return "Cancelled — the code is no longer active";
}

export function formatPassSlipDuration(minutes) {
  const total = Number(minutes);

  if (!Number.isFinite(total) || total < 0) return "";
  if (total === 0) return "under a minute";

  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (hours === 0) return `${rest} min`;
  return `${hours} hr${hours === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`;
}

/**
 * Minutes a slip has run past what it asked for, or 0 while it is still inside it.
 *
 * Reads the live clock for a slip that is still out, and the recorded duration once it is back, so
 * the register can flag an overdue absence while it is happening rather than only in hindsight.
 */
export function passSlipOverdueMinutes(record, now = Date.now()) {
  const expected = Number(record?.expectedMinutes) || 0;
  if (expected <= 0) return 0;

  const status = normalizePassSlipStatus(record?.status);

  if (status === PASS_SLIP_STATUS.COMPLETED) {
    return Math.max(0, (Number(record?.durationMinutes) || 0) - expected);
  }

  if (status !== PASS_SLIP_STATUS.OUT || !record?.timeOutAt) return 0;

  /*
   * MySQL hands back "YYYY-MM-DD HH:MM:SS", which Safari refuses to parse as a Date. The space
   * becomes a T so every browser reads it as the local wall-clock time it is, rather than one
   * browser reading it as UTC and reporting an absence eight hours long.
   */
  const startedAt = new Date(String(record.timeOutAt).replace(" ", "T")).getTime();
  if (Number.isNaN(startedAt)) return 0;

  return Math.max(0, Math.round((now - startedAt) / 60000) - expected);
}

/** Minutes a slip has been out so far, for the live "out for ..." reading on an open slip. */
export function passSlipElapsedMinutes(record, now = Date.now()) {
  if (normalizePassSlipStatus(record?.status) !== PASS_SLIP_STATUS.OUT || !record?.timeOutAt) {
    return null;
  }

  const startedAt = new Date(String(record.timeOutAt).replace(" ", "T")).getTime();
  if (Number.isNaN(startedAt)) return null;

  return Math.max(0, Math.round((now - startedAt) / 60000));
}

/** The date a slip actually happened on: the day it was scanned out, falling back to the filed date. */
export function passSlipEffectiveDate(record) {
  return record?.timeOutDate || record?.passDate || "";
}
