import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Filter, Plus, Search } from "lucide-react";
import { faBan, faCheck, faEye, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Pagination from "../../components/UI/Pagination";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import LeaveStatusBadge, { getLeaveStatusDisplayLabel } from "../../components/leave/LeaveStatusBadge";
import LeaveMonetizationFormModal from "../../components/payroll/LeaveMonetizationForm";
import { LEAVE_STATUSES } from "../../data/leaveTypes";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchLeaveMonetizationRequests,
  fetchMonetizableLeaveCredits,
  fileLeaveMonetizationRequest,
  updateLeaveMonetizationStatus,
} from "../../services/leaveMonetizationService";
import {
  canManageLeave,
  formatDateDisplay,
  matchesUserRecordScope,
  normalizeLeaveStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { requestApprovalCaptcha } from "../../utils/approvalCaptcha";
import { currencyFormatter } from "../../utils/format";

const defaultFilterState = {
  search: "",
  status: "",
  date: "",
  rowsPerPage: "10",
};

const tableHeaders = [
  "#",
  "Employee",
  "Division",
  "Leave Credit",
  "Days",
  "Daily Rate",
  "Monetized Amount",
  "Status",
  "Date Filed",
  "Actions",
];

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm() {
  return {
    employeeRecordId: "",
    leaveTypeCode: "VL",
    numberOfDays: "",
    dateFiled: todayInputValue(),
    reason: "",
  };
}

function buildEmployeeOptions(employees = []) {
  return employees
    .map((employee) => ({
      employeeRecordId: employee.id || employee.employeeRecordId || "",
      employeeId: employee.employeeId || employee.employee_id || "",
      employeeName: employee.fullName || employee.employeeName || employee.full_name || "",
      division: employee.department || employee.division || "",
    }))
    .filter((employee) => employee.employeeRecordId && employee.employeeName);
}

function formatDays(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(2);
}

function normalizeDateFilterValue(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  const isoDateMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) {
    return isoDateMatch[1];
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsedDate);
}

