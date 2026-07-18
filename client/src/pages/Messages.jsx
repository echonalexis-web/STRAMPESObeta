import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { messageAPI } from "../services/api";
import "../styles/messages.css";
import { FaSearch, FaPaperPlane, FaUserCircle, FaTrash, FaArrowLeft } from "react-icons/fa";
import DOMPurify from 'dompurify';

const sanitizeMessage = (content) => {
  if (!content) return '';
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
};

const formatTime = (isoDate) => {
  const date = new Date(isoDate);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const formatListTime = (isoDate) => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 60) return `${Math.max(diffMins, 1)}m`;
  if (diffHours < 24) return `${diffHours}h`;

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const getDateLabel = (isoDate) => {
  const date = new Date(isoDate);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], { month: "long", day: "numeric" });
};

const getSenderId = (message) => String(message?.sender?._id || message?.sender || "");

const getParticipantId = (participant) => String(participant?._id || participant?.id || participant || "");

// ----- Robust getOtherParticipant -----
const getOtherParticipant = (conversation, currentUserId) => {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  const valid = participants.filter((participant) => participant && getParticipantId(participant));
  const other = valid.find(
    (participant) => getParticipantId(participant) !== String(currentUserId)
  );
  return other || null;
};

const getConversationKey = (conversation) => {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  return participants
    .map((participant) => getParticipantId(participant))
    .filter(Boolean)
    .sort()
    .join(":");
};

const normalizeConversation = (conversation) => {
  if (!conversation || typeof conversation !== "object") return null;
  const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
  return {
    ...conversation,
    participants: participants.filter((participant) => participant && getParticipantId(participant)),
  };
};
// ----------------------------------------

