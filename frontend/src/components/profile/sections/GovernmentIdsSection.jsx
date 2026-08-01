import React from "react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";

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
      title="Government IDs"
      description="Maintain government identification numbers used for payroll, statutory filings, and agency compliance."
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <ProfileField label="GSIS Number" name="gsisIdNo" value={values.gsisIdNo} onChange={onChange} error={errors.gsisIdNo} readOnly={readOnly} />
        <ProfileField label="PhilHealth Number" name="philhealthIdNo" value={values.philhealthIdNo} onChange={onChange} error={errors.philhealthIdNo} readOnly={readOnly} />
        <ProfileField label="Pag-IBIG Number" name="pagibigIdNo" value={values.pagibigIdNo} onChange={onChange} error={errors.pagibigIdNo} readOnly={readOnly} />
        <ProfileField label="TIN Number" name="tinNo" value={values.tinNo} onChange={onChange} error={errors.tinNo} readOnly={readOnly} />
      </div>
    </ProfileSectionCard>
  );
}
