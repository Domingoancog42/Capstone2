import React from "react";
import { UserRound } from "lucide-react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { civilStatusOptions, genderOptions, profileSectionAnchorId } from "../profileUtils";

export default function PersonalDetailsSection({
  values,
  errors,
  readOnly,
  saving,
  onChange,
  onSave,
}) {
  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("personal")}
      icon={UserRound}
      title="Personal Details"
      description="Keep your legal identity, contact channels, and civil information accurate for HR workflows."
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ProfileField label="First Name" name="firstName" value={values.firstName} onChange={onChange} required error={errors.firstName} readOnly={readOnly} />
        <ProfileField label="Middle Name" name="middleName" value={values.middleName} onChange={onChange} error={errors.middleName} readOnly={readOnly} />
        <ProfileField label="Last Name" name="lastName" value={values.lastName} onChange={onChange} required error={errors.lastName} readOnly={readOnly} />
        <ProfileField label="Suffix" name="suffix" value={values.suffix} onChange={onChange} error={errors.suffix} readOnly={readOnly} />
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
        <ProfileField label="Nationality" name="nationality" value={values.nationality} onChange={onChange} required error={errors.nationality} readOnly={readOnly} />
        <ProfileField label="Contact Number" name="phone" value={values.phone} onChange={onChange} required error={errors.phone} readOnly={readOnly} />
      </div>
    </ProfileSectionCard>
  );
}
