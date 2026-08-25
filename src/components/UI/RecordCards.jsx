import React from "react";

/**
 * The narrow-screen face of a record table.
 *
 * Every workspace in this app shows its records as a wide table (900-1760px of columns) inside an
 * `overflow-x-auto` wrapper. That is fine on a laptop and unusable on a phone, where reading one
 * row means dragging the table sideways past eight columns. This renders the same records as a grid
 * of cards instead, so a screen pairs the two and lets the breakpoint pick:
 *
 *     <RecordCards className="lg:hidden" ... />
 *     <div className="hidden lg:block"> ...the existing table... </div>
 *
 * The breakpoint classes are written out by the caller rather than composed from a prop, because
 * Tailwind only emits the utilities it can find as literal text in the source.
 *
 * `renderCard` returns a descriptor rather than JSX so every screen's cards share one shape:
 *
 *   {
 *     eyebrow,           // small muted line above the title, e.g. the row number
 *     title,             // the one thing that identifies this record
 *     subtitle,          // the next most useful line — usually a date or a date range
 *     badge,             // a node pinned top-right, normally the status pill
 *     fields: [          // the remaining columns, as label/value pairs
 *       { label, value, full? }   // `full` spans both columns, for long text
 *     ],
 *     actions,           // the row's action buttons, in a footer
 *   }
 */

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-16 rounded bg-slate-200" />
          <div className="h-4 w-3/4 rounded bg-slate-200" />
        </div>
        <div className="h-6 w-20 shrink-0 rounded-full bg-slate-200" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="space-y-1.5">
            <div className="h-2.5 w-12 rounded bg-slate-200" />
            <div className="h-3.5 w-20 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ empty }) {
  if (!empty) {
    return null;
  }

  /* A caller with something more specific to show can hand over a finished node instead. */
  if (React.isValidElement(empty)) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12">{empty}</div>;
  }

  const Icon = empty.icon;

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
      {Icon ? (
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
          <Icon size={20} aria-hidden="true" />
        </div>
      ) : null}
      <p className="m-0 mt-3 text-sm font-semibold text-slate-700">{empty.title}</p>
      {empty.description ? <p className="m-0 mt-1 text-sm text-slate-500">{empty.description}</p> : null}
    </div>
  );
}

function RecordCard({ card }) {
  const fields = (card.fields || []).filter(Boolean);

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          {card.eyebrow ? (
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{card.eyebrow}</p>
          ) : null}
          <p className="m-0 mt-0.5 break-words text-sm font-semibold text-slate-900">{card.title}</p>
          {card.subtitle ? <p className="m-0 mt-1 break-words text-xs text-slate-500">{card.subtitle}</p> : null}
        </div>
        {card.badge ? <div className="shrink-0">{card.badge}</div> : null}
      </div>

      {fields.length ? (
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-3 p-4">
          {fields.map((field) => (
            <div key={field.label} className={field.full ? "col-span-2 min-w-0" : "min-w-0"}>
              <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{field.label}</dt>
              <dd className="m-0 mt-1 break-words text-sm text-slate-700">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {card.actions ? (
        /* `mt-auto` keeps the footer on the floor of the card so a row of cards lines its buttons up. */
        <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
          {card.actions}
        </div>
      ) : null}
    </article>
  );
}

export default function RecordCards({
  items = [],
  renderCard,
  itemKey,
  loading = false,
  loadingCards = 3,
  empty = null,
  className = "",
  /*
   * One column on a phone, two once there is room for them. A screen whose cards carry a lot of
   * fields can pass `grid gap-3` to stay single-column all the way up to its table breakpoint.
   */
  gridClassName = "grid gap-3 sm:grid-cols-2",
}) {
  if (loading) {
    return (
      <div className={`${gridClassName} ${className}`.trim()}>
        {Array.from({ length: loadingCards }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className={className}>
        <EmptyState empty={empty} />
      </div>
    );
  }

  return (
    <div className={`${gridClassName} ${className}`.trim()}>
      {items.map((item, index) => (
        <RecordCard
          key={itemKey ? itemKey(item, index) : (item?.id ?? index)}
          card={renderCard(item, index)}
        />
      ))}
    </div>
  );
}
