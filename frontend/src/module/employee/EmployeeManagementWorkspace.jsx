import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import {
  Archive,
  BarChart3,
  Download,
  FileText,
  Plus,
  RotateCcw,
  Search,
  Upload,
  Users,
} from "lucide-react";
import {
  faBoxArchive,
  faClockRotateLeft,
  faEye as faEyeAction,
  faPen,
} from "@fortawesome/free-solid-svg-icons";
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
  deleteEmployee,
  getArchivedUsers,
  getEmployeeOptions,
  getArchivedEmployees,
  getEmployees,
  getUsers,
  importEmployeesCsv,
  restoreEmployee,
  updateEmployee,
  updateEmployeeProfileImage,
} from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { showEmployeeCredentialsAlert } from "../../utils/employeeAccountAlert";
import { consumeEmployeeProfileHandoff, findEmployeeFromProfileHandoff } from "../../utils/employeeProfileHandoff";
import {
  getManagedRoleOptions,
  getRoleBadgeClass,
  getRoleLabel,
  normalizeStatus,
  resolveUserRoleKey,
} from "../../utils/roleRoutes";
import { numberFormatter } from "../../utils/format";
import { buildNextEmployeeId } from "../../utils/employeeIds";
import EmployeeReportsAnalytics from "./EmployeeReportsAnalytics";

const DEFAULT_EMPLOYEE_ROWS_PER_PAGE = 10;
const EMPLOYEE_MANAGEMENT_FORM_ID = "employee-management-form";

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
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

/**
 * The employee fields that appear on CS Form No. 1 and therefore open a new service period. The
 * designation is not one of them: it is an assignment on top of the position, not an appointment.
 */
