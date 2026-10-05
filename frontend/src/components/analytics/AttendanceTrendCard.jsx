import React, { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber, useReportsTheme } from "../../module/reports/reportsTheme";

const CHART_HEIGHT = 260;
/* Bars stay thin; the band's leftover is air, never a filled slot. */
const MAX_BAR_SIZE = 24;
/* The surface colour doing the separating between stacked segments, in px. */
const SEGMENT_GAP = 2;
/* A rounded data-end on the top of each column; the baseline end stays square. */
const CAP_RADIUS = 4;

/*
 * Stack order from the baseline up, and the theme slot each series wears everywhere in the app
 * (the Attendance Trend report chart uses the same three). Present sits on the baseline because it
 * is the bulk of every day; the two exceptions stack on top of it. The order was also checked with
 * the palette validator: orange (Absent) and amber never touch, because adjacent they fall below
 * the normal-vision floor, which is why Late wears the blue slot rather than amber.
 */
const SERIES = [
  { key: "present", label: "Present", slot: 2 },
  { key: "absent", label: "Absent", slot: 1 },
  { key: "late", label: "Late", slot: 0 },
];

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

/**
 * One segment of a stacked column. Recharts hands every segment a touching rectangle; this gives
 * up 2px at the top of any segment that has another above it so the surface separates them, and
 * rounds the top of whichever segment is actually topmost in its column — which is not always the
 * last series, since a day with no late arrivals ends on the Absent segment instead.
 */
function StackSegment({ x, y, width, height, fill, dataKey, payload }) {
  if (!(height > 0) || !(width > 0)) {
    return null;
  }

  const index = SERIES.findIndex((entry) => entry.key === dataKey);
  const isTopmost = SERIES.slice(index + 1).every((entry) => Number(payload?.[entry.key] || 0) === 0);
  const gap = isTopmost ? 0 : Math.min(SEGMENT_GAP, height);
  const top = y + gap;
  const drawHeight = height - gap;

  if (drawHeight <= 0) {
    return null;
  }

  if (!isTopmost) {
    return <rect x={x} y={top} width={width} height={drawHeight} fill={fill} />;
  }

  const radius = Math.min(CAP_RADIUS, drawHeight, width / 2);
  const right = x + width;
  const bottom = top + drawHeight;
  const path = [
    `M${x},${bottom}`,
    `V${top + radius}`,
    `Q${x},${top} ${x + radius},${top}`,
    `H${right - radius}`,
    `Q${right},${top} ${right},${top + radius}`,
    `V${bottom}`,
    "Z",
  ].join(" ");

  return <path d={path} fill={fill} />;
}

/** Mirrors the tooltip the Attendance Trend report chart uses, plus the column's total. */
function TrendTooltip({ active, payload, label, theme }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const total = payload.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: theme.surface, borderColor: theme.grid, color: theme.text }}
    >
      <p className="m-0 mb-1.5 font-semibold" style={{ color: theme.text }}>
        {label}
      </p>
      {[...payload].reverse().map((entry) => (
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
      <div
        className="mt-1 flex items-center justify-between gap-4 border-t pt-1"
        style={{ borderColor: theme.grid, color: theme.textSecondary }}
      >
        <span>Recorded</span>
        <span className="font-semibold tabular-nums" style={{ color: theme.text }}>
          {formatNumber(total)}
        </span>
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Attendance trend view">
      {[
        { key: "chart", label: "Chart" },
        { key: "table", label: "Table" },
      ].map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={view === option.key}
          onClick={() => onChange(option.key)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
            view === option.key
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Present / absent / late per day as one stacked column per period, so each day reads as a whole
 * split three ways. The counts come from the same SQL expressions as the Attendance Trend report
 * (see `get_attendance_trend` in analytics.php) and the three series wear the same theme slots
 * there, so the two screens agree. The three are exclusive — a late arrival is recorded as Late,
 * not Present — which is what makes the stack honest; days without records simply have no column.
 */
export default function AttendanceTrendCard({ data = [], loading = false }) {
  const theme = useReportsTheme();
  const [view, setView] = useState("chart");

  // The query returns newest first; a trend reads left to right.
  const chartData = useMemo(
    () => [...data]
      .reverse()
      .slice(-30)
      .map((item) => ({
        label: formatDate(item.attendance_date),
        date: item.attendance_date,
        present: Number(item.present_count || 0),
        absent: Number(item.absent_count || 0),
        late: Number(item.late_count || 0),
      })),
    [data]
  );

  const series = SERIES.map((entry) => ({ ...entry, color: theme.series[entry.slot] }));

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-4 shadow-md">
        <div className="mb-4 h-6 w-1/2 rounded bg-gray-200" />
        <div className="h-24 rounded bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-4 shadow-md transition-shadow duration-300 hover:shadow-lg">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-sm font-semibold leading-tight text-slate-900">Attendance Trend</h3>
          <p className="m-0 mt-0.5 text-xs text-slate-500">Present, absent and late employees per day</p>
        </div>
        {chartData.length > 0 ? <ViewToggle view={view} onChange={setView} /> : null}
      </header>

      {chartData.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-slate-200 px-4 text-center text-sm text-slate-500">
          <div>
            <CalendarDays className="mx-auto mb-2 h-10 w-10 text-slate-300" aria-hidden="true" />
            <p className="m-0">No data available for the selected filters.</p>
          </div>
        </div>
      ) : view === "table" ? (
        <div className="flex-1 overflow-auto rounded-lg border border-slate-200" style={{ maxHeight: CHART_HEIGHT + 48 }}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Date</th>
                {series.map((entry) => (
                  <th key={entry.key} scope="col" className="px-3 py-2 text-right">{entry.label}</th>
                ))}
                <th scope="col" className="px-3 py-2 text-right">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {[...chartData].reverse().map((row) => (
                <tr key={row.date} className="border-t border-slate-100">
                  <th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-700">{row.label}</th>
                  {series.map((entry) => (
                    <td key={entry.key} className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {formatNumber(row[entry.key])}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-900">
                    {formatNumber(row.present + row.absent + row.late)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="30%">
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
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: theme.grid, fillOpacity: 0.45 }}
                content={<TrendTooltip theme={theme} />}
              />
              {series.map((entry) => (
                <Bar
                  key={entry.key}
                  dataKey={entry.key}
                  name={entry.label}
                  stackId="attendance"
                  fill={entry.color}
                  maxBarSize={MAX_BAR_SIZE}
                  shape={<StackSegment />}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 ? (
        /* Identity never rests on colour alone: the legend is always present for three series. */
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
      ) : null}
    </div>
  );
}
