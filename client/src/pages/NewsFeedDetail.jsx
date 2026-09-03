import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaHeart, FaRegHeart } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { newsAPI, newsLikeAPI, resolveAssetUrl } from "../services/api";
import "../styles/news-feed.css";

const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

export default function NewsFeedDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const isLoggedIn = Boolean(user);

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    const loadPost = async () => {
      try {
        setLoading(true);
        const { data } = await newsAPI.getById(id);
        if (!active) return;
        setItem(data || null);
        setError("");
      } catch (err) {
        if (!active) return;
        setItem(null);
        setError(err?.response?.data?.message || "This announcement is no longer available.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadPost();
    return () => {
      active = false;
    };
  }, [id]);

  const handleToggleLike = async () => {
    if (!item || !isLoggedIn || pending) return;

    const nextLiked = !item.likedByMe;
    setItem((prev) => ({
      ...prev,
      likedByMe: nextLiked,
      likeCount: Math.max(0, Number(prev.likeCount || 0) + (nextLiked ? 1 : -1)),
    }));
    setPending(true);

    try {
      const { data } = nextLiked ? await newsLikeAPI.like(id) : await newsLikeAPI.unlike(id);
      const serverCount = data?.data?.likeCount;
      if (typeof serverCount === "number") {
        setItem((prev) => ({ ...prev, likeCount: serverCount, likedByMe: nextLiked }));
      }
    } catch (err) {
      setItem((prev) => ({
        ...prev,
        likedByMe: !nextLiked,
        likeCount: Math.max(0, Number(prev.likeCount || 0) + (nextLiked ? -1 : 1)),
      }));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="news-feed-page news-detail-page" aria-label="Announcement detail">
      <section className="news-feed-header-wrap">
        <button type="button" className="news-detail-back" onClick={() => navigate("/news")}>
          <FaArrowLeft /> Back to News Feed
        </button>

        {loading ? <p className="news-state">Loading announcement...</p> : null}
        {!loading && error ? <p className="news-state news-state-error">{error}</p> : null}

        {!loading && !error && item ? (
          <article className="news-detail-card">
            <span className="news-card-tag">{item.category || "general"}</span>
            <h1>{item.title}</h1>
            <div className="news-detail-meta">
              <span>{formatDate(item.publishedAt || item.createdAt)}</span>
              <span>{item.author?.name || "PESO Admin"}</span>
            </div>

            {item.imageUrl ? (
              <div className="news-detail-media">
                <img src={resolveAssetUrl(item.imageUrl)} alt={item.title || "Announcement"} />
              </div>
            ) : null}

            <div className="news-detail-content">
              {String(item.content || "")
                .split("\n")
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
            </div>

            <div className="news-detail-actions">
              <button
                type="button"
                className={`news-like-btn${item.likedByMe ? " is-liked" : ""}`}
                onClick={handleToggleLike}
                disabled={!isLoggedIn || pending}
                aria-pressed={Boolean(item.likedByMe)}
                aria-label={item.likedByMe ? "Unlike this announcement" : "Like this announcement"}
                title={isLoggedIn ? undefined : "Log in to like announcements"}
              >
                {item.likedByMe ? <FaHeart /> : <FaRegHeart />}
                <span>{Number(item.likeCount || 0)} {Number(item.likeCount || 0) === 1 ? "like" : "likes"}</span>
              </button>
            </div>
          </article>
        ) : null}
      </section>
    </main>
  );
}
