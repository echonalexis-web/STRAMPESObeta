import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { jobAPI } from "../services/api";
import Modal from "../components/Modal";
import AppModal from "../components/AppModal";
import EmployerModal from "../components/EmployerModal";
import "../styles/dashboard.css";
import "../styles/EmployerModal.css";
import { FaBriefcase, FaFileAlt, FaUserCircle, FaBuilding, FaMapMarkerAlt, FaCalendarAlt, FaSearch, FaArrowRight, FaExclamationTriangle, FaSpinner } from "react-icons/fa";

// Use environment variable for API URL
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function Dashboard() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
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
  const [editCoverLetter, setEditCoverLetter] = useState("");
  const [editResumeFile, setEditResumeFile] = useState(null);
  const [isUpdatingApplication, setIsUpdatingApplication] = useState(false);
  const [isDeletingApplication, setIsDeletingApplication] = useState(false);

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
      console.log('📡 Fetching dashboard data...');
      console.log('👤 User:', user?.email || 'Not logged in');
      
      if (!user) {
        setError('Please login to view your dashboard');
        setLoading(false);
        return;
      }
      
      const [jobRes, applicationRes] = await Promise.all([
        jobAPI.getJobs(),
        jobAPI.getMyApplications(),
      ]);
      
      console.log('✅ Jobs response:', jobRes);
      console.log('✅ Applications response:', applicationRes);
      
      setJobs(Array.isArray(jobRes.data) ? jobRes.data : []);
      setApplications(Array.isArray(applicationRes.data) ? applicationRes.data : []);
      
    } catch (err) {
      console.error('❌ Dashboard fetch error:', err);
      console.error('❌ Error response:', err.response);
      console.error('❌ Error message:', err.message);
      
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

  const getStatusClassName = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "open" || normalized === "active") return "status-open";
    if (normalized === "rejected") return "status-rejected";
    if (normalized === "accepted" || normalized === "hired") return "status-accepted";
    if (normalized === "applied" || normalized === "pending" || normalized === "reviewed") return "status-applied";
    return "status-open";
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

  const getEmployerDisplay = (employer) => {
    if (!employer || typeof employer !== "object") {
      return {
        accountName: "Unknown",
        companyName: "No company name",
      };
    }
    return {
      accountName: employer.name || "Unknown",
      companyName: employer.companyName || "No company name",
    };
  };

  const handleOpenEditModal = (application) => {
    setEditingApplication(application);
    setEditCoverLetter(application.coverLetter || "");
    setEditResumeFile(null);
  };

  const handleUpdateApplication = async (event) => {
    event.preventDefault();
    if (!editingApplication) return;

    setIsUpdatingApplication(true);
    try {
      const formData = new FormData();
      formData.append("coverLetter", editCoverLetter || "");
      if (editResumeFile) {
        formData.append("resume", editResumeFile);
      }

      const { data } = await jobAPI.updateApplication(editingApplication._id, formData);
      const updatedApplication = data?.application;

      if (updatedApplication) {
        setApplications((prev) =>
          prev.map((application) =>
            application._id === updatedApplication._id ? updatedApplication : application
          )
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
      setApplications((prev) => prev.filter((application) => application._id !== applicationId));
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
          <button onClick={() => navigate('/login')} className="btn-login-redirect">
            Go to Login
          </button>
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

  return (
    <div className="dashboard-container">
      {/* Hero Banner */}
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

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card stat-card-green">
          <div className="stat-card-icon">
            <FaBriefcase />
          </div>
          <div className="stat-card-content">
            <span className="stat-number">{jobs.length}</span>
            <span className="stat-label">Available Jobs</span>
          </div>
        </div>
        <div className="stat-card stat-card-yellow">
          <div className="stat-card-icon">
            <FaFileAlt />
          </div>
          <div className="stat-card-content">
            <span className="stat-number">{totalApplications}</span>
            <span className="stat-label">Total Applications</span>
          </div>
        </div>
        <div className="stat-card stat-card-blue">
          <div className="stat-card-icon">
            <FaCalendarAlt />
          </div>
          <div className="stat-card-content">
            <span className="stat-number">{pendingApplications}</span>
            <span className="stat-label">Pending Review</span>
          </div>
        </div>
        <div className="stat-card stat-card-purple">
          <div className="stat-card-icon">
            <FaBuilding />
          </div>
          <div className="stat-card-content">
            <span className="stat-number">{acceptedApplications}</span>
            <span className="stat-label">Accepted</span>
          </div>
        </div>
      </div>

      {/* Error Message with Retry */}
      {error && (
        <div className="error-message error-message-with-retry">
          <FaExclamationTriangle className="error-icon" />
          <span>{error}</span>
          <button onClick={handleRetry} className="retry-btn">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-spinner">
          <FaSpinner className="spinner-icon" />
          <p>Loading your dashboard...</p>
        </div>
      ) : (
        <>
          {/* Profile Card */}
          <div className="profile-card">
            <div className="profile-card-left">
              <div className="profile-avatar-large">{initials}</div>
              <div className="profile-details">
                <h2>{user.name}</h2>
                <p className="profile-email">{user.email}</p>
                <span className="profile-role-badge">Job Seeker</span>
              </div>
            </div>
            <div className="profile-card-right">
              <button className="btn-profile-edit" onClick={() => navigate("/profile")}>
                Edit Profile
              </button>
            </div>
          </div>

          {/* Recent Jobs Section */}
          <div className="section-header">
            <h2>Recent Job Openings</h2>
            <button className="section-view-all" onClick={() => navigate("/jobs")}>
              View All <FaArrowRight />
            </button>
          </div>

          {jobs.length === 0 ? (
            <div className="empty-state-card">
              <p>No jobs are available right now.</p>
            </div>
          ) : (
            <div className="jobs-grid">
              {jobs.slice(0, 4).map((job) => (
                <div key={job._id} className="job-card">
                  <div className="job-card-header">
                    <h3>{job.title}</h3>
                    <span className="job-status status-open">Open</span>
                  </div>
                  <div className="job-card-location">
                    <FaMapMarkerAlt /> {job.location}
                  </div>
                  <p className="job-card-description">{job.description?.slice(0, 120) || ''}...</p>
                  <div className="job-card-footer">
                    <div className="job-card-company">
                      <FaBuilding />
                      <span>{job.employer?.companyName || "Employer"}</span>
                    </div>
                    <button className="btn-apply" onClick={() => handleApplyJob(job._id)}>
                      Apply Now
                    </button>
                  </div>
                  <div className="job-card-actions">
                    <button className="btn-view-job" onClick={() => handleViewJob(job)}>
                      View Details
                    </button>
                    <button className="btn-employer" onClick={() => handleViewEmployer(job)}>
                      <FaUserCircle /> Employer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Applications Section */}
          <div className="section-header">
            <h2>Your Applications</h2>
            <span className="application-count">{applications.length} total</span>
          </div>

          {applications.length === 0 ? (
            <div className="empty-state-card">
              <p>You haven't applied to any jobs yet.</p>
              <button className="btn-browse-jobs" onClick={() => navigate("/jobs")}>
                Browse Jobs
              </button>
            </div>
          ) : (
            <div className="applications-grid">
              {applications.map((application) => (
                <div key={application._id} className="application-card">
                  <div className="application-card-header">
                    <h3>{application.vacancy?.title || "Untitled"}</h3>
                    <span className={`application-status ${getStatusClassName(application.status)}`}>
                      {application.status || "Pending"}
                    </span>
                  </div>
                  <div className="application-card-details">
                    <p className="application-company">
                      <FaBuilding /> {getEmployerDisplay(application.vacancy?.employer).companyName}
                    </p>
                    <p className="application-location">
                      <FaMapMarkerAlt /> {application.vacancy?.location || "N/A"}
                    </p>
                    <p className="application-date">
                      <FaCalendarAlt /> Applied on {formatAppliedDate(application.appliedAt)}
                    </p>
                  </div>

                  {confirmDeleteId === application._id ? (
                    <div className="withdraw-confirm">
                      <p>Are you sure you want to withdraw this application?</p>
                      <div className="withdraw-confirm-actions">
                        <button
                          type="button"
                          className="btn-withdraw-confirm"
                          onClick={() => handleDeleteApplication(application._id)}
                          disabled={isDeletingApplication}
                        >
                          Yes, Withdraw
                        </button>
                        <button
                          type="button"
                          className="btn-withdraw-cancel"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={isDeletingApplication}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="application-actions">
                      <button
                        type="button"
                        className="btn-app-view"
                        onClick={() => setViewingApplication(application)}
                      >
                        View Details
                      </button>
                      <button
                        type="button"
                        className="btn-app-edit"
                        onClick={() => handleOpenEditModal(application)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-app-withdraw"
                        onClick={() => setConfirmDeleteId(application._id)}
                      >
                        Withdraw
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        job={selectedJob}
      />

      <EmployerModal
        isOpen={isEmployerModalOpen}
        onClose={() => setIsEmployerModalOpen(false)}
        employer={selectedEmployer}
      />

      <AppModal
        isOpen={Boolean(viewingApplication)}
        onClose={() => setViewingApplication(null)}
        title="Application Details"
      >
        {viewingApplication && (
          <div className="application-modal-content">
            <p><strong>Job Title:</strong> {viewingApplication.vacancy?.title || "N/A"}</p>
            <p><strong>Employer Account:</strong> {getEmployerDisplay(viewingApplication.vacancy?.employer).accountName}</p>
            <p><strong>Company:</strong> {getEmployerDisplay(viewingApplication.vacancy?.employer).companyName}</p>
            <p><strong>Location:</strong> {viewingApplication.vacancy?.location || "N/A"}</p>
            <p>
              <strong>Status:</strong>{" "}
              <span className={`status-badge ${getStatusClassName(viewingApplication.status)}`}>
                {viewingApplication.status || "Pending"}
              </span>
            </p>
            <p><strong>Cover Letter:</strong> {viewingApplication.coverLetter || "No cover letter submitted."}</p>
            <div className="employer-note-box">
              <p>
                <strong>Employer Note:</strong>{" "}
                {viewingApplication.employerNote
                  ? viewingApplication.employerNote
                  : "No note from employer yet."}
              </p>
              {viewingApplication.statusUpdatedAt ? (
                <p className="employer-note-date">
                  Last update: {formatAppliedDate(viewingApplication.statusUpdatedAt)}
                </p>
              ) : null}
            </div>
            <p>
              <strong>Resume:</strong>{" "}
              {viewingApplication.resume ? (
                <a
                  href={getResumeUrl(viewingApplication.resume)}
                  target="_blank"
                  rel="noreferrer"
                  className="resume-link"
                >
                  View Resume
                </a>
              ) : (
                "No resume uploaded."
              )}
            </p>
            <p><strong>Date applied:</strong> {formatAppliedDate(viewingApplication.appliedAt)}</p>
          </div>
        )}
      </AppModal>

      <AppModal
        isOpen={Boolean(editingApplication)}
        onClose={() => setEditingApplication(null)}
        title="Edit Application"
      >
        {editingApplication && (
          <form className="edit-application-form" onSubmit={handleUpdateApplication}>
            <label htmlFor="editCoverLetter">Cover Letter</label>
            <textarea
              id="editCoverLetter"
              value={editCoverLetter}
              onChange={(event) => setEditCoverLetter(event.target.value)}
              rows="6"
            />

            <label htmlFor="editResume">Resume</label>
            <input
              id="editResume"
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(event) => setEditResumeFile(event.target.files?.[0] || null)}
            />
            <p className="current-file-name">
              {editResumeFile
                ? editResumeFile.name
                : editingApplication.resume
                  ? editingApplication.resume.split("/").pop()
                  : "No resume uploaded"}
            </p>

            <div className="edit-application-actions">
              <button type="submit" className="btn-save-changes" disabled={isUpdatingApplication}>
                {isUpdatingApplication ? "Saving..." : "Save Changes"}
              </button>
              <button
                type="button"
                className="btn-cancel-edit"
                onClick={() => setEditingApplication(null)}
                disabled={isUpdatingApplication}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </AppModal>

      {toastMessage && (
        <div className={`app-toast app-toast--${toastMessage.type}`} role="status" aria-live="polite">
          {toastMessage.text}
        </div>
      )}
    </div>
  );
}