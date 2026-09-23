import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBell,
  FaCheck,
  FaTrash,
  FaEnvelope,
  FaBriefcase,
  FaClipboardCheck,
  FaShieldAlt,
  FaUserPlus,
  FaNewspaper,
  FaHeart,
  FaGraduationCap,
  FaCog,
} from "react-icons/fa";
import { useNotifications } from "../hooks/useNotifications";
import { useToast } from "../components/feedback/context";
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

// One icon + accent color per notification type, so the type is readable
// from the icon alone rather than every card looking identical.
const TYPE_META = {
  message: { icon: FaEnvelope, className: "notif-icon--message" },
  job_application: { icon: FaBriefcase, className: "notif-icon--application" },
  application_status: { icon: FaClipboardCheck, className: "notif-icon--status" },
  admin_action: { icon: FaShieldAlt, className: "notif-icon--admin" },
  follow: { icon: FaUserPlus, className: "notif-icon--follow" },
  news: { icon: FaNewspaper, className: "notif-icon--news" },
  like: { icon: FaHeart, className: "notif-icon--like" },
  spes: { icon: FaGraduationCap, className: "notif-icon--spes" },
  system: { icon: FaCog, className: "notif-icon--system" },
};

const iconForType = (type) => TYPE_META[type]?.icon || FaBell;
const iconClassForType = (type) => TYPE_META[type]?.className || "notif-icon--default";

// Filter tabs group the 9 backend notification types into fewer, more
// meaningful buckets — matching the "All / Pending / Shortlisted / ..."
// pill-tab pattern already used on Your Applications.
const FILTER_TABS = [
  { key: "all", label: "All", match: () => true },
  { key: "unread", label: "Unread", match: (n) => !n.isRead },
  { key: "applications", label: "Applications", match: (n) => ["job_application", "application_status"].includes(n.type) },
  { key: "messages", label: "Messages", match: (n) => n.type === "message" },
  { key: "follows", label: "Follows", match: (n) => n.type === "follow" },
  { key: "news", label: "News", match: (n) => ["news", "like"].includes(n.type) },
  { key: "spes", label: "SPES", match: (n) => n.type === "spes" },
  { key: "system", label: "System", match: (n) => ["system", "admin_action"].includes(n.type) },
];

export default function Notifications() {
  const navigate = useNavigate();
  const toast = useToast();
  const {
    notifications,
    loading,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications({ initialLimit: 100, autoLoad: true });

  const [activeFilter, setActiveFilter] = useState("all");

  const hasItems = notifications.length > 0;

  const handleDelete = async (id) => {
    const ok = await deleteNotification(id);
    if (ok) {
      toast.success("Notification deleted.");
    } else {
      toast.error("Couldn't delete that notification. Please try again.");
    }
  };

  const sortedItems = useMemo(() => {
    return [...notifications].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [notifications]);

  const filterCounts = useMemo(() => {
    const counts = {};
    for (const tab of FILTER_TABS) {
      counts[tab.key] = sortedItems.filter(tab.match).length;
    }
    return counts;
  }, [sortedItems]);

  const visibleItems = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.key === activeFilter) || FILTER_TABS[0];
    return sortedItems.filter(tab.match);
  }, [sortedItems, activeFilter]);

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

      {hasItems && (
        <>
          <div className="notif-filter-tabs" role="tablist" aria-label="Filter notifications">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeFilter === tab.key}
                className={`notif-filter-tab ${activeFilter === tab.key ? "is-active" : ""}`}
                onClick={() => setActiveFilter(tab.key)}
              >
                {tab.label}<span className="notif-filter-tab-n">{filterCounts[tab.key] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="notif-filter-select-wrap">
            <select
              className="notif-filter-select"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
              aria-label="Filter notifications"
            >
              {FILTER_TABS.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.label} ({filterCounts[tab.key] ?? 0})
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {loading && <p className="notifications-page__state">Loading notifications...</p>}
      {!loading && !hasItems && <p className="notifications-page__state">No notifications yet.</p>}
      {!loading && hasItems && visibleItems.length === 0 && (
        <p className="notifications-page__state">No notifications in this filter.</p>
      )}

      {!loading && visibleItems.length > 0 && (
        <section className="notifications-list" aria-label="Notification list">
          {visibleItems.map((item) => {
            const TypeIcon = iconForType(item.type);
            return (
              <article
                key={item._id}
                className={`notification-card ${item.isRead ? "notification-card--read" : "notification-card--unread"}`}
              >
                <button
                  type="button"
                  className="notification-card__main"
                  onClick={() => handleOpen(item)}
                >
                  <div className={`notification-card__icon ${iconClassForType(item.type)}`} aria-hidden="true">
                    <TypeIcon />
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
                    onClick={() => handleDelete(item._id)}
                    className="notification-action-btn notification-action-btn--danger"
                    aria-label="Delete notification"
                  >
                    <FaTrash />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
