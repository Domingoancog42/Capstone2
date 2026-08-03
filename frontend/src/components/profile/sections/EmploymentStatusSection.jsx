import React from "react";
import { Briefcase } from "lucide-react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { employmentStatusOptions, employmentTypeOptions, profileSectionAnchorId } from "../profileUtils";

export default function EmploymentStatusSection({
  values,
  errors,
  readOnly,
  canEditEmploymentSection = true,
  saving,
  onChange,
  onSave,
  divisionOptions,
  designationOptions,
}) {
  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("employment")}
      icon={Briefcase}
      badge={canEditEmploymentSection ? "" : "HR & Admin only"}
      title="Employment Status"
      description={canEditEmploymentSection
        ? "Review your employment assignment, reporting line, and the official organization placement used in HR actions."
        : "Employment assignment, reporting line, and official organization placement can only be updated by HR or Admin."}
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ProfileField
          label="Employment Type"
          name="employmentType"
          as="select"
          value={values.employmentType}
          onChange={onChange}
          required
          error={errors.employmentType}
          readOnly={readOnly}
          options={[{ label: "Select employment type", value: "" }, ...employmentTypeOptions.map((option) => ({ label: option, value: option }))]}
        />
        <ProfileField
          label="Employment Status"
          name="employmentStatus"
          as="select"
          value={values.employmentStatus}
          onChange={onChange}
          required
          error={errors.employmentStatus}
          readOnly={readOnly}
          options={[{ label: "Select employment status", value: "" }, ...employmentStatusOptions.map((option) => ({ label: option, value: option }))]}
        />
        <ProfileField label="Date Hired" name="dateHired" type="date" value={values.dateHired} onChange={onChange} required error={errors.dateHired} readOnly={readOnly} />
        <ProfileField
          label="Division"
          name="divisionId"
          as="select"
          value={values.divisionId}
          onChange={onChange}
          required
          error={errors.divisionId}
          readOnly={readOnly}
          options={[{ label: "Select division", value: "" }, ...divisionOptions.map((item) => ({ label: item.name, value: String(item.id) }))]}
        />
        <ProfileField
          label="Designation"
          name="designationId"
          as="select"
          value={values.designationId}
          onChange={onChange}
          required
          error={errors.designationId}
          readOnly={readOnly}
          options={[{ label: "Select designation", value: "" }, ...designationOptions.map((item) => ({ label: item.name, value: String(item.id) }))]}
        />
        <div className="md:col-span-2 xl:col-span-3">
          <ProfileField label="Supervisor" name="supervisor" value={values.supervisor} onChange={onChange} error={errors.supervisor} readOnly={readOnly} />
        </div>
      </div>
    </ProfileSectionCard>
  );
}
