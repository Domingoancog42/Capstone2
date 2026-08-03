import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus, Printer } from "lucide-react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import { SettingsNotice, SettingsSelect } from "../../components/settings";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  archiveServiceRecordEntry,
  createServiceRecordEntry,
  fetchServiceRecord,
  getEmployees,
  updateServiceRecordEntry,
} from "../../services/api";
import ServiceRecordTable from "./ServiceRecordTable";
import { printServiceRecord } from "./serviceRecordUtils";

/* ── Salary Standardization Law schedule ─────────────────────────────────────────
 * Each row is [Step 1 … Step 8]. Grades 32–33 have fewer than 8 steps; missing
 * steps are null so the UI can hide those options.
 */
const SALARY_SCHEDULE = {
  1:  [14634, 14730, 14849, 14968, 15089, 15211, 15333, 15456],
  2:  [15522, 15636, 15752, 15869, 15986, 16103, 16223, 16342],
  3:  [16486, 16610, 16732, 16856, 16982, 17106, 17234, 17360],
  4:  [17536, 17636, 17767, 17898, 18031, 18163, 18298, 18433],
  5:  [18581, 18720, 18858, 18998, 19137, 19280, 19423, 19565],
  6:  [19716, 19862, 20009, 20158, 20307, 20456, 20609, 20761],
  7:  [20914, 21069, 21224, 21382, 21539, 21699, 21859, 22022],
  8:  [22423, 22627, 22832, 23038, 23246, 23456, 23668, 23883],
  9:  [24329, 24523, 24720, 24917, 25117, 25318, 25521, 25725],
  10: [26917, 27131, 27347, 27565, 27786, 28007, 28230, 28456],
  11: [31705, 31820, 32109, 32401, 32697, 32998, 33302, 33611],
  12: [33947, 34069, 34357, 34648, 34943, 35242, 35544, 35850],
  13: [36125, 36283, 36599, 36919, 37244, 37572, 37904, 38241],
  14: [38764, 39141, 39523, 39910, 40300, 40696, 41097, 41503],
  15: [42178, 42594, 43015, 43442, 43874, 44310, 44753, 45202],
  16: [45694, 46152, 46615, 47084, 47559, 48040, 48528, 49020],
  17: [49562, 50066, 50576, 51092, 51614, 52144, 52678, 53221],
  18: [53818, 54371, 54933, 55499, 56075, 56657, 57246, 57842],
  19: [59153, 59966, 60793, 61632, 62486, 63353, 64236, 65132],
  20: [66052, 66970, 67904, 68853, 69818, 70772, 71727, 72671],
  21: [73303, 74337, 75388, 76456, 77542, 78645, 79692, 80831],
  22: [81796, 82963, 84151, 85356, 86582, 87746, 89011, 90295],
  23: [91306, 92622, 93962, 95330, 96823, 98341, 99883, 101318],
  24: [102603, 104209, 105841, 107500, 109185, 110898, 112533, 114301],
  25: [116643, 118469, 120326, 122212, 124131, 126079, 128061, 130073],
  26: [131807, 133870, 135968, 138100, 140268, 142469, 144707, 146983],
  27: [148940, 151273, 153644, 155906, 158353, 160235, 162752, 165310],
  28: [167129, 169752, 172418, 174797, 177545, 180339, 182660, 185537],
  29: [187531, 190482, 193496, 196528, 199624, 202005, 205191, 208430],
  30: [210718, 214038, 217207, 220425, 223691, 227224, 230595, 234123],
  31: [300961, 306691, 312532, 318182, 323938, 329989, 336092, 342310],
  32: [356237, 363257, 370418, 377359, 384805, 392400, 400150, 408055],
  33: [449157, 462329, null, null, null, null, null, null],
};

/** Dropdown options for salary grade (1–33). */
const SALARY_GRADE_OPTIONS = Array.from({ length: 33 }, (_, i) => ({
  value: String(i + 1),
  label: `SG-${i + 1}`,
}));

