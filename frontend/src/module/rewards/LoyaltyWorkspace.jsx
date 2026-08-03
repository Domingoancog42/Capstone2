import React, { useEffect, useMemo, useState } from "react";
import {
  Award,
  Building2,
  Calendar,
  Filter,
  LogOut,
  Search,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import { faEye } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { resolveEmployeeInitials } from "../../components/employee/AdminEmployeeCard";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import {
  computeAge,
  computeTenure,
  formatLongDate,
  formatTenure,
  formatTenureLong,
  isRetirementEligible,
  resolveAvatarPalette,
  resolveLoyaltyTier,
} from "./loyaltyUtils";

/**
 * Loyalty — the read-only recognition dashboard under Rewards & Recognition. It ranks employees into
 * tenure-based tiers and flags who is old enough to retire, both computed client-side from the same
 * directory every other HR screen already loads.
 *
 * "Mark as Retired" is a UI preview only: `employees` has no "Retired" state (only Active/Inactive,
 * which also drives login access elsewhere), so this screen tracks it in local component state rather
 * than writing to the employee record.
 */

const SORT_OPTIONS = [
  { value: "name", label: "Sort: Name" },
  { value: "tenure", label: "Sort: Tenure (longest)" },
  { value: "age", label: "Sort: Age (oldest)" },
  { value: "department", label: "Sort: Department" },
];

const DEFAULT_LOYALTY_ROWS_PER_PAGE = 10;

function loyaltyStatusLabel(record) {
  if (record.isRetiredLocally) {
    return "Retired";
  }

  return record.isActive ? "Active" : "Inactive";
}

function loyaltyStatusBadgeClass(record) {
  if (record.isRetiredLocally) {
    return "border-slate-200 bg-slate-100 text-slate-600";
  }

  return record.isActive
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function EmployeeAvatar({ employee, className = "" }) {
  const avatarUrl = resolveBackendAssetUrl(employee.profileImage);
  const palette = resolveAvatarPalette(employee.id ?? employee.employeeId ?? employee.fullName);

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden font-bold ${
        avatarUrl ? "" : `${palette.bg} ${palette.text}`
      } ${className}`.trim()}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{resolveEmployeeInitials(employee)}</span>
      )}
    </span>
  );
}

function LoyaltyDetailModal({ record, onClose, onMarkRetired }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const { employee, tenure, age, tier, retirementEligible, isActive, isRetiredLocally } = record;
  const palette = resolveAvatarPalette(employee.id ?? employee.employeeId ?? employee.fullName);
  const statusLabel = isRetiredLocally ? "Retired" : isActive ? "Active" : "Inactive";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${employee.fullName || "Employee"} loyalty details`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`relative h-24 bg-gradient-to-br ${tier.bannerClass}`}>
          <span className="absolute left-4 top-4 inline-flex items-center rounded-full border border-white/40 bg-white/25 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-white/25 text-white transition hover:bg-white/40"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 pb-4">
          <EmployeeAvatar
            employee={employee}
            className={`-mt-10 h-20 w-20 rounded-2xl border-4 border-white text-lg shadow-md ${
              resolveBackendAssetUrl(employee.profileImage) ? "" : palette.bg
            }`}
          />

          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 truncate text-lg font-semibold text-slate-900">{employee.fullName || "Employee"}</h2>
              <p className="m-0 truncate text-sm text-slate-500">{employee.position || "N/A"}</p>
            </div>
            <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tier.badgeClass}`}>
              {tier.label}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-white ${palette.bar}`}>
              <span className="text-center leading-none">
                <span className="block text-lg font-bold">{tenure ? tenure.years : "—"}</span>
                <span className="block text-[9px] font-semibold tracking-wide">YRS</span>
              </span>
            </span>
            <div className="min-w-0">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Years of Service</p>
              <p className="m-0 text-sm font-semibold text-slate-900">{formatTenureLong(tenure)}</p>
              <p className="m-0 text-xs text-slate-500">Joined {formatLongDate(employee.dateHired)}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Calendar size={13} aria-hidden="true" /> Age
              </p>
              <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{age != null ? `${age} years` : "N/A"}</p>
              <p className="m-0 text-xs text-slate-400">{formatLongDate(employee.dateOfBirth)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Building2 size={13} aria-hidden="true" /> Department
              </p>
              <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{employee.department || "N/A"}</p>
            </div>
          </div>

          {retirementEligible ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <Award size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <p className="m-0 text-sm font-semibold text-amber-800">Retirement Eligible</p>
                <p className="m-0 text-xs leading-5 text-amber-700">
                  This employee is {age} years old and qualifies for retirement.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-2.5">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {!isRetiredLocally && isActive ? (
              <button
                type="button"
                onClick={() => onMarkRetired(record)}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-amber-500 bg-amber-500 px-4 text-base font-semibold leading-none text-white transition hover:border-amber-600 hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              >
                <LogOut size={18} aria-hidden="true" />
                <span>Mark as Retired</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoyaltyWorkspace({ employees = [] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [selectedKey, setSelectedKey] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  // UI preview only — see the file header. Not persisted, not sent to the server.
  const [retiredKeys, setRetiredKeys] = useState(() => new Set());

  const records = useMemo(() => {
    const today = new Date();

    return (employees || []).map((employee) => {
      const tenure = computeTenure(employee.dateHired, today);
      const age = computeAge(employee.dateOfBirth, today);
      const key = String(employee.id ?? employee.employeeId ?? employee.fullName);

      return {
        employee,
        key,
        tenure,
        age,
        tier: resolveLoyaltyTier(tenure ? tenure.years : 0),
        retirementEligible: isRetirementEligible(age),
        isActive: String(employee.status || "").toLowerCase() === "active",
        isRetiredLocally: retiredKeys.has(key),
      };
    });
  }, [employees, retiredKeys]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = records.filter((record) => {
      const matchesQuery =
        !normalizedQuery ||
        [record.employee.fullName, record.employee.position, record.employee.department].some((value) =>
          String(value || "").toLowerCase().includes(normalizedQuery)
        );

      const effectiveStatus = record.isRetiredLocally ? "retired" : record.isActive ? "active" : "inactive";
      const matchesStatus = !statusFilter || effectiveStatus === statusFilter;

      return matchesQuery && matchesStatus;
    });

    const sorted = [...filtered];
    const tenureMonths = (record) => (record.tenure ? record.tenure.years * 12 + record.tenure.months : -1);

    switch (sortBy) {
      case "tenure":
        sorted.sort((a, b) => tenureMonths(b) - tenureMonths(a));
        break;
      case "age":
        sorted.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
        break;
      case "department":
        sorted.sort((a, b) => String(a.employee.department || "").localeCompare(String(b.employee.department || "")));
        break;
      default:
        sorted.sort((a, b) => String(a.employee.fullName || "").localeCompare(String(b.employee.fullName || "")));
    }

    return sorted;
  }, [records, query, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / DEFAULT_LOYALTY_ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * DEFAULT_LOYALTY_ROWS_PER_PAGE;
    return filteredRecords.slice(startIndex, startIndex + DEFAULT_LOYALTY_ROWS_PER_PAGE);
  }, [filteredRecords, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter, sortBy]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.key === selectedKey) || null,
    [records, selectedKey]
  );

  const handleMarkRetired = async (record) => {
    const confirmation = await Swal.fire({
      title: "Mark as retired?",
      html: `<strong>${record.employee.fullName || "This employee"}</strong> will show as retired on this dashboard.<br/><span style="font-size:13px;color:#64748b;">This is a UI preview only — it does not change their employment record.</span>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Mark as retired",
      confirmButtonColor: "#D97706",
      cancelButtonText: "Cancel",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setRetiredKeys((current) => {
      const next = new Set(current);
      next.add(record.key);
      return next;
    });
    setSelectedKey(null);
    toast.success(`${record.employee.fullName || "Employee"} marked as retired (UI preview only).`);
  };

  const columns = [
    {
      key: "index",
      header: "#",
      render: (_record, index) => (
        <span className="text-sm font-semibold text-slate-600">
          {(safePage - 1) * DEFAULT_LOYALTY_ROWS_PER_PAGE + index + 1}
        </span>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      render: (record) => (
        <button
          type="button"
          onClick={() => setSelectedKey(record.key)}
          className="group flex items-center gap-3 border-0 bg-transparent p-0 text-left"
        >
          <EmployeeAvatar employee={record.employee} className="h-9 w-9 rounded-xl text-xs" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-900 group-hover:text-[#D61E1E]">
              {record.employee.fullName || "Employee"}
            </span>
            <span className="block truncate text-xs text-slate-500">{record.employee.position || "N/A"}</span>
          </span>
        </button>
      ),
    },
    {
      key: "division",
      header: "Division",
      render: (record) => <span className="text-slate-600">{record.employee.department || "Unassigned"}</span>,
    },
    {
      key: "tenure",
      header: "Tenure",
      render: (record) => <span className="text-slate-600">{formatTenure(record.tenure)}</span>,
    },
    {
      key: "age",
      header: "Age",
      render: (record) => <span className="text-slate-600">{record.age != null ? `${record.age} yrs` : "N/A"}</span>,
    },
    {
      key: "tier",
      header: "Tier",
      render: (record) => (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${record.tier.badgeClass}`}>
          {record.tier.label}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (record) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${loyaltyStatusBadgeClass(record)}`}>
            {loyaltyStatusLabel(record)}
          </span>
          {record.retirementEligible ? (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Retirement
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (record) => (
        <ActionIconButton
          label={`View ${record.employee.fullName || "employee"}`}
          icon={faEye}
          tone="view"
          onClick={() => setSelectedKey(record.key)}
        />
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Loyalty</CardTitle>
            <CardDescription>
              Recognize tenure with loyalty tiers and see who is eligible for retirement.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_170px_180px]">
            <label className="relative">
              <span className="sr-only">Search employees</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, position, or department"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="retired">Retired</option>
            </select>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <Table
              columns={columns}
              data={paginatedRecords}
              rowKey="key"
              tableClassName="[&_tbody_tr:last-child>td]:border-b-0"
              emptyState={
                <div className="py-5">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                    <Filter size={20} aria-hidden="true" />
                  </div>
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No employees match your search</p>
                  <p className="m-0 mt-1 text-sm text-slate-500">Try a different name, position, or department.</p>
                </div>
              }
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * DEFAULT_LOYALTY_ROWS_PER_PAGE + 1}
              {" "}to {Math.min(safePage * DEFAULT_LOYALTY_ROWS_PER_PAGE, filteredRecords.length)} of {filteredRecords.length} employees
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </CardContent>
      </Card>

      {selectedRecord ? (
        <LoyaltyDetailModal record={selectedRecord} onClose={() => setSelectedKey(null)} onMarkRetired={handleMarkRetired} />
      ) : null}
    </>
  );
}
