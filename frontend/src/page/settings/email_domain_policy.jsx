import React, { useEffect, useMemo, useState } from "react";
import { MailCheck, MailX, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import Button from "../../components/UI/button";
import { SettingsNotice, SettingsPanel, SettingsSection, SettingsToggleRow } from "../../components/settings";
import {
  defaultEmailDomainPolicy,
  normalizeEmailDomainList,
  normalizeEmailDomainPolicy,
} from "../../utils/emailDomainPolicy";

export { defaultEmailDomainPolicy, normalizeEmailDomainPolicy };

function DomainList({ domains = [], emptyMessage, onRemove }) {
  if (domains.length === 0) {
    return (
      <p className="m-0 rounded-lg border border-dashed border-slate-300 px-4 py-4 text-center text-sm font-semibold text-slate-500">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {domains.map((domain) => (
        <span
          key={domain}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"
        >
          {domain}
          <button
            type="button"
            onClick={() => onRemove(domain)}
            className="grid h-6 w-6 place-items-center rounded-md text-slate-400 transition hover:bg-white hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
            aria-label={`Remove ${domain}`}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}

function DomainEditor({ icon: Icon, title, description, inputValue, onInputChange, onAdd, domains, emptyMessage, onRemove }) {
  return (
    <SettingsSection title={title} description={description}>
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder="example.com"
              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
            />
          </div>
          <Button type="button" icon={Plus} onClick={onAdd}>
            Add
          </Button>
        </div>
        <DomainList domains={domains} emptyMessage={emptyMessage} onRemove={onRemove} />
      </div>
    </SettingsSection>
  );
}

export default function EmailDomainPolicySettings({
  policy = defaultEmailDomainPolicy,
  saving = false,
  notice = "",
  noticeTone = "info",
  onSave,
}) {
  const [draft, setDraft] = useState(() => normalizeEmailDomainPolicy(policy));
  const [allowedInput, setAllowedInput] = useState("");
  const [blockedInput, setBlockedInput] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setDraft(normalizeEmailDomainPolicy(policy));
  }, [policy]);

  const hasOverlap = useMemo(() => {
    const blocked = new Set(draft.blockedDomains);
    return draft.allowedDomains.filter((domain) => blocked.has(domain));
  }, [draft.allowedDomains, draft.blockedDomains]);

  const updateDraft = (updates) => {
    setDraft((current) => ({ ...current, ...updates }));
    setLocalError("");
  };

  const addDomain = (listKey, value, setValue) => {
    const domains = normalizeEmailDomainList(value);
    if (domains.length === 0) {
      setLocalError("Enter a valid domain, like gmail.com.");
      return;
    }

    updateDraft({
      [listKey]: normalizeEmailDomainList([...draft[listKey], ...domains]),
    });
    setValue("");
  };

  const removeDomain = (listKey, domain) => {
    updateDraft({
      [listKey]: draft[listKey].filter((item) => item !== domain),
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (draft.allowListedOnly && draft.allowedDomains.length === 0) {
      setLocalError("Add at least one allowed domain before using allow-list-only mode.");
      return;
    }

    if (hasOverlap.length > 0) {
      setLocalError(`Remove duplicate allowed/blocked domain: ${hasOverlap.join(", ")}.`);
      return;
    }

    onSave?.(draft);
  };

  return (
    <SettingsPanel
      icon={MailX}
      title="Temp Mail Blocker"
      description="Control which email domains can be used for employee and user accounts."
      notice={notice || localError}
      noticeTone={localError ? "error" : noticeTone}
      onSubmit={handleSubmit}
      footer={
        <Button type="submit" icon={Save} loading={saving}>
          Save Email Rules
        </Button>
      }
    >
      <div className="grid gap-4">
        <SettingsToggleRow
          id="emailPolicyEnabled"
          icon={ShieldCheck}
          label="Enable email domain rules"
          description="When enabled, new or edited user and employee emails are checked before saving."
          checked={draft.enabled}
          disabled={saving}
          onToggle={() => updateDraft({ enabled: !draft.enabled })}
        />

        <SettingsToggleRow
          id="emailPolicyAllowOnly"
          icon={MailCheck}
          label="Allow listed domains only"
          description="Accept only addresses from the Allowed Domains list. Blocked domains are still rejected first."
          checked={draft.allowListedOnly}
          disabled={saving}
          onToggle={() => updateDraft({ allowListedOnly: !draft.allowListedOnly })}
        />

        <DomainEditor
          icon={MailCheck}
          title="Allowed Domains"
          description="Domains accepted when allow-list-only mode is enabled."
          inputValue={allowedInput}
          onInputChange={setAllowedInput}
          onAdd={() => addDomain("allowedDomains", allowedInput, setAllowedInput)}
          domains={draft.allowedDomains}
          emptyMessage="No allowed domains added."
          onRemove={(domain) => removeDomain("allowedDomains", domain)}
        />

        <DomainEditor
          icon={MailX}
          title="Blocked Domains"
          description="Temporary, disposable, or unwanted email domains that should never be accepted."
          inputValue={blockedInput}
          onInputChange={setBlockedInput}
          onAdd={() => addDomain("blockedDomains", blockedInput, setBlockedInput)}
          domains={draft.blockedDomains}
          emptyMessage="No blocked domains added."
          onRemove={(domain) => removeDomain("blockedDomains", domain)}
        />

        {!draft.enabled ? (
          <SettingsNotice tone="warning">
            These domain lists are saved but are not enforced until Enable email domain rules is turned on.
          </SettingsNotice>
        ) : null}

        <SettingsNotice tone="info">
          Domain rules validate the part after @. They cannot verify whether an inbox exists or is actively used.
        </SettingsNotice>
      </div>
    </SettingsPanel>
  );
}
