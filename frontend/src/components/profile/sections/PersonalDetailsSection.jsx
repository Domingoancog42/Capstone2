import React from "react";
import { PencilLine, UserRound } from "lucide-react";
import Button from "../../UI/button";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { civilStatusOptions, genderOptions, nationalityOptions, profileSectionAnchorId, suffixOptions } from "../profileUtils";

function describeRequest(request) {
  switch (request?.status) {
    case "pending":
      return { tone: "pending", text: "Waiting for Admin or HR Head approval." };
    case "approved":
      return { tone: "approved", text: "Request approved. You can edit and save Personal Details once." };
    case "declined":
      return { tone: "declined", text: "Your previous edit request was declined. You may submit another request." };
    default:
      return null;
  }
}

const noticeClasses = {
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-900",
  declined: "border-slate-200 bg-slate-50 text-slate-700",
};

/**
 * Personal Details.
 *
 * The shared profile view/edit toggle controls these fields. Saving still goes through the employee
 * API, which restricts non-managers to their own linked employee record and protects HR-owned data.
 */
export default function PersonalDetailsSection({
  values,
  errors,
  readOnly,
  saving,
  onChange,
  onSave,
  canRequestEdit = false,
  editRequest = null,
  requestingEdit = false,
  onRequestEdit,
}) {
  const currentNationality = String(values.nationality || "");
  const nationalityChoices = [
    { label: "Select nationality", value: "" },
    ...(
      currentNationality && !nationalityOptions.includes(currentNationality)
        ? [{ label: currentNationality, value: currentNationality }]
        : []
    ),
    ...nationalityOptions.map((option) => ({ label: option, value: option })),
  ];
  const pending = editRequest?.status === "pending";
  const approved = editRequest?.status === "approved";
  const notice = canRequestEdit ? describeRequest(editRequest) : null;

  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("personal")}
      icon={UserRound}
      title="Personal Details"
      description={canRequestEdit
        ? "Personal information stays locked until Admin or HR Head approves an edit request."
        : "Review and update your legal identity and contact information."}
      readOnly={readOnly}
      saving={saving}
      onSave={readOnly ? undefined : onSave}
      actions={canRequestEdit && !approved && onRequestEdit ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={PencilLine}
          onClick={onRequestEdit}
          loading={requestingEdit}
          disabled={pending}
        >
          {pending ? "Request Sent" : editRequest?.status === "declined" ? "Request Again" : "Request Edit"}
        </Button>
      ) : null}
    >
      {notice ? (
        <p className={`m-0 rounded-lg border px-3 py-2 text-xs font-medium ${noticeClasses[notice.tone]}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ProfileField label="First Name" name="firstName" value={values.firstName} onChange={onChange} required error={errors.firstName} readOnly={readOnly} />
          <ProfileField label="Middle Name" name="middleName" value={values.middleName} onChange={onChange} error={errors.middleName} readOnly={readOnly} />
          <ProfileField label="Last Name" name="lastName" value={values.lastName} onChange={onChange} required error={errors.lastName} readOnly={readOnly} />
          <ProfileField
            label="Suffix"
            name="suffix"
            as="select"
            value={values.suffix}
            onChange={onChange}
            error={errors.suffix}
            readOnly={readOnly}
            options={[{ label: "None", value: "" }, ...suffixOptions.map((option) => ({ label: option, value: option }))]}
          />
          <ProfileField label="Birth Date" name="dateOfBirth" type="date" value={values.dateOfBirth} onChange={onChange} required error={errors.dateOfBirth} readOnly={readOnly} />
          <ProfileField
            label="Gender"
            name="gender"
            as="select"
            value={values.gender}
            onChange={onChange}
            required
            error={errors.gender}
            readOnly={readOnly}
            options={[{ label: "Select gender", value: "" }, ...genderOptions.map((option) => ({ label: option, value: option }))]}
          />
          <ProfileField
            label="Civil Status"
            name="civilStatus"
            as="select"
            value={values.civilStatus}
            onChange={onChange}
            required
            error={errors.civilStatus}
            readOnly={readOnly}
            options={[{ label: "Select civil status", value: "" }, ...civilStatusOptions.map((option) => ({ label: option, value: option }))]}
          />
          <ProfileField
            label="Nationality"
            name="nationality"
            as="select"
            value={values.nationality}
            onChange={onChange}
            required
            error={errors.nationality}
            readOnly={readOnly}
            options={nationalityChoices}
          />
          <ProfileField label="Contact Number" name="phone" value={values.phone} onChange={onChange} required error={errors.phone} readOnly={readOnly} />
      </div>
    </ProfileSectionCard>
  );
}
