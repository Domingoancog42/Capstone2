import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  faBoxArchive,
  faCircleCheck,
  faEye,
  faPen,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Image as ImageIcon,
  ListChecks,
  NotebookPen,
  Paperclip,
  Plus,
  RefreshCw,
  Undo2,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import InputField from "../../components/UI/InputField";
import {
  EntityCell,
  FieldCaption,
  HubButton,
  HubEmptyState,
  HubSearch,
  HubSelect,
  MetaChip,
  RatingPill,
  StatusBadge,
  StatusFilterSelect,
  WorkflowGuide,
  hubFieldClass,
  initialsOf,
} from "./PerformanceHubUI";
import RatingGuide from "./RatingGuide";
import { KpiRatingCard, KpiRatingNavigator, hasCompleteScores, projectedAverage } from "./KpiRatingDeck";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import KpiAssignmentTargetPicker from "./KpiAssignmentTargetPicker";
import KpiCategoryField from "./KpiCategoryField";
import KpiFormSelector from "./KpiFormSelector";
import { filterPerformanceForms, groupPerformanceForms, orderIpcrFormRows, outputRunLength, performanceFormKey, sameOutputCell } from "./performanceFormGroups";
import PerformanceTabNav, { PerformanceTabPanel } from "./PerformanceTabNav";
import PerformanceWorkspaceHeader from "./PerformanceWorkspaceHeader";
import { SuccessIndicatorList } from "./SuccessIndicatorsField";
import { normalizeSuccessIndicators } from "./successIndicators";
import { PerformanceBandBadge, RatingScore, RemarksCell } from "./RatingSummaryCells";
import {
  archiveIpcrRecord,
  createIpcr,
  fetchIpcrRecords,
  restoreIpcrRecord,
  updateIpcrRecord,
  validateIpcrRecords,
} from "../../services/api";
import { exportIpcrForm } from "../../services/performanceExportService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { useOrganizationFilterOptions } from "../../hooks/useFilterOptions";

/*
 * Cached per desk: the chief's copy holds one division's records and HR's holds everybody's, and a
 * browser shared between the two must not open one desk on the other's list.
 */
const STORAGE_KEYS = {
  manage: "hris.performance.adminIpcrDrafts",
  chief: "hris.performance.chiefIpcrDrafts",
};

const tabs = [
  { key: "form", label: "IPCR Form", icon: ClipboardList },
  { key: "summary", label: "Ratings Summary", icon: BarChart3 },
];

/*
 * The status dropdown over the register. A grouped form's status is worked out from its KPIs in
 * `groupPerformanceForms`, so it is always one of these five.
 */
const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "returned", label: "Returned" },
  { value: "partial", label: "Partially validated" },
  { value: "validated", label: "Validated" },
];

function formStage(form) {
  const status = String(form?.status || "").toLowerCase();
  if (status === "validated") return "validated";
  if (status.includes("partial")) return "partial";
  if (status === "returned") return "returned";
  if (status.includes("submitted")) return "submitted";
  return "draft";
}

const WORKFLOW_STEPS = [
  { title: "Assign KPIs", description: "Measurable targets are assigned to each employee for the rating period." },
  { title: "Self-rate & attach MOVs", description: "Employees report what they achieved, rate themselves, and attach their MOVs." },
  { title: "Validate", description: "The division chief checks the MOVs, then validates the rating or returns the KPI for revision." },
];

/*
 * Where one KPI stands in validation (ipcr.php). A validated KPI is stored as "rated"; one sent
 * back to the employee as "needs_revision".
 */
const KPI_STAGE_LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  needs_revision: "Returned",
  rated: "Validated",
};

function kpiStatus(record) {
  const status = String(record?.status || "").toLowerCase();
  return KPI_STAGE_LABELS[status] ? status : "draft";
}

/* Only a submitted KPI, or one already validated, has a decision to make. */
function isReviewable(record) {
  return ["submitted", "rated"].includes(kpiStatus(record));
}

const currentYear = new Date().getFullYear();

const IPCR_CATEGORY_OPTIONS = [
  "GROUNDWATER RESOURCE ASSESSMENT",
  "LAND GEOLOGICAL ASSESSMENT",
  "SUPPORT TO OPERATIONS",
];

/*
 * One assignment covers a single rating period, so the period is shared. Inside it the form is
 * shaped like the printed IPCR: a program band ("OO3: ADAPTIVE CAPACITIES ... - PROGRAM 1:
 * GEOLOGICAL RISK REDUCTION AND RESILIENCY PROGRAM") holds a category band under it
 * ("GROUNDWATER RESOURCE ASSESSMENT"), and under that a KPI is one output, "Groundwater Resource
 * Assessment Reports with Maps prepared (no.)", with a row per success indicator beside it. Each
 * row carries the form's two target columns: "1 Report with Map submitted within 45 working days
 * after fieldwork" beside "1 Report with Map submitted within 42 working days after fieldwork".
 * On save every row becomes one IPCR record carrying the shared output, so each is accomplished
 * and rated on its own.
 */
let bulkKpiSeq = 0;

function createBulkIndicator() {
  bulkKpiSeq += 1;
  return {
    uid: `bulk-indicator-${bulkKpiSeq}`,
    target: "",
    secondTarget: "",
  };
}

function createBulkKpi() {
  bulkKpiSeq += 1;
  return {
    uid: `bulk-kpi-${bulkKpiSeq}`,
    program: "",
    category: "",
    output: "",
    indicators: [createBulkIndicator()],
  };
}

function createDefaultBulkForm() {
  return {
    periodFrom: `${currentYear}-01-01`,
    periodTo: `${currentYear}-06-30`,
    kpis: [createBulkKpi()],
  };
}

/*
 * One validation card's editable values. The scores start from the final rating once the KPI is
 * validated, else from the employee's self-rating, so validating it as claimed needs no typing.
 * `decision` is "validate", "return", or "" until the rater picks one.
 */
function createRatingForm(record = {}) {
  const validated = kpiStatus(record) === "rated";
  const seed = isReviewable(record) ? record : {};
  return {
    decision: "",
    remarks: record.remarks || "",
    returnNote: "",
    q1Rating: (validated ? seed.q1Rating : seed.selfQ1Rating) || "",
    e2Rating: (validated ? seed.e2Rating : seed.selfE2Rating) || "",
    t3Rating: (validated ? seed.t3Rating : seed.selfT3Rating) || "",
    dirty: false,
  };
}

function ratingKey(record) {
  return String(record?.ipcrId ?? record?.id ?? "");
}


function createIpcrEditForm(record = {}) {
  return {
    periodFrom: record.periodFrom || record.period_from || "",
    periodTo: record.periodTo || record.period_to || "",
    output: record.kpiTitle || record.output || "",
    successIndicator: record.successIndicator || record.success_indicator || "",
    secondIndicator: record.secondIndicator || record.second_indicator || "",
    program: record.program || "",
    category: record.category || record.kpiCategory || "Program",
  };
}

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatLongDate(value) {
  if (!value) return "DATE";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text(value, "DATE");
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatRange(from, to) {
  return `${formatDate(from)} to ${formatDate(to)}`;
}

function commitmentPeriodLabel(record) {
  const from = record?.periodFrom || record?.period_from;
  const to = record?.periodTo || record?.period_to;
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return "RATING PERIOD";
  }

  const sameYear = fromDate.getFullYear() === toDate.getFullYear();
  const fromMonth = fromDate.toLocaleString("en-US", { month: "long" }).toUpperCase();
  const toMonth = toDate.toLocaleString("en-US", { month: "long" }).toUpperCase();
  return `${fromMonth} TO ${toMonth}${sameYear ? ` ${toDate.getFullYear()}` : ` ${fromDate.getFullYear()} TO ${toDate.getFullYear()}`}`;
}

function periodLabel(record) {
  const from = String(record?.periodFrom || record?.period_from || "");
  const to = String(record?.periodTo || record?.period_to || "");
  if (!from || !to) return "Current period";
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return "Custom period";
  }
  const year = toDate.getFullYear();
  const semester = toDate.getMonth() < 6 ? "1st Sem" : "2nd Sem";
  return `FY ${year} - ${semester}`;
}

function ratingNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function averageRating(record) {
  const savedAverage = ratingNumber(record?.a4Rating ?? record?.a4_rating ?? record?.finalRating ?? record?.final_rating);
  if (savedAverage > 0) return savedAverage.toFixed(2);

  const scores = [
    ratingNumber(record?.q1Rating ?? record?.q1_rating),
    ratingNumber(record?.e2Rating ?? record?.e2_rating),
    ratingNumber(record?.t3Rating ?? record?.t3_rating),
  ].filter((score) => score > 0);

  if (scores.length === 0) return "N/A";
  return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2);
}

function summaryAverage(record) {
  const average = averageRating(record);
  return average === "N/A" ? 0 : Number(average);
}

function finalAverageRating(rows) {
  const scores = rows
    .map((record) => Number(averageRating(record)))
    .filter((score) => Number.isFinite(score) && score > 0);

  if (scores.length === 0) return "N/A";
  return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2);
}

function employeeName(employee) {
  return text(employee?.fullName || [employee?.firstName, employee?.middleName, employee?.lastName].filter(Boolean).join(" "));
}

