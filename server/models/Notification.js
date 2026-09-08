const mongoose = require("mongoose");

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "system",
        "message",
        "job_application",
        "application_status",
        "admin_action",
        "follow",
        "news",
        "like",
        "spes",
      ],
      default: "system",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    relatedEntityType: {
      type: String,
      enum: ["job", "application", "conversation", "message", "user", "system", "announcement", "spes_application"],
      default: "system",
    },
    relatedEntityId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    actionUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
// Read notifications auto-expire 30 days after being read, so the collection
// doesn't grow without bound; unread notifications are kept indefinitely.
notificationSchema.index(
  { readAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { isRead: true } }
);

module.exports = mongoose.model("Notification", notificationSchema);
