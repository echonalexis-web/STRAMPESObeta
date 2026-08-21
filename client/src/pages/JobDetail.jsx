import { useContext, useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { adminAPI, jobAPI } from "../services/api";
import "../styles/report.css";
import AppModal from "../components/AppModal";
import QualificationsDisplay from "../components/QualificationsDisplay";
import "../styles/qualifications-editor.css";

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [coverLetterFile, setCoverLetterFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const resumeInputRef = useRef(null);
  const coverLetterInputRef = useRef(null);
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const isAdminUser = user?.role === "admin";

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

  const validateFile = (file, label) => {
    if (file.size > MAX_FILE_SIZE) {
      return `${label} file size exceeds 5MB limit. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.`;
    }

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (!allowedTypes.includes(file.type)) {
      return `Invalid ${label.toLowerCase()} file type. Please upload PDF, DOC, or DOCX files.`;
    }

    return null;
  };

  const handleResumeChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileError = validateFile(file, "Resume");
    if (fileError) {
      setError(fileError);
      e.target.value = '';
      setResumeFile(null);
      return;
    }

    setResumeFile(file);
    setError("");
  };

  const handleCoverLetterFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) {
      setCoverLetterFile(null);
      return;
    }

    const fileError = validateFile(file, "Cover letter");
    if (fileError) {
      setError(fileError);
      e.target.value = '';
      setCoverLetterFile(null);
      return;
    }

    setCoverLetterFile(file);
    setError("");
  };

  const handleApplyClick = async (e) => {
    e.preventDefault();

    if (isSubmitting || submitting) return;

    if (!user) {
      setShowAuthPrompt(true);
      return;
    }

    setIsSubmitting(true);
    setSubmitting(true);
    setError("");
    setSuccessMessage("");

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
      if (coverLetterFile) {
        formData.append("coverLetterFile", coverLetterFile);
      }

      await jobAPI.applyToJob(id, formData);
      setSuccessMessage("Application submitted successfully!");
      setResumeFile(null);
      setCoverLetterFile(null);
      if (resumeInputRef.current) {
        resumeInputRef.current.value = '';
      }
      if (coverLetterInputRef.current) {
        coverLetterInputRef.current.value = '';
      }

      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit application");
      setIsSubmitting(false);
      setSubmitting(false);
    } finally {
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

  const handleAdminDeleteJob = async () => {
    if (!window.confirm("Delete this job posting? This action cannot be undone.")) return;

    try {
      await adminAPI.deleteJob(id);
      navigate("/admin");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete job");
    }
  };

  const handleAdminToggleJobStatus = async () => {
    const nextStatus = job?.status === "closed" ? "active" : "closed";

    try {
      await adminAPI.updateJobStatus(id, nextStatus);
      const { data } = await jobAPI.getJobById(id);
      setJob(data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update job status");
    }
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
            <QualificationsDisplay qualifications={job.qualifications || []} />
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
            <p>
              <strong>Company:</strong>{" "}
              {isAdminUser && job.employer?._id ? (
                <button
                  type="button"
                  className="job-link-button"
                  onClick={() => navigate(`/admin/users/${job.employer._id}`)}
                >
                  {employerName}
                </button>
              ) : (
                employerName
              )}
            </p>
            <p>
              <strong>Employer Name:</strong>{" "}
              {isAdminUser && job.employer?._id ? (
                <button
                  type="button"
                  className="job-link-button"
                  onClick={() => navigate(`/admin/users/${job.employer._id}`)}
                >
                  {job.employer?.name || "Not provided"}
                </button>
              ) : (
                job.employer?.name || "Not provided"
              )}
            </p>
            <p><strong>Description:</strong> {employerDescription}</p>
            <p><strong>Verification:</strong> {job.employer?.verificationStatus || "Not provided"}</p>
          </section>
        </main>

        <aside className="job-apply-column">
          {isAdminUser ? (
            <div className="apply-card admin-actions-card">
              <h3>Admin Actions</h3>
              <p className="apply-card-note">Admin accounts can review and manage this job posting but cannot apply.</p>
              <div className="admin-job-actions">
                <button type="button" className="btn-admin-action" onClick={handleAdminToggleJobStatus}>
                  {job?.status === "closed" ? "Reopen Job" : "Close Job"}
                </button>
                <button type="button" className="btn-admin-action danger" onClick={handleAdminDeleteJob}>
                  Delete Job
                </button>
              </div>
            </div>
          ) : (
            <div className="apply-card">
              <h3>Apply for this Position</h3>
              {!user ? <p className="apply-card-note">Please log in or register to apply for this job.</p> : null}

              <form onSubmit={handleApplyClick} className="apply-form">
                {user ? (
                  <>
                    <div className="form-group">
                      <label htmlFor="coverLetterFile">Upload Cover Letter <span className="optional-label">(Optional)</span></label>
                      <input
                        id="coverLetterFile"
                        ref={coverLetterInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx"
                        onChange={handleCoverLetterFileChange}
                        className="file-input"
                      />
                      <label htmlFor="coverLetterFile" className="file-input-label">Choose Cover Letter</label>
                      <p className="file-name">{coverLetterFile ? coverLetterFile.name : "No file selected"}</p>
                      {coverLetterFile && (
                        <p className="file-size">
                          Size: {(coverLetterFile.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      )}
                    </div>

                    <div className="form-group">
                      <label htmlFor="resume">Upload Resume (PDF, DOC, DOCX - Max 5MB)</label>
                      <input
                        id="resume"
                        ref={resumeInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx"
                        onChange={handleResumeChange}
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
          )}
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