export default function Messages() {
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useSocket();
  const location = useLocation();
  const preselectedConversationId = location.state?.conversationId || null;

  const currentUserId = String(user?._id || user?.id || "");
  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [unreadByConversation, setUnreadByConversation] = useState({});
  const [typingUserId, setTypingUserId] = useState(null);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState("conversations");

  const typingDebounceRef = useRef(null);
  const stopTypingTimerRef = useRef(null);
  const messagesEndRef = useRef(null);

  // ----- Load conversations -----
  useEffect(() => {
    let isActive = true;

    if (!currentUserId) {
      setConversations([]);
      setSelectedConversationId(null);
      setLoading(false);
      return undefined;
    }

    const loadConversations = async () => {
      setLoading(true);
      setError("");

      try {
        const { data } = await messageAPI.getConversations();
        if (!isActive) return;

        const list = Array.isArray(data) ? data : [];
        // Filter out conversations where the other participant is null (i.e., only yourself)
        const seenKeys = new Set();
        const filtered = list.filter((conv) => {
          const other = getOtherParticipant(conv, currentUserId);
          const otherId = getParticipantId(other);
          if (!other || !otherId || !other.name) return false;

          const key = getConversationKey(conv);
          if (!key || seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
        setConversations(filtered);

        if (preselectedConversationId && filtered.some((conv) => conv._id === preselectedConversationId)) {
          setSelectedConversationId(preselectedConversationId);
        } else if (filtered.length > 0) {
          setSelectedConversationId((prev) => prev || filtered[0]._id);
        } else {
          setSelectedConversationId(null);
        }
      } catch (err) {
        if (!isActive) return;
        setError(err.response?.data?.message || "Failed to load conversations");
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    loadConversations();

    return () => {
      isActive = false;
    };
  }, [preselectedConversationId, currentUserId]);

  // ----- Load messages for selected conversation -----
  useEffect(() => {
    if (!selectedConversationId) return undefined;

    const loadMessages = async () => {
      try {
        const { data } = await messageAPI.getMessages(selectedConversationId);
        setMessagesByConversation((prev) => ({
          ...prev,
          [selectedConversationId]: Array.isArray(data) ? data : [],
        }));

        setUnreadByConversation((prev) => ({
          ...prev,
          [selectedConversationId]: 0,
        }));
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load messages");
      }
    };

    loadMessages();
  }, [selectedConversationId]);

  // ----- Socket join/leave -----
  useEffect(() => {
    if (!socket || !selectedConversationId) return undefined;

    socket.emit("join_conversation", selectedConversationId);

    return () => {
      if (socket) {
        socket.emit("leave_conversation", selectedConversationId);
      }
    };
  }, [socket, selectedConversationId]);

  // ----- Socket listeners -----
  useEffect(() => {
    if (!socket || !isConnected || !currentUserId) return undefined;

    const onReceiveMessage = (incoming) => {
      const conversationId = String(incoming?.conversationId || "");
      if (!conversationId) return;

      const senderId = getSenderId(incoming);
      if (senderId === currentUserId) return;

      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationId]: [...(prev[conversationId] || []), incoming],
      }));

      setConversations((prev) =>
        prev
          .map((conversation) =>
            conversation._id === conversationId
              ? {
                  ...conversation,
                  lastMessage: incoming.content,
                  lastMessageAt: incoming.createdAt,
                }
              : conversation
          )
          .sort((a, b) => new Date(b.lastMessageAt || b.createdAt || 0) - new Date(a.lastMessageAt || a.createdAt || 0))
      );

      if (conversationId !== selectedConversationId) {
        setUnreadByConversation((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || 0) + 1,
        }));
      }
    };

    const onUserTyping = ({ conversationId, senderId }) => {
      if (String(conversationId) !== String(selectedConversationId)) return;
      if (String(senderId) === currentUserId) return;
      setTypingUserId(String(senderId));
    };

    const onUserStopTyping = ({ conversationId }) => {
      if (String(conversationId) !== String(selectedConversationId)) return;
      setTypingUserId(null);
    };

    socket.on("receive_message", onReceiveMessage);
    socket.on("user_typing", onUserTyping);
    socket.on("user_stop_typing", onUserStopTyping);

    return () => {
      if (socket) {
        socket.off("receive_message", onReceiveMessage);
        socket.off("user_typing", onUserTyping);
        socket.off("user_stop_typing", onUserStopTyping);
      }
    };
  }, [socket, isConnected, currentUserId, selectedConversationId]);

  // ----- User search -----
  useEffect(() => {
    let active = true;
    const term = userSearchQuery.trim();

    if (term.length < 2) {
      setUserSearchResults([]);
      setSearchingUsers(false);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setSearchingUsers(true);
      try {
        const { data } = await messageAPI.searchUsers(term);
        if (!active) return;
        setUserSearchResults(Array.isArray(data) ? data : []);
        setError("");
      } catch {
        if (!active) return;
        setUserSearchResults([]);
        setError("Failed to search users");
      } finally {
        if (active) {
          setSearchingUsers(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userSearchQuery]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messagesByConversation, selectedConversationId]);

  // ----- Derived state -----
  const filteredConversations = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    if (!search) return conversations;

    return conversations.filter((conversation) => {
      const otherUser = getOtherParticipant(conversation, currentUserId);
      if (!otherUser) return false;
      const name = otherUser?.name || "";
      const preview = conversation?.lastMessage || "";
      return name.toLowerCase().includes(search) || preview.toLowerCase().includes(search);
    });
  }, [conversations, searchQuery, currentUserId]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation._id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const selectedParticipant = selectedConversation
    ? getOtherParticipant(selectedConversation, currentUserId)
    : null;

  const selectedMessages = selectedConversationId ? messagesByConversation[selectedConversationId] || [] : [];

  // ----- Compute receiverId dynamically from conversation -----
  const getReceiverIdFromConversation = (conversation) => {
    if (!conversation) return null;
    const other = getOtherParticipant(conversation, currentUserId);
    return getParticipantId(other) || null;
  };

  // ----- Handlers -----
  const handleDeleteConversation = async (conversationId) => {
    const confirmed = window.confirm("Delete this conversation? This cannot be undone.");
    if (!confirmed) return;

    try {
      await messageAPI.deleteConversation(conversationId);

      setConversations((prev) => prev.filter((conv) => conv._id !== conversationId));
      setMessagesByConversation((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });
      setUnreadByConversation((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });

      if (selectedConversationId === conversationId) {
        const remaining = conversations.filter((conv) => conv._id !== conversationId);
        setSelectedConversationId(remaining[0]?._id || null);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete conversation");
    }
  };

  const handleSend = async () => {
    const rawContent = draft.trim();
    if (!rawContent || !selectedConversationId) return;

    // Sanitize content
    let sanitized = DOMPurify.sanitize(rawContent, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
    });
    const content = sanitized || rawContent;
    if (!content.trim()) {
      setError("Message cannot be empty");
      return;
    }

    const receiverId = getReceiverIdFromConversation(selectedConversation);
    if (!receiverId) {
      setError("No valid receiver found for this conversation");
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      _id: tempId,
      conversationId: selectedConversationId,
      sender: currentUserId,
      content,
      createdAt: new Date().toISOString(),
      isRead: true,
    };

    setMessagesByConversation((prev) => ({
      ...prev,
      [selectedConversationId]: [...(prev[selectedConversationId] || []), optimisticMessage],
    }));

    setConversations((prev) =>
      prev
        .map((conversation) =>
          conversation._id === selectedConversationId
            ? {
                ...conversation,
                lastMessage: content,
                lastMessageAt: optimisticMessage.createdAt,
              }
            : conversation
        )
        .sort((a, b) => new Date(b.lastMessageAt || b.createdAt || 0) - new Date(a.lastMessageAt || a.createdAt || 0))
    );

    setDraft("");
    if (socket && isConnected) {
      socket.emit("stop_typing", { conversationId: selectedConversationId });
    }

    try {
      const { data } = await messageAPI.sendMessage(selectedConversationId, { content, receiverId });

      // Replace optimistic message with the server response
      setMessagesByConversation((prev) => ({
        ...prev,
        [selectedConversationId]: (prev[selectedConversationId] || []).map((message) =>
          message._id === tempId ? data : message
        ),
      }));

    } catch (err) {
      console.error("❌ Send error:", err.response?.data || err);
      // Rollback optimistic message
      setMessagesByConversation((prev) => ({
        ...prev,
        [selectedConversationId]: (prev[selectedConversationId] || []).filter((message) => message._id !== tempId),
      }));
      setError(err.response?.data?.message || "Failed to send message");
    }
  };

  const handleInputChange = (value) => {
    setDraft(value);

    if (!socket || !selectedConversationId || !isConnected) return;

    if (!typingDebounceRef.current) {
      typingDebounceRef.current = window.setTimeout(() => {
        socket.emit("typing", {
          conversationId: selectedConversationId,
          senderId: currentUserId,
        });
        typingDebounceRef.current = null;
      }, 300);
    }

    if (stopTypingTimerRef.current) {
      window.clearTimeout(stopTypingTimerRef.current);
    }

    stopTypingTimerRef.current = window.setTimeout(() => {
      socket.emit("stop_typing", { conversationId: selectedConversationId, senderId: currentUserId });
    }, 1500);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const typingUserName = useMemo(() => {
    if (!typingUserId || !selectedConversation) return "Someone";

    const participant = (selectedConversation.participants || []).find(
      (userItem) => String(userItem?._id || userItem?.id) === String(typingUserId)
    );

    return participant?.name || "Someone";
  }, [typingUserId, selectedConversation]);

  const handleStartConversation = async (targetUser) => {
    try {
      const { data } = await messageAPI.createConversation({ participantId: targetUser._id });
      const createdConversation = normalizeConversation(data);

      if (!createdConversation) {
        throw new Error("Conversation was not created");
      }

      setConversations((prev) => {
        const merged = prev.some((item) => item._id === createdConversation._id)
          ? prev.map((item) => (item._id === createdConversation._id ? createdConversation : item))
          : [createdConversation, ...prev];

        const seenKeys = new Set();
        return merged.filter((conversation) => {
          const other = getOtherParticipant(conversation, currentUserId);
          const otherId = getParticipantId(other);
          if (!other || !otherId || !other.name) return false;

          const key = getConversationKey(conversation);
          if (!key || seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
      });

      setSelectedConversationId(createdConversation._id);
      setUserSearchQuery("");
      setUserSearchResults([]);
      setMobileActiveTab("chat");
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to start conversation");
    }
  };

  const handleSelectConversation = (conversationId) => {
    setSelectedConversationId(conversationId);
    setMobileActiveTab("chat");
    setUnreadByConversation((prev) => ({
      ...prev,
      [conversationId]: 0,
    }));
  };

  const handleMobileBack = () => {
    setMobileActiveTab("conversations");
  };

  // ----- Render -----
  return (
    <div className="messages-page">
      <div className="messages-container">
        {/* Sidebar */}
        <aside className={`messages-sidebar ${mobileActiveTab === "conversations" ? "mobile-active" : "mobile-hidden"}`}>
          <div className="sidebar-header">
            <h1>Messages</h1>
            <div className="search-wrapper">
              <FaSearch className="search-icon" />
              <input
                type="text"
                placeholder="Search users..."
                value={userSearchQuery}
                onChange={(event) => setUserSearchQuery(event.target.value)}
              />
            </div>
            <div className="search-wrapper">
              <FaSearch className="search-icon" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          </div>

          {/* Search Results */}
          {(userSearchQuery.trim().length >= 2 || searchingUsers) && (
            <div className="search-results">
              {searchingUsers && <p className="search-empty">Searching...</p>}
              {!searchingUsers && userSearchResults.length === 0 && (
                <p className="search-empty">No matching users found.</p>
              )}
              {!searchingUsers &&
                userSearchResults.map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    className="user-search-item"
                    onClick={() => handleStartConversation(item)}
                  >
                    <span className="user-avatar">
                      {(item.name || "U").trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="user-info">
                      <strong>{item.name}</strong>
                      <small>{item.role === "employer" ? item.companyName || item.email : item.desiredJobTitle || item.email}</small>
                    </div>
                    <span className="start-chat-btn">Message</span>
                  </button>
                ))}
            </div>
          )}

          <div className="conversation-list">
            {!loading && filteredConversations.length === 0 && (
              <div className="empty-state">
                <FaUserCircle className="empty-icon" />
                <p>No conversations yet</p>
                <span>Start by searching for a user above</span>
              </div>
            )}

            {filteredConversations.map((conversation) => {
              const otherUser = getOtherParticipant(conversation, currentUserId);
              // Guard: if no other participant, skip rendering
              if (!otherUser) return null;

              const isActive = selectedConversationId === conversation._id;
              const unreadCount = unreadByConversation[conversation._id] || 0;

              return (
                <div key={conversation._id} className={`conversation-item ${isActive ? "active" : ""}`}>
                  <button
                    type="button"
                    className="conversation-btn"
                    onClick={() => handleSelectConversation(conversation._id)}
                  >
                    <span className="user-avatar">
                      {(otherUser?.name || "U").trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="conversation-info">
                      <div className="conversation-top">
                        <strong>{otherUser?.name || "Unknown User"}</strong>
                        <span className="conversation-time">
                          {formatListTime(conversation.lastMessageAt || conversation.createdAt)}
                        </span>
                      </div>
                      <div className="conversation-bottom">
                        <span className="conversation-preview">
                          {conversation.lastMessage || "No messages yet"}
                        </span>
                        {unreadCount > 0 && (
                          <span className="unread-badge">{unreadCount}</span>
                        )}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => handleDeleteConversation(conversation._id)}
                    aria-label="Delete conversation"
                  >
                    <FaTrash />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Chat Area */}
        <main className={`chat-area ${mobileActiveTab === "chat" ? "mobile-active" : "mobile-hidden"}`}>
          {!selectedConversation || !selectedParticipant ? (
            <div className="empty-chat">
              <div className="empty-chat-content">
                <FaUserCircle className="empty-chat-icon" />
                <h3>Your Messages</h3>
                <p>Select a conversation to start chatting</p>
                <span className="empty-hint">or search for someone to message</span>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <header className="chat-header">
                <button
                  type="button"
                  className="mobile-back-btn"
                  onClick={handleMobileBack}
                  aria-label="Back to conversations"
                >
                  <FaArrowLeft />
                </button>
                <span className="chat-avatar">
                  {(selectedParticipant?.name || "U").trim().charAt(0).toUpperCase()}
                </span>
                <div className="chat-user-info">
                  <strong>{selectedParticipant?.name || "Unknown User"}</strong>
                  <p>{selectedParticipant?.desiredJobTitle || selectedParticipant?.role || "Conversation"}</p>
                </div>
              </header>

              {/* Messages */}
              <div className="messages-container-scroll">
                <div className="messages-list">
                  {selectedMessages.map((message, index) => {
                    const currentLabel = getDateLabel(message.createdAt);
                    const previousLabel = index > 0 ? getDateLabel(selectedMessages[index - 1].createdAt) : "";
                    const showSeparator = index === 0 || currentLabel !== previousLabel;
                    const mine = getSenderId(message) === currentUserId;

                    return (
                      <div key={message._id || `${message.createdAt}-${index}`}>
                        {showSeparator && <div className="date-divider">{currentLabel}</div>}
                        <div className={`message ${mine ? "sent" : "received"}`}>
                          <div className="message-bubble">
                            <p>{sanitizeMessage(message.content)}</p>
                            <span className="message-time">{formatTime(message.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {typingUserId && (
                    <div className="typing-indicator">
                      <span>{typingUserName} is typing</span>
                      <span className="typing-dots">
                        <span>.</span><span>.</span><span>.</span>
                      </span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input Bar */}
              <footer className="chat-input-bar">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={draft}
                  onChange={(event) => handleInputChange(event.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  type="button"
                  className="send-btn"
                  onClick={handleSend}
                  disabled={!draft.trim()}
                  aria-label="Send message"
                >
                  <FaPaperPlane />
                </button>
              </footer>
            </>
          )}
        </main>
      </div>

      {error && (
        <div className="error-toast" onClick={() => setError("")}>
          {error}
          <button className="error-toast-close">×</button>
        </div>
      )}
    </div>
  );
}