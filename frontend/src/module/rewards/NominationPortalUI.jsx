import React, { useMemo, useState } from "react";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import {
  PHASE_LABELS,
  buildStandings,
  formatCycleMonth,
  formatDate,
  formatMoment,
  parseMoment,
  voteShare,
} from "./awardCycleUtils";

/**
 * The building blocks of the Nomination portal: stat cards, tabs, cycle cards, nomination cards,
 * and the winners tally. Presentational only — `AwardCyclesWorkspace` owns the
 * data and hands down what each piece shows and what its buttons do.
 *
 * The Nomination and Award Voting screens are text-only: no icons in their buttons, cards, or
 * badges. `StatCard` and `PortalEmptyState` still draw an icon when a caller passes one, because
 * My Rewards shares them and keeps its own.
 */

/** The portal's own accent, used for chips and labels. Buttons stay on the teal of "New nomination". */
const ACCENT_TEXT = "text-[#a35f00]";

/* -------------------------------------------------------------------------------------------- */
/* Buttons and small chrome                                                                      */
/* -------------------------------------------------------------------------------------------- */

const BUTTON_VARIANTS = {
  primary: "bg-teal-700 text-white shadow-sm hover:bg-teal-800 focus-visible:ring-teal-200",
  outline: "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-200",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-200",
  success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-200",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:ring-rose-200",
  dangerOutline: "border border-slate-200 bg-white text-rose-600 shadow-sm hover:bg-rose-50 hover:text-rose-700 focus-visible:ring-rose-200",
};

const BUTTON_SIZES = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-4 text-sm",
};

export function PortalButton({ variant = "primary", size = "md", className = "", type = "button", children, ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-semibold transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_SIZES[size] || BUTTON_SIZES.md} ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

/** A deterministic colour per name, so the same person reads the same everywhere without a photo. */
function avatarHue(seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = seed.charCodeAt(index) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function initialsOf(name) {
  return String(name || "")
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

const AVATAR_SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-16 w-16 text-lg",
};

/**
 * A person's photo from the directory, or their initials on a colour drawn from their name. `alt=""`
 * on purpose: the name is always rendered beside it.
 */
export function PersonAvatar({ name, photo, size = "md", className = "" }) {
  const avatarUrl = resolveBackendAssetUrl(photo);

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white shadow-sm ring-2 ring-white/40 ${AVATAR_SIZES[size] || AVATAR_SIZES.md} ${className}`.trim()}
      style={avatarUrl ? undefined : { backgroundColor: `hsl(${avatarHue(String(name || "?"))}, 65%, 45%)` }}
      aria-hidden="true"
    >
      {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </span>
  );
}

const PHASE_TONES = {
  nomination: { pill: "border-emerald-500/30 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", bar: "from-emerald-400 to-emerald-600" },
  voting: { pill: "border-sky-500/30 bg-sky-50 text-sky-700", dot: "bg-sky-500", bar: "from-sky-400 to-sky-600" },
  closed: { pill: "border-slate-300/60 bg-slate-100 text-slate-600", dot: "bg-slate-400", bar: "from-slate-200 to-slate-400" },
};

/** Archiving outranks the phase: a retired cycle reads "Archived" whatever state it was left in. */
export function CycleStatusBadge({ phase, archived = false }) {
  const tone = archived
    ? { label: "Archived", pill: "border-amber-500/30 bg-amber-50 text-amber-800", dot: "bg-amber-500" }
    : { label: PHASE_LABELS[phase] || PHASE_LABELS.closed, ...(PHASE_TONES[phase] || PHASE_TONES.closed) };

  return (
    <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tone.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
      {tone.label}
    </span>
  );
}

const NOMINATION_STATUS_TONES = {
  submitted: { label: "Pending Review", pill: "border-amber-500/30 bg-amber-50 text-amber-700" },
  approved: { label: "Approved", pill: "border-emerald-500/30 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", pill: "border-rose-500/30 bg-rose-50 text-rose-700" },
};

export function NominationStatusBadge({ status }) {
  const tone = NOMINATION_STATUS_TONES[status] || NOMINATION_STATUS_TONES.submitted;

  return (
    <span className={`inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tone.pill}`}>
      {tone.label}
    </span>
  );
}

export function CardSkeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100 ${className}`.trim()} aria-hidden="true" />;
}

