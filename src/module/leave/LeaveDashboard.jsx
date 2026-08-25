import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Clock3, FilePenLine, Filter, Plane, Plus, Search } from "lucide-react";
import { faBan, faBoxArchive, faCheck, faEye, faFileLines, faPrint, faRotateLeft, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import NotificationBadge from "../../components/UI/NotificationBadge";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import LeaveCards from "../../components/leave/LeaveCards";
import LeaveFilters from "../../components/leave/LeaveFilters";
import LeaveFormModal from "../../components/leave/LeaveForm";
import LeaveReviewModal from "../../components/leave/LeaveReviewModal";
import LeaveRequestModal from "../../components/leave/LeaveRequestModal";
import LeaveStatusBadge, { getLeaveStatusDisplayLabel } from "../../components/leave/LeaveStatusBadge";
import LeaveTable from "../../components/leave/LeaveTable";
import LeaveMonetizationFormModal from "../../components/payroll/LeaveMonetizationForm";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { LEAVE_STATUSES, LEAVE_TYPES } from "../../data/leaveTypes";
import PassSlipWorkspace from "../passslip/PassSlipWorkspace";
import TravelOrderWorkspace from "../travel/TravelOrderWorkspace";
import CompensatoryWorkspace from "../compensatory/CompensatoryWorkspace";
import OvertimeWorkspace from "../overtime/Overtime";
import {
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
  canManageLeave,
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  formatDurationLabel,
  isCurrentDateWithin,
  isRegionalDirectorApproved,
  matchesUserRecordScope,
  normalizeLeaveStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";
import {
  formatMonetizationDays,
  resolveMonetizationRowActions,
  toLeaveMonetizationRow,
  toLeaveRequestRow,
} from "../../utils/leaveMonetization";
import { currencyFormatter } from "../../utils/format";
import {
  confirmLeaveWithoutPay,
  extractLeaveWithoutPayPrompt,
} from "../../utils/leaveWithoutPay";
import { requestApprovalCaptcha, isCaptchaFailure } from "../../utils/approvalCaptcha";
import {
  canArchiveModule,
  confirmArchiveRecord,
  confirmRestoreRecord,
} from "../../utils/archiveActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";

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
  statuses = [],
  rows = [],
  loading = false,
  totalCount = 0,
  currentPage = 1,
  totalPages = 1,
  pageSize = 10,
  canManage = false,
  roleKey = "",
  user,
  archiveView = false,
  onToggleArchiveView,
  onFilterChange,
  onPageChange,
  onCreate,
  onAction,
}) {
  const normalizedRoleKey = String(roleKey || "").trim().toLowerCase();
  const isHrHead = normalizedRoleKey === "hrhead";
  const isHrStaff = normalizedRoleKey === "hrstaff";
  const isRegionalDirector = normalizedRoleKey === "regionaldirector";
  const canArchive = canArchiveModule(normalizedRoleKey, "leave");
  const startIndex = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalCount);
  /* "Leave Dates / Credits": a monetization row has days of credit there instead of a span. */
  const headers = ["#", "Employee", "Division", "Leave Type", "Reason", "Leave Dates / Credits", "Status", "Date Filed", "Actions"];

  /*
   * Which decisions a row offers depends on the viewer's role and where the request sits in the
   * approval chain. Decided once here, for the table and for the narrow-screen cards.
   */
  const renderRequestActions = (request) => {
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

      /* The sheet is only worth printing once the Regional Director has signed it. */
      const showMonetizationPrintAction = isRegionalDirectorApproved(request);

      if (archiveView) {
        return (
          <>
            <ActionIconButton
              label="View leave monetization form"
              icon={faEye}
              tone="view"
              onClick={() => onAction?.("view", request)}
            />
            {showMonetizationPrintAction ? (
              <ActionIconButton
                label="Print leave monetization form"
                icon={faPrint}
                tone="print"
                onClick={() => onAction?.("print", request)}
              />
            ) : null}
            <ActionIconButton
              label="Restore leave monetization request"
              icon={faRotateLeft}
              tone="restore"
              onClick={() => onAction?.("restore", request)}
            />
          </>
        );
      }

      return (
        <>
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
          <ActionIconButton
            label="View leave monetization form"
            icon={faEye}
            tone="view"
            onClick={() => onAction?.("view", request)}
          />
          {showMonetizationPrintAction ? (
            <ActionIconButton
              label="Print leave monetization form"
              icon={faPrint}
              tone="print"
              onClick={() => onAction?.("print", request)}
            />
          ) : null}
          {canArchive ? (
            <ActionIconButton
              label="Archive leave monetization request"
              icon={faBoxArchive}
              tone="archive"
              onClick={() => onAction?.("archive", request)}
            />
          ) : null}
        </>
      );
    }

    const normalizedStatus = normalizeLeaveStatus(request.status);
    /* The form is only worth printing once the Regional Director has signed it. */
    const showPrintAction = isRegionalDirectorApproved(request);
    const allowRowManagement = !matchesUserRecordScope(request, user);
    const showOwnRegionalDirectorFormOnly = isRegionalDirector && !allowRowManagement;
    const isOpenStatus = normalizedStatus === "Pending" || normalizedStatus === "Reviewed";
    const showReviewDecisionAction = allowRowManagement && isHrHead && normalizedStatus === "Pending";
    /*
     * The Regional Director acts on pending requests as well as reviewed ones, so a request never
     * sits blocked waiting for an HR Head review that may not come. HR Head review remains
     * available, it is just no longer a precondition.
     *
     * HR Staff sit outside that chain entirely: they open, view, print and archive filings, but the
     * approve, reject and cancel decisions belong to the HR Head and the Regional Director.
     */
    const showApprovalDecisionAction = allowRowManagement
      && !isHrStaff
      && (isRegionalDirector || !isHrHead)
      && isOpenStatus;
    const showRejectAction = allowRowManagement && !isHrStaff && (
      (isHrHead && normalizedStatus === "Pending")
      || ((isRegionalDirector || !isHrHead) && isOpenStatus)
    );
    /*
     * The HR head reviews a filing and may reject it, but withdrawing one is not their call — that
     * belongs to the employee who filed it and to the desks further down the chain.
     */
    const showCancelAction = showRejectAction && !isHrHead;

    /* In the archive there is nothing to decide — the only moves are look and put back. */
    if (archiveView) {
      return (
        <>
          <ActionIconButton
            label="View leave form"
            icon={faEye}
            tone="view"
            onClick={() => onAction?.("view", request)}
          />
          {showPrintAction ? (
            <ActionIconButton
              label="Print leave form"
              icon={faPrint}
              tone="print"
              onClick={() => onAction?.("print", request)}
            />
          ) : null}
          <ActionIconButton
            label="Restore leave request"
            icon={faRotateLeft}
            tone="restore"
            onClick={() => onAction?.("restore", request)}
          />
        </>
      );
    }

    return (
      <>
        {canManage && allowRowManagement ? (
          <ActionIconButton
            label={isHrHead ? "Open leave request" : "Review leave request"}
            icon={faFileLines}
            tone="review"
            onClick={() => onAction?.("review", request)}
          />
        ) : null}
        {canManage && showReviewDecisionAction ? (
          <ActionIconButton
            label="Approve leave request"
            icon={faCheck}
            tone="approve"
            onClick={() => onAction?.("markReviewed", request)}
          />
        ) : null}
        {canManage && showApprovalDecisionAction ? (
          <ActionIconButton
            label={isRegionalDirector ? "Final approve leave request" : "Approve leave request"}
            icon={faCheck}
            tone="approve"
            onClick={() => onAction?.("approve", request)}
          />
        ) : null}
        {canManage && showRejectAction ? (
          <ActionIconButton
            label="Reject leave request"
            icon={faXmark}
            tone="reject"
            onClick={() => onAction?.("reject", request)}
          />
        ) : null}
        {canManage && showCancelAction ? (
          <ActionIconButton
            label="Cancel leave request"
            icon={faBan}
            tone="cancel"
            onClick={() => onAction?.("cancel", request)}
          />
        ) : null}
        <ActionIconButton
          label={showOwnRegionalDirectorFormOnly ? "Leave Request Form" : "View leave form"}
          icon={faEye}
          tone="view"
          onClick={() => onAction?.("view", request)}
        />
        {showPrintAction ? (
          <ActionIconButton
            label="Print leave form"
            icon={faPrint}
            tone="print"
            onClick={() => onAction?.("print", request)}
          />
        ) : null}
        {canArchive ? (
          <ActionIconButton
            label="Archive leave request"
            icon={faBoxArchive}
            tone="archive"
            onClick={() => onAction?.("archive", request)}
          />
        ) : null}
      </>
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-950">
            {archiveView ? "Archived Leave Requests" : "Leave Request Management"}
          </h3>
          <p className="m-0 mt-1 text-sm text-slate-500">
            {archiveView
              ? "Leave requests moved to archive. Restore one to put it back in the list."
              : isHrHead
                ? "Approve submitted leave requests, filter by employee or status, and update request outcomes."
                : "Review submitted leave requests, filter by employee or status, and update request outcomes."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canArchive ? (
            <ArchiveViewToggle
              archiveView={archiveView}
              onToggle={onToggleArchiveView}
              label="leave requests"
            />
          ) : null}
          {archiveView ? null : (
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

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_160px_120px]">
        <label className="relative">
          <span className="sr-only">Search leave requests</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={filters.search}
            onChange={(event) => onFilterChange?.("search", event.target.value)}
            placeholder="Search employee, leave type, reason"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>

        <label>
          <span className="sr-only">Leave status</span>
          <select
            value={filters.status}
            onChange={(event) => onFilterChange?.("status", event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>{getLeaveStatusDisplayLabel(status, roleKey)}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">Filter by date</span>
          <input
            type="date"
            value={filters.date}
            onChange={(event) => onFilterChange?.("date", event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>

        <label>
          <span className="sr-only">Rows per page</span>
          <select
            value={filters.rowsPerPage}
            onChange={(event) => onFilterChange?.("rowsPerPage", event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="5">5 rows</option>
            <option value="10">10 rows</option>
            <option value="20">20 rows</option>
            <option value="25">25 rows</option>
          </select>
        </label>
      </div>

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
        renderCard={(request, index) => ({
          eyebrow: `#${(currentPage - 1) * pageSize + index + 1}`,
          title: request.employeeName || "Unknown employee",
          subtitle: request.leaveType || "Leave",
          badge: <LeaveStatusBadge status={request.status} roleKey={roleKey} />,
          fields: [
            { label: "Division", value: request.division || "Unassigned" },
            { label: "Date Filed", value: formatDateDisplay(request.dateFiled) },
            {
              label: request.isLeaveMonetization ? "Credits Monetized" : "Leave Dates",
              full: true,
              value: request.isLeaveMonetization
                ? `${formatMonetizationDays(request.numberOfDays)} day(s) of ${request.monetizedLeaveType || "leave"} - ${currencyFormatter.format(Number(request.estimatedAmount) || 0)}`
                : `${formatDateDisplay(request.startDate)} - ${formatDateDisplay(request.endDate)} (${formatDurationLabel(request.numberOfDays)})`,
            },
            {
              label: "Reason",
              full: true,
              value: getLeaveReasonDisplay(request.reason, request.leaveType) || "No reason provided",
            },
          ],
          actions: renderRequestActions(request),
        })}
      />

      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-[1540px] w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
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
                    <td colSpan={headers.length} className="px-3 py-3">
                      <div className="h-5 rounded bg-slate-200" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="px-4 py-12 text-center">
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
                rows.map((request, index) => {
                  const displayReason = getLeaveReasonDisplay(request.reason, request.leaveType);

                  return (
                    <tr key={request.rowKey || request.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                      <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                        {(currentPage - 1) * pageSize + index + 1}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-800">
                        <div className="font-semibold text-slate-900">{request.employeeName || "Unknown employee"}</div>
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">{request.division || "Unassigned"}</td>
                      <td className="px-3 py-3 text-sm text-slate-700">{request.leaveType || "Leave"}</td>
                      <td className="max-w-[240px] truncate px-3 py-3 text-sm text-slate-600">
                        {displayReason || "No reason provided"}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">
                        {request.isLeaveMonetization ? (
                          <>
                            {/* No span of dates to show: the filing draws days from a credit. */}
                            <div>{formatMonetizationDays(request.numberOfDays)} day(s) of {request.monetizedLeaveType || "leave"}</div>
                            <div className="text-xs text-slate-500">
                              {currencyFormatter.format(Number(request.estimatedAmount) || 0)}
                            </div>
                          </>
                        ) : (
                          <>
                            <div>{formatDateDisplay(request.startDate)} - {formatDateDisplay(request.endDate)}</div>
                            <div className="text-xs text-slate-500">{formatDurationLabel(request.numberOfDays)}</div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <LeaveStatusBadge status={request.status} roleKey={roleKey} />
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(request.dateFiled)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">{renderRequestActions(request)}</div>
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
    reviewed: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    onLeave: 0,
  };

  requests.forEach((request) => {
    const status = normalizeLeaveStatus(request.status);
    if (status === "Pending") summary.pending += 1;
    if (status === "Reviewed") summary.reviewed += 1;
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
  const [modulePendingCounts, setModulePendingCounts] = useState(initialModulePendingCounts);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilterState);
  const [currentPage, setCurrentPage] = useState(1);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [printRequest, setPrintRequest] = useState(false);
  const [leaveArchiveView, setLeaveArchiveView] = useState(false);

  const managePermission = canManageLeave(user);
  const viewAllPermission = canViewAllLeaves(user);
  const roleKey = resolveRoleKey(user);
  const isRegionalDirector = roleKey === "regionaldirector";
  const updateModulePendingCount = (moduleKey, count) => {
    setModulePendingCounts((current) =>
      current[moduleKey] === count ? current : { ...current, [moduleKey]: count }
    );
  };

  useEffect(() => {
    setActiveTab(normalizedActiveView);
  }, [normalizedActiveView]);

  const loadRequests = useCallback(async ({ background = false } = {}) => {
    setIsLoading(!background);

    const [requestResult, monetizationResult] = await Promise.allSettled([
      fetchLeaveRequests({ archived: leaveArchiveView }),
      fetchLeaveMonetizationRequests({ archived: leaveArchiveView }),
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
  }, [leaveArchiveView]);

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

  const availableDivisions = useMemo(() => {
    const fromRequests = combinedRequests.map((request) => request.division).filter(Boolean);
    return Array.from(new Set([...databaseDivisions, ...fromRequests])).sort();
  }, [combinedRequests, databaseDivisions]);

  const scopedRequests = useMemo(() => {
    if (viewAllPermission) {
      return combinedRequests;
    }
    return combinedRequests.filter((request) => requestMatchesCurrentUser(request, user));
  }, [combinedRequests, user, viewAllPermission]);
  const leavePendingCount = useMemo(() => countPendingRecords(scopedRequests), [scopedRequests]);

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
      Reviewed: 0,
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

    return Object.entries(counter).map(([label, count]) => ({
      label: getLeaveStatusDisplayLabel(label, roleKey),
      count,
    }));
  }, [roleKey, scopedRequests]);

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
        request.leaveType,
        displayReason,
        request.rejectedNote,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchValue));

      const matchesDivision = !filters.division || request.division === filters.division;
      const matchesStatus = !filters.status || normalizeLeaveStatus(request.status) === filters.status;
      const dateFilterValue = normalizeDateFilterValue(filters.date);
      const matchesDate = !dateFilterValue || [
        request.startDate,
        request.endDate,
        request.dateFiled,
      ].some((value) => normalizeDateFilterValue(value) === dateFilterValue);

      return matchesSearch && matchesDivision && matchesStatus && matchesDate;
    });

    return sortRequests(filtered, filters.sortBy, filters.sortDirection);
  }, [filters, scopedRequests]);

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
    setFilters(defaultFilterState);
    setCurrentPage(1);
  };

  const submitLeaveRequest = async (payload) => {
    try {
      const result = await fileLeaveRequest(payload);
      setRequests((current) => [result.request, ...current]);
      toast.success(result.message || "Leave request submitted successfully.");
      setIsRequestModalOpen(false);
    } catch (error) {
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
     * request form's print action works exactly this way.
     */
    if (actionType === "view" || actionType === "review" || actionType === "print") {
      setPrintMonetization(actionType === "print");
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
      setSelectedRequest(request);
      return;
    }

    /* The form modal is the print source: it opens, prints itself once loaded, and closes again. */
    if (actionType === "print") {
      setPrintRequest(true);
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

    if (matchesUserRecordScope(request, user)) {
      toast.error("You cannot update your own leave request. Please ask another authorized user to review it.");
      return;
    }

    const labelMap = {
      markReviewed: "approve",
      approve: isRegionalDirector ? "final approve" : "approve",
      reject: "reject",
      cancel: "cancel",
    };

    if (!labelMap[actionType]) {
      return;
    }

    const status = normalizeLeaveStatus(request.status);
    if (actionType === "cancel" && status === "Approved") {
      toast.error("Approved leave requests cannot be cancelled.");
      return;
    }

    // The Regional Director may act while a request is still pending, but not once it is settled.
    if (
      isRegionalDirector
      && ["approve", "reject", "cancel"].includes(actionType)
      && status !== "Pending"
      && status !== "Reviewed"
    ) {
      toast.error("Only pending or reviewed leave requests can be acted on.");
      return;
    }

    const statusMap = {
      markReviewed: "Reviewed",
      approve: "Approved",
      reject: "Rejected",
      cancel: "Cancelled",
    };

    const titleMap = {
      markReviewed: "Approve Leave Request?",
      approve: isRegionalDirector ? "Final Approve Leave Request?" : "Approve Leave Request?",
      reject: "Reject Leave Request?",
      cancel: "Cancel Leave Request?",
    };

    const confirmButtonMap = {
      markReviewed: "Yes, approve",
      approve: isRegionalDirector ? "Yes, final approve" : "Yes, approve",
      reject: "Yes, reject",
      cancel: "Yes, cancel",
    };

    const iconMap = {
      markReviewed: "success",
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
      inputLabel: isRejectAction ? "Rejected note" : undefined,
      inputPlaceholder: isRejectAction ? "Explain why this leave request is being rejected." : undefined,
      inputValue: isRejectAction ? String(request.rejectedNote || "") : undefined,
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
      confirmButtonText: confirmButtonMap[actionType],
      cancelButtonText: "No, keep it",
      confirmButtonColor: actionType === "approve"
        ? "#0f766e"
        : actionType === "markReviewed"
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
    const requiresApprovalCaptcha = actionType === "markReviewed" || actionType === "approve";

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
        text: actionType === "markReviewed"
          ? "Leave request approved by HR and forwarded to the Regional Director for final approval."
          : result.message || `Leave request ${nextStatus.toLowerCase()}.`,
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
            statuses={LEAVE_STATUSES}
            rows={paginatedRequests}
            loading={isLoading}
            totalCount={filteredRequests.length}
            currentPage={safePage}
            totalPages={totalPages}
            pageSize={rowsPerPage}
            canManage={managePermission}
            roleKey={roleKey}
            user={user}
            onFilterChange={handleFilterChange}
            onPageChange={(page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)))}
            onCreate={() => setIsRequestModalOpen(true)}
            onAction={handleTableAction}
            archiveView={leaveArchiveView}
            onToggleArchiveView={(next) => {
              setLeaveArchiveView(next);
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
              reviewed: summary.reviewed,
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
            statuses={LEAVE_STATUSES}
            roleKey={roleKey}
            onChange={handleFilterChange}
            onClear={handleClearFilters}
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setIsRequestModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              <Plus size={16} />
              File Leave Request
            </button>
          </div>

          <LeaveTable
            rows={paginatedRequests}
            loading={isLoading}
            canManage={managePermission}
            roleKey={roleKey}
            canManageRow={(row) => !matchesUserRecordScope(row, user)}
            sortBy={filters.sortBy}
            sortDirection={filters.sortDirection}
            rowStart={(safePage - 1) * rowsPerPage}
            onSort={handleSortChange}
            onAction={handleTableAction}
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
          description="Create, review, approve, reject, return, and monitor employee pass slip records."
          submitLabel="File Pass Slip"
          showDeleteAction={false}
          showHeaderCloseButton={false}
          onPendingCountChange={(count) => updateModulePendingCount("passSlip", count)}
        />
      ) : activeTab === "cto" ? (
        <CompensatoryWorkspace
          user={user}
          employees={employees}
          title="Compensatory Time Off Management"
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
        employees={employees}
        isSubmitting={isSubmitting}
        showHeaderCloseButton={false}
        onClose={() => setIsRequestModalOpen(false)}
        onSubmit={handleSubmitRequest}
      />

      <LeaveFormModal
        open={Boolean(selectedRequest)}
        request={selectedRequest}
        employees={employees}
        reviewer={user}
        showRegionalDirectorApproverSignature={roleKey === "regionaldirector"}
        autoPrint={printRequest}
        onClose={() => {
          setSelectedRequest(null);
          setPrintRequest(false);
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
        onClose={() => {
          setSelectedMonetization(null);
          setPrintMonetization(false);
        }}
      />

    </section>
  );
}


