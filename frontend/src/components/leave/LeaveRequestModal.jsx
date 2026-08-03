import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, FileUp, X } from "lucide-react";
import EmployeeSearchSelect from "./EmployeeSearchSelect";
import { getDurationDays, resolveRoleKey } from "../../utils/leaveHelpers";
import {
  DEFAULT_LEAVE_REQUEST_DETAILS,
  packLeaveReason,
} from "../../utils/leaveRequestDetails";

const VACATION_DETAIL_OPTIONS = [
  { label: "Within the Philippines", value: "within_philippines" },
  { label: "Abroad", value: "abroad" },
];

const SICK_LEAVE_DETAIL_OPTIONS = [
  { label: "In Hospital", value: "in_hospital" },
  { label: "Out Patient", value: "out_patient" },
];

const STUDY_LEAVE_DETAIL_OPTIONS = [
  { label: "Completion of Master's Degree", value: "masters" },
  { label: "BAR/Board Examination Review", value: "bar_review" },
];

function normalizeLeaveType(value) {
  return String(value || "").trim().toLowerCase();
}

function isVacationOrSpecialPrivilegeLeave(leaveType) {
  const normalizedLeaveType = normalizeLeaveType(leaveType);
  return normalizedLeaveType === "vacation leave" || normalizedLeaveType === "special privilege leave";
}

function buildInitialForm(user) {
  return {
    employeeId: user?.employee_id || "",
    employeeName: user?.full_name || user?.username || "",
    leaveType: "",
    division: user?.division || "",
    startDate: "",
    endDate: "",
    reason: "",
    attachment: null,
    ...DEFAULT_LEAVE_REQUEST_DETAILS,
  };
}

