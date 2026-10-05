import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Banknote,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  ReceiptText,
  RefreshCw,
  Send,
  Users,
  WalletCards,
} from "lucide-react";
import DashboardWelcomeBanner from "./DashboardWelcomeBanner";
import { useAutoRefreshOnChange } from "../auto/autorefreshdatalist";
import { exportPayrollRegistry, fetchPayrollRecords } from "../../services/payrollService";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { getRoleLabel } from "../../utils/roleRoutes";
import {
  numberFormatter,
  parseAmount,
  parseDateValue,
  wholeCurrencyFormatter,
} from "../../utils/format";

const RELEASE_STATUS = "Approved";
const PAID_STATUS = "Paid";
const RETURNED_STATUS = "Rejected";
const APPROVAL_QUEUE_STATUSES = new Set([
  "Draft",
  "Pending HR Head Approval",
  "Pending Chief Approval",
  "Pending Regional Director Approval",
]);
const PAGE_SIZE = 6;

const shortCurrencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  notation: "compact",
  maximumFractionDigits: 1,
});

const periodFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const TYPE_TONES = ["bg-blue-500", "bg-sky-400", "bg-indigo-400", "bg-cyan-500", "bg-violet-400"];

function resolveFirstName(user) {
  const rawName = String(user?.full_name || user?.fullName || user?.username || "Cashier").trim();
  return rawName.split(/\s+/).filter(Boolean)[0] || "Cashier";
}

function isSameLocalDay(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function recordDate(record) {
  return parseDateValue(record?.endDate || record?.payrollDate || record?.startDate, { dateOnly: true });
}

function latestHistoryEvent(record) {
  const history = Array.isArray(record?.approvalHistory) ? record.approvalHistory : [];

  return history.reduce((latest, entry) => {
    const entryDate = parseDateValue(entry?.actionDate);
    const latestDate = parseDateValue(latest?.actionDate);

    if (!entryDate) {
      return latest;
    }

    return !latestDate || entryDate > latestDate ? entry : latest;
  }, null);
}

function statusMeta(status) {
  switch (status) {
    case RELEASE_STATUS:
      return { label: "Ready", className: "bg-blue-50 text-blue-700 ring-blue-200" };
    case PAID_STATUS:
      return { label: "Paid", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
    case RETURNED_STATUS:
      return { label: "Returned", className: "bg-rose-50 text-rose-700 ring-rose-200" };
    default:
      return { label: "Pending", className: "bg-amber-50 text-amber-700 ring-amber-200" };
  }
}

function activityMeta(event, record) {
  const action = String(event?.action || "").trim();
  const toStatus = String(event?.toStatus || record?.status || "").trim();
  const paymentType = String(record?.paymentMode || record?.mode || record?.payrollType || "").trim();

  if (action === "Paid" || toStatus === PAID_STATUS) {
    return {
      text: `Payment released${paymentType ? ` (${paymentType})` : ""}`,
      status: "Paid",
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    };
  }

  if (action === "Rejected" || toStatus === RETURNED_STATUS) {
    return {
      text: "Returned for correction",
      status: "Returned",
      badge: "bg-rose-50 text-rose-700 ring-rose-200",
    };
  }

  return {
    text: "Marked as pending",
    status: "Pending",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
  };
}

function initials(name) {
  const parts = String(name || "Employee").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "E";
}

function sumNetPay(records) {
  return records.reduce((sum, record) => sum + parseAmount(record?.netPay), 0);
}

function DashboardCard({ icon: Icon, tone, label, value, helper, loading }) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_7px_22px_rgba(15,23,42,0.05)]">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tone}`}>
          <Icon size={21} strokeWidth={2.2} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold leading-4 text-slate-600">{label}</p>
          {loading ? (
            <span className="mt-2 block h-7 w-24 animate-pulse rounded-md bg-slate-100" />
          ) : (
            <strong className="mt-1 block truncate text-xl font-bold tracking-tight text-slate-950" title={value}>
              {value}
            </strong>
          )}
          <p className="m-0 mt-1 truncate text-[11px] text-slate-400" title={helper}>{helper}</p>
        </div>
      </div>
    </article>
  );
}

