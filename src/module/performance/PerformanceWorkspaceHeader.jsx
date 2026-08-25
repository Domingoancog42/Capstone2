import React from "react";
import { LoaderCircle } from "lucide-react";

/**
 * The heading and the count row shared by the IPCR and OPCR workspaces.
 *
 * Neither half is a card. The title is plain text sitting directly on the page — it names the screen
 * the user has already navigated to, so boxing it up added a border, a shadow and an accent bar
 * around something nobody needed drawing to. The counts underneath are the opposite case: four
 * unrelated numbers, each worth reading on its own, so each gets its own box rather than sharing one
 * strip carved up by dividers.
 *
 * These two screens are the only callers, and they set `hidePageIntro` on their module entries, so
 * the title here is the only one the page has.
 */

/** One count. A box of its own, which is what keeps the four readable as four separate figures. */
function PerformanceMetric({ metric }) {
  const Icon = metric.icon;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${metric.tone}`}>
        <Icon size={17} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="m-0 text-xl font-bold leading-none tabular-nums text-slate-950">
          {metric.value}
        </p>
        <p className="m-0 mt-1 truncate text-xs font-medium text-slate-500">{metric.label}</p>
      </div>
    </div>
  );
}

export default function PerformanceWorkspaceHeader({
  title,
  description,
  metrics = [],
  loading = false,
  action,
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
            {title}
          </h1>
          <p className="m-0 mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
          {loading ? (
            <p className="m-0 mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400" role="status">
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
              Updating review records
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {metrics.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <PerformanceMetric key={metric.label} metric={metric} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
