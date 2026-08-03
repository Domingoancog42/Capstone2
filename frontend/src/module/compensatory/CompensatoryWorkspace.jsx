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
import { faBan, faCheck, faEye, faFileLines, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Pagination from "../../components/UI/Pagination";
import { getEmployeeSignature } from "../../services/api";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  canManageLeave,
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  matchesUserRecordScope,
  matchesUserEmployeeOption,
  normalizeLeaveStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { buildSignatureTimestampLabel } from "../../utils/signatureTimestamp";
import { requestApprovalCaptcha } from "../../utils/approvalCaptcha";
import {
  fetchCompensatoryRequests,
  fileCompensatoryRequest,
  updateCompensatoryStatus,
} from "../../services/compensatoryService";

const COMPENSATORY_STATUSES = ["Pending", "Reviewed", "Approved", "Rejected", "Cancelled"];

const initialForm = {
  employeeRecordId: "",
  hoursApplied: "",
  startDate: "",
  endDate: "",
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
    alignItems: "flex-end",
    justifyContent: "center",
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

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${getStatusBadgeClasses(status)}`}>
      {status}
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
  onClose,
}) {
  const [visible, setVisible] = useState(false);
  const [applicantSignature, setApplicantSignature] = useState("");
  const [chiefReviewerSignature, setChiefReviewerSignature] = useState("");
  const [authorizedOfficialSignature, setAuthorizedOfficialSignature] = useState("");
  const printRef = useRef(null);

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

    loadApplicantSignature();

    return () => {
      mounted = false;
    };
  }, [record]);

  useEffect(() => {
    let mounted = true;

    const reviewerEmployeeRecordId = Number(record?.reviewedByEmployeeRecordId || 0);

    if (!record || reviewerEmployeeRecordId <= 0) {
      setChiefReviewerSignature("");
      return () => {
        mounted = false;
      };
    }

    setChiefReviewerSignature("");

    const loadChiefReviewerSignature = async () => {
      try {
        const result = await getEmployeeSignature(reviewerEmployeeRecordId);
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

    loadChiefReviewerSignature();

    return () => {
      mounted = false;
    };
  }, [record]);

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

    loadAuthorizedOfficialSignature();

    return () => {
      mounted = false;
    };
  }, [record]);

  if (!record) {
    return null;
  }

  const employee = findCompensatoryEmployee(record, employees);
  const applicantName = String(record.employeeName || employee?.fullName || "").trim();
  const nameParts = splitCompensatoryName(applicantName);
  const position = String(employee?.position || "").trim();
  const division = String(record.division || employee?.department || "").trim();
  const hoursLabel = formatCtoHours(record.hoursApplied);
  const datesCovered = formatCtoCoveredDates(record.startDate, record.endDate);
  const inclusiveDates = formatCtoDateRange(record.startDate, record.endDate);
  const normalizedStatus = normalizeLeaveStatus(record.status);
  const isApproved = normalizedStatus === "Approved";
  const isDisapproved = normalizedStatus === "Rejected";
  const chiefReviewerName = String(record.reviewedByName || "").trim();
  const authorizedOfficialName = String(record.approvedByName || ctoPreviewDefaults.authorizedOfficial).trim();
  const showChiefReviewerSignature = chiefReviewerName !== "" || Number(record.reviewedByEmployeeRecordId || 0) > 0;
  const applicantTimestampLabel = buildSignatureTimestampLabel(
    "Filed",
    record.createdAt || record.dateFiled
  );
  const chiefReviewerTimestampLabel = showChiefReviewerSignature
    ? buildSignatureTimestampLabel(
      "Date",
      record.reviewedAt || record.updatedAt || record.createdAt || record.dateFiled
    )
    : "";
  const authorizedOfficialTimestampLabel = (
    authorizedOfficialName || Number(record.approvedByEmployeeRecordId || 0) > 0 || isApproved
  )
    ? buildSignatureTimestampLabel(
      "Date",
      record.approvedAt || record.updatedAt || record.createdAt || record.dateFiled
    )
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
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Print Form
            </button>
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

            <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px", marginBottom: "6px" }}>
              <div>
                <div style={{ fontSize: "10px", marginBottom: "4px" }}>Recommending Approval:</div>
                <div style={ctoPreviewStyles.signaturePreview}>
                  {showChiefReviewerSignature && chiefReviewerSignature ? (
                    <img
                      src={chiefReviewerSignature}
                      alt={`${chiefReviewerName || "Chief"} signature`}
                      style={ctoPreviewStyles.signatureImage}
                    />
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
                    <img
                      src={applicantSignature}
                      alt={`${applicantName || "Applicant"} signature`}
                      style={ctoPreviewStyles.signatureImage}
                    />
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
                  <span style={{ display: "inline-block", borderBottom: "1px solid #000", minWidth: "80px", minHeight: "14px", verticalAlign: "bottom" }} />
                </div>
                <div style={{ marginTop: "8px" }}>
                  <div style={{ fontSize: "10px", marginBottom: "3px" }}>Number of Hours Earned</div>
                  <div style={{ ...ctoPreviewStyles.fv, width: "80px", textAlign: "left" }}>-</div>
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
                <div style={{ ...ctoPreviewStyles.fv, marginTop: "4px" }}>{isDisapproved ? (record.remarks || "") : ""}</div>
                <div style={{ ...ctoPreviewStyles.fv, marginTop: "4px" }} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "30px" }}>
              <div style={{ width: "48%", textAlign: "center" }}>
                <div style={ctoPreviewStyles.signaturePreview}>
                  {authorizedOfficialSignature ? (
                    <img
                      src={authorizedOfficialSignature}
                      alt={`${authorizedOfficialName || "Authorized official"} signature`}
                      style={ctoPreviewStyles.signatureImage}
                    />
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

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }

    setForm({
      ...initialForm,
      ...defaultValues,
    });
    setErrors({});
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [defaultValues, open]);

  if (!open) {
    return null;
  }

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
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
    const hours = Number(form.hoursApplied);

    if (canSelectEmployee && !form.employeeRecordId) nextErrors.employeeRecordId = "Employee is required.";
    if (!form.hoursApplied) {
      nextErrors.hoursApplied = "Number of hours applied for is required.";
    } else if (Number.isNaN(hours) || hours <= 0 || hours > 4) {
      nextErrors.hoursApplied = "Maximum of 4 hours is allowed per request.";
    }
    if (!form.startDate) nextErrors.startDate = "Inclusive start date is required.";
    if (!form.endDate) nextErrors.endDate = "Inclusive end date is required.";
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      nextErrors.endDate = "Inclusive end date must not be earlier than the start date.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit({
      employeeRecordId: Number(form.employeeRecordId) || 0,
      hoursApplied: Number(hours.toFixed(2)),
      startDate: form.startDate,
      endDate: form.endDate,
      remarks: form.remarks.trim(),
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
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Employee *</span>
              {canSelectEmployee ? (
                <EmployeeSearchSelect
                  employeeOptions={employeeOptions}
                  selectedEmployee={resolvedEmployee || null}
                  onSelect={handleSelectEmployee}
                />
              ) : (
                <input
                  type="text"
                  value={resolvedEmployee?.employeeName || ""}
                  readOnly
                  className={`${inputClasses} cursor-not-allowed bg-slate-50 text-slate-500`}
                />
              )}
              {errors.employeeRecordId ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.employeeRecordId}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Number of Hours Applied For *</span>
              <input
                type="number"
                min="0.5"
                max="4"
                step="0.25"
                value={form.hoursApplied}
                onChange={updateField("hoursApplied")}
                placeholder="Max 4 hours per request"
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Strict limit: 4 hours maximum for each request.</p>
              {errors.hoursApplied ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.hoursApplied}</p> : null}
            </label>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Request Rule</p>
              <p className="m-0 mt-2 text-sm font-semibold text-slate-900">Hours must stay between 0.25 and 4.00.</p>
              <p className="m-0 mt-1 text-sm text-slate-600">Use remarks to explain the offsetting work or justification.</p>
            </div>

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                Inclusive Start Date *
              </span>
              <input
                type="date"
                value={form.startDate}
                onChange={updateField("startDate")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: dd/mm/yyyy</p>
              {errors.startDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.startDate}</p> : null}
            </label>

            <label>
              <span className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-700">
                <CalendarDays size={15} />
                Inclusive End Date *
              </span>
              <input
                type="date"
                value={form.endDate}
                onChange={updateField("endDate")}
                className={inputClasses}
              />
              <p className="m-0 mt-1 text-xs text-slate-500">Format: dd/mm/yyyy</p>
              {errors.endDate ? <p className="m-0 mt-1 text-xs text-rose-700">{errors.endDate}</p> : null}
            </label>

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
            {submitting ? "Submitting..." : "Submit Compensatory Time Off"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CompensatoryWorkspace({
  user,
  employees = [],
  title = "Compensatory Time Off",
  description = "Submit, review, and monitor compensatory time off requests.",
  submitLabel = "File Compensatory Time Off",
  showHeaderCloseButton = true,
  showEmployeeFilter = true,
  onPendingCountChange,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [query, setQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);

  const roleKey = resolveRoleKey(user);
  const managePermission = canManageLeave(user) || roleKey === "chief";
  const viewAllPermission = canViewAllLeaves(user);
  const allowEmployeeSelection = roleKey === "admin";
  const pendingCount = useMemo(() => countPendingRecords(records), [records]);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const result = await fetchCompensatoryRequests();
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
  }, [user, viewAllPermission]);

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

  useAutoRefreshOnChange(loadRecords, { topic: "compensatory" });

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
        record.remarks,
        record.status,
        record.hoursApplied,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));

      const matchesEmployee = !employeeFilter || String(record.employeeRecordId) === employeeFilter;
      const matchesStatus = !statusFilter || record.status === statusFilter;
      const matchesStart = !startDateFilter || record.startDate >= startDateFilter;
      const matchesEnd = !endDateFilter || record.endDate <= endDateFilter;

      return matchesSearch && matchesEmployee && matchesStatus && matchesStart && matchesEnd;
    });
  }, [employeeFilter, endDateFilter, query, records, startDateFilter, statusFilter]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, employeeFilter, statusFilter, startDateFilter, endDateFilter, rowsPerPage]);

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

  const handleStatusAction = async (action, record) => {
    const isOwnRecord = matchesUserRecordScope(record, user);
    const isSelfCancellation = action === "cancel" && isOwnRecord;
    const currentStatus = normalizeLeaveStatus(record.status);
    const isHrHead = roleKey === "hrhead";
    const isRegionalDirector = roleKey === "regionaldirector";

    if (isOwnRecord && !isSelfCancellation) {
      toast.error("You cannot update your own compensatory time off request. Please ask another authorized user to review it.");
      return;
    }

    const nextStatusMap = {
      approve: isHrHead ? "Reviewed" : "Approved",
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

    if (action === "approve" && isHrHead && currentStatus !== "Pending") {
      toast.error("HR Head can only approve pending compensatory time off requests.");
      return;
    }

    if (action === "approve" && isRegionalDirector && currentStatus !== "Reviewed") {
      toast.error("Regional Director can only final approve requests after HR Head approval.");
      return;
    }

    if ((action === "reject" || action === "cancel") && isRegionalDirector && currentStatus !== "Reviewed") {
      toast.error("Regional Director can only take final action after HR Head approval.");
      return;
    }

    const isRejectAction = action === "reject";
    const isHrHeadApproval = action === "approve" && isHrHead;
    const actionTitle = isHrHeadApproval ? "Approve CTO Request?" : `${nextStatus} Request?`;
    const actionText = isSelfCancellation
      ? `Cancel your compensatory time off request for ${formatDateDisplay(record.startDate)} to ${formatDateDisplay(record.endDate)}?`
      : isHrHeadApproval
        ? `Approve the compensatory request for ${record.employeeName} and forward it to Regional Director for final approval?`
        : `Update the compensatory request for ${record.employeeName} to ${nextStatus.toLowerCase()}?`;
    const confirmation = await Swal.fire({
      title: actionTitle,
      text: actionText,
      icon: nextStatus === "Approved" || nextStatus === "Reviewed" ? "success" : "warning",
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
      confirmButtonText: isHrHeadApproval ? "Yes, approve" : `Yes, mark ${nextStatus.toLowerCase()}`,
      cancelButtonText: "Keep current status",
      confirmButtonColor: nextStatus === "Approved" || nextStatus === "Reviewed" ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const rejectedNote = isRejectAction ? String(confirmation.value || "").trim() : "";

    if (action === "approve") {
      const captchaConfirmed = await requestApprovalCaptcha({
        text: "Solve the captcha before this compensatory time off approval is completed.",
        confirmButtonText: "Verify and approve",
      });

      if (!captchaConfirmed) {
        return;
      }
    }

    try {
      const result = await updateCompensatoryStatus(record.id, nextStatus, rejectedNote);
      setRecords((current) =>
        current.map((item) => (item.id === result.record.id ? result.record : item))
      );
      if (selectedRecord?.id === result.record.id) {
        setSelectedRecord(result.record);
      }

      await Swal.fire({
        toast: true,
        position: "top-end",
        title: result.emailNotification === "warning" ? "Updated with warning" : "Updated",
        text: result.message || `Compensatory request ${nextStatus.toLowerCase()}.`,
        icon: result.emailNotification === "warning" ? "warning" : "success",
        width: result.emailNotification === "warning" ? 420 : 360,
        timer: 3000,
        timerProgressBar: true,
        showConfirmButton: false,
        padding: "0.75rem 0.9rem",
      });
    } catch (error) {
      await Swal.fire({
        toast: true,
        position: "top-end",
        title: "Update failed",
        text: error?.response?.data?.message || error?.message || "Unable to update compensatory request.",
        icon: "error",
        width: 360,
        timer: 4000,
        timerProgressBar: true,
        showConfirmButton: false,
        padding: "0.75rem 0.9rem",
      });
    }
  };

  const filterGridClass = showEmployeeFilter
    ? "mt-4 grid gap-3 xl:grid-cols-[minmax(0,190px)_170px_140px_140px_140px_110px]"
    : "mt-4 grid gap-3 xl:grid-cols-[minmax(0,200px)_150px_150px_150px_120px]";

  return (
    <div className="compensatory-workspace space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="m-0 text-base font-semibold text-slate-950">{title}</h3>
              <p className="m-0 mt-1 text-sm text-slate-500">{description}</p>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              <FilePenLine size={16} />
              {submitLabel}
            </button>
          </div>

          <div className={filterGridClass}>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={viewAllPermission ? "Search employee, remarks, hours, status" : "Search remarks, hours, status"}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            {showEmployeeFilter ? (
              <select
                value={employeeFilter}
                onChange={(event) => setEmployeeFilter(event.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">All employees</option>
                {employeeOptions.map((employee) => (
                  <option key={employee.employeeRecordId} value={employee.employeeRecordId}>
                    {employee.employeeName}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="date"
              value={startDateFilter}
              onChange={(event) => setStartDateFilter(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              aria-label="Filter by start date"
            />
            <input
              type="date"
              value={endDateFilter}
              onChange={(event) => setEndDateFilter(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              aria-label="Filter by end date"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              {COMPENSATORY_STATUSES.map((item) => (
                <option key={item} value={item}>{item}</option>
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
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
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
                      const isOwnRecord = matchesUserRecordScope(record, user);
                      const normalizedStatus = normalizeLeaveStatus(record.status);
                      const isHrHead = roleKey === "hrhead";
                      const isRegionalDirector = roleKey === "regionaldirector";
                      const isOtherReviewer = !isHrHead && !isRegionalDirector;
                      const showOwnCancelAction = isOwnRecord && normalizedStatus === "Pending";
                      const showApproveAction = managePermission
                        && !isOwnRecord
                        && (
                          (isHrHead && normalizedStatus === "Pending")
                          || (isRegionalDirector && normalizedStatus === "Reviewed")
                          || (isOtherReviewer && (normalizedStatus === "Pending" || normalizedStatus === "Reviewed"))
                        );
                      const showRejectCancelActions = managePermission
                        && !isOwnRecord
                        && (
                          (isHrHead && normalizedStatus === "Pending")
                          || (isRegionalDirector && normalizedStatus === "Reviewed")
                          || (isOtherReviewer && (normalizedStatus === "Pending" || normalizedStatus === "Reviewed"))
                        );
                      const canReviewRecord = managePermission;

                      return (
                        <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                          <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                            {(safePage - 1) * pageSize + index + 1}
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-800">
                            <div className="font-semibold text-slate-900">{record.employeeName}</div>
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-600">{record.division || "Unassigned"}</td>
                          <td className="px-3 py-3 text-sm font-semibold text-slate-700">{Number(record.hoursApplied).toFixed(2)} hrs</td>
                          <td className="px-3 py-3 text-sm text-slate-600">
                            <div>{formatDateDisplay(record.startDate)}</div>
                            <div className="text-xs text-slate-400">to {formatDateDisplay(record.endDate)}</div>
                          </td>
                          <td className="max-w-[260px] px-3 py-3 text-sm text-slate-700">
                            <p className="m-0 line-clamp-2">{record.remarks || "No remarks provided."}</p>
                          </td>
                          <td className="px-3 py-3"><StatusBadge status={record.status} /></td>
                          <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(record.dateFiled)}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <ActionIconButton
                                label={canReviewRecord ? "Review compensatory request" : "View compensatory form"}
                                icon={canReviewRecord ? faFileLines : faEye}
                                tone={canReviewRecord ? "review" : "view"}
                                onClick={() => setSelectedRecord(record)}
                              />
                              {showApproveAction || showRejectCancelActions ? (
                                <>
                                  {showApproveAction ? (
                                    <ActionIconButton
                                      label={isHrHead ? "Approve and forward compensatory request" : "Approve compensatory request"}
                                      icon={faCheck}
                                      tone="approve"
                                      onClick={() => handleStatusAction("approve", record)}
                                    />
                                  ) : null}
                                  {showRejectCancelActions ? (
                                    <ActionIconButton
                                      label="Reject compensatory request"
                                      icon={faXmark}
                                      tone="reject"
                                      onClick={() => handleStatusAction("reject", record)}
                                    />
                                  ) : null}
                                  {showRejectCancelActions ? (
                                    <ActionIconButton
                                      label="Cancel compensatory request"
                                      icon={faBan}
                                      tone="cancel"
                                      onClick={() => handleStatusAction("cancel", record)}
                                    />
                                  ) : null}
                                </>
                              ) : null}
                              {showOwnCancelAction ? (
                                <ActionIconButton
                                  label="Cancel compensatory request"
                                  icon={faBan}
                                  tone="cancel"
                                  onClick={() => handleStatusAction("cancel", record)}
                                />
                              ) : null}
                            </div>
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
        onClose={() => setSelectedRecord(null)}
      />
    </div>
  );
}


