import React from "react";
import {
  Building2,
  CalendarDays,
  Mail,
  Phone,
  UserRound,
} from "lucide-react";
import { faClockRotateLeft, faEye, faPen } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../UI/ActionIconButton";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { getRoleBadgeClass, getRoleLabel, getStatusLabel, normalizeStatus } from "../../utils/roleRoutes";
import { currencyFormatter } from "../../utils/format";

export function resolveEmployeeInitials(employee) {
  const name = String(employee?.fullName || employee?.email || "Employee").trim();
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "E"
  );
}

export function formatEmployeeCurrencyValue(value) {
  const amount = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(amount) ? currencyFormatter.format(amount) : "N/A";
}

export function formatEmployeeDateValue(value) {
  const dateText = String(value || "").trim();

  if (!dateText) {
    return "N/A";
  }

  const [year, month, day] = dateText.split("-").map((part) => Number(part));
  const parsedDate = year && month && day ? new Date(year, month - 1, day) : new Date(dateText);

  if (Number.isNaN(parsedDate.getTime())) {
    return dateText;
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
}

export function getEmployeeCardStatus(employee, linkedUser, archiveView = "active") {
  if (archiveView === "archive") {
    return "Archived";
  }

  return getStatusLabel(linkedUser?.status || employee.status || "No Account");
}

export function employeeStatusBadgeClass(status) {
  switch (normalizeStatus(status)) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "inactive":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "archived":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-rose-200 bg-rose-50 text-rose-700";
  }
}

function employeeAccentClass(status) {
  switch (normalizeStatus(status)) {
    case "active":
      return "from-emerald-300 via-emerald-400 to-teal-400";
    case "inactive":
      return "from-amber-300 via-amber-400 to-orange-400";
    case "archived":
      return "from-slate-200 via-slate-300 to-slate-400";
    default:
      return "from-rose-300 via-rose-400 to-red-500";
  }
}

function EmployeeMetaRow({ icon: Icon, label, value, valueClassName = "text-slate-700" }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <Icon size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <p className={`m-0 truncate text-sm font-medium ${valueClassName}`}>{value || "N/A"}</p>
      </div>
    </div>
  );
}

export default function AdminEmployeeCard({
  employee,
  linkedUser = null,
  archiveView = "active",
  onView,
  onEdit,
  onRestore,
  onToggleStatus,
  statusSavingId = null,
}) {
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);
  const statusLabel = getEmployeeCardStatus(employee, linkedUser, archiveView);
  const roleLabel = linkedUser?.role ? getRoleLabel(linkedUser.role) : "Employee";
  const accentClass = employeeAccentClass(statusLabel);
  const isArchived = archiveView === "archive";
  const normalizedStatus = normalizeStatus(statusLabel);
  const isStatusSaving = Boolean(
    linkedUser
    && statusSavingId !== null
    && String(statusSavingId) === String(linkedUser.id)
  );
  const canToggleStatus = Boolean(onToggleStatus)
    && !isArchived
    && Boolean(linkedUser)
    && ["active", "inactive"].includes(normalizedStatus);

  return (
    <article className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl ${isArchived ? "bg-slate-50/70" : ""}`.trim()}>
      <div className={`absolute inset-x-0 bottom-0 h-1.5 bg-gradient-to-r ${accentClass}`} />

      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        {canToggleStatus ? (
          <button
            type="button"
            aria-label={normalizedStatus === "active" ? `Set ${employee.fullName || "employee"} inactive` : `Set ${employee.fullName || "employee"} active`}
            title={normalizedStatus === "active" ? "Click to set inactive" : "Click to set active"}
            disabled={isStatusSaving}
            onClick={() => onToggleStatus(employee)}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70 ${
              normalizedStatus === "active"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 focus:ring-emerald-100"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 focus:ring-amber-100"
            }`}
          >
            {isStatusSaving ? "Saving..." : statusLabel}
          </button>
        ) : (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${employeeStatusBadgeClass(statusLabel)}`}>
            {statusLabel}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {employee.employeeId || "N/A"}
        </span>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
        <div className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-lg font-bold text-slate-500 ring-4 ring-white">
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

        <div className="mt-4 text-center">
          <h3 className="m-0 truncate text-base font-semibold text-slate-950">
            {employee.fullName || "Employee"}
          </h3>
          <p className="m-0 mt-1 truncate text-sm text-slate-500">
            {employee.position || "N/A"}
          </p>
        </div>

        <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <EmployeeMetaRow icon={Building2} label="Division" value={employee.department || "N/A"} />
            <EmployeeMetaRow
              icon={UserRound}
              label="Role"
              value={roleLabel}
              valueClassName={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${getRoleBadgeClass(roleLabel)}`}
            />
            <EmployeeMetaRow icon={Mail} label="Email" value={employee.email || "N/A"} />
            <EmployeeMetaRow icon={Phone} label="Phone" value={employee.phone || "N/A"} />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} aria-hidden="true" />
            Date Hired {formatEmployeeDateValue(employee.dateHired)}
          </span>
          <strong className="text-sm font-semibold text-slate-800">
            {formatEmployeeCurrencyValue(employee.basicSalary)}
          </strong>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <ActionIconButton
            label={`View ${employee.fullName || employee.employeeId || "employee"}`}
            icon={faEye}
            tone="view"
            onClick={() => onView?.(employee)}
          />
          {isArchived ? (
            <ActionIconButton
              label={`Restore ${employee.fullName || employee.employeeId || "employee"}`}
              icon={faClockRotateLeft}
              tone="approve"
              text="Restore"
              onClick={() => onRestore?.(employee)}
            />
          ) : (
            <ActionIconButton
              label={`Edit ${employee.fullName || employee.employeeId || "employee"}`}
              icon={faPen}
              tone="edit"
              onClick={() => onEdit?.(employee)}
            />
          )}
        </div>
      </div>
    </article>
  );
}
