import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Ban, Gauge, RefreshCw, Save, ShieldAlert, Trash2 } from "lucide-react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Table from "../../components/UI/table";
import {
  SettingsNotice,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
} from "../../components/settings";
import {
  blockRateLimitAddress,
  clearRateLimitCounters,
  fetchRateLimitOverview,
  releaseRateLimitBlock,
  saveRateLimitSettings,
} from "../../services/api";

const numericFields = [
  { key: "maxRequests", label: "Requests allowed", helper: "Requests permitted inside the window." },
  { key: "windowSeconds", label: "Window (seconds)", helper: "Rolling period the requests are counted in." },
  { key: "blockMinutes", label: "Block (minutes)", helper: "How long the address stays blocked." },
];

const blockDurationOptions = [15, 30, 60, 240, 720, 1440];

const defaultBlockForm = {
  group: "login",
  identifier: "",
  minutes: 60,
  reason: "",
};

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function formatDateTime(value) {
  const date = new Date(String(value || "").replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);

  if (total === 0) {
    return "--";
  }

  if (total < 60) {
    return `${total}s`;
  }

  const minutes = Math.floor(total / 60);

  if (minutes < 60) {
    return `${minutes}m ${total % 60}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}


function StatTile({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  };

  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.slate}`}>
      <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
        <Icon size={14} />
        {label}
      </p>
      <p className="m-0 mt-2 text-lg font-extrabold text-slate-950 tabular-nums">{value}</p>
    </div>
  );
}

