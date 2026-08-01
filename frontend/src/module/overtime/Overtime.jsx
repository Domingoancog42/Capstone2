import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Filter, Plus, Search } from "lucide-react";
import { faBan, faCheck, faEye, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Pagination from "../../components/UI/Pagination";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchOvertimeRequests,
  fileOvertimeRequest,
  updateOvertimeStatus,
} from "../../services/overtimeService";
import { countPendingRecords, resolveRoleKey } from "../../utils/leaveHelpers";

const overtimeStatuses = ["Pending", "Approved", "Rejected", "Cancelled"];
const DEFAULT_OVERTIME_ROWS_PER_PAGE = 10;

const initialForm = {
  employeeRecordId: "",
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

function statusBadgeClass(status) {
  switch (String(status || "").toLowerCase()) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "rejected":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
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
  const [viewingRecord, setViewingRecord] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const roleKey = resolveRoleKey(user);
  const canManage = ["admin", "hrhead", "hrstaff", "regionaldirector", "chief"].includes(roleKey);
  const pendingCount = useMemo(() => countPendingRecords(records), [records]);

  const employeeOptions = useMemo(() => buildEmployeeOptions(employees), [employees]);
  const canSelectEmployee = showEmployeeFilter && roleKey !== "employee" && employeeOptions.length > 0;
  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeOptions, form.employeeRecordId]
  );

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchOvertimeRequests();
      setRecords(result.records || []);
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load overtime requests.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadRecords, { topic: "overtime" });

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
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / DEFAULT_OVERTIME_ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * DEFAULT_OVERTIME_ROWS_PER_PAGE;
    return filteredRecords.slice(startIndex, startIndex + DEFAULT_OVERTIME_ROWS_PER_PAGE);
  }, [filteredRecords, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [date, query, status]);

  const openForm = () => {
    setForm({
      ...initialForm,
      employeeName: user?.full_name || user?.username || "",
    });
    setModalOpen(true);
  };

  const closeForm = () => {
    setModalOpen(false);
    setForm(initialForm);
  };

  const updateForm = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleEmployeeSelect = (employee) => {
    setForm((current) => ({
      ...current,
      employeeRecordId: employee?.employeeRecordId || "",
      employeeName: employee?.employeeName || "",
    }));
  };

  const submitOvertime = async (event) => {
    event.preventDefault();
    setSaving(true);
    const submitToastId = toast.loading("Submitting overtime request...");

    try {
      const result = await fileOvertimeRequest({
        employeeRecordId: form.employeeRecordId,
        employeeName: form.employeeName,
        workDate: form.workDate,
        hourRequested: form.hourRequested,
        requestDate: formatLocalSqlDateTime(new Date()),
        reason: form.reason,
      });
      if (result.record) {
        setRecords((current) => [
          result.record,
          ...current.filter((record) => String(record.id) !== String(result.record.id)),
        ]);
      } else {
        await loadRecords();
      }
      setQuery("");
      setStatus("");
      setDate("");
      setCurrentPage(1);
      toast.success("Overtime request submitted successfully.", { id: submitToastId });
      closeForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to submit overtime request.", { id: submitToastId });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (record, nextStatus) => {
    const actionKey = String(nextStatus || "").toLowerCase();
    const actionLabels = {
      approved: "approve",
      rejected: "reject",
      cancelled: "cancel",
    };
    const actionTitles = {
      approved: "Approve Overtime Request?",
      rejected: "Reject Overtime Request?",
      cancelled: "Cancel Overtime Request?",
    };
    const confirmText = {
      approved: "Approve",
      rejected: "Reject",
      cancelled: "Cancel Request",
    };
    const confirmation = await Swal.fire({
      title: actionTitles[actionKey] || "Update Overtime Request?",
      text: `Are you sure you want to ${actionLabels[actionKey] || "update"} the overtime request for ${record.employeeName || "this employee"}?`,
      icon: actionKey === "approved" ? "success" : "warning",
      showCancelButton: true,
      confirmButtonText: confirmText[actionKey] || "Confirm",
      cancelButtonText: "Close",
      confirmButtonColor: actionKey === "approved" ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await updateOvertimeStatus(record.id, nextStatus);
      setRecords((current) => current.map((item) => (item.id === record.id ? result.record : item)));
      toast.success(`Overtime request ${nextStatus.toLowerCase()}.`);
      await Swal.fire({
        title: "Updated",
        text: `Overtime request ${nextStatus.toLowerCase()} successfully.`,
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      const message = error?.response?.data?.message || "Unable to update overtime request.";
      toast.error(message);
      await Swal.fire({
        title: "Update Failed",
        text: message,
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  return (
    <section className="w-full space-y-5">
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button icon={Plus} onClick={openForm}>
            {submitLabel}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
            <label className="relative">
              <span className="sr-only">Search overtime requests</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee, division, reason"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
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
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
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
                          {(safePage - 1) * DEFAULT_OVERTIME_ROWS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <div className="font-semibold text-slate-900">{record.employeeName}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.division || "Unassigned"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.workDate || record.overtimeDate || "No date"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatAmount(record.hourRequested ?? record.hoursWorked)}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{record.reason || "No reason provided"}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatRequestDate(record)}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(record.status)}`}>
                            {record.status || "Pending"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <ActionIconButton
                              label="View overtime request"
                              icon={faEye}
                              tone="view"
                              onClick={() => setViewingRecord(record)}
                            />
                            {canManage && record.status === "Pending" ? (
                              <>
                                <ActionIconButton
                                  label="Approve overtime request"
                                  icon={faCheck}
                                  tone="approve"
                                  onClick={() => handleStatusUpdate(record, "Approved")}
                                />
                                <ActionIconButton
                                  label="Reject overtime request"
                                  icon={faXmark}
                                  tone="reject"
                                  onClick={() => handleStatusUpdate(record, "Rejected")}
                                />
                                <ActionIconButton
                                  label="Cancel overtime request"
                                  icon={faBan}
                                  tone="cancel"
                                  onClick={() => handleStatusUpdate(record, "Cancelled")}
                                />
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * DEFAULT_OVERTIME_ROWS_PER_PAGE + 1}
              {" "}to {Math.min(safePage * DEFAULT_OVERTIME_ROWS_PER_PAGE, filteredRecords.length)} of {filteredRecords.length} overtime requests
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </CardContent>
      </Card>

      <Modal
        open={modalOpen}
        title={submitLabel}
        maxWidth="max-w-[760px]"
        onClose={closeForm}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button type="submit" form="overtimeForm" icon={Clock3} loading={saving}>Submit</Button>
          </>
        }
      >
        <form id="overtimeForm" className="grid gap-4" onSubmit={submitOvertime}>
          {canSelectEmployee ? (
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
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
            onChange={updateForm("workDate")}
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
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(viewingRecord.status)}`}>
                  {viewingRecord.status || "Pending"}
                </span>
              </p>
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
