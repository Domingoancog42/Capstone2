import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  Building2,
  BriefcaseBusiness,
  ClipboardCheck,
  ClipboardList,
  CalendarRange,
  Clock3,
  ChevronDown,
  FileText,
  KeyRound,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Plane,
  ScrollText,
  TrendingUp,
  Trophy,
  UserRoundCog,
  Users,
  X,
} from "lucide-react";
import NotificationBadge from "../UI/NotificationBadge";
import { scalePollInterval, subscribeAutoRefresh } from "../../components/auto/autorefreshconfig";
import {
  ADMIN_HIDDEN_REPORT_CATEGORIES,
  buildReportNavChildren,
} from "../../module/reports/reportCategories";
import {
  fetchLeaveRequests,
  LEAVE_REQUESTS_CHANGED_EVENT,
} from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchLeaveMonetizationRequests } from "../../services/leaveMonetizationService";
import { fetchPayrollRecords } from "../../services/payrollService";
import {
  fetchPromotions,
  markPromotionsViewed,
  PROMOTIONS_CHANGED_EVENT,
} from "../../services/promotionService";
import { fetchIpcrRecords } from "../../services/api";
import { performanceFormKey } from "../../module/performance/performanceFormGroups";
import {
  canManageLeave,
  matchesLeaveManagementStatus,
  normalizeLeaveStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { filterNavigationItemsByPermissions } from "../../utils/permissions";
import { getRoleLabel, isFadDivisionChiefUser, normalizeRole } from "../../utils/roleRoutes";

const defaultNavigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { key: "employees", label: "Employee Management", icon: Users, path: "/admin/employees" },
  { key: "divisions", label: "Divisions Management", icon: Building2, path: "/admin/divisions" },
  { key: "designations", label: "Positions Management", icon: BriefcaseBusiness, path: "/admin/designations" },
  { key: "users", label: "User Management", icon: UserRoundCog, path: "/admin/users" },
  { key: "rbac", label: "Role Based Access Control", icon: KeyRound, path: "/admin/rbac" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/admin/messages" },
  { key: "notifications", label: "Notifications", path: "/admin/notifications", hidden: true },
  { key: "serviceRecord", label: "Service Record", icon: ScrollText, path: "/admin/service-record" },
  { key: "promotions", label: "Promotions", icon: TrendingUp, path: "/admin/promotions" },
  {
    key: "rewardsRecognition",
    label: "R&R Management",
    icon: Trophy,
    path: "/admin/rewards-recognition/nomination",
    children: [
      { key: "rewardsNomination", label: "Nomination", path: "/admin/rewards-recognition/nomination" },
      { key: "rewardsLoyalty", label: "Loyalty", path: "/admin/rewards-recognition/loyalty" },
      { key: "rewardsCertificateTemplate", label: "Certificate Template", path: "/admin/rewards-recognition/certificate-template" },
    ],
  },
  {
    key: "performanceManagement",
    label: "Performance Management",
    icon: BarChart3,
    path: "/admin/masterfiles/performance-management/opcr",
    children: [
      { key: "performanceOpcr", label: "OPCR", path: "/admin/masterfiles/performance-management/opcr" },
      { key: "performanceIpcr", label: "IPCR", path: "/admin/masterfiles/performance-management/ipcr" },
    ],
  },
  {
    key: "leaveBalances",
    label: "Leave Balance Management",
    icon: ClipboardList,
    path: "/admin/masterfiles/leave-balances",
  },
  {
    key: "attendance",
    label: "Attendance Management",
    icon: ClipboardCheck,
    path: "/admin/attendance",
    children: [
      /* The biometric import itself lives with HR Staff; Admin keeps the records view. */
      { key: "attendance", label: "Attendance Records", path: "/admin/attendance", exact: true },
      { key: "overtime", label: "Overtime", path: "/admin/attendance/overtime" },
    ],
  },
  {
    key: "leave",
    label: "Leave Management",
    icon: CalendarRange,
    path: "/admin/leave",
    exact: true,
  },
  { key: "travel", label: "Travel Order Management", icon: Plane, path: "/admin/leave/travel-order" },
  { key: "cto", label: "CTO Management", icon: Clock3, path: "/admin/leave/compensatory-time-off" },
  { key: "passSlip", label: "Pass Slips", icon: FileText, path: "/admin/leave/pass-slips" },
  {
    key: "payroll",
    label: "Payroll Management",
    icon: FileText,
    path: "/admin/payroll",
    children: [
      { key: "payrollGenerate", label: "Payroll", path: "/admin/payroll/generate" },
      { key: "payrollRecords", label: "Payslip", path: "/admin/payroll/payslip" },
      { key: "payrollLoan", label: "Loan", path: "/admin/payroll/loan" },
    ],
  },
  { type: "section", label: "Reports & Analytics" },
  {
    key: "reports",
    label: "Reports & Analytics",
    icon: FileText,
    path: "/admin/reports",
    children: buildReportNavChildren("/admin/reports", { exclude: ADMIN_HIDDEN_REPORT_CATEGORIES }),
  },
];

const emptyLeavePendingCounts = {
  leave: 0,
  travel: 0,
  overtime: 0,
  cto: 0,
  passSlip: 0,
};

const emptyPayrollPendingCounts = {
  payrollGenerate: 0,
  payrollLoan: 0,
};

const PAYROLL_HR_HEAD_STATUS = "Pending Approval";
const PAYROLL_CHIEF_STATUS = "Pending Chief";
const PAYROLL_DIRECTOR_STATUS = "Pending Director";
const PAYROLL_PENDING_STATUSES = [
  PAYROLL_HR_HEAD_STATUS,
  PAYROLL_CHIEF_STATUS,
  PAYROLL_DIRECTOR_STATUS,
];
/*
 * The registry status each role is expected to act on, which is what the badge counts.
 *
 * The cashier's entry is "Approved" rather than a pending rung: they sit past the end of the
 * approval chain, so a batch is theirs once the Regional Director has signed it and it is waiting
 * to be released. It still fits the rule the badges follow -- "these are waiting for you to act".
 *
 * The second rung belongs only to the Division Chief assigned to FAD/FAM. The rung remains stored
 * as "Pending Chief" for database compatibility.
 */
const PAYROLL_APPROVAL_STAGES_BY_ROLE = {
  admin: PAYROLL_PENDING_STATUSES,
  hrhead: [PAYROLL_HR_HEAD_STATUS],
  chief: [PAYROLL_CHIEF_STATUS],
  regionaldirector: [PAYROLL_DIRECTOR_STATUS],
  cashier: ["Approved"],
};

function normalizePayrollStatus(status) {
  const normalized = String(status || "").trim().toLowerCase().replace(/[^a-z]/g, "");

  switch (normalized) {
    case "pending":
    case "pendingapproval":
    case "pendinghrhead":
    case "pendinghrheadapproval":
      return PAYROLL_HR_HEAD_STATUS;
    case "pendingchief":
    case "pendingchiefapproval":
      return PAYROLL_CHIEF_STATUS;
    case "pendingdirector":
    case "pendingregionaldirector":
    case "pendingfinalapproval":
      return PAYROLL_DIRECTOR_STATUS;
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "paid":
      return "Paid";
    case "archived":
      return "Archived";
    case "draft":
      return "Draft";
    default:
      return String(status || "").trim() || "Draft";
  }
}

function normalizePayrollRegistryDate(value) {
  const text = String(value || "").trim();
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);

  return isoMatch ? isoMatch[1] : text;
}

