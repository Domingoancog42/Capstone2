import React from "react";
import { Filter, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { getLeaveStatusDisplayLabel } from "./LeaveStatusBadge";

export default function LeaveFilters({
  values,
  divisions = [],
  statuses = [],
  roleKey = "",
  onChange,
  onClear,
}) {
  const handleChange = (field) => (event) => {
    onChange?.(field, event.target.value);
  };

  return (
    <section className="rounded-2xl border border-white/40 bg-white/75 p-4 shadow-sm backdrop-blur md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <Filter size={18} />
          </div>
          <div>
            <h3 className="m-0 text-sm font-semibold text-slate-900">Filter Leave Requests</h3>
            <p className="m-0 text-xs text-slate-500">Search, sort, and narrow down requests instantly.</p>
          </div>
        </div>

        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          onClick={onClear}
        >
          <RotateCcw size={15} />
          Clear Filters
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,220px)_150px_150px_120px_180px]">
        <label className="relative block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Search Employee
          </span>
          <Search size={16} className="pointer-events-none absolute left-2.5 top-[31px] text-slate-400" />
          <input
            type="text"
            value={values.search}
            onChange={handleChange("search")}
            placeholder="Name, type, reason, or rejected note"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-8 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Division
          </span>
          <select
            value={values.division}
            onChange={handleChange("division")}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All divisions</option>
            {divisions.map((division) => (
              <option key={division} value={division}>
                {division}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Leave Status
          </span>
          <select
            value={values.status}
            onChange={handleChange("status")}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {getLeaveStatusDisplayLabel(status, roleKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Rows Per Page
          </span>
          <select
            value={values.rowsPerPage}
            onChange={handleChange("rowsPerPage")}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
          >
            {[5, 10, 15, 25].map((size) => (
              <option key={size} value={size}>
                {size} rows
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sort
          </span>
          <div className="flex items-center gap-2">
            <select
              value={values.sortBy}
              onChange={handleChange("sortBy")}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
            >
              <option value="dateFiled">Date Filed</option>
              <option value="employeeName">Employee Name</option>
              <option value="division">Division</option>
              <option value="leaveType">Leave Type</option>
              <option value="status">Status</option>
              <option value="numberOfDays">Duration</option>
            </select>
            <button
              type="button"
              onClick={() =>
                onChange?.(
                  "sortDirection",
                  values.sortDirection === "asc" ? "desc" : "asc"
                )
              }
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="Toggle sort direction"
              title={values.sortDirection === "asc" ? "Ascending" : "Descending"}
            >
              <SlidersHorizontal size={16} />
            </button>
          </div>
        </label>
      </div>
    </section>
  );
}
