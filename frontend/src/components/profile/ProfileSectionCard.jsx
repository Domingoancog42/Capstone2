import React from "react";
import Button from "../UI/button";

export default function ProfileSectionCard({
  title,
  description,
  children,
  readOnly = false,
  saving = false,
  onSave,
  saveLabel = "Save Changes",
  className = "",
}) {
  return (
    <section className={`profile-section-card rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`.trim()}>
      <div className="profile-section-card-header border-b border-slate-100 pb-4">
        <div>
          <h3 className="profile-section-card-title m-0 text-lg font-semibold text-slate-950">{title}</h3>
          <p className="profile-section-card-description m-0 mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
        </div>
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
