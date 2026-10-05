import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, FilePenLine, Filter, Search } from "lucide-react";
import {
  faBan,
  faBoxArchive,
  faCheck,
  faEye,
  faFileLines,
  faPenToSquare,
  faRotateLeft,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ActionsMenu from "../../components/UI/ActionsMenu";
import BulkSelectionToolbar from "../../components/UI/BulkSelectionToolbar";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import SelectionCheckbox from "../../components/UI/SelectionCheckbox";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import LeaveStatusBadge, { getDisapprovedStatusLabel } from "../../components/leave/LeaveStatusBadge";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchOvertimeAccomplishmentReports,
  fetchOvertimeRequests,
  fileOvertimeRequest,
  updateOvertimeAccomplishmentStatus,
  updateOvertimeRequest,
  updateOvertimeStatus,
} from "../../services/overtimeService";
import {
  AccomplishmentReportFormModal,
  AccomplishmentReportPreviewModal,
  DEFAULT_ACCOMPLISHMENT_LOCATION,
  formatAccomplishmentStatusLabel,
  formatMemoTime,
  minutesBetween,
  splitTaskLines,
} from "./AccomplishmentReportMemo";
import {
  countPendingRecords,
  isPastDate,
  matchesUserRecordScope,
  normalizeLeaveStatus,
  resolveRoleKey,
  todayDateInputValue,
} from "../../utils/leaveHelpers";
import { formatRecordDivision } from "../../utils/divisionDisplay";
import { normalizeRole } from "../../utils/roleRoutes";
import { requestApprovalCaptcha, isCaptchaFailure } from "../../utils/approvalCaptcha";
import { confirmBulkApproval } from "../../utils/bulkRequestActions";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmArchiveRecords,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import useRowSelection from "../../hooks/useRowSelection";

/*
 * The filter's choices. "Reviewed" is deliberately not one of them: the table labels both open
 * stages "Pending", so the filter says Pending too and reads it the way the leave screens do -- see
 * matchesOvertimeStatusFilter().
 */
const overtimeStatuses = ["Pending", "Approved", "Rejected", "Cancelled"];

/* The two stages a filing can still be acted on. Anything else is already settled. */
const openStatuses = ["Pending", "Reviewed"];

/*
 * Whose desk each open stage sits on, mirroring overtime.php: the Chief Admin gives the first
 * approval on a Pending filing, then the Regional Director gives the final approval on the Reviewed
 * stage. Roles missing here have no signature to give and see every open stage.
 */
const OPEN_STAGES_BY_ROLE = {
  chiefadmin: ["Pending"],
  regionaldirector: ["Reviewed"],
};

/*
 * The Pending filter means "waiting at my desk", as it does on Leave Management. Filtering on the
 * stored word instead left the Regional Director's table empty: what waits on the Director is stored
 * as Reviewed, so the default Pending filter hid the very rows the Director opens the page for. An
 * applicant's own filing stays visible at every open stage -- it is a record to follow, not a task.
 * An approved filing whose accomplishment report waits on this desk's note is waiting here too, so
 * it stays under Pending even though the overtime itself is settled.
 */
function matchesOvertimeStatusFilter(record, filterStatus, roleKey, isOwnRecord, reportWaitsOnMe = false) {
  const filter = String(filterStatus || "").trim().toLowerCase();
  if (!filter) return true;

  const recordStatus = record?.status || "Pending";
  if (filter !== "pending") return recordStatus.toLowerCase() === filter;

  if (reportWaitsOnMe) return true;
  if (isOwnRecord) return openStatuses.includes(recordStatus);

  return (OPEN_STAGES_BY_ROLE[roleKey] || openStatuses).includes(recordStatus);
}
const overtimeRowKey = (record) => record?.id;

/*
 * The filing carries the accomplishment report's details too -- the window, location, tasks and
 * expected output -- so the memo comes pre-filled once the overtime is rendered. The hours are
 * counted from the window rather than typed, and the reason is the task list, one task per line.
 */
const initialForm = {
  employeeRecordId: "",
  employeeRecordIds: [],
  employeeName: "",
  workDate: "",
  timeStart: "",
  timeEnd: "",
  location: DEFAULT_ACCOMPLISHMENT_LOCATION,
  reason: "",
  expectedOutputs: "",
};

const textAreaClassName = "w-full resize-y rounded-lg border bg-white px-3 py-2.5 text-slate-900 outline-none placeholder:text-slate-400";

function buildEmployeeName(employee) {
  return employee?.employeeName
    || employee?.fullName
    || employee?.full_name
    || employee?.username
    || employee?.email
    || "Employee";
}

function buildEmployeeOptions(employees = []) {
  return employees
    .map((employee) => ({
      employeeRecordId: employee.employeeRecordId || employee.id || employee.employee_id || "",
      employeeId: employee.employeeId || employee.employee_id || "",
      employeeName: buildEmployeeName(employee),
      division: employee.department || employee.division || employee.divisionName || "",
    }))
    .filter((employee) => employee.employeeRecordId || employee.employeeName);
}

