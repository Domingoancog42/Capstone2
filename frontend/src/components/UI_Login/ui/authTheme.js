/**
 * Design tokens for the authentication screens (sign in, forgot password, two-factor
 * verification, forced password change).
 *
 * Every brand colour, control class, and agency string used by those screens lives here so a
 * rebrand or a spacing tweak is a one-file change instead of a search-and-replace across four
 * components. The class strings are written out literally so Tailwind's scanner still sees them.
 */

/** Agency red. Kept as literals in the class strings below because Tailwind cannot read variables. */
export const AUTH_BRAND = {
  primary: "#D61E1E",
  primaryHover: "#B41818",
  primarySoft: "#FEF1F1",
  primarySoftBorder: "#F8BFBF",
};

const publicUrl = process.env.PUBLIC_URL || "";

export const AUTH_LOGO_SRC = `${publicUrl}/mgb.png`;
export const AUTH_SEAL_SRC = `${publicUrl}/bagongpilipinas.png`;
export const AUTH_BACKGROUND_SRC = `${publicUrl}/background.jpg`;

export const AUTH_REPUBLIC = "Republic of the Philippines";
export const AUTH_DEPARTMENT = "Department of Environment and Natural Resources";
export const AUTH_ORGANIZATION = "Mines and Geosciences Bureau";
export const AUTH_SYSTEM_NAME = "Human Resources Information System";
export const AUTH_OFFICE_ADDRESS = "Region X, Macabalan, Cagayan de Oro City";

/** Focus treatment shared by every interactive control so keyboard users get one consistent ring. */
export const AUTH_FOCUS_RING =
  "focus:outline-none focus-visible:ring-4 focus-visible:ring-[#D61E1E]/25 focus-visible:ring-offset-0";

/** Small uppercase caption above a heading. */
export const AUTH_EYEBROW_CLASS =
  "m-0 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500";

export const AUTH_LABEL_CLASS =
  "mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600";

export const AUTH_HELP_TEXT_CLASS = "m-0 mt-1.5 text-[11px] font-semibold text-slate-500";

/** Text inputs: shared box model, with the border/ring supplied by AUTH_CONTROL_TONE_CLASS. */
export const AUTH_CONTROL_BASE_CLASS =
  "min-h-[46px] w-full rounded-xl border px-4 text-sm font-semibold text-slate-900 shadow-sm transition placeholder:font-medium placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export const AUTH_CONTROL_TONE_CLASS = {
  idle: "border-slate-300 bg-white focus:border-[#D61E1E] focus:ring-4 focus:ring-[#D61E1E]/15",
  error: "border-rose-400 bg-rose-50/70 focus:border-rose-500 focus:ring-4 focus:ring-rose-100",
  success: "border-emerald-400 bg-emerald-50/70 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100",
};

/** Strength palette shared by the password checklist and its progress bar. */
export const AUTH_STRENGTH_TONE = {
  idle: {
    panel: "border-slate-200 bg-slate-50",
    badge: "bg-slate-200 text-slate-600",
    bar: "bg-slate-300",
    text: "text-slate-600",
    icon: "bg-slate-200 text-slate-600",
  },
  weak: {
    panel: "border-rose-200 bg-rose-50",
    badge: "bg-rose-100 text-rose-700",
    bar: "bg-rose-500",
    text: "text-rose-800",
    icon: "bg-rose-100 text-rose-700",
  },
  medium: {
    panel: "border-amber-200 bg-amber-50",
    badge: "bg-amber-100 text-amber-700",
    bar: "bg-amber-500",
    text: "text-amber-800",
    icon: "bg-amber-100 text-amber-700",
  },
  strong: {
    panel: "border-emerald-200 bg-emerald-50",
    badge: "bg-emerald-100 text-emerald-700",
    bar: "bg-emerald-500",
    text: "text-emerald-800",
    icon: "bg-emerald-100 text-emerald-700",
  },
};

/** Resolves the tone for a `evaluatePasswordPolicy()` result, treating an empty box as idle. */
export function getStrengthTone(strength, hasInput = true) {
  if (!hasInput) {
    return AUTH_STRENGTH_TONE.idle;
  }

  return AUTH_STRENGTH_TONE[strength] || AUTH_STRENGTH_TONE.medium;
}

/** Joins class names, dropping falsy entries so callers can inline conditionals. */
export function cx(...values) {
  return values.filter(Boolean).join(" ");
}
