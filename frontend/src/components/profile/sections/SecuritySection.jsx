import React, { useState } from "react";
import { Clock3, History, LoaderCircle, LockKeyhole, ShieldCheck, ShieldOff } from "lucide-react";
import Button from "../../UI/button";
import ProfileFloatingCard from "../ProfileFloatingCard";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId } from "../profileUtils";

// Audit actions arrive dotted and snake_cased, e.g. "two_factor.verify_success".
function formatActivityAction(action = "") {
  return String(action || "")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatActivityContext(item = {}) {
  return [item.ipAddress, item.browser, item.device].filter(Boolean).join(" - ") || "Unknown device";
}

function formatDateTime(value) {
  if (!value) {
    return "Not yet verified";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ToggleButton({ checked, disabled, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex h-8 w-14 shrink-0 items-center rounded-full border p-1 transition focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20 disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "border-[#D61E1E] bg-[#D61E1E]" : "border-slate-300 bg-slate-100",
      ].join(" ")}
    >
      <span
        className={[
          "h-5 w-5 rounded-full bg-white shadow transition",
          checked ? "translate-x-6" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

function passwordExpiryTone(daysUntilExpiry = 0, hasExpired = false) {
  if (hasExpired || daysUntilExpiry <= 3) {
    return {
      panel: "border-rose-200 bg-rose-50",
      icon: "bg-rose-100 text-rose-700",
      title: "text-rose-950",
      text: "text-rose-700",
      badge: "border-rose-200 bg-white text-rose-700",
    };
  }

  if (daysUntilExpiry <= 7) {
    return {
      panel: "border-orange-200 bg-orange-50",
      icon: "bg-orange-100 text-orange-700",
      title: "text-orange-950",
      text: "text-orange-700",
      badge: "border-orange-200 bg-white text-orange-700",
    };
  }

  if (daysUntilExpiry <= 14) {
    return {
      panel: "border-amber-200 bg-amber-50",
      icon: "bg-amber-100 text-amber-700",
      title: "text-amber-950",
      text: "text-amber-700",
      badge: "border-amber-200 bg-white text-amber-700",
    };
  }

  return {
    panel: "border-emerald-200 bg-emerald-50",
    icon: "bg-emerald-100 text-emerald-700",
    title: "text-emerald-950",
    text: "text-emerald-700",
    badge: "border-emerald-200 bg-white text-emerald-700",
  };
}

function PasswordExpiryStatus({ passwordExpiry }) {
  if (!passwordExpiry?.enabled || passwordExpiry?.daysUntilExpiry == null) {
    return null;
  }

  const daysUntilExpiry = Number(passwordExpiry.daysUntilExpiry);

  if (!Number.isFinite(daysUntilExpiry)) {
    return null;
  }

  const hasExpired = Boolean(passwordExpiry.hasExpired) || daysUntilExpiry <= 0;
  const safeDaysUntilExpiry = Math.max(0, daysUntilExpiry);
  const tone = passwordExpiryTone(daysUntilExpiry, hasExpired);
  const title = hasExpired
    ? "Password expired"
    : daysUntilExpiry <= 14
      ? "Password expiring soon"
      : "Password status";
  const badgeText = hasExpired
    ? "Expired"
    : `${safeDaysUntilExpiry} ${safeDaysUntilExpiry === 1 ? "day" : "days"} left`;
  const expiryDateText = passwordExpiry.expiryDate ? formatDateTime(passwordExpiry.expiryDate) : "";

  return (
    <div className={`rounded-xl border p-4 ${tone.panel}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone.icon}`}>
            <LockKeyhole size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={`m-0 text-base font-semibold ${tone.title}`}>{title}</h4>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${tone.badge}`}>
                {badgeText}
              </span>
            </div>
            <p className={`m-0 mt-2 text-sm leading-6 ${tone.text}`}>
              {hasExpired
                ? "Use Forgot Password to set a new password before signing in again."
                : expiryDateText
                  ? `Your current password expires on ${expiryDateText}.`
                  : "Your password expiry date is being tracked from the next password change."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecuritySection({
  loading = false,
  saving = false,
  twoFactor = null,
  passwordExpiry = null,
  onTogglePersonalTwoFactor,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const personalEnabled = Boolean(twoFactor?.personalEnabled);
  const requiredForCurrentUser = Boolean(twoFactor?.requiredForCurrentUser);
  const systemEnabled = Boolean(twoFactor?.systemSettings?.enabled);
  const loginActivity = Array.isArray(twoFactor?.loginActivity) ? twoFactor.loginActivity : [];

  return (
    <>
      <ProfileSectionCard
        id={profileSectionAnchorId("security")}
        icon={ShieldCheck}
        title="Security"
        description="Review password expiry, manage account verification, and securely update your password or email address."
        readOnly={false}
      >
        {loading ? (
          <div className="grid min-h-[220px] place-items-center rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-center">
              <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={26} />
              <p className="m-0 mt-3 text-sm font-semibold text-slate-600">Loading security settings...</p>
            </div>
          </div>
        ) : (
          <>
            <PasswordExpiryStatus passwordExpiry={passwordExpiry} />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
                      personalEnabled
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border border-slate-200 bg-slate-50 text-slate-500"
                    }`}>
                      {personalEnabled ? <ShieldCheck size={19} /> : <ShieldOff size={19} />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="m-0 text-sm font-semibold text-slate-950">Personal 2FA</h4>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          personalEnabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        }`}>
                          {personalEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <p className="m-0 mt-1.5 text-sm leading-6 text-slate-600">
                        {personalEnabled
                          ? "Your account asks for an emailed verification code during login when system 2FA is enabled."
                          : "Enable this to require an emailed verification code for your account when system 2FA is available."}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                    <ToggleButton
                      checked={personalEnabled}
                      disabled={saving}
                      onClick={onTogglePersonalTwoFactor}
                    />
                    <span className="text-[11px] font-semibold text-slate-500">
                      {saving ? "Updating..." : personalEnabled ? "Turn off" : "Turn on"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                  <p className="m-0 text-xs font-medium text-slate-500">
                    Review your recent OTP verification and login events.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={History}
                    onClick={() => setHistoryOpen(true)}
                  >
                    History
                  </Button>
                </div>

                {!systemEnabled ? (
                  <p className="m-0 border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
                    System-wide 2FA is currently disabled by the administrator.
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="m-0 text-sm font-bold text-slate-950">Current Login Rule</p>
                <p className={`m-0 mt-3 text-lg font-extrabold ${requiredForCurrentUser ? "text-[#D61E1E]" : "text-slate-700"}`}>
                  {requiredForCurrentUser ? "OTP Required" : "OTP Optional"}
                </p>
                <p className="m-0 mt-2 text-sm leading-6 text-slate-500">
                  Rule priority: system setting, role requirement, then personal setting.
                </p>
              </div>
            </div>
          </>
        )}
      </ProfileSectionCard>

      <ProfileFloatingCard
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        icon={History}
        badge={ShieldCheck}
        title="2FA History"
        subtitle="Review your latest verification and recent two-factor authentication activity."
        maxWidth="max-w-2xl"
        bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5"
        closeLabel="Close 2FA history"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-[#D61E1E]">
                <Clock3 size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Last Verification
                </p>
                <p className="m-0 mt-1.5 text-sm font-semibold text-slate-950">
                  {formatDateTime(twoFactor?.lastVerificationAt)}
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <History size={17} className="text-slate-500" aria-hidden="true" />
                <p className="m-0 text-sm font-bold text-slate-950">Login Activity</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {loginActivity.length} {loginActivity.length === 1 ? "event" : "events"}
              </span>
            </div>
            <div className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
              {loginActivity.length > 0 ? (
                loginActivity.map((item, index) => (
                  <div key={`${item.createdAt || "activity"}-${index}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-slate-900">
                        {formatActivityAction(item.action)}
                      </p>
                      <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                        {formatActivityContext(item)}
                      </p>
                    </div>
                    <p className="m-0 text-xs font-semibold text-slate-500">
                      {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center">
                  <History className="mx-auto text-slate-300" size={26} aria-hidden="true" />
                  <p className="m-0 mt-2 text-sm font-semibold text-slate-600">
                    No verification activity yet
                  </p>
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    Successful and failed OTP events will appear here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </ProfileFloatingCard>
    </>
  );
}
