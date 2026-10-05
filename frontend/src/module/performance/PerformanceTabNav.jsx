import React from "react";
import { motion, useReducedMotion } from "framer-motion";

export default function PerformanceTabNav({
  tabs = [],
  activeTab,
  onChange,
  layoutId,
  ariaLabel = "Sections",
  className = "",
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={`max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 ${className}`.trim()}>
      <div role="tablist" aria-label={ariaLabel} className="flex min-w-max items-center gap-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          const Icon = tab.icon;

          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.key)}
              className={`relative inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 ${
                active ? "text-accent-700 dark:text-accent-300" : "text-slate-500 hover:bg-white/60 hover:text-slate-900"
              }`}
            >
              {active ? (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-700"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 420, damping: 36 }
                  }
                />
              ) : null}
              {Icon ? (
                <span className={`relative z-[1] grid h-6 w-6 place-items-center rounded-md ${
                  active ? "bg-accent-50 text-accent-600 dark:bg-accent-950/60 dark:text-accent-400" : "text-slate-400"
                }`}>
                  <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
                </span>
              ) : null}
              <span className="relative z-[1]">{tab.label}</span>
              {tab.count !== undefined ? (
                <span className={`relative z-[1] rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                  active ? "bg-slate-100 text-slate-700" : "bg-slate-200/70 text-slate-500"
                }`}>
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Keyed on the active tab so switching tabs replays the entrance animation.
// No AnimatePresence: an exit animation would leave the card empty mid-switch
// and collapse its height before the next table mounts.
export function PerformanceTabPanel({ tabKey, children, className = "" }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      key={tabKey}
      role="tabpanel"
      className={className}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
