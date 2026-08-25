import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, Eye, FileText, Paperclip, UserRound, X } from "lucide-react";
import LeaveStatusBadge from "./LeaveStatusBadge";
import {
  formatDateDisplay,
  formatDurationLabel,
} from "../../utils/leaveHelpers";
import { formatSelectedDatesSummary } from "../../utils/dateSelection";
import {
  getLeaveReasonDisplay,
  unpackLeaveReason,
} from "../../utils/leaveRequestDetails";

const VACATION_SCOPE_LABELS = {
  within_philippines: "Within the Philippines",
  abroad: "Abroad",
};

const SICK_LEAVE_MODE_LABELS = {
  in_hospital: "In Hospital",
  out_patient: "Out Patient",
};

const STUDY_LEAVE_PURPOSE_LABELS = {
  masters: "Completion of Master's Degree",
  bar_review: "BAR/Board Examination Review",
};

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost/Capstone2/frontend/backend/api";

function normalizeLeaveType(value) {
  return String(value || "").trim().toLowerCase();
}

function isVacationOrSpecialPrivilegeLeave(leaveType) {
  const normalizedLeaveType = normalizeLeaveType(leaveType);
  return normalizedLeaveType === "vacation leave" || normalizedLeaveType === "special privilege leave";
}

function buildLeaveDetailRows(request) {
  const { details } = unpackLeaveReason(request?.reason);
  const normalizedLeaveType = normalizeLeaveType(request?.leaveType);
  const rows = [];

  if (isVacationOrSpecialPrivilegeLeave(normalizedLeaveType) && details.vacationScope) {
    rows.push({
      label: "Location",
      value: VACATION_SCOPE_LABELS[details.vacationScope] || details.vacationScope,
    });

    if (details.vacationScope === "abroad" && details.vacationNote) {
      rows.push({
        label: "Specify Abroad",
        value: details.vacationNote,
      });
    }
  }

  if (normalizedLeaveType === "sick leave" && details.sickLeaveMode) {
    rows.push({
      label: "Treatment Type",
      value: SICK_LEAVE_MODE_LABELS[details.sickLeaveMode] || details.sickLeaveMode,
    });

    if (details.sickLeaveIllness) {
      rows.push({
        label: "Specify Illness",
        value: details.sickLeaveIllness,
      });
    }
  }

  if (normalizedLeaveType === "study leave" && details.studyLeavePurpose) {
    rows.push({
      label: "Study Leave Purpose",
      value: STUDY_LEAVE_PURPOSE_LABELS[details.studyLeavePurpose] || details.studyLeavePurpose,
    });
  }

  return rows;
}

function resolveAttachmentUrl(attachmentPath, attachmentName) {
  const preferredValue = String(attachmentPath || attachmentName || "").trim();
  if (!preferredValue) {
    return "";
  }

  let backendRootUrl = "";
  try {
    const apiUrl = new URL(API_BASE_URL, window.location.origin);
    const backendBasePath = apiUrl.pathname.replace(/\/api\/?$/, "/");
    backendRootUrl = `${apiUrl.origin}${backendBasePath}`;
  } catch {
    backendRootUrl = `${window.location.origin}/`;
  }

  if (/^(https?:|data:|blob:)/i.test(preferredValue)) {
    return preferredValue;
  }

  if (/^[a-z]:\\/i.test(preferredValue)) {
    return "";
  }

  if (preferredValue.startsWith("/")) {
    return `${window.location.origin}${preferredValue}`;
  }

  if (preferredValue.includes("/") || preferredValue.includes("\\")) {
    const normalizedPath = preferredValue.replace(/\\/g, "/").replace(/^\/+/, "");
    return new URL(normalizedPath, backendRootUrl).toString();
  }

  return "";
}

function isImageAttachment(value) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(value || ""));
}

function isPdfAttachment(value) {
  return /\.pdf$/i.test(String(value || ""));
}

function DetailCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Icon size={16} />
        <span>{label}</span>
      </div>
      <p className="m-0 mt-2 text-sm text-slate-900">{value || "N/A"}</p>
    </div>
  );
}

