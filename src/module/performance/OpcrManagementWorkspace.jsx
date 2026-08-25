import React, { useCallback, useMemo, useState } from "react";
import {
  faCircleCheck,
  faEye,
} from "@fortawesome/free-solid-svg-icons";
import {
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Search,
  Upload,
  UsersRound,
} from "lucide-react";
import { toast } from "react-hot-toast";
import Button from "../../components/UI/button";
import Card, { CardContent } from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import KpiAssignmentTargetPicker from "./KpiAssignmentTargetPicker";
import PerformanceTabNav, { PerformanceTabPanel } from "./PerformanceTabNav";
import PerformanceWorkspaceHeader from "./PerformanceWorkspaceHeader";
import { PerformanceBandBadge, RatingScore, RemarksCell } from "./RatingSummaryCells";
import {
  createOpcr,
  fetchOpcrRecords,
  submitOpcrRating,
  uploadOpcrVerification,
} from "../../services/api";
import { exportOpcrForm } from "../../services/performanceExportService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

const STORAGE_KEY = "hris.performance.adminOpcrDrafts";

const tabs = [
  { key: "verification", label: "Verify & Rate" },
  { key: "form", label: "OPCR Form" },
  { key: "summary", label: "Ratings Summary" },
];

const currentYear = new Date().getFullYear();

// One assignment covers a single period and semester, so those stay shared while every KPI row
// inside it carries its own title, indicator, category, and budget.
let assignmentKpiSeq = 0;

function createAssignmentKpi() {
  assignmentKpiSeq += 1;
  return {
    uid: `opcr-kpi-${assignmentKpiSeq}`,
    kpiTitle: "",
    successIndicator: "",
    category: "Program",
    budget: "",
  };
}

function createDefaultAssignmentForm() {
  return {
    period: `FY ${currentYear}`,
    semester: "1st Semester",
    kpis: [createAssignmentKpi()],
  };
}

const defaultRatingForm = {
  actualAccomplishment: "",
  remarks: "",
  q1Rating: "",
  e2Rating: "",
  t3Rating: "",
  verificationFile: null,
};

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

