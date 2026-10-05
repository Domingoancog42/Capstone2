import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  Building2,
  CalendarDays,
  Clock3,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import DashboardMonthlyCalendar from "./DashboardMonthlyCalendar";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const compactTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function greetingFor(date) {
  const hour = date.getHours();

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function DetailCard({ icon: Icon, label, value, helper, secondary, tone }) {
  const tones = {
    blue: "border-blue-100 bg-blue-50/60 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/25 dark:text-blue-300",
    violet: "border-violet-100 bg-violet-50/60 text-violet-600 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-300",
    emerald: "border-emerald-100 bg-emerald-50/60 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-300",
  };

  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-3.5 ${tones[tone]}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/80 shadow-sm dark:bg-slate-900/70">
        <Icon size={19} strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-75">{label}</dt>
        <dd className="m-0 mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-slate-100" title={value}>{value}</dd>
        <dd className="m-0 mt-0.5 truncate text-[10px] font-medium text-slate-400 dark:text-slate-500">{helper}</dd>
        {secondary ? (
          <dd className="m-0 mt-1 truncate text-[10px] font-semibold text-slate-600 dark:text-slate-300" title={secondary}>
            {secondary}
          </dd>
        ) : null}
      </div>
    </div>
  );
}

/* Decorative mountain ridge along the bottom of the welcome card content column, filled in the
   accent colour via currentColor. */
function WelcomeBackdropArt() {
  return (
    <div className="dashboard-welcome-backdrop__art pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <svg className="absolute inset-x-0 bottom-0 h-24 w-full" viewBox="0 0 640 96" preserveAspectRatio="none" fill="currentColor">
        <path d="M0 96V70L54 46L102 66L168 28L236 60L298 40L362 72L426 44L490 68L548 36L640 62V96Z" opacity="0.06" />
        <path d="M0 96V82L70 66L140 78L210 56L280 74L350 62L420 82L500 60L570 76L640 58V96Z" opacity="0.1" />
      </svg>
    </div>
  );
}

function detailGridClass(count) {
  if (count <= 1) return "sm:grid-cols-1";
  if (count === 2) return "sm:grid-cols-2";
  return "sm:grid-cols-3";
}

