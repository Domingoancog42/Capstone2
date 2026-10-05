import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatDateDisplay, isPastDate, isWeekendDate, todayDateInputValue } from "../../utils/leaveHelpers";
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

function buildInclusiveDateRange(startDate, endDate, allowWeekends) {
  const firstDate = startDate <= endDate ? startDate : endDate;
  const lastDate = startDate <= endDate ? endDate : startDate;
  const cursor = new Date(`${firstDate}T00:00:00`);
  const end = new Date(`${lastDate}T00:00:00`);
  const dates = [];

  while (cursor <= end) {
    const date = toDateInputValue(cursor);
    if (allowWeekends || !isWeekendDate(date)) {
      dates.push({ date, portion: "whole" });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

/**
 * Picks the individual days a request covers rather than a start-and-end range, so a filing for
 * June 1 and June 5 leaves the days in between untouched. Each picked day is then taken whole, or
 * as a morning or afternoon half.
 *
 * Collapsed to a single field until it is opened, so the form reads as one row of inputs and the
 * calendar only takes over the space while dates are actually being chosen.
 *
 * Ordinary leave excludes weekends, while compensatory time off and travel orders can opt into
 * full weekend selection through `allowWeekends`.
 */
export default function MultiDatePicker({
  value = [],
  minDate = todayDateInputValue(),
  disablePastDates = false,
  allowWeekends = false,
  placeholder = "Select dates",
  floating = false,
  closeOnSelect = false,
  selectionMode = "multiple",
  showRangeDuration = false,
  fullDayLabel = DATE_PORTION_LABELS.whole,
  rangeLabel = "Date Range",
  onChange,
}) {
  const sanitizedDays = useMemo(() => sanitizeSelectedDates(value), [value]);
  /*
   * An empty `minDate` means there is no lower bound at all. Compensatory time off uses it: the
   * hours are often logged after the days were taken, so its calendar has to reach backwards. The
   * default is still today, so every other caller keeps the no-back-dating rule without asking.
   */
  const earliestDate = String(minDate || "");
  const isSelectableDate = useCallback(
    (date) => (earliestDate === "" || date >= earliestDate)
      && (!disablePastDates || !isPastDate(date))
      && (allowWeekends || !isWeekendDate(date)),
    [allowWeekends, disablePastDates, earliestDate]
  );
  /*
   * `disabled` protects ordinary mouse and keyboard use, but it is not a data boundary. A stale
   * value can survive overnight, and callers/tests can supply a value directly, so keep forbidden
   * dates out of both the rendered selection and every change emitted to the parent.
   */
  const selectedDays = useMemo(
    () => sanitizedDays.filter((day) => isSelectableDate(day.date)),
    [isSelectableDate, sanitizedDays]
  );
  const isRangeMode = selectionMode === "range";
  const [isOpen, setIsOpen] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState(null);
  const [rangePortion, setRangePortion] = useState("whole");
  const [monthStart, setMonthStart] = useState(() => toFirstOfMonth(selectedDays[0]?.date || minDate));
  const [popoverPosition, setPopoverPosition] = useState(null);
  const fieldRef = useRef(null);
  const popoverRef = useRef(null);
  const summary = useMemo(() => {
    if (!isRangeMode || selectedDays.length < 2) {
      return formatSelectedDatesSummary(selectedDays);
    }

    return `${formatDateDisplay(selectedDays[0].date)} - ${formatDateDisplay(selectedDays[selectedDays.length - 1].date)}`;
  }, [isRangeMode, selectedDays]);

  const selectedPortionByDate = useMemo(
    () => new Map(selectedDays.map((day) => [day.date, day.portion])),
    [selectedDays]
  );
  /*
   * The range-wide Duration sets every day at once, so it can only name a portion while the days
   * agree. Once one day is set on its own it reads "Mixed" until the whole range is set again.
   */
  const portionsAgree = useMemo(
    () => selectedDays.every((day) => day.portion === selectedDays[0]?.portion),
    [selectedDays]
  );
  const monthCells = useMemo(() => buildMonthCells(monthStart), [monthStart]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthStart),
    [monthStart]
  );
  /*
   * Nothing before the earliest selectable day is reachable, so the back arrow stops at its month --
   * unless there is no earliest day, in which case it keeps going back.
   */
  const canGoToPreviousMonth = earliestDate === "" || monthStart > toFirstOfMonth(earliestDate);

  useEffect(() => {
    if (selectedDays.length !== sanitizedDays.length) {
      onChange?.(selectedDays);
    }
  }, [onChange, sanitizedDays.length, selectedDays]);

  useEffect(() => {
    if (!isRangeMode || selectedDays.length === 0) {
      return;
    }

    const selectedPortion = selectedDays[0].portion;
    if (selectedDays.every((day) => day.portion === selectedPortion)) {
      setRangePortion(selectedPortion);
    }
  }, [isRangeMode, selectedDays]);

  useEffect(() => {
    if (isRangeMode && rangeAnchor && selectedDays.length > 1) {
      setRangeAnchor(null);
    }
  }, [isRangeMode, rangeAnchor, selectedDays.length]);

  const updatePopoverPosition = useCallback(() => {
    if (!floating || !fieldRef.current) {
      return;
    }

    const fieldBounds = fieldRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const width = Math.min(
      Math.max(fieldBounds.width, 320),
      window.innerWidth - viewportPadding * 2
    );
    const left = Math.min(
      Math.max(fieldBounds.left, viewportPadding),
      window.innerWidth - width - viewportPadding
    );
    const top = fieldBounds.bottom + 8;

    setPopoverPosition({
      left,
      top,
      width,
      maxHeight: Math.max(0, window.innerHeight - top - viewportPadding),
    });
  }, [floating]);

  useLayoutEffect(() => {
    if (!isOpen || !floating) {
      setPopoverPosition(null);
      return undefined;
    }

    updatePopoverPosition();

    const closeOnOutsideClick = (event) => {
      if (
        fieldRef.current?.contains(event.target)
        || popoverRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        fieldRef.current?.querySelector("button")?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [floating, isOpen, updatePopoverPosition]);

  const emitChange = (nextDays) => {
    return onChange?.(sanitizeSelectedDates(nextDays).filter((day) => isSelectableDate(day.date)));
  };

  const shiftMonth = (offset) => {
    setMonthStart((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const toggleDate = (date) => {
    /* Do not rely on the button alone: this also blocks synthetic/programmatic activation. */
    if (!isSelectableDate(date)) {
      return;
    }

    if (isRangeMode) {
      if (!rangeAnchor) {
        const accepted = emitChange([{ date, portion: rangePortion }]);
        if (accepted !== false) {
          setRangeAnchor(date);
        } else if (closeOnSelect) {
          setIsOpen(false);
        }
        return;
      }

      const nextRange = buildInclusiveDateRange(
        rangeAnchor,
        date,
        allowWeekends
      )
        .map((day) => ({ ...day, portion: rangePortion }))
        .filter((day) => isSelectableDate(day.date));
      emitChange(nextRange);
      setRangeAnchor(null);
      if (closeOnSelect) {
        setIsOpen(false);
      }
      return;
    }

    emitChange(
      selectedPortionByDate.has(date)
        ? selectedDays.filter((day) => day.date !== date)
        : [...selectedDays, { date, portion: "whole" }]
    );
    if (closeOnSelect) {
      setIsOpen(false);
    }
  };

  const changePortion = (date, portion) => {
    emitChange(selectedDays.map((day) => (day.date === date ? { ...day, portion } : day)));
  };

  const clearSelection = () => {
    setRangeAnchor(null);
    setRangePortion("whole");
    emitChange([]);
  };

  const changeRangePortion = (portion) => {
    /* The "Mixed" placeholder reports differing days; it is not a portion to apply. */
    if (!DATE_PORTIONS.includes(portion)) {
      return;
    }

    setRangePortion(portion);
    emitChange(selectedDays.map((day) => ({ ...day, portion })));
  };

  const calendar = !isOpen ? null : (
    <div
      ref={popoverRef}
      className={`${floating ? "fixed z-[120] overflow-y-auto shadow-lg shadow-slate-900/10" : "mt-2"} rounded-2xl border border-slate-200 bg-white`}
      style={floating ? {
        ...popoverPosition,
        visibility: popoverPosition ? "visible" : "hidden",
      } : undefined}
    >
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
            /* A day already gone cannot be applied for; weekend rules depend on the filing type. */
            const isSelectable = cell.isCurrentMonth && isSelectableDate(cell.value);

            if (!cell.isCurrentMonth) {
              return <span key={cell.value} aria-hidden="true" className="py-1" />;
            }

            return (
              <button
                key={cell.value}
                type="button"
                onClick={() => toggleDate(cell.value)}
                disabled={!isSelectable}
                aria-disabled={!isSelectable}
                aria-pressed={Boolean(portion)}
                aria-label={`${formatDateDisplay(cell.value)}${portion ? ` selected, ${portion === "whole" ? fullDayLabel : DATE_PORTION_LABELS[portion]}` : ""}`}
                title={!isSelectable && (
                  (earliestDate !== "" && cell.value < earliestDate)
                  || (disablePastDates && isPastDate(cell.value))
                )
                  ? "Past dates cannot be selected"
                  : undefined}
                className={`relative flex h-10 flex-col items-center justify-center rounded-lg text-sm font-medium transition ${
                  !isSelectable
                    ? "cursor-not-allowed bg-slate-100 text-slate-300 opacity-70"
                    : portion
                      ? "bg-teal-700 text-white shadow-sm hover:bg-teal-800"
                      : "text-slate-700 hover:bg-teal-50"
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
          {isRangeMode
            ? (rangeAnchor ? "Now select the end date." : "Select a start date, then an end date.")
            : "Tap a day to add or remove it."}
          {/* Only promise what is actually enforced: a calendar with no lower bound takes past days. */}
          {earliestDate === "" && !disablePastDates
            ? (allowWeekends ? "" : " Weekends cannot be selected.")
            : (allowWeekends ? " Past dates cannot be selected." : " Weekends and past dates cannot be selected.")}
        </p>
      </div>

      <div className="border-t border-slate-200 px-3 py-3">
        {selectedDays.length === 0 ? (
          <p className="m-0 flex items-center gap-2 text-xs text-slate-500">
            <CalendarDays size={14} />
            No dates selected yet.
          </p>
        ) : isRangeMode ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {rangeLabel}
              </p>
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-rose-700 hover:underline"
              >
                Clear
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Start</span>
                <span className="mt-0.5 block truncate text-xs font-medium text-slate-800">
                  {formatDateDisplay(selectedDays[0].date)}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">End</span>
                <span className={`mt-0.5 block truncate text-xs font-medium ${rangeAnchor ? "text-slate-400" : "text-slate-800"}`}>
                  {rangeAnchor
                    ? "Select end date"
                    : formatDateDisplay(selectedDays[selectedDays.length - 1].date)}
                </span>
              </div>
            </div>
            {showRangeDuration ? (
              <>
                <label className="mt-2 block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Duration for all days
                  </span>
                  <select
                    value={portionsAgree ? rangePortion : ""}
                    onChange={(event) => changeRangePortion(event.target.value)}
                    aria-label="Duration for every selected date"
                    className="min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                  >
                    {portionsAgree ? null : <option value="" disabled>Mixed</option>}
                    {DATE_PORTIONS.map((portion) => (
                      <option key={portion} value={portion}>
                        {portion === "whole" ? fullDayLabel : DATE_PORTION_LABELS[portion]}
                      </option>
                    ))}
                  </select>
                </label>

                {/*
                  * Each day can still be set on its own, so a week of leave can take the Friday as
                  * a morning without the other four following it.
                  */}
                <p className="m-0 mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Duration per day ({selectedDays.length})
                </p>
                <ul className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
                  {selectedDays.map((day) => (
                    <li
                      key={day.date}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5"
                    >
                      <span className="flex-1 truncate text-sm font-medium text-slate-800">
                        {formatDateDisplay(day.date)}
                      </span>
                      <select
                        value={day.portion}
                        onChange={(event) => changePortion(day.date, event.target.value)}
                        aria-label={`Duration for ${formatDateDisplay(day.date)}`}
                        className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                      >
                        {DATE_PORTIONS.map((portion) => (
                          <option key={portion} value={portion}>
                            {portion === "whole" ? fullDayLabel : DATE_PORTION_LABELS[portion]}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Selected Dates ({selectedDays.length})
              </p>
              <button
                type="button"
                    onClick={clearSelection}
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
  );

  return (
    <div ref={fieldRef}>
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

      {floating && isOpen ? createPortal(calendar, document.body) : calendar}
    </div>
  );
}
