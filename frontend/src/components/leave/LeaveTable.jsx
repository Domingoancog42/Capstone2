import React from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { faBan, faCheck, faEye, faFileLines, faXmark } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../UI/ActionIconButton";
import LeaveStatusBadge from "./LeaveStatusBadge";
import {
  formatDateDisplay,
  formatDurationLabel,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";

const sortableColumns = {
  employeeName: "Employee Name",
  leaveType: "Leave Type",
  division: "Division",
  dateFiled: "Date Filed",
  numberOfDays: "Leave Duration",
  status: "Status",
};

function SortButton({ columnKey, label, sortBy, sortDirection, onSort }) {
  const isActive = sortBy === columnKey;
  const Icon = isActive && sortDirection === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 text-left text-xs font-extrabold uppercase tracking-wide ${
        isActive ? "text-slate-900" : "text-slate-600 hover:text-slate-800"
      }`}
      onClick={() => onSort?.(columnKey)}
    >
      <span>{label}</span>
      <Icon size={14} />
    </button>
  );
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 8 }).map((_, index) => (
        <td key={index} className="border-b border-slate-200 px-3 py-3">
          <div className="h-4 w-full rounded bg-slate-200" />
        </td>
      ))}
    </tr>
  );
}

export default function LeaveTable({
  rows = [],
  loading = false,
  canManage = false,
  roleKey = "",
  canManageRow,
  sortBy = "dateFiled",
  sortDirection = "desc",
  rowStart = 0,
  onSort,
  onAction,
}) {
  const normalizedRoleKey = String(roleKey || "").trim().toLowerCase();
  const isHrHead = normalizedRoleKey === "hrhead";
  const isRegionalDirector = normalizedRoleKey === "regionaldirector";

  return (
    <section className="overflow-hidden rounded-2xl border border-white/40 bg-white/85 shadow-sm backdrop-blur">
      <div className="overflow-x-auto">
        <table className="min-w-[1540px] w-full border-collapse">
          <thead>
            <tr className="bg-slate-50/90">
              <th className="border-b border-slate-200 px-3 py-3 text-left align-middle text-xs font-extrabold uppercase text-slate-700">
                #
              </th>
              {Object.entries(sortableColumns).map(([columnKey, label]) => (
                <th key={columnKey} className="border-b border-slate-200 px-3 py-3 text-left align-middle">
                  <SortButton
                    columnKey={columnKey}
                    label={label}
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={onSort}
                  />
                </th>
              ))}
              <th className="border-b border-slate-200 px-3 py-3 text-left align-middle text-xs font-extrabold uppercase text-slate-700">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => <SkeletonRow key={index} />)
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <p className="m-0 text-sm font-semibold text-slate-700">No leave requests found.</p>
                  <p className="m-0 mt-1 text-sm text-slate-500">
                    Try adjusting filters or file a new leave request.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const normalizedStatus = normalizeLeaveStatus(row.status);
                const allowRowManagement = typeof canManageRow === "function" ? canManageRow(row) : true;
                const showOwnRegionalDirectorFormOnly = isRegionalDirector && !allowRowManagement;
                const showReviewDecisionAction = allowRowManagement && isHrHead && normalizedStatus === "Pending";
                const showApprovalDecisionAction = allowRowManagement
                  && (
                    (isRegionalDirector && normalizedStatus === "Reviewed")
                    || (!isHrHead && !isRegionalDirector && (normalizedStatus === "Pending" || normalizedStatus === "Reviewed"))
                  );
                const showRejectCancelActions = allowRowManagement && (
                  (isHrHead && normalizedStatus === "Pending")
                  || (isRegionalDirector && normalizedStatus === "Reviewed")
                  || (!isHrHead && !isRegionalDirector && (normalizedStatus === "Pending" || normalizedStatus === "Reviewed"))
                );

                return (
                  <tr key={row.id} className="border-b border-slate-100 transition hover:bg-slate-50/70">
                    <td className="px-3 py-3.5 text-sm font-semibold text-slate-600">
                      {rowStart + index + 1}
                    </td>
                    <td className="px-3 py-3.5">
                      <div>
                        <p className="m-0 text-sm font-semibold text-slate-900">{row.employeeName}</p>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-sm text-slate-700">{row.leaveType}</td>
                    <td className="px-3 py-3.5 text-sm text-slate-700">{row.division}</td>
                    <td className="px-3 py-3.5 text-sm text-slate-700">{formatDateDisplay(row.dateFiled)}</td>
                    <td className="px-3 py-3.5 text-sm text-slate-700">
                      {formatDurationLabel(row.numberOfDays)}
                    </td>
                    <td className="px-3 py-3.5">
                      <LeaveStatusBadge status={row.status} roleKey={roleKey} />
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {canManage && allowRowManagement ? (
                          <>
                            <ActionIconButton
                              label={isHrHead ? "Open leave request" : "Review leave request"}
                              icon={faFileLines}
                              tone="review"
                              onClick={() => onAction?.("review", row)}
                            />
                            {showReviewDecisionAction || showApprovalDecisionAction || showRejectCancelActions ? (
                              <>
                                {showReviewDecisionAction ? (
                                  <ActionIconButton
                                    label="Approve leave request"
                                    icon={faCheck}
                                    tone="approve"
                                    onClick={() => onAction?.(isHrHead ? "markReviewed" : "approve", row)}
                                  />
                                ) : null}
                                {showApprovalDecisionAction ? (
                                  <ActionIconButton
                                    label={isRegionalDirector ? "Final approve leave request" : "Approve leave request"}
                                    icon={faCheck}
                                    tone="approve"
                                    onClick={() => onAction?.("approve", row)}
                                  />
                                ) : null}
                                {showRejectCancelActions ? (
                                  <ActionIconButton
                                    label="Reject leave request"
                                    icon={faXmark}
                                    tone="reject"
                                    onClick={() => onAction?.("reject", row)}
                                  />
                                ) : null}
                                {showRejectCancelActions ? (
                                  <ActionIconButton
                                    label="Cancel leave request"
                                    icon={faBan}
                                    tone="cancel"
                                    onClick={() => onAction?.("cancel", row)}
                                  />
                                ) : null}
                              </>
                            ) : null}
                          </>
                        ) : null}
                        <ActionIconButton
                          label={showOwnRegionalDirectorFormOnly ? "Leave Request Form" : "View leave form"}
                          icon={faEye}
                          tone="view"
                          onClick={() => onAction?.("view", row)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
