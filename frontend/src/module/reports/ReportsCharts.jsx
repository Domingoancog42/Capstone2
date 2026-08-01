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
import { BarChart3, Table2 } from "lucide-react";
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatDecimal,
  formatNumber,
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

function ChartTableView({ columns, rows, theme }) {
  return (
    <div className="max-h-[300px] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-4 text-center text-sm text-slate-500">
                No data available.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`chart-row-${index}`} className="transition hover:bg-slate-50">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`chart-cell-${index}-${cellIndex}`}
                    className={`border-b border-slate-100 px-3 py-2 text-slate-700 ${cellIndex > 0 ? "tabular-nums" : ""}`}
                    style={cellIndex === 0 ? { color: theme.text } : undefined}
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

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-3" style={{ height: CHART_HEIGHT }}>
      <div className="h-full rounded-lg bg-slate-100" />
    </div>
  );
}

/**
 * Card shell shared by every chart: lazy mounts its body, holds the previous
 * render at reduced opacity while refetching, and ships a table-view twin so no
 * value is reachable by colour alone.
 */
function ChartCard({
  title,
  description,
  loading,
  refreshing,
  isEmpty,
  emptyMessage = "No data available for the selected filters.",
  tableColumns,
  tableRows,
  className = "",
  children,
}) {
  const theme = useReportsTheme();
  const [setNode, visible] = useLazyMount();
  const [showTable, setShowTable] = useState(false);

  return (
    <section
      ref={setNode}
      className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold leading-tight text-slate-900">{title}</h3>
          {description ? <p className="m-0 mt-1 text-xs leading-relaxed text-slate-500">{description}</p> : null}
        </div>
        {tableColumns && !isEmpty && !loading ? (
          <button
            type="button"
            onClick={() => setShowTable((current) => !current)}
            title={showTable ? "Show chart" : "Show data table"}
            aria-label={showTable ? "Show chart" : "Show data table"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {showTable ? <BarChart3 size={15} aria-hidden="true" /> : <Table2 size={15} aria-hidden="true" />}
          </button>
        ) : null}
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
        ) : showTable ? (
          <ChartTableView columns={tableColumns} rows={tableRows || []} theme={theme} />
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

const HeadcountChart = memo(function HeadcountChart({ data, theme }) {
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
        <XAxis dataKey="shortLabel" {...categoryAxisProps(theme)} />
        <YAxis {...valueAxisProps(theme)} allowDecimals={false} domain={["dataMin - 2", "dataMax + 2"]} />
        <Tooltip
          cursor={{ stroke: theme.baseline, strokeWidth: 1 }}
          content={<ChartTooltip theme={theme} labelFormatter={(value) => `Month: ${value}`} />}
        />
        <Area
          type="monotone"
          dataKey="headcount"
          name="Headcount"
          stroke={theme.series[0]}
          strokeWidth={2}
          fill="url(#reports-headcount-fill)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});

const DonutChart = memo(function DonutChart({ data, theme, valueFormatter = formatNumber, unitLabel = "records" }) {
  const total = data.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const slices = data.slice(0, 6).map((item, index) => ({
    ...item,
    color: theme.series[index % theme.series.length],
    percentage: total > 0 ? ((Number(item.value) || 0) / total) * 100 : 0,
  }));

  return (
    <div className="flex flex-col">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT - 60}>
        <PieChart>
          <Tooltip
            content={(
              <ChartTooltip
                theme={theme}
                formatter={(value, entry) => `${valueFormatter(value)} (${(entry?.payload?.percentage || 0).toFixed(1)}%)`}
              />
            )}
          />
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
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
              {valueFormatter(slice.value)}
              <span className="ml-1 font-medium text-slate-500">{`${slice.percentage.toFixed(0)}%`}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="m-0 mt-2 text-[11px] text-slate-500">{`${formatNumber(total)} total ${unitLabel}`}</p>
    </div>
  );
});

/** Single-series ranking. One hue for every bar — bar length already encodes magnitude. */
const RankedBarChart = memo(function RankedBarChart({
  data,
  theme,
  valueFormatter = formatNumber,
  axisFormatter = formatCompact,
  seriesLabel = "Value",
  colorIndex = 0,
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
          width={130}
          tickLine={false}
          axisLine={false}
          tick={{ fill: theme.textMuted, fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
          content={<ChartTooltip theme={theme} formatter={(value) => valueFormatter(value)} />}
        />
        <Bar dataKey="value" name={seriesLabel} fill={theme.series[colorIndex]} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
});

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
        <Bar dataKey="value" name={seriesLabel} fill={theme.series[colorIndex]} radius={[4, 4, 0, 0]} maxBarSize={24} />
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
/* Tab panels                                                          */
/* ------------------------------------------------------------------ */

const asRows = (data, formatter = formatNumber) => data.map((item) => [item.label, formatter(item.value)]);

function OverviewPanel({ charts, theme, loading, refreshing }) {
  const [compositionView, setCompositionView] = useState("gender");
  const growth = charts.employeeGrowth || [];
  const composition = compositionView === "gender" ? charts.genderDistribution || [] : charts.inclusionDistribution || [];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Workforce Movement"
        description="Hires against separations over the last 12 months."
        loading={loading}
        refreshing={refreshing}
        isEmpty={growth.length === 0}
        tableColumns={["Month", "Hires", "Separations"]}
        tableRows={growth.map((row) => [row.label, formatNumber(row.hires), formatNumber(row.separations)])}
      >
        <MovementChart data={growth} theme={theme} />
      </ChartCard>

      <ChartCard
        title="Headcount Trend"
        description="Total active roster at the close of each month."
        loading={loading}
        refreshing={refreshing}
        isEmpty={growth.length === 0}
        tableColumns={["Month", "Headcount"]}
        tableRows={growth.map((row) => [row.label, formatNumber(row.headcount)])}
      >
        <HeadcountChart data={growth} theme={theme} />
      </ChartCard>

      <ChartCard
        title="Employee Distribution"
        description={compositionView === "gender" ? "Workforce split by recorded gender." : "Inclusion categories across the workforce."}
        loading={loading}
        refreshing={refreshing}
        isEmpty={composition.length === 0}
        tableColumns={["Category", "Employees"]}
        tableRows={asRows(composition)}
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
                onClick={() => setCompositionView(option.key)}
                aria-pressed={compositionView === option.key}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  compositionView === option.key
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <DonutChart data={composition} theme={theme} unitLabel="employees" />
        </div>
      </ChartCard>

      <ChartCard
        title="Employment Status"
        description="Headcount per appointment type."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.employmentStatus || []).length === 0}
        tableColumns={["Employment Status", "Employees"]}
        tableRows={asRows(charts.employmentStatus || [])}
      >
        <RankedBarChart data={charts.employmentStatus || []} theme={theme} seriesLabel="Employees" />
      </ChartCard>
    </div>
  );
}

function EmployeePanel({ charts, theme, loading, refreshing }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Division Distribution"
        description="Total headcount per division. Toggle the table view for the active and inactive split."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.divisionDistribution || []).length === 0}
        tableColumns={["Division", "Active", "Inactive", "Total"]}
        tableRows={(charts.divisionDistribution || []).map((row) => [
          row.label,
          formatNumber(row.active),
          formatNumber(row.inactive),
          formatNumber(row.value),
        ])}
      >
        <DonutChart data={charts.divisionDistribution || []} theme={theme} unitLabel="employees" />
      </ChartCard>

      <ChartCard
        title="Designation Distribution"
        description="Headcount by position."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.designationDistribution || []).length === 0}
        tableColumns={["Designation", "Employees"]}
        tableRows={asRows(charts.designationDistribution || [])}
      >
        <DonutChart data={charts.designationDistribution || []} theme={theme} unitLabel="employees" />
      </ChartCard>

      <ChartCard
        title="Age Distribution"
        description="Employees grouped into five-year age bands."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.ageDistribution || []).length === 0}
        tableColumns={["Age Group", "Employees"]}
        tableRows={asRows(charts.ageDistribution || [])}
      >
        <ColumnChart data={charts.ageDistribution || []} theme={theme} colorIndex={2} />
      </ChartCard>

      <ChartCard
        title="Years of Service"
        description="Tenure distribution measured from the recorded hiring date."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.yearsOfService || []).length === 0}
        tableColumns={["Years of Service", "Employees"]}
        tableRows={asRows(charts.yearsOfService || [])}
      >
        <ColumnChart data={charts.yearsOfService || []} theme={theme} colorIndex={3} />
      </ChartCard>
    </div>
  );
}

