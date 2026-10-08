import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  FolderOpen,
  GraduationCap,
  History,
  IdCard,
  LifeBuoy,
  LoaderCircle,
  MapPin,
  PenLine,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { registerNavigationGuard } from "../../utils/navigationGuard";
import {
  getEmployeeOptions,
  getEmployees,
  getEmployeeSignature,
  fetchServiceRecord,
  getTwoFactorProfile,
  getUsers,
  checkPasswordExpiry,
  saveTwoFactorProfile,
  updateEmployee,
  updateEmployeeProfileImage,
  updateEmployeeSignature,
} from "../../services/api";
import { useAutoRefreshOnChange } from "../auto/autorefreshdatalist";
import {
  fetchProfileEditRequestStatus,
  requestProfileEdit,
} from "../../services/profileEditRequestService";
import ProfileFloatingCard from "./ProfileFloatingCard";
import ProfileHeaderCard from "./ProfileHeaderCard";
import ProfileImageModal from "./ProfileImageModal";
import SalaryGradeHistory, { getCurrentSalaryGradeRecord } from "./SalaryGradeHistory";
import ProfileSectionNav from "./ProfileSectionNav";
import {
  buildEmployeePayload,
  buildUpdatedSessionUser,
  consumeRequestedProfileTab,
  extractProfileExtras,
  findEmployeeForUser,
  getProfileStorageKey,
  isRegularEmploymentStatus,
  isProfileDialogId,
  isProfileSectionId,
  isProfileTabId,
  mergeEmployeeWithExtras,
  normalizeProfileText,
  profileSectionItems,
  PROFILE_TAB_REQUEST_EVENT,
  readProfileExtras,
  writeProfileExtras,
} from "./profileUtils";
import { resolveUserRoleKey } from "../../utils/roleRoutes";
import {
  formatGovernmentId,
  GOVERNMENT_ID_FORMATS,
  validateGovernmentId,
} from "../../utils/governmentId";
import PersonalDetailsSection from "./sections/PersonalDetailsSection";
import AddressSection from "./sections/AddressSection";
import GovernmentIdsSection from "./sections/GovernmentIdsSection";
import EmploymentStatusSection from "./sections/EmploymentStatusSection";
import EmergencyContactSection from "./sections/EmergencyContactSection";
import DocumentsSection from "./sections/DocumentsSection";
import SignatureSection from "./sections/SignatureSection";
import SecuritySection from "./sections/SecuritySection";
import PasswordChangeSection from "./sections/PasswordChangeSection";
import ProfileEmailChangeSection from "./sections/ProfileEmailChangeSection";
import { downloadPersonalDataSheet } from "../../services/personalDataSheetService";
import FamilyBackgroundSection from "./sections/FamilyBackgroundSection";
import EducationalBackgroundSection from "./sections/EducationalBackgroundSection";
import {
  createEmptyPdsProfile,
  getPdsProfile,
  savePdsEducation,
  savePdsFamily,
} from "../../services/pdsProfileService";

/*
 * The PSGC address lists. They used to sit in `public/` and be fetched over HTTP at runtime; they
 * now live in `src/data/` and are compiled in, so they are present the moment this module loads and
 * there is no request to fail or 404. The trade is size -- barangay.json alone is 4.8 MB and it is
 * carried in the main bundle whether or not anyone opens this page.
 */
import barangayData from "../../data/philippines-addresses/barangay.json";
import cityData from "../../data/philippines-addresses/city.json";
import provinceData from "../../data/philippines-addresses/province.json";
import regionData from "../../data/philippines-addresses/region.json";

function clearSectionErrors(section, previousErrors) {
  const keysBySection = {
    personal: ["firstName", "middleName", "lastName", "suffix", "dateOfBirth", "gender", "civilStatus", "nationality", "phone"],
    address: ["regionCode", "provinceCode", "cityCode", "barangayCode", "address", "zipCode"],
    government: ["gsisIdNo", "philhealthIdNo", "pagibigIdNo", "tinNo"],
    emergency: ["emergencyContactName", "emergencyRelationship", "emergencyPhone", "emergencyAddress"],
    signature: ["signatureDataUrl"],
  };

  const next = { ...previousErrors };
  (keysBySection[section] || []).forEach((key) => {
    delete next[key];
  });
  return next;
}