function stateBadge(state) {
  const classes = state === "active"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : state === "expired"
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${classes}`}>
      {state}
    </span>
  );
}

export default function RateLimitSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [releasingId, setReleasingId] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [groups, setGroups] = useState([]);
  const [bounds, setBounds] = useState({});
  const [blocks, setBlocks] = useState([]);
  const [activity, setActivity] = useState([]);
  const [statistics, setStatistics] = useState({});
  const [driver, setDriver] = useState({});
  const [exemptScripts, setExemptScripts] = useState([]);
  const [blockForm, setBlockForm] = useState(defaultBlockForm);

  const applyOverview = useCallback((result) => {
    setForm(result?.settings || null);
    setGroups(result?.groups || []);
    setBounds(result?.bounds || {});
    setBlocks(result?.blocks || []);
    setActivity(result?.activity || []);
    setStatistics(result?.statistics || {});
    setDriver(result?.driver || {});
    setExemptScripts(result?.exemptScripts || []);
  }, []);

  const loadOverview = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) {
      setLoading(true);
    }

    try {
      const result = await fetchRateLimitOverview();
      applyOverview(result);
      setError("");
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to load rate limiting settings."));
    } finally {
      setLoading(false);
    }
  }, [applyOverview]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const groupLookup = useMemo(
    () => groups.reduce((lookup, group) => ({ ...lookup, [group.key]: group }), {}),
    [groups]
  );

  const updateGroupField = (groupKey, field) => (event) => {
    const value = event.target.value;

    setForm((current) => ({
      ...current,
      groups: {
        ...current.groups,
        [groupKey]: { ...current.groups[groupKey], [field]: value },
      },
    }));
  };

  const toggleGroup = (groupKey) => () => {
    setForm((current) => ({
      ...current,
      groups: {
        ...current.groups,
        [groupKey]: { ...current.groups[groupKey], enabled: !current.groups[groupKey].enabled },
      },
    }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const payload = {
        enabled: Boolean(form.enabled),
        groups: Object.entries(form.groups).reduce((groupPayload, [key, values]) => ({
          ...groupPayload,
          [key]: {
            enabled: Boolean(values.enabled),
            maxRequests: Number(values.maxRequests),
            windowSeconds: Number(values.windowSeconds),
            blockMinutes: Number(values.blockMinutes),
          },
        }), {}),
      };

      applyOverview(await saveRateLimitSettings(payload));
      setMessage("Rate limiting settings saved.");
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to save rate limiting settings."));
    } finally {
      setSaving(false);
    }
  };

  const handleBlock = async (event) => {
    event.preventDefault();
    setBlocking(true);
    setMessage("");
    setError("");

    try {
      applyOverview(await blockRateLimitAddress({
        group: blockForm.group,
        identifier: blockForm.identifier.trim(),
        minutes: Number(blockForm.minutes),
        reason: blockForm.reason.trim(),
      }));
      setMessage(`${blockForm.identifier.trim()} is now blocked.`);
      setBlockForm({ ...defaultBlockForm, group: blockForm.group });
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to block that address."));
    } finally {
      setBlocking(false);
    }
  };

  const handleRelease = async (block) => {
    setReleasingId(block.id);
    setMessage("");
    setError("");

    try {
      applyOverview(await releaseRateLimitBlock(block.id));
      setMessage(`${block.identifier} can send requests again.`);
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to release that block."));
    } finally {
      setReleasingId(0);
    }
  };

  const handleClearCounters = async () => {
    setClearing(true);
    setMessage("");
    setError("");

    try {
      applyOverview(await clearRateLimitCounters());
      setMessage("Request counters cleared.");
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to clear the request counters."));
    } finally {
      setClearing(false);
    }
  };

  const blockColumns = [
    {
      key: "identifier",
      header: "IP Address",
      cellClassName: "font-mono text-xs text-slate-800",
      render: (row) => row.identifier,
    },
    {
      key: "limitGroup",
      header: "Endpoint Group",
      render: (row) => groupLookup[row.limitGroup]?.label || row.limitGroup,
    },
    {
      key: "source",
      header: "Source",
      render: (row) => (row.isManual ? "Manual" : "Automatic"),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => (
        <span className="block max-w-[260px] truncate text-sm text-slate-700" title={row.reason || ""}>
          {row.reason || "N/A"}
        </span>
      ),
    },
    { key: "blockedAt", header: "Blocked", render: (row) => formatDateTime(row.blockedAt) },
    {
      key: "expiresAt",
      header: "Expires",
      render: (row) => (row.expiresAt ? formatDateTime(row.expiresAt) : "Never"),
    },
    {
      key: "retryAfter",
      header: "Time Left",
      cellClassName: "tabular-nums",
      render: (row) => (row.state === "active" ? formatDuration(row.retryAfter) : "--"),
    },
    { key: "state", header: "Status", render: (row) => stateBadge(row.state) },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        row.state === "active" ? (
          <Button
            variant="secondary"
            size="sm"
            loading={releasingId === row.id}
            onClick={() => handleRelease(row)}
          >
            Release
          </Button>
        ) : (
          <span className="text-xs text-slate-400">No action</span>
        )
      ),
    },
  ];

  const activityColumns = [
    {
      key: "identifier",
      header: "IP Address",
      cellClassName: "font-mono text-xs text-slate-800",
      render: (row) => row.identifier,
    },
    {
      key: "limitGroup",
      header: "Endpoint Group",
      render: (row) => groupLookup[row.limitGroup]?.label || row.limitGroup,
    },
    {
      key: "hits",
      header: "Requests (last hour)",
      cellClassName: "tabular-nums font-semibold text-slate-900",
      render: (row) => row.hits,
    },
    { key: "lastSeenAt", header: "Last Request", render: (row) => formatDateTime(row.lastSeenAt) },
    {
      key: "block",
      header: "Actions",
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setBlockForm((current) => ({
            ...current,
            group: row.limitGroup,
            identifier: row.identifier,
          }))}
        >
          Prefill Block
        </Button>
      ),
    },
  ];

  if (loading && form === null) {
    return (
      <SettingsPanel>
        <p className="m-0 py-10 text-center text-sm font-semibold text-slate-500">
          Loading rate limiting settings...
        </p>
      </SettingsPanel>
    );
  }

  if (form === null) {
    return (
      <SettingsPanel>
        <div className="grid justify-items-center gap-3 py-10 text-center">
          <SettingsNotice tone="error">{error || "Rate limiting settings are unavailable."}</SettingsNotice>
          <Button variant="secondary" icon={RefreshCw} onClick={() => loadOverview()}>
            Try Again
          </Button>
        </div>
      </SettingsPanel>
    );
  }

  return (
    <div className="grid gap-4">
      <SettingsPanel
        icon={Gauge}
        title="Rate Limiting"
        description="Throttle repeated requests per IP address to slow brute-force sign-ins and abusive traffic."
        notice={error || message}
        noticeTone={error ? "error" : "success"}
        onSubmit={handleSave}
        actions={
          <Button
            type="button"
            variant="secondary"
            icon={RefreshCw}
            loading={loading}
            onClick={() => loadOverview({ quiet: true })}
          >
            Refresh
          </Button>
        }
        footer={
          <Button type="submit" icon={Save} loading={saving}>
            Save Settings
          </Button>
        }
      >
        <div className="grid gap-4">
          <SettingsRow
            icon={Gauge}
            label="Enable rate limiting"
            description={`Master switch. When off, no group is throttled and existing blocks stop applying. Counters are stored in ${driver.label || "MySQL"}.`}
            control={
              <SettingsToggle
                checked={Boolean(form.enabled)}
                label="Enable rate limiting"
                onChange={() => setForm((current) => ({ ...current, enabled: !current.enabled }))}
              />
            }
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={Activity} label="Requests / hour" value={statistics.hitsLastHour ?? 0} />
            <StatTile icon={Activity} label="Requests / 24h" value={statistics.hitsLastDay ?? 0} />
            <StatTile icon={ShieldAlert} label="Active blocks" value={statistics.activeBlocks ?? 0} tone="rose" />
            <StatTile icon={Ban} label="Blocks / 24h" value={statistics.blocksLastDay ?? 0} tone="amber" />
          </div>

          {groups.map((group) => {
            const values = form.groups?.[group.key] || {};

            return (
              <SettingsSection key={group.key}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-semibold text-slate-900">{group.label}</p>
                    <p className="m-0 mt-1 max-w-3xl text-sm leading-6 text-slate-500">{group.description}</p>
                  </div>
                  <SettingsToggle
                    checked={Boolean(values.enabled)}
                    disabled={!form.enabled}
                    label={`Enable ${group.label} throttling`}
                    onChange={toggleGroup(group.key)}
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {numericFields.map((field) => (
                    <div key={field.key}>
                      <InputField
                        id={`${group.key}-${field.key}`}
                        name={`${group.key}-${field.key}`}
                        label={field.label}
                        type="number"
                        min={bounds[field.key]?.min}
                        max={bounds[field.key]?.max}
                        step="1"
                        disabled={!form.enabled || !values.enabled}
                        value={values[field.key] ?? ""}
                        onChange={updateGroupField(group.key, field.key)}
                        inputClassName="text-sm font-semibold"
                      />
                      <p className="m-0 mt-1 text-xs text-slate-500">{field.helper}</p>
                    </div>
                  ))}
                </div>

                <p className="m-0 mt-3 text-xs font-semibold text-slate-500">
                  Allows {values.maxRequests || 0} requests every {values.windowSeconds || 0} seconds,
                  then blocks the address for {values.blockMinutes || 0} minute(s).
                </p>
              </SettingsSection>
            );
          })}

          {exemptScripts.length > 0 ? (
            <SettingsNotice tone="info">
              Always exempt from the signed-in API group so administrators cannot lock themselves out:{" "}
              <span className="font-mono">{exemptScripts.join(", ")}</span>
            </SettingsNotice>
          ) : null}
        </div>
      </SettingsPanel>

      <SettingsPanel
        icon={Ban}
        title="Blocked Addresses"
        description="Automatic blocks appear when a limit is exceeded. Release one to restore access immediately."
        actions={
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            {blocks.filter((block) => block.state === "active").length} active
          </span>
        }
      >
        <div className="grid gap-4">
          <Table
            columns={blockColumns}
            data={blocks}
            emptyMessage="No addresses have been blocked yet."
            tableClassName="min-w-[1180px]"
            className="rounded-lg border border-slate-200"
          />

          <form onSubmit={handleBlock}>
            <SettingsSection
              title="Block an address manually"
              description="Useful when a specific IP address keeps probing the system."
            >
              <div className="grid gap-3">
                <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)_160px_auto] lg:items-end">
                  <SettingsSelect
                    id="rateLimitBlockGroup"
                    name="rateLimitBlockGroup"
                    label="Endpoint group"
                    value={blockForm.group}
                    onChange={(event) => setBlockForm((current) => ({ ...current, group: event.target.value }))}
                    options={groups.map((group) => ({ value: group.key, label: group.label }))}
                  />

                  <InputField
                    id="rateLimitBlockIdentifier"
                    name="rateLimitBlockIdentifier"
                    label="IP address"
                    placeholder="203.0.113.10"
                    value={blockForm.identifier}
                    onChange={(event) => setBlockForm((current) => ({ ...current, identifier: event.target.value }))}
                    inputClassName="text-sm font-semibold"
                  />

                  <SettingsSelect
                    id="rateLimitBlockMinutes"
                    name="rateLimitBlockMinutes"
                    label="Duration"
                    value={blockForm.minutes}
                    onChange={(event) => setBlockForm((current) => ({ ...current, minutes: event.target.value }))}
                    options={blockDurationOptions.map((option) => ({
                      value: option,
                      label: option >= 60 ? `${option / 60} hour(s)` : `${option} minutes`,
                    }))}
                  />

                  <Button type="submit" icon={Ban} loading={blocking} disabled={!blockForm.identifier.trim()}>
                    Block
                  </Button>
                </div>

                <InputField
                  id="rateLimitBlockReason"
                  name="rateLimitBlockReason"
                  label="Reason (optional)"
                  placeholder="Repeated sign-in probing"
                  value={blockForm.reason}
                  onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value }))}
                  inputClassName="text-sm"
                />
              </div>
            </SettingsSection>
          </form>
        </div>
      </SettingsPanel>

      <SettingsPanel
        icon={Activity}
        title="Recent Request Activity"
        description="Throttled endpoint traffic grouped by address for the last hour."
        actions={
          <Button
            type="button"
            variant="secondary"
            icon={Trash2}
            loading={clearing}
            onClick={handleClearCounters}
          >
            Clear Counters
          </Button>
        }
      >
        <Table
          columns={activityColumns}
          data={activity}
          rowKey="identifier"
          emptyMessage="No throttled requests were recorded in the last hour."
          tableClassName="min-w-[860px]"
          className="rounded-lg border border-slate-200"
        />
      </SettingsPanel>
    </div>
  );
}
