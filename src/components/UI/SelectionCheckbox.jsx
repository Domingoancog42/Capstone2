import React, { useEffect, useRef } from "react";

export default function SelectionCheckbox({
  checked = false,
  indeterminate = false,
  onChange,
  label = "Select row",
  disabled = false,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-teal-700 accent-teal-700 focus:ring-2 focus:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
