import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  faBoxArchive,
  faCircleCheck,
  faEye,
  faPaperclip,
  faPaperPlane,
  faPen,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import {
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Lock,
  NotebookPen,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Undo2,
  UploadCloud,
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
  hubSelectClass,
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
import { filterPerformanceForms, groupPerformanceForms, outputRunLength, performanceFormKey, sameOutputCell } from "./performanceFormGroups";
import PerformanceTabNav, { PerformanceTabPanel } from "./PerformanceTabNav";
import PerformanceWorkspaceHeader from "./PerformanceWorkspaceHeader";
import { SuccessIndicatorList } from "./SuccessIndicatorsField";
import { normalizeSuccessIndicators } from "./successIndicators";
import { PerformanceBandBadge, RatingScore, RemarksCell } from "./RatingSummaryCells";
import {
  archiveOpcrRecord,
  createOpcr,
  deleteOpcrVerification,
  fetchOpcrRecords,
  restoreOpcrRecord,
  submitOpcrAccomplishment,
  updateOpcrRecord,
  uploadOpcrVerification,
  validateOpcrRecords,
} from "../../services/api";
import { exportOpcrForm } from "../../services/performanceExportService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { useOrganizationFilterOptions } from "../../hooks/useFilterOptions";

// Each desk keeps its own cache, so a chief's never overwrites HR's register of every division.
const STORAGE_KEYS = {
  manage: "hris.performance.adminOpcrDrafts",
  chief: "hris.performance.chiefOpcrDrafts",
  director: "hris.performance.directorOpcrDrafts",
};

const tabs = [
  { key: "form", label: "OPCR Form", icon: ClipboardList },
  { key: "summary", label: "Ratings Summary", icon: BarChart3 },
];

/*
 * The status dropdown over the register. A grouped form's status is worked out from its KPIs in
 * `groupPerformanceForms`, so it is always one of these five.
 */
const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "assigned", label: "Assigned" },
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
  return "assigned";
}

const WORKFLOW_STEPS = [
  { title: "Assign KPIs", description: "The HR Head files office commitments for each accountable division with Bulk Assign KPI." },
  { title: "Submit accomplishments", description: "The division chief writes each KPI's actual accomplishment, attaches the MOVs, and submits them to the Regional Director." },
  { title: "Validate & rate", description: "The Regional Director checks the MOVs, then validates and rates each KPI or returns it to the chief with a note." },
];

/*
 * Where one KPI stands (opcr.php): assigned to the division, submitted by its chief, returned by
 * the Regional Director, or validated -- stored as "Rated", the name the reports already read.
 */
const KPI_STAGE_LABELS = {
  assigned: "Assigned",
  submitted: "Submitted",
  returned: "Returned",
  rated: "Validated",
};

function kpiStatus(record) {
  const status = String(record?.status || "").toLowerCase();
  return KPI_STAGE_LABELS[status] ? status : "assigned";
}

/* Only a submitted KPI, or one already validated, has a decision for the Regional Director. */
function isReviewable(record) {
  return ["submitted", "rated"].includes(kpiStatus(record));
}

function fileSizeLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file) {
  return /\bimage\/|\.png|\.jpe?g|\.gif|\.webp/.test(String(file?.mimeType || file?.originalName || file?.storedPath || "").toLowerCase());
}

const currentYear = new Date().getFullYear();

/*
 * The organizational outcome and program each OPCR KPI is filed under, worded as the printed form
 * carries them. The category is stored as text, so an OPCR assigned under an older wording keeps it.
 */
const OPCR_CATEGORY_OPTIONS = [
  "OO3: ADAPTIVE CAPACITIES OF HUMAN COMMUNITIES AND NATURAL SYSTEMS IMPROVED - PROGRAM 1: GEOLOGICAL RISK REDUCTION AND RESILIENCY PROGRAM",
  "OO1: NATURAL RESOURCES SUSTAINABLY MANAGED - PROGRAM 2: MINERAL RESOURCES AND GEOSCIENCES DEVELOPMENT PROGRAM",
  "OO1: NATURAL RESOURCES SUSTAINABLY MANAGED - PROGRAM 1: MINERAL RESOURCES ENFORCEMENT AND REGULATORY PROGRAM",
];

const SEMESTER_OPTIONS = ["1st Semester", "2nd Semester", "Annual"];

/*
 * One assignment covers a single period and semester, so those stay shared. Inside it the form is
 * shaped like the printed OPCR: a KPI is one OO/PAP -- "Mineral Reservation Program" -- under a
 * category band, with its budget, and beside it a row per success indicator. Each row holds the
 * form's two indicator columns, the fiscal-year target and the semester target ("1 New Mineral
 * Reservation area assessed..." beside "NO TARGET FOR REGIONAL OFFICES"). On save every row becomes
 * one record carrying the shared OO/PAP, so each is accomplished and rated on its own.
 */
let bulkKpiSeq = 0;

function createBulkIndicator() {
  bulkKpiSeq += 1;
  return {
    uid: `opcr-indicator-${bulkKpiSeq}`,
    target: "",
    semesterTarget: "",
  };
}

function createBulkKpi() {
  bulkKpiSeq += 1;
  return {
    uid: `opcr-kpi-${bulkKpiSeq}`,
    kpiTitle: "",
    category: "",
    subCategory: "",
    budget: "",
    indicators: [createBulkIndicator()],
  };
}

function createDefaultBulkForm() {
  return {
    period: `FY ${currentYear}`,
    semester: "1st Semester",
    kpis: [createBulkKpi()],
  };
}

/*
 * One validation card's editable values. The scores start from the saved rating once the KPI is
 * validated, else empty: the chief submits evidence, not a self-rating, so the Regional Director
 * scores it. `decision` is "validate", "return", or "" until one is picked.
 */
function createRatingForm(record = {}) {
  const validated = kpiStatus(record) === "rated";
  return {
    decision: "",
    remarks: record.remarks || "",
    returnNote: "",
    q1Rating: validated ? record.q1Rating || "" : "",
    e2Rating: validated ? record.e2Rating || "" : "",
    t3Rating: validated ? record.t3Rating || "" : "",
    dirty: false,
  };
}

function ratingKey(record) {
  return String(record?.assignmentId ?? record?.id ?? "");
}

/*
 * A form's KPI rows in printed order: by category, then sub-heading (rows without one first), then
 * entry order. The preview and the rating dialog both list them this way.
 */
function orderOpcrFormRows(rows) {
  return [...rows].sort((left, right) => {
    const categorySort = String(left.category || "").localeCompare(String(right.category || ""));
    if (categorySort !== 0) return categorySort;
    const subCategorySort = String(left.subCategory || "").localeCompare(String(right.subCategory || ""));
    if (subCategorySort !== 0) return subCategorySort;
    return String(left.assignmentId || left.id || "").localeCompare(String(right.assignmentId || right.id || ""), undefined, { numeric: true });
  });
}

function createOpcrEditForm(record = {}) {
  return {
    period: record.period || "",
    semester: record.semester || "1st Semester",
    output: record.kpiTitle || record.output || "",
    successIndicator: record.successIndicator || record.success_indicator || "",
    semesterIndicator: record.semesterIndicator || record.semester_indicator || "",
    category: record.category || "Program",
    subCategory: record.subCategory || record.sub_category || "",
    budget: record.budget ?? "",
  };
}

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function currency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "N/A";
  return amount.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });
}

function periodLabel(record) {
  return [record?.period, record?.semester].filter(Boolean).join(" - ") || "Current period";
}

/*
 * The semester column of a row. A row with no semester target prints the form's own wording for
 * that, "NO TARGET FOR 2ND SEMESTER", rather than an empty cell.
 */
function noSemesterTarget(record) {
  return `NO TARGET FOR ${text(record?.semester, "THE SEMESTER").toUpperCase()}`;
}

