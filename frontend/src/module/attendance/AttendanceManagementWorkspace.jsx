import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  Loader2,
  Printer,
  Search,
  SlidersHorizontal,
  UploadCloud,
} from "lucide-react";
import { faBoxArchive, faClockRotateLeft, faEye, faPen, faPrint, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
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
  fetchAttendanceImportHistory,
  fetchAttendanceLogs,
  fetchAttendanceRecords,
  exportAttendanceDtrExcel,
  importAttendanceCsv,
  updateAttendanceRecord,
} from "../../services/attendanceService";
import { getEmployeeSignature } from "../../services/api";
import { normalizeRole, resolveUserRoleKey } from "../../utils/roleRoutes";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import {
  ATTENDANCE_CUTOFF_OPTIONS,
  ATTENDANCE_DAT_BYTE_LIMIT,
  ATTENDANCE_DAT_MB_LIMIT,
  buildAttendanceCutoffCsv,
  convertDatTextToAttendanceCsv,
  formatAttendanceCutoffLabel,
  formatAttendanceFileSize,
  getAttendanceCutoffRange,
  readAttendanceDatFile,
} from "../../utils/attendanceDat";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import DailyTimeRecord, {
  buildDailyTimeRecordRows,
  dailyTimeRecordFileName,
  exportDailyTimeRecordPdf,
} from "./DailyTimeRecord";

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

const STATUS_OPTIONS = ["Present", "Late", "Incomplete", "Absent", "Leave with Pay", "Leave Without Pay"];
const DEFAULT_ROWS_PER_PAGE = 10;
const IMPORT_HISTORY_PAGE_SIZE = 10;
const ATTENDANCE_FILTER_STORAGE_PREFIX = "hris-attendance-filters";
const ATTENDANCE_FILTER_KEYS = ["search", "dateFrom", "dateTo", "department", "status"];
/* Long enough to cover the gap between keystrokes, short enough not to feel like a stall. */
const ATTENDANCE_SEARCH_DEBOUNCE_MS = 350;
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

function defaultAttendanceFilters(roleKey) {
  const isPersonalView = roleKey === "employee";

  return {
    search: "",
    // Personal attendance must not silently hide an older biometric import. Management still opens
    // on the current month because its cross-employee result set can be much larger.
    dateFrom: isPersonalView ? "" : startOfCurrentMonth(),
    dateTo: isPersonalView ? "" : toLocalDateInput(),
    department: "",
    status: "",
  };
}

function attendanceFilterStorageKey(roleKey) {
  // v2 gives existing personal screens a one-time reset from the old current-month defaults, which
  // otherwise keep hiding attendance imported for a previous month even after this fix ships.
  const version = roleKey === "employee" ? ":v2" : "";
  return `${ATTENDANCE_FILTER_STORAGE_PREFIX}:${roleKey || "default"}${version}`;
}

