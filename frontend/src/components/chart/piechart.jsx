import React, { useEffect, useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { numberFormatter } from "../../utils/format";
import { useReportsTheme } from "../../module/reports/reportsTheme";
import { RankedBarChart } from "../analytics/analyticsChartKit";

/**
 * Shared donut for part-to-whole at a glance.
 *
 * Callers own their own slice palette and are responsible for validating it. A pie
 * compares every slice against every other, so its palette must clear the
 * **all-pairs** gate (`--pairs all`), not the adjacent one — a palette that is fine
 * on a stacked bar can collapse here. Two hues that measure ΔE 0.4 apart under
 * deuteranopia are the same colour to that reader no matter how far apart their
 * slices sit on the ring.
 *
 * Keep it to six segments or fewer, and only when the reader's job is "roughly what
 * share" rather than "compare these values" — close values are a bar chart. Anything
 * ranked, or with a long tail, belongs in a ranked bar.
 *
 * This component supplies the chrome only: theme-aware surfaces, a 2px surface gap
 * between slices, a legend that always prints the name and value beside the swatch,
 * and a labelled legend so no value is reachable by colour alone.
 *
 * Pass `form="bar"` when the category list is longer than a donut can carry, or when
 * the reader's job is to compare values rather than eyeball a share. The bar form
 * needs no slice palette at all — every bar wears slot 1 — which is usually the
 * cheapest way out of an all-pairs failure.
 */

function PieChartSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-center">
      <div className="grid h-[320px] place-items-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="h-44 w-44 animate-pulse rounded-full border-[28px] border-slate-200 border-t-slate-300 dark:border-slate-700 dark:border-t-slate-600" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/40"
          />
        ))}
      </div>
    </div>
  );
}

function ChartEmptyState({ message }) {
  return (
    <div className="grid h-[320px] place-items-center rounded-[28px] border border-dashed border-slate-200 p-4 text-center dark:border-slate-700">
      <div className="max-w-sm">
        <p className="m-0 text-base font-semibold text-slate-900 dark:text-slate-100">
          No breakdown available
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{message}</p>
      </div>
    </div>
  );
}

/** Values lead, labels follow. */
function PieTooltip({ active, payload, theme, valueFormatter }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const entry = payload[0];

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: theme.surface, borderColor: theme.grid, color: theme.text }}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5" style={{ color: theme.textSecondary }}>
          <span
            className="inline-block h-0.5 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: entry.payload?.color || entry.color }}
            aria-hidden="true"
          />
          {entry.name}
        </span>
        <span className="font-semibold tabular-nums" style={{ color: theme.text }}>
          {valueFormatter(entry.value)}
        </span>
      </div>
    </div>
  );
}

