import React from "react";

export default function InputField({
  id,
  label,
  error,
  icon: Icon,
  className = "",
  inputClassName = "",
  ...props
}) {
  const inputId = id || props.name;

  return (
    <div className={`w-full ${className}`.trim()}>
      {label ? (
        <label htmlFor={inputId} className="mb-2 block text-sm font-semibold text-slate-700">
          {label}
        </label>
      ) : null}
      <div
        className={`relative flex min-h-[46px] items-center rounded-lg border bg-white ${
          error ? "border-rose-600" : "border-slate-200"
        }`}
      >
        {Icon ? (
          <Icon className="pointer-events-none absolute left-3.5 text-slate-400" size={18} />
        ) : null}
        <input
          id={inputId}
          className={`w-full rounded-lg bg-transparent px-3.5 py-3 text-slate-900 outline-none placeholder:text-slate-400 ${
            Icon ? "pl-10" : ""
          } ${inputClassName}`.trim()}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
