import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { jobAPI } from "../services/api";
import VacancyCard from "../components/VacancyCard";
import "../styles/dashboard.css";
import { FaBriefcase, FaFileAlt, FaBuilding, FaCalendarAlt, FaSearch, FaArrowRight, FaExclamationTriangle, FaSpinner, FaStar } from "react-icons/fa";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const REC_PER_PAGE = 4;

export default function Dashboard() {
  const { user, login } = useContext(AuthContext);
  const navigate = useNavigate();
  const preferredIndustries = useMemo(() => user?.preferredIndustries || [], [user]);

  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasSkills, setHasSkills] = useState(true);
  const [recPage, setRecPage] = useState(1);

  useEffect(() => {
    fetchData();
  }, []);

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

      if (jobRes.data?.preferredIndustries && Array.isArray(jobRes.data.preferredIndustries)) {
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

  const isJobAlreadyApplied = (jobId) =>
    applications.some((app) => String(app.vacancy?._id) === String(jobId));

  const cardProps = (job) => ({
    job,
    applied: isJobAlreadyApplied(job._id),
    followed: Boolean(job.isFollowedEmployer),
    preferred: preferredIndustries.includes(job.industry),
    matchAvailable: hasSkills,
    onOpen: () => navigate(`/jobs/${job._id}`),
    onApply: () => navigate(`/jobs/${job._id}/apply`),
  });

  // Jobs from a followed employer are fast-tracked into recommendations
  // regardless of industry match, and sorted ahead of the plain matches.
  const recommendedAll = useMemo(
    () =>
      jobs
        .filter((job) => job.isFollowedEmployer || preferredIndustries.includes(job.industry))
        .sort((a, b) => Number(Boolean(b.isFollowedEmployer)) - Number(Boolean(a.isFollowedEmployer))),
    [jobs, preferredIndustries]
  );

  const recTotalPages = Math.max(1, Math.ceil(recommendedAll.length / REC_PER_PAGE));
  const recSafePage = Math.min(recPage, recTotalPages);
  const recSlice = recommendedAll.slice((recSafePage - 1) * REC_PER_PAGE, recSafePage * REC_PER_PAGE);

  const recentJobs = useMemo(() => {
    const topRecommended = recommendedAll.slice(0, 4);
    const filler = jobs
      .filter((job) => !job.isFollowedEmployer && !preferredIndustries.includes(job.industry))
      .slice(0, 4 - topRecommended.length);
    return [...topRecommended, ...filler];
  }, [jobs, recommendedAll, preferredIndustries]);

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

          {/* Recent Job Openings — a short teaser; the full list lives on the Job Board */}
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

          {recentJobs.length === 0 ? (
            <div className="empty-state-card"><p>No jobs are available right now.</p></div>
          ) : (
            <div className="jobs-grid">
              {recentJobs.map((job) => <VacancyCard key={job._id} {...cardProps(job)} />)}
            </div>
          )}

          {/* Recommended for You — paginated */}
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
          ) : recommendedAll.length === 0 ? (
            <div className="empty-state-card"><p>No recommended jobs available. Check back soon!</p></div>
          ) : (
            <>
              <div className="jobs-grid">
                {recSlice.map((job) => <VacancyCard key={job._id} {...cardProps(job)} />)}
              </div>
              <div className="pagination-controls dash-pagination">
                <button
                  className="pagination-btn"
                  onClick={() => setRecPage((p) => Math.max(1, p - 1))}
                  disabled={recSafePage <= 1}
                >
                  ← Previous
                </button>
                <div className="pagination-info">Page {recSafePage} of {recTotalPages}</div>
                <button
                  className="pagination-btn"
                  onClick={() => setRecPage((p) => Math.min(recTotalPages, p + 1))}
                  disabled={recSafePage >= recTotalPages}
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
