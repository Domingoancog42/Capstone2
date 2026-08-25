import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "react-hot-toast";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Pencil,
  Plus,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import Button from "../UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../UI/card";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const COLOR_TAGS = [
  {
    key: "emerald",
    label: "Forest Green",
    swatch: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
    chip: "border-emerald-100 bg-emerald-50/90 text-emerald-900 hover:bg-emerald-100",
    dot: "bg-emerald-500",
    glow: "shadow-[0_14px_28px_rgba(16,185,129,0.22)]",
  },
  {
    key: "amber",
    label: "Golden Yellow",
    swatch: "bg-amber-400",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    chip: "border-amber-100 bg-amber-50/90 text-amber-900 hover:bg-amber-100",
    dot: "bg-amber-400",
    glow: "shadow-[0_14px_28px_rgba(251,191,36,0.22)]",
  },
  {
    key: "sky",
    label: "Office Blue",
    swatch: "bg-sky-500",
    badge: "border-sky-200 bg-sky-50 text-sky-800",
    chip: "border-sky-100 bg-sky-50/90 text-sky-900 hover:bg-sky-100",
    dot: "bg-sky-500",
    glow: "shadow-[0_14px_28px_rgba(14,165,233,0.22)]",
  },
  {
    key: "red",
    label: "Priority Red",
    swatch: "bg-rose-500",
    badge: "border-rose-200 bg-rose-50 text-rose-800",
    chip: "border-rose-100 bg-rose-50/90 text-rose-900 hover:bg-rose-100",
    dot: "bg-rose-500",
    glow: "shadow-[0_14px_28px_rgba(244,63,94,0.22)]",
  },
  {
    key: "slate",
    label: "Local Gray",
    swatch: "bg-slate-400",
    badge: "border-slate-200 bg-slate-100 text-slate-700",
    chip: "border-slate-200 bg-slate-100/90 text-slate-800 hover:bg-slate-200",
    dot: "bg-slate-400",
    glow: "shadow-[0_14px_28px_rgba(148,163,184,0.18)]",
  },
];

