
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import {
  Bell,
  ExternalLink,
  Eye,
  Inbox,
  Loader2,
  ShieldCheck,
  X,
  Filter,
  Search,
} from "lucide-react";
import Button from "../UI/button";
import Modal from "../UI/modal";
import NotificationBadge from "../UI/NotificationBadge";
import Pagination from "../UI/Pagination";
import {
  fetchNotifications,
  formatNotificationDateTime,
  formatNotificationRelativeTime,
  getNotificationRoute,
  getNotificationTypeLabel,
  getNotificationsCenterPath,
  getNotificationDateGroupLabel,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsRead,
  normalizeNotificationType,
  NOTIFICATION_BELL_POLL_INTERVAL_MS,
  NOTIFICATIONS_CHANGED_EVENT,
  NOTIFICATION_TYPE_OPTIONS,
  NOTIFICATION_STATUS_OPTIONS,
} from "../../services/notificationService";
import {
  ACCESS_REQUEST_NOTIFICATION_TYPE,
  fetchAccessRequest,
  grantAccessRequest,
} from "../../services/accessRequestService";
import { normalizeRole } from "../../utils/roleRoutes";

function buildNotificationSnippet(message, maxLength = 120) {
  const normalized = String(message || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "No message provided.";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function NotificationStatusChip({ isRead }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
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

export default function NotificationBell({ user, onNavigate, onOpen }) {
  const roleKey = normalizeRole(user?.roleKey || user?.role);
  const centerPath = getNotificationsCenterPath(roleKey);
  const rootRef = useRef(null);
  const mountedRef = useRef(false);
  const selectAllRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailNotification, setDetailNotification] = useState(null);
  const [busyNotificationId, setBusyNotificationId] = useState(0);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [allNotifications, setAllNotifications] = useState([]);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 10,
    total: 0,
    totalPages: 1,
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [accessRequest, setAccessRequest] = useState(null);
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantMessage, setGrantMessage] = useState("");
  const shouldShakeBell = unreadCount > 0 && !open;

  const loadNotifications = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        const response = await fetchNotifications({
          page: 1,
          perPage: 8,
        });

        if (!mountedRef.current) {
          return;
        }

        setNotifications(Array.isArray(response.notifications) ? response.notifications : []);
        setUnreadCount(Number(response.unreadCount) || 0);
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
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, roleKey, user?.id]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    void loadNotifications({ silent: true });
    return undefined;
  }, [loadNotifications, open]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadNotifications({ silent: true });
    };

    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleRefresh);
    window.addEventListener("focus", handleRefresh);
    const refreshIntervalId = window.setInterval(handleRefresh, NOTIFICATION_BELL_POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
      window.clearInterval(refreshIntervalId);
    };
  }, [loadNotifications]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

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

  const closeDropdown = () => {
    setOpen(false);
  };

  const openDropdown = () => {
    onOpen?.();
    setOpen(true);
  };

  const handleToggle = () => {
    if (open) {
      closeDropdown();
      return;
    }

    openDropdown();
  };

  const handleMarkAllRead = async () => {
    if (!unreadCount || markAllLoading) {
      return;
    }

    setMarkAllLoading(true);

    try {
      await markAllNotificationsRead();
      await loadNotifications({ silent: true });
    } finally {
      if (mountedRef.current) {
        setMarkAllLoading(false);
      }
    }
  };

  const markNotificationReadOnly = async (notification) => {
    if (!notification || busyNotificationId === notification.id || notification.isRead) {
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
            : current
        );
      }
    } finally {
      if (mountedRef.current) {
        setBusyNotificationId(0);
      }
    }
  };

  const handleOpenNotification = async (notification) => {
    if (!notification) {
      return;
    }

    closeDropdown();
    onOpen?.();
    setDetailNotification(notification);
    setDetailOpen(true);

    if (!notification.isRead) {
      await markNotificationReadOnly(notification);
    }
  };

  const handleOpenRelatedPage = () => {
    const route = getNotificationRoute(detailNotification || {}, roleKey);

    if (!route) {
      return;
    }

    setDetailOpen(false);
    setDetailNotification(null);
    closeDropdown();
    navigateTo(route);
  };

  const handleViewAll = () => {
    closeDropdown();
    setViewAllOpen(true);
    loadAllNotifications();
  };

  const loadAllNotifications = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setAllLoading(true);
        setAllError("");
      }

      try {
        const response = await fetchNotifications({
          page,
          perPage,
          search: search.trim(),
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

        setAllNotifications(Array.isArray(response.notifications) ? response.notifications : []);
        setPagination({
          page: nextPage,
          perPage: nextPerPage,
          total: nextTotal,
          totalPages: nextTotalPages,
        });
        setSelectedIds([]);
        setAllError("");
      } catch (fetchError) {
        if (!mountedRef.current) {
          return;
        }

        setAllError("Unable to load notifications right now.");
      } finally {
        if (!mountedRef.current) {
          return;
        }

        if (!silent) {
          setAllLoading(false);
        }
      }
    },
    [page, perPage, search, statusFilter, typeFilter]
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
      setSelectedIds(allNotifications.map((notification) => notification.id));
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
      await loadAllNotifications({ silent: true });
      await loadNotifications({ silent: true });
    } finally {
      if (mountedRef.current) {
        setBulkBusy(false);
      }
    }
  };

  const groupedRows = useMemo(() => {
    const rows = [];
    let lastGroup = "";

    allNotifications.forEach((notification) => {
      const groupLabel = getNotificationDateGroupLabel(notification.createdAt);

      if (groupLabel !== lastGroup) {
        rows.push({ type: "group", label: groupLabel });
        lastGroup = groupLabel;
      }

      rows.push({ type: "notification", notification });
    });

    return rows;
  }, [allNotifications]);

  const allSelected = allNotifications.length > 0 && selectedIds.length === allNotifications.length;
  const hasActiveFilters =
    Boolean(search.trim()) || typeFilter !== "all" || statusFilter !== "all" || perPage !== 10;
  const pageStart = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.perPage) + 1;
  const pageEnd = Math.min(pagination.page * pagination.perPage, pagination.total);

  useEffect(() => {
    if (viewAllOpen) {
      void loadAllNotifications();
    }
  }, [viewAllOpen, loadAllNotifications]);

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }

    selectAllRef.current.indeterminate =
      selectedIds.length > 0 && selectedIds.length < allNotifications.length;
  }, [allNotifications.length, selectedIds.length]);

  const latestNotifications = useMemo(() => notifications.slice(0, 8), [notifications]);
  const detailRoute = detailNotification ? getNotificationRoute(detailNotification, roleKey) : "";

  /*
   * Access requests carry the request id in `referenceId`. The row is re-read when the detail modal
   * opens rather than trusted from the notification, because another admin may have granted it in
   * the meantime and the button must not offer to grant something already granted.
   */
  const isAccessRequest =
    roleKey === "admin"
    && normalizeNotificationType(detailNotification?.type) === ACCESS_REQUEST_NOTIFICATION_TYPE;

  useEffect(() => {
    if (!detailOpen || !isAccessRequest) {
      setAccessRequest(null);
      setGrantMessage("");
      return undefined;
    }

    let active = true;
    const requestId = Number(detailNotification?.referenceId);

    if (!requestId) {
      return undefined;
    }

    fetchAccessRequest(requestId)
      .then((request) => {
        if (active) {
          setAccessRequest(request);
        }
      })
      .catch(() => {
        if (active) {
          setAccessRequest(null);
        }
      });

    return () => {
      active = false;
    };
  }, [detailNotification?.referenceId, detailOpen, isAccessRequest]);

  const handleGrantAccess = async () => {
    if (!accessRequest?.id || grantBusy) {
      return;
    }

    setGrantBusy(true);
    setGrantMessage("");

    try {
      const result = await grantAccessRequest(accessRequest.id);
      setAccessRequest(result.request);
      setGrantMessage(result.message || "Access granted.");
      await loadNotifications({ silent: true });
    } catch (grantError) {
      setGrantMessage(
        grantError?.response?.data?.message || "Unable to grant access. Please try again."
      );
    } finally {
      if (mountedRef.current) {
        setGrantBusy(false);
      }
    }
  };

  return (
    <div ref={rootRef} className="relative notification-bell">
      <div className="relative">
        <button
          type="button"
          aria-label="Notifications"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={handleToggle}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
            open
              ? "border-[#D61E1E]/25 bg-[#D61E1E]/10 text-[#D61E1E]"
              : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
          }`}
        >
          <motion.span
            aria-hidden="true"
            className="inline-flex origin-top"
            animate={
              shouldShakeBell
                ? {
                    rotate: [0, -12, 12, -10, 10, 0],
                    x: [0, -1, 1, -1, 1, 0],
                  }
                : { rotate: 0, x: 0 }
            }
            transition={
              shouldShakeBell
                ? {
                    duration: 0.9,
                    repeat: Infinity,
                    repeatDelay: 2.5,
                    ease: "easeInOut",
                  }
                : {
                    duration: 0.15,
                  }
            }
          >
            <Bell size={16} />
          </motion.span>
        </button>
        <NotificationBadge count={unreadCount} tone="bell" />
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="notification-bell-panel absolute right-0 top-[calc(100%+10px)] z-50 w-[350px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.18)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-3.5 py-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[#D61E1E]">
                  Notifications
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {unreadCount > 0
                    ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                    : "All notifications are read"}
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={BeatCheckIcon}
                onClick={handleMarkAllRead}
                disabled={!unreadCount || markAllLoading}
                className="shrink-0"
              >
                {markAllLoading ? "Saving..." : "Mark All as Read"}
              </Button>
            </div>

            <div className="max-h-[28rem] overflow-y-auto">
              {error ? (
                <div className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {loading && latestNotifications.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
                  <Loader2 size={16} className="animate-spin text-[#D61E1E]" />
                  Loading notifications...
                </div>
              ) : null}

              {!loading && latestNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
                    <Inbox size={24} />
                  </span>
                  <p className="mt-4 text-base font-semibold text-slate-900">No notifications yet</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    New alerts will appear here as soon as they are created.
                  </p>
                </div>
              ) : null}

              {latestNotifications.map((notification) => {
                const typeLabel = notification.typeLabel || getNotificationTypeLabel(notification.type);
                const isBusy = busyNotificationId === notification.id;

                return (
                  <div
                    key={notification.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      void handleOpenNotification(notification);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handleOpenNotification(notification);
                      }
                    }}
                    className={`border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50 ${
                      notification.isRead ? "bg-white" : "bg-[#fff7f7]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          notification.isRead ? "bg-slate-300" : "bg-emerald-500"
                        }`}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-[#D61E1E]/10 px-2 py-0.5 text-[11px] font-semibold text-[#D61E1E]">
                                {typeLabel}
                              </span>
                              <NotificationStatusChip isRead={notification.isRead} />
                            </div>
                            <p className="mt-2 text-sm font-semibold leading-5 text-slate-950">
                              {notification.title || "Notification"}
                            </p>
                          </div>

                          <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">
                            {formatNotificationRelativeTime(notification.createdAt)}
                          </span>
                        </div>

                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {buildNotificationSnippet(notification.message)}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            icon={Eye}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleOpenNotification(notification);
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
                            onClick={(event) => {
                              event.stopPropagation();
                              void markNotificationReadOnly(notification);
                            }}
                            disabled={isBusy || notification.isRead}
                            className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            Mark as Read
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-200 p-4">
              <Button
                type="button"
                fullWidth
                variant="primary"
                icon={Bell}
                onClick={handleViewAll}
              >
                View All Notifications
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
            {isAccessRequest && accessRequest ? (
              <Button
                type="button"
                variant="primary"
                icon={ShieldCheck}
                onClick={handleGrantAccess}
                disabled={grantBusy || accessRequest.status === "granted"}
              >
                {accessRequest.status === "granted"
                  ? "Access Granted"
                  : grantBusy
                    ? "Granting..."
                    : `Grant Access to ${accessRequest.moduleLabel}`}
              </Button>
            ) : null}
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
              <span className="rounded-full bg-[#D61E1E]/10 px-3 py-1 text-xs font-semibold text-[#D61E1E]">
                {detailNotification.typeLabel || getNotificationTypeLabel(detailNotification.type)}
              </span>
              <NotificationStatusChip isRead={detailNotification.isRead} />
              {detailRoute ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  Related page available
                </span>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="m-0 text-sm font-semibold text-slate-900">Message</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">
                {detailNotification.message || "No message provided."}
              </p>
            </div>

            {isAccessRequest && accessRequest ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="m-0 text-sm font-semibold text-amber-900">Access request</p>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-amber-700">Requested by</dt>
                    <dd className="m-0 mt-0.5 text-sm text-amber-900">
                      {accessRequest.requesterName}
                      {accessRequest.requesterRole ? ` (${accessRequest.requesterRole})` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-amber-700">Module</dt>
                    <dd className="m-0 mt-0.5 text-sm text-amber-900">{accessRequest.moduleLabel}</dd>
                  </div>
                </dl>
                {accessRequest.status === "granted" ? (
                  <p className="m-0 mt-3 text-sm font-semibold text-emerald-700">
                    Access has been granted.
                  </p>
                ) : null}
                {grantMessage ? (
                  <p className="m-0 mt-2 text-sm text-amber-800">{grantMessage}</p>
                ) : null}
              </div>
            ) : null}

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

      <Modal
        open={viewAllOpen}
        title="All Notifications"
        maxWidth="max-w-[1200px]"
        onClose={() => {
          setViewAllOpen(false);
          setSearch("");
          setTypeFilter("all");
          setStatusFilter("all");
          setPage(1);
          setPerPage(10);
          setSelectedIds([]);
        }}
        footer={(
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
            />
            <Button
              type="button"
              variant="ghost"
              icon={X}
              onClick={() => {
                setViewAllOpen(false);
                setSearch("");
                setTypeFilter("all");
                setStatusFilter("all");
                setPage(1);
                setPerPage(10);
                setSelectedIds([]);
              }}
            >
              Close
            </Button>
          </div>
        )}
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
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

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                icon={BeatCheckIcon}
                onClick={async () => {
                  await handleMarkAllRead();
                  await loadAllNotifications({ silent: true });
                }}
                disabled={!unreadCount || markAllLoading || bulkBusy}
              >
                Mark All as Read
              </Button>

              {selectedIds.length > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  icon={BeatCheckIcon}
                  onClick={handleMarkSelectedRead}
                  disabled={bulkBusy}
                >
                  Mark Selected as Read
                </Button>
              ) : null}
            </div>
          </div>

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

            <div className="min-w-0">
              <label htmlFor="notificationTypeFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Type
              </label>
              <select
                id="notificationTypeFilter"
                value={typeFilter}
                onChange={handleTypeChange}
                className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              >
                {NOTIFICATION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0">
              <label htmlFor="notificationStatusFilter" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Status
              </label>
              <select
                id="notificationStatusFilter"
                value={statusFilter}
                onChange={handleStatusChange}
                className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              >
                {NOTIFICATION_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0">
              <label htmlFor="notificationRowsPerPage" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Rows Per Page
              </label>
              <select
                id="notificationRowsPerPage"
                value={perPage}
                onChange={handlePerPageChange}
                className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10"
              >
                {[10, 20, 50].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-slate-500">
              {pagination.total === 0
                ? "No notifications match your current filters."
                : `Showing ${pageStart}-${pageEnd} of ${pagination.total} notifications.`}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {allLoading && allNotifications.length > 0 ? (
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

          {allError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {allError}
            </div>
          ) : null}

          {allLoading && allNotifications.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <Loader2 size={26} className="animate-spin text-[#D61E1E]" />
              <p className="m-0 text-base font-semibold text-slate-900">Loading notifications...</p>
              <p className="m-0 max-w-md text-sm leading-6 text-slate-500">
                We are fetching the latest activity from your workspace.
              </p>
            </div>
          ) : null}

          {!allLoading && allNotifications.length === 0 ? (
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

          {allNotifications.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
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
                            <span className="inline-flex items-center rounded-full bg-[#D61E1E]/10 px-2.5 py-1 text-xs font-semibold text-[#D61E1E]">
                              {typeLabel}
                            </span>
                          </td>
                          <td className="border-b border-slate-200 px-4 py-4 align-top">
                            <div className="max-w-[220px]">
                              <button
                                type="button"
                                onClick={() => {
                                  void handleOpenNotification(notification);
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
                            <NotificationStatusChip isRead={notification.isRead} />
                          </td>
                          <td className="border-b border-slate-200 px-4 py-4 align-top">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                icon={Eye}
                                onClick={() => {
                                  void handleOpenNotification(notification);
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
                                  void markNotificationReadOnly(notification);
                                  void loadAllNotifications({ silent: true });
                                }}
                                disabled={isBusy || notification.isRead}
                                className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                              >
                                Mark as Read
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
