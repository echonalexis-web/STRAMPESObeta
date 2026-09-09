import { useState, useContext, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { employerAPI } from "../services/api";
import "../styles/post-job.css";
import {
  FaBriefcase,
  FaMapMarkerAlt,
  FaMoneyBillWave,
  FaCalendarAlt,
  FaUserPlus,
  FaSave,
  FaSpinner,
  FaExclamationTriangle,
  FaCheckCircle,
  FaArrowLeft,
  FaBuilding,
  FaListUl,
  FaClipboardList,
  FaCoins,
  FaUsers,
  FaClock,
  FaInfoCircle,
} from "react-icons/fa";
import LocationSelect from "../components/LocationSelect";
import QualificationsEditor from "../components/QualificationsEditor";
import BasicRequirements from "../components/BasicRequirements";
import Autosuggest from "../components/Autosuggest";
import PH_JOB_TITLES from "../data/ph_job_titles_complete.json";
import {
  EMPTY_BASIC_REQUIREMENTS,
  pickBasicRequirements,
  serializeBasicRequirements,
  validateBasicRequirements,
} from "../utils/basicRequirements";
import VacancyCard from "../components/VacancyCard";
import { usePersistentState } from "../hooks/usePersistentState";

const VALID_INDUSTRIES = [
  "Information Technology (IT)",
  "Healthcare",
  "Finance & Banking",
  "Education",
  "Construction & Engineering",
  "Manufacturing",
  "Retail & Wholesale",
  "Hospitality & Tourism",
  "Transportation & Logistics",
  "Agriculture",
  "Media & Communications",
  "Real Estate",
  "Government & Public Administration",
  "Legal Services",
  "Telecommunications",
  "Marketing & Advertising",
  "Arts & Entertainment",
  "Human Resources",
  "Customer Service",
  "Environmental Services",
  "Others"
];

const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Remote"];
const JOB_TYPE_ICONS = {
  "Full-time": "💼",
  "Part-time": "⏰",
  Contract: "📋",
  Internship: "🎓",
  Temporary: "📅",
  Remote: "🌐",
};

const WORK_NATURES = [
  { value: "onsite", label: "Onsite" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
];

const formatSalaryPreview = (min, max) => {
  const hasMin = min !== "" && min !== null && min !== undefined && Number.isFinite(Number(min));
  const hasMax = max !== "" && max !== null && max !== undefined && Number.isFinite(Number(max));
  if (!hasMin && !hasMax) return "";
  const fmt = (n) => `PHP ${Number(n).toLocaleString("en-PH")}`;
  if (hasMin && hasMax && Number(min) !== Number(max)) return `${fmt(min)} - ${fmt(max)}`;
  return fmt(hasMin ? min : max);
};

const getInitialFormData = () => ({
  title: "",
  description: "",
  location: "",
  salaryMin: "",
  salaryMax: "",
  industry: "",
  jobType: "Full-time",
  workNature: "",
  slots: 1,
  qualifications: [],
  applicationDeadline: "",
  ...EMPTY_BASIC_REQUIREMENTS,
});

export default function PostJob() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  const defaultState = {
    formData: getInitialFormData(),
    activeSection: "details",
  };

  // Normalize form data to ensure arrays exist
  const normalizeFormData = (data) => {
    return {
      ...getInitialFormData(),
      ...data,
      qualifications: Array.isArray(data?.qualifications) ? data.qualifications : [],
      languageRequirements: Array.isArray(data?.languageRequirements) ? data.languageRequirements : [],
    };
  };

  const [persistedState, setPersistedState, clearPersistedState] = usePersistentState('postJobState', defaultState);

  const safeState = (persistedState && typeof persistedState === 'object' && persistedState.formData)
    ? { ...persistedState, formData: normalizeFormData(persistedState.formData) }
    : defaultState;

  const { formData, activeSection } = safeState;
  const setFormData = useCallback((updater) => {
    setPersistedState((prev) => {
      const newFormData = typeof updater === 'function' ? updater(prev.formData) : updater;
      if (newFormData === prev.formData) return prev;
      return { ...prev, formData: newFormData };
    });
  }, [setPersistedState]);

  const setActiveSection = useCallback((updater) => {
    setPersistedState((prev) => {
      const newVal = typeof updater === 'function' ? updater(prev.activeSection) : updater;
      if (newVal === prev.activeSection) return prev;
      return { ...prev, activeSection: newVal };
    });
  }, [setPersistedState]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState({});
  const [validationErrors, setValidationErrors] = useState({});

  // Reusable qualification / skillset templates
  const [qualTemplates, setQualTemplates] = useState([]);
  // Requirements of the job that was just posted (for the "save as template" CTA)
  const [postedQualifications, setPostedQualifications] = useState(null);
  const [postedJobTitle, setPostedJobTitle] = useState("");
  const [postTemplateName, setPostTemplateName] = useState("");
  const [savingPostTemplate, setSavingPostTemplate] = useState(false);
  const [postTemplateMsg, setPostTemplateMsg] = useState("");

  const loadQualTemplates = async () => {
    try {
      const res = await employerAPI.getQualificationTemplates();
      setQualTemplates(Array.isArray(res.data?.templates) ? res.data.templates : []);
    } catch {
      setQualTemplates([]); // editor falls back to its built-in static templates
    }
  };

  const handleSaveQualTemplate = async ({ name, items }) => {
    const res = await employerAPI.createQualificationTemplate({
      name,
      jobTitle: formData.title || "",
      items,
    });
    await loadQualTemplates();
    return res;
  };

  useEffect(() => {
    if (!user) return;
    if (user.role !== "employer") {
      navigate("/dashboard");
      return;
    }
    if (user.verificationStatus !== "verified") {
      navigate("/employer-dashboard");
      return;
    }
    loadQualTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate]);

  const validateField = (name, value) => {
    const errors = {};
    switch (name) {
      case "title":
        if (!value.trim()) errors.title = "Job title is required";
        else if (value.trim().length < 5) errors.title = "At least 5 characters";
        else if (value.trim().length > 100) errors.title = "Max 100 characters";
        break;
      case "description":
        if (!value.trim()) errors.description = "Job description is required";
        else if (value.trim().length < 20) errors.description = "At least 20 characters";
        else if (value.trim().length > 5000) errors.description = "Max 5000 characters";
        break;
      case "location":
        if (!value.trim()) errors.location = "Location is required";
        break;
      case "qualifications":
        if (!value || value.length === 0) errors.qualifications = "At least one qualification is required";
        break;
      case "industry":
        if (!value.trim()) errors.industry = "Industry is required";
        break;
      case "slots":
        if (value < 1) errors.slots = "Min 1 slot";
        else if (value > 100) errors.slots = "Max 100 slots";
        break;
      case "salaryMin":
      case "salaryMax": {
        if (value === "" || value === null || value === undefined) break;
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
          errors[name] = "Enter a valid amount";
        }
        break;
      }
      case "applicationDeadline":
        if (value && new Date(value) < new Date(new Date().setHours(0, 0, 0, 0)))
          errors.applicationDeadline = "Must be today or later";
        break;
    }
    return errors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (touched[name]) {
      const errs = validateField(name, value);
      setValidationErrors((prev) => ({ ...prev, ...errs }));
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    const errs = validateField(name, formData[name]);
    setValidationErrors((prev) => ({ ...prev, ...errs }));
  };

  // Cancel discards the saved draft so the form starts blank next time.
  const handleCancel = () => {
    clearPersistedState();
    navigate("/employer");
  };

  const registeredBusinessAddress = (() => {
    if (!user) return "";

    const makeAddressString = (structured) => {
      if (!structured || typeof structured !== "object") return "";

      const parts = [
        structured.street,
        structured.barangay,
        structured.municipality || structured.city,
        structured.province,
        structured.region,
      ]
        .filter((part) => typeof part === "string" && part.trim())
        .map((part) => part.trim());

      return parts.join(", ");
    };

    const structuredObjectCandidates = [
      user.businessAddressStructured,
      user.businessAddressDetails,
      user.profile?.businessAddressStructured,
      user.profile?.businessAddress,
      user.profile?.address,
    ];

    for (const structured of structuredObjectCandidates) {
      const value = makeAddressString(structured);
      if (value) return value;
    }

    const stringCandidates = [
      user.businessAddress,
      user.address,
      user.profile?.businessAddress,
      user.profile?.address,
    ];

    for (const candidate of stringCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return "";
  })();

  const [useRegisteredBusinessAddress, setUseRegisteredBusinessAddress] = useState(false);
  const [locationSelectResetKey, setLocationSelectResetKey] = useState(0);

  // Update location when checkbox state or registered address changes
  useEffect(() => {
    if (!useRegisteredBusinessAddress) return;

    const nextLocation = registeredBusinessAddress || "";
    if (formData.location !== nextLocation) {
      setFormData((prev) => ({ ...prev, location: nextLocation }));
    }

    const nextError = registeredBusinessAddress
      ? ""
      : "No registered business address found. Please update your profile.";

    setValidationErrors((prev) => {
      if (prev.location === nextError) return prev;
      return { ...prev, location: nextError };
    });
  }, [useRegisteredBusinessAddress, registeredBusinessAddress, formData.location, setFormData]);

  const handleLocationChange = (nextLocation) => {
    setUseRegisteredBusinessAddress(false);
    setFormData((prev) => ({ ...prev, location: nextLocation }));
    if (touched.location) {
      const errs = validateField("location", nextLocation);
      setValidationErrors((prev) => ({ ...prev, ...errs }));
    }
  };

  const handleUseRegisteredBusinessAddressToggle = (nextValue) => {
    setUseRegisteredBusinessAddress(nextValue);

    if (!nextValue) {
      setPersistedState((prev) => ({
        ...prev,
        formData: {
          ...prev.formData,
          location: "",
        },
      }));
      setFormData((prev) => ({ ...prev, location: "" }));
      setLocationSelectResetKey((prev) => prev + 1);
      setTouched((prev) => ({ ...prev, location: true }));
      setValidationErrors((prev) => ({ ...prev, location: "Location is required" }));
      return;
    }

    if (registeredBusinessAddress) {
      setFormData((prev) => ({ ...prev, location: registeredBusinessAddress }));
      setValidationErrors((prev) => ({ ...prev, location: "" }));
    } else {
      setFormData((prev) => ({ ...prev, location: "" }));
      setValidationErrors((prev) => ({ ...prev, location: "No registered business address found. Please update your profile." }));
    }
    setTouched((prev) => ({ ...prev, location: true }));
  };

  const handleQualificationsChange = (newQuals) => {
    setFormData((prev) => ({ ...prev, qualifications: newQuals }));
    if (touched.qualifications) {
      const errs = validateField("qualifications", newQuals);
      setValidationErrors((prev) => ({ ...prev, ...errs }));
    }
  };

  const validateForm = () => {
    const errors = {};
    ["title", "description", "location", "industry", "qualifications", "slots", "salaryMin", "salaryMax"].forEach((field) => {
      const fieldErrors = validateField(field, formData[field]);
      Object.assign(errors, fieldErrors);
    });
    if (
      formData.salaryMin !== "" && formData.salaryMax !== "" &&
      Number(formData.salaryMin) > Number(formData.salaryMax)
    ) {
      errors.salaryMax = "Maximum must be greater than or equal to minimum";
    }
    if (formData.applicationDeadline && new Date(formData.applicationDeadline) < new Date(new Date().setHours(0, 0, 0, 0)))
      errors.applicationDeadline = "Must be today or later";
    const basicReqIssues = validateBasicRequirements(pickBasicRequirements(formData));
    if (basicReqIssues.length > 0) errors.basicRequirements = basicReqIssues[0];
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    const allTouched = Object.keys(formData).reduce((acc, key) => ({ ...acc, [key]: true }), {});
    setTouched(allTouched);
    if (!validateForm()) {
      const firstError = document.querySelector(".pj-field-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setLoading(true);
    try {
      const trimmedData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        location: formData.location.trim(),
        salaryMin: formData.salaryMin !== "" ? Number(formData.salaryMin) : undefined,
        salaryMax: formData.salaryMax !== "" ? Number(formData.salaryMax) : undefined,
        industry: (formData.industry || "").trim(),
        jobType: formData.jobType,
        workNature: formData.workNature || undefined,
        slots: Number(formData.slots) || 1,
        qualifications: Array.isArray(formData.qualifications) ? formData.qualifications : [],
        applicationDeadline: formData.applicationDeadline || undefined,
        ...serializeBasicRequirements(pickBasicRequirements(formData)),
      };
      await employerAPI.createJob(trimmedData);
      setPostedQualifications(trimmedData.qualifications || []);
      setPostedJobTitle(trimmedData.title);
      setPostTemplateName(trimmedData.title);
      setPostTemplateMsg("");
      setSuccess(true);
      clearPersistedState(); // clear saved draft
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create job vacancy");
    } finally {
      setLoading(false);
    }
  };

  const handleSavePostedAsTemplate = async () => {
    const name = postTemplateName.trim();
    if (!name) {
      setPostTemplateMsg("Give the template a name");
      return;
    }
    if (!postedQualifications || postedQualifications.length === 0) {
      setPostTemplateMsg("This job has no requirements to save");
      return;
    }
    setSavingPostTemplate(true);
    setPostTemplateMsg("");
    try {
      await employerAPI.createQualificationTemplate({
        name,
        jobTitle: postedJobTitle || "",
        items: postedQualifications.map((q) => ({
          type: q.type,
          value: q.value,
          optional: Boolean(q.optional),
        })),
      });
      await loadQualTemplates();
      setPostedQualifications(null); // hide the CTA once saved
      setPostTemplateMsg("saved");
    } catch (err) {
      setPostTemplateMsg(err?.response?.data?.message || "Could not save template");
    } finally {
      setSavingPostTemplate(false);
    }
  };

  const startAnotherJob = () => {
    setFormData(getInitialFormData());
    setTouched({});
    setValidationErrors({});
    setSuccess(false);
    setPostedQualifications(null);
    setPostTemplateMsg("");
    setActiveSection("details");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const getCharCount = (text) => text?.length || 0;
  const getCharColor = (count, max, warning = 80) => {
    if (count === 0) return "muted";
    if (count > max) return "danger";
    if (count > max * (warning / 100)) return "warning";
    return "success";
  };

  const sections = [
    { id: "details", label: "Job Details", icon: <FaClipboardList /> },
    { id: "logistics", label: "Logistics", icon: <FaCoins /> },
    { id: "requirements", label: "Requirements", icon: <FaListUl /> },
  ];

  return (
    <div className="pj-page">
      <div className="pj-topbar">
        <button className="pj-back-btn" onClick={() => navigate("/employer")} disabled={loading}>
          <FaArrowLeft /> Back to Dashboard
        </button>
        <div className="pj-topbar-title">
          <FaBriefcase /> Post a New Job
        </div>
        <div className="pj-topbar-spacer" />
      </div>

      <div className="pj-container">
        <aside className="pj-sidebar">
          <div className="pj-sidebar-card">
            <h3>Progress</h3>
            <nav className="pj-progress-nav">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  className={`pj-progress-item ${activeSection === sec.id ? "active" : ""}`}
                  onClick={() => {
                    setActiveSection(sec.id);
                    document.getElementById(`section-${sec.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  type="button"
                >
                  <span className="pj-progress-icon">{sec.icon}</span>
                  <span className="pj-progress-label">{sec.label}</span>
                  {sec.id === "details" && formData.title && formData.description && (
                    <span className="pj-progress-check">✓</span>
                  )}
                  {sec.id === "logistics" && formData.location && (
                    <span className="pj-progress-check">✓</span>
                  )}
                  {sec.id === "requirements" && formData.qualifications.length > 0 && (
                    <span className="pj-progress-check">✓</span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="pj-sidebar-card pj-preview-card">
            <h3><FaBuilding /> Live Preview</h3>
            <p className="pj-preview-hint">How this listing will appear to jobseekers.</p>
            <div className="pj-preview-stage">
              <VacancyCard
                preview
                job={{
                  title: formData.title,
                  description: formData.description,
                  location: formData.location,
                  salary: formatSalaryPreview(formData.salaryMin, formData.salaryMax),
                  jobType: formData.jobType,
                  slots: Number(formData.slots) || 1,
                  qualifications: formData.qualifications,
                  applicationCount: 0,
                  createdAt: new Date().toISOString(),
                  employer: { companyName: user?.companyName || user?.name || "Your company" },
                }}
              />
            </div>
          </div>
        </aside>

        <main className="pj-main">
          {error && (
            <div className="pj-alert pj-alert-error">
              <FaExclamationTriangle />
              <span>{error}</span>
            </div>
          )}
          {success ? (
            <div className="pj-success-panel">
              <div className="pj-alert pj-alert-success">
                <FaCheckCircle />
                <span>&ldquo;{postedJobTitle}&rdquo; was posted successfully.</span>
              </div>

              {postedQualifications && postedQualifications.length > 0 && (
                <div className="pj-template-cta">
                  <h3>
                    <FaClipboardList /> Save these requirements as a reusable template?
                  </h3>
                  <p>
                    Load them into your next posting with one click. You have{" "}
                    {postedQualifications.length} requirement
                    {postedQualifications.length === 1 ? "" : "s"} on this job.
                  </p>
                  <div className="pj-template-cta-row">
                    <input
                      type="text"
                      value={postTemplateName}
                      onChange={(e) => setPostTemplateName(e.target.value)}
                      placeholder="Template name"
                      disabled={savingPostTemplate}
                    />
                    <button
                      type="button"
                      className="pj-btn pj-btn-primary"
                      onClick={handleSavePostedAsTemplate}
                      disabled={savingPostTemplate || !postTemplateName.trim()}
                    >
                      {savingPostTemplate ? "Saving..." : "Save template"}
                    </button>
                  </div>
                  {postTemplateMsg && postTemplateMsg !== "saved" && (
                    <div className="pj-template-cta-error">{postTemplateMsg}</div>
                  )}
                </div>
              )}

              {postTemplateMsg === "saved" && (
                <div className="pj-alert pj-alert-success">
                  <FaCheckCircle />
                  <span>Template saved. It&rsquo;s now in your template list.</span>
                </div>
              )}

              <div className="pj-actions">
                <button
                  type="button"
                  className="pj-btn pj-btn-secondary"
                  onClick={() => navigate("/employer")}
                >
                  Go to Dashboard
                </button>
                <button type="button" className="pj-btn pj-btn-primary" onClick={startAnotherJob}>
                  <FaSave /> Post Another Job
                </button>
              </div>
            </div>
          ) : (
          <form className="pj-form" onSubmit={handleSubmit} noValidate>
            <section id="section-details" className="pj-section">
              <div className="pj-section-header">
                <div className="pj-section-icon"><FaClipboardList /></div>
                <div>
                  <h2>Job Details</h2>
                  <p>Start with the basics about the role</p>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <label htmlFor="title">
                  Job Title <span className="pj-required">*</span>
                </label>
                <Autosuggest
                  id="title"
                  name="title"
                  placeholder="e.g. Senior Frontend Developer"
                  value={formData.title}
                  onChange={(v) => handleChange({ target: { name: "title", value: v } })}
                  onBlur={() => handleBlur({ target: { name: "title" } })}
                  options={PH_JOB_TITLES}
                  inputClassName={validationErrors.title && touched.title ? "pj-error-input" : ""}
                  maxLength={100}
                  disabled={loading}
                />
                <div className="pj-field-footer">
                  {validationErrors.title && touched.title ? (
                    <span className="pj-field-error">{validationErrors.title}</span>
                  ) : (
                    <span />
                  )}
                  <span className={`pj-char-count ${getCharColor(getCharCount(formData.title), 100, 70)}`}>
                    {getCharCount(formData.title)} / 100
                  </span>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <label htmlFor="description">
                  Job Description <span className="pj-required">*</span>
                </label>
                <textarea
                  id="description"
                  name="description"
                  placeholder="Describe the role, responsibilities, and what success looks like..."
                  value={formData.description}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={validationErrors.description && touched.description ? "pj-error-input" : ""}
                  rows={8}
                  maxLength={5000}
                  required
                  disabled={loading}
                />
                <div className="pj-field-footer">
                  {validationErrors.description && touched.description ? (
                    <span className="pj-field-error">{validationErrors.description}</span>
                  ) : (
                    <span />
                  )}
                  <span className={`pj-char-count ${getCharColor(getCharCount(formData.description), 5000, 80)}`}>
                    {getCharCount(formData.description)} / 5000
                  </span>
                </div>
              </div>
            </section>

            <section id="section-logistics" className="pj-section">
              <div className="pj-section-header">
                <div className="pj-section-icon"><FaCoins /></div>
                <div>
                  <h2>Compensation & Logistics</h2>
                  <p>Where, how, and how much</p>
                </div>
              </div>

              <div className="pj-logistics-grid">
                <div className="pj-logistics-panel">
                  <div className="pj-location-header-row">
                    <label className="pj-location-label">
                      <FaMapMarkerAlt /> Location <span className="pj-required">*</span>
                    </label>
                  </div>

                  <div className={`pj-address-toggle-card ${useRegisteredBusinessAddress ? "active" : ""}`}>
                    <label className="pj-address-toggle">
                      <input
                        type="checkbox"
                        checked={useRegisteredBusinessAddress}
                        onChange={(e) => handleUseRegisteredBusinessAddressToggle(e.target.checked)}
                        disabled={loading}
                      />
                      <div className="pj-address-toggle-copy">
                        <span className="pj-address-toggle-title">Use Registered Business Address</span>
                        <span className="pj-address-toggle-subtitle">Automatically fill location details from your registered employer profile.</span>
                      </div>
                    </label>
                    {useRegisteredBusinessAddress && !registeredBusinessAddress && (
                      <div className="pj-address-missing-warning">
                        <FaInfoCircle /> No registered business address found. Please update your profile.
                      </div>
                    )}
                  </div>

                  <div className="pj-location-field-group">
                    <div className="pj-location-select-wrap">
                      <LocationSelect
                        key={locationSelectResetKey}
                        className="pj-location-select-group"
                        value={formData.location}
                        onChange={handleLocationChange}
                        disabled={loading || useRegisteredBusinessAddress}
                        required
                      />
                    </div>
                  </div>

                  {validationErrors.location && touched.location && (
                    <span className="pj-field-error">{validationErrors.location}</span>
                  )}
                </div>

                <div className="pj-logistics-panel">
                  <div className="pj-field">
                    <label htmlFor="salaryMin">
                      <FaMoneyBillWave /> Salary Range (PHP) <span className="pj-optional">(Optional)</span>
                    </label>
                    <div className="pj-salary-range-row">
                      <input
                        id="salaryMin"
                        type="number"
                        min="0"
                        name="salaryMin"
                        placeholder="Min, e.g. 18000"
                        value={formData.salaryMin}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className={validationErrors.salaryMin && touched.salaryMin ? "pj-error-input" : ""}
                        disabled={loading}
                      />
                      <span className="pj-salary-range-sep">to</span>
                      <input
                        id="salaryMax"
                        type="number"
                        min="0"
                        name="salaryMax"
                        placeholder="Max, e.g. 25000"
                        value={formData.salaryMax}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className={validationErrors.salaryMax && touched.salaryMax ? "pj-error-input" : ""}
                        disabled={loading}
                      />
                    </div>
                    {(validationErrors.salaryMin && touched.salaryMin) && (
                      <span className="pj-field-error">{validationErrors.salaryMin}</span>
                    )}
                    {(validationErrors.salaryMax && touched.salaryMax) && (
                      <span className="pj-field-error">{validationErrors.salaryMax}</span>
                    )}
                    <span className="pj-hint">Leave blank if negotiable. Numeric ranges let jobseekers filter and match by salary.</span>
                  </div>

                  <div className="pj-field">
                    <label htmlFor="industry">
                      <FaBuilding /> Industry <span className="pj-required">*</span>
                    </label>
                    <div className="pj-select-wrapper">
                      <select
                        id="industry"
                        name="industry"
                        value={formData.industry}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className={validationErrors.industry && touched.industry ? "pj-error-input" : ""}
                        required
                        disabled={loading}
                      >
                        <option value="">-- Select Industry --</option>
                        {VALID_INDUSTRIES.map((ind) => (
                          <option key={ind} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>
                    {validationErrors.industry && touched.industry && (
                      <span className="pj-field-error">{validationErrors.industry}</span>
                    )}
                  </div>

                  <div className="pj-field">
                    <label htmlFor="workNature">
                      <FaBuilding /> Work Nature <span className="pj-optional">(Optional)</span>
                    </label>
                    <div className="pj-select-wrapper">
                      <select
                        id="workNature"
                        name="workNature"
                        value={formData.workNature}
                        onChange={handleChange}
                        disabled={loading}
                      >
                        <option value="">-- Not specified --</option>
                        {WORK_NATURES.map((wn) => (
                          <option key={wn.value} value={wn.value}>{wn.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="pj-field">
                    <label htmlFor="jobType">
                      <FaBriefcase /> Job Type
                    </label>
                    <div className="pj-select-wrapper">
                      <select
                        id="jobType"
                        name="jobType"
                        value={formData.jobType}
                        onChange={handleChange}
                        disabled={loading}
                      >
                        {JOB_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {JOB_TYPE_ICONS[type]} {type}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="pj-field">
                    <label htmlFor="slots">
                      <FaUserPlus /> Open Slots <span className="pj-required">*</span>
                    </label>
                    <input
                      id="slots"
                      type="number"
                      min="1"
                      max="100"
                      name="slots"
                      value={formData.slots}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      className={validationErrors.slots && touched.slots ? "pj-error-input" : ""}
                      required
                      disabled={loading}
                    />
                    {validationErrors.slots && touched.slots && (
                      <span className="pj-field-error">{validationErrors.slots}</span>
                    )}
                  </div>

                  <div className="pj-field">
                    <label htmlFor="applicationDeadline">
                      <FaCalendarAlt /> Application Deadline <span className="pj-optional">(Optional)</span>
                    </label>
                    <input
                      id="applicationDeadline"
                      type="date"
                      name="applicationDeadline"
                      value={formData.applicationDeadline}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      min={new Date().toISOString().split("T")[0]}
                      className={validationErrors.applicationDeadline && touched.applicationDeadline ? "pj-error-input" : ""}
                      disabled={loading}
                    />
                    {validationErrors.applicationDeadline && touched.applicationDeadline && (
                      <span className="pj-field-error">{validationErrors.applicationDeadline}</span>
                    )}
                    <span className="pj-hint">Leave blank for no deadline.</span>
                  </div>
                </div>
              </div>
            </section>

            <section id="section-requirements" className="pj-section">
              <div className="pj-section-header">
                <div className="pj-section-icon"><FaListUl /></div>
                <div>
                  <h2>Requirements</h2>
                  <p>What candidates need to qualify</p>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <BasicRequirements
                  value={pickBasicRequirements(formData)}
                  onChange={(next) => setFormData((prev) => ({ ...prev, ...next }))}
                  disabled={loading}
                />
                {validationErrors.basicRequirements && (
                  <span className="pj-field-error">{validationErrors.basicRequirements}</span>
                )}
              </div>

              <div className="pj-field pj-field-full">
                <QualificationsEditor
                  value={formData.qualifications}
                  onChange={handleQualificationsChange}
                  disabled={loading}
                  required
                  templates={qualTemplates}
                  jobTitleHint={formData.title}
                  onSaveTemplate={handleSaveQualTemplate}
                />
                {validationErrors.qualifications && touched.qualifications && (
                  <span className="pj-field-error">{validationErrors.qualifications}</span>
                )}
              </div>
            </section>

            <div className="pj-actions">
              <button
                type="button"
                className="pj-btn pj-btn-secondary"
                onClick={handleCancel}
                disabled={loading}
              >
                Cancel
              </button>
              <button type="submit" className="pj-btn pj-btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <FaSpinner className="pj-spin" /> Posting...
                  </>
                ) : (
                  <>
                    <FaSave /> Post Job Vacancy
                  </>
                )}
              </button>
            </div>
          </form>
          )}
        </main>
      </div>
    </div>
  );
}