/** Return the step options available for the given salary grade. */
function getStepOptions(salaryGrade) {
  const grade = Number(salaryGrade);
  const row = SALARY_SCHEDULE[grade];

  if (!row) {
    return Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Step ${i + 1}` }));
  }

  return row.reduce((opts, cell, i) => {
    if (cell !== null) {
      opts.push({ value: String(i + 1), label: `Step ${i + 1}` });
    }
    return opts;
  }, []);
}

/** Look up the monthly salary for a given grade + step, or return null. */
function lookupSalary(salaryGrade, step) {
  const grade = Number(salaryGrade);
  const idx = Number(step) - 1;
  const row = SALARY_SCHEDULE[grade];

  if (!row || idx < 0 || idx >= row.length) {
    return null;
  }

  return row[idx] ?? null;
}

const EMPTY_FORM = {
  id: null,
  serviceFrom: "",
  serviceTo: "",
  designationTitle: "",
  employmentStatus: "",
  monthlySalary: "",
  salaryGrade: "",
  stepIncrement: "",
  station: "",
  branch: "Mines and Geosciences Bureau",
  separationDate: "",
  separationCause: "",
  remarks: "",
};

function formFromRecord(record) {
  return {
    id: record.id,
    serviceFrom: record.serviceFrom || "",
    serviceTo: record.serviceTo || "",
    designationTitle: record.designationTitle || "",
    employmentStatus: record.employmentStatus || "",
    monthlySalary: record.monthlySalary ?? "",
    salaryGrade: record.salaryGrade || "",
    stepIncrement: record.stepIncrement || "",
    station: record.station || "",
    branch: record.branch || "Mines and Geosciences Bureau",
    separationDate: record.separationDate || "",
    separationCause: record.separationCause || "",
    remarks: record.remarks || "",
  };
}

/**
 * Service Record (CSC Form No. 1).
 *
 * `mode="employee"` shows the signed-in user their own record with no editing; `mode="manage"` adds
 * the employee picker and the add/edit controls. Same component either way so the two views cannot
 * present the record differently.
 */
export default function ServiceRecordWorkspace({ user, mode = "manage" }) {
  const isManageMode = mode === "manage";

  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [records, setRecords] = useState([]);
  const [employmentStatuses, setEmploymentStatuses] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [certifier, setCertifier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const loadRecord = useCallback(async (employeeRecordId, { background = false } = {}) => {
    setLoading(!background);

    try {
      const result = await fetchServiceRecord(employeeRecordId);

      setEmployee(result?.employee || null);
      setRecords(Array.isArray(result?.records) ? result.records : []);
      setEmploymentStatuses(Array.isArray(result?.employmentStatuses) ? result.employmentStatuses : []);
      setCanManage(Boolean(result?.canManage));
      setCertifier(result?.certifier || null);
      setError("");
    } catch (requestError) {
      // A failed background poll keeps the record on screen instead of replacing it with an error.
      if (!background) {
        setEmployee(null);
        setRecords([]);
        setError(requestError.response?.data?.message || "Unable to load the service record.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isManageMode) {
      return undefined;
    }

    let active = true;

    const loadEmployees = async () => {
      try {
        const result = await getEmployees();

        if (!active) {
          return;
        }

        const options = (Array.isArray(result?.employees) ? result.employees : []).map((row) => ({
          employeeRecordId: row.id,
          employeeId: row.employeeId,
          employeeName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
          division: row.department || row.division || "",
        }));

        setEmployeeOptions(options);
      } catch {
        if (active) {
          setEmployeeOptions([]);
        }
      }
    };

    void loadEmployees();

    return () => {
      active = false;
    };
  }, [isManageMode]);

  useEffect(() => {
    void loadRecord(isManageMode ? selectedEmployeeId : null);
  }, [isManageMode, loadRecord, selectedEmployeeId]);

  /*
   * `refreshOnMount: false` because the effect above already owns the first load and every reload
   * caused by switching employees. This only adds the reload nobody on this screen triggered — a
   * service record edited by someone else, or an employment status changed from Employee Management.
   */
  useAutoRefreshOnChange(
    useCallback(
      ({ background }) => loadRecord(isManageMode ? selectedEmployeeId : null, { background }),
      [isManageMode, loadRecord, selectedEmployeeId]
    ),
    { topics: ["service_record", "employee"], refreshOnMount: false }
  );

  const selectedOption = useMemo(
    () => employeeOptions.find((option) => option.employeeRecordId === selectedEmployeeId) || null,
    [employeeOptions, selectedEmployeeId]
  );

  const editable = isManageMode && canManage && Boolean(employee);

  const updateField = (field) => (event) => {
    const { value } = event.target;

    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: "" }));
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

      return {
        ...current,
        salaryGrade: grade,
        stepIncrement: stepValid ? step : "",
        monthlySalary: salary != null ? String(salary) : (stepValid ? current.monthlySalary : ""),
      };
    });
    setFormErrors((current) => ({ ...current, salaryGrade: "" }));
  };

  const handleStepChange = (event) => {
    const step = event.target.value;

    setForm((current) => {
      const salary = lookupSalary(current.salaryGrade, step);

      return {
        ...current,
        stepIncrement: step,
        monthlySalary: salary != null ? String(salary) : current.monthlySalary,
      };
    });
    setFormErrors((current) => ({ ...current, stepIncrement: "" }));
  };

  /** Step options react to the selected salary grade (e.g. grade 33 only has steps 1–2). */
  const stepOptions = useMemo(() => getStepOptions(form.salaryGrade), [form.salaryGrade]);

  const openAddModal = () => {
    setForm({
      ...EMPTY_FORM,
      // Pre-fill from the employee's current record so HR is confirming rather than retyping.
      designationTitle: employee?.designationTitle || "",
      employmentStatus: employee?.employmentStatus || "",
      station: employee?.station || "",
      monthlySalary: employee?.basicSalary ?? "",
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (record) => {
    setForm(formFromRecord(record));
    setFormErrors({});
    setModalOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!employee) {
      return;
    }

    setSaving(true);

    try {
      const payload = { ...form, employeeRecordId: employee.id };
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

    // The certifying officer is whoever is issuing the document, so it is their signature on the
    // form — not the subject employee's. The backend resolves both from the session.
    const opened = printServiceRecord({
      employee,
      records,
      certifiedBy: certifier?.name || user?.full_name || user?.username || "",
      signatureDataUrl: certifier?.signatureDataUrl || "",
    });

    if (!opened) {
      toast.error("Unable to open the print window. Check your pop-up blocker.");
    }
  };

  return (
    <div className="w-full space-y-4">
      {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h3 className="m-0 text-base font-semibold text-slate-950">
              {employee?.fullName || (isManageMode ? "Service Record" : "My Service Record")}
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {employee
                ? `${employee.employeeCode || "No employee number"} · ${employee.designationTitle || "No designation"} · ${employee.station || "No division"}`
                : "Chronological record of appointments, salaries, and separations (CS Form No. 1)."}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!employee || !records.length}
              onClick={handlePrint}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Printer size={16} />
              Print
            </button>
            {editable ? (
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <Plus size={16} />
                Add Entry
              </button>
            ) : null}
          </div>
        </div>

        {isManageMode ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,280px)]">
            <EmployeeSearchSelect
              employeeOptions={employeeOptions}
              selectedEmployee={selectedOption}
              onSelect={(option) => setSelectedEmployeeId(option?.employeeRecordId ?? null)}
              placeholder="Search employee..."
            />
          </div>
        ) : null}

        <div className="mt-4">
          {isManageMode && !selectedEmployeeId && !employee ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 px-4 py-14 text-center">
              <div className="max-w-md">
                <FileText size={24} className="mx-auto text-slate-300" aria-hidden="true" />
                <p className="m-0 mt-3 text-sm font-semibold text-slate-700">Choose an employee</p>
                <p className="m-0 mt-1.5 text-sm text-slate-500">
                  Search above to open a service record and issue the certified form.
                </p>
              </div>
            </div>
          ) : (
            <ServiceRecordTable
              records={records}
              canManage={editable}
              loading={loading}
              onEdit={openEditModal}
              onArchive={handleArchive}
            />
          )}
        </div>
      </section>

      <Modal
        open={modalOpen}
        title={form.id ? "Edit Service Record Entry" : "Add Service Record Entry"}
        onClose={() => setModalOpen(false)}
        maxWidth="max-w-3xl"
      >
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Service from"
              name="serviceFrom"
              type="date"
              value={form.serviceFrom}
              onChange={updateField("serviceFrom")}
              error={formErrors.serviceFrom}
              required
            />
            <InputField
              label="Service to"
              name="serviceTo"
              type="date"
              value={form.serviceTo}
              onChange={updateField("serviceTo")}
              error={formErrors.serviceTo}
            />
          </div>

          <p className="m-0 -mt-2 text-xs text-slate-500">
            Leave "Service to" blank for the appointment currently in force. Saving a new entry closes
            the open one the day before this start date.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Designation"
              name="designationTitle"
              value={form.designationTitle}
              onChange={updateField("designationTitle")}
              error={formErrors.designationTitle}
              placeholder="Administrative Officer III"
              required
            />
            <SettingsSelect
              name="employmentStatus"
              label="Status"
              value={form.employmentStatus}
              onChange={updateField("employmentStatus")}
              options={employmentStatuses}
              placeholder="Select status"
              error={formErrors.employmentStatus}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SettingsSelect
              name="salaryGrade"
              label="Salary grade"
              value={form.salaryGrade}
              onChange={handleSalaryGradeChange}
              options={SALARY_GRADE_OPTIONS}
              placeholder="Select grade"
              error={formErrors.salaryGrade}
            />
            <SettingsSelect
              name="stepIncrement"
              label="Step"
              value={form.stepIncrement}
              onChange={handleStepChange}
              options={stepOptions}
              placeholder="Select step"
              error={formErrors.stepIncrement}
            />
            <InputField
              label="Monthly salary"
              name="monthlySalary"
              type="number"
              min="0"
              step="0.01"
              value={form.monthlySalary}
              onChange={updateField("monthlySalary")}
              error={formErrors.monthlySalary}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Station / place of assignment"
              name="station"
              value={form.station}
              onChange={updateField("station")}
              error={formErrors.station}
              required
            />
            <InputField
              label="Branch"
              name="branch"
              value={form.branch}
              onChange={updateField("branch")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Separation date"
              name="separationDate"
              type="date"
              value={form.separationDate}
              onChange={updateField("separationDate")}
              error={formErrors.separationDate}
            />
            <InputField
              label="Cause of separation"
              name="separationCause"
              value={form.separationCause}
              onChange={updateField("separationCause")}
              placeholder="Resignation, retirement, transfer..."
            />
          </div>

          <InputField
            label="Remarks"
            name="remarks"
            value={form.remarks}
            onChange={updateField("remarks")}
            placeholder="Appointment reference, order number..."
          />

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {form.id ? "Save Changes" : "Add Entry"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
