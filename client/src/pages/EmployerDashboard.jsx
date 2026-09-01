import { useEffect, useMemo, useRef, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { employerAPI, messageAPI } from "../services/api";
import "../styles/employer-dashboard.css";
import { API_URL } from "../services/api";
import { AuthContext } from "../context/AuthContext";
import phData from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";
import QualificationsEditor from "../components/QualificationsEditor";
import LocationSelect from "../components/LocationSelect";
import "../styles/qualifications-editor.css";
import RankedApplicantsTable from "../components/RankedApplicantsTable";
import { useRankedApplicants } from "../hooks/useRankedApplicants";
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

const phLocationEntries = Object.entries(phData).map(([code, regionData]) => ({
  code,
  region: regionData.region_name,
  provinces: Object.entries(regionData.province_list || {}).map(([provinceName, provinceData]) => ({
    name: provinceName,
    cities: Object.keys(provinceData.municipality_list || {}),
  })),
}));

const parseLocationValue = (value) => {
  if (!value) return { region: "", province: "", city: "" };

  const parts = String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return { region: "", province: "", city: "" };

  const regionNames = phLocationEntries.map((entry) => entry.region);
  const provinceNames = phLocationEntries.flatMap((entry) => entry.provinces.map((province) => province.name));

  const region = parts.find((part) =>
    regionNames.some((regionName) => regionName.toLowerCase() === part.toLowerCase())
  ) || parts[0] || "";

  const province = parts.find((part) =>
    provinceNames.some((provinceName) => provinceName.toLowerCase() === part.toLowerCase())
  ) || parts[1] || "";

  const city = parts.find((part) =>
    !regionNames.some((regionName) => regionName.toLowerCase() === part.toLowerCase()) &&
    !provinceNames.some((provinceName) => provinceName.toLowerCase() === part.toLowerCase())
  ) || parts[2] || "";

  return { region, province, city };
};

const LocationFilterSelector = ({ value, onChange }) => {
  const parsed = useMemo(() => parseLocationValue(value), [value]);
  const shellRef = useRef(null);
  const [isCompact, setIsCompact] = useState(() => window.innerWidth <= 768);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(parsed);

  useEffect(() => {
    setDraft(parsed);
  }, [parsed]);

  useEffect(() => {
    const measure = () => {
      const width = shellRef.current?.parentElement?.clientWidth ?? shellRef.current?.clientWidth ?? 0;
      setIsCompact(window.innerWidth <= 768 || width <= 540);
    };

    measure();
    window.addEventListener("resize", measure);

    const observer = new ResizeObserver(measure);
    if (shellRef.current) observer.observe(shellRef.current);

    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!modalOpen) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setModalOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalOpen]);

  const selectedRegion = draft.region
    ? phLocationEntries.find((entry) => entry.region === draft.region) || null
    : null;

  const provinceOptions = selectedRegion ? selectedRegion.provinces.map((province) => province.name) : [];
  const selectedProvinceObj = selectedRegion
    ? selectedRegion.provinces.find((province) => province.name === draft.province) || null
    : null;
  const cityOptions = selectedProvinceObj ? selectedProvinceObj.cities : [];

  const emit = (nextRegion, nextProvince, nextCity) => {
    const parts = [nextRegion, nextProvince, nextCity].filter(Boolean);
    onChange(parts.join(", "));
  };

  const handleRegionChange = (e) => {
    setRegionWarning("");
    const nextRegion = e.target.value;
    const nextDraft = { region: nextRegion, province: "", city: "" };
    setDraft(nextDraft);
    emit(nextRegion, "", "");
  };

  const [regionWarning, setRegionWarning] = useState("");

  useEffect(() => {
    if (!regionWarning) return;
    const timer = window.setTimeout(() => setRegionWarning(""), 2500);
    return () => window.clearTimeout(timer);
  }, [regionWarning]);

  const handleProvinceChange = (e) => {
    if (!draft.region) {
      setRegionWarning("Please select a region first.");
      return;
    }

    setRegionWarning("");
    const nextProvince = e.target.value;
    const nextDraft = { ...draft, province: nextProvince, city: "" };
    setDraft(nextDraft);
    emit(draft.region, nextProvince, "");
  };

  const handleCityChange = (e) => {
    if (!draft.region || !draft.province) {
      setRegionWarning("Please select a region and province first.");
      return;
    }

    setRegionWarning("");
    const nextCity = e.target.value;
    const nextDraft = { ...draft, city: nextCity };
    setDraft(nextDraft);
    emit(draft.region, draft.province, nextCity);
  };

  const handleApplyLocation = () => {
    emit(draft.region, draft.province, draft.city);
    setModalOpen(false);
  };

  const handleCancelLocation = () => {
    setDraft(parsed);
    setModalOpen(false);
  };

  const handleClearLocation = () => {
    const empty = { region: "", province: "", city: "" };
    setDraft(empty);
    onChange("");
    setModalOpen(false);
  };

  const triggerText = parsed.city
    ? `${parsed.city}, ${parsed.province}`
    : parsed.province
      ? parsed.province
      : parsed.region || "Select Location";

  return (
    <div ref={shellRef} className="location-filter-wrapper">
      {!isCompact ? (
        <div className="location-filter-selector location-desktop">
          <label>
            <span>Region</span>
            <select value={draft.region} onChange={handleRegionChange}>
              <option value="">Select region</option>
              {phLocationEntries.map((entry) => (
                <option key={entry.code} value={entry.region}>{entry.region}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Province</span>
            <select
              value={draft.province}
              onFocus={() => {
                if (!draft.region) {
                  setRegionWarning("Please select a region first.");
                }
              }}
              onChange={handleProvinceChange}
            >
              <option value="">Select province</option>
              {provinceOptions.map((province) => (
                <option key={province} value={province}>{province}</option>
              ))}
            </select>
          </label>

          <label>
            <span>City / Municipality</span>
            <select
              value={draft.city}
              onFocus={() => {
                if (!draft.region) {
                  setRegionWarning("Please select a region first.");
                } else if (!draft.province) {
                  setRegionWarning("Please select a region and province first.");
                }
              }}
              onChange={handleCityChange}
            >
              <option value="">Select city</option>
              {cityOptions.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </label>

          {regionWarning && (
            <div className="location-filter-warning-overlay" role="alert">
              <span className="location-filter-warning-icon" aria-hidden="true">!</span>
              <span>{regionWarning}</span>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="location-mobile-trigger"
          onClick={() => {
            setDraft(parsed);
            setModalOpen(true);
          }}
        >
          <span>{triggerText}</span>
          <span className="location-mobile-trigger-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path d="M12 2.5a7.5 7.5 0 0 1 7.5 7.5c0 5.7-7.5 12.5-7.5 12.5S4.5 15.7 4.5 10A7.5 7.5 0 0 1 12 2.5Zm0 3.25A4.25 4.25 0 1 0 12 14.25A4.25 4.25 0 0 0 12 5.75Z" fill="currentColor"/>
            </svg>
          </span>
        </button>
      )}

      {modalOpen && (
        <div className="location-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="location-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="location-modal-title">
            <div className="location-modal-header">
              <h4 id="location-modal-title">Select Location</h4>
              <button type="button" className="location-modal-close" onClick={() => setModalOpen(false)} aria-label="Close location selector">×</button>
            </div>

            <div className="location-modal-body">
              <label>
                <span>Region</span>
                <select value={draft.region} onChange={(e) => setDraft({ region: e.target.value, province: "", city: "" })}>
                  <option value="">Select region</option>
                  {phLocationEntries.map((entry) => (
                    <option key={entry.code} value={entry.region}>{entry.region}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Province</span>
                <select
                  value={draft.province}
                  onFocus={() => {
                    if (!draft.region) {
                      setRegionWarning("Please select a region first.");
                    }
                  }}
                  onChange={(e) => {
                    if (!draft.region) {
                      setRegionWarning("Please select a region first.");
                      return;
                    }
                    setRegionWarning("");
                    setDraft({ ...draft, province: e.target.value, city: "" });
                  }}
                >
                  <option value="">Select province</option>
                  {(phLocationEntries.find((entry) => entry.region === draft.region)?.provinces || []).map((province) => (
                    <option key={province.name} value={province.name}>{province.name}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>City / Municipality</span>
                <select
                  value={draft.city}
                  onFocus={() => {
                    if (!draft.region) {
                      setRegionWarning("Please select a region first.");
                    } else if (!draft.province) {
                      setRegionWarning("Please select a region and province first.");
                    }
                  }}
                  onChange={(e) => {
                    if (!draft.region || !draft.province) {
                      setRegionWarning("Please select a region and province first.");
                      return;
                    }
                    setRegionWarning("");
                    setDraft({ ...draft, city: e.target.value });
                  }}
                >
                  <option value="">Select city</option>
                  {(
                    (phLocationEntries.find((entry) => entry.region === draft.region)?.provinces || []).find(
                      (province) => province.name === draft.province
                    )?.cities || []
                  ).map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </label>
            </div>

            {regionWarning && (
              <div className="location-filter-warning-overlay" role="alert">
                <span className="location-filter-warning-icon" aria-hidden="true">!</span>
                <span>{regionWarning}</span>
              </div>
            )}

            <div className="location-modal-actions">
              <button type="button" className="location-cancel-btn" onClick={handleCancelLocation}>Cancel</button>
              <button type="button" className="location-clear-btn" onClick={handleClearLocation}>Clear</button>
              <button type="button" className="green-btn" onClick={handleApplyLocation}>Apply Location</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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

const isValidSalaryFormat = (value) => {
  if (value === null || value === undefined) return true;
  const trimmed = String(value).trim();
  if (!trimmed) return true;

  const salaryPattern = /^(?:PHP\s*)?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*-\s*(?:PHP\s*)?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?))?$/i;
  return salaryPattern.test(trimmed);
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
  formatDate,
  isVerifiedEmployer,
  setShowVerificationModal,
  setActiveTab,
  setSelectedJobId,
  openEditJobModal,
  handleCloseOrReopen,
  handleArchiveJob,
}) {
  return (
    <div className="swipeable-card-wrapper">
      <div className="swipeable-card">
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
            onClick={() => openEditJobModal(job)}
            aria-label="Edit job"
            title="Edit job"
          >
            <span className="action-btn-label">Edit</span>
            <span className="action-btn-icon"><FaEdit /></span>
          </button>
          <button
            type="button"
            className={`action-btn ${job.status === "closed" ? "reopen-btn" : "close-btn"}`}
            onClick={() => handleCloseOrReopen(job)}
            aria-label={job.status === "closed" ? "Reopen job" : "Close job"}
            title={job.status === "closed" ? "Reopen job" : "Close job"}
          >
            <span className="action-btn-label">{job.status === "closed" ? "Reopen" : "Close"}</span>
            <span className="action-btn-icon">{job.status === "closed" ? <FaStar /> : <FaTimesCircle />}</span>
          </button>
          {job.status === "closed" && (
            <button
              type="button"
              className="action-btn archive-btn"
              onClick={() => handleArchiveJob(job)}
              disabled={job.archived}
              aria-label={job.archived ? "Archived" : "Archive job"}
              title={job.archived ? "Archived" : "Archive job"}
            >
              <span className="action-btn-label">{job.archived ? "Archived" : "Archive"}</span>
              <span className="action-btn-icon"><FaArchive /></span>
            </button>
          )}
        </div>
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
  const [jobApplicants, setJobApplicants] = useState({});
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [recentApplicants, setRecentApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successToast, setSuccessToast] = useState("");
  const applicantsPanelRef = useRef(null);

  const { applicants: rankedApplicants, loading: loadingRanked, refetch: refetchRanked } = useRankedApplicants(selectedJobId);

  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [jobForm, setJobForm] = useState(defaultJobForm);
  const [salaryError, setSalaryError] = useState("");
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
  const [applicantsJobsPage, setApplicantsJobsPage] = useState(1);
  const [applicantsPage, setApplicantsPage] = useState(1);
  const [jobsSearchTerm, setJobsSearchTerm] = useState("");
  const [jobsFilters, setJobsFilters] = useState({ date: "all", jobType: "all", salary: "all", location: "" });
  const [applicantSearchTerm, setApplicantSearchTerm] = useState("");
  const [applicantFilters, setApplicantFilters] = useState({ date: "all", jobType: "all", salary: "all", location: "" });
  const [archivedSearchTerm, setArchivedSearchTerm] = useState("");
  const [archivedFilters, setArchivedFilters] = useState({ date: "all", jobType: "all", salary: "all", location: "" });

  const [expandedArchivedJobs, setExpandedArchivedJobs] = useState({});

  const isVerifiedEmployer = user?.role === "employer" && user?.verificationStatus === "verified";

  useEffect(() => {
    loadDashboardData();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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

  const handleSelectApplicantsJob = (jobId) => {
    setSelectedJobId(jobId);
    window.requestAnimationFrame(() => {
      applicantsPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const jobsPageSize = 8;
  const parseSalaryNumber = (value) => {
    if (!value || value === "Negotiable") return null;
    const numbers = String(value).match(/\d+(?:,\d{3})*(?:\.\d+)?/g);
    if (!numbers) return null;
    return Number(String(numbers.join("")).replace(/,/g, ""));
  };

  const matchesDateFilter = (dateValue, filterValue) => {
    if (!dateValue || filterValue === "all") return true;
    const jobDate = new Date(dateValue);
    if (Number.isNaN(jobDate.getTime())) return true;
    const diffMs = Date.now() - jobDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (filterValue === "7d") return diffDays <= 7;
    if (filterValue === "30d") return diffDays <= 30;
    if (filterValue === "90d") return diffDays <= 90;
    if (filterValue === "365d") return diffDays <= 365;
    return true;
  };

  const matchesJobFilters = (job, filters, searchTerm = "") => {
    const search = searchTerm.trim().toLowerCase();
    const locationText = String(job.location || "").toLowerCase();
    const jobTitleText = String(job.title || "").toLowerCase();
    const salaryValue = parseSalaryNumber(job.salary);
    const matchesSearch = !search || jobTitleText.includes(search) || locationText.includes(search);
    const matchesLocation = !filters.location || locationText.includes(filters.location.trim().toLowerCase());
    const matchesJobType = filters.jobType === "all" || (job.jobType || "Full-time") === filters.jobType;
    const matchesSalary =
      filters.salary === "all" ||
      (salaryValue === null && filters.salary === "negotiable") ||
      (filters.salary === "20k" && salaryValue !== null && salaryValue < 20000) ||
      (filters.salary === "50k" && salaryValue !== null && salaryValue >= 20000 && salaryValue <= 50000) ||
      (filters.salary === "50k+" && salaryValue !== null && salaryValue > 50000) ||
      (filters.salary === "100k+" && salaryValue !== null && salaryValue > 100000);
    const matchesDate = matchesDateFilter(job.createdAt || job.updatedAt, filters.date);

    return matchesSearch && matchesLocation && matchesJobType && matchesSalary && matchesDate;
  };

  const archivedJobs = useMemo(
    () => jobs.filter((job) => job.archived || job.status === "closed"),
    [jobs]
  );
  const filteredArchivedJobs = useMemo(() => {
    return archivedJobs.filter((job) => matchesJobFilters(job, archivedFilters, archivedSearchTerm));
  }, [archivedJobs, archivedFilters, archivedSearchTerm]);
  const liveJobs = useMemo(
    () => jobs.filter((job) => !job.archived && job.status !== "closed"),
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    return liveJobs.filter((job) => matchesJobFilters(job, jobsFilters, jobsSearchTerm));
  }, [liveJobs, jobsFilters, jobsSearchTerm]);

  const jobsTotalPages = Math.max(1, Math.ceil(filteredJobs.length / jobsPageSize));
  const paginatedJobs = useMemo(() => {
    const safePage = Math.min(jobsPage, jobsTotalPages);
    const startIndex = (safePage - 1) * jobsPageSize;
    return filteredJobs.slice(startIndex, startIndex + jobsPageSize);
  }, [filteredJobs, jobsPage, jobsTotalPages]);

  const applicantsJobsPageSize = 4;
  const applicantsJobsTotalPages = Math.max(1, Math.ceil(liveJobs.length / applicantsJobsPageSize));
  const applicantsPaginatedJobs = useMemo(() => {
    const safePage = Math.min(applicantsJobsPage, applicantsJobsTotalPages);
    const startIndex = (safePage - 1) * applicantsJobsPageSize;
    return liveJobs.slice(startIndex, startIndex + applicantsJobsPageSize);
  }, [liveJobs, applicantsJobsPage, applicantsJobsTotalPages]);

  useEffect(() => {
    setJobsPage((page) => Math.min(page, Math.max(1, Math.ceil(liveJobs.length / jobsPageSize))));
  }, [liveJobs]);

  useEffect(() => {
    if (!selectedJobId || !liveJobs.length) return;
    const selectedIndex = liveJobs.findIndex((job) => job._id === selectedJobId);
    if (selectedIndex >= 0) {
      const nextPage = Math.floor(selectedIndex / applicantsJobsPageSize) + 1;
      setApplicantsJobsPage((page) => (page === nextPage ? page : nextPage));
    }
  }, [selectedJobId, liveJobs]);

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
      salary: job.salary || "",
      slots: job.slots || 1,
      description: job.description || "",
      qualifications: quals,
      applicationDeadline: job.applicationDeadline ? String(job.applicationDeadline).slice(0, 10) : "",
    });
    setSalaryError("");
    setModalActiveSection("details");
    setIsJobModalOpen(true);
  };

  const handleSalaryChange = (value) => {
    setJobForm((prev) => ({ ...prev, salary: value }));
    if (!value) {
      setSalaryError("");
      return;
    }

    const valid = isValidSalaryFormat(value);
    setSalaryError(valid ? "" : "Invalid salary format. Use PHP 18,000 or 18,000 - 25,000.");
  };

  const handleSalaryBlur = () => {
    if (jobForm.salary && !isValidSalaryFormat(jobForm.salary)) {
      setSalaryError("Invalid salary format. Use PHP 18,000 or 18,000 - 25,000.");
    } else {
      setSalaryError("");
    }
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
      if (jobForm.salary && !isValidSalaryFormat(jobForm.salary)) {
        const message = "Invalid salary format. Use PHP 18,000 or 18,000 - 25,000.";
        setError(message);
        setSalaryError(message);
        setIsSavingJob(false);
        return;
      }

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
        applicantName: selectedApplicants.length === 1
          ? "1 selected applicant"
          : `${selectedApplicants.length} selected applicants`,
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
        setSuccessToast("Applicant rejected successfully");
      } else if (rejectDialog.kind === "bulk") {
        const response = await employerAPI.bulkUpdateApplicationStatuses({
          applicationIds: rejectDialog.applicationIds,
          status: "rejected",
        });
        const updatedCount = Number(response.data?.updated || 0);
        setSuccessToast(`Successfully rejected ${updatedCount} applicant${updatedCount === 1 ? '' : 's'}`);
        setSelectedApplicants([]);
      } else if (rejectDialog.kind === "drawer") {
        await employerAPI.updateApplicationStatus(rejectDialog.applicationId, {
          status: "rejected",
          employerNote: drawerNote,
        });
        setSuccessToast("Applicant rejected successfully");
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

    const query = applicantSearchTerm.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((app) => {
        const name = (app.applicant?.name || "").toLowerCase();
        const appliedVacancy = (app.vacancy?.title || "").toLowerCase();
        return name.includes(query) || appliedVacancy.includes(query);
      });
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter(app => {
        const normalizedStatus = normalizeApplicationStatus(app.status);
        return normalizedStatus === statusFilter;
      });
    }

    if (applicantFilters.location) {
      const locationQuery = applicantFilters.location.trim().toLowerCase();
      filtered = filtered.filter((app) => {
        const locationText = String(app.vacancy?.location || selectedJob?.location || "").toLowerCase();
        return locationText.includes(locationQuery);
      });
    }

    if (applicantFilters.jobType !== "all" && selectedJob) {
      filtered = filtered.filter((app) => (selectedJob.jobType || "Full-time") === applicantFilters.jobType);
    }

    if (applicantFilters.date !== "all") {
      filtered = filtered.filter((app) => matchesDateFilter(app.appliedAt || app.createdAt, applicantFilters.date));
    }

    if (applicantFilters.salary !== "all" && selectedJob) {
      const selectedSalary = parseSalaryNumber(selectedJob.salary);
      const matchesSalary =
        (applicantFilters.salary === "20k" && selectedSalary !== null && selectedSalary < 20000) ||
        (applicantFilters.salary === "50k" && selectedSalary !== null && selectedSalary >= 20000 && selectedSalary <= 50000) ||
        (applicantFilters.salary === "50k+" && selectedSalary !== null && selectedSalary > 50000) ||
        (applicantFilters.salary === "100k+" && selectedSalary !== null && selectedSalary > 100000) ||
        (applicantFilters.salary === "negotiable" && (selectedSalary === null || selectedJob.salary === "Negotiable"));
      if (!matchesSalary) filtered = [];
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
  }, [rankedApplicants, statusFilter, sortBy, applicantSearchTerm, applicantFilters, selectedJob]);

  const applicantPageSize = 6;
  const applicantsTotalPages = Math.max(1, Math.ceil(filteredAndSortedApplicants.length / applicantPageSize));
  const paginatedApplicants = useMemo(() => {
    const safePage = Math.min(applicantsPage, applicantsTotalPages);
    const startIndex = (safePage - 1) * applicantPageSize;
    return filteredAndSortedApplicants.slice(startIndex, startIndex + applicantPageSize);
  }, [filteredAndSortedApplicants, applicantsPage, applicantsTotalPages]);

  useEffect(() => {
    setApplicantsPage(1);
  }, [selectedJobId, statusFilter, sortBy]);

  useEffect(() => {
    setApplicantsPage((page) => Math.min(page, Math.max(1, applicantsTotalPages)));
  }, [applicantsTotalPages]);

  const modalSections = [
    { id: "details", label: "Job Details", icon: <FaClipboardList /> },
    { id: "logistics", label: "Logistics", icon: <FaCoins /> },
    { id: "requirements", label: "Requirements", icon: <FaListUl /> },
  ];

  const statsCards = [
    { icon: "📁", label: "Total Jobs", value: stats.totalJobs, tone: "green" },
    { icon: "✅", label: "Active Jobs", value: stats.activeJobs, tone: "green" },
    { icon: "👥", label: "Total Applicants", value: stats.totalApplicants, tone: "green" },
    { icon: "⏳", label: "Pending Review", value: stats.pendingReview, tone: "amber" },
    { icon: "📌", label: "Shortlisted", value: stats.shortlisted, tone: "blue" },
    { icon: "🎉", label: "Hired", value: stats.hired, tone: "green" },
  ];

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
              {tab === "overview" ? "Overview" : tab === "jobs" ? "My Job Postings" : tab === "archived" ? "Archived Jobs" : "Applicants"}
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

            {/* -------- JOBS TAB – SWIPEABLE CARDS -------- */}
            {activeTab === "jobs" && (
              <div className="employer-tab-panel">
                <div className="panel-header-row">
                  <h2>My Job Postings</h2>
                  <button type="button" className="green-btn" onClick={openCreateJobModal}>
                    + Post New Job
                  </button>
                </div>

                <div className="tab-search-toolbar">
                  <input
                    type="text"
                    value={jobsSearchTerm}
                    onChange={(e) => setJobsSearchTerm(e.target.value)}
                    className="tab-search-input"
                    placeholder="Search jobs or locations"
                    aria-label="Search jobs"
                  />
                  <div className="tab-filter-row">
                    <select value={jobsFilters.date} onChange={(e) => setJobsFilters((prev) => ({ ...prev, date: e.target.value }))} className="filter-select mini-filter">
                      <option value="all">All dates</option>
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                      <option value="90d">Last 90 days</option>
                      <option value="365d">Last 365 days</option>
                    </select>
                    <select value={jobsFilters.jobType} onChange={(e) => setJobsFilters((prev) => ({ ...prev, jobType: e.target.value }))} className="filter-select mini-filter">
                      <option value="all">All job types</option>
                      <option value="Full-time">Full-time</option>
                      <option value="Part-time">Part-time</option>
                      <option value="Contract">Contract</option>
                      <option value="Internship">Internship</option>
                      <option value="Temporary">Temporary</option>
                      <option value="Remote">Remote</option>
                    </select>
                    <select value={jobsFilters.salary} onChange={(e) => setJobsFilters((prev) => ({ ...prev, salary: e.target.value }))} className="filter-select mini-filter">
                      <option value="all">All salaries</option>
                      <option value="20k">Under ₱20k</option>
                      <option value="50k">₱20k - ₱50k</option>
                      <option value="50k+">Above ₱50k</option>
                      <option value="100k+">Above ₱100k</option>
                      <option value="negotiable">Negotiable</option>
                    </select>
                    <LocationFilterSelector
                      value={jobsFilters.location}
                      onChange={(nextValue) => setJobsFilters((prev) => ({ ...prev, location: nextValue }))}
                    />
                  </div>
                </div>

                <div className="swipeable-job-list">
                  {!paginatedJobs.length ? (
                    <p className="empty-muted">You have no job postings matching the current search.</p>
                  ) : (
                    paginatedJobs.map((job) => (
                      <SwipeableJobCard
                        key={job._id}
                        job={job}
                        formatDate={formatDate}
                        isVerifiedEmployer={isVerifiedEmployer}
                        setShowVerificationModal={setShowVerificationModal}
                        setActiveTab={setActiveTab}
                        setSelectedJobId={setSelectedJobId}
                        openEditJobModal={openEditJobModal}
                        handleCloseOrReopen={handleCloseOrReopen}
                        handleArchiveJob={handleArchiveJob}
                      />
                    ))
                  )}
                </div>

                {liveJobs.length > 0 && (
                  <div className="pagination-controls employer-pagination-controls" role="navigation" aria-label="Job postings pagination">
                    <div className="pagination-info pagination-summary">
                      Showing {Math.min((jobsPage - 1) * jobsPageSize + 1, liveJobs.length)}-
                      {Math.min(jobsPage * jobsPageSize, liveJobs.length)} of {liveJobs.length} job postings
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
                <div className="archived-summary-strip">
                  <div className="archived-summary-item">
                    <span className="archived-summary-label">Archived jobs</span>
                    <strong>{archivedJobs.length}</strong>
                  </div>
                  <div className="archived-summary-item">
                    <span className="archived-summary-label">Total applicants</span>
                    <strong>{archivedJobs.reduce((sum, job) => sum + Number(job.archivedMetrics?.totalApplicants || job.applicationCount || 0), 0)}</strong>
                  </div>
                  <div className="archived-summary-item">
                    <span className="archived-summary-label">Avg. days active</span>
                    <strong>{archivedJobs.length ? (archivedJobs.reduce((sum, job) => sum + Number(job.archivedMetrics?.daysActive || 0), 0) / archivedJobs.length).toFixed(1) : "0.0"}</strong>
                  </div>
                  <div className="archived-summary-item archived-hired-banner">
                    <span className="archived-summary-label">Hired candidates</span>
                    <strong>{archivedJobs.reduce((sum, job) => sum + Number(job.archivedMetrics?.hiredCount || 0), 0)}</strong>
                  </div>
                </div>

                <div className="tab-search-toolbar archived-toolbar">
                  <input
                    type="text"
                    value={archivedSearchTerm}
                    onChange={(e) => setArchivedSearchTerm(e.target.value)}
                    className="tab-search-input"
                    placeholder="Search archived jobs or locations"
                    aria-label="Search archived jobs"
                  />
                  <div className="tab-filter-row">
                    <select value={archivedFilters.date} onChange={(e) => setArchivedFilters((prev) => ({ ...prev, date: e.target.value }))} className="filter-select mini-filter">
                      <option value="all">All dates</option>
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                      <option value="90d">Last 90 days</option>
                      <option value="365d">Last 365 days</option>
                    </select>
                    <select value={archivedFilters.jobType} onChange={(e) => setArchivedFilters((prev) => ({ ...prev, jobType: e.target.value }))} className="filter-select mini-filter">
                      <option value="all">All job types</option>
                      <option value="Full-time">Full-time</option>
                      <option value="Part-time">Part-time</option>
                      <option value="Contract">Contract</option>
                      <option value="Internship">Internship</option>
                      <option value="Temporary">Temporary</option>
                      <option value="Remote">Remote</option>
                    </select>
                    <select value={archivedFilters.salary} onChange={(e) => setArchivedFilters((prev) => ({ ...prev, salary: e.target.value }))} className="filter-select mini-filter">
                      <option value="all">All salaries</option>
                      <option value="20k">Under ₱20k</option>
                      <option value="50k">₱20k - ₱50k</option>
                      <option value="50k+">Above ₱50k</option>
                      <option value="100k+">Above ₱100k</option>
                      <option value="negotiable">Negotiable</option>
                    </select>
                    <LocationFilterSelector
                      value={archivedFilters.location}
                      onChange={(nextValue) => setArchivedFilters((prev) => ({ ...prev, location: nextValue }))}
                    />
                  </div>
                </div>

                <div className="archived-list-controls">
                  <label className="select-all-toggle"><input type="checkbox" /> Select All</label>
                </div>

                <div className="archived-card-grid">
                  {filteredArchivedJobs.length ? (
                    filteredArchivedJobs.map((job) => {
                      const isExpanded = !!expandedArchivedJobs[job._id];

                      return (
                        <article key={job._id} className={`archived-job-card ${isExpanded ? "expanded" : "compact"}`}>
                          <div
                            className="archived-card-header"
                            onClick={() => toggleArchivedJobDetails(job._id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleArchivedJobDetails(job._id);
                              }
                            }}
                          >
                            <div className="archived-card-title-block">
                              <label className="archived-card-checkbox"><input type="checkbox" /></label>
                              <div>
                                <h3>{job.title}</h3>
                                <p>{job.location}</p>
                              </div>
                            </div>
                            <div className="archived-card-summary-meta">
                              <span className="status-pill archived-status-pill">Archived</span>
                              <span className="archived-mini-stat">{job.archivedMetrics?.totalApplicants || job.applicationCount || 0} applicants</span>
                            </div>
                          </div>

                          <div className={`archived-card-details ${isExpanded ? "visible" : "hidden"}`}>
                            <div className="archived-kpi-row">
                              <div className="archived-kpi-tile"><span>Total</span><strong>{job.archivedMetrics?.totalApplicants || job.applicationCount || 0}</strong></div>
                              <div className="archived-kpi-tile"><span>Qualified %</span><strong>{job.archivedMetrics?.qualifiedRate ?? 0}%</strong></div>
                              <div className="archived-kpi-tile"><span>Shortlisted %</span><strong>{job.archivedMetrics?.shortlistedRate ?? 0}%</strong></div>
                              <div className="archived-kpi-tile"><span>Days Active</span><strong>{job.archivedMetrics?.daysActive ?? 0}</strong></div>
                            </div>

                            <div className="archived-metadata-row">
                              <div className="archived-meta-block">
                                <span>Hired employee(s)</span>
                                <strong>{(job.archivedMetrics?.hiredCandidateNames || []).length ? job.archivedMetrics.hiredCandidateNames.join(", ") : "None"}</strong>
                              </div>
                              <div className="archived-meta-block">
                                <span>Reason</span>
                                <strong>{job.archiveReason ? job.archiveReason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "N/A"}</strong>
                              </div>
                            </div>
                          </div>

                          <div className={`archived-post-mortem ${isExpanded ? "is-open" : ""}`}>
                            <button
                              type="button"
                              className="archived-expander-btn"
                              aria-expanded={isExpanded}
                              onClick={() => toggleArchivedJobDetails(job._id)}
                            >
                              <span>View post-mortem</span>
                              <span className={`archived-expander-caret ${isExpanded ? "expanded" : ""}`}>›</span>
                            </button>
                            <div className={`archived-post-mortem-panel ${isExpanded ? "visible" : "hidden"}`}>
                              <div className="archived-post-mortem-header">
                                <h4>Post-mortem report</h4>
                              </div>
                              <div className="archived-post-mortem-grid">
                                <div className="archived-post-mortem-row">
                                  <span>Total Applicants</span>
                                  <strong>{job.archivedMetrics?.totalApplicants ?? 0}</strong>
                                </div>
                                <div className="archived-post-mortem-row">
                                  <span>Qualified / Shortlisted</span>
                                  <strong>{job.archivedMetrics?.qualifiedCount ?? 0} / {job.archivedMetrics?.shortlistedCount ?? 0}</strong>
                                </div>
                                <div className="archived-post-mortem-row">
                                  <span>Time-to-Close</span>
                                  <strong>{job.archivedMetrics?.daysActive ?? 0} days</strong>
                                </div>
                                <div className="archived-post-mortem-row">
                                  <span>Hired Candidate(s)</span>
                                  <strong>{(job.archivedMetrics?.hiredCandidateNames || []).length ? job.archivedMetrics.hiredCandidateNames.join(", ") : "None"}</strong>
                                </div>
                                <div className="archived-post-mortem-row">
                                  <span>Archive Reason</span>
                                  <strong>{job.archiveReason ? job.archiveReason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "N/A"}</strong>
                                </div>
                              </div>
                              <div className="archived-progress-list">
                                <div className="archived-progress-item">
                                  <label>Qualified rate</label>
                                  <div className="progress-bar"><span style={{ width: `${job.archivedMetrics?.qualifiedRate ?? 0}%` }} /></div>
                                  <small>{job.archivedMetrics?.qualifiedRate ?? 0}%</small>
                                </div>
                                <div className="archived-progress-item">
                                  <label>Shortlist rate</label>
                                  <div className="progress-bar"><span style={{ width: `${job.archivedMetrics?.shortlistedRate ?? 0}%` }} /></div>
                                  <small>{job.archivedMetrics?.shortlistedRate ?? 0}%</small>
                                </div>
                                <div className="archived-progress-item">
                                  <label>Hire rate</label>
                                  <div className="progress-bar"><span style={{ width: `${job.archivedMetrics?.hireRate ?? 0}%` }} /></div>
                                  <small>{job.archivedMetrics?.hireRate ?? 0}%</small>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="archived-card-actions">
                            <button type="button" className="outline-btn archived-export-btn">CSV export</button>
                            <button type="button" className="outline-btn archived-export-btn">PDF export</button>
                            <button type="button" className="red-btn archived-purge-btn">Purge</button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="empty-state archived-empty-state">
                      <div className="empty-state-icon">🗂️</div>
                      <p className="empty-state-text">No archived jobs yet.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* -------- APPLICANTS TAB -------- */}
            {activeTab === "applicants" && (
              <div className="employer-tab-panel applicants-layout">
                <div className="jobs-top-panel">
                  <div className="panel-header-row job-strip-header">
                    <h2>Your Jobs</h2>
                    <button type="button" className="green-btn" onClick={openCreateJobModal}>
                      + Post New Job
                    </button>
                  </div>

                  {!liveJobs.length ? (
                    <p className="empty-muted">No active jobs yet.</p>
                  ) : (
                    <>
                      <div className="job-card-row">
                        {applicantsPaginatedJobs.map((job) => (
                          <button
                            type="button"
                            key={job._id}
                            className={`job-select-card ${selectedJobId === job._id ? "active" : ""}`}
                            onClick={() => handleSelectApplicantsJob(job._id)}
                          >
                            <div className="job-card-main-row">
                              <div>
                                <h3>{job.title}</h3>
                                <p className="job-card-location">
                                  <FaMapMarkerAlt />
                                  <span>{formatJobLocation(job.location)}</span>
                                </p>
                              </div>
                              <span className={`status-pill ${statusClass(job.status)}`}>
                                {job.status || "active"}
                              </span>
                            </div>

                            <div className="job-card-meta-row">
                              <span>{job.applicantCount || 0} applicants</span>
                              <span>{job.jobType || "Full-time"}</span>
                              <span>{job.salary || "Negotiable"}</span>
                            </div>
                          </button>
                        ))}
                      </div>

                      {liveJobs.length > 0 && (
                        <div className="pagination-controls employer-pagination-controls compact-job-pagination" role="navigation" aria-label="Job selection pagination">
                          <div className="pagination-info pagination-summary">
                            Jobs {Math.min((applicantsJobsPage - 1) * applicantsJobsPageSize + 1, liveJobs.length)}-
                            {Math.min(applicantsJobsPage * applicantsJobsPageSize, liveJobs.length)} of {liveJobs.length}
                          </div>
                          <div className="pagination-actions">
                            <button
                              type="button"
                              className="pagination-btn employer-pagination-btn"
                              onClick={() => setApplicantsJobsPage((page) => Math.max(1, page - 1))}
                              disabled={applicantsJobsPage === 1}
                            >
                              ← Previous
                            </button>
                            <div className="pagination-info">Page {applicantsJobsPage} of {applicantsJobsTotalPages}</div>
                            <button
                              type="button"
                              className="pagination-btn employer-pagination-btn"
                              onClick={() => setApplicantsJobsPage((page) => Math.min(applicantsJobsTotalPages, page + 1))}
                              disabled={applicantsJobsPage >= applicantsJobsTotalPages}
                            >
                              Next →
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <section className="applicants-panel" ref={applicantsPanelRef}>
                  <div className="panel-header-row">
                    <h2>
                      {selectedJob ? `${selectedJob.title} Applicants` : "Applicants"}
                    </h2>
                    {selectedJob && (
                      <span className="applicant-count-badge">
                        {filteredAndSortedApplicants.length} of {rankedApplicants.length} applicants
                      </span>
                    )}
                  </div>

                  {selectedJob && (
                    <div className="hiring-progress-bar">
                      <div className="progress-stages">
                        <div className="progress-stage">
                          <div className="stage-dot stage-pending"></div>
                          <span className="stage-label">Pending</span>
                          <span className="stage-count">{rankedApplicants.filter(app => normalizeApplicationStatus(app.status) === 'pending').length}</span>
                        </div>
                        <div className="progress-connector"></div>
                        <div className="progress-stage">
                          <div className="stage-dot stage-shortlisted"></div>
                          <span className="stage-label">Shortlisted</span>
                          <span className="stage-count">{rankedApplicants.filter(app => normalizeApplicationStatus(app.status) === 'shortlisted').length}</span>
                        </div>
                        <div className="progress-connector"></div>
                        <div className="progress-stage">
                          <div className="stage-dot stage-hired"></div>
                          <span className="stage-label">Hired</span>
                          <span className="stage-count">{rankedApplicants.filter(app => normalizeApplicationStatus(app.status) === 'hired').length}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="tab-search-toolbar applicants-toolbar">
                    <input
                      type="text"
                      value={applicantSearchTerm}
                      onChange={(e) => setApplicantSearchTerm(e.target.value)}
                      className="tab-search-input"
                      placeholder="Search applicants or jobs"
                      aria-label="Search applicants"
                    />
                    <div className="tab-filter-row">
                      <select value={applicantFilters.date} onChange={(e) => setApplicantFilters((prev) => ({ ...prev, date: e.target.value }))} className="filter-select mini-filter">
                        <option value="all">All dates</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="90d">Last 90 days</option>
                        <option value="365d">Last 365 days</option>
                      </select>
                      <select value={applicantFilters.jobType} onChange={(e) => setApplicantFilters((prev) => ({ ...prev, jobType: e.target.value }))} className="filter-select mini-filter">
                        <option value="all">All job types</option>
                        <option value="Full-time">Full-time</option>
                        <option value="Part-time">Part-time</option>
                        <option value="Contract">Contract</option>
                        <option value="Internship">Internship</option>
                        <option value="Temporary">Temporary</option>
                        <option value="Remote">Remote</option>
                      </select>
                      <select value={applicantFilters.salary} onChange={(e) => setApplicantFilters((prev) => ({ ...prev, salary: e.target.value }))} className="filter-select mini-filter">
                        <option value="all">All salaries</option>
                        <option value="20k">Under ₱20k</option>
                        <option value="50k">₱20k - ₱50k</option>
                        <option value="50k+">Above ₱50k</option>
                        <option value="100k+">Above ₱100k</option>
                        <option value="negotiable">Negotiable</option>
                      </select>
                      <LocationFilterSelector
                        value={applicantFilters.location}
                        onChange={(nextValue) => setApplicantFilters((prev) => ({ ...prev, location: nextValue }))}
                      />
                    </div>
                  </div>

                  <div className="filter-sort-bar">
                    <div className="filter-group">
                      <label>Status:</label>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="filter-select"
                      >
                        <option value="all">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="shortlisted">Shortlisted</option>
                        <option value="rejected">Rejected</option>
                        <option value="hired">Hired</option>
                      </select>
                    </div>
                    <div className="sort-group">
                      <label>Sort by:</label>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="sort-select"
                      >
                        <option value="match">Match %</option>
                        <option value="date">Applied Date</option>
                        <option value="name">Name</option>
                      </select>
                    </div>
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
                    <>
                      <RankedApplicantsTable
                        applicants={paginatedApplicants}
                        onViewApplicant={openApplicantDrawer}
                        onMessageApplicant={handleMessageApplicant}
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

                      {filteredAndSortedApplicants.length > 0 && (
                        <div className="pagination-controls employer-pagination-controls" role="navigation" aria-label="Ranked applicants pagination">
                          <div className="pagination-info pagination-summary">
                            Showing {Math.min((applicantsPage - 1) * applicantPageSize + 1, filteredAndSortedApplicants.length)}-
                            {Math.min(applicantsPage * applicantPageSize, filteredAndSortedApplicants.length)} of {filteredAndSortedApplicants.length} applicants
                          </div>
                          <div className="pagination-actions">
                            <button
                              type="button"
                              className="pagination-btn employer-pagination-btn"
                              onClick={() => setApplicantsPage((page) => Math.max(1, page - 1))}
                              disabled={applicantsPage === 1}
                            >
                              ← Previous
                            </button>
                            <div className="pagination-info">
                              Page {applicantsPage} of {applicantsTotalPages}
                            </div>
                            <button
                              type="button"
                              className="pagination-btn employer-pagination-btn"
                              onClick={() => setApplicantsPage((page) => Math.min(applicantsTotalPages, page + 1))}
                              disabled={applicantsPage >= applicantsTotalPages}
                            >
                              Next →
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </section>

      {rejectDialog && (
        <div className="modal-overlay" onClick={() => setRejectDialog(null)}>
          <div className="verification-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{rejectDialog.kind === "bulk" ? "Confirm Bulk Rejection" : "Confirm Rejection"}</h3>
            <p>
              {rejectDialog.kind === "bulk"
                ? rejectDialog.applicantName === "1 selected applicant"
                  ? "Are you sure you want to reject 1 selected applicant? This will mark the selected applicant as rejected."
                  : `Are you sure you want to reject ${rejectDialog.applicantName}? This will mark all selected applicants as rejected.`
                : `Are you sure you want to reject ${rejectDialog.applicantName}? This action will notify the applicant and update their status to rejected.`}
            </p>
            <div className="verification-modal-actions">
              <button
                className="green-btn"
                style={{ background: "#dc2626" }}
                onClick={confirmRejectDialog}
              >
                {rejectDialog.kind === "bulk"
                  ? rejectDialog.applicantName === "1 selected applicant"
                    ? "Confirm Reject Applicant"
                    : "Confirm Reject Applicants"
                  : "Confirm Reject Applicant"}
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
                  <a
                    className="applicant-resume-link"
                    href={`${API_URL.replace(/\/api\/v1$/, '')}/${String(selectedApplication.resume).replace(/^\/+/, "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>↓</span>
                    <span>Download Resume</span>
                  </a>
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
                    {jobForm.salary && (
                      <div className="job-form-preview-salary">
                        <FaMoneyBillWave /> {jobForm.salary}
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
                          <FaMoneyBillWave /> Salary <span className="pj-optional">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          className={`form-input ${salaryError ? "form-input-error" : ""}`}
                          value={jobForm.salary}
                          onChange={(e) => handleSalaryChange(e.target.value)}
                          onBlur={() => {
                            if (jobForm.salary && !isValidSalaryFormat(jobForm.salary)) {
                              setSalaryError("Invalid salary format. Use PHP 18,000 or 18,000 - 25,000.");
                            } else {
                              setSalaryError("");
                            }
                          }}
                          placeholder="PHP 18,000 - 25,000"
                          disabled={isSavingJob}
                        />
                        {salaryError && <span className="form-field-error">{salaryError}</span>}
                        <span className="form-hint">Example: PHP 18,000 or 18,000 - 25,000</span>
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
                      <label className="form-label">
                        Qualifications <span className="pj-required">*</span>
                      </label>
                      <QualificationsEditor
                        qualifications={jobForm.qualifications}
                        onChange={(quals) => setJobForm({ ...jobForm, qualifications: quals })}
                        disabled={isSavingJob}
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