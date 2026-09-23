import { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI, jobseekerDocumentAPI, resolveAssetUrl, verificationAPI } from "../services/api";
import "../styles/profile.css";
import { FaUser, FaEnvelope, FaPhone, FaBriefcase, FaBuilding, FaMapMarkerAlt, FaCalendarAlt, FaUserGraduate, FaFileAlt, FaIdCard, FaTimes, FaPlus, FaSave, FaArrowLeft, FaEye, FaEyeSlash, FaMagic } from "react-icons/fa";
import LocationSelect from "../components/LocationSelect";
import LocationAutosuggest from "../components/LocationAutosuggest";
import Autosuggest from "../components/Autosuggest";
import SearchableDropdown from "../components/SearchableDropdown";
import FileDropzone from "../components/FileDropzone";
import EmailChangeCard from "../components/EmailChangeCard";
import { useToast } from "../components/feedback/context";
import { SUGGESTED_SKILLS, INDUSTRY_SKILLS } from "../data/skills";
import { usePersistentState } from "../hooks/usePersistentState";
import { parseHeightToCm, parseWeightToKg, wasConverted } from "../utils/unitConversion";
import { ALL_LOCATIONS } from "../utils/philippineLocations";
import { parseLocationValue } from "../utils/locationParser";
import marinduqueSchools from "../data/marinduque_schools.json";
import collegeCourses from "../data/philippine_college_courses.json";
import countriesData from "../data/countries.json";
import PH_JOB_TITLES from "../data/ph_job_titles_complete.json";
import { WORKFORCE_SIZE_OPTIONS } from "../data/employerProfile";

const COUNTRY_OPTIONS = countriesData.countries || [];

const RELIGIONS = [
  "Roman Catholic", "Islam", "Iglesia ni Cristo", "Evangelical", "Aglipayan (Philippine Independent Church)",
  "Seventh-day Adventist", "United Church of Christ in the Philippines (UCCP)", "Bible Baptist Church",
  "Jehovah's Witnesses", "Members Church of God International (Ang Dating Daan)", "United Pentecostal Church",
  "Church of Jesus Christ of Latter-day Saints", "Baptist", "United Methodist Church", "Born Again Christian",
  "Buddhist", "Philippine Benevolent Missionaries Association (PBMA)", "Others",
];

const SCHOOL_LEVEL_MAP = {
  "Elementary Graduate": "elementary_schools",
  "High School Graduate": "secondary_schools",
  "Senior High School Graduate": "secondary_schools",
  "Vocational / TESDA": "technical_vocational_schools",
  "College Undergraduate": "universities_colleges",
  "College Graduate": "universities_colleges",
  "Master's Degree": "universities_colleges",
  "Doctorate": "universities_colleges",
};

const getSchoolOptions = (attainment) => {
  const key = SCHOOL_LEVEL_MAP[attainment];
  if (!key || !marinduqueSchools[key]) return [];
  return marinduqueSchools[key].map((s) => s.name);
};

const COURSE_ATTAINMENTS = ["Vocational / TESDA", "College Undergraduate", "College Graduate", "Master's Degree", "Doctorate"];
const COURSE_CATEGORIES = collegeCourses.categories || {};
const VOCATIONAL_COURSES = COURSE_CATEGORIES["Technical-Vocational (TESDA) Programs"] || [];
const ALL_COURSES_FLAT = collegeCourses.all_courses_flat || [];
const COURSE_UNKNOWN_VALUE = "Undecided / Not sure yet";
const TECH_VOC_INSTITUTIONS = (marinduqueSchools.technical_vocational_schools || []).map((s) => s.name);
const LANGUAGE_SKILLS = [
  { key: "read", label: "Read" },
  { key: "write", label: "Write" },
  { key: "speak", label: "Speak" },
  { key: "understand", label: "Understand" },
];
const OTHER_OPTION = "__other__";
const emptyLanguageRow = () => ({ read: false, write: false, speak: false, understand: false });

const INDUSTRY_OPTIONS = [
  "Information Technology (IT)", "Healthcare", "Finance & Banking", "Education",
  "Construction & Engineering", "Manufacturing", "Retail & Wholesale", "Hospitality & Tourism",
  "Transportation & Logistics", "Agriculture", "Media & Communications", "Real Estate",
  "Government & Public Administration", "Legal Services", "Telecommunications",
  "Marketing & Advertising", "Arts & Entertainment", "Human Resources", "Customer Service",
  "Environmental Services", "Others"
];

// Initial empty state for formData
const initialFormData = {
  name: "",
  surname: "",
  firstName: "",
  middleName: "",
  suffix: "",
  email: "",
  about: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  gender: "",
  civilStatus: "",
  placeOfBirth: "",
  citizenship: "",
  height: "",
  weight: "",
  religion: "",
  sssGsisNo: "",
  pagibigNo: "",
  philhealthNo: "",
  landline: "",
  mobileSecondary: "",
  presentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
  permanentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
  disability: [],
  is4psBeneficiary: false,
  _4psHouseholdId: "",
  isOfw: false,
  isRepatriated: false,
  repatriationIntent: "",
  passportNo: "",
  passportExpiryDate: "",
  employmentStatus: "",
  employmentType: "",
  unemploymentReason: "",
  laidoffCountry: "",
  desiredJobTitle: "",
  preferredOccupations: [],
  preferredWorkLocationLocal: [],
  preferredWorkLocationOverseas: [],
  expectedSalaryMin: "",
  expectedSalaryMax: "",
  workExperience: "",
  educationalAttainment: "",
  schoolAttended: "",
  schoolAttendedOther: "",
  course: "",
  yearGraduated: "",
  languageProficiency: {
    English: emptyLanguageRow(),
    Filipino: emptyLanguageRow(),
    Others: emptyLanguageRow(),
  },
  languageOthersLabel: "",
  workHistory: [],
  vocationalTrainings: [],
  eligibilities: [],
  professionalLicenses: [],
  availabilityStatus: "",
  companyName: "",
  industry: "",
  companySize: "",
  website: "",
  companyDescription: "",
  businessAddress: "",
  tradeName: "",
  acronym: "",
  tin: "",
  officeType: "",
  employerClassificationType: "",
  employerClassificationSubtype: "",
  totalWorkforceSize: "",
  ownerName: "",
  contactPersonName: "",
  contactPersonPosition: "",
  fax: "",
  businessAddressStructured: { street: "", barangay: "", municipality: "", province: "", region: "" },
};

// Maps a merged (user + role profile) API object onto the flat formData shape.
// Shared by the initial fetch-on-mount load and the post-submit refresh.
const mapMergedToFormData = (merged) => ({
  ...initialFormData,
  name: merged.name || "",
  surname: merged.surname || "",
  firstName: merged.firstName || "",
  middleName: merged.middleName || "",
  suffix: merged.suffix || "",
  email: merged.email || "",
  about: merged.about || "",
  phone: merged.phone || "",
  address: merged.address || "",
  businessAddress: merged.businessAddress || merged.address || "",
  dateOfBirth: merged.dateOfBirth ? String(merged.dateOfBirth).slice(0, 10) : "",
  gender: merged.gender || "",
  desiredJobTitle: merged.desiredJobTitle || "",
  preferredOccupations: Array.isArray(merged.preferredOccupations) ? merged.preferredOccupations : [],
  preferredWorkLocationLocal: Array.isArray(merged.preferredWorkLocationLocal) ? merged.preferredWorkLocationLocal : [],
  preferredWorkLocationOverseas: Array.isArray(merged.preferredWorkLocationOverseas) ? merged.preferredWorkLocationOverseas : [],
  expectedSalaryMin: merged.expectedSalaryMin ?? "",
  expectedSalaryMax: merged.expectedSalaryMax ?? "",
  workExperience: merged.workExperience || "",
  educationalAttainment: merged.educationalAttainment || "",
  schoolAttended: merged.schoolAttended || "",
  schoolAttendedOther: merged.schoolAttendedOther || "",
  course: merged.course || "",
  yearGraduated: merged.yearGraduated || "",
  languageProficiency: {
    English: { ...emptyLanguageRow(), ...(merged.languageProficiency?.English || {}) },
    Filipino: { ...emptyLanguageRow(), ...(merged.languageProficiency?.Filipino || {}) },
    Others: { ...emptyLanguageRow(), ...(merged.languageProficiency?.Others || {}) },
  },
  languageOthersLabel: merged.languageOthersLabel || "",
  workHistory: Array.isArray(merged.workHistory) ? merged.workHistory : [],
  vocationalTrainings: Array.isArray(merged.vocationalTrainings) ? merged.vocationalTrainings : [],
  eligibilities: Array.isArray(merged.eligibilities) ? merged.eligibilities : [],
  professionalLicenses: Array.isArray(merged.professionalLicenses) ? merged.professionalLicenses : [],
  availabilityStatus: merged.availabilityStatus || "",
  companyName: merged.companyName || "",
  industry: merged.industry || "",
  companySize: merged.companySize || "",
  website: merged.website || "",
  companyDescription: merged.companyDescription || "",
  civilStatus: merged.civilStatus || "",
  placeOfBirth: merged.placeOfBirth || "",
  citizenship: merged.citizenship || "",
  height: merged.height || "",
  weight: merged.weight || "",
  religion: merged.religion || "",
  sssGsisNo: merged.sssGsisNo || "",
  pagibigNo: merged.pagibigNo || "",
  philhealthNo: merged.philhealthNo || "",
  landline: merged.landline || "",
  mobileSecondary: merged.mobileSecondary || "",
  presentAddress: merged.presentAddress || { street: "", barangay: "", municipality: "", province: "", region: "" },
  permanentAddress: merged.permanentAddress || { street: "", barangay: "", municipality: "", province: "", region: "" },
  disability: merged.disability || [],
  is4psBeneficiary: merged.is4psBeneficiary || false,
  _4psHouseholdId: merged._4psHouseholdId || "",
  isOfw: merged.isOfw || false,
  isRepatriated: merged.isRepatriated || false,
  repatriationIntent: merged.repatriationIntent || "",
  passportNo: merged.passportNo || "",
  passportExpiryDate: merged.passportExpiryDate ? String(merged.passportExpiryDate).slice(0, 10) : "",
  employmentStatus: merged.employmentStatus || "",
  employmentType: merged.employmentType || "",
  unemploymentReason: merged.unemploymentReason || "",
  laidoffCountry: merged.laidoffCountry || "",
  tradeName: merged.tradeName || "",
  acronym: merged.acronym || "",
  tin: merged.tin || "",
  officeType: merged.officeType || "",
  employerClassificationType: merged.employerClassification?.type || "",
  employerClassificationSubtype: merged.employerClassification?.subtype || "",
  totalWorkforceSize: merged.totalWorkforceSize || "",
  ownerName: merged.ownerName || "",
  contactPersonName: merged.contactPersonName || "",
  contactPersonPosition: merged.contactPersonPosition || "",
  fax: merged.fax || "",
  businessAddressStructured: merged.businessAddressStructured || { street: "", barangay: "", municipality: "", province: "", region: "" },
});

