import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import Button from "../../components/UI/button";
import {
  formatLwop,
  formatServiceDate,
  formatServiceSalary,
  formatServiceTo,
} from "./serviceRecordUtils";

/**
 * The CSC Form No. 1 grid, shared by the management workspace, the self-service view, and the
 * employee profile so all three show the same columns in the same order as the printed document.
 */
export default function ServiceRecordTable({ records = [], canManage = false, onEdit, onArchive, loading = false }) {
  if (loading) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-4 py-12 text-center">
        <p className="m-0 text-sm font-semibold text-slate-500">Loading service record...</p>
      </div>
    );
  }

  if (!records.length) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-4 py-12 text-center">
        <div className="max-w-md">
          <p className="m-0 text-sm font-semibold text-slate-700">No service record entries yet</p>
          <p className="m-0 mt-1.5 text-sm text-slate-500">
            {canManage
              ? "Add the first appointment to start this employee's record."
              : "Your service record has not been encoded yet. Contact the HR office."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[1180px] border-collapse">
        <thead className="bg-slate-50">
          <tr>
            <th className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500" colSpan={2}>
              Service
            </th>
            <th className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500" colSpan={3}>
              Record of Appointment
            </th>
            <th className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500" rowSpan={2}>
              Station
            </th>
            <th className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500" rowSpan={2}>
              Branch
            </th>
            <th className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500" rowSpan={2}>
              LWOP
            </th>
            <th className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500" colSpan={2}>
              Separation
            </th>
            <th className="border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500" rowSpan={2}>
              Remarks
            </th>
            {canManage ? (
              <th className="border-b border-slate-200 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500" rowSpan={2}>
                Actions
              </th>
            ) : null}
          </tr>
          <tr>
            {["From", "To", "Designation", "Status", "Salary", "Date", "Cause"].map((header) => (
              <th
                key={header}
                className="border-b border-slate-200 px-3 py-2 text-left text-[11px] font-medium text-slate-400"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
              <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-700">
                {formatServiceDate(record.serviceFrom)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-sm">
                {record.isCurrent ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    Present
                  </span>
                ) : (
                  <span className="text-slate-700">{formatServiceTo(record)}</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-sm font-semibold text-slate-900">{record.designationTitle || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-700">{record.employmentStatus || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">
                {formatServiceSalary(record.monthlySalary)}
              </td>
              <td className="px-3 py-2.5 text-sm text-slate-700">{record.station || "—"}</td>
              <td className="px-3 py-2.5 text-sm text-slate-700">{record.branch || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-700">{formatLwop(record.lwopDays)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-700">
                {record.separationDate ? formatServiceDate(record.separationDate) : "—"}
              </td>
              <td className="px-3 py-2.5 text-sm text-slate-700">{record.separationCause || "—"}</td>
              <td className="px-3 py-2.5 text-sm text-slate-500">
                <span className="block max-w-[220px] truncate" title={record.remarks || ""}>
                  {record.remarks || "—"}
                </span>
                {record.source === "migrated" ? (
                  <span
                    className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                    title="Created from the employee record when service records were introduced, not from an appointment document."
                  >
                    Migrated
                  </span>
                ) : null}
              </td>
              {canManage ? (
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <div className="inline-flex gap-1.5">
                    <Button variant="icon" size="sm" icon={Pencil} aria-label="Edit entry" onClick={() => onEdit?.(record)} />
                    <Button
                      variant="icon"
                      size="sm"
                      icon={Trash2}
                      aria-label="Remove entry"
                      onClick={() => onArchive?.(record)}
                    />
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
