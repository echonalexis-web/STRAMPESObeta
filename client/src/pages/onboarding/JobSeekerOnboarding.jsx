import { useContext, useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { authAPI } from "../../services/api";
import "../../styles/onboarding.css";
import LocationSelect from "../../components/LocationSelect";
import { parseLocationValue } from "../../utils/locationParser";
import LocationAutosuggest from "../../components/LocationAutosuggest";
import Autosuggest from "../../components/Autosuggest";
import AvatarPicker from "../../components/AvatarPicker";
import { usePersistentState } from "../../hooks/usePersistentState";
import marinduqueSchools from "../../data/marinduque_schools.json";
import collegeCourses from "../../data/philippine_college_courses.json";
import { parseHeightToCm, parseWeightToKg, wasConverted } from "../../utils/unitConversion";

// STRAM PESO accounts are for ages 15 and up (SPES applicants may be 15–30).
const MIN_AGE = 15;
const isOldEnough = (dateOfBirth) => {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - MIN_AGE);
  return dob <= cutoff;
};

const RELIGIONS = [
  "Roman Catholic", "Islam", "Iglesia ni Cristo", "Evangelical", "Aglipayan (Philippine Independent Church)",
  "Seventh-day Adventist", "United Church of Christ in the Philippines (UCCP)", "Bible Baptist Church",
  "Jehovah's Witnesses", "Members Church of God International (Ang Dating Daan)", "United Pentecostal Church",
  "Church of Jesus Christ of Latter-day Saints", "Baptist", "United Methodist Church", "Born Again Christian",
  "Buddhist", "Philippine Benevolent Missionaries Association (PBMA)", "Others",
];

const suggestedSkills = [
  "Computer Literacy", "Driving", "Cooking", "Carpentry", "Caregiving", "Typing",
  "Customer Service", "Communication", "Problem Solving", "Teamwork", "Leadership", "Time Management",
];

const INDUSTRY_OPTIONS = [
  "Information Technology (IT)", "Healthcare", "Finance & Banking", "Education",
  "Construction & Engineering", "Manufacturing", "Retail & Wholesale", "Hospitality & Tourism",
  "Transportation & Logistics", "Agriculture", "Media & Communications", "Real Estate",
  "Government & Public Administration", "Legal Services", "Telecommunications",
  "Marketing & Advertising", "Arts & Entertainment", "Human Resources", "Customer Service",
  "Environmental Services", "Others"
];

const INDUSTRY_SKILLS = {
  "Information Technology (IT)": ["Computer Literacy", "Typing", "Troubleshooting", "Data Entry", "Software Installation"],
  "Healthcare": ["Caregiving", "First Aid", "Patient Care", "Attention to Detail", "Vital Signs Monitoring"],
  "Finance & Banking": ["Bookkeeping", "Cash Handling", "Data Entry", "Attention to Detail", "Customer Service"],
  "Education": ["Communication", "Lesson Planning", "Public Speaking", "Patience", "Mentoring"],
  "Construction & Engineering": ["Carpentry", "Blueprint Reading", "Manual Labor", "Equipment Operation", "Safety Compliance"],
  "Manufacturing": ["Quality Control", "Machine Operation", "Assembly", "Safety Compliance", "Time Management"],
  "Retail & Wholesale": ["Customer Service", "Cash Handling", "Inventory Management", "Sales", "Communication"],
  "Hospitality & Tourism": ["Customer Service", "Cooking", "Housekeeping", "Communication", "Teamwork"],
  "Transportation & Logistics": ["Driving", "Route Planning", "Inventory Management", "Time Management", "Safety Compliance"],
  "Agriculture": ["Farming", "Manual Labor", "Equipment Operation", "Livestock Care", "Time Management"],
  "Media & Communications": ["Writing", "Communication", "Social Media", "Video Editing", "Public Speaking"],
  "Real Estate": ["Sales", "Communication", "Negotiation", "Customer Service", "Time Management"],
  "Government & Public Administration": ["Data Entry", "Communication", "Record Keeping", "Attention to Detail", "Customer Service"],
  "Legal Services": ["Research", "Attention to Detail", "Communication", "Record Keeping", "Confidentiality"],
  "Telecommunications": ["Troubleshooting", "Customer Service", "Technical Support", "Communication", "Problem Solving"],
  "Marketing & Advertising": ["Social Media", "Communication", "Creativity", "Sales", "Writing"],
  "Arts & Entertainment": ["Creativity", "Communication", "Teamwork", "Time Management", "Public Speaking"],
  "Human Resources": ["Communication", "Recruitment", "Record Keeping", "Conflict Resolution", "Organization"],
  "Customer Service": ["Customer Service", "Communication", "Problem Solving", "Patience", "Teamwork"],
  "Environmental Services": ["Manual Labor", "Safety Compliance", "Attention to Detail", "Teamwork", "Equipment Operation"],
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const STEP_LABELS = [
  "Personal Details",
  "Preferred Industries",
  "Skills",
  "Job Preferences",
  "Work Background",
  "Training & Eligibility",
  "NSRP Demographics",
  "Additional Demographics",
  "Profile Photo",
];
const LAST_STEP = STEP_LABELS.length;
const SUCCESS_STEP = LAST_STEP + 1;

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
const TECH_VOC_INSTITUTIONS = (marinduqueSchools.technical_vocational_schools || []).map((s) => s.name);
const LANGUAGE_SKILLS = [
  { key: "read", label: "Read" },
  { key: "write", label: "Write" },
  { key: "speak", label: "Speak" },
  { key: "understand", label: "Understand" },
];
const OTHER_OPTION = "__other__";

const emptyLanguageRow = () => ({ read: false, write: false, speak: false, understand: false });

const getInitialForm = (user) => ({
  surname: user?.surname || "",
  firstName: user?.firstName || "",
  middleName: user?.middleName || "",
  suffix: user?.suffix || "",
  phone: user?.phone || "",
  dateOfBirth: user?.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : "",
  gender: user?.gender || "",
  address: user?.address || "",

  // Job Preferences
  preferredOccupations: [],
  preferredWorkLocationLocal: [],
  preferredWorkLocationOverseas: [],
  expectedSalaryMin: "",
  expectedSalaryMax: "",
  availabilityStatus: user?.availabilityStatus || "",

  // Work Background
  educationalAttainment: user?.educationalAttainment || "",
  workExperience: user?.workExperience || "",
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

  // Training & Eligibility
  vocationalTrainings: [],
  eligibilities: [],
  professionalLicenses: [],

  // NSRP Demographics
  civilStatus: "",
  placeOfBirth: "",
  citizenship: "",
  height: "",
  weight: "",
  religion: "",
  tin: "",
  sssGsisNo: "",
  pagibigNo: "",
  philhealthNo: "",
  landline: "",
  mobileSecondary: "",
  presentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
  permanentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },

  // Additional Demographics
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
});

