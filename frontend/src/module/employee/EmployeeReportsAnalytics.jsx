import React, { useMemo } from "react";
import {
  BriefcaseBusiness,
  Building2,
  CircleUserRound,
  Clock3,
  IdCard,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import {
  DistributionPieChart,
  useAnalyticsTheme,
} from "../../components/analytics/analyticsChartKit";
import { numberFormatter } from "../../utils/format";

const MAX_PIE_SLICES = 8;

const chartDefinitions = [
  {
    key: "recordStatus",
    title: "Employee Record Status",
    description: "Active and inactive employee records in the current registry.",
    icon: UserRoundCheck,
    colorOffset: 0,
  },
  {
    key: "division",
    title: "Division Distribution",
    description: "Workforce share across organizational divisions.",
    icon: Building2,
    colorOffset: 1,
  },
  {
    key: "designation",
    title: "Position Distribution",
    description: "Employees grouped by their position.",
    icon: IdCard,
    colorOffset: 2,
  },
  {
    key: "employmentStatus",
    title: "Employment Status",
    description: "Workforce share by permanent, contractual, COS, and other appointment types.",
    icon: BriefcaseBusiness,
    colorOffset: 3,
  },
  {
    key: "gender",
    title: "Gender Distribution",
    description: "Workforce distribution by recorded gender.",
    icon: CircleUserRound,
    colorOffset: 4,
  },
  {
    key: "inclusion",
    title: "Inclusion Distribution",
    description: "Recorded PWD and non-PWD employee representation.",
    icon: ShieldCheck,
    colorOffset: 5,
  },
  {
    key: "age",
    title: "Age Distribution",
    description: "Employees grouped into practical workforce age bands.",
    icon: UsersRound,
    colorOffset: 6,
  },
  {
    key: "tenure",
    title: "Years of Service",
    description: "Employees grouped by completed years of government service.",
    icon: Clock3,
    colorOffset: 7,
  },
];

function cleanLabel(value, fallback = "Not specified") {
  const label = String(value ?? "").trim();
  return label || fallback;
}

function truthyFlag(value) {
  return value === true || ["1", "true", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function dateYearsSince(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  let years = today.getFullYear() - date.getFullYear();
  const anniversaryPassed = today.getMonth() > date.getMonth()
    || (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());
  if (!anniversaryPassed) years -= 1;
  return Math.max(0, years);
}

function ageBand(employee) {
  const age = dateYearsSince(employee.dateOfBirth);
  if (age === null) return "Not specified";
  if (age < 25) return "Under 25";
  if (age < 35) return "25–34";
  if (age < 45) return "35–44";
  if (age < 55) return "45–54";
  if (age < 65) return "55–64";
  return "65 and above";
}

function tenureBand(employee) {
  const years = dateYearsSince(employee.dateHired);
  if (years === null) return "Not specified";
  if (years < 1) return "Less than 1 year";
  if (years < 5) return "1–4 years";
  if (years < 10) return "5–9 years";
  if (years < 20) return "10–19 years";
  return "20 years and above";
}

function countBy(employees, selector) {
  const counts = new Map();

  employees.forEach((employee) => {
    const label = cleanLabel(selector(employee));
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return Array.from(counts, ([label, value]) => ({ label, value }));
}

/** Keep pies readable when a registry contains a long tail of divisions or designations. */
function compactSlices(rows) {
  if (rows.length <= MAX_PIE_SLICES) {
    return [...rows].sort((left, right) => left.label.localeCompare(right.label));
  }

  const ranked = [...rows].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  const visible = ranked.slice(0, MAX_PIE_SLICES - 1);
  const otherValue = ranked.slice(MAX_PIE_SLICES - 1).reduce((sum, row) => sum + row.value, 0);
  return [...visible, { label: "Other", value: otherValue }];
}

function buildAnalytics(employees) {
  return {
    recordStatus: countBy(employees, (employee) => cleanLabel(employee.status, "Active")),
    division: countBy(employees, (employee) => employee.department || employee.division),
    designation: countBy(employees, (employee) => employee.position),
    employmentStatus: countBy(employees, (employee) => employee.employmentStatus),
    gender: countBy(employees, (employee) => employee.gender),
    inclusion: countBy(employees, (employee) => (truthyFlag(employee.pwd) ? "PWD" : "Non-PWD")),
    age: countBy(employees, ageBand),
    tenure: countBy(employees, tenureBand),
  };
}

function distinctKnownCount(employees, selector) {
  return new Set(
    employees
      .map((employee) => String(selector(employee) ?? "").trim())
      .filter(Boolean)
  ).size;
}

function AnalyticsMetric({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <p className={`m-0 text-2xl font-bold tabular-nums ${tone}`}>{numberFormatter.format(value)}</p>
      <p className="m-0 mt-1 text-xs font-semibold text-slate-500">{label}</p>
    </div>
  );
}

function EmployeePieCard({ definition, rows, theme, loading }) {
  const Icon = definition.icon;
  const data = compactSlices(rows)
    .filter((row) => row.value > 0)
    .map((row, index) => ({
      ...row,
      color: theme.series[(index + definition.colorOffset) % theme.series.length],
    }));

  return (
    <section
      aria-label={`${definition.title} pie chart`}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: `${theme.series[definition.colorOffset % theme.series.length]}18`, color: theme.series[definition.colorOffset % theme.series.length] }}
        >
          <Icon size={17} aria-hidden="true" />
        </span>
        <div>
          <h3 className="m-0 text-sm font-semibold text-slate-900">{definition.title}</h3>
          <p className="m-0 mt-1 text-xs leading-5 text-slate-500">{definition.description}</p>
        </div>
      </header>

      <div className="mt-3">
        {loading ? (
          <div className="h-[310px] animate-pulse rounded-xl bg-slate-100" />
        ) : data.length === 0 ? (
          <div className="grid h-[310px] place-items-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-sm text-slate-500">
            No employee data available for this breakdown.
          </div>
        ) : (
          <DistributionPieChart
            data={data}
            theme={theme}
            height={220}
            showSlicePercentages
            legendLayout="stacked"
          />
        )}
      </div>
    </section>
  );
}

export default function EmployeeReportsAnalytics({ employees = [], loading = false }) {
  const theme = useAnalyticsTheme();
  const analytics = useMemo(() => buildAnalytics(employees), [employees]);
  const activeCount = employees.filter((employee) => !/inactive|separated|retired/i.test(String(employee.status || ""))).length;
  const divisionCount = distinctKnownCount(employees, (employee) => employee.department || employee.division);
  const designationCount = distinctKnownCount(employees, (employee) => employee.position);

  return (
    <div className="space-y-4" aria-label="Employee reports analytics">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="m-0 text-lg font-bold text-slate-950">Employee Reports Analytics</h2>
        <p className="m-0 mt-1 text-sm leading-6 text-slate-500">
          Live workforce distributions generated from the same employee registry shown in Employee Management.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AnalyticsMetric label="Total employees" value={employees.length} tone="text-blue-700" />
        <AnalyticsMetric label="Active employees" value={activeCount} tone="text-emerald-700" />
        <AnalyticsMetric label="Divisions represented" value={divisionCount} tone="text-violet-700" />
        <AnalyticsMetric label="Positions represented" value={designationCount} tone="text-amber-700" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {chartDefinitions.map((definition) => (
          <EmployeePieCard
            key={definition.key}
            definition={definition}
            rows={analytics[definition.key] || []}
            theme={theme}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}
