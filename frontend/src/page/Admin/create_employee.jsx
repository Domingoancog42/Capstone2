import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import {
  Banknote,
  Briefcase,
  Camera,
  ChevronDown,
  HeartPulse,
  IdCard,
  Mail,
  MapPin,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

const defaultValues = {
  employeeId: "",
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  region: "",
  regionCode: "",
  province: "",
  provinceCode: "",
  city: "",
  cityCode: "",
  address: "",
  zipCode: "",
  gender: "",
  email: "",
  phone: "",
  roleId: "",
  divisionId: "",
  designationId: "",
  basicSalary: "",
  salaryRate: "",
  dateHired: "",
  employmentStatus: "",
  pwd: "0",
  civilStatus: "",
  height: "",
  weight: "",
  bloodType: "",
  gsisIdNo: "",
  pagibigIdNo: "",
  philhealthIdNo: "",
  tinNo: "",
  status: "Active",
};

const genderOptions = ["Male", "Female", "Prefer not to say"];
const salaryRates = ["Semi-monthly", "Monthly"];
const employmentStatuses = ["Regular", "Contractual"];
const civilStatuses = ["Single", "Married", "Widowed", "Separated"];
const bloodTypes = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const addressBasePath = `${process.env.PUBLIC_URL || ""}/philippines-addresses`;

function parseDateInput(value) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map((part) => Number(part));

  if (!year || !month || !day) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function shiftDateByYears(date, years) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() + years);
  return nextDate;
}

function getDateOfBirthBounds() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return {
    earliestDate: shiftDateByYears(today, -100),
    latestDate: shiftDateByYears(today, -18),
  };
}

function normalizePlaceText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function placeNameVariants(value) {
  const original = String(value || "").trim();

  if (!original) {
    return [];
  }

  const withoutParentheses = original.replace(/\([^)]*\)/g, " ");
  const normalized = normalizePlaceText(original);
  const normalizedWithoutParentheses = normalizePlaceText(withoutParentheses);
  const withoutCityOfPrefix = normalizedWithoutParentheses.replace(/^city of\s+/, "");
  const withoutCitySuffix = normalizedWithoutParentheses.replace(/\s+city$/, "");
  const cityOfPrefixWithoutSuffix = withoutCityOfPrefix.replace(/\s+city$/, "");

  return uniqueValues([
    normalized,
    normalizedWithoutParentheses,
    withoutCityOfPrefix,
    withoutCitySuffix,
    cityOfPrefixWithoutSuffix,
  ]);
}

function zipValueToText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.join(" ");
  }

  if (value && typeof value === "object") {
    return Object.values(value).join(" ");
  }

  return "";
}

function resolveZipCode(zipEntries, cityName, barangayName, provinceName, regionName) {
  const cityNeedles = placeNameVariants(cityName);
  const barangayNeedles = placeNameVariants(barangayName);
  const provinceNeedles = placeNameVariants(provinceName);
  const regionNeedles = placeNameVariants(regionName);
  const preferredNeedles = [...cityNeedles, ...barangayNeedles];
  const fallbackNeedles = [...provinceNeedles, ...regionNeedles];

  if (preferredNeedles.length === 0 && fallbackNeedles.length === 0) {
    return "";
  }

  const exactEntry = zipEntries.find(([, place]) => {
    const haystack = normalizePlaceText(zipValueToText(place));
    return preferredNeedles.some((needle) => needle === haystack);
  });

  if (exactEntry) {
    return exactEntry[0];
  }

  const cityEntry = zipEntries.find(([, place]) => {
    const haystack = normalizePlaceText(zipValueToText(place));
    return cityNeedles.some((needle) => haystack.includes(needle) || needle.includes(haystack));
  });

  if (cityEntry) {
    return cityEntry[0];
  }

  const barangayEntry = zipEntries.find(([, place]) => {
    const haystack = normalizePlaceText(zipValueToText(place));
    return barangayNeedles.some((needle) => haystack.includes(needle) || needle.includes(haystack));
  });

  if (barangayEntry) {
    return barangayEntry[0];
  }

  const fallbackEntry = zipEntries.find(([, place]) => {
    const haystack = normalizePlaceText(zipValueToText(place));
    return fallbackNeedles.some((needle) => haystack.includes(needle));
  });

  return fallbackEntry?.[0] || "";
}

