import React from "react";
import { Camera, PencilLine, ScrollText } from "lucide-react";
import Button from "../UI/button";
import { resolveInitials } from "./profileUtils";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

export default function ProfileHeaderCard({
  profile,
  readOnly,
  onToggleMode,
  onChangePhoto,
  onOpenServiceRecord,
  className = "",
  user,
}) {
  const fullName = profile.fullName 
    || [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
    || user?.full_name
    || user?.username
    || "User";
  const profileImageUrl = resolveBackendAssetUrl(profile.profileImage);

  return (
    <section className={`profile-header-card overflow-hidden rounded-2xl border border-[#F8BFBF] bg-white shadow-sm ${className}`.trim()}>
      <div className="profile-header-card-surface bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.12),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(255,255,255,0.08),_transparent_35%),linear-gradient(135deg,_#D61E1E,_#B41818)] px-4 py-5 sm:px-4 sm:py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative">
              <div className="profile-header-card-avatar grid h-24 w-24 place-items-center overflow-hidden rounded-2xl border border-white/80 bg-white text-lg font-black text-[#D61E1E] shadow-lg">
                {profileImageUrl ? (
                  <img src={profileImageUrl} alt={fullName || "Profile avatar"} className="h-full w-full object-cover" />
                ) : (
                  <span>{resolveInitials(fullName || profile.email || "HR")}</span>
                )}
              </div>
              <button
                type="button"
                onClick={onChangePhoto}
                className="profile-header-card-camera absolute -bottom-1.5 -right-1.5 grid h-9 w-9 place-items-center rounded-xl border border-white bg-white text-[#D61E1E] shadow-lg transition hover:bg-red-50"
                aria-label="Change profile picture"
              >
                <Camera size={15} />
              </button>
            </div>

            <div className="space-y-2.5">
              <div>
                <p className="profile-header-card-label m-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">Employee Profile</p>
                <h2 className="profile-header-card-title m-0 mt-1.5 text-xl font-semibold tracking-tight text-white sm:text-lg">{fullName}</h2>
                <p className="profile-header-card-description m-0 mt-1.5 max-w-2xl text-sm leading-6 text-white/80">
                  Keep your personnel information, compliance details, and signature assets current from one profile workspace.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Employee ID", value: profile.employeeId || "Not linked" },
                  { label: "Position", value: profile.position || "Not set" },
                  { label: "Division", value: profile.department || "Not assigned" },
                  { label: "Employment Status", value: profile.employmentStatus || profile.status || "Unknown" },
                ].map((item) => (
                  <div key={item.label} className="profile-header-card-stat rounded-xl border border-white/40 bg-white/95 px-2.5 py-1.5 shadow-sm">
                    <p className="profile-header-card-stat-label m-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7f1d1d]">{item.label}</p>
                    <p className="profile-header-card-stat-value m-0 mt-0.5 text-xs font-semibold text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="profile-header-card-actions flex flex-wrap items-center gap-3">
            {onOpenServiceRecord ? (
              <Button variant="secondary" icon={ScrollText} onClick={onOpenServiceRecord}>
                Service Record
              </Button>
            ) : null}
            <Button variant="secondary" icon={PencilLine} onClick={onToggleMode}>
              {readOnly ? "Switch to Edit" : "Switch to Read Only"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
