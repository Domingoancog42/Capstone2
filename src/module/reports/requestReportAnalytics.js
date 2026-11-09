import { AlertTriangle, Ban, BarChart3, CheckCircle2, Clock3, MapPin, Timer, XCircle } from "lucide-react";
import {
  group,
  monthSeries,
  normalizedStatus,
  numberValue,
  statusDistribution,
  sum,
  uniqueEmployeeCount,
} from "./leaveReportAnalytics";

/*
 * Insight cards and charts for the Travel Order and CTO reports, computed from the rows reports.php
 * returns (travel-orders, cto-requests). Both carry one public status per filing -- open stages
 * already read as Pending -- plus `startDateRaw` for the monthly series.
 */

const kpi = (key, label, value, { format = "number", hint = "", icon } = {}) => ({ key, label, value, format, hint, icon });

const plural = (count, singular, pluralForm = `${singular}s`) => `${count.toLocaleString("en-PH")} ${count === 1 ? singular : pluralForm}`;

const round = (value) => Math.round(numberValue(value) * 100) / 100;

function statusCounts(rows) {
  const statuses = statusDistribution(rows);
  const count = (name) => statuses.find((entry) => entry.label === name)?.value || 0;

  return {
    statuses,
    approved: count("Approved"),
    pending: count("Pending"),
    rejected: count("Rejected"),
    cancelled: count("Cancelled"),
  };
}

export function buildTravelReportAnalytics(rows = []) {
  const { statuses, approved, pending, rejected, cancelled } = statusCounts(rows);
  const approvedRows = rows.filter((row) => normalizedStatus(row.status) === "Approved");
  const approvedDays = sum(approvedRows, "travelDays");
  const byDivision = group(rows, "division");
  const destinations = group(rows, "destination").slice(0, 8);
  const trend = monthSeries(rows, "startDateRaw");

  return {
    kpis: [
      kpi("total", "Total Travel Orders", rows.length, { hint: plural(uniqueEmployeeCount(rows), "employee"), icon: BarChart3 }),
      kpi("approved", "Approved", approved, { icon: CheckCircle2 }),
      kpi("pending", "Pending", pending, { hint: "Awaiting recommendation or approval", icon: Clock3 }),
      kpi("rejected", "Rejected", rejected, { icon: XCircle }),
      kpi("cancelled", "Cancelled", cancelled, { icon: Ban }),
      kpi("days", "Approved Travel Days", approvedDays, { hint: "Days away on approved orders", icon: MapPin }),
    ],
    charts: [
      { key: "status", title: "Travel Orders by Status", type: "donut", data: statuses },
      { key: "trend", title: "Monthly Travel Orders (by travel start)", type: "line", data: trend },
      { key: "division", title: "Travel Orders by Division/Department", type: "bar", data: byDivision },
      { key: "destination", title: "Top Destinations", type: "horizontalBar", data: destinations },
    ],
  };
}

export function buildCtoReportAnalytics(rows = []) {
  const { statuses, approved, pending, rejected } = statusCounts(rows);
  const approvedRows = rows.filter((row) => normalizedStatus(row.status) === "Approved");
  const approvedHours = round(sum(approvedRows, "hoursApplied"));
  const unpaidHours = round(sum(approvedRows, "unpaidHours"));
  const hoursByDivision = group(approvedRows, "division", (row) => row.hoursApplied);
  const hoursByEmployee = group(approvedRows, "employeeName", (row) => row.hoursApplied).slice(0, 8);
  const trend = monthSeries(approvedRows, "startDateRaw", (row) => row.hoursApplied);

  return {
    kpis: [
      kpi("total", "Total CTO Requests", rows.length, { hint: plural(uniqueEmployeeCount(rows), "employee"), icon: BarChart3 }),
      kpi("approved", "Approved", approved, { icon: CheckCircle2 }),
      kpi("pending", "Pending", pending, { hint: "Still moving through its approvals", icon: Clock3 }),
      kpi("rejected", "Rejected", rejected, { icon: XCircle }),
      kpi("hours", "Approved CTO Hours", approvedHours, { format: "hours", hint: `Across ${plural(uniqueEmployeeCount(approvedRows), "employee")}`, icon: Timer }),
      kpi("unpaid", "Unpaid Hours", unpaidHours, { format: "hours", hint: "Approved beyond the COC balance", icon: AlertTriangle }),
    ],
    charts: [
      { key: "status", title: "CTO Requests by Status", type: "donut", data: statuses },
      { key: "trend", title: "Monthly Approved CTO Hours", type: "line", hours: true, data: trend },
      { key: "division", title: "Approved CTO Hours by Division/Department", type: "bar", hours: true, data: hoursByDivision },
      { key: "employee", title: "Top Employees by Approved CTO Hours", type: "horizontalBar", hours: true, data: hoursByEmployee },
    ],
  };
}