function PayrollPanel({ charts, theme, loading, refreshing, available }) {
  if (!available) {
    return <ModuleUnavailable label="Payroll" />;
  }

  const payrollSeries = [
    { key: "gross", label: "Gross Pay", color: theme.series[0] },
    { key: "deductions", label: "Deductions", color: theme.series[1] },
    { key: "net", label: "Net Pay", color: theme.series[2] },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Monthly Payroll Expense"
        description="Gross pay, deductions, and net pay over the last 12 months."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.payrollTrend || []).length === 0}
        className="xl:col-span-2"
        tableColumns={["Month", "Gross Pay", "Deductions", "Net Pay"]}
        tableRows={(charts.payrollTrend || []).map((row) => [
          row.label,
          formatCurrency(row.gross),
          formatCurrency(row.deductions),
          formatCurrency(row.net),
        ])}
      >
        <MultiSeriesTrend
          data={charts.payrollTrend || []}
          theme={theme}
          series={payrollSeries}
          valueFormatter={(value) => formatCurrency(value)}
          axisFormatter={formatCompactCurrency}
        />
      </ChartCard>

      <ChartCard
        title="Payroll by Division"
        description="Net payroll released per division for the selected period."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.payrollByDivision || []).length === 0}
        tableColumns={["Division", "Net Pay"]}
        tableRows={asRows(charts.payrollByDivision || [], formatCurrency)}
      >
        <RankedBarChart
          data={charts.payrollByDivision || []}
          theme={theme}
          seriesLabel="Net Pay"
          valueFormatter={formatCurrency}
          axisFormatter={formatCompactCurrency}
        />
      </ChartCard>

      <ChartCard
        title="Payroll Status"
        description="Payroll runs by release state for the selected period."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.payrollStatus || []).length === 0}
        tableColumns={["Status", "Runs"]}
        tableRows={asRows(charts.payrollStatus || [])}
      >
        <DonutChart data={charts.payrollStatus || []} theme={theme} unitLabel="payroll runs" />
      </ChartCard>

      <ChartCard
        title="Deduction Distribution"
        description="Total amount withheld per deduction type."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.deductionDistribution || []).length === 0}
        tableColumns={["Deduction", "Amount"]}
        tableRows={asRows(charts.deductionDistribution || [], formatCurrency)}
      >
        <RankedBarChart
          data={charts.deductionDistribution || []}
          theme={theme}
          seriesLabel="Amount"
          valueFormatter={formatCurrency}
          axisFormatter={formatCompactCurrency}
          colorIndex={1}
        />
      </ChartCard>

      <ChartCard
        title="Salary Distribution"
        description="Employees grouped into monthly basic salary brackets."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.salaryDistribution || []).length === 0}
        tableColumns={["Salary Bracket", "Employees"]}
        tableRows={asRows(charts.salaryDistribution || [])}
      >
        <ColumnChart data={charts.salaryDistribution || []} theme={theme} colorIndex={2} />
      </ChartCard>
    </div>
  );
}

