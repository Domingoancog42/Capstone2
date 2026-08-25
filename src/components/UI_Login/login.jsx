import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  CircleX,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import {
  forceChangePassword,
  getLoginCaptcha,
  getPublicSettings,
  login,
  logout,
  verifyLoginCaptcha,
} from "../../services/api";
import {
  evaluatePasswordPolicy,
  getPasswordPolicyItems,
  PASSWORD_POLICY_DEFAULT_MAX_LENGTH,
} from "../../utils/passwordPolicy";
import { getRoleLabel, normalizeRole } from "../../utils/roleRoutes";
import ForgotPassword from "./forgot_password";
import LegalConsentNotice from "./legal_documents";
import TwoFactorVerification from "./two_factor_verification";

const REMEMBERED_EMAIL_KEY = "mgb_hris_remembered_email";
const LEGACY_REMEMBERED_USERNAME_KEY = "mgb_hris_remembered_username";
const LOGIN_SUCCESS_ALERT_DURATION_MS = 1500;
const LOGIN_ERROR_ALERT_DURATION_MS = 3500;
/**
 * Only used when captcha.php answers without an `expiresIn` of its own. The server's own TTL is what
 * actually decides whether a challenge is still answerable — this countdown just decides when to ask
 * for the next one, so being a few seconds out costs a refetch and nothing else.
 */
const CAPTCHA_FALLBACK_TTL_SECONDS = 120;

/**
 * How long the answer box keeps its result border before the spent challenge is swapped for a fresh one.
 *
 * The screen only ever learns whether an answer was right from login.php's reply, and by the time that
 * reply arrives the challenge behind it has already been spent — so the border is a receipt for the
 * attempt that just happened, not a state the field can sit in. The number that earned it stays in the
 * box for exactly as long, because a coloured border around an empty box says nothing.
 */
const CAPTCHA_VERDICT_HOLD_MS = 1600;

/**
 * How long an accepted answer stays green before the form gives way to what comes next.
 *
 * Shorter than the hold above, because nothing is waiting on that one -- the user is already being
 * told why the sign-in failed -- whereas this one sits between somebody and their dashboard. Long
 * enough to register as confirmation, short enough not to read as the app being slow.
 */
const CAPTCHA_SUCCESS_HOLD_MS = 700;

/**
 * How often the login screen re-reads /settings.php?section=public.
 *
 * This screen cannot use the long-poll change feed the rest of the app runs on: changes.php requires
 * a session and nobody standing at this form has one. Polling is the only channel available, so an
 * administrator switching the captcha on or off reaches the login screens already open within this
 * window rather than waiting for each to be reloaded by hand. The endpoint reads two settings rows
 * and returns the session's existing CSRF token — it mints nothing and rotates nothing — so repeating
 * it is cheap and cannot disturb a sign-in already in flight.
 */
const PUBLIC_SETTINGS_POLL_INTERVAL_MS = 30000;

/**
 * Shown until /settings.php?section=public answers with the company name and address saved under
 * Settings > System Configuration, so the headings never flash empty on a slow request.
 */
const DEFAULT_BRANDING = {
  companyName: "Human Resources Information System",
  companyAddress: "Mines and Geosciences Bureau, DENR Region X, Macabalan, Cagayan de Oro City",
};

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

/**
 * Normalises what captcha.php dealt into what the field renders.
 *
 * `mode` is the server telling us how the operands travelled: "image" for the noisy image tiles and
 * "text" only for compatibility with an older backend response. New challenges remain visual even
 * when the server has no GD extension.
 */
function readCaptchaChallenge(payload) {
  const captchaId = String(payload?.captchaId || "");

  if (!captchaId) {
    return null;
  }

  return {
    captchaId,
    operator: String(payload?.operator || "+"),
    isImage: payload?.mode === "image",
    left: String(payload?.left || ""),
    right: String(payload?.right || ""),
    expiresIn: Number(payload?.expiresIn) || CAPTCHA_FALLBACK_TTL_SECONDS,
  };
}

/**
 * Who the sign-in toast greets. Staff are greeted by surname -- "Welcome, Dela Cruz" says something
 * about the person, where the role label only said what the system had already sorted them into, and
 * an office where several people share a role got the identical greeting every time. Admins keep the
 * role label: the admin account is a system account rather than a member of staff, and it often has
 * no employee record to draw a surname from. Anyone else missing that record falls back the same way,
 * so the greeting is never blank.
 */
function getWelcomeName(user) {
  const roleLabel = getRoleLabel(user?.roleKey || user?.role || "User");
  const isAdmin = normalizeRole(user?.roleKey || user?.role) === "admin"
    || normalizeRole(user?.baseRoleKey) === "admin";

  if (isAdmin) {
    return roleLabel;
  }

  return String(user?.last_name || "").trim() || roleLabel;
}

/**
 * "05:00" for a lock measured in minutes, "1:05:00" once it runs past the hour. Seconds are always
 * two digits so the number does not change width as it ticks.
 */
function formatLockCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }

  return `${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
}

/**
 * The server's own message spells the unlock moment out in Philippine office time, which is the wrong
 * answer for anyone whose machine is set to something else. This renders the same instant in the
 * viewer's zone instead, and drops the date unless the lock actually runs past midnight.
 */
function formatUnlockMoment(unlockAtMs) {
  const unlockAt = new Date(unlockAtMs);

  if (Number.isNaN(unlockAt.getTime())) {
    return "";
  }

  const isToday = unlockAt.toDateString() === new Date().toDateString();

  return unlockAt.toLocaleString(
    undefined,
    isToday ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }
  );
}

/**
 * Reads the lock out of a rejected sign-in. The seconds the server sends are authoritative -- they are
 * measured on the server's clock, so a device whose own clock is wrong still counts down correctly --
 * and the absolute timestamp is only a fallback for older responses that carry no countdown.
 */
function readLockoutFromResponse(response) {
  const data = response?.data;

  if (!data) {
    return null;
  }

  const secondsRemaining = Number(data.secondsRemaining);

  if (Number.isFinite(secondsRemaining) && secondsRemaining > 0) {
    return { unlockAtMs: Date.now() + (secondsRemaining * 1000) };
  }

  const unlockAtMs = Date.parse(String(data.lockedUntil || ""));

  if (Number.isFinite(unlockAtMs) && unlockAtMs > Date.now()) {
    return { unlockAtMs };
  }

  return null;
}

function formatCaptchaCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

/**
 * `error` accepts either a message or plain `true`. The bare `true` outlines the box in red without
 * printing anything under it, which is how a rejected credential pair marks the email field: both
 * boxes have to look wrong, but the reason is only worth saying once.
 */
/**
 * Every alert on this screen is the same corner toast; only the wording and the icon change. Success
 * toasts are awaited before a redirect, so the promise is handed back to the caller.
 */
function showLoginToast({ icon, text, title }) {
  const isSuccess = icon === "success";

  return Swal.fire({
    title,
    text,
    icon,
    toast: true,
    position: "top-end",
    width: "22rem",
    timer: isSuccess ? LOGIN_SUCCESS_ALERT_DURATION_MS : LOGIN_ERROR_ALERT_DURATION_MS,
    timerProgressBar: true,
    showConfirmButton: false,
    allowOutsideClick: false,
    allowEscapeKey: !isSuccess,
    backdrop: false,
    customClass: isSuccess
      ? {
        popup: "rounded-2xl px-4 py-3",
        title: "text-sm font-semibold text-slate-900",
        htmlContainer: "text-xs text-slate-600",
      }
      : {
        popup: "rounded-md px-4 py-3 shadow-lg",
        title: "text-sm font-semibold leading-6 text-slate-700",
        htmlContainer: "text-xs text-slate-600",
      },
  });
}

/**
 * A rejected attempt has to land on the field the user must fix, not only in the banner above the
 * form: the red outline is what points them back at the right box. Credential failures mark both
 * boxes and keep the server's deliberately vague wording, so the form never leaks which half of the
 * pair was wrong. Anything unrecognised (network trouble, SMTP failures) stays in the banner, where
 * it does not falsely accuse a field.
 *
 * There is deliberately no branch for inactive or archived accounts: login.php answers those with
 * the same "Invalid username or password." as a wrong password, so they land in the credential
 * branch above and the form cannot report an account state the server chose not to disclose.
 */
function mapLoginErrorToFields(message) {
  const normalized = String(message || "").toLowerCase();

  if (
    normalized.includes("invalid username or password")
    || normalized.includes("invalid email or password")
    || normalized.includes("check your credentials")
  ) {
    return { email: true, password: "Invalid email or password." };
  }

  if (normalized.includes("locked") || normalized.includes("too many failed attempts")) {
    return { email: "This account is temporarily locked. Try again later." };
  }

  if (normalized.includes("password has expired")) {
    return { password: "Your password has expired. Use Forgot Password to set a new one." };
  }

  if (normalized.startsWith("email domain") || normalized.includes("valid email is required")) {
    return { email: message };
  }

  if (normalized.includes("username and password are required")) {
    return { email: "Email is required.", password: "Password is required." };
  }

  return {};
}

function LoginField({
  error,
  id,
  label,
  rightElement,
  ...props
}) {
  const errorMessage = typeof error === "string" ? error : "";

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
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          {...props}
        />
        {rightElement}
      </div>
      {errorMessage ? (
        <p id={`${id}-error`} className="m-0 mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700" role="alert">
          <AlertCircle aria-hidden="true" size={13} />
          {errorMessage}
        </p>
      ) : null}
    </label>
  );
}

/**
 * One operand of the sum.
 *
 * `isImage` decides what is inside the box, not what the box looks like: the border, the fill and the
 * size are the same either way, so a server without GD renders a plainer captcha rather than a
 * differently shaped form. The alt text names the position rather than the digit — saying the number
 * would hand back in text exactly what drawing it was meant to withhold.
 */
function CaptchaOperand({ isImage, label, value }) {
  return (
    <span className="grid h-14 w-[70px] shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-300 bg-slate-50">
      {isImage ? (
        <img alt={label} className="h-full w-full object-cover" draggable="false" src={value} />
      ) : (
        // Unselectable so the challenge cannot simply be dragged out of the page.
        <span className="select-none font-mono text-lg font-bold text-slate-800">{value}</span>
      )}
    </span>
  );
}

/**
 * The security check: two operands, the operator between them, and a box for the answer.
 *
 * There is no "I'm not a robot" tick, and the box cannot colour itself as the user types: the challenge
 * is dealt by captcha.php and the answer is known only to the server, so this screen cannot tell
 * whether what has been typed is right — it carries the answer along with the sign-in and login.php is
 * what judges it. That is the whole point of the rework: the old checkbox marked itself, which meant
 * anything skipping this form skipped the captcha entirely.
 *
 * `verdict` is therefore the server's answer rather than a guess made here, and it is the only thing
 * that colours the answer box: red around a number the server refused, green around one it accepted,
 * and nothing around a box nobody has submitted. The box is read-only while it shows that result —
 * that challenge is spent either way, and a replacement is already on its way in.
 *
 * The border is the whole of the visible feedback. No result sentence is added under the field.
 */
function CaptchaVerification({
  answer,
  challenge,
  checking,
  error,
  loading,
  onChange,
  onRefresh,
  resetSecondsRemaining,
  unavailable,
  verdict,
}) {
  // No number in the box, nothing to have judged: the result border needs both to mean anything.
  const showVerdict = Boolean(verdict) && answer.trim() !== "";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700">Security check</span>
        <span aria-live="polite" className="text-xs tabular-nums text-slate-400">
          {challenge && resetSecondsRemaining > 0
            ? `New problem in ${formatCaptchaCountdown(resetSecondsRemaining)}`
            : ""}
        </span>
      </div>

      <div
        className={`mt-1.5 rounded-lg border px-3 py-2.5 transition ${
          error
            ? "border-rose-300 bg-rose-50/40"
            : "border-slate-200 bg-white"
        }`}
      >
        {unavailable ? (
          <div className="flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="shrink-0 text-slate-400" size={15} />
            <p className="m-0 min-w-0 flex-1 text-xs font-medium text-slate-600">
              The security check could not be loaded.
            </p>
            <button
              className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-[#C51A1A] transition hover:bg-rose-50 hover:text-[#A91414] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
              onClick={onRefresh}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1.5">
            {/* Empty boxes while a challenge is on its way, so the row keeps its shape instead of
                collapsing and shunting the Login button up the card. */}
            <CaptchaOperand
              isImage={Boolean(challenge?.isImage) && !loading}
              label="First number of the security check"
              value={loading ? "" : challenge?.left || ""}
            />
            <span aria-hidden="true" className="w-3 shrink-0 text-center text-base font-semibold text-slate-400">
              {loading ? "" : challenge?.operator || ""}
            </span>
            <CaptchaOperand
              isImage={Boolean(challenge?.isImage) && !loading}
              label="Second number of the security check"
              value={loading ? "" : challenge?.right || ""}
            />
            <span aria-hidden="true" className="w-3 shrink-0 text-center text-base font-semibold text-slate-400">
              =
            </span>
            {/* Only this border carries the verdict. The fill and the typed number remain unchanged. */}
            <input
              aria-describedby={error ? "captcha-error" : showVerdict ? "captcha-verdict" : undefined}
              aria-busy={checking}
              aria-invalid={showVerdict ? verdict === "wrong" : Boolean(error)}
              aria-label="Answer to the security check"
              autoComplete="off"
              className={`h-11 w-14 shrink-0 rounded-md border bg-white text-center text-lg font-bold tabular-nums text-slate-900 outline-none transition disabled:bg-slate-50 ${
                showVerdict
                  ? verdict === "correct"
                    ? "border-emerald-500"
                    : "border-rose-500"
                  : "border-slate-300 hover:border-slate-400 focus:border-[#D61E1E]"
              }`}
              // Keep a submitted answer readable while its result border is being shown.
              disabled={loading && !showVerdict}
              id="captcha"
              inputMode="numeric"
              maxLength={1}
              name="captcha"
              onChange={onChange}
              pattern="[0-9]*"
              readOnly={showVerdict || checking}
              type="text"
              value={answer}
            />
            <button
              aria-label="Get a new security check"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
              onClick={onRefresh}
              title="Get a new security check"
              type="button"
            >
              <RotateCw aria-hidden="true" className={loading ? "animate-spin" : ""} size={17} />
            </button>
          </div>
        )}
      </div>

      {error ? (
        <p id="captcha-error" className="m-0 mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700" role="alert">
          <AlertCircle aria-hidden="true" size={13} />
          {error}
        </p>
      ) : showVerdict ? (
        // Keep the result accessible without adding visible text below the CAPTCHA.
        <p className="sr-only" id="captcha-verdict" role={verdict === "correct" ? "status" : "alert"}>
          {verdict === "correct"
            ? "Correct answer."
            : "That answer was not accepted. A new security check is on its way."}
        </p>
      ) : null}
    </div>
  );
}

function LoginCard({
  captchaAnswer,
  captchaChallenge,
  captchaChecking,
  captchaEnabled,
  captchaLoading,
  captchaResetSeconds,
  captchaUnavailable,
  captchaVerdict,
  errors,
  form,
  loading,
  lockout,
  rememberMe,
  onCaptchaChange,
  onCaptchaRefresh,
  onFieldChange,
  onForgotPassword,
  onRememberMeChange,
  onSubmit,
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

      {/*
        * The lock notice outranks the plain error banner and outlives it: the generic message clears
        * the moment the user edits a field, but a lock is a fact about the account, so it stays put
        * and keeps counting until that account is free again — or until the email in the box becomes a
        * different one, which the caller decides.
        */}
      {lockout ? (
        <div className="mt-5 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5" role="alert">
          <ShieldAlert aria-hidden="true" className="shrink-0 text-rose-700" size={15} />
          <p className="m-0 min-w-0 flex-1 text-xs font-medium leading-5 text-rose-700">
            <span className="font-bold text-rose-800">Account locked.</span> Try again at{" "}
            {formatUnlockMoment(lockout.unlockAtMs)}.
          </p>
          <span
            className="shrink-0 font-mono text-sm font-bold tabular-nums text-rose-800"
            aria-live="polite"
          >
            {formatLockCountdown(lockout.secondsRemaining)}
          </span>
        </div>
      ) : serverError ? (
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
          <CaptchaVerification
            answer={captchaAnswer}
            challenge={captchaChallenge}
            checking={captchaChecking}
            error={errors.captcha}
            loading={captchaLoading}
            onChange={onCaptchaChange}
            onRefresh={onCaptchaRefresh}
            resetSecondsRemaining={captchaResetSeconds}
            unavailable={captchaUnavailable}
            verdict={captchaVerdict}
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
          disabled={loading || captchaChecking}
          type="submit"
        >
          {/*
            * Never disabled by a lock, and never relabelled by one. A lock belongs to one account, so a
            * dead button would also turn away the next person at the same machine — and login.php checks
            * `locked_until` before it looks at the password, so a submission against a locked account is
            * refused without costing an attempt or extending the lock. The notice above is what explains
            * the refusal.
            */}
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

      {/*
        * Outside the form: the two links open dialogs, and a button inside a <form> that stops short
        * of type="button" submits it. Keeping them out of the form removes that trap entirely.
        */}
      <LegalConsentNotice className="mt-5 border-t border-slate-100 pt-4" />
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
  const [captchaChallenge, setCaptchaChallenge] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaChecking, setCaptchaChecking] = useState(false);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [captchaEnabled, setCaptchaEnabled] = useState(true);
  const [captchaResetSeconds, setCaptchaResetSeconds] = useState(0);
  /*
   * "correct", "wrong", or nothing at all — set only by login.php's reply, never by anything typed
   * here. It is what makes the answer box glow, and it is the reason the glow can be trusted: the
   * screen has no way to check a sum, so a colour reachable any other way would be a colour that means
   * nothing.
   */
  const [captchaVerdict, setCaptchaVerdict] = useState("");
  const [rememberMe, setRememberMe] = useState(Boolean(rememberedEmail));
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockout, setLockout] = useState(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [securitySettings, setSecuritySettings] = useState({});
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [forcePasswordUser, setForcePasswordUser] = useState(null);
  const [forcePasswordLoading, setForcePasswordLoading] = useState(false);

  /*
   * One request at a time. Two things ask for a challenge — the effect below, and every path that has
   * just spent one — and both can fire in the same breath after a rejected sign-in. Without this the
   * second request would deal a third challenge that overwrites the second in the session, leaving the
   * user looking at a problem the server has already forgotten.
   */
  const captchaRequestRef = useRef(false);

  // Invalidates a live-check response when the answer or challenge changes while it is in flight.
  const captchaCheckSequenceRef = useRef(0);

  /*
   * The pending swap of a spent challenge for a fresh one, kept so it can be called off. Leaving it to
   * run after the card is gone would deal a challenge for a form nobody is looking at, and leaving a
   * second one queued on top of the first would clear the green early.
   */
  const captchaVerdictTimerRef = useRef(null);

  const cancelCaptchaVerdictHold = useCallback(() => {
    if (captchaVerdictTimerRef.current) {
      window.clearTimeout(captchaVerdictTimerRef.current);
      captchaVerdictTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    captchaCheckSequenceRef.current += 1;
    cancelCaptchaVerdictHold();
  }, [cancelCaptchaVerdictHold]);

  /**
   * Fetches a challenge from captcha.php. Nothing here knows the answer, so there is nothing to compare
   * against and nothing this can colour the box with — the digits are put on screen, whatever the user
   * types is carried to login.php with the sign-in, and the red or the green comes back with its reply.
   *
   * A failure raises `captchaUnavailable`, which does two jobs: it puts the "could not be loaded"
   * state and its retry button in front of the user, and it stops the effect below from asking again.
   * Without that second job a server that is refusing the request — down, or rate-limiting this
   * address — would be asked again on every render, by a screen whose whole purpose is to be sitting
   * open in front of somebody. Retrying is the user's to ask for, through the button.
   */
  const loadCaptchaChallenge = useCallback(async () => {
    if (captchaRequestRef.current) {
      return;
    }

    captchaRequestRef.current = true;
    captchaCheckSequenceRef.current += 1;
    setCaptchaChecking(false);
    setCaptchaLoading(true);
    setCaptchaUnavailable(false);
    setCaptchaAnswer("");
    // A new problem has no verdict yet, so the glow goes out before the digits arrive.
    setCaptchaVerdict("");

    try {
      const payload = await getLoginCaptcha();

      /*
       * The administrator turned the captcha off between this screen's last settings poll and now.
       * Taking the endpoint's word for it immediately spares the user a field that reports itself
       * broken for up to thirty seconds while the poll catches up — and login.php reads the same
       * setting, so it is not going to ask for an answer the screen no longer shows.
       */
      if (payload?.enabled === false) {
        setCaptchaEnabled(false);
        setCaptchaChallenge(null);
        setCaptchaResetSeconds(0);
        return;
      }

      const challenge = readCaptchaChallenge(payload);

      setCaptchaChallenge(challenge);
      setCaptchaResetSeconds(challenge ? challenge.expiresIn : 0);
      setCaptchaUnavailable(!challenge);
    } catch {
      setCaptchaChallenge(null);
      setCaptchaResetSeconds(0);
      setCaptchaUnavailable(true);
    } finally {
      setCaptchaLoading(false);
      captchaRequestRef.current = false;
    }
  }, []);

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

        /*
         * Both of these hand back the object they were given whenever nothing actually moved. This
         * runs every poll now rather than once at mount, and a fresh object identity each time would
         * re-render the whole screen every thirty seconds for settings that change once a year.
         */
        setSecuritySettings((current) => {
          const next = result.security || {};

          return current.maximumPasswordLength === next.maximumPasswordLength
            && current.sessionTimeoutMinutes === next.sessionTimeoutMinutes
            ? current
            : next;
        });
        setBranding((current) => {
          const companyName = String(result.branding?.companyName || "").trim() || current.companyName;
          const companyAddress = String(result.branding?.companyAddress || "").trim() || current.companyAddress;

          return companyName === current.companyName && companyAddress === current.companyAddress
            ? current
            : { companyName, companyAddress };
        });

        // Whatever was typed into a captcha that has just been switched off is no longer an answer
        // to anything, and the error under it would otherwise outlive the field itself. The challenge
        // goes with it, so switching the captcha back on deals a fresh one rather than resurrecting a
        // problem captcha.php has already dropped from the session.
        if (!enabled) {
          captchaCheckSequenceRef.current += 1;
          setCaptchaChecking(false);
          setCaptchaAnswer("");
          setCaptchaChallenge(null);
          setCaptchaResetSeconds(0);
          setCaptchaVerdict("");
          setErrors((current) => ({ ...current, captcha: "" }));
        }
      } catch {
        /*
         * Keep the last answer the server gave. The initial state is `true`, so a failure before the
         * first successful read still puts a captcha up — but once one has succeeded, a dropped poll
         * is no reason to plant a captcha in front of someone the administrator turned it off for.
         */
      }
    };

    loadPublicSettings();

    // Focus covers the common case directly: a tab left sitting open is current the moment it is used.
    const intervalId = window.setInterval(loadPublicSettings, PUBLIC_SETTINGS_POLL_INTERVAL_MS);
    window.addEventListener("focus", loadPublicSettings);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadPublicSettings);
    };
  }, []);

  /*
   * Drives the countdown in the form. Each tick is measured against the unlock instant rather than by
   * subtracting one, so a throttled background tab cannot leave the form claiming time the user has
   * already waited out. Reaching zero clears the notice and the field outlines together, without a
   * reload. It ticks against the raw lock rather than the visible one, so a countdown the user has
   * navigated away from by retyping the email is still accurate if they type it back.
   */
  useEffect(() => {
    if (!lockout) {
      return undefined;
    }

    if (lockout.secondsRemaining <= 0) {
      setLockout(null);
      setServerError("");
      setErrors((current) => ({ ...current, email: "", password: "" }));
      return undefined;
    }

    const tick = window.setTimeout(() => {
      setLockout((current) => (
        current
          ? { ...current, secondsRemaining: Math.ceil((current.unlockAtMs - Date.now()) / 1000) }
          : current
      ));
    }, 1000);

    return () => {
      window.clearTimeout(tick);
    };
  }, [lockout]);

  /*
   * A lock sits on one account — `users.locked_until` is a column on the row that ran out of attempts —
   * so it must not hold the whole form shut. Someone sharing the machine, or the same person with a
   * second account, has to be able to sign in while another account waits out its lock. The notice
   * therefore stands only while the email in the box is still the one that was locked; typing any other
   * address puts the form back to normal, and typing the locked one back brings the live countdown with
   * it.
   */
  const visibleLockout =
    lockout && lockout.email === form.email.trim().toLowerCase() ? lockout : null;

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setServerError("");
    setSuccessMessage("");
  };

  /**
   * Deals a new challenge and nothing else. A failed attempt has to reset the captcha *and* keep the
   * message explaining why it failed, so the two are separate: clearing the banner in the same batch
   * that set it is what used to leave the toast as the only feedback.
   */
  const resetCaptchaChallenge = () => {
    loadCaptchaChallenge();
  };

  const refreshCaptcha = () => {
    cancelCaptchaVerdictHold();
    setErrors((current) => ({ ...current, captcha: "" }));
    setServerError("");
    setSuccessMessage("");
    loadCaptchaChallenge();
  };

  /**
   * Drops the challenge without asking for another. Used once the sign-in has been accepted: the
   * server has already spent that challenge, so keeping it on screen would only guarantee a refusal
   * if the user comes back — and fetching a replacement now would deal one for a form that is either
   * about to be replaced by the two-factor step or about to disappear entirely. The effect above
   * deals a fresh one if and when the login card is put back in front of somebody.
   */
  const clearCaptchaChallenge = () => {
    cancelCaptchaVerdictHold();
    captchaCheckSequenceRef.current += 1;
    setCaptchaChecking(false);
    setCaptchaChallenge(null);
    setCaptchaAnswer("");
    setCaptchaResetSeconds(0);
    setCaptchaVerdict("");
    setErrors((current) => ({ ...current, captcha: "" }));
  };

  /*
   * Keeps a challenge in front of whoever is looking at the sign-in form, and only then. The screens
   * that cover it — Forgot Password, the two-factor step, the forced password change — have no captcha
   * to answer, so leaving one dealt behind them would only let it expire unseen. Coming back from any
   * of them deals a fresh one.
   */
  useEffect(() => {
    if (!captchaEnabled || forgotMode || forcePasswordUser || twoFactorChallenge) {
      return;
    }

    if (!captchaChallenge && !captchaLoading && !captchaUnavailable) {
      loadCaptchaChallenge();
    }
  }, [
    captchaChallenge,
    captchaEnabled,
    captchaLoading,
    captchaUnavailable,
    forcePasswordUser,
    forgotMode,
    loadCaptchaChallenge,
    twoFactorChallenge,
  ]);

  /*
   * Rolls the challenge over before it goes stale. captcha-utils.php measures the real expiry against
   * the server's clock and refuses anything older, so this countdown is a convenience rather than the
   * guard: at worst a slow device submits an expired answer, is told so, and is handed a new problem.
   * The banner from the last attempt stays put through a rollover — only the challenge is replaced.
   */
  useEffect(() => {
    if (!captchaEnabled || forgotMode || forcePasswordUser || twoFactorChallenge) {
      return undefined;
    }

    if (!captchaChallenge || captchaLoading) {
      return undefined;
    }

    if (captchaResetSeconds <= 0) {
      loadCaptchaChallenge();
      return undefined;
    }

    const countdown = window.setTimeout(() => {
      setCaptchaResetSeconds((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => {
      window.clearTimeout(countdown);
    };
  }, [
    captchaChallenge,
    captchaEnabled,
    captchaLoading,
    captchaResetSeconds,
    forcePasswordUser,
    forgotMode,
    loadCaptchaChallenge,
    twoFactorChallenge,
  ]);

  /*
   * Digits only, and never more than three of them — the largest answer a single-digit sum can have is
   * eighteen, so anything longer is a slip rather than an answer. There is nothing to compare it
   * against here: the sum is checked by login.php when the form is submitted.
   */
  const handleCaptchaChange = async (event) => {
    const answer = event.target.value.replace(/\D/g, "").slice(0, 1);
    const challengeId = captchaChallenge?.captchaId || "";
    const checkSequence = captchaCheckSequenceRef.current + 1;

    captchaCheckSequenceRef.current = checkSequence;
    cancelCaptchaVerdictHold();
    setCaptchaAnswer(answer);
    setCaptchaChecking(false);
    setCaptchaVerdict("");
    setErrors((current) => ({ ...current, captcha: "" }));
    setServerError("");
    setSuccessMessage("");

    if (!answer || !challengeId) {
      return;
    }

    setCaptchaChecking(true);

    try {
      const result = await verifyLoginCaptcha(challengeId, answer);

      if (captchaCheckSequenceRef.current !== checkSequence) {
        return;
      }

      if (result?.enabled === false) {
        setCaptchaEnabled(false);
        setCaptchaChallenge(null);
        setCaptchaAnswer("");
        setCaptchaResetSeconds(0);
        return;
      }

      if (result?.correct === true) {
        setCaptchaVerdict("correct");
        return;
      }

      setCaptchaVerdict("wrong");
      captchaVerdictTimerRef.current = window.setTimeout(() => {
        captchaVerdictTimerRef.current = null;

        if (result?.refresh) {
          resetCaptchaChallenge();
          return;
        }

        setCaptchaAnswer("");
        setCaptchaVerdict("");
      }, CAPTCHA_VERDICT_HOLD_MS);
    } catch (requestError) {
      if (captchaCheckSequenceRef.current !== checkSequence) {
        return;
      }

      setErrors((current) => ({
        ...current,
        captcha: requestError?.response?.data?.message || "The answer could not be checked. Try again.",
      }));
    } finally {
      if (captchaCheckSequenceRef.current === checkSequence) {
        setCaptchaChecking(false);
      }
    }
  };

  const validate = () => {
    const nextErrors = {};

    if (!form.email.trim()) {
      nextErrors.email = "Email is required.";
    }

    if (!form.password) {
      nextErrors.password = "Password is required.";
    }

    /*
     * All this can check is that there is something to send. Whether the answer is *right* is not
     * knowable here — the server keeps it — so the form no longer pretends to verify anything before
     * submitting, and a wrong sum comes back from login.php as a rejected attempt.
     */
    if (captchaEnabled) {
      if (!captchaChallenge) {
        nextErrors.captcha = "The security check could not be loaded. Refresh it and try again.";
      } else if (!captchaAnswer.trim()) {
        nextErrors.captcha = "Answer the security check before signing in.";
      }
    }

    setErrors(nextErrors);

    const messages = Object.values(nextErrors).filter(Boolean);

    setServerError("");

    if (messages.length === 0) {
      return true;
    }

    /*
     * The inline text says which box is wrong; the toast makes sure a blocked attempt is noticed even
     * when the button is far from the offending field. A wrong captcha answer is the more specific
     * complaint, so it speaks for itself instead of being folded into the list.
     */
    showLoginToast({
      icon: "error",
      title: "Check your login details",
      text: messages.join(" "),
    });

    return false;
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

  /**
   * One landing point for every rejected attempt. A lock announces itself through the notice in the
   * form and nothing else — it already states the account, the unlock time and a running countdown,
   * and a dialog over the top of it only adds a click between the user and something they can plainly
   * see. Ordinary failures keep the corner toast, and in both cases the reason is written into the
   * form itself.
   */
  const handleLoginFailure = (message, response, attemptedEmail) => {
    const responseLockout = readLockoutFromResponse(response);
    /*
     * login.php sets this when the attempt died at the captcha, before the account was ever looked up.
     * Such an attempt says nothing at all about the credentials, so the message belongs under the
     * captcha and the email and password boxes must be left unmarked — outlining them would accuse the
     * user of a mistake they did not make.
     */
    const captchaFailed = response?.data?.captchaFailed === true;

    /*
     * The one moment this screen can honestly call an answer correct, and the reason the green can be
     * trusted at all.
     *
     * A 401 or a 423 is a verdict on the credentials or on the account, and login.php cannot reach
     * either until the captcha has been verified and spent — so either status is the server saying, on
     * its way to refusing the sign-in for some other reason, that the sum was right. Nothing else
     * qualifies: the rate limiter's 429 and a rejected CSRF token are both returned *before* the
     * captcha is looked at, and a request that never arrived proves nothing either way. Being wrong in
     * that direction only costs a plain box, which is what the field would have shown anyway.
     */
    const captchaAccepted = captchaEnabled
      && Boolean(captchaChallenge)
      && captchaAnswer.trim() !== ""
      && !captchaFailed
      && [401, 423].includes(Number(response?.status));

    /*
     * A refused sum says nothing worth writing down, so it is not written down: the red ring around
     * the answer box, and the fresh problem that replaces it a moment later, are the feedback. Every
     * other kind of failure still explains itself, because none of those is visible in the form.
     */
    setServerError(captchaFailed ? "" : message);
    setErrors(captchaFailed ? {} : mapLoginErrorToFields(message));

    if (responseLockout) {
      setLockout({
        // Which account the lock belongs to, so the form can tell it apart from the next one typed.
        email: String(attemptedEmail || "").trim().toLowerCase(),
        unlockAtMs: responseLockout.unlockAtMs,
        secondsRemaining: Math.ceil((responseLockout.unlockAtMs - Date.now()) / 1000),
      });
      setForm((current) => ({ ...current, password: "" }));
      setShowPassword(false);
    } else if (!captchaFailed) {
      // No toast for a refused sum either -- a dialog in the corner explaining the colour of a box
      // the user is already looking at is the same message a third time.
      showLoginToast({
        icon: "error",
        title: "Login Failed",
        text: message,
      });
    }

    /*
     * Always, whatever went wrong. A correct answer is spent by login.php the moment it is checked and
     * a wrong one is on its way to being thrown away, so the challenge on screen is either already
     * dead or nearly so — carrying it into the next attempt would only earn a second refusal.
     *
     * What waits is the swap itself, whenever there is a verdict to show. Dealing the new problem
     * immediately blanks the box, and a glow around an empty box tells the user nothing — so the number
     * they typed is left where they typed it, ringed in red or in green, for as long as it takes to see
     * which. Only the glow and the number go with the swap; the message underneath outlives it.
     */
    cancelCaptchaVerdictHold();

    const verdict = captchaAccepted ? "correct" : captchaFailed ? "wrong" : "";

    if (verdict) {
      setCaptchaVerdict(verdict);
      captchaVerdictTimerRef.current = window.setTimeout(() => {
        captchaVerdictTimerRef.current = null;
        resetCaptchaChallenge();
      }, CAPTCHA_VERDICT_HOLD_MS);
      return;
    }

    resetCaptchaChallenge();
  };

  /**
   * Rings the answer box green and waits long enough for it to be seen.
   *
   * login.php cannot reach the credentials until the sum has been checked and spent, so an accepted
   * sign-in is the server confirming the answer just as surely as a 401 is. That case used to be the
   * only one that never showed it: the challenge was simply dropped and the form replaced, which
   * meant the box turned green for everyone except the people who got everything right.
   *
   * Resolves at once when there is nothing to colour -- captcha off, no challenge, an empty box --
   * so a sign-in is never held up for a glow that was not going to appear.
   */
  const holdCaptchaCorrect = async () => {
    if (!captchaEnabled || !captchaChallenge || captchaAnswer.trim() === "") {
      return;
    }

    // The live check already showed this result before Login was clicked.
    if (captchaVerdict === "correct") {
      return;
    }

    cancelCaptchaVerdictHold();
    setCaptchaVerdict("correct");

    await new Promise((resolve) => {
      window.setTimeout(resolve, CAPTCHA_SUCCESS_HOLD_MS);
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    /*
     * The glowing box is showing an answer login.php has already spent, and its replacement is a second
     * away. Sending it again would earn a rejection the user did nothing to deserve, so a click landing
     * inside that window does nothing at all and the fresh problem arrives as it was going to.
     */
    if (captchaEnabled && (captchaChecking || captchaVerdict === "wrong")) {
      return;
    }

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
        // Which challenge is being answered, and with what. Neither means anything without the other,
        // and the pair is only worth anything to the session that was dealt it.
        captchaId: captchaChallenge?.captchaId || "",
        captchaAnswer,
      });

      if (!result || result.success === false || (!result.requiresTwoFactor && !result.user)) {
        const message = result?.message || "Login failed. Please check your credentials and try again.";
        handleLoginFailure(message, { data: result }, username);
        return;
      }

      persistRememberedEmail(username);

      /*
       * The spinner stops before the glow starts. Both the digits and the Login button key off
       * `loading`, and the operand boxes blank themselves while it is set -- a green ring beside two
       * empty boxes would be a strange thing to leave somebody with. Clicking Login again during the
       * hold does nothing: handleSubmit turns away while a verdict is standing.
       */
      setLoading(false);
      await holdCaptchaCorrect();
      clearCaptchaChallenge();

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

      await showLoginToast({
        icon: "success",
        title: `Welcome, ${getWelcomeName(result.user)}`,
        text: "Login successful. Redirecting to your dashboard!",
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

      handleLoginFailure(message, error.response, username);
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
    resetCaptchaChallenge();
  };

  const handleTwoFactorVerified = async (verifiedUser) => {
    if (verifiedUser?.must_change_password) {
      setTwoFactorChallenge(null);
      setForcePasswordUser(verifiedUser);
      return;
    }

    await showLoginToast({
      icon: "success",
      title: `Welcome, ${getWelcomeName(verifiedUser)}`,
      text: "Verification successful. Redirecting to your dashboard!",
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
      await showLoginToast({
        icon: "success",
        title: "Password Changed",
        text: "Your password has been updated. Redirecting to your dashboard!",
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
            {branding.companyName}
          </h2>
          <span aria-hidden="true" className="mt-6 block h-[5px] w-40 rounded-full bg-[#D61E1E]" />
          <p className="m-0 mt-6 max-w-[46ch] text-[15px] leading-relaxed text-white/80">
            {branding.companyAddress}
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
            {branding.companyName}
          </h2>
          <span aria-hidden="true" className="mt-3.5 block h-1 w-24 rounded-full bg-[#D61E1E]" />
          <p className="m-0 mt-3.5 text-sm leading-relaxed text-white/75">
            {branding.companyAddress}
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
              captchaChallenge={captchaChallenge}
              captchaChecking={captchaChecking}
              captchaEnabled={captchaEnabled}
              captchaLoading={captchaLoading}
              captchaResetSeconds={captchaResetSeconds}
              captchaUnavailable={captchaUnavailable}
              captchaVerdict={captchaVerdict}
              errors={errors}
              form={form}
              loading={loading}
              lockout={visibleLockout}
              rememberMe={rememberMe}
              onCaptchaChange={handleCaptchaChange}
              onCaptchaRefresh={refreshCaptcha}
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
            &copy; {new Date().getFullYear()} {branding.companyName}. All Rights Reserved.
          </p>
        </footer>
      </div>
    </main>
  );
}
