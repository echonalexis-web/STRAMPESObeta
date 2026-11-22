import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { jobAPI } from "../services/api";
import "../styles/jobboard.css";
import "../styles/public-jobs.css";
import VacancyCard from "../components/VacancyCard";
import JobSearchFilters from "../components/JobSearchFilters";
import Pagination from "../components/Pagination";
import StateBlock from "../components/StateBlock";
import phLocationsRaw from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";
import { isSalaryRangeInvalid } from "../utils/salaryRange";
import { loginStateFor } from "../utils/returnTo";
import {
  TYPED_DEBOUNCE_MS,
  createDebouncer,
  createRequestGate,
  parseFilters,
  serializeFilters,
} from "../utils/liveSearch";

// 9 jobs per page, always (the server also caps what can be asked for).
const PAGE_SIZE = 9;

// The signed-out jobs list: every publicly available job, newest first, searchable and
// filterable, with no account needed. Viewing is open; applying, saving, following and
// the match percentage ask the visitor to log in and bring them back here afterwards.
// Same filters, URL parameters and card design as Browse Jobs; the data comes from the
// public endpoint, which returns public fields only.
export default function PublicJobs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const initial = useRef(null);
  if (initial.current === null) {
    const parsed = parseFilters(searchParams);
    // The must-have toggle is a signed-in feature; it never applies here.
    delete parsed.filters.onlyMeetsRequired;
    initial.current = parsed;
  }
  const [filters, setFilters] = useState(initial.current.filters);
  const filtersRef = useRef(filters);
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initial.current.page);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [openJobId, setOpenJobId] = useState(null);
  const gate = useRef(createRequestGate());
  const debouncer = useRef(createDebouncer(TYPED_DEBOUNCE_MS));
  const loadedOnce = useRef(false);
  const listRef = useRef(null);

  // Starting a search aborts the previous one; a slower, older answer can never
  // overwrite newer results.
  const fetchJobs = async (nextFilters, nextPage = 1) => {
    const request = gate.current.begin();
    if (loadedOnce.current) setRefreshing(true);
    else setLoading(true);
    setError("");
    setOpenJobId(null);
    try {
      const params = {};
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (key === "onlyMeetsRequired") return;
        if (value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return;
        params[key] = value;
      });
      const { data } = await jobAPI.getPublicJobs({ ...params, page: nextPage, limit: PAGE_SIZE }, { signal: request.signal });
      if (!request.isCurrent()) return;

      const list = Array.isArray(data?.jobs) ? data.jobs : [];
      const count = Number(data?.pagination?.total ?? data?.total ?? list.length) || 0;
      const pages = Math.max(1, Number(data?.pagination?.pages) || 1);
      // A page that no longer exists (a stale link, or jobs that closed) goes to the last one.
      if (list.length === 0 && count > 0 && nextPage > 1) {
        fetchJobs(nextFilters, Math.min(nextPage - 1, pages));
        return;
      }
      setJobs(list);
      setTotal(count);
      setPage(Number(data?.pagination?.page) || nextPage);
      loadedOnce.current = true;
      setSearchParams(serializeFilters(nextFilters, nextPage), { replace: true });
    } catch (err) {
      if (err.code === "ERR_CANCELED" || !request.isCurrent()) return;
      if (err.response?.data?.code === "PAGE_TOO_DEEP" && nextPage > 1) {
        fetchJobs(nextFilters, 1);
        return;
      }
      setError(err.response?.data?.message || t("publicJobs.errorBody"));
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    fetchJobs(initial.current.filters, initial.current.page);
    const typing = debouncer.current;
    const requests = gate.current;
    return () => {
      typing.cancel();
      requests.abort();
    };
    // Runs once on open; later searches are started by the handlers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typed fields wait 300 ms after the last keystroke; anything that commits (Search,
  // Enter, selects, chips, Clear) runs at once. Either way the page goes back to 1.
  const handleFilterChange = (next) => {
    filtersRef.current = next;
    setFilters(next);
    debouncer.current.schedule(() => {
      const current = filtersRef.current;
      if (isSalaryRangeInvalid(current.salaryMin, current.salaryMax)) return;
      fetchJobs(current, 1);
    });
  };

  const handleSearch = (override) => {
    debouncer.current.cancel();
    const next = override || filtersRef.current;
    if (isSalaryRangeInvalid(next.salaryMin, next.salaryMax)) return;
    filtersRef.current = next;
    setFilters(next);
    fetchJobs(next, 1);
  };

  const handleReset = () => {
    debouncer.current.cancel();
    filtersRef.current = {};
    setFilters({});
    fetchJobs({}, 1);
  };

  const goToPage = (nextPage) => fetchJobs(filtersRef.current, nextPage);

  // Send the visitor to login and bring them back to `path` (this list, or one job).
  const goLogin = (path) => {
    const [pathname, search = ""] = String(path).split("?");
    navigate("/login", { state: loginStateFor({ pathname, search: search ? `?${search}` : "" }) });
  };

  const hasFilters = Object.keys(filters).some((key) => key !== "onlyMeetsRequired" && filters[key] !== "" && filters[key] !== undefined);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="jb pj">
      <div className="jb-inner">
        <header className="pj-head">
          <h1 className="pj-title">{t("publicJobs.title")}</h1>
          <p className="pj-sub">{t("publicJobs.subtitle")}</p>
        </header>

        <div className="pj-login-note" role="note">
          <p>{t("publicJobs.loginNote")}</p>
          <button type="button" className="ds-btn ds-btn--secondary" onClick={() => goLogin(`${location.pathname}${location.search}`)}>
            {t("publicJobs.login")}
          </button>
        </div>

        <div className="jb-layout">
          <div className="jb-toolbar">
            <JobSearchFilters
              filters={filters}
              onChange={handleFilterChange}
              onSearch={handleSearch}
              phLocationsData={phLocationsRaw}
              preferredIndustries={[]}
              visitor
            />
          </div>

          <div className="jb-main" ref={listRef}>
            <div className="jb-resultbar" role="status" aria-live="polite">
              {loading
                ? t("publicJobs.loading")
                : total > 0
                  ? `${t("jobBoard.resultCount", { count: total })} · ${t("jobBoard.pageOf", { page, total: pages })}`
                  : t("publicJobs.noResults")}
            </div>

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
                title={t("publicJobs.errorTitle")}
                description={error}
                onRetry={() => fetchJobs(filtersRef.current, page)}
              />
            ) : jobs.length === 0 ? (
              <StateBlock
                kind="empty"
                title={t("publicJobs.emptyTitle")}
                description={t("publicJobs.emptyBody")}
                action={
                  hasFilters ? (
                    <button type="button" className="ds-btn ds-btn--primary" onClick={handleReset}>
                      {t("jobBoard.clearFilters")}
                    </button>
                  ) : null
                }
              />
            ) : (
              <div className={`jb-list${refreshing ? " is-refreshing" : ""}`} aria-busy={refreshing}>
                {jobs.map((job) => (
                  <div key={job._id} className="jb-cell">
                    <VacancyCard
                      job={job}
                      visitor
                      matchAvailable={false}
                      onOpen={() => navigate(`/jobs/${job._id}`)}
                      onLogin={() => goLogin(`/jobs/${job._id}`)}
                      compact
                      expanded={openJobId === job._id}
                      onToggle={() => setOpenJobId((current) => (current === job._id ? null : job._id))}
                    />
                  </div>
                ))}
              </div>
            )}

            <Pagination
              total={total}
              page={page}
              pageSize={PAGE_SIZE}
              showPageSize={false}
              onPageChange={goToPage}
              label={t("publicJobs.pagerItems")}
              idPrefix="pj"
              variant="card"
              disabled={loading}
              scrollTargetRef={listRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
