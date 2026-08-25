import api from "./api";

/**
 * Archiving has no endpoint of its own. Each module owns its records, so each module's existing API
 * carries the `action: "archive"` / `action: "restore"` branch, the same way loan requests already
 * did. This maps a module key to that endpoint so the workspaces do not each need to remember it.
 *
 * Reading works the same way: a module's list endpoint takes `?archived=1` and returns only archived
 * rows, so the archived view is that module's own table in its own columns.
 */
const MODULE_ENDPOINTS = {
  leave: "/leave_request.php",
  travel: "/travel_order.php",
  cto: "/compensatory.php",
  passSlip: "/pass_slip.php",
  overtime: "/overtime.php",
  attendance: "/attendance.php",
  leaveBalance: "/leave_credit.php",
  leaveMonetization: "/leave_monetization.php",
};

/** Fired after a successful archive or restore so other open workspaces can reload. */
export const ARCHIVE_CHANGED_EVENT = "hris:archive:changed";

function endpointFor(moduleKey) {
  const endpoint = MODULE_ENDPOINTS[moduleKey];

  if (!endpoint) {
    throw new Error(`Unknown archive module: ${moduleKey}`);
  }

  return endpoint;
}

function publishArchiveChanged(moduleKey, id, archived) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ARCHIVE_CHANGED_EVENT, { detail: { module: moduleKey, id, archived } })
  );
}

async function setArchived(moduleKey, payload, archived) {
  const response = await api.put(endpointFor(moduleKey), {
    ...payload,
    action: archived ? "archive" : "restore",
  });

  publishArchiveChanged(moduleKey, payload.id ?? payload.employeeRecordId, archived);

  return response.data;
}

export async function archiveRecord(moduleKey, id) {
  return setArchived(moduleKey, { id }, true);
}

export async function restoreRecord(moduleKey, id) {
  return setArchived(moduleKey, { id }, false);
}

/**
 * Archive every record behind one on-screen row. Only Leave Balances needs this: its table shows an
 * employee per row, with a leave_credits row per leave type behind it.
 */
export async function archiveRecordGroup(moduleKey, { employeeRecordId, year }) {
  return setArchived(moduleKey, { employeeRecordId, ...(year ? { year } : {}) }, true);
}

export async function restoreRecordGroup(moduleKey, { employeeRecordId, year }) {
  return setArchived(moduleKey, { employeeRecordId, ...(year ? { year } : {}) }, false);
}
