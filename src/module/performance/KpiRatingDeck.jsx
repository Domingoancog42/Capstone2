import React from "react";
import RatingInput from "./RatingInput";
import { FieldCaption, RatingPill, RatingQuickPick } from "./PerformanceHubUI";

/*
 * The Mode of Verification dialog shows every KPI of a form at once, one card each, instead of a
 * "KPI in this form" dropdown that showed them one at a time. Each card carries its own scores; the
 * dialog's Rate button saves every card that was changed.
 */

export const RATING_CRITERIA = [
  { name: "q1Rating", label: "1 Quantity", criterion: "Quantity" },
  { name: "e2Rating", label: "2 Efficiency", criterion: "Efficiency" },
  { name: "t3Rating", label: "3 Timeliness", criterion: "Timeliness" },
];

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Whether all three criteria hold a score from 1 to 5. */
export function hasCompleteScores(form) {
  return RATING_CRITERIA.every(({ name }) => {
    const value = score(form?.[name]);
    return value >= 1 && value <= 5;
  });
}

/** The card's live average, or "" until all three criteria are scored. */
export function liveAverage(form) {
  if (!hasCompleteScores(form)) return "";
  const total = RATING_CRITERIA.reduce((sum, { name }) => sum + score(form[name]), 0);
  return (total / RATING_CRITERIA.length).toFixed(2);
}

/** A form's projected average: each KPI's entered average, else its saved one. */
export function projectedAverage(entries) {
  const scores = entries
    .map(({ form, savedScore }) => Number(liveAverage(form)) || Number(savedScore) || 0)
    .filter((value) => value > 0);
  if (scores.length === 0) return "";
  return (scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2);
}

export function KpiRatingCard({
  id,
  index,
  title,
  subtitle,
  tags,
  savedScore,
  form,
  onChange,
  disabled = false,
  details,
  fields,
  idPrefix,
  /* Off for a KPI that gets no scores here: one being returned, or one with nothing to validate. */
  showScores = true,
}) {
  const average = showScores ? liveAverage(form) : "";

  return (
    <section
      id={id}
      role="group"
      aria-label={`KPI ${index + 1}: ${title}`}
      className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-xs font-bold text-accent-700 dark:bg-accent-950 dark:text-accent-300" aria-hidden="true">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold leading-snug text-slate-900">{title}</p>
            {subtitle ? (
              <p className="m-0 mt-0.5 line-clamp-1 text-[11px] text-slate-500" title={subtitle}>{subtitle}</p>
            ) : null}
            {tags ? <div className="mt-1.5 flex flex-wrap gap-1.5">{tags}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {form?.dirty ? (
            <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              Unsaved
            </span>
          ) : null}
          <RatingPill value={average || savedScore} size="sm" />
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-3">{details}</div>
        <div className="min-w-0 space-y-3">
          {fields}
          {showScores ? (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-2 flex items-center justify-between gap-3">
                <FieldCaption>Scores</FieldCaption>
                <span className="text-xs text-slate-500">
                  Average <strong className="tabular-nums text-slate-900">{average || "N/A"}</strong>
                </span>
              </div>
              <div className="space-y-2.5">
                {RATING_CRITERIA.map((criterion) => (
                  <div key={criterion.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <div className="w-[11rem] shrink-0">
                      <RatingInput
                        id={`${idPrefix}-${criterion.name}`}
                        label={criterion.label}
                        value={form?.[criterion.name] ?? ""}
                        onValueChange={(value) => onChange({ [criterion.name]: value })}
                        disabled={disabled}
                        className="grid grid-cols-[6rem_minmax(0,1fr)] items-center [&>label]:mb-0"
                        inputClassName="py-1.5 text-sm"
                      />
                    </div>
                    <RatingQuickPick
                      criterion={criterion.criterion}
                      value={form?.[criterion.name]}
                      onPick={(value) => onChange({ [criterion.name]: value })}
                      disabled={disabled}
                      className=""
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * The side list of a form's KPIs: how many are scored, and a jump to each card. `items` are
 * `{ key, title, form, savedScore }` in card order.
 */
export function KpiRatingNavigator({ items = [], onJump }) {
  const scored = items.filter((item) => liveAverage(item.form) || Number(item.savedScore) > 0).length;
  const share = items.length > 0 ? Math.round((scored / items.length) * 100) : 0;

  return (
    <nav aria-label="KPIs in this form" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800">
      <div className="flex items-center justify-between gap-3">
        <FieldCaption>KPIs in this form</FieldCaption>
        <span className="text-xs font-semibold tabular-nums text-slate-600">{scored}/{items.length} scored</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${share}%` }} />
      </div>
      <ol className="m-0 mt-3 list-none space-y-1 p-0">
        {items.map((item, index) => {
          const average = liveAverage(item.form) || (Number(item.savedScore) > 0 ? Number(item.savedScore).toFixed(2) : "");
          const tone = item.form?.dirty
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            : average
            ? "bg-accent-100 text-accent-700 dark:bg-accent-950 dark:text-accent-300"
            : "bg-slate-100 text-slate-500 dark:bg-slate-800";
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onJump(item.key)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 dark:hover:bg-slate-800"
              >
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${tone}`}>{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{item.title}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{average || "—"}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="m-0 mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent-400" aria-hidden="true" />Scored</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />Unsaved</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />Not rated</span>
      </p>
    </nav>
  );
}
