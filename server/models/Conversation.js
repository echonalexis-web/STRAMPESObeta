const mongoose = require("mongoose");

const { Schema } = mongoose;

const conversationSchema = new Schema({
  participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
  lastMessage: { type: String, default: null },
  lastMessageAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  // Participants who have "deleted" this conversation from their own inbox —
  // per-participant soft delete, not a shared hard delete. A participant
  // still listed in `participants` but present here has the thread hidden
  // from their conversation list until a new message revives it for them.
  // See messageController.js's deleteConversation/getConversations/sendMessage.
  hiddenFor: [{ type: Schema.Types.ObjectId, ref: "User" }],
});

// Every inbox load queries `{ participants: userId }` — without this, that's
// a full collection scan on every visit to Messages.
conversationSchema.index({ participants: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);