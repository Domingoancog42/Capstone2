import React from "react";
import InputField from "../../components/UI/InputField";

/**
 * Compact target picker shared by the IPCR and OPCR assignment dialogs.
 *
 * Assignment used to occupy a full workspace tab. Keeping the roster in this focused panel makes
 * the complete flow available beside the KPI form without forcing users to move between surfaces.
 */
export default function KpiAssignmentTargetPicker({
  description,
  query,
  onQueryChange,
  searchPlaceholder,
  divisionFilter,
  onDivisionFilterChange,
  divisions = [],
  // A desk confined to one division (a chief's) shows that division alone and cannot change it.
  divisionLocked = false,
  items = [],
  selectedCount = 0,
  allVisibleSelected = false,
  onToggleAll,
  isSelected,
  onToggle,
  itemKey,
  itemTitle,
  itemMeta,
  itemDetail,
  emptyMessage,
}) {
  return (
    <section className="flex min-h-0 flex-col bg-white lg:border-r lg:border-slate-200">
      <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="m-0 flex items-center gap-2 text-base font-semibold text-slate-950">
              <span className="h-2 w-2 rounded-full bg-accent-500" aria-hidden="true" />
              KPI Assignment
            </h3>
            <p className="mb-0 mt-1 text-sm leading-5 text-slate-500">{description}</p>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums ${
              selectedCount > 0
                ? "border-accent-200 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-950/60 dark:text-accent-300"
                : "border-slate-200 bg-slate-100 text-slate-600"
            }`}
          >
            {selectedCount} selected
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_180px]">
          <InputField
            label="Search Employees"
            name="assignmentTargetSearch"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search assignment targets"
            inputClassName="text-sm focus:ring-2 focus:ring-accent-500/15"
          />
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Division</span>
            <select
              value={divisionFilter}
              disabled={divisionLocked}
              onChange={(event) => onDivisionFilterChange(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
            >
              {divisionLocked ? (
                <option value={divisionFilter}>{divisionFilter || "No assigned division"}</option>
              ) : (
                <>
                  <option value="">All divisions</option>
                  {divisions.map((division) => (
                    <option key={division} value={division}>{division}</option>
                  ))}
                </>
              )}
            </select>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 sm:px-5">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={onToggleAll}
            disabled={items.length === 0}
            className="h-4 w-4 rounded border-slate-300 accent-accent-600"
          />
          Select all shown
        </label>
        <span className="text-xs text-slate-500">{items.length} shown</span>
      </div>

      <div className="min-h-[280px] flex-1 overflow-y-auto p-2 lg:max-h-[58dvh]">
        {items.length > 0 ? (
          <div className="space-y-1">
            {items.map((item, index) => {
              const key = itemKey(item, index);
              const selected = isSelected(item);
              const detail = itemDetail?.(item);

              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                    selected
                      ? "border-accent-300 bg-accent-50/60 dark:border-accent-800 dark:bg-accent-950/30"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(item)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-accent-600"
                    aria-label={`Select ${itemTitle(item)}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{itemTitle(item)}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{itemMeta(item)}</span>
                    {detail ? (
                      <span className="mt-1.5 block line-clamp-2 text-xs leading-4 text-slate-600">{detail}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-[280px] place-items-center px-6 text-center text-sm text-slate-500">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  );
}
