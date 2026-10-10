import { useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import DOMPurify from "dompurify";
import { AuthContext } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { messageAPI, resolveAssetUrl } from "../services/api";
import { useToast } from "./feedback/context";
import "../styles/floating-messenger.css";
import {
  FaCommentDots,
  FaTimes,
  FaArrowLeft,
  FaPaperPlane,
} from "react-icons/fa";

// Lets other parts of the app (the dashboard top bar's "Open Chat Box"
// action and its message previews) open this widget directly instead of
// duplicating its conversation-view UI themselves. A plain window event
// rather than a shared context/provider, since this is the one cross-
// component signal needed and both components otherwise stay independent.
export const OPEN_FLOATING_MESSENGER_EVENT = "floating-messenger:open";

// Full-page surfaces where a floating chat bubble would just duplicate (or
// collide with) what's already on screen — the dedicated Messages page, and
// every route the main Navbar itself hides on (see App.jsx's BARE_ROUTES /
// Navbar's SETUP_PATHS) plus the logged-out auth pages.
const HIDDEN_PATHS = new Set([
  "/messages",
  "/login",
  "/register",
  "/register-employer",
  "/account-suspended",
  "/change-password",
  "/profile/edit",
  "/onboarding",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/confirm-email",
]);

const getEntityId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    if (value.$oid) return String(value.$oid);
    if (value.userId) return String(value.userId);
  }
  return "";
};

