import React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";

/**
 * The single status banner for every settings screen.
 *
 * Before this, each screen rendered its own bare `<p>` for feedback and picked its own colour —
 * rose in one place, slate in another, emerald in a third — so an error and a success confirmation
 * were visually indistinguishable depending on which tab you were on. One component with an
 * explicit tone means "it worked" and "it failed" always read the same way.
 */
const TONE_STYLE = {
  info: { surface: "border-slate-200 bg-slate-50 text-slate-700", icon: "text-slate-400", Icon: Info },
  success: { surface: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "text-emerald-600", Icon: CheckCircle2 },
  warning: { surface: "border-amber-200 bg-amber-50 text-amber-900", icon: "text-amber-600", Icon: AlertTriangle },
  error: { surface: "border-rose-200 bg-rose-50 text-rose-900", icon: "text-rose-600", Icon: OctagonAlert },
};

export default function SettingsNotice({ children, tone = "info", className = "" }) {
  if (!children) {
    return null;
  }

  const style = TONE_STYLE[tone] || TONE_STYLE.info;
  const Icon = style.Icon;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm font-semibold ${style.surface} ${className}`.trim()}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${style.icon}`} aria-hidden="true" />
      <span className="min-w-0 leading-6">{children}</span>
    </div>
  );
}
