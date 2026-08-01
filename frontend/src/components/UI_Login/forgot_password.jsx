import React, { useState } from "react";
import { Check, KeyRound, Mail, RotateCw, Send, ShieldCheck } from "lucide-react";
import { forgotPassword, resetPassword } from "../../services/api";
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

const TOTAL_STEPS = 2;

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

/** Two-step account recovery: request a 6-digit code, then set a new password with it. */
export default function ForgotPassword({ onBack, onResetSuccess, securitySettings = {} }) {
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState("request");
  const [isPasswordFieldActive, setIsPasswordFieldActive] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const maximumPasswordLength =
    Number(securitySettings.maximumPasswordLength) || PASSWORD_POLICY_DEFAULT_MAX_LENGTH;
  const passwordPolicy = evaluatePasswordPolicy(password, { maximumPasswordLength });
  const chips = policyChips(passwordPolicy);
  const hasPasswordInput = password.length > 0;
  const trimmedIdentifier = identifier.trim();

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
      setStep("reset");
      setCode("");
      setPassword("");
      setConfirmPassword("");
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
      setError(requestError.response?.data?.message || "Unable to reset the password.");
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = () => {
    setStep("request");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setIsPasswordFieldActive(false);
    clearFeedback();
  };

  const isRequestStep = step === "request";
  const activeStepIndex = isRequestStep ? 0 : 1;
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
      icon={isRequestStep ? Mail : KeyRound}
      onBack={onBack}
      subtitle={
        isRequestStep
          ? "We'll send a 6-digit code to your email."
          : "Enter the code, then set a new password."
      }
      title={isRequestStep ? "Forgot password" : "Reset password"}
    >
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 gap-1.5">
          {Array.from({ length: TOTAL_STEPS }, (_, index) => (
            <span
              className={cx(
                "h-1.5 min-w-0 flex-1 rounded-full transition-colors duration-300",
                index <= activeStepIndex ? "bg-[#D61E1E]" : "bg-slate-200"
              )}
              key={index}
            />
          ))}
        </div>
        <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-400">
          {activeStepIndex + 1}/{TOTAL_STEPS}
        </span>
      </div>

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
        onSubmit={isRequestStep ? handleRequestCode : handleResetPassword}
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
        ) : (
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
                  // indent offsets the trailing letter-space so the digits stay optically centred
                  "tracking-[0.32em] indent-[0.32em] placeholder:text-slate-300",
                  codeComplete
                    ? "border-emerald-400 bg-emerald-50/60 text-emerald-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    : "border-slate-300 bg-white text-slate-900 focus:border-[#D61E1E] focus:ring-4 focus:ring-[#D61E1E]/15"
                )}
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

        <AuthButton
          icon={isRequestStep ? Send : KeyRound}
          loading={loading}
          loadingLabel={isRequestStep ? "Sending..." : "Resetting..."}
          type="submit"
        >
          {isRequestStep ? "Send code" : "Reset password"}
        </AuthButton>

        {isRequestStep ? null : (
          <AuthButton icon={RotateCw} onClick={handleRestart} size="sm" variant="secondary">
            Use another email
          </AuthButton>
        )}
      </form>
    </AuthCard>
  );
}
