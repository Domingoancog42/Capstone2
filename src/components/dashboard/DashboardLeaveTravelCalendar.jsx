import React, { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { toast } from "react-hot-toast";
import { CalendarClock, CalendarDays, ExternalLink, Mail, Megaphone, PartyPopper, Phone, Plane, Plus } from "lucide-react";
import Button from "../UI/button";
import Modal from "../UI/modal";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { formatDateDisplay, normalizeLeaveStatus } from "../../utils/leaveHelpers";
import {
  DATE_PORTION_SHORT_LABELS,
  formatSelectedDatesSummary,
  unpackSelectedDates,
} from "../../utils/dateSelection";
import { getLeaveReasonDisplay, unpackLeaveReason } from "../../utils/leaveRequestDetails";

const ACTIVITY_META = {
  leave: {
    label: "Leave",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
    text: "#1d4ed8",
    icon: CalendarDays,
  },
  travel: {
    label: "Travel Order",
    color: "#f59e0b",
    bg: "#fffbeb",
    border: "#fde68a",
    text: "#b45309",
    icon: Plane,
  },
  announcement: {
    label: "Announcement",
    color: "#7c3aed",
    bg: "#f5f3ff",
    border: "#ddd6fe",
    text: "#6d28d9",
    icon: Megaphone,
  },
  event: {
    label: "Event",
    color: "#0891b2",
    bg: "#ecfeff",
    border: "#a5f3fc",
    text: "#0e7490",
    icon: CalendarClock,
  },
  /*
   * Regular holidays and special days are kept apart rather than sharing one "Holiday" colour: a
   * regular holiday is a paid day off and a special working day is an ordinary day at work, and
   * anyone reading the calendar to plan a filing is reading it for exactly that difference.
   */
  holiday: {
    label: "Regular Holiday",
    color: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
    text: "#b91c1c",
    icon: PartyPopper,
  },
  special_day: {
    label: "Special Day",
    color: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    text: "#047857",
    icon: PartyPopper,
  },
};

/** Which of the two holiday legend entries a row from holiday.php belongs under. */
function holidayActivityKey(holiday) {
  return String(holiday?.type || "regular") === "regular" ? "holiday" : "special_day";
}

const emptyAnnouncementForm = {
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

function openDatePicker(event) {
  event.currentTarget.showPicker?.();
}

function firstText(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function formatTimeDisplay(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);

  if (!match) {
    return "N/A";
  }

  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]));
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isSameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function normalizeLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveEmployeeInitials(employee) {
  const name = String(employee?.fullName || employee?.employeeName || employee?.firstName || employee?.email || "Employee").trim();
  const parts = name.split(/\s+/).filter(Boolean);

  return (parts.length ? parts : ["Employee"])
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function buildEmployeeLookup(employees = []) {
  const lookup = new Map();

  employees.forEach((employee) => {
    [
      employee?.id,
      employee?.employeeRecordId,
      employee?.employeeId,
      employee?.email,
      employee?.fullName,
      employee?.employeeName,
    ].forEach((value) => {
      const key = normalizeLookupValue(value);
      if (key) {
        lookup.set(key, employee);
      }
    });
  });

  return lookup;
}

function resolveEmployeeForRecord(record, employeeLookup) {
  const matchedEmployee = [
    record?.employeeRecordId,
    record?.employeeId,
    record?.employeeEmail,
    record?.email,
    record?.employeeName,
  ]
    .map((value) => employeeLookup.get(normalizeLookupValue(value)))
    .find(Boolean);

  return {
    ...(matchedEmployee || {}),
    employeeRecordId: record?.employeeRecordId || matchedEmployee?.id || matchedEmployee?.employeeRecordId || "",
    employeeId: record?.employeeId || matchedEmployee?.employeeId || "",
    fullName: matchedEmployee?.fullName || record?.employeeName || record?.fullName || "",
    employeeName: record?.employeeName || matchedEmployee?.fullName || "",
    position: matchedEmployee?.position || record?.position || "",
    division: matchedEmployee?.department || matchedEmployee?.division || record?.division || "",
    department: matchedEmployee?.department || matchedEmployee?.division || record?.division || "",
    email: matchedEmployee?.email || record?.employeeEmail || record?.email || "",
    phone: matchedEmployee?.phone || record?.phone || record?.contactNumber || "",
    profileImage: matchedEmployee?.profileImage || matchedEmployee?.profile_image || record?.profileImage || record?.profile_image || "",
  };
}

function buildEventFromRecord(record, type, employeeLookup) {
  const status = normalizeLeaveStatus(record?.status);
  const startDate = firstText(record?.startDate);
  const endDate = firstText(record?.endDate, record?.startDate);

  if (status !== "Approved" || !startDate) {
    return [];
  }

  const meta = ACTIVITY_META[type] || ACTIVITY_META.leave;
  const employee = resolveEmployeeForRecord(record, employeeLookup);
  const activityType = type === "travel" ? "Travel Order" : firstText(record?.leaveType, "Leave");
  const detail = type === "travel"
    ? firstText(record?.destination, record?.purpose, "Travel Order")
    : firstText(getLeaveReasonDisplay(record?.reason, record?.leaveType), record?.leaveType, "Leave");
  /*
   * Leave carries its picked days inside its own richer metadata; travel orders keep theirs behind
   * the shared marker in remarks. Either way the calendar paints the days that were actually named.
   */
  const leaveDays = type === "leave"
    ? unpackLeaveReason(record?.reason).details.leaveDays
    : unpackSelectedDates(record?.remarks).dates;
  const identity = record?.id || record?.requestId || employee.employeeRecordId || employee.employeeId || startDate;
  const title = `${employee.fullName || "Employee"} - ${activityType}`;

  const baseEvent = {
    title,
    allDay: true,
    backgroundColor: meta.color,
    borderColor: meta.color,
    textColor: "#ffffff",
    extendedProps: {
      type,
      activityLabel: meta.label,
      activityType,
      status,
      startDate,
      endDate,
      selectedDates: formatSelectedDatesSummary(leaveDays),
      detail,
      employee,
      record,
      color: meta.color,
    },
  };

  /*
   * A leave request covers the days it actually named, which can skip working days inside its span,
   * so each picked day is painted on its own instead of shading the whole range. A request filed as
   * a plain range still paints as one continuous block.
   */
  if (leaveDays.length > 0) {
    return leaveDays.map((day) => ({
      ...baseEvent,
      id: `${type}-${identity}-${day.date}`,
      title: day.portion === "whole" ? title : `${title} (${DATE_PORTION_SHORT_LABELS[day.portion]})`,
      start: day.date,
      end: addDays(day.date, 1),
    }));
  }

  return [{
    ...baseEvent,
    id: `${type}-${identity}`,
    start: startDate,
    end: endDate ? addDays(endDate, 1) : undefined,
  }];
}

function buildEventFromAnnouncement(announcement) {
  const startDate = firstText(announcement?.startDate);
  const endDate = firstText(announcement?.endDate, announcement?.startDate);

  if (!startDate) {
    return null;
  }

  const entryType = announcement?.entryType === "event" ? "event" : "announcement";
  const meta = ACTIVITY_META[entryType];
  const startTime = firstText(announcement?.startTime);
  const endTime = firstText(announcement?.endTime);
  const isTimedEvent = entryType === "event" && Boolean(startTime);

  return {
    // Prefixed because leave and travel events are keyed the same way and ids must not collide.
    id: `${entryType}-${announcement?.id || `${startDate}-${announcement?.title || ""}`}`,
    title: announcement?.title || (entryType === "event" ? "Event" : "Announcement"),
    start: isTimedEvent ? `${startDate}T${startTime}` : startDate,
    end: isTimedEvent && endDate && endTime ? `${endDate}T${endTime}` : (endDate ? addDays(endDate, 1) : undefined),
    allDay: !isTimedEvent,
    backgroundColor: meta.color,
    borderColor: meta.color,
    textColor: "#ffffff",
    extendedProps: {
      type: entryType,
      activityLabel: meta.label,
      activityType: entryType === "event" ? "Event" : "Announcement",
      status: entryType === "event" ? "Scheduled" : "Published",
      startDate,
      endDate,
      startTime,
      endTime,
      audience: announcement?.audience || "all",
      audienceLabel: announcement?.audienceLabel || "All Users",
      location: announcement?.location || "",
      detail: announcement?.description || "No details added.",
      record: announcement,
      color: meta.color,
    },
  };
}

/**
 * A holiday from holiday.php.
 *
 * Single-day by definition, so there is no range to expand -- the server already resolved recurring
 * rows onto the year being shown, and the national list it generates is per-year to begin with.
 */
function buildEventFromHoliday(holiday) {
  const date = firstText(holiday?.date);

  if (!date) {
    return null;
  }

  const activityKey = holidayActivityKey(holiday);
  const meta = ACTIVITY_META[activityKey];

  return {
    // Prefixed and dated because a recurring stored row repeats its numeric id across years.
    id: `holiday-${holiday?.key || `${holiday?.id || ""}-${date}`}`,
    title: holiday?.name || "Holiday",
    start: date,
    end: addDays(date, 1),
    allDay: true,
    backgroundColor: meta.color,
    borderColor: meta.color,
    textColor: "#ffffff",
    extendedProps: {
      type: "holiday",
      activityLabel: meta.label,
      activityType: holiday?.typeLabel || meta.label,
      // "National" vs "Office-declared" is what tells a reader whether HR can change this entry.
      status: holiday?.source === "national" ? "National" : "Office-declared",
      startDate: date,
      endDate: date,
      detail: holiday?.description || `${holiday?.typeLabel || meta.label} observed nationwide.`,
      record: holiday,
      color: meta.color,
    },
  };
}

function DetailRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className="m-0 mt-1 text-sm font-semibold text-slate-900">{value || "N/A"}</dd>
    </div>
  );
}