/* The budget is allotted to the OO/PAP, so the rows sharing its cell are added into one figure. */
function runBudget(rows, start, length) {
  return rows.slice(start, start + length).reduce((sum, row) => sum + (Number(row.budget) || 0), 0);
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

function accountableKey(record) {
  if (record?.employeeRecordId) return `individual:${record.employeeRecordId}`;
  return `division:${String(record?.division || record?.accountableName || "").toLowerCase()}`;
}

function normalizeRecord(record = {}) {
  const assignmentId = record.assignmentId ?? record.assignment_id ?? record.id;
  const employeeRecordId = record.employeeRecordId ?? record.employee_id ?? null;
  const division = record.division ?? record.department ?? "";
  const employee = record.employeeName ?? record.fullName ?? "";
  const accountableName = record.accountableName
    ?? (employeeRecordId ? employee : division)
    ?? division;

  return {
    ...record,
    id: assignmentId,
    assignmentId,
    opcrNo: record.opcrNo ?? record.opcr_no,
    templateId: record.templateId ?? record.template_id,
    employeeRecordId,
    employeeCode: record.employeeCode ?? record.employeeIdNumber ?? record.employeeId,
    employeeName: employee,
    accountableName,
    division,
    period: record.period ?? `FY ${currentYear}`,
    semester: record.semester ?? "1st Semester",
    preparedBy: record.preparedBy ?? record.prepared_by,
    approvedBy: record.approvedBy ?? record.approved_by,
    kpiTitle: record.kpiTitle ?? record.output,
    output: record.output ?? record.kpiTitle,
    successIndicator: record.successIndicator ?? record.success_indicator,
    semesterIndicator: record.semesterIndicator ?? record.semester_indicator ?? "",
    category: record.category ?? record.kpiCategory ?? "Program",
    subCategory: record.subCategory ?? record.sub_category ?? "",
    budget: record.budget,
    actualAccomplishment: record.actualAccomplishment ?? record.actual_accomplishment,
    remarks: record.remarks,
    finalRating: record.finalRating ?? record.final_rating,
    q1Rating: record.q1Rating ?? record.q1_rating,
    e2Rating: record.e2Rating ?? record.e2_rating,
    t3Rating: record.t3Rating ?? record.t3_rating,
    a4Rating: record.a4Rating ?? record.a4_rating,
    modeOfVerificationName: record.modeOfVerificationName ?? record.mode_of_verification_name,
    modeOfVerificationPath: record.modeOfVerificationPath ?? record.mode_of_verification_path,
    modeOfVerificationSize: record.modeOfVerificationSize ?? record.mode_of_verification_size,
    submittedAt: record.submittedAt ?? record.submitted_at,
    submittedByName: record.submittedByName ?? record.submitted_by_name,
    reviewedByName: record.reviewedByName ?? record.reviewed_by_name,
    reviewedAt: record.reviewedAt ?? record.reviewed_at,
    approvalRemarks: record.approvalRemarks ?? record.approval_remarks,
    verificationFiles: Array.isArray(record.verificationFiles) ? record.verificationFiles : [],
    status: record.status ?? record.assignmentStatus ?? record.assignment_status ?? "Assigned",
  };
}

function sameOpcrForm(left, right) {
  return performanceFormKey(left, "opcr") === performanceFormKey(right, "opcr");
}

/*
 * The first value any row of the form carries for `key`, the way perf_first_value() reads it for the
 * export: a row cached before opcr.php sent the signatories has none of its own.
 */
function firstFormValue(rows, key) {
  const row = rows.find((item) => String(item?.[key] ?? "").trim() !== "");
  return row ? String(row[key]).trim() : "";
}

const BLANK_SIGNATORY = "______________________________";

function OpcrFormDocument({ record, rows = [] }) {
  const formRows = rows.length > 0 ? rows : [record].filter(Boolean);
  const period = [record?.period, record?.semester].filter(Boolean).join(" - ") || "Rating Period";
  const rating = finalAverageRating(formRows);
  /*
   * The division's chief commits to the form and assesses it, the HR Head signs beside, and the
   * Regional Director gives the final rating. opcr.php reads each from whoever holds the role, and a
   * role nobody holds prints a blank line.
   */
  const signatoryRows = [record, ...formRows].filter(Boolean);
  const division = text(record?.division, "DIVISION").toUpperCase();
  const chiefName = firstFormValue(signatoryRows, "divisionChiefName").toUpperCase();
  const chiefPosition = firstFormValue(signatoryRows, "divisionChiefPosition") || "Division Chief";
  const hrHeadName = firstFormValue(signatoryRows, "hrHeadName").toUpperCase();
  const hrHeadPosition = firstFormValue(signatoryRows, "hrHeadPosition") || "HR Head";
  const directorName = firstFormValue(signatoryRows, "regionalDirectorName").toUpperCase();
  const directorPosition = firstFormValue(signatoryRows, "regionalDirectorPosition") || "Regional Director";
  // `break-words` keeps a URL, file name or long reference inside its box instead of running through the border.
  const cell = "border-2 border-black px-2 py-2 align-top break-words";
  const centerCell = `${cell} text-center`;
  const headerCell = `${cell} text-center font-bold`;
  const summaryLabel = `${cell} font-bold`;

  return (
    <div className="document-paper min-w-[2000px] border-2 border-black bg-white font-sans text-black">
      <div className="border-b-2 border-black p-2 text-center text-sm font-bold">
        OFFICE PERFORMANCE COMMITMENT AND REVIEW - MGB REGIONAL OFFICE
      </div>

      <table className="w-full table-fixed border-collapse text-[13px]">
        <tbody>
          <tr>
            <td className="w-[70%] border-b-2 border-black px-4 py-4 break-words leading-6">
              I, <strong>{chiefName || BLANK_SIGNATORY}</strong>, Head of the <strong>{division}</strong>,{" "}
              <strong>MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE No. X</strong>, commit to deliver and agree
              to be rated on the attainment of the following targets in accordance with the indicated measures
              for the period <strong>{period}.</strong>
            </td>
            <td className="w-[30%] border-b-2 border-l-2 border-black px-4 py-4 break-words text-center">
              <div className="h-20" />
              <div className="inline-block min-w-[240px] border-t border-black px-3 pt-1 font-bold">{chiefName || " "}</div>
              <div>{chiefPosition}</div>
              <div className="mt-3">Date: __________</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="flex justify-end p-4 pb-0">
        <div className="w-[260px] border-2 border-black p-2 text-xs">
          <div className="float-left mr-2 font-bold [writing-mode:vertical-rl] [transform:rotate(180deg)]">
            RATING SCALE
          </div>
          <div className="mr-6 leading-5">
            5 - Outstanding
            <br />
            4 - Very Satisfactory
            <br />
            3 - Satisfactory
            <br />
            2 - Unsatisfactory
            <br />
            1 - Poor
          </div>
          <div className="clear-both" />
        </div>
      </div>

      <div className="p-2">
      <table className="w-full table-fixed border-collapse text-xs">
        <thead>
          <tr>
            <th className={`${headerCell} w-[12%]`} rowSpan={2}>OO/PAP</th>
            <th className={headerCell} colSpan={2}>Success Indicators</th>
            <th className={`${headerCell} w-[10%]`} rowSpan={2}>
              Allotted Budget
              <br />
              (MOOE Php '000)
            </th>
            <th className={`${headerCell} w-[13%]`} rowSpan={2}>Divisions/Individuals Accountable</th>
            <th className={`${headerCell} w-[14%]`} rowSpan={2}>Actual Accomp.</th>
            <th className={headerCell} colSpan={4}>Rating</th>
            <th className={`${headerCell} w-[12%]`} rowSpan={2}>Remarks</th>
          </tr>
          <tr>
            <th className={`${headerCell} w-[15%]`}>{text(record?.period, `FY ${currentYear}`)}</th>
            <th className={`${headerCell} w-[15%]`}>{text(record?.semester, "Semester")}</th>
            <th className={`${headerCell} w-[4%]`}>Q1</th>
            <th className={`${headerCell} w-[4%]`}>Q2</th>
            <th className={`${headerCell} w-[4%]`}>Q3</th>
            <th className={`${headerCell} w-[4%]`}>Q4</th>
          </tr>
        </thead>
        <tbody>
          {/*
            * Laid out like the printed form: one band per category, then a row per success
            * indicator with the fiscal-year target and the semester target side by side. Rows of
            * one OO/PAP share its cell and its budget, the way "Mineral Reservation Program" spans
            * its three indicators on the form.
            */}
          {formRows.map((item, index) => {
            const category = text(item.category, "Program").toUpperCase();
            const previous = index > 0 ? formRows[index - 1] : null;
            const startsCategory = !previous || category !== text(previous.category, "Program").toUpperCase();
            /*
             * The sub-heading under the category band -- "Mining Investment Promotion" under the
             * enforcement program -- printed once above the outputs filed under it. An output with
             * none sits directly under its category.
             */
            const subCategory = text(item.subCategory, "");
            const startsSubCategory = subCategory !== ""
              && (startsCategory || subCategory !== text(previous?.subCategory, ""));
            const continuesOutput = index > 0 && sameOutputCell(formRows[index - 1], item);
            const span = continuesOutput ? 0 : outputRunLength(formRows, index);
            const budget = continuesOutput ? 0 : runBudget(formRows, index, span);
            return (
              <React.Fragment key={item.assignmentId || item.id || index}>
                {startsCategory ? (
                  <tr>
                    <td colSpan={11} className={`${cell} bg-[#f2f2f2] font-bold`}>
                      {category}
                    </td>
                  </tr>
                ) : null}
                {startsSubCategory ? (
                  <tr>
                    <td colSpan={11} className={`${cell} font-bold`}>
                      {subCategory}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  {continuesOutput ? null : (
                    <td rowSpan={span} className={`${cell} leading-5 font-bold`}>{text(item.output || item.kpiTitle)}</td>
                  )}
                  <td className={`${cell} leading-5`}><SuccessIndicatorList value={item.successIndicator} /></td>
                  <td className={`${cell} leading-5`}><SuccessIndicatorList value={item.semesterIndicator} fallback={noSemesterTarget(item)} /></td>
                  {continuesOutput ? null : (
                    <td rowSpan={span} className={centerCell}>{budget > 0 ? currency(budget) : ""}</td>
                  )}
                  {/* Every division sharing the KPI — "GD, MMD & MSESDD" — as opcr.php prints it; rows
                      cached before that field existed carry only their own name. */}
                  <td className={`${centerCell} leading-5`}>{text(item.accountableLabel || item.accountableName)}</td>
                  <td className={`${cell} leading-5`}>{text(item.actualAccomplishment, "")}</td>
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
            <td colSpan={9} className={summaryLabel}>Average Rating</td>
            <td className={centerCell}>{rating === "N/A" ? "" : rating}</td>
            <td className={cell} />
          </tr>
          <tr>
            <td colSpan={3} className={summaryLabel}>Category</td>
            <td colSpan={2} className={centerCell}>Output</td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={centerCell}>Rating</td>
            <td className={cell} />
          </tr>
          <tr>
            <td colSpan={3} className={summaryLabel}>Total Overall Rating</td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
          </tr>
          <tr>
            <td colSpan={3} className={summaryLabel}>Final Average Rating</td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={centerCell}>{rating === "N/A" ? "" : rating}</td>
            <td className={cell} />
          </tr>
          <tr>
            <td colSpan={3} className={summaryLabel}>Adjectival Rating</td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
          </tr>
        </tbody>
      </table>

      <table className="w-full table-fixed border-collapse border-t-0 text-xs">
        <tbody>
          <tr>
            <td className={`${cell} w-[28%]`}>
              Assessed by:
              <br />
              <br />
              <div className="text-center">
                <div className="font-bold">{chiefName || BLANK_SIGNATORY}</div>
                <div>{chiefPosition}</div>
              </div>
            </td>
            <td className={`${cell} w-[5%]`}>Date</td>
            <td className={`${cell} w-[28%]`}>
              <br />
              <br />
              <div className="text-center">
                <div className="font-bold">{hrHeadName || BLANK_SIGNATORY}</div>
                <div>{hrHeadPosition}</div>
              </div>
            </td>
            <td className={`${cell} w-[5%]`}>Date</td>
            <td className={`${cell} w-[29%]`}>
              Final Rating:
              <br />
              <br />
              <div className="text-center">
                <div className="font-bold">{directorName || BLANK_SIGNATORY}</div>
                <div>{directorPosition}</div>
              </div>
            </td>
            <td className={`${cell} w-[5%]`}>Date</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 text-[11px]">
        Legend: 1 - Quantity &nbsp;&nbsp; 2 - Quality &nbsp;&nbsp; 3 - Timeliness &nbsp;&nbsp; 4 - Average
      </div>
      </div>
    </div>
  );
}

function sameDivision(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

/*
 * `division` is passed on a chief's desk only. Two chiefs signing in on one browser share the chief
 * cache, so what it holds is cut back to this chief's division before any of it is shown.
 */
function loadLocalRecords(storageKey, division = null) {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    const cached = Array.isArray(parsed) ? parsed.map(normalizeRecord) : [];
    return division === null ? cached : cached.filter((record) => sameDivision(record.division, division));
  } catch {
    return [];
  }
}

function saveLocalRecords(storageKey, records) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(records));
}

/*
 * A KPI's uploaded MOVs, each opening its file. `onRemove` adds a remove button to each, for the
 * chief while the KPI is still theirs to change.
 */
function MovFileList({ files, onRemove = null, removingFileId = null, disabled = false }) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
      {files.map((file) => {
        const fileUrl = resolveBackendAssetUrl(file.storedPath || file.path || "");
        const image = isImageFile(file);
        const name = text(file.originalName || file.name, "Uploaded file");
        const size = fileSizeLabel(file.fileSize);
        return (
          <li key={file.id || fileUrl} className="flex items-center gap-1 rounded-lg border border-slate-200 transition hover:border-accent-300 dark:border-slate-800">
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 flex-1 items-center gap-3 p-2 text-sm no-underline"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-100 text-slate-400">
                {image && fileUrl ? <img src={fileUrl} alt="" className="h-full w-full object-cover" /> : <FileText size={18} aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-800">{name}</span>
                <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent-700">
                  {image ? <ImageIcon size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
                  {size ? `Open file · ${size}` : "Open file"}
                </span>
              </span>
            </a>
            {onRemove && file.id ? (
              <button
                type="button"
                onClick={() => onRemove(file)}
                disabled={disabled || removingFileId === file.id}
                aria-label={`Remove uploaded ${name}`}
                title="Remove"
                className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* The form's two success-indicator columns for one KPI: the fiscal-year target and the semester target. */
function SuccessIndicatorPair({ record, highlight = false }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className={`rounded-lg border p-3 ${highlight
        ? "border-accent-200 bg-accent-50/40 dark:border-accent-900 dark:bg-accent-950/20"
        : "border-slate-200 bg-slate-50 dark:border-slate-800"}`}
      >
        <p className={`m-0 text-[11px] font-semibold uppercase tracking-wide ${highlight ? "text-accent-700 dark:text-accent-400" : "text-slate-500"}`}>
          Success Indicator · {text(record.period, "Fiscal year")}
        </p>
        <div className="m-0 mt-1 text-[13px] leading-relaxed text-slate-700"><SuccessIndicatorList value={record.successIndicator} /></div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Success Indicator · {text(record.semester, "Semester")}</p>
        <div className="m-0 mt-1 text-[13px] leading-relaxed text-slate-700"><SuccessIndicatorList value={record.semesterIndicator} fallback={noSemesterTarget(record)} /></div>
      </div>
    </div>
  );
}

/* The top of the submission and validation dialogs: whose form it is, and its totals. */
function FormDialogHeading({ record, stats }) {
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center dark:border-slate-800">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-950/60 dark:text-accent-400">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <FieldCaption>Accountable Division</FieldCaption>
          <p className="m-0 mt-0.5 text-lg font-semibold leading-tight text-slate-950">{text(record?.accountableName)}</p>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {[record?.opcrNo, periodLabel(record)].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
            <dt><FieldCaption>{stat.label}</FieldCaption></dt>
            <dd className="m-0 mt-0.5 text-base font-bold tabular-nums text-slate-900">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* The note a returned KPI carries back to the chief, or the earlier one on a KPI submitted again. */
function ReturnNote({ record, current }) {
  const note = text(record.approvalRemarks, "");
  if (!note) return null;
  return (
    <div
      role="note"
      className={`rounded-lg border p-3 ${current
        ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30"
        : "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"}`}
    >
      <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        <Undo2 size={12} aria-hidden="true" />
        {current
          ? `Returned${record.reviewedByName ? ` by ${record.reviewedByName}` : ""} for revision`
          : "Returned earlier"}
      </p>
      <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{note}</p>
    </div>
  );
}

/**
 * The OPCR desk, one step of the workflow per role:
 *
 *   HR Head   `canAssign` opens Bulk Assign KPI; `canManage` (Admin and HR) adds editing and
 *             archiving an existing commitment. HR follows each form read-only from there.
 *   Chief     `mode="chief"` confines the desk to `division`: the forms the HR Head assigned to it.
 *             The chief writes each KPI's actual accomplishment, attaches the MOVs, and submits
 *             them to the Regional Director, and may file further commitments for the division.
 *   Director  `mode="director"` with `canValidate`: every division's forms. The Regional Director
 *             checks the MOVs, then validates and rates each KPI or returns it to the chief.
 *
 * This mirrors `opcr_can_assign()`, `opcr_can_manage()`, `opcr_can_submit()`, and
 * `opcr_can_validate()` in backend/api/opcr.php, with opcr_apply_read_scope() keeping a chief to
 * their division; the server enforces all of it, the props only shape the screen.
 */
export default function OpcrManagementWorkspace({
  employees = [],
  canManage = true,
  canAssign = canManage,
  canValidate = false,
  mode = "manage",
  division = "",
}) {
  const isChief = mode === "chief";
  const isDirector = mode === "director";
  const chiefDivision = isChief ? text(division, "") : "";
  const storageKey = STORAGE_KEYS[mode] || STORAGE_KEYS.manage;
  const cacheDivision = isChief ? chiefDivision : null;
  const [activeTab, setActiveTab] = useState("form");
  const [archiveView, setArchiveView] = useState(false);
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [assignmentDivisionFilter, setAssignmentDivisionFilter] = useState("");
  const [selectedAccountableIds, setSelectedAccountableIds] = useState([]);
  const [records, setRecords] = useState(() => loadLocalRecords(storageKey, cacheDivision));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState(createDefaultBulkForm);
  // Every KPI of the form open in the validation dialog, and each one's editable values keyed by `ratingKey`.
  const [verificationKpis, setVerificationKpis] = useState([]);
  const [ratingForms, setRatingForms] = useState({});
  /*
   * The chief's submission dialog: the form's KPIs, and unsaved edits keyed by `ratingKey` --
   * `{ actualAccomplishment, files, touched }`. Only edited KPIs have an entry. `touched` marks a
   * KPI whose MOVs already changed on the server (one removed, or uploaded by a submit that then
   * failed), so it still needs submitting.
   */
  const [submissionKpis, setSubmissionKpis] = useState([]);
  const [submissionDrafts, setSubmissionDrafts] = useState({});
  const [removingFileId, setRemovingFileId] = useState(null);
  const [formPreviewRecord, setFormPreviewRecord] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState(createOpcrEditForm);
  const [archivingId, setArchivingId] = useState(null);
  const [exportingFormId, setExportingFormId] = useState(null);

  // OPCR targets are the divisions on the roster rather than individual employees. A chief's are
  // their own division alone.
  const accountableOptions = useMemo(() => {
    const divisions = new Map();
    const names = isChief ? [chiefDivision] : employees.map((employee) => text(employee.department, ""));
    names.forEach((name) => {
      if (name) {
        divisions.set(name.toLowerCase(), {
          id: `division:${name.toLowerCase()}`,
          type: "division",
          label: name,
          sublabel: "Division",
          division: name,
        });
      }
    });

    return Array.from(divisions.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [chiefDivision, employees, isChief]);

  /*
   * The division table. A record raised under a division since renamed or archived is still listed
   * under All divisions; the filter offers only divisions that exist today.
   */
  const { divisions: divisionOptions } = useOrganizationFilterOptions();

  const filteredAccountables = useMemo(() => {
    const needle = assignmentQuery.trim().toLowerCase();

    return accountableOptions.filter((item) => {
      if (assignmentDivisionFilter && text(item.division, "") !== assignmentDivisionFilter) {
        return false;
      }

      if (!needle) return true;

      return [
        item.label,
        item.sublabel,
        item.division,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [accountableOptions, assignmentDivisionFilter, assignmentQuery]);

  const recordsByAccountable = useMemo(() => {
    const map = new Map();
    records.forEach((record) => {
      const key = accountableKey(record);
      const existing = map.get(key);
      if (!existing || Number(record.assignmentId || 0) > Number(existing.assignmentId || 0)) {
        map.set(key, record);
      }
    });
    return map;
  }, [records]);

  const tableRows = useMemo(
    () => filteredAccountables.map((item) => ({
      ...item,
      latestOpcr: recordsByAccountable.get(item.id) || null,
    })),
    [filteredAccountables, recordsByAccountable]
  );

  const formRecords = useMemo(() => groupPerformanceForms(records, "opcr"), [records]);
  const searchedRecords = useMemo(() => filterPerformanceForms(formRecords, query, divisionFilter), [formRecords, query, divisionFilter]);
  // The status counts follow the search and division filter, so each option says what picking it would show.
  const statusCounts = useMemo(() => {
    const counts = { all: searchedRecords.length, assigned: 0, submitted: 0, returned: 0, partial: 0, validated: 0 };
    searchedRecords.forEach((form) => { counts[formStage(form)] += 1; });
    return counts;
  }, [searchedRecords]);
  const filteredRecords = useMemo(
    () => (statusFilter === "all" ? searchedRecords : searchedRecords.filter((form) => formStage(form) === statusFilter)),
    [searchedRecords, statusFilter]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [query, divisionFilter, statusFilter, rowsPerPage, activeTab, archiveView]);

  const loadRecords = useCallback(async ({ background = false, archived = archiveView } = {}) => {
    const viewingArchive = Boolean(archived);
    setLoading(!background);
    try {
      const response = await fetchOpcrRecords({ archived: viewingArchive ? 1 : 0 });
      const nextRecords = (response.records || response.opcrRecords || []).map(normalizeRecord);
      setRecords(nextRecords);
      if (!viewingArchive) saveLocalRecords(storageKey, nextRecords);
    } catch (error) {
      // Falling back to the local cache is for a failed *first* load. A failed background poll
      // already has fresher records on screen than the cache holds, so it leaves them alone.
      if (!background && !viewingArchive) {
        setRecords(loadLocalRecords(storageKey, cacheDivision));
      } else if (!background) {
        setRecords([]);
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView, cacheDivision, storageKey]);

  useAutoRefreshOnChange(loadRecords, { topic: "opcr" });

  const selectedCount = selectedAccountableIds.length;
  const allVisibleSelected = filteredAccountables.length > 0
    && filteredAccountables.every((item) => selectedAccountableIds.includes(item.id));

  const toggleAccountable = (id) => {
    setSelectedAccountableIds((current) => (
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    ));
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredAccountables.map((item) => item.id));
      setSelectedAccountableIds((current) => current.filter((id) => !visibleIds.has(id)));
      return;
    }

    setSelectedAccountableIds((current) => {
      const ids = new Set(current);
      filteredAccountables.forEach((item) => ids.add(item.id));
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

  // The form always keeps at least one KPI row, so the last one cannot be removed.
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
    // Every success indicator row becomes one record carrying its KPI's OO/PAP and category. The
    // budget is allotted to the OO/PAP, so it rides on the first row only and the form adds the
    // rows of one OO/PAP together rather than counting it once per row.
    const kpis = bulkForm.kpis.flatMap((kpi) => kpi.indicators.map((row, rowIndex) => ({
      output: kpi.kpiTitle.trim(),
      success_indicator: row.target.trim(),
      semester_indicator: row.semesterTarget.trim(),
      category: kpi.category.trim(),
      sub_category: kpi.subCategory.trim(),
      budget: rowIndex === 0 ? kpi.budget : "",
    })));
    const targetItems = selectedAccountableIds
      .map((id) => accountableOptions.find((item) => item.id === id))
      .filter(Boolean);

    const incompleteKpi = kpis.some((kpi) => !kpi.output || !kpi.success_indicator || !kpi.category);
    if (kpis.length === 0 || incompleteKpi || targetItems.length === 0) {
      toast.error(`Complete every output, ${text(bulkForm.period, "fiscal-year")} success indicator, and category, and select at least one division.`);
      return;
    }

    if (!bulkForm.period.trim()) {
      toast.error("Enter the performance period.");
      return;
    }

    setSaving(true);
    const payload = {
      accountable_items: targetItems.map((item) => ({
        type: item.type,
        employee_id: item.employeeId || null,
        name: item.label,
        division: item.division,
      })),
      kpis,
      period: bulkForm.period.trim(),
      semester: bulkForm.semester,
    };

    try {
      const response = await createOpcr(payload);
      const createdRecords = (response.records || []).map(normalizeRecord);
      const nextRecords = createdRecords.length > 0
        ? [...createdRecords, ...records]
        : [
            ...targetItems.flatMap((item) => kpis.map((kpi, index) => normalizeRecord({
              id: `local-${Date.now()}-${item.id}-${index}`,
              assignmentId: `local-${Date.now()}-${item.id}-${index}`,
              accountableName: item.label,
              division: item.division,
              output: kpi.output,
              successIndicator: kpi.success_indicator,
              semesterIndicator: kpi.semester_indicator,
              category: kpi.category,
              subCategory: kpi.sub_category,
              budget: kpi.budget,
              period: payload.period,
              semester: payload.semester,
              status: "Assigned",
            }))),
            ...records,
          ];
      setRecords(nextRecords);
      saveLocalRecords(storageKey, nextRecords);
      setBulkOpen(false);
      setActiveTab("form");
      setSelectedAccountableIds([]);
      const kpiCount = bulkForm.kpis.length;
      toast.success(
        `${kpiCount} KPI${kpiCount === 1 ? "" : "s"} (${kpis.length} success indicator${kpis.length === 1 ? "" : "s"}) assigned to ${targetItems.length} division${targetItems.length === 1 ? "" : "s"}.`
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to assign KPI.");
    } finally {
      setSaving(false);
    }
  };

  /*
   * The submission dialog reads its KPIs from the register, so an upload, a removal, or a
   * background refresh shows on its cards while the chief's unsaved drafts stay apart.
   */
  const recordsByKey = useMemo(() => new Map(records.map((record) => [ratingKey(record), record])), [records]);
  const submissionView = submissionKpis.map((record) => recordsByKey.get(ratingKey(record)) || record);

  // Every KPI of the row's form, in printed order.
  const formMembers = (form) => {
    const first = form?.kpis?.[0] || form;
    if (!first) return [];
    const members = orderOpcrFormRows(records.filter((record) => sameOpcrForm(record, first)));
    return members.length > 0 ? members : [first];
  };

  /*
   * Opens the validation dialog on every KPI of the row's form, each on its own card. Without
   * `canValidate` (HR following a form) the same dialog opens read-only.
   */
  const openVerification = (form) => {
    const kpis = formMembers(form);
    if (kpis.length === 0) {
      toast.error("Assign a KPI before reviewing its MOVs.");
      return;
    }

    setVerificationKpis(kpis);
    setRatingForms(Object.fromEntries(kpis.map((record) => [ratingKey(record), createRatingForm(record)])));
  };

  const closeVerification = () => {
    setVerificationKpis([]);
    setRatingForms({});
  };

  /*
   * Any edit marks the card dirty, which is what Save decisions sends. Entering a score means the
   * Regional Director is validating, so it picks Validate when no decision is chosen yet.
   */
  const updateRatingForm = (key, changes) => {
    setRatingForms((forms) => {
      const current = forms[key] || {};
      const scoring = ["q1Rating", "e2Rating", "t3Rating"].some((name) => name in changes);
      const decision = changes.decision ?? (scoring && !current.decision ? "validate" : current.decision);
      return { ...forms, [key]: { ...current, ...changes, decision, dirty: true } };
    });
  };

  const jumpToRatingCard = (key) => {
    document.getElementById(`opcr-rating-card-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  // Puts saved records back into the register and its cache.
  const applySavedRecords = (savedRecords) => {
    const saved = new Map(savedRecords.map((record) => [ratingKey(record), record]));
    if (saved.size === 0) return;
    setRecords((current) => {
      const next = current.map((record) => saved.get(ratingKey(record)) || record);
      saveLocalRecords(storageKey, next);
      return next;
    });
  };

  /* The chief's submission dialog on every KPI of the row's form. */
  const openSubmission = (form) => {
    const kpis = formMembers(form);
    if (kpis.length === 0) {
      toast.error("No KPIs are assigned to this form yet.");
      return;
    }

    setSubmissionKpis(kpis);
    setSubmissionDrafts({});
  };

  const closeSubmission = () => {
    setSubmissionKpis([]);
    setSubmissionDrafts({});
  };

  const accomplishmentOf = (record) => submissionDrafts[ratingKey(record)]?.actualAccomplishment ?? record.actualAccomplishment ?? "";
  const pickedFilesOf = (record) => submissionDrafts[ratingKey(record)]?.files || [];
  const isSubmissionChanged = (record) => {
    const draft = submissionDrafts[ratingKey(record)];
    if (!draft || kpiStatus(record) === "rated") return false;
    return draft.touched
      || draft.files.length > 0
      || draft.actualAccomplishment.trim() !== String(record.actualAccomplishment || "").trim();
  };

  // A KPI's first edit seeds its draft from what is saved, so untouched fields keep their values.
  const updateSubmissionDraft = (record, changes) => {
    const key = ratingKey(record);
    setSubmissionDrafts((current) => {
      const base = current[key] || {
        actualAccomplishment: record.actualAccomplishment ?? "",
        files: [],
        touched: false,
      };
      return { ...current, [key]: { ...base, ...changes } };
    });
  };

  const addSubmissionFiles = (record, fileList) => {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;
    const existing = pickedFilesOf(record);
    const known = new Set(existing.map((file) => `${file.name}:${file.size}`));
    updateSubmissionDraft(record, { files: [...existing, ...picked.filter((file) => !known.has(`${file.name}:${file.size}`))] });
  };

  const removePickedFile = (record, target) => {
    updateSubmissionDraft(record, { files: pickedFilesOf(record).filter((file) => file !== target) });
  };

  const discardSubmissionDraft = (record) => {
    setSubmissionDrafts((current) => {
      const next = { ...current };
      delete next[ratingKey(record)];
      return next;
    });
  };

  /* Deletes a MOV that is already uploaded. The KPI then needs submitting again to reach the Regional Director. */
  const removeSavedFile = async (record, file) => {
    const name = text(file.originalName || file.name, "this file");
    if (!window.confirm(`Remove ${name}? The file is deleted from this KPI's MOVs.`)) return;

    setRemovingFileId(file.id);
    try {
      const response = await deleteOpcrVerification(file.id);
      if (response?.record) applySavedRecords([normalizeRecord(response.record)]);
      updateSubmissionDraft(record, { touched: true });
      toast.success("MOV removed. Submit the KPI again when it is ready.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to remove the MOV.");
    } finally {
      setRemovingFileId(null);
    }
  };

  const focusSubmissionKpi = (record, field = "accomplishment") => {
    const key = ratingKey(record);
    document.getElementById(`opcr-submit-card-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    document.getElementById(`opcr-submit-${key}-${field}`)?.focus();
  };

  /*
   * Submits every changed KPI of the form to the Regional Director. The new MOVs upload first,
   * since the server will not take a KPI without one, then one call submits every accomplishment
   * together -- all of them or, if one is refused, none. MOVs that uploaded before a failure stay
   * uploaded, and their KPIs keep the rest of their edits for another try.
   */
  const handleSubmitAccomplishment = async () => {
    const pending = submissionView.filter(isSubmissionChanged);
    if (pending.length === 0) {
      toast.error("No changes to submit. Write an accomplishment or attach a MOV first.");
      return;
    }

    for (const record of pending) {
      const position = submissionView.indexOf(record) + 1;
      if (!text(accomplishmentOf(record), "")) {
        toast.error(`Write the actual accomplishment for KPI ${position} before submitting it.`);
        focusSubmissionKpi(record, "accomplishment");
        return;
      }
      if ((record.verificationFiles?.length || 0) + pickedFilesOf(record).length === 0) {
        toast.error(`Attach at least one MOV to KPI ${position} before submitting it.`);
        focusSubmissionKpi(record, "files");
        return;
      }
    }

    setSaving(true);
    const uploaded = new Map();
    let submitted = false;
    try {
      for (const record of pending) {
        const key = ratingKey(record);
        for (const file of pickedFilesOf(record)) {
          await uploadOpcrVerification(record.assignmentId, file);
          uploaded.set(key, (uploaded.get(key) || 0) + 1);
        }
      }

      const response = await submitOpcrAccomplishment({
        kpis: pending.map((record) => ({
          assignment_id: record.assignmentId,
          actual_accomplishment: accomplishmentOf(record).trim(),
        })),
      });
      submitted = true;
      applySavedRecords((response?.records || []).map(normalizeRecord));
      toast.success(response?.message || (pending.length === 1
        ? "OPCR KPI submitted to the Regional Director."
        : `${pending.length} OPCR KPIs submitted to the Regional Director.`));
      closeSubmission();
    } catch (error) {
      const message = error?.response?.data?.message || "Unable to submit the accomplishments.";
      toast.error(uploaded.size > 0 ? `${message} The MOVs that uploaded are saved; submit again to finish.` : message);
      // A KPI keeps only the files that did not upload, and stays pending for the retry.
      setSubmissionDrafts((current) => {
        const next = { ...current };
        uploaded.forEach((count, key) => {
          if (next[key]) next[key] = { ...next[key], files: next[key].files.slice(count), touched: true };
        });
        return next;
      });
    } finally {
      setSaving(false);
      if (submitted || uploaded.size > 0) void loadRecords({ background: true });
    }
  };

  // The download covers the whole OPCR form the row belongs to, the same grouping the preview shows.
  const handleExportForm = async (record) => {
    if (!record) return;

    setExportingFormId(record.assignmentId || record.id || null);
    try {
      await exportOpcrForm(record);
      toast.success("OPCR form exported to Excel.");
    } catch (error) {
      toast.error(error?.message || "Unable to export the OPCR form.");
    } finally {
      setExportingFormId(null);
    }
  };

  const openEdit = (record) => {
    record = record?.kpis?.[0] || record;
    setEditingRecord(record);
    setEditForm(createOpcrEditForm(record));
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!editingRecord?.assignmentId) return;

    if (!editForm.period.trim() || !editForm.semester.trim() || !editForm.output.trim()
      || !editForm.successIndicator.trim() || !editForm.category.trim()) {
      toast.error("Complete the period, semester, output, success indicator, and category.");
      return;
    }

    if (editForm.budget !== "" && (!Number.isFinite(Number(editForm.budget)) || Number(editForm.budget) < 0)) {
      toast.error("Budget must be a valid non-negative amount.");
      return;
    }

    setSaving(true);
    try {
      const response = await updateOpcrRecord({
        assignment_id: editingRecord.assignmentId,
        period: editForm.period.trim(),
        semester: editForm.semester,
        output: editForm.output.trim(),
        success_indicator: normalizeSuccessIndicators(editForm.successIndicator),
        semester_indicator: normalizeSuccessIndicators(editForm.semesterIndicator),
        category: editForm.category.trim(),
        sub_category: editForm.subCategory.trim(),
        budget: editForm.budget,
      });
      // A KPI template is shared by every division assigned it, so the update can touch several rows.
      const updatedRecords = (response.records || [response.record]).filter(Boolean).map(normalizeRecord);
      const updatedById = new Map(updatedRecords.map((record) => [String(record.assignmentId), record]));
      const nextRecords = records.map((record) => updatedById.get(String(record.assignmentId)) || record);
      setRecords(nextRecords);
      saveLocalRecords(storageKey, nextRecords);
      setEditingRecord(null);
      toast.success("OPCR record updated.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update OPCR record.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (record) => {
    const members = record?.kpis || [record];
    const recordId = record?.id;
    if (!recordId) return;

    const confirmation = await Swal.fire({
      title: "Archive OPCR form?",
      text: `This will move the OPCR form and its ${members.length} KPI(s) to the Archive page.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Archive",
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
        await archiveOpcrRecord(member.id);
        remaining = remaining.filter((item) => String(item.id) !== String(member.id));
      }
      setFormPreviewRecord(null);
      toast.success("OPCR form archived.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to archive all KPIs. Remaining entries are still shown.");
    } finally {
      setRecords(remaining);
      saveLocalRecords(storageKey, remaining);
      setArchivingId(null);
    }
  };

  const handleRestore = async (record) => {
    const members = record?.kpis || [record];
    const recordId = record?.id;
    if (!recordId || !window.confirm(`Restore this OPCR form and its ${members.length} KPI(s)?`)) return;
    setArchivingId(recordId);
    let remaining = records;
    try {
      for (const member of members) {
        await restoreOpcrRecord(member.id);
        remaining = remaining.filter((item) => String(item.id) !== String(member.id));
      }
      setFormPreviewRecord(null);
      toast.success("OPCR form restored.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to restore all KPIs. Remaining entries are still shown.");
    } finally {
      setRecords(remaining);
      setArchivingId(null);
    }
  };

  const handleArchiveViewToggle = (nextArchiveView) => {
    setArchiveView(nextArchiveView);
    setRecords(nextArchiveView ? [] : loadLocalRecords(storageKey, cacheDivision));
    setActiveTab("form");
    setQuery("");
    setDivisionFilter("");
    setStatusFilter("all");
    void loadRecords({ archived: nextArchiveView });
  };

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
        stop(`Tell the division chief what to fix in KPI ${position} before returning it.`, `opcr-rating-${key}-return-note`);
        return;
      }
      if (form.decision === "validate" && (record.verificationFiles?.length || 0) === 0) {
        stop(`KPI ${position} has no MOV to validate. Return it to the division chief instead.`);
        return;
      }
      if (form.decision === "validate" && !hasCompleteScores(form)) {
        stop(`Ratings must be from 1 to 5. Complete all three scores for KPI ${position}.`, `opcr-rating-${key}-q1Rating`);
        return;
      }
    }

    const decisions = pending.map((record) => {
      const form = ratingForms[ratingKey(record)];
      if (form.decision === "return") {
        return { assignment_id: record.assignmentId, decision: "return", remarks: form.returnNote.trim() };
      }
      return {
        assignment_id: record.assignmentId,
        decision: "validate",
        q1_rating: ratingNumber(form.q1Rating),
        e2_rating: ratingNumber(form.e2Rating),
        t3_rating: ratingNumber(form.t3Rating),
        remarks: form.remarks.trim(),
      };
    });

    setSaving(true);
    try {
      const response = await validateOpcrRecords(decisions);
      const fromServer = new Map((response?.records || []).map(normalizeRecord).map((record) => [ratingKey(record), record]));
      // Without records in the response (the offline cache), the decision is applied locally.
      applySavedRecords(pending.map((record, index) => {
        const key = ratingKey(record);
        const decision = decisions[index];
        if (fromServer.has(key)) return fromServer.get(key);
        if (decision.decision === "return") {
          return normalizeRecord({
            ...record,
            status: "Returned",
            approvalRemarks: decision.remarks,
            q1Rating: null,
            e2Rating: null,
            t3Rating: null,
            a4Rating: null,
            finalRating: null,
          });
        }
        const average = Number(((decision.q1_rating + decision.e2_rating + decision.t3_rating) / 3).toFixed(2));
        return normalizeRecord({
          ...record,
          status: "Rated",
          remarks: decision.remarks,
          q1Rating: decision.q1_rating,
          e2Rating: decision.e2_rating,
          t3Rating: decision.t3_rating,
          a4Rating: average,
          finalRating: average,
        });
      }));

      const returned = decisions.filter((decision) => decision.decision === "return").length;
      const validated = decisions.length - returned;
      toast.success(response?.message || (returned === 0
        ? `${validated} OPCR KPI${validated === 1 ? "" : "s"} validated.`
        : `${validated} validated, ${returned} returned to the division chief.`));
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
      key: "accountable",
      header: "Accountable Division",
      cardRole: "title",
      render: (record) => (
        <EntityCell
          icon={Building2}
          title={text(record.accountableName)}
          meta={text(record.opcrNo, "OPCR form")}
        />
      ),
    },
    { key: "period", header: "Period", cardRole: "subtitle", render: (record) => <MetaChip icon={CalendarDays}>{periodLabel(record)}</MetaChip> },
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
    { key: "budget", header: "Budget", render: (record) => <span className="tabular-nums text-slate-700">{currency(record.budget)}</span> },
    { key: "overall", header: "Overall Rating", render: (record) => <RatingPill value={averageRating(record)} size="sm" /> },
    { key: "status", header: "Status", cardRole: "badge", render: (record) => <StatusBadge status={record.status} fallback="Assigned" /> },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (record) => (
        <div className="flex flex-wrap items-center gap-2">
          <ActionIconButton
            label="View OPCR form"
            icon={faEye}
            tone="view"
            onClick={() => setFormPreviewRecord(record)}
          />
          {archiveView ? (
            <ActionIconButton
              label="Restore OPCR form"
              icon={faRotateLeft}
              tone="restore"
              text="Restore"
              disabled={String(archivingId) === String(record.assignmentId || record.id)}
              onClick={() => handleRestore(record)}
            />
          ) : (
            <>
              {/*
                * The form's next step for whoever holds this desk: the chief submits (or revises a
                * returned KPI), the Regional Director validates, and anyone else reads the MOVs.
                */}
              {isChief ? (
                formStage(record) === "validated" ? (
                  <ActionIconButton
                    label="View submitted accomplishment and MOVs"
                    icon={faPaperclip}
                    tone="view"
                    text="MOVs"
                    onClick={() => openSubmission(record)}
                  />
                ) : (
                  <ActionIconButton
                    label={formStage(record) === "returned" ? "Revise and resubmit accomplishment" : "Submit accomplishment and MOVs"}
                    icon={faPaperPlane}
                    tone="review"
                    text={formStage(record) === "returned" ? "Revise" : "Submit"}
                    onClick={() => openSubmission(record)}
                  />
                )
              ) : canValidate ? (
                <ActionIconButton
                  label="Validate OPCR accomplishments"
                  icon={faCircleCheck}
                  tone="review"
                  text="Validate"
                  onClick={() => openVerification(record)}
                />
              ) : (
                <ActionIconButton
                  label="View accomplishments and MOVs"
                  icon={faPaperclip}
                  tone="view"
                  text="MOVs"
                  onClick={() => openVerification(record)}
                />
              )}
              {canManage ? (
                <>
                  <ActionIconButton
                    label="Edit OPCR form"
                    icon={faPen}
                    tone="edit"
                    onClick={() => openEdit(record)}
                  />
                  <ActionIconButton
                    label="Archive OPCR form"
                    icon={faBoxArchive}
                    tone="archive"
                    disabled={String(archivingId) === String(record.assignmentId || record.id)}
                    onClick={() => handleArchive(record)}
                  />
                </>
              ) : null}
            </>
          )}
        </div>
      ),
    },
  ];

  const summaryColumns = [
    { key: "opcrNo", header: "OPCR No.", cardRole: "eyebrow", render: (record) => text(record.opcrNo) },
    {
      key: "accountable",
      header: "Accountable Division",
      cardRole: "title",
      render: (record) => <EntityCell icon={Building2} title={text(record.accountableName)} meta={periodLabel(record)} />,
    },
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
        ? "No archived OPCR forms."
        : isChief
        ? "No OPCR forms are assigned to your division yet."
        : "No OPCR forms available yet.",
      emptyDescription: filtering
        ? "No OPCR forms match your search or filters."
        : archiveView
        ? "Archived forms will appear here."
        : isChief
        ? "Forms appear here once the HR Head assigns KPIs to your division."
        : isDirector
        ? "Forms appear here once the HR Head assigns KPIs to a division; you validate them after the chief submits."
        : "Forms appear here once KPIs are assigned to a division.",
      tableClassName: "min-w-[980px]",
    },
    summary: {
      columns: summaryColumns,
      data: filteredRecords,
      emptyMessage: "No validated OPCR records yet.",
      emptyDescription: filtering
        ? "No OPCR forms match your search or filters."
        : "Ratings appear here once the Regional Director validates the KPIs.",
      tableClassName: "min-w-[1500px]",
    },
  };
  const visibleTabs = archiveView ? [{ key: "form", label: "Archived OPCR" }] : tabs;
  const activePanel = panels[activeTab] || panels.form;
  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(activePanel.data.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = activePanel.data.slice((safePage - 1) * pageSize, safePage * pageSize);
  const stageCounts = records.reduce((counts, record) => {
    counts[kpiStatus(record)] += 1;
    return counts;
  }, { assigned: 0, submitted: 0, returned: 0, rated: 0 });
  const validatedShare = records.length > 0 ? Math.round((stageCounts.rated / records.length) * 100) : 0;
  // The Regional Director's register spans every division that has a form, not a roster.
  const divisionCount = isDirector
    ? new Set(records.map((record) => String(record.division || "").trim().toLowerCase()).filter(Boolean)).size
    : accountableOptions.length;
  const performanceMetrics = [
    {
      label: "Accountable divisions",
      value: divisionCount,
      icon: Building2,
      accent: "accent",
      sub: isChief ? text(chiefDivision, "Your division") : isDirector ? "Divisions with OPCR forms" : "Divisions on the roster",
    },
    {
      label: "KPI records",
      value: records.length,
      icon: ListChecks,
      accent: "sky",
      sub: `${formRecords.length} OPCR form${formRecords.length === 1 ? "" : "s"}`,
    },
    isChief
      ? {
          label: "To submit",
          value: stageCounts.assigned + stageCounts.returned,
          icon: Clock3,
          accent: "amber",
          sub: stageCounts.returned > 0
            ? `${stageCounts.returned} returned for revision`
            : `${stageCounts.submitted} with the Regional Director`,
        }
      : {
          label: "Awaiting validation",
          value: stageCounts.submitted,
          icon: Clock3,
          accent: "amber",
          sub: stageCounts.returned > 0
            ? `${stageCounts.returned} returned to the chiefs`
            : "Submitted, not yet validated",
        },
    {
      label: "Validated",
      value: stageCounts.rated,
      icon: CheckCircle2,
      accent: "emerald",
      sub: `${validatedShare}% of KPI records`,
    },
  ];
  const statusOptions = STATUS_FILTERS.map((option) => ({ ...option, count: statusCounts[option.value] }));

  // The validation dialog's header: the form it belongs to, and its totals across every KPI card.
  const verificationHead = verificationKpis[0] || null;
  /*
   * A card counts as scored once it is validated or the Regional Director has picked Validate on
   * it; a card being returned gets no score.
   */
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
  const awaitingCount = verificationKpis.filter((record) => kpiStatus(record) === "submitted").length;
  const validatedCount = verificationKpis.filter((record) => kpiStatus(record) === "rated").length;
  const formProjectedAverage = projectedAverage(ratingEntries);
  const evidenceCount = verificationKpis.reduce((sum, record) => sum + (record.verificationFiles?.length || 0), 0);

  // The submission dialog's header and footer totals.
  const submissionHead = submissionView[0] || null;
  const submissionPendingCount = submissionView.filter(isSubmissionChanged).length;
  const submissionSentCount = submissionView.filter((record) => ["submitted", "rated"].includes(kpiStatus(record))).length;
  const submissionReturnedCount = submissionView.filter((record) => kpiStatus(record) === "returned").length;
  const submissionFileCount = submissionView.reduce((sum, record) => sum + (record.verificationFiles?.length || 0), 0);
  const submissionLocked = submissionView.length > 0 && submissionView.every((record) => kpiStatus(record) === "rated");

  const formPreviewRows = useMemo(() => {
    if (!formPreviewRecord) return [];
    return orderOpcrFormRows(records.filter((record) => sameOpcrForm(record, formPreviewRecord)));
  }, [formPreviewRecord, records]);

  return (
    <section className="performance-hub w-full space-y-5">
      <PerformanceWorkspaceHeader
        title={archiveView ? "Archived Office Performance Commitment & Review" : "Office Performance Commitment & Review"}
        description={archiveView
          ? "Review archived OPCR forms and restore any form that should return to the active register."
          : isChief
          ? "Work the OPCR forms assigned to your division: write each KPI's actual accomplishment, attach the MOVs, and submit them to the Regional Director for validation."
          : isDirector
          ? "Check the accomplishments and MOVs the division chiefs submit, then validate and rate each KPI or return it to the chief for revision."
          : canAssign
          ? "Assign office-wide commitments to divisions and follow each form through the chief's submission and the Regional Director's validation."
          : "Review the office-wide commitments assigned to each division and follow them through validation."}
        icon={Building2}
        metrics={performanceMetrics}
        loading={loading}
        // How the workflow works is read first, above the counts and the register.
        intro={archiveView ? null : <WorkflowGuide title="How the OPCR workflow works" steps={WORKFLOW_STEPS} />}
        action={(
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {canManage ? (
              <ArchiveViewToggle
                archiveView={archiveView}
                onToggle={handleArchiveViewToggle}
                label="OPCR records"
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
            layoutId="opcr-tab-indicator"
            ariaLabel="OPCR sections"
          />
          <p className="m-0 shrink-0 text-sm text-slate-500">
            <strong className="font-semibold tabular-nums text-slate-800">{activePanel.data.length}</strong>{" "}
            {activePanel.data.length === 1 ? "form" : "forms"}
          </p>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <HubSearch
              label="Search OPCR"
              name="opcrSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by OPCR No., division, KPI, period or status…"
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
                  {divisionOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
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
        description="Choose the accountable divisions, then describe each KPI and its success indicators."
        onClose={() => setBulkOpen(false)}
        maxWidth="max-w-[1280px]"
        maxHeight="max-h-[94dvh]"
        contentClassName="p-0 sm:p-0 lg:!overflow-hidden"
        footerClassName="justify-between"
        footer={(
          <>
            <p className="m-0 text-xs text-slate-500">
              {selectedCount === 0
                ? "Select at least one division to assign."
                : `${selectedCount} division${selectedCount === 1 ? "" : "s"} selected`}
            </p>
            <HubButton type="submit" form="opcr-bulk-assign-form" icon={CheckCircle2} loading={saving} disabled={selectedCount === 0}>
              Assign KPI
            </HubButton>
          </>
        )}
      >
        <form
          id="opcr-bulk-assign-form"
          className="grid min-h-0 lg:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.35fr)]"
          onSubmit={handleBulkSubmit}
        >
          <KpiAssignmentTargetPicker
            description={isChief
              ? "Select your division to make it accountable for these KPIs."
              : "Select the divisions accountable for these KPIs."}
            query={assignmentQuery}
            onQueryChange={setAssignmentQuery}
            searchPlaceholder="Search divisions"
            divisionFilter={isChief ? chiefDivision : assignmentDivisionFilter}
            onDivisionFilterChange={setAssignmentDivisionFilter}
            divisions={isChief ? [chiefDivision].filter(Boolean) : divisionOptions}
            divisionLocked={isChief}
            items={tableRows}
            selectedCount={selectedCount}
            allVisibleSelected={allVisibleSelected}
            onToggleAll={toggleAllVisible}
            isSelected={(item) => selectedAccountableIds.includes(item.id)}
            onToggle={(item) => toggleAccountable(item.id)}
            itemKey={(item) => item.id}
            itemTitle={(item) => item.label}
            itemMeta={(item) => item.sublabel}
            itemDetail={(item) => item.latestOpcr
              ? `Current KPI: ${text(item.latestOpcr.kpiTitle || item.latestOpcr.output)}`
              : "No KPI assigned"}
            emptyMessage="No divisions match your filters."
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
                label="Period"
                name="opcrPeriod"
                value={bulkForm.period}
                onChange={(event) => setBulkForm((form) => ({ ...form, period: event.target.value }))}
                placeholder={`FY ${currentYear}`}
                required
              />
              <div className="w-full">
                <label htmlFor="opcrSemester" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Semester
                </label>
                <div className="relative flex min-h-[40px] items-center rounded-lg border border-slate-200 bg-white">
                  <select
                    id="opcrSemester"
                    name="opcrSemester"
                    value={bulkForm.semester}
                    onChange={(event) => setBulkForm((form) => ({ ...form, semester: event.target.value }))}
                    className="w-full rounded-lg bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-accent-500/15"
                    required
                  >
                    {SEMESTER_OPTIONS.map((semester) => (
                      <option key={semester} value={semester}>{semester}</option>
                    ))}
                  </select>
                </div>
              </div>
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
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
                    <InputField
                      label="Output"
                      id={`${kpi.uid}-title`}
                      name={`${kpi.uid}-title`}
                      value={kpi.kpiTitle}
                      onChange={(event) => updateBulkKpi(kpi.uid, { kpiTitle: event.target.value })}
                      placeholder="OO/PAP, e.g. Mineral Reservation Program"
                      required
                    />
                    {/* opcr_templates.category is VARCHAR(150), so a typed category is held to that. */}
                    <KpiCategoryField
                      id={`${kpi.uid}-category`}
                      name={`${kpi.uid}-category`}
                      value={kpi.category}
                      options={OPCR_CATEGORY_OPTIONS}
                      onChange={(category) => updateBulkKpi(kpi.uid, { category })}
                      maxLength={150}
                      required
                    />
                  </div>
                  {/*
                    * The sub-heading the printed form carries under the category band and above the
                    * output rows -- "Mining Investment Promotion" under the enforcement program.
                    * Optional: an output with none sits directly under its category.
                    */}
                  <InputField
                    label="Sub-category"
                    id={`${kpi.uid}-sub-category`}
                    name={`${kpi.uid}-sub-category`}
                    value={kpi.subCategory}
                    onChange={(event) => updateBulkKpi(kpi.uid, { subCategory: event.target.value })}
                    placeholder="Optional, e.g. Mining Investment Promotion"
                    maxLength={255}
                  />
                  {/*
                    * One row per indicator on the printed form, all beside the same OO/PAP, each
                    * with the form's two columns: the fiscal-year target and the semester target.
                    */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="block text-sm font-semibold text-slate-700">Success Indicators</span>
                      <span className="text-xs font-medium text-slate-500">
                        {kpi.indicators.length > 1 ? `${kpi.indicators.length} rows` : null}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {kpi.indicators.map((row, rowIndex) => {
                        const fiscalYear = text(bulkForm.period, "Fiscal year");
                        const semester = text(bulkForm.semester, "Semester");
                        return (
                          <div key={row.uid} className="flex items-start gap-2">
                            <span className="mt-7 w-5 shrink-0 text-right text-xs font-bold text-slate-400">{rowIndex + 1}.</span>
                            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                              <div>
                                <label htmlFor={`${row.uid}-target`} className="mb-1 block text-xs font-semibold text-slate-600">
                                  {fiscalYear}
                                </label>
                                <textarea
                                  id={`${row.uid}-target`}
                                  aria-label={`Success Indicator ${rowIndex + 1} (${fiscalYear})`}
                                  value={row.target}
                                  onChange={(event) => updateBulkIndicator(kpi.uid, row.uid, { target: event.target.value })}
                                  placeholder="Target + measure, e.g. 1 New Mineral Reservation area assessed/endorsed for declaration by end of December"
                                  rows={3}
                                  required
                                  disabled={saving}
                                  className={hubFieldClass}
                                />
                              </div>
                              <div>
                                <label htmlFor={`${row.uid}-semester-target`} className="mb-1 block text-xs font-semibold text-slate-600">
                                  {semester}
                                </label>
                                <textarea
                                  id={`${row.uid}-semester-target`}
                                  aria-label={`Success Indicator ${rowIndex + 1} (${semester})`}
                                  value={row.semesterTarget}
                                  onChange={(event) => updateBulkIndicator(kpi.uid, row.uid, { semesterTarget: event.target.value })}
                                  placeholder={`Leave blank to print "NO TARGET FOR ${semester.toUpperCase()}"`}
                                  rows={3}
                                  disabled={saving}
                                  className={hubFieldClass}
                                />
                              </div>
                            </div>
                            {kpi.indicators.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => removeBulkIndicator(kpi.uid, row.uid)}
                                disabled={saving}
                                aria-label={`Remove success indicator ${rowIndex + 1}`}
                                title="Remove"
                                className="mt-6 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                              >
                                <X size={14} aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
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
                  <InputField
                    label="Budget"
                    id={`${kpi.uid}-budget`}
                    name={`${kpi.uid}-budget`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={kpi.budget}
                    onChange={(event) => updateBulkKpi(kpi.uid, { budget: event.target.value })}
                    placeholder="0.00"
                    className="md:max-w-[260px]"
                  />
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
        title="Edit OPCR Record"
        onClose={() => setEditingRecord(null)}
        maxWidth="max-w-2xl"
        footer={(
          <>
            <HubButton variant="outline" onClick={() => setEditingRecord(null)} disabled={saving}>
              Cancel
            </HubButton>
            <HubButton type="submit" form="opcr-edit-form" icon={CheckCircle2} loading={saving}>
              Save Changes
            </HubButton>
          </>
        )}
      >
        <form id="opcr-edit-form" className="space-y-4" onSubmit={handleEditSubmit}>
          <KpiFormSelector id="opcr-edit-kpi" records={editingRecord ? records.filter((record) => sameOpcrForm(record, editingRecord)) : []} selected={editingRecord} onSelect={openEdit} disabled={saving} />
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800">
            <EntityCell
              icon={Building2}
              title={editingRecord?.accountableName || editingRecord?.division || "Unassigned"}
              meta={[editingRecord?.opcrNo, editingRecord?.division].filter(Boolean).join(" · ") || "Accountable Division"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Period"
              name="opcrEditPeriod"
              value={editForm.period}
              onChange={(event) => setEditForm((form) => ({ ...form, period: event.target.value }))}
              required
            />
            <div>
              <label htmlFor="opcrEditSemester" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Semester
              </label>
              <select
                id="opcrEditSemester"
                value={editForm.semester}
                onChange={(event) => setEditForm((form) => ({ ...form, semester: event.target.value }))}
                className={`h-10 ${hubSelectClass}`}
                required
              >
                {SEMESTER_OPTIONS.map((semester) => (
                  <option key={semester} value={semester}>{semester}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <InputField
              label="Output"
              name="opcrEditOutput"
              value={editForm.output}
              onChange={(event) => setEditForm((form) => ({ ...form, output: event.target.value }))}
              required
            />
            <InputField
              label="Category"
              name="opcrEditCategory"
              value={editForm.category}
              onChange={(event) => setEditForm((form) => ({ ...form, category: event.target.value }))}
              required
            />
          </div>

          <InputField
            label="Sub-category"
            name="opcrEditSubCategory"
            value={editForm.subCategory}
            onChange={(event) => setEditForm((form) => ({ ...form, subCategory: event.target.value }))}
            placeholder="Optional, e.g. Mining Investment Promotion"
            maxLength={255}
          />

          {/* One record is one printed row, so it carries the form's two indicator columns. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="opcrEditSuccessIndicator" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Success Indicator ({text(editForm.period, "Fiscal year")})
              </label>
              <textarea
                id="opcrEditSuccessIndicator"
                value={editForm.successIndicator}
                onChange={(event) => setEditForm((form) => ({ ...form, successIndicator: event.target.value }))}
                rows={3}
                required
                disabled={saving}
                className={hubFieldClass}
              />
            </div>
            <div>
              <label htmlFor="opcrEditSemesterIndicator" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Success Indicator ({text(editForm.semester, "Semester")})
              </label>
              <textarea
                id="opcrEditSemesterIndicator"
                value={editForm.semesterIndicator}
                onChange={(event) => setEditForm((form) => ({ ...form, semesterIndicator: event.target.value }))}
                placeholder={`Leave blank to print "${noSemesterTarget(editForm)}"`}
                rows={3}
                disabled={saving}
                className={hubFieldClass}
              />
            </div>
          </div>

          <InputField
            label="Budget"
            name="opcrEditBudget"
            type="number"
            min="0"
            step="0.01"
            value={editForm.budget}
            onChange={(event) => setEditForm((form) => ({ ...form, budget: event.target.value }))}
            className="sm:max-w-[260px]"
          />

          <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            Changes to the selected KPI and its period apply to every division assigned that KPI template.
          </p>
        </form>
      </Modal>

      <Modal
        open={verificationKpis.length > 0}
        title={canValidate ? "Validate OPCR Accomplishments" : "OPCR Accomplishments & MOVs"}
        description={canValidate
          ? "Check each KPI's accomplishment against its MOVs, then validate and rate it or return it to the division chief."
          : "What the division chief submitted for each KPI, and where it stands in the Regional Director's validation."}
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
                : `${validatedCount} of ${verificationKpis.length} KPI${verificationKpis.length === 1 ? "" : "s"} validated.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <HubButton variant="outline" onClick={closeVerification} disabled={saving}>
                Close
              </HubButton>
              {canValidate ? (
                <HubButton icon={faCircleCheck} onClick={handleValidate} loading={saving}>
                  Save decisions
                </HubButton>
              ) : null}
            </div>
          </>
        )}
      >
        <div className="space-y-4 p-4 sm:p-5">
          <FormDialogHeading
            record={verificationHead}
            stats={[
              { label: "KPIs", value: verificationKpis.length },
              { label: "Validated", value: `${validatedCount}/${verificationKpis.length}` },
              { label: "Form average", value: <span className="mt-0.5 block"><RatingPill value={formProjectedAverage} size="sm" showLabel={false} /></span> },
              { label: "MOVs", value: `${evidenceCount} file${evidenceCount === 1 ? "" : "s"}` },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0 space-y-4">
              {verificationKpis.map((record, index) => {
                const key = ratingKey(record);
                const form = ratingForms[key] || createRatingForm(record);
                const prefix = `opcr-rating-${key}`;
                const files = record.verificationFiles || [];
                const stage = kpiStatus(record);
                const reviewable = canValidate && isReviewable(record);
                const returning = form.decision === "return";
                const submittedLine = [
                  record.submittedByName ? `Submitted by ${record.submittedByName}` : "",
                  record.submittedAt ? String(record.submittedAt).slice(0, 16) : "",
                ].filter(Boolean).join(" · ");

                return (
                  <KpiRatingCard
                    key={key}
                    id={`opcr-rating-card-${key}`}
                    index={index}
                    title={text(record.kpiTitle || record.output)}
                    subtitle={[record.category, record.subCategory].filter(Boolean).join(" · ")}
                    tags={(
                      <>
                        <StatusBadge status={KPI_STAGE_LABELS[stage]} />
                        {Number(record.budget) > 0 ? <MetaChip>Budget {currency(record.budget)}</MetaChip> : null}
                      </>
                    )}
                    savedScore={stage === "rated" ? summaryAverage(record) : 0}
                    form={form}
                    onChange={(changes) => updateRatingForm(key, changes)}
                    disabled={saving}
                    idPrefix={prefix}
                    showScores={reviewable && !returning}
                    details={(
                      <>
                        <SuccessIndicatorPair record={record} />
                        <div className="rounded-lg border border-accent-200 bg-accent-50/40 p-3 dark:border-accent-900 dark:bg-accent-950/20">
                          <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-400">
                            <CheckCircle2 size={12} aria-hidden="true" />
                            Division chief's accomplishment
                          </p>
                          <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">
                            {text(record.actualAccomplishment, "No accomplishment submitted yet.")}
                          </p>
                          {submittedLine ? <p className="m-0 mt-1.5 text-[11px] text-slate-500">{submittedLine}</p> : null}
                        </div>
                        <ReturnNote record={record} current={stage === "returned"} />
                        <div>
                          <p className="m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            <Paperclip size={12} aria-hidden="true" />
                            Submitted MOVs · {files.length} file{files.length === 1 ? "" : "s"}
                          </p>
                          {files.length > 0 ? (
                            <MovFileList files={files} />
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
                              : "Validate sets the scores below as the KPI's rating. Return sends it back to the division chief with your note."}
                          </p>
                        </fieldset>
                        {returning ? (
                          <div>
                            <label htmlFor={`${prefix}-return-note`} className="mb-1.5 block text-sm font-semibold text-slate-700">
                              What should the division chief fix?
                            </label>
                            <textarea
                              id={`${prefix}-return-note`}
                              value={form.returnNote}
                              onChange={(event) => updateRatingForm(key, { returnNote: event.target.value })}
                              rows={3}
                              disabled={saving}
                              placeholder="e.g. The endorsement letter is unsigned. Upload the signed copy."
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
                              placeholder="Validation notes, printed in the Remarks column of the OPCR form."
                              className={`resize-y ${hubFieldClass}`}
                            />
                          </div>
                        )}
                      </>
                    ) : stage === "rated" ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
                        <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                          <Lock size={12} aria-hidden="true" />
                          Validated{record.reviewedByName ? ` by ${record.reviewedByName}` : ""}
                        </p>
                        <p className="m-0 mt-1 text-[13px] text-slate-700">
                          Quantity {ratingNumber(record.q1Rating).toFixed(2)} · Efficiency {ratingNumber(record.e2Rating).toFixed(2)} · Timeliness {ratingNumber(record.t3Rating).toFixed(2)}
                        </p>
                        {text(record.remarks, "") ? (
                          <p className="m-0 mt-1 whitespace-pre-line text-[13px] text-slate-600">Remarks: {record.remarks}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="m-0 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500 dark:border-slate-700">
                        {stage === "returned"
                          ? "Returned to the division chief for revision. It comes back for validation once they submit it again."
                          : stage === "submitted"
                          ? "Submitted by the division chief and waiting for the Regional Director's validation."
                          : "Not submitted yet. The accomplishment and MOVs appear here once the division chief submits this KPI."}
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
        open={submissionKpis.length > 0}
        title={submissionLocked ? "Submitted Accomplishments" : "Submit Accomplishments"}
        description={submissionLocked
          ? "The Regional Director validated every KPI in this form, so it is locked."
          : "Write each KPI's actual accomplishment and attach its MOVs, then submit them to the Regional Director for validation."}
        onClose={closeSubmission}
        maxWidth="max-w-[1180px]"
        maxHeight="max-h-[94dvh]"
        panelClassName="rounded-xl"
        contentClassName="bg-slate-50 p-0"
        footerClassName="justify-between bg-white"
        footer={(
          <>
            <p className="m-0 text-xs text-slate-500">
              {submissionPendingCount > 0
                ? `${submissionPendingCount} KPI${submissionPendingCount === 1 ? "" : "s"} with unsaved changes.`
                : submissionReturnedCount > 0
                ? `${submissionReturnedCount} KPI${submissionReturnedCount === 1 ? "" : "s"} returned for revision.`
                : "No unsaved changes."}
            </p>
            <div className="flex flex-wrap gap-2">
              <HubButton variant="outline" onClick={closeSubmission} disabled={saving}>
                Close
              </HubButton>
              {submissionLocked ? null : (
                <HubButton icon={Send} onClick={handleSubmitAccomplishment} loading={saving} disabled={submissionPendingCount === 0}>
                  Submit to Regional Director
                </HubButton>
              )}
            </div>
          </>
        )}
      >
        <div className="space-y-4 p-4 sm:p-5">
          <FormDialogHeading
            record={submissionHead}
            stats={[
              { label: "KPIs", value: submissionView.length },
              { label: "Submitted", value: `${submissionSentCount}/${submissionView.length}` },
              { label: "Returned", value: submissionReturnedCount },
              { label: "MOVs", value: `${submissionFileCount} file${submissionFileCount === 1 ? "" : "s"}` },
            ]}
          />

          {submissionView.map((record, index) => {
            const key = ratingKey(record);
            const prefix = `opcr-submit-${key}`;
            const stage = kpiStatus(record);
            const locked = stage === "rated";
            const changed = isSubmissionChanged(record);
            const pickedFiles = pickedFilesOf(record);
            const savedFiles = record.verificationFiles || [];

            return (
              <KpiRatingCard
                key={key}
                id={`opcr-submit-card-${key}`}
                index={index}
                title={text(record.kpiTitle || record.output)}
                subtitle={[record.category, record.subCategory].filter(Boolean).join(" · ")}
                tags={(
                  <>
                    <StatusBadge status={KPI_STAGE_LABELS[stage]} />
                    {Number(record.budget) > 0 ? <MetaChip>Budget {currency(record.budget)}</MetaChip> : null}
                  </>
                )}
                savedScore={locked ? summaryAverage(record) : 0}
                form={{ dirty: changed }}
                onChange={() => {}}
                disabled={saving}
                idPrefix={prefix}
                showScores={false}
                details={(
                  <>
                    <SuccessIndicatorPair record={record} highlight />
                    <ReturnNote record={record} current={stage === "returned"} />
                    {locked ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
                        <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                          <Lock size={12} aria-hidden="true" />
                          Validated{record.reviewedByName ? ` by ${record.reviewedByName}` : ""} · locked
                        </p>
                        <p className="m-0 mt-1 text-[13px] text-slate-700">
                          Rating: Quantity {ratingNumber(record.q1Rating).toFixed(2)} · Efficiency {ratingNumber(record.e2Rating).toFixed(2)} · Timeliness {ratingNumber(record.t3Rating).toFixed(2)}
                        </p>
                        {text(record.remarks, "") ? (
                          <p className="m-0 mt-1 whitespace-pre-line text-[13px] text-slate-600">Remarks: {record.remarks}</p>
                        ) : null}
                      </div>
                    ) : stage === "submitted" && !changed ? (
                      <p className="m-0 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                        With the Regional Director for validation. You can still change it and submit it again until it is validated.
                      </p>
                    ) : null}
                    {savedFiles.length > 0 ? (
                      <div>
                        <p className="m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <Paperclip size={12} aria-hidden="true" />
                          Uploaded MOVs · {savedFiles.length} file{savedFiles.length === 1 ? "" : "s"}
                        </p>
                        <MovFileList
                          files={savedFiles}
                          onRemove={locked ? null : (file) => removeSavedFile(record, file)}
                          removingFileId={removingFileId}
                          disabled={saving}
                        />
                      </div>
                    ) : null}
                  </>
                )}
                fields={(
                  <>
                    <div>
                      <label htmlFor={`${prefix}-accomplishment`} className="mb-1.5 block text-sm font-semibold text-slate-700">
                        Actual Accomplishment
                      </label>
                      <textarea
                        id={`${prefix}-accomplishment`}
                        value={accomplishmentOf(record)}
                        onChange={(event) => updateSubmissionDraft(record, { actualAccomplishment: event.target.value })}
                        rows={4}
                        disabled={saving || locked}
                        placeholder="What did the division actually accomplish against this KPI?"
                        className={`resize-y ${hubFieldClass}`}
                      />
                    </div>

                    {locked ? null : (
                      <div>
                        <label
                          htmlFor={`${prefix}-files`}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-accent-400 hover:bg-accent-50/60 dark:border-slate-700"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <UploadCloud size={16} className="shrink-0 text-accent-600" aria-hidden="true" />
                            Attach MOVs
                          </span>
                          <span className="shrink-0 text-[11px] font-medium text-slate-400">PDF, Word, Excel, PNG, JPG</span>
                        </label>
                        <input
                          id={`${prefix}-files`}
                          type="file"
                          aria-label="Attach MOVs"
                          multiple
                          disabled={saving}
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                          className="sr-only"
                          onChange={(event) => {
                            addSubmissionFiles(record, event.target.files);
                            event.target.value = "";
                          }}
                        />
                        {pickedFiles.length > 0 ? (
                          <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
                            {pickedFiles.map((file) => (
                              <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-accent-200 bg-accent-50/40 px-3 py-1.5 text-sm text-slate-700 dark:border-accent-900">
                                <Paperclip size={14} className="shrink-0 text-accent-600" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                                <span className="shrink-0 text-xs text-slate-500">{fileSizeLabel(file.size)}</span>
                                <button
                                  type="button"
                                  onClick={() => removePickedFile(record, file)}
                                  disabled={saving}
                                  aria-label={`Remove ${file.name}`}
                                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                                >
                                  <X size={14} aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : savedFiles.length === 0 ? (
                          <p className="m-0 mt-1.5 text-xs text-slate-500">At least one MOV is required to submit this KPI.</p>
                        ) : null}
                      </div>
                    )}

                    {changed ? (
                      <button
                        type="button"
                        onClick={() => discardSubmissionDraft(record)}
                        disabled={saving}
                        className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-slate-800 hover:underline"
                      >
                        Undo changes to this KPI
                      </button>
                    ) : null}
                  </>
                )}
              />
            );
          })}
        </div>
      </Modal>

      <Modal
        open={Boolean(formPreviewRecord)}
        title="OPCR Form Preview"
        description={formPreviewRecord ? `${text(formPreviewRecord.accountableName)} · ${periodLabel(formPreviewRecord)}` : undefined}
        onClose={() => setFormPreviewRecord(null)}
        maxWidth="max-w-[96vw]"
        panelClassName="rounded-xl"
        contentClassName="bg-slate-100 p-4"
        footer={archiveView ? null : (
          <HubButton
            icon={Download}
            loading={exportingFormId === (formPreviewRecord?.assignmentId || formPreviewRecord?.id)}
            onClick={() => handleExportForm(formPreviewRecord)}
          >
            Export to Excel
          </HubButton>
        )}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
          <OpcrFormDocument record={formPreviewRecord} rows={formPreviewRows} />
        </div>
      </Modal>
    </section>
  );
}
