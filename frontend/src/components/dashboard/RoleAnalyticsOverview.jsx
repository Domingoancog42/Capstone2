import React, { useEffect, useState } from "react";
import AdminAnalyticsOverview from "./AdminAnalyticsOverview";
import { getEmployees, getEmployeeOptions, getUsers } from "../../services/api";

/**
 * The workforce analytics panel shared by the HR Staff, HR Head, and Chief dashboards.
 *
 * This used to be copy-pasted per role, which is how those dashboards drifted apart. Loading the
 * data here means every role that mounts it shows the same figures, computed the same way.
 *
 * Each request is settled independently: one failing endpoint degrades that section rather than
 * blanking the whole dashboard, and the banner says so.
 */
export default function RoleAnalyticsOverview({ user }) {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      setLoading(true);

      try {
        const [employeeResult, userResult, optionsResult] = await Promise.allSettled([
          getEmployees(),
          getUsers(),
          getEmployeeOptions(),
        ]);

        if (!active) {
          return;
        }

        setEmployees(
          employeeResult.status === "fulfilled" && Array.isArray(employeeResult.value?.employees)
            ? employeeResult.value.employees
            : []
        );
        setUsers(
          userResult.status === "fulfilled" && Array.isArray(userResult.value?.users)
            ? userResult.value.users
            : []
        );
        setDivisions(
          optionsResult.status === "fulfilled" && Array.isArray(optionsResult.value?.divisions)
            ? optionsResult.value.divisions
            : []
        );
        setError(
          employeeResult.status === "rejected"
            || userResult.status === "rejected"
            || optionsResult.status === "rejected"
            ? "Some dashboard data could not be loaded."
            : ""
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="w-full space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}
      <AdminAnalyticsOverview
        user={user}
        employees={employees}
        users={users}
        divisions={divisions}
        loading={loading}
      />
    </div>
  );
}
