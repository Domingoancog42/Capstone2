import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Expand,
  MapPin,
  Megaphone,
  PartyPopper,
  Plane,
  Plus,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useAutoRefreshOnChange } from "../auto/autorefreshdatalist";
import Button from "../UI/button";
import Modal from "../UI/modal";
import { createAnnouncement, fetchAnnouncements } from "../../services/announcementService";
import { fetchHolidays } from "../../services/holidayService";
import { fetchLeaveRequests } from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { normalizeLeaveStatus } from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay, unpackLeaveReason } from "../../utils/leaveRequestDetails";
import { unpackSelectedDates } from "../../utils/dateSelection";

const ENTRY_META = {
  leave: {
    label: "Leave",
    color: "#2563eb",
    pale: "#eff6ff",
    icon: CalendarDays,
  },
  travel: {
    label: "Travel Order",
    color: "#f59e0b",
    pale: "#fffbeb",
    icon: Plane,
  },
  announcement: {
    label: "Announcement",
    color: "#7c3aed",
    pale: "#f5f3ff",
    icon: Megaphone,
  },
  event: {
    label: "Event",
    color: "#0891b2",
    pale: "#ecfeff",
    icon: CalendarDays,
  },
  regular_holiday: {
    label: "Regular Holiday",
    color: "#dc2626",
    pale: "#fef2f2",
    icon: PartyPopper,
  },
  special_day: {
    label: "Special Day",
    color: "#059669",
    pale: "#ecfdf5",
    icon: PartyPopper,
  },
};

const SCHEDULE_FILTERS = [
  { key: "all", label: "All" },
  ...Object.entries(ENTRY_META).map(([key, meta]) => ({ key, label: meta.label })),
];

const DATE_HIGHLIGHT_PRIORITY = [
  "regular_holiday",
  "special_day",
  "leave",
  "travel",
  "event",
  "announcement",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const EMPTY_ENTRY_FORM = {
  entryType: "announcement",
  title: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  audience: "all",
  location: "",
  description: "",
};

const EVENT_AUDIENCE_OPTIONS = [
  { value: "all", label: "All Users" },
  { value: "employees", label: "Employees" },
  { value: "admin", label: "Administrators" },
  { value: "hr", label: "HR Head and HR Staff" },
  { value: "chief", label: "Division Chiefs" },
  { value: "planningofficer", label: "Planning Officers" },
  { value: "regionaldirector", label: "Regional Director" },
  { value: "cashier", label: "Cashiers" },
];

const monthTitleFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function toDateKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function parseDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(value) {
  const date = parseDateKey(value);
  return date ? fullDateFormatter.format(date) : "Date unavailable";
}

function formatTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);

  if (!match) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(new Date(2000, 0, 1, Number(match[1]), Number(match[2])));
}

function formatCreatedAt(value) {
  const normalized = String(value || "").trim().replace(" ", "T");
  const date = normalized ? new Date(normalized) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function openDatePicker(event) {
  event.currentTarget.showPicker?.();
}

function monthBounds(monthDate) {
  return {
    start: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
    end: new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0),
  };
}

