import { toast } from "react-hot-toast";
import Swal from "sweetalert2";

import {
  archiveRecord,
  archiveRecordGroup,
  restoreRecord,
  restoreRecordGroup,
} from "../services/archiveService";

/**
 * The confirm → call → toast → drop-the-row sequence, written once.
 *
 * Every module's Archive button wants exactly this, and the ones that already had one
 * (loan, rewards) had each grown their own copy with slightly different wording and different
 * error handling. A module supplies what is specific to it — the noun and who the record
 * belongs to — and gets the rest.
 *
 * Resolves to `true` when the record was archived, `false` when the user cancelled or the request
 * failed, so a caller can decide whether to remove the row optimistically or reload.
 */
export async function confirmArchiveRecord({
  module: moduleKey,
  id,
  noun = "record",
  owner = "",
  onArchived,
}) {
  if (!moduleKey || !id) {
    return false;
  }

  const subject = owner ? `${owner}'s ${noun}` : `this ${noun}`;
  const confirmation = await Swal.fire({
    title: `Archive ${noun}?`,
    text: `Archive ${subject}? It moves to the Archive page, where you can restore it.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Archive",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#dc2626",
    cancelButtonColor: "#64748b",
    focusCancel: true,
  });

  if (!confirmation.isConfirmed) {
    return false;
  }

  const toastId = toast.loading(`Archiving ${noun}...`);

  try {
    const result = await archiveRecord(moduleKey, id);
    toast.success(result?.message || `${noun} archived.`, { id: toastId });
    onArchived?.(id);

    return true;
  } catch (error) {
    toast.error(error?.response?.data?.message || `Unable to archive ${noun}.`, { id: toastId });

    return false;
  }
}

/** Archives several selected rows after one confirmation, while preserving each module endpoint's checks. */
export async function confirmArchiveRecords({
  records = [],
  getModule = () => "",
  getId = (record) => record?.id,
  noun = "request",
  onArchived,
}) {
  const targets = records
    .map((record) => ({ record, moduleKey: getModule(record), id: getId(record) }))
    .filter((target) => target.moduleKey && target.id);

  if (targets.length === 0) return { succeeded: [], failed: [] };

  const confirmation = await Swal.fire({
    title: `Archive ${targets.length} selected ${noun}${targets.length === 1 ? "" : "s"}?`,
    text: `The selected ${noun}${targets.length === 1 ? "" : "s"} will move to the Archive page, where they can be restored.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Archive selected",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#dc2626",
    cancelButtonColor: "#64748b",
    reverseButtons: true,
    focusCancel: true,
  });

  if (!confirmation.isConfirmed) return { succeeded: [], failed: [] };

  const toastId = toast.loading(`Archiving ${targets.length} selected ${noun}${targets.length === 1 ? "" : "s"}...`);
  const results = await Promise.allSettled(
    targets.map((target) => archiveRecord(target.moduleKey, target.id))
  );
  const succeeded = targets.filter((_, index) => results[index].status === "fulfilled");
  const failed = targets.filter((_, index) => results[index].status === "rejected");

  if (succeeded.length > 0) await onArchived?.(succeeded.map((target) => target.record));

  if (failed.length === 0) {
    toast.success(`${succeeded.length} ${noun}${succeeded.length === 1 ? "" : "s"} archived.`, { id: toastId });
  } else {
    const firstFailure = results.find((result) => result.status === "rejected");
    const detail = firstFailure?.reason?.response?.data?.message;
    toast.error(
      succeeded.length > 0
        ? `${succeeded.length} archived; ${failed.length} failed.`
        : detail || `Unable to archive the selected ${noun}s.`,
      { id: toastId }
    );
  }

  return { succeeded, failed };
}

/**
 * The grouped variant, for a screen whose row stands for several records — Leave Balances, where a
 * row is an employee and the records behind it are their credits for the displayed year.
 */
