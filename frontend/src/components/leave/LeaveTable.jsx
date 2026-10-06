import React from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { faBan, faCheck, faEye, faFileArrowDown, faFileLines, faPrint, faXmark } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../UI/ActionIconButton";
import ActionsMenu from "../UI/ActionsMenu";
import RecordCards from "../UI/RecordCards";
import SelectionCheckbox from "../UI/SelectionCheckbox";
import LeaveStatusBadge from "./LeaveStatusBadge";
import {
  canRejectLeaveForUser,
  formatDateDisplay,
  formatDurationLabel,
  isLeaveDivisionDesk,
  isRegionalDirectorApproved,
  normalizeLeaveStatus,
  resolveLeaveApprovalActionForUser,
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

function SkeletonRow({ columnCount = 8 }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: columnCount }).map((_, index) => (
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
  user = null,
  canManageRow,
  sortBy = "dateFiled",
  sortDirection = "desc",
  onSort,
  onAction,
  selection,
  canSelectRow = () => false,
}) {
  const normalizedRoleKey = String(roleKey || "").trim().toLowerCase();
  const isHrHead = normalizedRoleKey === "hrhead";
  const isHrStaff = normalizedRoleKey === "hrstaff";
  const isChief = normalizedRoleKey === "chief";
  /* A Planning Officer granted approve/reject in RBAC works the Chief's division desk. */
  const isDivisionDesk = isChief || isLeaveDivisionDesk(user);
  const isRegionalDirector = normalizedRoleKey === "regionaldirector";
  const selectableRows = selection ? rows.filter(canSelectRow) : [];
  const showSelection = Boolean(selection);

  /*
   * Which decisions a row offers depends on the viewer's role and where the request sits in the
   * Chief, HR, then Regional Director chain. Decided once here, for the table and for the cards.
   */
  const renderRowActions = (row) => {
    const allowRowManagement = typeof canManageRow === "function" ? canManageRow(row) : true;

    /*
     * Monetization filings sit in this list as a leave type of their own, but they answer to
     * leave_monetization.php: the HR Head reviews first and only then may the Regional Director
     * give the final approval. Once the Regional Director has signed, any viewer may print it or
     * download it as a PDF.
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
          {isRegionalDirectorApproved(row) ? (
            <>
              <ActionIconButton
                label="Print leave monetization form"
                icon={faPrint}
                tone="print"
                onClick={() => onAction?.("print", row)}
              />
              <ActionIconButton
                label="Download leave monetization form as PDF"
                text="Download PDF"
                icon={faFileArrowDown}
                tone="export"
                onClick={() => onAction?.("download", row)}
              />
            </>
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
    const approvalAction = allowRowManagement
      ? resolveLeaveApprovalActionForUser(user, normalizedStatus)
      : null;
    const showRejectAction = allowRowManagement
      && canRejectLeaveForUser(user, normalizedStatus);
    /* Cancellation is an applicant/Admin action, not an approval-chain decision. */
    const showCancelAction = showRejectAction
      && !isDivisionDesk
      && !isHrHead
      && !isHrStaff
      && !isRegionalDirector;

    return (
      <>
        {canManage && allowRowManagement ? (
          <>
            <ActionIconButton
              label="Review leave request"
              icon={faFileLines}
              tone="review"
              onClick={() => onAction?.("review", row)}
            />
            {approvalAction ? (
              <ActionIconButton
                label={normalizedStatus === "Chief Reviewed"
                  ? "Final approve leave request"
                  : normalizedStatus === "Pending"
                      ? "Verify leave balance"
                      : normalizedStatus === "Reviewed"
                        ? "Complete Chief Admin review"
                        : "Approve leave request"}
                icon={faCheck}
                tone="approve"
                onClick={() => onAction?.(approvalAction.action, row)}
              />
            ) : null}
            {showRejectAction ? (
              <ActionIconButton
                label="Disapprove leave request"
                text="Disapprove"
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
        {/* The form is only worth printing or saving once the Regional Director has signed it; then every role may. */}
        {isRegionalDirectorApproved(row) ? (
          <>
            <ActionIconButton
              label="Print leave form"
              icon={faPrint}
              tone="print"
              onClick={() => onAction?.("print", row)}
            />
            <ActionIconButton
              label="Download leave form as PDF"
              text="Download PDF"
              icon={faFileArrowDown}
              tone="export"
              onClick={() => onAction?.("download", row)}
            />
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
        renderCard={(row) => ({
          title: row.employeeName,
          subtitle: row.leaveType,
          badge: (
            <LeaveStatusBadge
              status={row.status}
              rejectedByRole={row.rejectedByRole}
              startDate={row.startDate}
              endDate={row.endDate}
              pendingByRole
            />
          ),
          selection: showSelection && canSelectRow(row) ? (
            <SelectionCheckbox
              checked={selection.isSelected(row)}
              onChange={() => selection.toggleRow(row)}
              label={`Select ${row.employeeName || "leave request"}`}
            />
          ) : null,
          fields: [
            { label: "Division", value: row.division },
            { label: "Leave Duration", value: formatDurationLabel(row.numberOfDays) },
            { label: "Date Filed", value: formatDateDisplay(row.dateFiled) },
          ],
          actions: <ActionsMenu>{renderRowActions(row)}</ActionsMenu>,
        })}
      />

    <section className="hidden overflow-hidden rounded-2xl border border-white/40 bg-white/85 shadow-sm backdrop-blur lg:block">
      <div className="overflow-x-auto">
        <table className="min-w-[1540px] w-full border-collapse">
          <thead>
            <tr className="bg-slate-50/90">
              {showSelection ? (
                <th className="border-b border-slate-200 px-3 py-3 text-left align-middle">
                  {selectableRows.length > 0 ? (
                    <SelectionCheckbox
                      checked={selection.areAllSelected(selectableRows)}
                      indeterminate={selection.areSomeSelected(selectableRows) && !selection.areAllSelected(selectableRows)}
                      onChange={() => selection.toggleRows(selectableRows)}
                      label="Select all leave requests on this page"
                    />
                  ) : null}
                </th>
              ) : null}
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
              Array.from({ length: 5 }).map((_, index) => <SkeletonRow key={index} columnCount={showSelection ? 8 : 7} />)
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={showSelection ? 8 : 7} className="px-4 py-10 text-center">
                  <p className="m-0 text-sm font-semibold text-slate-700">No leave requests found.</p>
                  <p className="m-0 mt-1 text-sm text-slate-500">
                    Try adjusting filters or file a new leave request.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                return (
                  <tr key={row.rowKey || row.id} className="border-b border-slate-100 transition hover:bg-slate-50/70">
                    {showSelection ? (
                      <td className="px-3 py-3.5">
                        {canSelectRow(row) ? (
                          <SelectionCheckbox
                            checked={selection.isSelected(row)}
                            onChange={() => selection.toggleRow(row)}
                            label={`Select ${row.employeeName || "leave request"}`}
                          />
                        ) : null}
                      </td>
                    ) : null}
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
                      <LeaveStatusBadge
                        status={row.status}
                        rejectedByRole={row.rejectedByRole}
                        startDate={row.startDate}
                        endDate={row.endDate}
                        pendingByRole
                      />
                    </td>
                    <td className="px-3 py-3.5">
                      <ActionsMenu>{renderRowActions(row)}</ActionsMenu>
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
