import React, { useCallback, useEffect, useMemo, useState } from "react";
import { faBan, faBoxArchive, faCheck, faEye, faRotateLeft, faThumbsUp, faXmark } from "@fortawesome/free-solid-svg-icons";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import EmployeeSearchSelect from "../../components/leave/EmployeeSearchSelect";
import { SettingsNotice, SettingsSelect } from "../../components/settings";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchPromotionOptions,
  fetchPromotions,
  preparePromotion,
  updatePromotionStatus,
} from "../../services/promotionService";
import { requestApprovalCaptcha, isCaptchaFailure } from "../../utils/approvalCaptcha";
import { canArchiveModule, confirmArchiveRecord, confirmRestoreRecord } from "../../utils/archiveActions";
import { formatDateDisplay, resolveRoleKey, todayDateInputValue } from "../../utils/leaveHelpers";
import { formatCurrency } from "../../utils/format";
import { SALARY_GRADE_OPTIONS, getStepOptions, lookupSalary } from "../serviceRecord/salarySchedule";
import PromotionStageForm from "./PromotionStageForm";
import PromotionWorkflowHistory from "./PromotionWorkflowHistory";
import { EVALUATION_STAGES, OPEN_PROMOTION_STATUSES, PROMOTION_STATUS_OPTIONS, promotionStatusLabel } from "./promotionWorkflow";

/*
 * Promotions move an employee up the position hierarchy. The rule the whole screen is built
 * around: a target position must sit on a strictly higher `level` than the one the employee
 * holds (see designations.hierarchy_level, edited from Settings). promotion.php enforces it; this
 * screen makes it visible by only ever offering higher designations in the form.
 *
 * Applications start at Assessment. HR records the examination, interview and submission before
 * recommending the candidate; only the Regional Director's final approval changes the appointment.
 */
/*
 * The desks that prepare a promotion, and cancel one still in flight. A chief prepares for the
 * Regular employees of their own division. Mirrors promotion_can_prepare() in
 * backend/api/promotion.php.
 */
const PREPARER_ROLES = new Set(["admin", "hrstaff", "chief"]);

/*
 * The desk that nominates: the HR Head drafts through the same form as a preparer, for a Regular
 * employee of any division. The application still starts at assessment. Nominating does
 * not carry the preparers' Cancel. Mirrors promotion_can_nominate() in backend/api/promotion.php.
 */
const NOMINATOR_ROLES = new Set(["hrhead"]);

/*
 * Desks confined to their own division: they draft for its employees only, and their register shows
 * its promotions only. Mirrors PROMOTION_DIVISION_SCOPED_ROLES in backend/api/promotion.php, which
 * lists and accepts only that division for them.
 */
const DIVISION_SCOPED_PROMOTION_ROLE_KEYS = new Set(["chief"]);
/*
 * The desks that evaluate applications and recommend a completed submission to the Director.
 * Mirrors promotion_can_recommend() in backend/api/promotion.php.
 */
const RECOMMENDER_ROLES = new Set(["admin", "hrhead", "hrstaff"]);
const APPROVER_ROLES = new Set(["admin", "regionaldirector"]);

/*
 * Admin and the HR Head can start applications across divisions; a Chief starts applications for
 * their own division. HR Staff retain their evaluation and cancellation actions.
 */
const REGISTER_DRAFT_ROLES = new Set(["admin", "chief", "hrhead"]);

const ROWS_PER_PAGE = 10;

const STATUS_OPTIONS = PROMOTION_STATUS_OPTIONS;

const EMPTY_FORM = {
  employeeRecordId: "",
  toDesignationId: "",
  salaryGrade: "",
  stepIncrement: "",
  toSalary: "",
  justification: "",
};

function positionAvailabilityLabel(designation) {
  if (designation?.isAvailable === true) return "Available";
  if (designation?.isAvailable === false) return "Not available";
  return "Availability unknown";
}

