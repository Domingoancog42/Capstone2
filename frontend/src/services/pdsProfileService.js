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

export function createEmptyPdsProfile() {
  return {
    family: createEmptyPdsFamily(),
    education: createEmptyPdsEducation(),
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
