import React from "react";

// Preserve minute precision while offering only the authorized 5 PM–9 PM window.
const TIME_OPTIONS = Array.from({ length: 241 }, (_, offset) => {
  const minutes = 17 * 60 + offset;
  const hour = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, "0");
  return { value: `${hour}:${minute}`, label: `${hour - 12}:${minute} PM` };
});

export function isAllowedOvertimeTime(value) {
  return TIME_OPTIONS.some((option) => option.value === value);
}

export default function OvertimeTimeSelect({ label, name, value, onChange }) {
  return (
    <div data-validation-field>
      <label htmlFor={name} className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</label>
      <select
        id={name}
        name={name}
        value={isAllowedOvertimeTime(value) ? value : ""}
        onChange={onChange}
        required
        className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-blue-600"
      >
        <option value="" disabled>Select time</option>
        {TIME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}
