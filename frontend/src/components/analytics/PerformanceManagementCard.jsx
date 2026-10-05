import React from "react";
import { Activity } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AnalyticsCard,
  AnalyticsTooltip,
  categoryAxisProps,
  useAnalyticsTheme,
} from "./analyticsChartKit";

const SERIES = [
  { key: "ipcr", label: "IPCR", slot: 0 },
  { key: "opcr", label: "OPCR", slot: 1 },
];

function nullableRating(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? rating : null;
}

function formatRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) ? rating.toFixed(2) : "—";
}

/**
 * The points come from aggregate IPCR/OPCR rows returned by analytics.php. There is deliberately no
 * demo fallback here: when no completed rating exists, the card says so instead of drawing sample
 * scores that could be mistaken for employee performance.
 */
export default function PerformanceManagementCard({ data = {}, loading = false }) {
  const theme = useAnalyticsTheme();
  const chartData = (Array.isArray(data?.points) ? data.points : []).map((point) => ({
    label: point.label || "Rating",
    ipcr: nullableRating(point.ipcr),
    opcr: nullableRating(point.opcr),
  }));
  const visibleSeries = SERIES
    .filter((series) => chartData.some((point) => point[series.key] !== null))
    .map((series) => ({ ...series, color: theme.series[series.slot] }));
  return (
    <AnalyticsCard
      icon={Activity}
      accent={theme.series[0]}
      title="Performance Management"
      loading={loading}
      isEmpty={visibleSeries.length === 0}
      emptyMessage="No completed IPCR or OPCR ratings yet."
      emptyIcon={Activity}
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis dataKey="label" {...categoryAxisProps(theme)} minTickGap={12} />
          <YAxis
            domain={[1, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tickLine={false}
            axisLine={false}
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            width={28}
          />
          <Tooltip
            cursor={{ stroke: theme.baseline, strokeWidth: 1 }}
            content={<AnalyticsTooltip theme={theme} formatter={formatRating} />}
          />
          {visibleSeries.map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={series.color}
              strokeWidth={2.5}
              connectNulls
              dot={false}
              activeDot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  );
}
