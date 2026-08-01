import React, { useCallback, useState } from "react";
import DashboardLeaveTravelCalendar from "../../components/dashboard/DashboardLeaveTravelCalendar";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { getEmployees } from "../../services/api";
import { fetchLeaveRequests } from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";

const ANNOUNCEMENT_STORAGE_KEY = "hris:leave-travel-calendar-announcements";

function readStoredAnnouncements() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];

    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [];
  }
}

function saveStoredAnnouncements(announcements) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, JSON.stringify(announcements));
}

export default function LeaveTravelCalendarWorkspace({
  canManageAnnouncements = true,
  onViewEmployeeProfile,
  showLegend = true,
}) {
  const [employees, setEmployees] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [travelOrders, setTravelOrders] = useState([]);
  const [announcements, setAnnouncements] = useState(readStoredAnnouncements);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const handleSaveAnnouncement = (announcement) => {
    setAnnouncements((currentAnnouncements) => {
      const nextAnnouncement = {
        ...announcement,
        id: announcement.id || `announcement-${Date.now()}`,
        createdAt: announcement.createdAt || new Date().toISOString(),
      };
      const nextAnnouncements = [
        nextAnnouncement,
        ...currentAnnouncements.filter((item) => item.id !== nextAnnouncement.id),
      ];

      saveStoredAnnouncements(nextAnnouncements);
      return nextAnnouncements;
    });
  };

  const loadCalendarData = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const [employeeResult, leaveResult, travelResult] = await Promise.allSettled([
        getEmployees(),
        fetchLeaveRequests(),
        fetchTravelOrders(),
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
      setError(
        employeeResult.status === "rejected"
        || leaveResult.status === "rejected"
        || travelResult.status === "rejected"
          ? "Some calendar data could not be loaded."
          : ""
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadCalendarData, {
    topics: ["leave_request", "travel_order", "employee"],
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
