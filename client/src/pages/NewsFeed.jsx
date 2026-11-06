import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaHeart, FaRegHeart, FaSearch } from "react-icons/fa";
import { ArrowRight } from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import { newsAPI, newsLikeAPI, resolveAssetUrl } from "../services/api";
import useParallaxLayer from "../hooks/useParallaxLayer";
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

// Human label per stored category value (feed cards + badges).
const CATEGORY_LABEL = {
  general: "General",
  hiring: "Hiring",
  training: "Training",
  event: "Events",
  advisory: "Advisory",
  spes: "SPES Program",
};

const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Plain-text excerpt from the announcement body.
const excerpt = (text, max = 180) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "No details available.";
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

const categoryKey = (value) => (CATEGORY_LABEL[value] ? value : "general");

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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingLikes, setPendingLikes] = useState({});

  useEffect(() => {
    let active = true;
    const loadNews = async () => {
      try {
        setLoading(true);
        const { data } = await newsAPI.list({ category: category || undefined, search: search || undefined, page: 1, limit: 30 });
        if (!active) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setError("");
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
  }, [category, search]);

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
          <div className="news-filter-chips" role="tablist" aria-label="News categories">
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
                <div key={n} className="news-card news-card--skeleton">
                  <span className="ds-skeleton news-sk-media" />
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
          <article
            className="news-featured"
            data-category={categoryKey(featured.category)}
            onClick={() => openPost(featured._id)}
            role="link"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter") openPost(featured._id);
            }}
          >
            <div className={`news-featured__media${featured.imageUrl ? "" : " news-featured__media--placeholder"}`}>
              {featured.imageUrl ? (
                <img src={resolveAssetUrl(featured.imageUrl)} alt={featured.title || "Announcement"} loading="lazy" />
              ) : (
                <span className="news-featured__glyph">{CATEGORY_LABEL[categoryKey(featured.category)]}</span>
              )}
            </div>
            <div className="news-featured__body">
              <span className="news-badge">{CATEGORY_LABEL[categoryKey(featured.category)]}</span>
              <h2>{featured.title || "Untitled update"}</h2>
              <p className="news-featured__excerpt">{excerpt(featured.content, 260)}</p>
              <div className="news-featured__foot">
                {renderLikeButton(featured)}
                <span>{formatDate(featured.publishedAt || featured.createdAt)}</span>
                <span>{featured.author?.name || "PESO Admin"}</span>
              </div>
              {/* Signed-in banner only: a visual cue, not a second control —
                  the whole article is already the link. */}
              {isLoggedIn ? (
                <span className="ds-btn ds-btn--gold news-featured__cta" aria-hidden="true">
                  {t("news.readStory")} <ArrowRight size={16} />
                </span>
              ) : null}
            </div>
          </article>
        ) : null}

        {isLoggedIn && rest.length > 0 ? (
          <h2 className="news-section-title">{t("news.moreFrom")}</h2>
        ) : null}

        <div className="news-grid">
          {rest.map((item) => {
            const id = String(item?._id || "");
            const key = categoryKey(item?.category);
            return (
              <article
                key={id}
                className="news-card"
                data-category={key}
                onClick={() => openPost(id)}
                role="link"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") openPost(id);
                }}
              >
                <div className={`news-card__media${item?.imageUrl ? "" : " news-card__media--placeholder"}`}>
                  {item?.imageUrl ? (
                    <img src={resolveAssetUrl(item.imageUrl)} alt={item?.title || "Announcement"} loading="lazy" />
                  ) : (
                    <span>{CATEGORY_LABEL[key]}</span>
                  )}
                </div>
                <div className="news-card__body">
                  <span className="news-badge">{CATEGORY_LABEL[key]}</span>
                  <h2 className="news-card__title">{item?.title || "Untitled update"}</h2>
                  <p className="news-card__excerpt">{excerpt(item?.content, 140)}</p>
                  <div className="news-card__foot">
                    {renderLikeButton(item)}
                    <span>{formatDate(item?.publishedAt || item?.createdAt)}</span>
                    {isLoggedIn ? (
                      <span className="news-card__more" aria-hidden="true">
                        {t("news.readMore")} <ArrowRight size={14} />
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
