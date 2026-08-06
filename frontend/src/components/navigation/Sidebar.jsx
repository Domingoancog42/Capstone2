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
import { fetchCashAdvanceRequests } from "../../services/cashAdvanceService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchLoanRequests } from "../../services/loanService";
import { fetchLeaveMonetizationRequests } from "../../services/leaveMonetizationService";
import {
  canManageLeave,
  countPendingRecords,
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
  { key: "messages", label: "Communications", icon: MessageCircle, path: "/admin/messages" },
  { key: "notifications", label: "Notifications", path: "/admin/notifications", hidden: true },
  { type: "section", label: "HR Operations" },
  { key: "serviceRecord", label: "Employee Records", icon: ScrollText, path: "/admin/service-record" },
  {
    key: "rewardsRecognition",
    label: "Recognition & Rewards",
    icon: Trophy,
    path: "/admin/rewards-recognition/nomination",
    children: [
      { key: "rewardsNomination", label: "Nomination", path: "/admin/rewards-recognition/nomination" },
      { key: "rewardsLoyalty", label: "Loyalty", path: "/admin/rewards-recognition/loyalty" },
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
    label: "Leave Administration",
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
      { key: "payrollGenerate", label: "Create Payroll", path: "/admin/payroll/generate" },
      { key: "payrollRecords", label: "Payslip", path: "/admin/payroll/payslip" },
      { key: "payrollLoan", label: "Loan", path: "/admin/payroll/loan" },
      { key: "payrollCashAdvance", label: "Cash Advance", path: "/admin/payroll/cash-advance" },
      { key: "payrollLeaveMonetization", label: "Leave Monetization", path: "/admin/payroll/leave-monetization" },
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
  payrollLoan: 0,
  payrollCashAdvance: 0,
  payrollLeaveMonetization: 0,
};

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
   * The two badges have different audiences because the APIs do: leave_request.php lets admin,
   * hrhead, hrstaff and regionaldirector act; overtime.php allows those four plus chief.
   */
  const canActOnLeaveRequests = canManageLeave(user);
  const canActOnOvertime = canActOnLeaveRequests || roleKey === "chief";
  const canActOnPayrollSupport = ["admin", "hrhead", "hrstaff"].includes(roleKey);
  const canActOnLoanRequests = ["admin", "hrhead", "hrstaff", "regionaldirector"].includes(roleKey);
  const canActOnCashAdvanceRequests = canActOnPayrollSupport;
  const canActOnLeaveMonetizationRequests = ["admin", "hrhead", "hrstaff", "regionaldirector"].includes(roleKey);
  const showsPendingBadges = canActOnLeaveRequests || canActOnOvertime;
  const showsPayrollPendingBadges =
    canActOnLoanRequests
    || canActOnCashAdvanceRequests
    || canActOnLeaveMonetizationRequests;
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
        // A chief can only act on overtime, so the other four calls would fetch a badge they can
        // never be shown. `allSettled` reports a null placeholder as fulfilled with `value: null`,
        // which the array guards below already turn into an empty list.
        const [leaveResult, travelResult, compensatoryResult, overtimeResult] = await Promise.allSettled([
          canActOnLeaveRequests ? fetchLeaveRequests() : null,
          canActOnLeaveRequests ? fetchTravelOrders() : null,
          canActOnLeaveRequests ? fetchCompensatoryRequests() : null,
          canActOnOvertime ? fetchOvertimeRequests() : null,
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

        // No per-user scoping: every role that reaches here is an approver, and an approver's badge
        // is meant to count the whole queue rather than only the requests they filed themselves.
        const nextPendingCounts = {
          leave: countPendingRecords(leaveRequests),
          travel: countPendingRecords(travelRequests),
          passSlip: 0,
          cto: countPendingRecords(compensatoryRecords),
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
    const refreshIntervalId = window.setInterval(handleRefresh, 30000);

    return () => {
      active = false;
      window.removeEventListener(LEAVE_REQUESTS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(refreshIntervalId);
    };
  }, [
    canActOnLeaveRequests,
    canActOnOvertime,
    hasLeaveNavigationItem,
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
        const [
          loanResult,
          cashAdvanceResult,
          leaveMonetizationResult,
        ] = await Promise.allSettled([
          canActOnLoanRequests ? fetchLoanRequests() : null,
          canActOnCashAdvanceRequests ? fetchCashAdvanceRequests() : null,
          canActOnLeaveMonetizationRequests ? fetchLeaveMonetizationRequests() : null,
        ]);

        if (!active) {
          return;
        }

        const loanRecords =
          loanResult.status === "fulfilled" && Array.isArray(loanResult.value?.records)
            ? loanResult.value.records
            : [];
        const cashAdvanceRecords =
          cashAdvanceResult.status === "fulfilled" && Array.isArray(cashAdvanceResult.value?.records)
            ? cashAdvanceResult.value.records
            : [];
        const leaveMonetizationRecords =
          leaveMonetizationResult.status === "fulfilled" && Array.isArray(leaveMonetizationResult.value?.records)
            ? leaveMonetizationResult.value.records
            : [];

        const nextPendingCounts = {
          payrollLoan: countPendingRecords(loanRecords),
          payrollCashAdvance: countPendingRecords(cashAdvanceRecords),
          payrollLeaveMonetization: countPendingRecords(leaveMonetizationRecords),
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
      topics: ["payroll", "loan_request", "loan", "cash_advance", "leave_monetization"],
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
    canActOnCashAdvanceRequests,
    canActOnLeaveMonetizationRequests,
    canActOnLoanRequests,
    hasPayrollNavigationItem,
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
          const showPendingBadge =
            (item.key === "leave" && pendingLeaveCount > 0)
            || (item.key === "attendance" && pendingAttendanceCount > 0)
            || (item.key === "payroll" && pendingPayrollCount > 0);
          const parentPendingCount = item.key === "attendance"
            ? pendingAttendanceCount
            : item.key === "payroll"
              ? pendingPayrollCount
              : pendingLeaveCount;

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
                              ? pendingLeaveCounts[child.key] || 0
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
