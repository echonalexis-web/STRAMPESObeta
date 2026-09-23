const Notification = require("../models/Notification");
const User = require("../models/User");

const toSafeString = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};

const MESSAGE_TOGGLE_ROLES = new Set(["jobseeker", "employee", "resident"]);

// True when this recipient has explicitly opted out of `preferenceKey`.
// Missing/undefined (legacy documents, or a role with no matching Settings
// toggle) is treated as opted in — only a literal `false` suppresses the
// notification. Never throws: a lookup failure must not block a real event
// from notifying its recipient.
const isOptedOut = async (recipientId, preferenceKey) => {
  if (!preferenceKey || !recipientId) return false;
  try {
    const recipient = await User.findById(recipientId).select(
      `notificationPreferences.${preferenceKey}`
    );
    return recipient?.notificationPreferences?.[preferenceKey] === false;
  } catch {
    return false;
  }
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
  // Optional key into User.notificationPreferences (e.g. "notifyUserReport").
  // When given, the recipient's saved preference is consulted first; a
  // literal `false` skips creating the notification entirely. Omit for
  // notification types that have no matching Settings toggle.
  preferenceKey = null,
}) => {
  if (!recipientId) {
    return null;
  }

  if (await isOptedOut(recipientId, preferenceKey)) {
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

// Create the same notification for many recipients at once (e.g. a published
// announcement). Uses insertMany for one round-trip, then emits individually
// so each recipient's socket room gets their own copy.
const notifyManyUsers = async ({
  recipientIds = [],
  actorId = null,
  type = "system",
  title,
  message,
  relatedEntityType = "system",
  relatedEntityId = null,
  actionUrl = "",
  metadata = {},
  io = null,
  // See createNotificationForUser — same opt-out semantics, applied per
  // recipient before the fan-out.
  preferenceKey = null,
}) => {
  let uniqueRecipientIds = [...new Set(recipientIds.map(String))].filter(Boolean);
  if (uniqueRecipientIds.length === 0) {
    return [];
  }

  if (preferenceKey) {
    const optedIn = await User.find({
      _id: { $in: uniqueRecipientIds },
      [`notificationPreferences.${preferenceKey}`]: { $ne: false },
    }).select("_id");
    const optedInIds = new Set(optedIn.map((u) => String(u._id)));
    uniqueRecipientIds = uniqueRecipientIds.filter((id) => optedInIds.has(id));
    if (uniqueRecipientIds.length === 0) return [];
  }

  const docs = uniqueRecipientIds.map((recipientId) => ({
    recipient: recipientId,
    actor: actorId || null,
    type,
    title: toSafeString(title, "Notification"),
    message: toSafeString(message, "You have a new notification."),
    relatedEntityType,
    relatedEntityId,
    actionUrl: toSafeString(actionUrl, ""),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  }));

  const created = await Notification.insertMany(docs);

  if (io) {
    created.forEach((notification) => {
      io.to(`user:${String(notification.recipient)}`).emit(
        "notification:new",
        buildRealtimePayload(notification)
      );
    });
  }

  return created;
};

// Collapses repeated messages in the same conversation into a single unread
// notification (updating its preview and count) instead of stacking one row
// per message, so a burst of messages doesn't flood the notification list.
const notifyNewMessage = async ({
  recipientId,
  actorId = null,
  actorName = "Someone",
  conversationId,
  messagePreview,
  io = null,
}) => {
  if (!recipientId || !conversationId) {
    return null;
  }

  // Only jobseekers have a "new messages" toggle in Settings; employers,
  // admins and superadmins have no matching control, so they're never gated.
  try {
    const recipient = await User.findById(recipientId).select("role notificationPreferences.notifyMessages");
    if (
      recipient &&
      MESSAGE_TOGGLE_ROLES.has(recipient.role) &&
      recipient.notificationPreferences?.notifyMessages === false
    ) {
      return null;
    }
  } catch {
    /* a lookup failure must not block the notification */
  }

  const preview = toSafeString(messagePreview, "").slice(0, 120);

  const existing = await Notification.findOne({
    recipient: recipientId,
    type: "message",
    relatedEntityType: "conversation",
    relatedEntityId: conversationId,
    isRead: false,
  });

  if (existing) {
    const nextCount = Number(existing.metadata?.messageCount || 1) + 1;
    existing.actor = actorId || existing.actor;
    existing.title = `${nextCount} new messages from ${actorName}`;
    existing.message = preview;
    existing.metadata = { ...(existing.metadata || {}), messageCount: nextCount };
    existing.createdAt = new Date();
    await existing.save();

    if (io) {
      io.to(`user:${String(recipientId)}`).emit("notification:updated", buildRealtimePayload(existing));
    }

    return existing;
  }

  const created = await Notification.create({
    recipient: recipientId,
    actor: actorId || null,
    type: "message",
    title: `New message from ${actorName}`,
    message: preview,
    relatedEntityType: "conversation",
    relatedEntityId: conversationId,
    actionUrl: "/messages",
    metadata: { messageCount: 1 },
  });

  if (io) {
    io.to(`user:${String(recipientId)}`).emit("notification:new", buildRealtimePayload(created));
  }

  return created;
};

// Collapses repeated likes on the same item into a single unread
// notification ("5 people liked your post") instead of one row per like,
// same anti-clutter approach as notifyNewMessage.
const notifyLike = async ({
  recipientId,
  actorId = null,
  actorName = "Someone",
  relatedEntityType,
  relatedEntityId,
  itemLabel = "your post",
  actionUrl = "",
  io = null,
}) => {
  if (!recipientId || !relatedEntityId || String(recipientId) === String(actorId)) {
    return null;
  }

  const existing = await Notification.findOne({
    recipient: recipientId,
    type: "like",
    relatedEntityType,
    relatedEntityId,
    isRead: false,
  });

  if (existing) {
    const nextCount = Number(existing.metadata?.likeCount || 1) + 1;
    existing.actor = actorId || existing.actor;
    existing.title = `${nextCount} people liked ${itemLabel}`;
    existing.message = `${actorName} and ${nextCount - 1} other${nextCount - 1 === 1 ? "" : "s"} liked ${itemLabel}.`;
    existing.metadata = { ...(existing.metadata || {}), likeCount: nextCount };
    existing.createdAt = new Date();
    await existing.save();

    if (io) {
      io.to(`user:${String(recipientId)}`).emit("notification:updated", buildRealtimePayload(existing));
    }

    return existing;
  }

  const created = await Notification.create({
    recipient: recipientId,
    actor: actorId || null,
    type: "like",
    title: `New like on ${itemLabel}`,
    message: `${actorName} liked ${itemLabel}.`,
    relatedEntityType,
    relatedEntityId,
    actionUrl,
    metadata: { likeCount: 1 },
  });

  if (io) {
    io.to(`user:${String(recipientId)}`).emit("notification:new", buildRealtimePayload(created));
  }

  return created;
};

module.exports = {
  createNotificationForUser,
  notifyManyUsers,
  notifyNewMessage,
  notifyLike,
  buildRealtimePayload,
};
