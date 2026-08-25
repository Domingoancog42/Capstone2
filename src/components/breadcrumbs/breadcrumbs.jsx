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

  // Gradient colors for glass morphism progression
  const getGlassStyles = (index, total, isLast) => {
    const position = total > 1 ? index / (total - 1) : 0;
    
    if (position <= 0.5) {
      // Blue to Cyan gradient
      return {
        gradient: "from-blue-500/20 via-blue-400/15 to-cyan-500/20",
        border: "border-blue-300/40",
        shadow: isLast ? "shadow-lg shadow-blue-200/50" : "shadow-md shadow-blue-100/30",
        hoverShadow: "hover:shadow-xl hover:shadow-blue-300/40",
        text: isLast ? "text-blue-950" : "text-blue-700",
        hoverText: "hover:text-blue-800",
        icon: "text-blue-600",
        hoverIcon: "group-hover:text-blue-700",
        ring: "ring-blue-400/30",
      };
    } else {
      // Cyan to Teal gradient
      return {
        gradient: "from-cyan-500/20 via-teal-400/15 to-teal-500/20",
        border: "border-teal-300/40",
        shadow: isLast ? "shadow-lg shadow-teal-200/50" : "shadow-md shadow-teal-100/30",
        hoverShadow: "hover:shadow-xl hover:shadow-teal-300/40",
        text: isLast ? "text-teal-950" : "text-teal-700",
        hoverText: "hover:text-teal-800",
        icon: "text-teal-600",
        hoverIcon: "group-hover:text-teal-700",
        ring: "ring-teal-400/30",
      };
    }
  };

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
          const styles = getGlassStyles(index, visibleItems.length, isLast);
          
          const cardClassName = [
            "group relative inline-flex h-11 max-w-[220px] shrink-0 items-center gap-2.5 overflow-hidden truncate rounded-2xl border px-4 text-sm font-semibold leading-none backdrop-blur-md transition-all duration-300",
            "bg-gradient-to-br",
            styles.gradient,
            styles.border,
            styles.shadow,
            styles.text,
            canNavigate 
              ? `cursor-pointer ${styles.hoverShadow} ${styles.hoverText} hover:scale-[1.02] hover:-translate-y-1 active:scale-100 active:translate-y-0` 
              : "",
            isLast 
              ? `ring-2 ring-offset-2 ${styles.ring}` 
              : "",
          ].filter(Boolean).join(" ");

          const content = (
            <>
              {/* Glass reflection effect overlay */}
              <span className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent opacity-50" />
              
              {/* Icon */}
              {isFirst ? (
                <Home 
                  size={16} 
                  className={`relative z-10 shrink-0 transition-all duration-300 ${styles.icon} ${canNavigate ? `${styles.hoverIcon} group-hover:scale-110 group-hover:-rotate-3` : ''}`} 
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
                    className="text-slate-400/60 transition-all duration-300" 
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
