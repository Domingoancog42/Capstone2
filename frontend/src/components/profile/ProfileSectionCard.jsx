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
      className={`profile-section-card scroll-mt-[236px] xl:scroll-mt-[188px] rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-4 ${className}`.trim()}
    >
      <div className="profile-section-card-header flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="profile-section-card-icon grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#F8BFBF] bg-[#FEF1F1] text-[#D61E1E]">
              <Icon size={19} aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="profile-section-card-title m-0 text-lg font-semibold text-slate-950">{title}</h3>
              {badge ? (
                <span className="profile-section-card-badge rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  {badge}
                </span>
              ) : null}
            </div>
            <p className="profile-section-card-description m-0 mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
          </div>
        </div>

        {actions ? (
          <div className="profile-section-card-actions flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <div className="profile-section-card-body mt-5 space-y-5">{children}</div>

      {onSave ? (
        <div className="profile-section-card-footer mt-6 flex items-center justify-end border-t border-slate-100 pt-4">
          <Button
            variant="primary"
            loading={saving}
            disabled={readOnly}
            onClick={onSave}
          >
            {saveLabel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
