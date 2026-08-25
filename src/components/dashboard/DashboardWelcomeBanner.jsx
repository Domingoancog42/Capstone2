import React from "react";
import { motion } from "framer-motion";
import { Briefcase, Building2, Clock3, ShieldCheck, UserRound } from "lucide-react";

const welcomeTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export default function DashboardWelcomeBanner({
  name,
  timestamp = new Date(),
  className = "",
  imageUrl = "",
  subtitle = "",
  position = "",
  role = "",
  division = "",
  actions = null,
}) {
  const displayName = String(name || "User").trim() || "User";
  const displayPosition = String(position || subtitle || "Not assigned").trim() || "Not assigned";
  const displayRole = String(role || "User").trim() || "User";
  const displayDivision = String(division || "Not assigned").trim() || "Not assigned";
  const resolvedTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const displayTimestamp = Number.isNaN(resolvedTimestamp.getTime())
    ? ""
    : welcomeTimestampFormatter.format(resolvedTimestamp);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`dashboard-welcome-banner relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#D61E1E_0%,#cf1c4c_52%,#e63a61_100%)] px-5 py-4 text-white shadow-[0_14px_30px_rgba(214,30,30,0.24)] sm:px-4 sm:py-5 ${className}`.trim()}
    >
      <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-20 -right-12 h-56 w-56 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute right-5 top-5 h-12 w-12 rounded-full border border-white/10 bg-white/5" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 text-white shadow-inner ring-1 ring-white/10 backdrop-blur-sm sm:h-20 sm:w-20">
          {imageUrl ? (
            <img src={imageUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <UserRound size={32} strokeWidth={2.2} aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/65">
            Your workspace
          </p>
          <h1 className="m-0 text-lg font-semibold leading-tight tracking-tight text-white sm:text-xl">
            Welcome, {displayName}
          </h1>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-2.5 py-2 backdrop-blur-sm">
              <Briefcase size={15} className="shrink-0 text-white/75" aria-hidden="true" />
              <div className="min-w-0 leading-tight">
                <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-white/60">Position</span>
                <span className="block truncate text-xs font-semibold text-white sm:text-sm">{displayPosition}</span>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-2.5 py-2 backdrop-blur-sm">
              <ShieldCheck size={15} className="shrink-0 text-white/75" aria-hidden="true" />
              <div className="min-w-0 leading-tight">
                <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-white/60">Role</span>
                <span className="block truncate text-xs font-semibold text-white sm:text-sm">{displayRole}</span>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-2.5 py-2 backdrop-blur-sm">
              <Building2 size={15} className="shrink-0 text-white/75" aria-hidden="true" />
              <div className="min-w-0 leading-tight">
                <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-white/60">Division</span>
                <span className="block truncate text-xs font-semibold text-white sm:text-sm">{displayDivision}</span>
              </div>
            </div>
          </div>

          <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 text-xs font-medium text-white/95 backdrop-blur-sm sm:text-sm">
            <Clock3 size={16} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{displayTimestamp}</span>
          </div>
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </motion.section>
  );
}
