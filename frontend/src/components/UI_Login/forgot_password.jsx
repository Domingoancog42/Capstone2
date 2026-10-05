import React, { useEffect, useState } from "react";
import { ArrowLeft, Check, KeyRound, Mail, RotateCw, Send, ShieldCheck } from "lucide-react";
import { forgotPassword, resetPassword, verifyPasswordResetCode } from "../../services/api";
import {
  evaluatePasswordPolicy,
  PASSWORD_POLICY_DEFAULT_MAX_LENGTH,
} from "../../utils/passwordPolicy";
import AuthAlert from "./ui/AuthAlert";
import AuthButton from "./ui/AuthButton";
import AuthCard from "./ui/AuthCard";
import AuthField, { PasswordField } from "./ui/AuthField";
import { AUTH_LABEL_CLASS, cx, getStrengthTone } from "./ui/authTheme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const STEPS = [
  { key: "request", label: "Email" },
  { key: "verify", label: "Verify" },
  { key: "password", label: "Password" },
];

const TOTAL_STEPS = STEPS.length;

/** How long Resend code stays locked after a code goes out, so the inbox has time to receive it. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Only the server can tell whether a password is the one already on the account -- the browser has
 * nothing to compare against -- so this arrives as a rejected submit. Once it has, the password that
 * was refused is remembered for the rest of the attempt, and typing it again fails immediately under
 * the field instead of costing another round trip to be told the same thing.
 */
const PASSWORD_IN_USE_MESSAGE = "This password is currently in use. Please choose a new password.";

/** One word instead of a sentence — the meter colour already carries the rest. */
const STRENGTH_WORD = {
  idle: "",
  weak: "Weak",
  medium: "Fair",
  strong: "Strong",
};

/**
 * Terse chip labels for the strength meter.
 *
 * `getPasswordPolicyItems()` returns sentence-length labels ("Contains at least one letter") built
 * for a full-page checklist. The upper bound is left out on purpose: the input's `maxLength` makes
 * it unreachable, so showing it is a rule the user can never fail.
 */
function policyChips(policy) {
  return [
    { key: "minLength", label: `${policy.minimumPasswordLength}+ chars`, satisfied: policy.minLength },
    { key: "letter", label: "Letter", satisfied: policy.letter },
    { key: "number", label: "Number", satisfied: policy.number },
    { key: "symbol", label: "Symbol", satisfied: policy.symbol },
  ];
}

