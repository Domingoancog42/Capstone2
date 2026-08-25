import React from "react";
import { LifeBuoy } from "lucide-react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId } from "../profileUtils";

export default function EmergencyContactSection({
  values,
  errors,
  readOnly,
  saving,
  onChange,
  onSave,
}) {
  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("emergency")}
      icon={LifeBuoy}
      title="Emergency Contact"
      description="Keep an updated emergency contact so HR and supervisors can coordinate quickly during urgent situations."
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <ProfileField label="Contact Person Name" name="emergencyContactName" value={values.emergencyContactName} onChange={onChange} required error={errors.emergencyContactName} readOnly={readOnly} />
        <ProfileField label="Relationship" name="emergencyRelationship" value={values.emergencyRelationship} onChange={onChange} required error={errors.emergencyRelationship} readOnly={readOnly} />
        <ProfileField label="Contact Number" name="emergencyPhone" value={values.emergencyPhone} onChange={onChange} required error={errors.emergencyPhone} readOnly={readOnly} />
        <div className="md:col-span-2">
          <ProfileField label="Address" name="emergencyAddress" as="textarea" rows={3} value={values.emergencyAddress} onChange={onChange} required error={errors.emergencyAddress} readOnly={readOnly} />
        </div>
      </div>
    </ProfileSectionCard>
  );
}
