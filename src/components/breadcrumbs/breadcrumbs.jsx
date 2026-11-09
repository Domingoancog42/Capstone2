import React from "react";
import { ChevronRight, Home } from "lucide-react";

export default function Breadcrumbs({
  items = [],
  onNavigate,
  className = "",
}) {
  const visibleItems = items.filter((item) => item?.label);

  // A lone crumb is the landing page itself (the dashboards pass just "Dashboard"), so there is
  // no trail to show. Only render once there is somewhere to navigate back to.
  if (visibleItems.length < 2) {
    return null;
  }

  /*
   * The trail follows the system theme colour chosen in Settings, the way the sidebar does: parent
   * crumbs are a light tint of it and the selected module is the one solid crumb. The colours live
   * in tailwind.css (`.breadcrumb-crumb`) because they come from the --ui-accent variables.
   */
  return (
    <nav
      aria-label="Breadcrumb"
      className={`overflow-x-auto ${className}`.trim()}
    >
      <ol className="inline-flex min-h-14 max-w-full items-center gap-3 px-1 py-3">
        {visibleItems.map((item, index) => {
          const isFirst = index === 0;
          const isLast = index === visibleItems.length - 1;
          const canNavigate = Boolean(item.path && onNavigate && !isLast);

          const cardClassName = [
            "breadcrumb-crumb group relative inline-flex h-11 max-w-[220px] shrink-0 items-center gap-2.5 overflow-hidden truncate rounded-2xl border px-4 text-sm font-semibold leading-none backdrop-blur-md transition-all duration-300",
            isLast ? "breadcrumb-crumb--current" : "",
            canNavigate
              ? "cursor-pointer hover:scale-[1.02] hover:-translate-y-1 active:scale-100 active:translate-y-0"
              : "",
          ].filter(Boolean).join(" ");

          const content = (
            <>
              {/* Glass reflection effect overlay */}
              <span className={`breadcrumb-crumb__gloss absolute inset-0 bg-gradient-to-br via-transparent to-transparent ${
                isLast ? "from-white/10 opacity-40" : "from-white/60 opacity-70"
              }`} />

              {/* Icon */}
              {isFirst ? (
                <Home
                  size={16}
                  className={`breadcrumb-crumb__icon relative z-10 shrink-0 transition-all duration-300 ${canNavigate ? "group-hover:scale-110 group-hover:-rotate-3" : ""}`}
                />
              ) : null}
              
              {/* Label */}
              <span className="relative z-10 truncate">{item.label}</span>
              
              {/* Bottom glow effect for active item */}
              {isLast && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-current to-transparent opacity-60" />
              )}
            </>
          );

          return (
            <React.Fragment key={`${item.label}-${index}`}>
              {index > 0 ? (
                <li aria-hidden="true" className="flex shrink-0 items-center">
                  <ChevronRight
                    size={16}
                    className="breadcrumb-separator transition-all duration-300"
                  />
                </li>
              ) : null}
              <li className="flex shrink-0 items-center">
                {canNavigate ? (
                  <button
                    type="button"
                    onClick={() => onNavigate(item.path)}
                    className={cardClassName}
                  >
                    {content}
                  </button>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={cardClassName}
                    title={item.label}
                  >
                    {content}
                  </span>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
