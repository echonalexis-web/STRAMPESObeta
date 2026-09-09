import { useEffect, useMemo, useState, useContext, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { employerAPI, messageAPI } from "../services/api";
import "../styles/employer-dashboard.css";
import { API_URL } from "../services/api";
import { AuthContext } from "../context/AuthContext";
import LocationSelect from "../components/LocationSelect";
import QualificationsEditor from "../components/QualificationsEditor";
import BasicRequirements from "../components/BasicRequirements";
import {
  EMPTY_BASIC_REQUIREMENTS,
  pickBasicRequirements,
  serializeBasicRequirements,
  validateBasicRequirements,
} from "../utils/basicRequirements";
import "../styles/qualifications-editor.css";
import RankedApplicantsTable from "../components/RankedApplicantsTable";
import SecureFileLink from "../components/SecureFileLink";
import { useRankedApplicants } from "../hooks/useRankedApplicants";
import { useSwipeable } from "react-swipeable";
import {
  FaBriefcase,
  FaMapMarkerAlt,
  FaMoneyBillWave,
  FaCalendarAlt,
  FaUserPlus,
  FaSave,
  FaSpinner,
  FaBuilding,
  FaListUl,
  FaClipboardList,
  FaCoins,
  FaUsers,
  FaClock,
  FaStar,
  FaTimes,
  FaBan,
  FaEdit,
  FaArchive,
  FaTimesCircle,
  FaArchive as FaArchiveIcon,
  FaSearch,
  FaChevronLeft,
  FaChevronRight,
  FaTrashAlt,
  FaRedo,
} from "react-icons/fa";

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

const tabList = ["overview", "jobs", "applicants", "archived"];

const formatSalaryPreview = (min, max) => {
  const hasMin = min !== "" && min !== null && min !== undefined && Number.isFinite(Number(min));
  const hasMax = max !== "" && max !== null && max !== undefined && Number.isFinite(Number(max));
  if (!hasMin && !hasMax) return "";
  const fmt = (n) => `PHP ${Number(n).toLocaleString("en-PH")}`;
  if (hasMin && hasMax && Number(min) !== Number(max)) return `${fmt(min)} - ${fmt(max)}`;
  return fmt(hasMin ? min : max);
};

const defaultJobForm = {
  title: "",
  location: "",
  jobType: "Full-time",
  salaryMin: "",
  salaryMax: "",
  slots: 1,
  description: "",
  qualifications: [],
  applicationDeadline: "",
  ...EMPTY_BASIC_REQUIREMENTS,
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

const formatJobLocation = (value) => {
  const text = String(value || "").trim();
  if (!text) return "Location not specified";
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const getApplicantContact = (application) => {
  const applicant = application?.applicant || {};
  return applicant.phone || applicant.contactNumber || applicant.mobile || applicant.email || "N/A";
};

// Compact relative age used across the job / applicant tables.
const relativeAge = (value) => {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

// Roll a job's applicant list up into a funnel. `new` = still-pending (unreviewed).
const jobFunnel = (apps = []) => {
  const f = { total: apps.length, new: 0, shortlisted: 0, hired: 0, rejected: 0 };
  apps.forEach((a) => {
    const s = normalizeApplicationStatus(a.status);
    if (s === "pending") f.new += 1;
    else if (s === "shortlisted") f.shortlisted += 1;
    else if (s === "hired") f.hired += 1;
    else if (s === "rejected") f.rejected += 1;
  });
  return f;
};

const archiveReasonLabel = (reason) => {
  if (!reason) return "";
  return String(reason)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// Days a deadline is away, or null when there is no upcoming deadline.
const daysUntilDeadline = (value) => {
  if (!value) return null;
  const end = new Date(value).getTime();
  if (Number.isNaN(end)) return null;
  const diff = Math.ceil((end - Date.now()) / 86400000);
  return diff;
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

// ===== SWIPEABLE JOB CARD COMPONENT =====
function SwipeableJobCard({
  job,
  isOpen,
  onOpen,
  onClose,
  formatDate,
  isVerifiedEmployer,
  setShowVerificationModal,
  setActiveTab,
  setSelectedJobId,
  openEditJobModal,
  handleCloseOrReopen,
  handleArchiveJob,
}) {
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => onOpen(),
    onSwipedRight: () => onClose(),
    trackMouse: true,
    preventDefaultTouchmoveEvent: true,
    delta: 40,
  });

  return (
    <div className="swipeable-card-wrapper">
      <div
        {...swipeHandlers}
        className={`swipeable-card ${isOpen ? "open" : ""}`}
      >
        {/* Main content – left side */}
        <div className="job-card-compact-content">
          <div className="job-card-compact-row">
            <h3 className="job-card-compact-title">{job.title}</h3>
            <span className={`status-pill ${statusClass(job.status)}`}>
              {job.status || "active"}
            </span>
          </div>
          <div className="job-card-compact-stats">
            <div className="job-card-compact-stat">
              <span className="job-stat-value">{job.applicantCount || 0}</span>
              <span className="job-stat-label">Applicants</span>
            </div>
            <div className="job-card-compact-stat">
              <span className="job-stat-value">{formatDate(job.createdAt)}</span>
              <span className="job-stat-label">Posted</span>
            </div>
          </div>
          {/* Expanded details – shown on hover */}
          <div className="job-card-compact-expanded">
            <p className="job-meta">📍 {job.location}</p>
            <p className="job-meta">💰 {job.salary || "Negotiable"}</p>
            <button
              type="button"
              className="view-applicants-btn"
              onClick={() => {
                if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
                setActiveTab("applicants");
                setSelectedJobId(job._id);
              }}
            >
              View Applicants
            </button>
          </div>
        </div>

        {/* Right action sidebar – hidden by default, revealed on swipe */}
        <div className="job-card-compact-actions">
          <button
            type="button"
            className="action-btn edit-btn"
            onClick={() => { openEditJobModal(job); onClose(); }}
            aria-label="Edit job"
          >
            <FaEdit />
          </button>
          <button
            type="button"
            className={`action-btn ${job.status === "closed" ? "reopen-btn" : "close-btn"}`}
            onClick={() => { handleCloseOrReopen(job); onClose(); }}
            aria-label={job.status === "closed" ? "Reopen job" : "Close job"}
          >
            {job.status === "closed" ? <FaStar /> : <FaTimesCircle />}
          </button>
          {job.status === "closed" && (
            <button
              type="button"
              className="action-btn archive-btn"
              onClick={() => { handleArchiveJob(job); onClose(); }}
              disabled={job.archived}
              aria-label={job.archived ? "Archived" : "Archive job"}
            >
              <FaArchive />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== ARCHIVED JOB POST-MORTEM (shared by table detail row + mobile card) =====
function ArchivedPostMortem({ job }) {
  const m = job.archivedMetrics || {};
  const rates = [
    { label: "Qualified rate", value: m.qualifiedRate ?? 0 },
    { label: "Shortlist rate", value: m.shortlistedRate ?? 0 },
    { label: "Hire rate", value: m.hireRate ?? 0 },
  ];
  return (
    <div className="emp-postmortem">
      <div className="emp-postmortem-facts">
        <div><span>Total applicants</span><strong>{m.totalApplicants ?? 0}</strong></div>
        <div><span>Qualified / Shortlisted</span><strong>{(m.qualifiedCount ?? 0)} / {(m.shortlistedCount ?? 0)}</strong></div>
        <div><span>Time to close</span><strong>{m.daysActive ?? 0} days</strong></div>
        <div><span>Hired</span><strong>{(m.hiredCandidateIds || []).length ? m.hiredCandidateIds.join(", ") : "None"}</strong></div>
        <div><span>Reason</span><strong>{archiveReasonLabel(job.archiveReason) || "N/A"}</strong></div>
      </div>
      <div className="emp-postmortem-bars">
        {rates.map((r) => (
          <div key={r.label} className="emp-bar-row">
            <label>{r.label}</label>
            <div className="emp-bar"><span style={{ width: `${Math.min(100, Math.max(0, r.value))}%` }} /></div>
            <small>{r.value}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== MAIN COMPONENT =====
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
  const [jobsPage, setJobsPage] = useState(1);
  const [jobSearch, setJobSearch] = useState("");
  const [jobSort, setJobSort] = useState("newest");
  const [openJobMenuId, setOpenJobMenuId] = useState(null);
  const [jobMenuPos, setJobMenuPos] = useState({ top: 0, left: 0 });
  const [jobApplicants, setJobApplicants] = useState({});
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [recentApplicants, setRecentApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successToast, setSuccessToast] = useState("");

  const { applicants: rankedApplicants, loading: loadingRanked, refetch: refetchRanked } = useRankedApplicants(selectedJobId);

  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [jobForm, setJobForm] = useState(defaultJobForm);
  const [isSavingJob, setIsSavingJob] = useState(false);
  const [modalActiveSection, setModalActiveSection] = useState("details");

  const [selectedApplication, setSelectedApplication] = useState(null);
  const [drawerStatus, setDrawerStatus] = useState("pending");
  const [drawerNote, setDrawerNote] = useState("");
  const [isSavingApplication, setIsSavingApplication] = useState(false);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  const [jobToDelete, setJobToDelete] = useState(null);
  const [isDeletingJob, setIsDeletingJob] = useState(false);

  const [selectedApplicants, setSelectedApplicants] = useState([]);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("match");

  // Swipe state: which job card is open
  const [openSwipeId, setOpenSwipeId] = useState(null);
  const [expandedArchivedJobs, setExpandedArchivedJobs] = useState({});
  const [archivedSearch, setArchivedSearch] = useState("");
  const [archivedPage, setArchivedPage] = useState(1);
  const ARCHIVED_PAGE_SIZE = 10;
  const [applicantsPage, setApplicantsPage] = useState(1);
  const APPLICANTS_PAGE_SIZE = 10;

  const isVerifiedEmployer = user?.role === "employer" && user?.verificationStatus === "verified";

  const [qualTemplates, setQualTemplates] = useState([]);

  const loadQualTemplates = async () => {
    try {
      const res = await employerAPI.getQualificationTemplates();
      setQualTemplates(Array.isArray(res.data?.templates) ? res.data.templates : []);
    } catch {
      setQualTemplates([]); // editor falls back to its built-in static templates
    }
  };

  const handleSaveQualTemplate = async ({ name, items }) => {
    const res = await employerAPI.createQualificationTemplate({
      name,
      jobTitle: jobForm.title || "",
      items,
    });
    await loadQualTemplates();
    setSuccessToast("Template saved");
    return res;
  };

  useEffect(() => {
    loadDashboardData();
    if (isVerifiedEmployer) loadQualTemplates();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const archivedJobs = useMemo(
    () => jobs.filter((job) => job.archived || job.status === "closed"),
    [jobs]
  );
  const filteredArchivedJobs = useMemo(() => {
    const query = archivedSearch.trim().toLowerCase();
    if (!query) return archivedJobs;
    return archivedJobs.filter((job) =>
      String(job.title || "").toLowerCase().includes(query) ||
      String(job.location || "").toLowerCase().includes(query)
    );
  }, [archivedJobs, archivedSearch]);
  const archivedTotalPages = Math.max(1, Math.ceil(filteredArchivedJobs.length / ARCHIVED_PAGE_SIZE));
  const paginatedArchivedJobs = useMemo(() => {
    const start = (archivedPage - 1) * ARCHIVED_PAGE_SIZE;
    return filteredArchivedJobs.slice(start, start + ARCHIVED_PAGE_SIZE);
  }, [filteredArchivedJobs, archivedPage]);

  useEffect(() => {
    setArchivedPage(1);
  }, [archivedSearch]);

  useEffect(() => {
    if (archivedPage > archivedTotalPages) setArchivedPage(archivedTotalPages);
  }, [archivedTotalPages, archivedPage]);
  const liveJobs = useMemo(
    () => jobs.filter((job) => !job.archived && job.status !== "closed"),
    [jobs]
  );

  // Per-job funnel keyed by id, derived from the applicant map loaded on mount.
  const funnelByJob = useMemo(() => {
    const map = {};
    Object.entries(jobApplicants).forEach(([jobId, apps]) => {
      map[jobId] = jobFunnel(apps);
    });
    return map;
  }, [jobApplicants]);
  const funnelFor = (jobId) => funnelByJob[jobId] || { total: 0, new: 0, shortlisted: 0, hired: 0, rejected: 0 };

  // Live jobs ordered for the applicants-tab picker: most unreviewed first.
  const railJobs = useMemo(
    () => [...liveJobs].sort((a, b) => funnelFor(b._id).new - funnelFor(a._id).new),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveJobs, funnelByJob]
  );
  const RAIL_CHIP_LIMIT = 4;
  const stepSelectedJob = (delta) => {
    if (!railJobs.length) return;
    const idx = railJobs.findIndex((j) => j._id === selectedJobId);
    const nextIdx = idx === -1 ? 0 : (idx + delta + railJobs.length) % railJobs.length;
    setSelectedJobId(railJobs[nextIdx]._id);
  };

  const visibleJobs = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    let list = liveJobs;
    if (query) {
      list = list.filter(
        (job) =>
          String(job.title || "").toLowerCase().includes(query) ||
          String(job.location || "").toLowerCase().includes(query)
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (jobSort === "applicants") return funnelFor(b._id).total - funnelFor(a._id).total;
      if (jobSort === "new") return funnelFor(b._id).new - funnelFor(a._id).new;
      if (jobSort === "oldest") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); // newest
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJobs, jobSearch, jobSort, funnelByJob]);

  const jobsPageSize = 8;
  const jobsTotalPages = Math.max(1, Math.ceil(visibleJobs.length / jobsPageSize));
  const paginatedJobs = useMemo(() => {
    const safePage = Math.min(jobsPage, jobsTotalPages);
    const startIndex = (safePage - 1) * jobsPageSize;
    return visibleJobs.slice(startIndex, startIndex + jobsPageSize);
  }, [visibleJobs, jobsPage, jobsTotalPages]);

  useEffect(() => {
    setJobsPage(1);
  }, [jobSearch, jobSort]);

  useEffect(() => {
    setJobsPage((page) => Math.min(page, Math.max(1, Math.ceil(liveJobs.length / jobsPageSize))));
  }, [liveJobs]);

  const loadDashboardData = async () => {
    setLoading(true);
    setError("");
    try {
      const statsResponse = await employerAPI.getStats();
      const jobsResponse = await employerAPI.getJobs();

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
            const response = await employerAPI.getApplicantsForJob(job._id);
            return { jobId: job._id, applicants: response.data || [] };
          } catch (err) {
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
      setError(err.response?.data?.message || "Failed to load employer dashboard");
    } finally {
      setLoading(false);
    }
  };

  const openCreateJobModal = () => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    navigate("/post-job");
  };

  const openEditJobModal = (job) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    setEditingJob(job);
    const quals = job.qualifications && Array.isArray(job.qualifications) ? job.qualifications : [];
    setJobForm({
      title: job.title || "",
      location: job.location || "",
      jobType: job.jobType || "Full-time",
      salaryMin: Number.isFinite(job.salaryMin) ? String(job.salaryMin) : "",
      salaryMax: Number.isFinite(job.salaryMax) ? String(job.salaryMax) : "",
      slots: job.slots || 1,
      description: job.description || "",
      qualifications: quals,
      applicationDeadline: job.applicationDeadline ? String(job.applicationDeadline).slice(0, 10) : "",
      ...pickBasicRequirements(job),
    });
    setModalActiveSection("details");
    setIsJobModalOpen(true);
  };

  const handleSaveJob = async (event) => {
    event.preventDefault();
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    setIsSavingJob(true);
    setError("");

    try {
      if (!jobForm.title.trim()) { setError("Job title is required"); setIsSavingJob(false); return; }
      if (!jobForm.description.trim()) { setError("Job description is required"); setIsSavingJob(false); return; }
      if (!jobForm.location.trim()) { setError("Location is required"); setIsSavingJob(false); return; }
      if (
        jobForm.salaryMin !== "" && jobForm.salaryMax !== "" &&
        Number(jobForm.salaryMin) > Number(jobForm.salaryMax)
      ) {
        setError("Salary minimum cannot be greater than salary maximum");
        setIsSavingJob(false);
        return;
      }
      const basicReqIssues = validateBasicRequirements(pickBasicRequirements(jobForm));
      if (basicReqIssues.length > 0) {
        setError(basicReqIssues[0]);
        setIsSavingJob(false);
        return;
      }

      const payload = {
        title: jobForm.title.trim(),
        location: jobForm.location.trim(),
        description: jobForm.description.trim(),
        salaryMin: jobForm.salaryMin !== "" ? Number(jobForm.salaryMin) : null,
        salaryMax: jobForm.salaryMax !== "" ? Number(jobForm.salaryMax) : null,
        jobType: jobForm.jobType,
        slots: Number(jobForm.slots) || 1,
        qualifications: jobForm.qualifications || [],
        applicationDeadline: jobForm.applicationDeadline || undefined,
        ...serializeBasicRequirements(pickBasicRequirements(jobForm)),
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

  const handleCloseOrReopen = async (job) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    setError("");
    try {
      if (job.status === "closed") {
        await employerAPI.reopenJob(job._id);
        setSuccessToast("Job reopened successfully");
      } else {
        await employerAPI.closeJob(job._id);
        setSuccessToast("Job closed successfully");
      }
      await loadDashboardData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update job status");
    }
  };

  const handleArchiveJob = async (job) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    if (job.status !== "closed") {
      setError("Only closed jobs can be archived");
      return;
    }
    setError("");
    try {
      await employerAPI.archiveJob(job._id);
      setSuccessToast("Job archived successfully");
      await loadDashboardData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to archive job");
    }
  };

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
      setSuccessToast("Job deleted");
      setJobToDelete(null);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete job");
    } finally {
      setIsDeletingJob(false);
    }
  };

  const openApplicantDrawer = (application) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    (async () => {
      try {
        const resp = await employerAPI.getApplicantsForJob(selectedJobId);
        const apps = resp.data || [];
        const found = apps.find(a => String(a._id) === String(application._id)) || application;
        setSelectedApplication(found);
        setDrawerStatus(normalizeDrawerStatus(found.status));
        setDrawerNote(found.employerNote || "");
      } catch (err) {
        setSelectedApplication(application);
        setDrawerStatus(normalizeDrawerStatus(application.status));
        setDrawerNote(application.employerNote || "");
      }
    })();
  };

  const handleSaveApplicationStatus = async () => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    if (!selectedApplication?._id) return;

    if (drawerStatus === "rejected") {
      setRejectDialog({
        kind: "drawer",
        applicationId: selectedApplication._id,
        applicantName: selectedApplication.applicant?.name || "this applicant",
      });
      return;
    }

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

      try { await refetchRanked(); } catch (e) { console.warn(e); }
      try {
        const statsResponse = await employerAPI.getStats();
        setStats(statsResponse.data || {
          totalJobs: 0, activeJobs: 0, totalApplicants: 0, pendingReview: 0, shortlisted: 0, hired: 0,
        });
      } catch (statsErr) { console.warn(statsErr); }

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
      const { data } = await messageAPI.createConversation({ participantId: applicantId });
      const conversationId = data?._id;
      if (conversationId) {
        navigate("/messages", { state: { conversationId } });
      } else {
        setError("Failed to create conversation");
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to start conversation");
    }
  };

  const handleSelectApplicant = (applicationId, checked) => {
    if (checked) {
      setSelectedApplicants(prev => [...prev, applicationId]);
    } else {
      setSelectedApplicants(prev => prev.filter(id => id !== applicationId));
    }
  };

  const handleBulkAction = async (status) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
    if (selectedApplicants.length === 0) {
      setError("Please select at least one applicant");
      return;
    }

    if (status === "rejected") {
      setRejectDialog({
        kind: "bulk",
        applicationIds: [...selectedApplicants],
        applicantName: `${selectedApplicants.length} selected applicants`,
      });
      return;
    }

    setIsBulkUpdating(true);
    setError("");

    try {
      const response = await employerAPI.bulkUpdateApplicationStatuses({
        applicationIds: selectedApplicants,
        status,
      });

      setSuccessToast(`Successfully ${status === 'shortlisted' ? 'shortlisted' : status === 'rejected' ? 'rejected' : 'updated'} ${response.data.updated} applicants`);
      setSelectedApplicants([]);

      await refetchRanked();
      const statsResponse = await employerAPI.getStats();
      setStats(statsResponse.data || {
        totalJobs: 0, activeJobs: 0, totalApplicants: 0, pendingReview: 0, shortlisted: 0, hired: 0,
      });

      setTimeout(() => loadDashboardData(), 3000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to bulk update applicants");
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const confirmRejectDialog = async () => {
    if (!rejectDialog) return;

    try {
      if (rejectDialog.kind === "single") {
        await employerAPI.updateApplicationStatus(rejectDialog.applicationId, { status: "rejected" });
        setSuccessToast("Application rejected successfully");
      } else if (rejectDialog.kind === "bulk") {
        const response = await employerAPI.bulkUpdateApplicationStatuses({
          applicationIds: rejectDialog.applicationIds,
          status: "rejected",
        });
        setSuccessToast(`Successfully rejected ${response.data.updated} applicants`);
        setSelectedApplicants([]);
      } else if (rejectDialog.kind === "drawer") {
        await employerAPI.updateApplicationStatus(rejectDialog.applicationId, {
          status: "rejected",
          employerNote: drawerNote,
        });
        setSuccessToast("Application rejected successfully");
      }

      setRejectDialog(null);
      await refetchRanked();
      const statsResponse = await employerAPI.getStats();
      setStats(statsResponse.data || {
        totalJobs: 0, activeJobs: 0, totalApplicants: 0, pendingReview: 0, shortlisted: 0, hired: 0,
      });

      if (rejectDialog.kind === "drawer") {
        setSelectedApplication(null);
      }

      setTimeout(() => loadDashboardData(), 3000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reject applicant");
    }
  };

  const handleQuickStatusChange = async (applicationId, status) => {
    if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }

    if (status === "rejected") {
      const applicant = rankedApplicants.find((app) => app._id === applicationId);
      setRejectDialog({
        kind: "single",
        applicationId,
        applicantName: applicant?.applicant?.name || "this applicant",
      });
      return;
    }

    try {
      await employerAPI.updateApplicationStatus(applicationId, { status });
      setSuccessToast(`Application ${status === 'shortlisted' ? 'shortlisted' : status === 'rejected' ? 'rejected' : 'updated'} successfully`);

      await refetchRanked();
      const statsResponse = await employerAPI.getStats();
      setStats(statsResponse.data || {
        totalJobs: 0, activeJobs: 0, totalApplicants: 0, pendingReview: 0, shortlisted: 0, hired: 0,
      });

      setTimeout(() => loadDashboardData(), 3000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update application status");
    }
  };

  const filteredAndSortedApplicants = useMemo(() => {
    let filtered = [...rankedApplicants];

    if (statusFilter !== "all") {
      filtered = filtered.filter(app => {
        const normalizedStatus = normalizeApplicationStatus(app.status);
        return normalizedStatus === statusFilter;
      });
    }

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "match":
          return (b.relevanceScore || 0) - (a.relevanceScore || 0);
        case "date":
          return new Date(b.appliedAt || b.createdAt || 0) - new Date(a.appliedAt || a.createdAt || 0);
        case "name":
          const nameA = (a.applicant?.name || "").toLowerCase();
          const nameB = (b.applicant?.name || "").toLowerCase();
          return nameA.localeCompare(nameB);
        default:
          return 0;
      }
    });

    return sorted;
  }, [rankedApplicants, statusFilter, sortBy]);

  // Counts per status for the funnel/filter segments (from the full list, so
  // the numbers don't move when a filter is applied).
  const funnelCounts = useMemo(() => {
    const c = { all: rankedApplicants.length, pending: 0, shortlisted: 0, hired: 0, rejected: 0 };
    rankedApplicants.forEach((a) => {
      const s = normalizeApplicationStatus(a.status);
      if (c[s] !== undefined) c[s] += 1;
    });
    return c;
  }, [rankedApplicants]);

  const applicantsTotalPages = Math.max(1, Math.ceil(filteredAndSortedApplicants.length / APPLICANTS_PAGE_SIZE));
  const paginatedApplicants = useMemo(() => {
    const start = (applicantsPage - 1) * APPLICANTS_PAGE_SIZE;
    return filteredAndSortedApplicants.slice(start, start + APPLICANTS_PAGE_SIZE);
  }, [filteredAndSortedApplicants, applicantsPage]);

  useEffect(() => {
    setApplicantsPage(1);
  }, [selectedJobId, statusFilter, sortBy]);

  useEffect(() => {
    if (applicantsPage > applicantsTotalPages) setApplicantsPage(applicantsTotalPages);
  }, [applicantsTotalPages, applicantsPage]);

  const modalSections = [
    { id: "details", label: "Job Details", icon: <FaClipboardList /> },
    { id: "logistics", label: "Logistics", icon: <FaCoins /> },
    { id: "requirements", label: "Requirements", icon: <FaListUl /> },
  ];

  // Two-tier overview: the numbers that drive action are hero tiles; the rest
  // are a quiet context strip.
  const heroStats = [
    {
      key: "pending",
      icon: "⏳",
      label: "Pending review",
      value: stats.pendingReview || 0,
      tone: "amber",
      action:
        (stats.pendingReview || 0) > 0
          ? { label: `Review ${stats.pendingReview} applicant${stats.pendingReview === 1 ? "" : "s"} →`, tab: "applicants" }
          : null,
    },
    {
      key: "active",
      icon: "✅",
      label: "Active jobs",
      value: stats.activeJobs || 0,
      tone: "green",
      action: { label: "Manage postings →", tab: "jobs" },
    },
  ];
  const contextStats = [
    { label: "Total jobs", value: stats.totalJobs || 0 },
    { label: "Total applicants", value: stats.totalApplicants || 0 },
    { label: "Shortlisted", value: stats.shortlisted || 0 },
    { label: "Hired", value: stats.hired || 0 },
  ];

  const tabMeta = {
    overview: { label: "Overview", badge: null },
    jobs: { label: "Job Postings", badge: liveJobs.length || null },
    applicants: { label: "Applicants", badge: stats.totalApplicants || null },
    archived: { label: "Archived", badge: archivedJobs.length || null },
  };

  const openSwipe = (id) => setOpenSwipeId(id);
  const closeSwipe = () => setOpenSwipeId(null);
  const toggleArchivedJobDetails = (jobId) => {
    setExpandedArchivedJobs((prev) => ({
      ...prev,
      [jobId]: !prev[jobId],
    }));
  };

  return (
    <div className="dashboard-container employer-dashboard-page">
      {/* Verification Modal */}
      {showVerificationModal && (
        <div className="modal-overlay" onClick={() => setShowVerificationModal(false)}>
          <div className="verification-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Verification Required</h3>
            <p>
              {user?.verificationStatus === "pending"
                ? "Your documents are under review by LMD Admin. You'll be notified and messaged with the result."
                : user?.verificationStatus === "rejected"
                ? `Your last submission was not approved${user?.verificationNote ? `: ${user.verificationNote}` : "."}. Update your documents in your profile and submit them again.`
                : "Your employer account is not yet verified. Please go to your profile, upload your business permit / registration documents, and submit them for admin review."}
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
      <div className="dashboard-header emp-header">
        <div className="emp-header-id">
          <div className="emp-header-avatar">{getInitials(user?.companyName || user?.name || "EM")}</div>
          <div className="emp-header-text">
            <h1>{user?.companyName || user?.name || "Employer Dashboard"}</h1>
            <span className="emp-header-role">Employer workspace</span>
          </div>
        </div>
        <button type="button" className="emp-header-cta" onClick={openCreateJobModal}>
          + Post Vacancy
        </button>
      </div>

      <section className="employer-shell">
        <div className="employer-tabs emp-segmented" role="tablist" aria-label="Employer dashboard tabs">
          {tabList.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={`employer-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
              aria-selected={activeTab === tab}
            >
              {tabMeta[tab].label}
              {tabMeta[tab].badge ? <span className="emp-tab-badge">{tabMeta[tab].badge}</span> : null}
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
                <div className="emp-hero-row">
                  {heroStats.map((card) => (
                    <article key={card.key} className={`emp-hero-tile tone-${card.tone}`}>
                      <span className="emp-hero-icon" aria-hidden="true">{card.icon}</span>
                      <span className="emp-hero-value">{card.value}</span>
                      <span className="emp-hero-label">{card.label}</span>
                      {card.action ? (
                        <button
                          type="button"
                          className="emp-hero-action"
                          onClick={() => setActiveTab(card.action.tab)}
                        >
                          {card.action.label}
                        </button>
                      ) : (
                        <span className="emp-hero-action muted">All caught up</span>
                      )}
                    </article>
                  ))}
                </div>

                <div className="emp-context-strip">
                  {contextStats.map((s) => (
                    <div key={s.label} className="emp-context-item">
                      <span className="emp-context-value">{s.value}</span>
                      <span className="emp-context-label">{s.label}</span>
                    </div>
                  ))}
                </div>

                <div className="table-card">
                  <div className="table-card-header">
                    <h2>Recent Applicants</h2>
                    {recentApplicants.length > 0 && (
                      <button type="button" className="emp-link-btn" onClick={() => setActiveTab("applicants")}>
                        View all
                      </button>
                    )}
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
                                <tr key={application._id} className="applicant-row-enhanced">
                                  <td className="applicant-name-cell">
                                    <div className="applicant-avatar-name">
                                      <div className="applicant-avatar">{getInitials(application.applicant?.name)}</div>
                                      <span className="applicant-name">{application.applicant?.name || "Unknown Applicant"}</span>
                                    </div>
                                  </td>
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
                <div className="panel-header-row emp-panel-head">
                  <h2>My Job Postings</h2>
                  <div className="emp-panel-tools">
                    <div className="emp-search">
                      <FaSearch />
                      <input
                        type="text"
                        placeholder="Search postings..."
                        value={jobSearch}
                        onChange={(e) => setJobSearch(e.target.value)}
                      />
                      {jobSearch && (
                        <button type="button" onClick={() => setJobSearch("")} aria-label="Clear search">×</button>
                      )}
                    </div>
                    <select
                      className="emp-select"
                      value={jobSort}
                      onChange={(e) => setJobSort(e.target.value)}
                      aria-label="Sort job postings"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="applicants">Most applicants</option>
                      <option value="new">Most new applicants</option>
                    </select>
                    <button type="button" className="green-btn" onClick={openCreateJobModal}>
                      + Post New Job
                    </button>
                  </div>
                </div>

                {!paginatedJobs.length ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <p className="empty-state-text">
                      {jobSearch ? "No postings match your search." : "You have no active job postings yet."}
                    </p>
                  </div>
                ) : isMobile ? (
                  <div className="swipeable-job-list">
                    {paginatedJobs.map((job) => (
                      <SwipeableJobCard
                        key={job._id}
                        job={job}
                        isOpen={openSwipeId === job._id}
                        onOpen={() => openSwipe(job._id)}
                        onClose={closeSwipe}
                        formatDate={formatDate}
                        isVerifiedEmployer={isVerifiedEmployer}
                        setShowVerificationModal={setShowVerificationModal}
                        setActiveTab={setActiveTab}
                        setSelectedJobId={setSelectedJobId}
                        openEditJobModal={openEditJobModal}
                        handleCloseOrReopen={handleCloseOrReopen}
                        handleArchiveJob={handleArchiveJob}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="emp-table-wrap">
                    <table className="emp-table jobs-table">
                      <colgroup>
                        <col />
                        <col style={{ width: "104px" }} />
                        <col style={{ width: "104px" }} />
                        <col style={{ width: "150px" }} />
                        <col style={{ width: "132px" }} />
                        <col style={{ width: "56px" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Job</th>
                          <th className="num">Applicants</th>
                          <th className="num">New</th>
                          <th>Posted</th>
                          <th>Status</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedJobs.map((job) => {
                          const f = funnelFor(job._id);
                          const dLeft = daysUntilDeadline(job.applicationDeadline);
                          const filled = job.slots ? f.hired >= job.slots : false;
                          const isClosed = String(job.status || "active").toLowerCase() === "closed";
                          const statusLabel = isClosed ? "closed" : filled ? "filled" : (job.status || "active");
                          const statusPillClass = isClosed ? "red" : filled ? "blue" : statusClass(job.status || "active");
                          return (
                            <tr
                              key={job._id}
                              className={`emp-row ${f.total === 0 ? "is-quiet" : ""}`}
                              onClick={() => {
                                if (!isVerifiedEmployer) { setShowVerificationModal(true); return; }
                                setSelectedJobId(job._id);
                                setActiveTab("applicants");
                              }}
                            >
                              <td>
                                <div className="emp-job-cell">
                                  <strong>{job.title}</strong>
                                  <span className="emp-job-loc">
                                    <FaMapMarkerAlt /> {formatJobLocation(job.location)}
                                  </span>
                                </div>
                              </td>
                              <td className="num">{f.total}</td>
                              <td className="num">
                                {f.new > 0 ? <span className="emp-new-pill">{f.new} new</span> : <span className="emp-dash">—</span>}
                              </td>
                              <td>
                                <div className="emp-stack">
                                  <span>{formatDate(job.createdAt)}</span>
                                  <span className="emp-muted">{relativeAge(job.createdAt)}</span>
                                </div>
                              </td>
                              <td>
                                <div className="emp-status-cell">
                                  <span className={`status-pill ${statusPillClass}`}>{statusLabel}</span>
                                  {!isClosed && !filled && dLeft !== null && dLeft >= 0 && dLeft <= 3 && (
                                    <span className="emp-chip chip-amber">
                                      {dLeft === 0 ? "Closes today" : `Closes in ${dLeft}d`}
                                    </span>
                                  )}
                                </div>
                                {job.slots ? (
                                  <div className="emp-slot-line">
                                    {f.hired} of {job.slots} slot{job.slots === 1 ? "" : "s"} filled
                                  </div>
                                ) : null}
                              </td>
                              <td className="emp-actions-cell" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="emp-menu-trigger"
                                  aria-label={`Actions for ${job.title}`}
                                  aria-haspopup="true"
                                  aria-expanded={openJobMenuId === job._id}
                                  onClick={(e) => {
                                    if (openJobMenuId === job._id) { setOpenJobMenuId(null); return; }
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setJobMenuPos({ top: r.bottom + 6, left: Math.max(8, r.right - 212) });
                                    setOpenJobMenuId(job._id);
                                  }}
                                >
                                  ⋯
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {openJobMenuId && (() => {
                  const menuJob = paginatedJobs.find((j) => j._id === openJobMenuId);
                  if (!menuJob) return null;
                  return (
                    <>
                      <div className="emp-menu-backdrop" onClick={() => setOpenJobMenuId(null)} />
                      <div className="emp-menu emp-menu-floating" role="menu" style={{ top: jobMenuPos.top, left: jobMenuPos.left }}>
                        <button type="button" role="menuitem" onClick={() => { setOpenJobMenuId(null); openEditJobModal(menuJob); }}>
                          <FaEdit /> Edit posting
                        </button>
                        <button type="button" role="menuitem" onClick={() => { setOpenJobMenuId(null); setSelectedJobId(menuJob._id); setActiveTab("applicants"); }}>
                          <FaUsers /> View applicants
                        </button>
                        <div className="emp-menu-sep" role="separator" />
                        <button
                          type="button"
                          role="menuitem"
                          className={menuJob.status === "closed" ? "reopen" : "warn"}
                          onClick={() => { setOpenJobMenuId(null); handleCloseOrReopen(menuJob); }}
                        >
                          {menuJob.status === "closed" ? <><FaRedo /> Reopen posting</> : <><FaBan /> Close posting</>}
                        </button>
                        <div className="emp-menu-sep" role="separator" />
                        <button type="button" role="menuitem" className="danger" onClick={() => { setOpenJobMenuId(null); setJobToDelete(menuJob); }}>
                          <FaTrashAlt /> Delete
                        </button>
                      </div>
                    </>
                  );
                })()}

                {visibleJobs.length > jobsPageSize && (
                  <div className="pagination-controls employer-pagination-controls" role="navigation" aria-label="Job postings pagination">
                    <div className="pagination-info pagination-summary">
                      Showing {Math.min((jobsPage - 1) * jobsPageSize + 1, visibleJobs.length)}-
                      {Math.min(jobsPage * jobsPageSize, visibleJobs.length)} of {visibleJobs.length} job postings
                    </div>
                    <div className="pagination-actions">
                      <button
                        type="button"
                        className="pagination-btn employer-pagination-btn"
                        onClick={() => setJobsPage((page) => Math.max(1, page - 1))}
                        disabled={jobsPage === 1}
                      >
                        ← Previous
                      </button>
                      <div className="pagination-info">
                        Page {jobsPage} of {jobsTotalPages}
                      </div>
                      <button
                        type="button"
                        className="pagination-btn employer-pagination-btn"
                        onClick={() => setJobsPage((page) => Math.min(jobsTotalPages, page + 1))}
                        disabled={jobsPage >= jobsTotalPages}
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* -------- ARCHIVED JOBS TAB -------- */}
            {activeTab === "archived" && (
              <div className="employer-tab-panel archived-jobs-layout">
                <div className="emp-archived-summary">
                  <div className="emp-sum-tile">
                    <span className="emp-sum-value">{archivedJobs.length}</span>
                    <span className="emp-sum-label">Archived jobs</span>
                  </div>
                  <div className="emp-sum-tile">
                    <span className="emp-sum-value">
                      {archivedJobs.reduce((sum, job) => sum + Number(job.archivedMetrics?.totalApplicants || job.applicationCount || 0), 0)}
                    </span>
                    <span className="emp-sum-label">Total applicants</span>
                  </div>
                  <div className="emp-sum-tile">
                    <span className="emp-sum-value">
                      {archivedJobs.length ? (archivedJobs.reduce((sum, job) => sum + Number(job.archivedMetrics?.daysActive || 0), 0) / archivedJobs.length).toFixed(1) : "0.0"}
                    </span>
                    <span className="emp-sum-label">Avg. days active</span>
                  </div>
                  <div className="emp-sum-tile is-primary">
                    <span className="emp-sum-value">
                      {archivedJobs.reduce((sum, job) => sum + Number(job.archivedMetrics?.hiredCount || 0), 0)}
                    </span>
                    <span className="emp-sum-label">Hired candidates</span>
                  </div>
                </div>

                <div className="archived-search-bar">
                  <FaSearch className="archived-search-icon" />
                  <input
                    type="text"
                    className="archived-search-input"
                    placeholder="Search archived jobs by title or location..."
                    value={archivedSearch}
                    onChange={(event) => setArchivedSearch(event.target.value)}
                  />
                  {archivedSearch ? (
                    <button
                      type="button"
                      className="archived-search-clear"
                      onClick={() => setArchivedSearch("")}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  ) : null}
                </div>

                {filteredArchivedJobs.length ? (
                  <div className="archived-results-row">
                    Showing {(archivedPage - 1) * ARCHIVED_PAGE_SIZE + 1}–{Math.min(archivedPage * ARCHIVED_PAGE_SIZE, filteredArchivedJobs.length)} of {filteredArchivedJobs.length} archived job{filteredArchivedJobs.length !== 1 ? "s" : ""}
                  </div>
                ) : null}

                {!paginatedArchivedJobs.length ? (
                  <div className="empty-state archived-empty-state">
                    <div className="empty-state-icon">🗂️</div>
                    <p className="empty-state-text">
                      {archivedJobs.length ? "No archived jobs match your search." : "No archived jobs yet."}
                    </p>
                  </div>
                ) : isMobile ? (
                  <div className="emp-archived-cards">
                    {paginatedArchivedJobs.map((job) => {
                      const isExpanded = !!expandedArchivedJobs[job._id];
                      const m = job.archivedMetrics || {};
                      return (
                        <article key={job._id} className="emp-archived-card">
                          <button
                            type="button"
                            className="emp-archived-card-head"
                            aria-expanded={isExpanded}
                            onClick={() => toggleArchivedJobDetails(job._id)}
                          >
                            <span className="emp-archived-card-title">
                              <strong>{job.title}</strong>
                              <span className="emp-job-loc"><FaMapMarkerAlt /> {formatJobLocation(job.location)}</span>
                            </span>
                            <span className={`emp-caret ${isExpanded ? "open" : ""}`}>›</span>
                          </button>
                          <div className="emp-archived-card-stats">
                            <span>{m.totalApplicants ?? job.applicationCount ?? 0} applicants</span>
                            <span>{m.hiredCount ?? 0} hired</span>
                            <span>{m.daysActive ?? 0}d</span>
                            {job.archiveReason && <span className="emp-chip">{archiveReasonLabel(job.archiveReason)}</span>}
                          </div>
                          {isExpanded && <ArchivedPostMortem job={job} />}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="emp-table-wrap">
                    <table className="emp-table archived-table">
                      <colgroup>
                        <col />
                        <col style={{ width: "104px" }} />
                        <col style={{ width: "96px" }} />
                        <col style={{ width: "80px" }} />
                        <col style={{ width: "80px" }} />
                        <col style={{ width: "170px" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Job</th>
                          <th className="num">Applicants</th>
                          <th className="num">Qualified</th>
                          <th className="num">Hired</th>
                          <th className="num">Days</th>
                          <th>Closed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedArchivedJobs.map((job) => {
                          const isExpanded = !!expandedArchivedJobs[job._id];
                          const m = job.archivedMetrics || {};
                          return (
                            <Fragment key={job._id}>
                              <tr
                                className={`emp-row emp-row-toggle ${isExpanded ? "is-open" : ""}`}
                                onClick={() => toggleArchivedJobDetails(job._id)}
                              >
                                <td>
                                  <div className="emp-job-cell">
                                    <strong>
                                      <span className={`emp-caret ${isExpanded ? "open" : ""}`}>›</span> {job.title}
                                    </strong>
                                    <span className="emp-job-loc">
                                      <FaMapMarkerAlt /> {formatJobLocation(job.location)}
                                    </span>
                                  </div>
                                </td>
                                <td className="num">{m.totalApplicants ?? job.applicationCount ?? 0}</td>
                                <td className="num">{m.qualifiedCount ?? 0}</td>
                                <td className="num">{m.hiredCount ?? 0}</td>
                                <td className="num">{m.daysActive ?? 0}</td>
                                <td>
                                  <div className="emp-stack">
                                    <span>{formatDate(job.closedAt || job.archivedAt || m.archivedAt)}</span>
                                    {job.archiveReason && (
                                      <span className="emp-chip">{archiveReasonLabel(job.archiveReason)}</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="emp-detail-row">
                                  <td colSpan={6}>
                                    <ArchivedPostMortem job={job} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {filteredArchivedJobs.length > 0 ? (
                  <nav className="dash-pagination" aria-label="Archived jobs pagination">
                    <button
                      type="button"
                      className="dash-page-btn"
                      onClick={() => setArchivedPage((p) => Math.max(1, p - 1))}
                      disabled={archivedPage === 1}
                      aria-label="Previous page"
                    >
                      <FaChevronLeft />
                    </button>

                    <div className="dash-page-numbers">
                      {Array.from({ length: archivedTotalPages }, (_, i) => i + 1)
                        .filter((page) => page === 1 || page === archivedTotalPages || Math.abs(page - archivedPage) <= 1)
                        .reduce((acc, page, idx, arr) => {
                          if (idx > 0 && page - arr[idx - 1] > 1) acc.push("ellipsis-" + page);
                          acc.push(page);
                          return acc;
                        }, [])
                        .map((page) =>
                          typeof page === "string" ? (
                            <span key={page} className="dash-page-ellipsis">…</span>
                          ) : (
                            <button
                              type="button"
                              key={page}
                              className={`dash-page-btn ${page === archivedPage ? "active" : ""}`}
                              onClick={() => setArchivedPage(page)}
                              aria-current={page === archivedPage ? "page" : undefined}
                            >
                              {page}
                            </button>
                          )
                        )}
                    </div>

                    <button
                      type="button"
                      className="dash-page-btn"
                      onClick={() => setArchivedPage((p) => Math.min(archivedTotalPages, p + 1))}
                      disabled={archivedPage === archivedTotalPages}
                      aria-label="Next page"
                    >
                      <FaChevronRight />
                    </button>
                  </nav>
                ) : null}
              </div>
            )}

            {/* -------- APPLICANTS TAB -------- */}
            {activeTab === "applicants" && (
              <div className="employer-tab-panel applicants-layout">
                <aside className={`job-list-panel emp-job-rail ${railJobs.length > RAIL_CHIP_LIMIT ? "is-picker" : ""}`}>
                  {!railJobs.length ? (
                    <>
                      <h3>Your Jobs</h3>
                      <p className="empty-muted">No active jobs yet.</p>
                    </>
                  ) : railJobs.length > RAIL_CHIP_LIMIT ? (
                    <div className="emp-job-picker">
                      <label className="emp-job-picker-field">
                        <span className="emp-job-picker-caption">Job</span>
                        <select
                          value={selectedJobId || ""}
                          onChange={(e) => setSelectedJobId(e.target.value)}
                          className="emp-select"
                          aria-label="Select a job to view applicants"
                        >
                          {railJobs.map((job) => {
                            const f = funnelFor(job._id);
                            return (
                              <option key={job._id} value={job._id}>
                                {job.title} — {f.total} applicant{f.total === 1 ? "" : "s"}
                                {f.new > 0 ? ` · ${f.new} new` : ""}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <div className="emp-job-picker-nav">
                        <button type="button" onClick={() => stepSelectedJob(-1)} aria-label="Previous job">‹</button>
                        <button type="button" onClick={() => stepSelectedJob(1)} aria-label="Next job">›</button>
                      </div>
                      {selectedJob && (() => {
                        const f = funnelFor(selectedJob._id);
                        return (
                          <span className="emp-job-picker-funnel">
                            {f.new > 0 && <span className="emp-rail-dot">{f.new} new</span>}
                            <span>{f.total} total</span>
                            <span>·</span>
                            <span>{f.shortlisted} shortlisted</span>
                            <span>·</span>
                            <span>{f.hired} hired</span>
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    <>
                      <h3>Your Jobs</h3>
                      {railJobs.map((job) => {
                        const f = funnelFor(job._id);
                        return (
                          <button
                            type="button"
                            key={job._id}
                            className={`job-list-item emp-rail-item ${selectedJobId === job._id ? "active" : ""}`}
                            onClick={() => setSelectedJobId(job._id)}
                          >
                            <span className="emp-rail-top">
                              <strong>{job.title}</strong>
                              {f.new > 0 && <span className="emp-rail-dot" title={`${f.new} new`}>{f.new}</span>}
                            </span>
                            <small className="job-location-text">
                              <FaMapMarkerAlt />
                              <span>{formatJobLocation(job.location)}</span>
                            </small>
                            <span className="emp-rail-funnel">
                              {f.total} applicant{f.total === 1 ? "" : "s"}
                              {f.shortlisted > 0 && <> · {f.shortlisted} shortlisted</>}
                              {f.hired > 0 && <> · {f.hired} hired</>}
                            </span>
                          </button>
                        );
                      })}
                    </>
                  )}
                </aside>

                <section className="applicants-panel">
                  <div className="emp-appbar">
                    <div className="emp-appbar-title">
                      <h2>{selectedJob ? selectedJob.title : "Applicants"}</h2>
                      {selectedJob && (
                        <span className="emp-appbar-sub">
                          {filteredAndSortedApplicants.length} of {rankedApplicants.length} shown
                        </span>
                      )}
                    </div>

                    {selectedJob && (
                      <div className="emp-funnel" role="tablist" aria-label="Filter by status">
                        {[
                          { key: "all", label: "All" },
                          { key: "pending", label: "Pending" },
                          { key: "shortlisted", label: "Shortlisted" },
                          { key: "hired", label: "Hired" },
                          { key: "rejected", label: "Rejected" },
                        ].map((seg) => (
                          <button
                            key={seg.key}
                            type="button"
                            role="tab"
                            aria-selected={statusFilter === seg.key}
                            className={`emp-funnel-seg seg-${seg.key} ${statusFilter === seg.key ? "active" : ""}`}
                            onClick={() => setStatusFilter(seg.key)}
                          >
                            <span className="emp-funnel-count">{funnelCounts[seg.key] ?? 0}</span>
                            <span className="emp-funnel-label">{seg.label}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedJob && (
                      <label className="emp-sort">
                        <span>Sort</span>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="emp-select">
                          <option value="match">Best match</option>
                          <option value="date">Newest</option>
                          <option value="name">Name A–Z</option>
                        </select>
                      </label>
                    )}
                  </div>

                  {selectedJobId && selectedApplicants.length > 0 && (
                    <div className="bulk-actions-bar">
                      <span className="selected-count">
                        {selectedApplicants.length} applicant{selectedApplicants.length !== 1 ? 's' : ''} selected
                      </span>
                      <div className="bulk-action-buttons">
                        <button
                          type="button"
                          className="bulk-action-btn bulk-shortlist"
                          onClick={() => handleBulkAction('shortlisted')}
                          disabled={isBulkUpdating}
                        >
                          {isBulkUpdating ? 'Processing...' : 'Shortlist'}
                        </button>
                        <button
                          type="button"
                          className="bulk-action-btn bulk-reject"
                          onClick={() => handleBulkAction('rejected')}
                          disabled={isBulkUpdating}
                        >
                          {isBulkUpdating ? 'Processing...' : 'Reject'}
                        </button>
                        <button
                          type="button"
                          className="bulk-action-btn bulk-clear"
                          onClick={() => setSelectedApplicants([])}
                          disabled={isBulkUpdating}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {!selectedJobId ? (
                    <div className="empty-state">
                      <div className="empty-state-icon">📁</div>
                      <p className="empty-state-text">Select a job to view applicants.</p>
                    </div>
                  ) : (
                    <RankedApplicantsTable
                      applicants={paginatedApplicants}
                      onViewApplicant={openApplicantDrawer}
                      onMessageApplicant={handleMessageApplicant}
                      onViewProfile={(applicantId) => navigate(`/employer/applicants/${applicantId}`)}
                      loading={loadingRanked}
                      selectedApplicants={selectedApplicants}
                      onSelectApplicant={handleSelectApplicant}
                      onSelectAll={(checked, visibleApplicants) => {
                        if (checked) {
                          const visibleIds = (visibleApplicants || []).map((app) => app._id);
                          setSelectedApplicants((prev) => {
                            const nextIds = new Set(prev);
                            visibleIds.forEach((id) => nextIds.add(id));
                            return Array.from(nextIds);
                          });
                        } else {
                          const visibleIds = new Set((visibleApplicants || []).map((app) => app._id));
                          setSelectedApplicants((prev) => prev.filter((id) => !visibleIds.has(id)));
                        }
                      }}
                      onQuickStatusChange={handleQuickStatusChange}
                      emptyStateMessage={statusFilter === "all" ? "No applicants for this job yet." : `No ${statusFilter} applicants found.`}
                      emptyStateIcon={statusFilter === "all" ? "👥" : "🔍"}
                    />
                  )}

                  {selectedJobId && filteredAndSortedApplicants.length > 0 ? (
                    <nav className="dash-pagination" aria-label="Applicants pagination">
                      <button
                        type="button"
                        className="dash-page-btn"
                        onClick={() => setApplicantsPage((p) => Math.max(1, p - 1))}
                        disabled={applicantsPage === 1}
                        aria-label="Previous page"
                      >
                        <FaChevronLeft />
                      </button>

                      <div className="dash-page-numbers">
                        {Array.from({ length: applicantsTotalPages }, (_, i) => i + 1)
                          .filter((page) => page === 1 || page === applicantsTotalPages || Math.abs(page - applicantsPage) <= 1)
                          .reduce((acc, page, idx, arr) => {
                            if (idx > 0 && page - arr[idx - 1] > 1) acc.push("ellipsis-" + page);
                            acc.push(page);
                            return acc;
                          }, [])
                          .map((page) =>
                            typeof page === "string" ? (
                              <span key={page} className="dash-page-ellipsis">…</span>
                            ) : (
                              <button
                                type="button"
                                key={page}
                                className={`dash-page-btn ${page === applicantsPage ? "active" : ""}`}
                                onClick={() => setApplicantsPage(page)}
                                aria-current={page === applicantsPage ? "page" : undefined}
                              >
                                {page}
                              </button>
                            )
                          )}
                      </div>

                      <button
                        type="button"
                        className="dash-page-btn"
                        onClick={() => setApplicantsPage((p) => Math.min(applicantsTotalPages, p + 1))}
                        disabled={applicantsPage === applicantsTotalPages}
                        aria-label="Next page"
                      >
                        <FaChevronRight />
                      </button>
                    </nav>
                  ) : null}
                </section>
              </div>
            )}
          </>
        )}
      </section>

      {rejectDialog && (
        <div className="modal-overlay" onClick={() => setRejectDialog(null)}>
          <div className="verification-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Confirm Rejection</h3>
            <p>
              {rejectDialog.kind === "bulk"
                ? `Are you sure you want to reject ${rejectDialog.applicantName}? This will mark all selected applicants as rejected.`
                : `Are you sure you want to reject ${rejectDialog.applicantName}? This action will notify the applicant and update their status to rejected.`}
            </p>
            <div className="verification-modal-actions">
              <button
                className="green-btn"
                style={{ background: "#dc2626" }}
                onClick={confirmRejectDialog}
              >
                Confirm Reject
              </button>
              <button className="outline-btn" onClick={() => setRejectDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== APPLICANT DETAIL - CENTER MODAL ===== */}
      {selectedApplication && (
        <div className="modal-overlay" onClick={() => setSelectedApplication(null)}>
          <div className="applicant-detail-modal" onClick={(event) => event.stopPropagation()}>
            <header className="applicant-modal-header">
              <div className="applicant-modal-avatar">
                {getInitials(selectedApplication.applicant?.name)}
              </div>
              <div className="applicant-modal-title">
                <h3>{selectedApplication.applicant?.name || "N/A"}</h3>
                <p>{selectedApplication.vacancy?.title || "Applied Position"}</p>
              </div>
              <button
                type="button"
                className="applicant-modal-close"
                onClick={() => setSelectedApplication(null)}
                aria-label="Close details"
              >
                ×
              </button>
            </header>

            <div className="applicant-modal-body">
              {/* Left Column */}
              <div className="applicant-info-section">
                <h4>Applicant Info</h4>
                <div className="applicant-info-row">
                  <span className="applicant-info-label">Full Name</span>
                  <span className="applicant-info-value">
                    {selectedApplication.applicant?.name || "N/A"}
                  </span>
                </div>
                <div className="applicant-info-row">
                  <span className="applicant-info-label">Email</span>
                  <span className="applicant-info-value">
                    {selectedApplication.applicant?.email || "N/A"}
                  </span>
                </div>
                <div className="applicant-info-row">
                  <span className="applicant-info-label">Phone</span>
                  <span className="applicant-info-value">
                    {selectedApplication.applicant?.phone || "N/A"}
                  </span>
                </div>
                <div className="applicant-info-row">
                  <span className="applicant-info-label">Address</span>
                  <span className="applicant-info-value">
                    {selectedApplication.applicant?.address || "N/A"}
                  </span>
                </div>
                <div className="applicant-info-row">
                  <span className="applicant-info-label">Applied On</span>
                  <span className="applicant-info-value">
                    {formatDate(selectedApplication.createdAt || selectedApplication.appliedAt)}
                  </span>
                </div>

                <h4 style={{ marginTop: 12 }}>Skills</h4>
                <div className="applicant-skills-section">
                  {selectedApplication.applicant?.skills?.length ? (
                    selectedApplication.applicant.skills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))
                  ) : (
                    <span className="skill-empty">No skills listed</span>
                  )}
                </div>

                {selectedApplication.resume && (
                  <SecureFileLink className="applicant-resume-link" value={selectedApplication.resume}>
                    <span>↓</span>
                    <span>Download Resume</span>
                  </SecureFileLink>
                )}
              </div>

              {/* Right Column */}
              <div className="applicant-info-section">
                <h4>Application Status</h4>
                <div className="applicant-modal-field">
                  <label>Current Status</label>
                  <select
                    className={`status-${drawerStatus}`}
                    value={drawerStatus}
                    onChange={(event) => setDrawerStatus(event.target.value)}
                    disabled={isSavingApplication}
                  >
                    <option value="pending">Pending</option>
                    <option value="shortlisted">Shortlisted</option>
                    <option value="hired">Hired</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <div className="applicant-modal-field">
                  <label>Note to Applicant</label>
                  <textarea
                    rows="5"
                    value={drawerNote}
                    onChange={(event) => setDrawerNote(event.target.value)}
                    placeholder="Add a quick status note or feedback…"
                    disabled={isSavingApplication}
                  />
                </div>
              </div>
            </div>

            <footer className="applicant-modal-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setSelectedApplication(null)}
                disabled={isSavingApplication}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-save"
                onClick={handleSaveApplicationStatus}
                disabled={isSavingApplication}
              >
                {isSavingApplication ? "Saving..." : "Save & Notify"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ===== JOB FORM MODAL ===== */}
      {isJobModalOpen && (
        <div className="modal-overlay" onClick={() => { if (!isSavingJob) setIsJobModalOpen(false); }}>
          <div className="job-form-modal" onClick={(e) => e.stopPropagation()}>
            <header className="job-form-modal-header">
              <div className="job-form-modal-title">
                <FaBriefcase />
                <h2>{editingJob ? "Edit Job Posting" : "Post a New Job"}</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => { if (!isSavingJob) setIsJobModalOpen(false); }}
                aria-label="Close modal"
              >
                ×
              </button>
            </header>

            <div className="job-form-content">
              <aside className="job-form-sidebar">
                <div className="job-form-sidebar-card">
                  <h3><FaListUl /> Progress</h3>
                  <nav className="job-form-progress-nav">
                    {modalSections.map((sec) => (
                      <button
                        key={sec.id}
                        type="button"
                        className={`job-form-progress-item ${modalActiveSection === sec.id ? "active" : ""}`}
                        onClick={() => {
                          setModalActiveSection(sec.id);
                          document.getElementById(`modal-section-${sec.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        <span className="job-form-progress-icon">{sec.icon}</span>
                        <span>{sec.label}</span>
                        {sec.id === "details" && jobForm.title && jobForm.description && (
                          <span className="job-form-progress-check">✓</span>
                        )}
                        {sec.id === "logistics" && jobForm.location && (
                          <span className="job-form-progress-check">✓</span>
                        )}
                        {sec.id === "requirements" && jobForm.qualifications?.length > 0 && (
                          <span className="job-form-progress-check">✓</span>
                        )}
                      </button>
                    ))}
                  </nav>
                </div>
                <div className="job-form-sidebar-card job-form-preview-card">
                  <h3><FaBuilding /> Live Preview</h3>
                  <div className="job-form-preview-content">
                    <div className="job-form-preview-title">{jobForm.title || "Job Title"}</div>
                    <div className="job-form-preview-meta">
                      {jobForm.location ? (
                        <span><FaMapMarkerAlt /> {jobForm.location}</span>
                      ) : (
                        <span className="placeholder">Location</span>
                      )}
                      <span className="job-form-preview-dot">•</span>
                      <span>{jobForm.jobType}</span>
                    </div>
                    {(jobForm.salaryMin !== "" || jobForm.salaryMax !== "") && (
                      <div className="job-form-preview-salary">
                        <FaMoneyBillWave /> {formatSalaryPreview(jobForm.salaryMin, jobForm.salaryMax)}
                      </div>
                    )}
                    <div className="job-form-preview-slots">
                      <FaUsers /> {jobForm.slots} slot{jobForm.slots !== 1 ? "s" : ""} available
                    </div>
                    {jobForm.applicationDeadline && (
                      <div className="job-form-preview-deadline">
                        <FaClock /> Until {new Date(jobForm.applicationDeadline).toLocaleDateString()}
                      </div>
                    )}
                    <div className="job-form-preview-qual-count">
                      {jobForm.qualifications?.length || 0} requirement{(jobForm.qualifications?.length || 0) !== 1 ? "s" : ""} set
                    </div>
                  </div>
                </div>
              </aside>

              <main className="job-form-main">
                <form onSubmit={handleSaveJob} noValidate>
                  <section id="modal-section-details" className="job-form-section">
                    <div className="job-form-section-header">
                      <div className="job-form-section-icon"><FaClipboardList /></div>
                      <div>
                        <h3>Job Details</h3>
                        <p>Start with the basics about the role</p>
                      </div>
                    </div>

                    <div className="form-section form-field-full">
                      <label className="form-label">
                        Job Title <span className="pj-required">*</span>
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        value={jobForm.title}
                        onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })}
                        placeholder="e.g. Senior Frontend Developer"
                        disabled={isSavingJob}
                        required
                        maxLength={100}
                      />
                      <div className="form-field-footer">
                        <span />
                        <span className={`form-char-count ${jobForm.title.length > 70 ? "warning" : jobForm.title.length > 0 ? "success" : "muted"}`}>
                          {jobForm.title.length} / 100
                        </span>
                      </div>
                    </div>

                    <div className="form-section form-field-full" style={{ marginTop: '20px' }}>
                      <label className="form-label">
                        Job Description <span className="pj-required">*</span>
                      </label>
                      <textarea
                        className="form-textarea"
                        rows="8"
                        value={jobForm.description}
                        onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
                        placeholder="Describe the role, responsibilities, and what success looks like..."
                        disabled={isSavingJob}
                        required
                        maxLength={5000}
                      />
                      <div className="form-field-footer">
                        <span />
                        <span className={`form-char-count ${jobForm.description.length > 4000 ? "warning" : jobForm.description.length > 0 ? "success" : "muted"}`}>
                          {jobForm.description.length} / 5000
                        </span>
                      </div>
                    </div>
                  </section>

                  <section id="modal-section-logistics" className="job-form-section">
                    <div className="job-form-section-header">
                      <div className="job-form-section-icon"><FaCoins /></div>
                      <div>
                        <h3>Compensation & Logistics</h3>
                        <p>Where, how, and how much</p>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-section">
                        <label className="form-label">
                          <FaMapMarkerAlt /> Location <span className="pj-required">*</span>
                        </label>
                        <LocationSelect
                          value={jobForm.location}
                          onChange={(value) => setJobForm({ ...jobForm, location: value })}
                          disabled={isSavingJob}
                        />
                      </div>

                      <div className="form-section">
                        <label className="form-label">
                          <FaMoneyBillWave /> Salary Range (PHP) <span className="pj-optional">(Optional)</span>
                        </label>
                        <div className="pj-salary-range-row">
                          <input
                            type="number"
                            min="0"
                            className="form-input"
                            value={jobForm.salaryMin}
                            onChange={(e) => setJobForm({ ...jobForm, salaryMin: e.target.value })}
                            placeholder="Min, e.g. 18000"
                            disabled={isSavingJob}
                          />
                          <span className="pj-salary-range-sep">to</span>
                          <input
                            type="number"
                            min="0"
                            className="form-input"
                            value={jobForm.salaryMax}
                            onChange={(e) => setJobForm({ ...jobForm, salaryMax: e.target.value })}
                            placeholder="Max, e.g. 25000"
                            disabled={isSavingJob}
                          />
                        </div>
                        <span className="form-hint">Leave blank if negotiable.</span>
                      </div>

                      <div className="form-section">
                        <label className="form-label">
                          <FaBriefcase /> Job Type
                        </label>
                        <div className="form-select-wrapper">
                          <select
                            className="form-input"
                            value={jobForm.jobType}
                            onChange={(e) => setJobForm({ ...jobForm, jobType: e.target.value })}
                            disabled={isSavingJob}
                          >
                            <option>Full-time</option>
                            <option>Part-time</option>
                            <option>Contract</option>
                            <option>Internship</option>
                            <option>Temporary</option>
                            <option>Remote</option>
                          </select>
                        </div>
                      </div>

                      <div className="form-section">
                        <label className="form-label">
                          <FaUserPlus /> Slots <span className="pj-required">*</span>
                        </label>
                        <input
                          type="number"
                          className="form-input"
                          min="1"
                          max="100"
                          value={jobForm.slots}
                          onChange={(e) => setJobForm({ ...jobForm, slots: Math.max(1, parseInt(e.target.value) || 1) })}
                          disabled={isSavingJob}
                          required
                        />
                      </div>

                      <div className="form-section form-field-full">
                        <label className="form-label">
                          <FaCalendarAlt /> Deadline <span className="pj-optional">(Optional)</span>
                        </label>
                        <input
                          type="date"
                          className="form-input"
                          value={jobForm.applicationDeadline}
                          onChange={(e) => setJobForm({ ...jobForm, applicationDeadline: e.target.value })}
                          disabled={isSavingJob}
                          min={new Date().toISOString().split("T")[0]}
                        />
                        <span className="form-hint">Leave blank for no deadline</span>
                      </div>
                    </div>
                  </section>

                  <section id="modal-section-requirements" className="job-form-section">
                    <div className="job-form-section-header">
                      <div className="job-form-section-icon"><FaListUl /></div>
                      <div>
                        <h3>Requirements</h3>
                        <p>What candidates need to qualify</p>
                      </div>
                    </div>

                    <div className="form-section form-field-full">
                      <BasicRequirements
                        value={pickBasicRequirements(jobForm)}
                        onChange={(next) => setJobForm({ ...jobForm, ...next })}
                        disabled={isSavingJob}
                      />
                    </div>

                    <div className="form-section form-field-full">
                      <label className="form-label">
                        Qualifications <span className="pj-required">*</span>
                      </label>
                      <QualificationsEditor
                        value={jobForm.qualifications}
                        onChange={(quals) => setJobForm({ ...jobForm, qualifications: quals })}
                        disabled={isSavingJob}
                        templates={qualTemplates}
                        jobTitleHint={jobForm.title}
                        onSaveTemplate={handleSaveQualTemplate}
                      />
                    </div>
                  </section>
                </form>
              </main>
            </div>

            <div className="job-form-modal-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => { if (!isSavingJob) setIsJobModalOpen(false); }}
                disabled={isSavingJob}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-save"
                onClick={(e) => {
                  const form = e.target.closest('.job-form-modal').querySelector('form');
                  if (form) form.requestSubmit();
                }}
                disabled={isSavingJob}
              >
                {isSavingJob ? (
                  <>
                    <FaSpinner className="btn-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <FaSave /> {editingJob ? "Update Job" : "Post Job Vacancy"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {successToast && (
        <div className="success-toast" role="alert">{successToast}</div>
      )}
    </div>
  );
}