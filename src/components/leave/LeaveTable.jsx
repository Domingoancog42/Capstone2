import React from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { faBan, faCheck, faEye, faFileLines, faXmark } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../UI/ActionIconButton";
import RecordCards from "../UI/RecordCards";
import LeaveStatusBadge from "./LeaveStatusBadge";
import {
  formatDateDisplay,
  formatDurationLabel,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { resolveMonetizationRowActions } from "../../utils/leaveMonetization";

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
  const isHrStaff = normalizedRoleKey === "hrstaff";
  const isRegionalDirector = normalizedRoleKey === "regionaldirector";

  /*
   * Which decisions a row offers depends on the viewer's role and where the request sits in the
   * HR Head then Regional Director chain. Decided once here, for the table and for the cards.
   */
  const renderRowActions = (row) => {
    const allowRowManagement = typeof canManageRow === "function" ? canManageRow(row) : true;

    /*
     * Monetization filings sit in this list as a leave type of their own, but they answer to
     * leave_monetization.php: the HR Head reviews first and only then may the Regional Director
     * give the final approval. Their form carries its own Print button, so the row offers none.
     */
    if (row.isLeaveMonetization) {
      const monetizationActions = resolveMonetizationRowActions({
        roleKey: normalizedRoleKey,
        record: row,
        isOwnRecord: !allowRowManagement,
      });

      return (
        <>
          {canManage && !isHrStaff && monetizationActions.showReview ? (
            <ActionIconButton
              label="Approve leave monetization"
              icon={faCheck}
              tone="approve"
              onClick={() => onAction?.("markReviewed", row)}
            />
          ) : null}
          {canManage && !isHrStaff && monetizationActions.showApprove ? (
            <ActionIconButton
              label={isRegionalDirector ? "Final approve leave monetization" : "Approve leave monetization"}
              icon={faCheck}
              tone="approve"
              onClick={() => onAction?.("approve", row)}
            />
          ) : null}
          {canManage && !isHrStaff && monetizationActions.showReject ? (
            <ActionIconButton
              label="Reject leave monetization"
              icon={faXmark}
              tone="reject"
              onClick={() => onAction?.("reject", row)}
            />
          ) : null}
          {!isHrStaff && ((canManage && monetizationActions.showCancel) || monetizationActions.showOwnCancel) ? (
            <ActionIconButton
              label="Cancel leave monetization"
              icon={faBan}
              tone="cancel"
              onClick={() => onAction?.("cancel", row)}
            />
          ) : null}
          <ActionIconButton
            label="View leave monetization form"
            icon={faEye}
            tone="view"
            onClick={() => onAction?.("view", row)}
          />
        </>
      );
    }

    const normalizedStatus = normalizeLeaveStatus(row.status);
    const showOwnRegionalDirectorFormOnly = isRegionalDirector && !allowRowManagement;
    const showReviewDecisionAction = allowRowManagement && isHrHead && normalizedStatus === "Pending";
    const showApprovalDecisionAction = allowRowManagement
      && !isHrStaff
      && (
        (isRegionalDirector && normalizedStatus === "Reviewed")
        || (!isHrHead && !isRegionalDirector && (normalizedStatus === "Pending" || normalizedStatus === "Reviewed"))
      );
    const showRejectAction = allowRowManagement && !isHrStaff && (
      (isHrHead && normalizedStatus === "Pending")
      || (isRegionalDirector && normalizedStatus === "Reviewed")
      || (!isHrHead && !isRegionalDirector && (normalizedStatus === "Pending" || normalizedStatus === "Reviewed"))
    );
    /*
     * The HR head reviews a filing and may reject it, but withdrawing one is not their call — that
     * belongs to the employee who filed it and to the desks further down the chain.
     */
    const showCancelAction = showRejectAction && !isHrHead;

    return (
      <>
        {canManage && allowRowManagement ? (
          <>
            <ActionIconButton
              label={isHrHead ? "Open leave request" : "Review leave request"}
              icon={faFileLines}
              tone="review"
              onClick={() => onAction?.("review", row)}
            />
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
            {showRejectAction ? (
              <ActionIconButton
                label="Reject leave request"
                icon={faXmark}
                tone="reject"
                onClick={() => onAction?.("reject", row)}
              />
            ) : null}
            {showCancelAction ? (
              <ActionIconButton
                label="Cancel leave request"
                icon={faBan}
                tone="cancel"
                onClick={() => onAction?.("cancel", row)}
              />
            ) : null}
          </>
        ) : null}
        <ActionIconButton
          label={showOwnRegionalDirectorFormOnly ? "Leave Request Form" : "View leave form"}
          icon={faEye}
          tone="view"
          onClick={() => onAction?.("view", row)}
        />
      </>
    );
  };

  return (
    <>
      {/*
        * Eight columns across 1540px is a sideways drag on anything narrower than a laptop, so the
        * same rows render as cards below `lg` and the table takes over from `lg` up.
        */}
      <RecordCards
        className="lg:hidden"
        items={rows}
        loading={loading}
        loadingCards={3}
        /* Leave requests and monetization filings number their records apart, so ids can collide. */
        itemKey={(row, index) => row?.rowKey || row?.id || index}
        empty={{
          title: "No leave requests found.",
          description: "Try adjusting filters or file a new leave request.",
        }}
        renderCard={(row, index) => ({
          eyebrow: `#${rowStart + index + 1}`,
          title: row.employeeName,
          subtitle: row.leaveType,
          badge: <LeaveStatusBadge status={row.status} roleKey={roleKey} />,
          fields: [
            { label: "Division", value: row.division },
            { label: "Leave Duration", value: formatDurationLabel(row.numberOfDays) },
            { label: "Date Filed", value: formatDateDisplay(row.dateFiled) },
          ],
          actions: renderRowActions(row),
        })}
      />

    <section className="hidden overflow-hidden rounded-2xl border border-white/40 bg-white/85 shadow-sm backdrop-blur lg:block">
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
                return (
                  <tr key={row.rowKey || row.id} className="border-b border-slate-100 transition hover:bg-slate-50/70">
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
                      <div className="flex flex-wrap items-center gap-1.5">{renderRowActions(row)}</div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
    </>
  );
}
