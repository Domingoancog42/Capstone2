import React, { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import SelectionCheckbox from "../../components/UI/SelectionCheckbox";

const NO_DIVISION = "__no_division__";

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Payroll deducts loans from Regular employees only (payroll_fetch_approved_loan_deduction_items). */
function isPayrollDeducted(employee) {
  return !employee.employmentStatus || normalizeKey(employee.employmentStatus) === "regular";
}

/**
 * Checklist for filing one loan per employee. The division filter narrows the list to that
 * division's employees; what is already checked stays checked when the division changes, so one
 * batch can span several divisions. "Select all" covers only the employees the filters show.
 */
export default function LoanEmployeeChecklist({
  employees = [],
  selectedIds = [],
  onChange,
  loading = false,
  inputClassName = "",
}) {
  const [division, setDivision] = useState("");
  const [search, setSearch] = useState("");

  const divisions = useMemo(
    () => [...new Set(employees.map((employee) => employee.division).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [employees]
  );
  const hasUnassigned = employees.some((employee) => !employee.division);
  const selected = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);

  const visibleEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees
      .filter((employee) => !division || (division === NO_DIVISION ? !employee.division : employee.division === division))
      .filter((employee) => !term || [employee.employeeName, employee.employeeId, employee.position]
        .some((value) => String(value || "").toLowerCase().includes(term)))
      .sort((left, right) => left.employeeName.localeCompare(right.employeeName));
  }, [division, employees, search]);

  const visibleIds = visibleEmployees.map((employee) => String(employee.employeeRecordId));
  const visibleSelectedCount = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const selectedEmployees = employees.filter((employee) => selected.has(String(employee.employeeRecordId)));
  const notDeductedCount = selectedEmployees.filter((employee) => !isPayrollDeducted(employee)).length;
  const scopeLabel = division === NO_DIVISION ? "without a division" : division ? `in ${division}` : "shown";

  const toggleEmployee = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const toggleVisible = () => {
    const next = new Set(selected);
    visibleIds.forEach((id) => {
      if (allVisibleSelected) next.delete(id);
      else next.add(id);
    });
    onChange([...next]);
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <select
          value={division}
          onChange={(event) => setDivision(event.target.value)}
          className={inputClassName}
          aria-label="Filter employees by division"
          disabled={loading}
        >
          <option value="">All Divisions</option>
          {divisions.map((name) => <option key={name} value={name}>{name}</option>)}
          {hasUnassigned ? <option value={NO_DIVISION}>No division</option> : null}
        </select>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, employee ID, or position..."
            className={`${inputClassName} pl-10`}
            aria-label="Search employees"
            disabled={loading}
          />
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <label className="flex min-w-0 cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <SelectionCheckbox
              checked={allVisibleSelected}
              indeterminate={visibleSelectedCount > 0 && !allVisibleSelected}
              onChange={toggleVisible}
              disabled={loading || visibleIds.length === 0}
              label={`Select all employees ${scopeLabel}`}
            />
            <span className="truncate">Select all {scopeLabel} ({visibleIds.length})</span>
          </label>
          <span className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{selected.size} selected</span>
        </div>

        <ul className="m-0 max-h-64 list-none divide-y divide-slate-100 overflow-y-auto p-0 dark:divide-slate-800" aria-label="Employees">
          {loading ? (
            <li className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Loading employees...</li>
          ) : visibleEmployees.length ? (
            visibleEmployees.map((employee) => {
              const id = String(employee.employeeRecordId);
              const checked = selected.has(id);
              const details = [employee.employeeId, employee.position, division ? "" : employee.division].filter(Boolean).join(" · ");

              return (
                <li key={id}>
                  <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30 ${checked ? "bg-emerald-50 dark:bg-emerald-950/40" : ""}`}>
                    <SelectionCheckbox checked={checked} onChange={() => toggleEmployee(id)} label={`Select ${employee.employeeName}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{employee.employeeName || "Employee"}</span>
                      {details ? <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{details}</span> : null}
                    </span>
                    {employee.status && employee.status !== "Active" ? (
                      <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{employee.status}</span>
                    ) : null}
                    {!isPayrollDeducted(employee) ? (
                      <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">{employee.employmentStatus}</span>
                    ) : null}
                  </label>
                </li>
              );
            })
          ) : (
            <li className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {employees.length ? "No employees match this division or search." : "No employees available."}
            </li>
          )}
        </ul>
      </div>

      {selectedEmployees.length ? (
        <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto">
          {selectedEmployees.map((employee) => (
            <span key={employee.employeeRecordId} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 py-0.5 pl-2 pr-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span className="truncate">{employee.employeeName}</span>
              <button
                type="button"
                onClick={() => toggleEmployee(String(employee.employeeRecordId))}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
                aria-label={`Remove ${employee.employeeName}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-lg px-2 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {notDeductedCount ? (
        <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {notDeductedCount === 1 ? "1 selected employee is" : `${notDeductedCount} selected employees are`} not Regular. Payroll only deducts loans of Regular employees, so their payments have to be recorded with the Pay button.
        </p>
      ) : null}
    </div>
  );
}
