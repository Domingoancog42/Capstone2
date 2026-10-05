import React, { useState } from "react";
import {
  Archive,
  Database,
  Download,
  Eye,
  PlayCircle,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import {
  SettingsCheckbox,
  SettingsPanel,
  SettingsRow,
  SettingsSelect,
} from "../../components/settings";

export const backupScheduleOptions = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export const defaultBackupSettings = {
  automaticEnabled: false,
  schedule: "daily",
  backupPath: "",
  backupDateTime: "",
  lastAutomaticBackupAt: "",
};

function parseBackupDate(value) {
  const date = new Date(String(value || "").replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBackupId(row = {}) {
  const id = Number(row.id);
  return Number.isFinite(id) && id > 0 ? `BKP-${String(id).padStart(4, "0")}` : "N/A";
}

export function formatBackupDateTime(value) {
  const date = parseBackupDate(value);

  return date
    ? new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date)
    : "N/A";
}

export function formatBackupDateTimeInput(value) {
  const date = parseBackupDate(value);

  if (!date) {
    return "";
  }

  const pad = (part) => String(part).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeBackupSettings(settings = {}) {
  return {
    ...defaultBackupSettings,
    ...settings,
    backupDateTime: formatBackupDateTimeInput(settings.backupDateTime),
  };
}

export function formatFileSize(value) {
  const bytes = Number(value) || 0;

  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** unitIndex);

  return `${amount.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

export function backupStatusClass(status) {
  switch (String(status || "").toLowerCase()) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "deleted":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

export default function BackupDataSettings({
  settings = defaultBackupSettings,
  history = [],
  loading = false,
  saving = false,
  manualLoading = false,
  actionId = "",
  notice = "",
  noticeTone = "info",
  onSettingChange,
  onSave,
  onRefresh,
  onCreateManualBackup,
  onDownload,
  onDelete,
}) {
  /*
   * The details modal only ever reads the row the administrator clicked, so its selection lives
   * beside the table it belongs to instead of in the settings page that renders this section.
   */
  const [viewingBackup, setViewingBackup] = useState(null);

  const backupHistoryColumns = [
    {
      key: "id",
      header: "Backup ID",
      cardRole: "eyebrow",
      render: (row) => <span className="font-semibold text-slate-900">{formatBackupId(row)}</span>,
    },
    {
      key: "backupDateTime",
      header: "Backup Date/Time",
      cardRole: "title",
      render: (row) => formatBackupDateTime(row.backupDateTime),
    },
    {
      key: "backupType",
      header: "Backup Type",
      render: (row) => row.backupType || "Manual",
    },
    {
      key: "fileName",
      header: "File Name",
      cardRole: "subtitle",
      render: (row) => (
        <span className="block max-w-[260px] truncate font-semibold text-slate-900" title={row.fileName || "N/A"}>
          {row.fileName || "N/A"}
        </span>
      ),
    },
    {
      key: "filePath",
      header: "File Path",
      cardFull: true,
      render: (row) => (
        <span className="block max-w-[320px] truncate text-sm text-slate-600" title={row.filePath || "N/A"}>
          {row.filePath || "N/A"}
        </span>
      ),
    },
    {
      key: "fileSize",
      header: "File Size",
      render: (row) => formatFileSize(row.fileSize),
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${backupStatusClass(row.status)}`}>
          {row.status || "Completed"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-center",
      cellClassName: "whitespace-nowrap",
      cardRole: "actions",
      render: (row) => {
        const unavailable = row.status === "Deleted" || row.status === "Failed";

        return (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" icon={Eye} onClick={() => setViewingBackup(row)}>
              View
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              loading={actionId === `download:${row.id}`}
              disabled={unavailable}
              onClick={() => onDownload?.(row)}
            >
              Download
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              loading={actionId === `delete:${row.id}`}
              disabled={row.status === "Deleted"}
              onClick={() => onDelete?.(row)}
            >
              Delete
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="grid gap-4">
      <SettingsPanel
        icon={Database}
        title="Backup Schedule"
        description="Configure automatic database backups and where the files are written."
        className="border-indigo-100"
        notice={notice}
        noticeTone={noticeTone}
        onSubmit={onSave}
        actions={
          <Button
            type="button"
            variant="secondary"
            icon={RefreshCw}
            loading={loading}
            onClick={onRefresh}
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
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Automation</p>
            <p className="m-0 mt-1 text-sm font-bold text-slate-900">{settings.automaticEnabled ? "Enabled" : "Manual only"}</p>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-3">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-700">Frequency</p>
            <p className="m-0 mt-1 text-sm font-bold capitalize text-slate-900">{settings.schedule || "Daily"}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3.5 py-3">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-700">Last automatic run</p>
            <p className="m-0 mt-1 truncate text-sm font-bold text-slate-900" title={formatBackupDateTime(settings.lastAutomaticBackupAt)}>
              {formatBackupDateTime(settings.lastAutomaticBackupAt)}
            </p>
          </div>
        </div>
        <div className="grid gap-4">
          <SettingsRow
            label="Automatic backup"
            description="Run backups on the schedule below without manual action."
            htmlFor="automaticEnabled"
            control={
              <SettingsCheckbox
                name="automaticEnabled"
                label={settings.automaticEnabled ? "Enabled" : "Disabled"}
                checked={Boolean(settings.automaticEnabled)}
                onChange={onSettingChange?.("automaticEnabled")}
              />
            }
          />
          <div className="grid gap-4 lg:grid-cols-[220px_240px_minmax(0,1fr)]">
            <SettingsSelect
              name="backupSchedule"
              label="Backup schedule"
              value={settings.schedule || "daily"}
              onChange={onSettingChange?.("schedule")}
              options={backupScheduleOptions}
              disabled={!settings.automaticEnabled}
            />
            <InputField
              label="Backup date/time"
              name="backupDateTime"
              type="datetime-local"
              value={settings.backupDateTime || ""}
              onChange={onSettingChange?.("backupDateTime")}
            />
            <InputField
              label="Backup file path"
              name="backupPath"
              value={settings.backupPath || ""}
              onChange={onSettingChange?.("backupPath")}
              placeholder="C:\\xampp\\htdocs\\Capstone2\\backend\\backups"
              required
            />
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel
        icon={Archive}
        title="Backup History"
        description="Completed manual and automatic backups with their storage details."
        className="border-sky-100"
        actions={
          <Button icon={PlayCircle} loading={manualLoading} onClick={onCreateManualBackup}>
            Manual Backup
          </Button>
        }
      >
        <Table
          columns={backupHistoryColumns}
          data={history}
          rowKey="id"
          emptyMessage={loading ? "Loading backup history..." : "No backup history found."}
          stickyHeader
          tableClassName="min-w-[1460px]"
          className="max-h-[620px] rounded-lg border border-slate-200"
          cardsClassName="lg:hidden"
          tableWrapperClassName="hidden lg:block"
        />
      </SettingsPanel>

      <Modal
        open={Boolean(viewingBackup)}
        title="Backup Details"
        onClose={() => setViewingBackup(null)}
        maxWidth="max-w-2xl"
        footer={<Button variant="secondary" onClick={() => setViewingBackup(null)}>Close</Button>}
      >
        {viewingBackup ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-slate-500">Backup ID</dt>
              <dd className="m-0 mt-1 font-semibold text-slate-950">{formatBackupId(viewingBackup)}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Status</dt>
              <dd className="m-0 mt-1">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${backupStatusClass(viewingBackup.status)}`}>
                  {viewingBackup.status || "Completed"}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Backup Date/Time</dt>
              <dd className="m-0 mt-1 text-slate-950">{formatBackupDateTime(viewingBackup.backupDateTime)}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Backup Type</dt>
              <dd className="m-0 mt-1 text-slate-950">{viewingBackup.backupType || "Manual"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">File Name</dt>
              <dd className="m-0 mt-1 break-words text-slate-950">{viewingBackup.fileName || "N/A"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">File Size</dt>
              <dd className="m-0 mt-1 text-slate-950">{formatFileSize(viewingBackup.fileSize)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-semibold text-slate-500">File Path</dt>
              <dd className="m-0 mt-1 break-words text-slate-950">{viewingBackup.filePath || "N/A"}</dd>
            </div>
            {viewingBackup.errorMessage ? (
              <div className="sm:col-span-2">
                <dt className="text-sm font-semibold text-slate-500">Error</dt>
                <dd className="m-0 mt-1 break-words text-rose-700">{viewingBackup.errorMessage}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