const HOLIDAY_TYPES = ["Regular Holiday", "Special Holiday", "Local Holiday"];
const ANNOUNCEMENT_PRIORITIES = ["Low", "Medium", "High"];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function parseLocalDate(dateString) {
  const [year, month, day] = String(dateString || "")
    .split("-")
    .map((value) => Number(value));

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMonthYear(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDisplayDate(dateString) {
  const parsed = parseLocalDate(dateString);
  if (!parsed) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatDisplayRange(startDate, endDate) {
  if (!startDate) {
    return "Unknown date";
  }

  if (!endDate || startDate === endDate) {
    return formatDisplayDate(startDate);
  }

  return `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
}

function getHolidayDefaultColor(holidayType) {
  if (holidayType === "Special Holiday") {
    return "amber";
  }

  if (holidayType === "Local Holiday") {
    return "slate";
  }

  return "emerald";
}

function getAnnouncementDefaultColor(priority) {
  if (priority === "High") {
    return "red";
  }

  return "sky";
}

function resolveEventColorKey(entry) {
  if (entry?.colorTag) {
    return entry.colorTag;
  }

  if (entry?.kind === "holiday") {
    return getHolidayDefaultColor(entry.holidayType);
  }

  return getAnnouncementDefaultColor(entry.priority);
}

function getColorTheme(colorKey) {
  return COLOR_TAGS.find((tag) => tag.key === colorKey) || COLOR_TAGS[0];
}

function getEventTypeLabel(entry) {
  if (entry.kind === "holiday") {
    return entry.holidayType || "Holiday";
  }

  if (entry.priority === "High") {
    return "High Priority Announcement";
  }

  return "Announcement";
}

function sortEntriesLatestFirst(entries) {
  return [...entries].sort((left, right) => {
    const leftTime = new Date(left.createdAt || left.startDate).getTime();
    const rightTime = new Date(right.createdAt || right.startDate).getTime();

    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return String(right.startDate).localeCompare(String(left.startDate));
  });
}

function buildCalendarDays(viewDate, entries) {
  const monthStart = startOfMonth(viewDate);
  const firstCellDate = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    1 - monthStart.getDay()
  );
  const eventMap = new Map();

  entries.forEach((entry) => {
    const rangeStart = parseLocalDate(entry.startDate);
    const rangeEnd = parseLocalDate(entry.endDate || entry.startDate);

    if (!rangeStart || !rangeEnd) {
      return;
    }

    const current = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());

    while (current.getTime() <= rangeEnd.getTime()) {
      const key = formatDateKey(current);
      const dayEntries = eventMap.get(key) || [];
      dayEntries.push(entry);
      eventMap.set(key, dayEntries);
      current.setDate(current.getDate() + 1);
    }
  });

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      firstCellDate.getFullYear(),
      firstCellDate.getMonth(),
      firstCellDate.getDate() + index
    );
    const dateKey = formatDateKey(date);

    return {
      date,
      dateKey,
      isCurrentMonth: date.getMonth() === viewDate.getMonth(),
      events: sortEntriesLatestFirst(eventMap.get(dateKey) || []),
    };
  });
}

function createInitialFormState(mode, entry = null) {
  if (entry) {
    return {
      title: entry.title || "",
      startDate: entry.startDate || "",
      endDate: entry.endDate || entry.startDate || "",
      description: entry.description || "",
      holidayType: entry.holidayType || "Regular Holiday",
      priority: entry.priority || "Medium",
      colorTag: entry.colorTag || resolveEventColorKey(entry),
    };
  }

  if (mode === "announcement") {
    return {
      title: "",
      startDate: "",
      endDate: "",
      description: "",
      holidayType: "Regular Holiday",
      priority: "Medium",
      colorTag: getAnnouncementDefaultColor("Medium"),
    };
  }

  return {
    title: "",
    startDate: "",
    endDate: "",
    description: "",
    holidayType: "Regular Holiday",
    priority: "Medium",
    colorTag: getHolidayDefaultColor("Regular Holiday"),
  };
}

function CalendarLegendItem({ colorKey, label }) {
  const theme = getColorTheme(colorKey);

  return (
    <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
      <span className={`h-3 w-3 rounded-full ${theme.dot}`} />
      <span>{label}</span>
    </div>
  );
}

function ColorTagPicker({ value, onChange }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {COLOR_TAGS.map((option) => {
        const active = value === option.key;

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
              active
                ? `${option.badge} shadow-sm`
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span className={`h-4 w-4 rounded-full ${option.swatch}`} />
            <span className="text-sm font-semibold">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function GlassModal({ open, title, description, children, onClose, variant = "glass" }) {
  const isPlain = variant === "plain";

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-4">
          <motion.button
            type="button"
            aria-label="Close modal overlay"
            className={`absolute inset-0 backdrop-blur-sm ${isPlain ? "bg-slate-950/55" : "bg-slate-950/45"}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={`relative z-10 w-full max-w-2xl overflow-hidden shadow-2xl ${
              isPlain
                ? "rounded-2xl border border-white/60 bg-white"
                : "rounded-[1.9rem] border border-white/55 bg-white/70 shadow-[0_30px_90px_rgba(15,23,42,0.25)] backdrop-blur-2xl"
            }`}
          >
            <div
              className={`px-5 py-4 sm:px-4 ${
                isPlain
                  ? "border-b border-slate-200 bg-white"
                  : "bg-[linear-gradient(135deg,rgba(16,185,129,0.16)_0%,rgba(245,158,11,0.12)_50%,rgba(14,165,233,0.10)_100%)]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className={`m-0 font-semibold text-slate-950 ${isPlain ? "text-lg" : "text-xl"}`}>{title}</h2>
                  {description ? (
                    <p className={`m-0 mt-1 text-sm ${isPlain ? "text-slate-500" : "leading-6 text-slate-600"}`}>{description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className={`grid shrink-0 place-items-center border bg-white text-slate-600 transition hover:bg-slate-50 ${
                    isPlain
                      ? "h-9 w-9 rounded-xl border-slate-200"
                      : "h-10 w-10 rounded-2xl border-white/60"
                  }`}
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            <div className={`overflow-y-auto px-5 py-5 sm:px-4 ${isPlain ? "max-h-[72vh]" : "max-h-[78vh] sm:py-4"}`}>
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

function EventEditorModal({ open, mode, entry, onClose, onSave }) {
  const [form, setForm] = useState(() => createInitialFormState(mode, entry));
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(createInitialFormState(mode, entry));
    setErrors({});
  }, [entry, mode, open]);

  const inputClasses = "min-h-[48px] w-full rounded-2xl border border-slate-200 bg-white/90 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
  const textareaClasses = "min-h-[124px] w-full rounded-2xl border border-slate-200 bg-white/90 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

  const updateField = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
    setErrors((current) => ({
      ...current,
      [field]: "",
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = {};

    if (!form.title.trim()) {
      nextErrors.title = "Title is required.";
    }

    if (!form.startDate) {
      nextErrors.startDate = mode === "holiday" ? "Holiday date is required." : "Start date is required.";
    }

    if (mode === "announcement" && !form.endDate) {
      nextErrors.endDate = "End date is required.";
    }

    if (
      mode === "announcement"
      && form.startDate
      && form.endDate
      && parseLocalDate(form.endDate)?.getTime() < parseLocalDate(form.startDate)?.getTime()
    ) {
      nextErrors.endDate = "End date must not be earlier than start date.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onSave({
      ...entry,
      kind: mode,
      title: form.title.trim(),
      startDate: form.startDate,
      endDate: mode === "holiday" ? form.startDate : form.endDate,
      description: form.description.trim(),
      holidayType: mode === "holiday" ? form.holidayType : undefined,
      priority: mode === "announcement" ? form.priority : undefined,
      colorTag: form.colorTag,
    });
  };

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={`${entry ? "Edit" : "Add"} ${mode === "holiday" ? "Holiday" : "Announcement"}`}
      description={
        mode === "holiday"
          ? "Capture official holiday details and tag them with a visible calendar color."
          : "Publish an internal announcement across a selected date range with priority tagging."
      }
      variant="plain"
    >
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              {mode === "holiday" ? "Holiday Title" : "Announcement Title"}
            </label>
            <input
              value={form.title}
              onChange={updateField("title")}
              className={inputClasses}
              placeholder={mode === "holiday" ? "Enter holiday title" : "Enter announcement title"}
            />
            {errors.title ? <p className="m-0 mt-1.5 text-xs font-medium text-rose-700">{errors.title}</p> : null}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              {mode === "holiday" ? "Holiday Date" : "Start Date"}
            </label>
            <input
              type="date"
              value={form.startDate}
              onChange={updateField("startDate")}
              className={inputClasses}
            />
            {errors.startDate ? <p className="m-0 mt-1.5 text-xs font-medium text-rose-700">{errors.startDate}</p> : null}
          </div>

          {mode === "announcement" ? (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">End Date</label>
              <input
                type="date"
                value={form.endDate}
                onChange={updateField("endDate")}
                className={inputClasses}
              />
              {errors.endDate ? <p className="m-0 mt-1.5 text-xs font-medium text-rose-700">{errors.endDate}</p> : null}
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Holiday Type</label>
              <select
                value={form.holidayType}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setForm((current) => ({
                    ...current,
                    holidayType: nextType,
                    colorTag: getHolidayDefaultColor(nextType),
                  }));
                }}
                className={inputClasses}
              >
                {HOLIDAY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === "announcement" ? (
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Priority</label>
              <select
                value={form.priority}
                onChange={(event) => {
                  const nextPriority = event.target.value;
                  setForm((current) => ({
                    ...current,
                    priority: nextPriority,
                    colorTag: getAnnouncementDefaultColor(nextPriority),
                  }));
                }}
                className={inputClasses}
              >
                {ANNOUNCEMENT_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Description</label>
            <textarea
              value={form.description}
              onChange={updateField("description")}
              className={textareaClasses}
              placeholder={
                mode === "holiday"
                  ? "Share the holiday purpose or office scheduling note"
                  : "Share the announcement details for employees"
              }
            />
          </div>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Tag size={16} />
              <span>Color Tag Picker</span>
            </div>
            <ColorTagPicker
              value={form.colorTag}
              onChange={(colorTag) =>
                setForm((current) => ({
                  ...current,
                  colorTag,
                }))
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            {entry ? "Save Changes" : mode === "holiday" ? "Add Holiday" : "Add Announcement"}
          </Button>
        </div>
      </form>
    </GlassModal>
  );
}

function EventDetailsModal({ entry, onClose, onEdit, onDelete }) {
  if (!entry) {
    return null;
  }

  const theme = getColorTheme(resolveEventColorKey(entry));

  return (
    <GlassModal
      open={Boolean(entry)}
      onClose={onClose}
      title={entry.title}
      description="Calendar event details"
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${theme.badge}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${theme.dot}`} />
            {getEventTypeLabel(entry)}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
            {entry.kind === "holiday" ? "Holiday" : "Announcement"}
          </span>
        </div>

        <div className="grid gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-5">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Date</p>
            <p className="m-0 mt-2 text-sm font-semibold text-slate-900">
              {formatDisplayRange(entry.startDate, entry.endDate)}
            </p>
          </div>
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Description</p>
            <p className="m-0 mt-2 text-sm leading-7 text-slate-600">
              {entry.description || "No description added for this calendar entry yet."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
          <Button
            type="button"
            variant="secondary"
            icon={Pencil}
            onClick={() => onEdit(entry)}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="danger"
            icon={Trash2}
            onClick={() => onDelete(entry.id)}
          >
            Delete
          </Button>
        </div>
      </div>
    </GlassModal>
  );
}

function EmptyEventFeed() {
  return (
    <div className="rounded-[1.7rem] border border-dashed border-slate-200 bg-slate-50/90 px-5 py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 shadow-sm">
        <CalendarDays size={22} />
      </div>
      <p className="m-0 mt-4 text-base font-semibold text-slate-900">No events yet</p>
      <p className="m-0 mt-2 text-sm leading-6 text-slate-500">
        Add a holiday or announcement to populate the calendar and the event feed.
      </p>
    </div>
  );
}

export default function CalendarManagementBoard() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewDate, setViewDate] = useState(() => startOfMonth(today));
  const [entries, setEntries] = useState([]);
  const [editorState, setEditorState] = useState({
    open: false,
    mode: "holiday",
    entry: null,
  });
  const [selectedEntry, setSelectedEntry] = useState(null);

  const calendarDays = useMemo(
    () => buildCalendarDays(viewDate, entries),
    [entries, viewDate]
  );
  const sortedEntries = useMemo(
    () => sortEntriesLatestFirst(entries),
    [entries]
  );

  const handleSaveEntry = (nextEntry) => {
    const isEditing = Boolean(nextEntry.id);
    const nowIso = new Date().toISOString();

    setEntries((current) => {
      if (isEditing) {
        return current.map((entry) => (
          entry.id === nextEntry.id
            ? {
                ...entry,
                ...nextEntry,
                createdAt: entry.createdAt || nowIso,
              }
            : entry
        ));
      }

      return [
        {
          ...nextEntry,
          id: `${nextEntry.kind}-${Date.now()}`,
          createdAt: nowIso,
        },
        ...current,
      ];
    });

    if (selectedEntry?.id === nextEntry.id) {
      setSelectedEntry((current) => (current ? { ...current, ...nextEntry } : current));
    }

    setEditorState({ open: false, mode: "holiday", entry: null });
    toast.success(
      isEditing
        ? `${nextEntry.kind === "holiday" ? "Holiday" : "Announcement"} updated successfully.`
        : `${nextEntry.kind === "holiday" ? "Holiday" : "Announcement"} added to the calendar.`
    );
  };

  const handleDeleteEntry = (entryId) => {
    const deletedEntry = entries.find((entry) => entry.id === entryId);

    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    setSelectedEntry((current) => (current?.id === entryId ? null : current));
    toast.success(
      deletedEntry?.kind === "holiday"
        ? "Holiday removed from the calendar."
        : "Announcement removed from the calendar."
    );
  };

  return (
    <div className="grid gap-4">

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_380px]">
        <div className="grid gap-4">
          <Card className="relative overflow-visible border-slate-200 shadow-[0_24px_60px_rgba(15,23,42,0.10)]">
            <div className="rounded-t-2xl border-b border-slate-200 bg-white/92 backdrop-blur-xl">
              <div className="relative px-5 py-5 sm:px-4">
                <div className="flex flex-wrap justify-end gap-3">
                  <Button
                    icon={Plus}
                    onClick={() => setEditorState({ open: true, mode: "holiday", entry: null })}
                  >
                    Add Holiday
                  </Button>
                  <Button
                    variant="secondary"
                    icon={Megaphone}
                    onClick={() => setEditorState({ open: true, mode: "announcement", entry: null })}
                  >
                    Add Announcement
                  </Button>
                </div>

                <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={ChevronLeft}
                      onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setViewDate(startOfMonth(today))}
                    >
                      Today
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={ChevronRight}
                      onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                    >
                      Next
                    </Button>
                  </div>

                  <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm">
                    {formatMonthYear(viewDate)}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4">
                  <CalendarLegendItem colorKey="emerald" label="Green = Regular Holiday" />
                  <CalendarLegendItem colorKey="amber" label="Yellow = Special Holiday" />
                  <CalendarLegendItem colorKey="sky" label="Blue = Announcement" />
                  <CalendarLegendItem colorKey="red" label="Red = High Priority Announcement" />
                  <CalendarLegendItem colorKey="slate" label="Gray = Local Event" />
                </div>
              </div>

              <div className="grid grid-cols-7 border-t border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-2 py-2">
                {WEEKDAY_LABELS.map((label) => (
                  <div
                    key={label}
                    className="px-2 py-2 text-center text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500"
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <CardContent className="relative p-0">
              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const isToday = formatDateKey(day.date) === formatDateKey(today);

                  return (
                    <div
                      key={day.dateKey}
                      className={`min-h-[148px] border-b border-r border-slate-200 p-3 transition ${
                        day.isCurrentMonth ? "bg-white/90" : "bg-slate-50/80"
                      } ${isToday ? "bg-emerald-50/60" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`grid h-8 w-8 place-items-center rounded-full text-sm font-semibold ${
                            isToday
                              ? "bg-emerald-700 text-white shadow-md"
                              : day.isCurrentMonth
                                ? "text-slate-900"
                                : "text-slate-400"
                          }`}
                        >
                          {day.date.getDate()}
                        </span>
                        {day.events.length ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {day.events.length} item{day.events.length > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {day.events.slice(0, 3).map((entry) => {
                          const theme = getColorTheme(resolveEventColorKey(entry));

                          return (
                            <button
                              key={`${day.dateKey}-${entry.id}`}
                              type="button"
                              onClick={() => setSelectedEntry(entry)}
                              className={`group relative flex w-full items-center gap-2 rounded-2xl border px-2.5 py-2 text-left text-[11px] font-semibold transition ${theme.chip}`}
                            >
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${theme.dot}`} />
                              <span className="truncate">{entry.title}</span>

                              <div className="pointer-events-none absolute left-0 top-full z-20 hidden w-60 rounded-2xl border border-slate-200 bg-white/95 p-3 text-left shadow-2xl group-hover:block">
                                <p className="m-0 text-xs font-semibold text-slate-900">{entry.title}</p>
                                <p className="m-0 mt-1 text-[11px] font-medium text-slate-500">
                                  {formatDisplayRange(entry.startDate, entry.endDate)}
                                </p>
                                <p className="m-0 mt-2 line-clamp-3 text-[11px] leading-5 text-slate-600">
                                  {entry.description || "No description added."}
                                </p>
                              </div>
                            </button>
                          );
                        })}

                        {day.events.length > 3 ? (
                          <div className="w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-semibold text-slate-500">
                            +{day.events.length - 3} more event{day.events.length - 3 > 1 ? "s" : ""}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

        </div>

        <div className="grid gap-4">
          <Card className="border-slate-200 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
            <CardHeader>
              <CardTitle>Event List</CardTitle>
              <CardDescription>
                Newly created holidays and announcements appear here automatically, sorted latest first.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {sortedEntries.length ? (
                sortedEntries.map((entry) => {
                  const theme = getColorTheme(resolveEventColorKey(entry));

                  return (
                    <article
                      key={entry.id}
                      className={`rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${theme.glow}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setSelectedEntry(entry)}
                            className="block text-left text-base font-semibold text-slate-900 transition hover:text-emerald-800"
                          >
                            {entry.title}
                          </button>
                          <p className="m-0 mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                            {formatDisplayRange(entry.startDate, entry.endDate)}
                          </p>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${theme.badge}`}>
                          <span className={`h-2.5 w-2.5 rounded-full ${theme.dot}`} />
                          {getEventTypeLabel(entry)}
                        </span>
                      </div>

                      <p className="m-0 mt-3 text-sm leading-6 text-slate-600">
                        {entry.description || "No description provided for this event."}
                      </p>

                      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Pencil}
                          onClick={() => setEditorState({ open: true, mode: entry.kind, entry })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={Trash2}
                          onClick={() => handleDeleteEntry(entry.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <EmptyEventFeed />
              )}

            </CardContent>
          </Card>
        </div>
      </div>

      <EventEditorModal
        open={editorState.open}
        mode={editorState.mode}
        entry={editorState.entry}
        onClose={() => setEditorState({ open: false, mode: "holiday", entry: null })}
        onSave={handleSaveEntry}
      />

      <EventDetailsModal
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
        onEdit={(entry) => {
          setSelectedEntry(null);
          setEditorState({ open: true, mode: entry.kind, entry });
        }}
        onDelete={handleDeleteEntry}
      />
    </div>
  );
}