function expandDateRange(startValue, endValue, bounds) {
  const parsedStart = parseDateKey(startValue);
  const parsedEnd = parseDateKey(endValue) || parsedStart;

  if (!parsedStart || !parsedEnd || parsedEnd < bounds.start || parsedStart > bounds.end) {
    return [];
  }

  const cursor = new Date(Math.max(parsedStart.getTime(), bounds.start.getTime()));
  const last = new Date(Math.min(parsedEnd.getTime(), bounds.end.getTime()));
  const dates = [];

  while (cursor <= last) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function normalizeAnnouncement(record, bounds) {
  const type = record?.entryType === "event" ? "event" : "announcement";
  const dates = expandDateRange(record?.startDate, record?.endDate || record?.startDate, bounds);

  if (!dates.length) {
    return null;
  }

  return {
    id: `${type}-${record?.id || `${record?.startDate}-${record?.title}`}`,
    type,
    title: record?.title || ENTRY_META[type].label,
    startDate: record?.startDate,
    endDate: record?.endDate || record?.startDate,
    startTime: record?.startTime || "",
    endTime: record?.endTime || "",
    audience: record?.audienceLabel || "All Users",
    location: record?.location || "",
    description: record?.description || "No additional details were provided.",
    createdBy: record?.createdBy || "System user",
    createdAt: record?.createdAt || "",
    dates,
  };
}

function normalizeHoliday(record, bounds) {
  const dates = expandDateRange(record?.date, record?.date, bounds);

  if (!dates.length) {
    return null;
  }

  const type = String(record?.type || "regular") === "regular" ? "regular_holiday" : "special_day";

  return {
    id: `holiday-${record?.key || record?.id || record?.date}`,
    type,
    title: record?.name || ENTRY_META[type].label,
    startDate: record?.date,
    endDate: record?.date,
    description: record?.description || `${record?.typeLabel || ENTRY_META[type].label} observed nationwide.`,
    status: record?.source === "national" ? "National" : "Office-declared",
    dates,
  };
}

function firstText(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function normalizeApprovedRequest(record, type, bounds) {
  const startDate = firstText(record?.startDate);
  const endDate = firstText(record?.endDate, record?.startDate);

  if (normalizeLeaveStatus(record?.status) !== "Approved" || !startDate) {
    return null;
  }

  const leaveDetails = type === "leave" ? unpackLeaveReason(record?.reason) : null;
  const travelDetails = type === "travel" ? unpackSelectedDates(record?.remarks) : null;
  const selectedDays = type === "leave" ? leaveDetails.details.leaveDays : travelDetails.dates;
  const selectedDates = [...new Set(selectedDays.map((day) => day.date))]
    .filter((dateKey) => {
      const date = parseDateKey(dateKey);
      return date && date >= bounds.start && date <= bounds.end;
    });
  const dates = selectedDays.length
    ? selectedDates
    : expandDateRange(startDate, endDate, bounds);

  if (!dates.length) {
    return null;
  }

  const employeeName = firstText(record?.employeeName, record?.fullName, record?.employeeId, "Employee");
  const activityType = type === "travel"
    ? "Travel Order"
    : firstText(record?.leaveType, "Leave");
  const description = type === "travel"
    ? firstText(record?.destination, record?.purpose, travelDetails.note, "No travel details were provided.")
    : firstText(getLeaveReasonDisplay(record?.reason, record?.leaveType), record?.leaveType, "No leave details were provided.");

  return {
    id: `${type}-${record?.id || record?.requestId || `${startDate}-${employeeName}`}`,
    type,
    title: `${employeeName} - ${activityType}`,
    startDate,
    endDate,
    description,
    status: "Approved",
    employeeName,
    activityType,
    dates,
  };
}

function buildMonthCells(monthDate) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: firstDay.getDay() }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function EntryDetails({ entry }) {
  const meta = ENTRY_META[entry.type] || ENTRY_META.announcement;
  const Icon = meta.icon;
  const isEvent = entry.type === "event";
  const isHoliday = entry.type === "regular_holiday" || entry.type === "special_day";
  const isEmployeeRequest = entry.type === "leave" || entry.type === "travel";
  const isSingleDay = !entry.endDate || entry.startDate === entry.endDate;
  const startTime = formatTime(entry.startTime);
  const endTime = formatTime(entry.endTime);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4" style={{ borderColor: `${meta.color}35`, backgroundColor: meta.pale }}>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: meta.color }}>
            <Icon size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-[0.13em]" style={{ color: meta.color }}>{meta.label}</span>
            <h3 className="m-0 mt-1 text-lg font-semibold text-slate-950">{entry.title}</h3>
            <p className="m-0 mt-1 text-sm text-slate-600">
              {isSingleDay ? formatDateKey(entry.startDate) : `${formatDateKey(entry.startDate)} - ${formatDateKey(entry.endDate)}`}
            </p>
          </div>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        {isEvent && startTime ? <DetailItem icon={Clock3} label="Time" value={`${startTime}${endTime ? ` - ${endTime}` : ""}`} /> : null}
        {isEvent ? <DetailItem icon={UsersRound} label="Audience" value={entry.audience} /> : null}
        {isEvent ? <DetailItem icon={MapPin} label="Location" value={entry.location || "Not specified"} /> : null}
        {isHoliday ? <DetailItem icon={PartyPopper} label="Observance" value={entry.status || meta.label} /> : null}
        {isEmployeeRequest ? <DetailItem icon={UserRound} label="Employee" value={entry.employeeName || "Employee"} /> : null}
        {isEmployeeRequest ? <DetailItem icon={CalendarClock} label="Status" value={entry.status || "Approved"} /> : null}
        {!isHoliday && !isEmployeeRequest ? <DetailItem icon={UserRound} label="Created by" value={entry.createdBy || "System user"} /> : null}
        {!isHoliday && !isEmployeeRequest ? <DetailItem icon={Clock3} label="Created on" value={formatCreatedAt(entry.createdAt)} /> : null}
      </dl>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <p className="m-0 text-xs font-bold uppercase tracking-[0.13em] text-slate-400">Details</p>
        <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{entry.description}</p>
      </div>
    </div>
  );
}

function DetailItem({ icon: Icon, label, value }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</dt>
        <dd className="m-0 mt-0.5 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</dd>
      </div>
    </div>
  );
}

function ScheduleEntryRow({ entry, onView, showCreated = false }) {
  const meta = ENTRY_META[entry.type] || ENTRY_META.announcement;
  const EntryIcon = meta.icon;
  const entryTime = formatTime(entry.startTime);

  return (
    <article className="group flex items-start gap-2.5 rounded-xl border border-transparent px-1.5 py-2 transition hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/70">
      <span className="mt-4 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden="true" />
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ color: meta.color, backgroundColor: meta.pale }}>
        <EntryIcon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: meta.color, backgroundColor: meta.pale }}>
            {meta.label}
          </span>
          <p className="m-0 min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100" title={entry.title}>{entry.title}</p>
        </div>
        <p className="m-0 mt-1 truncate text-[10px] font-medium text-slate-400">
          {formatDateKey(entry.startDate)}{entryTime ? ` · ${entryTime}` : " · All Day"}
        </p>
        {showCreated ? (
          <p className="m-0 mt-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
            Created {formatCreatedAt(entry.createdAt)} by {entry.createdBy || "System user"}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"
        onClick={() => onView(entry)}
        aria-label={`View ${entry.title}`}
      >
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </article>
  );
}

