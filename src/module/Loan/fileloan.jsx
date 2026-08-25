import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Plus, Search } from "lucide-react";
import { faBoxArchive, faEye, faPen } from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Pagination from "../../components/UI/Pagination";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
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
import { resolveUserRoleKey } from "../../utils/roleRoutes";
import { getEmployees } from "../../services/api";
import {
  archiveLoanRequest,
  createLoanRequest,
  fetchLoanRequestById,
  fetchLoanRequests,
  LOAN_TYPES,
  updateLoanRequest,
} from "../../services/loanService";
import { currencyFormatter } from "../../utils/format";

const rowsPerPage = 8;
const DEFAULT_REPAYMENT_TERMS = "N/A";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLoanAmounts() {
  return LOAN_TYPES.reduce((amounts, type) => ({
    ...amounts,
    [type]: "",
  }), {});
}

function emptyForm() {
  return {
    employeeRecordIds: [],
    loanAmounts: emptyLoanAmounts(),
    repaymentTerms: DEFAULT_REPAYMENT_TERMS,
    purpose: "",
    dateFiled: todayInputValue(),
  };
}

function loanAmountsFromRecord(record) {
  const amounts = emptyLoanAmounts();
  Object.entries(record?.loanAmounts || {}).forEach(([type, amount]) => {
    if (type in amounts) {
      amounts[type] = amount === null || amount === undefined ? "" : String(amount);
    }
  });

  if (record?.loanType) {
    amounts[record.loanType] = amounts[record.loanType] || String(record.loanAmount || "");
  }

  return amounts;
}

function loanAmountEntries(form) {
  return Object.entries(form.loanAmounts || {})
    .map(([loanType, loanAmount]) => ({
      loanType,
      rawAmount: String(loanAmount ?? "").trim(),
      loanAmount: Number(loanAmount),
    }))
    .filter((entry) => entry.rawAmount !== "");
}

function requestedLoanAmounts(form) {
  return loanAmountEntries(form)
    .filter((entry) => Number.isFinite(entry.loanAmount) && entry.loanAmount > 0)
    .map(({ loanType, loanAmount }) => ({ loanType, loanAmount }));
}

function requestedLoanAmountMap(form) {
  return requestedLoanAmounts(form).reduce((amounts, entry) => ({
    ...amounts,
    [entry.loanType]: entry.loanAmount,
  }), {});
}

function recordLoanAmountEntries(record) {
  const amounts = loanAmountsFromRecord(record);
  return Object.entries(amounts)
    .map(([loanType, loanAmount]) => ({
      loanType,
      loanAmount: Number(loanAmount),
    }))
    .filter((entry) => Number.isFinite(entry.loanAmount) && entry.loanAmount > 0);
}

function recordLoanTotal(record) {
  const total = recordLoanAmountEntries(record).reduce((sum, entry) => sum + entry.loanAmount, 0);
  return total || Number(record?.loanAmount || 0);
}

function recordLoanAmountForType(record, type) {
  const entry = recordLoanAmountEntries(record).find((item) => normalizeLoanTypeKey(item.loanType) === normalizeLoanTypeKey(type));
  return entry?.loanAmount || 0;
}

function loanSummary(record) {
  const entries = recordLoanAmountEntries(record);

  if (entries.length > 1) {
    return `${entries.length} loans - ${formatCurrency(recordLoanTotal(record))}`;
  }

  return `${record.loanType || entries[0]?.loanType || "Loan"} - ${formatCurrency(recordLoanTotal(record))}`;
}

