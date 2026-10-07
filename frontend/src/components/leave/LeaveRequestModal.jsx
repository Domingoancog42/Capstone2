import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CalendarDays, FileUp, X } from "lucide-react";
import { toast } from "react-hot-toast";
import EmployeeSearchSelect from "./EmployeeSearchSelect";
import LeaveMonetizationFields from "./LeaveMonetizationFields";
import FloatingSelect from "../UI/FloatingSelect";
import MultiDatePicker from "../UI/MultiDatePicker";
import { LEAVE_MONETIZATION_TYPE, isLeaveMonetizationType } from "../../data/leaveTypes";
import {
  LEAVE_ADVANCE_NOTICE_ERROR,
  LEAVE_TYPE_REQUIRED_BEFORE_DATES_ERROR,
  isLeaveStartDateTooSoon,
  isPastDate,
  resolveRoleKey,
  todayDateInputValue,
} from "../../utils/leaveHelpers";
import {
  formatMonetizationDays,
  monetizationNeedsJustification,
  resolveMonetizationDaysError,
  resolveMonetizationRules,
} from "../../utils/leaveMonetization";
import { getSelectedDatesRange, getSelectedDatesTotal } from "../../utils/dateSelection";
import {
  DEFAULT_LEAVE_REQUEST_DETAILS,
  packLeaveReason,
} from "../../utils/leaveRequestDetails";
import {
  confirmLeaveWithoutPay,
  formatLeaveDays,
  resolveLeaveWithoutPaySplit,
} from "../../utils/leaveWithoutPay";

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

const MATERNITY_LEAVE_CALENDAR_DAYS = 105;

function normalizeLeaveType(value) {
  return String(value || "").trim().toLowerCase();
}

function isVacationOrSpecialPrivilegeLeave(leaveType) {
  const normalizedLeaveType = normalizeLeaveType(leaveType);
  return normalizedLeaveType === "vacation leave" || normalizedLeaveType === "special privilege leave";
}

function isMaternityLeave(leaveType) {
  return normalizeLeaveType(leaveType) === "maternity leave";
}

function buildCalendarDaySelection(startDate, numberOfDays) {
  const cursor = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || numberOfDays <= 0) {
    return [];
  }

  return Array.from({ length: numberOfDays }, () => {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    cursor.setDate(cursor.getDate() + 1);
    return { date, portion: "whole" };
  });
}

function leaveTypeMatchesEmployeeGender(leaveType, gender) {
  const normalizedType = normalizeLeaveType(leaveType);
  const normalizedGender = String(gender || "").trim().toLowerCase();

  if (normalizedType === "maternity leave") {
    return normalizedGender === "female";
  }

  if (normalizedType === "paternity leave") {
    return normalizedGender === "male";
  }

  return true;
}

function buildInitialForm(user) {
  return {
    employeeId: user?.employee_id || "",
    employeeName: user?.full_name || user?.username || "",
    leaveType: "",
    division: user?.division || "",
    /* The days applied for, each with its own whole/AM/PM portion. See LeaveDatePicker. */
    leaveDays: [],
    reason: "",
    attachment: null,
    /*
     * Only read when the type selected is the monetization filing, which draws days from a credit
     * instead of spending them on dates away. `VL` is the credit most filings monetize.
     */
    monetizationCreditCode: "VL",
    monetizationDays: "",
    monetizationDateFiled: todayDateInputValue(),
    ...DEFAULT_LEAVE_REQUEST_DETAILS,
  };
}