function normalizePayrollEmploymentType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

  if (["contractofservice", "contractual", "cos"].includes(normalized)) {
    return "contractofservice";
  }

  return normalized || "unspecified";
}

/*
 * One run of Generate New Payroll is one register for every division, so division is not part of
 * the key -- the same grouping as getRegistryGroupKey() in PayrollManagementWorkspace.jsx, or the
 * badge would count one register per division.
 */
function getPayrollRegistryGroupKey(record = {}) {
  return [
    String(record.payrollType || "Salary").trim().toLowerCase(),
    normalizePayrollEmploymentType(record.employmentType),
    record.payPeriod || "",
    normalizePayrollRegistryDate(record.startDate),
    normalizePayrollRegistryDate(record.endDate || record.payrollDate),
  ].join("|");
}

function getPayrollRegistryStatus(records = []) {
  const statuses = records.map((record) => normalizePayrollStatus(record?.status));

  if (statuses.length === 0) {
    return "Draft";
  }

  if (statuses.every((status) => status === "Paid")) {
    return "Paid";
  }

  if (statuses.every((status) => status === "Approved" || status === "Paid")) {
    return "Approved";
  }

  const pendingStatus = PAYROLL_PENDING_STATUSES.find((status) => statuses.includes(status));
  if (pendingStatus) {
    return pendingStatus;
  }

  if (statuses.some((status) => status === "Rejected")) {
    return "Rejected";
  }

  if (statuses.every((status) => status === "Archived")) {
    return "Archived";
  }

  return "Draft";
}

function countPendingPayrollRegistries(records = [], roleKey = "") {
  const approvalStages = PAYROLL_APPROVAL_STAGES_BY_ROLE[roleKey] || [];

  if (approvalStages.length === 0) {
    return 0;
  }

  const groups = new Map();

  records.forEach((record) => {
    const key = getPayrollRegistryGroupKey(record);
    groups.set(key, [...(groups.get(key) || []), record]);
  });

  return Array.from(groups.values()).reduce(
    (count, groupRecords) => count + (approvalStages.includes(getPayrollRegistryStatus(groupRecords)) ? 1 : 0),
    0
  );
}

/*
 * IPCR assignments still with the HR Head. The HR Head (and Admin standing in) count the queue they
 * decide on; a chief counts the assignments of theirs still waiting -- the number they will see fall
 * as HR works through them. One badge unit is one form (an employee and a rating period), the same
 * unit the For Approval tab counts, however many KPI rows the chief put in it. HR Staff have no
 * decision to make, and an employee never sees a pending row, so neither gets a badge.
 */
const IPCR_APPROVAL_BADGE_ROLES = ["admin", "hrhead", "chief"];

export function hasIpcrApprovalBadge(roleKey = "") {
  return IPCR_APPROVAL_BADGE_ROLES.includes(roleKey);
}

export function countPendingIpcrAssignments(records = [], roleKey = "") {
  if (!hasIpcrApprovalBadge(roleKey)) {
    return 0;
  }

  const forms = new Set();
  records.forEach((record) => {
    if (String(record?.status || "").trim().toLowerCase() === "pending_approval") {
      forms.add(performanceFormKey(record, "ipcr"));
    }
  });

  return forms.size;
}

/* Shared by modules whose badge is based on the literal Pending storage value. */
export function countPendingSidebarRecords(records = []) {
  return records.reduce(
    (count, record) => count + (String(record?.status || "").trim().toLowerCase() === "pending" ? 1 : 0),
    0
  );
}

/*
 * A Leave Management badge counts only what is waiting for the signed-in role's signature -- the
 * rows its table labels "Pending by <this desk>". Counting the whole open queue instead pinned a
 * number to an approver's sidebar that no action of theirs could clear, the same trap an
 * employee's own pending request used to be. A role with no desk in a module gets no badge for it.
 *
 * Each open status names the desk that owns the request, so a desk is a list of statuses. These
 * mirror the approval chains the API enforces (travel_order.php, compensatory.php); the leave
 * chain already lives in matchesLeaveManagementStatus(). Admin stands in at every desk so a
 * request is never stranded while an approver is away.
 */
function countRecordsOnDesk(records, deskStatuses) {
  if (!deskStatuses) {
    return 0;
  }

  return records.reduce(
    (count, record) => count + (
      !record?.awaitingAuthorization && deskStatuses.includes(normalizeLeaveStatus(record?.status)) ? 1 : 0
    ),
    0
  );
}

/*
 * The Planning Officer recommends a Pending travel order, which moves it to Reviewed; the Division
 * Chief approves it next, moving it to Chief Reviewed; the Regional Director then approves it. That
 * approval parks the order at Chief Reviewed while the employee accepts the COA authorization
 * clause, which the API flags as `awaitingAuthorization` -- nobody's signature to give, so
 * countRecordsOnDesk() leaves it out. The HR desks only read and archive travel orders, so neither
 * has a desk here.
 */
