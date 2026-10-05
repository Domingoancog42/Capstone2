import React, { useEffect, useRef, useState } from "react";

const CUSTOM_OPTION = "__custom__";

const fieldShellClass = "relative flex min-h-[40px] items-center rounded-lg border border-slate-200 bg-white";
const controlClass = "w-full rounded-lg bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-accent-500/15";

/*
 * The category a KPI prints under. The office's usual headings are offered as a list, but the
 * category is stored as text, so "Type a custom category" swaps in a text box for one that is not
 * listed; picking a listed heading again goes back to it. A value that is not on the list -- an
 * older wording, or one typed earlier -- opens as custom so it is kept rather than blanked.
 */
export default function KpiCategoryField({
  id,
  name,
  value,
  options,
  onChange,
  optional = false,
  required = false,
  maxLength,
  helper,
  disabled = false,
}) {
  const valueIsListed = options.includes(value);
  const [customMode, setCustomMode] = useState(() => Boolean(value) && !valueIsListed);
  const customInputRef = useRef(null);
  const focusCustomInput = useRef(false);
  const isCustom = customMode || (Boolean(value) && !valueIsListed);

  useEffect(() => {
    if (isCustom && focusCustomInput.current) {
      focusCustomInput.current = false;
      customInputRef.current?.focus();
    }
  }, [isCustom]);

  const handleSelect = (event) => {
    const selected = event.target.value;

    if (selected === CUSTOM_OPTION) {
      focusCustomInput.current = true;
      setCustomMode(true);
      onChange("");
      return;
    }

    setCustomMode(false);
    onChange(selected);
  };

  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
        Category {optional ? <span className="font-normal text-slate-500">(Optional)</span> : null}
      </label>
      <div className={fieldShellClass}>
        <select
          id={id}
          name={name}
          value={isCustom ? CUSTOM_OPTION : value}
          onChange={handleSelect}
          className={controlClass}
          required={required && !isCustom}
          disabled={disabled}
        >
          <option value="">Select category</option>
          {options.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
          <option value={CUSTOM_OPTION}>Type a custom category...</option>
        </select>
      </div>
      {isCustom ? (
        <div className={`${fieldShellClass} mt-2`}>
          <input
            ref={customInputRef}
            id={`${id}-custom`}
            name={`${name}-custom`}
            aria-label="Custom category"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Type the category heading"
            maxLength={maxLength}
            className={`${controlClass} placeholder:text-slate-400`}
            required={required}
            disabled={disabled}
          />
        </div>
      ) : null}
      {helper ? <p className="m-0 mt-1.5 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}
