import { useCallback, useContext, useMemo, useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../../context/AuthContext";
import { authAPI } from "../../services/api";
import IdOcrReview from "../../components/IdOcrReview";
import "../../styles/onboarding.css";
import LocationSelect from "../../components/LocationSelect";
import { parseLocationValue } from "../../utils/locationParser";
import LocationAutosuggest from "../../components/LocationAutosuggest";
import Autosuggest from "../../components/Autosuggest";
import { NATIONALITIES, CIVIL_SERVICE_ELIGIBILITIES, PRC_PROFESSIONS } from "../../data/profileSuggestions";
import SearchableDropdown from "../../components/SearchableDropdown";
import AvatarPicker from "../../components/AvatarPicker";
import { usePersistentState } from "../../hooks/usePersistentState";
import { SUGGESTED_SKILLS, INDUSTRY_SKILLS } from "../../data/skills";
import marinduqueSchools from "../../data/marinduque_schools.json";
import collegeCourses from "../../data/philippine_college_courses.json";
import PH_JOB_TITLES from "../../data/ph_job_titles_complete.json";
import countriesData from "../../data/countries.json";
import { ALL_LOCATIONS } from "../../utils/philippineLocations";
import HeightInput from "../../components/HeightInput";
import LanguageProficiencyTable from "../../components/LanguageProficiencyTable";
import { emptyLanguageRow } from "../../utils/languageProficiency";
import WeightInput from "../../components/WeightInput";
import { useSystemOptions } from "../../hooks/useSystemOptions";
import { useUsernameAvailability } from "../../hooks/useUsernameAvailability";
import { VALID_INDUSTRIES as INDUSTRY_OPTIONS_FALLBACK } from "../../constants/industries";
import { GENDER_OPTIONS } from "../../constants/gender";
import { CIVIL_STATUS_OPTIONS, CIVIL_STATUS_OTHER } from "../../constants/civilStatus";
import PhoneInput from "../../components/PhoneInput";
import { FieldError, FieldGroup } from "../../components/FormField";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { ariaFor, mapServerError } from "../../utils/formErrors";
import { getStepErrors, reachability, firstIncompleteStep, earlierStepNeedingAttention } from "../../utils/wizardSteps";
import { WORK_EXPERIENCE_OPTIONS, EMPLOYMENT_STATUS_OPTIONS, EMPLOYMENT_STATUS_NOT_APPLICABLE, optionLabel } from "../../constants/profileOptions";
import { UNEMPLOYMENT_REASON_OPTIONS } from "../../constants/unemploymentReasons";
import { WORK_HISTORY_STATUS_OPTIONS } from "../../constants/workHistoryStatus";

const RELIGIONS = [
  "Roman Catholic", "Islam", "Iglesia ni Cristo", "Evangelical", "Aglipayan (Philippine Independent Church)",
  "Seventh-day Adventist", "United Church of Christ in the Philippines (UCCP)", "Bible Baptist Church",
  "Jehovah's Witnesses", "Members Church of God International (Ang Dating Daan)", "United Pentecostal Church",
  "Church of Jesus Christ of Latter-day Saints", "Baptist", "United Methodist Church", "Born Again Christian",
  "Buddhist", "Philippine Benevolent Missionaries Association (PBMA)", "Others",
];

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
const VOCATIONAL_COURSES = COURSE_CATEGORIES["Technical-Vocational (TESDA) Programs"] || [];
const ALL_COURSES_FLAT = collegeCourses.all_courses_flat || [];
const COURSE_UNKNOWN_VALUE = "Undecided / Not sure yet";
const TECH_VOC_INSTITUTIONS = (marinduqueSchools.technical_vocational_schools || []).map((s) => s.name);
const COUNTRY_OPTIONS = countriesData.countries || [];
const OTHER_OPTION = "__other__";

const getInitialForm = (user) => ({
  surname: user?.surname || "",
  firstName: user?.firstName || "",
  middleName: user?.middleName || "",
  suffix: user?.suffix || "",
  phone: user?.phone || "",
  dateOfBirth: user?.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : "",
  gender: user?.gender || "",
  address: user?.address || "",
  // Seeded from whatever the account already has (an auto-suggested one
  // from registration/Google sign-up, or whatever the user typed at
  // registration) — this step just lets them review/change it. Handled as
  // its own authAPI.setUsername() call on final submit, not through this
  // step's regular updateProfile payload — see submitProfile.
  username: user?.username || "",

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
  civilStatusOther: "",
  placeOfBirth: "",
  citizenship: "",
  height: "",
  heightUnit: "cm",
  weight: "",
  weightUnit: "kg",
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

function CappedChipField({ label, hint, placeholder, values, cap, onAdd, onRemove, disabled, options }) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const wrapRef = useRef(null);
  const atCap = values.length >= cap;

  const add = (raw) => {
    const trimmed = (raw ?? input).trim();
    if (!trimmed || atCap) return;
    if (!values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) onAdd(trimmed);
    setInput("");
    setOpen(false);
    setHighlighted(-1);
  };

  const suggestions = useMemo(() => {
    if (!options || !options.length) return [];
    const q = input.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(values.map((v) => v.toLowerCase()));
    return options.filter((o) => o.toLowerCase().includes(q) && !taken.has(o.toLowerCase())).slice(0, 8);
  }, [options, input, values]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleKeyDown = (e) => {
    if (open && suggestions.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); return; }
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "Enter" && highlighted >= 0) { e.preventDefault(); add(suggestions[highlighted]); return; }
    }
    if (e.key === "Enter") { e.preventDefault(); add(); }
  };

  return (
    <div>
      <span className="onboarding-label">{label} ({values.length}/{cap})</span>
      {hint && <p className="onboarding-hint" style={{ marginTop: "0.25rem" }}>{hint}</p>}
      <div className="skills-entry-row">
        <div className="autosuggest" ref={wrapRef}>
          <input
            type="text"
            value={input}
            placeholder={atCap ? `Maximum of ${cap} reached` : placeholder}
            onChange={(e) => { setInput(e.target.value); setOpen(true); setHighlighted(-1); }}
            onFocus={() => input.trim() && setOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled || atCap}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-autocomplete="list"
          />
          {open && suggestions.length > 0 && (
            <ul className="autosuggest-list" role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={s}
                  role="option"
                  aria-selected={i === highlighted}
                  className={i === highlighted ? "is-highlighted" : ""}
                  onMouseDown={(e) => { e.preventDefault(); add(s); }}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="onboarding-add-btn" onClick={() => add()} disabled={disabled || atCap}>Add</button>
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
  const { t } = useTranslation();
  const { user, login, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  // Admin-maintainable catalog (item 11) — live from the server, with the
  // old hardcoded list as a fallback for first paint / offline.
  const { options: INDUSTRY_OPTIONS } = useSystemOptions("industry", { fallback: INDUSTRY_OPTIONS_FALLBACK });

  const defaultState = useMemo(() => ({
    form: getInitialForm(user),
    preferredIndustries: [],
    industryPreferenceLevel: 'flexible',
    skills: [],
    step: 1,
  }), [user]);

  // Normalize form to ensure all nested objects exist
  const normalizeForm = useCallback((formData) => {
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
  }, [user]);

  // Scoped to the signed-in account — a bare "jobseekerOnboarding" key would
  // be shared by every account that ever uses this browser, so a new
  // signup could land on an older, unrelated account's abandoned draft.
  const currentUserId = user?._id || user?.id || null;
  const [persistedState, setPersistedState, clearPersistedState] = usePersistentState(
    currentUserId ? `jobseekerOnboarding_${currentUserId}` : null,
    defaultState
  );

  // Safe destructuring: if persistedState is invalid, use defaultState
  const safeState = (persistedState && typeof persistedState === 'object' && persistedState.form)
    ? { ...persistedState, form: normalizeForm(persistedState.form) }
    : defaultState;

  const { form, preferredIndustries, industryPreferenceLevel, skills, step } = safeState;

  // Only live-checks while the typed value actually differs from what the
  // account already has — see getInitialForm's comment on why `username`
  // starts out pre-filled with that existing value.
  const usernameCheck = useUsernameAvailability(form.username, { currentValue: user?.username || "" });

  // Update individual pieces – ensure we always merge with the current state
  const setForm = useCallback((updater) => setPersistedState(prev => {
    const currentState = prev || defaultState;
    // Normalize first: a draft saved to localStorage before a field existed
    // (e.g. languageProficiency) won't have it, and updaters assume it's there.
    const normalizedCurrentForm = normalizeForm(currentState.form);
    const newForm = typeof updater === 'function' ? updater(normalizedCurrentForm) : updater;
    return { ...currentState, form: newForm };
  }), [defaultState, normalizeForm, setPersistedState]);
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
  // Field-level errors (shared error pattern). The blocking modal below stays only
  // for failures that are not about one field, such as the final submit failing.
  const { errors, replaceErrors, clearFieldError, clearAll, focusFirstInvalid } = useFieldErrors();
  // Polite status line for the step list ("Complete Personal Details first.").
  const [navNotice, setNavNotice] = useState("");
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
    return SUGGESTED_SKILLS.filter(skill => !skills.includes(skill) && !industrySuggestions.includes(skill));
  }, [skills, industrySuggestions]);
  const [resumeFile, setResumeFile] = useState(null);
  const [validIdFile, setValidIdFile] = useState(null);
  const [resumeError, setResumeError] = useState("");
  const [validIdError, setValidIdError] = useState("");

  // On mount, if user has onboarding completed, redirect
  useEffect(() => {
    if (!finished && (user?.hasCompletedOnboarding === true || user?.onboardingComplete === true)) {
      const role = user?.role || "jobseeker";
      if (role === "employer") navigate("/employer-dashboard");
      else navigate("/dashboard");
    }
    // If no persisted state exists for THIS account, or it's corrupted,
    // reset to user data. Must check the same per-user key the persisted
    // state itself uses — checking the old flat key here would always read
    // empty (nothing writes to it anymore) and reset a legitimate draft on
    // every mount.
    if (user && currentUserId && !localStorage.getItem(`jobseekerOnboarding_${currentUserId}`)) {
      setForm(getInitialForm(user));
    }
  }, [user, navigate, finished, currentUserId, setForm]);

  // Registration already collects surname/first/middle/suffix, but the auth
  // context populates those fields via an async profile fetch that resolves
  // after this page has already mounted (and possibly after the draft form
  // was first persisted with them blank). Backfill once they arrive, without
  // clobbering anything the user has since typed.
  useEffect(() => {
    if (!user) return;
    setForm(prev => ({
      ...prev,
      surname: prev.surname || user.surname || "",
      firstName: prev.firstName || user.firstName || "",
      middleName: prev.middleName || user.middleName || "",
      suffix: prev.suffix || user.suffix || "",
    }));
  }, [user, setForm]);

  const progress = useMemo(() => (Math.min(step, LAST_STEP) / LAST_STEP) * 100, [step]);

  // Free movement: step N opens when every required step before N is complete
  // (utils/wizardSteps.js). The draft already saves on every change, so leaving
  // a step needs no save and shows no validation errors.
  const stepState = useMemo(() => ({ form, preferredIndustries, skills }), [form, preferredIndustries, skills]);
  const stepOpts = useMemo(() => ({ originalPhone: user?.phone || "" }), [user?.phone]);
  const onWizardStep = Math.min(step, LAST_STEP);
  const navInfo = useMemo(() => reachability(onWizardStep, stepState, stepOpts, LAST_STEP), [onWizardStep, stepState, stepOpts]);
  const attentionStep = step <= LAST_STEP ? earlierStepNeedingAttention(step, stepState, stepOpts, LAST_STEP) : null;

  const goToStep = (targetStep) => {
    if (targetStep < 1 || targetStep > LAST_STEP || targetStep === step) return;
    const info = navInfo[targetStep - 1];
    if (!info.reachable) {
      setNavNotice(t("wizardNav.lockedReason", { step: STEP_LABELS[(info.blockedBy || 1) - 1] }));
      return;
    }
    setError("");
    setNavNotice("");
    clearAll();
    setStep(targetStep);
  };

  const schoolOptions = useMemo(() => getSchoolOptions(form.educationalAttainment), [form.educationalAttainment]);
  const showCourseField = COURSE_ATTAINMENTS.includes(form.educationalAttainment);
  const courseSuggestions = useMemo(
    () => (form.educationalAttainment === "Vocational / TESDA" ? VOCATIONAL_COURSES : ALL_COURSES_FLAT),
    [form.educationalAttainment]
  );
  const courseUnknown = form.course === COURSE_UNKNOWN_VALUE;
  const toggleCourseUnknown = (checked) => setForm(prev => ({ ...prev, course: checked ? COURSE_UNKNOWN_VALUE : "" }));


  // Editing a field clears its own error straight away.
  const updateField = (name, value) => {
    setForm(prev => ({ ...prev, [name]: value }));
    clearFieldError(name);
  };

  const updateAddress = (type, field, value) => {
    setForm(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value }
    }));
    if (type === "presentAddress") clearFieldError("presentAddress");
  };

  const addListItem = (field, template) => setForm(prev => ({ ...prev, [field]: [...(prev[field] || []), template] }));
  const updateListItem = (field, index, key, value) => setForm(prev => {
    const list = [...(prev[field] || [])];
    list[index] = { ...list[index], [key]: value };
    return { ...prev, [field]: list };
  });
  const removeListItem = (field, index) => setForm(prev => ({ ...prev, [field]: (prev[field] || []).filter((_, i) => i !== index) }));

  const addToCappedList = (field, value) => {
    setForm(prev => ({ ...prev, [field]: [...(prev[field] || []), value] }));
    clearFieldError(field);
  };
  const removeFromCappedList = (field, value) => setForm(prev => ({ ...prev, [field]: (prev[field] || []).filter(v => v !== value) }));

  const toggleIndustry = (industry) => {
    clearFieldError("preferredIndustries");
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
    clearFieldError("skills");
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
    const allowedTypesWithImages = [...allowedTypes, 'image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
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

  // Shows this step's errors on the fields, focuses the first one, and returns
  // true when there were any. Order is the on-screen order of each step.
  const FIELD_ORDER = {
    1: ["surname", "firstName", "phone", "dateOfBirth", "gender", "address"],
    2: ["preferredIndustries"],
    3: ["skills"],
    4: ["preferredOccupations", "availabilityStatus"],
    5: ["educationalAttainment", "workExperience"],
    7: ["civilStatus", "civilStatusOther", "citizenship", "placeOfBirth", "presentAddress"],
    8: ["employmentStatus", "employmentType", "unemploymentReason", "laidoffCountry"],
  };
  const showStepErrors = (target) => {
    const found = getStepErrors(target, stepState, stepOpts);
    replaceErrors(found);
    if (Object.keys(found).length === 0) return false;
    // Wait one frame so the error markup (and aria-invalid) is in the page first.
    window.requestAnimationFrame(() => focusFirstInvalid(FIELD_ORDER[target] || [], found));
    return true;
  };

  const handleNext = () => {
    setError("");
    setNavNotice("");
    // Steps 6 and 9 are optional; every other step must be complete to continue.
    if (showStepErrors(step)) return;
    setStep(prev => Math.min(prev + 1, SUCCESS_STEP));
  };

  const handleBack = () => {
    setError("");
    setNavNotice("");
    clearAll();
    setStep(prev => Math.max(prev - 1, 1));
  };

  const submitProfile = async () => {
    setError("");
    // Finish re-checks EVERY required step (not only the last one), because
    // steps can now be visited in any order. The first gap is opened.
    const gap = firstIncompleteStep(stepState, stepOpts, LAST_STEP);
    if (gap !== null) {
      if (gap !== step) setStep(gap);
      const found = getStepErrors(gap, stepState, stepOpts);
      replaceErrors(found);
      window.requestAnimationFrame(() => focusFirstInvalid(FIELD_ORDER[gap] || [], found));
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
      data.append("civilStatusOther", form.civilStatusOther || "");
      data.append("placeOfBirth", form.placeOfBirth || "");
      data.append("citizenship", form.citizenship || "");
      data.append("height", form.height || "");
      data.append("heightUnit", form.heightUnit || "cm");
      data.append("weight", form.weight || "");
      data.append("weightUnit", form.weightUnit || "kg");
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

      // Separate call, not part of the updateProfile payload above —
      // authController.updateProfile doesn't handle username at all, by
      // design (see authController.setUsername's own validation/cooldown
      // logic, which this reuses). Best-effort: only fires when the user
      // actually changed it from what the account already has, and a
      // failure here (a race against someone else taking it, say) must
      // never undo everything else onboarding just saved — they can still
      // set one afterward from Settings.
      const trimmedUsername = (form.username || "").trim();
      if (trimmedUsername && trimmedUsername.toLowerCase() !== (user?.username || "").toLowerCase()) {
        try {
          await authAPI.setUsername(trimmedUsername);
        } catch (usernameErr) {
          console.warn(
            "Could not set username during onboarding:",
            usernameErr?.response?.data?.message || usernameErr?.message
          );
        }
      }

      const token = localStorage.getItem("token");
      if (token && response.user) login(token, response.user);
      // Clear persisted state on success
      clearPersistedState();
      setFinished(true);
      setStep(SUCCESS_STEP);
    } catch (err) {
      // A field-level server answer ({ code, field }) marks that field and returns the
      // person to the step that holds it; anything else uses the blocking message.
      const data = err.response?.data || {};
      const stepOfField = Object.entries(FIELD_ORDER).find(([, fields]) => fields.includes(data.field));
      if (data.field && stepOfField) {
        const mapped = mapServerError(err);
        setStep(Number(stepOfField[0]));
        const entry = mapped.key ? { key: mapped.key, params: data.params || {}, message: mapped.message } : { message: mapped.message };
        replaceErrors({ [data.field]: entry });
        window.requestAnimationFrame(() => focusFirstInvalid(FIELD_ORDER[Number(stepOfField[0])], { [data.field]: entry }));
      } else {
        setError(data.message || t("wizardErrors.submitFailed"));
      }
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
            const info = navInfo[i];
            const locked = step <= LAST_STEP && info.status === "locked";
            const state = step === SUCCESS_STEP || info.status === "done" ? "done" : info.status === "current" ? "current" : locked ? "locked" : "upcoming";
            const reasonId = `wizard-step-reason-${idx}`;
            const lockedReason = locked ? t("wizardNav.lockedReason", { step: STEP_LABELS[(info.blockedBy || 1) - 1] }) : "";
            return (
              <li key={label} className={`onboarding-step-item ${state}`}>
                <button
                  type="button"
                  className="onboarding-step-button"
                  onClick={() => goToStep(idx)}
                  aria-current={state === "current" ? "step" : undefined}
                  aria-disabled={locked || state === "current" ? "true" : undefined}
                  aria-describedby={locked ? reasonId : undefined}
                  disabled={saving || step === SUCCESS_STEP}
                  aria-label={t("wizardNav.goTo", { label })}
                >
                  <span className="onboarding-step-index" aria-hidden="true">{state === "done" ? "✓" : idx}</span>
                  <span className="onboarding-step-label">
                    {label}
                    {state === "done" && <span className="sr-only"> ({t("wizardNav.stateDone")})</span>}
                    {locked && <span className="onboarding-step-lock" aria-hidden="true">{t("wizardNav.stateLocked")}</span>}
                    {locked && <span id={reasonId} className="sr-only"> ({t("wizardNav.stateLocked")}. {lockedReason})</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="onboarding-rail-notice" role="status" aria-live="polite">
          {navNotice || (attentionStep ? t("wizardNav.needsAttention", { step: STEP_LABELS[attentionStep - 1] }) : "")}
        </p>
        {step <= LAST_STEP && <div className="onboarding-rail-autosave">{t("wizardNav.draftLocal")}</div>}
      </aside>

      <div className="onboarding-panel">
        <header className="onboarding-topbar">
          {step <= LAST_STEP && (
            <>
              <div className="onboarding-progress-meta">Step {step} of {LAST_STEP}</div>
              <h1 className="onboarding-topbar-title">{STEP_LABELS[step - 1]}</h1>
              <div className="onboarding-progress-track"><div className="onboarding-progress-fill" style={{ width: `${progress}%` }}></div></div>
              <div className="onboarding-mobile-step-pills" aria-label={t("wizardNav.jumpMenu")}>
                {STEP_LABELS.map((label, i) => {
                  const idx = i + 1;
                  const info = navInfo[i];
                  const isCurrent = info.status === "current";
                  const isDone = info.status === "done";
                  const locked = info.status === "locked";
                  const stateText = isCurrent ? t("wizardNav.stateCurrent") : isDone ? t("wizardNav.stateDone") : locked ? `${t("wizardNav.stateLocked")}. ${t("wizardNav.lockedReason", { step: STEP_LABELS[(info.blockedBy || 1) - 1] })}` : t("wizardNav.stateAvailable");
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`onboarding-mobile-step-pill ${isCurrent ? "current" : ""} ${isDone ? "done" : ""} ${locked ? "locked" : ""}`}
                      onClick={() => goToStep(idx)}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-disabled={locked || isCurrent ? "true" : undefined}
                      disabled={saving}
                      aria-label={`${t("wizardNav.stepOf", { current: idx, total: LAST_STEP, label })}, ${stateText}`}
                    >
                      {idx}
                    </button>
                  );
                })}
              </div>
              <div className="onboarding-mobile-jump">
                <label htmlFor="wizard-jump" className="sr-only">{t("wizardNav.jumpMenu")}</label>
                <select id="wizard-jump" value={step} onChange={(e) => goToStep(Number(e.target.value))} disabled={saving}>
                  {STEP_LABELS.map((label, i) => (
                    <option key={label} value={i + 1} disabled={navInfo[i].status === "locked"}>
                      {`${i + 1}. ${label}${navInfo[i].status === "locked" ? ` (${t("wizardNav.stateLocked")})` : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </header>

        <div className="onboarding-scroll">
          <div className="onboarding-canvas">
      {attentionStep ? (
        <div className="onboarding-attention" role="status">
          <span>{t("wizardNav.attentionBanner", { step: STEP_LABELS[attentionStep - 1] })}</span>
          <button type="button" className="onboarding-secondary" onClick={() => goToStep(attentionStep)}>{t("wizardNav.goThere", { step: STEP_LABELS[attentionStep - 1] })}</button>
        </div>
      ) : null}
      {step === 1 && (
        <div className="onboarding-step">
          <p className="onboarding-subtitle">Tell us about yourself so employers can get to know you.</p>
          <div className="onboarding-fields">
            <div className="onboarding-field-grid-4">
              <label>Surname <input type="text" {...ariaFor(errors, "surname")} value={form.surname || ""} onChange={e => updateField("surname", e.target.value)} disabled={saving} /><FieldError id="surname" error={errors.surname} /></label>
              <label>First Name <input type="text" {...ariaFor(errors, "firstName")} value={form.firstName || ""} onChange={e => updateField("firstName", e.target.value)} disabled={saving} /><FieldError id="firstName" error={errors.firstName} /></label>
              <label>Middle Name <span className="onboarding-optional">(optional)</span><input type="text" value={form.middleName || ""} onChange={e => updateField("middleName", e.target.value)} disabled={saving} /></label>
              <label>Suffix <span className="onboarding-optional">(optional)</span><input type="text" placeholder="Jr., III, etc." value={form.suffix || ""} onChange={e => updateField("suffix", e.target.value)} disabled={saving} /></label>
              <PhoneInput id="phone" name="phone" value={form.phone || ""} onChange={(v) => updateField("phone", v)} error={errors.phone} required disabled={saving} />
              <label>Date of Birth <input type="date" value={form.dateOfBirth || ""} onChange={e => updateField("dateOfBirth", e.target.value)} {...ariaFor(errors, "dateOfBirth")} disabled={saving} readOnly={Boolean(user?.dateOfBirth)} aria-readonly={Boolean(user?.dateOfBirth)} />{user?.dateOfBirth ? <small className="onboarding-optional">{t("ageGate.dobLockedProfile")}</small> : null}<FieldError id="dateOfBirth" error={errors.dateOfBirth} /></label>
            </div>
            <FieldGroup id="gender" legend={<span className="onboarding-label">Gender</span>} error={errors.gender}>
              <div className="pill-row">
                {GENDER_OPTIONS.map(opt => (
                  <button key={opt} type="button" className={`pill-btn ${form.gender === opt ? "active" : ""}`} onClick={() => updateField("gender", opt)} disabled={saving}>{opt}</button>
                ))}
              </div>
            </FieldGroup>
            <FieldGroup id="address" legend={<span className="onboarding-label">Home Address / Municipality</span>} error={errors.address}>
              <LocationSelect
                value={form.address || ""}
                onChange={(loc) => updateField("address", loc)}
                disabled={saving}
                required
              />
            </FieldGroup>
            <div>
              <label htmlFor="onboarding-username">
                Username <span className="onboarding-optional">(optional)</span>
              </label>
              <input
                id="onboarding-username"
                type="text"
                placeholder="A second way to sign in, instead of your email"
                value={form.username || ""}
                onChange={(e) => updateField("username", e.target.value)}
                disabled={saving}
                autoComplete="username"
                maxLength={30}
              />
              {usernameCheck.status === "checking" && (
                <span className="onboarding-field-hint">Checking…</span>
              )}
              {usernameCheck.status === "available" && (
                <span className="onboarding-field-hint onboarding-field-hint--ok">✓ Available</span>
              )}
              {usernameCheck.status === "unavailable" && (
                <span className="onboarding-field-error">{usernameCheck.message}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="onboarding-step">
          <p className="onboarding-subtitle">Select the industries you are most interested in working in.</p>
          <FieldGroup id="preferredIndustries" error={errors.preferredIndustries}>
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
          </FieldGroup>

          {INDUSTRY_OPTIONS.length === 0 && (
            <p className="onboarding-catalog-empty" role="status">
              No industries are available right now. Please contact PESO support.
            </p>
          )}

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
          <p className="onboarding-subtitle">Add skills that showcase your abilities and experience.</p>
          <div className="skills-entry-row">
            <input type="text" {...ariaFor(errors, "skills")} value={skillInput} placeholder="Type a skill and press Enter" onChange={e => setSkillInput(e.target.value)} onKeyDown={handleSkillKeyDown} disabled={saving} />
            <button type="button" className="onboarding-add-btn" onClick={handleAddSkill} disabled={saving}>Add</button>
          </div>
          <FieldError id="skills" error={errors.skills} />
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
          <p className="onboarding-subtitle">Tell us what kind of work, location, and pay you're looking for.</p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Preferred Occupations
            </h3>
            <FieldGroup id="preferredOccupations" error={errors.preferredOccupations}>
            <CappedChipField
              label="Occupations"
              hint="List up to 4, in order of preference."
              placeholder="e.g. Administrative Assistant"
              values={form.preferredOccupations}
              cap={4}
              options={PH_JOB_TITLES}
              onAdd={(v) => addToCappedList("preferredOccupations", v)}
              onRemove={(v) => removeFromCappedList("preferredOccupations", v)}
              disabled={saving}
            />
            </FieldGroup>
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
                options={ALL_LOCATIONS}
                onAdd={(v) => addToCappedList("preferredWorkLocationLocal", v)}
                onRemove={(v) => removeFromCappedList("preferredWorkLocationLocal", v)}
                disabled={saving}
              />
              <CappedChipField
                label="Overseas (countries)"
                placeholder="e.g. Japan"
                values={form.preferredWorkLocationOverseas}
                cap={3}
                options={COUNTRY_OPTIONS}
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
              <FieldGroup id="availabilityStatus" legend={<span className="onboarding-label">Availability Status</span>} error={errors.availabilityStatus}>
                <div className="pill-row">
                  {["Actively Looking", "Open to Offers", "Currently Employed"].map(opt => (
                    <button key={opt} type="button" className={`pill-btn ${form.availabilityStatus === opt ? "active" : ""}`} onClick={() => updateField("availabilityStatus", opt)} disabled={saving}>{opt}</button>
                  ))}
                </div>
              </FieldGroup>
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="onboarding-step">
          <p className="onboarding-subtitle">Your education, language skills, and work history.</p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Educational Attainment
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>Educational Attainment
                  <select {...ariaFor(errors, "educationalAttainment")} value={form.educationalAttainment || ""} onChange={e => { updateField("educationalAttainment", e.target.value); updateField("schoolAttended", ""); updateField("course", ""); }} disabled={saving}>
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
                  <FieldError id="educationalAttainment" error={errors.educationalAttainment} />
                </label>
                <label>Work Experience
                  <select {...ariaFor(errors, "workExperience")} value={form.workExperience || ""} onChange={e => updateField("workExperience", e.target.value)} disabled={saving}>
                    <option value="">Select</option>
                    {WORK_EXPERIENCE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{optionLabel(opt, t)}</option>
                    ))}
                  </select>
                  <small className="onboarding-optional">{t("profileOptions.workExperienceHint")}</small>
                  <FieldError id="workExperience" error={errors.workExperience} />
                </label>
              </div>

              {schoolOptions.length > 0 && (
                <label>School Attended
                  <SearchableDropdown
                    value={form.schoolAttended === OTHER_OPTION ? (form.schoolAttendedOther || "") : (form.schoolAttended || "")}
                    onChange={(v) => { updateField("schoolAttended", v); updateField("schoolAttendedOther", ""); }}
                    options={schoolOptions}
                    placeholder="Type or select your school"
                    disabled={saving}
                  />
                </label>
              )}
              {showCourseField && (
                <div>
                  <label>Course
                    <SearchableDropdown
                      value={courseUnknown ? "" : (form.course || "")}
                      onChange={(v) => updateField("course", v)}
                      options={courseSuggestions}
                      placeholder={courseUnknown ? "Not sure yet" : "Type to search or select a course"}
                      disabled={saving || courseUnknown}
                    />
                  </label>
                  <label className="checkbox-label" style={{ marginTop: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={courseUnknown}
                      onChange={(e) => toggleCourseUnknown(e.target.checked)}
                      disabled={saving}
                    />
                    I'm not sure / don't know my course yet
                  </label>
                </div>
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
            <LanguageProficiencyTable
              value={form.languageProficiency}
              othersLabel={form.languageOthersLabel || ""}
              onChange={(next) => updateField("languageProficiency", next)}
              onOthersLabelChange={(label) => updateField("languageOthersLabel", label)}
              disabled={saving}
            />
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
                  <label>Address (City/Municipality)
                    <LocationAutosuggest
                      value={entry.address || ""}
                      onChange={(v) => updateListItem("workHistory", i, "address", v)}
                      placeholder="e.g. Boac, Marinduque"
                      disabled={saving}
                    />
                  </label>
                </div>
                <div className="onboarding-field-grid">
                  <label>Position
                    <Autosuggest
                      value={entry.position || ""}
                      onChange={(v) => updateListItem("workHistory", i, "position", v)}
                      options={PH_JOB_TITLES}
                      placeholder="e.g. Administrative Assistant"
                      disabled={saving}
                    />
                  </label>
                  <label>Status
                    <select value={entry.status || ""} onChange={e => updateListItem("workHistory", i, "status", e.target.value)} disabled={saving}>
                      <option value="">Select</option>
                      {WORK_HISTORY_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="onboarding-field-grid">
                  <label>From <input type="date" value={entry.dateFrom || ""} onChange={e => updateListItem("workHistory", i, "dateFrom", e.target.value)} disabled={saving} /></label>
                  <label>To <input type="date" value={entry.dateTo || ""} onChange={e => updateListItem("workHistory", i, "dateTo", e.target.value)} disabled={saving} /></label>
                </div>
              </RepeatEntryCard>
            ))}
            <button type="button" className="onboarding-add-row-btn" onClick={() => addListItem("workHistory", { companyName: "", address: "", position: "", dateFrom: "", dateTo: "", status: "" })} disabled={saving}>+ Add employer</button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="onboarding-step">
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
                <label>Eligibility
                  <Autosuggest
                    enhanced
                    value={entry.name || ""}
                    onChange={(v) => updateListItem("eligibilities", i, "name", v)}
                    options={CIVIL_SERVICE_ELIGIBILITIES}
                    placeholder={t("suggest.placeholder")}
                    maxLength={120}
                    disabled={saving}
                  />
                </label>
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
                  <label>License
                    <Autosuggest
                      enhanced
                      value={entry.name || ""}
                      onChange={(v) => updateListItem("professionalLicenses", i, "name", v)}
                      options={PRC_PROFESSIONS}
                      placeholder={t("suggest.placeholder")}
                      maxLength={120}
                      disabled={saving}
                    />
                  </label>
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
          <p className="onboarding-subtitle">Complete the NSRP Form 1 profile.</p>
          <p className="onboarding-subtitle">
            Civil status, citizenship, and place of birth are required. Everything else on this step
            — including religion and government ID numbers, which are sensitive personal information
            — is optional; feel free to leave it blank. See our{" "}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>{" "}
            for how this data is used and protected.
          </p>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">1</span>
              Identity &amp; Citizenship
            </h3>
            <div className="onboarding-fields">
              <div className="onboarding-field-grid">
                <label>Civil Status
                  <select {...ariaFor(errors, "civilStatus")} value={form.civilStatus || ""} onChange={e => updateField("civilStatus", e.target.value)} disabled={saving}>
                    <option value="">Select</option>
                    {CIVIL_STATUS_OPTIONS.map((cs) => (
                      <option key={cs} value={cs}>{cs === CIVIL_STATUS_OTHER ? t("profile.civilStatus.other") : cs}</option>
                    ))}
                  </select>
                  <FieldError id="civilStatus" error={errors.civilStatus} />
                </label>
                <label>Citizenship
                  <div className={errors.citizenship ? "ds-invalid-wrap" : undefined}>
                    <Autosuggest
                      id="citizenship"
                      enhanced
                      value={form.citizenship || ""}
                      onChange={(v) => updateField("citizenship", v)}
                      options={NATIONALITIES}
                      placeholder={t("suggest.placeholder")}
                      maxLength={50}
                      disabled={saving}
                    />
                  </div>
                  <FieldError id="citizenship" error={errors.citizenship} />
                </label>
              </div>
              {form.civilStatus === CIVIL_STATUS_OTHER && (
                <label>{t("profile.civilStatus.specifyLabel")}
                  <input type="text" {...ariaFor(errors, "civilStatusOther")} value={form.civilStatusOther || ""} onChange={e => updateField("civilStatusOther", e.target.value)} disabled={saving} required />
                  <FieldError id="civilStatusOther" error={errors.civilStatusOther} />
                </label>
              )}
              <label>Place of Birth
                <div className={errors.placeOfBirth ? "ds-invalid-wrap" : undefined}>
                  <LocationAutosuggest
                    id="placeOfBirth"
                    value={form.placeOfBirth || ""}
                    onChange={(v) => updateField("placeOfBirth", v)}
                    placeholder="Start typing a city or municipality..."
                    disabled={saving}
                  />
                </div>
                <FieldError id="placeOfBirth" error={errors.placeOfBirth} />
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
                <label>TIN <span className="onboarding-optional">(optional)</span> <input type="text" value={form.tin || ""} onChange={e => updateField("tin", e.target.value)} disabled={saving} /></label>
                <label>GSIS/SSS ID No. <span className="onboarding-optional">(optional)</span> <input type="text" value={form.sssGsisNo || ""} onChange={e => updateField("sssGsisNo", e.target.value)} disabled={saving} /></label>
              </div>
              <div className="onboarding-field-grid">
                <label>PAG-IBIG No. <span className="onboarding-optional">(optional)</span> <input type="text" value={form.pagibigNo || ""} onChange={e => updateField("pagibigNo", e.target.value)} disabled={saving} /></label>
                <label>PhilHealth No. <span className="onboarding-optional">(optional)</span> <input type="text" value={form.philhealthNo || ""} onChange={e => updateField("philhealthNo", e.target.value)} disabled={saving} /></label>
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
                <div>
                  <label>Height</label>
                  <HeightInput
                    value={form.height}
                    onChange={(next) => updateField("height", next)}
                    unit={form.heightUnit || "cm"}
                    onUnitChange={(next) => updateField("heightUnit", next)}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label>Weight</label>
                  <WeightInput
                    value={form.weight}
                    onChange={(next) => updateField("weight", next)}
                    unit={form.weightUnit || "kg"}
                    onUnitChange={(next) => updateField("weightUnit", next)}
                    disabled={saving}
                  />
                </div>
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
                <PhoneInput id="mobileSecondary" name="mobileSecondary" label="Secondary Mobile" value={form.mobileSecondary || ""} onChange={(v) => updateField("mobileSecondary", v)} disabled={saving} />
              </div>
            </div>
          </div>

          <div className="onboarding-section">
            <h3 className="onboarding-section-title">
              <span className="onboarding-section-icon" aria-hidden="true">5</span>
              Present Address
            </h3>
            <FieldError id="presentAddress" error={errors.presentAddress} />
            <div
              className="onboarding-address-group"
              id="presentAddress"
              role="group"
              aria-label="Present Address"
              aria-invalid={errors.presentAddress ? "true" : undefined}
              aria-describedby={errors.presentAddress ? "presentAddress-error" : undefined}
              tabIndex={errors.presentAddress ? -1 : undefined}
            >
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
              <FieldGroup id="employmentStatus" legend={<span className="onboarding-label">Employment Status</span>} error={errors.employmentStatus}>
                <div className="pill-row">
                  {EMPLOYMENT_STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={form.employmentStatus === opt.value}
                      className={`pill-btn ${form.employmentStatus === opt.value ? "active" : ""}`}
                      onClick={() => {
                        // Not applicable (student) needs no type or reason: clear them.
                        setForm(prev => ({
                          ...prev,
                          employmentStatus: opt.value,
                          ...(opt.value === EMPLOYMENT_STATUS_NOT_APPLICABLE ? { employmentType: "", unemploymentReason: "", laidoffCountry: "" } : {}),
                        }));
                        clearFieldError("employmentStatus");
                      }}
                      disabled={saving}
                    >
                      {optionLabel(opt, t)}
                    </button>
                  ))}
                </div>
              </FieldGroup>
              {form.employmentStatus === "employed" && (
                <FieldGroup id="employmentType" legend={<span className="onboarding-label">Employment Type</span>} error={errors.employmentType}>
                  <div className="pill-row">
                    <button type="button" aria-pressed={form.employmentType === "wage"} className={`pill-btn ${form.employmentType === "wage" ? "active" : ""}`} onClick={() => updateField("employmentType", "wage")} disabled={saving}>Wage</button>
                    <button type="button" aria-pressed={form.employmentType === "self"} className={`pill-btn ${form.employmentType === "self" ? "active" : ""}`} onClick={() => updateField("employmentType", "self")} disabled={saving}>Self</button>
                  </div>
                </FieldGroup>
              )}
              {form.employmentStatus === "unemployed" && (
                <>
                  <label>Reason for Unemployment
                    <select {...ariaFor(errors, "unemploymentReason")} value={form.unemploymentReason || ""} onChange={e => updateField("unemploymentReason", e.target.value)} disabled={saving}>
                      <option value="">Select</option>
                      {UNEMPLOYMENT_REASON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{optionLabel(opt, t)}</option>
                      ))}
                    </select>
                    <FieldError id="unemploymentReason" error={errors.unemploymentReason} />
                  </label>
                  {form.unemploymentReason === "laidoff_abroad" && (
                    <label>Country <input type="text" {...ariaFor(errors, "laidoffCountry")} value={form.laidoffCountry || ""} onChange={e => updateField("laidoffCountry", e.target.value)} disabled={saving} /><FieldError id="laidoffCountry" error={errors.laidoffCountry} /></label>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 9 && (
        <div className="onboarding-step">
          <p className="onboarding-subtitle">
            Optional — a photo helps employers recognize you. You can skip this and add one later from your profile.
          </p>
          <AvatarPicker
            name={form.firstName || form.surname || user?.name}
            initialUrl={user?.profileImage}
            onUploaded={(url) => setUser((prev) => ({ ...prev, profileImage: url }))}
            disabled={saving}
          />
          <div className="id-ocr-grid">
            <label>{t("settings.account.idOcr.upload")}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleValidIdChange} disabled={saving} />{validIdError && <span role="alert">{validIdError}</span>}</label>
            <label>{t("settings.account.idOcr.resume")}<input type="file" accept=".pdf,.doc,.docx" onChange={handleResumeChange} disabled={saving} />{resumeError && <span role="alert">{resumeError}</span>}</label>
          </div>
        </div>
      )}

      {step === SUCCESS_STEP && (
        <div className="onboarding-step onboarding-success-step">
          <div className="success-icon">✓</div>
          <h2>You're all set, {form.firstName || form.surname || "Job Seeker"}!</h2>
          <p>Your profile is ready. Start exploring opportunities now.</p>
          <IdOcrReview initialOcr={user?.governmentIdOcr} />
          <div className="onboarding-nav">
            <button type="button" className="onboarding-primary" onClick={() => navigate("/profile")}>View My Profile</button>
            <button type="button" className="onboarding-secondary" onClick={() => navigate("/jobs")}>Browse Jobs</button>
          </div>
        </div>
      )}

          </div>
        </div>

        {step <= LAST_STEP && (
          <footer className="onboarding-footer-bar">
            <div className="onboarding-nav">
              <button type="button" className="onboarding-secondary" onClick={handleBack} disabled={step === 1 || saving}>Back</button>
              {step < LAST_STEP ? (
                <button type="button" className="onboarding-primary" onClick={handleNext} disabled={saving}>Next</button>
              ) : (
                <button type="button" className="onboarding-primary" onClick={submitProfile} disabled={saving}>{saving ? "Finishing..." : "Finish Setup"}</button>
              )}
            </div>
          </footer>
        )}
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
