import React from "react";
import {
  Ban,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colorEntityRows, colorOrdinalRows, useReportsTheme } from "./reportsTheme";

/*
 * The insight cards, charts and toolbar buttons shared by the request-report workspaces (Leave,
 * Travel Order, CTO). Each workspace computes its own figures from the report rows; these only draw
 * them, so the three screens look and read the same.
 */

export function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const KPI_ICONS = [BarChart3, CheckCircle2, Clock3, XCircle, Ban, CalendarDays];
const PIE_COLORS = {
  Approved: "#16a34a",
  Pending: "#d97706",
  Rejected: "#dc2626",
  Cancelled: "#64748b",
  Unspecified: "#94a3b8",
};
const FALLBACK_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#0891b2", "#4f46e5"];

export function formatDays(value) {
  return numberValue(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatHours(value) {
  return `${numberValue(value).toLocaleString("en-PH", { maximumFractionDigits: 2 })} hrs`;
}

export function formatCurrency(value) {
  return numberValue(value).toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(value) {
  if (!value || value === "N/A") return "N/A";
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatKpi(kpi) {
  if (kpi.format === "currency") return formatCurrency(kpi.value);
  if (kpi.format === "days") return formatDays(kpi.value);
  if (kpi.format === "hours") return formatHours(kpi.value);
  if (kpi.format === "percent") return `${numberValue(kpi.value).toLocaleString("en-PH", { maximumFractionDigits: 1 })}%`;
  if (kpi.format === "text") return String(kpi.value);
  return numberValue(kpi.value).toLocaleString("en-PH");
}

function truncateLabel(value) {
  const label = String(value || "");
  return label.length > 18 ? `${label.slice(0, 16)}…` : label;
}

export function ToolbarButton({ icon: Icon, children, onClick, busy = false, disabled = false, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        primary
          ? "border-[#D61E1E] bg-[#D61E1E] text-white hover:bg-[#b91818] dark:border-emerald-500 dark:bg-emerald-500"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

/** A row of headline figures. A KPI may name its own `icon`; otherwise the icon follows its position. */
export function KpiGrid({ kpis, loading }) {
  return (
    <section aria-label="Report summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {(loading ? Array.from({ length: 6 }, (_, index) => ({ key: `loading-${index}` })) : kpis).map((item, index) => {
        const Icon = item.icon || KPI_ICONS[index] || BarChart3;
        return (
          <article key={item.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
            {loading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-9 w-9 rounded-lg bg-slate-100" />
                <div className="h-3 w-24 rounded bg-slate-100" />
                <div className="h-7 w-20 rounded bg-slate-100" />
              </div>
            ) : (
              <div className="flex h-full items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                  <p className={`m-0 mt-2 font-semibold text-slate-900 ${item.format === "text" ? "text-lg leading-6" : "text-2xl"}`}>
                    {formatKpi(item)}
                  </p>
                  {item.hint ? <p className="m-0 mt-1 text-xs text-slate-400">{item.hint}</p> : null}
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                  <Icon size={18} aria-hidden="true" />
                </span>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="grid h-[270px] place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 text-center">
      <div>
        <BarChart3 size={22} className="mx-auto text-slate-300" aria-hidden="true" />
        <p className="m-0 mt-2 text-sm font-medium text-slate-500">No chart data for the selected filters.</p>
      </div>
    </div>
  );
}

function ChartCard({ chart, refreshing }) {
  const { data = [] } = chart;
  const theme = useReportsTheme();
  /*
   * A bar chart's bars stand for named things (divisions, leave types, destinations, employees), so
   * each takes its entity's hue, in slot order. A chart of ordered bands (`ordinal: true`) takes the
   * one-hue ordinal ramp instead, so its colour reads as the order.
   */
  const barRows = chart.type === "bar" || chart.type === "horizontalBar"
    ? chart.ordinal ? colorOrdinalRows(data, theme) : colorEntityRows(data, theme)
    : data;
  const barCells = barRows.map((row, index) => <Cell key={`${row.label}-${index}`} fill={row.color} />);
  const formatChartValue = (value) => {
    if (chart.currency) return formatCurrency(value);
    if (chart.hours) return formatHours(value);
    return numberValue(value).toLocaleString("en-PH", { maximumFractionDigits: 2 });
  };
  const tooltipFormatter = (value, name) => [formatChartValue(value), name === "value" ? "Total" : name];

  return (
    <article className={`rounded-xl border border-slate-200 bg-white p-4 transition-opacity ${refreshing ? "opacity-60" : "opacity-100"}`}>
      <header className="mb-3">
        <h3 className="m-0 text-sm font-semibold text-slate-900">{chart.title}</h3>
      </header>
      {data.length === 0 ? (
        <EmptyChart />
      ) : (
        <div className="h-[285px] w-full" role="img" aria-label={chart.title}>
          <ResponsiveContainer width="100%" height="100%">
            {chart.type === "donut" ? (
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="label" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {data.map((entry, index) => (
                    <Cell key={entry.label} fill={PIE_COLORS[entry.label] || FALLBACK_COLORS[index % FALLBACK_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={tooltipFormatter} />
                <Legend verticalAlign="bottom" iconType="circle" iconSize={8} />
              </PieChart>
            ) : chart.type === "line" ? (
              <LineChart data={data} margin={{ top: 10, right: 12, left: -12, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={Boolean(chart.hours)} />
                <Tooltip formatter={tooltipFormatter} />
                <Line type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 3, fill: "#0f766e" }} activeDot={{ r: 5 }} />
              </LineChart>
            ) : chart.type === "horizontalBar" ? (
              <BarChart data={barRows} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="label" width={115} tickFormatter={truncateLabel} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={tooltipFormatter} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>{barCells}</Bar>
              </BarChart>
            ) : chart.type === "stackedBar" ? (
              <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tickFormatter={truncateLabel} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} interval={0} angle={-15} textAnchor="end" height={52} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={tooltipFormatter} />
                <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} />
                <Bar dataKey="withPay" name="With Pay" stackId="pay" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="withoutPay" name="Without Pay" stackId="pay" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <BarChart data={barRows} margin={{ top: 8, right: 12, left: chart.currency ? 14 : -8, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tickFormatter={truncateLabel} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} interval={0} angle={-15} textAnchor="end" height={58} />
                <YAxis tickFormatter={chart.currency ? (value) => `₱${numberValue(value).toLocaleString("en-PH", { notation: "compact" })}` : undefined} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={chart.currency || chart.hours || undefined} />
                <Tooltip formatter={tooltipFormatter} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={42}>{barCells}</Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

export function ChartsGrid({ charts, refreshing }) {
  return (
    <section aria-label="Report analytics" className="grid gap-4 xl:grid-cols-2">
      {charts.map((chart) => <ChartCard key={chart.key} chart={chart} refreshing={refreshing} />)}
    </section>
  );
}