// Lifts the trailing "*" out of a label string so required fields read as a red
// marker instead of plain text. Labels without one are passed through untouched.
function decorateLabel(label) {
  const text = String(label ?? "");

  if (!text.endsWith(" *")) {
    return label;
  }

  return (
    <>
      {text.slice(0, -2)}
      <span className="ml-0.5 font-bold text-[#D61E1E]" aria-hidden="true">*</span>
    </>
  );
}

// Focus treatment for the shared InputField, applied from the outside so the
// control matches SelectField without altering the component other pages use.
const FIELD_FOCUS_CLASS = "[&>div]:transition [&>div]:duration-150 [&>div:focus-within]:border-[#D61E1E] [&>div:focus-within]:ring-2 [&>div:focus-within]:ring-[#D61E1E]/10";

function TextField({ label, className = "", ...props }) {
  return (
    <InputField
      label={decorateLabel(label)}
      className={`${FIELD_FOCUS_CLASS} ${className}`.trim()}
      {...props}
    />
  );
}

function SelectField({ label, name, value, onChange, error, children, disabled = false, className = "" }) {
  return (
    <div className={`w-full ${className}`.trim()}>
      <label htmlFor={name} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {decorateLabel(label)}
      </label>
      <div className="relative">
        <select
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={`min-h-[40px] w-full appearance-none rounded-lg border bg-white px-3 py-2.5 pr-9 text-slate-900 outline-none transition duration-150 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
            error ? "border-rose-600" : "border-slate-200"
          }`}
          aria-invalid={Boolean(error)}
        >
          {children}
        </select>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>
      {error ? <p className="mt-1.5 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

function Section({ icon: Icon, title, description, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#F8BFBF] bg-[#FEF1F1] text-[#D61E1E]">
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold text-slate-900">{title}</h3>
          <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </header>
      <div className="grid gap-4 p-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="m-0 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="m-0 text-right text-xs font-semibold text-slate-700">{value || "Not set"}</dd>
    </div>
  );
}

function resolveDraftInitials(form) {
  return (
    [form.firstName, form.lastName]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 2)
      .map((value) => value.charAt(0).toUpperCase())
      .join("") || "E"
  );
}

function ProfileImageUpload({
  form,
  previewUrl,
  onUploadClick,
  onRemove,
  onFileChange,
  fileInputRef,
  isEditing = false,
  divisionName = "",
  designationName = "",
}) {
  const fullName = [form.firstName, form.middleName, form.lastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  return (
    <aside className="lg:sticky lg:top-0 lg:self-start">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-4 pb-4 pt-5">
          <div className="grid place-items-center gap-3">
            <div className="relative">
              <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-full border border-slate-200 bg-white text-2xl font-bold text-slate-400 shadow-sm ring-4 ring-white">
                {previewUrl ? (
                  <img src={previewUrl} alt="Employee profile preview" className="h-full w-full object-cover" />
                ) : (
                  <span>{resolveDraftInitials(form)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={onUploadClick}
                aria-label="Upload profile image"
                className="absolute bottom-0.5 right-0.5 grid h-9 w-9 place-items-center rounded-full border border-[#F8BFBF] bg-white text-[#D61E1E] shadow-sm transition hover:border-[#F18E8E] hover:bg-[#FEF1F1]"
              >
                <Camera size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="min-w-0 text-center">
              <p className="m-0 truncate text-sm font-semibold text-slate-900">
                {fullName || "New Employee"}
              </p>
              <p className="m-0 mt-0.5 truncate text-xs text-slate-500">
                {form.employeeId || "Employee ID pending"}
              </p>
              <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {isEditing ? "Editing record" : "New record"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-2 px-4 py-3.5">
          <Button type="button" variant="secondary" icon={Upload} fullWidth onClick={onUploadClick}>
            Upload Image
          </Button>
          <Button type="button" variant="ghost" icon={Trash2} fullWidth disabled={!previewUrl} onClick={onRemove}>
            Remove
          </Button>
          <p className="m-0 text-center text-[11px] leading-4 text-slate-400">
            JPG, PNG, GIF, WEBP, or BMP. Max 5 MB.
          </p>
        </div>

        <dl className="grid gap-2.5 border-t border-slate-100 px-4 py-3.5">
          <SummaryRow label="Division" value={divisionName} />
          <SummaryRow label="Designation" value={designationName} />
          <SummaryRow label="Employment" value={form.employmentStatus} />
        </dl>

        <p className="m-0 border-t border-slate-100 px-4 py-3 text-[11px] leading-4 text-slate-500">
          <span className="font-bold text-[#D61E1E]">*</span> Required fields
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />
    </aside>
  );
}

export default function CreateEmployee({
  initialValues,
  options,
  nextEmployeeId = "",
  onSubmit,
  onCancel,
  submitLabel = "Save Employee",
  formId = "employee-form",
  showActions = true,
  submitting = false,
}) {
  const [form, setForm] = useState(defaultValues);
  const [profileImagePreview, setProfileImagePreview] = useState("");
  const [profileImageDataUrl, setProfileImageDataUrl] = useState("");
  const [removeProfileImage, setRemoveProfileImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [addressLoading, setAddressLoading] = useState(true);
  const [addressError, setAddressError] = useState("");
  const [regionOptions, setRegionOptions] = useState([]);
  const [allProvinceOptions, setAllProvinceOptions] = useState([]);
  const [allCityOptions, setAllCityOptions] = useState([]);
  const [allBarangayOptions, setAllBarangayOptions] = useState([]);
  const [zipEntries, setZipEntries] = useState([]);
  const [zipCodeTouched, setZipCodeTouched] = useState(false);
  const [lastAutoFilledZipCode, setLastAutoFilledZipCode] = useState("");
  const profileImageInputRef = useRef(null);
  const dateOfBirthBounds = useMemo(() => getDateOfBirthBounds(), []);
  const isEditing = Boolean(initialValues?.id);

  const divisions = useMemo(() => options?.divisions || [], [options?.divisions]);
  const designations = useMemo(() => options?.designations || [], [options?.designations]);
  const roles = useMemo(() => options?.roles || [], [options?.roles]);
  const roleRequired = roles.length > 0 && !isEditing;
  const filteredDesignations = useMemo(
    () => designations.filter((item) => String(item.division_id) === String(form.divisionId)),
    [designations, form.divisionId]
  );
  const provinceOptions = useMemo(
    () => allProvinceOptions.filter((item) => item.region_code === form.regionCode),
    [allProvinceOptions, form.regionCode]
  );
  const cityOptions = useMemo(
    () => allCityOptions.filter((item) => item.province_code === form.provinceCode),
    [allCityOptions, form.provinceCode]
  );
  const barangayOptions = useMemo(
    () => allBarangayOptions.filter((item) => item.city_code === form.cityCode),
    [allBarangayOptions, form.cityCode]
  );
  const selectedDivisionName = useMemo(
    () => divisions.find((item) => String(item.id) === String(form.divisionId))?.name || "",
    [divisions, form.divisionId]
  );
  const selectedDesignationName = useMemo(
    () => designations.find((item) => String(item.id) === String(form.designationId))?.name || "",
    [designations, form.designationId]
  );

  useEffect(() => {
    const normalizedValues = Object.fromEntries(
      Object.entries(initialValues || {}).map(([key, value]) => [key, value ?? ""])
    );
    setForm({
      ...defaultValues,
      employeeId: initialValues?.id ? defaultValues.employeeId : nextEmployeeId,
      ...normalizedValues,
    });
    setProfileImagePreview(resolveBackendAssetUrl(initialValues?.profileImage));
    setProfileImageDataUrl("");
    setRemoveProfileImage(false);
    setErrors({});
    setZipCodeTouched(false);
    setLastAutoFilledZipCode("");
  }, [initialValues, nextEmployeeId]);

  useEffect(() => {
    let mounted = true;

    const loadAddressOptions = async () => {
      setAddressLoading(true);
      setAddressError("");

      try {
        const [regionResponse, provinceResponse, cityResponse, barangayResponse] = await Promise.all([
          fetch(`${addressBasePath}/region.json`),
          fetch(`${addressBasePath}/province.json`),
          fetch(`${addressBasePath}/city.json`),
          fetch(`${addressBasePath}/barangay.json`),
        ]);

        if (![regionResponse, provinceResponse, cityResponse, barangayResponse].every((response) => response.ok)) {
          throw new Error("Unable to load address JSON files.");
        }

        const [regions, provinces, cities, barangays] = await Promise.all([
          regionResponse.json(),
          provinceResponse.json(),
          cityResponse.json(),
          barangayResponse.json(),
        ]);

        let zipObject = {};
        try {
          const zipResponse = await fetch(`${addressBasePath}/zipcodes.json`);
          if (zipResponse.ok) {
            const zipData = await zipResponse.json();
            if (zipData && typeof zipData === "object") {
              zipObject = zipData;
            }
          }
        } catch {
          // Keep zip auto-fill optional if zipcodes.json is unavailable.
        }

        if (!mounted) {
          return;
        }

        setRegionOptions(Array.isArray(regions) ? regions : []);
        setAllProvinceOptions(Array.isArray(provinces) ? provinces : []);
        setAllCityOptions(Array.isArray(cities) ? cities : []);
        setAllBarangayOptions(Array.isArray(barangays) ? barangays : []);
        setZipEntries(Object.entries(zipObject));
      } catch {
        if (mounted) {
          setAddressError("Unable to load address options.");
        }
      } finally {
        if (mounted) {
          setAddressLoading(false);
        }
      }
    };

    loadAddressOptions();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (form.regionCode || !form.region || regionOptions.length === 0) {
      return;
    }

    const selected = regionOptions.find((item) => item.region_name === form.region);
    if (selected) {
      setForm((current) => ({ ...current, regionCode: selected.region_code }));
    }
  }, [form.region, form.regionCode, regionOptions]);

  useEffect(() => {
    if (form.provinceCode || !form.province || provinceOptions.length === 0) {
      return;
    }

    const selected = provinceOptions.find((item) => item.province_name === form.province);
    if (selected) {
      setForm((current) => ({ ...current, provinceCode: selected.province_code }));
    }
  }, [form.province, form.provinceCode, provinceOptions]);

  useEffect(() => {
    if (form.cityCode || !form.city || cityOptions.length === 0) {
      return;
    }

    const selected = cityOptions.find((item) => item.city_name === form.city);
    if (selected) {
      setForm((current) => ({ ...current, cityCode: selected.city_code }));
    }
  }, [form.city, form.cityCode, cityOptions]);

  useEffect(() => {
    const canAutoFillZipCode = !zipCodeTouched && (!form.zipCode || form.zipCode === lastAutoFilledZipCode);

    if (!canAutoFillZipCode) {
      return;
    }

    const matchedZipCode = resolveZipCode(zipEntries, form.city, form.address, form.province, form.region);
    if (!matchedZipCode) {
      return;
    }

    if (form.zipCode === matchedZipCode) {
      return;
    }

    setForm((current) => ({ ...current, zipCode: matchedZipCode }));
    setLastAutoFilledZipCode(matchedZipCode);
  }, [
    zipEntries,
    form.city,
    form.address,
    form.province,
    form.region,
    form.zipCode,
    lastAutoFilledZipCode,
    zipCodeTouched,
  ]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const updatePhone = (event) => {
    const nextPhone = String(event.target.value || "")
      .replace(/\D/g, "")
      .slice(0, 11);

    setForm((current) => ({ ...current, phone: nextPhone }));
    setErrors((current) => ({ ...current, phone: "" }));
  };

  const updateDivision = (event) => {
    setForm((current) => ({
      ...current,
      divisionId: event.target.value,
      designationId: "",
    }));
    setErrors((current) => ({ ...current, divisionId: "", designationId: "" }));
  };

  const updateRegion = (event) => {
    const selected = regionOptions.find((item) => item.region_code === event.target.value);
    setZipCodeTouched(false);
    setLastAutoFilledZipCode("");
    setForm((current) => ({
      ...current,
      regionCode: selected?.region_code || "",
      region: selected?.region_name || "",
      provinceCode: "",
      province: "",
      cityCode: "",
      city: "",
      address: "",
      zipCode: "",
    }));
  };

  const updateProvince = (event) => {
    const selected = provinceOptions.find((item) => item.province_code === event.target.value);
    setZipCodeTouched(false);
    setLastAutoFilledZipCode("");
    setForm((current) => ({
      ...current,
      provinceCode: selected?.province_code || "",
      province: selected?.province_name || "",
      cityCode: "",
      city: "",
      address: "",
      zipCode: "",
    }));
  };

  const updateCity = (event) => {
    const selected = cityOptions.find((item) => item.city_code === event.target.value);
    setZipCodeTouched(false);
    setLastAutoFilledZipCode("");
    setForm((current) => ({
      ...current,
      cityCode: selected?.city_code || "",
      city: selected?.city_name || "",
      address: "",
      zipCode: "",
    }));
  };

  const updateBarangay = (event) => {
    const selected = barangayOptions.find((item) => item.brgy_name === event.target.value);
    setZipCodeTouched(false);
    setLastAutoFilledZipCode("");
    setForm((current) => ({ ...current, address: selected?.brgy_name || "", zipCode: "" }));
  };

  const updateZipCode = (event) => {
    setZipCodeTouched(true);
    setForm((current) => ({ ...current, zipCode: event.target.value }));
    setErrors((current) => ({ ...current, zipCode: "" }));
  };

  const handleProfileImageChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Choose a valid image file.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Profile image must be 5 MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      setProfileImagePreview(result);
      setProfileImageDataUrl(result);
      setRemoveProfileImage(false);
    };
    reader.onerror = () => {
      toast.error("Unable to read the selected image.");
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveProfileImage = () => {
    setProfileImagePreview("");
    setProfileImageDataUrl("");
    setRemoveProfileImage(Boolean(initialValues?.profileImage));
  };

  const validate = () => {
    const nextErrors = {};
    const birthDate = parseDateInput(form.dateOfBirth);
    const trimmedEmail = form.email.trim();
    const trimmedPhone = form.phone.trim();

    if (!form.employeeId.trim()) nextErrors.employeeId = "Employee ID is required.";
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!form.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!form.dateOfBirth) nextErrors.dateOfBirth = "Date of birth is required.";
    if (!form.email.trim()) nextErrors.email = "Email is required.";
    if (!form.phone.trim()) nextErrors.phone = "Phone is required.";
    if (roleRequired && !form.roleId) nextErrors.roleId = "Role is required.";
    if (!form.divisionId) nextErrors.divisionId = "Division is required.";
    if (!form.designationId) nextErrors.designationId = "Designation is required.";

    if (
      form.dateOfBirth
      && (!birthDate
        || birthDate < dateOfBirthBounds.earliestDate
        || birthDate > dateOfBirthBounds.latestDate)
    ) {
      nextErrors.dateOfBirth = "Employee age must be between 18 and 100 years old.";
    }

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (trimmedPhone && !/^\d{11}$/.test(trimmedPhone)) {
      nextErrors.phone = "Phone number must be exactly 11 digits.";
    }

    if (form.salaryRate && !salaryRates.includes(form.salaryRate)) {
      nextErrors.salaryRate = "Salary rate must be Semi-monthly or Monthly.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error(Object.values(nextErrors)[0] || "Please correct the highlighted fields.");
    }
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    onSubmit?.({
      ...form,
      employeeId: form.employeeId.trim(),
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      zipCode: form.zipCode.trim(),
      basicSalary: form.basicSalary === "" ? null : form.basicSalary,
      height: form.height === "" ? null : form.height,
      weight: form.weight === "" ? null : form.weight,
      profileImageDataUrl,
      removeProfileImage,
    });
  };

  return (
    <form
      id={formId}
      className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"
      onSubmit={handleSubmit}
    >
      <ProfileImageUpload
        form={form}
        previewUrl={profileImagePreview}
        fileInputRef={profileImageInputRef}
        isEditing={isEditing}
        divisionName={selectedDivisionName}
        designationName={selectedDesignationName}
        onUploadClick={() => profileImageInputRef.current?.click()}
        onRemove={handleRemoveProfileImage}
        onFileChange={handleProfileImageChange}
      />

      <div className="grid min-w-0 gap-4">
        <Section
          icon={UserRound}
          title="Personal Information"
          description="Core employee identity and profile details."
        >
          <TextField
            label="Employee ID *"
            name="employeeId"
            value={form.employeeId}
            readOnly
            placeholder="EMP2026-0001"
            error={errors.employeeId}
            className="md:col-span-2"
            inputClassName="cursor-not-allowed bg-slate-50 font-semibold text-slate-600"
          />
          <TextField
            label="First Name *"
            name="firstName"
            value={form.firstName}
            onChange={updateField("firstName")}
            placeholder="Enter first name"
            error={errors.firstName}
          />
          <TextField
            label="Middle Name"
            name="middleName"
            value={form.middleName}
            onChange={updateField("middleName")}
            placeholder="Enter middle name"
          />
          <TextField
            label="Last Name *"
            name="lastName"
            value={form.lastName}
            onChange={updateField("lastName")}
            placeholder="Enter last name"
            error={errors.lastName}
          />
          <TextField
            label="Date of Birth *"
            name="dateOfBirth"
            type="date"
            value={form.dateOfBirth || ""}
            onChange={updateField("dateOfBirth")}
            error={errors.dateOfBirth}
          />
        </Section>

        <Section
          icon={MapPin}
          title="Address Information"
          description="Region, province, city, and barangay details."
        >
          {addressError ? (
            <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 md:col-span-2">
              {addressError}
            </p>
          ) : null}
          <SelectField label="Region" name="region" value={form.regionCode} onChange={updateRegion} disabled={addressLoading}>
            <option value="">{addressLoading ? "Loading regions..." : "Select region"}</option>
            {regionOptions.map((item) => <option key={item.region_code} value={item.region_code}>{item.region_name}</option>)}
          </SelectField>
          <SelectField label="Province" name="province" value={form.provinceCode} onChange={updateProvince} disabled={!form.regionCode}>
            <option value="">{form.regionCode ? "Select province" : "Select region first"}</option>
            {provinceOptions.map((item) => <option key={item.province_code} value={item.province_code}>{item.province_name}</option>)}
          </SelectField>
          <SelectField label="City / Municipality" name="city" value={form.cityCode} onChange={updateCity} disabled={!form.provinceCode}>
            <option value="">{form.provinceCode ? "Select city / municipality" : "Select province first"}</option>
            {cityOptions.map((item) => <option key={item.city_code} value={item.city_code}>{item.city_name}</option>)}
          </SelectField>
          <SelectField label="Address" name="address" value={form.address} onChange={updateBarangay} disabled={!form.cityCode}>
            <option value="">{form.cityCode ? "Select barangay" : "Select city first"}</option>
            {barangayOptions.map((item) => <option key={item.brgy_code} value={item.brgy_name}>{item.brgy_name}</option>)}
          </SelectField>
          <TextField
            label="Zip Code"
            name="zipCode"
            value={form.zipCode}
            onChange={updateZipCode}
            placeholder="Auto-filled from selected location"
            inputMode="numeric"
            maxLength={10}
          />
        </Section>

        <Section
          icon={Mail}
          title="Contact Information"
          description="Communication details and quick profile fields."
        >
          <SelectField label="Gender" name="gender" value={form.gender} onChange={updateField("gender")}>
            <option value="">Select gender</option>
            {genderOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectField>
          <TextField
            label="Email *"
            name="email"
            type="email"
            value={form.email}
            onChange={updateField("email")}
            placeholder="Enter email address"
            error={errors.email}
          />
          <TextField
            label="Phone *"
            name="phone"
            value={form.phone}
            onChange={updatePhone}
            placeholder="Enter 11-digit phone number"
            inputMode="numeric"
            maxLength={11}
            error={errors.phone}
          />
        </Section>

        <Section
          icon={Briefcase}
          title="Employment Information"
          description="Division and role assignment details."
        >
          {roles.length > 0 ? (
            <SelectField label={`Role${roleRequired ? " *" : ""}`} name="roleId" value={form.roleId} onChange={updateField("roleId")} error={errors.roleId}>
              <option value="">Select role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label || role.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          <SelectField label="Division *" name="divisionId" value={form.divisionId} onChange={updateDivision} error={errors.divisionId}>
            <option value="">Select division</option>
            {divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SelectField>
          <SelectField label="Designation *" name="designationId" value={form.designationId} onChange={updateField("designationId")} error={errors.designationId} disabled={!form.divisionId}>
            <option value="">{form.divisionId ? "Select designation" : "Select division first"}</option>
            {filteredDesignations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SelectField>
        </Section>

        <Section
          icon={Banknote}
          title="Payroll Information"
          description="Salary and work status details used for payroll processing."
        >
          <TextField
            label="Basic Salary"
            name="basicSalary"
            type="number"
            min="0"
            step="0.01"
            value={form.basicSalary ?? ""}
            onChange={updateField("basicSalary")}
            placeholder="Enter basic salary"
          />
          <SelectField label="Salary Rate" name="salaryRate" value={form.salaryRate} onChange={updateField("salaryRate")} error={errors.salaryRate}>
            <option value="">Select salary rate</option>
            {salaryRates.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectField>
          <TextField
            label="Date Hired"
            name="dateHired"
            type="date"
            value={form.dateHired || ""}
            onChange={updateField("dateHired")}
          />
          <SelectField label="Employment Status" name="employmentStatus" value={form.employmentStatus} onChange={updateField("employmentStatus")}>
            <option value="">Select employment status</option>
            {employmentStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectField>
        </Section>

        <Section
          icon={HeartPulse}
          title="Additional Personal Details"
          description="Supplemental employee profile information."
        >
          <SelectField label="PWD" name="pwd" value={form.pwd} onChange={updateField("pwd")}>
            <option value="0">No</option>
            <option value="1">Yes</option>
          </SelectField>
          <SelectField label="Civil Status" name="civilStatus" value={form.civilStatus} onChange={updateField("civilStatus")}>
            <option value="">Select civil status</option>
            {civilStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectField>
          <TextField
            label="Height"
            name="height"
            type="number"
            min="0"
            step="0.01"
            value={form.height ?? ""}
            onChange={updateField("height")}
            placeholder="Select height"
          />
          <TextField
            label="Weight"
            name="weight"
            type="number"
            min="0"
            step="0.01"
            value={form.weight ?? ""}
            onChange={updateField("weight")}
            placeholder="Select weight"
          />
          <SelectField label="Blood Type" name="bloodType" value={form.bloodType} onChange={updateField("bloodType")}>
            <option value="">Select blood type</option>
            {bloodTypes.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectField>
        </Section>

        <Section
          icon={IdCard}
          title="Government IDs"
          description="Contribution and tax identification numbers."
        >
          <TextField label="GSIS ID No." name="gsisIdNo" value={form.gsisIdNo} onChange={updateField("gsisIdNo")} placeholder="Enter GSIS ID no." />
          <TextField label="Pag-IBIG ID No." name="pagibigIdNo" value={form.pagibigIdNo} onChange={updateField("pagibigIdNo")} placeholder="Enter Pag-IBIG ID no." />
          <TextField label="PhilHealth ID No." name="philhealthIdNo" value={form.philhealthIdNo} onChange={updateField("philhealthIdNo")} placeholder="Enter PhilHealth ID no." />
          <TextField label="TIN No." name="tinNo" value={form.tinNo} onChange={updateField("tinNo")} placeholder="Enter TIN no." />
        </Section>

        {showActions ? (
          <div className="flex flex-col-reverse gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>{submitLabel}</Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
