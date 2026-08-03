import { SESSION_USER_KEY, normalizeUser } from "../../utils/roleRoutes";

/**
 * Sections rendered inline on the profile page, in scroll order.
 *
 * These used to be tabs. They are now one continuous scrollable document with a sticky jump nav, so
 * the order here is also the order the reader sees.
 */
export const profileSectionItems = [
  { id: "personal", label: "Personal Details" },
  { id: "address", label: "Address" },
  { id: "government", label: "Government IDs" },
  { id: "employment", label: "Employment Status" },
  { id: "emergency", label: "Emergency Contact" },
  { id: "signature", label: "E-Signature" },
  { id: "security", label: "Security" },
];

/** Panels that open in a floating card instead of taking space in the scroll flow. */
export const profileDialogItems = [
  { id: "serviceRecord", label: "Service Record" },
];

/** Every addressable profile target — a deep link may point at either kind. */
export const profileTabItems = [...profileSectionItems, ...profileDialogItems];

/** DOM id of an inline section, shared by the section cards and the sticky nav's scroll spy. */
export function profileSectionAnchorId(sectionId) {
  return `profile-section-${sectionId}`;
}

export const PROFILE_TAB_REQUEST_EVENT = "hris:profile-tab-requested";
const PROFILE_TAB_REQUEST_KEY = "hris_profile_requested_tab";

export function isProfileTabId(tabId) {
  return profileTabItems.some((tab) => tab.id === tabId);
}

export function isProfileSectionId(tabId) {
  return profileSectionItems.some((section) => section.id === tabId);
}

export function isProfileDialogId(tabId) {
  return profileDialogItems.some((dialog) => dialog.id === tabId);
}

export function requestProfileTab(tabId) {
  if (typeof window === "undefined" || !isProfileTabId(tabId)) {
    return;
  }

  try {
    window.sessionStorage.setItem(PROFILE_TAB_REQUEST_KEY, tabId);
  } catch {
    // The event still handles already-mounted profile pages.
  }

  window.dispatchEvent(new CustomEvent(PROFILE_TAB_REQUEST_EVENT, { detail: { tabId } }));
}

/**
 * Reads the pending deep-link target, if any.
 *
 * Unlike the old tab version there is no fallback: with every section on one page, "no request" means
 * "start at the top", not "select personal".
 */
export function consumeRequestedProfileTab(fallback = "") {
  const safeFallback = isProfileTabId(fallback) ? fallback : "";

  if (typeof window === "undefined") {
    return safeFallback;
  }

  try {
    const requestedTab = window.sessionStorage.getItem(PROFILE_TAB_REQUEST_KEY);
    window.sessionStorage.removeItem(PROFILE_TAB_REQUEST_KEY);

    return isProfileTabId(requestedTab) ? requestedTab : safeFallback;
  } catch {
    return safeFallback;
  }
}

export const genderOptions = ["Male", "Female", "Prefer not to say"];
export const civilStatusOptions = ["Single", "Married", "Widowed", "Separated"];
export const employmentStatusOptions = ["Regular", "Contractual"];
export const employmentTypeOptions = ["Permanent", "Probationary", "Contractual", "Casual"];

const profileDefaults = {
  employeeRecordId: "",
  employeeId: "",
  firstName: "",
  middleName: "",
  lastName: "",
  suffix: "",
  fullName: "",
  dateOfBirth: "",
  gender: "",
  civilStatus: "",
  nationality: "Filipino",
  phone: "",
  email: "",
  region: "",
  regionCode: "",
  province: "",
  provinceCode: "",
  city: "",
  cityCode: "",
  barangay: "",
  barangayCode: "",
  address: "",
  zipCode: "",
  gsisIdNo: "",
  philhealthIdNo: "",
  pagibigIdNo: "",
  tinNo: "",
  employmentType: "",
  employmentStatus: "",
  dateHired: "",
  regularizationDate: "",
  divisionId: "",
  designationId: "",
  department: "",
  position: "",
  supervisor: "",
  status: "Active",
  basicSalary: "",
  salaryRate: "",
  emergencyContactName: "",
  emergencyRelationship: "",
  emergencyPhone: "",
  emergencyAddress: "",
  profileImage: "",
  signatureDataUrl: "",
  signatureUploadName: "",
};

