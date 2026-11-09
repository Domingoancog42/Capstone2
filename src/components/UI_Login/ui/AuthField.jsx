import React, { useId, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import {
  AUTH_CONTROL_BASE_CLASS,
  AUTH_CONTROL_TONE_CLASS,
  AUTH_FOCUS_RING,
  AUTH_HELP_TEXT_CLASS,
  AUTH_LABEL_CLASS,
  cx,
} from "./authTheme";

/**
 * Labelled text input with a leading icon slot, a trailing control slot, and inline validation.
 *
 * `tone` drives the border and ring; passing `error` forces the error tone and wires up
 * `aria-invalid` / `aria-describedby` so the message is announced with the field.
 */
export function AuthField({
  className = "",
  error,
  hint,
  icon: Icon,
  id,
  label,
  rightElement,
  success,
  tone = "idle",
  ...props
}) {
  const generatedId = useId();
  const fieldId = id || props.name || generatedId;
  const messageId = `${fieldId}-message`;
  const activeTone = error ? "error" : success ? "success" : tone;
  const hasMessage = Boolean(error || hint);

  return (
    <div className={cx("w-full", className)} data-validation-field>
      {label ? (
        <label className={AUTH_LABEL_CLASS} htmlFor={fieldId}>
          {label}
        </label>
      ) : null}

      <div className="relative">
        {Icon ? (
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
        ) : null}

        <input
          aria-describedby={hasMessage ? messageId : undefined}
          aria-invalid={Boolean(error)}
          className={cx(
            AUTH_CONTROL_BASE_CLASS,
            AUTH_CONTROL_TONE_CLASS[activeTone] || AUTH_CONTROL_TONE_CLASS.idle,
            Icon ? "pl-10" : "",
            rightElement ? "pr-12" : "",
          )}
          id={fieldId}
          {...props}
        />

        {rightElement}
      </div>

      {error ? (
        <p
          className="m-0 mt-1.5 flex items-center gap-1 text-[11px] font-bold text-rose-700"
          id={messageId}
        >
          <AlertCircle aria-hidden="true" size={13} />
          {error}
        </p>
      ) : hint ? (
        <p
          className={cx(
            AUTH_HELP_TEXT_CLASS,
            success ? "flex items-center gap-1 text-emerald-700" : "",
          )}
          id={messageId}
        >
          {success ? <CheckCircle2 aria-hidden="true" size={13} /> : null}
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * `AuthField` plus a reveal toggle and a Caps Lock warning.
 *
 * The Caps Lock hint is the reason this is a component rather than a prop: silently mistyped
 * passwords are the most common reason a correct credential is rejected, and every password box on
 * these screens should warn about it the same way.
 */
export function PasswordField({ label, onKeyDown, onKeyUp, revealLabel = "password", ...props }) {
  const [revealed, setRevealed] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const trackCapsLock = (event) => {
    if (typeof event.getModifierState === "function") {
      setCapsLockOn(event.getModifierState("CapsLock"));
    }
  };

  return (
    <AuthField
      {...props}
      hint={capsLockOn && !props.error ? "Caps Lock is on." : props.hint}
      label={label}
      onKeyDown={(event) => {
        trackCapsLock(event);
        onKeyDown?.(event);
      }}
      onKeyUp={(event) => {
        trackCapsLock(event);
        onKeyUp?.(event);
      }}
      rightElement={
        <button
          aria-label={revealed ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
          aria-pressed={revealed}
          className={cx(
            "absolute right-2.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-[#D61E1E]",
            AUTH_FOCUS_RING,
          )}
          onClick={() => setRevealed((current) => !current)}
          type="button"
        >
          {revealed ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
        </button>
      }
      type={revealed ? "text" : "password"}
    />
  );
}

export default AuthField;
