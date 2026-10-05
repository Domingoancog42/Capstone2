import React, { useEffect, useMemo, useState } from "react";
import {
  Baby,
  BookOpen,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CircleOff,
  CloudLightning,
  Flag,
  HandHeart,
  HeartHandshake,
  HeartPulse,
  Home,
  Leaf,
  Palmtree,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import ProfileFloatingCard from "../profile/ProfileFloatingCard";
import { leaveCreditMatchesGender } from "../../utils/leaveHelpers";

/*
 * One look per leave type: the icon and the colour family its card is painted in. Keyed by the
 * leave_types code, with the name as a fallback for a row whose code was edited; a type an
 * administrator added that neither list knows takes a colour from FALLBACK_TONES by position, so
 * every card is coloured, not just the ones this file has heard of.
 */
const TONES = {
  teal: {
    band: "from-teal-500 to-cyan-500",
    iconBox: "border-teal-200 bg-teal-50 text-teal-700",
    surface: "border-teal-200/80 bg-gradient-to-br from-teal-50/80 to-white",
    bar: "bg-teal-500",
    code: "bg-teal-100 text-teal-800",
  },
  sky: {
    band: "from-sky-500 to-indigo-500",
    iconBox: "border-sky-200 bg-sky-50 text-sky-700",
    surface: "border-sky-200/80 bg-gradient-to-br from-sky-50/80 to-white",
    bar: "bg-sky-500",
    code: "bg-sky-100 text-sky-800",
  },
  rose: {
    band: "from-rose-500 to-pink-500",
    iconBox: "border-rose-200 bg-rose-50 text-rose-700",
    surface: "border-rose-200/80 bg-gradient-to-br from-rose-50/80 to-white",
    bar: "bg-rose-500",
    code: "bg-rose-100 text-rose-800",
  },
  indigo: {
    band: "from-indigo-500 to-violet-500",
    iconBox: "border-indigo-200 bg-indigo-50 text-indigo-700",
    surface: "border-indigo-200/80 bg-gradient-to-br from-indigo-50/80 to-white",
    bar: "bg-indigo-500",
    code: "bg-indigo-100 text-indigo-800",
  },
  amber: {
    band: "from-amber-500 to-orange-500",
    iconBox: "border-amber-200 bg-amber-50 text-amber-700",
    surface: "border-amber-200/80 bg-gradient-to-br from-amber-50/80 to-white",
    bar: "bg-amber-500",
    code: "bg-amber-100 text-amber-800",
  },
  emerald: {
    band: "from-emerald-500 to-lime-500",
    iconBox: "border-emerald-200 bg-emerald-50 text-emerald-700",
    surface: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-white",
    bar: "bg-emerald-500",
    code: "bg-emerald-100 text-emerald-800",
  },
  violet: {
    band: "from-violet-500 to-fuchsia-500",
    iconBox: "border-violet-200 bg-violet-50 text-violet-700",
    surface: "border-violet-200/80 bg-gradient-to-br from-violet-50/80 to-white",
    bar: "bg-violet-500",
    code: "bg-violet-100 text-violet-800",
  },
  orange: {
    band: "from-orange-500 to-red-500",
    iconBox: "border-orange-200 bg-orange-50 text-orange-700",
    surface: "border-orange-200/80 bg-gradient-to-br from-orange-50/80 to-white",
    bar: "bg-orange-500",
    code: "bg-orange-100 text-orange-800",
  },
  slate: {
    band: "from-slate-400 to-slate-500",
    iconBox: "border-slate-200 bg-slate-50 text-slate-600",
    surface: "border-slate-200 bg-gradient-to-br from-slate-50 to-white",
    bar: "bg-slate-400",
    code: "bg-slate-100 text-slate-700",
  },
};

const LEAVE_TYPE_LOOKS = [
  { codes: ["VL"], names: ["vacation leave"], icon: Palmtree, tone: "teal" },
  { codes: ["SL"], names: ["sick leave"], icon: Stethoscope, tone: "sky" },
  { codes: ["ML"], names: ["maternity leave"], icon: Baby, tone: "rose" },
  { codes: ["PL"], names: ["paternity leave"], icon: UserRound, tone: "indigo" },
  { codes: ["SPL"], names: ["special privilege leave"], icon: Sparkles, tone: "amber" },
  { codes: ["FL", "MFL"], names: ["forced leave", "mandatory/forced leave"], icon: Flag, tone: "emerald" },
  { codes: ["STL"], names: ["study leave"], icon: BookOpen, tone: "violet" },
  { codes: ["SOPL"], names: ["solo parent leave"], icon: Users, tone: "orange" },
  { codes: ["VAWC"], names: ["10-day vawc leave"], icon: ShieldAlert, tone: "rose" },
  { codes: ["RP", "RL"], names: ["rehabilitation privilege", "rehabilitation leave"], icon: HeartPulse, tone: "sky" },
  { codes: ["SLBW"], names: ["special leave benefits for women"], icon: HandHeart, tone: "violet" },
  { codes: ["SECL"], names: ["special emergency (calamity) leave"], icon: CloudLightning, tone: "amber" },
  { codes: ["AL"], names: ["adoption leave"], icon: HeartHandshake, tone: "teal" },
  { codes: ["EL"], names: ["emergency leave"], icon: CalendarClock, tone: "orange" },
  { codes: ["LWOP"], names: ["leave without pay"], icon: CircleOff, tone: "slate" },
  { codes: ["TL"], names: ["terminal leave"], icon: Briefcase, tone: "indigo" },
  { codes: ["WL"], names: ["wellness leave"], icon: Leaf, tone: "emerald" },
];
const FALLBACK_TONES = ["teal", "sky", "indigo", "amber", "emerald", "violet", "orange", "rose"];
const FALLBACK_ICONS = [CalendarDays, Home];

function lookFor(entry, index) {
  const code = String(entry?.code || "").trim().toUpperCase();
  const name = String(entry?.name || entry?.type || "").trim().toLowerCase();
  const known = LEAVE_TYPE_LOOKS.find((look) => look.codes.includes(code) || look.names.includes(name));

  return {
    icon: known?.icon || FALLBACK_ICONS[index % FALLBACK_ICONS.length],
    tone: TONES[known?.tone || FALLBACK_TONES[index % FALLBACK_TONES.length]],
  };
}

function formatCreditValue(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(2).replace(/\.?0+$/, "");
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function hasBalance(entry) {
  return entry.total !== null && entry.total !== undefined;
}

/*
 * The card list for a caller that has only the request form's `balances` to give (the management
 * desks' own-balance view). Every tracked credit is its own leave type there.
 */
function entitlementsFromBalances(balances) {
  return (balances || []).map((balance) => ({
    leaveTypeId: null,
    name: balance.type || balance.name || balance.code,
    code: balance.code || "",
    maxDaysPerYear: balance.total ?? null,
    isWithPay: true,
    balanceType: balance.type || null,
    chargedTo: null,
    total: balance.total ?? null,
    used: balance.used ?? 0,
    remaining: balance.remaining ?? balance.total ?? 0,
    monthlyAccrual: balance.monthlyAccrual ?? 0,
    nextAccrualDate: balance.nextAccrualDate ?? "",
  }));
}

/* Same thresholds as the HR balance desk: nothing left, or within 3 days / a quarter of the credit. */
function balanceHealth(remaining, total) {
  if (remaining <= 0) {
    return { label: "Depleted", className: "bg-rose-600 text-white" };
  }

  if (remaining <= (total > 0 ? Math.min(3, total * 0.25) : 3)) {
    return { label: "Low", className: "bg-amber-400 text-slate-950" };
  }

  return { label: "Available", className: "bg-emerald-600 text-white" };
}

export function LeaveBalanceButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
    >
      <Wallet size={16} aria-hidden="true" />
      View Leave/COC Balances
    </button>
  );
}

