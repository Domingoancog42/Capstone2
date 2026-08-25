import React from "react";

export default function NotificationBadge({ count, className = "", inline = false, tone = "default" }) {
  const safeCount = Math.max(0, Number(count) || 0);

  if (safeCount <= 0) {
    return null;
  }

  const label = safeCount > 99 ? "99+" : String(safeCount);
  const isBellTone = tone === "bell";
  const baseClasses = inline
    ? "pointer-events-none inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums"
    : isBellTone
      ? "pointer-events-none absolute -right-1 -top-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums"
      : "pointer-events-none absolute right-2 top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums";
  const toneClasses = isBellTone
    ? "animate-notification-heartbeat transform-gpu bg-[#D61E1E] text-white shadow-[0_6px_14px_rgba(214,30,30,0.28)] ring-2 ring-white will-change-transform motion-reduce:animate-none"
    : "animate-notification-heartbeat transform-gpu bg-[#F4C430] text-slate-900 shadow-sm ring-2 ring-white will-change-transform motion-reduce:animate-none";

  return (
    <span
      className={`${baseClasses} ${toneClasses} ${className}`.trim()}
    >
      {label}
    </span>
  );
}