function positionAvailabilityClasses(designation) {
  if (designation?.isAvailable === true) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (designation?.isAvailable === false) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function promotionStatusBadgeClasses(statusKey) {
  switch (String(statusKey || "").toLowerCase()) {
    case "approved":
      return "border border-emerald-200 bg-emerald-50 text-emerald-700";
    case "recommended":
    case "examination":
    case "interview":
      return "border border-sky-200 bg-sky-50 text-sky-700";
    case "rejected":
    case "disapproved":
    case "not_qualified":
      return "border border-rose-200 bg-rose-50 text-rose-700";
    case "cancelled":
      return "border border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border border-amber-200 bg-amber-50 text-amber-700";
  }
}

/** What the status means for whoever is reading it, since "Recommended" alone does not say whose desk it sits on. */
export function promotionStatusHint(statusKey) {
  switch (String(statusKey || "").toLowerCase()) {
    case "pending":
    case "submission":
      return "Awaiting HR recommendation";
    case "assessment":
      return "HR qualification screening";
    case "examination":
      return "Record examination schedule and result";
    case "interview":
      return "Record interview panel and rating";
    case "recommended":
      return "Awaiting Regional Director approval";
    default:
      return "";
  }
}

function StatusBadge({ promotion }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${promotionStatusBadgeClasses(promotion.statusKey)}`}>
        {promotion.status}
      </span>
      {promotionStatusHint(promotion.statusKey) ? (
        <span className="text-[11px] text-slate-500">{promotionStatusHint(promotion.statusKey)}</span>
      ) : null}
    </span>
  );
}

function MoveCell({ promotion }) {
  return (
    <span className="block min-w-0 text-sm">
      <span className="block text-slate-500">{promotion.fromDesignation || "No position"}</span>
      <span className="mt-0.5 flex items-center gap-1 font-semibold text-slate-900">
        <ArrowUpRight size={14} className="shrink-0 text-emerald-600" aria-hidden="true" />
        {promotion.toDesignation}
      </span>
    </span>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-b-0">
      <span className="shrink-0 font-semibold text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{children}</span>
    </div>
  );
}

/*
 * `mode="manage"` is the register the HR desks and the Regional Director work. `mode="employee"` is
 * My Promotion: the signed-in employee's own approved promotions, read-only -- promotion.php hands
 * that desk nothing else, so there is no drafting, deciding, archiving, or status to filter by.
 */
export default function PromotionWorkspace({ user, mode = "manage" }) {
  const isEmployeeView = mode === "employee";
  const roleKey = resolveRoleKey(user);
  const canPrepare = !isEmployeeView && PREPARER_ROLES.has(roleKey);
  const canNominate = !isEmployeeView && NOMINATOR_ROLES.has(roleKey);
  // Preparers and nominators use the same application form, starting at assessment.
  const canDraft = (canPrepare || canNominate) && REGISTER_DRAFT_ROLES.has(roleKey);
  const canRecommend = !isEmployeeView && RECOMMENDER_ROLES.has(roleKey);
  const recommendLabel = "Recommend";
  const canApprove = !isEmployeeView && APPROVER_ROLES.has(roleKey);
  const canArchive = !isEmployeeView && canArchiveModule(roleKey, "promotions");
  /* Chiefs draft for and read their own division only; HR Staff work organization-wide. */
  const isPreparerDivisionScoped = DIVISION_SCOPED_PROMOTION_ROLE_KEYS.has(roleKey);
  const preparerDivision = isPreparerDivisionScoped ? String(user?.division || "").trim() : "";

  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [archiveView, setArchiveView] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  const [options, setOptions] = useState({ designations: [], employees: [] });
  const [optionsError, setOptionsError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState(null);

  const loadPromotions = useCallback(
    async ({ background = false } = {}) => {
      if (!background) {
        setLoading(true);
      }

      try {
        const result = await fetchPromotions({ archived: archiveView });
        setPromotions(Array.isArray(result?.promotions) ? result.promotions : []);
        setError("");
      } catch (requestError) {
        if (!background) {
          setPromotions([]);
        }
        setError(requestError?.response?.data?.message || "Unable to load promotions.");
      } finally {
        if (!background) {
          setLoading(false);
        }
      }
    },
    [archiveView]
  );

  const loadOptions = useCallback(async () => {
    if (!canDraft) {
      return;
    }

    try {
      const result = await fetchPromotionOptions();
      setOptions({
        designations: Array.isArray(result?.designations) ? result.designations : [],
        employees: Array.isArray(result?.employees) ? result.employees : [],
      });
      setOptionsError("");
    } catch (requestError) {
      setOptionsError(requestError?.response?.data?.message || "Unable to load the position catalog.");
    }
  }, [canDraft]);

  useEffect(() => {
    void loadPromotions();
  }, [loadPromotions]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  /*
   * The effects above own the first load and the archive-view switch. This only adds the reload
   * nobody on this screen triggered — a promotion recommended at another desk, a designation level
   * changed in Settings, or an employee record edited elsewhere.
   */
  useAutoRefreshOnChange(
    useCallback(
      ({ background }) => Promise.all([loadPromotions({ background }), loadOptions()]),
      [loadOptions, loadPromotions]
    ),
    { topics: ["promotion", "employee", "settings"], refreshOnMount: false }
  );

  useEffect(() => {
    setPage(1);
  }, [archiveView, statusFilter, query]);

  /*
   * What is waiting on each signing desk is counted by the sidebar badge alone; the register
   * itself shows no queue pill, so every desk reads the same toolbar.
   */
  const filteredPromotions = useMemo(() => {
    const search = query.trim().toLowerCase();
    const scopedDivision = preparerDivision.toLowerCase();

    return promotions.filter((promotion) => {
      /*
       * A scoped desk's register is its own division: the one the employee was promoted out of or
       * the one they sit in now, the same pair the API matches. A desk with no division sees nothing.
       */
      if (isPreparerDivisionScoped) {
        const belongsToDivision = scopedDivision !== ""
          && [promotion.fromDivision, promotion.employeeDivision]
            .some((division) => String(division || "").trim().toLowerCase() === scopedDivision);

        if (!belongsToDivision) {
          return false;
        }
      }

      if (statusFilter !== "all" && promotion.statusKey !== statusFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [
        promotion.employeeName,
        promotion.employeeId,
        promotion.fromDesignation,
        promotion.toDesignation,
        promotion.fromDivision,
        promotion.toDivision,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [isPreparerDivisionScoped, preparerDivision, promotions, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPromotions.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pagedPromotions = filteredPromotions.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

  /* ── Form derivations ──────────────────────────────────────────────────────── */

  /*
   * The employees this desk may pick: the API already omits the preparer's own record. Comparing
   * employee codes here as well keeps a Chief's own name out if older option data is still cached.
   */
  const promotableEmployees = useMemo(() => {
    const ownEmployeeId = String(user?.employee_id || "").trim().toLowerCase();
    const target = preparerDivision.toLowerCase();
    const scopedEmployees = !isPreparerDivisionScoped
      ? options.employees
      : target
        ? options.employees.filter((employee) => String(employee.division || "").trim().toLowerCase() === target)
        : [];

    return scopedEmployees.filter((employee) => (
      ownEmployeeId === ""
      || String(employee.employeeId || "").trim().toLowerCase() !== ownEmployeeId
    ));
  }, [isPreparerDivisionScoped, options.employees, preparerDivision, user?.employee_id]);

  const selectedEmployee = useMemo(
    () => promotableEmployees.find((employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)) || null,
    [form.employeeRecordId, promotableEmployees]
  );

  const currentLevel = Number(selectedEmployee?.level) || 0;

  /**
   * Only designations above the employee's current level, grouped by division. The employee's own
   * designation can never appear (it is at the current level), so a "promotion" to the same post is
   * impossible to even pick. A scoped Chief promotes within their division, so only its
   * designations are offered -- the API lists no others for them and refuses one from elsewhere.
   */
  const targetGroups = useMemo(() => {
    if (!selectedEmployee) {
      return [];
    }

    const scopedDivision = preparerDivision.toLowerCase();
    const groups = new Map();
    options.designations
      .filter((designation) => Number(designation.level) > currentLevel)
      .filter((designation) => !isPreparerDivisionScoped
        || String(designation.division || "").trim().toLowerCase() === scopedDivision)
      .forEach((designation) => {
        const groupKey = designation.division || "Unassigned";
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push(designation);
      });

    // The employee's own division first — the most common promotion stays inside it.
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === selectedEmployee.division) return -1;
        if (b === selectedEmployee.division) return 1;
        return a.localeCompare(b);
      })
      .map(([division, designations]) => ({
        division,
        designations: designations.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      }));
  }, [currentLevel, isPreparerDivisionScoped, options.designations, preparerDivision, selectedEmployee]);

  const targetDesignation = useMemo(
    () => options.designations.find((designation) => String(designation.id) === String(form.toDesignationId)) || null,
    [form.toDesignationId, options.designations]
  );

  const stepOptions = useMemo(() => getStepOptions(form.salaryGrade), [form.salaryGrade]);

  const openForm = () => {
    setForm({ ...EMPTY_FORM });
    setFormErrors({});
    setFormOpen(true);
    void loadOptions();
  };

  const closeForm = () => {
    if (saving) {
      return;
    }
    setFormOpen(false);
  };

  const updateForm = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setFormErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => {
        delete next[key];
      });
      return next;
    });
  };

  const handleSelectEmployee = (employee) => {
    updateForm({
      employeeRecordId: employee ? String(employee.employeeRecordId) : "",
      toDesignationId: "",
      salaryGrade: "",
      stepIncrement: "",
      toSalary: "",
    });
  };

  /*
   * The monthly salary is never typed: it is whatever the salary schedule says for the chosen grade
   * and step, so the figure on the promotion always matches the schedule the payroll uses. Until
   * both are chosen there is no salary, and the field shows that rather than a leftover number.
   */
  const scheduledSalary = (salaryGrade, stepIncrement) => {
    const salary = lookupSalary(salaryGrade, stepIncrement);
    return salary != null ? String(salary) : "";
  };

  const handleSelectDesignation = (event) => {
    const toDesignationId = event.target.value;
    const designation = options.designations.find((item) => String(item.id) === toDesignationId);
    // A designation with a grade on file pre-fills it; the salary follows once a step is chosen.
    const salaryGrade = designation?.salaryGrade ? String(designation.salaryGrade) : "";
    updateForm({ toDesignationId, salaryGrade, stepIncrement: "", toSalary: "" });
  };

  const handleSalaryGradeChange = (event) => {
    const salaryGrade = event.target.value;
    const stepStillValid = getStepOptions(salaryGrade).some((option) => option.value === form.stepIncrement);
    const stepIncrement = stepStillValid ? form.stepIncrement : "";
    updateForm({ salaryGrade, stepIncrement, toSalary: scheduledSalary(salaryGrade, stepIncrement) });
  };

  const handleStepChange = (event) => {
    const stepIncrement = event.target.value;
    updateForm({ stepIncrement, toSalary: scheduledSalary(form.salaryGrade, stepIncrement) });
  };

  const validateForm = () => {
    const errors = {};
    const currentSalary = Number(selectedEmployee?.basicSalary) || 0;
    const toSalary = Number(form.toSalary);

    if (!form.employeeRecordId) {
      errors.employeeRecordId = "Select the employee to promote.";
    } else if (selectedEmployee?.openPromotion) {
      errors.employeeRecordId = `This employee already has a ${String(selectedEmployee.openPromotion.status).toLowerCase()} promotion.`;
    }

    if (!form.toDesignationId) {
      errors.toDesignationId = "Select the position the employee is promoted to.";
    } else if (targetDesignation && Number(targetDesignation.level) <= currentLevel) {
      errors.toDesignationId = "A promotion must move the employee to a higher position.";
    }

    if (!form.toSalary || !Number.isFinite(toSalary) || toSalary <= 0) {
      errors.toSalary = "Select the salary grade and step to set the monthly salary.";
    } else if (toSalary < currentSalary) {
      errors.toSalary = `The new salary cannot be lower than the current ${formatCurrency(currentSalary)}.`;
    }

    return errors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const errors = validateForm();

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const result = await preparePromotion({
        employeeRecordId: Number(form.employeeRecordId),
        toDesignationId: Number(form.toDesignationId),
        toSalary: Number(form.toSalary),
        salaryGrade: form.salaryGrade,
        stepIncrement: form.stepIncrement,
        effectiveDate: todayDateInputValue(),
        justification: form.justification.trim(),
      });

      if (result?.promotion) {
        setPromotions((current) => [result.promotion, ...current.filter((item) => item.id !== result.promotion.id)]);
      }
      toast.success(result?.message || "Promotion prepared.");
      setFormOpen(false);
      void loadOptions();
    } catch (requestError) {
      const message = requestError?.response?.data?.message || "Unable to prepare the promotion.";
      toast.error(message);
      setFormErrors({ submit: message });
    } finally {
      setSaving(false);
    }
  };

  /* ── Workflow actions ───────────────────────────────────────────────────────── */

  const replacePromotion = (promotion) => {
    if (!promotion) {
      return;
    }
    setPromotions((current) => current.map((item) => (item.id === promotion.id ? promotion : item)));
    setSelectedPromotion((current) => (current && current.id === promotion.id ? promotion : current));
  };

  const runAction = async (promotion, action, note = "", captcha = {}, stagePayload = {}) => {
    setBusyId(promotion.id);
    try {
      const result = await updatePromotionStatus(promotion.id, action, note, captcha, {
        ...stagePayload, expectedRevision: promotion.revision,
      });
      replacePromotion(result?.promotion);
      toast.success(result?.message || "Promotion updated.");
      void loadOptions();
    } catch (requestError) {
      if (requestError?.response?.status === 409) {
        const fresh = await fetchPromotions({ archived: archiveView }).catch(() => null);
        const updated = fresh?.promotions?.find((item) => item.id === promotion.id);
        if (updated) replacePromotion(updated);
        void loadPromotions({ background: true });
      }
      await Swal.fire({
        title: isCaptchaFailure(requestError) ? "Security Check Failed" : "Update failed",
        text: requestError?.response?.data?.message || "Unable to update the promotion.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleStageUpdate = async (promotion, action, payload) => {
    if (action === "not_qualified") {
      const confirmation = await Swal.fire({
        title: "Close as not qualified?", text: `Close the promotion application of ${promotion.employeeName}? The reason and evaluation will be saved in the history.`,
        icon: "warning", showCancelButton: true, confirmButtonText: "Mark not qualified", confirmButtonColor: "#dc2626",
      });
      if (!confirmation.isConfirmed) return;
    }
    await runAction(promotion, action, payload.note, {}, payload);
  };

  const handleRecommend = async (promotion) => {
    const confirmation = await Swal.fire({
      title: `${recommendLabel} promotion?`,
      text: `Recommend ${promotion.employeeName} for ${promotion.toDesignation} and forward the completed evaluation to the Regional Director?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: recommendLabel,
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const captcha = await requestApprovalCaptcha({
      note: "Answer the sum below to confirm your recommendation.",
      confirmButtonText: "Verify and recommend",
    });

    if (!captcha) {
      return;
    }

    await runAction(promotion, "recommend", "", captcha);
  };

  const handleApprove = async (promotion) => {
    const confirmation = await Swal.fire({
      title: "Approve promotion?",
      text: `Approve ${promotion.employeeName} for ${promotion.toDesignation}? Select the effective date. Approval updates the position, salary, and service record.`,
      input: "date",
      inputValue: todayDateInputValue(),
      inputAttributes: { max: todayDateInputValue(), ...(promotion.dateHired ? { min: String(promotion.dateHired).slice(0, 10) } : {}) },
      inputValidator: (value) => (!value || value > todayDateInputValue() || (promotion.dateHired && value < String(promotion.dateHired).slice(0, 10))
        ? "Choose an effective date between the hire date and today." : undefined),
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Approve",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#64748b",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const captcha = await requestApprovalCaptcha({
      note: "Answer the sum below to confirm this promotion approval.",
      confirmButtonText: "Verify and approve",
    });

    if (!captcha) {
      return;
    }

    await runAction(promotion, "approve", "", captcha, { effectiveDate: confirmation.value });
  };

  const handleReject = async (promotion) => {
    const { value: note, isConfirmed } = await Swal.fire({
      title: "Disapprove promotion?",
      text: `State the reason for disapproving the promotion application of ${promotion.employeeName}.`,
      input: "textarea",
      inputPlaceholder: "Reason for disapproval",
      inputAttributes: { maxlength: "4000" },
      inputValidator: (value) => (!String(value || "").trim() ? "A reason is required to disapprove an application." : undefined),
      showCancelButton: true,
      confirmButtonText: "Disapprove",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
    });

    if (!isConfirmed) {
      return;
    }

    await runAction(promotion, "reject", note);
  };

  const handleCancel = async (promotion) => {
    const confirmation = await Swal.fire({
      title: "Cancel promotion?",
      text: `Withdraw the promotion application of ${promotion.employeeName} for ${promotion.toDesignation}? A new application can be prepared later.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Cancel promotion",
      cancelButtonText: "Keep",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    await runAction(promotion, "cancel");
  };

  const handleArchive = (promotion) =>
    confirmArchiveRecord({
      module: "promotions",
      id: promotion.id,
      noun: "promotion",
      owner: promotion.employeeName,
      onArchived: (id) => setPromotions((current) => current.filter((item) => item.id !== id)),
    });

  const handleRestore = (promotion) =>
    confirmRestoreRecord({
      module: "promotions",
      id: promotion.id,
      noun: "promotion",
      owner: promotion.employeeName,
      onRestored: (id) => setPromotions((current) => current.filter((item) => item.id !== id)),
    });

  // Each desk receives only its current-stage decisions. Evaluation is edited inside the details.
  const rowActions = (promotion, { includeView = true, includeRecommendReject = true } = {}) => {
    const busy = busyId === promotion.id;
    const actions = includeView
      ? [
          <ActionIconButton
            key="view"
            label="View promotion details"
            tone="view"
            icon={faEye}
            onClick={() => setSelectedPromotion(promotion)}
          />,
        ]
      : [];

    if (archiveView) {
      if (canArchive) {
        actions.push(
          <ActionIconButton
            key="restore"
            label="Restore promotion"
            tone="restore"
            icon={faRotateLeft}
            disabled={busy}
            onClick={() => handleRestore(promotion)}
          />
        );
      }
      return actions;
    }

    const isOwnPromotion = String(user?.employee_id || "").trim().toLowerCase() !== ""
      && String(user.employee_id).trim().toLowerCase() === String(promotion.employeeId || "").trim().toLowerCase();
    if (isOwnPromotion || isEmployeeView) return actions;

    if (includeRecommendReject && ["submission", "pending"].includes(promotion.statusKey) && canRecommend) {
      actions.push(
        <ActionIconButton
          key="recommend"
          label={`${recommendLabel} promotion`}
          tone="approve"
          text={recommendLabel}
          icon={faThumbsUp}
          disabled={busy}
          onClick={() => handleRecommend(promotion)}
        />
      );
    }

    if (promotion.statusKey === "recommended" && canApprove) {
      actions.push(
        <ActionIconButton
          key="approve"
          label="Approve promotion"
          tone="approve"
          icon={faCheck}
          disabled={busy}
          onClick={() => handleApprove(promotion)}
        />
      );
    }

    if (includeRecommendReject
      && ((["submission", "pending"].includes(promotion.statusKey) && canRecommend) || (promotion.statusKey === "recommended" && canApprove))) {
      actions.push(
        <ActionIconButton
          key="reject"
          label="Disapprove promotion"
          tone="reject"
          icon={faXmark}
          disabled={busy}
          onClick={() => handleReject(promotion)}
        />
      );
    }

    if (OPEN_PROMOTION_STATUSES.includes(promotion.statusKey) && canPrepare) {
      actions.push(
        <ActionIconButton
          key="cancel"
          label="Cancel promotion"
          tone="cancel"
          icon={faBan}
          disabled={busy}
          onClick={() => handleCancel(promotion)}
        />
      );
    }

    if (["approved", "disapproved", "not_qualified", "rejected", "cancelled"].includes(promotion.statusKey) && canArchive) {
      actions.push(
        <ActionIconButton
          key="archive"
          label="Archive promotion"
          tone="archive"
          icon={faBoxArchive}
          disabled={busy}
          onClick={() => handleArchive(promotion)}
        />
      );
    }

    return actions;
  };

  const columns = [
    /* The employee column names whose promotion it is; on My Promotion they are all the viewer's. */
    ...(isEmployeeView
      ? []
      : [{
        key: "employee",
        header: "Employee",
        cardRole: "title",
        render: (row) => (
          <span className="block min-w-0">
            <span className="block font-semibold text-slate-900">{row.employeeName}</span>
            <span className="block text-xs text-slate-500">{row.employeeId || "No ID"}</span>
          </span>
        ),
      }]),
    {
      key: "move",
      header: "Promotion",
      cardLabel: "Promotion",
      cardFull: true,
      ...(isEmployeeView ? { cardRole: "title" } : {}),
      render: (row) => <MoveCell promotion={row} />,
    },
    {
      key: "division",
      header: "Division",
      render: (row) =>
        row.fromDivision && row.fromDivision !== row.toDivision
          ? `${row.fromDivision} → ${row.toDivision}`
          : row.toDivision || "—",
    },
    {
      key: "salary",
      header: "Monthly Salary",
      render: (row) => (
        <div className="text-sm">
          <p className="m-0 text-slate-500">{row.fromSalary != null ? formatCurrency(row.fromSalary) : "—"}</p>
          <p className="m-0 font-semibold text-slate-900">{formatCurrency(row.toSalary)}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (row) => <StatusBadge promotion={row} />,
    },
    ...(!isEmployeeView ? [{ key: "updatedAt", header: "Last updated", render: (row) => formatDateDisplay(row.updatedAt || row.createdAt) }] : []),
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (row) => rowActions(row),
    },
  ];

  const emptyMessage = isEmployeeView
    ? "You have no promotions on record yet. A promotion appears here once the Regional Director approves it."
    : archiveView
      ? "No archived promotions."
      : statusFilter === "all"
        ? "No promotion applications have been created yet."
        : `No applications with status ${promotionStatusLabel(statusFilter)}.`;

  /*
   * The page intro is hidden for this module (hidePageIntro), so the workspace carries its own
   * heading, worded for the view and for the desk's step in the chain.
   */
  const headerTitle = isEmployeeView ? "My Promotion" : archiveView ? "Archived Promotions" : "Promotions";
  const headerDescription = isEmployeeView
    ? "The promotions that took effect on your appointment, with the position and salary each one moved you to."
    : archiveView
      ? "Closed promotions set aside from the register. Restore a promotion to return it to the active list."
      : roleKey === "admin"
        ? "Track promotion applications through assessment, examination, interview, submission, and final approval."
        : canApprove
          ? "Review promotions recommended by HR and give final approval to move employees up the position hierarchy."
          : canRecommend
            ? "Evaluate qualifications, record examination and interview results, and recommend completed applications to the Regional Director."
            : "Create promotion applications and follow the assessment, examination, interview, and approval stages.";

  return (
    <section className="space-y-4">
      {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <h3 className="m-0 text-base font-semibold text-slate-950">{headerTitle}</h3>
          <p className="m-0 mt-1 text-sm text-slate-500">{headerDescription}</p>
        </div>

        {/* My Promotion lists only the employee's own approved promotions, so there is nothing to search or filter. */}
        {isEmployeeView ? null : (
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search employee or position"
                  aria-label="Search promotions"
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter by status"
                className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ArchiveViewToggle archiveView={archiveView} onToggle={setArchiveView} label="promotions" />
              {canDraft && !archiveView ? (
                <Button icon={Plus} onClick={openForm}>
                  New Promotion Application
                </Button>
              ) : null}
            </div>
          </div>
        )}

        <div className="p-4">
          <Table
            columns={columns}
            data={pagedPromotions}
            rowKey="id"
            loading={loading}
            emptyMessage={emptyMessage}
            tableClassName="min-w-[1080px]"
            cardsClassName="lg:hidden"
            tableWrapperClassName="hidden lg:block"
          />
          {filteredPromotions.length > ROWS_PER_PAGE ? (
            <Pagination className="mt-4" currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          ) : null}
        </div>
      </div>

      {/* ── Prepare promotion / nominate ──────────────────────────────────────── */}
      <Modal open={formOpen} title="New Promotion Application" onClose={closeForm} maxWidth="max-w-[720px]">
        <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
          {optionsError ? <SettingsNotice tone="error">{optionsError}</SettingsNotice> : null}

          <div data-validation-field>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Employee</label>
            {/*
             * promotion.php lists active Regular employees only; Contract of Service staff hold no plantilla
             * position to be promoted from. A Chief gets their division; HR desks work across every division.
             */}
            <EmployeeSearchSelect
              employeeOptions={promotableEmployees}
              selectedEmployee={selectedEmployee}
              onSelect={handleSelectEmployee}
              onClear={() => handleSelectEmployee(null)}
              placeholder={
                isPreparerDivisionScoped
                  ? "Search active Regular employee in your division..."
                  : canNominate
                    ? "Search active Regular employee in any division..."
                    : "Search active Regular employee..."
              }
              showSelectedDetails
              ariaLabel="Employee to promote"
            />
            {formErrors.employeeRecordId ? (
              <p className="mt-1.5 text-sm text-rose-700">{formErrors.employeeRecordId}</p>
            ) : (
              <p className="m-0 mt-1.5 text-xs text-slate-500">
                {isPreparerDivisionScoped
                  ? (preparerDivision
                    ? `Regular employees of ${preparerDivision} only. Contract of Service employees are not listed.`
                    : "Your employee profile has no assigned division, so there is nobody to prepare a promotion for.")
                  : canNominate
                    ? "Regular employees of every division. Contract of Service employees are not listed."
                    : "Regular employees only. Contract of Service employees are not listed."}
              </p>
            )}
          </div>

          {selectedEmployee ? (
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Current appointment</p>
                <p className="m-0 mt-1 font-semibold text-slate-900">{selectedEmployee.position || "No position"}</p>
                <p className="m-0 text-sm text-slate-600">{selectedEmployee.division || "No division"}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Current salary</p>
                <p className="m-0 mt-1 font-semibold text-slate-900">
                  {selectedEmployee.basicSalary != null ? formatCurrency(selectedEmployee.basicSalary) : "Not on file"}
                </p>
                <p className="m-0 text-sm text-slate-600">Hired {formatDateDisplay(selectedEmployee.dateHired)}</p>
                {selectedEmployee.openPromotion ? (
                  <p className="m-0 mt-1 text-xs font-semibold text-amber-700">
                    Already has a {String(selectedEmployee.openPromotion.status).toLowerCase()} promotion.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div data-validation-field>
            <label htmlFor="promotionTargetDesignation" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Proposed position
            </label>
            <select
              id="promotionTargetDesignation"
              value={form.toDesignationId}
              onChange={handleSelectDesignation}
              disabled={!selectedEmployee}
              aria-describedby={targetDesignation ? "promotionPositionAvailability" : undefined}
              className={`min-h-[46px] w-full rounded-lg border px-3.5 py-3 outline-none focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 disabled:bg-slate-100 ${
                targetDesignation ? positionAvailabilityClasses(targetDesignation) : "border-slate-200 bg-white text-slate-900"
              } ${formErrors.toDesignationId ? "!border-rose-600" : ""}`}
            >
              <option value="" className="bg-white text-slate-500">{selectedEmployee ? "Select a higher position" : "Select an employee first"}</option>
              {targetGroups.map((group) => (
                <optgroup key={group.division} label={group.division} className="bg-white text-slate-600">
                  {group.designations.map((designation) => (
                    <option key={designation.id} value={designation.id} className={positionAvailabilityClasses(designation)}>
                      {designation.name}
                      {designation.salaryGrade ? ` · SG-${designation.salaryGrade}` : ""}
                      {` · ${positionAvailabilityLabel(designation)}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedEmployee && targetGroups.length === 0 ? (
              <p className="mt-1.5 text-sm text-amber-700">
                {isPreparerDivisionScoped
                  ? `No position in ${preparerDivision} ranks above the employee's current one. Adjust the position hierarchy in Settings first.`
                  : "No position ranks above the employee's current one. Adjust the position hierarchy in Settings first."}
              </p>
            ) : isPreparerDivisionScoped && preparerDivision && !targetDesignation && !formErrors.toDesignationId ? (
              <p className="m-0 mt-1.5 text-xs text-slate-500">Positions of {preparerDivision} only.</p>
            ) : null}
            {targetDesignation ? (
              <p
                id="promotionPositionAvailability"
                role="status"
                className="m-0 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500"
              >
                <span className={`inline-flex rounded-md border px-2 py-0.5 font-semibold ${positionAvailabilityClasses(targetDesignation)}`}>
                  {positionAvailabilityLabel(targetDesignation)}
                </span>
                {Number.isInteger(targetDesignation.activeEmployeeCount) ? (
                  <span>
                    {targetDesignation.activeEmployeeCount === 0
                      ? "No active Regular employee assigned."
                      : `${targetDesignation.activeEmployeeCount} active Regular employee${targetDesignation.activeEmployeeCount === 1 ? "" : "s"} assigned.`}
                  </span>
                ) : null}
              </p>
            ) : null}
            {targetDesignation ? (
              <p className="mt-1.5 flex items-center gap-1 text-sm text-emerald-700">
                <ArrowUpRight size={14} aria-hidden="true" />
                {selectedEmployee?.position || "No position"} → {targetDesignation.name}
                {targetDesignation.division !== selectedEmployee?.division ? ` · transfers to ${targetDesignation.division}` : ""}
              </p>
            ) : null}
            {formErrors.toDesignationId ? (
              <p className="mt-1.5 text-sm text-rose-700">{formErrors.toDesignationId}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SettingsSelect
              id="promotionSalaryGrade"
              label="Salary Grade"
              value={form.salaryGrade}
              onChange={handleSalaryGradeChange}
              options={SALARY_GRADE_OPTIONS}
              placeholder="Select"
            />
            <SettingsSelect
              id="promotionStep"
              label="Step"
              value={form.stepIncrement}
              onChange={handleStepChange}
              options={stepOptions}
              placeholder="Select"
              disabled={!form.salaryGrade}
            />
            {/* Read-only: set by the salary schedule from the grade and step, never typed. */}
            <InputField
              id="promotionSalary"
              label="Monthly Salary"
              type="text"
              inputMode="decimal"
              value={form.toSalary ? formatCurrency(form.toSalary) : ""}
              readOnly
              tabIndex={-1}
              placeholder="Set by grade and step"
              inputClassName="cursor-default bg-slate-50 text-slate-700"
              error={formErrors.toSalary}
            />
          </div>

          <div>
            <label htmlFor="promotionJustification" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Justification
            </label>
            <textarea
              id="promotionJustification"
              value={form.justification}
              onChange={(event) => updateForm({ justification: event.target.value })}
              rows={3}
              placeholder="Basis for the promotion — performance rating, qualifications, vacancy filled"
              className="min-h-[90px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
            />
          </div>

          {formErrors.submit ? <SettingsNotice tone="error">{formErrors.submit}</SettingsNotice> : null}

          <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-xs text-slate-500">
              This application starts at Assessment. Position and salary change only after final approval.
            </p>
            <Button type="submit" loading={saving} disabled={!selectedEmployee || targetGroups.length === 0}>
              Create application
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Details ───────────────────────────────────────────────────────────── */}
      <Modal
        open={Boolean(selectedPromotion)}
        title="Promotion Application Details"
        onClose={() => { if (!busyId) setSelectedPromotion(null); }}
        maxWidth="max-w-[800px]"
      >
        {selectedPromotion ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="m-0 text-lg font-semibold text-slate-900">{selectedPromotion.employeeName}</p>
                <p className="m-0 text-sm text-slate-500">{selectedPromotion.employeeId || "No ID"}</p>
              </div>
              <StatusBadge promotion={selectedPromotion} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">From</p>
                <p className="m-0 mt-1 font-semibold text-slate-900">{selectedPromotion.fromDesignation || "No position"}</p>
                <p className="m-0 text-sm text-slate-600">{selectedPromotion.fromDivision || "—"}</p>
                <p className="m-0 mt-2 text-sm text-slate-700">
                  {selectedPromotion.fromSalary != null ? formatCurrency(selectedPromotion.fromSalary) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">To</p>
                <p className="m-0 mt-1 font-semibold text-slate-900">{selectedPromotion.toDesignation}</p>
                <p className="m-0 text-sm text-slate-600">{selectedPromotion.toDivision || "—"}</p>
                {selectedPromotion.salaryGrade || selectedPromotion.stepIncrement ? (
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    {[
                      selectedPromotion.salaryGrade ? `SG-${selectedPromotion.salaryGrade}` : "",
                      selectedPromotion.stepIncrement ? `Step ${selectedPromotion.stepIncrement}` : "",
                    ].filter(Boolean).join(" ")}
                  </p>
                ) : null}
                <p className="m-0 mt-2 text-sm font-semibold text-slate-900">{formatCurrency(selectedPromotion.toSalary)}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 px-4 py-1">
              <DetailRow label="Effective date">{selectedPromotion.statusKey === "approved" ? formatDateDisplay(selectedPromotion.effectiveDate) : "Set at final approval"}</DetailRow>
              <DetailRow label="Prepared by">
                {selectedPromotion.requestedBy || "—"}
                {selectedPromotion.createdAt ? ` · ${formatDateDisplay(selectedPromotion.createdAt)}` : ""}
              </DetailRow>
              <DetailRow label="Recommended by">
                {selectedPromotion.recommendedBy || "—"}
                {selectedPromotion.recommendedAt ? ` · ${formatDateDisplay(selectedPromotion.recommendedAt)}` : ""}
              </DetailRow>
              <DetailRow label={["disapproved", "rejected"].includes(selectedPromotion.statusKey) ? "Acted on by" : "Approved by"}>
                {selectedPromotion.approvedBy || "—"}
                {selectedPromotion.approvedAt ? ` · ${formatDateDisplay(selectedPromotion.approvedAt)}` : ""}
              </DetailRow>
              {selectedPromotion.justification ? (
                <DetailRow label="Justification">{selectedPromotion.justification}</DetailRow>
              ) : null}
              {selectedPromotion.rejectedNote ? (
                <DetailRow label="Decision reason">
                  <span className="text-rose-700">{selectedPromotion.rejectedNote}</span>
                </DetailRow>
              ) : null}
            </div>

            {!archiveView && canRecommend && EVALUATION_STAGES.includes(selectedPromotion.statusKey)
              && !(String(user?.employee_id || "").trim() && String(user.employee_id).trim().toLowerCase() === String(selectedPromotion.employeeId || "").trim().toLowerCase()) ? (
              <PromotionStageForm
                key={`${selectedPromotion.id}:${selectedPromotion.revision || 0}:${selectedPromotion.statusKey}`}
                promotion={selectedPromotion} busy={busyId === selectedPromotion.id} onUpdate={handleStageUpdate}
              />
            ) : null}

            <PromotionWorkflowHistory promotion={selectedPromotion} />

            {!archiveView ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
                {rowActions(selectedPromotion, { includeView: false })}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