function normalizeRecord(record = {}) {
  const ipcrId = record.ipcrId ?? record.ipcr_id ?? record.id;
  const rawStatus = String(record.status || "draft").toLowerCase();
  return {
    ...record,
    id: ipcrId,
    ipcrId,
    employeeRecordId: record.employeeRecordId ?? record.employee_id ?? record.employeeId,
    employeeCode: record.employeeCode ?? record.employeeIdNumber ?? record.employeeCodeNumber ?? record.employeeId,
    employeeName: record.employeeName ?? record.fullName,
    division: record.division ?? record.department,
    position: record.position,
    kpiTitle: record.kpiTitle ?? record.output,
    output: record.output ?? record.kpiTitle,
    successIndicator: record.successIndicator ?? record.success_indicator,
    secondIndicator: record.secondIndicator ?? record.second_indicator,
    program: record.program ?? "",
    category: record.category ?? record.kpiCategory ?? record.kpi_category ?? "Program",
    actualAccomplishment: record.actualAccomplishment ?? record.actual_accomplishment,
    periodFrom: record.periodFrom ?? record.period_from,
    periodTo: record.periodTo ?? record.period_to,
    finalRating: record.finalRating ?? record.final_rating,
    q1Rating: record.q1Rating ?? record.q1_rating,
    e2Rating: record.e2Rating ?? record.e2_rating,
    t3Rating: record.t3Rating ?? record.t3_rating,
    a4Rating: record.a4Rating ?? record.a4_rating,
    selfQ1Rating: record.selfQ1Rating ?? record.self_q1_rating,
    selfE2Rating: record.selfE2Rating ?? record.self_e2_rating,
    selfT3Rating: record.selfT3Rating ?? record.self_t3_rating,
    selfAverage: record.selfAverage ?? record.self_average,
    status: ["pending_approval", "returned"].includes(rawStatus) ? "draft" : record.status || "draft",
    assignedByName: record.assignedByName ?? record.assigned_by_name,
    reviewedByName: record.reviewedByName ?? record.reviewed_by_name,
    approvalRemarks: record.approvalRemarks ?? record.approval_remarks,
    verificationFiles: Array.isArray(record.verificationFiles) ? record.verificationFiles : [],
  };
}

function sameIpcrForm(left, right) {
  return performanceFormKey(left, "ipcr") === performanceFormKey(right, "ipcr");
}

