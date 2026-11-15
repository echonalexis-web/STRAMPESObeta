import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaHeart, FaRegHeart, FaSearch } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { newsAPI, newsLikeAPI } from "../services/api";
import NewsCard from "../components/NewsCard";
import Pagination from "../components/Pagination";
import useParallaxLayer from "../hooks/useParallaxLayer";
import { NEWS_FEED_LOADED_EVENT, NEWS_REFRESH_EVENT, newsItemTime } from "../utils/newsEvents";
import { localDayEndIso, localDayStartIso } from "../utils/newsDateRange";
import "../styles/news-feed.css";

// Page 1 shows the newest announcement as the featured story, then the next six
// in the grid (7 items). Every later page is six grid cards, so the pager counts
// the grid items only (total minus the featured one).
const PAGE_SIZE = 6;
const featuredCount = (page) => (page === 1 ? 1 : 0);
const totalPagesFor = (total) => Math.max(Math.ceil(Math.max(total - 1, 0) / PAGE_SIZE), 1);

const CATEGORIES = [
  { label: "All", value: "" },
  { label: "General", value: "general" },
  { label: "Hiring", value: "hiring" },
  { label: "Training", value: "training" },
  { label: "Events", value: "event" },
  { label: "Advisory", value: "advisory" },
  { label: "SPES", value: "spes" },
];