function formatAmount(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? numericValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function formatLocalSqlDateTime(date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-")
    + " "
    + [
      padDatePart(date.getHours()),
      padDatePart(date.getMinutes()),
      padDatePart(date.getSeconds()),
    ].join(":");
}

function formatRequestDate(record) {
  return record?.requestDateDisplay || record?.requestDate || record?.dateFiled || "No date";
}

/** "5:00pm – 8:00pm", or "" for a filing made before the window was asked for. */
function formatOvertimeWindow(record) {
  return record?.timeStart && record?.timeEnd
    ? `${formatMemoTime(record.timeStart)} – ${formatMemoTime(record.timeEnd)}`
    : "";
}

/*
 * The status pill's wording: the desk an open overtime request is waiting on, or the desk that
 * disapproved it. The chain is Chief Admin first, then the Regional Director's final approval -- see
 * overtime.php. overtime has no rejected_by_role column, but each desk may only disapprove at its own
 * stage, so a disapproval that already carries the Chief Admin's signature was the Director's.
 * Other settled statuses return "" so the badge falls back to its plain label.
 */
function getOvertimeStatusLabel(record) {
  const status = normalizeLeaveStatus(record?.status || "Pending");

  if (status === "Pending") {
    return "Pending by Chief Admin";
  }

  if (status === "Reviewed") {
    return "Pending by Regional Director";
  }

  if (status === "Rejected") {
    return getDisapprovedStatusLabel(record?.reviewedByEmployeeRecordId ? "regionaldirector" : "chiefadmin");
  }

  return "";
}

/*
 * An approved filing still owes its accomplishment report once the day has come and gone: the memo
 * is the employee's own account of the hours, so only the owner is offered it, and a memo the chief
 * returned is owed again. Manual COC credits were never rendered, so they never report.
 */
function needsAccomplishmentReport(record, user) {
  const reportStatus = record?.accomplishmentReport?.status;
  const workDate = String(record?.workDate || record?.overtimeDate || "");

  return (record?.status || "Pending") === "Approved"
    && String(record?.source || "request").toLowerCase() !== "manual_coc"
    && matchesUserRecordScope(record, user)
    && workDate !== ""
    && workDate <= todayDateInputValue()
    && (!reportStatus || reportStatus === "Rejected");
}

/* A submitted memo still waiting on this desk's note. A chief never notes their own. */
function reportAwaitsNote(record, user, canNoteReports) {
  return canNoteReports
    && record?.accomplishmentReport?.status === "Pending"
    && !matchesUserRecordScope(record, user);
}

export default function OvertimeWorkspace({
  user,
  employees = [],
  title = "Overtime Management",
  description = "File, review, and monitor overtime requests.",
  submitLabel = "File Overtime Request",
  showEmployeeFilter = true,
  onPendingCountChange,
}) {
  const roleKey = resolveRoleKey(user);
  /* Chief Admin resolves to its base role `chief` above; the approval stages need the exact role. */
  const stageRoleKey = normalizeRole(user?.roleKey || user?.role) === "chiefadmin" ? "chiefadmin" : roleKey;
  const defaultStatus = roleKey === "employee" ? "" : "Pending";
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(defaultStatus);
  const [date, setDate] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportTarget, setReportTarget] = useState(null);
  const [viewingReport, setViewingReport] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  /* The memo is noted at the division chief's desk; an administrator may stand in. */
  const canNoteReports = ["chief", "admin"].includes(roleKey);
  const canManage = ["admin", "hrhead", "hrstaff", "regionaldirector", "chief", "planningofficer"].includes(roleKey);
  /*
   * Only two desks approve overtime: the Chief Admin gives the first approval and the Regional
   * Director gives the final approval. Only the final signature turns the hours into compensatory
   * overtime credits. Division Chiefs and planning officers may help file requests but do not
   * approve them.
   */
  const isDivisionFiler = ["chief", "planningofficer"].includes(roleKey);
  const canChiefAdminApprove = stageRoleKey === "chiefadmin";
  const canGiveFinalApproval = roleKey === "regionaldirector";
  const canEditRequests = ["admin", "hrhead", "hrstaff", "chief", "planningofficer"].includes(roleKey);
  /*
   * Cancellation remains with the filing-maintenance desks; the Regional Director's desk only
   * makes a final decision. Keep the existing HR Head restriction as well.
   */
  const canCancelRequests = canManage && !["hrhead", "regionaldirector"].includes(roleKey);
  /*
   * Archiving is tidying, not deciding, so every desk that sees the list may do it -- the chief and
   * planning officer who file, the desks that sign, and the employee for their own filings. An
   * employee may only tuck away a settled one, so a filing still moving through the Chief Admin and
   * Regional Director cannot be hidden from them. overtime.php refuses the rest.
   */
  const canArchive = canArchiveModule(roleKey, "overtime");
  const archivesOwnSettledOnly = roleKey === "employee";
  const canArchiveRecord = useCallback((record) => (
    canArchive
    && (!archivesOwnSettledOnly || ["Approved", "Rejected", "Cancelled"].includes(record?.status || "Pending"))
  ), [archivesOwnSettledOnly, canArchive]);
  const [archiveView, setArchiveView] = useState(false);
  const pendingCount = useMemo(() => countPendingRecords(records), [records]);

  const employeeOptions = useMemo(() => buildEmployeeOptions(employees), [employees]);
  const canSelectEmployee = showEmployeeFilter && roleKey !== "employee" && employeeOptions.length > 0;
  /*
   * A chief and the HR head both authorize a shift for several employees at a time, so their form
   * gets the multi-select picker — the same control the travel order form uses; every other role
   * files one request at a time. The server already accepts a list from any role that can file for
   * others, so this is only about which form is shown.
   */
  const useEmployeeChecklist = canSelectEmployee && (isDivisionFiler || roleKey === "hrhead");
  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeOptions, form.employeeRecordId]
  );
  const selectedEmployees = useMemo(
    () => employeeOptions.filter((employee) => form.employeeRecordIds.includes(String(employee.employeeRecordId))),
    [employeeOptions, form.employeeRecordIds]
  );

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      /* Manual COC credits live on the compensatory credits page; they were never filed here. */
      const [requestResult, reportResult] = await Promise.allSettled([
        fetchOvertimeRequests({ archived: archiveView, source: "request" }),
        Promise.resolve().then(() => fetchOvertimeAccomplishmentReports()),
      ]);
      if (requestResult.status === "rejected") {
        throw requestResult.reason;
      }
      setRecords(requestResult.value?.records || []);
      /* The request table stands on its own; a failed memo fetch only leaves the report previews stale. */
      if (reportResult.status === "fulfilled") {
        setReports(reportResult.value?.records || []);
      }
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load overtime requests.");
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView]);

  // The hook reads its callback through a ref, so it will not refetch when `loadRecords` changes
  // identity — this effect does, which is what makes the archive toggle actually reload the table.
  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useAutoRefreshOnChange(loadRecords, { topic: "overtime", refreshOnMount: false });

  useEffect(() => {
    onPendingCountChange?.(pendingCount);
  }, [onPendingCountChange, pendingCount]);

  const findReportForRecord = useCallback(
    (record) => reports.find((report) => Number(report.overtimeId) === Number(record?.id)) || null,
    [reports]
  );

  /*
   * The memo window gets the filing and any returned memo as they stood when it opened. Looked up
   * on every render instead, the list's background refresh handed it a fresh copy of the same memo
   * every few seconds, and the window re-seeded itself over whatever was being typed.
   */
  const openReportForm = (record) => {
    setReportTarget({ overtime: record, previousReport: findReportForRecord(record) });
  };

  const openReportPreviewForRecord = (record) => {
    const report = findReportForRecord(record);
    if (!report) {
      toast.error("The accomplishment report could not be loaded. Refresh and try again.");
      return;
    }
    setViewingReport(report);
  };

  const handleNoteReport = async (report) => {
    if (!report || reportBusy) return;

    const confirmation = await Swal.fire({
      title: "Note this accomplishment report?",
      html: `<p class="m-0 text-sm">${report.employeeName || "The employee"} reported on the overtime rendered on <strong>${report.workDate || ""}</strong>. Noting it signs the memo as Division Chief.</p>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Note Report",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
    });
    if (!confirmation.isConfirmed) return;

    setReportBusy(true);
    try {
      const result = await updateOvertimeAccomplishmentStatus(report.id, "Approved");
      toast.success(result?.message || "Accomplishment report noted.");
      setViewingReport(null);
      await loadRecords({ background: true });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to note the accomplishment report.");
    } finally {
      setReportBusy(false);
    }
  };

  const handleReturnReport = async (report) => {
    if (!report || reportBusy) return;

    const prompt = await Swal.fire({
      title: "Return this accomplishment report?",
      text: "Tell the employee what to revise. The memo goes back to them and can be resubmitted.",
      input: "textarea",
      inputPlaceholder: "Remarks for the employee...",
      inputAttributes: { maxlength: 500 },
      inputValidator: (value) => (String(value || "").trim() ? undefined : "Remarks are required when returning a report."),
      showCancelButton: true,
      confirmButtonText: "Return Report",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
    });
    if (!prompt.isConfirmed) return;

    setReportBusy(true);
    try {
      const result = await updateOvertimeAccomplishmentStatus(report.id, "Rejected", String(prompt.value || "").trim());
      toast.success(result?.message || "Accomplishment report returned to the employee.");
      setViewingReport(null);
      await loadRecords({ background: true });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to return the accomplishment report.");
    } finally {
      setReportBusy(false);
    }
  };

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = !search || [
        record.employeeName,
        record.employeeId,
        record.division,
        record.reason,
        record.requestDateDisplay,
        record.requestDate,
        record.dateFiled,
        record.status,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      const matchesStatus = matchesOvertimeStatusFilter(
        record,
        status,
        stageRoleKey,
        matchesUserRecordScope(record, user),
        reportAwaitsNote(record, user, canNoteReports)
      );
      const matchesDate = !date || record.workDate === date || record.overtimeDate === date;

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [canNoteReports, date, query, records, stageRoleKey, status, user]);
  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * pageSize;
    return filteredRecords.slice(startIndex, startIndex + pageSize);
  }, [filteredRecords, pageSize, safePage]);
  const selection = useRowSelection(filteredRecords, overtimeRowKey);
  const canBulkApproveRecord = useCallback((record) => {
    const recordStatus = record.status || "Pending";
    const isManualCredit = String(record.source || "request").toLowerCase() === "manual_coc";
    const isOwnRecord = matchesUserRecordScope(record, user);

    return !isOwnRecord && !isManualCredit && (
      (canChiefAdminApprove && recordStatus === "Pending")
      || (canGiveFinalApproval && recordStatus === "Reviewed")
    );
  }, [canChiefAdminApprove, canGiveFinalApproval, user]);
  const bulkApprovableRecords = selection.selectedRows.filter(canBulkApproveRecord);
  const bulkArchivableRecords = !archiveView ? selection.selectedRows.filter(canArchiveRecord) : [];
  const selectablePageRecords = !archiveView
    ? paginatedRecords.filter((record) => canArchiveRecord(record) || canBulkApproveRecord(record))
    : [];

  useEffect(() => {
    setCurrentPage(1);
  }, [date, query, rowsPerPage, status]);

  /* Null until both times are in and the end comes after the start. */
  const plannedMinutes = minutesBetween(form.timeStart, form.timeEnd);

  const openForm = () => {
    setEditingRecord(null);
    setForm({
      ...initialForm,
      employeeName: user?.full_name || user?.username || "",
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditForm = (record) => {
    setEditingRecord(record);
    setForm({
      ...initialForm,
      employeeRecordId: record.employeeRecordId || "",
      employeeName: record.employeeName || "",
      workDate: record.workDate || record.overtimeDate || "",
      timeStart: String(record.timeStart || "").slice(0, 5),
      timeEnd: String(record.timeEnd || "").slice(0, 5),
      location: record.location || DEFAULT_ACCOMPLISHMENT_LOCATION,
      reason: record.reason || "",
      expectedOutputs: record.expectedOutputs || "",
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const closeForm = () => {
    setModalOpen(false);
    setEditingRecord(null);
    setForm(initialForm);
    setFormErrors({});
  };

  const updateForm = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setFormErrors((current) => ({ ...current, [field === "timeStart" || field === "timeEnd" ? "time" : field]: "" }));
  };

  const handleEmployeeSelect = (employee) => {
    setForm((current) => ({
      ...current,
      employeeRecordId: employee?.employeeRecordId || "",
      employeeName: employee?.employeeName || "",
    }));
  };

  /* Ticking a name in the multi-select adds it; ticking it again (or its chip's X) takes it off. */
  const handleToggleEmployee = (employee) => {
    const recordId = String(employee?.employeeRecordId || "");

    if (!recordId) {
      return;
    }

    setForm((current) => ({
      ...current,
      employeeRecordIds: current.employeeRecordIds.includes(recordId)
        ? current.employeeRecordIds.filter((selectedId) => selectedId !== recordId)
        : [...current.employeeRecordIds, recordId],
    }));
    setFormErrors((current) => ({ ...current, employeeRecordIds: "" }));
  };

  const handleClearEmployees = () => {
    setForm((current) => ({ ...current, employeeRecordIds: [] }));
  };

  const submitOvertime = async (event) => {
    event.preventDefault();

    const nextErrors = {};

    /*
     * The `min` on the input stops the calendar offering earlier days, but a typed or pasted value
     * still gets here, so the rule is enforced again rather than trusted. Applies to every role,
     * admin included -- overtime is authorized before it is rendered, never filed after the fact.
     */
    if (form.workDate && isPastDate(form.workDate)) {
      nextErrors.workDate = "Work date cannot be in the past. Choose today or a later date.";
    }

    if (!editingRecord && useEmployeeChecklist && form.employeeRecordIds.length === 0) {
      nextErrors.employeeRecordIds = "Select at least one employee.";
    }

    /* Same rules the memo applies, so a filing never pre-fills a report that cannot be submitted. */
    if (!form.timeStart || !form.timeEnd) {
      nextErrors.time = "Enter the time the overtime starts and ends.";
    } else if (plannedMinutes === null) {
      nextErrors.time = "The end time must be later than the start time.";
    }

    if (splitTaskLines(form.reason).length === 0) {
      nextErrors.reason = "List at least one task to perform.";
    }

    if (!form.expectedOutputs.trim()) {
      nextErrors.expectedOutputs = "Describe the output expected.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      return;
    }

    setFormErrors({});
    setSaving(true);
    const submitToastId = toast.loading(
      editingRecord ? "Saving overtime request..." : "Submitting overtime request..."
    );

    /* overtime.php counts the hours from the window itself; they are sent for the record. */
    const details = {
      workDate: form.workDate,
      timeStart: form.timeStart,
      timeEnd: form.timeEnd,
      hourRequested: (plannedMinutes / 60).toFixed(2),
      location: form.location.trim(),
      reason: form.reason.trim(),
      expectedOutputs: form.expectedOutputs.trim(),
    };

    try {
      const result = editingRecord
        ? await updateOvertimeRequest(editingRecord.id, details)
        : await fileOvertimeRequest({
          ...details,
          employeeRecordId: form.employeeRecordId,
          employeeRecordIds: useEmployeeChecklist ? form.employeeRecordIds : undefined,
          employeeName: form.employeeName,
          requestDate: formatLocalSqlDateTime(new Date()),
        });

      /* A chief's filing comes back as several rows, so the list is merged on id, not prepended. */
      const savedRecords = Array.isArray(result.records) && result.records.length > 0
        ? result.records
        : [result.record].filter(Boolean);

      if (savedRecords.length > 0) {
        const savedIds = new Set(savedRecords.map((record) => String(record.id)));
        setRecords((current) => {
          const untouched = current.filter((record) => !savedIds.has(String(record.id)));
          return editingRecord
            ? current.map((record) => savedRecords.find((saved) => String(saved.id) === String(record.id)) || record)
            : [...savedRecords, ...untouched];
        });
      } else {
        await loadRecords();
      }

      if (!editingRecord) {
        setQuery("");
        setStatus(defaultStatus);
        setDate("");
        setCurrentPage(1);
      }

      toast.success(
        result.message || (editingRecord ? "Overtime request updated." : "Overtime request submitted successfully."),
        { id: submitToastId }
      );
      closeForm();
    } catch (error) {
      toast.error(
        error?.response?.data?.message
          || (editingRecord ? "Unable to update overtime request." : "Unable to submit overtime request."),
        { id: submitToastId }
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveRecord = async (record, restore = false) => {
    const confirmAction = restore ? confirmRestoreRecord : confirmArchiveRecord;

    await confirmAction({
      module: "overtime",
      id: record.id,
      noun: "overtime request",
      owner: record.employeeName,
      onArchived: () => loadRecords({ background: true }),
      onRestored: () => loadRecords({ background: true }),
    });
  };

  const handleStatusUpdate = async (record, nextStatus) => {
    const actionKey = String(nextStatus || "").toLowerCase();
    const isApprovalAction = actionKey === "approved" || actionKey === "reviewed";
    const actionTitles = {
      reviewed: "Approve Overtime Request?",
      approved: "Give Final Approval?",
      rejected: "Disapprove Overtime Request?",
      cancelled: "Cancel Overtime Request?",
    };
    const actionTexts = {
      reviewed: `Approve the overtime request for ${record.employeeName || "this employee"}? It then goes to the Regional Director for final approval.`,
      approved: `Give the final approval on the overtime request for ${record.employeeName || "this employee"}? The rendered overtime credits are posted to the employee.`,
      rejected: `Are you sure you want to disapprove the overtime request for ${record.employeeName || "this employee"}?`,
      cancelled: `Are you sure you want to cancel the overtime request for ${record.employeeName || "this employee"}?`,
    };
    const confirmText = {
      reviewed: "Approve",
      approved: "Approve",
      rejected: "Disapprove",
      cancelled: "Cancel Request",
    };
    const confirmation = await Swal.fire({
      title: actionTitles[actionKey] || "Update Overtime Request?",
      text: actionTexts[actionKey] || `Are you sure you want to update the overtime request for ${record.employeeName || "this employee"}?`,
      icon: isApprovalAction ? "success" : "warning",
      showCancelButton: true,
      confirmButtonText: confirmText[actionKey] || "Confirm",
      cancelButtonText: "Close",
      confirmButtonColor: isApprovalAction ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    /*
     * One sum covers whichever signature this turns out to be — Chief Admin approval or the Regional
     * Director giving the final approval — because overtime.php gates both the same way. What comes
     * back is the pair to send, not a verdict: the server is what judges the answer. A null is the
     * approver cancelling or no challenge being dealt, and either way nothing is sent.
     */
    let captcha = {};

    if (isApprovalAction) {
      captcha = await requestApprovalCaptcha({
        note: nextStatus === "Approved"
          ? "Answer the sum below to confirm this final overtime approval."
          : "Answer the sum below to confirm the Chief Admin's overtime approval.",
      });

      if (!captcha) {
        return;
      }
    }

    try {
      const result = await updateOvertimeStatus(record.id, nextStatus, captcha);
      setRecords((current) => current.map((item) => (item.id === record.id ? result.record : item)));
      const successMessage = result.message || `Overtime request ${nextStatus.toLowerCase()}.`;
      toast.success(successMessage);
      await Swal.fire({
        title: "Updated",
        text: successMessage,
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      const message = error?.response?.data?.message || "Unable to update overtime request.";
      toast.error(message);
      await Swal.fire({
        /* A refused security check leaves the request untouched, so it is not called an update failure. */
        title: isCaptchaFailure(error) ? "Security Check Failed" : "Update Failed",
        text: message,
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  const handleBulkApprove = async () => {
    if (bulkApprovableRecords.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    try {
      await confirmBulkApproval({
        records: bulkApprovableRecords,
        noun: "overtime request",
        getTarget: (record) => `overtime:${record.id}`,
        approveRecord: (record, captcha) => updateOvertimeStatus(
          record.id,
          record.status === "Reviewed" ? "Approved" : "Reviewed",
          captcha
        ),
        confirmationText: `Approve ${bulkApprovableRecords.length} selected overtime request${bulkApprovableRecords.length === 1 ? "" : "s"} at the workflow stage currently assigned to you?`,
        captchaNote: "Answer the sum below to confirm the selected overtime approvals.",
        progressText: "Approving selected overtime requests...",
        onComplete: async () => {
          selection.clearSelection();
          await loadRecords({ background: true });
        },
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkArchive = async () => {
    if (bulkArchivableRecords.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    try {
      await confirmArchiveRecords({
        records: bulkArchivableRecords,
        getModule: () => "overtime",
        noun: "overtime request",
        onArchived: async () => {
          selection.clearSelection();
          await loadRecords({ background: true });
        },
      });
    } finally {
      setBulkBusy(false);
    }
  };

  /* One definition of what a row can do, used by the table and by the narrow-screen cards. */
  const renderRecordActions = (record) => {
    if (archiveView) {
      return (
        <>
          <ActionIconButton
            label="View overtime request"
            icon={faEye}
            tone="view"
            onClick={() => setViewingRecord(record)}
          />
          <ActionIconButton
            label="Restore overtime request"
            icon={faRotateLeft}
            tone="restore"
            onClick={() => handleArchiveRecord(record, true)}
          />
        </>
      );
    }

    const recordStatus = record.status || "Pending";
    const isOpenRequest = openStatuses.includes(recordStatus);
    const isManualCredit = String(record.source || "request").toLowerCase() === "manual_coc";
    /* The Chief Admin signs at Pending and hands over; the Regional Director gives final approval. */
    const showReviewAction = canChiefAdminApprove && recordStatus === "Pending" && !isManualCredit;
    const showFinalApprovalAction = canGiveFinalApproval && recordStatus === "Reviewed";
    const showRejectAction = showReviewAction || showFinalApprovalAction;

    /*
     * One Accomplishment Report action per row, opening the memo in a floating window: the fill-in
     * memo while the employee still owes one, otherwise the filed memo -- with Note and Return on it
     * when it is waiting on this desk.
     */
    const owesReport = needsAccomplishmentReport(record, user);
    const hasReport = Boolean(record.accomplishmentReport);
    const reportLabel = owesReport
      ? hasReport ? "Revise accomplishment report" : "Submit accomplishment report"
      : "View accomplishment report";

    return (
      <>
        <ActionIconButton
          label="View overtime request"
          icon={faEye}
          tone="view"
          onClick={() => setViewingRecord(record)}
        />
        {owesReport || hasReport ? (
          <ActionIconButton
            label={reportLabel}
            icon={faFileLines}
            tone={owesReport || reportAwaitsNote(record, user, canNoteReports) ? "review" : "view"}
            text="Accomplishment Report"
            onClick={() => (owesReport ? openReportForm(record) : openReportPreviewForRecord(record))}
          />
        ) : null}
        {canEditRequests && recordStatus === "Pending" && !isManualCredit ? (
          <ActionIconButton
            label="Edit overtime request"
            icon={faPenToSquare}
            tone="edit"
            onClick={() => openEditForm(record)}
          />
        ) : null}
        {showReviewAction || showFinalApprovalAction ? (
          <ActionIconButton
            label={showFinalApprovalAction ? "Give final approval on overtime request" : "Approve overtime request"}
            icon={faCheck}
            tone="approve"
            onClick={() => handleStatusUpdate(record, showFinalApprovalAction ? "Approved" : "Reviewed")}
          />
        ) : null}
        {showRejectAction ? (
          <ActionIconButton
            label="Disapprove overtime request"
            icon={faXmark}
            tone="reject"
            text="Disapprove"
            onClick={() => handleStatusUpdate(record, "Rejected")}
          />
        ) : null}
        {canCancelRequests && isOpenRequest && !isManualCredit ? (
          <ActionIconButton
            label="Cancel overtime request"
            icon={faBan}
            tone="cancel"
            onClick={() => handleStatusUpdate(record, "Cancelled")}
          />
        ) : null}
        {canArchiveRecord(record) ? (
          <ActionIconButton
            label="Archive overtime request"
            icon={faBoxArchive}
            tone="archive"
            onClick={() => handleArchiveRecord(record)}
          />
        ) : null}
      </>
    );
  };

  return (
    <section className="w-full space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">
              {archiveView ? "Archived Overtime Requests" : title}
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {archiveView
                ? "Overtime requests moved to archive. Restore one to put it back in the list."
                : description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canArchive ? (
              <ArchiveViewToggle
                archiveView={archiveView}
                onToggle={(next) => {
                  selection.clearSelection();
                  setArchiveView(next);
                  setStatus(next ? "" : defaultStatus);
                  setCurrentPage(1);
                }}
                label="overtime requests"
              />
            ) : null}
            {archiveView ? null : (
              <button
                type="button"
                onClick={openForm}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <FilePenLine size={16} />
                {submitLabel}
              </button>
            )}
          </div>
        </div>

        {!archiveView ? (
          <BulkSelectionToolbar
            selectedCount={selection.selectedCount}
            approveCount={bulkApprovableRecords.length}
            archiveCount={bulkArchivableRecords.length}
            busy={bulkBusy}
            onApprove={handleBulkApprove}
            onArchive={handleBulkArchive}
            onClear={selection.clearSelection}
          />
        ) : null}

        <div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_120px]">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Overtime Requests</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search employee, division, reason"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">All statuses</option>
                {overtimeStatuses.map((item) => (
                  <option key={item} value={item}>{item === "Rejected" ? "Disapproved" : item}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Work Date</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Rows Per Page</span>
              <select
                value={rowsPerPage}
                onChange={(event) => setRowsPerPage(event.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="10">10 rows</option>
                <option value="20">20 rows</option>
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
                <option value="200">200 rows</option>
              </select>
            </label>
          </div>

          {/* Cards below `lg`, table from `lg` up — see the note in `RecordCards`. */}
          <RecordCards
            className="mt-4 lg:hidden"
            items={paginatedRecords}
            loading={loading}
            loadingCards={3}
            empty={{
              icon: Filter,
              title: "No overtime requests found",
              description: "File a request or adjust the filters.",
            }}
            renderCard={(record) => ({
              title: record.employeeName,
              subtitle: `${record.workDate || record.overtimeDate || "No date"} - ${formatAmount(record.hourRequested ?? record.hoursWorked)} hrs`,
              badge: <LeaveStatusBadge status={record.status || "Pending"} simplified labelOverride={getOvertimeStatusLabel(record)} />,
              selection: !archiveView && (canArchiveRecord(record) || canBulkApproveRecord(record)) ? (
                <SelectionCheckbox
                  checked={selection.isSelected(record)}
                  onChange={() => selection.toggleRow(record)}
                  label={`Select ${record.employeeName || "overtime request"}`}
                />
              ) : null,
              fields: [
                { label: "Division", value: formatRecordDivision(record) },
                ...(formatOvertimeWindow(record) ? [{ label: "Time", value: formatOvertimeWindow(record) }] : []),
                { label: "Request Date", value: formatRequestDate(record) },
                { label: "Reason", value: record.reason || "No reason provided", full: true },
                ...(record.accomplishmentReport
                  ? [{ label: "Accomplishment Report", value: formatAccomplishmentStatusLabel(record.accomplishmentReport), full: true }]
                  : []),
              ],
              actions: <ActionsMenu>{renderRecordActions(record)}</ActionsMenu>,
            })}
          />

          <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-3 text-left">
                      {!archiveView && selectablePageRecords.length > 0 ? (
                        <SelectionCheckbox
                          checked={selection.areAllSelected(selectablePageRecords)}
                          indeterminate={selection.areSomeSelected(selectablePageRecords) && !selection.areAllSelected(selectablePageRecords)}
                          onChange={() => selection.toggleRows(selectablePageRecords)}
                          label="Select all overtime requests on this page"
                        />
                      ) : null}
                    </th>
                    {["Employee", "Division", "Work Date", "Hours", "Reason", "Request Date", "Status", "Actions"].map((header) => (
                      <th key={header} className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="animate-pulse border-b border-slate-100">
                        <td colSpan={9} className="px-3 py-3">
                          <div className="h-5 rounded bg-slate-200" />
                        </td>
                      </tr>
                    ))
                  ) : filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center">
                        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                          <Filter size={20} />
                        </div>
                        <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No overtime requests found</p>
                        <p className="m-0 mt-1 text-sm text-slate-500">File a request or adjust the filters.</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedRecords.map((record) => (
                      <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3">
                          {!archiveView && (canArchiveRecord(record) || canBulkApproveRecord(record)) ? (
                            <SelectionCheckbox
                              checked={selection.isSelected(record)}
                              onChange={() => selection.toggleRow(record)}
                              label={`Select ${record.employeeName || "overtime request"}`}
                            />
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <div className="font-semibold text-slate-900">{record.employeeName}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatRecordDivision(record)}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">
                          <div>{record.workDate || record.overtimeDate || "No date"}</div>
                          {formatOvertimeWindow(record) ? (
                            <div className="whitespace-nowrap text-xs text-slate-500">{formatOvertimeWindow(record)}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatAmount(record.hourRequested ?? record.hoursWorked)}</td>
                        <td className="whitespace-pre-line px-3 py-3 text-sm text-slate-600">{record.reason || "No reason provided"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatRequestDate(record)}</td>
                        <td className="px-3 py-3">
                          <LeaveStatusBadge status={record.status || "Pending"} simplified labelOverride={getOvertimeStatusLabel(record)} />
                          {record.accomplishmentReport ? (
                            <p className="m-0 mt-1 whitespace-nowrap text-[11px] text-slate-500">
                              Report: {formatAccomplishmentStatusLabel(record.accomplishmentReport)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <ActionsMenu>{renderRecordActions(record)}</ActionsMenu>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
              {" "}to {Math.min(safePage * pageSize, filteredRecords.length)} of {filteredRecords.length} overtime requests
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </div>
      </section>

      <Modal
        open={modalOpen}
        title={editingRecord ? "Edit Overtime Request" : submitLabel}
        maxWidth="max-w-[760px]"
        onClose={closeForm}
        footer={
          <>
            <Button type="submit" form="overtimeForm" icon={Clock3} loading={saving}>
              {editingRecord ? "Save Changes" : "Submit"}
            </Button>
          </>
        }
      >
        <form id="overtimeForm" className="grid gap-4" onSubmit={submitOvertime}>
          {editingRecord ? (
            <InputField
              label="Employee"
              name="employeeName"
              value={form.employeeName}
              onChange={() => {}}
              readOnly
            />
          ) : useEmployeeChecklist ? (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Employees
              </label>
              <EmployeeSearchSelect
                multiple
                employeeOptions={employeeOptions}
                selectedEmployees={selectedEmployees}
                onSelect={handleToggleEmployee}
                onClear={handleClearEmployees}
                placeholder="Search and select employees..."
              />
              <p className="m-0 mt-1 text-xs text-slate-500">
                Tick the checkbox of every employee covered by this overtime. A separate request is filed for each one.
              </p>
              {formErrors.employeeRecordIds ? (
                <p className="m-0 mt-1 text-sm text-rose-700">{formErrors.employeeRecordIds}</p>
              ) : null}
            </div>
          ) : canSelectEmployee ? (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Employee
              </label>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={selectedEmployee}
                onSelect={handleEmployeeSelect}
                placeholder="Search employee..."
                disabled={employeeOptions.length === 0}
              />
            </div>
          ) : (
            <InputField
              label="Employee"
              name="employeeName"
              value={form.employeeName}
              onChange={updateForm("employeeName")}
              placeholder="Employee name"
              readOnly={roleKey === "employee"}
              required
            />
          )}

          <InputField
            label="Work Date"
            name="workDate"
            type="date"
            value={form.workDate}
            min={todayDateInputValue()}
            onChange={updateForm("workDate")}
            error={formErrors.workDate}
            required
          />
          <div>
            <div className="grid gap-4 sm:grid-cols-3">
              <InputField
                label="Time Start"
                name="timeStart"
                type="time"
                value={form.timeStart}
                onChange={updateForm("timeStart")}
                required
              />
              <InputField
                label="Time End"
                name="timeEnd"
                type="time"
                value={form.timeEnd}
                onChange={updateForm("timeEnd")}
                required
              />
              <InputField
                label="Hours Requested"
                name="hourRequested"
                value={plannedMinutes === null ? "" : `${formatAmount(plannedMinutes / 60)} hrs`}
                onChange={() => {}}
                placeholder="Counted from the time"
                readOnly
              />
            </div>
            {formErrors.time ? (
              <p className="m-0 mt-1.5 text-sm text-rose-700">{formErrors.time}</p>
            ) : null}
          </div>

          <InputField
            label="Location"
            name="location"
            value={form.location}
            onChange={updateForm("location")}
            placeholder={DEFAULT_ACCOMPLISHMENT_LOCATION}
            maxLength={120}
          />

          <div data-validation-field>
            <label htmlFor="overtimeReason" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Tasks to Perform
            </label>
            <textarea
              id="overtimeReason"
              name="reason"
              rows={3}
              value={form.reason}
              onChange={updateForm("reason")}
              placeholder={"One task per line, e.g.\nWeb development on the MGBX Portal — DTR and biometrics attendance"}
              aria-invalid={Boolean(formErrors.reason)}
              className={`${textAreaClassName} ${formErrors.reason ? "border-rose-600" : "border-slate-200"}`}
              required
            />
            {formErrors.reason ? (
              <p className="m-0 mt-1.5 text-sm text-rose-700">{formErrors.reason}</p>
            ) : null}
          </div>

          <div data-validation-field>
            <label htmlFor="overtimeExpectedOutputs" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Expected Output/s
            </label>
            <textarea
              id="overtimeExpectedOutputs"
              name="expectedOutputs"
              rows={2}
              value={form.expectedOutputs}
              onChange={updateForm("expectedOutputs")}
              placeholder="What the overtime will produce, e.g. Functional attendance and payroll features added to the MGBX Portal"
              aria-invalid={Boolean(formErrors.expectedOutputs)}
              className={`${textAreaClassName} ${formErrors.expectedOutputs ? "border-rose-600" : "border-slate-200"}`}
              required
            />
            {formErrors.expectedOutputs ? (
              <p className="m-0 mt-1.5 text-sm text-rose-700">{formErrors.expectedOutputs}</p>
            ) : null}
          </div>

          <p className="m-0 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-xs text-teal-900">
            These details become the Accomplishment Report memo. Once the overtime is approved and
            rendered, the employee only reviews it and submits it to the Division Chief. The memo cannot
            be edited there, so enter the details here as they should appear on it.
          </p>
        </form>
      </Modal>

      <Modal
        open={Boolean(viewingRecord)}
        title="Overtime Request"
        maxWidth="max-w-[640px]"
        onClose={() => setViewingRecord(null)}
        footer={<Button variant="secondary" onClick={() => setViewingRecord(null)}>Close</Button>}
      >
        {viewingRecord ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Employee</p>
              <p className="m-0 mt-1 text-slate-900">{viewingRecord.employeeName || "N/A"}</p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Division</p>
              <p className="m-0 mt-1 text-slate-900">{viewingRecord.division || "Unassigned"}</p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Work Date</p>
              <p className="m-0 mt-1 text-slate-900">{viewingRecord.workDate || viewingRecord.overtimeDate || "N/A"}</p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Request Date</p>
              <p className="m-0 mt-1 text-slate-900">{formatRequestDate(viewingRecord)}</p>
            </div>
            {formatOvertimeWindow(viewingRecord) ? (
              <>
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-500">Time</p>
                  <p className="m-0 mt-1 text-slate-900">{formatOvertimeWindow(viewingRecord)}</p>
                </div>
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-500">Location</p>
                  <p className="m-0 mt-1 text-slate-900">{viewingRecord.location || DEFAULT_ACCOMPLISHMENT_LOCATION}</p>
                </div>
              </>
            ) : null}
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Hours</p>
              <p className="m-0 mt-1 text-slate-900">{formatAmount(viewingRecord.hourRequested ?? viewingRecord.hoursWorked)}</p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Status</p>
              <p className="m-0 mt-1">
                <LeaveStatusBadge status={viewingRecord.status || "Pending"} labelOverride={getOvertimeStatusLabel(viewingRecord)} />
              </p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Approved By (Chief Admin)</p>
              <p className="m-0 mt-1 text-slate-900">{viewingRecord.reviewedBy || "Not yet approved"}</p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Approved By (Regional Director)</p>
              <p className="m-0 mt-1 text-slate-900">{viewingRecord.approvedBy || "Not yet approved"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="m-0 text-sm font-semibold text-slate-500">Reason</p>
              <p className="m-0 mt-1 whitespace-pre-wrap text-slate-900">{viewingRecord.reason || "No reason provided"}</p>
            </div>
            {viewingRecord.expectedOutputs ? (
              <div className="sm:col-span-2">
                <p className="m-0 text-sm font-semibold text-slate-500">Expected Output/s</p>
                <p className="m-0 mt-1 whitespace-pre-wrap text-slate-900">{viewingRecord.expectedOutputs}</p>
              </div>
            ) : null}
            {(viewingRecord.status || "Pending") === "Approved" ? (
              <div className="sm:col-span-2">
                <p className="m-0 text-sm font-semibold text-slate-500">Accomplishment Report</p>
                <p className="m-0 mt-1 text-slate-900">
                  {viewingRecord.accomplishmentReport
                    ? formatAccomplishmentStatusLabel(viewingRecord.accomplishmentReport)
                    : "Not yet submitted"}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <AccomplishmentReportFormModal
        open={Boolean(reportTarget)}
        overtime={reportTarget?.overtime || null}
        previousReport={reportTarget?.previousReport || null}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => loadRecords({ background: true })}
      />

      <AccomplishmentReportPreviewModal
        report={viewingReport}
        canDecide={canNoteReports && Boolean(viewingReport) && !matchesUserRecordScope(viewingReport, user)}
        busy={reportBusy}
        onClose={() => setViewingReport(null)}
        onNote={handleNoteReport}
        onReturn={handleReturnReport}
      />
    </section>
  );
}