export default function LeaveMonetizationWorkspace({ employees = [], user }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState(defaultFilterState);
  const [currentPage, setCurrentPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm());
  const [creditSummary, setCreditSummary] = useState(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);

  const roleKey = resolveRoleKey(user);
  const isHrHead = roleKey === "hrhead";
  const isRegionalDirector = roleKey === "regionaldirector";
  const canManage = canManageLeave(user);
  const canSelectEmployee = ["admin", "hrhead", "hrstaff"].includes(roleKey);
  const employeeOptions = useMemo(() => buildEmployeeOptions(employees), [employees]);
  const selectedEmployee = useMemo(
    () => employeeOptions.find(
      (employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)
    ) || null,
    [employeeOptions, form.employeeRecordId]
  );

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const result = await fetchLeaveMonetizationRequests();
      setRecords(Array.isArray(result?.records) ? result.records : []);
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load leave monetization requests.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadRecords, { topics: ["leave_monetization", "leave_credit"] });

  const loadCredits = useCallback(async (employeeRecordId) => {
    setCreditsLoading(true);

    try {
      const result = await fetchMonetizableLeaveCredits(employeeRecordId || null);
      setCreditSummary(result || null);
      return result;
    } catch (error) {
      setCreditSummary(null);
      toast.error(error?.response?.data?.message || "Unable to load monetizable leave credits.");
      return null;
    } finally {
      setCreditsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!formOpen) {
      return;
    }

    if (canSelectEmployee && !form.employeeRecordId) {
      setCreditSummary(null);
      return;
    }

    void loadCredits(form.employeeRecordId);
  }, [canSelectEmployee, form.employeeRecordId, formOpen, loadCredits]);

  const creditOptions = useMemo(
    () => (Array.isArray(creditSummary?.options) ? creditSummary.options : []),
    [creditSummary]
  );
  const selectedCreditOption = useMemo(
    () => creditOptions.find((option) => option.code === form.leaveTypeCode) || null,
    [creditOptions, form.leaveTypeCode]
  );
  const dailyRate = Number(creditSummary?.dailyRate || 0);
  const requestedDays = Number(form.numberOfDays || 0);
  const estimatedAmount = requestedDays > 0 ? dailyRate * requestedDays : 0;

  const filteredRecords = useMemo(() => {
    const searchValue = filters.search.trim().toLowerCase();
    const dateFilterValue = normalizeDateFilterValue(filters.date);

    return records.filter((record) => {
      const matchesSearch = !searchValue || [
        record.employeeName,
        record.employeeId,
        record.division,
        record.leaveType,
        record.reason,
        record.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchValue));
      const matchesStatus = !filters.status || normalizeLeaveStatus(record.status) === filters.status;
      const matchesDate = !dateFilterValue || normalizeDateFilterValue(record.dateFiled) === dateFilterValue;

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [filters.date, filters.search, filters.status, records]);

  const rowsPerPage = Number(filters.rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * rowsPerPage;
    return filteredRecords.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredRecords, rowsPerPage, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.status, filters.date, filters.rowsPerPage]);

  const handleFilterChange = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const openForm = () => {
    setForm(emptyForm());
    setCreditSummary(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) {
      return;
    }

    setFormOpen(false);
    setForm(emptyForm());
    setCreditSummary(null);
  };

  const updateForm = (field) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (canSelectEmployee && !form.employeeRecordId) {
      toast.error("Select an employee first.");
      return;
    }

    if (!selectedCreditOption) {
      toast.error("Select the leave credit to monetize.");
      return;
    }

    if (requestedDays <= 0) {
      toast.error("Enter the number of leave credits to monetize.");
      return;
    }

    if (requestedDays > Number(selectedCreditOption.available || 0)) {
      toast.error(
        `Only ${formatDays(selectedCreditOption.available)} ${selectedCreditOption.leaveType} credit(s) can still be monetized.`
      );
      return;
    }

    setSaving(true);
    const toastId = toast.loading("Submitting leave monetization request...");

    try {
      const result = await fileLeaveMonetizationRequest({
        employeeRecordId: form.employeeRecordId || undefined,
        leaveTypeCode: form.leaveTypeCode,
        numberOfDays: requestedDays,
        dateFiled: form.dateFiled,
        reason: form.reason.trim(),
      });

      if (result?.record) {
        setRecords((current) => [result.record, ...current]);
      } else {
        await loadRecords();
      }

      toast.success(result?.message || "Leave monetization request submitted.", { id: toastId });
      closeForm();
    } catch (error) {
      toast.error(
        error?.response?.data?.message || "Unable to submit leave monetization request.",
        { id: toastId }
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (actionType, record) => {
    if (actionType === "view") {
      setSelectedRecord(record);
      return;
    }

    const isOwnRecord = matchesUserRecordScope(record, user);

    if (isOwnRecord && actionType !== "cancel") {
      toast.error("You cannot act on your own leave monetization request.");
      return;
    }

    const status = normalizeLeaveStatus(record.status);

    if (actionType === "approve" && isRegionalDirector && status !== "Reviewed") {
      toast.error("Regional Director can only give final approval after HR Head review.");
      return;
    }

    if ((actionType === "reject" || actionType === "cancel") && isRegionalDirector && !isOwnRecord && status !== "Reviewed") {
      toast.error("Regional Director can only act on requests after HR Head review.");
      return;
    }

    const statusMap = {
      markReviewed: "Reviewed",
      approve: "Approved",
      reject: "Rejected",
      cancel: "Cancelled",
    };
    const nextStatus = statusMap[actionType];

    if (!nextStatus) {
      return;
    }

    const titleMap = {
      markReviewed: "Approve Leave Monetization?",
      approve: isRegionalDirector ? "Final Approve Leave Monetization?" : "Approve Leave Monetization?",
      reject: "Reject Leave Monetization?",
      cancel: "Cancel Leave Monetization?",
    };
    const confirmButtonMap = {
      markReviewed: "Yes, approve",
      approve: isRegionalDirector ? "Yes, final approve" : "Yes, approve",
      reject: "Yes, reject",
      cancel: "Yes, cancel",
    };
    const isRejectAction = actionType === "reject";

    const confirmation = await Swal.fire({
      title: titleMap[actionType],
      text: `${formatDays(record.numberOfDays)} day(s) of ${record.leaveType || "leave"} credits for ${record.employeeName || "the employee"}.`,
      icon: actionType === "reject" || actionType === "cancel" ? "warning" : "success",
      input: isRejectAction ? "textarea" : undefined,
      inputLabel: isRejectAction ? "Rejected note" : undefined,
      inputPlaceholder: isRejectAction ? "Explain why this monetization is being rejected." : undefined,
      inputValidator: isRejectAction
        ? (value) => (!String(value || "").trim() ? "Rejected note is required." : undefined)
        : undefined,
      showCancelButton: true,
      confirmButtonText: confirmButtonMap[actionType],
      cancelButtonText: "No, keep it",
      confirmButtonColor: actionType === "reject" || actionType === "cancel" ? "#dc2626" : "#0f766e",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const rejectedNote = isRejectAction ? String(confirmation.value || "").trim() : "";

    if (actionType === "markReviewed" || actionType === "approve") {
      const captchaConfirmed = await requestApprovalCaptcha({
        text: "Solve the captcha before this leave monetization approval is completed.",
        confirmButtonText: "Verify and approve",
      });

      if (!captchaConfirmed) {
        return;
      }
    }

    try {
      Swal.fire({
        title: "Updating...",
        text: "Please wait while the leave monetization request is updated.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await updateLeaveMonetizationStatus(record.id, nextStatus, rejectedNote);

      setRecords((current) =>
        current.map((item) => (String(item.id) === String(result.record?.id) ? result.record : item))
      );

      await Swal.fire({
        title: "Updated",
        text: result?.message || `Leave monetization request ${nextStatus.toLowerCase()}.`,
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      await Swal.fire({
        title: "Update failed",
        text: error?.response?.data?.message || "Unable to update the leave monetization request.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  return (
    <section className="w-full space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">Leave Monetization</h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              File monetization of unused leave credits. HR Head reviews the request and the Regional Director
              gives the final approval, following the leave management approval flow.
            </p>
          </div>
          <Button icon={Plus} onClick={openForm}>
            File Leave Monetization
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.3fr_180px_180px_140px]">
          <label className="relative">
            <span className="sr-only">Search leave monetization requests</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={filters.search}
              onChange={(event) => handleFilterChange("search", event.target.value)}
              placeholder="Search employee, leave credit, purpose"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>

          <label>
            <span className="sr-only">Status</span>
            <select
              value={filters.status}
              onChange={(event) => handleFilterChange("status", event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              {LEAVE_STATUSES.map((status) => (
                <option key={status} value={status}>{getLeaveStatusDisplayLabel(status, roleKey)}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="sr-only">Filter by date filed</span>
            <input
              type="date"
              value={filters.date}
              onChange={(event) => handleFilterChange("date", event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>

          <label>
            <span className="sr-only">Rows per page</span>
            <select
              value={filters.rowsPerPage}
              onChange={(event) => handleFilterChange("rowsPerPage", event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="5">5 rows</option>
              <option value="10">10 rows</option>
              <option value="20">20 rows</option>
              <option value="25">25 rows</option>
            </select>
          </label>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-[1280px] w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {tableHeaders.map((header) => (
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
                      <td colSpan={tableHeaders.length} className="px-3 py-3">
                        <div className="h-5 rounded bg-slate-200" />
                      </td>
                    </tr>
                  ))
                ) : paginatedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={tableHeaders.length} className="px-4 py-12 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                        <Filter size={20} />
                      </div>
                      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No leave monetization requests found</p>
                      <p className="m-0 mt-1 text-sm text-slate-500">File a request or adjust the filters.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((record, index) => {
                    const status = normalizeLeaveStatus(record.status);
                    const isOwnRecord = matchesUserRecordScope(record, user);
                    const allowRowManagement = canManage && !isOwnRecord;
                    const showReviewAction = allowRowManagement && isHrHead && status === "Pending";
                    const showApproveAction = allowRowManagement && (
                      (isRegionalDirector && status === "Reviewed")
                      || (!isHrHead && !isRegionalDirector && (status === "Pending" || status === "Reviewed"))
                    );
                    const showRejectAction = allowRowManagement && (
                      (isHrHead && status === "Pending")
                      || (isRegionalDirector && status === "Reviewed")
                      || (!isHrHead && !isRegionalDirector && (status === "Pending" || status === "Reviewed"))
                    );
                    const showOwnCancelAction = isOwnRecord && status === "Pending";

                    return (
                      <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                          {(safePage - 1) * rowsPerPage + index + 1}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-800">
                          <div className="font-semibold text-slate-900">{record.employeeName || "Unknown employee"}</div>
                          <div className="text-xs text-slate-500">{record.position || "No position"}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.division || "Unassigned"}</td>
                        <td className="px-3 py-3 text-sm text-slate-700">{record.leaveType || "N/A"}</td>
                        <td className="px-3 py-3 text-sm font-semibold text-slate-900">{formatDays(record.numberOfDays)}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">
                          {currencyFormatter.format(Number(record.dailyRate) || 0)}
                        </td>
                        <td className="px-3 py-3 text-sm font-semibold text-slate-900">
                          {currencyFormatter.format(Number(record.estimatedAmount) || 0)}
                        </td>
                        <td className="px-3 py-3">
                          <LeaveStatusBadge status={record.status} roleKey={roleKey} />
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(record.dateFiled)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            {showReviewAction ? (
                              <ActionIconButton
                                label="Approve leave monetization"
                                icon={faCheck}
                                tone="approve"
                                onClick={() => handleAction("markReviewed", record)}
                              />
                            ) : null}
                            {showApproveAction ? (
                              <ActionIconButton
                                label={isRegionalDirector ? "Final approve leave monetization" : "Approve leave monetization"}
                                icon={faCheck}
                                tone="approve"
                                onClick={() => handleAction("approve", record)}
                              />
                            ) : null}
                            {showRejectAction ? (
                              <ActionIconButton
                                label="Reject leave monetization"
                                icon={faXmark}
                                tone="reject"
                                onClick={() => handleAction("reject", record)}
                              />
                            ) : null}
                            {showRejectAction || showOwnCancelAction ? (
                              <ActionIconButton
                                label="Cancel leave monetization"
                                icon={faBan}
                                tone="cancel"
                                onClick={() => handleAction("cancel", record)}
                              />
                            ) : null}
                            <ActionIconButton
                              label="View leave monetization form"
                              icon={faEye}
                              tone="view"
                              onClick={() => handleAction("view", record)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-slate-500">
            Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1}
            {" "}to {Math.min(safePage * rowsPerPage, filteredRecords.length)} of {filteredRecords.length} requests
          </p>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      </section>

      <Modal
        open={formOpen}
        title="File Leave Monetization"
        onClose={closeForm}
        maxWidth="max-w-2xl"
        footer={(
          <>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="leaveMonetizationForm" loading={saving}>
              Submit Request
            </Button>
          </>
        )}
      >
        <form id="leaveMonetizationForm" className="grid gap-4" onSubmit={handleSubmit}>
          {canSelectEmployee ? (
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Employee *</label>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={selectedEmployee}
                onSelect={(employee) => setForm((current) => ({
                  ...current,
                  employeeRecordId: employee?.employeeRecordId || "",
                }))}
                placeholder="Search employee..."
                disabled={employeeOptions.length === 0}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Filing for <span className="font-semibold text-slate-900">{user?.full_name || user?.username || "your account"}</span>.
            </div>
          )}

          <div>
            <span className="mb-2 block text-sm font-semibold text-slate-700">Leave credit to monetize *</span>
            {creditsLoading ? (
              <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            ) : creditOptions.length === 0 ? (
              <p className="m-0 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                {canSelectEmployee && !form.employeeRecordId
                  ? "Select an employee to load monetizable leave credits."
                  : "No monetizable leave credits are available."}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {creditOptions.map((option) => {
                  const active = form.leaveTypeCode === option.code;

                  return (
                    <button
                      key={option.code}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, leaveTypeCode: option.code }))}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-teal-500 bg-teal-50 ring-2 ring-teal-100"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{option.leaveType}</span>
                        <Coins size={15} className={active ? "text-teal-700" : "text-slate-400"} />
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {formatDays(option.available)} day(s) available
                        {Number(option.pendingMonetization) > 0
                          ? ` - ${formatDays(option.pendingMonetization)} awaiting approval`
                          : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Number of credits to monetize *"
              name="numberOfDays"
              type="number"
              min="0.5"
              step="0.5"
              value={form.numberOfDays}
              onChange={updateForm("numberOfDays")}
              placeholder="0"
              required
              error={
                selectedCreditOption && requestedDays > Number(selectedCreditOption.available || 0)
                  ? `Only ${formatDays(selectedCreditOption.available)} day(s) available.`
                  : ""
              }
            />
            <InputField
              label="Date of filing *"
              name="dateFiled"
              type="date"
              value={form.dateFiled}
              onChange={updateForm("dateFiled")}
              required
            />
          </div>

          <InputField
            label="Purpose"
            name="reason"
            value={form.reason}
            onChange={updateForm("reason")}
            placeholder="Reason for monetizing the leave credits"
          />

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-600">Daily rate</span>
              <span className="font-semibold text-slate-900">{currencyFormatter.format(dailyRate)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-slate-600">Estimated monetized value</span>
              <span className="font-semibold text-slate-900">{currencyFormatter.format(estimatedAmount)}</span>
            </div>
            <p className="m-0 mt-2 text-xs text-slate-500">
              Daily rate uses the Civil Service constant factor (monthly salary x 0.0481170). The final amount is
              confirmed during payroll processing.
            </p>
          </div>
        </form>
      </Modal>

      <LeaveMonetizationFormModal
        open={Boolean(selectedRecord)}
        record={selectedRecord}
        reviewer={user}
        showHrmoReviewerSignature={isHrHead}
        showRegionalDirectorApproverSignature={isRegionalDirector}
        onClose={() => setSelectedRecord(null)}
      />
    </section>
  );
}