// Fields where AuthContext's `user` — already hydrated with the account's
// real data by the time this page mounts in the normal navigation flow — is
// trusted as a fallback whenever the persisted draft has left the field
// blank. Without this, a stale *empty* draft cached in localStorage from an
// earlier visit (e.g. one that happened before onboarding was completed, or
// while the profile fetch below raced the app's own auth hydration) would
// silently keep masking real data forever: the "always populate from the
// API on mount" fetch only overwrites the draft if and when it resolves,
// and by then the blank values have often already been shown/saved.
const IDENTITY_FALLBACK_FIELDS = [
  "name", "surname", "firstName", "middleName", "suffix",
  "email", "phone", "address", "businessAddress",
  "companyName", "industry", "companySize", "website", "companyDescription",
  "desiredJobTitle", "workExperience", "educationalAttainment", "availabilityStatus",
];
const fillBlanksFromUser = (data, userSource) => {
  if (!userSource) return data;
  const filled = { ...data };
  for (const field of IDENTITY_FALLBACK_FIELDS) {
    if (!filled[field] && userSource[field]) {
      filled[field] = userSource[field];
    }
  }
  if (!filled.businessAddress && userSource.address) {
    filled.businessAddress = userSource.address;
  }
  return filled;
};

const getInitialPersisted = () => ({
  formData: { ...initialFormData },
  skills: [],
  preferredIndustries: [],
  industryPreferenceLevel: "flexible",
  activeTab: "profile",
});

