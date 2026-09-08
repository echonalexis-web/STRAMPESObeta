// Tracks which conversation a user currently has open in the Messages UI, so
// the server can skip creating a "new message" notification for a chat the
// recipient is already looking at live (they'll see it appear in the thread
// instead). In-memory only — fine for a single Node process; a multi-instance
// deployment would need this shared (e.g. Redis) instead.
const activeConversationsByUser = new Map(); // userId -> Set<conversationId>

const markConversationActive = (userId, conversationId) => {
  const key = String(userId);
  if (!activeConversationsByUser.has(key)) {
    activeConversationsByUser.set(key, new Set());
  }
  activeConversationsByUser.get(key).add(String(conversationId));
};

const markConversationInactive = (userId, conversationId) => {
  const key = String(userId);
  const set = activeConversationsByUser.get(key);
  if (!set) return;
  set.delete(String(conversationId));
  if (set.size === 0) activeConversationsByUser.delete(key);
};

const clearUserPresence = (userId) => {
  activeConversationsByUser.delete(String(userId));
};

const isViewingConversation = (userId, conversationId) => {
  const set = activeConversationsByUser.get(String(userId));
  return Boolean(set && set.has(String(conversationId)));
};

module.exports = {
  markConversationActive,
  markConversationInactive,
  clearUserPresence,
  isViewingConversation,
};