export default function AnalyticsPieChart({
  title = "Pie Analytics",
  description = "Interactive distribution overview.",
  datasets = [],
  loading = false,
  emptyMessage = "Connect division, leave, or employee status sources to populate this chart.",
  compactLegend = false,
  className = "",
  form = "donut",
}) {
  const theme = useReportsTheme();
  const [activeDatasetId, setActiveDatasetId] = useState(datasets[0]?.id || "");

  useEffect(() => {
    if (!datasets.some((dataset) => dataset.id === activeDatasetId)) {
      setActiveDatasetId(datasets[0]?.id || "");
    }
  }, [activeDatasetId, datasets]);

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) || datasets[0] || null,
    [activeDatasetId, datasets]
  );

  const activeData = activeDataset?.data || [];
  const totalValue = activeData.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const valueFormatter = activeDataset?.valueFormatter || ((value) => numberFormatter.format(value));
  const hasData = activeDataset && activeData.length > 0;

  return (
    <section
      className={`flex h-full min-h-[300px] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 shadow-sm transition duration-300 hover:shadow-[0_20px_45px_rgba(15,23,42,0.08)] dark:border-slate-700/80 ${className}`.trim()}
      style={{ backgroundColor: theme.surface }}
    >
      <div className="flex flex-col gap-4 border-b border-slate-200/80 p-4 dark:border-slate-700/80 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="m-0 text-xl font-semibold leading-tight" style={{ color: theme.text }}>
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6" style={{ color: theme.textSecondary }}>
            {activeDataset?.description || description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {datasets.length > 1
            ? datasets.map((dataset) => {
                const isActive = dataset.id === activeDatasetId;

                return (
                  <button
                    key={dataset.id}
                    type="button"
                    onClick={() => setActiveDatasetId(dataset.id)}
                    data-active={isActive}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                      isActive
                        ? "border-slate-300 bg-slate-100 text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    {dataset.shortLabel || dataset.label}
                  </button>
                );
              })
            : null}

        </div>
      </div>

      <div className="flex flex-1 flex-col space-y-5 p-4">
        {loading ? (
          <PieChartSkeleton />
        ) : !hasData ? (
          <ChartEmptyState message={emptyMessage} />
        ) : form === "bar" ? (
          <div className="rounded-[28px] border border-slate-100 p-3 dark:border-slate-800">
            <RankedBarChart
              data={activeData.map((entry) => ({ label: entry.name, value: entry.value }))}
              theme={theme}
              seriesLabel={activeDataset.label || "Value"}
              valueFormatter={valueFormatter}
              labelWidth={150}
            />
            <p className="m-0 mt-2 px-2 text-xs" style={{ color: theme.textMuted }}>
              {`${activeDataset.centerLabel || "Total"}: ${valueFormatter(totalValue)}`}
            </p>
          </div>
        ) : (
          <div
            className={
              compactLegend
                ? "rounded-[28px] border border-slate-100 p-3 dark:border-slate-800"
                : "grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-center"
            }
          >
            <div
              className={
                compactLegend
                  ? "relative h-[240px]"
                  : "relative h-[320px] rounded-[28px] border border-slate-100 p-3 dark:border-slate-800"
              }
            >
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p
                  className="m-0 text-xs font-semibold uppercase tracking-[0.16em]"
                  style={{ color: theme.textMuted }}
                >
                  {activeDataset.centerLabel || "Total"}
                </p>
                {/* Proportional figures — this is a standalone value, not a column. */}
                <strong className="mt-2 text-xl font-semibold" style={{ color: theme.text }}>
                  {valueFormatter(totalValue)}
                </strong>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Tooltip content={<PieTooltip theme={theme} valueFormatter={valueFormatter} />} />
                  <Pie
                    data={activeData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={72}
                    outerRadius={110}
                    paddingAngle={1}
                    // A 2px gap in the surface colour, not a 4px ring of ink.
                    stroke={theme.surface}
                    strokeWidth={2}
                  >
                    {activeData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>

            {/* Name and value beside every swatch — identity never rests on colour alone. */}
            <div
              className={
                compactLegend
                  ? "mt-3 grid gap-x-6 gap-y-2 px-2 pb-2 sm:grid-cols-2 xl:grid-cols-3"
                  : "space-y-3"
              }
            >
              {activeData.map((entry) =>
                compactLegend ? (
                  <div key={entry.name} className="flex min-w-0 items-start gap-2">
                    <span
                      className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold leading-5" style={{ color: theme.text }}>
                        {entry.name}
                      </p>
                      <p className="m-0 text-sm" style={{ color: theme.textSecondary }}>
                        {valueFormatter(entry.value)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    key={entry.name}
                    className="rounded-2xl border border-slate-200 px-4 py-3 shadow-sm dark:border-slate-700"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: entry.color }}
                          aria-hidden="true"
                        />
                        <p className="m-0 text-sm font-semibold" style={{ color: theme.text }}>
                          {entry.name}
                        </p>
                      </div>
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
                        style={{ backgroundColor: theme.plane, color: theme.textSecondary }}
                      >
                        {totalValue > 0 ? Math.round((entry.value / totalValue) * 100) : 0}%
                      </span>
                    </div>
                    <p className="m-0 mt-2 text-sm" style={{ color: theme.textSecondary }}>
                      {valueFormatter(entry.value)}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
