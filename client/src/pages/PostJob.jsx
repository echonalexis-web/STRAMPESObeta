import { useState, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { employerAPI } from "../services/api";
import "../styles/dashboard.css";
import "../styles/post-job.css";
import { FaBriefcase, FaMapMarkerAlt, FaMoneyBillWave, FaCalendarAlt, FaUserPlus, FaFileAlt, FaSave, FaSpinner, FaExclamationTriangle, FaCheckCircle, FaArrowLeft } from "react-icons/fa";
import LocationSelect from "../components/LocationSelect";
import QualificationsEditor from "../components/QualificationsEditor";
import "../styles/qualifications-editor.css";

const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Remote"];
const JOB_TYPE_ICONS = { "Full-time": "💼", "Part-time": "⏰", "Contract": "📋", "Internship": "🎓", "Temporary": "📅", "Remote": "🌐" };

export default function PostJob() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    title: "", description: "", location: "", salary: "", jobType: "Full-time", slots: 1, qualifications: [], applicationDeadline: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState({});
  const [validationErrors, setValidationErrors] = useState({});

  useEffect(() => {
    if (user && user.role !== "employer") navigate("/dashboard");
  }, [user, navigate]);

  const validateField = (name, value) => {
    const errors = {};
    switch(name) {
      case "title": if (!value.trim()) errors.title = "Job title is required"; else if (value.trim().length < 5) errors.title = "Job title must be at least 5 characters"; else if (value.trim().length > 100) errors.title = "Job title must be less than 100 characters"; break;
      case "description": if (!value.trim()) errors.description = "Job description is required"; else if (value.trim().length < 20) errors.description = "Description must be at least 20 characters"; else if (value.trim().length > 5000) errors.description = "Description must be less than 5000 characters"; break;
      case "location": if (!value.trim()) errors.location = "Location is required"; break;
      case "qualifications": if (!value || value.length === 0) errors.qualifications = "At least one qualification is required"; break;
      case "slots": if (value < 1) errors.slots = "Must have at least 1 slot"; else if (value > 100) errors.slots = "Cannot exceed 100 slots"; break;
      case "salary": if (value && !/^[0-9,.\s]+$/.test(value)) errors.salary = "Invalid salary format"; break;
      case "applicationDeadline": if (value && new Date(value) < new Date()) errors.applicationDeadline = "Deadline must be in the future"; break;
    }
    return errors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (touched[name]) {
      const errs = validateField(name, value);
      setValidationErrors(prev => ({ ...prev, ...errs }));
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    const errs = validateField(name, formData[name]);
    setValidationErrors(prev => ({ ...prev, ...errs }));
  };

  const handleQualificationsChange = (newQuals) => {
    setFormData(prev => ({ ...prev, qualifications: newQuals }));
    if (touched.qualifications) {
      const errs = validateField("qualifications", newQuals);
      setValidationErrors(prev => ({ ...prev, ...errs }));
    }
  };

  const validateForm = () => {
    const errors = {};
    ["title", "description", "location", "qualifications", "slots"].forEach(field => {
      const fieldErrors = validateField(field, formData[field]);
      Object.assign(errors, fieldErrors);
    });
    if (formData.salary && !/^[0-9,.\s]+$/.test(formData.salary)) errors.salary = "Invalid salary format";
    if (formData.applicationDeadline && new Date(formData.applicationDeadline) < new Date()) errors.applicationDeadline = "Deadline must be in the future";
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(false);
    const allTouched = Object.keys(formData).reduce((acc, key) => ({ ...acc, [key]: true }), {});
    setTouched(allTouched);
    if (!validateForm()) {
      const firstError = document.querySelector(".post-job-field-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setLoading(true);
    try {
      const trimmedData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        location: formData.location.trim(),
        salary: formData.salary.trim(),
        jobType: formData.jobType,
        slots: Number(formData.slots) || 1,
        qualifications: formData.qualifications,
        applicationDeadline: formData.applicationDeadline || undefined,
      };
      await employerAPI.createJob(trimmedData);
      setSuccess(true);
      setTimeout(() => {
        setFormData({ title: "", description: "", location: "", salary: "", jobType: "Full-time", slots: 1, qualifications: [], applicationDeadline: "" });
        setTouched({}); setValidationErrors({}); setSuccess(false);
        navigate("/employer");
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create job vacancy");
    } finally {
      setLoading(false);
    }
  };

  const getCharCount = (text) => text?.length || 0;
  const getCharColor = (count, max, warning = 80) => {
    if (count === 0) return "text-muted";
    if (count > max) return "text-danger";
    if (count > max * (warning / 100)) return "text-warning";
    return "text-success";
  };

  return (
    <div className="dashboard-container post-job-page">
      <div className="dashboard-header post-job-header">
        <div className="profile-section">
          <div className="profile-avatar post-job-avatar"><FaBriefcase /></div>
          <div className="profile-info"><h1>Post a New Job</h1><p>Create a job vacancy and find the right talent for your company.</p></div>
        </div>
        <button className="post-job-back-btn" onClick={() => navigate("/employer")} disabled={loading}><FaArrowLeft /> Back to Dashboard</button>
      </div>

      <div className="post-job-card">
        {error && <div className="post-job-error"><FaExclamationTriangle className="error-icon" /><span>{error}</span></div>}
        {success && <div className="post-job-success"><FaCheckCircle className="success-icon" /><span>Job vacancy created successfully! Redirecting...</span></div>}
        <form className="post-job-form" onSubmit={handleSubmit} noValidate>
          <div className="post-job-form-grid">
            <div className="post-job-field post-job-field--full">
              <label htmlFor="title">Job Title <span className="required-star">*</span></label>
              <input id="title" type="text" name="title" placeholder="Enter job title" value={formData.title} onChange={handleChange} onBlur={handleBlur} className={validationErrors.title && touched.title ? "is-error" : ""} maxLength={100} required disabled={loading} />
              <div className="post-job-field-helper">
                <span className="char-counter"><span className={getCharColor(getCharCount(formData.title), 100, 70)}>{getCharCount(formData.title)} / 100</span></span>
                {validationErrors.title && touched.title && <span className="field-error post-job-field-error">{validationErrors.title}</span>}
              </div>
            </div>

            <div className="post-job-field post-job-field--full">
              <label htmlFor="description">Job Description <span className="required-star">*</span></label>
              <textarea id="description" name="description" placeholder="Describe responsibilities, role scope, and expectations..." value={formData.description} onChange={handleChange} onBlur={handleBlur} className={validationErrors.description && touched.description ? "is-error" : ""} rows="6" maxLength={5000} required disabled={loading} />
              <div className="post-job-field-helper">
                <span className="char-counter"><span className={getCharColor(getCharCount(formData.description), 5000, 80)}>{getCharCount(formData.description)} / 5000</span></span>
                {validationErrors.description && touched.description && <span className="field-error post-job-field-error">{validationErrors.description}</span>}
              </div>
            </div>

            <div className="post-job-field">
              <label><FaMapMarkerAlt /> Location <span className="required-star">*</span></label>
              <LocationSelect
                value={formData.location}
                onChange={(loc) => { setFormData(prev => ({ ...prev, location: loc })); if (touched.location) { const errs = validateField("location", loc); setValidationErrors(prev => ({ ...prev, ...errs })); } }}
                disabled={loading}
                required
              />
              {validationErrors.location && touched.location && <span className="field-error post-job-field-error">{validationErrors.location}</span>}
            </div>

            <div className="post-job-field">
              <label htmlFor="salary"><FaMoneyBillWave /> Salary (Optional)</label>
              <input id="salary" type="text" name="salary" placeholder="e.g. PHP 18,000 - 25,000" value={formData.salary} onChange={handleChange} onBlur={handleBlur} className={validationErrors.salary && touched.salary ? "is-error" : ""} disabled={loading} />
              {validationErrors.salary && touched.salary && <span className="field-error post-job-field-error">{validationErrors.salary}</span>}
              <span className="field-hint">Use format: PHP 18,000 or 18,000 - 25,000</span>
            </div>

            <div className="post-job-field">
              <label htmlFor="jobType"><FaBriefcase /> Job Type</label>
              <select id="jobType" name="jobType" value={formData.jobType} onChange={handleChange} disabled={loading}>
                {JOB_TYPES.map(type => <option key={type} value={type}>{JOB_TYPE_ICONS[type]} {type}</option>)}
              </select>
            </div>

            <div className="post-job-field">
              <label htmlFor="slots"><FaUserPlus /> Slots Available <span className="required-star">*</span></label>
              <input id="slots" type="number" min="1" max="100" name="slots" value={formData.slots} onChange={handleChange} onBlur={handleBlur} className={validationErrors.slots && touched.slots ? "is-error" : ""} required disabled={loading} />
              {validationErrors.slots && touched.slots && <span className="field-error post-job-field-error">{validationErrors.slots}</span>}
            </div>

            <div className="post-job-field">
              <label htmlFor="applicationDeadline"><FaCalendarAlt /> Application Deadline (Optional)</label>
              <input id="applicationDeadline" type="date" name="applicationDeadline" value={formData.applicationDeadline} onChange={handleChange} onBlur={handleBlur} min={new Date().toISOString().split("T")[0]} className={validationErrors.applicationDeadline && touched.applicationDeadline ? "is-error" : ""} disabled={loading} />
              {validationErrors.applicationDeadline && touched.applicationDeadline && <span className="field-error post-job-field-error">{validationErrors.applicationDeadline}</span>}
              <span className="field-hint">Leave empty for no deadline</span>
            </div>

            {/* Qualifications Editor */}
            <div className="post-job-field post-job-field--full">
              <label>Qualifications / Requirements <span className="required-star">*</span></label>
              <QualificationsEditor
                value={formData.qualifications}
                onChange={handleQualificationsChange}
                disabled={loading}
                required
              />
              {validationErrors.qualifications && touched.qualifications && (
                <span className="field-error post-job-field-error">{validationErrors.qualifications}</span>
              )}
            </div>

            <div className="post-job-field post-job-field--full post-job-actions">
              <button type="button" className="post-job-cancel" onClick={() => navigate("/employer")} disabled={loading}>Cancel</button>
              <button type="submit" className="post-job-submit" disabled={loading}>
                {loading ? <><FaSpinner className="spinner" /> Posting...</> : <><FaSave /> Post Job</>}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}