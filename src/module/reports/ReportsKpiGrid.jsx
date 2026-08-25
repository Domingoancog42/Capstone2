import React, { memo, useMemo, useState } from "react";
import {
  Accessibility,
  Award,
  BadgeCheck,
  Banknote,
  Briefcase,
  Cake,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Coins,
  FileSignature,
  Heart,
  Hourglass,
  LogOut,
  Minus,
  Sunset,
  TrendingDown,
  TrendingUp,
  User,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import { computeDelta, formatKpiValue, useCountUp } from "./reportsTheme";

const ICONS = {
  users: Users,
  "user-check": UserCheck,
  "user-x": UserX,
  user: User,
  accessibility: Accessibility,
  heart: Heart,
  "badge-check": BadgeCheck,
  "file-signature": FileSignature,
  briefcase: Briefcase,
  "clipboard-list": ClipboardList,
  "log-out": LogOut,
  sunset: Sunset,
  "user-plus": UserPlus,
  cake: Cake,
  award: Award,
  wallet: Wallet,
  banknote: Banknote,
  hourglass: Hourglass,
  "calendar-check": CalendarCheck,
  "calendar-clock": CalendarClock,
  "calendar-x": CalendarX,
  coins: Coins,
};

const GROUP_ACCENTS = {
  employee: "border-sky-200 bg-sky-50 text-sky-700",
  payroll: "border-emerald-200 bg-emerald-50 text-emerald-700",
  leave: "border-violet-200 bg-violet-50 text-violet-700",
};

/**
 * Metrics surfaced before the reader expands the full set. Everything else stays
 * one click away so the dashboard opens on a readable number of cards.
 */
const PRIMARY_KEYS = new Set([
  "totalEmployees",
  "activeEmployees",
  "inactiveEmployees",
  "newlyHired",
  "payrollThisMonth",
  "payrollPending",
  "approvedLeaves",
  "pendingLeaves",
]);

/**
 * "Up is good" is metric-specific: more pending payroll or more rejected leaves
 * is not an improvement, so those invert the delta colour.
 */
const LOWER_IS_BETTER = new Set([
  "inactiveEmployees",
  "payrollPending",
  "pendingLeaves",
  "rejectedLeaves",
  "resignedEmployees",
]);

function DeltaChip({ metricKey, delta }) {
  if (!delta || delta.direction === "flat") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
        <Minus size={11} aria-hidden="true" />
        No change
      </span>
    );
  }

  const isUp = delta.direction === "up";
  const isGood = LOWER_IS_BETTER.has(metricKey) ? !isUp : isUp;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const tone = isGood
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      <Icon size={11} aria-hidden="true" />
      {`${isUp ? "+" : ""}${delta.percent.toFixed(1)}%`}
    </span>
  );
}

const KpiCard = memo(function KpiCard({ kpi }) {
  const animatedValue = useCountUp(kpi.value);
  const delta = computeDelta(kpi.value, kpi.previous);
  const Icon = ICONS[kpi.icon] || Users;
  const accent = GROUP_ACCENTS[kpi.group] || GROUP_ACCENTS.employee;

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent}`}>
          <Icon size={17} aria-hidden="true" />
        </span>
        <DeltaChip metricKey={kpi.key} delta={delta} />
      </div>

      <div>
        <p className="m-0 text-[13px] font-medium leading-snug text-slate-500">{kpi.label}</p>
        <p className="m-0 mt-1 text-lg font-semibold leading-tight text-slate-900">
          {formatKpiValue(animatedValue, kpi.format)}
          {kpi.hint ? <span className="ml-1.5 text-xs font-medium text-slate-500">{kpi.hint}</span> : null}
        </p>
      </div>

      <p className="m-0 text-[11px] font-medium text-slate-500">
        {kpi.previous === null || kpi.previous === undefined
          ? "Current snapshot"
          : `vs ${formatKpiValue(kpi.previous, kpi.format)} last month`}
      </p>
    </div>
  );
});

function KpiSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="h-9 w-9 rounded-lg bg-slate-100" />
        <div className="h-5 w-16 rounded-full bg-slate-100" />
      </div>
      <div className="h-3 w-24 rounded bg-slate-100" />
      <div className="h-7 w-20 rounded bg-slate-100" />
      <div className="h-3 w-28 rounded bg-slate-100" />
    </div>
  );
}

export default function ReportsKpiGrid({ kpis = [], loading = false, refreshing = false }) {
  const [expanded, setExpanded] = useState(false);

  const { primary, secondary } = useMemo(() => {
    const primaryCards = kpis.filter((kpi) => PRIMARY_KEYS.has(kpi.key));

    return {
      primary: primaryCards.length > 0 ? primaryCards : kpis.slice(0, 8),
      secondary: kpis.filter((kpi) => !PRIMARY_KEYS.has(kpi.key)),
    };
  }, [kpis]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <KpiSkeleton key={`kpi-skeleton-${index}`} />
        ))}
      </div>
    );
  }

  if (kpis.length === 0) {
    return null;
  }

  const visible = expanded ? [...primary, ...secondary] : primary;

  return (
    <div className={`space-y-3 transition-opacity duration-200 ${refreshing ? "opacity-60" : "opacity-100"}`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>

      {secondary.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
          {expanded ? "Show fewer metrics" : `Show ${secondary.length} more metrics`}
        </button>
      ) : null}
    </div>
  );
}
