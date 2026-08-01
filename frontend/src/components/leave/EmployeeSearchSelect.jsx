import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";

export default function EmployeeSearchSelect({
  employeeOptions = [],
  selectedEmployee = null,
  onSelect,
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

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

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
        <span className={selectedEmployee ? "text-slate-900" : "text-slate-400"}>
          {selectedEmployee
            ? selectedEmployee.employeeName
            : placeholder}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

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
        </div>
      ) : null}
    </div>
  );
}
