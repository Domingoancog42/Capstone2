import React, { useCallback, useEffect, useMemo, useState } from "react";
import { faEye, faFileImport, faPlus } from "@fortawesome/free-solid-svg-icons";
import {
  Printer,
  Download,
  Search,
  ScrollText,
  UsersRound,
} from "lucide-react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ProfileFloatingCard from "../../components/profile/ProfileFloatingCard";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { SettingsNotice, SettingsSelect } from "../../components/settings";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  archiveServiceRecordEntry,
  createServiceRecordEntry,
  fetchServiceRecord,
  getEmployees,
  updateServiceRecordEntry,
} from "../../services/api";
import { resolveUserRoleKey } from "../../utils/roleRoutes";
import ServiceRecordTable from "./ServiceRecordTable";
import ServiceRecordImportModal from "./ServiceRecordImportModal";
import { formatServiceDate, printServiceRecord } from "./serviceRecordUtils";
import { SALARY_GRADE_OPTIONS, SALARY_SCHEDULE, getStepOptions, lookupSalary } from "./salarySchedule";
import { useOrganizationFilterOptions } from "../../hooks/useFilterOptions";

const EMPTY_FORM = {
  id: null,
  serviceFrom: "",
  serviceTo: "",
  // A blank end date is what the record stores for an open period, but the form needs the intent
  // spelled out — otherwise "not filled in yet" and "still in force" look identical.
  serviceToPresent: true,
  designationTitle: "",
  employmentStatus: "",
  stClassification: "",
  monthlySalary: "",
  // Shown beside the monthly rate and kept at twelve times it; only the monthly rate is saved.
  annualSalary: "",
  salaryGrade: "",
  stepIncrement: "",
  station: "",
  branch: "Mines and Geosciences Bureau",
  separationDate: "",
  separationCause: "",
  remarks: "",
};

/**
 * Salary / annum is twelve times the monthly rate, the figure the printed form's salary column
 * shows. The record stores only the monthly rate, so a typed annual amount is saved as its twelfth,
 * to the centavo. Both return "" for a blank or unreadable amount.
 */
function annualFromMonthly(monthly) {
  const amount = Number(monthly);

  return String(monthly ?? "").trim() !== "" && Number.isFinite(amount)
    ? String(Math.round(amount * 1200) / 100)
    : "";
}

function monthlyFromAnnual(annual) {
  const amount = Number(annual);

  return String(annual ?? "").trim() !== "" && Number.isFinite(amount)
    ? String(Math.round((amount * 100) / 12) / 100)
    : "";
}

function formFromRecord(record) {
  return {
    id: record.id,
    serviceFrom: record.serviceFrom || "",
    serviceTo: record.serviceTo || "",
    serviceToPresent: !record.serviceTo,
    designationTitle: record.designationTitle || "",
    employmentStatus: record.employmentStatus || "",
    stClassification: record.stClassification || "",
    monthlySalary: record.monthlySalary ?? "",
    annualSalary: annualFromMonthly(record.monthlySalary),
    salaryGrade: record.salaryGrade || "",
    stepIncrement: record.stepIncrement || "",
    station: record.station || "",
    branch: record.branch || "Mines and Geosciences Bureau",
    separationDate: record.separationDate || "",
    separationCause: record.separationCause || "",
    remarks: record.remarks || "",
  };
}

const EMPLOYEES_PER_PAGE = 10;

/*
 * Who sees only their own division's employees in the directory. HR Staff, Admin, and the HR Head
 * work organization-wide. Mirrors
 * SERVICE_RECORD_DIVISION_SCOPED_ROLES in service_record.php, which refuses reads and writes
 * outside that division on the API.
 */
const DIVISION_SCOPED_SERVICE_RECORD_ROLE_KEYS = new Set(["chief", "planningofficer", "regionaldirector"]);

