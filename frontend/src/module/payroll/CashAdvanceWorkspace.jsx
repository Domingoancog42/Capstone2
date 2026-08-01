import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Plus, Search } from "lucide-react";
import { faBoxArchive, faCheck, faEye, faPen, faXmark } from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
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
import Table from "../../components/UI/table";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  archiveCashAdvanceRequest,
  createCashAdvanceRequest,
  fetchCashAdvanceRequests,
  updateCashAdvanceRequest,
  updateCashAdvanceStatus,
} from "../../services/cashAdvanceService";
import { currencyFormatter } from "../../utils/format";

const statusOptions = ["Pending", "Approved", "Rejected"];
const rowsPerPage = 8;

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm() {
  return {
    employeeRecordId: "",
    amount: "",
    requestDate: todayInputValue(),
    purpose: "",
    deductionNotes: "",
  };
}

function buildEmployeeOptions(employees = []) {
  return employees
    .map((employee) => ({
      employeeRecordId: employee.id || employee.employeeRecordId || "",
      employeeId: employee.employeeId || employee.employee_id || "",
      employeeName: employee.fullName || employee.employeeName || employee.full_name || "",
      division: employee.department || employee.division || "",
      designation: employee.position || employee.designation || "",
    }))
    .filter((employee) => employee.employeeRecordId || employee.employeeName);
}

