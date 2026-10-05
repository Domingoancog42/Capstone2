import { resolveUserRoleKey } from "./roleRoutes";
import { userHasPermission } from "./permissions";

/**
 * Resolves through the base role, so a role an administrator created on top of HR Head
 * reviews leave exactly as HR Head does. See resolveUserRoleKey().
 */
export function resolveRoleKey(user) {
  return resolveUserRoleKey(user);
}

export function canManageLeave(user) {
  const roleKey = resolveRoleKey(user);
  return roleKey === "admin"
    || roleKey === "chief"
    || roleKey === "hrhead"
    || roleKey === "hrstaff"
    || roleKey === "regionaldirector";
}

/** The Leave Management action an administrator ticked for the role under Settings > Roles. */
export function userHasLeaveAction(user, action) {
  return userHasPermission(user, "leave", action);
}

/*
 * A division desk on the leave request register: the Chief by role, and a Planning Officer once an
 * administrator grants Leave Management approve or reject in RBAC. The Planning Officer works the
 * same division desk a Chief does, so the grant seats them at the Chief's stage for their own
 * division; without it their Leave page stays a self-service filing page. Mirrors
 * leave_is_division_desk() in backend/api/leave_request.php.
 */
export function isLeaveDivisionDesk(user) {
  const roleKey = resolveRoleKey(user);
  return roleKey === "chief"
    || (roleKey === "planningofficer"
      && (userHasLeaveAction(user, "approve") || userHasLeaveAction(user, "reject")));
}

/**
 * Who works the leave request register for other employees. Travel orders, pass slips and CTO keep
 * their own desks (canManageLeave), which the RBAC grant above does not widen.
 */
export function canManageLeaveRequests(user) {
  return canManageLeave(user) || isLeaveDivisionDesk(user);
}

export function canViewAllLeaves(user) {
  const roleKey = resolveRoleKey(user);
  return roleKey !== "employee";
}

export function normalizeLeaveStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();

  switch (normalized) {
    case "submitted":
      return "Pending";
    case "pending leave balance verification":
      return "Pending";
    case "endorsed":
    case "pending hr head approval":
      return "Endorsed";
    case "reviewed":
    case "pending chief admin review":
      return "Reviewed";
    case "chief_reviewed":
    case "chief reviewed":
    case "chiefreviewed":
    case "pending regional director approval":
      return "Chief Reviewed";
    case "approved":
      return "Approved";
    case "rejected":
    case "disapproved":
      return "Rejected";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

/**
 * Record lists show the request's overall outcome while the stored status keeps its exact approval
 * stage for routing. A request remains Pending until every required approver has signed it.
 */
export function getRequestTableStatusLabel(status) {
  const normalizedStatus = normalizeLeaveStatus(status);

  switch (normalizedStatus) {
    case "Pending":
      return "Pending Leave Balance Verification";
    case "Endorsed":
      return "Pending HR Head Approval";
    case "Reviewed":
      return "Pending Chief Admin Review";
    case "Chief Reviewed":
      return "Pending Regional Director Approval";
    default:
      return normalizedStatus;
  }
}

export function normalizeRequestStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "returned") {
    return "Returned";
  }

  return normalizeLeaveStatus(status);
}

const LEAVE_APPROVAL_STAGE_BY_STATUS = {
  Pending: {
    roles: ["hrstaff"],
    action: "markEndorsed",
    nextStatus: "Endorsed",
  },
  Endorsed: {
    roles: ["hrhead"],
    action: "markReviewed",
    nextStatus: "Reviewed",
  },
  Reviewed: {
    roles: ["chief"],
    action: "markChiefReviewed",
    nextStatus: "Chief Reviewed",
  },
  "Chief Reviewed": {
    roles: ["regionaldirector"],
    action: "approve",
    nextStatus: "Approved",
  },
};

/** The one approval action assigned to this role at the request's current stage. */
export function resolveLeaveApprovalAction(roleKey, status) {
  const normalizedRoleKey = String(roleKey || "").trim().toLowerCase();
  const stage = LEAVE_APPROVAL_STAGE_BY_STATUS[normalizeLeaveStatus(status)];

  if (!stage || (normalizedRoleKey !== "admin" && !stage.roles.includes(normalizedRoleKey))) {
    return null;
  }

  return { action: stage.action, status: stage.nextStatus };
}

