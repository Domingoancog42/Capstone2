import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Search, X } from "lucide-react";

export default function EmployeeSearchSelect({
  employeeOptions = [],
  selectedEmployee = null,
  selectedEmployees = [],
  multiple = false,
  onSelect,
  onClear,
  disabled = false,
  placeholder = "Search employee...",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return employeeOptions;
    }

    return employeeOptions.filter((employee) =>
      [employee.employeeName, employee.employeeId, employee.division]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [employeeOptions, query]);

  const selectedIds = useMemo(
    () => new Set(
      (multiple ? selectedEmployees : [selectedEmployee])
        .filter(Boolean)
        .map((employee) => String(employee.employeeRecordId))
    ),
    [multiple, selectedEmployee, selectedEmployees]
  );

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const triggerLabel = multiple
    ? (selectedIds.size === 0
      ? placeholder
      : selectedIds.size === 1
        ? selectedEmployees[0]?.employeeName
        : `${selectedIds.size} employees selected`)
    : (selectedEmployee ? selectedEmployee.employeeName : placeholder);

  const hasSelection = multiple ? selectedIds.size > 0 : Boolean(selectedEmployee);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-[46px] w-full items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 text-left text-sm outline-none transition ${
          disabled
            ? "cursor-not-allowed bg-slate-50 text-slate-500"
            : "bg-white text-slate-900 hover:border-slate-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        }`}
      >
        <span className={hasSelection ? "text-slate-900" : "text-slate-400"}>
          {triggerLabel}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {multiple && selectedEmployees.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedEmployees.map((employee) => (
            <span
              key={employee.employeeRecordId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800"
            >
              {employee.employeeName}
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${employee.employeeName}`}
                  onClick={() => onSelect?.(employee)}
                  className="grid h-4 w-4 place-items-center rounded text-teal-700 transition hover:bg-teal-100"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}

      {open && !disabled ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-200 p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {filteredOptions.length === 0 ? (
              <p className="m-0 rounded-xl px-3 py-3 text-sm text-slate-500">No employees found.</p>
            ) : multiple ? (
              filteredOptions.map((employee) => (
                <label
                  key={employee.employeeRecordId}
                  className="flex w-full cursor-pointer items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(String(employee.employeeRecordId))}
                    onChange={() => onSelect?.(employee)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-teal-700"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{employee.employeeName}</span>
                    <span className="block text-xs text-slate-500">
                      {employee.division || "No division assigned"}
                    </span>
                  </span>
                </label>
              ))
            ) : filteredOptions.map((employee) => (
              <button
                key={employee.employeeRecordId}
                type="button"
                onClick={() => {
                  onSelect?.(employee);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-start justify-between rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{employee.employeeName}</span>
                  <span className="block text-xs text-slate-500">
                    {employee.division || "No division assigned"}
                  </span>
                </span>
                {selectedEmployee?.employeeRecordId === employee.employeeRecordId ? (
                  <Check size={15} className="mt-0.5 text-teal-700" />
                ) : null}
              </button>
            ))}
          </div>

          {multiple ? (
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-500">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onClear?.()}
                  disabled={selectedIds.size === 0}
                  className="inline-flex min-h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  className="inline-flex min-h-8 items-center justify-center rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white transition hover:bg-teal-800"
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