const SERVICE_RECORD_FIELDS = [
  { key: "designationId", label: "Position" },
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
  user,
  allowAccountCreation = false,
}) {
  /* HR Head and HR Staff share the employee-management desk and its complete action set. */
  const userRoleKey = resolveUserRoleKey(user);
  const canManageEmployees = ["admin", "hrhead", "hrstaff"].includes(userRoleKey);
  const canArchiveEmployees = ["admin", "hrhead", "hrstaff"].includes(userRoleKey);
  const [employees, setEmployees] = useState([]);
  const [archivedEmployees, setArchivedEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [archivedUsers, setArchivedUsers] = useState([]);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeDivisionFilter, setEmployeeDivisionFilter] = useState("");
  const [employeeDesignationFilter, setEmployeeDesignationFilter] = useState("");
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState("");
  const [employeeRowsPerPage, setEmployeeRowsPerPage] = useState(DEFAULT_EMPLOYEE_ROWS_PER_PAGE);
  const [employeeCurrentPage, setEmployeeCurrentPage] = useState(1);
  const [employeeArchiveView, setEmployeeArchiveView] = useState("active");
  const [workspaceTab, setWorkspaceTab] = useState("employees");
  const [employeeOptions, setEmployeeOptions] = useState({
    divisions: [],
    designations: [],
    accountStatuses: [],
    roles: [],
    emailDomainPolicy: {},
  });
  const [employeeError, setEmployeeError] = useState("");
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const [employeeImporting, setEmployeeImporting] = useState(false);
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeViewOpen, setEmployeeViewOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const employeeImportInputRef = useRef(null);

  const loadEmployees = useCallback(async ({ background = false } = {}) => {
    setEmployeeLoading(!background);

    try {
      const [employeesResult, archivedEmployeesResult, optionsResult, usersResult, archivedUsersResult] = await Promise.all([
        getEmployees(),
        canArchiveEmployees ? getArchivedEmployees() : Promise.resolve({ employees: [] }),
        getEmployeeOptions(),
        getUsers(),
        canArchiveEmployees ? getArchivedUsers() : Promise.resolve({ users: [] }),
      ]);

      setEmployees(employeesResult.employees || []);
      setArchivedEmployees(archivedEmployeesResult.employees || []);
      setUsers(usersResult.users || []);
      setArchivedUsers(archivedUsersResult.users || []);
      setEmployeeOptions({
        divisions: optionsResult.divisions || [],
        designations: optionsResult.designations || [],
        designationSuggestions: optionsResult.designationSuggestions || [],
        accountStatuses: optionsResult.accountStatuses || [],
        /*
         * HR Head and HR Staff must not be able to hand out an Admin account, so the role
         * choices come from the shared managed-role list, which covers the assignable
         * built-ins plus any custom roles and leaves Admin out.
         */
        roles: getManagedRoleOptions(usersResult.roles || []),
        emailDomainPolicy: optionsResult.emailDomainPolicy || {},
      });
      setEmployeeError("");
    } catch (error) {
      if (!background) {
        setEmployeeError(error.response?.data?.message || "Unable to load employee records.");
      }
    } finally {
      setEmployeeLoading(false);
    }
  }, [canArchiveEmployees]);

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

  const allUserByEmail = useMemo(() => {
    const nextMap = new Map();

    [...archivedUsers, ...users].forEach((item) => {
      const emailKey = String(item?.email || "").trim().toLowerCase();

      if (emailKey) {
        nextMap.set(emailKey, item);
      }
    });

    return nextMap;
  }, [archivedUsers, users]);

  const employeeFormInitialValues = useMemo(() => {
    if (!editingEmployee) {
      return null;
    }

    const linkedUser = userByEmail.get(String(editingEmployee.email || "").trim().toLowerCase());

    return {
      ...editingEmployee,
      roleId: linkedUser?.roleId ? String(linkedUser.roleId) : "",
    };
  }, [editingEmployee, userByEmail]);

  /* The values users.status accepts, as employee.php reports them. */
  const employeeStatusOptions = useMemo(
    () => (employeeOptions.accountStatuses || []).map((status) => String(status || "").trim()).filter(Boolean),
    [employeeOptions.accountStatuses]
  );

  /*
   * Every employee record is listed whatever role its account holds -- a Chief, HR Head, or
   * Regional Director created from User Management lands here the same as an Employee, with the
   * Role column telling them apart. Filtering the roster by account role also made it depend on
   * the users list, which a desk without the users permission never receives.
   */
  const visibleEmployees = employeeArchiveView === "archive" ? archivedEmployees : employees;
  const filteredEmployees = useMemo(() => {
    const search = employeeQuery.trim().toLowerCase();

    return visibleEmployees.filter((employee) => {
      const emailKey = String(employee.email || "").trim().toLowerCase();
      const linkedUser = userByEmail.get(emailKey);
      const statusLabel = getEmployeeCardStatus(employee, linkedUser, employeeArchiveView);
      const matchesSearch = !search || [
        employee.employeeId,
        employee.fullName,
        employee.department,
        employee.position,
        employee.designation,
        getRoleLabel(allUserByEmail.get(emailKey)?.role),
        linkedUser?.status,
        statusLabel,
        employee.basicSalary,
        employee.dateHired,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesDivision = !employeeDivisionFilter || employee.department === employeeDivisionFilter;
      const matchesDesignation = !employeeDesignationFilter || employee.position === employeeDesignationFilter;
      const matchesStatus = !employeeStatusFilter || statusLabel === employeeStatusFilter;

      return matchesSearch && matchesDivision && matchesDesignation && matchesStatus;
    });
  }, [employeeArchiveView, employeeDesignationFilter, employeeDivisionFilter, employeeQuery, employeeStatusFilter, allUserByEmail, userByEmail, visibleEmployees]);

  useEffect(() => {
    setEmployeeCurrentPage(1);
  }, [employeeArchiveView, employeeDesignationFilter, employeeDivisionFilter, employeeQuery, employeeRowsPerPage, employeeStatusFilter]);

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
  /* Positions from the position catalog only -- not titles picked off the rows. */
  const employeeDesignationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (employeeOptions.designations || [])
            .map((designation) => String(designation.name || "").trim())
            .filter(Boolean)
        )
      ).sort(),
    [employeeOptions.designations]
  );
  const activeEmployeeCount = useMemo(
    () =>
      employees.filter((employee) => {
        const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
        return normalizeStatus(linkedUser?.status || employee.status || "Inactive") === "active";
      }).length,
    [employees, userByEmail]
  );
  const inactiveEmployeeCount = Math.max(0, employees.length - activeEmployeeCount)
    + archivedEmployees.length;
  const nextEmployeeId = useMemo(
    () => buildNextEmployeeId([...employees, ...archivedEmployees]),
    [archivedEmployees, employees]
  );
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

  const handleExportEmployees = () => {
    const fileDate = new Date().toISOString().slice(0, 10);
    const exportLabel = employeeArchiveView === "archive" ? "archived-employees" : "employees";
    const rows = [
      ["Employee ID", "Full Name", "Email", "Phone", "Division", "Position", "Designation", "Role", "Status", "Date Hired", "Salary Rate", "Basic Salary"],
      ...filteredEmployees.map((employee) => {
        const linkedUser = userByEmail.get(String(employee.email || "").trim().toLowerCase());
        const statusLabel = getEmployeeCardStatus(employee, linkedUser, employeeArchiveView);

        return [
          employee.employeeId || "",
          employee.fullName || "",
          employee.email || "",
          employee.phone || "",
          employee.department || "",
          employee.position || "",
          employee.designation || "",
          getRoleLabel(allUserByEmail.get(String(employee.email || "").trim().toLowerCase())?.role),
          statusLabel,
          formatEmployeeDateValue(employee.dateHired),
          employee.salaryRate || "",
          formatEmployeeCurrencyValue(employee.basicSalary),
        ];
      }),
    ];

    downloadCsv(`${exportLabel}-${fileDate}.csv`, rows);
  };

  const refreshEmployeeRecords = async () => {
    const [employeesResult, archivedEmployeesResult, usersResult, archivedUsersResult] = await Promise.all([
      getEmployees(),
      getArchivedEmployees(),
      getUsers(),
      getArchivedUsers(),
    ]);

    setEmployees(employeesResult.employees || []);
    setArchivedEmployees(archivedEmployeesResult.employees || []);
    setUsers(usersResult.users || []);
    setArchivedUsers(archivedUsersResult.users || []);
  };

  const importEmployeeFile = async (file) => {
    if (!file) {
      toast.error("Choose a CSV or Excel workbook to import.");
      return;
    }

    setEmployeeImporting(true);
    setEmployeeError("");
    const toastId = toast.loading("Importing employee records...", { duration: Infinity });

    try {
      const result = await importEmployeesCsv(file);
      try {
        await refreshEmployeeRecords();
      } catch (refreshError) {
        const refreshWarning = refreshError.response?.data?.message
          || refreshError.message
          || "Employee records were imported, but the list could not refresh automatically.";
        setEmployeeError(refreshWarning);
      }

      const createdCount = Number(result.summary?.created ?? result.imported ?? 0);
      const activationQueued = Number(result.summary?.activationEmailsQueued ?? result.activationEmails?.queued ?? 0);
      const activationSent = Number(result.summary?.activationEmailsSent ?? result.activationEmails?.sent ?? 0);
      const activationFailed = Number(result.summary?.activationEmailsFailed ?? result.activationEmails?.failed ?? 0);
      toast.dismiss(toastId);

      if (createdCount > 0) {
        if (activationFailed > 0) {
          setEmployeeError(
            `${activationFailed} activation email${activationFailed === 1 ? "" : "s"} could not be sent. Reissue those credentials from the employee record.`
          );
        }

        await Swal.fire({
          title: "Import Successful!",
          text: activationFailed > 0
            ? `The employee file has been imported. ${activationSent} activation email${activationSent === 1 ? "" : "s"} sent, ${activationFailed} failed - reissue those credentials from the employee record.`
            : activationQueued > 0
              ? `The employee file has been imported successfully. ${activationQueued} activation email${activationQueued === 1 ? " is" : "s are"} queued for background delivery.`
              : `The employee file has been imported successfully. ${activationSent} activation email${activationSent === 1 ? "" : "s"} sent.`,
          icon: activationFailed > 0 ? "warning" : "success",
          confirmButtonText: "Done",
          confirmButtonColor: "#0f766e",
        });
      } else {
        const message = result.errors?.[0]
          || result.message
          || "No employees were imported. Review the file rows and try again.";
        setEmployeeError(message);
        await Swal.fire({
          title: "Import Failed",
          text: "The employee file could not be imported. Please check the file format and try again.",
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
        text: "The employee file could not be imported. Please check the file format and try again.",
        icon: "error",
        confirmButtonText: "Done",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setEmployeeImporting(false);
    }
  };

  const handleEmployeeImportFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (!file) {
      return;
    }

    const isEmployeeImportFile = /\.(csv|xlsx)$/i.test(file.name)
      || [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ].includes(file.type);

    if (!isEmployeeImportFile) {
      toast.error("Choose a CSV or XLSX employee file.");
      return;
    }

    importEmployeeFile(file);
  };

  const handleOpenImportEmployees = () => {
    employeeImportInputRef.current?.click();
  };

  const handleDownloadEmployeeTemplate = () => {
    const link = document.createElement("a");
    link.href = `${process.env.PUBLIC_URL || ""}/templates/HRIS-employees.xlsx`;
    link.download = "HRIS-employees.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  /*
   * Mirrors the Employee Directory columns on the admin dashboard so HR Head and HR Staff read
   * the same table. The status cell stays a plain badge here: this workspace never receives the
   * account-status handler the admin screen owns, so there is nothing to toggle.
   */
  const employeeColumns = [
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
      key: "department",
      header: "Division",
      render: (row) => <span className="text-slate-700">{row.department || "N/A"}</span>,
    },
    {
      key: "position",
      header: "Position",
      cardRole: "subtitle",
      render: (row) => (
        <span className="text-slate-700">
          {row.position || "N/A"}
          {row.designation ? <span className="block text-xs text-slate-500">{row.designation}</span> : null}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      cardRole: "badge",
      render: (row) => {
        const linkedUser = allUserByEmail.get(String(row.email || "").trim().toLowerCase());
        const roleLabel = getRoleLabel(linkedUser?.role);

        return (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${getRoleBadgeClass(linkedUser?.role)}`}>
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
        const statusLabel = getEmployeeCardStatus(row, linkedUser, employeeArchiveView);

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
      render: (row) => {
        const isArchived = employeeArchiveView === "archive";

        return (
          <div className="flex items-center gap-2">
            <ActionIconButton
              label={`View ${row.fullName || row.employeeId || "employee"}`}
              icon={faEyeAction}
              tone="view"
              onClick={() => openEmployeeViewer(row)}
            />
            {isArchived && canArchiveEmployees ? (
              <ActionIconButton
                label={`Restore ${row.fullName || row.employeeId || "employee"}`}
                icon={faClockRotateLeft}
                tone="approve"
                text="Restore"
                onClick={() => handleRestoreEmployee(row)}
              />
            ) : null}
            {!isArchived && canManageEmployees ? (
              <ActionIconButton
                label={`Edit ${row.fullName || row.employeeId || "employee"}`}
                icon={faPen}
                tone="edit"
                onClick={() => openEmployeeEditor(row)}
              />
            ) : null}
            {!isArchived && canArchiveEmployees ? (
              <ActionIconButton
                label={`Archive ${row.fullName || row.employeeId || "employee"}`}
                icon={faBoxArchive}
                tone="archive"
                onClick={() => handleArchiveEmployee(row)}
              />
            ) : null}
          </div>
        );
      },
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
      const savePayload = {
        ...employeePayload,
        // Creating an employee also creates the linked login account. Ask the API to issue the
        // temporary password and deliver it, matching the Admin employee-directory workflow.
        sendActivationEmail: !isEditingEmployee,
      };
      const result = isEditingEmployee
        ? await updateEmployee(editingEmployee.id, savePayload)
        : await createEmployee(savePayload);
      let savedEmployee = result.employee;
      let profileImageWarning = "";
      const emailNotification = result.emailNotification || "";
      const emailMessage = result.emailMessage || "";
      const linkedUser = result.linkedUser || null;

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

      if (linkedUser?.id) {
        const previousEmailKey = String(editingEmployee?.email || "").trim().toLowerCase();
        const linkedEmailKey = String(linkedUser.email || "").trim().toLowerCase();

        setUsers((current) => {
          const matchesLinkedAccount = (item) => {
            const itemEmailKey = String(item.email || "").trim().toLowerCase();
            return item.id === linkedUser.id
              || (previousEmailKey && itemEmailKey === previousEmailKey)
              || (linkedEmailKey && itemEmailKey === linkedEmailKey);
          };

          return current.some(matchesLinkedAccount)
            ? current.map((item) => (matchesLinkedAccount(item) ? linkedUser : item))
            : [linkedUser, ...current];
        });
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
      const emailWarning = emailNotification === "warning"
        ? (emailMessage || "Activation email could not be sent.")
        : "";
      const saveWarnings = [profileImageWarning, emailWarning].filter(Boolean);

      if (saveWarnings.length > 0) {
        const message = `Employee saved, but ${saveWarnings.join(" ")}`;
        setEmployeeError(message);
        toast.error(message);
      } else {
        toast.success([
          isEditingEmployee ? "Employee edited successfully." : "Employee created successfully.",
          !isEditingEmployee && emailNotification === "sent"
            ? (emailMessage || "Activation email sent to the employee.")
            : "",
        ].filter(Boolean).join(" "));
      }

      if (!isEditingEmployee) {
        await showEmployeeCredentialsAlert({
          employee: savedEmployee,
          linkedUser: result.linkedUser,
          temporaryPassword: result.temporaryPassword,
          emailNotification,
          emailMessage,
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

  const handleArchiveEmployee = async (employee) => {
    const employeeName = employee.fullName || employee.employeeId || "this employee";
    const confirmation = await Swal.fire({
      title: "Archive employee?",
      text: `Move ${employeeName} to the employee archive?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, archive",
      cancelButtonText: "Keep employee",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      Swal.fire({
        title: "Archiving...",
        text: "Please wait while the employee is archived.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await deleteEmployee(employee.id);
      setEmployees((current) => current.filter((item) => item.id !== employee.id));
      setArchivedEmployees((current) => (
        current.some((item) => item.id === employee.id) ? current : [employee, ...current]
      ));
      setEmployeeError("");
      closeEmployeeViewer();
      await Swal.fire({
        title: "Archived",
        text: result.message || "Employee archived successfully.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to archive employee.";
      setEmployeeError(message);
      await Swal.fire({
        title: "Archive failed",
        text: message,
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  const handleRestoreEmployee = async (employee) => {
    const employeeName = employee.fullName || employee.employeeId || "this employee";
    const confirmation = await Swal.fire({
      title: "Restore employee?",
      text: `Move ${employeeName} back to the employees table?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes, restore",
      cancelButtonText: "Keep archived",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      Swal.fire({
        title: "Restoring...",
        text: "Please wait while the employee is restored.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await restoreEmployee(employee.id);
      const restoredEmployee = result.employee || employee;
      setArchivedEmployees((current) => current.filter((item) => item.id !== employee.id));
      setEmployees((current) => (
        current.some((item) => item.id === restoredEmployee.id)
          ? current
          : [restoredEmployee, ...current]
      ));
      setEmployeeError("");
      closeEmployeeViewer();
      await Swal.fire({
        title: "Restored",
        text: result.message || "Employee restored successfully.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to restore employee.";
      setEmployeeError(message);
      await Swal.fire({
        title: "Restore failed",
        text: message,
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Employee management sections"
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
      >
        <button
          id="employee-management-employees-tab"
          type="button"
          role="tab"
          aria-selected={workspaceTab === "employees"}
          aria-controls="employee-management-employees-panel"
          onClick={() => setWorkspaceTab("employees")}
          className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition ${
            workspaceTab === "employees"
              ? "bg-[#D61E1E] text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <Users size={16} aria-hidden="true" />
          Employee List
        </button>
        <button
          id="employee-management-analytics-tab"
          type="button"
          role="tab"
          aria-selected={workspaceTab === "analytics"}
          aria-controls="employee-management-analytics-panel"
          onClick={() => setWorkspaceTab("analytics")}
          className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition ${
            workspaceTab === "analytics"
              ? "bg-[#D61E1E] text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <BarChart3 size={16} aria-hidden="true" />
          Analytics
        </button>
      </div>

      {workspaceTab === "employees" ? (
        <div
          id="employee-management-employees-panel"
          role="tabpanel"
          aria-labelledby="employee-management-employees-tab"
          className="mt-4"
        >
          <Card className="w-full">
        <CardHeader className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div>
              <CardTitle className="text-lg">
                {employeeArchiveView === "archive" ? "Archived Employees" : "Employees"}
              </CardTitle>
              <CardDescription>
                {employeeArchiveView === "archive"
                  ? "Review employee records that have been moved to archive."
                  : "Manage employee records, accounts, and workforce information."}
              </CardDescription>
            </div>
            <p className="m-0 text-sm text-slate-500">
              {employeeArchiveView === "archive"
                ? `${numberFormatter.format(archivedEmployees.length)} archived employee${archivedEmployees.length === 1 ? "" : "s"}`
                : `${numberFormatter.format(activeEmployeeCount)} active employee${activeEmployeeCount === 1 ? "" : "s"} • ${numberFormatter.format(inactiveEmployeeCount)} inactive`}
            </p>
            {employeeError ? (
              <p className="m-0 text-sm font-semibold text-rose-700">{employeeError}</p>
            ) : null}
          </div>

          {canManageEmployees ? (
            <div className="flex flex-wrap items-center gap-3">
              {canArchiveEmployees ? (
                <>
                  <Button
                    variant="secondary"
                    icon={FileText}
                    onClick={handleDownloadEmployeeTemplate}
                  >
                    Download Template
                  </Button>
                  <Button
                    variant="secondary"
                    icon={Upload}
                    onClick={handleOpenImportEmployees}
                    loading={employeeImporting}
                    disabled={employeeImporting}
                  >
                    Import
                  </Button>
                  <input
                    ref={employeeImportInputRef}
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={handleEmployeeImportFileChange}
                    disabled={employeeImporting}
                  />
                  <Button variant="secondary" icon={Download} onClick={handleExportEmployees}>
                    Export
                  </Button>
                </>
              ) : null}
              {canArchiveEmployees ? (
                <Button
                  variant="secondary"
                  icon={employeeArchiveView === "archive" ? Users : Archive}
                  onClick={() => {
                    setEmployeeArchiveView((view) => (view === "archive" ? "active" : "archive"));
                    setEmployeeStatusFilter("");
                    setEmployeeCurrentPage(1);
                  }}
                >
                  {employeeArchiveView === "archive" ? "Back to Employees" : "Archive"}
                </Button>
              ) : null}
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
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,220px)_150px_180px_130px_110px]">
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
              <label htmlFor="employeeDesignationFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Position
              </label>
              <select
                id="employeeDesignationFilter"
                value={employeeDesignationFilter}
                onChange={(event) => {
                  setEmployeeDesignationFilter(event.target.value);
                }}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none"
              >
                <option value="">All positions</option>
                {employeeDesignationOptions.map((designation) => (
                  <option key={designation} value={designation}>{designation}</option>
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
                {[10, 20, 50, 100, 200].map((value) => (
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
                emptyMessage={
                  employeeArchiveView === "archive"
                    ? "No archived employee records found."
                    : "No employee records found. Try adjusting your search or filters."
                }
                tableClassName="min-w-[1100px]"
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
        </div>
      ) : (
        <div
          id="employee-management-analytics-panel"
          role="tabpanel"
          aria-labelledby="employee-management-analytics-tab"
          className="mt-4"
        >
          <EmployeeReportsAnalytics employees={employees} loading={employeeLoading} />
        </div>
      )}

      <Modal
        open={employeeModalOpen}
        title={editingEmployee ? "Edit Employee" : "Add New Employee"}
        maxWidth="max-w-[1120px]"
        onClose={closeEmployeeModal}
        footer={(
          <>
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
          initialValues={employeeFormInitialValues}
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
          <div className="flex flex-wrap items-center justify-end gap-3">
            <EmployeeDocumentDownloadButtons
              open={employeeViewOpen && Boolean(viewingEmployee)}
              employee={viewingEmployee}
            />
            {viewingEmployee && canArchiveEmployees ? (
              employeeArchiveView === "archive" ? (
                <Button
                  variant="secondary"
                  icon={RotateCcw}
                  onClick={() => handleRestoreEmployee(viewingEmployee)}
                >
                  Restore
                </Button>
              ) : null
            ) : null}
          </div>
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
              <div><dt className="text-sm font-semibold text-slate-500">Designation</dt><dd className="m-0 text-slate-900">{viewingEmployee.designation || "None"}</dd></div>
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
