// Socket.IO conversation-room handlers for one authenticated socket.
//
// A conversation room carries the employer's automatic status-change messages
// (hired, rejected, interview scheduled, no-show) and typing indicators, so
// only the conversation's participants may join it. The join used to accept
// any well-formed ObjectId, which let any signed-in user subscribe to other
// people's conversations; typing events could also be sent into a room
// without joining it, because emitting to a room needs no membership.

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const isConversationId = (value) => typeof value === "string" && OBJECT_ID.test(value);

/**
 * @param {import("socket.io").Socket & { userId: string }} socket authenticated socket
 * @param {{ Conversation: any, presenceService: any, logger: any }} deps
 */
const registerConversationHandlers = (socket, { Conversation, presenceService, logger }) => {
  socket.on("join_conversation", async (conversationId) => {
    if (!isConversationId(conversationId)) {
      return socket.emit("error", { message: "Invalid conversation ID" });
    }

    let isParticipant = false;
    try {
      isParticipant = Boolean(await Conversation.exists({ _id: conversationId, participants: socket.userId }));
    } catch (error) {
      logger.error("Conversation membership check failed", { error: error.message });
    }
    if (!isParticipant) {
      logger.warn("Refused join_conversation for a non-participant", { userId: String(socket.userId) });
      return socket.emit("error", { message: "Conversation not found" });
    }

    socket.join(conversationId);
    presenceService.markConversationActive(socket.userId, conversationId);
  });

  socket.on("leave_conversation", (conversationId) => {
    if (!isConversationId(conversationId)) return;
    socket.leave(conversationId);
    presenceService.markConversationInactive(socket.userId, conversationId);
  });

  // Only a socket that joined the room (so passed the participant check) can
  // relay typing state into it.
  const isMember = (conversationId) => isConversationId(conversationId) && socket.rooms.has(conversationId);

  socket.on("typing", (data) => {
    if (!isMember(data?.conversationId)) return;
    socket.to(data.conversationId).emit("user_typing", {
      conversationId: data.conversationId,
      senderId: socket.userId,
    });
  });

  socket.on("stop_typing", (data) => {
    if (!isMember(data?.conversationId)) return;
    socket.to(data.conversationId).emit("user_stop_typing", {
      conversationId: data.conversationId,
    });
  });
};

module.exports = { registerConversationHandlers };
