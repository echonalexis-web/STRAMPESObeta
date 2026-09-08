import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaHeart, FaRegHeart, FaRegComment, FaTrashAlt, FaCommentSlash } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { newsAPI, newsLikeAPI, newsCommentAPI, resolveAssetUrl } from "../services/api";
import { useToast, useConfirm } from "../components/feedback/context";
import ReportButton from "../components/ReportButton";
import SpesPanel from "../components/SpesPanel";
import "../styles/news-feed.css";
import "../styles/spes.css";

const CATEGORY_LABEL = {
  general: "General",
  hiring: "Hiring",
  training: "Training",
  event: "Events",
  advisory: "Advisory",
  spes: "SPES Program",
};

const categoryKey = (value) => (CATEGORY_LABEL[value] ? value : "general");

const getInitials = (name) => {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

const CommentAvatar = ({ author }) => {
  const src = author?.profileImage ? resolveAssetUrl(author.profileImage) : "";
  return (
    <span className="news-comment__avatar" aria-hidden="true">
      {src ? <img src={src} alt="" /> : getInitials(author?.name)}
    </span>
  );
};

const formatCommentDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

export default function NewsFeedDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useContext(AuthContext);
  const isLoggedIn = Boolean(user);

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");

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

  useEffect(() => {
    let active = true;
    const loadComments = async () => {
      try {
        setCommentsLoading(true);
        const { data } = await newsCommentAPI.list(id);
        if (!active) return;
        setComments(Array.isArray(data?.items) ? data.items : []);
      } catch (err) {
        if (active) setComments([]);
      } finally {
        if (active) setCommentsLoading(false);
      }
    };

    loadComments();
    return () => {
      active = false;
    };
  }, [id]);

  const handlePostComment = async (event) => {
    event.preventDefault();
    const content = commentDraft.trim();
    if (!content || commentSubmitting) return;

    try {
      setCommentSubmitting(true);
      setCommentError("");
      const { data } = await newsCommentAPI.create(id, content);
      if (data?.item) {
        setComments((prev) => [data.item, ...prev]);
      }
      setCommentDraft("");
    } catch (err) {
      setCommentError(err?.response?.data?.message || "Failed to post comment");
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    const ok = await confirm({
      title: "Delete this comment?",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await newsCommentAPI.remove(id, commentId);
      setComments((prev) => prev.filter((comment) => comment._id !== commentId));
      toast.success("Comment deleted.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete comment.");
    }
  };

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

  const catKey = categoryKey(item?.category);
  const likeCount = Number(item?.likeCount || 0);

  return (
    <main className="news-article-page" data-category={catKey} aria-label="Announcement detail">
      {loading ? (
        <div className="news-article-col">
          <button type="button" className="news-article-back--plain" onClick={() => navigate("/news")}>
            <FaArrowLeft /> Back to News Feed
          </button>
          <p className="news-state">Loading announcement...</p>
        </div>
      ) : null}
      {!loading && error ? (
        <div className="news-article-col">
          <button type="button" className="news-article-back--plain" onClick={() => navigate("/news")}>
            <FaArrowLeft /> Back to News Feed
          </button>
          <p className="news-state news-state-error">{error}</p>
        </div>
      ) : null}

      {!loading && !error && item ? (
        <article>
          <header className={`news-hero${item.imageUrl ? "" : " news-hero--placeholder"}`}>
            <button type="button" className="news-article-back" onClick={() => navigate("/news")}>
              <FaArrowLeft /> Back to News Feed
            </button>
            {item.imageUrl ? (
              <img src={resolveAssetUrl(item.imageUrl)} alt={item.title || "Announcement"} />
            ) : null}
            <div className="news-hero__caption">
              <span className="news-badge news-badge--onHero">{CATEGORY_LABEL[catKey]}</span>
              <h1>{item.title}</h1>
            </div>
          </header>

          <div className="news-article-layout">
            <div className="news-article-main">
              <div className="news-article-meta">
                <span>{item.author?.name || "PESO Admin"}</span>
                <span className="dot" />
                <span>{formatDate(item.publishedAt || item.createdAt)}</span>
              </div>

              <div className="news-article-body">
                {String(item.content || "")
                  .split("\n")
                  .filter(Boolean)
                  .map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
              </div>
            </div>

            <aside className="news-article-aside">
            {item.category === "spes" ? (
              <SpesPanel announcement={item} />
            ) : null}
            <div className="news-engagement-bar">
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
                <span>{likeCount} {likeCount === 1 ? "like" : "likes"}</span>
              </button>
              <span className="news-engagement__comments">
                <FaRegComment aria-hidden="true" />
                {commentsLoading ? "—" : comments.length} {comments.length === 1 ? "comment" : "comments"}
              </span>
            </div>

            <section className="news-comments" aria-label="Comments">
              <h2 className="news-comments__title">
                Comments {commentsLoading ? "" : `(${comments.length})`}
              </h2>

              {item.commentsEnabled === false ? (
                <p className="news-comments__disabled">
                  <FaCommentSlash aria-hidden="true" /> Comments are disabled for this announcement.
                </p>
              ) : (
                <>
                  {isLoggedIn ? (
                    <form className="news-comments__form" onSubmit={handlePostComment}>
                      <textarea
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        placeholder="Write a comment…"
                        maxLength={1000}
                        rows={3}
                      />
                      <button type="submit" className="news-comments__submit" disabled={!commentDraft.trim() || commentSubmitting}>
                        {commentSubmitting ? "Posting…" : "Post Comment"}
                      </button>
                    </form>
                  ) : (
                    <p className="news-comments__login-hint">Log in to join the conversation.</p>
                  )}

                  {commentError ? <p className="news-state news-state-error">{commentError}</p> : null}

                  {commentsLoading ? (
                    <p className="news-state">Loading comments...</p>
                  ) : comments.length === 0 ? (
                    <p className="news-comments__empty">No comments yet. Be the first to comment.</p>
                  ) : (
                    <ul className="news-comments__list">
                      {comments.map((comment) => {
                        const currentUserId = String(user?._id || user?.id || "");
                        const isOwnComment = currentUserId === String(comment.author?._id);
                        const canDelete = isLoggedIn && (isOwnComment || user?.role === "admin");
                        return (
                          <li key={comment._id} className="news-comment">
                            <CommentAvatar author={comment.author} />
                            <div className="news-comment__main">
                              <div className="news-comment__head">
                                <strong>{comment.author?.name || "User"}</strong>
                                <span>{formatCommentDate(comment.createdAt)}</span>
                              </div>
                              <p className="news-comment__body">{comment.content}</p>
                              <div className="news-comment__actions">
                                {isLoggedIn && !isOwnComment && user?.role !== "admin" ? (
                                  <ReportButton
                                    targetType="news_comment"
                                    targetId={comment._id}
                                    targetOwnerId={comment.author?._id}
                                    variant="link"
                                  />
                                ) : null}
                                {canDelete ? (
                                  <button
                                    type="button"
                                    className="news-comment__delete"
                                    onClick={() => handleDeleteComment(comment._id)}
                                    aria-label="Delete comment"
                                  >
                                    <FaTrashAlt aria-hidden="true" />
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </section>
            </aside>
          </div>
        </article>
      ) : null}
    </main>
  );
}
