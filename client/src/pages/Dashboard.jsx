import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { jobAPI, messageAPI } from "../services/api";
import Modal from "../components/Modal";
import AppModal from "../components/AppModal";
import EmployerModal from "../components/EmployerModal";
import "../styles/dashboard.css";
import "../styles/EmployerModal.css";
import { FaBriefcase, FaFileAlt, FaUserCircle, FaBuilding, FaMapMarkerAlt, FaCalendarAlt, FaSearch, FaArrowRight, FaExclamationTriangle, FaSpinner, FaUsers, FaEnvelope, FaStar } from "react-icons/fa";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const formatAddress = (address) => {
  if (!address) return "Not specified";
  const parts = address.split(", ");
  if (parts.length >= 2) {
    return (
      <>
        <span>{parts[0]}</span>
        <br />
        <span className="text-muted">{parts.slice(1).join(", ")}</span>
      </>
    );
  }
  return address;
};

const getMatchClass = (score) => {
  const percent = Math.round((score || 0) * 100);
  if (percent >= 60) return 'match-high';
  if (percent >= 30) return 'match-medium';
  return 'match-low';
};

export default function Dashboard() {
  const { user, login } = useContext(AuthContext);
  const navigate = useNavigate();
  const preferredIndustries = user?.preferredIndustries || [];

  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEmployer, setSelectedEmployer] = useState(null);
  const [isEmployerModalOpen, setIsEmployerModalOpen] = useState(false);
  const [viewingApplication, setViewingApplication] = useState(null);
  const [editingApplication, setEditingApplication] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [editResumeFile, setEditResumeFile] = useState(null);
  const [editCoverLetterFile, setEditCoverLetterFile] = useState(null);
  const [isUpdatingApplication, setIsUpdatingApplication] = useState(false);
  const [isDeletingApplication, setIsDeletingApplication] = useState(false);
  const [hasSkills, setHasSkills] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    
    try {
      if (!user) {
        setError('Please login to view your dashboard');
        setLoading(false);
        return;
      }
      
      const [jobRes, applicationRes] = await Promise.all([
        jobAPI.searchJobsWithSemantic({}),
        jobAPI.getMyApplications(),
      ]);
      
      setJobs(Array.isArray(jobRes.data?.jobs) ? jobRes.data.jobs : []);
      setHasSkills(jobRes.data?.hasSkills !== undefined ? jobRes.data.hasSkills : true);
      setApplications(Array.isArray(applicationRes.data) ? applicationRes.data : []);
      
      // Sync preferredIndustries from backend to user context
      if (jobRes.data?.preferredIndustries && Array.isArray(jobRes.data.preferredIndustries)) {
        console.log("📌 [Dashboard] Syncing preferredIndustries from API:", jobRes.data.preferredIndustries);
        const token = localStorage.getItem("token");
        const updatedUser = { ...user, preferredIndustries: jobRes.data.preferredIndustries };
        if (token) {
          login(token, updatedUser);
        }
      }
      
    } catch (err) {
      if (err.response?.status === 401) {
        setError('Your session has expired. Please login again.');
        setTimeout(() => navigate('/login'), 2000);
      } else if (err.response?.status === 403) {
        setError('You do not have permission to view this content.');
      } else if (err.response?.status === 404) {
        setError('API endpoint not found. Please check your server configuration.');
      } else if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
        setError(`Cannot connect to server. Please make sure the server is running. (${API_BASE_URL})`);
      } else {
        setError(err.response?.data?.message || err.message || 'Failed to load dashboard content');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    fetchData();
  };

  const initials = user?.name?.split(" ").map((part) => part[0]).join("").toUpperCase().slice(0, 2) || "U";

  const handleViewJob = (job) => {
    setSelectedJob(job);
    setIsModalOpen(true);
  };

  const handleApplyJob = (jobId) => {
    navigate(`/jobs/${jobId}`);
  };

  const handleViewEmployer = (job) => {
    const employer = job?.employer;
    if (!employer || typeof employer !== "object") return;
    setSelectedEmployer(employer);
    setIsEmployerModalOpen(true);
  };

  const handleMessageEmployer = async (job) => {
    let employerId = null;
    if (job.employer && typeof job.employer === 'object') {
      employerId = job.employer._id || job.employer.id || job.employer.userId;
    } else if (typeof job.employer === 'string') {
      employerId = job.employer;
    }
    if (!employerId && job.employerId) employerId = job.employerId;

    const currentUserId = user?._id || user?.id;

    if (!employerId) {
      setError("Could not find employer for this job.");
      return;
    }

    if (String(employerId) === String(currentUserId)) {
      setError("You cannot message yourself.");
      return;
    }

    try {
      const { data } = await messageAPI.createConversation({ participantId: employerId });
      const conversationId = data?._id;
      if (!conversationId) throw new Error("Conversation was not created");
      setIsModalOpen(false);
      navigate("/messages", { state: { conversationId } });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to start a conversation with the employer");
    }
  };

  const getStatusClassName = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "open" || normalized === "active") return "status-open";
    if (normalized === "rejected") return "status-rejected";
    if (normalized === "accepted" || normalized === "hired") return "status-accepted";
    if (normalized === "applied" || normalized === "pending" || normalized === "reviewed") return "status-applied";
    return "status-open";
  };

  const isJobAlreadyApplied = (jobId) => {
    return applications.some((app) => String(app.vacancy?._id) === String(jobId));
  };

  const formatAppliedDate = (appliedAt) => {
    if (!appliedAt) return "N/A";
    try {
      return new Date(appliedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  const getResumeUrl = (resumePath) => {
    if (!resumePath) return null;
    const sanitized = String(resumePath).replace(/\\/g, "/").replace(/^\/+/, "");
    return `${API_BASE_URL}/${sanitized}`;
  };

  const getUploadedFileUrl = (filePath) => {
    if (!filePath) return null;
    const sanitized = String(filePath).replace(/\\/g, "/").replace(/^\/+/, "");
    return `${API_BASE_URL}/${sanitized}`;
  };

  const getEmployerDisplay = (employer) => {
    if (!employer || typeof employer !== "object") {
      return { accountName: "Unknown", companyName: "No company name" };
    }
    return { accountName: employer.name || "Unknown", companyName: employer.companyName || "No company name" };
  };

  const handleOpenEditModal = (application) => {
    setEditingApplication(application);
    setEditResumeFile(null);
    setEditCoverLetterFile(null);
  };

  const handleUpdateApplication = async (event) => {
    event.preventDefault();
    if (!editingApplication) return;

    setIsUpdatingApplication(true);
    try {
      const formData = new FormData();
      if (editResumeFile) formData.append("resume", editResumeFile);
      if (editCoverLetterFile) formData.append("coverLetterFile", editCoverLetterFile);

      const { data } = await jobAPI.updateApplication(editingApplication._id, formData);
      const updatedApplication = data?.application;
      if (updatedApplication) {
        setApplications((prev) =>
          prev.map((app) => (app._id === updatedApplication._id ? updatedApplication : app))
        );
      }
      setEditingApplication(null);
      setToastMessage({ text: "Application updated successfully!", type: "success" });
    } catch (err) {
      setToastMessage({ text: err.response?.data?.message || "Failed to update. Please try again.", type: "error" });
    } finally {
      setIsUpdatingApplication(false);
    }
  };

  const handleDeleteApplication = async (applicationId) => {
    setIsDeletingApplication(true);
    try {
      await jobAPI.deleteApplication(applicationId);
      setApplications((prev) => prev.filter((app) => app._id !== applicationId));
      setConfirmDeleteId(null);
      setToastMessage({ text: "Application withdrawn successfully!", type: "success" });
    } catch (err) {
      setToastMessage({ text: err.response?.data?.message || "Failed to withdraw. Please try again.", type: "error" });
    } finally {
      setIsDeletingApplication(false);
    }
  };

  if (!user) {
    return (
      <div className="dashboard-container">
        <div className="error-message">
          <FaExclamationTriangle className="error-icon" />
          <span>Please login to view your dashboard.</span>
          <button onClick={() => navigate('/login')} className="btn-login-redirect">Go to Login</button>
        </div>
      </div>
    );
  }

  const totalApplications = applications.length;
  const pendingApplications = applications.filter(a => 
    a.status === 'pending' || a.status === 'applied' || a.status === 'reviewed'
  ).length;
  const acceptedApplications = applications.filter(a => 
    a.status === 'accepted' || a.status === 'hired'
  ).length;

  // Separate recommended jobs from other jobs
  const recommendedJobs = jobs.filter(job => preferredIndustries.includes(job.industry)).slice(0, 4);
  const otherJobs = jobs.filter(job => !preferredIndustries.includes(job.industry)).slice(0, 4 - recommendedJobs.length);
  const dashboardJobs = [...recommendedJobs, ...otherJobs];

  return (
    <div className="dashboard-container">
      <div className="dashboard-hero">
        <div className="dashboard-hero-content">
          <div className="dashboard-hero-text">
            <h1>Welcome back, {user.name?.split(' ')[0] || 'User'}! 👋</h1>
            <p>Find your next opportunity and track your job applications</p>
          </div>
          <button className="hero-browse-btn" onClick={() => navigate("/jobs")}>
            <FaSearch /> Browse Jobs <FaArrowRight className="btn-arrow" />
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-card-green">
          <div className="stat-card-icon"><FaBriefcase /></div>
          <div className="stat-card-content"><span className="stat-number">{jobs.length}</span><span className="stat-label">Available Jobs</span></div>
        </div>
        <div className="stat-card stat-card-yellow">
          <div className="stat-card-icon"><FaFileAlt /></div>
          <div className="stat-card-content"><span className="stat-number">{totalApplications}</span><span className="stat-label">Total Applications</span></div>
        </div>
        <div className="stat-card stat-card-blue">
          <div className="stat-card-icon"><FaCalendarAlt /></div>
          <div className="stat-card-content"><span className="stat-number">{pendingApplications}</span><span className="stat-label">Pending Review</span></div>
        </div>
        <div className="stat-card stat-card-purple">
          <div className="stat-card-icon"><FaBuilding /></div>
          <div className="stat-card-content"><span className="stat-number">{acceptedApplications}</span><span className="stat-label">Accepted</span></div>
        </div>
      </div>

      {error && (
        <div className="error-message error-message-with-retry">
          <FaExclamationTriangle className="error-icon" /><span>{error}</span>
          <button onClick={handleRetry} className="retry-btn">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="loading-spinner"><FaSpinner className="spinner-icon" /><p>Loading your dashboard...</p></div>
      ) : (
        <>
          <div className="profile-card">
            <div className="profile-card-left">
              <div className="profile-avatar-large">{initials}</div>
              <div className="profile-details">
                <h2>{user.name}</h2><p className="profile-email">{user.email}</p><span className="profile-role-badge">Job Seeker</span>
              </div>
            </div>
            <div className="profile-card-right">
              <button className="btn-profile-edit" onClick={() => navigate("/profile")}>Edit Profile</button>
            </div>
          </div>

          {/* Recent Job Openings Section */}
          <div className="section-header">
            <h2>Recent Job Openings</h2>
            <button className="section-view-all" onClick={() => navigate("/jobs")}>View All <FaArrowRight /></button>
          </div>

          {!hasSkills && user && (
            <div className="info-message">
              <p>You haven't added any skills to your profile yet. Add skills to see your match percentage for each job.</p>
              <button className="btn-profile-edit" onClick={() => navigate("/profile")}>Edit Profile</button>
            </div>
          )}

          {dashboardJobs.length === 0 ? (
            <div className="empty-state-card"><p>No jobs are available right now.</p></div>
          ) : (
            <div className="jobs-grid">
              {dashboardJobs.map((job) => {
                const isPreferred = preferredIndustries.includes(job.industry);
                return (
                  <div key={job._id} className={`job-card ${isPreferred ? 'preferred-card' : ''}`}>
                    <div className="job-card-header">
                      <h3>{job.title}</h3>
                      <span className="job-status status-open">Open</span>
                      {isJobAlreadyApplied(job._id) && (
                        <span className="job-applied-badge">Applied</span>
                      )}
                      {isPreferred && (
                        <span className="preferred-industry-badge"><FaStar /> Preferred</span>
                      )}
                      {hasSkills && (
                        <div className={`match-badge ${getMatchClass(job.relevanceScore)}`}>
                          {Math.round((job.relevanceScore || 0) * 100)}%
                        </div>
                      )}
                    </div>
                    <div className="job-card-location"><FaMapMarkerAlt /> {formatAddress(job.location)}</div>
                    <p className="job-card-description">{job.description?.slice(0, 120) || ''}...</p>
                    <p className="job-card-applicants"><FaUsers /> {Number(job.applicationCount || 0)} jobseekers applied</p>
                    <div className="job-card-footer">
                      <div className="job-card-company"><FaBuilding /><span>{job.employer?.companyName || "Employer"}</span></div>
                      {isJobAlreadyApplied(job._id) ? (
                        <button type="button" className="btn btn-primary btn-apply btn-apply-disabled" disabled title="You have already applied to this job">Already Applied</button>
                      ) : (
                        <button type="button" className="btn btn-primary btn-apply" onClick={() => handleApplyJob(job._id)}>Apply Now</button>
                      )}
                    </div>
                    <div className="job-card-actions">
                      <button type="button" className="btn btn-info btn-view-job" onClick={() => handleViewJob(job)}>View Details</button>
                      <button type="button" className="btn-employer-icon" onClick={() => handleMessageEmployer(job)} title="Message employer" aria-label="Message employer"><FaEnvelope /></button>
                      <button type="button" className="btn-employer" onClick={() => handleViewEmployer(job)}><FaUserCircle /> Employer</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recommended for You Section */}
          <div className="section-header">
            <h2><FaStar style={{ color: '#f59e0b', marginRight: '8px' }} /> Recommended for You</h2>
          </div>

          {preferredIndustries.length === 0 ? (
            <div className="setup-industries-prompt">
              <div className="setup-industries-content">
                <FaStar className="setup-industries-icon" />
                <h3>Set Up Your Preferred Industries</h3>
                <p>To get personalized job recommendations, add your preferred industries to your profile. This helps us suggest jobs that match your career interests.</p>
                <button className="btn-setup-industries" onClick={() => navigate("/profile")}>
                  Go to Edit Profile
                </button>
              </div>
            </div>
          ) : recommendedJobs.length > 0 ? (
            <div className="jobs-grid">
              {recommendedJobs.map((job) => (
                <div key={job._id} className="job-card preferred-card">
                  <div className="job-card-header">
                    <h3>{job.title}</h3>
                    <span className="job-status status-open">Open</span>
                    {isJobAlreadyApplied(job._id) && (
                      <span className="job-applied-badge">Applied</span>
                    )}
                    <span className="preferred-industry-badge"><FaStar /> Preferred</span>
                    {hasSkills && (
                      <div className={`match-badge ${getMatchClass(job.relevanceScore)}`}>
                        {Math.round((job.relevanceScore || 0) * 100)}%
                      </div>
                    )}
                  </div>
                  <div className="job-card-location"><FaMapMarkerAlt /> {formatAddress(job.location)}</div>
                  <p className="job-card-description">{job.description?.slice(0, 120) || ''}...</p>
                  <p className="job-card-applicants"><FaUsers /> {Number(job.applicationCount || 0)} jobseekers applied</p>
                  <div className="job-card-footer">
                    <div className="job-card-company"><FaBuilding /><span>{job.employer?.companyName || "Employer"}</span></div>
                    {isJobAlreadyApplied(job._id) ? (
                      <button type="button" className="btn btn-primary btn-apply btn-apply-disabled" disabled title="You have already applied to this job">Already Applied</button>
                    ) : (
                      <button type="button" className="btn btn-primary btn-apply" onClick={() => handleApplyJob(job._id)}>Apply Now</button>
                    )}
                  </div>
                  <div className="job-card-actions">
                    <button type="button" className="btn btn-info btn-view-job" onClick={() => handleViewJob(job)}>View Details</button>
                    <button type="button" className="btn-employer-icon" onClick={() => handleMessageEmployer(job)} title="Message employer" aria-label="Message employer"><FaEnvelope /></button>
                    <button type="button" className="btn-employer" onClick={() => handleViewEmployer(job)}><FaUserCircle /> Employer</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state-card"><p>No recommended jobs available. Check back soon!</p></div>
          )}
        </>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        job={selectedJob}
        onMessageEmployer={handleMessageEmployer}
        applications={applications}
        onViewApplication={setViewingApplication}
      />

      <EmployerModal
        isOpen={isEmployerModalOpen}
        onClose={() => setIsEmployerModalOpen(false)}
        employer={selectedEmployer}
      />

      <AppModal isOpen={Boolean(viewingApplication)} onClose={() => setViewingApplication(null)} title="Application Details">
        {viewingApplication && (
          <div className="application-modal-content">
            <p><strong>Job Title:</strong> {viewingApplication.vacancy?.title || "N/A"}</p>
            <p><strong>Employer Account:</strong> {getEmployerDisplay(viewingApplication.vacancy?.employer).accountName}</p>
            <p><strong>Company:</strong> {getEmployerDisplay(viewingApplication.vacancy?.employer).companyName}</p>
            <p><strong>Location:</strong> {formatAddress(viewingApplication.vacancy?.location || "N/A")}</p>
            <p><strong>Status:</strong> <span className={`status-badge ${getStatusClassName(viewingApplication.status)}`}>{viewingApplication.status || "Pending"}</span></p>
            <p>
              <strong>Cover Letter:</strong>{" "}
              {viewingApplication.coverLetterFile ? (
                <a href={getUploadedFileUrl(viewingApplication.coverLetterFile)} target="_blank" rel="noreferrer" className="resume-link">View Cover Letter</a>
              ) : viewingApplication.coverLetter ? (
                viewingApplication.coverLetter
              ) : (
                "No cover letter uploaded."
              )}
            </p>
            <div className="employer-note-box"><p><strong>Employer Note:</strong> {viewingApplication.employerNote || "No note from employer yet."}</p>{viewingApplication.statusUpdatedAt && <p className="employer-note-date">Last update: {formatAppliedDate(viewingApplication.statusUpdatedAt)}</p>}</div>
            <p><strong>Resume:</strong> {viewingApplication.resume ? <a href={getResumeUrl(viewingApplication.resume)} target="_blank" rel="noreferrer" className="resume-link">View Resume</a> : "No resume uploaded."}</p>
            <p><strong>Date applied:</strong> {formatAppliedDate(viewingApplication.appliedAt)}</p>
          </div>
        )}
      </AppModal>

      <AppModal isOpen={Boolean(editingApplication)} onClose={() => setEditingApplication(null)} title="Edit Application">
        {editingApplication && (
          <form className="edit-application-form" onSubmit={handleUpdateApplication}>
            <label htmlFor="editResume">Resume</label>
            <input id="editResume" type="file" accept=".pdf,.doc,.docx" onChange={(e) => setEditResumeFile(e.target.files?.[0] || null)} />
            <p className="current-file-name">{editResumeFile ? editResumeFile.name : editingApplication.resume ? editingApplication.resume.split("/").pop() : "No resume uploaded"}</p>
            <label htmlFor="editCoverLetterFile">Cover Letter <span className="optional-label">(Optional)</span></label>
            <input id="editCoverLetterFile" type="file" accept=".pdf,.doc,.docx" onChange={(e) => setEditCoverLetterFile(e.target.files?.[0] || null)} />
            <p className="current-file-name">{editCoverLetterFile ? editCoverLetterFile.name : editingApplication.coverLetterFile ? editingApplication.coverLetterFile.split("/").pop() : "No cover letter uploaded"}</p>
            <div className="edit-application-actions">
              <button type="submit" className="btn btn-success btn-save-changes" disabled={isUpdatingApplication}>{isUpdatingApplication ? "Saving..." : "Save Changes"}</button>
              <button type="button" className="btn btn-secondary btn-cancel-edit" onClick={() => setEditingApplication(null)} disabled={isUpdatingApplication}>Cancel</button>
            </div>
          </form>
        )}
      </AppModal>

      {toastMessage && (
        <div className={`app-toast app-toast--${toastMessage.type}`} role="status" aria-live="polite">{toastMessage.text}</div>
      )}
    </div>
  );
}