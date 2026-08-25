import React, { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import {
  Plus,
  Search,
} from "lucide-react";
import { faEye as faEyeAction, faPen } from "@fortawesome/free-solid-svg-icons";
import {
  employeeStatusBadgeClass,
  formatEmployeeCurrencyValue,
  formatEmployeeDateValue,
  getEmployeeCardStatus,
  resolveEmployeeInitials,
} from "../../components/employee/AdminEmployeeCard";
import { EmployeeDocumentDownloadButtons } from "../../components/employee/EmployeeDocumentsModal";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import CreateEmployee from "../../page/Admin/create_employee";
import {
  createEmployee,
  getEmployeeOptions,
  getEmployees,
  getUsers,
  updateEmployee,
  updateEmployeeProfileImage,
} from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { showEmployeeCredentialsAlert } from "../../utils/employeeAccountAlert";
import { consumeEmployeeProfileHandoff, findEmployeeFromProfileHandoff } from "../../utils/employeeProfileHandoff";
import { getManagedRoleOptions, getRoleBadgeClass, getRoleLabel, normalizeStatus } from "../../utils/roleRoutes";
import { numberFormatter } from "../../utils/format";

const DEFAULT_EMPLOYEE_ROWS_PER_PAGE = 10;
const EMPLOYEE_MANAGEMENT_FORM_ID = "employee-management-form";
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
        /*
         * HR Head and HR Staff must not be able to hand out an Admin account, so the role
         * choices come from the shared managed-role list, which covers the assignable
         * built-ins plus any custom roles and leaves Admin out.
         */
        roles: getManagedRoleOptions(usersResult.roles || []),
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

  const closeEmployeeViewer = () => {
    setEmployeeViewOpen(false);
    setViewingEmployee(null);
  };

  const openEmployeeEditor = (employee) => {
    setEditingEmployee(employee);
    setEmployeeModalOpen(true);
  };

  /*
   * Mirrors the Employee Directory columns on the admin dashboard so HR Head and HR Staff read
   * the same table. The status cell stays a plain badge here: this workspace never receives the
   * account-status handler the admin screen owns, so there is nothing to toggle.
   */
  const employeeColumns = [
    {
      key: "index",
      header: "#",
      card: false,
      render: (_row, index) => (
        <span className="font-medium text-slate-700">
          {(safeEmployeeCurrentPage - 1) * safeEmployeeRowsPerPage + index + 1}
        </span>
      ),
    },
    {
      key: "employeeId",
      header: "Employee ID",
      cardRole: "eyebrow",
      render: (row) => (
        <span className="font-semibold text-slate-900">{row.employeeId || "N/A"}</span>
      ),
    },
    {
      key: "fullName",
      header: "Full Name",
      cardRole: "title",
      render: (row) => {
        const avatarUrl = resolveBackendAssetUrl(row.profileImage);

        return (
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-bold text-slate-500">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={row.fullName || "Employee"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{resolveEmployeeInitials(row)}</span>
              )}
            </div>
            <strong className="font-semibold text-slate-900">{row.fullName || "N/A"}</strong>
          </div>
        );
      },
    },
    {
      key: "email",
      header: "Email",
      render: (row) => <span className="text-slate-700">{row.email || "N/A"}</span>,
    },
    {
      key: "phone",
      header: "Phone",
      render: (row) => <span className="text-slate-700">{row.phone || "N/A"}</span>,
    },
    {
      key: "department",
      header: "Division",
      render: (row) => <span className="text-slate-700">{row.department || "N/A"}</span>,
    },
    {
      key: "position",
      header: "Designation",
      cardRole: "subtitle",
      render: (row) => <span className="text-slate-700">{row.position || "N/A"}</span>,
    },
    {
      key: "role",
      header: "Role",
      cardRole: "badge",
      render: (row) => {
        const linkedUser = userByEmail.get(String(row.email || "").trim().toLowerCase());
        const roleLabel = linkedUser?.role ? getRoleLabel(linkedUser.role) : "Employee";

        return (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${getRoleBadgeClass(roleLabel)}`}>
            {roleLabel}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const linkedUser = userByEmail.get(String(row.email || "").trim().toLowerCase());
        const statusLabel = getEmployeeCardStatus(row, linkedUser);

        return (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${employeeStatusBadgeClass(statusLabel)}`}>
            {statusLabel}
          </span>
        );
      },
    },
    {
      key: "dateHired",
      header: "Date Hired",
      render: (row) => <span className="text-slate-700">{formatEmployeeDateValue(row.dateHired)}</span>,
    },
    {
      key: "salary",
      header: "Salary",
      render: (row) => (
        <strong className="font-semibold text-slate-900">{formatEmployeeCurrencyValue(row.basicSalary)}</strong>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (row) => (
        <div className="flex items-center gap-2">
          <ActionIconButton
            label={`View ${row.fullName || row.employeeId || "employee"}`}
            icon={faEyeAction}
            tone="view"
            onClick={() => openEmployeeViewer(row)}
          />
          <ActionIconButton
            label={`Edit ${row.fullName || row.employeeId || "employee"}`}
            icon={faPen}
            tone="edit"
            onClick={() => openEmployeeEditor(row)}
          />
        </div>
      ),
    },
  ];

  const closeEmployeeModal = () => {
    setEmployeeModalOpen(false);
    setEditingEmployee(null);
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

      if (!isEditingEmployee) {
        await showEmployeeCredentialsAlert({
          employee: savedEmployee,
          linkedUser: result.linkedUser,
          temporaryPassword: result.temporaryPassword,
          emailNotification: result.emailNotification,
          emailMessage: result.emailMessage,
        });
      }
    } catch (error) {
      const message = error.response?.data?.message || "Unable to save employee.";
      setEmployeeError(message);
      toast.error(message);
    } finally {
      setEmployeeSaving(false);
    }
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div>
              <CardTitle className="text-lg">Employees</CardTitle>
              <CardDescription>
                Manage employee records, accounts, and workforce information.
              </CardDescription>
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

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,220px)_150px_130px_110px] sm:items-end">
            <InputField
              label="Search Employees"
              name="employeeSearch"
              value={employeeQuery}
              onChange={(event) => {
                setEmployeeQuery(event.target.value);
              }}
              placeholder="Search by name, ID, or email"
              icon={Search}
              aria-label="Search employees"
            />
            <div>
              <label htmlFor="employeeDivisionFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Division
              </label>
              <select
                id="employeeDivisionFilter"
                value={employeeDivisionFilter}
                onChange={(event) => {
                  setEmployeeDivisionFilter(event.target.value);
                }}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
              >
                <option value="">All divisions</option>
                {employeeDivisionOptions.map((division) => (
                  <option key={division} value={division}>{division}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="employeeStatusFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Status
              </label>
              <select
                id="employeeStatusFilter"
                value={employeeStatusFilter}
                onChange={(event) => {
                  setEmployeeStatusFilter(event.target.value);
                }}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
              >
                <option value="">All statuses</option>
                {employeeStatusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="employeeRowsPerPage" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Rows Per Page
              </label>
              <select
                id="employeeRowsPerPage"
                value={employeeRowsPerPage}
                onChange={(event) => {
                  setEmployeeRowsPerPage(Number(event.target.value) || DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
                }}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
              >
                {[5, 10, 15, 20, 25, 50].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
          <div className="lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200">
            <div className="lg:overflow-x-auto">
              <Table
                columns={employeeColumns}
                data={employeeCards}
                loading={employeeLoading}
                emptyMessage="No employee records found. Try adjusting your search or filters."
                tableClassName="min-w-[1400px]"
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Showing {numberFormatter.format(employeeStartIndex)}
              -{numberFormatter.format(employeeEndIndex)} of {numberFormatter.format(filteredEmployees.length)}
            </p>
            <Pagination
              currentPage={safeEmployeeCurrentPage}
              totalPages={employeeTotalPages}
              onPageChange={setEmployeeCurrentPage}
            />
          </div>
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
        open={employeeViewOpen}
        title="Employee Details"
        maxWidth="max-w-[880px]"
        onClose={closeEmployeeViewer}
        footer={(
          <>
            <EmployeeDocumentDownloadButtons
              open={employeeViewOpen && Boolean(viewingEmployee)}
              employee={viewingEmployee}
            />
            <Button variant="primary" onClick={closeEmployeeViewer}>
              Close
            </Button>
          </>
        )}
      >
        {viewingEmployee ? (
          <div className="space-y-5">
            <div className="flex justify-center">
              <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-lg font-bold text-slate-500 shadow-sm">
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