function CappedChipField({ label, hint, placeholder, values, cap, onAdd, onRemove, disabled }) {
  const [input, setInput] = useState("");
  const atCap = values.length >= cap;
  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed || atCap) return;
    onAdd(trimmed);
    setInput("");
  };
  return (
    <div>
      <span className="onboarding-label">{label} ({values.length}/{cap})</span>
      {hint && <p className="onboarding-hint" style={{ marginTop: "0.25rem" }}>{hint}</p>}
      <div className="skills-entry-row">
        <input
          type="text"
          value={input}
          placeholder={atCap ? `Maximum of ${cap} reached` : placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          disabled={disabled || atCap}
        />
        <button type="button" className="onboarding-add-btn" onClick={handleAdd} disabled={disabled || atCap}>Add</button>
      </div>
      <div className="skills-tags-wrap">
        {values.map((v) => (
          <span key={v} className="skill-pill">{v} <button type="button" onClick={() => onRemove(v)} disabled={disabled}>×</button></span>
        ))}
      </div>
    </div>
  );
}

function RepeatEntryCard({ title, onRemove, disabled, children }) {
  return (
    <div className="onboarding-repeat-card">
      <div className="onboarding-repeat-card-header">
        <span>{title}</span>
        <button type="button" className="onboarding-repeat-remove" onClick={onRemove} disabled={disabled}>Remove</button>
      </div>
      <div className="onboarding-fields">{children}</div>
    </div>
  );
}

