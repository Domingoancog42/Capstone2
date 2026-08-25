import React from "react";
import { Plus, Trash2, UsersRound } from "lucide-react";
import Button from "../../UI/button";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId, suffixOptions } from "../profileUtils";

const suffixChoices = [
  { label: "None", value: "" },
  ...suffixOptions.map((option) => ({ label: option, value: option })),
];

function SubsectionTitle({ children }) {
  return (
    <h4 className="m-0 text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
      {children}
    </h4>
  );
}

export default function FamilyBackgroundSection({
  values,
  readOnly,
  saving,
  onChange,
  onChildChange,
  onAddChild,
  onRemoveChild,
  onSave,
}) {
  const children = Array.isArray(values.children) ? values.children : [];

  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("family")}
      icon={UsersRound}
      title="Family Background"
      description="Complete the spouse, parents, and children entries used in Section II of CS Form No. 212."
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
        <SubsectionTitle>Spouse</SubsectionTitle>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ProfileField label="Surname" name="spouseLastName" value={values.spouseLastName} onChange={onChange} readOnly={readOnly} />
          <ProfileField label="First Name" name="spouseFirstName" value={values.spouseFirstName} onChange={onChange} readOnly={readOnly} />
          <ProfileField label="Middle Name" name="spouseMiddleName" value={values.spouseMiddleName} onChange={onChange} readOnly={readOnly} />
          <ProfileField label="Name Extension" name="spouseSuffix" as="select" value={values.spouseSuffix} onChange={onChange} readOnly={readOnly} options={suffixChoices} />
          <ProfileField label="Occupation" name="spouseOccupation" value={values.spouseOccupation} onChange={onChange} readOnly={readOnly} />
          <ProfileField label="Employer / Business Name" name="spouseEmployer" value={values.spouseEmployer} onChange={onChange} readOnly={readOnly} />
          <div className="md:col-span-2 xl:col-span-1">
            <ProfileField label="Business Address" name="spouseBusinessAddress" value={values.spouseBusinessAddress} onChange={onChange} readOnly={readOnly} />
          </div>
          <ProfileField label="Telephone No." name="spouseTelephone" value={values.spouseTelephone} onChange={onChange} readOnly={readOnly} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
          <SubsectionTitle>Father</SubsectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <ProfileField label="Surname" name="fatherLastName" value={values.fatherLastName} onChange={onChange} readOnly={readOnly} />
            <ProfileField label="First Name" name="fatherFirstName" value={values.fatherFirstName} onChange={onChange} readOnly={readOnly} />
            <ProfileField label="Middle Name" name="fatherMiddleName" value={values.fatherMiddleName} onChange={onChange} readOnly={readOnly} />
            <ProfileField label="Name Extension" name="fatherSuffix" as="select" value={values.fatherSuffix} onChange={onChange} readOnly={readOnly} options={suffixChoices} />
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
          <SubsectionTitle>Mother&apos;s Maiden Name</SubsectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <ProfileField label="Maiden Surname" name="motherMaidenLastName" value={values.motherMaidenLastName} onChange={onChange} readOnly={readOnly} />
            <ProfileField label="First Name" name="motherFirstName" value={values.motherFirstName} onChange={onChange} readOnly={readOnly} />
            <ProfileField label="Middle Name" name="motherMiddleName" value={values.motherMiddleName} onChange={onChange} readOnly={readOnly} />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SubsectionTitle>Children</SubsectionTitle>
            <p className="m-0 mt-1 text-xs text-slate-500">List full names in birth order, up to the 12 rows available on the PDS.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            disabled={readOnly || children.length >= 12}
            onClick={onAddChild}
          >
            Add Child
          </Button>
        </div>

        {children.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-7 text-center text-sm text-slate-500">
            No children listed.
          </div>
        ) : (
          <div className="space-y-3">
            {children.map((child, index) => (
              <div key={child.id || `child-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1fr_220px_auto] md:items-end">
                <ProfileField
                  label={`Child ${index + 1} — Full Name`}
                  name={`child-${index}-fullName`}
                  value={child.fullName}
                  onChange={(event) => onChildChange(index, "fullName", event.target.value)}
                  readOnly={readOnly}
                />
                <ProfileField
                  label="Date of Birth"
                  name={`child-${index}-dateOfBirth`}
                  type="date"
                  value={child.dateOfBirth}
                  onChange={(event) => onChildChange(index, "dateOfBirth", event.target.value)}
                  readOnly={readOnly}
                />
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash2}
                  disabled={readOnly}
                  className="mb-0.5 md:min-h-[44px]"
                  onClick={() => onRemoveChild(index)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProfileSectionCard>
  );
}