export default function LeaveRequestModal({
  open = false,
  user,
  leaveTypes = [],
  employees = [],
  isSubmitting = false,
  showHeaderCloseButton = true,
  onClose,
  onSubmit,
}) {
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState(() => buildInitialForm(user));
  const [errors, setErrors] = useState({});
  const canSelectEmployee = resolveRoleKey(user) === "admin";

  const employeeOptions = useMemo(
    () =>
      employees
        .filter((employee) => employee.fullName)
        .map((employee) => ({
          employeeRecordId: employee.id,
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          division: employee.department,
        }))
        .sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
    [employees]
  );

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }

    setForm(buildInitialForm(user));
    setErrors({});

    const frame = window.requestAnimationFrame(() => {
      setVisible(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, user]);

  const computedDays = useMemo(
    () => getDurationDays(form.startDate, form.endDate),
    [form.endDate, form.startDate]
  );

  const resolvedEmployee = useMemo(() => {
    if (!canSelectEmployee) {
      return {
        employeeRecordId: form.employeeId || "",
        employeeId: user?.employee_id || "",
        employeeName: form.employeeName || user?.full_name || user?.username || "",
        division: form.division || user?.division || "",
      };
    }

    return employeeOptions.find(
      (employee) => String(employee.employeeRecordId) === String(form.employeeId)
    ) || null;
  }, [canSelectEmployee, employeeOptions, form.division, form.employeeId, form.employeeName, user]);

  if (!open) {
    return null;
  }

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      if (field === "leaveType") {
        return {
          ...current,
          leaveType: value,
          attachment: normalizeLeaveType(value) === "sick leave" ? current.attachment : null,
          ...DEFAULT_LEAVE_REQUEST_DETAILS,
        };
      }

      if (field === "vacationScope") {
        return {
          ...current,
          vacationScope: value,
          vacationNote: value === "abroad" ? current.vacationNote : "",
        };
      }

      return { ...current, [field]: value };
    });
    setErrors((current) => {
      if (field === "leaveType") {
        return {
          ...current,
          leaveType: "",
          vacationScope: "",
          vacationNote: "",
          sickLeaveMode: "",
          sickLeaveIllness: "",
          studyLeavePurpose: "",
        };
      }

      if (field === "vacationScope") {
        return {
          ...current,
          vacationScope: "",
          vacationNote: value === "abroad" ? current.vacationNote : "",
        };
      }

      return { ...current, [field]: "" };
    });
  };

  const handleEmployeeChange = (selectedEmployee) => {
    const employeeId = String(selectedEmployee?.employeeRecordId || "");
    const matchedEmployee = employeeOptions.find(
      (employee) => String(employee.employeeRecordId) === employeeId
    );

    setForm((current) => ({
      ...current,
      employeeId,
      employeeName: matchedEmployee?.employeeName || "",
      division: matchedEmployee?.division || current.division,
    }));
    setErrors((current) => ({ ...current, employeeName: "" }));
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setForm((current) => ({ ...current, attachment: file }));
  };

  const validate = () => {
    const nextErrors = {};
    const normalizedLeaveType = normalizeLeaveType(form.leaveType);

    if (!form.employeeName.trim()) nextErrors.employeeName = "Employee name is required.";
    if (!form.leaveType) nextErrors.leaveType = "Leave type is required.";
    if (!form.startDate) nextErrors.startDate = "Start date is required.";
    if (!form.endDate) nextErrors.endDate = "End date is required.";
    if (form.startDate && form.endDate && getDurationDays(form.startDate, form.endDate) <= 0) {
      nextErrors.endDate = "End date must not be earlier than start date.";
    }

    if (isVacationOrSpecialPrivilegeLeave(normalizedLeaveType)) {
      if (!form.vacationScope) {
        nextErrors.vacationScope = "Select whether the leave is within the Philippines or abroad.";
      }

      if (form.vacationScope === "abroad" && !form.vacationNote.trim()) {
        nextErrors.vacationNote = "Specify the abroad destination or note.";
      }
    }

    if (normalizedLeaveType === "sick leave") {
      if (!form.sickLeaveMode) {
        nextErrors.sickLeaveMode = "Select whether the sick leave is in hospital or out patient.";
      }

      if (form.sickLeaveMode && !form.sickLeaveIllness.trim()) {
        nextErrors.sickLeaveIllness = "Specify the illness.";
      }
    }

    if (normalizedLeaveType === "study leave" && !form.studyLeavePurpose) {
      nextErrors.studyLeavePurpose = "Select the study leave purpose.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }

    await onSubmit?.({
      ...form,
      numberOfDays: computedDays || 1,
      reason: packLeaveReason(form.reason, {
        vacationScope: form.vacationScope,
        vacationNote: form.vacationNote,
        sickLeaveMode: form.sickLeaveMode,
        sickLeaveIllness: form.sickLeaveIllness,
        studyLeavePurpose: form.studyLeavePurpose,
      }),
      attachment: form.attachment,
      attachmentName: form.attachment?.name || "",
    });
  };

  const normalizedLeaveType = normalizeLeaveType(form.leaveType);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close leave request form"
        className={`absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <form
        onSubmit={submit}
        className={`relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-white/40 bg-white/95 shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-900">File Leave Request</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Complete the form to submit a leave request.</p>
          </div>
          <div className="flex items-center gap-2">
            <img
              src="/mgb.png"
              alt="MGB Logo"
              className="h-14 w-14 shrink-0 object-contain"
            />
            {showHeaderCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-5 sm:p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Employee Name</span>
              {!canSelectEmployee ? (
                <input
                  type="text"
                  value={resolvedEmployee?.employeeName || ""}
                  readOnly
                  className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500 outline-none"
                />
              ) : (
                <EmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={resolvedEmployee}
                    onSelect={handleEmployeeChange}
                    disabled={employeeOptions.length === 0}
                />
              )}
              {errors.employeeName ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.employeeName}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Leave Type</span>
              <select
                value={form.leaveType}
                onChange={handleChange("leaveType")}
                className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">Select leave type</option>
                {leaveTypes.map((leaveType) => (
                  <option key={leaveType} value={leaveType}>
                    {leaveType}
                  </option>
                ))}
              </select>
              {errors.leaveType ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.leaveType}</p> : null}
            </label>

            {isVacationOrSpecialPrivilegeLeave(normalizedLeaveType) ? (
              <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="m-0 text-sm font-semibold text-slate-800">Vacation / Special Privilege Details</p>
                <p className="m-0 mt-1 text-xs text-slate-500">Choose where the leave will be spent.</p>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">Location</span>
                    <select
                      value={form.vacationScope}
                      onChange={handleChange("vacationScope")}
                      className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                    >
                      <option value="">Select location</option>
                      {VACATION_DETAIL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {errors.vacationScope ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.vacationScope}</p> : null}
                  </label>

                  {form.vacationScope === "abroad" ? (
                    <label>
                      <span className="mb-1.5 block text-sm font-semibold text-slate-700">Specify Abroad</span>
                      <input
                        type="text"
                        value={form.vacationNote}
                        onChange={handleChange("vacationNote")}
                        placeholder="Destination or abroad note"
                        className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                      />
                      {errors.vacationNote ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.vacationNote}</p> : null}
                    </label>
                  ) : null}
                </div>
              </div>
            ) : null}

            {normalizedLeaveType === "sick leave" ? (
              <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="m-0 text-sm font-semibold text-slate-800">Sick Leave Details</p>
                <p className="m-0 mt-1 text-xs text-slate-500">Select the treatment type and specify the illness.</p>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">Treatment Type</span>
                    <select
                      value={form.sickLeaveMode}
                      onChange={handleChange("sickLeaveMode")}
                      className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                    >
                      <option value="">Select treatment type</option>
                      {SICK_LEAVE_DETAIL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {errors.sickLeaveMode ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.sickLeaveMode}</p> : null}
                  </label>

                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">Specify Illness</span>
                    <input
                      type="text"
                      value={form.sickLeaveIllness}
                      onChange={handleChange("sickLeaveIllness")}
                      placeholder="Illness or diagnosis"
                      className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                    />
                    {errors.sickLeaveIllness ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.sickLeaveIllness}</p> : null}
                  </label>
                </div>
              </div>
            ) : null}

            {normalizedLeaveType === "study leave" ? (
              <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="m-0 text-sm font-semibold text-slate-800">Study Leave Details</p>
                <p className="m-0 mt-1 text-xs text-slate-500">Select the purpose so the leave form can mark the correct checkbox.</p>

                <div className="mt-3">
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">Study Leave Purpose</span>
                    <select
                      value={form.studyLeavePurpose}
                      onChange={handleChange("studyLeavePurpose")}
                      className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                    >
                      <option value="">Select study leave purpose</option>
                      {STUDY_LEAVE_DETAIL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {errors.studyLeavePurpose ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.studyLeavePurpose}</p> : null}
                  </label>
                </div>
              </div>
            ) : null}

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                Start Date
              </span>
              <input
                type="date"
                value={form.startDate}
                onChange={handleChange("startDate")}
                className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
              />
              {errors.startDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.startDate}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                End Date
              </span>
              <input
                type="date"
                value={form.endDate}
                onChange={handleChange("endDate")}
                className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
              />
              {errors.endDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.endDate}</p> : null}
            </label>

            {normalizedLeaveType === "sick leave" ? (
              <label>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Attachment Upload</span>
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                    <FileUp size={15} />
                    Upload File
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </label>
                  <p className="m-0 mt-2 truncate text-xs text-slate-500">
                    {form.attachment?.name || "No file selected"}
                  </p>
                  <p className="m-0 mt-1 text-[11px] text-slate-400">
                    Supported formats: PDF, PNG, JPG, JPEG, GIF, WEBP, BMP
                  </p>
                </div>
              </label>
            ) : null}

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Reason / Supporting Details</span>
              <textarea
                rows={4}
                value={form.reason}
                onChange={handleChange("reason")}
                placeholder="Provide any additional reason or supporting details."
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
              />
              {errors.reason ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.reason}</p> : null}
            </label>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-sky-600 px-4 text-sm font-semibold text-white shadow transition hover:from-teal-700 hover:to-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </form>
    </div>
  );
}