function CalendarBoard({
  canCreateEntries,
  canManageEntries,
  cells,
  changeMonth,
  entriesByDate,
  expanded = false,
  isCurrentMonth,
  loadError,
  loading,
  monthDate,
  onCreate,
  onExpand,
  onOpenSchedule,
  onViewEntry,
  scheduleFilter,
  selectedDate,
  setScheduleFilter,
  setSelectedDate,
  todayKey,
  visibleEntries,
}) {
  return (
    <section
      className={`h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 ${expanded ? "min-h-[560px]" : ""}`.trim()}
      aria-label={expanded ? "Expanded dashboard calendar" : "Dashboard calendar"}
    >
      <div className={`grid h-full ${expanded ? "lg:grid-cols-[minmax(280px,0.72fr)_minmax(520px,1.28fr)]" : "md:grid-cols-[minmax(210px,0.88fr)_minmax(310px,1.12fr)]"}`}>
        <div className="order-2 flex min-w-0 flex-col border-t border-slate-200/80 p-4 dark:border-slate-700 md:order-1 md:border-r md:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-slate-950 dark:text-white">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
                <Clock3 size={18} aria-hidden="true" />
              </span>
              {selectedDate ? "Selected Date Schedule" : "Upcoming Schedule"}
            </h2>
            <button
              type="button"
              className="shrink-0 text-[11px] font-bold text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              onClick={onOpenSchedule}
            >
              View All
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Schedule filters">
            {SCHEDULE_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                data-active={scheduleFilter === filter.key}
                className={`min-w-0 rounded-xl px-2 py-2 text-[10px] font-bold transition ${scheduleFilter === filter.key ? "bg-blue-600 text-white shadow-sm shadow-blue-200 dark:shadow-none" : "bg-slate-100 text-slate-500 hover:bg-slate-200/80 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"}`}
                onClick={() => setScheduleFilter(filter.key)}
              >
                <span className="block truncate">{filter.label}</span>
              </button>
            ))}
          </div>

          <p className="m-0 mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {selectedDate ? formatDateKey(selectedDate) : isCurrentMonth ? "This month" : monthTitleFormatter.format(monthDate)}
          </p>

          <div className={`mt-2 space-y-1 overflow-y-auto pr-1 ${expanded ? "max-h-[390px]" : "max-h-[238px]"}`}>
            {loading ? (
              <div className="space-y-2" aria-label="Loading calendar">
                {[0, 1, 2].map((item) => <div key={item} className="h-[58px] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
              </div>
            ) : visibleEntries.length ? visibleEntries.map((entry) => (
              <ScheduleEntryRow key={entry.id} entry={entry} onView={onViewEntry} />
            )) : (
              <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-slate-300 px-3 text-center text-xs font-medium text-slate-400 dark:border-slate-700">
                No scheduled items{selectedDate ? " on this date" : " for this view"}.
              </div>
            )}
          </div>
          {loadError ? <p className="m-0 mt-2 text-[10px] font-semibold text-amber-600">{loadError}</p> : null}
        </div>

        <div className="order-1 min-w-0 p-4 md:order-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
                <CalendarDays size={18} aria-hidden="true" />
              </span>
              <h2 className="m-0 text-base font-bold tracking-tight text-slate-950 dark:text-white">Calendar</h2>
            </div>
            {canManageEntries ? (
              <div className="flex flex-wrap items-center gap-2">
                {canCreateEntries ? (
                  <Button size="sm" icon={Plus} onClick={onCreate}>Create Event/Announcement</Button>
                ) : null}
                {!expanded ? (
                  <Button size="sm" variant="secondary" icon={Expand} onClick={onExpand}>Expand</Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4" aria-label="Calendar color legend">
            {Object.entries(ENTRY_META).map(([key, meta]) => (
              <span key={key} className="flex min-w-0 items-center gap-1.5 text-[9px] font-semibold text-slate-500 dark:text-slate-400">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden="true" />
                <span className="truncate">{meta.label}</span>
              </span>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              type="button"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-50 text-blue-600 transition hover:bg-blue-50 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/50"
              onClick={() => changeMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <h2 className="m-0 text-center text-base font-bold tracking-tight text-slate-950 dark:text-white">{monthTitleFormatter.format(monthDate)}</h2>
            <button
              type="button"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-50 text-blue-600 transition hover:bg-blue-50 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/50"
              onClick={() => changeMonth(1)}
              aria-label="Next month"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>

          <div className={`mt-3 grid grid-cols-7 ${expanded ? "gap-y-3" : "gap-y-1"}`} role="grid" aria-label={monthTitleFormatter.format(monthDate)}>
            {WEEKDAYS.map((day) => <span key={day} className="pb-1.5 text-center text-[10px] font-bold text-slate-400" role="columnheader">{day}</span>)}
            {cells.map((date, index) => {
              if (!date) {
                return <span key={`blank-${index}`} className={expanded ? "h-16" : "h-8"} aria-hidden="true" />;
              }

              const dateKey = toDateKey(date);
              const dayEntries = entriesByDate.get(dateKey) || [];
              const dotTypes = [...new Set(dayEntries.map((entry) => entry.type))];
              const highlightType = DATE_HIGHLIGHT_PRIORITY.find((type) => dotTypes.includes(type));
              const highlightMeta = highlightType ? ENTRY_META[highlightType] : null;
              const activityLabels = dotTypes.map((type) => ENTRY_META[type]?.label).filter(Boolean);
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedDate;
              const highlightStyle = highlightMeta ? {
                backgroundColor: isSelected ? highlightMeta.color : highlightMeta.pale,
                color: isSelected ? "#ffffff" : highlightMeta.color,
                boxShadow: `inset 0 0 0 ${isSelected ? 2 : 1}px ${highlightMeta.color}`,
              } : undefined;

              return (
                <button
                  key={dateKey}
                  type="button"
                  role="gridcell"
                  aria-label={`${formatDateKey(dateKey)}${dayEntries.length ? `, ${dayEntries.length} calendar item${dayEntries.length === 1 ? "" : "s"}: ${activityLabels.join(", ")}` : ""}`}
                  data-highlight-type={highlightType || undefined}
                  style={highlightStyle}
                  className={`group relative mx-auto flex flex-col items-center justify-center rounded-xl text-[11px] font-semibold transition ${expanded ? "min-h-16 w-full max-w-[74px] px-1 py-1" : "h-8 w-8"} ${highlightMeta ? "hover:brightness-95" : isSelected ? "bg-blue-600 text-white shadow-sm shadow-blue-200 dark:shadow-none" : isToday ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"} ${isSelected && highlightMeta ? "ring-2 ring-blue-300 ring-offset-1 dark:ring-offset-slate-900" : ""}`}
                  onClick={() => {
                    setScheduleFilter("all");
                    setSelectedDate((current) => current === dateKey ? "" : dateKey);
                  }}
                >
                  {dotTypes.length ? (
                    <span className="absolute top-0.5 flex items-center justify-center gap-0.5" aria-hidden="true">
                      {dotTypes.slice(0, 4).map((type) => <span key={type} className="h-1 w-1 rounded-full ring-1 ring-white dark:ring-slate-900" style={{ backgroundColor: ENTRY_META[type].color }} />)}
                    </span>
                  ) : null}
                  <span className={dotTypes.length ? "mt-2" : ""}>{date.getDate()}</span>
                  {expanded && activityLabels.length ? (
                    <span className="mt-0.5 block w-full truncate px-0.5 text-[7px] font-bold leading-3" title={activityLabels.join(", ")}>
                      {activityLabels.join(" / ")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DashboardMonthlyCalendar({
  canManageEntries = false,
  canCreateEntries = canManageEntries,
}) {
  const [monthDate, setMonthDate] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [announcements, setAnnouncements] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [travelOrders, setTravelOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [viewedEntry, setViewedEntry] = useState(null);
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [allScheduleFilter, setAllScheduleFilter] = useState("all");
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [allSchedulesOpen, setAllSchedulesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [entryForm, setEntryForm] = useState(EMPTY_ENTRY_FORM);
  const [entryErrors, setEntryErrors] = useState({});
  const [entrySaving, setEntrySaving] = useState(false);

  const loadCalendar = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setLoading(true);
    }

    const bounds = monthBounds(monthDate);
    const [announcementResult, holidayResult, leaveResult, travelResult] = await Promise.allSettled([
      fetchAnnouncements(),
      fetchHolidays({ start: toDateKey(bounds.start), end: toDateKey(bounds.end) }),
      fetchLeaveRequests(),
      fetchTravelOrders(),
    ]);

    if (announcementResult.status === "fulfilled") {
      setAnnouncements(Array.isArray(announcementResult.value?.announcements) ? announcementResult.value.announcements : []);
    }

    if (holidayResult.status === "fulfilled") {
      setHolidays(Array.isArray(holidayResult.value?.holidays) ? holidayResult.value.holidays : []);
    }

    if (leaveResult.status === "fulfilled") {
      setLeaveRequests(Array.isArray(leaveResult.value?.requests) ? leaveResult.value.requests : []);
    }

    if (travelResult.status === "fulfilled") {
      setTravelOrders(Array.isArray(travelResult.value?.requests) ? travelResult.value.requests : []);
    }

    setLoadError(
      announcementResult.status === "rejected"
        || holidayResult.status === "rejected"
        || leaveResult.status === "rejected"
        || travelResult.status === "rejected"
        ? "Some calendar items could not be loaded."
        : ""
    );
    setLoading(false);
  }, [monthDate]);

  useAutoRefreshOnChange(loadCalendar, {
    topics: ["announcement", "holiday", "leave_request", "travel_order"],
  });

  const entries = useMemo(() => {
    const bounds = monthBounds(monthDate);

    return [
      ...leaveRequests.map((record) => normalizeApprovedRequest(record, "leave", bounds)),
      ...travelOrders.map((record) => normalizeApprovedRequest(record, "travel", bounds)),
      ...announcements.map((record) => normalizeAnnouncement(record, bounds)),
      ...holidays.map((record) => normalizeHoliday(record, bounds)),
    ]
      .filter(Boolean)
      .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title));
  }, [announcements, holidays, leaveRequests, monthDate, travelOrders]);

  const entriesByDate = useMemo(() => {
    const lookup = new Map();

    entries.forEach((entry) => {
      entry.dates.forEach((dateKey) => {
        lookup.set(dateKey, [...(lookup.get(dateKey) || []), entry]);
      });
    });

    return lookup;
  }, [entries]);

  const allScheduleEntries = useMemo(() => announcements
    .map((record) => {
      const start = parseDateKey(record?.startDate);
      const end = parseDateKey(record?.endDate || record?.startDate) || start;
      return start && end ? normalizeAnnouncement(record, { start, end }) : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title)), [announcements]);
  const filteredAllScheduleEntries = allScheduleFilter === "all"
    ? allScheduleEntries
    : allScheduleEntries.filter((entry) => entry.type === allScheduleFilter);

  const datedEntries = selectedDate ? (entriesByDate.get(selectedDate) || []) : entries;
  const visibleEntries = scheduleFilter === "all"
    ? datedEntries
    : datedEntries.filter((entry) => entry.type === scheduleFilter);
  const cells = useMemo(() => buildMonthCells(monthDate), [monthDate]);
  const today = new Date();
  const todayKey = toDateKey(today);
  const isCurrentMonth = monthDate.getFullYear() === today.getFullYear()
    && monthDate.getMonth() === today.getMonth();
  const changeMonth = (offset) => {
    setSelectedDate("");
    setScheduleFilter("all");
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const closeCreateModal = () => {
    if (entrySaving) return;
    setCreateOpen(false);
    setEntryForm(EMPTY_ENTRY_FORM);
    setEntryErrors({});
  };

  const handleCreateEntry = async () => {
    const isEvent = entryForm.entryType === "event";
    const errors = {};

    if (!entryForm.title.trim()) errors.title = `${isEvent ? "Event" : "Announcement"} title is required.`;
    if (!entryForm.startDate) errors.startDate = "Start date is required.";
    if (isEvent && !entryForm.startTime) errors.startTime = "Start time is required.";
    if (isEvent && !entryForm.endDate) errors.endDate = "End date is required.";
    if (isEvent && !entryForm.endTime) errors.endTime = "End time is required.";
    if (isEvent && !entryForm.location.trim()) errors.location = "Location is required.";
    if (
      isEvent
      && entryForm.startDate
      && entryForm.startTime
      && entryForm.endDate
      && entryForm.endTime
      && `${entryForm.endDate}T${entryForm.endTime}` <= `${entryForm.startDate}T${entryForm.startTime}`
    ) {
      errors.endTime = "Event end must be after its start.";
    }

    setEntryErrors(errors);
    if (Object.keys(errors).length) return;

    setEntrySaving(true);
    try {
      const response = await createAnnouncement({
        entryType: entryForm.entryType,
        title: entryForm.title.trim(),
        startDate: entryForm.startDate,
        endDate: isEvent ? entryForm.endDate : entryForm.startDate,
        startTime: isEvent ? entryForm.startTime : "",
        endTime: isEvent ? entryForm.endTime : "",
        audience: isEvent ? entryForm.audience : "all",
        location: isEvent ? entryForm.location.trim() : "",
        description: entryForm.description.trim(),
      });

      if (response?.announcement) {
        setAnnouncements((current) => [
          response.announcement,
          ...current.filter((item) => item.id !== response.announcement.id),
        ]);
      } else {
        await loadCalendar({ background: true });
      }

      const createdDate = parseDateKey(entryForm.startDate);
      if (createdDate) setMonthDate(new Date(createdDate.getFullYear(), createdDate.getMonth(), 1));
      setSelectedDate(entryForm.startDate);
      setScheduleFilter(entryForm.entryType);
      toast.success(isEvent ? "Event created on the calendar." : "Announcement published to the calendar.");
      setCreateOpen(false);
      setEntryForm(EMPTY_ENTRY_FORM);
      setEntryErrors({});
    } catch (error) {
      const message = error?.response?.data?.message || `Unable to create the ${isEvent ? "event" : "announcement"}.`;
      setEntryErrors({ form: message });
      toast.error(message);
    } finally {
      setEntrySaving(false);
    }
  };

  const boardProps = {
    canCreateEntries,
    canManageEntries,
    cells,
    changeMonth,
    entriesByDate,
    isCurrentMonth,
    loadError,
    loading,
    monthDate,
    onCreate: () => setCreateOpen(true),
    onExpand: () => setExpandedOpen(true),
    onOpenSchedule: () => {
      setAllScheduleFilter("all");
      setAllSchedulesOpen(true);
    },
    onViewEntry: (entry) => {
      setExpandedOpen(false);
      setViewedEntry(entry);
    },
    scheduleFilter,
    selectedDate,
    setScheduleFilter,
    setSelectedDate,
    todayKey,
    visibleEntries,
  };
  const isEventForm = entryForm.entryType === "event";
  const fieldClass = "min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const modal = viewedEntry && typeof document !== "undefined"
    ? createPortal(
      <Modal
        open
        title={`${ENTRY_META[viewedEntry.type]?.label || "Calendar"} details`}
        maxWidth="max-w-[620px]"
        onClose={() => setViewedEntry(null)}
        footer={<Button variant="primary" onClick={() => setViewedEntry(null)}>Close</Button>}
      >
        <EntryDetails entry={viewedEntry} />
      </Modal>,
      document.body
    )
    : null;

  return (
    <>
      <section className="h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" aria-label="Dashboard calendar">
        <div className="grid h-full md:grid-cols-[minmax(210px,0.88fr)_minmax(310px,1.12fr)]">
          <div className="order-2 flex min-w-0 flex-col border-t border-slate-200/80 p-4 dark:border-slate-700 md:order-1 md:border-r md:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-slate-950 dark:text-white">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
                  <Clock3 size={18} aria-hidden="true" />
                </span>
                Upcoming Schedule
              </h2>
              <button
                type="button"
                className="shrink-0 text-[11px] font-bold text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                onClick={() => {
                  setAllScheduleFilter("all");
                  setAllSchedulesOpen(true);
                }}
              >
                View All
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Schedule filters">
              {[
                { key: "all", label: "All" },
                { key: "announcement", label: "Announcements" },
                { key: "event", label: "Events" },
              ].map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  data-active={scheduleFilter === filter.key}
                  className={`min-w-0 rounded-xl px-2 py-2 text-[10px] font-bold transition ${scheduleFilter === filter.key ? "bg-blue-600 text-white shadow-sm shadow-blue-200 dark:shadow-none" : "bg-slate-100 text-slate-500 hover:bg-slate-200/80 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"}`}
                  onClick={() => setScheduleFilter(filter.key)}
                >
                  <span className="block truncate">{filter.label}</span>
                </button>
              ))}
            </div>

            <p className="m-0 mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              {selectedDate ? formatDateKey(selectedDate) : isCurrentMonth ? "This month" : monthTitleFormatter.format(monthDate)}
            </p>

            <div className="mt-2 max-h-[238px] space-y-1 overflow-y-auto pr-1">
              {loading ? (
                <div className="space-y-2" aria-label="Loading calendar">
                  {[0, 1, 2].map((item) => <div key={item} className="h-[58px] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
                </div>
              ) : visibleEntries.length ? visibleEntries.map((entry) => {
                const meta = ENTRY_META[entry.type];
                const EntryIcon = meta.icon;
                const entryTime = formatTime(entry.startTime);

                return (
                  <article key={entry.id} className="group flex items-center gap-2.5 rounded-xl border border-transparent px-1.5 py-2 transition hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/70">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden="true" />
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ color: meta.color, backgroundColor: meta.pale }}>
                      <EntryIcon size={17} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-xs font-bold text-slate-900 dark:text-slate-100" title={entry.title}>{entry.title}</p>
                      <p className="m-0 mt-1 truncate text-[10px] font-medium text-slate-400">
                        {formatDateKey(entry.startDate)}{entryTime ? ` · ${entryTime}` : " · All Day"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"
                      onClick={() => setViewedEntry(entry)}
                      aria-label="View"
                    >
                      <ChevronRight size={17} aria-hidden="true" />
                      <span className="sr-only">View</span>
                    </button>
                  </article>
                );
              }) : (
                <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-slate-300 px-3 text-center text-xs font-medium text-slate-400 dark:border-slate-700">
                  No scheduled items{selectedDate ? " on this date" : " for this view"}.
                </div>
              )}
            </div>
            {loadError ? <p className="m-0 mt-2 text-[10px] font-semibold text-amber-600">{loadError}</p> : null}
          </div>

          <div className="order-1 min-w-0 p-4 md:order-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
                  <CalendarDays size={18} aria-hidden="true" />
                </span>
                <h2 className="m-0 text-base font-bold tracking-tight text-slate-950 dark:text-white">Calendar</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManageEntries && canCreateEntries ? (
                  <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>Create Event/Announcement</Button>
                ) : null}
                <Button size="sm" variant="secondary" icon={Expand} onClick={() => setExpandedOpen(true)}>Expand</Button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4" aria-label="Calendar color legend">
              {Object.entries(ENTRY_META).map(([key, meta]) => (
                <span key={key} className="flex min-w-0 items-center gap-1.5 text-[9px] font-semibold text-slate-500 dark:text-slate-400">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden="true" />
                  <span className="truncate">{meta.label}</span>
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-50 text-blue-600 transition hover:bg-blue-50 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/50"
                onClick={() => changeMonth(-1)}
                aria-label="Previous month"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <h2 className="m-0 text-center text-base font-bold tracking-tight text-slate-950 dark:text-white">{monthTitleFormatter.format(monthDate)}</h2>
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-50 text-blue-600 transition hover:bg-blue-50 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/50"
                onClick={() => changeMonth(1)}
                aria-label="Next month"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-y-1" role="grid" aria-label={monthTitleFormatter.format(monthDate)}>
              {WEEKDAYS.map((day) => <span key={day} className="pb-1.5 text-center text-[10px] font-bold text-slate-400" role="columnheader">{day}</span>)}
              {cells.map((date, index) => {
                if (!date) {
                  return <span key={`blank-${index}`} className="h-8" aria-hidden="true" />;
                }

                const dateKey = toDateKey(date);
                const dayEntries = entriesByDate.get(dateKey) || [];
                const dotTypes = [...new Set(dayEntries.map((entry) => entry.type))];
                const isToday = dateKey === todayKey;
                const isSelected = dateKey === selectedDate;

                return (
                  <button
                    key={dateKey}
                    type="button"
                    role="gridcell"
                    aria-label={`${formatDateKey(dateKey)}${dayEntries.length ? `, ${dayEntries.length} calendar item${dayEntries.length === 1 ? "" : "s"}` : ""}`}
                    className={`group relative mx-auto grid h-8 w-8 place-items-center rounded-xl text-[11px] font-semibold transition ${isSelected ? "bg-blue-600 text-white shadow-sm shadow-blue-200 dark:shadow-none" : isToday ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                    onClick={() => setSelectedDate((current) => current === dateKey ? "" : dateKey)}
                  >
                    {dotTypes.length ? (
                      <span className="absolute top-0.5 flex items-center justify-center gap-0.5" aria-hidden="true">
                        {dotTypes.slice(0, 4).map((type) => <span key={type} className="h-1 w-1 rounded-full ring-1 ring-white dark:ring-slate-900" style={{ backgroundColor: ENTRY_META[type].color }} />)}
                      </span>
                    ) : null}
                    <span className={dotTypes.length ? "mt-2" : ""}>{date.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      {modal}
      {typeof document !== "undefined" ? createPortal(
        <Modal
          open={expandedOpen}
          title="Expanded Calendar"
          maxWidth="max-w-[1180px]"
          maxHeight="max-h-[94dvh]"
          contentClassName="bg-slate-50 !p-3 dark:bg-slate-950"
          backdropClassName="backdrop-blur-sm"
          onClose={() => setExpandedOpen(false)}
        >
          <CalendarBoard {...boardProps} expanded />
        </Modal>,
        document.body
      ) : null}

      {typeof document !== "undefined" ? createPortal(
        <Modal
          open={allSchedulesOpen}
          title="All Events & Announcements"
          maxWidth="max-w-[820px]"
          backdropClassName="backdrop-blur-sm"
          onClose={() => setAllSchedulesOpen(false)}
          footer={<Button onClick={() => setAllSchedulesOpen(false)}>Close</Button>}
        >
          <div className="space-y-4">
            <div>
              <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Schedule type</p>
              <div className="mt-2 flex flex-wrap gap-2" aria-label="All schedule type filters">
                {[
                  { key: "all", label: "All Types" },
                  { key: "event", label: "Events" },
                  { key: "announcement", label: "Announcements" },
                ].map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${allScheduleFilter === filter.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}
                    onClick={() => setAllScheduleFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[58dvh] space-y-2 overflow-y-auto pr-1">
              {filteredAllScheduleEntries.length ? filteredAllScheduleEntries.map((entry) => (
                <ScheduleEntryRow
                  key={entry.id}
                  entry={entry}
                  showCreated
                  onView={(selectedEntry) => {
                    setAllSchedulesOpen(false);
                    setViewedEntry(selectedEntry);
                  }}
                />
              )) : (
                <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-slate-300 text-center text-sm font-semibold text-slate-400 dark:border-slate-700">
                  No {allScheduleFilter === "all" ? "events or announcements" : `${allScheduleFilter}s`} found.
                </div>
              )}
            </div>
          </div>
        </Modal>,
        document.body
      ) : null}

      {typeof document !== "undefined" ? createPortal(
        <Modal
          open={createOpen}
          title="Create Event/Announcement"
          maxWidth="max-w-[760px]"
          backdropClassName="backdrop-blur-sm"
          onClose={closeCreateModal}
          footer={(
            <>
              <Button icon={isEventForm ? CalendarClock : Megaphone} loading={entrySaving} onClick={handleCreateEntry}>
                {isEventForm ? "Create Event" : "Publish Announcement"}
              </Button>
            </>
          )}
        >
          <div className="grid gap-4">
            {entryErrors.form ? <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{entryErrors.form}</p> : null}

            <div className="space-y-2">
              <label htmlFor="dashboardCalendarEntryType" className="text-sm font-semibold text-slate-700 dark:text-slate-200">Create Type</label>
              <select
                id="dashboardCalendarEntryType"
                value={entryForm.entryType}
                className={fieldClass}
                onChange={(event) => {
                  setEntryForm({ ...EMPTY_ENTRY_FORM, entryType: event.target.value });
                  setEntryErrors({});
                }}
              >
                <option value="announcement">Announcement</option>
                <option value="event">Event</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="dashboardCalendarTitle" className="text-sm font-semibold text-slate-700 dark:text-slate-200">{isEventForm ? "Event Title" : "Announcement Title"}</label>
              <input
                id="dashboardCalendarTitle"
                value={entryForm.title}
                maxLength={200}
                className={fieldClass}
                placeholder={isEventForm ? "Enter event title" : "Enter announcement title"}
                onChange={(event) => {
                  setEntryForm((current) => ({ ...current, title: event.target.value }));
                  setEntryErrors((current) => ({ ...current, title: "" }));
                }}
              />
              {entryErrors.title ? <p className="m-0 text-xs font-semibold text-rose-600">{entryErrors.title}</p> : null}
            </div>

            <div className={`grid gap-4 ${isEventForm ? "sm:grid-cols-2" : ""}`}>
              <div className="space-y-2">
                <label htmlFor="dashboardCalendarStartDate" className="text-sm font-semibold text-slate-700 dark:text-slate-200">{isEventForm ? "Start Date & Time" : "Announcement Date"}</label>
                <input
                  id="dashboardCalendarStartDate"
                  type="date"
                  value={entryForm.startDate}
                  className={`${fieldClass} cursor-pointer`}
                  onClick={openDatePicker}
                  onChange={(event) => {
                    const startDate = event.target.value;
                    setEntryForm((current) => ({ ...current, startDate, endDate: current.endDate || startDate }));
                    setEntryErrors((current) => ({ ...current, startDate: "", endTime: "" }));
                  }}
                />
                {isEventForm ? (
                  <input
                    aria-label="Event start time"
                    type="time"
                    value={entryForm.startTime}
                    className={fieldClass}
                    onChange={(event) => {
                      setEntryForm((current) => ({ ...current, startTime: event.target.value }));
                      setEntryErrors((current) => ({ ...current, startTime: "", endTime: "" }));
                    }}
                  />
                ) : null}
                {entryErrors.startDate ? <p className="m-0 text-xs font-semibold text-rose-600">{entryErrors.startDate}</p> : null}
                {entryErrors.startTime ? <p className="m-0 text-xs font-semibold text-rose-600">{entryErrors.startTime}</p> : null}
              </div>

              {isEventForm ? (
                <div className="space-y-2">
                  <label htmlFor="dashboardCalendarEndDate" className="text-sm font-semibold text-slate-700 dark:text-slate-200">End Date & Time</label>
                  <input
                    id="dashboardCalendarEndDate"
                    type="date"
                    min={entryForm.startDate || undefined}
                    value={entryForm.endDate}
                    className={`${fieldClass} cursor-pointer`}
                    onClick={openDatePicker}
                    onChange={(event) => {
                      setEntryForm((current) => ({ ...current, endDate: event.target.value }));
                      setEntryErrors((current) => ({ ...current, endDate: "", endTime: "" }));
                    }}
                  />
                  <input
                    aria-label="Event end time"
                    type="time"
                    value={entryForm.endTime}
                    className={fieldClass}
                    onChange={(event) => {
                      setEntryForm((current) => ({ ...current, endTime: event.target.value }));
                      setEntryErrors((current) => ({ ...current, endTime: "" }));
                    }}
                  />
                  {entryErrors.endDate ? <p className="m-0 text-xs font-semibold text-rose-600">{entryErrors.endDate}</p> : null}
                  {entryErrors.endTime ? <p className="m-0 text-xs font-semibold text-rose-600">{entryErrors.endTime}</p> : null}
                </div>
              ) : null}
            </div>

            {isEventForm ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="dashboardCalendarAudience" className="text-sm font-semibold text-slate-700 dark:text-slate-200">Audience</label>
                  <select id="dashboardCalendarAudience" value={entryForm.audience} className={fieldClass} onChange={(event) => setEntryForm((current) => ({ ...current, audience: event.target.value }))}>
                    {EVENT_AUDIENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="dashboardCalendarLocation" className="text-sm font-semibold text-slate-700 dark:text-slate-200">Location</label>
                  <input
                    id="dashboardCalendarLocation"
                    value={entryForm.location}
                    maxLength={255}
                    className={fieldClass}
                    placeholder="e.g. Conference Room"
                    onChange={(event) => {
                      setEntryForm((current) => ({ ...current, location: event.target.value }));
                      setEntryErrors((current) => ({ ...current, location: "" }));
                    }}
                  />
                  {entryErrors.location ? <p className="m-0 text-xs font-semibold text-rose-600">{entryErrors.location}</p> : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="dashboardCalendarDetails" className="text-sm font-semibold text-slate-700 dark:text-slate-200">Details</label>
              <textarea
                id="dashboardCalendarDetails"
                rows={4}
                value={entryForm.description}
                className={`${fieldClass} resize-none py-2.5`}
                placeholder={isEventForm ? "Add the event agenda or important details" : "Share announcement details"}
                onChange={(event) => setEntryForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
          </div>
        </Modal>,
        document.body
      ) : null}
    </>
  );
}