const TRAVEL_DESK_STATUSES_BY_ROLE = {
  planningofficer: ["Pending"],
  chief: ["Reviewed"],
  regionaldirector: ["Chief Reviewed"],
  admin: ["Pending", "Reviewed", "Chief Reviewed"],
};

export function countPendingTravelOrders(records = [], roleKey = "") {
  return countRecordsOnDesk(records, TRAVEL_DESK_STATUSES_BY_ROLE[roleKey]);
}

/*
 * Overtime badges are intentionally limited to its two signing desks: the Chief Admin, whose badge
 * counts the Pending filings waiting for the first approval, and the Regional Director, whose badge
 * counts the Reviewed filings waiting for final approval.
 */
const OVERTIME_DESK_STATUSES_BY_ROLE = {
  chiefadmin: ["Pending"],
  regionaldirector: ["Reviewed"],
};

export function countPendingOvertimeRequests(records = [], roleKey = "") {
  return countRecordsOnDesk(records, OVERTIME_DESK_STATUSES_BY_ROLE[roleKey]);
}

/** Use the same role-aware Pending definition as the Leave Management table. */
export function countPendingLeaveRequests(records = [], roleKey = "") {
  return records.reduce(
    (count, record) => count + (
      matchesLeaveManagementStatus(record?.status, "Pending", roleKey) ? 1 : 0
    ),
    0
  );
}

/*
 * Other-division CTOs wait on the Division Chief at Pending and Chief Admin at Endorsed. FAD/ORD
 * direct-route filings wait on Chief Admin at Pending. The Regional Director signs Reviewed rows.
 */
const COMPENSATORY_DESK_STATUSES_BY_ROLE = {
  chief: ["Pending"],
  chiefadmin: ["Pending", "Endorsed"],
  regionaldirector: ["Reviewed"],
  admin: ["Pending", "Endorsed", "Reviewed"],
};

export function countPendingCompensatoryRequests(records = [], roleKey = "") {
  return countRecordsOnDesk(records, COMPENSATORY_DESK_STATUSES_BY_ROLE[roleKey]);
}

/*
 * Promotions waiting for the signed-in desk's signature: a pending one waits for HR's
 * recommendation -- the HR Head's for any division, the HR Staff's for their own, which is all the
 * API sends them -- a recommended one for the Regional Director's approval, and Admin can stand
 * in at either. Nobody else signs, so nobody else gets a badge.
 */
const PROMOTION_DESK_STATUSES_BY_ROLE = {
  hrhead: ["pending"],
  hrstaff: ["pending"],
  regionaldirector: ["recommended"],
  admin: ["pending", "recommended"],
};

export function hasPromotionDesk(roleKey = "") {
  return Boolean(PROMOTION_DESK_STATUSES_BY_ROLE[roleKey]);
}

export function countPendingPromotions(records = [], roleKey = "") {
  const deskStatuses = PROMOTION_DESK_STATUSES_BY_ROLE[roleKey];

  if (!deskStatuses) {
    return 0;
  }

  return records.reduce((count, record) => {
    const statusKey = String(record?.statusKey || record?.status || "").trim().toLowerCase();
    return count + (!record?.isArchived && deskStatuses.includes(statusKey) ? 1 : 0);
  }, 0);
}

/** An employee's approved promotion stays flagged until they open My Promotion. */
export function hasUnviewedEmployeePromotion(records = []) {
  return records.some((record) => {
    const statusKey = String(record?.statusKey || record?.status || "").trim().toLowerCase();

    return !record?.isArchived && statusKey === "approved" && record?.viewedAt == null;
  });
}

/** Whether this role has a desk to clear in the module, and so a badge worth fetching. */
export function hasTravelOrderDesk(roleKey = "") {
  return Boolean(TRAVEL_DESK_STATUSES_BY_ROLE[roleKey]);
}

export function hasCompensatoryDesk(roleKey = "") {
  return Boolean(COMPENSATORY_DESK_STATUSES_BY_ROLE[roleKey]);
}

/** Give the shared HR Operations group the name of the workspace currently using the sidebar. */
export function getRoleOperationsLabel(label, user) {
  if (String(label || "").trim().toLowerCase() !== "hr operations") {
    return label;
  }

  const roleLabel = getRoleLabel(user?.role || user?.roleKey || "User");
  return `${roleLabel} Operations`;
}

/**
 * Palette per variant, so a caller only picks `variant` instead of restating class strings — the
 * admin dashboard and the shared workspace shell had each pasted their own copy, and the two had
 * already drifted apart.
 *
 * `activeSurface` is deliberately separate from `activeText`: the surface renders as its own
 * absolutely positioned element so a single highlight can travel between rows, while the text
 * colour has to stay on the row itself.
 */
const VARIANT_NAVIGATION_STYLE = {
  default: {
    activeSurface: "bg-teal-700 shadow-sm",
    activeText: "font-semibold text-white",
    branchSurface: "bg-slate-100",
    branchText: "font-semibold text-slate-900",
    hoverRail: "bg-teal-600",
    inactiveItem: "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    inactiveChild: "font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900",
  },
  crimson: {
    activeSurface: "bg-white shadow-sm",
    activeText: "font-semibold text-[#D61E1E]",
    branchSurface: "bg-white/10",
    branchText: "font-semibold text-white",
    hoverRail: "bg-white/70",
    inactiveItem: "font-medium text-white/80 hover:bg-white/10 hover:text-white",
    inactiveChild: "font-medium text-white/70 hover:bg-white/10 hover:text-white",
  },
};

/** Pure CSS so a long nav does not pay for a motion component per row. */
const HOVER_SHIFT_CLASS = "transition-transform duration-200 motion-safe:group-hover:translate-x-0.5";

/*
 * The collapsed rail shows only a 16px icon in a 64px column, so a badge there is pinned to the
 * icon's top-right corner and shrunk a step -- the same place the header bell wears its count.
 * Without it the rail dropped every badge, and an approver who keeps the sidebar collapsed never
 * saw what was waiting on them.
 */
const COLLAPSED_BADGE_CLASS = "!right-2.5 !top-0.5 z-[1] min-h-4 min-w-4 px-1 text-[10px]";

