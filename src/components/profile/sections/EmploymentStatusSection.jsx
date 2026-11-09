import React from "react";
import { Briefcase } from "lucide-react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { employmentStatusOptions, profileSectionAnchorId } from "../profileUtils";

export default function EmploymentStatusSection({
  values,
  divisionOptions,
  designationOptions,
}) {
  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("employment")}
      icon={Briefcase}
      badge="View only"
      title="Employment Status"
      description="Review your official employment assignment and reporting line. Changes are managed from Employee Management."
      readOnly
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ProfileField
          label="Employment Status"
          name="employmentStatus"
          as="select"
          value={values.employmentStatus}
          readOnly
          options={[{ label: "Select employment status", value: "" }, ...employmentStatusOptions.map((option) => ({ label: option, value: option }))]}
        />
        <ProfileField label="Date Hired" name="dateHired" type="date" value={values.dateHired} readOnly />
        <ProfileField
          label="Division"
          name="divisionId"
          as="select"
          value={values.divisionId}
          readOnly
          options={[{ label: "Select division", value: "" }, ...divisionOptions.map((item) => ({ label: item.name, value: String(item.id) }))]}
        />
        <ProfileField
          label="Position"
          name="designationId"
          as="select"
          value={values.designationId}
          readOnly
          options={[{ label: "Select position", value: "" }, ...designationOptions.map((item) => ({ label: item.name, value: String(item.id) }))]}
        />
        <ProfileField label="Designation" name="designation" value={values.designation || "None"} readOnly />
        <div className="md:col-span-2 xl:col-span-3">
          <ProfileField label="Supervisor" name="supervisor" value={values.supervisor} readOnly />
        </div>
      </div>
    </ProfileSectionCard>
  );
}
