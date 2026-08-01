import React from "react";
import { Loader2 } from "lucide-react";
import { AUTH_FOCUS_RING, cx } from "./authTheme";

const VARIANT_CLASS = {
  primary:
    "border-transparent bg-[#D61E1E] text-white shadow-lg shadow-[#D61E1E]/25 hover:bg-[#B41818] hover:shadow-xl hover:shadow-[#D61E1E]/30 active:scale-[0.99]",
  secondary:
    "border-slate-200 bg-white text-slate-700 shadow-sm hover:border-[#F8BFBF] hover:bg-[#FEF1F1] hover:text-[#D61E1E]",
  ghost: "border-transparent bg-transparent text-slate-500 hover:text-[#D61E1E]",
};

const SIZE_CLASS = {
  md: "min-h-[48px] gap-2 px-5 text-sm",
  sm: "min-h-[40px] gap-1.5 px-4 text-xs",
};

/**
 * The single button used across every auth screen.
 *
 * `loading` both disables the control and swaps the leading icon for a spinner, so callers never
 * have to hand-roll the "Signing in..." / "Verifying..." dance.
 */
export default function AuthButton({
  children,
  className = "",
  disabled = false,
  fullWidth = true,
  icon: Icon,
  loading = false,
  loadingLabel,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-xl border font-bold leading-none transition duration-200 disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none motion-reduce:transition-none motion-reduce:active:scale-100",
        VARIANT_CLASS[variant] || VARIANT_CLASS.primary,
        SIZE_CLASS[size] || SIZE_CLASS.md,
        fullWidth ? "w-full" : "",
        AUTH_FOCUS_RING,
        className,
      )}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="animate-spin" size={size === "sm" ? 15 : 17} />
      ) : Icon ? (
        <Icon aria-hidden="true" size={size === "sm" ? 15 : 17} />
      ) : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}
