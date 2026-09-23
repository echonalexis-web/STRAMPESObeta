const mongoose = require("mongoose");

const { Schema } = mongoose;

const messageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
  sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
  // Not required once unsent — Mongoose's String `required` check rejects
  // an empty string, but unsendMessage() clears content to "" as the whole
  // point of unsending, so the field must stop being required at that point.
  content: { type: String, required: function () { return !this.isUnsent; } },
  isRead: { type: Boolean, default: false },
  isUnsent: { type: Boolean, default: false },
  unsentAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

// Loading a thread queries `{ conversationId }` sorted by `createdAt` — this
// compound index serves both the filter and the sort in one pass instead of
// an in-memory sort after a full scan.
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ sender: 1 });

module.exports = mongoose.model("Message", messageSchema);
