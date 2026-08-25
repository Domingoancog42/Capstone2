import React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cx } from "./authTheme";

const TONE = {
  error: {
    className: "border-rose-200 bg-rose-50 text-rose-700",
    icon: AlertCircle,
    role: "alert",
  },
  success: {
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CheckCircle2,
    role: "status",
  },
  info: {
    className: "border-sky-200 bg-sky-50 text-sky-800",
    icon: Info,
    role: "status",
  },
};

/**
 * Inline feedback banner. Replaces the four near-identical error/success blocks the auth screens
 * each used to declare, and guarantees the right ARIA role for the tone so screen readers announce
 * failures immediately and confirmations politely.
 */
export default function AuthAlert({ children, className = "", tone = "error" }) {
  if (!children) {
    return null;
  }

  const { className: toneClass, icon: Icon, role } = TONE[tone] || TONE.error;

  return (
    <div
      className={cx(
        "flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold leading-5",
        toneClass,
        className,
      )}
      role={role}
    >
      <Icon aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
      <span>{children}</span>
    </div>
  );
}