function readStoredAttendanceFilters(roleKey) {
  const defaults = defaultAttendanceFilters(roleKey);

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
      // A remembered status that no longer exists (the retired "Undertime") would match nothing.
      status: STATUS_OPTIONS.includes(parsed.status) ? parsed.status : "",
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

/* Opens on the cut-off HR is most likely closing right now: this month, the half today falls in. */
function defaultImportCutoff() {
  const today = new Date();
  return {
    month: startOfCurrentMonth().slice(0, 7),
    period: today.getDate() <= 15 ? "1st Half" : "2nd Half",
  };
}

/**
 * Steps a "YYYY-MM" value by whole months for the calendar's back/next buttons.
 *
 * Day 1 is what makes December -> January work: Date rolls the year over on its own, but only if the
 * day of month exists in the target month, and today's date might be the 31st.
 */
function shiftMonth(month, offset) {
  const base = parseDate(`${month}-01T00:00:00`);
  if (!base) {
    return month;
  }

  const shifted = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month) {
  const base = parseDate(`${month}-01T00:00:00`);
  return base ? base.toLocaleDateString([], { month: "long", year: "numeric" }) : month;
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

/* Muted zeros keep the eye on the counts that matter in a row of mostly-zero tallies. */
function ImportCount({ value, tone = "text-slate-900" }) {
  const count = Number(value) || 0;
  return <span className={`tabular-nums ${count === 0 ? "text-slate-400" : `font-semibold ${tone}`}`}>{count}</span>;
}

const importHistoryColumns = [
  {
    key: "importedAt",
    header: "Imported",
    render: (row) => (
      <div>
        <p className="m-0 font-semibold text-slate-900">{formatDateTime(row.importedAt)}</p>
        <p className="m-0 mt-0.5 text-xs text-slate-500">by {row.importedBy || "Unknown user"}</p>
      </div>
    ),
  },
  {
    key: "cutoff",
    header: "Cut-off",
    render: (row) => (
      <div>
        <p className="m-0 font-semibold text-slate-900">{row.cutoffLabel || "Whole file"}</p>
        {row.dateFrom && row.dateTo ? (
          <p className="m-0 mt-0.5 text-xs text-slate-500">{formatDate(row.dateFrom)} – {formatDate(row.dateTo)}</p>
        ) : null}
      </div>
    ),
  },
  {
    key: "fileName",
    header: "File",
    render: (row) => <span className="break-all text-slate-700">{row.fileName}</span>,
  },
  { key: "totalImported", header: "New punches", render: (row) => <ImportCount value={row.totalImported} tone="text-emerald-700" /> },
  { key: "duplicatesSkipped", header: "Duplicates", render: (row) => <ImportCount value={row.duplicatesSkipped} /> },
  { key: "invalidRows", header: "Invalid", render: (row) => <ImportCount value={row.invalidRows} tone="text-rose-700" /> },
  { key: "outsideCutoffRows", header: "Outside cut-off", render: (row) => <ImportCount value={row.outsideCutoffRows} tone="text-amber-700" /> },
  { key: "successfulRecords", header: "Daily records", render: (row) => <ImportCount value={row.successfulRecords} /> },
  { key: "absentRecordsCreated", header: "Absent", render: (row) => <ImportCount value={row.absentRecordsCreated} /> },
  { key: "leaveRecordsCreated", header: "Leave", render: (row) => <ImportCount value={row.leaveRecordsCreated} /> },
];

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

  if (value === "incomplete") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (value === "absent") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (value === "leave with pay") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (value === "leave without pay") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
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

  const printTimestamp = new Date().toLocaleString();
  const sheetHtml = (copyLabel) => `
    <main class="dtr">
      <div style="font-size:10px;margin-bottom:5px;">${printTimestamp}</div>
      <div class="top"><span>Civil Service Form No. 48</span><span>&gt;&gt;&gt; ${escapeHtml(copyLabel)}</span></div>
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
  `;

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Daily Time Record - ${escapeHtml(employeeName)}</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          body { background: #f8fafc; margin: 0; padding: 24px; }
          .dtr-pair { display: flex; gap: 20px; margin: 0 auto; width: max-content; }
          .dtr { background: #fff; color: #000; font-family: "Times New Roman", Times, serif; margin: 0 auto; padding: 30px; width: 450px; }
          .top { display: flex; font-size: 10px; font-style: italic; justify-content: space-between; margin-bottom: 10px; }
          .header { min-height: 80px; position: relative; text-align: center; }
          .logo { height: 80px; left: 5px; object-fit: fill; position: absolute; top: -8px; width: 50px; }
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
            .dtr-pair { align-items: flex-start; display: flex; gap: 4mm; width: 100%; }
            .dtr { box-shadow: none; box-sizing: border-box; flex: 1 1 0; margin: 0; min-width: 0; padding: 3mm; width: 0; }
            /* Without this the signature is dropped by the browser's "no background graphics" default. */
            .sig-ink img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="dtr-pair">
          ${sheetHtml("ORIGINAL COPY")}
          ${sheetHtml("DUPLICATE COPY")}
        </div>
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
  // An explicit `mode` still wins; otherwise resolve through the base role so a custom role
  // gets the same view as the role it was built on.
  const roleKey = mode ? normalizeRole(mode) : resolveUserRoleKey(user);
  const isAdminView = roleKey === "admin";
  const isEmployeeView = roleKey === "employee";
  const showDivisionFilter = !isEmployeeView;
  /*
   * Admin and HR Staff work the records table directly, so they get the compact layout: filters sit
   * inline under "Attendance Records" with no metric cards or separate filter card above it. The
   * other management roles keep the overview cards.
   */
  const showOverviewCards = !isAdminView && !isEmployeeView && roleKey !== "hrstaff";
  const [filters, setFilters] = useState(() => readStoredAttendanceFilters(roleKey));
  /*
   * What the request actually uses. It trails `filters` so the controls can update on every
   * keystroke while the fetch waits for the typing to stop -- searching for "dela cruz" used to
   * fire nine requests, one per character, each replacing the results of the one before it.
   *
   * Only the text box is delayed. A date, division or status change is a single deliberate act, so
   * it goes straight through and the list updates immediately.
   */
  const [queryFilters, setQueryFilters] = useState(filters);
  const initialLoadDoneRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  // Declared with the rest of the state rather than beside `canArchive` below, because
  // loadAttendance closes over it and lists it as a dependency well before that point.
  const [archiveView, setArchiveView] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "desc" });
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSourceMode, setImportSourceMode] = useState("dat");
  const [sourceDatFile, setSourceDatFile] = useState(null);
  const [sourceExcelFile, setSourceExcelFile] = useState(null);
  const [convertingDat, setConvertingDat] = useState(false);
  const [datDragActive, setDatDragActive] = useState(false);
  const [datUploadProgress, setDatUploadProgress] = useState(0);
  /*
   * The whole converted file is kept, not just the CSV, so changing the cut-off below re-cuts it
   * in place instead of asking for the DAT file again. `{ error }` when the conversion failed.
   */
  const [datConversion, setDatConversion] = useState(null);
  const [importCutoff, setImportCutoff] = useState(defaultImportCutoff);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [importHistoryLoading, setImportHistoryLoading] = useState(false);
  const [importHistory, setImportHistory] = useState({ imports: [], total: 0, page: 1, pageSize: IMPORT_HISTORY_PAGE_SIZE });
  const [importSummary, setImportSummary] = useState(null);
  const [invalidSamples, setInvalidSamples] = useState([]);
  const [dtrOpen, setDtrOpen] = useState(false);
  const [dtrLoading, setDtrLoading] = useState(false);
  const [dtrData, setDtrData] = useState(null);
  const [dtrSignature, setDtrSignature] = useState("");
  const [dtrPdfSaving, setDtrPdfSaving] = useState(false);
  const [dtrExcelSaving, setDtrExcelSaving] = useState(false);
  const dtrSheetRef = useRef(null);
  const [dtrMonth, setDtrMonth] = useState(() => {
    const selectedDate = filters.dateTo || filters.dateFrom;
    return /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      ? selectedDate.slice(0, 7)
      : startOfCurrentMonth().slice(0, 7);
  });
  const personalMonthInitializedRef = useRef(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPayload, setLogsPayload] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState({ timeIn: "", timeOut: "", status: "", reason: "" });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(attendanceFilterStorageKey(roleKey), JSON.stringify(filters));
  }, [filters, roleKey]);

  useEffect(() => {
    if (ATTENDANCE_FILTER_KEYS.every((key) => filters[key] === queryFilters[key])) {
      // Already in step. Bailing here is what stops this effect re-arming itself forever, since
      // `filters` is a fresh object on every change and would otherwise never compare equal.
      return undefined;
    }

    const delay = filters.search === queryFilters.search ? 0 : ATTENDANCE_SEARCH_DEBOUNCE_MS;
    const timer = window.setTimeout(() => setQueryFilters(filters), delay);

    return () => window.clearTimeout(timer);
  }, [filters, queryFilters]);

  const loadAttendance = useCallback(async ({ background = false } = {}) => {
    /*
     * Only the very first fetch puts the skeleton up. Every later one leaves the screen standing and
     * raises `refreshing` instead: `loading` swaps the whole workspace -- metric cards, filter bar
     * and all -- for a placeholder, so refetching on a filter change tore the controls out from
     * under the pointer and re-mounted them, which read as the page reloading itself.
     */
    if (initialLoadDoneRef.current) {
      if (!background) {
        setRefreshing(true);
      }
    } else {
      setLoading(true);
    }

    try {
      const result = await fetchAttendanceRecords(
        {
          ...queryFilters,
          ...(archiveView ? { archived: 1 } : {}),
          ...(isEmployeeView ? { scope: "personal" } : {}),
        }
      );

      setRecords(result.records || []);
      setSummary(result.summary || null);
      setDepartments(result.departments || []);
      setEmployees(result.employees || []);
      setPermissions(result.permissions || {});

      if (isEmployeeView && !personalMonthInitializedRef.current) {
        const importedDates = (result.records || [])
          .map((record) => String(record?.date || ""))
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          .sort();
        const latestImportedMonth = importedDates.at(-1)?.slice(0, 7);
        const currentMonth = startOfCurrentMonth().slice(0, 7);
        const currentMonthHasRecords = importedDates.some((date) => date.startsWith(`${currentMonth}-`));
        const selectedFilterDate = queryFilters.dateTo || queryFilters.dateFrom;
        const hasSelectedFilterDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedFilterDate);

        if (!hasSelectedFilterDate && latestImportedMonth && !currentMonthHasRecords) {
          setDtrMonth(latestImportedMonth);
        }
        personalMonthInitializedRef.current = true;
      }
    } catch (error) {
      // A failed background poll keeps the records on screen rather than emptying the table.
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load attendance records.");
        setRecords([]);
        setSummary(null);
      }
    } finally {
      initialLoadDoneRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [archiveView, isEmployeeView, queryFilters]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  /* The effect above owns the first load and every filter change; this only adds other people's. */
  useAutoRefreshOnChange(loadAttendance, { topic: "attendance", refreshOnMount: false });

  const handleArchiveRecord = async (row, restore = false) => {
    const confirmAction = restore ? confirmRestoreRecord : confirmArchiveRecord;

    await confirmAction({
      module: "attendance",
      id: row.id,
      noun: "attendance record",
      owner: row.employeeName,
      onArchived: () => loadAttendance({ background: true }),
      onRestored: () => loadAttendance({ background: true }),
    });
  };

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
      const numericKeys = new Set(["totalMinutes", "lateMinutes"]);
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

  const incompleteRecords = sortedRecords.filter((record) => String(record.status).toLowerCase() === "incomplete");
  const calendarDays = useMemo(() => buildCalendarDays(records, dtrMonth), [dtrMonth, records]);
  const canImport = Boolean(permissions.canImport);
  const canViewImportHistory = Boolean(permissions.canViewImportHistory);
  const canEdit = Boolean(permissions.canEdit);
  /*
   * `roleKey` above folds in `mode`, so it reads "employee" when a manager opens their own
   * attendance through the My Records screen. Archiving is about the signed-in person's authority
   * over the record, not which screen they are on, so it asks the user rather than the mode.
   */
  const canArchive = canArchiveModule(resolveUserRoleKey(user), "attendance");

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

    // The personal DTR is monthly. Keep it on the month the employee just selected in the
    // attendance range so View DTR fetches the same period instead of a stale calendar month.
    if (
      isEmployeeView
      && (key === "dateFrom" || key === "dateTo")
      && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      setDtrMonth(value.slice(0, 7));
    }
  };

  const handleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const openAttendanceImport = (mode) => {
    setImportSourceMode(mode);
    setSourceDatFile(null);
    setSourceExcelFile(null);
    setDatConversion(null);
    setDatUploadProgress(0);
    setImportSummary(null);
    setInvalidSamples([]);
    setImportOpen(true);
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
    setSourceExcelFile(null);
    setImportSummary(null);
    setInvalidSamples([]);
    setDatConversion(null);
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
      const text = await readAttendanceDatFile(file);
      const converted = convertDatTextToAttendanceCsv(text);

      setDatConversion(converted);
      /*
       * A device export is usually pulled for one cut-off, so follow the file's own dates. A file
       * spanning months gives no single answer and leaves the current selection alone.
       */
      if (converted.month && converted.payPeriod) {
        setImportCutoff({ month: converted.month, period: converted.payPeriod });
      }
      setDatUploadProgress(100);
      toast.success("DAT file converted to CSV.");
    } catch (error) {
      setSourceDatFile(null);
      setDatConversion({
        error: error?.message || "Unable to convert the DAT file.",
      });
      setDatUploadProgress(0);
      toast.error(error?.message || "Unable to convert the DAT file.");
    } finally {
      window.clearInterval(progressTimer);
      setConvertingDat(false);
    }
  };

  const processExcelFile = (file) => {
    if (!file) {
      return;
    }

    if (!String(file.name || "").toLowerCase().endsWith(".xlsx")) {
      toast.error("Choose an Excel .xlsx attendance file.");
      return;
    }

    if (file.size > ATTENDANCE_DAT_BYTE_LIMIT) {
      toast.error(`The Excel workbook exceeds the ${ATTENDANCE_DAT_MB_LIMIT} MB import limit.`);
      return;
    }

    setSourceExcelFile(file);
    setSourceDatFile(null);
    setDatConversion(null);
    setDatUploadProgress(100);
    setImportSummary(null);
    setInvalidSamples([]);
    toast.success("Excel attendance file ready to import.");
  };

  const processAttendanceImportFile = (file) => {
    if (importSourceMode === "excel") {
      processExcelFile(file);
      return;
    }

    void processDatFile(file);
  };

  const handleAttendanceUpload = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    processAttendanceImportFile(file);
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

    processAttendanceImportFile(event.dataTransfer.files?.[0] || null);
  };

  const importCutoffRange = useMemo(
    () => getAttendanceCutoffRange(importCutoff.period, importCutoff.month),
    [importCutoff.month, importCutoff.period]
  );
  const importCutoffLabel = formatAttendanceCutoffLabel(importCutoff.period, importCutoff.month);
  /* Re-cut whenever the file or the cut-off changes; only the rows inside the cut-off are sent. */
  const cutoffCsv = useMemo(
    () => (datConversion && !datConversion.error && importCutoffRange
      ? buildAttendanceCutoffCsv(datConversion, importCutoffRange)
      : null),
    [datConversion, importCutoffRange]
  );
  const importFile = useMemo(() => {
    if (sourceExcelFile) {
      return sourceExcelFile;
    }

    if (!cutoffCsv || cutoffCsv.rowCount === 0 || !sourceDatFile) {
      return null;
    }

    const csvFilename = sourceDatFile.name.replace(/\.dat$/i, "") || "attendance";
    return new File([cutoffCsv.csv], `${csvFilename}.csv`, { type: "text/csv;charset=utf-8;" });
  }, [cutoffCsv, sourceDatFile, sourceExcelFile]);

  const loadImportHistory = useCallback(async (page = 1) => {
    setImportHistoryLoading(true);

    try {
      const result = await fetchAttendanceImportHistory({ page, pageSize: IMPORT_HISTORY_PAGE_SIZE });
      setImportHistory({
        imports: Array.isArray(result.imports) ? result.imports : [],
        total: Number(result.total) || 0,
        page: Number(result.page) || page,
        pageSize: Number(result.pageSize) || IMPORT_HISTORY_PAGE_SIZE,
      });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to load the import history.");
    } finally {
      setImportHistoryLoading(false);
    }
  }, []);

  const openImportHistory = () => {
    setImportHistoryOpen(true);
    void loadImportHistory(1);
  };

  const setImportCutoffField = (key, value) => {
    setImportCutoff((current) => ({ ...current, [key]: value }));
    setImportSummary(null);
    setInvalidSamples([]);
  };

  const handleImport = async () => {
    if (!importCutoffRange) {
      toast.error("Choose the month and cut-off to import.");
      return;
    }

    if (!importFile) {
      toast.error(importSourceMode === "excel"
        ? "Choose an Excel .xlsx attendance file before importing."
        : cutoffCsv && cutoffCsv.rowCount === 0
          ? "No attendance rows fall within the selected cut-off."
          : "Upload and convert a DAT file before importing.");
      return;
    }

    if (convertingDat) {
      toast.error("Wait for the DAT conversion to finish.");
      return;
    }

    setImporting(true);
    const toastId = toast.loading(`Importing ${importCutoffLabel} attendance...`);

    try {
      const result = await importAttendanceCsv(importFile, {
        payPeriod: importCutoff.period,
        dateFrom: importCutoffRange.dateFrom,
        dateTo: importCutoffRange.dateTo,
      });
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
      setSourceDatFile(null);
      setSourceExcelFile(null);
      setDatConversion(null);
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
        ? { recordId: record.id, ...(isEmployeeView ? { scope: "personal" } : {}) }
        : {
            employeeRecordId: employees[0]?.employeeRecordId,
            month: dtrMonth,
            ...(isEmployeeView ? { scope: "personal" } : {}),
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
      const result = await fetchAttendanceDtr(record
        ? { recordId: record.id, ...(isEmployeeView ? { scope: "personal" } : {}) }
        : {
            employeeRecordId: employees[0]?.employeeRecordId,
            month: dtrMonth,
            ...(isEmployeeView ? { scope: "personal" } : {}),
          });
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
      const result = await fetchAttendanceLogs(
        record.id,
        isEmployeeView ? { scope: "personal" } : {}
      );
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

  /*
   * Painted from both sheets on screen, so the file contains the original and duplicate together --
   * signature, seal and all. `dtrSheetRef` stays inside the scroller so the capture excludes the
   * grey preview gutter and is not clipped to the visible scroll position.
   */
  const downloadCurrentDtr = async () => {
    if (!dtrData || dtrPdfSaving) {
      return;
    }

    setDtrPdfSaving(true);

    try {
      await exportDailyTimeRecordPdf(dtrSheetRef.current, dailyTimeRecordFileName(dtrData));
      toast.success("Daily Time Record PDF downloaded.");
    } catch (error) {
      toast.error(error?.message || "Unable to save the Daily Time Record as PDF.");
    } finally {
      setDtrPdfSaving(false);
    }
  };

  const exportCurrentDtrExcel = async () => {
    if (!dtrData || dtrExcelSaving) {
      return;
    }

    setDtrExcelSaving(true);

    try {
      /*
       * A personal DTR is pinned to the signed-in employee on the server. A desk viewing someone else's
       * names that employee; attendance.php still confines a Chief to their own division.
       */
      await exportAttendanceDtrExcel(
        isEmployeeView
          ? { month: dtrData.month || dtrMonth, scope: "personal" }
          : { month: dtrData.month || dtrMonth, employeeRecordId: dtrData.employee?.employeeRecordId },
        dailyTimeRecordFileName(dtrData).replace(/\.pdf$/i, ".xlsx")
      );
      toast.success("Daily Time Record Excel file downloaded.");
    } catch (error) {
      toast.error(error?.message || "Unable to export the Daily Time Record to Excel.");
    } finally {
      setDtrExcelSaving(false);
    }
  };

  /*
   * `cardRole` / `cardLabel` / `card` place each column in the narrow-screen card view (see
   * `components/UI/table.jsx`). They are spelled out here because most of these headers are
   * `SortableHeader` nodes rather than plain strings, so a card has no label to fall back on.
   *
   * In employee mode the ID and name columns both name the person reading the screen, so the card
   * drops them and leads with the date instead.
   */
  const attendanceColumns = [
    isEmployeeView
      ? {
          key: "employeeId",
          header: "ID NO.",
          headerClassName: "w-[120px]",
          cellClassName: "w-[120px]",
          card: false,
          render: (row) => (
            <span className="font-semibold text-slate-700">{row.employeeId || "N/A"}</span>
          ),
        }
      : null,
    {
      key: "employeeName",
      header: <SortableHeader label="Employee Name" columnKey="employeeName" sortConfig={sortConfig} onSort={handleSort} />,
      card: !isEmployeeView,
      cardRole: "subtitle",
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{row.employeeName || "N/A"}</p>
        </div>
      ),
    },
    isEmployeeView
      ? null
      : {
          key: "department",
          header: <SortableHeader label="Division" columnKey="department" sortConfig={sortConfig} onSort={handleSort} />,
          cardLabel: "Division",
          render: (row) => row.department || "Unassigned division",
        },
    {
      key: "date",
      header: <SortableHeader label="Date" columnKey="date" sortConfig={sortConfig} onSort={handleSort} />,
      cardRole: "title",
      render: (row) => formatDate(row.date),
    },
    {
      key: "timeIn",
      header: <SortableHeader label="AM In" columnKey="timeIn" sortConfig={sortConfig} onSort={handleSort} />,
      cardLabel: "AM In",
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
      cardLabel: "PM Out",
      render: (row) => formatTime(row.pmTimeOut || row.timeOut),
    },
    {
      key: "totalMinutes",
      header: <SortableHeader label="Total Hours" columnKey="totalMinutes" sortConfig={sortConfig} onSort={handleSort} />,
      cardLabel: "Total Hours",
      render: (row) => minutesToDuration(row.totalMinutes),
    },
    {
      key: "lateMinutes",
      header: <SortableHeader label="Late" columnKey="lateMinutes" sortConfig={sortConfig} onSort={handleSort} />,
      cardLabel: "Late",
      render: (row) => `${row.lateMinutes || 0} min`,
    },
    {
      key: "status",
      header: <SortableHeader label="Status" columnKey="status" sortConfig={sortConfig} onSort={handleSort} />,
      cardRole: "badge",
      render: (row) => (
        <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${statusClasses(row.status)}`}>
          {row.status}
        </span>
      ),
    },
    isEmployeeView
      ? null
      : {
          key: "actions",
          header: "Actions",
          cardRole: "actions",
          render: (row) => archiveView ? (
            <div className="flex min-w-[170px] flex-wrap items-center gap-2">
              <ActionIconButton
                label="View DTR"
                icon={faEye}
                tone="view"
                onClick={() => openDtr(row)}
              />
              <ActionIconButton
                label="Restore attendance record"
                icon={faRotateLeft}
                tone="restore"
                onClick={() => handleArchiveRecord(row, true)}
              />
            </div>
          ) : (
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
              {canArchive ? (
                <ActionIconButton
                  label="Archive attendance record"
                  icon={faBoxArchive}
                  tone="archive"
                  onClick={() => handleArchiveRecord(row)}
                />
              ) : null}
            </div>
          ),
        },
  ].filter(Boolean);

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

  /**
   * One filter bar in the shared record-table format: h-9 pill controls on a single grid row, the
   * same shape the leave, travel order, and pass slip screens use.
   */
  const renderAttendanceFilters = () => (
    <div
      className={
        isEmployeeView
          ? "mt-4 grid gap-3 lg:grid-cols-[160px_160px_160px_120px]"
          : showDivisionFilter
            ? "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_150px_150px_160px_160px_120px]"
            : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_150px_150px_160px_120px]"
      }
      /* The controls stay live and keep their focus while a filtered fetch is in flight; the table
         below dims instead. Only the pointer is held off, so a half-finished result set cannot be
         clicked into. */
      aria-busy={refreshing}
    >
      {!isEmployeeView ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Employees</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={filters.search}
              onChange={(event) => setFilter("search", event.target.value)}
              placeholder="Search name or employee ID"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </span>
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">From Date</span>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(event) => setFilter("dateFrom", event.target.value)}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">To Date</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(event) => setFilter("dateTo", event.target.value)}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        />
      </label>
      {showDivisionFilter ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Division</span>
          <select
            value={filters.department}
            onChange={(event) => setFilter("department", event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All divisions</option>
            {departments.map((department) => (
              <option key={department} value={department}>{department}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Status</span>
        <select
          value={filters.status}
          onChange={(event) => setFilter("status", event.target.value)}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        >
          <option value="">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Rows Per Page</span>
        <select
          value={rowsPerPage}
          onChange={(event) => setRowsPerPage(Number(event.target.value) || DEFAULT_ROWS_PER_PAGE)}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        >
          {[10, 20, 50, 100, 200].map((value) => (
            <option key={value} value={value}>{value} rows</option>
          ))}
        </select>
      </label>
      {/* The only thing a filtered refetch changes on screen. The controls keep their values and
          their focus, and the table below keeps showing the previous result until the new one
          lands -- the point being that nothing is torn down and rebuilt. */}
      {refreshing ? (
        <span
          className="col-span-full flex items-center gap-2 text-xs font-medium text-slate-500"
          role="status"
        >
          <Loader2 className="animate-spin" size={13} aria-hidden="true" />
          Updating results...
        </span>
      ) : null}
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
                ? "View personal attendance logs, DTR records, and calendar history."
                : "Import DAT logs, monitor daily attendance, and generate DTR forms."}
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
            </div>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <LoadingSkeleton showMetricCards={showOverviewCards} />
      ) : (
        <>
          {showOverviewCards ? (
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

          {showOverviewCards ? (
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
                <h3 className="m-0 text-base font-semibold text-slate-950">
                  {archiveView ? "Archived Attendance Records" : "Attendance Records"}
                </h3>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  {archiveView
                    ? "Attendance records moved to archive. Restore one to put it back in the list."
                    : "Imported logs grouped by employee and date with computed hours, late minutes, and absences."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {canArchive ? (
                  <ArchiveViewToggle
                    archiveView={archiveView}
                    onToggle={(next) => {
                      setArchiveView(next);
                      setPage(1);
                    }}
                    label="attendance"
                  />
                ) : null}
                {canViewImportHistory && !archiveView && !isEmployeeView ? (
                  <button
                    type="button"
                    onClick={openImportHistory}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    <History size={16} />
                    Import History
                  </button>
                ) : null}
                {canImport && !archiveView && !isEmployeeView ? (
                  <>
                    {roleKey !== "hrstaff" ? (
                      <button
                        type="button"
                        onClick={() => openAttendanceImport("excel")}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100"
                      >
                        <FileSpreadsheet size={16} />
                        Import Excel File
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openAttendanceImport("dat")}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
                    >
                      <UploadCloud size={16} />
                      Import Attendance
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {!showOverviewCards ? renderAttendanceFilters() : null}

            {/*
              * Below `lg` this holds the card grid and needs no chrome of its own — the cards carry
              * their own borders. From `lg` up it becomes the framed box around the table.
              */}
            <div className="mt-4 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
              <Table
                columns={attendanceColumns}
                data={paginatedRecords}
                rowKey="id"
                emptyMessage="No attendance records found."
                stickyHeader
                className="max-h-[560px] overflow-y-auto"
                tableClassName={isEmployeeView ? "min-w-[1000px]" : "min-w-[1540px]"}
                cardsClassName="lg:hidden"
                tableWrapperClassName="hidden lg:block"
              />
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-sm text-slate-500">
                Showing {sortedRecords.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1} to {Math.min(safePage * rowsPerPage, sortedRecords.length)} of {sortedRecords.length} attendance records
              </p>
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </section>

          <section className="grid gap-4">
            {isEmployeeView ? (
              <Card className="shadow-sm">
                <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Attendance Calendar</CardTitle>
                    <CardDescription>Monthly view of your personal attendance status.</CardDescription>
                  </div>
                  {/*
                    * Stepping one month at a time is what this filter is actually used for, and the
                    * bare month input made that a two-part gesture: open the picker, choose. The
                    * arrows do it in one click and the input stays for jumping somewhere distant.
                    * The label between them is the readable form of the same value -- the input's
                    * own text is hidden below `sm`, where there is no room for both.
                    */}
                  <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setDtrMonth((current) => shiftMonth(current, -1))}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                      aria-label="Previous month"
                    >
                      <ChevronLeft size={18} aria-hidden="true" />
                    </button>
                    <span className="min-w-[7.5rem] text-center text-sm font-semibold text-slate-700 sm:hidden">
                      {formatMonthLabel(dtrMonth)}
                    </span>
                    <input
                      type="month"
                      value={dtrMonth}
                      onChange={(event) => setDtrMonth(event.target.value)}
                      className="hidden min-h-[36px] rounded-lg border-0 bg-transparent px-2 text-sm font-semibold text-slate-700 outline-none sm:block"
                      aria-label="Attendance calendar month"
                    />
                    <button
                      type="button"
                      onClick={() => setDtrMonth((current) => shiftMonth(current, 1))}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                      aria-label="Next month"
                    >
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  </div>
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
          </section>
        </>
      )}

      <Modal
        open={importOpen}
        title={importSourceMode === "excel" ? "Import Excel Attendance" : "Import Attendance"}
        onClose={() => setImportOpen(false)}
        maxWidth="max-w-[520px]"
        panelClassName="!rounded-2xl"
        headerClassName="!border-b-0 !px-5 !pt-5 !pb-0 sm:!px-6 sm:!pt-6"
        contentClassName="!p-5 sm:!p-6"
        footerClassName="!px-5 sm:!px-6"
        footer={
          importFile ? (
            <Button loading={importing} onClick={handleImport}>
              Import Attendance
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          <style>{ATTENDANCE_PROGRESS_STRIPE_KEYFRAMES}</style>

          <p className="!mt-0 text-sm text-slate-500 dark:text-slate-400">
            {importSourceMode === "excel"
              ? "Choose the cut-off, then upload an Excel workbook. Only punches dated within the cut-off are imported."
              : "Choose the cut-off, then upload the biometric DAT file. Only punches dated within the cut-off are imported."}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Month</span>
              <input
                type="month"
                value={importCutoff.month}
                disabled={convertingDat || importing}
                onChange={(event) => setImportCutoffField("month", event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Cut-off</span>
              <select
                value={importCutoff.period}
                disabled={convertingDat || importing}
                onChange={(event) => setImportCutoffField("period", event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                {ATTENDANCE_CUTOFF_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {importCutoffRange ? (
            <p className="!mt-2 text-xs text-slate-500 dark:text-slate-400">
              Importing <span className="font-semibold text-slate-700 dark:text-slate-200">{importCutoffLabel}</span>
              {" · "}{importCutoffRange.dateFrom} to {importCutoffRange.dateTo}
            </p>
          ) : (
            <p className="!mt-2 text-xs text-rose-700">Choose a month to set the cut-off range.</p>
          )}

          <div>
            <label
              htmlFor="attendanceImportFile"
              onDragOver={handleDatDragOver}
              onDragLeave={handleDatDragLeave}
              onDrop={handleDatDrop}
              className={[
                "group flex w-full cursor-pointer flex-col items-center rounded-xl border border-dashed px-5 py-8 text-center transition-colors duration-200 focus-within:ring-2 focus-within:ring-slate-400 focus-within:ring-offset-2 dark:focus-within:ring-offset-slate-900",
                datDragActive
                  ? "border-slate-600 bg-slate-100 dark:border-slate-400 dark:bg-slate-800"
                  : "border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-100/70 dark:border-slate-600 dark:bg-slate-800/40 dark:hover:bg-slate-800",
                convertingDat || importing ? "pointer-events-none opacity-90" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                id="attendanceImportFile"
                type="file"
                accept={importSourceMode === "excel"
                  ? ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  : ".dat,application/octet-stream,text/plain"}
                className="sr-only"
                aria-label={importSourceMode === "excel" ? "Choose attendance Excel file" : "Choose attendance DAT file"}
                aria-describedby="attendanceImportFileHint"
                disabled={convertingDat || importing}
                onChange={handleAttendanceUpload}
              />

              <div className="w-full space-y-2">
                <p className="m-0 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {convertingDat
                    ? "Preparing attendance file..."
                    : datDragActive
                      ? "Drop your file here"
                      : importSourceMode === "excel"
                        ? "Drag and drop your Excel file here"
                        : "Drag and drop your DAT file here"}
                </p>
                <p id="attendanceImportFileHint" className="m-0 text-xs text-slate-500 dark:text-slate-400">
                  {importSourceMode === "excel"
                    ? `XLSX format · First worksheet · Maximum ${ATTENDANCE_DAT_MB_LIMIT} MB`
                    : `DAT format only · Maximum ${ATTENDANCE_DAT_MB_LIMIT} MB`}
                </p>
                {importSourceMode === "excel" ? (
                  <p className="m-0 text-xs text-slate-500 dark:text-slate-400">
                    Columns: Employee ID, Date &amp; Time, State C, State D, State E, State F
                  </p>
                ) : null}
              </div>

              <span className="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors group-hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:group-hover:bg-white">
                {sourceDatFile || sourceExcelFile ? "Choose another file" : "Choose file"}
              </span>
              {sourceDatFile || sourceExcelFile ? (
                <p className="m-0 mt-4 max-w-full break-all text-xs text-slate-500 dark:text-slate-400">
                  {(sourceExcelFile || sourceDatFile).name} · {formatAttendanceFileSize((sourceExcelFile || sourceDatFile).size)}
                </p>
              ) : null}
            </label>
          </div>

          {(convertingDat || datUploadProgress > 0) ? (
            <div className="w-full" role="status" aria-live="polite">
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

          {!convertingDat && cutoffCsv && importFile ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
              <div className="break-words">
                <p className="m-0 font-semibold">{importFile.name}</p>
                <p className="m-0 mt-1">
                  {cutoffCsv.rowCount} attendance rows ready for {importCutoffLabel}
                  {cutoffCsv.excludedRows ? `, ${cutoffCsv.excludedRows} rows outside the cut-off left out` : ""}
                  {datConversion.skippedRows ? `, ${datConversion.skippedRows} rows skipped` : ""}.
                </p>
              </div>
            </div>
          ) : null}

          {!convertingDat && sourceExcelFile && importFile ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
              <p className="m-0 font-semibold">{sourceExcelFile.name}</p>
              <p className="m-0 mt-1">Excel attendance rows are ready for {importCutoffLabel}.</p>
            </div>
          ) : null}

          {!convertingDat && cutoffCsv && cutoffCsv.rowCount === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
              None of the {datConversion.rowCount} rows in this file fall within {importCutoffLabel}.
              {datConversion.dateFrom ? ` The file covers ${datConversion.dateFrom} to ${datConversion.dateTo}.` : ""}
              {" "}Change the month or cut-off, or upload the matching file.
            </div>
          ) : null}

          {!convertingDat && datConversion?.error ? (
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {datConversion.error}
            </div>
          ) : null}

          {importSummary ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {importSummary.cutoff?.dateFrom ? (
                <p className="m-0 text-sm text-slate-600 sm:col-span-2">
                  Imported <span className="font-semibold text-slate-900">{importSummary.cutoff.payPeriod || "cut-off"}</span>
                  {" · "}{importSummary.cutoff.dateFrom} to {importSummary.cutoff.dateTo}
                </p>
              ) : null}
              {[
                ["Total imported", importSummary.totalImported],
                ["Duplicates skipped", importSummary.duplicatesSkipped],
                ["Invalid rows", importSummary.invalidRows],
                ["Outside cut-off", importSummary.outsideCutoffRows],
                ["Successful records", importSummary.successfulRecords],
                ["Absent records created", importSummary.absentRecordsCreated],
                ["Leave records created", importSummary.leaveRecordsCreated],
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
        open={importHistoryOpen}
        title="Import History"
        onClose={() => setImportHistoryOpen(false)}
        maxWidth="max-w-[1100px]"
      >
        <div className="space-y-4">
          <p className="!mt-0 text-sm text-slate-500">
            Every attendance import run, newest first: who imported, which cut-off, and what the file produced.
          </p>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <Table
              columns={importHistoryColumns}
              data={importHistory.imports}
              rowKey="id"
              loading={importHistoryLoading}
              loadingRows={4}
              emptyMessage="No attendance imports have been recorded yet."
              stickyHeader
              className="max-h-[520px] overflow-y-auto"
              tableClassName="min-w-[960px]"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {importHistory.total === 0 ? 0 : (importHistory.page - 1) * importHistory.pageSize + 1} to{" "}
              {Math.min(importHistory.page * importHistory.pageSize, importHistory.total)} of {importHistory.total} imports
            </p>
            <Pagination
              currentPage={importHistory.page}
              totalPages={Math.max(1, Math.ceil(importHistory.total / importHistory.pageSize))}
              onPageChange={(nextPage) => void loadImportHistory(nextPage)}
              disabled={importHistoryLoading}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={dtrOpen}
        title="Daily Time Record"
        onClose={() => setDtrOpen(false)}
        maxWidth="max-w-[1500px]"
        footer={
          <>
            {/* Every role but Admin gets the Excel copy, for their own DTR and for the ones they review. */}
            {!isAdminView ? (
              <Button
                variant="secondary"
                icon={FileSpreadsheet}
                onClick={exportCurrentDtrExcel}
                disabled={!dtrData || dtrExcelSaving}
                loading={dtrExcelSaving}
              >
                Export Excel File
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon={Download}
              onClick={downloadCurrentDtr}
              disabled={!dtrData || dtrPdfSaving}
              loading={dtrPdfSaving}
            >
              Download PDF
            </Button>
            <Button variant="secondary" icon={Printer} onClick={() => dtrData && printDtr(dtrData, dtrSignature)} disabled={!dtrData}>Print DTR</Button>
            <Button onClick={() => setDtrOpen(false)}>Close</Button>
          </>
        }
      >
        {dtrLoading ? (
          <div className="h-[520px] animate-pulse rounded-lg bg-slate-100" />
        ) : dtrData ? (
          /* Two fixed-width CS Form No. 48 copies sit together. The summary moves beside them only
             on very wide screens; below that it becomes a row underneath so both sheets receive
             the modal's full width, with horizontal scrolling retained for narrow viewports. */
          <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="overflow-x-auto rounded-lg bg-slate-100 px-4 py-5">
              <div ref={dtrSheetRef} className="flex w-max gap-5 bg-white">
                {/* Both copies belong to this capture node so Download PDF fits them on one page. */}
                <div className="w-fit">
                  <DailyTimeRecord
                    dtr={dtrData}
                    signatureDataUrl={dtrSignature}
                    copyLabel="ORIGINAL COPY"
                  />
                </div>
                <DailyTimeRecord
                  dtr={dtrData}
                  signatureDataUrl={dtrSignature}
                  copyLabel="DUPLICATE COPY"
                />
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="grid sm:grid-cols-3 2xl:grid-cols-1">
                <div className="px-4 py-3">
                  <p className="m-0 text-xs font-semibold uppercase text-slate-500">Employee</p>
                  <strong className="mt-1 block text-slate-900">{dtrData.employee?.employeeName}</strong>
                  <span className="text-sm text-slate-500">{dtrData.employee?.employeeId}</span>
                </div>
                <div className="border-t border-slate-200 px-4 py-3 sm:border-l sm:border-t-0 2xl:border-l-0 2xl:border-t">
                  <p className="m-0 text-xs font-semibold uppercase text-slate-500">Rendered</p>
                  <strong className="mt-1 block text-xl text-slate-900">{minutesToDuration(dtrData.totals?.renderedMinutes)}</strong>
                </div>
                <div className="border-t border-slate-200 px-4 py-3 sm:border-l sm:border-t-0 2xl:border-l-0 2xl:border-t">
                  <p className="m-0 text-xs font-semibold uppercase text-slate-500">Late</p>
                  <strong className="mt-1 block text-xl text-slate-900">
                    {(dtrData.totals?.lateMinutes || 0)} min
                  </strong>
                </div>
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
    </div>
  );
}