function LeavePanel({ charts, theme, loading, refreshing, available }) {
  if (!available) {
    return <ModuleUnavailable label="Leave" />;
  }

  const leaveSeries = [
    { key: "filed", label: "Filed", color: theme.series[0] },
    { key: "approved", label: "Approved", color: theme.series[2] },
    { key: "rejected", label: "Rejected", color: theme.series[1] },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Leave Statistics"
        description="Leave applications by status for the selected period."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.leaveStatus || []).length === 0}
        tableColumns={["Status", "Requests", "Days"]}
        tableRows={(charts.leaveStatus || []).map((row) => [row.label, formatNumber(row.value), formatDecimal(row.days)])}
      >
        <DonutChart data={charts.leaveStatus || []} theme={theme} unitLabel="requests" />
      </ChartCard>

      <ChartCard
        title="Leave Type Distribution"
        description="Requests filed per leave type."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.leaveTypeDistribution || []).length === 0}
        tableColumns={["Leave Type", "Requests", "Days"]}
        tableRows={(charts.leaveTypeDistribution || []).map((row) => [
          row.label,
          formatNumber(row.value),
          formatDecimal(row.days),
        ])}
      >
        <DonutChart data={charts.leaveTypeDistribution || []} theme={theme} unitLabel="requests" />
      </ChartCard>

      <ChartCard
        title="Monthly Leave Trend"
        description="Filed, approved, and rejected leave over the last 12 months."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.leaveTrend || []).length === 0}
        className="xl:col-span-2"
        tableColumns={["Month", "Filed", "Approved", "Rejected"]}
        tableRows={(charts.leaveTrend || []).map((row) => [
          row.label,
          formatNumber(row.filed),
          formatNumber(row.approved),
          formatNumber(row.rejected),
        ])}
      >
        <MultiSeriesTrend data={charts.leaveTrend || []} theme={theme} series={leaveSeries} asArea />
      </ChartCard>
    </div>
  );
}

