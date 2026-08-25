import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatDateDisplay, isWeekendDate, todayDateInputValue } from "../../utils/leaveHelpers";
import {
  DATE_PORTIONS,
  DATE_PORTION_LABELS,
  DATE_PORTION_SHORT_LABELS,
  formatSelectedDatesSummary,
  sanitizeSelectedDates,
} from "../../utils/dateSelection";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toFirstOfMonth(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (parts) {
    return new Date(Number(parts[1]), Number(parts[2]) - 1, 1);
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/*
 * The calendar always shows six full weeks so the grid keeps its height as the month changes and
 * the day-portion list below it does not jump around while dates are being picked.
 */
function buildMonthCells(monthStart) {
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - gridStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      value: toDateInputValue(date),
      dayOfMonth: date.getDate(),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}

/**
 * Picks the individual days a request covers rather than a start-and-end range, so a filing for
 * June 1 and June 5 leaves the days in between untouched. Each picked day is then taken whole, or
 * as a morning or afternoon half.
 *
 * Collapsed to a single field until it is opened, so the form reads as one row of inputs and the
 * calendar only takes over the space while dates are actually being chosen.
 *
 * Leave is counted in working days and so refuses weekends, but compensatory time off and travel
 * orders are routinely filed across them -- those pass `allowWeekends`.
 */
export default function MultiDatePicker({
  value = [],
  minDate = todayDateInputValue(),
  allowWeekends = false,
  placeholder = "Select dates",
  onChange,
}) {
  const selectedDays = useMemo(() => sanitizeSelectedDates(value), [value]);
  const [isOpen, setIsOpen] = useState(false);
  const [monthStart, setMonthStart] = useState(() => toFirstOfMonth(selectedDays[0]?.date || minDate));
  const summary = useMemo(() => formatSelectedDatesSummary(selectedDays), [selectedDays]);

  const selectedPortionByDate = useMemo(
    () => new Map(selectedDays.map((day) => [day.date, day.portion])),
    [selectedDays]
  );
  const monthCells = useMemo(() => buildMonthCells(monthStart), [monthStart]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthStart),
    [monthStart]
  );
  /* Nothing before the earliest selectable day is reachable, so the back arrow stops at its month. */
  const canGoToPreviousMonth = monthStart > toFirstOfMonth(minDate);

  const emitChange = (nextDays) => {
    onChange?.(sanitizeSelectedDates(nextDays));
  };

  const shiftMonth = (offset) => {
    setMonthStart((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const toggleDate = (date) => {
    emitChange(
      selectedPortionByDate.has(date)
        ? selectedDays.filter((day) => day.date !== date)
        : [...selectedDays, { date, portion: "whole" }]
    );
  };

  const changePortion = (date, portion) => {
    emitChange(selectedDays.map((day) => (day.date === date ? { ...day, portion } : day)));
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex min-h-[46px] w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-900 outline-none transition hover:border-slate-300 focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
      >
        <span className={`flex-1 truncate ${summary ? "text-slate-900" : "text-slate-400"}`}>
          {summary || placeholder}
        </span>
        {selectedDays.length > 0 ? (
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
            {selectedDays.length}
          </span>
        ) : null}
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {!isOpen ? null : (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              disabled={!canGoToPreviousMonth}
              aria-label="Previous month"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <p className="m-0 text-sm font-semibold text-slate-800">{monthLabel}</p>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="px-3 py-3">
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {label.slice(0, 1)}
                </span>
              ))}

              {monthCells.map((cell) => {
                const portion = selectedPortionByDate.get(cell.value) || "";
                /* A day already gone cannot be applied for; weekends depend on what is being filed. */
                const isSelectable = cell.isCurrentMonth
                  && cell.value >= minDate
                  && (allowWeekends || !isWeekendDate(cell.value));

                if (!cell.isCurrentMonth) {
                  return <span key={cell.value} aria-hidden="true" className="py-1" />;
                }

                return (
                  <button
                    key={cell.value}
                    type="button"
                    onClick={() => toggleDate(cell.value)}
                    disabled={!isSelectable}
                    aria-pressed={Boolean(portion)}
                    aria-label={`${formatDateDisplay(cell.value)}${portion ? ` selected, ${DATE_PORTION_LABELS[portion]}` : ""}`}
                    className={`relative flex h-10 flex-col items-center justify-center rounded-lg text-sm font-medium transition ${
                      portion
                        ? "bg-teal-700 text-white shadow-sm hover:bg-teal-800"
                        : isSelectable
                          ? "text-slate-700 hover:bg-teal-50"
                          : "cursor-not-allowed text-slate-300"
                    }`}
                  >
                    {cell.dayOfMonth}
                    {portion && portion !== "whole" ? (
                      <span className="text-[9px] font-bold uppercase leading-none">
                        {DATE_PORTION_SHORT_LABELS[portion]}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <p className="m-0 mt-2 text-[11px] text-slate-400">
              Tap a day to add or remove it.
              {allowWeekends ? " Past dates cannot be selected." : " Weekends and past dates cannot be selected."}
            </p>
          </div>

          <div className="border-t border-slate-200 px-3 py-3">
            {selectedDays.length === 0 ? (
              <p className="m-0 flex items-center gap-2 text-xs text-slate-500">
                <CalendarDays size={14} />
                No dates selected yet.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Selected Dates ({selectedDays.length})
                  </p>
                  <button
                    type="button"
                    onClick={() => emitChange([])}
                    className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-rose-700 hover:underline"
                  >
                    Clear all
                  </button>
                </div>

                <ul className="m-0 mt-2 grid list-none gap-2 p-0">
                  {selectedDays.map((day) => (
                    <li
                      key={day.date}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <span className="flex-1 text-sm font-medium text-slate-800">
                        {formatDateDisplay(day.date)}
                      </span>
                      <select
                        value={day.portion}
                        onChange={(event) => changePortion(day.date, event.target.value)}
                        aria-label={`Day portion for ${formatDateDisplay(day.date)}`}
                        className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                      >
                        {DATE_PORTIONS.map((portion) => (
                          <option key={portion} value={portion}>
                            {DATE_PORTION_LABELS[portion]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => toggleDate(day.date)}
                        aria-label={`Remove ${formatDateDisplay(day.date)}`}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="mt-3 inline-flex min-h-9 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
