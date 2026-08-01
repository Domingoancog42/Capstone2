import React, { useEffect, useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCardShell from "./ChartCardShell";
import { numberFormatter } from "../../utils/format";

function BarChartSkeleton() {
  return (
    <div className="grid h-[320px] grid-cols-7 items-end gap-3 rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-6">
      {[46, 68, 82, 60, 94, 72, 88].map((height, index) => (
        <div
          key={height + index}
          className="animate-pulse rounded-t-3xl bg-gradient-to-t from-teal-200 via-teal-100 to-slate-50"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function ChartEmptyState({ message }) {
  return (
    <div className="grid h-[320px] place-items-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center">
      <div className="max-w-sm">
        <p className="m-0 text-base font-semibold text-slate-900">No analytics data yet</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
      </div>
    </div>
  );
}

export default function AnalyticsBarChart({
  title = "Bar Analytics",
  description = "Interactive chart overview.",
  datasets = [],
  loading = false,
  emptyMessage = "Connect attendance, division, or payroll sources to populate this chart.",
}) {
  const [activeDatasetId, setActiveDatasetId] = useState(datasets[0]?.id || "");
  const gradientId = useId().replace(/:/g, "");

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
  const valueFormatter = activeDataset?.valueFormatter || ((value) => numberFormatter.format(value));

  return (
    <ChartCardShell
      title={title}
      description={activeDataset?.description || description}
      datasets={datasets}
      activeDatasetId={activeDatasetId}
      onSelectDataset={setActiveDatasetId}
    >
      {loading ? (
        <BarChartSkeleton />
      ) : activeDataset && activeData.length > 0 ? (
        <>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart
                data={activeData}
                margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                barCategoryGap={18}
              >
                <defs>
                  {(activeDataset.bars || []).map((bar, index) => (
                    <linearGradient
                      key={`${bar.dataKey}-gradient`}
                      id={`${gradientId}-${bar.dataKey}-${index}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={bar.color} stopOpacity={0.95} />
                      <stop offset="95%" stopColor={bar.color} stopOpacity={0.7} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#cbd5e1" opacity={0.55} />
                <XAxis
                  dataKey={activeDataset.xKey || "label"}
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                  fontSize={12}
                  stroke="#64748b"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  fontSize={12}
                  stroke="#64748b"
                  tickFormatter={activeDataset.yAxisFormatter || valueFormatter}
                />
                <Tooltip
                  cursor={{ fill: "rgba(15, 118, 110, 0.06)" }}
                  contentStyle={{
                    borderRadius: "18px",
                    borderColor: "#dbeafe",
                    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.12)",
                  }}
                  formatter={(value, name) => [valueFormatter(value), name]}
                  labelFormatter={(label) => `${activeDataset.label}: ${label}`}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {(activeDataset.bars || []).map((bar, index) => (
                  <Bar
                    key={bar.dataKey}
                    dataKey={bar.dataKey}
                    name={bar.name}
                    fill={`url(#${gradientId}-${bar.dataKey}-${index})`}
                    radius={[12, 12, 4, 4]}
                    maxBarSize={42}
                  />
                ))}
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>

        </>
      ) : (
        <ChartEmptyState message={emptyMessage} />
      )}
    </ChartCardShell>
  );
}
