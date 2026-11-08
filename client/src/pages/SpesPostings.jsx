import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaSearch } from "react-icons/fa";
import { spesAPI } from "../services/api";
import SpesPostingCard from "../components/SpesPostingCard";
import { translateErrorCode } from "../utils/apiErrors";
import { POSTING_TABS, matchesTab } from "../utils/spesPostings";
import "../styles/news-feed.css";
import "../styles/spes.css";

// The SPES feed: the same page layout as the news feed (green header, filter chips and
// search, a featured posting, then a grid of cards). 15-17 users apply from here; users
// aged 31 and older can read the postings but not apply (the server enforces both).
export default function SpesPostings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [ageTier, setAgeTier] = useState("unknown");
  const [tab, setTab] = useState("open");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await spesAPI.listPostings();
      setItems(Array.isArray(data?.items) ? data.items : []);
      setAgeTier(data?.ageTier || "unknown");
    } catch (err) {
      setError(translateErrorCode(err?.response?.data?.code, t("spesPostings.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        matchesTab(tab, item.posting) &&
        (!q || `${item.posting.title} ${item.posting.description}`.toLowerCase().includes(q))
    );
  }, [items, tab, search]);

  const openPosting = (id) => navigate(`/spes/postings/${id}`);
  const featured = !loading && !error ? visible[0] : null;
  const rest = featured ? visible.slice(1) : [];

  return (
    <main className="news-feed-page" aria-label={t("spesPostings.title")}>
      <section className="news-feed-header-wrap">
        <span className="news-feed-ring news-feed-ring--a" aria-hidden="true" />
        <span className="news-feed-ring news-feed-ring--b" aria-hidden="true" />
        <div className="news-feed-header">
          <h1>{t("spesPostings.title")}</h1>
          <p>{t("spesPostings.subtitle")}</p>
          <Link to="/spes/applications" className="ds-btn ds-btn--gold">
            {t("navbar.mySpesApplications")}
          </Link>
        </div>
      </section>

      <section className="news-feed-controls-wrap">
        <div className="news-feed-toolbar">
          <div className="news-filter-chips" role="tablist" aria-label={t("spesPostings.tabsLabel")}>
            {POSTING_TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`news-chip${tab === key ? " is-active" : ""}`}
                onClick={() => setTab(key)}
              >
                {t(`spesPostings.tab.${key}`)}
              </button>
            ))}
          </div>

          <div className="news-filter-select-wrap">
            <select
              className="news-filter-select"
              value={tab}
              onChange={(event) => setTab(event.target.value)}
              aria-label={t("spesPostings.tabsLabel")}
            >
              {POSTING_TABS.map((key) => (
                <option key={key} value={key}>
                  {t(`spesPostings.tab.${key}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="news-search">
            <FaSearch aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value.trimStart())}
              placeholder={t("spesPostings.searchPlaceholder")}
              aria-label={t("spesPostings.searchLabel")}
            />
          </div>
        </div>
      </section>

      <section className="news-feed-list-wrap">
        {ageTier === "minor15to17" ? (
          <p className="spes-notice spes-notice--info" role="note">{t("spesPostings.noticeMinor")}</p>
        ) : null}
        {ageTier === "adult31plus" ? (
          <p className="spes-notice spes-notice--info" role="note">{t("spesPostings.noticeSenior")}</p>
        ) : null}

        {loading ? (
          <div className="news-skeleton" role="status" aria-live="polite">
            <span className="ds-sr-only">{t("spesPostings.loading")}</span>
            <div className="news-grid" aria-hidden="true">
              {[0, 1, 2].map((n) => (
                <div key={n} className={`news-card news-card--skeleton${n === 1 ? " news-card--text" : ""}`}>
                  {n === 1 ? <span className="ds-skeleton news-sk-band" /> : <span className="ds-skeleton news-sk-media" />}
                  <div className="news-card__body">
                    <span className="ds-skeleton news-sk-line news-sk-line--badge" />
                    <span className="ds-skeleton news-sk-line news-sk-line--title" />
                    <span className="ds-skeleton news-sk-line" />
                    <span className="ds-skeleton news-sk-line news-sk-line--short" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="ds-empty news-empty news-state-error" role="alert">
            <h3 className="ds-empty__title">{t("spesPostings.errorTitle")}</h3>
            <p>{error}</p>
            <button type="button" className="ds-btn ds-btn--primary" onClick={load}>
              {t("spes.admin.retry")}
            </button>
          </div>
        ) : null}

        {!loading && !error && visible.length === 0 ? (
          <div className="ds-empty news-empty">
            <h3 className="ds-empty__title">
              {items.length === 0 ? t("spesPostings.emptyTitle") : t("spesPostings.emptyTabTitle")}
            </h3>
            <p>{items.length === 0 ? t("spesPostings.emptyBody") : t("spesPostings.emptyTabBody")}</p>
          </div>
        ) : null}

        {featured ? <SpesPostingCard item={featured} variant="featured" onOpen={openPosting} /> : null}

        {rest.length > 0 ? <h2 className="news-section-title">{t("spesPostings.morePostings")}</h2> : null}

        <div className="news-grid">
          {rest.map((item) => (
            <SpesPostingCard key={String(item.posting._id)} item={item} onOpen={openPosting} />
          ))}
        </div>
      </section>
    </main>
  );
}
