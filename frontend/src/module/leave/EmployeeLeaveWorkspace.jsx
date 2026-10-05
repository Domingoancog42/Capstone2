import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FilePenLine,
  Filter,
  Search,
} from "lucide-react";
import {
  faBan,
  faBoxArchive,
  faPrint,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import ViewFormActions from "../../components/UI/ViewFormActions";
import ArchiveViewToggle from "../../components/UI/ArchiveViewToggle";
import LeaveFormModal from "../../components/leave/LeaveForm";
import LeaveBalanceModal, { LeaveBalanceButton } from "../../components/leave/LeaveBalanceModal";
import LeaveRequestModal from "../../components/leave/LeaveRequestModal";
import LeaveStatusBadge from "../../components/leave/LeaveStatusBadge";
import LeaveMonetizationFormModal from "../../components/payroll/LeaveMonetizationForm";
import Pagination from "../../components/UI/Pagination";
import RecordCards from "../../components/UI/RecordCards";
import { LEAVE_MONETIZATION_TYPE, LEAVE_STATUSES, LEAVE_TYPES } from "../../data/leaveTypes";
import { useLeaveTypeFilterOptions } from "../../hooks/useFilterOptions";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchLeaveCredits,
  fetchLeaveRequests,
  fileLeaveRequest,
  updateLeaveStatus,
} from "../../services/leaveService";
import {
  fetchLeaveMonetizationRequests,
  fileLeaveMonetizationRequest,
  updateLeaveMonetizationStatus,
} from "../../services/leaveMonetizationService";
import {
  formatDateDisplay,
  formatDurationLabel,
  isLeaveStartDateTooSoon,
  isRegionalDirectorApproved,
  LEAVE_ADVANCE_NOTICE_ERROR,
  matchesUserRecordScope,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";
import {
  formatMonetizationDays,
  toLeaveMonetizationRow,
  toLeaveRequestRow,
} from "../../utils/leaveMonetization";
import {
  confirmLeaveWithoutPay,
  extractLeaveWithoutPayPrompt,
} from "../../utils/leaveWithoutPay";
import { showDuplicateLeaveDateAlert } from "../../utils/duplicateLeaveDate";
import { confirmArchiveRecord, confirmRestoreRecord } from "../../utils/archiveActions";

export default function EmployeeLeaveWorkspace({ user }) {
  const [requests, setRequests] = useState([]);
  /* Monetization filings, kept by leave_monetization.php and listed alongside the leave requests. */
  const [monetizationRecords, setMonetizationRecords] = useState([]);
  /* The whole leave_credit.php snapshot: the balances feed the request form, the rest the balance modal. */
  const [leaveCreditSnapshot, setLeaveCreditSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  /* The request whose CSC Form No. 6 is open for viewing; null when the form modal is closed. */
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedMonetization, setSelectedMonetization] = useState(null);
  const [printMonetization, setPrintMonetization] = useState(false);
  const [printRequest, setPrintRequest] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [leaveType, setLeaveType] = useState("");
  /*
   * Leave types from the leave_types table. Monetization is filed through leave_monetization.php rather
   * than as a leave type, so it is offered after them for the monetization filings in this list.
   */
  const configuredLeaveTypes = useLeaveTypeFilterOptions();
  const leaveTypeFilterOptions = useMemo(
    () => Array.from(new Set([...configuredLeaveTypes, LEAVE_MONETIZATION_TYPE])),
    [configuredLeaveTypes]
  );
  const [status, setStatus] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);
  const [archiveView, setArchiveView] = useState(false);

  const loadLeaveWorkspace = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    const [requestResult, creditResult, monetizationResult] = await Promise.allSettled([
      fetchLeaveRequests({ archived: archiveView }),
      fetchLeaveCredits(),
      fetchLeaveMonetizationRequests({ archived: archiveView }),
    ]);

    try {
      if (requestResult.status === "fulfilled") {
        setRequests((requestResult.value.requests || []).filter((request) => matchesUserRecordScope(request, user)));
      } else if (!background) {
        setRequests([]);
        toast.error(requestResult.reason?.response?.data?.message || "Unable to load leave history.");
      }

      /* The endpoint already scopes an employee to their own filings, so nothing is filtered here. */
      if (monetizationResult.status === "fulfilled") {
        setMonetizationRecords(
          Array.isArray(monetizationResult.value?.records) ? monetizationResult.value.records : []
        );
      } else if (!background) {
        setMonetizationRecords([]);
        toast.error(
          monetizationResult.reason?.response?.data?.message
            || "Unable to load leave monetization requests."
        );
      }

      if (creditResult.status === "fulfilled") {
        setLeaveCreditSnapshot(creditResult.value?.credits || null);
      } else if (!background) {
        setLeaveCreditSnapshot(null);
        toast.error(creditResult.reason?.response?.data?.message || "Unable to load leave credits.");
      }
    } finally {
      setLoading(false);
    }
  }, [archiveView, user]);

  useEffect(() => {
    void loadLeaveWorkspace();
  }, [loadLeaveWorkspace]);

  useAutoRefreshOnChange(loadLeaveWorkspace, {
    topics: ["leave_request", "leave_credit", "leave_monetization"],
    refreshOnMount: false,
  });

  const leaveCredits = useMemo(
    () => (Array.isArray(leaveCreditSnapshot?.balances) ? leaveCreditSnapshot.balances : []),
    [leaveCreditSnapshot]
  );

  /*
   * One history: monetization is filed from the leave request form as a leave type of its own, so
   * it belongs in the same list. `rowKey` keeps the two apart, since the tables behind them number
   * their records separately and the ids overlap.
   */
  const combinedRequests = useMemo(
    () => [
      ...requests.map(toLeaveRequestRow),
      ...monetizationRecords.map(toLeaveMonetizationRow),
    ],
    [monetizationRecords, requests]
  );

  const filteredRequests = useMemo(() => {
    const search = query.trim().toLowerCase();

    return combinedRequests.filter((request) => {
      const displayReason = getLeaveReasonDisplay(request.reason, request.leaveType);
      const matchesSearch = !search || [
        request.leaveType,
        displayReason,
        request.status,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      const matchesType = !leaveType || request.leaveType === leaveType;
      const matchesStatus = !status || normalizeLeaveStatus(request.status) === normalizeLeaveStatus(status);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [combinedRequests, leaveType, query, status]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRequests = filteredRequests.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [archiveView, leaveType, query, rowsPerPage, status]);

  const submitLeaveRequest = async (payload) => {
    try {
      const result = await fileLeaveRequest(payload);
      setRequests((current) => [result.request, ...current]);
      toast.success(result.message || "Leave request submitted successfully.");
      setModalOpen(false);
    } catch (error) {
      if (showDuplicateLeaveDateAlert(error)) {
        return;
      }

      /*
       * The modal already warns when it can see the balance. This covers the cases it cannot,
       * such as credits that changed while the form was open.
       */
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
        leaveTypeCode: payload.leaveTypeCode,
        numberOfDays: payload.numberOfDays,
        dateFiled: payload.dateFiled,
        reason: payload.reason,
      });

      if (result?.record) {
        setMonetizationRecords((current) => [result.record, ...current]);
      } else {
        await loadLeaveWorkspace({ background: true });
      }

      toast.success(result?.message || "Leave monetization request submitted.");
      setModalOpen(false);
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

    setSubmitting(true);
    try {
      if (payload?.isLeaveMonetization) {
        await submitMonetizationRequest(payload);
        return;
      }

      await submitLeaveRequest(payload);
    } finally {
      setSubmitting(false);
    }
  };

  /* Withdrawing a monetization filing, which is the one decision on it that is the employee's. */
  const handleCancelMonetization = async (record) => {
    if (normalizeLeaveStatus(record.status) !== "Pending") {
      toast.error("Only pending leave monetization requests can be cancelled.");
      return;
    }

    const confirmation = await Swal.fire({
      title: "Cancel Leave Monetization?",
      text: `Cancel your monetization of ${formatMonetizationDays(record.numberOfDays)} day(s) of ${record.monetizedLeaveType || "leave"} credits?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, cancel it",
      cancelButtonText: "Keep request",
      confirmButtonColor: "#475569",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const toastId = toast.loading("Cancelling leave monetization request...");

    try {
      const result = await updateLeaveMonetizationStatus(record.id, "Cancelled");
      const updatedRecord = result?.record || { ...record, status: "Cancelled" };

      setMonetizationRecords((current) =>
        current.map((item) => (String(item.id) === String(updatedRecord.id) ? updatedRecord : item))
      );

      toast.success(result?.message || "Leave monetization request cancelled.", { id: toastId });
    } catch (error) {
      toast.error(
        error?.response?.data?.message || "Unable to cancel the leave monetization request.",
        { id: toastId }
      );
    }
  };

  const handleCancelRequest = async (request) => {
    if (request.isLeaveMonetization) {
      await handleCancelMonetization(request);
      return;
    }

    if (normalizeLeaveStatus(request.status) !== "Pending") {
      toast.error("Only pending leave requests can be cancelled.");
      return;
    }

    const confirmation = await Swal.fire({
      title: "Cancel Leave Request?",
      text: `Cancel your ${request.leaveType} request for ${formatDateDisplay(request.startDate)} to ${formatDateDisplay(request.endDate)}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, cancel it",
      cancelButtonText: "Keep request",
      confirmButtonColor: "#475569",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      Swal.fire({
        title: "Cancelling...",
        text: "Please wait while your leave request is updated.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await updateLeaveStatus(request.id, "Cancelled");
      const updatedRequest = result.request || { ...request, status: "Cancelled" };

      setRequests((current) =>
        current.map((item) => (item.id === updatedRequest.id ? updatedRequest : item))
      );

      await Swal.fire({
        title: "Cancelled",
        text: result.message || "Leave request cancelled.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });
    } catch (error) {
      await Swal.fire({
        title: "Cancellation failed",
        text: error?.response?.data?.message || error?.message || "Unable to cancel leave request.",
        icon: "error",
        confirmButtonColor: "#dc2626",
      });
    }
  };

  const removeRequestFromCurrentView = (request) => {
    if (request.isLeaveMonetization) {
      setMonetizationRecords((current) => current.filter((item) => String(item.id) !== String(request.id)));
      return;
    }

    setRequests((current) => current.filter((item) => String(item.id) !== String(request.id)));
  };

  const handleArchiveRequest = async (request, restore = false) => {
    const moduleKey = request.isLeaveMonetization ? "leaveMonetization" : "leave";
    const noun = request.isLeaveMonetization ? "leave monetization request" : "leave request";

    if (restore) {
      await confirmRestoreRecord({
        module: moduleKey,
        id: request.id,
        noun,
        onRestored: () => removeRequestFromCurrentView(request),
      });
      return;
    }

    if (!["Approved", "Rejected", "Cancelled"].includes(normalizeLeaveStatus(request.status))) {
      toast.error("Only approved, rejected, or cancelled leave requests can be archived.");
      return;
    }

    await confirmArchiveRecord({
      module: moduleKey,
      id: request.id,
      noun,
      onArchived: () => removeRequestFromCurrentView(request),
    });
  };

  /*
   * Viewing is always offered — the CSC Form No. 6 is the record of what was filed, and an employee
   * should be able to read their own back at any status. Printing waits for the Regional Director's
   * approval, since an unsigned form is not a document worth handing anyone. Cancelling is only
   * theirs to do while the request is still pending; completed requests can move to the archive
   * and requests archived by this employee can be restored. Defined once so the table and the
   * narrow-screen cards agree.
   */
  const renderRequestActions = (request) => (
    <ViewFormActions
      viewLabel={request.isLeaveMonetization ? "View leave monetization form" : "View leave form"}
      onView={() => {
        if (request.isLeaveMonetization) {
          /*
           * The row renamed `leaveType` to the filing itself, so the credit it draws from is put
           * back for the form, which reads that field to fill the certification of credits.
           */
          setPrintMonetization(false);
          setSelectedMonetization({
            ...request,
            leaveType: request.monetizedLeaveType || request.leaveType,
          });
          return;
        }

        setPrintRequest(false);
        setSelectedRequest(request);
      }}
    >
      {/* The form modal is the print source: it opens, prints itself once loaded, and closes again. */}
      {request.isLeaveMonetization && isRegionalDirectorApproved(request) ? (
        <ActionIconButton
          label="Print leave monetization form"
          icon={faPrint}
          tone="print"
          onClick={() => {
            setPrintMonetization(true);
            setSelectedMonetization({
              ...request,
              leaveType: request.monetizedLeaveType || request.leaveType,
            });
          }}
        />
      ) : null}
      {!request.isLeaveMonetization && isRegionalDirectorApproved(request) ? (
        <ActionIconButton
          label="Print leave form"
          icon={faPrint}
          tone="print"
          onClick={() => {
            setPrintRequest(true);
            setSelectedRequest(request);
          }}
        />
      ) : null}
      {archiveView && String(request.archivedByUserId || "") === String(user?.id || "") ? (
        <ActionIconButton
          label={request.isLeaveMonetization ? "Restore leave monetization request" : "Restore leave request"}
          icon={faRotateLeft}
          tone="restore"
          onClick={() => handleArchiveRequest(request, true)}
        />
      ) : null}
      {!archiveView && ["Approved", "Rejected", "Cancelled"].includes(normalizeLeaveStatus(request.status)) ? (
        <ActionIconButton
          label={request.isLeaveMonetization ? "Archive leave monetization request" : "Archive leave request"}
          icon={faBoxArchive}
          tone="archive"
          onClick={() => handleArchiveRequest(request)}
        />
      ) : null}
      {!archiveView && normalizeLeaveStatus(request.status) === "Pending" ? (
        <ActionIconButton
          label={request.isLeaveMonetization ? "Cancel leave monetization" : "Cancel leave request"}
          icon={faBan}
          tone="cancel"
          onClick={() => handleCancelRequest(request)}
        />
      ) : null}
    </ViewFormActions>
  );

  return (
    <div className="employee-leave-workspace space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">
              {archiveView ? "Archived Leave Requests" : "Leave History"}
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {archiveView
                ? "Review your archived leave requests and restore them when needed."
                : "Search, filter, and monitor your submitted leave requests."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ArchiveViewToggle
              archiveView={archiveView}
              label="leave requests"
              onToggle={(next) => {
                setArchiveView(next);
                setStatus("");
                setCurrentPage(1);
              }}
            />
            <LeaveBalanceButton onClick={() => setBalanceOpen(true)} />
            {!archiveView ? (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <FilePenLine size={16} />
                File Leave Request
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_150px_130px]">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">
              {archiveView ? "Search Archived Requests" : "Search Leave History"}
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={archiveView ? "Search archived requests" : "Search leave history"}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Leave Type</span>
            <select
              value={leaveType}
              onChange={(event) => setLeaveType(event.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All leave types</option>
              {leaveTypeFilterOptions.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">All statuses</option>
              {LEAVE_STATUSES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Rows Per Page</span>
            <select
              value={rowsPerPage}
              onChange={(event) => setRowsPerPage(event.target.value)}
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

        {/*
          * Below `lg` the nine-column table would be a sideways drag, so the same rows render as
          * cards; from `lg` up the table takes over. Zooming the browser out widens the CSS
          * viewport, so a zoomed-out phone or tablet lands back on the table.
          */}
        <RecordCards
          className="mt-4 lg:hidden"
          items={paginatedRequests}
          loading={loading}
          loadingCards={3}
          empty={{
            icon: Filter,
            title: archiveView ? "No archived leave requests" : "No leave requests found",
            description: archiveView
              ? "Requests you archive will appear here."
              : "File a request or adjust your filters to see history.",
          }}
          itemKey={(request, index) => request?.rowKey || request?.id || index}
          renderCard={(request) => ({
            title: request.leaveType,
            subtitle: request.isLeaveMonetization
              ? `${request.monetizedLeaveType || "Leave"} credits`
              : `${formatDateDisplay(request.startDate)} - ${formatDateDisplay(request.endDate)}`,
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
            fields: [
              {
                label: "Days",
                value: request.isLeaveMonetization
                  ? `${formatMonetizationDays(request.numberOfDays)} day(s)`
                  : formatDurationLabel(request.numberOfDays),
              },
              {
                label: "Reason",
                value: getLeaveReasonDisplay(request.reason, request.leaveType) || "No reason provided",
                full: true,
              },
            ],
            actions: renderRequestActions(request),
          })}
        />

        <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {["Leave Type", "Date Range", "Days", "Status", "Reason", "Actions"].map((header) => (
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
                      <td colSpan={6} className="px-3 py-3">
                        <div className="h-5 rounded bg-slate-200" />
                      </td>
                    </tr>
                  ))
                ) : paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                        <Filter size={20} />
                      </div>
                      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">
                        {archiveView ? "No archived leave requests" : "No leave requests found"}
                      </p>
                      <p className="m-0 mt-1 text-sm text-slate-500">
                        {archiveView
                          ? "Requests you archive will appear here."
                          : "File a request or adjust your filters to see history."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedRequests.map((request) => {
                    return (
                      <tr key={request.rowKey || request.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3 text-sm text-slate-800">{request.leaveType}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">
                          {/* A monetization has no span of dates: it draws days from a credit. */}
                          {request.isLeaveMonetization
                            ? `${request.monetizedLeaveType || "Leave"} credits`
                            : `${formatDateDisplay(request.startDate)} - ${formatDateDisplay(request.endDate)}`}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">
                          {request.isLeaveMonetization
                            ? `${formatMonetizationDays(request.numberOfDays)} day(s)`
                            : formatDurationLabel(request.numberOfDays)}
                        </td>
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
                        <td className="max-w-[260px] truncate px-3 py-3 text-sm text-slate-600">{getLeaveReasonDisplay(request.reason, request.leaveType) || "No reason provided"}</td>
                        <td className="px-3 py-3">
                          {renderRequestActions(request)}
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
            Showing {filteredRequests.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredRequests.length)} of {filteredRequests.length} requests
          </p>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      </section>

      <LeaveBalanceModal
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        credits={leaveCreditSnapshot}
      />

      <LeaveRequestModal
        open={modalOpen}
        user={user}
        leaveTypes={LEAVE_TYPES}
        leaveCredits={leaveCredits}
        isSubmitting={submitting}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmitRequest}
      />

      {/*
        * The same CSC Form No. 6 the approvers see. No `employees` list is passed: the modal
        * re-fetches the request by id and that answer already carries this employee's name,
        * position, division and salary. No `reviewer` either — that prop only fills the HR Head and
        * Regional Director signature blocks, which stay off for the person who filed. Signatures
        * already on the record still render; this view just never adds the viewer's own.
        */}
      <LeaveFormModal
        open={Boolean(selectedRequest)}
        request={selectedRequest}
        autoPrint={printRequest}
        onClose={() => {
          setSelectedRequest(null);
          setPrintRequest(false);
        }}
      />

      {/* The monetization filing's copy of the same CSC Form No. 6, printed the same way. */}
      <LeaveMonetizationFormModal
        open={Boolean(selectedMonetization)}
        record={selectedMonetization}
        autoPrint={printMonetization}
        onClose={() => {
          setSelectedMonetization(null);
          setPrintMonetization(false);
        }}
      />
    </div>
  );
}