export function canRejectLeaveAtStage(roleKey, status) {
  return Boolean(resolveLeaveApprovalAction(roleKey, status));
}

/* The role a user occupies in the chain: a Planning Officer seated as a division desk is a Chief there. */
function leaveStageRoleKey(user) {
  const roleKey = resolveRoleKey(user);
  return roleKey === "planningofficer" && isLeaveDivisionDesk(user) ? "chief" : roleKey;
}

/**
 * The approval action this user gets on a request at its current stage: the chain decides the
 * desk, and RBAC's Leave Management "approve" decides whether that desk may take it.
 */
export function resolveLeaveApprovalActionForUser(user, status) {
  if (!userHasLeaveAction(user, "approve")) {
    return null;
  }

  return resolveLeaveApprovalAction(leaveStageRoleKey(user), status);
}

/** Same as above for the Reject button, gated by RBAC's Leave Management "reject". */
export function canRejectLeaveForUser(user, status) {
  return userHasLeaveAction(user, "reject") && canRejectLeaveAtStage(leaveStageRoleKey(user), status);
}

export function isPendingRequestStatus(status) {
  const normalizedStatus = normalizeRequestStatus(status);
  return normalizedStatus === "Pending"
    || normalizedStatus === "Endorsed"
    || normalizedStatus === "Reviewed"
    || normalizedStatus === "Chief Reviewed";
}

export function countPendingRecords(records = []) {
  return records.reduce(
    (count, record) => count + (isPendingRequestStatus(record?.status) ? 1 : 0),
    0
  );
}

/**
 * Whether the Regional Director has already signed this record.
 *
 * The Director's approval is the last signature on a leave request or a compensatory time off
 * filing, so reaching Approved is the whole test. A travel order is the exception: the Director's
 * approval parks the row at Chief Reviewed while the employee accepts the COA liquidation clause, and the
 * API flags that wait as `awaitingAuthorization` — the Director has signed either way.
 *
 * Forms are only worth printing once that signature exists, so this gates the print actions.
 */
export function isRegionalDirectorApproved(record) {
  return normalizeLeaveStatus(record?.status) === "Approved"
    || Boolean(record?.awaitingAuthorization);
}

/*
 * Maternity leave belongs to the female employee who gives birth (RA 11210) and paternity leave to
 * the male employee whose spouse does (RA 8187) — nobody is entitled to both. The API keeps a balance
 * row for each so HR can manage either one, so an employee-facing view filters them here.
 */
const GENDER_SPECIFIC_LEAVE_CREDITS = [
  { code: "ML", type: "maternity leave", gender: "female" },
  { code: "PL", type: "paternity leave", gender: "male" },
];

/**
 * Whether a leave-credit balance belongs on the screen of an employee with this gender.
 *
 * Only the two gender-specific credits are ever withheld, and only when the gender on the employee
 * record actually says male or female — an unrecorded or non-binary value keeps both, since guessing
 * would hide a real entitlement.
 */
