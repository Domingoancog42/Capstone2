import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { fetchHolidays } from "../../services/holidayService";
import { todayDateInputValue } from "../../utils/leaveHelpers";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOLIDAY_TYPES = {
  regular: "Regular holiday",
  special_non_working: "Special non-working day",
  special_working: "Special working day",
};

function dateFromKey(key) {
  const [year, month, day = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function OvertimeWorkDateCalendar({ value, onChange, error }) {
  const id = useId();
  const [today, setToday] = useState(todayDateInputValue);
  const month = today.slice(0, 7);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestId = useRef(0);
  const year = month.slice(0, 4);

  const loadHolidays = useCallback(async ({ background = false } = {}) => {
    const currentRequest = ++requestId.current;
    if (!background) setLoading(true);
    try {
      const result = await fetchHolidays({ start: `${year}-01-01`, end: `${year}-12-31` });
      if (currentRequest !== requestId.current) return;
      setHolidays(Array.isArray(result?.holidays) ? result.holidays : []);
      setLoadError(false);
    } catch {
      if (currentRequest === requestId.current) setLoadError(true);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    setHolidays([]);
    void loadHolidays();
    return () => { requestId.current += 1; };
  }, [loadHolidays]);

  useAutoRefreshOnChange(loadHolidays, { topic: "holiday", refreshOnMount: false });

  useEffect(() => {
    const updateToday = () => setToday(todayDateInputValue());
    const timer = window.setInterval(updateToday, 60000);
    window.addEventListener("focus", updateToday);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateToday);
    };
  }, []);

  const holidaysByDate = useMemo(() => {
    const grouped = {};
    holidays.forEach((holiday) => {
      (grouped[holiday.date] ||= []).push(holiday);
    });
    return grouped;
  }, [holidays]);

  const firstDay = dateFromKey(month);
  const daysInMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((firstDay.getDay() + daysInMonth) / 7) * 7;
  const selectedValue = String(value || "").slice(0, 7) === month ? value : "";
  const selectedLabel = selectedValue
    ? dateFromKey(selectedValue).toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "Choose a date on the calendar.";

  return (
    <div data-validation-field>
      <p id={`${id}-label`} className="m-0 mb-1.5 text-sm font-semibold text-slate-700">Work Date <span className="text-rose-600">*</span></p>
      <section aria-labelledby={`${id}-label`} aria-describedby={`${id}-selection${error ? ` ${id}-error` : ""}`} className={`overflow-hidden rounded-2xl border border-t-2 bg-white ${error ? "border-rose-500" : "border-blue-200 border-t-blue-600"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 px-3 py-3 sm:px-4">
          <div>
            <p className="m-0 text-sm font-semibold text-blue-700">Overtime Calendar</p>
            <p className="m-0 mt-1 text-xs text-slate-500">Select today or a future weekday in the current month. Saturdays and Sundays are unavailable.</p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-blue-200 p-1">
            <button type="button" aria-label="Previous month" disabled className="cursor-not-allowed rounded-lg p-2 text-slate-300"><ChevronLeft size={16} /></button>
            <span aria-label="Calendar month" className="w-36 text-center text-xs text-slate-700 sm:text-sm">{firstDay.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</span>
            <button type="button" aria-label="Next month" disabled className="cursor-not-allowed rounded-lg p-2 text-slate-300"><ChevronRight size={16} /></button>
          </div>
        </div>
        <div className="p-2 sm:p-3">
          <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-2">
            {WEEKDAYS.map((day) => <div key={day} className="py-1 text-center text-[10px] font-medium text-slate-500 sm:text-xs"><span className="sm:hidden" title={day}>{day.slice(0, 3)}</span><span className="hidden sm:inline">{day}</span></div>)}
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {Array.from({ length: cells }, (_, index) => {
              const day = index - firstDay.getDay() + 1;
              if (day < 1 || day > daysInMonth) return <div key={`blank-${index}`} aria-hidden="true" />;
              const date = `${month}-${String(day).padStart(2, "0")}`;
              const dayHolidays = holidaysByDate[date] || [];
              const selected = date === selectedValue;
              const past = date < today;
              const weekend = index % 7 === 0 || index % 7 === 6;
              const holidayLabel = dayHolidays.map((holiday) => `${holiday.name} (${holiday.typeLabel || HOLIDAY_TYPES[holiday.type] || "Holiday"})`).join(", ");
              return (
                <button
                  key={date}
                  type="button"
                  disabled={past || weekend}
                  aria-pressed={selected}
                  aria-current={date === today ? "date" : undefined}
                  aria-label={`${dateFromKey(date).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${holidayLabel ? `, ${holidayLabel}` : ""}${past || weekend ? ", unavailable" : ""}`}
                  title={[holidayLabel, weekend ? "Saturdays and Sundays cannot be selected" : past ? "Past dates cannot be selected" : "Select work date"].filter(Boolean).join(". ")}
                  onClick={() => onChange(date)}
                  className={`flex min-h-[76px] min-w-0 flex-col items-start gap-1 rounded-lg border p-1.5 text-left text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 sm:min-h-[92px] sm:p-2 ${weekend ? "cursor-not-allowed border-gray-300 bg-gray-200 text-gray-600" : `${selected ? "border-blue-600 bg-blue-50 ring-2 ring-blue-500" : dayHolidays.length ? "border-amber-300 bg-amber-50" : "border-blue-100 bg-white hover:bg-blue-50"} ${past ? "cursor-not-allowed text-slate-400" : "text-slate-700"}`}`}
                >
                  <span className="font-semibold">{day}</span>
                  {date === today ? <span className="text-[9px] font-semibold text-blue-700 sm:text-[10px]">Today</span> : null}
                  {dayHolidays.map((holiday, holidayIndex) => <span key={holiday.key || `${date}-${holidayIndex}`} className="w-full break-words text-[9px] leading-tight text-amber-800 sm:text-[10px]">{holiday.name}</span>)}
                  {weekend ? <span className="text-[9px] text-gray-600 sm:text-[10px]">Unavailable</span> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" />Selected</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-amber-300 bg-amber-100" />Holiday / special day</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-gray-200" />Weekend unavailable</span>
            <span className="ml-auto px-2 py-1 font-semibold text-blue-700">Current month only</span>
          </div>
          <p id={`${id}-selection`} aria-live="polite" className="m-0 mt-2 text-sm font-medium text-slate-700">{selectedValue ? `Selected: ${selectedLabel}` : selectedLabel}</p>
          {loading ? <p role="status" className="m-0 mt-2 text-xs text-slate-500">Loading holidays...</p> : null}
          {loadError ? <p role="status" className="m-0 mt-2 text-xs text-amber-800">Holidays could not be refreshed. <button type="button" onClick={() => loadHolidays()} className="font-semibold underline">Retry</button></p> : null}
        </div>
      </section>
      {error ? <p id={`${id}-error`} role="alert" className="m-0 mt-1.5 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
