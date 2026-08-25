import React, { useEffect, useState } from "react";
import { Activity, Gauge, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import Button from "../../components/UI/button";
import {
  SettingsNotice,
  SettingsNumberField,
  SettingsPanel,
  SettingsSection,
  SettingsSelect,
  SettingsToggleRow,
} from "../../components/settings";

/**
 * Settings > Rate Limiting.
 *
 * The rules themselves come from the server (`rateLimit.rules`), including the range each field
 * accepts, so the form cannot drift from what the API will actually store. Everything here is
 * therefore driven by that list rather than by a hard-coded set of four sections.
 */

export const rateLimitFields = [
  {
    key: "maxRequests",
    label: "Maximum requests",
    suffix: "requests",
    helper: "How many requests one caller may make inside the window.",
  },
  {
    key: "windowSeconds",
    label: "Window",
    suffix: "seconds",
    helper: "The period the requests are counted over.",
  },
  {
    key: "blockSeconds",
    label: "Cool-down",
    suffix: "seconds",
    helper: "How long a caller is refused after going over. 0 waits out the window instead.",
  },
];

export const defaultRateLimitSettings = {
  enabled: true,
  auditBlocked: true,
  trustedIps: [],
  rules: {},
};

/**
 * Fold the stored settings into the shape the form edits: every rule the server described gets an
 * entry, seeded from its default when nothing is stored for it yet. Numbers become strings because
 * that is what a controlled `<input>` holds — a half-typed "" is a state the form must be able to
 * be in.
 */
export function rateLimitFormFromSettings(settings = {}, rules = []) {
  const storedRules = settings.rules || {};

  return {
    enabled: settings.enabled !== false,
    auditBlocked: settings.auditBlocked !== false,
    trustedIps: Array.isArray(settings.trustedIps) ? settings.trustedIps : [],
    rules: rules.reduce((accumulator, rule) => {
      const stored = storedRules[rule.key] || {};
      const fallback = rule.default || {};

      return {
        ...accumulator,
        [rule.key]: {
          enabled: stored.enabled !== undefined ? Boolean(stored.enabled) : fallback.enabled !== false,
          ...rateLimitFields.reduce((fields, field) => ({
            ...fields,
            [field.key]: String(stored[field.key] ?? fallback[field.key] ?? 0),
          }), {}),
        },
      };
    }, {}),
  };
}

function isIpAddress(value) {
  const text = String(value || "").trim();
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;

  if (ipv4.test(text)) {
    return text.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
  }

  // Loose on IPv6 on purpose: the server validates with filter_var() and is the authority. This only
  // has to stop obvious typos from being added to the list.
  return /^[0-9a-f:]+$/i.test(text) && text.includes(":");
}

function formatDuration(seconds) {
  const total = Number(seconds);

  if (!Number.isFinite(total) || total <= 0) {
    return "no cool-down";
  }

  if (total < 60) {
    return `${total} second${total === 1 ? "" : "s"}`;
  }

  if (total < 3600) {
    const minutes = Math.round((total / 60) * 10) / 10;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.round((total / 3600) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * The periods a quota rule may reset on. Kept inside the 86400-second ceiling the server enforces on
 * the window field, so nothing offered here can be rejected on save.
 */
const QUOTA_PERIODS = [
  { value: "3600", label: "Every hour", noun: "per hour" },
  { value: "43200", label: "Every 12 hours", noun: "per 12 hours" },
  { value: "86400", label: "Every day", noun: "per day" },
];

function quotaPeriodOptions(currentValue) {
  const current = String(currentValue ?? "");

  if (current === "" || QUOTA_PERIODS.some((period) => period.value === current)) {
    return QUOTA_PERIODS;
  }

  /*
   * A window stored outside this list — hand-edited, or left over from the generic card — still has
   * to be selectable, or merely opening this screen would rewrite it on the next save.
   */
  return [...QUOTA_PERIODS, { value: current, label: `Every ${formatDuration(current)}` }];
}

function quotaPeriodNoun(value) {
  const match = QUOTA_PERIODS.find((period) => period.value === String(value ?? ""));

  return match ? match.noun : `per ${formatDuration(value)}`;
}

/**
 * A quota rule: "no more than N of these per day".
 *
 * The other groups are burst guards, where the window and the cool-down are the whole point. A quota
 * is a different question — an administrator setting one is thinking of a number and a period, not of
 * three interacting durations — so it gets a control shaped like the question. The cool-down is not
 * shown because zero is the only value that makes sense here: a spent allowance should last until it
 * resets, not stack a second penalty on top.
 */
function QuotaRuleCard({ rule, draft, disabled, errors, onToggle, onFieldChange }) {
  const range = rule.limits?.maxRequests || {};
  const locked = disabled || !draft.enabled;

  return (
    <SettingsSection title={rule.label} description={rule.description}>
      <div className="grid gap-4">
        <SettingsToggleRow
          id={`rateLimit-${rule.key}-enabled`}
          icon={Gauge}
          label="Enforce this limit"
          description={rule.scope}
          checked={draft.enabled}
          disabled={disabled}
          onToggle={() => onToggle(rule.key)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsNumberField
            id={`rateLimit-${rule.key}-maxRequests`}
            name={`rateLimit-${rule.key}-maxRequests`}
            label="Request limit"
            suffix="requests"
            helper={`How many may be filed before the rest are refused. ${range.min ?? 1} to ${range.max ?? 100000}.`}
            error={errors.maxRequests}
            value={draft.maxRequests}
            min={range.min}
            max={range.max}
            disabled={locked}
            onChange={(event) => onFieldChange(rule.key, "maxRequests", event.target.value)}
          />

          <SettingsSelect
            id={`rateLimit-${rule.key}-windowSeconds`}
            name={`rateLimit-${rule.key}-windowSeconds`}
            label="Allowance resets"
            helper="When the count starts over from zero."
            error={errors.windowSeconds}
            value={String(draft.windowSeconds ?? "")}
            options={quotaPeriodOptions(draft.windowSeconds)}
            disabled={locked}
            onChange={(event) => onFieldChange(rule.key, "windowSeconds", event.target.value)}
          />
        </div>

        <p className="m-0 text-xs leading-5 text-slate-500">
          {draft.enabled
            ? `Allows ${draft.maxRequests || 0} ${quotaPeriodNoun(draft.windowSeconds)} from one account. Anything past that is refused until the allowance resets.`
            : "This group is not being counted."}
        </p>
      </div>
    </SettingsSection>
  );
}

function RuleCard({ rule, draft, disabled, errors, onToggle, onFieldChange }) {
  const limits = rule.limits || {};

  return (
    <SettingsSection title={rule.label} description={rule.description}>
      <div className="grid gap-4">
        <SettingsToggleRow
          id={`rateLimit-${rule.key}-enabled`}
          icon={Gauge}
          label={`Limit ${rule.label.toLowerCase()}`}
          description={rule.scope}
          checked={draft.enabled}
          disabled={disabled}
          onToggle={() => onToggle(rule.key)}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          {rateLimitFields.map((field) => {
            const range = limits[field.key] || {};
            const helper = field.key === "maxRequests"
              ? field.helper
              : `${field.helper} Currently ${formatDuration(draft[field.key])}.`;

            return (
              <SettingsNumberField
                key={field.key}
                id={`rateLimit-${rule.key}-${field.key}`}
                name={`rateLimit-${rule.key}-${field.key}`}
                label={field.label}
                suffix={field.suffix}
                helper={helper}
                error={errors[field.key]}
                value={draft[field.key]}
                min={range.min}
                max={range.max}
                disabled={disabled || !draft.enabled}
                onChange={(event) => onFieldChange(rule.key, field.key, event.target.value)}
              />
            );
          })}
        </div>

        <p className="m-0 text-xs leading-5 text-slate-500">
          {draft.enabled
            ? `Allows ${draft.maxRequests || 0} requests every ${formatDuration(draft.windowSeconds)}, then refuses ${
                Number(draft.blockSeconds) > 0
                  ? `for ${formatDuration(draft.blockSeconds)}`
                  : "until the window resets"
              }.`
            : "This group is not being counted."}
        </p>
      </div>
    </SettingsSection>
  );
}

export default function RateLimitSettings({
  settings = defaultRateLimitSettings,
  rules = [],
  saving = false,
  notice = "",
  noticeTone = "info",
  onSave,
}) {
  const [draft, setDraft] = useState(() => rateLimitFormFromSettings(settings, rules));
  const [fieldErrors, setFieldErrors] = useState({});
  const [localError, setLocalError] = useState("");
  const [ipInput, setIpInput] = useState("");

  useEffect(() => {
    setDraft(rateLimitFormFromSettings(settings, rules));
    setFieldErrors({});
    setLocalError("");
  }, [settings, rules]);

  const updateDraft = (updates) => {
    setDraft((current) => ({ ...current, ...updates }));
    setLocalError("");
  };

  const toggleRule = (ruleKey) => {
    setDraft((current) => ({
      ...current,
      rules: {
        ...current.rules,
        [ruleKey]: { ...current.rules[ruleKey], enabled: !current.rules[ruleKey]?.enabled },
      },
    }));
    setLocalError("");
  };

  const updateRuleField = (ruleKey, fieldKey, value) => {
    setDraft((current) => ({
      ...current,
      rules: {
        ...current.rules,
        [ruleKey]: { ...current.rules[ruleKey], [fieldKey]: value },
      },
    }));
    setFieldErrors((current) => ({
      ...current,
      [ruleKey]: { ...(current[ruleKey] || {}), [fieldKey]: "" },
    }));
    setLocalError("");
  };

  const addTrustedIp = () => {
    const candidate = ipInput.trim();

    if (!isIpAddress(candidate)) {
      setLocalError("Enter a valid IP address, like 192.168.1.10.");
      return;
    }

    if (draft.trustedIps.includes(candidate)) {
      setIpInput("");
      return;
    }

    updateDraft({ trustedIps: [...draft.trustedIps, candidate] });
    setIpInput("");
  };

  const removeTrustedIp = (ip) => {
    updateDraft({ trustedIps: draft.trustedIps.filter((item) => item !== ip) });
  };

  /**
   * Validate against the ranges the server sent with each rule, so the form rejects exactly what the
   * API would have rejected. A disabled group is skipped: its numbers are still stored, but nothing
   * reads them, and blocking a save on them would be pointless.
   *
   * A quota rule has no cool-down control, so its cool-down is not validated either — it falls
   * through to the rule's own default of zero below. Validating a field the screen never renders
   * could otherwise fail a save while highlighting nothing.
   */
  const validate = () => {
    const nextErrors = {};
    const payloadRules = {};

    rules.forEach((rule) => {
      const ruleDraft = draft.rules[rule.key] || {};
      const ruleErrors = {};
      const values = {};
      const editableFields = rule.quota
        ? rateLimitFields.filter((field) => field.key !== "blockSeconds")
        : rateLimitFields;

      editableFields.forEach((field) => {
        const range = rule.limits?.[field.key] || {};
        const rawValue = String(ruleDraft[field.key] ?? "").trim();

        if (!/^\d+$/.test(rawValue)) {
          ruleErrors[field.key] = `${field.label} must be a whole number.`;
          return;
        }

        const value = Number.parseInt(rawValue, 10);

        if (value < range.min || value > range.max) {
          ruleErrors[field.key] = `Must be between ${range.min} and ${range.max}.`;
          return;
        }

        values[field.key] = value;
      });

      if (ruleDraft.enabled && Object.keys(ruleErrors).length > 0) {
        nextErrors[rule.key] = ruleErrors;
      }

      payloadRules[rule.key] = {
        enabled: Boolean(ruleDraft.enabled),
        ...rateLimitFields.reduce((fields, field) => ({
          ...fields,
          [field.key]: values[field.key] ?? Number(rule.default?.[field.key] ?? 0),
        }), {}),
      };
    });

    setFieldErrors(nextErrors);

    return {
      isValid: Object.keys(nextErrors).length === 0,
      payload: {
        enabled: Boolean(draft.enabled),
        auditBlocked: Boolean(draft.auditBlocked),
        trustedIps: draft.trustedIps,
        rules: payloadRules,
      },
    };
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const validation = validate();

    if (!validation.isValid) {
      setLocalError("Check the highlighted limits before saving.");
      return;
    }

    onSave?.(validation.payload);
  };

  return (
    <div className="grid gap-4">
      <SettingsPanel
        icon={Gauge}
        title="Rate Limiting"
        description="Cap how many requests one caller may make. This counts the caller, so it catches the attacks the per-account lockout cannot see — one client trying many usernames, or a script looping on any endpoint."
        notice={notice || localError}
        noticeTone={localError ? "error" : noticeTone}
        onSubmit={handleSubmit}
        actions={
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
              draft.enabled ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
            }`}
          >
            {draft.enabled ? "Rate limiting on" : "Rate limiting off"}
          </span>
        }
        footer={
          <Button type="submit" icon={Save} loading={saving}>
            Save Rate Limits
          </Button>
        }
      >
        <div className="grid gap-4">
          <SettingsToggleRow
            id="rateLimitEnabled"
            icon={ShieldAlert}
            label="Enable rate limiting"
            description="The master switch. When off, no group below is counted and nothing is ever refused."
            checked={draft.enabled}
            disabled={saving}
            onToggle={() => updateDraft({ enabled: !draft.enabled })}
          />

          <SettingsToggleRow
            id="rateLimitAudit"
            icon={Activity}
            label="Record blocks in the audit log"
            description="Writes one entry when a caller first goes over a limit. Later refusals during the same cool-down are not repeated."
            checked={draft.auditBlocked}
            disabled={saving}
            onToggle={() => updateDraft({ auditBlocked: !draft.auditBlocked })}
          />

          {rules.map((rule) => {
            const Card = rule.quota ? QuotaRuleCard : RuleCard;

            return (
              <Card
                key={rule.key}
                rule={rule}
                draft={draft.rules[rule.key] || {}}
                disabled={saving || !draft.enabled}
                errors={fieldErrors[rule.key] || {}}
                onToggle={toggleRule}
                onFieldChange={updateRuleField}
              />
            );
          })}

          <SettingsSection
            title="Trusted IP Addresses"
            description="Addresses that are never counted. Use this for an on-site kiosk or an integration that legitimately makes far more requests than a person would."
          >
            <div className="grid gap-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={ipInput}
                  onChange={(event) => setIpInput(event.target.value)}
                  placeholder="192.168.1.10"
                  aria-label="Trusted IP address"
                  disabled={saving}
                  className="min-h-[42px] w-full min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15 disabled:bg-slate-50"
                />
                <Button type="button" icon={Plus} onClick={addTrustedIp} disabled={saving}>
                  Add
                </Button>
              </div>

              {draft.trustedIps.length === 0 ? (
                <p className="m-0 rounded-lg border border-dashed border-slate-300 px-4 py-4 text-center text-sm font-semibold text-slate-500">
                  No trusted addresses. Every caller is counted.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {draft.trustedIps.map((ip) => (
                    <span
                      key={ip}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"
                    >
                      {ip}
                      <button
                        type="button"
                        onClick={() => removeTrustedIp(ip)}
                        className="grid h-6 w-6 place-items-center rounded-md text-slate-400 transition hover:bg-white hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
                        aria-label={`Remove ${ip}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </SettingsSection>

          <SettingsNotice tone="info">
            Settings, sign-out, and the security-token endpoint are never counted by the general API
            group, so a limit set too low can always be corrected from this screen.
          </SettingsNotice>
        </div>
      </SettingsPanel>
    </div>
  );
}
