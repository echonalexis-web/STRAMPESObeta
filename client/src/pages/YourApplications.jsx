import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { jobAPI } from "../services/api";
import "../styles/jobboard.css";
import Modal from "../components/Modal";
import AppModal from "../components/AppModal";
import JobFavoriteButton from "../components/JobFavoriteButton";
import QualificationsDisplay from "../components/QualificationsDisplay";
import { AuthContext } from "../context/AuthContext";
import {
  FaMapMarkerAlt,
  FaBriefcase,
  FaCalendarAlt,
  FaTrash,
  FaEdit,
  FaFileAlt,
  FaExclamationTriangle,
} from "react-icons/fa";

const formatDate = (date) => {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getStatusBadgeColor = (status) => {
  const normalizedStatus = String(status || "").toLowerCase();
  if (
    normalizedStatus === "hired" ||
    normalizedStatus === "accepted"
  ) {
    return "hired";
  }
  if (normalizedStatus === "rejected") {
    return "rejected";
  }
  if (normalizedStatus === "shortlisted") {
    return "shortlisted";
  }
  if (normalizedStatus === "reviewed") {
    return "reviewed";
  }
  return "pending";
};

export default function YourApplications() {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [isUpdatingApplication, setIsUpdatingApplication] = useState(false);
  const [isDeletingApplication, setIsDeletingApplication] = useState(false);
  const [editResumeFile, setEditResumeFile] = useState(null);
  const [editCoverLetterFile, setEditCoverLetterFile] = useState(null);

  const fetchApplications = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await jobAPI.getMyApplications();
      setApplications(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load your applications");
      setApplications([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleViewDetails = (application) => {
    if (application.vacancy) {
      setSelectedJob(application.vacancy);
      setIsModalOpen(true);
    }
  };

  const handleEdit = (application) => {
    setEditingApplication(application);
    setEditResumeFile(null);
    setEditCoverLetterFile(null);
  };

  const handleCancelEdit = () => {
    setEditingApplication(null);
    setEditResumeFile(null);
    setEditCoverLetterFile(null);
  };

  const handleUpdateApplication = async () => {
    if (!editingApplication) return;

    setIsUpdatingApplication(true);
    try {
      const formData = new FormData();
      formData.append("coverLetter", editingApplication.coverLetter || "");
      if (editResumeFile) formData.append("resume", editResumeFile);
      if (editCoverLetterFile) formData.append("coverLetterFile", editCoverLetterFile);

      await jobAPI.updateApplication(editingApplication._id, formData);
      setToastMessage("Application updated successfully!");
      setEditingApplication(null);
      await fetchApplications();
    } catch (err) {
      setToastMessage(err.response?.data?.message || "Failed to update application");
    } finally {
      setIsUpdatingApplication(false);
    }
  };

  const handleWithdraw = (applicationId) => {
    setConfirmDeleteId(applicationId);
  };

  const handleConfirmWithdraw = async () => {
    if (!confirmDeleteId) return;

    setIsDeletingApplication(true);
    try {
      await jobAPI.deleteApplication(confirmDeleteId);
      setToastMessage("Application withdrawn successfully!");
      setConfirmDeleteId(null);
      await fetchApplications();
    } catch (err) {
      setToastMessage(err.response?.data?.message || "Failed to withdraw application");
    } finally {
      setIsDeletingApplication(false);
    }
  };

  const handleCancelWithdraw = () => {
    setConfirmDeleteId(null);
  };

  return (
    <div className="jobboard-container">
      <section className="jobboard-hero">
        <div className="jobboard-hero-content">
          <h1 className="jobboard-hero-title">Your Applications</h1>
          <p className="jobboard-hero-subtitle">
            Manage and track all your job applications in one place
          </p>
        </div>
      </section>

      <div className="jobboard-content">
        <div className="jobboard-count">
          <span>
            {loading ? "Loading..." : `${applications.length} Application${applications.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {toastMessage && (
          <div className="toast-notification toast-success">
            {toastMessage}
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "2rem" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="jobboard-grid">
            <p>Loading your applications...</p>
          </div>
        ) : applications.length === 0 ? (
          <div className="jobboard-grid">
            <p>You haven't applied to any jobs yet. Start exploring opportunities!</p>
          </div>
        ) : (
          <div className="jobboard-grid">
            {applications.map((application) => {
              const job = application.vacancy || {};
              const employer = job.employer || {};
              const isEditing = editingApplication?._id === application._id;

              if (isEditing) {
                return (
                  <div key={application._id} className="job-card job-card-editing">
                    <div className="job-card-header">
                      <div className="job-brand-block">
                        <div className="job-brand-logo">
                          {employer.companyName?.charAt(0) || "C"}
                        </div>
                        <div className="job-brand-text">
                          <p className="job-company-name">{employer.companyName || employer.name || "Unknown Employer"}</p>
                          <h3>{job.title || "Untitled Position"}</h3>
                        </div>
                      </div>
                      <span className={`job-status status-${getStatusBadgeColor(application.status)}`}>
                        {application.status || "Pending"}
                      </span>
                    </div>

                    <div className="application-edit-form">
                      <div className="form-group">
                        <label htmlFor={`cover-letter-${application._id}`}>Cover Letter</label>
                        <textarea
                          id={`cover-letter-${application._id}`}
                          value={editingApplication.coverLetter || ""}
                          onChange={(e) =>
                            setEditingApplication({
                              ...editingApplication,
                              coverLetter: e.target.value,
                            })
                          }
                          rows="5"
                          placeholder="Write or edit your cover letter..."
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor={`resume-${application._id}`}>Resume (optional)</label>
                        <input
                          id={`resume-${application._id}`}
                          type="file"
                          accept=".pdf,.doc,.docx"
                          onChange={(e) => setEditResumeFile(e.target.files[0])}
                        />
                        {editResumeFile && <p className="file-name">New file: {editResumeFile.name}</p>}
                        {application.resume && !editResumeFile && (
                          <p className="file-name">Current: {application.resume}</p>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor={`cover-letter-file-${application._id}`}>Cover Letter File (optional)</label>
                        <input
                          id={`cover-letter-file-${application._id}`}
                          type="file"
                          accept=".pdf,.doc,.docx"
                          onChange={(e) => setEditCoverLetterFile(e.target.files[0])}
                        />
                        {editCoverLetterFile && <p className="file-name">New file: {editCoverLetterFile.name}</p>}
                        {application.coverLetterFile && !editCoverLetterFile && (
                          <p className="file-name">Current: {application.coverLetterFile}</p>
                        )}
                      </div>

                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn btn-success btn-form-save"
                          onClick={handleUpdateApplication}
                          disabled={isUpdatingApplication}
                        >
                          {isUpdatingApplication ? "Saving..." : "Save Changes"}
                        </button>
                        <button 
                          type="button"
                          className="btn btn-secondary btn-form-cancel" 
                          onClick={handleCancelEdit} 
                          disabled={isUpdatingApplication}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={application._id} className="job-card">
                  <div className="job-card-header">
                    <div className="job-brand-block">
                      <div className="job-brand-logo">
                        {employer.companyName?.charAt(0) || "C"}
                      </div>
                      <div className="job-brand-text">
                        <p className="job-company-name">{employer.companyName || employer.name || "Unknown Employer"}</p>
                        <h3>{job.title || "Untitled Position"}</h3>
                      </div>
                    </div>
                    <span className={`job-status status-${getStatusBadgeColor(application.status)}`}>
                      {application.status || "Pending"}
                    </span>
                  </div>

                  <div className="job-card-location">
                    <FaMapMarkerAlt />
                    <span>{job.location || "Not specified"}</span>
                  </div>

                  {job.qualifications && job.qualifications.length > 0 && (
                    <div className="job-requirements-box">
                      <QualificationsDisplay qualifications={job.qualifications} compact />
                    </div>
                  )}

                  <div className="job-card-details" style={{ marginTop: "auto", paddingTop: "8px", fontSize: "13px", color: "#6b7280" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                      <FaBriefcase style={{ fontSize: "12px" }} />
                      <span>{job.jobType || "Not specified"}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <FaCalendarAlt style={{ fontSize: "12px" }} />
                      <span>Applied: {formatDate(application.appliedAt)}</span>
                    </div>
                  </div>

                  <div className="job-card-actions">
                    <button
                      type="button"
                      className="btn btn-info btn-app-view"
                      onClick={() => handleViewDetails(application)}
                    >
                      View Details
                    </button>
                    <button
                      type="button"
                      className="btn btn-warning btn-app-edit"
                      onClick={() => handleEdit(application)}
                    >
                      <FaEdit /> Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-app-withdraw"
                      onClick={() => handleWithdraw(application._id)}
                    >
                      <FaTrash /> Withdraw
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && selectedJob && (
        <Modal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)}
          job={selectedJob}
          onMessageEmployer={() => {}}
          applications={applications}
          onViewApplication={() => setIsModalOpen(false)}
        />
      )}

      {confirmDeleteId && (
        <div className="modal-overlay" onClick={handleCancelWithdraw}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon modal-icon-warning">
              <FaExclamationTriangle />
            </div>
            <h2>Withdraw Application?</h2>
            <p>Are you sure you want to withdraw this application? This action cannot be undone.</p>
            <div className="modal-actions">
              <button 
                type="button"
                className="btn btn-secondary" 
                onClick={handleCancelWithdraw} 
                disabled={isDeletingApplication}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmWithdraw}
                disabled={isDeletingApplication}
              >
                {isDeletingApplication ? "Withdrawing..." : "Withdraw"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
