import { normalizeLeaveStatus } from "../../utils/leaveHelpers";
import { unpackLeaveReason } from "../../utils/leaveRequestDetails";
import { unpackSelectedDates } from "../../utils/dateSelection";

export function recordDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}
export function dateKey(value) {
  const date = recordDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
}
export const monthKey = (value) => dateKey(value).slice(0, 7);
export const amount = (value) => Number(String(value ?? 0).replace(/,/g, "")) || 0;

export function attendanceSummary(records, month) {
  const counts = { Present: 0, Late: 0, Leave: 0, Absent: 0, Incomplete: 0 };
  const days = new Map();
  records.filter((record) => monthKey(record.date) === month).forEach((record) => days.set(dateKey(record.date), record));
  let minutes = 0;
  days.forEach((record) => {
    const status = String(record.status || "").toLowerCase();
    const category = status.includes("leave") ? "Leave" : status === "absent" ? "Absent"
      : amount(record.lateMinutes) > 0 || status.includes("late") ? "Late"
        : status === "incomplete" ? "Incomplete"
          : status === "present" || status === "undertime" || amount(record.totalMinutes) > 0 ? "Present" : "Incomplete";
    counts[category] += 1;
    minutes += amount(record.totalMinutes);
  });
  return { counts, total: days.size, hours: minutes / 60 };
}

export function performanceSummary(records, year) {
  // Self-ratings share these fields; only HR-rated records belong in the reviewed average.
  const rated = records.filter((record) => String(record.status).toLowerCase() === "rated"
    && recordDate(record.periodTo || record.periodFrom)?.getFullYear() === Number(year));
  const mean = (values) => {
    const scores = values.map(amount).filter((value) => value > 0 && value <= 5);
    return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  };
  return {
    score: mean(rated.map((record) => record.finalRating ?? record.a4Rating)), count: rated.length,
    dimensions: [
      { label: "Quality", score: mean(rated.map((record) => record.q1Rating)) },
      { label: "Efficiency", score: mean(rated.map((record) => record.e2Rating)) },
      { label: "Timeliness", score: mean(rated.map((record) => record.t3Rating)) },
    ],
  };
}

export function upcomingSchedule(data, today = new Date()) {
  const todayKey = dateKey(today);
  const events = [];
  const add = (event) => {
    const start = dateKey(event.start);
    const end = dateKey(event.end) || start;
    if (start && end >= todayKey) events.push({ ...event, date: start < todayKey ? todayKey : start, ongoing: start < todayKey });
  };
  data.announcements.forEach((item) => {
    const isEvent = item.entryType === "event";
    add({ id: `${isEvent ? "event" : "announcement"}-${item.id}`, title: item.title,
      start: item.startDate, end: item.endDate, detail: isEvent ? `${item.startTime || "Scheduled"}${item.location ? ` · ${item.location}` : ""}` : "Announcement",
      tone: isEvent ? "teal" : "blue" });
  });
  ["leave", "travel", "compensatory"].forEach((type) => {
    data[type].filter((item) => normalizeLeaveStatus(item.status) === "Approved").forEach((item) => {
      const dates = type === "leave" ? unpackLeaveReason(item.reason).details.leaveDays : unpackSelectedDates(item.remarks).dates;
      const title = type === "leave" ? `Approved ${item.leaveType || "leave"}` : type === "travel" ? "Official travel" : "Compensatory time off";
      const base = { title, detail: item.destination || "Approved time away", tone: "teal" };
      if (dates?.length) {
        dates.forEach((entry) => add({ ...base, id: `${type}-${item.id}-${entry.date}`, start: entry.date,
          detail: entry.portion === "am" ? "Morning" : entry.portion === "pm" ? "Afternoon" : base.detail }));
      } else add({ ...base, id: `${type}-${item.id}`, start: item.startDate, end: item.endDate });
    });
  });
  return events.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
}