function validateSection(section, profile) {
  const nextErrors = {};

  if (section === "personal") {
    if (!profile.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!profile.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!profile.dateOfBirth) nextErrors.dateOfBirth = "Birth date is required.";
    if (!profile.gender) nextErrors.gender = "Gender is required.";
    if (!profile.civilStatus) nextErrors.civilStatus = "Civil status is required.";
    if (!profile.nationality.trim()) nextErrors.nationality = "Nationality is required.";
    if (!profile.phone.trim()) nextErrors.phone = "Contact number is required.";
  }

  if (section === "address") {
    if (!profile.regionCode) nextErrors.regionCode = "Region is required.";
    if (!profile.provinceCode) nextErrors.provinceCode = "Province is required.";
    if (!profile.cityCode) nextErrors.cityCode = "City or municipality is required.";
    if (!profile.barangayCode) nextErrors.barangayCode = "Barangay is required.";
    if (!profile.address.trim()) nextErrors.address = "Street address is required.";
    if (!profile.zipCode.trim()) nextErrors.zipCode = "ZIP code is required.";
  }

  if (section === "government") {
    Object.keys(GOVERNMENT_ID_FORMATS).forEach((name) => {
      if (name === "gsisIdNo" && !isRegularEmploymentStatus(profile.employmentStatus)) {
        return;
      }

      const message = validateGovernmentId(name, profile[name]);
      if (message) nextErrors[name] = message;
    });
  }

  if (section === "emergency") {
    if (!profile.emergencyContactName.trim()) nextErrors.emergencyContactName = "Contact person name is required.";
    if (!profile.emergencyRelationship.trim()) nextErrors.emergencyRelationship = "Relationship is required.";
    if (!profile.emergencyPhone.trim()) nextErrors.emergencyPhone = "Contact number is required.";
    if (!profile.emergencyAddress.trim()) nextErrors.emergencyAddress = "Emergency contact address is required.";
  }

  if (section === "signature" && !profile.signatureDataUrl) {
    nextErrors.signatureDataUrl = "Provide a signature by drawing or uploading one.";
  }

  return nextErrors;
}

/*
 * The fields each editable tab owns, for telling which tabs Save Changes has to send. The derived
 * address names travel with their codes, since picking a region rewrites both.
 */
const PERSONAL_FIELDS = ["firstName", "middleName", "lastName", "suffix", "dateOfBirth", "gender", "civilStatus", "nationality", "phone"];
const ADDRESS_FIELDS = ["regionCode", "region", "provinceCode", "province", "cityCode", "city", "barangayCode", "barangay", "address", "zipCode"];
const GOVERNMENT_FIELDS = Object.keys(GOVERNMENT_ID_FORMATS);
const EMERGENCY_FIELDS = ["emergencyContactName", "emergencyRelationship", "emergencyPhone", "emergencyAddress"];
const SAVED_ONE_BY_ONE_FIELDS = ["profileImage", "email"];

function fieldsChanged(fields, current, original) {
  return fields.some((field) => String(current?.[field] ?? "") !== String(original?.[field] ?? ""));
}

function pickFields(source, fields) {
  return fields.reduce((picked, field) => ({ ...picked, [field]: source?.[field] }), {});
}

function hasSharedIdentityValue(leftValues = [], rightValues = []) {
  const leftSet = new Set(leftValues.map(normalizeProfileText).filter(Boolean));
  return rightValues
    .map(normalizeProfileText)
    .filter(Boolean)
    .some((value) => leftSet.has(value));
}

function matchesCurrentProfileUser(candidateUser, sessionUser, linkedEmployee) {
  return (
    hasSharedIdentityValue(
      [candidateUser?.email],
      [sessionUser?.email, linkedEmployee?.email]
    )
    || hasSharedIdentityValue(
      [candidateUser?.employee_id],
      [sessionUser?.employee_id, linkedEmployee?.employeeId]
    )
    || hasSharedIdentityValue(
      [candidateUser?.full_name],
      [sessionUser?.full_name, linkedEmployee?.fullName]
    )
    || hasSharedIdentityValue(
      [candidateUser?.username],
      [sessionUser?.username]
    )
  );
}

function buildDivisionChiefMap(users = [], sessionUser = null, linkedEmployee = null) {
  return users.reduce((current, candidateUser) => {
    if (resolveUserRoleKey(candidateUser) !== "chief") {
      return current;
    }

    if (matchesCurrentProfileUser(candidateUser, sessionUser, linkedEmployee)) {
      return current;
    }

    const divisionKey = normalizeProfileText(candidateUser?.division);
    const chiefName = String(candidateUser?.full_name || candidateUser?.username || "").trim();

    if (!divisionKey || !chiefName || current[divisionKey]) {
      return current;
    }

    return {
      ...current,
      [divisionKey]: chiefName,
    };
  }, {});
}

function resolveDivisionChiefSupervisor(profile, divisionChiefMap = {}) {
  const divisionKey = normalizeProfileText(profile?.department);
  return divisionChiefMap[divisionKey] || String(profile?.supervisor || "");
}

const sectionIcons = {
  personal: UserRound,
  family: UsersRound,
  education: GraduationCap,
  address: MapPin,
  government: IdCard,
  employment: Briefcase,
  emergency: LifeBuoy,
  documents: FolderOpen,
  signature: PenLine,
  security: ShieldCheck,
};

