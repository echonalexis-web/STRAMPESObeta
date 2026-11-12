import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useSegmentedRail from "../hooks/useSegmentedRail";
import { FaHeart, FaRegHeart, FaSearch } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { newsAPI, newsLikeAPI } from "../services/api";
import NewsCard from "../components/NewsCard";
import useParallaxLayer from "../hooks/useParallaxLayer";
import { NEWS_FEED_LOADED_EVENT, NEWS_REFRESH_EVENT, newsItemTime } from "../utils/newsEvents";
import "../styles/news-feed.css";

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
  const railRef = useSegmentedRail();
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
        const { data } = await newsAPI.list({ category: category || undefined, search: search || undefined, page: 1, limit: 30 });
        if (!active) return;
        const loaded = Array.isArray(data?.items) ? data.items : [];
        setItems(loaded);
        setError("");
        // Tell the realtime toast what is on screen, so it can drop those
        // items from its "new" count. Only an unfiltered load is a valid
        // "newest item" marker.
        window.dispatchEvent(
          new CustomEvent(NEWS_FEED_LOADED_EVENT, {
            detail: {
              ids: loaded.map((item) => String(item?._id || "")).filter(Boolean),
              newestAt: Math.max(0, ...loaded.map(newsItemTime)),
              filtered: Boolean(category || search),
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
  }, [category, search, refreshKey]);

  // Realtime toast -> "Refresh": reload with the current filters and go back
  // to the top, where the new items appear.
  useEffect(() => {
    const handleRefreshRequest = () => {
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

  const featured = !loading && !error ? items[0] : null;
  const rest = featured ? items.slice(1) : [];

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
          <div ref={railRef} className="news-filter-chips seg-rail" role="tablist" aria-label="News categories">
            {CATEGORIES.map((option) => (
              <button
                key={option.label}
                type="button"
                role="tab"
                aria-selected={category === option.value}
                data-category={option.value}
                className={`news-chip${category === option.value ? " is-active" : ""}`}
                onClick={() => setCategory(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="news-filter-select-wrap">
            <select
              className="news-filter-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
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
              onChange={(event) => setSearch(event.target.value.trimStart())}
              placeholder="Search announcements..."
              aria-label="Search announcements"
            />
          </div>
        </div>
      </section>

      <section className="news-feed-list-wrap">
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
            <p>Try another category or a different search term.</p>
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
      </section>
    </main>
  );
}
