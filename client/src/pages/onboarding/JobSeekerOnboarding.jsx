import { useContext, useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { authAPI } from "../../services/api";
import "../../styles/onboarding.css";
import LocationSelect from "../../components/LocationSelect";
import { usePersistentState } from "../../hooks/usePersistentState";

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

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const getInitialForm = (user) => ({
  name: user?.name || "",
  phone: user?.phone || "",
  dateOfBirth: user?.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : "",
  gender: user?.gender || "",
  civilStatus: "",
  placeOfBirth: "",
  citizenship: "",
  height: "",
  weight: "",
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
  employmentStatus: "",
  employmentType: "",
  unemploymentReason: "",
  laidoffCountry: "",
  address: user?.address || "",
  desiredJobTitle: user?.desiredJobTitle || "",
  educationalAttainment: user?.educationalAttainment || "",
  workExperience: user?.workExperience || "",
  availabilityStatus: user?.availabilityStatus || "",
});

export default function JobSeekerOnboarding() {
  const { user, login } = useContext(AuthContext);
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
    const newForm = typeof updater === 'function' ? updater(currentState.form) : updater;
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
  const [resumeFile, setResumeFile] = useState(null);
  const [validIdFile, setValidIdFile] = useState(null);
  const [resumeError, setResumeError] = useState("");
  const [validIdError, setValidIdError] = useState("");

  // On mount, if user has onboarding completed, redirect
  useEffect(() => {
    if (user?.hasCompletedOnboarding === true || user?.onboardingComplete === true) {
      const role = user?.role || "resident";
      if (role === "employer") navigate("/employer-dashboard");
      else navigate("/dashboard");
    }
    // If no persisted state exists, or it's corrupted, reset to user data
    if (user && !localStorage.getItem('jobseekerOnboarding')) {
      setForm(getInitialForm(user));
    }
  }, [user, navigate]);

  const progress = useMemo(() => (Math.min(step, 6) / 6) * 100, [step]);

  const updateField = (name, value) => setForm(prev => ({ ...prev, [name]: value }));

  const updateAddress = (type, field, value) => {
    setForm(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value }
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
    if (step === 2 && preferredIndustries.length < 1) {
      setError("Please select at least one preferred industry.");
      return;
    }
    if (step === 3 && skills.length < 1) {
      setError("Please add at least one skill before continuing.");
      return;
    }
    setStep(prev => Math.min(prev + 1, 7));
  };

  const handleBack = () => {
    setError("");
    setStep(prev => Math.max(prev - 1, 1));
  };

  const submitProfile = async () => {
    setSaving(true);
    setError("");
    try {
      const data = new FormData();
      data.append("name", form.name || "");
      data.append("phone", form.phone || "");
      data.append("dateOfBirth", form.dateOfBirth || "");
      data.append("gender", form.gender || "");
      data.append("address", form.address || "");
      data.append("desiredJobTitle", form.desiredJobTitle || "");
      data.append("educationalAttainment", form.educationalAttainment || "");
      data.append("workExperience", form.workExperience || "");
      data.append("availabilityStatus", form.availabilityStatus || "");
      data.append("skills", JSON.stringify(skills));
      data.append("onboardingComplete", "true");
      data.append("hasCompletedOnboarding", "true");

      data.append("preferredIndustries", JSON.stringify(preferredIndustries));
      data.append("industryPreferenceLevel", industryPreferenceLevel);
      data.append("industrySelectionStep", "true");

      data.append("civilStatus", form.civilStatus || "");
      data.append("placeOfBirth", form.placeOfBirth || "");
      data.append("citizenship", form.citizenship || "");
      data.append("height", form.height || "");
      data.append("weight", form.weight || "");
      data.append("landline", form.landline || "");
      data.append("mobileSecondary", form.mobileSecondary || "");
      data.append("presentAddress", JSON.stringify(form.presentAddress));
      data.append("permanentAddress", JSON.stringify(form.permanentAddress));
      data.append("disability", JSON.stringify(form.disability));
      data.append("is4psBeneficiary", form.is4psBeneficiary ? "true" : "false");
      data.append("_4psHouseholdId", form._4psHouseholdId || "");
      data.append("isOfw", form.isOfw ? "true" : "false");
      data.append("isRepatriated", form.isRepatriated ? "true" : "false");
      data.append("repatriationIntent", form.repatriationIntent || "");
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
      setStep(7);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to complete onboarding. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="onboarding-card">
      {step <= 6 && (
        <>
          <div className="onboarding-progress-meta">Step {step} of 6</div>
          <div className="onboarding-progress-track"><div className="onboarding-progress-fill" style={{ width: `${progress}%` }}></div></div>
        </>
      )}
      {error && <div className="onboarding-error" role="alert">{error}</div>}

      {step === 1 && (
        <div className="onboarding-step">
          <h2>Personal Details</h2>
          <p className="onboarding-subtitle">Tell us about yourself so employers can get to know you.</p>
          <div className="onboarding-fields">
            <label>Full Name <input type="text" value={form.name || ""} onChange={e => updateField("name", e.target.value)} disabled={saving} /></label>
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
          <p className="onboarding-hint">Suggestions:</p>
          <div className="suggestions-row">
            {suggestedSkills.map(skill => <button key={skill} type="button" className="suggestion-chip" onClick={() => addSkill(skill)} disabled={saving}>+ {skill}</button>)}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="onboarding-step">
          <h2>Work Background & Demographics</h2>
          <p className="onboarding-subtitle">Share your professional background and career goals.</p>
          <div className="onboarding-fields">
            <label>Desired Job Title <input type="text" value={form.desiredJobTitle || ""} onChange={e => updateField("desiredJobTitle", e.target.value)} disabled={saving} placeholder="e.g. Administrative Assistant" /></label>
            <label>Educational Attainment
              <select value={form.educationalAttainment || ""} onChange={e => updateField("educationalAttainment", e.target.value)} disabled={saving}>
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
      )}

      {step === 5 && (
        <div className="onboarding-step">
          <h2>NSRP Demographic Details</h2>
          <p className="onboarding-subtitle">Complete the NSRP Form 1 profile.</p>
          <div className="onboarding-fields">
            <label>Civil Status
              <select value={form.civilStatus || ""} onChange={e => updateField("civilStatus", e.target.value)} disabled={saving}>
                <option value="">Select</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Widowed">Widowed</option>
                <option value="Separated">Separated</option>
                <option value="Divorced">Divorced</option>
              </select>
            </label>
            <label>Place of Birth <input type="text" value={form.placeOfBirth || ""} onChange={e => updateField("placeOfBirth", e.target.value)} disabled={saving} /></label>
            <label>Citizenship <input type="text" value={form.citizenship || ""} onChange={e => updateField("citizenship", e.target.value)} disabled={saving} /></label>
            <div className="onboarding-field-grid">
              <label>Height (cm) <input type="number" value={form.height || ""} onChange={e => updateField("height", e.target.value)} disabled={saving} /></label>
              <label>Weight (kg) <input type="number" value={form.weight || ""} onChange={e => updateField("weight", e.target.value)} disabled={saving} /></label>
            </div>
            <label>Landline <input type="tel" value={form.landline || ""} onChange={e => updateField("landline", e.target.value)} disabled={saving} /></label>
            <label>Secondary Mobile <input type="tel" value={form.mobileSecondary || ""} onChange={e => updateField("mobileSecondary", e.target.value)} disabled={saving} /></label>

            <div className="onboarding-address-group">
              <span className="onboarding-label">Present Address</span>
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
                value={`${form.presentAddress.barangay || ""}, ${form.presentAddress.municipality || ""}, ${form.presentAddress.province || ""}, ${form.presentAddress.region || ""}`}
                onChange={(loc) => {
                  const parts = loc.split(", ");
                  const [barangay, municipality, province, region] = parts;
                  updateAddress("presentAddress", "barangay", barangay || "");
                  updateAddress("presentAddress", "municipality", municipality || "");
                  updateAddress("presentAddress", "province", province || "");
                  updateAddress("presentAddress", "region", region || "");
                }}
                disabled={saving}
                required={false}
              />
            </div>

            <div className="onboarding-address-group">
              <div style={{ marginBottom: '0.5rem' }}>
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
              <span className="onboarding-label">Permanent Address</span>
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
                value={`${form.permanentAddress.barangay || ""}, ${form.permanentAddress.municipality || ""}, ${form.permanentAddress.province || ""}, ${form.permanentAddress.region || ""}`}
                onChange={(loc) => {
                  const parts = loc.split(", ");
                  const [barangay, municipality, province, region] = parts;
                  updateAddress("permanentAddress", "barangay", barangay || "");
                  updateAddress("permanentAddress", "municipality", municipality || "");
                  updateAddress("permanentAddress", "province", province || "");
                  updateAddress("permanentAddress", "region", region || "");
                }}
                disabled={saving}
                required={false}
              />
            </div>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="onboarding-step">
          <h2>Additional Demographics & Current Status</h2>
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
              </>
            )}

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
      )}

      {step === 7 && (
        <div className="onboarding-step onboarding-success-step">
          <div className="success-icon">✓</div>
          <h2>You're all set, {form.name || "Job Seeker"}!</h2>
          <p>Your profile is ready. Start exploring opportunities now.</p>
          <div className="onboarding-nav">
            <button type="button" className="onboarding-primary" onClick={() => navigate("/profile")}>View My Profile</button>
            <button type="button" className="onboarding-secondary" onClick={() => navigate("/jobs")}>Browse Jobs</button>
          </div>
        </div>
      )}

      {step <= 6 && (
        <div className="onboarding-nav">
          <button type="button" className="onboarding-secondary" onClick={handleBack} disabled={step === 1 || saving}>Back</button>
          {step < 6 ? (
            <button type="button" className="onboarding-primary" onClick={handleNext} disabled={saving}>Next</button>
          ) : (
            <button type="button" className="onboarding-primary" onClick={submitProfile} disabled={saving}>{saving ? "Finishing..." : "Finish Setup"}</button>
          )}
        </div>
      )}
    </section>
  );
}