const getSenderId = (message) => {
  if (!message) return "";
  const candidates = [
    message.senderId,
    message.sender?._id,
    message.sender?.id,
    message.sender,
    message.author?._id,
    message.author?.id,
    message.author,
  ];
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

const isParticipantUnavailable = (participant) => {
  if (!participant) return true;
  if (participant.unavailable === true) return true;
  if (!getParticipantId(participant)) return true;
  return false;
};

const getOtherParticipant = (conversation, currentUserId) => {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  const valid = participants.filter((participant) => participant && getParticipantId(participant));
  return valid.find((participant) => getParticipantId(participant) !== String(currentUserId)) || null;
};

const getConversationKey = (conversation) => {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  return participants.map(getParticipantId).filter(Boolean).sort().join(":");
};

const getAvatarUrl = (participant) => {
  const src = participant?.profileImage || participant?.avatar || participant?.image || participant?.photo;
  return src ? resolveAssetUrl(src) : "";
};

const getInitials = (name) => {
  if (!name) return "U";
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
};

const getMessageKey = (message) => {
  if (message?._id) return String(message._id);
  return `${getSenderId(message)}:${message?.createdAt}:${message?.content}`;
};

const dedupeMessages = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((message) => {
    const key = getMessageKey(message);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const sortConversations = (list) =>
  [...list].sort(
    (a, b) => new Date(b.lastMessageAt || b.createdAt || 0) - new Date(a.lastMessageAt || a.createdAt || 0)
  );

const formatListTime = (isoDate) => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  const now = new Date();
  const diffMins = Math.floor((now - date) / 60000);
  const diffHours = Math.floor((now - date) / 3600000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const formatTime = (isoDate) => new Date(isoDate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Sticky messenger widget, available to every logged-in user (any role) on
// every page except the ones listed in HIDDEN_PATHS above. Deliberately a
// lighter-weight companion to the full /messages page: no search, unsend, or
// conversation deletion here — those stay on the dedicated page.
export default function FloatingMessenger() {
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useSocket();
  const toast = useToast();
  const location = useLocation();

  const currentUserId = getEntityId(user?._id || user?.id || user);

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState("list");
  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);

  const messagesEndRef = useRef(null);
  const panelRef = useRef(null);

  const hideWidget = !user || HIDDEN_PATHS.has(location.pathname);

  const refreshUnreadCount = async () => {
    try {
      const { data } = await messageAPI.getUnreadCount();
      setTotalUnread(Number(data?.count || 0));
    } catch {
      // Non-critical — the badge just stays at its last known value.
    }
  };

  // Initial + route-change badge refresh (mirrors Navbar's own unread poll).
  useEffect(() => {
    if (!user) {
      setTotalUnread(0);
      return;
    }
    refreshUnreadCount();
  }, [user, location.pathname]);

  // Close the panel (and drop its conversation) whenever it would otherwise
  // be hidden on this route, so it doesn't stay open underneath nothing.
  useEffect(() => {
    if (hideWidget) {
      setIsOpen(false);
      setView("list");
      setSelectedId(null);
    }
  }, [hideWidget]);

  // External open requests (see OPEN_FLOATING_MESSENGER_EVENT above). When a
  // specific conversation is included, seed it into the list immediately
  // (rather than waiting on the list-fetch effect below) so the chat header
  // has a name/avatar to show right away instead of flashing "Unknown User".
  useEffect(() => {
    const handleExternalOpen = (event) => {
      if (hideWidget) return;
      const conversation = event?.detail?.conversation;
      if (conversation?._id) {
        setConversations((prev) =>
          prev.some((c) => c._id === conversation._id) ? prev : sortConversations([conversation, ...prev])
        );
        setMessages([]);
        setSelectedId(conversation._id);
        setView("chat");
      } else {
        setView("list");
      }
      setIsOpen(true);
    };
    window.addEventListener(OPEN_FLOATING_MESSENGER_EVENT, handleExternalOpen);
    return () => window.removeEventListener(OPEN_FLOATING_MESSENGER_EVENT, handleExternalOpen);
  }, [hideWidget]);

  // Fetch the conversation list every time the panel is opened (not just
  // once ever) — this widget is mounted once, globally, for the whole
  // session, so caching "loaded" permanently after the very first open
  // would freeze the list on whatever existed at that moment and never
  // pick up a conversation started afterward elsewhere (the full Messages
  // page, or the dashboard top bar's own message preview).
  useEffect(() => {
    if (!isOpen || !currentUserId) return undefined;
    let active = true;
    setLoadingConversations(true);

    messageAPI
      .getConversations()
      .then(({ data }) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        const seenKeys = new Set();
        const filtered = list.filter((conversation) => {
          const other = getOtherParticipant(conversation, currentUserId);
          if (!other || !getParticipantId(other)) return false;
          const key = getConversationKey(conversation);
          if (!key || seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
        setConversations(sortConversations(filtered));
      })
      .catch(() => {
        if (active) toast.error("Could not load your conversations.");
      })
      .finally(() => {
        if (active) setLoadingConversations(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, currentUserId, toast]);

  // Load message history for the open conversation, then re-sync the unread
  // badge — the server marks a conversation's messages read as a side effect
  // of fetching them (see server/controllers/messageController.js), so the
  // count returned here reflects that.
  useEffect(() => {
    if (view !== "chat" || !selectedId) return undefined;
    let active = true;
    setLoadingMessages(true);

    messageAPI
      .getMessages(selectedId)
      .then(({ data }) => {
        if (!active) return;
        setMessages(dedupeMessages(data));
        refreshUnreadCount();
      })
      .catch(() => {
        if (active) toast.error("Could not load this conversation.");
      })
      .finally(() => {
        if (active) setLoadingMessages(false);
      });

    return () => {
      active = false;
    };
  }, [view, selectedId, toast]);

  // Join/leave the conversation's socket room while its chat view is open.
  useEffect(() => {
    if (!socket || view !== "chat" || !selectedId) return undefined;
    socket.emit("join_conversation", selectedId);
    return () => {
      socket.emit("leave_conversation", selectedId);
    };
  }, [socket, view, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, view]);

  // Live updates: append to an open conversation, otherwise just bump the
  // badge and refresh the preview list so it's current next time it's opened.
  useEffect(() => {
    if (!socket || !isConnected || !currentUserId) return undefined;

    const onReceiveMessage = (incoming) => {
      const conversationId = String(incoming?.conversationId || "");
      if (!conversationId) return;
      const senderId = getSenderId(incoming);
      if (senderId && senderId === currentUserId) return;

      const isViewingThisConversation = isOpen && view === "chat" && selectedId === conversationId;

      if (isViewingThisConversation) {
        setMessages((prev) => dedupeMessages([...prev, incoming]));
        refreshUnreadCount();
      } else if (location.pathname !== "/messages") {
        // This widget keeps running (and listening) even while hidden on the
        // full Messages page — don't bump the badge for messages the user is
        // already seeing live there (mirrors Navbar.jsx's own guard).
        setTotalUnread((prev) => prev + 1);
      }

      setConversations((prev) => {
        if (!prev.some((conversation) => conversation._id === conversationId)) return prev;
        return sortConversations(
          prev.map((conversation) =>
            conversation._id === conversationId
              ? { ...conversation, lastMessage: incoming.content, lastMessageAt: incoming.createdAt }
              : conversation
          )
        );
      });
    };

    const onMessageUnsent = ({ messageId, conversationId }) => {
      if (!messageId || !conversationId) return;
      setMessages((prev) =>
        prev.map((message) =>
          String(message._id) === String(messageId) ? { ...message, isUnsent: true, content: "" } : message
        )
      );
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation._id === conversationId ? { ...conversation, lastMessage: "Message unsent" } : conversation
        )
      );
    };

    socket.on("receive_message", onReceiveMessage);
    socket.on("message_unsent", onMessageUnsent);
    return () => {
      socket.off("receive_message", onReceiveMessage);
      socket.off("message_unsent", onMessageUnsent);
    };
  }, [socket, isConnected, currentUserId, isOpen, view, selectedId, location.pathname]);

  if (hideWidget) return null;

  const selectedConversation = conversations.find((conversation) => conversation._id === selectedId) || null;
  const otherParticipant = getOtherParticipant(selectedConversation, currentUserId);
  const participantUnavailable = isParticipantUnavailable(otherParticipant);

  const openConversation = (conversation) => {
    setSelectedId(conversation._id);
    setMessages([]);
    setView("chat");
  };

  const backToList = () => {
    setView("list");
    setSelectedId(null);
  };

  const togglePanel = () => {
    setIsOpen((prev) => !prev);
  };

  const closePanel = () => {
    setIsOpen(false);
  };

  const handleSend = async () => {
    const raw = draft.trim();
    if (!raw || !selectedId || sending) return;
    if (participantUnavailable) {
      toast.error("This user is unavailable.");
      return;
    }

    const clean = DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) || raw;
    if (!clean.trim()) return;

    const receiverId = getParticipantId(otherParticipant);
    if (!receiverId) {
      toast.error("No valid receiver found for this conversation.");
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      _id: tempId,
      conversationId: selectedId,
      sender: currentUserId,
      content: clean,
      createdAt: new Date().toISOString(),
      isRead: true,
    };

    setMessages((prev) => dedupeMessages([...prev, optimisticMessage]));
    setConversations((prev) =>
      sortConversations(
        prev.map((conversation) =>
          conversation._id === selectedId
            ? { ...conversation, lastMessage: clean, lastMessageAt: optimisticMessage.createdAt }
            : conversation
        )
      )
    );
    setDraft("");
    setSending(true);
    if (socket && isConnected) socket.emit("stop_typing", { conversationId: selectedId });

    try {
      const { data } = await messageAPI.sendMessage(selectedId, { content: clean, receiverId });
      setMessages((prev) => dedupeMessages(prev.map((message) => (message._id === tempId ? data : message))));
    } catch (err) {
      setMessages((prev) => prev.filter((message) => message._id !== tempId));
      toast.error(err?.response?.data?.message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fm-root">
      {isOpen && (
        <div className="fm-panel" ref={panelRef}>
          {view === "chat" && selectedConversation ? (
            <>
              <div className="fm-panel-header">
                <button type="button" className="fm-icon-btn" onClick={backToList} aria-label="Back to conversations">
                  <FaArrowLeft />
                </button>
                <div className="fm-header-identity">
                  {getAvatarUrl(otherParticipant) ? (
                    <img src={getAvatarUrl(otherParticipant)} alt="" className="fm-avatar-img" />
                  ) : (
                    <span className="fm-avatar-fallback">{getInitials(otherParticipant?.name)}</span>
                  )}
                  <div className="fm-header-text">
                    <span className="fm-header-name">
                      {participantUnavailable ? "Unavailable user" : otherParticipant?.name || "Unknown User"}
                    </span>
                    <span className="fm-header-status">
                      {isConnected ? "Online" : "Offline"}
                      {otherParticipant?.role ? ` · ${otherParticipant.role}` : ""}
                    </span>
                  </div>
                </div>
                <button type="button" className="fm-icon-btn" onClick={closePanel} aria-label="Close messenger">
                  <FaTimes />
                </button>
              </div>

              <div className="fm-messages">
                {loadingMessages ? (
                  <div className="fm-empty-state">Loading…</div>
                ) : messages.length === 0 ? (
                  <div className="fm-empty-state">No messages yet. Say hello!</div>
                ) : (
                  messages.map((message) => {
                    const isOwn = getSenderId(message) === currentUserId;
                    return (
                      <div key={getMessageKey(message)} className={`fm-bubble-row ${isOwn ? "fm-own" : ""}`}>
                        <div className={`fm-bubble ${isOwn ? "fm-bubble--own" : "fm-bubble--other"}`}>
                          <span className="fm-bubble-text">
                            {message.isUnsent ? <em>Message unsent</em> : message.content}
                          </span>
                          <span className="fm-bubble-time">{formatTime(message.createdAt)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="fm-composer">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message…"
                  disabled={sending || participantUnavailable}
                  aria-label="Message"
                />
                <button
                  type="button"
                  className="fm-send-btn"
                  onClick={handleSend}
                  disabled={sending || !draft.trim() || participantUnavailable}
                  aria-label="Send message"
                >
                  <FaPaperPlane />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="fm-panel-header">
                <span className="fm-panel-title">Messages</span>
                <button type="button" className="fm-icon-btn" onClick={closePanel} aria-label="Close messenger">
                  <FaTimes />
                </button>
              </div>

              <div className="fm-conversation-list">
                {loadingConversations ? (
                  <div className="fm-empty-state">Loading…</div>
                ) : conversations.length === 0 ? (
                  <div className="fm-empty-state">
                    No conversations yet. Messages you send or receive will show up here.
                  </div>
                ) : (
                  conversations.map((conversation) => {
                    const other = getOtherParticipant(conversation, currentUserId);
                    const unavailable = isParticipantUnavailable(other);
                    return (
                      <button
                        type="button"
                        key={conversation._id}
                        className="fm-conversation-item"
                        onClick={() => openConversation(conversation)}
                      >
                        {getAvatarUrl(other) ? (
                          <img src={getAvatarUrl(other)} alt="" className="fm-avatar-img" />
                        ) : (
                          <span className="fm-avatar-fallback">{getInitials(other?.name)}</span>
                        )}
                        <span className="fm-conversation-body">
                          <span className="fm-conversation-top">
                            <span className="fm-conversation-name">
                              {unavailable ? "Unavailable user" : other?.name || "Unknown User"}
                            </span>
                            <span className="fm-conversation-time">{formatListTime(conversation.lastMessageAt)}</span>
                          </span>
                          <span className="fm-conversation-preview">
                            {conversation.lastMessage || "No messages yet"}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className={`fm-bubble-btn ${isOpen ? "fm-bubble-btn--open" : ""}`}
        onClick={togglePanel}
        aria-label={isOpen ? "Close messenger" : "Open messenger"}
        aria-expanded={isOpen}
      >
        {isOpen ? <FaTimes /> : <FaCommentDots />}
        {!isOpen && totalUnread > 0 && (
          <span className="fm-bubble-badge">{totalUnread > 9 ? "9+" : totalUnread}</span>
        )}
      </button>
    </div>
  );
}
