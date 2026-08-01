import React from "react";
import { ClipboardList, RefreshCw, Search } from "lucide-react";
import Button from "../../components/UI/button";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { SettingsPanel, SettingsSelect } from "../../components/settings";

const auditRangeOptions = [
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "90d", label: "Last 90d" },
  { value: "all", label: "All time" },
];

const auditPageSizeOptions = [10, 25, 50, 100];

export const defaultAuditPagination = {
  page: 1,
  perPage: 25,
  total: 0,
  totalPages: 1,
  from: 0,
  to: 0,
};

function parseAuditDate(value) {
  const date = new Date(String(value || "").replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAuditTime(value) {
  const date = parseAuditDate(value);

  return date
    ? new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date)
    : "N/A";
}

function formatAuditDate(value) {
  const date = parseAuditDate(value);

  return date
    ? new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }).format(date)
    : "";
}

const auditLogColumns = [
  {
    key: "userId",
    header: "User",
    render: (row) => {
      const userName = row.userName || row.actorName || "Unknown user";
      const userEmail = row.userEmail || "";

      return (
        <div>
          <p className="m-0 font-semibold text-slate-900">{userName}</p>
          {userEmail ? (
            <p className="m-0 mt-1 text-xs text-slate-500">{userEmail}</p>
          ) : null}
        </div>
      );
    },
  },
  {
    key: "time",
    header: "Time",
    render: (row) => (
      <div>
        <p className="m-0 font-semibold text-slate-900">{formatAuditTime(row.createdAt)}</p>
        {formatAuditDate(row.createdAt) ? (
          <p className="m-0 mt-1 text-xs text-slate-500">{formatAuditDate(row.createdAt)}</p>
        ) : null}
      </div>
    ),
  },
  {
    key: "action",
    header: "Action",
    render: (row) => (
      <div>
        <p className="m-0 font-semibold text-slate-900">{row.action || "N/A"}</p>
        {row.summary ? (
          <p className="m-0 mt-1 max-w-[260px] truncate text-xs text-slate-500">{row.summary}</p>
        ) : null}
      </div>
    ),
  },
  {
    key: "ipAddress",
    header: "IP Address",
    cellClassName: "font-mono text-xs text-slate-700",
    render: (row) => row.ipAddress || "N/A",
  },
  {
    key: "location",
    header: "Location",
    render: (row) => (
      <span className="block max-w-[240px] truncate text-sm text-slate-700" title={row.location || "Unknown"}>
        {row.location || "Unknown"}
      </span>
    ),
  },
  {
    key: "device",
    header: "Device",
    render: (row) => row.device || "Unknown",
  },
  {
    key: "browser",
    header: "Browser",
    render: (row) => row.browser || "Unknown",
  },
  {
    key: "os",
    header: "OS",
    render: (row) => row.os || "Unknown",
  },
];

export default function AuditLogsSettings({
  logs = [],
  loading = false,
  message = "",
  messageTone = "info",
  pagination = defaultAuditPagination,
  searchInput = "",
  dateRange = "30d",
  pageSize = 25,
  onSearchInputChange,
  onDateRangeChange,
  onPageSizeChange,
  onRefresh,
  onPreviousPage,
  onNextPage,
}) {
  return (
    <SettingsPanel
      icon={ClipboardList}
      title="Audit Logs"
      description="Review login, logout, and system activity captured by the HRIS audit log table."
      notice={message}
      noticeTone={messageTone}
      actions={
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
          {pagination.total} records
        </span>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="search"
              value={searchInput}
              onChange={onSearchInputChange}
              placeholder="Search user, action, device..."
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pl-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
              aria-label="Search audit logs"
            />
          </div>
          <SettingsSelect
            name="auditDateRange"
            value={dateRange}
            onChange={onDateRangeChange}
            options={auditRangeOptions}
            className="w-full sm:w-[180px]"
          />
          <SettingsSelect
            name="auditPageSize"
            value={pageSize}
            onChange={onPageSizeChange}
            options={auditPageSizeOptions.map((option) => ({ value: option, label: `${option} / page` }))}
            className="w-full sm:w-[140px]"
          />
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={loading} onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        <Table
          columns={auditLogColumns}
          data={logs}
          rowKey="id"
          emptyMessage={loading ? "Loading audit logs..." : "No audit log entries found."}
          stickyHeader
          tableClassName="min-w-[1180px]"
          className="max-h-[620px] rounded-lg border border-slate-200"
        />
        <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 font-semibold">
            Showing {pagination.from}-{pagination.to} of {pagination.total}
          </p>
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            disabled={loading}
            onPageChange={(nextPage) => {
              if (nextPage < pagination.page) {
                onPreviousPage?.();
                return;
              }

              if (nextPage > pagination.page) {
                onNextPage?.();
              }
            }}
          />
        </div>
      </div>
    </SettingsPanel>
  );
}
