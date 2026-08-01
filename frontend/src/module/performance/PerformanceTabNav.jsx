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
    <div className={`-mx-1 overflow-x-auto px-1 pt-1 ${className}`.trim()}>
      <div role="tablist" aria-label={ariaLabel} className="flex min-w-max items-center gap-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.key)}
              className={`relative inline-flex min-h-11 items-center rounded-t-lg px-4 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D61E1E]/25 ${
                active ? "text-[#D61E1E]" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {active ? (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#D61E1E]"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 420, damping: 36 }
                  }
                />
              ) : null}
              <span>{tab.label}</span>
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
