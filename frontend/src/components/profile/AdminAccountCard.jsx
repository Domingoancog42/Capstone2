import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Info,
  LoaderCircle,
  Mail,
  MailCheck,
  PencilLine,
  RefreshCcw,
  X,
} from "lucide-react";
import { getAuditLogs, getEmployees } from "../../services/api";
import Button from "../UI/button";
import ProfileFloatingCard from "./ProfileFloatingCard";
import ChangeEmailSection from "./sections/ChangeEmailSection";
import PasswordChangeSection from "./sections/PasswordChangeSection";
import { findEmployeeForUser, resolveInitials } from "./profileUtils";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

/**
 * Floating account card opened from the header's Profile action.
 *
 * It carries only three account-level tabs: Profile, Password, and History. Address, Government
 * IDs, Employment Status, Emergency Contact, E-Signature, Security, and Service Record are
 * deliberately absent — those are personnel records that stay on the full profile page, not
 * settings you manage from a card. The account details are read-only apart from the email
 * address, which opens the verification flow from a pencil beside its value.
 */
const ACCOUNT_TABS = [
  { id: "profile", label: "Profile" },
  { id: "password", label: "Password" },
  { id: "history", label: "History" },
];

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(String(value).replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatAction(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function DetailField({ label, value, loading = false, action = null }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-sm text-slate-500">{label}</p>
      {/* A value still in flight would otherwise read as a confident "Not set". */}
      {loading && !value ? (
        <span className="mt-2 block h-4 w-24 animate-pulse rounded bg-slate-200" aria-hidden="true" />
      ) : (
        <div className="mt-1 flex items-start gap-2">
          <p className="m-0 min-w-0 break-words text-base font-semibold text-slate-900">
            {value || "Not set"}
          </p>
          {action}
        </div>
      )}
    </div>
  );
}

function PanelHeading({ title, description }) {
  return (
    <div>
      <h3 className="m-0 text-lg font-semibold text-slate-950">{title}</h3>
      {description ? (
        <p className="m-0 mt-1.5 text-sm leading-6 text-slate-500">{description}</p>
      ) : null}
    </div>
  );
}

function PanelMessage({ tone = "info", title, description, action }) {
  const isWarning = tone === "warning";
  const toneClasses = isWarning
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : "border-slate-200 bg-slate-50 text-slate-700";
  const ToneIcon = isWarning ? AlertTriangle : Info;

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <div className="flex items-start gap-3">
        <ToneIcon className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
        <div className="min-w-0">
          <p className="m-0 text-sm font-bold">{title}</p>
          {description ? <p className="m-0 mt-1 text-sm leading-6">{description}</p> : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function PanelLoader({ label }) {
  return (
    <div className="grid min-h-[180px] place-items-center rounded-xl border border-slate-200 bg-slate-50">
      <div className="text-center">
        <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={26} />
        <p className="m-0 mt-3 text-sm font-semibold text-slate-600">{label}</p>
      </div>
    </div>
  );
}

export default function AdminAccountCard({ open, onClose, user, onUserChange, employees = [] }) {
  const headingId = useId();
  const [activeTab, setActiveTab] = useState("profile");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [employeeRecord, setEmployeeRecord] = useState(null);
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [employeeError, setEmployeeError] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const fullName = user?.full_name || user?.username || "User";
  const roleLabel = user?.roleLabel || user?.role || "User";
  const profileImageUrl = resolveBackendAssetUrl(user?.profile_image || user?.profileImage);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      // The email dialog stacks on top and closes itself on Escape; without this guard one
      // keypress would dismiss both cards at once.
      if (event.key === "Escape" && !emailDialogOpen) {
        onClose?.();
      }
    };

    // Locking the page keeps the card from scrolling the dashboard behind it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [emailDialogOpen, onClose, open]);

  // Every open starts on Profile, the way the card reads in the reference.
  useEffect(() => {
    if (open) {
      setActiveTab("profile");
    } else {
      setEmailDialogOpen(false);
    }
  }, [open]);

  const loadEmployeeRecord = useCallback(async () => {
    setEmployeeLoading(true);
    setEmployeeError("");

    try {
      const roster = employees.length > 0
        ? employees
        : (await getEmployees()).employees || [];
      setEmployeeRecord(findEmployeeForUser(roster, user));
    } catch (error) {
      setEmployeeRecord(null);
      setEmployeeError(
        error?.response?.data?.message || error?.message || "Unable to load your account details."
      );
    } finally {
      setEmployeeLoading(false);
    }
  }, [employees, user]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadEmployeeRecord();
  }, [loadEmployeeRecord, open]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const result = await getAuditLogs({
        search: user?.email || user?.username || "",
        range: "all",
        perPage: 25,
      });
      const rows = Array.isArray(result?.auditLogs) ? result.auditLogs : [];
      const accountId = Number(user?.id) || 0;
      // The search is a broad LIKE across names and emails, so keep only this account's own rows.
      const ownRows = accountId > 0 ? rows.filter((row) => Number(row.userId) === accountId) : rows;

      setHistory(ownRows);
    } catch (error) {
      setHistory([]);
      setHistoryError(
        error?.response?.data?.message || error?.message || "Unable to load account history."
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!open || activeTab !== "history") {
      return;
    }

    void loadHistory();
  }, [activeTab, loadHistory, open]);

  const accountDetails = useMemo(
    () => [
      { label: "Full name", value: fullName },
      { label: "Role", value: roleLabel },
      {
        label: "Email address",
        value: user?.email,
        action: (
          <button
            type="button"
            onClick={() => setEmailDialogOpen(true)}
            aria-label="Change email address"
            title="Change email address"
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#F8BFBF] hover:bg-[#FEF1F1] hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
          >
            <PencilLine size={14} aria-hidden="true" />
          </button>
        ),
      },
      { label: "Phone number", value: employeeRecord?.phone },
      { label: "Division", value: user?.division || employeeRecord?.department },
      { label: "Position", value: user?.designation || employeeRecord?.position },
    ],
    [employeeRecord, fullName, roleLabel, user]
  );

  const renderProfileTab = () => (
    <div className="space-y-5">
      <PanelHeading
        title="Account details"
        description="Managed by your administrator. Contact HR to have any of these details updated."
      />

      {employeeError ? (
        <PanelMessage
          tone="warning"
          title="Some details could not be loaded"
          description={employeeError}
          action={(
            <Button variant="secondary" size="sm" icon={RefreshCcw} onClick={loadEmployeeRecord}>
              Retry
            </Button>
          )}
        />
      ) : null}

      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {accountDetails.map((item) => (
          <DetailField
            key={item.label}
            label={item.label}
            value={item.value}
            loading={employeeLoading}
            action={item.action}
          />
        ))}
      </div>
    </div>
  );

  const renderHistoryTab = () => (
    <div className="space-y-5">
      <PanelHeading
        title="Account history"
        description="Recent sign-ins and account changes recorded for this login."
      />

      {historyLoading ? (
        <PanelLoader label="Loading account history..." />
      ) : historyError ? (
        <PanelMessage
          tone="warning"
          title="Unable to load account history"
          description={historyError}
          action={(
            <Button variant="secondary" size="sm" icon={RefreshCcw} onClick={loadHistory}>
              Retry
            </Button>
          )}
        />
      ) : history.length === 0 ? (
        <PanelMessage
          title="No activity recorded yet"
          description="Sign-ins and account changes will appear here once they are logged."
        />
      ) : (
        <ul className="m-0 list-none divide-y divide-slate-100 rounded-xl border border-slate-200 p-0">
          {history.map((entry) => (
            <li
              key={entry.id}
              className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4"
            >
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold text-slate-900">
                  {formatAction(entry.action) || "Account activity"}
                </p>
                {entry.summary ? (
                  <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{entry.summary}</p>
                ) : null}
                <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                  {[entry.ipAddress, entry.location, entry.browser || entry.device]
                    .filter(Boolean)
                    .join(" - ") || "Unknown device"}
                </p>
              </div>
              <p className="m-0 whitespace-nowrap text-xs font-semibold text-slate-500 sm:text-right">
                {formatDateTime(entry.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
    <AnimatePresence>
      {open ? (
        <div
          className="admin-account-card fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <motion.button
            type="button"
            aria-label="Close account card"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 border-0 bg-slate-950/55 backdrop-blur-[2px]"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="relative z-10 my-auto flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_30px_80px_rgba(2,6,23,0.45)]"
          >
            <div className="h-1 shrink-0 bg-gradient-to-r from-[#D61E1E] via-[#d13a3a] to-[#D61E1E]" />

            <header className="shrink-0 px-5 pt-5 sm:px-6">
              <div className="flex items-start gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[#F8BFBF] bg-[#FEF1F1] text-base font-bold text-[#D61E1E]">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt={fullName} className="h-full w-full object-cover" />
                  ) : (
                    resolveInitials(fullName)
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <h2 id={headingId} className="m-0 truncate text-xl font-bold tracking-tight text-slate-950">
                    {fullName}
                  </h2>
                  <p className="m-0 mt-0.5 truncate text-sm text-slate-500">{roleLabel}</p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close account card"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[#F8BFBF] hover:bg-[#FEF1F1] hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <div
                role="tablist"
                aria-label="Account sections"
                className="mt-5 flex gap-5 overflow-x-auto border-b border-slate-200"
              >
                {ACCOUNT_TABS.map((tab) => {
                  const isActive = tab.id === activeTab;

                  return (
                    <button
                      key={tab.id}
                      id={`${headingId}-tab-${tab.id}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`${headingId}-panel`}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative whitespace-nowrap pb-3 text-sm font-semibold transition ${
                        isActive ? "text-slate-950" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {tab.label}
                      {isActive ? (
                        <motion.span
                          layoutId="admin-account-tab-indicator"
                          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#D61E1E]"
                          transition={{ type: "spring", stiffness: 380, damping: 34 }}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </header>

            <div
              id={`${headingId}-panel`}
              role="tabpanel"
              aria-labelledby={`${headingId}-tab-${activeTab}`}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6"
            >
              {activeTab === "profile" ? renderProfileTab() : null}
              {activeTab === "password" ? <PasswordChangeSection variant="dialog" /> : null}
              {activeTab === "history" ? renderHistoryTab() : null}
            </div>
          </motion.section>
        </div>
      ) : null}
    </AnimatePresence>

    {/* Stacks above the account card; its own backdrop and Escape handling take over while open. */}
    <ProfileFloatingCard
      open={open && emailDialogOpen}
      onClose={() => setEmailDialogOpen(false)}
      icon={Mail}
      badge={MailCheck}
      title="Change Email Address"
      subtitle="Enter the address you want to use, then confirm the code we mail to it."
      maxWidth="max-w-[520px]"
      bodyClassName="px-5 pb-5 sm:px-6"
    >
      <ChangeEmailSection onUserChange={onUserChange} onDone={() => setEmailDialogOpen(false)} />
    </ProfileFloatingCard>
    </>
  );
}