function Panel({ title, icon: Icon, action, children, className = "" }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_7px_22px_rgba(15,23,42,0.045)] ${className}`.trim()}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon size={19} className="shrink-0 text-blue-600" aria-hidden="true" />
          <h2 className="m-0 truncate text-sm font-bold text-slate-900 sm:text-[15px]">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function EmptyState({ children }) {
  return (
    <div className="grid min-h-40 place-items-center px-6 py-10 text-center">
      <div>
        <ReceiptText className="mx-auto text-slate-300" size={30} aria-hidden="true" />
        <p className="m-0 mt-3 text-sm font-semibold text-slate-500">{children}</p>
      </div>
    </div>
  );
}

export default function CashierDashboardOverview({ user, onNavigate }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);

  const loadDashboard = useCallback(async ({ background = false } = {}) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await fetchPayrollRecords();
      setRecords(Array.isArray(result?.records) ? result.records : []);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load the cashier dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useAutoRefreshOnChange(loadDashboard, { topic: "payroll" });

  const releaseRecords = useMemo(
    () => records.filter((record) => record.status === RELEASE_STATUS),
    [records]
  );
  const paidRecords = useMemo(
    () => records.filter((record) => record.status === PAID_STATUS),
    [records]
  );
  const paymentRecords = useMemo(
    () => records.filter((record) => [RELEASE_STATUS, PAID_STATUS].includes(record.status)),
    [records]
  );
  const returnedRecords = useMemo(
    () => records.filter((record) => record.status === RETURNED_STATUS),
    [records]
  );
  const approvalQueueRecords = useMemo(
    () => records.filter((record) => APPROVAL_QUEUE_STATUSES.has(record.status)),
    [records]
  );

  const currentPeriodLabel = useMemo(() => {
    const datedRecords = [...releaseRecords, ...records]
      .map(recordDate)
      .filter(Boolean)
      .sort((left, right) => right - left);

    return datedRecords[0] ? periodFormatter.format(datedRecords[0]) : "Current payroll cycle";
  }, [records, releaseRecords]);

  const todayActivity = useMemo(() => {
    const today = new Date();

    return records
      .map((record) => ({ record, event: latestHistoryEvent(record) }))
      .filter(({ event }) => isSameLocalDay(parseDateValue(event?.actionDate), today))
      .sort((left, right) => parseDateValue(right.event.actionDate) - parseDateValue(left.event.actionDate));
  }, [records]);

  const paidToday = useMemo(
    () => todayActivity.filter(({ event, record }) => event?.action === "Paid" || record.status === PAID_STATUS),
    [todayActivity]
  );

  const releaseTotal = useMemo(() => sumNetPay(releaseRecords), [releaseRecords]);
  const paidTodayTotal = useMemo(() => sumNetPay(paidToday.map(({ record }) => record)), [paidToday]);
  const paymentTotal = useMemo(() => sumNetPay(paymentRecords), [paymentRecords]);

  const paymentSummary = useMemo(() => {
    const grouped = new Map();

    paymentRecords.forEach((record) => {
      const type = String(record.payrollType || "Other Payroll").trim() || "Other Payroll";
      grouped.set(type, (grouped.get(type) || 0) + parseAmount(record.netPay));
    });

    return Array.from(grouped.entries())
      .map(([type, amount]) => ({ type, amount, percentage: paymentTotal > 0 ? (amount / paymentTotal) * 100 : 0 }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 5);
  }, [paymentRecords, paymentTotal]);

  const releaseStatusTotal = paidRecords.length + releaseRecords.length + returnedRecords.length;
  const paidPercentage = releaseStatusTotal ? (paidRecords.length / releaseStatusTotal) * 100 : 0;
  const pendingPercentage = releaseStatusTotal ? (releaseRecords.length / releaseStatusTotal) * 100 : 0;
  const returnedPercentage = releaseStatusTotal ? (returnedRecords.length / releaseStatusTotal) * 100 : 0;
  let segmentOffset = 0;
  const releaseStatusSegments = [
    { label: "Paid", count: paidRecords.length, percentage: paidPercentage, color: "#2563eb", dot: "bg-blue-600", bar: "bg-blue-600" },
    { label: "Pending Release", count: releaseRecords.length, percentage: pendingPercentage, color: "#fbbf24", dot: "bg-amber-400", bar: "bg-amber-400" },
    { label: "Returned", count: returnedRecords.length, percentage: returnedPercentage, color: "#f43f5e", dot: "bg-rose-500", bar: "bg-rose-500" },
  ].map((item) => {
    const segment = { ...item, offset: segmentOffset };
    segmentOffset += item.percentage;
    return segment;
  });

  const pageCount = Math.max(1, Math.ceil(paymentRecords.length / PAGE_SIZE));
  const visiblePaymentRecords = useMemo(
    () => paymentRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, paymentRecords]
  );

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const handleExport = async () => {
    if (paymentRecords.length === 0 || exporting) {
      return;
    }

    setExporting(true);
    try {
      await exportPayrollRegistry(
        paymentRecords.map((record) => record.id),
        `cashier-payroll-payments-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Unable to export payroll releases.");
    } finally {
      setExporting(false);
    }
  };

  const stats = [
    {
      label: "Payroll for Release",
      value: numberFormatter.format(releaseRecords.length),
      helper: `${releaseRecords.length === 1 ? "Employee" : "Employees"} ready for payout`,
      icon: Users,
      tone: "bg-blue-50 text-blue-600",
    },
    {
      label: "Total Amount for Release",
      value: wholeCurrencyFormatter.format(releaseTotal),
      helper: currentPeriodLabel,
      icon: Banknote,
      tone: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Paid Today",
      value: wholeCurrencyFormatter.format(paidTodayTotal),
      helper: `${numberFormatter.format(paidToday.length)} ${paidToday.length === 1 ? "transaction" : "transactions"}`,
      icon: WalletCards,
      tone: "bg-sky-50 text-sky-600",
    },
    {
      label: "Pending Payments",
      value: numberFormatter.format(approvalQueueRecords.length),
      helper: "Awaiting payroll approval",
      icon: Clock3,
      tone: "bg-amber-50 text-amber-600",
    },
    {
      label: "Returned Payroll",
      value: numberFormatter.format(returnedRecords.length),
      helper: "Needs correction",
      icon: CircleAlert,
      tone: "bg-rose-50 text-rose-600",
    },
  ];

  return (
    <div className="w-full space-y-4">
      <DashboardWelcomeBanner
        name={resolveFirstName(user)}
        position={user?.position || "Not assigned"}
        role={getRoleLabel(user?.role || user?.roleKey || "cashier")}
        division="All Divisions"
        divisionHelper="Organization-wide access"
        imageUrl={resolveBackendAssetUrl(user?.profile_image || user?.profileImage)}
        showCalendar
      />

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          <span>{error}</span>
          <button type="button" onClick={() => loadDashboard()} className="shrink-0 rounded-lg px-2 py-1 text-xs hover:bg-amber-100">
            Try again
          </button>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => <DashboardCard key={stat.label} {...stat} loading={loading} />)}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Payroll Release Status" icon={ReceiptText}>
          <div className="grid min-h-[220px] gap-6 p-5 sm:grid-cols-[180px_1fr] sm:items-center">
            <div className="relative mx-auto h-36 w-36" role="img" aria-label={`Payroll release status: ${paidRecords.length} paid, ${releaseRecords.length} pending release, ${returnedRecords.length} returned`}>
              <svg
                key={`${paidRecords.length}-${releaseRecords.length}-${returnedRecords.length}`}
                className="h-full w-full -rotate-90 overflow-visible"
                viewBox="0 0 100 100"
                aria-hidden="true"
              >
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="14" />
                {releaseStatusSegments.map((item, index) => {
                  if (item.percentage <= 0) {
                    return null;
                  }

                  const visiblePercentage = Math.max(0.7, item.percentage - Math.min(1.25, item.percentage * 0.12));

                  return (
                    <motion.circle
                      key={item.label}
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      pathLength="100"
                      stroke={item.color}
                      strokeWidth="14"
                      strokeLinecap="round"
                      initial={{ strokeDasharray: "0 100", strokeDashoffset: -item.offset, opacity: 0 }}
                      animate={{ strokeDasharray: `${visiblePercentage} ${100 - visiblePercentage}`, strokeDashoffset: -item.offset, opacity: 1 }}
                      transition={{ duration: 0.9, delay: index * 0.14, ease: [0.22, 1, 0.36, 1] }}
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-[22px] grid place-items-center rounded-full bg-white text-center shadow-inner">
                <div>
                  <strong className="block text-2xl font-bold text-slate-950">{numberFormatter.format(releaseStatusTotal)}</strong>
                  <span className="text-[11px] font-medium text-slate-400">Total</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {releaseStatusSegments.map((item, index) => (
                <div key={item.label} className="grid grid-cols-[112px_1fr_54px] items-center gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-700">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dot}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <motion.div
                      key={`${item.label}-${item.count}`}
                      className={`h-full rounded-full ${item.bar}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${item.percentage}%` }}
                      transition={{ duration: 0.8, delay: 0.18 + index * 0.1, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <div className="text-right">
                    <strong className="block text-xs text-slate-800">{Math.round(item.percentage)}%</strong>
                    <span className="block text-[10px] text-slate-400">{item.count} records</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Payment Summary" icon={BarChart3}>
          {paymentSummary.length > 0 ? (
            <div className="p-4 sm:p-5">
              <div className="mb-2 grid grid-cols-[minmax(110px,1fr)_90px_minmax(120px,1.5fr)_42px] gap-3 rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <span>Payment type</span>
                <span>Amount</span>
                <span aria-hidden="true" />
                <span className="text-right">Share</span>
              </div>
              <div className="divide-y divide-slate-100">
                {paymentSummary.map((item, index) => (
                  <div key={item.type} className="grid grid-cols-[minmax(110px,1fr)_90px_minmax(120px,1.5fr)_42px] items-center gap-3 px-3 py-3 text-xs">
                    <span className="truncate font-semibold text-slate-700" title={item.type}>{item.type}</span>
                    <strong className="truncate text-slate-900" title={wholeCurrencyFormatter.format(item.amount)}>
                      {shortCurrencyFormatter.format(item.amount)}
                    </strong>
                    <div className="h-3 overflow-hidden rounded bg-slate-100">
                      <div className={`h-full rounded ${TYPE_TONES[index % TYPE_TONES.length]}`} style={{ width: `${item.percentage}%` }} />
                    </div>
                    <span className="text-right text-[11px] font-semibold text-slate-500">{Math.round(item.percentage)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState>No approved or released payroll payments found.</EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.95fr)]">
        <Panel
          title="Payments for Release"
          icon={ReceiptText}
          action={(
            <div className="flex items-center gap-2">
              {refreshing ? <RefreshCw size={15} className="animate-spin text-slate-400" aria-label="Refreshing" /> : null}
              <button
                type="button"
                onClick={handleExport}
                disabled={paymentRecords.length === 0 || exporting}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={14} aria-hidden="true" />
                {exporting ? "Exporting" : "Export"}
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.("/cashier/payroll/generate")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                <Send size={14} aria-hidden="true" />
                Release Payments
              </button>
            </div>
          )}
        >
          {visiblePaymentRecords.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Emp no.</th>
                      <th className="px-4 py-3">Employee name</th>
                      <th className="px-4 py-3">Payroll type</th>
                      <th className="px-4 py-3 text-right">Net pay</th>
                      <th className="px-4 py-3">Pay period</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visiblePaymentRecords.map((record) => {
                      const meta = statusMeta(record.status);
                      return (
                        <tr key={record.id} className="transition hover:bg-blue-50/40">
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-500">{record.employeeId || "N/A"}</td>
                          <td className="max-w-[190px] px-4 py-3 font-semibold text-slate-900">
                            <span className="block truncate" title={record.employeeName}>{record.employeeName || "N/A"}</span>
                          </td>
                          <td className="max-w-[150px] px-4 py-3 text-slate-600">
                            <span className="block truncate" title={record.payrollType}>{record.payrollType || "Regular Payroll"}</span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-800">{wholeCurrencyFormatter.format(parseAmount(record.netPay))}</td>
                          <td className="max-w-[150px] px-4 py-3 text-slate-500">
                            <span className="block truncate" title={record.payPeriod || record.periodLabel}>{record.payPeriod || record.periodLabel || "N/A"}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${meta.className}`}>{meta.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <footer className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, paymentRecords.length)} of {paymentRecords.length} records
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">
                    <ChevronLeft size={15} />
                  </button>
                  <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-blue-600 px-2 font-bold text-white">{page}</span>
                  <span className="px-1 text-slate-400">of {pageCount}</span>
                  <button type="button" aria-label="Next page" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </footer>
            </>
          ) : loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : (
            <EmptyState>There are no approved or released payroll payments.</EmptyState>
          )}
        </Panel>

        <Panel
          title="Today's Activity"
          icon={Clock3}
          action={(
            <button type="button" onClick={() => onNavigate?.("/cashier/payroll/generate")} className="text-[11px] font-bold text-blue-600 hover:text-blue-700">
              View all
            </button>
          )}
        >
          {todayActivity.length > 0 ? (
            <div className="divide-y divide-slate-100 px-5">
              {todayActivity.slice(0, 5).map(({ record, event }, index) => {
                const meta = activityMeta(event, record);
                return (
                  <motion.article
                    key={`${record.id}-${event.id || event.actionDate}`}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: index * 0.06, ease: "easeOut" }}
                    className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 py-3.5"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200/70">
                      {initials(record.employeeName)}
                    </div>
                    <div className="min-w-0 self-center">
                      <strong className="block truncate text-xs font-bold text-slate-900" title={record.employeeName}>{record.employeeName || "Employee"}</strong>
                      <p className="m-0 mt-1 truncate text-[10px] leading-4 text-slate-400" title={meta.text}>{meta.text}</p>
                    </div>
                    <div className="min-w-[76px] self-center text-right">
                      <strong className="block whitespace-nowrap text-[11px] font-bold text-slate-900">{wholeCurrencyFormatter.format(parseAmount(record.netPay))}</strong>
                      <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${meta.badge}`}>{meta.status}</span>
                      <time className="mt-1 block text-[9px] leading-none text-slate-400">{timeFormatter.format(parseDateValue(event.actionDate))}</time>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          ) : (
            <EmptyState>No payroll activity has been recorded today.</EmptyState>
          )}
        </Panel>
      </div>
    </div>
  );
}
