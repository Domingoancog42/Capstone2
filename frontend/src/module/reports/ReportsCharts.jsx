import React, { memo, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
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
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatDecimal,
  formatNumber,
  colorEntityRows,
  colorOrdinalRows,
  normalizeEntityKey,
  resolveEntityColors,
  useLazyMount,
  useReportsTheme,
} from "./reportsTheme";

const CHART_HEIGHT = 300;

/* ------------------------------------------------------------------ */
/* Shared chart chrome                                                 */
/* ------------------------------------------------------------------ */

function ChartTooltip({ active, payload, label, theme, formatter, labelFormatter }) {
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
        <div key={`tooltip-${index}`} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5" style={{ color: theme.textSecondary }}>
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
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

/** Identity never rests on colour alone — every multi-series chart carries this. */
function ChartLegend({ items, theme }) {
  if (items.length < 2) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.textSecondary }}>
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-3" style={{ height: CHART_HEIGHT }}>
      <div className="h-full rounded-lg bg-slate-100" />
    </div>
  );
}

/**
 * Card shell shared by every chart: lazy mounts its body and holds the previous
 * render at reduced opacity while refetching.
 */
function ChartCard({
  title,
  description,
  loading,
  refreshing,
  isEmpty,
  emptyMessage = "No data available for the selected filters.",
  className = "",
  children,
}) {
  const [setNode, visible] = useLazyMount();

  return (
    <section
      ref={setNode}
      className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}
    >
      <header className="mb-3">
        <h3 className="m-0 text-sm font-semibold leading-tight text-slate-900">{title}</h3>
        {description ? <p className="m-0 mt-1 text-xs leading-relaxed text-slate-500">{description}</p> : null}
      </header>

      <div className={`flex-1 transition-opacity duration-200 ${refreshing ? "opacity-60" : "opacity-100"}`}>
        {loading || !visible ? (
          <ChartSkeleton />
        ) : isEmpty ? (
          <div
            className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-4 text-center text-sm text-slate-500"
            style={{ height: CHART_HEIGHT }}
          >
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Axis presets                                                        */
/* ------------------------------------------------------------------ */

function categoryAxisProps(theme) {
  return {
    tickLine: false,
    axisLine: { stroke: theme.baseline },
    tick: { fill: theme.textMuted, fontSize: 11 },
  };
}

function valueAxisProps(theme, formatter = formatCompact) {
  return {
    tickLine: false,
    axisLine: false,
    tick: { fill: theme.textMuted, fontSize: 11 },
    tickFormatter: formatter,
    width: 52,
  };
}

/* ------------------------------------------------------------------ */
/* Chart bodies                                                        */
/* ------------------------------------------------------------------ */

/** Two series with comparable magnitudes — never plotted against headcount, which lives on its own card. */
const MovementChart = memo(function MovementChart({ data, theme }) {
  const series = [
    { key: "hires", label: "Hires", color: theme.series[0] },
    { key: "separations", label: "Separations", color: theme.series[1] },
  ];

  return (
    <>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis dataKey="shortLabel" {...categoryAxisProps(theme)} />
          <YAxis {...valueAxisProps(theme)} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: theme.baseline, strokeWidth: 1 }}
            content={<ChartTooltip theme={theme} labelFormatter={(value) => `Month: ${value}`} />}
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
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <ChartLegend items={series} theme={theme} />
    </>
  );
});

const MonthlyHeadcountGrowthChart = memo(function MonthlyHeadcountGrowthChart({ data, theme }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="reports-headcount-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.series[0]} stopOpacity={0.18} />
            <stop offset="100%" stopColor={theme.series[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        <XAxis dataKey="shortLabel" {...categoryAxisProps(theme)} interval={0} />
        <YAxis {...valueAxisProps(theme)} allowDecimals={false} domain={[0, "dataMax + 2"]} />
        <Tooltip
          cursor={{ stroke: theme.baseline, strokeWidth: 1 }}
          content={<ChartTooltip theme={theme} labelFormatter={(value) => `Month: ${value}`} />}
        />
        <Area
          type="monotone"
          dataKey="hires"
          name="Employees Hired"
          stroke={theme.series[0]}
          strokeWidth={2}
          fill="url(#reports-headcount-fill)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});

/**
 * Part-to-whole at a glance.
 *
 * Two standing constraints, both from the fact that a donut compares every slice against every
 * other rather than just its neighbours. First, the slice colour is keyed to the slice's own label,
 * not to its position in the array — most of these datasets arrive sorted by value, so colouring by
 * index meant the hues reshuffled whenever the numbers moved. Second, the all-pairs pairlist is
 * strict: the categorical order clears only its first three slots under it, so a donut carrying
 * more than three meaningful classes is relying on the legend beside each slice — which is why the
 * legend below always prints the label and the value. Anything ranked, or with more classes than
 * that, belongs in `RankedBarChart` instead; `DivisionDistributionCard` moved for exactly this
 * reason.
 */
const DonutChart = memo(function DonutChart({ data, theme, valueFormatter = formatNumber, unitLabel = "records" }) {
  const total = data.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  // Resolved over the whole dataset, not just the six shown, so the visible slices keep their
  // colours when a different class overtakes one of them and pushes it out of the top six.
  const colors = resolveEntityColors(data.map((item) => item.label), theme);
  const slices = data.slice(0, 6).map((item) => ({
    ...item,
    color: colors.get(normalizeEntityKey(item.label)) || theme.series[0],
  }));

  return (
    <div className="flex flex-col">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT - 60}>
        <PieChart>
          <Tooltip content={<ChartTooltip theme={theme} formatter={(value) => valueFormatter(value)} />} />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={58}
            outerRadius={92}
            stroke={theme.surface}
            strokeWidth={2}
            isAnimationActive
          >
            {slices.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {slices.map((slice) => (
          <div key={slice.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-600">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: slice.color }} aria-hidden="true" />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">{valueFormatter(slice.value)}</span>
          </div>
        ))}
      </div>
      <p className="m-0 mt-2 text-[11px] text-slate-500">{`${formatNumber(total)} total ${unitLabel}`}</p>
    </div>
  );
});

/**
 * Single-series ranking. One hue for every bar by default — bar length already encodes magnitude.
 *
 * A row may carry its own `color` when the categories are entities the reader tracks by name
 * (divisions), so they stay identifiable at a glance. Safe on a bar because only neighbours touch
 * and all eight slots clear the adjacent pairlist; it would not be safe on a donut. The colour must
 * come from `resolveEntityColors`, keyed to the entity's name rather than its rank.
 */
const RankedBarChart = memo(function RankedBarChart({
  data,
  theme,
  valueFormatter = formatNumber,
  axisFormatter = formatCompact,
  seriesLabel = "Value",
  colorIndex = 0,
  // Wide enough for a division or bracket name. Rankings whose labels are longer — payslip deduction
  // lines run to "PAG-IBIG Home Equity Appreciation Loan (HEAL)" — ask for more.
  labelWidth = 130,
}) {
  const height = Math.max(CHART_HEIGHT, data.length * 30 + 40);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={theme.grid} horizontal={false} />
        <XAxis type="number" {...valueAxisProps(theme, axisFormatter)} width={undefined} />
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
          content={<ChartTooltip theme={theme} formatter={(value) => valueFormatter(value)} />}
        />
        <Bar dataKey="value" name={seriesLabel} fill={theme.series[colorIndex]} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.some((row) => row.color)
            ? data.map((row, index) => (
                <Cell key={`${row.label}-${index}`} fill={row.color || theme.series[colorIndex]} />
              ))
            : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

/** Column counterpart of `RankedBarChart`; a row's own `color` (entity hue or ordinal step) wins. */
const ColumnChart = memo(function ColumnChart({ data, theme, valueFormatter = formatNumber, seriesLabel = "Employees", colorIndex = 0 }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        <XAxis dataKey="label" {...categoryAxisProps(theme)} interval={0} />
        <YAxis {...valueAxisProps(theme)} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
          content={<ChartTooltip theme={theme} formatter={(value) => valueFormatter(value)} />}
        />
        <Bar dataKey="value" name={seriesLabel} fill={theme.series[colorIndex]} radius={[4, 4, 0, 0]} maxBarSize={24}>
          {data.some((row) => row.color)
            ? data.map((row, index) => (
                <Cell key={`${row.label}-${index}`} fill={row.color || theme.series[colorIndex]} />
              ))
            : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

const MultiSeriesTrend = memo(function MultiSeriesTrend({
  data,
  theme,
  series,
  valueFormatter,
  axisFormatter,
  labelKey = "shortLabel",
  asArea = false,
  allowDecimals = false,
}) {
  const Chart = asArea ? AreaChart : LineChart;

  return (
    <>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <Chart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis dataKey={labelKey} {...categoryAxisProps(theme)} minTickGap={12} />
          <YAxis {...valueAxisProps(theme, axisFormatter || formatCompact)} allowDecimals={allowDecimals} />
          <Tooltip
            cursor={{ stroke: theme.baseline, strokeWidth: 1 }}
            content={<ChartTooltip theme={theme} formatter={valueFormatter} />}
          />
          {series.map((entry) =>
            asArea ? (
              <Area
                key={entry.key}
                type="monotone"
                dataKey={entry.key}
                name={entry.label}
                stroke={entry.color}
                strokeWidth={2}
                fill={entry.color}
                fillOpacity={0.1}
                activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
              />
            ) : (
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
            )
          )}
        </Chart>
      </ResponsiveContainer>
      <ChartLegend items={series} theme={theme} />
    </>
  );
});

/* ------------------------------------------------------------------ */
/* Chart cards                                                         */
/* ------------------------------------------------------------------ */

const EMPTY_ARRAY = [];
const HEADCOUNT_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The API uses daily points for short report windows because Workforce Movement benefits from that
 * detail. Monthly headcount growth counts employees by date hired, so daily hire totals are summed
 * into calendar months. API data that is already monthly or yearly is left at its existing scale.
 */
export function groupMonthlyHeadcountGrowth(rows = []) {
  const grouped = new Map();

  rows.forEach((row, index) => {
    const period = String(row?.period || "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      grouped.set(period || `period-${index}`, row);
      return;
    }

    const monthPeriod = period.slice(0, 7);
    const [year, monthText] = monthPeriod.split("-");
    const monthName = HEADCOUNT_MONTH_LABELS[Number(monthText) - 1] || monthText;
    const monthLabel = `${monthName} ${year}`;

    const previous = grouped.get(monthPeriod);

    grouped.set(monthPeriod, {
      ...row,
      period: monthPeriod,
      label: monthLabel,
      shortLabel: monthLabel,
      granularity: "month",
      hires: Number(previous?.hires || 0) + Number(row?.hires || 0),
    });
  });

  const monthlyRows = Array.from(grouped.values());
  const years = Array.from(new Set(
    monthlyRows
      .map((row) => String(row?.period || ""))
      .filter((period) => /^\d{4}-\d{2}$/.test(period))
      .map((period) => period.slice(0, 4))
  ));

  // Year-level API series cannot be expanded accurately without inventing monthly values.
  if (monthlyRows.length === 0 || years.length === 0 || years.some((year) => !/^\d{4}$/.test(year))) {
    return monthlyRows;
  }

  const allRowsAreMonthly = monthlyRows.every((row) => /^\d{4}-\d{2}$/.test(String(row?.period || "")));
  if (!allRowsAreMonthly) {
    return monthlyRows;
  }

  const showYear = years.length > 1;
  const completed = [];

  years.forEach((year) => {
    HEADCOUNT_MONTH_LABELS.forEach((monthName, monthIndex) => {
      const monthPeriod = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      const monthLabel = `${monthName} ${year}`;
      const existing = grouped.get(monthPeriod);

      completed.push({
        ...(existing || {}),
        period: monthPeriod,
        label: monthLabel,
        shortLabel: showYear ? monthLabel : monthName,
        granularity: "month",
        hires: Number(existing?.hires || 0),
      });
    });
  });

  return completed;
}

function WorkforceMovementCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.employeeGrowth || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Workforce Movement"
      description="Hires against separations across the selected date range."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <MovementChart data={data} theme={theme} />
    </ChartCard>
  );
}

function MonthlyHeadcountGrowthCard({ charts, theme, loading, refreshing, className }) {
  const data = useMemo(
    () => groupMonthlyHeadcountGrowth(charts.monthlyHeadcountGrowth || charts.employeeGrowth || EMPTY_ARRAY),
    [charts.employeeGrowth, charts.monthlyHeadcountGrowth]
  );

  return (
    <ChartCard
      title="Monthly Headcount Growth"
      description="Employees hired per month in the report year, based on their recorded date hired."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <MonthlyHeadcountGrowthChart data={data} theme={theme} />
    </ChartCard>
  );
}

function EmployeeCompositionCard({ charts, theme, loading, refreshing, className }) {
  const [view, setView] = useState("gender");
  const data = (view === "gender" ? charts.genderDistribution : charts.inclusionDistribution) || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Employee Distribution"
      description={view === "gender" ? "Workforce split by recorded gender." : "Inclusion categories across the workforce."}
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {[
            { key: "gender", label: "Gender" },
            { key: "inclusion", label: "Inclusion" },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setView(option.key)}
              aria-pressed={view === option.key}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                view === option.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <DonutChart data={data} theme={theme} unitLabel="employees" />
      </div>
    </ChartCard>
  );
}

/**
 * Active against inactive. The donut answers the split the active and inactive employee reports are
 * about; the record-level statuses that rolled into each slice live in those reports.
 */
function RecordStatusCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.recordStatus || EMPTY_ARRAY;
  const populated = data.filter((slice) => Number(slice.value) > 0);

  return (
    <ChartCard
      title="Active vs Inactive"
      description="Share of the roster still active."
      loading={loading}
      refreshing={refreshing}
      isEmpty={populated.length === 0}
      className={className}
    >
      <DonutChart data={populated} theme={theme} unitLabel="employees" />
    </ChartCard>
  );
}

/* A hue per appointment type, keyed to its name -- see `colorEntityRows`. */
function EmploymentStatusCard({ charts, theme, loading, refreshing, className }) {
  const data = colorEntityRows(charts.employmentStatus || EMPTY_ARRAY, theme);

  return (
    <ChartCard
      title="Employment Status"
      description="Headcount per appointment type."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <RankedBarChart data={data} theme={theme} seriesLabel="Employees" />
    </ChartCard>
  );
}

/**
 * Bar, not a donut, with a hue per division.
 *
 * As a donut this compared every slice against every other, so it was gated on the all-pairs
 * pairlist and failed it: at six slices `#008300` sat ΔE 3.2 from `#eb6834` under protanopia, and
 * `#e87ba4` sat 12.9 from `#eb6834` unsimulated, under the 15 floor.
 *
 * Bars in **slot order** fix that, because only consecutive slots can touch — the adjacent
 * pairlist, which the eight-slot order clears in both modes. Sorting these bars by headcount would
 * put the chart straight back on the all-pairs pairlist that the donut just failed, so the order is
 * a colour-correctness constraint here, not a display preference. Bar length still carries the
 * ranking. `colorEntityRows` does both.
 */
function DivisionDistributionCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.divisionDistribution || EMPTY_ARRAY;
  const ranked = colorEntityRows(data, theme);

  return (
    <ChartCard
      title="Division Distribution"
      description="Total headcount per division."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <RankedBarChart data={ranked} theme={theme} seriesLabel="Employees" labelWidth={150} />
    </ChartCard>
  );
}

function DesignationDistributionCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.designationDistribution || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Position Distribution"
      description="Headcount by position."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <DonutChart data={data} theme={theme} unitLabel="employees" />
    </ChartCard>
  );
}

/*
 * The bands reports.php buckets these three charts into, in the order they run. The API groups by the
 * label text, so without this "3-5 yrs" would sort after "11-20 yrs" and "<20K" after "80K+"; the
 * order is also what the ordinal ramp steps along.
 */
const AGE_BANDS = ["20-25", "26-30", "31-35", "36-40", "41+"];
const SERVICE_BANDS = ["<1 yr", "1-2 yrs", "3-5 yrs", "6-10 yrs", "11-20 yrs", "21+ yrs"];
const SALARY_BANDS = ["<20K", "20-30K", "30-40K", "40-60K", "60-80K", "80K+"];

function AgeDistributionCard({ charts, theme, loading, refreshing, className }) {
  const data = colorOrdinalRows(charts.ageDistribution || EMPTY_ARRAY, theme, AGE_BANDS);

  return (
    <ChartCard
      title="Age Distribution"
      description="Employees grouped into five-year age bands."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <ColumnChart data={data} theme={theme} />
    </ChartCard>
  );
}

function YearsOfServiceCard({ charts, theme, loading, refreshing, className }) {
  const data = colorOrdinalRows(charts.yearsOfService || EMPTY_ARRAY, theme, SERVICE_BANDS);

  return (
    <ChartCard
      title="Years of Service"
      description="Tenure distribution measured from the recorded hiring date."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <ColumnChart data={data} theme={theme} />
    </ChartCard>
  );
}

/** Read straight off the employees table, so it stands even when the payroll module has no tables. */
function SalaryDistributionCard({ charts, theme, loading, refreshing, className }) {
  const data = colorOrdinalRows(charts.salaryDistribution || EMPTY_ARRAY, theme, SALARY_BANDS);

  return (
    <ChartCard
      title="Salary Distribution"
      description="Employees grouped into monthly basic salary brackets."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <ColumnChart data={data} theme={theme} />
    </ChartCard>
  );
}

function PayrollTrendCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.payrollTrend || EMPTY_ARRAY;
  const series = [
    { key: "gross", label: "Gross Pay", color: theme.series[0] },
    { key: "deductions", label: "Deductions", color: theme.series[1] },
    { key: "net", label: "Net Pay", color: theme.series[2] },
  ];

  return (
    <ChartCard
      title="Monthly Payroll Expense"
      description="Gross pay, deductions, and net pay over the last 12 months."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <MultiSeriesTrend
        data={data}
        theme={theme}
        series={series}
        valueFormatter={(value) => formatCurrency(value)}
        axisFormatter={formatCompactCurrency}
      />
    </ChartCard>
  );
}

/* Resolved against the Division Distribution names too, so a division wears one hue on both charts. */
function PayrollByDivisionCard({ charts, theme, loading, refreshing, className }) {
  const payroll = charts.payrollByDivision || EMPTY_ARRAY;
  const data = colorEntityRows(payroll, theme, [
    ...(charts.divisionDistribution || EMPTY_ARRAY).map((row) => row.label),
    ...payroll.map((row) => row.label),
  ]);

  return (
    <ChartCard
      title="Payroll by Division"
      description="Net payroll released per division for the selected period."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <RankedBarChart
        data={data}
        theme={theme}
        seriesLabel="Net Pay"
        valueFormatter={formatCurrency}
        axisFormatter={formatCompactCurrency}
      />
    </ChartCard>
  );
}

function PayrollStatusCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.payrollStatus || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Payroll Status"
      description="Payroll runs by release state for the selected period."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <DonutChart data={data} theme={theme} unitLabel="payroll runs" />
    </ChartCard>
  );
}

function DeductionDistributionCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.deductionDistribution || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Deduction Distribution"
      description="Every deduction line the payslip prints, with the total withheld against it."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <RankedBarChart
        data={data}
        theme={theme}
        seriesLabel="Amount"
        valueFormatter={formatCurrency}
        axisFormatter={formatCompactCurrency}
        colorIndex={1}
        labelWidth={210}
      />
    </ChartCard>
  );
}

function LeaveStatusCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.leaveStatus || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Leave Statistics"
      description="Leave applications by status for the selected period."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <DonutChart data={data} theme={theme} unitLabel="requests" />
    </ChartCard>
  );
}

function LeaveTypeDistributionCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.leaveTypeDistribution || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Leave Type Distribution"
      description="Requests filed per leave type."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <DonutChart data={data} theme={theme} unitLabel="requests" />
    </ChartCard>
  );
}

function LeaveTrendCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.leaveTrend || EMPTY_ARRAY;
  const series = [
    { key: "filed", label: "Filed", color: theme.series[0] },
    { key: "approved", label: "Approved", color: theme.series[2] },
    { key: "rejected", label: "Rejected", color: theme.series[1] },
  ];

  return (
    <ChartCard
      title="Monthly Leave Trend"
      description="Filed, approved, and rejected leave over the last 12 months."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <MultiSeriesTrend data={data} theme={theme} series={series} asArea />
    </ChartCard>
  );
}

function AttendanceSummaryCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.attendanceSummary || EMPTY_ARRAY;

  return (
    <ChartCard
      title="Attendance Summary"
      description="Daily attendance records by status."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <DonutChart data={data} theme={theme} unitLabel="records" />
    </ChartCard>
  );
}

function AttendanceExceptionsCard({ charts, theme, loading, refreshing, className }) {
  const data = colorEntityRows(charts.attendanceExceptions || EMPTY_ARRAY, theme);

  return (
    <ChartCard
      title="Attendance Exceptions"
      description="Late arrivals, undertime, and filed overtime."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.every((item) => !item.value)}
      className={className}
    >
      <ColumnChart data={data} theme={theme} seriesLabel="Records" />
    </ChartCard>
  );
}

function AttendanceTrendCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.attendanceTrend || EMPTY_ARRAY;
  /*
   * The same three slots as the dashboard's stacked Attendance Trend card, so a series keeps its
   * hue between the two screens. Late is blue rather than amber because, stacked against orange
   * Absent, amber falls below the palette validator's normal-vision floor.
   */
  const series = [
    { key: "present", label: "Present", color: theme.series[2] },
    { key: "absent", label: "Absent", color: theme.series[1] },
    { key: "late", label: "Late", color: theme.series[0] },
  ];

  return (
    <ChartCard
      title="Attendance Trend"
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <MultiSeriesTrend data={data} theme={theme} series={series} labelKey="label" />
    </ChartCard>
  );
}

/*
 * Both performance instruments on one axis. They are directly comparable — each is a final rating on
 * the same scale — so plotting them together is what shows whether a division's individual reviews
 * and its office commitment agree, which neither line says on its own.
 *
 * A division missing one of the two arrives with null rather than 0, and Recharts breaks the line
 * over a null instead of dropping it to the floor. That distinction matters here: 0 is a real rating
 * and "no OPCR filed" is not one.
 */
function PerformanceByDivisionCard({ charts, theme, loading, refreshing, className }) {
  const data = charts.performanceByDivision || EMPTY_ARRAY;
  const series = [
    { key: "ipcr", label: "IPCR", color: theme.series[6] },
    { key: "opcr", label: "OPCR", color: theme.series[0] },
  ];

  const formatRating = (value) =>
    value === null || value === undefined ? "No rating" : formatDecimal(value);

  return (
    <ChartCard
      title="Average IPCR and OPCR Rating by Division"
      description="Mean final rating per division across individual performance reviews and office commitment assignments."
      loading={loading}
      refreshing={refreshing}
      isEmpty={data.length === 0}
      className={className}
    >
      <MultiSeriesTrend
        data={data}
        theme={theme}
        series={series}
        labelKey="label"
        valueFormatter={formatRating}
        axisFormatter={formatDecimal}
        allowDecimals
      />
    </ChartCard>
  );
}