/**
 * The detail panel for an event that belongs to the office rather than to a person -- an
 * announcement or a holiday. The employee panel below it has nobody to show for either.
 *
 * Colours come from the event's own ACTIVITY_META entry instead of being written into the classes,
 * so a regular holiday reads red and a special day green without a second copy of this markup.
 */
function OfficeEventDetails({ title, props, detailLabel }) {
  const meta = ACTIVITY_META[props.type === "holiday" ? holidayActivityKey(props.record) : props.type]
    || ACTIVITY_META.announcement;
  const Icon = meta.icon;
  const isEvent = props.type === "event";
  const isSingleDay = !props.endDate || props.endDate === props.startDate;

  return (
    <div className="space-y-5">
      <div
        className="calendar-activity-tone rounded-2xl border p-4"
        style={{ "--activity-color": meta.color, borderColor: meta.border, backgroundColor: meta.bg }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
            style={{ backgroundColor: meta.color }}
          >
            <Icon size={19} aria-hidden="true" />
          </div>
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">{title}</h3>
            <p className="m-0 mt-1 text-sm text-slate-600">
              {isEvent
                ? `${formatDateDisplay(props.startDate)}, ${formatTimeDisplay(props.startTime)} - ${isSingleDay ? "" : `${formatDateDisplay(props.endDate)}, `}${formatTimeDisplay(props.endTime)}`
                : isSingleDay
                  ? formatDateDisplay(props.startDate)
                  : `${formatDateDisplay(props.startDate)} - ${formatDateDisplay(props.endDate)}`}
            </p>
          </div>
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <DetailRow label="Activity Type" value={props.activityType} />
        <DetailRow label="Status" value={props.status} />
        <DetailRow label="Start Date" value={formatDateDisplay(props.startDate)} />
        <DetailRow label="End Date" value={formatDateDisplay(props.endDate)} />
        {isEvent ? <DetailRow label="Start Time" value={formatTimeDisplay(props.startTime)} /> : null}
        {isEvent ? <DetailRow label="End Time" value={formatTimeDisplay(props.endTime)} /> : null}
        {isEvent ? <DetailRow label="Audience" value={props.audienceLabel} /> : null}
        {isEvent ? <DetailRow label="Location" value={props.location} /> : null}
      </dl>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{detailLabel}</p>
        <p className="m-0 mt-2 text-sm leading-6 text-slate-700">{props.detail}</p>
      </div>
    </div>
  );
}

function EventContent({ event }) {
  const props = event.extendedProps || {};
  const employee = props.employee || {};
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);
  // Announcements and holidays belong to the office, not to a person, so they carry no avatar.
  const isPersonEvent = props.type === "leave" || props.type === "travel";

  return (
    <div className={`flex min-w-0 items-center gap-1.5 px-1 py-0.5 leading-tight ${isPersonEvent ? "min-h-[28px]" : ""}`}>
      {isPersonEvent ? (
        <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full border border-white/70 bg-white/20 text-[8px] font-bold text-white shadow-sm">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={employee.fullName || employee.employeeName || "Employee"}
              className="h-full w-full object-cover"
            />
          ) : (
            resolveEmployeeInitials(employee)
          )}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-bold">{isPersonEvent ? (employee.fullName || event.title) : event.title}</div>
        <div className="truncate text-[10px] opacity-95">
          {props.activityType} - {props.status}
        </div>
      </div>
    </div>
  );
}

