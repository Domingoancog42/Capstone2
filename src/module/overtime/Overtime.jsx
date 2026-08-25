import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, FilePenLine, Filter, Search } from "lucide-react";
import {
  faBan,
  faBoxArchive,
  faCheck,
  faEye,
  faPenToSquare,
  faRotateLeft,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import LeaveStatusBadge from "../../components/leave/LeaveStatusBadge";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchOvertimeRequests,
  fileOvertimeRequest,
  updateOvertimeRequest,
  updateOvertimeStatus,
} from "../../services/overtimeService";
import { countPendingRecords, isPastDate, resolveRoleKey, todayDateInputValue } from "../../utils/leaveHelpers";
import { requestApprovalCaptcha, isCaptchaFailure } from "../../utils/approvalCaptcha";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";

const overtimeStatuses = ["Pending", "Reviewed", "Approved", "Rejected", "Cancelled"];

/* The two stages a filing can still be acted on. Anything else is already settled. */
const openStatuses = ["Pending", "Reviewed"];

const initialForm = {
  employeeRecordId: "",
  employeeRecordIds: [],
  employeeName: "",
  workDate: "",
  hourRequested: "",
  reason: "",
};

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

export default function OvertimeWorkspace({
  user,
  employees = [],
  title = "Overtime Management",
  description = "File, review, and monitor overtime requests.",
  submitLabel = "File Overtime Request",
  showEmployeeFilter = true,
  onPendingCountChange,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const roleKey = resolveRoleKey(user);
  const canManage = ["admin", "hrhead", "hrstaff", "regionaldirector", "chief", "planningofficer"].includes(roleKey);
  /*
   * Two desks sign an overtime filing. HR reviews it first, the Regional Director gives the final
   * approval, and only that last signature turns the hours into compensatory overtime credits. The
   * chief who filed it signs nothing — they may correct the filing or withdraw it, nothing more.
   * A planning officer files from the same division desk and signs nothing either, which is why
   * both roles answer this test (overtime_is_chief() in overtime.php is the server-side twin).
   */
  const isChief = ["chief", "planningofficer"].includes(roleKey);
  const canReview = ["admin", "hrhead", "hrstaff"].includes(roleKey);
  const canGiveFinalApproval = ["admin", "regionaldirector"].includes(roleKey);
  const canEditRequests = ["admin", "hrhead", "hrstaff", "chief", "planningofficer"].includes(roleKey);
  /*
   * The two desks that sign a filing are not offered the Cancel action. An HR Head or a Regional
   * Director acts on an overtime request by ruling on it — approve or reject, both of which say
   * what was decided and are recorded against their name. Cancelling says neither, so it stays with
   * the desks whose job is the filing itself: the chief or planning officer who raised it, HR staff
   * maintaining it, and the employee withdrawing their own.
   */
  const canCancelRequests = canManage && !["hrhead", "regionaldirector"].includes(roleKey);
  const canArchive = canArchiveModule(roleKey, "overtime") && !isChief;
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
  const useEmployeeChecklist = canSelectEmployee && (isChief || roleKey === "hrhead");
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
      const result = await fetchOvertimeRequests({ archived: archiveView, source: "request" });
      setRecords(result.records || []);
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
      const matchesStatus = !status || record.status === status;
      const matchesDate = !date || record.workDate === date || record.overtimeDate === date;

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [date, query, records, status]);
  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * pageSize;
    return filteredRecords.slice(startIndex, startIndex + pageSize);
  }, [filteredRecords, pageSize, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [date, query, rowsPerPage, status]);

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
      hourRequested: String(record.hourRequested ?? record.hoursWorked ?? ""),
      reason: record.reason || "",
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
    setFormErrors((current) => ({ ...current, [field]: "" }));
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

    /*
     * The `min` on the input stops the calendar offering earlier days, but a typed or pasted value
     * still gets here, so the rule is enforced again rather than trusted. Applies to every role,
     * admin included -- overtime is authorized before it is rendered, never filed after the fact.
     */
    if (form.workDate && isPastDate(form.workDate)) {
      setFormErrors({ workDate: "Work date cannot be in the past. Choose today or a later date." });
      return;
    }

    if (!editingRecord && useEmployeeChecklist && form.employeeRecordIds.length === 0) {
      setFormErrors({ employeeRecordIds: "Select at least one employee." });
      return;
    }

    setFormErrors({});
    setSaving(true);
    const submitToastId = toast.loading(
      editingRecord ? "Saving overtime request..." : "Submitting overtime request..."
    );

    try {
      const result = editingRecord
        ? await updateOvertimeRequest(editingRecord.id, {
          workDate: form.workDate,
          hourRequested: form.hourRequested,
          reason: form.reason,
        })
        : await fileOvertimeRequest({
          employeeRecordId: form.employeeRecordId,
          employeeRecordIds: useEmployeeChecklist ? form.employeeRecordIds : undefined,
          employeeName: form.employeeName,
          workDate: form.workDate,
          hourRequested: form.hourRequested,
          requestDate: formatLocalSqlDateTime(new Date()),
          reason: form.reason,
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
        setStatus("");
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
      rejected: "Reject Overtime Request?",
      cancelled: "Cancel Overtime Request?",
    };
    const actionTexts = {
      reviewed: `Approve the overtime request for ${record.employeeName || "this employee"}? It then goes to the Regional Director for final approval.`,
      approved: `Give the final approval on the overtime request for ${record.employeeName || "this employee"}? The rendered overtime credits are posted to the employee.`,
      rejected: `Are you sure you want to reject the overtime request for ${record.employeeName || "this employee"}?`,
      cancelled: `Are you sure you want to cancel the overtime request for ${record.employeeName || "this employee"}?`,
    };
    const confirmText = {
      reviewed: "Approve",
      approved: "Approve",
      rejected: "Reject",
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
     * One sum covers whichever signature this turns out to be — HR reviewing or the Regional
     * Director giving the final approval — because overtime.php gates both the same way. What comes
     * back is the pair to send, not a verdict: the server is what judges the answer. A null is the
     * approver cancelling or no challenge being dealt, and either way nothing is sent.
     */
    let captcha = {};

    if (isApprovalAction) {
      captcha = await requestApprovalCaptcha({
        note: nextStatus === "Approved"
          ? "Answer the sum below to confirm this final overtime approval."
          : "Answer the sum below to confirm this overtime review.",
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
    /* HR signs at Pending and hands over; the Regional Director signs what HR has reviewed. */
    const showReviewAction = canReview && recordStatus === "Pending" && !isManualCredit;
    const showFinalApprovalAction = canGiveFinalApproval && recordStatus === "Reviewed";
    const showRejectAction = showReviewAction || showFinalApprovalAction;

    return (
      <>
        <ActionIconButton
          label="View overtime request"
          icon={faEye}
          tone="view"
          onClick={() => setViewingRecord(record)}
        />
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
            label="Reject overtime request"
            icon={faXmark}
            tone="reject"
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
        {canArchive ? (
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
                  setArchiveView(next);
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

        <div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_120px]">
            <label className="relative">
              <span className="sr-only">Search overtime requests</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee, division, reason"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              {overtimeStatuses.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
            <select
              value={rowsPerPage}
              onChange={(event) => setRowsPerPage(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="5">5 rows</option>
              <option value="10">10 rows</option>
              <option value="20">20 rows</option>
            </select>
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
            renderCard={(record, index) => ({
              eyebrow: `#${(safePage - 1) * pageSize + index + 1}`,
              title: record.employeeName,
              subtitle: `${record.workDate || record.overtimeDate || "No date"} - ${formatAmount(record.hourRequested ?? record.hoursWorked)} hrs`,
              badge: <LeaveStatusBadge status={record.status || "Pending"} roleKey={roleKey} />,
              fields: [
                { label: "Division", value: record.division || "Unassigned" },
                { label: "Request Date", value: formatRequestDate(record) },
                { label: "Reason", value: record.reason || "No reason provided", full: true },
              ],
              actions: renderRecordActions(record),
            })}
          />

          <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    {["#", "Employee", "Division", "Work Date", "Hours", "Reason", "Request Date", "Status", "Actions"].map((header) => (
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
                    paginatedRecords.map((record, index) => (
                      <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                          {(safePage - 1) * pageSize + index + 1}
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <div className="font-semibold text-slate-900">{record.employeeName}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.division || "Unassigned"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.workDate || record.overtimeDate || "No date"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatAmount(record.hourRequested ?? record.hoursWorked)}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.reason || "No reason provided"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatRequestDate(record)}</td>
                        <td className="px-3 py-3"><LeaveStatusBadge status={record.status || "Pending"} roleKey={roleKey} /></td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">{renderRecordActions(record)}</div>
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
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
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
          <InputField
            label="Hours Requested"
            name="hourRequested"
            type="number"
            min="0.25"
            step="0.25"
            value={form.hourRequested}
            onChange={updateForm("hourRequested")}
            placeholder="Enter requested overtime hours"
            required
          />
          <InputField
            label="Reason"
            name="reason"
            value={form.reason}
            onChange={updateForm("reason")}
            placeholder="Describe why overtime is needed..."
            required
          />
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
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Hours</p>
              <p className="m-0 mt-1 text-slate-900">{formatAmount(viewingRecord.hourRequested ?? viewingRecord.hoursWorked)}</p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Status</p>
              <p className="m-0 mt-1">
                <LeaveStatusBadge status={viewingRecord.status || "Pending"} roleKey={roleKey} />
              </p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Reviewed By (HR)</p>
              <p className="m-0 mt-1 text-slate-900">{viewingRecord.reviewedBy || "Not yet reviewed"}</p>
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">Approved By (Regional Director)</p>
              <p className="m-0 mt-1 text-slate-900">{viewingRecord.approvedBy || "Not yet approved"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="m-0 text-sm font-semibold text-slate-500">Reason</p>
              <p className="m-0 mt-1 whitespace-pre-wrap text-slate-900">{viewingRecord.reason || "No reason provided"}</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