export default function NewsFeed() {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const isLoggedIn = Boolean(user);
  const { t } = useTranslation();
  // Decorative header ring only. The `mx-parallax` class (which consumes the
  // controller's --mx-y) is added for signed-in visitors only, so the guest
  // view of /news stays static and identical.
  const ringRef = useParallaxLayer(0.1, 24);

  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const listRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingLikes, setPendingLikes] = useState({});
  // Bumped by the realtime toast's Refresh button: reloads the feed in place
  // with the current category / search, without a full page reload.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const loadNews = async () => {
      try {
        setLoading(true);
        const { data } = await newsAPI.list({
          category: category || undefined,
          search: search || undefined,
          from: localDayStartIso(dateFrom),
          to: localDayEndIso(dateTo),
          // Page 1: items 1-7 (featured + six). Page n: six items after those.
          page: 1,
          offset: page === 1 ? 0 : 1 + (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE + featuredCount(page),
        });
        if (!active) return;
        const loaded = Array.isArray(data?.items) ? data.items : [];
        const serverTotal = Number(data?.total ?? loaded.length);
        const serverPages = totalPagesFor(serverTotal);
        // A page that no longer exists (items were removed): step back to the last one.
        if (loaded.length === 0 && page > serverPages) {
          setPage(serverPages);
          return;
        }
        setItems(loaded);
        setTotal(serverTotal);
        setError("");
        // Tell the realtime toast what is on screen, so it can drop those
        // items from its "new" count. Only an unfiltered load is a valid
        // "newest item" marker.
        window.dispatchEvent(
          new CustomEvent(NEWS_FEED_LOADED_EVENT, {
            detail: {
              ids: loaded.map((item) => String(item?._id || "")).filter(Boolean),
              newestAt: Math.max(0, ...loaded.map(newsItemTime)),
              // Only the first page with no filter shows the newest item.
              filtered: Boolean(category || search || dateFrom || dateTo || page > 1),
            },
          }),
        );
      } catch (err) {
        if (!active) return;
        setItems([]);
        setError(err?.response?.data?.message || "Unable to load news right now. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    };

    // Debounced so typing a full search term doesn't fire a request per
    // keystroke (matches the pattern already used for search in Messages.jsx)
    // — category changes (not typed) still take effect immediately.
    const timer = window.setTimeout(loadNews, search ? 300 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [category, search, dateFrom, dateTo, page, refreshKey]);

  // Any filter change goes back to the first page.
  const changeCategory = (value) => {
    setCategory(value);
    setPage(1);
  };
  const changeDateFrom = (value) => {
    setDateFrom(value);
    setPage(1);
  };
  const changeDateTo = (value) => {
    setDateTo(value);
    setPage(1);
  };
  const hasFilters = Boolean(category || search || dateFrom || dateTo);
  const clearFilters = () => {
    setCategory("");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  // Realtime toast -> "Refresh": reload with the current filters and go back
  // to the top, where the new items appear.
  useEffect(() => {
    const handleRefreshRequest = () => {
      setPage(1);
      setRefreshKey((key) => key + 1);
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    };
    window.addEventListener(NEWS_REFRESH_EVENT, handleRefreshRequest);
    return () => window.removeEventListener(NEWS_REFRESH_EVENT, handleRefreshRequest);
  }, []);

  const title = useMemo(() => (category ? `${category[0].toUpperCase()}${category.slice(1)} Updates` : "Community Announcements"), [category]);

  const openPost = (id) => navigate(`/news/${id}`);

  const handleToggleLike = async (item) => {
    const id = String(item?._id || "");
    if (!id || !isLoggedIn || pendingLikes[id]) return;

    const nextLiked = !item.likedByMe;

    // Optimistic update
    setItems((prev) =>
      prev.map((entry) =>
        String(entry._id) === id
          ? {
              ...entry,
              likedByMe: nextLiked,
              likeCount: Math.max(0, Number(entry.likeCount || 0) + (nextLiked ? 1 : -1)),
            }
          : entry,
      ),
    );
    setPendingLikes((prev) => ({ ...prev, [id]: true }));

    try {
      const { data } = nextLiked ? await newsLikeAPI.like(id) : await newsLikeAPI.unlike(id);
      const serverCount = data?.data?.likeCount;
      if (typeof serverCount === "number") {
        setItems((prev) =>
          prev.map((entry) =>
            String(entry._id) === id ? { ...entry, likeCount: serverCount, likedByMe: nextLiked } : entry,
          ),
        );
      }
    } catch (err) {
      // Roll back
      setItems((prev) =>
        prev.map((entry) =>
          String(entry._id) === id
            ? {
                ...entry,
                likedByMe: !nextLiked,
                likeCount: Math.max(0, Number(entry.likeCount || 0) + (nextLiked ? -1 : 1)),
              }
            : entry,
        ),
      );
    } finally {
      setPendingLikes((prev) => {
        const clone = { ...prev };
        delete clone[id];
        return clone;
      });
    }
  };

  const renderLikeButton = (item) => {
    const id = String(item?._id || "");
    const liked = Boolean(item?.likedByMe);
    return (
      <button
        type="button"
        className={`news-like-btn${liked ? " is-liked" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          handleToggleLike(item);
        }}
        disabled={!isLoggedIn || Boolean(pendingLikes[id])}
        aria-pressed={liked}
        aria-label={liked ? "Unlike this announcement" : "Like this announcement"}
        title={isLoggedIn ? undefined : "Log in to like announcements"}
      >
        {liked ? <FaHeart /> : <FaRegHeart />}
        <span>{Number(item?.likeCount || 0)}</span>
      </button>
    );
  };

  // The newest item is featured on the first page only; later pages are plain grids.
  const featured = !loading && !error && page === 1 ? items[0] : null;
  const rest = !loading && !error ? (featured ? items.slice(1) : items) : [];

  return (
    <main className="news-feed-page" aria-label="STRAM PESO News Feed">
      <section className="news-feed-header-wrap">
        <span
          ref={ringRef}
          className={`news-feed-ring news-feed-ring--a${isLoggedIn ? " mx-parallax" : ""}`}
          aria-hidden="true"
        />
        <span className="news-feed-ring news-feed-ring--b" aria-hidden="true" />
        <div className="news-feed-header">
          <h1>{title}</h1>
          <p>Official updates, opportunities, advisories, and events from STRAM PESO.</p>
        </div>
      </section>

      <section className="news-feed-controls-wrap">
        <div className="news-feed-toolbar">
          <div className="news-filter-chips" role="tablist" aria-label="News categories">
            {CATEGORIES.map((option) => (
              <button
                key={option.label}
                type="button"
                role="tab"
                aria-selected={category === option.value}
                data-category={option.value}
                className={`news-chip${category === option.value ? " is-active" : ""}`}
                onClick={() => changeCategory(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="news-filter-select-wrap">
            <select
              className="news-filter-select"
              value={category}
              onChange={(event) => changeCategory(event.target.value)}
              aria-label="Filter announcements by category"
            >
              {CATEGORIES.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="news-search">
            <FaSearch aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value.trimStart());
                setPage(1);
              }}
              placeholder="Search announcements..."
              aria-label="Search announcements"
            />
          </div>

          <div className="news-date-filter" role="group" aria-label={t("news.filters.dateGroup")}>
            <label className="news-date-field">
              <span>{t("news.filters.dateFrom")}</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(event) => changeDateFrom(event.target.value)}
              />
            </label>
            <label className="news-date-field">
              <span>{t("news.filters.dateTo")}</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => changeDateTo(event.target.value)}
              />
            </label>
            {hasFilters ? (
              <button type="button" className="news-clear-filters" onClick={clearFilters}>
                {t("news.filters.clear")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="news-feed-list-wrap" ref={listRef}>
        {loading ? (
          <div className="news-skeleton" role="status" aria-live="polite">
            <span className="ds-sr-only">Loading announcements...</span>
            <div className="news-grid" aria-hidden="true">
              {[0, 1, 2].map((n) => (
                <div key={n} className={`news-card news-card--skeleton${n === 1 ? " news-card--text" : ""}`}>
                  {n === 1 ? <span className="ds-skeleton news-sk-band" /> : <span className="ds-skeleton news-sk-media" />}
                  <div className="news-card__body">
                    <span className="ds-skeleton news-sk-line news-sk-line--badge" />
                    <span className="ds-skeleton news-sk-line news-sk-line--title" />
                    <span className="ds-skeleton news-sk-line" />
                    <span className="ds-skeleton news-sk-line news-sk-line--short" />
                    {n === 1 ? <span className="ds-skeleton news-sk-line" /> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {!loading && error ? (
          <div className="ds-empty news-empty news-state-error" role="alert">
            <h3 className="ds-empty__title">Unable to load news</h3>
            <p>{error}</p>
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <div className="ds-empty news-empty">
            <h3 className="ds-empty__title">No announcements found.</h3>
            <p>{hasFilters ? t("news.filters.emptyFiltered") : "Try another category or a different search term."}</p>
          </div>
        ) : null}

        {featured ? (
          <NewsCard
            item={featured}
            variant="featured"
            isLoggedIn={isLoggedIn}
            onOpen={openPost}
            likeButton={renderLikeButton(featured)}
          />
        ) : null}

        {isLoggedIn && rest.length > 0 ? (
          <h2 className="news-section-title">{t("news.moreFrom")}</h2>
        ) : null}

        <div className="news-grid">
          {rest.map((item) => (
            <NewsCard
              key={String(item?._id || "")}
              item={item}
              isLoggedIn={isLoggedIn}
              onOpen={openPost}
              likeButton={renderLikeButton(item)}
            />
          ))}
        </div>

        {!error ? (
          <Pagination
            variant="card"
            idPrefix="news-pager"
            total={Math.max(total - 1, 0)}
            page={page}
            pageSize={PAGE_SIZE}
            showPageSize={false}
            disabled={loading}
            label={t("pagination.items.announcements")}
            scrollTargetRef={listRef}
            onPageChange={setPage}
          />
        ) : null}
      </section>
    </main>
  );
}
