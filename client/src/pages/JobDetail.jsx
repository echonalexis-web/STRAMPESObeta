import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { adminAPI, jobAPI, displayFileName } from "../services/api";
import { useToast, useConfirm } from "../components/feedback/context";
import "../styles/report.css";
import AppModal from "../components/AppModal";
import EmployerAvatar from "../components/EmployerAvatar";
import EmployerModal from "../components/EmployerModal";
import ReportButton from "../components/ReportButton";
import QualificationsDisplay from "../components/QualificationsDisplay";
import SecureFileLink from "../components/SecureFileLink";
import ApplyModal from "../components/ApplyModal";
import VacancyCard from "../components/VacancyCard";
import { useFollow } from "../hooks/useFollow";
import { FaPlus, FaCheck, FaExclamationTriangle } from "react-icons/fa";
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
  const [unavailableTitle, setUnavailableTitle] = useState("");
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [employerModalOpen, setEmployerModalOpen] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [recommendedJobs, setRecommendedJobs] = useState([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recHasSkills, setRecHasSkills] = useState(true);
  const [recApplications, setRecApplications] = useState([]);
  const [recApplyJobId, setRecApplyJobId] = useState(null);

  const isAdminUser = user?.role === "admin";
  const isJobseeker = user?.role === "jobseeker";
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
      setUnavailableTitle("");
      try {
        const jobReq = jobAPI.getJobById(id);
        const appsReq = isJobseeker ? jobAPI.getMyApplications() : Promise.resolve(null);
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
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load job details");
          setUnavailableTitle(err.response?.data?.title || "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, isJobseeker, userId]);

  // When the job turns out to be unavailable, back the replacement page with
  // a short list of matching openings so the dead end still leads somewhere.
  useEffect(() => {
    if (loading || job || !error) return;
    let cancelled = false;
    const loadRecommendations = async () => {
      setRecLoading(true);
      try {
        const recReq = jobAPI.searchJobsWithSemantic({ limit: 4 });
        const appsReq = isJobseeker ? jobAPI.getMyApplications() : Promise.resolve(null);
        const [recRes, appsRes] = await Promise.all([recReq, appsReq]);
        if (cancelled) return;
        setRecommendedJobs(Array.isArray(recRes.data?.jobs) ? recRes.data.jobs : []);
        setRecHasSkills(recRes.data?.hasSkills !== undefined ? recRes.data.hasSkills : true);
        setRecApplications(appsRes && Array.isArray(appsRes.data) ? appsRes.data : []);
      } catch {
        if (!cancelled) {
          setRecommendedJobs([]);
          setRecApplications([]);
        }
      } finally {
        if (!cancelled) setRecLoading(false);
      }
    };
    loadRecommendations();
    return () => { cancelled = true; };
  }, [loading, error, job, isJobseeker]);

  const formatDate = (value) => {
    if (!value) return "Not specified";
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleApplyClick = () => {
    if (!user) {
      setShowAuthPrompt(true);
      return;
    }
    setApplyModalOpen(true);
  };

  const handleApplySuccess = () => {
    if (editMode && myApplication) {
      toast.success("Application updated.");
      navigate(`/jobs/${id}`, { replace: true });
      return;
    }
    toast.success("Application submitted!");
    navigate("/applications");
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

  if (error && !job) {
    const isRecJobApplied = (jobId) =>
      recApplications.some((app) => String(app.vacancy?._id) === String(jobId));

    return (
      <div className="job-detail-page">
        <div className="job-unavailable-wrap">
          <nav className="job-unavailable-crumbs" aria-label="Breadcrumb">
            <button type="button" className="job-unavailable-crumb-link" onClick={() => navigate("/jobs")}>
              Browse Jobs
            </button>
            {unavailableTitle ? (
              <>
                <span className="job-unavailable-crumb-sep" aria-hidden="true">›</span>
                <span className="job-unavailable-crumb-current">{unavailableTitle}</span>
              </>
            ) : null}
          </nav>

          <div className="job-unavailable-banner">
            <span className="job-unavailable-banner-icon" aria-hidden="true">
              <FaExclamationTriangle />
            </span>
            <div className="job-unavailable-banner-body">
              <div className="job-unavailable-banner-head">
                <h2>This Job Posting is No Longer Available</h2>
                <span className="job-unavailable-badge">Closed</span>
              </div>
              <p>{error}</p>
            </div>
            <button type="button" className="job-unavailable-back-btn" onClick={() => navigate("/jobs")}>
              ← Back to Jobs
            </button>
          </div>

          <section className="job-unavailable-recs">
            <div className="job-unavailable-recs-head">
              <div>
                <h3>Recommended Openings For You</h3>
                <p>Based on your saved profile preferences in STRAM PESO</p>
              </div>
              <button type="button" className="job-unavailable-recs-viewall" onClick={() => navigate("/jobs")}>
                View all matching →
              </button>
            </div>

            {recLoading ? (
              <p className="job-unavailable-recs-status">Loading recommendations…</p>
            ) : recommendedJobs.length === 0 ? (
              <p className="job-unavailable-recs-status">No matching openings right now. Check back soon.</p>
            ) : (
              <div className="job-unavailable-recs-grid">
                {recommendedJobs.map((recJob) => (
                  <VacancyCard
                    key={recJob._id}
                    job={recJob}
                    applied={isRecJobApplied(recJob._id)}
                    followed={Boolean(recJob.isFollowedEmployer)}
                    matchAvailable={recHasSkills}
                    onOpen={() => navigate(`/jobs/${recJob._id}`)}
                    onApply={() => setRecApplyJobId(recJob._id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <ApplyModal
          isOpen={Boolean(recApplyJobId)}
          onClose={() => setRecApplyJobId(null)}
          jobId={recApplyJobId}
          onSuccess={() => {
            toast.success("Application submitted!");
            setRecApplyJobId(null);
            navigate("/applications");
          }}
        />
      </div>
    );
  }

  if (!job) return <div className="report-container"><p>Job not found.</p></div>;

  const openings = Number(job.slots || 1);
  const hasApplied = Boolean(myApplication);
  const showEditForm = isJobseeker && editMode && hasApplied;
  const showApplyForm = isJobseeker && !hasApplied && !editMode;
  const showStatusCard = isJobseeker && hasApplied && !editMode;
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
                      {displayFileName(myApplication.resume) || "View résumé"}
                    </SecureFileLink>
                  ) : "Not provided"}
                </dd>
                <dt>Cover letter</dt>
                <dd>
                  {myApplication.coverLetterFile ? (
                    <SecureFileLink value={myApplication.coverLetterFile} className="resume-link">
                      {displayFileName(myApplication.coverLetterFile) || "View cover letter"}
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
                <p className="apply-card-note">Attach a new file only for what you want to change.</p>
              )}
              <div className="form-group">
                <button type="button" className="btn-apply" onClick={handleApplyClick}>
                  {showEditForm ? "Edit application" : "Apply now"}
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
              {error && <p className="feedback-error">{error}</p>}
            </div>
          ) : null}

          <section className="job-section job-details-section">
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
        </aside>
      </div>

      <EmployerModal
        isOpen={employerModalOpen}
        onClose={() => setEmployerModalOpen(false)}
        employer={job.employer}
      />

      <ApplyModal
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        jobId={id}
        editMode={showEditForm}
        existingApplication={myApplication}
        onSuccess={handleApplySuccess}
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