export function normalizeProfileText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProfileName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNameVariants(value) {
  const tokens = normalizeProfileName(value)
    .split(" ")
    .filter(Boolean);

  if (tokens.length === 0) {
    return [];
  }

  const variants = [tokens.join(" ")];
  if (tokens.length >= 2) {
    variants.push(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }

  return Array.from(new Set(variants.filter(Boolean)));
}

export function resolveInitials(name) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "HR";
}

export function getProfileStorageKey(user, employee) {
  const scopedId = employee?.employeeId || user?.employee_id || user?.username || "profile";
  return `hris_profile_extras:${scopedId}`;
}

export function readProfileExtras(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeProfileExtras(storageKey, extras) {
  window.localStorage.setItem(storageKey, JSON.stringify(extras));
}

export function findEmployeeForUser(employees = [], user = null) {
  const userEmployeeIds = Array.from(
    new Set(
      [user?.employee_id, user?.username]
        .map(normalizeProfileText)
        .filter(Boolean)
    )
  );
  const userEmails = Array.from(
    new Set(
      [user?.email, String(user?.username || "").includes("@") ? user?.username : ""]
        .map(normalizeProfileText)
        .filter(Boolean)
    )
  );
  const userNameVariants = Array.from(
    new Set([
      ...buildNameVariants(user?.full_name),
      ...buildNameVariants(user?.username),
    ])
  );

  return employees.find((employee) => {
    const employeeId = normalizeProfileText(employee.employeeId);
    const employeeEmail = normalizeProfileText(employee.email);
    const employeeName = employee.fullName
      || [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(" ");
    const employeeNameVariants = buildNameVariants(employeeName);

    return (
      (employeeId && userEmployeeIds.some((value) => value === employeeId))
      || (employeeEmail && userEmails.some((value) => value === employeeEmail))
      || userNameVariants.some((value) => employeeNameVariants.includes(value))
    );
  }) || null;
}

export function mergeEmployeeWithExtras(employee, extras = {}) {
  if (!employee) {
    return {
      ...profileDefaults,
      ...extras,
    };
  }

  const middleInitial = String(extras.middleInitial || "").trim();
  const fullName = employee.fullName || [employee.firstName, employee.middleName, employee.lastName]
    .filter(Boolean)
    .join(" ");

  return {
    ...profileDefaults,
    employeeRecordId: String(employee.id || employee.employeeRecordId || ""),
    employeeId: employee.employeeId || "",
    firstName: employee.firstName || "",
    middleName: employee.middleName || "",
    lastName: employee.lastName || "",
    suffix: extras.suffix || "",
    fullName,
    dateOfBirth: employee.dateOfBirth || "",
    gender: employee.gender || "",
    civilStatus: employee.civilStatus || "",
    nationality: extras.nationality || "Filipino",
    phone: employee.phone || "",
    email: employee.email || "",
    region: extras.region || "",
    regionCode: extras.regionCode || "",
    province: employee.province || "",
    provinceCode: extras.provinceCode || "",
    city: employee.city || "",
    cityCode: extras.cityCode || "",
    barangay: extras.barangay || "",
    barangayCode: extras.barangayCode || "",
    address: employee.address || "",
    zipCode: employee.zipCode || "",
    gsisIdNo: employee.gsisIdNo || "",
    philhealthIdNo: employee.philhealthIdNo || "",
    pagibigIdNo: employee.pagibigIdNo || "",
    tinNo: employee.tinNo || "",
    employmentType: extras.employmentType || "",
    employmentStatus: employee.employmentStatus || extras.employmentStatus || "",
    dateHired: employee.dateHired || extras.dateHired || "",
    regularizationDate: extras.regularizationDate || "",
    divisionId: String(employee.divisionId || extras.divisionId || ""),
    designationId: String(employee.designationId || extras.designationId || ""),
    department: employee.department || extras.department || "",
    position: employee.position || extras.position || "",
    supervisor: extras.supervisor || "",
    status: employee.status || "Active",
    basicSalary: employee.basicSalary || "",
    salaryRate: employee.salaryRate || "",
    emergencyContactName: extras.emergencyContactName || "",
    emergencyRelationship: extras.emergencyRelationship || "",
    emergencyPhone: extras.emergencyPhone || "",
    emergencyAddress: extras.emergencyAddress || "",
    profileImage: employee.profileImage || extras.profileImage || "",
    signatureDataUrl: employee.signatureDataUrl || extras.signatureDataUrl || "",
    signatureUploadName: extras.signatureUploadName || "",
    middleInitial,
  };
}

export function extractProfileExtras(profile) {
  return {
    suffix: profile.suffix || "",
    nationality: profile.nationality || "",
    region: profile.region || "",
    regionCode: profile.regionCode || "",
    provinceCode: profile.provinceCode || "",
    cityCode: profile.cityCode || "",
    barangay: profile.barangay || "",
    barangayCode: profile.barangayCode || "",
    employmentType: profile.employmentType || "",
    employmentStatus: profile.employmentStatus || "",
    dateHired: profile.dateHired || "",
    divisionId: profile.divisionId || "",
    designationId: profile.designationId || "",
    department: profile.department || "",
    position: profile.position || "",
    supervisor: profile.supervisor || "",
    emergencyContactName: profile.emergencyContactName || "",
    emergencyRelationship: profile.emergencyRelationship || "",
    emergencyPhone: profile.emergencyPhone || "",
    emergencyAddress: profile.emergencyAddress || "",
    profileImage: profile.profileImage || "",
    signatureDataUrl: profile.signatureDataUrl || "",
    signatureUploadName: profile.signatureUploadName || "",
    middleInitial: profile.middleInitial || "",
  };
}

export function buildEmployeePayload(profile) {
  return {
    employeeId: profile.employeeId || "",
    firstName: profile.firstName.trim(),
    middleName: profile.middleName.trim(),
    lastName: profile.lastName.trim(),
    dateOfBirth: profile.dateOfBirth || "",
    address: profile.address.trim(),
    city: profile.city.trim(),
    province: profile.province.trim(),
    zipCode: profile.zipCode.trim(),
    gender: profile.gender || "",
    email: profile.email.trim(),
    phone: profile.phone.trim(),
    divisionId: Number(profile.divisionId) || 0,
    designationId: Number(profile.designationId) || 0,
    basicSalary: profile.basicSalary || "",
    salaryRate: profile.salaryRate || "",
    dateHired: profile.dateHired || "",
    status: profile.status || "Active",
    employmentStatus: profile.employmentStatus || "",
    pwd: "0",
    civilStatus: profile.civilStatus || "",
    height: "",
    weight: "",
    bloodType: "",
    gsisIdNo: profile.gsisIdNo.trim(),
    pagibigIdNo: profile.pagibigIdNo.trim(),
    philhealthIdNo: profile.philhealthIdNo.trim(),
    tinNo: profile.tinNo.trim(),
  };
}

export function buildUpdatedSessionUser(user, employee) {
  const nextUser = normalizeUser({
    ...user,
    email: employee?.email || user?.email || "",
    employee_id: employee?.employeeId || user?.employee_id || "",
    full_name: employee?.fullName || [employee?.firstName, employee?.middleName, employee?.lastName].filter(Boolean).join(" ") || user?.full_name || "",
    division: employee?.department || user?.division || "",
    designation: employee?.position || user?.designation || "",
    profile_image: employee?.profileImage || user?.profile_image || "",
  });

  window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(nextUser));
  return nextUser;
}

export function buildUpdatedSessionUserFromProfile(user, profile) {
  const fullName = profile?.fullName || [profile?.firstName, profile?.middleName, profile?.lastName]
    .filter(Boolean)
    .join(" ");

  const nextUser = normalizeUser({
    ...user,
    email: profile?.email || user?.email || "",
    employee_id: profile?.employeeId || user?.employee_id || "",
    full_name: fullName || user?.full_name || "",
    division: profile?.department || user?.division || "",
    designation: profile?.position || user?.designation || "",
    profile_image: profile?.profileImage || user?.profile_image || "",
  });

  window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(nextUser));
  return nextUser;
}
