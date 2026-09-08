import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { jobAPI } from "../services/api";
import "../styles/jobboard.css";
import VacancyCard from "../components/VacancyCard";
import JobSearchFilters from "../components/JobSearchFilters";
import { AuthContext } from "../context/AuthContext";
import phLocationsRaw from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";
import { FaBriefcase } from "react-icons/fa";

export default function JobBoard() {
  const navigate = useNavigate();
  const { user, login } = useContext(AuthContext);
  const preferredIndustries = user?.preferredIndustries || [];

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applications, setApplications] = useState([]);
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
        const token = localStorage.getItem("token");
        const updatedUser = { ...user, preferredIndustries: jobsResponse.data.preferredIndustries };
        if (token) {
          login(token, updatedUser);
        }
      }
    } catch (err) {
      console.error("Error fetching jobs:", err);
      setError(err.response?.data?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

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

  const isJobAlreadyApplied = (jobId) => {
    return applications.some((app) => String(app.vacancy?._id) === String(jobId));
  };

  return (
    <div className="jobboard-container">
      <section className="jobboard-hero jobboard-hero--slim">
        <div className="jobboard-hero-content">
          <h1>Available Jobs in Marinduque</h1>
          <p>Browse open vacancies and apply with your resume.</p>
        </div>
      </section>

      <div className="jobboard-content">
        <div className="jobboard-toolbar">
          <JobSearchFilters
            filters={activeFilters}
            onChange={handleFilterChange}
            onSearch={handleSearch}
            onReset={handleReset}
            phLocationsData={phLocationsRaw}
            preferredIndustries={preferredIndustries}
          />
        </div>

        <div className="jobboard-resultbar">
          {totalJobs > 0 ? `${totalJobs} ${totalJobs === 1 ? "job" : "jobs"} available` : "No jobs available"}
          {totalJobs > 0 && ` · Page ${currentPage} of ${totalPages}`}
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
          <>
            <div className="jobboard-list">
              {jobs.map((job) => (
                <VacancyCard
                  key={job._id}
                  job={job}
                  applied={isJobAlreadyApplied(job._id)}
                  followed={Boolean(job.isFollowedEmployer)}
                  preferred={preferredIndustries.includes(job.industry)}
                  matchAvailable={hasSkills}
                  onOpen={() => navigate(`/jobs/${job._id}`)}
                  onApply={() => navigate(`/jobs/${job._id}/apply`)}
                />
              ))}
            </div>

            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => fetchJobs(activeFilters, currentPage - 1)}
                disabled={currentPage <= 1 || loading}
              >
                ← Previous
              </button>
              <div className="pagination-info">
                Page {currentPage} of {totalPages}
              </div>
              <button
                className="pagination-btn"
                onClick={() => fetchJobs(activeFilters, currentPage + 1)}
                disabled={currentPage >= totalPages || loading}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