function AttachmentViewerCard({ attachmentName, previewUrl, previewKey, onClose }) {
  const imagePreview = isImageAttachment(previewKey);
  const pdfPreview = isPdfAttachment(previewKey);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close attachment preview"
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h3 className="m-0 text-lg font-semibold text-slate-950">Attachment Preview</h3>
            <p className="m-0 mt-1 break-all text-sm text-slate-500">{attachmentName}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <ExternalLink size={14} />
              Open New Tab
            </a>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] overflow-auto bg-slate-100 p-4 sm:p-5">
          {imagePreview ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3">
              <img
                src={previewUrl}
                alt={attachmentName}
                className="max-h-[68vh] w-full rounded-2xl object-contain"
              />
            </div>
          ) : pdfPreview ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <iframe
                src={previewUrl}
                title={attachmentName}
                className="h-[70vh] w-full border-0"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
              <p className="m-0 text-sm font-semibold text-slate-800">Preview is not available for this file type.</p>
              <p className="m-0 mt-2 text-sm text-slate-500">Open the file in a new tab to review it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentPreview({ attachmentName, attachmentPath }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const previewUrl = resolveAttachmentUrl(attachmentPath, attachmentName);
  const previewKey = previewUrl || attachmentName;
  const canPreviewInCard = Boolean(previewUrl && (isImageAttachment(previewKey) || isPdfAttachment(previewKey)));

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Paperclip size={16} />
          <span>Attachment Upload</span>
        </div>

        {attachmentName ? (
          <>
            <p className="m-0 mt-2 break-all text-sm font-medium text-slate-900">{attachmentName}</p>

            {canPreviewInCard ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewerOpen(true)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
                >
                  <Eye size={15} />
                  View Attach
                </button>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <ExternalLink size={14} />
                  Open New Tab
                </a>
              </div>
            ) : previewUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <ExternalLink size={14} />
                  Open Attachment
                </a>
              </div>
            ) : null}

            {!previewUrl ? (
              <p className="m-0 mt-3 text-xs text-slate-500">
                This request saved the attachment file name only, so there is no preview link available yet.
              </p>
            ) : canPreviewInCard ? (
              <p className="m-0 mt-3 text-xs text-slate-500">
                Click view attach to open the uploaded file in a floating preview card.
              </p>
            ) : (
              <p className="m-0 mt-3 text-xs text-slate-500">
                This file type can be opened in a new tab, but it does not support the in-app floating preview.
              </p>
            )}
          </>
        ) : (
          <p className="m-0 mt-2 text-sm text-slate-500">No attachment uploaded.</p>
        )}
      </div>

      {viewerOpen ? (
        <AttachmentViewerCard
          attachmentName={attachmentName}
          previewUrl={previewUrl}
          previewKey={previewKey}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </>
  );
}

export default function LeaveReviewModal({
  open = false,
  request = null,
  onClose,
  roleKey = "",
}) {
  const [visible, setVisible] = useState(false);
  const isHrHead = String(roleKey || "").trim().toLowerCase() === "hrhead";

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const detailRows = useMemo(() => buildLeaveDetailRows(request), [request]);
  const displayReason = useMemo(
    () => getLeaveReasonDisplay(request?.reason, request?.leaveType),
    [request]
  );
  const rejectedNote = useMemo(
    () => String(request?.rejectedNote || "").trim(),
    [request]
  );
  /*
   * A request covers the days it actually named, which can skip working days inside its span, so the
   * exact list is shown. Requests filed as a plain range still read as start to end.
   */
  const inclusiveDates = useMemo(() => {
    const { details } = unpackLeaveReason(request?.reason);
    return formatSelectedDatesSummary(details.leaveDays)
      || `${formatDateDisplay(request?.startDate)} to ${formatDateDisplay(request?.endDate)}`;
  }, [request]);

  if (!open || !request) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center p-4 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={isHrHead ? "Close leave request approval" : "Close leave request review"}
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        className={`relative z-10 max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-[28px] bg-white shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">
              {isHrHead ? "Approve Leave Request" : "Review Leave Request"}
            </h2>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {isHrHead
                ? "Approve the request details and uploaded attachment information."
                : "Review the request details and uploaded attachment information."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-74px)] overflow-y-auto p-5 sm:p-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <DetailCard icon={UserRound} label="Employee Name" value={request.employeeName} />
            <DetailCard icon={FileText} label="Leave Type" value={request.leaveType} />
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="m-0 text-sm font-semibold text-slate-700">Status</p>
              <LeaveStatusBadge status={request.status} roleKey={roleKey} className="mt-2" />
            </div>
            <DetailCard icon={CalendarDays} label="Date Filed" value={formatDateDisplay(request.dateFiled)} />
            <DetailCard icon={CalendarDays} label="Inclusive Dates" value={inclusiveDates} />
            <DetailCard icon={CalendarDays} label="Leave Duration" value={formatDurationLabel(request.numberOfDays)} />
            <DetailCard icon={FileText} label="Division" value={request.division} />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="m-0 text-sm font-semibold text-slate-700">Supporting Details</p>
                <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-900">
                  {displayReason || "No additional supporting details were provided."}
                </p>
              </div>

              {rejectedNote ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <p className="m-0 text-sm font-semibold text-rose-800">Rejected Note</p>
                  <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-rose-950">
                    {rejectedNote}
                  </p>
                </div>
              ) : null}

              {detailRows.length > 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="m-0 text-sm font-semibold text-slate-700">Leave Type Selections</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {detailRows.map((row) => (
                      <div key={`${row.label}-${row.value}`} className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</p>
                        <p className="m-0 mt-1 text-sm font-medium text-slate-900">{row.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <AttachmentPreview
                attachmentName={request.attachmentName}
                attachmentPath={request.attachmentPath}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
