import React from "react";
import { LoaderCircle } from "lucide-react";

/**
 * The heading and the count tiles shared by the IPCR and OPCR workspaces.
 *
 * The title sits directly on the page beside an accent icon tile, as the Performance Hub screens
 * do, with the page's actions (Archive, Refresh, Bulk Assign KPI) pinned to its right. The counts
 * underneath are four unrelated numbers, each worth reading on its own, so each gets its own tile.
 * `intro` sits between the two, for what should be read first -- how the workflow works.
 *
 * These two screens are the only callers, and they set `hidePageIntro` on their module entries, so
 * the title here is the only one the page has.
 */

/* `accent` follows the color preference; `emerald` is the done/rated green, kept whatever the preference. */
const accents = {
  accent: "bg-accent-50 text-accent-600 dark:bg-accent-950/60 dark:text-accent-400",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/** One count: icon tile, small-caps label, the figure, and a line of context under it. */
function PerformanceMetric({ metric }) {
  const Icon = metric.icon;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800">
      <span className={`grid h-9 w-9 place-items-center rounded-lg ${accents[metric.accent] || accents.accent}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-[11px] font-medium uppercase leading-snug tracking-wide text-slate-500 sm:text-[12px]">{metric.label}</p>
        <p className="m-0 mt-0.5 text-2xl font-bold leading-tight tabular-nums text-slate-950">{metric.value}</p>
        {metric.sub ? <p className="m-0 mt-0.5 text-[12px] leading-snug text-slate-500">{metric.sub}</p> : null}
      </div>
    </div>
  );
}

export default function PerformanceWorkspaceHeader({
  title,
  description,
  icon: Icon,
  metrics = [],
  loading = false,
  action,
  intro = null,
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-950/60 dark:text-accent-400">
              <Icon size={20} aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="m-0 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
              {title}
            </h1>
            <p className="m-0 mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
            {loading ? (
              <p className="m-0 mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-accent-600" role="status">
                <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                Updating review records
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {intro}

      {metrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {metrics.map((metric) => (
            <PerformanceMetric key={metric.label} metric={metric} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
