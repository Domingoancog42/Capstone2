import React from "react";
import { RefreshCw, UnlockKeyhole } from "lucide-react";
import Button from "../../components/UI/button";
import Table from "../../components/UI/table";
import { SettingsPanel } from "../../components/settings";
import { formatBackupDateTime } from "./backup_data";

/**
 * Lock windows are stored in seconds, but "3540 seconds" tells an administrator nothing about
 * whether it is worth waiting out. Rounding up to whole minutes (and hours past sixty) keeps the
 * remaining time readable without ever promising the account unlocks sooner than it does.
 */
function formatLockRemaining(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0);

  if (totalSeconds <= 0) {
    return "Less than 1 minute";
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = `${hours} hour${hours === 1 ? "" : "s"}`;

  if (minutes === 0) {
    return hourText;
  }

  return `${hourText} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export default function LockAttemptSettings({
  accounts = [],
  refreshing = false,
  unlockingAccountId = "",
  onRefresh,
  onUnlock,
}) {
  const lockedAccountColumns = [
    {
      key: "account",
      header: "Account",
      cardRole: "title",
      render: (row) => {
        const displayName = row.employeeName || row.username || "Unknown account";
        const detail = row.email || row.employeeId || row.username || "N/A";

        return (
          <div>
            <p className="m-0 font-semibold text-slate-900">{displayName}</p>
            <p className="m-0 mt-1 text-xs text-slate-500">{detail}</p>
            {row.division || row.position ? (
              <p className="m-0 mt-1 max-w-[260px] truncate text-xs text-slate-400">
                {[row.position, row.division].filter(Boolean).join(" - ")}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "role",
      header: "Role",
      render: (row) => row.role || "N/A",
    },
    {
      key: "failedLoginAttempts",
      header: "Failed Logins",
      cardRole: "badge",
      render: (row) => (
        <span className="inline-flex min-h-7 items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700">
          {Number(row.failedLoginAttempts) || 0}
        </span>
      ),
    },
    {
      key: "lockedUntil",
      header: "Locked Until",
      render: (row) => (
        <div>
          <p className="m-0 font-semibold text-slate-900">{formatBackupDateTime(row.lockedUntil)}</p>
          <p className="m-0 mt-1 text-xs text-slate-500">{formatLockRemaining(row.secondsRemaining)} left</p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          icon={UnlockKeyhole}
          loading={unlockingAccountId === String(row.id)}
          onClick={() => onUnlock?.(row)}
        >
          Unlock
        </Button>
      ),
    },
  ];

  return (
    <SettingsPanel
      icon={UnlockKeyhole}
      title="Locked Accounts"
      description="Accounts appear here only while failed login attempts have locked them."
      actions={
        <>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            {accounts.length} locked
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={refreshing}
            onClick={onRefresh}
          >
            Refresh
          </Button>
        </>
      }
    >
      <Table
        columns={lockedAccountColumns}
        data={accounts}
        emptyMessage="No accounts are currently locked from failed logins."
        className="rounded-lg border border-slate-200"
        cardsClassName="lg:hidden"
        tableWrapperClassName="hidden lg:block"
      />
    </SettingsPanel>
  );
}
