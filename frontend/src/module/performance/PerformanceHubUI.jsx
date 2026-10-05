import React from "react";
import { LoaderCircle, Search } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { performanceBand } from "./RatingSummaryCells";

/*
 * The "Performance Hub" look shared by the OPCR and IPCR workspaces: the selected color preference
 * as the accent over slate neutrals, rounded-xl surfaces, small uppercase labels and outline badges
 * with a status dot.
 *
 * The accent is the `accent` Tailwind scale (tailwind.config.js), which applyUiThemeColor() repaints
 * whenever the preference changes, so these screens always match the rest of the system. Status
 * badges keep their own meaning-based colors.
 */

const buttonVariants = {
  primary:
    "border-accent-600 bg-accent-600 text-white shadow-sm hover:border-accent-700 hover:bg-accent-700 focus-visible:ring-accent-500/30",
  outline:
    "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-300 dark:border-slate-700 dark:text-slate-200",
  ghost:
    "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-300 dark:text-slate-300",
  soft:
    "border-accent-200 bg-accent-50 text-accent-700 hover:border-accent-300 hover:bg-accent-100 focus-visible:ring-accent-500/30 dark:border-accent-800 dark:bg-accent-950/50 dark:text-accent-300",
};

const buttonSizes = {
  sm: "min-h-8 gap-1.5 px-2.5 text-xs",
  md: "min-h-9 gap-2 px-3.5 text-sm",
};

function isFontAwesomeIcon(icon) {
  return Array.isArray(icon) || (icon && typeof icon === "object" && icon.prefix && icon.iconName);
}

function HubIcon({ icon, size = 15, className = "" }) {
  if (!icon) return null;
  if (isFontAwesomeIcon(icon)) {
    return <FontAwesomeIcon icon={icon} className={`text-[13px] ${className}`.trim()} aria-hidden="true" />;
  }
  const Icon = icon;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/** A button in the hub palette. `loading` swaps the icon for a spinner and disables the button. */
export function HubButton({
  children,
  type = "button",
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className = "",
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border font-semibold leading-none transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        buttonVariants[variant] || buttonVariants.primary
      } ${buttonSizes[size] || buttonSizes.md} ${className}`.trim()}
      {...props}
    >
      {loading ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <HubIcon icon={icon} />}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

/* Status tones, keyed by what a form's status means rather than its exact wording. */
const statusTones = {
  draft: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300",
  info: "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300",
  warning: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  // Green whatever the color preference: "rated" and "approved" must not read like an error in crimson.
  success: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  danger: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
};

export function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (/return|reject/.test(normalized)) return "danger";
  if (/partial/.test(normalized)) return "warning";
  if (/rated|reviewed|approved|finalized|validated/.test(normalized)) return "success";
  if (/review|pending/.test(normalized)) return "warning";
  if (/submitted/.test(normalized)) return "info";
  return "draft";
}

/** An outline badge with a status dot. The text is the status as stored, so searches still match it. */
export function StatusBadge({ status, fallback = "Assigned" }) {
  const label = String(status ?? "").trim() || fallback;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${
        statusTones[statusTone(label)]
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * A rating as a pill: the score in a small disc, then its adjectival band. Unrated shows a dashed
 * ring and "Not rated", the way the printed form leaves the cell empty.
 */
export function RatingPill({ value, size = "md", showLabel = true }) {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">
        <span className="h-5 w-5 rounded-full border border-dashed border-slate-300" aria-hidden="true" />
        Not rated
      </span>
    );
  }

  const band = performanceBand(score);
  return (
    <span
      title={band.label}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold ${band.scoreClassName} ${
        size === "sm" ? "py-0.5 pl-0.5 pr-2 text-[11px]" : "py-1 pl-1 pr-2.5 text-xs"
      }`}
    >
      <span
        className={`grid place-items-center rounded-full bg-[rgba(255,255,255,0.85)] font-bold tabular-nums ${
          size === "sm" ? "h-5 min-w-[1.25rem] px-1 text-[10px]" : "h-6 min-w-[1.5rem] px-1.5 text-[11px]"
        }`}
      >
        {score.toFixed(2)}
      </span>
      {showLabel ? band.label : null}
    </span>
  );
}

/** The row's identifying cell: an icon or initials tile, a bold name and a muted line under it. */
export function EntityCell({ icon: Icon, initials, title, meta }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-xs font-bold text-accent-700 dark:bg-accent-950/60 dark:text-accent-300">
        {Icon ? <Icon size={17} aria-hidden="true" /> : initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        {meta ? <span className="mt-0.5 block truncate text-xs text-slate-500">{meta}</span> : null}
      </span>
    </span>
  );
}

