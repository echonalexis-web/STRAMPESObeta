import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { messageAPI, resolveAssetUrl } from "../services/api";
import { useNotifications } from "../hooks/useNotifications";
import { OPEN_FLOATING_MESSENGER_EVENT } from "./FloatingMessenger";
import "../styles/dashboard-topbar.css";
import { FaBell, FaCommentDots, FaCheck, FaUserShield } from "react-icons/fa";

// Deterministic per-contact color so avatar-less previews stay visually
// distinct instead of every fallback circle being the same red.
const AVATAR_COLORS = ["#ef4444", "#16a34a", "#2563eb", "#d97706", "#7c3aed", "#0d9488"];
const getAvatarColor = (name) => {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

// Routes where this bar deliberately doesn't show: the user asked it hidden
// on Settings and on viewing/editing the profile, and on the full
// Notifications/Messages pages themselves (its own bell/chat dropdowns
// already surface that same content, so the full pages don't need it
// repeated above them). It's also skipped anywhere the main Navbar itself
// renders no chrome (Navbar.jsx's own BARE_ROUTES/SETUP_PATHS) since those
// pages build their own full-screen layout with nothing to sit a persistent
// header above.
const HIDDEN_PATH_PREFIXES = [
  "/profile",
  "/settings",
  "/notifications",
  "/messages",
  "/onboarding",
  "/account-suspended",
  "/change-password",
];

const getPortalContent = (user) => {
  const role = normalizeRole(user?.role);

  if (role === "superadmin") {
    return {
      title: "Superadmin Console",
      description: "Provision and manage LMDPESO admin accounts & NSRP system settings",
      icon: <FaUserShield />,
      badge: { label: "System Administrator", tone: "neutral" },
    };
  }

  if (role === "admin") {
    return { title: "Admin Portal", badge: { label: "System Administrator", tone: "neutral" } };
  }

  if (role === "employer") {
    const status = user?.verificationStatus;
    return {
      title: "Employer Portal",
      badge:
        status === "verified"
          ? { label: "Verified Employer", tone: "success" }
          : status === "rejected"
          ? { label: "Verification Rejected", tone: "neutral" }
          : { label: "Verification Pending", tone: "warning" },
    };
  }

  return { title: "Applicant Portal", badge: { label: "Active Job Seeker", tone: "success" } };
};

const getEntityId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return String(value._id || value.id || "");
  return "";
};

const getSenderId = (message) => {
  const candidates = [message?.senderId, message?.sender?._id, message?.sender?.id, message?.sender];
  for (const candidate of candidates) {
    const id = getEntityId(candidate);
    if (id) return id;
  }
  return "";
};

const getParticipantId = (participant) => {
  const raw = participant?._id || participant?.id || participant;
  return raw ? String(raw) : "";
};

const getOtherParticipant = (conversation, currentUserId) => {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  return participants.find((p) => getEntityId(p) !== String(currentUserId)) || null;
};

const getConversationKey = (conversation) => {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  return participants.map(getParticipantId).filter(Boolean).sort().join(":");
};

const getInitials = (name) => {
  if (!name) return "U";
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
};

const getAvatarUrl = (participant) => {
  const src = participant?.profileImage || participant?.avatar || participant?.image || participant?.photo;
  return src ? resolveAssetUrl(src) : "";
};

const formatRelativeTime = (isoDate) => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  const diffMins = Math.floor((Date.now() - date) / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Shared, sticky content-area top bar: role-based portal title + status
 * badge on the left, notification/message bells with dropdown previews and
 * the current user's identity on the right. Mounted once, globally (see
 * App.jsx), so it's persistent across every logged-in page except the ones
 * in HIDDEN_PATH_PREFIXES above — separate from the full "View all" pages
 * (/notifications, /messages) and from the global FloatingMessenger bubble,
 * which stays available everywhere for actually replying in place.
 */
