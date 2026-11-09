import React from "react";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

/**
 * The division-roster view of one employee, shared by the Chief's Team/Division Employee page and
 * the division dashboard. Each caller wraps it in its own dialog.
 *
 * A chief reads this to know who is on their team, so it stays to assignment and contact details.
 * Salary, TIN, GSIS, Pag-IBIG and PhilHealth ride along in the roster payload but are payroll's
 * business, not a division roster's, so they are left out on purpose.
 */

export function resolveEmployeeInitials(employee) {
  const parts = String(employee?.fullName || "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "E";
  }

  return parts.slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

export function formatTeamDate(value) {
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

export default function TeamEmployeeProfile({ employee }) {
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border border-slate-200 bg-teal-600 text-lg font-bold text-white shadow-sm">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={employee.fullName || "Employee profile"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{resolveEmployeeInitials(employee)}</span>
          )}
        </div>
        <div>
          <p className="m-0 text-lg font-semibold text-slate-900">
            {employee.fullName || "Unnamed employee"}
          </p>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {employee.position || "Unassigned"}
          </p>
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <TeamProfileField label="Employee ID" value={employee.employeeId} />
        <TeamProfileField label="Division" value={employee.department || employee.division} />
        <TeamProfileField label="Position" value={employee.position} />
        <TeamProfileField label="Designation" value={employee.designation || "None"} />
        <TeamProfileField label="Employment Status" value={employee.employmentStatus} />
        <TeamProfileField label="Status" value={employee.status || "Active"} />
        <TeamProfileField label="Date Hired" value={formatTeamDate(employee.dateHired)} />
        <TeamProfileField label="Email" value={employee.email} />
        <TeamProfileField label="Phone" value={employee.phone} />
        <TeamProfileField label="Date of Birth" value={formatTeamDate(employee.dateOfBirth)} />
        <TeamProfileField label="Gender" value={employee.gender} />
        <TeamProfileField label="Civil Status" value={employee.civilStatus} />
        <div className="sm:col-span-2">
          <TeamProfileField label="Address" value={formatTeamAddress(employee)} />
        </div>
      </dl>
    </div>
  );
}
