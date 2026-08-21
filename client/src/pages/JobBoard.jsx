import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { jobAPI, messageAPI } from "../services/api";
import "../styles/jobboard.css";  
import Modal from "../components/Modal";
import AppModal from "../components/AppModal";
import EmployerModal from "../components/EmployerModal";
import JobFavoriteButton from "../components/JobFavoriteButton";
import QualificationsDisplay from "../components/QualificationsDisplay";
import JobSearchFilters from "../components/JobSearchFilters";
import { AuthContext } from "../context/AuthContext";
import "../styles/qualifications-editor.css";
import phLocationsRaw from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";
import { 
  FaMapMarkerAlt, 
  FaBuilding, 
  FaBriefcase, 
  FaCalendarAlt, 
  FaFileAlt,
  FaUsers,
  FaEnvelope,
  FaStar
} from "react-icons/fa";

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

export default function JobBoard() {
  const navigate = useNavigate();
  const { user, login } = useContext(AuthContext);
  const preferredIndustries = user?.preferredIndustries || [];

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEmployer, setSelectedEmployer] = useState(null);
  const [isEmployerModalOpen, setIsEmployerModalOpen] = useState(false);
  const [applications, setApplications] = useState([]);
  const [viewingApplication, setViewingApplication] = useState(null);
  const [editingApplication, setEditingApplication] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [editResumeFile, setEditResumeFile] = useState(null);
  const [editCoverLetterFile, setEditCoverLetterFile] = useState(null);
  const [isUpdatingApplication, setIsUpdatingApplication] = useState(false);
  const [isDeletingApplication, setIsDeletingApplication] = useState(false);
  const [hasSkills, setHasSkills] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [jobsPerPage] = useState(6);
  const [activeFilters, setActiveFilters] = useState({});

  const fetchJobs = async (filters = activeFilters, page = 1) => {
    setLoading(true);
    setError("");
    try {
      const sanitizedFilters = { ...filters };
      Object.keys(sanitizedFilters).forEach((key) => {
        if (sanitizedFilters[key] === '' || sanitizedFilters[key] === null || sanitizedFilters[key] === undefined) {
          delete sanitizedFilters[key];
        }
      });

      const params = {
        ...sanitizedFilters,
        page,
        limit: jobsPerPage
      };

      setActiveFilters(sanitizedFilters);

      const [jobsResponse, applicationsResponse] = await Promise.all([
        jobAPI.searchJobsWithSemantic(params),
        jobAPI.getMyApplications(),
      ]);

      const responseJobs = Array.isArray(jobsResponse.data.jobs) ? jobsResponse.data.jobs : [];
      const responsePagination = jobsResponse.data.pagination;

      if (responsePagination && typeof responsePagination === "object") {
        const backendTotal = Number(responsePagination.total || responseJobs.length || 0);
        const backendPages = Number(responsePagination.pages || Math.ceil(backendTotal / jobsPerPage) || 1);
        setJobs(responseJobs);
        setTotalJobs(backendTotal);
        setTotalPages(Math.max(1, backendPages));
        setCurrentPage(Number(responsePagination.page || page || 1));
      } else {
        const computedTotal = responseJobs.length;
        const computedPages = Math.max(1, Math.ceil(computedTotal / jobsPerPage));
        const safePage = Math.min(Math.max(page, 1), computedPages);
        const startIndex = (safePage - 1) * jobsPerPage;
        const endIndex = startIndex + jobsPerPage;

        setJobs(responseJobs.slice(startIndex, endIndex));
        setTotalJobs(computedTotal);
        setTotalPages(computedPages);
        setCurrentPage(safePage);
      }

      setHasSkills(jobsResponse.data.hasSkills !== undefined ? jobsResponse.data.hasSkills : true);
      setApplications(applicationsResponse.data || []);

      // Sync preferredIndustries from backend to user context
      if (jobsResponse.data.preferredIndustries && Array.isArray(jobsResponse.data.preferredIndustries)) {
        console.log("📌 Syncing preferredIndustries from API:", jobsResponse.data.preferredIndustries);
        // Update user in context with preferred industries
        const token = localStorage.getItem("token");
        const updatedUser = { ...user, preferredIndustries: jobsResponse.data.preferredIndustries };
        if (token) {
          login(token, updatedUser);
        }
      }
    } catch (err) {
      console.error("❌ Error fetching jobs:", err);
      setError(err.response?.data?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // --- Filter Handlers ---
  const handleFilterChange = (newFilters) => {
    setActiveFilters(newFilters);
  };

  const handleSearch = () => {
    fetchJobs(activeFilters, 1);
  };

  const handleReset = () => {
    setActiveFilters({});
    fetchJobs({}, 1);
  };
  // -----------------------

  const handleViewJob = (job) => {
    setSelectedJob(job);
    setIsModalOpen(true);
  };

  const handleApplyJob = (jobId) => {
    navigate(`/jobs/${jobId}`);
  };

  const handleViewEmployer = (job) => {
    const employer = job?.employer;
    if (!employer) {
      console.warn("No employer data found for this job.");
      return;
    }
    if (typeof employer === "string") {
      setSelectedEmployer({
        _id: employer,
        name: "Employer",
        companyName: "Company details unavailable",
      });
      setIsEmployerModalOpen(true);
      return;
    }
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
    if (normalized === "open") return "status-open";
    if (normalized === "rejected") return "status-rejected";
    if (normalized === "applied" || normalized === "pending" || normalized === "reviewed") return "status-applied";
    if (normalized === "accepted" || normalized === "hired") return "status-accepted";
    return "status-open";
  };

  const isJobAlreadyApplied = (jobId) => {
    return applications.some((app) => String(app.vacancy?._id) === String(jobId));
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

  const getUploadedFileUrl = (filePath) => {
    if (!filePath) return null;
    const sanitized = String(filePath).replace(/\\/g, "/");
    return `http://localhost:3000/${sanitized}`;
  };

  const getEmployerDisplay = (employer) => {
    if (!employer || typeof employer !== "object") {
      return { accountName: "Unknown", companyName: "No company name" };
    }
    return {
      accountName: employer.name || "Unknown",
      companyName: employer.companyName || "No company name",
    };
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
      setToastMessage({ text: "Failed to update. Please try again.", type: "error" });
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
      setToastMessage({ text: "Failed to withdraw. Please try again.", type: "error" });
    } finally {
      setIsDeletingApplication(false);
    }
  };

  return (
    <div className="jobboard-container">
      <section className="jobboard-hero">
        <div className="jobboard-hero-content">
          <h1>Available Jobs in Marinduque</h1>
          <p>Browse open vacancies and apply with your resume.</p>
          <JobSearchFilters 
            filters={activeFilters} 
            onChange={handleFilterChange} 
            onSearch={handleSearch} 
            onReset={handleReset}
            phLocationsData={phLocationsRaw}
            preferredIndustries={preferredIndustries}
          />
        </div>
      </section>

      <div className="jobboard-content">
        <div className="jobboard-count">
          {totalJobs > 0 ? `${totalJobs} jobs available` : "No jobs available"}
          {totalJobs > 0 && ` • Page ${currentPage} of ${totalPages}`}
        </div>

        {user && !hasSkills && totalJobs > 0 && (
          <div className="info-message">
            <p>You haven't added any skills to your profile yet. Add skills to see your match percentage for each job.</p>
            <button className="btn-profile-edit" onClick={() => navigate("/profile")}>Edit Profile</button>
          </div>
        )}

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
            <p>No jobs available.</p>
          </div>
        ) : (
          <div className="jobboard-grid">
            {jobs.map((job) => {
              const isApplied = isJobAlreadyApplied(job._id);
              const isPreferred = preferredIndustries.includes(job.industry);
              return (
                <div key={job._id} className={`job-card ${isPreferred ? 'preferred-card' : ''}`}>
                  <div className="job-card-header">
                    <div className="job-brand-block">
                      <div className="job-brand-logo">{(job.employer?.companyName || "E").charAt(0)}</div>
                      <div className="job-brand-text">
                        <span className="job-company-name">{job.employer?.companyName || "Employer"}</span>
                        <h3 onClick={() => handleViewJob(job)} role="button" tabIndex={0} onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleViewJob(job);
                          }
                        }}>{job.title}</h3>
                      </div>
                    </div>

                    <div className="job-badge-cluster">
                      {isPreferred && (
                        <span className="preferred-industry-badge" title="Matches your preferred industry">
                          <FaStar /> Preferred
                        </span>
                      )}
                      <span className="job-status status-open">Open</span>
                      <div className={`match-badge ${getMatchClass(job.relevanceScore)}`}>
                        {Math.round((job.relevanceScore || 0) * 100)}%
                      </div>
                    </div>
                  </div>

                  <div className="job-card-location">
                    <FaMapMarkerAlt /> {formatAddress(job.location)}
                  </div>

                  <p className="job-card-description">{job.description}</p>
                  <p className="job-card-applicants"><FaUsers /> {Number(job.applicationCount || 0)} jobseekers applied</p>

                  <div className="job-requirements-box">
                    <QualificationsDisplay qualifications={job.qualifications || []} compact maxBadges={3} />
                  </div>

                  <div className="job-card-actions job-card-actions--compact">
                    {isApplied ? (
                      <button className="btn-apply btn-apply-disabled" disabled title="You have already applied to this job">Applied</button>
                    ) : (
                      <button className="btn-apply" onClick={() => handleApplyJob(job._id)}>Apply Now</button>
                    )}
                    <JobFavoriteButton jobId={job._id} hideCount={isApplied} variant="heart" />
                    <button className="btn-employer-icon" onClick={() => handleMessageEmployer(job)} title="Message employer" aria-label="Message employer"><FaEnvelope /></button>
                    <button className="btn-employer-icon" onClick={() => handleViewEmployer(job)} title="Employer info" aria-label="Employer info"><FaBuilding /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {jobs.length > 0 && (
          <div className="pagination-controls">
            <button
              className="pagination-btn"
              onClick={() => fetchJobs(activeFilters, currentPage - 1)}
              disabled={currentPage === 1 || loading}
            >
              ← Previous
            </button>
            <div className="pagination-info">
              Page {currentPage} of {totalPages}
            </div>
            <button
              className="pagination-btn"
              onClick={() => fetchJobs(activeFilters, currentPage + 1)}
              disabled={currentPage === totalPages || loading}
            >
              Next →
            </button>
          </div>
        )}

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
                  <p><FaBuilding /> {getEmployerDisplay(application.vacancy?.employer).companyName}</p>
                  <p><FaMapMarkerAlt /> {formatAddress(application.vacancy?.location || "N/A")}</p>
                  <p><FaCalendarAlt /> Applied on {formatAppliedDate(application.appliedAt)}</p>
                </div>
                {confirmDeleteId === application._id ? (
                  <div className="withdraw-confirm">
                    <p>Are you sure you want to withdraw this application?</p>
                    <div className="withdraw-confirm-actions">
                      <button className="btn-withdraw-confirm" onClick={() => handleDeleteApplication(application._id)} disabled={isDeletingApplication}>Yes, Withdraw</button>
                      <button className="btn-withdraw-cancel" onClick={() => setConfirmDeleteId(null)} disabled={isDeletingApplication}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="application-actions">
                    <button className="btn-app-view" onClick={() => setViewingApplication(application)}>View Details</button>
                    <button className="btn-app-edit" onClick={() => handleOpenEditModal(application)}>Edit</button>
                    <button className="btn-app-withdraw" onClick={() => setConfirmDeleteId(application._id)}>Withdraw</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
            <p><strong>Status:</strong> <span className={`status-badge ${getStatusClassName(viewingApplication.status)}`}>{viewingApplication.status}</span></p>
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
            <div className="employer-note-box">
              <p><strong>Employer Note:</strong> {viewingApplication.employerNote || "No note from employer yet."}</p>
              {viewingApplication.statusUpdatedAt && <p className="employer-note-date">Last update: {formatAppliedDate(viewingApplication.statusUpdatedAt)}</p>}
            </div>
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
              <button type="submit" className="btn-save-changes" disabled={isUpdatingApplication}>{isUpdatingApplication ? "Saving..." : "Save Changes"}</button>
              <button type="button" className="btn-cancel-edit" onClick={() => setEditingApplication(null)} disabled={isUpdatingApplication}>Cancel</button>
            </div>
          </form>
        )}
      </AppModal>

      {toastMessage && <div className={`app-toast app-toast--${toastMessage.type}`} role="status" aria-live="polite">{toastMessage.text}</div>}
    </div>
  );
}