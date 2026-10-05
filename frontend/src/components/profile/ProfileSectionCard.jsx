import React from "react";
import Button from "../UI/button";

export default function ProfileSectionCard({
  id,
  title,
  description,
  icon: Icon,
  badge,
  actions,
  children,
  readOnly = false,
  saving = false,
  onSave,
  saveLabel = "Save Changes",
  className = "",
}) {
  return (
    <section
      id={id}
      // scroll-mt clears the fixed header plus the sticky nav, which wraps to two rows below xl.
      className={`profile-section-card min-w-0 scroll-mt-[236px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:scroll-mt-[188px] ${className}`.trim()}
    >
      <header className="profile-section-card-header flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="profile-section-card-icon grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#F8BFBF] bg-[#FEF1F1] text-[#D61E1E]">
              <Icon size={17} aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="profile-section-card-title m-0 text-sm font-semibold text-slate-900">{title}</h3>
              {badge ? (
                <span className="profile-section-card-badge rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {badge}
                </span>
              ) : null}
            </div>
            <p className="profile-section-card-description m-0 mt-0.5 max-w-3xl text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>

        {actions ? (
          <div className="profile-section-card-actions flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div>
        ) : null}
      </header>

      <div className="profile-section-card-body min-w-0 space-y-4 p-3 sm:space-y-5 sm:p-4">{children}</div>

      {onSave ? (
        <div className="profile-section-card-footer flex items-center justify-end border-t border-slate-100 bg-white px-3 py-3 sm:px-4">
          <Button
            variant="primary"
            loading={saving}
            disabled={readOnly}
            onClick={onSave}
            className="w-full sm:w-auto"
          >
            {saveLabel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