function DayCellContent(dayInfo) {
  const isToday = isSameCalendarDay(dayInfo.date, new Date());

  return (
    <span className="dashboard-leave-travel-calendar-day-label">
      <span>{dayInfo.dayNumberText}</span>
      {isToday ? <span className="dashboard-leave-travel-calendar-today-badge">Today</span> : null}
    </span>
  );
}

export default function DashboardLeaveTravelCalendar({
  leaveRequests = [],
  travelOrders = [],
  announcements = [],
  holidays = [],
  employees = [],
  loading = false,
  onViewEmployeeProfile,
  onSaveAnnouncement,
  showLegend = true,
  compact = false,
  className = "",
}) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState(emptyAnnouncementForm);
  const [announcementErrors, setAnnouncementErrors] = useState({});
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const employeeLookup = useMemo(() => buildEmployeeLookup(employees), [employees]);
  const calendarEvents = useMemo(() => [
    // Holidays first so they render above the day's leave and travel entries.
    ...holidays.map((holiday) => buildEventFromHoliday(holiday)),
    ...leaveRequests.flatMap((record) => buildEventFromRecord(record, "leave", employeeLookup)),
    ...travelOrders.flatMap((record) => buildEventFromRecord(record, "travel", employeeLookup)),
    ...announcements.map((announcement) => buildEventFromAnnouncement(announcement)),
  ].filter(Boolean), [announcements, employeeLookup, holidays, leaveRequests, travelOrders]);
  const selectedProps = selectedEvent?.extendedProps || {};
  const selectedEmployee = selectedProps.employee || {};
  const selectedRecord = selectedProps.record || {};
  const avatarUrl = resolveBackendAssetUrl(selectedEmployee.profileImage);
  const isSelectedPersonEvent = selectedProps.type === "leave" || selectedProps.type === "travel";
  const canViewFullProfile = Boolean(onViewEmployeeProfile && (selectedEmployee.employeeRecordId || selectedEmployee.id));
  const canAddAnnouncement = typeof onSaveAnnouncement === "function";
  const isEventForm = announcementForm.entryType === "event";

  const closeAnnouncementModal = () => {
    setAnnouncementModalOpen(false);
    setAnnouncementForm(emptyAnnouncementForm);
    setAnnouncementErrors({});
  };

  const handleAnnouncementSubmit = async () => {
    const nextErrors = {};

    if (!announcementForm.title.trim()) {
      nextErrors.title = `${isEventForm ? "Event" : "Announcement"} title is required.`;
    }

    if (!announcementForm.startDate) {
      nextErrors.startDate = `${isEventForm ? "Event start" : "Announcement"} date is required.`;
    }

    if (isEventForm && !announcementForm.startTime) {
      nextErrors.startTime = "Start time is required.";
    }

    if (isEventForm && !announcementForm.endDate) {
      nextErrors.endDate = "End date is required.";
    }

    if (isEventForm && !announcementForm.endTime) {
      nextErrors.endTime = "End time is required.";
    }

    if (
      isEventForm
      && announcementForm.startDate
      && announcementForm.startTime
      && announcementForm.endDate
      && announcementForm.endTime
      && `${announcementForm.endDate}T${announcementForm.endTime}` <= `${announcementForm.startDate}T${announcementForm.startTime}`
    ) {
      nextErrors.endTime = "Event end must be after its start.";
    }

    if (isEventForm && !announcementForm.location.trim()) {
      nextErrors.location = "Event location is required.";
    }

    setAnnouncementErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    /*
     * The modal stays open until the announcement is actually stored. Closing on click alone was
     * safe while these lived in localStorage; now the publish can be refused by the server, and
     * closing anyway would report success for a notice nobody else will ever see.
     */
    setAnnouncementSaving(true);

    try {
      await onSaveAnnouncement?.({
        entryType: announcementForm.entryType,
        title: announcementForm.title.trim(),
        startDate: announcementForm.startDate,
        endDate: isEventForm ? announcementForm.endDate : announcementForm.startDate,
        startTime: isEventForm ? announcementForm.startTime : "",
        endTime: isEventForm ? announcementForm.endTime : "",
        audience: isEventForm ? announcementForm.audience : "all",
        location: isEventForm ? announcementForm.location.trim() : "",
        description: announcementForm.description.trim(),
      });

      toast.success(isEventForm ? "Event created on the calendar." : "Announcement published to the calendar.");
      closeAnnouncementModal();
    } catch (error) {
      const message = error?.response?.data?.message || `Unable to create the ${isEventForm ? "event" : "announcement"}.`;

      setAnnouncementErrors({ form: message });
      toast.error(message);
    } finally {
      setAnnouncementSaving(false);
    }
  };

  return (
    <section
      className={`dashboard-leave-travel-calendar ${compact ? "dashboard-leave-travel-calendar--compact" : ""} rounded-2xl border border-slate-200 bg-white ${compact ? "p-3" : "p-4"} shadow-sm ${className}`.trim()}
    >
      <div className={`${compact ? "mb-2" : "mb-4"} flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between`}>
        <div>
          <h2 className={`m-0 font-semibold text-slate-950 ${compact ? "text-[13px]" : "text-lg"}`}>Calendar</h2>
          {!compact ? (
            <p className="m-0 mt-1 text-sm text-slate-500">
              Philippine holidays, announcements, approved employee leave, and travel orders for the month.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canAddAnnouncement ? (
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() => setAnnouncementModalOpen(true)}
            >
              Create Event/Announcement
            </Button>
          ) : null}
          {showLegend ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(ACTIVITY_META).map(([key, meta]) => (
                <span
                  key={key}
                  className={`calendar-activity-tone inline-flex items-center gap-2 rounded-full border font-semibold ${compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs"}`}
                  style={{ "--activity-color": meta.color, borderColor: meta.border, backgroundColor: meta.bg, color: meta.text }}
                >
                  <span className={`${compact ? "h-2 w-2" : "h-2.5 w-2.5"} rounded-full`} style={{ backgroundColor: meta.color }} />
                  {meta.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className={compact ? "min-h-[220px]" : "min-h-[520px]"}>
        {loading ? (
          <div className={`grid ${compact ? "h-[220px]" : "h-[520px]"} place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50`}>
            <p className="m-0 text-sm font-semibold text-slate-500">Loading approved schedules...</p>
          </div>
        ) : (
          /*
           * Month grid only. The Week and Day buttons switched to time-grid views, which lay events
           * out against an hourly axis -- and every event here is an all-day one (a leave day, a
           * holiday, an announcement that runs for a week), so those views had nothing to put on the
           * axis and only made the same rows harder to read. Dropping them takes timeGridPlugin,
           * `nowIndicator` (time-grid only) and `navLinks` (which navigated to the day view that no
           * longer exists) with them.
           */
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: "",
              center: "title",
              right: compact ? "prev,next" : "prev,next today",
            }}
            buttonText={{ today: "Today" }}
            events={calendarEvents}
            eventClick={(clickInfo) => setSelectedEvent(clickInfo.event)}
            eventContent={(contentInfo) => <EventContent event={contentInfo.event} />}
            dayCellContent={(dayInfo) => <DayCellContent {...dayInfo} />}
            height={compact ? 220 : "auto"}
            dayMaxEvents={compact ? 1 : 3}
          />
        )}
      </div>

      <Modal
        open={Boolean(selectedEvent)}
        title={selectedProps.activityType || "Calendar Event"}
        maxWidth="max-w-[860px]"
        onClose={() => setSelectedEvent(null)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setSelectedEvent(null)}>
              Close
            </Button>
            {isSelectedPersonEvent ? (
              <Button
                variant="primary"
                icon={ExternalLink}
                disabled={!canViewFullProfile}
                onClick={() => {
                  if (!canViewFullProfile) {
                    return;
                  }

                  setSelectedEvent(null);
                  onViewEmployeeProfile(selectedEmployee);
                }}
              >
                View Full Profile
              </Button>
            ) : null}
          </>
        )}
      >
        {selectedEvent ? (
          ["announcement", "event", "holiday"].includes(selectedProps.type) ? (
            <OfficeEventDetails
              title={selectedEvent.title}
              props={selectedProps}
              detailLabel={selectedProps.type === "holiday" ? "Holiday Details" : selectedProps.type === "event" ? "Event Details" : "Announcement Details"}
            />
          ) : (
            <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                <div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-slate-200 text-lg font-bold text-slate-500 shadow-sm">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={selectedEmployee.fullName || "Employee profile"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>{resolveEmployeeInitials(selectedEmployee)}</span>
                  )}
                </div>
                <h3 className="m-0 mt-4 text-base font-semibold text-slate-950">
                  {selectedEmployee.fullName || selectedEmployee.employeeName || "Employee"}
                </h3>
                <p className="m-0 mt-1 text-sm text-slate-500">{selectedEmployee.position || "Position unavailable"}</p>
                <span
                  className="calendar-activity-tone mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    "--activity-color": ACTIVITY_META[selectedProps.type]?.color,
                    borderColor: ACTIVITY_META[selectedProps.type]?.border,
                    backgroundColor: ACTIVITY_META[selectedProps.type]?.bg,
                    color: ACTIVITY_META[selectedProps.type]?.text,
                  }}
                >
                  {selectedProps.activityLabel}
                </span>
              </div>

              <div className="space-y-5">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <DetailRow label="Employee ID" value={selectedEmployee.employeeId} />
                  <DetailRow label="Name" value={selectedEmployee.fullName || selectedEmployee.employeeName} />
                  <DetailRow label="Position" value={selectedEmployee.position} />
                  <DetailRow label="Division" value={selectedEmployee.division || selectedEmployee.department} />
                </dl>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    <Mail size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 truncate">{selectedEmployee.email || "No email available"}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    <Phone size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 truncate">{selectedEmployee.phone || "No phone available"}</span>
                  </div>
                </div>
              </div>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                {selectedProps.type === "travel" ? (
                  <Plane size={18} className="text-amber-600" aria-hidden="true" />
                ) : (
                  <CalendarDays size={18} className="text-blue-600" aria-hidden="true" />
                )}
                <h3 className="m-0 text-sm font-bold uppercase tracking-[0.14em] text-slate-500">
                  {selectedProps.activityType} Details
                </h3>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <DetailRow label="Activity Type" value={selectedProps.activityType} />
                <DetailRow label="Start Date" value={formatDateDisplay(selectedProps.startDate)} />
                <DetailRow label="End Date" value={formatDateDisplay(selectedProps.endDate)} />
                <DetailRow label="Status" value={selectedProps.status} />
                {/* Only for a record that named its days, where the span alone would overstate it. */}
                {selectedProps.selectedDates ? (
                  <DetailRow
                    label={selectedProps.type === "travel" ? "Travel Dates" : "Leave Dates"}
                    value={selectedProps.selectedDates}
                  />
                ) : null}
                {selectedProps.type === "travel" ? (
                  <>
                    <DetailRow label="Destination" value={selectedRecord.destination} />
                    <DetailRow label="Purpose" value={selectedRecord.purpose} />
                    <DetailRow label="Assistance Labor" value={selectedRecord.assistanceLabor} />
                    <DetailRow label="Appropriations" value={selectedRecord.appropriations} />
                  </>
                ) : (
                  <>
                    <DetailRow label="Leave Type" value={selectedRecord.leaveType} />
                    <DetailRow label="Duration" value={selectedRecord.numberOfDays ? `${selectedRecord.numberOfDays} day(s)` : ""} />
                    <DetailRow label="Reason" value={selectedProps.detail} />
                    <DetailRow label="Approved By" value={selectedRecord.approvedByName} />
                  </>
                )}
              </dl>
            </section>

            {!canViewFullProfile ? (
              <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                Full employee profile navigation is not available for this dashboard role.
              </p>
            ) : null}
          </div>
          )
        ) : null}
      </Modal>

      <Modal
        open={announcementModalOpen}
        title="Create Event/Announcement"
        maxWidth="max-w-[760px]"
        onClose={closeAnnouncementModal}
        footer={(
          <>
            <Button icon={isEventForm ? CalendarClock : Megaphone} loading={announcementSaving} onClick={handleAnnouncementSubmit}>
              {announcementSaving ? "Saving..." : isEventForm ? "Create Event" : "Publish Announcement"}
            </Button>
          </>
        )}
      >
        <div className="grid gap-4">
          {announcementErrors.form ? (
            <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {announcementErrors.form}
            </p>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="calendarEntryType" className="text-sm font-semibold text-slate-700">
              Create Type
            </label>
            <select
              id="calendarEntryType"
              value={announcementForm.entryType}
              onChange={(event) => {
                setAnnouncementForm((current) => ({ ...current, entryType: event.target.value }));
                setAnnouncementErrors({});
              }}
              className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
            >
              <option value="announcement">Announcement</option>
              <option value="event">Event</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="calendarAnnouncementTitle" className="text-sm font-semibold text-slate-700">
              {isEventForm ? "Event Title" : "Announcement Title"}
            </label>
            <input
              id="calendarAnnouncementTitle"
              value={announcementForm.title}
              onChange={(event) => {
                setAnnouncementForm((current) => ({ ...current, title: event.target.value }));
                setAnnouncementErrors((current) => ({ ...current, title: "" }));
              }}
              className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              placeholder={isEventForm ? "Enter event title" : "Enter announcement title"}
            />
            {announcementErrors.title ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.title}</p> : null}
          </div>

          {!isEventForm ? <div className="space-y-2">
              <label htmlFor="calendarAnnouncementStart" className="text-sm font-semibold text-slate-700">
                Select Date
              </label>
              <input
                id="calendarAnnouncementStart"
                type="date"
                value={announcementForm.startDate}
                onClick={openDatePicker}
                onChange={(event) => {
                  setAnnouncementForm((current) => ({ ...current, startDate: event.target.value }));
                  setAnnouncementErrors((current) => ({ ...current, startDate: "" }));
                }}
                className="min-h-[42px] w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              />
              {announcementErrors.startDate ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.startDate}</p> : null}
          </div> : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="m-0 text-sm font-bold text-slate-700">Start</p>
                <input
                  aria-label="Event start date"
                  type="date"
                  value={announcementForm.startDate}
                  onClick={openDatePicker}
                  onChange={(event) => {
                    setAnnouncementForm((current) => ({ ...current, startDate: event.target.value }));
                    setAnnouncementErrors((current) => ({ ...current, startDate: "", endTime: "" }));
                  }}
                  className="min-h-[42px] w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
                />
                <input
                  aria-label="Event start time"
                  type="time"
                  value={announcementForm.startTime}
                  onChange={(event) => {
                    setAnnouncementForm((current) => ({ ...current, startTime: event.target.value }));
                    setAnnouncementErrors((current) => ({ ...current, startTime: "", endTime: "" }));
                  }}
                  className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
                />
                {announcementErrors.startDate ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.startDate}</p> : null}
                {announcementErrors.startTime ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.startTime}</p> : null}
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="m-0 text-sm font-bold text-slate-700">End</p>
                <input
                  aria-label="Event end date"
                  type="date"
                  min={announcementForm.startDate || undefined}
                  value={announcementForm.endDate}
                  onClick={openDatePicker}
                  onChange={(event) => {
                    setAnnouncementForm((current) => ({ ...current, endDate: event.target.value }));
                    setAnnouncementErrors((current) => ({ ...current, endDate: "", endTime: "" }));
                  }}
                  className="min-h-[42px] w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
                />
                <input
                  aria-label="Event end time"
                  type="time"
                  value={announcementForm.endTime}
                  onChange={(event) => {
                    setAnnouncementForm((current) => ({ ...current, endTime: event.target.value }));
                    setAnnouncementErrors((current) => ({ ...current, endTime: "" }));
                  }}
                  className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
                />
                {announcementErrors.endDate ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.endDate}</p> : null}
                {announcementErrors.endTime ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.endTime}</p> : null}
              </div>
            </div>
          )}

          {isEventForm ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="calendarEventAudience" className="text-sm font-semibold text-slate-700">Audience</label>
                <select
                  id="calendarEventAudience"
                  value={announcementForm.audience}
                  onChange={(event) => setAnnouncementForm((current) => ({ ...current, audience: event.target.value }))}
                  className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
                >
                  {EVENT_AUDIENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="calendarEventLocation" className="text-sm font-semibold text-slate-700">Location</label>
                <input
                  id="calendarEventLocation"
                  value={announcementForm.location}
                  maxLength={255}
                  onChange={(event) => {
                    setAnnouncementForm((current) => ({ ...current, location: event.target.value }));
                    setAnnouncementErrors((current) => ({ ...current, location: "" }));
                  }}
                  className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
                  placeholder="e.g. Conference Room, Regional Office"
                />
                {announcementErrors.location ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.location}</p> : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="calendarAnnouncementDescription" className="text-sm font-semibold text-slate-700">
              Details
            </label>
            <textarea
              id="calendarAnnouncementDescription"
              rows={4}
              value={announcementForm.description}
              onChange={(event) => setAnnouncementForm((current) => ({ ...current, description: event.target.value }))}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              placeholder={isEventForm ? "Add the event agenda or other important details" : "Share announcement details for employees"}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}