function LeaveTypeCard({ entry, index }) {
  const { icon: Icon, tone } = lookFor(entry, index);
  const total = Number(entry.total) || 0;
  const used = Number(entry.used) || 0;
  const remaining = Number(entry.remaining) || 0;
  /*
   * A credit that is tracked but has never been funded (Study Leave starts at zero and is granted
   * as approved) is not "depleted"; it reads like a per-filing leave until HR credits it.
   */
  const ownBalance = hasBalance(entry) && !entry.chargedTo && (total > 0 || used > 0 || remaining > 0);
  const maxDays = entry.maxDaysPerYear !== null && entry.maxDaysPerYear !== undefined
    ? Number(entry.maxDaysPerYear)
    : null;
  const health = ownBalance ? balanceHealth(remaining, total) : null;
  const usedShare = ownBalance && total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;

  let headline;
  let headlineLabel;
  let footnote;

  if (ownBalance) {
    headline = formatCreditValue(remaining);
    headlineLabel = "Remaining days";
    footnote = `${formatCreditValue(used)} used of ${formatCreditValue(total)}`;
  } else if (entry.chargedTo) {
    headline = maxDays !== null ? formatCreditValue(maxDays) : "—";
    headlineLabel = maxDays !== null ? "Days per year" : "As approved";
    footnote = `Charged to ${entry.chargedTo} · ${formatCreditValue(remaining)} remaining there`;
  } else if (maxDays !== null && maxDays > 0) {
    headline = formatCreditValue(maxDays);
    headlineLabel = "Days per year";
    footnote = entry.isWithPay === false
      ? "Without pay · approved per filing"
      : "Granted per filing · not deducted from credits";
  } else if (hasBalance(entry)) {
    headline = "—";
    headlineLabel = "As approved";
    footnote = "No credits granted yet · credited by HR when approved";
  } else {
    headline = "—";
    headlineLabel = "As approved";
    footnote = entry.isWithPay === false ? "Without pay · no fixed yearly credit" : "No fixed yearly credit";
  }

  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border shadow-sm ${tone.surface}`}>
      <div className={`h-1.5 bg-gradient-to-r ${tone.band}`} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${tone.iconBox}`}>
            <Icon size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-sm font-semibold leading-5 text-slate-900">{entry.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {entry.code ? (
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.code}`}>
                  {entry.code}
                </span>
              ) : null}
              {health ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${health.className}`}>
                  {health.label}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <strong className="block text-3xl font-extrabold leading-none tracking-tight text-slate-950 tabular-nums">
            {headline}
          </strong>
          <p className="m-0 mt-1 text-xs font-medium text-slate-500">{headlineLabel}</p>
        </div>

        {ownBalance ? (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80"
            role="progressbar"
            aria-label={`${entry.name} credits used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usedShare)}
          >
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${usedShare}%` }} />
          </div>
        ) : null}

        <div className="mt-auto space-y-1">
          <p className="m-0 text-xs text-slate-600">{footnote}</p>
          {ownBalance && Number(entry.monthlyAccrual) > 0 ? (
            <p className="m-0 text-xs text-slate-500">
              {`+${formatCreditValue(entry.monthlyAccrual)} per month`}
              {entry.nextAccrualDate ? ` · next on ${formatDate(entry.nextAccrualDate)}` : ""}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CardGroup({ title, description, entries, startIndex = 0 }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="m-0 text-sm font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      {description ? <p className="m-0 mt-1 text-sm text-slate-500">{description}</p> : null}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {entries.map((entry, index) => (
          <LeaveTypeCard
            key={entry.leaveTypeId ?? `${entry.code}-${entry.name}`}
            entry={entry}
            index={startIndex + index}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Every leave type on the employee's account, as a card wall: the credits with a running balance
 * first (Vacation, Sick, ...), then the leaves granted per filing. Opens maximized, since a
 * dozen-odd cards want the room; the header button restores the floating size.
 *
 * `credits` is the snapshot leave_credit.php returns. `leaveCredits` -- its `balances` list on
 * its own -- is still accepted for a caller that keeps only that, and gives one card per credit.
 */
export default function LeaveBalanceModal({
  open,
  onClose,
  credits = null,
  leaveCredits = [],
  loading = false,
  error = "",
  onRetry,
}) {
  const [maximized, setMaximized] = useState(true);

  useEffect(() => {
    if (open) {
      setMaximized(true);
    }
  }, [open]);

  const gender = credits?.gender || "";
  const entries = useMemo(() => {
    const source = Array.isArray(credits?.entitlements) && credits.entitlements.length > 0
      ? credits.entitlements
      : entitlementsFromBalances(credits?.balances || leaveCredits);

    return source.filter((entry) => leaveCreditMatchesGender(entry, gender));
  }, [credits, gender, leaveCredits]);

  const tracked = entries.filter(hasBalance);
  const granted = entries.filter((entry) => !hasBalance(entry));
  const year = credits?.year || new Date().getFullYear();
  const asOf = formatDate(credits?.creditsAsOf);

  return (
    <ProfileFloatingCard
      open={open}
      onClose={onClose}
      title="Leave/COC Balances"
      subtitle={`Every leave type on your employee account for ${year}${asOf ? `, as of ${asOf}` : ""}.`}
      icon={Wallet}
      maxWidth="max-w-[1180px]"
      maximized={maximized}
      onToggleMaximize={() => setMaximized((current) => !current)}
      bodyClassName="px-4 pb-6 sm:px-6"
    >
      {loading ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-label="Loading leave and COC balances"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-[188px] animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
          <p className="m-0 text-sm font-semibold text-rose-800">Unable to load your balances.</p>
          <p className="m-0 mt-1 text-sm text-rose-700">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-9 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              Try Again
            </button>
          ) : null}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <p className="m-0 text-sm font-semibold text-slate-700">No leave types to show yet.</p>
          <p className="m-0 mt-1 text-sm text-slate-500">Your leave credits will appear once HR sets them up.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <CardGroup
            title="Leave credits"
            description="Credits with a running balance: what is left, what has been used, and how the balance grows."
            entries={tracked}
          />
          <CardGroup
            title="Other leave entitlements"
            description="Leaves granted per filing rather than drawn from a credit balance."
            entries={granted}
            startIndex={tracked.length}
          />
        </div>
      )}
    </ProfileFloatingCard>
  );
}
