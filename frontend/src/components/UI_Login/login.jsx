import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  CircleX,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { forceChangePassword, getPublicSettings, login, logout } from "../../services/api";
import {
  evaluatePasswordPolicy,
  getPasswordPolicyItems,
  PASSWORD_POLICY_DEFAULT_MAX_LENGTH,
} from "../../utils/passwordPolicy";
import { getRoleLabel } from "../../utils/roleRoutes";
import ForgotPassword from "./forgot_password";
import TwoFactorVerification from "./two_factor_verification";

const REMEMBERED_EMAIL_KEY = "mgb_hris_remembered_email";
const LEGACY_REMEMBERED_USERNAME_KEY = "mgb_hris_remembered_username";
const LOGIN_SUCCESS_ALERT_DURATION_MS = 1500;
const LOGIN_ERROR_ALERT_DURATION_MS = 3500;
const CAPTCHA_RESET_SECONDS = 120;

const publicUrl = process.env.PUBLIC_URL || "";
const mgbLogo = `${publicUrl}/mgb.png`;
const backgroundImage = `${publicUrl}/background.png`;

/**
 * Bottom-weighted scrim for the photo panel: light enough at the top that the regional office stays
 * recognisable, dark enough at the bottom that the white headline sitting there keeps its contrast.
 */
const PHOTO_SCRIM =
  "linear-gradient(to top, rgba(2, 6, 23, 0.90) 0%, rgba(15, 23, 42, 0.58) 42%, rgba(30, 41, 59, 0.40) 100%)";

const fadeIn = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

function readRememberedEmail() {
  try {
    return (
      window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ||
      window.localStorage.getItem(LEGACY_REMEMBERED_USERNAME_KEY) ||
      ""
    );
  } catch {
    return "";
  }
}

function createMathCaptchaChallenge() {
  const useSubtraction = Math.random() >= 0.5;

  if (useSubtraction) {
    const first = Math.floor(Math.random() * 9) + 6;
    const second = Math.floor(Math.random() * (first - 1)) + 1;

    return {
      prompt: `${first} - ${second}`,
      answer: String(first - second),
    };
  }

  const first = Math.floor(Math.random() * 9) + 1;
  const second = Math.floor(Math.random() * 9) + 1;

  return {
    prompt: `${first} + ${second}`,
    answer: String(first + second),
  };
}

function parseMathCaptchaPrompt(prompt) {
  const [leftOperand = "", operator = "+", rightOperand = ""] = String(prompt || "").split(" ");
  return { leftOperand, operator, rightOperand };
}

function formatCaptchaCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function LoginField({
  error,
  id,
  label,
  rightElement,
  ...props
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>
      <div className="relative">
        <input
          id={id}
          className={`min-h-[44px] w-full rounded-md border bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-4 ${
            rightElement ? "pr-11" : ""
          } ${
            error
              ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100"
              : "border-slate-300 hover:border-slate-400 focus:border-[#D61E1E] focus:ring-[#D61E1E]/12"
          }`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        {rightElement}
      </div>
      {error ? (
        <p id={`${id}-error`} className="m-0 mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
          <AlertCircle aria-hidden="true" size={13} />
          {error}
        </p>
      ) : null}
    </label>
  );
}

function CaptchaField({
  answer,
  answerTone,
  error,
  onChange,
  prompt,
  resetSecondsRemaining,
}) {
  const { leftOperand, operator, rightOperand } = parseMathCaptchaPrompt(prompt);
  const answerClass =
    answerTone === "correct"
      ? "border-emerald-400 bg-emerald-50 focus:border-emerald-500 focus:ring-emerald-100"
      : answerTone === "wrong"
        ? "border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100"
        : "border-slate-300 bg-white focus:border-[#D61E1E] focus:ring-[#D61E1E]/12";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor="captcha" className="text-sm font-medium text-slate-600">
          Enter the answer shown below
        </label>
        <span className="text-xs text-slate-400" aria-live="polite">
          Resets in {formatCaptchaCountdown(resetSecondsRemaining)}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 rounded-md bg-slate-100 px-3 py-2">
        {/* Unselectable so the challenge cannot simply be copied out of the page. */}
        <span className="select-none whitespace-nowrap font-mono text-lg font-bold tracking-[0.16em] text-slate-700">
          {leftOperand} {operator} {rightOperand} =
        </span>

        <input
          id="captcha"
          name="captcha"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={answer}
          onChange={onChange}
          placeholder="Answer"
          aria-invalid={Boolean(error)}
          className={`min-h-[40px] w-24 rounded-md border px-3 text-center text-sm font-semibold tabular-nums text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-4 ${answerClass}`}
        />
      </div>
    </div>
  );
}

