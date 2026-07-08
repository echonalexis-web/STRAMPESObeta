import { useState, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { employerAPI } from "../services/api";
import "../styles/dashboard.css";
import "../styles/post-job.css";
import { 
  FaBriefcase, 
  FaMapMarkerAlt, 
  FaMoneyBillWave, 
  FaCalendarAlt, 
  FaUserPlus, 
  FaFileAlt, 
  FaSave,
  FaSpinner,
  FaExclamationTriangle,
  FaCheckCircle,
  FaArrowLeft
} from "react-icons/fa";

const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Remote"];
const JOB_TYPE_ICONS = {
  "Full-time": "💼",
  "Part-time": "⏰",
  "Contract": "📋",
  "Internship": "🎓",
  "Temporary": "📅",
  "Remote": "🌐"
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default function PostJob() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    location: "",
    salary: "",
    jobType: "Full-time",
    slots: 1,
    requirements: "",
    applicationDeadline: "",
  });
  
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState({});
  const [validationErrors, setValidationErrors] = useState({});

  // Check if user is employer
  useEffect(() => {
    if (user && user.role !== "employer") {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  const validateField = (name, value) => {
    const errors = {};
    
    switch(name) {
      case "title":
        if (!value.trim()) {
          errors.title = "Job title is required";
        } else if (value.trim().length < 5) {
          errors.title = "Job title must be at least 5 characters";
        } else if (value.trim().length > 100) {
          errors.title = "Job title must be less than 100 characters";
        }
        // Check for suspicious content
        if (/<script|javascript:|onerror|onload|alert\(|eval\(/i.test(value)) {
          errors.title = "Job title contains invalid characters";
        }
        break;
        
      case "description":
        if (!value.trim()) {
          errors.description = "Job description is required";
        } else if (value.trim().length < 20) {
          errors.description = "Description must be at least 20 characters";
        } else if (value.trim().length > 5000) {
          errors.description = "Description must be less than 5000 characters";
        }
        break;
        
      case "location":
        if (!value.trim()) {
          errors.location = "Location is required";
        } else if (value.trim().length < 2) {
          errors.location = "Location must be at least 2 characters";
        }
        break;
        
      case "requirements":
        if (!value.trim()) {
          errors.requirements = "Requirements are required";
        } else if (value.trim().length < 10) {
          errors.requirements = "Requirements must be at least 10 characters";
        }
        break;
        
      case "slots":
        if (value < 1) {
          errors.slots = "Must have at least 1 slot";
        } else if (value > 100) {
          errors.slots = "Cannot exceed 100 slots";
        }
        break;
        
      case "salary":
        if (value && !/^[0-9,.\s]+$/.test(value)) {
          errors.salary = "Invalid salary format";
        }
        break;
        
      case "applicationDeadline":
        if (value && new Date(value) < new Date()) {
          errors.applicationDeadline = "Deadline must be in the future";
        }
        break;
    }
    
    return errors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    if (touched[name]) {
      const errors = validateField(name, value);
      setValidationErrors(prev => ({ ...prev, ...errors }));
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    
    const errors = validateField(name, formData[name]);
    setValidationErrors(prev => ({ ...prev, ...errors }));
  };

  const validateForm = () => {
    const errors = {};
    const fields = ["title", "description", "location", "requirements", "slots"];
    
    fields.forEach(field => {
      const fieldErrors = validateField(field, formData[field]);
      Object.assign(errors, fieldErrors);
    });
    
    if (formData.salary && !/^[0-9,.\s]+$/.test(formData.salary)) {
      errors.salary = "Invalid salary format";
    }
    
    if (formData.applicationDeadline && new Date(formData.applicationDeadline) < new Date()) {
      errors.applicationDeadline = "Deadline must be in the future";
    }
    
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
      const firstError = document.querySelector(".post-job-field-error");
      if (firstError) {
        firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      }
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
        requirements: formData.requirements.trim(),
        applicationDeadline: formData.applicationDeadline || undefined,
      };
      
      await employerAPI.createJob(trimmedData);
      setSuccess(true);
      
      setTimeout(() => {
        setFormData({
          title: "",
          description: "",
          location: "",
          salary: "",
          jobType: "Full-time",
          slots: 1,
          requirements: "",
          applicationDeadline: "",
        });
        setTouched({});
        setValidationErrors({});
        setSuccess(false);
        navigate("/employer");
      }, 2000);
      
    } catch (err) {
      const errorMessage = err.response?.data?.message || "Failed to create job vacancy";
      setError(errorMessage);
      document.querySelector(".post-job-error")?.scrollIntoView({ behavior: "smooth" });
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
          <div className="profile-avatar post-job-avatar">
            <FaBriefcase />
          </div>
          <div className="profile-info">
            <h1>Post a New Job</h1>
            <p>Create a job vacancy and find the right talent for your company.</p>
          </div>
        </div>
        <button 
          className="post-job-back-btn" 
          onClick={() => navigate("/employer")}
          disabled={loading}
        >
          <FaArrowLeft /> Back to Dashboard
        </button>
      </div>

      <div className="post-job-card">
        {error && (
          <div className="post-job-error">
            <FaExclamationTriangle className="error-icon" />
            <span>{error}</span>
          </div>
        )}
        
        {success && (
          <div className="post-job-success">
            <FaCheckCircle className="success-icon" />
            <span>Job vacancy created successfully! Redirecting...</span>
          </div>
        )}

        <div className="post-job-header-section">
          <p className="post-job-subtitle">
            Fill out the form below to post a new job vacancy. 
            <span className="required-indicator">*</span> Required fields
          </p>
        </div>

        <form className="post-job-form" onSubmit={handleSubmit} noValidate>
          <div className="post-job-form-grid">
            {/* Job Title */}
            <div className="post-job-field post-job-field--full">
              <label htmlFor="title">
                Job Title <span className="required-star">*</span>
              </label>
              <input
                id="title"
                type="text"
                name="title"
                placeholder="e.g. Administrative Assistant"
                value={formData.title}
                onChange={handleChange}
                onBlur={handleBlur}
                className={validationErrors.title && touched.title ? "is-error" : ""}
                maxLength={100}
                required
                disabled={loading}
              />
              <div className="post-job-field-helper">
                <span className="char-counter">
                  <span className={getCharColor(getCharCount(formData.title), 100, 70)}>
                    {getCharCount(formData.title)} / 100
                  </span>
                </span>
                {validationErrors.title && touched.title && (
                  <span className="field-error post-job-field-error">{validationErrors.title}</span>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="post-job-field post-job-field--full">
              <label htmlFor="description">
                Job Description <span className="required-star">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                placeholder="Describe responsibilities, role scope, and expectations..."
                value={formData.description}
                onChange={handleChange}
                onBlur={handleBlur}
                className={validationErrors.description && touched.description ? "is-error" : ""}
                rows="6"
                maxLength={5000}
                required
                disabled={loading}
              />
              <div className="post-job-field-helper">
                <span className="char-counter">
                  <span className={getCharColor(getCharCount(formData.description), 5000, 80)}>
                    {getCharCount(formData.description)} / 5000
                  </span>
                </span>
                {validationErrors.description && touched.description && (
                  <span className="field-error post-job-field-error">{validationErrors.description}</span>
                )}
              </div>
            </div>

            {/* Location */}
            <div className="post-job-field">
              <label htmlFor="location">
                <FaMapMarkerAlt /> Location <span className="required-star">*</span>
              </label>
              <input
                id="location"
                type="text"
                name="location"
                placeholder="e.g. Boac, Marinduque"
                value={formData.location}
                onChange={handleChange}
                onBlur={handleBlur}
                className={validationErrors.location && touched.location ? "is-error" : ""}
                required
                disabled={loading}
              />
              {validationErrors.location && touched.location && (
                <span className="field-error post-job-field-error">{validationErrors.location}</span>
              )}
            </div>

            {/* Salary */}
            <div className="post-job-field">
              <label htmlFor="salary">
                <FaMoneyBillWave /> Salary (Optional)
              </label>
              <input
                id="salary"
                type="text"
                name="salary"
                placeholder="e.g. PHP 18,000 - 25,000"
                value={formData.salary}
                onChange={handleChange}
                onBlur={handleBlur}
                className={validationErrors.salary && touched.salary ? "is-error" : ""}
                disabled={loading}
              />
              {validationErrors.salary && touched.salary && (
                <span className="field-error post-job-field-error">{validationErrors.salary}</span>
              )}
              <span className="field-hint">Use format: PHP 18,000 or 18,000 - 25,000</span>
            </div>

            {/* Job Type */}
            <div className="post-job-field">
              <label htmlFor="jobType">
                <FaBriefcase /> Job Type
              </label>
              <select
                id="jobType"
                name="jobType"
                value={formData.jobType}
                onChange={handleChange}
                disabled={loading}
              >
                {JOB_TYPES.map(type => (
                  <option key={type} value={type}>
                    {JOB_TYPE_ICONS[type]} {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Slots */}
            <div className="post-job-field">
              <label htmlFor="slots">
                <FaUserPlus /> Slots Available <span className="required-star">*</span>
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
                className={validationErrors.slots && touched.slots ? "is-error" : ""}
                required
                disabled={loading}
              />
              {validationErrors.slots && touched.slots && (
                <span className="field-error post-job-field-error">{validationErrors.slots}</span>
              )}
            </div>

            {/* Deadline */}
            <div className="post-job-field">
              <label htmlFor="applicationDeadline">
                <FaCalendarAlt /> Application Deadline (Optional)
              </label>
              <input
                id="applicationDeadline"
                type="date"
                name="applicationDeadline"
                value={formData.applicationDeadline}
                onChange={handleChange}
                onBlur={handleBlur}
                min={new Date().toISOString().split("T")[0]}
                className={validationErrors.applicationDeadline && touched.applicationDeadline ? "is-error" : ""}
                disabled={loading}
              />
              {validationErrors.applicationDeadline && touched.applicationDeadline && (
                <span className="field-error post-job-field-error">{validationErrors.applicationDeadline}</span>
              )}
              <span className="field-hint">Leave empty for no deadline</span>
            </div>

            {/* Requirements */}
            <div className="post-job-field post-job-field--full">
              <label htmlFor="requirements">
                <FaFileAlt /> Requirements <span className="required-star">*</span>
              </label>
              <textarea
                id="requirements"
                name="requirements"
                placeholder="e.g. Bachelor's degree, 2 years experience, skills..."
                value={formData.requirements}
                onChange={handleChange}
                onBlur={handleBlur}
                className={validationErrors.requirements && touched.requirements ? "is-error" : ""}
                rows="4"
                maxLength={2000}
                required
                disabled={loading}
              />
              <div className="post-job-field-helper">
                <span className="char-counter">
                  <span className={getCharColor(getCharCount(formData.requirements), 2000, 80)}>
                    {getCharCount(formData.requirements)} / 2000
                  </span>
                </span>
                {validationErrors.requirements && touched.requirements && (
                  <span className="field-error post-job-field-error">{validationErrors.requirements}</span>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="post-job-field post-job-field--full post-job-actions">
              <button 
                type="button" 
                className="post-job-cancel"
                onClick={() => navigate("/employer")}
                disabled={loading}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="post-job-submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <FaSpinner className="spinner" />
                    Posting...
                  </>
                ) : (
                  <>
                    <FaSave /> Post Job
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}