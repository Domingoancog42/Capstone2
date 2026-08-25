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
  createIpcr,
  fetchIpcrRecords,
  submitIpcrRating,
} from "../../services/api";
import { exportIpcrForm } from "../../services/performanceExportService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

const STORAGE_KEY = "hris.performance.adminIpcrDrafts";

const tabs = [
  { key: "verification", label: "Verify & Rate" },
  { key: "form", label: "IPCR Form" },
  { key: "summary", label: "Ratings Summary" },
];

const currentYear = new Date().getFullYear();

// One assignment covers a single rating period, so the period is shared while every KPI row inside
// it carries its own title, indicator, and category — the same shape as a printed IPCR form.
let bulkKpiSeq = 0;

function createBulkKpi() {
  bulkKpiSeq += 1;
  return {
    uid: `bulk-kpi-${bulkKpiSeq}`,
    kpiTitle: "",
    successIndicator: "",
    category: "Program",
  };
}

function createDefaultBulkForm() {
  return {
    periodFrom: `${currentYear}-01-01`,
    periodTo: `${currentYear}-06-30`,
    kpis: [createBulkKpi()],
  };
}

const defaultRatingForm = {
  remarks: "",
  q1Rating: "",
  e2Rating: "",
  t3Rating: "",
};

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

function statusBadge(status) {
  const normalized = String(status || "draft").toLowerCase();
  const classes = normalized.includes("rated") || normalized.includes("reviewed")
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : normalized.includes("submitted")
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${classes}`}>
      {text(status, "Draft")}
    </span>
  );
}

function employeeName(employee) {
  return text(employee?.fullName || [employee?.firstName, employee?.middleName, employee?.lastName].filter(Boolean).join(" "));
}

function normalizeRecord(record = {}) {
  const ipcrId = record.ipcrId ?? record.ipcr_id ?? record.id;
  return {
    ...record,
    id: ipcrId,
    ipcrId,
    employeeRecordId: record.employeeRecordId ?? record.employee_id ?? record.employeeId,
    employeeCode: record.employeeCode ?? record.employeeIdNumber ?? record.employeeCodeNumber ?? record.employeeId,
    employeeName: record.employeeName ?? record.fullName,
    division: record.division ?? record.department,
    position: record.position ?? record.designation,
    kpiTitle: record.kpiTitle ?? record.output,
    output: record.output ?? record.kpiTitle,
    successIndicator: record.successIndicator ?? record.success_indicator,
    category: record.category ?? record.kpiCategory ?? record.kpi_category ?? "Program",
    actualAccomplishment: record.actualAccomplishment ?? record.actual_accomplishment,
    periodFrom: record.periodFrom ?? record.period_from,
    periodTo: record.periodTo ?? record.period_to,
    finalRating: record.finalRating ?? record.final_rating,
    q1Rating: record.q1Rating ?? record.q1_rating,
    e2Rating: record.e2Rating ?? record.e2_rating,
    t3Rating: record.t3Rating ?? record.t3_rating,
    a4Rating: record.a4Rating ?? record.a4_rating,
    verificationFiles: Array.isArray(record.verificationFiles) ? record.verificationFiles : [],
  };
}

function sameIpcrForm(left, right) {
  return String(left?.employeeRecordId || "") === String(right?.employeeRecordId || "")
    && String(left?.periodFrom || "") === String(right?.periodFrom || "")
    && String(left?.periodTo || "") === String(right?.periodTo || "");
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
  const cell = "border-2 border-black px-2 py-2 align-top";
  const centerCell = `${cell} text-center`;
  const headerCell = `${cell} bg-[#b8d4f1] text-center font-bold`;

  return (
    <div className="min-w-[1120px] bg-white p-4 font-sans text-black">
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
            <th className={`${headerCell} w-[15%]`}>OUTPUT</th>
            <th className={`${headerCell} w-[20%]`}>
              SUCCESS INDICATOR
              <br />
              (Target + Measure)
            </th>
            <th className={`${headerCell} w-[24%]`}>Actual Accomplishments</th>
            <th className={headerCell} colSpan={4}>Rating</th>
            <th className={`${headerCell} w-[16%]`}>Remarks</th>
          </tr>
          <tr>
            <th className={headerCell} />
            <th className={headerCell} />
            <th className={headerCell} />
            <th className={`${headerCell} w-[5%]`}>Q1</th>
            <th className={`${headerCell} w-[5%]`}>E2</th>
            <th className={`${headerCell} w-[5%]`}>T3</th>
            <th className={`${headerCell} w-[5%]`}>A4</th>
            <th className={headerCell} />
          </tr>
        </thead>
        <tbody>
          {formRows.map((item, index) => {
            const category = text(item.category || item.kpiCategory, "Program").toUpperCase();
            return (
              <React.Fragment key={item.ipcrId || item.id || index}>
                {index === 0 || category !== text(formRows[index - 1]?.category || formRows[index - 1]?.kpiCategory, "Program").toUpperCase() ? (
                  <tr>
                    <td colSpan={8} className={`${cell} bg-[#f0f0f0] text-xs font-bold italic`}>
                      {category}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td className={`${cell} leading-5`}>{text(item.output || item.kpiTitle)}</td>
                  <td className={`${cell} leading-5`}>{text(item.successIndicator)}</td>
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
            <td className={centerCell} />
            <td className={centerCell} />
            <td className={centerCell} />
            {/* The final average belongs under A4, the column that carries every other average. */}
            <td className={`${centerCell} font-bold`}>{rating === "N/A" ? "" : rating}</td>
            <td className={cell} />
          </tr>
          <tr>
            <td colSpan={8} className={`${cell} bg-[#e6e6e6] font-bold`}>
              Comments and Recommendations for Development Purposes
            </td>
          </tr>
          <tr>
            <td colSpan={8} className={`${cell} h-20`} />
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

export default function IpcrManagementWorkspace({ employees = [] }) {
  const [activeTab, setActiveTab] = useState("verification");
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [assignmentDivisionFilter, setAssignmentDivisionFilter] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [records, setRecords] = useState(() => loadLocalRecords());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState(createDefaultBulkForm);
  const [verificationRecord, setVerificationRecord] = useState(null);
  const [formPreviewRecord, setFormPreviewRecord] = useState(null);
  const [exportingFormId, setExportingFormId] = useState(null);
  const [ratingForm, setRatingForm] = useState(defaultRatingForm);

  const activeEmployees = useMemo(
    () => employees,
    [employees]
  );

  /*
   * Every division the workspace can show, taken from the roster AND from the records: a record
   * keeps the division it was raised under, so an employee who has since moved would otherwise make
   * their old IPCR unreachable through the filter.
   */
  const divisionOptions = useMemo(() => {
    const names = new Set();

    activeEmployees.forEach((employee) => {
      const division = text(employee.department, "");
      if (division) names.add(division);
    });
    records.forEach((record) => {
      const division = text(record.division, "");
      if (division) names.add(division);
    });

    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [activeEmployees, records]);

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

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return records.filter((record) => {
      if (divisionFilter && text(record.division, "") !== divisionFilter) {
        return false;
      }

      if (!needle) return true;

      return [
        record.employeeCode,
        record.employeeName,
        record.division,
        record.position,
        record.kpiTitle,
        record.output,
        record.successIndicator,
        record.category,
        record.status,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [divisionFilter, query, records]);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const response = await fetchIpcrRecords();
      const nextRecords = (response.records || response.ipcrRecords || []).map(normalizeRecord);
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);
    } catch (error) {
      // Falling back to the local cache is for a failed *first* load. A failed background poll
      // already has fresher records on screen than the cache holds, so it leaves them alone.
      if (!background) {
        setRecords(loadLocalRecords());
      }
    } finally {
      setLoading(false);
    }
  }, []);

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

  // The form always keeps at least one KPI row, so the last one cannot be removed.
  const removeBulkKpi = (uid) => {
    setBulkForm((form) => (
      form.kpis.length <= 1
        ? form
        : { ...form, kpis: form.kpis.filter((kpi) => kpi.uid !== uid) }
    ));
  };

  const handleBulkSubmit = async (event) => {
    event.preventDefault();
    const kpis = bulkForm.kpis.map((kpi) => ({
      output: kpi.kpiTitle.trim(),
      success_indicator: kpi.successIndicator.trim(),
      kpi_category: kpi.category.trim(),
    }));
    const targetEmployees = selectedEmployeeIds;

    const incompleteKpi = kpis.some((kpi) => !kpi.output || !kpi.success_indicator || !kpi.kpi_category);
    if (kpis.length === 0 || incompleteKpi || targetEmployees.length === 0) {
      toast.error("Complete every output, category, and success indicator, and select at least one employee.");
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
                category: kpi.kpi_category,
                periodFrom: bulkForm.periodFrom,
                periodTo: bulkForm.periodTo,
                status: "draft",
              }));
            }),
            ...records,
          ];
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);
      setBulkOpen(false);
      setSelectedEmployeeIds([]);
      toast.success(
        `${kpis.length} KPI${kpis.length === 1 ? "" : "s"} assigned to ${targetEmployees.length} employee${targetEmployees.length === 1 ? "" : "s"}.`
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to assign KPI.");
    } finally {
      setSaving(false);
    }
  };

  const openVerification = (record) => {
    if (!record) {
      toast.error("Assign a KPI before rating verification.");
      return;
    }

    setVerificationRecord(record);
    setRatingForm({
      remarks: record.remarks || "",
      q1Rating: record.q1Rating || "",
      e2Rating: record.e2Rating || "",
      t3Rating: record.t3Rating || "",
    });
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

  const handleRate = async () => {
    if (!verificationRecord?.ipcrId) return;

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
      await submitIpcrRating({
        ipcr_id: verificationRecord.ipcrId,
        remarks: ratingForm.remarks,
        q1_rating: q1,
        e2_rating: e2,
        t3_rating: t3,
        a4_rating: average,
        final_rating: average,
      });

      const nextRecords = records.map((record) => (
        String(record.ipcrId) === String(verificationRecord.ipcrId)
          ? normalizeRecord({
              ...record,
              remarks: ratingForm.remarks,
              q1Rating: q1,
              e2Rating: e2,
              t3Rating: t3,
              a4Rating: average,
              finalRating: average,
              status: "rated",
            })
          : record
      ));
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);
      setVerificationRecord(null);
      toast.success("IPCR rating saved.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to save rating.");
    } finally {
      setSaving(false);
    }
  };

  /* `cardRole` lays these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const verificationColumns = [
    { key: "employeeId", header: "Employee ID", cardRole: "eyebrow", render: (record) => text(record.employeeCode || record.employeeId) },
    { key: "employee", header: "Employee", cardRole: "title", render: (record) => <span className="font-semibold text-slate-900">{text(record.employeeName)}</span> },
    { key: "kpi", header: "KPI", cardFull: true, render: (record) => text(record.kpiTitle || record.output) },
    { key: "verification", header: "Uploads", render: (record) => `${record.verificationFiles?.length || 0} file(s)` },
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
          title="View verification"
          onClick={() => openVerification(record)}
        >
          View
        </Button>
      ),
    },
  ];

  const formColumns = [
    { key: "employee", header: "Employee Name", cardRole: "title", render: (record) => <span className="font-semibold text-slate-900">{text(record.employeeName)}</span> },
    { key: "period", header: "Period", cardRole: "subtitle", render: (record) => periodLabel(record) },
    { key: "dateRange", header: "Date Range", render: (record) => formatRange(record.periodFrom, record.periodTo) },
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
            title="View IPCR form"
            onClick={() => setFormPreviewRecord(record)}
          >
            View
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            title="Export IPCR form to Excel"
            loading={exportingFormId === (record.ipcrId || record.id)}
            onClick={() => handleExportForm(record)}
          >
            Export
          </Button>
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
      render: (record) => <span className="font-semibold text-slate-900">{text(record.employeeName)}</span>,
    },
    { key: "position", header: "Designation", cardRole: "subtitle", render: (record) => text(record.position, "No designation") },
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

  const panels = {
    verification: {
      columns: verificationColumns,
      data: filteredRecords,
      emptyMessage: "No assigned IPCR verification records found.",
      tableClassName: "min-w-[980px]",
    },
    form: {
      columns: formColumns,
      data: filteredRecords,
      emptyMessage: "No IPCR forms available yet.",
      tableClassName: "min-w-[980px]",
    },
    summary: {
      columns: summaryColumns,
      data: filteredRecords,
      emptyMessage: "No rated IPCR records yet.",
      tableClassName: "min-w-[1500px]",
    },
  };
  const activePanel = panels[activeTab] || panels.verification;
  const ratedRecordCount = records.filter((record) => (
    summaryAverage(record) > 0 || /rated|reviewed/i.test(String(record.status || ""))
  )).length;
  const awaitingReviewCount = records.filter((record) => {
    const hasSubmission = Boolean(
      String(record.actualAccomplishment || "").trim()
      || record.verificationFiles?.length
      || /submitted|review/i.test(String(record.status || ""))
    );
    return hasSubmission && summaryAverage(record) === 0;
  }).length;
  const performanceMetrics = [
    {
      label: "Active employees",
      value: activeEmployees.length,
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

  const verificationFiles = verificationRecord?.verificationFiles || [];
  const formPreviewRows = useMemo(() => {
    if (!formPreviewRecord) return [];

    return records
      .filter((record) => sameIpcrForm(record, formPreviewRecord))
      .sort((left, right) => {
        const categorySort = String(left.category || "").localeCompare(String(right.category || ""));
        if (categorySort !== 0) return categorySort;
        return String(left.ipcrId || left.id || "").localeCompare(String(right.ipcrId || right.id || ""));
      });
  }, [formPreviewRecord, records]);

  return (
    <section className="w-full space-y-5">
      <PerformanceWorkspaceHeader
        title="Individual Performance Commitment & Review"
        description="Assign measurable targets, validate employee accomplishments, and complete ratings from one organized workspace."
        metrics={performanceMetrics}
        loading={loading}
        action={(
          <Button variant="primary" onClick={openBulkAssign} className="min-h-10 shrink-0 px-4">
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
            layoutId="ipcr-tab-indicator"
            ariaLabel="IPCR sections"
          />
        </div>

        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full flex-col gap-3 sm:max-w-[640px] sm:flex-row sm:items-center">
              <InputField
                name="ipcrSearch"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee, KPI, division, or status"
                aria-label="Search IPCR"
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
        open={bulkOpen}
        title="Bulk Assign KPI"
        onClose={() => setBulkOpen(false)}
        maxWidth="max-w-[1280px]"
        maxHeight="max-h-[94dvh]"
        contentClassName="p-0 sm:p-0 lg:!overflow-hidden"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="ipcr-bulk-assign-form" loading={saving} disabled={selectedCount === 0}>
              Assign KPI
            </Button>
          </>
        )}
      >
        <form
          id="ipcr-bulk-assign-form"
          className="grid min-h-0 lg:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.35fr)]"
          onSubmit={handleBulkSubmit}
        >
          <KpiAssignmentTargetPicker
            description="Select the employees who will receive these KPIs."
            query={assignmentQuery}
            onQueryChange={setAssignmentQuery}
            searchPlaceholder="Search employees"
            divisionFilter={assignmentDivisionFilter}
            onDivisionFilterChange={setAssignmentDivisionFilter}
            divisions={divisionOptions}
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
            <div>
              <h3 className="m-0 text-base font-semibold text-slate-950">KPI details</h3>
              <p className="mb-0 mt-1 text-sm text-slate-500">Set the rating period and measurable commitments.</p>
            </div>

            <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
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
                <div key={kpi.uid} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800">KPI {index + 1}</span>
                    {bulkForm.kpis.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeBulkKpi(kpi.uid)}
                        disabled={saving}
                        className="text-xs font-semibold text-slate-500 transition hover:text-slate-900 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                    <InputField
                      label="Output"
                      id={`${kpi.uid}-title`}
                      name={`${kpi.uid}-title`}
                      value={kpi.kpiTitle}
                      onChange={(event) => updateBulkKpi(kpi.uid, { kpiTitle: event.target.value })}
                      placeholder="Enter output"
                      required
                    />
                    <InputField
                      label="Category"
                      id={`${kpi.uid}-category`}
                      name={`${kpi.uid}-category`}
                      value={kpi.category}
                      onChange={(event) => updateBulkKpi(kpi.uid, { category: event.target.value })}
                      placeholder="Enter category"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor={`${kpi.uid}-indicator`} className="mb-1.5 block text-sm font-semibold text-slate-700">
                      Success Indicator
                    </label>
                    <textarea
                      id={`${kpi.uid}-indicator`}
                      value={kpi.successIndicator}
                      onChange={(event) => updateBulkKpi(kpi.uid, { successIndicator: event.target.value })}
                      placeholder="Define a measurable success indicator"
                      rows={3}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      required
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button variant="secondary" onClick={addBulkKpi} disabled={saving}>
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
        <div className="grid min-h-[520px] lg:grid-cols-[1.35fr_0.9fr]">
          <div className="border-b border-slate-200 bg-white p-5 lg:border-b-0 lg:border-r">
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">Employee</p>
              <p className="m-0 mt-1 text-xl font-extrabold text-slate-950">{text(verificationRecord?.employeeName)}</p>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">KPI / Output</p>
                <p className="m-0 mt-1 text-sm leading-6 text-slate-800">{text(verificationRecord?.kpiTitle || verificationRecord?.output)}</p>
              </div>
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="m-0 text-sm font-bold text-slate-900">Submitted evidence</p>
                <p className="m-0 mt-0.5 text-xs text-slate-500">{verificationFiles.length} file{verificationFiles.length === 1 ? "" : "s"} attached</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {verificationFiles.length > 0 ? verificationFiles.map((file) => {
                const fileUrl = resolveBackendAssetUrl(file.storedPath || file.path || "");
                const isImage = String(file.mimeType || file.originalName || "").toLowerCase().match(/\bimage\/|\.png|\.jpe?g|\.gif|\.webp/);
                return (
                  <a
                    key={file.id || fileUrl}
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-[#D61E1E]/40 hover:shadow-md"
                  >
                    <div className="flex h-56 items-center justify-center bg-slate-100">
                      {isImage && fileUrl ? (
                        <img src={fileUrl} alt={text(file.originalName, "Verification upload")} className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
                          <FileText size={46} />
                          <span className="text-sm font-semibold text-slate-500">Document preview</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2.5 text-sm font-semibold">
                      {isImage ? <ImageIcon size={16} className="text-[#D61E1E]" /> : <FileText size={16} className="text-[#D61E1E]" />}
                      <span className="truncate">{text(file.originalName || file.name, "Uploaded file")}</span>
                    </div>
                  </a>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-slate-500 sm:col-span-2">
                  <FileText size={38} className="mx-auto mb-3 text-slate-400" />
                  <p className="m-0 font-semibold text-slate-700">No evidence uploaded</p>
                  <p className="m-0 mt-1 text-sm">Verification documents or screenshots will appear here.</p>
                </div>
              )}
            </div>
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
                  <label htmlFor="ipcrRemarks" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Remarks
                  </label>
                  <textarea
                    id="ipcrRemarks"
                    value={ratingForm.remarks}
                    onChange={(event) => setRatingForm((form) => ({ ...form, remarks: event.target.value }))}
                    rows={6}
                    placeholder="Write observations, validation notes, or supporting comments."
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
                  />
                </div>

                <div className="grid gap-3">
                  <InputField
                    label="1 Quantity"
                    name="q1Rating"
                    type="number"
                    min="1"
                    max="5"
                    step="0.01"
                    value={ratingForm.q1Rating}
                    onChange={(event) => setRatingForm((form) => ({ ...form, q1Rating: event.target.value }))}
                  />
                  <InputField
                    label="2 Efficiency"
                    name="e2Rating"
                    type="number"
                    min="1"
                    max="5"
                    step="0.01"
                    value={ratingForm.e2Rating}
                    onChange={(event) => setRatingForm((form) => ({ ...form, e2Rating: event.target.value }))}
                  />
                  <InputField
                    label="3 Timeliness"
                    name="t3Rating"
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
        title="IPCR Form Preview"
        onClose={() => setFormPreviewRecord(null)}
        maxWidth="max-w-[96vw]"
        panelClassName="rounded-xl"
        contentClassName="bg-slate-100 p-4"
        footer={(
          <Button
            variant="primary"
            icon={Download}
            loading={exportingFormId === (formPreviewRecord?.ipcrId || formPreviewRecord?.id)}
            onClick={() => handleExportForm(formPreviewRecord)}
          >
            Export to Excel
          </Button>
        )}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
          <IpcrFormDocument record={formPreviewRecord} rows={formPreviewRows} />
        </div>
      </Modal>
    </section>
  );
}