export default function DashboardWelcomeBanner({
  name,
  timestamp,
  className = "",
  imageUrl = "",
  subtitle = "",
  position = "",
  role = "",
  division = "",
  divisionHelper = "Your assigned division",
  supervisor = "",
  actions = null,
  showCalendar = false,
  canManageCalendar = false,
  canCreateCalendarEntries = canManageCalendar,
  variant = "default",
  showPositionCard = true,
  showRoleCard = true,
  showDivisionCard = true,
}) {
  const [currentTime, setCurrentTime] = useState(() => {
    const initialTime = timestamp instanceof Date ? timestamp : timestamp ? new Date(timestamp) : new Date();
    return Number.isNaN(initialTime.getTime()) ? new Date() : initialTime;
  });

  useEffect(() => {
    if (timestamp !== undefined && timestamp !== null) {
      const nextTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
      if (!Number.isNaN(nextTime.getTime())) setCurrentTime(nextTime);
      return undefined;
    }

    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [timestamp]);

  const displayName = String(name || "User").trim() || "User";
  const displayPosition = String(position || subtitle || "Not assigned").trim() || "Not assigned";
  const displayRole = String(role || "User").trim() || "User";
  const displayDivision = String(division || "Not assigned").trim() || "Not assigned";
  const displaySupervisor = String(supervisor || "Not assigned").trim() || "Not assigned";
  const detailCards = [
    showPositionCard ? { icon: Briefcase, label: "Position", value: displayPosition, helper: "Your current position", tone: "blue" } : null,
    showRoleCard ? { icon: ShieldCheck, label: "Role", value: displayRole, helper: "System access role", tone: "violet" } : null,
    showDivisionCard
      ? {
        icon: Building2,
        label: "Division",
        value: displayDivision,
        helper: divisionHelper,
        secondary: variant === "employee" ? `Supervisor: ${displaySupervisor}` : "",
        tone: "emerald",
      }
      : null,
  ].filter(Boolean);

  if (!showCalendar && variant !== "employee") {
    return (
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={`dashboard-welcome-banner relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#D61E1E_0%,#cf1c4c_52%,#e63a61_100%)] px-4 py-4 text-white shadow-[0_14px_30px_rgba(214,30,30,0.24)] sm:px-5 ${className}`.trim()}
      >
        <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 -right-12 h-56 w-56 rounded-full bg-white/10" />
        <div className="relative min-w-0">
          <div className="flex items-center gap-3.5">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-white/10 text-white shadow-lg">
              {imageUrl ? <img src={imageUrl} alt={displayName} className="h-full w-full object-cover" /> : <UserRound size={27} aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">Your workspace</p>
              <h1 className="m-0 mt-0.5 truncate text-xl font-semibold leading-tight text-white">Welcome, {displayName}</h1>
              <p className="m-0 mt-1 text-xs font-medium text-white/65">Here is your workspace overview.</p>
            </div>
          </div>
          {detailCards.length ? (
            <dl className={`mt-3 grid grid-cols-1 gap-2 ${detailGridClass(detailCards.length)}`}>
              {detailCards.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.09] px-2.5 py-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 text-white/75">
                      <Icon size={14} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <dt className="text-[9px] font-bold uppercase tracking-[0.13em] text-white/55">{item.label}</dt>
                      <dd className="m-0 truncate text-xs font-semibold text-white" title={item.value}>{item.value}</dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-2.5">
            <div className="inline-flex min-w-0 items-center gap-2 text-[11px] font-semibold text-white/80">
              <Clock3 size={14} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{compactTimestampFormatter.format(currentTime)}</span>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
          </div>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`dashboard-welcome-banner dashboard-welcome-banner--clean ${variant === "employee" ? "dashboard-welcome-banner--employee" : ""} relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white text-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.08)] dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-100 ${className}`.trim()}
    >
      {/* Decorative backdrop only: every layer is pointer-events-none and sits under the relative content grid. */}
      <div className="dashboard-welcome-backdrop pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="dashboard-welcome-backdrop__wash absolute inset-0" />
        <div className="dashboard-welcome-backdrop__grid absolute inset-0" />
        <div className="dashboard-welcome-backdrop__orb--accent absolute -right-20 -top-28 h-80 w-80 rounded-full blur-3xl" />
        <div className="dashboard-welcome-backdrop__orb--sky absolute -bottom-36 -left-20 h-72 w-72 rounded-full blur-3xl" />
        <div className="dashboard-welcome-backdrop__hairline absolute inset-x-0 top-0 h-px" />
      </div>

      <div className={`relative grid ${showCalendar ? "2xl:grid-cols-[minmax(500px,1.02fr)_minmax(560px,0.98fr)]" : ""}`}>
        <div className="relative isolate flex min-w-0 flex-col p-5 sm:p-6 lg:p-7">
          <WelcomeBackdropArt />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 shadow-sm dark:border-blue-900/70 dark:from-blue-950 dark:to-slate-900 dark:text-blue-300 sm:h-[72px] sm:w-[72px]">
                {imageUrl ? (
                  <img src={imageUrl} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <UserRound size={34} strokeWidth={1.9} aria-hidden="true" />
                )}
              </div>

              <div className="min-w-0">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                  {greetingFor(currentTime)},
                </p>
                <h1 className="m-0 mt-1 text-2xl font-bold leading-tight tracking-tight text-slate-950 dark:text-white sm:text-[28px]">
                  Welcome, <span className="text-blue-600 dark:text-blue-400">{displayName}!</span>
                </h1>
                <p className="m-0 mt-1.5 text-sm font-medium text-slate-500 dark:text-slate-400">
                  Here&apos;s your workspace overview. Have a productive day!
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-blue-100/80 bg-blue-50/70 px-3 py-2.5 dark:border-blue-900/60 dark:bg-blue-950/30">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-300">
                <CalendarDays size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="m-0 whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">{dateFormatter.format(currentTime)}</p>
                <time className="mt-0.5 block whitespace-nowrap text-lg font-bold leading-none tracking-tight text-slate-950 dark:text-white">
                  {timeFormatter.format(currentTime)}
                </time>
              </div>
            </div>
          </div>

          {detailCards.length ? (
            <dl className={`mt-6 grid grid-cols-1 gap-3 ${detailGridClass(detailCards.length)}`}>
              {detailCards.map((item) => (
                <DetailCard key={item.label} {...item} />
              ))}
            </dl>
          ) : null}

          {actions ? <div className="mt-4 flex flex-wrap gap-2.5">{actions}</div> : null}
        </div>

        {showCalendar ? (
          <div className="min-w-0 border-t border-slate-200/80 bg-slate-50/45 p-3 dark:border-slate-700/80 dark:bg-slate-950/25 2xl:border-l 2xl:border-t-0">
            <DashboardMonthlyCalendar
              canManageEntries={canManageCalendar}
              canCreateEntries={canCreateCalendarEntries}
            />
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