export default function LeaveRequestModal({
  open = false,
  user,
  leaveTypes = [],
  employees = [],
  leaveCredits = [],
  isSubmitting = false,
  showHeaderCloseButton = true,
  onClose,
  onSubmit,
}) {
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState(() => buildInitialForm(user));
  const [errors, setErrors] = useState({});
  /* The monetizable credits, daily rate and CSC ceilings the monetization fields fetched. */
  const [monetizationSummary, setMonetizationSummary] = useState(null);
  const canSelectEmployee = resolveRoleKey(user) === "admin";
  const normalizedLeaveType = normalizeLeaveType(form.leaveType);
  const isMaternityFiling = isMaternityLeave(normalizedLeaveType);

  const employeeOptions = useMemo(
    () =>
      employees
        .filter((employee) => employee.fullName)
        .map((employee) => ({
          employeeRecordId: employee.id,
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          division: employee.department,
          gender: employee.gender,
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
    setMonetizationSummary(null);

    const frame = window.requestAnimationFrame(() => {
      setVisible(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, user]);

  const computedDays = useMemo(
    () => getSelectedDatesTotal(form.leaveDays),
    [form.leaveDays]
  );
  /*
   * The record still keeps a start and an end so lists, calendars and the CSC form have a span to
   * show; the days in between that were not picked are simply not part of the request.
   */
  const dateRange = useMemo(() => getSelectedDatesRange(form.leaveDays), [form.leaveDays]);

  const resolvedEmployee = useMemo(() => {
    if (!canSelectEmployee) {
      return {
        employeeRecordId: form.employeeId || "",
        employeeId: user?.employee_id || "",
        employeeName: form.employeeName || user?.full_name || user?.username || "",
        division: form.division || user?.division || "",
        gender: user?.gender || "",
      };
    }

    return employeeOptions.find(
      (employee) => String(employee.employeeRecordId) === String(form.employeeId)
    ) || null;
  }, [canSelectEmployee, employeeOptions, form.division, form.employeeId, form.employeeName, user]);

  /*
   * The credits belong to the signed-in user, so they only describe the request when the filer
   * is filing for themself. When someone files on another employee's behalf the API answers with
   * the split for that employee instead.
   */
  const leaveWithoutPaySplit = useMemo(() => {
    if (canSelectEmployee) {
      return null;
    }

    return resolveLeaveWithoutPaySplit({
      leaveType: form.leaveType,
      numberOfDays: computedDays,
      balances: leaveCredits,
    });
  }, [canSelectEmployee, computedDays, form.leaveType, leaveCredits]);

  const chargesLeaveWithoutPay = Boolean(leaveWithoutPaySplit && leaveWithoutPaySplit.unpaidDays > 0);

  /*
   * Monetization is filed from this same form, so the type selection carries it alongside the leave
   * types. Picking it swaps the dates and the attachment for the credit to draw from and how many
   * days of it, and the filing is kept by leave_monetization.php rather than as a leave request.
   */
  const isMonetizationFiling = isLeaveMonetizationType(form.leaveType);
  const filingEmployeeGender = resolvedEmployee?.gender || "";
  const selectableLeaveTypes = useMemo(
    () => [
      ...leaveTypes.filter((leaveType) => leaveTypeMatchesEmployeeGender(leaveType, filingEmployeeGender)),
      LEAVE_MONETIZATION_TYPE,
    ],
    [filingEmployeeGender, leaveTypes]
  );
  const monetizationRules = useMemo(
    () => resolveMonetizationRules(monetizationSummary),
    [monetizationSummary]
  );
  const monetizationOption = useMemo(() => {
    const options = Array.isArray(monetizationSummary?.options) ? monetizationSummary.options : [];
    return options.find((option) => option.code === form.monetizationCreditCode) || null;
  }, [form.monetizationCreditCode, monetizationSummary]);
  const monetizationDays = Number(form.monetizationDays || 0);
  const monetizationAccumulatedDays = Number(monetizationOption?.remaining || 0);
  const monetizationDaysError = useMemo(
    () =>
      resolveMonetizationDaysError({
        creditOption: monetizationOption,
        requestedDays: monetizationDays,
        rules: monetizationRules,
        yearToDateMonetized: Number(monetizationSummary?.yearToDateMonetized || 0),
      }),
    [monetizationDays, monetizationOption, monetizationRules, monetizationSummary]
  );
  const monetizationRequiresPurpose = monetizationNeedsJustification({
    requestedDays: monetizationDays,
    accumulatedDays: monetizationAccumulatedDays,
    rules: monetizationRules,
  });

  if (!open) {
    return null;
  }

  /*
   * Leave is applied for ahead of time, so the calendar starts today. This holds for every role,
   * admin included -- a back-dated filing is not something any account may enter through this form.
   *
   * Recomputed each render rather than memoised, so a form left open past midnight still moves on.
   */
  const today = todayDateInputValue();

  const handleLeaveDaysChange = (leaveDays) => {
    if (!String(form.leaveType || "").trim()) {
      setErrors((current) => ({
        ...current,
        leaveType: "Select a leave type before choosing leave dates.",
        leaveDays: "",
      }));
      toast.error(LEAVE_TYPE_REQUIRED_BEFORE_DATES_ERROR);
      return false;
    }

    const nextStartDate = getSelectedDatesRange(leaveDays).startDate;
    if (isLeaveStartDateTooSoon({ leaveType: form.leaveType, startDate: nextStartDate, filingDate: today })) {
      setErrors((current) => ({ ...current, leaveDays: "" }));
      toast.error(LEAVE_ADVANCE_NOTICE_ERROR);
      return false;
    }

    setForm((current) => ({ ...current, leaveDays }));
    setErrors((current) => ({ ...current, leaveDays: "" }));
    return true;
  };

  const handleSetMaternityDays = () => {
    if (!dateRange.startDate) {
      toast.error("Select a maternity leave start date first.");
      return;
    }

    handleLeaveDaysChange(
      buildCalendarDaySelection(dateRange.startDate, MATERNITY_LEAVE_CALENDAR_DAYS)
    );
  };

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      if (field === "leaveType") {
        return {
          ...current,
          leaveType: value,
          leaveDays: isMaternityLeave(value) ? [] : current.leaveDays,
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
          /* The monetization fields leave with the type, so their messages go with them. */
          monetizationCreditCode: "",
          monetizationDays: "",
          monetizationDateFiled: "",
          maternityMonth: "",
          reason: "",
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
      ...(leaveTypeMatchesEmployeeGender(current.leaveType, matchedEmployee?.gender)
        ? current
        : {
            ...current,
            leaveType: "",
            leaveDays: [],
            reason: "",
            attachment: null,
            ...DEFAULT_LEAVE_REQUEST_DETAILS,
          }),
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

  const handleMonetizationChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  /*
   * The monetization filing answers to the CSC ceilings instead of the dates, the credits and the
   * attachment a leave is checked against, so it is validated on its own terms. The same ceilings
   * are enforced again by leave_monetization.php, which is the authority on them.
   */
  const validateMonetization = () => {
    const nextErrors = {};

    if (!form.employeeName.trim()) nextErrors.employeeName = "Employee name is required.";

    if (!monetizationOption) {
      nextErrors.monetizationCreditCode = "Select the leave credit to monetize.";
    }

    if (monetizationDays <= 0) {
      nextErrors.monetizationDays = "Enter the number of leave credits to monetize.";
    } else if (monetizationDaysError) {
      nextErrors.monetizationDays = monetizationDaysError;
    }

    if (!form.monetizationDateFiled) {
      nextErrors.monetizationDateFiled = "Date of filing is required.";
    }

    if (monetizationRequiresPurpose && !form.reason.trim()) {
      nextErrors.reason = `Monetizing ${formatMonetizationDays(monetizationDays)} day(s) is 50% or more of the ${formatMonetizationDays(monetizationAccumulatedDays)} accumulated credit(s). State the purpose of the monetization.`;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validate = () => {
    if (isMonetizationFiling) {
      return validateMonetization();
    }

    const nextErrors = {};

    if (!form.employeeName.trim()) nextErrors.employeeName = "Employee name is required.";
    if (!form.leaveType) nextErrors.leaveType = "Leave type is required.";
    if (!form.reason.trim()) nextErrors.reason = "Reason / Supporting Details is required.";
    if (form.leaveDays.length === 0) {
      nextErrors.leaveDays = "Select at least one leave date.";
    }

    /*
     * The picker already refuses these days, but a form left open past midnight can age into a past
     * date, so the rule is enforced again rather than trusted.
     */
    if (form.leaveDays.some((day) => isPastDate(day.date))) {
      nextErrors.leaveDays = "Leave dates cannot be in the past. Choose today or a later date.";
    }

    const advanceNoticeInvalid = isLeaveStartDateTooSoon({
      leaveType: form.leaveType,
      startDate: dateRange.startDate,
      filingDate: today,
    });
    if (advanceNoticeInvalid) {
      toast.error(LEAVE_ADVANCE_NOTICE_ERROR);
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
    return Object.keys(nextErrors).length === 0 && !advanceNoticeInvalid;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }

    /*
     * A different filing to a different endpoint, so it leaves through its own payload: the caller
     * reads `isLeaveMonetization` and posts it to leave_monetization.php.
     */
    if (isMonetizationFiling) {
      await onSubmit?.({
        isLeaveMonetization: true,
        employeeRecordId: canSelectEmployee ? form.employeeId : "",
        employeeName: form.employeeName,
        leaveTypeCode: form.monetizationCreditCode,
        numberOfDays: monetizationDays,
        dateFiled: form.monetizationDateFiled,
        reason: form.reason.trim(),
      });
      return;
    }

    if (chargesLeaveWithoutPay && !(await confirmLeaveWithoutPay(leaveWithoutPaySplit))) {
      return;
    }

    await onSubmit?.({
      ...form,
      /*
       * The picked days ride along inside the reason metadata, which the API reads back to work out
       * the span and the days applied for, so the list is dropped from the payload's own fields.
       */
      leaveDays: undefined,
      ...dateRange,
      acknowledgeLeaveWithoutPay: chargesLeaveWithoutPay ? "1" : "",
      numberOfDays: computedDays || 1,
      reason: packLeaveReason(form.reason, {
        vacationScope: form.vacationScope,
        vacationNote: form.vacationNote,
        sickLeaveMode: form.sickLeaveMode,
        sickLeaveIllness: form.sickLeaveIllness,
        studyLeavePurpose: form.studyLeavePurpose,
        maternityMonth: "",
        leaveDays: form.leaveDays,
      }),
      attachment: form.attachment,
      attachmentName: form.attachment?.name || "",
    });
  };

  // Keep the viewport overlay outside animated workspace ancestors, whose transforms would clip it.
  return createPortal((
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
            <p className="m-0 mt-1 text-sm text-slate-500">
              {isMonetizationFiling
                ? "Complete the form to submit a monetization of leave credits."
                : "Complete the form to submit a leave request."}
            </p>
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
                aria-label="Close"
                title="Close"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-5 sm:p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/*
              * Only admin needs this field — admin files on another employee's behalf and has to
              * say who. For everyone else it was a read-only echo of their own name, so it is gone;
              * the request still carries `employeeName` from the session user either way.
              */}
            {canSelectEmployee ? (
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Employee Name</span>
                <EmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={resolvedEmployee}
                  onSelect={handleEmployeeChange}
                  disabled={employeeOptions.length === 0}
                />
                {errors.employeeName ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.employeeName}</p> : null}
              </label>
            ) : errors.employeeName ? (
              /* No field left to correct it in, so the message stands on its own instead of vanishing. */
              <p className="m-0 text-xs text-rose-700 sm:col-span-2">{errors.employeeName}</p>
            ) : null}

            {/* Keep both primary controls in their own fixed row on every form layout. */}
            <div className="grid grid-cols-2 gap-4 sm:col-span-2">
              <label className={isMonetizationFiling ? "col-span-2" : undefined}>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Leave Type</span>
                <FloatingSelect
                  id="leave-request-type"
                  ariaLabel="Leave Type"
                  value={form.leaveType}
                  options={selectableLeaveTypes}
                  placeholder="Select Leave Type"
                  visibleThrough="Solo Parent Leave"
                  onChange={(value) => handleChange("leaveType")({ target: { value } })}
                />
                {errors.leaveType ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.leaveType}</p> : null}
              </label>

              {isMonetizationFiling ? null : (
                <div>
                  <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-700">
                      <CalendarDays size={15} className="shrink-0" />
                      <span className="truncate">{isMaternityFiling ? "Inclusive Dates" : "Leave Dates"}</span>
                    </span>
                    {isMaternityFiling ? (
                      <button
                        type="button"
                        onClick={handleSetMaternityDays}
                        className="shrink-0 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 transition hover:border-teal-300 hover:bg-teal-100"
                      >
                        Set 105 Days
                      </button>
                    ) : null}
                  </div>
                  {/*
                    * Days are picked one at a time, not as a span. Filing for the 2nd, 4th and 6th
                    * has to leave the 3rd and 5th as ordinary working days — a range would charge
                    * five days of credit for three days of leave and mark the employee absent on two
                    * days they were at their desk.
                    *
                    * Maternity is the one exception and stays a range: it is 105 continuous calendar
                    * days by law, which is what the "Set 105 Days" button above fills in from the
                    * start date. `closeOnSelect` goes with it — closing the calendar after every tap
                    * is right for a two-tap range and wrong when several days are being picked.
                    */}
                  <MultiDatePicker
                    value={form.leaveDays}
                    minDate={today}
                    allowWeekends={isMaternityFiling}
                    placeholder={isMaternityFiling ? "Select inclusive dates" : "Select leave dates"}
                    floating
                    closeOnSelect={isMaternityFiling}
                    selectionMode={isMaternityFiling ? "range" : "multiple"}
                    showRangeDuration={isMaternityFiling}
                    fullDayLabel="Full Day"
                    rangeLabel="Inclusive Date Range"
                    onChange={handleLeaveDaysChange}
                  />
                  {errors.leaveDays ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.leaveDays}</p> : null}
                </div>
              )}
            </div>

            {!isMonetizationFiling && computedDays > 0 ? (
              <p className="m-0 text-xs text-slate-500 sm:col-span-2">
                {isMaternityFiling ? (
                  `${formatLeaveDays(computedDays)} calendar day${computedDays === 1 ? "" : "s"} selected.`
                ) : (
                  <>
                    {formatLeaveDays(computedDays)} working day{computedDays === 1 ? "" : "s"} applied for across{" "}
                    {form.leaveDays.length} calendar date{form.leaveDays.length === 1 ? "" : "s"}.
                    {" "}Days in between that are not picked stay working days, and weekends cannot be picked.
                    {" "}Morning or afternoon counts a picked date as 0.5.
                  </>
                )}
              </p>
            ) : null}

            {isMonetizationFiling ? (
              <LeaveMonetizationFields
                employeeRecordId={canSelectEmployee ? form.employeeId : ""}
                creditCode={form.monetizationCreditCode}
                numberOfDays={form.monetizationDays}
                dateFiled={form.monetizationDateFiled}
                daysError={monetizationDaysError}
                needsJustification={monetizationRequiresPurpose}
                errors={errors}
                onChange={handleMonetizationChange}
                onSummaryChange={setMonetizationSummary}
              />
            ) : null}

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

            {chargesLeaveWithoutPay ? (
              <div className="sm:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="m-0 flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <AlertTriangle size={15} />
                  Insufficient {leaveWithoutPaySplit.leaveType} balance
                </p>
                <p className="m-0 mt-1 text-xs text-amber-800">
                  You have {formatLeaveDays(leaveWithoutPaySplit.remainingCredits)} day(s) of credits left.
                  Submitting files {formatLeaveDays(leaveWithoutPaySplit.paidDays)} day(s) with pay and
                  {" "}{formatLeaveDays(leaveWithoutPaySplit.unpaidDays)} day(s) as Leave Without Pay.
                </p>
              </div>
            ) : null}

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
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                {isMonetizationFiling ? "Purpose" : "Reason / Supporting Details"}
                {!isMonetizationFiling || monetizationRequiresPurpose ? <span className="text-rose-600"> *</span> : null}
              </span>
              <textarea
                rows={4}
                required={!isMonetizationFiling || monetizationRequiresPurpose}
                aria-invalid={Boolean(errors.reason)}
                value={form.reason}
                onChange={handleChange("reason")}
                placeholder={
                  isMonetizationFiling
                    ? (monetizationRequiresPurpose
                      ? "State the valid and justifiable reason for monetizing half or more of the credits"
                      : "Reason for monetizing the leave credits")
                    : "Enter your reason for requesting leave or supporting details."
                }
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
              />
              {errors.reason ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.reason}</p> : null}
            </label>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-4">
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
  ), document.body);
}
