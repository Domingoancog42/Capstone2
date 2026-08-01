import React from "react";
import { ShieldCheck, ShieldUser, UsersRound } from "lucide-react";
import Button from "../../components/UI/button";
import {
  SettingsNumberField,
  SettingsPanel,
  SettingsToggleRow,
} from "../../components/settings";

const roleRequirements = [
  {
    key: "requireAdmins",
    label: "Require 2FA for Administrators",
    description: "Applies to administrator accounts when system 2FA is enabled.",
    icon: ShieldUser,
  },
  {
    key: "requireHr",
    label: "Require 2FA for HR",
    description: "Applies to HR Head and HR Staff accounts.",
    icon: UsersRound,
  },
  {
    key: "requireManagers",
    label: "Require 2FA for Managers",
    description: "Applies to Chief and Regional Director accounts.",
    icon: UsersRound,
  },
  {
    key: "requireAllUsers",
    label: "Require 2FA for All Users",
    description: "Every active user must verify an emailed code before dashboard access.",
    icon: ShieldCheck,
  },
];

const timingFields = [
  { key: "otpExpiryMinutes", label: "OTP expiration", min: 5, max: 15, suffix: "minutes" },
  { key: "maxAttempts", label: "Maximum verification attempts", min: 3, max: 10, suffix: "attempts" },
  { key: "resendDelaySeconds", label: "Resend OTP timer", min: 0, max: 60, suffix: "seconds" },
];

export default function TwoFactorAuthenticationSettings({
  errors = {},
  form = {},
  message = "",
  messageTone = "info",
  saving = false,
  onFieldChange,
  onSave,
  onToggle,
}) {
  const systemEnabled = Boolean(form.enabled);

  return (
    <SettingsPanel
      icon={ShieldCheck}
      title="Two-Factor Authentication"
      description="Require email verification codes before users can open their role dashboard."
      notice={message}
      noticeTone={messageTone}
      onSubmit={onSave}
      footer={
        <Button type="submit" icon={ShieldCheck} loading={saving}>
          Save 2FA
        </Button>
      }
    >
      <div className="grid gap-3">
        <SettingsToggleRow
          id="twoFactorEnabled"
          icon={ShieldCheck}
          label="Enable system-wide 2FA"
          description="When disabled, no user is asked for an OTP even if role or personal preferences are enabled."
          checked={systemEnabled}
          disabled={saving}
          onToggle={() => onToggle?.("enabled")}
        />

        {roleRequirements.map((item) => (
          <SettingsToggleRow
            key={item.key}
            id={item.key}
            icon={item.icon}
            label={item.label}
            description={item.description}
            checked={Boolean(form[item.key])}
            disabled={saving || !systemEnabled}
            onToggle={() => onToggle?.(item.key)}
          />
        ))}

        <div className="grid gap-3 lg:grid-cols-3">
          {timingFields.map((field) => (
            <SettingsNumberField
              key={field.key}
              name={field.key}
              label={field.label}
              suffix={field.suffix}
              helper={`Allowed range: ${field.min} to ${field.max}.`}
              min={field.min}
              max={field.max}
              step="1"
              value={form[field.key] ?? ""}
              onChange={onFieldChange?.(field.key)}
              error={errors[field.key]}
              disabled={saving}
            />
          ))}
        </div>
      </div>
    </SettingsPanel>
  );
}
