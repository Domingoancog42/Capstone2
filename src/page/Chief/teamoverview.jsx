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
import { getEmployees } from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

function normalizeTeamText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveEmployeeInitials(employee) {
  const parts = String(employee?.fullName || "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "E";
  }

  return parts.slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
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

/* The roster carries the address in four columns; the profile reads better as one line. */
function formatTeamAddress(employee) {
  const parts = [employee?.address, employee?.city, employee?.province, employee?.zipCode]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  return parts.join(", ");
}

function TeamProfileField({ label, value }) {
  return (
    <div>
      <dt className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className="m-0 mt-0.5 text-sm text-slate-900">{value || "N/A"}</dd>
    </div>
  );
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

    /* Only the columns still on screen — searching a removed column returns rows with no
     * visible reason for matching. */
    return scopedEmployees.filter((employee) => (
      [
        employee.fullName,
        employee.position,
        employee.employmentStatus,
        employee.status,
      ]
        .filter(Boolean)
        .some((value) => normalizeTeamText(value).includes(search))
    ));
  }, [query, scopedEmployees]);

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const columns = useMemo(() => ([
    {
      key: "index",
      header: "#",
      /* A row number counts positions in a table; on a stack of cards it numbers nothing. */
      card: false,
      headerClassName: "w-12",
      render: (row, index) => (
        <span className="text-sm tabular-nums text-slate-500">{index + 1}</span>
      ),
    },
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
      key: "designation",
      header: "Designation",
      cardRole: "subtitle",
      render: (row) => row.position || "Unassigned",
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

          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search employee or designation"
              className="h-9 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
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
                minWidthClassName="min-w-[860px]"
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/*
        * A chief reads this to know who is on their team, so it stays to assignment and contact
        * details. Salary, TIN, GSIS, Pag-IBIG and PhilHealth ride along in the roster payload but
        * are payroll's business, not a division roster's, so they are left out on purpose.
        */}
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
        {viewingEmployee ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border border-slate-200 bg-teal-600 text-lg font-bold text-white shadow-sm">
                {resolveBackendAssetUrl(viewingEmployee.profileImage) ? (
                  <img
                    src={resolveBackendAssetUrl(viewingEmployee.profileImage)}
                    alt={viewingEmployee.fullName || "Employee profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{resolveEmployeeInitials(viewingEmployee)}</span>
                )}
              </div>
              <div>
                <p className="m-0 text-lg font-semibold text-slate-900">
                  {viewingEmployee.fullName || "Unnamed employee"}
                </p>
                <p className="m-0 mt-0.5 text-sm text-slate-500">
                  {viewingEmployee.position || "Unassigned"}
                </p>
              </div>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <TeamProfileField label="Employee ID" value={viewingEmployee.employeeId} />
              <TeamProfileField label="Division" value={viewingEmployee.department || viewingEmployee.division} />
              <TeamProfileField label="Designation" value={viewingEmployee.position} />
              <TeamProfileField label="Employment Status" value={viewingEmployee.employmentStatus} />
              <TeamProfileField label="Status" value={viewingEmployee.status || "Active"} />
              <TeamProfileField label="Date Hired" value={formatTeamDate(viewingEmployee.dateHired)} />
              <TeamProfileField label="Email" value={viewingEmployee.email} />
              <TeamProfileField label="Phone" value={viewingEmployee.phone} />
              <TeamProfileField label="Date of Birth" value={formatTeamDate(viewingEmployee.dateOfBirth)} />
              <TeamProfileField label="Gender" value={viewingEmployee.gender} />
              <TeamProfileField label="Civil Status" value={viewingEmployee.civilStatus} />
              <div className="sm:col-span-2">
                <TeamProfileField label="Address" value={formatTeamAddress(viewingEmployee)} />
              </div>
            </dl>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
