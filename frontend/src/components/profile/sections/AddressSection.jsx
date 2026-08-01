import React from "react";
import ProfileField from "../ProfileField";
import ProfileSectionCard from "../ProfileSectionCard";

export default function AddressSection({
  values,
  errors,
  readOnly,
  saving,
  onChange,
  onSave,
  regionOptions,
  provinceOptions,
  cityOptions,
  barangayOptions,
}) {
  return (
    <ProfileSectionCard
      title="Address"
      description="Capture your official present address for contact tracing, payroll, and emergency coordination."
      readOnly={readOnly}
      saving={saving}
      onSave={onSave}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ProfileField
          label="Region"
          name="regionCode"
          as="select"
          value={values.regionCode}
          onChange={onChange}
          required
          error={errors.regionCode}
          readOnly={readOnly}
          options={[{ label: "Select region", value: "" }, ...regionOptions.map((item) => ({ label: item.region_name, value: item.region_code }))]}
        />
        <ProfileField
          label="Province"
          name="provinceCode"
          as="select"
          value={values.provinceCode}
          onChange={onChange}
          required
          error={errors.provinceCode}
          readOnly={readOnly}
          options={[{ label: "Select province", value: "" }, ...provinceOptions.map((item) => ({ label: item.province_name, value: item.province_code }))]}
        />
        <ProfileField
          label="City/Municipality"
          name="cityCode"
          as="select"
          value={values.cityCode}
          onChange={onChange}
          required
          error={errors.cityCode}
          readOnly={readOnly}
          options={[{ label: "Select city/municipality", value: "" }, ...cityOptions.map((item) => ({ label: item.city_name, value: item.city_code }))]}
        />
        <ProfileField
          label="Barangay"
          name="barangayCode"
          as="select"
          value={values.barangayCode}
          onChange={onChange}
          required
          error={errors.barangayCode}
          readOnly={readOnly}
          options={[{ label: "Select barangay", value: "" }, ...barangayOptions.map((item) => ({ label: item.brgy_name, value: item.brgy_code }))]}
        />
        <div className="md:col-span-2">
          <ProfileField label="Street Address" name="address" value={values.address} onChange={onChange} required error={errors.address} readOnly={readOnly} />
        </div>
        <ProfileField label="ZIP Code" name="zipCode" value={values.zipCode} onChange={onChange} required error={errors.zipCode} readOnly={readOnly} />
      </div>
    </ProfileSectionCard>
  );
}
