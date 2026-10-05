import React from "react";
import { Archive, ArrowLeft } from "lucide-react";

/**
 * The "Archive" / "Back to …" switch that sits in a module's header, matching the control the
 * employee directory has had. Every module that can archive shows the same button in the same place
 * so the gesture is learned once.
 *
 * Deliberately a plain button rather than the shared `Button` component: the modules that need this
 * do not agree on which button library they use in their headers — some use `Button`, some hand-roll
 * an anchor-styled element — and this has to look the same in all of them.
 */
export default function ArchiveViewToggle({
  archiveView = false,
  onToggle,
  label = "records",
  count = null,
  className = "",
}) {
  return (
    <button
      type="button"
      aria-pressed={archiveView}
      onClick={() => onToggle?.(!archiveView)}
      className={`inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
        archiveView
          ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      } ${className}`.trim()}
    >
      {archiveView ? <ArrowLeft size={16} /> : <Archive size={16} />}
      {archiveView ? `Back to ${label}` : "Archive"}
      {/* Only worth showing on the way in — inside the archive the table is the count. */}
      {!archiveView && count > 0 ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">
          {count}
        </span>
      ) : null}
    </button>
  );
}
