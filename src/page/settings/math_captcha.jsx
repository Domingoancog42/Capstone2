import React from "react";
import { ShieldCheck } from "lucide-react";
import { SettingsPanel, SettingsToggleRow } from "../../components/settings";

export default function MathCaptchaSettings({
  enabled = true,
  message = "",
  messageTone = "info",
  saving = false,
  onToggle,
}) {
  return (
    <SettingsPanel
      icon={ShieldCheck}
      title="Login Security"
      description="Control whether the login page requires a math captcha before users can sign in."
      notice={message}
      noticeTone={messageTone}
      actions={
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            enabled ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
          }`}
        >
          {enabled ? "Captcha enabled" : "Captcha disabled"}
        </span>
      }
    >
      <SettingsToggleRow
        id="loginMathCaptcha"
        icon={ShieldCheck}
        label="Login math verification"
        description="When enabled, users must answer a math captcha on the login page before access is granted."
        checked={enabled}
        disabled={saving}
        onToggle={onToggle}
      />
    </SettingsPanel>
  );
}
