import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";

/**
 * Sticky tab bar for the profile page.
 *
 * The left rail scrolls horizontally through the tabs and marks the one whose panel is mounted; the
 * right rail pins the panels that open as floating cards, so they stay reachable without claiming a
 * tab of their own.
 */
export default function ProfileSectionNav({
  sections = [],
  activeSection,
  onSelect,
  actions = [],
  className = "",
}) {
  const tabRefs = useRef({});

  useEffect(() => {
    tabRefs.current[activeSection]?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeSection]);

  return (
    <div
      className={`profile-section-nav sticky top-[3.75rem] z-30 min-w-0 max-w-full rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur sm:p-2 lg:top-20 ${className}`.trim()}
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="profile-section-nav-rail min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
          <div className="flex min-w-max flex-nowrap gap-1" role="tablist" aria-label="Profile sections">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeSection;

              return (
                <button
                  key={section.id}
                  ref={(node) => {
                    if (node) {
                      tabRefs.current[section.id] = node;
                    } else {
                      delete tabRefs.current[section.id];
                    }
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-active={isActive}
                  onClick={() => onSelect?.(section.id)}
                  className={`profile-section-nav-item relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition sm:gap-2 sm:px-3 ${
                    isActive ? "text-[#D61E1E]" : "text-slate-500 hover:text-[#B41818]"
                  }`}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="profile-section-indicator"
                      className="profile-section-indicator absolute inset-0 rounded-lg border border-[#F8BFBF] bg-[#FEF1F1]"
                      transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    />
                  ) : null}
                  {Icon ? <Icon size={16} className="relative z-10 shrink-0" aria-hidden="true" /> : null}
                  <span className="relative z-10 whitespace-nowrap">{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {actions.length > 0 ? (
          <div className="profile-section-nav-actions flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-2 xl:border-l xl:border-t-0 xl:pl-2 xl:pt-0">
            {actions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className="profile-section-nav-action inline-flex items-center gap-2 rounded-lg border border-[#F8BFBF] bg-white px-3 py-2 text-xs font-semibold text-[#D61E1E] shadow-sm transition hover:border-[#F18E8E] hover:bg-[#FEF1F1] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
                >
                  {Icon ? <Icon size={16} className="shrink-0" aria-hidden="true" /> : null}
                  <span className="whitespace-nowrap">{action.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
