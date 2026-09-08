import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBullhorn,
  FaHeart,
  FaEye,
  FaEyeSlash,
  FaPen,
  FaTrashAlt,
  FaPlus,
  FaComments,
  FaCommentSlash,
} from "react-icons/fa";
import { newsAPI } from "../../services/api";
import { useToast, useConfirm } from "../../components/feedback/context";
import "../../styles/admin.css";
import "../../styles/newsAdmin.css";
import AdminHeader from "./AdminHeader";

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const excerpt = (text, max = 90) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "No content";
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

export default function NewsFeedManagement() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPosts = async () => {
    try {
      setLoading(true);
      const { data } = await newsAPI.listAdmin({ page: 1, limit: 20 });
      const published = Array.isArray(data?.items) ? data.items.filter((post) => post.isActive) : [];
      setPosts(published);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load news posts");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  const handleToggleStatus = async (post) => {
    try {
      await newsAPI.update(post._id, { isActive: !post.isActive });
      await loadPosts();
      toast.success(post.isActive ? "Announcement unpublished." : "Announcement published.");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update announcement status.");
    }
  };

  const handleToggleComments = async (post) => {
    try {
      await newsAPI.update(post._id, { commentsEnabled: !post.commentsEnabled });
      await loadPosts();
      toast.success(post.commentsEnabled ? "Comments disabled for this announcement." : "Comments enabled for this announcement.");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update comment setting.");
    }
  };

  const handleDelete = async (post) => {
    const ok = await confirm({
      title: "Delete this announcement?",
      message: `“${post.title}” will be permanently removed from the news feed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await newsAPI.remove(post._id);
      await loadPosts();
      toast.success("Announcement deleted.");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete announcement.");
    }
  };

  const stats = useMemo(() => {
    const totalLikes = posts.reduce((sum, post) => sum + Number(post.likeCount || 0), 0);
    const counts = posts.reduce((acc, post) => {
      const key = post.category || "general";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const topCategory = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    return { total: posts.length, totalLikes, topCategory };
  }, [posts]);

  return (
    <div className="admin-page-container na-scope">
      <AdminHeader
        title="News Feed Management"
        description="Manage live announcements displayed across the platform feed."
      />

      <div className="na-stats">
        <div className="na-stat">
          <div className="na-stat__value">{loading ? "—" : stats.total}</div>
          <div className="na-stat__label">Published announcements</div>
        </div>
        <div className="na-stat">
          <div className="na-stat__value">{loading ? "—" : stats.totalLikes}</div>
          <div className="na-stat__label">Total likes received</div>
        </div>
        <div className="na-stat">
          <div className="na-stat__value">{loading ? "—" : stats.topCategory}</div>
          <div className="na-stat__label">Most used category</div>
        </div>
      </div>

      <section className="na-panel">
        <div className="na-panel__head">
          <div className="na-panel__heading">
            <h2>Published Announcements</h2>
            {!loading ? <span className="na-count-chip">{posts.length}</span> : null}
          </div>
          <button type="button" className="na-btn na-btn--primary" onClick={() => navigate("/admin/news/create")}>
            <FaPlus aria-hidden="true" /> Post New Announcement
          </button>
        </div>

        {error ? <div className="na-alert">{error}</div> : null}

        <div className="na-table-wrap">
          <table className="na-table">
            <thead>
              <tr>
                <th>Announcement</th>
                <th>Category</th>
                <th>Published</th>
                <th>Likes</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2].map((row) => (
                  <tr key={row}>
                    <td><div className="na-skel" style={{ width: "70%" }} /></td>
                    <td><div className="na-skel" style={{ width: 70 }} /></td>
                    <td><div className="na-skel" style={{ width: 80 }} /></td>
                    <td><div className="na-skel" style={{ width: 32 }} /></td>
                    <td><div className="na-skel" style={{ width: 76 }} /></td>
                    <td><div className="na-skel" style={{ width: 80, marginLeft: "auto" }} /></td>
                  </tr>
                ))
              ) : posts.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="na-state">
                      <div className="na-state__icon"><FaBullhorn aria-hidden="true" /></div>
                      <h3>No announcements published yet</h3>
                      <p>Create your first update and it will appear in the public news feed.</p>
                      <button type="button" className="na-btn na-btn--primary" onClick={() => navigate("/admin/news/create")}>
                        <FaPlus aria-hidden="true" /> Post New Announcement
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr key={post._id}>
                    <td>
                      <div className="na-cell-title">
                        <strong>{post.title}</strong>
                        <span>{excerpt(post.content)}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`na-tag na-tag--${post.category || "general"}`}>
                        {post.category || "general"}
                      </span>
                    </td>
                    <td>{formatDate(post.publishedAt || post.createdAt)}</td>
                    <td>
                      <span className="na-cell-likes">
                        <FaHeart aria-hidden="true" /> {Number(post.likeCount || 0)}
                      </span>
                    </td>
                    <td><span className="na-status">Published</span></td>
                    <td>
                      <div className="na-row-actions">
                        <button
                          type="button"
                          className="na-icon-btn"
                          title="View"
                          aria-label={`View ${post.title}`}
                          onClick={() => navigate(`/news/${post._id}`)}
                        >
                          <FaEye aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="na-icon-btn"
                          title="Edit"
                          aria-label={`Edit ${post.title}`}
                          onClick={() => navigate(`/admin/news/edit/${post._id}`)}
                        >
                          <FaPen aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="na-icon-btn"
                          title={post.commentsEnabled ? "Disable comments" : "Enable comments"}
                          aria-label={`${post.commentsEnabled ? "Disable" : "Enable"} comments for ${post.title}`}
                          onClick={() => handleToggleComments(post)}
                        >
                          {post.commentsEnabled ? <FaComments aria-hidden="true" /> : <FaCommentSlash aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          className="na-icon-btn"
                          title="Unpublish"
                          aria-label={`Unpublish ${post.title}`}
                          onClick={() => handleToggleStatus(post)}
                        >
                          <FaEyeSlash aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="na-icon-btn na-icon-btn--danger"
                          title="Delete"
                          aria-label={`Delete ${post.title}`}
                          onClick={() => handleDelete(post)}
                        >
                          <FaTrashAlt aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
