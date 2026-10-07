import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Clock3,
  Eye,
  FileText,
  Mail,
  Phone,
  Plane,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../UI/card";
import { DistributionPieChart, useAnalyticsTheme } from "../analytics/analyticsChartKit";
import { SERIES_SLOT_COUNT, assignEntitySlots, normalizeEntityKey } from "../../module/reports/reportsTheme";
import DashboardWelcomeBanner from "./DashboardWelcomeBanner";
import DashboardLeaveManagementAnalytics from "./DashboardLeaveManagementAnalytics";
import DashboardMonthFilter, { currentDashboardPeriod, formatDashboardPeriod } from "./DashboardMonthFilter";
import DashboardAnalytics from "../analytics/DashboardAnalytics";
import Modal from "../UI/modal";
import AdminStatCard from "./AdminStatCard";
import { fetchDashboardAnalytics } from "../../services/analyticsService";
import { subscribeAutoRefresh } from "../auto/autorefreshconfig";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { getRoleBadgeClass, getRoleLabel, resolveUserRoleKey } from "../../utils/roleRoutes";
import {
  formatDateDisplay,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { getNoteDisplay } from "../../utils/dateSelection";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";
import { numberFormatter, wholeCurrencyFormatter as currencyFormatter } from "../../utils/format";

const PENDING_REQUEST_TYPE_META = {
  leave: {
    label: "Leave Requests",
    icon: FileText,
    iconTone: "border-blue-200 bg-blue-50 text-blue-600",
  },
  travel: {
    label: "Travel Orders",
    icon: Plane,
    iconTone: "border-amber-200 bg-amber-50 text-amber-600",
  },
  compensatory: {
    label: "Compensatory Time Off",
    icon: Clock3,
    iconTone: "border-violet-200 bg-violet-50 text-violet-700",
  },
};
const DASHBOARD_REFRESH_TOPICS = [
  "attendance",
  "compensatory",
  "employee",
  "ipcr",
  "leave_request",
  "opcr",
  "pass_slip",
  "payroll",
  "travel_order",
  "user",
];
/*
 * Activity sources keep a fixed categorical slot, resolved against the shared theme at
 * render so the dot follows the source rather than its position in the feed. Stored as
 * an index, not a hex, so light and dark both come from the validated palette.
 */
const ACTIVITY_SLOTS = {
  Attendance: 0,
  Leave: 1,
  Payroll: 2,
  "Travel Order": 3,
  "Pass Slip": 4,
};

const GENERAL_REQUEST_SUMMARY_ROLE_KEYS = new Set(["hrhead", "hrstaff", "regionaldirector"]);

function resolveFirstName(user) {
  const rawName = String(user?.full_name || user?.username || "Admin").trim();
  return rawName.split(/\s+/).filter(Boolean)[0] || "Admin";
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shortMonthLabel(index) {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(new Date().getFullYear(), index, 1));
}

function monthsForYear(year) {
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, index, 1);
    return {
      key: monthKey(date),
      label: shortMonthLabel(index),
      date,
    };
  });
}

function getEmployeeHeadcountDate(employee) {
  return parseDate(
    employee?.dateHired
    || employee?.date_hired
    || employee?.hiredAt
    || employee?.createdAt
    || employee?.created_at
  );
}

function normalizeDivisionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function getEmployeeDivisionName(employee) {
  return [
    employee?.department,
    employee?.division,
    employee?.divisionName,
    employee?.office,
  ]
    .map((value) => String(value || "").trim())
    .find((value) => value !== "") || "Unassigned";
}

function resolveDivisionSummary(divisions = [], employees = []) {
  if (Array.isArray(divisions) && divisions.length > 0) {
    const employeeBuckets = new Map();
    const divisionLookup = new Map();

    divisions.forEach((division) => {
      const name = String(division?.name || "").trim();
      const code = String(division?.code || "").trim();

      if (name) {
        divisionLookup.set(normalizeDivisionKey(name), name);
      }

      if (code) {
        divisionLookup.set(normalizeDivisionKey(code), name || code);
      }
    });

    employees.forEach((employee) => {
      const divisionName = getEmployeeDivisionName(employee);
      const matchedName = divisionLookup.get(normalizeDivisionKey(divisionName));

      if (!matchedName) {
        return;
      }

      const nextEmployees = employeeBuckets.get(matchedName) || [];
      nextEmployees.push(employee);
      employeeBuckets.set(matchedName, nextEmployees);
    });

    return divisions.map((division, index) => {
      const name = String(division?.name || "").trim() || "Unassigned";
      const code = String(division?.code || "").trim();
      const employeeRows = employeeBuckets.get(name) || [];

      return {
        id: String(division?.id || code || name || index),
        name,
        code,
        totalDesignations: Number(division?.total_designations ?? division?.totalDesignations ?? 0) || 0,
        employeeCount: employeeRows.length,
        employees: employeeRows,
      };
    });
  }

  if (employees.length > 0) {
    const groupedEmployees = new Map();

    employees.forEach((employee) => {
      const divisionName = getEmployeeDivisionName(employee);
      const key = normalizeDivisionKey(divisionName);
      const name = divisionName || "Unassigned";
      const group = groupedEmployees.get(key) || {
        name,
        employees: [],
      };

      group.employees.push(employee);
      groupedEmployees.set(key, group);
    });

    return Array.from(groupedEmployees.values()).map((group, index) => ({
      id: normalizeDivisionKey(group.name) || `division-${index}`,
      name: group.name,
      code: "",
      totalDesignations: 0,
      employeeCount: group.employees.length,
      employees: group.employees,
    }));
  }

  return [];
}

