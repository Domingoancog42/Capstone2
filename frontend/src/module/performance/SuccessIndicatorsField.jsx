import React from "react";
import { Plus, X } from "lucide-react";
import Button from "../../components/UI/button";
import { splitSuccessIndicators } from "./successIndicators";

/**
 * The success-indicator rows of one KPI on the IPCR and OPCR forms.
 *
 * `value` is the stored newline-joined string (see successIndicators.js) and `onChange` receives
 * the next one, so the surrounding form keeps its single `successIndicator` field. Blank rows are
 * kept while editing so a freshly added row has somewhere to type; the form drops them on save.
 */
export default function SuccessIndicatorsField({
  id,
  value,
  onChange,
  disabled = false,
  label = "Success Indicator",
  placeholder = "Define a measurable success indicator",
  rows = 2,
}) {
  const lines = String(value ?? "").split(/\r?\n/);
  const emit = (nextLines) => onChange?.(nextLines.join("\n"));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={`${id}-0`} className="block text-sm font-semibold text-slate-700">
          {label}
        </label>
        <span className="text-xs font-medium text-slate-500">
          {lines.length > 1 ? `${lines.length} indicators` : null}
        </span>
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => (
          // Rows have no identity beyond their position, so the index is the key on purpose.
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} className="flex items-start gap-2">
            <span className="mt-2.5 w-5 shrink-0 text-right text-xs font-bold text-slate-400">{index + 1}.</span>
            <textarea
              id={`${id}-${index}`}
              aria-label={`${label} ${index + 1}`}
              value={line}
              onChange={(event) => emit(lines.map((current, at) => (at === index ? event.target.value : current)))}
              placeholder={placeholder}
              rows={rows}
              disabled={disabled}
              required={index === 0}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
            />
            {lines.length > 1 ? (
              <button
                type="button"
                onClick={() => emit(lines.filter((_, at) => at !== index))}
                disabled={disabled}
                aria-label={`Remove success indicator ${index + 1}`}
                title="Remove"
                className="mt-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => emit([...lines, ""])}
          disabled={disabled}
        >
          Add Success Indicator
        </Button>
      </div>
    </div>
  );
}

/** Indicators as they read on a table or the printed form: one plain line, or a numbered list. */
export function SuccessIndicatorList({ value, fallback = "N/A", className = "" }) {
  const items = splitSuccessIndicators(value);

  if (items.length === 0) {
    return <span className={className}>{fallback}</span>;
  }

  if (items.length === 1) {
    return <span className={className}>{items[0]}</span>;
  }

  return (
    <ol className={`m-0 list-decimal space-y-1 pl-4 ${className}`.trim()}>
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}
