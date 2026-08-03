import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  Loader2,
  Printer,
  Search,
  SlidersHorizontal,
  FolderUp,
  UploadCloud,
} from "lucide-react";
import { faCheck, faClockRotateLeft, faEye, faFilePen, faPen, faPrint, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import Pagination from "../../components/UI/Pagination";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchAttendanceDtr,
  fetchAttendanceLogs,
  fetchAttendanceRecords,
  importAttendanceCsv,
  requestAttendanceAdjustment,
  updateAttendanceAdjustmentStatus,
  updateAttendanceRecord,
} from "../../services/attendanceService";
import { getEmployeeSignature } from "../../services/api";
import { normalizeRole } from "../../utils/roleRoutes";
import DailyTimeRecord, { buildDailyTimeRecordRows } from "./DailyTimeRecord";

/**
 * The employee's saved signature for a DTR payload, or "" when they have not saved one — a missing
 * signature just leaves the ruled line blank, exactly as the form behaved before.
 */
async function loadDtrSignature(dtr) {
  const employeeRecordId = dtr?.employee?.employeeRecordId;

  if (!employeeRecordId) {
    return "";
  }

  try {
    const result = await getEmployeeSignature(employeeRecordId);
    return String(result?.employee?.signatureDataUrl || "");
  } catch {
    return "";
  }
}

const STATUS_OPTIONS = ["Present", "Late", "Undertime", "Late / Undertime", "Incomplete", "Leave with Pay", "Leave Without Pay"];
const DEFAULT_ROWS_PER_PAGE = 10;
const ATTENDANCE_FILTER_STORAGE_PREFIX = "hris-attendance-filters";
const ATTENDANCE_DAT_MB_LIMIT = 10;
const ATTENDANCE_IMPORT_HEADERS = ["Employee ID", "Date & Time", "State C", "State D", "State E", "State F"];
const DAT_DATE_TIME_PATTERN =
  /(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})[T\s]+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)/i;
const ATTENDANCE_PROGRESS_STRIPE_KEYFRAMES = `
@keyframes attendance-progress-stripes {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 24px 0;
  }
}
`;

function defaultAttendanceFilters() {
  return {
    search: "",
    dateFrom: startOfCurrentMonth(),
    dateTo: toLocalDateInput(),
    department: "",
    status: "",
  };
}

function attendanceFilterStorageKey(roleKey) {
  return `${ATTENDANCE_FILTER_STORAGE_PREFIX}:${roleKey || "default"}`;
}

function readStoredAttendanceFilters(roleKey) {
  const defaults = defaultAttendanceFilters();

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(attendanceFilterStorageKey(roleKey)) || "null");
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }

    return {
      ...defaults,
      search: String(parsed.search || ""),
      dateFrom: String(parsed.dateFrom || defaults.dateFrom),
      dateTo: String(parsed.dateTo || defaults.dateTo),
      department: String(parsed.department || ""),
      status: String(parsed.status || ""),
    };
  } catch {
    return defaults;
  }
}

function toLocalDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfCurrentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) {
    return "N/A";
  }

  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatFileSize(bytes = 0) {
  const value = Number(bytes) || 0;

  if (value <= 0) {
    return "0 KB";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatTime(value) {
  const date = parseDate(value);
  if (!date) {
    return "--";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) {
    return "N/A";
  }

  return `${formatDate(value)} ${formatTime(value)}`;
}

function toDateTimeInput(value, fallbackDate = "") {
  const date = parseDate(value);
  if (!date) {
    return fallbackDate ? `${fallbackDate}T08:00` : "";
  }

  return `${toLocalDateInput(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function minutesToDuration(minutes) {
  const safeMinutes = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function statusClasses(status) {
  const value = String(status || "").toLowerCase();

  if (value === "present") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (value.includes("late")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (value.includes("undertime")) {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }

  if (value === "incomplete") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (value === "leave with pay") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (value === "leave without pay") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function adjustmentStatusClasses(status) {
  const value = String(status || "").toLowerCase();

  if (value === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (value === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-amber-200 bg-amber-50 text-amber-700";
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function metricNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatMetricNumber(value) {
  const number = metricNumber(value);
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
}

const ATTENDANCE_TEMPLATE_HEADERS = ["EmployeeID", "DaysWorked", "OvertimeHours", "LateMinutes", "AbsentDays", "LeaveDays"];

function buildDtrTemplateRow(dtr) {
  const records = Array.isArray(dtr?.records) ? dtr.records : [];
  const totals = dtr?.totals || {};
  const fallbackDaysWorked = records.filter((record) => metricNumber(record.totalMinutes) > 0).length;
  const fallbackLateMinutes = records.reduce((sum, record) => sum + metricNumber(record.lateMinutes), 0);

  return [
    dtr?.employee?.employeeId || "",
    formatMetricNumber(totals.daysWorked ?? fallbackDaysWorked),
    formatMetricNumber(totals.overtimeHours ?? 0),
    formatMetricNumber(totals.lateMinutes ?? fallbackLateMinutes),
    formatMetricNumber(totals.absentDays ?? 0),
    formatMetricNumber(totals.leaveDays ?? 0),
  ];
}

function buildDtrTemplateRows(dtr) {
  return [
    ATTENDANCE_TEMPLATE_HEADERS,
    buildDtrTemplateRow(dtr),
  ];
}

function cleanDatToken(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^["']|["']$/g, "");
}

function splitDatFields(value) {
  const text = cleanDatToken(value);

  if (text.includes("\t")) {
    return text.split("\t").map(cleanDatToken).filter(Boolean);
  }

  if (text.includes(",")) {
    return text.split(",").map(cleanDatToken).filter(Boolean);
  }

  if (text.includes(";")) {
    return text.split(";").map(cleanDatToken).filter(Boolean);
  }

  return text.split(/\s+/).map(cleanDatToken).filter(Boolean);
}

function normalizeDatDateTime(datePart, timePart) {
  const dateText = cleanDatToken(datePart);
  const timeText = cleanDatToken(timePart).toUpperCase().replace(/\s+/g, " ");
  const isoMatch = dateText.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")} ${timeText}`;
  }

  return `${dateText} ${timeText}`;
}

function stateFromPunchType(type) {
  return type === "time_out" ? ["1", "1", "1", "0"] : ["1", "0", "1", "0"];
}

function extractPunchState(tokens, sourceText) {
  const compactState = tokens.map(cleanDatToken).find((token) => /^[01]{4}$/.test(token));

  if (compactState) {
    return compactState.split("");
  }

  const binaryTokens = tokens.map(cleanDatToken).filter((token) => token === "0" || token === "1");

  if (binaryTokens.length >= 4) {
    return binaryTokens.slice(0, 4);
  }

  const normalizedTokens = tokens.map((token) => cleanDatToken(token).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const normalizedSource = String(sourceText || "").toLowerCase();

  if (
    normalizedTokens.some((token) => ["timein", "checkin", "clockin", "punchin", "signin", "in", "i"].includes(token)) ||
    /\b(time\s*in|check\s*in|clock\s*in|punch\s*in|sign\s*in)\b/i.test(normalizedSource)
  ) {
    return stateFromPunchType("time_in");
  }

  if (
    normalizedTokens.some((token) => ["timeout", "checkout", "clockout", "punchout", "signout", "out", "o"].includes(token)) ||
    /\b(time\s*out|check\s*out|clock\s*out|punch\s*out|sign\s*out)\b/i.test(normalizedSource)
  ) {
    return stateFromPunchType("time_out");
  }

  if (binaryTokens.length === 1 && tokens.length <= 2) {
    return stateFromPunchType(binaryTokens[0] === "1" ? "time_out" : "time_in");
  }

  return null;
}

function parseDatAttendanceLine(line) {
  const text = cleanDatToken(line);
  const dateTimeMatch = text.match(DAT_DATE_TIME_PATTERN);

  if (!dateTimeMatch) {
    return null;
  }

  const beforeDateTime = text.slice(0, dateTimeMatch.index).trim();
  const afterDateTime = text.slice((dateTimeMatch.index || 0) + dateTimeMatch[0].length).trim();
  const employeeTokens = splitDatFields(beforeDateTime).filter((token) => !/^(no|number|id|user|employee|emp|code)$/i.test(token));
  const afterTokens = splitDatFields(afterDateTime);
  let stateTokens = afterTokens;
  let employeeCode =
    [...employeeTokens].reverse().find((token) => /^[a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*$/i.test(token)) ||
    employeeTokens[employeeTokens.length - 1] ||
    "";

  if (!employeeCode) {
    const employeeTokenIndex = afterTokens.findIndex(
      (token) => /^[a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*$/i.test(token) && !/^[01]{1,4}$/.test(token)
    );

    if (employeeTokenIndex >= 0) {
      employeeCode = afterTokens[employeeTokenIndex];
      stateTokens = afterTokens.filter((_, index) => index !== employeeTokenIndex);
    }
  }

  const state = extractPunchState(stateTokens, afterDateTime);

  if (!employeeCode || !state) {
    return null;
  }

  return [employeeCode, normalizeDatDateTime(dateTimeMatch[1], dateTimeMatch[2]), ...state];
}

function isLikelyDatHeader(line) {
  const text = String(line || "").toLowerCase();
  return /employee|emp|user|date|time|state|punch|check/.test(text) && !DAT_DATE_TIME_PATTERN.test(text);
}

function convertDatTextToAttendanceCsv(text) {
  const rows = [ATTENDANCE_IMPORT_HEADERS];
  let skippedRows = 0;

  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      if (!line.trim()) {
        return;
      }

      const row = parseDatAttendanceLine(line);
      if (row) {
        rows.push(row);
        return;
      }

      if (!isLikelyDatHeader(line)) {
        skippedRows++;
      }
    });

  if (rows.length === 1) {
    throw new Error("No attendance rows could be converted from this DAT file.");
  }

  return {
    csv: rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    rowCount: rows.length - 1,
    skippedRows,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printDtr(dtr, signatureDataUrl = "") {
  const rows = buildDailyTimeRecordRows(dtr);
  const employeeName = dtr?.employee?.employeeName || "Employee";
  const month = parseDate(`${dtr?.month || new Date().toISOString().slice(0, 7)}-01T00:00:00`);
  const monthLabel = month
    ? month.toLocaleDateString([], { month: "long", year: "numeric" })
    : dtr?.month || "";
  const printWindow = window.open("", "_blank", "width=820,height=900");

  if (!printWindow) {
    toast.error("Unable to open the print window.");
    return;
  }

  const bodyRows = rows
    .map(
      (row) => `
        <tr>
          <td class="day">${escapeHtml(row.day)}</td>
          <td>${escapeHtml(row.amArrival)}</td>
          <td>${escapeHtml(row.amDep)}</td>
          <td>${escapeHtml(row.pmArrival)}</td>
          <td>${escapeHtml(row.pmDep)}</td>
          <td>${escapeHtml(row.T)}</td>
          <td>${escapeHtml(row.U)}</td>
        </tr>
      `
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Daily Time Record - ${escapeHtml(employeeName)}</title>
        <style>
          body { background: #f8fafc; margin: 0; padding: 24px; }
          .dtr { background: #fff; color: #000; font-family: "Times New Roman", Times, serif; margin: 0 auto; padding: 30px; width: 450px; }
          .top { display: flex; font-size: 10px; font-style: italic; justify-content: space-between; margin-bottom: 10px; }
          .header { position: relative; text-align: center; }
          .logo { border: 1px solid #ddd; border-radius: 50%; height: 50px; left: 5px; object-fit: contain; position: absolute; top: 0; width: 50px; }
          h1 { font-size: 14px; margin: 0; text-transform: uppercase; }
          h2 { font-size: 12px; margin: 0; }
          .name { border-bottom: 1px solid #000; display: inline-block; font-size: 14px; font-weight: 700; margin-top: 15px; text-align: center; text-transform: uppercase; width: 85%; }
          .line-value { border-bottom: 1px solid #000; display: inline-block; font-weight: 700; min-width: 220px; text-align: center; }
          .official { align-items: flex-end; display: flex; font-size: 11px; justify-content: space-between; margin-top: 10px; }
          table { border-collapse: collapse; font-size: 11px; margin-top: 10px; width: 100%; }
          th, td { border: 1.5px solid #000; padding: 2px; text-align: center; }
          .day { font-weight: 700; padding-left: 5px; text-align: left; width: 60px; }
          .cert { font-size: 11px; font-style: italic; line-height: 1.4; margin: 25px 0 30px; text-align: center; }
          .sig { border-bottom: 1px solid #000; margin: 0 auto; width: 90%; }
          .caption { font-size: 10px; margin-top: 4px; text-align: center; }
          .dots { font-size: 12px; letter-spacing: 2px; margin-top: 15px; text-align: center; }
          .sig-ink { align-items: flex-end; display: flex; justify-content: center; margin: 0 auto; min-height: 42px; width: 90%; }
          .sig-ink img { display: block; max-height: 42px; max-width: 170px; object-fit: contain; }
          @media print {
            body { background: #fff; padding: 0; }
            .dtr { box-shadow: none; }
            /* Without this the signature is dropped by the browser's "no background graphics" default. */
            .sig-ink img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <main class="dtr">
          <div style="font-size:10px;margin-bottom:5px;">${new Date().toLocaleString()}</div>
          <div class="top"><span>Civil Service Form No. 48</span><span>&gt;&gt;&gt; ORIGINAL COPY</span></div>
          <div class="header">
            <img class="logo" src="/mgb.png" alt="MGB Logo" />
            <h1>Mines and Geosciences Bureau - 10</h1>
            <h2>DAILY TIME RECORD</h2>
            <span class="name">${escapeHtml(employeeName)}</span>
          </div>
          <div style="font-size:11px;margin-top:15px;">
            For the month of <span class="line-value">${escapeHtml(monthLabel)}</span>
            <div class="official">
              <span>Official hours for arrival and departure</span>
              <span style="text-align:right;">Regular days <span class="line-value" style="min-width:35px;">8.00</span><br />Saturdays <span class="line-value" style="min-width:35px;">0.00</span></span>
            </div>
          </div>
          <table>
            <thead>
              <tr><th rowspan="2">Day</th><th colspan="2">A M</th><th colspan="2">P M</th><th colspan="2">REMARKS<br />IN MINUTES</th></tr>
              <tr><th>Arrival</th><th>Departure</th><th>Arrival</th><th>Departure</th><th>T</th><th>U</th></tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
          <div class="cert">I certify on my honor that the above is a true and correct report of the<br />hours work performed, record of which was daily at the time of arrival<br />and departure from office.</div>
          <div class="sig-ink">${signatureDataUrl ? `<img src="${escapeHtml(signatureDataUrl)}" alt="Signature of ${escapeHtml(employeeName)}" />` : ""}</div>
          <div class="sig"></div><div class="caption">Signature</div>
          <div class="dots">---------------------------------------------------------</div><div class="caption">VERIFIED as to the prescribed office hours</div>
          <div class="sig" style="margin-top:35px;"></div><div class="caption"><strong>In Charge</strong></div>
        </main>
        <script>window.onload = () => { window.print(); };</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function SortableHeader({ label, columnKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === columnKey;

  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className="flex w-full items-center justify-between gap-2 border-0 bg-transparent p-0 text-left text-[0.82rem] font-extrabold uppercase text-slate-700"
    >
      <span>{label}</span>
      {isActive ? <span className="sr-only">Sorted {sortConfig.direction}</span> : null}
    </button>
  );
}

function LoadingSkeleton({ showMetricCards = true }) {
  return (
    <div className="space-y-5">
      {showMetricCards ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
      ) : null}
      <div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </div>
  );
}

function buildCalendarDays(records, month) {
  const base = parseDate(`${month}-01T00:00:00`);
  if (!base) {
    return [];
  }

  const recordsByDate = new Map(records.map((record) => [record.date, record]));
  const firstWeekday = base.getDay();
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const leading = Array.from({ length: firstWeekday }, (_, index) => ({ id: `blank-${index}`, blank: true }));
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dateKey = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return {
      id: dateKey,
      day,
      record: recordsByDate.get(dateKey),
    };
  });

  return [...leading, ...days];
}

export default function AttendanceManagementWorkspace({ user, mode }) {
  const roleKey = normalizeRole(mode || user?.roleKey || user?.role);
  const isAdminView = roleKey === "admin";
  const isEmployeeView = roleKey === "employee";
  const [filters, setFilters] = useState(() => readStoredAttendanceFilters(roleKey));
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "desc" });
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [sourceDatFile, setSourceDatFile] = useState(null);
  const [convertingDat, setConvertingDat] = useState(false);
  const [datDragActive, setDatDragActive] = useState(false);
  const [datUploadProgress, setDatUploadProgress] = useState(0);
  const [conversionDetails, setConversionDetails] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [invalidSamples, setInvalidSamples] = useState([]);
  const [dtrOpen, setDtrOpen] = useState(false);
  const [dtrLoading, setDtrLoading] = useState(false);
  const [dtrData, setDtrData] = useState(null);
  const [dtrSignature, setDtrSignature] = useState("");
  const [dtrMonth, setDtrMonth] = useState(() => startOfCurrentMonth().slice(0, 7));
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPayload, setLogsPayload] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState({ timeIn: "", timeOut: "", status: "", reason: "" });
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentRecord, setAdjustmentRecord] = useState(null);
  const [adjustmentForm, setAdjustmentForm] = useState({ timeIn: "", timeOut: "", reason: "" });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(attendanceFilterStorageKey(roleKey), JSON.stringify(filters));
  }, [filters, roleKey]);

  const loadAttendance = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchAttendanceRecords(filters);

      setRecords(result.records || []);
      setSummary(result.summary || null);
      setDepartments(result.departments || []);
      setEmployees(result.employees || []);
      setAdjustments(result.adjustments || []);
      setPermissions(result.permissions || {});
    } catch (error) {
      // A failed background poll keeps the records on screen rather than emptying the table.
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load attendance records.");
        setRecords([]);
        setSummary(null);
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  /* The effect above owns the first load and every filter change; this only adds other people's. */
  useAutoRefreshOnChange(loadAttendance, { topic: "attendance", refreshOnMount: false });

  useEffect(() => {
    setPage(1);
  }, [filters, rowsPerPage]);

  const statusOptions = useMemo(() => {
    const values = new Set(STATUS_OPTIONS);
    records.forEach((record) => values.add(record.status));
    return Array.from(values).filter(Boolean);
  }, [records]);

  const sortedRecords = useMemo(() => {
    const sorted = [...records];
    const { key, direction } = sortConfig;

    sorted.sort((left, right) => {
      const leftValue = left[key] ?? "";
      const rightValue = right[key] ?? "";
      const numericKeys = new Set(["totalMinutes", "lateMinutes", "undertimeMinutes"]);
      let result;

      if (numericKeys.has(key)) {
        result = Number(leftValue) - Number(rightValue);
      } else {
        result = String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      return direction === "asc" ? result : -result;
    });

    return sorted;
  }, [records, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedRecords = useMemo(() => {
    const startIndex = (safePage - 1) * rowsPerPage;
    return sortedRecords.slice(startIndex, startIndex + rowsPerPage);
  }, [rowsPerPage, safePage, sortedRecords]);

  const pendingAdjustments = adjustments.filter((adjustment) => adjustment.status === "pending");
  const incompleteRecords = sortedRecords.filter((record) => String(record.status).toLowerCase() === "incomplete");
  const calendarDays = useMemo(() => buildCalendarDays(records, dtrMonth), [dtrMonth, records]);
  const canImport = Boolean(permissions.canImport);
  const canEdit = Boolean(permissions.canEdit);
  const canApproveAdjustments = Boolean(permissions.canApproveAdjustments);
  const canRequestAdjustment = Boolean(permissions.canRequestAdjustment);

  const metricCards = [
    {
      label: "Attendance Records",
      value: summary?.totalRecords ?? 0,
      helper: isEmployeeView ? "Your attendance days in the selected range." : "Daily attendance rows in the selected range.",
      icon: CalendarDays,
      tone: "bg-teal-700",
    },
    {
      label: "Late Entries",
      value: summary?.late ?? 0,
      helper: "Records with late minutes computed from 8:00 AM.",
      icon: Clock3,
      tone: "bg-amber-700",
    },
    {
      label: "Missing Logs",
      value: summary?.missingTimeLogs ?? 0,
      helper: "Records missing either time in or time out.",
      icon: AlertTriangle,
      tone: "bg-rose-700",
    },
    {
      label: "Rendered Hours",
      value: minutesToDuration(summary?.totalRenderedMinutes ?? 0),
      helper: "Total computed hours after lunch deduction.",
      icon: CheckCircle2,
      tone: "bg-emerald-700",
    },
  ];

  const setFilter = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const processDatFile = async (file) => {
    if (!file) {
      return;
    }

    if (!String(file.name || "").toLowerCase().endsWith(".dat")) {
      toast.error("Choose a DAT file to convert.");
      return;
    }

    setSourceDatFile(file);
    setImportFile(null);
    setImportSummary(null);
    setInvalidSamples([]);
    setConversionDetails(null);
    setConvertingDat(true);
    setDatUploadProgress(0);

    const progressTimer = window.setInterval(() => {
      setDatUploadProgress((current) => {
        if (current >= 92) {
          return current;
        }

        return Math.min(92, current + 8 + Math.round(Math.random() * 10));
      });
    }, 120);

    try {
      const text = await file.text();
      const converted = convertDatTextToAttendanceCsv(text);
      const csvFilename = file.name.replace(/\.dat$/i, "") || "attendance";
      const csvFile = new File([converted.csv], `${csvFilename}.csv`, { type: "text/csv;charset=utf-8;" });

      setImportFile(csvFile);
      setConversionDetails({
        csvName: csvFile.name,
        rowCount: converted.rowCount,
        skippedRows: converted.skippedRows,
      });
      setDatUploadProgress(100);
      toast.success("DAT file converted to CSV.");
    } catch (error) {
      setSourceDatFile(null);
      setImportFile(null);
      setConversionDetails({
        error: error?.message || "Unable to convert the DAT file.",
      });
      setDatUploadProgress(0);
      toast.error(error?.message || "Unable to convert the DAT file.");
    } finally {
      window.clearInterval(progressTimer);
      setConvertingDat(false);
    }
  };

  const handleDatUpload = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    void processDatFile(file);
  };

  const handleDatDragOver = (event) => {
    event.preventDefault();
    if (!convertingDat && !importing) {
      setDatDragActive(true);
    }
  };

  const handleDatDragLeave = (event) => {
    event.preventDefault();
    setDatDragActive(false);
  };

  const handleDatDrop = (event) => {
    event.preventDefault();
    setDatDragActive(false);

    if (convertingDat || importing) {
      return;
    }

    void processDatFile(event.dataTransfer.files?.[0] || null);
  };

  const handleImport = async () => {
    if (!importFile) {
      toast.error("Upload and convert a DAT file before importing.");
      return;
    }

    if (convertingDat) {
      toast.error("Wait for the DAT conversion to finish.");
      return;
    }

    setImporting(true);
    const toastId = toast.loading("Importing converted attendance...");

    try {
      const result = await importAttendanceCsv(importFile);
      const nextImportSummary = result.summary || null;
      setImportSummary(nextImportSummary);
      setInvalidSamples(result.invalidSamples || []);
      if (nextImportSummary?.dateFrom && nextImportSummary?.dateTo) {
        setFilters((current) => ({
          ...current,
          dateFrom: nextImportSummary.dateFrom,
          dateTo: nextImportSummary.dateTo,
        }));
      }
      setImportFile(null);
      setSourceDatFile(null);
      setConversionDetails(null);
      setDatUploadProgress(0);
      toast.success(result.message || "Attendance import completed.", { id: toastId });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to import attendance.", { id: toastId });
    } finally {
      setImporting(false);
    }
  };

  const openDtr = async (record = null) => {
    setDtrOpen(true);
    setDtrLoading(true);
    setDtrData(null);
    // Cleared up front so the previous employee's signature cannot flash on the next DTR.
    setDtrSignature("");

    try {
      const params = record
        ? { recordId: record.id }
        : {
            employeeRecordId: employees[0]?.employeeRecordId,
            month: dtrMonth,
          };
      const result = await fetchAttendanceDtr(params);
      setDtrData(result);
      setDtrSignature(await loadDtrSignature(result));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to generate DTR.");
      setDtrOpen(false);
    } finally {
      setDtrLoading(false);
    }
  };

  const printRecordDtr = async (record) => {
    try {
      const result = await fetchAttendanceDtr(record ? { recordId: record.id } : { employeeRecordId: employees[0]?.employeeRecordId, month: dtrMonth });
      printDtr(result, await loadDtrSignature(result));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to print DTR.");
    }
  };

  const openLogs = async (record) => {
    setLogsOpen(true);
    setLogsLoading(true);
    setLogsPayload(null);

    try {
      const result = await fetchAttendanceLogs(record.id);
      setLogsPayload(result);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to load attendance logs.");
      setLogsOpen(false);
    } finally {
      setLogsLoading(false);
    }
  };

  const openEdit = (record) => {
    setEditingRecord(record);
    setEditForm({
      timeIn: toDateTimeInput(record.timeIn, record.date),
      timeOut: toDateTimeInput(record.timeOut, record.date),
      status: record.status || "Incomplete",
      reason: "Manual attendance correction",
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editingRecord) {
      return;
    }

    try {
      await updateAttendanceRecord(editingRecord.id, editForm);
      toast.success("Attendance record updated.");
      setEditOpen(false);
      setEditingRecord(null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update attendance.");
    }
  };

  const openAdjustmentRequest = (record) => {
    setAdjustmentRecord(record);
    setAdjustmentForm({
      timeIn: toDateTimeInput(record.timeIn, record.date),
      timeOut: toDateTimeInput(record.timeOut, record.date),
      reason: "",
    });
    setAdjustmentOpen(true);
  };

  const submitAdjustmentRequest = async () => {
    if (!adjustmentRecord) {
      return;
    }

    if (!adjustmentForm.reason.trim()) {
      toast.error("Reason for adjustment is required.");
      return;
    }

    try {
      await requestAttendanceAdjustment(adjustmentRecord.id, adjustmentForm);
      toast.success("Attendance adjustment request submitted.");
      setAdjustmentOpen(false);
      setAdjustmentRecord(null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to request adjustment.");
    }
  };

  const handleAdjustmentDecision = async (adjustment, status) => {
    try {
      await updateAttendanceAdjustmentStatus(adjustment.id, status);
      toast.success(status === "approved" ? "Adjustment approved." : "Adjustment rejected.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update adjustment.");
    }
  };

  const downloadCurrentDtr = () => {
    if (!dtrData) {
      return;
    }

    downloadCsv(`attendance-${dtrData.employee?.employeeId || "employee"}-${dtrData.month}.csv`, buildDtrTemplateRows(dtrData));
    toast.success("Attendance template CSV generated.");
  };

  const attendanceColumns = [
    {
      key: "index",
      header: "No.",
      headerClassName: "w-[76px]",
      cellClassName: "w-[76px]",
      render: (_row, index) => (
        <span className="font-semibold text-slate-700">
          {(safePage - 1) * rowsPerPage + index + 1}
        </span>
      ),
    },
    {
      key: "employeeName",
      header: <SortableHeader label="Employee Name" columnKey="employeeName" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{row.employeeName || "N/A"}</p>
        </div>
      ),
    },
    {
      key: "department",
      header: <SortableHeader label="Division" columnKey="department" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => row.department || "Unassigned division",
    },
    {
      key: "date",
      header: <SortableHeader label="Date" columnKey="date" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => formatDate(row.date),
    },
    {
      key: "timeIn",
      header: <SortableHeader label="AM In" columnKey="timeIn" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => formatTime(row.amTimeIn || row.timeIn),
    },
    {
      key: "amTimeOut",
      header: "AM Out",
      render: (row) => formatTime(row.amTimeOut),
    },
    {
      key: "pmTimeIn",
      header: "PM In",
      render: (row) => formatTime(row.pmTimeIn),
    },
    {
      key: "timeOut",
      header: <SortableHeader label="PM Out" columnKey="timeOut" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => formatTime(row.pmTimeOut || row.timeOut),
    },
    {
      key: "totalMinutes",
      header: <SortableHeader label="Total Hours" columnKey="totalMinutes" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => minutesToDuration(row.totalMinutes),
    },
    {
      key: "lateMinutes",
      header: <SortableHeader label="Late" columnKey="lateMinutes" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => `${row.lateMinutes || 0} min`,
    },
    {
      key: "undertimeMinutes",
      header: <SortableHeader label="Undertime" columnKey="undertimeMinutes" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => `${row.undertimeMinutes || 0} min`,
    },
    {
      key: "status",
      header: <SortableHeader label="Status" columnKey="status" sortConfig={sortConfig} onSort={handleSort} />,
      render: (row) => (
        <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${statusClasses(row.status)}`}>
          {row.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex min-w-[170px] flex-wrap items-center gap-2">
          <ActionIconButton
            label="View DTR"
            icon={faEye}
            tone="view"
            onClick={() => openDtr(row)}
          />
          <ActionIconButton
            label="View attendance logs"
            icon={faClockRotateLeft}
            tone="review"
            text="Logs"
            onClick={() => openLogs(row)}
          />
          <ActionIconButton
            label="Print DTR"
            icon={faPrint}
            tone="print"
            onClick={() => printRecordDtr(row)}
          />
          {canEdit ? (
            <ActionIconButton
              label="Edit attendance record"
              icon={faPen}
              tone="edit"
              onClick={() => openEdit(row)}
            />
          ) : null}
          {canRequestAdjustment ? (
            <ActionIconButton
              label="Request attendance adjustment"
              icon={faFilePen}
              tone="edit"
              text="Request"
              onClick={() => openAdjustmentRequest(row)}
            />
          ) : null}
        </div>
      ),
    },
  ];

  const logColumns = [
    { key: "punchAt", header: "Punch Date & Time", render: (row) => formatDateTime(row.punchAt) },
    {
      key: "punchTypeLabel",
      header: "Punch Type",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${row.punchType === "time_in" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-200 bg-sky-50 text-sky-700"}`}>
          {row.punchTypeLabel}
        </span>
      ),
    },
    { key: "rawState", header: "Raw State", render: (row) => row.rawState || "N/A" },
    { key: "source", header: "Source", render: (row) => row.source || "CSV" },
  ];

  const adjustmentColumns = [
    {
      key: "employeeName",
      header: "Employee",
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{row.employeeName}</p>
          <p className="m-0 mt-1 text-xs text-slate-500">{row.employeeId}</p>
        </div>
      ),
    },
    { key: "date", header: "Date", render: (row) => formatDate(row.date) },
    { key: "requestedTimeIn", header: "Requested In", render: (row) => formatTime(row.requestedTimeIn) },
    { key: "requestedTimeOut", header: "Requested Out", render: (row) => formatTime(row.requestedTimeOut) },
    { key: "reason", header: "Reason", render: (row) => row.reason || "N/A" },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${adjustmentStatusClasses(row.status)}`}>
          {row.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) =>
        canApproveAdjustments && row.status === "pending" ? (
          <div className="flex items-center gap-2">
            <ActionIconButton
              label="Approve attendance adjustment"
              icon={faCheck}
              tone="approve"
              onClick={() => handleAdjustmentDecision(row, "approved")}
            />
            <ActionIconButton
              label="Reject attendance adjustment"
              icon={faXmark}
              tone="reject"
              onClick={() => handleAdjustmentDecision(row, "rejected")}
            />
          </div>
        ) : (
          <span className="text-sm text-slate-500">Reviewed</span>
        ),
    },
  ];

  /**
   * One filter bar in the shared record-table format: h-9 pill controls on a single grid row, the
   * same shape the leave, travel order, and pass slip screens use.
   */
  const renderAttendanceFilters = () => (
    <div
      className={
        isEmployeeView
          ? "mt-4 grid gap-3 lg:grid-cols-[160px_160px_160px_120px]"
          : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_150px_150px_160px_160px_120px]"
      }
    >
      {!isEmployeeView ? (
        <label className="relative">
          <span className="sr-only">Search employee</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
            placeholder="Search name or employee ID"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>
      ) : null}
      <input
        type="date"
        aria-label="Filter from date"
        value={filters.dateFrom}
        onChange={(event) => setFilter("dateFrom", event.target.value)}
        className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      />
      <input
        type="date"
        aria-label="Filter to date"
        value={filters.dateTo}
        onChange={(event) => setFilter("dateTo", event.target.value)}
        className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      />
      {!isEmployeeView ? (
        <select
          aria-label="Filter by division"
          value={filters.department}
          onChange={(event) => setFilter("department", event.target.value)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        >
          <option value="">All divisions</option>
          {departments.map((department) => (
            <option key={department} value={department}>{department}</option>
          ))}
        </select>
      ) : null}
      <select
        aria-label="Filter by status"
        value={filters.status}
        onChange={(event) => setFilter("status", event.target.value)}
        className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      >
        <option value="">All statuses</option>
        {statusOptions.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
      <select
        aria-label="Rows per page"
        value={rowsPerPage}
        onChange={(event) => setRowsPerPage(Number(event.target.value) || DEFAULT_ROWS_PER_PAGE)}
        className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      >
        {[5, 10, 15, 25, 50].map((value) => (
          <option key={value} value={value}>{value} rows</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-5">

      {!isAdminView ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">
              {isEmployeeView ? "My Attendance" : "Attendance Management"}
            </h3>
            <p className="m-0 mt-1 max-w-3xl text-sm text-slate-500">
              {isEmployeeView
                ? "View personal attendance logs, DTR records, calendar history, and adjustment requests."
                : "Import DAT logs, monitor daily attendance, generate DTR forms, and manage attendance adjustments."}
            </p>
          </div>
          {isEmployeeView ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openDtr()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Eye size={16} />
                View DTR
              </button>
              <button
                type="button"
                onClick={() => printRecordDtr(null)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <Printer size={16} />
                Print DTR
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <LoadingSkeleton showMetricCards={!isAdminView && !isEmployeeView} />
      ) : (
        <>
          {!isAdminView && !isEmployeeView ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((metric) => {
                const Icon = metric.icon;

                return (
                  <Card key={metric.label} className="shadow-sm">
                    <CardContent className="grid gap-3">
                      <div className={`grid h-11 w-11 place-items-center rounded-lg text-white ${metric.tone}`}>
                        <Icon size={20} />
                      </div>
                      <div>
                        <p className="m-0 text-sm font-semibold text-slate-500">{metric.label}</p>
                        <strong className="mt-2 block text-lg font-semibold text-slate-900">{metric.value}</strong>
                        <p className="mt-2 text-sm leading-6 text-slate-500">{metric.helper}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          ) : null}

          {!isAdminView && !isEmployeeView ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div>
                <h3 className="m-0 flex items-center gap-2 text-base font-semibold text-slate-950">
                  <SlidersHorizontal size={18} />
                  Attendance Filters
                </h3>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  Search employees, narrow by date range, division, and attendance status.
                </p>
              </div>
              {renderAttendanceFilters()}
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="m-0 text-base font-semibold text-slate-950">Attendance Records</h3>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  Imported logs grouped by employee and date with computed hours, late minutes, undertime, and status.
                </p>
              </div>
              {canImport ? (
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
                >
                  <UploadCloud size={16} />
                  Import Attendance
                </button>
              ) : null}
            </div>

            {isAdminView || isEmployeeView ? renderAttendanceFilters() : null}

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <Table
                columns={attendanceColumns}
                data={paginatedRecords}
                rowKey="id"
                emptyMessage="No attendance records found."
                stickyHeader
                className="max-h-[560px] overflow-y-auto"
                tableClassName="min-w-[1540px]"
              />
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-sm text-slate-500">
                Showing {sortedRecords.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1} to {Math.min(safePage * rowsPerPage, sortedRecords.length)} of {sortedRecords.length} attendance records
              </p>
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {isEmployeeView ? (
              <Card className="shadow-sm">
                <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Attendance Calendar</CardTitle>
                    <CardDescription>Monthly view of your personal attendance status.</CardDescription>
                  </div>
                  <input
                    type="month"
                    value={dtrMonth}
                    onChange={(event) => setDtrMonth(event.target.value)}
                    className="min-h-[42px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none"
                    aria-label="Attendance calendar month"
                  />
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase text-slate-500">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-7 gap-2">
                    {calendarDays.map((day) => (
                      <div
                        key={day.id}
                        className={`min-h-[72px] rounded-lg border p-2 text-sm ${
                          day.blank
                            ? "border-transparent"
                            : day.record
                              ? statusClasses(day.record.status)
                              : "border-slate-200 bg-white text-slate-400"
                        }`}
                      >
                        {day.blank ? null : (
                          <>
                            <span className="font-semibold">{day.day}</span>
                            <span className="mt-1 block text-[0.68rem] font-semibold">
                              {day.record?.status || "No log"}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Missing Time Logs</CardTitle>
                  <CardDescription>Records that still need time in or time out completion.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {incompleteRecords.length > 0 ? (
                    incompleteRecords.slice(0, 6).map((record) => (
                      <div key={record.id} className="flex items-center justify-between gap-3 rounded-lg border border-rose-100 bg-rose-50 px-4 py-3">
                        <div>
                          <p className="m-0 text-sm font-semibold text-slate-900">{record.employeeName}</p>
                          <p className="m-0 mt-1 text-xs text-rose-700">{formatDate(record.date)} has incomplete logs.</p>
                        </div>
                        <Button size="sm" variant="secondary" icon={History} onClick={() => openLogs(record)}>
                          Logs
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-5 text-sm font-semibold text-emerald-700">
                      No missing time logs in the selected range.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div>
                <h3 className="m-0 text-base font-semibold text-slate-950">
                  {canApproveAdjustments ? "Attendance Adjustment Queue" : "Attendance Adjustment History"}
                </h3>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  {canApproveAdjustments
                    ? "Review employee requests for corrected time in and time out values."
                    : "Track submitted attendance adjustment requests and review decisions."}
                </p>
              </div>

              {adjustments.length > 0 ? (
                <>
                  {canApproveAdjustments ? (
                    <p className="m-0 mt-4 text-sm font-semibold text-amber-700">
                      {pendingAdjustments.length} pending adjustment{pendingAdjustments.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                    <Table
                      columns={adjustmentColumns}
                      data={adjustments.slice(0, 8)}
                      rowKey="id"
                      emptyMessage="No attendance adjustments found."
                      tableClassName="min-w-[920px]"
                    />
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  No adjustment requests found.
                </div>
              )}
            </section>
          </section>
        </>
      )}

      <Modal
        open={importOpen}
        title="Import Attendance"
        onClose={() => setImportOpen(false)}
        maxWidth="max-w-[760px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>Close</Button>
            {importFile ? (
              <Button icon={FileSpreadsheet} loading={importing} onClick={handleImport}>
                Import This Attendance
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-4">
          <style>{ATTENDANCE_PROGRESS_STRIPE_KEYFRAMES}</style>

          <div className="flex justify-center">
            <label
              htmlFor="attendanceDatFile"
              onDragOver={handleDatDragOver}
              onDragLeave={handleDatDragLeave}
              onDrop={handleDatDrop}
              className={[
                "group flex w-full max-w-[330px] flex-col items-center rounded-[28px] border-2 border-dashed border-slate-300 bg-white px-4 py-5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200",
                datDragActive
                  ? "border-slate-900 bg-slate-50 shadow-lg shadow-slate-200/60"
                  : "hover:border-slate-400 hover:bg-slate-50",
                convertingDat || importing ? "pointer-events-none opacity-90" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                id="attendanceDatFile"
                type="file"
                accept=".dat,application/octet-stream,text/plain"
                className="sr-only"
                disabled={convertingDat || importing}
                onChange={handleDatUpload}
              />

              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-slate-200 bg-amber-100 text-amber-600 shadow-sm transition group-hover:scale-[1.02]">
                {convertingDat ? (
                  <Loader2 className="animate-spin" size={30} aria-hidden="true" />
                ) : (
                  <FolderUp size={34} aria-hidden="true" />
                )}
              </div>

              <div className="mt-5 space-y-1">
                <p className="m-0 text-lg font-semibold text-slate-950">Drop files here</p>
                <p className="m-0 text-sm text-slate-500">or click to browse</p>
                {sourceDatFile ? (
                  <p className="m-0 text-xs font-medium text-slate-500">{sourceDatFile.name} - {formatFileSize(sourceDatFile.size)}</p>
                ) : (
                  <p className="m-0 text-xs text-slate-400">DAT format only. Max {ATTENDANCE_DAT_MB_LIMIT} MB.</p>
                )}
              </div>

              <span className="mt-5 inline-flex min-w-[118px] items-center justify-center rounded-[10px] bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition group-hover:bg-slate-800 group-hover:shadow-md">
                Choose Files
              </span>
            </label>
          </div>

          {(convertingDat || datUploadProgress > 0) ? (
            <div className="mx-auto w-full max-w-[330px] rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-4 text-sm font-semibold text-slate-700">
                <span>Upload Progress</span>
                <span className="tabular-nums">{datUploadProgress}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-slate-900 transition-[width] duration-300 ease-out"
                  style={{
                    width: `${datUploadProgress}%`,
                    backgroundImage: convertingDat
                      ? "linear-gradient(135deg, rgba(255,255,255,0.24) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.24) 50%, rgba(255,255,255,0.24) 75%, transparent 75%, transparent 100%)"
                      : "none",
                    backgroundSize: convertingDat ? "24px 24px" : "auto",
                    animation: convertingDat ? "attendance-progress-stripes 1.1s linear infinite" : "none",
                  }}
                />
              </div>
            </div>
          ) : null}

          {!convertingDat && conversionDetails?.csvName ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 text-emerald-700" size={22} />
              <div>
                <p className="m-0 font-semibold">{conversionDetails.csvName}</p>
                <p className="m-0 mt-1">
                  {conversionDetails.rowCount} attendance rows ready
                  {conversionDetails.skippedRows ? `, ${conversionDetails.skippedRows} rows skipped` : ""}.
                </p>
              </div>
            </div>
          ) : null}

          {!convertingDat && conversionDetails?.error ? (
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {conversionDetails.error}
            </div>
          ) : null}

          {importSummary ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Total imported", importSummary.totalImported],
                ["Duplicates skipped", importSummary.duplicatesSkipped],
                ["Invalid rows", importSummary.invalidRows],
                ["Successful records", importSummary.successfulRecords],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                  <p className="m-0 text-xs font-semibold uppercase text-slate-500">{label}</p>
                  <strong className="mt-2 block text-lg text-slate-900">{value || 0}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {invalidSamples.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-900">Invalid row samples</p>
              <div className="space-y-2">
                {invalidSamples.map((sample) => (
                  <div key={sample.line} className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    Line {sample.line}: {sample.reason}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={dtrOpen}
        title="Daily Time Record"
        onClose={() => setDtrOpen(false)}
        maxWidth="max-w-[1040px]"
        footer={
          <>
            <Button variant="secondary" icon={Download} onClick={downloadCurrentDtr} disabled={!dtrData}>Download CSV</Button>
            <Button variant="secondary" icon={Printer} onClick={() => dtrData && printDtr(dtrData, dtrSignature)} disabled={!dtrData}>Print DTR</Button>
            <Button onClick={() => setDtrOpen(false)}>Close</Button>
          </>
        }
      >
        {dtrLoading ? (
          <div className="h-[520px] animate-pulse rounded-lg bg-slate-100" />
        ) : dtrData ? (
          /*
           * The form column has to be `1fr`, not a fixed cap: `DailyTimeRecord` renders the printed
           * CS Form No. 48 at a fixed 510px (450px sheet + 30px padding a side), so any column
           * narrower than that clips the sheet through the middle of the AM/PM columns. `minmax(0,…)`
           * lets the column still shrink below that on small screens and hand the overflow to the
           * scroller instead of pushing the modal wide.
           */
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="overflow-x-auto rounded-lg bg-slate-100 px-4 py-5">
              <DailyTimeRecord dtr={dtrData} signatureDataUrl={dtrSignature} />
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="m-0 text-xs font-semibold uppercase text-slate-500">Employee</p>
                <strong className="mt-1 block text-slate-900">{dtrData.employee?.employeeName}</strong>
                <span className="text-sm text-slate-500">{dtrData.employee?.employeeId}</span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="m-0 text-xs font-semibold uppercase text-slate-500">Rendered</p>
                <strong className="mt-1 block text-xl text-slate-900">{minutesToDuration(dtrData.totals?.renderedMinutes)}</strong>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="m-0 text-xs font-semibold uppercase text-slate-500">Late / Undertime</p>
                <strong className="mt-1 block text-xl text-slate-900">
                  {(dtrData.totals?.lateMinutes || 0)} min / {(dtrData.totals?.undertimeMinutes || 0)} min
                </strong>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={logsOpen}
        title="Attendance Logs"
        onClose={() => setLogsOpen(false)}
        maxWidth="max-w-[760px]"
      >
        {logsLoading ? (
          <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
        ) : logsPayload ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="m-0 font-semibold text-slate-900">{logsPayload.record?.employeeName}</p>
              <p className="m-0 mt-1 text-sm text-slate-500">{formatDate(logsPayload.record?.date)}</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <Table columns={logColumns} data={logsPayload.logs || []} rowKey="id" emptyMessage="No logs found." />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={editOpen}
        title="Edit Attendance"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button icon={CheckCircle2} onClick={submitEdit}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="m-0 font-semibold text-slate-900">{editingRecord?.employeeName}</p>
            <p className="m-0 mt-1 text-sm text-slate-500">{formatDate(editingRecord?.date)}</p>
          </div>
          <InputField label="Time In" name="editTimeIn" type="datetime-local" value={editForm.timeIn} onChange={(event) => setEditForm((current) => ({ ...current, timeIn: event.target.value }))} />
          <InputField label="Time Out" name="editTimeOut" type="datetime-local" value={editForm.timeOut} onChange={(event) => setEditForm((current) => ({ ...current, timeOut: event.target.value }))} />
          <div>
            <label htmlFor="editStatus" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Attendance
            </label>
            <select
              id="editStatus"
              value={editForm.status}
              onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}
              className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 outline-none focus:border-slate-400"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="editReason" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Reason
            </label>
            <textarea
              id="editReason"
              value={editForm.reason}
              onChange={(event) => setEditForm((current) => ({ ...current, reason: event.target.value }))}
              className="min-h-[96px] w-full rounded-lg border border-slate-200 px-3.5 py-3 text-slate-900 outline-none"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={adjustmentOpen}
        title="Request Attendance Adjustment"
        onClose={() => setAdjustmentOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustmentOpen(false)}>Cancel</Button>
            <Button icon={CheckCircle2} onClick={submitAdjustmentRequest}>Submit Request</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="m-0 font-semibold text-slate-900">{adjustmentRecord?.employeeName}</p>
            <p className="m-0 mt-1 text-sm text-slate-500">{formatDate(adjustmentRecord?.date)}</p>
          </div>
          <InputField label="Requested Time In" name="adjustTimeIn" type="datetime-local" value={adjustmentForm.timeIn} onChange={(event) => setAdjustmentForm((current) => ({ ...current, timeIn: event.target.value }))} />
          <InputField label="Requested Time Out" name="adjustTimeOut" type="datetime-local" value={adjustmentForm.timeOut} onChange={(event) => setAdjustmentForm((current) => ({ ...current, timeOut: event.target.value }))} />
          <div>
            <label htmlFor="adjustmentReason" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Reason
            </label>
            <textarea
              id="adjustmentReason"
              value={adjustmentForm.reason}
              onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Explain why this attendance entry needs adjustment."
              className="min-h-[110px] w-full rounded-lg border border-slate-200 px-3.5 py-3 text-slate-900 outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
