import React from "react";
import { GraduationCap } from "lucide-react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId } from "../profileUtils";
import { pdsEducationLevels } from "../../../services/pdsProfileService";

export default function EducationalBackgroundSection({
  values,
  readOnly,
  saving,
  onChange,
  onSave,
}) {
  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("education")}
      icon={GraduationCap}
      title="Educational Background"
      description="Enter every education level using the same columns printed in Section III of CS Form No. 212."
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="space-y-4">
        {pdsEducationLevels.map((level, index) => {
          const record = values.find((item) => item.level === level.value) || { level: level.value };

          return (
            <div key={level.value} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#D61E1E] text-xs font-bold text-white">
                  {index + 1}
                </span>
                <h4 className="m-0 text-base font-bold text-slate-800">{level.label}</h4>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="md:col-span-2">
                  <ProfileField
                    label="Name of School (Write in full)"
                    name={`${level.value}-schoolName`}
                    value={record.schoolName || ""}
                    placeholder="e.g. University of the Philippines Cebu"
                    onChange={(event) => onChange(level.value, "schoolName", event.target.value)}
                    readOnly={readOnly}
                  />
                </div>
                <div className="md:col-span-2">
                  <ProfileField
                    label="Basic Education / Degree / Course"
                    name={`${level.value}-degreeCourse`}
                    value={record.degreeCourse || ""}
                    placeholder="e.g. Bachelor of Science in Information Technology"
                    onChange={(event) => onChange(level.value, "degreeCourse", event.target.value)}
                    readOnly={readOnly}
                  />
                </div>
                <ProfileField
                  label="Attendance From"
                  name={`${level.value}-attendanceFrom`}
                  value={record.attendanceFrom || ""}
                  placeholder="e.g. 2010"
                  onChange={(event) => onChange(level.value, "attendanceFrom", event.target.value)}
                  readOnly={readOnly}
                />
                <ProfileField
                  label="Attendance To"
                  name={`${level.value}-attendanceTo`}
                  value={record.attendanceTo || ""}
                  placeholder="e.g. 2014"
                  onChange={(event) => onChange(level.value, "attendanceTo", event.target.value)}
                  readOnly={readOnly}
                />
                <ProfileField
                  label="Highest Level / Units Earned"
                  name={`${level.value}-highestLevelUnits`}
                  value={record.highestLevelUnits || ""}
                  placeholder="e.g. 4th Year / 120 units"
                  onChange={(event) => onChange(level.value, "highestLevelUnits", event.target.value)}
                  readOnly={readOnly}
                />
                <ProfileField
                  label="Year Graduated"
                  name={`${level.value}-yearGraduated`}
                  value={record.yearGraduated || ""}
                  placeholder="e.g. 2014"
                  onChange={(event) => onChange(level.value, "yearGraduated", event.target.value)}
                  readOnly={readOnly}
                />
                <div className="md:col-span-2 xl:col-span-4">
                  <ProfileField
                    label="Scholarship / Academic Honors Received"
                    name={`${level.value}-honors`}
                    value={record.honors || ""}
                    placeholder="e.g. Cum Laude / DOST Scholar"
                    onChange={(event) => onChange(level.value, "honors", event.target.value)}
                    readOnly={readOnly}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ProfileSectionCard>
  );
}
