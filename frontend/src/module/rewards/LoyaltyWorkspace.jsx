import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Building2,
  Calendar,
  Filter,
  Search,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { faAward, faEye, faRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { resolveEmployeeInitials } from "../../components/employee/AdminEmployeeCard";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { resolveUserRoleKey } from "../../utils/roleRoutes";
import { fetchServiceRecordSteps, separateEmployee } from "../../services/api";
import {
  computeAge,
  computeTenure,
  formatLongDate,
  formatTenure,
  formatTenureLong,
  HIGHEST_SALARY_STEP,
  isRetirementEligible,
  isSeparatedStatus,
  isSteplessEmploymentStatus,
  loyaltyStatusBadgeClass,
  normalizeEmployeeStatus,
  resolveAvatarPalette,
  resolveLoyaltyStatusLabel,
  resolveLoyaltyTier,
  resolveServiceStep,
  RETIREMENT_ELIGIBLE_AGE,
  SEPARATION_TYPES,
  STEP_INCREMENT_YEARS,
  todayAsDateInput,
  yearsUntilRetirement,
} from "./loyaltyUtils";

/**
 * Loyalty — the recognition dashboard under Rewards & Recognition. It ranks employees into
 * tenure-based tiers and flags who is old enough to retire, both computed client-side from the same
 * directory every other HR screen already loads.
 *
 * Retirement and resignation are the two write actions on this screen. Both are real: they move
 * `employees.status` and close the employee's service record with a separation date and cause, so
 * the departure reaches their CS Form No. 1 rather than living only on this dashboard. Retirement is
 * gated on the GSIS optional age, in the UI and again on the server.
 */

const SORT_OPTIONS = [
  { value: "name", label: "Sort: Name" },
  { value: "tenure", label: "Sort: Tenure (longest)" },
  { value: "age", label: "Sort: Age (oldest)" },
  { value: "department", label: "Sort: Department" },
];

/*
 * Who sees only their own division on this roster. HR Staff, Admin, and the HR Head see the whole
 * office. Same rule as
 * DIVISION_SCOPED_SERVICE_RECORD_ROLE_KEYS in ServiceRecordWorkspace.jsx: the desk that maintains a
 * division's records is the desk that reads its loyalty tiers.
 */
const DIVISION_SCOPED_LOYALTY_ROLE_KEYS = new Set();

/*
 * A scoped desk works one division, so ordering rows by department would put every row in the same
 * bucket; the option is left out rather than offered as a no-op.
 */
const SCOPED_SORT_OPTIONS = SORT_OPTIONS.filter((option) => option.value !== "department");

const DEFAULT_LOYALTY_ROWS_PER_PAGE = 10;

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

/**
 * Shared overlay for both cards on this screen.
 *
 * z-[70] is the same rung ProfileFloatingCard sits on, above the fixed sidebar (z-50) and header
 * (z-40) — at z-50 the card shared a layer with the sidebar and collided with it. Scrolling the
 * overlay rather than centring the card keeps a tall profile reachable on short viewports, and
 * locking the page keeps the roster from scrolling behind it.
 */
function LoyaltyModalShell({ onClose, ariaLabel, children }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** The headline figure on both cards: whole years served, with the exact span underneath. */
function YearsOfServiceCard({ record }) {
  const { employee, tenure } = record;
  const palette = resolveAvatarPalette(employee.id ?? employee.employeeId ?? employee.fullName);

  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
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
  );
}

function AgeAndDepartment({ employee, age }) {
  return (
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
  );
}

/**
 * The step as the roster and the detail card word it. `due` marks an increment that has fallen due
 * but is not on the service record yet, which is HR's cue to enter it there.
 */
function describeServiceStep(record) {
  const { serviceStep } = record;

  if (!serviceStep) {
    return {
      title: "—",
      detail: !record.stepsLoaded
        ? ""
        : isSteplessEmploymentStatus(record.employmentStatus)
          ? "No salary steps"
          : "No step on record",
      tone: "muted",
    };
  }

  const title = `Step ${serviceStep.step}`;

  if (serviceStep.stopped) {
    return { title, detail: `Stopped (${normalizeEmployeeStatus(record.status)})`, tone: "muted" };
  }

  if (serviceStep.dueSince) {
    return { title, detail: `Due since ${formatLongDate(serviceStep.dueSince)}`, tone: "due" };
  }

  return {
    title,
    detail: serviceStep.nextStep
      ? `Step ${serviceStep.nextStep} on ${formatLongDate(serviceStep.nextStepDate)}`
      : "Highest step",
    tone: "normal",
  };
}

function StepIncrementCard({ record }) {
  const { serviceStep } = record;
  const { title, tone } = describeServiceStep(record);
  let detail;

  if (!serviceStep) {
    detail = !record.stepsLoaded
      ? "Loading the step from the service record..."
      : isSteplessEmploymentStatus(record.employmentStatus)
        ? `${record.employmentStatus} is not on the salary schedule, so there are no steps to move up.`
        : "No step on the service record yet.";
  } else if (serviceStep.stopped) {
    detail = `Step increments stopped when they ${normalizeEmployeeStatus(record.status)}.`;
  } else if (serviceStep.dueSince) {
    detail = `Moved up to Step ${serviceStep.step} on ${formatLongDate(serviceStep.dueSince)}, but the service record still shows Step ${serviceStep.recordedStep}. Add a step increment entry there so the salary follows.`;
  } else if (serviceStep.nextStep) {
    detail = `Moves up to Step ${serviceStep.nextStep} on ${formatLongDate(serviceStep.nextStepDate)}.`;
  } else {
    detail = "Already at the highest step.";
  }

  return (
    <div
      className={`mt-3 flex items-start gap-2.5 rounded-xl border p-3.5 ${
        tone === "due" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <TrendingUp
        size={18}
        className={`mt-0.5 shrink-0 ${tone === "due" ? "text-amber-600" : "text-emerald-600"}`}
        aria-hidden="true"
      />
      <div>
        <p className="m-0 text-sm font-semibold text-slate-900">
          {title === "—" ? "Step increment" : title}
          {record.salaryGrade ? ` · SG ${record.salaryGrade}` : ""}
        </p>
        <p className="m-0 text-xs leading-5 text-slate-600">{detail}</p>
        <p className="m-0 mt-1 text-xs leading-5 text-slate-400">
          One step for every {STEP_INCREMENT_YEARS} years of service, up to Step {HIGHEST_SALARY_STEP}, until
          the employee resigns or retires.
        </p>
      </div>
    </div>
  );
}

function LoyaltyDetailModal({ record, onClose, onSeparate }) {
  const { employee, age, tier, retirementEligible, statusLabel, isSeparated, isActive } = record;
  const palette = resolveAvatarPalette(employee.id ?? employee.employeeId ?? employee.fullName);

  return (
    <LoyaltyModalShell onClose={onClose} ariaLabel={`${employee.fullName || "Employee"} loyalty details`}>
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
        {/*
          The avatar is pulled up into the banner, and the banner is `relative` — positioned
          elements paint after static ones, so without `relative z-10` here the gradient covers the
          top half of the avatar.
        */}
        <EmployeeAvatar
          employee={employee}
          className={`relative z-10 -mt-10 h-20 w-20 rounded-2xl border-4 border-white text-lg shadow-md ${
            resolveBackendAssetUrl(employee.profileImage) ? "" : palette.bg
          }`}
        />

        <div className="mt-3 min-w-0">
          <h2 className="m-0 truncate text-lg font-semibold text-slate-900">{employee.fullName || "Employee"}</h2>
          <p className="m-0 truncate text-sm text-slate-500">{employee.position || "N/A"}</p>
        </div>

        <div className="mt-4">
          <YearsOfServiceCard record={record} />
        </div>

        <AgeAndDepartment employee={employee} age={age} />

        <StepIncrementCard record={record} />

        {retirementEligible && !isSeparated ? (
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

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {!isSeparated && isActive ? (
            <>
              <Button variant="secondary" onClick={() => onSeparate(record, "resignation")}>
                Resignation
              </Button>
              <button
                type="button"
                disabled={!retirementEligible}
                title={retirementEligible ? undefined : `Eligible at age ${RETIREMENT_ELIGIBLE_AGE}.`}
                onClick={() => onSeparate(record, "retirement")}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-amber-500 bg-amber-500 px-4 text-base font-semibold leading-none text-white transition hover:border-amber-600 hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Award size={18} aria-hidden="true" />
                <span>Retirement</span>
              </button>
            </>
          ) : null}
        </div>
      </div>
    </LoyaltyModalShell>
  );
}

/**
 * The confirmation card for a retirement or resignation.
 *
 * It leads with years of service because that is the figure the decision turns on, and it states
 * plainly what the confirm button will write — a separation is not something to discover afterwards.
 */
function SeparationModal({ record, type, busy, onClose, onConfirm }) {
  const definition = SEPARATION_TYPES[type];
  const [effectiveDate, setEffectiveDate] = useState(() => todayAsDateInput());
  const [remarks, setRemarks] = useState("");

  const { employee, age, tier, retirementEligible } = record;
  const isRetirement = type === "retirement";
  const yearsToGo = yearsUntilRetirement(age);
  const requestClose = () => {
    if (!busy) {
      onClose();
    }
  };

  return (
    <LoyaltyModalShell
      onClose={requestClose}
      ariaLabel={`${definition.label} for ${employee.fullName || "employee"}`}
    >
      <div className={`relative h-20 bg-gradient-to-br ${isRetirement ? "from-amber-400 to-amber-600" : "from-slate-400 to-slate-600"}`}>
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/25 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
          {definition.label}
        </span>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-white/25 text-white transition hover:bg-white/40"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="px-4 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <EmployeeAvatar employee={employee} className="h-11 w-11 shrink-0 rounded-xl text-sm" />
          <div className="min-w-0">
            <h2 className="m-0 truncate text-base font-semibold text-slate-900">{employee.fullName || "Employee"}</h2>
            <p className="m-0 truncate text-sm text-slate-500">{employee.position || "N/A"}</p>
          </div>
          {/* The tenure tier is recognition, which a resignation is not — it only belongs on the retirement card. */}
          {isRetirement ? (
            <span className={`ml-auto inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tier.badgeClass}`}>
              {tier.label}
            </span>
          ) : null}
        </div>

        <div className="mt-4">
          <YearsOfServiceCard record={record} />
        </div>

        <AgeAndDepartment employee={employee} age={age} />

        {isRetirement ? (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <Award size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <p className="m-0 text-sm font-semibold text-amber-800">
                {retirementEligible ? "Retirement Eligible" : "Not yet eligible"}
              </p>
              <p className="m-0 text-xs leading-5 text-amber-700">
                {retirementEligible
                  ? `${age} years old, at or past the GSIS optional retirement age of ${RETIREMENT_ELIGIBLE_AGE}.`
                  : `${age != null ? `${age} years old — ` : ""}eligible at ${RETIREMENT_ELIGIBLE_AGE}${
                      yearsToGo ? `, ${yearsToGo} year${yearsToGo === 1 ? "" : "s"} from now` : ""
                    }.`}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3">
          <InputField
            label="Effective date"
            name="effectiveDate"
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
          <InputField
            label="Remarks (optional)"
            name="remarks"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            placeholder={isRetirement ? "Compulsory retirement, GSIS approval no..." : "Reason, clearance reference..."}
          />
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <p className="m-0 text-xs leading-5 text-slate-600">
            Confirming sets their status to <strong>{definition.status}</strong> and records the
            separation on their service record as of{" "}
            <strong>{formatLongDate(effectiveDate)}</strong> with the cause{" "}
            <strong>{definition.label}</strong> — closing the appointment in force, or adding an
            entry if none is open — so it lists on their CS Form No. 1. Their sign-in access is not
            changed.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy || !effectiveDate || (isRetirement && !retirementEligible)}
            onClick={() => onConfirm({ record, type, effectiveDate, remarks })}
            className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold leading-none text-white transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
              isRetirement
                ? "border border-amber-500 bg-amber-500 hover:border-amber-600 hover:bg-amber-600 focus:ring-amber-500/20"
                : "border border-slate-500 bg-slate-500 hover:border-slate-600 hover:bg-slate-600 focus:ring-slate-500/20"
            }`}
          >
            {busy ? "Saving..." : definition.confirmLabel}
          </button>
        </div>
      </div>
    </LoyaltyModalShell>
  );
}

