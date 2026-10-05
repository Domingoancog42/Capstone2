import React from "react";
import { Camera, Download, History, PencilLine, Save, X } from "lucide-react";
import Button from "../UI/button";
import { resolveInitials } from "./profileUtils";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { formatSalaryGrade, formatStepIncrement } from "./SalaryGradeHistory";

export default function ProfileHeaderCard({
  profile,
  readOnly,
  onToggleMode,
  /* Edit Profile opens every tab for editing; while editing, the same button saves them all. */
  onEdit = onToggleMode,
  onSave,
  onCancel,
  saving = false,
  onChangePhoto,
  onDownloadPds,
  downloadingPds = false,
  onOpenSalaryGradeHistory,
  salaryGradeRecord = null,
  salaryGradeLoading = false,
  salaryGradeError = "",
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
    { label: "Position", value: profile.position || "Not set" },
    ...(profile.designation ? [{ label: "Designation", value: profile.designation }] : []),
    { label: "Employment", value: profile.employmentStatus || profile.status || "Unknown" },
  ];

  return (
    <aside className={`profile-header-card min-w-0 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`.trim()}>
      <div className="profile-header-card-surface border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-3 py-3 sm:px-4 sm:py-4 lg:pb-4 lg:pt-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 lg:grid-cols-1 lg:place-items-center">
          <div className="relative">
            <div className="profile-header-card-avatar grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-slate-200 bg-white text-xl font-bold text-slate-400 shadow-sm ring-4 ring-white sm:h-24 sm:w-24 lg:h-32 lg:w-32 lg:text-2xl">
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

          <div className="min-w-0 max-w-full text-left lg:text-center">
            <p className="profile-header-card-label m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-[#D61E1E]">
              Employee Profile
            </p>
            <h2 className="profile-header-card-title m-0 mt-1 break-words text-sm font-semibold text-slate-900" title={fullName}>
              {fullName}
            </h2>
            <p className="profile-header-card-description m-0 mt-0.5 break-words text-xs text-slate-500">
              {profile.employeeId || "Employee ID pending"}
            </p>
            <div
              className="mt-2 flex flex-wrap items-center gap-1.5 lg:justify-center"
              aria-label="Current salary grade and step increment"
            >
              {salaryGradeLoading ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">
                  Loading grade...
                </span>
              ) : salaryGradeError ? (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">
                  Grade unavailable
                </span>
              ) : (
                <>
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">
                    {formatSalaryGrade(salaryGradeRecord?.salaryGrade, "SG not recorded")}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">
                    {formatStepIncrement(salaryGradeRecord?.stepIncrement, "Step not recorded")}
                  </span>
                </>
              )}
            </div>
            {onOpenSalaryGradeHistory ? (
              <button
                type="button"
                onClick={onOpenSalaryGradeHistory}
                className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-bold text-[#D61E1E] transition hover:bg-[#FEF1F1] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
              >
                <History size={12} aria-hidden="true" />
                View grade history
              </button>
            ) : null}
            <span className={`profile-header-card-mode mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
              readOnly ? "bg-slate-100 text-slate-500" : "bg-[#FEF1F1] text-[#D61E1E]"
            }`}>
              {readOnly ? "Viewing record" : "Editing record"}
            </span>
          </div>
        </div>
      </div>

      <div className="profile-header-card-actions grid grid-cols-1 gap-2 px-3 py-3 min-[360px]:grid-cols-2 sm:px-4 lg:grid-cols-1 lg:py-3.5">
        {readOnly ? (
          <Button variant="primary" icon={PencilLine} fullWidth onClick={onEdit}>
            Edit Profile
          </Button>
        ) : (
          <>
            <Button variant="primary" icon={Save} fullWidth loading={saving} onClick={onSave}>
              Save Changes
            </Button>
            <Button variant="secondary" icon={X} fullWidth disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
          </>
        )}
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
      </div>

      <dl className="profile-header-card-summary m-0 grid grid-cols-1 gap-x-3 gap-y-3 border-t border-slate-100 px-3 py-3 min-[360px]:grid-cols-2 sm:px-4 lg:grid-cols-1 lg:gap-2.5 lg:py-3.5">
        {summaryItems.map((item) => (
          <div key={item.label} className="profile-header-card-stat flex min-w-0 flex-col items-start gap-1 lg:flex-row lg:justify-between lg:gap-3">
            <dt className="profile-header-card-stat-label m-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 lg:shrink-0 lg:text-[11px]">
              {item.label}
            </dt>
            <dd className="profile-header-card-stat-value m-0 min-w-0 break-words text-left text-xs font-semibold text-slate-700 lg:text-right">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="profile-header-card-note m-0 border-t border-slate-100 px-3 py-3 text-[11px] leading-4 text-slate-500 sm:px-4">
        {readOnly
          ? "Select Edit Profile to update the sections you are allowed to manage."
          : "Fields marked with an asterisk are required before saving."}
      </p>
    </aside>
  );
}