/** A small outline chip, used for periods and other short facts beside a title. */
export function MetaChip({ icon, children }) {
  return (
    <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
      <HubIcon icon={icon} size={12} className="text-slate-400" />
      {children}
    </span>
  );
}

export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/** A search box with the icon inside it. The label is visually hidden but still names the field. */
export function HubSearch({ label, value, onChange, placeholder, name, className = "" }) {
  return (
    <label className={`relative block min-w-0 ${className}`.trim()}>
      <span className="sr-only">{label}</span>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        type="search"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
      />
    </label>
  );
}

/** A compact select whose label sits above it in small caps. */
export function HubSelect({ label, value, onChange, children, className = "" }) {
  return (
    <label className={`block min-w-0 ${className}`.trim()}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={onChange}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
      >
        {children}
      </select>
    </label>
  );
}

/**
 * Toggle pills that narrow a list to one status, each carrying its count: "All (12)", "Rated (4)".
 * They are toggle buttons (`aria-pressed`), not tabs, because the tabs above already pick the view.
 */
export function FilterPills({ options = [], value, onChange, ariaLabel = "Filter by status" }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 ${
              active
                ? "border-accent-600 bg-accent-600 text-white shadow-sm hover:bg-accent-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            }`}
          >
            {option.label}
            <span
              className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
                active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"
              }`}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same status filter as a dropdown, each option carrying its count: "All (12)", "Rated (4)".
 * Takes FilterPills' props, so a register can swap one for the other.
 */
export function StatusFilterSelect({ options = [], value, onChange, label = "Status", className = "" }) {
  return (
    <HubSelect label={label} value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {`${option.label} (${option.count ?? 0})`}
        </option>
      ))}
    </HubSelect>
  );
}

/** The dashed empty state the hub uses in place of a bare "no records" line. */
export function HubEmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
      {Icon ? (
        <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">
          <Icon size={22} aria-hidden="true" />
        </span>
      ) : null}
      <div>
        <p className="m-0 text-sm font-semibold text-slate-700">{title}</p>
        {description ? <p className="m-0 mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
    </div>
  );
}

const legendBands = [
  [5, "Outstanding"],
  [4, "Very Satisfactory"],
  [3, "Satisfactory"],
  [2, "Unsatisfactory"],
  [1, "Poor"],
];

/** The 1-5 scale as a row of coloured pills, for reading a rating pill at a glance. */
export function RatingLegend({ className = "" }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
      {legendBands.map(([score, label]) => (
        <span
          key={score}
          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] font-medium ${performanceBand(score).scoreClassName}`}
        >
          <span className="grid h-4 w-4 place-items-center rounded-full bg-[rgba(255,255,255,0.85)] text-[9px] font-bold">{score}</span>
          {label}
        </span>
      ))}
    </div>
  );
}

/** "How the workflow works": numbered steps, then the rating scale they end in. */
export function WorkflowGuide({ title, steps = [] }) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-dashed border-slate-300 bg-white p-4 sm:p-5 dark:border-slate-700"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
        <RatingLegend />
      </div>
      <ol className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-sm font-bold text-accent-700 dark:bg-accent-950 dark:text-accent-300">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-medium text-slate-900">{step.title}</p>
              <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One-tap whole scores under a rating input. The input still takes decimals such as 4.50; these
 * only fill it, so what is saved is always what the input shows.
 */
export function RatingQuickPick({ criterion, value, onPick, disabled = false, className = "mt-1.5" }) {
  const current = Number(value);
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
      {[1, 2, 3, 4, 5].map((score) => {
        const active = current === score;
        return (
          <button
            key={score}
            type="button"
            disabled={disabled}
            aria-label={`Set ${criterion} to ${score}`}
            aria-pressed={active}
            onClick={() => onPick(String(score))}
            className={`grid h-7 min-w-[1.75rem] place-items-center rounded-md border px-1.5 text-xs font-bold tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 disabled:opacity-60 ${
              active
                ? performanceBand(score).scoreClassName
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:border-slate-700"
            }`}
          >
            {score}
          </button>
        );
      })}
    </div>
  );
}

/** A labelled panel inside a dialog: icon + heading row, then its body. */
export function HubPanel({ icon: Icon, title, description, aside, children, className = "" }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 ${className}`.trim()}>
      {title ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900">
              {Icon ? <Icon size={16} className="shrink-0 text-accent-600" aria-hidden="true" /> : null}
              {title}
            </p>
            {description ? <p className="m-0 mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** The small uppercase caption used above a value in the dialogs. */
export function FieldCaption({ children, className = "" }) {
  return (
    <p className={`m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${className}`.trim()}>
      {children}
    </p>
  );
}

/** Class list for the hub's text areas and plain inputs, so focus reads in the accent everywhere. */
export const hubFieldClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15 disabled:bg-slate-50";

export const hubSelectClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15";
