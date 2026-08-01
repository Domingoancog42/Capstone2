export function resolveRoleKey(user) {
  return String(user?.roleKey || user?.role || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function canManageLeave(user) {
  const roleKey = resolveRoleKey(user);
  return roleKey === "admin" || roleKey === "hrhead" || roleKey === "hrstaff" || roleKey === "regionaldirector";
}

export function canViewAllLeaves(user) {
  const roleKey = resolveRoleKey(user);
  return roleKey !== "employee";
}

export function normalizeLeaveStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();

  switch (normalized) {
    case "reviewed":
      return "Reviewed";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

export function normalizeRequestStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "returned") {
    return "Returned";
  }

  return normalizeLeaveStatus(status);
}

export function isPendingRequestStatus(status) {
  const normalizedStatus = normalizeRequestStatus(status);
  return normalizedStatus === "Pending" || normalizedStatus === "Reviewed";
}

export function countPendingRecords(records = []) {
  return records.reduce(
    (count, record) => count + (isPendingRequestStatus(record?.status) ? 1 : 0),
    0
  );
}

export function matchesUserEmployeeOption(employee, user) {
  const employeeCode = String(employee?.employeeId || "").trim().toLowerCase();
  const employeeName = String(employee?.employeeName || employee?.fullName || "").trim().toLowerCase();
  const userEmployeeId = String(user?.employee_id || "").trim().toLowerCase();
  const userName = String(user?.full_name || user?.username || "").trim().toLowerCase();

  return (
    (employeeCode && userEmployeeId && employeeCode === userEmployeeId)
    || (employeeName && userName && employeeName === userName)
  );
}

export function matchesUserRecordScope(record, user) {
  return matchesUserEmployeeOption({
    employeeId: record?.employeeId,
    employeeName: record?.employeeName,
  }, user);
}

export function formatDateDisplay(value) {
  if (!value) {
    return "N/A";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

export function getDurationDays(startDate, endDate) {
  if (!startDate || !endDate) {
    return 0;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const raw = Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay) + 1;
  return raw > 0 ? raw : 0;
}

export function getInitials(name) {
  const clean = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (clean.length === 0) {
    return "NA";
  }

  if (clean.length === 1) {
    return clean[0].slice(0, 2).toUpperCase();
  }

  return `${clean[0][0]}${clean[1][0]}`.toUpperCase();
}

export function formatDurationLabel(days) {
  const value = Number(days) || 0;
  return `${value} ${value === 1 ? "day" : "days"}`;
}

export function getStatusBadgeClasses(status) {
  switch (normalizeLeaveStatus(status)) {
    case "Reviewed":
      return "border border-sky-200 bg-sky-50 text-sky-700";
    case "Approved":
      return "border border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Rejected":
      return "border border-rose-200 bg-rose-50 text-rose-700";
    case "Cancelled":
      return "border border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border border-amber-200 bg-amber-50 text-amber-700";
  }
}

export function isCurrentDateWithin(startDate, endDate, targetDate = new Date()) {
  if (!startDate || !endDate) {
    return false;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const target = targetDate instanceof Date ? targetDate : new Date(targetDate);

  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || Number.isNaN(target.getTime())
  ) {
    return false;
  }

  const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const normalizedEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const normalizedTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());

  return normalizedTarget >= normalizedStart && normalizedTarget <= normalizedEnd;
}

export function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}
