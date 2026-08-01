import React, { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import { SettingsSelect } from "../../components/settings";
import { CATEGORY_OPTIONS, DEFAULT_CATEGORY, categoryDetail } from "./rewardsConstants";
import { currentMonthValue, yearsBetween } from "./rewardsUtils";

const FORM_ID = "reward-nomination-form";
const MIN_REASON_LENGTH = 12;

function emptyForm() {
  return {
    employeeId: "",
    nominatedByEmployeeId: "",
    manualEmployeeName: "",
    manualDivision: "",
    manualPosition: "",
    category: DEFAULT_CATEGORY,
    nominatedBy: "",
    period: currentMonthValue(),
    yearsOfService: "",
    reason: "",
  };
}

function FieldLabel({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-slate-700">
      {children}
    </label>
  );
}

function FieldError({ message }) {
  return message ? <p className="m-0 mt-1.5 text-xs font-semibold text-rose-700">{message}</p> : null;
}

export default function NominationFormModal({ open, employeeOptions = [], submitting = false, onClose, onSubmit }) {
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});

  const hasEmployeeList = employeeOptions.length > 0;
  const category = categoryDetail(form.category);
  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => employee.id === form.employeeId) || null,
    [employeeOptions, form.employeeId]
  );
  const selectedNominator = useMemo(
    () => employeeOptions.find((employee) => employee.id === form.nominatedByEmployeeId) || null,
    [employeeOptions, form.nominatedByEmployeeId]
  );

  const reset = () => {
    setForm(emptyForm());
    setErrors({});
  };

  const close = () => {
    reset();
    onClose?.();
  };

  const updateField = (field, value) => {
    setForm((current) => {
      const next = { ...current, [field]: value };

      // Years of service is derivable from the hire date; pre-fill it but leave it editable, since
      // credited service is not always the same as elapsed time.
      if (field === "employeeId" && current.category === "loyalty" && !current.yearsOfService) {
        const employee = employeeOptions.find((item) => item.id === value);
        next.yearsOfService = yearsBetween(employee?.dateHired);
      }

      if (field === "category" && categoryDetail(value).usesYearsOfService && !current.yearsOfService) {
        next.yearsOfService = yearsBetween(selectedEmployee?.dateHired);
      }

      return next;
    });
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const selectNominator = (employee) => {
    setForm((current) => ({
      ...current,
      nominatedByEmployeeId: employee.id,
      nominatedBy: employee.name,
    }));
    setErrors((current) => ({ ...current, nominatedBy: "" }));
  };

  const validate = () => {
    const nextErrors = {};

    if (hasEmployeeList && !form.employeeId) {
      nextErrors.employeeId = "Choose the employee being nominated.";
    }

    if (!hasEmployeeList && !form.manualEmployeeName.trim()) {
      nextErrors.manualEmployeeName = "Enter the employee name.";
    }

    if (hasEmployeeList && !form.nominatedByEmployeeId) {
      nextErrors.nominatedBy = "Choose who is making this nomination.";
    }

    if (!hasEmployeeList && !form.nominatedBy.trim()) {
      nextErrors.nominatedBy = "Enter the nominator name.";
    }

    if (!category.usesYearsOfService && !form.period) {
      nextErrors.period = "Choose the recognition month.";
    }

    if (category.usesYearsOfService && (!form.yearsOfService || Number(form.yearsOfService) <= 0)) {
      nextErrors.yearsOfService = "Enter years of service.";
    }

    if (form.reason.trim().length < MIN_REASON_LENGTH) {
      nextErrors.reason = "Write a brief nomination reason.";
    }

    setErrors(nextErrors);

    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    const employee = selectedEmployee || {
      id: `manual-${Date.now()}`,
      name: form.manualEmployeeName,
      division: form.manualDivision,
      position: form.manualPosition,
    };

    // The parent owns the request so it can keep the record list authoritative; it hands back any
    // server-side field errors for display here.
    const serverErrors = await onSubmit?.({
      employee,
      payload: {
        employeeRecordId: employee.id,
        category: form.category,
        nominatedBy: selectedNominator?.name || form.nominatedBy,
        period: form.period,
        yearsOfService: form.yearsOfService,
        reason: form.reason.trim(),
      },
    });

    if (serverErrors === true) {
      reset();
      return;
    }

    if (serverErrors && typeof serverErrors === "object") {
      setErrors(serverErrors);
    }
  };

  const reasonLength = form.reason.trim().length;

  return (
    <Modal
      open={open}
      title="New Nomination"
      onClose={close}
      maxWidth="max-w-[720px]"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} icon={Plus} loading={submitting}>
            Submit Nomination
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <FieldLabel htmlFor="rewardCategory">Award Category</FieldLabel>
          <SettingsSelect
            id="rewardCategory"
            name="rewardCategory"
            value={form.category}
            onChange={(event) => updateField("category", event.target.value)}
            options={CATEGORY_OPTIONS}
            helper={category.description}
          />
        </div>

        {hasEmployeeList ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Nominee</FieldLabel>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={selectedEmployee}
                onSelect={(employee) => updateField("employeeId", employee.id)}
                placeholder="Search employee..."
              />
              <FieldError message={errors.employeeId} />
            </div>
            <div>
              <FieldLabel>Nominated By</FieldLabel>
              <EmployeeSearchSelect
                employeeOptions={employeeOptions}
                selectedEmployee={selectedNominator}
                onSelect={selectNominator}
                placeholder="Search nominator..."
              />
              <FieldError message={errors.nominatedBy} />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <InputField
              label="Employee Name"
              name="rewardManualEmployeeName"
              value={form.manualEmployeeName}
              onChange={(event) => updateField("manualEmployeeName", event.target.value)}
              error={errors.manualEmployeeName}
            />
            <InputField
              label="Nominated By"
              name="rewardNominatedBy"
              value={form.nominatedBy}
              onChange={(event) => updateField("nominatedBy", event.target.value)}
              error={errors.nominatedBy}
            />
            <InputField
              label="Division"
              name="rewardManualDivision"
              value={form.manualDivision}
              onChange={(event) => updateField("manualDivision", event.target.value)}
            />
            <InputField
              label="Position"
              name="rewardManualPosition"
              value={form.manualPosition}
              onChange={(event) => updateField("manualPosition", event.target.value)}
            />
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {category.usesYearsOfService ? (
            <InputField
              label="Years of Service"
              name="rewardYearsOfService"
              type="number"
              min="1"
              value={form.yearsOfService}
              onChange={(event) => updateField("yearsOfService", event.target.value)}
              error={errors.yearsOfService}
            />
          ) : (
            <InputField
              label="Recognition Month"
              name="rewardPeriod"
              type="month"
              value={form.period}
              onChange={(event) => updateField("period", event.target.value)}
              error={errors.period}
            />
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <FieldLabel htmlFor="rewardReason">Nomination Reason</FieldLabel>
            <span className={`text-xs ${reasonLength < MIN_REASON_LENGTH ? "text-slate-400" : "text-emerald-600"}`}>
              {reasonLength}/{MIN_REASON_LENGTH} min
            </span>
          </div>
          <textarea
            id="rewardReason"
            value={form.reason}
            onChange={(event) => updateField("reason", event.target.value)}
            rows={5}
            placeholder="Describe the accomplishment, service milestone, or contribution. This appears in the approval review."
            className={`w-full resize-y rounded-lg border bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 ${
              errors.reason ? "border-rose-400" : "border-slate-300"
            }`}
          />
          <FieldError message={errors.reason} />
        </div>
      </form>
    </Modal>
  );
}
