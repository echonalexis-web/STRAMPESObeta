import { useContext, useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { jobAPI } from "../services/api";
import "../styles/report.css";
import AppModal from "../components/AppModal";
import CoverLetterBuilder from "../components/CoverLetterBuilder.jsx";
import "../styles/coverLetterBuilder.css";

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [coverLetter, setCoverLetter] = useState("");
  const [coverLetterError, setCoverLetterError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const MAX_COVER_LETTER_LENGTH = 1000;
  const MIN_COVER_LETTER_LENGTH = 10;
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const { data } = await jobAPI.getJobById(id);
        setJob(data);
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load job details");
      } finally {
        setLoading(false);
      }
    };
    fetchJob();
  }, [id]);

  const formatDate = (value) => {
    if (!value) return "Not specified";
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleCoverLetterChange = (text) => {
    setCoverLetter(text);
    if (coverLetterError) setCoverLetterError("");
  };

  const validateCoverLetter = (text) => {
    const trimmed = text.trim();
    const errors = [];

    if (trimmed.length === 0) {
      errors.push("Cover letter is required");
    } else if (trimmed.length < MIN_COVER_LETTER_LENGTH) {
      errors.push(`Cover letter must be at least ${MIN_COVER_LETTER_LENGTH} characters (current: ${trimmed.length})`);
    } else if (trimmed.length > MAX_COVER_LETTER_LENGTH) {
      errors.push(`Cover letter cannot exceed ${MAX_COVER_LETTER_LENGTH} characters (current: ${trimmed.length})`);
    }

    const suspiciousPatterns = [
      /<script/i,
      /javascript:/i,
      /onerror\s*=/i,
      /onload\s*=/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /data:text\/html/i,
      /vbscript:/i,
      /expression\s*\(/i,
      /onclick\s*=/i,
      /onmouseover\s*=/i,
      /alert\s*\(/i,
      /eval\s*\(/i,
      /document\./i,
      /window\./i
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(trimmed)) {
        errors.push("Cover letter contains suspicious or malicious content");
        break;
      }
    }

    return errors;
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setError(`File size exceeds 5MB limit. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB. Please compress your file.`);
      e.target.value = '';
      setResumeFile(null);
      return;
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      setError("Invalid file type. Please upload PDF, DOC, or DOCX files.");
      e.target.value = '';
      setResumeFile(null);
      return;
    }

    setResumeFile(file);
    setError("");
  };

  const handleApplyClick = async (e) => {
    e.preventDefault();

    // Prevent double submission
    if (isSubmitting || submitting) return;

    if (!user) {
      setShowAuthPrompt(true);
      return;
    }

    const coverLetterErrors = validateCoverLetter(coverLetter);
    if (coverLetterErrors.length > 0) {
      const message = `Cover letter issue: ${coverLetterErrors[0]}. Please fix it before submitting.`;
      setCoverLetterError(message);
      setError(message);
      return;
    }

    setIsSubmitting(true);
    setSubmitting(true);
    setError("");
    setSuccessMessage("");
    setCoverLetterError("");

    try {
      const formData = new FormData();
      if (resumeFile) {
        formData.append("resume", resumeFile);
      } else {
        setError("Please upload your resume before applying.");
        setIsSubmitting(false);
        setSubmitting(false);
        return;
      }
      formData.append("coverLetter", coverLetter.trim());
      await jobAPI.applyToJob(id, formData);
      setSuccessMessage("Application submitted successfully!");
      // Reset form
      setResumeFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setCoverLetter("");
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit application");
      setIsSubmitting(false);
      setSubmitting(false);
    } finally {
      // Only reset if not navigating
      if (!successMessage) {
        setIsSubmitting(false);
        setSubmitting(false);
      }
    }
  };

  const handleAuthLogin = () => {
    setShowAuthPrompt(false);
    navigate("/login");
  };

  const handleAuthRegister = () => {
    setShowAuthPrompt(false);
    navigate("/register");
  };

  const employerName = job?.employer?.companyName || job?.employer?.name || "Employer";
  const employerDescription = job?.employer?.companyDescription || "No employer description provided.";

  if (loading) return <div className="report-container"><p>Loading job details...</p></div>;

  if (error) return <div className="report-container"><div className="error-message">{error}</div></div>;

  if (!job) return <div className="report-container"><p>Job not found.</p></div>;

  return (
    <div className="job-detail-page">
      <section className="job-hero">
        <div className="job-hero-inner">
          <h1>{job.title}</h1>
          <div className="job-hero-meta">
            <span className="job-chip">{job.location}</span>
            <span className="job-chip">{job.jobType || "Full-time"}</span>
            <span className="job-chip">{job.salary || "Salary negotiable"}</span>
          </div>
        </div>
      </section>

      <div className="job-detail-layout">
        <main className="job-main-column">
          <section className="job-section">
            <h2>{job.title}</h2>
            <div className="job-info-chips">
              <span className="job-chip job-chip-outline">{job.location}</span>
              <span className="job-chip job-chip-outline">{job.jobType || "Full-time"}</span>
              <span className="job-chip job-chip-outline">{job.salary || "Salary negotiable"}</span>
              <span className="job-chip job-chip-outline">{job.slots || 1} opening{Number(job.slots) === 1 ? "" : "s"}</span>
            </div>
          </section>

          <section className="job-section">
            <h3>About the Job</h3>
            <p className="job-description-text">{job.description}</p>
          </section>

          <section className="job-section">
            <h3>Qualifications / Requirements</h3>
            <p className="job-description-text">{job.requirements || "No requirements provided."}</p>
          </section>

          <section className="job-section">
            <h3>Job Details</h3>
            <div className="job-details-grid">
              <div className="job-detail-item">
                <span className="job-detail-label">Date Posted</span>
                <strong>{formatDate(job.createdAt)}</strong>
              </div>
              <div className="job-detail-item">
                <span className="job-detail-label">Application Deadline</span>
                <strong>{formatDate(job.applicationDeadline)}</strong>
              </div>
              <div className="job-detail-item">
                <span className="job-detail-label">Number of Vacancies</span>
                <strong>{Number(job.slots || 1)}</strong>
              </div>
              <div className="job-detail-item">
                <span className="job-detail-label">Applications</span>
                <strong>{Number(job.applicationCount || 0)}</strong>
              </div>
            </div>
          </section>

          <section className="employer-card">
            <h3>Employer Info</h3>
            <p><strong>Company:</strong> {employerName}</p>
            <p><strong>Employer Name:</strong> {job.employer?.name || "Not provided"}</p>
            <p><strong>Description:</strong> {employerDescription}</p>
            <p><strong>Verification:</strong> {job.employer?.verificationStatus || "Not provided"}</p>
          </section>
        </main>

        <aside className="job-apply-column">
          <div className="apply-card">
            <h3>Apply for this Position</h3>
            {!user ? <p className="apply-card-note">Please log in or register to apply for this job.</p> : null}
            
            <form onSubmit={handleApplyClick} className="apply-form">
              {user ? (
                <>
                  <div className="form-group">
                    <label>Cover Letter</label>
                    <CoverLetterBuilder
                      value={coverLetter}
                      onChange={handleCoverLetterChange}
                      jobTitle={job?.title}
                      companyName={job?.employer?.companyName}
                      maxLength={MAX_COVER_LETTER_LENGTH}
                      minLength={MIN_COVER_LETTER_LENGTH}
                      error={coverLetterError}
                    />
                    {coverLetterError && (
                      <p className="feedback-error cover-letter-feedback" aria-live="polite">
                        {coverLetterError}
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="resume">Upload Resume (PDF, DOC, DOCX - Max 5MB)</label>
                    <input
                      id="resume"
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={handleFileChange}
                      className="file-input"
                    />
                    <label htmlFor="resume" className="file-input-label">Choose File</label>
                    <p className="file-name">{resumeFile ? resumeFile.name : "No file selected"}</p>
                    {resumeFile && (
                      <p className="file-size">
                        Size: {(resumeFile.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    )}
                  </div>
                </>
              ) : null}

              <div className="form-group">
                <button 
                  type="submit" 
                  disabled={isSubmitting || submitting} 
                  className="btn-apply"
                >
                  {isSubmitting ? (
                    <>
                      <span className="spinner"></span> Applying...
                    </>
                  ) : (
                    "Apply Now"
                  )}
                </button>
              </div>

              {successMessage && <p className="feedback-success">{successMessage}</p>}
              {error && <p className="feedback-error">{error}</p>}
            </form>
          </div>
        </aside>
      </div>

      <AppModal
        isOpen={showAuthPrompt}
        onClose={() => setShowAuthPrompt(false)}
        title="Login required"
      >
        <p className="job-auth-modal-copy">Please log in or register to apply for this job.</p>
        <div className="job-auth-modal-actions">
          <button type="button" className="green-btn" onClick={handleAuthLogin}>
            Login
          </button>
          <button type="button" className="outline-btn" onClick={handleAuthRegister}>
            Register
          </button>
        </div>
      </AppModal>
    </div>
  );
}