function ModuleUnavailable({ label }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center">
      <div className="max-w-md">
        <p className="m-0 text-sm font-semibold text-slate-700">{`${label} analytics are not available yet`}</p>
        <p className="m-0 mt-2 text-sm text-slate-500">
          {`The ${label.toLowerCase()} tables have not been created in this database. Charts will populate automatically once the module is in use.`}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Report to analytics routing                                         */
/* ------------------------------------------------------------------ */

/**
 * Every chart the dashboard can draw, keyed by id. `module` names the backend availability flag the
 * card depends on, so a card is dropped rather than drawn empty when its tables do not exist, and
 * `wide` marks the cards that need the full row.
 */
const CHART_CARDS = {
  workforceMovement: { Card: WorkforceMovementCard },
  monthlyHeadcountGrowth: { Card: MonthlyHeadcountGrowthCard },
  employeeComposition: { Card: EmployeeCompositionCard },
  recordStatus: { Card: RecordStatusCard },
  employmentStatus: { Card: EmploymentStatusCard },
  divisionDistribution: { Card: DivisionDistributionCard },
  designationDistribution: { Card: DesignationDistributionCard },
  ageDistribution: { Card: AgeDistributionCard },
  yearsOfService: { Card: YearsOfServiceCard },
  salaryDistribution: { Card: SalaryDistributionCard },

  payrollTrend: { Card: PayrollTrendCard, module: "payroll", wide: true },
  payrollByDivision: { Card: PayrollByDivisionCard, module: "payroll" },
  payrollStatus: { Card: PayrollStatusCard, module: "payroll" },
  deductionDistribution: { Card: DeductionDistributionCard, module: "payroll" },

  leaveStatus: { Card: LeaveStatusCard, module: "leave" },
  leaveTypeDistribution: { Card: LeaveTypeDistributionCard, module: "leave" },
  leaveTrend: { Card: LeaveTrendCard, module: "leave", wide: true },

  attendanceSummary: { Card: AttendanceSummaryCard, module: "attendance" },
  attendanceExceptions: { Card: AttendanceExceptionsCard, module: "attendance" },
  attendanceTrend: { Card: AttendanceTrendCard, module: "attendance", wide: true },

  performanceByDivision: { Card: PerformanceByDivisionCard, module: "performance", wide: true },
};

/**
 * The analytics that describe each report. Picking a report narrows the dashboard to the charts that
 * actually answer for it — choosing "Total Active Employees" no longer paints the whole category.
 * Audit and training reports are listed with an empty set because the dashboard payload carries no
 * chart series for them; their headline figures still render.
 */
const REPORT_CHARTS = {
  /* Employee */
  "employee-list": ["monthlyHeadcountGrowth", "divisionDistribution", "employmentStatus", "employeeComposition"],
  "employee-active": ["recordStatus", "monthlyHeadcountGrowth"],
  "employee-inactive": ["recordStatus", "workforceMovement"],
  "employee-male": ["employeeComposition"],
  "employee-female": ["employeeComposition"],
  "employee-pwd": ["employeeComposition"],
  "employee-senior": ["ageDistribution"],
  "employee-permanent": ["employmentStatus"],
  "employee-cos": ["employmentStatus"],
  "employee-newly-hired": ["workforceMovement", "monthlyHeadcountGrowth"],
  "employee-separated": ["workforceMovement"],
  "employee-retired": ["ageDistribution", "yearsOfService"],
  "employee-birthdays": ["ageDistribution"],
  "employee-near-retirement": ["ageDistribution", "yearsOfService"],
  "employees-by-division": ["divisionDistribution"],
  "employees-by-designation": ["designationDistribution"],
  "employees-by-employment-status": ["employmentStatus"],
  "employees-by-salary-grade": ["salaryDistribution"],
  "employees-by-age": ["ageDistribution"],
  "employees-by-years-of-service": ["yearsOfService"],
  "department-division-report": ["divisionDistribution"],

  /* Payroll */
  "payroll-released": ["payrollTrend", "payrollStatus"],
  "payroll-report": ["payrollTrend", "payrollStatus"],
  "payroll-pending": ["payrollStatus"],
  "payroll-by-division": ["payrollByDivision"],
  "payroll-by-employee": ["salaryDistribution"],
  "payroll-summary": ["payrollTrend"],
  "payroll-deductions": ["deductionDistribution"],
  "payroll-net-pay-summary": ["payrollTrend", "payrollByDivision"],

  /* Leave */
  "leave-report": ["leaveStatus", "leaveTypeDistribution"],
  "leave-filed": ["leaveTrend"],
  "leave-approved": ["leaveStatus", "leaveTrend"],
  "leave-rejected": ["leaveStatus", "leaveTrend"],
  "leave-pending": ["leaveStatus"],
  "leave-cancelled": ["leaveStatus"],
  "leave-monetized": ["leaveTypeDistribution"],
  "leave-balance": ["leaveTypeDistribution"],
  "leave-utilization": ["leaveTypeDistribution", "leaveTrend"],
  "leave-by-division": ["leaveTrend"],
  "leave-by-employee": ["leaveTypeDistribution"],

  /* Attendance */
  "attendance-report": ["attendanceSummary", "attendanceTrend"],
  "attendance-absences": ["attendanceSummary", "attendanceTrend"],
  "attendance-late": ["attendanceExceptions", "attendanceTrend"],
  "attendance-undertime": ["attendanceExceptions"],
  "attendance-monthly": ["attendanceSummary", "attendanceTrend"],
  "overtime-report": ["attendanceExceptions"],
  "cto-report": ["attendanceExceptions"],

  /* Performance */
  "ipcr-report": ["performanceByDivision"],
  "performance-evaluation-report": ["performanceByDivision"],
  "performance-top-performers": ["performanceByDivision"],
  "performance-division-ratings": ["performanceByDivision"],

  /* Audit and training have no chart series in the dashboard payload. */
  "audit-activity-logs": EMPTY_ARRAY,
  "audit-login-history": EMPTY_ARRAY,
  "audit-report-actions": EMPTY_ARRAY,
  "training-seminars-report": EMPTY_ARRAY,
};

/** Only reached by a report key the map above has not been taught yet, so a new report is never blank. */
const CATEGORY_FALLBACK_CHARTS = {
  employee: ["monthlyHeadcountGrowth", "divisionDistribution"],
  payroll: ["payrollTrend", "payrollStatus"],
  leave: ["leaveStatus", "leaveTrend"],
  attendance: ["attendanceSummary", "attendanceTrend"],
  performance: ["performanceByDivision"],
};

/** Categories that explain themselves instead of charting when the backing module has no tables. */
const CATEGORY_MODULE = {
  payroll: { key: "payroll", label: "Payroll" },
  leave: { key: "leave", label: "Leave" },
  attendance: { key: "attendance", label: "Attendance" },
  performance: { key: "performance", label: "Performance (IPCR and OPCR)" },
};

/* ------------------------------------------------------------------ */

export default function ReportsCharts({
  dashboard,
  loading = false,
  refreshing = false,
  category = "",
  reportKey = "",
}) {
  const theme = useReportsTheme();
  const charts = useMemo(() => dashboard?.charts || {}, [dashboard]);
  const availability = dashboard?.availability || {};

  const cardIds = (REPORT_CHARTS[reportKey] || CATEGORY_FALLBACK_CHARTS[category] || EMPTY_ARRAY).filter((id) => {
    const entry = CHART_CARDS[id];

    return entry && (!entry.module || availability[entry.module] !== false);
  });

  const module = CATEGORY_MODULE[category];

  if (module && availability[module.key] === false) {
    return <ModuleUnavailable label={module.label} />;
  }

  if (cardIds.length === 0) {
    return null;
  }

  // A lone chart reads better across the full row than stranded beside white space.
  const single = cardIds.length === 1;

  return (
    <div className={single ? "grid gap-4" : "grid gap-4 xl:grid-cols-2"}>
      {cardIds.map((id) => {
        const { Card, wide } = CHART_CARDS[id];

        return (
          <Card
            key={id}
            charts={charts}
            theme={theme}
            loading={loading}
            refreshing={refreshing}
            className={wide && !single ? "xl:col-span-2" : undefined}
          />
        );
      })}
    </div>
  );
}
