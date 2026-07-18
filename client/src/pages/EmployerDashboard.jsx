import { useEffect, useMemo, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { employerAPI, messageAPI } from "../services/api";
import "../styles/employer-dashboard.css";
import { API_URL } from "../services/api";
import { AuthContext } from "../context/AuthContext";
import LocationSelect from "../components/LocationSelect";
import QualificationsEditor from "../components/QualificationsEditor";
import "../styles/qualifications-editor.css";
// Import modular components
import RankedApplicantsTable from "../components/RankedApplicantsTable";
import { useRankedApplicants } from "../hooks/useRankedApplicants";

// ---------------------------------------------
// Philippine Salary Grades (SG 1-33, 2023 rates)
// ---------------------------------------------
const SALARY_GRADES = [
  { grade: 1,  label: "SG 1   – ₱11,068",   value: "SG 1 - ₱11,068" },
  { grade: 2,  label: "SG 2   – ₱11,518",   value: "SG 2 - ₱11,518" },
  { grade: 3,  label: "SG 3   – ₱12,005",   value: "SG 3 - ₱12,005" },
  { grade: 4,  label: "SG 4   – ₱12,531",   value: "SG 4 - ₱12,531" },
  { grade: 5,  label: "SG 5   – ₱13,098",   value: "SG 5 - ₱13,098" },
  { grade: 6,  label: "SG 6   – ₱13,710",   value: "SG 6 - ₱13,710" },
  { grade: 7,  label: "SG 7   – ₱14,371",   value: "SG 7 - ₱14,371" },
  { grade: 8,  label: "SG 8   – ₱15,085",   value: "SG 8 - ₱15,085" },
  { grade: 9,  label: "SG 9   – ₱15,858",   value: "SG 9 - ₱15,858" },
  { grade: 10, label: "SG 10 – ₱16,694",   value: "SG 10 - ₱16,694" },
  { grade: 11, label: "SG 11 – ₱17,597",   value: "SG 11 - ₱17,597" },
  { grade: 12, label: "SG 12 – ₱18,573",   value: "SG 12 - ₱18,573" },
  { grade: 13, label: "SG 13 – ₱19,628",   value: "SG 13 - ₱19,628" },
  { grade: 14, label: "SG 14 – ₱20,769",   value: "SG 14 - ₱20,769" },
  { grade: 15, label: "SG 15 – ₱22,003",   value: "SG 15 - ₱22,003" },
  { grade: 16, label: "SG 16 – ₱23,340",   value: "SG 16 - ₱23,340" },
  { grade: 17, label: "SG 17 – ₱24,788",   value: "SG 17 - ₱24,788" },
  { grade: 18, label: "SG 18 – ₱26,357",   value: "SG 18 - ₱26,357" },
  { grade: 19, label: "SG 19 – ₱28,056",   value: "SG 19 - ₱28,056" },
  { grade: 20, label: "SG 20 – ₱29,894",   value: "SG 20 - ₱29,894" },
  { grade: 21, label: "SG 21 – ₱31,882",   value: "SG 21 - ₱31,882" },
  { grade: 22, label: "SG 22 – ₱34,034",   value: "SG 22 - ₱34,034" },
  { grade: 23, label: "SG 23 – ₱36,363",   value: "SG 23 - ₱36,363" },
  { grade: 24, label: "SG 24 – ₱38,884",   value: "SG 24 - ₱38,884" },
  { grade: 25, label: "SG 25 – ₱41,611",   value: "SG 25 - ₱41,611" },
  { grade: 26, label: "SG 26 – ₱44,561",   value: "SG 26 - ₱44,561" },
  { grade: 27, label: "SG 27 – ₱47,751",   value: "SG 27 - ₱47,751" },
  { grade: 28, label: "SG 28 – ₱51,193",   value: "SG 28 - ₱51,193" },
  { grade: 29, label: "SG 29 – ₱54,892",   value: "SG 29 - ₱54,892" },
  { grade: 30, label: "SG 30 – ₱58,863",   value: "SG 30 - ₱58,863" },
  { grade: 31, label: "SG 31 – ₱63,135",   value: "SG 31 - ₱63,135" },
  { grade: 32, label: "SG 32 – ₱67,733",   value: "SG 32 - ₱67,733" },
  { grade: 33, label: "SG 33 – ₱131,124",  value: "SG 33 - ₱131,124" },
];

const tabList = ["overview", "jobs", "applicants"];

const defaultJobForm = {
  title: "",
  location: "",
  jobType: "Full-time",
  salary: "",
  slots: 1,
  description: "",
  qualifications: [],
  applicationDeadline: "",
};

const statusClass = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (["active", "hired"].includes(normalized)) return "green";
  if (["pending", "applied"].includes(normalized)) return "gray";
  if (["reviewed"].includes(normalized)) return "blue";
  if (["shortlisted"].includes(normalized)) return "amber";
  if (["rejected", "closed"].includes(normalized)) return "red";
  return "gray";
};

