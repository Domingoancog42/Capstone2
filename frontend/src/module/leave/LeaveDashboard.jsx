import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Clock3, FilePenLine, Filter, Plane, Plus, Search } from "lucide-react";
import { faBan, faCheck, faEye, faFileLines, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import NotificationBadge from "../../components/UI/NotificationBadge";
import Pagination from "../../components/UI/Pagination";
import LeaveCards from "../../components/leave/LeaveCards";
import LeaveFilters from "../../components/leave/LeaveFilters";
import LeaveFormModal from "../../components/leave/LeaveForm";
import LeaveReviewModal from "../../components/leave/LeaveReviewModal";
import LeaveRequestModal from "../../components/leave/LeaveRequestModal";
import LeaveStatusBadge, { getLeaveStatusDisplayLabel } from "../../components/leave/LeaveStatusBadge";
import LeaveTable from "../../components/leave/LeaveTable";
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
  canManageLeave,
  canViewAllLeaves,
  countPendingRecords,
  formatDateDisplay,
  formatDurationLabel,
  isCurrentDateWithin,
  matchesUserRecordScope,
  normalizeLeaveStatus,
  resolveRoleKey,
} from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";
import { requestApprovalCaptcha } from "../../utils/approvalCaptcha";

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
  onFilterChange,
  onPageChange,
  onCreate,
  onAction,
}) {
  const normalizedRoleKey = String(roleKey || "").trim().toLowerCase();
  const isHrHead = normalizedRoleKey === "hrhead";
  const isRegionalDirector = normalizedRoleKey === "regionaldirector";
  const startIndex = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalCount);
  const headers = ["#", "Employee", "Division", "Leave Type", "Reason", "Leave Dates", "Status", "Date Filed", "Actions"];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-950">Leave Request Management</h3>
          <p className="m-0 mt-1 text-sm text-slate-500">
            {isHrHead
              ? "Approve submitted leave requests, filter by employee or status, and update request outcomes."
              : "Review submitted leave requests, filter by employee or status, and update request outcomes."}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
        >
          <Plus size={16} />
          File Leave Request
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.3fr_180px_180px_140px]">
        <label className="relative">
          <span className="sr-only">Search leave requests</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={filters.search}
            onChange={(event) => onFilterChange?.("search", event.target.value)}
            placeholder="Search employee, leave type, reason"
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>

        <label>
          <span className="sr-only">Leave status</span>
          <select
            value={filters.status}
            onChange={(event) => onFilterChange?.("status", event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
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
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </label>

        <label>
          <span className="sr-only">Rows per page</span>
          <select
            value={filters.rowsPerPage}
            onChange={(event) => onFilterChange?.("rowsPerPage", event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="5">5 rows</option>
            <option value="10">10 rows</option>
            <option value="20">20 rows</option>
            <option value="25">25 rows</option>
          </select>
        </label>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
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
                  const normalizedStatus = normalizeLeaveStatus(request.status);
                  const allowRowManagement = !matchesUserRecordScope(request, user);
                  const showOwnRegionalDirectorFormOnly = isRegionalDirector && !allowRowManagement;
                  const isOpenStatus = normalizedStatus === "Pending" || normalizedStatus === "Reviewed";
                  const showReviewDecisionAction = allowRowManagement && isHrHead && normalizedStatus === "Pending";
                  /*
                   * The Regional Director acts on pending requests as well as reviewed ones, so a
                   * request never sits blocked waiting for an HR Head review that may not come.
                   * HR Head review remains available, it is just no longer a precondition.
                   */
                  const showApprovalDecisionAction = allowRowManagement
                    && (isRegionalDirector || !isHrHead)
                    && isOpenStatus;
                  const showRejectCancelActions = allowRowManagement && (
                    (isHrHead && normalizedStatus === "Pending")
                    || ((isRegionalDirector || !isHrHead) && isOpenStatus)
                  );
                  const displayReason = getLeaveReasonDisplay(request.reason, request.leaveType);

                  return (
                    <tr key={request.id} className="border-b border-slate-100 transition hover:bg-slate-50">
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
                        <div>{formatDateDisplay(request.startDate)} - {formatDateDisplay(request.endDate)}</div>
                        <div className="text-xs text-slate-500">{formatDurationLabel(request.numberOfDays)}</div>
                      </td>
                      <td className="px-3 py-3">
                        <LeaveStatusBadge status={request.status} roleKey={roleKey} />
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">{formatDateDisplay(request.dateFiled)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
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
                          {canManage && showRejectCancelActions ? (
                            <ActionIconButton
                              label="Reject leave request"
                              icon={faXmark}
                              tone="reject"
                              onClick={() => onAction?.("reject", request)}
                            />
                          ) : null}
                          {canManage && showRejectCancelActions ? (
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
  const [modulePendingCounts, setModulePendingCounts] = useState(initialModulePendingCounts);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilterState);
  const [currentPage, setCurrentPage] = useState(1);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);

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

    try {
      const result = await fetchLeaveRequests();
      setRequests(result.requests || []);
    } catch (error) {
      if (!background) {
        toast.error(error?.message || "Unable to load leave requests.");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  useAutoRefreshOnChange(refreshAll, {
    topics: ["leave_request", "travel_order", "pass_slip", "compensatory", "overtime"],
  });

  const databaseDivisions = useMemo(
    () =>
      divisions
      .map((division) => (typeof division === "string" ? division : division?.name))
      .filter(Boolean)
      .sort(),
    [divisions]
  );

  const availableDivisions = useMemo(() => {
    const fromRequests = requests.map((request) => request.division).filter(Boolean);
    return Array.from(new Set([...databaseDivisions, ...fromRequests])).sort();
  }, [databaseDivisions, requests]);

  const scopedRequests = useMemo(() => {
    if (viewAllPermission) {
      return requests;
    }
    return requests.filter((request) => requestMatchesCurrentUser(request, user));
  }, [requests, user, viewAllPermission]);
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

  const handleSubmitRequest = async (payload) => {
    setIsSubmitting(true);

    try {
      const result = await fileLeaveRequest(payload);
      setRequests((current) => [result.request, ...current]);
      toast.success(result.message || "Leave request submitted successfully.");
      setIsRequestModalOpen(false);
    } catch (error) {
      toast.error(error?.message || "Unable to submit leave request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTableAction = async (actionType, request) => {
    if (actionType === "review") {
      setReviewRequest(request);
      return;
    }

    if (actionType === "view") {
      setSelectedRequest(request);
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

    if (requiresApprovalCaptcha) {
      const captchaConfirmed = await requestApprovalCaptcha({
        text: "Solve the captcha before this leave approval is completed.",
        confirmButtonText: "Verify and approve",
      });

      if (!captchaConfirmed) {
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

      const result = await updateLeaveStatus(request.id, nextStatus, rejectedNote);
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
      await Swal.fire({
        title: "Update failed",
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
          submitLabel="File Compensatory Time Off"
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
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
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
        showHrmoReviewerSignature={roleKey === "hrhead"}
        showRegionalDirectorApproverSignature={roleKey === "regionaldirector"}
        onClose={() => setSelectedRequest(null)}
      />

      <LeaveReviewModal
        open={Boolean(reviewRequest)}
        request={reviewRequest}
        roleKey={roleKey}
        onClose={() => setReviewRequest(null)}
      />

    </section>
  );
}


