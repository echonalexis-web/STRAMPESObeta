import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { spesAPI } from "../services/api";
import StateBlock from "../components/StateBlock";
import Pagination from "../components/Pagination";
import usePagination from "../hooks/usePagination";
import ApplicationsHeader from "../components/spesApplications/ApplicationsHeader";
import ApplicationsToolbar from "../components/spesApplications/ApplicationsToolbar";
import ApplicationRow from "../components/spesApplications/ApplicationRow";
import { useConfirm, useToast } from "../components/feedback/context";
import { translateErrorCode } from "../utils/apiErrors";
import { uploadErrorCode } from "../utils/spesUploadLimits";
import { normalizeSpesStatus } from "../utils/spesSlots";
import {
  countGroups,
  initialOpenId,
  matchesFilter,
  searchApplications,
  sortApplications,
} from "../utils/spesApplications";
import "../styles/spes.css";
import "../styles/file-upload.css";
import "../styles/spes-my-applications.css";

// Applicant "My SPES Applications": a header band with stat tiles, filters and sort, then one
// collapsed row per application that opens to the tracker, documents and next step.
// Only one row is open at a time (component state only, not persisted).
export default function MySpesApplications() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);

  const formatDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(i18n.language?.startsWith("fil") ? "fil-PH" : "en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await spesAPI.getMine();
      const next = Array.isArray(data?.items) ? data.items : [];
      setItems(next);
      setOpenId(initialOpenId(sortApplications(next, "newest")));
    } catch (err) {
      setError(translateErrorCode(err?.response?.data?.code, t("applications.spesErrorBody")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    // Load once on mount; a language change must not refetch or reset the open row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Responses for a single application do not populate the posting, so keep ours.
  const mergeApplication = (current, next) => ({ ...current, ...next, posting: current.posting });
  const replaceItem = (id, next) =>
    setItems((prev) => prev.map((it) => (it._id === id ? mergeApplication(it, next) : it)));

  const handleUpload = (app) => async (slot, file, config = {}) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await spesAPI.replaceDocument(app.posting?._id, slot, fd, config);
      replaceItem(app._id, data.application);
      toast.success(t("spes.docs.uploaded"));
      return null;
    } catch (err) {
      return uploadErrorCode(err);
    }
  };

  const handleWithdraw = async (app) => {
    const ok = await confirm({
      title: t("spes.withdraw.title"),
      message: t("spes.withdraw.body"),
      confirmLabel: t("spes.withdraw.confirm"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { data } = await spesAPI.withdraw(app.posting?._id);
      replaceItem(app._id, data.application);
      toast.success(t("spes.withdraw.done"));
    } catch (err) {
      toast.error(translateErrorCode(err?.response?.data?.code, t("spes.withdraw.failed")));
    }
  };

  const titleOf = useCallback((app) => app.posting?.title || t("spes.my.programFallback"), [t]);
  const counts = useMemo(() => countGroups(items), [items]);
  const visible = useMemo(() => {
    const filtered = items.filter((app) => matchesFilter(app, filter));
    return sortApplications(searchApplications(filtered, query, titleOf), sort);
  }, [items, filter, query, sort, titleOf]);

  // Ten applications per page; a filter, sort or search change returns to page 1.
  const pageRef = useRef(null);
  const pager = usePagination(visible, { resetKey: `${filter}|${sort}|${query}` });

  const clearFilters = () => {
    setFilter("all");
    setQuery("");
  };

  const ready = !loading && !error;

  return (
    <main className="spes-page spes-apps" ref={pageRef}>
      <ApplicationsHeader counts={counts} filter={filter} onFilter={setFilter} />

      {loading ? (
        <div className="spes-apps__skeleton" role="status" aria-live="polite">
          <span className="ds-sr-only">{t("applications.spesLoading")}</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className="spes-apps__skeleton-row" aria-hidden="true">
              <span className="ds-skeleton spes-apps__skeleton-icon" />
              <span className="ds-skeleton spes-apps__skeleton-line" />
              <span className="ds-skeleton spes-apps__skeleton-chip" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <StateBlock
          kind="error"
          title={t("applications.spesErrorTitle")}
          description={error}
          action={
            <button type="button" className="ds-btn ds-btn--primary" onClick={load}>
              {t("spes.my.retry")}
            </button>
          }
        />
      ) : null}

      {ready && items.length === 0 ? (
        <StateBlock
          kind="empty"
          title={t("applications.spesEmptyTitle")}
          description={t("applications.spesEmptyBody")}
          action={
            <Link to="/spes/postings" className="ds-btn ds-btn--primary">
              {t("spes.my.browse")}
            </Link>
          }
        />
      ) : null}

      {ready && items.length > 0 ? (
        <>
          <ApplicationsToolbar
            filter={filter}
            onFilter={setFilter}
            sort={sort}
            onSort={setSort}
            query={query}
            onQuery={setQuery}
            total={items.length}
            counts={counts}
          />

          <p className="ds-sr-only" role="status" aria-live="polite">
            {t("spes.my.shown", { count: visible.length })}
          </p>

          {visible.length === 0 ? (
            <StateBlock
              kind="empty"
              title={t("spes.my.noMatchTitle")}
              description={t("spes.my.noMatchBody")}
              action={
                <button type="button" className="ds-btn ds-btn--secondary" onClick={clearFilters}>
                  {t("spes.my.clearFilter")}
                </button>
              }
            />
          ) : (
            <ul className="spes-apps__list" aria-label={t("spes.my.listLabel")}>
              {pager.pageItems.map((app) => {
                const id = String(app._id);
                return (
                  <ApplicationRow
                    key={id}
                    app={app}
                    status={normalizeSpesStatus(app.status)}
                    title={titleOf(app)}
                    dateText={formatDate(app.createdAt)}
                    open={openId === id}
                    onToggle={() => setOpenId((current) => (current === id ? null : id))}
                    onUpload={handleUpload(app)}
                    onWithdraw={handleWithdraw}
                  />
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {!error ? (
        <Pagination
          {...pager.paginationProps}
          variant="card"
          idPrefix="my-spes"
          label={t("pagination.items.applications")}
          disabled={loading}
          scrollTargetRef={pageRef}
        />
      ) : null}
    </main>
  );
}
