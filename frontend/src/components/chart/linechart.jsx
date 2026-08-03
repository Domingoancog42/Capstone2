import React, { useEffect, useId, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCardShell from "./ChartCardShell";
import { numberFormatter } from "../../utils/format";

function LineChartSkeleton() {
  return (
    <div className="grid h-[320px] place-items-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-4">
      <div className="h-full w-full animate-pulse rounded-[24px] bg-[linear-gradient(180deg,rgba(15,118,110,0.12)_0%,rgba(14,165,233,0.04)_48%,rgba(248,250,252,0.8)_100%)]" />
    </div>
  );
}

function ChartEmptyState({ message }) {
  return (
    <div className="grid h-[320px] place-items-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-4 text-center">
      <div className="max-w-sm">
        <p className="m-0 text-base font-semibold text-slate-900">Trend lines unavailable</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
      </div>
    </div>
  );
}

export default function AnalyticsLineChart({
  title = "Line Analytics",
  description = "Interactive trend overview.",
  datasets = [],
  loading = false,
  emptyMessage = "Connect trend sources to populate this chart.",
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
        <LineChartSkeleton />
      ) : activeDataset && activeData.length > 0 ? (
        <>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={activeData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                <defs>
                  {(activeDataset.lines || []).map((line, index) => (
                    <linearGradient
                      key={`${line.dataKey}-stroke`}
                      id={`${gradientId}-${line.dataKey}-${index}`}
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                    >
                      <stop offset="0%" stopColor={line.color} stopOpacity={0.92} />
                      <stop offset="100%" stopColor={line.color} stopOpacity={0.65} />
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
                  contentStyle={{
                    borderRadius: "18px",
                    borderColor: "#dbeafe",
                    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.12)",
                  }}
                  formatter={(value, name) => [valueFormatter(value), name]}
                  labelFormatter={(label) => `${activeDataset.label}: ${label}`}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {(activeDataset.lines || []).map((line, index) => (
                  <Line
                    key={line.dataKey}
                    type="monotone"
                    dataKey={line.dataKey}
                    name={line.name}
                    stroke={`url(#${gradientId}-${line.dataKey}-${index})`}
                    strokeWidth={3}
                    dot={{
                      r: 3,
                      strokeWidth: 2,
                      fill: "#ffffff",
                      stroke: line.color,
                    }}
                    activeDot={{
                      r: 6,
                      strokeWidth: 2,
                      fill: "#ffffff",
                      stroke: line.color,
                    }}
                  />
                ))}
              </RechartsLineChart>
            </ResponsiveContainer>
          </div>

        </>
      ) : (
        <ChartEmptyState message={emptyMessage} />
      )}
    </ChartCardShell>
  );
}
