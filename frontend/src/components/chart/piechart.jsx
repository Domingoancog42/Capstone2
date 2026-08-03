import React, { useEffect, useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { numberFormatter } from "../../utils/format";

function PieChartSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-center">
      <div className="analytics-pie-chart-panel grid h-[320px] place-items-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80">
        <div className="h-44 w-44 animate-pulse rounded-full border-[28px] border-teal-100 border-t-teal-300" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="analytics-pie-chart-panel h-16 animate-pulse rounded-2xl border border-slate-200 bg-slate-50/80"
          />
        ))}
      </div>
    </div>
  );
}

function ChartEmptyState({ message }) {
  return (
    <div className="analytics-pie-chart-panel grid h-[320px] place-items-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-4 text-center">
      <div className="max-w-sm">
        <p className="m-0 text-base font-semibold text-slate-900">No breakdown available</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
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
}) {
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
  const canRenderChart = Boolean(ResponsiveContainer && RechartsPieChart && Tooltip && Pie && Cell);

  return (
    <section className={`analytics-card-shell flex h-full min-h-[300px] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-sm transition duration-300 hover:shadow-[0_20px_45px_rgba(15,23,42,0.08)] ${className}`.trim()}>
      <div className="flex flex-col gap-4 border-b border-slate-200/80 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="m-0 text-xl font-semibold leading-tight text-slate-900">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{activeDataset?.description || description}</p>
        </div>

        {datasets.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {datasets.map((dataset) => {
              const isActive = dataset.id === activeDatasetId;

              return (
                <button
                  key={dataset.id}
                  type="button"
                  onClick={() => setActiveDatasetId(dataset.id)}
                  data-active={isActive}
                  className={`analytics-dataset-toggle rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                    isActive
                      ? "border-teal-200 bg-teal-50 text-teal-800 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {dataset.shortLabel || dataset.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col space-y-5 p-4">
        {loading ? (
          <PieChartSkeleton />
        ) : !canRenderChart ? (
          <ChartEmptyState message="Chart components are unavailable in this environment." />
        ) : activeDataset && activeData.length > 0 ? (
          <div className={compactLegend ? "analytics-pie-chart-panel rounded-[28px] border border-slate-100 bg-slate-50/60 p-3" : "grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-center"}>
            <div className={compactLegend ? "relative h-[240px]" : "analytics-pie-chart-panel relative h-[320px] rounded-[28px] border border-slate-100 bg-slate-50/60 p-3"}>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {activeDataset.centerLabel || "Total"}
                </p>
                <strong className="mt-2 text-xl font-semibold text-slate-900">
                  {valueFormatter(totalValue)}
                </strong>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "18px",
                      borderColor: "#dbeafe",
                      boxShadow: "0 18px 40px rgba(15, 23, 42, 0.12)",
                    }}
                    formatter={(value, name) => [valueFormatter(value), name]}
                  />
                  <Pie
                    data={activeData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={72}
                    outerRadius={110}
                    paddingAngle={3}
                    stroke="#ffffff"
                    strokeWidth={4}
                  >
                    {activeData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>

            <div className={compactLegend ? "mt-3 grid gap-x-6 gap-y-2 px-2 pb-2 sm:grid-cols-2 xl:grid-cols-3" : "space-y-3"}>
              {activeData.map((entry) => (
                compactLegend ? (
                  <div key={entry.name} className="analytics-pie-chart-legend flex min-w-0 items-start gap-2">
                    <span
                      className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold leading-5 text-slate-900">{entry.name}</p>
                      <p className="m-0 text-sm text-slate-500">{valueFormatter(entry.value)}</p>
                    </div>
                  </div>
                ) : (
                  <div
                    key={entry.name}
                    className="analytics-pie-chart-legend rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: entry.color }}
                          aria-hidden="true"
                        />
                        <p className="m-0 text-sm font-semibold text-slate-900">{entry.name}</p>
                      </div>
                      <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {totalValue > 0 ? Math.round((entry.value / totalValue) * 100) : 0}%
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{valueFormatter(entry.value)}</p>
                  </div>
                )
              ))}
            </div>
          </div>
        ) : (
          <ChartEmptyState message={emptyMessage} />
        )}
      </div>
    </section>
  );
}
