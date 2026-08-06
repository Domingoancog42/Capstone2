import React, { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import { toast } from "react-hot-toast";
import { CalendarDays, ExternalLink, Mail, Megaphone, Phone, Plane, Plus } from "lucide-react";
import Button from "../UI/button";
import Modal from "../UI/modal";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { formatDateDisplay, normalizeLeaveStatus } from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";

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
};

const emptyAnnouncementForm = {
  title: "",
  startDate: "",
  endDate: "",
  description: "",
};

function firstText(...values) {
  return values.find((value) => String(value || "").trim()) || "";
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
    position: matchedEmployee?.position || matchedEmployee?.designation || record?.position || record?.designation || "",
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
    return null;
  }

  const meta = ACTIVITY_META[type] || ACTIVITY_META.leave;
  const employee = resolveEmployeeForRecord(record, employeeLookup);
  const activityType = type === "travel" ? "Travel Order" : firstText(record?.leaveType, "Leave");
  const detail = type === "travel"
    ? firstText(record?.destination, record?.purpose, "Travel Order")
    : firstText(getLeaveReasonDisplay(record?.reason, record?.leaveType), record?.leaveType, "Leave");

  return {
    id: `${type}-${record?.id || record?.requestId || employee.employeeRecordId || employee.employeeId || startDate}`,
    title: `${employee.fullName || "Employee"} - ${activityType}`,
    start: startDate,
    end: endDate ? addDays(endDate, 1) : undefined,
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
      detail,
      employee,
      record,
      color: meta.color,
    },
  };
}

