import React, { useEffect, useMemo, useState } from "react";
import AdminAnalyticsOverview from "./AdminAnalyticsOverview";
import { getEmployees, getEmployeeOptions, getUsers } from "../../services/api";
import { resolveUserRoleKey } from "../../utils/roleRoutes";

/**
 * The workforce analytics panel shared by the HR Staff, HR Head, and Cashier dashboards.
 *
 * This used to be copy-pasted per role, which is how those dashboards drifted apart. Loading the
 * data here means every role that mounts it shows the same figures, computed the same way.
 *
 * The Chief and Planning Officer desks used to mount this too, but their scope is one division, not
 * the organisation — they run `DivisionDashboardOverview` instead.
 *
 * Each request is settled independently: one failing endpoint degrades that section rather than
 * blanking the whole dashboard, and the banner says so.
 *
 * `organizationWide` decides the reach of the figures as well as what the welcome card calls the
 * viewer's division. HR Staff and HR Head use the whole office, so their cards read "All Divisions"
 * and every figure is organisation-wide. When a caller explicitly requests a division view, the
 * directory lists loaded here are narrowed to that division as well.
 */

/*
 * Roles that can use this panel in a division-only presentation when requested by a caller.
 */
const ANALYTICS_DIVISION_SCOPED_ROLE_KEYS = new Set(["chief", "planningofficer"]);

function normalizeDivisionKey(value) {
  return String(value || "").trim().toLowerCase();
}

function employeeDivisionKey(employee) {
  return normalizeDivisionKey(employee?.department || employee?.division || employee?.divisionName);
}

function divisionMatches(division, target) {
  return normalizeDivisionKey(division?.name) === target || normalizeDivisionKey(division?.code) === target;
}

export default function RoleAnalyticsOverview({ user, organizationWide = true, showEmployeesByDivisionCard = true }) {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isDivisionScoped = !organizationWide && ANALYTICS_DIVISION_SCOPED_ROLE_KEYS.has(resolveUserRoleKey(user));
  const scopedDivision = isDivisionScoped ? normalizeDivisionKey(user?.division || user?.department) : "";

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

  const scopedEmployees = useMemo(() => {
    if (!isDivisionScoped) {
      return employees;
    }

    return scopedDivision ? employees.filter((employee) => employeeDivisionKey(employee) === scopedDivision) : [];
  }, [employees, isDivisionScoped, scopedDivision]);

  /*
   * User rows carry the division of their linked employee record; the ones that do not (an
   * account with no employee yet) are matched through the scoped roster's e-mails instead, so the
   * employee summary cards still find the sign-in behind each person in the division.
   */
  const scopedUsers = useMemo(() => {
    if (!isDivisionScoped) {
      return users;
    }

    if (!scopedDivision) {
      return [];
    }

    const rosterEmails = new Set(
      scopedEmployees.map((employee) => String(employee?.email || "").trim().toLowerCase()).filter(Boolean)
    );

    return users.filter((item) => (
      normalizeDivisionKey(item?.division) === scopedDivision
      || rosterEmails.has(String(item?.email || "").trim().toLowerCase())
    ));
  }, [isDivisionScoped, scopedDivision, scopedEmployees, users]);

  const scopedDivisions = useMemo(() => {
    if (!isDivisionScoped) {
      return divisions;
    }

    return scopedDivision ? divisions.filter((division) => divisionMatches(division, scopedDivision)) : [];
  }, [divisions, isDivisionScoped, scopedDivision]);

  return (
    <div className="w-full space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}
      <AdminAnalyticsOverview
        user={user}
        employees={scopedEmployees}
        users={scopedUsers}
        divisions={scopedDivisions}
        loading={loading}
        /* An empty welcomeDivision makes the banner fall back to the user's own division. */
        welcomeDivision={organizationWide ? "All Divisions" : ""}
        welcomeDivisionHelper={organizationWide ? "Organization-wide access" : "Your assigned division"}
        showEmployeesByDivisionCard={showEmployeesByDivisionCard}
      />
    </div>
  );
}
