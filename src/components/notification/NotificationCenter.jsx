import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import {
  ExternalLink,
  Eye,
  Filter,
  Inbox,
  Loader2,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import Button from "../UI/button";
import Card, { CardContent, CardDescription, CardHeader, CardTitle } from "../UI/card";
import Modal from "../UI/modal";
import NotificationTypeChip from "./NotificationTypeChip";
import Pagination from "../UI/Pagination";
import RecordCards from "../UI/RecordCards";
import {
  fetchNotifications,
  formatNotificationDateTime,
  formatNotificationRelativeTime,
  getNotificationDateGroupLabel,
  getNotificationRoute,
  getNotificationTypeLabel,
  isSecurityNotificationType,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_STATUS_OPTIONS,
  NOTIFICATION_TYPE_OPTIONS,
  markNotificationsRead,
  NOTIFICATION_BELL_POLL_INTERVAL_MS,
  NOTIFICATIONS_CHANGED_EVENT,
} from "../../services/notificationService";
import { resolveUserRoleKey } from "../../utils/roleRoutes";

function buildNotificationSnippet(message, maxLength = 160) {
  const normalized = String(message || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "No message provided.";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function StatusChip({ isRead }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        isRead
          ? "bg-slate-100 text-slate-600"
          : "bg-emerald-100 text-emerald-700"
      }`}
    >
      {isRead ? "Read" : "Unread"}
    </span>
  );
}

function BeatCheckIcon() {
  return <FontAwesomeIcon icon={faCheck} beat className="text-[14px]" aria-hidden="true" />;
}

function SelectField({ id, label, value, onChange, children }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={onChange}
        className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
      >
        {children}
      </select>
    </div>
  );
}

export default function NotificationCenter({ user, onNavigate }) {
  const roleKey = resolveUserRoleKey(user);
  const mountedRef = useRef(false);
  const selectAllRef = useRef(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [notifications, setNotifications] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 10,
    total: 0,
    totalPages: 1,
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailNotification, setDetailNotification] = useState(null);
  const [busyNotificationId, setBusyNotificationId] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadNotifications = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await fetchNotifications({
          page,
          perPage,
          search: deferredSearch.trim(),
          type: typeFilter,
          status: statusFilter,
        });

        if (!mountedRef.current) {
          return;
        }

        const nextPagination = response.pagination || {};
        const nextPage = Number(nextPagination.page) || page;
        const nextPerPage = Number(nextPagination.perPage) || perPage;
        const nextTotal = Number(nextPagination.total) || 0;
        const nextTotalPages = Math.max(1, Number(nextPagination.totalPages) || 1);

        if (nextTotal > 0 && page > nextTotalPages) {
          setPage(nextTotalPages);
          return;
        }

        setNotifications(Array.isArray(response.notifications) ? response.notifications : []);
        setUnreadCount(Number(response.unreadCount) || 0);
        setPagination({
          page: nextPage,
          perPage: nextPerPage,
          total: nextTotal,
          totalPages: nextTotalPages,
        });
        setSelectedIds([]);
        setError("");
      } catch (fetchError) {
        if (!mountedRef.current) {
          return;
        }

        setError("Unable to load notifications right now.");
      } finally {
        if (!mountedRef.current) {
          return;
        }

        if (!silent) {
          setLoading(false);
        }
      }
    },
    [deferredSearch, page, perPage, statusFilter, typeFilter]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadNotifications({ silent: true });
    };

    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleRefresh);
    window.addEventListener("focus", handleRefresh);
    const intervalId = window.setInterval(handleRefresh, NOTIFICATION_BELL_POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(intervalId);
    };
  }, [loadNotifications]);

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }

    selectAllRef.current.indeterminate =
      selectedIds.length > 0 && selectedIds.length < notifications.length;
  }, [notifications.length, selectedIds.length]);

  const groupedRows = useMemo(() => {
    const rows = [];
    let lastGroup = "";

    notifications.forEach((notification) => {
      const groupLabel = getNotificationDateGroupLabel(notification.createdAt);

      if (groupLabel !== lastGroup) {
        rows.push({ type: "group", label: groupLabel });
        lastGroup = groupLabel;
      }

      rows.push({ type: "notification", notification });
    });

    return rows;
  }, [notifications]);

  /*
   * The same notifications for the card view, each carrying the date group it belongs to. A card
   * grid has no row to put a group header in, so the label rides along on the card instead.
   */
  const cardRows = useMemo(() => (
    notifications.map((notification) => ({
      notification,
      groupLabel: getNotificationDateGroupLabel(notification.createdAt),
    }))
  ), [notifications]);

  const allSelected = notifications.length > 0 && selectedIds.length === notifications.length;
  const hasActiveFilters =
    Boolean(deferredSearch.trim()) || typeFilter !== "all" || statusFilter !== "all" || perPage !== 10;
  const pageStart = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.perPage) + 1;
  const pageEnd = Math.min(pagination.page * pagination.perPage, pagination.total);
  const detailRoute = detailNotification ? getNotificationRoute(detailNotification, roleKey) : "";
  const isSecurityAlert = isSecurityNotificationType(detailNotification?.type);

  const navigateTo = useCallback(
    (path) => {
      if (!path) {
        return;
      }

      if (onNavigate) {
        onNavigate(path);
        return;
      }

      if (typeof window !== "undefined") {
        window.location.assign(path);
      }
    },
    [onNavigate]
  );

  const handleSearchChange = (event) => {
    setSearch(event.target.value);
    setPage(1);
  };

  const handleTypeChange = (event) => {
    setTypeFilter(event.target.value);
    setPage(1);
  };

  const handleStatusChange = (event) => {
    setStatusFilter(event.target.value);
    setPage(1);
  };

  const handlePerPageChange = (event) => {
    const nextValue = Number(event.target.value);
    setPerPage(Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 10);
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
    setPerPage(10);
    setPage(1);
  };

  const handleToggleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(notifications.map((notification) => notification.id));
      return;
    }

    setSelectedIds([]);
  };

  const handleToggleSelected = (notificationId, checked) => {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(notificationId) ? current : [...current, notificationId];
      }

      return current.filter((id) => id !== notificationId);
    });
  };

  const handleMarkSelectedRead = async () => {
    if (!selectedIds.length || bulkBusy) {
      return;
    }

    setBulkBusy(true);

    try {
      await markNotificationsRead(selectedIds);
      await loadNotifications({ silent: true });
    } finally {
      if (mountedRef.current) {
        setBulkBusy(false);
      }
    }
  };

  const markNotificationAsRead = async (notification) => {
    if (!notification || busyNotificationId === notification.id) {
      return;
    }

    if (notification.isRead) {
      setDetailNotification(notification);
      setDetailOpen(true);
      return;
    }

    setBusyNotificationId(notification.id);

    try {
      await markNotificationRead(notification.id);
      await loadNotifications({ silent: true });
      if (mountedRef.current) {
        setDetailNotification((current) =>
          current && current.id === notification.id
            ? { ...current, isRead: true }
            : notification
        );
      }
    } finally {
      if (mountedRef.current) {
        setBusyNotificationId(0);
      }
    }
  };

  const handleViewNotification = async (notification) => {
    if (!notification) {
      return;
    }

    setDetailNotification(notification);
    setDetailOpen(true);
    await markNotificationAsRead(notification);
  };

  const handleMarkAllRead = async () => {
    if (!unreadCount || bulkBusy) {
      return;
    }

    setBulkBusy(true);

    try {
      await markAllNotificationsRead();
      await loadNotifications({ silent: true });
    } finally {
      if (mountedRef.current) {
        setBulkBusy(false);
      }
    }
  };

  const handleOpenRelatedPage = () => {
    if (!detailRoute) {
      return;
    }

    setDetailOpen(false);
    setDetailNotification(null);
    navigateTo(detailRoute);
  };

  /* The row's two buttons, shared by the table and by the narrow-screen cards. */
  const renderNotificationActions = (notification, isBusy) => (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        icon={Eye}
        onClick={() => {
          void handleViewNotification(notification);
        }}
        disabled={isBusy}
      >
        View
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        icon={BeatCheckIcon}
        onClick={() => {
          void markNotificationAsRead(notification);
        }}
        disabled={isBusy || notification.isRead}
        className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
      >
        Mark as Read
      </Button>
    </>
  );

  return (
    <div className="notification-center-page w-full">
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-lg">Notifications</CardTitle>
            <CardDescription>
              Search, filter, and review alerts from across your workspace.
            </CardDescription>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-[#D61E1E]/10 px-3 py-1 text-xs font-semibold text-[#D61E1E]">
                {unreadCount} unread
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {pagination.total} total
              </span>
              {selectedIds.length > 0 ? (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {selectedIds.length} selected
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                icon={BeatCheckIcon}
                onClick={handleMarkAllRead}
                disabled={!unreadCount || bulkBusy}
              >
                Mark All as Read
              </Button>

            {selectedIds.length > 0 ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  icon={BeatCheckIcon}
                  onClick={handleMarkSelectedRead}
                  disabled={bulkBusy}
                >
                  Mark Selected as Read
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,260px)_160px_150px_120px]">
            <div className="min-w-0">
              <label htmlFor="notificationSearch" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Search Notifications
              </label>
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  id="notificationSearch"
                  type="search"
                  value={search}
                  onChange={handleSearchChange}
                  placeholder="Search title, message, or type"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
                />
              </div>
            </div>

            <SelectField id="notificationTypeFilter" label="Type" value={typeFilter} onChange={handleTypeChange}>
              {NOTIFICATION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>

            <SelectField id="notificationStatusFilter" label="Status" value={statusFilter} onChange={handleStatusChange}>
              {NOTIFICATION_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>

            <SelectField id="notificationRowsPerPage" label="Rows Per Page" value={perPage} onChange={handlePerPageChange}>
              {[10, 20, 50].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-slate-500">
              {pagination.total === 0
                ? "No notifications match your current filters."
                : `Showing ${pageStart}-${pageEnd} of ${pagination.total} notifications.`}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {loading && notifications.length > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  <Loader2 size={14} className="animate-spin text-[#D61E1E]" />
                  Refreshing
                </span>
              ) : null}

              {hasActiveFilters ? (
                <Button type="button" variant="ghost" icon={Filter} onClick={handleClearFilters}>
                  Reset Filters
                </Button>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {loading && notifications.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <Loader2 size={26} className="animate-spin text-[#D61E1E]" />
              <p className="m-0 text-base font-semibold text-slate-900">Loading notifications...</p>
              <p className="m-0 max-w-md text-sm leading-6 text-slate-500">
                We are fetching the latest activity from your workspace.
              </p>
            </div>
          ) : null}

          {!loading && notifications.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-slate-400 shadow-sm">
                <Inbox size={24} />
              </span>
              <p className="m-0 text-base font-semibold text-slate-900">No notifications found</p>
              <p className="m-0 max-w-md text-sm leading-6 text-slate-500">
                Try changing the search or filters to reveal more notifications.
              </p>
              {hasActiveFilters ? (
                <Button type="button" variant="secondary" icon={Filter} onClick={handleClearFilters}>
                  Clear Filters
                </Button>
              ) : null}
            </div>
          ) : null}

          {notifications.length > 0 ? (
            <>
              {/*
                * Cards below `lg`, table from `lg` up. The table's date group headers are rows of
                * their own, which a card grid has no place for, so each card carries its group
                * label in the eyebrow instead — the grouping survives, it just moves.
                */}
              <RecordCards
                className="lg:hidden"
                items={cardRows}
                itemKey={(entry) => entry.notification.id}
                renderCard={({ notification, groupLabel }) => {
                  const isBusy = busyNotificationId === notification.id || bulkBusy;

                  return {
                    eyebrow: (
                      <span className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${notification.title || "notification"}`}
                          checked={selectedIds.includes(notification.id)}
                          onChange={(event) => handleToggleSelected(notification.id, event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-[#D61E1E] focus:ring-[#D61E1E]"
                        />
                        <span>{groupLabel}</span>
                      </span>
                    ),
                    title: (
                      <button
                        type="button"
                        onClick={() => {
                          void handleViewNotification(notification);
                        }}
                        className="text-left text-sm font-semibold leading-6 text-slate-950 transition hover:text-[#D61E1E]"
                      >
                        {notification.title || "Notification"}
                      </button>
                    ),
                    subtitle: formatNotificationRelativeTime(notification.createdAt),
                    badge: <StatusChip isRead={notification.isRead} />,
                    fields: [
                      {
                        label: "Type",
                        value: (
                          <NotificationTypeChip
                            type={notification.type}
                            label={notification.typeLabel || getNotificationTypeLabel(notification.type)}
                          />
                        ),
                      },
                      { label: "Message", value: buildNotificationSnippet(notification.message), full: true },
                    ],
                    actions: renderNotificationActions(notification, isBusy),
                  };
                }}
              />

              <div className="hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
                <div className="overflow-x-auto">
                  <table className="min-w-[1120px] w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border-b border-slate-200 px-4 py-3 text-left text-[0.82rem] font-extrabold uppercase text-slate-700">
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            checked={allSelected}
                            onChange={(event) => handleToggleSelectAll(event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-[#D61E1E] focus:ring-[#D61E1E]"
                          />
                        </th>
                        <th className="border-b border-slate-200 px-4 py-3 text-left text-[0.82rem] font-extrabold uppercase text-slate-700">
                          Type
                        </th>
                        <th className="border-b border-slate-200 px-4 py-3 text-left text-[0.82rem] font-extrabold uppercase text-slate-700">
                          Title
                        </th>
                        <th className="border-b border-slate-200 px-4 py-3 text-left text-[0.82rem] font-extrabold uppercase text-slate-700">
                          Message
                        </th>
                        <th className="border-b border-slate-200 px-4 py-3 text-left text-[0.82rem] font-extrabold uppercase text-slate-700">
                          Date
                        </th>
                        <th className="border-b border-slate-200 px-4 py-3 text-left text-[0.82rem] font-extrabold uppercase text-slate-700">
                          Status
                        </th>
                        <th className="border-b border-slate-200 px-4 py-3 text-left text-[0.82rem] font-extrabold uppercase text-slate-700">
                          Actions
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {groupedRows.map((entry, index) => {
                        if (entry.type === "group") {
                          return (
                            <tr key={`group-${entry.label}-${index}`}>
                              <td
                                colSpan={7}
                                className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500"
                              >
                                {entry.label}
                              </td>
                            </tr>
                          );
                        }

                        const notification = entry.notification;
                        const isBusy = busyNotificationId === notification.id || bulkBusy;
                        const typeLabel = notification.typeLabel || getNotificationTypeLabel(notification.type);

                        return (
                          <tr
                            key={notification.id}
                            className={`transition hover:bg-slate-50 ${
                              notification.isRead ? "bg-white" : "bg-[#fff7f7]"
                            }`}
                          >
                            <td className="border-b border-slate-200 px-4 py-4 align-top">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(notification.id)}
                                onChange={(event) => handleToggleSelected(notification.id, event.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-[#D61E1E] focus:ring-[#D61E1E]"
                              />
                            </td>
                            <td className="border-b border-slate-200 px-4 py-4 align-top">
                              <NotificationTypeChip type={notification.type} label={typeLabel} />
                            </td>
                            <td className="border-b border-slate-200 px-4 py-4 align-top">
                              <div className="max-w-[220px]">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleViewNotification(notification);
                                  }}
                                  className="text-left text-sm font-semibold leading-6 text-slate-950 transition hover:text-[#D61E1E]"
                                >
                                  {notification.title || "Notification"}
                                </button>
                              </div>
                            </td>
                            <td className="border-b border-slate-200 px-4 py-4 align-top">
                              <p className="m-0 max-w-[360px] text-sm leading-6 text-slate-600">
                                {buildNotificationSnippet(notification.message)}
                              </p>
                            </td>
                            <td className="border-b border-slate-200 px-4 py-4 align-top">
                              <time
                                title={formatNotificationDateTime(notification.createdAt)}
                                className="whitespace-nowrap text-sm font-medium text-slate-700"
                              >
                                {formatNotificationRelativeTime(notification.createdAt)}
                              </time>
                            </td>
                            <td className="border-b border-slate-200 px-4 py-4 align-top">
                              <StatusChip isRead={notification.isRead} />
                            </td>
                            <td className="border-b border-slate-200 px-4 py-4 align-top">
                              <div className="flex flex-wrap gap-2">
                                {renderNotificationActions(notification, isBusy)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-sm text-slate-500">
                  Showing {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.perPage + 1}
                  {" "}to {Math.min(pagination.page * pagination.perPage, pagination.total)} of {pagination.total} notifications
                </p>

                <Pagination
                  currentPage={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setPage}
                />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={detailOpen}
        title={detailNotification?.title || "Notification Details"}
        maxWidth="max-w-[680px]"
        onClose={() => {
          setDetailOpen(false);
          setDetailNotification(null);
        }}
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-3">
            {detailRoute ? (
              <Button
                type="button"
                variant="secondary"
                icon={ExternalLink}
                onClick={handleOpenRelatedPage}
              >
                Open Related Page
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              icon={X}
              onClick={() => {
                setDetailOpen(false);
                setDetailNotification(null);
              }}
            >
              Close
            </Button>
          </div>
        )}
      >
        {detailNotification ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <NotificationTypeChip
                type={detailNotification.type}
                label={detailNotification.typeLabel || getNotificationTypeLabel(detailNotification.type)}
              />
              <StatusChip isRead={detailNotification.isRead} />
              {detailRoute ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  Related page available
                </span>
              ) : null}
            </div>

            {/*
              * The security alerts arrive as a summary line followed by `Label: value` lines -- the
              * account, the IP address it was attacked from, and where that address resolves to --
              * so the body is rendered pre-wrapped and left exactly as the server composed it.
              */}
            <div
              className={`rounded-2xl border px-4 py-3 ${
                isSecurityAlert
                  ? "border-[#B0161B]/30 bg-[#fdf2f2]"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <p
                className={`m-0 flex items-center gap-2 text-sm font-semibold ${
                  isSecurityAlert ? "text-[#B0161B]" : "text-slate-900"
                }`}
              >
                {isSecurityAlert ? <ShieldAlert size={16} aria-hidden="true" /> : null}
                {isSecurityAlert ? "Security alert" : "Message"}
              </p>
              <p
                className={`mt-2 whitespace-pre-wrap text-sm leading-7 ${
                  isSecurityAlert ? "text-[#7C1416]" : "text-slate-600"
                }`}
              >
                {detailNotification.message || "No message provided."}
              </p>
              {isSecurityAlert ? (
                <p className="m-0 mt-3 text-sm leading-6 text-[#7C1416]">
                  The account unlocks by itself when the lockout expires. Open User Management to
                  release it sooner, or to deactivate it if the attempts did not come from its owner.
                </p>
              ) : null}
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-semibold text-slate-500">Date</dt>
                <dd className="m-0 mt-1 text-sm text-slate-900">
                  {formatNotificationDateTime(detailNotification.createdAt) || "Unknown"}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
