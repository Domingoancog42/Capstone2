import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle, Search, Users } from "lucide-react";
import { faEye } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import TeamEmployeeProfile, {
  formatTeamDate,
  resolveEmployeeInitials,
} from "../../components/employee/TeamEmployeeProfile";
import { getEmployees } from "../../services/api";
import { designationsForDivision, useOrganizationFilterOptions } from "../../hooks/useFilterOptions";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

function normalizeTeamText(value) {
  return String(value || "").trim().toLowerCase();
}

function isCurrentChiefEmployee(employee, user) {
  const employeeId = normalizeTeamText(employee?.employeeId);
  const employeeEmail = normalizeTeamText(employee?.email);
  const employeeName = normalizeTeamText(employee?.fullName);

  return (
    (employeeId && employeeId === normalizeTeamText(user?.employee_id))
    || (employeeEmail && employeeEmail === normalizeTeamText(user?.email))
    || (employeeName && employeeName === normalizeTeamText(user?.full_name || user?.username))
  );
}

/**
 * The people a chief's desk covers: the staff of the chief's own division, without the chief.
 * Shared by the team roster and the IPCR assignment desk so the two never disagree on who is in
 * the division. An unknown division scopes to nobody rather than to everybody.
 */
export function scopeEmployeesToChiefDivision(employees, user) {
  const divisionKey = normalizeTeamText(user?.division);

  if (!divisionKey) {
    return [];
  }

  return (employees || [])
    .filter((employee) => normalizeTeamText(employee.department || employee.division) === divisionKey)
    .filter((employee) => !isCurrentChiefEmployee(employee, user))
    .sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")));
}

export default function TeamOverview({ user }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [designation, setDesignation] = useState("");
  const [viewingEmployee, setViewingEmployee] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadEmployees = async () => {
      setLoading(true);
      setLoadError("");

      try {
        const result = await getEmployees();
        if (!mounted) {
          return;
        }

        setEmployees(result.employees || []);
      } catch (error) {
        if (mounted) {
          setEmployees([]);
          setLoadError(error?.response?.data?.message || "Unable to load division employees.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadEmployees();

    return () => {
      mounted = false;
    };
  }, []);

  const divisionName = String(user?.division || "").trim();
  const scopedEmployees = useMemo(() => scopeEmployeesToChiefDivision(employees, user), [employees, user]);

  /* This division's positions from the position catalog, not the titles held on the rows. */
  const { designationRecords } = useOrganizationFilterOptions();
  const designationOptions = useMemo(
    () => (divisionName ? designationsForDivision(designationRecords, divisionName) : []),
    [designationRecords, divisionName]
  );

  const filteredEmployees = useMemo(() => {
    const search = normalizeTeamText(query);
    const designationKey = normalizeTeamText(designation);

    return scopedEmployees.filter((employee) => {
      if (designationKey && normalizeTeamText(employee.position) !== designationKey) {
        return false;
      }

      if (!search) {
        return true;
      }

      /* Only the columns still on screen — searching a removed column returns rows with no
       * visible reason for matching. */
      return [
        employee.fullName,
        employee.position,
        employee.designation,
        employee.employmentStatus,
        employee.status,
      ]
        .filter(Boolean)
        .some((value) => normalizeTeamText(value).includes(search));
    });
  }, [designation, query, scopedEmployees]);

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const columns = useMemo(() => ([
    {
      key: "employee",
      header: "Employee",
      cardRole: "title",
      render: (row) => {
        const avatarUrl = resolveBackendAssetUrl(row.profileImage);

        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-teal-600 text-xs font-bold text-white">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={row.fullName || "Employee profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{resolveEmployeeInitials(row)}</span>
              )}
            </div>
            <p className="m-0 truncate font-semibold text-slate-900">
              {row.fullName || "Unnamed employee"}
            </p>
          </div>
        );
      },
    },
    {
      key: "position",
      header: "Position",
      cardRole: "subtitle",
      render: (row) => (
        <>
          {row.position || "Unassigned"}
          {row.designation ? <span className="block text-xs text-slate-500">{row.designation}</span> : null}
        </>
      ),
    },
    {
      key: "employmentStatus",
      header: "Employment Status",
      render: (row) => row.employmentStatus || "N/A",
    },
    {
      key: "dateHired",
      header: "Date Hired",
      render: (row) => formatTeamDate(row.dateHired),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => row.status || "Active",
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (row) => (
        <ActionIconButton
          label={`View ${row.fullName || "employee"} profile`}
          icon={faEye}
          tone="view"
          onClick={() => setViewingEmployee(row)}
        />
      ),
    },
    /* `setViewingEmployee` is a setter, so it is stable and the empty dep list still holds. */
  ]), []);

  const closeProfile = () => setViewingEmployee(null);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Team/Division Employee</CardTitle>
            <CardDescription>
              View the employees assigned to {divisionName || "your division"} and monitor their current assignment details.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
            <Users size={16} />
            {filteredEmployees.length} team member{filteredEmployees.length === 1 ? "" : "s"}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!divisionName ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              This account is not linked to a division yet, so no team roster can be shown.
            </div>
          ) : null}

          {loadError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                <span>{loadError}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Focus is shown by the border alone; the accent ring the other inputs wear is left off here. */}
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search employee or position</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee or position"
                className="h-9 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-slate-400"
              />
            </label>
            <label className="block w-full sm:w-64">
              <span className="sr-only">Filter by position</span>
              <select
                value={designation}
                onChange={(event) => setDesignation(event.target.value)}
                className="h-9 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              >
                <option value="">All positions</option>
                {designationOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            {loading ? (
              <div className="grid min-h-[220px] place-items-center bg-white">
                <div className="text-center">
                  <LoaderCircle className="mx-auto animate-spin text-teal-600" size={28} />
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-700">Loading division team...</p>
                </div>
              </div>
            ) : (
              <Table
                columns={columns}
                data={filteredEmployees}
                rowKey="id"
                emptyMessage={divisionName ? `No employees found under ${divisionName}.` : "No employees found."}
                stickyHeader
                className="max-h-[560px] overflow-y-auto"
                minWidthClassName="min-w-[860px]"
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(viewingEmployee)}
        title="Employee Profile"
        maxWidth="max-w-[760px]"
        onClose={closeProfile}
        footer={(
          <Button variant="primary" onClick={closeProfile}>
            Close
          </Button>
        )}
      >
        {viewingEmployee ? <TeamEmployeeProfile employee={viewingEmployee} /> : null}
      </Modal>
    </>
  );
}
