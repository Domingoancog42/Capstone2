import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  MailCheck,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { resendTwoFactorCode, verifyTwoFactorCode } from "../../services/api";

function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function challengeState(challenge = {}) {
  return {
    maskedEmail: challenge.maskedEmail || "",
    expiresInSeconds: Math.max(0, Number(challenge.expiresInSeconds) || 0),
    attemptsRemaining: Math.max(0, Number(challenge.attemptsRemaining) || 0),
    maxAttempts: Math.max(0, Number(challenge.maxAttempts) || 0),
    resendDelaySeconds: Math.max(0, Number(challenge.resendDelaySeconds) || 0),
    resendAvailableInSeconds: Math.max(0, Number(challenge.resendAvailableInSeconds) || 0),
  };
}

export default function TwoFactorVerification({
  initialChallenge,
  onBack,
  onVerified,
}) {
  const inputRef = useRef(null);
  const [challenge, setChallenge] = useState(() => challengeState(initialChallenge));
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState("idle");

  useEffect(() => {
    setChallenge(challengeState(initialChallenge));
    setCode("");
    setMessage("");
    setTone("idle");
  }, [initialChallenge]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setChallenge((current) => ({
        ...current,
        expiresInSeconds: Math.max(0, current.expiresInSeconds - 1),
        resendAvailableInSeconds: Math.max(0, current.resendAvailableInSeconds - 1),
      }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const updateFromResponse = (data = {}) => {
    if (data.twoFactor) {
      setChallenge(challengeState(data.twoFactor));
    } else if (Number.isFinite(Number(data.attemptsRemaining))) {
      setChallenge((current) => ({
        ...current,
        attemptsRemaining: Math.max(0, Number(data.attemptsRemaining)),
      }));
    }
  };

  const handleCodeChange = (event) => {
    setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
    setMessage("");
    setTone("idle");
  };

  const handleVerify = async (event) => {
    event.preventDefault();

    if (!/^\d{6}$/.test(code)) {
      setTone("error");
      setMessage("Enter the 6-digit verification code.");
      inputRef.current?.focus();
      return;
    }

    setVerifying(true);
    setMessage("");
    setTone("idle");

    try {
      const result = await verifyTwoFactorCode({ code });
      setTone("success");
      setMessage(result.message || "Verification successful.");
      onVerified?.(result.user);
    } catch (error) {
      const data = error.response?.data || {};
      updateFromResponse(data);
      setTone("error");
      setMessage(data.message || "Unable to verify the code.");
      setCode("");
      inputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (challenge.resendAvailableInSeconds > 0 || resending) {
      return;
    }

    setResending(true);
    setMessage("");
    setTone("idle");

    try {
      const result = await resendTwoFactorCode();
      updateFromResponse(result);
      setCode("");
      setTone("success");
      setMessage(result.message || "A new verification code was sent.");
      inputRef.current?.focus();
    } catch (error) {
      const data = error.response?.data || {};
      updateFromResponse(data);
      setTone("error");
      setMessage(data.message || "Unable to resend the code.");
    } finally {
      setResending(false);
    }
  };

  const expired = challenge.expiresInSeconds <= 0;
  const inputToneClass =
    tone === "error"
      ? "border-rose-300 bg-rose-50 text-rose-900 focus:border-rose-500 focus:ring-rose-100"
      : tone === "success"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900 focus:border-emerald-500 focus:ring-emerald-100"
        : "border-slate-300 bg-white text-slate-950 focus:border-teal-500 focus:ring-teal-100";

  return (
    <motion.section
      aria-labelledby="two-factor-heading"
      className="relative w-full max-w-[420px] overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.10)]"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <div className="h-1 bg-[#D61E1E]" />
      <div className="px-7 pb-7 pt-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-[#F8BFBF] hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
          aria-label="Back to login"
        >
          <ArrowLeft size={18} />
        </button>

        <div className="text-center">
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-teal-100 bg-teal-50 text-teal-800 shadow-inner">
            <div className="relative grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
              <ShieldCheck size={34} />
              <span className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-[#D61E1E] text-white shadow-md">
                <MailCheck size={16} />
              </span>
            </div>
          </div>
          <p className="m-0 mt-5 text-[11px] font-bold uppercase text-slate-500">
            Authorized Access
          </p>
          <h1 id="two-factor-heading" className="m-0 mt-2 text-[26px] font-extrabold leading-tight text-slate-950">
            Security Verification
          </h1>
          <p className="m-0 mt-3 text-sm font-semibold text-slate-500">
            Code sent to:
          </p>
          <p className="m-0 mt-1 break-all text-sm font-extrabold text-slate-900">
            {challenge.maskedEmail || "your registered email"}
          </p>
        </div>

        <form className="mt-6 grid gap-4" onSubmit={handleVerify}>
          <label htmlFor="twoFactorCode" className="block text-center">
            <span className="mb-3 block text-sm font-bold text-slate-800">Enter Verification Code</span>
            <input
              ref={inputRef}
              id="twoFactorCode"
              name="twoFactorCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              value={code}
              onChange={handleCodeChange}
              placeholder="482731"
              disabled={verifying}
              className={`h-16 w-full rounded-xl border px-5 text-center font-mono text-3xl font-extrabold outline-none transition placeholder:text-slate-300 focus:ring-4 ${inputToneClass}`}
            />
          </label>

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <span>Expires in:</span>
              <span className={expired ? "text-rose-700" : "text-slate-950"}>{formatSeconds(challenge.expiresInSeconds)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Attempts Remaining:</span>
              <span className={challenge.attemptsRemaining <= 1 ? "text-rose-700" : "text-slate-950"}>
                {challenge.attemptsRemaining}
              </span>
            </div>
          </div>

          {message ? (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-semibold leading-5 ${
                tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
              role={tone === "success" ? "status" : "alert"}
            >
              <AlertCircle className="mt-0.5 shrink-0" size={15} />
              <span>{message}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={verifying || expired || challenge.attemptsRemaining <= 0}
            className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-md bg-[#D61E1E] px-5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(214,30,30,0.24)] transition hover:bg-[#B41818] focus:outline-none focus:ring-4 focus:ring-[#D61E1E]/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {verifying ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
            {verifying ? "Verifying..." : "Verify"}
          </button>

          <button
            type="button"
            disabled={resending || challenge.resendAvailableInSeconds > 0}
            onClick={handleResend}
            className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:border-[#F8BFBF] hover:bg-[#FEF1F1] hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {resending ? <Loader2 className="animate-spin" size={16} /> : <RotateCw size={16} />}
            {challenge.resendAvailableInSeconds > 0
              ? `Resend Code (${formatSeconds(challenge.resendAvailableInSeconds)})`
              : "Resend Code"}
          </button>
        </form>
      </div>
    </motion.section>
  );
}
