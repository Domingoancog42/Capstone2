import React, { useCallback, useMemo, useState } from "react";
import LeaveManagementAnalytics from "../leave/LeaveManagementAnalytics";
import { useAutoRefreshOnChange } from "../auto/autorefreshdatalist";
import { fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchLeaveRequests } from "../../services/leaveService";
import { fetchLeaveMonetizationRequests } from "../../services/leaveMonetizationService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { canManageLeave, resolveRoleKey } from "../../utils/leaveHelpers";
import { toLeaveMonetizationRow, toLeaveRequestRow } from "../../utils/leaveMonetization";
import { userCanAccessModule } from "../../utils/permissions";

/* Stands in for a source this dashboard does not fetch, so its records are left as they are. */
const SKIPPED = Promise.resolve(null);

function divisionKey(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Keeps the management-only leave summary on the dashboard without coupling the dashboard to the
 * request table. Leave and monetization records are combined exactly as they are in LeaveDashboard
 * so moving the panel does not change its totals.
 *
 * The status chart can also switch to travel orders, CTO, and overtime, so those are loaded here
 * too. A dashboard that already holds leave records or travel orders passes them in and they are
 * not fetched again.
 */
export default function DashboardLeaveManagementAnalytics({
  user,
  requests: providedRequests,
  travelOrders: providedTravelOrders,
  loading: providedLoading = false,
  /* A day in the month a dashboard's month filter has chosen; see LeaveManagementAnalytics. */
  referenceDate,
}) {
  const hasExplicitPermissions = Boolean(
    user?.permissions
    && typeof user.permissions === "object"
    && Object.keys(user.permissions).length > 0
  );
  const enabled = canManageLeave(user)
    && (!hasExplicitPermissions || userCanAccessModule(user, "leave"));
  const usesProvidedRequests = Array.isArray(providedRequests);
  const usesProvidedTravelOrders = Array.isArray(providedTravelOrders);
  const roleKey = resolveRoleKey(user);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [monetizationRecords, setMonetizationRecords] = useState([]);
  const [travelOrders, setTravelOrders] = useState([]);
  const [compensatoryRecords, setCompensatoryRecords] = useState([]);
  const [overtimeRecords, setOvertimeRecords] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [statusLoading, setStatusLoading] = useState(enabled);
  const [loadError, setLoadError] = useState("");

  const loadAnalytics = useCallback(async ({ background = false } = {}) => {
    if (!enabled) return;

    if (!background) {
      setLoading(true);
      setStatusLoading(true);
    }

    const [leaveResult, monetizationResult, travelResult, compensatoryResult, overtimeResult] = await Promise.allSettled([
      usesProvidedRequests ? SKIPPED : fetchLeaveRequests(),
      usesProvidedRequests || roleKey === "chief" ? SKIPPED : fetchLeaveMonetizationRequests(),
      usesProvidedTravelOrders ? SKIPPED : fetchTravelOrders(),
      fetchCompensatoryRequests(),
      // Manual COC credits are stored as overtime rows but were never filed, so they are not requests.
      fetchOvertimeRequests({ source: "request" }),
    ]);
    const failedSources = [];
    const settle = (result, key, setRecords, label) => {
      if (result.status === "rejected") {
        failedSources.push(label);
      } else if (result.value) {
        setRecords(Array.isArray(result.value[key]) ? result.value[key] : []);
      }
    };

    settle(leaveResult, "requests", setLeaveRequests, "leave requests");
    settle(monetizationResult, "records", setMonetizationRecords, "leave monetization requests");
    settle(travelResult, "requests", setTravelOrders, "travel orders");
    settle(compensatoryResult, "records", setCompensatoryRecords, "CTO requests");
    settle(overtimeResult, "records", setOvertimeRecords, "overtime requests");

    setLoadError(failedSources.length ? `Unable to load ${failedSources.join(", ")}.` : "");
    setLoading(false);
    setStatusLoading(false);
  }, [enabled, roleKey, usesProvidedRequests, usesProvidedTravelOrders]);

  useAutoRefreshOnChange(loadAnalytics, {
    enabled,
    topics: ["leave_request", "leave_monetization", "travel_order", "compensatory", "overtime"],
  });

  const requests = useMemo(() => (
    usesProvidedRequests
      ? providedRequests.map(toLeaveRequestRow)
      : [
        ...leaveRequests.map(toLeaveRequestRow),
        ...monetizationRecords.map(toLeaveMonetizationRow),
      ]
  ), [leaveRequests, monetizationRecords, providedRequests, usesProvidedRequests]);

  /*
   * Travel orders and CTO arrive scoped to a Chief's division, but overtime.php lists every division
   * to any non-employee desk, so a Chief's overtime is narrowed here. A Chief with no division on
   * file sees none, rather than everyone's.
   */
  const statusRequests = useMemo(() => {
    const chiefDivision = roleKey === "chief" ? divisionKey(user?.division || user?.department) : null;
    const overtime = chiefDivision === null
      ? overtimeRecords
      : overtimeRecords.filter((record) => (
        chiefDivision !== "" && divisionKey(record?.division || record?.department) === chiefDivision
      ));

    return {
      travel: usesProvidedTravelOrders ? providedTravelOrders : travelOrders,
      cto: compensatoryRecords,
      overtime,
    };
  }, [
    compensatoryRecords,
    overtimeRecords,
    providedTravelOrders,
    roleKey,
    travelOrders,
    user?.department,
    user?.division,
    usesProvidedTravelOrders,
  ]);

  if (!enabled) return null;

  return (
    <section className="space-y-3" aria-label="Dashboard leave request summary">
      {loadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {loadError}
        </div>
      ) : null}
      <LeaveManagementAnalytics
        requests={requests}
        loading={usesProvidedRequests ? providedLoading : loading}
        statusRequests={statusRequests}
        statusLoading={statusLoading || (usesProvidedTravelOrders && providedLoading)}
        referenceDate={referenceDate}
      />
    </section>
  );
}
