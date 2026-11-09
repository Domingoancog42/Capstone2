import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
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
import {
  getPasswordPolicyItems,
  PASSWORD_POLICY_DEFAULT_MAX_LENGTH,
} from "../../../utils/passwordPolicy";
import { formatDateTime, formatTimer } from "../../../utils/format";
import { getResponseMessage } from "../../../utils/apiResponse";
import ProfileSectionCard from "../ProfileSectionCard";
import Button from "../../UI/button";
import InputField from "../../UI/InputField";

const emptyForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
  code: "",
};

/*
 * Shaped to match `InputField` — same label, height and border — so these sit beside the OTP field
 * below and read as one form, the way the Change Email section does. The reveal toggle is the only
 * thing `InputField` does not offer, which is why this stays a separate component.
 */
function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  invalid = false,
  disabled = false,
  maxLength,
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <div
        className={`relative flex min-h-[40px] items-center rounded-lg border bg-white ${
          invalid ? "border-rose-600" : "border-slate-200"
        }`}
      >
        <input
          id={id}
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={invalid}
          className="w-full rounded-lg bg-transparent py-2.5 pl-3 pr-11 text-slate-900 outline-none transition placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
  const maximumPasswordLength =
    Number(status?.maximumPasswordLength) || PASSWORD_POLICY_DEFAULT_MAX_LENGTH;

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
    () => getPasswordPolicyItems(form.newPassword, { maximumPasswordLength }),
    [form.newPassword, maximumPasswordLength]
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
          {lockedForSeconds > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="m-0 text-sm font-semibold text-amber-800">
                Too many incorrect codes. Try again in {formatTimer(lockedForSeconds)}.
              </p>
            </div>
          ) : null}

          {/*
            * All three fields stay visible at once, like the Change Email form above. The current
            * password locks once a code is out, because that is what the pending request was
            * authorised with; the new pair stays editable, since it is only submitted on confirm.
            */}
          <div className="grid gap-4 lg:grid-cols-3">
            <PasswordInput
              id="passwordChangeCurrent"
              label="Current password"
              value={form.currentPassword}
              onChange={(value) => setField("currentPassword", value)}
              autoComplete="current-password"
              placeholder="Enter current password"
              disabled={lockedForSeconds > 0 || Boolean(pending)}
            />
            <PasswordInput
              id="passwordChangeNew"
              label="New password"
              value={form.newPassword}
              onChange={(value) => setField("newPassword", value)}
              autoComplete="new-password"
              placeholder="Enter new password"
              disabled={lockedForSeconds > 0}
              maxLength={maximumPasswordLength}
            />
            <PasswordInput
              id="passwordChangeConfirm"
              label="Confirm new password"
              value={form.confirmPassword}
              onChange={(value) => setField("confirmPassword", value)}
              autoComplete="new-password"
              placeholder="Re-enter new password"
              invalid={form.confirmPassword !== "" && !passwordsMatch}
              disabled={lockedForSeconds > 0}
              maxLength={maximumPasswordLength}
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            {pending ? (
              <p className="m-0 mb-3 text-sm leading-6 text-slate-600">
                Enter the OTP sent to your registered email{" "}
                <span className="font-semibold text-slate-900">
                  {pending.maskedEmail || status?.maskedEmail || "your email"}
                </span>
                .
              </p>
            ) : (
              <p className="m-0 mb-3 text-sm leading-6 text-slate-600">
                Send a 6-digit OTP to {status?.maskedEmail || "your registered email"}. Your password will not
                change until the OTP is verified.
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-[minmax(0,240px)_auto] sm:items-end sm:justify-start">
              <InputField
                id="passwordChangeCode"
                label="OTP code"
                value={form.code}
                onChange={(event) => setField("code", event.target.value.replace(/\D+/g, "").slice(0, 6))}
                disabled={!pending}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                inputClassName="text-center tracking-[0.4em] font-semibold disabled:cursor-not-allowed disabled:bg-slate-100"
              />
              <Button
                variant="secondary"
                loading={actionLoading === "request" || actionLoading === "resend"}
                disabled={
                  Boolean(actionLoading)
                  || lockedForSeconds > 0
                  || (Boolean(pending) && !canResend && !hasExpired)
                }
                onClick={pending ? handleResendCode : handleRequestCode}
                className="sm:mb-0.5 sm:min-h-[42px]"
              >
                {pending && resendAvailableInSeconds > 0 && !hasExpired
                  ? `Send OTP in ${formatTimer(resendAvailableInSeconds)}`
                  : pending
                    ? "Resend OTP"
                    : "Send OTP"}
              </Button>
            </div>

            {pending ? (
              <p className="m-0 mt-2 text-xs font-semibold text-slate-500">
                {hasExpired
                  ? "This code has expired. Send a new one to continue."
                  : `Code expires in ${formatTimer(expiresInSeconds)}.`}
                {" "}
                {pending.attemptsRemaining ?? pending.maxAttempts ?? 0} attempt
                {(pending.attemptsRemaining ?? pending.maxAttempts ?? 0) === 1 ? "" : "s"} remaining.
              </p>
            ) : null}
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

          {formError ? (
            <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <Button
              variant="primary"
              icon={KeyRound}
              onClick={handleConfirm}
              loading={actionLoading === "verify"}
              disabled={Boolean(actionLoading) || !pending || hasExpired || form.code.length !== 6}
            >
              Change Password
            </Button>

            {pending ? (
              <Button
                variant="ghost"
                loading={actionLoading === "cancel"}
                disabled={Boolean(actionLoading)}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={Boolean(actionLoading)}
                onClick={() => {
                  setForm(emptyForm);
                  setFormError("");
                }}
              >
                Clear
              </Button>
            )}

            <p className="m-0 w-full text-xs font-semibold text-slate-500 sm:ml-auto sm:w-auto">
              Last changed: {formatDateTime(status?.passwordChangedAt, { fallback: "Never" })}
            </p>
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
