import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  FilePenLine,
  Search,
  X,
} from "lucide-react";
import { faBan, faBoxArchive, faCheck, faEye, faFileLines, faPrint, faRotateLeft, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import useAutoPrint from "../../hooks/useAutoPrint";
import { getEmployeeSignature } from "../../services/api";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  canManageLeave,
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  isPastDate,
  isRegionalDirectorApproved,
  matchesUserRecordScope,
  matchesUserEmployeeOption,
  normalizeLeaveStatus,
  resolveRoleKey,
  todayDateInputValue,
} from "../../utils/leaveHelpers";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import MultiDatePicker from "../../components/UI/MultiDatePicker";
import {
  formatSelectedDatesSummary,
  getNoteDisplay,
  getSelectedDatesRange,
  getSelectedDatesTotal,
  packSelectedDates,
  unpackSelectedDates,
} from "../../utils/dateSelection";
import { formatSignatureTimestamp } from "../../utils/signatureTimestamp";
import { requestApprovalCaptcha, isCaptchaFailure } from "../../utils/approvalCaptcha";
import {
  fetchCompensatoryCreditBalance,
  fetchCompensatoryRequests,
  fileCompensatoryRequest,
  updateCompensatoryStatus,
} from "../../services/compensatoryService";

/*
 * A compensatory time off filing is signed three times before it is good: the division Chief
 * recommends it, the HR Head certifies the credits behind it, and the Regional Director approves it.
 * Each signature is a status of its own, so the row itself says whose desk the filing is sitting on.
 *
 * Mirrors COMPENSATORY_APPROVAL_CHAIN in frontend/backend/api/compensatory.php — the API enforces
 * the order, and this only decides which buttons are worth showing.
 */
const COMPENSATORY_APPROVAL_CHAIN = {
  Pending: { role: "chief", desk: "Division Chief", next: "Endorsed" },
  Endorsed: { role: "hrhead", desk: "HR Head", next: "Reviewed" },
  Reviewed: { role: "regionaldirector", desk: "Regional Director", next: "Approved" },
};

/* A status names the signature just given, which reads more plainly than the stored word. */
const COMPENSATORY_STATUS_LABELS = {
  Endorsed: "Chief Approved",
  Reviewed: "HR Approved",
};

const COMPENSATORY_STATUSES = ["Pending", "Endorsed", "Reviewed", "Approved", "Rejected", "Cancelled"];

function compensatoryStatusLabel(status) {
  return COMPENSATORY_STATUS_LABELS[status] || status;
}

/** The desk a filing is waiting on, or null once it has been decided. */
function compensatoryStage(status) {
  return COMPENSATORY_APPROVAL_CHAIN[status] || null;
}

/*
 * Whether this role is the desk the filing is waiting on. Admin stands in at any open stage so a
 * filing is never stranded while an approver is away; nobody else may sign out of turn.
 */
function canActOnCompensatoryStage(roleKey, status) {
  const stage = compensatoryStage(status);
  return Boolean(stage) && (roleKey === "admin" || roleKey === stage.role);
}

// Stable identity for the default prop: a literal `[]` in the signature is a fresh array on every
// render, which invalidated the employee memos and, through them, the modal's default values.
const EMPTY_EMPLOYEES = [];

/*
 * Compensatory credits are earned and spent in hours, but the time off is taken in days, so the
 * two are converted at the same eight-hour working day the payroll runs on (PAYROLL_WORKING_HOURS
 * _PER_DAY in payroll.php). A whole day costs 8 credits and an AM or PM half costs 4 — which is
 * also why a filing can never be smaller than the 4-hour minimum.
 */
const CTO_HOURS_PER_DAY = 8;

/*
 * The part of a balance a filing can actually be charged to. Time off is only ever taken in whole
 * days or halves, so the credits behind it are only spendable in the same steps: 10 hours standing
 * pay for one whole day and no more, and the leftover 2 wait for a later filing rather than being
 * cut out of the middle of a half day the record has no way to describe.
 *
 * Mirrors compensatory_floor_half_day() in the API, so the warning on the form shows the same split
 * the filing is stored with.
 */
function ctoPayableCredits(hours) {
  const value = Number(hours);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const halfDay = CTO_HOURS_PER_DAY / 2;

  return Math.floor(Math.round(value * 100) / 100 / halfDay) * halfDay;
}

const initialForm = {
  employeeRecordId: "",
  /* The days the time off is taken on, each with its own whole/AM/PM portion. */
  selectedDates: [],
  remarks: "",
};

const ctoPreviewDefaults = {
  authorizedOfficial: "",
  authorizedOfficialRole: "OIC, Regional Director",
};

const ctoPreviewStyles = {
  page: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "11px",
    width: "100%",
    maxWidth: "680px",
    margin: "0 auto",
    background: "#ffffff",
    boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
    padding: "30px 40px 40px",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "75px 1fr 75px",
    alignItems: "center",
    marginBottom: "18px",
    gap: "8px",
  },
  logoImage: {
    width: "68px",
    height: "68px",
    objectFit: "contain",
    display: "block",
  },
  headerText: {
    textAlign: "center",
    lineHeight: 1.4,
  },
  hr: {
    border: "none",
    borderTop: "2px solid #000000",
    margin: "5px 0 16px",
  },
  formTitle: {
    textAlign: "center",
    marginBottom: "16px",
  },
  label: {
    fontWeight: "bold",
    whiteSpace: "nowrap",
    alignSelf: "end",
  },
  fg: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  fv: {
    borderBottom: "1px solid #000000",
    width: "100%",
    textAlign: "center",
    fontSize: "11px",
    padding: "1px 4px",
    minHeight: "18px",
    color: "#111827",
  },
  fsub: {
    fontSize: "8.5px",
    textAlign: "center",
    marginTop: "1px",
    fontStyle: "italic",
    color: "#555555",
  },
  secHdr: {
    textAlign: "center",
    fontWeight: "bold",
    fontSize: "12px",
    textDecoration: "underline",
    margin: "10px 0",
  },
  sigLine: {
    borderBottom: "1px solid #000000",
    minHeight: "50px",
    marginBottom: "2px",
  },
  sigLabel: {
    textAlign: "center",
    fontSize: "9.5px",
    fontStyle: "italic",
    color: "#555555",
  },
  signaturePreview: {
    minHeight: "36px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    marginBottom: "0",
  },
  signatureImage: {
    maxWidth: "150px",
    maxHeight: "42px",
    objectFit: "contain",
    display: "block",
  },
  signatureTimestamp: {
    color: "#111827",
    fontSize: "9px",
    fontStyle: "italic",
    fontWeight: "bold",
    lineHeight: 1.2,
    textAlign: "center",
  },
  signatureName: {
    width: "85%",
    margin: "0 auto",
    fontWeight: "bold",
    fontSize: "10px",
    textAlign: "center",
    minHeight: "12px",
  },
  signatureUnderline: {
    width: "85%",
    margin: "1px auto 0",
    borderTop: "1px solid #000000",
  },
  cbBox: {
    width: "14px",
    height: "14px",
    border: "1px solid #000000",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    lineHeight: "13px",
    fontSize: "10px",
    fontWeight: "bold",
    color: "#111827",
  },
};

function PreviewSelectionBox({ checked = false }) {
  return (
    <div style={ctoPreviewStyles.cbBox} aria-hidden="true">
      {checked ? (
        <span
          style={{
            width: "5px",
            height: "9px",
            borderRight: "2px solid #111827",
            borderBottom: "2px solid #111827",
            transform: "rotate(45deg)",
            marginTop: "-2px",
          }}
        />
      ) : null}
    </div>
  );
}

