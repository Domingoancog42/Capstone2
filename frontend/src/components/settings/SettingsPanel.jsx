import React from "react";
import SettingsNotice from "./SettingsNotice";

/**
 * The standard chrome for a settings section: optional icon, title, description, a header actions
 * slot, a status notice, the body, and an optional footer for the save button.
 *
 * Every settings screen was hand-rolling this, which is how the page ended up with `rounded-2xl`,
 * `rounded-2xl`, and `rounded-lg` panels side by side, headings at three different sizes, and save
 * buttons in three different positions. Rendering them all through one component is what makes the
 * page look designed rather than assembled.
 *
 * Pass `onSubmit` to render the panel as a `<form>` — most settings sections are forms, and this
 * keeps the footer save button wired to the same element without extra nesting.
 */
export default function SettingsPanel({
  icon: Icon,
  title,
  description,
  actions,
  notice,
  noticeTone = "info",
  footer,
  children,
  onSubmit,
  className = "",
  contentClassName = "",
  bodyPadding = true,
}) {
  const Wrapper = onSubmit ? "form" : "div";
  const wrapperProps = onSubmit ? { onSubmit } : {};

  return (
    <section
      className={`app-card overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_12px_30px_-24px_rgba(15,23,42,0.65)] ${className}`.trim()}
    >
      <Wrapper {...wrapperProps}>
        {title || description || actions ? (
          <header className="flex flex-col gap-4 border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/80 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-start gap-3">
              {Icon ? (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Icon size={18} aria-hidden="true" />
                </span>
              ) : null}
              <div className="min-w-0">
                {title ? <h2 className="m-0 text-base font-bold text-slate-900">{title}</h2> : null}
                {description ? (
                  <p className="m-0 mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
                ) : null}
              </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
          </header>
        ) : null}

        {notice ? (
          <div className="border-b border-slate-200 px-5 py-3">
            <SettingsNotice tone={noticeTone}>{notice}</SettingsNotice>
          </div>
        ) : null}

        <div className={`${bodyPadding ? "px-5 py-5" : ""} ${contentClassName}`.trim()}>{children}</div>

        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </Wrapper>
    </section>
  );
}

/** A labelled subsection inside a panel, for grouping related fields. */
export function SettingsSection({ title, description, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/70 p-4 ${className}`.trim()}>
      {title ? <h3 className="m-0 text-sm font-bold text-slate-900">{title}</h3> : null}
      {description ? <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