function resolveHeadcountGrowth(employees, year) {
  const months = monthsForYear(year);
  const monthlyCounts = new Map(months.map((month) => [month.key, 0]));

  if (!employees.length) {
    return months.map((month) => ({ label: month.label, headcount: 0 }));
  }

  employees.forEach((employee) => {
    const employeeDate = getEmployeeHeadcountDate(employee);

    if (!employeeDate) {
      return;
    }

    const key = monthKey(employeeDate);

    if (monthlyCounts.has(key)) {
      monthlyCounts.set(key, monthlyCounts.get(key) + 1);
    }
  });

  return months.map((month) => {
    return {
      label: month.label,
      headcount: monthlyCounts.get(month.key) || 0,
    };
  });
}

function resolvePayrollExpenseTrend(records) {
  const currentYear = new Date().getFullYear();
  const monthlyTotals = Array.from({ length: 12 }, (_, monthIndex) => ({
    label: shortMonthLabel(monthIndex),
    expense: 0,
  }));

  records.forEach((record) => {
    const date = parseDate(record.payrollDate || record.endDate || record.createdAt);
    if (!date || date.getFullYear() !== currentYear || record.status === "Archived") {
      return;
    }

    monthlyTotals[date.getMonth()].expense += Number(record.netPay || record.grossPay || 0) || 0;
  });

  return monthlyTotals;
}

function firstText(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function formatCurrencyValue(value) {
  const numericValue = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));

  if (!Number.isFinite(numericValue)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
}

function formatDateValue(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(String(value).replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function resolveEmployeeInitials(employee) {
  const name = String(employee?.fullName || employee?.firstName || employee?.email || "Employee").trim();
  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "E";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function employeeStatusBadgeClass(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "inactive":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function EmployeeMetaRow({ icon: Icon, label, value }) {
  return (
    <div aria-label={`${label}: ${value || "N/A"}`} className="flex items-center gap-2 text-sm text-slate-600">
      <Icon size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
      <span className="min-w-0 truncate text-slate-700">{value || "N/A"}</span>
    </div>
  );
}

function EmployeeSummaryCard({ employee }) {
  const linkedUser = employee.linkedUser || null;
  const roleLabel = firstText(linkedUser?.role, employee.role, "Employee");
  const statusLabel = firstText(linkedUser?.status, employee.status, "Active");
  const positionLabel = firstText(employee.position, employee.department, "N/A");
  const salaryLabel = formatCurrencyValue(employee.basicSalary);
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-teal-600 text-lg font-bold text-white shadow-sm">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={employee.fullName || "Employee profile"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{resolveEmployeeInitials(employee)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-base font-semibold text-slate-950">
              {employee.fullName || "N/A"}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getRoleBadgeClass(roleLabel)}`}>
                {roleLabel}
              </span>
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${employeeStatusBadgeClass(statusLabel)}`}>
                {statusLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <EmployeeMetaRow icon={Briefcase} label="Position" value={positionLabel} />
          <EmployeeMetaRow icon={Mail} label="Email" value={employee.email} />
          <EmployeeMetaRow icon={Phone} label="Phone" value={employee.phone} />
          <EmployeeMetaRow icon={CalendarDays} label="Date Hired" value={`Hired ${formatDateValue(employee.dateHired)}`} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-emerald-100 bg-emerald-50/80 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <span aria-hidden="true" className="text-base leading-none">₱</span>
          Salary
        </span>
        <strong className="text-base font-semibold text-emerald-950">{salaryLabel}</strong>
      </div>
    </article>
  );
}

function DivisionSummaryCard({ division, isSelected = false, onView }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
        isSelected ? "border-[#D61E1E]/30 bg-[#FEF1F1] ring-2 ring-[#D61E1E]/10" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-base font-semibold text-slate-950">{division.name}</h3>
          <p className="m-0 mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {division.code || "Division"}
          </p>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#f0cccc] bg-[#fff5f5] text-[#D61E1E]">
          <Building2 size={18} aria-hidden="true" />
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <strong className="block text-[2rem] font-semibold leading-none text-slate-950">
            {numberFormatter.format(division.employeeCount || 0)}
          </strong>
          <p className="m-0 mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Employees
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
            {numberFormatter.format(division.totalDesignations || 0)} positions
          </span>
          <button
            type="button"
            onClick={onView}
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#F8BFBF] bg-[#fff5f5] px-4 text-sm font-semibold text-[#D61E1E] transition hover:border-[#F18E8E] hover:bg-[#FEF1F1]"
          >
            <Eye size={14} aria-hidden="true" />
            View
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function DivisionEmployeeCard({ employee }) {
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);
  const positionLabel = firstText(employee.position, employee.jobTitle, "N/A");
  const divisionLabel = firstText(employee.department, employee.division, "Unassigned");
  const statusLabel = firstText(employee.status, "Active");

  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-teal-600 text-sm font-bold text-white shadow-sm">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={employee.fullName || "Employee profile"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{resolveEmployeeInitials(employee)}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-semibold text-slate-950">
            {employee.fullName || employee.employeeName || "N/A"}
          </p>
          <p className="m-0 mt-1 truncate text-xs text-slate-500">{positionLabel}</p>
          <p className="m-0 mt-1 truncate text-xs text-slate-400">{divisionLabel}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${employeeStatusBadgeClass(statusLabel)}`}>
              {statusLabel}
            </span>
            {employee.email ? (
              <span className="truncate text-xs text-slate-400">{employee.email}</span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function pendingStatusBadgeClass(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "reviewed":
    case "chief_reviewed":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function PendingRequestSummaryCard({ title, value, icon: Icon, iconTone }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${iconTone}`}>
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{title}</p>
          <strong className="mt-1 block text-[2rem] font-semibold leading-none text-slate-950">
            {numberFormatter.format(value)}
          </strong>
        </div>
      </div>
    </article>
  );
}

