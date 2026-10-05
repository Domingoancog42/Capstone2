import React, { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

const monthYearFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
/* analytics.php clamps the dashboard year to 1990–2100; nothing earlier can be asked for. */
const MIN_YEAR = 1990;

export function currentDashboardPeriod(today = new Date()) {
  return { year: today.getFullYear(), month: today.getMonth() };
}

export function formatDashboardPeriod({ year, month }) {
  return monthYearFormatter.format(new Date(year, month, 1));
}

/**
 * The dashboard's month filter. `value` is `{ year, month }` with a 0-based month.
 *
 * A native `<input type="month">` would be simpler, but Firefox and Safari on desktop render it
 * as a plain text box, so the picker is drawn here: a year stepper over a grid of months. Months
 * after the current one are disabled — nothing has been filed there yet.
 */
export default function DashboardMonthFilter({ value, onChange, label = "Dashboard month" }) {
  const today = currentDashboardPeriod();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.year);
  const rootRef = useRef(null);
  const panelId = useId();
  const isCurrentPeriod = value.year === today.year && value.month === today.month;

  useEffect(() => {
    if (open) {
      setViewYear(value.year);
    }
  }, [open, value.year]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnOutsidePress = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choose = (period) => {
    onChange(period);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label}: ${formatDashboardPeriod(value)}`}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-10 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
      >
        <CalendarDays size={17} className="text-slate-600" aria-hidden="true" />
        <span>{formatDashboardPeriod(value)}</span>
        <ChevronDown
          size={16}
          className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose a month"
          className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous year"
              disabled={viewYear <= MIN_YEAR}
              onClick={() => setViewYear((year) => year - 1)}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold text-slate-900 tabular-nums">{viewYear}</span>
            <button
              type="button"
              aria-label="Next year"
              disabled={viewYear >= today.year}
              onClick={() => setViewYear((year) => year + 1)}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }, (_, month) => {
              const isFuture = viewYear > today.year || (viewYear === today.year && month > today.month);
              const isSelected = viewYear === value.year && month === value.month;

              return (
                <button
                  key={month}
                  type="button"
                  disabled={isFuture}
                  aria-pressed={isSelected}
                  aria-label={formatDashboardPeriod({ year: viewYear, month })}
                  onClick={() => choose({ year: viewYear, month })}
                  className={`h-9 rounded-lg text-sm font-semibold transition disabled:cursor-not-allowed disabled:text-slate-300 ${
                    isSelected
                      ? "bg-[#D61E1E] text-white"
                      : "text-slate-700 hover:bg-slate-100 disabled:hover:bg-transparent"
                  }`}
                >
                  {shortMonthFormatter.format(new Date(viewYear, month, 1))}
                </button>
              );
            })}
          </div>

          {!isCurrentPeriod ? (
            <button
              type="button"
              onClick={() => choose(today)}
              className="mt-2 w-full rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Back to this month
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