function AttendancePanel({ charts, theme, loading, refreshing, available }) {
  if (!available) {
    return <ModuleUnavailable label="Attendance" />;
  }

  const trendSeries = [
    { key: "present", label: "Present", color: theme.series[2] },
    { key: "absent", label: "Absent", color: theme.series[1] },
    { key: "late", label: "Late", color: theme.series[3] },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Attendance Summary"
        description="Daily attendance records by status."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.attendanceSummary || []).length === 0}
        tableColumns={["Status", "Records"]}
        tableRows={asRows(charts.attendanceSummary || [])}
      >
        <DonutChart data={charts.attendanceSummary || []} theme={theme} unitLabel="records" />
      </ChartCard>

      <ChartCard
        title="Attendance Exceptions"
        description="Late arrivals, undertime, and filed overtime."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.attendanceExceptions || []).every((item) => !item.value)}
        tableColumns={["Exception", "Records"]}
        tableRows={asRows(charts.attendanceExceptions || [])}
      >
        <ColumnChart data={charts.attendanceExceptions || []} theme={theme} seriesLabel="Records" colorIndex={1} />
      </ChartCard>

      <ChartCard
        title="Attendance Trend"
        description="Present, absent, and late counts per day across the selected range."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.attendanceTrend || []).length === 0}
        className="xl:col-span-2"
        tableColumns={["Date", "Present", "Absent", "Late"]}
        tableRows={(charts.attendanceTrend || []).map((row) => [
          row.label,
          formatNumber(row.present),
          formatNumber(row.absent),
          formatNumber(row.late),
        ])}
      >
        <MultiSeriesTrend data={charts.attendanceTrend || []} theme={theme} series={trendSeries} labelKey="label" />
      </ChartCard>
    </div>
  );
}

function PerformancePanel({ charts, theme, loading, refreshing, available }) {
  if (!available) {
    return <ModuleUnavailable label="Performance (IPCR)" />;
  }

  return (
    <div className="grid gap-4">
      <ChartCard
        title="Average IPCR Rating by Division"
        description="Mean final rating across submitted individual performance commitment reviews."
        loading={loading}
        refreshing={refreshing}
        isEmpty={(charts.performanceByDivision || []).length === 0}
        tableColumns={["Division", "Average Rating", "Evaluations"]}
        tableRows={(charts.performanceByDivision || []).map((row) => [
          row.label,
          formatDecimal(row.value),
          formatNumber(row.evaluations),
        ])}
      >
        <MultiSeriesTrend
          data={charts.performanceByDivision || []}
          theme={theme}
          series={[{ key: "value", label: "Average Rating", color: theme.series[6] }]}
          labelKey="label"
          valueFormatter={formatDecimal}
          axisFormatter={formatDecimal}
          allowDecimals
        />
      </ChartCard>
    </div>
  );
}

function ModuleUnavailable({ label }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
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

/**
 * Which panels answer to each sidebar report category. The category now comes from the sidebar, so
 * there is no tab strip — a category simply renders its own charts.
 *
 * The former "Overview" panel rides with `employee`: workforce movement, headcount, composition, and
 * employment status are all employee analytics, and dropping the tab should not drop those charts.
 * Categories absent from this map (training, audit) have no chart data in the dashboard payload.
 */
const CATEGORY_PANELS = {
  employee: [
    { key: "overview", Panel: OverviewPanel },
    { key: "employee", Panel: EmployeePanel },
  ],
  payroll: [{ key: "payroll", Panel: PayrollPanel }],
  leave: [{ key: "leave", Panel: LeavePanel }],
  attendance: [{ key: "attendance", Panel: AttendancePanel }],
  performance: [{ key: "performance", Panel: PerformancePanel }],
};

/** Categories whose panels refuse to render when the backing module has no tables yet. */
const CATEGORY_AVAILABILITY_KEY = {
  payroll: "payroll",
  leave: "leave",
  attendance: "attendance",
  performance: "performance",
};

export default function ReportsCharts({ dashboard, loading = false, refreshing = false, category = "" }) {
  const theme = useReportsTheme();
  const charts = useMemo(() => dashboard?.charts || {}, [dashboard]);
  const availability = dashboard?.availability || {};
  const panels = CATEGORY_PANELS[category];

  if (!panels) {
    return null;
  }

  const availabilityKey = CATEGORY_AVAILABILITY_KEY[category];
  const panelProps = {
    charts,
    theme,
    loading,
    refreshing,
    ...(availabilityKey ? { available: availability[availabilityKey] !== false } : {}),
  };

  return (
    <div className="space-y-4">
      {panels.map(({ key, Panel }) => (
        <Panel key={key} {...panelProps} />
      ))}
    </div>
  );
}
