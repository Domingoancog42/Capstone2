import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle, Search, Users } from "lucide-react";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import Table from "../../components/UI/table";
import { getEmployees } from "../../services/api";

function normalizeTeamText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatTeamDate(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
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

export default function TeamOverview({ user }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");

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
  const scopedEmployees = useMemo(() => {
    const divisionKey = normalizeTeamText(divisionName);

    if (!divisionKey) {
      return [];
    }

    return employees
      .filter((employee) => normalizeTeamText(employee.department || employee.division) === divisionKey)
      .filter((employee) => !isCurrentChiefEmployee(employee, user))
      .sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")));
  }, [divisionName, employees, user]);

  const filteredEmployees = useMemo(() => {
    const search = normalizeTeamText(query);

    if (!search) {
      return scopedEmployees;
    }

    return scopedEmployees.filter((employee) => (
      [
        employee.employeeId,
        employee.fullName,
        employee.position,
        employee.email,
        employee.phone,
        employee.employmentStatus,
        employee.status,
      ]
        .filter(Boolean)
        .some((value) => normalizeTeamText(value).includes(search))
    ));
  }, [query, scopedEmployees]);

  const columns = useMemo(() => ([
    {
      key: "employee",
      header: "Employee",
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{row.fullName || "Unnamed employee"}</p>
          <p className="m-0 mt-1 text-xs text-slate-500">{row.employeeId || "No employee ID"}</p>
        </div>
      ),
    },
    {
      key: "position",
      header: "Position",
      render: (row) => row.position || "Unassigned",
    },
    {
      key: "employmentStatus",
      header: "Employment Status",
      render: (row) => row.employmentStatus || "N/A",
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <div>
          <p className="m-0 text-slate-700">{row.email || "No email"}</p>
          <p className="m-0 mt-1 text-xs text-slate-500">{row.phone || "No contact number"}</p>
        </div>
      ),
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
  ]), []);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>Team Overview</CardTitle>
          <CardDescription>
            View the employees assigned to {divisionName || "the chief's division"} and monitor their current assignment details.
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
            This chief account is not linked to a division yet, so no team roster can be shown.
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

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search employee, position, email, or status"
            className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>

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
              tableClassName="min-w-[1080px]"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
