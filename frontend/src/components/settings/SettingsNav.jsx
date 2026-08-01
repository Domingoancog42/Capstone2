import React, { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Search, SlidersHorizontal } from "lucide-react";

const ACTIVE_LAYOUT_ID = "settings-nav-active";

/**
 * The settings navigator: a grouped, filterable list of sections.
 *
 * This replaces a single row of ten pill buttons. At ten items with labels like "Organization
 * Structure" and "System Configuration" that row wrapped onto three lines, gave no sense of which
 * settings belong together, and pushed the actual content below the fold. A vertical rail is what
 * every settings screen of this size uses, and it has room for grouping and a filter.
 *
 * Below `lg` the rail becomes a horizontally scrollable strip, because a full-height vertical list
 * would consume a phone screen before showing any content.
 */
export default function SettingsNav({ groups = [], activeKey, onSelect, query = "", onQueryChange }) {
  const reduceMotion = useReducedMotion();
  const normalizedQuery = query.trim().toLowerCase();

  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) {
      return groups;
    }

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const haystack = `${item.label} ${item.description || ""} ${(item.keywords || []).join(" ")}`;

          return haystack.toLowerCase().includes(normalizedQuery);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, normalizedQuery]);

  const hasResults = visibleGroups.length > 0;

  const renderItem = (item) => {
    const Icon = item.icon;
    const active = item.key === activeKey;

    return (
      <button
        key={item.key}
        type="button"
        onClick={() => onSelect?.(item.key)}
        aria-current={active ? "page" : undefined}
        title={item.description || item.label}
        className={`group relative flex w-full shrink-0 items-center gap-2.5 overflow-hidden rounded-lg px-3 py-2.5 text-left text-sm transition lg:w-full ${
          active ? "font-semibold text-[#D61E1E]" : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        {active ? (
          <motion.span
            layoutId={reduceMotion ? undefined : ACTIVE_LAYOUT_ID}
            className="absolute inset-0 rounded-lg border border-[#D61E1E]/20 bg-[#FEF1F1]"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
        ) : null}
        {Icon ? <Icon size={17} className="relative z-10 shrink-0" aria-hidden="true" /> : null}
        <span className="relative z-10 whitespace-nowrap lg:whitespace-normal">{item.label}</span>
      </button>
    );
  };

  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-4">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange?.(event.target.value)}
            placeholder="Filter settings"
            aria-label="Filter settings sections"
            className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:bg-white focus:ring-2 focus:ring-[#D61E1E]/15"
          />
        </div>

        {hasResults ? (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 lg:block lg:space-y-4 lg:overflow-visible lg:pb-0">
            {visibleGroups.map((group) => (
              <div key={group.label} className="flex shrink-0 gap-1.5 lg:block lg:space-y-0.5">
                <p className="m-0 hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 lg:block">
                  {group.label}
                </p>
                {group.items.map(renderItem)}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 grid place-items-center gap-2 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center">
            <SlidersHorizontal size={20} className="text-slate-300" aria-hidden="true" />
            <p className="m-0 text-sm font-semibold text-slate-600">No settings match “{query}”</p>
            <p className="m-0 text-xs text-slate-400">Try a different word, such as “backup” or “password”.</p>
          </div>
        )}
      </div>
    </nav>
  );
}
