import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Filter, Plus, Search } from "lucide-react";
import { faBoxArchive, faCheck, faEye, faPen, faXmark } from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Pagination from "../../components/UI/Pagination";
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
import { getEmployees } from "../../services/api";
import {
  archiveLoanRequest,
  createLoanRequest,
  fetchLoanRequestById,
  fetchLoanRequests,
  LOAN_STATUSES,
  LOAN_TYPES,
  updateLoanRequest,
  updateLoanStatus,
} from "../../services/loanService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { currencyFormatter } from "../../utils/format";

const rowsPerPage = 8;

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm() {
  return {
    employeeRecordId: "",
    loanType: "",
    loanAmount: "",
    repaymentTerms: "",
    purpose: "",
    dateFiled: todayInputValue(),
    supportingDocument: null,
  };
}

function normalizeRoleKey(user) {
  return String(user?.roleKey || user?.role || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
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

function formatDateTime(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function loanId(record) {
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? `LN-${String(id).padStart(4, "0")}` : "N/A";
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

function compareRecordsByDateFiled(left, right) {
  return new Date(right.dateFiled || 0) - new Date(left.dateFiled || 0);
}

function auditActionLabel(action) {
  switch (String(action || "").toLowerCase()) {
    case "submitted":
      return "Submitted";
    case "updated":
      return "Updated";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "archived":
      return "Archived";
    default:
      return action || "Audit Event";
  }
}

export default function FileLoan({
  employees = [],
  user,
  title = "Loan Management",
  description = "File employee loan applications and monitor review status, approvals, and audit history.",
}) {
  const [records, setRecords] = useState([]);
  const [loadedEmployees, setLoadedEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loanTypeFilter, setLoanTypeFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [form, setForm] = useState(() => emptyForm());

  const roleKey = normalizeRoleKey(user);
  const canReview = ["admin", "hrhead", "hrstaff", "regionaldirector"].includes(roleKey);
  const canManageRecords = ["admin", "hrhead", "hrstaff"].includes(roleKey);
  const canFileForOthers = canManageRecords;
  const canFileLoanRequest = canFileForOthers || Boolean(roleKey);
  const employeeOptions = useMemo(
    () => buildEmployeeOptions(employees.length ? employees : loadedEmployees),
    [employees, loadedEmployees]
  );
  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [employeeOptions, form.employeeRecordId]
  );

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchLoanRequests();
      setRecords(Array.isArray(result.records) ? result.records : []);
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load loan requests.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadRecords, { topic: "loan_request" });

  useEffect(() => {
    if (employees.length > 0) {
      return undefined;
    }

    let active = true;
    setEmployeeLoading(true);

    getEmployees()
      .then((result) => {
        if (active) {
          setLoadedEmployees(Array.isArray(result.employees) ? result.employees : []);
        }
      })
      .catch((error) => {
        if (active) {
          toast.error(error?.response?.data?.message || "Unable to load employee options.");
        }
      })
      .finally(() => {
        if (active) {
          setEmployeeLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [employees.length]);

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = !search || [
        loanId(record),
        record.employeeName,
        record.employeeId,
        record.loanType,
        record.loanAmount,
        record.repaymentTerms,
        record.purpose,
        record.dateFiled,
        record.status,
        record.approvedBy,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesStatus = !statusFilter || record.status === statusFilter;
      const matchesLoanType = !loanTypeFilter || record.loanType === loanTypeFilter;

      return matchesSearch && matchesStatus && matchesLoanType;
    });
  }, [loanTypeFilter, query, records, statusFilter]);

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort(compareRecordsByDateFiled);
  }, [filteredRecords]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * rowsPerPage;
    return sortedRecords.slice(startIndex, startIndex + rowsPerPage);
  }, [safePage, sortedRecords]);

  useEffect(() => {
    setCurrentPage(1);
  }, [loanTypeFilter, query, statusFilter]);

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

    setViewingRecord((current) => (
      current && String(current.id) === String(record.id) ? { ...current, ...record } : current
    ));
  };

  const openCreateForm = () => {
    setEditingRecord(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEditForm = (record) => {
    setEditingRecord(record);
    setForm({
      employeeRecordId: String(record.employeeRecordId || ""),
      loanType: record.loanType || "",
      loanAmount: String(record.loanAmount || ""),
      repaymentTerms: record.repaymentTerms || "",
      purpose: record.purpose || "",
      dateFiled: record.dateFiled || todayInputValue(),
      supportingDocument: null,
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

  const openView = async (record) => {
    if (!record) {
      return;
    }

    setViewingRecord(record);
    setViewLoading(true);

    try {
      const result = await fetchLoanRequestById(record.id);
      setViewingRecord(result.record || record);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to load loan request details.");
    } finally {
      setViewLoading(false);
    }
  };

  const handleEmployeeSelect = (employee) => {
    setForm((current) => ({
      ...current,
      employeeRecordId: employee?.employeeRecordId || "",
    }));
  };

  const updateForm = (field) => (event) => {
    const value = field === "supportingDocument"
      ? event.target.files?.[0] || null
      : event.target.value;

    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const validateForm = () => {
    if (canFileForOthers && !form.employeeRecordId) {
      toast.error("Select an employee first.");
      return false;
    }

    if (!form.loanType) {
      toast.error("Select a loan type.");
      return false;
    }

    if ((Number(form.loanAmount) || 0) <= 0) {
      toast.error("Enter a loan amount greater than zero.");
      return false;
    }

    if (!form.repaymentTerms.trim()) {
      toast.error("Enter the repayment terms.");
      return false;
    }

    if (!form.purpose.trim()) {
      toast.error("Enter the purpose of the loan.");
      return false;
    }

    if (!form.dateFiled) {
      toast.error("Select the date filed.");
      return false;
    }

    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSaving(true);
    const toastId = toast.loading(editingRecord ? "Saving loan request..." : "Submitting loan request...");

    try {
      const payload = {
        employeeRecordId: canFileForOthers ? form.employeeRecordId : undefined,
        loanType: form.loanType,
        loanAmount: Number(form.loanAmount) || 0,
        repaymentTerms: form.repaymentTerms.trim(),
        purpose: form.purpose.trim(),
        dateFiled: form.dateFiled,
        supportingDocument: form.supportingDocument,
      };
      const result = editingRecord
        ? await updateLoanRequest(editingRecord.id, payload)
        : await createLoanRequest(payload);

      upsertRecord(result.record);
      toast.success(result.message || (editingRecord ? "Loan request updated." : "Loan request submitted."), { id: toastId });
      closeForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save loan request.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (record, nextStatus) => {
    if (!record || record.status === nextStatus || !canReview) {
      return;
    }

    const confirmation = await Swal.fire({
      title: `${nextStatus} Loan Request?`,
      text: `This will mark ${record.employeeName || "the employee"}'s loan request as ${nextStatus.toLowerCase()}.`,
      input: "textarea",
      inputLabel: "Remarks",
      inputPlaceholder: "Enter approval or rejection remarks",
      inputAttributes: {
        "aria-label": "Remarks",
      },
      icon: nextStatus === "Approved" ? "success" : "warning",
      showCancelButton: true,
      confirmButtonText: nextStatus,
      cancelButtonText: "Cancel",
      confirmButtonColor: nextStatus === "Approved" ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
      inputValidator: (value) => {
        if (nextStatus === "Rejected" && !String(value || "").trim()) {
          return "Remarks are required when rejecting a loan request.";
        }
        return undefined;
      },
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const toastId = toast.loading("Updating loan status...");

    try {
      const result = await updateLoanStatus(record.id, nextStatus, confirmation.value || "");
      upsertRecord(result.record);
      toast.success(result.message || `Loan request ${nextStatus.toLowerCase()}.`, { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update loan status.", { id: toastId });
    }
  };

  const handleArchive = async (record) => {
    if (!record || !canManageRecords) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Archive Loan Request?",
      text: `Archive ${record.employeeName || "this employee"}'s loan request?`,
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

    const toastId = toast.loading("Archiving loan request...");

    try {
      const result = await archiveLoanRequest(record.id);
      setRecords((current) => current.filter((item) => String(item.id) !== String(record.id)));
      toast.success(result.message || "Loan request archived.", { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to archive loan request.", { id: toastId });
    }
  };

  const columns = [
    {
      key: "loanId",
      header: "Loan ID",
      render: (record) => <span className="font-semibold text-slate-900">{loanId(record)}</span>,
    },
    {
      key: "employeeName",
      header: "Employee Name",
      render: (record) => <span className="font-semibold text-slate-900">{record.employeeName || "N/A"}</span>,
    },
    {
      key: "employeeId",
      header: "Employee ID",
      render: (record) => record.employeeId || "N/A",
    },
    {
      key: "loanType",
      header: "Loan Type",
      render: (record) => record.loanType || "N/A",
    },
    {
      key: "loanAmount",
      header: "Loan Amount",
      cellClassName: "font-semibold text-slate-900",
      render: (record) => formatCurrency(record.loanAmount),
    },
    {
      key: "repaymentTerms",
      header: "Repayment Terms",
      render: (record) => record.repaymentTerms || "N/A",
    },
    {
      key: "dateFiled",
      header: "Date Filed",
      render: (record) => formatDate(record.dateFiled),
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
      key: "approvedBy",
      header: "Approved By",
      render: (record) => record.status === "Approved" ? (record.approvedBy || "N/A") : "N/A",
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-center",
      cellClassName: "whitespace-nowrap",
      render: (record) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionIconButton
            label="View loan request"
            icon={faEye}
            tone="view"
            onClick={() => openView(record)}
          />
          {canManageRecords ? (
            <ActionIconButton
              label="Edit loan request"
              icon={faPen}
              tone="edit"
              onClick={() => openEditForm(record)}
            />
          ) : null}
          {canReview && record.status !== "Approved" ? (
            <ActionIconButton
              label="Approve loan request"
              icon={faCheck}
              tone="approve"
              onClick={() => handleStatusUpdate(record, "Approved")}
            />
          ) : null}
          {canReview && record.status !== "Rejected" ? (
            <ActionIconButton
              label="Reject loan request"
              icon={faXmark}
              tone="reject"
              onClick={() => handleStatusUpdate(record, "Rejected")}
            />
          ) : null}
          {canManageRecords ? (
            <ActionIconButton
              label="Archive loan request"
              icon={faBoxArchive}
              tone="archive"
              onClick={() => handleArchive(record)}
            />
          ) : null}
        </div>
      ),
    },
  ];

  const documentUrl = resolveBackendAssetUrl(viewingRecord?.supportingDocumentPath);

  return (
    <section className="w-full space-y-5">
      <Card className="overflow-hidden border-slate-200/80 bg-white/95 shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canFileLoanRequest ? (
              <Button icon={Plus} onClick={openCreateForm}>
                File Loan Request
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 xl:grid-cols-[1fr_190px_280px]">
            <label className="relative">
              <span className="sr-only">Search loan requests</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search loan ID, employee, type, status"
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              {LOAN_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              value={loanTypeFilter}
              onChange={(event) => setLoanTypeFilter(event.target.value)}
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All loan types</option>
              {LOAN_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <Table
              columns={columns}
              data={paginatedRecords}
              rowKey="id"
              stickyHeader
              tableClassName="min-w-[1500px]"
              className="max-h-[560px]"
              emptyMessage={loading ? "Loading loan requests..." : (
                <div className="py-10 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    <Filter size={20} />
                  </div>
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No loan requests found</p>
                  <p className="m-0 mt-1 text-sm text-slate-500">File a request or adjust the filters.</p>
                </div>
              )}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {sortedRecords.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1}
              {" "}to {Math.min(safePage * rowsPerPage, sortedRecords.length)} of {sortedRecords.length} requests
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        title={editingRecord ? "Edit Loan Request" : "File Loan Request"}
        onClose={closeForm}
        maxWidth="max-w-3xl"
        footer={(
          <>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="loanRequestForm" loading={saving}>
              {editingRecord ? "Save Changes" : "Submit Request"}
            </Button>
          </>
        )}
      >
        <form id="loanRequestForm" className="grid gap-4" onSubmit={handleSubmit}>
          {canFileForOthers ? (
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Employee *</label>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={selectedEmployee}
                onSelect={handleEmployeeSelect}
                placeholder={employeeLoading ? "Loading employees..." : "Search employee..."}
                disabled={employeeLoading || employeeOptions.length === 0}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              This loan request will be filed under your employee profile.
            </div>
          )}

          {canFileForOthers && selectedEmployee ? (
            <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">Employee ID</dt>
                <dd className="m-0 mt-1 text-sm font-semibold text-slate-900">{selectedEmployee.employeeId || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">Division</dt>
                <dd className="m-0 mt-1 text-sm font-semibold text-slate-900">{selectedEmployee.division || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">Designation</dt>
                <dd className="m-0 mt-1 text-sm font-semibold text-slate-900">{selectedEmployee.designation || "N/A"}</dd>
              </div>
            </dl>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="loanType" className="mb-2 block text-sm font-semibold text-slate-700">Loan Type *</label>
              <select
                id="loanType"
                value={form.loanType}
                onChange={updateForm("loanType")}
                required
                className="min-h-[46px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">Select loan type</option>
                {LOAN_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <InputField
              label="Loan Amount *"
              name="loanAmount"
              type="number"
              min="0.01"
              step="0.01"
              value={form.loanAmount}
              onChange={updateForm("loanAmount")}
              placeholder="0.00"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Repayment Terms *"
              name="repaymentTerms"
              value={form.repaymentTerms}
              onChange={updateForm("repaymentTerms")}
              placeholder="Example: 12 months"
              required
            />
            <InputField
              label="Date Filed *"
              name="dateFiled"
              type="date"
              value={form.dateFiled}
              onChange={updateForm("dateFiled")}
              required
            />
          </div>

          <div>
            <label htmlFor="loanPurpose" className="mb-2 block text-sm font-semibold text-slate-700">Purpose of Loan *</label>
            <textarea
              id="loanPurpose"
              value={form.purpose}
              onChange={updateForm("purpose")}
              rows={4}
              required
              placeholder="Enter the purpose of the loan"
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </div>

          <div>
            <label htmlFor="supportingDocument" className="mb-2 block text-sm font-semibold text-slate-700">Supporting Documents</label>
            <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
              <input
                key={`${editingRecord?.id || "new"}-${formOpen}`}
                id="supportingDocument"
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.bmp"
                onChange={updateForm("supportingDocument")}
                className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              />
              {form.supportingDocument ? (
                <p className="m-0 mt-2 text-sm text-slate-500">{form.supportingDocument.name}</p>
              ) : editingRecord?.supportingDocumentName ? (
                <p className="m-0 mt-2 text-sm text-slate-500">Current document: {editingRecord.supportingDocumentName}</p>
              ) : null}
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(viewingRecord)}
        title="Loan Request"
        onClose={() => setViewingRecord(null)}
        maxWidth="max-w-4xl"
        footer={<Button variant="secondary" onClick={() => setViewingRecord(null)}>Close</Button>}
      >
        {viewingRecord ? (
          <div className="space-y-6">
            {viewLoading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                Loading loan request details...
              </div>
            ) : null}

            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-sm font-semibold text-slate-500">Loan ID</dt>
                <dd className="m-0 mt-1 font-semibold text-slate-950">{loanId(viewingRecord)}</dd>
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
                <dt className="text-sm font-semibold text-slate-500">Date Filed</dt>
                <dd className="m-0 mt-1 text-slate-950">{formatDate(viewingRecord.dateFiled)}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Employee Name</dt>
                <dd className="m-0 mt-1 text-slate-950">{viewingRecord.employeeName || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Employee ID</dt>
                <dd className="m-0 mt-1 text-slate-950">{viewingRecord.employeeId || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Division</dt>
                <dd className="m-0 mt-1 text-slate-950">{viewingRecord.division || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Loan Type</dt>
                <dd className="m-0 mt-1 text-slate-950">{viewingRecord.loanType || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Loan Amount</dt>
                <dd className="m-0 mt-1 font-semibold text-slate-950">{formatCurrency(viewingRecord.loanAmount)}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Repayment Terms</dt>
                <dd className="m-0 mt-1 text-slate-950">{viewingRecord.repaymentTerms || "N/A"}</dd>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-sm font-semibold text-slate-500">Purpose</dt>
                <dd className="m-0 mt-1 whitespace-pre-wrap text-slate-950">{viewingRecord.purpose || "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Approved By</dt>
                <dd className="m-0 mt-1 text-slate-950">{viewingRecord.status === "Approved" ? (viewingRecord.approvedBy || "N/A") : "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Approval Date</dt>
                <dd className="m-0 mt-1 text-slate-950">{formatDateTime(viewingRecord.approvedAt || viewingRecord.reviewedAt)}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Reviewed By</dt>
                <dd className="m-0 mt-1 text-slate-950">{viewingRecord.reviewedBy || viewingRecord.rejectedBy || "N/A"}</dd>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-sm font-semibold text-slate-500">Remarks</dt>
                <dd className="m-0 mt-1 whitespace-pre-wrap text-slate-950">{viewingRecord.approvalRemarks || "N/A"}</dd>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-sm font-semibold text-slate-500">Supporting Documents</dt>
                <dd className="m-0 mt-2">
                  {documentUrl ? (
                    <a
                      href={documentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <FileText size={16} />
                      {viewingRecord.supportingDocumentName || "Open Document"}
                    </a>
                  ) : (
                    <span className="text-slate-500">N/A</span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="border-t border-slate-200 pt-5">
              <h3 className="m-0 text-base font-semibold text-slate-900">Audit Trail</h3>
              <div className="mt-3 space-y-3">
                {Array.isArray(viewingRecord.auditTrail) && viewingRecord.auditTrail.length ? (
                  viewingRecord.auditTrail.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="m-0 text-sm font-semibold text-slate-900">{auditActionLabel(entry.action)}</p>
                          <p className="m-0 mt-1 text-sm text-slate-500">
                            {entry.actorName || "System"}{entry.actorRole ? ` - ${entry.actorRole}` : ""}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-slate-500">{formatDateTime(entry.createdAt)}</span>
                      </div>
                      <p className="m-0 mt-2 text-sm text-slate-600">
                        {entry.previousStatus || "New"} to {entry.newStatus || entry.previousStatus || "N/A"}
                      </p>
                      {entry.remarks ? (
                        <p className="m-0 mt-2 whitespace-pre-wrap text-sm text-slate-700">{entry.remarks}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                    No audit trail entries available.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
