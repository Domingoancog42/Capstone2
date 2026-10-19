import React from "react";
import { BadgeCheck, BookOpenCheck, Plus, Trash2 } from "lucide-react";
import Button from "../../UI/button";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId } from "../profileUtils";
import { pdsRecordLimits } from "../../../services/pdsProfileService";

const sections = {
  eligibility: {
    title: "Civil Service Eligibility", icon: BadgeCheck, entryLabel: "Eligibility", addLabel: "Add Eligibility",
    description: "Record your civil service examinations, professional qualifications, and licenses for your Personal Data Sheet.",
    fields: [
      { key: "eligibilityName", label: "Career Service / RA 1080 (Board / Bar) / Special Laws / CES / CSEE / Barangay Eligibility / Driver’s License", maxLength: 255, wide: true, required: true, placeholder: "e.g. Career Service Professional (Second Level)" },
      { key: "rating", label: "Rating (if applicable)", maxLength: 40, placeholder: "e.g. 85.50%" },
      { key: "examinationDate", label: "Date of Examination / Conferment", type: "date", helper: "e.g. June 2, 2024" },
      { key: "examinationPlace", label: "Place of Examination / Conferment", maxLength: 255, wide: true, placeholder: "e.g. Cagayan de Oro City" },
      { key: "licenseNumber", label: "License Number (if applicable)", maxLength: 100, placeholder: "e.g. 0012345" },
      { key: "validityDate", label: "License Date of Validity (if applicable)", type: "date", helper: "e.g. June 2, 2027" },
    ],
  },
  training: {
    title: "Learning and Development (L&D) Interventions/Training Programs Attended", icon: BookOpenCheck,
    entryLabel: "Training", addLabel: "Add Training",
    description: "Enter your training programs, starting with the most recent. Save Changes to include them in your Personal Data Sheet.",
    fields: [
      { key: "title", label: "Title of L&D Intervention / Training Program (Write in full)", maxLength: 255, wide: true, required: true, placeholder: "e.g. Records Management and Data Privacy Seminar" },
      { key: "dateFrom", label: "From", type: "date", helper: "e.g. June 3, 2024" },
      { key: "dateTo", label: "To", type: "date", helper: "e.g. June 5, 2024" },
      { key: "hours", label: "Number of Hours", type: "number", min: 0, max: 999999.99, step: "0.01", placeholder: "e.g. 24" },
      { key: "type", label: "Type of L&D", maxLength: 100, placeholder: "e.g. Managerial, Supervisory, Technical" },
      { key: "conductedBy", label: "Conducted / Sponsored By (Write in full)", maxLength: 255, wide: true, placeholder: "e.g. Civil Service Commission" },
    ],
  },
};

export default function PdsRecordsSection({ section, values, errors = {}, readOnly, saving, onChange, onAdd, onRemove }) {
  const config = sections[section];
  const disabled = readOnly || saving;
  return (
    <ProfileSectionCard
      id={profileSectionAnchorId(section)} icon={config.icon} title={config.title} description={config.description}
      actions={!readOnly ? (
        <Button variant="primary" disabled={saving || values.length >= pdsRecordLimits[section]} onClick={onAdd}>
          <Plus size={16} aria-hidden="true" /> {config.addLabel}
        </Button>
      ) : null}
    >
      {errors[section] ? <p role="alert" className="m-0 text-sm text-[#B41818]">{errors[section]}</p> : null}
      {values.length === 0 ? (
        <p className="m-0 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
          No {section === "eligibility" ? "civil service eligibility" : "training programs"} recorded yet.
          {readOnly ? ` Choose Edit Profile, then ${config.addLabel}.` : ` Use ${config.addLabel} to enter your first record.`}
        </p>
      ) : null}
      {values.map((record, index) => (
        <div key={record.id || index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h4 className="m-0 text-sm font-bold text-slate-800">{config.entryLabel} {index + 1}</h4>
            {!readOnly ? (
              <button type="button" disabled={saving} onClick={() => onRemove(index)} aria-label={`Remove ${config.entryLabel.toLowerCase()} ${index + 1}`}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#B41818] hover:bg-red-50 disabled:opacity-50">
                <Trash2 size={15} aria-hidden="true" /> Remove
              </button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {config.fields.map(({ key, wide, ...field }) => (
              <div key={key} className={wide ? "md:col-span-2" : ""}>
                <ProfileField {...field} name={`${section}-${index}-${key}`} value={record[key] ?? ""}
                  error={errors[`${section}-${index}-${key}`]} readOnly={disabled}
                  onChange={(event) => onChange(index, key, event.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}
      {values.length >= pdsRecordLimits[section] ? (
        <p className="m-0 text-xs text-slate-500">Maximum of {pdsRecordLimits[section]} entries reached.</p>
      ) : null}
    </ProfileSectionCard>
  );
}