function buildPendingRequestItem(record, type) {
  const meta = PENDING_REQUEST_TYPE_META[type] || PENDING_REQUEST_TYPE_META.leave;
  const employeeName = firstText(record.employeeName, record.fullName, record.employee, "Employee");
  const division = firstText(record.division, record.department, "Unassigned");
  const status = normalizeLeaveStatus(record.status);
  const dateValue = firstText(record.dateFiled, record.createdAt, record.requestedAt, record.startDate, record.endDate);
  const parsedDate = parseDate(dateValue);
  let detail = "";

  switch (type) {
    case "travel": {
      const destination = firstText(record.destination, "No destination");
      const purpose = firstText(record.purpose);
      detail = purpose ? `${destination} | ${purpose}` : destination;
      break;
    }
    case "compensatory": {
      const hours = Number(record.hoursApplied);
      const hoursLabel = Number.isFinite(hours) && hours > 0 ? `${hours.toFixed(2)} hrs` : "Compensatory time off";
      /* The typed remarks only -- the day-selection metadata never reaches the activity feed. */
      const remarks = firstText(getNoteDisplay(record.remarks));
      detail = remarks ? `${hoursLabel} | ${remarks}` : hoursLabel;
      break;
    }
    default: {
      const reason = firstText(
        getLeaveReasonDisplay(record.reason, record.leaveType),
        record.leaveType,
        record.reason,
        "Leave request"
      );
      detail = reason;
    }
  }

  return {
    id: `${type}-${firstText(record.id, record.requestId, employeeName, dateValue)}`,
    type,
    title: meta.label,
    employeeName,
    division,
    status,
    dateText: formatDateDisplay(dateValue),
    detail,
    timestamp: parsedDate ? parsedDate.getTime() : 0,
  };
}

function PendingRequestListItem({ item }) {
  const meta = PENDING_REQUEST_TYPE_META[item.type] || PENDING_REQUEST_TYPE_META.leave;
  const Icon = meta.icon;

  return (
    <article className="grid gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${meta.iconTone}`}>
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{meta.label}</span>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${pendingStatusBadgeClass(item.status)}`}>
              {String(item.status || "").replace(/_/g, " ")}
            </span>
          </div>
          <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{item.employeeName}</p>
          <p className="m-0 mt-1 line-clamp-2 text-sm text-slate-500">{item.detail}</p>
          <p className="m-0 mt-1 text-xs text-slate-400">{item.division}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Filed</p>
        <p className="m-0 mt-1 text-sm font-semibold text-slate-700">{item.dateText}</p>
      </div>
    </article>
  );
}

function ApprovedRequestListItem({ item }) {
  const meta = PENDING_REQUEST_TYPE_META[item.type] || PENDING_REQUEST_TYPE_META.leave;
  const Icon = meta.icon;

  return (
    <article className="grid gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${meta.iconTone}`}>
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{meta.label}</span>
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              {item.status}
            </span>
          </div>
          <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{item.employeeName}</p>
          <p className="m-0 mt-1 line-clamp-2 text-sm text-slate-500">{item.detail}</p>
          <p className="m-0 mt-1 text-xs text-slate-400">{item.division}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Approved Date</p>
        <p className="m-0 mt-1 text-sm font-semibold text-slate-700">{item.dateText}</p>
      </div>
    </article>
  );
}

