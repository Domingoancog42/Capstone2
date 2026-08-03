import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  IdCard,
  LifeBuoy,
  LoaderCircle,
  MapPin,
  PenLine,
  ScrollText,
  ShieldCheck,
  UserRound,
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
  isProfileTabId,
  mergeEmployeeWithExtras,
  normalizeProfileText,
  profileSectionAnchorId,
  profileSectionItems,
  PROFILE_TAB_REQUEST_EVENT,
  readProfileExtras,
  writeProfileExtras,
} from "./profileUtils";
import { normalizeRole } from "../../utils/roleRoutes";
import PersonalDetailsSection from "./sections/PersonalDetailsSection";
import AddressSection from "./sections/AddressSection";
import GovernmentIdsSection from "./sections/GovernmentIdsSection";
import EmploymentStatusSection from "./sections/EmploymentStatusSection";
import ServiceRecordSection from "./sections/ServiceRecordSection";
import EmergencyContactSection from "./sections/EmergencyContactSection";
import SignatureSection from "./sections/SignatureSection";
import SecuritySection from "./sections/SecuritySection";
import PasswordChangeSection from "./sections/PasswordChangeSection";

const addressBasePath = `${process.env.PUBLIC_URL || ""}/philippines-addresses`;

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
  address: MapPin,
  government: IdCard,
  employment: Briefcase,
  emergency: LifeBuoy,
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
  const [twoFactorProfile, setTwoFactorProfile] = useState(null);
  const [passwordExpiry, setPasswordExpiry] = useState(null);
  const [activeSection, setActiveSection] = useState(profileSectionItems[0].id);
  const [openDialog, setOpenDialog] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [profileImageOpen, setProfileImageOpen] = useState(false);
  const [regions, setRegions] = useState([]);
  const [allProvinces, setAllProvinces] = useState([]);
  const [allCities, setAllCities] = useState([]);
  const [allBarangays, setAllBarangays] = useState([]);
  const normalizedRole = normalizeRole(user?.roleKey || user?.role);
  const canEditEmploymentSection = ["admin", "hrhead", "hrstaff"].includes(normalizedRole);

  // A deep link that arrives before the profile finishes loading is replayed once the sections mount.
  const [requestedTarget] = useState(() => consumeRequestedProfileTab(initialTab));
  const pendingTargetRef = useRef(requestedTarget);

  const goToProfileTarget = useCallback((targetId, { smooth = true } = {}) => {
    if (!isProfileTabId(targetId)) {
      return;
    }

    if (isProfileDialogId(targetId)) {
      setOpenDialog(targetId);
      return;
    }

    const anchor = document.getElementById(profileSectionAnchorId(targetId));

    if (!anchor) {
      pendingTargetRef.current = targetId;
      return;
    }

    setActiveSection(targetId);
    anchor.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
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
          regionResponse,
          provinceResponse,
          cityResponse,
          barangayResponse,
        ] = await Promise.all([
          getEmployees(),
          getEmployeeOptions(),
          normalizedRole === "employee" ? getUsers().catch(() => null) : Promise.resolve(null),
          getTwoFactorProfile().catch(() => null),
          checkPasswordExpiry().catch(() => null),
          fetch(`${addressBasePath}/region.json`),
          fetch(`${addressBasePath}/province.json`),
          fetch(`${addressBasePath}/city.json`),
          fetch(`${addressBasePath}/barangay.json`),
        ]);

        if (![regionResponse, provinceResponse, cityResponse, barangayResponse].every((response) => response.ok)) {
          throw new Error("Unable to load address options.");
        }

        const [regionData, provinceData, cityData, barangayData] = await Promise.all([
          regionResponse.json(),
          provinceResponse.json(),
          cityResponse.json(),
          barangayResponse.json(),
        ]);

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

  const sectionsReady = !loading && !loadError && Boolean(profile);

  useEffect(() => {
    if (!sectionsReady || !pendingTargetRef.current) {
      return;
    }

    const target = pendingTargetRef.current;
    pendingTargetRef.current = "";
    // Jump rather than glide: the reader asked for this section before the page even existed.
    goToProfileTarget(target, { smooth: false });
  }, [goToProfileTarget, sectionsReady]);

  useEffect(() => {
    if (!sectionsReady || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const anchors = profileSectionItems
      .map((section) => document.getElementById(profileSectionAnchorId(section.id)))
      .filter(Boolean);

    if (anchors.length === 0) {
      return undefined;
    }

    const intersecting = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            intersecting.add(entry.target.id);
          } else {
            intersecting.delete(entry.target.id);
          }
        });

        // Topmost section touching the band under the sticky nav wins, so the highlight tracks reading order.
        const current = profileSectionItems.find((section) => intersecting.has(profileSectionAnchorId(section.id)));

        if (current) {
          setActiveSection(current.id);
        }
      },
      { rootMargin: "-190px 0px -68% 0px", threshold: 0 }
    );

    anchors.forEach((anchor) => observer.observe(anchor));

    return () => observer.disconnect();
  }, [sectionsReady]);

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

  const navActions = useMemo(
    () => [
      {
        id: "serviceRecord",
        label: "Service Record",
        icon: ScrollText,
        onClick: () => setOpenDialog("serviceRecord"),
      },
    ],
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
    <div className="profile-page space-y-4">
      <ProfileHeaderCard
        profile={profile}
        readOnly={readOnly}
        user={user}
        onToggleMode={() => setReadOnly((current) => !current)}
        onChangePhoto={() => !readOnly && setProfileImageOpen(true)}
        onOpenServiceRecord={() => setOpenDialog("serviceRecord")}
      />

      <ProfileSectionNav
        sections={navSections}
        activeSection={activeSection}
        onSelect={goToProfileTarget}
        actions={navActions}
      />

      <div className="profile-sections space-y-4">
        <PersonalDetailsSection
          values={resolvedProfile}
          errors={errors}
          readOnly={readOnly}
          saving={savingSection === "personal"}
          onChange={handleFieldChange}
          onSave={() => handleSaveSection("personal")}
        />

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

        <GovernmentIdsSection
          values={resolvedProfile}
          errors={errors}
          readOnly={readOnly}
          saving={savingSection === "government"}
          onChange={handleFieldChange}
          onSave={() => handleSaveSection("government")}
        />

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

        <EmergencyContactSection
          values={resolvedProfile}
          errors={errors}
          readOnly={readOnly}
          saving={savingSection === "emergency"}
          onChange={handleFieldChange}
          onSave={() => handleSaveSection("emergency")}
        />

        <SignatureSection
          values={resolvedProfile}
          readOnly={readOnly}
          saving={savingSection === "signature"}
          error={errors.signatureDataUrl}
          onSave={handleSaveSignature}
        />

        <SecuritySection
          twoFactor={twoFactorProfile}
          passwordExpiry={passwordExpiry}
          saving={savingSection === "security"}
          onTogglePersonalTwoFactor={handleTogglePersonalTwoFactor}
        />

        <PasswordChangeSection />
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