/* The employee's own scores for a KPI, which the rater checks against its MOVs. */
function SelfRatingSummary({ record }) {
  const scores = [
    ["Quantity", ratingNumber(record?.selfQ1Rating)],
    ["Efficiency", ratingNumber(record?.selfE2Rating)],
    ["Timeliness", ratingNumber(record?.selfT3Rating)],
  ];
  const complete = scores.every(([, score]) => score > 0);
  const average = ratingNumber(record?.selfAverage)
    || (complete ? Number((scores.reduce((sum, [, score]) => sum + score, 0) / scores.length).toFixed(2)) : 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Employee self-rating</p>
        {complete ? <RatingPill value={average} size="sm" /> : null}
      </div>
      {complete ? (
        <dl className="m-0 mt-2 grid grid-cols-3 gap-2">
          {scores.map(([label, score]) => (
            <div key={label} className="rounded-md bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
              <dt className="text-[11px] text-slate-500">{label}</dt>
              <dd className="m-0 text-sm font-bold tabular-nums text-slate-900">{score.toFixed(2)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 mt-1 text-xs text-slate-500">No self-rating submitted yet.</p>
      )}
    </div>
  );
}


function IpcrFormDocument({ record, rows = [] }) {
  const formRows = rows.length > 0 ? rows : [record].filter(Boolean);
  const employee = text(record?.employeeName, "EMPLOYEE NAME").toUpperCase();
  const division = text(record?.division, "DIVISION").toUpperCase();
  const position = text(record?.position, "Position");
  const commitmentDate = formatLongDate(record?.periodFrom);
  const reviewDate = commitmentDate;
  const reviewedBy = "JOY CHRISTINE V. ASIS";
  const reviewerPosition = record?.division
    ? `OIC, ${text(record.division)}`
    : "OIC, Geosciences Division";
  const rating = finalAverageRating(formRows);
  // `break-words` keeps a URL, file name or long reference inside its box instead of running through the border.
  const cell = "border-2 border-black px-2 py-2 align-top break-words";
  const centerCell = `${cell} text-center`;
  const headerCell = `${cell} bg-[#b8d4f1] text-center font-bold`;

  return (
    <div className="document-paper min-w-[1120px] bg-white p-4 font-sans text-black">
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td colSpan={4} className={`${centerCell} text-sm font-bold`}>
              INDIVIDUAL PERFORMANCE COMMITMENT AND REVIEW (IPCR)
            </td>
          </tr>
          <tr>
            <td colSpan={3} className={`${cell} text-xs leading-6`}>
              I, <span className="font-bold underline">{employee}</span>, of the{" "}
              <span className="font-bold underline">{division}</span> of the{" "}
              <span className="font-bold underline">MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE NO. X</span>, commit
              to deliver and agree to be rated on the attainment of the following targets in accordance with the
              indicated measures for the period <span className="font-bold underline">{commitmentPeriodLabel(record)}</span>.
            </td>
            <td className={`${centerCell} text-xs`}>
              <div className="font-bold underline">{employee}</div>
              <div className="mt-1">Ratee</div>
              <div className="mt-4">Date: {commitmentDate}</div>
            </td>
          </tr>
          <tr>
            <td className={`${centerCell} bg-[#d7a6cf] text-xs font-bold`}>Reviewed by:</td>
            <td className={`${centerCell} bg-[#d7a6cf] text-xs font-bold`}>Date</td>
            <td className={`${centerCell} bg-[#d7a6cf] text-xs font-bold`}>Approved by:</td>
            <td className={`${centerCell} bg-[#d7a6cf] text-xs font-bold`}>Date</td>
          </tr>
          <tr>
            <td className={`${centerCell} text-xs`}>
              <strong>{reviewedBy}</strong>
              <br />
              <span className="font-bold">{reviewerPosition}</span>
            </td>
            <td className={`${centerCell} text-xs`}>{reviewDate}</td>
            <td className={`${centerCell} text-xs`}>
              <strong>{reviewedBy}</strong>
              <br />
              <span className="font-bold">{reviewerPosition}</span>
            </td>
            <td className={`${centerCell} text-xs`}>{reviewDate}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-4 w-full table-fixed border-collapse text-[11px]">
        <thead>
          <tr>
            <th className={`${headerCell} w-[14%]`} rowSpan={2}>OUTPUT</th>
            <th className={`${headerCell} w-[32%]`} colSpan={2}>
              SUCCESS INDICATOR
              <br />
              (Target + Measure)
            </th>
            <th className={`${headerCell} w-[20%]`} rowSpan={2}>Actual Accomplishments</th>
            <th className={headerCell} colSpan={4}>Rating</th>
            <th className={`${headerCell} w-[14%]`} rowSpan={2}>Remarks</th>
          </tr>
          <tr>
            {/* Keep both Success Indicator subcolumns empty so all rating labels align under Rating. */}
            <th className={headerCell} aria-label="Success indicator target" />
            <th className={headerCell} aria-label="Success indicator measure" />
            <th className={`${headerCell} w-[5%]`}>Q1</th>
            <th className={`${headerCell} w-[5%]`}>E2</th>
            <th className={`${headerCell} w-[5%]`}>T3</th>
            <th className={`${headerCell} w-[5%]`}>A4</th>
          </tr>
        </thead>
        <tbody>
          {/*
            * Laid out like the printed form: one band per KPI category, then a row per success
            * indicator. Rows that share a category sit under one band, and rows that share an
            * output within it share one output cell, the way "Ground Subsidence Assessment" spans
            * its three indicators on the form.
            */}
          {formRows.map((item, index) => {
            const category = text(item.category || item.kpiCategory, "Program").toUpperCase();
            const previous = formRows[index - 1];
            /*
             * The organizational outcome and program band, printed once above the categories filed
             * under it. Optional: a KPI without one prints its category band alone, as every record
             * assigned before the field existed does.
             */
            const program = text(item.program, "");
            const startsProgram = program !== "" && (index === 0 || program !== text(previous?.program, ""));
            const startsCategory = startsProgram
              || index === 0
              || category !== text(previous?.category || previous?.kpiCategory, "Program").toUpperCase();
            const continuesOutput = index > 0 && sameOutputCell(previous, item);
            return (
              <React.Fragment key={item.ipcrId || item.id || index}>
                {startsProgram ? (
                  <tr>
                    <td colSpan={9} className={`${cell} bg-[#f2f2f2] text-xs font-bold`}>
                      {program}
                    </td>
                  </tr>
                ) : null}
                {startsCategory ? (
                  <tr>
                    <td colSpan={9} className={`${cell} bg-white text-xs font-bold italic`}>
                      {category}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  {continuesOutput ? null : (
                    <td rowSpan={outputRunLength(formRows, index)} className={`${cell} leading-5`}>{text(item.output || item.kpiTitle)}</td>
                  )}
                  <td className={`${cell} leading-5`}><SuccessIndicatorList value={item.successIndicator} /></td>
                  <td className={`${cell} leading-5`}><SuccessIndicatorList value={item.secondIndicator} fallback="" /></td>
                  <td className={`${cell} leading-5`}>{text(item.actualAccomplishment, "No accomplishment submitted yet.")}</td>
                  <td className={centerCell}>{text(item.q1Rating, "")}</td>
                  <td className={centerCell}>{text(item.e2Rating, "")}</td>
                  <td className={centerCell}>{text(item.t3Rating, "")}</td>
                  <td className={centerCell}>{averageRating(item) === "N/A" ? "" : averageRating(item)}</td>
                  <td className={`${cell} leading-5`}>{text(item.remarks, "")}</td>
                </tr>
              </React.Fragment>
            );
          })}
          <tr>
            <td className={`${cell} font-bold`}>Final Average Rating</td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={centerCell} />
            <td className={centerCell} />
            <td className={centerCell} />
            {/* The final average belongs under A4, the column that carries every other average. */}
            <td className={`${centerCell} font-bold`}>{rating === "N/A" ? "" : rating}</td>
            <td className={cell} />
          </tr>
          <tr>
            <td colSpan={9} className={`${cell} bg-[#e6e6e6] font-bold`}>
              Comments and Recommendations for Development Purposes
            </td>
          </tr>
          <tr>
            <td colSpan={9} className={`${cell} h-20`} />
          </tr>
        </tbody>
      </table>

      <table className="mt-4 w-full table-fixed border-collapse text-xs">
        <tbody>
          <tr className="text-center">
            <th className={`${cell} w-[25%]`}>Discussed with:</th>
            <th className={`${cell} w-[10%]`}>
              Date
              <br />
              (DATE)
            </th>
            <th className={`${cell} w-[25%]`}>Assessed by:</th>
            <th className={`${cell} w-[10%]`}>
              Date
              <br />
              (DATE)
            </th>
            <th className={`${cell} w-[20%]`}>Final Rating by:</th>
            <th className={`${cell} w-[10%]`}>
              Date
              <br />
              (DATE)
            </th>
          </tr>
          <tr>
            <td className={`${centerCell} h-32`}>
              <div className="mt-8 font-bold underline">{employee}</div>
              <div className="font-bold">{position}</div>
            </td>
            <td className={cell} />
            <td className={centerCell}>
              <div className="text-[11px] leading-5">
                I certify that I discussed my assessment of the performance with the employee.
              </div>
              <div className="mt-6 font-bold underline">{reviewedBy}</div>
              <div className="font-bold">{reviewerPosition}</div>
            </td>
            <td className={cell} />
            <td className={centerCell}>
              <div className="mt-8 font-bold underline">{reviewedBy}</div>
              <div className="font-bold">{reviewerPosition}</div>
            </td>
            <td className={cell} />
          </tr>
        </tbody>
      </table>
      <div className="mt-2 text-[11px]">
        Legend: 1 - Quantity, 2 - Efficiency, 3 - Timeliness, 4 - Average
      </div>
    </div>
  );
}

function loadLocalRecords(storageKey) {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeRecord) : [];
  } catch {
    return [];
  }
}

function saveLocalRecords(storageKey, records) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(records));
}

/**
 * The IPCR desk, in one of two modes.
 *
 * `mode="manage"` is HR's organization-wide register. `mode="chief"` is a read/rate desk confined
 * to the chief's division. The server enforces both scopes.
 *
 * `canAssign` draws the Bulk Assign KPI button and is granted only to the HR Head by callers. The
 * API independently enforces that creation rule.
 */
export default function IpcrManagementWorkspace({
  employees = [],
  mode = "manage",
  canAssign = false,
  division = "",
}) {
  const isChief = mode === "chief";
  const chiefDivision = isChief ? text(division, "") : "";
  const storageKey = STORAGE_KEYS[mode] || STORAGE_KEYS.manage;
  const [activeTab, setActiveTab] = useState("form");
  const [archiveView, setArchiveView] = useState(false);
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [assignmentDivisionFilter, setAssignmentDivisionFilter] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [records, setRecords] = useState(() => loadLocalRecords(storageKey));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState(createDefaultBulkForm);
  // Every KPI of the form open in the rating dialog, and each one's editable values keyed by `ratingKey`.
  const [verificationKpis, setVerificationKpis] = useState([]);
  const [ratingForms, setRatingForms] = useState({});
  const [formPreviewRecord, setFormPreviewRecord] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState(createIpcrEditForm);
  const [archivingId, setArchivingId] = useState(null);
  const [exportingFormId, setExportingFormId] = useState(null);

  /*
   * A chief's roster is their own division and nobody else's, whatever the caller passed: the
   * Bulk KPI picker only ever offers that division's staff. The caller already scopes `employees`
   * (see chiefdashboard.jsx), so this is only enforced again when the division is known.
   */
  const activeEmployees = useMemo(() => {
    const target = chiefDivision.toLowerCase();

    if (!target) {
      return employees;
    }

    return employees.filter((employee) => text(employee.department || employee.division, "").toLowerCase() === target);
  }, [chiefDivision, employees]);

  /*
   * The division table. A record raised under a division since renamed or archived is still listed
   * under All divisions; the filter offers only divisions that exist today.
   */
  const { divisions: divisionOptions } = useOrganizationFilterOptions();

  const filteredEmployees = useMemo(() => {
    const needle = assignmentQuery.trim().toLowerCase();

    return activeEmployees.filter((employee) => {
      if (assignmentDivisionFilter && text(employee.department, "") !== assignmentDivisionFilter) {
        return false;
      }

      if (!needle) return true;

      return [
        employee.employeeId,
        employeeName(employee),
        employee.department,
        employee.position,
        employee.email,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [activeEmployees, assignmentDivisionFilter, assignmentQuery]);

  const recordsByEmployee = useMemo(() => {
    const map = new Map();
    records.forEach((record) => {
      const employeeId = Number(record.employeeRecordId);
      if (!employeeId) return;
      const existing = map.get(employeeId);
      if (!existing || Number(record.ipcrId || 0) > Number(existing.ipcrId || 0)) {
        map.set(employeeId, record);
      }
    });
    return map;
  }, [records]);

  const tableRows = useMemo(
    () => filteredEmployees.map((employee) => ({
      ...employee,
      latestIpcr: recordsByEmployee.get(Number(employee.id)) || null,
    })),
    [filteredEmployees, recordsByEmployee]
  );

  const formRecords = useMemo(() => groupPerformanceForms(records, "ipcr"), [records]);
  const searchedRecords = useMemo(() => filterPerformanceForms(formRecords, query, divisionFilter), [formRecords, query, divisionFilter]);
  // The status counts follow the search and division filter, so each option says what picking it would show.
  const statusCounts = useMemo(() => {
    const counts = { all: searchedRecords.length, draft: 0, submitted: 0, returned: 0, partial: 0, validated: 0 };
    searchedRecords.forEach((form) => { counts[formStage(form)] += 1; });
    return counts;
  }, [searchedRecords]);
  const filteredRecords = useMemo(
    () => (statusFilter === "all" ? searchedRecords : searchedRecords.filter((form) => formStage(form) === statusFilter)),
    [searchedRecords, statusFilter]
  );
  const liveRecords = filteredRecords;

  useEffect(() => {
    setCurrentPage(1);
  }, [query, divisionFilter, statusFilter, rowsPerPage, activeTab, archiveView]);

  const loadRecords = useCallback(async ({ background = false, archived = archiveView } = {}) => {
    const viewingArchive = Boolean(archived);
    setLoading(!background);
    try {
      const response = await fetchIpcrRecords({ archived: viewingArchive ? 1 : 0 });
      const nextRecords = (response.records || response.ipcrRecords || []).map(normalizeRecord);
      setRecords(nextRecords);
      if (!viewingArchive) saveLocalRecords(storageKey, nextRecords);
    } catch (error) {
      // Falling back to the local cache is for a failed *first* load. A failed background poll
      // already has fresher records on screen than the cache holds, so it leaves them alone.
      if (!background && !viewingArchive) {
        setRecords(loadLocalRecords(storageKey));
      } else if (!background) {
        setRecords([]);
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView, storageKey]);

  useAutoRefreshOnChange(loadRecords, { topic: "ipcr" });

  const selectedCount = selectedEmployeeIds.length;
  const allVisibleSelected = filteredEmployees.length > 0
    && filteredEmployees.every((employee) => selectedEmployeeIds.includes(Number(employee.id)));

  const toggleEmployee = (employeeId) => {
    const id = Number(employeeId);
    setSelectedEmployeeIds((current) => (
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    ));
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredEmployees.map((employee) => Number(employee.id)));
      setSelectedEmployeeIds((current) => current.filter((id) => !visibleIds.has(id)));
      return;
    }

    setSelectedEmployeeIds((current) => {
      const ids = new Set(current);
      filteredEmployees.forEach((employee) => ids.add(Number(employee.id)));
      return Array.from(ids);
    });
  };

  const openBulkAssign = () => {
    setBulkForm(createDefaultBulkForm());
    setBulkOpen(true);
  };

  const updateBulkKpi = (uid, changes) => {
    setBulkForm((form) => ({
      ...form,
      kpis: form.kpis.map((kpi) => (kpi.uid === uid ? { ...kpi, ...changes } : kpi)),
    }));
  };

  const addBulkKpi = () => {
    setBulkForm((form) => ({ ...form, kpis: [...form.kpis, createBulkKpi()] }));
  };

  // The form always keeps at least one KPI, so the last one cannot be removed.
  const removeBulkKpi = (uid) => {
    setBulkForm((form) => (
      form.kpis.length <= 1
        ? form
        : { ...form, kpis: form.kpis.filter((kpi) => kpi.uid !== uid) }
    ));
  };

  const updateBulkIndicator = (kpiUid, indicatorUid, changes) => {
    setBulkForm((form) => ({
      ...form,
      kpis: form.kpis.map((kpi) => (kpi.uid === kpiUid
        ? {
            ...kpi,
            indicators: kpi.indicators.map((row) => (row.uid === indicatorUid ? { ...row, ...changes } : row)),
          }
        : kpi)),
    }));
  };

  const addBulkIndicator = (kpiUid) => {
    setBulkForm((form) => ({
      ...form,
      kpis: form.kpis.map((kpi) => (kpi.uid === kpiUid
        ? { ...kpi, indicators: [...kpi.indicators, createBulkIndicator()] }
        : kpi)),
    }));
  };

  // A KPI always keeps at least one success indicator row, so the last one cannot be removed.
  const removeBulkIndicator = (kpiUid, indicatorUid) => {
    setBulkForm((form) => ({
      ...form,
      kpis: form.kpis.map((kpi) => (kpi.uid === kpiUid && kpi.indicators.length > 1
        ? { ...kpi, indicators: kpi.indicators.filter((row) => row.uid !== indicatorUid) }
        : kpi)),
    }));
  };

  const handleBulkSubmit = async (event) => {
    event.preventDefault();
    // Every success indicator row becomes one record carrying its KPI's output, sub-heading and
    // category, so each prints as its own row beside the shared output cell.
    const kpis = bulkForm.kpis.flatMap((kpi) => kpi.indicators
      .filter((row) => row.target.trim())
      .map((row) => ({
        output: kpi.output.trim(),
        success_indicator: row.target.trim(),
        second_indicator: row.secondTarget.trim(),
        program: kpi.program.trim(),
        kpi_category: kpi.category.trim(),
      })));
    const targetEmployees = selectedEmployeeIds;

    // A KPI with no indicator typed produces no rows, so it is checked on the form, not the rows.
    const incompleteKpi = bulkForm.kpis.some((kpi) => !kpi.output.trim()
      || kpi.indicators.every((row) => !row.target.trim()));
    if (kpis.length === 0 || incompleteKpi || targetEmployees.length === 0) {
      toast.error("Complete every output and success indicator, and select at least one employee.");
      return;
    }

    setSaving(true);
    const payload = {
      employee_ids: targetEmployees,
      kpis,
      period_from: bulkForm.periodFrom,
      period_to: bulkForm.periodTo,
    };

    try {
      const response = await createIpcr(payload);
      const createdRecords = (response.records || []).map(normalizeRecord);
      const nextRecords = createdRecords.length > 0
        ? [...createdRecords, ...records]
        : [
            ...targetEmployees.flatMap((employeeId) => {
              const employee = activeEmployees.find((item) => Number(item.id) === Number(employeeId));
              return kpis.map((kpi, index) => normalizeRecord({
                id: `local-${Date.now()}-${employeeId}-${index}`,
                ipcrId: `local-${Date.now()}-${employeeId}-${index}`,
                employeeRecordId: employeeId,
                employeeCode: employee?.employeeId,
                employeeName: employeeName(employee),
                division: employee?.department,
                position: employee?.position,
                output: kpi.output,
                successIndicator: kpi.success_indicator,
                secondIndicator: kpi.second_indicator,
                program: kpi.program,
                category: kpi.kpi_category,
                periodFrom: bulkForm.periodFrom,
                periodTo: bulkForm.periodTo,
                status: "draft",
              }));
            }),
            ...records,
          ];
      setRecords(nextRecords);
      saveLocalRecords(storageKey, nextRecords);
      setBulkOpen(false);
      setActiveTab("form");
      setSelectedEmployeeIds([]);
      const kpiCount = bulkForm.kpis.length;
      const summary = `${kpiCount} KPI${kpiCount === 1 ? "" : "s"} (${kpis.length} success indicator${kpis.length === 1 ? "" : "s"}) assigned to ${targetEmployees.length} employee${targetEmployees.length === 1 ? "" : "s"}`;
      toast.success(`${summary}.`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to assign KPI.");
    } finally {
      setSaving(false);
    }
  };

  // Opens the validation dialog on every KPI of the row's form, each on its own card.
  const openVerification = (form) => {
    const first = form?.kpis?.[0] || form;
    if (!first) {
      toast.error("Assign a KPI before validating it.");
      return;
    }

    const members = orderIpcrFormRows(records.filter((record) => sameIpcrForm(record, first)));
    const kpis = members.length > 0 ? members : [first];
    setVerificationKpis(kpis);
    setRatingForms(Object.fromEntries(kpis.map((record) => [ratingKey(record), createRatingForm(record)])));
  };

  const closeVerification = () => {
    setVerificationKpis([]);
    setRatingForms({});
  };

  /*
   * Any edit marks the card dirty, which is what Save decisions sends. Adjusting a score means the
   * rater is validating, so it picks Validate when no decision is chosen yet.
   */
  const updateRatingForm = (key, changes) => {
    setRatingForms((forms) => {
      const current = forms[key] || {};
      const scoring = ["q1Rating", "e2Rating", "t3Rating"].some((name) => name in changes);
      const decision = changes.decision ?? (scoring && !current.decision ? "validate" : current.decision);
      return { ...forms, [key]: { ...current, ...changes, decision, dirty: true } };
    });
  };

  /*
   * Picks Validate on every submitted card that is not decided yet, has a MOV, and carries all
   * three scores. Cards it skips stay undecided for the rater to look at.
   */
  const validateAllSubmitted = () => {
    setRatingForms((forms) => {
      const next = { ...forms };
      verificationKpis.forEach((record) => {
        const key = ratingKey(record);
        const form = next[key] || createRatingForm(record);
        const hasMov = (record.verificationFiles?.length || 0) > 0;
        if (kpiStatus(record) === "submitted" && hasMov && !form.decision && hasCompleteScores(form)) {
          next[key] = { ...form, decision: "validate", dirty: true };
        }
      });
      return next;
    });
  };

  const jumpToRatingCard = (key) => {
    document.getElementById(`ipcr-rating-card-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  // The download covers the whole IPCR form the row belongs to, the same grouping the preview shows.
  const handleExportForm = async (record) => {
    if (!record) return;

    setExportingFormId(record.ipcrId || record.id || null);
    try {
      await exportIpcrForm(record);
      toast.success("IPCR form exported to Excel.");
    } catch (error) {
      toast.error(error?.message || "Unable to export the IPCR form.");
    } finally {
      setExportingFormId(null);
    }
  };

  const openEdit = (record) => {
    record = record?.kpis?.[0] || record;
    setEditingRecord(record);
    setEditForm(createIpcrEditForm(record));
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!editingRecord?.ipcrId) return;

    if (!editForm.periodFrom || !editForm.periodTo || !editForm.output.trim()
      || !editForm.successIndicator.trim() || !editForm.category.trim()) {
      toast.error("Complete the period, output, success indicator, and category.");
      return;
    }

    if (editForm.periodFrom > editForm.periodTo) {
      toast.error("Period To must be on or after Period From.");
      return;
    }

    setSaving(true);
    try {
      const response = await updateIpcrRecord({
        ipcr_id: editingRecord.ipcrId,
        period_from: editForm.periodFrom,
        period_to: editForm.periodTo,
        output: editForm.output.trim(),
        success_indicator: normalizeSuccessIndicators(editForm.successIndicator),
        second_indicator: normalizeSuccessIndicators(editForm.secondIndicator),
        program: editForm.program.trim(),
        kpi_category: editForm.category.trim(),
      });
      const updatedRecord = normalizeRecord(response.record || {
        ...editingRecord,
        ...editForm,
        kpiTitle: editForm.output,
      });
      const nextRecords = records.map((record) => (
        String(record.ipcrId) === String(updatedRecord.ipcrId) ? updatedRecord : record
      ));
      setRecords(nextRecords);
      saveLocalRecords(storageKey, nextRecords);
      setEditingRecord(null);
      toast.success("IPCR record updated.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update IPCR record.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (record) => {
    const members = record?.kpis || [record];
    const recordId = record?.id;
    const verb = isChief ? "Withdraw" : "Archive";
    if (!recordId) return;

    const confirmation = await Swal.fire({
      title: isChief ? "Withdraw IPCR assignment?" : "Archive IPCR form?",
      text: isChief
        ? `Withdraw this IPCR assignment and its ${members.length} KPI(s)?`
        : `This will move the IPCR form and its ${members.length} KPI(s) to the Archive page.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: verb,
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) return;

    setArchivingId(recordId);
    let remaining = records;
    try {
      for (const member of members) {
        await archiveIpcrRecord(member.id);
        remaining = remaining.filter((item) => String(item.id) !== String(member.id));
      }
      setFormPreviewRecord(null);
      toast.success(isChief ? "IPCR assignment withdrawn." : "IPCR form archived.");
    } catch (error) {
      toast.error(error?.response?.data?.message || `Unable to ${verb.toLowerCase()} all KPIs. Remaining entries are still shown.`);
    } finally {
      setRecords(remaining);
      saveLocalRecords(storageKey, remaining);
      setArchivingId(null);
    }
  };

  const handleRestore = async (record) => {
    const members = record?.kpis || [record];
    const recordId = record?.id;
    if (!recordId || !window.confirm(`Restore this IPCR form and its ${members.length} KPI(s)?`)) return;
    setArchivingId(recordId);
    let remaining = records;
    try {
      for (const member of members) {
        await restoreIpcrRecord(member.id);
        remaining = remaining.filter((item) => String(item.id) !== String(member.id));
      }
      setFormPreviewRecord(null);
      toast.success("IPCR form restored.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to restore all KPIs. Remaining entries are still shown.");
    } finally {
      setRecords(remaining);
      setArchivingId(null);
    }
  };

  const handleArchiveViewToggle = (nextArchiveView) => {
    setArchiveView(nextArchiveView);
    setRecords(nextArchiveView ? [] : loadLocalRecords(storageKey));
    setActiveTab("form");
    setQuery("");
    setDivisionFilter("");
    setStatusFilter("all");
    void loadRecords({ archived: nextArchiveView });
  };

  const canRevise = () => !isChief;

  /*
   * Sends every decided card in one validation call, which the server applies all together or not
   * at all. Untouched cards are left alone. The first card that is not ready (no decision, a return
   * without a note, a validation without a MOV or all three scores) stops the save before anything
   * is sent and is scrolled into view.
   */
  const handleValidate = async () => {
    const pending = verificationKpis.filter((record) => ratingForms[ratingKey(record)]?.dirty);
    if (pending.length === 0) {
      toast.error("Nothing to save yet. Choose Validate or Return for at least one KPI.");
      return;
    }

    for (const record of pending) {
      const key = ratingKey(record);
      const form = ratingForms[key];
      const position = verificationKpis.indexOf(record) + 1;
      const stop = (message, focusId) => {
        toast.error(message);
        jumpToRatingCard(key);
        if (focusId) document.getElementById(focusId)?.focus();
      };

      if (!form.decision) {
        stop(`Choose Validate or Return for KPI ${position}.`);
        return;
      }
      if (form.decision === "return" && !form.returnNote.trim()) {
        stop(`Tell the employee what to fix in KPI ${position} before returning it.`, `ipcr-rating-${key}-return-note`);
        return;
      }
      if (form.decision === "validate" && (record.verificationFiles?.length || 0) === 0) {
        stop(`KPI ${position} has no MOV to validate. Return it to the employee instead.`);
        return;
      }
      if (form.decision === "validate" && !hasCompleteScores(form)) {
        stop(`Ratings must be from 1 to 5. Complete all three scores for KPI ${position}.`, `ipcr-rating-${key}-q1Rating`);
        return;
      }
    }

    const decisions = pending.map((record) => {
      const form = ratingForms[ratingKey(record)];
      if (form.decision === "return") {
        return { ipcr_id: record.ipcrId, decision: "return", remarks: form.returnNote.trim() };
      }
      return {
        ipcr_id: record.ipcrId,
        decision: "validate",
        q1_rating: ratingNumber(form.q1Rating),
        e2_rating: ratingNumber(form.e2Rating),
        t3_rating: ratingNumber(form.t3Rating),
        remarks: form.remarks.trim(),
      };
    });

    setSaving(true);
    try {
      const response = await validateIpcrRecords(decisions);
      const fromServer = new Map((response?.records || []).map(normalizeRecord).map((record) => [ratingKey(record), record]));
      // Without records in the response (the offline cache), the decision is applied locally.
      const saved = new Map(pending.map((record, index) => {
        const key = ratingKey(record);
        const decision = decisions[index];
        if (fromServer.has(key)) return [key, fromServer.get(key)];
        if (decision.decision === "return") {
          return [key, normalizeRecord({
            ...record,
            status: "needs_revision",
            approvalRemarks: decision.remarks,
            q1Rating: null,
            e2Rating: null,
            t3Rating: null,
            a4Rating: null,
            finalRating: null,
          })];
        }
        const average = Number(((decision.q1_rating + decision.e2_rating + decision.t3_rating) / 3).toFixed(2));
        return [key, normalizeRecord({
          ...record,
          status: "rated",
          remarks: decision.remarks,
          q1Rating: decision.q1_rating,
          e2Rating: decision.e2_rating,
          t3Rating: decision.t3_rating,
          a4Rating: average,
          finalRating: average,
        })];
      }));

      const nextRecords = records.map((record) => saved.get(ratingKey(record)) || record);
      setRecords(nextRecords);
      saveLocalRecords(storageKey, nextRecords);
      const returned = decisions.filter((decision) => decision.decision === "return").length;
      const validated = decisions.length - returned;
      toast.success(response?.message || (returned === 0
        ? `${validated} IPCR KPI${validated === 1 ? "" : "s"} validated.`
        : `${validated} validated, ${returned} returned to the employee.`));
      closeVerification();
    } catch (error) {
      // The server saved none of it, so every card keeps its decision for another try.
      toast.error(error?.response?.data?.message || "Unable to save the validation.");
    } finally {
      setSaving(false);
    }
  };

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const formColumns = [
    {
      key: "employee",
      header: "Employee Name",
      cardRole: "title",
      render: (record) => (
        <EntityCell
          initials={initialsOf(record.employeeName)}
          title={text(record.employeeName)}
          meta={[record.position, record.division].filter(Boolean).join(" · ") || text(record.employeeCode, "Employee")}
        />
      ),
    },
    { key: "period", header: "Period", cardRole: "subtitle", render: (record) => <MetaChip icon={CalendarDays}>{periodLabel(record)}</MetaChip> },
    { key: "dateRange", header: "Date Range", render: (record) => <span className="text-sm text-slate-600">{formatRange(record.periodFrom, record.periodTo)}</span> },
    {
      key: "kpiCount",
      header: "KPIs",
      render: (record) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <ListChecks size={14} className="text-slate-400" aria-hidden="true" />
          <span className="tabular-nums">{record.kpiCount}</span>
        </span>
      ),
    },
    { key: "overall", header: "Overall Rating", render: (record) => <RatingPill value={averageRating(record)} size="sm" /> },
    { key: "status", header: "Status", cardRole: "badge", render: (record) => <StatusBadge status={record.status} fallback="Draft" /> },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (record) => (
        <div className="flex flex-wrap items-center gap-2">
          <ActionIconButton
            label="View IPCR form"
            icon={faEye}
            tone="view"
            onClick={() => setFormPreviewRecord(record)}
          />
          {archiveView ? (
            <ActionIconButton
              label="Restore IPCR form"
              icon={faRotateLeft}
              tone="restore"
              text="Restore"
              disabled={String(archivingId) === String(record.ipcrId || record.id)}
              onClick={() => handleRestore(record)}
            />
          ) : (
            <>
              <ActionIconButton
                label="Validate IPCR form"
                icon={faCircleCheck}
                tone="review"
                text="Validate"
                onClick={() => openVerification(record)}
              />
              {canRevise(record) ? (
                <ActionIconButton
                  label="Edit IPCR record"
                  icon={faPen}
                  tone="edit"
                  onClick={() => openEdit(record)}
                />
              ) : null}
              {canRevise(record) ? (
                <ActionIconButton
                  label="Archive IPCR form"
                  icon={faBoxArchive}
                  tone="archive"
                  disabled={String(archivingId) === String(record.ipcrId || record.id)}
                  onClick={() => handleArchive(record)}
                />
              ) : null}
            </>
          )}
        </div>
      ),
    },
  ];

  const summaryColumns = [
    { key: "employeeId", header: "Employee ID", cardRole: "eyebrow", render: (record) => text(record.employeeCode || record.employeeId) },
    {
      key: "employee",
      header: "Employee",
      cardRole: "title",
      render: (record) => <EntityCell initials={initialsOf(record.employeeName)} title={text(record.employeeName)} meta={periodLabel(record)} />,
    },
    { key: "position", header: "Position", cardRole: "subtitle", render: (record) => text(record.position, "No position") },
    { key: "division", header: "Division", render: (record) => text(record.division, "Unassigned division") },
    { key: "kpi", header: "KPI", cardFull: true, render: (record) => text(record.kpiTitle || record.output, "No KPI assigned") },
    { key: "quantity", header: "Quantity", render: (record) => <RatingScore value={record.q1Rating} /> },
    { key: "efficiency", header: "Efficiency", render: (record) => <RatingScore value={record.e2Rating} /> },
    { key: "timeliness", header: "Timeliness", render: (record) => <RatingScore value={record.t3Rating} /> },
    {
      key: "average",
      header: "Average",
      render: (record) => <RatingScore value={summaryAverage(record)} emphasis />,
    },
    {
      key: "adjectival",
      header: "Adjectival Rating",
      cardRole: "badge",
      render: (record) => <PerformanceBandBadge value={summaryAverage(record)} />,
    },
    { key: "remarks", header: "Remarks", cardFull: true, render: (record) => <RemarksCell value={record.remarks} /> },
  ];

  const filtering = Boolean(query.trim() || divisionFilter || statusFilter !== "all");
  const panels = {
    form: {
      columns: formColumns,
      data: filteredRecords,
      emptyMessage: archiveView
        ? "No archived IPCR forms."
        : isChief
        ? "No IPCR forms are available for your division yet."
        : "No IPCR forms available yet.",
      emptyDescription: filtering
        ? "No IPCR forms match your search or filters."
        : archiveView
        ? "Archived forms will appear here."
        : "Forms appear here once KPIs are assigned to an employee.",
      tableClassName: isChief ? "min-w-[1180px]" : "min-w-[980px]",
    },
    summary: {
      columns: summaryColumns,
      data: liveRecords,
      emptyMessage: "No validated IPCR records yet.",
      emptyDescription: filtering
        ? "No IPCR forms match your search or filters."
        : "Ratings appear here once KPIs are validated.",
      tableClassName: "min-w-[1500px]",
    },
  };
  const visibleTabs = archiveView
    ? [{ key: "form", label: "Archived IPCR" }]
    : tabs;
  const activePanel = panels[activeTab] || panels.form;
  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(activePanel.data.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = activePanel.data.slice((safePage - 1) * pageSize, safePage * pageSize);
  const ratedRecordCount = records.filter((record) => kpiStatus(record) === "rated").length;
  const awaitingReviewCount = records.filter((record) => kpiStatus(record) === "submitted").length;
  const returnedCount = records.filter((record) => kpiStatus(record) === "needs_revision").length;
  const ratedShare = records.length > 0 ? Math.round((ratedRecordCount / records.length) * 100) : 0;
  const performanceMetrics = [
    {
      label: isChief ? "Division employees" : "Active employees",
      value: activeEmployees.length,
      icon: UsersRound,
      accent: "accent",
      sub: isChief ? text(chiefDivision, "Your division") : "On the employee roster",
    },
    {
      label: "KPI records",
      value: records.length,
      icon: ListChecks,
      accent: "sky",
      sub: `${formRecords.length} IPCR form${formRecords.length === 1 ? "" : "s"}`,
    },
    {
      label: "Awaiting validation",
      value: awaitingReviewCount,
      icon: Clock3,
      accent: "amber",
      sub: returnedCount > 0 ? `${returnedCount} returned for revision` : "Submitted, not yet validated",
    },
    {
      label: "Validated records",
      value: ratedRecordCount,
      icon: CheckCircle2,
      accent: "emerald",
      sub: `${ratedShare}% of KPI records`,
    },
  ];
  const statusOptions = STATUS_FILTERS.map((option) => ({ ...option, count: statusCounts[option.value] }));

  /*
   * The validation dialog's header: the form it belongs to, and its totals across every KPI card.
   * A card counts as scored once it is validated or the rater has picked Validate on it; the
   * self-rating an untouched card is seeded with is not a score yet.
   */
  const verificationHead = verificationKpis[0] || null;
  const ratingEntries = verificationKpis.map((record) => {
    const form = ratingForms[ratingKey(record)];
    return {
      key: ratingKey(record),
      title: text(record.kpiTitle || record.output),
      form: form?.dirty && form.decision === "validate" ? form : { dirty: Boolean(form?.dirty) },
      savedScore: kpiStatus(record) === "rated" ? summaryAverage(record) : 0,
    };
  });
  const unsavedCount = ratingEntries.filter((entry) => entry.form?.dirty).length;
  const validatedCount = verificationKpis.filter((record) => kpiStatus(record) === "rated").length;
  const awaitingCount = verificationKpis.filter((record) => kpiStatus(record) === "submitted").length;
  const formProjectedAverage = projectedAverage(ratingEntries);
  const evidenceCount = verificationKpis.reduce((sum, record) => sum + (record.verificationFiles?.length || 0), 0);

  const formPreviewRows = useMemo(() => {
    if (!formPreviewRecord) return [];
    return orderIpcrFormRows(records.filter((record) => sameIpcrForm(record, formPreviewRecord)));
  }, [formPreviewRecord, records]);

  return (
    <section className="performance-hub w-full space-y-5">
      <PerformanceWorkspaceHeader
        title={archiveView ? "Archived Individual Performance Commitment & Review" : "Individual Performance Commitment & Review"}
        description={archiveView
          ? "Review archived IPCR forms and restore any form that should return to the active register."
          : isChief
          ? "Check the MOVs your division's employees attach, then validate their self-ratings or return them for revision."
          : canAssign
            ? "Create measurable IPCR targets, then validate the self-ratings and MOVs employees submit, from one organized workspace."
            : "Review IPCR targets and validate the self-ratings and MOVs employees submit, from one organized workspace."}
        icon={UserRoundCheck}
        metrics={performanceMetrics}
        loading={loading}
        // How the workflow works is read first, above the counts and the register.
        intro={archiveView ? null : <WorkflowGuide title="How the IPCR workflow works" steps={WORKFLOW_STEPS} />}
        action={(
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {!isChief ? (
              <ArchiveViewToggle
                archiveView={archiveView}
                onToggle={handleArchiveViewToggle}
                label="IPCR records"
              />
            ) : null}
            <HubButton variant="outline" icon={RefreshCw} loading={loading} onClick={() => loadRecords()}>
              Refresh
            </HubButton>
            {canAssign && !archiveView ? (
              <HubButton variant="primary" icon={Plus} onClick={openBulkAssign}>
                Bulk Assign KPI
              </HubButton>
            ) : null}
          </div>
        )}
      />

      <section className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-slate-800">
          <PerformanceTabNav
            tabs={visibleTabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            layoutId="ipcr-tab-indicator"
            ariaLabel="IPCR sections"
          />
          <p className="m-0 shrink-0 text-sm text-slate-500">
            <strong className="font-semibold tabular-nums text-slate-800">{activePanel.data.length}</strong>{" "}
            {activePanel.data.length === 1 ? "form" : "forms"}
          </p>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <HubSearch
              label="Search IPCR"
              name="ipcrSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by employee, KPI, division, period or status…"
              className="w-full lg:flex-1"
            />
            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
              {/* A chief's desk is one division, so there is nothing to filter by. */}
              {isChief ? null : (
                <HubSelect
                  label="Division"
                  value={divisionFilter}
                  onChange={(event) => setDivisionFilter(event.target.value)}
                  className="sm:w-[220px]"
                >
                  <option value="">All divisions</option>
                  {divisionOptions.map((division) => (
                    <option key={division} value={division}>{division}</option>
                  ))}
                </HubSelect>
              )}
              <StatusFilterSelect
                options={statusOptions}
                value={statusFilter}
                onChange={setStatusFilter}
                className="sm:w-[210px]"
              />
              <HubSelect
                label="Rows Per Page"
                value={rowsPerPage}
                onChange={(event) => setRowsPerPage(event.target.value)}
                className="sm:w-[130px]"
              >
                <option value="10">10 rows</option>
                <option value="20">20 rows</option>
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
                <option value="200">200 rows</option>
              </HubSelect>
            </div>
          </div>

          <PerformanceTabPanel tabKey={activeTab}>
            {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
            <div className="lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200 dark:lg:border-slate-800">
              <Table
                columns={activePanel.columns}
                data={pageRows}
                emptyMessage={activePanel.emptyMessage}
                emptyState={(
                  <HubEmptyState
                    icon={ClipboardList}
                    title={activePanel.emptyMessage}
                    description={activePanel.emptyDescription}
                  />
                )}
                tableClassName={activePanel.tableClassName}
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
              />
            </div>
          </PerformanceTabPanel>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <p className="m-0 text-sm text-slate-500">
              Showing {activePanel.data.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, activePanel.data.length)} of {activePanel.data.length} records
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </div>
      </section>

      <Modal
        open={bulkOpen}
        title="Bulk Assign KPI"
        description="Choose the employees, then describe each KPI and its success indicators."
        onClose={() => setBulkOpen(false)}
        maxWidth="max-w-[1280px]"
        maxHeight="max-h-[94dvh]"
        contentClassName="p-0 sm:p-0 lg:!overflow-hidden"
        footerClassName="justify-between"
        footer={(
          <>
            <p className="m-0 text-xs text-slate-500">
              {selectedCount === 0
                ? "Select at least one employee to assign."
                : `${selectedCount} employee${selectedCount === 1 ? "" : "s"} selected`}
            </p>
            <HubButton type="submit" form="ipcr-bulk-assign-form" icon={CheckCircle2} loading={saving} disabled={selectedCount === 0}>
              Assign KPI
            </HubButton>
          </>
        )}
      >
        <form
          id="ipcr-bulk-assign-form"
          className="grid min-h-0 lg:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.35fr)]"
          onSubmit={handleBulkSubmit}
        >
          <KpiAssignmentTargetPicker
            description={isChief
              ? "Select the employees in your division who will receive these KPIs."
              : "Select the employees who will receive these KPIs."}
            query={assignmentQuery}
            onQueryChange={setAssignmentQuery}
            searchPlaceholder="Search employees"
            divisionFilter={isChief ? chiefDivision : assignmentDivisionFilter}
            onDivisionFilterChange={setAssignmentDivisionFilter}
            divisions={isChief ? [chiefDivision].filter(Boolean) : divisionOptions}
            divisionLocked={isChief}
            items={tableRows}
            selectedCount={selectedCount}
            allVisibleSelected={allVisibleSelected}
            onToggleAll={toggleAllVisible}
            isSelected={(employee) => selectedEmployeeIds.includes(Number(employee.id))}
            onToggle={(employee) => toggleEmployee(employee.id)}
            itemKey={(employee) => employee.id}
            itemTitle={employeeName}
            itemMeta={(employee) => [employee.employeeId, employee.position, employee.department].filter(Boolean).join(" · ")}
            itemDetail={(employee) => employee.latestIpcr
              ? `Current KPI: ${text(employee.latestIpcr.kpiTitle || employee.latestIpcr.output)}`
              : "No KPI assigned"}
            emptyMessage="No employees match your filters."
          />

          <section className="min-h-0 space-y-5 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-5 lg:max-h-[58dvh]">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600 dark:bg-accent-950/60 dark:text-accent-400">
                <NotebookPen size={18} aria-hidden="true" />
              </span>
              <div>
                <h3 className="m-0 text-base font-semibold text-slate-950">KPI details</h3>
                <p className="mb-0 mt-0.5 text-sm text-slate-500">Set the rating period and measurable commitments.</p>
              </div>
            </div>

            <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2">
              <InputField
                label="Period From"
                name="periodFrom"
                type="date"
                value={bulkForm.periodFrom}
                onChange={(event) => setBulkForm((form) => ({ ...form, periodFrom: event.target.value }))}
                required
              />
              <InputField
                label="Period To"
                name="periodTo"
                type="date"
                value={bulkForm.periodTo}
                onChange={(event) => setBulkForm((form) => ({ ...form, periodTo: event.target.value }))}
                required
              />
            </div>

            <div className="space-y-3">
              {bulkForm.kpis.map((kpi, index) => (
                <div key={kpi.uid} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <span className="grid h-6 w-6 place-items-center rounded-md bg-accent-100 text-accent-700 dark:bg-accent-950 dark:text-accent-300">
                        <ListChecks size={14} aria-hidden="true" />
                      </span>
                      KPI {index + 1}
                    </span>
                    {bulkForm.kpis.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeBulkKpi(kpi.uid)}
                        disabled={saving}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {/*
                    * The organizational outcome and program the form prints above the category
                    * band. Optional: a KPI without one prints its category band alone.
                    */}
                  <InputField
                    label="Program"
                    id={`${kpi.uid}-program`}
                    name={`${kpi.uid}-program`}
                    value={kpi.program}
                    onChange={(event) => updateBulkKpi(kpi.uid, { program: event.target.value })}
                    placeholder="Optional, e.g. OO3: ADAPTIVE CAPACITIES OF HUMAN COMMUNITIES AND NATURAL SYSTEMS IMPROVED - PROGRAM 1: GEOLOGICAL RISK REDUCTION AND RESILIENCY PROGRAM"
                    maxLength={255}
                  />
                  {/* The category is the band the KPI prints under; the output is the cell beside its rows. */}
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
                    <InputField
                      label="Output"
                      id={`${kpi.uid}-output`}
                      name={`${kpi.uid}-output`}
                      value={kpi.output}
                      onChange={(event) => updateBulkKpi(kpi.uid, { output: event.target.value })}
                      placeholder="e.g. Ground Subsidence Assessment"
                      required
                    />
                    {/* ipcr.kpi_category is VARCHAR(40), so a typed category is held to that. */}
                    <KpiCategoryField
                      id={`${kpi.uid}-category`}
                      name={`${kpi.uid}-category`}
                      value={kpi.category}
                      options={IPCR_CATEGORY_OPTIONS}
                      onChange={(category) => updateBulkKpi(kpi.uid, { category })}
                      maxLength={40}
                      optional
                      helper="Printed as the heading above this KPI's rows on the IPCR form."
                    />
                  </div>

                  {/*
                    * One row per indicator on the printed form, all beside the same output, each
                    * with the form's two target columns. The second is optional; a row saved
                    * without one prints only the first.
                    */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="block text-sm font-semibold text-slate-700">Success Indicators</span>
                      <span className="text-xs font-medium text-slate-500">
                        {kpi.indicators.length > 1 ? `${kpi.indicators.length} rows` : null}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {kpi.indicators.map((row, rowIndex) => (
                        <div key={row.uid} className="flex items-start gap-2">
                          <span className="mt-2.5 w-5 shrink-0 text-right text-xs font-bold text-slate-400">{rowIndex + 1}.</span>
                          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                            <textarea
                              id={`${row.uid}-target`}
                              aria-label={`Success Indicator ${rowIndex + 1}`}
                              value={row.target}
                              onChange={(event) => updateBulkIndicator(kpi.uid, row.uid, { target: event.target.value })}
                              placeholder="Target + measure, e.g. 1 Groundwater Resource Assessment Report with Map submitted within 45 working days after fieldwork"
                              rows={3}
                              required
                              disabled={saving}
                              className={hubFieldClass}
                            />
                            <textarea
                              id={`${row.uid}-second-target`}
                              aria-label={`Success Indicator ${rowIndex + 1}, second column`}
                              value={row.secondTarget}
                              onChange={(event) => updateBulkIndicator(kpi.uid, row.uid, { secondTarget: event.target.value })}
                              placeholder="Optional, e.g. 1 Groundwater Resource Assessment submitted within 42 working days after fieldwork"
                              rows={3}
                              disabled={saving}
                              className={hubFieldClass}
                            />
                          </div>
                          {kpi.indicators.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeBulkIndicator(kpi.uid, row.uid)}
                              disabled={saving}
                              aria-label={`Remove success indicator ${rowIndex + 1}`}
                              title="Remove"
                              className="mt-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2">
                      <HubButton
                        variant="soft"
                        size="sm"
                        icon={Plus}
                        onClick={() => addBulkIndicator(kpi.uid)}
                        disabled={saving}
                      >
                        Add Success Indicator
                      </HubButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <HubButton
              variant="outline"
              icon={Plus}
              onClick={addBulkKpi}
              disabled={saving}
              className="w-full border-dashed py-2.5"
            >
              Add KPI
            </HubButton>
          </section>
        </form>
      </Modal>

      <Modal
        open={Boolean(editingRecord)}
        title="Edit IPCR Record"
        onClose={() => setEditingRecord(null)}
        maxWidth="max-w-2xl"
        footer={(
          <>
            <HubButton variant="outline" onClick={() => setEditingRecord(null)} disabled={saving}>
              Cancel
            </HubButton>
            <HubButton type="submit" form="ipcr-edit-form" icon={CheckCircle2} loading={saving}>
              Save Changes
            </HubButton>
          </>
        )}
      >
        <form id="ipcr-edit-form" className="space-y-4" onSubmit={handleEditSubmit}>
          <KpiFormSelector id="ipcr-edit-kpi" records={editingRecord ? records.filter((record) => sameIpcrForm(record, editingRecord)) : []} selected={editingRecord} onSelect={openEdit} disabled={saving} />
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800">
            <EntityCell
              initials={initialsOf(editingRecord?.employeeName)}
              title={editingRecord?.employeeName || "Employee"}
              meta={[editingRecord?.employeeCode || editingRecord?.employeeId, editingRecord?.division].filter(Boolean).join(" · ") || "Employee"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Period From"
              name="ipcrEditPeriodFrom"
              type="date"
              value={editForm.periodFrom}
              onChange={(event) => setEditForm((form) => ({ ...form, periodFrom: event.target.value }))}
              required
            />
            <InputField
              label="Period To"
              name="ipcrEditPeriodTo"
              type="date"
              value={editForm.periodTo}
              onChange={(event) => setEditForm((form) => ({ ...form, periodTo: event.target.value }))}
              required
            />
          </div>

          <InputField
            label="Program"
            name="ipcrEditProgram"
            value={editForm.program}
            onChange={(event) => setEditForm((form) => ({ ...form, program: event.target.value }))}
            placeholder="Optional, e.g. OO3: ADAPTIVE CAPACITIES ... - PROGRAM 1: GEOLOGICAL RISK REDUCTION AND RESILIENCY PROGRAM"
            maxLength={255}
          />

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <InputField
              label="Output"
              name="ipcrEditOutput"
              value={editForm.output}
              onChange={(event) => setEditForm((form) => ({ ...form, output: event.target.value }))}
              required
            />
            <InputField
              label="Category"
              name="ipcrEditCategory"
              value={editForm.category}
              onChange={(event) => setEditForm((form) => ({ ...form, category: event.target.value }))}
              required
            />
          </div>


          {/* One record is one printed row, so it carries the form's two target columns. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ipcrEditSuccessIndicator" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Success Indicator
              </label>
              <textarea
                id="ipcrEditSuccessIndicator"
                value={editForm.successIndicator}
                onChange={(event) => setEditForm((form) => ({ ...form, successIndicator: event.target.value }))}
                rows={3}
                required
                disabled={saving}
                className={hubFieldClass}
              />
            </div>
            <div>
              <label htmlFor="ipcrEditSecondIndicator" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Success Indicator <span className="font-normal text-slate-500">(second column)</span>
              </label>
              <textarea
                id="ipcrEditSecondIndicator"
                value={editForm.secondIndicator}
                onChange={(event) => setEditForm((form) => ({ ...form, secondIndicator: event.target.value }))}
                placeholder="Optional"
                rows={3}
                disabled={saving}
                className={hubFieldClass}
              />
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={verificationKpis.length > 0}
        title="Mode of Verification"
        description="Check each KPI's MOVs against the employee's self-rating, then validate it or return it for revision."
        onClose={closeVerification}
        maxWidth="max-w-[1180px]"
        maxHeight="max-h-[94dvh]"
        panelClassName="rounded-xl"
        contentClassName="bg-slate-50 p-0"
        footerClassName="justify-between bg-white"
        footer={(
          <>
            <p className="m-0 text-xs text-slate-500">
              {unsavedCount > 0
                ? `${unsavedCount} KPI${unsavedCount === 1 ? "" : "s"} with a decision to save.`
                : awaitingCount > 0
                ? `${awaitingCount} KPI${awaitingCount === 1 ? "" : "s"} awaiting validation.`
                : "No unsaved changes."}
            </p>
            <div className="flex flex-wrap gap-2">
              <HubButton variant="outline" onClick={closeVerification} disabled={saving}>
                Close
              </HubButton>
              {awaitingCount > 0 ? (
                <HubButton variant="soft" icon={CheckCircle2} onClick={validateAllSubmitted} disabled={saving}>
                  Validate all submitted
                </HubButton>
              ) : null}
              <HubButton icon={faCircleCheck} onClick={handleValidate} loading={saving}>
                Save decisions
              </HubButton>
            </div>
          </>
        )}
      >
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center dark:border-slate-800">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-sm font-bold text-accent-700 dark:bg-accent-950/60 dark:text-accent-300">
                {initialsOf(verificationHead?.employeeName)}
              </span>
              <div className="min-w-0">
                <FieldCaption>Employee</FieldCaption>
                <p className="m-0 mt-0.5 text-lg font-semibold leading-tight text-slate-950">{text(verificationHead?.employeeName)}</p>
                <p className="m-0 mt-0.5 text-sm text-slate-500">
                  {[verificationHead?.position, formatRange(verificationHead?.periodFrom, verificationHead?.periodTo)].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                <dt><FieldCaption>KPIs</FieldCaption></dt>
                <dd className="m-0 mt-0.5 text-base font-bold tabular-nums text-slate-900">{verificationKpis.length}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                <dt><FieldCaption>Validated</FieldCaption></dt>
                <dd className="m-0 mt-0.5 text-base font-bold tabular-nums text-slate-900">{validatedCount}/{verificationKpis.length}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                <dt><FieldCaption>Form average</FieldCaption></dt>
                <dd className="m-0 mt-1"><RatingPill value={formProjectedAverage} size="sm" showLabel={false} /></dd>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                <dt><FieldCaption>MOVs</FieldCaption></dt>
                <dd className="m-0 mt-0.5 text-base font-bold tabular-nums text-slate-900">
                  {evidenceCount} file{evidenceCount === 1 ? "" : "s"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0 space-y-4">
              {verificationKpis.map((record, index) => {
                const key = ratingKey(record);
                const form = ratingForms[key] || createRatingForm(record);
                const prefix = `ipcr-rating-${key}`;
                const files = record.verificationFiles || [];
                const stage = kpiStatus(record);
                const reviewable = isReviewable(record);
                const returning = form.decision === "return";

                return (
                  <KpiRatingCard
                    key={key}
                    id={`ipcr-rating-card-${key}`}
                    index={index}
                    title={text(record.kpiTitle || record.output)}
                    subtitle={[record.program, record.category].filter(Boolean).join(" · ")}
                    tags={<StatusBadge status={KPI_STAGE_LABELS[stage]} />}
                    savedScore={stage === "rated" ? summaryAverage(record) : 0}
                    form={form}
                    onChange={(changes) => updateRatingForm(key, changes)}
                    disabled={saving}
                    idPrefix={prefix}
                    showScores={reviewable && !returning}
                    details={(
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800">
                            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Success Indicator</p>
                            <div className="m-0 mt-1 text-[13px] leading-relaxed text-slate-700"><SuccessIndicatorList value={record.successIndicator} /></div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800">
                            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Success Indicator · second column</p>
                            <div className="m-0 mt-1 text-[13px] leading-relaxed text-slate-700"><SuccessIndicatorList value={record.secondIndicator} fallback="—" /></div>
                          </div>
                        </div>
                        <div className="rounded-lg border border-accent-200 bg-accent-50/40 p-3 dark:border-accent-900 dark:bg-accent-950/20">
                          <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-400">
                            <CheckCircle2 size={12} aria-hidden="true" />
                            Employee accomplishment
                          </p>
                          <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">
                            {text(record.actualAccomplishment, "No accomplishment submitted yet.")}
                          </p>
                        </div>
                        <SelfRatingSummary record={record} />
                        {text(record.approvalRemarks, "") ? (
                          <div className={`rounded-lg border p-3 ${stage === "needs_revision"
                            ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30"
                            : "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"}`}
                          >
                            <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              <Undo2 size={12} aria-hidden="true" />
                              {stage === "needs_revision" ? "Returned to the employee" : "Returned earlier"}
                            </p>
                            <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{record.approvalRemarks}</p>
                          </div>
                        ) : null}
                        <div>
                          <p className="m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            <Paperclip size={12} aria-hidden="true" />
                            Submitted MOVs · {files.length} file{files.length === 1 ? "" : "s"}
                          </p>
                          {files.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {files.map((file) => {
                                const fileUrl = resolveBackendAssetUrl(file.storedPath || file.path || "");
                                const isImage = /\bimage\/|\.png|\.jpe?g|\.gif|\.webp/.test(String(file.mimeType || file.originalName || "").toLowerCase());
                                return (
                                  <a
                                    key={file.id || fileUrl}
                                    href={fileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 text-sm no-underline transition hover:border-accent-300 hover:bg-accent-50/40 dark:border-slate-800"
                                  >
                                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-100 text-slate-400">
                                      {isImage && fileUrl ? <img src={fileUrl} alt="" className="h-full w-full object-cover" /> : <FileText size={20} aria-hidden="true" />}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block truncate font-semibold text-slate-800">{text(file.originalName || file.name, "Uploaded file")}</span>
                                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent-700">
                                        {isImage ? <ImageIcon size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
                                        Open file
                                      </span>
                                    </span>
                                  </a>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="m-0 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500 dark:border-slate-700">
                              No MOV uploaded yet.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                    fields={reviewable ? (
                      <>
                        <fieldset className="m-0 min-w-0 border-0 p-0">
                          <legend className="mb-1.5 block text-sm font-semibold text-slate-700">Decision</legend>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { value: "validate", label: "Validate", icon: CheckCircle2, active: "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200" },
                              { value: "return", label: "Return", icon: Undo2, active: "border-rose-400 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-200" },
                            ].map((option) => {
                              const Icon = option.icon;
                              const pressed = form.decision === option.value;
                              const blocked = option.value === "validate" && files.length === 0;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  aria-pressed={pressed}
                                  disabled={saving || blocked}
                                  onClick={() => updateRatingForm(key, { decision: option.value })}
                                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                                    pressed ? option.active : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700"
                                  }`}
                                >
                                  <Icon size={15} aria-hidden="true" />
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                          <p className="m-0 mt-1.5 text-xs text-slate-500">
                            {files.length === 0
                              ? "No MOV is attached, so this KPI can only be returned."
                              : stage === "rated" && !form.dirty
                              ? `Validated${record.reviewedByName ? ` by ${record.reviewedByName}` : ""}. Adjust the scores and save, or return it to reopen it.`
                              : "Validate keeps the self-rating as the final rating unless you adjust the scores below."}
                          </p>
                        </fieldset>
                        {returning ? (
                          <div>
                            <label htmlFor={`${prefix}-return-note`} className="mb-1.5 block text-sm font-semibold text-slate-700">
                              What should the employee fix?
                            </label>
                            <textarea
                              id={`${prefix}-return-note`}
                              value={form.returnNote}
                              onChange={(event) => updateRatingForm(key, { returnNote: event.target.value })}
                              rows={3}
                              disabled={saving}
                              placeholder="e.g. The attendance sheet is unreadable. Upload a clearer scan."
                              className={`resize-y ${hubFieldClass}`}
                            />
                          </div>
                        ) : (
                          <div>
                            <label htmlFor={`${prefix}-remarks`} className="mb-1.5 block text-sm font-semibold text-slate-700">
                              Remarks
                            </label>
                            <textarea
                              id={`${prefix}-remarks`}
                              value={form.remarks}
                              onChange={(event) => updateRatingForm(key, { remarks: event.target.value })}
                              rows={3}
                              disabled={saving}
                              placeholder="Validation notes, printed in the Remarks column of the IPCR form."
                              className={`resize-y ${hubFieldClass}`}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="m-0 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500 dark:border-slate-700">
                        {stage === "needs_revision"
                          ? "Returned to the employee for revision. It comes back here once they submit it again."
                          : "Not submitted yet. The accomplishment, self-rating, and MOVs appear here once the employee submits this KPI."}
                      </p>
                    )}
                  />
                );
              })}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              {verificationKpis.length > 1 ? (
                <KpiRatingNavigator items={ratingEntries} onJump={jumpToRatingCard} />
              ) : null}
              <RatingGuide />
            </aside>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(formPreviewRecord)}
        title="IPCR Form Preview"
        description={formPreviewRecord ? `${text(formPreviewRecord.employeeName)} · ${periodLabel(formPreviewRecord)}` : undefined}
        onClose={() => setFormPreviewRecord(null)}
        maxWidth="max-w-[96vw]"
        panelClassName="rounded-xl"
        contentClassName="bg-slate-100 p-4"
        footer={archiveView ? null : (
          <HubButton
            icon={Download}
            loading={exportingFormId === (formPreviewRecord?.ipcrId || formPreviewRecord?.id)}
            onClick={() => handleExportForm(formPreviewRecord)}
          >
            Export to Excel
          </HubButton>
        )}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
          <IpcrFormDocument record={formPreviewRecord} rows={formPreviewRows} />
        </div>
      </Modal>

    </section>
  );
}
