import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaHeart, FaRegHeart } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { newsAPI, newsLikeAPI, resolveAssetUrl } from "../services/api";
import "../styles/news-feed.css";

const CATEGORIES = [
  { label: "All", value: "" },
  { label: "General", value: "general" },
  { label: "Hiring", value: "hiring" },
  { label: "Training", value: "training" },
  { label: "Events", value: "event" },
  { label: "Advisory", value: "advisory" },
];

const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function NewsFeed() {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const isLoggedIn = Boolean(user);

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

    loadNews();
    return () => {
      active = false;
    };
  }, [category, search]);

  const title = useMemo(() => (category ? `${category[0].toUpperCase()}${category.slice(1)} Updates` : "Community Announcements"), [category]);

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

  return (
    <main className="news-feed-page" aria-label="STRAM PESO News Feed">
      <section className="news-feed-header-wrap">
        <div className="news-feed-header">
          <h1>{title}</h1>
          <p>Official updates, opportunities, advisories, and events from STRAM PESO.</p>
        </div>
      </section>

      <section className="news-feed-controls-wrap">
        <div className="news-feed-controls">
          <div className="news-pills" role="tablist" aria-label="News categories">
            {CATEGORIES.map((option) => (
              <button
                key={option.label}
                type="button"
                className={category === option.value ? "active" : ""}
                onClick={() => setCategory(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value.trimStart())}
            placeholder="Search announcements..."
            aria-label="Search announcements"
          />
        </div>
      </section>

      <section className="news-feed-list-wrap">
        {loading ? <p className="news-state">Loading announcements...</p> : null}
        {!loading && error ? <p className="news-state news-state-error">{error}</p> : null}
        {!loading && !error && items.length === 0 ? <p className="news-state">No announcements found.</p> : null}

        <div className="news-feed-grid">
          {!loading && !error
            ? items.map((item) => {
                const id = String(item?._id || "");
                const label = String(item?.category || "general");
                const liked = Boolean(item?.likedByMe);
                const likeCount = Number(item?.likeCount || 0);
                return (
                  <article key={id} className="news-card">
                    {item?.imageUrl ? (
                      <div
                        className="news-card-media"
                        onClick={() => navigate(`/news/${id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") navigate(`/news/${id}`);
                        }}
                      >
                        <img src={resolveAssetUrl(item.imageUrl)} alt={item?.title || "Announcement"} loading="lazy" />
                      </div>
                    ) : null}
                    <div className="news-card-body">
                      <span className="news-card-tag">{label}</span>
                      <h2>
                        <button type="button" className="news-card-title-link" onClick={() => navigate(`/news/${id}`)}>
                          {item?.title || "Untitled update"}
                        </button>
                      </h2>
                      <p>{item?.content || "No details available."}</p>
                      <div className="news-card-meta">
                        <span>{formatDate(item?.publishedAt)}</span>
                        <span>{item?.author?.name || "PESO Admin"}</span>
                      </div>
                      <div className="news-card-actions">
                        <button
                          type="button"
                          className={`news-like-btn${liked ? " is-liked" : ""}`}
                          onClick={() => handleToggleLike(item)}
                          disabled={!isLoggedIn || Boolean(pendingLikes[id])}
                          aria-pressed={liked}
                          aria-label={liked ? "Unlike this announcement" : "Like this announcement"}
                          title={isLoggedIn ? undefined : "Log in to like announcements"}
                        >
                          {liked ? <FaHeart /> : <FaRegHeart />}
                          <span>{likeCount}</span>
                        </button>
                        <button type="button" className="news-readmore-btn" onClick={() => navigate(`/news/${id}`)}>
                          Read more
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            : null}
        </div>
      </section>
    </main>
  );
}
