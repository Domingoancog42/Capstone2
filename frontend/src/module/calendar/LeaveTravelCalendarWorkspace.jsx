import React, { useCallback, useState } from "react";
import DashboardLeaveTravelCalendar from "../../components/dashboard/DashboardLeaveTravelCalendar";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { getEmployees } from "../../services/api";
import { createAnnouncement, fetchAnnouncements } from "../../services/announcementService";
import { fetchLeaveRequests } from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";

export default function LeaveTravelCalendarWorkspace({
  canManageAnnouncements = true,
  onViewEmployeeProfile,
  showLegend = true,
}) {
  const [employees, setEmployees] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [travelOrders, setTravelOrders] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /*
   * Resolves once the announcement is stored, so the modal can stay open and show the failure
   * instead of closing over a publish that never happened. The list is refreshed from the response
   * rather than patched locally, which keeps this browser showing the same rows every other one sees.
   */
  const handleSaveAnnouncement = async (announcement) => {
    const response = await createAnnouncement(announcement);

    if (response?.announcement) {
      setAnnouncements((currentAnnouncements) => [
        response.announcement,
        ...currentAnnouncements.filter((item) => item.id !== response.announcement.id),
      ]);
    }

    return response;
  };

  const loadCalendarData = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const [employeeResult, leaveResult, travelResult, announcementResult] = await Promise.allSettled([
        getEmployees(),
        fetchLeaveRequests(),
        fetchTravelOrders(),
        fetchAnnouncements(),
      ]);

      setEmployees(
        employeeResult.status === "fulfilled" && Array.isArray(employeeResult.value?.employees)
          ? employeeResult.value.employees
          : []
      );
      setLeaveRequests(
        leaveResult.status === "fulfilled" && Array.isArray(leaveResult.value?.requests)
          ? leaveResult.value.requests
          : []
      );
      setTravelOrders(
        travelResult.status === "fulfilled" && Array.isArray(travelResult.value?.requests)
          ? travelResult.value.requests
          : []
      );
      setAnnouncements(
        announcementResult.status === "fulfilled" && Array.isArray(announcementResult.value?.announcements)
          ? announcementResult.value.announcements
          : []
      );
      setError(
        employeeResult.status === "rejected"
        || leaveResult.status === "rejected"
        || travelResult.status === "rejected"
        || announcementResult.status === "rejected"
          ? "Some calendar data could not be loaded."
          : ""
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadCalendarData, {
    topics: ["leave_request", "travel_order", "employee", "announcement"],
  });

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      <DashboardLeaveTravelCalendar
        leaveRequests={leaveRequests}
        travelOrders={travelOrders}
        announcements={announcements}
        employees={employees}
        loading={loading}
        onViewEmployeeProfile={onViewEmployeeProfile}
        onSaveAnnouncement={canManageAnnouncements ? handleSaveAnnouncement : undefined}
        showLegend={showLegend}
      />
    </div>
  );
}
