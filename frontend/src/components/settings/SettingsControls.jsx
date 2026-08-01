import React from "react";

/**
 * The form controls settings screens need that the shared UI kit does not cover.
 *
 * Each of these existed two or three times over as inline Tailwind — the select box className was
 * copy-pasted verbatim in six places, and there were two unrelated hand-built toggle switches that
 * looked and behaved differently. Anything reused across settings sections belongs here so a change
 * to one is a change to all.
 */

const CONTROL_BASE =
  "min-h-[42px] w-full rounded-lg border bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

function borderClass(error) {
  return error ? "border-rose-400" : "border-slate-300";
}

function FieldShell({ id, label, helper, error, children, className = "" }) {
  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
          {label}
        </label>
      ) : null}
      {children}
      {helper && !error ? <p className="m-0 mt-1.5 text-xs leading-5 text-slate-500">{helper}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="m-0 mt-1.5 text-xs font-semibold text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsSelect({
  id,
  name,
  label,
  helper,
  error,
  value,
  onChange,
  options = [],
  placeholder,
  disabled,
  className = "",
}) {
  const controlId = id || name;

  return (
    <FieldShell id={controlId} label={label} helper={helper} error={error} className={className}>
      <select
        id={controlId}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${controlId}-error` : undefined}
        className={`${CONTROL_BASE} ${borderClass(error)} font-semibold`}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => {
          const optionValue = typeof option === "object" ? option.value : option;
          const optionLabel = typeof option === "object" ? option.label : option;

          return (
            <option key={optionValue} value={optionValue} disabled={option?.disabled}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </FieldShell>
  );
}

/** A number input with a trailing unit, e.g. `%`, `minutes`, `attempts`. */
export function SettingsNumberField({
  id,
  name,
  label,
  helper,
  error,
  invalid,
  suffix,
  value,
  onChange,
  disabled,
  className = "",
  ...inputProps
}) {
  const controlId = id || name;
  // `invalid` marks the control red without printing a message, for when the surrounding row
  // already shows the error text and repeating it would just be noise.
  const showsError = Boolean(error || invalid);

  return (
    <FieldShell id={controlId} label={label} helper={helper} error={error} className={className}>
      <div
        className={`flex min-h-[42px] items-center rounded-lg border bg-white transition focus-within:border-[#D61E1E] focus-within:ring-2 focus-within:ring-[#D61E1E]/15 ${borderClass(showsError)} ${
          disabled ? "bg-slate-50" : ""
        }`}
      >
        <input
          id={controlId}
          name={name}
          type="number"
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={showsError}
          aria-describedby={error ? `${controlId}-error` : undefined}
          className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none disabled:cursor-not-allowed disabled:text-slate-500"
          {...inputProps}
        />
        {suffix ? (
          <span className="shrink-0 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{suffix}</span>
        ) : null}
      </div>
    </FieldShell>
  );
}

/** The one toggle switch for settings. Replaces the two divergent hand-built switches. */
export function SettingsToggle({ checked, disabled, label, onChange, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/25 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "border-[#D61E1E] bg-[#D61E1E]" : "border-slate-300 bg-slate-200"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * A labelled row with a control on the right — the workhorse layout for settings. Used for toggles,
 * number inputs, and selects alike, so every setting on the page lines up on the same grid.
 */
export function SettingsRow({ icon: Icon, label, description, error, control, htmlFor, className = "" }) {
  return (
    <div
      className={`grid gap-3 rounded-lg border bg-white px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 ${
        error ? "border-rose-300" : "border-slate-200"
      } ${className}`.trim()}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
            <Icon size={17} aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <label htmlFor={htmlFor} className="m-0 block text-sm font-semibold text-slate-900">
            {label}
          </label>
          {description ? <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
          {error ? <p className="m-0 mt-1.5 text-xs font-semibold text-rose-700">{error}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-start sm:justify-end">{control}</div>
    </div>
  );
}

/** A toggle presented as a `SettingsRow`. */
export function SettingsToggleRow({ checked, description, disabled, icon, label, onToggle, id }) {
  return (
    <SettingsRow
      icon={icon}
      label={label}
      description={description}
      htmlFor={id}
      control={<SettingsToggle id={id} checked={checked} disabled={disabled} label={label} onChange={onToggle} />}
    />
  );
}

/** A checkbox with a label, for multi-select groups such as the work week. */
export function SettingsCheckbox({ checked, disabled, label, onChange, name }) {
  return (
    <label
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${checked ? "border-[#D61E1E]/40 bg-[#FEF1F1] text-[#D61E1E]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
    >
      <input
        type="checkbox"
        name={name}
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={onChange}
        className="h-4 w-4 rounded border-slate-300 text-[#D61E1E] focus:ring-[#D61E1E]/25"
      />
      <span>{label}</span>
    </label>
  );
}