export default function LoyaltyWorkspace({ user = null, employees = [] }) {
  const isDivisionScoped = DIVISION_SCOPED_LOYALTY_ROLE_KEYS.has(resolveUserRoleKey(user));
  const scopedDivision = isDivisionScoped ? String(user?.division || user?.department || "").trim() : "";
  const sortOptions = isDivisionScoped ? SCOPED_SORT_OPTIONS : SORT_OPTIONS;
  const rosterHasNoDivision = isDivisionScoped && !scopedDivision;

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [selectedKey, setSelectedKey] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [separationTarget, setSeparationTarget] = useState(null);
  const [separationBusy, setSeparationBusy] = useState(false);
  /*
   * Statuses this screen has just written, keyed by row. The employee directory arrives as a prop
   * from whichever dashboard hosts this screen and neither of them reloads it on demand, so a
   * confirmed separation is shown from here until the next load — at which point the prop already
   * carries the same status and the overlay becomes a no-op.
   */
  const [separatedStatuses, setSeparatedStatuses] = useState(() => new Map());
  /*
   * Each employee's step and the date it took effect, keyed by employee record id, from the service
   * records. Refetched whenever a service record or employee changes, so a step increment HR enters
   * shows here without a reload. Null until the first load lands, which the step column shows as a dash.
   */
  const [stepsByEmployee, setStepsByEmployee] = useState(null);

  useAutoRefreshOnChange(
    useCallback(async () => {
      const result = await fetchServiceRecordSteps();
      const steps = Array.isArray(result?.steps) ? result.steps : [];

      setStepsByEmployee(new Map(steps.map((entry) => [String(entry.employeeRecordId), entry])));
    }, []),
    { topics: ["service_record", "employee"] }
  );

  // The roster a scoped desk ranks is its own division only; an HR Staff account with no division
  // on its employee profile gets an empty list rather than everyone's.
  const scopedEmployees = useMemo(() => {
    if (!isDivisionScoped) {
      return employees || [];
    }

    const target = scopedDivision.toLowerCase();

    return target
      ? (employees || []).filter(
        (employee) => String(employee.department || employee.division || "").trim().toLowerCase() === target
      )
      : [];
  }, [employees, isDivisionScoped, scopedDivision]);

  const records = useMemo(() => {
    const today = new Date();

    return scopedEmployees.map((employee) => {
      const tenure = computeTenure(employee.dateHired, today);
      const age = computeAge(employee.dateOfBirth, today);
      const key = String(employee.id ?? employee.employeeId ?? employee.fullName);
      const status = separatedStatuses.get(key) || employee.status || "";
      const retirementEligible = isRetirementEligible(age);
      const stepEntry = stepsByEmployee?.get(String(employee.id)) || null;
      const employmentStatus = employee.employmentStatus || stepEntry?.employmentStatus || "";

      return {
        employee,
        key,
        tenure,
        age,
        tier: resolveLoyaltyTier(tenure ? tenure.years : 0),
        retirementEligible,
        status,
        statusLabel: resolveLoyaltyStatusLabel({ status, retirementEligible }),
        isActive: normalizeEmployeeStatus(status) === "active",
        isSeparated: isSeparatedStatus(status),
        employmentStatus,
        salaryGrade: stepEntry?.salaryGrade || "",
        stepsLoaded: Boolean(stepsByEmployee),
        serviceStep: stepsByEmployee
          ? resolveServiceStep({
            recordedStep: stepEntry?.step ?? null,
            stepSince: stepEntry?.stepSince,
            dateHired: employee.dateHired,
            employmentStatus,
            separated: isSeparatedStatus(status),
            today,
          })
          : null,
      };
    });
  }, [scopedEmployees, separatedStatuses, stepsByEmployee]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = records.filter((record) => {
      const matchesQuery =
        !normalizedQuery ||
        [record.employee.fullName, record.employee.position, record.employee.department].some((value) =>
          String(value || "").toLowerCase().includes(normalizedQuery)
        );

      const matchesStatus = !statusFilter || normalizeEmployeeStatus(record.statusLabel) === statusFilter;

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

  const separationRecord = useMemo(
    () => (separationTarget ? records.find((record) => record.key === separationTarget.key) || null : null),
    [records, separationTarget]
  );

  /** Opens the confirmation card. The detail modal steps aside so the two never stack. */
  const handleOpenSeparation = (record, type) => {
    setSelectedKey(null);
    setSeparationTarget({ key: record.key, type });
  };

  const handleConfirmSeparation = async ({ record, type, effectiveDate, remarks }) => {
    if (separationBusy) {
      return;
    }

    setSeparationBusy(true);

    try {
      const result = await separateEmployee({
        id: record.employee.id,
        separationType: type,
        effectiveDate,
        remarks,
      });

      const nextStatus = result?.employee?.status || SEPARATION_TYPES[type].status;

      setSeparatedStatuses((current) => {
        const next = new Map(current);
        next.set(record.key, nextStatus);
        return next;
      });
      setSeparationTarget(null);
      toast.success(
        result?.message || `${record.employee.fullName || "This employee"} has been recorded as ${SEPARATION_TYPES[type].verb}.`
      );

      // The separation normally lands on the service record either way. It only fails to when the
      // table is not installed, and that is worth saying rather than letting the form look wrong.
      if (result?.serviceRecord === "skipped") {
        toast("The service record table is not installed, so this separation is not on CS Form No. 1.", {
          icon: "⚠️",
        });
      }
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to record the separation.");
    } finally {
      setSeparationBusy(false);
    }
  };

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const columns = [
    {
      key: "employee",
      header: "Employee",
      cardRole: "title",
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
      header: "Time period",
      render: (record) => <span className="text-slate-600">{formatTenure(record.tenure)}</span>,
    },
    {
      key: "step",
      header: "Step",
      render: (record) => {
        const { title, detail, tone } = describeServiceStep(record);

        return (
          <span
            className="block"
            title={
              tone === "due"
                ? `The service record still shows Step ${record.serviceStep.recordedStep}. Add a step increment entry there.`
                : undefined
            }
          >
            <span className="block font-semibold text-slate-900">{title}</span>
            {detail ? (
              <span className={`block text-xs ${tone === "due" ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                {detail}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "age",
      header: "Age",
      render: (record) => <span className="text-slate-600">{record.age != null ? `${record.age} yrs` : "N/A"}</span>,
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (record) => (
        <span
          title={
            record.statusLabel === "Eligible"
              ? `Still serving at ${record.age} — eligible to retire from age ${RETIREMENT_ELIGIBLE_AGE}.`
              : undefined
          }
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${loyaltyStatusBadgeClass(record.statusLabel)}`}
        >
          {record.statusLabel}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (record) => {
        const name = record.employee.fullName || "employee";
        // Already left, or never active to begin with — there is nothing left to separate.
        const canSeparate = record.isActive && !record.isSeparated;

        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionIconButton
              label={`View ${name}`}
              icon={faEye}
              tone="view"
              onClick={() => setSelectedKey(record.key)}
            />
            {canSeparate ? (
              <>
                <ActionIconButton
                  label={
                    record.retirementEligible
                      ? `Record retirement for ${name}`
                      : `${name} is eligible to retire at age ${RETIREMENT_ELIGIBLE_AGE}`
                  }
                  text="Retirement"
                  icon={faAward}
                  tone="retire"
                  disabled={!record.retirementEligible}
                  onClick={() => handleOpenSeparation(record, "retirement")}
                />
                <ActionIconButton
                  label={`Record resignation for ${name}`}
                  text="Resignation"
                  icon={faRightFromBracket}
                  tone="resign"
                  onClick={() => handleOpenSeparation(record, "resignation")}
                />
              </>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Loyalty</CardTitle>
            <CardDescription>
              Recognize tenure with loyalty tiers, follow step increments, and see who is eligible for retirement.
              {isDivisionScoped && scopedDivision ? ` Showing ${scopedDivision} only.` : ""}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_170px_180px]">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Employees</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={isDivisionScoped ? "Search by name or position" : "Search by name, position, or department"}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">All statuses</option>
                <option value="eligible">Eligible</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="retired">Retired</option>
                <option value="resigned">Resigned</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Sort By</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
          <div className="lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
            <Table
              columns={columns}
              data={paginatedRecords}
              rowKey="key"
              cardsClassName="lg:hidden"
              tableWrapperClassName="hidden lg:block"
              tableClassName="[&_tbody_tr:last-child>td]:border-b-0"
              emptyState={
                <div className="py-5">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                    {rosterHasNoDivision ? <Building2 size={20} aria-hidden="true" /> : <Filter size={20} aria-hidden="true" />}
                  </div>
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
                    {rosterHasNoDivision ? "Your employee profile has no assigned division" : "No employees match your search"}
                  </p>
                  <p className="m-0 mt-1 text-sm text-slate-500">
                    {rosterHasNoDivision
                      ? "Loyalty is listed for your division only. Ask an administrator to set your division in Employee Management."
                      : isDivisionScoped
                        ? "Try a different name or position."
                        : "Try a different name, position, or department."}
                  </p>
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
        <LoyaltyDetailModal
          record={selectedRecord}
          onClose={() => setSelectedKey(null)}
          onSeparate={handleOpenSeparation}
        />
      ) : null}

      {separationRecord ? (
        <SeparationModal
          key={`${separationRecord.key}-${separationTarget.type}`}
          record={separationRecord}
          type={separationTarget.type}
          busy={separationBusy}
          onClose={() => setSeparationTarget(null)}
          onConfirm={handleConfirmSeparation}
        />
      ) : null}
    </>
  );
}