/** `icon` is optional: the Nomination screens show the message alone, My Rewards passes its own. */
export function PortalEmptyState({ icon: Icon = null, title, description, action = null, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-16 text-center ${className}`.trim()}>
      {Icon ? (
        <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500">
          <Icon size={24} aria-hidden="true" />
        </div>
      ) : null}
      <div className="max-w-sm space-y-1">
        <p className="m-0 text-sm font-medium text-slate-900">{title}</p>
        {description ? <p className="m-0 text-xs text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Page header pieces                                                                            */
/* -------------------------------------------------------------------------------------------- */

const STAT_ACCENTS = {
  primary: "bg-[#a35f00]/10 text-[#a35f00] ring-[#a35f00]/20",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-500/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-500/20",
  rose: "bg-rose-50 text-rose-700 ring-rose-500/20",
  muted: "bg-slate-100 text-slate-500 ring-slate-200",
};

/** `icon` is optional, as on `PortalEmptyState`: only My Rewards still passes one. */
export function StatCard({ label, value, icon: Icon = null, hint, accent = "primary" }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      {Icon ? (
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-2 ${STAT_ACCENTS[accent] || STAT_ACCENTS.primary}`}>
          <Icon size={20} aria-hidden="true" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-2xl font-bold leading-tight tracking-tight text-slate-950">{value}</div>
        <div className="truncate text-xs font-medium text-slate-500">{label}</div>
        {hint ? <div className="truncate text-[11px] text-slate-400">{hint}</div> : null}
      </div>
    </div>
  );
}