function formatCurrency(value) {
  const amount = Number(value);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function statusBadgeClass(status) {
  switch (String(status || "").toLowerCase()) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "rejected":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function cashAdvanceId(record) {
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? `CA-${String(id).padStart(4, "0")}` : "N/A";
}

export default function CashAdvanceWorkspace({ employees = [], user }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [form, setForm] = useState(() => emptyForm());

  const employeeOptions = useMemo(() => buildEmployeeOptions(employees), [employees]);
  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeOptions, form.employeeRecordId]
  );
  const canManage = ["admin", "hrhead", "hrstaff"].includes(String(user?.roleKey || user?.role || "").toLowerCase());

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchCashAdvanceRequests();
      setRecords(Array.isArray(result.records) ? result.records : []);
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load cash advance requests.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadRecords, { topic: "cash_advance" });

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = !search || [
        cashAdvanceId(record),
        record.employeeId,
        record.employeeName,
        record.division,
        record.designation,
        record.purpose,
        record.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesStatus = !statusFilter || record.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [query, records, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * rowsPerPage;
    return filteredRecords.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredRecords, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter]);

  const openCreateForm = () => {
    setEditingRecord(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEditForm = (record) => {
    setEditingRecord(record);
    setForm({
      employeeRecordId: String(record.employeeRecordId || ""),
      amount: String(record.amount || ""),
      requestDate: record.requestDate || todayInputValue(),
      purpose: record.purpose || "",
      deductionNotes: record.deductionNotes || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) {
      return;
    }

    setFormOpen(false);
    setEditingRecord(null);
    setForm(emptyForm());
  };

  const handleEmployeeSelect = (employee) => {
    setForm((current) => ({
      ...current,
      employeeRecordId: employee?.employeeRecordId || "",
    }));
  };

  const updateForm = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const upsertRecord = (record) => {
    if (!record) {
      return;
    }

    setRecords((current) => {
      const exists = current.some((item) => String(item.id) === String(record.id));
      return exists
        ? current.map((item) => (String(item.id) === String(record.id) ? record : item))
        : [record, ...current];
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.employeeRecordId) {
      toast.error("Select an employee first.");
      return;
    }

    if ((Number(form.amount) || 0) <= 0) {
      toast.error("Enter a cash advance amount greater than zero.");
      return;
    }

    if (!form.requestDate) {
      toast.error("Select a request date.");
      return;
    }

    setSaving(true);
    const toastId = toast.loading(editingRecord ? "Saving cash advance request..." : "Submitting cash advance request...");

    try {
      const payload = {
        employeeRecordId: form.employeeRecordId,
        amount: Number(form.amount) || 0,
        requestDate: form.requestDate,
        purpose: form.purpose.trim(),
        deductionNotes: form.deductionNotes.trim(),
      };
      const result = editingRecord
        ? await updateCashAdvanceRequest(editingRecord.id, payload)
        : await createCashAdvanceRequest(payload);

      upsertRecord(result.record);
      toast.success(result.message || (editingRecord ? "Cash advance request updated." : "Cash advance request submitted."), { id: toastId });
      closeForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save cash advance request.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (record, nextStatus) => {
    if (!record || record.status === nextStatus) {
      return;
    }

    const action = nextStatus === "Approved" ? "approve" : "reject";
    const confirmation = await Swal.fire({
      title: `${nextStatus} Cash Advance?`,
      text: `This will ${action} ${record.employeeName || "the employee"}'s cash advance request.`,
      icon: nextStatus === "Approved" ? "success" : "warning",
      showCancelButton: true,
      confirmButtonText: nextStatus,
      cancelButtonText: "Cancel",
      confirmButtonColor: nextStatus === "Approved" ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const toastId = toast.loading("Updating cash advance status...");

    try {
      const result = await updateCashAdvanceStatus(record.id, nextStatus);
      upsertRecord(result.record);
      toast.success(result.message || `Cash advance request ${nextStatus.toLowerCase()}.`, { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update cash advance status.", { id: toastId });
    }
  };

  const handleArchive = async (record) => {
    if (!record) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Archive Cash Advance?",
      text: `Archive ${record.employeeName || "this employee"}'s cash advance request?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Archive",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const toastId = toast.loading("Archiving cash advance request...");

    try {
      const result = await archiveCashAdvanceRequest(record.id);
      setRecords((current) => current.filter((item) => String(item.id) !== String(record.id)));
      toast.success(result.message || "Cash advance request archived.", { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to archive cash advance request.", { id: toastId });
    }
  };

  const columns = [
    {
      key: "id",
      header: "Request ID",
      render: (record) => <span className="font-semibold text-slate-900">{cashAdvanceId(record)}</span>,
    },
    {
      key: "employeeName",
      header: "Employee",
      render: (record) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{record.employeeName || "N/A"}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Cash Advance Amount",
      cellClassName: "font-semibold text-slate-900",
      render: (record) => formatCurrency(record.amount),
    },
    {
      key: "requestDate",
      header: "Request Date",
      render: (record) => formatDate(record.requestDate),
    },
    {
      key: "status",
      header: "Status",
      render: (record) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(record.status)}`}>
          {record.status || "Pending"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-center",
      cellClassName: "whitespace-nowrap",
      render: (record) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionIconButton
            label="View cash advance request"
            icon={faEye}
            tone="view"
            onClick={() => setViewingRecord(record)}
          />
          <ActionIconButton
            label="Edit cash advance request"
            icon={faPen}
            tone="edit"
            onClick={() => openEditForm(record)}
          />
          {canManage && record.status !== "Approved" ? (
            <ActionIconButton
              label="Approve cash advance request"
              icon={faCheck}
              tone="approve"
              onClick={() => handleStatusUpdate(record, "Approved")}
            />
          ) : null}
          {canManage && record.status !== "Rejected" ? (
            <ActionIconButton
              label="Reject cash advance request"
              icon={faXmark}
              tone="reject"
              onClick={() => handleStatusUpdate(record, "Rejected")}
            />
          ) : null}
          <ActionIconButton
            label="Archive cash advance request"
            icon={faBoxArchive}
            tone="archive"
            onClick={() => handleArchive(record)}
          />
        </div>
      ),
    },
  ];

  return (
    <section className="w-full space-y-5">
      <Card className="overflow-hidden border-slate-200/80 bg-white/95 shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Cash Advance</CardTitle>
            <CardDescription>
              Review employee cash advance requests and prepare approved amounts for payroll deductions.
            </CardDescription>
          </div>
          <Button icon={Plus} onClick={openCreateForm}>
            File Cash Advance Request
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_200px]">
            <label className="relative">
              <span className="sr-only">Search cash advance requests</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee, division, status"
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <Table
              columns={columns}
              data={paginatedRecords}
              rowKey="id"
              stickyHeader
              tableClassName="min-w-[1180px]"
              className="max-h-[540px]"
              emptyMessage={loading ? "Loading cash advance requests..." : (
                <div className="py-10 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    <Filter size={20} />
                  </div>
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No cash advance requests found</p>
                  <p className="m-0 mt-1 text-sm text-slate-500">File a request or adjust the filters.</p>
                </div>
              )}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1}
              {" "}to {Math.min(safePage * rowsPerPage, filteredRecords.length)} of {filteredRecords.length} requests
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        title={editingRecord ? "Edit Cash Advance Request" : "File Cash Advance Request"}
        onClose={closeForm}
        maxWidth="max-w-2xl"
        footer={(
          <>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="cashAdvanceForm" loading={saving}>
              {editingRecord ? "Save Changes" : "Submit Request"}
            </Button>
          </>
        )}
      >
        <form id="cashAdvanceForm" className="grid gap-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Employee *</label>
            <EmployeeSearchSelect
              employeeOptions={employeeOptions}
              selectedEmployee={selectedEmployee}
              onSelect={handleEmployeeSelect}
              placeholder="Search employee..."
              disabled={employeeOptions.length === 0}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Cash Advance Amount *"
              name="cashAdvanceAmount"
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={updateForm("amount")}
              placeholder="0.00"
              required
            />
            <InputField
              label="Request Date *"
              name="requestDate"
              type="date"
              value={form.requestDate}
              onChange={updateForm("requestDate")}
              required
            />
          </div>
          <InputField
            label="Purpose"
            name="purpose"
            value={form.purpose}
            onChange={updateForm("purpose")}
            placeholder="Short purpose or reason"
          />
          <InputField
            label="Deduction Notes"
            name="deductionNotes"
            value={form.deductionNotes}
            onChange={updateForm("deductionNotes")}
            placeholder="Optional payroll deduction note"
          />
        </form>
      </Modal>

      <Modal
        open={Boolean(viewingRecord)}
        title="Cash Advance Request"
        onClose={() => setViewingRecord(null)}
        maxWidth="max-w-xl"
        footer={<Button variant="secondary" onClick={() => setViewingRecord(null)}>Close</Button>}
      >
        {viewingRecord ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-slate-500">Request ID</dt>
              <dd className="m-0 mt-1 font-semibold text-slate-950">{cashAdvanceId(viewingRecord)}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Status</dt>
              <dd className="m-0 mt-1">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(viewingRecord.status)}`}>
                  {viewingRecord.status || "Pending"}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Employee</dt>
              <dd className="m-0 mt-1 text-slate-950">{viewingRecord.employeeName || "N/A"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Employee ID</dt>
              <dd className="m-0 mt-1 text-slate-950">{viewingRecord.employeeId || "N/A"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Amount</dt>
              <dd className="m-0 mt-1 font-semibold text-slate-950">{formatCurrency(viewingRecord.amount)}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Request Date</dt>
              <dd className="m-0 mt-1 text-slate-950">{formatDate(viewingRecord.requestDate)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-semibold text-slate-500">Purpose</dt>
              <dd className="m-0 mt-1 whitespace-pre-wrap text-slate-950">{viewingRecord.purpose || "N/A"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-semibold text-slate-500">Deduction Notes</dt>
              <dd className="m-0 mt-1 whitespace-pre-wrap text-slate-950">{viewingRecord.deductionNotes || "N/A"}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>
    </section>
  );
}
