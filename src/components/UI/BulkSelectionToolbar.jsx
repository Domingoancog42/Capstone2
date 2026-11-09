import React from "react";
import { Archive, Check, X } from "lucide-react";

export default function BulkSelectionToolbar({
  selectedCount = 0,
  approveCount = 0,
  archiveCount = 0,
  busy = false,
  approveLabel = "Approve selected",
  archiveLabel = "Archive selected",
  onApprove,
  onArchive,
  onClear,
}) {
  if (selectedCount <= 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="grid h-8 min-w-8 place-items-center rounded-full bg-teal-700 px-2 text-sm font-bold text-white">
          {selectedCount}
        </span>
        <div>
          <p className="m-0 text-sm font-semibold text-slate-900">
            {selectedCount} request{selectedCount === 1 ? "" : "s"} selected
          </p>
          <p className="m-0 text-xs text-slate-600">Choose an action for the selected rows.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {approveCount > 0 && onApprove ? (
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check size={16} />
            {approveLabel}{approveCount === selectedCount ? "" : ` (${approveCount})`}
          </button>
        ) : null}
        {archiveCount > 0 && onArchive ? (
          <button
            type="button"
            disabled={busy}
            onClick={onArchive}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-rose-700 px-3 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Archive size={16} />
            {archiveLabel}{archiveCount === selectedCount ? "" : ` (${archiveCount})`}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X size={15} />
          Clear
        </button>
      </div>
    </div>
  );
}
