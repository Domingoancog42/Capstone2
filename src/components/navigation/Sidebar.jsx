import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Menu,
  MessageCircle,
  ScrollText,
  ShieldCheck,
  Trophy,
  Users,
  X,
} from "lucide-react";
import NotificationBadge from "../UI/NotificationBadge";
import { subscribeAutoRefresh } from "../../components/auto/autorefreshconfig";
import { buildReportNavChildren } from "../../module/reports/reportCategories";
import {
  fetchLeaveRequests,
  LEAVE_REQUESTS_CHANGED_EVENT,
} from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchLoanRequests } from "../../services/loanService";
import { fetchLeaveMonetizationRequests } from "../../services/leaveMonetizationService";
import { fetchPayrollRecords } from "../../services/payrollService";
import {
  canManageLeave,
  countPendingRecords,
  normalizeRequestStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { getRoleLabel } from "../../utils/roleRoutes";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

const defaultNavigationItems = [
  { type: "section", label: "Main" },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { key: "employees", label: "Employee Directory", icon: Users, path: "/admin/employees" },
  { key: "calendar", label: "Work Calendar", icon: CalendarDays, path: "/admin/calendar" },
  { type: "section", label: "Communication" },
  { key: "messages", label: "Messages", icon: MessageCircle, path: "/admin/messages" },
  { key: "notifications", label: "Notifications", path: "/admin/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  { key: "serviceRecord", label: "Service Record", icon: ScrollText, path: "/admin/service-record" },
  {
    key: "rewardsRecognition",
    label: "Recognition & Rewards",
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
    label: "Performance Reviews",
    icon: BarChart3,
    path: "/admin/masterfiles/performance-management/opcr",
    children: [
      { key: "performanceOpcr", label: "OPCR", path: "/admin/masterfiles/performance-management/opcr" },
      { key: "performanceIpcr", label: "IPCR", path: "/admin/masterfiles/performance-management/ipcr" },
    ],
  },
  {
    key: "leaveBalances",
    label: "Leave Balances",
    icon: ClipboardList,
    path: "/admin/masterfiles/leave-balances",
  },
  {
    key: "attendance",
    label: "Time & Attendance",
    icon: ClipboardCheck,
    path: "/admin/attendance",
    children: [
      { key: "attendance", label: "Import Attendance", path: "/admin/attendance", exact: true },
      { key: "overtime", label: "Overtime", path: "/admin/attendance/overtime" },
    ],
  },
  {
    key: "leave",
    label: "Leave Management",
    icon: CalendarRange,
    path: "/admin/leave",
    children: [
      { key: "leave", label: "Leave", path: "/admin/leave", exact: true },
      { key: "travel", label: "Travel Order", path: "/admin/leave/travel-order" },
      { key: "cto", label: "Compensatory Time Off", path: "/admin/leave/compensatory-time-off" },
      { key: "passSlip", label: "Pass Slips", path: "/admin/leave/pass-slips" },
    ],
  },
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
    children: buildReportNavChildren("/admin/reports"),
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

function getPayrollRegistryGroupKey(record = {}) {
  return [
    record.division || "Unassigned",
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
 * The travel orders this role still has to sign.
 *
 * A travel order carries two signatures: the Planning Officer recommends a Pending order, which
 * moves it to Reviewed, and only then does the Regional Director approve it. A Reviewed order is
 * therefore already past the planning desk, so counting it would pin a number to their sidebar that
 * no action of theirs could clear — the same trap an employee's own pending request used to be.
 * Every other approver acts on both rungs, so they keep the shared pending count.
 */
function countPendingTravelOrders(records = [], roleKey = "") {
  if (roleKey !== "planningofficer") {
    return countPendingRecords(records);
  }

  return records.reduce(
    (count, record) => count + (normalizeRequestStatus(record?.status) === "Pending" ? 1 : 0),
    0
  );
}

/*
 * CTO requests move through three different desks. A badge is a to-do count, so each role only
 * sees the status it can act on; after the Chief endorses a request, it must disappear from the
 * Chief's count and move to the HR Head's instead. Admin may stand in at every open stage.
 */
const COMPENSATORY_APPROVAL_STATUSES_BY_ROLE = {
  admin: ["Pending", "Endorsed", "Reviewed"],
  chief: ["Pending"],
  hrhead: ["Endorsed"],
  regionaldirector: ["Reviewed"],
};

export function countPendingCompensatoryRequests(records = [], roleKey = "") {
  const actionableStatuses = COMPENSATORY_APPROVAL_STATUSES_BY_ROLE[roleKey] || [];

  return records.reduce(
    (count, record) => count + (actionableStatuses.includes(normalizeRequestStatus(record?.status)) ? 1 : 0),
    0
  );
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
  const [expandedItems, setExpandedItems] = useState({});
  const userName = user?.full_name || user?.username || "Admin";
  const profileImageUrl = resolveBackendAssetUrl(user?.profile_image || user?.profileImage);
  const roleKey = resolveRoleKey(user);
  /*
   * A pending badge means "these are waiting for you to act", so only the roles that can actually
   * act on a request get one. An employee's own pending request is a status, not a task — counting
   * it here put a permanent "1" on their sidebar that no action of theirs could ever clear.
   *
   * The badges have different audiences because the APIs do: leave_request.php lets admin, hrhead,
   * hrstaff and regionaldirector act; overtime.php allows those four plus chief and
   * planningofficer, which work the same division desk; travel_order.php adds only the planning
   * officer to the first four. CTO has its own Chief, HR Head, Regional Director chain.
   * HR Staff intentionally have no Leave or Travel Order to-do badge because those workspaces are
   * record-monitoring views for them, not approval queues.
   */
  const managesLeaveModules = canManageLeave(user);
  const hidesHrStaffLeaveBadges = roleKey === "hrstaff";
  const canActOnLeaveRequests = managesLeaveModules && !hidesHrStaffLeaveBadges;
  const canActOnOvertime = managesLeaveModules || ["chief", "planningofficer"].includes(roleKey);
  const canActOnTravelOrders = (managesLeaveModules || roleKey === "planningofficer")
    && !hidesHrStaffLeaveBadges;
  const canActOnCompensatoryRequests = Boolean(COMPENSATORY_APPROVAL_STATUSES_BY_ROLE[roleKey]?.length);
  const canActOnPayrollApprovals = Boolean(PAYROLL_APPROVAL_STAGES_BY_ROLE[roleKey]?.length);
  const canActOnLoanRequests = ["admin", "hrhead", "hrstaff", "regionaldirector"].includes(roleKey);
  /*
   * Leave monetization is filed as a leave type and reviewed in the leave list, so its pending
   * filings count towards the Leave badge rather than a payroll one.
   */
  const canActOnLeaveMonetizationRequests = ["admin", "hrhead", "regionaldirector"].includes(roleKey);
  const showsPendingBadges = canActOnLeaveRequests
    || canActOnOvertime
    || canActOnTravelOrders
    || canActOnCompensatoryRequests;
  const showsPayrollPendingBadges = canActOnPayrollApprovals || canActOnLoanRequests;
  /*
   * The sidebar deliberately lists every item the role has, including ones the signed-in user has
   * no permission for. Removing an entry made a revoked module simply vanish, which reads as the
   * feature being gone rather than restricted. The entry stays and the page it opens answers with
   * Access Denied, so the boundary is visible and explains itself.
   *
   * This is presentation only — nothing here grants access. The page still checks the permission
   * before it renders, and every API the page would call re-checks on the server.
   */
  const hasLeaveNavigationItem = useMemo(
    () => navigationItems.some((item) => item.key === "leave" && !item.hidden),
    [navigationItems]
  );
  const hasPayrollNavigationItem = useMemo(
    () => navigationItems.some((item) => item.key === "payroll" && !item.hidden),
    [navigationItems]
  );
  const resolvedNavigationStyle = useMemo(
    () => ({
      ...(VARIANT_NAVIGATION_STYLE[variant] || VARIANT_NAVIGATION_STYLE.default),
      ...navigationStyle,
    }),
    [navigationStyle, variant]
  );
  const isCrimson = variant === "crimson";
  const displayCollapsed = collapsed && !mobileOpen;
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

      navigationItems.forEach((item) => {
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
  }, [activeModule, matchesPath, navigationItems]);

  const toggleExpandedItem = (itemKey) => {
    setExpandedItems((current) => ({
      ...current,
      [itemKey]: !current[itemKey],
    }));
  };

  const handleNavigate = (path, key) => {
    onCloseMobile?.();

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

    if (item.key === "payroll") {
      return pendingPayrollCount;
    }

    if (item.key === "leave") {
      return Array.isArray(item.children) && item.children.length > 0
        ? item.children.reduce((total, child) => total + getLeaveChildPendingCount(child.key), 0)
        : pendingLeaveCount;
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
          canActOnLeaveRequests ? fetchLeaveRequests() : null,
          canActOnTravelOrders ? fetchTravelOrders() : null,
          canActOnCompensatoryRequests ? fetchCompensatoryRequests() : null,
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
        /* Reviewed in the leave list, so these are part of the Leave badge's queue. */
        const leaveMonetizationRecords =
          leaveMonetizationResult.status === "fulfilled" && Array.isArray(leaveMonetizationResult.value?.records)
            ? leaveMonetizationResult.value.records
            : [];

        // No per-user scoping: every role that reaches here is an approver, and an approver's badge
        // is meant to count the whole queue rather than only the requests they filed themselves.
        const nextPendingCounts = {
          leave: countPendingRecords(leaveRequests) + countPendingRecords(leaveMonetizationRecords),
          travel: countPendingTravelOrders(travelRequests, roleKey),
          passSlip: 0,
          cto: countPendingCompensatoryRequests(compensatoryRecords, roleKey),
          overtime: countPendingRecords(overtimeRecords),
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
    const refreshIntervalId = window.setInterval(handleRefresh, 30000);

    return () => {
      active = false;
      window.removeEventListener(LEAVE_REQUESTS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
      unsubscribeAutoRefresh();
      window.clearInterval(refreshIntervalId);
    };
  }, [
    canActOnLeaveRequests,
    canActOnLeaveMonetizationRequests,
    canActOnCompensatoryRequests,
    canActOnOvertime,
    canActOnTravelOrders,
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
        const [payrollResult, loanResult] = await Promise.allSettled([
          canActOnPayrollApprovals ? fetchPayrollRecords() : null,
          canActOnLoanRequests ? fetchLoanRequests() : null,
        ]);

        if (!active) {
          return;
        }

        const payrollRecords =
          payrollResult.status === "fulfilled" && Array.isArray(payrollResult.value?.records)
            ? payrollResult.value.records
            : [];
        const loanRecords =
          loanResult.status === "fulfilled" && Array.isArray(loanResult.value?.records)
            ? loanResult.value.records
            : [];
        const nextPendingCounts = {
          payrollGenerate: countPendingPayrollRegistries(payrollRecords, roleKey),
          payrollLoan: countPendingRecords(loanRecords),
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
      topics: ["payroll", "loan_request", "loan"],
    });
    window.addEventListener("focus", handleRefresh);
    const refreshIntervalId = window.setInterval(handleRefresh, 30000);

    return () => {
      active = false;
      unsubscribeAutoRefresh();
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(refreshIntervalId);
    };
  }, [
    canActOnPayrollApprovals,
    canActOnLoanRequests,
    hasPayrollNavigationItem,
    roleKey,
    showsPayrollPendingBadges,
  ]);

  return (
    <aside
      className={`admin-sidebar fixed left-0 top-0 z-50 flex h-screen flex-col overflow-visible border-r transition-all duration-300 ${
        isCrimson
          ? "border-[#911212] bg-gradient-to-b from-[#D61E1E] to-[#911212]"
          : "border-slate-200 bg-white"
      } ${
        displayCollapsed ? "w-64 lg:w-16" : "w-64"
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
            Mines and Geosciences Bureau
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
        {navigationItems.map((item) => {
          if (item.type === "section") {
            // Collapsed, the label has nowhere to go — a rule keeps the grouping readable.
            return displayCollapsed ? (
              <motion.div
                key={`section-${item.label}`}
                className={`mx-auto my-2 h-px w-8 first:hidden ${isCrimson ? "bg-white/20" : "bg-slate-200"}`}
                variants={NAV_ITEM_VARIANTS}
              />
            ) : (
              // Space above the label is what separates the groups; there is no rule to lean on.
              <motion.p
                key={`section-${item.label}`}
                className={`admin-sidebar-section m-0 px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] first:pt-1 ${
                  isCrimson ? "text-white/75" : "text-slate-500"
                }`}
                variants={NAV_ITEM_VARIANTS}
              >
                {item.label}
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
          const isActive = hasActiveChild || (activePath ? matchesPath(item.path) : activeModule === item.key);
          const parentPendingCount = getParentPendingCount(item);
          const showPendingBadge = parentPendingCount > 0;

          // Collapsed there is no submenu to point at, so the parent itself carries the highlight.
          const branchOnly = hasActiveChild && !displayCollapsed;
          const showParentSurface = isActive && !branchOnly;

          if (hasChildren) {
            return (
              <motion.div key={item.label} className="space-y-1" variants={NAV_ITEM_VARIANTS}>
                <button
                  type="button"
                  title={item.label}
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
                  {displayCollapsed ? null : (
                    <span className="relative z-[1] flex shrink-0 items-center gap-2">
                      {showPendingBadge ? (
                        <NotificationBadge
                          count={parentPendingCount}
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
                              {child.key !== "passSlip" && childPendingCount > 0 ? (
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
              title={item.label}
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
              {showPendingBadge && !displayCollapsed ? (
                <NotificationBadge
                  count={parentPendingCount}
                  inline
                  className={`relative z-[1] ${isActive ? "ring-white/70" : ""}`}
                />
              ) : null}
            </motion.a>
          );
        })}
        </motion.div>
        </LayoutGroup>
      </nav>

      <div className={`admin-sidebar-footer shrink-0 border-t p-3 ${isCrimson ? "border-white/20" : "border-slate-200"}`}>
        <div
          className={`flex items-center gap-3 rounded-lg p-2 ${
            displayCollapsed ? "justify-center" : isCrimson ? "bg-white/10" : "bg-slate-50"
          }`}
        >
          <div className={`admin-sidebar-avatar grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg ${isCrimson ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"}`}>
            {profileImageUrl ? (
              <img src={profileImageUrl} alt={userName} className="h-full w-full object-cover" />
            ) : (
              <ShieldCheck size={16} />
            )}
          </div>
          <div className={`min-w-0 ${displayCollapsed ? "hidden" : ""}`}>
            <strong className={`admin-sidebar-user-name block truncate text-[13px] font-semibold ${isCrimson ? "text-white" : "text-slate-900"}`}>
              {userName}
            </strong>
            <span className={`admin-sidebar-muted-text block truncate text-[11px] ${isCrimson ? "text-white/70" : "text-slate-500"}`}>
              {getRoleLabel(user?.role || "Administrator")}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
