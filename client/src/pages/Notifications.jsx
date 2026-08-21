import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FaBell, FaCheck, FaTrash } from "react-icons/fa";
import { useNotifications } from "../hooks/useNotifications";
import "../styles/notifications.css";

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function Notifications() {
  const navigate = useNavigate();
  const {
    notifications,
    loading,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications({ initialLimit: 100, autoLoad: true });

  const hasItems = notifications.length > 0;

  const sortedItems = useMemo(() => {
    return [...notifications].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [notifications]);

  const handleOpen = async (item) => {
    if (!item?.isRead) {
      await markAsRead(item._id);
    }

    if (item?.actionUrl) {
      navigate(item.actionUrl);
    }
  };

  return (
    <main className="notifications-page">
      <header className="notifications-page__header">
        <div>
          <h1>Notifications</h1>
          <p>Track your latest activity updates in one place.</p>
        </div>

        <button
          type="button"
          className="notifications-page__read-all"
          onClick={markAllAsRead}
          disabled={unreadCount === 0}
        >
          <FaCheck aria-hidden="true" />
          <span>Mark all read</span>
        </button>
      </header>

      {loading && <p className="notifications-page__state">Loading notifications...</p>}
      {!loading && !hasItems && <p className="notifications-page__state">No notifications yet.</p>}

      {!loading && hasItems && (
        <section className="notifications-list" aria-label="Notification list">
          {sortedItems.map((item) => (
            <article
              key={item._id}
              className={`notification-card ${item.isRead ? "notification-card--read" : "notification-card--unread"}`}
            >
              <button
                type="button"
                className="notification-card__main"
                onClick={() => handleOpen(item)}
              >
                <div className="notification-card__icon" aria-hidden="true">
                  <FaBell />
                </div>

                <div className="notification-card__content">
                  <div className="notification-card__topline">
                    <h2>{item.title || "Notification"}</h2>
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                  </div>
                  <p>{item.message}</p>
                </div>
              </button>

              <div className="notification-card__actions">
                {!item.isRead && (
                  <button
                    type="button"
                    onClick={() => markAsRead(item._id)}
                    className="notification-action-btn"
                    aria-label="Mark as read"
                  >
                    <FaCheck />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteNotification(item._id)}
                  className="notification-action-btn notification-action-btn--danger"
                  aria-label="Delete notification"
                >
                  <FaTrash />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
