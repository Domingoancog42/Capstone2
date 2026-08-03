import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle, RefreshCcw } from "lucide-react";
import { toast } from "react-hot-toast";
import Button from "../../UI/button";
import InputField from "../../UI/InputField";
import {
  cancelEmailVerification,
  getEmailVerificationProfile,
  requestEmailChange,
  resendEmailVerificationCode,
  verifyEmailVerificationCode,
} from "../../../services/api";
import { getResponseMessage, getRetryAfterSeconds } from "../../../utils/apiResponse";

/**
 * Compact email-change form for the account card.
 *
 * Two states, one panel: enter the new address, then enter the code that was mailed to it. There is
 * no step rail and no status chrome — the dialog that hosts this already says what it is for.
 */

const emptyForm = { newEmail: "", confirmNewEmail: "" };

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Ticks a second off `seconds` until it reaches zero. */
function useCountdown(seconds, setSeconds) {
  useEffect(() => {
    if (seconds <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [seconds, setSeconds]);
}

export default function ChangeEmailSection({ onUserChange, onDone }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [emailVerification, setEmailVerification] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [resendInSeconds, setResendInSeconds] = useState(0);

  const pending = emailVerification?.pending || null;
  const currentEmail = emailVerification?.currentEmail || "";

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const result = await getEmailVerificationProfile();
      setEmailVerification(result.emailVerification || null);
    } catch (requestError) {
      setLoadError(getResponseMessage(requestError, "Unable to load your email settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    setExpiresInSeconds(Number(pending?.expiresInSeconds || 0));
    setResendInSeconds(Number(pending?.resendAvailableInSeconds || 0));
  }, [pending?.expiresInSeconds, pending?.resendAvailableInSeconds]);

  useCountdown(expiresInSeconds, setExpiresInSeconds);
  useCountdown(resendInSeconds, setResendInSeconds);

  const hasExpired = Boolean(pending) && expiresInSeconds <= 0;

  const setField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const handleSendCode = async () => {
    const newEmail = form.newEmail.trim();
    const confirmNewEmail = form.confirmNewEmail.trim();

    if (!newEmail || !confirmNewEmail) {
      setError("Enter the new email address twice.");
      return;
    }

    if (newEmail.toLowerCase() !== confirmNewEmail.toLowerCase()) {
      setError("The two email addresses do not match.");
      return;
    }

    setActionLoading("request");
    setError("");

    try {
      const result = await requestEmailChange({ newEmail, confirmNewEmail });
      setEmailVerification(result.emailVerification || null);
      setCode("");
      toast.success(`Verification code sent to ${newEmail}.`);
    } catch (requestError) {
      setError(getResponseMessage(requestError, "Unable to send the verification code."));
      setResendInSeconds(getRetryAfterSeconds(requestError));
    } finally {
      setActionLoading("");
    }
  };

  const handleVerify = async () => {
    const trimmedCode = code.trim();

    if (trimmedCode.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }

    setActionLoading("verify");
    setError("");

    try {
      const result = await verifyEmailVerificationCode(trimmedCode);

      if (result.user && onUserChange) {
        onUserChange(result.user);
      }

      toast.success(result.message || "Email updated.");
      setForm(emptyForm);
      setCode("");
      onDone?.();
    } catch (requestError) {
      setError(getResponseMessage(requestError, "Unable to verify the code."));
    } finally {
      setActionLoading("");
    }
  };

  const handleResend = async () => {
    setActionLoading("resend");
    setError("");

    try {
      const result = await resendEmailVerificationCode();
      setEmailVerification(result.emailVerification || null);
      toast.success("A new verification code is on its way.");
    } catch (requestError) {
      setError(getResponseMessage(requestError, "Unable to resend the verification code."));
      setResendInSeconds(getRetryAfterSeconds(requestError));
    } finally {
      setActionLoading("");
    }
  };

  const handleCancel = async () => {
    setActionLoading("cancel");
    setError("");

    try {
      const result = await cancelEmailVerification();
      setEmailVerification(result.emailVerification || null);
      setCode("");
      toast.success("Email change cancelled.");
    } catch (requestError) {
      setError(getResponseMessage(requestError, "Unable to cancel the email change."));
    } finally {
      setActionLoading("");
    }
  };

  const codeHelper = useMemo(() => {
    if (hasExpired) {
      return "This code has expired. Send a new one to continue.";
    }

    return `Code expires in ${formatTimer(expiresInSeconds)}.`;
  }, [expiresInSeconds, hasExpired]);

  if (loading) {
    return (
      <div className="grid min-h-[180px] place-items-center">
        <div className="text-center">
          <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={26} />
          <p className="m-0 mt-3 text-sm font-semibold text-slate-600">Loading email settings...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 shrink-0 text-[#D61E1E]" size={18} aria-hidden="true" />
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-rose-800">Unable to load email settings</p>
            <p className="m-0 mt-1 text-sm text-rose-700">{loadError}</p>
            <Button variant="secondary" size="sm" className="mt-3" icon={RefreshCcw} onClick={loadProfile}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="m-0 text-sm text-slate-500">
        Currently signed in as{" "}
        <span className="font-semibold text-slate-900">{currentEmail || "no email on file"}</span>.
      </p>

      {pending ? (
        <div className="space-y-4">
          <p className="m-0 text-sm leading-6 text-slate-600">
            Enter the 6-digit code sent to{" "}
            <span className="font-semibold text-slate-900">{pending.maskedEmail}</span>.
          </p>

          <InputField
            id="changeEmailCode"
            label="Verification code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              setError("");
            }}
            error={error}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="sm:max-w-[220px]"
            inputClassName="tracking-[0.4em] font-semibold"
          />

          <p className="m-0 text-xs font-semibold text-slate-500">{codeHelper}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={actionLoading === "verify"}
              disabled={Boolean(actionLoading) || hasExpired}
              onClick={handleVerify}
            >
              Update email
            </Button>
            <Button
              variant="secondary"
              loading={actionLoading === "resend"}
              disabled={Boolean(actionLoading) || (resendInSeconds > 0 && !hasExpired)}
              onClick={handleResend}
            >
              {resendInSeconds > 0 && !hasExpired ? `Resend in ${formatTimer(resendInSeconds)}` : "Resend code"}
            </Button>
            <Button
              variant="ghost"
              loading={actionLoading === "cancel"}
              disabled={Boolean(actionLoading)}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <InputField
            id="changeEmailNew"
            label="New email address"
            type="email"
            value={form.newEmail}
            onChange={setField("newEmail")}
            autoComplete="email"
            placeholder="name@example.com"
          />

          <InputField
            id="changeEmailConfirm"
            label="Confirm new email address"
            type="email"
            value={form.confirmNewEmail}
            onChange={setField("confirmNewEmail")}
            error={error}
            autoComplete="email"
            placeholder="name@example.com"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={actionLoading === "request"}
              disabled={Boolean(actionLoading)}
              onClick={handleSendCode}
            >
              Send verification code
            </Button>
            <Button
              variant="ghost"
              disabled={Boolean(actionLoading)}
              onClick={() => {
                setForm(emptyForm);
                setError("");
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
