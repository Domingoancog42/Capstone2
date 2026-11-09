import React from "react";
import { faPenToSquare, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { FileSpreadsheet } from "lucide-react";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ActionsMenu from "../../components/UI/ActionsMenu";
import RecordCards from "../../components/UI/RecordCards";
import {
  compareServiceRecordsNewestFirst,
  formatLwop,
  formatServiceDate,
  formatServiceSalary,
  formatServiceTo,
} from "./serviceRecordUtils";

/** The "Migrated" tag, shown wherever an entry came from the employee record rather than a document. */
function MigratedTag() {
  return (
    <span
      className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
      title="Created from the employee record when service records were introduced, not from an appointment document."
    >
      Migrated
    </span>
  );
}

/**
 * The CSC Form No. 1 grid, shared by the management workspace, the self-service view, and the
 * employee profile so all three show the same columns in the same order as the printed document.
 *
 * Below `lg` the eleven columns become one card per appointment instead. The printed form's column
 * order is what makes the table worth keeping on a wide screen; on a phone it only adds up to a
 * 1180px sideways drag, and each row is self-contained enough to stand on its own as a card.
 */
export default function ServiceRecordTable({
  records = [],
  canManage = false,
  onEdit,
  onArchive,
  loading = false,
}) {
  if (loading) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 px-4 py-12 text-center">
        <p className="m-0 text-sm font-semibold text-slate-500">Loading service record...</p>
      </div>
    );
  }

  if (!records.length) {
    return (
      <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-12 text-center">
        <div className="max-w-md">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
            <FileSpreadsheet size={21} aria-hidden="true" />
          </div>
          <p className="m-0 mt-4 text-sm font-semibold text-slate-900">No service record entries yet</p>
          <p className="m-0 mt-1.5 text-sm leading-6 text-slate-500">
            {canManage
              ? "Use Add Entry in the employee table to create the first appointment."
              : "Your service record has not been encoded yet. Contact the HR office."}
          </p>
        </div>
      </div>
    );
  }

  // Newest first with the current appointment on top, the same order the printed form uses.
  const orderedRecords = [...records].sort(compareServiceRecordsNewestFirst);

  const renderActions = (record) => (
    <>
      <ActionIconButton
        label="Edit entry"
        icon={faPenToSquare}
        tone="edit"
        onClick={() => onEdit?.(record)}
      />
      <ActionIconButton
        label="Remove entry"
        icon={faTrashCan}
        tone="delete"
        text="Remove"
        onClick={() => onArchive?.(record)}
      />
    </>
  );

  return (
    <>
      <RecordCards
        className="lg:hidden"
        items={orderedRecords}
        renderCard={(record) => ({
          eyebrow: `${formatServiceDate(record.serviceFrom)} - ${record.isCurrent ? "Present" : formatServiceTo(record)}`,
          title: record.designationTitle || "—",
          subtitle: [record.employmentStatus, record.stClassification].filter(Boolean).join(" · ") || "—",
          badge: record.isCurrent ? (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Present
            </span>
          ) : null,
          fields: [
            { label: "Monthly salary", value: formatServiceSalary(record.monthlySalary) },
            { label: "Salary / annum", value: formatServiceSalary(Number(record.monthlySalary) * 12) },
            { label: "LWOP", value: formatLwop(record.lwopDays) },
            { label: "Station", value: record.station || "—" },
            { label: "Branch", value: record.branch || "—" },
            {
              label: "Separation",
              value: record.separationDate
                ? `${formatServiceDate(record.separationDate)} - ${record.separationCause || "—"}`
                : "—",
              full: true,
            },
            {
              label: "Remarks",
              full: true,
              value: (
                <>
                  <span className="block">{record.remarks || "—"}</span>
                  {record.source === "migrated" ? <MigratedTag /> : null}
                </>
              ),
            },
          ],
          actions: canManage ? <ActionsMenu>{renderActions(record)}</ActionsMenu> : null,
        })}
      />

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 lg:block">
      <table className="w-full min-w-[1180px] border-collapse">
        <thead className="bg-slate-50">
          <tr>
            <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600" colSpan={2}>
              Service
            </th>
            <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600" colSpan={3}>
              Record of Appointment
            </th>
            <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600" rowSpan={2}>
              Station
            </th>
            <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600" rowSpan={2}>
              Branch
            </th>
            <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600" rowSpan={2}>
              LWOP
            </th>
            <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600" colSpan={2}>
              Separation
            </th>
            <th className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600" rowSpan={2}>
              Remarks
            </th>
            {canManage ? (
              <th className="border-b border-slate-200 px-3 py-3 text-right text-xs font-bold uppercase text-slate-600" rowSpan={2}>
                Actions
              </th>
            ) : null}
          </tr>
          <tr>
            {["From", "To", "Position", "Status", "Salary", "Date", "Cause"].map((header) => (
              <th
                key={header}
                className="border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-500"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedRecords.map((record) => (
            <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
              <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                {formatServiceDate(record.serviceFrom)}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-sm">
                {record.isCurrent ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    Present
                  </span>
                ) : (
                  <span className="text-slate-700">{formatServiceTo(record)}</span>
                )}
              </td>
              <td className="px-3 py-3 text-sm font-semibold text-slate-900">{record.designationTitle || "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                {record.employmentStatus || "—"}
                {record.stClassification ? (
                  <span className="block text-xs text-slate-500">{record.stClassification}</span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">
                {formatServiceSalary(record.monthlySalary)}
                {Number(record.monthlySalary) > 0 ? (
                  <span className="block text-xs text-slate-500">
                    {formatServiceSalary(Number(record.monthlySalary) * 12)} / annum
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-3 text-sm text-slate-700">{record.station || "—"}</td>
              <td className="px-3 py-3 text-sm text-slate-700">{record.branch || "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">{formatLwop(record.lwopDays)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                {record.separationDate ? formatServiceDate(record.separationDate) : "—"}
              </td>
              <td className="px-3 py-3 text-sm text-slate-700">{record.separationCause || "—"}</td>
              <td className="px-3 py-3 text-sm text-slate-500">
                <span className="block max-w-[220px] truncate" title={record.remarks || ""}>
                  {record.remarks || "—"}
                </span>
                {record.source === "migrated" ? <MigratedTag /> : null}
              </td>
              {canManage ? (
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  <ActionsMenu>{renderActions(record)}</ActionsMenu>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