export default function DashboardTopBar() {
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();

  const currentUserId = getEntityId(user?._id || user?.id || user);
  const hidden = !user || HIDDEN_PATH_PREFIXES.some((prefix) => location.pathname.startsWith(prefix));

  const {
    notifications,
    unreadCount: unreadNotifications,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications({ initialLimit: 5, autoLoad: true });

  const [conversations, setConversations] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [openMenu, setOpenMenu] = useState(null); // "notifications" | "messages" | null

  const rootRef = useRef(null);

  // Re-syncs with the server on every navigation (not just once at login),
  // matching FloatingMessenger's equivalent effect — this bar has no socket
  // event telling it when messages get marked read elsewhere (e.g. opened in
  // the floating messenger or the full Messages page), so without this its
  // badge would only ever go up, never back down, between logins.
  useEffect(() => {
    if (!user) return;
    let active = true;
    messageAPI
      .getUnreadCount()
      .then(({ data }) => {
        if (active) setUnreadMessages(Number(data?.count || 0));
      })
      .catch(() => {
        // Badge keeps its last known value.
      });
    return () => {
      active = false;
    };
  }, [user, location.pathname]);

  useEffect(() => {
    if (!socket || !isConnected || !currentUserId) return undefined;
    const onReceiveMessage = (incoming) => {
      const senderId = getSenderId(incoming);
      if (senderId && senderId === currentUserId) return;
      // This component keeps running (and listening) even while hidden on
      // the full Messages page — don't bump the badge for messages the user
      // is already seeing live there (mirrors Navbar.jsx's own guard).
      if (location.pathname !== "/messages") {
        setUnreadMessages((prev) => prev + 1);
      }
      setConversations((prev) => {
        const conversationId = String(incoming?.conversationId || "");
        if (!prev.some((c) => c._id === conversationId)) return prev;
        return prev
          .map((c) =>
            c._id === conversationId ? { ...c, lastMessage: incoming.content, lastMessageAt: incoming.createdAt } : c
          )
          .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
      });
    };
    socket.on("receive_message", onReceiveMessage);
    return () => socket.off("receive_message", onReceiveMessage);
  }, [socket, isConnected, currentUserId, location.pathname]);

  // Close an open dropdown on outside click.
  useEffect(() => {
    if (!openMenu) return undefined;
    const handleClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenu]);

  const toggleMenu = (menu) => {
    const willOpen = openMenu !== menu;
    setOpenMenu(willOpen ? menu : null);
    if (!willOpen) return;

    // Re-fetch every time it's opened (not just once) so a conversation
    // started elsewhere — the full Messages page, the floating messenger —
    // shows up here instead of this preview staying frozen on whatever it
    // first loaded.
    if (menu === "messages") {
      messageAPI
        .getConversations()
        .then(({ data }) => {
          const list = Array.isArray(data) ? data : [];
          const seenKeys = new Set();
          // Same validity + dedupe rules as Messages.jsx / FloatingMessenger —
          // drop conversations whose other participant can't be resolved at
          // all, and collapse any duplicate participant pairs, so this
          // preview never shows an entry the full page and floating widget
          // would both hide.
          const filtered = list.filter((conversation) => {
            const other = getOtherParticipant(conversation, currentUserId);
            if (!other || !getParticipantId(other)) return false;
            const key = getConversationKey(conversation);
            if (!key || seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
          });
          const sorted = filtered.sort(
            (a, b) => new Date(b.lastMessageAt || b.createdAt || 0) - new Date(a.lastMessageAt || a.createdAt || 0)
          );
          setConversations(sorted.slice(0, 5));
        })
        .catch(() => {});
      messageAPI
        .getUnreadCount()
        .then(({ data }) => setUnreadMessages(Number(data?.count || 0)))
        .catch(() => {});
    }
    if (menu === "notifications") fetchNotifications();
  };

  const openNotification = (item) => {
    setOpenMenu(null);
    markAsRead(item._id);
    if (item.actionUrl) navigate(item.actionUrl);
    else navigate("/notifications");
  };

  // Both of these hand off to the floating messenger widget (see
  // OPEN_FLOATING_MESSENGER_EVENT) rather than navigating to the full
  // /messages page, matching how this preview is meant to behave: a quick
  // look without leaving the page you're on.
  const openConversation = (conversation) => {
    setOpenMenu(null);
    window.dispatchEvent(new CustomEvent(OPEN_FLOATING_MESSENGER_EVENT, { detail: { conversation } }));
  };

  const openChatBox = () => {
    setOpenMenu(null);
    window.dispatchEvent(new CustomEvent(OPEN_FLOATING_MESSENGER_EVENT));
  };

  const avatarUrl = user?.profileImage ? resolveAssetUrl(user.profileImage) : "";

  if (hidden) return null;

  const { title, badge, icon, description } = getPortalContent(user);

  return (
    <div className="dtb-root" ref={rootRef}>
      <div className="dtb-left">
        {icon && <span className="dtb-icon">{icon}</span>}
        <div className="dtb-left-text">
          <div className="dtb-left-heading">
            <h1 className="dtb-title">{title}</h1>
            {badge && <span className={`dtb-badge dtb-badge--${badge.tone || "success"}`}><i /> {badge.label}</span>}
          </div>
          {description && <p className="dtb-description">{description}</p>}
        </div>
      </div>

      <div className="dtb-right">
        <div className="dtb-menu-wrap">
          <button
            type="button"
            className="dtb-icon-btn"
            onClick={() => toggleMenu("notifications")}
            aria-label="Notifications"
            aria-expanded={openMenu === "notifications"}
          >
            <FaBell />
            {unreadNotifications > 0 && (
              <span className="dtb-badge-count">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
            )}
          </button>

          {openMenu === "notifications" && (
            <div className="dtb-dropdown">
              <div className="dtb-dropdown-head">
                <span className="dtb-dropdown-head-title">
                  <FaBell className="dtb-dropdown-head-icon" aria-hidden="true" /> Notifications
                </span>
                {unreadNotifications > 0 && (
                  <button type="button" className="dtb-mark-read" onClick={markAllAsRead}>
                    <FaCheck aria-hidden="true" /> Mark all read
                  </button>
                )}
              </div>
              <div className="dtb-dropdown-list">
                {notifications.length === 0 ? (
                  <p className="dtb-dropdown-empty">You're all caught up.</p>
                ) : (
                  notifications.slice(0, 5).map((item) => (
                    <button
                      type="button"
                      key={item._id}
                      className="dtb-dropdown-item"
                      onClick={() => openNotification(item)}
                    >
                      <span className="dtb-dropdown-item-title-row">
                        {!item.isRead && <span className="dtb-unread-dot" aria-hidden="true" />}
                        <span className="dtb-dropdown-item-title">{item.title}</span>
                      </span>
                      <span className="dtb-dropdown-item-message">{item.message}</span>
                      <span className="dtb-dropdown-item-time">{formatRelativeTime(item.createdAt)}</span>
                    </button>
                  ))
                )}
              </div>
              <button type="button" className="dtb-dropdown-footer" onClick={() => { setOpenMenu(null); navigate("/notifications"); }}>
                View All Notifications
              </button>
            </div>
          )}
        </div>

        <div className="dtb-menu-wrap">
          <button
            type="button"
            className="dtb-icon-btn"
            onClick={() => toggleMenu("messages")}
            aria-label="Messages"
            aria-expanded={openMenu === "messages"}
          >
            <FaCommentDots />
            {unreadMessages > 0 && <span className="dtb-badge-count">{unreadMessages > 9 ? "9+" : unreadMessages}</span>}
          </button>

          {openMenu === "messages" && (
            <div className="dtb-dropdown">
              <div className="dtb-dropdown-head">
                <span className="dtb-dropdown-head-title">
                  <FaCommentDots className="dtb-dropdown-head-icon" aria-hidden="true" /> Recent Messages
                </span>
                <button type="button" className="dtb-open-chat" onClick={openChatBox}>
                  Open Chat Box
                </button>
              </div>
              <div className="dtb-dropdown-list">
                {conversations.length === 0 ? (
                  <p className="dtb-dropdown-empty">No conversations yet.</p>
                ) : (
                  conversations.map((conversation) => {
                    const other = getOtherParticipant(conversation, currentUserId);
                    const otherAvatarUrl = getAvatarUrl(other);
                    return (
                      <button
                        type="button"
                        key={conversation._id}
                        className="dtb-dropdown-item dtb-dropdown-item--message"
                        onClick={() => openConversation(conversation)}
                      >
                        {otherAvatarUrl ? (
                          <img src={otherAvatarUrl} alt="" className="dtb-dropdown-avatar" />
                        ) : (
                          <span
                            className="dtb-dropdown-avatar dtb-dropdown-avatar--fallback"
                            style={{ background: getAvatarColor(other?.name) }}
                          >
                            {getInitials(other?.name)}
                          </span>
                        )}
                        <span className="dtb-dropdown-item-body">
                          <span className="dtb-dropdown-item-top">
                            <span className="dtb-dropdown-item-title">{other?.name || "Unknown User"}</span>
                            <span className="dtb-dropdown-item-time">{formatRelativeTime(conversation.lastMessageAt)}</span>
                          </span>
                          <span className="dtb-dropdown-item-message">{conversation.lastMessage || "No messages yet"}</span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <button type="button" className="dtb-dropdown-footer" onClick={() => { setOpenMenu(null); navigate("/messages"); }}>
                View All Messages
              </button>
            </div>
          )}
        </div>

        <button type="button" className="dtb-user" onClick={() => navigate("/profile")}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="dtb-user-avatar" />
          ) : (
            <span className="dtb-user-avatar dtb-user-avatar--fallback">{getInitials(user?.name)}</span>
          )}
          <span className="dtb-user-text">
            <span className="dtb-user-name">{user?.name}</span>
            <span className="dtb-user-email">{user?.email}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