// Resolves through the base role, so a role built on HR Head reviews loans as HR Head does.
function normalizeRoleKey(user) {
  return resolveUserRoleKey(user);
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

function loanId(record) {
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? `LN-${String(id).padStart(4, "0")}` : "N/A";
}

function normalizeLoanTypeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function loanTypeColumnKey(value) {
  return `loan-${normalizeLoanTypeKey(value) || "unspecified"}`;
}

function compareRecordsByDateFiled(left, right) {
  return new Date(right.dateFiled || 0) - new Date(left.dateFiled || 0);
}

export default function FileLoan({
  employees = [],
  user,
  title = "Loan Management",
  description = "File and maintain employee loan records.",
}) {
  const [records, setRecords] = useState([]);
  const [loadedEmployees, setLoadedEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [loanTypeFilter, setLoanTypeFilter] = useState("");
  const [archiveView, setArchiveView] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [form, setForm] = useState(() => emptyForm());

  const roleKey = normalizeRoleKey(user);
  const canManageRecords = ["admin", "hrhead", "hrstaff"].includes(roleKey);
  const canFileForOthers = canManageRecords;
  const canFileLoanRequest = canFileForOthers || Boolean(roleKey);
  const employeeOptions = useMemo(
    () => buildEmployeeOptions(employees.length ? employees : loadedEmployees),
    [employees, loadedEmployees]
  );
  const selectedEmployees = useMemo(
    () => employeeOptions.filter((employee) => form.employeeRecordIds.map(String).includes(String(employee.employeeRecordId))),
    [employeeOptions, form.employeeRecordIds]
  );
  const selectedEmployee = selectedEmployees[0] || null;
  const pageTitle = archiveView ? "Archived Loans" : title;
  const pageDescription = archiveView
    ? "Loan records moved to archive are listed here."
    : description;

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchLoanRequests({ archived: archiveView });
      setRecords(Array.isArray(result.records) ? result.records : []);
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load loan records.");
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView]);

  useAutoRefreshOnChange(loadRecords, { topic: "loan_request", refreshOnMount: false });

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

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
        ...recordLoanAmountEntries(record).flatMap((entry) => [entry.loanType, entry.loanAmount]),
        record.dateFiled,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesLoanType = !loanTypeFilter || recordLoanAmountForType(record, loanTypeFilter) > 0;

      return matchesSearch && matchesLoanType;
    });
  }, [loanTypeFilter, query, records]);

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
  }, [archiveView, loanTypeFilter, query]);

  const loanTypeColumns = useMemo(() => {
    const seen = new Set();

    return [
      ...LOAN_TYPES,
      ...records.flatMap((record) => recordLoanAmountEntries(record).map((entry) => entry.loanType)),
      ...records.map((record) => record.loanType),
    ]
      .map((type) => String(type || "").trim())
      .filter(Boolean)
      .filter((type) => {
        const key = normalizeLoanTypeKey(type);
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }, [records]);

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
      employeeRecordIds: record.employeeRecordId ? [String(record.employeeRecordId)] : [],
      loanAmounts: loanAmountsFromRecord(record),
      repaymentTerms: record.repaymentTerms || "",
      purpose: record.purpose || "",
      dateFiled: record.dateFiled || todayInputValue(),
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
      toast.error(error?.response?.data?.message || "Unable to load loan record details.");
    } finally {
      setViewLoading(false);
    }
  };

  const handleEmployeeSelect = (employee) => {
    const employeeRecordId = String(employee?.employeeRecordId || "");
    if (!employeeRecordId) {
      return;
    }

    setForm((current) => ({
      ...current,
      employeeRecordIds: editingRecord
        ? [employeeRecordId]
        : (
          current.employeeRecordIds.map(String).includes(employeeRecordId)
            ? current.employeeRecordIds.filter((id) => String(id) !== employeeRecordId)
            : [...current.employeeRecordIds, employeeRecordId]
        ),
    }));
  };

  const clearSelectedEmployees = () => {
    setForm((current) => ({
      ...current,
      employeeRecordIds: [],
    }));
  };

  const updateLoanAmount = (loanType) => (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      loanAmounts: {
        ...(current.loanAmounts || {}),
        [loanType]: value,
      },
    }));
  };

  const validateForm = () => {
    if (canFileForOthers && form.employeeRecordIds.length === 0) {
      toast.error("Select at least one employee first.");
      return false;
    }

    const enteredAmounts = loanAmountEntries(form);
    const validAmounts = requestedLoanAmounts(form);

    if (enteredAmounts.length === 0) {
      toast.error("Enter at least one loan amount.");
      return false;
    }

    if (validAmounts.length !== enteredAmounts.length) {
      toast.error("Loan amounts must be greater than zero.");
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
    const loanRequests = requestedLoanAmounts(form);
    const loanAmountMap = requestedLoanAmountMap(form);
    const primaryLoan = loanRequests[0];
    const totalLoanAmount = loanRequests.reduce((sum, loanRequest) => sum + loanRequest.loanAmount, 0);
    const employeeRecordIds = canFileForOthers ? form.employeeRecordIds : [undefined];
    const toastId = toast.loading(editingRecord ? "Saving loan record..." : "Processing loan records...");

    try {
      const basePayload = {
        loanType: primaryLoan.loanType,
        loanAmount: totalLoanAmount,
        loanAmounts: loanAmountMap,
        repaymentTerms: form.repaymentTerms.trim() || DEFAULT_REPAYMENT_TERMS,
        purpose: form.purpose.trim(),
        dateFiled: form.dateFiled || todayInputValue(),
      };

      if (editingRecord) {
        const result = await updateLoanRequest(editingRecord.id, {
          ...basePayload,
          employeeRecordId: canFileForOthers ? employeeRecordIds[0] : undefined,
        });
        upsertRecord(result.record);
        toast.success(result.message || "Loan record updated.", { id: toastId });
      } else {
        const results = await Promise.all(employeeRecordIds.map((employeeRecordId) => createLoanRequest({
          ...basePayload,
          employeeRecordId,
        })));

        results.forEach((result) => upsertRecord(result.record));
        toast.success(`${results.length} loan record${results.length === 1 ? "" : "s"} processed.`, { id: toastId });
      }

      closeForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save loan record.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (record) => {
    if (!record || !canManageRecords) {
      return;
    }

    const confirmation = await Swal.fire({
      title: "Archive Loan Record?",
      text: `Archive ${record.employeeName || "this employee"}'s loan record?`,
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

    const toastId = toast.loading("Archiving loan record...");

    try {
      await archiveLoanRequest(record.id);
      setRecords((current) => current.filter((item) => String(item.id) !== String(record.id)));
      setArchiveView(true);
      setCurrentPage(1);
      toast.success("Loan record archived.", { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to archive loan record.", { id: toastId });
    }
  };

  /* `cardRole` lays these columns out as cards below `lg`; see `components/UI/table.jsx`. */
  const columns = [
    {
      key: "loanId",
      header: "Loan ID",
      headerClassName: "min-w-[110px]",
      cardRole: "eyebrow",
      render: (record) => <span className="font-semibold text-slate-900">{loanId(record)}</span>,
    },
    {
      key: "employeeName",
      header: "Employee Name",
      headerClassName: "min-w-[220px]",
      cardRole: "title",
      render: (record) => <span className="font-semibold text-slate-900">{record.employeeName || "N/A"}</span>,
    },
    {
      key: "employeeId",
      header: "Employee ID",
      headerClassName: "min-w-[130px]",
      render: (record) => record.employeeId || "N/A",
    },
    {
      key: "loanSummary",
      header: "Loan",
      headerClassName: "hidden",
      cellClassName: "hidden",
      cardRole: "subtitle",
      render: (record) => loanSummary(record),
    },
    ...loanTypeColumns.map((type) => ({
      key: loanTypeColumnKey(type),
      header: type,
      headerClassName: "min-w-[150px] text-center",
      cellClassName: "text-center font-semibold tabular-nums text-slate-900",
      card: false,
      render: (record) => {
        const amount = recordLoanAmountForType(record, type);
        return amount > 0 ? formatCurrency(amount) : <span className="text-slate-300">-</span>;
      },
    })),
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-center",
      cellClassName: "whitespace-nowrap",
      cardRole: "actions",
      render: (record) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionIconButton
            label="View loan record"
            icon={faEye}
            tone="view"
            onClick={() => openView(record)}
          />
          {canManageRecords && !archiveView ? (
            <ActionIconButton
              label="Edit loan record"
              icon={faPen}
              tone="edit"
              onClick={() => openEditForm(record)}
            />
          ) : null}
          {canManageRecords && !archiveView ? (
            <ActionIconButton
              label="Archive loan record"
              icon={faBoxArchive}
              tone="archive"
              onClick={() => handleArchive(record)}
            />
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section className="w-full space-y-5">
      <Card className="overflow-hidden border-slate-200/80 bg-white/95 shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{pageTitle}</CardTitle>
            <CardDescription>{pageDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canManageRecords ? (
              <ArchiveViewToggle
                archiveView={archiveView}
                onToggle={setArchiveView}
                label="loan records"
              />
            ) : null}
            {canFileLoanRequest && !archiveView ? (
              <Button icon={Plus} onClick={openCreateForm}>
                Loan records
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,260px)_190px]">
            <label className="relative">
              <span className="sr-only">Search loan records</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search loan ID, employee, or type"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <select
              value={loanTypeFilter}
              onChange={(event) => setLoanTypeFilter(event.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All loan types</option>
              {LOAN_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
          <div className="lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200">
            <Table
              columns={columns}
              data={paginatedRecords}
              rowKey="id"
              stickyHeader
              minWidthClassName="min-w-[2200px]"
              className="max-h-[560px]"
              cardsClassName="lg:hidden"
              tableWrapperClassName="hidden lg:block"
              emptyMessage={loading ? "Loading loan records..." : (
                <div className="py-10 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    <Filter size={20} />
                  </div>
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
                    {archiveView ? "No archived loans found" : "No loan records found"}
                  </p>
                  <p className="m-0 mt-1 text-sm text-slate-500">
                    {archiveView ? "Archived loan records will appear here." : "Proceed with a record or adjust the filters."}
                  </p>
                </div>
              )}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {sortedRecords.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1}
              {" "}to {Math.min(safePage * rowsPerPage, sortedRecords.length)} of {sortedRecords.length} records
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        title={editingRecord ? "Edit Loan Record" : "Loan records"}
        onClose={closeForm}
        maxWidth="max-w-4xl"
        footer={(
          <>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="loanRequestForm" loading={saving}>
              {editingRecord ? "Save Changes" : "Proceed"}
            </Button>
          </>
        )}
      >
        <form id="loanRequestForm" className="grid gap-4" onSubmit={handleSubmit}>
          {canFileForOthers ? (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Employee *</label>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={selectedEmployee}
                selectedEmployees={editingRecord ? [] : selectedEmployees}
                multiple={!editingRecord}
                onSelect={handleEmployeeSelect}
                onClear={clearSelectedEmployees}
                placeholder={employeeLoading ? "Loading employees..." : "Search employee..."}
                disabled={employeeLoading || employeeOptions.length === 0}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              This loan record will be filed under your employee profile.
            </div>
          )}

          {canFileForOthers && selectedEmployees.length ? (
            <div className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
              {selectedEmployees.map((employee) => (
                <div key={employee.employeeRecordId} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="m-0 text-sm font-semibold text-slate-900">{employee.employeeName || "N/A"}</p>
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    {[employee.employeeId, employee.division, employee.designation].filter(Boolean).join(" / ") || "No details available"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Loan Type Amounts *</span>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LOAN_TYPES.map((type) => (
                <InputField
                  key={type}
                  id={`loanAmount-${loanTypeColumnKey(type)}`}
                  label={type}
                  name={`loanAmount-${loanTypeColumnKey(type)}`}
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={form.loanAmounts?.[type] || ""}
                  onChange={updateLoanAmount(type)}
                  placeholder="0.00"
                />
              ))}
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(viewingRecord)}
        title="Loan Record"
        onClose={() => setViewingRecord(null)}
        maxWidth="max-w-4xl"
        footer={(
          <Button variant="secondary" onClick={() => setViewingRecord(null)}>Close</Button>
        )}
      >
        {viewingRecord ? (
          <div className="space-y-4">
            {viewLoading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                Loading loan record details...
              </div>
            ) : null}

            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-sm font-semibold text-slate-500">Loan ID</dt>
                <dd className="m-0 mt-1 font-semibold text-slate-950">{loanId(viewingRecord)}</dd>
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
              <div className="sm:col-span-2">
                <dt className="text-sm font-semibold text-slate-500">Loan Amounts</dt>
                <dd className="m-0 mt-2">
                  {recordLoanAmountEntries(viewingRecord).length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {recordLoanAmountEntries(viewingRecord).map((entry) => (
                        <div key={entry.loanType} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="text-sm font-semibold text-slate-700">{entry.loanType}</span>
                          <span className="text-sm font-bold text-slate-950">{formatCurrency(entry.loanAmount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-500">N/A</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">Total Loan Amount</dt>
                <dd className="m-0 mt-1 font-semibold text-slate-950">{formatCurrency(recordLoanTotal(viewingRecord))}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Modal>

    </section>
  );
}
