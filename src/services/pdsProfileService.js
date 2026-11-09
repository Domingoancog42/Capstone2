import api from "./api";

export const pdsEducationLevels = [
  { value: "elementary", label: "Elementary" },
  { value: "secondary", label: "Secondary" },
  { value: "vocational", label: "Vocational / Trade Course" },
  { value: "college", label: "College" },
  { value: "graduate", label: "Graduate Studies" },
];

export function createEmptyPdsFamily() {
  return {
    spouseLastName: "",
    spouseFirstName: "",
    spouseMiddleName: "",
    spouseSuffix: "",
    spouseOccupation: "",
    spouseEmployer: "",
    spouseBusinessAddress: "",
    spouseTelephone: "",
    fatherLastName: "",
    fatherFirstName: "",
    fatherMiddleName: "",
    fatherSuffix: "",
    motherMaidenLastName: "",
    motherFirstName: "",
    motherMiddleName: "",
    children: [],
  };
}

export function createEmptyPdsEducation() {
  return pdsEducationLevels.map(({ value }) => ({
    level: value,
    schoolName: "",
    degreeCourse: "",
    attendanceFrom: "",
    attendanceTo: "",
    highestLevelUnits: "",
    yearGraduated: "",
    honors: "",
  }));
}

export const pdsRecordLimits = { eligibility: 31, training: 61 };

export function createEmptyPdsEligibility() {
  return { eligibilityName: "", rating: "", examinationDate: "", examinationPlace: "", licenseNumber: "", validityDate: "" };
}

export function createEmptyPdsTraining() {
  return { title: "", dateFrom: "", dateTo: "", hours: "", type: "", conductedBy: "" };
}

export function validatePdsRecords(section, records) {
  const errors = {};
  if (records.length > pdsRecordLimits[section]) errors[section] = `You can save up to ${pdsRecordLimits[section]} entries.`;
  const empty = section === "eligibility" ? createEmptyPdsEligibility() : createEmptyPdsTraining();
  records.forEach((record, index) => {
    if (!Object.keys(empty).some((key) => String(record[key] ?? "").trim() !== "")) return;
    const nameField = section === "eligibility" ? "eligibilityName" : "title";
    if (!String(record[nameField] ?? "").trim()) {
      errors[`${section}-${index}-${nameField}`] = section === "eligibility" ? "Enter the eligibility name." : "Enter the training title.";
    }
    const dateFields = section === "eligibility" ? ["examinationDate", "validityDate"] : ["dateFrom", "dateTo"];
    dateFields.forEach((field) => {
      const value = String(record[field] ?? "");
      if (!value) return;
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        errors[`${section}-${index}-${field}`] = "Enter a valid date.";
      }
    });
    if (section === "training") {
      if (record.dateFrom && record.dateTo && record.dateTo < record.dateFrom) {
        errors[`training-${index}-dateTo`] = "End date must be on or after the start date.";
      }
      const value = String(record.hours ?? "").trim();
      const hours = Number(value);
      if (value && (!Number.isFinite(hours) || hours < 0 || hours > 999999.99 || Math.abs(Math.round(hours * 100) / 100 - hours) > 0.000001)) {
        errors[`training-${index}-hours`] = "Enter non-negative hours with up to two decimal places.";
      }
    }
  });
  return errors;
}

export function createEmptyPdsProfile() {
  return {
    family: createEmptyPdsFamily(),
    education: createEmptyPdsEducation(),
    eligibility: [],
    training: [],
  };
}

export function normalizePdsProfile(payload = {}) {
  const empty = createEmptyPdsProfile();
  const family = payload.family && typeof payload.family === "object"
    ? { ...empty.family, ...payload.family }
    : empty.family;
  family.children = Array.isArray(payload.family?.children)
    ? payload.family.children.map((child) => ({
      id: child.id || "",
      fullName: String(child.fullName || ""),
      dateOfBirth: String(child.dateOfBirth || ""),
    }))
    : [];

  const providedEducation = new Map(
    (Array.isArray(payload.education) ? payload.education : [])
      .map((record) => [String(record?.level || ""), record])
  );

  return {
    family,
    education: empty.education.map((record) => ({
      ...record,
      ...(providedEducation.get(record.level) || {}),
      level: record.level,
    })),
    ...Object.fromEntries(["eligibility", "training"].map((section) => {
      const blank = section === "eligibility" ? createEmptyPdsEligibility() : createEmptyPdsTraining();
      const records = Array.isArray(payload[section]) ? payload[section] : [];
      return [section, records.filter((record) => record && typeof record === "object").map((record) => ({
        id: record.id || "",
        ...Object.fromEntries(Object.keys(blank).map((field) => [field, String(record[field] ?? "")])),
      }))];
    })),
  };
}

export async function getPdsProfile() {
  const response = await api.get("/employee_pds_profile.php");
  return normalizePdsProfile(response.data);
}

export async function savePdsFamily(family) {
  const response = await api.put("/employee_pds_profile.php", {
    section: "family",
    family,
  });
  return {
    ...response.data,
    ...normalizePdsProfile(response.data),
  };
}

export async function savePdsEducation(education) {
  const response = await api.put("/employee_pds_profile.php", {
    section: "education",
    education,
  });
  return {
    ...response.data,
    ...normalizePdsProfile(response.data),
  };
}

async function savePdsRecords(section, records) {
  const response = await api.put("/employee_pds_profile.php", { section, [section]: records });
  return { ...response.data, ...normalizePdsProfile(response.data) };
}

export const savePdsEligibility = (records) => savePdsRecords("eligibility", records);
export const savePdsTraining = (records) => savePdsRecords("training", records);
