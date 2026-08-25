import React from "react";

export default function ProfileField({
  label,
  name,
  value,
  onChange,
  required = false,
  error = "",
  helper = "",
  placeholder = "",
  type = "text",
  as = "input",
  options = [],
  rows = 4,
  readOnly = false,
  className = "",
}) {
  const baseClasses = `profile-field-input min-h-[40px] w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition duration-150 ${
    readOnly
      ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500"
      : error
        ? "border-[#D61E1E] focus:border-[#B41818] focus:ring-2 focus:ring-[#D61E1E]/10"
        : "border-[#F8BFBF] focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
  } ${className}`.trim();

  const labelNode = (
    <label htmlFor={name} className="profile-field-label mb-1.5 block text-sm font-semibold text-slate-700">
      {label}
      {required ? <span className="profile-field-required ml-1 text-[#D61E1E]">*</span> : null}
    </label>
  );

  return (
    <div className="profile-field w-full">
      {labelNode}
      {as === "textarea" ? (
        <textarea
          id={name}
          name={name}
          rows={rows}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={readOnly}
          className={`${baseClasses} resize-y`}
        />
      ) : null}

      {as === "select" ? (
        <select
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          disabled={readOnly}
          className={baseClasses}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {as === "input" ? (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={readOnly}
          className={baseClasses}
        />
      ) : null}

      {helper ? <p className="profile-field-helper m-0 mt-2 text-xs text-slate-500">{helper}</p> : null}
      {error ? <p className="profile-field-error m-0 mt-2 text-xs font-semibold text-[#B41818]">{error}</p> : null}
    </div>
  );
}