function getStatusBadgeClasses(status) {
  switch (status) {
    case "Endorsed":
      return "border border-indigo-200 bg-indigo-50 text-indigo-700";
    case "Reviewed":
      return "border border-sky-200 bg-sky-50 text-sky-700";
    case "Approved":
      return "border border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Rejected":
      return "border border-rose-200 bg-rose-50 text-rose-700";
    case "Cancelled":
      return "border border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border border-amber-200 bg-amber-50 text-amber-700";
  }
}

function normalizeCompensatoryText(value) {
  return String(value || "").trim().toLowerCase();
}

function findCompensatoryEmployee(record, employees) {
  if (!record) {
    return null;
  }

  const recordEmployeeId = normalizeCompensatoryText(record.employeeId);
  const recordEmployeeName = normalizeCompensatoryText(record.employeeName);

  return employees.find((employee) => {
    const employeeId = normalizeCompensatoryText(employee.employeeId);
    const employeeName = normalizeCompensatoryText(employee.fullName);

    return (
      (recordEmployeeId && employeeId && recordEmployeeId === employeeId)
      || (recordEmployeeName && employeeName && recordEmployeeName === employeeName)
    );
  }) || null;
}

function splitCompensatoryName(fullName) {
  const name = String(fullName || "").trim();
  if (!name) {
    return { lastName: "", firstName: "", middleInitial: "" };
  }

  if (name.includes(",")) {
    const [lastName, remaining = ""] = name.split(",");
    const parts = remaining.trim().split(/\s+/).filter(Boolean);
    return {
      lastName: lastName.trim().toUpperCase(),
      firstName: (parts[0] || "").toUpperCase(),
      middleInitial: (parts[1]?.[0] || "").toUpperCase(),
    };
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { lastName: parts[0].toUpperCase(), firstName: "", middleInitial: "" };
  }

  return {
    lastName: (parts[parts.length - 1] || "").toUpperCase(),
    firstName: parts.slice(0, -1).join(" ").toUpperCase(),
    middleInitial: "",
  };
}

function ctoNamePart(value) {
  return String(value || "").trim().toUpperCase();
}

function getCompensatoryNameParts(record, employee) {
  const firstName = String(record?.employeeFirstName || employee?.firstName || "").trim();
  const middleName = String(record?.employeeMiddleName || employee?.middleName || "").trim();
  const lastName = String(record?.employeeLastName || employee?.lastName || "").trim();

  if (firstName || middleName || lastName) {
    return {
      lastName: ctoNamePart(lastName),
      firstName: ctoNamePart(firstName),
      middleInitial: ctoNamePart(middleName).charAt(0),
    };
  }

  return splitCompensatoryName(record?.employeeName || employee?.fullName || "");
}

function formatCtoLongDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatCtoShortDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatCtoDateRange(startDate, endDate) {
  if (!startDate && !endDate) {
    return "";
  }

  if (startDate && endDate && startDate === endDate) {
    return formatCtoLongDate(startDate);
  }

  return [formatCtoLongDate(startDate), formatCtoLongDate(endDate)]
    .filter(Boolean)
    .join(" to ");
}

/*
 * The days a record actually named, for the lists. A request filed as a plain range -- an older
 * record, or one filed before the day picker -- still reads as start to end.
 */
function formatRecordDates(record) {
  const summary = formatSelectedDatesSummary(unpackSelectedDates(record?.remarks).dates);

  return summary || `${formatDateDisplay(record?.startDate)} - ${formatDateDisplay(record?.endDate)}`;
}

function formatCtoCoveredDates(startDate, endDate) {
  if (!startDate && !endDate) {
    return "";
  }

  if (startDate && endDate && startDate === endDate) {
    return formatCtoShortDate(startDate);
  }

  return [formatCtoShortDate(startDate), formatCtoShortDate(endDate)]
    .filter(Boolean)
    .join(", ");
}

function formatCtoHours(hoursApplied) {
  const hours = Number(hoursApplied);
  if (Number.isNaN(hours) || hours <= 0) {
    return "";
  }

  const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
  return `${label} HOURS`;
}

/*
 * The certification reports the credits the employee held when the form was filed, so a balance that
 * has been spent down to zero still has to read as a figure. Only a record filed before the balance
 * was ever certified -- there is nothing stored on it -- leaves the line blank.
 */
function formatCtoEarnedHours(cocBalanceHours) {
  if (cocBalanceHours === null || cocBalanceHours === undefined || cocBalanceHours === "") {
    return "";
  }

  const hours = Number(cocBalanceHours);
  if (!Number.isFinite(hours) || hours < 0) {
    return "";
  }

  const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
  return `${label} HOURS`;
}