export default function JobSeekerOnboarding() {
  const { user, login, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const defaultState = {
    form: getInitialForm(user),
    preferredIndustries: [],
    industryPreferenceLevel: 'flexible',
    skills: [],
    step: 1,
  };

  // Normalize form to ensure all nested objects exist
  const normalizeForm = (formData) => {
    const defaultForm = getInitialForm(user);
    return {
      ...defaultForm,
      ...formData,
      presentAddress: { ...defaultForm.presentAddress, ...(formData?.presentAddress || {}) },
      permanentAddress: { ...defaultForm.permanentAddress, ...(formData?.permanentAddress || {}) },
      disability: Array.isArray(formData?.disability) ? formData.disability : [],
      preferredOccupations: Array.isArray(formData?.preferredOccupations) ? formData.preferredOccupations : [],
      preferredWorkLocationLocal: Array.isArray(formData?.preferredWorkLocationLocal) ? formData.preferredWorkLocationLocal : [],
      preferredWorkLocationOverseas: Array.isArray(formData?.preferredWorkLocationOverseas) ? formData.preferredWorkLocationOverseas : [],
      workHistory: Array.isArray(formData?.workHistory) ? formData.workHistory : [],
      vocationalTrainings: Array.isArray(formData?.vocationalTrainings) ? formData.vocationalTrainings : [],
      eligibilities: Array.isArray(formData?.eligibilities) ? formData.eligibilities : [],
      professionalLicenses: Array.isArray(formData?.professionalLicenses) ? formData.professionalLicenses : [],
      languageProficiency: {
        English: { ...defaultForm.languageProficiency.English, ...(formData?.languageProficiency?.English || {}) },
        Filipino: { ...defaultForm.languageProficiency.Filipino, ...(formData?.languageProficiency?.Filipino || {}) },
        Others: { ...defaultForm.languageProficiency.Others, ...(formData?.languageProficiency?.Others || {}) },
      },
    };
  };

  const [persistedState, setPersistedState, clearPersistedState] = usePersistentState('jobseekerOnboarding', defaultState);

  // Safe destructuring: if persistedState is invalid, use defaultState
  const safeState = (persistedState && typeof persistedState === 'object' && persistedState.form)
    ? { ...persistedState, form: normalizeForm(persistedState.form) }
    : defaultState;

  const { form, preferredIndustries, industryPreferenceLevel, skills, step } = safeState;

  // Update individual pieces – ensure we always merge with the current state
  const setForm = (updater) => setPersistedState(prev => {
    const currentState = prev || defaultState;
    // Normalize first: a draft saved to localStorage before a field existed
    // (e.g. languageProficiency) won't have it, and updaters assume it's there.
    const normalizedCurrentForm = normalizeForm(currentState.form);
    const newForm = typeof updater === 'function' ? updater(normalizedCurrentForm) : updater;
    return { ...currentState, form: newForm };
  });
  const setPreferredIndustries = (updater) => setPersistedState(prev => {
    const currentState = prev || defaultState;
    const newVal = typeof updater === 'function' ? updater(currentState.preferredIndustries) : updater;
    return { ...currentState, preferredIndustries: newVal };
  });
  const setIndustryPreferenceLevel = (updater) => setPersistedState(prev => {
    const currentState = prev || defaultState;
    const newVal = typeof updater === 'function' ? updater(currentState.industryPreferenceLevel) : updater;
    return { ...currentState, industryPreferenceLevel: newVal };
  });
  const setSkills = (updater) => setPersistedState(prev => {
    const currentState = prev || defaultState;
    const newVal = typeof updater === 'function' ? updater(currentState.skills) : updater;
    return { ...currentState, skills: newVal };
  });
  const setStep = (updater) => setPersistedState(prev => {
    const currentState = prev || defaultState;
    const newVal = typeof updater === 'function' ? updater(currentState.step) : updater;
    return { ...currentState, step: newVal };
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [skillInput, setSkillInput] = useState("");
  // Set once the profile is submitted so the success screen isn't pre-empted by
  // the "already completed" redirect below once the auth context updates.
  const [finished, setFinished] = useState(false);

  const errorModalButtonRef = useRef(null);

  useEffect(() => {
    if (!error) return;
    errorModalButtonRef.current?.focus();
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setError("");
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [error]);

  const industrySuggestions = useMemo(() => {
    const fromIndustries = preferredIndustries.flatMap(ind => INDUSTRY_SKILLS[ind] || []);
    const deduped = [...new Set(fromIndustries)];
    return deduped.filter(skill => !skills.includes(skill));
  }, [preferredIndustries, skills]);

  const genericSuggestions = useMemo(() => {
    return suggestedSkills.filter(skill => !skills.includes(skill) && !industrySuggestions.includes(skill));
  }, [skills, industrySuggestions]);
  const [resumeFile, setResumeFile] = useState(null);
  const [validIdFile, setValidIdFile] = useState(null);
  const [resumeError, setResumeError] = useState("");
  const [validIdError, setValidIdError] = useState("");

  // On mount, if user has onboarding completed, redirect
  useEffect(() => {
    if (!finished && (user?.hasCompletedOnboarding === true || user?.onboardingComplete === true)) {
      const role = user?.role || "resident";
      if (role === "employer") navigate("/employer-dashboard");
      else navigate("/dashboard");
    }
    // If no persisted state exists, or it's corrupted, reset to user data
    if (user && !localStorage.getItem('jobseekerOnboarding')) {
      setForm(getInitialForm(user));
    }
  }, [user, navigate, finished]);

  const progress = useMemo(() => (Math.min(step, LAST_STEP) / LAST_STEP) * 100, [step]);

  const schoolOptions = useMemo(() => getSchoolOptions(form.educationalAttainment), [form.educationalAttainment]);
  const showCourseField = COURSE_ATTAINMENTS.includes(form.educationalAttainment);

  const heightCm = useMemo(() => parseHeightToCm(form.height), [form.height]);
  const heightConverted = heightCm !== null && wasConverted(form.height, heightCm) ? heightCm : null;
  const weightKg = useMemo(() => parseWeightToKg(form.weight), [form.weight]);
  const weightConverted = weightKg !== null && wasConverted(form.weight, weightKg) ? weightKg : null;

  const updateField = (name, value) => setForm(prev => ({ ...prev, [name]: value }));

  const updateAddress = (type, field, value) => {
    setForm(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value }
    }));
  };

  const addListItem = (field, template) => setForm(prev => ({ ...prev, [field]: [...(prev[field] || []), template] }));
  const updateListItem = (field, index, key, value) => setForm(prev => {
    const list = [...(prev[field] || [])];
    list[index] = { ...list[index], [key]: value };
    return { ...prev, [field]: list };
  });
  const removeListItem = (field, index) => setForm(prev => ({ ...prev, [field]: (prev[field] || []).filter((_, i) => i !== index) }));

  const addToCappedList = (field, value) => setForm(prev => ({ ...prev, [field]: [...(prev[field] || []), value] }));
  const removeFromCappedList = (field, value) => setForm(prev => ({ ...prev, [field]: (prev[field] || []).filter(v => v !== value) }));

  const toggleLanguageSkill = (language, skillKey) => setForm(prev => ({
    ...prev,
    languageProficiency: {
      ...prev.languageProficiency,
      [language]: { ...prev.languageProficiency[language], [skillKey]: !prev.languageProficiency[language][skillKey] },
    },
  }));

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
    if (skills.some(skill => skill.toLowerCase() === trimmed.toLowerCase())) return;
    setSkills(prev => [...prev, trimmed]);
  };

  const handleAddSkill = () => { addSkill(skillInput); setSkillInput(""); };
  const handleSkillKeyDown = (e) => { if (e.key === "Enter") { e.preventDefault(); handleAddSkill(); } };

  const validateFile = (file, type) => {
    if (!file) {
      if (type === "resume") setResumeError("Resume file is required");
      if (type === "validId") setValidIdError("Valid ID file is required");
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      const msg = `File size exceeds 5MB limit. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.`;
      if (type === "resume") setResumeError(msg);
      if (type === "validId") setValidIdError(msg);
      return false;
    }
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (type === "resume" && !allowedTypes.includes(file.type)) {
      setResumeError("Invalid file type. Please upload PDF, DOC, or DOCX files.");
      return false;
    }
    const allowedTypesWithImages = [...allowedTypes, 'image/jpeg', 'image/png', 'image/jpg'];
    if (type === "validId" && !allowedTypesWithImages.includes(file.type)) {
      setValidIdError("Invalid file type. Please upload PDF, DOC, DOCX, JPG, or PNG files.");
      return false;
    }
    if (type === "resume") setResumeError("");
    if (type === "validId") setValidIdError("");
    return true;
  };

  const handleResumeChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && validateFile(file, "resume")) setResumeFile(file);
    else { setResumeFile(null); e.target.value = ''; }
  };

  const handleValidIdChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && validateFile(file, "validId")) setValidIdFile(file);
    else { setValidIdFile(null); e.target.value = ''; }
  };

  const handleNext = () => {
    setError("");
    if (step === 1) {
      if (!form.surname?.trim()) return setError("Please enter your surname.");
      if (!form.firstName?.trim()) return setError("Please enter your first name.");
      if (!form.phone?.trim()) return setError("Please enter your phone number.");
      if (!form.dateOfBirth) return setError("Please enter your date of birth.");
      if (!isOldEnough(form.dateOfBirth)) return setError(`You must be at least ${MIN_AGE} years old to use STRAM PESO.`);
      if (!form.gender) return setError("Please select your gender.");
      if (!form.address?.trim()) return setError("Please enter your home address.");
    }
    if (step === 2 && preferredIndustries.length < 1) {
      setError("Please select at least one preferred industry.");
      return;
    }
    if (step === 3 && skills.length < 1) {
      setError("Please add at least one skill before continuing.");
      return;
    }
    if (step === 4) {
      if (form.preferredOccupations.length < 1) return setError("Please add at least one preferred occupation.");
      if (!form.availabilityStatus) return setError("Please select your availability status.");
    }
    if (step === 5) {
      if (!form.educationalAttainment) return setError("Please select your educational attainment.");
      if (!form.workExperience) return setError("Please select your work experience.");
    }
    // Step 6 (Training & Eligibility) is fully optional / skippable.
    if (step === 7) {
      if (!form.civilStatus) return setError("Please select your civil status.");
      if (!form.citizenship?.trim()) return setError("Please enter your citizenship.");
      if (!form.placeOfBirth?.trim()) return setError("Please enter your place of birth.");
      const pa = form.presentAddress;
      if (!pa.region || !pa.province || !pa.municipality || !pa.barangay) {
        return setError("Please complete your present address.");
      }
    }
    if (step === 8) {
      const finalStepError = validateFinalStep();
      if (finalStepError) return setError(finalStepError);
    }
    // Step 9 (Profile Photo) is optional.
    setStep(prev => Math.min(prev + 1, SUCCESS_STEP));
  };

  const validateFinalStep = () => {
    if (!form.employmentStatus) return "Please select your employment status.";
    if (form.employmentStatus === "employed" && !form.employmentType) return "Please select your employment type.";
    if (form.employmentStatus === "unemployed") {
      if (!form.unemploymentReason) return "Please select your reason for unemployment.";
      if (form.unemploymentReason === "laidoff_abroad" && !form.laidoffCountry?.trim()) {
        return "Please enter the country where you were laid off.";
      }
    }
    return "";
  };

  const handleBack = () => {
    setError("");
    setStep(prev => Math.max(prev - 1, 1));
  };

  const submitProfile = async () => {
    setError("");
    const finalStepError = validateFinalStep();
    if (finalStepError) {
      setError(finalStepError);
      return;
    }
    setSaving(true);
    try {
      const data = new FormData();
      const composedName = [form.firstName, form.middleName, form.surname, form.suffix].filter(Boolean).join(" ");
      data.append("name", composedName);
      data.append("surname", form.surname || "");
      data.append("firstName", form.firstName || "");
      data.append("middleName", form.middleName || "");
      data.append("suffix", form.suffix || "");
      data.append("phone", form.phone || "");
      data.append("dateOfBirth", form.dateOfBirth || "");
      data.append("gender", form.gender || "");
      data.append("address", form.address || "");
      data.append("workExperience", form.workExperience || "");
      data.append("educationalAttainment", form.educationalAttainment || "");
      data.append("availabilityStatus", form.availabilityStatus || "");
      data.append("skills", JSON.stringify(skills));
      data.append("onboardingComplete", "true");
      data.append("hasCompletedOnboarding", "true");

      data.append("preferredIndustries", JSON.stringify(preferredIndustries));
      data.append("industryPreferenceLevel", industryPreferenceLevel);
      data.append("industrySelectionStep", "true");

      // Job Preferences
      data.append("preferredOccupations", JSON.stringify(form.preferredOccupations));
      data.append("preferredWorkLocationLocal", JSON.stringify(form.preferredWorkLocationLocal));
      data.append("preferredWorkLocationOverseas", JSON.stringify(form.preferredWorkLocationOverseas));
      data.append("expectedSalaryMin", form.expectedSalaryMin || "");
      data.append("expectedSalaryMax", form.expectedSalaryMax || "");

      // Work Background detail
      data.append("schoolAttended", form.schoolAttended || "");
      data.append("schoolAttendedOther", form.schoolAttendedOther || "");
      data.append("course", form.course || "");
      data.append("yearGraduated", form.yearGraduated || "");
      data.append("languageProficiency", JSON.stringify(form.languageProficiency));
      data.append("languageOthersLabel", form.languageOthersLabel || "");
      data.append("workHistory", JSON.stringify(form.workHistory));

      // Training & Eligibility
      data.append("vocationalTrainings", JSON.stringify(form.vocationalTrainings));
      data.append("eligibilities", JSON.stringify(form.eligibilities));
      data.append("professionalLicenses", JSON.stringify(form.professionalLicenses));

      // NSRP Demographics
      data.append("civilStatus", form.civilStatus || "");
      data.append("placeOfBirth", form.placeOfBirth || "");
      data.append("citizenship", form.citizenship || "");
      data.append("height", heightCm ?? "");
      data.append("weight", weightKg ?? "");
      data.append("religion", form.religion || "");
      data.append("tin", form.tin || "");
      data.append("sssGsisNo", form.sssGsisNo || "");
      data.append("pagibigNo", form.pagibigNo || "");
      data.append("philhealthNo", form.philhealthNo || "");
      data.append("landline", form.landline || "");
      data.append("mobileSecondary", form.mobileSecondary || "");
      data.append("presentAddress", JSON.stringify(form.presentAddress));
      data.append("permanentAddress", JSON.stringify(form.permanentAddress));

      // Additional Demographics
      data.append("disability", JSON.stringify(form.disability));
      data.append("is4psBeneficiary", form.is4psBeneficiary ? "true" : "false");
      data.append("_4psHouseholdId", form._4psHouseholdId || "");
      data.append("isOfw", form.isOfw ? "true" : "false");
      data.append("isRepatriated", form.isRepatriated ? "true" : "false");
      data.append("repatriationIntent", form.repatriationIntent || "");
      data.append("passportNo", form.passportNo || "");
      data.append("passportExpiryDate", form.passportExpiryDate || "");
      data.append("employmentStatus", form.employmentStatus || "");
      data.append("employmentType", form.employmentType || "");
      data.append("unemploymentReason", form.unemploymentReason || "");
      data.append("laidoffCountry", form.laidoffCountry || "");

      if (resumeFile) data.append("resumeFile", resumeFile);
      if (validIdFile) data.append("validIdFile", validIdFile);

      const { data: response } = await authAPI.updateProfile(data);
      const token = localStorage.getItem("token");
      if (token && response.user) login(token, response.user);
      // Clear persisted state on success
      clearPersistedState();
      setFinished(true);
      setStep(SUCCESS_STEP);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to complete onboarding. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="onboarding-shell">
      <aside className="onboarding-rail">
        <div className="onboarding-rail-brand">STRAM PESO</div>
        <p className="onboarding-rail-subtitle">Setting up your jobseeker profile</p>
        <div className="onboarding-rail-progress-track">
          <div className="onboarding-rail-progress-fill" style={{ width: `${progress}%` }}></div>
        </div>
        <ol className="onboarding-steps">
          {STEP_LABELS.map((label, i) => {
            const idx = i + 1;
            const state = step > idx || step === SUCCESS_STEP ? "done" : step === idx ? "current" : "upcoming";
            return (
              <li
                key={label}
                className={`onboarding-step-item ${state}`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="onboarding-step-index" aria-hidden="true">{state === "done" ? "✓" : idx}</span>
                <span className="onboarding-step-label">
                  {label}
                  {state === "done" && <span className="sr-only"> (completed)</span>}
                </span>
              </li>
            );
          })}
        </ol>
        {step <= LAST_STEP && <div className="onboarding-rail-autosave">Draft saved automatically</div>}
      </aside>

      <div className="onboarding-panel">
        <section className="onboarding-card">
          {step <= LAST_STEP && (
            <div className="onboarding-progress-mobile">
              <div className="onboarding-progress-meta">Step {step} of {LAST_STEP} · {STEP_LABELS[step - 1]}</div>
              <div className="onboarding-progress-track"><div className="onboarding-progress-fill" style={{ width: `${progress}%` }}></div></div>
            </div>
          )}
      {step === 1 && (
        <div className="onboarding-step">
          <h2>Personal Details</h2>
          <p className="onboarding-subtitle">Tell us about yourself so employers can get to know you.</p>
          <div className="onboarding-fields">
            <div className="onboarding-field-grid">
              <label>Surname <input type="text" value={form.surname || ""} onChange={e => updateField("surname", e.target.value)} disabled={saving} /></label>
              <label>First Name <input type="text" value={form.firstName || ""} onChange={e => updateField("firstName", e.target.value)} disabled={saving} /></label>
            </div>
            <div className="onboarding-field-grid">
              <label>Middle Name <span className="onboarding-optional">(optional)</span><input type="text" value={form.middleName || ""} onChange={e => updateField("middleName", e.target.value)} disabled={saving} /></label>
              <label>Suffix <span className="onboarding-optional">(optional)</span><input type="text" placeholder="Jr., III, etc." value={form.suffix || ""} onChange={e => updateField("suffix", e.target.value)} disabled={saving} /></label>
            </div>
            <label>Phone Number <input type="tel" value={form.phone || ""} onChange={e => updateField("phone", e.target.value)} disabled={saving} /></label>
            <label>Date of Birth <input type="date" value={form.dateOfBirth || ""} onChange={e => updateField("dateOfBirth", e.target.value)} disabled={saving} /></label>
            <div>
              <span className="onboarding-label">Gender</span>
              <div className="pill-row">
                {["Male", "Female", "Prefer not to say"].map(opt => (
                  <button key={opt} type="button" className={`pill-btn ${form.gender === opt ? "active" : ""}`} onClick={() => updateField("gender", opt)} disabled={saving}>{opt}</button>
                ))}
              </div>
            </div>
            <div>
              <span className="onboarding-label">Home Address / Municipality</span>
              <LocationSelect
                value={form.address || ""}
                onChange={(loc) => updateField("address", loc)}
                disabled={saving}
                required
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="onboarding-step">
          <h2>Preferred Industries</h2>
          <p className="onboarding-subtitle">Select the industries you are most interested in working in.</p>
          <div className="industry-pills-grid">
            {INDUSTRY_OPTIONS.map(ind => (
              <button
                key={ind}
                type="button"
                className={`industry-pill ${preferredIndustries.includes(ind) ? "active" : ""}`}
                onClick={() => toggleIndustry(ind)}
                disabled={saving}
              >
                {ind}
              </button>
            ))}
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <span className="onboarding-label">Preference Mode</span>
            <div className="pill-row">
              <button
                type="button"
                className={`pill-btn ${industryPreferenceLevel === "flexible" ? "active" : ""}`}
                onClick={() => setIndustryPreferenceLevel("flexible")}
                disabled={saving}
              >
                Flexible (Show all jobs, prioritize these)
              </button>
              <button
                type="button"
                className={`pill-btn ${industryPreferenceLevel === "strict" ? "active" : ""}`}
                onClick={() => setIndustryPreferenceLevel("strict")}
                disabled={saving}
              >
                Strict (Only show these industries)
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="onboarding-step">
          <h2>What are your skills?</h2>
          <p className="onboarding-subtitle">Add skills that showcase your abilities and experience.</p>
          <div className="skills-entry-row">
            <input type="text" value={skillInput} placeholder="Type a skill and press Enter" onChange={e => setSkillInput(e.target.value)} onKeyDown={handleSkillKeyDown} disabled={saving} />
            <button type="button" className="onboarding-add-btn" onClick={handleAddSkill} disabled={saving}>Add</button>
          </div>
          <div className="skills-tags-wrap">
            {skills.map(skill => (
              <span key={skill} className="skill-pill">{skill} <button type="button" onClick={() => setSkills(prev => prev.filter(s => s !== skill))} disabled={saving}>×</button></span>
            ))}
          </div>
          {industrySuggestions.length > 0 && (
            <>
              <p className="onboarding-hint">Recommended for your industry:</p>
              <div className="suggestions-row">
                {industrySuggestions.map(skill => <button key={skill} type="button" className="suggestion-chip suggestion-chip-recommended" onClick={() => addSkill(skill)} disabled={saving}>+ {skill}</button>)}
              </div>
            </>
          )}
          {genericSuggestions.length > 0 && (
            <>
              <p className="onboarding-hint">All skills:</p>
              <div className="suggestions-row">
                {genericSuggestions.map(skill => <button key={skill} type="button" className="suggestion-chip" onClick={() => addSkill(skill)} disabled={saving}>+ {skill}</button>)}
              </div>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="onboarding-step">
          <h2>Job Preferences</h2>
          <p className="onboarding-subtitle">Tell us what kind of work, location, and pay you're looking for.</p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Preferred Occupations
            </h3>
            <CappedChipField
              label="Occupations"
              hint="List up to 4, in order of preference."
              placeholder="e.g. Administrative Assistant"
              values={form.preferredOccupations}
              cap={4}
              onAdd={(v) => addToCappedList("preferredOccupations", v)}
              onRemove={(v) => removeFromCappedList("preferredOccupations", v)}
              disabled={saving}
            />
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">2</span>
              Preferred Work Location
            </h3>
            <div className="onboarding-fields">
              <CappedChipField
                label="Local (cities / municipalities)"
                placeholder="e.g. Boac, Marinduque"
                values={form.preferredWorkLocationLocal}
                cap={3}
                onAdd={(v) => addToCappedList("preferredWorkLocationLocal", v)}
                onRemove={(v) => removeFromCappedList("preferredWorkLocationLocal", v)}
                disabled={saving}
              />
              <CappedChipField
                label="Overseas (countries)"
                placeholder="e.g. Japan"
                values={form.preferredWorkLocationOverseas}
                cap={3}
                onAdd={(v) => addToCappedList("preferredWorkLocationOverseas", v)}
                onRemove={(v) => removeFromCappedList("preferredWorkLocationOverseas", v)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">3</span>
              Expected Salary <span className="onboarding-optional">(optional)</span>
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>Minimum (₱) <input type="number" min="0" value={form.expectedSalaryMin || ""} onChange={e => updateField("expectedSalaryMin", e.target.value)} disabled={saving} /></label>
                <label>Maximum (₱) <input type="number" min="0" value={form.expectedSalaryMax || ""} onChange={e => updateField("expectedSalaryMax", e.target.value)} disabled={saving} /></label>
              </div>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">4</span>
              Availability
            </h3>
            <div className="onboarding-fields">
              <div>
                <span className="onboarding-label">Availability Status</span>
                <div className="pill-row">
                  {["Actively Looking", "Open to Offers", "Currently Employed"].map(opt => (
                    <button key={opt} type="button" className={`pill-btn ${form.availabilityStatus === opt ? "active" : ""}`} onClick={() => updateField("availabilityStatus", opt)} disabled={saving}>{opt}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="onboarding-step">
          <h2>Work Background</h2>
          <p className="onboarding-subtitle">Your education, language skills, and work history.</p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Educational Attainment
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>Educational Attainment
                  <select value={form.educationalAttainment || ""} onChange={e => { updateField("educationalAttainment", e.target.value); updateField("schoolAttended", ""); updateField("course", ""); }} disabled={saving}>
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
                </label>
                <label>Work Experience
                  <select value={form.workExperience || ""} onChange={e => updateField("workExperience", e.target.value)} disabled={saving}>
                    <option value="">Select</option>
                    <option value="Fresh Graduate">Fresh Graduate</option>
                    <option value="Less than 1 year">Less than 1 year</option>
                    <option value="1-3 years">1-3 years</option>
                    <option value="3-5 years">3-5 years</option>
                    <option value="5+ years">5+ years</option>
                  </select>
                </label>
              </div>

              {schoolOptions.length > 0 && (
                <label>School Attended
                  <select value={form.schoolAttended || ""} onChange={e => updateField("schoolAttended", e.target.value)} disabled={saving}>
                    <option value="">Select</option>
                    {schoolOptions.map(name => <option key={name} value={name}>{name}</option>)}
                    <option value={OTHER_OPTION}>Others / Not Listed</option>
                  </select>
                </label>
              )}
              {form.schoolAttended === OTHER_OPTION && (
                <label>School Name <input type="text" value={form.schoolAttendedOther || ""} onChange={e => updateField("schoolAttendedOther", e.target.value)} disabled={saving} /></label>
              )}
              {showCourseField && (
                <label>Course
                  <select value={form.course || ""} onChange={e => updateField("course", e.target.value)} disabled={saving}>
                    <option value="">Select</option>
                    {Object.entries(COURSE_CATEGORIES).map(([category, courses]) => (
                      <optgroup key={category} label={category}>
                        {courses.map(c => <option key={c} value={c}>{c}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
              <label>Year Graduated <span className="onboarding-optional">(optional)</span>
                <input type="text" inputMode="numeric" maxLength={4} placeholder="e.g. 2022" value={form.yearGraduated || ""} onChange={e => updateField("yearGraduated", e.target.value)} disabled={saving} />
              </label>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">2</span>
              Language / Dialect Proficiency <span className="onboarding-optional">(optional)</span>
            </h3>
            <div className="onboarding-lang-table-wrap">
              <table className="onboarding-lang-table">
                <thead>
                  <tr>
                    <th scope="col">Language</th>
                    {LANGUAGE_SKILLS.map(s => <th key={s.key} scope="col">{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {["English", "Filipino", "Others"].map(lang => (
                    <tr key={lang}>
                      <th scope="row">
                        {lang === "Others" ? (
                          <input
                            type="text"
                            placeholder="Others, specify"
                            value={form.languageOthersLabel || ""}
                            onChange={e => updateField("languageOthersLabel", e.target.value)}
                            disabled={saving}
                          />
                        ) : lang}
                      </th>
                      {LANGUAGE_SKILLS.map(s => (
                        <td key={s.key}>
                          <input
                            type="checkbox"
                            aria-label={`${lang} — ${s.label}`}
                            checked={form.languageProficiency[lang][s.key]}
                            onChange={() => toggleLanguageSkill(lang, s.key)}
                            disabled={saving}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">3</span>
              Work History <span className="onboarding-optional">(optional)</span>
            </h3>
            <p className="onboarding-hint">Add your most recent employers, if any.</p>
            {form.workHistory.map((entry, i) => (
              <RepeatEntryCard key={i} title={`Employer ${i + 1}`} onRemove={() => removeListItem("workHistory", i)} disabled={saving}>
                <div className="onboarding-field-grid">
                  <label>Company Name <input type="text" value={entry.companyName || ""} onChange={e => updateListItem("workHistory", i, "companyName", e.target.value)} disabled={saving} /></label>
                  <label>Address (City/Municipality) <input type="text" value={entry.address || ""} onChange={e => updateListItem("workHistory", i, "address", e.target.value)} disabled={saving} /></label>
                </div>
                <div className="onboarding-field-grid">
                  <label>Position <input type="text" value={entry.position || ""} onChange={e => updateListItem("workHistory", i, "position", e.target.value)} disabled={saving} /></label>
                  <label>Status
                    <select value={entry.status || ""} onChange={e => updateListItem("workHistory", i, "status", e.target.value)} disabled={saving}>
                      <option value="">Select</option>
                      <option value="Permanent">Permanent</option>
                      <option value="Contractual">Contractual</option>
                      <option value="Part-time">Part-time</option>
                      <option value="Probationary">Probationary</option>
                    </select>
                  </label>
                </div>
                <div className="onboarding-field-grid">
                  <label>From <input type="month" value={entry.dateFrom || ""} onChange={e => updateListItem("workHistory", i, "dateFrom", e.target.value)} disabled={saving} /></label>
                  <label>To <input type="month" value={entry.dateTo || ""} onChange={e => updateListItem("workHistory", i, "dateTo", e.target.value)} disabled={saving} /></label>
                </div>
              </RepeatEntryCard>
            ))}
            <button type="button" className="onboarding-add-row-btn" onClick={() => addListItem("workHistory", { companyName: "", address: "", position: "", dateFrom: "", dateTo: "", status: "" })} disabled={saving}>+ Add employer</button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="onboarding-step">
          <h2>Technical/Vocational Training &amp; Eligibility</h2>
          <p className="onboarding-subtitle">Optional — add any training, civil service eligibility, or professional licenses you have. You can skip this step and add these later from your profile.</p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Technical/Vocational Training
            </h3>
            {form.vocationalTrainings.map((entry, i) => (
              <RepeatEntryCard key={i} title={`Training ${i + 1}`} onRemove={() => removeListItem("vocationalTrainings", i)} disabled={saving}>
                <label>Training/Vocational Course <input type="text" value={entry.course || ""} onChange={e => updateListItem("vocationalTrainings", i, "course", e.target.value)} disabled={saving} /></label>
                <label>Training Institution
                  <select value={entry.institution || ""} onChange={e => updateListItem("vocationalTrainings", i, "institution", e.target.value)} disabled={saving}>
                    <option value="">Select</option>
                    {TECH_VOC_INSTITUTIONS.map(name => <option key={name} value={name}>{name}</option>)}
                    <option value={OTHER_OPTION}>Others / Not Listed</option>
                  </select>
                </label>
                {entry.institution === OTHER_OPTION && (
                  <label>Institution Name <input type="text" value={entry.institutionOther || ""} onChange={e => updateListItem("vocationalTrainings", i, "institutionOther", e.target.value)} disabled={saving} /></label>
                )}
                <div className="onboarding-field-grid">
                  <label>Duration From <input type="month" value={entry.durationFrom || ""} onChange={e => updateListItem("vocationalTrainings", i, "durationFrom", e.target.value)} disabled={saving} /></label>
                  <label>Duration To <input type="month" value={entry.durationTo || ""} onChange={e => updateListItem("vocationalTrainings", i, "durationTo", e.target.value)} disabled={saving} /></label>
                </div>
                <label>Certificate Received <input type="text" placeholder="e.g. NC II" value={entry.certificate || ""} onChange={e => updateListItem("vocationalTrainings", i, "certificate", e.target.value)} disabled={saving} /></label>
              </RepeatEntryCard>
            ))}
            <button type="button" className="onboarding-add-row-btn" onClick={() => addListItem("vocationalTrainings", { course: "", institution: "", institutionOther: "", durationFrom: "", durationTo: "", certificate: "" })} disabled={saving}>+ Add training</button>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">2</span>
              Eligibility (Civil Service)
            </h3>
            {form.eligibilities.map((entry, i) => (
              <RepeatEntryCard key={i} title={`Eligibility ${i + 1}`} onRemove={() => removeListItem("eligibilities", i)} disabled={saving}>
                <label>Eligibility <input type="text" value={entry.name || ""} onChange={e => updateListItem("eligibilities", i, "name", e.target.value)} disabled={saving} /></label>
                <div className="onboarding-field-grid">
                  <label>Rating <input type="text" value={entry.rating || ""} onChange={e => updateListItem("eligibilities", i, "rating", e.target.value)} disabled={saving} /></label>
                  <label>Date of Examination <input type="date" value={entry.examDate || ""} onChange={e => updateListItem("eligibilities", i, "examDate", e.target.value)} disabled={saving} /></label>
                </div>
              </RepeatEntryCard>
            ))}
            <button type="button" className="onboarding-add-row-btn" onClick={() => addListItem("eligibilities", { name: "", rating: "", examDate: "" })} disabled={saving}>+ Add eligibility</button>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">3</span>
              Professional License (PRC)
            </h3>
            {form.professionalLicenses.map((entry, i) => (
              <RepeatEntryCard key={i} title={`License ${i + 1}`} onRemove={() => removeListItem("professionalLicenses", i)} disabled={saving}>
                <div className="onboarding-field-grid">
                  <label>License <input type="text" value={entry.name || ""} onChange={e => updateListItem("professionalLicenses", i, "name", e.target.value)} disabled={saving} /></label>
                  <label>Valid Until <input type="date" value={entry.validUntil || ""} onChange={e => updateListItem("professionalLicenses", i, "validUntil", e.target.value)} disabled={saving} /></label>
                </div>
              </RepeatEntryCard>
            ))}
            <button type="button" className="onboarding-add-row-btn" onClick={() => addListItem("professionalLicenses", { name: "", validUntil: "" })} disabled={saving}>+ Add license</button>
          </div>

          <button type="button" className="skip-link" onClick={handleNext} disabled={saving}>Skip this step — I'll fill this in later</button>
        </div>
      )}

      {step === 7 && (
        <div className="onboarding-step">
          <h2>NSRP Demographic Details</h2>
          <p className="onboarding-subtitle">Complete the NSRP Form 1 profile.</p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Identity &amp; Citizenship
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>Civil Status
                  <select value={form.civilStatus || ""} onChange={e => updateField("civilStatus", e.target.value)} disabled={saving}>
                    <option value="">Select</option>
                    <option value="Single">Single</option>
                    <option value="Married">Married</option>
                    <option value="Live-in">Live-in</option>
                    <option value="Widowed">Widowed</option>
                    <option value="Separated">Separated</option>
                    <option value="Divorced">Divorced</option>
                  </select>
                </label>
                <label>Citizenship <input type="text" value={form.citizenship || ""} onChange={e => updateField("citizenship", e.target.value)} disabled={saving} /></label>
              </div>
              <label>Place of Birth
                <LocationAutosuggest
                  id="placeOfBirth"
                  value={form.placeOfBirth || ""}
                  onChange={(v) => updateField("placeOfBirth", v)}
                  placeholder="Start typing a city or municipality..."
                  disabled={saving}
                />
              </label>
              <label>Religion <span className="onboarding-optional">(optional)</span>
                <Autosuggest
                  id="religion"
                  value={form.religion || ""}
                  onChange={(v) => updateField("religion", v)}
                  options={RELIGIONS}
                  placeholder="Start typing..."
                  disabled={saving}
                />
              </label>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">2</span>
              Government IDs <span className="onboarding-optional">(optional)</span>
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>TIN <input type="text" value={form.tin || ""} onChange={e => updateField("tin", e.target.value)} disabled={saving} /></label>
                <label>GSIS/SSS ID No. <input type="text" value={form.sssGsisNo || ""} onChange={e => updateField("sssGsisNo", e.target.value)} disabled={saving} /></label>
              </div>
              <div className="onboarding-field-grid">
                <label>PAG-IBIG No. <input type="text" value={form.pagibigNo || ""} onChange={e => updateField("pagibigNo", e.target.value)} disabled={saving} /></label>
                <label>PhilHealth No. <input type="text" value={form.philhealthNo || ""} onChange={e => updateField("philhealthNo", e.target.value)} disabled={saving} /></label>
              </div>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">3</span>
              Physical Details
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>Height
                  <input type="text" inputMode="decimal" placeholder={`e.g. 170 or 5'8"`} value={form.height || ""} onChange={e => updateField("height", e.target.value)} disabled={saving} />
                  {heightConverted !== null && <span className="onboarding-unit-hint">≈ {heightConverted} cm</span>}
                </label>
                <label>Weight
                  <input type="text" inputMode="decimal" placeholder="e.g. 65 or 143 lbs" value={form.weight || ""} onChange={e => updateField("weight", e.target.value)} disabled={saving} />
                  {weightConverted !== null && <span className="onboarding-unit-hint">≈ {weightConverted} kg</span>}
                </label>
              </div>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">4</span>
              Contact Numbers
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>Landline <input type="tel" value={form.landline || ""} onChange={e => updateField("landline", e.target.value)} disabled={saving} /></label>
                <label>Secondary Mobile <input type="tel" value={form.mobileSecondary || ""} onChange={e => updateField("mobileSecondary", e.target.value)} disabled={saving} /></label>
              </div>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">5</span>
              Present Address
            </h3>
            <div className="onboarding-address-group">
              {form.address && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) {
                          const parsedHome = parseLocationValue(form.address);
                          setForm(prev => ({
                            ...prev,
                            presentAddress: {
                              ...prev.presentAddress,
                              barangay: parsedHome.barangay || "",
                              municipality: parsedHome.city || "",
                              province: parsedHome.province || "",
                              region: parsedHome.region || "",
                            },
                          }));
                        }
                      }}
                      disabled={saving}
                    />
                    Same as Home Address
                  </label>
                </div>
              )}
              <div style={{ marginBottom: '0.5rem' }}>
                <label htmlFor="presentStreet">Street</label>
                <input
                  id="presentStreet"
                  type="text"
                  value={form.presentAddress.street || ""}
                  onChange={e => updateAddress("presentAddress", "street", e.target.value)}
                  disabled={saving}
                />
              </div>
              <LocationSelect
                value={form.presentAddress}
                onChange={(_loc, structured) => {
                  const nextAddress = structured || {
                    barangay: "",
                    municipality: "",
                    province: "",
                    region: "",
                  };
                  updateAddress("presentAddress", "barangay", nextAddress.barangay || "");
                  updateAddress("presentAddress", "municipality", nextAddress.city || nextAddress.municipality || "");
                  updateAddress("presentAddress", "province", nextAddress.province || "");
                  updateAddress("presentAddress", "region", nextAddress.region || "");
                }}
                disabled={saving}
                required
              />
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">6</span>
              Permanent Address
            </h3>
            <div className="onboarding-address-group">
              <div style={{ marginBottom: '0.75rem' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setForm(prev => ({
                          ...prev,
                          permanentAddress: { ...prev.presentAddress }
                        }));
                      }
                    }}
                  />
                  Same as Present Address
                </label>
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <label htmlFor="permanentStreet">Street</label>
                <input
                  id="permanentStreet"
                  type="text"
                  value={form.permanentAddress.street || ""}
                  onChange={e => updateAddress("permanentAddress", "street", e.target.value)}
                  disabled={saving}
                />
              </div>
              <LocationSelect
                value={form.permanentAddress}
                onChange={(_loc, structured) => {
                  const nextAddress = structured || {
                    barangay: "",
                    municipality: "",
                    province: "",
                    region: "",
                  };
                  updateAddress("permanentAddress", "barangay", nextAddress.barangay || "");
                  updateAddress("permanentAddress", "municipality", nextAddress.city || nextAddress.municipality || "");
                  updateAddress("permanentAddress", "province", nextAddress.province || "");
                  updateAddress("permanentAddress", "region", nextAddress.region || "");
                }}
                disabled={saving}
                required={false}
              />
            </div>
          </div>
        </div>
      )}

      {step === 8 && (
        <div className="onboarding-step">
          <h2>Additional Demographics & Current Status</h2>
          <p className="onboarding-subtitle">A few last details to complete your profile.</p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Accessibility &amp; Support
            </h3>
            <div className="onboarding-fields">
              <div>
                <span className="onboarding-label">Disability (select all that apply)</span>
                <div className="checkbox-row">
                  {["Visual", "Hearing", "Speech", "Physical", "Others"].map(d => (
                    <label key={d} className="checkbox-label">
                      <input type="checkbox" checked={form.disability.includes(d)} onChange={e => {
                        if (e.target.checked) setForm(prev => ({ ...prev, disability: [...prev.disability, d] }));
                        else setForm(prev => ({ ...prev, disability: prev.disability.filter(item => item !== d) }));
                      }} disabled={saving} />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <span className="onboarding-label">4Ps Beneficiary</span>
                <div className="pill-row">
                  <button type="button" className={`pill-btn ${form.is4psBeneficiary === true ? "active" : ""}`} onClick={() => updateField("is4psBeneficiary", true)} disabled={saving}>Yes</button>
                  <button type="button" className={`pill-btn ${form.is4psBeneficiary === false ? "active" : ""}`} onClick={() => updateField("is4psBeneficiary", false)} disabled={saving}>No</button>
                </div>
              </div>
              {form.is4psBeneficiary && (
                <label>4Ps Household ID <input type="text" value={form._4psHouseholdId || ""} onChange={e => updateField("_4psHouseholdId", e.target.value)} disabled={saving} /></label>
              )}
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">2</span>
              Overseas Work
            </h3>
            <div className="onboarding-fields">
              <div>
                <span className="onboarding-label">Are you an Overseas Filipino Worker (OFW)?</span>
                <div className="pill-row">
                  <button type="button" className={`pill-btn ${form.isOfw === true ? "active" : ""}`} onClick={() => updateField("isOfw", true)} disabled={saving}>Yes</button>
                  <button type="button" className={`pill-btn ${form.isOfw === false ? "active" : ""}`} onClick={() => updateField("isOfw", false)} disabled={saving}>No</button>
                </div>
              </div>
              {form.isOfw && (
                <>
                  <div>
                    <span className="onboarding-label">Are you repatriated / planning to return to PH to work?</span>
                    <div className="pill-row">
                      <button type="button" className={`pill-btn ${form.isRepatriated === true ? "active" : ""}`} onClick={() => updateField("isRepatriated", true)} disabled={saving}>Yes</button>
                      <button type="button" className={`pill-btn ${form.isRepatriated === false ? "active" : ""}`} onClick={() => updateField("isRepatriated", false)} disabled={saving}>No</button>
                    </div>
                  </div>
                  {form.isRepatriated && (
                    <label>Repatriation Intent <input type="text" value={form.repatriationIntent || ""} onChange={e => updateField("repatriationIntent", e.target.value)} disabled={saving} placeholder="e.g., Return to PH to work" /></label>
                  )}
                  <div className="onboarding-field-grid">
                    <label>Passport No. <span className="onboarding-optional">(optional)</span><input type="text" value={form.passportNo || ""} onChange={e => updateField("passportNo", e.target.value)} disabled={saving} /></label>
                    <label>Passport Expiry Date <span className="onboarding-optional">(optional)</span><input type="date" value={form.passportExpiryDate || ""} onChange={e => updateField("passportExpiryDate", e.target.value)} disabled={saving} /></label>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">3</span>
              Employment Status
            </h3>
            <div className="onboarding-fields">
              <div>
                <span className="onboarding-label">Employment Status</span>
                <div className="pill-row">
                  <button type="button" className={`pill-btn ${form.employmentStatus === "employed" ? "active" : ""}`} onClick={() => updateField("employmentStatus", "employed")} disabled={saving}>Employed</button>
                  <button type="button" className={`pill-btn ${form.employmentStatus === "unemployed" ? "active" : ""}`} onClick={() => updateField("employmentStatus", "unemployed")} disabled={saving}>Unemployed</button>
                </div>
              </div>
              {form.employmentStatus === "employed" && (
                <div>
                  <span className="onboarding-label">Employment Type</span>
                  <div className="pill-row">
                    <button type="button" className={`pill-btn ${form.employmentType === "wage" ? "active" : ""}`} onClick={() => updateField("employmentType", "wage")} disabled={saving}>Wage</button>
                    <button type="button" className={`pill-btn ${form.employmentType === "self" ? "active" : ""}`} onClick={() => updateField("employmentType", "self")} disabled={saving}>Self</button>
                  </div>
                </div>
              )}
              {form.employmentStatus === "unemployed" && (
                <>
                  <label>Reason for Unemployment
                    <select value={form.unemploymentReason || ""} onChange={e => updateField("unemploymentReason", e.target.value)} disabled={saving}>
                      <option value="">Select</option>
                      <option value="fresh_grad">Fresh Graduate</option>
                      <option value="finished_contract">Finished Contract</option>
                      <option value="resigned">Resigned</option>
                      <option value="retired">Retired</option>
                      <option value="laidoff_local">Laid off (Local)</option>
                      <option value="laidoff_abroad">Laid off (Abroad)</option>
                    </select>
                  </label>
                  {form.unemploymentReason === "laidoff_abroad" && (
                    <label>Country <input type="text" value={form.laidoffCountry || ""} onChange={e => updateField("laidoffCountry", e.target.value)} disabled={saving} /></label>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 9 && (
        <div className="onboarding-step">
          <h2>Add a profile photo</h2>
          <p className="onboarding-subtitle">
            Optional — a photo helps employers recognize you. You can skip this and add one later from your profile.
          </p>
          <AvatarPicker
            name={form.firstName || form.surname || user?.name}
            initialUrl={user?.profileImage}
            onUploaded={(url) => setUser((prev) => ({ ...prev, profileImage: url }))}
            disabled={saving}
          />
        </div>
      )}

      {step === SUCCESS_STEP && (
        <div className="onboarding-step onboarding-success-step">
          <div className="success-icon">✓</div>
          <h2>You're all set, {form.firstName || form.surname || "Job Seeker"}!</h2>
          <p>Your profile is ready. Start exploring opportunities now.</p>
          <div className="onboarding-nav">
            <button type="button" className="onboarding-primary" onClick={() => navigate("/profile")}>View My Profile</button>
            <button type="button" className="onboarding-secondary" onClick={() => navigate("/jobs")}>Browse Jobs</button>
          </div>
        </div>
      )}

      {step <= LAST_STEP && (
        <div className="onboarding-nav">
          <button type="button" className="onboarding-secondary" onClick={handleBack} disabled={step === 1 || saving}>Back</button>
          {step < LAST_STEP ? (
            <button type="button" className="onboarding-primary" onClick={handleNext} disabled={saving}>Next</button>
          ) : (
            <button type="button" className="onboarding-primary" onClick={submitProfile} disabled={saving}>{saving ? "Finishing..." : "Finish Setup"}</button>
          )}
        </div>
      )}
        </section>
      </div>
    </div>

    {error && (
      <div
        className="onboarding-error-modal-overlay"
        onMouseDown={(e) => { if (e.target === e.currentTarget) setError(""); }}
      >
        <div className="onboarding-error-modal" role="alertdialog" aria-modal="true" aria-labelledby="onboarding-error-title">
          <div className="onboarding-error-modal-icon">!</div>
          <h3 id="onboarding-error-title" className="onboarding-error-modal-title">Missing Information</h3>
          <p className="onboarding-error-modal-message">{error}</p>
          <button
            type="button"
            ref={errorModalButtonRef}
            className="onboarding-error-modal-button"
            onClick={() => setError("")}
          >
            Got it
          </button>
        </div>
      </div>
    )}
    </>
  );
}
