import React, { useEffect, useState } from "react";
import { BarChart3, ScrollText, Trophy } from "lucide-react";
import IpcrManagementWorkspace from "../../module/performance/IpcrManagementWorkspace";
import OpcrManagementWorkspace from "../../module/performance/OpcrManagementWorkspace";
import RewardsRecognitionWorkspace from "../../module/rewards/RewardsRecognitionWorkspace";
import ServiceRecordWorkspace from "../../module/serviceRecord/ServiceRecordWorkspace";
import { getEmployees } from "../../services/api";

/**
 * Performance Management (OPCR/IPCR) and Rewards & Recognition — the Masterfiles screens that HR
 * runs alongside Admin.
 *
 * Defined once here so the roles that share them cannot drift apart, the same way
 * `selfServiceModules` keeps the personal screens aligned.
 */

/**
 * All three screens are driven by an employee directory. The Admin dashboard already holds one in
 * its own state and passes it down; `RoleWorkspacePage` carries no such state, so the screens load
 * their own rather than silently rendering an empty roster.
 */
function useEmployeeDirectory() {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadEmployees = async () => {
      try {
        const result = await getEmployees();

        if (!active) {
          return;
        }

        setEmployees(Array.isArray(result?.employees) ? result.employees : []);
        setError("");
      } catch (requestError) {
        if (active) {
          setEmployees([]);
          setError(requestError.response?.data?.message || "Unable to load the employee directory.");
        }
      }
    };

    void loadEmployees();

    return () => {
      active = false;
    };
  }, []);

  return { employees, error };
}

function EmployeeDirectoryScreen({ render }) {
  const { employees, error } = useEmployeeDirectory();

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}
      {render(employees)}
    </div>
  );
}

export const PERFORMANCE_REWARDS_MODULES = {
  rewardsRecognition: {
    title: "Rewards & Recognition",
    description: "Nominate employees, track recognition programs, and review awarded records.",
    hidePageIntro: true,
    render: ({ user }) => (
      <EmployeeDirectoryScreen
        render={(employees) => <RewardsRecognitionWorkspace employees={employees} user={user} />}
      />
    ),
  },
  performanceOpcr: {
    title: "OPCR",
    description: "Manage Office Performance Commitment and Review targets across divisions.",
    hidePageIntro: true,
    render: () => (
      <EmployeeDirectoryScreen render={(employees) => <OpcrManagementWorkspace employees={employees} />} />
    ),
  },
  performanceIpcr: {
    title: "IPCR",
    description: "Assign Individual Performance Commitment and Review KPIs and review submissions.",
    hidePageIntro: true,
    render: () => (
      <EmployeeDirectoryScreen render={(employees) => <IpcrManagementWorkspace employees={employees} />} />
    ),
  },
  serviceRecord: {
    title: "Service Record",
    description: "Maintain and issue employee service records (CS Form No. 1).",
    hidePageIntro: true,
    render: ({ user }) => <ServiceRecordWorkspace user={user} mode="manage" />,
  },
};

/**
 * Sidebar entries for the modules above, e.g. `buildPerformanceRewardsNavItems("/hrhead")`. These
 * carry no section header of their own — they are meant to be spread into an existing Masterfiles
 * section, which is where Admin lists them.
 *
 * The parent item points at the OPCR path exactly as Admin's does. `RoleWorkspacePage` matches
 * children before parents, so that path resolves to the `performanceOpcr` module and the parent key
 * never needs a module of its own.
 */
export function buildPerformanceRewardsNavItems(basePath) {
  return [
    {
      key: "serviceRecord",
      label: "Service Record",
      icon: ScrollText,
      path: `${basePath}/service-record`,
    },
    {
      key: "rewardsRecognition",
      label: "Rewards & Recognition",
      icon: Trophy,
      path: `${basePath}/rewards-recognition`,
    },
    {
      key: "performanceManagement",
      label: "Performance Management",
      icon: BarChart3,
      path: `${basePath}/masterfiles/performance-management/opcr`,
      children: [
        { key: "performanceOpcr", label: "OPCR", path: `${basePath}/masterfiles/performance-management/opcr` },
        { key: "performanceIpcr", label: "IPCR", path: `${basePath}/masterfiles/performance-management/ipcr` },
      ],
    },
  ];
}
