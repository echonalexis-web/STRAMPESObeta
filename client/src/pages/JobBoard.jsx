import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jobAPI } from "../services/api";
import "../styles/jobboard.css";  
import Modal from "../components/Modal";
import AppModal from "../components/AppModal";
import EmployerModal from "../components/EmployerModal";
import { 
  FaSearch, 
  FaMapMarkerAlt, 
  FaBuilding, 
  FaUserCircle, 
  FaBriefcase, 
  FaCalendarAlt, 
  FaFileAlt 
} from "react-icons/fa";

export default function JobBoard() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEmployer, setSelectedEmployer] = useState(null);
  const [isEmployerModalOpen, setIsEmployerModalOpen] = useState(false);
  const [applications, setApplications] = useState([]);
  const [viewingApplication, setViewingApplication] = useState(null);
  const [editingApplication, setEditingApplication] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [editCoverLetter, setEditCoverLetter] = useState("");
  const [editResumeFile, setEditResumeFile] = useState(null);
  const [isUpdatingApplication, setIsUpdatingApplication] = useState(false);
  const [isDeletingApplication, setIsDeletingApplication] = useState(false);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const [jobsResponse, applicationsResponse] = await Promise.all([
          jobAPI.getJobs(),
          jobAPI.getMyApplications(),
        ]);
        setJobs(jobsResponse.data);
        setApplications(applicationsResponse.data);
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load jobs");
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

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
    if (normalized === "open") return "status-open";
    if (normalized === "rejected") return "status-rejected";
    if (normalized === "applied" || normalized === "pending" || normalized === "reviewed") return "status-applied";
    return "status-open";
  };

  const formatAppliedDate = (appliedAt) => {
    if (!appliedAt) return "N/A";
    return new Date(appliedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getResumeUrl = (resumePath) => {
    if (!resumePath) return null;
    const sanitized = String(resumePath).replace(/\\/g, "/");
    return `http://localhost:3000/${sanitized}`;
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
      setToastMessage({ text: "Failed to update. Please try again.", type: "error" });
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
      setToastMessage({ text: "Failed to withdraw. Please try again.", type: "error" });
    } finally {
      setIsDeletingApplication(false);
    }
  };

  const filteredJobs = jobs.filter((job) =>
    job.title?.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div className="jobboard-container">
      {/* Hero Section */}
      <section className="jobboard-hero">
        <div className="jobboard-hero-content">
          <h1>Available Jobs in Marinduque</h1>
          <p>Browse open vacancies and apply with your resume.</p>

          <form className="jobboard-search" onSubmit={(e) => e.preventDefault()}>
            <div className="jobboard-search-wrapper">
              <FaSearch className="search-icon" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by job title..."
                aria-label="Search jobs by title"
              />
            </div>
            <button type="submit">Search</button>
          </form>
        </div>
      </section>

      <div className="jobboard-content">
        {/* Job Count */}
        <div className="jobboard-count">{filteredJobs.length} jobs available</div>

        {loading ? (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading jobs...</p>
          </div>
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            <FaBriefcase className="empty-icon" />
            <p>No job vacancies are available right now.</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="empty-state">
            <FaSearch className="empty-icon" />
            <p>No jobs match your search.</p>
          </div>
        ) : (
          <div className="jobboard-grid">
            {filteredJobs.map((job) => (
              <div key={job._id} className="job-card">
                <div className="job-card-header">
                  <h3>{job.title}</h3>
                  <span className="job-status status-open">Open</span>
                </div>
                <div className="job-card-location">
                  <FaMapMarkerAlt /> {job.location}
                </div>
                <p className="job-card-description">{job.description}</p>
                <div className="job-card-footer">
                  <div className="job-card-company">
                    <FaBuilding />
                    <span>{job.employer?.companyName || "Employer"}</span>
                  </div>
                </div>
                <div className="job-card-actions">
                  <button className="btn-view" onClick={() => handleViewJob(job)}>
                    View Details
                  </button>
                  <button className="btn-apply" onClick={() => handleApplyJob(job._id)}>
                    Apply Now
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
        <h2 className="section-title">Your Applications</h2>

        {applications.length === 0 ? (
          <div className="empty-state">
            <FaFileAlt className="empty-icon" />
            <p>You have not submitted any applications yet.</p>
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
                  <p>
                    <FaBuilding /> {getEmployerDisplay(application.vacancy?.employer).companyName}
                  </p>
                  <p>
                    <FaMapMarkerAlt /> {application.vacancy?.location || "N/A"}
                  </p>
                  <p>
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
      </div>

      {/* Modals */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        job={selectedJob}
      />

      {/* Employer Profile Modal */}
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
                {viewingApplication.status}
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