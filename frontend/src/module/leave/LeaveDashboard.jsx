import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Clock3, FilePenLine, Filter, Plane, Plus, Search, UserRound } from "lucide-react";
import { faBan, faBoxArchive, faCheck, faFileArrowDown, faFileLines, faPrint, faRotateLeft, faWallet, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import BulkSelectionToolbar from "../../components/UI/BulkSelectionToolbar";
import NotificationBadge from "../../components/UI/NotificationBadge";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import SelectionCheckbox from "../../components/UI/SelectionCheckbox";
import ViewFormActions from "../../components/UI/ViewFormActions";
import LeaveCards from "../../components/leave/LeaveCards";
import LeaveBalanceModal, { LeaveBalanceButton } from "../../components/leave/LeaveBalanceModal";
import { LeaveCreditSnapshotModal } from "../../components/leave/LeaveCreditSnapshot";
import LeaveFilters from "../../components/leave/LeaveFilters";
import LeaveFormModal from "../../components/leave/LeaveForm";
import LeaveReviewModal from "../../components/leave/LeaveReviewModal";
import LeaveRequestModal from "../../components/leave/LeaveRequestModal";
import LeaveStatusBadge, { getLeaveStatusDisplayLabel } from "../../components/leave/LeaveStatusBadge";
import LeaveTable from "../../components/leave/LeaveTable";
import LeaveMonetizationFormModal from "../../components/payroll/LeaveMonetizationForm";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { LEAVE_TYPES } from "../../data/leaveTypes";
import PassSlipWorkspace from "../passslip/PassSlipWorkspace";
import TravelOrderWorkspace from "../travel/TravelOrderWorkspace";
import CompensatoryWorkspace from "../compensatory/CompensatoryWorkspace";
import OvertimeWorkspace from "../overtime/Overtime";
import {
  fetchLeaveCredits,
  fetchLeaveRequests,
  fileLeaveRequest,
  updateLeaveStatus,
} from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { fetchPassSlips } from "../../services/passSlipService";
import { fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import {
  fetchLeaveMonetizationRequests,
  fileLeaveMonetizationRequest,
  updateLeaveMonetizationStatus,
} from "../../services/leaveMonetizationService";
import {
  canCancelOwnLeaveRequest,
  canRejectLeaveForUser,
  canManageLeaveRequests,
  canManageLeaveRequestRow,
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  isCurrentDateWithin,
  isLeaveDivisionDesk,
  isLeaveStartDateTooSoon,
  isRegionalDirectorApproved,
  LEAVE_ADVANCE_NOTICE_ERROR,
  matchesLeaveManagementStatus,
  matchesUserRecordScope,
  normalizeLeaveStatus,
  resolveLeaveApprovalActionForUser,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";
import { getRoleBadgeClass, getRoleLabel } from "../../utils/roleRoutes";
import { formatRecordDivision } from "../../utils/divisionDisplay";
import {
  formatMonetizationDays,
  resolveMonetizationRowActions,
  toLeaveMonetizationRow,
  toLeaveRequestRow,
} from "../../utils/leaveMonetization";
import {
  confirmLeaveWithoutPay,
  extractLeaveWithoutPayPrompt,
} from "../../utils/leaveWithoutPay";
import { showDuplicateLeaveDateAlert } from "../../utils/duplicateLeaveDate";
import { requestApprovalCaptcha, isCaptchaFailure } from "../../utils/approvalCaptcha";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmArchiveRecords,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import { confirmBulkApproval } from "../../utils/bulkRequestActions";
import useRowSelection from "../../hooks/useRowSelection";
import { useOrganizationFilterOptions } from "../../hooks/useFilterOptions";

const defaultFilterState = {
  search: "",
  division: "",
  status: "",
  date: "",
  rowsPerPage: "10",
  sortBy: "dateFiled",
  sortDirection: "desc",
};

const requestTabs = [
  { key: "leave", label: "Leave Request", icon: FilePenLine },
  { key: "travel", label: "Travel Order", icon: Plane },
  { key: "passSlip", label: "Pass Slips", icon: ClipboardList },
  { key: "cto", label: "Compensatory Time Off", icon: Clock3 },
  { key: "overtime", label: "Overtime", icon: Clock3 },
];

const initialModulePendingCounts = {
  travel: 0,
  passSlip: 0,
  cto: 0,
  overtime: 0,
};

const LEAVE_FILTER_STATUSES = [
  "Pending Leave Balance Verification",
  "Pending HR Head Approval",
  "Pending Chief Admin Review",
  "Pending Regional Director Approval",
  "Approved",
  "Disapproved",
  "Cancelled",
];
const MY_LEAVE_VIEW_ROLES = new Set([
  "hrhead",
  "hrstaff",
  "regionaldirector",
  "chief",
  "planningofficer",
  "cashier",
]);

/*
 * The approval desks see who filed each request by role, since a Chief's, Cashier's or Planning
 * Officer's filing enters the chain at a different stage from an Employee's. Their own "My Leave"
 * list is all one person, so the column is left off there.
 */
const ROLE_COLUMN_VIEWER_ROLES = new Set(["hrhead", "chief", "regionaldirector"]);

function LeaveRoleBadge({ role }) {
  const label = String(role || "").trim();

  if (!label) {
    return <span className="text-xs font-medium text-slate-400">Unassigned</span>;
  }

  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getRoleBadgeClass(label)}`}>
      {getRoleLabel(label)}
    </span>
  );
}

const leaveRowKey = (request) => request?.rowKey || `${request?.isLeaveMonetization ? "monetization" : "leave"}:${request?.id}`;

function sortRequests(list, sortBy, sortDirection) {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...list].sort((a, b) => {
    const aValue = a?.[sortBy];
    const bValue = b?.[sortBy];

    if (sortBy === "dateFiled" || sortBy === "startDate" || sortBy === "endDate") {
      const aDate = new Date(aValue || 0).getTime();
      const bDate = new Date(bValue || 0).getTime();
      return (aDate - bDate) * direction;
    }

    if (sortBy === "numberOfDays") {
      return ((Number(aValue) || 0) - (Number(bValue) || 0)) * direction;
    }

    return String(aValue || "").localeCompare(String(bValue || ""), undefined, {
      sensitivity: "base",
    }) * direction;
  });
}

function normalizeDateFilterValue(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  const isoDateMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) {
    return isoDateMatch[1];
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsedDate);
}

function LeaveRequestManagementPanel({
  filters,
  divisions = [],
  statuses = [],
  rows = [],
  loading = false,
  totalCount = 0,
  currentPage = 1,
  totalPages = 1,
  pageSize = 10,
  canManage = false,
  canCreate = true,
  roleKey = "",
  user,
  archiveView = false,
  myLeaveView = false,
  personalLeaveOnly = false,
  onToggleArchiveView,
  onToggleMyLeaveView,
  onFilterChange,
  onPageChange,
  onCreate,
  onViewBalances,
  onAction,
  selection,
  canSelectRow = () => false,
  bulkToolbar = null,
}) {
  const normalizedRoleKey = String(roleKey || "").trim().toLowerCase();
  const isHrHead = normalizedRoleKey === "hrhead";
  const isHrStaff = normalizedRoleKey === "hrstaff";
  const isChief = normalizedRoleKey === "chief";
  const showDivisionFilter = true;
  /* A Planning Officer granted approve/reject in RBAC works the Chief's division desk. */
  const isDivisionDesk = isChief || isLeaveDivisionDesk(user);
  const deskDivision = isDivisionDesk ? String(user?.division || "").trim() : "";
  const isRegionalDirector = normalizedRoleKey === "regionaldirector";
  const hasOrganizationWideView = ["hrhead", "hrstaff", "chief", "regionaldirector"].includes(normalizedRoleKey);
  const isCashierSelfService = normalizedRoleKey === "cashier" && personalLeaveOnly;
  const canViewMyLeave = MY_LEAVE_VIEW_ROLES.has(normalizedRoleKey) && !isCashierSelfService;
  const canArchive = canArchiveModule(normalizedRoleKey, "leave");
  const canArchiveMonetization = canArchiveModule(normalizedRoleKey, "leaveMonetization");
  const startIndex = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalCount);
  const selectableRows = selection ? rows.filter(canSelectRow) : [];
  const showRoleColumn = ROLE_COLUMN_VIEWER_ROLES.has(normalizedRoleKey) && !myLeaveView;
  const headers = [
    "Employee",
    ...(showRoleColumn ? ["Role"] : []),
    "Division",
    "Leave Type",
    "Status",
    "Date Filed",
    "Actions",
  ];

  /*
   * Which decisions a row offers depends on the viewer's role and where the request sits in the
   * approval chain. Decided once here, for the table and for the narrow-screen cards.
   */
  const renderRequestActions = (request) => {
    /*
     * HR Staff verify the filer's leave balance, so every row on their desk opens that employee's
     * current leave credits. Their own balances already have the header button in My Leave.
     */
    const balancesAction = isHrStaff && !myLeaveView && request.employeeRecordId ? (
      <ActionIconButton
        label={`View leave balances of ${request.employeeName || "this employee"}`}
        icon={faWallet}
        tone="view"
        text="View Leave Balances"
        onClick={() => onAction?.("balances", request)}
      />
    ) : null;

    /*
     * A monetization filing follows leave_monetization.php's own chain — HR Head review first, then
     * the Regional Director's final approval — so its row decides its own actions. Its form carries
     * a Print button of its own, and the archive is the leave archive either way.
     */
    if (request.isLeaveMonetization) {
      const monetizationActions = resolveMonetizationRowActions({
        roleKey: normalizedRoleKey,
        record: request,
        isOwnRecord: matchesUserRecordScope(request, user),
      });

      /* The sheet is only worth printing or saving once the Regional Director has signed it. */
      const showMonetizationPrintAction = isRegionalDirectorApproved(request);

      if (archiveView) {
        return (
          <ViewFormActions viewLabel="View leave monetization form" onView={() => onAction?.("view", request)}>
            {balancesAction}
            {showMonetizationPrintAction ? (
              <>
                <ActionIconButton
                  label="Print leave monetization form"
                  icon={faPrint}
                  tone="print"
                  onClick={() => onAction?.("print", request)}
                />
                <ActionIconButton
                  label="Download leave monetization form as PDF"
                  text="Download PDF"
                  icon={faFileArrowDown}
                  tone="export"
                  onClick={() => onAction?.("download", request)}
                />
              </>
            ) : null}
            {canArchiveMonetization ? (
              <ActionIconButton
                label="Restore leave monetization request"
                icon={faRotateLeft}
                tone="restore"
                onClick={() => onAction?.("restore", request)}
              />
            ) : null}
          </ViewFormActions>
        );
      }

      return (
        <ViewFormActions viewLabel="View leave monetization form" onView={() => onAction?.("view", request)}>
          {balancesAction}
          {canManage && !isHrStaff && monetizationActions.showReview ? (
            <ActionIconButton
              label="Approve leave monetization"
              icon={faCheck}
              tone="approve"
              onClick={() => onAction?.("markReviewed", request)}
            />
          ) : null}
          {canManage && !isHrStaff && monetizationActions.showApprove ? (
            <ActionIconButton
              label={isRegionalDirector ? "Final approve leave monetization" : "Approve leave monetization"}
              icon={faCheck}
              tone="approve"
              onClick={() => onAction?.("approve", request)}
            />
          ) : null}
          {canManage && !isHrStaff && monetizationActions.showReject ? (
            <ActionIconButton
              label="Reject leave monetization"
              icon={faXmark}
              tone="reject"
              onClick={() => onAction?.("reject", request)}
            />
          ) : null}
          {!isHrStaff && ((canManage && monetizationActions.showCancel) || monetizationActions.showOwnCancel) ? (
            <ActionIconButton
              label="Cancel leave monetization"
              icon={faBan}
              tone="cancel"
              onClick={() => onAction?.("cancel", request)}
            />
          ) : null}
          {showMonetizationPrintAction ? (
            <>
              <ActionIconButton
                label="Print leave monetization form"
                icon={faPrint}
                tone="print"
                onClick={() => onAction?.("print", request)}
              />
              <ActionIconButton
                label="Download leave monetization form as PDF"
                text="Download PDF"
                icon={faFileArrowDown}
                tone="export"
                onClick={() => onAction?.("download", request)}
              />
            </>
          ) : null}
          {canArchiveMonetization ? (
            <ActionIconButton
              label="Archive leave monetization request"
              icon={faBoxArchive}
              tone="archive"
              onClick={() => onAction?.("archive", request)}
            />
          ) : null}
        </ViewFormActions>
      );
    }

    const normalizedStatus = normalizeLeaveStatus(request.status);
    const showOwnCancelAction = canCancelOwnLeaveRequest(user, request);
    /* The form is only worth printing or saving once the Regional Director has signed it; then every role may. */
    const showPrintAction = isRegionalDirectorApproved(request);
    /* Chiefs use the same full action menu; the API only hands them their own division's requests. */
    const allowRowManagement = canManageLeaveRequestRow(user, request);
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

    /* In the archive there is nothing to decide — the only moves are look and put back. */
    if (archiveView) {
      return (
        <ViewFormActions viewLabel="View leave form" onView={() => onAction?.("view", request)}>
          {balancesAction}
          {showPrintAction ? (
            <>
              <ActionIconButton
                label="Print leave form"
                icon={faPrint}
                tone="print"
                onClick={() => onAction?.("print", request)}
              />
              <ActionIconButton
                label="Download leave form as PDF"
                text="Download PDF"
                icon={faFileArrowDown}
                tone="export"
                onClick={() => onAction?.("download", request)}
              />
            </>
          ) : null}
          {canArchive && !isChief ? (
            <ActionIconButton
              label="Restore leave request"
              icon={faRotateLeft}
              tone="restore"
              onClick={() => onAction?.("restore", request)}
            />
          ) : null}
        </ViewFormActions>
      );
    }

    return (
      <ViewFormActions
        viewLabel={showOwnRegionalDirectorFormOnly ? "Leave Request Form" : "View leave form"}
        onView={() => onAction?.("view", request)}
      >
        {balancesAction}
        {canManage && allowRowManagement ? (
          <ActionIconButton
            label="Review leave request"
            icon={faFileLines}
            tone="review"
            onClick={() => onAction?.("review", request)}
          />
        ) : null}
        {canManage && approvalAction ? (
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
            onClick={() => onAction?.(approvalAction.action, request)}
          />
        ) : null}
        {canManage && showRejectAction ? (
          <ActionIconButton
            label="Disapprove leave request"
            text="Disapprove"
            icon={faXmark}
            tone="reject"
            onClick={() => onAction?.("reject", request)}
          />
        ) : null}
        {(canManage && showCancelAction) || showOwnCancelAction ? (
          <ActionIconButton
            label="Cancel leave request"
            icon={faBan}
            tone="cancel"
            onClick={() => onAction?.("cancel", request)}
          />
        ) : null}
        {showPrintAction ? (
          <>
            <ActionIconButton
              label="Print leave form"
              icon={faPrint}
              tone="print"
              onClick={() => onAction?.("print", request)}
            />
            <ActionIconButton
              label="Download leave form as PDF"
              text="Download PDF"
              icon={faFileArrowDown}
              tone="export"
              onClick={() => onAction?.("download", request)}
            />
          </>
        ) : null}
        {canArchive ? (
          <ActionIconButton
            label="Archive leave request"
            icon={faBoxArchive}
            tone="archive"
            onClick={() => onAction?.("archive", request)}
          />
        ) : null}
      </ViewFormActions>
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-950">
            {archiveView
              ? "Archived Leave Requests"
              : isCashierSelfService
                ? "Leave Request"
              : myLeaveView
                ? "My Leave Requests"
                : "Leave Request Management"}
          </h3>
          <p className="m-0 mt-1 text-sm text-slate-500">
            {archiveView
              ? "Leave requests moved to archive. Restore one to put it back in the list."
              : isCashierSelfService
                ? "View and monitor the leave requests filed under your employee account."
              : myLeaveView
                ? "View and monitor the leave requests filed under your employee account."
              : isHrHead
                ? "Approve employee leave requests from all divisions and filter the organization-wide list."
                : isChief
                  ? "Review, approve, reject, and archive leave requests from employees in your division. Pending requests can also be approved in bulk."
                : hasOrganizationWideView
                  ? "View employee leave requests from all divisions and filter the organization-wide list."
                  : "Review submitted leave requests, filter by employee or status, and update request outcomes."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canViewMyLeave ? (
            <button
              type="button"
              aria-pressed={myLeaveView}
              onClick={() => onToggleMyLeaveView?.(!myLeaveView)}
              className={`inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
                myLeaveView
                  ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <UserRound size={16} />
              {myLeaveView
                ? personalLeaveOnly
                  ? "Back to Leave Requests"
                  : "View All Leave Requests"
                : "View My Leave"}
            </button>
          ) : null}
          {canArchive ? (
            <ArchiveViewToggle
              archiveView={archiveView}
              onToggle={onToggleArchiveView}
              label="leave requests"
            />
          ) : null}
          {onViewBalances ? <LeaveBalanceButton onClick={onViewBalances} /> : null}
          {archiveView || !canCreate ? null : (
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              <Plus size={16} />
              File Leave Request
            </button>
          )}
        </div>
      </div>

      <div className={`mt-4 grid gap-3 ${showDivisionFilter
        ? "lg:grid-cols-[minmax(0,220px)_160px_160px_160px_120px]"
        : "lg:grid-cols-[minmax(0,220px)_160px_160px_120px]"
      }`}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Search Leave Requests</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={filters.search}
              onChange={(event) => onFilterChange?.("search", event.target.value)}
              placeholder="Search employee, leave type, reason"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </span>
        </label>

        {showDivisionFilter ? (
          <label>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Division</span>
            {/* A division desk only ever sees its own division (the API scopes it), so the control
                names that division and nothing else -- there is no "All divisions" to pick. */}
            <select
              value={isDivisionDesk ? "" : filters.division}
              disabled={isDivisionDesk}
              onChange={(event) => onFilterChange?.("division", event.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
            >
              {isDivisionDesk ? (
                <option value="">{deskDivision || "No assigned division"}</option>
              ) : (
                <>
                  <option value="">All divisions</option>
                  {divisions.map((division) => (
                    <option key={division} value={division}>{division}</option>
                  ))}
                </>
              )}
            </select>
          </label>
        ) : null}

        <label>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Status</span>
          <select
            value={filters.status}
            onChange={(event) => onFilterChange?.("status", event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Leave Date</span>
          <input
            type="date"
            value={filters.date}
            onChange={(event) => onFilterChange?.("date", event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Rows Per Page</span>
          <select
            value={filters.rowsPerPage}
            onChange={(event) => onFilterChange?.("rowsPerPage", event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="10">10 rows</option>
            <option value="20">20 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
            <option value="200">200 rows</option>
          </select>
        </label>
      </div>

      {bulkToolbar}

      {/* Cards below `lg`, table from `lg` up — see the note in `RecordCards`. */}
      <RecordCards
        className="mt-4 lg:hidden"
        items={rows}
        loading={loading}
        loadingCards={3}
        /* Leave requests and monetization filings number their records apart, so ids can collide. */
        itemKey={(row, index) => row?.rowKey || row?.id || index}
        empty={{
          icon: Filter,
          title: "No leave requests found",
          description: "Submit a leave request or adjust the filters.",
        }}
        renderCard={(request) => ({
          title: request.employeeName || "Unknown employee",
          subtitle: request.leaveType || "Leave",
          badge: (
            <LeaveStatusBadge
              status={request.status}
              rejectedByRole={request.rejectedByRole}
              isLeaveMonetization={request.isLeaveMonetization}
              startDate={request.startDate}
              endDate={request.endDate}
              pendingByRole
            />
          ),
          selection: selection && canSelectRow(request) ? (
            <SelectionCheckbox
              checked={selection.isSelected(request)}
              onChange={() => selection.toggleRow(request)}
              label={`Select ${request.employeeName || "leave request"}`}
            />
          ) : null,
          fields: [
            ...(showRoleColumn ? [{ label: "Role", value: <LeaveRoleBadge role={request.employeeRole} /> }] : []),
            { label: "Division", value: formatRecordDivision(request) },
            { label: "Date Filed", value: formatDateDisplay(request.dateFiled) },
          ],
          actions: renderRequestActions(request),
        })}
      />

      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                {selection ? (
                  <th className="border-b border-slate-200 px-3 py-3 text-left">
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
                {headers.map((header) => (
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
                    <td colSpan={headers.length + (selection ? 1 : 0)} className="px-3 py-3">
                      <div className="h-5 rounded bg-slate-200" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length + (selection ? 1 : 0)} className="px-4 py-12 text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                      <Filter size={20} />
                    </div>
                    <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No leave requests found</p>
                    <p className="m-0 mt-1 text-sm text-slate-500">
                      Submit a leave request or adjust the filters.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((request) => (
                  <tr key={request.rowKey || request.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                    {selection ? (
                      <td className="px-3 py-3">
                        {canSelectRow(request) ? (
                          <SelectionCheckbox
                            checked={selection.isSelected(request)}
                            onChange={() => selection.toggleRow(request)}
                            label={`Select ${request.employeeName || "leave request"}`}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-3 py-3 text-sm text-slate-800">
                      <div className="font-semibold text-slate-900">{request.employeeName || "Unknown employee"}</div>
                    </td>
                    {showRoleColumn ? (
                      <td className="px-3 py-3">
                        <LeaveRoleBadge role={request.employeeRole} />
                      </td>
                    ) : null}
                    <td className="px-3 py-3 text-sm text-slate-600">{formatRecordDivision(request)}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{request.leaveType || "Leave"}</td>
                    <td className="px-3 py-3">
                      <LeaveStatusBadge
                        status={request.status}
                        rejectedByRole={request.rejectedByRole}
                        isLeaveMonetization={request.isLeaveMonetization}
                        startDate={request.startDate}
                        endDate={request.endDate}
                        pendingByRole
                      />
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(request.dateFiled)}</td>
                    <td className="px-3 py-3">
                      {renderRequestActions(request)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-sm text-slate-500">
          Showing {startIndex} to {endIndex} of {totalCount} leave requests
        </p>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
      </div>
    </section>
  );
}

function requestMatchesCurrentUser(request, user) {
  const requestName = String(request.employeeName || "").trim().toLowerCase();
  const userNames = [user?.full_name, user?.username]
    .filter(Boolean)
    .map((name) => String(name).trim().toLowerCase());

  if (userNames.length === 0) {
    return false;
  }

  return userNames.some((name) => requestName === name || requestName.includes(name));
}

function buildSummary(requests) {
  const summary = {
    total: requests.length,
    pending: 0,
    endorsed: 0,
    reviewed: 0,
    chiefReviewed: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    onLeave: 0,
  };

  requests.forEach((request) => {
    const status = normalizeLeaveStatus(request.status);
    if (status === "Pending") summary.pending += 1;
    if (status === "Endorsed") summary.endorsed += 1;
    if (status === "Reviewed") summary.reviewed += 1;
    if (status === "Chief Reviewed") summary.chiefReviewed += 1;
    if (status === "Approved") summary.approved += 1;
    if (status === "Rejected") summary.rejected += 1;
    if (status === "Cancelled") summary.cancelled += 1;

    if (status === "Approved" && isCurrentDateWithin(request.startDate, request.endDate)) {
      summary.onLeave += 1;
    }
  });

  return summary;
}

export default function LeaveDashboard({
  user,
  employees = [],
  divisions = [],
  leaveRequestLayout = "default",
  activeView = "leave",
  showRequestTabs = true,
  showOnlyOwnLeaveRequests = false,
}) {
  const normalizedActiveView = requestTabs.some((tab) => tab.key === activeView) ? activeView : "leave";
  const [activeTab, setActiveTab] = useState(normalizedActiveView);
  const [requests, setRequests] = useState([]);
  /*
   * Monetization filings are kept by leave_monetization.php, so they arrive as their own list and
   * are folded into the leave rows for display. They stay in their own state because every write
   * still goes back to that endpoint.
   */
  const [monetizationRecords, setMonetizationRecords] = useState([]);
  const [selectedMonetization, setSelectedMonetization] = useState(null);
  const [printMonetization, setPrintMonetization] = useState(false);
  const [downloadMonetization, setDownloadMonetization] = useState(false);
  const [modulePendingCounts, setModulePendingCounts] = useState(initialModulePendingCounts);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [filters, setFilters] = useState(() => ({
    ...defaultFilterState,
    ...(showOnlyOwnLeaveRequests ? { status: "" } : {}),
  }));
  const [currentPage, setCurrentPage] = useState(1);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [balanceSnapshotRequest, setBalanceSnapshotRequest] = useState(null);
  const [printRequest, setPrintRequest] = useState(false);
  const [downloadRequest, setDownloadRequest] = useState(false);
  const [leaveArchiveView, setLeaveArchiveView] = useState(false);
  const [showMyLeaveRequests, setShowMyLeaveRequests] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  /* The signed-in user's own leave_credit.php snapshot: balances for the request form, all of it for the modal. */
  const [leaveCreditSnapshot, setLeaveCreditSnapshot] = useState(null);
  const leaveCredits = useMemo(
    () => (Array.isArray(leaveCreditSnapshot?.balances) ? leaveCreditSnapshot.balances : []),
    [leaveCreditSnapshot]
  );
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");

  const managePermission = canManageLeaveRequests(user);
  const viewAllPermission = canViewAllLeaves(user);
  const roleKey = resolveRoleKey(user);
  const isRegionalDirector = roleKey === "regionaldirector";
  /*
   * The balances button shows the signed-in user their own leave credits. The Admin account is not
   * an employee and holds none, so Leave Management does not offer it there.
   */
  const showOwnBalances = roleKey !== "admin";
  const myLeaveView = showMyLeaveRequests;
  const scopeToOwnLeaveRequests = showOnlyOwnLeaveRequests || myLeaveView;
  const updateModulePendingCount = (moduleKey, count) => {
    setModulePendingCounts((current) =>
      current[moduleKey] === count ? current : { ...current, [moduleKey]: count }
    );
  };

  useEffect(() => {
    setActiveTab(normalizedActiveView);
  }, [normalizedActiveView]);

  const loadOwnLeaveCredits = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError("");

    try {
      const result = await fetchLeaveCredits();
      setLeaveCreditSnapshot(result?.credits && typeof result.credits === "object" ? result.credits : null);
    } catch (error) {
      setLeaveCreditSnapshot(null);
      setBalanceError(
        error?.response?.data?.message
          || error?.message
          || "Your leave balances are unavailable right now."
      );
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const handleOpenBalances = () => {
    setBalanceOpen(true);
    void loadOwnLeaveCredits();
  };

  const loadRequests = useCallback(async ({ background = false } = {}) => {
    setIsLoading(!background);

    const [requestResult, monetizationResult] = await Promise.allSettled([
      fetchLeaveRequests({ archived: leaveArchiveView }),
      roleKey === "chief"
        ? Promise.resolve({ records: [] })
        : fetchLeaveMonetizationRequests({ archived: leaveArchiveView }),
    ]);

    try {
      if (requestResult.status === "fulfilled") {
        setRequests(requestResult.value.requests || []);
      } else if (!background) {
        toast.error(requestResult.reason?.message || "Unable to load leave requests.");
      }

      if (monetizationResult.status === "fulfilled") {
        setMonetizationRecords(
          Array.isArray(monetizationResult.value?.records) ? monetizationResult.value.records : []
        );
      } else if (!background) {
        toast.error(
          monetizationResult.reason?.response?.data?.message
            || "Unable to load leave monetization requests."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [leaveArchiveView, roleKey]);

  const loadModulePendingCounts = useCallback(async ({ background = false } = {}) => {
    const scopeRecords = (records = []) =>
      viewAllPermission ? records : records.filter((record) => matchesUserRecordScope(record, user));

    // Zeroing the badges first is a loading state. On a background poll it would flash every
    // pending count to 0 and back, so the old counts stay up until the new ones arrive.
    if (!background) {
      setModulePendingCounts({ ...initialModulePendingCounts });
    }

    const [travelResult, passSlipResult, compensatoryResult, overtimeResult] = await Promise.allSettled([
      fetchTravelOrders(),
      fetchPassSlips(),
      fetchCompensatoryRequests(),
      fetchOvertimeRequests(),
    ]);

    setModulePendingCounts({
      travel:
        travelResult.status === "fulfilled"
          ? countPendingRecords(scopeRecords(travelResult.value.requests || []))
          : 0,
      passSlip:
        passSlipResult.status === "fulfilled"
          ? countPendingRecords(scopeRecords(passSlipResult.value.records || []))
          : 0,
      cto:
        compensatoryResult.status === "fulfilled"
          ? countPendingRecords(scopeRecords(compensatoryResult.value.records || []))
          : 0,
      overtime:
        overtimeResult.status === "fulfilled"
          ? countPendingRecords(scopeRecords(overtimeResult.value.records || []))
          : 0,
    });
  }, [user, viewAllPermission]);

  const refreshAll = useCallback(async ({ background } = {}) => {
    await Promise.allSettled([
      loadRequests({ background }),
      loadModulePendingCounts({ background }),
    ]);
  }, [loadModulePendingCounts, loadRequests]);

  /*
   * useAutoRefreshOnChange reads its callback through a ref, so a new `refreshAll` identity does not
   * make it refetch — which is the point for a poller, but means toggling the archive view would
   * leave the old rows on screen. This effect owns the first load and every reload caused by the
   * fetch's own inputs changing; the hook below only adds other people's edits.
   */
  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useAutoRefreshOnChange(refreshAll, {
    topics: [
      "leave_request",
      "leave_monetization",
      "travel_order",
      "pass_slip",
      "compensatory",
      "overtime",
    ],
    refreshOnMount: false,
  });

  const databaseDivisions = useMemo(
    () =>
      divisions
      .map((division) => (typeof division === "string" ? division : division?.name))
      .filter(Boolean)
      .sort(),
    [divisions]
  );

  /*
   * Leave requests and monetization filings share one list: monetization is a leave type on the
   * request form, so it is a row of the same table rather than a screen of its own. The rows carry
   * a `rowKey` because the two tables number their records separately and the ids overlap.
   */
  const combinedRequests = useMemo(
    () => [
      ...requests.map(toLeaveRequestRow),
      ...monetizationRecords.map(toLeaveMonetizationRow),
    ],
    [monetizationRecords, requests]
  );

  /*
   * The division filter lists the division table, not the divisions that happen to appear on the
   * loaded requests -- every role's dashboard, whether or not it passes `divisions` in.
   */
  const { divisions: organizationDivisions } = useOrganizationFilterOptions();
  const availableDivisions = useMemo(
    () => Array.from(new Set([...databaseDivisions, ...organizationDivisions])).sort(),
    [databaseDivisions, organizationDivisions]
  );

  const scopedRequests = useMemo(() => {
    if (scopeToOwnLeaveRequests) {
      return combinedRequests.filter((request) => matchesUserRecordScope(request, user));
    }

    if (viewAllPermission) {
      /*
       * The organization-wide list is for requests the viewer acts on. Their own filing goes straight
       * to the next approver's queue and is followed (or cancelled) under View My Leave, so it never
       * appears here. The archive keeps every record, since My Leave never shows archived rows.
       */
      if (leaveArchiveView) {
        return combinedRequests;
      }
      return combinedRequests.filter((request) => !matchesUserRecordScope(request, user));
    }
    return combinedRequests.filter((request) => requestMatchesCurrentUser(request, user));
  }, [combinedRequests, leaveArchiveView, scopeToOwnLeaveRequests, user, viewAllPermission]);
  const leavePendingCount = useMemo(
    () => scopedRequests.reduce((count, request) => {
      if (matchesUserRecordScope(request, user)) return count;

      if (request.isLeaveMonetization) {
        const actions = resolveMonetizationRowActions({ roleKey, record: request, isOwnRecord: false });
        return count + (actions.showReview || actions.showApprove ? 1 : 0);
      }

      return count + (resolveLeaveApprovalActionForUser(user, request.status) ? 1 : 0);
    }, 0),
    [roleKey, scopedRequests, user]
  );

  const summary = useMemo(() => buildSummary(scopedRequests), [scopedRequests]);

  const onLeaveEmployees = useMemo(
    () =>
      scopedRequests.filter(
        (request) =>
          normalizeLeaveStatus(request.status) === "Approved"
          && isCurrentDateWithin(request.startDate, request.endDate)
      ),
    [scopedRequests]
  );

  const statusBreakdown = useMemo(() => {
    const counter = {
      Pending: 0,
      Endorsed: 0,
      Reviewed: 0,
      "Chief Reviewed": 0,
      Approved: 0,
      Rejected: 0,
      Cancelled: 0,
    };

    scopedRequests.forEach((request) => {
      const status = normalizeLeaveStatus(request.status);
      if (counter[status] !== undefined) {
        counter[status] += 1;
      }
    });

    /* A bar counts every disapproval, whoever made it, so it carries no "by <role>" suffix. */
    return Object.entries(counter).map(([label, count]) => ({
      label: label === "Rejected" ? "Disapproved" : getLeaveStatusDisplayLabel(label),
      count,
    }));
  }, [scopedRequests]);

  const divisionBreakdown = useMemo(() => {
    const counter = {};
    scopedRequests.forEach((request) => {
      const key = request.division || "Unassigned";
      counter[key] = (counter[key] || 0) + 1;
    });

    return Object.entries(counter)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [scopedRequests]);

  const filteredRequests = useMemo(() => {
    const searchValue = filters.search.trim().toLowerCase();

    const filtered = scopedRequests.filter((request) => {
      const displayReason = getLeaveReasonDisplay(request.reason, request.leaveType);
      const matchesSearch = !searchValue || [
        request.employeeName,
        request.division,
        request.leaveType,
        displayReason,
        request.rejectedNote,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchValue));

      const matchesDivision = !filters.division || request.division === filters.division;
      const matchesStatus = matchesLeaveManagementStatus(
        request.status,
        filters.status,
        roleKey,
        { isOwnRequest: matchesUserRecordScope(request, user) }
      );
      const dateFilterValue = normalizeDateFilterValue(filters.date);
      const matchesDate = !dateFilterValue || [
        request.startDate,
        request.endDate,
        request.dateFiled,
      ].some((value) => normalizeDateFilterValue(value) === dateFilterValue);

      return matchesSearch && matchesDivision && matchesStatus && matchesDate;
    });

    return sortRequests(filtered, filters.sortBy, filters.sortDirection);
  }, [filters, roleKey, scopedRequests, user]);

  const rowsPerPage = Number(filters.rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    filters.search,
    filters.division,
    filters.status,
    filters.date,
    filters.rowsPerPage,
    filters.sortBy,
    filters.sortDirection,
  ]);

  const paginatedRequests = useMemo(() => {
    const startIndex = (safePage - 1) * rowsPerPage;
    return filteredRequests.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredRequests, rowsPerPage, safePage]);
  const selection = useRowSelection(filteredRequests, leaveRowKey);
  const canArchiveLeave = canArchiveModule(roleKey, "leave");
  const getBulkApprovalAction = useCallback((request) => {
    if (!canManageLeaveRequestRow(user, request)) return null;

    if (request.isLeaveMonetization) {
      const actions = resolveMonetizationRowActions({
        roleKey,
        record: request,
        isOwnRecord: false,
      });

      if (actions.showReview) return { action: "markReviewed", status: "Reviewed" };
      if (actions.showApprove) return { action: "approve", status: "Approved" };
      return null;
    }

    return resolveLeaveApprovalActionForUser(user, request.status);
  }, [roleKey, user]);
  const canSelectLeaveRow = useCallback((request) => (
    !leaveArchiveView
      && (canArchiveLeave || Boolean(getBulkApprovalAction(request)))
  ), [canArchiveLeave, getBulkApprovalAction, leaveArchiveView]);
  const bulkApprovableRequests = selection.selectedRows.filter((request) => Boolean(getBulkApprovalAction(request)));
  const bulkArchivableRequests = canArchiveLeave && !leaveArchiveView ? selection.selectedRows : [];

  const handleFilterChange = (field, value) => {
    setFilters((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSortChange = (columnKey) => {
    setFilters((current) => {
      if (current.sortBy === columnKey) {
        return {
          ...current,
          sortDirection: current.sortDirection === "asc" ? "desc" : "asc",
        };
      }

      return {
        ...current,
        sortBy: columnKey,
        sortDirection: "asc",
      };
    });
  };

  const handleClearFilters = () => {
    setFilters({
      ...defaultFilterState,
      ...(scopeToOwnLeaveRequests ? { status: "" } : {}),
    });
    setCurrentPage(1);
  };

  const handleToggleMyLeaveView = (next) => {
    const shouldShowMyLeave = Boolean(next);

    selection.clearSelection();
    setShowMyLeaveRequests(shouldShowMyLeave);
    setLeaveArchiveView(false);
    setFilters({
      ...defaultFilterState,
      status: shouldShowMyLeave || showOnlyOwnLeaveRequests ? "" : defaultFilterState.status,
    });
    setCurrentPage(1);
  };

  const submitLeaveRequest = async (payload) => {
    try {
      const result = await fileLeaveRequest(payload);
      setRequests((current) => [result.request, ...current]);
      toast.success(result.message || "Leave request submitted successfully.");
      setIsRequestModalOpen(false);
    } catch (error) {
      if (showDuplicateLeaveDateAlert(error)) {
        return;
      }

      const leaveWithoutPayPrompt = extractLeaveWithoutPayPrompt(error);

      if (leaveWithoutPayPrompt && !payload?.acknowledgeLeaveWithoutPay) {
        if (await confirmLeaveWithoutPay(leaveWithoutPayPrompt)) {
          await submitLeaveRequest({ ...payload, acknowledgeLeaveWithoutPay: "1" });
        }

        return;
      }

      toast.error(error?.response?.data?.message || error?.message || "Unable to submit leave request.");
    }
  };

  const submitMonetizationRequest = async (payload) => {
    try {
      const result = await fileLeaveMonetizationRequest({
        employeeRecordId: payload.employeeRecordId || undefined,
        leaveTypeCode: payload.leaveTypeCode,
        numberOfDays: payload.numberOfDays,
        dateFiled: payload.dateFiled,
        reason: payload.reason,
      });

      if (result?.record) {
        setMonetizationRecords((current) => [result.record, ...current]);
      } else {
        await loadRequests({ background: true });
      }

      toast.success(result?.message || "Leave monetization request submitted.");
      setIsRequestModalOpen(false);
    } catch (error) {
      toast.error(
        error?.response?.data?.message
          || error?.message
          || "Unable to submit leave monetization request."
      );
    }
  };

  const handleSubmitRequest = async (payload) => {
    if (!payload?.isLeaveMonetization && isLeaveStartDateTooSoon({
      leaveType: payload?.leaveType,
      startDate: payload?.startDate,
    })) {
      toast.error(LEAVE_ADVANCE_NOTICE_ERROR);
      return;
    }

    setIsSubmitting(true);

    try {
      if (payload?.isLeaveMonetization) {
        await submitMonetizationRequest(payload);
        return;
      }

      await submitLeaveRequest(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  /*
   * The monetization half of the row actions. It is kept apart from the leave request handler
   * because every step of it answers to leave_monetization.php: its own approval chain, where the
   * Regional Director signs only after the HR Head's review, and its own record to archive.
   */
  const handleMonetizationAction = async (actionType, record) => {
    /*
     * One record, one form: the printable CSC sheet the monetization modal draws. The row renamed
     * `leaveType` to the filing itself, so the credit it draws from is put back for the form, which
     * reads that field to decide which certification row the days come off.
     *
     * Print opens the same sheet, which prints itself once loaded and closes again -- the leave
     * request form's print action works exactly this way. Download PDF does the same but saves it.
     */
    if (["view", "review", "print", "download"].includes(actionType)) {
      setPrintMonetization(actionType === "print");
      setDownloadMonetization(actionType === "download");
      setSelectedMonetization({
        ...record,
        leaveType: record.monetizedLeaveType || record.leaveType,
      });
      return;
    }

    if (actionType === "archive" || actionType === "restore") {
      const confirmAction = actionType === "archive" ? confirmArchiveRecord : confirmRestoreRecord;
      await confirmAction({
        module: "leaveMonetization",
        id: record.id,
        noun: "leave monetization request",
        owner: record.employeeName,
        onArchived: () => loadRequests({ background: true }),
        onRestored: () => loadRequests({ background: true }),
      });
      return;
    }

    const isOwnRecord = matchesUserRecordScope(record, user);
    const status = normalizeLeaveStatus(record.status);

    if (isOwnRecord && actionType !== "cancel") {
      toast.error("You cannot act on your own leave monetization request.");
      return;
    }

    if (actionType === "approve" && isRegionalDirector && status !== "Reviewed") {
      toast.error("Regional Director can only give final approval after HR Head review.");
      return;
    }

    if (
      (actionType === "reject" || actionType === "cancel")
      && isRegionalDirector
      && !isOwnRecord
      && status !== "Reviewed"
    ) {
      toast.error("Regional Director can only act on requests after HR Head review.");
      return;
    }

    const statusMap = {
      markReviewed: "Reviewed",
      approve: "Approved",
      reject: "Rejected",
      cancel: "Cancelled",
    };
    const nextStatus = statusMap[actionType];

    if (!nextStatus) {
      return;
    }

    const titleMap = {
      markReviewed: "Approve Leave Monetization?",
      approve: isRegionalDirector ? "Final Approve Leave Monetization?" : "Approve Leave Monetization?",
      reject: "Reject Leave Monetization?",
      cancel: "Cancel Leave Monetization?",
    };
    const confirmButtonMap = {
      markReviewed: "Yes, approve",
      approve: isRegionalDirector ? "Yes, final approve" : "Yes, approve",
      reject: "Yes, reject",
      cancel: "Yes, cancel",
    };
    const isRejectAction = actionType === "reject";

    const confirmation = await Swal.fire({
      title: titleMap[actionType],
      text: `${formatMonetizationDays(record.numberOfDays)} day(s) of ${record.monetizedLeaveType || "leave"} credits for ${record.employeeName || "the employee"}.`,
      icon: actionType === "reject" || actionType === "cancel" ? "warning" : "success",
      input: isRejectAction ? "textarea" : undefined,
      inputLabel: isRejectAction ? "Rejected note" : undefined,
      inputPlaceholder: isRejectAction ? "Explain why this monetization is being rejected." : undefined,
      inputValidator: isRejectAction
        ? (value) => (!String(value || "").trim() ? "Rejected note is required." : undefined)
        : undefined,
      showCancelButton: true,
      confirmButtonText: confirmButtonMap[actionType],
      cancelButtonText: "No, keep it",
      confirmButtonColor: actionType === "reject" || actionType === "cancel" ? "#dc2626" : "#0f766e",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const rejectedNote = isRejectAction ? String(confirmation.value || "").trim() : "";

    /*
     * The two one-way steps leave_monetization.php gates. What comes back is the pair to send with
     * the update, not a verdict -- the answer is judged there and never here. A null is a cancel or
     * an undealt challenge, and either way nothing is sent.
     */
    let captcha = {};

    if (actionType === "markReviewed" || actionType === "approve") {
      captcha = await requestApprovalCaptcha({
        note: "Answer the sum below to confirm this leave monetization approval.",
      });

      if (!captcha) {
        return;
      }
    }

    const toastId = toast.loading("Updating leave monetization request...");

    try {
      const result = await updateLeaveMonetizationStatus(record.id, nextStatus, rejectedNote, captcha);

      setMonetizationRecords((current) =>
        current.map((item) => (String(item.id) === String(result.record?.id) ? result.record : item))
      );

      toast.success(result?.message || `Leave monetization request ${nextStatus.toLowerCase()}.`, {
        id: toastId,
      });
    } catch (error) {
      toast.error(
        error?.response?.data?.message || "Unable to update the leave monetization request.",
        { id: toastId }
      );
    }
  };

  const handleTableAction = async (actionType, request) => {
    /* The filer's leave credits, for either kind of row: both carry the employee's record id. */
    if (actionType === "balances") {
      setBalanceSnapshotRequest(request);
      return;
    }

    if (request?.isLeaveMonetization) {
      await handleMonetizationAction(actionType, request);
      return;
    }

    if (actionType === "review") {
      setReviewRequest(request);
      return;
    }

    if (actionType === "view") {
      setPrintRequest(false);
      setDownloadRequest(false);
      setSelectedRequest(request);
      return;
    }

    /* The form modal is the print source: it opens, prints itself once loaded, and closes again. */
    if (actionType === "print") {
      setDownloadRequest(false);
      setPrintRequest(true);
      setSelectedRequest(request);
      return;
    }

    /* Download works like Print: the form opens, saves itself as a PDF once loaded, and closes. */
    if (actionType === "download") {
      setPrintRequest(false);
      setDownloadRequest(true);
      setSelectedRequest(request);
      return;
    }

    if (actionType === "archive" || actionType === "restore") {
      // Archiving is a records-management action, not a decision on the request, so it is not
      // subject to the "cannot act on your own request" rule the status changes below enforce.
      const confirmAction = actionType === "archive" ? confirmArchiveRecord : confirmRestoreRecord;
      await confirmAction({
        module: "leave",
        id: request.id,
        noun: "leave request",
        owner: request.employeeName,
        onArchived: () => loadRequests({ background: true }),
        onRestored: () => loadRequests({ background: true }),
      });
      return;
    }

    const isOwnRequest = matchesUserRecordScope(request, user);
    if (isOwnRequest && actionType !== "cancel") {
      toast.error("You cannot update your own leave request. Please ask another authorized user to review it.");
      return;
    }

    const labelMap = {
      markEndorsed: "approve",
      markReviewed: "approve",
      markChiefReviewed: "complete the Chief Admin review for",
      approve: isRegionalDirector ? "final approve" : "approve",
      reject: "disapprove",
      cancel: "cancel",
    };

    if (!labelMap[actionType]) {
      return;
    }

    const status = normalizeLeaveStatus(request.status);
    if (isOwnRequest && actionType === "cancel" && !canCancelOwnLeaveRequest(user, request)) {
      toast.error("This leave request can no longer be cancelled.");
      return;
    }

    if (actionType === "cancel" && status === "Approved") {
      toast.error("Approved leave requests cannot be cancelled.");
      return;
    }

    const assignedApproval = resolveLeaveApprovalActionForUser(user, status);
    if (["markEndorsed", "markReviewed", "markChiefReviewed", "approve"].includes(actionType)
      && assignedApproval?.action !== actionType) {
      toast.error("This leave request is waiting at a different approval stage.");
      return;
    }

    if (actionType === "reject" && !canRejectLeaveForUser(user, status)) {
      toast.error("This leave request is waiting at a different approval stage.");
      return;
    }

    const statusMap = {
      markEndorsed: "Endorsed",
      markReviewed: "Reviewed",
      markChiefReviewed: "Chief Reviewed",
      approve: "Approved",
      reject: "Rejected",
      cancel: "Cancelled",
    };

    const titleMap = {
      markEndorsed: "Approve Leave Request?",
      markReviewed: "Approve Leave Request?",
      markChiefReviewed: "Complete Chief Admin Review?",
      approve: isRegionalDirector ? "Final Approve Leave Request?" : "Approve Leave Request?",
      reject: "Disapprove Leave Request?",
      cancel: "Cancel Leave Request?",
    };

    const confirmButtonMap = {
      markEndorsed: "Yes, approve",
      markReviewed: "Yes, approve",
      markChiefReviewed: "Yes, complete review",
      approve: isRegionalDirector ? "Yes, final approve" : "Yes, approve",
      reject: "Yes, disapprove",
      cancel: "Yes, cancel",
    };

    const iconMap = {
      markEndorsed: "success",
      markReviewed: "success",
      markChiefReviewed: "success",
      approve: "success",
      reject: "warning",
      cancel: "warning",
    };

    const nextStatus = statusMap[actionType];
    if (!nextStatus) {
      return;
    }

    const isRejectAction = actionType === "reject";
    const confirmation = await Swal.fire({
      title: titleMap[actionType],
      text: `Are you sure you want to ${labelMap[actionType]} the leave request for ${request.employeeName}? ${request.leaveType}`,
      icon: iconMap[actionType],
      input: isRejectAction ? "textarea" : undefined,
      inputLabel: isRejectAction ? "Disapproval note" : undefined,
      inputPlaceholder: isRejectAction ? "Explain why this leave request is being disapproved." : undefined,
      inputValue: isRejectAction ? String(request.rejectedNote || "") : undefined,
      inputAttributes: isRejectAction
        ? {
          "aria-label": "Disapproval note",
          autocapitalize: "sentences",
        }
        : undefined,
      inputValidator: isRejectAction
        ? (value) => (!String(value || "").trim() ? "Disapproval note is required." : undefined)
        : undefined,
      showCancelButton: true,
      confirmButtonText: confirmButtonMap[actionType],
      cancelButtonText: "No, keep it",
      confirmButtonColor: actionType === "approve"
        ? "#0f766e"
        : ["markReviewed", "markEndorsed", "markChiefReviewed"].includes(actionType)
          ? "#0f766e"
          : "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const rejectedNote = isRejectAction ? String(confirmation.value || "").trim() : "";
    const requiresApprovalCaptcha = ["markEndorsed", "markReviewed", "markChiefReviewed", "approve"].includes(actionType);

    let approvalCaptcha = {};

    if (requiresApprovalCaptcha) {
      approvalCaptcha = await requestApprovalCaptcha({
        note: "Answer the sum below to confirm this leave approval.",
      });

      if (!approvalCaptcha) {
        return;
      }
    }

    try {
      Swal.fire({
        title: "Updating...",
        text: "Please wait while the leave request is updated.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await updateLeaveStatus(request.id, nextStatus, rejectedNote, approvalCaptcha);
      setRequests((current) =>
        current.map((request) => (request.id === result.request.id ? result.request : request))
      );
      await Swal.fire({
        title: result.emailNotification === "warning" ? "Updated with warning" : "Updated",
        text: result.message || `Leave request ${nextStatus.toLowerCase()}.`,
        icon: result.emailNotification === "warning" ? "warning" : "success",
        confirmButtonColor: result.emailNotification === "warning" ? "#d97706" : "#0f766e",
      });
    } catch (error) {
      /*
       * A refused security check is not a failed update. The request was not touched, nothing
       * half-happened, and what the approver has to do is answer a fresh sum -- so it is not
       * dressed up as the record having gone wrong.
       */
      await Swal.fire({
        title: isCaptchaFailure(error) ? "Security Check Failed" : "Update failed",
        text: error?.response?.data?.message || error?.message || "Unable to update leave status.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  const handleBulkApprove = async () => {
    if (bulkApprovableRequests.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    try {
      await confirmBulkApproval({
        records: bulkApprovableRequests,
        noun: "leave request",
        getTarget: (request) => `${request.isLeaveMonetization ? "leavemonetization" : "leave"}:${request.id}`,
        approveRecord: (request, captcha) => {
          const approvalAction = getBulkApprovalAction(request);

          return request.isLeaveMonetization
            ? updateLeaveMonetizationStatus(request.id, approvalAction.status, "", captcha)
            : updateLeaveStatus(request.id, approvalAction.status, "", captcha);
        },
        confirmationText: `Approve ${bulkApprovableRequests.length} selected leave request${bulkApprovableRequests.length === 1 ? "" : "s"} at the workflow stage currently assigned to you?`,
        captchaNote: "Answer the sum below to confirm the selected leave approvals.",
        progressText: "Approving selected leave requests...",
        onComplete: async () => {
          selection.clearSelection();
          await loadRequests({ background: true });
        },
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkArchive = async () => {
    if (bulkArchivableRequests.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    try {
      await confirmArchiveRecords({
        records: bulkArchivableRequests,
        getModule: (request) => request.isLeaveMonetization ? "leaveMonetization" : "leave",
        noun: "leave request",
        onArchived: async () => {
          selection.clearSelection();
          await loadRequests({ background: true });
        },
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkToolbar = !leaveArchiveView ? (
    <BulkSelectionToolbar
      selectedCount={selection.selectedCount}
      approveCount={bulkApprovableRequests.length}
      archiveCount={bulkArchivableRequests.length}
      busy={bulkBusy}
      onApprove={handleBulkApprove}
      onArchive={handleBulkArchive}
      onClear={selection.clearSelection}
    />
  ) : null;

  return (
    <section className="leave-management-workspace w-full space-y-5">

      {showRequestTabs ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-slate-100 p-3">
            <div className="flex flex-wrap justify-center gap-2">
              {requestTabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                const pendingCount = tab.key === "leave" ? leavePendingCount : modulePendingCounts[tab.key] || 0;
                const showPendingBadge = tab.key !== "passSlip";
                const displayPendingCount = showPendingBadge ? pendingCount : 0;

                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    aria-label={displayPendingCount > 0 ? `${tab.label}, ${displayPendingCount} pending` : tab.label}
                    className={`group relative inline-flex min-h-11 items-center gap-2 overflow-hidden rounded-xl px-4 ${showPendingBadge ? "pr-10" : "pr-4"} text-sm font-semibold transition-all duration-300 ease-out active:scale-[0.98] ${
                      active
                        ? "bg-white text-teal-800 shadow-sm shadow-teal-100/80 -translate-y-0.5"
                        : "text-slate-600 hover:bg-white/70 hover:text-slate-900 hover:-translate-y-0.5"
                    }`}
                  >
                    {showPendingBadge ? <NotificationBadge count={displayPendingCount} /> : null}
                    <span
                      className={`absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-teal-500 transition-all duration-300 ease-out ${
                        active ? "scale-100 opacity-100" : "scale-0 opacity-0"
                      }`}
                    />
                    <Icon
                      size={17}
                      className={`relative z-10 transition-transform duration-300 ease-out ${
                        active ? "scale-110" : "group-hover:scale-105"
                      }`}
                    />
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "leave" && leaveRequestLayout === "management" ? (
        <>
          <LeaveRequestManagementPanel
            filters={filters}
            divisions={availableDivisions}
            statuses={LEAVE_FILTER_STATUSES}
            rows={paginatedRequests}
            loading={isLoading}
            totalCount={filteredRequests.length}
            currentPage={safePage}
            totalPages={totalPages}
            pageSize={rowsPerPage}
            canManage={managePermission}
            canCreate
            roleKey={roleKey}
            user={user}
            onFilterChange={handleFilterChange}
            onPageChange={(page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)))}
            onCreate={() => setIsRequestModalOpen(true)}
            onViewBalances={showOwnBalances ? handleOpenBalances : undefined}
            onAction={handleTableAction}
            selection={leaveArchiveView ? null : selection}
            canSelectRow={canSelectLeaveRow}
            bulkToolbar={bulkToolbar}
            archiveView={leaveArchiveView}
            myLeaveView={myLeaveView}
            personalLeaveOnly={showOnlyOwnLeaveRequests}
            onToggleMyLeaveView={handleToggleMyLeaveView}
            onToggleArchiveView={(next) => {
              selection.clearSelection();
              setLeaveArchiveView(next);
              setFilters((current) => ({
                ...current,
                status: next || myLeaveView || showOnlyOwnLeaveRequests ? "" : defaultFilterState.status,
              }));
              setCurrentPage(1);
            }}
          />
        </>
      ) : activeTab === "leave" ? (
        <>
          <LeaveCards
            summary={{
              total: summary.total,
              pending: summary.pending,
              endorsed: summary.endorsed,
              reviewed: summary.reviewed,
              chiefReviewed: summary.chiefReviewed,
              approved: summary.approved,
              rejected: summary.rejected,
              onLeave: summary.onLeave,
            }}
            onLeaveEmployees={onLeaveEmployees}
            statusBreakdown={statusBreakdown}
            divisionBreakdown={divisionBreakdown}
            loading={isLoading}
            roleKey={roleKey}
          />

          <LeaveFilters
            values={filters}
            divisions={availableDivisions}
            statuses={LEAVE_FILTER_STATUSES}
            onChange={handleFilterChange}
            onClear={handleClearFilters}
          />

          <div className="flex flex-wrap justify-end gap-2">
            {showOwnBalances ? <LeaveBalanceButton onClick={handleOpenBalances} /> : null}
            <button
              type="button"
              onClick={() => setIsRequestModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              <Plus size={16} />
              File Leave Request
            </button>
          </div>

          {bulkToolbar}

          <LeaveTable
            rows={paginatedRequests}
            loading={isLoading}
            canManage={managePermission}
            roleKey={roleKey}
            user={user}
            canManageRow={(row) => !matchesUserRecordScope(row, user)}
            sortBy={filters.sortBy}
            sortDirection={filters.sortDirection}
            onSort={handleSortChange}
            onAction={handleTableAction}
            selection={selection}
            canSelectRow={canSelectLeaveRow}
          />

          <div className="flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0">
              Showing{" "}
              <span className="font-semibold text-slate-900">
                {filteredRequests.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1}
              </span>
              {" "}to{" "}
              <span className="font-semibold text-slate-900">
                {Math.min(safePage * rowsPerPage, filteredRequests.length)}
              </span>
              {" "}of{" "}
              <span className="font-semibold text-slate-900">{filteredRequests.length}</span> requests
            </p>
            <p className="m-0 text-xs text-slate-500">Sort: {filters.sortBy} ({filters.sortDirection})</p>
          </div>

          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </>
      ) : activeTab === "travel" ? (
        <TravelOrderWorkspace
          user={user}
          employees={employees}
          title="Travel Order Management"
          description="Review submitted travel orders, filter by employee or status, and update request outcomes."
          submitLabel="Request Travel Order"
          showHeaderCloseButton={false}
          onPendingCountChange={(count) => updateModulePendingCount("travel", count)}
        />
      ) : activeTab === "passSlip" ? (
        <PassSlipWorkspace
          user={user}
          employees={employees}
          title="Pass Slip Management"
          description="Create and review pass slips."
          submitLabel="File Pass Slip"
          showDeleteAction={false}
          showHeaderCloseButton={false}
          onPendingCountChange={(count) => updateModulePendingCount("passSlip", count)}
        />
      ) : activeTab === "cto" ? (
        <CompensatoryWorkspace
          user={user}
          employees={employees}
          title="CTO Management"
          description="Create, review, approve, reject, cancel, and monitor employee compensatory time off requests."
          submitLabel="File CTO"
          showHeaderCloseButton={false}
          onPendingCountChange={(count) => updateModulePendingCount("cto", count)}
        />
      ) : activeTab === "overtime" ? (
        <OvertimeWorkspace
          user={user}
          employees={employees}
          title="Overtime Management"
          description="File, review, and monitor employee overtime requests."
          submitLabel="File Overtime Request"
          onPendingCountChange={(count) => updateModulePendingCount("overtime", count)}
        />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
            {(() => {
              const ActiveIcon = requestTabs.find((tab) => tab.key === activeTab)?.icon || FilePenLine;
              return <ActiveIcon size={22} />;
            })()}
          </div>
          <h3 className="m-0 mt-4 text-base font-semibold text-slate-950">
            {requestTabs.find((tab) => tab.key === activeTab)?.label}
          </h3>
          <p className="m-0 mt-1 text-sm text-slate-500">No records found.</p>
        </section>
      )}

      <LeaveRequestModal
        open={isRequestModalOpen}
        user={user}
        leaveTypes={LEAVE_TYPES}
        leaveCredits={leaveCredits}
        employees={employees}
        isSubmitting={isSubmitting}
        onClose={() => setIsRequestModalOpen(false)}
        onSubmit={handleSubmitRequest}
      />

      <LeaveBalanceModal
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        credits={leaveCreditSnapshot}
        loading={balanceLoading}
        error={balanceError}
        onRetry={loadOwnLeaveCredits}
      />

      <LeaveCreditSnapshotModal
        open={Boolean(balanceSnapshotRequest)}
        employeeRecordId={balanceSnapshotRequest?.employeeRecordId}
        employeeName={balanceSnapshotRequest?.employeeName}
        onClose={() => setBalanceSnapshotRequest(null)}
      />

      <LeaveFormModal
        open={Boolean(selectedRequest)}
        request={selectedRequest}
        employees={employees}
        reviewer={user}
        showRegionalDirectorApproverSignature={roleKey === "regionaldirector"}
        autoPrint={printRequest}
        autoDownload={downloadRequest}
        onClose={() => {
          setSelectedRequest(null);
          setPrintRequest(false);
          setDownloadRequest(false);
        }}
      />

      <LeaveReviewModal
        open={Boolean(reviewRequest)}
        request={reviewRequest}
        roleKey={roleKey}
        onClose={() => setReviewRequest(null)}
      />

      {/* The monetization row's copy of the same CSC Form No. 6 the leave requests print. */}
      <LeaveMonetizationFormModal
        open={Boolean(selectedMonetization)}
        record={selectedMonetization}
        reviewer={user}
        showHrmoReviewerSignature={roleKey === "hrhead"}
        showRegionalDirectorApproverSignature={isRegionalDirector}
        autoPrint={printMonetization}
        autoDownload={downloadMonetization}
        onClose={() => {
          setSelectedMonetization(null);
          setPrintMonetization(false);
          setDownloadMonetization(false);
        }}
      />

    </section>
  );
}
