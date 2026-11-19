import { useEffect, useMemo, useRef, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { jobAPI } from "../services/api";
import "../styles/jobboard.css";
import VacancyCard from "../components/VacancyCard";
import JobSearchFilters from "../components/JobSearchFilters";
import ApplyModal from "../components/ApplyModal";
import { isJobVacancyEligibleAge } from "../utils/age";
import StateBlock from "../components/StateBlock";
import { AuthContext } from "../context/AuthContext";
import phLocationsRaw from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { jobMatchesAnyIndustry } from "../utils/industries";

export default function JobBoard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, login } = useContext(AuthContext);
  // 15-17 accounts browse jobs read-only; applying is for 18+ (server-enforced).
  const canApplyJobs = isJobVacancyEligibleAge(user?.dateOfBirth);
  const preferredIndustries = user?.preferredIndustries || [];

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applications, setApplications] = useState([]);
  const [hasSkills, setHasSkills] = useState(true);
  // How many jobs the "only show jobs I fully qualify for" toggle is
  // currently hiding — §A.4: a filter that empties the board should say so,
  // not just show zero results. 0 whenever the toggle is off (server
  // reports `unfilteredTotal === total` in that case).
  const [hiddenByMustHaves, setHiddenByMustHaves] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [jobsPerPage] = useState(6);
  const [activeFilters, setActiveFilters] = useState({});
  const [applyModalJobId, setApplyModalJobId] = useState(null);
  // Phone compact cards: only one card's match and apply area is open at a time.
  const [openJobId, setOpenJobId] = useState(null);
  const toggleJob = (jobId) => setOpenJobId((current) => (current === jobId ? null : jobId));
  // Tracks the in-flight request so a slower, superseded search (e.g. an
  // earlier keystroke/click) can never overwrite state with stale results
  // after a newer one has already started.
  const abortControllerRef = useRef(null);

  const fetchJobs = async (filters = activeFilters, page = 1) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError("");
    setOpenJobId(null);
    try {
      const sanitizedFilters = { ...filters };
      Object.keys(sanitizedFilters).forEach((key) => {
        const value = sanitizedFilters[key];
        if (value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
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
        jobAPI.searchJobsWithSemantic(params, { signal: controller.signal }),
        jobAPI.getMyApplications({}, { signal: controller.signal }),
      ]);

      // A newer fetchJobs call already started after this one — its own
      // response (or its own catch/finally) owns state from here on.
      if (abortControllerRef.current !== controller) return;

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
      const unfilteredTotal = Number(jobsResponse.data.unfilteredTotal ?? jobsResponse.data.total ?? 0);
      const visibleTotal = Number(jobsResponse.data.total ?? 0);
      setHiddenByMustHaves(Math.max(0, unfilteredTotal - visibleTotal));
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
      if (err.code === "ERR_CANCELED") return;
      console.error("Error fetching jobs:", err);
      setError(err.response?.data?.message || "Failed to load jobs");
    } finally {
      if (abortControllerRef.current === controller) setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleFilterChange = (newFilters) => {
    setActiveFilters(newFilters);
  };

  // Accepts an optional override so a caller that just changed a filter
  // (e.g. the must-haves toggle) can search with the fresh value immediately
  // instead of racing React's async state update to `activeFilters`.
  const handleSearch = (overrideFilters) => {
    fetchJobs(overrideFilters || activeFilters, 1);
  };

  const handleReset = () => {
    setActiveFilters({});
    fetchJobs({}, 1);
  };

  const isJobAlreadyApplied = (jobId) => {
    return applications.some((app) => String(app.vacancy?._id) === String(jobId));
  };

  // §A.4 — jobs missing exactly one required qualification are the
  // highest-value ones to surface, and today they're buried wherever
  // relevance ordering happens to put them. Scoped to the current page of
  // results (the board already paginates server-side); the main list below
  // excludes whatever shows up here so nothing renders twice.
  const closeMatchJobs = useMemo(
    () => jobs.filter((job) => {
      const m = job.checklistMatch;
      // metMustHaves > 0 keeps this bucket meaning "almost there" — without
      // it, a job with a single must-have the applicant meets NONE of (a 0%
      // match) still reads as "missing exactly 1" and gets mislabeled close.
      return Boolean(m && m.totalMustHaves > 0 && m.metMustHaves > 0 && m.totalMustHaves - m.metMustHaves === 1);
    }),
    [jobs]
  );
  const closeMatchIds = useMemo(() => new Set(closeMatchJobs.map((job) => job._id)), [closeMatchJobs]);
  const mainListJobs = useMemo(
    () => jobs.filter((job) => !closeMatchIds.has(job._id)),
    [jobs, closeMatchIds]
  );

  return (
    <div className="jb">
      <div className="jb-inner">
        {/* The top bar shows the page title as a plain paragraph, so the
            page's single h1 lives here, visible to assistive tech only. */}
        <h1 className="ds-sr-only">{t("shell.topbar.titles.browseJobs")}</h1>

        {/* From 1101px the filters become a sticky left rail beside the
            results (jobboard.css); below that they stay stacked above. */}
        <div className="jb-layout">
        <div className="jb-toolbar">
          <JobSearchFilters
            filters={activeFilters}
            onChange={handleFilterChange}
            onSearch={handleSearch}
            onReset={handleReset}
            phLocationsData={phLocationsRaw}
            preferredIndustries={preferredIndustries}
            mustHaveHiddenCount={hiddenByMustHaves}
          />
        </div>

        <div className="jb-main">
        <div className="jb-resultbar" role="status" aria-live="polite">
          {totalJobs > 0 ? t("jobBoard.resultCount", { count: totalJobs }) : t("jobBoard.noResults")}
          {totalJobs > 0 && ` · ${t("jobBoard.pageOf", { page: currentPage, total: totalPages })}`}
        </div>

        {user && !hasSkills && totalJobs > 0 && (
          <div className="jb-note">
            <p>{t("jobBoard.noSkills")}</p>
            <button type="button" className="ds-btn ds-btn--secondary" onClick={() => navigate("/profile")}>{t("jobBoard.editProfile")}</button>
          </div>
        )}

        {loading ? (
          <div className="jb-list jb-loading" role="status" aria-live="polite">
            <span className="ds-sr-only">{t("jobBoard.loading")}</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="ds-card jb-sk-card" aria-hidden="true">
                <span className="ds-skeleton jb-sk-line jb-sk-line--sm" />
                <span className="ds-skeleton jb-sk-line jb-sk-line--lg" />
                <span className="ds-skeleton jb-sk-line" />
                <span className="ds-skeleton jb-sk-btn" />
              </div>
            ))}
          </div>
        ) : error ? (
          <StateBlock
            kind="error"
            title={t("jobBoard.errorTitle")}
            description={error}
            onRetry={() => fetchJobs(activeFilters, currentPage)}
          />
        ) : jobs.length === 0 ? (
          <StateBlock
            kind="empty"
            title={t("jobBoard.emptyTitle")}
            description={t("jobBoard.emptyBody")}
            action={
              Object.keys(activeFilters).length > 0 ? (
                <button type="button" className="ds-btn ds-btn--primary" onClick={handleReset}>
                  {t("jobBoard.clearFilters")}
                </button>
              ) : null
            }
          />
        ) : (
          <>
            {closeMatchJobs.length > 0 && (
              <section className="jb-close-matches">
                <h2 className="jb-close-matches__heading">
                  {t("jobBoard.closeMatches")}
                </h2>
                <div className="jb-list">
                  {closeMatchJobs.map((job) => (
                    <VacancyCard
                      key={job._id}
                      job={job}
                      applied={isJobAlreadyApplied(job._id)}
                      followed={Boolean(job.isFollowedEmployer)}
                      preferred={jobMatchesAnyIndustry(job, preferredIndustries)}
                      matchAvailable={hasSkills}
                      onOpen={() => navigate(`/jobs/${job._id}`)}
                      onApply={() => setApplyModalJobId(job._id)}
                      canApply={canApplyJobs}
                      compact
                      expanded={openJobId === job._id}
                      onToggle={() => toggleJob(job._id)}
                    />
                  ))}
                </div>
              </section>
            )}

            <div className="jb-list">
              {mainListJobs.map((job) => (
                <VacancyCard
                  key={job._id}
                  job={job}
                  applied={isJobAlreadyApplied(job._id)}
                  followed={Boolean(job.isFollowedEmployer)}
                  preferred={jobMatchesAnyIndustry(job, preferredIndustries)}
                  matchAvailable={hasSkills}
                  onOpen={() => navigate(`/jobs/${job._id}`)}
                  onApply={() => setApplyModalJobId(job._id)}
                  canApply={canApplyJobs}
                  compact
                  expanded={openJobId === job._id}
                  onToggle={() => toggleJob(job._id)}
                />
              ))}
            </div>

            <ApplyModal
              isOpen={Boolean(applyModalJobId)}
              onClose={() => setApplyModalJobId(null)}
              jobId={applyModalJobId}
              job={jobs.find((j) => j._id === applyModalJobId) || null}
              onSuccess={() => {
                setApplyModalJobId(null);
                fetchJobs(activeFilters, currentPage);
              }}
            />

            <nav className="jb-pager" aria-label={t("jobBoard.pagerLabel")}>
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={() => fetchJobs(activeFilters, currentPage - 1)}
                disabled={currentPage <= 1 || loading}
              >
                <ArrowLeft size={16} aria-hidden="true" /> {t("jobBoard.previous")}
              </button>
              <div className="jb-pager__info" aria-current="page">
                {t("jobBoard.pageOf", { page: currentPage, total: totalPages })}
              </div>
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={() => fetchJobs(activeFilters, currentPage + 1)}
                disabled={currentPage >= totalPages || loading}
              >
                {t("jobBoard.next")} <ArrowRight size={16} aria-hidden="true" />
              </button>
            </nav>
          </>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}