function buildEventFromAnnouncement(announcement) {
  const startDate = firstText(announcement?.startDate);
  const endDate = firstText(announcement?.endDate, announcement?.startDate);

  if (!startDate) {
    return null;
  }

  const meta = ACTIVITY_META.announcement;

  return {
    // Prefixed because leave and travel events are keyed the same way and ids must not collide.
    id: `announcement-${announcement?.id || `${startDate}-${announcement?.title || ""}`}`,
    title: announcement?.title || "Announcement",
    start: startDate,
    end: endDate ? addDays(endDate, 1) : undefined,
    allDay: true,
    backgroundColor: meta.color,
    borderColor: meta.color,
    textColor: "#ffffff",
    extendedProps: {
      type: "announcement",
      activityLabel: meta.label,
      activityType: "Announcement",
      status: "Published",
      startDate,
      endDate,
      detail: announcement?.description || "No details added.",
      record: announcement,
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

function EventContent({ event }) {
  const props = event.extendedProps || {};
  const employee = props.employee || {};
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);
  const isAnnouncement = props.type === "announcement";

  return (
    <div className={`flex min-w-0 items-center gap-1.5 px-1 py-0.5 leading-tight ${isAnnouncement ? "" : "min-h-[28px]"}`}>
      {!isAnnouncement ? (
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
        <div className="truncate text-[11px] font-bold">{isAnnouncement ? event.title : (employee.fullName || event.title)}</div>
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
    ...leaveRequests.map((record) => buildEventFromRecord(record, "leave", employeeLookup)),
    ...travelOrders.map((record) => buildEventFromRecord(record, "travel", employeeLookup)),
    ...announcements.map((announcement) => buildEventFromAnnouncement(announcement)),
  ].filter(Boolean), [announcements, employeeLookup, leaveRequests, travelOrders]);
  const selectedProps = selectedEvent?.extendedProps || {};
  const selectedEmployee = selectedProps.employee || {};
  const selectedRecord = selectedProps.record || {};
  const avatarUrl = resolveBackendAssetUrl(selectedEmployee.profileImage);
  const canViewFullProfile = Boolean(onViewEmployeeProfile && (selectedEmployee.employeeRecordId || selectedEmployee.id));
  const canAddAnnouncement = typeof onSaveAnnouncement === "function";

  const closeAnnouncementModal = () => {
    setAnnouncementModalOpen(false);
    setAnnouncementForm(emptyAnnouncementForm);
    setAnnouncementErrors({});
  };

  const handleAnnouncementSubmit = async () => {
    const nextErrors = {};

    if (!announcementForm.title.trim()) {
      nextErrors.title = "Announcement title is required.";
    }

    if (!announcementForm.startDate) {
      nextErrors.startDate = "Start date is required.";
    }

    if (!announcementForm.endDate) {
      nextErrors.endDate = "End date is required.";
    }

    if (
      announcementForm.startDate
      && announcementForm.endDate
      && announcementForm.endDate < announcementForm.startDate
    ) {
      nextErrors.endDate = "End date must be on or after the start date.";
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
        title: announcementForm.title.trim(),
        startDate: announcementForm.startDate,
        endDate: announcementForm.endDate,
        description: announcementForm.description.trim(),
      });

      toast.success("Announcement published to the calendar.");
      closeAnnouncementModal();
    } catch (error) {
      const message = error?.response?.data?.message || "Unable to publish the announcement.";

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
              Announcements, approved employee leave, and travel orders across Month, Week, and Day views.
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
              Add Announcement
            </Button>
          ) : null}
          {showLegend ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(ACTIVITY_META).map(([key, meta]) => (
                <span
                  key={key}
                  className={`inline-flex items-center gap-2 rounded-full border font-semibold ${compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs"}`}
                  style={{ borderColor: meta.border, backgroundColor: meta.bg, color: meta.text }}
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
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: "dayGridMonth,timeGridWeek,timeGridDay",
              center: "title",
              right: compact ? "prev,next" : "prev,next today",
            }}
            buttonText={{
              today: "Today",
              month: "Month",
              week: "Week",
              day: "Day",
            }}
            events={calendarEvents}
            eventClick={(clickInfo) => setSelectedEvent(clickInfo.event)}
            eventContent={(contentInfo) => <EventContent event={contentInfo.event} />}
            dayCellContent={(dayInfo) => <DayCellContent {...dayInfo} />}
            height={compact ? 220 : "auto"}
            dayMaxEvents={compact ? 1 : 3}
            navLinks
            nowIndicator
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
          </>
        )}
      >
        {selectedEvent ? (
          selectedProps.type === "announcement" ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">
                    <Megaphone size={19} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="m-0 text-base font-semibold text-slate-950">{selectedEvent.title}</h3>
                    <p className="m-0 mt-1 text-sm text-slate-600">
                      {formatDateDisplay(selectedProps.startDate)} - {formatDateDisplay(selectedProps.endDate)}
                    </p>
                  </div>
                </div>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailRow label="Activity Type" value={selectedProps.activityType} />
                <DetailRow label="Status" value={selectedProps.status} />
                <DetailRow label="Start Date" value={formatDateDisplay(selectedProps.startDate)} />
                <DetailRow label="End Date" value={formatDateDisplay(selectedProps.endDate)} />
              </dl>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Announcement Details</p>
                <p className="m-0 mt-2 text-sm leading-6 text-slate-700">{selectedProps.detail}</p>
              </div>
            </div>
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
                  className="mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
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
        title="Add Announcement"
        maxWidth="max-w-[620px]"
        onClose={closeAnnouncementModal}
        footer={(
          <>
            <Button variant="ghost" disabled={announcementSaving} onClick={closeAnnouncementModal}>
              Cancel
            </Button>
            <Button icon={Megaphone} loading={announcementSaving} onClick={handleAnnouncementSubmit}>
              {announcementSaving ? "Publishing..." : "Publish Announcement"}
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
            <label htmlFor="calendarAnnouncementTitle" className="text-sm font-semibold text-slate-700">
              Announcement Title
            </label>
            <input
              id="calendarAnnouncementTitle"
              value={announcementForm.title}
              onChange={(event) => {
                setAnnouncementForm((current) => ({ ...current, title: event.target.value }));
                setAnnouncementErrors((current) => ({ ...current, title: "" }));
              }}
              className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              placeholder="Enter announcement title"
            />
            {announcementErrors.title ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.title}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="calendarAnnouncementStart" className="text-sm font-semibold text-slate-700">
                Start Date
              </label>
              <input
                id="calendarAnnouncementStart"
                type="date"
                value={announcementForm.startDate}
                onChange={(event) => {
                  setAnnouncementForm((current) => ({ ...current, startDate: event.target.value }));
                  setAnnouncementErrors((current) => ({ ...current, startDate: "" }));
                }}
                className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              />
              {announcementErrors.startDate ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.startDate}</p> : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="calendarAnnouncementEnd" className="text-sm font-semibold text-slate-700">
                End Date
              </label>
              <input
                id="calendarAnnouncementEnd"
                type="date"
                value={announcementForm.endDate}
                onChange={(event) => {
                  setAnnouncementForm((current) => ({ ...current, endDate: event.target.value }));
                  setAnnouncementErrors((current) => ({ ...current, endDate: "" }));
                }}
                className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              />
              {announcementErrors.endDate ? <p className="m-0 text-xs font-semibold text-rose-600">{announcementErrors.endDate}</p> : null}
            </div>
          </div>

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
              placeholder="Share announcement details for employees"
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}