function employeeName(employee) {
  return text(employee?.fullName || [employee?.firstName, employee?.middleName, employee?.lastName].filter(Boolean).join(" "));
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

function statusBadge(status) {
  const normalized = String(status || "Assigned").toLowerCase();
  const classes = normalized.includes("rated") || normalized.includes("approved")
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : normalized.includes("submitted") || normalized.includes("review")
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${classes}`}>
      {text(status, "Assigned")}
    </span>
  );
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
    category: record.category ?? record.kpiCategory ?? "Program",
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
    status: record.status ?? record.assignmentStatus ?? record.assignment_status ?? "Assigned",
  };
}

function sameOpcrForm(left, right) {
  if (left?.templateId && right?.templateId) {
    return String(left.templateId) === String(right.templateId);
  }

  return String(left?.period || "") === String(right?.period || "")
    && String(left?.semester || "") === String(right?.semester || "")
    && String(left?.output || left?.kpiTitle || "") === String(right?.output || right?.kpiTitle || "");
}

function OpcrFormDocument({ record, rows = [] }) {
  const formRows = rows.length > 0 ? rows : [record].filter(Boolean);
  const period = [record?.period, record?.semester].filter(Boolean).join(" - ") || "Rating Period";
  const rating = finalAverageRating(formRows);
  const headOfOffice = "FELIZARDO A. GACAD, JR.";
  const approvedBy = text(record?.approvedBy, "ATTY. WILFREDO G. MONCANO");
  const cell = "border-2 border-black px-2 py-2 align-top";
  const centerCell = `${cell} text-center`;
  const headerCell = `${cell} text-center font-bold`;
  const summaryLabel = `${cell} font-bold`;

  return (
    <div className="min-w-[2000px] border-2 border-black bg-white font-sans text-black">
      <div className="border-b-2 border-black p-2 text-center text-sm font-bold">
        OFFICE PERFORMANCE COMMITMENT AND REVIEW - MGB REGIONAL OFFICE
      </div>

      <table className="w-full table-fixed border-collapse text-[13px]">
        <tbody>
          <tr>
            <td className="w-[70%] border-b-2 border-black px-4 py-4 leading-6">
              I, <strong>{headOfOffice}</strong>, Head of the{" "}
              <strong>MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE No. X</strong>, commit to deliver and agree
              to be rated on the attainment of the following targets in accordance with the indicated measures
              for the period <strong>{period}.</strong>
            </td>
            <td className="w-[30%] border-b-2 border-l-2 border-black px-4 py-4 text-center">
              <div className="h-20" />
              <div className="inline-block border-t border-black px-3 pt-1 font-bold">{headOfOffice}</div>
              <div>Head of Office</div>
              <div className="mt-3">Date: __________</div>
            </td>
          </tr>
          <tr>
            <td className="w-[70%] border-b-2 border-black px-4 py-4 text-center">
              Approved by:
              <br />
              <br />
              <span className="font-bold underline">{approvedBy}</span>
              <br />
              Acting Director
            </td>
            <td className="w-[30%] border-b-2 border-l-2 border-black px-4 py-4">
              Date: {period}
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
          {formRows.map((item, index) => {
            const category = text(item.category, "Program").toUpperCase();
            return (
              <React.Fragment key={item.assignmentId || item.id || index}>
                {index === 0 || category !== text(formRows[index - 1]?.category, "Program").toUpperCase() ? (
                  <tr>
                    <td colSpan={11} className={`${cell} bg-[#f2f2f2] font-bold`}>
                      {category}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td className={`${cell} leading-5 font-bold`}>{text(item.output || item.kpiTitle)}</td>
                  <td className={`${cell} leading-5`}>{text(item.successIndicator)}</td>
                  <td className={`${cell} leading-5`}>{text(item.successIndicator)}</td>
                  <td className={centerCell}>{item.budget ? currency(item.budget) : ""}</td>
                  <td className={`${centerCell} leading-5`}>{text(item.accountableName)}</td>
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
            <td colSpan={3} className={`${cell} w-[33%]`}>
              Assessed by:
              <br />
              <br />
              <div className="text-center">
                <div className="font-bold">ENGR. TEODORICO A. SANDOVAL</div>
                <div>Chief, Planning, Policy and International Affairs Division</div>
              </div>
            </td>
            <td className={`${cell} w-[5%]`}>Date</td>
            <td colSpan={3} className={`${cell} w-[33%]`}>
              <br />
              <br />
              <div className="text-center">
                <div className="font-bold">ENGR. JUANCHO PABLO S. CALVEZ</div>
                <div>Chief, Metallurgical Technology Division<br />OIC, Assistant Director in concurrent capacity</div>
              </div>
            </td>
            <td className={`${cell} w-[5%]`}>Date</td>
            <td colSpan={3} className={`${cell} w-[33%]`}>
              Final Rating:
              <br />
              <br />
              <div className="text-center">
                <div className="font-bold">{approvedBy}</div>
                <div>Director</div>
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

function loadLocalRecords() {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeRecord) : [];
  } catch {
    return [];
  }
}

function saveLocalRecords(records) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export default function OpcrManagementWorkspace({ employees = [] }) {
  const [activeTab, setActiveTab] = useState("verification");
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [assignmentDivisionFilter, setAssignmentDivisionFilter] = useState("");
  const [selectedAccountableIds, setSelectedAccountableIds] = useState([]);
  const [records, setRecords] = useState(() => loadLocalRecords());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState(createDefaultAssignmentForm);
  const [verificationRecord, setVerificationRecord] = useState(null);
  const [formPreviewRecord, setFormPreviewRecord] = useState(null);
  const [exportingFormId, setExportingFormId] = useState(null);
  const [ratingForm, setRatingForm] = useState(defaultRatingForm);

  const accountableOptions = useMemo(() => {
    const divisions = new Map();
    employees.forEach((employee) => {
      const division = text(employee.department, "");
      if (division) {
        divisions.set(division.toLowerCase(), {
          id: `division:${division.toLowerCase()}`,
          type: "division",
          label: division,
          sublabel: "Division",
          division,
        });
      }
    });

    const individuals = employees.map((employee) => ({
      id: `individual:${employee.id}`,
      type: "individual",
      employeeId: employee.id,
      label: employeeName(employee),
      sublabel: [employee.position, employee.department].filter(Boolean).join(" - ") || "Individual",
      division: employee.department || "",
    }));

    return [...Array.from(divisions.values()).sort((left, right) => left.label.localeCompare(right.label)), ...individuals];
  }, [employees]);

  /*
   * Every division the workspace can show, taken from the roster AND from the records: a record
   * keeps the division it was raised under, so one raised for a division that has since been renamed
   * or emptied would otherwise be unreachable through the filter.
   */
  const divisionOptions = useMemo(() => {
    const names = new Set();

    employees.forEach((employee) => {
      const division = text(employee.department, "");
      if (division) names.add(division);
    });
    records.forEach((record) => {
      const division = text(record.division, "");
      if (division) names.add(division);
    });

    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [employees, records]);

  const filteredAccountables = useMemo(() => {
    const needle = assignmentQuery.trim().toLowerCase();

    return accountableOptions.filter((item) => {
      // A division row is itself the division; an individual row carries the one they belong to.
      if (assignmentDivisionFilter && text(item.division, "") !== assignmentDivisionFilter) {
        return false;
      }

      if (!needle) return true;

      return [
        item.label,
        item.sublabel,
        item.division,
        item.employeeId,
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

  const assignmentRows = useMemo(
    () => filteredAccountables.map((item) => ({
      ...item,
      latestOpcr: recordsByAccountable.get(item.id) || null,
    })),
    [filteredAccountables, recordsByAccountable]
  );

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return records.filter((record) => {
      if (divisionFilter && text(record.division, "") !== divisionFilter) {
        return false;
      }

      if (!needle) return true;

      return [
        record.opcrNo,
        record.accountableName,
        record.employeeName,
        record.division,
        record.kpiTitle,
        record.output,
        record.successIndicator,
        record.category,
        record.period,
        record.semester,
        record.status,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [divisionFilter, query, records]);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const response = await fetchOpcrRecords();
      const nextRecords = (response.records || response.opcrRecords || []).map(normalizeRecord);
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);
    } catch {
      // Falling back to the local cache is for a failed *first* load. A failed background poll
      // already has fresher records on screen than the cache holds, so it leaves them alone.
      if (!background) {
        setRecords(loadLocalRecords());
      }
    } finally {
      setLoading(false);
    }
  }, []);

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

  const openAssignment = () => {
    setAssignmentForm(createDefaultAssignmentForm());
    setAssignmentOpen(true);
  };

  const updateAssignmentKpi = (uid, changes) => {
    setAssignmentForm((form) => ({
      ...form,
      kpis: form.kpis.map((kpi) => (kpi.uid === uid ? { ...kpi, ...changes } : kpi)),
    }));
  };

  const addAssignmentKpi = () => {
    setAssignmentForm((form) => ({ ...form, kpis: [...form.kpis, createAssignmentKpi()] }));
  };

  // The form always keeps at least one KPI row, so the last one cannot be removed.
  const removeAssignmentKpi = (uid) => {
    setAssignmentForm((form) => (
      form.kpis.length <= 1
        ? form
        : { ...form, kpis: form.kpis.filter((kpi) => kpi.uid !== uid) }
    ));
  };

  const handleAssignmentSubmit = async (event) => {
    event.preventDefault();
    const kpis = assignmentForm.kpis.map((kpi) => ({
      output: kpi.kpiTitle.trim(),
      success_indicator: kpi.successIndicator.trim(),
      category: kpi.category.trim(),
      budget: kpi.budget,
    }));
    const targetIds = selectedAccountableIds;
    const targetItems = targetIds
      .map((id) => accountableOptions.find((item) => item.id === id))
      .filter(Boolean);

    const incompleteKpi = kpis.some((kpi) => !kpi.output || !kpi.success_indicator || !kpi.category);
    if (kpis.length === 0 || incompleteKpi || targetItems.length === 0) {
      toast.error("Complete every output, category, and success indicator, and select at least one accountable item.");
      return;
    }

    setSaving(true);
    try {
      const response = await createOpcr({
        accountable_items: targetItems.map((item) => ({
          type: item.type,
          employee_id: item.employeeId || null,
          name: item.label,
          division: item.division,
        })),
        kpis,
        period: assignmentForm.period,
        semester: assignmentForm.semester,
      });
      const createdRecords = (response.records || []).map(normalizeRecord);
      const nextRecords = createdRecords.length > 0 ? [...createdRecords, ...records] : records;
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);
      setAssignmentOpen(false);
      setSelectedAccountableIds([]);
      toast.success(
        `${kpis.length} OPCR KPI${kpis.length === 1 ? "" : "s"} assigned to ${targetItems.length} accountable item${targetItems.length === 1 ? "" : "s"}.`
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to assign OPCR KPI.");
    } finally {
      setSaving(false);
    }
  };

  const openVerification = (record) => {
    if (!record) {
      toast.error("Assign an OPCR KPI before rating verification.");
      return;
    }

    setVerificationRecord(record);
    setRatingForm({
      actualAccomplishment: record.actualAccomplishment || "",
      remarks: record.remarks || "",
      q1Rating: record.q1Rating || "",
      e2Rating: record.e2Rating || "",
      t3Rating: record.t3Rating || "",
      verificationFile: null,
    });
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

  const handleRate = async () => {
    if (!verificationRecord?.assignmentId) return;

    const q1 = ratingNumber(ratingForm.q1Rating);
    const e2 = ratingNumber(ratingForm.e2Rating);
    const t3 = ratingNumber(ratingForm.t3Rating);
    if ([q1, e2, t3].some((score) => score <= 0 || score > 5)) {
      toast.error("Ratings must be from 1 to 5.");
      return;
    }

    const average = Number(((q1 + e2 + t3) / 3).toFixed(2));
    setSaving(true);
    try {
      const ratingResponse = await submitOpcrRating({
        assignment_id: verificationRecord.assignmentId,
        actual_accomplishment: ratingForm.actualAccomplishment,
        remarks: ratingForm.remarks,
        q1_rating: q1,
        e2_rating: e2,
        t3_rating: t3,
        a4_rating: average,
        final_rating: average,
      });

      let updatedRecord = normalizeRecord(ratingResponse.record || {
        ...verificationRecord,
        actualAccomplishment: ratingForm.actualAccomplishment,
        remarks: ratingForm.remarks,
        q1Rating: q1,
        e2Rating: e2,
        t3Rating: t3,
        a4Rating: average,
        finalRating: average,
        status: "Rated",
      });

      if (ratingForm.verificationFile) {
        const uploadResponse = await uploadOpcrVerification(verificationRecord.assignmentId, ratingForm.verificationFile);
        updatedRecord = normalizeRecord(uploadResponse.record || updatedRecord);
      }

      const nextRecords = records.map((record) => (
        String(record.assignmentId) === String(verificationRecord.assignmentId) ? updatedRecord : record
      ));
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);
      setVerificationRecord(null);
      toast.success("OPCR rating saved.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save OPCR rating.");
    } finally {
      setSaving(false);
    }
  };

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const verificationColumns = [
    { key: "opcrNo", header: "OPCR No.", cardRole: "eyebrow", render: (record) => text(record.opcrNo) },
    { key: "accountable", header: "Divisions/Individuals Accountable", cardRole: "title", render: (record) => <span className="font-semibold text-slate-900">{text(record.accountableName)}</span> },
    { key: "kpi", header: "KPI", cardFull: true, render: (record) => text(record.kpiTitle || record.output) },
    { key: "verification", header: "Mode of Verification", render: (record) => text(record.modeOfVerificationName, "No file") },
    { key: "average", header: "Average", render: (record) => averageRating(record) },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (record) => (
        <Button
          variant="secondary"
          size="sm"
          icon={faEye}
          title="View OPCR verification"
          onClick={() => openVerification(record)}
        >
          View
        </Button>
      ),
    },
  ];

  const formColumns = [
    { key: "opcrNo", header: "OPCR No.", cardRole: "eyebrow", render: (record) => text(record.opcrNo) },
    { key: "accountable", header: "Divisions/Individuals Accountable", cardRole: "title", render: (record) => text(record.accountableName) },
    { key: "period", header: "Period", cardRole: "subtitle", render: (record) => [record.period, record.semester].filter(Boolean).join(" - ") },
    { key: "budget", header: "Budget", render: (record) => currency(record.budget) },
    { key: "overall", header: "Overall", render: (record) => averageRating(record) },
    { key: "status", header: "Status", cardRole: "badge", render: (record) => statusBadge(record.status) },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (record) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={faEye}
            title="View OPCR form"
            onClick={() => setFormPreviewRecord(record)}
          >
            View
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            title="Export OPCR form to Excel"
            loading={exportingFormId === (record.assignmentId || record.id)}
            onClick={() => handleExportForm(record)}
          >
            Export
          </Button>
        </div>
      ),
    },
  ];

  const summaryColumns = [
    { key: "opcrNo", header: "OPCR No.", cardRole: "eyebrow", render: (record) => text(record.opcrNo) },
    {
      key: "accountable",
      header: "Divisions/Individuals Accountable",
      cardRole: "title",
      render: (record) => <span className="font-semibold text-slate-900">{text(record.accountableName)}</span>,
    },
    { key: "kpi", header: "KPI", cardFull: true, render: (record) => text(record.kpiTitle || record.output, "No KPI assigned") },
    { key: "division", header: "Division", render: (record) => text(record.division, "Unassigned division") },
    {
      key: "period",
      header: "Period",
      render: (record) => [record.period, record.semester].filter(Boolean).join(" - ") || "No period",
    },
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

  const panels = {
    verification: {
      columns: verificationColumns,
      data: filteredRecords,
      emptyMessage: "No assigned OPCR verification records found.",
      tableClassName: "min-w-[1050px]",
    },
    form: {
      columns: formColumns,
      data: filteredRecords,
      emptyMessage: "No OPCR forms available yet.",
      tableClassName: "min-w-[1050px]",
    },
    summary: {
      columns: summaryColumns,
      data: filteredRecords,
      emptyMessage: "No rated OPCR records yet.",
      tableClassName: "min-w-[1500px]",
    },
  };
  const activePanel = panels[activeTab] || panels.verification;
  const ratedRecordCount = records.filter((record) => (
    summaryAverage(record) > 0 || /rated|approved/i.test(String(record.status || ""))
  )).length;
  const awaitingReviewCount = records.filter((record) => {
    const hasSubmission = Boolean(
      String(record.actualAccomplishment || "").trim()
      || record.modeOfVerificationPath
      || /submitted|review/i.test(String(record.status || ""))
    );
    return hasSubmission && summaryAverage(record) === 0;
  }).length;
  const performanceMetrics = [
    {
      label: "Accountable units",
      value: accountableOptions.length,
      icon: UsersRound,
      tone: "bg-slate-200 text-slate-700",
    },
    {
      label: "KPI records",
      value: records.length,
      icon: ListChecks,
      tone: "bg-blue-100 text-blue-700",
    },
    {
      label: "Awaiting review",
      value: awaitingReviewCount,
      icon: Clock3,
      tone: "bg-amber-100 text-amber-700",
    },
    {
      label: "Rated records",
      value: ratedRecordCount,
      icon: CheckCircle2,
      tone: "bg-emerald-100 text-emerald-700",
    },
  ];

  const verificationUrl = resolveBackendAssetUrl(verificationRecord?.modeOfVerificationPath || "");
  const isVerificationImage = String(verificationRecord?.modeOfVerificationName || verificationRecord?.modeOfVerificationPath || "")
    .toLowerCase()
    .match(/\.png|\.jpe?g|\.gif|\.webp/);

  const formPreviewRows = useMemo(() => {
    if (!formPreviewRecord) return [];

    return records
      .filter((record) => sameOpcrForm(record, formPreviewRecord))
      .sort((left, right) => String(left.accountableName || "").localeCompare(String(right.accountableName || "")));
  }, [formPreviewRecord, records]);

  return (
    <section className="w-full space-y-5">
      <PerformanceWorkspaceHeader
        title="Office Performance Commitment & Review"
        description="Set office-wide commitments, confirm accountable teams, and complete evidence-based ratings in one clear workspace."
        metrics={performanceMetrics}
        loading={loading}
        action={(
          <Button variant="primary" onClick={openAssignment} className="min-h-10 shrink-0 px-4">
            Bulk Assign KPI
          </Button>
        )}
      />

      <Card className="w-full overflow-hidden">
        <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <PerformanceTabNav
            tabs={tabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            layoutId="opcr-tab-indicator"
            ariaLabel="OPCR sections"
          />
        </div>

        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full flex-col gap-3 sm:max-w-[640px] sm:flex-row sm:items-center">
              <InputField
                name="opcrSearch"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search OPCR No., KPI, period, or status"
                aria-label="Search OPCR"
                icon={Search}
                className="w-full sm:max-w-[380px]"
                inputClassName="text-sm transition focus:ring-2 focus:ring-[#D61E1E]/15"
              />
              <select
                value={divisionFilter}
                onChange={(event) => setDivisionFilter(event.target.value)}
                aria-label="Filter by division"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 sm:w-[240px]"
              >
                <option value="">All divisions</option>
                {divisionOptions.map((division) => (
                  <option key={division} value={division}>{division}</option>
                ))}
              </select>
            </div>
            <div className="shrink-0 text-sm text-slate-500">
              <strong className="font-semibold text-slate-800">{activePanel.data.length}</strong>{" "}
              records
            </div>
          </div>

          <PerformanceTabPanel tabKey={activeTab}>
            {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
            <div className="lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200 lg:shadow-sm">
              <Table
                columns={activePanel.columns}
                data={activePanel.data}
                emptyMessage={activePanel.emptyMessage}
                tableClassName={activePanel.tableClassName}
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
              />
            </div>
          </PerformanceTabPanel>
        </CardContent>
      </Card>

      <Modal
        open={assignmentOpen}
        title="Bulk Assign KPI"
        onClose={() => setAssignmentOpen(false)}
        maxWidth="max-w-[1280px]"
        maxHeight="max-h-[94dvh]"
        contentClassName="p-0 sm:p-0 lg:!overflow-hidden"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAssignmentOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="opcr-assign-form" loading={saving} disabled={selectedCount === 0}>
              Assign KPI
            </Button>
          </>
        )}
      >
        <form
          id="opcr-assign-form"
          className="grid min-h-0 lg:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.35fr)]"
          onSubmit={handleAssignmentSubmit}
        >
          <KpiAssignmentTargetPicker
            description="Select the divisions or individuals accountable for these KPIs."
            query={assignmentQuery}
            onQueryChange={setAssignmentQuery}
            searchPlaceholder="Search divisions or people"
            divisionFilter={assignmentDivisionFilter}
            onDivisionFilterChange={setAssignmentDivisionFilter}
            divisions={divisionOptions}
            items={assignmentRows}
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
            emptyMessage="No accountable divisions or employees match your filters."
          />

          <section className="min-h-0 space-y-5 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-5 lg:max-h-[58dvh]">
            <div>
              <h3 className="m-0 text-base font-semibold text-slate-950">KPI details</h3>
              <p className="mb-0 mt-1 text-sm text-slate-500">Set the review period and office commitments.</p>
            </div>

            <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
              <InputField
                label="Period"
                name="opcrPeriod"
                value={assignmentForm.period}
                onChange={(event) => setAssignmentForm((form) => ({ ...form, period: event.target.value }))}
                required
              />
              <div>
                <label htmlFor="opcrSemester" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Semester
                </label>
                <select
                  id="opcrSemester"
                  value={assignmentForm.semester}
                  onChange={(event) => setAssignmentForm((form) => ({ ...form, semester: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                >
                  <option value="1st Semester">1st Semester</option>
                  <option value="2nd Semester">2nd Semester</option>
                  <option value="Annual">Annual</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              {assignmentForm.kpis.map((kpi, index) => (
                <div key={kpi.uid} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800">KPI {index + 1}</span>
                    {assignmentForm.kpis.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeAssignmentKpi(kpi.uid)}
                        disabled={saving}
                        className="text-xs font-semibold text-slate-500 transition hover:text-slate-900 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <InputField
                    label="Output"
                    id={`${kpi.uid}-title`}
                    name={`${kpi.uid}-title`}
                    value={kpi.kpiTitle}
                    onChange={(event) => updateAssignmentKpi(kpi.uid, { kpiTitle: event.target.value })}
                    placeholder="Enter output"
                    required
                  />
                  <div>
                    <label htmlFor={`${kpi.uid}-indicator`} className="mb-1.5 block text-sm font-semibold text-slate-700">
                      Success Indicator
                    </label>
                    <textarea
                      id={`${kpi.uid}-indicator`}
                      value={kpi.successIndicator}
                      onChange={(event) => updateAssignmentKpi(kpi.uid, { successIndicator: event.target.value })}
                      placeholder="Define a measurable success indicator"
                      rows={3}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      required
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <InputField
                      label="Category"
                      id={`${kpi.uid}-category`}
                      name={`${kpi.uid}-category`}
                      value={kpi.category}
                      onChange={(event) => updateAssignmentKpi(kpi.uid, { category: event.target.value })}
                      placeholder="Enter category"
                      required
                    />
                    <InputField
                      label="Budget"
                      id={`${kpi.uid}-budget`}
                      name={`${kpi.uid}-budget`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={kpi.budget}
                      onChange={(event) => updateAssignmentKpi(kpi.uid, { budget: event.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button variant="secondary" onClick={addAssignmentKpi} disabled={saving}>
              Add KPI
            </Button>
          </section>
        </form>
      </Modal>

      <Modal
        open={Boolean(verificationRecord)}
        title="Mode of Verification"
        onClose={() => setVerificationRecord(null)}
        maxWidth="max-w-[1080px]"
        panelClassName="rounded-xl"
        contentClassName="bg-slate-50 p-0"
        footerClassName="bg-white"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setVerificationRecord(null)} disabled={saving}>
              Close
            </Button>
            <Button icon={faCircleCheck} onClick={handleRate} loading={saving}>
              Rate
            </Button>
          </>
        )}
      >
        <div className="grid min-h-[520px] lg:grid-cols-[1.2fr_0.95fr]">
          <div className="border-b border-slate-200 bg-white p-5 lg:border-b-0 lg:border-r">
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">Divisions/Individuals Accountable</p>
              <p className="m-0 mt-1 text-xl font-extrabold text-slate-950">{text(verificationRecord?.accountableName)}</p>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">KPI / Output</p>
                <p className="m-0 mt-1 text-sm leading-6 text-slate-800">{text(verificationRecord?.kpiTitle || verificationRecord?.output)}</p>
              </div>
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="m-0 text-sm font-bold text-slate-900">Submitted evidence</p>
                <p className="m-0 mt-0.5 text-xs text-slate-500">{text(verificationRecord?.modeOfVerificationName, "No file attached")}</p>
              </div>
            </div>

            {verificationUrl ? (
              <a
                href={verificationUrl}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-[#D61E1E]/40 hover:shadow-md"
              >
                <div className="flex h-72 items-center justify-center bg-slate-100">
                  {isVerificationImage ? (
                    <img src={verificationUrl} alt={text(verificationRecord?.modeOfVerificationName, "Verification upload")} className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
                      <FileText size={46} />
                      <span className="text-sm font-semibold text-slate-500">Document preview</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2.5 text-sm font-semibold">
                  {isVerificationImage ? <ImageIcon size={16} className="text-[#D61E1E]" /> : <FileText size={16} className="text-[#D61E1E]" />}
                  <span className="truncate">{text(verificationRecord?.modeOfVerificationName, "Uploaded file")}</span>
                </div>
              </a>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-slate-500">
                <FileText size={38} className="mx-auto mb-3 text-slate-400" />
                <p className="m-0 font-semibold text-slate-700">No evidence uploaded</p>
                <p className="m-0 mt-1 text-sm">Upload a verification file while saving the rating.</p>
              </div>
            )}
          </div>

          <div className="bg-slate-50 p-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-sm font-bold text-slate-900">Rating details</p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">Enter scores from 1.00 to 5.00</p>
                </div>
                <div className="rounded-lg border border-[#F8BFBF] bg-[#FEF1F1] px-3 py-2 text-right">
                  <p className="m-0 text-[11px] font-extrabold uppercase tracking-wide text-[#D61E1E]">Average</p>
                  <p className="m-0 text-lg font-extrabold leading-none text-slate-950">
                    {(() => {
                      const scores = [ratingForm.q1Rating, ratingForm.e2Rating, ratingForm.t3Rating].map(ratingNumber).filter((score) => score > 0);
                      return scores.length === 3 ? (scores.reduce((sum, score) => sum + score, 0) / 3).toFixed(2) : "N/A";
                    })()}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="opcrActualAccomplishment" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Actual Accomplishment
                  </label>
                  <textarea
                    id="opcrActualAccomplishment"
                    value={ratingForm.actualAccomplishment}
                    onChange={(event) => setRatingForm((form) => ({ ...form, actualAccomplishment: event.target.value }))}
                    rows={4}
                    placeholder="Write accomplishment details."
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
                  />
                </div>
                <div>
                  <label htmlFor="opcrRemarks" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Remarks
                  </label>
                  <textarea
                    id="opcrRemarks"
                    value={ratingForm.remarks}
                    onChange={(event) => setRatingForm((form) => ({ ...form, remarks: event.target.value }))}
                    rows={4}
                    placeholder="Write observations, validation notes, or supporting comments."
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
                  />
                </div>
                <label
                  htmlFor="opcrVerificationFile"
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-700 hover:border-[#D61E1E]/50 hover:bg-[#FEF1F1]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Upload size={18} className="shrink-0 text-[#D61E1E]" />
                    <span className="truncate">{ratingForm.verificationFile?.name || "Upload mode of verification"}</span>
                  </span>
                  <input
                    id="opcrVerificationFile"
                    type="file"
                    className="sr-only"
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                    onChange={(event) => setRatingForm((form) => ({ ...form, verificationFile: event.target.files?.[0] || null }))}
                  />
                </label>
                <div className="grid gap-3">
                  <InputField
                    label="1 Quantity"
                    name="opcrQ1Rating"
                    type="number"
                    min="1"
                    max="5"
                    step="0.01"
                    value={ratingForm.q1Rating}
                    onChange={(event) => setRatingForm((form) => ({ ...form, q1Rating: event.target.value }))}
                  />
                  <InputField
                    label="2 Efficiency"
                    name="opcrE2Rating"
                    type="number"
                    min="1"
                    max="5"
                    step="0.01"
                    value={ratingForm.e2Rating}
                    onChange={(event) => setRatingForm((form) => ({ ...form, e2Rating: event.target.value }))}
                  />
                  <InputField
                    label="3 Timeliness"
                    name="opcrT3Rating"
                    type="number"
                    min="1"
                    max="5"
                    step="0.01"
                    value={ratingForm.t3Rating}
                    onChange={(event) => setRatingForm((form) => ({ ...form, t3Rating: event.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(formPreviewRecord)}
        title="OPCR Form Preview"
        onClose={() => setFormPreviewRecord(null)}
        maxWidth="max-w-[96vw]"
        panelClassName="rounded-xl"
        contentClassName="bg-slate-100 p-4"
        footer={(
          <Button
            variant="primary"
            icon={Download}
            loading={exportingFormId === (formPreviewRecord?.assignmentId || formPreviewRecord?.id)}
            onClick={() => handleExportForm(formPreviewRecord)}
          >
            Export to Excel
          </Button>
        )}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
          <OpcrFormDocument record={formPreviewRecord} rows={formPreviewRows} />
        </div>
      </Modal>
    </section>
  );
}
