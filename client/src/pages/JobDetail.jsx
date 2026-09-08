import { useContext, useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { adminAPI, jobAPI } from "../services/api";
import { useToast, useConfirm } from "../components/feedback/context";
import "../styles/report.css";
import AppModal from "../components/AppModal";
import EmployerAvatar from "../components/EmployerAvatar";
import EmployerModal from "../components/EmployerModal";
import ReportButton from "../components/ReportButton";
import QualificationsDisplay from "../components/QualificationsDisplay";
import SecureFileLink from "../components/SecureFileLink";
import { useFollow } from "../hooks/useFollow";
import { FaPlus, FaCheck } from "react-icons/fa";
import "../styles/qualifications-editor.css";

const STATUS_META = {
  pending:     { label: "Pending review", tone: "pending" },
  applied:     { label: "Pending review", tone: "pending" },
  reviewed:    { label: "Reviewed",       tone: "pending" },
  shortlisted: { label: "Shortlisted",    tone: "shortlisted" },
  accepted:    { label: "Accepted",       tone: "accepted" },
  hired:       { label: "Hired",          tone: "accepted" },
  rejected:    { label: "Not selected",   tone: "rejected" },
};

const statusMeta = (status) =>
  STATUS_META[String(status || "").toLowerCase()] || { label: status || "Pending review", tone: "pending" };

const baseName = (path) => (path ? String(path).replace(/\\/g, "/").split("/").pop() : "");

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useContext(AuthContext);

  const [job, setJob] = useState(null);
  const [myApplication, setMyApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [coverLetterFile, setCoverLetterFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [employerModalOpen, setEmployerModalOpen] = useState(false);
  const resumeInputRef = useRef(null);
  const coverLetterInputRef = useRef(null);
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  const isAdminUser = user?.role === "admin";
  const isResident = user?.role === "resident";
  const editMode = searchParams.get("mode") === "edit";
  const userId = user?._id || user?.id;

  const employerId = job?.employer?._id || job?.employer?.id || null;
  const { isFollowing, loading: followLoading, toggleFollow } = useFollow(employerId);
  const canFollowEmployer =
    Boolean(user && employerId) && String(employerId) !== String(userId) && !isAdminUser;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const jobReq = jobAPI.getJobById(id);
        const appsReq = isResident ? jobAPI.getMyApplications() : Promise.resolve(null);
        const [jobRes, appsRes] = await Promise.all([jobReq, appsReq]);
        if (cancelled) return;
        setJob(jobRes.data);
        if (appsRes && Array.isArray(appsRes.data)) {
          setMyApplication(
            appsRes.data.find((a) => String(a.vacancy?._id) === String(id)) || null
          );
        } else {
          setMyApplication(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || "Failed to load job details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, isResident, userId]);

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
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
      e.target.value = "";
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
      e.target.value = "";
      setCoverLetterFile(null);
      return;
    }
    setCoverLetterFile(file);
    setError("");
  };

  const resetFileInputs = () => {
    setResumeFile(null);
    setCoverLetterFile(null);
    if (resumeInputRef.current) resumeInputRef.current.value = "";
    if (coverLetterInputRef.current) coverLetterInputRef.current.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    if (!user) {
      setShowAuthPrompt(true);
      return;
    }

    setError("");
    setSuccessMessage("");

    const formData = new FormData();

    if (editMode && myApplication) {
      // Editing an existing application — files are optional; anything left
      // blank keeps what was submitted before.
      if (resumeFile) formData.append("resume", resumeFile);
      if (coverLetterFile) formData.append("coverLetterFile", coverLetterFile);
      setSubmitting(true);
      try {
        await jobAPI.updateApplication(myApplication._id, formData);
        toast.success("Application updated.");
        resetFileInputs();
        navigate(`/jobs/${id}`, { replace: true });
      } catch (err) {
        setError(err.response?.data?.message || "Failed to update application.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // New application — résumé is required.
    if (!resumeFile) {
      setError("Please upload your resume before applying.");
      return;
    }
    formData.append("resume", resumeFile);
    if (coverLetterFile) formData.append("coverLetterFile", coverLetterFile);

    setSubmitting(true);
    try {
      await jobAPI.applyToJob(id, formData);
      setSuccessMessage("Application submitted.");
      resetFileInputs();
      setTimeout(() => navigate(`/jobs/${id}`, { replace: true }), 1200);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit application");
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!myApplication) return;
    const ok = await confirm({
      title: "Withdraw this application?",
      message: "Your application for this job will be removed. You can apply again while the vacancy is open.",
      confirmLabel: "Withdraw",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await jobAPI.deleteApplication(myApplication._id);
      toast.success("Application withdrawn.");
      navigate("/applications");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to withdraw application.");
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
    const ok = await confirm({
      title: "Delete this job posting?",
      message: "This removes the vacancy and all of its applications. This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await adminAPI.deleteJob(id);
      toast.success("Job posting deleted.");
      navigate("/admin");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete job.");
    }
  };

  const handleAdminToggleJobStatus = async () => {
    const nextStatus = job?.status === "closed" ? "active" : "closed";
    try {
      await adminAPI.updateJobStatus(id, nextStatus);
      const { data } = await jobAPI.getJobById(id);
      setJob(data);
      toast.success(nextStatus === "closed" ? "Job posting closed." : "Job posting reopened.");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update job status.");
    }
  };

  const employerName = job?.employer?.companyName || job?.employer?.name || "Employer";
  const employerDescription = job?.employer?.companyDescription || "No employer description provided.";

  if (loading) return <div className="report-container"><p>Loading job details...</p></div>;
  if (error && !job) return <div className="report-container"><div className="error-message">{error}</div></div>;
  if (!job) return <div className="report-container"><p>Job not found.</p></div>;

  const openings = Number(job.slots || 1);
  const hasApplied = Boolean(myApplication);
  const showEditForm = isResident && editMode && hasApplied;
  const showApplyForm = isResident && !hasApplied && !editMode;
  const showStatusCard = isResident && hasApplied && !editMode;
  const status = hasApplied ? statusMeta(myApplication.status) : null;

  return (
    <div className="job-detail-page">
      <section className="job-hero">
        <div className="job-hero-inner">
          <button type="button" className="job-hero-back" onClick={() => navigate("/jobs")}>
            ← Browse jobs
          </button>
          <h1>{job.title}</h1>
          <div className="job-hero-employer">
            <button
              type="button"
              className="job-hero-company"
              onClick={() => setEmployerModalOpen(true)}
              title={`View ${employerName}'s profile`}
            >
              <EmployerAvatar employer={job.employer} name={employerName} className="job-hero-logo" />
              <span className="job-hero-company-name">{employerName}</span>
            </button>
            {canFollowEmployer && (
              <button
                type="button"
                className={`job-hero-follow ${isFollowing ? "is-following" : ""}`}
                onClick={toggleFollow}
                disabled={followLoading}
                aria-pressed={isFollowing}
              >
                {isFollowing ? <><FaCheck /> Following</> : <><FaPlus /> Follow</>}
              </button>
            )}
          </div>
          <div className="job-hero-meta">
            <span className="job-chip">{job.location}</span>
            <span className="job-chip">{job.jobType || "Full-time"}</span>
            <span className="job-chip">{job.salary ? `₱${job.salary}` : "Salary negotiable"}</span>
            <span className="job-chip">{openings} opening{openings === 1 ? "" : "s"}</span>
          </div>
        </div>
      </section>

      <div className="job-detail-layout">
        <main className="job-main-column">
          {showStatusCard && (
            <div className={`job-applied-ribbon tone-${status.tone}`}>
              <span className="dot" aria-hidden="true"></span>
              You applied on {formatDate(myApplication.appliedAt)} · {status.label}
            </div>
          )}

          <section className="job-section">
            <h3>About the Job</h3>
            <p className="job-description-text">{job.description || "No description provided."}</p>
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
                <strong>{openings}</strong>
              </div>
              <div className="job-detail-item">
                <span className="job-detail-label">Applications</span>
                <strong>{Number(job.applicationCount || 0)}</strong>
              </div>
            </div>
          </section>

          <section className="employer-card">
            <h3>Employer Info</h3>
            <dl className="employer-dl">
              <dt>Company</dt>
              <dd>
                {isAdminUser && job.employer?._id ? (
                  <button type="button" className="job-link-button" onClick={() => navigate(`/admin/users/${job.employer._id}`)}>
                    {employerName}
                  </button>
                ) : employerName}
              </dd>
              <dt>Employer name</dt>
              <dd>
                {isAdminUser && job.employer?._id ? (
                  <button type="button" className="job-link-button" onClick={() => navigate(`/admin/users/${job.employer._id}`)}>
                    {job.employer?.name || "Not provided"}
                  </button>
                ) : (job.employer?.name || "Not provided")}
              </dd>
              <dt>Verification</dt>
              <dd>{job.employer?.verificationStatus || "Not provided"}</dd>
              <dt>Description</dt>
              <dd>{employerDescription}</dd>
            </dl>
            {user && !isAdminUser && job._id ? (
              <div className="employer-card-report">
                <ReportButton
                  targetType="job"
                  targetId={job._id}
                  targetOwnerId={job.employer?._id}
                  label="Report this job"
                  variant="link"
                />
              </div>
            ) : null}
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
          ) : !user ? (
            <div className="apply-card">
              <h3>Apply for this position</h3>
              <p className="apply-card-note">Log in or create an account to apply for this job.</p>
              <div className="admin-job-actions">
                <button type="button" className="btn-admin-action" onClick={() => navigate("/login")}>Log in</button>
                <button type="button" className="btn-admin-action" style={{ background: "#fff", color: "#1a5c2a" }} onClick={() => navigate("/register")}>Register</button>
              </div>
            </div>
          ) : showStatusCard ? (
            <div className="apply-card">
              <h3>Your application</h3>
              <span className={`status-pill tone-${status.tone}`}>{status.label}</span>
              <dl className="app-rail-dl">
                <dt>Applied</dt>
                <dd>{formatDate(myApplication.appliedAt)}</dd>
                {myApplication.statusUpdatedAt && (
                  <>
                    <dt>Last update</dt>
                    <dd>{formatDate(myApplication.statusUpdatedAt)}</dd>
                  </>
                )}
                <dt>Résumé</dt>
                <dd>
                  {myApplication.resume ? (
                    <SecureFileLink value={myApplication.resume} className="resume-link">
                      {baseName(myApplication.resume) || "View résumé"}
                    </SecureFileLink>
                  ) : "Not provided"}
                </dd>
                <dt>Cover letter</dt>
                <dd>
                  {myApplication.coverLetterFile ? (
                    <SecureFileLink value={myApplication.coverLetterFile} className="resume-link">
                      {baseName(myApplication.coverLetterFile) || "View cover letter"}
                    </SecureFileLink>
                  ) : "None"}
                </dd>
              </dl>
              {myApplication.employerNote && (
                <p className="app-employer-note"><strong>Note from employer:</strong> {myApplication.employerNote}</p>
              )}
              <div className="app-rail-actions">
                <button type="button" className="btn-rail" onClick={() => navigate(`/jobs/${id}/apply?mode=edit`)}>
                  Edit application
                </button>
                <button type="button" className="btn-rail btn-rail-danger" onClick={handleWithdraw}>
                  Withdraw
                </button>
              </div>
            </div>
          ) : (showApplyForm || showEditForm) ? (
            <div className="apply-card">
              <h3>{showEditForm ? "Update your application" : "Apply for this position"}</h3>
              {showEditForm && (
                <p className="apply-card-note">Leave a field blank to keep what you submitted before.</p>
              )}

              <form onSubmit={handleSubmit} className="apply-form">
                <div className="form-group">
                  <label htmlFor="coverLetterFile">Cover letter <span className="optional-label">(optional)</span></label>
                  <input
                    id="coverLetterFile"
                    ref={coverLetterInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleCoverLetterFileChange}
                    className="file-input"
                  />
                  <label htmlFor="coverLetterFile" className="file-input-label">Choose cover letter</label>
                  <p className="file-name">
                    {coverLetterFile
                      ? coverLetterFile.name
                      : showEditForm && myApplication.coverLetterFile
                        ? `Current: ${baseName(myApplication.coverLetterFile)}`
                        : "No file selected"}
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="resume">
                    Résumé (PDF, DOC, DOCX — max 5MB){showEditForm ? " " : ""}
                    {showEditForm && <span className="optional-label">(optional)</span>}
                  </label>
                  <input
                    id="resume"
                    ref={resumeInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleResumeChange}
                    className="file-input"
                  />
                  <label htmlFor="resume" className="file-input-label">Choose file</label>
                  <p className="file-name">
                    {resumeFile
                      ? resumeFile.name
                      : showEditForm && myApplication.resume
                        ? `Current: ${baseName(myApplication.resume)}`
                        : "No file selected"}
                  </p>
                </div>

                <div className="form-group">
                  <button type="submit" disabled={submitting} className="btn-apply">
                    {submitting
                      ? (showEditForm ? "Saving…" : "Applying…")
                      : (showEditForm ? "Save changes" : "Apply now")}
                  </button>
                  {showEditForm && (
                    <button
                      type="button"
                      className="btn-rail"
                      style={{ marginTop: "0.6rem" }}
                      onClick={() => navigate(`/jobs/${id}`)}
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {successMessage && <p className="feedback-success">{successMessage}</p>}
                {error && <p className="feedback-error">{error}</p>}
              </form>
            </div>
          ) : null}
        </aside>
      </div>

      <EmployerModal
        isOpen={employerModalOpen}
        onClose={() => setEmployerModalOpen(false)}
        employer={job.employer}
      />

      <AppModal
        isOpen={showAuthPrompt}
        onClose={() => setShowAuthPrompt(false)}
        title="Login required"
      >
        <p className="job-auth-modal-copy">Please log in or register to apply for this job.</p>
        <div className="job-auth-modal-actions">
          <button type="button" className="green-btn" onClick={handleAuthLogin}>Login</button>
          <button type="button" className="outline-btn" onClick={handleAuthRegister}>Register</button>
        </div>
      </AppModal>
    </div>
  );
}