function buildDashboardActivityItem(record) {
  const date = parseDate(record.occurredAt);
  const source = firstText(record.source, "Activity");
  const employeeName = firstText(record.employeeName, "Employee");
  const status = firstText(record.status);

  return {
    id: firstText(record.id, `${source}-${employeeName}-${date?.getTime() || ""}`),
    source,
    colorSlot: ACTIVITY_SLOTS[source],
    title: `${employeeName} - ${source}${status ? ` (${status})` : ""}`,
    detail: firstText(record.detail),
    amount: Number(record.amount || 0) > 0 ? currencyFormatter.format(Number(record.amount)) : "",
    timestamp: date ? date.getTime() : 0,
    dateText: date
      ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date)
      : "",
  };
}

function AnalyticsCard({ title, description, action, children, className = "" }) {
  return (
    <Card className={`flex h-full min-h-[300px] flex-col overflow-hidden border-slate-200/80 bg-white/95 shadow-sm ${className}`.trim()}>
      <CardHeader className="border-b border-slate-100 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-[13px] font-bold text-slate-900">{title}</CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-4">{children}</CardContent>
    </Card>
  );
}

export default function AdminAnalyticsOverview({
  user,
  employees = [],
  users = [],
  divisions = [],
  onLoadDetails,
  canCreateCalendarEntries = true,
  welcomeDivision = "",
  welcomeDivisionHelper = "Your assigned division",
  showWelcomeAssignmentCards = true,
  showEmployeesByDivisionCard = true,
}) {
  const usesGeneralRequestSummaryLabels = GENERAL_REQUEST_SUMMARY_ROLE_KEYS.has(resolveUserRoleKey(user));
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [dashboardSnapshot, setDashboardSnapshot] = useState(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [employeeSummaryOpen, setEmployeeSummaryOpen] = useState(false);
  const [pendingRequestsOpen, setPendingRequestsOpen] = useState(false);
  const [approvedSummaryOpen, setApprovedSummaryOpen] = useState(false);
  const [divisionSummaryOpen, setDivisionSummaryOpen] = useState(false);
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
  /*
   * The month filter above the analytics. Its month drives the leave panels' monthly figures; its
   * year is the one analytics.php builds the headcount, payroll, and performance charts for, so
   * picking another month of the same year does not refetch.
   */
  const [period, setPeriod] = useState(() => currentDashboardPeriod());
  const periodYear = period.year;
  const periodDate = useMemo(() => new Date(period.year, period.month, 1), [period]);
  const dashboardAnalytics = dashboardSnapshot?.analytics || null;
  const dashboardOverview = dashboardSnapshot?.overview || null;
  const totalEmployees = dashboardAnalytics
    ? Number(dashboardAnalytics.total_employees || 0)
    : employees.length;
  const divisionSummary = useMemo(
    () => {
      if (!dashboardOverview) {
        return resolveDivisionSummary(divisions, employees);
      }

      return (dashboardOverview.divisions || []).map((division, index) => {
        const name = String(division.name || "Unassigned");
        const code = String(division.code || "");
        const keys = new Set([normalizeDivisionKey(name), normalizeDivisionKey(code)]);

        return {
          id: String(division.id || code || name || index),
          name,
          code,
          totalDesignations: Number(division.total_designations || division.totalDesignations || 0),
          employeeCount: Number(division.employee_count || division.employeeCount || 0),
          employees: employees.filter((employee) => keys.has(normalizeDivisionKey(getEmployeeDivisionName(employee)))),
        };
      });
    },
    [dashboardOverview, divisions, employees]
  );
  const baselineHeadcount = totalEmployees;
  const divisionsCount = divisionSummary.length;
  const divisionSummaryDescription = divisionsCount === 1
    ? "1 division in the active employee masterfile."
    : `${numberFormatter.format(divisionsCount)} divisions in the active employee masterfile.`;
  const pendingRequestSummary = dashboardOverview?.requests?.pending || {
    leave: 0,
    travel: 0,
    compensatory: 0,
    total: 0,
    items: [],
  };
  const pendingLeaveCount = pendingRequestSummary.total;
  const approvedRequestSummary = dashboardOverview?.requests?.approved || {
    leave: 0,
    travel: 0,
    compensatory: 0,
    total: 0,
    items: [],
  };
  const approvedRequests = useMemo(
    () => (approvedRequestSummary.items || [])
      .map((record) => buildPendingRequestItem(record, record.type))
      .sort((left, right) => right.timestamp - left.timestamp),
    [approvedRequestSummary.items]
  );
  const displayApprovedRequests = approvedRequests;
  const approvedLeaveCount = Number(approvedRequestSummary.total || 0);
  const welcomeName = resolveFirstName(user);
  const headcountGrowth = useMemo(
    () => dashboardOverview?.headcount_growth || resolveHeadcountGrowth(employees, periodYear),
    [dashboardOverview, employees, periodYear]
  );
  const chartTheme = useAnalyticsTheme();
  /*
   * A pie — the question here is what share of the workforce each division holds — and each
   * division keeps its own hue.
   *
   * The hue is keyed to the division name, never to its rank. The old code did the opposite
   * (`DIVISION_COLORS[index % 10]` over a list already sorted by headcount), so a division that
   * gained two people changed colour and dragged every division below it along too.
   *
   * Slices sit in slot order rather than ranked by headcount. That is what keeps the colours
   * legal: only consecutive slots ever touch, so the adjacent pairlist applies, which the
   * eight-slot order clears in both modes. Sorting by headcount would let any two slots land
   * side by side — the all-pairs pairlist — and six classes fail that (`#e87ba4` vs `#eb6834`
   * measures ΔE 12.9 unsimulated, under the 15 floor). Slice angle carries the share, and the
   * legend under the pie prints every division's headcount beside it.
   */
  const divisionShareData = useMemo(
    () => {
      // Resolved over every division, not just the populated ones — otherwise a division
      // emptying out would shuffle the colours of the divisions that are still on screen.
      const slots = assignEntitySlots(divisionSummary.map((item) => item.name));

      return divisionSummary
        .filter((item) => item.employeeCount > 0)
        .map((item) => {
          const slot = slots.get(normalizeEntityKey(item.name));

          return {
            label: item.name,
            value: item.employeeCount,
            slot: slot === null || slot === undefined ? SERIES_SLOT_COUNT : slot,
            color: slot === null || slot === undefined ? chartTheme.textMuted : chartTheme.series[slot],
          };
        })
        .sort((left, right) => left.slot - right.slot || right.value - left.value);
    },
    [chartTheme, divisionSummary]
  );
  const selectedDivision = useMemo(
    () => divisionSummary.find((item) => item.id === selectedDivisionId) || null,
    [divisionSummary, selectedDivisionId]
  );
  const openDivisionSummary = () => {
    onLoadDetails?.();
    setSelectedDivisionId("");
    setDivisionSummaryOpen(true);
  };
  const openEmployeeSummary = () => {
    onLoadDetails?.();
    setEmployeeSummaryOpen(true);
  };
  const closeDivisionSummary = () => {
    setDivisionSummaryOpen(false);
    setSelectedDivisionId("");
  };
  const payrollExpenseTrend = useMemo(
    () => dashboardOverview?.payroll_expense_trend || resolvePayrollExpenseTrend([]),
    [dashboardOverview]
  );
  const recentActivity = useMemo(() => {
    return (dashboardOverview?.recent_activity || [])
      .map((record) => buildDashboardActivityItem(record))
      .filter((item) => item.timestamp > 0)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 18);
  }, [dashboardOverview]);

  const employeeByEmail = useMemo(
    () => {
      const nextMap = new Map();

      users.forEach((item) => {
        const emailKey = String(item?.email || "").trim().toLowerCase();

        if (emailKey) {
          nextMap.set(emailKey, item);
        }
      });

      return nextMap;
    },
    [users]
  );

  const employeeSummaryCards = useMemo(
    () => employees.map((employee) => {
      const linkedUser = employeeByEmail.get(String(employee.email || "").trim().toLowerCase()) || null;

      return {
        ...employee,
        linkedUser,
      };
    }),
    [employeeByEmail, employees]
  );

  const employeeSummaryDescription = totalEmployees === 1
    ? "1 employee in the active employee masterfile."
    : `${numberFormatter.format(totalEmployees)} employees in the active employee masterfile.`;
  const pendingRequestsDescription = pendingLeaveCount === 1
    ? "1 pending request across leave, travel order, and compensatory time off."
    : `${numberFormatter.format(pendingLeaveCount)} pending requests across leave, travel order, and compensatory time off.`;
  const pendingRequestItems = useMemo(() => {
    return (pendingRequestSummary.items || [])
      .map((record) => buildPendingRequestItem(record, record.type))
      .sort((left, right) => right.timestamp - left.timestamp);
  }, [pendingRequestSummary.items]);

  const loadDashboardSnapshot = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setAnalyticsLoading(true);
    }
    setAnalyticsError("");

    try {
      const response = await fetchDashboardAnalytics(periodYear);
      if (!response?.success) {
        throw new Error(response?.message || "Unable to load dashboard analytics.");
      }

      setDashboardSnapshot(response.data || null);
    } catch (error) {
      setAnalyticsError(error?.response?.data?.message || error?.message || "Unable to load dashboard analytics.");
    } finally {
      if (!background) {
        setAnalyticsLoading(false);
      }
    }
  }, [periodYear]);

  useEffect(() => {
    void loadDashboardSnapshot();

    const unsubscribe = subscribeAutoRefresh(
      () => {
        void loadDashboardSnapshot({ background: true });
      },
      { topics: DASHBOARD_REFRESH_TOPICS }
    );
    const refreshTimer = window.setInterval(() => {
      void loadDashboardSnapshot({ background: true });
    }, 5 * 60 * 1000);

    return () => {
      unsubscribe();
      window.clearInterval(refreshTimer);
    };
  }, [loadDashboardSnapshot]);

  const statCards = [
    {
      label: "Total Employees",
      value: numberFormatter.format(baselineHeadcount),
      icon: Users,
      accent: "from-teal-500 via-teal-600 to-emerald-500",
      iconTone: "bg-gradient-to-br from-teal-500 to-emerald-600",
      glow: "bg-teal-200",
      onClick: openEmployeeSummary,
    },
    {
      label: usesGeneralRequestSummaryLabels ? "Pending Requests" : "Pending Leave Requests",
      value: numberFormatter.format(pendingLeaveCount),
      icon: CalendarRange,
      accent: "from-amber-400 via-amber-500 to-orange-500",
      iconTone: "bg-gradient-to-br from-amber-400 to-orange-500",
      glow: "bg-amber-200",
      onClick: () => setPendingRequestsOpen(true),
    },
    {
      label: usesGeneralRequestSummaryLabels ? "Approved" : "Approved Leaves",
      value: numberFormatter.format(approvedLeaveCount),
      icon: BadgeCheck,
      accent: "from-emerald-500 via-emerald-600 to-lime-500",
      iconTone: "bg-gradient-to-br from-emerald-500 to-lime-600",
      glow: "bg-emerald-200",
      onClick: () => setApprovedSummaryOpen(true),
    },
    {
      label: "Division",
      value: numberFormatter.format(divisionsCount),
      icon: Building2,
      accent: "from-indigo-500 via-sky-600 to-cyan-500",
      iconTone: "bg-gradient-to-br from-indigo-500 to-sky-600",
      glow: "bg-indigo-200",
      onClick: openDivisionSummary,
    },
  ];

  return (
    <div className="w-full space-y-6">
      <DashboardWelcomeBanner
        name={welcomeName}
        position={user?.position || "Not assigned"}
        role={getRoleLabel(user?.role || user?.roleKey || "admin")}
        division={welcomeDivision || user?.division || user?.department || "Not assigned"}
        divisionHelper={welcomeDivisionHelper}
        imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
        showCalendar
        showPositionCard={showWelcomeAssignmentCards}
        showDivisionCard={showWelcomeAssignmentCards}
        canManageCalendar
        canCreateCalendarEntries={canCreateCalendarEntries}
      />

      {analyticsError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {analyticsError}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat, index) => (
          <AdminStatCard
            key={stat.label}
            stat={stat}
            index={index}
          />
        ))}
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold text-slate-950">Analytics</h2>
          <p className="m-0 mt-0.5 text-xs text-slate-500">
            Monthly figures for {formatDashboardPeriod(period)}; trends cover {periodYear}.
          </p>
        </div>
        <DashboardMonthFilter value={period} onChange={setPeriod} />
      </div>

      <DashboardLeaveManagementAnalytics user={user} referenceDate={periodDate} />

      <Modal
        open={employeeSummaryOpen}
        title="Total Employees"
        maxWidth="max-w-[1160px]"
        backdropClassName="backdrop-blur-sm"
        contentClassName="bg-slate-50 !px-0 !py-0"
        onClose={() => setEmployeeSummaryOpen(false)}
      >
        <div className="space-y-5 px-6 py-6">
          <p className="m-0 text-sm font-medium text-slate-500">{employeeSummaryDescription}</p>

          {employeeSummaryCards.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {employeeSummaryCards.map((employee) => (
                <EmployeeSummaryCard key={employee.id} employee={employee} />
              ))}
            </div>
          ) : (
            <div className="grid min-h-[240px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="m-0 text-sm font-semibold text-slate-500">No active employee records found.</p>
            </div>
          )}
        </div>
            </Modal>

      <Modal
        open={pendingRequestsOpen}
        title="Pending Requests"
        maxWidth="max-w-[1160px]"
        backdropClassName="backdrop-blur-sm"
        contentClassName="bg-slate-50 !px-0 !py-0"
        onClose={() => setPendingRequestsOpen(false)}
      >
        <div className="space-y-5 px-6 py-6">
          <p className="m-0 text-sm font-medium text-slate-500">{pendingRequestsDescription}</p>

          <div className="grid gap-4 md:grid-cols-3">
            <PendingRequestSummaryCard
              title="Leave Requests"
              value={pendingRequestSummary.leave}
              icon={FileText}
              iconTone="border-blue-200 bg-blue-50 text-blue-600"
            />
            <PendingRequestSummaryCard
              title="Travel Orders"
              value={pendingRequestSummary.travel}
              icon={Plane}
              iconTone="border-amber-200 bg-amber-50 text-amber-600"
            />
            <PendingRequestSummaryCard
              title="Compensatory Time Off"
              value={pendingRequestSummary.compensatory}
              icon={Clock3}
              iconTone="border-violet-200 bg-violet-50 text-violet-700"
            />
          </div>

          {pendingRequestItems.length > 0 ? (
            <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {pendingRequestItems.map((item) => (
                <PendingRequestListItem key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-blue-200 bg-white px-6 text-center">
              <div className="space-y-2">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <ClipboardList size={22} aria-hidden="true" />
                </div>
                <p className="m-0 text-base font-semibold text-slate-700">No pending requests.</p>
                <p className="m-0 text-sm text-slate-500">New leave, travel order, or compensatory requests will appear here.</p>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={approvedSummaryOpen}
        title="Approved Requests"
        maxWidth="max-w-[1160px]"
        backdropClassName="backdrop-blur-sm"
        contentClassName="bg-slate-50 !px-0 !py-0"
        onClose={() => setApprovedSummaryOpen(false)}
      >
        <div className="space-y-5 px-6 py-6">
          <p className="m-0 text-sm font-medium text-slate-500">
            {approvedLeaveCount === 1
              ? "1 approved request across leave, travel order, and compensatory time off."
              : `${numberFormatter.format(approvedLeaveCount)} approved requests across leave, travel order, and compensatory time off.`}
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            <PendingRequestSummaryCard
              title="Approved Leaves"
              value={approvedRequestSummary.leave}
              icon={FileText}
              iconTone="border-blue-200 bg-blue-50 text-blue-600"
            />
            <PendingRequestSummaryCard
              title="Approved Travel Orders"
              value={approvedRequestSummary.travel}
              icon={Plane}
              iconTone="border-amber-200 bg-amber-50 text-amber-600"
            />
            <PendingRequestSummaryCard
              title="Approved CTO"
              value={approvedRequestSummary.compensatory}
              icon={Clock3}
              iconTone="border-violet-200 bg-violet-50 text-violet-700"
            />
          </div>

          {displayApprovedRequests.length > 0 ? (
            <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {displayApprovedRequests.map((item) => (
                <ApprovedRequestListItem key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-emerald-200 bg-white px-6 text-center">
              <div className="space-y-2">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <BadgeCheck size={22} aria-hidden="true" />
                </div>
                <p className="m-0 text-base font-semibold text-slate-700">No approved requests.</p>
                <p className="m-0 text-sm text-slate-500">Approved leave, travel order, or compensatory requests will appear here.</p>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={divisionSummaryOpen}
        title="Division Summary"
        maxWidth="max-w-[1280px]"
        backdropClassName="backdrop-blur-sm"
        contentClassName="bg-slate-50 !px-0 !py-0"
        onClose={closeDivisionSummary}
      >
        <div className="space-y-6 px-6 py-6">
          <p className="m-0 text-sm font-medium text-slate-500">{divisionSummaryDescription}</p>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {divisionSummary.map((division) => (
              <DivisionSummaryCard
                key={division.id}
                division={division}
                isSelected={selectedDivision?.id === division.id}
                onView={() => setSelectedDivisionId(division.id)}
              />
            ))}
          </div>

          <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="m-0 text-lg font-semibold text-slate-950">Select a division</h3>
              <p className="m-0 mt-1 text-sm text-slate-500">
                {selectedDivision
                  ? `${numberFormatter.format(selectedDivision.employeeCount)} employees in ${selectedDivision.name}.`
                  : "Click View on a division card to show employees here."}
              </p>
              {selectedDivision ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                    {numberFormatter.format(selectedDivision.employeeCount)} employees
                  </span>
                  <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                    {numberFormatter.format(selectedDivision.totalDesignations)} positions
                  </span>
                  {selectedDivision.code ? (
                    <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                      Code {selectedDivision.code}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="px-5 py-5">
              {selectedDivision ? (
                selectedDivision.employees.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {selectedDivision.employees.map((employee, index) => (
                      <DivisionEmployeeCard key={employee.id || `${selectedDivision.id}-${index}`} employee={employee} />
                    ))}
                  </div>
                ) : (
                  <div className="grid min-h-[180px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm font-semibold text-slate-500">
                    No employees are currently assigned to this division.
                  </div>
                )
              ) : (
                <div className="grid min-h-[180px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 text-center">
                  <div>
                    <p className="m-0 text-base font-semibold text-slate-500">No division selected.</p>
                    <p className="m-0 mt-2 max-w-md text-sm text-slate-500">
                      Click View on a division card to show employees here.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </Modal>

      <section className="space-y-4">
        <div className={`grid items-stretch gap-4 ${showEmployeesByDivisionCard ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          <AnalyticsCard
            title="Monthly Headcount Growth"
            description={`Employees hired each month of ${periodYear}.`}
          >
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={headcountGrowth} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="headcountFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.26} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                  <Tooltip
                    formatter={(value) => [numberFormatter.format(value), "Employees"]}
                    contentStyle={{ borderRadius: 8, borderColor: "#cbd5e1", fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="headcount"
                    name="Employees"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    fill="url(#headcountFill)"
                    dot={{ r: 2.5, fill: "#ffffff", stroke: "#2563eb", strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AnalyticsCard>

          {showEmployeesByDivisionCard ? (
            <AnalyticsCard
              title="Employees by Division"
            >
              {divisionShareData.length === 0 ? (
                <div className="grid h-[220px] place-items-center rounded-lg border border-dashed border-slate-200 text-center">
                  <p className="m-0 text-sm font-semibold text-slate-500">No division data available.</p>
                </div>
              ) : (
                <DistributionPieChart
                  data={divisionShareData}
                  theme={chartTheme}
                  height={200}
                  valueFormatter={(value) => numberFormatter.format(value)}
                  showPercentages={false}
                />
              )}
            </AnalyticsCard>
          ) : null}

          <AnalyticsCard
            title="Payroll Expense Trend"
            description={`Processed payroll each month of ${periodYear}.`}
          >
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={payrollExpenseTrend} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="payrollExpenseFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#c026d3" stopOpacity={0.24} />
                      <stop offset="95%" stopColor="#c026d3" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="#64748b"
                    tickFormatter={(value) => currencyFormatter.format(value)}
                  />
                  <Tooltip
                    formatter={(value) => [currencyFormatter.format(value), "Processed Payroll Expense"]}
                    contentStyle={{ borderRadius: 8, borderColor: "#cbd5e1", fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="expense"
                    name="Processed Payroll Expense"
                    stroke="#c026d3"
                    strokeWidth={2.5}
                    fill="url(#payrollExpenseFill)"
                    dot={{ r: 2.5, fill: "#ffffff", stroke: "#c026d3", strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AnalyticsCard>
        </div>

        <DashboardAnalytics
          embedded
          showHeader={false}
          data={dashboardAnalytics}
          loading={analyticsLoading}
          onRefresh={loadDashboardSnapshot}
        >

          <AnalyticsCard
            title="Recent Activity"
          >
            <div className="max-h-[260px] flex-1 space-y-2 overflow-y-auto pr-2 [scrollbar-width:thin]">
              {analyticsLoading && recentActivity.length === 0 ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-11 animate-pulse rounded-lg bg-slate-100" />
                ))
              ) : recentActivity.length > 0 ? (
                recentActivity.map((item) => (
                  <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: item.colorSlot === undefined
                            ? chartTheme.textMuted
                            : chartTheme.series[item.colorSlot],
                        }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="m-0 truncate text-xs font-bold text-slate-900">{item.title}</p>
                        <p className="m-0 mt-0.5 truncate text-[11px] text-slate-500">
                          {[item.detail, item.amount].filter(Boolean).join(" | ") || "No additional details"}
                        </p>
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-[10px] font-medium text-slate-400">{item.dateText}</span>
                  </div>
                ))
              ) : (
                <div className="grid h-[160px] place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center">
                  <p className="m-0 text-sm font-semibold text-slate-500">No recent activity yet.</p>
                </div>
              )}
            </div>
          </AnalyticsCard>
        </DashboardAnalytics>

      </section>
    </div>
  );
}
