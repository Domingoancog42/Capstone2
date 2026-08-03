import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  History,
  Inbox,
  LockKeyhole,
  LoaderCircle,
  Mail,
  MailCheck,
  RefreshCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import {
  cancelEmailVerification,
  getEmailVerificationProfile,
  requestCurrentEmailVerification,
  requestEmailChange,
  resendEmailVerificationCode,
  verifyEmailVerificationCode,
} from "../../../services/api";
import Button from "../../UI/button";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailHistoryStoragePrefix = "hris_email_verification_history";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDate(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "Not available";
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "Not available";
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimer(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function getResponseMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function getEmailHistoryStorageKey(user) {
  const identity = String(user?.id || user?.employee_id || user?.username || user?.email || "profile").trim();
  return `${emailHistoryStoragePrefix}:${identity || "profile"}`;
}

function readEmailHistory(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEmailHistory(storageKey, rows) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(rows));
  } catch {
    // The drawer can still show the live session history when local storage is unavailable.
  }
}

function statusBadgeClasses(status) {
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus.includes("verified") || normalizedStatus.includes("success")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalizedStatus.includes("pending")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (normalizedStatus.includes("expired")) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-600";
}

function StatusBadge({ status, icon: Icon }) {
  return (
    <span className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${statusBadgeClasses(status)}`}>
      {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {status}
    </span>
  );
}

/**
 * Card chrome for the standalone layout; a transparent pass-through inside a floating card, whose
 * own border and padding would otherwise double up on this one.
 */
function Shell({ isDialog, children }) {
  if (isDialog) {
    return <div className="flex flex-col">{children}</div>;
  }

  return (
    <section className="rounded-[10px] border border-emerald-100 bg-emerald-50/35 p-3 shadow-sm sm:p-5">
      <div className="mx-auto max-w-[560px] overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-sm">
        {children}
      </div>
    </section>
  );
}

function EmailHistoryDrawer({ open, rows, onClose }) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        // z-80 keeps the drawer above the profile floating card (z-70) that can host this section.
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="email-history-title">
          <motion.button
            type="button"
            className="absolute inset-0 border-0 bg-slate-950/40"
            aria-label="Close email history"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col border-l border-slate-200 bg-white shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5">
              <div>
                <p className="m-0 text-xs font-bold uppercase tracking-normal text-[#B22222]">Email Activity</p>
                <h2 id="email-history-title" className="m-0 mt-1 text-xl font-bold text-slate-950">Email History</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">Review recent email change requests and verification results.</p>
              </div>
              <Button variant="icon" size="sm" icon={X} onClick={onClose} aria-label="Close email history" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {rows.length === 0 ? (
                <div className="grid min-h-[360px] place-items-center rounded-[10px] border border-dashed border-slate-300 bg-[#F8FAFC] p-5 text-center">
                  <div>
                    <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
                      <Inbox size={28} aria-hidden="true" />
                    </span>
                    <p className="m-0 mt-4 text-base font-bold text-slate-900">No email changes have been made yet.</p>
                    <p className="m-0 mt-2 text-sm text-slate-500">New email updates will appear here after a change request.</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[10px] border border-slate-200">
                  <table className="min-w-full border-collapse bg-white text-left text-sm">
                    <thead className="bg-[#F8FAFC] text-xs font-bold uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Previous Email</th>
                        <th className="px-4 py-3">New Email</th>
                        <th className="px-4 py-3">Changed By</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row) => (
                        <tr key={row.id} className="align-top">
                          <td className="px-4 py-3 font-semibold text-slate-700">{row.previousEmail || "Not available"}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 font-semibold text-slate-950">
                              <ArrowRight size={15} className="text-slate-400" aria-hidden="true" />
                              <span>{row.newEmail || "Not available"}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{row.changedBy || "Current user"}</td>
                          <td className="px-4 py-3 text-slate-600">{formatDateTime(row.date)}</td>
                          <td className="px-4 py-3"><StatusBadge status={row.status || "Pending"} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * `variant="dialog"` strips the standalone card chrome (tinted frame, fixed width, own title) because
 * the floating card that hosts it already provides all three.
 */
export default function EmailVerificationSection({
  user = null,
  onUserChange,
  onEmailChanged,
  variant = "card",
}) {
  const historyStorageKey = useMemo(() => getEmailHistoryStorageKey(user), [user]);
  const changedBy = String(user?.full_name || user?.username || "Current user").trim();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [emailVerification, setEmailVerification] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [changeForm, setChangeForm] = useState({
    newEmail: "",
    confirmNewEmail: "",
    reason: "",
    notify: true,
  });
  const [changeErrors, setChangeErrors] = useState({});
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [resendAvailableInSeconds, setResendAvailableInSeconds] = useState(0);
  const [successNotice, setSuccessNotice] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [pendingHistoryId, setPendingHistoryId] = useState(null);

  const persistHistory = useCallback((updater) => {
    setHistoryRows((current) => {
      const nextRows = typeof updater === "function" ? updater(current) : updater;
      const normalizedRows = Array.isArray(nextRows) ? nextRows.slice(0, 30) : [];
      writeEmailHistory(historyStorageKey, normalizedRows);
      return normalizedRows;
    });
  }, [historyStorageKey]);

  const addHistoryRow = useCallback((row) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    persistHistory((current) => [
      {
        id,
        previousEmail: row.previousEmail || "",
        newEmail: row.newEmail || "",
        changedBy: row.changedBy || changedBy,
        date: row.date || new Date().toISOString(),
        status: row.status || "Pending",
        reason: row.reason || "",
      },
      ...current,
    ]);
    return id;
  }, [changedBy, persistHistory]);

  const updateHistoryRow = useCallback((id, updates) => {
    if (!id) {
      return false;
    }

    let updated = false;
    persistHistory((current) => current.map((row) => {
      if (row.id !== id) {
        return row;
      }

      updated = true;
      return { ...row, ...updates };
    }));
    return updated;
  }, [persistHistory]);

  const loadEmailVerification = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const result = await getEmailVerificationProfile();
      setEmailVerification(result.emailVerification || null);
    } catch (error) {
      setLoadError(getResponseMessage(error, "Unable to load email verification details."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setHistoryRows(readEmailHistory(historyStorageKey));
  }, [historyStorageKey]);

  useEffect(() => {
    loadEmailVerification();
  }, [loadEmailVerification]);

  const pending = emailVerification?.pending || null;
  const currentEmail = emailVerification?.currentEmail || user?.email || "";
  const isVerified = Boolean(emailVerification?.isVerified ?? user?.isEmailVerified);
  const statusLabel = emailVerification?.statusLabel || (isVerified ? "Verified" : "Pending Verification");
  const lastUpdated = emailVerification?.emailUpdatedAt || user?.emailUpdatedAt || user?.email_updated_at || "";
  const lastVerification = emailVerification?.emailVerifiedAt || user?.emailVerifiedAt || user?.email_verified_at || "";

  useEffect(() => {
    setExpiresInSeconds(Number(pending?.expiresInSeconds || 0));
    setResendAvailableInSeconds(Number(pending?.resendAvailableInSeconds || 0));
  }, [pending?.expiresAt, pending?.expiresInSeconds, pending?.resendAvailableInSeconds]);

  useEffect(() => {
    if (!pending || expiresInSeconds <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setExpiresInSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [expiresInSeconds, pending]);

  useEffect(() => {
    if (resendAvailableInSeconds <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setResendAvailableInSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [resendAvailableInSeconds]);

  const updateFromResponse = useCallback((result = {}) => {
    if (result.emailVerification) {
      setEmailVerification(result.emailVerification);
    }

    if (result.user) {
      onUserChange?.(result.user);
    }

    const nextEmail = result.emailVerification?.currentEmail || result.user?.email || "";
    if (nextEmail) {
      onEmailChanged?.(nextEmail);
    }
  }, [onEmailChanged, onUserChange]);

  const validateChangeForm = () => {
    const newEmail = normalizeEmail(changeForm.newEmail);
    const confirmNewEmail = normalizeEmail(changeForm.confirmNewEmail);
    const nextErrors = {};

    if (!newEmail) {
      nextErrors.newEmail = "New email is required.";
    } else if (!emailPattern.test(newEmail)) {
      nextErrors.newEmail = "Enter a valid email address.";
    } else if (newEmail === normalizeEmail(currentEmail)) {
      nextErrors.newEmail = "New email cannot match your current email.";
    }

    if (!confirmNewEmail) {
      nextErrors.confirmNewEmail = "Confirm the new email address.";
    } else if (newEmail !== confirmNewEmail) {
      nextErrors.confirmNewEmail = "Email addresses must match.";
    }

    return {
      errors: nextErrors,
      values: { newEmail, confirmNewEmail },
    };
  };

  const clearChangeForm = () => {
    setChangeForm({ newEmail: "", confirmNewEmail: "", reason: "", notify: true });
    setChangeErrors({});
    setSuccessNotice(null);
  };

  const openVerifyModal = () => {
    setVerifyCode("");
    setVerifyError("");
  };

  const handleRequestChange = async () => {
    const validation = validateChangeForm();
    setChangeErrors(validation.errors);

    if (Object.keys(validation.errors).length > 0) {
      return;
    }

    setActionLoading("request_change");
    setSuccessNotice(null);

    try {
      const previousEmail = currentEmail;
      const result = await requestEmailChange(validation.values);
      updateFromResponse(result);

      const historyId = addHistoryRow({
        previousEmail,
        newEmail: validation.values.newEmail,
        changedBy,
        status: "Pending",
        reason: changeForm.reason,
      });
      setPendingHistoryId(historyId);

      openVerifyModal();
      toast.success(result.message || "Verification code sent.");
    } catch (error) {
      const message = getResponseMessage(error, "Unable to send the verification code.");
      const status = error?.response?.status;

      setChangeErrors((current) => ({
        ...current,
        ...(status === 409 || status === 422 ? { newEmail: message } : { form: message }),
      }));
      toast.error(message);

      if (error?.response?.data?.emailVerification) {
        setEmailVerification(error.response.data.emailVerification);
      }
    } finally {
      setActionLoading("");
    }
  };

  const handleRequestCurrentVerification = async () => {
    if (isVerified && !pending) {
      return;
    }

    setActionLoading("request_current");
    setVerifyError("");
    setSuccessNotice(null);

    try {
      const result = pending
        ? await resendEmailVerificationCode()
        : await requestCurrentEmailVerification();
      updateFromResponse(result);

      if (result.emailVerification?.pending || result.pending) {
        openVerifyModal();
      }

      toast.success(result.message || "Verification code sent.");
    } catch (error) {
      const message = getResponseMessage(error, "Unable to send the verification email.");
      toast.error(message);

      if (error?.response?.data?.emailVerification) {
        setEmailVerification(error.response.data.emailVerification);
      }
    } finally {
      setActionLoading("");
    }
  };

  const handleResendCode = async () => {
    setActionLoading("resend");
    setVerifyError("");

    try {
      const result = await resendEmailVerificationCode();
      updateFromResponse(result);
      setVerifyCode("");
      toast.success(result.message || "A new verification code was sent.");
    } catch (error) {
      const message = getResponseMessage(error, "Unable to resend the verification code.");
      setVerifyError(message);
      toast.error(message);

      if (error?.response?.data?.emailVerification) {
        setEmailVerification(error.response.data.emailVerification);
      }
    } finally {
      setActionLoading("");
    }
  };

  const handleVerifyCode = async () => {
    const cleanCode = verifyCode.replace(/\D+/g, "").slice(0, 6);

    if (!/^\d{6}$/.test(cleanCode)) {
      setVerifyError("Enter the 6-digit verification code.");
      return;
    }

    setActionLoading("verify");
    setVerifyError("");
    setSuccessNotice(null);

    try {
      const previousEmail = currentEmail;
      const result = await verifyEmailVerificationCode(cleanCode);
      updateFromResponse(result);
      setVerifyCode("");

      const nextEmail = result.emailVerification?.currentEmail || result.user?.email || "";
      const emailChanged = nextEmail && normalizeEmail(nextEmail) !== normalizeEmail(previousEmail);
      const successTitle = emailChanged ? "Email Updated Successfully" : "Email Verified Successfully";
      const successDescription = emailChanged
        ? "Your email has been verified and updated."
        : "Your registered email has been verified.";

      if (emailChanged) {
        const updated = updateHistoryRow(pendingHistoryId, {
          newEmail: nextEmail,
          date: new Date().toISOString(),
          status: "Verified",
        });

        if (!updated) {
          addHistoryRow({
            previousEmail,
            newEmail: nextEmail,
            changedBy,
            status: "Verified",
          });
        }
      } else if (pendingHistoryId) {
        updateHistoryRow(pendingHistoryId, {
          date: new Date().toISOString(),
          status: "Verified",
        });
      }

      setPendingHistoryId(null);
      setSuccessNotice({
        title: successTitle,
        description: successDescription,
      });

      toast.success(result.message || successTitle);
    } catch (error) {
      const message = getResponseMessage(error, "Unable to verify the code.");
      setVerifyError(message);

      if (error?.response?.data?.emailVerification) {
        setEmailVerification(error.response.data.emailVerification);
      }

      toast.error(message);
    } finally {
      setActionLoading("");
    }
  };

  const handleCancelVerification = async () => {
    if (!pending) {
      setVerifyCode("");
      setVerifyError("");
      return;
    }

    setActionLoading("cancel");

    try {
      const result = await cancelEmailVerification();
      updateFromResponse(result);
      updateHistoryRow(pendingHistoryId, {
        date: new Date().toISOString(),
        status: "Failed",
      });
      setPendingHistoryId(null);
      setVerifyCode("");
      setVerifyError("");
      toast.success(result.message || "Email verification cancelled.");
    } catch (error) {
      const message = getResponseMessage(error, "Unable to cancel email verification.");
      setVerifyError(message);
      toast.error(message);
    } finally {
      setActionLoading("");
    }
  };

  const maskedEmail = pending?.maskedEmail || "";
  const attemptsRemaining = Number(pending?.attemptsRemaining ?? 0);
  const isRequestingChange = actionLoading === "request_change";
  const isRequestingCurrent = actionLoading === "request_current";
  const isVerifying = actionLoading === "verify";
  const isResending = actionLoading === "resend";
  const isCancelling = actionLoading === "cancel";
  const canResend = resendAvailableInSeconds <= 0 && !isResending && !isVerifying && !isCancelling;
  const hasExpired = Boolean(pending && expiresInSeconds <= 0);
  const verificationStatusText = pending ? "Code Sent" : statusLabel;
  const activeStep = successNotice ? 3 : pending ? 2 : 1;
  const stepCopy = {
    1: "Enter your new email address",
    2: "Verify the 6-digit code",
    3: "Email updated",
  };
  const steps = [
    { number: 1, title: "New Email", helper: "Enter & confirm" },
    { number: 2, title: "Verify OTP", helper: "6-digit code" },
    { number: 3, title: "Done", helper: "Email updated" },
  ];

  const isDialog = variant === "dialog";

  return (
    <>
      <Shell isDialog={isDialog}>
          <div className={isDialog ? "px-5 pb-1 sm:px-4" : "px-5 py-5 sm:px-4"}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {isDialog ? null : (
                  <div className="flex items-center gap-2">
                    <Mail className="shrink-0 text-emerald-600" size={18} aria-hidden="true" />
                    <h3 className="m-0 text-base font-bold text-slate-950">Email Configuration</h3>
                  </div>
                )}
                <p className={`m-0 text-sm text-slate-600 ${isDialog ? "" : "mt-3"}`.trim()}>
                  Step {activeStep} of 3 - {stepCopy[activeStep]}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                onClick={() => setHistoryOpen(true)}
                aria-label="View email history"
                title="View email history"
              >
                <History size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 flex min-h-[36px] flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <LockKeyhole className="shrink-0 text-slate-500" size={15} aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase text-slate-500">Current</span>
                <span className="truncate font-mono text-sm font-bold text-slate-950">{currentEmail || "No email on file"}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={verificationStatusText} icon={isVerified ? MailCheck : Clock3} />
                {!isVerified && !pending ? (
                  <button
                    type="button"
                    className="inline-flex min-h-8 items-center justify-center rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleRequestCurrentVerification}
                    disabled={Boolean(actionLoading)}
                  >
                    {isRequestingCurrent ? "Sending..." : "Verify"}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="relative mt-5 px-1">
              <div className="absolute left-[14%] right-[14%] top-[20px] hidden h-px bg-slate-100 sm:block" aria-hidden="true" />
              <div className="relative grid grid-cols-3 gap-2">
                {steps.map((step) => {
                  const isActive = step.number === activeStep;
                  const isComplete = step.number < activeStep || (step.number === 3 && activeStep === 3);

                  return (
                    <div key={step.number} className="text-center">
                      <span
                        className={`mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition ${
                          isActive
                            ? "border-emerald-300 bg-white text-emerald-700 shadow-[0_0_0_4px_rgba(110,231,183,0.28)]"
                            : isComplete
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-100 bg-slate-50 text-slate-500"
                        }`}
                      >
                        {step.number}
                      </span>
                      <p className="m-0 mt-2 text-xs font-bold text-slate-950">{step.title}</p>
                      <p className="m-0 text-[10px] leading-tight text-slate-500">{step.helper}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        {loading ? (
          <div className="grid min-h-[260px] place-items-center border-t border-slate-200 bg-white">
            <div className="text-center">
              <LoaderCircle className="mx-auto animate-spin text-emerald-600" size={28} />
              <p className="m-0 mt-3 text-sm font-semibold text-slate-600">Loading email details...</p>
            </div>
          </div>
        ) : loadError ? (
          <div className="border-t border-slate-200 bg-white p-5">
            <div className="rounded-[10px] border border-red-200 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 text-[#EF4444]" size={20} aria-hidden="true" />
              <div className="min-w-0">
                <p className="m-0 text-sm font-bold text-red-700">Unable to load email verification details</p>
                <p className="m-0 mt-1 text-sm text-red-600">{loadError}</p>
                <Button variant="secondary" size="sm" className="mt-3" icon={RefreshCcw} onClick={loadEmailVerification}>
                  Retry
                </Button>
              </div>
            </div>
            </div>
          </div>
        ) : activeStep === 2 ? (
          <>
            <div className="border-t border-slate-200 bg-white px-5 py-5 sm:px-4">
              <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <MailCheck className="mt-0.5 shrink-0 text-emerald-700" size={18} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-bold text-emerald-900">Code sent</p>
                    <p className="m-0 mt-1 break-words text-sm text-emerald-800">
                      Enter the 6-digit code sent to {maskedEmail || "the selected email address"}.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <label htmlFor="emailVerificationCode" className="mb-2 block text-sm font-bold text-slate-950">
                  Verification code
                </label>
                <input
                  id="emailVerificationCode"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(event) => {
                    setVerifyCode(event.target.value.replace(/\D+/g, "").slice(0, 6));
                    setVerifyError("");
                  }}
                  className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-center text-lg font-extrabold text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  aria-invalid={Boolean(verifyError)}
                  autoComplete="one-time-code"
                  placeholder="000000"
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-[11px] font-bold uppercase text-slate-500">Expires In</p>
                  <p className={`m-0 mt-1 text-xl font-extrabold ${hasExpired ? "text-red-700" : "text-slate-950"}`}>
                    {formatTimer(expiresInSeconds)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-[11px] font-bold uppercase text-slate-500">Attempts Remaining</p>
                  <p className="m-0 mt-1 text-xl font-extrabold text-slate-950">{attemptsRemaining}</p>
                </div>
              </div>

              {hasExpired ? (
                <p className="m-0 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                  Verification code has expired. Please request a new code.
                </p>
              ) : null}

              {verifyError ? (
                <p className="m-0 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {verifyError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-transparent px-4 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleCancelVerification}
                disabled={isVerifying || isResending}
              >
                {isCancelling ? "Cancelling..." : "Cancel"}
              </button>
              <div className="grid gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleResendCode}
                  disabled={!canResend || !pending}
                >
                  <RefreshCcw size={16} aria-hidden="true" />
                  {isResending ? "Sending..." : resendAvailableInSeconds > 0 ? `Resend (${resendAvailableInSeconds}s)` : "Resend code"}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#6ED1B7] bg-[#6ED1B7] px-5 text-sm font-bold text-white shadow-sm transition hover:border-[#58bfa5] hover:bg-[#58bfa5] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleVerifyCode}
                  disabled={verifyCode.length !== 6 || hasExpired || isResending || isCancelling}
                >
                  <MailCheck size={16} aria-hidden="true" />
                  {isVerifying ? "Verifying..." : "Verify code"}
                </button>
              </div>
            </div>
          </>
        ) : activeStep === 3 ? (
          <>
            <div className="border-t border-slate-200 bg-white px-5 py-5 text-center sm:px-4">
              <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                <CheckCircle2 size={28} aria-hidden="true" />
              </span>
              <h4 className="m-0 mt-4 text-lg font-bold text-slate-950">{successNotice?.title || "Email Updated Successfully"}</h4>
              <p className="m-0 mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
                {successNotice?.description || "Your admin contact email is now up to date."}
              </p>
              <div className="mx-auto mt-5 max-w-sm rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left">
                <p className="m-0 text-[11px] font-bold uppercase text-slate-500">Current email</p>
                <p className="m-0 mt-1 break-all font-mono text-sm font-bold text-slate-950">{currentEmail || "No email on file"}</p>
                <p className="m-0 mt-2 text-xs text-slate-500">Last verified {formatDate(lastVerification || lastUpdated)}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-transparent px-4 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-slate-700"
                onClick={() => setHistoryOpen(true)}
              >
                View history
              </button>
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#6ED1B7] bg-[#6ED1B7] px-5 text-sm font-bold text-white shadow-sm transition hover:border-[#58bfa5] hover:bg-[#58bfa5]"
                onClick={clearChangeForm}
              >
                Change another email
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="border-t border-slate-200 bg-white px-5 py-5 sm:px-4">
              <div className="space-y-4">
                <div>
                  <label htmlFor="newEmail" className="mb-2 block text-sm font-bold text-slate-950">
                    New email address
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} aria-hidden="true" />
                    <input
                      id="newEmail"
                      name="newEmail"
                      type="email"
                      value={changeForm.newEmail}
                      onChange={(event) => {
                        setChangeForm((current) => ({ ...current, newEmail: event.target.value }));
                        setChangeErrors((current) => ({ ...current, newEmail: "", form: "" }));
                      }}
                      placeholder="new.admin@company.com"
                      autoComplete="email"
                      className={`h-9 w-full rounded-lg border bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 ${
                        changeErrors.newEmail ? "border-red-300" : "border-slate-200"
                      }`}
                    />
                  </div>
                  {changeErrors.newEmail ? <p className="m-0 mt-1.5 text-sm text-red-700">{changeErrors.newEmail}</p> : null}
                </div>

                <div>
                  <label htmlFor="confirmNewEmail" className="mb-2 block text-sm font-bold text-slate-950">
                    Confirm new email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} aria-hidden="true" />
                    <input
                      id="confirmNewEmail"
                      name="confirmNewEmail"
                      type="email"
                      value={changeForm.confirmNewEmail}
                      onChange={(event) => {
                        setChangeForm((current) => ({ ...current, confirmNewEmail: event.target.value }));
                        setChangeErrors((current) => ({ ...current, confirmNewEmail: "", form: "" }));
                      }}
                      placeholder="Re-enter new.admin@company.com"
                      autoComplete="email"
                      className={`h-9 w-full rounded-lg border bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 ${
                        changeErrors.confirmNewEmail ? "border-red-300" : "border-slate-200"
                      }`}
                    />
                  </div>
                  {changeErrors.confirmNewEmail ? <p className="m-0 mt-1.5 text-sm text-red-700">{changeErrors.confirmNewEmail}</p> : null}
                </div>

                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={17} aria-hidden="true" />
                    <div>
                      <p className="m-0 text-sm font-bold text-emerald-900">Why we verify</p>
                      <p className="m-0 mt-1 text-sm leading-5 text-slate-600">
                        We send a one-time code to the new address to make sure you control it before switching the admin contact.
                      </p>
                    </div>
                  </div>
                </div>

                {changeErrors.form ? (
                  <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {changeErrors.form}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-transparent px-4 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={clearChangeForm}
                disabled={isRequestingChange}
              >
                Clear
              </button>
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#6ED1B7] bg-[#6ED1B7] px-5 text-sm font-bold text-white shadow-sm transition hover:border-[#58bfa5] hover:bg-[#58bfa5] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleRequestChange}
                disabled={Boolean(actionLoading)}
              >
                {isRequestingChange ? "Sending..." : "Send verification code"}
                {!isRequestingChange ? <ArrowRight size={16} aria-hidden="true" /> : null}
              </button>
            </div>
          </>
        )}
      </Shell>

      <EmailHistoryDrawer
        open={historyOpen}
        rows={historyRows}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  );
}