function LoginCard({
  captchaAnswer,
  captchaAnswerTone,
  captchaEnabled,
  captchaPrompt,
  errors,
  form,
  loading,
  rememberMe,
  onCaptchaChange,
  onFieldChange,
  onForgotPassword,
  onRememberMeChange,
  onSubmit,
  captchaResetSeconds,
  serverError,
  successMessage,
  setShowPassword,
  showPassword,
}) {
  return (
    <motion.section
      aria-labelledby="signin-heading"
      className="w-full max-w-[420px] rounded-xl border border-slate-200/70 bg-white px-4 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.10)] sm:px-5"
      initial="hidden"
      animate="visible"
      variants={fadeIn}
      transition={{ duration: 0.45, ease: "easeOut" }}
    >
      <img
        alt="Mines and Geosciences Bureau seal"
        className="mx-auto h-[72px] w-[72px] object-contain"
        src={mgbLogo}
      />

      <header className="mt-6">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="h-6 w-[3px] rounded-full bg-[#D61E1E]" />
          <h1 id="signin-heading" className="m-0 text-lg font-bold tracking-tight text-slate-900">
            Sign In
          </h1>
        </div>
        <p className="m-0 mt-1.5 text-sm text-slate-500">Please login to your account</p>
      </header>

      {serverError ? (
        <div className="mt-5 flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium leading-5 text-rose-700" role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
          <span>{serverError}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div className="mt-5 flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium leading-5 text-emerald-700" role="status">
          <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <form className="mt-6 grid gap-4" onSubmit={onSubmit} noValidate>
        <LoginField
          autoComplete="email"
          error={errors.email}
          id="email"
          label="Email"
          name="email"
          onChange={onFieldChange("email")}
          placeholder="Enter your email"
          type="email"
          value={form.email}
        />

        <LoginField
          autoComplete="current-password"
          error={errors.password}
          id="password"
          label="Password"
          name="password"
          onChange={onFieldChange("password")}
          placeholder="Enter your password"
          rightElement={
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? <Eye aria-hidden="true" size={17} /> : <EyeOff aria-hidden="true" size={17} />}
            </button>
          }
          type={showPassword ? "text" : "password"}
          value={form.password}
        />

        {captchaEnabled ? (
          <CaptchaField
            answer={captchaAnswer}
            answerTone={captchaAnswerTone}
            error={errors.captcha}
            onChange={onCaptchaChange}
            prompt={captchaPrompt}
            resetSecondsRemaining={captchaResetSeconds}
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600" />
            <p className="m-0 text-xs font-medium text-slate-600">Captcha is disabled by admin</p>
          </div>
        )}

        <label htmlFor="rememberMe" className="inline-flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            checked={rememberMe}
            className="h-4 w-4 rounded border-slate-300 accent-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/20"
            id="rememberMe"
            name="rememberMe"
            onChange={onRememberMeChange}
            type="checkbox"
          />
          <span>Remember me</span>
        </label>

        <button
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-[#D61E1E] px-5 text-sm font-semibold text-white transition hover:bg-[#B41818] focus:outline-none focus:ring-4 focus:ring-[#D61E1E]/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-75 motion-reduce:active:scale-100"
          disabled={loading}
          type="submit"
        >
          {loading ? (
            <>
              <Loader2 aria-hidden="true" className="animate-spin" size={17} />
              <span>Signing in...</span>
            </>
          ) : (
            <span>Login</span>
          )}
        </button>

        <button
          className="mx-auto w-fit rounded text-sm font-medium text-[#D61E1E] transition hover:text-[#B41818] hover:underline focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
          onClick={onForgotPassword}
          type="button"
        >
          Forgot Password?
        </button>
      </form>
    </motion.section>
  );
}

function PasswordRequirementPanel({ password, passwordPolicy, passwordPolicyItems }) {
  const hasPasswordInput = password.length > 0;
  const panelToneClass =
    !hasPasswordInput
      ? "border-slate-200 bg-slate-50"
      : passwordPolicy.strength === "strong"
        ? "border-emerald-200 bg-emerald-50"
        : passwordPolicy.strength === "weak"
          ? "border-rose-200 bg-rose-50"
          : "border-amber-200 bg-amber-50";
  const iconToneClass =
    !hasPasswordInput
      ? "bg-slate-200 text-slate-600"
      : passwordPolicy.strength === "strong"
        ? "bg-emerald-100 text-emerald-700"
        : passwordPolicy.strength === "weak"
          ? "bg-rose-100 text-rose-700"
          : "bg-amber-100 text-amber-700";

  return (
    <div className={`rounded-md border p-4 shadow-sm transition ${panelToneClass}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${iconToneClass}`}>
          {!hasPasswordInput || passwordPolicy.strength === "strong" ? (
            <ShieldCheck aria-hidden="true" size={18} />
          ) : (
            <ShieldAlert aria-hidden="true" size={18} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-sm font-bold text-slate-900">Password requirements</p>
            <span
              className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase ${
                !hasPasswordInput
                  ? "bg-slate-200 text-slate-600"
                  : passwordPolicy.strength === "strong"
                    ? "bg-emerald-100 text-emerald-700"
                    : passwordPolicy.strength === "weak"
                      ? "bg-rose-100 text-rose-700"
                      : "bg-amber-100 text-amber-700"
              }`}
            >
              {passwordPolicy.strengthLabel}
            </span>
          </div>
          <p className="m-0 mt-1 text-xs font-semibold leading-5 text-slate-500">
            {passwordPolicy.strengthMessage}
          </p>
          <div className="mt-3 grid gap-2">
            {passwordPolicyItems.map((item) => (
              <div className="flex items-center gap-2 text-xs font-semibold" key={item.key}>
                {item.satisfied ? (
                  <CheckCircle2 aria-hidden="true" className="shrink-0 text-emerald-600" size={15} />
                ) : hasPasswordInput ? (
                  <CircleX
                    aria-hidden="true"
                    className={`shrink-0 ${passwordPolicy.strength === "weak" ? "text-rose-600" : "text-amber-600"}`}
                    size={15}
                  />
                ) : (
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                )}
                <span
                  className={
                    item.satisfied
                      ? "text-emerald-700"
                      : hasPasswordInput
                        ? passwordPolicy.strength === "weak"
                          ? "text-rose-800"
                          : "text-amber-800"
                        : "text-slate-600"
                  }
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ForcePasswordChangeCard({
  loading,
  onCancel,
  onSubmit,
  securitySettings,
  user,
}) {
  const [form, setForm] = useState({
    currentPassword: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const maximumPasswordLength = Number(securitySettings.maximumPasswordLength) || PASSWORD_POLICY_DEFAULT_MAX_LENGTH;
  const passwordPolicyOptions = { maximumPasswordLength };
  const passwordPolicy = evaluatePasswordPolicy(form.password, passwordPolicyOptions);
  const passwordPolicyItems = getPasswordPolicyItems(form.password, passwordPolicyOptions);
  const displayName = user?.full_name || user?.username || user?.email || "your account";

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setServerError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = {};

    if (!form.currentPassword) {
      nextErrors.currentPassword = "Current password is required.";
    }

    if (!form.password) {
      nextErrors.password = "New password is required.";
    } else if (!passwordPolicy.isValid) {
      nextErrors.password = `Use ${passwordPolicy.minimumPasswordLength} to ${maximumPasswordLength} characters with letters, numbers, and symbols.`;
    }

    if (!form.confirmPassword) {
      nextErrors.confirmPassword = "Confirm your new password.";
    } else if (form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    if (form.currentPassword && form.password && form.currentPassword === form.password) {
      nextErrors.password = "Choose a password different from your temporary password.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      await onSubmit?.(form);
    } catch (error) {
      setServerError(error.response?.data?.message || "Unable to change password.");
    }
  };

  return (
    <motion.section
      aria-labelledby="force-password-heading"
      className="relative w-full max-w-[420px] overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.10)]"
      initial="hidden"
      animate="visible"
      variants={fadeIn}
      transition={{ duration: 0.45, ease: "easeOut" }}
    >
      <div className="h-1 bg-[#D61E1E]" />
      <div className="px-5 pb-4 pt-4 sm:px-5 sm:pb-7 sm:pt-7">
        <div className="text-center">
          <div className="mx-auto grid h-[68px] w-[68px] place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-[#D61E1E] shadow-inner">
            <KeyRound aria-hidden="true" size={30} />
          </div>
          <p className="m-0 mt-5 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
            First Login Security
          </p>
          <h1 id="force-password-heading" className="m-0 mt-2 text-[26px] font-extrabold leading-tight text-slate-950">
            Change Your Password
          </h1>
          <p className="m-0 mt-3 text-sm font-semibold leading-6 text-slate-500">
            Welcome, {displayName}. Create a new password before opening your dashboard.
          </p>
        </div>

        {serverError ? (
          <div className="mt-5 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-700" role="alert">
            <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
            <span>{serverError}</span>
          </div>
        ) : null}

        <form className="mt-5 grid gap-4" onSubmit={handleSubmit} noValidate>
          <LoginField
            autoComplete="current-password"
            error={errors.currentPassword}
            id="forceCurrentPassword"
            label="Temporary Password"
            name="forceCurrentPassword"
            onChange={updateField("currentPassword")}
            placeholder="Enter your temporary password"
            rightElement={
              <button
                aria-label={showCurrentPassword ? "Hide temporary password" : "Show temporary password"}
                className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
                onClick={() => setShowCurrentPassword((visible) => !visible)}
                type="button"
              >
                {showCurrentPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
            }
            type={showCurrentPassword ? "text" : "password"}
            value={form.currentPassword}
          />

          <LoginField
            autoComplete="new-password"
            error={errors.password}
            id="forceNewPassword"
            label="New Password"
            maxLength={maximumPasswordLength}
            name="forceNewPassword"
            onChange={updateField("password")}
            placeholder="Enter new password"
            rightElement={
              <button
                aria-label={showPassword ? "Hide new password" : "Show new password"}
                className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
            }
            type={showPassword ? "text" : "password"}
            value={form.password}
          />

          <PasswordRequirementPanel
            password={form.password}
            passwordPolicy={passwordPolicy}
            passwordPolicyItems={passwordPolicyItems}
          />

          <LoginField
            autoComplete="new-password"
            error={errors.confirmPassword}
            id="forceConfirmPassword"
            label="Confirm New Password"
            maxLength={maximumPasswordLength}
            name="forceConfirmPassword"
            onChange={updateField("confirmPassword")}
            placeholder="Confirm new password"
            type="password"
            value={form.confirmPassword}
          />

          <button
            className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-md bg-[#D61E1E] px-5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(214,30,30,0.24)] transition hover:bg-[#B41818] focus:outline-none focus:ring-4 focus:ring-[#D61E1E]/20 disabled:cursor-not-allowed disabled:opacity-75"
            disabled={loading}
            type="submit"
          >
            {loading ? <Loader2 aria-hidden="true" className="animate-spin" size={17} /> : <KeyRound aria-hidden="true" size={17} />}
            {loading ? "Changing password..." : "Change Password"}
          </button>

          <button
            className="inline-flex min-h-[42px] w-full items-center justify-center rounded-md border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:border-[#F8BFBF] hover:bg-[#FEF1F1] hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={loading}
            onClick={onCancel}
            type="button"
          >
            Sign Out
          </button>
        </form>
      </div>
    </motion.section>
  );
}

export default function Login({ onLogin }) {
  const rememberedEmail = readRememberedEmail();
  const [form, setForm] = useState({ email: rememberedEmail, password: "" });
  const [captchaChallenge, setCaptchaChallenge] = useState(() => createMathCaptchaChallenge());
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaEnabled, setCaptchaEnabled] = useState(true);
  const [captchaResetSeconds, setCaptchaResetSeconds] = useState(CAPTCHA_RESET_SECONDS);
  const [rememberMe, setRememberMe] = useState(Boolean(rememberedEmail));
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [securitySettings, setSecuritySettings] = useState({});
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [forcePasswordUser, setForcePasswordUser] = useState(null);
  const [forcePasswordLoading, setForcePasswordLoading] = useState(false);
  const trimmedCaptchaAnswer = captchaAnswer.trim();
  const captchaAnswerTone =
    captchaEnabled && trimmedCaptchaAnswer
      ? trimmedCaptchaAnswer === captchaChallenge.answer
        ? "correct"
        : "wrong"
      : "idle";

  useEffect(() => {
    let active = true;

    const loadPublicSettings = async () => {
      try {
        const result = await getPublicSettings();

        if (!active) {
          return;
        }

        const enabled = result.loginCaptchaEnabled !== false;
        setCaptchaEnabled(enabled);
        setSecuritySettings(result.security || {});

        if (!enabled) {
          setCaptchaAnswer("");
          setErrors((current) => ({ ...current, captcha: "" }));
        }
      } catch {
        if (active) {
          setCaptchaEnabled(true);
        }
      }
    };

    loadPublicSettings();

    return () => {
      active = false;
    };
  }, []);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setServerError("");
    setSuccessMessage("");
  };

  const refreshCaptcha = () => {
    setCaptchaChallenge(createMathCaptchaChallenge());
    setCaptchaAnswer("");
    setCaptchaResetSeconds(CAPTCHA_RESET_SECONDS);
    setErrors((current) => ({ ...current, captcha: "" }));
    setServerError("");
    setSuccessMessage("");
  };

  useEffect(() => {
    if (!captchaEnabled || forgotMode || forcePasswordUser) {
      return undefined;
    }

    if (captchaResetSeconds <= 0) {
      setCaptchaChallenge(createMathCaptchaChallenge());
      setCaptchaAnswer("");
      setCaptchaResetSeconds(CAPTCHA_RESET_SECONDS);
      setErrors((current) => ({ ...current, captcha: "" }));
      setServerError("");
      setSuccessMessage("");
      return undefined;
    }

    const countdown = window.setTimeout(() => {
      setCaptchaResetSeconds((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => {
      window.clearTimeout(countdown);
    };
  }, [captchaEnabled, captchaResetSeconds, forgotMode, forcePasswordUser]);

  const handleCaptchaChange = (event) => {
    setCaptchaAnswer(event.target.value.replace(/\D/g, ""));
    setErrors((current) => ({ ...current, captcha: "" }));
    setServerError("");
    setSuccessMessage("");
  };

  const validate = () => {
    const nextErrors = {};
    const captchaIncorrectMessage = "Incorrect answer. Please try again.";

    if (!form.email.trim()) {
      nextErrors.email = "Email is required.";
    }

    if (!form.password) {
      nextErrors.password = "Password is required.";
    }

    const wrongCaptchaAnswer =
      captchaEnabled
      && trimmedCaptchaAnswer
      && trimmedCaptchaAnswer !== captchaChallenge.answer;

    if (captchaEnabled) {
      if (!trimmedCaptchaAnswer) {
        nextErrors.captcha = "Answer the verification check.";
      } else if (wrongCaptchaAnswer) {
        nextErrors.captcha = captchaIncorrectMessage;
      }
    }

    setErrors(nextErrors);

    if (captchaEnabled && trimmedCaptchaAnswer && nextErrors.captcha) {
      if (wrongCaptchaAnswer) {
        Swal.fire({
          title: captchaIncorrectMessage,
          icon: "error",
          toast: true,
          position: "top-end",
          width: "20rem",
          timer: LOGIN_ERROR_ALERT_DURATION_MS,
          timerProgressBar: true,
          showConfirmButton: false,
          allowOutsideClick: false,
          allowEscapeKey: true,
          backdrop: false,
          customClass: {
            popup: "rounded-md px-4 py-3 shadow-lg",
            title: "text-sm font-semibold leading-6 text-slate-700",
          },
        });
      }

      setCaptchaChallenge(createMathCaptchaChallenge());
      setCaptchaAnswer("");
      setCaptchaResetSeconds(CAPTCHA_RESET_SECONDS);

      if (wrongCaptchaAnswer) {
        setForm((current) => ({
          ...current,
          password: "",
        }));
        setShowPassword(false);
      }
    }

    return Object.keys(nextErrors).length === 0;
  };

  const persistRememberedEmail = (email) => {
    try {
      if (rememberMe) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
        window.localStorage.removeItem(LEGACY_REMEMBERED_USERNAME_KEY);
        return;
      }

      window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      window.localStorage.removeItem(LEGACY_REMEMBERED_USERNAME_KEY);
    } catch {
      // Remembered login is optional and should not block sign-in.
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    const username = form.email.trim();
    setLoading(true);
    setServerError("");
    setSuccessMessage("");

    try {
      const result = await login({
        username,
        password: form.password,
      });

      if (!result || result.success === false || (!result.requiresTwoFactor && !result.user)) {
        const message = result?.message || "Login failed. Please check your credentials and try again.";
        setServerError(message);
        Swal.fire({
          title: "Login Failed",
          text: message,
          icon: "error",
          toast: true,
          position: "top-end",
          width: "22rem",
          timer: LOGIN_ERROR_ALERT_DURATION_MS,
          timerProgressBar: true,
          showConfirmButton: false,
          allowOutsideClick: false,
          allowEscapeKey: true,
          backdrop: false,
          customClass: {
            popup: "rounded-md px-4 py-3 shadow-lg",
            title: "text-sm font-semibold leading-6 text-slate-700",
            htmlContainer: "text-xs text-slate-600",
          },
        });
        refreshCaptcha();
        return;
      }

      persistRememberedEmail(username);
      refreshCaptcha();

      if (result.requiresTwoFactor) {
        setTwoFactorChallenge(result.twoFactor || {});
        setForcePasswordUser(null);
        setForm((current) => ({
          ...current,
          password: "",
        }));
        setShowPassword(false);
        return;
      }

      if (result.user?.must_change_password) {
        setForcePasswordUser(result.user);
        setForm((current) => ({
          ...current,
          password: "",
        }));
        setShowPassword(false);
        return;
      }

      const roleLabel = getRoleLabel(result.user?.roleKey || result.user?.role || "User");
      await Swal.fire({
        title: `Welcome, ${roleLabel}`,
        text: "Login successful. Redirecting to your dashboard!",
        icon: "success",
        toast: true,
        position: "top-end",
        width: "22rem",
        timer: LOGIN_SUCCESS_ALERT_DURATION_MS,
        timerProgressBar: true,
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
        backdrop: false,
        customClass: {
          popup: "rounded-2xl px-4 py-3",
          title: "text-sm font-semibold text-slate-900",
          htmlContainer: "text-xs text-slate-600",
        },
      });
      onLogin?.(result.user);
    } catch (error) {
      let message;

      if (!error.response) {
        message = "Unable to connect to the server. Please check if the server is running and the database is properly configured.";
      } else {
        const responseMessage =
          error.response?.data?.message || "Login failed. Please check your credentials and try again.";
        const invalidCredentials = responseMessage.toLowerCase().includes("invalid username or password")
          || responseMessage.toLowerCase().includes("invalid email or password");
        message = invalidCredentials ? "Invalid email or password." : responseMessage;
      }

      setServerError(message);

      Swal.fire({
        title: "Login Failed",
        text: message,
        icon: "error",
        toast: true,
        position: "top-end",
        width: "22rem",
        timer: LOGIN_ERROR_ALERT_DURATION_MS,
        timerProgressBar: true,
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: true,
        backdrop: false,
        customClass: {
          popup: "rounded-md px-4 py-3 shadow-lg",
          title: "text-sm font-semibold leading-6 text-slate-700",
          htmlContainer: "text-xs text-slate-600",
        },
      });

      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleResetSuccess = ({ identifier, message }) => {
    setForm((current) => ({
      ...current,
      email: identifier || current.email,
      password: "",
    }));
    setErrors({});
    setServerError("");
    setShowPassword(false);
    setForgotMode(false);
    setSuccessMessage(message || "Password reset successful. You can sign in with your new password.");
    refreshCaptcha();
  };

  const handleTwoFactorVerified = async (verifiedUser) => {
    if (verifiedUser?.must_change_password) {
      setTwoFactorChallenge(null);
      setForcePasswordUser(verifiedUser);
      return;
    }

    const roleLabel = getRoleLabel(verifiedUser?.roleKey || verifiedUser?.role || "User");
    await Swal.fire({
      title: `Welcome, ${roleLabel}`,
      text: "Verification successful. Redirecting to your dashboard!",
      icon: "success",
      toast: true,
      position: "top-end",
      width: "22rem",
      timer: LOGIN_SUCCESS_ALERT_DURATION_MS,
      timerProgressBar: true,
      showConfirmButton: false,
      allowOutsideClick: false,
      allowEscapeKey: false,
      backdrop: false,
      customClass: {
        popup: "rounded-2xl px-4 py-3",
        title: "text-sm font-semibold text-slate-900",
        htmlContainer: "text-xs text-slate-600",
      },
    });
    setTwoFactorChallenge(null);
    onLogin?.(verifiedUser);
  };

  const handleTwoFactorBack = () => {
    setTwoFactorChallenge(null);
    setForm((current) => ({
      ...current,
      password: "",
    }));
    setShowPassword(false);
    refreshCaptcha();
    logout().catch(() => {});
  };

  const handleForcePasswordSubmit = async (payload) => {
    setForcePasswordLoading(true);

    try {
      const result = await forceChangePassword(payload);
      setForcePasswordUser(null);
      await Swal.fire({
        title: "Password Changed",
        text: "Your password has been updated. Redirecting to your dashboard!",
        icon: "success",
        toast: true,
        position: "top-end",
        width: "22rem",
        timer: LOGIN_SUCCESS_ALERT_DURATION_MS,
        timerProgressBar: true,
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
        backdrop: false,
        customClass: {
          popup: "rounded-2xl px-4 py-3",
          title: "text-sm font-semibold text-slate-900",
          htmlContainer: "text-xs text-slate-600",
        },
      });
      onLogin?.(result.user);
    } finally {
      setForcePasswordLoading(false);
    }
  };

  const handleForcePasswordCancel = () => {
    setForcePasswordUser(null);
    setForm((current) => ({
      ...current,
      password: "",
    }));
    setShowPassword(false);
    refreshCaptcha();
    logout().catch(() => {});
  };

  return (
    <main className="login-page min-h-screen bg-white font-['Aptos','Segoe_UI',sans-serif] text-slate-950 lg:grid lg:grid-cols-2">

      {/* Photo panel: the regional office, with the system title anchored to the bottom. */}
      <aside
        className="relative hidden overflow-hidden bg-slate-900 bg-cover bg-center lg:block"
        style={{ backgroundImage: `${PHOTO_SCRIM}, url("${backgroundImage}")` }}
      >
        <div className="flex h-full flex-col justify-end p-12 xl:p-16">
          <h2 className="m-0 text-[44px] font-extrabold leading-[1.08] tracking-tight text-white xl:text-[52px]">
            Human Resources
            <br />
            Information System
          </h2>
          <span aria-hidden="true" className="mt-6 block h-[5px] w-40 rounded-full bg-[#D61E1E]" />
          <p className="m-0 mt-6 max-w-[46ch] text-[15px] leading-relaxed text-white/80">
            Mines and Geosciences Bureau, DENR Region X, Macabalan, Cagayan de Oro City
          </p>
        </div>
      </aside>

      {/* Sign-in column. */}
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-50">
        {/* The same photo, washed almost to nothing, so the column reads as part of the same page. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.055] grayscale"
          style={{ backgroundImage: `url("${backgroundImage}")` }}
        />

        {/* The photo panel is hidden on small screens, so the title rides above the card instead. */}
        <div
          className="relative overflow-hidden bg-slate-900 bg-cover bg-center px-4 py-5 sm:px-5 lg:hidden"
          style={{ backgroundImage: `${PHOTO_SCRIM}, url("${backgroundImage}")` }}
        >
          <h2 className="m-0 text-lg font-extrabold leading-tight tracking-tight text-white">
            Human Resources Information System
          </h2>
          <span aria-hidden="true" className="mt-3.5 block h-1 w-24 rounded-full bg-[#D61E1E]" />
          <p className="m-0 mt-3.5 text-sm leading-relaxed text-white/75">
            Mines and Geosciences Bureau, DENR Region X, Macabalan, Cagayan de Oro City
          </p>
        </div>

        <section
          aria-label="MGB HRIS login"
          className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-5"
        >
          {forcePasswordUser ? (
            <ForcePasswordChangeCard
              loading={forcePasswordLoading}
              onCancel={handleForcePasswordCancel}
              onSubmit={handleForcePasswordSubmit}
              securitySettings={securitySettings}
              user={forcePasswordUser}
            />
          ) : twoFactorChallenge ? (
            <TwoFactorVerification
              initialChallenge={twoFactorChallenge}
              onBack={handleTwoFactorBack}
              onVerified={handleTwoFactorVerified}
            />
          ) : forgotMode ? (
            <motion.div
              className="w-full max-w-[420px]"
              initial="hidden"
              animate="visible"
              variants={fadeIn}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              <ForgotPassword
                onBack={() => setForgotMode(false)}
                onResetSuccess={handleResetSuccess}
                securitySettings={securitySettings}
              />
            </motion.div>
          ) : (
            <LoginCard
              captchaAnswer={captchaAnswer}
              captchaAnswerTone={captchaAnswerTone}
              captchaEnabled={captchaEnabled}
              captchaPrompt={captchaChallenge.prompt}
              captchaResetSeconds={captchaResetSeconds}
              errors={errors}
              form={form}
              loading={loading}
              rememberMe={rememberMe}
              onCaptchaChange={handleCaptchaChange}
              onFieldChange={updateField}
              onForgotPassword={() => {
                setSuccessMessage("");
                setForgotMode(true);
              }}
              onRememberMeChange={(event) => setRememberMe(event.target.checked)}
              onSubmit={handleSubmit}
              serverError={serverError}
              successMessage={successMessage}
              setShowPassword={setShowPassword}
              showPassword={showPassword}
            />
          )}
        </section>

        <footer className="relative px-4 pb-4">
          <p className="m-0 text-center text-xs leading-5 text-slate-400">
            &copy; {new Date().getFullYear()} Mines and Geosciences Bureau &ndash; Human Resources Information System.
            All Rights Reserved.
          </p>
        </footer>
      </div>
    </main>
  );
}
