import React from "react";
import { resolveEmployeeInitials } from "../../components/employee/AdminEmployeeCard";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

/**
 * A nominee's face, from the live directory rather than a copy taken at vote time.
 *
 * Sizing, border, and ring come in through `className` — the podium and the leaderboard row want
 * very different chrome, and letting the caller own it avoids the Tailwind override coin-toss.
 *
 * `alt=""` on purpose: the name is always rendered beside it, so a description here would only make
 * a screen reader say it twice.
 */
export function NomineeAvatar({ employee, name, className = "" }) {
  const avatarUrl = resolveBackendAssetUrl(employee?.profileImage);

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 font-bold text-slate-500 ${className}`.trim()}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{resolveEmployeeInitials(employee || { fullName: name })}</span>
      )}
    </span>
  );
}

/**
 * Shared by the cycle list and the cycle detail so the two cannot drift out of step.
 *
 * Archiving outranks the voting status: a cycle in the archive still carries whichever state it was
 * in when it was retired, but "Ongoing" on a cycle nobody can vote in would be a lie, so the pill
 * reports the archive instead. Restoring it brings the underlying status back into view unchanged.
 */
export function StatusPill({ status, archived = false, className = "" }) {
  const tone = archived
    ? { label: "Archived", pill: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" }
    : status === "closed"
      ? { label: "Closed", pill: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-400" }
      : { label: "Ongoing", pill: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.pill} ${className}`.trim()}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
      {tone.label}
    </span>
  );
}

/** The card chrome the detail screen repeats three times over. */
export function PanelCard({ title, aside, children, className = "", bodyClassName = "" }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`.trim()}>
      <header className="flex items-center justify-between gap-3 px-5 py-4">
        <h3 className="m-0 text-base font-semibold text-slate-900">{title}</h3>
        {aside ? <span className="text-xs font-semibold text-slate-400">{aside}</span> : null}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
