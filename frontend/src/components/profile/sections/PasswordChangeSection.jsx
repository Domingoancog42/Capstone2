import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MailCheck,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "react-hot-toast";
import {
  cancelPasswordChange,
  confirmPasswordChange,
  getPasswordChangeStatus,
  requestPasswordChangeCode,
  resendPasswordChangeCode,
} from "../../../services/api";
import { getPasswordPolicyItems } from "../../../utils/passwordPolicy";
import { formatDateTime, formatTimer } from "../../../utils/format";
import { getResponseMessage } from "../../../utils/apiResponse";
import ProfileSectionCard from "../ProfileSectionCard";
import Button from "../../UI/button";

const emptyForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
  code: "",
};

function PasswordInput({ id, label, value, onChange, autoComplete, invalid = false, disabled = false }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-bold text-slate-950">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={invalid}
          className={[
            "h-11 w-full rounded-lg border bg-white pl-3.5 pr-11 text-sm text-slate-900 outline-none transition",
            "focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50",
            invalid
              ? "border-red-300 focus:border-red-400 focus:ring-red-100"
              : "border-slate-200 focus:border-[#D61E1E] focus:ring-[#D61E1E]/10",
          ].join(" ")}
        />
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

/**
 * `variant="dialog"` strips the standalone card chrome (icon badge, own title, border) because the
 * floating card that hosts it already provides all three.
 */
export default function PasswordChangeSection({ variant = "card" }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [resendAvailableInSeconds, setResendAvailableInSeconds] = useState(0);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const result = await getPasswordChangeStatus();
      setStatus(result.passwordChange || null);
    } catch (error) {
      setLoadError(getResponseMessage(error, "Unable to load password settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const pending = status?.pending || null;

  useEffect(() => {
    setExpiresInSeconds(Number(pending?.expiresInSeconds || 0));
    setResendAvailableInSeconds(Number(pending?.resendAvailableInSeconds || 0));
  }, [pending?.expiresInSeconds, pending?.resendAvailableInSeconds]);

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

  const policyItems = useMemo(
    () => getPasswordPolicyItems(form.newPassword),
    [form.newPassword]
  );
  const policySatisfied = policyItems.every((item) => item.satisfied);
  const passwordsMatch = form.newPassword !== "" && form.newPassword === form.confirmPassword;
  const hasExpired = Boolean(pending) && expiresInSeconds <= 0;
  const canResend = resendAvailableInSeconds <= 0 && !actionLoading;
  const lockedForSeconds = Number(status?.lockedForSeconds || 0);

  const setField = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
  }, []);

  const applyResponse = useCallback((result = {}) => {
    if (result.passwordChange) {
      setStatus(result.passwordChange);
    }
  }, []);

  const handleRequestCode = useCallback(async () => {
    if (!form.currentPassword) {
      setFormError("Enter your current password to continue.");
      return;
    }

    setActionLoading("request");
    setFormError("");

    try {
      const result = await requestPasswordChangeCode(form.currentPassword);
      applyResponse(result);
      toast.success(result.message || "Verification code sent.");
    } catch (error) {
      const message = getResponseMessage(error, "Unable to send the verification code.");
      setFormError(message);
      toast.error(message);
    } finally {
      setActionLoading("");
    }
  }, [applyResponse, form.currentPassword]);

  const handleResendCode = useCallback(async () => {
    setActionLoading("resend");
    setFormError("");

    try {
      const result = await resendPasswordChangeCode();
      applyResponse(result);
      toast.success(result.message || "A new verification code was sent.");
    } catch (error) {
      const message = getResponseMessage(error, "Unable to resend the verification code.");
      setFormError(message);
      toast.error(message);
    } finally {
      setActionLoading("");
    }
  }, [applyResponse]);

  const handleConfirm = useCallback(async () => {
    if (form.code.length !== 6) {
      setFormError("Enter the 6-digit verification code.");
      return;
    }

    if (!policySatisfied) {
      setFormError("Your new password does not meet all requirements yet.");
      return;
    }

    if (!passwordsMatch) {
      setFormError("Passwords do not match.");
      return;
    }

    setActionLoading("verify");
    setFormError("");

    try {
      const result = await confirmPasswordChange({
        code: form.code,
        newPassword: form.newPassword,
        confirmPassword: form.confirmPassword,
      });
      applyResponse(result);
      setForm(emptyForm);
      toast.success(result.message || "Password changed successfully.");
    } catch (error) {
      const message = getResponseMessage(error, "Unable to change your password.");
      setFormError(message);
      toast.error(message);
      // A lock or a consumed request changes what the UI may show next.
      if (error?.response?.data?.lockedForSeconds) {
        loadStatus();
      }
    } finally {
      setActionLoading("");
    }
  }, [applyResponse, form, loadStatus, passwordsMatch, policySatisfied]);

  const handleCancel = useCallback(async () => {
    setActionLoading("cancel");

    try {
      const result = await cancelPasswordChange();
      applyResponse(result);
      setForm(emptyForm);
      setFormError("");
    } catch (error) {
      toast.error(getResponseMessage(error, "Unable to cancel the password change."));
    } finally {
      setActionLoading("");
    }
  }, [applyResponse]);

  const body = (
    <>
      {loading ? (
        <div className="grid min-h-[200px] place-items-center rounded-xl border border-slate-200 bg-slate-50">
          <div className="text-center">
            <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={26} />
            <p className="m-0 mt-3 text-sm font-semibold text-slate-600">Loading password settings...</p>
          </div>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 shrink-0 text-[#EF4444]" size={20} aria-hidden="true" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold text-red-700">Unable to load password settings</p>
              <p className="m-0 mt-1 text-sm text-red-600">{loadError}</p>
              <Button variant="secondary" size="sm" className="mt-3" icon={RefreshCcw} onClick={loadStatus}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="m-0 text-[11px] font-bold uppercase text-slate-500">Verification Email</p>
              <p className="m-0 mt-1 truncate text-sm font-extrabold text-slate-950">
                {status?.maskedEmail || "Not available"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="m-0 text-[11px] font-bold uppercase text-slate-500">Last Changed</p>
              <p className="m-0 mt-1 text-sm font-extrabold text-slate-950">
                {formatDateTime(status?.passwordChangedAt, { fallback: "Never" })}
              </p>
            </div>
          </div>

          {lockedForSeconds > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="m-0 text-sm font-semibold text-amber-800">
                Too many incorrect codes. Try again in {formatTimer(lockedForSeconds)}.
              </p>
            </div>
          ) : null}

          {!pending ? (
            <div className="space-y-4">
              <PasswordInput
                id="passwordChangeCurrent"
                label="Current password"
                value={form.currentPassword}
                onChange={(value) => setField("currentPassword", value)}
                autoComplete="current-password"
                invalid={Boolean(formError)}
                disabled={lockedForSeconds > 0}
              />
              <p className="m-0 text-sm leading-6 text-slate-500">
                We will email a 6-digit code to {status?.maskedEmail || "your registered address"} before applying
                any change.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <MailCheck className="mt-0.5 shrink-0 text-emerald-700" size={18} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-bold text-emerald-900">Code sent</p>
                    <p className="m-0 mt-1 break-words text-sm text-emerald-800">
                      Enter the 6-digit code sent to {pending.maskedEmail || status?.maskedEmail || "your email"}.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="passwordChangeCode" className="mb-2 block text-sm font-bold text-slate-950">
                  Verification code
                </label>
                <input
                  id="passwordChangeCode"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={form.code}
                  onChange={(event) => setField("code", event.target.value.replace(/\D+/g, "").slice(0, 6))}
                  className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-center text-lg font-extrabold text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  autoComplete="one-time-code"
                  placeholder="000000"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-[11px] font-bold uppercase text-slate-500">Expires In</p>
                  <p className={`m-0 mt-1 text-xl font-extrabold ${hasExpired ? "text-red-700" : "text-slate-950"}`}>
                    {formatTimer(expiresInSeconds)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-[11px] font-bold uppercase text-slate-500">Attempts Remaining</p>
                  <p className="m-0 mt-1 text-xl font-extrabold text-slate-950">
                    {pending.attemptsRemaining ?? pending.maxAttempts ?? 0}
                  </p>
                </div>
              </div>

              {hasExpired ? (
                <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                  This code has expired. Request a new one to continue.
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <PasswordInput
                  id="passwordChangeNew"
                  label="New password"
                  value={form.newPassword}
                  onChange={(value) => setField("newPassword", value)}
                  autoComplete="new-password"
                />
                <PasswordInput
                  id="passwordChangeConfirm"
                  label="Confirm new password"
                  value={form.confirmPassword}
                  onChange={(value) => setField("confirmPassword", value)}
                  autoComplete="new-password"
                  invalid={form.confirmPassword !== "" && !passwordsMatch}
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-slate-700">
                  <ShieldCheck size={16} />
                  <p className="m-0 text-sm font-bold">Password requirements</p>
                </div>
                <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">
                  {policyItems.map((item) => (
                    <li
                      key={item.key}
                      className={`flex items-center gap-2 text-sm ${item.satisfied ? "text-emerald-700" : "text-slate-500"}`}
                    >
                      <CheckCircle2 size={15} className={item.satisfied ? "text-emerald-600" : "text-slate-300"} />
                      {item.label}
                    </li>
                  ))}
                  <li className={`flex items-center gap-2 text-sm ${passwordsMatch ? "text-emerald-700" : "text-slate-500"}`}>
                    <CheckCircle2 size={15} className={passwordsMatch ? "text-emerald-600" : "text-slate-300"} />
                    Both password fields match
                  </li>
                </ul>
              </div>
            </div>
          )}

          {formError ? (
            <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            {pending ? (
              <button
                type="button"
                onClick={handleCancel}
                disabled={Boolean(actionLoading)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "cancel" ? "Cancelling..." : "Cancel"}
              </button>
            ) : <span />}

            <div className="grid gap-2 sm:flex sm:items-center">
              {pending ? (
                <>
                  <Button
                    variant="secondary"
                    icon={RefreshCcw}
                    onClick={handleResendCode}
                    loading={actionLoading === "resend"}
                    disabled={!canResend}
                  >
                    {resendAvailableInSeconds > 0 ? `Resend in ${formatTimer(resendAvailableInSeconds)}` : "Resend code"}
                  </Button>
                  <Button
                    variant="primary"
                    icon={KeyRound}
                    onClick={handleConfirm}
                    loading={actionLoading === "verify"}
                    disabled={Boolean(actionLoading) || hasExpired}
                  >
                    Change Password
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  icon={KeyRound}
                  onClick={handleRequestCode}
                  loading={actionLoading === "request"}
                  disabled={Boolean(actionLoading) || lockedForSeconds > 0}
                >
                  Send Verification Code
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );

  if (variant === "dialog") {
    return <div className="space-y-5">{body}</div>;
  }

  return (
    <ProfileSectionCard
      icon={KeyRound}
      title="Change Password"
      description="Confirm your current password, then enter the one-time code we email you to set a new password."
    >
      {body}
    </ProfileSectionCard>
  );
}
