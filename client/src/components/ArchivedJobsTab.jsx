import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, CalendarDays, Percent, UserCheck, Users } from "lucide-react";
import { FaSearch } from "react-icons/fa";
import ArchivedJobRow from "./ArchivedJobRow";
import MetricCard from "./MetricCard";
import Pagination from "./Pagination";
import StateBlock from "./StateBlock";
import { employerAPI } from "../services/api";
import { FILTER_IDS, SORT_IDS, buildArchivedQuery, emptyKind, statText } from "../utils/archivedJobs";
import "../styles/archived-jobs.css";

// The Employer Dashboard "Archived" tab. The server returns the page of rows, the
// filter counts and the stats; this component keeps the controls and renders them.
const FILTER_LABEL_KEY = { all: "all", filled: "filled", closed_manually: "closedManually", expired: "expired", no_applicants: "noApplicants" };

export default function ArchivedJobsTab({ onViewApplicants }) {
  const { t } = useTranslation();
  const listRef = useRef(null);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", failed: false, data: null });

  // The search box waits a moment before it asks the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const key = JSON.stringify([page, pageSize, filter, sort, q, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    employerAPI
      .getArchivedJobs(buildArchivedQuery({ page, pageSize, filter, sort, q }), controller.signal)
      .then((res) => setResult({ key, failed: false, data: res.data }))
      .catch((error) => {
        if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") return;
        setResult((prev) => ({ ...prev, key, failed: true }));
      });
    return () => controller.abort();
  }, [page, pageSize, filter, sort, q, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // Loading is derived: the answer on screen belongs to an older request until the new one lands,
  // so the list never flashes an empty state while a filter or page is loading.
  const loading = result.key !== key;
  const failed = !loading && result.failed;
  const data = result.data;
  const items = data?.items || [];
  const stats = data?.stats;
  const counts = data?.counts;
  const total = data?.total ?? 0;
  const empty = data && !failed ? emptyKind({ total, counts, filter, q }) : null;

  const clearFilters = () => {
    setFilter("all");
    setSearch("");
    setQ("");
    setPage(1);
  };

  return (
    <div className="employer-tab-panel archived-jobs-layout ed-arch ed-arch2">
      <div className="ds-metrics ed-arch2__metrics">
        <MetricCard icon={<Archive size={20} />} value={statText(stats?.archivedJobs)} label={t("employerDashboard.archived.sumJobs")} />
        <MetricCard icon={<Users size={20} />} value={statText(stats?.totalApplicants)} label={t("employerDashboard.archived.sumApplicants")} />
        <MetricCard icon={<UserCheck size={20} />} value={statText(stats?.hiredCandidates)} label={t("employerDashboard.archived.sumHired")} className="ed-arch__metric--hired" />
        <MetricCard
          icon={<CalendarDays size={20} />}
          value={stats?.avgTimeToFillDays === null || stats?.avgTimeToFillDays === undefined ? "—" : t("employerDashboard.archived.daysShort", { count: stats.avgTimeToFillDays })}
          label={t("employerDashboard.archived.sumTimeToFill")}
          note={t("employerDashboard.archived.noteTimeToFill")}
        />
        <MetricCard icon={<Percent size={20} />} value={statText(stats?.fillRate, "%")} label={t("employerDashboard.archived.sumFillRate")} note={t("employerDashboard.archived.noteFillRate")} />
      </div>

      <div className="ed-arch__head">
        <h2 className="ed-arch__title">{t("employerDashboard.archived.title")}</h2>
        <div className="archived-search-bar">
          <FaSearch className="archived-search-icon" aria-hidden="true" />
          <input
            className="archived-search-input"
            placeholder={t("employerDashboard.archived.searchPlaceholder")}
            aria-label={t("employerDashboard.archived.searchLabel")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button type="button" className="archived-search-clear" onClick={() => setSearch("")} aria-label={t("employerDashboard.archived.clearSearch")}>
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="ed-arch2__controls">
        <div className="ed-arch2__chips" role="group" aria-label={t("employerDashboard.archived.filtersLabel")}>
          {FILTER_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`ed-arch2__chip ${filter === id ? "is-active" : ""}`}
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id);
                setPage(1);
              }}
            >
              {t(`employerDashboard.archived.filters.${FILTER_LABEL_KEY[id]}`)}
              {counts ? <span className="ed-arch2__chip-count">{counts[id] ?? 0}</span> : null}
            </button>
          ))}
        </div>
        <label className="ed-arch2__sort">
          <span>{t("employerDashboard.archived.sort.label")}</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
          >
            {SORT_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`employerDashboard.archived.sort.${id}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="ds-sr-only" role="status" aria-live="polite">
        {data && !loading && !failed ? t("employerDashboard.archived.resultsCount", { count: total }) : ""}
      </p>

      <div ref={listRef} className="ed-arch2__list" aria-busy={loading}>
        {!data && loading ? (
          <div className="ed-arch2__skeletons" role="status" aria-live="polite">
            <span className="ds-sr-only">{t("common.loading")}</span>
            {[0, 1, 2].map((n) => (
              <span key={n} className="ds-skeleton ed-arch2__skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : null}
        {failed ? (
          <StateBlock kind="error" title={t("employerDashboard.archived.loadErrorTitle")} description={t("employerDashboard.archived.loadErrorBody")} onRetry={retry} />
        ) : null}
        {empty === "none" ? (
          <StateBlock kind="empty" className="archived-empty-state" title={t("employerDashboard.archived.emptyTitle")} description={t("employerDashboard.archived.emptyBody")} />
        ) : null}
        {empty === "filtered" ? (
          <StateBlock
            kind="empty"
            className="archived-empty-state"
            title={t("employerDashboard.archived.noMatchTitle")}
            description={t("employerDashboard.archived.noMatchBody")}
            action={
              <button type="button" className="ds-btn ds-btn--secondary" onClick={clearFilters}>
                {t("employerDashboard.archived.clearFilters")}
              </button>
            }
          />
        ) : null}
        {!failed && items.length > 0 ? (
          <ul className="ed-arch2__items" aria-label={t("employerDashboard.archived.listLabel")}>
            {items.map((item) => (
              <ArchivedJobRow key={item._id} item={item} onViewApplicants={onViewApplicants} />
            ))}
          </ul>
        ) : null}
      </div>

      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        disabled={loading}
        label={t("pagination.items.jobs")}
        idPrefix="archived-jobs"
        scrollTargetRef={listRef}
        variant="card"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