function directoryOptionFromEmployee(row) {
  return {
    employeeRecordId: row.id,
    employeeId: row.employeeId,
    employeeName: row.fullName
      || [row.firstName, row.middleName, row.lastName, row.suffix].filter(Boolean).join(" "),
    division: row.department || row.division || "",
    position: row.position || "",
    employmentStatus: row.employmentStatus || "",
    dateHired: row.dateHired || "",
    status: row.status || "",
  };
}

function employeeInitials(name) {
  return String(name || "Employee")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function requiredFieldLabel(label) {
  return (
    <>
      {label}
      <span className="app-required-marker ml-0.5 font-bold !text-[#D61E1E]" aria-hidden="true">*</span>
    </>
  );
}

/**
 * Service Record (CSC Form No. 1).
 *
 * `mode="employee"` shows the signed-in user their own record with no editing; `mode="manage"` adds
 * the employee picker and the add/edit controls. Same component either way so the two views cannot
 * present the record differently.
 *
 * Printing is generated in the browser from the service-record response and does not persist a
 * separate request or approval record.
 */
export default function ServiceRecordWorkspace({ user, mode = "manage" }) {
  const isManageMode = mode === "manage";
  const isDivisionScoped = DIVISION_SCOPED_SERVICE_RECORD_ROLE_KEYS.has(resolveUserRoleKey(user));
  const scopedDivision = isDivisionScoped ? String(user?.division || user?.department || "").trim() : "";

  const [employeeDirectory, setEmployeeDirectory] = useState([]);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeDivisionFilter, setEmployeeDivisionFilter] = useState("");
  const [employeeCurrentPage, setEmployeeCurrentPage] = useState(1);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [records, setRecords] = useState([]);
  const [employmentStatuses, setEmploymentStatuses] = useState([]);
  const [stClassifications, setStClassifications] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [certifier, setCertifier] = useState(null);
  const [employeeListLoading, setEmployeeListLoading] = useState(isManageMode);
  const [loading, setLoading] = useState(!isManageMode);
  const [error, setError] = useState("");
  const [recordViewerOpen, setRecordViewerOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [importEmployee, setImportEmployee] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const loadRecord = useCallback(async (employeeRecordId, { background = false } = {}) => {
    setLoading(!background);

    try {
      const result = await fetchServiceRecord(employeeRecordId);

      setEmployee(result?.employee || null);
      setRecords(Array.isArray(result?.records) ? result.records : []);
      setEmploymentStatuses(Array.isArray(result?.employmentStatuses) ? result.employmentStatuses : []);
      setStClassifications(Array.isArray(result?.stClassifications) ? result.stClassifications : []);
      setCanManage(Boolean(result?.canManage));
      setCertifier(result?.certifier || null);
      setError("");
      return result;
    } catch (requestError) {
      // A failed background poll keeps the record on screen instead of replacing it with an error.
      if (!background) {
        setEmployee(null);
        setRecords([]);
        setError(requestError.response?.data?.message || "Unable to load the service record.");
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEmployees = useCallback(async ({ background = false } = {}) => {
    setEmployeeListLoading(!background);

    try {
      const result = await getEmployees();
      const options = (Array.isArray(result?.employees) ? result.employees : [])
        .map(directoryOptionFromEmployee);

      setEmployeeDirectory(options);
      setError("");
      return options;
    } catch (requestError) {
      if (!background) {
        setEmployeeDirectory([]);
        setError(requestError.response?.data?.message || "Unable to load employee records.");
      }
      return [];
    } finally {
      setEmployeeListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isManageMode) {
      void loadEmployees();
    } else {
      void loadRecord(null);
    }
  }, [isManageMode, loadEmployees, loadRecord]);

  /*
   * `refreshOnMount: false` because the effects above already own the first load and every reload
   * caused by switching employees. This only adds the reload nobody on this screen triggered — a
   * service record edited by someone else or an employment status changed from Employee Management.
   */
  useAutoRefreshOnChange(
    useCallback(
      ({ background }) => {
        if (!isManageMode) {
          return loadRecord(null, { background });
        }

        const requests = [loadEmployees({ background })];

        if (selectedEmployeeId) {
          requests.push(loadRecord(selectedEmployeeId, { background }));
        }

        return Promise.all(requests);
      },
      [isManageMode, loadEmployees, loadRecord, selectedEmployeeId]
    ),
    { topics: ["service_record", "employee"], refreshOnMount: false }
  );

  // The directory a scoped desk works from is its own division only; an HR Staff account with no
  // division on its employee profile gets an empty list rather than everyone's.
  const employeeOptions = useMemo(() => {
    if (!isDivisionScoped) {
      return employeeDirectory;
    }

    const target = scopedDivision.toLowerCase();

    return target
      ? employeeDirectory.filter((option) => String(option.division || "").trim().toLowerCase() === target)
      : [];
  }, [employeeDirectory, isDivisionScoped, scopedDivision]);

  const selectedOption = useMemo(
    () => employeeOptions.find(
      (option) => String(option.employeeRecordId) === String(selectedEmployeeId)
    ) || null,
    [employeeOptions, selectedEmployeeId]
  );

  const filteredEmployees = useMemo(() => {
    const query = employeeQuery.trim().toLowerCase();

    return employeeOptions.filter((option) => {
      const matchesQuery = !query || [
        option.employeeName,
        option.employeeId,
        option.division,
        option.position,
        option.employmentStatus,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
      const matchesDivision = !employeeDivisionFilter
        || String(option.division).toLowerCase() === employeeDivisionFilter.toLowerCase();

      return matchesQuery && matchesDivision;
    });
  }, [employeeDivisionFilter, employeeOptions, employeeQuery]);

  /* The division table, not the divisions found on the loaded employee list. */
  const { divisions: employeeDivisionOptions } = useOrganizationFilterOptions();

  const employeeTotalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEES_PER_PAGE));
  const safeEmployeeCurrentPage = Math.min(employeeCurrentPage, employeeTotalPages);
  const visibleEmployees = useMemo(() => {
    const start = (safeEmployeeCurrentPage - 1) * EMPLOYEES_PER_PAGE;
    return filteredEmployees.slice(start, start + EMPLOYEES_PER_PAGE);
  }, [filteredEmployees, safeEmployeeCurrentPage]);
  const employeeStart = filteredEmployees.length
    ? (safeEmployeeCurrentPage - 1) * EMPLOYEES_PER_PAGE + 1
    : 0;
  const employeeEnd = Math.min(safeEmployeeCurrentPage * EMPLOYEES_PER_PAGE, filteredEmployees.length);

  useEffect(() => {
    setEmployeeCurrentPage(1);
  }, [employeeDivisionFilter, employeeQuery]);

  useEffect(() => {
    if (employeeCurrentPage > employeeTotalPages) {
      setEmployeeCurrentPage(employeeTotalPages);
    }
  }, [employeeCurrentPage, employeeTotalPages]);

  const editable = isManageMode && canManage && Boolean(employee);

  const updateField = (field) => (event) => {
    const { value } = event.target;

    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: "" }));
  };

  /**
   * "Present" marks the period as still in force, which the record stores as no end date.
   *
   * The typed date is kept in state rather than cleared, so toggling Present on and back off
   * returns the date the user already entered instead of making them look it up again.
   */
  const toggleServiceToPresent = () => {
    setForm((current) => ({ ...current, serviceToPresent: !current.serviceToPresent }));
    setFormErrors((current) => ({ ...current, serviceTo: "" }));
  };

  /**
   * When Salary Grade or Step changes, auto-fill the monthly salary from the
   * Salary Standardization Law schedule so the user doesn't have to look it up.
   */
  const handleSalaryGradeChange = (event) => {
    const grade = event.target.value;

    setForm((current) => {
      const step = current.stepIncrement;
      const salary = lookupSalary(grade, step);

      // If the currently selected step doesn't exist for the new grade, reset it.
      const row = SALARY_SCHEDULE[Number(grade)];
      const stepIdx = Number(step) - 1;
      const stepValid = row && stepIdx >= 0 && stepIdx < row.length && row[stepIdx] !== null;
      const monthlySalary = salary != null ? String(salary) : (stepValid ? current.monthlySalary : "");

      return {
        ...current,
        salaryGrade: grade,
        stepIncrement: stepValid ? step : "",
        monthlySalary,
        annualSalary: annualFromMonthly(monthlySalary),
      };
    });
    setFormErrors((current) => ({ ...current, salaryGrade: "" }));
  };

  const handleStepChange = (event) => {
    const step = event.target.value;

    setForm((current) => {
      const salary = lookupSalary(current.salaryGrade, step);
      const monthlySalary = salary != null ? String(salary) : current.monthlySalary;

      return {
        ...current,
        stepIncrement: step,
        monthlySalary,
        annualSalary: annualFromMonthly(monthlySalary),
      };
    });
    setFormErrors((current) => ({ ...current, stepIncrement: "" }));
  };

  /** The two salary fields move together: typing in either one fills in the other. */
  const handleMonthlySalaryChange = (event) => {
    const { value } = event.target;

    setForm((current) => ({ ...current, monthlySalary: value, annualSalary: annualFromMonthly(value) }));
    setFormErrors((current) => ({ ...current, monthlySalary: "" }));
  };

  const handleAnnualSalaryChange = (event) => {
    const { value } = event.target;

    setForm((current) => ({ ...current, annualSalary: value, monthlySalary: monthlyFromAnnual(value) }));
    setFormErrors((current) => ({ ...current, monthlySalary: "" }));
  };

  /*
   * Leaving the annual field shows what will print: twelve times the monthly rate that gets saved.
   * That only differs from what was typed when the amount does not split into whole centavos a month.
   */
  const settleAnnualSalary = () => {
    setForm((current) => ({ ...current, annualSalary: annualFromMonthly(current.monthlySalary) }));
  };

  /** Step options react to the selected salary grade (e.g. grade 33 only has steps 1–2). */
  const stepOptions = useMemo(() => getStepOptions(form.salaryGrade), [form.salaryGrade]);

  const prepareNewEntryForm = (targetEmployee) => {
    setForm({
      ...EMPTY_FORM,
      // Pre-fill from the employee's current record so HR is confirming rather than retyping.
      designationTitle: targetEmployee?.designationTitle || "",
      employmentStatus: targetEmployee?.employmentStatus || "",
      station: targetEmployee?.station || "",
      monthlySalary: targetEmployee?.basicSalary ?? "",
      annualSalary: annualFromMonthly(targetEmployee?.basicSalary),
    });
  };

  const openAddModal = async (option = null) => {
    prepareNewEntryForm(null);
    setFormErrors({});

    if (!option?.employeeRecordId) {
      setSelectedEmployeeId(null);
      setEmployee(null);
      setRecords([]);
      setModalOpen(true);
      return;
    }

    setSelectedEmployeeId(option.employeeRecordId);

    if (String(employee?.id) === String(option.employeeRecordId)) {
      prepareNewEntryForm(employee);
      setModalOpen(true);
      return;
    }

    setEmployee(null);
    setRecords([]);
    const result = await loadRecord(option.employeeRecordId);

    if (!result?.employee) {
      return;
    }

    if (!result.canManage) {
      toast.error("You do not have permission to add service record entries.");
      return;
    }

    prepareNewEntryForm(result.employee);
    setModalOpen(true);
  };

  const openImportModal = async (option) => {
    setSelectedEmployeeId(option.employeeRecordId);
    const result = await loadRecord(option.employeeRecordId);
    if (!result?.employee) return;
    if (!result.canManage) {
      toast.error("You do not have permission to import service records.");
      return;
    }
    setImportEmployee(result.employee);
  };

  const openEmployeeRecord = async (option) => {
    if (!option?.employeeRecordId) {
      return;
    }

    setSelectedEmployeeId(option.employeeRecordId);
    setEmployee(null);
    setRecords([]);
    setRecordViewerOpen(true);
    await loadRecord(option.employeeRecordId);
  };

  const closeEmployeeRecord = () => {
    setRecordViewerOpen(false);
    setSelectedEmployeeId(null);
    setEmployee(null);
    setRecords([]);
    setError("");
  };

  const openEditModal = (record) => {
    setRecordViewerOpen(false);
    setForm(formFromRecord(record));
    setFormErrors({});
    setModalOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!employee) {
      toast.error("Choose an employee from the table before adding an entry.");
      return;
    }

    setSaving(true);

    try {
      const { serviceToPresent, annualSalary, ...fields } = form;
      const payload = {
        ...fields,
        // An open period is sent as no end date; the parked value stays in the form only.
        serviceTo: serviceToPresent ? "" : fields.serviceTo,
        employeeRecordId: employee.id,
      };
      const result = form.id
        ? await updateServiceRecordEntry(payload)
        : await createServiceRecordEntry(payload);

      setRecords(Array.isArray(result?.records) ? result.records : []);
      setModalOpen(false);
      setFormErrors({});
      toast.success(result?.message || "Service record saved.");
    } catch (requestError) {
      const data = requestError.response?.data;

      setFormErrors(data?.errors || {});
      toast.error(data?.message || "Unable to save the service record entry.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (record) => {
    const confirmation = await Swal.fire({
      title: "Remove this entry?",
      text: "It will no longer appear on the printed service record.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Remove",
      confirmButtonColor: "#D61E1E",
      cancelButtonText: "Cancel",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await archiveServiceRecordEntry(employee.id, record.id);

      setRecords(Array.isArray(result?.records) ? result.records : []);
      toast.success(result?.message || "Entry removed.");
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to remove the entry.");
    }
  };

  const handlePrint = () => {
    if (!employee) {
      return;
    }

    /*
     * The print view is assembled entirely in the browser from data already loaded for this screen.
     * Only HR's management view may fill the certification line; self-service copies leave it blank
     * for an authorized officer to sign instead of treating the subject employee as the certifier.
     */
    const canCertify = isManageMode && canManage;
    const opened = printServiceRecord({
      employee,
      records,
      certifiedBy: canCertify
        ? certifier?.name || user?.full_name || user?.username || ""
        : "",
      signatureDataUrl: canCertify ? certifier?.signatureDataUrl || "" : "",
    });

    if (!opened) {
      toast.error("Unable to open the print window. Check your pop-up blocker.");
    }
  };

  const handleDownloadPdf = async () => {
    if (!employee || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const { downloadServiceRecordPdf } = await import("./serviceRecordPdf");
      const canCertify = isManageMode && canManage;
      await downloadServiceRecordPdf({
        employee,
        records,
        certifiedBy: canCertify ? certifier?.name || user?.full_name || user?.username || "" : "",
        signatureDataUrl: canCertify ? certifier?.signatureDataUrl || "" : "",
      });
    } catch {
      toast.error("Unable to download the service record PDF. Please try again.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const downloadPdfButton = (
    <Button variant="secondary" icon={Download} onClick={handleDownloadPdf} disabled={loading || !records.length || downloadingPdf}>
      {downloadingPdf ? "Downloading..." : "Download PDF"}
    </Button>
  );

  const directoryColumns = [
    {
      key: "employee",
      header: "Employee",
      cardRole: "title",
      render: (row) => (
        <div className="flex min-w-[210px] items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 shadow-sm">
            {employeeInitials(row.employeeName)}
          </div>
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-900">
              {row.employeeName || "Unnamed employee"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "division",
      header: "Division",
      render: (row) => <span className="text-sm text-slate-700">{row.division || "—"}</span>,
    },
    {
      key: "position",
      header: "Position",
      cardRole: "subtitle",
      render: (row) => <span className="text-sm text-slate-700">{row.position || "—"}</span>,
    },
    {
      key: "employmentStatus",
      header: "Employment",
      render: (row) => <span className="text-sm text-slate-700">{row.employmentStatus || "—"}</span>,
    },
    {
      key: "dateHired",
      header: "Date Hired",
      render: (row) => (
        <span className="whitespace-nowrap text-sm text-slate-700">
          {formatServiceDate(row.dateHired)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      headerClassName: "!text-center",
      cellClassName: "!text-center",
      render: (row) => (
        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          <ActionIconButton
            label={`View ${row.employeeName || "employee"}`}
            icon={faEye}
            tone="view"
            onClick={() => void openEmployeeRecord(row)}
          />
          <ActionIconButton
            label={`Import Record for ${row.employeeName || "employee"}`}
            icon={faFileImport}
            tone="export"
            text="Import Record"
            onClick={() => void openImportModal(row)}
          />
          <ActionIconButton
            label={`Add service record entry for ${row.employeeName || "employee"}`}
            icon={faPlus}
            tone="edit"
            text="Add Entry"
            onClick={() => void openAddModal(row)}
          />
        </div>
      ),
    },
  ];

  const directoryHasNoMatches = !employeeListLoading
    && employeeOptions.length > 0
    && filteredEmployees.length === 0;
  const directoryHasNoDivision = !employeeListLoading && isDivisionScoped && !scopedDivision;
  const directoryEmptyState = (
    <div className="mx-auto flex max-w-lg flex-col items-center py-10 text-center sm:py-14">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
        {directoryHasNoMatches ? <Search size={21} /> : <UsersRound size={21} />}
      </div>
      <p className="m-0 mt-4 text-sm font-semibold text-slate-900">
        {directoryHasNoMatches
          ? "No employees match your search"
          : directoryHasNoDivision
            ? "Your employee profile has no assigned division"
            : "No employee service records yet"}
      </p>
      <p className="m-0 mt-1.5 max-w-md text-sm leading-6 text-slate-500">
        {directoryHasNoMatches
          ? "Try a different name, employee ID, division, or position."
          : directoryHasNoDivision
            ? "Service records are listed for your division only. Ask an administrator to set your division in Employee Management."
            : "Employee records will appear here once they are available."}
      </p>
    </div>
  );

  return (
    <div className="w-full space-y-4">
      {importEmployee && <ServiceRecordImportModal
        key={importEmployee.id}
        employee={importEmployee}
        onClose={() => setImportEmployee(null)}
        onImported={(result) => {
          setRecords(Array.isArray(result.records) ? result.records : []);
          setImportEmployee(null);
          setRecordViewerOpen(true);
        }}
      />}
      {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}

      {!isManageMode ? (
        <SettingsNotice tone="info">
          This self-service copy is prepared in your browser. Its certification line is left blank
          for an authorized HR officer to sign.
        </SettingsNotice>
      ) : null}

      {isManageMode ? (
        <section className="overflow-hidden rounded-2xl border border-blue-200 border-t-2 border-t-blue-600 bg-white shadow-sm">
          <div className="flex flex-col gap-4 px-4 py-5 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h3 className="m-0 text-base font-semibold text-slate-950">Service Records</h3>
              <p className="m-0 mt-1 text-sm text-slate-500">
                Review employee appointments, salary history, and separations on CS Form No. 1.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-100 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block w-full sm:max-w-sm">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Employees</span>
                <span className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={employeeQuery}
                    onChange={(event) => setEmployeeQuery(event.target.value)}
                    placeholder="Search employee or division"
                    className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </span>
              </label>
              <label className="block w-full sm:w-40">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Division</span>
                <select
                  value={isDivisionScoped ? scopedDivision : employeeDivisionFilter}
                  disabled={isDivisionScoped}
                  onChange={(event) => setEmployeeDivisionFilter(event.target.value)}
                  className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
                >
                  {isDivisionScoped ? (
                    <option value={scopedDivision}>{scopedDivision || "No assigned division"}</option>
                  ) : (
                    <>
                      <option value="">All divisions</option>
                      {employeeDivisionOptions.map((division) => (
                        <option key={division} value={division}>{division}</option>
                      ))}
                    </>
                  )}
                </select>
              </label>
            </div>

            <Table
              columns={directoryColumns}
              data={visibleEmployees}
              rowKey="employeeRecordId"
              loading={employeeListLoading}
              loadingRows={5}
              emptyState={directoryEmptyState}
              cardsClassName="lg:hidden"
              tableWrapperClassName="hidden rounded-xl border border-slate-200 lg:block"
              minWidthClassName="min-w-[1050px]"
            />

            <div className="mt-4 flex flex-col gap-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Showing {employeeStart} to {employeeEnd} of {filteredEmployees.length} employee{filteredEmployees.length === 1 ? "" : "s"}
              </span>
              <Pagination
                currentPage={safeEmployeeCurrentPage}
                totalPages={employeeTotalPages}
                onPageChange={setEmployeeCurrentPage}
                disabled={employeeListLoading}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-blue-200 border-t-2 border-t-blue-600 bg-white shadow-sm">
          <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0">
                <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-blue-600">
                  My service record
                </p>
                <h3 className="m-0 mt-0.5 truncate text-lg font-semibold text-slate-950">
                  {employee?.fullName || selectedOption?.employeeName || "Service Record"}
                </h3>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  {`${employee?.employeeCode || selectedOption?.employeeId || "No employee number"} · ${employee?.designationTitle || selectedOption?.position || "No position"} · ${employee?.station || selectedOption?.division || "No division"}`}
                </p>
              </div>
            </div>

            {employee ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!records.length}
                  onClick={handlePrint}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Printer size={16} />
                  Print
                </button>
                {downloadPdfButton}
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 p-4 sm:p-5">
            <ServiceRecordTable
              records={records}
              canManage={editable}
              loading={loading}
              onEdit={openEditModal}
              onArchive={handleArchive}
            />
          </div>
        </section>
      )}

      <ProfileFloatingCard
        open={isManageMode && recordViewerOpen}
        onClose={closeEmployeeRecord}
        closeLabel="Close service record"
        title={employee?.fullName || selectedOption?.employeeName || "Employee Service Record"}
        subtitle={`${employee?.employeeCode || selectedOption?.employeeId || "No employee number"} · ${employee?.designationTitle || selectedOption?.position || "No position"} · ${employee?.station || selectedOption?.division || "No division"}`}
        icon={ScrollText}
        maxWidth="max-w-[min(96vw,1400px)]"
        bodyClassName="px-4 pb-5 sm:px-5"
      >
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="m-0 text-sm font-semibold text-slate-900">CS Form No. 1</p>
            <p className="m-0 mt-1 text-xs text-slate-500">Appointment, salary, and separation history</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading || !records.length}
              onClick={handlePrint}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Printer size={16} aria-hidden="true" />
              Print
            </button>
            {downloadPdfButton}
          </div>
        </div>

        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}

        <ServiceRecordTable
          records={records}
          canManage={editable}
          loading={loading}
          onEdit={openEditModal}
          onArchive={handleArchive}
        />
      </ProfileFloatingCard>

      <Modal
        open={modalOpen}
        title={form.id ? "Edit Service Record Entry" : "Add Service Record Entry"}
        onClose={() => setModalOpen(false)}
        maxWidth="max-w-3xl"
      >
        <form className="grid gap-4" onSubmit={handleSubmit}>
          {form.id && employee ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 shadow-sm">
                {employeeInitials(employee.fullName)}
              </div>
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-semibold text-slate-900">{employee.fullName}</p>
                <p className="m-0 mt-0.5 truncate text-xs text-slate-500">
                  {employee.employeeCode || "No employee ID"}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label={requiredFieldLabel("Service from")}
              name="serviceFrom"
              type="date"
              value={form.serviceFrom}
              onChange={updateField("serviceFrom")}
              error={formErrors.serviceFrom}
              required
            />
            <div className="w-full">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="serviceTo" className="block text-sm font-semibold text-slate-700">
                  {requiredFieldLabel("Service to")}
                </label>
                <button
                  type="button"
                  onClick={toggleServiceToPresent}
                  aria-pressed={form.serviceToPresent}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
                    form.serviceToPresent
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                  }`}
                >
                  Present
                </button>
              </div>

              {/*
                * The date picker stays put whether or not Present is on -- it is the normal way to
                * end a period, and Present is the alternative to filling it in, not a replacement
                * for the control. Blanking the value while Present is on leaves the typed date in
                * form state, so turning Present back off returns it.
                */}
              <InputField
                id="serviceTo"
                name="serviceTo"
                type="date"
                value={form.serviceToPresent ? "" : form.serviceTo}
                onChange={updateField("serviceTo")}
                error={formErrors.serviceTo}
                disabled={form.serviceToPresent}
                inputClassName={form.serviceToPresent ? "cursor-not-allowed text-slate-400" : ""}
              />
            </div>
          </div>

          <p className="m-0 -mt-2 text-xs text-slate-500">
            Turn on "Present" for the appointment currently in force — it is saved with no end date.
            Saving a new entry closes the open one the day before this start date.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InputField
              label={requiredFieldLabel("Position")}
              name="designationTitle"
              value={form.designationTitle}
              onChange={updateField("designationTitle")}
              error={formErrors.designationTitle}
              placeholder="Administrative Officer III"
              required
            />
            <SettingsSelect
              name="employmentStatus"
              label={requiredFieldLabel("Employment")}
              value={form.employmentStatus}
              onChange={updateField("employmentStatus")}
              options={employmentStatuses}
              placeholder="Select employment"
              error={formErrors.employmentStatus}
            />
            <SettingsSelect
              name="stClassification"
              label={requiredFieldLabel("S&T classification")}
              value={form.stClassification}
              onChange={updateField("stClassification")}
              options={stClassifications}
              placeholder="Select classification"
              error={formErrors.stClassification}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SettingsSelect
              name="salaryGrade"
              label={requiredFieldLabel("Salary grade")}
              value={form.salaryGrade}
              onChange={handleSalaryGradeChange}
              options={SALARY_GRADE_OPTIONS}
              placeholder="Select grade"
              error={formErrors.salaryGrade}
            />
            <SettingsSelect
              name="stepIncrement"
              label={requiredFieldLabel("Step")}
              value={form.stepIncrement}
              onChange={handleStepChange}
              options={stepOptions}
              placeholder="Select step"
              error={formErrors.stepIncrement}
            />
            <InputField
              label={requiredFieldLabel("Monthly salary")}
              name="monthlySalary"
              type="number"
              min="0"
              step="0.01"
              value={form.monthlySalary}
              onChange={handleMonthlySalaryChange}
              error={formErrors.monthlySalary}
            />
            <InputField
              label={requiredFieldLabel("Salary / annum")}
              name="annualSalary"
              type="number"
              min="0"
              step="0.01"
              value={form.annualSalary}
              onChange={handleAnnualSalaryChange}
              onBlur={settleAnnualSalary}
            />
          </div>

          <p className="m-0 -mt-2 text-xs text-slate-500">
            Salary / annum is the monthly salary × 12, the figure printed on the service record. Fill in
            either one, or pick a grade and step to fill in both.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label={requiredFieldLabel("Station / place of assignment")}
              name="station"
              value={form.station}
              onChange={updateField("station")}
              error={formErrors.station}
              required
            />
            <InputField
              label={requiredFieldLabel("Branch")}
              name="branch"
              value={form.branch}
              onChange={updateField("branch")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label={requiredFieldLabel("Separation date")}
              name="separationDate"
              type="date"
              value={form.separationDate}
              onChange={updateField("separationDate")}
              error={formErrors.separationDate}
            />
            <InputField
              label={requiredFieldLabel("Cause of separation")}
              name="separationCause"
              value={form.separationCause}
              onChange={updateField("separationCause")}
              placeholder="Resignation, retirement, transfer..."
            />
          </div>

          <InputField
            label={requiredFieldLabel("Remarks")}
            name="remarks"
            value={form.remarks}
            onChange={updateField("remarks")}
            placeholder="Appointment reference, order number..."
          />

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button type="submit" loading={saving}>
              {form.id ? "Save Changes" : "Add Entry"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