export default function ProfilePage({ user, onUserChange, initialTab = "" }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [profile, setProfile] = useState(null);
  const [employeeRecord, setEmployeeRecord] = useState(null);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [serviceRecordLoading, setServiceRecordLoading] = useState(false);
  const [serviceRecordError, setServiceRecordError] = useState("");
  const [divisionChiefMap, setDivisionChiefMap] = useState({});
  const [options, setOptions] = useState({ divisions: [], designations: [] });
  const [errors, setErrors] = useState({});
  const [savingSection, setSavingSection] = useState("");
  const [downloadingPdsFormat, setDownloadingPdsFormat] = useState("");
  const [pdsProfile, setPdsProfile] = useState(createEmptyPdsProfile);
  const [twoFactorProfile, setTwoFactorProfile] = useState(null);
  const [passwordExpiry, setPasswordExpiry] = useState(null);
  const [personalEditGate, setPersonalEditGate] = useState({ canEditDirectly: null, request: null });
  const [requestingPersonalEdit, setRequestingPersonalEdit] = useState(false);
  /*
   * One tab is mounted at a time, so a deep link is simply the tab to open on, and it can be applied
   * straight away instead of waiting for a section to exist in the DOM. A dialog target opens its
   * floating card and leaves the selected tab alone — the card renders once the profile has loaded.
   */
  const [requestedTarget] = useState(() => consumeRequestedProfileTab(initialTab));
  const [activeSection, setActiveSection] = useState(
    isProfileSectionId(requestedTarget) ? requestedTarget : profileSectionItems[0].id
  );
  const [openDialog, setOpenDialog] = useState(isProfileDialogId(requestedTarget) ? requestedTarget : "");
  const [readOnly, setReadOnly] = useState(true);
  /* A drawn or uploaded signature waiting for Save Changes; see SignatureSection. */
  const [pendingSignature, setPendingSignature] = useState(null);
  /* The profile as it was when Edit Profile was pressed: what Save compares against and Cancel restores. */
  const editSnapshotRef = useRef(null);
  const [profileImageOpen, setProfileImageOpen] = useState(false);
  const [regions, setRegions] = useState([]);
  const [allProvinces, setAllProvinces] = useState([]);
  const [allCities, setAllCities] = useState([]);
  const [allBarangays, setAllBarangays] = useState([]);
  const normalizedRole = resolveUserRoleKey(user);
  const canEditPersonalByRole = ["admin", "hrhead", "hrstaff"].includes(normalizedRole);

  const loadServiceRecords = useCallback(async ({ background = false } = {}) => {
    const employeeRecordId = employeeRecord?.id;

    if (!employeeRecordId) {
      setServiceRecords([]);
      setServiceRecordError("");
      setServiceRecordLoading(false);
      return;
    }

    if (!background) {
      setServiceRecordLoading(true);
    }

    try {
      const result = await fetchServiceRecord(employeeRecordId);
      setServiceRecords(Array.isArray(result?.records) ? result.records : []);
      setServiceRecordError("");
    } catch (requestError) {
      setServiceRecordError(
        requestError?.response?.data?.message || "Unable to load salary grade history."
      );
    } finally {
      setServiceRecordLoading(false);
    }
  }, [employeeRecord?.id]);

  useEffect(() => {
    void loadServiceRecords();
  }, [loadServiceRecords]);

  useAutoRefreshOnChange(loadServiceRecords, {
    enabled: Boolean(employeeRecord?.id),
    topics: ["service_record"],
    refreshOnMount: false,
  });

  const loadPersonalEditGate = useCallback(async () => {
    try {
      const result = await fetchProfileEditRequestStatus();

      setPersonalEditGate({
        canEditDirectly: Boolean(result?.canEditDirectly),
        request: result?.request || null,
      });
    } catch {
      setPersonalEditGate((current) => ({ ...current, request: null }));
    }
  }, []);

  useEffect(() => {
    void loadPersonalEditGate();
  }, [loadPersonalEditGate]);

  // module_access_requests is already part of this change-feed topic, so an approval on another
  // machine unlocks the open profile without creating a profile-specific database table.
  useAutoRefreshOnChange(loadPersonalEditGate, {
    topics: ["access_request"],
    refreshOnMount: false,
  });

  const personalEditRequest = personalEditGate.request;
  const canEditPersonalDirectly = personalEditGate.canEditDirectly ?? canEditPersonalByRole;
  const canRequestPersonalEdit = !canEditPersonalDirectly;
  /*
   * Personal Details opens with the rest of the profile under Edit Profile, and only for a desk that
   * may edit it directly or holds an approved edit request. It used to open on approval alone, with
   * its own Save button; now that Save Changes is the one save, it waits for edit mode too.
   */
  const personalEditUnlocked = !readOnly && (
    canEditPersonalDirectly || personalEditRequest?.status === "approved"
  );
  const personalReadOnly = !personalEditUnlocked;

  const handleRequestPersonalEdit = async () => {
    if (requestingPersonalEdit) {
      return;
    }

    setRequestingPersonalEdit(true);

    try {
      const result = await requestProfileEdit();
      setPersonalEditGate((current) => ({ ...current, request: result?.request || null }));
      toast.success(result?.message || "Your request has been sent to Admin and HR Head.");
    } catch (requestError) {
      toast.error(
        requestError?.response?.data?.message || "Unable to send the edit request. Please try again."
      );
    } finally {
      setRequestingPersonalEdit(false);
    }
  };

  const goToProfileTarget = useCallback((targetId) => {
    if (!isProfileTabId(targetId)) {
      return;
    }

    if (isProfileDialogId(targetId)) {
      setOpenDialog(targetId);
      return;
    }

    setActiveSection(targetId);
    // Switching tabs replaces the whole panel, so start it from the top the way a page change would.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const handleProfileTabRequest = (event) => {
      goToProfileTarget(event?.detail?.tabId);
    };

    window.addEventListener(PROFILE_TAB_REQUEST_EVENT, handleProfileTabRequest);

    return () => {
      window.removeEventListener(PROFILE_TAB_REQUEST_EVENT, handleProfileTabRequest);
    };
  }, [goToProfileTarget]);

  const storageKey = useMemo(
    () => getProfileStorageKey(user, employeeRecord),
    [employeeRecord, user]
  );

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      setLoading(true);
      setLoadError("");

      try {
        const [
          employeesResult,
          optionsResult,
          usersResult,
          twoFactorResult,
          passwordExpiryResult,
          pdsProfileResult,
        ] = await Promise.all([
          getEmployees(),
          getEmployeeOptions(),
          normalizedRole === "employee" ? getUsers().catch(() => null) : Promise.resolve(null),
          getTwoFactorProfile().catch(() => null),
          checkPasswordExpiry().catch(() => null),
          getPdsProfile().catch(() => createEmptyPdsProfile()),
        ]);

        // The address lists are imported above rather than fetched, so there is nothing to await or
        // to check for a failed response -- they are already in memory by the time this runs.

        if (!mounted) {
          return;
        }

        const employees = employeesResult.employees || [];
        const linkedEmployee = findEmployeeForUser(employees, user);
        const chiefMap = normalizedRole === "employee"
          ? buildDivisionChiefMap(usersResult?.users || [], user, linkedEmployee)
          : {};
        const scopedStorageKey = getProfileStorageKey(user, linkedEmployee);
        const extras = readProfileExtras(scopedStorageKey);
        const nextProfile = mergeEmployeeWithExtras(linkedEmployee, extras);

        if (linkedEmployee?.id) {
          try {
            const signatureResult = await getEmployeeSignature(linkedEmployee.id);
            const storedSignature = String(signatureResult?.employee?.signatureDataUrl || "");

            if (storedSignature !== "") {
              nextProfile.signatureDataUrl = storedSignature;
              nextProfile.signatureUploadName = nextProfile.signatureUploadName || "Saved signature";

              writeProfileExtras(scopedStorageKey, {
                ...extras,
                signatureDataUrl: storedSignature,
                signatureUploadName: nextProfile.signatureUploadName,
              });
            }
          } catch {
            // Keep the rest of the profile available even if the signature lookup fails.
          }
        }

        setEmployeeRecord(linkedEmployee);
        setDivisionChiefMap(chiefMap);
        setProfile(nextProfile);
        setOptions({
          divisions: optionsResult.divisions || [],
          designations: optionsResult.designations || [],
        });
        setTwoFactorProfile(twoFactorResult?.twoFactor || null);
        setPasswordExpiry(passwordExpiryResult?.passwordExpiry || null);
        setPdsProfile(pdsProfileResult);
        setRegions(Array.isArray(regionData) ? regionData : []);
        setAllProvinces(Array.isArray(provinceData) ? provinceData : []);
        setAllCities(Array.isArray(cityData) ? cityData : []);
        setAllBarangays(Array.isArray(barangayData) ? barangayData : []);
      } catch (error) {
        if (mounted) {
          setLoadError(error?.message || "Unable to load profile.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadProfile();
    return () => {
      mounted = false;
    };
  }, [normalizedRole, user]);

  const divisionOptions = useMemo(() => options.divisions || [], [options.divisions]);
  const designationOptions = useMemo(() => options.designations || [], [options.designations]);
  const filteredProvinces = useMemo(
    () => allProvinces.filter((item) => item.region_code === profile?.regionCode),
    [allProvinces, profile?.regionCode]
  );
  const filteredCities = useMemo(
    () => allCities.filter((item) => item.province_code === profile?.provinceCode),
    [allCities, profile?.provinceCode]
  );
  const filteredBarangays = useMemo(
    () => allBarangays.filter((item) => item.city_code === profile?.cityCode),
    [allBarangays, profile?.cityCode]
  );
  const filteredDesignations = useMemo(
    () => designationOptions.filter((item) => String(item.division_id) === String(profile?.divisionId || "")),
    [designationOptions, profile?.divisionId]
  );
  const resolvedProfile = useMemo(() => {
    if (!profile || normalizedRole !== "employee") {
      return profile;
    }

    const chiefSupervisorName = resolveDivisionChiefSupervisor(profile, divisionChiefMap);
    if (!chiefSupervisorName || chiefSupervisorName === profile.supervisor) {
      return profile;
    }

    return {
      ...profile,
      supervisor: chiefSupervisorName,
    };
  }, [divisionChiefMap, normalizedRole, profile]);
  const currentSalaryGradeRecord = useMemo(
    () => getCurrentSalaryGradeRecord(serviceRecords),
    [serviceRecords]
  );

  useEffect(() => {
    if (!profile || profile.regionCode || !profile.region) {
      return;
    }

    const match = regions.find((item) => item.region_name === profile.region);
    if (match) {
      setProfile((current) => ({ ...current, regionCode: match.region_code }));
    }
  }, [profile, regions]);

  useEffect(() => {
    if (!profile || profile.provinceCode || !profile.province) {
      return;
    }

    const match = allProvinces.find((item) => item.province_name === profile.province);
    if (match) {
      setProfile((current) => ({ ...current, provinceCode: match.province_code, regionCode: current.regionCode || match.region_code }));
    }
  }, [allProvinces, profile]);

  useEffect(() => {
    if (!profile || profile.cityCode || !profile.city) {
      return;
    }

    const match = allCities.find((item) => item.city_name === profile.city);
    if (match) {
      setProfile((current) => ({
        ...current,
        cityCode: match.city_code,
        provinceCode: current.provinceCode || match.province_code,
      }));
    }
  }, [allCities, profile]);

  const updateProfile = (updates) => {
    setProfile((current) => ({ ...current, ...updates }));
  };

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setErrors((current) => ({ ...current, [name]: "" }));

    if (name === "regionCode") {
      const selected = regions.find((item) => item.region_code === value);
      updateProfile({
        regionCode: value,
        region: selected?.region_name || "",
        provinceCode: "",
        province: "",
        cityCode: "",
        city: "",
        barangayCode: "",
        barangay: "",
      });
      return;
    }

    if (name === "provinceCode") {
      const selected = filteredProvinces.find((item) => item.province_code === value);
      updateProfile({
        provinceCode: value,
        province: selected?.province_name || "",
        cityCode: "",
        city: "",
        barangayCode: "",
        barangay: "",
      });
      return;
    }

    if (name === "cityCode") {
      const selected = filteredCities.find((item) => item.city_code === value);
      updateProfile({
        cityCode: value,
        city: selected?.city_name || "",
        barangayCode: "",
        barangay: "",
      });
      return;
    }

    if (name === "barangayCode") {
      const selected = filteredBarangays.find((item) => item.brgy_code === value);
      updateProfile({
        barangayCode: value,
        barangay: selected?.brgy_name || "",
      });
      return;
    }

    if (name === "divisionId") {
      const selected = divisionOptions.find((item) => String(item.id) === String(value));
      updateProfile({
        divisionId: value,
        department: selected?.name || "",
        designationId: "",
        position: "",
      });
      return;
    }

    if (name === "designationId") {
      const selected = filteredDesignations.find((item) => String(item.id) === String(value));
      updateProfile({
        designationId: value,
        position: selected?.name || "",
      });
      return;
    }

    if (GOVERNMENT_ID_FORMATS[name]) {
      updateProfile({ [name]: formatGovernmentId(name, value) });
      return;
    }

    updateProfile({ [name]: value });
  };

  /*
   * Edit Profile opens every tab; Save Changes saves them together. Each tab is compared with the
   * snapshot taken when editing began, so only the tabs that changed are validated and sent -- an
   * untouched Personal Details tab never spends the edit approval that saving it would use up.
   */
  const handleStartEditing = () => {
    if (!profile) {
      return;
    }

    editSnapshotRef.current = { profile, pdsProfile };
    setPendingSignature(null);
    setReadOnly(false);
  };

  const handleCancelEditing = () => {
    const snapshot = editSnapshotRef.current;

    if (snapshot) {
      // The photo and the email are saved the moment they change, so their current values stay.
      setProfile((current) => ({ ...snapshot.profile, ...pickFields(current, SAVED_ONE_BY_ONE_FIELDS) }));
      setPdsProfile(snapshot.pdsProfile);
    }

    editSnapshotRef.current = null;
    setPendingSignature(null);
    setErrors({});
    setReadOnly(true);
  };

  const persistSignature = async ({ dataUrl, uploadName }, baseProfile) => {
    const nextProfile = {
      ...baseProfile,
      signatureDataUrl: dataUrl,
      signatureUploadName: dataUrl ? (uploadName || baseProfile.signatureUploadName || "") : "",
    };

    // An account with no employee record keeps its signature in this browser only, as before.
    if (!employeeRecord?.id) {
      return nextProfile;
    }

    const result = await updateEmployeeSignature(employeeRecord.id, dataUrl);
    const storedSignature = String(result?.employee?.signatureDataUrl || dataUrl || "");

    return {
      ...nextProfile,
      signatureDataUrl: storedSignature,
      signatureUploadName: storedSignature ? (nextProfile.signatureUploadName || "Saved signature") : "",
    };
  };

  /* Resolves true once the profile is saved (or had nothing to save), false when it stays in edit mode. */
  const handleSaveProfile = async () => {
    if (!profile || savingSection) {
      return false;
    }

    const snapshot = editSnapshotRef.current || { profile, pdsProfile };
    const changed = {
      personal: fieldsChanged(PERSONAL_FIELDS, profile, snapshot.profile),
      address: fieldsChanged(ADDRESS_FIELDS, profile, snapshot.profile),
      government: fieldsChanged(GOVERNMENT_FIELDS, profile, snapshot.profile),
      emergency: fieldsChanged(EMERGENCY_FIELDS, profile, snapshot.profile),
      family: JSON.stringify(pdsProfile.family) !== JSON.stringify(snapshot.pdsProfile.family),
      education: JSON.stringify(pdsProfile.education) !== JSON.stringify(snapshot.pdsProfile.education),
      signature: pendingSignature !== null,
    };

    const validatedSections = ["personal", "address", "government", "emergency"].filter((section) => changed[section]);
    const sectionErrors = validatedSections.map((section) => [section, validateSection(section, profile)]);
    const nextErrors = Object.assign({}, ...sectionErrors.map(([, found]) => found));

    setErrors((current) => ({
      ...validatedSections.reduce((remaining, section) => clearSectionErrors(section, remaining), current),
      ...nextErrors,
    }));

    if (Object.keys(nextErrors).length > 0) {
      // Open the first tab with a problem, so the highlighted field is on screen.
      const [firstSection] = sectionErrors.find(([, found]) => Object.keys(found).length > 0);
      goToProfileTarget(firstSection);
      toast.error(Object.values(nextErrors)[0] || "Please correct the highlighted fields.");
      return false;
    }

    if (!Object.values(changed).some(Boolean)) {
      editSnapshotRef.current = null;
      setReadOnly(true);
      toast("No changes to save.");
      return true;
    }

    setSavingSection("all");

    try {
      let workingProfile = profile;

      // One write carries all three: the endpoint saves the whole row either way.
      if (changed.personal || changed.address || changed.government) {
        if (!employeeRecord?.id) {
          throw new Error("This account is not linked to an employee master record yet.");
        }

        const result = await updateEmployee(employeeRecord.id, {
          ...buildEmployeePayload(profile),
          profileSection: changed.personal ? "personal" : changed.address ? "address" : "government",
        });
        const nextEmployee = result.employee;
        workingProfile = mergeEmployeeWithExtras(nextEmployee, extractProfileExtras(profile));
        setEmployeeRecord(nextEmployee);
        setProfile(workingProfile);
        editSnapshotRef.current = {
          ...snapshot,
          profile: { ...snapshot.profile, ...pickFields(workingProfile, [...PERSONAL_FIELDS, ...ADDRESS_FIELDS, ...GOVERNMENT_FIELDS]) },
        };

        if (onUserChange) {
          onUserChange(buildUpdatedSessionUser(user, nextEmployee));
        }

        if (changed.personal && personalEditRequest?.status === "approved") {
          setPersonalEditGate((current) => ({
            ...current,
            request: current.request ? { ...current.request, status: "used" } : null,
          }));
        }
      }

      if (changed.family || changed.education) {
        if (!employeeRecord?.id) {
          throw new Error("This account is not linked to an employee master record yet.");
        }

        let savedPds = pdsProfile;

        if (changed.family) {
          const result = await savePdsFamily(pdsProfile.family);
          savedPds = { family: result.family, education: pdsProfile.education };
        }

        if (changed.education) {
          const result = await savePdsEducation(pdsProfile.education);
          savedPds = { family: savedPds.family, education: result.education };
        }

        setPdsProfile(savedPds);
        editSnapshotRef.current = { ...(editSnapshotRef.current || snapshot), pdsProfile: savedPds };
      }

      if (changed.signature) {
        workingProfile = await persistSignature(pendingSignature, workingProfile);
        setProfile(workingProfile);
        setPendingSignature(null);
      }

      // Emergency contact and the other extras live in this browser, alongside the saved row.
      writeProfileExtras(storageKey, extractProfileExtras(workingProfile));

      editSnapshotRef.current = null;
      setReadOnly(true);
      toast.success("Profile changes saved.");
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to save your profile changes.");
      return false;
    } finally {
      setSavingSection("");
    }
  };

  /*
   * While Edit Profile is open, leaving for another page -- a sidebar link, the header, a breadcrumb --
   * asks first: save, discard, or stay. Reloading or closing the tab gets the browser's own prompt.
   * The refs let the guard, registered once per edit session, call the current handlers.
   */
  const saveProfileRef = useRef(handleSaveProfile);
  const cancelEditingRef = useRef(handleCancelEditing);
  saveProfileRef.current = handleSaveProfile;
  cancelEditingRef.current = handleCancelEditing;

  useEffect(() => {
    if (readOnly) {
      return undefined;
    }

    const unregister = registerNavigationGuard(async () => {
      const choice = await Swal.fire({
        title: "Finish editing your profile first",
        text: "You are still editing your profile. Save your changes or cancel editing before leaving this page.",
        icon: "warning",
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: "Save Changes",
        denyButtonText: "Cancel Editing",
        cancelButtonText: "Keep Editing",
        confirmButtonColor: "#D61E1E",
        denyButtonColor: "#475569",
        reverseButtons: true,
      });

      if (choice.isConfirmed) {
        return saveProfileRef.current();
      }

      if (choice.isDenied) {
        cancelEditingRef.current();
        return true;
      }

      return false;
    });

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [readOnly]);

  const handleDownloadPds = async (format = "xlsx") => {
    if (downloadingPdsFormat) {
      return;
    }

    setDownloadingPdsFormat(format);
    const toastId = toast.loading(format === "pdf" ? "Preparing your Personal Data Sheet PDF..." : "Preparing your Personal Data Sheet...");

    try {
      await downloadPersonalDataSheet(resolvedProfile || profile, { format });
      toast.success(format === "pdf" ? "Personal Data Sheet PDF downloaded." : "Personal Data Sheet downloaded.", { id: toastId });
    } catch (error) {
      toast.error(error?.message || "Unable to download your Personal Data Sheet.", { id: toastId });
    } finally {
      setDownloadingPdsFormat("");
    }
  };

  const handlePdsFamilyChange = (event) => {
    const { name, value } = event.target;
    setPdsProfile((current) => ({
      ...current,
      family: {
        ...current.family,
        [name]: value,
      },
    }));
  };

  const handlePdsChildChange = (index, field, value) => {
    setPdsProfile((current) => ({
      ...current,
      family: {
        ...current.family,
        children: current.family.children.map((child, childIndex) => (
          childIndex === index ? { ...child, [field]: value } : child
        )),
      },
    }));
  };

  const handleAddPdsChild = () => {
    setPdsProfile((current) => {
      if (current.family.children.length >= 12) {
        return current;
      }

      return {
        ...current,
        family: {
          ...current.family,
          children: [
            ...current.family.children,
            { id: `new-${Date.now()}`, fullName: "", dateOfBirth: "" },
          ],
        },
      };
    });
  };

  const handleRemovePdsChild = (index) => {
    setPdsProfile((current) => ({
      ...current,
      family: {
        ...current.family,
        children: current.family.children.filter((_, childIndex) => childIndex !== index),
      },
    }));
  };

  const handlePdsEducationChange = (level, field, value) => {
    setPdsProfile((current) => ({
      ...current,
      education: current.education.map((record) => (
        record.level === level ? { ...record, [field]: value } : record
      )),
    }));
  };

  const handleTogglePersonalTwoFactor = async () => {
    const nextEnabled = !Boolean(twoFactorProfile?.personalEnabled);
    setSavingSection("security");

    try {
      const result = await saveTwoFactorProfile({
        personalEnabled: nextEnabled,
      });

      setTwoFactorProfile(result.twoFactor || null);

      if (result.user && onUserChange) {
        onUserChange(result.user);
      }

      toast.success(nextEnabled ? "Personal 2FA enabled." : "Personal 2FA disabled.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to update personal 2FA.");
    } finally {
      setSavingSection("");
    }
  };

  const handleVerifiedEmailChange = useCallback((nextUser) => {
    const nextEmail = String(nextUser?.email || "").trim();

    if (nextEmail) {
      setProfile((current) => (current ? { ...current, email: nextEmail } : current));
      setEmployeeRecord((current) => (current ? { ...current, email: nextEmail } : current));
    }

    onUserChange?.(nextUser);
  }, [onUserChange]);

  const handleSaveProfileImage = (imageDataUrl) => {
    if (!profile || !employeeRecord?.id) {
      toast.error("This account must be linked to an employee record before saving a profile picture.");
      return;
    }

    const saveProfileImage = async () => {
      const loadingToastId = toast.loading(imageDataUrl ? "Uploading profile picture..." : "Removing profile picture...");

      try {
        const result = await updateEmployeeProfileImage(employeeRecord.id, imageDataUrl);
        const nextEmployee = result.employee;
        const nextProfile = mergeEmployeeWithExtras(nextEmployee, extractProfileExtras(profile));

        setEmployeeRecord(nextEmployee);
        setProfile(nextProfile);
        writeProfileExtras(storageKey, extractProfileExtras(nextProfile));

        if (onUserChange) {
          onUserChange(buildUpdatedSessionUser(user, nextEmployee));
        }

        toast.success(imageDataUrl ? "Profile picture updated." : "Profile picture removed.", {
          id: loadingToastId,
        });
      } catch (error) {
        toast.error(error?.response?.data?.message || error?.message || "Unable to save the profile picture.", {
          id: loadingToastId,
        });
      }
    };

    saveProfileImage();
  };

  const navSections = useMemo(
    () => profileSectionItems.map((section) => ({ ...section, icon: sectionIcons[section.id] })),
    []
  );

  if (loading) {
    return (
      <div className="profile-loading-card grid min-h-[420px] place-items-center rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="text-center">
          <LoaderCircle className="profile-loading-icon mx-auto animate-spin text-[#D61E1E]" size={30} />
          <p className="m-0 mt-3 text-sm font-semibold text-slate-700">Loading profile workspace...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="profile-error-card rounded-[28px] border border-[#F8BFBF] bg-[#FEF1F1] p-4 text-[#B41818] shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="profile-error-icon mt-0.5 text-[#D61E1E]" size={20} />
          <div>
            <p className="m-0 text-sm font-semibold">Unable to load profile data</p>
            <p className="m-0 mt-2 text-sm">{loadError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="profile-page min-w-0 w-full">
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 sm:gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ProfileHeaderCard
          className="lg:sticky lg:top-20 lg:self-start"
          profile={profile}
          readOnly={readOnly}
          user={user}
          onEdit={handleStartEditing}
          onSave={handleSaveProfile}
          onCancel={handleCancelEditing}
          saving={savingSection === "all"}
          onChangePhoto={() => !readOnly && setProfileImageOpen(true)}
          onDownloadPds={() => handleDownloadPds("xlsx")}
          downloadingPds={downloadingPdsFormat === "xlsx"}
          onDownloadPdsPdf={() => handleDownloadPds("pdf")}
          downloadingPdsPdf={downloadingPdsFormat === "pdf"}
          salaryGradeRecord={currentSalaryGradeRecord}
          salaryGradeLoading={serviceRecordLoading}
          salaryGradeError={serviceRecordError}
          onOpenSalaryGradeHistory={() => setOpenDialog("salaryGradeHistory")}
        />

        <div className="grid min-w-0 gap-3 sm:gap-4">
          <ProfileSectionNav
            sections={navSections}
            activeSection={activeSection}
            onSelect={goToProfileTarget}
          />

          {/*
            * One panel per tab. Only the selected one is mounted, so the page stays the length of a single
            * section instead of one long scroll through all seven, and each tab's fields start at the top.
            */}
          <div className="profile-sections min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="min-w-0 space-y-3 sm:space-y-4"
              >
            {activeSection === "personal" ? (
              <PersonalDetailsSection
                values={resolvedProfile}
                errors={errors}
                readOnly={personalReadOnly}
                saving={savingSection === "personal"}
                onChange={handleFieldChange}
                canRequestEdit={canRequestPersonalEdit}
                editRequest={personalEditRequest}
                requestingEdit={requestingPersonalEdit}
                onRequestEdit={handleRequestPersonalEdit}
              />
            ) : null}

            {activeSection === "address" ? (
              <AddressSection
                values={resolvedProfile}
                errors={errors}
                readOnly={readOnly}
                saving={savingSection === "address"}
                onChange={handleFieldChange}
                regionOptions={regions}
                provinceOptions={filteredProvinces}
                cityOptions={filteredCities}
                barangayOptions={filteredBarangays}
              />
            ) : null}

            {activeSection === "family" ? (
              <FamilyBackgroundSection
                values={pdsProfile.family}
                readOnly={readOnly}
                saving={savingSection === "family"}
                onChange={handlePdsFamilyChange}
                onChildChange={handlePdsChildChange}
                onAddChild={handleAddPdsChild}
                onRemoveChild={handleRemovePdsChild}
              />
            ) : null}

            {activeSection === "education" ? (
              <EducationalBackgroundSection
                values={pdsProfile.education}
                readOnly={readOnly}
                saving={savingSection === "education"}
                onChange={handlePdsEducationChange}
              />
            ) : null}

            {activeSection === "government" ? (
              <GovernmentIdsSection
                values={resolvedProfile}
                errors={errors}
                readOnly={readOnly}
                saving={savingSection === "government"}
                onChange={handleFieldChange}
              />
            ) : null}

            {activeSection === "employment" ? (
              <EmploymentStatusSection
                values={resolvedProfile}
                divisionOptions={divisionOptions}
                designationOptions={filteredDesignations}
              />
            ) : null}

            {activeSection === "emergency" ? (
              <EmergencyContactSection
                values={resolvedProfile}
                errors={errors}
                readOnly={readOnly}
                saving={savingSection === "emergency"}
                onChange={handleFieldChange}
              />
            ) : null}

            {activeSection === "documents" ? (
              <DocumentsSection readOnly={readOnly} />
            ) : null}

            {activeSection === "signature" ? (
              <SignatureSection
                values={resolvedProfile}
                readOnly={readOnly}
                error={errors.signatureDataUrl}
                pendingSignature={pendingSignature}
                onPendingSignatureChange={setPendingSignature}
              />
            ) : null}

            {/* Password change sits with Security — both are account credentials, not employee data. */}
            {activeSection === "security" ? (
              <>
                <SecuritySection
                  twoFactor={twoFactorProfile}
                  passwordExpiry={passwordExpiry}
                  saving={savingSection === "security"}
                  onTogglePersonalTwoFactor={handleTogglePersonalTwoFactor}
                />

                <PasswordChangeSection />

                <ProfileEmailChangeSection onUserChange={handleVerifiedEmailChange} />
              </>
            ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <ProfileFloatingCard
        open={openDialog === "salaryGradeHistory"}
        onClose={() => setOpenDialog("")}
        icon={History}
        badge={BadgeCheck}
        title="Salary Grade History"
        subtitle="Review the employee’s salary grade and step increment across service appointments."
        maxWidth="max-w-4xl"
        bodyClassName="px-4 pb-4 sm:px-5 sm:pb-5"
        closeLabel="Close salary grade history"
      >
        <SalaryGradeHistory
          records={serviceRecords}
          loading={serviceRecordLoading}
          error={serviceRecordError}
        />
      </ProfileFloatingCard>

      <ProfileImageModal
        open={profileImageOpen}
        currentImage={profile.profileImage}
        onClose={() => setProfileImageOpen(false)}
        onSave={handleSaveProfileImage}
      />
    </div>
  );
}
