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
 * Who may archive, per module. Mirrors the `roles` list on each entry of the backend registry —
 * the server is what actually enforces this; the copy here only decides whether to draw the button,
 * so that a role who would be refused never sees it.
 */
const ARCHIVE_MANAGER_ROLES = {
  leave: ["admin", "hrhead", "hrstaff", "regionaldirector"],
  travel: ["admin", "hrhead", "hrstaff", "regionaldirector", "planningofficer"],
  cto: ["admin", "hrhead", "hrstaff", "regionaldirector", "chief", "planningofficer"],
  passSlip: ["admin", "hrhead", "hrstaff", "regionaldirector"],
  overtime: ["admin", "hrhead", "hrstaff", "regionaldirector", "chief", "planningofficer"],
  attendance: ["admin", "hrhead", "hrstaff"],
  leaveBalance: ["admin", "hrhead"],
  leaveMonetization: ["admin", "hrhead", "hrstaff", "regionaldirector"],
};

export function canArchiveModule(roleKey, moduleKey) {
  return (ARCHIVE_MANAGER_ROLES[moduleKey] || []).includes(String(roleKey || ""));
}
