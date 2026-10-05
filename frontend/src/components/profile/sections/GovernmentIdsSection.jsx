import React from "react";
import { IdCard } from "lucide-react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { isRegularEmploymentStatus, profileSectionAnchorId } from "../profileUtils";
import { getGovernmentIdMaxLength } from "../../../utils/governmentId";

export default function GovernmentIdsSection({
  values,
  errors,
  readOnly,
  saving,
  onChange,
  onSave,
}) {
  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("government")}
      icon={IdCard}
      title="Government IDs"
      description="Maintain government identification numbers used for payroll, statutory filings, and agency compliance."
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {isRegularEmploymentStatus(values.employmentStatus) ? (
          <ProfileField label="GSIS Number" name="gsisIdNo" value={values.gsisIdNo} onChange={onChange} error={errors.gsisIdNo} readOnly={readOnly} placeholder="e.g. 12345678901" inputMode="numeric" maxLength={getGovernmentIdMaxLength("gsisIdNo")} pattern="[0-9-]*" />
        ) : null}
        <ProfileField label="PhilHealth Number" name="philhealthIdNo" value={values.philhealthIdNo} onChange={onChange} error={errors.philhealthIdNo} readOnly={readOnly} placeholder="e.g. 12-345678901-2" inputMode="numeric" maxLength={getGovernmentIdMaxLength("philhealthIdNo")} pattern="[0-9-]*" />
        <ProfileField label="Pag-IBIG Number" name="pagibigIdNo" value={values.pagibigIdNo} onChange={onChange} error={errors.pagibigIdNo} readOnly={readOnly} placeholder="e.g. 1234-5678-9012" inputMode="numeric" maxLength={getGovernmentIdMaxLength("pagibigIdNo")} pattern="[0-9-]*" />
        <ProfileField label="TIN Number" name="tinNo" value={values.tinNo} onChange={onChange} error={errors.tinNo} readOnly={readOnly} placeholder="e.g. 123-456-789-000" inputMode="numeric" maxLength={getGovernmentIdMaxLength("tinNo")} pattern="[0-9-]*" />
      </div>
    </ProfileSectionCard>
  );
}
