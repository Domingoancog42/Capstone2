import React from "react";
import { CalendarDays } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber, useReportsTheme } from "../../module/reports/reportsTheme";

const CHART_HEIGHT = 260;

function formatDate(value) {
  const date = new Date(String(value || "").replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return String(value || "No date");
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Mirrors the tooltip the Attendance Trend report chart uses. */
function TrendTooltip({ active, payload, label, theme }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: theme.surface, borderColor: theme.grid, color: theme.text }}
    >
      <p className="m-0 mb-1.5 font-semibold" style={{ color: theme.text }}>
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5" style={{ color: theme.textSecondary }}>
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            {entry.name}
          </span>
          <span className="font-semibold tabular-nums" style={{ color: theme.text }}>
            {formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Present / absent / late per day, plotted the same way as the Attendance Trend chart in the
 * attendance report so the two screens read identically — same three series, same palette, same
 * copy. The counts come from the same SQL expressions (see `get_attendance_trend` in analytics.php).
 */
export default function AttendanceTrendCard({ data = [], loading = false }) {
  const theme = useReportsTheme();

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-4 shadow-md">
        <div className="mb-4 h-6 w-1/2 rounded bg-gray-200" />
        <div className="h-24 rounded bg-gray-100" />
      </div>
    );
  }

  // The query returns newest first; a trend line reads left to right.
  const chartData = [...data]
    .reverse()
    .slice(-30)
    .map((item) => ({
      label: formatDate(item.attendance_date),
      present: Number(item.present_count || 0),
      absent: Number(item.absent_count || 0),
      late: Number(item.late_count || 0),
    }));

  const series = [
    { key: "present", label: "Present", color: theme.series[2] },
    { key: "absent", label: "Absent", color: theme.series[1] },
    { key: "late", label: "Late", color: theme.series[3] },
  ];

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-4 shadow-md transition-shadow duration-300 hover:shadow-lg">
      <header className="mb-3">
        <h3 className="m-0 text-sm font-semibold leading-tight text-slate-900">Attendance Trend</h3>
        <p className="m-0 mt-1 text-xs leading-relaxed text-slate-500">
          Present, absent, and late counts per day across the selected range.
        </p>
      </header>

      {chartData.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-slate-200 px-4 text-center text-sm text-slate-500">
          <div>
            <CalendarDays className="mx-auto mb-2 h-10 w-10 text-slate-300" aria-hidden="true" />
            <p className="m-0">No data available for the selected filters.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: theme.baseline }}
                tick={{ fill: theme.textMuted, fontSize: 11 }}
                minTickGap={12}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: theme.textMuted, fontSize: 11 }}
                width={52}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ stroke: theme.baseline, strokeWidth: 1 }}
                content={<TrendTooltip theme={theme} />}
              />
              {series.map((entry) => (
                <Line
                  key={entry.key}
                  type="monotone"
                  dataKey={entry.key}
                  name={entry.label}
                  stroke={entry.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Identity never rests on colour alone. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {series.map((entry) => (
              <span
                key={entry.key}
                className="flex items-center gap-1.5 text-xs font-medium"
                style={{ color: theme.textSecondary }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden="true"
                />
                {entry.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
