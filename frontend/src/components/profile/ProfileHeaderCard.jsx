import React from "react";
import { Camera, PencilLine } from "lucide-react";
import Button from "../UI/button";
import { resolveInitials } from "./profileUtils";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

export default function ProfileHeaderCard({
  profile,
  readOnly,
  onToggleMode,
  onChangePhoto,
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
    <section className={`profile-header-card overflow-hidden rounded-[32px] border border-[#F8BFBF] bg-white shadow-sm ${className}`.trim()}>
      <div className="profile-header-card-surface bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.12),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(255,255,255,0.08),_transparent_35%),linear-gradient(135deg,_#D61E1E,_#B41818)] px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative">
              <div className="profile-header-card-avatar grid h-32 w-32 place-items-center overflow-hidden rounded-[28px] border border-white/80 bg-white text-3xl font-black text-[#D61E1E] shadow-lg">
                {profileImageUrl ? (
                  <img src={profileImageUrl} alt={fullName || "Profile avatar"} className="h-full w-full object-cover" />
                ) : (
                  <span>{resolveInitials(fullName || profile.email || "HR")}</span>
                )}
              </div>
              <button
                type="button"
                onClick={onChangePhoto}
                className="profile-header-card-camera absolute -bottom-2 -right-2 grid h-11 w-11 place-items-center rounded-2xl border border-white bg-white text-[#D61E1E] shadow-lg transition hover:bg-red-50"
                aria-label="Change profile picture"
              >
                <Camera size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="profile-header-card-label m-0 text-xs font-semibold uppercase tracking-[0.22em] text-white">Employee Profile</p>
                <h2 className="profile-header-card-title m-0 mt-2 text-3xl font-semibold tracking-tight text-white">{fullName}</h2>
                <p className="profile-header-card-description m-0 mt-2 max-w-2xl text-sm leading-6 text-white/80">
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
                  <div key={item.label} className="profile-header-card-stat rounded-2xl border border-white/40 bg-white/95 px-3 py-2 shadow-sm">
                    <p className="profile-header-card-stat-label m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7f1d1d]">{item.label}</p>
                    <p className="profile-header-card-stat-value m-0 mt-1 text-sm font-semibold text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={PencilLine} onClick={onToggleMode}>
              {readOnly ? "Switch to Edit" : "Switch to Read Only"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