/* Credits read as hours with two decimals, the same shape the hours field is filled in with. */
function formatCreditHours(hours) {
  const value = Number(hours);
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${getStatusBadgeClasses(status)}`}>
      {compensatoryStatusLabel(status)}
    </span>
  );
}

function EmployeeSearchSelect({
  employeeOptions,
  selectedEmployee,
  onSelect,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return employeeOptions;
    }

    return employeeOptions.filter((employee) =>
      [employee.employeeName, employee.employeeId, employee.division]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [employeeOptions, query]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-[48px] w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm outline-none transition ${
          disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500"
            : "border-white/70 bg-white/80 text-slate-900 shadow-sm backdrop-blur-md hover:border-slate-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        }`}
      >
        <span className={selectedEmployee ? "text-slate-900" : "text-slate-400"}>
          {selectedEmployee
            ? selectedEmployee.employeeName
            : "Search employee..."}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && !disabled ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-30 overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-slate-200/80 p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee..."
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {filteredOptions.length === 0 ? (
              <p className="m-0 rounded-2xl px-3 py-3 text-sm text-slate-500">No employees found.</p>
            ) : filteredOptions.map((employee) => (
              <button
                key={employee.employeeRecordId}
                type="button"
                onClick={() => {
                  onSelect(employee);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-start justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-slate-50"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{employee.employeeName}</span>
                  <span className="block text-xs text-slate-500">
                    {employee.division || "No division assigned"}
                  </span>
                </span>
                {selectedEmployee?.employeeRecordId === employee.employeeRecordId ? (
                  <Check size={15} className="mt-0.5 text-teal-700" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompensatoryPreviewModal({
  record,
  employees = [],
  autoPrint = false,
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [applicantSignature, setApplicantSignature] = useState("");
  const [chiefReviewerSignature, setChiefReviewerSignature] = useState("");
  const [creditCertifierSignature, setCreditCertifierSignature] = useState("");
  const [authorizedOfficialSignature, setAuthorizedOfficialSignature] = useState("");
  const printRef = useRef(null);
  /*
   * Opened from the Print action in the table rather than by a reader: print the form once the
   * signatures below have landed, then hand back to the caller so it does not linger on screen.
   * `handlePrint` is only called from inside the frame callback, well after it is initialised.
   */
  const trackLoad = useAutoPrint({
    active: Boolean(record) && autoPrint,
    onPrint: () => handlePrint(),
    onDone: onClose,
  });

  useEffect(() => {
    if (!record) {
      setVisible(false);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [record]);

  useEffect(() => {
    let mounted = true;

    if (!record?.employeeRecordId) {
      setApplicantSignature("");
      return () => {
        mounted = false;
      };
    }

    setApplicantSignature("");

    const loadApplicantSignature = async () => {
      try {
        const result = await getEmployeeSignature(record.employeeRecordId);
        if (!mounted) {
          return;
        }
        setApplicantSignature(String(result?.employee?.signatureDataUrl || ""));
      } catch (error) {
        if (mounted) {
          setApplicantSignature("");
        }
      }
    };

    void trackLoad(loadApplicantSignature);

    return () => {
      mounted = false;
    };
  }, [record, trackLoad]);

  /* The division Chief recommends the filing, which is the first of the three signatures on it. */
  useEffect(() => {
    let mounted = true;

    const chiefEmployeeRecordId = Number(record?.endorsedByEmployeeRecordId || 0);

    if (!record || chiefEmployeeRecordId <= 0) {
      setChiefReviewerSignature("");
      return () => {
        mounted = false;
      };
    }

    setChiefReviewerSignature("");

    const loadChiefReviewerSignature = async () => {
      try {
        const result = await getEmployeeSignature(chiefEmployeeRecordId);
        if (!mounted) {
          return;
        }
        setChiefReviewerSignature(String(result?.employee?.signatureDataUrl || ""));
      } catch (error) {
        if (mounted) {
          setChiefReviewerSignature("");
        }
      }
    };

    void trackLoad(loadChiefReviewerSignature);

    return () => {
      mounted = false;
    };
  }, [record, trackLoad]);

  /*
   * The COC certification is HR's to make -- the credits behind the filing are counted off the HR
   * ledger -- so the HR Head's approval is what signs part (a) of the action on the application.
   */
  useEffect(() => {
    let mounted = true;

    const certifierEmployeeRecordId = Number(record?.reviewedByEmployeeRecordId || 0);

    if (!record || certifierEmployeeRecordId <= 0) {
      setCreditCertifierSignature("");
      return () => {
        mounted = false;
      };
    }

    setCreditCertifierSignature("");

    const loadCreditCertifierSignature = async () => {
      try {
        const result = await getEmployeeSignature(certifierEmployeeRecordId);
        if (!mounted) {
          return;
        }
        setCreditCertifierSignature(String(result?.employee?.signatureDataUrl || ""));
      } catch (error) {
        if (mounted) {
          setCreditCertifierSignature("");
        }
      }
    };

    void trackLoad(loadCreditCertifierSignature);

    return () => {
      mounted = false;
    };
  }, [record, trackLoad]);

  useEffect(() => {
    let mounted = true;

    const approverEmployeeRecordId = Number(record?.approvedByEmployeeRecordId || 0);

    if (!record || approverEmployeeRecordId <= 0) {
      setAuthorizedOfficialSignature("");
      return () => {
        mounted = false;
      };
    }

    setAuthorizedOfficialSignature("");

    const loadAuthorizedOfficialSignature = async () => {
      try {
        const result = await getEmployeeSignature(approverEmployeeRecordId);
        if (!mounted) {
          return;
        }
        setAuthorizedOfficialSignature(String(result?.employee?.signatureDataUrl || ""));
      } catch (error) {
        if (mounted) {
          setAuthorizedOfficialSignature("");
        }
      }
    };

    void trackLoad(loadAuthorizedOfficialSignature);

    return () => {
      mounted = false;
    };
  }, [record, trackLoad]);

  if (!record) {
    return null;
  }

  const employee = findCompensatoryEmployee(record, employees);
  const applicantName = String(record.employeeName || employee?.fullName || "").trim();
  const nameParts = getCompensatoryNameParts(record, employee);
  const position = String(record.position || employee?.position || employee?.designation || "").trim();
  const division = String(record.division || employee?.department || "").trim();
  const hoursLabel = formatCtoHours(record.hoursApplied);
  /*
   * A request covers the days it actually named, which can skip days inside its span, so the exact
   * list is what the form prints. Requests filed as a plain range still read as start to end.
   */
  const { note: recordRemarks, dates: recordDates } = unpackSelectedDates(record.remarks);
  const selectedDatesSummary = formatSelectedDatesSummary(recordDates);
  const datesCovered = selectedDatesSummary || formatCtoCoveredDates(record.startDate, record.endDate);
  const inclusiveDates = selectedDatesSummary || formatCtoDateRange(record.startDate, record.endDate);
  const normalizedStatus = normalizeLeaveStatus(record.status);
  const isApproved = normalizedStatus === "Approved";
  const isDisapproved = normalizedStatus === "Rejected";
  /*
   * The COC certification is about the credits behind the request, not the hours it spends: it is
   * dated the day the request was filed and reports the balance standing on that day, which is the
   * running total each approval draws down.
   */
  const cocAsOfLabel = formatCtoLongDate(String(record.dateFiled || record.createdAt || "").slice(0, 10));
  const hoursEarnedLabel = formatCtoEarnedHours(record.cocBalanceHours) || "-";
  /* Hours the credits did not reach. The days are still taken; they are taken without pay. */
  const unpaidHours = Number(record.unpaidHours || 0);
  const isLeaveWithoutPay = unpaidHours > 0.001;
  const disapprovalReason = String(record.rejectedNote || recordRemarks || "").trim();
  const chiefReviewerName = String(record.endorsedByName || "").trim();
  const creditCertifierName = String(record.reviewedByName || "").trim();
  const authorizedOfficialName = String(record.approvedByName || ctoPreviewDefaults.authorizedOfficial).trim();
  const showChiefReviewerSignature = chiefReviewerName !== "" || Number(record.endorsedByEmployeeRecordId || 0) > 0;
  const showCreditCertifierSignature = creditCertifierName !== "" || Number(record.reviewedByEmployeeRecordId || 0) > 0;
  const applicantTimestampLabel = formatSignatureTimestamp(record.createdAt || record.dateFiled);
  const chiefReviewerTimestampLabel = showChiefReviewerSignature
    ? formatSignatureTimestamp(record.endorsedAt || record.updatedAt || record.createdAt || record.dateFiled)
    : "";
  const creditCertifierTimestampLabel = showCreditCertifierSignature
    ? formatSignatureTimestamp(record.reviewedAt || record.updatedAt || record.createdAt || record.dateFiled)
    : "";
  const authorizedOfficialTimestampLabel = (
    authorizedOfficialName || Number(record.approvedByEmployeeRecordId || 0) > 0 || isApproved
  )
    ? formatSignatureTimestamp(record.approvedAt || record.updatedAt || record.createdAt || record.dateFiled)
    : "";

  const handlePrint = () => {
    if (!printRef.current) {
      return;
    }

    const formClone = printRef.current.cloneNode(true);
    const printWindow = window.open("", "_blank", "width=960,height=1200");
    if (!printWindow) {
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Compensatory Time Off Form</title>
          <style>
            @page {
              size: auto;
              margin: 10mm;
            }

            html, body {
              margin: 0;
              padding: 0;
              background: #ffffff;
            }

            body {
              font-family: Arial, sans-serif;
              color: #000000;
            }

            *,
            *::before,
            *::after {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .print-shell {
              width: 100%;
              max-width: 190mm;
              margin: 0 auto;
            }
          </style>
        </head>
        <body>
          <div class="print-shell">${formClone.outerHTML}</div>
        </body>
      </html>
    `);
    printWindow.document.close();

    const formRoot = printWindow.document.querySelector(".print-shell > div");
    if (formRoot) {
      formRoot.style.width = "100%";
      formRoot.style.maxWidth = "190mm";
      formRoot.style.margin = "0 auto";
      formRoot.style.boxShadow = "none";
    }

    const finishPrint = () => {
      printWindow.focus();
      printWindow.print();
      printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
    };

    const images = Array.from(printWindow.document.images || []);
    if (images.length === 0) {
      window.setTimeout(finishPrint, 150);
      return;
    }

    Promise.all(
      images.map((image) => (
        image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
            image.onload = resolve;
            image.onerror = resolve;
          })
      ))
    ).then(() => {
      window.setTimeout(finishPrint, 150);
    });
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close compensatory time off form preview"
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        className={`compensatory-form-preview relative z-10 max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Compensatory Time Off Form</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Centered overlay preview of the submitted CTO request.</p>
          </div>
          {/* Printing is a row action in the table now, so the preview only offers Close. */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-slate-100 px-3 py-4 sm:px-4">
          <div ref={printRef} className="compensatory-form-paper" style={ctoPreviewStyles.page}>
            <div style={ctoPreviewStyles.header}>
              <img src="/mgb.png" alt="MGB Logo" style={ctoPreviewStyles.logoImage} />

              <div style={ctoPreviewStyles.headerText}>
                <p style={{ margin: "1px 0", fontSize: "9px", fontStyle: "italic" }}>Republic of the Philippines</p>
                <p style={{ margin: "1px 0", fontSize: "9.5px" }}>Department of Environment and Natural Resources</p>
                <p style={{ margin: "1px 0", fontSize: "13px", fontWeight: "bold" }}>MINES AND GEOSCIENCES BUREAU</p>
                <p style={{ margin: "1px 0", fontSize: "9.5px" }}>Regional Office No. X</p>
                <p style={{ margin: "1px 0", fontSize: "9.5px" }}>Puntod, Cagayan de Oro City</p>
              </div>

              <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={{ ...ctoPreviewStyles.logoImage, justifySelf: "end" }} />
            </div>

            <hr style={ctoPreviewStyles.hr} />

            <div style={ctoPreviewStyles.formTitle}>
              <p style={{ margin: "0 0 3px", fontSize: "12px" }}>Application for Availment of</p>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: "bold", textDecoration: "underline" }}>
                Compensatory Time Off (CTO)
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto 60px", gap: "0 6px", alignItems: "end", marginBottom: "4px" }}>
              <label style={ctoPreviewStyles.label}>Name:</label>
              <div style={ctoPreviewStyles.fg}>
                <div style={ctoPreviewStyles.fv}>{nameParts.lastName}</div>
                <div style={ctoPreviewStyles.fsub}>(Last)</div>
              </div>
              <span>&nbsp;</span>
              <div style={ctoPreviewStyles.fg}>
                <div style={ctoPreviewStyles.fv}>{nameParts.firstName}</div>
                <div style={ctoPreviewStyles.fsub}>(First)</div>
              </div>
              <span>&nbsp;</span>
              <div style={ctoPreviewStyles.fg}>
                <div style={ctoPreviewStyles.fv}>{nameParts.middleInitial}</div>
                <div style={ctoPreviewStyles.fsub}>(M.I.)</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "0 6px", alignItems: "end", marginBottom: "16px", marginTop: "6px" }}>
              <label style={ctoPreviewStyles.label}>Position:</label>
              <div style={ctoPreviewStyles.fg}>
                <div style={ctoPreviewStyles.fv}>{position}</div>
              </div>
              <label style={ctoPreviewStyles.label}>Office/Division:</label>
              <div style={ctoPreviewStyles.fg}>
                <div style={ctoPreviewStyles.fv}>{division}</div>
              </div>
            </div>

            <div style={ctoPreviewStyles.secHdr}>DETAILS OF APPLICATION</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 0" }}>
              <div style={{ paddingRight: "10px" }}>
                <div style={{ fontSize: "10px", marginBottom: "6px" }}>Number of Hours Applied for:</div>
                <div style={{ ...ctoPreviewStyles.fv, marginBottom: "4px" }}>{hoursLabel}</div>
                <div style={{ ...ctoPreviewStyles.fv, marginBottom: "4px" }}>{datesCovered}</div>
              </div>
              <div style={{ paddingLeft: "10px" }}>
                <div style={{ fontSize: "10px", marginBottom: "6px" }}>Inclusive Dates:</div>
                <div style={{ ...ctoPreviewStyles.fv, marginBottom: "4px" }}>{hoursLabel.toLowerCase()}</div>
                <div style={{ ...ctoPreviewStyles.fv, marginBottom: "4px" }}>{inclusiveDates}</div>
              </div>
            </div>

            {isLeaveWithoutPay ? (
              <div style={{ marginTop: "8px", border: "1px solid #000", padding: "5px 8px", fontSize: "10px" }}>
                <strong>LEAVE WITHOUT PAY:</strong>{" "}
                {formatCreditHours(unpaidHours)} of the hours applied for are not covered by
                compensatory overtime credits and are taken without pay.
              </div>
            ) : null}

            <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px", marginBottom: "6px" }}>
              <div>
                <div style={{ fontSize: "10px", marginBottom: "4px" }}>Recommending Approval:</div>
                <div style={ctoPreviewStyles.signaturePreview}>
                  {showChiefReviewerSignature && chiefReviewerSignature ? (
                    <>
                      <img
                        src={chiefReviewerSignature}
                        alt={`${chiefReviewerName || "Chief"} signature`}
                        style={ctoPreviewStyles.signatureImage}
                      />
                      {chiefReviewerTimestampLabel ? (
                        <div style={ctoPreviewStyles.signatureTimestamp}>{chiefReviewerTimestampLabel}</div>
                      ) : null}
                    </>
                  ) : chiefReviewerTimestampLabel ? (
                    <div style={ctoPreviewStyles.signatureTimestamp}>{chiefReviewerTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={ctoPreviewStyles.signatureName}>{showChiefReviewerSignature ? chiefReviewerName : ""}</div>
                <div style={ctoPreviewStyles.signatureUnderline} />
                <div style={ctoPreviewStyles.sigLabel}>(Head of Office/Division Chief)</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <div style={ctoPreviewStyles.signaturePreview}>
                  {applicantSignature ? (
                    <>
                      <img
                        src={applicantSignature}
                        alt={`${applicantName || "Applicant"} signature`}
                        style={ctoPreviewStyles.signatureImage}
                      />
                      {applicantTimestampLabel ? (
                        <div style={ctoPreviewStyles.signatureTimestamp}>{applicantTimestampLabel}</div>
                      ) : null}
                    </>
                  ) : applicantTimestampLabel ? (
                    <div style={ctoPreviewStyles.signatureTimestamp}>{applicantTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={ctoPreviewStyles.signatureName}>{applicantName}</div>
                <div style={ctoPreviewStyles.signatureUnderline} />
                <div style={ctoPreviewStyles.sigLabel}>(Signature of Applicant)</div>
              </div>
            </div>

            <div style={{ ...ctoPreviewStyles.secHdr, marginTop: "14px" }}>DETAILS OF ACTION ON APPLICATION</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
              <div>
                <div style={{ fontSize: "10px" }}>
                  a. Certification of Compensatory Overtime Credit (COC) as of{" "}
                  <span
                    style={{
                      display: "inline-block",
                      borderBottom: "1px solid #000",
                      minWidth: "80px",
                      minHeight: "14px",
                      padding: "0 4px",
                      textAlign: "center",
                      verticalAlign: "bottom",
                    }}
                  >
                    {cocAsOfLabel}
                  </span>
                </div>
                <div style={{ marginTop: "8px" }}>
                  <div style={{ fontSize: "10px", marginBottom: "3px" }}>Number of Hours Earned</div>
                  <div style={{ ...ctoPreviewStyles.fv, width: "110px", textAlign: "left" }}>{hoursEarnedLabel}</div>
                </div>
                <div style={{ marginTop: "10px", width: "170px" }}>
                  <div style={ctoPreviewStyles.signaturePreview}>
                    {showCreditCertifierSignature && creditCertifierSignature ? (
                      <>
                        <img
                          src={creditCertifierSignature}
                          alt={`${creditCertifierName || "HR Head"} signature`}
                          style={ctoPreviewStyles.signatureImage}
                        />
                        {creditCertifierTimestampLabel ? (
                          <div style={ctoPreviewStyles.signatureTimestamp}>{creditCertifierTimestampLabel}</div>
                        ) : null}
                      </>
                    ) : creditCertifierTimestampLabel ? (
                      <div style={ctoPreviewStyles.signatureTimestamp}>{creditCertifierTimestampLabel}</div>
                    ) : null}
                  </div>
                  <div style={ctoPreviewStyles.signatureName}>{showCreditCertifierSignature ? creditCertifierName : ""}</div>
                  <div style={ctoPreviewStyles.signatureUnderline} />
                  <div style={ctoPreviewStyles.sigLabel}>(HR Head)</div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: "10px", marginBottom: "4px" }}>b. Approval</div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px", fontSize: "10.5px" }}>
                  <PreviewSelectionBox checked={isApproved} />
                  <span>Approved</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px", fontSize: "10.5px" }}>
                  <PreviewSelectionBox checked={isDisapproved} />
                  <span>Disapproval due to</span>
                </div>
                <div style={{ ...ctoPreviewStyles.fv, marginTop: "4px" }}>{isDisapproved ? disapprovalReason : ""}</div>
                <div style={{ ...ctoPreviewStyles.fv, marginTop: "4px" }} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "30px" }}>
              <div style={{ width: "48%", textAlign: "center" }}>
                <div style={ctoPreviewStyles.signaturePreview}>
                  {authorizedOfficialSignature ? (
                    <>
                      <img
                        src={authorizedOfficialSignature}
                        alt={`${authorizedOfficialName || "Authorized official"} signature`}
                        style={ctoPreviewStyles.signatureImage}
                      />
                      {authorizedOfficialTimestampLabel ? (
                        <div style={ctoPreviewStyles.signatureTimestamp}>{authorizedOfficialTimestampLabel}</div>
                      ) : null}
                    </>
                  ) : authorizedOfficialTimestampLabel ? (
                    <div style={ctoPreviewStyles.signatureTimestamp}>{authorizedOfficialTimestampLabel}</div>
                  ) : null}
                </div>
                <div style={{ ...ctoPreviewStyles.fv, fontWeight: "bold", borderBottom: "1px solid #000" }}>
                  {authorizedOfficialName}
                </div>
                <div style={{ fontSize: "9.5px", color: "#555", marginTop: "2px" }}>
                  {ctoPreviewDefaults.authorizedOfficialRole}
                </div>
                <div style={{ fontSize: "9.5px", marginTop: "2px" }}><strong>Authorized Official</strong></div>
              </div>
            </div>

            <div style={{ textAlign: "center", fontSize: "9px", fontStyle: "italic", marginTop: "20px", borderTop: "1px solid #000", paddingTop: "8px", color: "#555" }}>
              "MINING SHALL BE PRO-PEOPLE AND PRO-ENVIRONMENT IN SUSTAINING WEALTH CREATION
              <br />
              AND IMPROVED QUALITY OF LIFE."
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompensatoryModal({
  open,
  submitting,
  employeeOptions,
  selectedEmployee,
  canSelectEmployee,
  defaultValues,
  showHeaderCloseButton = true,
  onClose,
  onSubmit,
}) {
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [creditBalance, setCreditBalance] = useState(null);
  /*
   * Held in a ref so the reset effect below can read the newest defaults without listing
   * `defaultValues` as a dependency. The parent rebuilds that object on every render, and the
   * auto-refresh poll re-renders the workspace every few seconds — depending on it directly
   * wiped whatever the user had typed mid-form.
   */
  const defaultValuesRef = useRef(defaultValues);

  useEffect(() => {
    defaultValuesRef.current = defaultValues;
  }, [defaultValues]);

  // Reset only on the closed -> open transition, never on an incidental re-render.
  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }

    setForm({
      ...initialForm,
      ...defaultValuesRef.current,
    });
    setErrors({});
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  /*
   * Time off is spent against overtime the employee has already rendered, so the balance is read
   * up front and the form can refuse an over-filing without a round trip. Re-read whenever the
   * target employee changes, and on every open, since an approval elsewhere may have moved it.
   *
   * The balance is only kept when the response names the employee it belongs to. An account that
   * is not linked to an employee record resolves to nobody and comes back as zeros — holding that
   * would warn about unpaid hours on a filing the server would have paid for in full, so it is left
   * to the server to judge.
   *
   * Nothing on the form shows the balance: every role files on the same plain form, and a short
   * balance no longer stops a filing. It is read only to decide whether the submit has to warn that
   * the days are going to be taken without pay.
   */
  useEffect(() => {
    if (!open) {
      setCreditBalance(null);
      return undefined;
    }

    let active = true;

    const loadCreditBalance = async () => {
      try {
        const result = await fetchCompensatoryCreditBalance(form.employeeRecordId);
        if (active) {
          setCreditBalance(Number(result?.employeeRecordId) > 0 ? result?.balance || null : null);
        }
      } catch {
        if (active) {
          setCreditBalance(null);
        }
      }
    };

    void loadCreditBalance();

    return () => {
      active = false;
    };
  }, [form.employeeRecordId, open]);

  if (!open) {
    return null;
  }

  /*
   * Compensatory time off is applied for ahead of the days being taken, so the calendar starts
   * today. This holds for every role, admin included -- a back-dated filing is not something any
   * account may enter through this form.
   *
   * Recomputed each render rather than memoised, so a form left open past midnight still moves on.
   */
  const today = todayDateInputValue();

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  /* What the picked days come to. The balance they are weighed against is read at submit. */
  const selectedHours = getSelectedDatesTotal(form.selectedDates) * CTO_HOURS_PER_DAY;

  /*
   * Days past the balance are picked freely. They cost credits the employee may not have, but a
   * filing the credits cannot cover is taken as leave without pay rather than refused, so the
   * warning belongs at the submit — where the filer can weigh it — and not at the calendar.
   */
  const updateSelectedDates = (selectedDates) => {
    setForm((current) => ({ ...current, selectedDates }));
    setErrors((current) => ({ ...current, selectedDates: "" }));
  };

  const handleSelectEmployee = (employee) => {
    setForm((current) => ({
      ...current,
      employeeRecordId: String(employee.employeeRecordId),
    }));
    setErrors((current) => ({ ...current, employeeRecordId: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    /* The hours are what the picked days cost, not a figure typed alongside them. */
    const hours = selectedHours;

    if (canSelectEmployee && !form.employeeRecordId) nextErrors.employeeRecordId = "Employee is required.";
    if (form.selectedDates.length === 0) {
      nextErrors.selectedDates = "Select at least one inclusive date.";
    } else if (hours < 4) {
      nextErrors.selectedDates = "Minimum of 4 hours is required per request — pick at least a half day.";
    }

    /*
     * The picker already refuses these days, but a form left open past midnight can age into a past
     * date, so the rule is enforced again rather than trusted.
     */
    if (form.selectedDates.some((day) => isPastDate(day.date))) {
      nextErrors.selectedDates = "Inclusive dates cannot be in the past. Choose today or a later date.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    /*
     * A filing the credits cannot cover still goes through — the days are taken either way — but the
     * uncovered hours are unpaid, so the filer is told the cost in hours before it is sent rather
     * than finding out on a payslip. The server recomputes this against the balance as it stands
     * when the filing lands, which is the figure that ends up on the record.
     */
    const payableCredits = ctoPayableCredits(creditBalance?.available);

    if (creditBalance && hours > payableCredits + 0.001) {
      const unpaidHours = hours - payableCredits;
      /* What the floor left behind, so the warning can say where the difference went. */
      const strandedCredits = creditBalance.available - payableCredits;
      const confirmation = await Swal.fire({
        title: "File as Leave Without Pay?",
        html: `This filing costs <b>${formatCreditHours(hours)} hours</b> but only <b>${formatCreditHours(creditBalance.available)} hours</b> of compensatory overtime credit are available${creditBalance.year ? ` for ${creditBalance.year}` : ""}.`
          + (strandedCredits > 0.001
            ? `<br /><br />Credits are spent in whole days and halves, so <b>${formatCreditHours(payableCredits)} hours</b> of that can be charged to this filing and <b>${formatCreditHours(strandedCredits)} hours</b> stay on your balance for a later one.`
            : "")
          + `<br /><br />The remaining <b>${formatCreditHours(unpaidHours)} hours</b> will be filed as <b>Leave Without Pay</b>.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, file as leave without pay",
        cancelButtonText: "Go back",
        confirmButtonColor: "#b45309",
        cancelButtonColor: "#64748b",
        reverseButtons: true,
        focusCancel: true,
      });

      if (!confirmation.isConfirmed) {
        return;
      }
    }

    /*
     * The record still keeps a start and an end so lists and the printed form have a span to show;
     * the exact days ride in the remarks column, which every screen unpacks before displaying.
     */
    await onSubmit({
      employeeRecordId: Number(form.employeeRecordId) || 0,
      hoursApplied: Number(hours.toFixed(2)),
      ...getSelectedDatesRange(form.selectedDates),
      remarks: packSelectedDates(form.remarks, form.selectedDates),
    });
  };

  const inputClasses = "min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100";
  const resolvedEmployee = employeeOptions.find(
    (employee) => String(employee.employeeRecordId) === String(form.employeeRecordId)
  ) || selectedEmployee;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close compensatory time off form"
        className={`absolute inset-0 bg-slate-950/60 backdrop-blur-md transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <form
        onSubmit={handleSubmit}
        className={`relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Create Compensatory Time Off</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Log a CTO request with strict hourly limits and inclusive dates.</p>
          </div>
          <div className="flex items-center gap-2">
            <img
              src="/mgb.png"
              alt="MGB Logo"
              className="h-14 w-14 shrink-0 object-contain"
            />
            {showHeaderCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-5 py-5 sm:px-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {canSelectEmployee ? (
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Employee *</span>
                <EmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={resolvedEmployee || null}
                  onSelect={handleSelectEmployee}
                />
                {errors.employeeRecordId ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.employeeRecordId}</p> : null}
              </label>
            ) : (
              /* Nothing to pick — the filing is the signed-in employee's own, so the name is stated. */
              <p className="m-0 text-base font-semibold text-slate-900 sm:col-span-2">
                {resolvedEmployee?.employeeName || "Employee"}
              </p>
            )}

            {/* Derived, never typed: the hours are whatever the picked days cost at 8 per day. */}
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Number of Hours Applied For</span>
              <input
                type="text"
                readOnly
                value={form.selectedDates.length === 0 ? "" : `${formatCreditHours(selectedHours)} hours`}
                placeholder="Pick the inclusive dates first"
                className={`${inputClasses} cursor-not-allowed bg-slate-50 text-slate-600`}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">
                Counted from the dates picked - a whole day is {CTO_HOURS_PER_DAY} hours, an AM or PM half is{" "}
                {CTO_HOURS_PER_DAY / 2}. Minimum 4 hours per request.
              </p>
            </label>

            <div>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                Inclusive Dates *
              </span>
              <MultiDatePicker
                value={form.selectedDates}
                minDate={today}
                allowWeekends
                placeholder="Select inclusive dates"
                onChange={updateSelectedDates}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">
                Pick each day the time off is taken. Days in between that are not picked stay working days.
              </p>
              {errors.selectedDates ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.selectedDates}</p> : null}
            </div>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Remarks</span>
              <textarea
                rows={4}
                value={form.remarks}
                onChange={updateField("remarks")}
                placeholder="Add notes or justification for compensatory request"
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "File CTO"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CompensatoryWorkspace({
  user,
  employees = EMPTY_EMPLOYEES,
  title = "Compensatory Time Off",
  description = "Submit, review, and monitor compensatory time off requests.",
  submitLabel = "File CTO",
  showHeaderCloseButton = true,
  onPendingCountChange,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [printRecord, setPrintRecord] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);

  const roleKey = resolveRoleKey(user);
  const managePermission = canManageLeave(user) || ["chief", "planningofficer"].includes(roleKey);
  const viewAllPermission = canViewAllLeaves(user);
  const allowEmployeeSelection = roleKey === "admin";
  const canArchive = canArchiveModule(roleKey, "cto");
  const [archiveView, setArchiveView] = useState(false);
  const pendingCount = useMemo(() => countPendingRecords(records), [records]);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchCompensatoryRequests({ archived: archiveView });
      const nextRecords = result.records || [];
      setRecords(
        viewAllPermission
          ? nextRecords
          : nextRecords.filter((record) => matchesUserRecordScope(record, user))
      );
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load compensatory requests.");
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView, user, viewAllPermission]);

  const employeeOptions = useMemo(
    () =>
      employees
        .map((employee) => ({
          employeeRecordId: employee.id,
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          division: employee.department,
        }))
        .filter((employee) => employee.employeeRecordId && employee.employeeName)
        .filter((employee) => !(allowEmployeeSelection && matchesUserEmployeeOption(employee, user)))
        .sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
    [allowEmployeeSelection, employees, user]
  );

  const selectedEmployee = useMemo(() => {
    const userEmployeeId = String(user?.employee_id || "").trim().toLowerCase();
    const userName = String(user?.full_name || user?.username || "").trim().toLowerCase();

    const matchedEmployee = employeeOptions.find((employee) => {
      const employeeCode = String(employee.employeeId || "").trim().toLowerCase();
      const employeeName = String(employee.employeeName || "").trim().toLowerCase();

      return (
        (userEmployeeId && employeeCode === userEmployeeId)
        || (userName && employeeName === userName)
      );
    });

    if (allowEmployeeSelection) {
      return null;
    }

    if (matchedEmployee) {
      return matchedEmployee;
    }

    if (user?.full_name || user?.username || user?.employee_id) {
      return {
        employeeRecordId: "",
        employeeId: user?.employee_id || "",
        employeeName: user?.full_name || user?.username || "",
        division: user?.division || "",
      };
    }

    return null;
  }, [allowEmployeeSelection, employeeOptions, user]);

  // The hook reads its callback through a ref, so it will not refetch when `loadRecords` changes
  // identity — this effect does, which is what makes the archive toggle actually reload the table.
  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useAutoRefreshOnChange(loadRecords, { topic: "compensatory", refreshOnMount: false });

  useEffect(() => {
    if (!loading) {
      onPendingCountChange?.(pendingCount);
    }
  }, [loading, onPendingCountChange, pendingCount]);

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = !search || [
        record.employeeName,
        record.division,
        /* The typed remarks only -- the day-selection metadata is never searched against. */
        getNoteDisplay(record.remarks),
        record.status,
        compensatoryStatusLabel(record.status),
        record.hoursApplied,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));

      const matchesStatus = !statusFilter || record.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [query, records, statusFilter]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter, rowsPerPage]);

  const defaultValues = useMemo(
    () => ({
      employeeRecordId: selectedEmployee ? String(selectedEmployee.employeeRecordId) : "",
    }),
    [selectedEmployee]
  );

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const employee = employeeOptions.find(
        (option) => option.employeeRecordId === Number(payload.employeeRecordId)
      ) || selectedEmployee;

      const result = await fileCompensatoryRequest({
        ...payload,
        employeeId: employee?.employeeId || user?.employee_id || "",
        employeeName: employee?.employeeName || user?.full_name || user?.username || "",
      });

      setRecords((current) => [result.record, ...current]);
      setModalOpen(false);
      toast.success("Compensatory time off request submitted successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to submit compensatory time off request.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenPreview = (record) => {
    setPrintRecord(false);
    setSelectedRecord(record);
  };

  /* The preview is the print source: it opens, prints itself once loaded, and closes again. */
  const handlePrintRecord = (record) => {
    setPrintRecord(true);
    setSelectedRecord(record);
  };

  const handleArchiveRecord = async (record, restore = false) => {
    const confirmAction = restore ? confirmRestoreRecord : confirmArchiveRecord;

    await confirmAction({
      module: "cto",
      id: record.id,
      noun: "compensatory request",
      owner: record.employeeName,
      onArchived: () => loadRecords({ background: true }),
      onRestored: () => loadRecords({ background: true }),
    });
  };

  const handleStatusAction = async (action, record) => {
    const isOwnRecord = matchesUserRecordScope(record, user);
    const isSelfCancellation = action === "cancel" && isOwnRecord;
    const currentStatus = normalizeLeaveStatus(record.status);
    const stage = compensatoryStage(currentStatus);

    if (isOwnRecord && !isSelfCancellation) {
      toast.error("You cannot update your own compensatory time off request. Please ask another authorized user to review it.");
      return;
    }

    const nextStatusMap = {
      approve: stage?.next,
      reject: "Rejected",
      cancel: "Cancelled",
    };

    const nextStatus = nextStatusMap[action];
    if (!nextStatus || (!managePermission && !isSelfCancellation)) {
      return;
    }

    if (isSelfCancellation && currentStatus !== "Pending") {
      toast.error("Only pending compensatory time off requests can be cancelled.");
      return;
    }

    /* Each desk signs in turn, so a request only answers to whoever it is waiting on right now. */
    if (!isSelfCancellation && !canActOnCompensatoryStage(roleKey, currentStatus)) {
      toast.error(stage
        ? `This compensatory time off request is waiting on ${stage.desk}.`
        : `This compensatory time off request has already been ${currentStatus.toLowerCase()}.`);
      return;
    }

    const isRejectAction = action === "reject";
    /* Everything short of the Regional Director's signature hands the request on to the next desk. */
    const forwardDesk = action === "approve" ? compensatoryStage(nextStatus)?.desk : null;
    const actionTitle = action === "approve" ? "Approve CTO Request?" : `${nextStatus} Request?`;
    const actionText = isSelfCancellation
      ? `Cancel your compensatory time off request for ${formatDateDisplay(record.startDate)} to ${formatDateDisplay(record.endDate)}?`
      : forwardDesk
        ? `Approve the compensatory request for ${record.employeeName} and forward it to ${forwardDesk} for approval?`
        : action === "approve"
          ? `Give final approval to the compensatory request for ${record.employeeName}?`
          : `Update the compensatory request for ${record.employeeName} to ${nextStatus.toLowerCase()}?`;
    const confirmation = await Swal.fire({
      title: actionTitle,
      text: actionText,
      icon: action === "approve" ? "success" : "warning",
      input: isRejectAction ? "textarea" : undefined,
      inputLabel: isRejectAction ? "Rejected note" : undefined,
      inputPlaceholder: isRejectAction ? "Explain why this compensatory request is being rejected." : undefined,
      inputValue: isRejectAction ? String(record.rejectedNote || "") : undefined,
      inputAttributes: isRejectAction
        ? {
          "aria-label": "Rejected note",
          autocapitalize: "sentences",
        }
        : undefined,
      inputValidator: isRejectAction
        ? (value) => (!String(value || "").trim() ? "Rejected note is required." : undefined)
        : undefined,
      showCancelButton: true,
      confirmButtonText: action === "approve" ? "Yes, approve" : `Yes, mark ${nextStatus.toLowerCase()}`,
      cancelButtonText: "Keep current status",
      confirmButtonColor: action === "approve" ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const rejectedNote = isRejectAction ? String(confirmation.value || "").trim() : "";

    /*
     * One sum covers whichever signature this turns out to be -- the Chief endorsing, HR Head
     * reviewing or the Director approving -- because compensatory.php resolves the stage itself and
     * gates all three the same way. What comes back is the pair to send, not a verdict.
     */
    let captcha = {};

    if (action === "approve") {
      captcha = await requestApprovalCaptcha({
        note: "Answer the sum below to confirm this compensatory time off approval.",
      });

      if (!captcha) {
        return;
      }
    }

    const progressMessage = {
      approve: "Approving compensatory time off request...",
      reject: "Rejecting compensatory time off request...",
      cancel: "Cancelling compensatory time off request...",
    }[action] || "Updating compensatory time off request...";
    const toastId = toast.loading(progressMessage);

    try {
      const result = await updateCompensatoryStatus(record.id, nextStatus, rejectedNote, captcha);
      setRecords((current) =>
        current.map((item) => (item.id === result.record.id ? result.record : item))
      );
      if (selectedRecord?.id === result.record.id) {
        setSelectedRecord(result.record);
      }

      const resultMessage = result.message
        || `Compensatory request ${compensatoryStatusLabel(nextStatus).toLowerCase()}.`;

      if (result.emailNotification === "warning") {
        toast(resultMessage, { id: toastId, icon: "⚠️" });
      } else {
        toast.success(resultMessage, { id: toastId });
      }
    } catch (error) {
      const errorMessage = error?.response?.data?.message
        || (isCaptchaFailure(error)
          ? "Security check failed. Please try again."
          : error?.message || "Unable to update compensatory request.");

      toast.error(errorMessage, { id: toastId });
    }
  };

  /*
   * Which actions a row offers depends on the viewer's role and where the request sits in the Chief,
   * HR Head, then Regional Director chain. That decision lives here so the table and the
   * narrow-screen cards below it cannot drift apart.
   */
  const renderRecordActions = (record) => {
    const isOwnRecord = matchesUserRecordScope(record, user);
    const normalizedStatus = normalizeLeaveStatus(record.status);
    const canDecide = managePermission
      && !isOwnRecord
      && canActOnCompensatoryStage(roleKey, normalizedStatus);
    /* The Chief and Regional Director decide requests with Approve or Reject; neither withdraws them. */
    const showCancelAction = !["chief", "regionaldirector"].includes(roleKey)
      && (canDecide || (isOwnRecord && normalizedStatus === "Pending"));
    const forwardDesk = compensatoryStage(compensatoryStage(normalizedStatus)?.next)?.desk;
    const canReviewRecord = managePermission;
    /* The form is only worth printing once the Regional Director has given final approval. */
    const showPrintAction = isRegionalDirectorApproved(record);

    if (archiveView) {
      return (
        <>
          <ActionIconButton
            label="View compensatory form"
            icon={faEye}
            tone="view"
            onClick={() => handleOpenPreview(record)}
          />
          {showPrintAction ? (
            <ActionIconButton
              label="Print compensatory form"
              icon={faPrint}
              tone="print"
              onClick={() => handlePrintRecord(record)}
            />
          ) : null}
          <ActionIconButton
            label="Restore compensatory request"
            icon={faRotateLeft}
            tone="restore"
            onClick={() => handleArchiveRecord(record, true)}
          />
        </>
      );
    }

    return (
      <>
        <ActionIconButton
          label={canReviewRecord ? "Review compensatory request" : "View compensatory form"}
          icon={canReviewRecord ? faFileLines : faEye}
          tone={canReviewRecord ? "review" : "view"}
          onClick={() => handleOpenPreview(record)}
        />
        {showPrintAction ? (
          <ActionIconButton
            label="Print compensatory form"
            icon={faPrint}
            tone="print"
            onClick={() => handlePrintRecord(record)}
          />
        ) : null}
        {canDecide ? (
          <>
            <ActionIconButton
              label={forwardDesk ? `Approve and forward to ${forwardDesk}` : "Approve compensatory request"}
              icon={faCheck}
              tone="approve"
              onClick={() => handleStatusAction("approve", record)}
            />
            <ActionIconButton
              label="Reject compensatory request"
              icon={faXmark}
              tone="reject"
              onClick={() => handleStatusAction("reject", record)}
            />
          </>
        ) : null}
        {showCancelAction ? (
          <ActionIconButton
            label="Cancel compensatory request"
            icon={faBan}
            tone="cancel"
            onClick={() => handleStatusAction("cancel", record)}
          />
        ) : null}
        {canArchive ? (
          <ActionIconButton
            label="Archive compensatory request"
            icon={faBoxArchive}
            tone="archive"
            onClick={() => handleArchiveRecord(record)}
          />
        ) : null}
      </>
    );
  };

  return (
    <div className="compensatory-workspace space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="m-0 text-base font-semibold text-slate-950">
                {archiveView ? "Archived Compensatory Requests" : title}
              </h3>
              <p className="m-0 mt-1 text-sm text-slate-500">
                {archiveView
                  ? "Compensatory requests moved to archive. Restore one to put it back in the list."
                  : description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {canArchive ? (
                <ArchiveViewToggle
                  archiveView={archiveView}
                  onToggle={(next) => {
                    setArchiveView(next);
                    setCurrentPage(1);
                  }}
                  label="compensatory requests"
                />
              ) : null}
              {archiveView ? null : (
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
                >
                  <FilePenLine size={16} />
                  {submitLabel}
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,260px)_170px_120px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={viewAllPermission ? "Search employee, remarks, hours, status" : "Search remarks, hours, status"}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              {COMPENSATORY_STATUSES.map((item) => (
                <option key={item} value={item}>{compensatoryStatusLabel(item)}</option>
              ))}
            </select>
            <select
              value={rowsPerPage}
              onChange={(event) => setRowsPerPage(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="5">5 rows</option>
              <option value="10">10 rows</option>
              <option value="20">20 rows</option>
            </select>
          </div>
        </div>

        <div>
          {/* Cards below `lg`, table from `lg` up — see the note in `RecordCards`. */}
          <RecordCards
            className="mt-4 lg:hidden"
            items={paginatedRecords}
            loading={loading}
            loadingCards={3}
            empty={{
              icon: Clock3,
              title: "No compensatory requests found",
              description: "Submit a request or adjust the filters.",
            }}
            renderCard={(record, index) => ({
              eyebrow: `#${(safePage - 1) * pageSize + index + 1}`,
              title: `${Number(record.hoursApplied).toFixed(2)} hrs applied`,
              subtitle: formatRecordDates(record),
              badge: <StatusBadge status={record.status} />,
              fields: [
                { label: "Employee", value: record.employeeName },
                ...(record.isLeaveWithoutPay
                  ? [{ label: "Leave Without Pay", value: `${formatCreditHours(record.unpaidHours)} hrs uncovered` }]
                  : []),
                { label: "Division", value: record.division || "Unassigned" },
                { label: "Date Filed", value: formatDateDisplay(record.dateFiled) },
                { label: "Remarks", value: getNoteDisplay(record.remarks) || "No remarks provided.", full: true },
              ],
              actions: renderRecordActions(record),
            })}
          />

          <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    {["#", "Employee", "Division", "Hours", "Inclusive Dates", "Remarks", "Status", "Date Filed", "Actions"].map((header) => (
                      <th key={header} className="border-b border-slate-200 px-3 py-3 text-left text-xs font-bold uppercase text-slate-600">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="animate-pulse border-b border-slate-100">
                        <td colSpan={9} className="px-3 py-3">
                          <div className="h-5 rounded bg-slate-200" />
                        </td>
                      </tr>
                    ))
                  ) : paginatedRecords.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center">
                        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                          <Clock3 size={20} />
                        </div>
                        <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No compensatory requests found</p>
                        <p className="m-0 mt-1 text-sm text-slate-500">Submit a request or adjust the filters.</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedRecords.map((record, index) => {
                      return (
                        <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                          <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                            {(safePage - 1) * pageSize + index + 1}
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-800">
                            <div className="font-semibold text-slate-900">{record.employeeName}</div>
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-600">{record.division || "Unassigned"}</td>
                          <td className="px-3 py-3 text-sm font-semibold text-slate-700">
                            {Number(record.hoursApplied).toFixed(2)} hrs
                            {/* The credits did not cover all of it, which is what the payroll desk needs to see. */}
                            {record.isLeaveWithoutPay ? (
                              <span className="mt-1 block text-xs font-semibold text-rose-700">
                                {formatCreditHours(record.unpaidHours)} hrs without pay
                              </span>
                            ) : null}
                          </td>
                          <td className="max-w-[220px] px-3 py-3 text-sm text-slate-600">
                            {formatRecordDates(record)}
                          </td>
                          <td className="max-w-[260px] px-3 py-3 text-sm text-slate-700">
                            <p className="m-0 line-clamp-2">{getNoteDisplay(record.remarks) || "No remarks provided."}</p>
                          </td>
                          <td className="px-3 py-3"><StatusBadge status={record.status} /></td>
                          <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(record.dateFiled)}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">{renderRecordActions(record)}</div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-slate-500">
              Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredRecords.length)} of {filteredRecords.length} compensatory requests
            </p>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </div>
      </section>

      <CompensatoryModal
        open={modalOpen}
        submitting={submitting}
        employeeOptions={employeeOptions}
        selectedEmployee={selectedEmployee}
        canSelectEmployee={allowEmployeeSelection}
        defaultValues={defaultValues}
        showHeaderCloseButton={showHeaderCloseButton}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />

      <CompensatoryPreviewModal
        record={selectedRecord}
        employees={employees}
        autoPrint={printRecord}
        onClose={() => {
          setSelectedRecord(null);
          setPrintRecord(false);
        }}
      />
    </div>
  );
}
