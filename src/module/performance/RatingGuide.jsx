import React from "react";
import { performanceBand } from "./RatingSummaryCells";

const RATING_GUIDE = [
  [5, "Outstanding", "Exceeds all commitments and delivers exceptional results."],
  [4, "Very Satisfactory", "Exceeds most commitments and delivers above expectations."],
  [3, "Satisfactory", "Meets commitments and delivers expected results."],
  [2, "Unsatisfactory", "Partially meets commitments; improvement is needed."],
  [1, "Poor", "Does not meet commitments; minimal accomplishments."],
];

/** The 1–5 adjectival scale, shown beside the rating inputs so raters score against the same definitions. */
export default function RatingGuide({ className = "" }) {
  return (
    <section
      aria-label="Rating Guide"
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 ${className}`.trim()}
    >
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rating Guide</p>
      <div className="mt-3 space-y-2">
        {RATING_GUIDE.map(([score, label, description]) => (
          <div key={score} className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold tabular-nums ${performanceBand(score).scoreClassName}`}
              aria-hidden="true"
            >
              {score}
            </span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-slate-900">{label}</p>
              <p className="m-0 text-xs leading-5 text-slate-500">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