export async function confirmArchiveRecordGroup({
  module: moduleKey,
  employeeRecordId,
  year,
  noun = "records",
  owner = "",
  onArchived,
}) {
  if (!moduleKey || !employeeRecordId) {
    return false;
  }

  const subject = owner ? `${owner}'s ${noun}` : `these ${noun}`;
  const confirmation = await Swal.fire({
    title: `Archive ${noun}?`,
    text: `Archive ${subject}${year ? ` for ${year}` : ""}? They move to the Archive page, where you can restore them.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Archive",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#dc2626",
    cancelButtonColor: "#64748b",
    focusCancel: true,
  });

  if (!confirmation.isConfirmed) {
    return false;
  }

  const toastId = toast.loading(`Archiving ${noun}...`);

  try {
    const result = await archiveRecordGroup(moduleKey, { employeeRecordId, year });
    toast.success(result?.message || `${noun} archived.`, { id: toastId });
    onArchived?.(employeeRecordId);

    return true;
  } catch (error) {
    toast.error(error?.response?.data?.message || `Unable to archive ${noun}.`, { id: toastId });

    return false;
  }
}

/** The grouped mirror, for the Leave Balances archived view. */
export async function confirmRestoreRecordGroup({
  module: moduleKey,
  employeeRecordId,
  year,
  noun = "records",
  owner = "",
  onRestored,
}) {
  if (!moduleKey || !employeeRecordId) {
    return false;
  }

  const subject = owner ? `${owner}'s ${noun}` : `these ${noun}`;
  const confirmation = await Swal.fire({
    title: `Restore ${noun}?`,
    text: `Restore ${subject}${year ? ` for ${year}` : ""}? They return to the ${noun} list.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Restore",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#0f766e",
    cancelButtonColor: "#64748b",
  });

  if (!confirmation.isConfirmed) {
    return false;
  }

  const toastId = toast.loading(`Restoring ${noun}...`);

  try {
    const result = await restoreRecordGroup(moduleKey, { employeeRecordId, year });
    toast.success(result?.message || `${noun} restored.`, { id: toastId });
    onRestored?.(employeeRecordId);

    return true;
  } catch (error) {
    toast.error(error?.response?.data?.message || `Unable to restore ${noun}.`, { id: toastId });

    return false;
  }
}

/** The mirror of confirmArchiveRecord, used by each module's archived view. */
export async function confirmRestoreRecord({
  module: moduleKey,
  id,
  noun = "record",
  owner = "",
  onRestored,
}) {
  if (!moduleKey || !id) {
    return false;
  }

  const subject = owner ? `${owner}'s ${noun}` : `this ${noun}`;
  const confirmation = await Swal.fire({
    title: `Restore ${noun}?`,
    text: `Restore ${subject}? It returns to the ${noun} list.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Restore",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#0f766e",
    cancelButtonColor: "#64748b",
  });

  if (!confirmation.isConfirmed) {
    return false;
  }

  const toastId = toast.loading(`Restoring ${noun}...`);

  try {
    const result = await restoreRecord(moduleKey, id);
    toast.success(result?.message || `${noun} restored.`, { id: toastId });
    onRestored?.(id);

    return true;
  } catch (error) {
    toast.error(error?.response?.data?.message || `Unable to restore ${noun}.`, { id: toastId });

    return false;
  }
}

/**
 * Who may archive, per module. Mirrors the backend permission for each module. Pass slips, leave,
 * CTO and travel orders are available to every signed-in role (employees remain scoped to their
 * own settled records); the server still enforces that scope, while this copy only decides whether
 * to draw the button.
 */
const ARCHIVE_MANAGER_ROLES = {
  leave: [
    "admin",
    "cashier",
    "chief",
    "employee",
    "hrhead",
    "hrstaff",
    "planningofficer",
    "regionaldirector",
  ],
  travel: ["admin", "cashier", "employee", "hrhead", "hrstaff", "regionaldirector", "planningofficer"],
  cto: ["admin", "cashier", "employee", "hrhead", "hrstaff", "regionaldirector", "chief", "planningofficer"],
  passSlip: [
    "admin",
    "chief",
    "planningofficer",
    "cashier",
    "employee",
    "hrhead",
    "hrstaff",
    "regionaldirector",
  ],
  overtime: ["admin", "employee", "hrhead", "hrstaff", "regionaldirector", "chief", "planningofficer"],
  attendance: ["admin", "hrhead", "hrstaff"],
  leaveBalance: ["admin", "hrhead", "hrstaff"],
  leaveMonetization: [
    "admin",
    "cashier",
    "employee",
    "hrhead",
    "hrstaff",
    "planningofficer",
    "regionaldirector",
  ],
  // Mirrors promotion_can_archive() in promotion.php: the desks that draft one and the desk that
  // signs it file it away once it is settled.
  promotions: ["admin", "hrhead", "hrstaff", "chief", "regionaldirector"],
};

export function canArchiveModule(roleKey, moduleKey) {
  return (ARCHIVE_MANAGER_ROLES[moduleKey] || []).includes(String(roleKey || ""));
}