export default function EditProfile() {
  const { user, login } = useContext(AuthContext);
  const toast = useToast();
  const isEmployer = user?.role === "employer";
  const isSuperadmin = user?.role === "superadmin";
  // The superadmin shares the admin's minimal edit form (name, phone, password) —
  // no NSRP / career / documents tabs.
  const isAdmin = user?.role === "admin" || isSuperadmin;

  // Persistent state
  const normalizeFormData = (data) => {
    return {
      ...initialFormData,
      ...data,
      presentAddress: { ...initialFormData.presentAddress, ...(data?.presentAddress || {}) },
      permanentAddress: { ...initialFormData.permanentAddress, ...(data?.permanentAddress || {}) },
      businessAddressStructured: { ...initialFormData.businessAddressStructured, ...(data?.businessAddressStructured || {}) },
      disability: Array.isArray(data?.disability) ? data.disability : [],
      preferredOccupations: Array.isArray(data?.preferredOccupations) ? data.preferredOccupations : [],
      preferredWorkLocationLocal: Array.isArray(data?.preferredWorkLocationLocal) ? data.preferredWorkLocationLocal : [],
      preferredWorkLocationOverseas: Array.isArray(data?.preferredWorkLocationOverseas) ? data.preferredWorkLocationOverseas : [],
      workHistory: Array.isArray(data?.workHistory) ? data.workHistory : [],
      vocationalTrainings: Array.isArray(data?.vocationalTrainings) ? data.vocationalTrainings : [],
      eligibilities: Array.isArray(data?.eligibilities) ? data.eligibilities : [],
      professionalLicenses: Array.isArray(data?.professionalLicenses) ? data.professionalLicenses : [],
      languageProficiency: {
        English: { ...initialFormData.languageProficiency.English, ...(data?.languageProficiency?.English || {}) },
        Filipino: { ...initialFormData.languageProficiency.Filipino, ...(data?.languageProficiency?.Filipino || {}) },
        Others: { ...initialFormData.languageProficiency.Others, ...(data?.languageProficiency?.Others || {}) },
      },
    };
  };

  const defaultState = getInitialPersisted();
  // Scoped to the signed-in account — a bare "editProfileState" key would be
  // shared by every account that ever uses this browser, so a different
  // account signing in later could inherit someone else's unsaved edits.
  const currentUserId = user?._id || user?.id || null;
  const [persistedState, setPersistedState] = usePersistentState(
    currentUserId ? `editProfileState_${currentUserId}` : null,
    defaultState
  );

  const safeState = (persistedState && typeof persistedState === 'object' && persistedState.formData)
    ? { ...persistedState, formData: fillBlanksFromUser(normalizeFormData(persistedState.formData), user) }
    : { ...defaultState, formData: fillBlanksFromUser(defaultState.formData, user) };

  const { formData, skills, preferredIndustries, industryPreferenceLevel, activeTab } = safeState;

  const heightCm = useMemo(() => parseHeightToCm(formData.height), [formData.height]);
  const heightConverted = heightCm !== null && wasConverted(formData.height, heightCm) ? heightCm : null;
  const weightKg = useMemo(() => parseWeightToKg(formData.weight), [formData.weight]);
  const weightConverted = weightKg !== null && wasConverted(formData.weight, weightKg) ? weightKg : null;
  const schoolOptions = useMemo(() => getSchoolOptions(formData.educationalAttainment), [formData.educationalAttainment]);
  const showCourseField = COURSE_ATTAINMENTS.includes(formData.educationalAttainment);
  const courseSuggestions = useMemo(
    () => (formData.educationalAttainment === "Vocational / TESDA" ? VOCATIONAL_COURSES : ALL_COURSES_FLAT),
    [formData.educationalAttainment]
  );
  const courseUnknown = formData.course === COURSE_UNKNOWN_VALUE;
  const toggleCourseUnknown = (checked) => setFormData((prev) => ({ ...prev, course: checked ? COURSE_UNKNOWN_VALUE : "" }));

  const industrySuggestions = useMemo(() => {
    const fromIndustries = preferredIndustries.flatMap((ind) => INDUSTRY_SKILLS[ind] || []);
    const deduped = [...new Set(fromIndustries)];
    return deduped.filter((skill) => !skills.includes(skill));
  }, [preferredIndustries, skills]);

  const genericSuggestions = useMemo(() => {
    return SUGGESTED_SKILLS.filter((skill) => !skills.includes(skill) && !industrySuggestions.includes(skill));
  }, [skills, industrySuggestions]);
  const setFormData = (updater) => setPersistedState(prev => {
    // Normalize first: a draft saved before a field existed (e.g. languageProficiency)
    // won't have it, and updaters assume it's there.
    const normalizedPrevForm = normalizeFormData(prev.formData);
    const newForm = typeof updater === 'function' ? updater(normalizedPrevForm) : updater;
    return { ...prev, formData: newForm };
  });
  const setSkills = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.skills) : updater;
    return { ...prev, skills: newVal };
  });
  const setPreferredIndustries = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.preferredIndustries) : updater;
    return { ...prev, preferredIndustries: newVal };
  });
  const setIndustryPreferenceLevel = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.industryPreferenceLevel) : updater;
    return { ...prev, industryPreferenceLevel: newVal };
  });
  const setActiveTab = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.activeTab) : updater;
    return { ...prev, activeTab: newVal };
  });

  // Purely a UI affordance (not persisted) — checking it copies the current
  // Company Profile business address into the structured NSRP fields below;
  // it doesn't keep the two permanently linked, so editing one afterward
  // doesn't silently rewrite the other.
  const [useOnboardingAddress, setUseOnboardingAddress] = useState(false);
  const [resumeFile, setResumeFile] = useState(null);
  const [supportingDocumentFile, setSupportingDocumentFile] = useState(null);
  const [businessPermitFile, setBusinessPermitFile] = useState(null);
  const [registrationDocFile, setRegistrationDocFile] = useState(null);
  const [existingResume, setExistingResume] = useState("");
  const [existingValidId, setExistingValidId] = useState("");
  const [existingBusinessPermit, setExistingBusinessPermit] = useState("");
  const [existingRegistrationDoc, setExistingRegistrationDoc] = useState("");
  const [documentClearFlags, setDocumentClearFlags] = useState({
    resume: false,
    validId: false,
    businessPermit: false,
    registrationDoc: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState("");
  // Set to the new address after an email change succeeds, so we can remind the
  // user to update the email their browser / password manager autofills — a
  // stale saved email is the usual cause of "can't log in" after this edit.
  const [emailChangeNotice, setEmailChangeNotice] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [skillInput, setSkillInput] = useState("");
  const [occupationInput, setOccupationInput] = useState("");
  const [localLocationInput, setLocalLocationInput] = useState("");
  const [overseasLocationInput, setOverseasLocationInput] = useState("");

  const addToCappedList = (field, value, cap) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setFormData((prev) => {
      const list = prev[field] || [];
      if (list.length >= cap) return prev;
      if (list.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return prev;
      return { ...prev, [field]: [...list, trimmed] };
    });
  };
  const removeFromCappedList = (field, value) => setFormData((prev) => ({ ...prev, [field]: (prev[field] || []).filter((v) => v !== value) }));

  const addListItem = (field, template) => setFormData((prev) => ({ ...prev, [field]: [...(prev[field] || []), template] }));
  const updateListItem = (field, index, key, value) => setFormData((prev) => {
    const list = [...(prev[field] || [])];
    list[index] = { ...list[index], [key]: value };
    return { ...prev, [field]: list };
  });
  const removeListItem = (field, index) => setFormData((prev) => ({ ...prev, [field]: (prev[field] || []).filter((_, i) => i !== index) }));

  const toggleLanguageSkill = (language, skillKey) => setFormData((prev) => ({
    ...prev,
    languageProficiency: {
      ...prev.languageProficiency,
      [language]: { ...prev.languageProficiency[language], [skillKey]: !prev.languageProficiency[language][skillKey] },
    },
  }));

  // Merge profile data from API
  const mergeProfileData = (data) => {
    const userData = data.user || {};
    const profileData = data.profile || {};
    const merged = { ...userData };
    if (userData.role === "employer" && profileData.businessAddress) {
      merged.businessAddressStructured = profileData.businessAddress;
    }
    // profileData is a separate document (JobseekerProfile/EmployerProfile)
    // with its own _id/userId/timestamps — those must never overwrite the
    // User document's own identity fields. Otherwise the merged object's
    // `_id` gets replaced with the profile sub-document's id, which then
    // flows into AuthContext's `user` via login() below, changes the id
    // SocketProvider keys its connection on, and causes the socket to
    // disconnect/reconnect — see AuthContext.jsx's mergeProfileIntoUser,
    // which strips these same fields for the same reason.
    const { businessAddress, _id, id, userId, createdAt, updatedAt, __v, ...restProfile } = profileData;
    Object.assign(merged, restProfile);
    return merged;
  };

  useEffect(() => {
    // Guards against a hard page-load landing directly on this route: on
    // first paint AuthContext's own user hydration may not have resolved
    // yet, so `currentUserId` starts out null. Re-running once it becomes
    // known (rather than only once on mount) makes sure this fetch — and the
    // draft's per-account localStorage key above — are never left keyed to
    // "no user yet" for the lifetime of the page.
    if (!currentUserId) return;
    const fetchProfile = async () => {
      try {
        const { data } = await authAPI.getProfile();
        const merged = mergeProfileData(data);

        // Always populate form from API on component mount
        // This ensures fresh data from server is displayed, not stale persisted state
        setFormData(mapMergedToFormData(merged));
        setSkills(Array.isArray(merged.skills) ? merged.skills : []);
        setPreferredIndustries(Array.isArray(merged.preferredIndustries) ? merged.preferredIndustries : []);
        setIndustryPreferenceLevel(merged.industryPreferenceLevel || "flexible");

        setExistingResume(merged.resumeFile || "");
        setExistingValidId(merged.validIdFile || "");
        setExistingBusinessPermit(merged.businessPermitUrl || "");
        setExistingRegistrationDoc(merged.registrationDocUrl || "");

        login(localStorage.getItem("token"), merged);
      } catch (err) {
        // Fallback to user context if API fails
        if (user) {
          setFormData({
            ...initialFormData,
            name: user.name || "",
            surname: user.surname || "",
            firstName: user.firstName || "",
            middleName: user.middleName || "",
            suffix: user.suffix || "",
            email: user.email || "",
            phone: user.phone || "",
            address: user.address || "",
            businessAddress: user.businessAddress || user.address || "",
            companyName: user.companyName || "",
            industry: user.industry || "",
            companySize: user.companySize || "",
            website: user.website || "",
            companyDescription: user.companyDescription || "",
            desiredJobTitle: user.desiredJobTitle || "",
            workExperience: user.workExperience || "",
            educationalAttainment: user.educationalAttainment || "",
            availabilityStatus: user.availabilityStatus || "",
          });
          setSkills(Array.isArray(user.skills) ? user.skills : []);
        }
      }
    };

    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  const handleChange = (event) => {
    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleNestedChange = (parent, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [parent]: { ...prev[parent], [field]: value },
    }));
  };

  const toggleIndustry = (industry) => {
    setPreferredIndustries(prev =>
      prev.includes(industry)
        ? prev.filter(i => i !== industry)
        : [...prev, industry]
    );
  };

  const addSkill = (value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (skills.some((skill) => skill.toLowerCase() === trimmed.toLowerCase())) return;
    setSkills((prev) => [...prev, trimmed]);
  };

  const handleRemoveSkill = (skillToRemove) => {
    setSkills((prev) => prev.filter((skill) => skill !== skillToRemove));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setEmailChangeNotice("");

    const previousEmail = (user?.email || "").trim().toLowerCase();

    try {
      const data = new FormData();
      const composedName = [formData.firstName, formData.middleName, formData.surname, formData.suffix].filter(Boolean).join(" ");
      // For an employer, `name` is the business's display identity — mirror
      // whatever is in Company Name rather than a separately-typed value (the
      // server does this same sync independently; see authController.updateProfile).
      data.append("name", isEmployer ? formData.companyName : (!isAdmin && composedName) ? composedName : formData.name);
      data.append("email", formData.email);
      data.append("phone", formData.phone);

      if (isAdmin) {
        if (currentPassword || newPassword || confirmPassword) {
          if (!currentPassword || !newPassword) {
            throw new Error("Current password and new password are required");
          }
          if (newPassword !== confirmPassword) {
            throw new Error("New password and confirm password do not match");
          }
          data.append("currentPassword", currentPassword);
          data.append("newPassword", newPassword);
        }
      } else if (isEmployer) {
        data.append("dateOfBirth", formData.dateOfBirth);
        data.append("gender", formData.gender);
        data.append("companyName", formData.companyName);
        data.append("industry", formData.industry);
        data.append("companySize", formData.companySize);
        data.append("website", formData.website);
        data.append("companyDescription", formData.companyDescription);
        data.append("businessAddress", formData.businessAddress);
        data.append("tradeName", formData.tradeName);
        data.append("acronym", formData.acronym);
        data.append("tin", formData.tin);
        data.append("officeType", formData.officeType);
        data.append(
          "employerClassification",
          JSON.stringify({
            type: formData.employerClassificationType,
            subtype: formData.employerClassificationSubtype,
          })
        );
        data.append("totalWorkforceSize", formData.totalWorkforceSize);
        data.append("ownerName", formData.ownerName);
        data.append("contactPersonName", formData.contactPersonName);
        data.append("contactPersonPosition", formData.contactPersonPosition);
        data.append("fax", formData.fax);
        data.append("businessAddressStructured", JSON.stringify(formData.businessAddressStructured));
        if (businessPermitFile) data.append("businessPermit", businessPermitFile);
        if (registrationDocFile) data.append("registrationDoc", registrationDocFile);
      } else {
        data.append("surname", formData.surname);
        data.append("firstName", formData.firstName);
        data.append("middleName", formData.middleName);
        data.append("suffix", formData.suffix);
        data.append("dateOfBirth", formData.dateOfBirth);
        data.append("gender", formData.gender);
        data.append("about", formData.about);
        data.append("address", formData.address);
        data.append("preferredOccupations", JSON.stringify(formData.preferredOccupations));
        data.append("desiredJobTitle", formData.preferredOccupations[0] || formData.desiredJobTitle);
        data.append("preferredWorkLocationLocal", JSON.stringify(formData.preferredWorkLocationLocal));
        data.append("preferredWorkLocationOverseas", JSON.stringify(formData.preferredWorkLocationOverseas));
        data.append("expectedSalaryMin", formData.expectedSalaryMin);
        data.append("expectedSalaryMax", formData.expectedSalaryMax);
        data.append("workExperience", formData.workExperience);
        data.append("educationalAttainment", formData.educationalAttainment);
        data.append("schoolAttended", formData.schoolAttended);
        data.append("schoolAttendedOther", formData.schoolAttendedOther);
        data.append("course", formData.course);
        data.append("yearGraduated", formData.yearGraduated);
        data.append("languageProficiency", JSON.stringify(formData.languageProficiency));
        data.append("languageOthersLabel", formData.languageOthersLabel);
        data.append("workHistory", JSON.stringify(formData.workHistory));
        data.append("vocationalTrainings", JSON.stringify(formData.vocationalTrainings));
        data.append("eligibilities", JSON.stringify(formData.eligibilities));
        data.append("professionalLicenses", JSON.stringify(formData.professionalLicenses));
        data.append("availabilityStatus", formData.availabilityStatus);
        data.append("skills", JSON.stringify(skills));
        data.append("preferredIndustries", JSON.stringify(preferredIndustries));
        data.append("industryPreferenceLevel", industryPreferenceLevel);
        data.append("civilStatus", formData.civilStatus);
        data.append("placeOfBirth", formData.placeOfBirth);
        data.append("citizenship", formData.citizenship);
        data.append("height", heightCm ?? "");
        data.append("weight", weightKg ?? "");
        data.append("religion", formData.religion);
        data.append("tin", formData.tin);
        data.append("sssGsisNo", formData.sssGsisNo);
        data.append("pagibigNo", formData.pagibigNo);
        data.append("philhealthNo", formData.philhealthNo);
        data.append("landline", formData.landline);
        data.append("mobileSecondary", formData.mobileSecondary);
        data.append("presentAddress", JSON.stringify(formData.presentAddress));
        data.append("permanentAddress", JSON.stringify(formData.permanentAddress));
        data.append("disability", JSON.stringify(formData.disability));
        data.append("is4psBeneficiary", formData.is4psBeneficiary ? "true" : "false");
        data.append("_4psHouseholdId", formData._4psHouseholdId);
        data.append("isOfw", formData.isOfw ? "true" : "false");
        data.append("isRepatriated", formData.isRepatriated ? "true" : "false");
        data.append("repatriationIntent", formData.repatriationIntent);
        data.append("passportNo", formData.passportNo);
        data.append("passportExpiryDate", formData.passportExpiryDate);
        data.append("employmentStatus", formData.employmentStatus);
        data.append("employmentType", formData.employmentType);
        data.append("unemploymentReason", formData.unemploymentReason);
        data.append("laidoffCountry", formData.laidoffCountry);
        if (resumeFile) data.append("resumeFile", resumeFile);
        if (supportingDocumentFile) data.append("validIdFile", supportingDocumentFile);
      }

      if (!resumeFile && documentClearFlags.resume && existingResume) data.append("resumeFile", "");
      if (!supportingDocumentFile && documentClearFlags.validId && existingValidId) data.append("validIdFile", "");
      if (!businessPermitFile && documentClearFlags.businessPermit && existingBusinessPermit) data.append("businessPermit", "");
      if (!registrationDocFile && documentClearFlags.registrationDoc && existingRegistrationDoc) data.append("registrationDoc", "");

      const { data: response } = await authAPI.updateProfile(data);
      toast.success(response.message || "Profile updated successfully");

      // A resume uploaded here only sets the single NSRP Form 1 slot on the
      // user document — it's invisible to the actual job-application flow,
      // which sources its resume choices from the document library. Mirror
      // it there too so a resume saved from any entry point is usable both
      // for NSRP and for applying to jobs.
      if (resumeFile && !isEmployer && !isAdmin) {
        try {
          await jobseekerDocumentAPI.upload({
            file: resumeFile,
            kind: "resume",
            title: resumeFile.name,
            source: "upload",
          });
        } catch (libraryError) {
          // The profile save already succeeded — don't let a library-mirror
          // failure surface as if the whole action failed.
          console.warn("Failed to mirror resume into the document library", libraryError);
        }
      }

      const newEmail = (response.user?.email || formData.email || "").trim();
      if (previousEmail && newEmail && newEmail.toLowerCase() !== previousEmail) {
        setEmailChangeNotice(newEmail);
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDocumentClearFlags({ resume: false, validId: false, businessPermit: false, registrationDoc: false });
      login(localStorage.getItem("token"), response.user);
      
      // Update form with fresh server response to keep fields populated
      const merged = mergeProfileData(response);
      setFormData(mapMergedToFormData(merged));
      setSkills(Array.isArray(merged.skills) ? merged.skills : []);
      setPreferredIndustries(Array.isArray(merged.preferredIndustries) ? merged.preferredIndustries : []);
      setIndustryPreferenceLevel(merged.industryPreferenceLevel || "flexible");
    } catch (err) {
      const message = err.response?.data?.message || err.message || "Failed to update profile";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };


  const handleSubmitVerification = async () => {
    setVerifySubmitting(true);
    setVerifyMsg("");
    try {
      const { data } = await verificationAPI.submit();
      const successMessage = data?.message || "Submitted for review.";
      setVerifyMsg(successMessage);
      toast.success(successMessage);
      // Re-hydrate so the new "pending" status shows immediately.
      await login(localStorage.getItem("token"), { ...user, verificationStatus: "pending" });
    } catch (err) {
      const message = err.response?.data?.message || "Failed to submit for review.";
      setVerifyMsg(message);
      toast.error(message);
    } finally {
      setVerifySubmitting(false);
    }
  };

  const tabs = [
    { id: "profile", label: isEmployer ? "Company Info" : "Personal Info", icon: isEmployer ? <FaBuilding /> : <FaUser /> },
    ...(!isAdmin && !isEmployer ? [
      { id: "career", label: "Career", icon: <FaBriefcase /> },
      { id: "training", label: "Training & Eligibility", icon: <FaUserGraduate /> },
    ] : []),
    ...(!isAdmin ? [{ id: "nsrp", label: "NSRP Details", icon: isEmployer ? <FaBuilding /> : <FaIdCard /> }] : []),
    ...(!isAdmin ? [{ id: "documents", label: "Documents", icon: <FaFileAlt /> }] : []),
  ];

  const isTabComplete = (tabId) => {
    switch (tabId) {
      case "profile":
        if (isAdmin) return Boolean(formData.name && formData.email);
        if (isEmployer) return Boolean(formData.name && formData.email && formData.companyName && formData.businessAddress);
        return Boolean(formData.surname && formData.firstName && formData.email && formData.dateOfBirth && formData.address);
      case "career":
        return formData.preferredOccupations.length > 0 && Boolean(formData.workExperience) && Boolean(formData.educationalAttainment);
      case "training":
        return formData.vocationalTrainings.length > 0 || formData.eligibilities.length > 0 || formData.professionalLicenses.length > 0;
      case "nsrp":
        if (isEmployer) return Boolean(formData.tradeName && formData.tin && formData.officeType);
        return Boolean(formData.civilStatus && formData.citizenship && formData.presentAddress.municipality);
      case "documents":
        if (isEmployer) return Boolean(businessPermitFile || existingBusinessPermit) && Boolean(registrationDocFile || existingRegistrationDoc);
        return Boolean(resumeFile || existingResume) && Boolean(supportingDocumentFile || existingValidId);
      default:
        return false;
    }
  };

  // For an employer whose account predates the name/companyName sync fix
  // (e.g. a Google sign-up, where `name` still holds the personal Google
  // account name), prefer the company name directly here so the sidebar is
  // correct immediately — not just after their next profile save.
  const railName = isEmployer
    ? (formData.companyName || formData.name || "Your Profile")
    : formData.name || [formData.firstName, formData.surname].filter(Boolean).join(" ") || "Your Profile";
  const railRole = isSuperadmin ? "System Superadmin" : isAdmin ? "Administrator" : isEmployer ? "Employer" : "Job Seeker";

  return (
    <div className="editprofile-shell">
      <aside className="editprofile-rail">
        <Link to="/profile" className="editprofile-rail-back"><FaArrowLeft /> Back to Profile</Link>
        <div className="editprofile-rail-identity">
          <div className="editprofile-rail-avatar">
            {user?.profileImage
              ? <img src={resolveAssetUrl(user.profileImage)} alt="" />
              : (railName.trim().charAt(0).toUpperCase() || "U")}
          </div>
          <div>
            <div className="editprofile-rail-name">{railName}</div>
            <p className="editprofile-rail-role">{railRole}</p>
          </div>
        </div>
        <ul className="editprofile-tabs">
          {tabs.map((tab) => (
            <li key={tab.id}>
              <button type="button" className={`editprofile-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                {tab.icon}
                <span className="editprofile-tab-label">{tab.label}</span>
                <span className={`editprofile-tab-dot ${isTabComplete(tab.id) ? "editprofile-tab-dot--done" : ""}`} />
              </button>
            </li>
          ))}
        </ul>
        {!isAdmin && !isEmployer ? (
          <Link to="/profile/resume" className="editprofile-rail-resume">
            <FaMagic /> Resume &amp; Cover Letter Studio
          </Link>
        ) : null}
        <p className="editprofile-rail-footer">Fields are saved when you click Save Profile.</p>
      </aside>

      <div className="editprofile-panel">
        <EmailChangeCard currentEmail={user?.email || formData.email} />

        <form className="editprofile-panel-inner" id="edit-profile-form" onSubmit={handleSubmit}>
          <div className="editprofile-panel-header">
            <h1 className="editprofile-panel-title">Edit Profile</h1>
            <p className="editprofile-panel-subtitle">Update your personal information and preferences</p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {emailChangeNotice && (
            <div className="alert alert-warning">
              Your sign-in email is now <strong>{emailChangeNotice}</strong>. If your browser or
              password manager saved your old email, update it there too — otherwise the old
              address may be auto-filled and your next login will fail.
            </div>
          )}

          <div className="editprofile-card">
          <div className="profile-fields">
          {/* --- PERSONAL INFO TAB --- */}
          {activeTab === "profile" && (
            <>
              <div className="profile-field-group">
                {isAdmin ? (
                  <div className="profile-field">
                    <label htmlFor="name"><FaUser /> Full Name</label>
                    <input id="name" type="text" name="name" value={formData.name} onChange={handleChange} required />
                  </div>
                ) : isEmployer ? null : (
                  <>
                    <div className="profile-field-grid">
                      <div className="profile-field">
                        <label htmlFor="surname"><FaUser /> Surname</label>
                        <input id="surname" type="text" name="surname" value={formData.surname} onChange={handleChange} required />
                      </div>
                      <div className="profile-field">
                        <label htmlFor="firstName">First Name</label>
                        <input id="firstName" type="text" name="firstName" value={formData.firstName} onChange={handleChange} required />
                      </div>
                    </div>
                    <div className="profile-field-grid">
                      <div className="profile-field">
                        <label htmlFor="middleName">Middle Name</label>
                        <input id="middleName" type="text" name="middleName" value={formData.middleName} onChange={handleChange} />
                      </div>
                      <div className="profile-field">
                        <label htmlFor="suffix">Suffix</label>
                        <input id="suffix" type="text" name="suffix" placeholder="Jr., III, etc." value={formData.suffix} onChange={handleChange} />
                      </div>
                    </div>
                  </>
                )}
                <div className="profile-field">
                  <label htmlFor="email"><FaEnvelope /> Email</label>
                  <input id="email" type="email" name="email" value={formData.email} readOnly />
                  <p className="help-text" style={{ marginTop: "6px" }}>
                    Use the <strong>Email address</strong> panel above to change your sign-in email.
                  </p>
                </div>
                <div className="profile-field">
                  <label htmlFor="phone"><FaPhone /> Phone</label>
                  <input id="phone" type="text" name="phone" value={formData.phone} onChange={handleChange} />
                </div>
              </div>

              {isAdmin ? (
                <div className="profile-field-group profile-password-group">
                  <h3 className="profile-section-title">🔒 Change Password</h3>
                  <div className="profile-field">
                    <label htmlFor="currentPassword">Current Password</label>
                    <div className="password-input-wrapper">
                      <input id="currentPassword" type={showCurrentPassword ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" />
                      <button type="button" className="password-toggle-btn" onClick={() => setShowCurrentPassword(!showCurrentPassword)} aria-label={showCurrentPassword ? "Hide password" : "Show password"}>
                        {showCurrentPassword ? <FaEyeSlash /> : <FaEye />}
                      </button>
                    </div>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="newPassword">New Password</label>
                      <div className="password-input-wrapper">
                        <input id="newPassword" type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
                        <button type="button" className="password-toggle-btn" onClick={() => setShowNewPassword(!showNewPassword)} aria-label={showNewPassword ? "Hide password" : "Show password"}>
                          {showNewPassword ? <FaEyeSlash /> : <FaEye />}
                        </button>
                      </div>
                    </div>
                    <div className="profile-field">
                      <label htmlFor="confirmPassword">Confirm Password</label>
                      <div className="password-input-wrapper">
                        <input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" />
                        <button type="button" className="password-toggle-btn" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                          {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isEmployer ? null : (
                <>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="dateOfBirth"><FaCalendarAlt /> Date of Birth</label>
                      <input id="dateOfBirth" type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} />
                    </div>
                    <div className="profile-field">
                      <label htmlFor="gender">Gender</label>
                      <select id="gender" name="gender" value={formData.gender} onChange={handleChange}>
                        <option value="">Select</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>

                  <div className="profile-field">
                    <label><FaMapMarkerAlt /> Address</label>
                    <LocationSelect
                      value={formData.address}
                      onChange={(loc) => setFormData((prev) => ({ ...prev, address: loc }))}
                      disabled={loading}
                      required
                    />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="about">About You</label>
                    <textarea id="about" name="about" value={formData.about} onChange={handleChange} rows="4" placeholder="Tell employers about yourself..." />
                  </div>
                  <div className="profile-field-group">
                    <h3 className="profile-section-title">Preferred Industries</h3>
                    <p className="profile-section-hint">Select the industries you are interested in working in.</p>
                    <div className="industry-pills-grid">
                      {INDUSTRY_OPTIONS.map(ind => (
                        <button
                          key={ind}
                          type="button"
                          className={`industry-pill ${preferredIndustries.includes(ind) ? "active" : ""}`}
                          onClick={() => toggleIndustry(ind)}
                          disabled={loading}
                        >
                          {ind}
                        </button>
                      ))}
                    </div>
                    <div style={{ marginTop: '1.5rem' }}>
                      <span className="profile-label">Preference Mode</span>
                      <div className="pill-row">
                        <button
                          type="button"
                          className={`pill-btn ${industryPreferenceLevel === "flexible" ? "active" : ""}`}
                          onClick={() => setIndustryPreferenceLevel("flexible")}
                          disabled={loading}
                        >
                          Flexible (Show all jobs, prioritize these)
                        </button>
                        <button
                          type="button"
                          className={`pill-btn ${industryPreferenceLevel === "strict" ? "active" : ""}`}
                          onClick={() => setIndustryPreferenceLevel("strict")}
                          disabled={loading}
                        >
                          Strict (Only show these industries)
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {isEmployer && (
                <div className="profile-field-group">
                  <h3 className="profile-section-title"><FaBuilding /> Company Profile</h3>
                  <div className="profile-field">
                    <label htmlFor="companyName">Company Name</label>
                    <input id="companyName" type="text" name="companyName" value={formData.companyName} onChange={handleChange} />
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="industry">Industry / Sector</label>
                      <select id="industry" name="industry" value={formData.industry} onChange={handleChange}>
                        <option value="">Select Industry</option>
                        {INDUSTRY_OPTIONS.map(ind => (
                          <option key={ind} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>
                    <div className="profile-field">
                      <label htmlFor="companySize">Company Size</label>
                      <select id="companySize" name="companySize" value={formData.companySize} onChange={handleChange}>
                        <option value="">Select Size</option>
                        {WORKFORCE_SIZE_OPTIONS.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="website">Website / Facebook Page</label>
                    <input id="website" type="url" name="website" value={formData.website} onChange={handleChange} placeholder="https://..." />
                  </div>
                  <div className="profile-field">
                    <label><FaMapMarkerAlt /> Business Address</label>
                    <LocationSelect
                      value={formData.businessAddress}
                      onChange={(loc) => setFormData((prev) => ({ ...prev, businessAddress: loc }))}
                      disabled={loading}
                      required
                    />
                    <p className="help-text" style={{ marginTop: "6px" }}>
                      Shown on your job postings and public profile. The detailed, form-ready version
                      (street, barangay, etc.) is set separately under the <strong>NSRP Details</strong> tab.
                    </p>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="companyDescription">Company Description</label>
                    <textarea id="companyDescription" name="companyDescription" value={formData.companyDescription} onChange={handleChange} rows="4" />
                  </div>
                </div>
              )}
            </>
          )}

          {/* --- CAREER TAB (jobseeker only) --- */}
          {activeTab === "career" && !isAdmin && !isEmployer && (
            <div className="profile-field-group">
              <h3 className="profile-section-title"><FaBriefcase /> Preferred Occupations</h3>
              <div className="profile-field">
                <div className="chip-counter-row">
                  <div className="chip-progress-bar"><div className="chip-progress-fill" style={{ width: `${(formData.preferredOccupations.length / 4) * 100}%` }} /></div>
                  <span className="chip-counter-label">{formData.preferredOccupations.length}/4</span>
                </div>
                <div className="skills-input-row">
                  <input
                    type="text"
                    value={occupationInput}
                    placeholder={formData.preferredOccupations.length >= 4 ? "Maximum of 4 reached" : "e.g. Administrative Assistant"}
                    onChange={(e) => setOccupationInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addToCappedList("preferredOccupations", occupationInput, 4); setOccupationInput(""); } }}
                    disabled={formData.preferredOccupations.length >= 4}
                  />
                  <button type="button" className="skill-add-btn" onClick={() => { addToCappedList("preferredOccupations", occupationInput, 4); setOccupationInput(""); }} disabled={formData.preferredOccupations.length >= 4}><FaPlus /></button>
                </div>
                <div className="skills-tags-wrap">
                  {formData.preferredOccupations.map((occ, i) => (
                    <span key={occ} className="skill-tag">{i + 1}. {occ}
                      <button type="button" onClick={() => removeFromCappedList("preferredOccupations", occ)} aria-label={`Remove ${occ}`} className="skill-tag-remove"><FaTimes /></button>
                    </span>
                  ))}
                </div>
              </div>

              <h3 className="profile-section-title">Preferred Work Location</h3>
              <div className="location-cards">
                <div className="location-card">
                  <div className="location-card-title">
                    <span>Local (cities / municipalities)</span>
                    <span className="chip-counter-label">{formData.preferredWorkLocationLocal.length}/3</span>
                  </div>
                  <div className="chip-progress-bar" style={{ marginBottom: "10px" }}><div className="chip-progress-fill" style={{ width: `${(formData.preferredWorkLocationLocal.length / 3) * 100}%` }} /></div>
                  <div className="skills-input-row">
                    <input
                      type="text"
                      list="local-location-options"
                      value={localLocationInput}
                      placeholder={formData.preferredWorkLocationLocal.length >= 3 ? "Maximum of 3 reached" : "e.g. Boac, Marinduque"}
                      onChange={(e) => setLocalLocationInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addToCappedList("preferredWorkLocationLocal", localLocationInput, 3); setLocalLocationInput(""); } }}
                      disabled={formData.preferredWorkLocationLocal.length >= 3}
                    />
                    <button type="button" className="skill-add-btn" onClick={() => { addToCappedList("preferredWorkLocationLocal", localLocationInput, 3); setLocalLocationInput(""); }} disabled={formData.preferredWorkLocationLocal.length >= 3}><FaPlus /></button>
                  </div>
                  <datalist id="local-location-options">
                    {ALL_LOCATIONS.map((loc) => <option key={loc} value={loc} />)}
                  </datalist>
                  <div className="skills-tags-wrap">
                    {formData.preferredWorkLocationLocal.map((loc) => (
                      <span key={loc} className="skill-tag">{loc}
                        <button type="button" onClick={() => removeFromCappedList("preferredWorkLocationLocal", loc)} aria-label={`Remove ${loc}`} className="skill-tag-remove"><FaTimes /></button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="location-card">
                  <div className="location-card-title">
                    <span>Overseas (countries)</span>
                    <span className="chip-counter-label">{formData.preferredWorkLocationOverseas.length}/3</span>
                  </div>
                  <div className="chip-progress-bar" style={{ marginBottom: "10px" }}><div className="chip-progress-fill" style={{ width: `${(formData.preferredWorkLocationOverseas.length / 3) * 100}%` }} /></div>
                  <div className="skills-input-row">
                    <input
                      type="text"
                      list="overseas-location-options"
                      value={overseasLocationInput}
                      placeholder={formData.preferredWorkLocationOverseas.length >= 3 ? "Maximum of 3 reached" : "e.g. Japan"}
                      onChange={(e) => setOverseasLocationInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addToCappedList("preferredWorkLocationOverseas", overseasLocationInput, 3); setOverseasLocationInput(""); } }}
                      disabled={formData.preferredWorkLocationOverseas.length >= 3}
                    />
                    <button type="button" className="skill-add-btn" onClick={() => { addToCappedList("preferredWorkLocationOverseas", overseasLocationInput, 3); setOverseasLocationInput(""); }} disabled={formData.preferredWorkLocationOverseas.length >= 3}><FaPlus /></button>
                  </div>
                  <datalist id="overseas-location-options">
                    {COUNTRY_OPTIONS.map((c) => <option key={c} value={c} />)}
                  </datalist>
                  <div className="skills-tags-wrap">
                    {formData.preferredWorkLocationOverseas.map((loc) => (
                      <span key={loc} className="skill-tag">{loc}
                        <button type="button" onClick={() => removeFromCappedList("preferredWorkLocationOverseas", loc)} aria-label={`Remove ${loc}`} className="skill-tag-remove"><FaTimes /></button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="profile-field-grid">
                <div className="profile-field">
                  <label htmlFor="expectedSalaryMin">Expected Salary Min (₱)</label>
                  <input id="expectedSalaryMin" type="number" min="0" name="expectedSalaryMin" value={formData.expectedSalaryMin} onChange={handleChange} />
                </div>
                <div className="profile-field">
                  <label htmlFor="expectedSalaryMax">Expected Salary Max (₱)</label>
                  <input id="expectedSalaryMax" type="number" min="0" name="expectedSalaryMax" value={formData.expectedSalaryMax} onChange={handleChange} />
                </div>
              </div>

              <div className="profile-field">
                <label htmlFor="skills"><FaPlus /> Skills</label>
                <div className="skills-input-row">
                  <input
                    id="skills"
                    type="text"
                    value={skillInput}
                    placeholder="Type a skill and press Enter"
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(skillInput); setSkillInput(""); } }}
                  />
                  <button type="button" className="skill-add-btn" onClick={() => { addSkill(skillInput); setSkillInput(""); }}><FaPlus /></button>
                </div>
                <div className="skills-tags-wrap">
                  {skills.map((skill) => (
                    <span key={skill} className="skill-tag">
                      {skill}
                      <button type="button" onClick={() => handleRemoveSkill(skill)} aria-label={`Remove ${skill}`} className="skill-tag-remove"><FaTimes /></button>
                    </span>
                  ))}
                </div>
                {industrySuggestions.length > 0 && (
                  <>
                    <span className="suggestion-caption">Recommended for your industry:</span>
                    <div className="suggestions-row">
                      {industrySuggestions.map((skill) => (
                        <button key={skill} type="button" className="suggestion-chip suggestion-chip-recommended" onClick={() => addSkill(skill)}>+ {skill}</button>
                      ))}
                    </div>
                  </>
                )}
                {genericSuggestions.length > 0 && (
                  <>
                    <span className="suggestion-caption">All skills:</span>
                    <div className="suggestions-row">
                      {genericSuggestions.map((skill) => (
                        <button key={skill} type="button" className="suggestion-chip" onClick={() => addSkill(skill)}>+ {skill}</button>
                      ))}
                    </div>
                  </>
                )}
                {skills.length === 0 && industrySuggestions.length === 0 && genericSuggestions.length === 0 && (
                  <p className="help-text" style={{ marginTop: "8px" }}>Add skills to improve job matching and recommendations</p>
                )}
              </div>

              <div className="profile-field-grid">
                <div className="profile-field">
                  <label htmlFor="workExperience">Work Experience</label>
                  <select id="workExperience" name="workExperience" value={formData.workExperience} onChange={handleChange}>
                    <option value="">Select</option>
                    <option value="Student">Student</option>
                    <option value="Not Applicable / No Work Experience">Not Applicable / No Work Experience</option>
                    <option value="Fresh Graduate">Fresh Graduate</option>
                    <option value="Less than 1 year">Less than 1 year</option>
                    <option value="1–3 years">1–3 years</option>
                    <option value="3–5 years">3–5 years</option>
                    <option value="5+ years">5+ years</option>
                  </select>
                </div>
                <div className="profile-field">
                  <label htmlFor="educationalAttainment"><FaUserGraduate /> Educational Attainment</label>
                  <select id="educationalAttainment" name="educationalAttainment" value={formData.educationalAttainment} onChange={handleChange}>
                    <option value="">Select</option>
                    <option value="Elementary Graduate">Elementary Graduate</option>
                    <option value="High School Graduate">High School Graduate</option>
                    <option value="Senior High School Graduate">Senior High School Graduate</option>
                    <option value="Vocational / TESDA">Vocational / TESDA</option>
                    <option value="College Undergraduate">College Undergraduate</option>
                    <option value="College Graduate">College Graduate</option>
                    <option value="Master's Degree">Master's Degree</option>
                    <option value="Doctorate">Doctorate</option>
                  </select>
                </div>
              </div>

              {schoolOptions.length > 0 && (
                <div className="profile-field">
                  <label htmlFor="schoolAttended">School Attended</label>
                  <select id="schoolAttended" name="schoolAttended" value={formData.schoolAttended} onChange={handleChange}>
                    <option value="">Select</option>
                    {schoolOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                    <option value={OTHER_OPTION}>Others / Not Listed</option>
                  </select>
                </div>
              )}
              {formData.schoolAttended === OTHER_OPTION && (
                <div className="profile-field">
                  <label htmlFor="schoolAttendedOther">School Name</label>
                  <input id="schoolAttendedOther" type="text" name="schoolAttendedOther" value={formData.schoolAttendedOther} onChange={handleChange} />
                </div>
              )}
              {showCourseField && (
                <div className="profile-field">
                  <label htmlFor="course">Course</label>
                  <SearchableDropdown
                    id="course"
                    value={courseUnknown ? "" : (formData.course || "")}
                    onChange={(v) => setFormData((prev) => ({ ...prev, course: v }))}
                    options={courseSuggestions}
                    placeholder={courseUnknown ? "Not sure yet" : "Type to search or select a course"}
                    disabled={courseUnknown}
                  />
                  <label className="custom-checkbox-label" style={{ marginTop: "8px" }}>
                    <input
                      type="checkbox"
                      checked={courseUnknown}
                      onChange={(e) => toggleCourseUnknown(e.target.checked)}
                    />
                    I'm not sure / don't know my course yet
                  </label>
                </div>
              )}
              <div className="profile-field">
                <label htmlFor="yearGraduated">Year Graduated</label>
                <input id="yearGraduated" type="text" inputMode="numeric" maxLength={4} placeholder="e.g. 2022" name="yearGraduated" value={formData.yearGraduated} onChange={handleChange} />
              </div>

              <h3 className="profile-section-title">Language / Dialect Proficiency</h3>
              <div className="lang-table-wrap">
                <table className="lang-table">
                  <thead>
                    <tr>
                      <th scope="col">Language</th>
                      {LANGUAGE_SKILLS.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {["English", "Filipino", "Others"].map((lang) => (
                      <tr key={lang}>
                        <th scope="row">
                          {lang === "Others" ? (
                            <input
                              type="text"
                              placeholder="Others, specify"
                              value={formData.languageOthersLabel}
                              onChange={(e) => setFormData((prev) => ({ ...prev, languageOthersLabel: e.target.value }))}
                            />
                          ) : lang}
                        </th>
                        {LANGUAGE_SKILLS.map((s) => (
                          <td key={s.key}>
                            <input
                              type="checkbox"
                              aria-label={`${lang} — ${s.label}`}
                              checked={formData.languageProficiency[lang][s.key]}
                              onChange={() => toggleLanguageSkill(lang, s.key)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="profile-section-title">Work History</h3>
              {formData.workHistory.map((entry, i) => (
                <div key={i} className="repeat-entry-card">
                  <div className="repeat-entry-card-header">
                    <span>Employer {i + 1}</span>
                    <button type="button" className="repeat-entry-remove" onClick={() => removeListItem("workHistory", i)}>Remove</button>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label>Company Name</label>
                      <input type="text" value={entry.companyName || ""} onChange={(e) => updateListItem("workHistory", i, "companyName", e.target.value)} />
                    </div>
                    <div className="profile-field">
                      <label>Address (City/Municipality)</label>
                      <LocationAutosuggest
                        value={entry.address || ""}
                        onChange={(v) => updateListItem("workHistory", i, "address", v)}
                        placeholder="e.g. Boac, Marinduque"
                      />
                    </div>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label>Position</label>
                      <Autosuggest
                        value={entry.position || ""}
                        onChange={(v) => updateListItem("workHistory", i, "position", v)}
                        options={PH_JOB_TITLES}
                        placeholder="e.g. Administrative Assistant"
                      />
                    </div>
                    <div className="profile-field">
                      <label>Status</label>
                      <select value={entry.status || ""} onChange={(e) => updateListItem("workHistory", i, "status", e.target.value)}>
                        <option value="">Select</option>
                        <option value="Permanent">Permanent</option>
                        <option value="Contractual">Contractual</option>
                        <option value="Part-time">Part-time</option>
                        <option value="Probationary">Probationary</option>
                      </select>
                    </div>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label>From</label>
                      <input type="date" value={entry.dateFrom || ""} onChange={(e) => updateListItem("workHistory", i, "dateFrom", e.target.value)} />
                    </div>
                    <div className="profile-field">
                      <label>To</label>
                      <input type="date" value={entry.dateTo || ""} onChange={(e) => updateListItem("workHistory", i, "dateTo", e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" className="add-row-btn" onClick={() => addListItem("workHistory", { companyName: "", address: "", position: "", dateFrom: "", dateTo: "", status: "" })}>+ Add employer</button>

              <div className="profile-field">
                <label htmlFor="availabilityStatus">Availability Status</label>
                <select id="availabilityStatus" name="availabilityStatus" value={formData.availabilityStatus} onChange={handleChange}>
                  <option value="">Select status</option>
                  <option value="Actively Looking">Actively Looking</option>
                  <option value="Open to Offers">Open to Offers</option>
                  <option value="Currently Employed">Currently Employed</option>
                </select>
              </div>
            </div>
          )}

          {/* --- TRAINING & ELIGIBILITY TAB --- */}
          {activeTab === "training" && !isAdmin && !isEmployer && (
            <div className="profile-field-group">
              <h3 className="profile-section-title">Technical/Vocational Training</h3>
              {formData.vocationalTrainings.map((entry, i) => (
                <div key={i} className="repeat-entry-card">
                  <div className="repeat-entry-card-header">
                    <span>Training {i + 1}</span>
                    <button type="button" className="repeat-entry-remove" onClick={() => removeListItem("vocationalTrainings", i)}>Remove</button>
                  </div>
                  <div className="profile-field">
                    <label>Training/Vocational Course</label>
                    <input type="text" value={entry.course || ""} onChange={(e) => updateListItem("vocationalTrainings", i, "course", e.target.value)} />
                  </div>
                  <div className="profile-field">
                    <label>Training Institution</label>
                    <select value={entry.institution || ""} onChange={(e) => updateListItem("vocationalTrainings", i, "institution", e.target.value)}>
                      <option value="">Select</option>
                      {TECH_VOC_INSTITUTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
                      <option value={OTHER_OPTION}>Others / Not Listed</option>
                    </select>
                  </div>
                  {entry.institution === OTHER_OPTION && (
                    <div className="profile-field">
                      <label>Institution Name</label>
                      <input type="text" value={entry.institutionOther || ""} onChange={(e) => updateListItem("vocationalTrainings", i, "institutionOther", e.target.value)} />
                    </div>
                  )}
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label>Duration From</label>
                      <input type="month" value={entry.durationFrom || ""} onChange={(e) => updateListItem("vocationalTrainings", i, "durationFrom", e.target.value)} />
                    </div>
                    <div className="profile-field">
                      <label>Duration To</label>
                      <input type="month" value={entry.durationTo || ""} onChange={(e) => updateListItem("vocationalTrainings", i, "durationTo", e.target.value)} />
                    </div>
                  </div>
                  <div className="profile-field">
                    <label>Certificate Received</label>
                    <input type="text" placeholder="e.g. NC II" value={entry.certificate || ""} onChange={(e) => updateListItem("vocationalTrainings", i, "certificate", e.target.value)} />
                  </div>
                </div>
              ))}
              <button type="button" className="add-row-btn" onClick={() => addListItem("vocationalTrainings", { course: "", institution: "", institutionOther: "", durationFrom: "", durationTo: "", certificate: "" })}>+ Add training</button>

              <h3 className="profile-section-title">Eligibility (Civil Service)</h3>
              {formData.eligibilities.map((entry, i) => (
                <div key={i} className="repeat-entry-card">
                  <div className="repeat-entry-card-header">
                    <span>Eligibility {i + 1}</span>
                    <button type="button" className="repeat-entry-remove" onClick={() => removeListItem("eligibilities", i)}>Remove</button>
                  </div>
                  <div className="profile-field">
                    <label>Eligibility</label>
                    <input type="text" value={entry.name || ""} onChange={(e) => updateListItem("eligibilities", i, "name", e.target.value)} />
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label>Rating</label>
                      <input type="text" value={entry.rating || ""} onChange={(e) => updateListItem("eligibilities", i, "rating", e.target.value)} />
                    </div>
                    <div className="profile-field">
                      <label>Date of Examination</label>
                      <input type="date" value={entry.examDate || ""} onChange={(e) => updateListItem("eligibilities", i, "examDate", e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" className="add-row-btn" onClick={() => addListItem("eligibilities", { name: "", rating: "", examDate: "" })}>+ Add eligibility</button>

              <h3 className="profile-section-title">Professional License (PRC)</h3>
              {formData.professionalLicenses.map((entry, i) => (
                <div key={i} className="repeat-entry-card">
                  <div className="repeat-entry-card-header">
                    <span>License {i + 1}</span>
                    <button type="button" className="repeat-entry-remove" onClick={() => removeListItem("professionalLicenses", i)}>Remove</button>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label>License</label>
                      <input type="text" value={entry.name || ""} onChange={(e) => updateListItem("professionalLicenses", i, "name", e.target.value)} />
                    </div>
                    <div className="profile-field">
                      <label>Valid Until</label>
                      <input type="date" value={entry.validUntil || ""} onChange={(e) => updateListItem("professionalLicenses", i, "validUntil", e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" className="add-row-btn" onClick={() => addListItem("professionalLicenses", { name: "", validUntil: "" })}>+ Add license</button>
            </div>
          )}

          {/* --- NSRP TAB --- */}
          {activeTab === "nsrp" && !isAdmin && (
            <div className="profile-field-group">
              <h3 className="profile-section-title">NSRP Form Details</h3>
              {isEmployer ? (
                <div className="profile-field-group">
                  <div className="profile-field">
                    <label htmlFor="tradeName">Trade Name</label>
                    <input id="tradeName" type="text" name="tradeName" value={formData.tradeName} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="acronym">Acronym</label>
                    <input id="acronym" type="text" name="acronym" value={formData.acronym} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="tin">TIN</label>
                    <input id="tin" type="text" name="tin" value={formData.tin} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="officeType">Office Type</label>
                    <select id="officeType" name="officeType" value={formData.officeType} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="main">Main</option>
                      <option value="branch">Branch</option>
                    </select>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="employerClassificationType">Classification Type</label>
                      <select id="employerClassificationType" name="employerClassificationType" value={formData.employerClassificationType} onChange={handleChange}>
                        <option value="">Select</option>
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                    <div className="profile-field">
                      <label htmlFor="employerClassificationSubtype">Subtype</label>
                      <select id="employerClassificationSubtype" name="employerClassificationSubtype" value={formData.employerClassificationSubtype} onChange={handleChange}>
                        <option value="">Select</option>
                        {formData.employerClassificationType === "public" ? (
                          ["NGA", "LGU", "GOCC", "SUC/LUC"].map(s => <option key={s} value={s}>{s}</option>)
                        ) : formData.employerClassificationType === "private" ? (
                          ["Direct Hire", "Local Recruitment Agency", "Overseas Recruitment Agency", "D.O. 174 Contractor"].map(s => <option key={s} value={s}>{s}</option>)
                        ) : null}
                      </select>
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="totalWorkforceSize">Total Workforce Size</label>
                    <select id="totalWorkforceSize" name="totalWorkforceSize" value={formData.totalWorkforceSize} onChange={handleChange}>
                      <option value="">Select</option>
                      {WORKFORCE_SIZE_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="profile-field">
                    <label>Business Address (Structured)</label>

                    <div className="business-address-sync-row">
                      <label className="custom-checkbox-label" htmlFor="useOnboardingAddress">
                        <input
                          id="useOnboardingAddress"
                          type="checkbox"
                          className="custom-checkbox-input"
                          checked={useOnboardingAddress}
                          disabled={!formData.businessAddress.trim()}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setUseOnboardingAddress(checked);
                            if (checked) {
                              const parsed = parseLocationValue(formData.businessAddress);
                              setFormData((prev) => ({
                                ...prev,
                                businessAddressStructured: {
                                  ...prev.businessAddressStructured,
                                  barangay: parsed.barangay || "",
                                  municipality: parsed.city || "",
                                  province: parsed.province || "",
                                  region: parsed.region || "",
                                },
                              }));
                            }
                          }}
                        />
                        <span className="custom-checkbox-box"></span>
                        <span className="custom-checkbox-text">
                          {formData.businessAddress.trim()
                            ? "Use my business address from onboarding"
                            : "Use my business address from onboarding (none on file — set it under Company Profile first)"}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="repeat-entry-remove"
                        onClick={() => {
                          setUseOnboardingAddress(false);
                          setFormData((prev) => ({
                            ...prev,
                            businessAddressStructured: {
                              ...prev.businessAddressStructured,
                              barangay: "",
                              municipality: "",
                              province: "",
                              region: "",
                            },
                          }));
                        }}
                      >
                        Clear
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: "0.5rem" }}>
                      <input
                        type="text"
                        placeholder="Street"
                        value={formData.businessAddressStructured.street}
                        onChange={(e) => handleNestedChange("businessAddressStructured", "street", e.target.value)}
                      />
                      <LocationSelect
                        value={formData.businessAddressStructured}
                        onChange={(_loc, structured) => {
                          const nextAddress = structured || {
                            barangay: "",
                            municipality: "",
                            province: "",
                            region: "",
                          };
                          setFormData((prev) => ({
                            ...prev,
                            businessAddressStructured: {
                              ...prev.businessAddressStructured,
                              barangay: nextAddress.barangay || "",
                              municipality: nextAddress.city || nextAddress.municipality || "",
                              province: nextAddress.province || "",
                              region: nextAddress.region || "",
                            },
                          }));
                        }}
                        disabled={loading}
                        required={false}
                      />
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="ownerName">Owner / President Name</label>
                    <input id="ownerName" type="text" name="ownerName" value={formData.ownerName} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="contactPersonName">Authorized Contact Person</label>
                    <input id="contactPersonName" type="text" name="contactPersonName" value={formData.contactPersonName} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="contactPersonPosition">Contact Person Position</label>
                    <input id="contactPersonPosition" type="text" name="contactPersonPosition" value={formData.contactPersonPosition} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="fax">Fax</label>
                    <input id="fax" type="text" name="fax" value={formData.fax} onChange={handleChange} />
                  </div>
                </div>
              ) : (
                <div className="profile-field-group">
                  <div className="profile-field">
                    <label htmlFor="civilStatus">Civil Status</label>
                    <select id="civilStatus" name="civilStatus" value={formData.civilStatus} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                      <option value="Live-in">Live-in</option>
                      <option value="Widowed">Widowed</option>
                      <option value="Separated">Separated</option>
                      <option value="Divorced">Divorced</option>
                    </select>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="placeOfBirth">Place of Birth</label>
                    <LocationAutosuggest
                      id="placeOfBirth"
                      value={formData.placeOfBirth}
                      onChange={(v) => setFormData(prev => ({ ...prev, placeOfBirth: v }))}
                      placeholder="Start typing a city or municipality..."
                    />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="citizenship">Citizenship</label>
                    <input id="citizenship" type="text" name="citizenship" value={formData.citizenship} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="religion">Religion</label>
                    <Autosuggest
                      id="religion"
                      value={formData.religion}
                      onChange={(v) => setFormData((prev) => ({ ...prev, religion: v }))}
                      options={RELIGIONS}
                      placeholder="Start typing..."
                    />
                  </div>
                  <h3 className="profile-section-title">Government IDs</h3>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="tin">TIN</label>
                      <input id="tin" type="text" name="tin" value={formData.tin} onChange={handleChange} />
                    </div>
                    <div className="profile-field">
                      <label htmlFor="sssGsisNo">GSIS/SSS ID No.</label>
                      <input id="sssGsisNo" type="text" name="sssGsisNo" value={formData.sssGsisNo} onChange={handleChange} />
                    </div>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="pagibigNo">PAG-IBIG No.</label>
                      <input id="pagibigNo" type="text" name="pagibigNo" value={formData.pagibigNo} onChange={handleChange} />
                    </div>
                    <div className="profile-field">
                      <label htmlFor="philhealthNo">PhilHealth No.</label>
                      <input id="philhealthNo" type="text" name="philhealthNo" value={formData.philhealthNo} onChange={handleChange} />
                    </div>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="height">Height</label>
                      <input id="height" type="text" inputMode="decimal" name="height" placeholder={`e.g. 170 or 5'8"`} value={formData.height} onChange={handleChange} className="number-input" />
                      {heightConverted !== null && <span className="unit-hint">≈ {heightConverted} cm</span>}
                    </div>
                    <div className="profile-field">
                      <label htmlFor="weight">Weight</label>
                      <input id="weight" type="text" inputMode="decimal" name="weight" placeholder="e.g. 65 or 143 lbs" value={formData.weight} onChange={handleChange} className="number-input" />
                      {weightConverted !== null && <span className="unit-hint">≈ {weightConverted} kg</span>}
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="landline">Landline</label>
                    <input id="landline" type="tel" name="landline" value={formData.landline} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="mobileSecondary">Secondary Mobile</label>
                    <input id="mobileSecondary" type="tel" name="mobileSecondary" value={formData.mobileSecondary} onChange={handleChange} />
                  </div>

                  <div className="profile-field">
                    <label>Present Address</label>
                    <input
                      type="text"
                      placeholder="Street"
                      value={formData.presentAddress.street}
                      onChange={(e) => handleNestedChange("presentAddress", "street", e.target.value)}
                    />
                    <LocationSelect
                      value={formData.presentAddress}
                      onChange={(_loc, structured) => {
                        const nextAddress = structured || {
                          barangay: "",
                          municipality: "",
                          province: "",
                          region: "",
                        };
                        setFormData((prev) => ({
                          ...prev,
                          presentAddress: {
                            ...prev.presentAddress,
                            barangay: nextAddress.barangay || "",
                            municipality: nextAddress.city || nextAddress.municipality || "",
                            province: nextAddress.province || "",
                            region: nextAddress.region || "",
                          },
                        }));
                      }}
                      disabled={loading}
                      required={false}
                    />
                  </div>

                  <div className="profile-field">
                    <label>Permanent Address</label>
                    <input
                      type="text"
                      placeholder="Street"
                      value={formData.permanentAddress.street}
                      onChange={(e) => handleNestedChange("permanentAddress", "street", e.target.value)}
                    />
                    <LocationSelect
                      value={formData.permanentAddress}
                      onChange={(_loc, structured) => {
                        const nextAddress = structured || {
                          barangay: "",
                          municipality: "",
                          province: "",
                          region: "",
                        };
                        setFormData((prev) => ({
                          ...prev,
                          permanentAddress: {
                            ...prev.permanentAddress,
                            barangay: nextAddress.barangay || "",
                            municipality: nextAddress.city || nextAddress.municipality || "",
                            province: nextAddress.province || "",
                            region: nextAddress.region || "",
                          },
                        }));
                      }}
                      disabled={loading}
                      required={false}
                    />
                  </div>

                  <div className="profile-field">
                    <label>Disability (select all that apply)</label>
                    <div className="checkbox-group">
                      {["Visual", "Hearing", "Speech", "Physical", "Others"].map((d) => (
                        <label key={d} className="custom-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.disability.includes(d)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData((prev) => ({ ...prev, disability: [...prev.disability, d] }));
                              } else {
                                setFormData((prev) => ({ ...prev, disability: prev.disability.filter((item) => item !== d) }));
                              }
                            }}
                            className="custom-checkbox-input"
                          />
                          <span className="custom-checkbox-box"></span>
                          <span className="custom-checkbox-text">{d}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="profile-field">
                    <label>4Ps Beneficiary</label>
                    <div className="pill-row">
                      <button type="button" className={`pill-btn ${formData.is4psBeneficiary === true ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, is4psBeneficiary: true }))}>Yes</button>
                      <button type="button" className={`pill-btn ${formData.is4psBeneficiary === false ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, is4psBeneficiary: false }))}>No</button>
                    </div>
                  </div>
                  {formData.is4psBeneficiary && (
                    <div className="profile-field">
                      <label htmlFor="_4psHouseholdId">4Ps Household ID</label>
                      <input id="_4psHouseholdId" type="text" name="_4psHouseholdId" value={formData._4psHouseholdId} onChange={handleChange} />
                    </div>
                  )}

                  <div className="profile-field">
                    <label>Are you an OFW?</label>
                    <div className="pill-row">
                      <button type="button" className={`pill-btn ${formData.isOfw === true ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isOfw: true }))}>Yes</button>
                      <button type="button" className={`pill-btn ${formData.isOfw === false ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isOfw: false }))}>No</button>
                    </div>
                  </div>
                  {formData.isOfw && (
                    <>
                      <div className="profile-field">
                        <label>Repatriated / planning to return to PH?</label>
                        <div className="pill-row">
                          <button type="button" className={`pill-btn ${formData.isRepatriated === true ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isRepatriated: true }))}>Yes</button>
                          <button type="button" className={`pill-btn ${formData.isRepatriated === false ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isRepatriated: false }))}>No</button>
                        </div>
                      </div>
                      {formData.isRepatriated && (
                        <div className="profile-field">
                          <label htmlFor="repatriationIntent">Repatriation Intent</label>
                          <input id="repatriationIntent" type="text" name="repatriationIntent" value={formData.repatriationIntent} onChange={handleChange} placeholder="e.g., Return to PH to work" />
                        </div>
                      )}
                      <div className="profile-field-grid">
                        <div className="profile-field">
                          <label htmlFor="passportNo">Passport No.</label>
                          <input id="passportNo" type="text" name="passportNo" value={formData.passportNo} onChange={handleChange} />
                        </div>
                        <div className="profile-field">
                          <label htmlFor="passportExpiryDate">Passport Expiry Date</label>
                          <input id="passportExpiryDate" type="date" name="passportExpiryDate" value={formData.passportExpiryDate} onChange={handleChange} />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="profile-field">
                    <label>Employment Status</label>
                    <div className="pill-row">
                      <button type="button" className={`pill-btn ${formData.employmentStatus === "employed" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentStatus: "employed" }))}>Employed</button>
                      <button type="button" className={`pill-btn ${formData.employmentStatus === "unemployed" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentStatus: "unemployed" }))}>Unemployed</button>
                    </div>
                  </div>
                  {formData.employmentStatus === "employed" && (
                    <div className="profile-field">
                      <label>Employment Type</label>
                      <div className="pill-row">
                        <button type="button" className={`pill-btn ${formData.employmentType === "wage" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentType: "wage" }))}>Wage</button>
                        <button type="button" className={`pill-btn ${formData.employmentType === "self" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentType: "self" }))}>Self</button>
                      </div>
                    </div>
                  )}
                  {formData.employmentStatus === "unemployed" && (
                    <>
                      <div className="profile-field">
                        <label htmlFor="unemploymentReason">Reason for Unemployment</label>
                        <select id="unemploymentReason" name="unemploymentReason" value={formData.unemploymentReason} onChange={handleChange}>
                          <option value="">Select</option>
                          <option value="fresh_grad">Fresh Graduate</option>
                          <option value="finished_contract">Finished Contract</option>
                          <option value="resigned">Resigned</option>
                          <option value="retired">Retired</option>
                          <option value="laidoff_local">Laid off (Local)</option>
                          <option value="laidoff_abroad">Laid off (Abroad)</option>
                        </select>
                      </div>
                      {formData.unemploymentReason === "laidoff_abroad" && (
                        <div className="profile-field">
                          <label htmlFor="laidoffCountry">Country</label>
                          <input id="laidoffCountry" type="text" name="laidoffCountry" value={formData.laidoffCountry} onChange={handleChange} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* --- DOCUMENTS TAB --- */}
          {activeTab === "documents" && !isAdmin && (
            <div className="profile-field-group">
              <h3 className="profile-section-title"><FaFileAlt /> Documents</h3>
              {isEmployer ? (
                <>
                  {(user?.verificationStatus === "pending" || user?.verificationStatus === "verified") && (
                    <p className="profile-hint">
                      {user.verificationStatus === "pending"
                        ? "Your documents are under review — they can't be changed until LMD Admin makes a decision."
                        : "Your account is verified and these documents are locked."}
                    </p>
                  )}
                  <FileDropzone
                    id="businessPermitUpload"
                    label="Business Permit"
                    hint="Accepted formats: PDF, DOC, JPG, PNG. Max 10 MB."
                    file={businessPermitFile}
                    existingUrl={existingBusinessPermit}
                    disabled={user?.verificationStatus === "pending" || user?.verificationStatus === "verified"}
                    onFileSelect={(file) => {
                      setBusinessPermitFile(file);
                      setDocumentClearFlags((prev) => ({ ...prev, businessPermit: false }));
                    }}
                    onRemove={() => {
                      setBusinessPermitFile(null);
                      setDocumentClearFlags((prev) => ({ ...prev, businessPermit: true }));
                    }}
                  />
                  <FileDropzone
                    id="registrationDocUpload"
                    label="DTI / SEC Registration"
                    hint="Accepted formats: PDF, DOC, JPG, PNG. Max 10 MB."
                    file={registrationDocFile}
                    existingUrl={existingRegistrationDoc}
                    disabled={user?.verificationStatus === "pending" || user?.verificationStatus === "verified"}
                    onFileSelect={(file) => {
                      setRegistrationDocFile(file);
                      setDocumentClearFlags((prev) => ({ ...prev, registrationDoc: false }));
                    }}
                    onRemove={() => {
                      setRegistrationDocFile(null);
                      setDocumentClearFlags((prev) => ({ ...prev, registrationDoc: true }));
                    }}
                  />

                  <div className="employer-verify-block">
                    <h4>Verification</h4>
                    <p className="profile-hint">
                      Current status: <strong>{user?.verificationStatus || "unverified"}</strong>
                    </p>
                    {user?.verificationStatus === "rejected" && user?.verificationNote ? (
                      <p className="profile-error-text">Admin note: {user.verificationNote}</p>
                    ) : null}
                    {user?.verificationStatus === "pending" ? (
                      <p className="profile-hint">
                        Your documents are under review by LMD Admin. You&apos;ll be notified and messaged with the result.
                      </p>
                    ) : user?.verificationStatus === "verified" ? (
                      <p className="profile-hint">Your account is verified — you can post job vacancies.</p>
                    ) : (
                      <>
                        <p className="profile-hint">
                          Save your profile after adding both documents, then submit them for admin review.
                        </p>
                        <button
                          type="button"
                          className="profile-save-btn"
                          disabled={verifySubmitting || !existingBusinessPermit || !existingRegistrationDoc}
                          onClick={handleSubmitVerification}
                        >
                          {verifySubmitting ? "Submitting…" : "Submit documents for review"}
                        </button>
                      </>
                    )}
                    {verifyMsg ? <p className="profile-hint">{verifyMsg}</p> : null}
                  </div>
                </>
              ) : (
                <>
                  <FileDropzone
                    id="profileUpload"
                    label="Resume"
                    hint="Accepted formats: PDF, DOC, JPG, PNG. Max 10 MB."
                    file={resumeFile}
                    existingUrl={existingResume}
                    onFileSelect={(file) => {
                      setResumeFile(file);
                      setDocumentClearFlags((prev) => ({ ...prev, resume: false }));
                    }}
                    onRemove={() => {
                      setResumeFile(null);
                      setDocumentClearFlags((prev) => ({ ...prev, resume: true }));
                    }}
                  />
                  <FileDropzone
                    id="supportingUpload"
                    label="Valid ID / Supporting Documents"
                    hint="Accepted formats: PDF, DOC, JPG, PNG. Max 10 MB."
                    file={supportingDocumentFile}
                    existingUrl={existingValidId}
                    onFileSelect={(file) => {
                      setSupportingDocumentFile(file);
                      setDocumentClearFlags((prev) => ({ ...prev, validId: false }));
                    }}
                    onRemove={() => {
                      setSupportingDocumentFile(null);
                      setDocumentClearFlags((prev) => ({ ...prev, validId: true }));
                    }}
                  />
                </>
              )}
            </div>
          )}
          </div>
          </div>
        </form>

        <div className="editprofile-footer">
          <div className="editprofile-footer-inner">
            <button type="submit" form="edit-profile-form" disabled={loading} className="profile-save-btn">
              <FaSave /> {loading ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}