/** A segmented tab bar. Full width on a phone, shrink-wrapped from `sm` up. */
export function PortalTabs({ tabs, value, onChange, label = "Nomination views" }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid w-full rounded-lg bg-slate-100 p-[3px] text-xs sm:inline-grid sm:w-auto sm:text-sm"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-200 ${
              selected ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700">
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Cycle card                                                                                    */
/* -------------------------------------------------------------------------------------------- */

const MINI_STAT_TONES = {
  default: "bg-slate-100/80 text-slate-900",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  sky: "bg-sky-50 text-sky-700",
};

function MiniStat({ label, value, tone = "default" }) {
  return (
    <div className={`rounded-lg p-2.5 ${MINI_STAT_TONES[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold leading-none">{value}</div>
    </div>
  );
}

/** Past this the card clamps the description and offers the full text in the floating card. */
const DESCRIPTION_PREVIEW_LIMIT = 120;

/**
 * The deadline line of a cycle card. Nominations and voting share one period, so it is one time,
 * worded for where the cycle stands — including a period run out but reopened to settle a tie.
 */
function periodText(cycle, closesOn) {
  if (cycle.isArchived || cycle.phase === "closed") return `Closed ${closesOn}`;
  if (cycle.phase === "voting") return `Period ended ${closesOn} · reopened for voting`;

  return `Nominations & voting close ${closesOn}`;
}

/**
 * One award cycle. `primaryAction` is the role's main verb (review its nominations, nominate into
 * it); `extraActions` is where the HR Head's edit / archive / restore buttons go.
 */
export function CycleCard({
  cycle,
  counts,
  primaryAction = null,
  onOpenDetails = null,
  onToggleStatus = null,
  toggleDisabled = false,
  toggleTitle = "",
  extraActions = null,
  onReadDescription = null,
}) {
  const month = formatCycleMonth(cycle.opensOn);
  const closesOn = formatMoment(cycle.closesOn);
  const longDescription = cycle.description.length > DESCRIPTION_PREVIEW_LIMIT;
  const barTone = cycle.isArchived ? PHASE_TONES.closed : PHASE_TONES[cycle.phase] || PHASE_TONES.closed;

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className={`h-1.5 w-full bg-gradient-to-r ${barTone.bar}`} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-base font-semibold leading-tight text-slate-950">{cycle.category}</h3>
            <CycleStatusBadge phase={cycle.phase} archived={cycle.isArchived} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
            <span>{month || "No month set"}</span>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <span>Created {formatDate(cycle.createdAt) || "—"}</span>
          </div>
          {closesOn ? (
            <div className="mt-0.5 text-xs text-slate-500">{periodText(cycle, closesOn)}</div>
          ) : null}
        </div>

        {cycle.description ? (
          <div>
            <p className="m-0 line-clamp-2 whitespace-pre-wrap text-sm text-slate-500">{cycle.description}</p>
            {longDescription && onReadDescription ? (
              <button
                type="button"
                onClick={onReadDescription}
                className="m-0 mt-1 border-0 bg-transparent p-0 text-xs font-semibold text-teal-700 transition hover:text-teal-900 hover:underline"
              >
                Read full description
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Votes in place of Rejected, which is only the remainder of the other three. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Nominations" value={counts.total} />
          <MiniStat label="Pending" value={counts.pending} tone="amber" />
          <MiniStat label="Approved" value={counts.approved} tone="emerald" />
          <MiniStat label="Votes" value={cycle.totalVotes ?? "—"} tone="sky" />
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {primaryAction ? (
            <PortalButton size="sm" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
              {primaryAction.label}
            </PortalButton>
          ) : null}
          {onOpenDetails ? (
            <PortalButton size="sm" variant="outline" onClick={onOpenDetails}>
              View details
            </PortalButton>
          ) : null}
          {extraActions}
          {onToggleStatus ? (
            <PortalButton
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={onToggleStatus}
              disabled={toggleDisabled}
              title={toggleTitle || undefined}
            >
              {cycle.status === "closed" ? "Reopen" : cycle.phase === "voting" ? "Close voting" : "Close cycle"}
            </PortalButton>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Nomination card                                                                               */
/* -------------------------------------------------------------------------------------------- */

function formatReviewMoment(value) {
  const parsed = parseMoment(value);

  return parsed
    ? parsed.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";
}

/**
 * One nomination: who was put forward, why, by whom, and what HR decided. `cycleLabel` names the
 * award when the list mixes cycles (the Pending and Recognized tabs); inside one cycle it is left off.
 */
export function NominationCard({
  nomination,
  nominee = null,
  nominator = null,
  showNominator = true,
  cycleLabel = "",
  canReview = false,
  onApprove,
  onReject,
}) {
  const reviewable = canReview && nomination.status === "submitted" && onApprove && onReject;
  const position = nomination.nomineePosition || nominee?.position || "";
  const division = nomination.nomineeDivision || nominee?.department || nominee?.division || "";

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start">
      <PersonAvatar name={nomination.nomineeName} photo={nominee?.profileImage} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="m-0 text-base font-semibold leading-tight text-slate-950">{nomination.nomineeName}</h4>
              <NominationStatusBadge status={nomination.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              {position ? <span>{position}</span> : null}
              {position && division ? <span aria-hidden="true">·</span> : null}
              {division ? <span>{division}</span> : null}
            </div>
            {cycleLabel ? (
              <div className={`mt-1 text-xs font-medium ${ACCENT_TEXT}`}>{cycleLabel}</div>
            ) : null}
          </div>
          <div className="text-right text-[11px] text-slate-500">
            <div>Submitted</div>
            <div className="font-medium text-slate-700">{formatDate(nomination.createdAt) || "—"}</div>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Nomination reason
          </div>
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {nomination.reason || <span className="italic text-slate-400">No reason was given.</span>}
          </p>
        </div>

        {showNominator && nomination.voterName ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <PersonAvatar name={nomination.voterName} photo={nominator?.profileImage} size="sm" className="ring-1 ring-slate-200" />
            <span>
              Nominated by <span className="font-medium text-slate-700">{nomination.voterName}</span>
              {" · Division Chief"}
              {nomination.voterDivision ? ` · ${nomination.voterDivision}` : ""}
            </span>
          </div>
        ) : null}

        {nomination.status !== "submitted" && nomination.reviewedAt ? (
          <div className="mt-3 rounded-lg border border-slate-200/70 bg-white p-3 text-xs">
            <div className="font-semibold uppercase tracking-wide text-slate-500">
              HR review · {formatReviewMoment(nomination.reviewedAt)}
            </div>
            {nomination.reviewerNote ? (
              <p className="m-0 mt-1 whitespace-pre-wrap text-slate-700">{nomination.reviewerNote}</p>
            ) : (
              <p className="m-0 mt-1 italic text-slate-500">No additional reviewer note provided.</p>
            )}
          </div>
        ) : null}

        {reviewable ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <PortalButton size="sm" variant="success" onClick={() => onApprove(nomination)}>
              Approve
            </PortalButton>
            <PortalButton size="sm" variant="dangerOutline" onClick={() => onReject(nomination)}>
              Reject
            </PortalButton>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Winners tally                                                                                 */
/* -------------------------------------------------------------------------------------------- */

/*
 * The podium is laid out 2-1-3 from `sm` up so first place stands in the middle, and 1-2-3 when it
 * stacks. Minimum heights rather than fixed ones: a fixed height would clip a long name or the
 * certificate button, and the step between places still reads.
 */
const PODIUM = {
  1: {
    container: "border-amber-300/60 bg-gradient-to-b from-amber-50 to-amber-100/60",
    badge: "bg-amber-500 text-white shadow-md shadow-amber-500/30",
    label: "1st Place",
    height: "sm:min-h-[18rem]",
    order: "order-1 sm:order-2",
    ring: "ring-4 ring-amber-400/40",
  },
  2: {
    container: "border-slate-300/60 bg-gradient-to-b from-slate-50 to-slate-100/60",
    badge: "bg-slate-400 text-white shadow-md shadow-slate-400/30",
    label: "2nd Place",
    height: "sm:min-h-[16.5rem]",
    order: "order-2 sm:order-1",
    ring: "ring-4 ring-slate-300/40",
  },
  3: {
    container: "border-orange-300/60 bg-gradient-to-b from-orange-50 to-orange-100/60",
    badge: "bg-orange-600 text-white shadow-md shadow-orange-600/30",
    label: "3rd Place",
    height: "sm:min-h-[15.5rem]",
    order: "order-3 sm:order-3",
    ring: "ring-4 ring-orange-400/40",
  },
};

function PodiumCard({ entry, position, employee, totalVotes, onViewCertificate }) {
  const place = PODIUM[position];

  return (
    <div
      className={`relative flex flex-col items-center justify-end gap-2 overflow-hidden rounded-xl border-2 px-4 pb-5 pt-11 text-center shadow-sm transition-transform hover:-translate-y-0.5 ${place.container} ${place.height} ${place.order}`}
    >
      <div className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${place.badge}`}>
        {place.label}
      </div>
      <PersonAvatar name={entry.name} photo={employee?.profileImage || entry.photo} size="xl" className={place.ring} />
      <div className="w-full min-w-0">
        <div className="truncate text-base font-bold leading-tight text-slate-950">{entry.name}</div>
        <div className="truncate text-xs text-slate-500">{entry.position || "—"}</div>
        <div className="mt-0.5 truncate text-[11px] text-slate-500">{entry.division || "—"}</div>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs">
        <div className="flex flex-col items-center">
          <span className="text-lg font-bold text-slate-950">{entry.votes}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{entry.votes === 1 ? "Vote" : "Votes"}</span>
        </div>
        <div className="h-8 w-px bg-slate-200" aria-hidden="true" />
        <div className="flex flex-col items-center">
          <span className="text-lg font-bold text-slate-950">{voteShare(entry.votes, totalVotes)}%</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Share</span>
        </div>
      </div>
      {onViewCertificate ? (
        <PortalButton
          size="sm"
          variant="outline"
          onClick={onViewCertificate}
          className="mt-1 border-amber-500/40 bg-white/70 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
        >
          View Certificate
        </PortalButton>
      ) : null}
    </div>
  );
}

const RANK_TONES = {
  1: "bg-amber-500 text-white",
  2: "bg-slate-400 text-white",
  3: "bg-orange-600 text-white",
};

const COUNT_TONES = {
  sky: "bg-sky-50 text-sky-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  muted: "bg-slate-100 text-slate-500",
};

function CountPill({ label, value, tone }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${COUNT_TONES[tone]}`}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  );
}

function RankingRow({ entry, employee, isPodium, totalVotes }) {
  const share = voteShare(entry.votes, totalVotes);

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${RANK_TONES[entry.rank] || "bg-slate-100 text-slate-500"}`}
        aria-label={`Rank ${entry.rank}`}
      >
        {entry.rank}
      </div>
      <PersonAvatar name={entry.name} photo={employee?.profileImage || entry.photo} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-950">{entry.name}</span>
          {isPodium ? (
            <span className={`hidden rounded-full bg-[#a35f00]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline-flex ${ACCENT_TEXT}`}>
              Top 3
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          {entry.position ? <span className="truncate">{entry.position}</span> : null}
          {entry.division ? (
            <>
              {entry.position ? <span className="text-slate-300" aria-hidden="true">·</span> : null}
              <span>{entry.division}</span>
            </>
          ) : null}
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span>Last nominated {formatDate(entry.nominations[0]?.createdAt) || "—"}</span>
        </div>
        {/* The share of the votes on show, so the gap between places reads at a glance. */}
        <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${share}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs sm:gap-4">
        <CountPill label={entry.votes === 1 ? "Vote" : "Votes"} value={entry.votes} tone="sky" />
        <CountPill label="Share" value={`${share}%`} tone="muted" />
      </div>
    </li>
  );
}

function TallySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
        <CardSkeleton className="h-36 sm:order-1" />
        <CardSkeleton className="h-44 sm:order-2" />
        <CardSkeleton className="h-32 sm:order-3" />
      </div>
      <CardSkeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * The certificate first place opens: the one actually issued when there is one — for the selected
 * cycle, or the person's latest win when looking across all cycles — and otherwise a preview of the
 * award the cycle gives, marked as not yet issued, from the latest cycle that approved them.
 */
function podiumCertificate(entry, cycles, scopedCycle) {
  const issued = (scopedCycle ? [scopedCycle] : cycles)
    .map((cycle) => cycle.certificate)
    .filter((certificate) => certificate && String(certificate.employeeRecordId) === entry.key)
    .sort((a, b) => String(b.awardedOn ?? "").localeCompare(String(a.awardedOn ?? "")))[0];

  if (issued) {
    return issued;
  }

  const awardCycle = scopedCycle || cycles.find((cycle) => cycle.nominations.some(
    (nomination) => String(nomination.nomineeKey || nomination.nomineeName) === entry.key && nomination.status === "approved",
  ));

  return {
    id: `preview-${awardCycle?.id ?? "all"}-${entry.key}`,
    isPreview: true,
    awardTitle: awardCycle?.category || "Award",
    employeeName: entry.name,
    designationTitle: entry.position,
    divisionName: entry.division,
    votes: entry.votes,
    opensOn: awardCycle?.opensOn || "",
    closesOn: awardCycle?.closesOn || "",
    awardedOn: "",
    certificateNumber: "",
  };
}

/**
 * The ranked leaderboard of the approved nominees, with the top three on a podium. A nominee joins it
 * the moment HR approves them — at zero votes, since that is when the employees can start voting for
 * them — and moves up as the votes come in. Scoped to all cycles or to one; first place always offers
 * its certificate (see `podiumCertificate`).
 */
export function WinnersTally({ cycles = [], employeeLookup = new Map(), loading = false, onViewCertificate }) {
  const [scope, setScope] = useState("ALL");
  const scopedCycle = scope === "ALL" ? null : cycles.find((cycle) => cycle.id === scope) || null;

  const standings = useMemo(() => buildStandings(scopedCycle ? [scopedCycle] : cycles), [cycles, scopedCycle]);

  const podium = standings.slice(0, 3);
  const podiumKeys = new Set(podium.map((entry) => entry.key));
  const totalVotes = standings.reduce((sum, entry) => sum + entry.votes, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight text-slate-950">Winners Tally</h2>
          <p className="m-0 text-sm text-slate-500">
            Approved nominees ranked by the employees&apos; votes. Top 3 win{" "}
            <span className="font-medium text-slate-900">Gold</span>,{" "}
            <span className="font-medium text-slate-900">Silver</span>, and{" "}
            <span className="font-medium text-slate-900">Bronze</span>.
          </p>
        </div>
        <select
          value={scopedCycle ? scope : "ALL"}
          onChange={(event) => setScope(event.target.value)}
          aria-label="Tally period"
          className="h-9 w-[220px] rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        >
          <option value="ALL">All time</option>
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.category} · {formatCycleMonth(cycle.opensOn) || "No month"}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <TallySkeleton />
      ) : standings.length === 0 ? (
        <PortalEmptyState
          title="No approved nominees yet"
          description="Once HR approves the Division Chiefs' nominations, the nominees appear here and the employees can start voting for them."
        />
      ) : (
        <>
          {totalVotes === 0 ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-center text-sm text-sky-800">
              No votes yet — the standings will move as the employees vote.
            </div>
          ) : null}

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
            {[2, 1, 3].map((position) => {
              const entry = podium[position - 1];

              return entry ? (
                <PodiumCard
                  key={entry.key}
                  entry={entry}
                  position={position}
                  employee={employeeLookup.get(entry.key)}
                  totalVotes={totalVotes}
                  onViewCertificate={
                    position === 1 && onViewCertificate
                      ? () => onViewCertificate(podiumCertificate(entry, cycles, scopedCycle))
                      : null
                  }
                />
              ) : (
                <div key={`empty-${position}`} className={`hidden sm:block ${PODIUM[position].order}`} aria-hidden="true" />
              );
            })}
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-3">
              <div className="text-sm font-semibold text-slate-950">Full Ranking</div>
              <div className="text-xs text-slate-500">
                {standings.length} approved {standings.length === 1 ? "nominee" : "nominees"} · {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
              </div>
            </div>
            <ol className="m-0 list-none divide-y divide-slate-200/70 p-0">
              {standings.map((entry) => (
                <RankingRow
                  key={entry.key}
                  entry={entry}
                  employee={employeeLookup.get(entry.key)}
                  isPodium={podiumKeys.has(entry.key)}
                  totalVotes={totalVotes}
                />
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