/** Grows out of the left edge on hover, so rows answer the cursor even when they are not active. */
function HoverRail({ toneClass }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full transition-[height] duration-200 group-hover:h-5 ${toneClass}`}
    />
  );
}

/**
 * Exactly one row is highlighted at a time, so sharing this id lets the highlight glide from the
 * old row to the new one instead of blinking out and back in somewhere else.
 */
const ACTIVE_SURFACE_LAYOUT_ID = "admin-sidebar-active-surface";

const NAV_LIST_VARIANTS = {
  hidden: {},
  visible: { transition: { delayChildren: 0.05, staggerChildren: 0.025 } },
};

const NAV_ITEM_VARIANTS = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
};

/** The travelling highlight that sits behind whichever row is active. */
function ActiveSurface({ radiusClass, surfaceClass, transition }) {
  return (
    <motion.span
      aria-hidden="true"
      className={`admin-sidebar-active-surface absolute inset-0 ${radiusClass} ${surfaceClass}`}
      layoutId={ACTIVE_SURFACE_LAYOUT_ID}
      transition={transition}
    />
  );
}

export default function Sidebar({
  user,
  activeModule = "dashboard",
  onSelectModule,
  navigationItems = defaultNavigationItems,
  activePath = "",
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
  navigationStyle = {},
  // Brand crimson is the sidebar for every role. `default` is kept only so a caller that wants the
  // light rail can still ask for it; nothing in the app does.
  variant = "crimson",
}) {
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const [pendingAttendanceCount, setPendingAttendanceCount] = useState(0);
  const [pendingLeaveCounts, setPendingLeaveCounts] = useState(emptyLeavePendingCounts);
  const [pendingPayrollCount, setPendingPayrollCount] = useState(0);
  const [pendingPayrollCounts, setPendingPayrollCounts] = useState(emptyPayrollPendingCounts);
  const [pendingIpcrCount, setPendingIpcrCount] = useState(0);
  const [pendingPromotionCount, setPendingPromotionCount] = useState(0);
  const [hasUnviewedPromotionBadge, setHasUnviewedPromotionBadge] = useState(false);
  const [expandedItems, setExpandedItems] = useState({});
  const roleKey = resolveRoleKey(user);
  const exactRoleKey = normalizeRole(user?.roleKey || user?.role);
  /* Chief Admin is based on Chief but keeps distinct CTO and overtime desks. */
  const deskRoleKey = exactRoleKey === "chiefadmin" ? exactRoleKey : roleKey;
  /*
   * Leave uses the same role-aware Pending definition in the sidebar and management table. For
   * example, Endorsed is pending at HR's desk and Reviewed is pending at the Director's desk. An
   * employee's own pending filing is a status to monitor, not an approval task, so employee
   * accounts do not receive Leave or CTO action badges here. Travel orders and CTO are fetched
   * only for the roles with a signature to give on them -- see the desk maps above.
   */
  const managesLeaveModules = canManageLeave(user);
  const tracksPendingLeaveRequests = managesLeaveModules;
  const canActOnOvertime = Boolean(OVERTIME_DESK_STATUSES_BY_ROLE[deskRoleKey]);
  const canActOnTravelOrders = hasTravelOrderDesk(roleKey);
  const tracksPendingCompensatoryRequests = hasCompensatoryDesk(deskRoleKey);
  const payrollDeskRoleKey = roleKey === "chief" && !isFadDivisionChiefUser(user) ? "" : deskRoleKey;
  const canActOnPayrollApprovals = Boolean(PAYROLL_APPROVAL_STAGES_BY_ROLE[payrollDeskRoleKey]?.length);
  /*
   * Leave monetization is filed as a leave type and reviewed in the leave list, so its pending
   * filings count towards the Leave badge rather than a payroll one.
   */
  const canActOnLeaveMonetizationRequests = ["admin", "hrhead", "regionaldirector"].includes(roleKey);
  const showsPendingBadges = tracksPendingLeaveRequests
    || canActOnOvertime
    || canActOnTravelOrders
    || tracksPendingCompensatoryRequests;
  const showsPayrollPendingBadges = canActOnPayrollApprovals;
  /*
   * Only the modules the signed-in person may open are listed. Unchecking a module in RBAC
   * Management removes its entry here as soon as the session is re-read -- App refreshes it on the
   * `permissions` change topic -- rather than leaving a link that answers with Access Denied. A
   * group stays while any of its children is still permitted.
   *
   * This is presentation only: nothing here grants access. The page still checks the permission
   * before it renders, and every API the page would call re-checks on the server. A user object
   * with no permissions map at all (a session still restoring) is listed unfiltered, since there is
   * nothing yet to filter against.
   */
  const permittedNavigationItems = useMemo(
    () => (user?.permissions && typeof user.permissions === "object"
      ? filterNavigationItemsByPermissions(navigationItems, user)
      : navigationItems),
    [navigationItems, user]
  );
  const hasLeaveNavigationItem = useMemo(
    () => permittedNavigationItems.some((item) => item.key === "leave" && !item.hidden),
    [permittedNavigationItems]
  );
  const hasPayrollNavigationItem = useMemo(
    () => permittedNavigationItems.some((item) => (
      !item.hidden
      && (
        ["payroll", "payrollGenerate"].includes(item.key)
        || item.children?.some((child) => child.key === "payrollGenerate" && !child.hidden)
      )
    )),
    [permittedNavigationItems]
  );
  /* The IPCR entry is a child of the Performance Reviews group on every role that has it. */
  const hasIpcrNavigationItem = useMemo(
    () => permittedNavigationItems.some((item) => !item.hidden
      && Array.isArray(item.children)
      && item.children.some((child) => child.key === "performanceIpcr")),
    [permittedNavigationItems]
  );
  const showsIpcrPendingBadge = hasIpcrApprovalBadge(roleKey);
  const hasPromotionsNavigationItem = useMemo(
    () => permittedNavigationItems.some((item) => item.key === "promotions" && !item.hidden),
    [permittedNavigationItems]
  );
  const showsPromotionPendingBadge = hasPromotionDesk(roleKey);
  const showsEmployeePromotionBadge = roleKey === "employee";
  const resolvedNavigationStyle = useMemo(
    () => ({
      ...(VARIANT_NAVIGATION_STYLE[variant] || VARIANT_NAVIGATION_STYLE.default),
      ...navigationStyle,
    }),
    [navigationStyle, variant]
  );
  const isCrimson = variant === "crimson";
  const displayCollapsed = collapsed && !mobileOpen;
  /*
   * Profile remains available from the account menu in the header. Keeping this rule in the shared
   * sidebar removes the duplicate "My Profile" entry for every current and future role without
   * disabling the profile route itself.
   */
  const sidebarNavigationItems = useMemo(
    () => permittedNavigationItems.filter((item) => {
      const key = String(item?.key || "").trim().toLowerCase();
      const label = String(item?.label || "").trim().toLowerCase();

      return key !== "messages" && key !== "profile" && label !== "my profile";
    }),
    [permittedNavigationItems]
  );
  const prefersReducedMotion = useReducedMotion();
  const surfaceTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };
  const submenuTransition = {
    duration: prefersReducedMotion ? 0 : 0.22,
    ease: [0.22, 1, 0.36, 1],
  };
  const matchesPath = useMemo(
    () => (path) => {
      const current = String(activePath || "").trim();
      if (!path || !current) {
        return false;
      }

      return current === path || current.startsWith(`${path}/`);
    },
    [activePath]
  );

  useEffect(() => {
    setExpandedItems((current) => {
      let hasChanges = false;
      const next = { ...current };

      permittedNavigationItems.forEach((item) => {
        if (!item.children?.length) {
          return;
        }

        const hasActiveChild = item.children.some(
          (child) => matchesPath(child.path) || activeModule === child.key
        );

        if (hasActiveChild && !next[item.key]) {
          next[item.key] = true;
          hasChanges = true;
        }
      });

      return hasChanges ? next : current;
    });
  }, [activeModule, matchesPath, permittedNavigationItems]);

  const toggleExpandedItem = (itemKey) => {
    setExpandedItems((current) => ({
      ...current,
      [itemKey]: !current[itemKey],
    }));
  };

  const clearEmployeePromotionBadge = () => {
    if (!showsEmployeePromotionBadge || !hasUnviewedPromotionBadge) {
      return;
    }

    // Clear immediately so the navigation feels like the acknowledgement it is. If persistence
    // fails, restore it; the next refresh will also pick up the server's authoritative state.
    setHasUnviewedPromotionBadge(false);
    void Promise.resolve(markPromotionsViewed()).catch((error) => {
      console.error("Failed to mark promotions as viewed:", error);
      setHasUnviewedPromotionBadge(true);
    });
  };

  const handleNavigate = (path, key) => {
    onCloseMobile?.();

    if (key === "promotions") {
      clearEmployeePromotionBadge();
    }

    if (onNavigate) {
      onNavigate(path);
      return;
    }

    onSelectModule?.(key);
  };

  const matchesNavigationItem = (item) => {
    if (!item?.path) {
      return false;
    }

    const current = String(activePath || "").trim();

    if (item.exact) {
      return current === item.path;
    }

    return matchesPath(item.path);
  };

  const getLeaveChildPendingCount = (childKey) => {
    return pendingLeaveCounts[childKey] || 0;
  };

  const getParentPendingCount = (item) => {
    if (item.key === "attendance") {
      return pendingAttendanceCount;
    }

    if (["payroll", "payrollGenerate"].includes(item.key)) {
      return pendingPayrollCount;
    }

    if (item.key === "leave") {
      return Array.isArray(item.children) && item.children.length > 0
        ? item.children.reduce((total, child) => total + getLeaveChildPendingCount(child.key), 0)
        : permittedNavigationItems.some((entry) => ["travel", "cto"].includes(entry.key))
        ? getLeaveChildPendingCount("leave")
        : pendingLeaveCount;
    }

    if (["travel", "cto"].includes(item.key)) {
      return getLeaveChildPendingCount(item.key);
    }

    if (item.key === "performanceManagement") {
      return pendingIpcrCount;
    }

    if (item.key === "promotions") {
      return pendingPromotionCount;
    }

    return 0;
  };

  useEffect(() => {
    if (!hasLeaveNavigationItem || !showsPendingBadges) {
      setPendingLeaveCount(0);
      setPendingAttendanceCount(0);
      setPendingLeaveCounts(emptyLeavePendingCounts);
      return undefined;
    }

    let active = true;

    const loadPendingLeaveCount = async () => {
      try {
        // Only call the APIs that can produce a task for this role. `allSettled` reports a null
        // placeholder as fulfilled with `value: null`, which the array guards below turn into an
        // empty list.
        const [
          leaveResult,
          travelResult,
          compensatoryResult,
          overtimeResult,
          leaveMonetizationResult,
        ] = await Promise.allSettled([
          tracksPendingLeaveRequests ? fetchLeaveRequests() : null,
          canActOnTravelOrders ? fetchTravelOrders() : null,
          tracksPendingCompensatoryRequests ? fetchCompensatoryRequests() : null,
          canActOnOvertime ? fetchOvertimeRequests() : null,
          canActOnLeaveMonetizationRequests ? fetchLeaveMonetizationRequests() : null,
        ]);

        if (!active) {
          return;
        }

        const leaveRequests =
          leaveResult.status === "fulfilled" && Array.isArray(leaveResult.value?.requests)
            ? leaveResult.value.requests
            : [];
        const travelRequests =
          travelResult.status === "fulfilled" && Array.isArray(travelResult.value?.requests)
            ? travelResult.value.requests
            : [];
        const compensatoryRecords =
          compensatoryResult.status === "fulfilled" && Array.isArray(compensatoryResult.value?.records)
            ? compensatoryResult.value.records
            : [];
        const overtimeRecords =
          overtimeResult.status === "fulfilled" && Array.isArray(overtimeResult.value?.records)
            ? overtimeResult.value.records
            : [];
        /* Shown in the leave list, so pending monetization filings share the Leave badge. */
        const leaveMonetizationRecords =
          leaveMonetizationResult.status === "fulfilled" && Array.isArray(leaveMonetizationResult.value?.records)
            ? leaveMonetizationResult.value.records
            : [];

        // No per-user scoping: every role that reaches here is an approver, and an approver's badge
        // is meant to count the whole queue rather than only the requests they filed themselves.
        const nextPendingCounts = {
          leave: countPendingLeaveRequests(leaveRequests, roleKey)
            + countPendingLeaveRequests(leaveMonetizationRecords, roleKey),
          travel: countPendingTravelOrders(travelRequests, roleKey),
          passSlip: 0,
          cto: countPendingCompensatoryRequests(compensatoryRecords, deskRoleKey),
          overtime: countPendingOvertimeRequests(overtimeRecords, deskRoleKey),
        };
        const totalPendingLeaveCount = [
          nextPendingCounts.leave,
          nextPendingCounts.travel,
          nextPendingCounts.cto,
        ].reduce(
          (total, count) => total + count,
          0
        );

        setPendingLeaveCount(totalPendingLeaveCount);
        setPendingAttendanceCount(nextPendingCounts.overtime);
        setPendingLeaveCounts(nextPendingCounts);
      } catch (error) {
        if (active) {
          setPendingLeaveCount(0);
          setPendingAttendanceCount(0);
          setPendingLeaveCounts(emptyLeavePendingCounts);
        }
      }
    };

    const handleRefresh = () => {
      void loadPendingLeaveCount();
    };

    handleRefresh();
    window.addEventListener(LEAVE_REQUESTS_CHANGED_EVENT, handleRefresh);
    window.addEventListener("focus", handleRefresh);
    /* Monetization filings announce themselves on their own topic rather than that event. */
    const unsubscribeAutoRefresh = subscribeAutoRefresh(handleRefresh, {
      topics: ["leave_monetization"],
    });
    const refreshIntervalId = window.setInterval(handleRefresh, scalePollInterval(30000));

    return () => {
      active = false;
      window.removeEventListener(LEAVE_REQUESTS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
      unsubscribeAutoRefresh();
      window.clearInterval(refreshIntervalId);
    };
  }, [
    tracksPendingLeaveRequests,
    canActOnLeaveMonetizationRequests,
    tracksPendingCompensatoryRequests,
    canActOnOvertime,
    canActOnTravelOrders,
    deskRoleKey,
    hasLeaveNavigationItem,
    roleKey,
    showsPendingBadges,
  ]);

  useEffect(() => {
    if (!hasPayrollNavigationItem || !showsPayrollPendingBadges) {
      setPendingPayrollCount(0);
      setPendingPayrollCounts(emptyPayrollPendingCounts);
      return undefined;
    }

    let active = true;

    const loadPendingPayrollCount = async () => {
      try {
        const payrollResult = await fetchPayrollRecords();

        if (!active) {
          return;
        }

        const payrollRecords =
          Array.isArray(payrollResult?.records)
            ? payrollResult.records
            : [];
        const nextPendingCounts = {
          payrollGenerate: countPendingPayrollRegistries(payrollRecords, payrollDeskRoleKey),
          payrollLoan: 0,
        };
        const totalPendingPayrollCount = Object.values(nextPendingCounts).reduce(
          (total, count) => total + count,
          0
        );

        setPendingPayrollCount(totalPendingPayrollCount);
        setPendingPayrollCounts(nextPendingCounts);
      } catch (error) {
        if (active) {
          setPendingPayrollCount(0);
          setPendingPayrollCounts(emptyPayrollPendingCounts);
        }
      }
    };

    const handleRefresh = () => {
      void loadPendingPayrollCount();
    };

    handleRefresh();
    const unsubscribeAutoRefresh = subscribeAutoRefresh(handleRefresh, {
      topics: ["payroll"],
    });
    window.addEventListener("focus", handleRefresh);
    const refreshIntervalId = window.setInterval(handleRefresh, scalePollInterval(30000));

    return () => {
      active = false;
      unsubscribeAutoRefresh();
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(refreshIntervalId);
    };
  }, [
    canActOnPayrollApprovals,
    payrollDeskRoleKey,
    hasPayrollNavigationItem,
    showsPayrollPendingBadges,
  ]);

  useEffect(() => {
    if (!hasIpcrNavigationItem || !showsIpcrPendingBadge) {
      setPendingIpcrCount(0);
      return undefined;
    }

    let active = true;

    const loadPendingIpcrCount = async () => {
      try {
        // The server already scopes this: the whole queue for HR, their own division for a chief.
        const result = await fetchIpcrRecords({ status: "pending_approval" });

        if (!active) {
          return;
        }

        setPendingIpcrCount(countPendingIpcrAssignments(Array.isArray(result?.records) ? result.records : [], roleKey));
      } catch (error) {
        if (active) {
          setPendingIpcrCount(0);
        }
      }
    };

    const handleRefresh = () => {
      void loadPendingIpcrCount();
    };

    handleRefresh();
    const unsubscribeAutoRefresh = subscribeAutoRefresh(handleRefresh, {
      topics: ["ipcr"],
    });
    window.addEventListener("focus", handleRefresh);
    const refreshIntervalId = window.setInterval(handleRefresh, scalePollInterval(30000));

    return () => {
      active = false;
      unsubscribeAutoRefresh();
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(refreshIntervalId);
    };
  }, [hasIpcrNavigationItem, roleKey, showsIpcrPendingBadge]);

  useEffect(() => {
    if (!hasPromotionsNavigationItem || (!showsPromotionPendingBadge && !showsEmployeePromotionBadge)) {
      setPendingPromotionCount(0);
      setHasUnviewedPromotionBadge(false);
      return undefined;
    }

    let active = true;

    const loadPendingPromotionCount = async () => {
      try {
        const result = await fetchPromotions();

        if (!active) {
          return;
        }

        const promotions = Array.isArray(result?.promotions) ? result.promotions : [];

        setPendingPromotionCount(
          showsPromotionPendingBadge ? countPendingPromotions(promotions, roleKey) : 0
        );
        setHasUnviewedPromotionBadge(
          showsEmployeePromotionBadge && hasUnviewedEmployeePromotion(promotions)
        );
      } catch (error) {
        if (active) {
          setPendingPromotionCount(0);
          setHasUnviewedPromotionBadge(false);
        }
      }
    };

    const handleRefresh = () => {
      void loadPendingPromotionCount();
    };

    handleRefresh();
    const unsubscribeAutoRefresh = subscribeAutoRefresh(handleRefresh, {
      topics: ["promotion"],
    });
    window.addEventListener(PROMOTIONS_CHANGED_EVENT, handleRefresh);
    window.addEventListener("focus", handleRefresh);
    const refreshIntervalId = window.setInterval(handleRefresh, scalePollInterval(30000));

    return () => {
      active = false;
      unsubscribeAutoRefresh();
      window.removeEventListener(PROMOTIONS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(refreshIntervalId);
    };
  }, [
    hasPromotionsNavigationItem,
    roleKey,
    showsEmployeePromotionBadge,
    showsPromotionPendingBadge,
  ]);

  return (
    <aside
      className={`admin-sidebar fixed left-0 top-0 z-50 flex h-screen flex-col overflow-visible border-r transition-all duration-300 ${
        isCrimson
          ? "border-[#911212] bg-gradient-to-b from-[#D61E1E] to-[#911212]"
          : "border-slate-200 bg-white"
      } ${
        displayCollapsed ? "w-64 lg:w-16" : "w-64 lg:w-72"
      } ${
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}
    >
      {onToggleCollapse ? (
        <button
          type="button"
          aria-label={displayCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapse}
          className="admin-sidebar-collapse absolute left-full top-3.5 z-20 ml-4 hidden h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#D61E1E] lg:inline-flex"
        >
          <motion.span
            className="grid place-items-center"
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            whileHover={prefersReducedMotion ? undefined : { scale: 1.15 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
          >
            <Menu size={16} />
          </motion.span>
        </button>
      ) : null}

      {/*
        * The scrim is the primary way out of the drawer, but it is only a strip of dimmed page on a
        * phone — small, and not obviously a control. This gives the gesture a visible target.
        */}
      {onCloseMobile ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={onCloseMobile}
          className={`absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg transition lg:hidden ${
            isCrimson
              ? "bg-white/15 text-white hover:bg-white/25"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          <X size={16} />
        </button>
      ) : null}

      <div
        className={`admin-sidebar-brand flex shrink-0 flex-col items-center justify-center border-b px-3 ${
          isCrimson ? "border-white/20" : "border-slate-200"
        } ${displayCollapsed ? "py-3" : "py-4"}`}
      >
        <motion.div
          className={`admin-sidebar-brand-logo grid shrink-0 place-items-center overflow-hidden rounded-full bg-white shadow-md transition-[height,width] duration-300 ${
            isCrimson ? "" : "border border-slate-200"
          } ${displayCollapsed ? "h-11 w-11" : "h-14 w-14"}`}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          whileHover={prefersReducedMotion ? undefined : { scale: 1.06 }}
        >
          <img
            src="/mgb.png"
            alt="MGB logo"
            className={`object-contain ${displayCollapsed ? "h-8 w-8" : "h-11 w-11"}`}
          />
        </motion.div>
        {!displayCollapsed && (
          <motion.p
            animate={{ opacity: 1 }}
            className={`admin-sidebar-brand-text m-0 mt-3 text-center text-[11px] font-bold uppercase leading-snug tracking-[0.1em] ${
              isCrimson ? "text-white" : "text-slate-800"
            }`}
            initial={{ opacity: 0 }}
            transition={{ delay: prefersReducedMotion ? 0 : 0.1, duration: 0.22 }}
          >
            Mines and Geosciences Bureau X
          </motion.p>
        )}
      </div>

      <nav
        className={`admin-sidebar-nav min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain py-4 ${
          isCrimson ? "admin-sidebar-nav-on-dark" : ""
        } ${displayCollapsed ? "px-2" : "px-3"}`}
        aria-label="Primary"
      >
        <LayoutGroup>
        <motion.div
          animate="visible"
          className="grid gap-1"
          initial={prefersReducedMotion ? false : "hidden"}
          variants={NAV_LIST_VARIANTS}
        >
        {sidebarNavigationItems.map((item) => {
          if (item.type === "section") {
            const sectionLabel = getRoleOperationsLabel(item.label, user);

            // Collapsed, the label has nowhere to go — a rule keeps the grouping readable.
            return displayCollapsed ? (
              <motion.div
                key={`section-${sectionLabel}`}
                className={`mx-auto my-2 h-px w-8 first:hidden ${isCrimson ? "bg-white/20" : "bg-slate-200"}`}
                variants={NAV_ITEM_VARIANTS}
              />
            ) : (
              // Space above the label is what separates the groups; there is no rule to lean on.
              <motion.p
                key={`section-${sectionLabel}`}
                className={`admin-sidebar-section m-0 px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] first:pt-1 ${
                  isCrimson ? "text-white/75" : "text-slate-500"
                }`}
                variants={NAV_ITEM_VARIANTS}
              >
                {sectionLabel}
              </motion.p>
            );
          }

          if (item.hidden) {
            return null;
          }

          const Icon = item.icon;
          const hasChildren = Array.isArray(item.children) && item.children.length > 0;
          const hasActiveChild = hasChildren
            ? item.children.some((child) => (activePath ? matchesNavigationItem(child) : activeModule === child.key))
            : false;
          const isExpanded = Boolean(expandedItems[item.key]);
          const isActive = hasActiveChild || (activePath ? matchesNavigationItem(item) : activeModule === item.key);
          const parentPendingCount = getParentPendingCount(item);
          const hasEmployeePromotionBadge = item.key === "promotions" && hasUnviewedPromotionBadge;
          const notificationCount = hasEmployeePromotionBadge ? 1 : parentPendingCount;
          const notificationLabel = hasEmployeePromotionBadge ? "!" : undefined;
          const notificationTitle = hasEmployeePromotionBadge
            ? `${item.label}: new promotion`
            : `${item.label} (${parentPendingCount} pending)`;
          const showPendingBadge = notificationCount > 0;

          // Collapsed there is no submenu to point at, so the parent itself carries the highlight.
          const branchOnly = hasActiveChild && !displayCollapsed;
          const showParentSurface = isActive && !branchOnly;

          if (hasChildren) {
            return (
              <motion.div key={item.label} className="space-y-1" variants={NAV_ITEM_VARIANTS}>
                <button
                  type="button"
                  title={displayCollapsed && showPendingBadge ? notificationTitle : item.label}
                  data-active={isActive}
                  onClick={() => {
                    if (displayCollapsed) {
                      onToggleCollapse?.();
                      setExpandedItems((current) => ({ ...current, [item.key]: true }));
                      return;
                    }
                    toggleExpandedItem(item.key);
                  }}
                  className={`admin-sidebar-item group relative flex min-h-9 w-full items-center gap-3 rounded-lg text-sm transition-colors duration-150 ${
                    displayCollapsed ? "justify-center px-0" : "justify-between px-3"
                  } ${
                    branchOnly
                      ? `${resolvedNavigationStyle.branchSurface} ${resolvedNavigationStyle.branchText}`
                      : showParentSurface
                      ? resolvedNavigationStyle.activeText
                      : resolvedNavigationStyle.inactiveItem
                  }`}
                >
                  {showParentSurface ? (
                    <ActiveSurface
                      radiusClass="rounded-lg"
                      surfaceClass={resolvedNavigationStyle.activeSurface}
                      transition={surfaceTransition}
                    />
                  ) : (
                    <HoverRail toneClass={resolvedNavigationStyle.hoverRail} />
                  )}
                  <span className={`relative z-[1] flex min-w-0 items-center gap-3 ${HOVER_SHIFT_CLASS}`}>
                    <Icon
                      size={16}
                      className="shrink-0 transition-transform duration-200 motion-safe:group-hover:scale-110"
                    />
                    {displayCollapsed ? null : (
                      <motion.span
                        animate={{ opacity: 1 }}
                        className="truncate"
                        initial={{ opacity: 0 }}
                        transition={{ delay: prefersReducedMotion ? 0 : 0.08, duration: 0.2 }}
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </span>
                  {displayCollapsed ? (
                    /* The rail has no room beside the icon, so the count sits on its corner instead. */
                    showPendingBadge ? (
                      <NotificationBadge
                        count={notificationCount}
                        label={notificationLabel}
                        className={`${COLLAPSED_BADGE_CLASS} ${isActive ? "ring-white/70" : ""}`}
                      />
                    ) : null
                  ) : (
                    <span className="relative z-[1] flex shrink-0 items-center gap-2">
                      {showPendingBadge ? (
                        <NotificationBadge
                          count={notificationCount}
                          label={notificationLabel}
                          inline
                          className={isActive ? "ring-white/70" : ""}
                        />
                      ) : null}
                      <ChevronDown
                        size={16}
                        className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </span>
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && !displayCollapsed ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={submenuTransition}
                      className="overflow-hidden"
                    >
                      {/* ml-5 lands the rule under the centre of the parent icon. */}
                      <div className={`admin-sidebar-children ml-5 grid gap-0.5 border-l pl-3 pt-1 ${isCrimson ? "border-white/20" : "border-slate-200"}`}>
                        {item.children.map((child) => {
                          const childIsActive = activePath ? matchesNavigationItem(child) : activeModule === child.key;
                          const childPendingCount =
                            item.key === "leave" || item.key === "attendance"
                              ? getLeaveChildPendingCount(child.key)
                              : item.key === "payroll"
                                ? pendingPayrollCounts[child.key] || 0
                                : child.key === "performanceIpcr"
                                  ? pendingIpcrCount
                                  : 0;

                          return (
                            <a
                              href={child.path}
                              key={child.key}
                              data-active={childIsActive}
                              onClick={(event) => {
                                event.preventDefault();
                                handleNavigate(child.path, child.key);
                              }}
                              className={`admin-sidebar-child group relative flex min-h-8 items-center justify-between gap-2 rounded-md px-3 text-[12.5px] transition-colors duration-150 ${
                                childIsActive
                                  ? resolvedNavigationStyle.activeText
                                  : resolvedNavigationStyle.inactiveChild
                              }`}
                            >
                              {childIsActive ? (
                                <ActiveSurface
                                  radiusClass="rounded-md"
                                  surfaceClass={resolvedNavigationStyle.activeSurface}
                                  transition={surfaceTransition}
                                />
                              ) : null}
                              <span className={`relative z-[1] truncate ${HOVER_SHIFT_CLASS}`}>
                                {child.label}
                              </span>
                              {!["passSlip", "payrollLoan"].includes(child.key) && childPendingCount > 0 ? (
                                <NotificationBadge
                                  count={childPendingCount}
                                  inline
                                  className={`relative z-[1] ${childIsActive ? "ring-white/70" : ""}`}
                                />
                              ) : null}
                            </a>
                          );
                        })}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            );
          }

          return (
            <motion.a
              href={item.path}
              key={item.label}
              data-active={isActive}
              onClick={(event) => {
                event.preventDefault();
                handleNavigate(item.path, item.key);
              }}
              title={displayCollapsed && showPendingBadge ? notificationTitle : item.label}
              variants={NAV_ITEM_VARIANTS}
              className={`admin-sidebar-item group relative flex min-h-9 items-center gap-3 rounded-lg text-sm transition-colors duration-150 ${
                displayCollapsed ? "justify-center px-0" : "justify-between px-3"
              } ${
                isActive
                  ? resolvedNavigationStyle.activeText
                  : resolvedNavigationStyle.inactiveItem
              }`}
            >
              {isActive ? (
                <ActiveSurface
                  radiusClass="rounded-lg"
                  surfaceClass={resolvedNavigationStyle.activeSurface}
                  transition={surfaceTransition}
                />
              ) : (
                <HoverRail toneClass={resolvedNavigationStyle.hoverRail} />
              )}
              <span className={`relative z-[1] flex min-w-0 items-center gap-3 ${HOVER_SHIFT_CLASS}`}>
                <Icon
                  size={16}
                  className="shrink-0 transition-transform duration-200 motion-safe:group-hover:scale-110"
                />
                {displayCollapsed ? null : (
                  <motion.span
                    animate={{ opacity: 1 }}
                    className="truncate"
                    initial={{ opacity: 0 }}
                    transition={{ delay: prefersReducedMotion ? 0 : 0.08, duration: 0.2 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </span>
              {showPendingBadge ? (
                displayCollapsed ? (
                  <NotificationBadge
                    count={notificationCount}
                    label={notificationLabel}
                    className={`${COLLAPSED_BADGE_CLASS} ${isActive ? "ring-white/70" : ""}`}
                  />
                ) : (
                  <NotificationBadge
                    count={notificationCount}
                    label={notificationLabel}
                    inline
                    className={`relative z-[1] ${isActive ? "ring-white/70" : ""}`}
                  />
                )
              ) : null}
            </motion.a>
          );
        })}
        </motion.div>
        </LayoutGroup>
      </nav>

    </aside>
  );
}
