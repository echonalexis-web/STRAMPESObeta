const Notification = require("../models/Notification");

const toSafeString = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};

const buildRealtimePayload = (notificationDoc) => ({
  _id: notificationDoc._id,
  recipient: notificationDoc.recipient,
  actor: notificationDoc.actor,
  type: notificationDoc.type,
  title: notificationDoc.title,
  message: notificationDoc.message,
  relatedEntityType: notificationDoc.relatedEntityType,
  relatedEntityId: notificationDoc.relatedEntityId,
  actionUrl: notificationDoc.actionUrl,
  metadata: notificationDoc.metadata,
  isRead: notificationDoc.isRead,
  readAt: notificationDoc.readAt,
  createdAt: notificationDoc.createdAt,
  updatedAt: notificationDoc.updatedAt,
});

const createNotificationForUser = async ({
  recipientId,
  actorId = null,
  type = "system",
  title,
  message,
  relatedEntityType = "system",
  relatedEntityId = null,
  actionUrl = "",
  metadata = {},
  io = null,
}) => {
  if (!recipientId) {
    return null;
  }

  const notification = await Notification.create({
    recipient: recipientId,
    actor: actorId || null,
    type,
    title: toSafeString(title, "Notification"),
    message: toSafeString(message, "You have a new notification."),
    relatedEntityType,
    relatedEntityId,
    actionUrl: toSafeString(actionUrl, ""),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  });

  if (io) {
    io.to(`user:${String(recipientId)}`).emit("notification:new", buildRealtimePayload(notification));
  }

  return notification;
};

module.exports = {
  createNotificationForUser,
  buildRealtimePayload,
};