/** Three-step account recovery: request a code, verify it, then reveal the password form. */
export default function ForgotPassword({ onBack, onResetSuccess, securitySettings = {} }) {
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState("request");
  const [passwordInUse, setPasswordInUse] = useState("");
  const [isPasswordFieldActive, setIsPasswordFieldActive] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendAvailableInSeconds, setResendAvailableInSeconds] = useState(0);

  useEffect(() => {
    if (resendAvailableInSeconds <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setResendAvailableInSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [resendAvailableInSeconds]);

  const maximumPasswordLength =
    Number(securitySettings.maximumPasswordLength) || PASSWORD_POLICY_DEFAULT_MAX_LENGTH;
  const passwordPolicy = evaluatePasswordPolicy(password, { maximumPasswordLength });
  const chips = policyChips(passwordPolicy);
  const hasPasswordInput = password.length > 0;
  const trimmedIdentifier = identifier.trim();
  const passwordIsInUse = hasPasswordInput && password === passwordInUse;

  const clearFeedback = () => {
    setError("");
    setMessage("");
  };

  const handleRequestCode = async (event) => {
    event.preventDefault();

    if (!trimmedIdentifier) {
      setError("Email is required.");
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedIdentifier)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    clearFeedback();

    try {
      const result = await forgotPassword({ identifier: trimmedIdentifier });
      setResendAvailableInSeconds(RESEND_COOLDOWN_SECONDS);
      setStep("verify");
      setCode("");
      setPassword("");
      setConfirmPassword("");
      // A fresh code may well be for a different account, whose current password this is not.
      setPasswordInUse("");
      setIsPasswordFieldActive(false);
      setMessage(result.message || "Code sent. Check your inbox and spam folder.");
    } catch (requestError) {
      setError(
        requestError.code === "ECONNABORTED"
          ? "Request timed out. Check the SMTP settings and try again."
          : requestError.response?.data?.message || "Unable to send the reset code."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();

    if (!trimmedIdentifier) {
      setError("Email is required.");
      setStep("request");
      return;
    }

    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }

    setLoading(true);
    clearFeedback();

    try {
      const result = await verifyPasswordResetCode({
        identifier: trimmedIdentifier,
        code,
      });
      setPassword("");
      setConfirmPassword("");
      setPasswordInUse("");
      setIsPasswordFieldActive(false);
      setStep("password");
      setMessage(result.message || "Code verified. Create your new password.");
    } catch (requestError) {
      const rejection = requestError.response?.data;

      if (rejection?.codeExhausted) {
        setCode("");
      }

      setError(rejection?.message || "Unable to verify the reset code.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();

    if (!trimmedIdentifier) {
      setError("Email is required.");
      return;
    }

    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }

    if (!password) {
      setError("New password is required.");
      return;
    }

    if (!passwordPolicy.isValid) {
      setError("Password does not meet the requirements below.");
      return;
    }

    if (passwordIsInUse) {
      setError(PASSWORD_IN_USE_MESSAGE);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    clearFeedback();

    try {
      const result = await resetPassword({
        identifier: trimmedIdentifier,
        code,
        password,
        confirmPassword,
      });
      const successMessage = result.message || "Password reset. You can sign in now.";

      if (typeof onResetSuccess === "function") {
        onResetSuccess({ identifier: trimmedIdentifier, message: successMessage });
        return;
      }

      setPassword("");
      setConfirmPassword("");
      setCode("");
      setIsPasswordFieldActive(false);
      setStep("request");
      setMessage(successMessage);
    } catch (requestError) {
      const rejection = requestError.response?.data;

      // Remembered so the same password fails under the field on the next keystroke, not on the next submit.
      if (rejection?.field === "password") {
        setPasswordInUse(password);
      }

      // A code can expire after the verification step, so return to the code screen if that happens.
      if (rejection?.codeInvalid) {
        setCode("");
        setPassword("");
        setConfirmPassword("");
        setPasswordInUse("");
        setIsPasswordFieldActive(false);
        setStep("verify");
      }

      setError(rejection?.message || "Unable to reset the password.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendAvailableInSeconds > 0 || resending) {
      return;
    }

    if (!trimmedIdentifier) {
      setError("Email is required.");
      setStep("request");
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedIdentifier)) {
      setError("Enter a valid email address.");
      setStep("request");
      return;
    }

    setResending(true);
    clearFeedback();

    try {
      const result = await forgotPassword({ identifier: trimmedIdentifier });
      setResendAvailableInSeconds(RESEND_COOLDOWN_SECONDS);
      setCode("");
      setPassword("");
      setConfirmPassword("");
      setPasswordInUse("");
      setIsPasswordFieldActive(false);
      setStep("verify");
      setMessage(result.message || "A new reset code was sent. Check your inbox and spam folder.");
    } catch (requestError) {
      const rejection = requestError.response?.data;
      const retryAfter = Math.max(0, Number(rejection?.retryAfter) || 0);

      // Rate limited: the button stays locked for as long as the server will refuse it anyway.
      if (rejection?.reason === "rate_limited" && retryAfter > 0) {
        setResendAvailableInSeconds((current) => Math.max(current, retryAfter));
      }

      setError(
        requestError.code === "ECONNABORTED"
          ? "Request timed out. Check the SMTP settings and try again."
          : requestError.response?.data?.message || "Unable to resend the reset code."
      );
    } finally {
      setResending(false);
    }
  };

  const handleRestart = () => {
    setStep("request");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setPasswordInUse("");
    setIsPasswordFieldActive(false);
    clearFeedback();
  };

  const handleBackToCode = () => {
    setStep("verify");
    setPassword("");
    setConfirmPassword("");
    setPasswordInUse("");
    setIsPasswordFieldActive(false);
    clearFeedback();
  };

  const isRequestStep = step === "request";
  const isVerifyStep = step === "verify";
  const activeStepIndex = Math.max(
    0,
    STEPS.findIndex((item) => item.key === step)
  );
  const tone = getStrengthTone(passwordPolicy.strength, hasPasswordInput);
  const confirmMatches = confirmPassword.length > 0 && password === confirmPassword;
  const confirmMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const identifierInvalid = trimmedIdentifier.length > 0 && !EMAIL_PATTERN.test(trimmedIdentifier);
  const codeComplete = code.length === 6;
  const satisfiedChips = chips.filter((chip) => chip.satisfied).length;
  const strengthPercent = hasPasswordInput ? (satisfiedChips / chips.length) * 100 : 0;
  // Kept mounted once the user has typed so the meter never flickers away mid-keystroke.
  const showMeter = isPasswordFieldActive || hasPasswordInput;

  return (
    <AuthCard
      backLabel="Back to sign in"
      badge={ShieldCheck}
      highlight={isRequestStep ? undefined : trimmedIdentifier}
      icon={isRequestStep ? Mail : isVerifyStep ? ShieldCheck : KeyRound}
      onBack={onBack}
      subtitle={
        isRequestStep
          ? "We'll send a 6-digit verification code to your email."
          : isVerifyStep
            ? "Enter the code we sent to continue securely."
            : "Your code is verified. Choose a strong new password."
      }
      title={isRequestStep ? "Forgot password" : isVerifyStep ? "Verify your code" : "Create new password"}
    >
      <nav aria-label="Password recovery progress">
        <ol className="m-0 grid list-none grid-cols-3 p-0">
          {STEPS.map((item, index) => {
            const isComplete = index < activeStepIndex;
            const isActive = index === activeStepIndex;

            return (
              <li
                aria-current={isActive ? "step" : undefined}
                className="relative flex min-w-0 flex-col items-center gap-2"
                key={item.key}
              >
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute right-1/2 top-4 h-0.5 w-1/2 transition-colors duration-300",
                      index <= activeStepIndex ? "bg-[#D61E1E]" : "bg-slate-200"
                    )}
                  />
                ) : null}
                {index < TOTAL_STEPS - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute left-1/2 top-4 h-0.5 w-1/2 transition-colors duration-300",
                      index < activeStepIndex ? "bg-[#D61E1E]" : "bg-slate-200"
                    )}
                  />
                ) : null}

                <span
                  className={cx(
                    "relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-extrabold transition-all duration-300",
                    isComplete
                      ? "border-[#D61E1E] bg-[#D61E1E] text-white"
                      : isActive
                        ? "border-[#D61E1E] bg-[#FEF1F1] text-[#D61E1E] shadow-[0_0_0_4px_rgba(214,30,30,0.10)]"
                        : "border-slate-200 bg-white text-slate-400"
                  )}
                >
                  {isComplete ? <Check aria-hidden="true" size={15} strokeWidth={3} /> : index + 1}
                </span>
                <span
                  className={cx(
                    "truncate text-[10px] font-extrabold uppercase tracking-[0.08em] transition-colors",
                    isActive ? "text-[#D61E1E]" : isComplete ? "text-slate-700" : "text-slate-400"
                  )}
                >
                  {item.label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {error ? (
        <AuthAlert className="mt-4" tone="error">
          {error}
        </AuthAlert>
      ) : null}

      {message ? (
        <AuthAlert className="mt-4" tone="success">
          {message}
        </AuthAlert>
      ) : null}

      <form
        className="mt-5 grid gap-4"
        noValidate
        onSubmit={
          isRequestStep ? handleRequestCode : isVerifyStep ? handleVerifyCode : handleResetPassword
        }
      >
        {isRequestStep ? (
          <AuthField
            autoComplete="email"
            autoFocus
            error={identifierInvalid ? "Enter a valid email address." : undefined}
            icon={Mail}
            id="forgotIdentifier"
            inputMode="email"
            label="Email"
            name="forgotIdentifier"
            onChange={(event) => {
              setIdentifier(event.target.value);
              clearFeedback();
            }}
            placeholder="name@example.com"
            type="email"
            value={identifier}
          />
        ) : isVerifyStep ? (
          <>
            <div>
              <label className={AUTH_LABEL_CLASS} htmlFor="forgotResetCode">
                6-digit code
              </label>
              <input
                autoComplete="one-time-code"
                autoFocus
                className={cx(
                  "h-[62px] w-full rounded-xl border text-center font-mono text-[28px] font-extrabold leading-none shadow-sm outline-none transition",
                  "tracking-[0.32em] indent-[0.32em] placeholder:text-slate-300",
                  codeComplete
                    ? "border-emerald-400 bg-emerald-50/60 text-emerald-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    : "border-slate-300 bg-white text-slate-900 focus:border-[#D61E1E] focus:ring-4 focus:ring-[#D61E1E]/15"
                )}
                disabled={loading || resending}
                id="forgotResetCode"
                inputMode="numeric"
                maxLength={6}
                name="forgotResetCode"
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D+/g, "").slice(0, 6));
                  clearFeedback();
                }}
                pattern="[0-9]*"
                placeholder="000000"
                value={code}
              />
            </div>

            <AuthButton
              disabled={resending || !codeComplete}
              icon={ShieldCheck}
              loading={loading}
              loadingLabel="Verifying..."
              type="submit"
            >
              Verify code
            </AuthButton>

            <div className="grid gap-2 sm:grid-cols-2">
              <AuthButton
                disabled={loading || resendAvailableInSeconds > 0}
                icon={RotateCw}
                loading={resending}
                loadingLabel="Resending..."
                onClick={handleResendCode}
                size="sm"
                variant="secondary"
              >
                {resendAvailableInSeconds > 0 ? `Resend code (${resendAvailableInSeconds}s)` : "Resend code"}
              </AuthButton>
              <AuthButton
                disabled={loading || resending}
                icon={Mail}
                onClick={handleRestart}
                size="sm"
                variant="secondary"
              >
                Use another email
              </AuthButton>
            </div>
          </>
        ) : (
          <>
            <div
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsPasswordFieldActive(false);
                }
              }}
              onFocus={() => setIsPasswordFieldActive(true)}
            >
              <PasswordField
                autoComplete="new-password"
                autoFocus
                error={passwordIsInUse ? PASSWORD_IN_USE_MESSAGE : undefined}
                id="forgotNewPassword"
                label="New password"
                maxLength={maximumPasswordLength}
                name="forgotNewPassword"
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFeedback();
                }}
                placeholder="Enter new password"
                revealLabel="new password"
                value={password}
              />

              {showMeter ? (
                <div className="mt-2.5 grid gap-2">
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <span
                        className={cx("block h-full rounded-full transition-all duration-300", tone.bar)}
                        style={{ width: `${strengthPercent}%` }}
                      />
                    </div>
                    <span
                      className={cx(
                        "shrink-0 text-[11px] font-extrabold uppercase tracking-[0.12em]",
                        tone.text
                      )}
                    >
                      {STRENGTH_WORD[passwordPolicy.strength]}
                    </span>
                  </div>

                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {chips.map((chip) => (
                      <li
                        className={cx(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition",
                          chip.satisfied
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        )}
                        key={chip.key}
                      >
                        {chip.satisfied ? (
                          <Check aria-hidden="true" className="shrink-0" size={12} />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="h-1 w-1 shrink-0 rounded-full bg-slate-300"
                          />
                        )}
                        {chip.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <PasswordField
              autoComplete="new-password"
              error={confirmMismatch ? "Passwords do not match." : undefined}
              hint={confirmMatches ? "Passwords match." : undefined}
              id="forgotConfirmPassword"
              label="Confirm password"
              maxLength={maximumPasswordLength}
              name="forgotConfirmPassword"
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                clearFeedback();
              }}
              placeholder="Re-enter new password"
              revealLabel="confirmation password"
              success={confirmMatches}
              value={confirmPassword}
            />
          </>
        )}

        {isVerifyStep ? null : (
          <AuthButton
            icon={isRequestStep ? Send : KeyRound}
            disabled={resending}
            loading={loading}
            loadingLabel={isRequestStep ? "Sending..." : "Resetting..."}
            type="submit"
          >
            {isRequestStep ? "Send code" : "Reset password"}
          </AuthButton>
        )}

        {isRequestStep || isVerifyStep ? null : (
          <div className="grid gap-2 sm:grid-cols-2">
            <AuthButton
              disabled={loading || resending}
              icon={ArrowLeft}
              onClick={handleBackToCode}
              size="sm"
              variant="secondary"
            >
              Back to code
            </AuthButton>
            <AuthButton
              disabled={loading || resending}
              icon={Mail}
              onClick={handleRestart}
              size="sm"
              variant="secondary"
            >
              Use another email
            </AuthButton>
          </div>
        )}
      </form>
    </AuthCard>
  );
}
