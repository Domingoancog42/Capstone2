import React, { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import {
  formatCompact,
  formatNumber,
  normalizeEntityKey,
  resolveEntityColors,
  useReportsTheme,
} from "../../module/reports/reportsTheme";

export { normalizeEntityKey, resolveEntityColors };

/**
 * Shared chart chrome for the dashboard analytics cards.
 *
 * Colour comes from one place only — `reportsTheme.js` — so the dashboard and the
 * Reports module cannot drift apart, and a hue means the same thing on both. The
 * cards previously each carried a private hex map, which put the same blue on
 * "Male" in one card and "Contract of Service" in another; nothing here invents a
 * colour.
 *
 * The primitives mirror the ones inside `module/reports/ReportsCharts.jsx`. They
 * are re-stated rather than imported because those are private to that module and
 * the dashboard cards wear a different shell (icon header, fixed min-height, KPI
 * footer) — only the tokens are shared, which is the part that must not fork.
 */

export { useReportsTheme as useAnalyticsTheme };

/** A single series takes slot 1. Bar length already encodes magnitude, so hue does no work. */
export const SINGLE_SERIES_SLOT = 0;

/**
 * Gender keeps a fixed slot per entity, so filtering divisions never repaints the
 * survivors and "Female is blue" stays true across every screen. The set was validated
 * as a 4-slot adjacent run; the two it now uses are the first two of that run, so the
 * separation only widens. The employee record offers no gender beyond these two, which
 * is why the "Other" and "Not Specified" series were dropped — they were legend entries
 * for bars that could never be drawn.
 */
export const GENDER_SERIES = [
  { key: "female", label: "Female", slot: 0 },
  { key: "male", label: "Male", slot: 1 },
];

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

/** Values lead, labels follow — the reader already has the series and wants the number. */
export function AnalyticsTooltip({ active, payload, label, theme, formatter, labelFormatter }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: theme.surface, borderColor: theme.grid, color: theme.text }}
    >
      {label !== undefined && label !== null && label !== "" ? (
        <p className="m-0 mb-1.5 font-semibold" style={{ color: theme.text }}>
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      ) : null}
      {payload.map((entry, index) => (
        <div key={`tip-${index}`} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5" style={{ color: theme.textSecondary }}>
            {/* Line key, not a box: at tooltip density a filled swatch is data-weight ink doing a label's job. */}
            <span
              className="inline-block h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color || entry.payload?.fill }}
              aria-hidden="true"
            />
            {entry.name}
          </span>
          <span className="font-semibold tabular-nums" style={{ color: theme.text }}>
            {formatter ? formatter(entry.value, entry) : formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Identity never rests on colour alone. Present whenever there are two or more series. */
export function AnalyticsLegend({ items, theme }) {
  if (!items || items.length < 2) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: theme.textSecondary }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * The table twin. Three light-mode series steps sit below 3:1 on white, which
 * obligates a relief channel — this is it, and it doubles as the keyboard-reachable
 * route to every value a tooltip would otherwise gate.
 */
export function AnalyticsTableView({ columns, rows }) {
  return (
    <div className="max-h-[260px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400"
              >
                No data available.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={`row-${index}`}
                className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={`cell-${index}-${cellIndex}`}
                    className={`border-b border-slate-100 px-3 py-2 text-slate-700 dark:border-slate-800 dark:text-slate-300 ${
                      cellIndex > 0 ? "tabular-nums" : ""
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Card shell every analytics card wears: icon header, optional table-view toggle,
 * empty and loading states. Dark mode is a selected set of steps from the same
 * ramps (see `reportsTheme.js`), not an automatic flip.
 */
export function AnalyticsCard({
  icon: Icon,
  title,
  subtitle,
  accent,
  isEmpty = false,
  emptyMessage = "No data available.",
  emptyIcon: EmptyIcon,
  loading = false,
  tableColumns,
  tableRows,
  footer,
  children,
}) {
  const [showTable, setShowTable] = useState(false);

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-4 shadow-md dark:bg-slate-900">
        <div className="mb-4 h-6 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-52 rounded bg-slate-100 dark:bg-slate-800/60" />
      </div>
    );
  }

  const canToggleTable = Boolean(tableColumns) && !isEmpty;

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-4 shadow-md transition-shadow duration-300 hover:shadow-lg dark:bg-slate-900">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center space-x-3">
          {Icon ? (
            <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
              <Icon className="h-6 w-6" style={accent ? { color: accent } : undefined} aria-hidden="true" />
            </div>
          ) : null}
          <div className="min-w-0">
            <h3 className="m-0 text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
            {subtitle ? (
              <p className="m-0 mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            ) : null}
          </div>
        </div>

        {canToggleTable ? (
          <button
            type="button"
            onClick={() => setShowTable((current) => !current)}
            title={showTable ? "Show chart" : "Show data table"}
            aria-label={showTable ? "Show chart" : "Show data table"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {showTable ? <BarChart3 size={15} aria-hidden="true" /> : <Table2 size={15} aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      <div className="flex-1">
        {isEmpty ? (
          <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-slate-200 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <div>
              {EmptyIcon ? (
                <EmptyIcon className="mx-auto mb-2 h-10 w-10 text-slate-300 dark:text-slate-600" aria-hidden="true" />
              ) : null}
              <p className="m-0 text-sm font-medium">{emptyMessage}</p>
            </div>
          </div>
        ) : showTable ? (
          <AnalyticsTableView columns={tableColumns} rows={tableRows || []} />
        ) : (
          children
        )}
      </div>

      {footer ? (
        <div className="mt-auto border-t border-slate-200 pt-4 dark:border-slate-800">{footer}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Axis presets                                                        */
/* ------------------------------------------------------------------ */

export function categoryAxisProps(theme) {
  return {
    tickLine: false,
    axisLine: { stroke: theme.baseline },
    tick: { fill: theme.textMuted, fontSize: 11 },
  };
}

export function valueAxisProps(theme, formatter = formatCompact) {
  return {
    tickLine: false,
    axisLine: false,
    tick: { fill: theme.textMuted, fontSize: 11 },
    tickFormatter: formatter,
  };
}

/* ------------------------------------------------------------------ */
/* Chart bodies                                                        */
/* ------------------------------------------------------------------ */

/**
 * Single-series ranking, sorted by magnitude.
 *
 * By default every bar wears slot 1, because bar length already encodes the magnitude
 * and a value-ramp would spend the identity channel re-encoding it.
 *
 * A row may instead carry its own `color` when the categories are entities the reader
 * tracks by name — divisions, roles — and telling them apart at a glance is worth the
 * channel. That is safe here and not on a pie: only neighbouring bars touch, so the
 * adjacent pairlist applies and all eight slots clear it in both modes. The colour must
 * come from `resolveEntityColors`, which keys off the entity's name — never off its
 * position, which moves every time the ranking does.
 *
 * Horizontal because the category names are long; the label column has room without
 * rotating text.
 */
export function RankedBarChart({
  data,
  theme,
  height,
  labelWidth = 132,
  seriesLabel = "Value",
  valueFormatter = formatNumber,
  colorIndex = SINGLE_SERIES_SLOT,
}) {
  const resolvedHeight = height || Math.max(200, data.length * 34 + 24);

  return (
    <ResponsiveContainer width="100%" height={resolvedHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={theme.grid} horizontal={false} />
        <XAxis type="number" {...valueAxisProps(theme)} hide />
        <YAxis
          type="category"
          dataKey="label"
          width={labelWidth}
          tickLine={false}
          axisLine={false}
          tick={{ fill: theme.textMuted, fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
          content={<AnalyticsTooltip theme={theme} formatter={valueFormatter} />}
        />
        <Bar
          dataKey="value"
          name={seriesLabel}
          fill={theme.series[colorIndex]}
          // 4px rounded data-end, square at the baseline.
          radius={[0, 4, 4, 0]}
          maxBarSize={22}
          activeBar={{ fillOpacity: 0.82 }}
          label={{
            position: "right",
            fill: theme.textSecondary,
            fontSize: 11,
            formatter: valueFormatter,
          }}
        >
          {data.some((row) => row.color)
            ? data.map((row, index) => (
                <Cell key={`${row.label}-${index}`} fill={row.color || theme.series[colorIndex]} />
              ))
            : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Part-to-whole for one categorical breakdown.
 *
 * A pie compares every slice against every other, not just the two beside it, so the eight-slot
 * order stops carrying identity on its own — under the all-pairs pairlist the categorical order
 * clears only its first three slots. Two things cover the rest: each slice is cut from its
 * neighbours by a `theme.surface` stroke, and the legend below always prints the label with its
 * value and share, so nothing here is readable by hue alone.
 *
 * Slices are drawn in the order given, and each row's `color` comes from upstream keyed to the
 * entity's own name — never to its position, which moves every time the counts do. Callers that
 * pass slot-ordered rows also keep only consecutive slots touching, which is the adjacent
 * pairlist the full slot order clears.
 */
export function DistributionPieChart({
  data,
  theme,
  height = 200,
  valueFormatter = formatNumber,
  colorIndex = SINGLE_SERIES_SLOT,
  showPercentages = true,
}) {
  const total = data.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const slices = data.map((item) => ({
    ...item,
    color: item.color || theme.series[colorIndex],
    percentage: total > 0 ? ((Number(item.value) || 0) / total) * 100 : 0,
  }));

  return (
    <div className="flex flex-col">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip
            content={(
              <AnalyticsTooltip
                theme={theme}
                formatter={(value, entry) => (
                  showPercentages
                    ? `${valueFormatter(value)} (${(entry?.payload?.percentage || 0).toFixed(1)}%)`
                    : valueFormatter(value)
                )}
              />
            )}
          />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius="92%"
            stroke={theme.surface}
            strokeWidth={2}
          >
            {slices.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="mt-3 max-h-[104px] space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {slices.map((slice) => (
          <div key={slice.label} className="flex items-center justify-between gap-2 text-xs">
            <span
              className="flex min-w-0 items-center gap-1.5 font-medium"
              style={{ color: theme.textSecondary }}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums" style={{ color: theme.text }}>
              {valueFormatter(slice.value)}
              {showPercentages ? (
                <span className="ml-1 font-medium" style={{ color: theme.textMuted }}>
                  {`${slice.percentage.toFixed(0)}%`}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Ordered categories along the axis (age bands). The order is carried by axis
 * position, so one hue is enough — see the note in `AgeGroupCard` on why the
 * ordinal ramp is not used here.
 */
export function CategoryColumnChart({
  data,
  theme,
  height = 200,
  seriesLabel = "Value",
  valueFormatter = formatNumber,
  colorIndex = SINGLE_SERIES_SLOT,
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        <XAxis dataKey="label" {...categoryAxisProps(theme)} interval={0} />
        <YAxis {...valueAxisProps(theme)} allowDecimals={false} width={40} />
        <Tooltip
          cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
          content={<AnalyticsTooltip theme={theme} formatter={valueFormatter} />}
        />
        <Bar
          dataKey="value"
          name={seriesLabel}
          fill={theme.series[colorIndex]}
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          activeBar={{ fillOpacity: 0.82 }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Change over time for one or more series sharing a single scale.
 *
 * One axis only. Two measures of different magnitude never share this chart — they get two charts
 * or an indexed common base — because a second y-scale lets the author decide which line "wins".
 *
 * Each series names its own slot rather than taking its position in the array, so a series that
 * drops out of the caller's data does not repaint the ones that remain. Lines rest without dots:
 * at twelve points a marker per month is ink that encodes nothing the line has not already drawn.
 * The active dot is 8px with a surface ring so it stays readable where two lines cross.
 */
export function TrendLineChart({
  data,
  series,
  theme,
  height = 200,
  valueFormatter = formatNumber,
}) {
  const resolved = series.map((item) => ({
    ...item,
    color: theme.series[item.slot ?? SINGLE_SERIES_SLOT],
  }));

  return (
    <div className="flex flex-col">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis dataKey="label" {...categoryAxisProps(theme)} />
          <YAxis {...valueAxisProps(theme)} allowDecimals={false} width={34} />
          <Tooltip
            cursor={{ stroke: theme.baseline, strokeWidth: 1 }}
            content={<AnalyticsTooltip theme={theme} formatter={valueFormatter} />}
          />
          {resolved.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <AnalyticsLegend
        items={resolved.map((item) => ({ label: item.label, color: item.color }))}
        theme={theme}
      />
    </div>
  );
}

/**
 * A ratio against a limit. The unfilled track is a light step of the fill's own
 * ramp — not a neutral gray — so the state reads across the whole bar. No
 * gradient: a gradient on a value mark makes the same length read as two
 * different values depending on where you look.
 */
export function Meter({ value, max, theme, label, valueText, hint }) {
  const safeMax = Number(max) || 0;
  const safeValue = Number(value) || 0;
  const percent = safeMax > 0 ? Math.min(100, Math.max(0, (safeValue / safeMax) * 100)) : 0;

  return (
    <div className="space-y-2">
      {label || valueText ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{label}</span>
          <span className="shrink-0 font-medium tabular-nums text-slate-700 dark:text-slate-200">
            {valueText}
          </span>
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: theme.sequential[0] }}
        role="meter"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, backgroundColor: theme.series[SINGLE_SERIES_SLOT] }}
        />
      </div>
      {hint ? <p className="m-0 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** Label · value · optional hint. The number is the chart — no one-bar bar chart. */
export function StatTile({ label, value, hint, theme }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <p className="m-0 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      {/* Proportional figures: tabular-nums makes a standalone number look loose at display size. */}
      <p className="m-0 mt-2 text-2xl font-semibold" style={{ color: theme.text }}>
        {value}
      </p>
      {hint ? <p className="m-0 mt-1 text-sm text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}