export function leaveCreditMatchesGender(balance, gender) {
  const code = String(balance?.code || "").trim().toUpperCase();
  const type = String(balance?.type || balance?.name || "").trim().toLowerCase();
  const rule = GENDER_SPECIFIC_LEAVE_CREDITS.find(
    (item) => (code !== "" && item.code === code) || (type !== "" && item.type === type)
  );

  if (!rule) {
    return true;
  }

  const employeeGender = String(gender || "").trim().toLowerCase();

  return employeeGender === "male" || employeeGender === "female"
    ? employeeGender === rule.gender
    : true;
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

/** Managers act organization-wide, but never on a request that belongs to their own account. */
export function canManageLeaveRequestRow(user, record) {
  return canManageLeaveRequests(user) && !matchesUserRecordScope(record, user);
}

/**
 * Applicants may cancel before the next approval; a filing that started at HR or at the Regional
 * Director is still cancellable while it waits there.
 */
export function canCancelOwnLeaveRequest(user, record) {
  if (!matchesUserRecordScope(record, user)) {
    return false;
  }

  const status = normalizeLeaveStatus(record?.status);
  return status === "Pending";
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

/*
 * Date inputs hand back "YYYY-MM-DD", which `new Date()` reads as UTC midnight and can shift a day
 * when the weekday is what matters. Building the date from its parts keeps it local.
 */
function toLocalDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (parts) {
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isWeekendDate(value) {
  const date = toLocalDate(value);
  if (!date) {
    return false;
  }

  const weekday = date.getDay();
  return weekday === 0 || weekday === 6;
}

/*
 * Today as the "YYYY-MM-DD" a date input wants, for use as its `min`. Built from local parts on
 * purpose: `toISOString()` is UTC, so in Manila (+08:00) it would report yesterday until 8am and
 * quietly let the calendar open one day too early.
 */
export function todayDateInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The management screen's Pending filter means "waiting at my desk", not merely the first stored
 * status. Each approver therefore sees the stage handed to them by the previous approver. Admin and
 * non-approver views count every unfinished request because all open stages display as Pending.
 * An approver's own unfinished request also remains visible even after it has moved to the next
 * desk, because it is an applicant record rather than work awaiting that approver's decision.
 */
export function matchesLeaveManagementStatus(
  status,
  filterStatus,
  roleKey = "",
  { isOwnRequest = false } = {}
) {
  const filter = String(filterStatus || "").trim().toLowerCase();
  if (!filter) return true;

  const normalizedStatus = normalizeLeaveStatus(status);
  if (filter !== "pending") {
    return normalizedStatus === normalizeLeaveStatus(filterStatus);
  }

  if (isOwnRequest) {
    return ["Pending", "Endorsed", "Reviewed", "Chief Reviewed"].includes(normalizedStatus);
  }

  const role = String(roleKey || "").trim().toLowerCase();
  const pendingStagesByRole = {
    admin: ["Pending", "Endorsed", "Reviewed", "Chief Reviewed"],
    chief: ["Reviewed"],
    hrhead: ["Endorsed"],
    hrstaff: ["Pending"],
    regionaldirector: ["Chief Reviewed"],
    employee: ["Pending", "Endorsed", "Reviewed", "Chief Reviewed"],
    planningofficer: ["Pending", "Endorsed", "Reviewed", "Chief Reviewed"],
  };

  return (pendingStagesByRole[role] || ["Pending"]).includes(normalizedStatus);
}

export const LEAVE_ADVANCE_NOTICE_DAYS = 5;
export const LEAVE_ADVANCE_NOTICE_ERROR = "Please file your leave request at least five days in advance.";
export const LEAVE_TYPE_REQUIRED_BEFORE_DATES_ERROR = "Please select a leave type before selecting leave dates.";

const LEAVE_ADVANCE_NOTICE_EXEMPT_TYPES = new Set([
  "emergency leave",
  "special emergency (calamity) leave",
  "sick leave",
  "mandatory/forced leave",
  "maternity leave",
]);

export function isLeaveAdvanceNoticeExempt(leaveType) {
  return LEAVE_ADVANCE_NOTICE_EXEMPT_TYPES.has(String(leaveType || "").trim().toLowerCase());
}

/** True when a regular leave starts fewer than five calendar days after the filing date. */
export function isLeaveStartDateTooSoon({ leaveType, startDate, filingDate = todayDateInputValue() } = {}) {
  if (!String(leaveType || "").trim() || !startDate || isLeaveAdvanceNoticeExempt(leaveType)) {
    return false;
  }

  const selectedStart = toLocalDate(startDate);
  const filedOn = toLocalDate(filingDate);
  if (!selectedStart || !filedOn) {
    return false;
  }

  const firstAllowedStart = new Date(filedOn);
  firstAllowedStart.setDate(firstAllowedStart.getDate() + LEAVE_ADVANCE_NOTICE_DAYS);

  return selectedStart < firstAllowedStart;
}

/** True when a date input value falls before today. A `min` attribute is not enforcement — typed
 *  and pasted values still reach the form — so this backs it up at validation time. */
export function isPastDate(value) {
  const date = toLocalDate(value);

  if (!date) {
    return false;
  }

  return date < toLocalDate(todayDateInputValue());
}

/*
 * CSC Form No. 6 asks for working days, so Saturdays and Sundays inside the range are not counted:
 * a leave from Wednesday to the following Monday is four working days, not six.
 */
export function getDurationDays(startDate, endDate) {
  const start = toLocalDate(startDate);
  const end = toLocalDate(endDate);

  if (!start || !end || end < start) {
    return 0;
  }

  let workingDays = 0;
  const cursor = new Date(start);

  while (cursor <= end) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) {
      workingDays += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return workingDays;
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