const normalizeApplicationStatus = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "applied") return "pending";
  if (normalized === "accepted") return "hired";
  if (normalized === "reviewed") return "reviewed";
  if (normalized === "rejected") return "rejected";
  return normalized || "pending";
};

const formatDate = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getApplicantContact = (application) => {
  const applicant = application?.applicant || {};
  return applicant.phone || applicant.contactNumber || applicant.mobile || applicant.email || "N/A";
};

const normalizeRecentApplicantStatus = (value) => {
  const normalized = normalizeApplicationStatus(value);
  if (["active", "hired", "shortlisted", "rejected"].includes(normalized)) return normalized;
  return "pending";
};

const recentApplicantStatusClass = (value) => `recent-${normalizeRecentApplicantStatus(value)}`;

const recentApplicantStatusLabel = (value) => {
  const normalized = normalizeRecentApplicantStatus(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const getInitials = (name) => {
  const text = String(name || "").trim();
  if (!text) return "NA";
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const normalizeDrawerStatus = (value) => {
  const normalized = normalizeApplicationStatus(value);
  if (["pending", "shortlisted", "hired", "rejected"].includes(normalized)) return normalized;
  return "pending";
};

export default function EmployerDashboard() {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);

  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState({
    totalJobs: 0,
    activeJobs: 0,
    totalApplicants: 0,
    pendingReview: 0,
    shortlisted: 0,
    hired: 0,
  });
  const [jobs, setJobs] = useState([]);
  const [jobApplicants, setJobApplicants] = useState({});
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [recentApplicants, setRecentApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // Use custom hook for ranked applicants
  const { applicants: rankedApplicants, loading: loadingRanked, refetch: refetchRanked } = useRankedApplicants(selectedJobId);

  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [jobForm, setJobForm] = useState(defaultJobForm);
  const [isSavingJob, setIsSavingJob] = useState(false);

  const [selectedApplication, setSelectedApplication] = useState(null);
  const [drawerStatus, setDrawerStatus] = useState("pending");
  const [drawerNote, setDrawerNote] = useState("");
  const [isSavingApplication, setIsSavingApplication] = useState(false);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  const [jobToDelete, setJobToDelete] = useState(null);
  const [isDeletingJob, setIsDeletingJob] = useState(false);

  const isVerifiedEmployer = user?.role === "employer" && user?.verificationStatus === "verified";

  // ---- EFFECTS ----
  useEffect(() => {
    loadDashboardData();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Refetch ranked applicants when selected job changes
  useEffect(() => {
    if (selectedJobId && activeTab === "applicants") {
      refetchRanked();
    }
  }, [selectedJobId, activeTab]);

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => setSuccessToast(""), 2500);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  const selectedJobApplicants = selectedJobId ? jobApplicants[selectedJobId] || [] : [];
  const selectedJob = useMemo(
    () => jobs.find((job) => job._id === selectedJobId) || null,
    [jobs, selectedJobId]
  );

  // ---- DATA FETCHING ----
  const loadDashboardData = async () => {
    setLoading(true);
    setError("");
    try {
      console.log("📡 Fetching employer dashboard data...");
      const statsResponse = await employerAPI.getStats();
      console.log("📊 Stats:", statsResponse.data);
      const jobsResponse = await employerAPI.getJobs();
      console.log("💼 Jobs:", jobsResponse.data);

      const statsData = statsResponse.data;
      const jobsData = jobsResponse.data;

      setStats(statsData || {
        totalJobs: 0,
        activeJobs: 0,
        totalApplicants: 0,
        pendingReview: 0,
        shortlisted: 0,
        hired: 0,
      });

      const jobsArray = Array.isArray(jobsData) ? jobsData : [];
      setJobs(jobsArray);

      if (jobsArray.length > 0) {
        const applicantRequests = jobsArray.map(async (job) => {
          try {
            console.log(`🔍 Fetching applicants for job: ${job._id} (${job.title})`);
            const response = await employerAPI.getApplicantsForJob(job._id);
            console.log(`✅ Found ${response.data?.length || 0} applicants for ${job.title}`);
            return { jobId: job._id, applicants: response.data || [] };
          } catch (err) {
            console.error(`❌ Failed to fetch applicants for job ${job._id}:`, err);
            return { jobId: job._id, applicants: [] };
          }
        });

        const applicantResults = await Promise.all(applicantRequests);
        const nextApplicants = {};
        const allApplicants = [];

        applicantResults.forEach(({ jobId, applicants }) => {
          nextApplicants[jobId] = applicants;
          applicants.forEach((application) => {
            const job = jobsArray.find(j => j._id === jobId);
            allApplicants.push({
              ...application,
              vacancy: { _id: jobId, title: job?.title || "Unknown Job" },
            });
          });
        });

        allApplicants.sort((a, b) => {
          const dateA = new Date(a.createdAt || a.appliedAt || 0);
          const dateB = new Date(b.createdAt || b.appliedAt || 0);
          return dateB - dateA;
        });

        console.log(`📋 Total applicants across all jobs: ${allApplicants.length}`);

        setJobApplicants(nextApplicants);
        setRecentApplicants(allApplicants.slice(0, 5));

        const currentJobExists = jobsArray.some(job => job._id === selectedJobId);
        if (!selectedJobId || !currentJobExists) {
          setSelectedJobId(jobsArray[0]?._id ?? null);
        }
      } else {
        setJobApplicants({});
        setRecentApplicants([]);
        setSelectedJobId(null);
      }
    } catch (err) {
      console.error("❌ Dashboard load error:", err);
      setError(err.response?.data?.message || "Failed to load employer dashboard");
    } finally {
      setLoading(false);
    }
  };

  // ---- OPEN MODALS ----
  const openCreateJobModal = () => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    setEditingJob(null);
    setJobForm(defaultJobForm);
    setIsJobModalOpen(true);
  };

  const openEditJobModal = (job) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    setEditingJob(job);
    const quals = job.qualifications && Array.isArray(job.qualifications) ? job.qualifications : [];
    setJobForm({
      title: job.title || "",
      location: job.location || "",
      jobType: job.jobType || "Full-time",
      salary: job.salary || "",
      slots: job.slots || 1,
      description: job.description || "",
      qualifications: quals,
      applicationDeadline: job.applicationDeadline ? String(job.applicationDeadline).slice(0, 10) : "",
    });
    setIsJobModalOpen(true);
  };

  // ---- SAVE JOB ----
  const handleSaveJob = async (event) => {
    event.preventDefault();
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    setIsSavingJob(true);
    setError("");

    try {
      if (!jobForm.title.trim()) { setError("Job title is required"); setIsSavingJob(false); return; }
      if (!jobForm.description.trim()) { setError("Job description is required"); setIsSavingJob(false); return; }
      if (!jobForm.location.trim()) { setError("Location is required"); setIsSavingJob(false); return; }

      const payload = {
        title: jobForm.title.trim(),
        location: jobForm.location.trim(),
        description: jobForm.description.trim(),
        salary: jobForm.salary.trim(),
        jobType: jobForm.jobType,
        slots: Number(jobForm.slots) || 1,
        qualifications: jobForm.qualifications || [],
        applicationDeadline: jobForm.applicationDeadline || undefined,
      };

      if (editingJob?._id) {
        await employerAPI.updateJob(editingJob._id, payload);
        setSuccessToast("Job updated successfully");
      } else {
        await employerAPI.createJob(payload);
        setSuccessToast("Job posted successfully");
      }
      setIsJobModalOpen(false);
      await loadDashboardData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save job");
    } finally {
      setIsSavingJob(false);
    }
  };

  // ---- JOB STATUS TOGGLE ----
  const handleCloseOrReopen = async (job) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    setError("");
    try {
      const newStatus = job.status === "closed" ? "active" : "closed";
      await employerAPI.updateJob(job._id, { status: newStatus });
      setSuccessToast(`Job ${newStatus === "closed" ? "closed" : "reopened"} successfully`);
      await loadDashboardData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update job status");
    }
  };

  // ---- JOB DELETE ----
  const handleDeleteJob = async () => {
    if (!jobToDelete) return;
    setIsDeletingJob(true);
    setError("");
    try {
      await employerAPI.deleteJob(jobToDelete._id);
      setJobs(prev => prev.filter(j => j._id !== jobToDelete._id));
      setJobApplicants(prev => {
        const newState = { ...prev };
        delete newState[jobToDelete._id];
        return newState;
      });
      if (selectedJobId === jobToDelete._id) setSelectedJobId(null);
      const statsResponse = await employerAPI.getStats();
      setStats(statsResponse.data || {
        totalJobs: 0, activeJobs: 0, totalApplicants: 0, pendingReview: 0, shortlisted: 0, hired: 0,
      });
      setJobToDelete(null);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete job");
    } finally {
      setIsDeletingJob(false);
    }
  };

  // ---- APPLICANT DRAWER ----
  const openApplicantDrawer = (application) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    // Fetch freshest application data for the selected job (best-effort)
    (async () => {
      try {
        const resp = await employerAPI.getApplicantsForJob(selectedJobId);
        const apps = resp.data || [];
        const found = apps.find(a => String(a._id) === String(application._id)) || application;
        setSelectedApplication(found);
        setDrawerStatus(normalizeDrawerStatus(found.status));
        setDrawerNote(found.employerNote || "");
      } catch (err) {
        // fallback to supplied object
        setSelectedApplication(application);
        setDrawerStatus(normalizeDrawerStatus(application.status));
        setDrawerNote(application.employerNote || "");
      }
    })();
  };

  const handleSaveApplicationStatus = async () => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    if (!selectedApplication?._id) return;

    const updatedApplication = { ...selectedApplication, status: drawerStatus, employerNote: drawerNote };

    setRecentApplicants((prev) =>
      prev.map((app) => (app._id === updatedApplication._id ? updatedApplication : app))
    );
    setJobApplicants((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((jobId) => {
        newState[jobId] = newState[jobId].map((app) =>
          app._id === updatedApplication._id ? updatedApplication : app
        );
      });
      return newState;
    });
    setSelectedApplication(updatedApplication);

    setIsSavingApplication(true);
    setError("");

    try {
      await employerAPI.updateApplicationStatus(selectedApplication._id, {
        status: drawerStatus,
        employerNote: drawerNote,
      });
      setSuccessToast("Application updated successfully");
      setSelectedApplication(null);

      // Immediately refresh ranked applicants list and employer dashboard data
      try {
        await refetchRanked();
      } catch (e) {
        console.warn("Failed to refetch ranked applicants:", e);
      }

      try {
        const statsResponse = await employerAPI.getStats();
        setStats(statsResponse.data || {
          totalJobs: 0, activeJobs: 0, totalApplicants: 0, pendingReview: 0, shortlisted: 0, hired: 0,
        });
      } catch (statsErr) {
        console.warn("⚠️ Failed to update stats:", statsErr);
      }

      setTimeout(() => loadDashboardData(), 3000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update application");
      await loadDashboardData();
    } finally {
      setIsSavingApplication(false);
    }
  };

  const handleMessageApplicant = async (applicantId) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    if (!applicantId) { setError("No applicant selected"); return; }

    try {
      console.log("💬 Starting conversation with applicant:", applicantId);
      const { data } = await messageAPI.createConversation({ participantId: applicantId });
      console.log("✅ Conversation created:", data);
      const conversationId = data?._id;
      if (conversationId) {
        navigate("/messages", { state: { conversationId } });
      } else {
        setError("Failed to create conversation");
      }
    } catch (err) {
      console.error("❌ Failed to start conversation:", err);
      setError(err.response?.data?.message || "Failed to start conversation");
    }
  };

  // ---- STATS CARDS ----
  const statsCards = [
    { icon: "📁", label: "Total Jobs", value: stats.totalJobs, tone: "green" },
    { icon: "✅", label: "Active Jobs", value: stats.activeJobs, tone: "green" },
    { icon: "👥", label: "Total Applicants", value: stats.totalApplicants, tone: "green" },
    { icon: "⏳", label: "Pending Review", value: stats.pendingReview, tone: "amber" },
    { icon: "📌", label: "Shortlisted", value: stats.shortlisted, tone: "blue" },
    { icon: "🎉", label: "Hired", value: stats.hired, tone: "green" },
  ];

  // ==================== RENDER ====================
  return (
    <div className="dashboard-container employer-dashboard-page">
      {/* Verification Modal */}
      {showVerificationModal && (
        <div className="modal-overlay" onClick={() => setShowVerificationModal(false)}>
          <div className="verification-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Verification Required</h3>
            <p>
              Your employer account is not yet verified. Please go to your profile, upload your
              business permit / registration documents, and wait for admin approval.
            </p>
            <div className="verification-modal-actions">
              <button className="green-btn" onClick={() => { setShowVerificationModal(false); navigate("/profile"); }}>
                Go to Profile
              </button>
              <button className="outline-btn" onClick={() => setShowVerificationModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {jobToDelete && (
        <div className="modal-overlay" onClick={() => { if (!isDeletingJob) setJobToDelete(null); }}>
          <div className="verification-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Job Posting</h3>
            <p>
              Permanently delete <strong>{jobToDelete.title}</strong>? This will also remove all applications for this job. This action cannot be undone.
            </p>
            <div className="verification-modal-actions">
              <button
                className="green-btn"
                style={{ background: "#dc2626" }}
                onClick={handleDeleteJob}
                disabled={isDeletingJob}
              >
                {isDeletingJob ? "Deleting..." : "Delete"}
              </button>
              <button className="outline-btn" onClick={() => setJobToDelete(null)} disabled={isDeletingJob}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="dashboard-header">
        <div className="profile-section">
          <div className="profile-avatar">EM</div>
          <div className="profile-info">
            <h1>Employer Dashboard</h1>
            <p>Manage postings, applicants, and hiring updates in one place.</p>
          </div>
        </div>
      </div>

      <section className="employer-shell">
        <div className="employer-tabs" role="tablist" aria-label="Employer dashboard tabs">
          {tabList.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={`employer-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
              aria-selected={activeTab === tab}
            >
              {tab === "overview" ? "Overview" : tab === "jobs" ? "My Job Postings" : "Applicants"}
            </button>
          ))}
        </div>

        {error && <div className="error-message" role="alert">{error}</div>}

        {loading ? (
          <p className="loading">Loading dashboard...</p>
        ) : (
          <>
            {/* -------- OVERVIEW TAB -------- */}
            {activeTab === "overview" && (
              <div className="employer-tab-panel">
                <div className="stats-grid">
                  {statsCards.map((card) => (
                    <article key={card.label} className={`stat-card tone-${card.tone}`}>
                      <span className="stat-icon" aria-hidden="true">{card.icon}</span>
                      <strong>{card.value}</strong>
                      <p>{card.label}</p>
                    </article>
                  ))}
                </div>

                <div className="table-card">
                  <div className="table-card-header">
                    <h2>Recent Applicants</h2>
                  </div>
                  {!recentApplicants.length ? (
                    <div className="recent-applicants-empty">No recent applicants yet.</div>
                  ) : (
                    <>
                      {!isMobile ? (
                        <div className="table-scroll-wrap recent-applicants-table-wrap">
                          <table className="employer-table recent-applicants-table">
                            <colgroup>
                              <col style={{ width: "22%" }} />
                              <col style={{ width: "24%" }} />
                              <col style={{ width: "14%" }} />
                              <col style={{ width: "13%" }} />
                              <col style={{ width: "15%" }} />
                              <col style={{ width: "12%" }} />
                            </colgroup>
                            <thead>
                              <tr>
                                <th>Applicant Name</th>
                                <th>Applied For</th>
                                <th>Date</th>
                                <th>Status</th>
                                <th>Contact</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recentApplicants.map((application) => (
                                <tr key={application._id}>
                                  <td>{application.applicant?.name || "Unknown Applicant"}</td>
                                  <td>{application.vacancy?.title || "Unknown Job"}</td>
                                  <td>{formatDate(application.createdAt || application.appliedAt)}</td>
                                  <td>
                                    <span className={`status-pill ${recentApplicantStatusClass(application.status)}`}>
                                      {recentApplicantStatusLabel(application.status)}
                                    </span>
                                  </td>
                                  <td>{getApplicantContact(application)}</td>
                                  <td>
                                    <button type="button" className="recent-view-btn" onClick={() => openApplicantDrawer(application)}>
                                      View
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="recent-applicants-mobile" aria-label="Recent applicants mobile list">
                          {recentApplicants.map((application) => (
                            <article key={`mobile-${application._id}`} className="recent-applicant-card">
                              <div className="recent-applicant-top">
                                <strong>{application.applicant?.name || "Unknown Applicant"}</strong>
                                <span className={`status-pill ${recentApplicantStatusClass(application.status)}`}>
                                  {recentApplicantStatusLabel(application.status)}
                                </span>
                              </div>
                              <div className="recent-applicant-grid">
                                <span className="label">Applied For</span>
                                <span className="value">{application.vacancy?.title || "Unknown Job"}</span>
                                <span className="label">Date</span>
                                <span className="value">{formatDate(application.createdAt || application.appliedAt)}</span>
                                <span className="label">Contact</span>
                                <span className="value">{getApplicantContact(application)}</span>
                                <span className="label">Action</span>
                                <span className="value">
                                  <button type="button" className="recent-view-btn" onClick={() => openApplicantDrawer(application)}>
                                    View
                                  </button>
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* -------- JOBS TAB -------- */}
            {activeTab === "jobs" && (
              <div className="employer-tab-panel">
                <div className="panel-header-row">
                  <h2>My Job Postings</h2>
                  <button type="button" className="green-btn" onClick={openCreateJobModal}>
                    + Post New Job
                  </button>
                </div>

                <div className="jobs-grid">
                  {!jobs.length ? (
                    <p className="empty-muted">You have no job postings yet.</p>
                  ) : (
                    jobs.map((job) => (
                      <article key={job._id} className="job-card">
                        <div className="job-card-head">
                          <h3>{job.title}</h3>
                          <span className={`status-pill ${statusClass(job.status)}`}>
                            {job.status || "active"}
                          </span>
                        </div>
                        <p className="job-meta">{job.location}</p>
                        <p className="job-meta">Salary: {job.salary || "Negotiable"}</p>
                        <p className="job-meta">Applicants: {job.applicantCount || 0}</p>
                        <p className="job-meta">Posted: {formatDate(job.createdAt)}</p>

                        <div className="job-actions">
                          <button type="button" className="outline-btn" onClick={() => openEditJobModal(job)}>
                            Edit
                          </button>
                          <button type="button" className="outline-btn" onClick={() => handleCloseOrReopen(job)}>
                            {job.status === "closed" ? "Reopen" : "Close"}
                          </button>
                          <button
                            type="button"
                            className="outline-btn"
                            onClick={() => {
                              if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
                              setActiveTab("applicants");
                              setSelectedJobId(job._id);
                            }}
                          >
                            View Applicants
                          </button>
                          <button
                            type="button"
                            className="outline-btn"
                            style={{ color: "#dc2626", borderColor: "#dc2626" }}
                            onClick={() => {
                              if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
                              setJobToDelete(job);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* -------- APPLICANTS TAB (using modular components) -------- */}
            {activeTab === "applicants" && (
              <div className="employer-tab-panel applicants-layout">
                <aside className="job-list-panel">
                  <h3>Your Jobs</h3>
                  {!jobs.length ? (
                    <p className="empty-muted">No jobs yet.</p>
                  ) : (
                    jobs.map((job) => (
                      <button
                        type="button"
                        key={job._id}
                        className={`job-list-item ${selectedJobId === job._id ? "active" : ""}`}
                        onClick={() => setSelectedJobId(job._id)}
                      >
                        <strong>{job.title}</strong>
                        <small>{job.location}</small>
                      </button>
                    ))
                  )}
                </aside>

                <section className="applicants-panel">
                  <div className="panel-header-row">
                    <h2>
                      {selectedJob ? `${selectedJob.title} Applicants` : "Applicants"}
                    </h2>
                    {selectedJob && (
                      <span className="applicant-count-badge">
                        {rankedApplicants.length} applicants
                      </span>
                    )}
                  </div>

                  {!selectedJobId ? (
                    <p className="empty-muted">Select a job to view applicants.</p>
                  ) : (
                    <RankedApplicantsTable
                      applicants={rankedApplicants}
                      onViewApplicant={openApplicantDrawer}
                      onMessageApplicant={handleMessageApplicant}
                      loading={loadingRanked}
                    />
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </section>

      {/* ===== JOB MODAL WITH QUALIFICATIONS EDITOR ===== */}
      {isJobModalOpen && (
        <div className="modal-overlay" onClick={() => setIsJobModalOpen(false)}>
          <div className="job-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{editingJob ? "Edit Job Posting" : "Post New Job"}</h3>
            {error && <div className="error-message">{error}</div>}

            <form className="job-form-grid" onSubmit={handleSaveJob}>
              <label>
                Job Title *
                <input
                  type="text"
                  value={jobForm.title}
                  onChange={(event) => setJobForm((prev) => ({ ...prev, title: event.target.value }))}
                  required
                  disabled={isSavingJob}
                />
              </label>

              <LocationSelect
                value={jobForm.location}
                onChange={(loc) => setJobForm(prev => ({ ...prev, location: loc }))}
                disabled={isSavingJob}
                required
              />

              <label>
                Job Type
                <select
                  value={jobForm.jobType}
                  onChange={(event) => setJobForm((prev) => ({ ...prev, jobType: event.target.value }))}
                  disabled={isSavingJob}
                >
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Internship">Internship</option>
                  <option value="Temporary">Temporary</option>
                  <option value="Remote">Remote</option>
                </select>
              </label>

              <label>
                Salary Grade *
                <select
                  value={jobForm.salary}
                  onChange={(event) => setJobForm((prev) => ({ ...prev, salary: event.target.value }))}
                  required
                  disabled={isSavingJob}
                >
                  <option value="">-- Select Salary Grade --</option>
                  <option value="Negotiable">Negotiable / Open</option>
                  {SALARY_GRADES.map((sg) => (
                    <option key={sg.value} value={sg.value}>{sg.label}</option>
                  ))}
                </select>
              </label>

              <label>
                Slots Available *
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={jobForm.slots}
                  onChange={(event) => setJobForm((prev) => ({ ...prev, slots: Number(event.target.value) || 1 }))}
                  required
                  disabled={isSavingJob}
                />
              </label>

              <label className="full-width">
                Description *
                <textarea
                  value={jobForm.description}
                  onChange={(event) => setJobForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows="4"
                  required
                  disabled={isSavingJob}
                  placeholder="Describe the job responsibilities, role scope, and expectations..."
                />
              </label>

              {/* Qualifications Editor */}
              <div className="full-width">
                <QualificationsEditor
                  value={jobForm.qualifications}
                  onChange={(newQuals) => setJobForm(prev => ({ ...prev, qualifications: newQuals }))}
                  disabled={isSavingJob}
                  label="Qualifications / Requirements"
                  required
                />
              </div>

              <label>
                Application Deadline
                <input
                  type="date"
                  value={jobForm.applicationDeadline}
                  onChange={(event) => setJobForm((prev) => ({ ...prev, applicationDeadline: event.target.value }))}
                  min={new Date().toISOString().split("T")[0]}
                  disabled={isSavingJob}
                />
              </label>

              <div className="job-modal-actions full-width">
                <button type="button" className="outline-btn" onClick={() => setIsJobModalOpen(false)} disabled={isSavingJob}>
                  Cancel
                </button>
                <button type="submit" className="green-btn" disabled={isSavingJob}>
                  {isSavingJob ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Applicant Drawer */}
      {selectedApplication && (
        <div className="drawer-overlay" onClick={() => setSelectedApplication(null)}>
          <aside className="applicant-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-handle" aria-hidden="true" />
            <header className="drawer-header">
              <div className="drawer-header-main">
                <div className="drawer-avatar">{getInitials(selectedApplication.applicant?.name)}</div>
                <div className="drawer-header-text">
                  <h3>{selectedApplication.applicant?.name || "N/A"}</h3>
                  <p>{selectedApplication.vacancy?.title || "Applied Position"}</p>
                </div>
              </div>
              <button type="button" className="drawer-close-btn" onClick={() => setSelectedApplication(null)} aria-label="Close details">×</button>
            </header>

            <div className="drawer-body">
              <div className="drawer-info-list">
                <div className="drawer-info-row"><span className="drawer-info-label">Full name</span><span className="drawer-info-value">{selectedApplication.applicant?.name || "N/A"}</span></div>
                <div className="drawer-info-row"><span className="drawer-info-label">Email</span><span className="drawer-info-value">{selectedApplication.applicant?.email || "N/A"}</span></div>
                <div className="drawer-info-row"><span className="drawer-info-label">Phone</span><span className="drawer-info-value">{selectedApplication.applicant?.phone || "N/A"}</span></div>
                <div className="drawer-info-row"><span className="drawer-info-label">Address</span><span className="drawer-info-value">{selectedApplication.applicant?.address || "N/A"}</span></div>
                <div className="drawer-info-row"><span className="drawer-info-label">Application date</span><span className="drawer-info-value">{formatDate(selectedApplication.createdAt || selectedApplication.appliedAt)}</span></div>
              </div>

              <div className="drawer-section">
                <p className="drawer-section-label">Skills</p>
                <div className="drawer-skill-list">
                  {selectedApplication.applicant?.skills?.length ? (
                    selectedApplication.applicant.skills.map((skill) => <span key={skill}>{skill}</span>)
                  ) : (
                    <span className="skill-empty">No skills listed</span>
                  )}
                </div>
              </div>

              {selectedApplication.resume && (
                <a
                  className="drawer-resume-link"
                  href={`${API_URL.replace(/\/api\/v1$/, '')}/${String(selectedApplication.resume).replace(/^\/+/, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span aria-hidden="true">↓</span>
                  <span>Download Resume</span>
                </a>
              )}

              <label className="drawer-field">
                <span className="drawer-section-label">Status</span>
                <select
                  className={`drawer-status-select status-${drawerStatus}`}
                  value={drawerStatus}
                  onChange={(event) => setDrawerStatus(event.target.value)}
                  disabled={isSavingApplication}
                >
                  <option value="pending">Pending</option>
                  <option value="shortlisted">Shortlisted</option>
                  <option value="hired">Hired</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>

              <label className="drawer-field">
                <span className="drawer-section-label">Note to Applicant</span>
                <textarea
                  rows="4"
                  value={drawerNote}
                  onChange={(event) => setDrawerNote(event.target.value)}
                  placeholder="Add a quick status note…"
                  disabled={isSavingApplication}
                />
              </label>

              <footer className="drawer-footer">
                <button
                  type="button"
                  className="drawer-save-btn"
                  onClick={handleSaveApplicationStatus}
                  disabled={isSavingApplication}
                >
                  {isSavingApplication ? "Saving..." : "Save & Notify"}
                </button>
              </footer>
            </div>
          </aside>
        </div>
      )}

      {successToast && (
        <div className="success-toast" role="alert">{successToast}</div>
      )}
    </div>
  );
}