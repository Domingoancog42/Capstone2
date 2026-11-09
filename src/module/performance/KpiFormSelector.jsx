import React from "react";

export default function KpiFormSelector({ records, selected, onSelect, disabled = false, id }) {
  if (records.length < 2) return null;
  return (
    <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-4 dark:border-accent-900 dark:bg-accent-950/20">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">KPI in this form ({records.length})</label>
      <select id={id} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15" disabled={disabled}
        value={String(selected?.id || "")} onChange={(event) => onSelect(records.find((record) => String(record.id) === event.target.value))}>
        {records.map((record, index) => <option key={record.id} value={record.id}>{index + 1}. {record.kpiTitle || record.output}</option>)}
      </select>
      <p className="m-0 mt-1.5 text-xs text-slate-500">Choose a KPI to review or edit. Save changes before switching KPIs.</p>
    </div>
  );
}
