import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  FolderOpen,
  GraduationCap,
  IdCard,
  LifeBuoy,
  LoaderCircle,
  MapPin,
  PenLine,
  ScrollText,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "react-hot-toast";
import {
  getEmployeeOptions,
  getEmployees,
  getEmployeeSignature,
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
  markProfileEditUsed,
  requestProfileEdit,
} from "../../services/profileEditRequestService";
import ProfileFloatingCard from "./ProfileFloatingCard";
import ProfileHeaderCard from "./ProfileHeaderCard";
import ProfileImageModal from "./ProfileImageModal";
import ProfileSectionNav from "./ProfileSectionNav";
import {
  buildEmployeePayload,
  buildUpdatedSessionUserFromProfile,
  buildUpdatedSessionUser,
  consumeRequestedProfileTab,
  extractProfileExtras,
  findEmployeeForUser,
  getProfileStorageKey,
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
import { normalizeRole, resolveUserRoleKey } from "../../utils/roleRoutes";
import PersonalDetailsSection from "./sections/PersonalDetailsSection";
import AddressSection from "./sections/AddressSection";
import GovernmentIdsSection from "./sections/GovernmentIdsSection";
import EmploymentStatusSection from "./sections/EmploymentStatusSection";
import ServiceRecordSection from "./sections/ServiceRecordSection";
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
    employment: ["employmentType", "employmentStatus", "dateHired", "divisionId", "designationId", "supervisor"],
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

  if (section === "employment") {
    if (!profile.employmentType) nextErrors.employmentType = "Employment type is required.";
    if (!profile.employmentStatus) nextErrors.employmentStatus = "Employment status is required.";
    if (!profile.dateHired) nextErrors.dateHired = "Date hired is required.";
    if (!profile.divisionId) nextErrors.divisionId = "Division is required.";
    if (!profile.designationId) nextErrors.designationId = "Designation is required.";
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
    if (normalizeRole(candidateUser?.role) !== "chief") {
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
  const [divisionChiefMap, setDivisionChiefMap] = useState({});
  const [options, setOptions] = useState({ divisions: [], designations: [] });
  const [errors, setErrors] = useState({});
  const [savingSection, setSavingSection] = useState("");
  const [downloadingPds, setDownloadingPds] = useState(false);
  const [pdsProfile, setPdsProfile] = useState(createEmptyPdsProfile);
  const [twoFactorProfile, setTwoFactorProfile] = useState(null);
  const [passwordExpiry, setPasswordExpiry] = useState(null);
  /*
   * Personal Details is the one section the employee does not own. It stays locked until an HR Head
   * or Admin approves a request, and the approval covers a single save.
   *
   * The canEditDirectly flag comes from the endpoint rather than being decided here, so
   * the lock on screen and the one the API enforces can never disagree about who is subject to it.
   */
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
  const [profileImageOpen, setProfileImageOpen] = useState(false);
  const [regions, setRegions] = useState([]);
  const [allProvinces, setAllProvinces] = useState([]);
  const [allCities, setAllCities] = useState([]);
  const [allBarangays, setAllBarangays] = useState([]);
  const normalizedRole = resolveUserRoleKey(user);
  const canEditEmploymentSection = ["admin", "hrhead", "hrstaff"].includes(normalizedRole);

  const loadPersonalEditGate = useCallback(async () => {
    try {
      const result = await fetchProfileEditRequestStatus();

      setPersonalEditGate({
        canEditDirectly: Boolean(result?.canEditDirectly),
        request: result?.request || null,
      });
    } catch {
      /*
       * A failed read leaves the section locked with no request on it, which is the safe end of the
       * gate: the worst case is one wasted press of Request Edit, answered by the request that
       * already exists.
       */
      setPersonalEditGate((current) => ({ ...current, request: null }));
    }
  }, []);

  useEffect(() => {
    void loadPersonalEditGate();
  }, [loadPersonalEditGate]);

  /*
   * HR decides the request on their own machine. Only the gate is re-read here -- reloading the
   * profile itself would throw away whatever the user has typed into another section.
   */
  useAutoRefreshOnChange(loadPersonalEditGate, {
    topics: ["profile_edit_request"],
    refreshOnMount: false,
  });

  const personalEditRequest = personalEditGate.request;
  /*
   * null means the gate has not answered yet -- or could not. Falling back to the role keeps HR out
   * of a lock that was never meant for them: they edit these fields from Employee Management, and a
   * failed status read must not strand them behind a request the API would refuse anyway.
   */
  const canEditPersonalDirectly = personalEditGate.canEditDirectly ?? canEditEmploymentSection;
  const canRequestPersonalEdit = !canEditPersonalDirectly;
  const personalEditUnlocked = canEditPersonalDirectly
    ? !readOnly
    : personalEditRequest?.status === "approved";
  const personalReadOnly = !personalEditUnlocked;

  /** Sends the reason typed into the floating card. Resolves true once the card may close. */
  const handleRequestPersonalEdit = async (reason) => {
    if (requestingPersonalEdit) {
      return false;
    }

    setRequestingPersonalEdit(true);

    try {
      const result = await requestProfileEdit({ reason });

      setPersonalEditGate((current) => ({ ...current, request: result?.request || null }));
      toast.success(result?.message || "Your request has been sent to HR.");

      return true;
    } catch (requestError) {
      toast.error(
        requestError?.response?.data?.message || "Unable to send the request. Please try again."
      );

      return false;
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

    updateProfile({ [name]: value });
  };

  const handleSaveSection = async (section) => {
    if (!profile) {
      return;
    }

    if (section === "employment" && !canEditEmploymentSection) {
      toast.error("Only HR or Admin can edit employment status details.");
      return;
    }

    if (section === "personal" && personalReadOnly) {
      toast.error("Personal details are locked. Ask HR to unlock the section first.");
      return;
    }

    const nextErrors = validateSection(section, profile);
    setErrors((current) => ({
      ...clearSectionErrors(section, current),
      ...nextErrors,
    }));

    if (Object.keys(nextErrors).length > 0) {
      toast.error("Please complete the required fields before saving.");
      return;
    }

    setSavingSection(section);

    try {
      let nextEmployee = employeeRecord;
      const extras = extractProfileExtras(profile);

      if (["personal", "address", "government"].includes(section)) {
        if (!employeeRecord?.id) {
          throw new Error("This account is not linked to an employee master record yet.");
        }

        const result = await updateEmployee(employeeRecord.id, buildEmployeePayload(profile));
        nextEmployee = result.employee;
        setEmployeeRecord(nextEmployee);
        setProfile((current) => mergeEmployeeWithExtras(nextEmployee, extractProfileExtras(current)));

        if (onUserChange) {
          onUserChange(buildUpdatedSessionUser(user, nextEmployee));
        }
      }

      if (section === "employment" && employeeRecord?.id) {
        const result = await updateEmployee(employeeRecord.id, buildEmployeePayload(profile));
        nextEmployee = result.employee;
        setEmployeeRecord(nextEmployee);
        setProfile((current) => mergeEmployeeWithExtras(nextEmployee, extractProfileExtras(current)));

        if (onUserChange) {
          onUserChange(buildUpdatedSessionUser(user, nextEmployee));
        }
      }

      /*
       * The approval is spent here rather than when it was granted: only now is the correction
       * actually written, and a save that failed above must leave the unlock intact for the retry.
       */
      if (section === "personal" && personalEditRequest?.status === "approved") {
        try {
          const spent = await markProfileEditUsed(personalEditRequest.id);

          setPersonalEditGate((current) => ({ ...current, request: spent?.request || null }));
        } catch {
          // The correction is already saved, so failing to close the request must not report an
          // error over it. The next gate read returns the same approved row and the lock recovers.
        }
      }

      writeProfileExtras(storageKey, extras);

      if (section === "employment" && !employeeRecord?.id && onUserChange) {
        onUserChange(buildUpdatedSessionUserFromProfile(user, profile));
      }

      toast.success("Profile section saved successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to save this section.");
    } finally {
      setSavingSection("");
    }
  };

  const handleDownloadPds = async () => {
    if (downloadingPds) {
      return;
    }

    setDownloadingPds(true);
    const toastId = toast.loading("Preparing your Personal Data Sheet...");

    try {
      await downloadPersonalDataSheet(resolvedProfile || profile);
      toast.success("Personal Data Sheet downloaded.", { id: toastId });
    } catch (error) {
      toast.error(error?.message || "Unable to download your Personal Data Sheet.", { id: toastId });
    } finally {
      setDownloadingPds(false);
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

  const handleSavePdsSection = async (section) => {
    if (!employeeRecord?.id) {
      toast.error("This account is not linked to an employee master record yet.");
      return;
    }

    setSavingSection(section);
    try {
      const result = section === "family"
        ? await savePdsFamily(pdsProfile.family)
        : await savePdsEducation(pdsProfile.education);

      setPdsProfile({ family: result.family, education: result.education });
      toast.success(result.message || "PDS profile section saved successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to save this PDS section.");
    } finally {
      setSavingSection("");
    }
  };

  const handleSaveSignature = async (dataUrl, uploadName) => {
    if (!profile) {
      return;
    }

    const nextProfile = {
      ...profile,
      signatureDataUrl: dataUrl,
      signatureUploadName: uploadName || profile.signatureUploadName || "",
    };

    // Skip validation if we're clearing the signature (empty dataUrl)
    if (dataUrl) {
      const nextErrors = validateSection("signature", nextProfile);
      setErrors((current) => ({
        ...clearSectionErrors("signature", current),
        ...nextErrors,
      }));

      if (Object.keys(nextErrors).length > 0) {
        toast.error("Please add a signature before saving.");
        return;
      }
    } else {
      // Clear any signature errors when clearing
      setErrors((current) => clearSectionErrors("signature", current));
    }

    setSavingSection("signature");

    try {
      let savedProfile = nextProfile;

      if (employeeRecord?.id) {
        const result = await updateEmployeeSignature(employeeRecord.id, nextProfile.signatureDataUrl);
        const storedSignature = String(result?.employee?.signatureDataUrl || nextProfile.signatureDataUrl || "");

        savedProfile = {
          ...nextProfile,
          signatureDataUrl: storedSignature,
          signatureUploadName: storedSignature ? (nextProfile.signatureUploadName || "Saved signature") : "",
        };
      }

      setProfile(savedProfile);
      writeProfileExtras(storageKey, extractProfileExtras(savedProfile));

      toast.success(
        dataUrl
          ? (employeeRecord?.id
            ? "Signature saved to the employee record."
            : "Signature saved locally. Link this account to an employee record to save it in the database.")
          : "Signature cleared successfully."
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Unable to save the signature.");
    } finally {
      setSavingSection("");
    }
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
    <div className="profile-page">
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ProfileHeaderCard
          className="lg:sticky lg:top-20 lg:self-start"
          profile={profile}
          readOnly={readOnly}
          user={user}
          onToggleMode={() => setReadOnly((current) => !current)}
          onChangePhoto={() => !readOnly && setProfileImageOpen(true)}
          onDownloadPds={handleDownloadPds}
          downloadingPds={downloadingPds}
          onOpenServiceRecord={() => setOpenDialog("serviceRecord")}
        />

        <div className="grid min-w-0 gap-4">
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
                className="space-y-4"
              >
            {activeSection === "personal" ? (
              <PersonalDetailsSection
                values={resolvedProfile}
                errors={errors}
                readOnly={personalReadOnly}
                saving={savingSection === "personal"}
                onChange={handleFieldChange}
                onSave={() => handleSaveSection("personal")}
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
                onSave={() => handleSaveSection("address")}
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
                onSave={() => handleSavePdsSection("family")}
              />
            ) : null}

            {activeSection === "education" ? (
              <EducationalBackgroundSection
                values={pdsProfile.education}
                readOnly={readOnly}
                saving={savingSection === "education"}
                onChange={handlePdsEducationChange}
                onSave={() => handleSavePdsSection("education")}
              />
            ) : null}

            {activeSection === "government" ? (
              <GovernmentIdsSection
                values={resolvedProfile}
                errors={errors}
                readOnly={readOnly}
                saving={savingSection === "government"}
                onChange={handleFieldChange}
                onSave={() => handleSaveSection("government")}
              />
            ) : null}

            {activeSection === "employment" ? (
              <EmploymentStatusSection
                values={resolvedProfile}
                errors={errors}
                readOnly={readOnly || !canEditEmploymentSection}
                canEditEmploymentSection={canEditEmploymentSection}
                saving={savingSection === "employment"}
                onChange={handleFieldChange}
                onSave={() => handleSaveSection("employment")}
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
                onSave={() => handleSaveSection("emergency")}
              />
            ) : null}

            {activeSection === "documents" ? (
              <DocumentsSection readOnly={readOnly} />
            ) : null}

            {activeSection === "signature" ? (
              <SignatureSection
                values={resolvedProfile}
                readOnly={readOnly}
                saving={savingSection === "signature"}
                error={errors.signatureDataUrl}
                onSave={handleSaveSignature}
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
        open={openDialog === "serviceRecord"}
        onClose={() => setOpenDialog("")}
        icon={ScrollText}
        badge={BadgeCheck}
        title="Service Record"
        subtitle="Chronological record of appointments, salaries, and separations (CS Form No. 1)."
        maxWidth="max-w-5xl"
        bodyClassName="px-4 pb-4 sm:px-4"
      >
        <ServiceRecordSection values={resolvedProfile} variant="dialog" />
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
