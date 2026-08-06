import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  FilePenLine,
  Filter,
  Search,
  Wallet,
} from "lucide-react";
import { faBan } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import ActionIconButton from "../../components/UI/ActionIconButton";
import LeaveRequestModal from "../../components/leave/LeaveRequestModal";
import LeaveStatusBadge from "../../components/leave/LeaveStatusBadge";
import Pagination from "../../components/UI/Pagination";
import ProfileFloatingCard from "../../components/profile/ProfileFloatingCard";
import { LEAVE_STATUSES, LEAVE_TYPES } from "../../data/leaveTypes";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchLeaveCredits,
  fetchLeaveRequests,
  fileLeaveRequest,
  updateLeaveStatus,
} from "../../services/leaveService";
import {
  formatDateDisplay,
  formatDurationLabel,
  matchesUserRecordScope,
  normalizeLeaveStatus,
} from "../../utils/leaveHelpers";
import { getLeaveReasonDisplay } from "../../utils/leaveRequestDetails";
import {
  confirmLeaveWithoutPay,
  extractLeaveWithoutPayPrompt,
} from "../../utils/leaveWithoutPay";

const leaveBalanceCards = [
  { type: "Vacation Leave", tone: "from-teal-600 to-cyan-600", icon: CalendarDays },
  { type: "Sick Leave", tone: "from-sky-600 to-indigo-600", icon: CalendarClock },
];

function formatCreditValue(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(2).replace(/\.?0+$/, "");
}

export default function EmployeeLeaveWorkspace({ user }) {
  const [requests, setRequests] = useState([]);
  const [leaveCredits, setLeaveCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [status, setStatus] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState("5");
  const [currentPage, setCurrentPage] = useState(1);

  const loadLeaveWorkspace = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    const [requestResult, creditResult] = await Promise.allSettled([
      fetchLeaveRequests(),
      fetchLeaveCredits(),
    ]);

    try {
      if (requestResult.status === "fulfilled") {
        setRequests((requestResult.value.requests || []).filter((request) => matchesUserRecordScope(request, user)));
      } else if (!background) {
        toast.error(requestResult.reason?.response?.data?.message || "Unable to load leave history.");
      }

      if (creditResult.status === "fulfilled") {
        setLeaveCredits(creditResult.value?.credits?.balances || []);
      } else if (!background) {
        setLeaveCredits([]);
        toast.error(creditResult.reason?.response?.data?.message || "Unable to load leave credits.");
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useAutoRefreshOnChange(loadLeaveWorkspace, {
    topics: ["leave_request", "leave_credit"],
  });

  const filteredRequests = useMemo(() => {
    const search = query.trim().toLowerCase();

    return requests.filter((request) => {
      const displayReason = getLeaveReasonDisplay(request.reason, request.leaveType);
      const matchesSearch = !search || [
        request.leaveType,
        displayReason,
        request.status,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      const matchesType = !leaveType || request.leaveType === leaveType;
      const matchesStatus = !status || normalizeLeaveStatus(request.status) === status;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [leaveType, query, requests, status]);

  const balanceCards = useMemo(
    () =>
      leaveBalanceCards.map((card) => {
        const matchedBalance = leaveCredits.find((balance) => balance.type === card.type);

        return {
          ...card,
          remaining: matchedBalance?.remaining ?? 15,
          used: matchedBalance?.used ?? 0,
          total: matchedBalance?.total ?? 15,
        };
      }),
    [leaveCredits]
  );

  const pageSize = Number(rowsPerPage) || 5;
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRequests = filteredRequests.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [leaveType, query, rowsPerPage, status]);

  const submitLeaveRequest = async (payload) => {
    try {
      const result = await fileLeaveRequest(payload);
      setRequests((current) => [result.request, ...current]);
      toast.success(result.message || "Leave request submitted successfully.");
      setModalOpen(false);
    } catch (error) {
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

  const handleSubmitRequest = async (payload) => {
    setSubmitting(true);
    try {
      await submitLeaveRequest(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (request) => {
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

  return (
    <div className="employee-leave-workspace space-y-5">

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-base font-semibold text-slate-950">Leave History</h3>
            <p className="m-0 mt-1 text-sm text-slate-500">Search, filter, and monitor your submitted leave requests.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBalanceOpen(true)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Wallet size={16} />
              View Leave Balance
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              <FilePenLine size={16} />
              File Leave Request
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_160px_150px_130px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search leave history"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <select
            value={leaveType}
            onChange={(event) => setLeaveType(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All leave types</option>
            {LEAVE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">All statuses</option>
            {LEAVE_STATUSES.map((item) => (
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

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {["#", "Leave Type", "Date Range", "Days", "Status", "Reason", "Actions"].map((header) => (
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
                      <td colSpan={7} className="px-3 py-3">
                        <div className="h-5 rounded bg-slate-200" />
                      </td>
                    </tr>
                  ))
                ) : paginatedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                        <Filter size={20} />
                      </div>
                      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">No leave requests found</p>
                      <p className="m-0 mt-1 text-sm text-slate-500">File a request or adjust your filters to see history.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRequests.map((request, index) => {
                    const canCancelRequest = normalizeLeaveStatus(request.status) === "Pending";

                    return (
                      <tr key={request.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                        <td className="px-3 py-3 text-sm font-semibold text-slate-600">
                          {(safePage - 1) * pageSize + index + 1}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-800">{request.leaveType}</td>
                        <td className="px-3 py-3 text-sm text-slate-600">
                          {formatDateDisplay(request.startDate)} - {formatDateDisplay(request.endDate)}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600">{formatDurationLabel(request.numberOfDays)}</td>
                        <td className="px-3 py-3"><LeaveStatusBadge status={request.status} /></td>
                        <td className="max-w-[260px] truncate px-3 py-3 text-sm text-slate-600">{getLeaveReasonDisplay(request.reason, request.leaveType) || "No reason provided"}</td>
                        <td className="px-3 py-3">
                          {canCancelRequest ? (
                            <ActionIconButton
                              label="Cancel leave request"
                              icon={faBan}
                              tone="cancel"
                              onClick={() => handleCancelRequest(request)}
                            />
                          ) : (
                            <span className="text-sm font-semibold text-slate-300">-</span>
                          )}
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

      <ProfileFloatingCard
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        title="Leave Balance"
        subtitle="Available credits on your employee account for the current year."
        icon={Wallet}
        maxWidth="max-w-[460px]"
      >
        <div className="space-y-3">
          {balanceCards.map((card) => {
            const Icon = card.icon;

            return (
              <article key={card.type} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className={`h-1.5 bg-gradient-to-r ${card.tone}`} />
                <div className="flex items-center gap-3 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-slate-500">{card.type}</p>
                    <div className="mt-1.5 flex items-end justify-between gap-3">
                      <strong className="text-lg font-semibold leading-none text-slate-950">
                        {formatCreditValue(card.remaining)}
                      </strong>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {formatCreditValue(card.used)} used of {formatCreditValue(card.total)}
                      </span>
                    </div>
                    <p className="m-0 mt-1.5 text-xs text-slate-500">Remaining days</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </ProfileFloatingCard>

      <LeaveRequestModal
        open={modalOpen}
        user={user}
        leaveTypes={LEAVE_TYPES}
        leaveCredits={leaveCredits}
        isSubmitting={submitting}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmitRequest}
      />
    </div>
  );
}


