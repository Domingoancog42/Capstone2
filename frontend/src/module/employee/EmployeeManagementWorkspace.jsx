import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import AdminEmployeeCard, {
  getEmployeeCardStatus,
  resolveEmployeeInitials,
} from "../../components/employee/AdminEmployeeCard";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import CreateEmployee from "../../page/Admin/create_employee";
import {
  createEmployee,
  getEmployeeOptions,
  getEmployees,
  getUsers,
  importEmployeesCsv,
  updateEmployee,
  updateEmployeeProfileImage,
} from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { consumeEmployeeProfileHandoff, findEmployeeFromProfileHandoff } from "../../utils/employeeProfileHandoff";
import { getRoleLabel, normalizeRole, normalizeStatus } from "../../utils/roleRoutes";
import { numberFormatter } from "../../utils/format";

const DEFAULT_EMPLOYEE_ROWS_PER_PAGE = 10;
const EMPLOYEE_MANAGEMENT_FORM_ID = "employee-management-form";
const EMPLOYEE_IMPORT_INPUT_ID = "employee-import-csv-input";
const EMPLOYEE_IMPORT_TEMPLATE_URL = `${process.env.PUBLIC_URL || ""}/templates/dummy-employees-300.csv`;
function buildNextEmployeeId(employees) {
  const year = new Date().getFullYear();
  const prefix = `EMP${year}-`;
  const maxNumber = employees.reduce((max, employee) => {
    const employeeId = String(employee.employeeId || "");

    if (!employeeId.startsWith(prefix)) {
      return max;
    }

    const numericPart = Number.parseInt(employeeId.slice(prefix.length), 10);
    return Number.isNaN(numericPart) ? max : Math.max(max, numericPart);
  }, 0);

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

const employeeIdCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareEmployeesByEmployeeId(firstEmployee, secondEmployee) {
  const firstEmployeeId = String(firstEmployee?.employeeId || "").trim();
  const secondEmployeeId = String(secondEmployee?.employeeId || "").trim();

  if (firstEmployeeId && secondEmployeeId) {
    return employeeIdCollator.compare(firstEmployeeId, secondEmployeeId);
  }

  if (firstEmployeeId) {
    return -1;
  }

  if (secondEmployeeId) {
    return 1;
  }

  return Number(firstEmployee?.id || 0) - Number(secondEmployee?.id || 0);
}

/** The employee fields that appear on CS Form No. 1 and therefore open a new service period. */
const SERVICE_RECORD_FIELDS = [
  { key: "designationId", label: "Designation" },
  { key: "basicSalary", label: "Salary" },
  { key: "employmentStatus", label: "Employment status" },
  { key: "divisionId", label: "Division" },
];

function serviceRecordFieldChanges(previous, next) {
  return SERVICE_RECORD_FIELDS.filter(({ key }) => {
    const before = String(previous?.[key] ?? "").trim();
    const after = String(next?.[key] ?? "").trim();

    if (before !== "" && after !== "" && !Number.isNaN(Number(before)) && !Number.isNaN(Number(after))) {
      return Math.abs(Number(before) - Number(after)) > 0.001;
    }

    return before !== after;
  }).map(({ label }) => label);
}

/**
 * Asks when an appointment change took effect, and whether it is a change or a correction.
 *
 * The date an edit is saved is not the date the appointment changed — HR records promotions late and
 * fixes typos in old figures. Stamping "today" on both would put fictitious promotions on a document
 * that gets certified and issued, so the operator is asked once, and only when one of the four
 * CS Form No. 1 fields actually moved.
 *
 * Returns the fields to merge into the payload, or null if the operator cancelled.
 */
async function requestServiceRecordChange(previousEmployee, nextEmployee) {
  const changes = serviceRecordFieldChanges(previousEmployee, nextEmployee);

  if (!changes.length) {
    return {};
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = await Swal.fire({
    title: "Record this on the service record?",
    icon: "question",
    html: `
      <p style="margin:0 0 12px;font-size:14px;color:#475569;text-align:left;">
        ${changes.join(", ")} changed. This appears on the employee's service record, so it needs an
        effective date.
      </p>
      <label style="display:block;text-align:left;font-size:13px;font-weight:600;color:#334155;margin-bottom:4px;">
        Effective date
      </label>
      <input id="serviceEffectiveDate" type="date" value="${today}" max="${today}"
        class="swal2-input" style="margin:0 0 14px;width:100%;" />
      <label style="display:block;text-align:left;font-size:13px;font-weight:600;color:#334155;margin-bottom:4px;">
        Reference / remarks (optional)
      </label>
      <input id="serviceChangeRemarks" type="text" placeholder="Appointment or order number"
        class="swal2-input" style="margin:0;width:100%;" />
    `,
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: "New appointment",
    denyButtonText: "Correction",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#D61E1E",
    denyButtonColor: "#475569",
    footer:
      '<span style="font-size:12px;color:#64748b;">“New appointment” closes the current period and opens a new one. “Correction” amends the current period in place.</span>',
    preConfirm: () => ({
      serviceEffectiveDate: document.getElementById("serviceEffectiveDate")?.value || today,
      serviceChangeRemarks: document.getElementById("serviceChangeRemarks")?.value || "",
      serviceChangeMode: "change",
    }),
    preDeny: () => ({
      serviceEffectiveDate: document.getElementById("serviceEffectiveDate")?.value || today,
      serviceChangeRemarks: document.getElementById("serviceChangeRemarks")?.value || "",
      serviceChangeMode: "correction",
    }),
  });

  if (result.isConfirmed) {
    return result.value;
  }

  if (result.isDenied) {
    return result.value;
  }

  return null;
}

export default function EmployeeManagementWorkspace({
  allowAccountCreation = false,
}) {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeDivisionFilter, setEmployeeDivisionFilter] = useState("");
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState("");
  const [employeeRowsPerPage, setEmployeeRowsPerPage] = useState(DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
  const [employeeCurrentPage, setEmployeeCurrentPage] = useState(1);
  const [employeeOptions, setEmployeeOptions] = useState({ divisions: [], designations: [], roles: [] });
  const [employeeError, setEmployeeError] = useState("");
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeViewOpen, setEmployeeViewOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const [employeeImportOpen, setEmployeeImportOpen] = useState(false);
  const [employeeImportFile, setEmployeeImportFile] = useState(null);
  const [employeeImporting, setEmployeeImporting] = useState(false);
  const [employeeImportResult, setEmployeeImportResult] = useState(null);
  const employeeImportInputRef = useRef(null);

  const loadEmployees = useCallback(async ({ background = false } = {}) => {
    setEmployeeLoading(!background);

    try {
      const [employeesResult, optionsResult, usersResult] = await Promise.all([
        getEmployees(),
        getEmployeeOptions(),
        getUsers(),
      ]);

      setEmployees(employeesResult.employees || []);
      setUsers(usersResult.users || []);
      setEmployeeOptions({
        divisions: optionsResult.divisions || [],
        designations: optionsResult.designations || [],
        roles: (usersResult.roles || []).map((role) => ({
          ...role,
          key: normalizeRole(role.name),
          label: getRoleLabel(role.name),
        })),
      });
      setEmployeeError("");
    } catch (error) {
      if (!background) {
        setEmployeeError(error.response?.data?.message || "Unable to load employee records.");
      }
    } finally {
      setEmployeeLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadEmployees, { topics: ["employee", "service_record"] });

  useEffect(() => {
    if (employeeLoading || employees.length === 0) {
      return;
    }

    const target = consumeEmployeeProfileHandoff();
    const matchedEmployee = findEmployeeFromProfileHandoff(employees, target);

    if (!matchedEmployee) {
      return;
    }

    setViewingEmployee(matchedEmployee);
    setEmployeeViewOpen(true);
  }, [employeeLoading, employees]);

  const userByEmail = useMemo(() => {
    const nextMap = new Map();

    users.forEach((item) => {
      const emailKey = String(item?.email || "").trim().toLowerCase();

      if (emailKey) {
        nextMap.set(emailKey, item);
      }
    });

    return nextMap;
  }, [users]);

  const employeeStatusOptions = useMemo(() => ["Active", "Inactive"], []);

  const filteredEmployees = useMemo(() => {
    const search = employeeQuery.trim().toLowerCase();

    return employees.filter((employee) => {
      const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
      const statusLabel = getEmployeeCardStatus(employee, linkedUser);
      const matchesSearch = !search || [
        employee.employeeId,
        employee.fullName,
        employee.department,
        employee.position,
        linkedUser?.role,
        linkedUser?.status,
        statusLabel,
        employee.basicSalary,
        employee.dateHired,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesDivision = !employeeDivisionFilter || employee.department === employeeDivisionFilter;
      const matchesStatus = !employeeStatusFilter || statusLabel === employeeStatusFilter;

      return matchesSearch && matchesDivision && matchesStatus;
    });
  }, [employeeDivisionFilter, employeeQuery, employeeStatusFilter, employees, userByEmail]);

  useEffect(() => {
    setEmployeeCurrentPage(1);
  }, [employeeDivisionFilter, employeeQuery, employeeRowsPerPage, employeeStatusFilter]);

  const employeeDivisionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (employeeOptions.divisions || [])
            .map((division) => String(division.name || division.code || "").trim())
            .filter(Boolean)
        )
      ).sort(),
    [employeeOptions.divisions]
  );

  const activeEmployeeCount = useMemo(
    () =>
      employees.filter((employee) => {
        const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
        return normalizeStatus(linkedUser?.status || employee.status || "Inactive") === "active";
      }).length,
    [employees, userByEmail]
  );
  const inactiveEmployeeCount = Math.max(0, employees.length - activeEmployeeCount);
  const nextEmployeeId = useMemo(() => buildNextEmployeeId(employees), [employees]);
  const sortedFilteredEmployees = useMemo(
    () => [...filteredEmployees].sort(compareEmployeesByEmployeeId),
    [filteredEmployees]
  );
  const safeEmployeeRowsPerPage = Math.max(1, employeeRowsPerPage);
  const employeeTotalPages = Math.max(1, Math.ceil(filteredEmployees.length / safeEmployeeRowsPerPage));
  const safeEmployeeCurrentPage = Math.min(employeeCurrentPage, employeeTotalPages);
  const employeeStartIndex = filteredEmployees.length === 0
    ? 0
    : (safeEmployeeCurrentPage - 1) * safeEmployeeRowsPerPage + 1;
  const employeeEndIndex = Math.min(
    safeEmployeeCurrentPage * safeEmployeeRowsPerPage,
    filteredEmployees.length
  );
  const employeeCards = useMemo(
    () => {
      const startIndex = (safeEmployeeCurrentPage - 1) * safeEmployeeRowsPerPage;
      return sortedFilteredEmployees.slice(startIndex, startIndex + safeEmployeeRowsPerPage);
    },
    [safeEmployeeCurrentPage, safeEmployeeRowsPerPage, sortedFilteredEmployees]
  );

  useEffect(() => {
    if (employeeCurrentPage > employeeTotalPages) {
      setEmployeeCurrentPage(employeeTotalPages);
    }
  }, [employeeCurrentPage, employeeTotalPages]);

  const openEmployeeViewer = (employee) => {
    setViewingEmployee(employee);
    setEmployeeViewOpen(true);
  };

  const openEmployeeEditor = (employee) => {
    setEditingEmployee(employee);
    setEmployeeModalOpen(true);
  };

  const closeEmployeeModal = () => {
    setEmployeeModalOpen(false);
    setEditingEmployee(null);
  };

  const refreshEmployeeRecords = async () => {
    const [employeesResult, usersResult] = await Promise.all([
      getEmployees(),
      getUsers(),
    ]);

    setEmployees(employeesResult.employees || []);
    setUsers(usersResult.users || []);
  };

  const handleSaveEmployee = async (employeeData) => {
    const {
      profileImageDataUrl = "",
      removeProfileImage = false,
      ...employeePayload
    } = employeeData;
    const isEditingEmployee = Boolean(editingEmployee);

    if (isEditingEmployee) {
      const serviceChange = await requestServiceRecordChange(editingEmployee, employeePayload);

      if (serviceChange === null) {
        return;
      }

      Object.assign(employeePayload, serviceChange);
    }

    setEmployeeSaving(true);
    setEmployeeError("");

    try {
      const result = isEditingEmployee
        ? await updateEmployee(editingEmployee.id, employeePayload)
        : await createEmployee(employeePayload);
      let savedEmployee = result.employee;
      let profileImageWarning = "";

      if (savedEmployee?.id && (profileImageDataUrl || removeProfileImage)) {
        try {
          const imageResult = await updateEmployeeProfileImage(savedEmployee.id, profileImageDataUrl);
          savedEmployee = imageResult.employee || savedEmployee;
        } catch (imageError) {
          profileImageWarning =
            imageError.response?.data?.message
            || imageError.message
            || "Unable to save the profile image.";
        }
      }

      setEmployees((current) => {
        if (isEditingEmployee) {
          return current.map((employee) => (
            employee.id === savedEmployee.id ? savedEmployee : employee
          ));
        }

        return [savedEmployee, ...current];
      });
      if (!isEditingEmployee) {
        setEmployeeCurrentPage(1);
      }

      closeEmployeeModal();
      if (profileImageWarning) {
        const message = `Employee saved, but ${profileImageWarning}`;
        setEmployeeError(message);
        toast.error(message);
      } else {
        toast.success(isEditingEmployee ? "Employee edited successfully." : "Employee created successfully.");
      }
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save employee.";
      setEmployeeError(message);
      toast.error(message);
    } finally {
      setEmployeeSaving(false);
    }
  };

  const openEmployeeImport = () => {
    setEmployeeImportOpen(true);
    setEmployeeImportResult(null);
  };

  const closeEmployeeImport = () => {
    if (employeeImporting) {
      return;
    }

    setEmployeeImportOpen(false);
    setEmployeeImportFile(null);
    setEmployeeImportResult(null);

    if (employeeImportInputRef.current) {
      employeeImportInputRef.current.value = "";
    }
  };

  const handleEmployeeImportFileChange = (event) => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      return;
    }

    const isCsv = /\.csv$/i.test(file.name) || ["text/csv", "application/vnd.ms-excel", "application/csv"].includes(file.type);
    if (!isCsv) {
      setEmployeeImportFile(null);
      setEmployeeImportResult(null);
      event.target.value = "";
      toast.error("Choose a valid CSV file.");
      return;
    }

    setEmployeeImportFile(file);
    setEmployeeImportResult(null);
  };

  const handleEmployeeImport = async () => {
    if (!employeeImportFile) {
      toast.error("Choose a CSV file to import.");
      return;
    }

    setEmployeeImporting(true);
    setEmployeeError("");
    const toastId = toast.loading("Importing employee records...", { duration: Infinity });

    try {
      const result = await importEmployeesCsv(employeeImportFile);
      let refreshWarning = "";
      try {
        await refreshEmployeeRecords();
      } catch (refreshError) {
        refreshWarning =
          refreshError.response?.data?.message
          || refreshError.message
          || "Employee records were imported, but the list could not refresh automatically.";
        setEmployeeError(refreshWarning);
      }
      setEmployeeImportResult(result);
      setEmployeeImportFile(null);
      if (employeeImportInputRef.current) {
        employeeImportInputRef.current.value = "";
      }
      const createdCount = Number(result.summary?.created ?? result.imported ?? 0);
      toast.dismiss(toastId);
      if (createdCount > 0) {
        await Swal.fire({
          title: "Import Successful!",
          text: "The employee CSV file has been imported successfully.",
          icon: "success",
          confirmButtonText: "Done",
          confirmButtonColor: "#0f766e",
        });
      } else {
        const message = result.errors?.[0] || result.message || "No employees were imported. Review the CSV rows and try again.";
        setEmployeeError(message);
        await Swal.fire({
          title: "Import Failed",
          text: "The employee CSV file could not be imported. Please check the file format and try again.",
          icon: "error",
          confirmButtonText: "Done",
          confirmButtonColor: "#dc2626",
        });
      }
    } catch (error) {
      const message = error.code === "ECONNABORTED"
        ? "The import is taking longer than expected. Check the employee list in a moment before importing the same file again."
        : error.response?.data?.message || "Unable to import employee records.";
      setEmployeeError(message);
      toast.dismiss(toastId);
      await Swal.fire({
        title: "Import Failed",
        text: "The employee CSV file could not be imported. Please check the file format and try again.",
        icon: "error",
        confirmButtonText: "Done",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setEmployeeImporting(false);
    }
  };

  const employeeImportSummary = employeeImportResult?.summary || null;

  return (
    <>
      <Card className="w-full overflow-hidden !border-0 !bg-transparent !shadow-none">
        <CardHeader className="flex flex-col gap-5 !border-b-0 bg-transparent lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div>
              <CardTitle className="text-2xl">Employees</CardTitle>
            </div>
            <p className="m-0 text-sm text-slate-500">
              {`${numberFormatter.format(activeEmployeeCount)} active employee${activeEmployeeCount === 1 ? "" : "s"} • ${numberFormatter.format(inactiveEmployeeCount)} inactive`}
            </p>
            {employeeError ? (
              <p className="m-0 text-sm font-semibold text-rose-700">{employeeError}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              icon={Upload}
              onClick={openEmployeeImport}
              loading={employeeImporting}
              disabled={employeeImporting}
            >
              Import CSV
            </Button>
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setEditingEmployee(null);
                setEmployeeModalOpen(true);
              }}
            >
              Add Employee
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 bg-transparent p-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-[220px] shrink-0">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <label htmlFor="employeeSearch" className="sr-only">
                Search employees
              </label>
              <input
                id="employeeSearch"
                name="employeeSearch"
                type="search"
                value={employeeQuery}
                onChange={(event) => {
                  setEmployeeQuery(event.target.value);
                }}
                placeholder="Search"
                aria-label="Search employees"
                className="h-[42px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              />
            </div>
            <div className="relative w-full min-w-[150px] max-w-[180px] shrink-0">
              <label htmlFor="employeeDivisionFilter" className="sr-only">
                Division
              </label>
              <select
                id="employeeDivisionFilter"
                value={employeeDivisionFilter}
                onChange={(event) => {
                  setEmployeeDivisionFilter(event.target.value);
                }}
                className="h-[42px] w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              >
                <option value="">All divisions</option>
                {employeeDivisionOptions.map((division) => (
                  <option key={division} value={division}>{division}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            </div>
            <div className="relative w-full min-w-[140px] max-w-[170px] shrink-0">
              <label htmlFor="employeeStatusFilter" className="sr-only">
                Status
              </label>
              <select
                id="employeeStatusFilter"
                value={employeeStatusFilter}
                onChange={(event) => {
                  setEmployeeStatusFilter(event.target.value);
                }}
                className="h-[42px] w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              >
                <option value="">All statuses</option>
                {employeeStatusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            </div>
            <div className="relative w-full min-w-[140px] max-w-[160px] shrink-0">
              <label htmlFor="employeeRowsPerPage" className="sr-only">
                Rows Per Page
              </label>
              <input
                id="employeeRowsPerPage"
                name="employeeRowsPerPage"
                type="number"
                min="1"
                step="1"
                value={employeeRowsPerPage}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setEmployeeRowsPerPage(Number.isFinite(nextValue) && nextValue > 0
                    ? nextValue
                    : DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
                }}
                placeholder="10"
                list="employeeRowsPerPagePresets"
                aria-label="Rows per page"
                className="h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              />
            </div>
          </div>
          <datalist id="employeeRowsPerPagePresets">
            {[5, 10, 15, 20, 25, 50].map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>

          <p className="m-0 text-sm text-slate-500">
            {employeeLoading
              ? "Loading employee records..."
              : filteredEmployees.length === 0
                ? "No matching employees to display."
                : `Displaying ${numberFormatter.format(employeeStartIndex)}-${numberFormatter.format(employeeEndIndex)} of ${numberFormatter.format(filteredEmployees.length)} matching employee${filteredEmployees.length === 1 ? "" : "s"}.`}
          </p>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {!employeeLoading && employeeCards.length === 0 ? (
              <div className="md:col-span-2 xl:col-span-3 2xl:col-span-4">
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
                  <p className="m-0 text-lg font-semibold text-slate-900">
                    No employee records found.
                  </p>
                  <p className="m-0 mt-2 text-sm text-slate-500">
                    Try adjusting your search or filters, or add a new employee record.
                  </p>
                </div>
              </div>
            ) : employeeCards.map((employee) => {
              const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());

              return (
                <AdminEmployeeCard
                  key={employee.id}
                  employee={employee}
                  linkedUser={linkedUser}
                  onView={openEmployeeViewer}
                  onEdit={openEmployeeEditor}
                />
              );
            })}
          </div>

          {!employeeLoading ? (
            <Pagination
              currentPage={safeEmployeeCurrentPage}
              totalPages={employeeTotalPages}
              onPageChange={setEmployeeCurrentPage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={employeeModalOpen}
        title={editingEmployee ? "Edit Employee" : "Add New Employee"}
        maxWidth="max-w-[1120px]"
        onClose={closeEmployeeModal}
        footer={(
          <>
            <Button variant="ghost" onClick={closeEmployeeModal} disabled={employeeSaving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={EMPLOYEE_MANAGEMENT_FORM_ID}
              disabled={employeeSaving}
            >
              {employeeSaving ? "Saving..." : editingEmployee ? "Save Changes" : "Create Employee"}
            </Button>
          </>
        )}
      >
        <CreateEmployee
          formId={EMPLOYEE_MANAGEMENT_FORM_ID}
          initialValues={editingEmployee}
          options={employeeOptions}
          nextEmployeeId={nextEmployeeId}
          onCancel={closeEmployeeModal}
          onSubmit={handleSaveEmployee}
          submitLabel={employeeSaving ? "Saving..." : editingEmployee ? "Save Changes" : "Create Employee"}
          showActions={false}
          submitting={employeeSaving}
        />
      </Modal>

      <Modal
        open={employeeImportOpen}
        title="Import Employees"
        maxWidth="max-w-[640px]"
        onClose={closeEmployeeImport}
        footer={(
          <>
            <Button variant="ghost" onClick={closeEmployeeImport} disabled={employeeImporting}>
              Close
            </Button>
            <Button
              variant="primary"
              icon={FileSpreadsheet}
              onClick={handleEmployeeImport}
              loading={employeeImporting}
              disabled={!employeeImportFile || employeeImporting}
            >
              Import
            </Button>
          </>
        )}
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="m-0 font-semibold text-slate-900">CSV employee import</p>
            <p className="m-0 mt-1">
              Imported employees receive matching user accounts with email as username and temporary password <strong>123</strong>.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={EMPLOYEE_IMPORT_INPUT_ID} className="text-sm font-semibold text-slate-700">
              CSV file
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                ref={employeeImportInputRef}
                id={EMPLOYEE_IMPORT_INPUT_ID}
                type="file"
                accept=".csv,text/csv,application/vnd.ms-excel"
                onChange={handleEmployeeImportFileChange}
                disabled={employeeImporting}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 focus:border-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/10"
              />
              <a
                href={EMPLOYEE_IMPORT_TEMPLATE_URL}
                download
                className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg border border-[#F8BFBF] bg-white px-4 text-sm font-semibold text-[#D61E1E] no-underline transition hover:border-[#F18E8E] hover:bg-[#FEF1F1]"
              >
                <Download size={18} aria-hidden="true" />
                <span>Template</span>
              </a>
            </div>
            {employeeImportFile ? (
              <p className="m-0 text-sm text-slate-500">
                Selected: <span className="font-medium text-slate-700">{employeeImportFile.name}</span>
              </p>
            ) : null}
          </div>

          {employeeImportSummary ? (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="m-0 text-sm font-semibold text-emerald-900">
                {employeeImportResult.message || "Import completed."}
              </p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-emerald-700">Rows processed</dt>
                  <dd className="m-0 text-lg font-semibold text-emerald-950">{numberFormatter.format(employeeImportSummary.totalRows || 0)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-emerald-700">Employees created</dt>
                  <dd className="m-0 text-lg font-semibold text-emerald-950">{numberFormatter.format(employeeImportSummary.created || 0)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-emerald-700">User accounts</dt>
                  <dd className="m-0 text-lg font-semibold text-emerald-950">{numberFormatter.format(employeeImportSummary.userAccountsCreated || employeeImportResult.userAccountsCreated || 0)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-emerald-700">Skipped / invalid</dt>
                  <dd className="m-0 text-lg font-semibold text-emerald-950">
                    {numberFormatter.format((employeeImportSummary.duplicatesSkipped || 0) + (employeeImportSummary.invalidRows || 0))}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          {Array.isArray(employeeImportResult?.errors) && employeeImportResult.errors.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="m-0 text-sm font-semibold text-amber-900">Rows needing review</p>
              <ul className="m-0 mt-2 max-h-40 space-y-1 overflow-y-auto pl-5 text-sm text-amber-900">
                {employeeImportResult.errors.slice(0, 8).map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={employeeViewOpen}
        title="Employee Details"
        maxWidth="max-w-[880px]"
        onClose={() => {
          setEmployeeViewOpen(false);
          setViewingEmployee(null);
        }}
        footer={(
          <Button
            variant="primary"
            onClick={() => {
              setEmployeeViewOpen(false);
              setViewingEmployee(null);
            }}
          >
            Close
          </Button>
        )}
      >
        {viewingEmployee ? (
          <div className="space-y-5">
            <div className="flex justify-center">
              <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-2xl font-bold text-slate-500 shadow-sm">
                {resolveBackendAssetUrl(viewingEmployee.profileImage) ? (
                  <img
                    src={resolveBackendAssetUrl(viewingEmployee.profileImage)}
                    alt={viewingEmployee.fullName || "Employee profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{resolveEmployeeInitials(viewingEmployee)}</span>
                )}
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-sm font-semibold text-slate-500">Employee ID</dt><dd className="m-0 text-slate-900">{viewingEmployee.employeeId || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Full Name</dt><dd className="m-0 text-slate-900">{viewingEmployee.fullName || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Email</dt><dd className="m-0 text-slate-900">{viewingEmployee.email || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Phone</dt><dd className="m-0 text-slate-900">{viewingEmployee.phone || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Division</dt><dd className="m-0 text-slate-900">{viewingEmployee.department || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Position</dt><dd className="m-0 text-slate-900">{viewingEmployee.position || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Status</dt><dd className="m-0 text-slate-900">{viewingEmployee.status || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Employment Status</dt><dd className="m-0 text-slate-900">{viewingEmployee.employmentStatus || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Date of Birth</dt><dd className="m-0 text-slate-900">{viewingEmployee.dateOfBirth || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Date Hired</dt><dd className="m-0 text-slate-900">{viewingEmployee.dateHired || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Salary Rate</dt><dd className="m-0 text-slate-900">{viewingEmployee.salaryRate || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Basic Salary</dt><dd className="m-0 text-slate-900">{viewingEmployee.basicSalary || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Address</dt><dd className="m-0 text-slate-900">{viewingEmployee.address || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">City</dt><dd className="m-0 text-slate-900">{viewingEmployee.city || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Province</dt><dd className="m-0 text-slate-900">{viewingEmployee.province || "N/A"}</dd></div>
              <div><dt className="text-sm font-semibold text-slate-500">Zip Code</dt><dd className="m-0 text-slate-900">{viewingEmployee.zipCode || "N/A"}</dd></div>
            </dl>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
