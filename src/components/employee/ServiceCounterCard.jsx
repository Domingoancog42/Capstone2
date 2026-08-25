import React, { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";

function parseDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addYears(date, years) {
  return new Date(
    date.getFullYear() + years,
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

function addMonths(date, months) {
  const result = new Date(date);
  const expectedMonth = result.getMonth() + months;

  result.setMonth(expectedMonth);

  if (result.getMonth() !== ((expectedMonth % 12) + 12) % 12) {
    result.setDate(0);
  }

  return result;
}

function calculateDuration(dateHired, now = new Date()) {
  const hiredAt = parseDate(dateHired);

  if (!hiredAt) {
    return null;
  }

  if (hiredAt > now) {
    return {
      years: 0,
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      label: "Service has not started",
    };
  }

  let years = now.getFullYear() - hiredAt.getFullYear();
  if (addYears(hiredAt, years) > now) {
    years -= 1;
  }

  let anchor = addYears(hiredAt, years);
  let months = (now.getFullYear() - anchor.getFullYear()) * 12 + now.getMonth() - anchor.getMonth();
  if (addMonths(anchor, months) > now) {
    months -= 1;
  }

  anchor = addMonths(anchor, months);

  let remainingMs = Math.max(0, now.getTime() - anchor.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;
  const days = Math.floor(remainingMs / dayMs);
  remainingMs -= days * dayMs;
  const hours = Math.floor(remainingMs / hourMs);
  remainingMs -= hours * hourMs;
  const minutes = Math.floor(remainingMs / minuteMs);

  return {
    years,
    months,
    days,
    hours,
    minutes,
    label: `${years}y ${months}m ${days}d ${hours}h ${minutes}m`,
  };
}

export default function ServiceCounterCard({ dateHired, service }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const duration = useMemo(() => calculateDuration(dateHired, now), [dateHired, now]);
  const display = duration || service || {};
  const hasDateHired = Boolean(parseDate(dateHired));

  return (
    <div className="min-h-[156px] rounded-lg border border-sky-200 bg-sky-50 p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-sky-200 bg-white text-sky-700">
          <TrendingUp size={18} />
        </div>
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-sky-800">Live Service</p>
          <p className="m-0 mt-2 break-words text-lg font-semibold leading-tight text-slate-950" aria-live="polite">
            {hasDateHired ? display.label : "Date hired missing"}
          </p>
          <p className="m-0 mt-2 text-sm text-slate-600">
            {hasDateHired ? "Years, months, days, hours, and minutes served" : "Update your employee Date Hired record"}
          </p>
        </div>
      </div>
    </div>
  );
}
