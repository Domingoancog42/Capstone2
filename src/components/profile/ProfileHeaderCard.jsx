import React from "react";
import { Camera, Download, PencilLine, ScrollText } from "lucide-react";
import Button from "../UI/button";
import { resolveInitials } from "./profileUtils";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

export default function ProfileHeaderCard({
  profile,
  readOnly,
  onToggleMode,
  onChangePhoto,
  onDownloadPds,
  downloadingPds = false,
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

  const summaryItems = [
    { label: "Employee ID", value: profile.employeeId || "Not linked" },
    { label: "Division", value: profile.department || "Not assigned" },
    { label: "Designation", value: profile.position || "Not set" },
    { label: "Employment", value: profile.employmentStatus || profile.status || "Unknown" },
  ];

  return (
    <aside className={`profile-header-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`.trim()}>
      <div className="profile-header-card-surface border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-4 pb-4 pt-5">
        <div className="grid place-items-center gap-3">
          <div className="relative">
            <div className="profile-header-card-avatar grid h-32 w-32 place-items-center overflow-hidden rounded-full border border-slate-200 bg-white text-2xl font-bold text-slate-400 shadow-sm ring-4 ring-white">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt={fullName || "Profile avatar"} className="h-full w-full object-cover" />
              ) : (
                <span>{resolveInitials(fullName || profile.email || "HR")}</span>
              )}
            </div>
            {!readOnly ? (
              <button
                type="button"
                onClick={onChangePhoto}
                className="profile-header-card-camera absolute bottom-0.5 right-0.5 grid h-9 w-9 place-items-center rounded-full border border-[#F8BFBF] bg-white text-[#D61E1E] shadow-sm transition hover:border-[#F18E8E] hover:bg-[#FEF1F1] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
                aria-label="Change profile picture"
              >
                <Camera size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="min-w-0 max-w-full text-center">
            <p className="profile-header-card-label m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-[#D61E1E]">
              Employee Profile
            </p>
            <h2 className="profile-header-card-title m-0 mt-1 truncate text-sm font-semibold text-slate-900" title={fullName}>
              {fullName}
            </h2>
            <p className="profile-header-card-description m-0 mt-0.5 truncate text-xs text-slate-500">
              {profile.employeeId || "Employee ID pending"}
            </p>
            <span className={`profile-header-card-mode mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
              readOnly ? "bg-slate-100 text-slate-500" : "bg-[#FEF1F1] text-[#D61E1E]"
            }`}>
              {readOnly ? "Viewing record" : "Editing record"}
            </span>
          </div>
        </div>
      </div>

      <div className="profile-header-card-actions grid gap-2 px-4 py-3.5">
        <Button
          variant={readOnly ? "primary" : "secondary"}
          icon={PencilLine}
          fullWidth
          onClick={onToggleMode}
        >
          {readOnly ? "Edit Profile" : "Finish Editing"}
        </Button>
        {!readOnly ? (
          <Button variant="secondary" icon={Camera} fullWidth onClick={onChangePhoto}>
            Change Photo
          </Button>
        ) : null}
        {onDownloadPds ? (
          <Button
            variant="secondary"
            icon={Download}
            loading={downloadingPds}
            fullWidth
            onClick={onDownloadPds}
          >
            Download PDS
          </Button>
        ) : null}
        {onOpenServiceRecord ? (
          <Button variant="ghost" icon={ScrollText} fullWidth onClick={onOpenServiceRecord}>
            Service Record
          </Button>
        ) : null}
      </div>

      <dl className="profile-header-card-summary m-0 grid gap-2.5 border-t border-slate-100 px-4 py-3.5">
        {summaryItems.map((item) => (
          <div key={item.label} className="profile-header-card-stat flex items-start justify-between gap-3">
            <dt className="profile-header-card-stat-label m-0 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {item.label}
            </dt>
            <dd className="profile-header-card-stat-value m-0 min-w-0 break-words text-right text-xs font-semibold text-slate-700">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="profile-header-card-note m-0 border-t border-slate-100 px-4 py-3 text-[11px] leading-4 text-slate-500">
        {readOnly
          ? "Select Edit Profile to update the sections you are allowed to manage."
          : "Fields marked with an asterisk are required before saving."}
      </p>
    </aside>
  );
}
