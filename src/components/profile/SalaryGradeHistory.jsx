import React, { useMemo } from "react";
import { History, LoaderCircle, TrendingUp } from "lucide-react";
import {
  compareServiceRecordsNewestFirst,
  formatServiceDate,
  formatServiceSalary,
  formatServiceTo,
} from "../../module/serviceRecord/serviceRecordUtils";

export function getCurrentSalaryGradeRecord(records = []) {
  const sortedRecords = (Array.isArray(records) ? records : [])
    .filter(Boolean)
    .slice()
    .sort(compareServiceRecordsNewestFirst);

  return sortedRecords.find((record) => record.isCurrent) || sortedRecords[0] || null;
}

export function formatSalaryGrade(value, fallback = "Not recorded") {
  const grade = String(value ?? "").trim();

  if (!grade) {
    return fallback;
  }

  return /^sg(?:\s|-)/i.test(grade) ? grade : `SG-${grade}`;
}

export function formatStepIncrement(value, fallback = "Not recorded") {
  const step = String(value ?? "").trim();

  if (!step) {
    return fallback;
  }

  return /^step(?:\s|-)/i.test(step) ? step : `Step ${step}`;
}

function CurrentBadge() {
  return (
    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
      Current
    </span>
  );
}

export default function SalaryGradeHistory({ records = [], loading = false, error = "" }) {
  const sortedRecords = useMemo(
    () => (Array.isArray(records) ? records : []).filter(Boolean).slice().sort(compareServiceRecordsNewestFirst),
    [records]
  );
  const gradeRecords = useMemo(
    () => sortedRecords.filter((record) => record.salaryGrade || record.stepIncrement),
    [sortedRecords]
  );
  const currentRecord = useMemo(() => getCurrentSalaryGradeRecord(sortedRecords), [sortedRecords]);

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center" aria-live="polite">
        <div>
          <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={25} aria-hidden="true" />
          <p className="m-0 mt-3 text-sm font-semibold text-slate-600">Loading salary grade history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800" role="alert">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Current salary grade">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-[#D61E1E]">
            <TrendingUp size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                {currentRecord && !currentRecord.isCurrent ? "Latest Recorded Placement" : "Current Placement"}
              </p>
              {currentRecord?.isCurrent ? <CurrentBadge /> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="m-0 text-lg font-extrabold text-slate-950">
                {formatSalaryGrade(currentRecord?.salaryGrade, "Salary grade not recorded")}
              </p>
              <p className="m-0 text-sm font-bold text-slate-600">
                {formatStepIncrement(currentRecord?.stepIncrement, "Step not recorded")}
              </p>
            </div>
            <p className="m-0 mt-1.5 text-xs font-medium text-slate-500">
              {currentRecord
                ? `Effective ${formatServiceDate(currentRecord.serviceFrom)}`
                : "No salary grade has been recorded for this employee."}
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Salary grade history entries">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <History size={17} className="text-slate-500" aria-hidden="true" />
            <h3 className="m-0 text-sm font-bold text-slate-950">Grade and Step History</h3>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {gradeRecords.length} {gradeRecords.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {gradeRecords.length > 0 ? (
          <>
            <div className="divide-y divide-slate-100 sm:hidden">
              {gradeRecords.map((record, index) => {
                const isCurrent = record === currentRecord;

                return (
                  <article key={`${record.id || record.serviceFrom || "grade"}-${index}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="m-0 text-sm font-bold text-slate-950">
                          {formatSalaryGrade(record.salaryGrade)} · {formatStepIncrement(record.stepIncrement)}
                        </p>
                        <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                          {formatServiceDate(record.serviceFrom)} – {isCurrent ? "Present" : formatServiceTo(record)}
                        </p>
                      </div>
                      {isCurrent ? <CurrentBadge /> : null}
                    </div>
                    <dl className="m-0 mt-3 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Monthly Salary</dt>
                        <dd className="m-0 mt-1 text-xs font-semibold text-slate-700">{formatServiceSalary(record.monthlySalary)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Position</dt>
                        <dd className="m-0 mt-1 text-xs font-semibold text-slate-700">{record.designationTitle || "—"}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>

            <div className="hidden max-h-[420px] overflow-auto sm:block">
              <table className="w-full min-w-[680px] border-collapse">
                <thead className="sticky top-0 z-[1] bg-slate-50">
                  <tr>
                    {["Effective Period", "Salary Grade", "Step Increment", "Monthly Salary", "Position"].map((label) => (
                      <th key={label} className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gradeRecords.map((record, index) => {
                    const isCurrent = record === currentRecord;

                    return (
                      <tr key={`${record.id || record.serviceFrom || "grade"}-${index}`} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-600">
                          <div className="flex items-center gap-2">
                            <span>{formatServiceDate(record.serviceFrom)} – {isCurrent ? "Present" : formatServiceTo(record)}</span>
                            {isCurrent ? <CurrentBadge /> : null}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-sm font-bold text-slate-950">{formatSalaryGrade(record.salaryGrade)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-700">{formatStepIncrement(record.stepIncrement)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums text-slate-700">{formatServiceSalary(record.monthlySalary)}</td>
                        <td className="px-3 py-3 text-sm text-slate-700">{record.designationTitle || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="px-4 py-10 text-center">
            <History className="mx-auto text-slate-300" size={28} aria-hidden="true" />
            <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No salary grade history yet</p>
            <p className="m-0 mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
              Salary grade and step increment entries will appear here after they are added to the employee’s service record.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
