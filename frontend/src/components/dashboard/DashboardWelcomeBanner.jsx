import React from "react";
import { motion } from "framer-motion";
import { Clock3, UserRound } from "lucide-react";

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
  actions = null,
}) {
  const displayName = String(name || "User").trim() || "User";
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
          <h1 className="m-0 text-lg font-semibold leading-tight tracking-tight text-white sm:text-xl">
            Welcome, {displayName}
          </h1>

          {subtitle ? (
            <p className="m-0 mt-1 truncate text-sm text-white/80">{subtitle}</p>
          ) : null}

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
