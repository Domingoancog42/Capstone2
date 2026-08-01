import React from "react";
import { categoryDetail, statusDetail } from "./rewardsConstants";
import { initials, text } from "./rewardsUtils";

/** The small presentational pieces the rewards screens share. */

export function StatusBadge({ status }) {
  const detail = statusDetail(status);

  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-bold ${detail.badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${detail.dotClass}`} aria-hidden="true" />
      {detail.label}
    </span>
  );
}

export function CategoryBadge({ category, compact = false }) {
  const detail = categoryDetail(category);
  const Icon = detail.icon;

  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-bold ${detail.badgeClass}`}
      title={detail.label}
    >
      <Icon size={13} aria-hidden="true" />
      {compact ? detail.shortLabel : detail.label}
    </span>
  );
}

/** Avatar, name, and the identifying line under it — the first column of both tables. */
export function EmployeeIdentity({ name, primaryMeta, secondaryMeta }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-bold text-white">
        {initials(name)}
      </span>
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-semibold text-slate-900" title={name}>
          {text(name, "Unnamed Employee")}
        </p>
        {primaryMeta ? (
          <p className="m-0 mt-0.5 truncate text-xs text-slate-500" title={primaryMeta}>
            {primaryMeta}
          </p>
        ) : null}
        {secondaryMeta ? (
          <p className="m-0 mt-0.5 truncate text-xs text-slate-400" title={secondaryMeta}>
            {secondaryMeta}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The "no rows" panel. Distinguishes an empty list from a filtered-to-nothing list. */
export function TableEmptyState({ title, description, action }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="m-0 text-sm font-semibold text-slate-700">{title}</p>
      {description ? <p className="m-0 mt-1.5 text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
